//! Agent supervisor module
//!
//! Houses the per-session ledger, SESSION_STATE / SESSION_SIDEBAND broadcast
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

use thiserror::Error;
use tokio::sync::{Mutex, broadcast, mpsc, watch};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::sync::CancellationToken;
use tracing::warn;
use tugcast_core::protocol::{FeedId, Frame, TugSessionId};

use super::agent_bridge::{
    ChildSpawner, CrashBudget, DEFAULT_RETRY_DELAY, SessionMode, TugcodeSpawner, run_session_bridge,
};
use super::code::{parse_tug_session_id, splice_tug_session_id};
use super::session_metadata::{
    is_activity_delta, is_rate_limit_event, is_session_capabilities, is_system_metadata,
    is_turn_end, is_wake_started,
};
use super::session_scoped::SessionScopedFeed;
use super::workspace_registry::{WorkspaceError, WorkspaceKey, WorkspaceRegistry};
#[cfg(test)]
use tugcast_core::LagPolicy;

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
/// The allowed transitions follow the internal supervisor state machine.
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

    /// Push an item at the **front** of the queue; returns
    /// [`QueuePush::Overflow`] if at capacity.
    ///
    /// Used by [`AgentSupervisor::do_request_replay`] (Step R4 / [D12])
    /// to ensure a `request_replay` verb queued during the Spawning
    /// window drains *before* any CODE_INPUT (user_message) the
    /// dispatcher may have buffered. This makes the verb's
    /// "rehydrate the freshly-mounted store" semantics precede any
    /// user input arriving in the same window — relevant for the
    /// Smoke D mid-turn case where the user types instantly after
    /// rebind. See [Phase A-R3](roadmap/tugplan-dev-transcript-resume.md#phase-a-r3)
    /// for the broader coordination story; R4's front-push is the
    /// minimum needed to keep cold-boot Spawning-window ordering
    /// sane without solving Smoke D end-to-end.
    pub fn push_front(&mut self, item: T) -> QueuePush {
        if self.inner.len() >= self.cap {
            QueuePush::Overflow
        } else {
            self.inner.push_front(item);
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
/// Shape follows the supervisor ledger contract. Notably, there is no
/// `ReplayBuffer` field — the CODE_OUTPUT replay buffer stays shared at the
/// router level per [D06]; the supervisor only routes `system_metadata`
/// per-session.
pub struct LedgerEntry {
    /// Client-authoritative UUID for this session.
    pub tug_session_id: TugSessionId,
    /// Populated once `session_init` arrives from the subprocess.
    pub claude_session_id: Option<String>,
    /// Canonical `WorkspaceKey` returned by `WorkspaceRegistry::get_or_create`.
    /// Used by `do_close_session` to call `registry.release`.
    pub workspace_key: WorkspaceKey,
    /// Caller-supplied path (pre-canonicalization). Passed to
    /// `ChildSpawner::spawn_child` in `run_session_bridge` as the spawned
    /// Claude Code process's cwd, and retained for reset-session to
    /// respawn without losing the binding.
    pub project_dir: PathBuf,
    /// User's spawn-time new-vs-resume choice.
    /// Forwarded as `--session-mode new|resume` to the tugcode subprocess.
    /// Reconnects reuse this value so the tugcode side of the session
    /// doesn't flip modes mid-life.
    pub session_mode: SessionMode,
    /// Deck-wide / per-card default permission mode tugdeck resolved at the
    /// first `spawn_session` for this session, forwarded to the tugcode
    /// subprocess as `--permission-mode` so the spawned claude starts in the
    /// right mode. Set once on the fresh insert and preserved across reconnects
    /// / crash-loop respawns (like `session_mode`) so the tugcode side doesn't
    /// flip modes mid-life. `None` when tugdeck sent no mode — tugcode keeps
    /// its own default.
    pub permission_mode: Option<String>,
    /// Provisional mnemonic tag tugdeck minted "from the drop" and sent on the
    /// first `spawn_session`. Set once on the fresh insert and preserved across
    /// reconnects (like `permission_mode`); the ledger's `record_spawn` claims
    /// or suffixes it authoritatively, and the final value rides back on
    /// `session_updated`. `None` when tugdeck sent no tag. Tug-side only — never
    /// forwarded into the child spawn args ([P07]).
    pub tag: Option<String>,
    /// Lifecycle state.
    pub spawn_state: SpawnState,
    /// Whether this entry currently owns a `WorkspaceRegistry` refcount for its
    /// `workspace_key`. Exactly one refcount belongs to a live entry for its
    /// lifetime; this flag is the single authority for who releases it.
    ///
    /// A fresh spawn (or the first spawn of an entry rebound from the ledger)
    /// adopts the `get_or_create` refcount and sets this `true`; a genuine
    /// reconnect of an entry that already owns one releases the excess and
    /// leaves this `true`; `do_close_session` releases iff this is `true`.
    ///
    /// Critically, an entry rebound by `rebind_from_ledger` starts `false` — the
    /// rebind registers no workspace (lazy, to avoid a boot-time canonicalize /
    /// TCC storm) — so `!inserted` alone must NOT be read as "a refcount is
    /// held." That mis-read tore down a resumed project's workspace on restore.
    pub holds_workspace_refcount: bool,
    /// Per-session crash budget (3 crashes / 60s by convention).
    pub crash_budget: CrashBudget,
    /// CODE_INPUT buffer used during the `Spawning` window.
    pub queue: BoundedQueue<Frame>,
    /// Latest `system_metadata` payload for this session, for on-subscribe
    /// replay per [D14].
    pub latest_metadata: Option<Frame>,
    /// Latest `session_capabilities` payload for this session, for
    /// on-subscribe replay. Distinct from `latest_metadata`: capabilities
    /// (the turn-free `initialize` model list / command catalog) are
    /// broadcast once per spawn, so a card that subscribes *after* that
    /// frame flew — reconnect, HMR remount, a late-binding card — would
    /// otherwise never see the model list and the `/model` picker would
    /// have no data. Retained here and replayed on bind, the same shape
    /// `latest_metadata` uses for `system_metadata`. In-memory only (not
    /// persisted to sqlite): capabilities are re-emitted fresh on the
    /// next spawn's handshake, so they need not survive a tugcast restart.
    pub latest_capabilities: Option<Frame>,
    /// Latest `rate_limit_event` payload for this session, for
    /// on-subscribe replay. Distinct slot from `latest_metadata` /
    /// `latest_capabilities`: the per-turn quota broadcast carries the
    /// Z4B rate-limit chip's state, and a card that binds *after* the
    /// last broadcast flew (reconnect, HMR remount) would otherwise show
    /// no quota state until the next turn re-broadcasts. That tail
    /// matters most precisely when the session is hard rate-limited — the
    /// user cannot start a turn to refresh it — so the last-known frame
    /// is replayed on bind, the same shape `latest_capabilities` uses.
    /// In-memory only (not persisted to sqlite): `resetsAt` is an
    /// absolute time that self-corrects on the next live broadcast, so a
    /// stale value need not survive a tugcast restart.
    pub latest_rate_limit: Option<Frame>,
    /// Owned subprocess handle when `Live`.
    pub child: Option<tokio::process::Child>,
    /// OS pid of the live tugcode child, captured at spawn as the activity
    /// sampler's subtree root ([P08]). `None` between spawns (before the
    /// bridge spawns, and after the relay tears the child down).
    pub child_pid: Option<u32>,
    /// The child's process start time (seconds since epoch), captured
    /// alongside `child_pid` as the PID-reuse guard baseline ([P20]). The
    /// sampler attributes the subtree only while the live pid's start time
    /// still matches this. `None` between spawns.
    pub child_start_time: Option<u64>,
    /// True while a turn is in flight — set by the dispatcher's inbound
    /// `user_message` intercept (and the merger's `wake_started` marker),
    /// cleared when the merger sees `turn_complete` / `turn_cancelled` or
    /// the relay tears the child down. The activity sampler attributes OS
    /// work only while this is set: Pulse measures the session *working*,
    /// not the idle claude process's event-loop heartbeat.
    pub turn_active: bool,
    /// Stdin sender when `Live`.
    pub input_tx: Option<mpsc::Sender<Frame>>,
    /// Cancels the per-session worker on `close_session`.
    pub cancel: CancellationToken,
    /// Card id this session is bound to. Set on the first
    /// `spawn_session` and preserved across lifecycle transitions
    /// (close, errored, crash-exhausted) so the persisted ledger row
    /// retains the binding for client-side restore. Liveness is encoded
    /// in `spawn_state`, not by nullity of this field; the
    /// "live-elsewhere" check in `do_spawn_session` gates on
    /// `spawn_state ∈ {Spawning, Live}` plus a card mismatch.
    pub card_id: Option<String>,
    /// Count of replay brackets currently in flight on this session's
    /// outbound stream — incremented on each `replay_started` the merger
    /// observes, saturating-decremented on each `replay_complete`. The
    /// merger's `apply_outbound_turn_intercept` skips its FIFO journal-pop
    /// work while this counter is non-zero, so replay-emitted
    /// `turn_complete` frames (from `translateJsonlSession`'s
    /// committed-turn output) don't get treated as live `turn_complete`s
    /// and don't pop the user's still-pending journal row. Mid-turn-replay
    /// [Step 5.10](roadmap/tugplan-dev-mid-turn-replay.md#step-5) is the
    /// post-Step-5.9 fix for the HMR-mid-stream regression.
    ///
    /// Counter (not bool) because a bridge that dies between emitting
    /// `replay_started` and emitting `replay_complete` (kill -9, panic,
    /// OOM before the `finally` runs) would, with a bool, leave the gate
    /// stuck-open forever. Using `u32::saturating_sub(1)` on
    /// `replay_complete` means stray closes are no-ops rather than
    /// underflowing into an enormous u32. tugcode's `runReplay`
    /// re-entrancy guard prevents legitimate overlapping brackets, so
    /// in healthy operation the counter is 0 between brackets and 1
    /// during a bracket; the counter shape is purely defense-in-depth
    /// against bridge-crash-mid-replay leaving stale state.
    pub replay_brackets_open: u32,
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
            permission_mode: None,
            tag: None,
            spawn_state: SpawnState::Idle,
            holds_workspace_refcount: false,
            crash_budget,
            queue: BoundedQueue::new(),
            latest_metadata: None,
            latest_capabilities: None,
            latest_rate_limit: None,
            child: None,
            child_pid: None,
            child_start_time: None,
            turn_active: false,
            input_tx: None,
            cancel: CancellationToken::new(),
            card_id: None,
            replay_brackets_open: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Ledger alias
// ---------------------------------------------------------------------------

/// Shared ledger map. Outer mutex guards membership; per-session mutex guards
/// the entry's mutable fields.
pub type Ledger = Arc<Mutex<HashMap<TugSessionId, Arc<Mutex<LedgerEntry>>>>>;

/// A session with a live tugcode child and its captured `(pid, start_time)` —
/// the activity sampler's per-session subtree root and reuse-guard baseline
/// ([P08], [P10], [P20]). Produced by [`AgentSupervisor::live_session_processes`].
#[derive(Debug, Clone)]
pub struct LiveSessionProcess {
    pub tug_session_id: TugSessionId,
    pub pid: u32,
    pub start_time: u64,
}

// ---------------------------------------------------------------------------
// SessionsRecorder — writer trait for the per-session ledger
// ---------------------------------------------------------------------------

/// Per-session metadata captured at session_init time.
///
/// The recorder uses `session_id` as the row key (the claude session id —
/// also the JSONL file name on disk). `card_id` populates the row's
/// `card_id` column on `record_spawn` and is preserved across
/// `mark_closed` / `mark_failed` so the persisted ledger retains the
/// binding for client-side restore.
#[derive(Debug, Clone, Copy)]
pub struct SessionRecord<'a> {
    pub session_id: &'a str,
    pub workspace_key: &'a str,
    pub project_dir: &'a str,
    pub card_id: &'a str,
    /// Provisional mnemonic tag carried from the `LedgerEntry`, claimed
    /// authoritatively by `record_spawn`. `None` when tugdeck sent none.
    pub tag: Option<&'a str>,
}

/// Writer for the per-session ledger.
///
/// Replaces the pre-ledger pair of `TugbankSessionsRecorder` (sessions
/// record) and `TugbankLiveSessionsTracker` (live-sessions broadcast). One
/// trait now expresses the full lifecycle: `record` (insert/promote to
/// live), `record_turn` (assistant turn complete), `mark_closed`
/// (close_session / clean exit), `mark_failed` (resume_failed / crash
/// budget exhausted), and `remove` (Trash UX in step 6).
///
/// No method has a default impl. Adding a method to this trait must force
/// every implementor to opt in explicitly — silently inheriting an old
/// behavior was the regression-shape that motivated the redesign.
pub trait SessionsRecorder: Send + Sync {
    /// Insert a fresh row, or transition an existing row back to `live` and
    /// rebind it to `record.card_id`. Called from the bridge on
    /// `session_init`, when the claude session id is first known.
    fn record(&self, record: SessionRecord<'_>);

    /// Increment turn count and bump `last_used_at`. No-op if the row is
    /// missing or not in `live` state — see the trash-vs-late-turn race
    /// note in the plan's risk table.
    fn record_turn(&self, session_id: &str);

    /// Overwrite the row's `turn_count` with the authoritative value — the
    /// `totalTurns` a successful replay reports. Unlike `record_turn` (which
    /// increments), this SETs, reconciling any prior estimate / `MAX` seed to
    /// the segmenter's exact count. Live `record_turn`s then build on this
    /// base. No-op if the row is missing or not in `live` state.
    fn set_turn_count(&self, session_id: &str, count: i64);

    /// `engine(session file)` for `session_id` under `project_dir` — the
    /// single count authority ([P08]). The resume reconcile reads this (the
    /// fingerprint-validated cached value, or the engine run on the resolved
    /// file when no cache entry exists) instead of the wire's `totalTurns`,
    /// so the picker count never shifts on open. `None` when the file is
    /// missing/unreadable or foreign (cwd/sessionId mismatch).
    fn engine_turn_count(&self, session_id: &str, project_dir: &str) -> Option<i64>;

    /// Capture the most-recent user-message text for a session,
    /// truncated to the picker-snippet length. Overwrites the previous
    /// snippet on every call — the picker shows the latest prompt so the
    /// user recognizes the most-recent thread of conversation.
    fn record_user_prompt(&self, session_id: &str, prompt: &str);

    /// Transition the row to `closed` and clear the live-card binding.
    /// Called on `close_session` and on bridge teardown after a successful
    /// `result` event.
    fn mark_closed(&self, session_id: &str);

    /// Transition the row to `failed` and clear the live-card binding.
    /// Called on `resume_failed` and crash-budget exhaustion. Replaces the
    /// pre-ledger semantic of removing the row entirely; the row survives
    /// as a diagnostic crumb until age eviction or explicit Trash.
    fn mark_failed(&self, session_id: &str);

    /// Delete the row for `session_id`. Used by the Trash UX (step 6).
    /// The bridge does not call this; lifecycle endings use `mark_closed` or
    /// `mark_failed` instead.
    fn remove(&self, session_id: &str);

    /// Cap-evict the oldest non-live row in `workspace_key` if the cap is
    /// exceeded. The bridge calls this after each successful `record` so a
    /// fresh spawn never pushes the workspace's non-live row count above
    /// the cap. No-op if under cap.
    fn evict_for_workspace(&self, workspace_key: &str, cap: usize);

    /// Insert a fresh row in the submission journal for this session.
    /// Called from the supervisor's `dispatch_one` intercept on every
    /// inbound `user_message`, BEFORE the frame is forwarded to tugcode.
    /// The "row-persisted-before-forwarded" invariant means a failure
    /// here drops the inbound frame (the supervisor emits an error frame
    /// on CONTROL); a forwarded frame with no row is structurally
    /// impossible because the forward only happens after this call
    /// returns `Ok`. The journal id is internal to tugcast — it is not
    /// surfaced on the wire and tugcode never sees it. See [DM08] in the
    /// mid-turn-replay plan for the never-drop chain audit.
    ///
    /// Returns `Result` because the dispatcher's decision to forward
    /// depends on insert success. Sibling
    /// `delete_oldest_pending_for_session` runs after the wire-side
    /// broadcast (forward-before-mutate), so its `Result` is treated as
    /// telemetry — the wire is the source of truth for the live UI; the
    /// journal lagging by one update is a warn, not a user-facing error.
    fn insert_pending_turn(
        &self,
        session_id: &str,
        journal_id: &str,
        user_text: &str,
        user_attachments: &[serde_json::Value],
        now: i64,
    ) -> Result<(), crate::session_ledger::LedgerError>;

    /// Delete the oldest pending journal row for `session_id` (FIFO match
    /// by `created_at` ASC). Called from the supervisor's merger
    /// intercept on every outbound `turn_complete` / `turn_cancelled` —
    /// claude has acknowledged the user's submission, so the journal
    /// row's reason for existing (rendering the submission as
    /// awaiting-response on resume) is gone.
    ///
    /// Returns the deleted row's content for logging, or `None` if
    /// there were no pending rows for the session. The frame has
    /// already been broadcast on the code_output feed before this fires
    /// (forward-before-mutate), so a `LedgerError` here is a
    /// telemetry warn, not a user-visible failure.
    fn delete_oldest_pending_for_session(
        &self,
        session_id: &str,
    ) -> Result<Option<crate::session_ledger::JournalRow>, crate::session_ledger::LedgerError>;
}

/// Production implementation backed by a shared [`SessionLedger`].
///
/// Optionally broadcasts a `session_updated` push frame on the CONTROL feed
/// after each successful write so connected clients can patch their local
/// caches without re-fetching. Production uses the broadcast-enabled
/// constructor; tests use the no-broadcast variant.
pub struct LedgerSessionsRecorder {
    ledger: Arc<crate::session_ledger::SessionLedger>,
    control_tx: Option<broadcast::Sender<Frame>>,
}

impl LedgerSessionsRecorder {
    pub fn new(ledger: Arc<crate::session_ledger::SessionLedger>) -> Self {
        Self {
            ledger,
            control_tx: None,
        }
    }

    pub fn with_broadcast(
        ledger: Arc<crate::session_ledger::SessionLedger>,
        control_tx: broadcast::Sender<Frame>,
    ) -> Self {
        Self {
            ledger,
            control_tx: Some(control_tx),
        }
    }

    /// Broadcast the current state of `session_id`'s ledger row, if a
    /// control feed is configured. No-op if the row was already deleted by
    /// the time we look it up (eviction race) — the deletion path emits its
    /// own `session_updated { removed: true }` push.
    fn broadcast_row(&self, session_id: &str) {
        let Some(tx) = self.control_tx.as_ref() else {
            return;
        };
        match self.ledger.get(session_id) {
            Ok(Some(row)) => {
                let _ = tx.send(build_session_updated_frame(&row));
            }
            Ok(None) => {}
            Err(err) => warn!(error = %err, session_id, "ledger get for broadcast failed"),
        }
    }

    fn broadcast_removed(&self, session_id: &str) {
        let Some(tx) = self.control_tx.as_ref() else {
            return;
        };
        let _ = tx.send(build_session_removed_frame(session_id));
    }

    /// Internal helper used by the trait method; kept inline here so the
    /// supervisor's broadcast path can be exercised by integration tests.
    fn evict_for_workspace_impl(&self, workspace_key: &str, cap: usize) {
        match self.ledger.evict_oldest_closed(workspace_key, cap) {
            Ok(evicted) => {
                for id in &evicted {
                    self.broadcast_removed(id);
                    tracing::info!(
                        target: "dev::session-lifecycle",
                        event = "ledger.evict_cap",
                        session_id = id.as_str(),
                        workspace_key,
                    );
                }
            }
            Err(err) => warn!(error = %err, workspace_key, "ledger evict_oldest_closed failed"),
        }
    }

    /// Age-sweep the ledger, dropping every non-live row whose
    /// `last_used_at` is older than `max_age_ms`. Broadcasts
    /// `session_updated { removed: true }` for each dropped id.
    /// Called from `main.rs` at tugcast startup.
    pub fn sweep_expired_with_broadcast(&self, max_age_ms: i64, now: i64) {
        match self.ledger.sweep_expired(max_age_ms, now) {
            Ok(swept) => {
                for id in &swept {
                    self.broadcast_removed(id);
                    tracing::info!(
                        target: "dev::session-lifecycle",
                        event = "ledger.evict_age",
                        session_id = id.as_str(),
                    );
                }
            }
            Err(err) => warn!(error = %err, "ledger sweep_expired failed"),
        }
    }

    /// Drop every non-live row whose `project_dir` matches the given path.
    /// Used by the recents-eviction → ledger-eviction coupling: when a
    /// path falls off the dev recent-projects tail, the matching ledger
    /// rows go too. Broadcasts a removed push per dropped id.
    pub fn trash_for_project_dir(&self, project_dir: &str) -> usize {
        match self.ledger.trash_for_project_dir(project_dir) {
            Ok(dropped) => {
                for id in &dropped {
                    self.broadcast_removed(id);
                    tracing::info!(
                        target: "dev::session-lifecycle",
                        event = "ledger.trash_project_dir",
                        session_id = id.as_str(),
                        project_dir,
                    );
                }
                dropped.len()
            }
            Err(err) => {
                warn!(error = %err, project_dir, "ledger trash_for_project_dir failed");
                0
            }
        }
    }
}

impl SessionsRecorder for LedgerSessionsRecorder {
    fn record(&self, record: SessionRecord<'_>) {
        let now = crate::session_ledger::now_millis();
        if let Err(err) = self.ledger.record_spawn(
            record.session_id,
            record.workspace_key,
            record.project_dir,
            record.card_id,
            now,
            record.tag,
        ) {
            warn!(error = %err, session_id = record.session_id, "ledger record_spawn failed");
            return;
        }
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "ledger.record_spawn",
            session_id = record.session_id,
            workspace_key = record.workspace_key,
            project_dir = record.project_dir,
            card_id = record.card_id,
        );
        self.broadcast_row(record.session_id);
    }

    fn record_turn(&self, session_id: &str) {
        let now = crate::session_ledger::now_millis();
        if let Err(err) = self.ledger.record_turn(session_id, now) {
            warn!(error = %err, session_id, "ledger record_turn failed");
            return;
        }
        tracing::debug!(
            target: "dev::session-lifecycle",
            event = "ledger.record_turn",
            session_id,
        );
        self.broadcast_row(session_id);
    }

    fn set_turn_count(&self, session_id: &str, count: i64) {
        let now = crate::session_ledger::now_millis();
        if let Err(err) = self.ledger.set_turn_count(session_id, count, now) {
            warn!(error = %err, session_id, count, "ledger set_turn_count failed");
            return;
        }
        tracing::debug!(
            target: "dev::session-lifecycle",
            event = "ledger.set_turn_count",
            session_id,
            count,
        );
        self.broadcast_row(session_id);
    }

    fn engine_turn_count(&self, session_id: &str, project_dir: &str) -> Option<i64> {
        crate::external_sessions::engine_turn_count(&self.ledger, project_dir, session_id)
    }

    fn record_user_prompt(&self, session_id: &str, prompt: &str) {
        if let Err(err) = self.ledger.record_user_prompt(session_id, prompt) {
            // `NotFound` means the row was never created (claude_session_id
            // was missing from `session_init`). Other errors are real
            // sqlite failures worth logging at warn level.
            match err {
                crate::session_ledger::LedgerError::NotFound(_) => {}
                _ => warn!(error = %err, session_id, "ledger record_user_prompt failed"),
            }
            return;
        }
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "ledger.record_user_prompt",
            session_id,
            len = prompt.chars().count(),
        );
        self.broadcast_row(session_id);
    }

    fn mark_closed(&self, session_id: &str) {
        if let Err(err) = self.ledger.mark_closed(session_id) {
            warn!(error = %err, session_id, "ledger mark_closed failed");
            return;
        }
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "ledger.mark_closed",
            session_id,
        );
        self.broadcast_row(session_id);
    }

    fn mark_failed(&self, session_id: &str) {
        if let Err(err) = self.ledger.mark_failed(session_id) {
            warn!(error = %err, session_id, "ledger mark_failed failed");
            return;
        }
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "ledger.mark_failed",
            session_id,
        );
        self.broadcast_row(session_id);
    }

    fn remove(&self, session_id: &str) {
        match self.ledger.trash(session_id) {
            Ok(_) => {
                tracing::info!(
                    target: "dev::session-lifecycle",
                    event = "ledger.remove",
                    session_id,
                );
                self.broadcast_removed(session_id);
            }
            Err(err) => warn!(error = %err, session_id, "ledger trash failed"),
        }
    }

    fn evict_for_workspace(&self, workspace_key: &str, cap: usize) {
        self.evict_for_workspace_impl(workspace_key, cap);
    }

    fn insert_pending_turn(
        &self,
        session_id: &str,
        journal_id: &str,
        user_text: &str,
        user_attachments: &[serde_json::Value],
        now: i64,
    ) -> Result<(), crate::session_ledger::LedgerError> {
        self.ledger.insert_pending_turn(
            session_id,
            journal_id,
            user_text,
            user_attachments,
            now,
        )?;
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "ledger.insert_pending_turn",
            session_id,
            journal_id,
        );
        Ok(())
    }

    fn delete_oldest_pending_for_session(
        &self,
        session_id: &str,
    ) -> Result<Option<crate::session_ledger::JournalRow>, crate::session_ledger::LedgerError> {
        let popped = self.ledger.delete_oldest_pending_for_session(session_id)?;
        if let Some(row) = popped.as_ref() {
            tracing::info!(
                target: "dev::ledger",
                event = "turn_seen_journal_row_deleted",
                session_id,
                journal_id = %row.journal_id,
            );
        }
        Ok(popped)
    }
}

/// Build the `session_updated` push payload for a row's current state.
/// Public so the `do_trash_session` / `do_trash_project_dir_sessions`
/// handlers can emit the matching frame after their batch writes.
pub fn build_session_updated_frame(row: &crate::session_ledger::SessionRow) -> Frame {
    let body = serde_json::json!({
        "action": "session_updated",
        "session_id": row.session_id,
        "fields": {
            "session_id": row.session_id,
            "workspace_key": row.workspace_key,
            "project_dir": row.project_dir,
            "created_at": row.created_at,
            "last_used_at": row.last_used_at,
            "turn_count": row.turn_count,
            "last_user_prompt": row.last_user_prompt,
            "state": row.state,
            "card_id": row.card_id,
            "name": row.name,
            "name_user_set": row.name_user_set,
            "tag": row.tag,
        },
    });
    Frame::new(
        FeedId::CONTROL,
        serde_json::to_vec(&body).expect("session_updated serializes"),
    )
}

/// Build the `session_updated { removed: true }` push for a deleted row.
pub fn build_session_removed_frame(session_id: &str) -> Frame {
    let body = serde_json::json!({
        "action": "session_updated",
        "session_id": session_id,
        "removed": true,
    });
    Frame::new(
        FeedId::CONTROL,
        serde_json::to_vec(&body).expect("session_updated removed serializes"),
    )
}

// ---------------------------------------------------------------------------
// AgentSupervisor
// ---------------------------------------------------------------------------

/// Runtime configuration for [`AgentSupervisor`].
///
/// Per-session `project_dir` — the supervisor no longer has a global
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
    /// Override for the Claude Code terminal-liveness registry root
    /// (`~/.claude/sessions/` in production). `None` resolves the
    /// default at use time; tests inject a tempdir (or a nonexistent
    /// path) so they never read the developer's real registry.
    pub terminal_registry_root: Option<PathBuf>,
}

impl Default for AgentSupervisorConfig {
    fn default() -> Self {
        Self {
            tugcode_path: PathBuf::new(),
            max_concurrent_sessions: 8,
            max_spawns_per_minute: 20,
            terminal_registry_root: None,
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

/// Result of dispatching a CONTROL frame's `action` to the supervisor.
///
/// A single value covers the three outcomes the router needs to
/// distinguish:
///
/// * [`ControlOutcome::Handled`] — the action belongs to the supervisor
///   and ran cleanly.
/// * [`ControlOutcome::Error`] — the action belongs to the supervisor
///   but the payload was malformed or rejected; the router maps the
///   variant to a wire-side `detail` string and emits a CONTROL error
///   frame on the in-scope socket.
/// * [`ControlOutcome::PassThrough`] — the action does not belong to
///   the supervisor; the router falls through to its legacy
///   `dispatch_action` pipeline (relaunch, dev-mode toggles, etc.).
///
/// Returning the outcome from [`AgentSupervisor::handle_control`] makes
/// the match arms inside `handle_control` the single source of truth
/// for "which CONTROL actions the supervisor owns." The router does not
/// keep a separate allowlist that has to be maintained alongside the
/// dispatch table — drift between the two surfaces is impossible by
/// construction. A new arm in `handle_control` is automatically
/// reachable from the websocket; an action with no arm naturally falls
/// to `PassThrough` via the catch-all.
#[derive(Debug)]
pub enum ControlOutcome {
    /// Action handled successfully.
    Handled,
    /// Action belongs to the supervisor but failed validation or
    /// payload parsing. The router emits a CONTROL error frame.
    Error(ControlError),
    /// Action does not belong to the supervisor. The router falls
    /// through to `dispatch_action`.
    PassThrough,
}

#[cfg(test)]
impl ControlOutcome {
    /// Test-only: panic unless the outcome is `Handled`. Mirrors the
    /// `Result::unwrap` ergonomics tests had before `handle_control`'s
    /// signature changed.
    pub(crate) fn expect_handled(self) {
        match self {
            ControlOutcome::Handled => {}
            other => panic!("expected ControlOutcome::Handled, got {other:?}"),
        }
    }

    /// Test-only: panic with `msg` unless the outcome is `Handled`.
    /// Mirrors `Result::expect`. Used where a test wants to attach
    /// context to the failure ("first spawn admitted", etc.).
    pub(crate) fn expect_handled_with(self, msg: &str) {
        match self {
            ControlOutcome::Handled => {}
            other => panic!("{msg}: expected ControlOutcome::Handled, got {other:?}"),
        }
    }

    /// Test-only: extract the `ControlError` from an `Error` outcome.
    /// Panics on any other variant.
    pub(crate) fn expect_error(self) -> ControlError {
        match self {
            ControlOutcome::Error(e) => e,
            other => panic!("expected ControlOutcome::Error, got {other:?}"),
        }
    }

    pub(crate) fn is_handled(&self) -> bool {
        matches!(self, ControlOutcome::Handled)
    }

    pub(crate) fn is_pass_through(&self) -> bool {
        matches!(self, ControlOutcome::PassThrough)
    }
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
    /// `reason` is a compile-time string from the set defined in
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
    /// The SESSION_STATE feed — a session-scoped publishing surface
    /// (splice discipline + lag policy live on the handle).
    pub session_state: SessionScopedFeed,
    /// The SESSION_SIDEBAND feed. Broadcast — not watch — per [D14] so
    /// concurrent per-session metadata updates cannot clobber one another.
    pub session_sideband: SessionScopedFeed,
    /// Per-client session affinity, used by the P5 authorization cross-check.
    pub client_sessions: Arc<Mutex<HashMap<ClientId, HashSet<TugSessionId>>>>,
    /// The shared supervisor-wide CODE_OUTPUT feed. Publishing through
    /// the handle keeps the lag-recovery replay buffer fed ([D06]: the
    /// buffer is cross-session; the deck filter provides isolation [D11]).
    pub code_output: SessionScopedFeed,
    /// The ACTIVITY feed ([P14], `FeedId::ACTIVITY`). The merger diverts
    /// tugcode's `activity_delta` frames onto it (re-tagged, splice
    /// preserved) so a per-session activity sample stream reaches the deck
    /// without riding the high-churn CODE_OUTPUT transcript. Broadcast with
    /// `LagPolicy::Warn` ([P17]): a dropped sample bin is a negligible gap.
    pub activity: SessionScopedFeed,
    /// Outbound CONTROL broadcast sender — used for `session_unknown`,
    /// `session_backpressure`, and other supervisor-emitted error frames.
    pub control_tx: broadcast::Sender<Frame>,
    /// Writer for the per-session ledger. The bridge calls `record` on
    /// `session_init`, `record_turn` on each tugcode `result` event, and
    /// `mark_failed` on `resume_failed` / crash exhaustion. The supervisor
    /// calls `mark_closed` on `do_close_session`. The Trash UX (step 6)
    /// uses `remove`. The live-elsewhere check during spawn reads the
    /// in-memory `LedgerEntry::card_id` and gates on `spawn_state`; the
    /// ledger row's `card_id` mirrors the in-memory value so the
    /// client-side restore can reconstruct the binding after a tugcast
    /// restart.
    pub sessions_recorder: Arc<dyn SessionsRecorder>,
    /// Read handle to the same [`SessionLedger`] the recorder writes to.
    /// Used for the read-side CONTROL ops (`list_sessions`, the picker's
    /// query path) and the batch Trash paths. Named `session_ledger` to
    /// avoid colliding with the in-memory `ledger` field above. Optional
    /// so unit tests that pass a `NoopSessionsRecorder` aren't forced to
    /// wire a ledger they won't read from. `None` makes the new ledger
    /// CONTROL ops short-circuit with an empty / no-op response.
    pub session_ledger: Option<Arc<crate::session_ledger::SessionLedger>>,
    /// The shell-exchange ledger, read by the `list_shell_exchanges` CONTROL op
    /// (the shell service writes it; the supervisor reads it). `None` in tests
    /// that don't exercise the shell restore path — the read yields an empty
    /// array. Set via [`AgentSupervisor::set_shell_ledger`] in `main.rs`.
    pub shell_ledger: Option<Arc<crate::shell_ledger::ShellLedger>>,
    /// The changeset scribe ([P11]/[P21]) — spawner + model resolver behind the
    /// maintained-draft engine. `None` (tests, or a boot without wiring) makes
    /// [`AgentSupervisor::start_draft_engine`] a no-op. Set via
    /// [`AgentSupervisor::set_scribe`] in `main.rs`.
    pub scribe: Option<ScribeContext>,
    /// Per-spawn factory for the backing subprocess. Swapped for a mock in
    /// tests so unit tests do not need a real tugcode binary.
    pub spawner_factory: SpawnerFactory,
    /// Register side of the merger task's per-session stream map. Each
    /// `spawn_session_worker` call pushes a `(tug_session_id, output_rx)`
    /// pair through here; `merger_task` inserts it into its internal
    /// `StreamMap` and fans the frames into the shared CODE_OUTPUT
    /// broadcast + SESSION_SIDEBAND broadcast.
    pub merger_register_tx: mpsc::Sender<MergerRegistration>,
    /// Runtime configuration.
    pub config: AgentSupervisorConfig,
    /// Per-workspace feed registry. `do_spawn_session` calls
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
    /// Latest CHANGESET_ALL aggregate watch receiver, stored at boot by
    /// [`AgentSupervisor::start_draft_engine`]. `do_changeset_draft_request`
    /// borrows its current frame to resolve an on-demand draft against the
    /// latest snapshot ([P03]). `None` (its unset state) when the draft path
    /// isn't wired (tests, or a boot without the aggregate feed).
    pub changeset_watch: std::sync::OnceLock<watch::Receiver<Frame>>,
}

/// Registration sent through [`AgentSupervisor::merger_register_tx`] so the
/// merger task learns about a newly-spawned session worker's output stream.
pub type MergerRegistration = (TugSessionId, mpsc::Receiver<Frame>);

/// Wire shape of the `terminal_live` annotation on a listed session:
/// present iff a live process outside this supervisor (typically the
/// Claude Code terminal app) currently holds the session, carrying its
/// busy/idle status.
#[derive(Debug, serde::Serialize)]
pub struct TerminalLiveWire {
    pub status: &'static str,
}

/// One row of `list_sessions_ok` — the persisted/synthesized
/// `SessionRow` fields plus provenance (`origin`) and the
/// terminal-liveness annotation. `origin: "tug"` rows come from the
/// sqlite ledger; `origin: "external"` rows were discovered on disk
/// (sessions Tug never spawned, typically terminal-created) and have
/// their `SessionRow` fields synthesized: `state: "closed"`,
/// `card_id: null`, `workspace_key` set to the encoded claude project
/// directory name (no canonical workspace was ever registered for
/// them).
#[derive(Debug, serde::Serialize)]
pub struct ListedSession {
    #[serde(flatten)]
    pub row: crate::session_ledger::SessionRow,
    pub origin: &'static str,
    pub terminal_live: Option<TerminalLiveWire>,
    /// On-disk JSONL size in bytes, from the external scan. `None` when the
    /// session has not been scanned (e.g. a live ledger row in the phase-1
    /// preview, before the scan settles). The picker renders this instead of
    /// a turn count — an orthogonal "how big" signal, not a message proxy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<i64>,
}

/// Build the picker's `list_sessions` row union from a ledger snapshot, a
/// terminal-liveness map, and (optionally) an external-session scan.
///
/// Ledger rows are tagged `origin: "tug"`; external scan rows not already
/// owned by the ledger are tagged `origin: "external"` with their
/// `SessionRow` fields synthesized (`state: closed`, `card_id: null`,
/// `workspace_key`/`project_dir` set to the scan's canonical dir — the form
/// claude's directory name encodes, so trash re-derives the JSONL path).
/// Every row is annotated with `terminal_live` from `live`, and the result
/// is sorted newest-first by `last_used_at`.
///
/// `scan: None` yields the ledger-only preview (phase 1); `Some` yields the
/// settled union (phase 2). Both phases route through this one builder so
/// their annotation, dedupe, and ordering can never drift.
fn build_listed_union(
    rows: Vec<crate::session_ledger::SessionRow>,
    live: &HashMap<String, crate::terminal_registry::TerminalLiveEntry>,
    scan: Option<crate::external_sessions::ScanOutcome>,
) -> Vec<ListedSession> {
    let annotate = |session_id: &str| {
        live.get(session_id).map(|e| TerminalLiveWire {
            status: e.status.as_wire_str(),
        })
    };
    let mut listed: Vec<ListedSession> = Vec::with_capacity(rows.len());
    for row in rows {
        let terminal_live = annotate(&row.session_id);
        listed.push(ListedSession {
            row,
            origin: "tug",
            terminal_live,
            // Backfilled below from the scan meta when this session is on
            // disk; stays None for live-only ledger rows.
            file_size: None,
        });
    }
    if let Some(scan) = scan {
        // Index the scan metas so ledger rows can absorb fresher on-disk
        // content; whatever remains un-absorbed becomes a synthesized
        // external row.
        let mut metas_by_id: HashMap<String, crate::external_sessions::ExternalSessionMeta> = scan
            .metas
            .into_iter()
            .map(|m| (m.session_id.clone(), m))
            .collect();
        for entry in &mut listed {
            let Some(meta) = metas_by_id.remove(&entry.row.session_id) else {
                continue;
            };
            // Surface the on-disk size for the picker's size readout.
            entry.file_size = Some(meta.file_size);
            // The ledger row owns identity and lifecycle (state, card
            // binding, user-assigned name); the transcript on disk owns
            // content. When the JSONL is newer than the ledger's last
            // write — a session continued in the terminal, or a ledger
            // row that predates the transcript's tail — surface the
            // scan's content fields. Holes (zero turns, missing
            // prompt/name) backfill from the scan regardless of
            // recency: a sparser row never beats a richer one.
            let disk_fresher = meta.file_mtime > entry.row.last_used_at;
            if disk_fresher {
                entry.row.last_used_at = meta.last_used_at;
            }
            if (disk_fresher && meta.last_user_prompt.is_some())
                || entry.row.last_user_prompt.is_none()
            {
                entry.row.last_user_prompt = meta.last_user_prompt;
            }
            entry.row.turn_count = entry.row.turn_count.max(meta.turn_count);
            if entry.row.name.is_none() {
                entry.row.name = meta.name;
            }
        }
        let synthetic_workspace_key =
            crate::session_ledger::encode_claude_project_name(&scan.canonical_project_dir);
        for (_, meta) in metas_by_id {
            let terminal_live = annotate(&meta.session_id);
            let file_size = Some(meta.file_size);
            listed.push(ListedSession {
                row: crate::session_ledger::SessionRow {
                    session_id: meta.session_id,
                    workspace_key: synthetic_workspace_key.clone(),
                    project_dir: scan.canonical_project_dir.clone(),
                    created_at: meta.created_at,
                    last_used_at: meta.last_used_at,
                    turn_count: meta.turn_count,
                    last_user_prompt: meta.last_user_prompt,
                    state: crate::session_ledger::SessionState::Closed,
                    card_id: None,
                    name: meta.name,
                    // A scanned `aiTitle` is never a user rename.
                    name_user_set: false,
                    // Scanned external rows carry no tag; they acquire one lazily
                    // on their next resume ([P06]).
                    tag: None,
                },
                origin: "external",
                terminal_live,
                file_size,
            });
        }
    }
    listed.sort_by(|a, b| b.row.last_used_at.cmp(&a.row.last_used_at));
    listed
}

/// Owned form of a parsed CONTROL payload.
struct OwnedControlPayload {
    card_id: String,
    tug_session_id: TugSessionId,
    /// per-session workspace path. `None` for close/reset
    /// payloads (which don't need it); `Some` for spawn payloads and
    /// rejected with `InvalidProjectDir { reason: "missing_project_dir" }`
    /// if absent on the spawn path.
    project_dir: Option<String>,
    /// New-vs-resume choice. Absent values default to
    /// `SessionMode::New` so pre-4.5 payloads keep the step-4k behavior.
    session_mode: SessionMode,
    /// Deck-wide / per-card default permission mode tugdeck resolved at spawn
    /// time, forwarded to tugcode as `--permission-mode`. `None` when the
    /// payload omits it (older client, or a card with no configured default) —
    /// the string is passed through opaquely; tugcode validates it.
    permission_mode: Option<String>,
    /// Provisional mnemonic tag tugdeck minted for a fresh spawn. `None` on
    /// close/reset payloads and on older clients. Stored on the `LedgerEntry`
    /// and claimed authoritatively by `record_spawn`; never forwarded to the
    /// child ([P07]).
    tag: Option<String>,
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
    let permission_mode = value
        .get("permission_mode")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let tag = value
        .get("tag")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    Ok(OwnedControlPayload {
        card_id,
        tug_session_id: TugSessionId::new(tug_session_id),
        project_dir,
        session_mode,
        permission_mode,
        tag,
    })
}

/// Parse a CONTROL payload that carries `{ project_dir: "..." }`. The
/// picker's `list_sessions` request uses this so the lookup matches the
/// raw user-typed path (the value originally recorded by `record_spawn`).
/// `MissingSessionId`-shaped error semantics: a missing identifier the
/// lookup needs.
fn parse_project_dir_payload(payload: &[u8]) -> Result<String, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let pd = value
        .get("project_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::InvalidProjectDir {
            reason: "missing_project_dir",
        })?
        .to_string();
    Ok(pd)
}

/// The changeset scribe's runtime wiring ([P11]): the spawner (production:
/// `ClaudeScribeSpawner`; tests: a fake) plus the model resolver (tugbank
/// default `dev.tugtool.changeset`/`scribe_model`, fallback `haiku` —
/// resolved per request so a settings change applies immediately).
#[derive(Clone)]
pub struct ScribeContext {
    pub spawner: Arc<dyn crate::scribe::ScribeSpawner>,
    pub model: Arc<dyn Fn() -> String + Send + Sync>,
}

/// Parsed `changeset_commit` request: project dir, repo-relative file list,
/// commit message (Spec S03). The file list may parse empty — the handler
/// refuses it with a `changeset_commit_err` the card can render, rather than
/// a protocol error.
struct ChangesetCommitPayload {
    project_dir: String,
    files: Vec<String>,
    message: String,
    /// Optional session display name for the `Tug-Session:` trailer (Spec S01).
    session_name: Option<String>,
    /// Optional session id for the `Tug-Session:` trailer (Spec S01).
    session_id: Option<String>,
}

fn parse_changeset_commit_payload(payload: &[u8]) -> Result<ChangesetCommitPayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let project_dir = value
        .get("project_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::InvalidProjectDir {
            reason: "missing_project_dir",
        })?
        .to_string();
    let files = value
        .get("files")
        .and_then(|v| v.as_array())
        .ok_or(ControlError::Malformed)?
        .iter()
        .map(|v| {
            v.as_str()
                .map(str::to_string)
                .ok_or(ControlError::Malformed)
        })
        .collect::<Result<Vec<String>, ControlError>>()?;
    let message = value
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or(ControlError::Malformed)?
        .to_string();
    let session_name = value
        .get("session_name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let session_id = value
        .get("session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok(ChangesetCommitPayload {
        project_dir,
        files,
        message,
        session_name,
        session_id,
    })
}

/// The commit message enriched with a `Tug-Session:` trailer when the deck
/// supplied the session name + id (Spec S01/S02). Absent either field, the
/// message is returned byte-for-byte. Idempotent via `append_trailers`.
fn changeset_commit_message(request: &ChangesetCommitPayload) -> String {
    match (&request.session_name, &request.session_id) {
        (Some(name), Some(id)) => tugchanges_core::append_trailers(
            &request.message,
            &[("Tug-Session", &format!("{name} ({id})"))],
        ),
        _ => request.message.clone(),
    }
}

/// Parsed `changeset_draft_request` (Spec S01): the entry identity an on-demand
/// draft is requested for. `owner_id` may be empty (the unattributed pseudo-
/// entry), so it is not filtered non-empty.
struct ChangesetDraftRequestPayload {
    project_dir: String,
    owner_kind: String,
    owner_id: String,
}

fn parse_changeset_draft_request_payload(
    payload: &[u8],
) -> Result<ChangesetDraftRequestPayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let project_dir = value
        .get("project_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::InvalidProjectDir {
            reason: "missing_project_dir",
        })?
        .to_string();
    let owner_kind = value
        .get("owner_kind")
        .and_then(|v| v.as_str())
        .ok_or(ControlError::Malformed)?
        .to_string();
    let owner_id = value
        .get("owner_id")
        .and_then(|v| v.as_str())
        .ok_or(ControlError::Malformed)?
        .to_string();
    Ok(ChangesetDraftRequestPayload {
        project_dir,
        owner_kind,
        owner_id,
    })
}

/// Parsed `changeset_join` request (Spec S03): the project checkout, the dash
/// name, an optional strategy (`squash`|`merge`|`rebase`, default squash), an
/// optional override message, and whether this is an in-memory `--preview`.
struct ChangesetJoinPayload {
    project_dir: String,
    dash: String,
    strategy: tugdash_core::JoinStrategy,
    message: Option<String>,
    preview: bool,
    /// A pre-resolved candidate commit to land ([P31]/[P32], Spec S12): when
    /// present the join fast-forwards the base onto it (staleness-guarded)
    /// instead of integrating per strategy.
    candidate: Option<String>,
}

fn parse_changeset_join_payload(payload: &[u8]) -> Result<ChangesetJoinPayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let project_dir = value
        .get("project_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::InvalidProjectDir {
            reason: "missing_project_dir",
        })?
        .to_string();
    let dash = value
        .get("dash")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::Malformed)?
        .to_string();
    let strategy = match value.get("strategy").and_then(|v| v.as_str()) {
        None | Some("squash") => tugdash_core::JoinStrategy::Squash,
        Some("merge") => tugdash_core::JoinStrategy::Merge,
        Some("rebase") => tugdash_core::JoinStrategy::Rebase,
        Some(_) => return Err(ControlError::Malformed),
    };
    let message = value
        .get("message")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string);
    let preview = value
        .get("preview")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let candidate = value
        .get("candidate")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string);
    Ok(ChangesetJoinPayload {
        project_dir,
        dash,
        strategy,
        message,
        preview,
        candidate,
    })
}

/// Parsed `changeset_join_resolve` request (Spec S12): the project checkout and
/// the dash name.
struct ChangesetJoinResolvePayload {
    project_dir: String,
    dash: String,
}

fn parse_changeset_join_resolve_payload(
    payload: &[u8],
) -> Result<ChangesetJoinResolvePayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let project_dir = value
        .get("project_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::InvalidProjectDir {
            reason: "missing_project_dir",
        })?
        .to_string();
    let dash = value
        .get("dash")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::Malformed)?
        .to_string();
    Ok(ChangesetJoinResolvePayload { project_dir, dash })
}

/// Parsed `changeset_release` request: the project checkout and the dash name.
struct ChangesetReleasePayload {
    project_dir: String,
    dash: String,
}

fn parse_changeset_release_payload(
    payload: &[u8],
) -> Result<ChangesetReleasePayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let project_dir = value
        .get("project_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::InvalidProjectDir {
            reason: "missing_project_dir",
        })?
        .to_string();
    let dash = value
        .get("dash")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::Malformed)?
        .to_string();
    Ok(ChangesetReleasePayload { project_dir, dash })
}

fn parse_session_id_payload(payload: &[u8]) -> Result<String, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    // Reuse the `MissingSessionId` variant — semantically the same shape:
    // a CONTROL action that needs an id and didn't get one.
    let id = value
        .get("session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingSessionId)?
        .to_string();
    Ok(id)
}

/// Parse a `trash_session` CONTROL payload: `{ session_id, project_dir? }`.
/// `project_dir` is optional — the picker supplies it for external rows
/// (sessions with no ledger row) so the JSONL can be located without a
/// `project_dir` column to consult.
fn parse_trash_session_payload(payload: &[u8]) -> Result<(String, Option<String>), ControlError> {
    let session_id = parse_session_id_payload(payload)?;
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let project_dir = value
        .get("project_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    Ok((session_id, project_dir))
}

/// Parse a `rename_session` CONTROL payload: `{ session_id, name }`. A missing /
/// empty / whitespace-only `name` clears the name (`None`); otherwise the
/// trimmed name is kept. ([#step-13d])
fn parse_rename_session_payload(payload: &[u8]) -> Result<(String, Option<String>), ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let id = value
        .get("session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingSessionId)?
        .to_string();
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok((id, name))
}

/// Parse a CONTROL payload that carries `{ tug_session_id: "..." }` only.
/// `request_replay` per [D12] uses this shape: a verb that addresses a
/// specific Live session by its tug-side id and carries no other state
/// (no card_id — the verb is dispatch-side bookkeeping; no project_dir —
/// the supervisor already knows the workspace from the ledger entry).
///
/// Returning `MissingSessionId` matches the variant `parse_control_payload_owned`
/// uses when its `tug_session_id` field is absent — same semantics, same
/// wire-side error category.
fn parse_tug_session_id_payload(payload: &[u8]) -> Result<TugSessionId, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let id = value
        .get("tug_session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingSessionId)?
        .to_string();
    Ok(TugSessionId::new(id))
}

/// Stamp `tug_session_id` onto a persisted SESSION_SIDEBAND replay payload
/// so it passes the client-side session filter ([D06]/[D11]). Parses the
/// JSON and sets the field (overwriting any stale value from a prior
/// binding), preserving every other field. A payload that fails to parse
/// falls back to [`splice_tug_session_id`] — same insert-after-first-brace
/// semantics the live relay path uses, with its pass-through-unchanged
/// behavior for hopeless blobs. Cold path (runs once per bind), so the
/// parse cost is irrelevant.
fn stamp_tug_session_id(payload: Vec<u8>, tug_session_id: &str) -> Vec<u8> {
    match serde_json::from_slice::<serde_json::Value>(&payload) {
        Ok(serde_json::Value::Object(mut obj)) => {
            obj.insert(
                "tug_session_id".to_owned(),
                serde_json::Value::String(tug_session_id.to_owned()),
            );
            serde_json::to_vec(&serde_json::Value::Object(obj)).unwrap_or(payload)
        }
        _ => splice_tug_session_id(&payload, tug_session_id),
    }
}

/// Extract the optional recency `window` from a `request_replay` CONTROL
/// payload. The supervisor forwards it verbatim into the `request_replay`
/// verb it pushes to tugcode, which validates the shape at its handler
/// boundary; an absent / null / malformed payload yields `None` ⇒ a full
/// replay (the legacy behavior). Parse failures are intentionally
/// swallowed here — `parse_tug_session_id_payload` already rejected a
/// truly malformed payload before this is called.
fn parse_request_replay_window(payload: &[u8]) -> Option<serde_json::Value> {
    serde_json::from_slice::<serde_json::Value>(payload)
        .ok()
        .and_then(|v| v.get("window").cloned())
        .filter(|w| !w.is_null())
}

/// Parsed payload of the `record_turn_telemetry` CONTROL action.
/// Tugdeck → tugcast: the reducer dispatches this from
/// `handleTurnComplete` (live path only — replayed turns aren't
/// re-persisted) carrying the per-turn telemetry block the reducer
/// just computed. The supervisor's `do_record_turn_telemetry` resolves
/// `tug_session_id` to the claude `session_id` (the ledger PK) and
/// writes the row.
///
/// Field names mirror the wire-shape of tugdeck's `TurnTelemetry`
/// (camelCase nested inside `telemetry`). The outer envelope uses
/// snake_case to match the rest of the CONTROL action conventions.
#[derive(Debug)]
struct RecordTurnTelemetryPayload {
    tug_session_id: TugSessionId,
    msg_id: String,
    cost_input_tokens: i64,
    cost_output_tokens: i64,
    cost_cache_creation_input_tokens: i64,
    cost_cache_read_input_tokens: i64,
    cost_total_cost_usd: f64,
    wall_clock_ms: i64,
    awaiting_approval_ms: i64,
    transport_downtime_ms: i64,
    active_ms: i64,
    ttft_ms: Option<i64>,
    ttftc_ms: Option<i64>,
    reconnect_count: i64,
    max_stream_gap_ms: i64,
    /// Session-level `window(0)`; carried on every turn's telemetry so
    /// a resumed session restores it. `None` when the client never
    /// captured a first iteration.
    session_init_tokens: Option<i64>,
    ended_at: i64,
}

fn parse_record_turn_telemetry_payload(
    payload: &[u8],
) -> Result<RecordTurnTelemetryPayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let tug_session_id = value
        .get("tug_session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingSessionId)?
        .to_string();
    let msg_id = value
        .get("msg_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::Malformed)?
        .to_string();
    let telemetry = value.get("telemetry").ok_or(ControlError::Malformed)?;
    let cost = telemetry.get("cost").ok_or(ControlError::Malformed)?;
    let ended_at = value
        .get("ended_at")
        .and_then(|v| v.as_i64())
        .ok_or(ControlError::Malformed)?;
    let i64_or = |obj: &serde_json::Value, key: &str| -> Result<i64, ControlError> {
        obj.get(key)
            .and_then(|v| v.as_i64())
            .ok_or(ControlError::Malformed)
    };
    let optional_i64 = |obj: &serde_json::Value, key: &str| -> Option<i64> {
        match obj.get(key) {
            Some(v) if v.is_null() => None,
            Some(v) => v.as_i64(),
            None => None,
        }
    };
    Ok(RecordTurnTelemetryPayload {
        tug_session_id: TugSessionId::new(tug_session_id),
        msg_id,
        cost_input_tokens: i64_or(cost, "inputTokens")?,
        cost_output_tokens: i64_or(cost, "outputTokens")?,
        cost_cache_creation_input_tokens: i64_or(cost, "cacheCreationInputTokens")?,
        cost_cache_read_input_tokens: i64_or(cost, "cacheReadInputTokens")?,
        cost_total_cost_usd: cost
            .get("totalCostUsd")
            .and_then(|v| v.as_f64())
            .ok_or(ControlError::Malformed)?,
        wall_clock_ms: i64_or(telemetry, "wallClockMs")?,
        awaiting_approval_ms: i64_or(telemetry, "awaitingApprovalMs")?,
        transport_downtime_ms: i64_or(telemetry, "transportDowntimeMs")?,
        active_ms: i64_or(telemetry, "activeMs")?,
        ttft_ms: optional_i64(telemetry, "ttftMs"),
        ttftc_ms: optional_i64(telemetry, "ttftcMs"),
        reconnect_count: i64_or(telemetry, "reconnectCount")?,
        max_stream_gap_ms: i64_or(telemetry, "maxStreamGapMs")?,
        session_init_tokens: optional_i64(telemetry, "sessionInitTokens"),
        ended_at,
    })
}

/// Parsed payload of the `record_context_breakdown` CONTROL action.
/// Tugdeck → tugcast: the reducer dispatches this for every
/// `context_breakdown` event it consumes (live frames from tugcode +
/// the supervisor's bind-time re-emit). The supervisor's
/// `do_record_context_breakdown` resolves `tug_session_id` to the
/// claude `session_id` (the ledger PK) and writes the row.
///
/// `payload_bytes` is the serialized JSON of the wire-frame body
/// (the `payload` sub-object of the CONTROL frame, NOT the full
/// CONTROL envelope). The supervisor stores it verbatim in the
/// `context_breakdown_latest.payload` BLOB; the next bind reads it
/// back and re-emits it as a synthetic `context_breakdown` wire
/// frame.
struct RecordContextBreakdownPayload {
    tug_session_id: TugSessionId,
    payload_bytes: Vec<u8>,
    captured_at: i64,
}

/// Parsed payload of the `record_session_state_change` CONTROL action.
/// Tugdeck → tugcast: the per-card store wrapper compares the prev/new
/// indicator-tone triple after every `reduce()` and dispatches this
/// when any axis changed.
///
/// `do_record_session_state_change` resolves `tug_session_id` to the
/// claude `session_id` (the ledger PK) and writes one
/// `session_state_changes` row. The sqlite layer dedupes against the
/// most-recent persisted triple as a race safety-net; the per-card
/// pre-check is the primary dedupe.
struct RecordSessionStateChangePayload {
    tug_session_id: TugSessionId,
    at_ms: i64,
    phase: String,
    transport_state: String,
    interrupt_in_flight: bool,
}

fn parse_record_session_state_change_payload(
    payload: &[u8],
) -> Result<RecordSessionStateChangePayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let tug_session_id = value
        .get("tug_session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingSessionId)?
        .to_string();
    let at_ms = value
        .get("at_ms")
        .and_then(|v| v.as_i64())
        .ok_or(ControlError::Malformed)?;
    let phase = value
        .get("phase")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::Malformed)?
        .to_string();
    let transport_state = value
        .get("transport_state")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::Malformed)?
        .to_string();
    let interrupt_in_flight = value
        .get("interrupt_in_flight")
        .and_then(|v| v.as_bool())
        .ok_or(ControlError::Malformed)?;
    Ok(RecordSessionStateChangePayload {
        tug_session_id: TugSessionId::new(tug_session_id),
        at_ms,
        phase,
        transport_state,
        interrupt_in_flight,
    })
}

/// Parsed payload of the `list_session_state_changes` CONTROL action.
/// Tugdeck → tugcast read: the popover-side reader asks the supervisor
/// for the persisted history of triples for a given session. The
/// supervisor resolves `tug_session_id → claude_session_id`, reads
/// every row from `session_state_changes`, and broadcasts
/// `list_session_state_changes_ok` back on CONTROL.
struct ListSessionStateChangesPayload {
    tug_session_id: TugSessionId,
}

fn parse_list_session_state_changes_payload(
    payload: &[u8],
) -> Result<ListSessionStateChangesPayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let tug_session_id = value
        .get("tug_session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingSessionId)?
        .to_string();
    Ok(ListSessionStateChangesPayload {
        tug_session_id: TugSessionId::new(tug_session_id),
    })
}

fn parse_record_context_breakdown_payload(
    payload: &[u8],
) -> Result<RecordContextBreakdownPayload, ControlError> {
    let value: serde_json::Value =
        serde_json::from_slice(payload).map_err(|_| ControlError::Malformed)?;
    let tug_session_id = value
        .get("tug_session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or(ControlError::MissingSessionId)?
        .to_string();
    let captured_at = value
        .get("captured_at")
        .and_then(|v| v.as_i64())
        .ok_or(ControlError::Malformed)?;
    // Re-serialize the `payload` sub-object so the supervisor stores
    // it as a stable blob shape (it round-trips back through
    // `serde_json` even if the CONTROL frame's whitespace / key order
    // differed). The sub-object must be present and an object.
    let payload_obj = value.get("payload").ok_or(ControlError::Malformed)?;
    if !payload_obj.is_object() {
        return Err(ControlError::Malformed);
    }
    let payload_bytes = serde_json::to_vec(payload_obj).map_err(|_| ControlError::Malformed)?;
    Ok(RecordContextBreakdownPayload {
        tug_session_id: TugSessionId::new(tug_session_id),
        payload_bytes,
        captured_at,
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

/// Build the CONTROL error frame the dispatcher emits when the ledger
/// `insert_pending_turn` write fails for an inbound `user_message`.
/// Mirrors the wire shape of [`build_session_unknown_frame`] so tugdeck
/// surfaces it through the same error-frame path. The user-visible
/// behavior is identical to a `session_unknown`: the inbound frame is
/// dropped (not forwarded to tugcode), tugdeck shows an error, and the
/// session state is unchanged.
fn build_ledger_failure_frame(tug_session_id: &TugSessionId) -> Frame {
    let body = serde_json::json!({
        "type": "error",
        "detail": "ledger_insert_failed",
        "tug_session_id": tug_session_id.as_str(),
    });
    Frame::new(
        FeedId::CONTROL,
        serde_json::to_vec(&body).expect("ledger_insert_failed payload serializes"),
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
    /// Construct a supervisor with pre-made broadcast senders, a sessions
    /// recorder, and a spawner factory. Returns `(supervisor,
    /// merger_register_rx)` — the caller is expected to `tokio::spawn`
    /// [`AgentSupervisor::merger_task`] with the returned receiver.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        session_state: SessionScopedFeed,
        session_sideband: SessionScopedFeed,
        code_output: SessionScopedFeed,
        activity: SessionScopedFeed,
        control_tx: broadcast::Sender<Frame>,
        sessions_recorder: Arc<dyn SessionsRecorder>,
        spawner_factory: SpawnerFactory,
        config: AgentSupervisorConfig,
        registry: Arc<WorkspaceRegistry>,
        cancel: CancellationToken,
    ) -> (Self, mpsc::Receiver<MergerRegistration>) {
        Self::new_with_ledger(
            session_state,
            session_sideband,
            code_output,
            activity,
            control_tx,
            sessions_recorder,
            None,
            spawner_factory,
            config,
            registry,
            cancel,
        )
    }

    /// Construct a supervisor with an explicit `Arc<SessionLedger>` for the
    /// read-side CONTROL ops. Production wires this in `main.rs`; unit tests
    /// that don't exercise the ledger CONTROL paths use [`Self::new`] and
    /// get `None`.
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_ledger(
        session_state: SessionScopedFeed,
        session_sideband: SessionScopedFeed,
        code_output: SessionScopedFeed,
        activity: SessionScopedFeed,
        control_tx: broadcast::Sender<Frame>,
        sessions_recorder: Arc<dyn SessionsRecorder>,
        session_ledger: Option<Arc<crate::session_ledger::SessionLedger>>,
        spawner_factory: SpawnerFactory,
        config: AgentSupervisorConfig,
        registry: Arc<WorkspaceRegistry>,
        cancel: CancellationToken,
    ) -> (Self, mpsc::Receiver<MergerRegistration>) {
        let (merger_register_tx, merger_register_rx) = mpsc::channel(64);
        let sup = Self {
            ledger: Arc::new(Mutex::new(HashMap::new())),
            session_state,
            session_sideband,
            client_sessions: Arc::new(Mutex::new(HashMap::new())),
            code_output,
            activity,
            control_tx,
            sessions_recorder,
            session_ledger,
            shell_ledger: None,
            scribe: None,
            spawner_factory,
            merger_register_tx,
            config,
            registry,
            cancel,
            spawn_timestamps: Arc::new(StdMutex::new(VecDeque::new())),
            changeset_watch: std::sync::OnceLock::new(),
        };
        (sup, merger_register_rx)
    }

    /// Snapshot every session that currently has a live tugcode child AND a
    /// turn in flight, with its captured `(pid, start_time)` — the input the
    /// activity sampler ([P10]) needs to root each session's subtree walk
    /// and apply the PID-reuse guard ([P20]). Sessions between spawns (no
    /// live child) and sessions idle between turns are omitted: Pulse
    /// attributes the session *working*, so an idle session's gauges decay
    /// to zero instead of reporting the claude process's idle heartbeat.
    pub async fn live_session_processes(&self) -> Vec<LiveSessionProcess> {
        let entries: Vec<Arc<Mutex<LedgerEntry>>> = {
            let ledger = self.ledger.lock().await;
            ledger.values().cloned().collect()
        };
        let mut out = Vec::new();
        for entry_arc in entries {
            let entry = entry_arc.lock().await;
            if !entry.turn_active {
                continue;
            }
            if let (Some(pid), Some(start_time)) = (entry.child_pid, entry.child_start_time) {
                out.push(LiveSessionProcess {
                    tug_session_id: entry.tug_session_id.clone(),
                    pid,
                    start_time,
                });
            }
        }
        out
    }

    /// Handle a CONTROL frame's action. `client_id` is the WebSocket
    /// connection id (see [D09]); it is distinct from `card_id` and is
    /// used only for the per-client session affinity map in [D14].
    ///
    /// Actions:
    /// * `spawn_session` — register intent + start the per-session
    ///   subprocess if Idle. Payload: `{card_id, tug_session_id,
    ///   project_dir, session_mode?}`.
    /// * `close_session` — stop the subprocess and drop the ledger
    ///   entry. Payload: `{card_id, tug_session_id}`.
    /// * `reset_session` — invalidate the persisted resume id and
    ///   re-arm the entry for a fresh spawn, preserving the workspace.
    ///   Payload: `{card_id, tug_session_id}`.
    /// * `list_sessions` — picker query. Payload: `{project_dir}`.
    /// * `trash_session` — drop a non-live persisted record.
    ///   Payload: `{session_id}`.
    /// * `trash_project_dir_sessions` — drop every non-live record
    ///   under a workspace. Payload: `{project_dir}`.
    /// * `request_replay` — recovery verb per [D12]. Forward
    ///   `{"type":"request_replay"}` to the live tugcode subprocess so
    ///   a freshly-mounted `CodeSessionStore` rehydrates from JSONL.
    ///   No-op if the entry is not Live. Payload: `{tug_session_id}`.
    ///
    /// Returns [`ControlOutcome::PassThrough`] for any action not
    /// matched above so the router can fall through to its legacy
    /// `dispatch_action` pipeline. The match arms here are the single
    /// source of truth for "which CONTROL actions the supervisor owns";
    /// the router does not maintain a separate allowlist.
    pub async fn handle_control(
        &self,
        action: &str,
        payload: &[u8],
        client_id: ClientId,
    ) -> ControlOutcome {
        // Inner closure-style block returns a `Result<(), ControlError>`
        // for the supervisor-owned arms; the catch-all early-returns
        // `PassThrough` so unknown actions don't pay the wrap cost. The
        // outer match below maps Ok→Handled, Err→Error.
        let result: Result<(), ControlError> = match action {
            "spawn_session" => {
                let parsed = match parse_control_payload_owned(payload) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(action, error = %e, "handle_control: rejected spawn_session");
                        return ControlOutcome::Error(e);
                    }
                };
                // project_dir is required on spawn per.
                let project_dir_str =
                    match parsed.project_dir.ok_or(ControlError::InvalidProjectDir {
                        reason: "missing_project_dir",
                    }) {
                        Ok(s) => s,
                        Err(e) => return ControlOutcome::Error(e),
                    };
                self.do_spawn_session(
                    &parsed.card_id,
                    parsed.tug_session_id,
                    project_dir_str,
                    parsed.session_mode,
                    parsed.permission_mode,
                    parsed.tag,
                    client_id,
                )
                .await
            }
            "close_session" => {
                let parsed = match parse_control_payload_owned(payload) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(action, error = %e, "handle_control: rejected close_session");
                        return ControlOutcome::Error(e);
                    }
                };
                self.do_close_session(&parsed.card_id, &parsed.tug_session_id, client_id)
                    .await;
                Ok(())
            }
            "reset_session" => {
                let parsed = match parse_control_payload_owned(payload) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(action, error = %e, "handle_control: rejected reset_session");
                        return ControlOutcome::Error(e);
                    }
                };
                // W2 [D11]: reset preserves the workspace binding. We do NOT
                // close-then-spawn here because that would release the
                // workspace and (potentially) tear down its feeds.
                self.do_reset_session(&parsed.card_id, &parsed.tug_session_id, client_id)
                    .await;
                Ok(())
            }
            "list_sessions" => match parse_project_dir_payload(payload) {
                Ok(project_dir) => {
                    self.do_list_sessions(&project_dir).await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "list_card_bindings" => {
                self.do_list_card_bindings().await;
                Ok(())
            }
            "changeset_git_init" => match parse_project_dir_payload(payload) {
                Ok(project_dir) => {
                    self.do_changeset_git_init(&project_dir).await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "changeset_commit" => match parse_changeset_commit_payload(payload) {
                Ok(parsed) => {
                    self.do_changeset_commit(&parsed).await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "changeset_draft_request" => match parse_changeset_draft_request_payload(payload) {
                Ok(parsed) => {
                    self.do_changeset_draft_request(&parsed);
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "changeset_join" => match parse_changeset_join_payload(payload) {
                Ok(parsed) => {
                    self.do_changeset_join(&parsed).await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "changeset_join_resolve" => match parse_changeset_join_resolve_payload(payload) {
                Ok(parsed) => {
                    self.do_changeset_join_resolve(&parsed).await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "changeset_release" => match parse_changeset_release_payload(payload) {
                Ok(parsed) => {
                    self.do_changeset_release(&parsed).await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "trash_session" => match parse_trash_session_payload(payload) {
                Ok((session_id, project_dir)) => {
                    self.do_trash_session(&session_id, project_dir.as_deref())
                        .await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "rename_session" => match parse_rename_session_payload(payload) {
                Ok((session_id, name)) => {
                    self.do_rename_session(&session_id, name.as_deref()).await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "trash_project_dir_sessions" => match parse_project_dir_payload(payload) {
                Ok(project_dir) => {
                    self.do_trash_project_dir_sessions(&project_dir).await;
                    Ok(())
                }
                Err(e) => return ControlOutcome::Error(e),
            },
            "request_replay" => {
                let tug_session_id = match parse_tug_session_id_payload(payload) {
                    Ok(id) => id,
                    Err(e) => {
                        warn!(action, error = %e, "handle_control: rejected request_replay");
                        return ControlOutcome::Error(e);
                    }
                };
                let window = parse_request_replay_window(payload);
                self.do_request_replay(&tug_session_id, window).await;
                Ok(())
            }
            "record_turn_telemetry" => {
                let parsed = match parse_record_turn_telemetry_payload(payload) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(action, error = %e, "handle_control: rejected record_turn_telemetry");
                        return ControlOutcome::Error(e);
                    }
                };
                self.do_record_turn_telemetry(parsed).await;
                Ok(())
            }
            "record_context_breakdown" => {
                let parsed = match parse_record_context_breakdown_payload(payload) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(action, error = %e, "handle_control: rejected record_context_breakdown");
                        return ControlOutcome::Error(e);
                    }
                };
                self.do_record_context_breakdown(parsed).await;
                Ok(())
            }
            "record_session_state_change" => {
                let parsed = match parse_record_session_state_change_payload(payload) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(action, error = %e, "handle_control: rejected record_session_state_change");
                        return ControlOutcome::Error(e);
                    }
                };
                self.do_record_session_state_change(parsed).await;
                Ok(())
            }
            "list_session_state_changes" => {
                let parsed = match parse_list_session_state_changes_payload(payload) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(action, error = %e, "handle_control: rejected list_session_state_changes");
                        return ControlOutcome::Error(e);
                    }
                };
                self.do_list_session_state_changes(parsed).await;
                Ok(())
            }
            "list_pulse_lines" => {
                // App-scoped read — no session id, no payload fields.
                self.do_list_pulse_lines().await;
                Ok(())
            }
            "list_shell_exchanges" => {
                // Session-scoped read — the deck's shell-restore tail fetch.
                let tug_session_id = serde_json::from_slice::<serde_json::Value>(payload)
                    .ok()
                    .and_then(|v| {
                        v.get("tug_session_id")
                            .and_then(|s| s.as_str())
                            .map(String::from)
                    })
                    .unwrap_or_default();
                self.do_list_shell_exchanges(&tug_session_id).await;
                Ok(())
            }
            // Any action not above is not owned by the supervisor.
            // Caller falls through to `dispatch_action`.
            _ => return ControlOutcome::PassThrough,
        };

        match result {
            Ok(()) => ControlOutcome::Handled,
            Err(e) => ControlOutcome::Error(e),
        }
    }

    /// Build a `SESSION_SIDEBAND` replay frame from the persisted ledger
    /// row, for a bind whose in-memory `latest_metadata` slot is empty.
    ///
    /// claude is silent in stream-json mode until the first user message,
    /// so a resumed / known session would otherwise show no live model /
    /// version / mode until the user types. The sqlite `session_metadata`
    /// table holds the last-known merged payload (keyed by claude's
    /// session id), so we surface it the moment the card binds; the next
    /// live `system/init` replaces it wholesale on the first turn.
    ///
    /// Tries `claude_session_id` first (the metadata PK), then the tug
    /// session id (equal for un-forked sessions, where the binding's
    /// claude id may not yet be populated in memory). Returns `None` when
    /// there is no sqlite ledger handle or no persisted row (a genuinely
    /// brand-new session), so a fresh flow fires no replay — matching the
    /// `latest_metadata: None` behavior it falls back from. Payload is
    /// rewrapped as `FeedId::SESSION_SIDEBAND` (the wire byte the client's
    /// `register_stream(FeedId::SESSION_SIDEBAND, …)` subscription keys on,
    /// same as the live merger publish).
    ///
    /// The persisted payload carries no `tug_session_id`: the bridge merges
    /// and persists the RAW stdout line, splicing the id only onto the
    /// emitted wire copy (`agent_bridge.rs` — merge precedes the splice at
    /// the emit site). Clients filter SESSION_SIDEBAND by `tug_session_id`
    /// per [D06]/[D11], so an unstamped replay would be silently dropped
    /// and a resumed card would show no model / version / mode until its
    /// first turn. Stamp the BOUND session's id here ([`stamp_tug_session_id`]);
    /// stamping at replay time also keeps the frame correct when a claude
    /// session is re-bound under a different tug id.
    fn persisted_metadata_replay_frame(
        &self,
        claude_session_id: Option<&str>,
        tug_session_id: &str,
    ) -> Option<Frame> {
        let ledger = self.session_ledger.as_ref()?;
        // Try claude id first (the metadata PK), then the tug id — but only
        // the tug id when it differs (un-forked sessions share one id).
        let mut candidates: Vec<&str> = Vec::with_capacity(2);
        if let Some(id) = claude_session_id {
            candidates.push(id);
        }
        if !candidates.contains(&tug_session_id) {
            candidates.push(tug_session_id);
        }
        for candidate in candidates {
            match ledger.get_session_metadata(candidate) {
                Ok(Some(row)) => {
                    return Some(Frame::new(
                        FeedId::SESSION_SIDEBAND,
                        stamp_tug_session_id(row.payload, tug_session_id),
                    ));
                }
                Ok(None) => {}
                Err(e) => {
                    warn!(
                        error = %e,
                        session_id = candidate,
                        "get_session_metadata failed during bind replay (ignored)"
                    );
                }
            }
        }
        None
    }

    /// Build a `SESSION_SIDEBAND` replay frame from the persisted
    /// `session_capabilities` row, for a bind whose in-memory
    /// `latest_capabilities` slot is empty — the app-restart case: the
    /// slot died with the old process, and a resumed session's next
    /// handshake is health-gated (it answers seconds after spawn at the
    /// earliest). Without this fallback the card has no `/` command
    /// catalog and no version in that window; with it, the last-known
    /// catalog is on screen from the drop and the live handshake
    /// replaces it wholesale when it lands.
    ///
    /// Keyed by the tug session id only — capabilities are spawn-scoped
    /// (unlike `session_metadata`, which is keyed by claude's JSONL id).
    /// The persisted payload is the tagged wire copy, but the tag is the
    /// id of the ORIGINAL spawn; stamp the BOUND session's id so a
    /// claude session re-bound under a different tug id still passes the
    /// client-side [D06]/[D11] session filter
    /// ([`stamp_tug_session_id`] overwrites a stale tag).
    fn persisted_capabilities_replay_frame(&self, tug_session_id: &str) -> Option<Frame> {
        let ledger = self.session_ledger.as_ref()?;
        match ledger.get_session_capabilities(tug_session_id) {
            Ok(Some(row)) => Some(Frame::new(
                FeedId::SESSION_SIDEBAND,
                stamp_tug_session_id(row.payload, tug_session_id),
            )),
            Ok(None) => None,
            Err(e) => {
                warn!(
                    error = %e,
                    session_id = tug_session_id,
                    "get_session_capabilities failed during bind replay (ignored)"
                );
                None
            }
        }
    }

    async fn do_spawn_session(
        &self,
        card_id: &str,
        tug_session_id: TugSessionId,
        project_dir_str: String,
        session_mode: SessionMode,
        permission_mode: Option<String>,
        tag: Option<String>,
        client_id: ClientId,
    ) -> Result<(), ControlError> {
        let project_dir = PathBuf::from(&project_dir_str);
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "spawn.supervisor_recv",
            card_id = card_id,
            tug_session_id = %tug_session_id,
            project_dir = %project_dir_str,
            session_mode = session_mode.as_wire_str(),
        );

        // Phase 0: validate + canonicalize + acquire workspace.
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
                    self.session_state.publish_tagged(build_session_state_frame(
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
            // Capture whether *any* live client connection already held
            // this session BEFORE this call's affinity insert. This is
            // the genuine "session_live_elsewhere" signal: a session
            // re-materialized by `rebind_from_ledger` is in no client's
            // set, while one another connected client is using is. Read
            // it here, pre-insert, so the resume check below isn't
            // fooled by the row this very call is about to add.
            let held_by_live_client_before = cs.values().any(|set| set.contains(&tug_session_id));
            cs.entry(client_id)
                .or_default()
                .insert(tug_session_id.clone());
            (arc, was_inserted, held_by_live_client_before)
        };
        let (entry_arc, inserted, held_by_live_client_before) = phase1;

        // Compute the *effective* session mode — the mode the bridge
        // will actually use when it spawns tugcode. For a fresh insert
        // (Phase 1's `or_insert_with` fired) the effective mode is the
        // request's mode. For an existing entry that's still `Idle`
        // (rebound from the ledger but not yet spawned), we propagate
        // the request's mode into the entry. The defense-in-depth is
        // gated on `Idle` so we never silently switch the mode of a
        // running subprocess: the running tugcode subprocess was
        // spawned with the original mode and silently switching it
        // client-side would misrepresent live state.
        let effective_session_mode = {
            let mut entry = entry_arc.lock().await;
            if !inserted
                && entry.spawn_state == SpawnState::Idle
                && entry.session_mode != session_mode
            {
                entry.session_mode = session_mode;
            }
            // Stamp the resolved permission mode onto the entry the same way:
            // on the fresh insert, or while still `Idle` (rebound but not yet
            // spawned). Never while running — the live tugcode was spawned with
            // the original `--permission-mode` and a post-spawn `permission_mode`
            // frame is the path for live changes. The bridge reads this field at
            // spawn time so the mode is correct from claude's first instant.
            if inserted || entry.spawn_state == SpawnState::Idle {
                entry.permission_mode = permission_mode;
                // The provisional tag is stamped on the same fresh/Idle path and
                // preserved across reconnects; `record_spawn` claims it
                // authoritatively when the bridge promotes the session.
                entry.tag = tag;
            }
            entry.session_mode
        };
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "spawn.effective_mode",
            card_id = card_id,
            tug_session_id = %tug_session_id,
            requested_mode = session_mode.as_wire_str(),
            effective_mode = effective_session_mode.as_wire_str(),
            inserted,
            mode_mismatch =
                session_mode != effective_session_mode && !inserted,
        );

        // Workspace refcount ownership. Phase 0's `get_or_create` bumped the
        // workspace refcount; exactly one refcount belongs to this ledger entry
        // for its lifetime (`do_close_session` releases it). Decide who owns the
        // one we just acquired — keyed on the entry's OWN record of ownership,
        // never on `inserted`:
        //   - the entry already owns one (a genuine reconnect of a live entry)
        //     → the Phase-0 refcount is excess, release it;
        //   - the entry owns none (a fresh insert, OR an entry rebound from the
        //     ledger making its first real spawn) → the entry adopts it.
        // A rebind entry is present in the ledger (`inserted == false`) yet holds
        // no refcount, so `!inserted` must NOT drive the release — reading it as
        // "a refcount is held" tore down a resumed project's workspace on restore.
        let phase0_refcount_is_excess = {
            let mut entry = entry_arc.lock().await;
            if entry.holds_workspace_refcount {
                true
            } else {
                entry.holds_workspace_refcount = true;
                false
            }
        };
        if phase0_refcount_is_excess {
            if let Err(e) = self.registry.release(&workspace_key) {
                warn!(
                    card_id,
                    session = %tug_session_id,
                    error = %e,
                    "spawn_session: reconnect release returned error (ignored)"
                );
            }
        }

        if !inserted {
            // Reject a `resume` only when a live client connection is
            // genuinely holding this session on a *different* card.
            //
            // The `card_id` field is the persistent "last bound"
            // record, preserved across close/errored — but the ledger
            // remembering a different card is NOT by itself a
            // conflict. After a tugcast restart, `rebind_from_ledger`
            // re-materializes every prior session as `Idle` carrying
            // its recorded `card_id`, and deliberately does NOT
            // populate `client_sessions` (there is no WebSocket client
            // behind a rebind). Likewise a page reload drops the old
            // WebSocket, and `on_client_disconnect` removes that
            // client's `client_sessions` row. In both cases the
            // recorded card is gone; a new card must be free to adopt
            // the session via `mode=resume`.
            //
            // The genuine conflict is "a connected client is holding
            // this session right now" — captured in
            // `held_by_live_client_before` (read in Phase 1 *before*
            // this call's own affinity insert, so it is not fooled by
            // the row we just added). A resume is rejected only when
            // all of:
            //   (a) the entry is in a not-closed `spawn_state`
            //       (Idle/Spawning/Live),
            //   (b) the ledger's `card_id` differs from the resuming
            //       card, AND
            //   (c) a live client connection already held this session
            //       before this call.
            // Same-card reconnects (WS drop + reconnect) clear (b);
            // rebind-from-ledger / post-reload adoptions clear (c);
            // `new` payloads never enter this block.
            if session_mode == SessionMode::Resume {
                let entry = entry_arc.lock().await;
                let still_held = matches!(
                    entry.spawn_state,
                    SpawnState::Idle | SpawnState::Spawning | SpawnState::Live
                );
                let holder_opt = if still_held {
                    entry.card_id.as_deref()
                } else {
                    None
                };
                if let Some(holder) = holder_opt {
                    if holder != card_id && held_by_live_client_before {
                        let holder_owned = holder.to_owned();
                        drop(entry);
                        // Drop the per-client affinity row we just
                        // inserted above so the rejected card doesn't
                        // appear bound.
                        let mut cs = self.client_sessions.lock().await;
                        if let Some(set) = cs.get_mut(&client_id) {
                            set.remove(&tug_session_id);
                        }
                        drop(cs);
                        warn!(
                            card_id,
                            session = %tug_session_id,
                            holder = %holder_owned,
                            "spawn_session: resume rejected — session live on another card"
                        );
                        self.session_state.publish_tagged(build_session_state_frame(
                            &tug_session_id,
                            "errored",
                            Some("session_live_elsewhere"),
                        ));
                        return Err(ControlError::CapExceeded {
                            reason: "session_live_elsewhere",
                        });
                    }
                }
            }
        }

        // Terminal-liveness gate: a resume whose target session is
        // currently held by a live process outside this supervisor —
        // the Claude Code terminal app, or another Tug instance — is
        // refused outright. Double-holding makes both processes append
        // divergent parentUuid branches into one JSONL; closing the
        // terminal frees the session immediately (its registry entry
        // is removed on exit).
        //
        // This check runs for BOTH Phase-1 outcomes. The fresh-insert
        // path is the primary case: the first-ever resume of an
        // external (terminal-created) session mints a new entry, so a
        // gate placed inside the `!inserted` reconnect branch above
        // would miss it entirely. Only resume mode is gated — a `new`
        // session has a fresh id no other process can hold. The
        // registry read shells out to `ps` and walks a directory, so
        // it runs on a blocking thread.
        if effective_session_mode == SessionMode::Resume {
            let registry_root = self.terminal_registry_root();
            let sid = tug_session_id.as_str().to_owned();
            let held = tokio::task::spawn_blocking(move || {
                Self::read_terminal_live_sessions(registry_root.as_deref()).contains_key(&sid)
            })
            .await
            .unwrap_or(false);
            if held {
                // Undo this call's bookkeeping. A fresh insert takes
                // its just-minted Idle entry and the Phase-0 workspace
                // refcount with it; a reconnect already released the
                // extra refcount above and keeps its pre-existing
                // entry. The affinity row this call added goes either
                // way. Lock order: ledger, then client_sessions.
                {
                    let mut ledger = self.ledger.lock().await;
                    if inserted {
                        ledger.remove(&tug_session_id);
                    }
                    let mut cs = self.client_sessions.lock().await;
                    if let Some(set) = cs.get_mut(&client_id) {
                        set.remove(&tug_session_id);
                    }
                }
                if inserted {
                    if let Err(e) = self.registry.release(&workspace_key) {
                        warn!(
                            card_id,
                            session = %tug_session_id,
                            error = %e,
                            "spawn_session: terminal-gate workspace release failed (ignored)"
                        );
                    }
                }
                warn!(
                    card_id,
                    session = %tug_session_id,
                    "spawn_session: resume rejected — session live in terminal"
                );
                self.session_state.publish_tagged(build_session_state_frame(
                    &tug_session_id,
                    "errored",
                    Some("session_live_in_terminal"),
                ));
                return Err(ControlError::CapExceeded {
                    reason: "session_live_in_terminal",
                });
            }
        }

        // Persistence of the (card_id → session) binding happens
        // through the sqlite-backed `SessionLedger` row that the bridge
        // writes on `session_init` (in `relay_session_io`). The
        // supervisor's in-memory `LedgerEntry` carries `card_id` and
        // `session_mode` for the lifetime of the entry; the bridge's
        // atomic-promote block calls `sessions_recorder.record(...)`
        // under a single lock, and the `LedgerSessionsRecorder`
        // translates that into a `record_spawn` ledger write keyed by
        // claude's session id. The client-side restore consults that
        // ledger via the `list_card_bindings` CONTROL verb.
        //
        // Phase 3: per-session mutation + publish + replay, under the
        // per-session lock. Reconnect flows observe the existing entry and
        // its `latest_metadata`; fresh flows observe a just-minted Idle
        // entry with `latest_metadata: None`.
        let (replay_frame, capabilities_frame, rate_limit_frame) = {
            let mut entry = entry_arc.lock().await;
            // Record the binding card. `card_id` is preserved across
            // lifecycle transitions (close/errored/crash-exhausted),
            // so this assignment is durable. The live-elsewhere check
            // gates on `spawn_state` instead of nullity. Same-card
            // reconnects overwrite with the same value (no-op).
            entry.card_id = Some(card_id.to_owned());
            // Prefer the in-memory slot (freshest — captured this process);
            // fall back to the persisted ledger row so a resumed/known
            // session surfaces its last-known model / version / mode the
            // moment the card binds, before any turn. claude is silent in
            // stream-json mode until the first user message, so without this
            // a fresh-process resume shows nothing live until the user types.
            // Keyed by claude's session id (the metadata PK); falls back to
            // the tug id for un-forked sessions where the two are equal.
            let metadata = match entry.latest_metadata.clone() {
                Some(frame) => Some(frame),
                None => self.persisted_metadata_replay_frame(
                    entry.claude_session_id.as_deref(),
                    tug_session_id.as_str(),
                ),
            };
            // Capabilities (the turn-free `initialize` model list +
            // command catalog) prefer the in-memory slot (freshest —
            // captured this process); fall back to the persisted
            // `session_capabilities` row so a resumed session's `/`
            // catalog and version survive an app restart — the slot dies
            // with the process, and the health-gated resume handshake
            // answers seconds after spawn at the earliest. The next live
            // capabilities frame replaces both wholesale.
            let capabilities = match entry.latest_capabilities.clone() {
                Some(frame) => Some(frame),
                None => self.persisted_capabilities_replay_frame(tug_session_id.as_str()),
            };
            // Rate-limit (the per-turn quota broadcast) is in-memory
            // only — replayed on reconnect / HMR remount so the Z4B
            // rate-limit chip keeps its state even though the last
            // per-turn broadcast already flew. Absent until the first turn
            // emits one.
            (metadata, capabilities, entry.latest_rate_limit.clone())
        };
        // Live-elsewhere visibility for cross-card pickers is driven by
        // the ledger row the bridge writes on `session_init` (with
        // `state="live"` and `card_id`). Pre-handshake spawns don't
        // appear in any picker — by then the user has already chosen.

        self.session_state.publish_tagged(build_session_state_frame(
            &tug_session_id,
            "pending",
            None,
        ));

        if let Some(frame) = replay_frame {
            self.session_sideband.publish_tagged(frame);
        }
        if let Some(frame) = capabilities_frame {
            self.session_sideband.publish_tagged(frame);
        }
        if let Some(frame) = rate_limit_frame {
            self.session_sideband.publish_tagged(frame);
        }

        // Eager spawn: transition Idle→Spawning and launch the tugcode
        // subprocess now, before the ack goes out. Resume failures
        // surface within ~1s of card open (claude exits fast on a
        // stale id), not 8+s after the user types and submits.
        //
        // The dispatcher's lazy Idle→Spawn branch stays in place as a
        // defense-in-depth path for ledger entries rebound from
        // tugbank at startup; in normal client flow it is unreachable
        // because do_spawn_session promotes Idle→Spawning before any
        // CODE_INPUT frame can arrive.
        let should_spawn = {
            let mut entry = entry_arc.lock().await;
            if entry.spawn_state == SpawnState::Idle {
                entry.spawn_state.try_transition(SpawnState::Spawning).ok();
                true
            } else {
                false
            }
        };
        if should_spawn {
            tracing::info!(
                target: "dev::session-lifecycle",
                event = "supervisor.eager_spawn",
                tug_session_id = %tug_session_id,
                card_id = card_id,
            );

            // (Migration bootstrap and supervisor-side spawn-time
            // reconciliation both removed by mid-turn-replay
            // [Step 5.2](#step-5-2) / [Step 5.6](#step-5-6).
            // Tugtool has no production users, so historical JSONL
            // → ledger migration is unneeded; the journal only ever
            // holds *currently pending* submissions, never historical
            // ones. Per-session pending rows are surfaced directly
            // by tugcode's `runReplay` via `injectPendingRowSynthetics`,
            // which reads the journal through the cross-process
            // bun:sqlite handle and emits a synthetic
            // `user_message_replay` for each pending row whose
            // `user_text` doesn't appear in JSONL — no supervisor
            // sweep step needed.)
            self.spawn_session_worker(&tug_session_id).await;
        }

        //
        // `workspace_key` so tugdeck can stamp it into the per-card binding
        // store without attempting client-side canonicalization (which
        // would miss macOS firmlinks). W1 had no explicit ack frame on this
        // code path — a successful `spawn_session` simply returned Ok(())
        // and the wire observation was the subsequent `pending`/`spawning`
        // SESSION_STATE transitions. Emitting the ack as an explicit CONTROL
        // frame here lets tugdeck's spawn-session handler populate the
        // binding store in the same round-trip.
        // The ack also echoes `session_mode` so tugdeck's
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
        // Also snapshot the `workspace_key` and `claude_session_id` under
        // this same lock so Phase 3 can call `registry.release` and Phase 5
        // can mark the ledger row closed without re-acquiring it.
        let (workspace_key, claude_session_id, held_refcount) = {
            let mut entry = entry_arc.lock().await;
            entry.cancel.cancel();
            // Bare assignment (not `try_transition`) because the entry is
            // about to be dropped; we only care that any Arc-clone holder
            // observes `Closed` on its next lock acquire.
            entry.spawn_state = SpawnState::Closed;
            // Take the refcount ownership: release it below iff this entry
            // adopted one. A rebind entry closed before it ever spawned holds
            // none — releasing then would decrement another card's refcount for
            // the same workspace, or error on `UnknownKey`.
            let held = entry.holds_workspace_refcount;
            entry.holds_workspace_refcount = false;
            // `card_id` is preserved across close so the persisted
            // ledger row retains the binding for client-side restore;
            // liveness is encoded in `spawn_state`.
            (
                entry.workspace_key.clone(),
                entry.claude_session_id.clone(),
                held,
            )
        };

        // Phase 3: release the workspace refcount this entry owned. Errors on
        // this path (e.g. `UnknownKey` from a double-close race) are logged and
        // swallowed — they indicate a caller-side logic error, not a condition
        // worth propagating to the wire.
        if held_refcount {
            if let Err(e) = self.registry.release(&workspace_key) {
                warn!(
                    card_id,
                    session = %tug_session_id,
                    error = %e,
                    "close_session: workspace release failed, continuing"
                );
            }
        }

        // The persisted ledger row is preserved across close — a
        // closed card can be reopened with history through
        // `rebind_from_ledger` on the next startup. The explicit
        // `reset_session` flow is the only path that invalidates the
        // session_id; close is a "stop the subprocess but keep the
        // history pointer" operation.

        // Phase 5: publish `closed`. (The `Arc<Mutex<LedgerEntry>>` we hold
        // is dropped at the end of this scope.)
        self.session_state.publish_tagged(build_session_state_frame(
            tug_session_id,
            "closed",
            None,
        ));

        // Phase 6: transition the ledger row to `closed`. Pre-handshake
        // sessions never reached `session_init` and have no row, so the
        // `claude_session_id` snapshot is `None` — nothing to mark closed.
        if let Some(claude_id) = claude_session_id {
            self.sessions_recorder.mark_closed(&claude_id);
        }
    }

    /// Resolved terminal-liveness registry root: the configured
    /// override, else the production default (`~/.claude/sessions/`).
    fn terminal_registry_root(&self) -> Option<PathBuf> {
        self.config
            .terminal_registry_root
            .clone()
            .or_else(crate::terminal_registry::default_registry_root)
    }

    /// Read the terminal-liveness registry. Fail-open: no resolvable
    /// root → empty map (no liveness data, never an error).
    fn read_terminal_live_sessions(
        registry_root: Option<&std::path::Path>,
    ) -> HashMap<String, crate::terminal_registry::TerminalLiveEntry> {
        match registry_root {
            Some(root) => crate::terminal_registry::read_live_sessions(root),
            None => HashMap::new(),
        }
    }

    /// Broadcast a `list_sessions_ok` frame. `scanning` is `true` for the
    /// cheap phase-1 emit (ledger rows only, external scan still running)
    /// and `false` for the settled phase-2 emit carrying the full union —
    /// the picker shows a scanning indicator while `true` and clears it
    /// when the `false` frame replaces the snapshot.
    fn send_list_sessions_ok(
        control_tx: &broadcast::Sender<Frame>,
        project_dir: &str,
        dir_exists: bool,
        sessions: &[ListedSession],
        scanning: bool,
    ) {
        let body = serde_json::json!({
            "action": "list_sessions_ok",
            "project_dir": project_dir,
            "dir_exists": dir_exists,
            "scanning": scanning,
            "sessions": sessions,
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("list_sessions_ok serializes"),
        ));
    }

    fn send_list_sessions_err(control_tx: &broadcast::Sender<Frame>, project_dir: &str) {
        let body = serde_json::json!({
            "action": "list_sessions_err",
            "project_dir": project_dir,
            "reason": "ledger_read_failed",
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("list_sessions_err serializes"),
        ));
    }

    /// Handle a `list_sessions` CONTROL request. Broadcasts a
    /// `list_sessions_ok` response carrying the **union** of:
    ///
    /// - sqlite ledger rows whose `project_dir` matches the requested
    ///   path (`origin: "tug"`), and
    /// - on-disk session JSONLs discovered under the encoded claude
    ///   project directory that have no ledger row
    ///   (`origin: "external"` — typically terminal-created sessions).
    ///
    /// Deduped by session id (ledger wins — it carries richer,
    /// Tug-authored metadata), sorted newest-first by `last_used_at`.
    /// Every row — both origins — is annotated with `terminal_live`
    /// when a live process registered in `~/.claude/sessions/`
    /// currently holds it.
    ///
    /// Emitted in **two phases** so the picker never blocks on the scan
    /// (see the inline phase comments and Risk R03): a cheap phase-1
    /// `list_sessions_ok { scanning: true }` with the ledger rows lands
    /// immediately, then a settled phase-2 `{ scanning: false }` with the
    /// full union lands once the off-loop JSONL scan completes. The client
    /// replaces its snapshot on each, so external rows stream in.
    ///
    /// The response also carries `dir_exists` — a filesystem check on
    /// `project_dir` — so the picker can disable its Open button before
    /// a doomed `spawn_session` is ever sent. tugdeck has no filesystem
    /// access of its own, so this read piggybacks on the per-path query
    /// the picker already issues.
    async fn do_list_sessions(&self, project_dir: &str) {
        // `false` covers both a missing path and a non-directory — the
        // picker only needs the binary "is this an openable directory"
        // signal.
        let dir_exists = tokio::fs::metadata(project_dir)
            .await
            .map(|m| m.is_dir())
            .unwrap_or(false);
        let Some(ledger) = self.session_ledger.as_ref() else {
            // No ledger wired — emit an empty, settled response so a
            // confused client doesn't sit on a pending state forever.
            Self::send_list_sessions_ok(&self.control_tx, project_dir, dir_exists, &[], false);
            return;
        };

        let ledger_arc = Arc::clone(ledger);
        let registry_root = self.terminal_registry_root();
        let control_tx = self.control_tx.clone();
        let pd = project_dir.to_owned();

        // ── Phase 1: cheap reads (sqlite ledger + the handful of tiny
        //    `~/.claude/sessions` registry files). Emitted IMMEDIATELY so
        //    the picker shows "New session" plus every resumable ledger
        //    row without waiting on the JSONL scan — which on a large
        //    project dir (this repo's claude dir is ~1k files / multi-GB)
        //    can take many seconds (Risk R03). Pressing Cmd-N must never
        //    block on the scan; before this split it froze the dialog for
        //    the full scan duration.
        let phase1 = tokio::task::spawn_blocking({
            let ledger_arc = Arc::clone(&ledger_arc);
            let registry_root = registry_root.clone();
            let pd = pd.clone();
            move || {
                let rows = ledger_arc.list_for_project_dir(&pd)?;
                let live = Self::read_terminal_live_sessions(registry_root.as_deref());
                Ok::<_, crate::session_ledger::LedgerError>((rows, live))
            }
        })
        .await;
        let (rows, live) = match phase1 {
            Ok(Ok(t)) => t,
            Ok(Err(err)) => {
                warn!(error = %err, project_dir, "list_sessions phase 1 failed");
                Self::send_list_sessions_err(&control_tx, project_dir);
                return;
            }
            Err(join_err) => {
                warn!(error = %join_err, project_dir, "list_sessions worker panicked");
                Self::send_list_sessions_err(&control_tx, project_dir);
                return;
            }
        };

        // Phase 1 emit: ledger-only preview, scan still pending.
        let ledger_preview = build_listed_union(rows, &live, None);
        Self::send_list_sessions_ok(&control_tx, project_dir, dir_exists, &ledger_preview, true);

        // ── Phase 2: the expensive JSONL scan, run off the control loop in
        //    a detached task. Re-reads the ledger + liveness **fresh**
        //    alongside the scan, so any `session_updated` that lands during
        //    the scan window is reflected in the settled frame instead of
        //    being clobbered by the stale phase-1 snapshot. Emits the
        //    authoritative union (scanning: false); the client replaces its
        //    snapshot, so external/terminal rows stream in and the scanning
        //    indicator clears. The scan resolves the typed path to claude's
        //    canonical directory internally (the `claude_project_dir`
        //    chokepoint).
        let project_dir_owned = project_dir.to_owned();
        // Phase-1 preview, retained only as the settle-with-rows fallback if
        // the phase-2 worker panics (effectively unreachable — its body
        // cannot panic on well-formed input — but keeps the indicator from
        // ever spinning forever).
        let preview_fallback = ledger_preview;
        tokio::spawn(async move {
            let progress_tx = control_tx.clone();
            let built = tokio::task::spawn_blocking(move || {
                let rows = ledger_arc.list_for_project_dir(&pd).unwrap_or_else(|err| {
                    warn!(error = %err, "list_sessions phase 2 ledger re-read failed");
                    Vec::new()
                });
                let live = Self::read_terminal_live_sessions(registry_root.as_deref());
                // Throttled scan progress: `list_sessions_progress` frames
                // (≤ ~10 Hz, first and last ticks always) keyed by the
                // typed path — the client's cache key — so a cold or
                // whale-heavy scan reads as a moving count in the picker
                // instead of a silent stall. Pure-hit warm scans emit
                // nothing.
                let progress_pd = pd.clone();
                let last_emit: std::sync::Mutex<Option<std::time::Instant>> =
                    std::sync::Mutex::new(None);
                let scan = crate::external_sessions::scan_external_sessions_cached_with_progress(
                    &ledger_arc,
                    &pd,
                    |done, total| {
                        let now = std::time::Instant::now();
                        {
                            let mut last = last_emit.lock().expect("progress throttle mutex");
                            let boundary = done == 0 || done == total;
                            let due = last.is_none_or(|t| {
                                now.duration_since(t) >= std::time::Duration::from_millis(100)
                            });
                            if !boundary && !due {
                                return;
                            }
                            *last = Some(now);
                        }
                        let body = serde_json::json!({
                            "action": "list_sessions_progress",
                            "project_dir": progress_pd,
                            "parsed": done,
                            "total": total,
                        });
                        let _ = progress_tx.send(Frame::new(
                            FeedId::CONTROL,
                            serde_json::to_vec(&body).expect("list_sessions_progress serializes"),
                        ));
                    },
                );
                build_listed_union(rows, &live, Some(scan))
            })
            .await;
            match built {
                Ok(union) => {
                    Self::send_list_sessions_ok(
                        &control_tx,
                        &project_dir_owned,
                        dir_exists,
                        &union,
                        false,
                    );
                }
                Err(join_err) => {
                    warn!(
                        error = %join_err,
                        project_dir = %project_dir_owned,
                        "list_sessions phase 2 worker panicked",
                    );
                    // Settle with the phase-1 preview so the indicator clears
                    // and the user keeps their resumable rows.
                    Self::send_list_sessions_ok(
                        &control_tx,
                        &project_dir_owned,
                        dir_exists,
                        &preview_fallback,
                        false,
                    );
                }
            }
        });
    }

    /// Handle a `changeset_git_init` CONTROL request (Spec S07): `git init
    /// -b main` a non-repo project the changeset card offered to initialize.
    ///
    /// Guards, in order: `project_dir` must match a current
    /// `WorkspaceRegistry` entry (never init an arbitrary path off the wire),
    /// and it must not already be inside a git working tree. On success the
    /// process-global aggregate bump is fired so the card's section
    /// self-heals to a clean repo on the next recompute — there is no
    /// client-side state transition. Broadcasts `changeset_git_init_ok` /
    /// `changeset_git_init_err {detail}`.
    async fn do_changeset_git_init(&self, project_dir: &str) {
        let dir = std::path::Path::new(project_dir);

        // Guard 1: only an open workspace may be initialized.
        if self.registry.find_entry_by_path(dir).is_none() {
            Self::send_changeset_git_init_err(&self.control_tx, project_dir, "not an open project");
            return;
        }

        // Guard 2: refuse a directory already inside a git working tree.
        if crate::feeds::git::is_within_git_worktree(dir).await {
            Self::send_changeset_git_init_err(
                &self.control_tx,
                project_dir,
                "already a git repository",
            );
            return;
        }

        let output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["init", "-b", "main"])
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                // The next aggregate recompute sees a repo and the section
                // flips to a clean changeset — self-healing, no client flip.
                self.registry.changeset_all_bump().notify_one();
                Self::send_changeset_git_init_ok(&self.control_tx, project_dir);
            }
            Ok(out) => {
                let detail = String::from_utf8_lossy(&out.stderr).trim().to_string();
                Self::send_changeset_git_init_err(
                    &self.control_tx,
                    project_dir,
                    if detail.is_empty() {
                        "git init failed"
                    } else {
                        &detail
                    },
                );
            }
            Err(e) => {
                Self::send_changeset_git_init_err(&self.control_tx, project_dir, &e.to_string());
            }
        }
    }

    /// Handle a `changeset_draft_request` CONTROL request ([P03], Spec S01): an
    /// explicit, on-demand commit-message draft for one changeset entry.
    ///
    /// Resolves the entry against the latest CHANGESET_ALL aggregate frame (the
    /// stored watch receiver) and spawns its generation on a detached task —
    /// this method NEVER awaits the scribe run, so the router's per-client
    /// socket loop stays live to deliver the streamed deltas (R02). No-op when
    /// the scribe, the read-side ledger, or the aggregate watch isn't wired
    /// (tests without the draft path). When no eligible entry matches, replies
    /// `changeset_draft_state { state: "error", detail: "nothing to generate" }`
    /// ([Q02]).
    fn do_changeset_draft_request(&self, request: &ChangesetDraftRequestPayload) {
        let Some(scribe) = self.scribe.clone() else {
            return;
        };
        let Some(ledger) = self.session_ledger.clone() else {
            return;
        };
        let Some(watch_rx) = self.changeset_watch.get() else {
            return;
        };
        let frame = watch_rx.borrow().clone();
        let Ok(snapshot) = serde_json::from_slice::<tugcast_core::types::WorkspacesChangesetSnapshot>(
            &frame.payload,
        ) else {
            return; // the initial empty frame, or a decode miss
        };

        // Sync resolver over the tokio async mutex: `try_lock` never blocks —
        // under rare contention it degrades to "no claude id" (the draft prompt
        // then drops the session-prompt context, never fails).
        let inmem = Arc::clone(&self.ledger);
        let resolver: crate::feeds::draft_engine::SessionResolver =
            Arc::new(move |tug_id: &str| {
                let map = inmem.try_lock().ok()?;
                let entry = map.get(&TugSessionId(tug_id.to_string()))?;
                let entry = entry.try_lock().ok()?;
                entry.claude_session_id.clone()
            });

        let matched = crate::feeds::draft_engine::spawn_on_demand_draft(
            self.control_tx.clone(),
            ledger,
            Arc::clone(&self.registry),
            scribe,
            resolver,
            snapshot,
            &request.project_dir,
            &request.owner_kind,
            &request.owner_id,
        );
        if !matched {
            Self::send_changeset_draft_error(&self.control_tx, request, "nothing to generate");
        }
    }

    /// Broadcast a `changeset_draft_state` error for a request that matched no
    /// eligible entry ([Q02]) — the same wire shape the generation task's
    /// `send_state` emits, so the client overlay renders it identically.
    fn send_changeset_draft_error(
        control_tx: &broadcast::Sender<Frame>,
        request: &ChangesetDraftRequestPayload,
        detail: &str,
    ) {
        let body = serde_json::json!({
            "action": "changeset_draft_state",
            "project_dir": request.project_dir,
            "owner_kind": request.owner_kind,
            "owner_id": request.owner_id,
            "state": "error",
            "detail": detail,
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("changeset_draft_state serializes"),
        ));
    }

    /// Handle a `changeset_commit` CONTROL request (Spec S03, [P15]):
    /// commit exactly the listed files in an open project's checkout.
    ///
    /// Guards, in order: `project_dir` must match a current
    /// `WorkspaceRegistry` entry (never run git against an arbitrary path
    /// off the wire) and must lie inside a git working tree. The git work —
    /// pathspec-exact staging + commit, empty-list/blank-message refusal —
    /// lives in `run_changeset_commit`. On success the process-global
    /// aggregate bump fires so the card's entries drop the committed files
    /// on the next recompute, and `changeset_commit_ok {sha, receipt}` goes
    /// out; failures broadcast `changeset_commit_err {detail}`.
    async fn do_changeset_commit(&self, request: &ChangesetCommitPayload) {
        let project_dir = request.project_dir.as_str();
        let dir = std::path::Path::new(project_dir);

        if self.registry.find_entry_by_path(dir).is_none() {
            Self::send_changeset_commit_err(&self.control_tx, project_dir, "not an open project");
            return;
        }
        if !crate::feeds::git::is_within_git_worktree(dir).await {
            Self::send_changeset_commit_err(&self.control_tx, project_dir, "not a git repository");
            return;
        }

        let message = changeset_commit_message(request);
        match crate::feeds::changeset::run_changeset_commit(dir, &request.files, &message).await {
            Ok(receipt) => {
                self.registry.changeset_all_bump().notify_one();
                let body = serde_json::json!({
                    "action": "changeset_commit_ok",
                    "project_dir": project_dir,
                    "sha": receipt.sha,
                    "receipt": receipt.numstat,
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("changeset_commit_ok serializes"),
                ));
            }
            Err(detail) => {
                Self::send_changeset_commit_err(&self.control_tx, project_dir, &detail);
            }
        }
    }

    fn send_changeset_commit_err(
        control_tx: &broadcast::Sender<Frame>,
        project_dir: &str,
        detail: &str,
    ) {
        let body = serde_json::json!({
            "action": "changeset_commit_err",
            "project_dir": project_dir,
            "detail": detail,
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("changeset_commit_err serializes"),
        ));
    }

    /// Handle a `changeset_join` CONTROL request (Spec S03, [P14]): preview or
    /// execute a dash join via `tugdash-core`.
    ///
    /// Guards match the other changeset verbs: `project_dir` must be a current
    /// `WorkspaceRegistry` entry (never touch an arbitrary path off the wire)
    /// and must be a git working tree. The join itself runs on a blocking
    /// thread (synchronous git subprocesses). A `--preview` mutates nothing and
    /// reports conflicts in memory; a real join that lands a commit fires the
    /// process-global aggregate bump so the dash entry drops from the card on
    /// the next recompute. Broadcasts `changeset_join_ok {…JoinOutcome}` /
    /// `changeset_join_err {detail}`.
    async fn do_changeset_join(&self, request: &ChangesetJoinPayload) {
        let project_dir = request.project_dir.as_str();
        let dir = std::path::Path::new(project_dir);

        if self.registry.find_entry_by_path(dir).is_none() {
            Self::send_changeset_join_err(
                &self.control_tx,
                project_dir,
                &request.dash,
                "not an open project",
            );
            return;
        }
        if !crate::feeds::git::is_within_git_worktree(dir).await {
            Self::send_changeset_join_err(
                &self.control_tx,
                project_dir,
                &request.dash,
                "not a git repository",
            );
            return;
        }

        let dir_owned = dir.to_path_buf();
        let dash = request.dash.clone();
        let opts = tugdash_core::JoinOptions {
            strategy: request.strategy,
            message: request.message.clone(),
            preview: request.preview,
            continue_join: false,
            candidate: request.candidate.clone(),
        };
        let result =
            tokio::task::spawn_blocking(move || tugdash_core::join_in(&dir_owned, &dash, opts))
                .await;

        match result {
            Ok(Ok(outcome)) => {
                // A real join that landed a commit shrinks the changeset set —
                // refresh the card. A preview (or a conflict-aborted join)
                // mutated nothing, so no bump.
                if !outcome.previewed && outcome.commit_hash.is_some() {
                    self.registry.changeset_all_bump().notify_one();
                }
                let body = serde_json::json!({
                    "action": "changeset_join_ok",
                    "project_dir": project_dir,
                    "dash": request.dash,
                    "name": outcome.name,
                    "base_branch": outcome.base_branch,
                    "strategy": outcome.strategy,
                    "commit_hash": outcome.commit_hash,
                    "conflicts": outcome.conflicts,
                    "previewed": outcome.previewed,
                    "warnings": outcome.warnings,
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("changeset_join_ok serializes"),
                ));
            }
            Ok(Err(detail)) => {
                Self::send_changeset_join_err(
                    &self.control_tx,
                    project_dir,
                    &request.dash,
                    &detail,
                );
            }
            Err(join_err) => {
                Self::send_changeset_join_err(
                    &self.control_tx,
                    project_dir,
                    &request.dash,
                    &format!("join task failed: {join_err}"),
                );
            }
        }
    }

    fn send_changeset_join_err(
        control_tx: &broadcast::Sender<Frame>,
        project_dir: &str,
        dash: &str,
        detail: &str,
    ) {
        let body = serde_json::json!({
            "action": "changeset_join_err",
            "project_dir": project_dir,
            "dash": dash,
            "detail": detail,
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("changeset_join_err serializes"),
        ));
    }

    /// Handle a `changeset_join_resolve` CONTROL request (Spec S12, [P31]/[P32]):
    /// run the tugdash-core resolution ladder with the scribe AI rung injected,
    /// streaming per-file progress. The ladder builds a candidate commit off to
    /// the side; the card reviews it and lands it via a follow-up
    /// `changeset_join {candidate}`. Broadcasts the terminal
    /// `changeset_join_resolve_ok {…ResolveOutcome}` /
    /// `changeset_join_resolve_err {detail}`.
    async fn do_changeset_join_resolve(&self, request: &ChangesetJoinResolvePayload) {
        let project_dir = request.project_dir.as_str();
        let dir = std::path::Path::new(project_dir);

        if self.registry.find_entry_by_path(dir).is_none() {
            Self::send_changeset_join_resolve_err(
                &self.control_tx,
                project_dir,
                &request.dash,
                "not an open project",
            );
            return;
        }
        if !crate::feeds::git::is_within_git_worktree(dir).await {
            Self::send_changeset_join_resolve_err(
                &self.control_tx,
                project_dir,
                &request.dash,
                "not a git repository",
            );
            return;
        }

        // Build the AI rung from the scribe context when one is configured;
        // without it the ladder runs its algorithmic rungs only.
        let merger =
            self.scribe
                .as_ref()
                .map(|scribe| crate::feeds::join_resolve::ScribeFileMerger {
                    spawner: scribe.spawner.clone(),
                    model: scribe.model.clone(),
                    handle: tokio::runtime::Handle::current(),
                    control_tx: self.control_tx.clone(),
                    project_dir: project_dir.to_string(),
                    dash: request.dash.clone(),
                });

        let dir_owned = dir.to_path_buf();
        let dash = request.dash.clone();
        let result = tokio::task::spawn_blocking(move || {
            let merger_ref = merger.as_ref().map(|m| m as &dyn tugdash_core::FileMerger);
            tugdash_core::resolve_conflicts(&dir_owned, &dash, merger_ref)
        })
        .await;

        match result {
            Ok(Ok(outcome)) => {
                let mut body =
                    serde_json::to_value(&outcome).unwrap_or_else(|_| serde_json::json!({}));
                if let Some(map) = body.as_object_mut() {
                    map.insert(
                        "action".into(),
                        serde_json::Value::String("changeset_join_resolve_ok".into()),
                    );
                    map.insert(
                        "project_dir".into(),
                        serde_json::Value::String(project_dir.to_string()),
                    );
                    map.insert(
                        "dash".into(),
                        serde_json::Value::String(request.dash.clone()),
                    );
                }
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("changeset_join_resolve_ok serializes"),
                ));
            }
            Ok(Err(detail)) => {
                Self::send_changeset_join_resolve_err(
                    &self.control_tx,
                    project_dir,
                    &request.dash,
                    &detail,
                );
            }
            Err(join_err) => {
                Self::send_changeset_join_resolve_err(
                    &self.control_tx,
                    project_dir,
                    &request.dash,
                    &format!("resolve task failed: {join_err}"),
                );
            }
        }
    }

    fn send_changeset_join_resolve_err(
        control_tx: &broadcast::Sender<Frame>,
        project_dir: &str,
        dash: &str,
        detail: &str,
    ) {
        let body = serde_json::json!({
            "action": "changeset_join_resolve_err",
            "project_dir": project_dir,
            "dash": dash,
            "detail": detail,
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("changeset_join_resolve_err serializes"),
        ));
    }

    /// Handle a `changeset_release` CONTROL request: discard a dash (worktree +
    /// branch) without merging, via `tugdash-core`. Same guards as the join
    /// verb; fires the aggregate bump so the dash entry disappears from the
    /// card. Broadcasts `changeset_release_ok {…}` / `changeset_release_err`.
    async fn do_changeset_release(&self, request: &ChangesetReleasePayload) {
        let project_dir = request.project_dir.as_str();
        let dir = std::path::Path::new(project_dir);

        if self.registry.find_entry_by_path(dir).is_none() {
            Self::send_changeset_release_err(
                &self.control_tx,
                project_dir,
                &request.dash,
                "not an open project",
            );
            return;
        }
        if !crate::feeds::git::is_within_git_worktree(dir).await {
            Self::send_changeset_release_err(
                &self.control_tx,
                project_dir,
                &request.dash,
                "not a git repository",
            );
            return;
        }

        let dir_owned = dir.to_path_buf();
        let dash = request.dash.clone();
        let result =
            tokio::task::spawn_blocking(move || tugdash_core::release_in(&dir_owned, &dash)).await;

        match result {
            Ok(Ok(outcome)) => {
                self.registry.changeset_all_bump().notify_one();
                let body = serde_json::json!({
                    "action": "changeset_release_ok",
                    "project_dir": project_dir,
                    "dash": request.dash,
                    "name": outcome.name,
                    "warnings": outcome.warnings,
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("changeset_release_ok serializes"),
                ));
            }
            Ok(Err(detail)) => {
                Self::send_changeset_release_err(
                    &self.control_tx,
                    project_dir,
                    &request.dash,
                    &detail,
                );
            }
            Err(join_err) => {
                Self::send_changeset_release_err(
                    &self.control_tx,
                    project_dir,
                    &request.dash,
                    &format!("release task failed: {join_err}"),
                );
            }
        }
    }

    fn send_changeset_release_err(
        control_tx: &broadcast::Sender<Frame>,
        project_dir: &str,
        dash: &str,
        detail: &str,
    ) {
        let body = serde_json::json!({
            "action": "changeset_release_err",
            "project_dir": project_dir,
            "dash": dash,
            "detail": detail,
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("changeset_release_err serializes"),
        ));
    }

    fn send_changeset_git_init_ok(control_tx: &broadcast::Sender<Frame>, project_dir: &str) {
        let body = serde_json::json!({
            "action": "changeset_git_init_ok",
            "project_dir": project_dir,
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("changeset_git_init_ok serializes"),
        ));
    }

    fn send_changeset_git_init_err(
        control_tx: &broadcast::Sender<Frame>,
        project_dir: &str,
        detail: &str,
    ) {
        let body = serde_json::json!({
            "action": "changeset_git_init_err",
            "project_dir": project_dir,
            "detail": detail,
        });
        let _ = control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("changeset_git_init_err serializes"),
        ));
    }

    /// Handle a `list_card_bindings` CONTROL request. Reads every
    /// resumable ledger row (see `list_with_card_id` for the filter)
    /// and broadcasts a `list_card_bindings_ok` response. The
    /// client-side `restoreDevSessions` consumes this on startup and
    /// reconnect to re-assert per-card bindings. Multiple rows can
    /// share a `card_id` (sequential sessions on that card); the
    /// client picks the newest per card.
    async fn do_list_card_bindings(&self) {
        let Some(ledger) = self.session_ledger.as_ref() else {
            // No ledger wired — emit an empty response so a confused
            // client doesn't sit on a pending state forever.
            let body = serde_json::json!({
                "action": "list_card_bindings_ok",
                "bindings": serde_json::Value::Array(Vec::new()),
            });
            let _ = self.control_tx.send(Frame::new(
                FeedId::CONTROL,
                serde_json::to_vec(&body).expect("list_card_bindings_ok serializes"),
            ));
            return;
        };
        let rows = match ledger.list_with_card_id() {
            Ok(r) => r,
            Err(err) => {
                warn!(error = %err, "list_card_bindings failed");
                let body = serde_json::json!({
                    "action": "list_card_bindings_err",
                    "reason": "ledger_read_failed",
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("list_card_bindings_err serializes"),
                ));
                return;
            }
        };
        // Snapshot the live-session map so we can answer `is_alive` for
        // each row without N round-trip lock acquisitions. A session is
        // "alive" when its in-memory ledger entry is `Spawning` or
        // `Live` — i.e. there is (or imminently will be) a tugcode
        // subprocess holding the session's runtime state, including any
        // in-flight turn or pending control_request. `Idle`, `Errored`,
        // and `Closed` are all "not alive" — there's no subprocess to
        // resume into, so the client should fall through to the
        // `turn_count > 0` JSONL-replay path or to a fresh spawn.
        //
        // This flag is the missing signal that lets the client tell
        // "in-flight first turn" (resume-able, no JSONL yet) apart from
        // "Start Fresh + quit" (fresh-spawn-and-bind-project). Both have
        // `turn_count == 0`; only the live one has `is_alive == true`.
        let live_session_ids: std::collections::HashSet<String> = {
            let live = self.ledger.lock().await;
            let mut alive = std::collections::HashSet::with_capacity(live.len());
            for (sid, entry_arc) in live.iter() {
                let entry = entry_arc.lock().await;
                if matches!(entry.spawn_state, SpawnState::Spawning | SpawnState::Live) {
                    alive.insert(sid.0.clone());
                }
            }
            alive
        };
        let bindings: Vec<serde_json::Value> = rows
            .into_iter()
            .filter_map(|row| {
                let card_id = row.card_id?;
                let is_alive = live_session_ids.contains(&row.session_id);
                Some(serde_json::json!({
                    "card_id": card_id,
                    "session_id": row.session_id,
                    "project_dir": row.project_dir,
                    "state": row.state,
                    "turn_count": row.turn_count,
                    "is_alive": is_alive,
                    "name": row.name,
                    "name_user_set": row.name_user_set,
                    "tag": row.tag,
                }))
            })
            .collect();
        let body = serde_json::json!({
            "action": "list_card_bindings_ok",
            "bindings": bindings,
        });
        let _ = self.control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("list_card_bindings_ok serializes"),
        ));
    }

    /// Handle a `request_replay` CONTROL request per [D12]. Forwards
    /// `{"type":"request_replay"}` to the per-session tugcode subprocess
    /// over its existing CODE_INPUT channel (the same `input_tx` the
    /// dispatcher uses for `user_message`). Tugcode's IPC loop dispatches
    /// the verb to its `runReplay()` method, whose re-entrancy guard
    /// (Step R1a) drops a redundant request that arrives mid-replay.
    ///
    /// State-dependent delivery:
    ///
    /// * `Live` — forward immediately to `input_tx`.
    /// * `Spawning` — push at the **front** of `entry.queue`; the
    ///   bridge's `session_init` promote-and-drain critical section
    ///   forwards it to `input_tx` before any user input that may
    ///   have been buffered alongside (Step R4 / [D12]).
    /// * `Idle` — log skipped(idle); no claude to send to.
    /// * `Errored` — log skipped(errored); subprocess gone.
    /// * `Closed` — log skipped(closed); subprocess gone.
    ///
    /// **Front-push rationale**: cold boot races a `request_replay`
    /// dispatch against the user's first submit. If the dispatch
    /// arrives during the Spawning window and the user types
    /// instantly afterward, the dispatcher will queue the user's
    /// CODE_INPUT into the same per-session queue. FIFO drain would
    /// deliver the user_message first, putting tugcode in an
    /// in-flight turn that races with the request_replay — exactly
    /// the Smoke D shape that [Phase A-R3](roadmap/tugplan-dev-transcript-resume.md#phase-a-r3)
    /// owns. Front-push ensures replay always precedes user input
    /// from the same Spawning window — the natural ordering since
    /// the verb is "rehydrate the freshly-mounted store" and the
    /// store should be rehydrated before user-facing work begins.
    async fn do_request_replay(
        &self,
        tug_session_id: &TugSessionId,
        window: Option<serde_json::Value>,
    ) {
        let entry_arc = {
            let ledger = self.ledger.lock().await;
            match ledger.get(tug_session_id) {
                Some(e) => e.clone(),
                None => {
                    tracing::info!(
                        target: "dev::session-lifecycle",
                        event = "request_replay.skipped",
                        tug_session_id = %tug_session_id,
                        reason = "unknown",
                    );
                    return;
                }
            }
        };

        // Build the wire frame once; the body is the same regardless of
        // whether we forward immediately (Live) or queue (Spawning). The
        // optional recency `window` is forwarded verbatim — the supervisor
        // doesn't interpret it; tugcode validates the shape at its handler
        // boundary. The no-window path stays byte-identical to the legacy
        // full-replay request.
        let body: Vec<u8> = match &window {
            Some(w) => serde_json::to_vec(&serde_json::json!({
                "type": "request_replay",
                "window": w,
            }))
            .expect("request_replay payload serializes"),
            None => b"{\"type\":\"request_replay\"}".to_vec(),
        };
        let frame = Frame::new(FeedId::CODE_INPUT, body);

        // For the Spawning branch we need the entry mutex held while we
        // mutate `queue`. For the Live branch we want to release the
        // mutex before the (potentially blocking) mpsc send. Branch
        // inside the lock: Spawning enqueues here; Live takes a snapshot
        // of `input_tx` and sends after dropping the lock.
        let snapshot = {
            let mut entry = entry_arc.lock().await;
            match entry.spawn_state {
                SpawnState::Spawning => {
                    let push_result = entry.queue.push_front(frame);
                    if push_result == QueuePush::Overflow {
                        // Per-session queue capacity is bounded; an
                        // overflowing front-push means the dispatcher
                        // already crammed the queue with user input
                        // during the Spawning window. Log loudly — this
                        // is rare and indicates the user is typing
                        // faster than tugcode can spawn. The verb is
                        // dropped; the cold-boot transcript may show
                        // empty until the next dispatch (e.g. a
                        // subsequent reload).
                        tracing::warn!(
                            target: "dev::session-lifecycle",
                            event = "request_replay.skipped",
                            tug_session_id = %tug_session_id,
                            reason = "spawning_queue_overflow",
                        );
                        return;
                    }
                    tracing::info!(
                        target: "dev::session-lifecycle",
                        event = "request_replay.queued",
                        tug_session_id = %tug_session_id,
                        reason = "spawning_window",
                    );
                    return;
                }
                SpawnState::Live => entry.input_tx.clone(),
                SpawnState::Idle | SpawnState::Errored | SpawnState::Closed => {
                    let reason = match entry.spawn_state {
                        SpawnState::Idle => "idle",
                        SpawnState::Errored => "errored",
                        SpawnState::Closed => "closed",
                        _ => unreachable!(),
                    };
                    tracing::info!(
                        target: "dev::session-lifecycle",
                        event = "request_replay.skipped",
                        tug_session_id = %tug_session_id,
                        reason = reason,
                    );
                    return;
                }
            }
        };

        // Live branch continues here with the entry lock released.
        // `snapshot` is `Option<mpsc::Sender<Frame>>`.
        //
        // Live but no `input_tx` is a programming error — `Live` means
        // the bridge promoted the entry past `session_init` and the
        // worker installs `input_tx` before that promotion. Treat as
        // a skip on the user-visible path and warn loudly so the
        // condition surfaces in tracing.
        let Some(tx) = snapshot else {
            tracing::warn!(
                target: "dev::session-lifecycle",
                event = "request_replay.skipped",
                tug_session_id = %tug_session_id,
                reason = "no_input_tx",
            );
            return;
        };

        if let Err(e) = tx.send(frame).await {
            warn!(
                tug_session_id = %tug_session_id,
                error = %e,
                "request_replay: send to input_tx failed",
            );
            return;
        }
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "request_replay.dispatched",
            tug_session_id = %tug_session_id,
        );
    }

    /// Handle a `trash_session` CONTROL request. Refuses if the row is
    /// currently live (per [D03] / picker UX). Emits `session_updated
    /// { removed: true }` on success — the recorder broadcasts that frame
    /// internally; this handler emits the matching `trash_session_ok`
    /// response so the requesting client can resolve its pending action.
    /// Persist a per-turn telemetry block. Tugdeck → tugcast inbound
    /// CONTROL action driven by the reducer's `handleTurnComplete`
    /// (live path only — replayed turns aren't re-persisted). The
    /// claude `session_id` is the row's PK; we resolve it from the
    /// ledger entry keyed by `tug_session_id` (the wire-side
    /// identifier the client uses).
    ///
    /// The write is fire-and-forget at the wire level — no ack frame
    /// is broadcast. The client doesn't wait on confirmation; the
    /// row's reason for existing is to survive the next reload, not
    /// the next render. A `LedgerError` here is logged at `warn`
    /// (telemetry, not a user-visible failure).
    ///
    /// Three quietly-dropped cases — all benign:
    ///   1. No `SessionLedger` configured (test harnesses without
    ///      persistence). Nothing to do.
    ///   2. Ledger entry not found for `tug_session_id` (the session
    ///      was already evicted or never spawned through this
    ///      supervisor). Nothing to write to.
    ///   3. Ledger entry exists but `claude_session_id` is `None`
    ///      (handshake not yet complete). The reducer should never
    ///      reach `handleTurnComplete` before `session_init` lands,
    ///      so this branch is defensive — if it ever fires, log and
    ///      drop. The next live turn whose `session_init` precedes
    ///      it will write a fresh row.
    async fn do_record_turn_telemetry(&self, parsed: RecordTurnTelemetryPayload) {
        let Some(ledger) = self.session_ledger.as_ref() else {
            return;
        };
        let claude_id = {
            let outer = self.ledger.lock().await;
            let Some(entry_arc) = outer.get(&parsed.tug_session_id) else {
                tracing::warn!(
                    target: "dev::telemetry",
                    event = "record_turn_telemetry.skipped",
                    tug_session_id = %parsed.tug_session_id,
                    msg_id = %parsed.msg_id,
                    reason = "session_not_found",
                );
                return;
            };
            let entry = entry_arc.lock().await;
            entry.claude_session_id.clone()
        };
        let Some(claude_id) = claude_id else {
            tracing::warn!(
                target: "dev::telemetry",
                event = "record_turn_telemetry.skipped",
                tug_session_id = %parsed.tug_session_id,
                msg_id = %parsed.msg_id,
                reason = "no_claude_session_id",
            );
            return;
        };
        let row = crate::session_ledger::TurnTelemetryRow {
            session_id: claude_id,
            msg_id: parsed.msg_id,
            input_tokens: parsed.cost_input_tokens,
            output_tokens: parsed.cost_output_tokens,
            cache_creation_input_tokens: parsed.cost_cache_creation_input_tokens,
            cache_read_input_tokens: parsed.cost_cache_read_input_tokens,
            total_cost_usd: parsed.cost_total_cost_usd,
            wall_clock_ms: parsed.wall_clock_ms,
            awaiting_approval_ms: parsed.awaiting_approval_ms,
            transport_downtime_ms: parsed.transport_downtime_ms,
            active_ms: parsed.active_ms,
            ttft_ms: parsed.ttft_ms,
            ttftc_ms: parsed.ttftc_ms,
            reconnect_count: parsed.reconnect_count,
            max_stream_gap_ms: parsed.max_stream_gap_ms,
            ended_at: parsed.ended_at,
            session_init_tokens: parsed.session_init_tokens,
        };
        if let Err(err) = ledger.record_turn_telemetry(&row) {
            tracing::warn!(
                target: "dev::telemetry",
                error = %err,
                session_id = %row.session_id,
                msg_id = %row.msg_id,
                "record_turn_telemetry ledger write failed",
            );
        }
    }

    /// Persist the latest `/context`-style breakdown payload for a
    /// session via the SessionLedger. Mirrors
    /// {@link do_record_turn_telemetry} structurally: resolve
    /// `tug_session_id → claude_session_id`, UPSERT one row keyed by
    /// claude session id. The three quietly-dropped cases — no
    /// ledger configured, no session entry, no claude_session_id —
    /// log at telemetry level and return without raising.
    async fn do_record_context_breakdown(&self, parsed: RecordContextBreakdownPayload) {
        let Some(ledger) = self.session_ledger.as_ref() else {
            return;
        };
        let claude_id = {
            let outer = self.ledger.lock().await;
            let Some(entry_arc) = outer.get(&parsed.tug_session_id) else {
                tracing::warn!(
                    target: "dev::telemetry",
                    event = "record_context_breakdown.skipped",
                    tug_session_id = %parsed.tug_session_id,
                    reason = "session_not_found",
                );
                return;
            };
            let entry = entry_arc.lock().await;
            entry.claude_session_id.clone()
        };
        let Some(claude_id) = claude_id else {
            tracing::warn!(
                target: "dev::telemetry",
                event = "record_context_breakdown.skipped",
                tug_session_id = %parsed.tug_session_id,
                reason = "no_claude_session_id",
            );
            return;
        };
        if let Err(err) =
            ledger.record_context_breakdown(&claude_id, &parsed.payload_bytes, parsed.captured_at)
        {
            tracing::warn!(
                target: "dev::telemetry",
                error = %err,
                session_id = %claude_id,
                "record_context_breakdown ledger write failed",
            );
        }
    }

    /// Persist one indicator-tone triple transition via the
    /// SessionLedger. Structurally mirrors
    /// {@link do_record_context_breakdown}: resolve
    /// `tug_session_id → claude_session_id`, hand the row to the
    /// ledger. The ledger's per-session dedupe is the SQL-layer
    /// safety net for races where the client-side prev/new compare
    /// in `dispatch()` doesn't get the chance to skip a redundant
    /// write (e.g., two near-simultaneous dispatches that both see
    /// the same previous state).
    ///
    /// The three quietly-dropped cases — no ledger configured, no
    /// session entry, no claude_session_id — log at telemetry level
    /// and return without raising; mirrors the context-breakdown
    /// handler.
    async fn do_record_session_state_change(&self, parsed: RecordSessionStateChangePayload) {
        let Some(ledger) = self.session_ledger.as_ref() else {
            return;
        };
        let claude_id = {
            let outer = self.ledger.lock().await;
            let Some(entry_arc) = outer.get(&parsed.tug_session_id) else {
                tracing::warn!(
                    target: "dev::telemetry",
                    event = "record_session_state_change.skipped",
                    tug_session_id = %parsed.tug_session_id,
                    reason = "session_not_found",
                );
                return;
            };
            let entry = entry_arc.lock().await;
            entry.claude_session_id.clone()
        };
        let Some(claude_id) = claude_id else {
            tracing::warn!(
                target: "dev::telemetry",
                event = "record_session_state_change.skipped",
                tug_session_id = %parsed.tug_session_id,
                reason = "no_claude_session_id",
            );
            return;
        };
        if let Err(err) = ledger.record_session_state_change(
            &claude_id,
            parsed.at_ms,
            &parsed.phase,
            &parsed.transport_state,
            parsed.interrupt_in_flight,
        ) {
            tracing::warn!(
                target: "dev::telemetry",
                error = %err,
                session_id = %claude_id,
                "record_session_state_change ledger write failed",
            );
        }
    }

    /// Handle a `list_session_state_changes` CONTROL request. Reads
    /// every persisted triple-transition row for the resolved claude
    /// session id and broadcasts a `list_session_state_changes_ok`
    /// response carrying the rows oldest-first by `id`. The client-
    /// side reader correlates by the `tug_session_id` field, which
    /// is echoed verbatim from the request.
    ///
    /// Empty arrays are valid responses: a fresh session that has
    /// never had a triple change yet has no rows; the client should
    /// render a "no history" state.
    ///
    /// Errors broadcast `list_session_state_changes_err
    /// { tug_session_id, reason }`. When no `session_ledger` is wired
    /// the response is an empty array. When the in-memory map cannot
    /// resolve a `claude_session_id` (no session entry, or a resumed
    /// entry whose id has not landed yet) the read falls back to
    /// `tug_session_id` as the ledger key — identical to the claude
    /// id by the post-Phase-B invariant — so the persisted history
    /// survives a tugdeck reload that races the resume handshake. A
    /// genuinely unknown id still reads as an empty array; the popover
    /// renders the same "no history yet" state either way.
    async fn do_list_session_state_changes(&self, parsed: ListSessionStateChangesPayload) {
        let tug_session_id_str = parsed.tug_session_id.as_str().to_owned();
        let Some(ledger) = self.session_ledger.as_ref() else {
            let body = serde_json::json!({
                "action": "list_session_state_changes_ok",
                "tug_session_id": tug_session_id_str,
                "rows": serde_json::Value::Array(Vec::new()),
            });
            let _ = self.control_tx.send(Frame::new(
                FeedId::CONTROL,
                serde_json::to_vec(&body).expect("list_session_state_changes_ok serializes"),
            ));
            return;
        };
        let resolved_claude_id = {
            let outer = self.ledger.lock().await;
            match outer.get(&parsed.tug_session_id) {
                Some(entry_arc) => {
                    let entry = entry_arc.lock().await;
                    entry.claude_session_id.clone()
                }
                None => None,
            }
        };
        // Resolve the ledger key. The in-memory entry may not yet carry
        // the resumed session's claude id — after a tugdeck reload the
        // popover's `list_session_state_changes` request can race ahead
        // of the resume handshake that sets `claude_session_id`. Post-
        // Phase-B the tug and claude session ids are identical by
        // invariant, and `session_state_changes` rows are keyed by the
        // claude id, so falling back to `tug_session_id` recovers the
        // persisted history instead of returning a spurious empty array
        // (the popover's "no state changes recorded" bug after reload).
        // A genuinely unknown id still yields an empty ledger read —
        // the same "no history yet" the client renders either way.
        let claude_id = resolved_claude_id.unwrap_or_else(|| tug_session_id_str.clone());
        let rows = match ledger.list_session_state_changes(&claude_id) {
            Ok(r) => r,
            Err(err) => {
                warn!(error = %err, session_id = %claude_id, "list_session_state_changes failed");
                let body = serde_json::json!({
                    "action": "list_session_state_changes_err",
                    "tug_session_id": tug_session_id_str,
                    "reason": "ledger_read_failed",
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("list_session_state_changes_err serializes"),
                ));
                return;
            }
        };
        let wire_rows: Vec<serde_json::Value> = rows
            .into_iter()
            .map(|r| {
                serde_json::json!({
                    "at_ms": r.at_ms,
                    "phase": r.phase,
                    "transport_state": r.transport_state,
                    "interrupt_in_flight": r.interrupt_in_flight,
                })
            })
            .collect();
        let body = serde_json::json!({
            "action": "list_session_state_changes_ok",
            "tug_session_id": tug_session_id_str,
            "rows": wire_rows,
        });
        let _ = self.control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("list_session_state_changes_ok serializes"),
        ));
    }

    /// Handle a `list_pulse_lines` CONTROL request — the deck's
    /// PULSE-ledger tail read (the pulse-store sends it on mount, then
    /// stays live off the PULSE feed). App-scoped: no session id.
    /// Broadcasts `list_pulse_lines_ok { lines: PulseLineRow[] }`,
    /// oldest-first; a missing ledger yields an empty array (the
    /// "no history yet" state, same conduct as the state-changes read).
    async fn do_list_pulse_lines(&self) {
        let lines = self
            .session_ledger
            .as_ref()
            .map(|ledger| {
                ledger
                    .list_pulse_lines_tail(crate::feeds::pulse::PULSE_TAIL_LEN)
                    .unwrap_or_else(|err| {
                        warn!(error = %err, "list_pulse_lines failed");
                        Vec::new()
                    })
            })
            .unwrap_or_default();
        let body = serde_json::json!({
            "action": "list_pulse_lines_ok",
            "lines": lines,
        });
        let _ = self.control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("list_pulse_lines_ok serializes"),
        ));
    }

    /// Attach the shell-exchange ledger (the read side of the
    /// `list_shell_exchanges` CONTROL op). Called once in `main.rs` before the
    /// supervisor is shared.
    pub fn set_shell_ledger(&mut self, ledger: Arc<crate::shell_ledger::ShellLedger>) {
        self.shell_ledger = Some(ledger);
    }

    /// Attach the changeset scribe (the maintained-draft engine's backend).
    /// Called once in `main.rs` before the supervisor is shared.
    pub fn set_scribe(&mut self, scribe: ScribeContext) {
        self.scribe = Some(scribe);
    }

    /// Store the aggregate CHANGESET_ALL watch receiver for the on-demand draft
    /// path (#draft-engine, [P03]). No background loop is spawned — generation
    /// runs only on an explicit `changeset_draft_request`, off the latest frame
    /// this receiver holds. `do_changeset_draft_request` reads it back and
    /// resolves `tug_session_id → claude_session_id` from this supervisor's
    /// in-memory ledger entries at request time.
    pub fn start_draft_engine(
        self: &Arc<Self>,
        watch_rx: watch::Receiver<Frame>,
        _cancel: CancellationToken,
    ) {
        let _ = self.changeset_watch.set(watch_rx);
    }

    /// Handle a `list_shell_exchanges { tug_session_id }` CONTROL request — the
    /// deck's shell-restore tail read. Broadcasts `list_shell_exchanges_ok
    /// { tug_session_id, exchanges: ShellExchangeRow[] }`, oldest-first; a
    /// missing ledger or empty session yields an empty array.
    async fn do_list_shell_exchanges(&self, tug_session_id: &str) {
        let exchanges = self
            .shell_ledger
            .as_ref()
            .map(|ledger| {
                ledger.list_exchanges(tug_session_id).unwrap_or_else(|err| {
                    warn!(error = %err, %tug_session_id, "list_shell_exchanges failed");
                    Vec::new()
                })
            })
            .unwrap_or_default();
        let body = serde_json::json!({
            "action": "list_shell_exchanges_ok",
            "tug_session_id": tug_session_id,
            "exchanges": exchanges,
        });
        let _ = self.control_tx.send(Frame::new(
            FeedId::CONTROL,
            serde_json::to_vec(&body).expect("list_shell_exchanges_ok serializes"),
        ));
    }

    /// Handle a `trash_session` CONTROL request. For ledger rows this
    /// deletes the row and moves the JSONL to in-place trash (the
    /// ledger refuses live rows). For external sessions — no ledger
    /// row, `project_dir` supplied by the picker — the JSONL move is
    /// the whole operation. Both paths are gated on terminal liveness.
    async fn do_trash_session(&self, session_id: &str, project_dir: Option<&str>) {
        let Some(ledger) = self.session_ledger.as_ref() else {
            let body = serde_json::json!({
                "action": "trash_session_err",
                "session_id": session_id,
                "reason": "no_ledger",
            });
            let _ = self.control_tx.send(Frame::new(
                FeedId::CONTROL,
                serde_json::to_vec(&body).expect("trash_session_err serializes"),
            ));
            return;
        };
        // Terminal-liveness gate: trashing moves the JSONL out from
        // under any process holding the session — refuse while a live
        // terminal process is registered against it, mirroring the
        // ledger's own live-row refusal.
        let registry_root = self.terminal_registry_root();
        let sid = session_id.to_owned();
        let held = tokio::task::spawn_blocking(move || {
            Self::read_terminal_live_sessions(registry_root.as_deref()).contains_key(&sid)
        })
        .await
        .unwrap_or(false);
        if held {
            let body = serde_json::json!({
                "action": "trash_session_err",
                "session_id": session_id,
                "reason": "session_live_in_terminal",
            });
            let _ = self.control_tx.send(Frame::new(
                FeedId::CONTROL,
                serde_json::to_vec(&body).expect("trash_session_err serializes"),
            ));
            return;
        }
        match ledger.trash(session_id) {
            Ok(_) => {
                let _ = self
                    .control_tx
                    .send(build_session_removed_frame(session_id));
                let body = serde_json::json!({
                    "action": "trash_session_ok",
                    "session_id": session_id,
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("trash_session_ok serializes"),
                ));
            }
            Err(crate::session_ledger::LedgerError::InvalidState(_)) => {
                let body = serde_json::json!({
                    "action": "trash_session_err",
                    "session_id": session_id,
                    "reason": "session_is_live",
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("trash_session_err serializes"),
                ));
            }
            Err(crate::session_ledger::LedgerError::NotFound(_)) => {
                // No ledger row. With a project_dir in the payload this
                // is an external session: the JSONL move is the whole
                // trash operation.
                if let Some(pd) = project_dir {
                    let ledger_arc = Arc::clone(ledger);
                    let pd_owned = pd.to_owned();
                    let sid = session_id.to_owned();
                    let moved = tokio::task::spawn_blocking(move || {
                        ledger_arc.trash_external_jsonl(&pd_owned, &sid)
                    })
                    .await
                    .unwrap_or(None);
                    if moved.is_some() {
                        let _ = self
                            .control_tx
                            .send(build_session_removed_frame(session_id));
                        let body = serde_json::json!({
                            "action": "trash_session_ok",
                            "session_id": session_id,
                        });
                        let _ = self.control_tx.send(Frame::new(
                            FeedId::CONTROL,
                            serde_json::to_vec(&body).expect("trash_session_ok serializes"),
                        ));
                        return;
                    }
                }
                let body = serde_json::json!({
                    "action": "trash_session_err",
                    "session_id": session_id,
                    "reason": "not_found",
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("trash_session_err serializes"),
                ));
            }
            Err(err) => {
                warn!(error = %err, session_id, "trash_session ledger error");
                let body = serde_json::json!({
                    "action": "trash_session_err",
                    "session_id": session_id,
                    "reason": "ledger_write_failed",
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("trash_session_err serializes"),
                ));
            }
        }
    }

    /// Handle a `rename_session` CONTROL request ([#step-13d]). Writes the name
    /// to the ledger and broadcasts a `session_updated` so the chooser + the
    /// Z4B session chip pick it up live, then acks `rename_session_ok` / `_err`.
    async fn do_rename_session(&self, session_id: &str, name: Option<&str>) {
        let Some(ledger) = self.session_ledger.as_ref() else {
            let body = serde_json::json!({
                "action": "rename_session_err",
                "session_id": session_id,
                "reason": "no_ledger",
            });
            let _ = self.control_tx.send(Frame::new(
                FeedId::CONTROL,
                serde_json::to_vec(&body).expect("rename_session_err serializes"),
            ));
            return;
        };
        match ledger.rename(session_id, name) {
            Ok(_) => {
                // Push the updated row so the chooser + chip reflect the rename
                // without a re-fetch. A missing row here would be a TOCTOU race
                // (renamed then trashed); the get is best-effort.
                if let Ok(Some(row)) = ledger.get(session_id) {
                    let _ = self.control_tx.send(build_session_updated_frame(&row));
                }
                let body = serde_json::json!({
                    "action": "rename_session_ok",
                    "session_id": session_id,
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("rename_session_ok serializes"),
                ));
            }
            Err(crate::session_ledger::LedgerError::NotFound(_)) => {
                let body = serde_json::json!({
                    "action": "rename_session_err",
                    "session_id": session_id,
                    "reason": "not_found",
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("rename_session_err serializes"),
                ));
            }
            Err(err) => {
                warn!(error = %err, session_id, "rename_session ledger error");
                let body = serde_json::json!({
                    "action": "rename_session_err",
                    "session_id": session_id,
                    "reason": "ledger_write_failed",
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("rename_session_err serializes"),
                ));
            }
        }
    }

    /// Handle a `trash_project_dir_sessions` CONTROL request. Drops every
    /// non-live row whose `project_dir` matches the request, broadcasts a
    /// `session_updated { removed: true }` per dropped id, and returns a
    /// count via `trash_project_dir_sessions_ok`. Used by the recents-
    /// eviction → ledger-eviction coupling.
    async fn do_trash_project_dir_sessions(&self, project_dir: &str) {
        let Some(ledger) = self.session_ledger.as_ref() else {
            let body = serde_json::json!({
                "action": "trash_project_dir_sessions_err",
                "project_dir": project_dir,
                "reason": "no_ledger",
            });
            let _ = self.control_tx.send(Frame::new(
                FeedId::CONTROL,
                serde_json::to_vec(&body).expect("trash_project_dir_sessions_err serializes"),
            ));
            return;
        };
        match ledger.trash_for_project_dir(project_dir) {
            Ok(dropped) => {
                for id in &dropped {
                    let _ = self.control_tx.send(build_session_removed_frame(id));
                }
                let body = serde_json::json!({
                    "action": "trash_project_dir_sessions_ok",
                    "project_dir": project_dir,
                    "count": dropped.len(),
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("trash_project_dir_sessions_ok serializes"),
                ));
            }
            Err(err) => {
                warn!(error = %err, project_dir, "trash_for_project_dir failed");
                let body = serde_json::json!({
                    "action": "trash_project_dir_sessions_err",
                    "project_dir": project_dir,
                    "reason": "ledger_write_failed",
                });
                let _ = self.control_tx.send(Frame::new(
                    FeedId::CONTROL,
                    serde_json::to_vec(&body).expect("trash_project_dir_sessions_err serializes"),
                ));
            }
        }
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
        card_id: &str,
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
        // Reset invalidates `claude_session_id` (in-memory clear +
        // tugbank delete) and flips `session_mode` back to `New` so the
        // next spawn is fresh. Without the mode flip, a card whose
        // session_mode was `Resume` would still spawn `--session-mode
        // resume`, and tugcode would fall back to `--resume <session_id>`
        // — finding the JSONL still on disk and restoring the
        // conversation the user explicitly asked to discard. The
        // invalidate-then-cancel ordering closes the persistence gap
        // before the bridge can be re-spawned: even if the cancel races
        // an overlapping CODE_INPUT, the next spawn sees `New` mode and
        // no claude_session_id, so it spawns truly fresh.
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
                entry.claude_session_id = None;
                entry.session_mode = super::agent_bridge::SessionMode::New;
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

        tracing::info!(
            target: "dev::session-lifecycle",
            event = "reset_session.cleared",
            card_id = card_id,
            tug_session_id = %tug_session_id,
        );

        self.session_state.publish_tagged(build_session_state_frame(
            tug_session_id,
            "closed",
            None,
        ));
        self.session_state.publish_tagged(build_session_state_frame(
            tug_session_id,
            "pending",
            None,
        ));
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

        // Inspect the payload's top-level fields once; the user_message
        // intercept below reads `type`, `text`, and `attachments` from
        // the same parse. A malformed payload yields `None`, which the
        // intercept treats as "skip the user_message branch and fall
        // through to the existing routing" — same as a payload whose
        // `type` is not `user_message`.
        let inspected = super::payload_inspector::InspectedPayload::from_slice(&frame.payload);

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

        // ── user_message intercept ──────────────────────────────────────────
        //
        // For inbound `user_message` frames: mint an internal `journal_id`
        // and persist a pending row to the submission journal, then
        // forward the frame **unchanged**. Order is load-bearing:
        // row-persisted-before-forwarded. A failure before the forward
        // drops the inbound frame (the supervisor emits a CONTROL error);
        // a forwarded frame with no row is structurally impossible because
        // the forward only happens after `Ok` from `insert_pending_turn`.
        // The journal id is internal to tugcast — not surfaced on the
        // wire, never seen by tugcode (the merger reconciles by
        // session-scoped FIFO, not by id). Other CODE_INPUT types —
        // `tool_approval`, `interrupt`, `permission_mode`, `model_change`,
        // `session_command`, `stop_task`, `request_replay` — fall through
        // unchanged. See [DM08] / [Step 5.3](#step-5-3) in the
        // mid-turn-replay plan.
        if let Some("user_message") = inspected.as_ref().and_then(|i| i.msg_type()) {
            let inspected = inspected.as_ref().expect("checked Some above");
            let user_text = inspected.text.clone().unwrap_or_default();
            let user_attachments = inspected.attachments.clone().unwrap_or_default();
            let journal_id = uuid::Uuid::new_v4().to_string();
            let now = crate::session_ledger::now_millis();
            match self.sessions_recorder.insert_pending_turn(
                tug_session_id.as_str(),
                &journal_id,
                &user_text,
                &user_attachments,
                now,
            ) {
                Ok(()) => {
                    // A turn is opening: from here until the merger sees the
                    // closing `turn_complete` / `turn_cancelled`, the activity
                    // sampler attributes this session's OS work.
                    entry_arc.lock().await.turn_active = true;
                }
                Err(err) => {
                    warn!(
                        error = %err,
                        tug_session_id = %tug_session_id,
                        "dispatcher: insert_pending_turn failed; dropping user_message",
                    );
                    let _ = self
                        .control_tx
                        .send(build_ledger_failure_frame(&tug_session_id));
                    return;
                }
            }
        }

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

        let decision_label = match &decision {
            Decision::Drop => "drop",
            Decision::Spawn => "spawn",
            Decision::Forward(_, _) => "forward",
            Decision::Backpressure => "backpressure",
        };
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "supervisor.dispatch_decision",
            tug_session_id = %tug_session_id,
            decision = decision_label,
        );
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

    /// Apply the per-frame journal intercept the merger runs on every
    /// outbound CODE_OUTPUT frame, **after** the wire-side broadcast has
    /// fired. Narrowed in [Step 5.3](#step-5-3) to a session-scoped FIFO
    /// mark-seen: every `turn_complete` / `turn_cancelled` frame deletes
    /// the oldest pending row in the session's journal. The frame is
    /// forwarded unchanged — this intercept does not read or write any
    /// payload field except the top-level `type` discriminator.
    ///
    /// Branches on the payload's top-level `type`:
    ///
    /// - `turn_complete` or `turn_cancelled` — call
    ///   [`SessionsRecorder::delete_oldest_pending_for_session`]. On
    ///   `Ok(Some)`, an info trace; on `Ok(None)` a warn
    ///   (`turn_complete_no_pending_journal_row` — claude responded for
    ///   a turn the journal didn't see, e.g. resume-of-an-existing-
    ///   conversation where the new tugcode picks up mid-stream); on
    ///   `Err`, a `warn!` (the frame has already been forwarded; the
    ///   wire is the source of truth, the journal lagging by one update
    ///   is telemetry).
    /// - any other type — no-op.
    ///
    /// `record_turn` (the existing trait method that bumps
    /// `sessions.turn_count`) continues to fire from `agent_bridge.rs`
    /// on the same `turn_complete` event — this intercept is additive
    /// and the two writes hit different tables.
    fn apply_outbound_turn_intercept(&self, session_id: &TugSessionId, frame: &Frame) {
        let Some(inspected) =
            super::payload_inspector::InspectedPayload::from_slice(&frame.payload)
        else {
            return;
        };
        match inspected.msg_type() {
            Some("turn_complete") | Some("turn_cancelled") => {
                let kind = inspected.msg_type().unwrap_or("");
                match self
                    .sessions_recorder
                    .delete_oldest_pending_for_session(session_id.as_str())
                {
                    Ok(Some(row)) => {
                        tracing::debug!(
                            target: "dev::ledger",
                            event = "merger.journal_row_deleted",
                            session_id = %session_id,
                            kind,
                            journal_id = %row.journal_id,
                        );
                    }
                    Ok(None) => {
                        warn!(
                            target: "dev::ledger",
                            event = "turn_complete_no_pending_journal_row",
                            session_id = %session_id,
                            kind,
                            "merger: {kind} for a session whose journal has no pending rows; \
                             frame forwarded unchanged",
                        );
                    }
                    Err(err) => {
                        warn!(
                            error = %err,
                            session_id = %session_id,
                            kind,
                            "merger: delete_oldest_pending_for_session failed (frame already forwarded)",
                        );
                    }
                }
            }
            _ => {}
        }
    }

    /// Per-bridge merger task. Consumes registrations from
    /// `merger_register_rx` and fans in each per-session output mpsc into
    /// the shared CODE_OUTPUT broadcast, the SESSION_SIDEBAND broadcast
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
                    // Divert `activity_delta` frames off CODE_OUTPUT onto the
                    // ACTIVITY feed ([P13], [P15]). The payload already carries
                    // its `tug_session_id` (spliced in `relay_session_io`), so
                    // we only re-tag `FeedId::ACTIVITY` — mirroring the
                    // SESSION_SIDEBAND rewrap below, but a DIVERT not a copy:
                    // the sample must never ride the CODE_OUTPUT transcript
                    // stream or its shared ReplayBuffer (a replayed activity
                    // sample would strobe the deck's live meter). Skipping the
                    // journal gate is correct too — activity frames are not
                    // turn-completion markers.
                    if is_activity_delta(&frame.payload) {
                        self.activity
                            .publish_tagged(Frame::new(FeedId::ACTIVITY, frame.payload));
                        continue;
                    }
                    // Forward to shared CODE_OUTPUT broadcast (feeds the
                    // shared router-level replay ring per [D06], unchanged).
                    // The inbound frame is already tagged `CODE_OUTPUT` by
                    // `relay_session_io` so this send passes through
                    // unchanged.
                    self.code_output.publish_tagged(frame.clone());
                    // Turn-boundary tracking for the activity sampler: the
                    // closing `turn_complete` / `turn_cancelled` ends OS-work
                    // attribution; `wake_started` opens a wake turn (which has
                    // no inbound `user_message` to open it). Clearing is gated
                    // on no replay bracket being open — a `replay_batch`'s
                    // embedded historical `turn_complete` text matches the
                    // needle but must not end a live turn (`replay_started`
                    // has already incremented the bracket counter by the time
                    // the batch flows through here).
                    if is_turn_end(&frame.payload) || is_wake_started(&frame.payload) {
                        let entry_arc = {
                            let ledger = self.ledger.lock().await;
                            ledger.get(&id).cloned()
                        };
                        if let Some(entry_arc) = entry_arc {
                            let mut entry = entry_arc.lock().await;
                            if is_wake_started(&frame.payload) {
                                entry.turn_active = true;
                            } else if entry.replay_brackets_open == 0 {
                                entry.turn_active = false;
                            }
                        }
                    }
                    // Per-session system_metadata capture + broadcast per
                    // [D14]. CRITICAL: rewrap as `FeedId::SESSION_SIDEBAND`
                    // before publishing / storing. `Frame::encode()`
                    // serializes `Frame.feed_id` as the first wire byte, so
                    // a subscriber registered via
                    // `register_stream(FeedId::SESSION_SIDEBAND, ...)`
                    // would otherwise receive a frame tagged CODE_OUTPUT and
                    // route it to the wrong client-side store. Both the
                    // live publish AND the `latest_metadata` slot used by
                    // event-driven replay in `do_spawn_session` must hold
                    // the SESSION_SIDEBAND-tagged Frame.
                    if is_system_metadata(&frame.payload) {
                        let meta_frame =
                            Frame::new(FeedId::SESSION_SIDEBAND, frame.payload.clone());
                        let entry_arc = {
                            let ledger = self.ledger.lock().await;
                            ledger.get(&id).cloned()
                        };
                        if let Some(entry_arc) = entry_arc {
                            let mut entry = entry_arc.lock().await;
                            entry.latest_metadata = Some(meta_frame.clone());
                        }
                        self.session_sideband.publish_tagged(meta_frame);
                    } else if is_session_capabilities(&frame.payload) {
                        // Turn-free `initialize` capabilities ([#step-2a]).
                        // Rewrap onto SESSION_SIDEBAND (same rationale as
                        // `system_metadata`: the FeedStore keeps only the
                        // latest payload per feed, and the client routes by
                        // wire feed-id) so the session card's metadata store
                        // receives it. Retained in its own per-session slot
                        // (`latest_capabilities`, distinct from the
                        // `latest_metadata` system_metadata slot) so a card
                        // that binds after the one-shot broadcast — reconnect,
                        // HMR remount — gets the model list replayed on bind.
                        let cap_frame =
                            Frame::new(FeedId::SESSION_SIDEBAND, frame.payload.clone());
                        let entry_arc = {
                            let ledger = self.ledger.lock().await;
                            ledger.get(&id).cloned()
                        };
                        if let Some(entry_arc) = entry_arc {
                            let mut entry = entry_arc.lock().await;
                            entry.latest_capabilities = Some(cap_frame.clone());
                        }
                        // Persist alongside the in-memory slot so the
                        // catalog survives a tugcast restart: the slot dies
                        // with the process, and a resumed session's next
                        // handshake is health-gated (~2s after spawn at
                        // best) — the sqlite row bridges that window at
                        // bind time (`persisted_capabilities_replay_frame`).
                        // Best-effort like `record_session_metadata`: a
                        // write failure degrades to the pre-persistence
                        // behavior, never blocks the live broadcast.
                        if let Some(sql) = self.session_ledger.as_ref() {
                            let captured_at = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);
                            if let Err(e) = sql.record_session_capabilities(
                                id.as_str(),
                                &cap_frame.payload,
                                captured_at,
                            ) {
                                warn!(
                                    session_id = %id,
                                    error = %e,
                                    "record_session_capabilities failed; broadcasting without persistence"
                                );
                            }
                        }
                        self.session_sideband.publish_tagged(cap_frame);
                    } else if is_rate_limit_event(&frame.payload) {
                        // Per-turn subscription-quota broadcast ([#step-3]).
                        // Rewrap onto SESSION_SIDEBAND (same rationale as
                        // `system_metadata` / `session_capabilities`: the
                        // FeedStore keeps only the latest payload per feed and
                        // the client routes by wire feed-id) so the session card's
                        // metadata store — not the high-churn CODE_OUTPUT
                        // transcript store — receives it. Retained in its own
                        // per-session slot (`latest_rate_limit`) so a card that
                        // binds after the last broadcast (reconnect, HMR
                        // remount) replays the quota state on bind, which
                        // matters most when the session is hard rate-limited
                        // and cannot start a turn to refresh it.
                        let rl_frame =
                            Frame::new(FeedId::SESSION_SIDEBAND, frame.payload.clone());
                        let entry_arc = {
                            let ledger = self.ledger.lock().await;
                            ledger.get(&id).cloned()
                        };
                        if let Some(entry_arc) = entry_arc {
                            let mut entry = entry_arc.lock().await;
                            entry.latest_rate_limit = Some(rl_frame.clone());
                        }
                        self.session_sideband.publish_tagged(rl_frame);
                    }
                    // Forward-before-mutate: the wire-side broadcast above
                    // is the user-visible signal and must not be delayed
                    // by a database write. The journal mark-seen here is
                    // best-effort telemetry from the user's perspective;
                    // it becomes load-bearing only on the next runReplay,
                    // by which time the write has long since committed.
                    //
                    // Step 5.10: process_outbound_frame_journal_gate first
                    // updates the per-session replay-bracket counter from
                    // replay_started / replay_complete markers, then gates
                    // apply_outbound_turn_intercept on `replay_brackets_open == 0`
                    // so replay-emitted committed-turn frames don't pop
                    // the user's pending journal row.
                    self.process_outbound_frame_journal_gate(&id, &frame).await;
                }
            }
        }
    }

    /// Bracket-aware wrapper around [`Self::apply_outbound_turn_intercept`].
    /// Tracks per-session `LedgerEntry::replay_brackets_open` based on the
    /// `replay_started` / `replay_complete` frames the merger forwards,
    /// and gates the FIFO journal-pop intercept on the counter being zero.
    ///
    /// Why this gate exists (mid-turn-replay
    /// [Step 5.10](roadmap/tugplan-dev-mid-turn-replay.md#step-5)):
    /// `runReplay`'s `translateJsonlSession` emits `turn_complete` frames
    /// for every committed turn in the JSONL. Those frames flow through
    /// the merger task on the same path live `turn_complete`s do.
    /// Step 5.3's pure-FIFO intercept (`delete_oldest_pending_for_session`)
    /// can't tell replay-emitted from live, and the FIRST replay
    /// `turn_complete` to arrive on a session with a still-pending journal
    /// row pops that row — destroying the never-drop guarantee for any
    /// inflight submission whose runReplay fires while it's still pending.
    /// The HMR-mid-stream regression in the plan's close-out manual
    /// smoke surfaced this. The gate suppresses the intercept while the
    /// counter is non-zero.
    ///
    /// Counter (not bool) for defense-in-depth against bridge-crash-mid-
    /// replay: a bridge that emits `replay_started` and dies (kill -9,
    /// panic, OOM before `runReplay`'s `finally` runs) would, with a
    /// bool, leave the gate stuck-open forever and silently drop every
    /// future live journal-pop. The counter shape doesn't fix that
    /// directly — a stuck-non-zero counter has the same effect — but it
    /// makes a stray `replay_complete` on a closed bracket a no-op
    /// (saturating-decrement at 0) instead of underflowing a bool into
    /// "open" state. tugcode's `runReplay` re-entrancy guard prevents
    /// legitimate overlapping brackets, so in healthy operation the
    /// counter is 0 between brackets and 1 during a bracket.
    async fn process_outbound_frame_journal_gate(&self, session_id: &TugSessionId, frame: &Frame) {
        let Some(inspected) =
            super::payload_inspector::InspectedPayload::from_slice(&frame.payload)
        else {
            return;
        };
        let msg_type = inspected.msg_type();
        // Match before grabbing the entry — `_` covers most frames and
        // we don't need to touch the ledger map for them.
        match msg_type {
            Some("replay_started")
            | Some("replay_complete")
            | Some("turn_complete")
            | Some("turn_cancelled") => {}
            _ => return,
        }

        let entry_arc = {
            let ledger = self.ledger.lock().await;
            ledger.get(session_id).cloned()
        };
        let Some(entry_arc) = entry_arc else { return };

        match msg_type {
            Some("replay_started") => {
                let mut entry = entry_arc.lock().await;
                entry.replay_brackets_open = entry.replay_brackets_open.saturating_add(1);
                tracing::debug!(
                    target: "dev::ledger",
                    event = "merger.replay_bracket_open",
                    session_id = %session_id,
                    depth = entry.replay_brackets_open,
                );
            }
            Some("replay_complete") => {
                let mut entry = entry_arc.lock().await;
                entry.replay_brackets_open = entry.replay_brackets_open.saturating_sub(1);
                tracing::debug!(
                    target: "dev::ledger",
                    event = "merger.replay_bracket_close",
                    session_id = %session_id,
                    depth = entry.replay_brackets_open,
                );
            }
            Some("turn_complete") | Some("turn_cancelled") => {
                let in_replay = {
                    let entry = entry_arc.lock().await;
                    entry.replay_brackets_open > 0
                };
                if in_replay {
                    tracing::debug!(
                        target: "dev::ledger",
                        event = "merger.intercept_skipped_in_replay_bracket",
                        session_id = %session_id,
                        kind = msg_type.unwrap_or(""),
                    );
                } else {
                    self.apply_outbound_turn_intercept(session_id, frame);
                }
            }
            _ => unreachable!("filtered above"),
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
    /// Install `input_tx` only after merger registration: if the merger has died and the
    /// register send fails after `input_tx` is installed, the dispatcher
    /// would happily forward frames into a Sender whose Receiver is owned
    /// by nothing. Registering first means a dead merger is detected
    /// before any visible ledger state is mutated.
    pub async fn spawn_session_worker(&self, tug_session_id: &TugSessionId) {
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "supervisor.spawn_worker_start",
            tug_session_id = %tug_session_id,
        );
        let entry_arc = {
            let map = self.ledger.lock().await;
            match map.get(tug_session_id) {
                Some(e) => e.clone(),
                None => return,
            }
        };

        let (input_tx, input_rx) = mpsc::channel::<Frame>(256);
        let (merger_per_session_tx, merger_per_session_rx) = mpsc::channel::<Frame>(256);

        // Register the per-session output receiver with the merger
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
                self.session_state.publish_tagged(build_session_state_frame(
                    tug_session_id,
                    "errored",
                    Some("merger_unavailable"),
                ));
            }
            return;
        }

        // Install the dispatcher-side sender and clone the
        // cancellation token. Do **not** drain the queue or transition to
        // Live — that's the bridge's job on `session_init` (see above).
        //
        // Reset `replay_brackets_open` to zero on every bridge respawn.
        // The counter tracks `replay_started` / `replay_complete` markers
        // emitted by the bridge's `runReplay`. A bridge that died between
        // emitting `replay_started` and `replay_complete` would leave
        // the counter stuck non-zero — the new bridge's brackets would
        // then nest into the stale outer bracket and the gate would
        // skip live `turn_complete`s indefinitely. Reset here closes
        // the stuck-state risk: each fresh bridge starts with a clean
        // gate, regardless of whether the previous bridge crashed
        // mid-replay.
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
            entry.replay_brackets_open = 0;
            entry.cancel.clone()
        };
        // `input_tx` is stashed in the ledger entry; the bridge drains it
        // via the per-session queue on session_init. Drop our local clone
        // so only the dispatcher owns the send side after this point.
        drop(input_tx);

        self.session_state.publish_tagged(build_session_state_frame(
            tug_session_id,
            "spawning",
            None,
        ));

        // Launch the real bridge in a detached task.
        let spawner = (self.spawner_factory)();
        let state_tx = self.session_state.sender();
        let tug_session_id_owned = tug_session_id.clone();
        let entry_arc_bridge = entry_arc.clone();
        // Per-session workspace path. Read from the ledger entry so
        // each session's tugcode subprocess gets its own cwd. Also
        // thread `session_mode` so the tugcode subprocess receives
        // `--session-mode new|resume`. The sessions recorder lets the
        // bridge transition the ledger row when it sees `session_init`,
        // `result`, `resume_failed`, or terminal teardown on the IPC stream.
        let (project_dir, session_mode, permission_mode) = {
            let entry = entry_arc.lock().await;
            (
                entry.project_dir.clone(),
                entry.session_mode,
                entry.permission_mode.clone(),
            )
        };
        let sessions_recorder = self.sessions_recorder.clone();
        let session_ledger_for_bridge = self.session_ledger.clone();
        let changeset_bumper_for_bridge =
            crate::feeds::changeset::ChangesetBumper::new(Arc::clone(&self.registry));
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
                permission_mode,
                sessions_recorder,
                session_ledger_for_bridge,
                changeset_bumper_for_bridge,
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

    /// Re-materialize ledger entries from the sqlite-backed
    /// [`SessionLedger`].
    ///
    /// Called once at startup from `main.rs`. Walks every resumable row
    /// (see [`SessionLedger::list_with_card_id`] for the filter) and
    /// inserts a fresh `Idle` [`LedgerEntry`] for each `session_id`
    /// that is not already present in the in-memory ledger map.
    /// Returns the number of entries that were newly inserted.
    ///
    /// Per [F15] this path does **not**:
    ///
    /// - touch `client_sessions` — the rebind has no WebSocket client, so
    ///   any sentinel `ClientId` inserted here would be a permanent ghost
    ///   with no cleanup trigger. Real clients connecting after startup
    ///   send their own `spawn_session` CONTROL frames via [D14]'s normal
    ///   flow, which populate `client_sessions` for the real client_id.
    /// - mutate the sqlite ledger — the helper is strictly read-only.
    /// - publish any `SESSION_STATE` frames — the rebound entries are
    ///   unobservable until a real client subsequently calls `spawn_session`
    ///   for one of them, at which point the existing entry is reused and
    ///   the normal `pending` publish fires.
    pub async fn rebind_from_ledger(&self) -> Result<usize, crate::session_ledger::LedgerError> {
        let Some(ledger_db) = self.session_ledger.as_ref() else {
            return Ok(0);
        };
        let rows = ledger_db.list_with_card_id()?;
        let mut inserted = 0usize;
        // We acquire workspaces via `registry.get_or_create` outside the
        // ledger mutex (it takes its own std::sync::Mutex internally), so
        // we can't hold the ledger across the loop. Iterate per-record:
        // validate → get_or_create → lock ledger briefly → insert.
        for row in rows {
            let Some(card_id) = row.card_id.clone() else {
                continue;
            };
            let project_dir = PathBuf::from(&row.project_dir);

            // Adopt the canonical workspace key persisted on the ledger row
            // rather than recomputing it from `project_dir`. Recomputing via
            // `registry.canonical_key` runs `std::fs::metadata` + `canonicalize`
            // on the project directory, touching the filesystem for every
            // historical project on boot — enough to trip a macOS TCC consent
            // prompt for any dir under Desktop / Documents / Downloads or
            // reached through a firmlink. The stored key was canonicalized by
            // `get_or_create` when the session first bound and written by
            // `record_spawn`; it is exactly what a recompute would yield, minus
            // the fs touch. The workspace itself is still registered lazily —
            // only when a client actually re-spawns the session
            // (`do_spawn_session` → `get_or_create`), which also re-validates
            // the directory and rejects a since-removed path, so deferring
            // validation here costs nothing beyond a harmless stale in-memory
            // entry until the next spawn.
            if row.workspace_key.is_empty() {
                warn!(
                    card_id,
                    session_id = row.session_id.as_str(),
                    path = ?project_dir,
                    "rebind: dropping ledger row with empty workspace_key"
                );
                continue;
            }
            let workspace_key = WorkspaceKey::from_canonical(&row.workspace_key);

            // The ledger row's `session_id` is claude's id (post
            // session_init). Use it as the tug_session_id for the
            // rebound entry — for un-forked sessions the two ids are
            // identical, and for forked sessions claude's id is what
            // `--resume <id>` accepts so the next spawn will work
            // against the JSONL on disk regardless.
            let tug_session_id = TugSessionId::new(row.session_id.clone());

            // Resume mode is the always-correct restore intent: we have
            // a recorded session, the client wants its history. The
            // defense-in-depth path in `do_spawn_session` upgrades
            // legacy entries to the client's requested mode when
            // `spawn_state == Idle`, so a fresh-mode spawn from the
            // picker against the same id still works.
            let rebound_mode = SessionMode::Resume;

            // Insert the ledger entry — or skip if one already exists (this
            // function is idempotent per [F15]). No workspace to release:
            // `canonical_key` registered nothing.
            let mut ledger = self.ledger.lock().await;
            if ledger.contains_key(&tug_session_id) {
                continue;
            }
            let mut entry = LedgerEntry::new(
                tug_session_id.clone(),
                workspace_key,
                project_dir,
                rebound_mode,
                CrashBudget::new(3, Duration::from_secs(60)),
            );
            // Carry the persisted `claude_session_id` so the first
            // spawn after rebind threads `--resume-session <id>` through
            // the spawner. The ledger's session_id IS claude's id post
            // session_init.
            entry.claude_session_id = Some(row.session_id.clone());
            // Carry the card binding so the live-elsewhere check fires
            // correctly on a cross-card resume request after rebind.
            entry.card_id = Some(card_id.clone());
            tracing::info!(
                target: "dev::session-lifecycle",
                event = "rebind.entry",
                card_id = card_id.as_str(),
                tug_session_id = %tug_session_id,
                rebound_mode = rebound_mode.as_wire_str(),
                mode_source = "ledger",
                claude_session_id = row.session_id.as_str(),
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
/// per-session record. Production uses [`LedgerSessionsRecorder`].
#[cfg(test)]
pub(crate) struct NoopSessionsRecorder;

#[cfg(test)]
impl SessionsRecorder for NoopSessionsRecorder {
    fn record(&self, _record: SessionRecord<'_>) {}
    fn record_turn(&self, _session_id: &str) {}
    fn set_turn_count(&self, _session_id: &str, _count: i64) {}
    fn engine_turn_count(&self, _session_id: &str, _project_dir: &str) -> Option<i64> {
        None
    }
    fn record_user_prompt(&self, _session_id: &str, _prompt: &str) {}
    fn mark_closed(&self, _session_id: &str) {}
    fn mark_failed(&self, _session_id: &str) {}
    fn remove(&self, _session_id: &str) {}
    fn evict_for_workspace(&self, _workspace_key: &str, _cap: usize) {}
    fn insert_pending_turn(
        &self,
        _session_id: &str,
        _journal_id: &str,
        _user_text: &str,
        _user_attachments: &[serde_json::Value],
        _now: i64,
    ) -> Result<(), crate::session_ledger::LedgerError> {
        Ok(())
    }
    fn delete_oldest_pending_for_session(
        &self,
        _session_id: &str,
    ) -> Result<Option<crate::session_ledger::JournalRow>, crate::session_ledger::LedgerError> {
        Ok(None)
    }
}

/// Construct an [`AgentSupervisor`] with stub channels and a stalled
/// spawner factory. Returns the supervisor wrapped in `Arc` plus its
/// merger register receiver (which the caller should either spawn
/// `merger_task` against or drain to keep the register channel alive).
/// Used by router tests that need to exercise CONTROL interception or
/// client-disconnect hooks without constructing a full subprocess
/// pipeline.
#[cfg(test)]
pub(crate) fn test_minimal_supervisor() -> (Arc<AgentSupervisor>, mpsc::Receiver<MergerRegistration>)
{
    let (state_tx, _) = broadcast::channel(16);
    let (meta_tx, _) = broadcast::channel(16);
    let (code_tx, _) = broadcast::channel(16);
    let (control_tx, _) = broadcast::channel(16);
    // Eager spawn (do_spawn_session) calls the factory whenever a fresh
    // entry is inserted. Hand back a never-resolving stall spawner so
    // `spawn_session_worker` installs the per-session plumbing without
    // the bridge ever emitting a real frame — matches the StallSpawner
    // used by tests in this file.
    struct MinimalStallSpawner;
    impl ChildSpawner for MinimalStallSpawner {
        fn spawn_child(
            &self,
            _project_dir: &std::path::Path,
            _session_id: &str,
            _session_mode: SessionMode,
            _resume_claude_session_id: Option<&str>,
            _permission_mode: Option<&str>,
        ) -> super::agent_bridge::SpawnFuture {
            Box::pin(async {
                std::future::pending::<std::io::Result<super::agent_bridge::SessionChild>>().await
            })
        }
    }
    let factory: SpawnerFactory =
        Arc::new(|| Arc::new(MinimalStallSpawner) as Arc<dyn ChildSpawner>);
    let recorder: Arc<dyn SessionsRecorder> = Arc::new(NoopSessionsRecorder);
    let registry = Arc::new(WorkspaceRegistry::new_for_test());
    let cancel = CancellationToken::new();
    let (sup, register_rx) = AgentSupervisor::new(
        SessionScopedFeed::from_sender(FeedId::SESSION_STATE, state_tx, LagPolicy::Warn),
        SessionScopedFeed::from_sender(FeedId::SESSION_SIDEBAND, meta_tx, LagPolicy::Warn),
        SessionScopedFeed::from_sender(FeedId::CODE_OUTPUT, code_tx, LagPolicy::Warn),
        SessionScopedFeed::new(FeedId::ACTIVITY, 64, LagPolicy::Warn),
        control_tx,
        recorder,
        factory,
        AgentSupervisorConfig::default(),
        registry,
        cancel,
    );
    (Arc::new(sup), register_rx)
}

/// Test helper: install a Live ledger entry for `tug_session_id` with a
/// freshly-allocated `input_tx`, and return the matching `input_rx` so
/// the test can observe any frames the supervisor's CONTROL handlers
/// forward to that session. Mirrors the Spawning→Live promote path the
/// production bridge runs on `session_init`, minus the actual subprocess.
///
/// Used by router tests that need to exercise the full
/// `intercept_session_control` → `handle_control` path against a live
/// session — i.e., the ingress shape that production code actually rides.
#[cfg(test)]
pub(crate) async fn install_live_session_for_tests(
    sup: &AgentSupervisor,
    tug_session_id: &TugSessionId,
    workspace_key: WorkspaceKey,
    project_dir: std::path::PathBuf,
) -> tokio::sync::mpsc::Receiver<Frame> {
    let entry = Arc::new(Mutex::new(LedgerEntry::new(
        tug_session_id.clone(),
        workspace_key,
        project_dir,
        super::agent_bridge::SessionMode::New,
        CrashBudget::new(3, Duration::from_secs(60)),
    )));
    let (input_tx, input_rx) = mpsc::channel::<Frame>(4);
    {
        let mut e = entry.lock().await;
        e.spawn_state = SpawnState::Live;
        e.input_tx = Some(input_tx.clone());
    }
    // Drop the test-side sender clone so the receiver only sees frames
    // forwarded through the ledger's stored copy.
    drop(input_tx);
    sup.ledger
        .lock()
        .await
        .insert(tug_session_id.clone(), entry);
    input_rx
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::pending;
    use tokio::sync::Notify;

    use super::super::agent_bridge::{RelayOutcome, SessionChild, SpawnFuture, relay_session_io};

    // ── session tag on the wire: inbound parse + outbound frame ───────────────

    #[test]
    fn changeset_commit_message_appends_session_trailer_when_present() {
        let request = ChangesetCommitPayload {
            project_dir: "/p".to_string(),
            files: vec!["a.txt".to_string()],
            message: "commit a".to_string(),
            session_name: Some("web".to_string()),
            session_id: Some("sess-1".to_string()),
        };
        assert_eq!(
            changeset_commit_message(&request),
            "commit a\n\nTug-Session: web (sess-1)"
        );
    }

    #[test]
    fn changeset_commit_message_is_byte_for_byte_without_session_fields() {
        let request = ChangesetCommitPayload {
            project_dir: "/p".to_string(),
            files: vec!["a.txt".to_string()],
            message: "commit a".to_string(),
            session_name: None,
            session_id: None,
        };
        assert_eq!(changeset_commit_message(&request), "commit a");
    }

    #[test]
    fn parse_changeset_commit_payload_reads_optional_session_fields() {
        let payload = br#"{"project_dir":"/p","files":["a.txt"],"message":"m","session_name":"web","session_id":"sess-1"}"#;
        let parsed = parse_changeset_commit_payload(payload).expect("parse");
        assert_eq!(parsed.session_name.as_deref(), Some("web"));
        assert_eq!(parsed.session_id.as_deref(), Some("sess-1"));
        // Absent fields parse to None (back-compat with today's callers).
        let bare = br#"{"project_dir":"/p","files":["a.txt"],"message":"m"}"#;
        let parsed_bare = parse_changeset_commit_payload(bare).expect("parse");
        assert_eq!(parsed_bare.session_name, None);
        assert_eq!(parsed_bare.session_id, None);
    }

    #[test]
    fn parse_spawn_payload_extracts_tag() {
        let payload = br#"{"card_id":"c1","tug_session_id":"s1","project_dir":"/p","session_mode":"new","tag":"azure-heron"}"#;
        let parsed = parse_control_payload_owned(payload).expect("parse");
        assert_eq!(parsed.tag.as_deref(), Some("azure-heron"));
    }

    #[test]
    fn parse_spawn_payload_tag_absent_is_none() {
        let payload =
            br#"{"card_id":"c1","tug_session_id":"s1","project_dir":"/p","session_mode":"new"}"#;
        let parsed = parse_control_payload_owned(payload).expect("parse");
        assert_eq!(parsed.tag, None);
    }

    #[test]
    fn session_updated_frame_carries_tag() {
        let row = crate::session_ledger::SessionRow {
            session_id: "s1".to_owned(),
            workspace_key: "ws".to_owned(),
            project_dir: "/p".to_owned(),
            created_at: 0,
            last_used_at: 0,
            turn_count: 0,
            last_user_prompt: None,
            state: crate::session_ledger::SessionState::Live,
            card_id: Some("c1".to_owned()),
            name: None,
            name_user_set: false,
            tag: Some("azure-heron".to_owned()),
        };
        let frame = build_session_updated_frame(&row);
        let body: serde_json::Value = serde_json::from_slice(&frame.payload).expect("json");
        assert_eq!(body["fields"]["tag"], "azure-heron");
    }

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
            _resume_claude_session_id: Option<&str>,
            _permission_mode: Option<&str>,
        ) -> SpawnFuture {
            Box::pin(async { pending::<std::io::Result<SessionChild>>().await })
        }
    }

    fn stall_spawner_factory() -> SpawnerFactory {
        Arc::new(|| Arc::new(StallSpawner) as Arc<dyn ChildSpawner>)
    }

    // ---- Test helpers ----

    /// Shared valid directory for tests that need *some* `project_dir`
    /// but don't care which. `env!("CARGO_MANIFEST_DIR")` resolves at
    /// compile time to the crate root (`tugrust/crates/tugcast`), which
    /// always exists on every dev machine and in CI.
    fn test_project_dir() -> &'static str {
        env!("CARGO_MANIFEST_DIR")
    }

    fn make_supervisor_with_store() -> (
        AgentSupervisor,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
    ) {
        make_supervisor_with_store_config(AgentSupervisorConfig::default())
    }

    /// Variant that accepts a custom [`AgentSupervisorConfig`] — P13 tests
    /// use this to set tight `max_concurrent_sessions` /
    /// `max_spawns_per_minute` so the cap can be tripped with only a
    /// handful of spawn calls.
    fn make_supervisor_with_store_config(
        config: AgentSupervisorConfig,
    ) -> (
        AgentSupervisor,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
    ) {
        let ((sup, state_rx, meta_rx, control_rx), mut register_rx) =
            make_supervisor_with_spawner_config(stall_spawner_factory(), config);
        // Drain the merger register channel so `spawn_session_worker`'s
        // `merger_register_tx.send(...).await` succeeds without an actual
        // merger task attached. Dropping the receiver would short-circuit
        // the bridge wiring and suppress the `SESSION_STATE = spawning`
        // publish that existing tests rely on.
        tokio::spawn(async move { while register_rx.recv().await.is_some() {} });
        (sup, state_rx, meta_rx, control_rx)
    }

    /// Variant that also returns the merger register receiver so tests can
    /// spawn `merger_task` against it.
    #[allow(clippy::type_complexity)]
    fn make_supervisor_with_spawner(
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
        make_supervisor_with_spawner_config(spawner_factory, AgentSupervisorConfig::default())
    }

    #[allow(clippy::type_complexity)]
    fn make_supervisor_with_spawner_config(
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
        let registry = Arc::new(WorkspaceRegistry::new_for_test());
        let cancel = CancellationToken::new();
        let recorder: Arc<dyn SessionsRecorder> = Arc::new(NoopSessionsRecorder);
        // Hermetic terminal-registry default: tests must never read the
        // developer's real ~/.claude/sessions. Tests that exercise the
        // liveness gate inject their own tempdir root.
        let config = AgentSupervisorConfig {
            terminal_registry_root: Some(config.terminal_registry_root.unwrap_or_else(|| {
                std::path::PathBuf::from("/nonexistent/tugcast-test-terminal-registry")
            })),
            ..config
        };
        let (sup, register_rx) = AgentSupervisor::new(
            SessionScopedFeed::from_sender(FeedId::SESSION_STATE, state_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::SESSION_SIDEBAND, meta_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::CODE_OUTPUT, code_tx, LagPolicy::Warn),
            SessionScopedFeed::new(FeedId::ACTIVITY, 64, LagPolicy::Warn),
            control_tx,
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

    fn resume_payload(card_id: &str, tug_session_id: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "spawn_session",
            "card_id": card_id,
            "tug_session_id": tug_session_id,
            "project_dir": test_project_dir(),
            "session_mode": "resume",
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

    fn request_replay_payload(tug_session_id: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "request_replay",
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
        // LedgerEntry gained workspace_key + project_dir.
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
        Frame::new(FeedId::SESSION_SIDEBAND, serde_json::to_vec(&body).unwrap())
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
    async fn changeset_git_init_inits_non_repo_and_guards() {
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        async fn next_control(rx: &mut broadcast::Receiver<Frame>) -> serde_json::Value {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
                .await
                .expect("control response within timeout")
                .expect("sender alive");
            serde_json::from_slice(&frame.payload).expect("control body is JSON")
        }

        fn init_payload(project_dir: &str) -> Vec<u8> {
            serde_json::to_vec(&serde_json::json!({
                "action": "changeset_git_init",
                "project_dir": project_dir,
            }))
            .unwrap()
        }

        // Register a temp non-repo dir as an open workspace.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let cancel = CancellationToken::new();
        let _entry = sup.registry.get_or_create(&root, cancel.clone()).unwrap();
        let root_str = root.to_string_lossy().to_string();

        // Init it → ok, and the dir is now a git repo.
        sup.handle_control("changeset_git_init", &init_payload(&root_str), 1)
            .await;
        let ok = next_control(&mut control_rx).await;
        assert_eq!(ok["action"], "changeset_git_init_ok");
        assert_eq!(ok["project_dir"], root_str);
        assert!(root.join(".git").exists(), "git init created a repo");

        // Re-init the now-repo dir → err "already a git repository".
        sup.handle_control("changeset_git_init", &init_payload(&root_str), 1)
            .await;
        let already = next_control(&mut control_rx).await;
        assert_eq!(already["action"], "changeset_git_init_err");
        assert_eq!(already["detail"], "already a git repository");

        // A dir that is not a registered workspace → err "not an open project".
        let other = tempfile::tempdir().unwrap();
        let other_str = other
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        sup.handle_control("changeset_git_init", &init_payload(&other_str), 1)
            .await;
        let unknown = next_control(&mut control_rx).await;
        assert_eq!(unknown["action"], "changeset_git_init_err");
        assert_eq!(unknown["detail"], "not an open project");

        cancel.cancel();
    }

    #[tokio::test]
    async fn changeset_join_previews_and_executes() {
        use std::process::Command;

        fn git(dir: &std::path::Path, args: &[&str]) {
            let status = Command::new("git")
                .current_dir(dir)
                .args(args)
                .status()
                .unwrap();
            assert!(status.success(), "git {args:?} failed");
        }

        async fn next_control(rx: &mut broadcast::Receiver<Frame>) -> serde_json::Value {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
                .await
                .expect("control response within timeout")
                .expect("sender alive");
            serde_json::from_slice(&frame.payload).expect("control body is JSON")
        }

        fn join_payload(project_dir: &str, dash: &str, preview: bool) -> Vec<u8> {
            serde_json::to_vec(&serde_json::json!({
                "action": "changeset_join",
                "project_dir": project_dir,
                "dash": dash,
                "preview": preview,
            }))
            .unwrap()
        }

        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        // Scratch repo on main with a base commit and a `tugdash/demo` dash one
        // commit ahead, checked out in a `.tug/worktrees/demo` worktree.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.name", "t"]);
        git(&root, &["config", "user.email", "t@t"]);
        std::fs::write(root.join("keep.txt"), "base\n").unwrap();
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "-m", "base"]);
        git(&root, &["branch", "tugdash/demo"]);
        git(&root, &["config", "branch.tugdash/demo.tugbase", "main"]);
        let wt = root.join(".tug/worktrees/demo");
        git(
            &root,
            &["worktree", "add", wt.to_str().unwrap(), "tugdash/demo"],
        );
        std::fs::write(wt.join("round.txt"), "round\n").unwrap();
        git(&wt, &["add", "-A"]);
        git(&wt, &["commit", "-m", "round 1"]);

        let cancel = CancellationToken::new();
        let _entry = sup.registry.get_or_create(&root, cancel.clone()).unwrap();
        let root_str = root.to_string_lossy().to_string();

        // Preview: clean, nothing mutated.
        sup.handle_control("changeset_join", &join_payload(&root_str, "demo", true), 1)
            .await;
        let preview = next_control(&mut control_rx).await;
        assert_eq!(preview["action"], "changeset_join_ok");
        assert_eq!(preview["previewed"], true);
        assert_eq!(
            preview["conflicts"].as_array().unwrap().len(),
            0,
            "clean preview reports no conflicts"
        );
        assert!(preview["commit_hash"].is_null(), "preview lands no commit");
        assert!(wt.exists(), "preview left the dash worktree in place");

        // Execute: squash-lands the dash on main and tears the dash down.
        sup.handle_control("changeset_join", &join_payload(&root_str, "demo", false), 1)
            .await;
        let done = next_control(&mut control_rx).await;
        assert_eq!(done["action"], "changeset_join_ok");
        assert_eq!(done["previewed"], false);
        assert!(done["commit_hash"].is_string(), "real join lands a commit");
        let tree = Command::new("git")
            .current_dir(&root)
            .args(["ls-tree", "--name-only", "HEAD"])
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&tree.stdout).contains("round.txt"),
            "squash landed the dash file on main"
        );
        let branches = Command::new("git")
            .current_dir(&root)
            .args(["branch", "--list", "tugdash/demo"])
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&branches.stdout).trim().is_empty(),
            "dash branch removed after join"
        );

        // Guard: a dir that is not a registered workspace is refused.
        let other = tempfile::tempdir().unwrap();
        let other_str = other
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        sup.handle_control("changeset_join", &join_payload(&other_str, "demo", true), 1)
            .await;
        let unknown = next_control(&mut control_rx).await;
        assert_eq!(unknown["action"], "changeset_join_err");
        assert_eq!(unknown["detail"], "not an open project");

        cancel.cancel();
    }

    #[tokio::test]
    async fn changeset_release_discards_dash() {
        use std::process::Command;

        fn git(dir: &std::path::Path, args: &[&str]) {
            let status = Command::new("git")
                .current_dir(dir)
                .args(args)
                .status()
                .unwrap();
            assert!(status.success(), "git {args:?} failed");
        }

        async fn next_control(rx: &mut broadcast::Receiver<Frame>) -> serde_json::Value {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
                .await
                .expect("control response within timeout")
                .expect("sender alive");
            serde_json::from_slice(&frame.payload).expect("control body is JSON")
        }

        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.name", "t"]);
        git(&root, &["config", "user.email", "t@t"]);
        std::fs::write(root.join("keep.txt"), "base\n").unwrap();
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "-m", "base"]);
        git(&root, &["branch", "tugdash/demo"]);
        git(&root, &["config", "branch.tugdash/demo.tugbase", "main"]);
        let wt = root.join(".tug/worktrees/demo");
        git(
            &root,
            &["worktree", "add", wt.to_str().unwrap(), "tugdash/demo"],
        );

        let cancel = CancellationToken::new();
        let _entry = sup.registry.get_or_create(&root, cancel.clone()).unwrap();
        let root_str = root.to_string_lossy().to_string();

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "changeset_release",
            "project_dir": root_str,
            "dash": "demo",
        }))
        .unwrap();
        sup.handle_control("changeset_release", &payload, 1).await;
        let done = next_control(&mut control_rx).await;
        assert_eq!(done["action"], "changeset_release_ok");
        assert_eq!(done["name"], "demo");

        let branches = Command::new("git")
            .current_dir(&root)
            .args(["branch", "--list", "tugdash/demo"])
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&branches.stdout).trim().is_empty(),
            "dash branch discarded"
        );
        assert!(!wt.exists(), "dash worktree discarded");

        cancel.cancel();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn changeset_join_resolve_uses_scribe_and_reports_candidate() {
        use std::process::Command;

        // A fake scribe that returns a fixed clean merge and echoes it as one
        // streamed delta — no real claude call.
        struct FixedScribe(String);
        impl crate::scribe::ScribeSpawner for FixedScribe {
            fn run(
                &self,
                _model: String,
                _prompt: String,
                deltas: crate::scribe::ScribeDeltas,
            ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
            {
                let s = self.0.clone();
                Box::pin(async move {
                    if let Some(tx) = deltas {
                        let _ = tx.send(s.clone());
                    }
                    Ok(s)
                })
            }
        }

        fn git(dir: &std::path::Path, args: &[&str]) {
            let ok = Command::new("git")
                .current_dir(dir)
                .args(args)
                .status()
                .unwrap()
                .success();
            assert!(ok, "git {args:?} failed");
        }

        let (mut sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();
        sup.set_scribe(ScribeContext {
            spawner: std::sync::Arc::new(FixedScribe("MERGED\n".to_string())),
            model: std::sync::Arc::new(|| "haiku".to_string()),
        });

        // A dash whose one round overlaps the base's change → the algorithmic
        // rungs can't resolve it, so the scribe AI rung does.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.name", "t"]);
        git(&root, &["config", "user.email", "t@t"]);
        std::fs::write(root.join("f.txt"), "A\n").unwrap();
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "-m", "base"]);
        git(&root, &["branch", "tugdash/demo"]);
        git(&root, &["config", "branch.tugdash/demo.tugbase", "main"]);
        git(&root, &["switch", "-q", "tugdash/demo"]);
        std::fs::write(root.join("f.txt"), "B\n").unwrap();
        git(&root, &["commit", "-am", "r1"]);
        git(&root, &["switch", "-q", "main"]);
        std::fs::write(root.join("f.txt"), "C\n").unwrap();
        git(&root, &["commit", "-am", "main to C"]);

        let cancel = CancellationToken::new();
        let _entry = sup.registry.get_or_create(&root, cancel.clone()).unwrap();
        let root_str = root.to_string_lossy().to_string();

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "changeset_join_resolve",
            "project_dir": root_str,
            "dash": "demo",
        }))
        .unwrap();
        sup.handle_control("changeset_join_resolve", &payload, 1)
            .await;

        // Drain frames: at least one AI delta, then the terminal ok.
        let mut saw_ai_delta = false;
        let mut terminal: Option<serde_json::Value> = None;
        for _ in 0..20 {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(10), control_rx.recv())
                .await
                .expect("a control frame")
                .expect("sender alive");
            let body: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
            match body["action"].as_str() {
                Some("changeset_join_resolve_delta") => {
                    if body["rung"] == "ai" {
                        saw_ai_delta = true;
                    }
                }
                Some("changeset_join_resolve_ok") | Some("changeset_join_resolve_err") => {
                    terminal = Some(body);
                    break;
                }
                _ => {}
            }
        }

        let ok = terminal.expect("a terminal resolve frame");
        assert_eq!(ok["action"], "changeset_join_resolve_ok", "resolved: {ok}");
        assert!(saw_ai_delta, "an AI progress delta streamed");
        assert!(ok["candidate_commit"].is_string(), "candidate built: {ok}");
        assert_eq!(ok["shape"], "squash");
        assert_eq!(ok["resolved"][0]["resolved_by"], "ai");
        assert!(
            ok["unresolved"].as_array().unwrap().is_empty(),
            "nothing left unresolved"
        );

        // The candidate's f.txt carries the scribe's merged content.
        let candidate = ok["candidate_commit"].as_str().unwrap();
        let show = Command::new("git")
            .current_dir(&root)
            .args(["show", &format!("{candidate}:f.txt")])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&show.stdout), "MERGED\n");

        cancel.cancel();
    }

    /// A fake scribe that streams one delta and returns a fixed message.
    struct DraftScribe(String);
    impl crate::scribe::ScribeSpawner for DraftScribe {
        fn run(
            &self,
            _model: String,
            _prompt: String,
            deltas: crate::scribe::ScribeDeltas,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
        {
            let s = self.0.clone();
            Box::pin(async move {
                if let Some(tx) = deltas {
                    let _ = tx.send(s.clone());
                }
                Ok(s)
            })
        }
    }

    fn draft_session_snapshot(
        project_dir: &str,
    ) -> tugcast_core::types::WorkspacesChangesetSnapshot {
        use tugcast_core::types::{
            ChangesetEntry, ChangesetFile, ChangesetSnapshot, ProjectChangeset,
            WorkspacesChangesetSnapshot,
        };
        let entry = ChangesetEntry::Session {
            owner_id: "s1".to_string(),
            display_name: "s1".to_string(),
            live: true,
            files: vec![ChangesetFile {
                path: "a.txt".to_string(),
                git_status: "M".to_string(),
                op: "edit".to_string(),
                origin: "exact".to_string(),
                shared: false,
                last_touched: 1,
            }],
            draft: None,
        };
        WorkspacesChangesetSnapshot {
            projects: vec![ProjectChangeset {
                project_dir: project_dir.to_string(),
                display_name: "proj".to_string(),
                no_repo: false,
                snapshot: ChangesetSnapshot {
                    workspace_key: "ws".to_string(),
                    branch: "main".to_string(),
                    ahead: 0,
                    behind: 0,
                    head_sha: String::new(),
                    head_message: String::new(),
                    changesets: vec![entry],
                    unattributed: vec![],
                },
                unattributed_draft: None,
            }],
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn changeset_draft_request_spawns_generation_over_snapshot() {
        use std::process::Command;

        fn git(dir: &std::path::Path, args: &[&str]) {
            let ok = Command::new("git")
                .current_dir(dir)
                .args(args)
                .status()
                .unwrap()
                .success();
            assert!(ok, "git {args:?} failed");
        }

        let (mut sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();
        sup.session_ledger = Some(Arc::new(
            crate::session_ledger::SessionLedger::open_in_memory().unwrap(),
        ));
        sup.set_scribe(ScribeContext {
            spawner: Arc::new(DraftScribe("Draft message\n".to_string())),
            model: Arc::new(|| "haiku".to_string()),
        });

        // A repo with a committed file and one tracked modification.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.name", "t"]);
        git(&root, &["config", "user.email", "t@t"]);
        std::fs::write(root.join("a.txt"), "base\n").unwrap();
        git(&root, &["add", "-A"]);
        git(&root, &["commit", "-m", "base"]);
        std::fs::write(root.join("a.txt"), "changed\n").unwrap();

        let cancel = CancellationToken::new();
        let _entry = sup.registry.get_or_create(&root, cancel.clone()).unwrap();
        let root_str = root.to_string_lossy().to_string();

        // Store the aggregate watch frame the request resolves against.
        let (_wtx, wrx) = watch::channel(Frame::new(
            FeedId::CHANGESET_ALL,
            serde_json::to_vec(&draft_session_snapshot(&root_str)).unwrap(),
        ));
        sup.changeset_watch.set(wrx).ok();

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "changeset_draft_request",
            "project_dir": root_str,
            "owner_kind": "session",
            "owner_id": "s1",
        }))
        .unwrap();
        // Generation is detached: handle_control returns before it runs, so we
        // poll the CONTROL broadcast for the drafting→ready sequence.
        sup.handle_control("changeset_draft_request", &payload, 1)
            .await;

        let mut saw_drafting = false;
        let mut saw_ready = false;
        for _ in 0..40 {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(10), control_rx.recv())
                .await
                .expect("a control frame")
                .expect("sender alive");
            let body: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
            if body["action"] == "changeset_draft_state" {
                match body["state"].as_str() {
                    Some("drafting") => saw_drafting = true,
                    Some("ready") => {
                        saw_ready = true;
                        break;
                    }
                    _ => {}
                }
            }
        }
        assert!(saw_drafting, "a drafting state streamed");
        assert!(saw_ready, "a ready state landed");

        let row = sup
            .session_ledger
            .as_ref()
            .unwrap()
            .changeset_draft("session", "s1", &root_str)
            .unwrap()
            .expect("draft row persisted");
        assert_eq!(row.message, "Draft message");

        cancel.cancel();
    }

    #[tokio::test]
    async fn changeset_draft_request_nothing_to_generate_replies_error() {
        let (mut sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();
        sup.session_ledger = Some(Arc::new(
            crate::session_ledger::SessionLedger::open_in_memory().unwrap(),
        ));
        sup.set_scribe(ScribeContext {
            spawner: Arc::new(DraftScribe("unused".to_string())),
            model: Arc::new(|| "haiku".to_string()),
        });

        // An empty snapshot surfaces no eligible entry for the requested owner.
        let empty = tugcast_core::types::WorkspacesChangesetSnapshot { projects: vec![] };
        let (_wtx, wrx) = watch::channel(Frame::new(
            FeedId::CHANGESET_ALL,
            serde_json::to_vec(&empty).unwrap(),
        ));
        sup.changeset_watch.set(wrx).ok();

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "changeset_draft_request",
            "project_dir": "/nope",
            "owner_kind": "session",
            "owner_id": "s1",
        }))
        .unwrap();
        sup.handle_control("changeset_draft_request", &payload, 1)
            .await;

        // The error reply is synchronous — readable right after the call.
        let frame = tokio::time::timeout(std::time::Duration::from_secs(5), control_rx.recv())
            .await
            .expect("a control frame")
            .expect("sender alive");
        let body: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(body["action"], "changeset_draft_state");
        assert_eq!(body["state"], "error");
        assert_eq!(body["detail"], "nothing to generate");
    }

    #[tokio::test]
    async fn test_spawn_session_writes_pending() {
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let frame = state_rx.try_recv().unwrap();
        let (id, state) = session_state_of(&frame);
        assert_eq!(id, "sess-1");
        assert_eq!(state, "pending");
    }

    #[tokio::test]
    async fn test_spawn_session_inserts_into_client_sessions() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let cs = sup.client_sessions.lock().await;
        let set = cs.get(&10).expect("client 10 has a session set");
        assert!(set.contains(&TugSessionId::new("sess-1")));
    }

    /// A `resume` payload for a session already bound to a different
    /// card must be rejected with `session_live_elsewhere` and a
    /// `SESSION_STATE = errored` broadcast, while same-card reconnects
    /// (the WS-drop-and-reconnect path) still succeed.
    #[tokio::test]
    async fn test_spawn_session_rejects_resume_when_live_on_other_card() {
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        // First spawn binds sess-1 to card-A. Eager spawn publishes
        // `pending` then `spawning`; drain both so the rejection
        // assertion isolates the `errored` frame.
        sup.handle_control("spawn_session", &spawn_payload("card-A", "sess-1"), 10)
            .await
            .expect_handled();
        while state_rx.try_recv().is_ok() {}

        // Second spawn from card-B with mode=resume on the same session
        // id must be rejected, with an `errored{session_live_elsewhere}`
        // SESSION_STATE broadcast.
        let err = sup
            .handle_control("spawn_session", &resume_payload("card-B", "sess-1"), 11)
            .await
            .expect_error();
        assert_eq!(
            err,
            ControlError::CapExceeded {
                reason: "session_live_elsewhere"
            }
        );
        let frame = state_rx.try_recv().expect("errored state for rejection");
        let (id, state) = session_state_of(&frame);
        assert_eq!(id, "sess-1");
        assert_eq!(state, "errored");

        // card-B's per-client affinity must NOT carry sess-1 (the
        // rejection rolled back the insert). card-A's still does.
        {
            let cs = sup.client_sessions.lock().await;
            assert!(cs.get(&11).is_none_or(|s| s.is_empty()));
            assert!(cs.get(&10).unwrap().contains(&TugSessionId::new("sess-1")));
        }

        // Same-card reconnect (card-A again) must still succeed — Phase
        // B's WS-drop-then-reconnect contract requires this.
        sup.handle_control("spawn_session", &resume_payload("card-A", "sess-1"), 10)
            .await
            .expect_handled_with("same-card reconnect must succeed");
    }

    /// A `resume` from a different card must SUCCEED when the recorded
    /// holder card has no live client connection — the
    /// `rebind_from_ledger` case. After a tugcast restart the entry is
    /// `Idle` carrying its old `card_id`, but `client_sessions` is
    /// empty for it; a new card is free to adopt the session.
    #[tokio::test]
    async fn test_spawn_session_allows_resume_when_recorded_card_has_no_live_client() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        // Simulate a rebound-from-ledger entry: present in the ledger,
        // `Idle`, carrying a recorded `card_id`, but with NO
        // `client_sessions` row (rebind does not populate it).
        let tug_id = TugSessionId::new("sess-1");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut e = entry_arc.lock().await;
            e.spawn_state = SpawnState::Idle;
            e.card_id = Some("card-old".to_string());
        }

        // A different card resumes it. No other live client holds the
        // session, so the resume is allowed and the binding moves.
        sup.handle_control("spawn_session", &resume_payload("card-new", "sess-1"), 20)
            .await
            .expect_handled_with(
                "resume of an orphaned (rebound-from-ledger) session must succeed",
            );

        let entry = entry_arc.lock().await;
        assert_eq!(
            entry.card_id.as_deref(),
            Some("card-new"),
            "the resuming card adopts the session binding",
        );
    }

    /// A `resume` from a different card on the SAME live client
    /// connection is still rejected — the session is genuinely held
    /// (the client's `client_sessions` row carries it), so a second
    /// card on that connection cannot steal it.
    #[tokio::test]
    async fn test_spawn_session_rejects_resume_same_client_other_card() {
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        // client 10 binds sess-1 to card-A.
        sup.handle_control("spawn_session", &spawn_payload("card-A", "sess-1"), 10)
            .await
            .expect_handled();
        while state_rx.try_recv().is_ok() {}

        // Same client 10 tries to resume sess-1 on card-B. The session
        // is still live on this very connection → rejected.
        let err = sup
            .handle_control("spawn_session", &resume_payload("card-B", "sess-1"), 10)
            .await
            .expect_error();
        assert_eq!(
            err,
            ControlError::CapExceeded {
                reason: "session_live_elsewhere"
            }
        );
    }

    #[tokio::test]
    async fn test_spawn_session_replays_latest_metadata_for_known_session() {
        let (sup, _state_rx, mut meta_rx, _control_rx) = make_supervisor_with_store();

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
            .expect_handled();

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
        let (sup, _state_rx, mut meta_rx, _control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 7)
            .await
            .expect_handled();

        assert!(
            meta_rx.try_recv().is_err(),
            "no replay should fire for a brand-new session"
        );
    }

    // ---- bind-time persisted-metadata replay (Step 2a.1) ----
    //
    // claude is silent in stream-json mode until the first user message,
    // so a resumed / known session must surface its last-known metadata
    // from the persisted sqlite row on bind. These pin
    // `persisted_metadata_replay_frame`'s three branches against a real
    // in-memory `SessionLedger`: persisted row replays when the in-memory
    // slot is empty; brand-new (no row, no slot) replays nothing; the
    // in-memory slot wins over the persisted row when both exist.

    /// A supervisor wired with a real in-memory `SessionLedger` (the
    /// sqlite read/write handle), a stall spawner (eager spawn installs
    /// plumbing but never produces claude output), and the metadata
    /// broadcast receiver. Mirrors `make_supervisor_with_store` but
    /// threads `Some(ledger)` so `persisted_metadata_replay_frame` can
    /// read the persisted row.
    fn make_supervisor_with_real_ledger() -> (
        AgentSupervisor,
        broadcast::Receiver<Frame>,
        Arc<crate::session_ledger::SessionLedger>,
    ) {
        let (state_tx, _state_rx) = broadcast::channel(512);
        let (meta_tx, meta_rx) = broadcast::channel(32);
        let (code_tx, _code_rx) = broadcast::channel(32);
        let (control_tx, _control_rx) = broadcast::channel(512);
        let registry = Arc::new(WorkspaceRegistry::new_for_test());
        let cancel = CancellationToken::new();
        let ledger = Arc::new(SessionLedger::open_in_memory().expect("ledger open"));
        let recorder: Arc<dyn SessionsRecorder> =
            Arc::new(LedgerSessionsRecorder::new(Arc::clone(&ledger)));
        let (sup, mut register_rx) = AgentSupervisor::new_with_ledger(
            SessionScopedFeed::from_sender(FeedId::SESSION_STATE, state_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::SESSION_SIDEBAND, meta_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::CODE_OUTPUT, code_tx, LagPolicy::Warn),
            SessionScopedFeed::new(FeedId::ACTIVITY, 64, LagPolicy::Warn),
            control_tx,
            recorder,
            Some(Arc::clone(&ledger)),
            stall_spawner_factory(),
            AgentSupervisorConfig::default(),
            registry,
            cancel,
        );
        tokio::spawn(async move { while register_rx.recv().await.is_some() {} });
        (sup, meta_rx, ledger)
    }

    /// A persisted `system_metadata` payload carrying model / version /
    /// mode — the shape the bridge merges and writes per turn.
    fn persisted_metadata_payload(model: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "type": "system_metadata",
            "model": model,
            "version": "2.1.157",
            "permissionMode": "acceptEdits",
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn test_spawn_session_replays_persisted_metadata_when_slot_empty() {
        let (sup, mut meta_rx, ledger) = make_supervisor_with_real_ledger();

        // Persist a row keyed by the (un-forked) session id, then bind a
        // ledger entry whose in-memory slot is empty — the fresh-process
        // resume case.
        let payload = persisted_metadata_payload("claude-opus-4-8[1m]");
        ledger
            .record_session_metadata("sess-1", &payload, 1_000)
            .unwrap();
        let entry = insert_ledger_entry(&sup, &TugSessionId::new("sess-1")).await;
        assert!(
            entry.lock().await.latest_metadata.is_none(),
            "precondition: in-memory slot is empty",
        );

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let received = meta_rx.try_recv().expect("persisted replay frame present");
        assert_eq!(received.feed_id, FeedId::SESSION_SIDEBAND);
        // The replay is the persisted row stamped with the bound session's
        // tug id — the persisted payload itself is untagged (the bridge
        // merges the raw line, pre-splice), and the client drops untagged
        // sideband frames per the [D06]/[D11] session filter.
        let received_json: serde_json::Value = serde_json::from_slice(&received.payload).unwrap();
        assert_eq!(
            received_json.get("tug_session_id").and_then(|v| v.as_str()),
            Some("sess-1"),
            "replay frame is stamped with the bound tug session id",
        );
        let mut expected: serde_json::Value = serde_json::from_slice(&payload).unwrap();
        expected["tug_session_id"] = serde_json::Value::String("sess-1".into());
        assert_eq!(
            received_json, expected,
            "replay frame is the persisted row payload plus the stamp",
        );
        assert!(
            meta_rx.try_recv().is_err(),
            "only a single replay frame is emitted",
        );
    }

    #[test]
    fn stamp_tug_session_id_adds_field_to_untagged_payload() {
        let payload = br#"{"type":"system_metadata","model":"claude-opus-4-8"}"#.to_vec();
        let out = stamp_tug_session_id(payload, "sess-9");
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["tug_session_id"], "sess-9");
        assert_eq!(v["model"], "claude-opus-4-8");
    }

    #[test]
    fn stamp_tug_session_id_overwrites_stale_tag() {
        let payload = br#"{"tug_session_id":"old-sess","type":"system_metadata"}"#.to_vec();
        let out = stamp_tug_session_id(payload, "new-sess");
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["tug_session_id"], "new-sess");
    }

    #[test]
    fn stamp_tug_session_id_splices_unparseable_blob() {
        // Truncated JSON: serde refuses, the splice fallback still lands the
        // tag after the first brace (matching the live relay's behavior).
        let payload = br#"{"type":"system_metadata","model":"clau"#.to_vec();
        let out = stamp_tug_session_id(payload, "sess-9");
        let s = String::from_utf8(out).unwrap();
        assert!(s.starts_with(r#"{"tug_session_id":"sess-9","#));
    }

    #[tokio::test]
    async fn test_spawn_session_no_persisted_row_fires_no_replay() {
        let (sup, mut meta_rx, _ledger) = make_supervisor_with_real_ledger();

        // Ledger handle present but no persisted row and no in-memory slot
        // (a genuinely brand-new session) → no replay.
        insert_ledger_entry(&sup, &TugSessionId::new("sess-1")).await;

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        assert!(
            meta_rx.try_recv().is_err(),
            "no replay for a session with no persisted row and no in-memory slot",
        );
    }

    #[tokio::test]
    async fn test_spawn_session_replays_persisted_capabilities_when_slot_empty() {
        let (sup, mut meta_rx, ledger) = make_supervisor_with_real_ledger();

        // Persist ONLY a capabilities row (no metadata row, no in-memory
        // slots) — the app-restart resume case: the old process's
        // `latest_capabilities` died with it, and the health-gated resume
        // handshake hasn't answered yet. The persisted payload carries the
        // ORIGINAL spawn's tag; the replay must re-stamp with the bound id.
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "session_capabilities",
            "tug_session_id": "sess-original",
            "version": "2.1.207",
            "models": [{ "value": "default", "displayName": "Default" }],
            "commands": ["tugplug:implement", "commit"],
        }))
        .unwrap();
        ledger
            .record_session_capabilities("sess-1", &payload, 1_000)
            .unwrap();
        let entry = insert_ledger_entry(&sup, &TugSessionId::new("sess-1")).await;
        assert!(
            entry.lock().await.latest_capabilities.is_none(),
            "precondition: in-memory capabilities slot is empty",
        );

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let received = meta_rx
            .try_recv()
            .expect("persisted capabilities replay present");
        assert_eq!(received.feed_id, FeedId::SESSION_SIDEBAND);
        let received_json: serde_json::Value = serde_json::from_slice(&received.payload).unwrap();
        assert_eq!(
            received_json.get("type").and_then(|v| v.as_str()),
            Some("session_capabilities"),
        );
        assert_eq!(
            received_json.get("tug_session_id").and_then(|v| v.as_str()),
            Some("sess-1"),
            "replay is stamped with the BOUND tug id, overwriting the original spawn's tag",
        );
        assert_eq!(
            received_json
                .get("commands")
                .and_then(|v| v.as_array())
                .map(|a| a.len()),
            Some(2),
            "the persisted command catalog rides the replay intact",
        );
        assert!(
            meta_rx.try_recv().is_err(),
            "only the capabilities frame is replayed (no metadata row exists)",
        );
    }

    #[tokio::test]
    async fn test_spawn_session_in_memory_capabilities_wins_over_persisted() {
        let (sup, mut meta_rx, ledger) = make_supervisor_with_real_ledger();

        // Both a persisted capabilities row AND an in-memory slot exist;
        // the freshest (in-memory, captured this process) wins.
        let persisted = serde_json::to_vec(&serde_json::json!({
            "type": "session_capabilities",
            "version": "2.1.204",
            "commands": ["stale"],
        }))
        .unwrap();
        ledger
            .record_session_capabilities("sess-1", &persisted, 1_000)
            .unwrap();
        let entry = insert_ledger_entry(&sup, &TugSessionId::new("sess-1")).await;
        let in_memory = Frame::new(
            FeedId::SESSION_SIDEBAND,
            serde_json::to_vec(&serde_json::json!({
                "type": "session_capabilities",
                "tug_session_id": "sess-1",
                "version": "2.1.207",
                "commands": ["tugplug:implement", "fresh"],
            }))
            .unwrap(),
        );
        entry.lock().await.latest_capabilities = Some(in_memory.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let received = meta_rx.try_recv().expect("capabilities replay present");
        assert_eq!(
            received.payload, in_memory.payload,
            "the in-memory slot is replayed verbatim; the persisted row is not consulted",
        );
        assert!(meta_rx.try_recv().is_err(), "single replay frame only");
    }

    #[tokio::test]
    async fn test_spawn_session_in_memory_slot_wins_over_persisted() {
        let (sup, mut meta_rx, ledger) = make_supervisor_with_real_ledger();

        // Both a persisted row AND an in-memory slot exist; the freshest
        // (in-memory) wins, and the persisted row is not consulted.
        let persisted = persisted_metadata_payload("claude-opus-4-6");
        ledger
            .record_session_metadata("sess-1", &persisted, 1_000)
            .unwrap();
        let entry = insert_ledger_entry(&sup, &TugSessionId::new("sess-1")).await;
        let in_memory = fake_metadata_frame("sess-1");
        entry.lock().await.latest_metadata = Some(in_memory.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let received = meta_rx.try_recv().expect("replay frame present");
        assert_eq!(
            received, in_memory,
            "in-memory slot wins over the persisted row",
        );
        assert_ne!(
            received.payload, persisted,
            "persisted row is not consulted when the slot is populated",
        );
        assert!(meta_rx.try_recv().is_err(), "single replay frame");
    }

    /// A `session_capabilities` payload — the turn-free `initialize` model
    /// list / command catalog, tagged so the merger and the client route
    /// it apart from `system_metadata`.
    fn fake_capabilities_frame() -> Frame {
        let body = serde_json::json!({
            "type": "session_capabilities",
            "models": [{ "value": "default", "displayName": "Default (recommended)" }],
            "commands": [],
        });
        Frame::new(FeedId::SESSION_SIDEBAND, serde_json::to_vec(&body).unwrap())
    }

    #[tokio::test]
    async fn test_spawn_session_replays_capabilities_on_bind() {
        // Capabilities are broadcast once per spawn; a reconnect / HMR
        // remount that binds afterward must still get them replayed so the
        // /model picker keeps its data. They replay independently of the
        // metadata slot (here: capabilities present, no metadata) and
        // carry the SESSION_SIDEBAND feed id.
        let (sup, mut meta_rx, _ledger) = make_supervisor_with_real_ledger();

        let entry = insert_ledger_entry(&sup, &TugSessionId::new("sess-1")).await;
        let caps = fake_capabilities_frame();
        entry.lock().await.latest_capabilities = Some(caps.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let received = meta_rx
            .try_recv()
            .expect("capabilities replay frame present");
        assert_eq!(received, caps, "the capabilities slot replays on bind");
        assert_eq!(received.feed_id, FeedId::SESSION_SIDEBAND);
        assert!(meta_rx.try_recv().is_err(), "only the capabilities frame");
    }

    #[tokio::test]
    async fn test_spawn_session_replays_metadata_and_capabilities_together() {
        // When both slots are populated (a reconnect to a session that has
        // run a turn AND handshaken), bind replays BOTH — one
        // system_metadata frame and one session_capabilities frame.
        let (sup, mut meta_rx, _ledger) = make_supervisor_with_real_ledger();

        let entry = insert_ledger_entry(&sup, &TugSessionId::new("sess-1")).await;
        let metadata = fake_metadata_frame("sess-1");
        let caps = fake_capabilities_frame();
        {
            let mut e = entry.lock().await;
            e.latest_metadata = Some(metadata.clone());
            e.latest_capabilities = Some(caps.clone());
        }

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        // Metadata replays first (it is the on-bind chip source), then
        // capabilities. Both ride SESSION_SIDEBAND; the client routes them
        // by payload `type`.
        let first = meta_rx.try_recv().expect("metadata replay frame");
        assert_eq!(first, metadata, "metadata replays first");
        let second = meta_rx.try_recv().expect("capabilities replay frame");
        assert_eq!(second, caps, "capabilities replays second");
        assert!(meta_rx.try_recv().is_err(), "exactly two replay frames");
    }

    /// A `rate_limit_event` payload — the per-turn subscription-quota
    /// broadcast, tagged so the merger and the client route it apart from
    /// `system_metadata` / `session_capabilities`.
    fn fake_rate_limit_frame() -> Frame {
        let body = serde_json::json!({
            "type": "rate_limit_event",
            "rate_limit_info": {
                "status": "warning",
                "resetsAt": 1_700_000_000,
                "rateLimitType": "five_hour",
                "overageStatus": "accepted",
                "isUsingOverage": false,
            },
            "ipc_version": 2,
        });
        Frame::new(FeedId::SESSION_SIDEBAND, serde_json::to_vec(&body).unwrap())
    }

    #[tokio::test]
    async fn test_spawn_session_replays_rate_limit_on_bind() {
        // The per-turn quota broadcast is in-memory only, like capabilities;
        // a reconnect / HMR remount that binds after the last broadcast flew
        // must still get it replayed so the Z4B rate-limit chip keeps its
        // state — which matters most when the session is hard rate-limited
        // and cannot start a turn to refresh it. It replays independently of
        // the metadata / capabilities slots and carries the SESSION_SIDEBAND
        // feed id.
        let (sup, mut meta_rx, _ledger) = make_supervisor_with_real_ledger();

        let entry = insert_ledger_entry(&sup, &TugSessionId::new("sess-1")).await;
        let rate_limit = fake_rate_limit_frame();
        entry.lock().await.latest_rate_limit = Some(rate_limit.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let received = meta_rx.try_recv().expect("rate-limit replay frame present");
        assert_eq!(received, rate_limit, "the rate-limit slot replays on bind");
        assert_eq!(received.feed_id, FeedId::SESSION_SIDEBAND);
        assert!(meta_rx.try_recv().is_err(), "only the rate-limit frame");
    }

    // ---- handle_control: close_session ----

    #[tokio::test]
    async fn test_close_session_publishes_closed_and_removes_entry() {
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
        // Eager spawn publishes both `pending` and `spawning` before
        // close. Drain whatever the spawn produced so the close
        // assertion isolates the close-time `closed` frame.
        while state_rx.try_recv().is_ok() {}

        sup.handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let (id, state) = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(id, "sess-1");
        assert_eq!(state, "closed");
        assert!(sup.ledger.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_close_session_removes_from_client_sessions() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
        sup.handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let cs = sup.client_sessions.lock().await;
        let set = cs.get(&10).expect("client 10 still has a set");
        assert!(!set.contains(&TugSessionId::new("sess-1")));
    }

    // ---- handle_control: reset_session ----

    #[tokio::test]
    async fn test_reset_session_publishes_closed_then_pending() {
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
        // Drain everything the first spawn produced (eager spawn fires
        // both `pending` and `spawning`).
        while state_rx.try_recv().is_ok() {}

        sup.handle_control("reset_session", &reset_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        // Reset publishes `closed` then re-spawns. The re-spawn fires
        // `pending` then (because eager spawn promotes Idle→Spawning)
        // `spawning`. Assert the first two are `closed` then `pending`
        // and tolerate the trailing `spawning` frame.
        let first = session_state_of(&state_rx.try_recv().unwrap());
        let second = session_state_of(&state_rx.try_recv().unwrap());
        assert_eq!(first, ("sess-1".into(), "closed".into()));
        assert_eq!(second, ("sess-1".into(), "pending".into()));
    }

    // ---- handle_control: request_replay ([D12], Phase A-R1 / Step R1b) ----

    /// Live session: request_replay forwards `{"type":"request_replay"}`
    /// to the per-session `input_tx`. The bridge's input loop writes
    /// payloads from this channel verbatim to tugcode's stdin (with a
    /// trailing `\n`); we observe the frame on the receiving end of the
    /// installed `input_tx` to verify the supervisor's contribution
    /// without spinning a real bridge.
    #[tokio::test]
    async fn test_request_replay_live_session_forwards_to_input_tx() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let tug_id = TugSessionId::new("sess-live");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;

        // Install a Live state + a captured input_tx so we can observe
        // the frame. Mirrors what `relay_session_io`'s session_init
        // promote path would have done in production.
        let (input_tx_for_ledger, mut input_rx_for_assert) = mpsc::channel::<Frame>(4);
        {
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Live;
            entry.input_tx = Some(input_tx_for_ledger.clone());
        }
        drop(input_tx_for_ledger);

        sup.handle_control("request_replay", &request_replay_payload("sess-live"), 10)
            .await
            .expect_handled();

        let frame = input_rx_for_assert
            .try_recv()
            .expect("request_replay payload reached input_tx");
        assert_eq!(frame.feed_id, FeedId::CODE_INPUT);
        let parsed: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(parsed["type"], "request_replay");
    }

    /// Idle session: request_replay no-ops. No frame on input_tx (none
    /// exists at Idle anyway), no error, and `handle_control` returns
    /// Ok. The cold-boot startup-replay path will fire when the
    /// dispatcher's first CODE_INPUT promotes Idle→Spawning.
    #[tokio::test]
    async fn test_request_replay_idle_session_is_noop() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let tug_id = TugSessionId::new("sess-idle");
        insert_ledger_entry(&sup, &tug_id).await;

        let result = sup
            .handle_control("request_replay", &request_replay_payload("sess-idle"), 10)
            .await;
        assert!(result.is_handled());

        // Sanity: state remains Idle, no input_tx installed.
        let entry_arc = {
            let ledger = sup.ledger.lock().await;
            ledger.get(&tug_id).cloned().unwrap()
        };
        let entry = entry_arc.lock().await;
        assert_eq!(entry.spawn_state, SpawnState::Idle);
        assert!(entry.input_tx.is_none());
    }

    /// Closed session: request_replay no-ops. Mirrors the Idle case;
    /// behavior must be uniform across non-Live states so a stale
    /// dispatch (e.g. tugdeck reconstructed services for a binding
    /// that has since been closed) cannot resurrect a dead session.
    #[tokio::test]
    async fn test_request_replay_closed_session_is_noop() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let tug_id = TugSessionId::new("sess-closed");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        // An input_tx left over from a prior Live phase MUST NOT receive
        // the request_replay frame once the entry is Closed.
        let (input_tx_for_ledger, mut input_rx_for_assert) = mpsc::channel::<Frame>(4);
        {
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Closed;
            entry.input_tx = Some(input_tx_for_ledger.clone());
        }
        drop(input_tx_for_ledger);

        sup.handle_control("request_replay", &request_replay_payload("sess-closed"), 10)
            .await
            .expect_handled();

        // input_tx receives nothing — the no-op branch fired.
        assert!(
            input_rx_for_assert.try_recv().is_err(),
            "no request_replay frame for a Closed entry"
        );
    }

    /// Unknown tug_session_id: no-op, no error. Matches the
    /// `close_session` "unknown is noop" contract — the supervisor's
    /// surface treats stale dispatches uniformly.
    #[tokio::test]
    async fn test_request_replay_unknown_session_is_noop() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let result = sup
            .handle_control(
                "request_replay",
                &request_replay_payload("sess-unknown"),
                10,
            )
            .await;
        assert!(result.is_handled());
    }

    /// Missing tug_session_id: parse_tug_session_id_payload returns
    /// `MissingSessionId`. The `?` in handle_control propagates.
    #[tokio::test]
    async fn test_request_replay_missing_tug_session_id_is_error() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        // Payload missing `tug_session_id`.
        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "request_replay",
        }))
        .unwrap();
        let result = sup.handle_control("request_replay", &payload, 10).await;
        assert_eq!(result.expect_error(), ControlError::MissingSessionId);
    }

    /// Empty tug_session_id: same as missing (the parser filters empty
    /// strings). Pins the wire-side validator's contract.
    #[tokio::test]
    async fn test_request_replay_empty_tug_session_id_is_error() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "request_replay",
            "tug_session_id": "",
        }))
        .unwrap();
        let result = sup.handle_control("request_replay", &payload, 10).await;
        assert_eq!(result.expect_error(), ControlError::MissingSessionId);
    }

    /// Malformed JSON payload: parser returns `Malformed`.
    #[tokio::test]
    async fn test_request_replay_malformed_payload_is_error() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let result = sup
            .handle_control("request_replay", b"not-json-at-all", 10)
            .await;
        assert_eq!(result.expect_error(), ControlError::Malformed);
    }

    // ---- handle_control: request_replay during Spawning (Step R4 / [D12]) ----

    /// Spawning: request_replay is enqueued at the front of the
    /// per-session queue. The bridge's session_init promote-and-drain
    /// (separately tested) forwards queued frames to input_tx in
    /// queue order — so a request_replay queued during Spawning lands
    /// at tugcode's stdin before any user input that may have been
    /// queued behind it.
    ///
    /// This test simulates the production drain by popping from
    /// `entry.queue` and asserting the popped frame is the
    /// request_replay payload.
    #[tokio::test]
    async fn test_request_replay_spawning_session_enqueues_at_front_of_queue() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        // Pre-load an entry in the Spawning state. Some other code path
        // (e.g., the dispatcher buffering a CODE_INPUT user_message
        // while claude is still booting) has already pushed a frame
        // onto the queue.
        let tug_id = TugSessionId::new("sess-r4-spawning");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        let user_input_payload = serde_json::to_vec(&serde_json::json!({
            "tug_session_id": "sess-r4-spawning",
            "type": "user_message",
            "text": "hi",
        }))
        .unwrap();
        let user_frame = Frame::new(FeedId::CODE_INPUT, user_input_payload.clone());
        {
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Spawning;
            assert_eq!(entry.queue.push(user_frame.clone()), QueuePush::Ok);
        }

        // Now the request_replay verb arrives. The Spawning branch
        // front-pushes it — so it precedes the user_message in the
        // queue.
        sup.handle_control(
            "request_replay",
            &request_replay_payload("sess-r4-spawning"),
            10,
        )
        .await
        .expect_handled();

        // Verify the queue contents in drain order: request_replay
        // first, user_message second.
        let mut entry = entry_arc.lock().await;
        let first = entry.queue.pop().expect("first frame queued");
        let second = entry.queue.pop().expect("second frame queued");
        assert!(entry.queue.is_empty(), "exactly two frames in queue");

        let first_body: serde_json::Value = serde_json::from_slice(&first.payload).unwrap();
        assert_eq!(first_body["type"], "request_replay");

        let second_body: serde_json::Value = serde_json::from_slice(&second.payload).unwrap();
        assert_eq!(second_body["type"], "user_message");
    }

    /// Spawning with an empty queue: request_replay is the only
    /// resident; pop returns it; nothing else.
    #[tokio::test]
    async fn test_request_replay_spawning_empty_queue_just_request_replay() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let tug_id = TugSessionId::new("sess-r4-spawning-empty");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Spawning;
        }

        sup.handle_control(
            "request_replay",
            &request_replay_payload("sess-r4-spawning-empty"),
            10,
        )
        .await
        .expect_handled();

        let mut entry = entry_arc.lock().await;
        let frame = entry.queue.pop().expect("request_replay queued");
        assert!(entry.queue.is_empty());
        let body: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(body["type"], "request_replay");
    }

    /// Live session: request_replay is forwarded immediately to
    /// input_tx (no queue interaction). Regression-pin for the
    /// pre-existing happy path — R4's branch refactor must not break
    /// this.
    #[tokio::test]
    async fn test_request_replay_live_immediate_forward_unchanged_post_r4() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let tug_id = TugSessionId::new("sess-r4-live");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;

        let (input_tx_for_ledger, mut input_rx_for_assert) = mpsc::channel::<Frame>(4);
        {
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Live;
            entry.input_tx = Some(input_tx_for_ledger.clone());
        }
        drop(input_tx_for_ledger);

        sup.handle_control(
            "request_replay",
            &request_replay_payload("sess-r4-live"),
            10,
        )
        .await
        .expect_handled();

        let frame = input_rx_for_assert
            .try_recv()
            .expect("Live forwards immediately");
        let body: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(body["type"], "request_replay");

        // And nothing landed on the queue (Spawning path didn't fire).
        let entry = entry_arc.lock().await;
        assert!(entry.queue.is_empty());
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
    async fn test_spawn_session_cap_excludes_idle_and_errored_entries() {
        // Cap = 2. Preload one `Idle` + one `Errored` entry. Neither
        // counts against the budget, so a third fresh spawn succeeds.
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 2,
            max_spawns_per_minute: 100,
            ..Default::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store_config(config);

        preload_entry_in_state(&sup, &TugSessionId::new("sess-idle"), SpawnState::Idle).await;
        preload_entry_in_state(&sup, &TugSessionId::new("sess-err"), SpawnState::Errored).await;

        // Fresh spawn of a third tug_session_id succeeds because active
        // (Spawning+Live) count is 0.
        sup.handle_control("spawn_session", &spawn_payload("card-new", "sess-new"), 10)
            .await
            .expect_handled_with("Idle+Errored do not consume cap slots");
    }

    #[tokio::test]
    async fn test_spawn_session_reconnect_bypasses_cap() {
        // Cap = 1. Preload a single `Live` entry at the cap. A
        // *reconnect* `spawn_session` for the SAME tug_session_id must
        // succeed — the existing entry is reused and no new subprocess
        // is implied.
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 1,
            max_spawns_per_minute: 100,
            ..Default::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store_config(config);

        preload_entry_in_state(&sup, &TugSessionId::new("sess-1"), SpawnState::Live).await;

        // Reconnect: same tug_session_id as the preloaded entry.
        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled_with("reconnect must bypass the concurrent cap");

        // A *fresh* spawn for a different tsid with cap=1 still trips.
        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-2", "sess-2"), 10)
            .await
            .expect_error();
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
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 100,
            max_spawns_per_minute: 2,
            ..Default::default()
        };
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store_config(config);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled_with("first spawn admitted");
        sup.handle_control("spawn_session", &spawn_payload("card-2", "sess-2"), 10)
            .await
            .expect_handled_with("second spawn admitted");

        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-3", "sess-3"), 10)
            .await
            .expect_error();
        assert_eq!(
            err,
            ControlError::CapExceeded {
                reason: "spawn_rate_limited"
            }
        );

        // Eager spawn produces `pending` then `spawning` per successful
        // spawn; the third spawn (rejected by rate limit) emits exactly
        // one `errored` frame. Drain everything until we find the
        // rate-limited errored frame (anchored by tsid + detail).
        let mut errored: Option<serde_json::Value> = None;
        while let Ok(f) = state_rx.try_recv() {
            let v: serde_json::Value = serde_json::from_slice(&f.payload).unwrap();
            if v["state"].as_str() == Some("errored")
                && v["tug_session_id"].as_str() == Some("sess-3")
            {
                errored = Some(v);
                break;
            }
        }
        let v = errored.expect("rate-limited errored frame published");
        assert_eq!(v["detail"].as_str(), Some("spawn_rate_limited"));
    }

    #[tokio::test]
    async fn test_spawn_session_rate_limit_window_ejects_old_timestamps() {
        // cap_check_reason trims timestamps older than 60s from the
        // front of the deque on every call. Seed the deque with two
        // ancient timestamps (simulating spawns from 2 minutes ago),
        // then verify fresh spawns succeed because the trim empties the
        // window before the length check.
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 100,
            max_spawns_per_minute: 2,
            ..Default::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store_config(config);

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
            .expect_handled_with("first spawn admitted after trim");
        sup.handle_control("spawn_session", &spawn_payload("card-2", "sess-2"), 10)
            .await
            .expect_handled_with("second spawn admitted after trim");

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
        let config = AgentSupervisorConfig {
            max_concurrent_sessions: 100,
            max_spawns_per_minute: 1,
            ..Default::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store_config(config);

        preload_entry_in_state(&sup, &TugSessionId::new("sess-pre"), SpawnState::Idle).await;

        // Reconnect — must NOT push a timestamp.
        sup.handle_control("spawn_session", &spawn_payload("card-pre", "sess-pre"), 10)
            .await
            .expect_handled_with("reconnect admitted");
        assert_eq!(
            sup.spawn_timestamps.lock().unwrap().len(),
            0,
            "reconnect must not consume rate budget"
        );

        // Fresh spawn — consumes the one and only budget slot.
        sup.handle_control("spawn_session", &spawn_payload("card-new", "sess-new"), 10)
            .await
            .expect_handled_with("fresh spawn admitted (first of the window)");
        assert_eq!(
            sup.spawn_timestamps.lock().unwrap().len(),
            1,
            "fresh spawn consumes exactly one budget slot"
        );

        // A second fresh spawn now trips the rate limit.
        let err = sup
            .handle_control("spawn_session", &spawn_payload("card-3", "sess-3"), 10)
            .await
            .expect_error();
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
        let (sup, mut state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

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
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

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
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
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
        let (sup, mut state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
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
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        // Pin the entry to Spawning so the dispatcher buffers into the queue.
        // Insert the ledger entry directly rather than via `spawn_session` —
        // that path launches the real bridge, whose auth gate flips the entry
        // to Errored on a host with no logged-in `claude` (CI), racing the
        // dispatch loop below and starving the queue before it can overflow.
        let tug_id = TugSessionId::new("sess-1");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
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
            let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();
            let sup = Arc::new(sup);

            // Pre-spawn from client 10 so both racers start from a populated
            // ledger entry; otherwise there's nothing for close to remove.
            sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
                .await
                .expect_handled();

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
            assert!(
                close_result.is_handled(),
                "close_task failed on iter {iter}"
            );
            assert!(
                spawn_result.is_handled(),
                "spawn_task failed on iter {iter}"
            );

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

    // ---- default_spawner_factory does not close over project_dir ----

    #[test]
    fn test_default_spawner_factory_does_not_close_over_project_dir() {
        // Historically, `default_spawner_factory` captured both
        // `tugcode_path` and `project_dir` from the supervisor config and
        // baked them into each TugcodeSpawner instance. The spawner was
        // then made stateless with respect to `project_dir` — the field
        // was deleted from the spawner, `TugcodeSpawner::new` takes only
        // `tugcode_path`, and `spawn_child` accepts `project_dir` per
        // call. Later, `AgentSupervisorConfig::project_dir` was removed
        // entirely ([D12]). This test now relies on
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
            None,
            None,
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

    // ---- rebind tests ----

    /// Defense-in-depth must NOT fire when the entry
    /// is past `Idle` (i.e., the bridge has already spawned tugcode).
    /// Silently switching the mode of a running subprocess would
    /// misrepresent live state — the existing `effective_mode` ack
    /// computation already gates on this, and we mirror the gate here.
    #[tokio::test]
    async fn test_defense_in_depth_does_not_override_running_session() {
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        // Fresh spawn in `new` mode. After `handle_control`, the entry
        // is `Spawning` (eager-spawn promoted it). A subsequent
        // reconnect with mode=resume must NOT flip the entry's mode.
        sup.handle_control(
            "spawn_session",
            &spawn_payload("card-dev", "sess-running"),
            10,
        )
        .await
        .expect_handled();

        let id = TugSessionId::new("sess-running");
        {
            let ledger = sup.ledger.lock().await;
            let entry = ledger.get(&id).unwrap().clone();
            let entry = entry.lock().await;
            assert_ne!(
                entry.spawn_state,
                SpawnState::Idle,
                "eager-spawn promotes Idle→Spawning before
                 do_spawn_session returns; the defense-in-depth gate \
                 must observe a non-Idle state below"
            );
            assert_eq!(entry.session_mode, SessionMode::New);
        }

        // Reconnect from a different client requesting resume. The
        // defense-in-depth must skip because the entry is no longer
        // Idle.
        sup.handle_control(
            "spawn_session",
            &resume_payload("card-dev", "sess-running"),
            11,
        )
        .await
        .expect_handled();

        let ledger = sup.ledger.lock().await;
        let entry = ledger.get(&id).unwrap().clone();
        drop(ledger);
        let entry = entry.lock().await;
        assert_eq!(
            entry.session_mode,
            SessionMode::New,
            "defense-in-depth must NOT switch the mode of a running \
             session — the bridge has already spawned tugcode with the \
             original mode and the running subprocess is load-bearing. \
             The gate is `spawn_state == Idle`.",
        );
    }

    // ---- merger_task, per-session bridge, metadata routing ----

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
            _resume_claude_session_id: Option<&str>,
            _permission_mode: Option<&str>,
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
        let ((sup, _state_rx, _meta_rx, _control_rx), register_rx) =
            make_supervisor_with_spawner(stall_spawner_factory());
        let sup = Arc::new(sup);
        let mut code_rx = sup.code_output.subscribe();
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
    async fn test_merger_diverts_activity_delta_to_activity_feed() {
        // Pins Step 7 ([P13]/[P15]): an `activity_delta` line arriving on a
        // session's stdout is DIVERTED onto the ACTIVITY feed — re-tagged
        // `FeedId::ACTIVITY`, session tag preserved — and never rides the
        // CODE_OUTPUT broadcast. A following ordinary frame proves the
        // stream keeps flowing on CODE_OUTPUT after the divert.
        let ((sup, _state_rx, _meta_rx, _control_rx), register_rx) =
            make_supervisor_with_spawner(stall_spawner_factory());
        let sup = Arc::new(sup);
        let mut activity_rx = sup.activity.subscribe();
        let mut code_rx = sup.code_output.subscribe();
        let cancel = CancellationToken::new();
        let merger_handle = tokio::spawn(Arc::clone(&sup).merger_task(register_rx, cancel.clone()));

        let id = TugSessionId::new("sess-act");
        let (tx, rx) = mpsc::channel::<Frame>(4);
        sup.merger_register_tx.send((id.clone(), rx)).await.unwrap();

        // The activity frame arrives already tagged CODE_OUTPUT (relay's
        // splice) with `tug_session_id` as the first field, exactly as the
        // live producer (#step-8) emits it.
        let activity_frame = Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-act","type":"activity_delta","channels":{"text":42}}"#
                .to_vec(),
        );
        let ordinary_frame = Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-act","type":"assistant_text"}"#.to_vec(),
        );
        tx.send(activity_frame.clone()).await.unwrap();
        tx.send(ordinary_frame.clone()).await.unwrap();

        // The diverted frame lands on ACTIVITY, re-tagged, splice intact.
        let diverted = tokio::time::timeout(Duration::from_millis(500), activity_rx.recv())
            .await
            .expect("activity frame timeout")
            .expect("activity frame recv err");
        assert_eq!(diverted.feed_id, FeedId::ACTIVITY);
        assert_eq!(diverted.payload, activity_frame.payload);

        // CODE_OUTPUT sees ONLY the ordinary frame — the activity_delta was
        // diverted, not copied, so the very first CODE_OUTPUT frame is the
        // ordinary one.
        let on_code = tokio::time::timeout(Duration::from_millis(500), code_rx.recv())
            .await
            .expect("code frame timeout")
            .expect("code frame recv err");
        assert_eq!(
            on_code.payload, ordinary_frame.payload,
            "activity_delta must not ride CODE_OUTPUT"
        );

        cancel.cancel();
        let _ = merger_handle.await;
    }

    #[tokio::test]
    async fn test_turn_active_gates_the_sampler_snapshot() {
        // Pins the Pulse work-attribution gate: `live_session_processes`
        // reports a session only while a turn is in flight. A closing
        // `turn_complete` through the merger ends attribution (so an idle
        // session's CPU/disk read zero); `wake_started` re-opens it; a
        // replayed historical closer (bracket open) must NOT end a live turn.
        let ((sup, _state_rx, _meta_rx, _control_rx), register_rx) =
            make_supervisor_with_spawner(stall_spawner_factory());
        let sup = Arc::new(sup);
        let cancel = CancellationToken::new();
        let merger_handle = tokio::spawn(Arc::clone(&sup).merger_task(register_rx, cancel.clone()));

        let id = TugSessionId::new("sess-turn");
        insert_ledger_entry(&sup, &id).await;
        let entry_arc = sup.ledger.lock().await.get(&id).cloned().unwrap();
        {
            let mut entry = entry_arc.lock().await;
            entry.child_pid = Some(4242);
            entry.child_start_time = Some(1_000);
            entry.turn_active = true;
        }
        assert_eq!(sup.live_session_processes().await.len(), 1);

        let (tx, rx) = mpsc::channel::<Frame>(8);
        sup.merger_register_tx.send((id.clone(), rx)).await.unwrap();

        // The live closer ends attribution.
        tx.send(Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-turn","type":"turn_complete","msg_id":"m","seq":1}"#
                .to_vec(),
        ))
        .await
        .unwrap();
        wait_until(|| {
            let entry_arc = entry_arc.clone();
            async move { !entry_arc.lock().await.turn_active }
        })
        .await;
        assert!(sup.live_session_processes().await.is_empty());

        // A wake turn re-opens attribution without an inbound user_message.
        tx.send(Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-turn","type":"wake_started","session_id":"x"}"#.to_vec(),
        ))
        .await
        .unwrap();
        wait_until(|| {
            let entry_arc = entry_arc.clone();
            async move { entry_arc.lock().await.turn_active }
        })
        .await;
        assert_eq!(sup.live_session_processes().await.len(), 1);

        // A replayed closer inside an open bracket must not end the turn.
        // Subscribe to CODE_OUTPUT first: receiving the closer back off the
        // broadcast proves the merger has fully processed it (turn frames
        // forward to CODE_OUTPUT; only activity_delta diverts).
        let mut code_rx = sup.code_output.subscribe();
        entry_arc.lock().await.replay_brackets_open = 1;
        tx.send(Frame::new(
            FeedId::CODE_OUTPUT,
            br#"{"tug_session_id":"sess-turn","type":"turn_complete","msg_id":"old","seq":0}"#
                .to_vec(),
        ))
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_millis(500), code_rx.recv())
            .await
            .expect("bracketed closer timeout")
            .expect("bracketed closer recv err");
        assert!(
            entry_arc.lock().await.turn_active,
            "a bracketed (replayed) turn_complete must not end a live turn"
        );

        cancel.cancel();
        let _ = merger_handle.await;
    }

    /// Poll `cond` until it yields true (bounded); panics on timeout.
    async fn wait_until<F, Fut>(mut cond: F)
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = bool>,
    {
        for _ in 0..100 {
            if cond().await {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("wait_until: condition not met within 1s");
    }

    #[tokio::test]
    async fn test_merger_routes_metadata_per_session_no_clobber() {
        // Pins [D14]: two sessions emit distinct `system_metadata` frames
        // in rapid succession. Both frames must land on the SESSION_SIDEBAND
        // broadcast (a single-slot watch would drop one), AND each ledger
        // entry's `latest_metadata` must hold its own payload with no
        // cross-pollination.
        let ((sup, _state_rx, mut meta_rx, _control_rx), register_rx) =
            make_supervisor_with_spawner(stall_spawner_factory());
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
        // payloads with `FeedId::SESSION_SIDEBAND` before publishing onto
        // the session_sideband feed. `Frame::encode` uses `frame.feed_id` as
        // the first wire byte, so any client-side filter keyed on
        // `FeedId::SESSION_SIDEBAND` depends on this. A regression that
        // left the feed_id as CODE_OUTPUT would silently break tugdeck's
        // SESSION_SIDEBAND store without any payload assertion catching
        // it.
        assert_eq!(first.feed_id, FeedId::SESSION_SIDEBAND);
        assert_eq!(second.feed_id, FeedId::SESSION_SIDEBAND);

        let received: HashSet<Vec<u8>> = [first.payload, second.payload].into_iter().collect();
        assert!(
            received.contains(&meta_a.payload),
            "session A metadata missing from SESSION_SIDEBAND broadcast"
        );
        assert!(
            received.contains(&meta_b.payload),
            "session B metadata missing from SESSION_SIDEBAND broadcast"
        );

        // Each ledger entry's latest_metadata must hold its own distinct
        // payload. A single-slot watch would have one session's payload
        // clobber the other. The stored frames are also rewrapped as
        // SESSION_SIDEBAND so event-driven replay in `do_spawn_session`
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
        assert_eq!(stored_a.feed_id, FeedId::SESSION_SIDEBAND);
        assert_eq!(stored_b.feed_id, FeedId::SESSION_SIDEBAND);
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
        let ((sup, _state_rx, _meta_rx, _control_rx), _register_rx) =
            make_supervisor_with_spawner(stall_spawner_factory());

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
        let state_tx = sup.session_state.sender();
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
            None,
            &crate::feeds::changeset::ChangesetBumper::disconnected(),
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

    /// When tugcode emits `resume_failed` and then exits (closes
    /// stdout), `relay_session_io` must promote the EOF
    /// from `Crashed` (would retry) to `ResumeFailed { ... }` so the
    /// outer `run_session_bridge` loop tears down terminally without
    /// re-spawning under the same stale `--resume` id. Pins the
    /// invariant so a future EOF-handling change can't quietly bring
    /// the silent retry back.
    #[tokio::test]
    async fn test_resume_failed_promotes_eof_to_terminal() {
        let ((sup, _state_rx, _meta_rx, _control_rx), _register_rx) =
            make_supervisor_with_spawner(stall_spawner_factory());

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
            child_stdout_write
                .write_all(frame.as_bytes())
                .await
                .unwrap();
            drop(child_stdout_write);
        });

        let (_input_tx_bridge, mut input_rx_bridge) = mpsc::channel::<Frame>(4);
        let (merger_tx, mut merger_rx) = mpsc::channel::<Frame>(4);
        let state_tx = sup.session_state.sender();
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
            None,
            &crate::feeds::changeset::ChangesetBumper::disconnected(),
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
        let parsed: serde_json::Value = serde_json::from_slice(&forwarded.payload).unwrap();
        assert_eq!(parsed["type"], "resume_failed");
        assert_eq!(parsed["stale_session_id"], stale_id);
        assert_eq!(parsed["tug_session_id"], "sess-resume-fail");
    }

    /// End-to-end pin for plan `#step-20-3-6`: the bridge intercept
    /// on `system_metadata` lines merges the incoming payload against
    /// the persisted ledger row and rewrites the wire to carry the
    /// most-informationally-rich version before forwarding. Validates
    /// the full capture + merge + inject path:
    ///
    ///   1. Live `system_metadata` arrives with the `[1m]`-suffixed
    ///      model. The bridge has no persisted row yet; the merge
    ///      returns incoming verbatim and persists it.
    ///   2. Replay-synthesized `system_metadata` arrives with the
    ///      bare model name (the JSONL transcript doesn't preserve
    ///      the suffix) and empty `cwd` / `permissionMode` /
    ///      `tools` / `slash_commands` / etc. The bridge merges
    ///      against the persisted live payload and forwards the rich
    ///      merged value.
    ///
    /// Both outbound `system_metadata` frames must carry the suffix;
    /// the ledger row at end-of-stream must hold the suffix.
    #[tokio::test]
    async fn test_system_metadata_bridge_merge_preserves_suffix_e2e() {
        let ((sup, _state_rx, _meta_rx, _control_rx), _register_rx) =
            make_supervisor_with_spawner(stall_spawner_factory());

        let tug_id = TugSessionId::new("sess-meta-e2e");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.spawn_state = SpawnState::Spawning;
        }

        // Wire up an in-memory ledger so the bridge can read/write
        // `session_metadata` rows.
        let ledger = Arc::new(crate::session_ledger::SessionLedger::open_in_memory().unwrap());

        let (bridge_stdin, mut child_stdin_read) = tokio::io::duplex(8192);
        let (mut child_stdout_write, bridge_stdout) = tokio::io::duplex(8192);

        let claude_session_id = "claude-meta-e2e";

        // Fake child writes: ack, session_init, live system_metadata,
        // replay_started, bare-model replay system_metadata,
        // replay_complete, EOF.
        let claude_id_for_child = claude_session_id.to_string();
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
                .write_all(
                    format!(
                        "{{\"type\":\"session_init\",\"session_id\":\"{claude_id_for_child}\"}}\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();

            // Live `system_metadata` — matches what `tugcode/src/session.ts`
            // emits on the `subtype === "init"` branch.
            let live_payload = serde_json::json!({
                "type": "system_metadata",
                "session_id": claude_id_for_child,
                "cwd": "/home/user/project",
                "tools": ["Read", "Bash"],
                "model": "claude-opus-4-7[1m]",
                "permissionMode": "default",
                "slash_commands": ["help"],
                "plugins": [],
                "agents": [],
                "skills": ["tugplug:plan"],
                "mcp_servers": [],
                "version": "2.1.105",
                "output_style": "",
                "fast_mode_state": "",
                "apiKeySource": "anthropic",
                "ipc_version": 2,
            });
            let mut live_line = serde_json::to_vec(&live_payload).unwrap();
            live_line.push(b'\n');
            child_stdout_write.write_all(&live_line).await.unwrap();

            child_stdout_write
                .write_all(b"{\"type\":\"replay_started\"}\n")
                .await
                .unwrap();

            // Replay-synthesized `system_metadata` — matches what
            // `tugcode/src/replay.ts` synthesizes. Bare model, every
            // other field empty / empty-array.
            let replay_payload = serde_json::json!({
                "type": "system_metadata",
                "session_id": claude_id_for_child,
                "cwd": "",
                "tools": [],
                "model": "claude-opus-4-7",
                "permissionMode": "",
                "slash_commands": [],
                "plugins": [],
                "agents": [],
                "skills": [],
                "mcp_servers": [],
                "version": "",
                "output_style": "",
                "fast_mode_state": "",
                "apiKeySource": "",
                "ipc_version": 2,
            });
            let mut replay_line = serde_json::to_vec(&replay_payload).unwrap();
            replay_line.push(b'\n');
            child_stdout_write.write_all(&replay_line).await.unwrap();

            child_stdout_write
                .write_all(b"{\"type\":\"replay_complete\"}\n")
                .await
                .unwrap();
            drop(child_stdout_write);
        });

        let (_input_tx_bridge, mut input_rx_bridge) = mpsc::channel::<Frame>(4);
        let (merger_tx, mut merger_rx) = mpsc::channel::<Frame>(16);
        let state_tx = sup.session_state.sender();
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
            "/tmp/test-meta-e2e",
            &recorder,
            Some(ledger.as_ref()),
            &crate::feeds::changeset::ChangesetBumper::disconnected(),
            &cancel,
        )
        .await;
        child_task.await.unwrap();
        assert_eq!(outcome, RelayOutcome::Crashed); // EOF after the stream

        // Drain every CODE_OUTPUT frame the merger received and collect
        // the two `system_metadata` ones in order.
        let mut metadata_frames: Vec<serde_json::Value> = Vec::new();
        while let Ok(frame) = merger_rx.try_recv() {
            if frame.feed_id != FeedId::CODE_OUTPUT {
                continue;
            }
            let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&frame.payload) else {
                continue;
            };
            if parsed.get("type").and_then(|v| v.as_str()) == Some("system_metadata") {
                metadata_frames.push(parsed);
            }
        }
        assert_eq!(
            metadata_frames.len(),
            2,
            "both live and replay system_metadata frames must be forwarded",
        );

        // Both wire payloads carry the suffixed model.
        assert_eq!(
            metadata_frames[0]["model"], "claude-opus-4-7[1m]",
            "live system_metadata forwards verbatim with suffix",
        );
        assert_eq!(
            metadata_frames[1]["model"], "claude-opus-4-7[1m]",
            "replay-synthesized system_metadata is merged against the persisted live payload — \
             suffix preserved on the wire",
        );

        // Both wire payloads also carry the rich live values for cwd /
        // permissionMode / etc. (the replay-synthesized payload's empty
        // values were overridden by the persisted live ones).
        assert_eq!(metadata_frames[1]["cwd"], "/home/user/project");
        assert_eq!(metadata_frames[1]["permissionMode"], "default");
        assert_eq!(metadata_frames[1]["version"], "2.1.105");
        assert_eq!(metadata_frames[1]["apiKeySource"], "anthropic");
        assert_eq!(
            metadata_frames[1]["tools"].as_array().unwrap().len(),
            2,
            "live tools array survives the replay-synthesized empty array",
        );
        assert_eq!(
            metadata_frames[1]["slash_commands"]
                .as_array()
                .unwrap()
                .len(),
            1,
        );
        assert_eq!(metadata_frames[1]["skills"].as_array().unwrap().len(), 1,);

        // The ledger row holds the suffixed model at end-of-stream.
        let row = ledger
            .get_session_metadata(claude_session_id)
            .unwrap()
            .expect("ledger has the merged session_metadata row");
        let persisted: serde_json::Value = serde_json::from_slice(&row.payload).unwrap();
        assert_eq!(persisted["model"], "claude-opus-4-7[1m]");
        assert_eq!(persisted["cwd"], "/home/user/project");
    }

    // ---- SessionKeyRecord schema + dual-read migration ----

    // ================================================================
    // supervisor lifecycle hooks against the registry
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
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

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
            .expect_error();
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
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let payload = spawn_payload_in(
            "card-1",
            "sess-1",
            "/nonexistent/xyz-workspace-registry-test",
        );
        let err = sup
            .handle_control("spawn_session", &payload, 10)
            .await
            .expect_error();
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
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store();

        let payload = spawn_payload_in("card-1", "sess-1", file_path.to_str().unwrap());
        let err = sup
            .handle_control("spawn_session", &payload, 10)
            .await
            .expect_error();
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
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

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
    async fn test_two_sessions_same_workspace_share_entry() {
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-a", "sess-a"), 10)
            .await
            .expect_handled();
        sup.handle_control("spawn_session", &spawn_payload("card-b", "sess-b"), 20)
            .await
            .expect_handled();
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
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
        let _ = control_rx.try_recv(); // drain ack
        assert_eq!(registry_map_len(&sup), 1);

        sup.handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        // Refcount should have hit zero; the workspace is removed.
        assert_eq!(registry_map_len(&sup), 0);
        assert!(sup.ledger.lock().await.is_empty());
    }

    #[tokio::test]
    async fn test_reset_session_preserves_workspace() {
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
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
            .expect_handled();

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
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        sup.handle_control(
            "spawn_session",
            &spawn_payload_in("card-a", "sess-a", tmp_a.path().to_str().unwrap()),
            10,
        )
        .await
        .expect_handled();
        sup.handle_control(
            "spawn_session",
            &spawn_payload_in("card-b", "sess-b", tmp_b.path().to_str().unwrap()),
            20,
        )
        .await
        .expect_handled();
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
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
        let _ = control_rx.try_recv(); // drain ack

        // Reconnect: same tug_session_id (and same project_dir), new card.
        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 11)
            .await
            .expect_handled();
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
    async fn test_spawn_resume_of_rebound_entry_keeps_workspace() {
        // The restore bug: an entry rebound from the ledger holds NO workspace
        // refcount (rebind registers no workspace, by design). Its first resume
        // spawn hits `inserted == false`; the old code read that as "a refcount
        // is already held" and released the one Phase 0 just acquired — dropping
        // the fresh workspace's ONLY refcount and tearing it down. The resumed
        // project then vanished from the registry (and the changeset aggregate /
        // git-log resolution). With per-entry refcount ownership, the rebound
        // entry ADOPTS the Phase-0 refcount on its first spawn, so it survives.
        use std::sync::atomic::Ordering;
        let (sup, _state_rx, _meta_rx, mut control_rx) = make_supervisor_with_store();

        // Simulate `rebind_from_ledger`: an Idle, Resume entry present in the
        // in-memory ledger, bound to a card, holding no workspace refcount.
        let sid = TugSessionId::new("reb-sess");
        let mut entry = LedgerEntry::new(
            sid.clone(),
            WorkspaceKey::from_canonical(test_project_dir()),
            PathBuf::from(test_project_dir()),
            SessionMode::Resume,
            CrashBudget::new(3, Duration::from_secs(60)),
        );
        entry.card_id = Some("card-r".to_string());
        entry.claude_session_id = Some("reb-sess".to_string());
        assert!(
            !entry.holds_workspace_refcount,
            "a rebound entry starts holding no workspace refcount"
        );
        sup.ledger
            .lock()
            .await
            .insert(sid.clone(), Arc::new(Mutex::new(entry)));

        // Registry is empty until the first real spawn registers the workspace.
        assert_eq!(registry_map_len(&sup), 0);

        // First resume spawn of the rebound entry.
        sup.handle_control("spawn_session", &resume_payload("card-r", "reb-sess"), 10)
            .await
            .expect_handled();
        let _ = control_rx.try_recv();

        // The workspace is registered and SURVIVES (was torn down before the fix).
        assert_eq!(
            registry_map_len(&sup),
            1,
            "the rebound resume must keep its workspace registered"
        );
        let ref_count = {
            let map = sup.registry.inner_for_test();
            let (_key, ws) = map.iter().next().expect("one workspace");
            ws.ref_count.load(Ordering::Relaxed)
        };
        assert_eq!(
            ref_count, 1,
            "the entry adopts exactly one workspace refcount"
        );

        // The entry now records ownership of that refcount.
        let e = sup.ledger.lock().await.get(&sid).unwrap().clone();
        assert!(
            e.lock().await.holds_workspace_refcount,
            "the entry adopted the Phase-0 refcount"
        );
    }

    // ── LedgerSessionsRecorder lifecycle ─────────────────────────────────────
    //
    // These tests exercise the recorder against a real in-memory
    // [`SessionLedger`] — no mocks, no call-count assertions. The contract
    // under test is "when the trait method runs, the ledger row reaches the
    // expected state." Each test traces one CRUD trajectory.

    use crate::session_ledger::{SessionLedger, SessionState as LedgerState};

    fn fresh_ledger_recorder() -> (Arc<SessionLedger>, Arc<dyn SessionsRecorder>) {
        let ledger = Arc::new(SessionLedger::open_in_memory().expect("ledger open"));
        let recorder: Arc<dyn SessionsRecorder> =
            Arc::new(LedgerSessionsRecorder::new(Arc::clone(&ledger)));
        (ledger, recorder)
    }

    #[test]
    fn ledger_recorder_record_inserts_live_row() {
        let (ledger, recorder) = fresh_ledger_recorder();
        recorder.record(SessionRecord {
            session_id: "claude-abc",
            workspace_key: "ws-1",
            project_dir: "/proj/x",
            card_id: "card-1",
            tag: None,
        });
        let row = ledger.get("claude-abc").unwrap().expect("row");
        assert_eq!(row.workspace_key, "ws-1");
        assert_eq!(row.project_dir, "/proj/x");
        assert_eq!(row.card_id.as_deref(), Some("card-1"));
        assert_eq!(row.state, LedgerState::Live);
        assert_eq!(row.turn_count, 0);
    }

    /// The ledger (the source of truth for sessions) publishes a "sessions
    /// changed" signal on every session-lifecycle write, so a delegate — the
    /// CHANGESET_ALL aggregate — recomputes on a spawn / turn / close with no
    /// poll. Driven through the recorder (the production write path) to prove
    /// the whole chain: recorder → ledger write → published signal.
    #[tokio::test]
    async fn ledger_publishes_change_on_session_lifecycle() {
        let ledger = Arc::new(SessionLedger::open_in_memory().expect("ledger open"));
        let signal = Arc::new(Notify::new());
        ledger.set_change_signal(Arc::clone(&signal));
        let recorder = LedgerSessionsRecorder::new(Arc::clone(&ledger));

        let expect_ping = |signal: Arc<Notify>, what: &'static str| async move {
            tokio::time::timeout(std::time::Duration::from_millis(200), signal.notified())
                .await
                .unwrap_or_else(|_| panic!("{what} must publish a sessions-changed signal"));
        };

        recorder.record(SessionRecord {
            session_id: "claude-abc",
            workspace_key: "ws-1",
            project_dir: "/proj/x",
            card_id: "card-1",
            tag: None,
        });
        expect_ping(Arc::clone(&signal), "record (spawn)").await;

        recorder.record_turn("claude-abc");
        expect_ping(Arc::clone(&signal), "record_turn").await;

        recorder.mark_closed("claude-abc");
        expect_ping(Arc::clone(&signal), "mark_closed").await;
    }

    #[test]
    fn ledger_recorder_record_user_prompt_overwrites_snippet() {
        let (ledger, recorder) = fresh_ledger_recorder();
        recorder.record(SessionRecord {
            session_id: "claude-abc",
            workspace_key: "ws-1",
            project_dir: "/proj/x",
            card_id: "card-1",
            tag: None,
        });
        recorder.record_user_prompt("claude-abc", "hello world");
        let row = ledger.get("claude-abc").unwrap().unwrap();
        assert_eq!(row.last_user_prompt.as_deref(), Some("hello world"));

        // Subsequent calls overwrite — the picker shows the latest prompt.
        recorder.record_user_prompt("claude-abc", "second turn");
        let row = ledger.get("claude-abc").unwrap().unwrap();
        assert_eq!(row.last_user_prompt.as_deref(), Some("second turn"));
    }

    #[test]
    fn ledger_recorder_record_turn_then_close_full_lifecycle() {
        let (ledger, recorder) = fresh_ledger_recorder();
        recorder.record(SessionRecord {
            session_id: "claude-abc",
            workspace_key: "ws-1",
            project_dir: "/proj/x",
            card_id: "card-1",
            tag: None,
        });
        // Live turns touch recency only; the count is the engine reconcile
        // ([P08]). Reconcile to 3, then live turns leave the count untouched.
        recorder.set_turn_count("claude-abc", 3);
        recorder.record_turn("claude-abc");
        recorder.record_turn("claude-abc");
        recorder.mark_closed("claude-abc");

        let row = ledger.get("claude-abc").unwrap().expect("row");
        assert_eq!(row.turn_count, 3);
        assert_eq!(row.state, LedgerState::Closed);
        // card_id is preserved across mark_closed under the new
        // semantics — the persisted row keeps the binding so client-side
        // restore can reconstruct it.
        assert_eq!(row.card_id.as_deref(), Some("card-1"));
    }

    #[test]
    fn ledger_recorder_mark_failed_retains_row() {
        let (ledger, recorder) = fresh_ledger_recorder();
        recorder.record(SessionRecord {
            session_id: "claude-abc",
            workspace_key: "ws-1",
            project_dir: "/proj/x",
            card_id: "card-1",
            tag: None,
        });
        recorder.mark_failed("claude-abc");

        let row = ledger.get("claude-abc").unwrap().expect("row retained");
        assert_eq!(row.state, LedgerState::Failed);
        assert_eq!(row.card_id.as_deref(), Some("card-1"));
    }

    #[test]
    fn ledger_recorder_remove_drops_closed_row() {
        let (ledger, recorder) = fresh_ledger_recorder();
        recorder.record(SessionRecord {
            session_id: "claude-abc",
            workspace_key: "ws-1",
            project_dir: "/proj/x",
            card_id: "card-1",
            tag: None,
        });
        recorder.mark_closed("claude-abc");
        recorder.remove("claude-abc");

        assert!(ledger.get("claude-abc").unwrap().is_none());
    }

    #[test]
    fn ledger_recorder_record_turn_no_op_after_close() {
        // Late `result` events that arrive after the user closes the card
        // must not mutate the ledger row — the row is "done."
        let (ledger, recorder) = fresh_ledger_recorder();
        recorder.record(SessionRecord {
            session_id: "claude-abc",
            workspace_key: "ws-1",
            project_dir: "/proj/x",
            card_id: "card-1",
            tag: None,
        });
        recorder.mark_closed("claude-abc");
        recorder.record_turn("claude-abc");
        let row = ledger.get("claude-abc").unwrap().expect("row");
        assert_eq!(row.turn_count, 0);
        assert_eq!(row.state, LedgerState::Closed);
    }

    // ── do_close_session ↔ ledger integration ────────────────────────────────

    /// `do_close_session` reads `entry.claude_session_id` and dispatches
    /// `mark_closed` to the recorder. With a real ledger plugged in, the
    /// row's state must transition.
    #[tokio::test]
    async fn close_session_marks_ledger_row_closed_when_claude_id_present() {
        let ledger = Arc::new(SessionLedger::open_in_memory().expect("ledger open"));
        let recorder: Arc<dyn SessionsRecorder> =
            Arc::new(LedgerSessionsRecorder::new(Arc::clone(&ledger)));

        let (state_tx, _state_rx) = broadcast::channel(64);
        let (meta_tx, _meta_rx) = broadcast::channel(8);
        let (code_tx, _code_rx) = broadcast::channel(8);
        let (control_tx, _control_rx) = broadcast::channel(64);
        let registry = Arc::new(WorkspaceRegistry::new_for_test());
        let cancel = CancellationToken::new();
        let (sup, mut register_rx) = AgentSupervisor::new(
            SessionScopedFeed::from_sender(FeedId::SESSION_STATE, state_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::SESSION_SIDEBAND, meta_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::CODE_OUTPUT, code_tx, LagPolicy::Warn),
            SessionScopedFeed::new(FeedId::ACTIVITY, 64, LagPolicy::Warn),
            control_tx,
            recorder,
            stall_spawner_factory(),
            AgentSupervisorConfig::default(),
            registry,
            cancel,
        );
        // Drain merger registrations like make_supervisor_with_store does.
        tokio::spawn(async move { while register_rx.recv().await.is_some() {} });

        // Spawn the session through the normal CONTROL path so the entry is
        // populated correctly. Then manually set `claude_session_id` to
        // simulate that `session_init` was observed (which the bridge would
        // have done in production).
        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();
        // Pre-seed the ledger so `mark_closed` has a row to transition.
        ledger
            .record_spawn(
                "claude-1",
                "/some/workspace",
                "/some/workspace",
                "card-1",
                1_700_000_000_000,
                None,
            )
            .unwrap();
        {
            let outer = sup.ledger.lock().await;
            let entry_arc = outer
                .get(&TugSessionId::new("sess-1"))
                .expect("entry")
                .clone();
            drop(outer);
            let mut entry = entry_arc.lock().await;
            entry.claude_session_id = Some("claude-1".to_owned());
        }

        sup.handle_control("close_session", &close_payload("card-1", "sess-1"), 10)
            .await
            .expect_handled();

        let row = ledger.get("claude-1").unwrap().expect("row");
        assert_eq!(row.state, LedgerState::Closed);
        assert_eq!(row.card_id.as_deref(), Some("card-1"));
    }

    // ── CONTROL ledger ops ───────────────────────────────────────────────────
    //
    // These tests exercise the new `list_sessions`, `trash_session`, and
    // `trash_workspace_sessions` actions end-to-end through the supervisor's
    // `handle_control` path. The supervisor is built with a real
    // `SessionLedger` in scope; the tests assert the broadcast frames the
    // CONTROL feed emits and the ledger row state after each action.

    /// Build a supervisor with a real ledger + a recorder that emits push
    /// frames on writes. Returns the supervisor, ledger, and the CONTROL
    /// receiver so tests can read the broadcast traffic.
    fn make_supervisor_with_ledger() -> (
        Arc<AgentSupervisor>,
        Arc<SessionLedger>,
        broadcast::Receiver<Frame>,
    ) {
        let ledger = Arc::new(SessionLedger::open_in_memory().expect("ledger open"));
        make_supervisor_for_ledger(ledger, None)
    }

    /// Harness variant for union/liveness tests: a ledger with a real
    /// tempdir claude-projects root, and an injectable terminal
    /// registry root. The default registry root is a nonexistent path
    /// so tests never read the developer's real `~/.claude/sessions`.
    fn make_supervisor_for_ledger(
        ledger: Arc<SessionLedger>,
        terminal_registry_root: Option<std::path::PathBuf>,
    ) -> (
        Arc<AgentSupervisor>,
        Arc<SessionLedger>,
        broadcast::Receiver<Frame>,
    ) {
        let (state_tx, _state_rx) = broadcast::channel(64);
        let (meta_tx, _meta_rx) = broadcast::channel(8);
        let (code_tx, _code_rx) = broadcast::channel(8);
        let (control_tx, control_rx) = broadcast::channel(128);
        let recorder: Arc<dyn SessionsRecorder> = Arc::new(LedgerSessionsRecorder::with_broadcast(
            Arc::clone(&ledger),
            control_tx.clone(),
        ));
        let registry = Arc::new(WorkspaceRegistry::new_for_test());
        let cancel = CancellationToken::new();
        let config = AgentSupervisorConfig {
            terminal_registry_root: Some(terminal_registry_root.unwrap_or_else(|| {
                std::path::PathBuf::from("/nonexistent/tugcast-test-terminal-registry")
            })),
            ..AgentSupervisorConfig::default()
        };
        let (sup, mut register_rx) = AgentSupervisor::new_with_ledger(
            SessionScopedFeed::from_sender(FeedId::SESSION_STATE, state_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::SESSION_SIDEBAND, meta_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::CODE_OUTPUT, code_tx, LagPolicy::Warn),
            SessionScopedFeed::new(FeedId::ACTIVITY, 64, LagPolicy::Warn),
            control_tx,
            recorder,
            Some(Arc::clone(&ledger)),
            stall_spawner_factory(),
            config,
            registry,
            cancel,
        );
        tokio::spawn(async move { while register_rx.recv().await.is_some() {} });
        (Arc::new(sup), ledger, control_rx)
    }

    /// Drain until the **settled** `list_sessions_ok` — the phase-2 emit
    /// carrying the full union (`scanning: false`). `do_list_sessions`
    /// emits twice: a phase-1 `{ scanning: true }` with ledger rows only,
    /// then this one once the external scan completes. Tests asserting on
    /// external/union rows must wait for the settled frame.
    async fn drain_until_list_sessions_settled(
        rx: &mut broadcast::Receiver<Frame>,
    ) -> serde_json::Value {
        // The settled frame is sent from a detached phase-2 task, so we
        // must `await` (yield to the runtime) rather than `try_recv` — the
        // task only runs while this test awaits. Bounded by a timeout so a
        // never-arriving frame surfaces as a panic, not a hang.
        for _ in 0..256 {
            let frame =
                match tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv()).await {
                    Ok(Ok(f)) => f,
                    _ => break,
                };
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&frame.payload) {
                let is_ok = v.get("action").and_then(|a| a.as_str()) == Some("list_sessions_ok");
                let settled = v.get("scanning").and_then(|s| s.as_bool()) == Some(false);
                if is_ok && settled {
                    return v;
                }
            }
        }
        panic!("settled `list_sessions_ok` (scanning:false) not observed");
    }

    fn drain_until_action(rx: &mut broadcast::Receiver<Frame>, action: &str) -> serde_json::Value {
        // Pull frames off the broadcast until we find one whose `action`
        // matches; ignore the others. Bounded loop so a missing frame
        // surfaces as a panic on the receiver's empty error rather than a
        // hang.
        for _ in 0..64 {
            let Ok(frame) = rx.try_recv() else { break };
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&frame.payload) {
                if v.get("action").and_then(|a| a.as_str()) == Some(action) {
                    return v;
                }
            }
        }
        panic!("CONTROL frame with action `{action}` not observed");
    }

    /// `list_card_bindings` returns every non-failed row carrying a
    /// `card_id`, including rows with `turn_count == 0`. The wire
    /// shape includes `turn_count` so the client can branch:
    /// `mode=resume` for rows with history (claude has a JSONL),
    /// `mode=new` for zero-turn rows (no JSONL but the card→project
    /// binding should be preserved across relaunches).
    #[tokio::test]
    async fn list_card_bindings_returns_all_card_rows_with_turn_count() {
        let (sup, ledger, mut rx) = make_supervisor_with_ledger();

        // A card whose user picked Start Fresh and quit before any
        // prompt: spawned (record_spawn fires on session_init) but
        // never had a turn.
        ledger
            .record_spawn("empty", "ws-1", "/proj/alpha", "card-A", 1_000, None)
            .unwrap();
        ledger.mark_closed("empty").unwrap();

        // A card with a real conversation (count from the engine reconcile).
        ledger
            .record_spawn("real", "ws-1", "/proj/beta", "card-B", 2_000, None)
            .unwrap();
        ledger.set_turn_count("real", 1, 3_000).unwrap();
        ledger.mark_closed("real").unwrap();

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_card_bindings",
        }))
        .unwrap();
        sup.handle_control("list_card_bindings", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_action(&mut rx, "list_card_bindings_ok");
        let bindings = response["bindings"].as_array().expect("bindings array");
        assert_eq!(
            bindings.len(),
            2,
            "both rows surface — client decides resume vs new on turn_count. \
             response: {response}",
        );
        let by_card: std::collections::HashMap<&str, &serde_json::Value> = bindings
            .iter()
            .map(|b| (b["card_id"].as_str().unwrap(), b))
            .collect();
        let empty = by_card["card-A"];
        assert_eq!(empty["session_id"], "empty");
        assert_eq!(empty["project_dir"], "/proj/alpha");
        assert_eq!(empty["turn_count"], 0);
        let real = by_card["card-B"];
        assert_eq!(real["session_id"], "real");
        assert_eq!(real["project_dir"], "/proj/beta");
        assert_eq!(real["turn_count"], 1);

        // Both rows are mark_closed and never live-registered in the
        // in-memory supervisor map, so neither is "alive". The flag
        // must still appear on the wire (consumers gate on it).
        assert_eq!(empty["is_alive"], false);
        assert_eq!(real["is_alive"], false);
    }

    /// `list_shell_exchanges { tug_session_id }` broadcasts
    /// `list_shell_exchanges_ok { tug_session_id, exchanges: [...] }` with the
    /// session's rows oldest-first — the deck's shell-restore tail read.
    #[tokio::test]
    async fn list_shell_exchanges_returns_the_session_tail() {
        // Build a supervisor with a shell ledger holding two exchanges.
        let shell_ledger = Arc::new(crate::shell_ledger::ShellLedger::open_in_memory().unwrap());
        for (cmd, code) in [("echo a", Some(0)), ("false", Some(1))] {
            shell_ledger
                .record_exchange(&crate::shell_ledger::NewShellExchange {
                    tug_session_id: "s1".to_string(),
                    command: cmd.to_string(),
                    output: format!("out:{cmd}\n"),
                    exit_code: code,
                    cwd: "/proj".to_string(),
                    cwd_after: Some("/proj".to_string()),
                    started_at_ms: 1,
                    settled_at_ms: 2,
                })
                .unwrap();
        }

        let ledger = Arc::new(SessionLedger::open_in_memory().expect("ledger open"));
        let (state_tx, _s) = broadcast::channel(64);
        let (meta_tx, _m) = broadcast::channel(8);
        let (code_tx, _c) = broadcast::channel(8);
        let (control_tx, mut rx) = broadcast::channel(128);
        let recorder: Arc<dyn SessionsRecorder> = Arc::new(LedgerSessionsRecorder::with_broadcast(
            Arc::clone(&ledger),
            control_tx.clone(),
        ));
        let (mut sup, mut register_rx) = AgentSupervisor::new_with_ledger(
            SessionScopedFeed::from_sender(FeedId::SESSION_STATE, state_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::SESSION_SIDEBAND, meta_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::CODE_OUTPUT, code_tx, LagPolicy::Warn),
            SessionScopedFeed::new(FeedId::ACTIVITY, 64, LagPolicy::Warn),
            control_tx,
            recorder,
            Some(Arc::clone(&ledger)),
            stall_spawner_factory(),
            AgentSupervisorConfig::default(),
            Arc::new(WorkspaceRegistry::new_for_test()),
            CancellationToken::new(),
        );
        sup.set_shell_ledger(Arc::clone(&shell_ledger));
        tokio::spawn(async move { while register_rx.recv().await.is_some() {} });

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_shell_exchanges",
            "tug_session_id": "s1",
        }))
        .unwrap();
        sup.handle_control("list_shell_exchanges", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_action(&mut rx, "list_shell_exchanges_ok");
        assert_eq!(response["tug_session_id"], "s1");
        let exchanges = response["exchanges"].as_array().expect("exchanges array");
        assert_eq!(exchanges.len(), 2);
        // Oldest-first.
        assert_eq!(exchanges[0]["command"], "echo a");
        assert_eq!(exchanges[0]["exit_code"], 0);
        assert_eq!(exchanges[1]["command"], "false");
        assert_eq!(exchanges[1]["exit_code"], 1);
        assert_eq!(exchanges[1]["seq"], 2);
    }

    /// An unknown session (or one with no exchanges) yields an empty array,
    /// never an error — the "no shell history yet" restore state.
    #[tokio::test]
    async fn list_shell_exchanges_empty_for_unknown_session() {
        let shell_ledger = Arc::new(crate::shell_ledger::ShellLedger::open_in_memory().unwrap());
        let ledger = Arc::new(SessionLedger::open_in_memory().expect("ledger open"));
        let (state_tx, _s) = broadcast::channel(64);
        let (meta_tx, _m) = broadcast::channel(8);
        let (code_tx, _c) = broadcast::channel(8);
        let (control_tx, mut rx) = broadcast::channel(128);
        let recorder: Arc<dyn SessionsRecorder> = Arc::new(LedgerSessionsRecorder::with_broadcast(
            Arc::clone(&ledger),
            control_tx.clone(),
        ));
        let (mut sup, mut register_rx) = AgentSupervisor::new_with_ledger(
            SessionScopedFeed::from_sender(FeedId::SESSION_STATE, state_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::SESSION_SIDEBAND, meta_tx, LagPolicy::Warn),
            SessionScopedFeed::from_sender(FeedId::CODE_OUTPUT, code_tx, LagPolicy::Warn),
            SessionScopedFeed::new(FeedId::ACTIVITY, 64, LagPolicy::Warn),
            control_tx,
            recorder,
            Some(Arc::clone(&ledger)),
            stall_spawner_factory(),
            AgentSupervisorConfig::default(),
            Arc::new(WorkspaceRegistry::new_for_test()),
            CancellationToken::new(),
        );
        sup.set_shell_ledger(shell_ledger);
        tokio::spawn(async move { while register_rx.recv().await.is_some() {} });

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_shell_exchanges",
            "tug_session_id": "nope",
        }))
        .unwrap();
        sup.handle_control("list_shell_exchanges", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_action(&mut rx, "list_shell_exchanges_ok");
        assert_eq!(response["exchanges"].as_array().unwrap().len(), 0);
    }

    /// `list_card_bindings` reports `is_alive: true` for a session
    /// whose subprocess entry in the in-memory ledger is in the
    /// `Spawning` or `Live` state. This is the third signal the client
    /// uses to decide `mode=resume` for an **in-flight first turn** —
    /// a session that has zero committed turns (`turn_count == 0`) but
    /// holds an active claude subprocess with mid-turn state (e.g. a
    /// pending `AskUserQuestion`). Without `is_alive`, the client's
    /// `turn_count`-only gate would mistake the in-flight case for
    /// "Start Fresh + quit" and spawn a fresh session, orphaning the
    /// live one.
    #[tokio::test]
    async fn list_card_bindings_reports_is_alive_for_live_sessions() {
        let (sup, ledger, mut rx) = make_supervisor_with_ledger();

        // Two rows in sqlite, both with `turn_count == 0`. The
        // difference between them is whether the in-memory ledger
        // entry exists in a Live state.
        ledger
            .record_spawn("live", "ws-1", "/proj/alive", "card-Live", 1_000, None)
            .unwrap();
        ledger
            .record_spawn("dead", "ws-1", "/proj/dead", "card-Dead", 2_000, None)
            .unwrap();

        // Promote "live" into the supervisor's in-memory ledger as
        // `Live`. "dead" stays out of the map — its sqlite row is the
        // only trace.
        {
            let mut map = sup.ledger.lock().await;
            let entry = LedgerEntry {
                spawn_state: SpawnState::Live,
                ..LedgerEntry::new(
                    TugSessionId("live".to_string()),
                    WorkspaceKey::from_test_str("ws-1"),
                    std::path::PathBuf::from("/proj/alive"),
                    SessionMode::New,
                    CrashBudget::new(3, std::time::Duration::from_secs(60)),
                )
            };
            map.insert(
                TugSessionId("live".to_string()),
                std::sync::Arc::new(tokio::sync::Mutex::new(entry)),
            );
        }

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_card_bindings",
        }))
        .unwrap();
        sup.handle_control("list_card_bindings", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_action(&mut rx, "list_card_bindings_ok");
        let bindings = response["bindings"].as_array().expect("bindings array");
        let by_card: std::collections::HashMap<&str, &serde_json::Value> = bindings
            .iter()
            .map(|b| (b["card_id"].as_str().unwrap(), b))
            .collect();
        let live = by_card["card-Live"];
        let dead = by_card["card-Dead"];
        assert_eq!(live["turn_count"], 0);
        assert_eq!(live["is_alive"], true);
        assert_eq!(dead["turn_count"], 0);
        assert_eq!(dead["is_alive"], false);
    }

    #[tokio::test]
    async fn list_sessions_returns_project_dir_rows_newest_first() {
        let (sup, ledger, mut rx) = make_supervisor_with_ledger();

        ledger
            .record_spawn("s-old", "ws-1", "/proj/alpha", "c1", 1_000, None)
            .unwrap();
        ledger.mark_closed("s-old").unwrap();
        ledger
            .record_spawn("s-new", "ws-1", "/proj/alpha", "c2", 5_000, None)
            .unwrap();
        ledger.mark_closed("s-new").unwrap();
        ledger
            .record_spawn("other", "ws-2", "/proj/beta", "c3", 3_000, None)
            .unwrap();
        ledger.mark_closed("other").unwrap();

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_sessions",
            "project_dir": "/proj/alpha",
        }))
        .unwrap();

        sup.handle_control("list_sessions", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_action(&mut rx, "list_sessions_ok");
        assert_eq!(response["project_dir"], "/proj/alpha");
        let sessions = response["sessions"].as_array().expect("sessions array");
        assert_eq!(sessions.len(), 2, "/proj/alpha has exactly 2 rows");
        assert_eq!(sessions[0]["session_id"], "s-new");
        assert_eq!(sessions[1]["session_id"], "s-old");
    }

    /// Seed an external (no ledger row) session JSONL under the
    /// ledger's claude root for `project_dir`. Returns the file path.
    fn seed_external_jsonl(
        claude_root: &std::path::Path,
        project_dir: &str,
        session_id: &str,
        last_prompt: &str,
    ) -> std::path::PathBuf {
        let dir = claude_root.join(crate::session_ledger::encode_claude_project_name(
            project_dir,
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session_id}.jsonl"));
        let content = format!(
            "{{\"type\":\"mode\",\"mode\":\"normal\",\"sessionId\":\"{session_id}\"}}\n\
             {{\"type\":\"user\",\"sessionId\":\"{session_id}\",\"cwd\":\"{project_dir}\",\"timestamp\":\"2026-06-01T10:00:00.000Z\",\"message\":{{\"role\":\"user\",\"content\":\"{last_prompt}\"}}}}"
        );
        std::fs::write(&path, content).unwrap();
        path
    }

    const EXTERNAL_ID: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    /// Write a registry entry into `root` for `session_id` with `pid`.
    fn write_registry_entry(root: &std::path::Path, session_id: &str, pid: u32, stem: &str) {
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(
            root.join(format!("{stem}.json")),
            format!(r#"{{"pid":{pid},"sessionId":"{session_id}","status":"busy"}}"#),
        )
        .unwrap();
    }

    #[tokio::test]
    async fn resume_of_terminal_live_session_is_rejected_on_fresh_insert() {
        // The primary gate case: no prior in-memory entry for the
        // session (first-ever resume of an external session), so the
        // gate must fire on the fresh-insert path, not just reconnects.
        let tmp = tempfile::tempdir().unwrap();
        let registry_root = tmp.path().join("registry");
        write_registry_entry(&registry_root, "ext-held", std::process::id(), "1");
        let config = AgentSupervisorConfig {
            terminal_registry_root: Some(registry_root),
            ..AgentSupervisorConfig::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store_config(config);

        let err = sup
            .handle_control("spawn_session", &resume_payload("card-1", "ext-held"), 10)
            .await
            .expect_error();
        assert_eq!(
            err,
            ControlError::CapExceeded {
                reason: "session_live_in_terminal"
            }
        );
        // Bookkeeping fully undone: no in-memory entry, no affinity row.
        assert!(
            !sup.ledger
                .lock()
                .await
                .contains_key(&TugSessionId("ext-held".to_string())),
            "rejected fresh insert must not leave a ledger entry behind"
        );
        let cs = sup.client_sessions.lock().await;
        assert!(
            cs.values()
                .all(|set| !set.contains(&TugSessionId("ext-held".to_string()))),
            "rejected resume must not leave an affinity row behind"
        );
    }

    #[tokio::test]
    async fn resume_with_dead_pid_registry_entry_proceeds() {
        let tmp = tempfile::tempdir().unwrap();
        let registry_root = tmp.path().join("registry");
        // macOS pids cap below 100000; this entry is a crash leftover.
        write_registry_entry(&registry_root, "ext-stale", 999_999, "1");
        let config = AgentSupervisorConfig {
            terminal_registry_root: Some(registry_root),
            ..AgentSupervisorConfig::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store_config(config);

        sup.handle_control("spawn_session", &resume_payload("card-1", "ext-stale"), 10)
            .await
            .expect_handled_with("stale registry entry must not block resume");
    }

    #[tokio::test]
    async fn new_mode_spawn_ignores_terminal_liveness() {
        // A `new` spawn mints a fresh id; even a (pathological)
        // registry entry with the same id must not gate it — the gate
        // is resume-only by design.
        let tmp = tempfile::tempdir().unwrap();
        let registry_root = tmp.path().join("registry");
        write_registry_entry(&registry_root, "fresh-id", std::process::id(), "1");
        let config = AgentSupervisorConfig {
            terminal_registry_root: Some(registry_root),
            ..AgentSupervisorConfig::default()
        };
        let (sup, _state_rx, _meta_rx, _control_rx) = make_supervisor_with_store_config(config);

        sup.handle_control("spawn_session", &spawn_payload("card-1", "fresh-id"), 10)
            .await
            .expect_handled_with("new-mode spawn is not gated on terminal liveness");
    }

    #[tokio::test]
    async fn trash_of_terminal_live_session_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let registry_root = tmp.path().join("registry");
        write_registry_entry(&registry_root, "held-row", std::process::id(), "1");
        let ledger = Arc::new(SessionLedger::open_in_memory().expect("ledger open"));
        ledger
            .record_spawn("held-row", "ws-1", "/proj/alpha", "c1", 1_000, None)
            .unwrap();
        ledger.mark_closed("held-row").unwrap();
        let (sup, ledger, mut rx) = make_supervisor_for_ledger(ledger, Some(registry_root));

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "trash_session",
            "session_id": "held-row",
        }))
        .unwrap();
        sup.handle_control("trash_session", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_action(&mut rx, "trash_session_err");
        assert_eq!(response["reason"], "session_live_in_terminal");
        assert!(
            ledger.get("held-row").unwrap().is_some(),
            "refused trash must leave the row intact"
        );
    }

    #[tokio::test]
    async fn trash_external_session_moves_jsonl_without_ledger_row() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_root = tmp.path().join("projects");
        let ledger = Arc::new(
            SessionLedger::open_with_claude_root(
                tmp.path().join("sessions.db"),
                claude_root.clone(),
            )
            .unwrap(),
        );
        let (sup, _ledger, mut rx) = make_supervisor_for_ledger(ledger, None);
        let jsonl_path = seed_external_jsonl(&claude_root, "/proj/alpha", EXTERNAL_ID, "to trash");

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "trash_session",
            "session_id": EXTERNAL_ID,
            "project_dir": "/proj/alpha",
        }))
        .unwrap();
        sup.handle_control("trash_session", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_action(&mut rx, "trash_session_ok");
        assert_eq!(response["session_id"], EXTERNAL_ID);
        assert!(
            !jsonl_path.exists(),
            "JSONL must be moved out of the project dir"
        );
        let trash_root = claude_root
            .join(crate::session_ledger::encode_claude_project_name(
                "/proj/alpha",
            ))
            .join(".tug-trash");
        assert!(trash_root.exists(), "JSONL must land in .tug-trash");

        // Second trash of the same id: nothing on disk, no row → not_found.
        sup.handle_control("trash_session", &payload, 10)
            .await
            .expect_handled();
        let response = drain_until_action(&mut rx, "trash_session_err");
        assert_eq!(response["reason"], "not_found");
    }

    #[tokio::test]
    async fn trash_unledgered_session_without_project_dir_errors_cleanly() {
        let tmp = tempfile::tempdir().unwrap();
        let ledger = Arc::new(
            SessionLedger::open_with_claude_root(
                tmp.path().join("sessions.db"),
                tmp.path().join("projects"),
            )
            .unwrap(),
        );
        let (sup, _ledger, mut rx) = make_supervisor_for_ledger(ledger, None);
        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "trash_session",
            "session_id": "no-such-session",
        }))
        .unwrap();
        sup.handle_control("trash_session", &payload, 10)
            .await
            .expect_handled();
        let response = drain_until_action(&mut rx, "trash_session_err");
        assert_eq!(response["reason"], "not_found");
    }

    #[tokio::test]
    async fn list_sessions_unions_external_sessions_with_ledger_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_root = tmp.path().join("projects");
        let ledger = Arc::new(
            SessionLedger::open_with_claude_root(
                tmp.path().join("sessions.db"),
                claude_root.clone(),
            )
            .unwrap(),
        );
        let (sup, ledger, mut rx) = make_supervisor_for_ledger(ledger, None);

        ledger
            .record_spawn("tug-row", "ws-1", "/proj/alpha", "c1", 9_000, None)
            .unwrap();
        ledger.mark_closed("tug-row").unwrap();
        seed_external_jsonl(&claude_root, "/proj/alpha", EXTERNAL_ID, "external prompt");

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_sessions",
            "project_dir": "/proj/alpha",
        }))
        .unwrap();
        sup.handle_control("list_sessions", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_list_sessions_settled(&mut rx).await;
        let sessions = response["sessions"].as_array().expect("sessions array");
        assert_eq!(sessions.len(), 2, "ledger row + external row: {response}");
        let by_id: std::collections::HashMap<&str, &serde_json::Value> = sessions
            .iter()
            .map(|s| (s["session_id"].as_str().unwrap(), s))
            .collect();
        let tug = by_id["tug-row"];
        assert_eq!(tug["origin"], "tug");
        assert_eq!(tug["terminal_live"], serde_json::Value::Null);
        let ext = by_id[EXTERNAL_ID];
        assert_eq!(ext["origin"], "external");
        assert_eq!(ext["state"], "closed");
        assert_eq!(ext["card_id"], serde_json::Value::Null);
        assert_eq!(ext["turn_count"], 1);
        assert_eq!(ext["last_user_prompt"], "external prompt");
        assert_eq!(ext["terminal_live"], serde_json::Value::Null);
        // Sorted newest-first: the external row's last_used_at is the
        // file's real mtime (now), which postdates the ledger row's
        // synthetic 9000ms-epoch timestamp.
        assert_eq!(sessions[0]["session_id"], EXTERNAL_ID);
        assert_eq!(sessions[1]["session_id"], "tug-row");
    }

    #[tokio::test]
    async fn list_sessions_scans_canonical_dir_for_symlinked_project_path() {
        // A project typed through a symlink alias (e.g. `/u/src/tugtool`)
        // must still find sessions: claude names its per-project
        // directory after the CANONICAL cwd, so the scan canonicalizes
        // the typed path before encoding.
        let tmp = tempfile::tempdir().unwrap();
        // Canonicalize the tempdir itself (`/var` → `/private/var` on
        // macOS) so the seeded encoding matches what the supervisor's
        // canonicalize resolves.
        let tmp_real = std::fs::canonicalize(tmp.path()).unwrap();
        let real_project = tmp_real.join("real-project");
        std::fs::create_dir_all(&real_project).unwrap();
        let alias = tmp_real.join("alias-project");
        std::os::unix::fs::symlink(&real_project, &alias).unwrap();

        let claude_root = tmp_real.join("projects");
        let ledger = Arc::new(
            SessionLedger::open_with_claude_root(tmp_real.join("sessions.db"), claude_root.clone())
                .unwrap(),
        );
        let (sup, _ledger, mut rx) = make_supervisor_for_ledger(ledger, None);
        let real_project_str = real_project.to_str().unwrap();
        seed_external_jsonl(&claude_root, real_project_str, EXTERNAL_ID, "via alias");

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_sessions",
            "project_dir": alias.to_str().unwrap(),
        }))
        .unwrap();
        sup.handle_control("list_sessions", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_list_sessions_settled(&mut rx).await;
        let sessions = response["sessions"].as_array().expect("sessions array");
        assert_eq!(
            sessions.len(),
            1,
            "alias query finds the canonical-dir session: {response}"
        );
        assert_eq!(sessions[0]["session_id"], EXTERNAL_ID);
        assert_eq!(sessions[0]["origin"], "external");
        // The row carries the canonical dir so downstream consumers
        // (trash) re-derive the JSONL location correctly.
        assert_eq!(sessions[0]["project_dir"], real_project_str);
    }

    #[tokio::test]
    async fn list_sessions_dedupes_by_session_id_ledger_wins() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_root = tmp.path().join("projects");
        let ledger = Arc::new(
            SessionLedger::open_with_claude_root(
                tmp.path().join("sessions.db"),
                claude_root.clone(),
            )
            .unwrap(),
        );
        let (sup, ledger, mut rx) = make_supervisor_for_ledger(ledger, None);

        // Same id on disk AND in the ledger — an adopted session.
        ledger
            .record_spawn(EXTERNAL_ID, "ws-1", "/proj/alpha", "c1", 9_000, None)
            .unwrap();
        ledger.mark_closed(EXTERNAL_ID).unwrap();
        seed_external_jsonl(&claude_root, "/proj/alpha", EXTERNAL_ID, "adopted");

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_sessions",
            "project_dir": "/proj/alpha",
        }))
        .unwrap();
        sup.handle_control("list_sessions", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_list_sessions_settled(&mut rx).await;
        let sessions = response["sessions"].as_array().expect("sessions array");
        assert_eq!(sessions.len(), 1, "deduped: {response}");
        assert_eq!(sessions[0]["origin"], "tug");
    }

    #[tokio::test]
    async fn list_sessions_merges_disk_content_into_sparse_ledger_row() {
        // A resumed external session leaves a ledger row that knows
        // lifecycle but not content (zero turns, no prompt). The union
        // must surface the transcript's content on that row instead of
        // letting the sparse row shadow it — a zero-turn row is hidden
        // by the picker, so without the merge the session vanishes.
        let tmp = tempfile::tempdir().unwrap();
        let claude_root = tmp.path().join("projects");
        let ledger = Arc::new(
            SessionLedger::open_with_claude_root(
                tmp.path().join("sessions.db"),
                claude_root.clone(),
            )
            .unwrap(),
        );
        let (sup, ledger, mut rx) = make_supervisor_for_ledger(ledger, None);

        seed_external_jsonl(&claude_root, "/proj/alpha", EXTERNAL_ID, "rich prompt");
        // Spawn with NO scan-cache row (cold ledger): the row is sparse.
        ledger
            .record_spawn(EXTERNAL_ID, "ws-1", "/proj/alpha", "c1", 9_000, None)
            .unwrap();
        ledger.mark_closed(EXTERNAL_ID).unwrap();
        {
            let row = ledger.get(EXTERNAL_ID).unwrap().unwrap();
            assert_eq!(row.turn_count, 0, "precondition: sparse ledger row");
            assert_eq!(row.last_user_prompt, None);
        }

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_sessions",
            "project_dir": "/proj/alpha",
        }))
        .unwrap();
        sup.handle_control("list_sessions", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_list_sessions_settled(&mut rx).await;
        let sessions = response["sessions"].as_array().expect("sessions array");
        assert_eq!(sessions.len(), 1, "still one row: {response}");
        let row = &sessions[0];
        assert_eq!(row["origin"], "tug", "ledger row keeps identity");
        assert_eq!(row["turn_count"], 1, "turn count absorbed from disk");
        assert_eq!(row["last_user_prompt"], "rich prompt");
        // The file's real mtime (now) postdates the synthetic 9000ms
        // ledger stamp, so the row also rides the fresher timestamp.
        assert!(
            row["last_used_at"].as_i64().unwrap() > 9_000,
            "fresher disk mtime surfaces: {row}"
        );
    }

    #[tokio::test]
    async fn list_sessions_annotates_terminal_live_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_root = tmp.path().join("projects");
        let registry_root = tmp.path().join("registry");
        std::fs::create_dir_all(&registry_root).unwrap();
        // A live registry entry for the external session, using the
        // test process's own (genuinely alive) pid. No procStart →
        // accepted fail-open.
        std::fs::write(
            registry_root.join("1.json"),
            format!(
                r#"{{"pid":{},"sessionId":"{EXTERNAL_ID}","status":"busy"}}"#,
                std::process::id()
            ),
        )
        .unwrap();
        let ledger = Arc::new(
            SessionLedger::open_with_claude_root(
                tmp.path().join("sessions.db"),
                claude_root.clone(),
            )
            .unwrap(),
        );
        let (sup, _ledger, mut rx) = make_supervisor_for_ledger(ledger, Some(registry_root));
        seed_external_jsonl(&claude_root, "/proj/alpha", EXTERNAL_ID, "held by terminal");

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_sessions",
            "project_dir": "/proj/alpha",
        }))
        .unwrap();
        sup.handle_control("list_sessions", &payload, 10)
            .await
            .expect_handled();

        let response = drain_until_list_sessions_settled(&mut rx).await;
        let sessions = response["sessions"].as_array().expect("sessions array");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["terminal_live"]["status"], "busy");
    }

    #[tokio::test]
    async fn list_sessions_missing_project_dir_errors() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();
        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "list_sessions",
        }))
        .unwrap();

        let err = sup
            .handle_control("list_sessions", &payload, 10)
            .await
            .expect_error();
        assert!(
            matches!(err, ControlError::InvalidProjectDir { reason } if reason == "missing_project_dir")
        );
    }

    #[tokio::test]
    async fn trash_session_drops_row_and_broadcasts_removed() {
        let (sup, ledger, mut rx) = make_supervisor_with_ledger();

        ledger
            .record_spawn("s1", "ws-1", "/p", "c1", 1_000, None)
            .unwrap();
        ledger.mark_closed("s1").unwrap();
        // Drain whatever the seed wrote.
        while rx.try_recv().is_ok() {}

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "trash_session",
            "session_id": "s1",
        }))
        .unwrap();
        sup.handle_control("trash_session", &payload, 10)
            .await
            .expect_handled();

        // session_updated push first, then trash_session_ok ack.
        let push = drain_until_action(&mut rx, "session_updated");
        assert_eq!(push["session_id"], "s1");
        assert_eq!(push["removed"], true);

        // The receiver was reset by drain_until_action consuming the push;
        // re-drain to find the ok frame.
        let ack = drain_until_action(&mut rx, "trash_session_ok");
        assert_eq!(ack["session_id"], "s1");
        assert!(ledger.get("s1").unwrap().is_none());
    }

    #[tokio::test]
    async fn trash_session_on_live_row_returns_error() {
        let (sup, ledger, mut rx) = make_supervisor_with_ledger();
        ledger
            .record_spawn("live1", "ws-1", "/p", "c1", 1_000, None)
            .unwrap();
        while rx.try_recv().is_ok() {}

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "trash_session",
            "session_id": "live1",
        }))
        .unwrap();
        sup.handle_control("trash_session", &payload, 10)
            .await
            .expect_handled();

        let err = drain_until_action(&mut rx, "trash_session_err");
        assert_eq!(err["session_id"], "live1");
        assert_eq!(err["reason"], "session_is_live");
        assert!(ledger.get("live1").unwrap().is_some(), "row retained");
    }

    #[tokio::test]
    async fn evict_for_workspace_emits_removed_pushes() {
        let (_sup, ledger, mut rx) = make_supervisor_with_ledger();

        // 21 closed rows in ws-1; cap eviction should drop the oldest.
        for i in 0..21 {
            let id = format!("s{i}");
            ledger
                .record_spawn(&id, "ws-1", "/p", "c", 1_000_000 - i as i64, None)
                .unwrap();
            ledger.mark_closed(&id).unwrap();
        }
        while rx.try_recv().is_ok() {}

        // Build a fresh recorder bound to the same ledger + the
        // supervisor's existing CONTROL channel — re-using the inline
        // recorder is harder than constructing a peer one for this case.
        // The supervisor's control_tx isn't directly exposed, so we
        // verify via the store's own recorder by triggering eviction.
        let fresh_recorder = LedgerSessionsRecorder::with_broadcast(
            Arc::clone(&ledger),
            // Re-create a control channel and a receiver that sees the
            // same broadcast — the receiver from `make_supervisor_with_ledger`
            // is wired to the supervisor's tx, not this fresh recorder.
            broadcast::channel::<Frame>(64).0,
        );
        // Drop the supervisor's rx; we don't use it here.
        drop(rx);
        // Listen on the fresh recorder's tx via a fresh subscriber.
        let mut local_rx = {
            let (tx, rx2) = broadcast::channel::<Frame>(64);
            // Replace fresh_recorder's control_tx with this fresh tx.
            let recorder_with_local_tx =
                LedgerSessionsRecorder::with_broadcast(Arc::clone(&ledger), tx);
            recorder_with_local_tx.evict_for_workspace_impl("ws-1", 20);
            rx2
        };
        // 21 → 20 = 1 evicted; expect exactly one removed push.
        let _ = fresh_recorder; // silence unused warning
        let mut removed_ids = Vec::new();
        while let Ok(frame) = local_rx.try_recv() {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&frame.payload) {
                if v.get("action").and_then(|a| a.as_str()) == Some("session_updated")
                    && v.get("removed").and_then(|r| r.as_bool()) == Some(true)
                {
                    if let Some(id) = v.get("session_id").and_then(|s| s.as_str()) {
                        removed_ids.push(id.to_owned());
                    }
                }
            }
        }
        assert_eq!(removed_ids.len(), 1);
        // The oldest closed row is s20 (we recorded with last_used_at =
        // 1_000_000 - i, so s20 has the smallest timestamp).
        assert_eq!(removed_ids[0], "s20");
    }

    #[tokio::test]
    async fn trash_project_dir_sessions_drops_matching_only() {
        let (sup, ledger, mut rx) = make_supervisor_with_ledger();

        ledger
            .record_spawn("matched-1", "ws-1", "/proj/x", "c1", 1_000, None)
            .unwrap();
        ledger.mark_closed("matched-1").unwrap();
        ledger
            .record_spawn("matched-2", "ws-1", "/proj/x", "c2", 2_000, None)
            .unwrap();
        ledger.mark_closed("matched-2").unwrap();
        // Different project_dir — survives.
        ledger
            .record_spawn("other", "ws-2", "/proj/y", "c3", 3_000, None)
            .unwrap();
        ledger.mark_closed("other").unwrap();
        while rx.try_recv().is_ok() {}

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "trash_project_dir_sessions",
            "project_dir": "/proj/x",
        }))
        .unwrap();
        sup.handle_control("trash_project_dir_sessions", &payload, 10)
            .await
            .expect_handled();

        let ack = drain_until_action(&mut rx, "trash_project_dir_sessions_ok");
        assert_eq!(ack["project_dir"], "/proj/x");
        assert_eq!(ack["count"], 2);

        assert!(ledger.get("matched-1").unwrap().is_none());
        assert!(ledger.get("matched-2").unwrap().is_none());
        assert!(ledger.get("other").unwrap().is_some(), "/proj/y untouched");
    }

    #[tokio::test]
    async fn recorder_writes_emit_session_updated_pushes() {
        // A `record` followed by a `record_turn` against the supervisor's
        // recorder must each emit a `session_updated` push on the same
        // CONTROL feed the picker subscribes to. Verifies the broadcast
        // pipeline wired up in `LedgerSessionsRecorder::with_broadcast`.
        let (sup, _ledger, mut rx) = make_supervisor_with_ledger();

        sup.sessions_recorder.record(SessionRecord {
            session_id: "s1",
            workspace_key: "ws-1",
            project_dir: "/p",
            card_id: "c1",
            tag: None,
        });
        let first = drain_until_action(&mut rx, "session_updated");
        assert_eq!(first["fields"]["turn_count"].as_i64(), Some(0));
        assert_eq!(first["fields"]["state"], "live");

        // record_turn touches recency and still broadcasts a push, but no
        // longer writes the count ([P08]) — so the pushed turn_count holds.
        sup.sessions_recorder.record_turn("s1");
        let second = drain_until_action(&mut rx, "session_updated");
        assert_eq!(second["fields"]["turn_count"].as_i64(), Some(0));
    }

    // ── Step 5.3 — merger intercept narrows to FIFO mark-seen ───────────────
    //
    // The merger calls `apply_outbound_turn_intercept(&session_id, &frame)`
    // on every CODE_OUTPUT frame after the wire-side broadcast. For
    // `turn_complete` / `turn_cancelled` frames, the intercept pops the
    // oldest pending row from the session's submission journal (FIFO
    // match by `created_at`). For other types, it's a no-op. The frame
    // is forwarded unchanged regardless. See [DM08] in the
    // mid-turn-replay plan.

    fn turn_complete_frame() -> Frame {
        // The merger reads only `msg_type` from outbound payloads
        // post-Step-5.3; the other fields are pinned-shape but unread.
        let body = serde_json::json!({
            "type": "turn_complete",
            "msg_id": "msg_01ABC",
            "seq": 3,
            "result": "",
            "ipc_version": 2,
        });
        Frame::new(FeedId::CODE_OUTPUT, serde_json::to_vec(&body).unwrap())
    }

    fn turn_cancelled_frame() -> Frame {
        let body = serde_json::json!({
            "type": "turn_cancelled",
            "msg_id": "msg_01XYZ",
            "seq": 4,
            "partial_result": "so far the assistant said...",
            "ipc_version": 2,
        });
        Frame::new(FeedId::CODE_OUTPUT, serde_json::to_vec(&body).unwrap())
    }

    fn seed_session_for_journal_test(ledger: &SessionLedger, id: &str) {
        // Insert a `live` row in `sessions` so the cascade trigger has a
        // parent to cascade from. The merger intercept itself does NOT
        // require a sessions row to be present (it operates on the
        // `turns` journal directly); seeding the parent here is for the
        // "cascade-delete when forgotten" test only.
        ledger
            .record_spawn(
                id,
                "ws-journal",
                "/proj/journal",
                "card-journal",
                crate::session_ledger::now_millis(),
                None,
            )
            .expect("seed session row");
    }

    fn count_pending_for_session(ledger: &SessionLedger, session_id: &str) -> usize {
        ledger
            .list_pending_turns_for_session(session_id)
            .expect("list pending")
            .len()
    }

    #[tokio::test]
    async fn merger_intercept_pops_journal_in_fifo_order_across_two_turns() {
        // Two pending submissions in flight; two turn_complete frames
        // arrive. The journal rows pop in created_at order (oldest first);
        // after both pops the journal for the session is empty.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-fifo";
        seed_session_for_journal_test(&ledger, session_id);

        // Insert two pending rows directly via the journal API (the
        // dispatcher's user_message intercept is exercised in a separate
        // test); use distinct created_at so FIFO order is unambiguous.
        ledger
            .insert_pending_turn(session_id, "j_oldest", "first", &[], 1_000)
            .unwrap();
        ledger
            .insert_pending_turn(session_id, "j_newer", "second", &[], 2_000)
            .unwrap();
        assert_eq!(count_pending_for_session(&ledger, session_id), 2);

        let frame = turn_complete_frame();
        sup.apply_outbound_turn_intercept(&TugSessionId::new(session_id), &frame);
        assert_eq!(count_pending_for_session(&ledger, session_id), 1);
        let remaining = ledger.list_pending_turns_for_session(session_id).unwrap();
        assert_eq!(
            remaining[0].journal_id, "j_newer",
            "FIFO: the oldest row pops first; the newer row remains",
        );

        let frame2 = turn_complete_frame();
        sup.apply_outbound_turn_intercept(&TugSessionId::new(session_id), &frame2);
        assert_eq!(count_pending_for_session(&ledger, session_id), 0);
    }

    #[tokio::test]
    async fn merger_intercept_handles_turn_cancelled_same_as_turn_complete() {
        // turn_cancelled also pops the oldest pending row — the journal
        // doesn't distinguish "claude finished" from "user cancelled"
        // because both land back at "no longer awaiting response".
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-cancel";
        seed_session_for_journal_test(&ledger, session_id);

        ledger
            .insert_pending_turn(session_id, "j_only", "submission", &[], 1_000)
            .unwrap();
        assert_eq!(count_pending_for_session(&ledger, session_id), 1);

        let frame = turn_cancelled_frame();
        sup.apply_outbound_turn_intercept(&TugSessionId::new(session_id), &frame);
        assert_eq!(count_pending_for_session(&ledger, session_id), 0);
    }

    #[tokio::test]
    async fn merger_intercept_no_op_on_unrelated_frame_type() {
        // assistant_text, tool_use, tool_result etc. don't pop the journal.
        // The journal pops only on the terminal `turn_complete` /
        // `turn_cancelled` frames that mark "claude has acknowledged".
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-unrelated";
        seed_session_for_journal_test(&ledger, session_id);

        ledger
            .insert_pending_turn(session_id, "j_keep", "should survive", &[], 1_000)
            .unwrap();

        let assistant_body = serde_json::json!({
            "type": "assistant_text",
            "msg_id": "msg_x",
            "seq": 1,
            "rev": 0,
            "text": "partial",
            "is_partial": true,
            "status": "partial",
            "ipc_version": 2,
        });
        let frame = Frame::new(
            FeedId::CODE_OUTPUT,
            serde_json::to_vec(&assistant_body).unwrap(),
        );
        sup.apply_outbound_turn_intercept(&TugSessionId::new(session_id), &frame);
        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            1,
            "assistant_text must not pop the journal; only turn_complete / turn_cancelled do",
        );
    }

    #[tokio::test]
    async fn merger_intercept_returns_none_when_journal_empty() {
        // Spurious turn_complete: claude responds for a session whose
        // journal has no pending rows (e.g., a resume picking up
        // mid-stream where the dispatcher never saw the user_message).
        // The intercept calls delete_oldest_pending_for_session which
        // returns Ok(None); a warn fires; the frame is forwarded
        // unchanged at the merger task level (this test exercises the
        // intercept directly so we just assert the no-throw + journal
        // stays empty).
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-spurious";
        seed_session_for_journal_test(&ledger, session_id);
        assert_eq!(count_pending_for_session(&ledger, session_id), 0);

        let frame = turn_complete_frame();
        // Should not panic; intercept handles None gracefully.
        sup.apply_outbound_turn_intercept(&TugSessionId::new(session_id), &frame);
        assert_eq!(count_pending_for_session(&ledger, session_id), 0);
    }

    #[tokio::test]
    async fn merger_intercept_isolates_per_session() {
        // Pending row in session A; turn_complete arrives for session B.
        // Session A's row must be untouched.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        seed_session_for_journal_test(&ledger, "sess-a");
        seed_session_for_journal_test(&ledger, "sess-b");

        ledger
            .insert_pending_turn("sess-a", "j_a", "for sess-a", &[], 1_000)
            .unwrap();

        let frame = turn_complete_frame();
        sup.apply_outbound_turn_intercept(&TugSessionId::new("sess-b"), &frame);

        assert_eq!(
            count_pending_for_session(&ledger, "sess-a"),
            1,
            "session A's pending row must survive when session B emits turn_complete",
        );
        assert_eq!(count_pending_for_session(&ledger, "sess-b"), 0);
    }

    #[tokio::test]
    async fn cascade_trigger_purges_journal_when_session_forgotten() {
        // Pending row outlives session: insert journal row, then trash
        // the session. The cascade trigger purges the journal row.
        let (_sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-cascade";
        seed_session_for_journal_test(&ledger, session_id);

        // Mark closed first (trash refuses live rows by design).
        ledger.mark_closed(session_id).unwrap();
        ledger
            .insert_pending_turn(session_id, "j_orphan", "outlives session", &[], 1_000)
            .unwrap();
        assert_eq!(count_pending_for_session(&ledger, session_id), 1);

        ledger.trash(session_id).unwrap();

        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            0,
            "cascade trigger must purge journal rows when the parent session is forgotten",
        );
    }

    #[tokio::test]
    async fn dispatch_one_inserts_journal_row_without_augmenting_frame() {
        // Step 5.3 invariant: the dispatcher's user_message intercept
        // mints a journal id, persists the row, and forwards the frame
        // UNCHANGED (no `tug_turn_id` field stamped onto the wire). The
        // forwarded frame's bytes equal the input frame's bytes.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id_str = "sess-dispatch";
        let tug_session_id = TugSessionId::new(session_id_str);

        // The dispatcher requires an entry in the supervisor's per-session
        // map (the `Some(entry_arc)` branch). The `Idle` state queues the
        // frame rather than spawning a real worker (the test's
        // stall_spawner_factory wouldn't run anyway).
        let entry_arc = insert_ledger_entry(&sup, &tug_session_id).await;
        seed_session_for_journal_test(&ledger, session_id_str);

        let body = serde_json::json!({
            "tug_session_id": session_id_str,
            "type": "user_message",
            "text": "hello",
            "attachments": [],
        });
        let original_payload = serde_json::to_vec(&body).unwrap();
        let frame = Frame::new(FeedId::CODE_INPUT, original_payload.clone());

        sup.dispatch_one(frame).await;

        // A journal row landed for this session, sourced from the
        // payload's `text` and `attachments` fields.
        let rows = ledger
            .list_pending_turns_for_session(session_id_str)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].user_text, "hello");
        assert!(rows[0].user_attachments.is_empty());

        // Pop the queued frame and assert its payload is byte-identical
        // to the input — the dispatcher does NOT augment the wire.
        let mut entry = entry_arc.lock().await;
        let queued = entry.queue.pop().expect("frame queued");
        assert_eq!(
            queued.payload, original_payload,
            "dispatcher must forward user_message frames unchanged (Step 5.3 wire invariant)",
        );
    }

    #[tokio::test]
    async fn dispatch_one_derives_journal_row_from_content_blocks() {
        // Step 5c invariant: a `user_message` payload carrying
        // Anthropic-API `content` blocks (post-Step-5c wire shape)
        // produces a journal row whose `user_text` is the concatenation
        // of text-block contents and `user_attachments` is one
        // wire-shape Attachment JSON per image block (filename: "",
        // media_type + content sourced from the block). The frame
        // forwards unchanged.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id_str = "sess-content-blocks";
        let tug_session_id = TugSessionId::new(session_id_str);

        let entry_arc = insert_ledger_entry(&sup, &tug_session_id).await;
        seed_session_for_journal_test(&ledger, session_id_str);

        // Interleaved content blocks (text, image, text) — the shape
        // tugdeck's `buildWirePayload` emits at submit time.
        let body = serde_json::json!({
            "tug_session_id": session_id_str,
            "type": "user_message",
            "content": [
                {"type": "text", "text": "describe "},
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": "PNG-DATA",
                    },
                },
                {"type": "text", "text": " this"},
            ],
        });
        let original_payload = serde_json::to_vec(&body).unwrap();
        let frame = Frame::new(FeedId::CODE_INPUT, original_payload.clone());

        sup.dispatch_one(frame).await;

        // Journal row landed with the derived legacy view: text-block
        // contents concatenated; image block reshaped to wire-shape
        // Attachment with filename: "".
        let rows = ledger
            .list_pending_turns_for_session(session_id_str)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].user_text, "describe  this");
        // user_attachments is decoded by the ledger reader into a
        // Vec<serde_json::Value> — each entry is one wire-shape
        // Attachment object derived from an image content block.
        let atts = &rows[0].user_attachments;
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0]["filename"], "");
        assert_eq!(atts[0]["media_type"], "image/png");
        assert_eq!(atts[0]["content"], "PNG-DATA");

        // Forwarded frame is byte-identical to the input — the
        // dispatcher reads the derived view for the journal but
        // forwards the raw content-block payload to tugcode unchanged.
        let mut entry = entry_arc.lock().await;
        let queued = entry.queue.pop().expect("frame queued");
        assert_eq!(
            queued.payload, original_payload,
            "dispatcher must forward content-block user_message frames unchanged (Step 5c)",
        );
    }

    // ── Step 5.10 — replay-bracket gate on the journal-pop intercept ─────────
    //
    // The merger's `process_outbound_frame_journal_gate` tracks per-session
    // `replay_brackets_open` from `replay_started` / `replay_complete` markers
    // and skips `apply_outbound_turn_intercept` while the counter is non-zero.
    // Without the gate, replay-emitted committed-turn `turn_complete`s pop
    // the user's still-pending journal row (the HMR-mid-stream regression
    // surfaced in the [Step 5](roadmap/tugplan-dev-mid-turn-replay.md#step-5)
    // close-out manual smoke).
    //
    // Counter (not bool) is defense-in-depth: a stray `replay_complete` on
    // a closed bracket is a saturating-decrement no-op, not an underflow
    // that re-opens the gate. tugcode's `runReplay` re-entrancy guard
    // prevents legitimate overlapping brackets, so in healthy operation
    // the counter is 0 between brackets and 1 during a bracket. The
    // bridge-respawn reset in `spawn_session_worker` clears the counter
    // back to 0 if a previous bridge died after `replay_started` but
    // before `replay_complete` — a stuck-non-zero counter would otherwise
    // make the new bridge's brackets nest into the stale outer bracket
    // and the gate would skip live `turn_complete`s indefinitely.

    fn replay_started_frame() -> Frame {
        let body = serde_json::json!({
            "type": "replay_started",
            "ipc_version": 2,
        });
        Frame::new(FeedId::CODE_OUTPUT, serde_json::to_vec(&body).unwrap())
    }

    fn replay_complete_frame() -> Frame {
        let body = serde_json::json!({
            "type": "replay_complete",
            "count": 1,
            "ipc_version": 2,
        });
        Frame::new(FeedId::CODE_OUTPUT, serde_json::to_vec(&body).unwrap())
    }

    #[tokio::test]
    async fn journal_gate_increments_bracket_counter_on_replay_started() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-bracket-open";
        let tug_session_id = TugSessionId::new(session_id);
        insert_ledger_entry(&sup, &tug_session_id).await;

        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_started_frame())
            .await;

        let entry_arc = sup
            .ledger
            .lock()
            .await
            .get(&tug_session_id)
            .cloned()
            .expect("entry exists");
        assert_eq!(
            entry_arc.lock().await.replay_brackets_open,
            1,
            "replay_started must increment the bracket counter to 1",
        );
    }

    #[tokio::test]
    async fn journal_gate_decrements_bracket_counter_on_replay_complete() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-bracket-close";
        let tug_session_id = TugSessionId::new(session_id);
        let entry_arc = insert_ledger_entry(&sup, &tug_session_id).await;
        // Seed counter = 1 (as if a replay had opened).
        entry_arc.lock().await.replay_brackets_open = 1;

        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_complete_frame())
            .await;

        assert_eq!(
            entry_arc.lock().await.replay_brackets_open,
            0,
            "replay_complete must decrement the bracket counter to 0",
        );
    }

    #[tokio::test]
    async fn journal_gate_replay_complete_at_zero_saturates_no_underflow() {
        // Defensive: a stray replay_complete on a closed bracket
        // (counter already 0) must NOT underflow into u32::MAX. The
        // saturating_sub keeps it at 0; subsequent live turn_completes
        // continue to pop the journal as normal.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-bracket-saturate";
        let tug_session_id = TugSessionId::new(session_id);
        let entry_arc = insert_ledger_entry(&sup, &tug_session_id).await;
        seed_session_for_journal_test(&ledger, session_id);
        ledger
            .insert_pending_turn(session_id, "j-saturate", "stay alive", &[], 1_000)
            .unwrap();

        // Counter starts at 0 (fresh entry).
        assert_eq!(entry_arc.lock().await.replay_brackets_open, 0);

        // Stray replay_complete: counter must clamp at 0.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_complete_frame())
            .await;
        assert_eq!(
            entry_arc.lock().await.replay_brackets_open,
            0,
            "saturating_sub at 0 must clamp; not underflow into u32::MAX",
        );

        // Live turn_complete now arrives. Gate is open (counter == 0);
        // intercept must fire and pop the row.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &turn_complete_frame())
            .await;
        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            0,
            "live turn_complete after a stray replay_complete must still pop the journal row",
        );
    }

    #[tokio::test]
    async fn journal_gate_stuck_nonzero_counter_is_reset_on_bridge_respawn() {
        // Stuck-non-zero scenario: a previous bridge emitted
        // `replay_started` (counter -> 1) but died before emitting
        // `replay_complete` (kill -9, panic, OOM before runReplay's
        // finally block ran). Without a reset on bridge respawn, the
        // counter stays at 1 forever, and every future live
        // `turn_complete` would skip the journal-pop intercept —
        // silently breaking the never-drop guarantee for all subsequent
        // submissions on this session.
        //
        // `spawn_session_worker` resets `replay_brackets_open = 0`
        // whenever a fresh bridge is wired up. This test simulates the
        // crash by manually setting the counter to a stuck value, then
        // observes that a `process_outbound_frame_journal_gate` on a
        // live `turn_complete` post-reset correctly pops the journal.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-stuck-counter";
        let tug_session_id = TugSessionId::new(session_id);
        let entry_arc = insert_ledger_entry(&sup, &tug_session_id).await;
        seed_session_for_journal_test(&ledger, session_id);
        ledger
            .insert_pending_turn(session_id, "j-stuck", "should still pop", &[], 1_000)
            .unwrap();

        // Simulate a stuck-non-zero counter from a prior bridge that
        // crashed mid-replay. The exact value doesn't matter — anything
        // > 0 leaves the gate skipping intercepts.
        entry_arc.lock().await.replay_brackets_open = 3;

        // While stuck, a turn_complete is skipped — pin this so the
        // reset is the only way to recover.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &turn_complete_frame())
            .await;
        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            1,
            "stuck-non-zero counter must skip intercept (no reset yet)",
        );

        // Bridge respawn resets the counter. We replicate the field
        // mutation `spawn_session_worker` performs without invoking the
        // full spawn path (which requires an actual subprocess).
        entry_arc.lock().await.replay_brackets_open = 0;

        // Post-reset, a live turn_complete pops the journal as normal.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &turn_complete_frame())
            .await;
        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            0,
            "post-respawn-reset, live turn_complete pops the row",
        );
    }

    #[tokio::test]
    async fn journal_gate_nested_brackets_open_count_correctly() {
        // tugcode's runReplay re-entrancy guard prevents legitimate
        // overlapping brackets in production, but the counter shape
        // tolerates them defensively. Two replay_started markers leave
        // the counter at 2; one replay_complete decrements to 1 (still
        // gating); the second decrements to 0 (gate opens).
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-nested";
        let tug_session_id = TugSessionId::new(session_id);
        let entry_arc = insert_ledger_entry(&sup, &tug_session_id).await;
        seed_session_for_journal_test(&ledger, session_id);
        ledger
            .insert_pending_turn(session_id, "j-nested", "nested test", &[], 1_000)
            .unwrap();

        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_started_frame())
            .await;
        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_started_frame())
            .await;
        assert_eq!(entry_arc.lock().await.replay_brackets_open, 2);

        // First replay_complete: counter -> 1, still gating.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_complete_frame())
            .await;
        assert_eq!(entry_arc.lock().await.replay_brackets_open, 1);
        sup.process_outbound_frame_journal_gate(&tug_session_id, &turn_complete_frame())
            .await;
        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            1,
            "turn_complete inside the still-open outer bracket must NOT pop",
        );

        // Second replay_complete: counter -> 0, gate opens.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_complete_frame())
            .await;
        assert_eq!(entry_arc.lock().await.replay_brackets_open, 0);
        sup.process_outbound_frame_journal_gate(&tug_session_id, &turn_complete_frame())
            .await;
        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            0,
            "turn_complete after both brackets close must pop",
        );
    }

    #[tokio::test]
    async fn journal_gate_skips_intercept_for_turn_complete_inside_replay_bracket() {
        // The HMR-mid-stream regression: replay's committed-turn
        // turn_complete frames must NOT pop the user's pending journal
        // row (which is the user's still-inflight submission claude
        // hasn't yet finished).
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-bracket-skip";
        let tug_session_id = TugSessionId::new(session_id);
        insert_ledger_entry(&sup, &tug_session_id).await;
        seed_session_for_journal_test(&ledger, session_id);

        // Insert a pending journal row for the user's still-inflight submission.
        ledger
            .insert_pending_turn(session_id, "j-inflight", "still pending", &[], 1_000)
            .unwrap();
        assert_eq!(count_pending_for_session(&ledger, session_id), 1);

        // Open the replay bracket.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_started_frame())
            .await;

        // Replay emits a committed-turn turn_complete (claude's id, not
        // the user's pending journal id). Without the bracket gate this
        // would pop the user's pending row via FIFO.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &turn_complete_frame())
            .await;

        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            1,
            "replay-emitted turn_complete inside the bracket must NOT pop the pending journal row",
        );

        // Close the bracket.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &replay_complete_frame())
            .await;

        // Now the live turn_complete (claude's actual ack of the inflight
        // submission) arrives. The bracket is closed, so the intercept
        // fires and pops the row.
        sup.process_outbound_frame_journal_gate(&tug_session_id, &turn_complete_frame())
            .await;

        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            0,
            "live turn_complete after the bracket closes must pop the pending journal row",
        );
    }

    #[tokio::test]
    async fn journal_gate_unrelated_frames_are_pass_through() {
        // Non-bracket / non-terminal frames don't touch the journal or
        // the replay flag. assistant_text, system_metadata, etc. flow
        // through untouched by the gate.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let session_id = "sess-bracket-passthrough";
        let tug_session_id = TugSessionId::new(session_id);
        insert_ledger_entry(&sup, &tug_session_id).await;
        seed_session_for_journal_test(&ledger, session_id);
        ledger
            .insert_pending_turn(session_id, "j-keep", "keep me", &[], 1_000)
            .unwrap();

        let assistant_body = serde_json::json!({
            "type": "assistant_text",
            "msg_id": "msg_x",
            "seq": 1,
            "rev": 0,
            "text": "partial",
            "is_partial": true,
            "status": "partial",
            "ipc_version": 2,
        });
        let frame = Frame::new(
            FeedId::CODE_OUTPUT,
            serde_json::to_vec(&assistant_body).unwrap(),
        );
        sup.process_outbound_frame_journal_gate(&tug_session_id, &frame)
            .await;

        let entry_arc = sup
            .ledger
            .lock()
            .await
            .get(&tug_session_id)
            .cloned()
            .unwrap();
        assert_eq!(
            entry_arc.lock().await.replay_brackets_open,
            0,
            "assistant_text must not touch the bracket counter",
        );
        assert_eq!(
            count_pending_for_session(&ledger, session_id),
            1,
            "assistant_text must not pop the journal",
        );
    }

    #[tokio::test]
    async fn journal_gate_per_session_isolation_for_replay_state() {
        // Replay bracket on session A must not affect session B's
        // intercept. Two independent replays could run concurrently;
        // their per-session flags must be tracked separately.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let tug_a = TugSessionId::new("sess-a");
        let tug_b = TugSessionId::new("sess-b");
        insert_ledger_entry(&sup, &tug_a).await;
        insert_ledger_entry(&sup, &tug_b).await;
        seed_session_for_journal_test(&ledger, "sess-a");
        seed_session_for_journal_test(&ledger, "sess-b");

        ledger
            .insert_pending_turn("sess-a", "j-a", "for sess-a", &[], 1_000)
            .unwrap();
        ledger
            .insert_pending_turn("sess-b", "j-b", "for sess-b", &[], 1_000)
            .unwrap();

        // Open the bracket on session A only.
        sup.process_outbound_frame_journal_gate(&tug_a, &replay_started_frame())
            .await;

        // turn_complete on session B should pop B's row (B is NOT in a replay bracket).
        sup.process_outbound_frame_journal_gate(&tug_b, &turn_complete_frame())
            .await;

        assert_eq!(count_pending_for_session(&ledger, "sess-a"), 1);
        assert_eq!(
            count_pending_for_session(&ledger, "sess-b"),
            0,
            "session B's bracket flag stays false; its turn_complete pops as normal",
        );
    }

    // -------------------------------------------------------------------
    // record_turn_telemetry — CONTROL action → SessionLedger round-trip
    // -------------------------------------------------------------------

    fn record_turn_telemetry_payload(
        tug_session_id: &str,
        msg_id: &str,
        total_cost_usd: f64,
    ) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "record_turn_telemetry",
            "tug_session_id": tug_session_id,
            "msg_id": msg_id,
            "telemetry": {
                "cost": {
                    "inputTokens": 100,
                    "outputTokens": 50,
                    "cacheCreationInputTokens": 10,
                    "cacheReadInputTokens": 20,
                    "totalCostUsd": total_cost_usd,
                },
                "wallClockMs": 4_000,
                "awaitingApprovalMs": 200,
                "transportDowntimeMs": 100,
                "activeMs": 3_700,
                "ttftMs": 150,
                "ttftcMs": 300,
                "reconnectCount": 0,
                "maxStreamGapMs": 90,
            },
            "ended_at": 1_000,
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn record_turn_telemetry_writes_row_to_ledger() {
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let tug_id = TugSessionId::new("sess-tel-1");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;

        // Bind a claude session id; the ledger writes need this since
        // it's the row PK on the sqlite side. Also seed the sessions
        // row so the cascade trigger has something to anchor.
        {
            let mut entry = entry_arc.lock().await;
            entry.claude_session_id = Some("claude-A".to_string());
        }
        ledger
            .record_spawn("claude-A", "ws-1", "/proj/x", "card-1", 1_000, None)
            .unwrap();

        let outcome = sup
            .handle_control(
                "record_turn_telemetry",
                &record_turn_telemetry_payload("sess-tel-1", "msg-A", 0.0123),
                10,
            )
            .await;
        assert!(matches!(outcome, ControlOutcome::Handled));

        let rows = ledger.list_turn_telemetry("claude-A").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].msg_id, "msg-A");
        assert_eq!(rows[0].total_cost_usd, 0.0123);
        assert_eq!(rows[0].input_tokens, 100);
        assert_eq!(rows[0].wall_clock_ms, 4_000);
        assert_eq!(rows[0].active_ms, 3_700);
        assert_eq!(rows[0].ttft_ms, Some(150));
    }

    #[tokio::test]
    async fn record_turn_telemetry_overwrites_existing_row_for_same_pk() {
        // A reconnecting client may re-emit the same `record_turn_telemetry`
        // for an already-persisted (session_id, msg_id). The ledger's
        // `INSERT OR REPLACE` makes the repeat a no-op write — same
        // values overwriting same values, not a duplicate-key error.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let tug_id = TugSessionId::new("sess-tel-2");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.claude_session_id = Some("claude-B".to_string());
        }
        ledger
            .record_spawn("claude-B", "ws-1", "/proj/x", "card-2", 1_000, None)
            .unwrap();

        sup.handle_control(
            "record_turn_telemetry",
            &record_turn_telemetry_payload("sess-tel-2", "msg-A", 0.0123),
            10,
        )
        .await;
        sup.handle_control(
            "record_turn_telemetry",
            &record_turn_telemetry_payload("sess-tel-2", "msg-A", 9.99),
            10,
        )
        .await;

        let rows = ledger.list_turn_telemetry("claude-B").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].total_cost_usd, 9.99);
    }

    #[tokio::test]
    async fn record_turn_telemetry_silently_skips_when_session_not_found() {
        // The session was already evicted, never spawned through this
        // supervisor, or never had `session_init` complete. The handler
        // logs and drops — no write, no error frame, no panic.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();

        let outcome = sup
            .handle_control(
                "record_turn_telemetry",
                &record_turn_telemetry_payload("sess-unknown", "msg-A", 0.0123),
                10,
            )
            .await;
        assert!(matches!(outcome, ControlOutcome::Handled));

        // No row should exist for any session.
        let rows = ledger.list_turn_telemetry("claude-anything").unwrap();
        assert_eq!(rows.len(), 0);
    }

    #[tokio::test]
    async fn record_turn_telemetry_rejects_malformed_payload() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();

        let outcome = sup
            .handle_control("record_turn_telemetry", b"not json", 10)
            .await;
        assert!(matches!(outcome, ControlOutcome::Error(_)));
    }

    #[tokio::test]
    async fn record_turn_telemetry_rejects_missing_msg_id() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();

        let payload = serde_json::to_vec(&serde_json::json!({
            "action": "record_turn_telemetry",
            "tug_session_id": "sess-x",
            "telemetry": { "cost": {} },
            "ended_at": 1_000,
        }))
        .unwrap();

        let outcome = sup
            .handle_control("record_turn_telemetry", &payload, 10)
            .await;
        assert!(matches!(outcome, ControlOutcome::Error(_)));
    }

    // -------------------------------------------------------------------
    // record_context_breakdown — CONTROL action → SessionLedger round-trip
    // -------------------------------------------------------------------

    fn record_context_breakdown_payload(
        tug_session_id: &str,
        messages_tokens: i64,
        autocompact_enabled: bool,
    ) -> Vec<u8> {
        let mut categories = vec![
            serde_json::json!({ "id": "system_prompt", "label": "System prompt", "tokens": 3_500 }),
            serde_json::json!({ "id": "messages",      "label": "Messages",      "tokens": messages_tokens }),
        ];
        if autocompact_enabled {
            categories.push(serde_json::json!({
                "id": "autocompact_buffer",
                "label": "Autocompact buffer",
                "tokens": 33_000,
            }));
        }
        serde_json::to_vec(&serde_json::json!({
            "action": "record_context_breakdown",
            "tug_session_id": tug_session_id,
            "payload": {
                "context_max": 200_000,
                "categories": categories,
            },
            "captured_at": 5_000,
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn record_context_breakdown_writes_row_to_ledger() {
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let tug_id = TugSessionId::new("sess-ctx-1");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.claude_session_id = Some("claude-ctx-A".to_string());
        }
        ledger
            .record_spawn("claude-ctx-A", "ws-1", "/proj/x", "card-1", 1_000, None)
            .unwrap();

        let outcome = sup
            .handle_control(
                "record_context_breakdown",
                &record_context_breakdown_payload("sess-ctx-1", 12_000, false),
                10,
            )
            .await;
        assert!(matches!(outcome, ControlOutcome::Handled));

        let row = ledger.get_context_breakdown("claude-ctx-A").unwrap();
        assert!(row.is_some(), "ledger row should be present after persist");
        let row = row.unwrap();
        assert_eq!(row.captured_at, 5_000);
        // The persisted payload is the wire-frame body (context_max +
        // categories). Re-parse and check structure.
        let parsed: serde_json::Value = serde_json::from_slice(&row.payload).unwrap();
        assert_eq!(parsed["context_max"], 200_000);
        assert!(parsed["categories"].is_array());
        let cats = parsed["categories"].as_array().unwrap();
        assert_eq!(cats.len(), 2);
        assert_eq!(cats[1]["id"], "messages");
        assert_eq!(cats[1]["tokens"], 12_000);
    }

    #[tokio::test]
    async fn record_context_breakdown_upserts_on_repeat() {
        // Repeat writes for the same session must overwrite, not pile
        // on. The popover always reads the most recent row; an older
        // row hanging around would mean stale data on a fresh bind.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let tug_id = TugSessionId::new("sess-ctx-2");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.claude_session_id = Some("claude-ctx-B".to_string());
        }
        ledger
            .record_spawn("claude-ctx-B", "ws-1", "/proj/x", "card-2", 1_000, None)
            .unwrap();

        sup.handle_control(
            "record_context_breakdown",
            &record_context_breakdown_payload("sess-ctx-2", 1_000, false),
            10,
        )
        .await;
        sup.handle_control(
            "record_context_breakdown",
            &record_context_breakdown_payload("sess-ctx-2", 99_000, true),
            10,
        )
        .await;

        let row = ledger
            .get_context_breakdown("claude-ctx-B")
            .unwrap()
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&row.payload).unwrap();
        let cats = parsed["categories"].as_array().unwrap();
        // Second write wins.
        let messages = cats
            .iter()
            .find(|c| c["id"] == "messages")
            .expect("messages category present");
        assert_eq!(messages["tokens"], 99_000);
        assert!(
            cats.iter().any(|c| c["id"] == "autocompact_buffer"),
            "autocompact_buffer present in second write",
        );
    }

    #[tokio::test]
    async fn record_context_breakdown_silently_skips_when_session_not_found() {
        let (sup, ledger, _rx) = make_supervisor_with_ledger();

        let outcome = sup
            .handle_control(
                "record_context_breakdown",
                &record_context_breakdown_payload("sess-unknown", 1_000, false),
                10,
            )
            .await;
        assert!(matches!(outcome, ControlOutcome::Handled));

        // No row was written.
        assert!(
            ledger
                .get_context_breakdown("claude-anything")
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn record_context_breakdown_rejects_malformed_payload() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();

        let outcome = sup
            .handle_control("record_context_breakdown", b"not json", 10)
            .await;
        assert!(matches!(outcome, ControlOutcome::Error(_)));
    }

    #[tokio::test]
    async fn record_context_breakdown_rejects_missing_payload_field() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();
        let body = serde_json::to_vec(&serde_json::json!({
            "action": "record_context_breakdown",
            "tug_session_id": "sess-x",
            "captured_at": 1_000,
        }))
        .unwrap();
        let outcome = sup
            .handle_control("record_context_breakdown", &body, 10)
            .await;
        assert!(matches!(outcome, ControlOutcome::Error(_)));
    }

    #[tokio::test]
    async fn record_context_breakdown_rejects_payload_that_is_not_an_object() {
        // The CONTROL frame's `payload` sub-field must be a JSON
        // object — the supervisor stores it verbatim and the bind-
        // attach side expects to be able to splice an outer wrapper
        // by trimming the leading `{`.
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();
        let body = serde_json::to_vec(&serde_json::json!({
            "action": "record_context_breakdown",
            "tug_session_id": "sess-x",
            "payload": "not-an-object",
            "captured_at": 1_000,
        }))
        .unwrap();
        let outcome = sup
            .handle_control("record_context_breakdown", &body, 10)
            .await;
        assert!(matches!(outcome, ControlOutcome::Error(_)));
    }

    // -------------------------------------------------------------------
    // record_session_state_change + list_session_state_changes — CONTROL
    // actions → SessionLedger round-trip
    // -------------------------------------------------------------------

    fn record_state_change_payload(
        tug_session_id: &str,
        at_ms: i64,
        phase: &str,
        transport_state: &str,
        interrupt_in_flight: bool,
    ) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "record_session_state_change",
            "tug_session_id": tug_session_id,
            "at_ms": at_ms,
            "phase": phase,
            "transport_state": transport_state,
            "interrupt_in_flight": interrupt_in_flight,
        }))
        .unwrap()
    }

    fn list_state_changes_payload(tug_session_id: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "action": "list_session_state_changes",
            "tug_session_id": tug_session_id,
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn record_session_state_change_writes_rows_to_ledger() {
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let tug_id = TugSessionId::new("sess-ssc-1");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.claude_session_id = Some("claude-ssc-A".to_string());
        }
        ledger
            .record_spawn("claude-ssc-A", "ws-1", "/proj/x", "card-1", 1_000, None)
            .unwrap();

        sup.handle_control(
            "record_session_state_change",
            &record_state_change_payload("sess-ssc-1", 100, "idle", "online", false),
            10,
        )
        .await
        .expect_handled();
        sup.handle_control(
            "record_session_state_change",
            &record_state_change_payload("sess-ssc-1", 200, "submitting", "online", false),
            10,
        )
        .await
        .expect_handled();
        sup.handle_control(
            "record_session_state_change",
            &record_state_change_payload("sess-ssc-1", 300, "submitting", "offline", true),
            10,
        )
        .await
        .expect_handled();

        let rows = ledger.list_session_state_changes("claude-ssc-A").unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].phase, "idle");
        assert_eq!(rows[1].phase, "submitting");
        assert_eq!(rows[2].transport_state, "offline");
        assert!(rows[2].interrupt_in_flight);
    }

    #[tokio::test]
    async fn record_session_state_change_dedupes_at_ledger_layer() {
        // Even if the supervisor receives two writes of the same triple
        // (e.g., a racing dispatch beat the client-side compare), the
        // ledger layer dedupes and only one row lands.
        let (sup, ledger, _rx) = make_supervisor_with_ledger();
        let tug_id = TugSessionId::new("sess-ssc-2");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.claude_session_id = Some("claude-ssc-B".to_string());
        }
        ledger
            .record_spawn("claude-ssc-B", "ws-1", "/proj/x", "card-2", 1_000, None)
            .unwrap();

        sup.handle_control(
            "record_session_state_change",
            &record_state_change_payload("sess-ssc-2", 100, "idle", "online", false),
            10,
        )
        .await
        .expect_handled();
        sup.handle_control(
            "record_session_state_change",
            &record_state_change_payload("sess-ssc-2", 200, "idle", "online", false),
            10,
        )
        .await
        .expect_handled();

        let rows = ledger.list_session_state_changes("claude-ssc-B").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].at_ms, 100);
    }

    #[tokio::test]
    async fn record_session_state_change_silently_skips_when_session_not_found() {
        let (sup, ledger, _rx) = make_supervisor_with_ledger();

        sup.handle_control(
            "record_session_state_change",
            &record_state_change_payload("sess-unknown", 100, "idle", "online", false),
            10,
        )
        .await
        .expect_handled();

        assert_eq!(
            ledger
                .list_session_state_changes("claude-anything")
                .unwrap()
                .len(),
            0
        );
    }

    #[tokio::test]
    async fn record_session_state_change_rejects_malformed_payload() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();
        let outcome = sup
            .handle_control("record_session_state_change", b"not json", 10)
            .await;
        assert!(matches!(outcome, ControlOutcome::Error(_)));
    }

    #[tokio::test]
    async fn record_session_state_change_rejects_missing_axis() {
        // Missing `transport_state` — the parser must reject; the writer
        // can't fall back to a default because the triple is the row's
        // semantic identity.
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();
        let body = serde_json::to_vec(&serde_json::json!({
            "action": "record_session_state_change",
            "tug_session_id": "sess-x",
            "at_ms": 100,
            "phase": "idle",
            "interrupt_in_flight": false,
        }))
        .unwrap();
        let outcome = sup
            .handle_control("record_session_state_change", &body, 10)
            .await;
        assert!(matches!(outcome, ControlOutcome::Error(_)));
    }

    #[tokio::test]
    async fn list_session_state_changes_returns_rows_oldest_first() {
        let (sup, ledger, mut rx) = make_supervisor_with_ledger();
        let tug_id = TugSessionId::new("sess-ssc-list");
        let entry_arc = insert_ledger_entry(&sup, &tug_id).await;
        {
            let mut entry = entry_arc.lock().await;
            entry.claude_session_id = Some("claude-ssc-L".to_string());
        }
        ledger
            .record_spawn("claude-ssc-L", "ws-1", "/proj/x", "card-3", 1_000, None)
            .unwrap();
        ledger
            .record_session_state_change("claude-ssc-L", 100, "idle", "online", false)
            .unwrap();
        ledger
            .record_session_state_change("claude-ssc-L", 200, "submitting", "online", false)
            .unwrap();
        ledger
            .record_session_state_change("claude-ssc-L", 300, "tool_work", "online", false)
            .unwrap();

        while rx.try_recv().is_ok() {}

        sup.handle_control(
            "list_session_state_changes",
            &list_state_changes_payload("sess-ssc-list"),
            10,
        )
        .await
        .expect_handled();

        let response = drain_until_action(&mut rx, "list_session_state_changes_ok");
        assert_eq!(response["tug_session_id"], "sess-ssc-list");
        let rows = response["rows"].as_array().expect("rows array");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["phase"], "idle");
        assert_eq!(rows[0]["at_ms"], 100);
        assert_eq!(rows[1]["phase"], "submitting");
        assert_eq!(rows[2]["phase"], "tool_work");
        assert_eq!(rows[0]["transport_state"], "online");
        assert_eq!(rows[0]["interrupt_in_flight"], false);
    }

    #[tokio::test]
    async fn list_session_state_changes_returns_empty_array_for_unknown_session() {
        // Unknown session id surfaces as an empty array, not an error
        // frame: the client renders the same "no history yet" state for
        // either case.
        let (sup, _ledger, mut rx) = make_supervisor_with_ledger();

        sup.handle_control(
            "list_session_state_changes",
            &list_state_changes_payload("sess-never"),
            10,
        )
        .await
        .expect_handled();

        let response = drain_until_action(&mut rx, "list_session_state_changes_ok");
        assert_eq!(response["tug_session_id"], "sess-never");
        let rows = response["rows"].as_array().expect("rows array");
        assert_eq!(rows.len(), 0);
    }

    #[tokio::test]
    async fn list_session_state_changes_falls_back_to_tug_session_id() {
        // Reload race: the popover sends `list_session_state_changes`
        // before the resumed session's `claude_session_id` has landed
        // in the in-memory map. With NO in-memory entry to resolve, the
        // read falls back to `tug_session_id` as the ledger key (equal
        // to the claude id by the post-Phase-B invariant) and recovers
        // the persisted history rather than returning a spurious empty
        // array — the popover's "no state changes recorded" bug.
        let (sup, ledger, mut rx) = make_supervisor_with_ledger();
        ledger
            .record_spawn("sess-reload-race", "ws-1", "/proj/x", "card-9", 1_000, None)
            .unwrap();
        ledger
            .record_session_state_change("sess-reload-race", 100, "idle", "online", false)
            .unwrap();
        ledger
            .record_session_state_change("sess-reload-race", 200, "submitting", "online", false)
            .unwrap();

        while rx.try_recv().is_ok() {}

        sup.handle_control(
            "list_session_state_changes",
            &list_state_changes_payload("sess-reload-race"),
            10,
        )
        .await
        .expect_handled();

        let response = drain_until_action(&mut rx, "list_session_state_changes_ok");
        assert_eq!(response["tug_session_id"], "sess-reload-race");
        let rows = response["rows"].as_array().expect("rows array");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["phase"], "idle");
        assert_eq!(rows[1]["phase"], "submitting");
    }

    #[tokio::test]
    async fn list_session_state_changes_rejects_malformed_payload() {
        let (sup, _ledger, _rx) = make_supervisor_with_ledger();
        let outcome = sup
            .handle_control("list_session_state_changes", b"not json", 10)
            .await;
        assert!(matches!(outcome, ControlOutcome::Error(_)));
    }
}
