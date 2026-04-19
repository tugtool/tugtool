//! Agent supervisor module
//!
//! Houses the per-session ledger, SESSION_STATE / SESSION_METADATA broadcast
//! senders, the CODE_INPUT dispatcher, and the state machine that owns the
//! spawn/dispatch/merge lifecycle for Claude Code sessions.
//!
//! # Lock-order invariant
//!
//! The supervisor holds three async mutexes: the outer ledger map, the
//! `client_sessions` map, and per-session `Mutex<LedgerEntry>` entries
//! reached through the outer map. To avoid deadlock, all code in this module
//! acquires locks in the following order and never in reverse:
//!
//! 1. **Ledger outer mutex** (`self.ledger`).
//! 2. **`client_sessions` mutex** (`self.client_sessions`) — may be acquired
//!    while the ledger mutex is held, during an atomic get-or-insert +
//!    affinity update.
//! 3. **Per-session `Mutex<LedgerEntry>`** — acquired only after releasing
//!    the outer locks, never while the outer locks are held.
//!
//! The TOCTOU fix for [R06] depends on this ordering: `do_spawn_session` and
//! `do_close_session` take the ledger mutex + `client_sessions` mutex as a
//! single atomic critical section so a concurrent close/spawn cannot
//! interleave between the ledger mutation and the affinity mutation.
//!
//! Downstream steps still rely on `#[allow(dead_code)]` for types whose
//! consumers have not yet landed in the router wiring.

#![allow(dead_code)]

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{Mutex, broadcast, mpsc};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::sync::CancellationToken;
use tracing::warn;
use tugbank_core::{TugbankClient, Value};
use tugcast_core::protocol::{FeedId, Frame, TugSessionId};

use super::agent_bridge::{
    ChildSpawner, CrashBudget, DEFAULT_RETRY_DELAY, SessionMode, TugcodeSpawner, run_session_bridge,
};
use super::code::parse_tug_session_id;
use super::session_metadata::is_system_metadata;
use super::workspace_registry::{WorkspaceError, WorkspaceKey, WorkspaceRegistry};

/// Tugbank domain used to persist the `(card_id → tug_session_id)` mapping
/// so the router can rebind sessions on restart.
pub const SESSION_KEYS_DOMAIN: &str = "dev.tugtool.tide.session-keys";

/// Capacity of per-session CODE_INPUT buffering queues.
pub const BOUNDED_QUEUE_CAP: usize = 256;

/// WebSocket connection identifier. Matches the router's existing
/// `client_id_counter` type.
pub type ClientId = u64;

// ---------------------------------------------------------------------------
// SpawnState
// ---------------------------------------------------------------------------

/// Lifecycle state of a session's backing subprocess.
///
/// The allowed transitions follow the supervisor state machine in
/// `tugplan-multi-session-router` (see `#supervisor-state-machine`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpawnState {
    /// Intent registered, no subprocess yet.
    Idle,
    /// Subprocess starting; CODE_INPUT is being buffered in the per-session queue.
    Spawning,
    /// Subprocess running normally.
    Live,
    /// Crash budget exhausted; awaiting `reset_session`.
    Errored,
    /// Session explicitly closed by `close_session`.
    Closed,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SpawnStateError {
    #[error("invalid spawn-state transition: {from:?} -> {to:?}")]
    InvalidTransition { from: SpawnState, to: SpawnState },
}

