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
use std::sync::Arc;
use std::time::Duration;

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
    ChildSpawner, CrashBudget, DEFAULT_RETRY_DELAY, TugcodeSpawner, run_session_bridge,
};
use super::code::parse_tug_session_id;
use super::session_metadata::is_system_metadata;

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
    pub fn new(tug_session_id: TugSessionId, crash_budget: CrashBudget) -> Self {
        Self {
            tug_session_id,
            claude_session_id: None,
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
        let json = serde_json::to_value(record)
            .map_err(|e| SessionKeysStoreError(e.to_string()))?;
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
                    warn!(
                        card_id,
                        "non-json non-string session-keys entry; skipping"
                    );
                    continue;
                }
            };
            out.push((card_id, record));
        }
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// AgentSupervisor
// ---------------------------------------------------------------------------

/// Runtime configuration for [`AgentSupervisor`]. Concrete fields are added as
/// subsequent steps in the plan require them.
#[derive(Debug, Clone, Default)]
pub struct AgentSupervisorConfig {
    /// Absolute path to the tugcode binary (or `.ts` entry for bun fallback).
    /// Only consumed by the default [`TugcodeSpawner`] factory.
    pub tugcode_path: PathBuf,
    /// Working directory passed to tugcode as `--dir`.
    pub project_dir: PathBuf,
}

/// Factory that yields a fresh [`ChildSpawner`] for each session spawn. The
/// default factory returns [`TugcodeSpawner`]; tests pass a closure returning
/// a mock spawner so they can drive the bridge without a real subprocess.
pub type SpawnerFactory = Arc<dyn Fn() -> Arc<dyn ChildSpawner> + Send + Sync>;

/// Build the default production spawner factory from an
/// [`AgentSupervisorConfig`]. Each call to the factory clones the configured
/// paths into a fresh [`TugcodeSpawner`].
pub fn default_spawner_factory(config: &AgentSupervisorConfig) -> SpawnerFactory {
    let tugcode_path = config.tugcode_path.clone();
    let project_dir = config.project_dir.clone();
    Arc::new(move || {
        Arc::new(TugcodeSpawner::new(
            tugcode_path.clone(),
            project_dir.clone(),
        )) as Arc<dyn ChildSpawner>
    })
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
}

/// Registration sent through [`AgentSupervisor::merger_register_tx`] so the
/// merger task learns about a newly-spawned session worker's output stream.
pub type MergerRegistration = (TugSessionId, mpsc::Receiver<Frame>);

