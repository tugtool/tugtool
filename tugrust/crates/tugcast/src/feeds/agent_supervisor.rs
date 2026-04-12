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
use std::time::Duration;

use thiserror::Error;
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use tracing::warn;
use tugbank_core::{TugbankClient, Value};
use tugcast_core::protocol::{FeedId, Frame, TugSessionId};

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

/// Persistence surface for the `(card_id → tug_session_id)` mapping.
///
/// The supervisor depends on a narrow trait (rather than on `TugbankClient`
/// directly) so unit tests can inject an in-memory fake — and, per [D12]'s
/// strict-vs-best-effort asymmetry, can inject an error-producing fake to
/// exercise the `spawn_session` persistence-failure path.
pub trait SessionKeysStore: Send + Sync {
    /// Write `(card_id, tug_session_id)` into the session-keys domain.
    fn set_session_key(
        &self,
        card_id: &str,
        tug_session_id: &TugSessionId,
    ) -> Result<(), SessionKeysStoreError>;

    /// Delete the entry keyed by `card_id`. Returning `Ok(())` when the key is
    /// missing is acceptable — the supervisor treats delete as best-effort.
    fn delete_session_key(&self, card_id: &str) -> Result<(), SessionKeysStoreError>;
}

impl SessionKeysStore for TugbankClient {
    fn set_session_key(
        &self,
        card_id: &str,
        tug_session_id: &TugSessionId,
    ) -> Result<(), SessionKeysStoreError> {
        self.set(
            SESSION_KEYS_DOMAIN,
            card_id,
            Value::String(tug_session_id.as_str().to_string()),
        )
        .map_err(|e| SessionKeysStoreError(e.to_string()))
    }

    fn delete_session_key(&self, card_id: &str) -> Result<(), SessionKeysStoreError> {
        self.delete(SESSION_KEYS_DOMAIN, card_id)
            .map(|_| ())
            .map_err(|e| SessionKeysStoreError(e.to_string()))
    }
}

// ---------------------------------------------------------------------------
// AgentSupervisor
// ---------------------------------------------------------------------------

/// Runtime configuration for [`AgentSupervisor`]. Concrete fields are added as
/// subsequent steps in the plan require them.
#[derive(Debug, Clone, Default)]
pub struct AgentSupervisorConfig {}

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
    /// Narrow persistence surface for card↔session bindings.
    pub store: Arc<dyn SessionKeysStore>,
    /// Runtime configuration.
    pub config: AgentSupervisorConfig,
}

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

