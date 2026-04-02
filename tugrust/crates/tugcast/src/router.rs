//! Feed router and WebSocket handler
//!
//! Implements the per-client BOOTSTRAP/LIVE state machine for WebSocket connections.
//! Each client gets snapshot data on connect, then transitions to live streaming.
//!
//! Lag recovery varies by feed:
//! - `LagPolicy::Bootstrap` — re-enter BOOTSTRAP state (terminal: `capture_pane`)
//! - `LagPolicy::Replay` — replay from a shared ring buffer (code output)
//! - `LagPolicy::Warn` — log warning, continue (non-critical feeds)
//!
//! Input dispatch enforces single-writer-per-FeedId: the first client to send
//! on an input FeedId claims it; subsequent clients receive an error frame.

use std::collections::{HashMap, VecDeque};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures::Stream;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time;
use tokio_stream::StreamMap;
use tokio_stream::wrappers::BroadcastStream;
use tracing::{debug, error, info, warn};

use tugcast_core::{
    CLOSE_BAD_HANDSHAKE, CLOSE_HANDSHAKE_TIMEOUT, CLOSE_VERSION_MISMATCH, FeedId, Frame,
    HANDSHAKE_TIMEOUT, PROTOCOL_NAME, PROTOCOL_VERSION,
};

use crate::auth::{self, SharedAuthState};
use crate::feeds::terminal;

/// Broadcast channel capacity for stream feeds
pub const BROADCAST_CAPACITY: usize = 4096;

/// Heartbeat interval (send heartbeat every 15 seconds)
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

/// Heartbeat timeout (close connection if no heartbeat received within 45 seconds)
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);

// ---------------------------------------------------------------------------
// ReplayBuffer
// ---------------------------------------------------------------------------

/// Shared replay buffer for lag recovery on stream feeds.
///
/// The producer pushes frames; on lag the router replays the buffer contents
/// to the client. Thread-safe via `Arc<Mutex<_>>`.
#[derive(Clone)]
pub struct ReplayBuffer {
    frames: Arc<Mutex<VecDeque<Frame>>>,
    capacity: usize,
}

impl ReplayBuffer {
    /// Create a new replay buffer with the given maximum capacity.
    pub fn new(capacity: usize) -> Self {
        Self {
            frames: Arc::new(Mutex::new(VecDeque::with_capacity(capacity))),
            capacity,
        }
    }

    /// Push a frame into the buffer, evicting the oldest if at capacity.
    pub fn push(&self, frame: Frame) {
        let mut buf = self.frames.lock().unwrap();
        if buf.len() >= self.capacity {
            buf.pop_front();
        }
        buf.push_back(frame);
    }

    /// Return a snapshot (clone) of all buffered frames.
    pub fn snapshot(&self) -> Vec<Frame> {
        self.frames.lock().unwrap().iter().cloned().collect()
    }

    /// Number of frames currently in the buffer.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.frames.lock().unwrap().len()
    }
}

// ---------------------------------------------------------------------------
// LagPolicy
// ---------------------------------------------------------------------------

/// What the router should do when a client falls behind on a stream feed.
#[derive(Debug, Clone)]
pub enum LagPolicy {
    /// Re-enter BOOTSTRAP state to recover (e.g. terminal output).
    Bootstrap,
    /// Replay from a shared ring buffer, then resume live streaming.
    Replay(ReplayBuffer),
    /// Log a warning and continue — the client may miss frames.
    Warn,
}

// Manual PartialEq: compare variant tags only (ReplayBuffer is not meaningfully comparable).
impl PartialEq for LagPolicy {
    fn eq(&self, other: &Self) -> bool {
        matches!(
            (self, other),
            (LagPolicy::Bootstrap, LagPolicy::Bootstrap)
                | (LagPolicy::Replay(_), LagPolicy::Replay(_))
                | (LagPolicy::Warn, LagPolicy::Warn)
        )
    }
}
impl Eq for LagPolicy {}