/// Owned form of a parsed CONTROL payload.
struct OwnedControlPayload {
    card_id: String,
    tug_session_id: TugSessionId,
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
    Ok(OwnedControlPayload {
        card_id,
        tug_session_id: TugSessionId::new(tug_session_id),
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
    pub fn new(
        session_state_tx: broadcast::Sender<Frame>,
        session_metadata_tx: broadcast::Sender<Frame>,
        code_output_tx: broadcast::Sender<Frame>,
        control_tx: broadcast::Sender<Frame>,
        store: Arc<dyn SessionKeysStore>,
        spawner_factory: SpawnerFactory,
        config: AgentSupervisorConfig,
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
            spawner_factory,
            merger_register_tx,
            config,
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
                self.do_spawn_session(&parsed.card_id, parsed.tug_session_id, client_id)
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
                self.do_close_session(&parsed.card_id, &parsed.tug_session_id, client_id)
                    .await;
                self.do_spawn_session(&parsed.card_id, parsed.tug_session_id, client_id)
                    .await
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
        client_id: ClientId,
    ) -> Result<(), ControlError> {
        // Phase 1: ledger get-or-insert + per-client affinity insert, atomic
        // under the outer ledger lock AND the client_sessions lock. Holding
        // both together closes the TOCTOU window per [R06] — a concurrent
        // close cannot interleave between the ledger insert and the
        // client_sessions insert. Lock order invariant: ledger first, then
        // client_sessions; applied everywhere in this module.
        let entry_arc: Arc<Mutex<LedgerEntry>> = {
            let mut ledger = self.ledger.lock().await;
            let arc = ledger
                .entry(tug_session_id.clone())
                .or_insert_with(|| {
                    Arc::new(Mutex::new(LedgerEntry::new(
                        tug_session_id.clone(),
                        CrashBudget::new(3, Duration::from_secs(60)),
                    )))
                })
                .clone();
            let mut cs = self.client_sessions.lock().await;
            cs.entry(client_id)
                .or_default()
                .insert(tug_session_id.clone());
            arc
        };

        // Phase 2: strict tugbank write per [D12]. Partial ledger/
        // client_sessions state on failure is tolerable (rewritten on retry);
        // silent failure is not.
        //
        // W2 Step 1: build the record shape with `project_dir = None` and
        // `claude_session_id = None`. Step 6 will thread the canonicalized
        // `project_dir` from the CONTROL payload into this callsite.
        let record = SessionKeyRecord {
            tug_session_id: tug_session_id.as_str().to_string(),
            project_dir: None,
            claude_session_id: None,
        };
        if let Err(e) = self.store.set_session_record(card_id, &record) {
            warn!(
                card_id,
                session = %tug_session_id,
                error = %e.0,
                "spawn_session: tugbank write failed"
            );
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
        {
            let mut entry = entry_arc.lock().await;
            entry.cancel.cancel();
            // Bare assignment (not `try_transition`) because the entry is
            // about to be dropped; we only care that any Arc-clone holder
            // observes `Closed` on its next lock acquire.
            entry.spawn_state = SpawnState::Closed;
        }

        // Phase 3: best-effort tugbank delete per [D12]. Lingering entries
        // are benign; a warn! is the loudest signal we want on this path.
        if let Err(e) = self.store.delete_session_key(card_id) {
            warn!(
                card_id,
                session = %tug_session_id,
                error = %e.0,
                "close_session: tugbank delete failed, continuing"
            );
        }

        // Phase 4: publish `closed`. (The `Arc<Mutex<LedgerEntry>>` we hold
        // is dropped at the end of this scope.)
        let _ =
            self.session_state_tx
                .send(build_session_state_frame(tug_session_id, "closed", None));
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
        tokio::spawn(async move {
            run_session_bridge(
                tug_session_id_owned,
                entry_arc_bridge,
                input_rx,
                merger_per_session_tx,
                state_tx,
                spawner,
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
        let mut ledger = self.ledger.lock().await;
        let mut inserted = 0usize;
        // W2 Step 1: we destructure the new record shape but still build
        // ledger entries from `tug_session_id` alone. Step 6 will teach this
        // path to bind workspaces and drop records with `project_dir = None`.
        for (_card_id, record) in entries {
            let tug_session_id = TugSessionId::new(record.tug_session_id);
            if ledger.contains_key(&tug_session_id) {
                continue;
            }
            let entry = LedgerEntry::new(
                tug_session_id.clone(),
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
    let (sup, register_rx) = AgentSupervisor::new(
        state_tx,
        meta_tx,
        code_tx,
        control_tx,
        store,
        factory,
        AgentSupervisorConfig::default(),
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
        fn spawn_child(&self) -> SpawnFuture {
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

    fn make_supervisor_with_store(
        store: Arc<dyn SessionKeysStore>,
    ) -> (
        AgentSupervisor,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
    ) {
        let ((sup, state_rx, meta_rx, control_rx), mut register_rx) =
            make_supervisor_with_spawner(store, stall_spawner_factory());
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
        let (state_tx, state_rx) = broadcast::channel(512);
        let (meta_tx, meta_rx) = broadcast::channel(32);
        let (code_tx, _code_rx) = broadcast::channel(32);
        let (control_tx, control_rx) = broadcast::channel(512);
        let (sup, register_rx) = AgentSupervisor::new(
            state_tx,
            meta_tx,
            code_tx,
            control_tx,
            store,
            spawner_factory,
            AgentSupervisorConfig::default(),
        );
        ((sup, state_rx, meta_rx, control_rx), register_rx)
    }

    fn spawn_payload(card_id: &str, tug_session_id: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "spawn_session",
            "card_id": card_id,
            "tug_session_id": tug_session_id,
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
        let entry = Arc::new(Mutex::new(LedgerEntry::new(
            tug_session_id.clone(),
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
        assert_eq!(rec.project_dir, None);
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
        store
            .set_session_record(
                "card-a",
                &SessionKeyRecord {
                    tug_session_id: "sess-a".to_string(),
                    project_dir: None,
                    claude_session_id: None,
                },
            )
            .unwrap();
        store
            .set_session_record(
                "card-b",
                &SessionKeyRecord {
                    tug_session_id: "sess-b".to_string(),
                    project_dir: None,
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
        fn spawn_child(&self) -> SpawnFuture {
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

        let outcome = relay_session_io(
            &tug_id,
            &entry_arc,
            &mut input_rx_bridge,
            &merger_tx,
            &state_tx,
            stdin_box,
            lines,
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

        let a_handle = tokio::spawn(run_session_bridge(
            id_a.clone(),
            entry_a.clone(),
            input_rx_a,
            merger_tx_a,
            state_tx.clone(),
            Arc::new(CrashingSpawner) as Arc<dyn ChildSpawner>,
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
}