impl SpawnState {
    /// Attempt to advance the state machine. Returns `Err` if the transition
    /// is not permitted by the supervisor's guard rules.
    pub fn try_transition(&mut self, next: SpawnState) -> Result<(), SpawnStateError> {
        use SpawnState::*;
        let allowed = matches!(
            (*self, next),
            // Normal happy path
            (Idle, Spawning)
                | (Spawning, Live)
                // Failure paths
                | (Spawning, Errored)
                | (Live, Errored)
                // Close paths (close is legal from any non-terminal state;
                // `Spawning → Closed` covers the "user kills card while
                // subprocess is coming up" case)
                | (Idle, Closed)
                | (Spawning, Closed)
                | (Live, Closed)
                | (Errored, Closed)
                // Reset paths (close → re-arm)
                | (Closed, Idle)
                | (Errored, Idle)
        );
        if allowed {
            *self = next;
            Ok(())
        } else {
            Err(SpawnStateError::InvalidTransition {
                from: *self,
                to: next,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// BoundedQueue
// ---------------------------------------------------------------------------

/// Result of pushing onto a [`BoundedQueue`]. Marked `#[must_use]` so callers
/// cannot silently drop frames on overflow — every push site must either
/// branch on the result or explicitly acknowledge the known-safe invariant.
#[must_use]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueuePush {
    /// Item accepted.
    Ok,
    /// Queue at capacity — item dropped.
    Overflow,
}

/// Fixed-capacity FIFO queue used to buffer CODE_INPUT frames during the
/// `Spawning` window. Pushes past capacity are dropped and signalled to the
/// caller.
#[derive(Debug)]
pub struct BoundedQueue<T> {
    inner: VecDeque<T>,
    cap: usize,
}

impl<T> BoundedQueue<T> {
    /// Construct a queue with the default capacity ([`BOUNDED_QUEUE_CAP`]).
    pub fn new() -> Self {
        Self::with_capacity(BOUNDED_QUEUE_CAP)
    }

    /// Construct a queue with an explicit capacity.
    pub fn with_capacity(cap: usize) -> Self {
        Self {
            inner: VecDeque::with_capacity(cap),
            cap,
        }
    }

    /// Maximum number of items the queue will hold.
    pub fn capacity(&self) -> usize {
        self.cap
    }

    /// Current item count.
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// `true` if empty.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Push an item; returns [`QueuePush::Overflow`] if at capacity.
    pub fn push(&mut self, item: T) -> QueuePush {
        if self.inner.len() >= self.cap {
            QueuePush::Overflow
        } else {
            self.inner.push_back(item);
            QueuePush::Ok
        }
    }

    /// Pop the oldest item.
    pub fn pop(&mut self) -> Option<T> {
        self.inner.pop_front()
    }
}

impl<T> Default for BoundedQueue<T> {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// LedgerEntry
// ---------------------------------------------------------------------------

/// Per-session ledger record, keyed by [`TugSessionId`] in the supervisor.
///
/// Shape follows Spec S01 (`#s01-ledger-entry`). Notably, there is no
/// `ReplayBuffer` field — the CODE_OUTPUT replay buffer stays shared at the
/// router level per [D06]; the supervisor only routes `system_metadata`
/// per-session.
pub struct LedgerEntry {
    /// Client-authoritative UUID for this session.
    pub tug_session_id: TugSessionId,
    /// Populated once `session_init` arrives from the subprocess.
    pub claude_session_id: Option<String>,
    /// Canonical `WorkspaceKey` returned by `WorkspaceRegistry::get_or_create`.
    /// Used by `do_close_session` to call `registry.release`. (W2 Step 6.)
    pub workspace_key: WorkspaceKey,
    /// Caller-supplied path (pre-canonicalization). Passed to
    /// `ChildSpawner::spawn_child` in `run_session_bridge` as the spawned
    /// Claude Code process's cwd, and retained for reset-session to
    /// respawn without losing the binding. (W2 Step 6.)
    pub project_dir: PathBuf,
    /// User's spawn-time new-vs-resume choice (roadmap step 4.5).
    /// Forwarded as `--session-mode new|resume` to the tugcode subprocess.
    /// Reconnects reuse this value so the tugcode side of the session
    /// doesn't flip modes mid-life.
    pub session_mode: SessionMode,
    /// Lifecycle state.
    pub spawn_state: SpawnState,
    /// Per-session crash budget (3 crashes / 60s by convention).
    pub crash_budget: CrashBudget,
    /// CODE_INPUT buffer used during the `Spawning` window.
    pub queue: BoundedQueue<Frame>,
    /// Latest `system_metadata` payload for this session, for on-subscribe
    /// replay per [D14].
    pub latest_metadata: Option<Frame>,
    /// Owned subprocess handle when `Live`.
    pub child: Option<tokio::process::Child>,
    /// Stdin sender when `Live`.
    pub input_tx: Option<mpsc::Sender<Frame>>,
    /// Cancels the per-session worker on `close_session`.
    pub cancel: CancellationToken,
}

impl LedgerEntry {
    /// Create a fresh `Idle` entry for a newly registered session.
    pub fn new(
        tug_session_id: TugSessionId,
        workspace_key: WorkspaceKey,
        project_dir: PathBuf,
        session_mode: SessionMode,
        crash_budget: CrashBudget,
    ) -> Self {
        Self {
            tug_session_id,
            claude_session_id: None,
            workspace_key,
            project_dir,
            session_mode,
            spawn_state: SpawnState::Idle,
            crash_budget,
            queue: BoundedQueue::new(),
            latest_metadata: None,
            child: None,
            input_tx: None,
            cancel: CancellationToken::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Ledger alias
// ---------------------------------------------------------------------------

/// Shared ledger map. Outer mutex guards membership; per-session mutex guards
/// the entry's mutable fields.
pub type Ledger = Arc<Mutex<HashMap<TugSessionId, Arc<Mutex<LedgerEntry>>>>>;

// ---------------------------------------------------------------------------
// SessionKeysStore — narrow persistence trait for card↔session bindings
// ---------------------------------------------------------------------------

/// Error returned from [`SessionKeysStore`] operations.
#[derive(Debug, Error)]
#[error("session keys store failure: {0}")]
pub struct SessionKeysStoreError(pub String);

/// Structured per-card session binding persisted in the session-keys domain.
///
/// Replaces the bare `Value::String(tug_session_id)` schema used in W1 with a
/// forward-compatible record. The `#[serde(default)]` on the optional fields
/// lets older readers and writers round-trip without explicit version tagging:
/// a reader built against an older shape sees missing fields as `None`, and a
/// writer built against a newer shape can populate them.
///
/// - `tug_session_id`: the routing key; always populated.
/// - `project_dir`: `Some` for post-W2 records; `None` for pre-W2 legacy blobs
///   (dropped on rebind once Step 6 teaches rebind to bind workspaces).
/// - `claude_session_id`: `None` until P14 starts populating it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionKeyRecord {
    pub tug_session_id: String,
    #[serde(default)]
    pub project_dir: Option<String>,
    #[serde(default)]
    pub claude_session_id: Option<String>,
}

/// Persistence surface for the `(card_id → SessionKeyRecord)` mapping.
///
/// The supervisor depends on a narrow trait (rather than on `TugbankClient`
/// directly) so unit tests can inject an in-memory fake — and, per [D12]'s
/// strict-vs-best-effort asymmetry, can inject an error-producing fake to
/// exercise the `spawn_session` persistence-failure path.
pub trait SessionKeysStore: Send + Sync {
    /// Write `(card_id, record)` into the session-keys domain. The record is
    /// serialized to `Value::Json` so forward-compatible fields round-trip
    /// through the tugbank blob store.
    fn set_session_record(
        &self,
        card_id: &str,
        record: &SessionKeyRecord,
    ) -> Result<(), SessionKeysStoreError>;

    /// Delete the entry keyed by `card_id`. Returning `Ok(())` when the key is
    /// missing is acceptable — the supervisor treats delete as best-effort.
    fn delete_session_key(&self, card_id: &str) -> Result<(), SessionKeysStoreError>;

    /// Enumerate every persisted `(card_id, SessionKeyRecord)` pair. Used by
    /// [`AgentSupervisor::rebind_from_tugbank`] at startup to re-materialize
    /// intent records from a previous run (per [F15]).
    ///
    /// The `TugbankClient` implementation performs a dual-read migration:
    /// - `Value::Json` entries are deserialized as `SessionKeyRecord`.
    /// - `Value::String` entries (pre-W2 legacy blobs) are promoted to a
    ///   record with `project_dir = None, claude_session_id = None`.
    ///
    /// Entries whose `tug_session_id` is empty, whose payload is neither
    /// string nor parseable JSON, or whose JSON is malformed must be
    /// skipped under a warn log; returning them would leak garbage into
    /// the ledger.
    fn list_session_records(
        &self,
    ) -> Result<Vec<(String, SessionKeyRecord)>, SessionKeysStoreError>;
}

impl SessionKeysStore for TugbankClient {
    fn set_session_record(
        &self,
        card_id: &str,
        record: &SessionKeyRecord,
    ) -> Result<(), SessionKeysStoreError> {
        let json =
            serde_json::to_value(record).map_err(|e| SessionKeysStoreError(e.to_string()))?;
        self.set(SESSION_KEYS_DOMAIN, card_id, Value::Json(json))
            .map_err(|e| SessionKeysStoreError(e.to_string()))
    }

    fn delete_session_key(&self, card_id: &str) -> Result<(), SessionKeysStoreError> {
        self.delete(SESSION_KEYS_DOMAIN, card_id)
            .map(|_| ())
            .map_err(|e| SessionKeysStoreError(e.to_string()))
    }

    fn list_session_records(
        &self,
    ) -> Result<Vec<(String, SessionKeyRecord)>, SessionKeysStoreError> {
        let snapshot = self
            .read_domain(SESSION_KEYS_DOMAIN)
            .map_err(|e| SessionKeysStoreError(e.to_string()))?;
        let mut out = Vec::with_capacity(snapshot.len());
        for (card_id, value) in snapshot {
            let record = match value {
                Value::Json(j) => match serde_json::from_value::<SessionKeyRecord>(j) {
                    Ok(r) if !r.tug_session_id.is_empty() => r,
                    Ok(_) => {
                        warn!(
                            card_id,
                            "session-keys entry has empty tug_session_id; skipping"
                        );
                        continue;
                    }
                    Err(e) => {
                        warn!(
                            card_id,
                            error = %e,
                            "failed to parse SessionKeyRecord; skipping"
                        );
                        continue;
                    }
                },
                Value::String(s) if !s.is_empty() => SessionKeyRecord {
                    tug_session_id: s,
                    project_dir: None,
                    claude_session_id: None,
                },
                _ => {
                    warn!(card_id, "non-json non-string session-keys entry; skipping");
                    continue;
                }
            };
            out.push((card_id, record));
        }
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// SessionsRecorder — writer trait for the sessions-record tugbank entry
// ---------------------------------------------------------------------------

/// Tugbank domain for the sessions record.
pub const SESSIONS_DOMAIN: &str = "dev.tugtool.tide";
/// Tugbank key (within `SESSIONS_DOMAIN`) for the sessions record.
pub const SESSIONS_KEY: &str = "sessions";

/// Writer for the sessions record — one entry per session, keyed by
/// the session id (which is also claude's own id and the id the feed
/// routes under).
///
/// The record shape is `{[sessionId]: {projectDir, createdAt}}`. The
/// picker in tugdeck reads this record to surface resume candidates;
/// tugcast writes it from the bridge on `session_init` and removes
/// entries on `resume_failed`. Centralizing the write here — instead of
/// tugcode reaching into the sqlite file directly — means every write
/// goes through the Rust `TugbankClient`, which broadcasts
/// `domain-changed` notifications automatically. No subprocess shim.
pub trait SessionsRecorder: Send + Sync {
    /// Upsert the record for `session_id`. Preserves an existing
    /// `createdAt` if the record already exists; uses `now` otherwise.
    fn record(&self, session_id: &str, project_dir: &str);

    /// Remove the record for `session_id`. No-op if the id is absent.
    fn remove(&self, session_id: &str);
}

/// Production implementation backed by a shared [`TugbankClient`].
pub struct TugbankSessionsRecorder {
    pub client: Arc<TugbankClient>,
}

impl TugbankSessionsRecorder {
    pub fn new(client: Arc<TugbankClient>) -> Self {
        Self { client }
    }

    fn read_map(&self) -> serde_json::Map<String, serde_json::Value> {
        let existing = self
            .client
            .get(SESSIONS_DOMAIN, SESSIONS_KEY)
            .ok()
            .flatten();
        match existing {
            Some(Value::Json(serde_json::Value::Object(m))) => m,
            Some(Value::String(s)) => {
                // Tugcode historically wrote the value as a JSON-stringified
                // map under `Value::String`. Accept both shapes on read so
                // pre-refactor records keep working; writes always use Json.
                match serde_json::from_str::<serde_json::Value>(&s) {
                    Ok(serde_json::Value::Object(m)) => m,
                    _ => serde_json::Map::new(),
                }
            }
            _ => serde_json::Map::new(),
        }
    }

    fn write_map(&self, map: serde_json::Map<String, serde_json::Value>) {
        if let Err(err) = self.client.set(
            SESSIONS_DOMAIN,
            SESSIONS_KEY,
            Value::Json(serde_json::Value::Object(map)),
        ) {
            warn!(error = %err, "failed to write sessions record");
        }
    }
}

impl SessionsRecorder for TugbankSessionsRecorder {
    fn record(&self, session_id: &str, project_dir: &str) {
        let mut map = self.read_map();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let existing_created_at = map
            .get(session_id)
            .and_then(|v| v.get("createdAt"))
            .and_then(|v| v.as_u64());
        let created_at = existing_created_at.unwrap_or(now);
        map.insert(
            session_id.to_owned(),
            serde_json::json!({
                "projectDir": project_dir,
                "createdAt": created_at,
            }),
        );
        self.write_map(map);
        tracing::info!(
            target: "tide::session-lifecycle",
            event = "sessions.record",
            session_id = session_id,
            project_dir = project_dir,
            created_at = created_at,
        );
    }

    fn remove(&self, session_id: &str) {
        let mut map = self.read_map();
        if map.remove(session_id).is_some() {
            self.write_map(map);
            tracing::info!(
                target: "tide::session-lifecycle",
                event = "sessions.remove",
                session_id = session_id,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// AgentSupervisor
// ---------------------------------------------------------------------------

/// Runtime configuration for [`AgentSupervisor`].
///
/// W2 Step 6 deleted `project_dir` — the supervisor no longer has a global
/// workspace path ([D12]). Per-session paths come from the CONTROL
/// `spawn_session` payload and live on `LedgerEntry.project_dir`.
///
/// P13 added `max_concurrent_sessions` and `max_spawns_per_minute` as safety
/// caps so a buggy client or a user with many open cards cannot run the host
/// out of subprocess slots. See [`AgentSupervisor::do_spawn_session`] for the
/// enforcement path.
#[derive(Debug, Clone)]
pub struct AgentSupervisorConfig {
    /// Absolute path to the tugcode binary (or `.ts` entry for bun fallback).
    /// Only consumed by the default [`TugcodeSpawner`] factory.
    pub tugcode_path: PathBuf,
    /// Hard cap on concurrent `Spawning` + `Live` ledger entries. A
    /// `spawn_session` CONTROL frame that would push the count at or above
    /// this bound is rejected with
    /// `ControlError::CapExceeded { reason: "concurrent_session_cap_exceeded" }`
    /// and a `SESSION_STATE = errored` broadcast. Idle and Errored entries
    /// do NOT consume slots — only sessions with a running or starting
    /// subprocess count.
    pub max_concurrent_sessions: usize,
    /// Leaky-bucket rate limit on fresh spawn-session intents. Trailing 60s
    /// window; the N+1th spawn within the window is rejected with
    /// `ControlError::CapExceeded { reason: "spawn_rate_limited" }`.
    /// Reconnects (spawns for an existing ledger entry) do not consume
    /// budget.
    pub max_spawns_per_minute: usize,
}

impl Default for AgentSupervisorConfig {
    fn default() -> Self {
        Self {
            tugcode_path: PathBuf::new(),
            max_concurrent_sessions: 8,
            max_spawns_per_minute: 20,
        }
    }
}

/// Factory that yields a fresh [`ChildSpawner`] for each session spawn. The
/// default factory returns [`TugcodeSpawner`]; tests pass a closure returning
/// a mock spawner so they can drive the bridge without a real subprocess.
pub type SpawnerFactory = Arc<dyn Fn() -> Arc<dyn ChildSpawner> + Send + Sync>;

/// Build the default production spawner factory from an
/// [`AgentSupervisorConfig`]. Each call to the factory clones the configured
/// `tugcode_path` into a fresh [`TugcodeSpawner`]. `config.project_dir` is
/// **not** captured — the per-session workspace path is passed to
/// `spawn_child` per call (see [`ChildSpawner::spawn_child`]).
pub fn default_spawner_factory(config: &AgentSupervisorConfig) -> SpawnerFactory {
    let tugcode_path = config.tugcode_path.clone();
    Arc::new(move || Arc::new(TugcodeSpawner::new(tugcode_path.clone())) as Arc<dyn ChildSpawner>)
}

/// Errors returned from [`AgentSupervisor::handle_control`]. Consumed by
/// `handle_client` (wired in Step 8) to emit a CONTROL error frame on the
/// in-scope socket.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ControlError {
    #[error("control payload missing card_id")]
    MissingCardId,
    #[error("control payload missing tug_session_id")]
    MissingSessionId,
    #[error("control payload is not valid JSON")]
    Malformed,
    #[error("tugbank persistence failed: {0}")]
    PersistenceFailure(String),
    /// The payload's `project_dir` field is missing or fails validation.
    /// `reason` is a compile-time string from the set defined in Spec S03:
    /// `"missing_project_dir"`, `"does_not_exist"`, `"permission_denied"`,
    /// `"not_a_directory"`, `"metadata_error"`.
    #[error("invalid project_dir: {reason}")]
    InvalidProjectDir { reason: &'static str },
    /// P13 spawn-budget rejection. `reason` is one of:
    /// `"concurrent_session_cap_exceeded"` (hit
    /// `AgentSupervisorConfig::max_concurrent_sessions`) or
    /// `"spawn_rate_limited"` (hit `max_spawns_per_minute`). Router maps
    /// both to a CONTROL error frame on the in-scope socket; the
    /// supervisor also broadcasts `SESSION_STATE = errored` with the same
    /// `detail` so any other observer of the session sees the failure.
    #[error("spawn budget exceeded: {reason}")]
    CapExceeded { reason: &'static str },
}

/// Central owner of all Claude Code sessions for a single tugcast process.
pub struct AgentSupervisor {
    /// Per-session ledger (see [`LedgerEntry`]).
    pub ledger: Ledger,
    /// Broadcast sender for `SESSION_STATE` frames.
    pub session_state_tx: broadcast::Sender<Frame>,
    /// Broadcast sender for `SESSION_METADATA` frames. Broadcast — not watch —
    /// per [D14] so concurrent per-session metadata updates cannot clobber
    /// one another.
    pub session_metadata_tx: broadcast::Sender<Frame>,
    /// Per-client session affinity, used by the P5 authorization cross-check.
    pub client_sessions: Arc<Mutex<HashMap<ClientId, HashSet<TugSessionId>>>>,
    /// Shared supervisor-wide CODE_OUTPUT broadcast sender.
    pub code_output_tx: broadcast::Sender<Frame>,
    /// Outbound CONTROL broadcast sender — used for `session_unknown`,
    /// `session_backpressure`, and other supervisor-emitted error frames.
    pub control_tx: broadcast::Sender<Frame>,
    /// Narrow persistence surface for card↔session bindings.
    pub store: Arc<dyn SessionKeysStore>,
    /// Writer for the per-session record under
    /// `dev.tugtool.tide / sessions`. The bridge calls `record` on
    /// `session_init` and `remove` on `resume_failed`. Tugcode has no
    /// direct tugbank access for this domain.
    pub sessions_recorder: Arc<dyn SessionsRecorder>,
    /// Per-spawn factory for the backing subprocess. Swapped for a mock in
    /// tests so unit tests do not need a real tugcode binary.
    pub spawner_factory: SpawnerFactory,
    /// Register side of the merger task's per-session stream map. Each
    /// `spawn_session_worker` call pushes a `(tug_session_id, output_rx)`
    /// pair through here; `merger_task` inserts it into its internal
    /// `StreamMap` and fans the frames into the shared CODE_OUTPUT
    /// broadcast + SESSION_METADATA broadcast.
    pub merger_register_tx: mpsc::Sender<MergerRegistration>,
    /// Runtime configuration.
    pub config: AgentSupervisorConfig,
    /// Per-workspace feed registry (W2 Step 6). `do_spawn_session` calls
    /// `registry.get_or_create`; `do_close_session` calls
    /// `registry.release`. Shared across the whole tugcast process.
    pub registry: Arc<WorkspaceRegistry>,
    /// Process-wide cancel token, cloned into `registry.get_or_create`
    /// calls so each new workspace entry derives a child cancel from
    /// the shared root. Firing this (e.g. on process shutdown) tears
    /// down every workspace's tasks.
    pub cancel: CancellationToken,
    /// P13 leaky-bucket state. Holds the timestamps of every successful
    /// fresh spawn intent within the trailing 60s window, in insertion
    /// order. Trimmed + checked + pushed inside `do_spawn_session`'s
    /// Phase 1 critical section so the rate-limit decision is atomic with
    /// the ledger insert. `std::sync::Mutex` (not tokio's async mutex)
    /// because the critical section is bounded, non-awaiting, and never
    /// crosses an `.await` point.
    pub spawn_timestamps: Arc<StdMutex<VecDeque<Instant>>>,
}

/// Registration sent through [`AgentSupervisor::merger_register_tx`] so the
/// merger task learns about a newly-spawned session worker's output stream.
pub type MergerRegistration = (TugSessionId, mpsc::Receiver<Frame>);

/// Owned form of a parsed CONTROL payload.
struct OwnedControlPayload {
    card_id: String,
    tug_session_id: TugSessionId,
    /// W2 Step 6: per-session workspace path. `None` for close/reset
    /// payloads (which don't need it); `Some` for spawn payloads and
    /// rejected with `InvalidProjectDir { reason: "missing_project_dir" }`
    /// if absent on the spawn path.
    project_dir: Option<String>,
    /// Roadmap step 4.5: new-vs-resume choice. Absent values default to
    /// `SessionMode::New` so pre-4.5 payloads keep the step-4k behavior.
    session_mode: SessionMode,
}

fn parse_control_payload_owned(payload: &[u8]) -> Result<OwnedControlPayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let card_id = value
        .get("card_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingCardId)?
        .to_string();
    let tug_session_id = value
        .get("tug_session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingSessionId)?
        .to_string();
    let project_dir = value
        .get("project_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let session_mode =
        SessionMode::from_wire_str(value.get("session_mode").and_then(|v| v.as_str()));
    Ok(OwnedControlPayload {
        card_id,
        tug_session_id: TugSessionId::new(tug_session_id),
        project_dir,
        session_mode,
    })
}

/// Canonical constructor for `SESSION_STATE` wire frames. Shared between
/// `agent_supervisor` (pending/spawning/closed/errored on control events)
/// and `agent_bridge` (live after session_init, errored on crash-budget
/// exhaustion). A single source of truth prevents wire-level drift between
/// publish sites.
pub(super) fn build_session_state_frame(
    tug_session_id: &TugSessionId,
    state: &str,
    detail: Option<&str>,
) -> Frame {
    let body = serde_json::json!({
        "tug_session_id": tug_session_id.as_str(),
        "state": state,
        "detail": detail,
    });
    let bytes = serde_json::to_vec(&body).expect("SESSION_STATE payload serializes");
    Frame::new(FeedId::SESSION_STATE, bytes)
}

fn build_session_unknown_frame(tug_session_id: &TugSessionId) -> Frame {
    let body = serde_json::json!({
        "type": "error",
        "detail": "session_unknown",
        "tug_session_id": tug_session_id.as_str(),
    });
    Frame::new(
        FeedId::CONTROL,
        serde_json::to_vec(&body).expect("session_unknown payload serializes"),
    )
}

/// P13 spawn-budget check. Run inside `do_spawn_session`'s Phase 1 critical
/// section under the ledger lock. Returns the `detail` string that should be
/// stamped into both the `SESSION_STATE = errored` broadcast and the
/// returned `ControlError::CapExceeded`, or `None` if the spawn is
/// admissible. On admission the current `Instant` is appended to
/// `spawn_timestamps` so the rate-limit window advances atomically with
/// the cap decision.
///
/// Concurrent cap counts `Spawning` + `Live` entries only — `Idle` (intent
/// without subprocess) and `Errored` (crashed, awaiting reset) do not
/// consume slots. The per-entry `try_lock` is non-blocking; a contended
/// entry is counted conservatively as active so the cap cannot be
/// bypassed by a racing dispatcher.
fn cap_check_reason(
    ledger: &HashMap<TugSessionId, Arc<Mutex<LedgerEntry>>>,
    max_concurrent_sessions: usize,
    spawn_timestamps: &StdMutex<VecDeque<Instant>>,
    max_spawns_per_minute: usize,
) -> Option<&'static str> {
    let mut active = 0usize;
    for entry_arc in ledger.values() {
        let counted = match entry_arc.try_lock() {
            Ok(entry) => {
                matches!(entry.spawn_state, SpawnState::Spawning | SpawnState::Live)
            }
            Err(_) => true,
        };
        if counted {
            active += 1;
            if active >= max_concurrent_sessions {
                return Some("concurrent_session_cap_exceeded");
            }
        }
    }
    let mut ts = spawn_timestamps
        .lock()
        .expect("spawn_timestamps mutex poisoned");
    let now = Instant::now();
    let cutoff = now.checked_sub(Duration::from_secs(60)).unwrap_or(now);
    while ts.front().is_some_and(|&t| t < cutoff) {
        ts.pop_front();
    }
    if ts.len() >= max_spawns_per_minute {
        return Some("spawn_rate_limited");
    }
    ts.push_back(now);
    None
}

fn build_backpressure_frame(tug_session_id: &TugSessionId) -> Frame {
    let body = serde_json::json!({
        "type": "session_backpressure",
        "tug_session_id": tug_session_id.as_str(),
    });
    Frame::new(
        FeedId::CONTROL,
        serde_json::to_vec(&body).expect("session_backpressure payload serializes"),
    )
}

/// Routing decision produced by the CODE_INPUT dispatcher under the per-session
/// lock and consumed outside the lock so await-heavy sends never race the
/// lock's critical section.
enum Decision {
    Drop,
    Spawn,
    Forward(mpsc::Sender<Frame>, Frame),
    Backpressure,
}

impl AgentSupervisor {
    /// Construct a supervisor with pre-made broadcast senders, a session
    /// keys store, and a spawner factory. Returns `(supervisor,
    /// merger_register_rx)` — the caller is expected to `tokio::spawn`
    /// [`AgentSupervisor::merger_task`] with the returned receiver.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        session_state_tx: broadcast::Sender<Frame>,
        session_metadata_tx: broadcast::Sender<Frame>,
        code_output_tx: broadcast::Sender<Frame>,
        control_tx: broadcast::Sender<Frame>,
        store: Arc<dyn SessionKeysStore>,
        sessions_recorder: Arc<dyn SessionsRecorder>,
        spawner_factory: SpawnerFactory,
        config: AgentSupervisorConfig,
        registry: Arc<WorkspaceRegistry>,
        cancel: CancellationToken,
    ) -> (Self, mpsc::Receiver<MergerRegistration>) {
        let (merger_register_tx, merger_register_rx) = mpsc::channel(64);
        let sup = Self {
            ledger: Arc::new(Mutex::new(HashMap::new())),
            session_state_tx,
            session_metadata_tx,
            client_sessions: Arc::new(Mutex::new(HashMap::new())),
            code_output_tx,
            control_tx,
            store,
            sessions_recorder,
            spawner_factory,
            merger_register_tx,
            config,
            registry,
            cancel,
            spawn_timestamps: Arc::new(StdMutex::new(VecDeque::new())),
        };
        (sup, merger_register_rx)
    }

    /// Handle a CONTROL frame's spawn/close/reset action. `client_id` is the
    /// WebSocket connection id (see [D09]); it is distinct from `card_id` and
    /// is used only for the per-client session affinity map in [D14].
    pub async fn handle_control(
        &self,
        action: &str,
        payload: &[u8],
        client_id: ClientId,
    ) -> Result<(), ControlError> {
        match action {
            "spawn_session" => {
                let parsed = parse_control_payload_owned(payload).inspect_err(|e| {
                    warn!(action, error = %e, "handle_control: rejected spawn_session");
                })?;
                // W2 Step 6: project_dir is required on spawn per Spec S03.
                let project_dir_str =
                    parsed.project_dir.ok_or(ControlError::InvalidProjectDir {
                        reason: "missing_project_dir",
                    })?;
                self.do_spawn_session(
                    &parsed.card_id,
                    parsed.tug_session_id,
                    project_dir_str,
                    parsed.session_mode,
                    client_id,
                )
                .await
            }
            "close_session" => {
                let parsed = parse_control_payload_owned(payload).inspect_err(|e| {
                    warn!(action, error = %e, "handle_control: rejected close_session");
                })?;
                self.do_close_session(&parsed.card_id, &parsed.tug_session_id, client_id)
                    .await;
                Ok(())
            }
            "reset_session" => {
                let parsed = parse_control_payload_owned(payload).inspect_err(|e| {
                    warn!(action, error = %e, "handle_control: rejected reset_session");
                })?;
                // W2 [D11]: reset preserves the workspace binding. We do NOT
                // close-then-spawn here because that would release the
                // workspace and (potentially) tear down its feeds.
                self.do_reset_session(&parsed.card_id, &parsed.tug_session_id, client_id)
                    .await;
                Ok(())
            }
            other => {
                warn!(action = other, "handle_control: unknown action, ignoring");
                Ok(())
            }
        }
    }

    async fn do_spawn_session(
        &self,
        card_id: &str,
        tug_session_id: TugSessionId,
        project_dir_str: String,
        session_mode: SessionMode,
        client_id: ClientId,
    ) -> Result<(), ControlError> {
        let project_dir = PathBuf::from(&project_dir_str);
        tracing::info!(
            target: "tide::session-lifecycle",
            event = "spawn.supervisor_recv",
            card_id = card_id,
            tug_session_id = %tug_session_id,
            project_dir = %project_dir_str,
            session_mode = session_mode.as_wire_str(),
        );

        // Phase 0 (W2 Step 6): validate + canonicalize + acquire workspace.
        // This must happen before we touch the ledger so validation errors
        // short-circuit with no ledger or client_sessions mutation. On
        // success the workspace refcount is bumped by 1; every error path
        // below that returns after this point must release the extra
        // refcount before returning ([D05]).
        let workspace_entry = self
            .registry
            .get_or_create(&project_dir, self.cancel.clone())
            .map_err(|e| match e {
                WorkspaceError::InvalidProjectDir { reason, .. } => {
                    warn!(
                        card_id,
                        session = %tug_session_id,
                        path = ?project_dir,
                        reason,
                        "spawn_session: invalid project_dir"
                    );
                    ControlError::InvalidProjectDir { reason }
                }
                WorkspaceError::UnknownKey(_) => {
                    unreachable!("get_or_create never returns UnknownKey")
                }
            })?;
        let workspace_key = workspace_entry.workspace_key.clone();
        drop(workspace_entry);

        // Phase 1: ledger get-or-insert + per-client affinity insert, atomic
        // under the outer ledger lock AND the client_sessions lock. Holding
        // both together closes the TOCTOU window per [R06] — a concurrent
        // close cannot interleave between the ledger insert and the
        // client_sessions insert. Lock order invariant: ledger first, then
        // client_sessions; applied everywhere in this module.
        //
        // If the ledger already has an entry for this tug_session_id (a
        // reconnect), the or_insert_with closure does not run and we
        // reuse the existing entry. In that case the workspace refcount
        // bumped in Phase 0 is excess and must be released (the existing
        // ledger entry already holds its own refcount).
        //
        // P13: for fresh inserts only, enforce `max_concurrent_sessions`
        // (counting Spawning+Live entries via try_lock) and the
        // `max_spawns_per_minute` leaky bucket. Both checks run inside
        // the ledger critical section so the decision is atomic with the
        // insert. Reconnects bypass — the existing entry is already
        // counted and re-inserting it would not produce a new subprocess.
        let phase1 = {
            let mut ledger = self.ledger.lock().await;
            let was_inserted = !ledger.contains_key(&tug_session_id);
            if was_inserted {
                if let Some(reason) = cap_check_reason(
                    &ledger,
                    self.config.max_concurrent_sessions,
                    &self.spawn_timestamps,
                    self.config.max_spawns_per_minute,
                ) {
                    drop(ledger);
                    // Release the workspace refcount acquired in Phase 0;
                    // the ledger never saw this entry so no later Phase
                    // will release it for us.
                    if let Err(e) = self.registry.release(&workspace_key) {
                        warn!(
                            card_id,
                            session = %tug_session_id,
                            error = %e,
                            "spawn_session: cap-reject workspace release failed (ignored)"
                        );
                    }
                    // Broadcast SESSION_STATE errored so any observer of
                    // this session sees the failure, not just the client
                    // whose CONTROL frame we're about to reject.
                    let _ = self.session_state_tx.send(build_session_state_frame(
                        &tug_session_id,
                        "errored",
                        Some(reason),
                    ));
                    warn!(
                        card_id,
                        session = %tug_session_id,
                        reason,
                        "spawn_session: rejected by spawn budget"
                    );
                    return Err(ControlError::CapExceeded { reason });
                }
            }
            let arc = ledger
                .entry(tug_session_id.clone())
                .or_insert_with(|| {
                    Arc::new(Mutex::new(LedgerEntry::new(
                        tug_session_id.clone(),
                        workspace_key.clone(),
                        project_dir.clone(),
                        session_mode,
                        CrashBudget::new(3, Duration::from_secs(60)),
                    )))
                })
                .clone();
            let mut cs = self.client_sessions.lock().await;
            cs.entry(client_id)
                .or_default()
                .insert(tug_session_id.clone());
            (arc, was_inserted)
        };
        let (entry_arc, inserted) = phase1;

        if !inserted {
            // Reconnect: the existing ledger entry already holds a refcount
            // on whatever workspace it was bound to; drop the one we just
            // acquired.
            if let Err(e) = self.registry.release(&workspace_key) {
                warn!(
                    card_id,
                    session = %tug_session_id,
                    error = %e,
                    "spawn_session: reconnect release returned error (ignored)"
                );
            }
        }

        // Phase 2: strict tugbank write per [D12]. Partial ledger/
        // client_sessions state on failure is tolerable (rewritten on retry);
        // silent failure is not.
        let record = SessionKeyRecord {
            tug_session_id: tug_session_id.as_str().to_string(),
            project_dir: Some(project_dir_str.clone()),
            claude_session_id: None,
        };
        if let Err(e) = self.store.set_session_record(card_id, &record) {
            warn!(
                card_id,
                session = %tug_session_id,
                error = %e.0,
                "spawn_session: tugbank write failed"
            );
            // Release the workspace refcount we acquired in Phase 0, but
            // only if we inserted a new ledger entry (for a reconnect we
            // already released above).
            if inserted {
                let _ = self.registry.release(&workspace_key);
            }
            return Err(ControlError::PersistenceFailure(e.0));
        }

        // Phase 3: per-session mutation + publish + replay, under the
        // per-session lock. Reconnect flows observe the existing entry and
        // its `latest_metadata`; fresh flows observe a just-minted Idle
        // entry with `latest_metadata: None`.
        let replay_frame = {
            let entry = entry_arc.lock().await;
            entry.latest_metadata.clone()
        };

        let _ =
            self.session_state_tx
                .send(build_session_state_frame(&tug_session_id, "pending", None));

        if let Some(frame) = replay_frame {
            let _ = self.session_metadata_tx.send(frame);
        }

        // Spec S03: the CONTROL success ack echoes the canonical
        // `workspace_key` so tugdeck can stamp it into the per-card binding
        // store without attempting client-side canonicalization (which
        // would miss macOS firmlinks). W1 had no explicit ack frame on this
        // code path — a successful `spawn_session` simply returned Ok(())
        // and the wire observation was the subsequent `pending`/`spawning`
        // SESSION_STATE transitions. Emitting the ack as an explicit CONTROL
        // frame here lets tugdeck's spawn-session handler populate the
        // binding store in the same round-trip.
        // Roadmap step 4.5: the ack also echoes `session_mode` so tugdeck's
        // `cardSessionBindingStore` stamps the user's new-vs-resume choice
        // into the binding. Pre-4.5 clients ignore the extra field.
        //
        // For reconnects (entry already existed), echo the mode the ledger
        // *already* holds — not the one the incoming payload carried —
        // because the running tugcode subprocess was spawned with the
        // original mode and silently switching it client-side would
        // misrepresent live state.
        let effective_mode = if inserted {
            session_mode
        } else {
            entry_arc.lock().await.session_mode
        };
        let ack = serde_json::json!({
            "action": "spawn_session_ok",
            "card_id": card_id,
            "tug_session_id": tug_session_id.as_str(),
            "workspace_key": workspace_key.as_ref(),
            // Echo the pre-canonical path the client sent so tugdeck's
            // binding store carries the form the user actually chose.
            // The filter identity comes from `workspace_key`, not this
            // field — `project_dir` is informational for UI display.
            "project_dir": project_dir_str,
            "session_mode": effective_mode.as_wire_str(),
        });
        let _ = self.control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&ack).expect("spawn_session_ok serializes"),
        ));

        Ok(())
    }

    async fn do_close_session(
        &self,
        card_id: &str,
        tug_session_id: &TugSessionId,
        _client_id: ClientId,
    ) {
        // Phase 1: remove the ledger entry AND drop the id from every client's
        // affinity set, atomically under ledger_lock + client_sessions_lock.
        // Cleaning across all clients (not just `_client_id`) guarantees the
        // close/spawn race test's self-consistency invariant: after a close,
        // NO client_sessions set references the removed id. An unknown id
        // short-circuits here with no side effects (no tugbank interaction,
        // no SESSION_STATE publish, no lock on `client_sessions`).
        let entry_arc = {
            let mut ledger = self.ledger.lock().await;
            let removed = ledger.remove(tug_session_id);
            if removed.is_some() {
                let mut cs = self.client_sessions.lock().await;
                for set in cs.values_mut() {
                    set.remove(tug_session_id);
                }
            }
            removed
        };

        let Some(entry_arc) = entry_arc else {
            return;
        };

        // Phase 2: per-session mutation. Cancel the worker token AND flip
        // `spawn_state` to `Closed`. Flipping the state matters even though
        // the entry has just been removed from the map: a `spawn_session_worker`
        // that raced us — dispatcher flipped `Idle → Spawning`, called
        // `spawn_session_worker`, and the worker grabbed its own `Arc` clone
        // via `ledger.get(id)` BEFORE our `HashMap::remove` — is still
        // holding an `Arc<Mutex<LedgerEntry>>` clone and would otherwise
        // observe `spawn_state == Spawning` and proceed to publish
        // `SESSION_STATE = spawning` AFTER our `closed`. Setting the state to
        // `Closed` here lets the worker's early-bail check (`if state !=
        // Spawning { return }`) catch the close and skip its publish,
        // preserving frame order on the wire.
        //
        // Also snapshot the `workspace_key` under this same lock so Phase 3
        // can call `registry.release` without re-acquiring it.
        let workspace_key = {
            let mut entry = entry_arc.lock().await;
            entry.cancel.cancel();
            // Bare assignment (not `try_transition`) because the entry is
            // about to be dropped; we only care that any Arc-clone holder
            // observes `Closed` on its next lock acquire.
            entry.spawn_state = SpawnState::Closed;
            entry.workspace_key.clone()
        };

        // Phase 3: release the workspace refcount. Errors on this path
        // (e.g. `UnknownKey` from a double-close race) are logged and
        // swallowed — they indicate a caller-side logic error, not a
        // condition worth propagating to the wire.
        if let Err(e) = self.registry.release(&workspace_key) {
            warn!(
                card_id,
                session = %tug_session_id,
                error = %e,
                "close_session: workspace release failed, continuing"
            );
        }

        // Phase 4: best-effort tugbank delete per [D12]. Lingering entries
        // are benign; a warn! is the loudest signal we want on this path.
        if let Err(e) = self.store.delete_session_key(card_id) {
            warn!(
                card_id,
                session = %tug_session_id,
                error = %e.0,
                "close_session: tugbank delete failed, continuing"
            );
        }

        // Phase 5: publish `closed`. (The `Arc<Mutex<LedgerEntry>>` we hold
        // is dropped at the end of this scope.)
        let _ =
            self.session_state_tx
                .send(build_session_state_frame(tug_session_id, "closed", None));
    }

    /// Handle a `reset_session` CONTROL action.
    ///
    /// [D11]: reset preserves the workspace binding. We kill the current
    /// tugcode bridge (so a hung or misbehaving subprocess is torn down)
    /// but do NOT call `registry.release` or `registry.get_or_create`.
    /// The ledger entry stays in place — same `workspace_key`, same
    /// `project_dir`, same crash budget, same latest_metadata replay — so
    /// that the user's workspace feeds (file watcher, git poller) are
    /// never observably interrupted.
    ///
    /// On the wire we publish `closed` then `pending`, matching the
    /// historical close-then-spawn shape. The subsequent `spawning` /
    /// `live` frames are published by `spawn_session_worker` when the
    /// next CODE_INPUT frame arrives and the dispatcher transitions
    /// `Idle → Spawning`.
    async fn do_reset_session(
        &self,
        _card_id: &str,
        tug_session_id: &TugSessionId,
        _client_id: ClientId,
    ) {
        let entry_arc = {
            let ledger = self.ledger.lock().await;
            match ledger.get(tug_session_id) {
                Some(e) => e.clone(),
                None => return,
            }
        };

        // Cancel the current bridge worker and reset the per-session
        // state so the next CODE_INPUT can re-drive Idle → Spawning. The
        // workspace_key, project_dir, crash_budget, and latest_metadata
        // fields are intentionally preserved.
        //
        // Terminal-state guard: if a concurrent `close_session` won the
        // race and flipped the entry to `Closed`, reset must not
        // resurrect it. Bail out silently — the caller's reset is
        // meaningless for a dead session, and flipping back to `Idle`
        // would confuse any worker that later observed the stale Arc.
        let resurrected = {
            let mut entry = entry_arc.lock().await;
            if entry.spawn_state == SpawnState::Closed {
                false
            } else {
                entry.cancel.cancel();
                entry.cancel = CancellationToken::new();
                entry.spawn_state = SpawnState::Idle;
                entry.input_tx = None;
                true
            }
        };
        if !resurrected {
            return;
        }

        let _ =
            self.session_state_tx
                .send(build_session_state_frame(tug_session_id, "closed", None));
        let _ =
            self.session_state_tx
                .send(build_session_state_frame(tug_session_id, "pending", None));
    }

    /// CODE_INPUT dispatcher task. Consumes CODE_INPUT frames from a single
    /// mpsc receiver (fed by the router in Step 8), parses `tug_session_id`,
    /// and routes each frame based on the ledger entry's `SpawnState`.
    pub async fn dispatcher_task(self: Arc<Self>, mut rx: mpsc::Receiver<Frame>) {
        while let Some(frame) = rx.recv().await {
            self.dispatch_one(frame).await;
        }
    }

    /// Dispatch a single CODE_INPUT frame. Extracted from `dispatcher_task` so
    /// tests can exercise the routing logic without spinning up a task + mpsc.
    pub async fn dispatch_one(&self, frame: Frame) {
        // Extract `tug_session_id` from the payload.
        let tug_session_id = match parse_tug_session_id(&frame.payload) {
            Some(id) => TugSessionId::new(id),
            None => {
                warn!("dispatcher: CODE_INPUT frame missing tug_session_id, dropping");
                return;
            }
        };

        // Look up the ledger entry.
        let entry_arc = {
            let ledger = self.ledger.lock().await;
            ledger.get(&tug_session_id).cloned()
        };

        let Some(entry_arc) = entry_arc else {
            // No intent record — the client must `spawn_session` via CONTROL
            // before sending CODE_INPUT.
            let _ = self
                .control_tx
                .send(build_session_unknown_frame(&tug_session_id));
            return;
        };

        // Decide the routing action under the per-session lock. We extract
        // the decision and release the lock before doing any await-heavy
        // work (mpsc send, broadcast publish, spawn_session_worker).
        let decision: Decision = {
            let mut entry = entry_arc.lock().await;
            match entry.spawn_state {
                SpawnState::Idle => {
                    // This thread owns the Idle → Spawning transition per
                    // [R02]. Transition, queue the frame for the worker,
                    // and tell the caller to spawn.
                    entry.spawn_state.try_transition(SpawnState::Spawning).ok();
                    // Idle-entry invariant: the queue is freshly minted
                    // empty, so push always succeeds. If this ever fails
                    // we've bungled the invariant and the frame would be
                    // silently dropped — log loudly rather than panic.
                    match entry.queue.push(frame) {
                        QueuePush::Ok => {}
                        QueuePush::Overflow => {
                            tracing::error!(
                                session = %tug_session_id,
                                "BUG: Idle ledger entry had a non-empty queue on first CODE_INPUT"
                            );
                        }
                    }
                    Decision::Spawn
                }
                SpawnState::Spawning => {
                    // Buffer the frame until the worker drains.
                    match entry.queue.push(frame) {
                        QueuePush::Ok => Decision::Drop,
                        QueuePush::Overflow => Decision::Backpressure,
                    }
                }
                SpawnState::Live => {
                    if let Some(tx) = entry.input_tx.clone() {
                        Decision::Forward(tx, frame)
                    } else {
                        warn!("dispatcher: Live state but no input_tx set");
                        drop(frame);
                        Decision::Drop
                    }
                }
                SpawnState::Errored | SpawnState::Closed => {
                    warn!(
                        state = ?entry.spawn_state,
                        "dispatcher: dropping frame in terminal state"
                    );
                    drop(frame);
                    Decision::Drop
                }
            }
        };

        match decision {
            Decision::Drop => {}
            Decision::Spawn => self.spawn_session_worker(&tug_session_id).await,
            Decision::Forward(tx, frame) => {
                let _ = tx.send(frame).await;
            }
            Decision::Backpressure => {
                let _ = self
                    .control_tx
                    .send(build_backpressure_frame(&tug_session_id));
            }
        }
    }

    /// Per-bridge merger task. Consumes registrations from
    /// `merger_register_rx` and fans in each per-session output mpsc into
    /// the shared CODE_OUTPUT broadcast, the SESSION_METADATA broadcast
    /// ([D14]), and `LedgerEntry::latest_metadata` (per-session). Runs until
    /// `cancel` is fired OR the register channel closes AND every
    /// per-session stream has drained.
    pub async fn merger_task(
        self: Arc<Self>,
        mut register_rx: mpsc::Receiver<MergerRegistration>,
        cancel: CancellationToken,
    ) {
        use tokio_stream::StreamMap;
        let mut streams: StreamMap<TugSessionId, ReceiverStream<Frame>> = StreamMap::new();
        // Once `register_rx` yields `None` (all senders dropped), we disable
        // that select arm so it doesn't spin-return on every iteration. If
        // all per-session streams have also drained by that point the task
        // exits cleanly; otherwise it keeps servicing in-flight streams
        // until they close.
        let mut register_closed = false;
        loop {
            if register_closed && streams.is_empty() {
                return;
            }
            tokio::select! {
                _ = cancel.cancelled() => return,
                maybe_register = register_rx.recv(), if !register_closed => {
                    match maybe_register {
                        Some((id, rx)) => {
                            streams.insert(id, ReceiverStream::new(rx));
                        }
                        None => {
                            // Register side dropped — disable the arm and
                            // fall through. Existing streams continue to
                            // drain; the top-of-loop guard exits once they
                            // are all gone.
                            register_closed = true;
                        }
                    }
                }
                maybe_frame = streams.next(), if !streams.is_empty() => {
                    let Some((id, frame)) = maybe_frame else { continue };
                    // Forward to shared CODE_OUTPUT broadcast (feeds the
                    // shared router-level replay ring per [D06], unchanged).
                    // The inbound frame is already tagged `CODE_OUTPUT` by
                    // `relay_session_io` so this send passes through
                    // unchanged.
                    let _ = self.code_output_tx.send(frame.clone());
                    // Per-session system_metadata capture + broadcast per
                    // [D14]. CRITICAL: rewrap as `FeedId::SESSION_METADATA`
                    // before publishing / storing. `Frame::encode()`
                    // serializes `Frame.feed_id` as the first wire byte, so
                    // a subscriber registered via
                    // `register_stream(FeedId::SESSION_METADATA, ...)`
                    // would otherwise receive a frame tagged CODE_OUTPUT and
                    // route it to the wrong client-side store. Both the
                    // live publish AND the `latest_metadata` slot used by
                    // event-driven replay in `do_spawn_session` must hold
                    // the SESSION_METADATA-tagged Frame.
                    if is_system_metadata(&frame.payload) {
                        let meta_frame =
                            Frame::new(FeedId::SESSION_METADATA, frame.payload.clone());
                        let entry_arc = {
                            let ledger = self.ledger.lock().await;
                            ledger.get(&id).cloned()
                        };
                        if let Some(entry_arc) = entry_arc {
                            let mut entry = entry_arc.lock().await;
                            entry.latest_metadata = Some(meta_frame.clone());
                        }
                        let _ = self.session_metadata_tx.send(meta_frame);
                    }
                }
            }
        }
    }

    /// Spawn the per-session agent bridge. Creates per-session stdin/stdout
    /// mpscs, registers the output rx with the merger, installs `input_tx`
    /// in the ledger entry, and launches [`run_session_bridge`] in a
    /// detached tokio task. The bridge task supervises the subprocess
    /// lifecycle (handshake, crash budget, splice stamping) per [D07].
    ///
    /// # Ledger state transitions
    ///
    /// Unlike Step 5's scaffold, this function does **not** promote the
    /// ledger entry to `SpawnState::Live`. The state stays at `Spawning`
    /// until the bridge reads `session_init` from the subprocess — at that
    /// point the bridge itself performs the atomic promote (flip state,
    /// drain the per-session queue into `input_tx`, publish the wire
    /// `SESSION_STATE = live` frame) inside a single ledger-entry lock
    /// acquisition. This keeps ledger `Live` and wire `live` semantically
    /// identical ("handshake succeeded and Claude reported its session_id")
    /// and eliminates the window where the dispatcher could forward frames
    /// to an un-handshaken subprocess through a bridge that had not yet
    /// started pumping stdin.
    ///
    /// While the state is `Spawning`, the dispatcher's `Spawning` branch
    /// buffers CODE_INPUT into `LedgerEntry::queue`. The bridge's
    /// `session_init` promote drains that queue into `input_tx` atomically
    /// with the state flip, so frame order is preserved across the
    /// transition.
    ///
    /// # Ordering invariant
    ///
    /// 1. Lookup the ledger entry.
    /// 2. Register the per-session output receiver with the merger.
    /// 3. *Only then* install `input_tx`.
    ///
    /// Step 3 must not run before step 2: if the merger has died and the
    /// register send fails after `input_tx` is installed, the dispatcher
    /// would happily forward frames into a Sender whose Receiver is owned
    /// by nothing. Registering first means a dead merger is detected
    /// before any visible ledger state is mutated.
    pub async fn spawn_session_worker(&self, tug_session_id: &TugSessionId) {
        let entry_arc = {
            let map = self.ledger.lock().await;
            match map.get(tug_session_id) {
                Some(e) => e.clone(),
                None => return,
            }
        };

        let (input_tx, input_rx) = mpsc::channel::<Frame>(256);
        let (merger_per_session_tx, merger_per_session_rx) = mpsc::channel::<Frame>(256);

        // Step 2: register the per-session output receiver with the merger
        // BEFORE touching ledger state. A dead merger is detected here and
        // short-circuits the spawn with no ledger mutation — preventing
        // the B2-class bug where a failed register would leave `input_tx`
        // set against a Receiver that no merger owns.
        if self
            .merger_register_tx
            .send((tug_session_id.clone(), merger_per_session_rx))
            .await
            .is_err()
        {
            warn!(
                session = %tug_session_id,
                "merger register channel closed; flipping session to errored"
            );
            // Transition the entry out of Spawning so subsequent CODE_INPUT
            // drops (via the dispatcher's terminal-state branch) rather
            // than stalls forever in the queue.
            let mut entry = entry_arc.lock().await;
            if entry.spawn_state == SpawnState::Spawning {
                entry.spawn_state = SpawnState::Errored;
                drop(entry);
                let _ = self.session_state_tx.send(build_session_state_frame(
                    tug_session_id,
                    "errored",
                    Some("merger_unavailable"),
                ));
            }
            return;
        }

        // Step 3: install the dispatcher-side sender and clone the
        // cancellation token. Do **not** drain the queue or transition to
        // Live — that's the bridge's job on `session_init` (see above).
        let cancel_for_bridge = {
            let mut entry = entry_arc.lock().await;
            if entry.spawn_state != SpawnState::Spawning {
                // Another task already handled the transition (or the
                // entry was closed out from under us). The stream we just
                // registered is orphaned — when `merger_per_session_tx`
                // drops at end of function, the merger's ReceiverStream
                // will yield None and be auto-removed from the StreamMap.
                return;
            }
            entry.input_tx = Some(input_tx.clone());
            entry.cancel.clone()
        };
        // `input_tx` is stashed in the ledger entry; the bridge drains it
        // via the per-session queue on session_init. Drop our local clone
        // so only the dispatcher owns the send side after this point.
        drop(input_tx);

        let _ =
            self.session_state_tx
                .send(build_session_state_frame(tug_session_id, "spawning", None));

        // Launch the real bridge in a detached task.
        let spawner = (self.spawner_factory)();
        let state_tx = self.session_state_tx.clone();
        let tug_session_id_owned = tug_session_id.clone();
        let entry_arc_bridge = entry_arc.clone();
        // Per-session workspace path. Read from the ledger entry so
        // each session's tugcode subprocess gets its own cwd. Also
        // thread `session_mode` so the tugcode subprocess receives
        // `--session-mode new|resume`. The sessions recorder lets the
        // bridge upsert/remove the per-session record in tugbank when
        // it sees `session_init` / `resume_failed` on the IPC stream.
        let (project_dir, session_mode) = {
            let entry = entry_arc.lock().await;
            (entry.project_dir.clone(), entry.session_mode)
        };
        let sessions_recorder = self.sessions_recorder.clone();
        tokio::spawn(async move {
            run_session_bridge(
                tug_session_id_owned,
                entry_arc_bridge,
                input_rx,
                merger_per_session_tx,
                state_tx,
                spawner,
                project_dir,
                session_mode,
                sessions_recorder,
                cancel_for_bridge,
                DEFAULT_RETRY_DELAY,
            )
            .await;
        });
    }

    /// Drop per-client affinity state on WebSocket teardown. Does NOT touch
    /// ledger state or tugbank — a client disconnecting is not a session
    /// close.
    pub async fn on_client_disconnect(&self, client_id: ClientId) {
        let mut cs = self.client_sessions.lock().await;
        cs.remove(&client_id);
    }

    /// Re-materialize ledger entries from persisted tugbank state.
    ///
    /// Called once at startup from `main.rs`. Reads every
    /// `(card_id, tug_session_id)` pair stored in the
    /// [`SESSION_KEYS_DOMAIN`] and inserts a fresh `Idle` [`LedgerEntry`]
    /// for each `tug_session_id` that is not already present in the ledger.
    /// Returns the number of entries that were newly inserted.
    ///
    /// Per [F15] this path does **not**:
    ///
    /// - touch `client_sessions` — the rebind has no WebSocket client, so
    ///   any sentinel `ClientId` inserted here would be a permanent ghost
    ///   with no cleanup trigger. Real clients connecting after startup
    ///   send their own `spawn_session` CONTROL frames via [D14]'s normal
    ///   flow, which populate `client_sessions` for the real client_id.
    /// - write to or delete from tugbank — the helper is strictly read-only.
    /// - publish any `SESSION_STATE` frames — the rebound entries are
    ///   unobservable until a real client subsequently calls `spawn_session`
    ///   for one of them, at which point the existing entry is reused and
    ///   the normal `pending` publish fires.
    pub async fn rebind_from_tugbank(&self) -> Result<usize, SessionKeysStoreError> {
        let entries = self.store.list_session_records()?;
        let mut inserted = 0usize;
        // We acquire workspaces via `registry.get_or_create` outside the
        // ledger mutex (it takes its own std::sync::Mutex internally), so
        // we can't hold the ledger across the loop. Iterate per-record:
        // validate → get_or_create → lock ledger briefly → insert.
        for (card_id, record) in entries {
            // [D03]: drop records without a workspace binding. Pre-W2
            // records have `project_dir == None`; they can't be rebound
            // without losing the end-to-end workspace isolation guarantee.
            // Log the drop but do not propagate an error — this is a
            // one-time migration event, not a fault condition.
            let Some(project_dir_str) = record.project_dir.clone() else {
                warn!(
                    card_id,
                    tug_session_id = %record.tug_session_id,
                    "rebind: dropping pre-W2 record with no project_dir"
                );
                continue;
            };
            let project_dir = PathBuf::from(&project_dir_str);

            // Validate + acquire the workspace for this record. Invalid
            // paths (nonexistent / not-a-directory / permission-denied)
            // are logged and skipped — the user may have removed or
            // renamed the project directory between runs.
            let workspace_entry = match self
                .registry
                .get_or_create(&project_dir, self.cancel.clone())
            {
                Ok(e) => e,
                Err(WorkspaceError::InvalidProjectDir { reason, .. }) => {
                    warn!(
                        card_id,
                        tug_session_id = %record.tug_session_id,
                        path = ?project_dir,
                        reason,
                        "rebind: dropping record with invalid project_dir"
                    );
                    continue;
                }
                Err(WorkspaceError::UnknownKey(_)) => {
                    unreachable!("get_or_create never returns UnknownKey")
                }
            };
            let workspace_key = workspace_entry.workspace_key.clone();
            drop(workspace_entry);

            let tug_session_id = TugSessionId::new(record.tug_session_id);

            // Insert the ledger entry — or, if one already exists (this
            // function is idempotent per [F15]), release the workspace
            // refcount we just acquired and skip.
            let mut ledger = self.ledger.lock().await;
            if ledger.contains_key(&tug_session_id) {
                drop(ledger);
                let _ = self.registry.release(&workspace_key);
                continue;
            }
            // Rebind predates the user's 4.5 resume choice — the tugbank
            // record doesn't carry `session_mode`. The rebound Idle entry
            // will not acquire a subprocess until a real client later
            // sends `spawn_session` for it; that path's reconnect branch
            // reuses the existing mode (since `or_insert_with` does not
            // fire for an existing key), so this `New` default is what
            // the rebound session will run with. `New` is the safe
            // default — [4.6](../../../../roadmap/tugplan-tide-card.md#step-4-6)
            // moves session metadata onto a purpose-built ledger and can
            // preserve the user's recorded choice across restarts.
            let entry = LedgerEntry::new(
                tug_session_id.clone(),
                workspace_key,
                project_dir,
                SessionMode::New,
                CrashBudget::new(3, Duration::from_secs(60)),
            );
            ledger.insert(tug_session_id, Arc::new(Mutex::new(entry)));
            inserted += 1;
        }
        Ok(inserted)
    }
}

// ---------------------------------------------------------------------------
// Crate-visible test helpers — available to other modules' #[cfg(test)] code.
// ---------------------------------------------------------------------------

/// Minimal no-op [`SessionsRecorder`] for tests that don't care about the
/// per-session record. Production uses [`TugbankSessionsRecorder`].
#[cfg(test)]
pub(crate) struct NoopSessionsRecorder;

#[cfg(test)]
impl SessionsRecorder for NoopSessionsRecorder {
    fn record(&self, _session_id: &str, _project_dir: &str) {}
    fn remove(&self, _session_id: &str) {}
}

/// Minimal in-memory [`SessionKeysStore`] used by cross-module router tests.
/// Gated on `#[cfg(test)]` so it is not compiled into production builds.
#[cfg(test)]
pub(crate) struct NoopSessionKeysStore;

#[cfg(test)]
impl SessionKeysStore for NoopSessionKeysStore {
    fn set_session_record(
        &self,
        _card_id: &str,
        _record: &SessionKeyRecord,
    ) -> Result<(), SessionKeysStoreError> {
        Ok(())
    }
    fn delete_session_key(&self, _card_id: &str) -> Result<(), SessionKeysStoreError> {
        Ok(())
    }
    fn list_session_records(
        &self,
    ) -> Result<Vec<(String, SessionKeyRecord)>, SessionKeysStoreError> {
        Ok(Vec::new())
    }
}

/// Construct an [`AgentSupervisor`] with stub channels, a no-op session
/// keys store, and a panic-on-call spawner factory. Returns the supervisor
/// wrapped in `Arc` plus its merger register receiver (which the caller
/// should either spawn `merger_task` against or drain to keep the register
/// channel alive). Used by router tests that need to exercise CONTROL
/// interception or client-disconnect hooks without constructing a full
/// subprocess pipeline.
#[cfg(test)]
pub(crate) fn test_minimal_supervisor() -> (Arc<AgentSupervisor>, mpsc::Receiver<MergerRegistration>)
{
    let (state_tx, _) = broadcast::channel(16);
    let (meta_tx, _) = broadcast::channel(16);
    let (code_tx, _) = broadcast::channel(16);
    let (control_tx, _) = broadcast::channel(16);
    let factory: SpawnerFactory =
        Arc::new(|| unreachable!("test_minimal_supervisor has no spawner"));
    let store: Arc<dyn SessionKeysStore> = Arc::new(NoopSessionKeysStore);
    let recorder: Arc<dyn SessionsRecorder> = Arc::new(NoopSessionsRecorder);
    let registry = Arc::new(WorkspaceRegistry::new());
    let cancel = CancellationToken::new();
    let (sup, register_rx) = AgentSupervisor::new(
        state_tx,
        meta_tx,
        code_tx,
        control_tx,
        store,
        recorder,
        factory,
        AgentSupervisorConfig::default(),
        registry,
        cancel,
    );
    (Arc::new(sup), register_rx)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::pending;
    use std::sync::Mutex as StdMutex;

    use super::super::agent_bridge::{
        RelayOutcome, SessionChild, SpawnFuture, relay_session_io, run_session_bridge,
    };

    // ---- Test-only ChildSpawner fakes ----

    /// Spawner that never resolves. Used as the default in tests so
    /// `spawn_session_worker` installs the per-session plumbing + publishes
    /// `SESSION_STATE = spawning` without the bridge task emitting any
    /// further frames. Any test that needs a specific bridge behavior passes
    /// its own spawner via [`make_supervisor_with_spawner`].
    struct StallSpawner;
    impl ChildSpawner for StallSpawner {
        fn spawn_child(
            &self,
            _project_dir: &std::path::Path,
            _session_id: &str,
            _session_mode: SessionMode,
        ) -> SpawnFuture {
            Box::pin(async { pending::<std::io::Result<SessionChild>>().await })
        }
    }

    fn stall_spawner_factory() -> SpawnerFactory {
        Arc::new(|| Arc::new(StallSpawner) as Arc<dyn ChildSpawner>)
    }

    // ---- Test-only SessionKeysStore fakes ----

    #[derive(Default)]
    struct InMemoryStore {
        entries: StdMutex<HashMap<String, SessionKeyRecord>>,
        set_calls: StdMutex<u32>,
        delete_calls: StdMutex<u32>,
    }

    impl InMemoryStore {
        fn entries_snapshot(&self) -> HashMap<String, SessionKeyRecord> {
            self.entries.lock().unwrap().clone()
        }
        fn set_call_count(&self) -> u32 {
            *self.set_calls.lock().unwrap()
        }
        fn delete_call_count(&self) -> u32 {
            *self.delete_calls.lock().unwrap()
        }
    }

    impl SessionKeysStore for InMemoryStore {
        fn set_session_record(
            &self,
            card_id: &str,
            record: &SessionKeyRecord,
        ) -> Result<(), SessionKeysStoreError> {
            *self.set_calls.lock().unwrap() += 1;
            self.entries
                .lock()
                .unwrap()
                .insert(card_id.to_string(), record.clone());
            Ok(())
        }
        fn delete_session_key(&self, card_id: &str) -> Result<(), SessionKeysStoreError> {
            *self.delete_calls.lock().unwrap() += 1;
            self.entries.lock().unwrap().remove(card_id);
            Ok(())
        }
        fn list_session_records(
            &self,
        ) -> Result<Vec<(String, SessionKeyRecord)>, SessionKeysStoreError> {
            Ok(self
                .entries
                .lock()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect())
        }
    }

    struct FailingWriteStore {
        delegate: InMemoryStore,
    }

    impl FailingWriteStore {
        fn new() -> Self {
            Self {
                delegate: InMemoryStore::default(),
            }
        }
    }

    impl SessionKeysStore for FailingWriteStore {
        fn set_session_record(
            &self,
            _card_id: &str,
            _record: &SessionKeyRecord,
        ) -> Result<(), SessionKeysStoreError> {
            Err(SessionKeysStoreError("injected write failure".into()))
        }
        fn delete_session_key(&self, card_id: &str) -> Result<(), SessionKeysStoreError> {
            self.delegate.delete_session_key(card_id)
        }
        fn list_session_records(
            &self,
        ) -> Result<Vec<(String, SessionKeyRecord)>, SessionKeysStoreError> {
            self.delegate.list_session_records()
        }
    }

    struct FailingDeleteStore {
        delegate: InMemoryStore,
    }

    impl FailingDeleteStore {
        fn new() -> Self {
            Self {
                delegate: InMemoryStore::default(),
            }
        }
    }

    impl SessionKeysStore for FailingDeleteStore {
        fn set_session_record(
            &self,
            card_id: &str,
            record: &SessionKeyRecord,
        ) -> Result<(), SessionKeysStoreError> {
            self.delegate.set_session_record(card_id, record)
        }
        fn delete_session_key(&self, _card_id: &str) -> Result<(), SessionKeysStoreError> {
            Err(SessionKeysStoreError("injected delete failure".into()))
        }
        fn list_session_records(
            &self,
        ) -> Result<Vec<(String, SessionKeyRecord)>, SessionKeysStoreError> {
            self.delegate.list_session_records()
        }
    }

    // ---- Test helpers ----

    /// Shared valid directory for tests that need *some* `project_dir`
    /// but don't care which. `env!("CARGO_MANIFEST_DIR")` resolves at
    /// compile time to the crate root (`tugrust/crates/tugcast`), which
    /// always exists on every dev machine and in CI.
    fn test_project_dir() -> &'static str {
        env!("CARGO_MANIFEST_DIR")
    }

    fn make_supervisor_with_store(
        store: Arc<dyn SessionKeysStore>,
    ) -> (
        AgentSupervisor,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
    ) {
        make_supervisor_with_store_config(store, AgentSupervisorConfig::default())
    }

    /// Variant that accepts a custom [`AgentSupervisorConfig`] — P13 tests
    /// use this to set tight `max_concurrent_sessions` /
    /// `max_spawns_per_minute` so the cap can be tripped with only a
    /// handful of spawn calls.
    fn make_supervisor_with_store_config(
        store: Arc<dyn SessionKeysStore>,
        config: AgentSupervisorConfig,
    ) -> (
        AgentSupervisor,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
    ) {
        let ((sup, state_rx, meta_rx, control_rx), mut register_rx) =
            make_supervisor_with_spawner_config(store, stall_spawner_factory(), config);
        // Drain the merger register channel so `spawn_session_worker`'s
        // `merger_register_tx.send(...).await` succeeds without an actual
        // merger task attached. Dropping the receiver would short-circuit
        // the bridge wiring and suppress the `SESSION_STATE = spawning`
        // publish that existing tests rely on.
        tokio::spawn(async move { while register_rx.recv().await.is_some() {} });
        (sup, state_rx, meta_rx, control_rx)
    }

    /// Variant that also returns the merger register receiver so tests can
    /// spawn `merger_task` against it. The primary tuple still matches the
    /// original `make_supervisor_with_store` shape so existing tests compile
    /// unchanged after going through the thin wrapper above.
    #[allow(clippy::type_complexity)]
    fn make_supervisor_with_spawner(
        store: Arc<dyn SessionKeysStore>,
        spawner_factory: SpawnerFactory,
    ) -> (
        (
            AgentSupervisor,
            broadcast::Receiver<Frame>,
            broadcast::Receiver<Frame>,
            broadcast::Receiver<Frame>,
        ),
        mpsc::Receiver<MergerRegistration>,
    ) {
        make_supervisor_with_spawner_config(
            store,
            spawner_factory,
            AgentSupervisorConfig::default(),
        )
    }

    #[allow(clippy::type_complexity)]
    fn make_supervisor_with_spawner_config(
        store: Arc<dyn SessionKeysStore>,
        spawner_factory: SpawnerFactory,
        config: AgentSupervisorConfig,
    ) -> (
        (
            AgentSupervisor,
            broadcast::Receiver<Frame>,
            broadcast::Receiver<Frame>,
            broadcast::Receiver<Frame>,
        ),
        mpsc::Receiver<MergerRegistration>,
    ) {
        let (state_tx, state_rx) = broadcast::channel(512);
        let (meta_tx, meta_rx) = broadcast::channel(32);
        let (code_tx, _code_rx) = broadcast::channel(32);
        let (control_tx, control_rx) = broadcast::channel(512);
        let registry = Arc::new(WorkspaceRegistry::new());
        let cancel = CancellationToken::new();
        let recorder: Arc<dyn SessionsRecorder> = Arc::new(NoopSessionsRecorder);
        let (sup, register_rx) = AgentSupervisor::new(
            state_tx,
            meta_tx,
            code_tx,
            control_tx,
            store,
            recorder,
            spawner_factory,
            config,
            registry,
            cancel,
        );
        ((sup, state_rx, meta_rx, control_rx), register_rx)
    }

    fn spawn_payload(card_id: &str, tug_session_id: &str) -> Vec<u8> {
        spawn_payload_in(card_id, tug_session_id, test_project_dir())
    }

    fn spawn_payload_in(card_id: &str, tug_session_id: &str, project_dir: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "spawn_session",
            "card_id": card_id,
            "tug_session_id": tug_session_id,
            "project_dir": project_dir,
        }))
        .unwrap()
    }

    fn close_payload(card_id: &str, tug_session_id: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "close_session",
            "card_id": card_id,
            "tug_session_id": tug_session_id,
        }))
        .unwrap()
    }

    fn reset_payload(card_id: &str, tug_session_id: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "reset_session",
            "card_id": card_id,
            "tug_session_id": tug_session_id,
        }))
        .unwrap()
    }

    fn session_state_of(frame: &Frame) -> (String, String) {
        assert_eq!(frame.feed_id, FeedId::SESSION_STATE);
        let v: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        (
            v["tug_session_id"].as_str().unwrap().to_string(),
            v["state"].as_str().unwrap().to_string(),
        )
    }

    async fn insert_ledger_entry(
        sup: &AgentSupervisor,
        tug_session_id: &TugSessionId,
    ) -> Arc<Mutex<LedgerEntry>> {
        // W2 Step 6: LedgerEntry gained workspace_key + project_dir.
        // Tests that build a bare ledger entry use a synthetic key and
        // the shared fixture path — they don't exercise workspace
        // lifecycle, just per-session bookkeeping.
        let workspace_key = WorkspaceKey::from_test_str(test_project_dir());
        let entry = Arc::new(Mutex::new(LedgerEntry::new(
            tug_session_id.clone(),
            workspace_key,
            PathBuf::from(test_project_dir()),
            SessionMode::New,
            CrashBudget::new(3, Duration::from_secs(60)),
        )));
        sup.ledger
            .lock()
            .await
            .insert(tug_session_id.clone(), entry.clone());
        entry
    }

    fn fake_metadata_frame(tug_session_id: &str) -> Frame {
        let body = serde_json::json!({
            "type": "system_metadata",
            "tug_session_id": tug_session_id,
            "model": "claude-opus-4-6",
        });
        Frame::new(FeedId::SESSION_METADATA, serde_json::to_vec(&body).unwrap())
    }

    // ---- Existing scaffold tests ----

    #[test]
    fn test_bounded_queue_cap_256() {
        let q: BoundedQueue<u32> = BoundedQueue::new();
        assert_eq!(q.capacity(), 256);
        assert_eq!(BOUNDED_QUEUE_CAP, 256);
    }

    #[test]
    fn test_bounded_queue_overflow_signals() {
        let mut q: BoundedQueue<u32> = BoundedQueue::new();
        for i in 0..256u32 {
            assert_eq!(q.push(i), QueuePush::Ok, "item {i} should fit");
        }
        assert_eq!(q.len(), 256);
        // 257th push overflows.
        assert_eq!(q.push(9999), QueuePush::Overflow);
        assert_eq!(q.len(), 256);
        // Dropping the front makes room again.
        assert_eq!(q.pop(), Some(0));
        assert_eq!(q.push(9999), QueuePush::Ok);
        assert_eq!(q.len(), 256);
    }

    #[test]
    fn test_spawn_state_transitions() {
        let mut state = SpawnState::Idle;
        // Idle → Spawning allowed.
        assert!(state.try_transition(SpawnState::Spawning).is_ok());
        assert_eq!(state, SpawnState::Spawning);
        // Spawning → Live allowed.
        assert!(state.try_transition(SpawnState::Live).is_ok());
        assert_eq!(state, SpawnState::Live);
        // Live → Spawning rejected.
        let err = state.try_transition(SpawnState::Spawning).unwrap_err();
        assert_eq!(
            err,
            SpawnStateError::InvalidTransition {
                from: SpawnState::Live,
                to: SpawnState::Spawning,
            }
        );
        // State unchanged on rejection.
        assert_eq!(state, SpawnState::Live);
    }

    // ---- handle_control: spawn_session ----

    #[tokio::test]
    async fn test_spawn_session_writes_pending() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        let frame = state_rx.try_recv().unwrap();
        let (id, state) = session_state_of(&frame);
        assert_eq!(id, "sess-1");
        assert_eq!(state, "pending");
    }

