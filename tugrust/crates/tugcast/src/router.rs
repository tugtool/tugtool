//! Feed router and WebSocket handler
//!
//! Implements the per-client BOOTSTRAP/LIVE state machine for WebSocket connections.
//! Each client gets a snapshot on connect (BOOTSTRAP), then transitions to live
//! streaming (LIVE). If the client falls behind, it re-enters BOOTSTRAP.

use std::time::{Duration, Instant};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time;
use tracing::{debug, error, info, warn};

use tugcast_core::{
    CLOSE_BAD_HANDSHAKE, CLOSE_HANDSHAKE_TIMEOUT, CLOSE_VERSION_MISMATCH, FeedId, Frame,
    HANDSHAKE_TIMEOUT, PROTOCOL_NAME, PROTOCOL_VERSION,
};

use crate::auth::{self, SharedAuthState};
use crate::feeds::terminal;

/// Broadcast channel capacity for terminal output stream
pub const BROADCAST_CAPACITY: usize = 4096;

/// Heartbeat interval (send heartbeat every 15 seconds)
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

/// Heartbeat timeout (close connection if no heartbeat received within 45 seconds)
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);

/// Per-client state machine
#[derive(Debug)]
enum ClientState {
    /// Client is receiving snapshot and buffering live output
    Bootstrap { buffer: Vec<Frame> },
    /// Client is receiving live output directly
    Live,
}

/// Feed router for managing WebSocket connections
#[derive(Clone)]
pub struct FeedRouter {
    terminal_tx: broadcast::Sender<Frame>,
    input_tx: mpsc::Sender<Frame>,
    code_tx: broadcast::Sender<Frame>,
    code_input_tx: mpsc::Sender<Frame>,
    session: String,
    auth: SharedAuthState,
    snapshot_watches: Vec<watch::Receiver<Frame>>,
    pub(crate) shutdown_tx: mpsc::Sender<u8>,
    pub(crate) client_action_tx: broadcast::Sender<Frame>,
    pub(crate) dev_state: crate::dev::SharedDevState,
}