// Manual Debug for ReplayBuffer (doesn't derive Debug because of Mutex).
impl std::fmt::Debug for ReplayBuffer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let len = self.frames.lock().map(|b| b.len()).unwrap_or(0);
        write!(f, "ReplayBuffer({}/{})", len, self.capacity)
    }
}

// ---------------------------------------------------------------------------
// InputOwnership — single-writer-per-FeedId enforcement (P5)
// ---------------------------------------------------------------------------

/// Shared map tracking which client (by ID) owns each input FeedId.
/// `0` = unclaimed. A non-zero value is the owning client's ID.
type InputOwnership = Arc<Mutex<HashMap<FeedId, u64>>>;

// ---------------------------------------------------------------------------
// Per-client state machine
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum ClientState {
    /// Client is receiving bootstrap data for the feed that lagged.
    Bootstrap { feed_id: FeedId, buffer: Vec<Frame> },
    /// Client is receiving live output directly.
    Live,
}

// ---------------------------------------------------------------------------
// FeedRouter
// ---------------------------------------------------------------------------

/// Feed router for managing WebSocket connections.
///
/// Constructed in `main.rs` via `new()` + `register_stream()` / `register_input()`
/// / `add_snapshot_watches()`. Passed to axum as shared state.
#[derive(Clone)]
pub struct FeedRouter {
    /// FeedId → (broadcast::Sender, LagPolicy) for stream feeds (server → client).
    pub(crate) stream_outputs: HashMap<FeedId, (broadcast::Sender<Frame>, LagPolicy)>,
    /// FeedId → mpsc::Sender for input feeds (client → server).
    input_sinks: HashMap<FeedId, mpsc::Sender<Frame>>,
    /// Snapshot watch receivers (delivered to every client on connect).
    snapshot_watches: Vec<watch::Receiver<Frame>>,

    /// Tracks which client owns each input FeedId (P5 single-writer guard).
    input_ownership: InputOwnership,
    /// Counter for assigning unique client IDs.
    client_id_counter: Arc<AtomicU64>,

    session: String,
    auth: SharedAuthState,
    pub(crate) shutdown_tx: mpsc::Sender<u8>,
    pub(crate) dev_state: crate::dev::SharedDevState,
}

impl FeedRouter {
    /// Create a new feed router with shared infrastructure channels.
    pub(crate) fn new(
        session: String,
        auth: SharedAuthState,
        shutdown_tx: mpsc::Sender<u8>,
        dev_state: crate::dev::SharedDevState,
    ) -> Self {
        Self {
            stream_outputs: HashMap::new(),
            input_sinks: HashMap::new(),
            snapshot_watches: Vec::new(),
            input_ownership: Arc::new(Mutex::new(HashMap::new())),
            client_id_counter: Arc::new(AtomicU64::new(1)),
            session,
            auth,
            shutdown_tx,
            dev_state,
        }
    }

    /// Register a stream output (broadcast feed, server → client).
    pub(crate) fn register_stream(
        &mut self,
        feed_id: FeedId,
        tx: broadcast::Sender<Frame>,
        lag_policy: LagPolicy,
    ) {
        self.stream_outputs.insert(feed_id, (tx, lag_policy));
    }

    /// Register an input sink (client → server backend).
    pub(crate) fn register_input(&mut self, feed_id: FeedId, tx: mpsc::Sender<Frame>) {
        self.input_sinks.insert(feed_id, tx);
    }

    /// Add snapshot watches (delivered on connect + forwarded on change).
    pub(crate) fn add_snapshot_watches(&mut self, watches: Vec<watch::Receiver<Frame>>) {
        self.snapshot_watches.extend(watches);
    }

    /// Assign a unique client ID.
    fn next_client_id(&self) -> u64 {
        self.client_id_counter.fetch_add(1, Ordering::Relaxed)
    }
}

