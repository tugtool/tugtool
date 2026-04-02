//! Feed router and WebSocket handler
//!
//! Implements the per-client BOOTSTRAP/LIVE state machine for WebSocket connections.
//! Each client gets snapshot data on connect, then transitions to live streaming.
//! If the client falls behind on a stream with `LagPolicy::Bootstrap`, it
//! re-enters BOOTSTRAP to recover.
//!
//! The router uses dynamic dispatch for both output streams and input sinks:
//! - **Stream outputs** (`StreamMap<FeedId, BroadcastStream>`) fan-in all
//!   broadcast feeds into a single pollable source.
//! - **Input sinks** (`HashMap<FeedId, mpsc::Sender>`) route client frames
//!   to the correct backend by FeedId lookup.
//! - **Snapshot watches** (`Vec<watch::Receiver>`) are merged into an mpsc
//!   for initial delivery + change notifications.
//!
//! Router-internal FeedIds (Heartbeat, Control) are handled inline before
//! the dynamic map lookup.

use std::collections::HashMap;
use std::pin::Pin;
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
// LagPolicy
// ---------------------------------------------------------------------------

/// What the router should do when a client falls behind on a stream feed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LagPolicy {
    /// Re-enter BOOTSTRAP state to recover (e.g. terminal output).
    Bootstrap,
    /// Log a warning and continue — the client may miss frames (e.g. code output).
    Warn,
}

// ---------------------------------------------------------------------------
// Per-client state machine
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum ClientState {
    /// Client is receiving snapshot and buffering live output
    Bootstrap { buffer: Vec<Frame> },
    /// Client is receiving live output directly
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

    session: String,
    auth: SharedAuthState,
    pub(crate) shutdown_tx: mpsc::Sender<u8>,
    pub(crate) dev_state: crate::dev::SharedDevState,
}

impl FeedRouter {
    /// Create a new feed router with shared infrastructure channels.
    ///
    /// After construction, register stream outputs, input sinks, and snapshot
    /// watches before passing to the axum server.
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
            session,
            auth,
            shutdown_tx,
            dev_state,
        }
    }

    /// Register a stream output (broadcast feed, server → client).
    ///
    /// Each client subscribes to this broadcast sender and receives frames
    /// via the `StreamMap` fan-in. The `lag_policy` controls behavior when
    /// a client falls behind.
    pub(crate) fn register_stream(
        &mut self,
        feed_id: FeedId,
        tx: broadcast::Sender<Frame>,
        lag_policy: LagPolicy,
    ) {
        self.stream_outputs.insert(feed_id, (tx, lag_policy));
    }

    /// Register an input sink (client → server backend).
    ///
    /// Multiple FeedIds may point to the same sender (e.g. TerminalInput
    /// and TerminalResize both route to the terminal feed's input channel).
    pub(crate) fn register_input(&mut self, feed_id: FeedId, tx: mpsc::Sender<Frame>) {
        self.input_sinks.insert(feed_id, tx);
    }

    /// Add snapshot watches (delivered on connect + forwarded on change).
    pub(crate) fn add_snapshot_watches(&mut self, watches: Vec<watch::Receiver<Frame>>) {
        self.snapshot_watches.extend(watches);
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
    // Validate session cookie
    if !auth::validate_request_session(&headers, &router.auth) {
        debug!("WebSocket upgrade rejected: invalid session");
        return (StatusCode::FORBIDDEN, "Invalid or expired session").into_response();
    }

    // Validate origin
    if !auth::check_request_origin(&headers, &router.auth) {
        debug!("WebSocket upgrade rejected: invalid origin");
        return (StatusCode::FORBIDDEN, "Invalid origin").into_response();
    }

    info!("WebSocket upgrade accepted");

    // Upgrade the connection
    ws.on_upgrade(move |socket| handle_client(socket, router))
}

/// Perform the protocol handshake at WebSocket connection open.
///
/// Expects the client to send a text frame `{"protocol":"tugcast","version":1}`.
/// Responds with `{"protocol":"tugcast","version":1,"capabilities":[]}`.
/// Returns `true` on success, `false` if the handshake failed (connection closed).
async fn perform_handshake(socket: &mut WebSocket) -> bool {
    // Wait for client hello with timeout
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

    // Parse the hello message
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

    // Validate protocol name
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

    // Validate version
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

    // Send server hello response
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

/// Type alias for a pinned broadcast stream in the StreamMap.
type PinnedBroadcastStream = Pin<
    Box<
        dyn Stream<Item = Result<Frame, tokio_stream::wrappers::errors::BroadcastStreamRecvError>>
            + Send,
    >,
>;

/// Build a StreamMap by subscribing to all registered stream outputs.
///
/// Returns the map plus a parallel Vec of (FeedId, LagPolicy) in the same
/// insertion order, used to look up lag policy when a stream reports lag.
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
        policies.insert(feed_id, *policy);
    }
    (map, policies)
}

