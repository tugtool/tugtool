//! Agent supervisor module (scaffold)
//!
//! Houses the per-session ledger, SPAWN/METADATA broadcast senders, and the
//! state machine that will eventually own the spawn/dispatch/merge lifecycle
//! for Claude Code sessions. This step introduces only the types and method
//! stubs; subsequent steps in `tugplan-multi-session-router` wire the
//! behavior.
//!
//! Types defined here are referenced from `router.rs` and will be consumed by
//! subsequent steps, so the whole module allows dead code until the wiring
//! lands.

#![allow(dead_code)]

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use thiserror::Error;
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use tugbank_core::TugbankClient;
use tugcast_core::protocol::{Frame, TugSessionId};

use super::agent_bridge::CrashBudget;

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
                // Close paths
                | (Idle, Closed)
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

/// Result of pushing onto a [`BoundedQueue`].
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
// Ledger alias + SessionMetadataRegistry
// ---------------------------------------------------------------------------

/// Shared ledger map. Outer mutex guards membership; per-session mutex guards
/// the entry's mutable fields.
pub type Ledger = Arc<Mutex<HashMap<TugSessionId, Arc<Mutex<LedgerEntry>>>>>;

/// Thin wrapper around the ledger that exposes only the per-session
/// `latest_metadata` slot. Consumed by Step 6's per-session metadata routing
/// and Step 8's on-subscribe replay per [D14].
#[derive(Clone)]
pub struct SessionMetadataRegistry {
    ledger: Ledger,
}

impl SessionMetadataRegistry {
    pub fn new(ledger: Ledger) -> Self {
        Self { ledger }
    }

    /// Read the latest `system_metadata` frame recorded for a session.
    pub async fn get_latest_metadata(&self, id: &TugSessionId) -> Option<Frame> {
        let entry = {
            let map = self.ledger.lock().await;
            map.get(id).cloned()
        }?;
        let entry = entry.lock().await;
        entry.latest_metadata.clone()
    }

    /// Record a new `system_metadata` frame for a session. No-op if the
    /// session has no ledger entry.
    pub async fn set_latest_metadata(&self, id: &TugSessionId, frame: Frame) {
        let entry = {
            let map = self.ledger.lock().await;
            map.get(id).cloned()
        };
        if let Some(entry) = entry {
            let mut entry = entry.lock().await;
            entry.latest_metadata = Some(frame);
        }
    }
}

// ---------------------------------------------------------------------------
// AgentSupervisor
// ---------------------------------------------------------------------------

/// Runtime configuration for [`AgentSupervisor`]. Concrete fields are added as
/// subsequent steps in the plan require them.
#[derive(Debug, Clone, Default)]
pub struct AgentSupervisorConfig {}

/// Errors returned from [`AgentSupervisor::handle_control`]. Step 4 fills in
/// the concrete variants; the enum is scaffolded here so its shape is stable
/// for the upcoming `handle_client` wiring.
#[derive(Debug, Error)]
pub enum ControlError {
    #[error("control payload missing card_id")]
    MissingCardId,
    #[error("control payload missing tug_session_id")]
    MissingSessionId,
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
    /// Tugbank handle used for the `dev.tugtool.tide.session-keys` domain.
    pub tugbank: Arc<TugbankClient>,
    /// Runtime configuration.
    pub config: AgentSupervisorConfig,
}

impl AgentSupervisor {
    /// Construct a supervisor with pre-made broadcast senders and a shared
    /// tugbank client.
    pub fn new(
        session_state_tx: broadcast::Sender<Frame>,
        session_metadata_tx: broadcast::Sender<Frame>,
        code_output_tx: broadcast::Sender<Frame>,
        tugbank: Arc<TugbankClient>,
        config: AgentSupervisorConfig,
    ) -> Self {
        Self {
            ledger: Arc::new(Mutex::new(HashMap::new())),
            session_state_tx,
            session_metadata_tx,
            client_sessions: Arc::new(Mutex::new(HashMap::new())),
            code_output_tx,
            tugbank,
            config,
        }
    }

    /// Handle a CONTROL frame's spawn/close/reset action. Implemented in
    /// Step 4.
    pub async fn handle_control(
        &self,
        _action: &str,
        _payload: &[u8],
        _client_id: ClientId,
    ) -> Result<(), ControlError> {
        Ok(())
    }

    /// Per-session dispatcher task. Implemented in Step 6.
    pub async fn dispatcher_task(&self) {}

    /// Per-bridge merger task. Implemented in Step 6.
    pub async fn merger_task(&self) {}

    /// Spawn the per-session worker subprocess. Implemented in Step 5.
    pub async fn spawn_session_worker(&self, _id: &TugSessionId) {}

    /// Drop per-client affinity state on WebSocket teardown. Full
    /// implementation in Step 4.
    pub async fn on_client_disconnect(&self, _client_id: ClientId) {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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
}