/// WebSocket upgrade handler
///
/// Validates session and origin before upgrading the connection.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(router): State<FeedRouter>,
) -> Response {
    if !auth::validate_request_session(&headers, &router.auth) {
        debug!("WebSocket upgrade rejected: invalid session");
        return (StatusCode::FORBIDDEN, "Invalid or expired session").into_response();
    }
    if !auth::check_request_origin(&headers, &router.auth) {
        debug!("WebSocket upgrade rejected: invalid origin");
        return (StatusCode::FORBIDDEN, "Invalid origin").into_response();
    }
    info!("WebSocket upgrade accepted");
    ws.on_upgrade(move |socket| handle_client(socket, router))
}

// ---------------------------------------------------------------------------
// Protocol handshake
// ---------------------------------------------------------------------------

/// Perform the protocol handshake at WebSocket connection open.
async fn perform_handshake(socket: &mut WebSocket) -> bool {
    let hello = tokio::time::timeout(HANDSHAKE_TIMEOUT, socket.recv()).await;

    let hello_text = match hello {
        Ok(Some(Ok(Message::Text(text)))) => text,
        Ok(Some(Ok(_))) => {
            warn!("Handshake failed: expected text frame, got binary/other");
            let _ = socket
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: CLOSE_BAD_HANDSHAKE,
                    reason: "expected text handshake frame".into(),
                })))
                .await;
            return false;
        }
        Ok(Some(Err(e))) => {
            warn!("Handshake failed: WebSocket error: {}", e);
            return false;
        }
        Ok(None) => {
            info!("Client disconnected before handshake");
            return false;
        }
        Err(_) => {
            warn!("Handshake timed out");
            let _ = socket
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: CLOSE_HANDSHAKE_TIMEOUT,
                    reason: "handshake timeout".into(),
                })))
                .await;
            return false;
        }
    };

    let hello_json: serde_json::Value = match serde_json::from_str(&hello_text) {
        Ok(v) => v,
        Err(_) => {
            warn!("Handshake failed: invalid JSON: {}", hello_text);
            let _ = socket
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: CLOSE_BAD_HANDSHAKE,
                    reason: "invalid handshake JSON".into(),
                })))
                .await;
            return false;
        }
    };

    let protocol = hello_json
        .get("protocol")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if protocol != PROTOCOL_NAME {
        warn!("Handshake failed: unknown protocol '{}'", protocol);
        let _ = socket
            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: CLOSE_BAD_HANDSHAKE,
                reason: format!("unknown protocol: {protocol}").into(),
            })))
            .await;
        return false;
    }

    let version = hello_json
        .get("version")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    if version != PROTOCOL_VERSION {
        warn!(
            "Handshake failed: version mismatch (client={}, server={})",
            version, PROTOCOL_VERSION
        );
        let _ = socket
            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: CLOSE_VERSION_MISMATCH,
                reason: format!(
                    "version mismatch: server={}, client={}",
                    PROTOCOL_VERSION, version
                )
                .into(),
            })))
            .await;
        return false;
    }

    let response = serde_json::json!({
        "protocol": PROTOCOL_NAME,
        "version": PROTOCOL_VERSION,
        "capabilities": []
    });
    if socket
        .send(Message::Text(response.to_string().into()))
        .await
        .is_err()
    {
        info!("Client disconnected during handshake response");
        return false;
    }

    info!("Protocol handshake complete (v{})", PROTOCOL_VERSION);
    true
}

// ---------------------------------------------------------------------------
// StreamMap helpers
// ---------------------------------------------------------------------------

type PinnedBroadcastStream = Pin<
    Box<
        dyn Stream<Item = Result<Frame, tokio_stream::wrappers::errors::BroadcastStreamRecvError>>
            + Send,
    >,
>;