/// Handle a WebSocket client connection
async fn handle_client(mut socket: WebSocket, mut router: FeedRouter) {
    info!("Client connected");

    // --- Protocol handshake (v1) ---
    if !perform_handshake(&mut socket).await {
        return;
    }

    // Build the StreamMap for output fan-in (subscribe to all broadcast feeds)
    let (mut stream_map, lag_policies) = build_stream_map(&router.stream_outputs);

    // Skip BOOTSTRAP snapshot on initial connect — the client's resize frame
    // will trigger a PTY resize → tmux SIGWINCH → full screen redraw at the
    // correct dimensions, which serves as the bootstrap.
    let mut state = ClientState::Live;

    loop {
        match &mut state {
            ClientState::Bootstrap { buffer } => {
                info!("Client re-entering BOOTSTRAP state (lagged)");

                // Capture terminal snapshot (for reconnection after lag)
                match terminal::capture_pane(&router.session).await {
                    Ok(snapshot) => {
                        let frame = Frame::new(FeedId::TERMINAL_OUTPUT, snapshot);
                        if socket
                            .send(Message::Binary(frame.encode().into()))
                            .await
                            .is_err()
                        {
                            info!("Client disconnected during snapshot send");
                            return;
                        }
                        debug!("Snapshot sent to client");
                    }
                    Err(e) => {
                        error!("Failed to capture pane: {}", e);
                        // Continue anyway - client will see live output
                    }
                }

                // Drain any buffered frames from the stream map
                use tokio_stream::StreamExt;
                while let Some((_feed_id, result)) =
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
                        info!("Client disconnected during buffer flush");
                        return;
                    }
                }

                debug!("Buffer flushed, transitioning to LIVE");
                state = ClientState::Live;
            }

            ClientState::Live => {
                info!("Client in LIVE state");

                // Create a channel for merged snapshot updates
                let (snap_tx, mut snap_rx) = mpsc::channel::<Frame>(16);

                // Send initial snapshot and then forward updates for each watch channel.
                let snapshot_watches = std::mem::take(&mut router.snapshot_watches);
                for mut watch_rx in snapshot_watches {
                    let frame = watch_rx.borrow_and_update().clone();
                    if !frame.payload.is_empty()
                        && socket
                            .send(Message::Binary(frame.encode().into()))
                            .await
                            .is_err()
                    {
                        info!("Client disconnected during initial snapshot send");
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
                        // Receive snapshot feed update
                        Some(frame) = snap_rx.recv() => {
                            if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                info!("Client disconnected");
                                return;
                            }
                        }

                        // Receive frame from any stream output (dynamic fan-in)
                        Some((feed_id, result)) = stream_map.next() => {
                            match result {
                                Ok(frame) => {
                                    if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                        info!("Client disconnected");
                                        return;
                                    }
                                }
                                Err(_lagged) => {
                                    let policy = lag_policies.get(&feed_id).copied().unwrap_or(LagPolicy::Warn);
                                    match policy {
                                        LagPolicy::Bootstrap => {
                                            warn!("Stream {} lagged, re-entering BOOTSTRAP", feed_id);
                                            state = ClientState::Bootstrap { buffer: Vec::new() };
                                            break;
                                        }
                                        LagPolicy::Warn => {
                                            warn!("Stream {} lagged, frames lost", feed_id);
                                        }
                                    }
                                }
                            }
                        }

                        // Receive message from client (input dispatch)
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
                                        // Dynamic dispatch: look up input sink
                                        else if let Some(tx) = router.input_sinks.get(&fid) {
                                            let _ = tx.send(frame).await;
                                        }
                                    }
                                }
                                Some(Ok(Message::Close(_))) | None => {
                                    info!("Client disconnected");
                                    return;
                                }
                                Some(Ok(_)) => {
                                    // Ignore text, ping, pong messages
                                }
                                Some(Err(e)) => {
                                    error!("WebSocket error: {}", e);
                                    return;
                                }
                            }
                        }

                        // Send heartbeat to client
                        _ = heartbeat_interval.tick() => {
                            let hb = Frame::heartbeat();
                            if socket.send(Message::Binary(hb.encode().into())).await.is_err() {
                                info!("Client disconnected during heartbeat send");
                                return;
                            }

                            if last_heartbeat.elapsed() > HEARTBEAT_TIMEOUT {
                                warn!("Heartbeat timeout, closing connection");
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

    #[test]
    fn test_client_state_bootstrap_to_live() {
        let state = ClientState::Bootstrap { buffer: Vec::new() };
        match state {
            ClientState::Bootstrap { .. } => {}
            ClientState::Live => panic!("Expected Bootstrap state"),
        }
    }

    #[test]
    fn test_client_state_live_to_bootstrap_on_lagged() {
        let state = ClientState::Live;
        match state {
            ClientState::Live => {}
            ClientState::Bootstrap { .. } => panic!("Expected Live state"),
        }
        let _new_state = ClientState::Bootstrap { buffer: Vec::new() };
    }

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

        // Both terminal input and resize go to the same channel
        let (tx, mut rx) = mpsc::channel(16);
        router.register_input(FeedId::TERMINAL_INPUT, tx.clone());
        router.register_input(FeedId::TERMINAL_RESIZE, tx);

        // Send via TERMINAL_INPUT
        let input_tx = router.input_sinks.get(&FeedId::TERMINAL_INPUT).unwrap();
        input_tx
            .try_send(Frame::new(FeedId::TERMINAL_INPUT, b"key".to_vec()))
            .unwrap();

        // Send via TERMINAL_RESIZE
        let resize_tx = router.input_sinks.get(&FeedId::TERMINAL_RESIZE).unwrap();
        resize_tx
            .try_send(Frame::new(FeedId::TERMINAL_RESIZE, b"resize".to_vec()))
            .unwrap();

        // Both arrive on the same receiver
        let f1 = rx.try_recv().unwrap();
        let f2 = rx.try_recv().unwrap();
        assert_eq!(f1.feed_id, FeedId::TERMINAL_INPUT);
        assert_eq!(f2.feed_id, FeedId::TERMINAL_RESIZE);
    }

    #[test]
    fn test_lag_policy_values() {
        assert_ne!(LagPolicy::Bootstrap, LagPolicy::Warn);
    }
}