fn build_session_state_frame(
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

impl AgentSupervisor {
    /// Construct a supervisor with pre-made broadcast senders and a session
    /// keys store.
    pub fn new(
        session_state_tx: broadcast::Sender<Frame>,
        session_metadata_tx: broadcast::Sender<Frame>,
        code_output_tx: broadcast::Sender<Frame>,
        store: Arc<dyn SessionKeysStore>,
        config: AgentSupervisorConfig,
    ) -> Self {
        Self {
            ledger: Arc::new(Mutex::new(HashMap::new())),
            session_state_tx,
            session_metadata_tx,
            client_sessions: Arc::new(Mutex::new(HashMap::new())),
            code_output_tx,
            store,
            config,
        }
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
        // 1) Ledger get-or-insert. Reconnect flows MUST NOT overwrite an
        //    existing entry — its `latest_metadata` is what the replay step
        //    below hands back to the client.
        let entry_arc: Arc<Mutex<LedgerEntry>> = {
            let mut map = self.ledger.lock().await;
            map.entry(tug_session_id.clone())
                .or_insert_with(|| {
                    Arc::new(Mutex::new(LedgerEntry::new(
                        tug_session_id.clone(),
                        CrashBudget::new(3, Duration::from_secs(60)),
                    )))
                })
                .clone()
        };

        // 2) Per-client session affinity.
        {
            let mut cs = self.client_sessions.lock().await;
            cs.entry(client_id)
                .or_default()
                .insert(tug_session_id.clone());
        }

        // 3) Strict tugbank write ([D12]). Partial ledger/client_sessions
        //    state is tolerable (rewritten on retry); silent failure is not.
        if let Err(e) = self.store.set_session_key(card_id, &tug_session_id) {
            warn!(
                card_id,
                session = %tug_session_id,
                error = %e.0,
                "spawn_session: tugbank write failed"
            );
            return Err(ControlError::PersistenceFailure(e.0));
        }

        // 4) Publish `pending` on SESSION_STATE.
        let _ = self.session_state_tx.send(build_session_state_frame(
            &tug_session_id,
            "pending",
            None,
        ));

        // 5) Event-driven metadata replay ([D14]). Read under per-session lock
        //    and, if present, publish exactly one frame on SESSION_METADATA.
        let replay_frame = {
            let entry = entry_arc.lock().await;
            entry.latest_metadata.clone()
        };
        if let Some(frame) = replay_frame {
            let _ = self.session_metadata_tx.send(frame);
        }

        Ok(())
    }

    async fn do_close_session(
        &self,
        card_id: &str,
        tug_session_id: &TugSessionId,
        client_id: ClientId,
    ) {
        // Lookup: unknown-id close is a no-op (no tugbank interaction, no
        // SESSION_STATE publish).
        let entry_arc = {
            let map = self.ledger.lock().await;
            match map.get(tug_session_id) {
                Some(e) => e.clone(),
                None => return,
            }
        };

        // Cancel the per-session worker.
        {
            let entry = entry_arc.lock().await;
            entry.cancel.cancel();
        }

        // Remove from client_sessions[client_id].
        {
            let mut cs = self.client_sessions.lock().await;
            if let Some(set) = cs.get_mut(&client_id) {
                set.remove(tug_session_id);
            }
        }

        // Best-effort tugbank delete ([D12]). Lingering tugbank entries are
        // benign; a warn! is the loudest signal we want on this path.
        if let Err(e) = self.store.delete_session_key(card_id) {
            warn!(
                card_id,
                session = %tug_session_id,
                error = %e.0,
                "close_session: tugbank delete failed, continuing"
            );
        }

        // Drop the ledger entry. This also clears latest_metadata — reset
        // flows rely on this so their follow-up spawn reads None and fires
        // no replay.
        {
            let mut map = self.ledger.lock().await;
            map.remove(tug_session_id);
        }

        // Publish `closed`.
        let _ = self.session_state_tx.send(build_session_state_frame(
            tug_session_id,
            "closed",
            None,
        ));
    }

    /// Per-session dispatcher task. Implemented in Step 5.
    pub async fn dispatcher_task(&self) {}

    /// Per-bridge merger task. Implemented in Step 6.
    pub async fn merger_task(&self) {}

    /// Spawn the per-session worker subprocess. Implemented in Step 5.
    pub async fn spawn_session_worker(&self, _id: &TugSessionId) {}

    /// Drop per-client affinity state on WebSocket teardown. Does NOT touch
    /// ledger state or tugbank — a client disconnecting is not a session
    /// close.
    pub async fn on_client_disconnect(&self, client_id: ClientId) {
        let mut cs = self.client_sessions.lock().await;
        cs.remove(&client_id);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    // ---- Test-only SessionKeysStore fakes ----

    #[derive(Default)]
    struct InMemoryStore {
        entries: StdMutex<HashMap<String, String>>,
        set_calls: StdMutex<u32>,
        delete_calls: StdMutex<u32>,
    }

    impl InMemoryStore {
        fn entries_snapshot(&self) -> HashMap<String, String> {
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
        fn set_session_key(
            &self,
            card_id: &str,
            tug_session_id: &TugSessionId,
        ) -> Result<(), SessionKeysStoreError> {
            *self.set_calls.lock().unwrap() += 1;
            self.entries
                .lock()
                .unwrap()
                .insert(card_id.to_string(), tug_session_id.as_str().to_string());
            Ok(())
        }
        fn delete_session_key(&self, card_id: &str) -> Result<(), SessionKeysStoreError> {
            *self.delete_calls.lock().unwrap() += 1;
            self.entries.lock().unwrap().remove(card_id);
            Ok(())
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
        fn set_session_key(
            &self,
            _card_id: &str,
            _tug_session_id: &TugSessionId,
        ) -> Result<(), SessionKeysStoreError> {
            Err(SessionKeysStoreError("injected write failure".into()))
        }
        fn delete_session_key(&self, card_id: &str) -> Result<(), SessionKeysStoreError> {
            self.delegate.delete_session_key(card_id)
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
        fn set_session_key(
            &self,
            card_id: &str,
            tug_session_id: &TugSessionId,
        ) -> Result<(), SessionKeysStoreError> {
            self.delegate.set_session_key(card_id, tug_session_id)
        }
        fn delete_session_key(&self, _card_id: &str) -> Result<(), SessionKeysStoreError> {
            Err(SessionKeysStoreError("injected delete failure".into()))
        }
    }

    // ---- Test helpers ----

    fn make_supervisor_with_store(
        store: Arc<dyn SessionKeysStore>,
    ) -> (
        AgentSupervisor,
        broadcast::Receiver<Frame>,
        broadcast::Receiver<Frame>,
    ) {
        let (state_tx, state_rx) = broadcast::channel(32);
        let (meta_tx, meta_rx) = broadcast::channel(32);
        let (code_tx, _code_rx) = broadcast::channel(32);
        let sup = AgentSupervisor::new(
            state_tx,
            meta_tx,
            code_tx,
            store,
            AgentSupervisorConfig::default(),
        );
        (sup, state_rx, meta_rx)
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
        let (sup, mut state_rx, _meta_rx) = make_supervisor_with_store(store.clone());

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
        let (sup, _state_rx, _meta_rx) = make_supervisor_with_store(store.clone());

        sup.handle_control("spawn_session", &spawn_payload("card-1", "sess-1"), 10)
            .await
            .unwrap();

        let entries = store.entries_snapshot();
        assert_eq!(entries.get("card-1"), Some(&"sess-1".to_string()));
        assert_eq!(store.set_call_count(), 1);
    }

    #[tokio::test]
    async fn test_spawn_session_inserts_into_client_sessions() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx) = make_supervisor_with_store(store);

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
        let (sup, mut state_rx, _meta_rx) = make_supervisor_with_store(store.clone());

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
        let (sup, _state_rx, _meta_rx) = make_supervisor_with_store(store.clone());

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
        let (sup, _state_rx, _meta_rx) = make_supervisor_with_store(store.clone());

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
        let (sup, _state_rx, mut meta_rx) = make_supervisor_with_store(store);

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
        let (sup, _state_rx, mut meta_rx) = make_supervisor_with_store(store);

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
        let (sup, mut state_rx, mut meta_rx) = make_supervisor_with_store(store);

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
        let (sup, mut state_rx, _meta_rx) = make_supervisor_with_store(store);

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
        let (sup, _state_rx, _meta_rx) = make_supervisor_with_store(store.clone());

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
        let (sup, _state_rx, _meta_rx) = make_supervisor_with_store(store);

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
        let (sup, mut state_rx, _meta_rx) = make_supervisor_with_store(store.clone());

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
        let (sup, mut state_rx, _meta_rx) = make_supervisor_with_store(store);

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
        let (sup, mut state_rx, _meta_rx) = make_supervisor_with_store(store);

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

    // ---- on_client_disconnect ----

    #[tokio::test]
    async fn test_on_client_disconnect_drops_client_sessions_entry() {
        let store = Arc::new(InMemoryStore::default());
        let (sup, _state_rx, _meta_rx) = make_supervisor_with_store(store.clone());

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
}