fn build_stream_map(
    stream_outputs: &HashMap<FeedId, (broadcast::Sender<Frame>, LagPolicy)>,
) -> (
    StreamMap<FeedId, PinnedBroadcastStream>,
    HashMap<FeedId, LagPolicy>,
) {
    let mut map = StreamMap::new();
    let mut policies = HashMap::new();
    for (&feed_id, (tx, policy)) in stream_outputs {
        let rx = tx.subscribe();
        let stream: PinnedBroadcastStream = Box::pin(BroadcastStream::new(rx));
        map.insert(feed_id, stream);
        policies.insert(feed_id, policy.clone());
    }
    (map, policies)
}

// ---------------------------------------------------------------------------
// Helpers: send control frames to client
// ---------------------------------------------------------------------------

/// Send a JSON control frame (flags=CONTROL) to the client.
/// Returns false if the client disconnected.
async fn send_control_json(
    socket: &mut WebSocket,
    feed_id: FeedId,
    json: &serde_json::Value,
) -> bool {
    let payload = serde_json::to_vec(json).unwrap_or_default();
    let frame = Frame::control(feed_id, payload);
    socket
        .send(Message::Binary(frame.encode().into()))
        .await
        .is_ok()
}

// ---------------------------------------------------------------------------
// Input ownership helpers (P5)
// ---------------------------------------------------------------------------

/// Try to claim an input FeedId for the given client.
/// Returns `Ok(())` if the client owns it (or just claimed it),
/// or `Err(owner_id)` if another client owns it.
fn try_claim_input(ownership: &InputOwnership, feed_id: FeedId, client_id: u64) -> Result<(), u64> {
    let mut map = ownership.lock().unwrap();
    match map.get(&feed_id).copied() {
        None | Some(0) => {
            map.insert(feed_id, client_id);
            Ok(())
        }
        Some(owner) if owner == client_id => Ok(()),
        Some(owner) => Err(owner),
    }
}

/// Release all input FeedIds owned by the given client.
fn release_inputs(ownership: &InputOwnership, client_id: u64) {
    let mut map = ownership.lock().unwrap();
    map.retain(|_, owner| *owner != client_id);
}

// ---------------------------------------------------------------------------
// handle_client
// ---------------------------------------------------------------------------