impl FeedRouter {
    /// Create a new feed router
    // Allow many arguments: this constructor wires together all shared state channels
    // (terminal, code, snapshot, shutdown, client_action) plus session and auth.
    // Grouping into a config struct would add indirection without improving clarity.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        terminal_tx: broadcast::Sender<Frame>,
        input_tx: mpsc::Sender<Frame>,
        code_tx: broadcast::Sender<Frame>,
        code_input_tx: mpsc::Sender<Frame>,
        session: String,
        auth: SharedAuthState,
        snapshot_watches: Vec<watch::Receiver<Frame>>,
        shutdown_tx: mpsc::Sender<u8>,
        client_action_tx: broadcast::Sender<Frame>,
        dev_state: crate::dev::SharedDevState,
    ) -> Self {
        Self {
            terminal_tx,
            input_tx,
            code_tx,
            code_input_tx,
            session,
            auth,
            snapshot_watches,
            shutdown_tx,
            client_action_tx,
            dev_state,
        }
    }

    /// Get a clone of the broadcast sender (for the terminal feed)
    pub fn broadcast_sender(&self) -> broadcast::Sender<Frame> {
        self.terminal_tx.clone()
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

/// Handle a WebSocket client connection
async fn handle_client(mut socket: WebSocket, mut router: FeedRouter) {
    info!("Client connected");

    // --- Protocol handshake (v1) ---
    // Wait for the client to send a text frame: {"protocol":"tugcast","version":1}
    // Respond with: {"protocol":"tugcast","version":1,"capabilities":[]}
    // If the handshake fails, close with an application-defined close code.
    if !perform_handshake(&mut socket).await {
        return;
    }

    // Subscribe to terminal output broadcast
    let mut broadcast_rx = router.terminal_tx.subscribe();

    // Subscribe to code output broadcast
    let mut code_rx = router.code_tx.subscribe();

    // Subscribe to client action broadcast
    let mut client_action_rx = router.client_action_tx.subscribe();

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

                // Drain any buffered broadcast messages
                while let Ok(frame) = broadcast_rx.try_recv() {
                    buffer.push(frame);
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
                // borrow_and_update() marks the value as seen so changed() won't fire
                // immediately, preventing double delivery.
                // Take ownership of snapshot_watches so we can move receivers into tasks.
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
                drop(snap_tx); // Drop original sender so channel closes when tasks end

                let mut heartbeat_interval = time::interval(HEARTBEAT_INTERVAL);
                let mut last_heartbeat = Instant::now();

                loop {
                    tokio::select! {
                        // Receive snapshot feed update
                        Some(frame) = snap_rx.recv() => {
                            if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                info!("Client disconnected");
                                return;
                            }
                        }

                        // Receive frame from broadcast channel
                        result = broadcast_rx.recv() => {
                            match result {
                                Ok(frame) => {
                                    if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                        info!("Client disconnected");
                                        return;
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                    warn!("Client lagged {} messages, re-entering BOOTSTRAP", n);
                                    state = ClientState::Bootstrap { buffer: Vec::new() };
                                    break; // Break inner loop to re-enter outer match
                                }
                                Err(broadcast::error::RecvError::Closed) => {
                                    info!("Broadcast channel closed");
                                    return;
                                }
                            }
                        }

                        // Receive frame from code broadcast channel
                        result = code_rx.recv() => {
                            match result {
                                Ok(frame) => {
                                    if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                        info!("Client disconnected");
                                        return;
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                    warn!("Code channel lagged {} messages", n);
                                    // For code, we don't re-bootstrap, just warn
                                }
                                Err(broadcast::error::RecvError::Closed) => {
                                    info!("Code broadcast channel closed");
                                    // Don't return - code is optional
                                }
                            }
                        }

                        // Receive frame from client action broadcast channel
                        result = client_action_rx.recv() => {
                            match result {
                                Ok(frame) => {
                                    if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                        info!("Client disconnected");
                                        return;
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                    warn!("Client action channel lagged {} messages", n);
                                    // For client actions, we don't re-bootstrap, just warn
                                }
                                Err(broadcast::error::RecvError::Closed) => {
                                    info!("Client action broadcast channel closed");
                                    // Continue - client actions are optional
                                }
                            }
                        }

                        // Receive message from client
                        msg = socket.recv() => {
                            match msg {
                                Some(Ok(Message::Binary(data))) => {
                                    if let Ok((frame, _)) = Frame::decode(&data) {
                                        let fid = frame.feed_id;
                                        if fid == FeedId::TERMINAL_INPUT || fid == FeedId::TERMINAL_RESIZE {
                                            let _ = router.input_tx.send(frame).await;
                                        } else if fid == FeedId::CODE_INPUT {
                                            let _ = router.code_input_tx.send(frame).await;
                                        } else if fid == FeedId::HEARTBEAT {
                                            last_heartbeat = Instant::now();
                                            debug!("Heartbeat received from client");
                                        } else if fid == FeedId::CONTROL {
                                            // Parse JSON payload for control action
                                            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&frame.payload) {
                                                if let Some(action) = payload.get("action").and_then(|a| a.as_str()) {
                                                    crate::actions::dispatch_action(
                                                        action,
                                                        &frame.payload,
                                                        &router.shutdown_tx,
                                                        &router.client_action_tx,
                                                        &router.dev_state,
                                                    ).await;
                                                }
                                            }
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

                            // Check for heartbeat timeout
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
            ClientState::Bootstrap { .. } => {} // Bootstrap state verified
            ClientState::Live => panic!("Expected Bootstrap state"),
        }
    }

    #[test]
    fn test_client_state_live_to_bootstrap_on_lagged() {
        let state = ClientState::Live;
        match state {
            ClientState::Live => {} // Live state verified
            ClientState::Bootstrap { .. } => panic!("Expected Live state"),
        }

        // Verify that we can construct Bootstrap state (transition logic)
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
}