    #[tokio::test]
    async fn test_spawn_session_writes_tugbank_entry() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        let entries = store.entries_snapshot();
        let rec = entries.get("card-1").expect("card-1 persisted");
        assert_eq!(rec.tug_session_id, "sess-1");
        // W2 Step 6: project_dir is now populated on the record (Step 1
        // left it as `None` — that was the deferred state).
        assert_eq!(rec.project_dir.as_deref(), Some(test_project_dir()));
        assert_eq!(rec.claude_session_id, None);
        assert_eq!(store.set_call_count(), 1);
    }

    #[tokio::test]
    async fn test_spawn_session_inserts_into_client_sessions() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        let cs = sup.client_sessions.lock().await;
        let set = cs.get(&10).expect("client 10 has a session set");
        assert!(set.contains(&TugSessionId::new("sess-1")));
    }

    #[tokio::test]
    async fn test_spawn_session_rejects_missing_card_id() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "spawn_session",
            "tug_session_id": "sess-1",
        }))
        .unwrap();

        let err = sup
            .handle_control("spawn_session", &payload, 10)
            .await
            .unwrap_err();
        assert_eq!(err, ControlError::MissingCardId);

        // No mutation: ledger, client_sessions, tugbank all untouched.
        assert!(sup.ledger.lock().await.is_empty());
        assert!(sup.client_sessions.lock().await.is_empty());
        assert!(store.entries_snapshot().is_empty());
        assert_eq!(store.set_call_count(), 0);
        assert!(state_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn test_spawn_session_rejects_empty_card_id() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        let err = sup
            .handle_control("spawn_session", &spawn_payload("", "sess-1"), 10)
            .await
            .unwrap_err();
        assert_eq!(err, ControlError::MissingCardId);
        assert!(sup.ledger.lock().await.is_empty());
        assert_eq!(store.set_call_count(), 0);
    }

    #[tokio::test]
    async fn test_spawn_session_idempotent() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        let tug_id = TugSessionId::new("sess-1");
        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        let entry_before = sup.ledger.lock().await.get(&tug_id).unwrap().clone();

        // Second spawn for the same id must preserve the existing entry.
        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        let entry_after = sup.ledger.lock().await.get(&tug_id).unwrap().clone();

        assert!(
            Arc::ptr_eq(&entry_before, &entry_after),
            "ledger entry must be preserved across a duplicate spawn"
        );
        // Tugbank was re-written (set_call_count = 2).
        assert_eq!(store.set_call_count(), 2);
        // client_sessions still contains the id (HashSet semantics).
        let cs = sup.client_sessions.lock().await;
        assert!(cs.get(&10).unwrap().contains(&tug_id));
    }

    #[tokio::test]
    async fn test_spawn_session_replays_latest_metadata_for_known_session() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, mut meta_rx, _control_rx) = make_supervisor_with_store(store);

        // Pre-populate a ledger entry with latest_metadata (simulates reconnect
        // after a previous session had produced a system_metadata frame).
        let tug_id = TugSessionId::new("sess-1");
        let entry = insert_ledger_entry(&sup, &tug_id).await;
        let original = fake_metadata_frame("sess-1");
        {
            let mut e = entry.lock().await;
            e.latest_metadata = Some(original.clone());
        }

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 99)
            .await
            .unwrap();

        // The broadcast subscriber must receive exactly one metadata frame.
        let received = meta_rx.try_recv().expect("replay frame present");
        assert_eq!(received, original);
        assert!(
            meta_rx.try_recv().is_err(),
            "only a single replay frame is emitted"
        );
    }

    #[tokio::test]
    async fn test_spawn_session_with_no_prior_metadata_fires_no_replay() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, mut meta_rx, _control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 7)
            .await
            .unwrap();

        assert!(
            meta_rx.try_recv().is_err(),
            "no replay should fire for a brand-new session"
        );
    }

    #[tokio::test]
    async fn test_spawn_session_returns_err_on_tugbank_failure_injects_error_frame() {
        let store = Arc::new(FailingWriteStore::new());
        let (sup, mut state_rx, mut meta_rx, _control_rx) = make_supervisor_with_store(store);

        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 42)
            .await
            .unwrap_err();
        match err {
            ControlError::PersistenceFailure(_) => {}
            other => panic!("expected PersistenceFailure, got {other:?}"),
        }

        // SESSION_STATE `pending` must NOT have been published — the strict
        // path aborts before the publish.
        assert!(state_rx.try_recv().is_err());
        // Metadata replay must not have fired either.
        assert!(meta_rx.try_recv().is_err());
    }

    // ---- handle_control: close_session ----

    #[tokio::test]
    async fn test_close_session_publishes_closed_and_removes_entry() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        // Drain the pending frame.
        let _ = state_rx.try_recv().unwrap();

        sup.handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        let (id, state) = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(id, "sess-1");
        assert_eq!(state, "closed");
        assert!(sup.ledger.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_close_session_deletes_tugbank_entry() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        assert_eq!(store.entries_snapshot().len(), 1);

        sup.handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        assert!(store.entries_snapshot().is_empty());
        assert_eq!(store.delete_call_count(), 1);
    }

    #[tokio::test]
    async fn test_close_session_removes_from_client_sessions() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        sup.handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        let cs = sup.client_sessions.lock().await;
        let set = cs.get(&10).expect("client 10 still has a set");
        assert!(!set.contains(&TugSessionId::new("sess-1")));
    }

    #[tokio::test]
    async fn test_close_session_unknown_is_noop() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        sup.handle_control(
            "close_session",
            &close_payload("card-unknown", "sess-unknown"),
            10,
        )
        .await
        .unwrap();

        // No SESSION_STATE publish, no tugbank delete call.
        assert!(state_rx.try_recv().is_err());
        assert_eq!(store.delete_call_count(), 0);
    }

    #[tokio::test]
    async fn test_close_session_logs_on_tugbank_delete_failure_and_continues() {
        let store = Arc::new(FailingDeleteStore::new());
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        // Pre-populate a ledger entry and a client_sessions affinity.
        let tug_id = TugSessionId::new("sess-1");
        insert_ledger_entry(&sup, &tug_id).await;
        sup.client_sessions
            .lock()
            .await
            .entry(10)
            .or_default()
            .insert(tug_id.clone());

        // Close must succeed in spite of the delete failure.
        let result = sup
            .handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await;
        assert!(result.is_ok());

        // In-memory cleanup proceeded regardless.
        assert!(sup.ledger.lock().await.is_empty());
        let cs = sup.client_sessions.lock().await;
        assert!(!cs.get(&10).unwrap().contains(&tug_id));
        let (id, state) = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(id, "sess-1");
        assert_eq!(state, "closed");
        // (Note: log-capture of the warn! is handled by tracing in production;
        // this test pins the functional best-effort behavior which is the
        // load-bearing assertion for [D12].)
    }

    // ---- handle_control: reset_session ----

    #[tokio::test]
    async fn test_reset_session_publishes_closed_then_pending() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        // Drain initial pending.
        let _ = state_rx.try_recv().unwrap();

        sup.handle_control("reset_session", &reset_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        // Expect closed then pending in that order.
        let first = session_state_of(&state_rx.try_recv().unwrap());
        let second = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(first, ("sess-1".into(), "closed".into()));
        assert_eq!(second, ("sess-1".into(), "pending".into()));
    }

    // ---- P13: spawn budget (concurrent cap + rate limit) ----

    /// Shared helper: insert a synthetic ledger entry and set its
    /// `spawn_state` to the given value under the per-entry mutex. Used
    /// by the P13 tests to preload the ledger without driving the
    /// dispatcher + bridge stack end-to-end.
    async fn preload_entry_in_state(
        sup: &AgentSupervisor,
        tug_session_id: &TugSessionId,
        state: SpawnState,
    ) {
        let entry_arc = insert_ledger_entry(sup, tug_session_id).await;
        let mut entry = entry_arc.lock().await;
        entry.spawn_state = state;
    }

    #[tokio::test]
    async fn test_spawn_session_cap_rejects_over_concurrent_limit() {
        // Cap = 2. Preload two `Spawning` entries so the next fresh
        // `spawn_session` trips the cap at the Phase 1 check.
        let store = Arc::new(InMemoryStore::default());
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 2,
            max_spawns_per_minute: 100,
            ..Default::default()
        };
        let (sup, mut state_rx, _meta_rx, _control_rx) =
            make_supervisor_with_store_config(store.clone(), config);

        preload_entry_in_state(&sup, &TugSessionId::new("sess-a"), SpawnState::Spawning).await;
        preload_entry_in_state(&sup, &TugSessionId::new("sess-b"), SpawnState::Live).await;

        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-3", "sess-c"), 10)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            ControlError::CapExceeded {
                reason: "concurrent_session_cap_exceeded"
            }
        );

        // SESSION_STATE errored frame is published to any observer.
        let frame = state_rx.try_recv().expect("errored frame published");
        assert_eq!(frame.feed_id, FeedId::SESSION_STATE);
        let v: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(v["tug_session_id"].as_str(), Some("sess-c"));
        assert_eq!(v["state"].as_str(), Some("errored"));
        assert_eq!(
            v["detail"].as_str(),
            Some("concurrent_session_cap_exceeded")
        );

        // No ledger entry was created for the rejected spawn. The two
        // preloaded entries remain; `sess-c` is absent.
        let ledger = sup.ledger.lock().await;
        assert_eq!(ledger.len(), 2);
        assert!(!ledger.contains_key(&TugSessionId::new("sess-c")));

        // Tugbank was not touched.
        assert_eq!(store.set_call_count(), 0);
    }

    #[tokio::test]
    async fn test_spawn_session_cap_excludes_idle_and_errored_entries() {
        // Cap = 2. Preload one `Idle` + one `Errored` entry. Neither
        // counts against the budget, so a third fresh spawn succeeds.
        let store = Arc::new(InMemoryStore::default());
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 2,
            max_spawns_per_minute: 100,
            ..Default::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) =
            make_supervisor_with_store_config(store, config);

        preload_entry_in_state(&sup, &TugSessionId::new("sess-idle"), SpawnState::Idle).await;
        preload_entry_in_state(&sup, &TugSessionId::new("sess-err"), SpawnState::Errored).await;

        // Fresh spawn of a third tug_session_id succeeds because active
        // (Spawning+Live) count is 0.
        sup.handle_control("spawn_session", &spawn_payload("card-new", "sess-new"), 10)
            .await
            .expect("Idle+Errored do not consume cap slots");
    }

    #[tokio::test]
    async fn test_spawn_session_reconnect_bypasses_cap() {
        // Cap = 1. Preload a single `Live` entry at the cap. A
        // *reconnect* `spawn_session` for the SAME tug_session_id must
        // succeed — the existing entry is reused and no new subprocess
        // is implied.
        let store = Arc::new(InMemoryStore::default());
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 1,
            max_spawns_per_minute: 100,
            ..Default::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) =
            make_supervisor_with_store_config(store, config);

        preload_entry_in_state(&sup, &TugSessionId::new("sess-1"), SpawnState::Live).await;

        // Reconnect: same tug_session_id as the preloaded entry.
        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect("reconnect must bypass the concurrent cap");

        // A *fresh* spawn for a different tsid with cap=1 still trips.
        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-2", "sess-2"), 10)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            ControlError::CapExceeded {
                reason: "concurrent_session_cap_exceeded"
            }
        );
    }

    #[tokio::test]
    async fn test_spawn_session_rate_limit_rejects_after_budget_exhausted() {
        // Cap very high, rate = 2. The third fresh spawn within 60s
        // trips the leaky bucket even though the concurrent cap has
        // plenty of room.
        let store = Arc::new(InMemoryStore::default());
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 100,
            max_spawns_per_minute: 2,
            ..Default::default()
        };
        let (sup, mut state_rx, _meta_rx, _control_rx) =
            make_supervisor_with_store_config(store, config);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect("first spawn admitted");
        sup.handle_control("spawn_session", &spawn_payload("card-2", "sess-2"), 10)
            .await
            .expect("second spawn admitted");

        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-3", "sess-3"), 10)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            ControlError::CapExceeded {
                reason: "spawn_rate_limited"
            }
        );

        // Drain the two successful `pending` frames, then find the
        // rate-limited errored frame. The broadcast order is: pending-1,
        // pending-2, errored-3.
        let f1 = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(f1, ("sess-1".into(), "pending".into()));
        let f2 = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(f2, ("sess-2".into(), "pending".into()));
        let f3 = state_rx.try_recv().unwrap();
        let v: serde_json::Value = serde_json::from_slice(&f3.payload).unwrap();
        assert_eq!(v["tug_session_id"].as_str(), Some("sess-3"));
        assert_eq!(v["state"].as_str(), Some("errored"));
        assert_eq!(v["detail"].as_str(), Some("spawn_rate_limited"));
    }

    #[tokio::test]
    async fn test_spawn_session_rate_limit_window_ejects_old_timestamps() {
        // cap_check_reason trims timestamps older than 60s from the
        // front of the deque on every call. Seed the deque with two
        // ancient timestamps (simulating spawns from 2 minutes ago),
        // then verify fresh spawns succeed because the trim empties the
        // window before the length check.
        let store = Arc::new(InMemoryStore::default());
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 100,
            max_spawns_per_minute: 2,
            ..Default::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) =
            make_supervisor_with_store_config(store, config);

        {
            let ancient = Instant::now()
                .checked_sub(Duration::from_secs(120))
                .expect("test runs with monotonic clock well past 120s");
            let mut ts = sup.spawn_timestamps.lock().unwrap();
            ts.push_back(ancient);
            ts.push_back(ancient);
        }

        // Two fresh spawns succeed. The trim at the top of cap_check_reason
        // pops the ancient timestamps before the length check, so the
        // rate budget is effectively empty.
        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect("first spawn admitted after trim");
        sup.handle_control("spawn_session", &spawn_payload("card-2", "sess-2"), 10)
            .await
            .expect("second spawn admitted after trim");

        // After the two admits, the deque holds exactly two fresh
        // timestamps (the ancient ones were trimmed).
        let ts = sup.spawn_timestamps.lock().unwrap();
        assert_eq!(ts.len(), 2);
    }

    #[tokio::test]
    async fn test_spawn_session_reconnect_does_not_consume_rate_budget() {
        // Reconnects (existing ledger entry) must not push a timestamp
        // onto the leaky-bucket deque. Set rate=1, preload one entry,
        // reconnect to it → must succeed; then a single fresh spawn of
        // a different tsid must also succeed (budget still has 1 slot).
        let store = Arc::new(InMemoryStore::default());
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 100,
            max_spawns_per_minute: 1,
            ..Default::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) =
            make_supervisor_with_store_config(store, config);

        preload_entry_in_state(&sup, &TugSessionId::new("sess-pre"), SpawnState::Idle).await;

        // Reconnect — must NOT push a timestamp.
        sup.handle_control("spawn_session", &spawn_payload("card-pre", "sess-pre"), 10)
            .await
            .expect("reconnect admitted");
        assert_eq!(
            sup.spawn_timestamps.lock().unwrap().len(),
            0,
            "reconnect must not consume rate budget"
        );

        // Fresh spawn — consumes the one and only budget slot.
        sup.handle_control("spawn_session", &spawn_payload("card-new", "sess-new"), 10)
            .await
            .expect("fresh spawn admitted (first of the window)");
        assert_eq!(
            sup.spawn_timestamps.lock().unwrap().len(),
            1,
            "fresh spawn consumes exactly one budget slot"
        );

        // A second fresh spawn now trips the rate limit.
        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-3", "sess-3"), 10)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            ControlError::CapExceeded {
                reason: "spawn_rate_limited"
            }
        );
    }

    // ---- dispatch_one / dispatcher_task ----

    fn code_input_frame(tug_session_id: &str) -> Frame {
        let body = serde_json::json!({
            "tug_session_id": tug_session_id,
            "type": "user_message",
            "text": "hi",
        });
        Frame::new(FeedId::CODE_INPUT, serde_json::to_vec(&body).unwrap())
    }

    #[tokio::test]
    async fn test_dispatch_missing_tug_session_id_drops_silently() {
        // A CODE_INPUT payload that carries no `tug_session_id` field has
        // nothing to attribute a `session_unknown` CONTROL frame to, so the
        // dispatcher drops it (with a warn! log) rather than fabricate an
        // error frame. This test pins that behavior so a future "emit a
        // control frame on every drop" refactor can't silently add noise
        // on the CONTROL feed.
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, mut state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store(store);

        // Payload with no `tug_session_id` field.
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "user_message",
            "text": "hi",
        }))
        .unwrap();
        sup.dispatch_one(Frame::new(FeedId::CODE_INPUT, payload))
            .await;

        assert!(
            control_rx.try_recv().is_err(),
            "missing tug_session_id must not emit a CONTROL frame"
        );
        assert!(
            state_rx.try_recv().is_err(),
            "missing tug_session_id must not emit a SESSION_STATE frame"
        );
        assert!(
            sup.ledger.lock().await.is_empty(),
            "missing tug_session_id must not mutate the ledger"
        );
    }

    #[tokio::test]
    async fn test_orphan_input_rejected() {
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store(store);

        sup.dispatch_one(code_input_frame("sess-unknown")).await;

        let ctrl = control_rx
            .try_recv()
            .expect("session_unknown control frame");
        assert_eq!(ctrl.feed_id, FeedId::CONTROL);
        let v: serde_json::Value = serde_json::from_slice(&ctrl.payload).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["detail"], "session_unknown");
        assert_eq!(v["tug_session_id"], "sess-unknown");

        // Ledger untouched — dispatching unknown input must not create an entry.
        assert!(sup.ledger.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_first_input_triggers_spawn() {
        // Under the aligned state model (B3 fix), dispatching the first
        // CODE_INPUT flips the ledger entry Idle → Spawning and calls
        // `spawn_session_worker`, which publishes the wire `spawning`
        // frame and installs `input_tx`. The ledger entry *stays* at
        // `Spawning` — promotion to `Live` is done by the bridge on
        // `session_init`, not eagerly by the worker. The StallSpawner
        // used in this test never produces `session_init`, so the state
        // remains `Spawning` and the queued first frame stays in the
        // queue (the bridge's session_init handler is the drain point).
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        let (_, pending_state) = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(pending_state, "pending");

        sup.dispatch_one(code_input_frame("sess-1")).await;

        let (_, state) = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(state, "spawning");
        assert!(
            state_rx.try_recv().is_err(),
            "no further SESSION_STATE frame until the bridge reads session_init"
        );

        let tug_id = TugSessionId::new("sess-1");
        let entry_arc = sup.ledger.lock().await.get(&tug_id).unwrap().clone();
        let entry = entry_arc.lock().await;
        assert_eq!(entry.spawn_state, SpawnState::Spawning);
        assert_eq!(
            entry.queue.len(),
            1,
            "first CODE_INPUT is buffered in the queue until session_init drains it"
        );
        assert!(entry.input_tx.is_some(), "worker installed input_tx");
    }

    #[tokio::test]
    async fn test_concurrent_first_inputs_spawn_once() {
        // Two CODE_INPUT frames back-to-back. The first flips Idle →
        // Spawning and spawns the worker; the second lands in the
        // dispatcher's `Spawning` branch and is buffered in the queue.
        // Under the aligned state model (B3 fix), the ledger state
        // remains `Spawning` until the bridge reads `session_init` —
        // StallSpawner never produces one, so both frames stay queued.
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        let _ = state_rx.try_recv().unwrap();

        sup.dispatch_one(code_input_frame("sess-1")).await;
        sup.dispatch_one(code_input_frame("sess-1")).await;

        let (_, state) = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(state, "spawning");
        assert!(
            state_rx.try_recv().is_err(),
            "only a single `spawning` frame — no double-spawn"
        );

        let tug_id = TugSessionId::new("sess-1");
        let entry_arc = sup.ledger.lock().await.get(&tug_id).unwrap().clone();
        let entry = entry_arc.lock().await;
        assert_eq!(entry.spawn_state, SpawnState::Spawning);
        assert_eq!(
            entry.queue.len(),
            2,
            "both frames are buffered in the queue awaiting session_init"
        );
    }

    #[tokio::test]
    async fn test_queue_overflow_emits_backpressure() {
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        // Drain the W2 Step 6 `spawn_session_ok` ack (Spec S03) before
        // asserting there are no backpressure frames on the control feed.
        let _ = control_rx.try_recv();

        // Pin the entry to Spawning so the dispatcher buffers into the queue
        // without triggering a worker drain.
        let tug_id = TugSessionId::new("sess-1");
        {
            let map = sup.ledger.lock().await;
            let entry_arc = map.get(&tug_id).unwrap().clone();
            drop(map);
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Spawning;
        }

        // First 256 frames fit.
        for _ in 0..256 {
            sup.dispatch_one(code_input_frame("sess-1")).await;
        }
        assert!(
            control_rx.try_recv().is_err(),
            "no backpressure within the 256-frame cap"
        );

        // The 257th frame overflows → emit session_backpressure CONTROL.
        sup.dispatch_one(code_input_frame("sess-1")).await;

        let ctrl = control_rx
            .try_recv()
            .expect("session_backpressure control frame");
        assert_eq!(ctrl.feed_id, FeedId::CONTROL);
        let v: serde_json::Value = serde_json::from_slice(&ctrl.payload).unwrap();
        assert_eq!(v["type"], "session_backpressure");
        assert_eq!(v["tug_session_id"], "sess-1");

        let entry_arc = sup.ledger.lock().await.get(&tug_id).unwrap().clone();
        let entry = entry_arc.lock().await;
        assert_eq!(entry.queue.len(), 256);
    }

    // ---- close/spawn race ([R06]) ----

    /// Pin for [R06]: concurrent `close_session` and `spawn_session` for the
    /// same `tug_session_id` from different clients must never leave the
    /// supervisor in a state where `client_sessions` references a
    /// `tug_session_id` that no longer has a ledger entry, nor leave a
    /// ledger entry whose only affinity is from the closing (not the
    /// spawning) client.
    ///
    /// Uses `flavor = "multi_thread"` so the two `tokio::spawn`ed tasks can
    /// actually interleave across threads at Tokio-mutex acquisition points.
    /// A single-threaded runtime would serialize the two tasks to
    /// completion and not exercise the race at all. The scenario is looped
    /// so CI has a chance to surface scheduling-dependent regressions; each
    /// iteration is independent with a fresh supervisor.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_close_spawn_race_does_not_leak_entry() {
        const ITERATIONS: usize = 64;

        for iter in 0..ITERATIONS {
            let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
            let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);
            let sup = Arc::new(sup);

            // Pre-spawn from client 10 so both racers start from a populated
            // ledger entry; otherwise there's nothing for close to remove.
            sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
                .await
                .unwrap();

            let sup_close = sup.clone();
            let sup_spawn = sup.clone();
            let close_task = tokio::spawn(async move {
                sup_close
                    .handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
                    .await
            });
            let spawn_task = tokio::spawn(async move {
                sup_spawn
                    .handle_control("spawn_session", &spawn_payload("card-2", "sess-1"), 20)
                    .await
            });

            let close_result = close_task.await.expect("close task panic");
            let spawn_result = spawn_task.await.expect("spawn task panic");
            assert!(close_result.is_ok(), "close_task failed on iter {iter}");
            assert!(spawn_result.is_ok(), "spawn_task failed on iter {iter}");

            // Final-state self-consistency: either the ledger has the entry
            // AND only the spawn client has affinity, OR the ledger has no
            // entry AND neither client has affinity. No orphaned
            // client_sessions entries referring to a missing ledger entry.
            let ledger = sup.ledger.lock().await;
            let cs = sup.client_sessions.lock().await;
            let tug_id = TugSessionId::new("sess-1");

            let has_ledger_entry = ledger.contains_key(&tug_id);
            let client_10_has = cs.get(&10).is_some_and(|s| s.contains(&tug_id));
            let client_20_has = cs.get(&20).is_some_and(|s| s.contains(&tug_id));

            if has_ledger_entry {
                assert!(
                    client_20_has,
                    "iter {iter}: ledger has entry but spawn client (20) has no affinity"
                );
                assert!(
                    !client_10_has,
                    "iter {iter}: ledger has entry but close client (10) still has affinity"
                );
            } else {
                assert!(
                    !client_20_has,
                    "iter {iter}: ledger empty but spawn client (20) still has affinity"
                );
                assert!(
                    !client_10_has,
                    "iter {iter}: ledger empty but close client (10) still has affinity"
                );
            }
        }
    }

    // ---- on_client_disconnect ----

    // ---- W2 Step 4: default_spawner_factory does not close over project_dir ----

    #[test]
    fn test_default_spawner_factory_does_not_close_over_project_dir() {
        // Before W2 Step 4, `default_spawner_factory` captured both
        // `tugcode_path` and `project_dir` from the supervisor config and
        // baked them into each TugcodeSpawner instance. Step 4 made the
        // spawner stateless with respect to `project_dir` — the field
        // was deleted, `TugcodeSpawner::new` takes only `tugcode_path`,
        // and `spawn_child` accepts `project_dir` per call.
        //
        // Step 6 went further: the `AgentSupervisorConfig::project_dir`
        // field was deleted entirely ([D12]). This test now relies on
        // the structural absence — if someone re-introduced a global
        // workspace path on the config, this test would need updating.
        use super::super::agent_bridge::build_tugcode_command;
        let config = AgentSupervisorConfig {
            tugcode_path: PathBuf::from("/opt/tugtool/tugcode"),
            ..Default::default()
        };
        let _factory = default_spawner_factory(&config);

        // The per-call `project_dir` is what flows into the command. Pass a
        // deliberately different workspace and verify the legacy config
        // path does not appear in the resolved argv.
        let (_program, args) = build_tugcode_command(
            &config.tugcode_path,
            std::path::Path::new("/workspace-B-from-per-call"),
            "sess-per-call",
            SessionMode::New,
        );
        assert!(
            args.iter().any(|a| a == "/workspace-B-from-per-call"),
            "per-call project_dir must appear in argv: {args:?}"
        );
        assert!(
            !args.iter().any(|a| a == "/workspace-A-should-be-ignored"),
            "config.project_dir must NOT appear in argv: {args:?}"
        );
    }

    // ---- Step 8: rebind_from_tugbank ----

    #[tokio::test]
    async fn test_main_rebinds_intent_records_on_startup() {
        // Populate a fake tugbank with two (card_id, tug_session_id) pairs,
        // construct an AgentSupervisor wired to that store, then call
        // `rebind_from_tugbank`. Assert that both ids appear in the ledger
        // as `Idle` (the wire name is `pending`), that `client_sessions`
        // is empty (per [F15] the rebind path does NOT insert a sentinel
        // client id), and that the store was not re-written (the helper
        // only reads on startup).
        let store = Arc::new(InMemoryStore::default());
        // W2 Step 6: rebind drops records with no `project_dir` ([D03]),
        // so tests that want a successful rebind must populate the
        // records with a valid path. Use the shared test fixture dir.
        store
            .set_session_record(
                "card-a",
                &SessionKeyRecord {
                    tug_session_id: "sess-a".to_string(),
                    project_dir: Some(test_project_dir().to_string()),
                    claude_session_id: None,
                },
            )
            .unwrap();
        store
            .set_session_record(
                "card-b",
                &SessionKeyRecord {
                    tug_session_id: "sess-b".to_string(),
                    project_dir: Some(test_project_dir().to_string()),
                    claude_session_id: None,
                },
            )
            .unwrap();
        let set_calls_before = store.set_call_count();

        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        let inserted = sup.rebind_from_tugbank().await.unwrap();
        assert_eq!(inserted, 2);

        let ledger = sup.ledger.lock().await;
        let id_a = TugSessionId::new("sess-a");
        let id_b = TugSessionId::new("sess-b");
        assert!(ledger.contains_key(&id_a));
        assert!(ledger.contains_key(&id_b));
        for id in [&id_a, &id_b] {
            let entry_arc = ledger.get(id).unwrap().clone();
            let entry = entry_arc.lock().await;
            assert_eq!(entry.spawn_state, SpawnState::Idle);
        }
        drop(ledger);

        // `client_sessions` must be empty — the rebind path owns no
        // WebSocket client_id.
        assert!(sup.client_sessions.lock().await.is_empty());

        // Store was not re-written.
        assert_eq!(store.set_call_count(), set_calls_before);
        assert_eq!(store.delete_call_count(), 0);

        // Second rebind call is idempotent — no new inserts.
        let inserted_second = sup.rebind_from_tugbank().await.unwrap();
        assert_eq!(inserted_second, 0);
    }

    #[tokio::test]
    async fn test_on_client_disconnect_drops_client_sessions_entry() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        assert!(sup.client_sessions.lock().await.contains_key(&10));

        sup.on_client_disconnect(10).await;

        assert!(!sup.client_sessions.lock().await.contains_key(&10));
        // Ledger and tugbank are untouched.
        assert_eq!(sup.ledger.lock().await.len(), 1);
        assert_eq!(store.entries_snapshot().len(), 1);
    }

    // ---- Step 6: merger_task, per-session bridge, metadata routing ----

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    /// Spawner that returns an `io::Error` on every call. Used by the
    /// crash-budget test to drive `run_session_bridge` through its retry
    /// loop without spinning up a real subprocess.
    struct CrashingSpawner;
    impl ChildSpawner for CrashingSpawner {
        fn spawn_child(
            &self,
            _project_dir: &std::path::Path,
            _session_id: &str,
            _session_mode: SessionMode,
        ) -> SpawnFuture {
            Box::pin(async { Err(std::io::Error::other("injected crash")) })
        }
    }

    #[tokio::test]
    async fn test_merger_fans_in_two_sessions() {
        // Spin up two per-session output mpscs, register both with the
        // merger, push one frame through each, and assert both frames
        // reach the shared CODE_OUTPUT broadcast. This pins the merger's
        // StreamMap-based fan-in.
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let ((sup, _state_rx, _meta_rx, _control_rx), register_rx) =
            make_supervisor_with_spawner(store, stall_spawner_factory());
        let sup = Arc::new(sup);
        let mut code_rx = sup.code_output_tx.subscribe();
        let cancel = CancellationToken::new();
        let merger_handle = tokio::spawn(Arc::clone(&sup).merger_task(register_rx, cancel.clone()));

        let id_a = TugSessionId::new("sess-a");
        let id_b = TugSessionId::new("sess-b");

        let (tx_a, rx_a) = mpsc::channel::<Frame>(4);
        let (tx_b, rx_b) = mpsc::channel::<Frame>(4);
        sup.merger_register_tx
            .send((id_a.clone(), rx_a))
            .await
            .unwrap();
        sup.merger_register_tx
            .send((id_b.clone(), rx_b))
            .await
            .unwrap();

        let frame_a = Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-a","type":"x"}"#.to_vec(),
        );
        let frame_b = Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-b","type":"y"}"#.to_vec(),
        );
        tx_a.send(frame_a.clone()).await.unwrap();
        tx_b.send(frame_b.clone()).await.unwrap();

        let first = tokio::time::timeout(Duration::from_millis(500), code_rx.recv())
            .await
            .expect("first frame timeout")
            .expect("first frame recv err");
        let second = tokio::time::timeout(Duration::from_millis(500), code_rx.recv())
            .await
            .expect("second frame timeout")
            .expect("second frame recv err");

        let payloads: HashSet<Vec<u8>> = [first.payload, second.payload].into_iter().collect();
        assert!(
            payloads.contains(&frame_a.payload),
            "session A frame missing from CODE_OUTPUT broadcast"
        );
        assert!(
            payloads.contains(&frame_b.payload),
            "session B frame missing from CODE_OUTPUT broadcast"
        );

        cancel.cancel();
        let _ = merger_handle.await;
    }

    #[tokio::test]
    async fn test_merger_routes_metadata_per_session_no_clobber() {
        // Pins [D14]: two sessions emit distinct `system_metadata` frames
        // in rapid succession. Both frames must land on the SESSION_METADATA
        // broadcast (a single-slot watch would drop one), AND each ledger
        // entry's `latest_metadata` must hold its own payload with no
        // cross-pollination.
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let ((sup, _state_rx, mut meta_rx, _control_rx), register_rx) =
            make_supervisor_with_spawner(store, stall_spawner_factory());
        let sup = Arc::new(sup);
        let cancel = CancellationToken::new();
        let merger_handle = tokio::spawn(Arc::clone(&sup).merger_task(register_rx, cancel.clone()));

        let id_a = TugSessionId::new("sess-a");
        let id_b = TugSessionId::new("sess-b");
        insert_ledger_entry(&sup, &id_a).await;
        insert_ledger_entry(&sup, &id_b).await;

        let (tx_a, rx_a) = mpsc::channel::<Frame>(4);
        let (tx_b, rx_b) = mpsc::channel::<Frame>(4);
        sup.merger_register_tx
            .send((id_a.clone(), rx_a))
            .await
            .unwrap();
        sup.merger_register_tx
            .send((id_b.clone(), rx_b))
            .await
            .unwrap();

        let meta_a = Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-a","type":"system_metadata","model":"opus-a"}"#.to_vec(),
        );
        let meta_b = Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-b","type":"system_metadata","model":"opus-b"}"#.to_vec(),
        );
        tx_a.send(meta_a.clone()).await.unwrap();
        tx_b.send(meta_b.clone()).await.unwrap();

        let first = tokio::time::timeout(Duration::from_millis(500), meta_rx.recv())
            .await
            .expect("first metadata timeout")
            .expect("first metadata recv err");
        let second = tokio::time::timeout(Duration::from_millis(500), meta_rx.recv())
            .await
            .expect("second metadata timeout")
            .expect("second metadata recv err");

        // Feed-id correctness pin: the merger rewraps system_metadata
        // payloads with `FeedId::SESSION_METADATA` before publishing onto
        // `session_metadata_tx`. `Frame::encode` uses `frame.feed_id` as
        // the first wire byte, so any client-side filter keyed on
        // `FeedId::SESSION_METADATA` depends on this. A regression that
        // left the feed_id as CODE_OUTPUT would silently break tugdeck's
        // SESSION_METADATA store without any payload assertion catching
        // it.
        assert_eq!(first.feed_id, FeedId::SESSION_METADATA);
        assert_eq!(second.feed_id, FeedId::SESSION_METADATA);

        let received: HashSet<Vec<u8>> = [first.payload, second.payload].into_iter().collect();
        assert!(
            received.contains(&meta_a.payload),
            "session A metadata missing from SESSION_METADATA broadcast"
        );
        assert!(
            received.contains(&meta_b.payload),
            "session B metadata missing from SESSION_METADATA broadcast"
        );

        // Each ledger entry's latest_metadata must hold its own distinct
        // payload. A single-slot watch would have one session's payload
        // clobber the other. The stored frames are also rewrapped as
        // SESSION_METADATA so event-driven replay in `do_spawn_session`
        // re-emits with the correct feed_id.
        let entry_a = sup.ledger.lock().await.get(&id_a).unwrap().clone();
        let entry_b = sup.ledger.lock().await.get(&id_b).unwrap().clone();
        let stored_a = entry_a
            .lock()
            .await
            .latest_metadata
            .clone()
            .expect("session A stored metadata");
        let stored_b = entry_b
            .lock()
            .await
            .latest_metadata
            .clone()
            .expect("session B stored metadata");
        assert_eq!(stored_a.feed_id, FeedId::SESSION_METADATA);
        assert_eq!(stored_b.feed_id, FeedId::SESSION_METADATA);
        assert_eq!(stored_a.payload, meta_a.payload);
        assert_eq!(stored_b.payload, meta_b.payload);

        cancel.cancel();
        let _ = merger_handle.await;
    }

    #[tokio::test]
    async fn test_session_init_populates_claude_session_id() {
        // Drives `relay_session_io` directly with duplex streams so we can
        // simulate a child emitting `protocol_ack` + `session_init` without
        // spawning a real subprocess. This pins the aligned state model
        // (B3 fix): on session_init the bridge must **atomically**
        //
        //   (a) populate `claude_session_id`,
        //   (b) transition the ledger from `Spawning` → `Live`,
        //   (c) drain the per-session queue into `input_tx`,
        //   (d) publish the wire `SESSION_STATE = live` frame,
        //
        // all under a single ledger-entry lock so no observer can see a
        // state where `spawn_state == Live` while the queue still holds
        // undelivered frames.
        //
        // Also note: no `watch::channel` is constructed anywhere in this
        // test — that pins the deletion of `session_watch_tx` from
        // `agent_bridge.rs`. There is no longer any watch sender that a
        // `session_init` line can be latched onto.
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let ((sup, _state_rx, _meta_rx, _control_rx), _register_rx) =
            make_supervisor_with_spawner(store, stall_spawner_factory());

        let tug_id = TugSessionId::new("sess-1");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;

        // Pre-install a queued frame + input_tx + Spawning state so the
        // bridge's session_init promote path has something to drain and
        // something to transition from. This mirrors what the dispatcher
        // + spawn_session_worker would have done in production.
        let (input_tx_for_ledger, mut input_rx_for_assert) = mpsc::channel::<Frame>(16);
        let pre_queued = code_input_frame("sess-1");
        {
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Spawning;
            entry.input_tx = Some(input_tx_for_ledger.clone());
            assert_eq!(entry.queue.push(pre_queued.clone()), QueuePush::Ok);
        }
        drop(input_tx_for_ledger);

        let (bridge_stdin, mut child_stdin_read) = tokio::io::duplex(4096);
        let (mut child_stdout_write, bridge_stdout) = tokio::io::duplex(4096);

        // Spawn a "child" that reads protocol_init, writes protocol_ack +
        // session_init, then drops its stdout write end to signal EOF.
        let child_task = tokio::spawn(async move {
            let mut reader = BufReader::new(&mut child_stdin_read);
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            assert!(line.contains("protocol_init"));

            child_stdout_write
                .write_all(b"{\"type\":\"protocol_ack\",\"version\":1}\n")
                .await
                .unwrap();
            child_stdout_write
                .write_all(b"{\"type\":\"session_init\",\"session_id\":\"claude-xyz\"}\n")
                .await
                .unwrap();
            drop(child_stdout_write);
        });

        let (_input_tx_bridge, mut input_rx_bridge) = mpsc::channel::<Frame>(4);
        let (merger_tx, mut merger_rx) = mpsc::channel::<Frame>(4);
        let state_tx = sup.session_state_tx.clone();
        let mut state_rx = state_tx.subscribe();
        let cancel = CancellationToken::new();

        let stdin_box: Box<dyn tokio::io::AsyncWrite + Send + Unpin> = Box::new(bridge_stdin);
        let stdout_box: Box<dyn tokio::io::AsyncRead + Send + Unpin> = Box::new(bridge_stdout);
        let lines = BufReader::new(stdout_box).lines();

        let recorder = NoopSessionsRecorder;
        let outcome = relay_session_io(
            &tug_id,
            &entry_arc,
            &mut input_rx_bridge,
            &merger_tx,
            &state_tx,
            stdin_box,
            lines,
            "/tmp/test-relay-project",
            &recorder,
            &cancel,
        )
        .await;

        child_task.await.unwrap();

        // EOF after session_init → relay returns Crashed.
        assert_eq!(outcome, RelayOutcome::Crashed);

        // (a) claude_session_id populated, (b) ledger state promoted to
        // Live, (c) queue drained.
        {
            let entry = entry_arc.lock().await;
            assert_eq!(entry.claude_session_id.as_deref(), Some("claude-xyz"));
            assert_eq!(entry.spawn_state, SpawnState::Live);
            assert!(
                entry.queue.is_empty(),
                "session_init must atomically drain the queue into input_tx"
            );
        }

        // The drained queue frame reached `input_tx` (which in this test
        // is wired into `input_rx_for_assert`).
        let drained = input_rx_for_assert
            .try_recv()
            .expect("queued frame drained to input_tx");
        assert_eq!(drained.payload, pre_queued.payload);

        // The session_init frame must have been forwarded to the merger
        // channel with `tug_session_id` spliced in.
        let spliced = merger_rx.try_recv().expect("session_init forwarded");
        assert_eq!(spliced.feed_id, FeedId::CODE_OUTPUT);
        let parsed: serde_json::Value = serde_json::from_slice(&spliced.payload).unwrap();
        assert_eq!(parsed["tug_session_id"], "sess-1");
        assert_eq!(parsed["type"], "session_init");
        assert_eq!(parsed["session_id"], "claude-xyz");

        // (d) SESSION_STATE = live must have been published.
        let live_frame = state_rx.try_recv().expect("live state frame");
        let (id, state) = session_state_of(&live_frame);
        assert_eq!(id, "sess-1");
        assert_eq!(state, "live");
    }

    /// Step 4.5.5 Phase B: when tugcode emits `resume_failed` and then
    /// exits (closes stdout), `relay_session_io` must promote the EOF
    /// from `Crashed` (would retry) to `ResumeFailed { ... }` so the
    /// outer `run_session_bridge` loop tears down terminally without
    /// re-spawning under the same stale `--resume` id. Pins the
    /// invariant so a future EOF-handling change can't quietly bring
    /// the silent retry back.
    #[tokio::test]
    async fn test_resume_failed_promotes_eof_to_terminal() {
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let ((sup, _state_rx, _meta_rx, _control_rx), _register_rx) =
            make_supervisor_with_spawner(store, stall_spawner_factory());

        let tug_id = TugSessionId::new("sess-resume-fail");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Spawning;
        }

        let (bridge_stdin, mut child_stdin_read) = tokio::io::duplex(4096);
        let (mut child_stdout_write, bridge_stdout) = tokio::io::duplex(4096);

        // Fake child: handshake, then `resume_failed`, then EOF.
        let stale_id = "stale-claude-id-7";
        let child_task = tokio::spawn(async move {
            let mut reader = BufReader::new(&mut child_stdin_read);
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            assert!(line.contains("protocol_init"));

            child_stdout_write
                .write_all(b"{\"type\":\"protocol_ack\",\"version\":1}\n")
                .await
                .unwrap();
            let frame = format!(
                "{{\"type\":\"resume_failed\",\"reason\":\"claude exited\",\"stale_session_id\":\"{stale_id}\"}}\n"
            );
            child_stdout_write.write_all(frame.as_bytes()).await.unwrap();
            drop(child_stdout_write);
        });

        let (_input_tx_bridge, mut input_rx_bridge) = mpsc::channel::<Frame>(4);
        let (merger_tx, mut merger_rx) = mpsc::channel::<Frame>(4);
        let state_tx = sup.session_state_tx.clone();
        let cancel = CancellationToken::new();

        let stdin_box: Box<dyn tokio::io::AsyncWrite + Send + Unpin> = Box::new(bridge_stdin);
        let stdout_box: Box<dyn tokio::io::AsyncRead + Send + Unpin> = Box::new(bridge_stdout);
        let lines = BufReader::new(stdout_box).lines();

        let recorder = NoopSessionsRecorder;
        let outcome = relay_session_io(
            &tug_id,
            &entry_arc,
            &mut input_rx_bridge,
            &merger_tx,
            &state_tx,
            stdin_box,
            lines,
            "/tmp/test-relay-resume-fail",
            &recorder,
            &cancel,
        )
        .await;

        child_task.await.unwrap();

        match outcome {
            RelayOutcome::ResumeFailed {
                stale_session_id,
                reason,
            } => {
                assert_eq!(stale_session_id, stale_id);
                assert_eq!(reason, "claude exited");
            }
            other => panic!("expected ResumeFailed, got {other:?}"),
        }

        // The `resume_failed` frame must have been forwarded to the
        // merger (so the card-side `lastError` populates).
        let forwarded = merger_rx.try_recv().expect("resume_failed forwarded");
        let parsed: serde_json::Value =
            serde_json::from_slice(&forwarded.payload).unwrap();
        assert_eq!(parsed["type"], "resume_failed");
        assert_eq!(parsed["stale_session_id"], stale_id);
        assert_eq!(parsed["tug_session_id"], "sess-resume-fail");
    }

    #[tokio::test]
    async fn test_crash_budget_per_session() {
        // Two sessions spawn in parallel. A's spawner always errors; B's
        // stalls forever. After 3 retries A exhausts its budget, publishes
        // `errored{crash_budget_exhausted}`, and its bridge task returns.
        // B remains untouched. This test pins that each session has its
        // own `CrashBudget` instance per [D07] — one session's crash loop
        // does not disable a sibling. The retry delay is injected as a
        // sub-millisecond value so the test completes in wall-clock-time.
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let ((sup, mut state_rx, _meta_rx, _control_rx), _register_rx) =
            make_supervisor_with_spawner(store, stall_spawner_factory());

        let id_a = TugSessionId::new("sess-a");
        let id_b = TugSessionId::new("sess-b");
        let entry_a = insert_ledger_entry(&sup, &id_a).await;
        let entry_b = insert_ledger_entry(&sup, &id_b).await;

        let (_input_tx_a, input_rx_a) = mpsc::channel::<Frame>(4);
        let (_input_tx_b, input_rx_b) = mpsc::channel::<Frame>(4);
        let (merger_tx_a, _merger_rx_a) = mpsc::channel::<Frame>(4);
        let (merger_tx_b, _merger_rx_b) = mpsc::channel::<Frame>(4);

        let cancel_a = { entry_a.lock().await.cancel.clone() };
        let cancel_b = { entry_b.lock().await.cancel.clone() };

        let state_tx = sup.session_state_tx.clone();

        let retry_delay = Duration::from_micros(100);

        let recorder: Arc<dyn SessionsRecorder> = Arc::new(NoopSessionsRecorder);
        let a_handle = tokio::spawn(run_session_bridge(
            id_a.clone(),
            entry_a.clone(),
            input_rx_a,
            merger_tx_a,
            state_tx.clone(),
            Arc::new(CrashingSpawner) as Arc<dyn ChildSpawner>,
            PathBuf::from("/tmp/test-workspace-a"),
            SessionMode::New,
            recorder.clone(),
            cancel_a,
            retry_delay,
        ));
        let b_handle = tokio::spawn(run_session_bridge(
            id_b.clone(),
            entry_b.clone(),
            input_rx_b,
            merger_tx_b,
            state_tx.clone(),
            Arc::new(StallSpawner) as Arc<dyn ChildSpawner>,
            PathBuf::from("/tmp/test-workspace-b"),
            SessionMode::New,
            recorder,
            cancel_b.clone(),
            retry_delay,
        ));

        // Poll until session A's task finishes (3 crashes + the exhaustion
        // bail). With a 100µs retry delay this completes in well under a
        // millisecond; we give it up to 2 seconds to tolerate CI latency.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !a_handle.is_finished() && std::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }

        // Session A's task must have completed.
        assert!(
            a_handle.is_finished(),
            "session A bridge must exit after crash budget exhaustion"
        );

        // Session B's task must still be running (stalled in spawn_child).
        assert!(
            !b_handle.is_finished(),
            "session B bridge must not be disabled by session A's crash loop"
        );

        // Session A's ledger entry is in Errored state with no input_tx.
        {
            let entry = entry_a.lock().await;
            assert_eq!(entry.spawn_state, SpawnState::Errored);
            assert!(entry.input_tx.is_none());
        }

        // SESSION_STATE = errored{crash_budget_exhausted} must have been
        // published exactly for session A; no errored for session B.
        let mut a_errored = false;
        while let Ok(frame) = state_rx.try_recv() {
            let (id, state) = session_state_of(&frame);
            if state == "errored" {
                assert_eq!(id, "sess-a", "only session A should error");
                let v: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
                assert_eq!(v["detail"], "crash_budget_exhausted");
                a_errored = true;
            }
        }
        assert!(a_errored, "session A must publish errored state");

        // Tear down session B. Aborting rather than awaiting so a
        // regression where cancel doesn't reach a stalled spawner still
        // terminates the test quickly.
        b_handle.abort();
    }

    // ---- W2 Step 1: SessionKeyRecord schema + dual-read migration ----

    #[test]
    fn test_session_key_record_serde_roundtrip() {
        let record = SessionKeyRecord {
            tug_session_id: "sess-xyz".to_string(),
            project_dir: Some("/work/alpha".to_string()),
            claude_session_id: Some("claude-uuid-7".to_string()),
        };
        let json = serde_json::to_value(&record).expect("serialize");
        let parsed: SessionKeyRecord = serde_json::from_value(json).expect("deserialize");
        assert_eq!(parsed, record);
    }

    #[test]
    fn test_session_key_record_defaults_on_missing_optional_fields() {
        let json = serde_json::json!({ "tug_session_id": "abc" });
        let parsed: SessionKeyRecord = serde_json::from_value(json).expect("deserialize");
        assert_eq!(parsed.tug_session_id, "abc");
        assert_eq!(parsed.project_dir, None);
        assert_eq!(parsed.claude_session_id, None);
    }

    #[test]
    fn test_tugbank_list_session_records_reads_legacy_string() {
        let tmp = tempfile::NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open tugbank");

        // Simulate a pre-W2 blob written as a bare `Value::String`.
        client
            .set(
                SESSION_KEYS_DOMAIN,
                "card-legacy",
                Value::String("legacy-uuid".to_string()),
            )
            .expect("legacy set");

        let records = client.list_session_records().expect("list");
        assert_eq!(records.len(), 1);
        let (card_id, record) = &records[0];
        assert_eq!(card_id, "card-legacy");
        assert_eq!(record.tug_session_id, "legacy-uuid");
        assert_eq!(record.project_dir, None);
        assert_eq!(record.claude_session_id, None);
    }

    #[test]
    fn test_tugbank_list_session_records_reads_json() {
        let tmp = tempfile::NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open tugbank");

        let written = SessionKeyRecord {
            tug_session_id: "sess-w2".to_string(),
            project_dir: Some("/work/beta".to_string()),
            claude_session_id: Some("claude-42".to_string()),
        };
        client
            .set_session_record("card-w2", &written)
            .expect("set_session_record");

        let records = client.list_session_records().expect("list");
        assert_eq!(records.len(), 1);
        let (card_id, record) = &records[0];
        assert_eq!(card_id, "card-w2");
        assert_eq!(record, &written);
    }

    #[test]
    fn test_tugbank_list_session_records_skips_malformed_json() {
        let tmp = tempfile::NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open tugbank");

        // JSON value that does not deserialize to `SessionKeyRecord`
        // (missing the required `tug_session_id` field).
        client
            .set(
                SESSION_KEYS_DOMAIN,
                "card-bogus",
                Value::Json(serde_json::json!({ "bogus": 1 })),
            )
            .expect("bogus set");

        let records = client.list_session_records().expect("list");
        assert!(
            records.is_empty(),
            "malformed JSON must be skipped, got: {records:?}"
        );
    }

    // ================================================================
    // W2 Step 6: supervisor lifecycle hooks against the registry
    // ================================================================

    /// Count the live entries in the supervisor's registry map. Private
    /// inspection helper — real callers never need this.
    fn registry_map_len(sup: &AgentSupervisor) -> usize {
        // Access the crate-visible `inner` field via the test module's
        // privilege (both live under the same crate).
        use super::super::workspace_registry::WorkspaceRegistry;
        fn inspect(r: &WorkspaceRegistry) -> usize {
            // `inner` is pub(crate) — this file is in the same crate.
            r.inner_for_test().len()
        }
        inspect(&sup.registry)
    }

    #[tokio::test]
    async fn test_spawn_session_rejects_missing_project_dir() {
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        // Payload without `project_dir` — handle_control must reject with
        // `InvalidProjectDir { reason: "missing_project_dir" }` before any
        // ledger mutation.
        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "spawn_session",
            "card_id": "card-1",
            "tug_session_id": "sess-1",
        }))
        .unwrap();
        let err = sup
            .handle_control("spawn_session", &payload, 10)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            ControlError::InvalidProjectDir {
                reason: "missing_project_dir"
            }
        );
        assert!(sup.ledger.lock().await.is_empty());
        assert_eq!(registry_map_len(&sup), 0);
    }

    #[tokio::test]
    async fn test_spawn_session_rejects_nonexistent_project_dir() {
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        let payload = spawn_payload_in(
            "card-1",
            "sess-1",
            "/nonexistent/xyz-workspace-registry-test",
        );
        let err = sup
            .handle_control("spawn_session", &payload, 10)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            ControlError::InvalidProjectDir {
                reason: "does_not_exist"
            }
        );
        assert!(sup.ledger.lock().await.is_empty());
        assert_eq!(registry_map_len(&sup), 0);
    }

    #[tokio::test]
    async fn test_spawn_session_rejects_file_as_project_dir() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let file_path = tmp.path().join("not-a-dir.txt");
        std::fs::write(&file_path, b"nope").expect("write file");

        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);

        let payload = spawn_payload_in("card-1", "sess-1", file_path.to_str().unwrap());
        let err = sup
            .handle_control("spawn_session", &payload, 10)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            ControlError::InvalidProjectDir {
                reason: "not_a_directory"
            }
        );
        assert!(sup.ledger.lock().await.is_empty());
        assert_eq!(registry_map_len(&sup), 0);
    }

    #[tokio::test]
    async fn test_spawn_session_success_ack_includes_workspace_key() {
        let store: Arc<dyn SessionKeysStore> = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store(store);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        // The first frame on the control feed should be the success ack
        // with an echoed `workspace_key`.
        let ack = control_rx.try_recv().expect("spawn_session_ok ack");
        assert_eq!(ack.feed_id, FeedId::CONTROL);
        let v: serde_json::Value = serde_json::from_slice(&ack.payload).unwrap();
        assert_eq!(v["action"], "spawn_session_ok");
        assert_eq!(v["card_id"], "card-1");
        assert_eq!(v["tug_session_id"], "sess-1");
        let wk = v["workspace_key"].as_str().expect("workspace_key string");
        assert!(!wk.is_empty());
        // The ack's workspace_key must equal the canonical form produced
        // by WorkspaceRegistry::get_or_create, which is what tugcast
        // splices into FILETREE/FILESYSTEM/GIT frames. Load the live
        // entry from the ledger and cross-check.
        let tug_id = TugSessionId::new("sess-1");
        let entry_arc = sup.ledger.lock().await.get(&tug_id).unwrap().clone();
        let entry = entry_arc.lock().await;
        assert_eq!(wk, entry.workspace_key.as_ref());
    }

    #[tokio::test]
    async fn test_spawn_session_releases_on_persistence_failure() {
        // Inject a FailingWriteStore: persistence fails after workspace
        // acquisition. The supervisor must release the workspace refcount
        // so the registry map is empty on the failure path ([D05]).
        let store = Arc::new(FailingWriteStore::new());
        let (sup, _state_rx, _meta_rx, _control_rx) =
            make_supervisor_with_store(store as Arc<dyn SessionKeysStore>);

        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap_err();
        assert!(matches!(err, ControlError::PersistenceFailure(_)));

        // The workspace refcount bumped in Phase 0 must have been
        // released — the map should be empty.
        assert_eq!(registry_map_len(&sup), 0);
    }

    #[tokio::test]
    async fn test_two_sessions_same_workspace_share_entry() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, mut control_rx) =
            make_supervisor_with_store(store as Arc<dyn SessionKeysStore>);

        sup.handle_control("spawn_session", &spawn_payload("card-a", "sess-a"), 10)
            .await
            .unwrap();
        sup.handle_control("spawn_session", &spawn_payload("card-b", "sess-b"), 20)
            .await
            .unwrap();
        // Drain the two ack frames.
        let _ = control_rx.try_recv();
        let _ = control_rx.try_recv();

        // Same project_dir → same workspace entry; the registry map has
        // exactly one entry.
        assert_eq!(registry_map_len(&sup), 1);

        // Both ledger entries bind to the same workspace_key.
        let ledger = sup.ledger.lock().await;
        let entry_a = ledger.get(&TugSessionId::new("sess-a")).unwrap().clone();
        let entry_b = ledger.get(&TugSessionId::new("sess-b")).unwrap().clone();
        drop(ledger);
        let key_a = entry_a.lock().await.workspace_key.as_ref().to_string();
        let key_b = entry_b.lock().await.workspace_key.as_ref().to_string();
        assert_eq!(key_a, key_b);
    }

    #[tokio::test]
    async fn test_close_session_releases_workspace() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, mut control_rx) =
            make_supervisor_with_store(store as Arc<dyn SessionKeysStore>);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        let _ = control_rx.try_recv(); // drain ack
        assert_eq!(registry_map_len(&sup), 1);

        sup.handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        // Refcount should have hit zero; the workspace is removed.
        assert_eq!(registry_map_len(&sup), 0);
        assert!(sup.ledger.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_reset_session_preserves_workspace() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, mut control_rx) =
            make_supervisor_with_store(store as Arc<dyn SessionKeysStore>);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        let _ = control_rx.try_recv(); // drain ack

        // Capture the `Arc<WorkspaceEntry>` from the registry map BEFORE
        // reset so the post-reset comparison can use `Arc::ptr_eq` — a
        // stricter invariant than comparing workspace_key strings alone
        // (which can't distinguish release-and-reacquire from preserve).
        let tug_id = TugSessionId::new("sess-1");
        let workspace_key = {
            let ledger = sup.ledger.lock().await;
            let entry_arc = ledger.get(&tug_id).unwrap().clone();
            drop(ledger);
            entry_arc.lock().await.workspace_key.clone()
        };
        let workspace_entry_before = sup
            .registry
            .inner_for_test()
            .get(&workspace_key)
            .expect("workspace entry present before reset")
            .clone();

        sup.handle_control("reset_session", &reset_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        // [D11]: the workspace entry survives reset. Map still holds 1.
        assert_eq!(registry_map_len(&sup), 1);

        // Strict: the post-reset `Arc<WorkspaceEntry>` must be the SAME
        // Arc, not a replacement with the same key.
        let workspace_entry_after = sup
            .registry
            .inner_for_test()
            .get(&workspace_key)
            .expect("workspace entry present after reset")
            .clone();
        assert!(
            Arc::ptr_eq(&workspace_entry_before, &workspace_entry_after),
            "reset must preserve the exact Arc<WorkspaceEntry>, not just the key"
        );

        // And the ledger entry's workspace_key is unchanged.
        let workspace_key_after = {
            let ledger = sup.ledger.lock().await;
            let entry_arc = ledger.get(&tug_id).unwrap().clone();
            drop(ledger);
            entry_arc.lock().await.workspace_key.clone()
        };
        assert_eq!(workspace_key.as_ref(), workspace_key_after.as_ref());
    }

    #[tokio::test]
    async fn test_two_sessions_two_workspaces_do_not_share() {
        // Two TempDirs → two distinct canonical paths → two distinct
        // `WorkspaceEntry` Arcs. Belt-and-suspenders for the invariant
        // that `get_or_create` really does dedupe by path, and that
        // `test_two_sessions_same_workspace_share_entry` isn't passing
        // because the dedup logic is stuck in a one-workspace rut.
        let tmp_a = tempfile::TempDir::new().expect("tempdir a");
        let tmp_b = tempfile::TempDir::new().expect("tempdir b");
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, mut control_rx) =
            make_supervisor_with_store(store as Arc<dyn SessionKeysStore>);

        sup.handle_control(
            "spawn_session",
            &spawn_payload_in("card-a", "sess-a", tmp_a.path().to_str().unwrap()),
            10,
        )
        .await
        .unwrap();
        sup.handle_control(
            "spawn_session",
            &spawn_payload_in("card-b", "sess-b", tmp_b.path().to_str().unwrap()),
            20,
        )
        .await
        .unwrap();
        let _ = control_rx.try_recv(); // drain both acks
        let _ = control_rx.try_recv();

        // Two distinct workspaces in the registry.
        assert_eq!(registry_map_len(&sup), 2);

        // Distinct workspace_key strings on the ledger entries.
        let ledger = sup.ledger.lock().await;
        let entry_a = ledger.get(&TugSessionId::new("sess-a")).unwrap().clone();
        let entry_b = ledger.get(&TugSessionId::new("sess-b")).unwrap().clone();
        drop(ledger);
        let key_a = entry_a.lock().await.workspace_key.clone();
        let key_b = entry_b.lock().await.workspace_key.clone();
        assert_ne!(
            key_a.as_ref(),
            key_b.as_ref(),
            "distinct TempDirs must produce distinct workspace_keys"
        );

        // Strict: the two `Arc<WorkspaceEntry>` instances are distinct.
        let map = sup.registry.inner_for_test();
        let ws_a = map.get(&key_a).unwrap().clone();
        let ws_b = map.get(&key_b).unwrap().clone();
        drop(map);
        assert!(
            !Arc::ptr_eq(&ws_a, &ws_b),
            "distinct workspaces must be distinct Arcs"
        );
    }

    #[tokio::test]
    async fn test_spawn_session_reconnect_releases_refcount() {
        // Duplicate spawn on the same `tug_session_id` is a reconnect.
        // The second spawn's `get_or_create` bumps the workspace refcount
        // to 2, but the reconnect path in `do_spawn_session` releases the
        // extra refcount because the existing ledger entry already holds
        // one. Without that release, the refcount would leak one per
        // reconnect and the workspace would never tear down on close.
        //
        // This test nails that release-on-reconnect contract: the
        // registry map must still hold exactly one entry with
        // `ref_count == 1` after the second spawn.
        use std::sync::atomic::Ordering;

        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx, mut control_rx) =
            make_supervisor_with_store(store as Arc<dyn SessionKeysStore>);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();
        let _ = control_rx.try_recv(); // drain ack

        // Reconnect: same tug_session_id (and same project_dir), new card.
        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 11)
            .await
            .unwrap();
        let _ = control_rx.try_recv(); // drain second ack

        assert_eq!(registry_map_len(&sup), 1);

        // Read the single WorkspaceEntry and assert its refcount is 1,
        // not 2. A leak would show up as 2 here.
        let map = sup.registry.inner_for_test();
        assert_eq!(map.len(), 1);
        let (_key, ws) = map.iter().next().expect("one entry");
        assert_eq!(
            ws.ref_count.load(Ordering::Relaxed),
            1,
            "reconnect must release the just-acquired refcount"
        );
    }

    #[tokio::test]
    async fn test_rebind_drops_records_without_project_dir() {
        let store = Arc::new(InMemoryStore::default());
        // Legacy (pre-W2) record shape: project_dir = None.
        store
            .set_session_record(
                "card-legacy",
                &SessionKeyRecord {
                    tug_session_id: "sess-legacy".to_string(),
                    project_dir: None,
                    claude_session_id: None,
                },
            )
            .unwrap();

        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);
        let inserted = sup.rebind_from_tugbank().await.unwrap();
        assert_eq!(inserted, 0);
        assert!(sup.ledger.lock().await.is_empty());
        assert_eq!(registry_map_len(&sup), 0);
    }

    #[tokio::test]
    async fn test_rebind_drops_records_with_missing_path() {
        let store = Arc::new(InMemoryStore::default());
        store
            .set_session_record(
                "card-gone",
                &SessionKeyRecord {
                    tug_session_id: "sess-gone".to_string(),
                    project_dir: Some("/nonexistent/rebind-missing-path-test".to_string()),
                    claude_session_id: None,
                },
            )
            .unwrap();

        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);
        let inserted = sup.rebind_from_tugbank().await.unwrap();
        assert_eq!(inserted, 0);
        assert!(sup.ledger.lock().await.is_empty());
        assert_eq!(registry_map_len(&sup), 0);
    }

    #[tokio::test]
    async fn test_rebind_restores_workspace_entries_from_records() {
        let store = Arc::new(InMemoryStore::default());
        store
            .set_session_record(
                "card-valid",
                &SessionKeyRecord {
                    tug_session_id: "sess-valid".to_string(),
                    project_dir: Some(test_project_dir().to_string()),
                    claude_session_id: None,
                },
            )
            .unwrap();

        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store(store);
        let inserted = sup.rebind_from_tugbank().await.unwrap();
        assert_eq!(inserted, 1);

        let tug_id = TugSessionId::new("sess-valid");
        let ledger = sup.ledger.lock().await;
        let entry_arc = ledger.get(&tug_id).expect("entry").clone();
        drop(ledger);
        let entry = entry_arc.lock().await;
        assert_eq!(entry.project_dir.to_str().unwrap(), test_project_dir());
        assert!(!entry.workspace_key.as_ref().is_empty());
        // Registry holds exactly one entry for the rebound workspace.
        assert_eq!(registry_map_len(&sup), 1);
    }
}