/// Handle a WebSocket client connection
async fn handle_client(mut socket: WebSocket, mut router: FeedRouter) {
    let client_id = router.next_client_id();
    info!(client_id, "Client connected");

    // --- Protocol handshake (v1) ---
    if !perform_handshake(&mut socket).await {
        return;
    }

    // Build the StreamMap for output fan-in
    let (mut stream_map, lag_policies) = build_stream_map(&router.stream_outputs);

    let mut state = ClientState::Live;

    loop {
        match &mut state {
            ClientState::Bootstrap { feed_id, buffer } => {
                let lagged_feed = *feed_id;
                info!(client_id, %lagged_feed, "Client re-entering BOOTSTRAP state");

                // Send lag_detected control frame
                let _ = send_control_json(
                    &mut socket,
                    lagged_feed,
                    &serde_json::json!({
                        "type": "lag_detected",
                        "feed_id": lagged_feed.as_byte()
                    }),
                )
                .await;

                // Dispatch bootstrap based on feed
                if lagged_feed == FeedId::TERMINAL_OUTPUT {
                    // Terminal: capture tmux pane
                    match terminal::capture_pane(&router.session).await {
                        Ok(snapshot) => {
                            let frame = Frame::new(FeedId::TERMINAL_OUTPUT, snapshot);
                            if socket
                                .send(Message::Binary(frame.encode().into()))
                                .await
                                .is_err()
                            {
                                info!(client_id, "Client disconnected during snapshot send");
                                release_inputs(&router.input_ownership, client_id);
                                return;
                            }
                            debug!(client_id, "Terminal snapshot sent");
                        }
                        Err(e) => {
                            error!("Failed to capture pane: {}", e);
                        }
                    }
                } else {
                    // Other feeds: no bootstrap available yet
                    let _ = send_control_json(
                        &mut socket,
                        lagged_feed,
                        &serde_json::json!({
                            "type": "bootstrap_unavailable",
                            "feed_id": lagged_feed.as_byte()
                        }),
                    )
                    .await;
                }

                // Drain any buffered frames from the stream map
                use tokio_stream::StreamExt;
                while let Some((_fid, result)) =
                    futures::FutureExt::now_or_never(stream_map.next()).flatten()
                {
                    if let Ok(frame) = result {
                        buffer.push(frame);
                    }
                }

                // Flush buffer to client
                for frame in buffer.drain(..) {
                    if socket
                        .send(Message::Binary(frame.encode().into()))
                        .await
                        .is_err()
                    {
                        info!(client_id, "Client disconnected during buffer flush");
                        release_inputs(&router.input_ownership, client_id);
                        return;
                    }
                }

                debug!(client_id, "Buffer flushed, transitioning to LIVE");
                state = ClientState::Live;
            }

            ClientState::Live => {
                info!(client_id, "Client in LIVE state");

                // Create a channel for merged snapshot updates
                let (snap_tx, mut snap_rx) = mpsc::channel::<Frame>(16);

                let snapshot_watches = std::mem::take(&mut router.snapshot_watches);
                for mut watch_rx in snapshot_watches {
                    let frame = watch_rx.borrow_and_update().clone();
                    if !frame.payload.is_empty()
                        && socket
                            .send(Message::Binary(frame.encode().into()))
                            .await
                            .is_err()
                    {
                        info!(
                            client_id,
                            "Client disconnected during initial snapshot send"
                        );
                        release_inputs(&router.input_ownership, client_id);
                        return;
                    }
                    let snap_tx_clone = snap_tx.clone();
                    tokio::spawn(async move {
                        while watch_rx.changed().await.is_ok() {
                            let frame = watch_rx.borrow_and_update().clone();
                            if snap_tx_clone.send(frame).await.is_err() {
                                break;
                            }
                        }
                    });
                }
                drop(snap_tx);

                let mut heartbeat_interval = time::interval(HEARTBEAT_INTERVAL);
                let mut last_heartbeat = Instant::now();

                use tokio_stream::StreamExt;

                loop {
                    tokio::select! {
                        Some(frame) = snap_rx.recv() => {
                            if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                info!(client_id, "Client disconnected");
                                release_inputs(&router.input_ownership, client_id);
                                return;
                            }
                        }

                        Some((feed_id, result)) = stream_map.next() => {
                            match result {
                                Ok(frame) => {
                                    if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                        info!(client_id, "Client disconnected");
                                        release_inputs(&router.input_ownership, client_id);
                                        return;
                                    }
                                }
                                Err(_lagged) => {
                                    let policy = lag_policies.get(&feed_id).cloned().unwrap_or(LagPolicy::Warn);
                                    match policy {
                                        LagPolicy::Bootstrap => {
                                            warn!(client_id, %feed_id, "Stream lagged, re-entering BOOTSTRAP");
                                            state = ClientState::Bootstrap {
                                                feed_id,
                                                buffer: Vec::new(),
                                            };
                                            break;
                                        }
                                        LagPolicy::Replay(replay_buf) => {
                                            warn!(client_id, %feed_id, "Stream lagged, replaying from buffer");
                                            // Send lag_recovery control frame
                                            if !send_control_json(&mut socket, feed_id, &serde_json::json!({
                                                "type": "lag_recovery",
                                                "feed_id": feed_id.as_byte()
                                            })).await {
                                                release_inputs(&router.input_ownership, client_id);
                                                return;
                                            }
                                            // Replay buffered frames
                                            for frame in replay_buf.snapshot() {
                                                if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                                    info!(client_id, "Client disconnected during replay");
                                                    release_inputs(&router.input_ownership, client_id);
                                                    return;
                                                }
                                            }
                                            // Send lag_recovery_complete
                                            if !send_control_json(&mut socket, feed_id, &serde_json::json!({
                                                "type": "lag_recovery_complete",
                                                "feed_id": feed_id.as_byte()
                                            })).await {
                                                release_inputs(&router.input_ownership, client_id);
                                                return;
                                            }
                                            // Continue live streaming
                                        }
                                        LagPolicy::Warn => {
                                            warn!(client_id, %feed_id, "Stream lagged, frames lost");
                                        }
                                    }
                                }
                            }
                        }

                        msg = socket.recv() => {
                            match msg {
                                Some(Ok(Message::Binary(data))) => {
                                    if let Ok((frame, _)) = Frame::decode(&data) {
                                        let fid = frame.feed_id;

                                        // Router-internal: Heartbeat
                                        if fid == FeedId::HEARTBEAT {
                                            last_heartbeat = Instant::now();
                                            debug!("Heartbeat received from client");
                                        }
                                        // Router-internal: Control
                                        else if fid == FeedId::CONTROL {
                                            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&frame.payload) {
                                                if let Some(action) = payload.get("action").and_then(|a| a.as_str()) {
                                                    crate::actions::dispatch_action(
                                                        action,
                                                        &frame.payload,
                                                        &router.shutdown_tx,
                                                        &router.stream_outputs,
                                                        &router.dev_state,
                                                    ).await;
                                                }
                                            }
                                        }
                                        // Dynamic dispatch: look up input sink with ownership guard
                                        else if router.input_sinks.contains_key(&fid) {
                                            match try_claim_input(&router.input_ownership, fid, client_id) {
                                                Ok(()) => {
                                                    let tx = router.input_sinks.get(&fid).unwrap();
                                                    let _ = tx.send(frame).await;
                                                }
                                                Err(owner) => {
                                                    warn!(client_id, %fid, owner, "Input claimed by another client");
                                                    let _ = send_control_json(&mut socket, fid, &serde_json::json!({
                                                        "type": "input_claimed",
                                                        "feed_id": fid.as_byte(),
                                                        "owner": owner
                                                    })).await;
                                                }
                                            }
                                        }
                                    }
                                }
                                Some(Ok(Message::Close(_))) | None => {
                                    info!(client_id, "Client disconnected");
                                    release_inputs(&router.input_ownership, client_id);
                                    return;
                                }
                                Some(Ok(_)) => {}
                                Some(Err(e)) => {
                                    error!(client_id, "WebSocket error: {}", e);
                                    release_inputs(&router.input_ownership, client_id);
                                    return;
                                }
                            }
                        }

                        _ = heartbeat_interval.tick() => {
                            let hb = Frame::heartbeat();
                            if socket.send(Message::Binary(hb.encode().into())).await.is_err() {
                                info!(client_id, "Client disconnected during heartbeat send");
                                release_inputs(&router.input_ownership, client_id);
                                return;
                            }
                            if last_heartbeat.elapsed() > HEARTBEAT_TIMEOUT {
                                warn!(client_id, "Heartbeat timeout, closing connection");
                                release_inputs(&router.input_ownership, client_id);
                                return;
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Extract SharedAuthState from FeedRouter for axum State
impl axum::extract::FromRef<FeedRouter> for SharedAuthState {
    fn from_ref(router: &FeedRouter) -> Self {
        router.auth.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- ReplayBuffer ----

    #[test]
    fn test_replay_buffer_push_and_snapshot() {
        let buf = ReplayBuffer::new(3);
        buf.push(Frame::new(FeedId::CODE_OUTPUT, b"a".to_vec()));
        buf.push(Frame::new(FeedId::CODE_OUTPUT, b"b".to_vec()));
        let snap = buf.snapshot();
        assert_eq!(snap.len(), 2);
        assert_eq!(snap[0].payload, b"a");
        assert_eq!(snap[1].payload, b"b");
    }

    #[test]
    fn test_replay_buffer_eviction() {
        let buf = ReplayBuffer::new(2);
        buf.push(Frame::new(FeedId::CODE_OUTPUT, b"a".to_vec()));
        buf.push(Frame::new(FeedId::CODE_OUTPUT, b"b".to_vec()));
        buf.push(Frame::new(FeedId::CODE_OUTPUT, b"c".to_vec()));
        let snap = buf.snapshot();
        assert_eq!(snap.len(), 2);
        assert_eq!(snap[0].payload, b"b");
        assert_eq!(snap[1].payload, b"c");
    }

    #[test]
    fn test_replay_buffer_empty_snapshot() {
        let buf = ReplayBuffer::new(10);
        assert!(buf.snapshot().is_empty());
        assert_eq!(buf.len(), 0);
    }

    #[test]
    fn test_replay_buffer_clone_is_shared() {
        let buf = ReplayBuffer::new(10);
        let buf2 = buf.clone();
        buf.push(Frame::new(FeedId::CODE_OUTPUT, b"x".to_vec()));
        assert_eq!(buf2.len(), 1);
    }

    // ---- LagPolicy ----

    #[test]
    fn test_lag_policy_equality() {
        assert_eq!(LagPolicy::Bootstrap, LagPolicy::Bootstrap);
        assert_eq!(LagPolicy::Warn, LagPolicy::Warn);
        let r1 = LagPolicy::Replay(ReplayBuffer::new(10));
        let r2 = LagPolicy::Replay(ReplayBuffer::new(20));
        assert_eq!(r1, r2); // Replay == Replay regardless of buffer
        assert_ne!(LagPolicy::Bootstrap, LagPolicy::Warn);
        assert_ne!(LagPolicy::Bootstrap, r1);
    }

    // ---- InputOwnership (P5) ----

    #[test]
    fn test_input_claim_unclaimed() {
        let ownership: InputOwnership = Arc::new(Mutex::new(HashMap::new()));
        assert!(try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 1).is_ok());
    }

    #[test]
    fn test_input_claim_same_client() {
        let ownership: InputOwnership = Arc::new(Mutex::new(HashMap::new()));
        try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 1).unwrap();
        // Same client can re-claim
        assert!(try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 1).is_ok());
    }

    #[test]
    fn test_input_claim_different_client_rejected() {
        let ownership: InputOwnership = Arc::new(Mutex::new(HashMap::new()));
        try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 1).unwrap();
        // Different client is rejected
        let result = try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 2);
        assert_eq!(result, Err(1));
    }

    #[test]
    fn test_input_release() {
        let ownership: InputOwnership = Arc::new(Mutex::new(HashMap::new()));
        try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 1).unwrap();
        try_claim_input(&ownership, FeedId::CODE_INPUT, 1).unwrap();
        release_inputs(&ownership, 1);
        // After release, another client can claim
        assert!(try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 2).is_ok());
        assert!(try_claim_input(&ownership, FeedId::CODE_INPUT, 2).is_ok());
    }

    #[test]
    fn test_input_release_only_own_feeds() {
        let ownership: InputOwnership = Arc::new(Mutex::new(HashMap::new()));
        try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 1).unwrap();
        try_claim_input(&ownership, FeedId::CODE_INPUT, 2).unwrap();
        // Release client 1 — should not affect client 2's ownership
        release_inputs(&ownership, 1);
        assert!(try_claim_input(&ownership, FeedId::TERMINAL_INPUT, 3).is_ok());
        assert_eq!(try_claim_input(&ownership, FeedId::CODE_INPUT, 3), Err(2));
    }

    // ---- ClientState ----

    #[test]
    fn test_client_state_bootstrap_carries_feed_id() {
        let state = ClientState::Bootstrap {
            feed_id: FeedId::TERMINAL_OUTPUT,
            buffer: Vec::new(),
        };
        match state {
            ClientState::Bootstrap { feed_id, .. } => {
                assert_eq!(feed_id, FeedId::TERMINAL_OUTPUT);
            }
            ClientState::Live => panic!("Expected Bootstrap state"),
        }
    }

    // ---- FeedRouter registration ----

    #[test]
    fn test_broadcast_capacity() {
        assert_eq!(BROADCAST_CAPACITY, 4096);
    }

    #[test]
    fn test_heartbeat_constants() {
        assert_eq!(HEARTBEAT_INTERVAL, Duration::from_secs(15));
        assert_eq!(HEARTBEAT_TIMEOUT, Duration::from_secs(45));
    }

    #[test]
    fn test_register_stream() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let auth = crate::auth::new_shared_auth_state(0);
        let dev_state = crate::dev::new_shared_dev_state();
        let mut router = FeedRouter::new("test".into(), auth, shutdown_tx, dev_state);

        let (tx, _) = broadcast::channel(16);
        router.register_stream(FeedId::TERMINAL_OUTPUT, tx, LagPolicy::Bootstrap);

        assert!(router.stream_outputs.contains_key(&FeedId::TERMINAL_OUTPUT));
        let (_, policy) = &router.stream_outputs[&FeedId::TERMINAL_OUTPUT];
        assert_eq!(*policy, LagPolicy::Bootstrap);
    }

    #[test]
    fn test_register_stream_with_replay() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let auth = crate::auth::new_shared_auth_state(0);
        let dev_state = crate::dev::new_shared_dev_state();
        let mut router = FeedRouter::new("test".into(), auth, shutdown_tx, dev_state);

        let (tx, _) = broadcast::channel(16);
        let replay = ReplayBuffer::new(100);
        router.register_stream(FeedId::CODE_OUTPUT, tx, LagPolicy::Replay(replay));

        let (_, policy) = &router.stream_outputs[&FeedId::CODE_OUTPUT];
        assert_eq!(*policy, LagPolicy::Replay(ReplayBuffer::new(0)));
    }

    #[test]
    fn test_register_input() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let auth = crate::auth::new_shared_auth_state(0);
        let dev_state = crate::dev::new_shared_dev_state();
        let mut router = FeedRouter::new("test".into(), auth, shutdown_tx, dev_state);

        let (tx, _rx) = mpsc::channel(16);
        router.register_input(FeedId::TERMINAL_INPUT, tx.clone());
        router.register_input(FeedId::TERMINAL_RESIZE, tx);

        assert!(router.input_sinks.contains_key(&FeedId::TERMINAL_INPUT));
        assert!(router.input_sinks.contains_key(&FeedId::TERMINAL_RESIZE));
    }

    #[test]
    fn test_many_to_one_input() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let auth = crate::auth::new_shared_auth_state(0);
        let dev_state = crate::dev::new_shared_dev_state();
        let mut router = FeedRouter::new("test".into(), auth, shutdown_tx, dev_state);

        let (tx, mut rx) = mpsc::channel(16);
        router.register_input(FeedId::TERMINAL_INPUT, tx.clone());
        router.register_input(FeedId::TERMINAL_RESIZE, tx);

        let input_tx = router.input_sinks.get(&FeedId::TERMINAL_INPUT).unwrap();
        input_tx
            .try_send(Frame::new(FeedId::TERMINAL_INPUT, b"key".to_vec()))
            .unwrap();

        let resize_tx = router.input_sinks.get(&FeedId::TERMINAL_RESIZE).unwrap();
        resize_tx
            .try_send(Frame::new(FeedId::TERMINAL_RESIZE, b"resize".to_vec()))
            .unwrap();

        let f1 = rx.try_recv().unwrap();
        let f2 = rx.try_recv().unwrap();
        assert_eq!(f1.feed_id, FeedId::TERMINAL_INPUT);
        assert_eq!(f2.feed_id, FeedId::TERMINAL_RESIZE);
    }

    #[test]
    fn test_client_id_counter() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let auth = crate::auth::new_shared_auth_state(0);
        let dev_state = crate::dev::new_shared_dev_state();
        let router = FeedRouter::new("test".into(), auth, shutdown_tx, dev_state);

        assert_eq!(router.next_client_id(), 1);
        assert_eq!(router.next_client_id(), 2);
        assert_eq!(router.next_client_id(), 3);
    }
}
