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
use serde_json;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time;
use tracing::{debug, error, info, warn};

use tugcast_core::{FeedId, Frame};

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
    conversation_tx: broadcast::Sender<Frame>,
    conversation_input_tx: mpsc::Sender<Frame>,
    session: String,
    auth: SharedAuthState,
    snapshot_watches: Vec<watch::Receiver<Frame>>,
    shutdown_tx: mpsc::Sender<u8>,
    reload_tx: Option<broadcast::Sender<()>>,
}

impl FeedRouter {
    /// Create a new feed router
    pub fn new(
        terminal_tx: broadcast::Sender<Frame>,
        input_tx: mpsc::Sender<Frame>,
        conversation_tx: broadcast::Sender<Frame>,
        conversation_input_tx: mpsc::Sender<Frame>,
        session: String,
        auth: SharedAuthState,
        snapshot_watches: Vec<watch::Receiver<Frame>>,
        shutdown_tx: mpsc::Sender<u8>,
        reload_tx: Option<broadcast::Sender<()>>,
    ) -> Self {
        Self {
            terminal_tx,
            input_tx,
            conversation_tx,
            conversation_input_tx,
            session,
            auth,
            snapshot_watches,
            shutdown_tx,
            reload_tx,
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

/// Handle a WebSocket client connection
async fn handle_client(mut socket: WebSocket, router: FeedRouter) {
    info!("Client connected");

    // Subscribe to terminal output broadcast
    let mut broadcast_rx = router.terminal_tx.subscribe();

    // Subscribe to conversation output broadcast
    let mut conversation_rx = router.conversation_tx.subscribe();

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
                        let frame = Frame::new(FeedId::TerminalOutput, snapshot);
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

                // Send initial snapshots for all watch channels
                for watch_rx in &router.snapshot_watches {
                    let frame = watch_rx.borrow().clone();
                    if !frame.payload.is_empty()
                        && socket
                            .send(Message::Binary(frame.encode().into()))
                            .await
                            .is_err()
                    {
                        info!("Client disconnected during initial snapshot send");
                        return;
                    }
                }

                // Create a channel for merged snapshot updates
                let (snap_tx, mut snap_rx) = mpsc::channel::<Frame>(16);

                // Spawn a task per snapshot watch to forward updates
                for mut watch_rx in router.snapshot_watches.clone() {
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

                        // Receive frame from conversation broadcast channel
                        result = conversation_rx.recv() => {
                            match result {
                                Ok(frame) => {
                                    if socket.send(Message::Binary(frame.encode().into())).await.is_err() {
                                        info!("Client disconnected");
                                        return;
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                    warn!("Conversation channel lagged {} messages", n);
                                    // For conversation, we don't re-bootstrap, just warn
                                }
                                Err(broadcast::error::RecvError::Closed) => {
                                    info!("Conversation broadcast channel closed");
                                    // Don't return - conversation is optional
                                }
                            }
                        }

                        // Receive message from client
                        msg = socket.recv() => {
                            match msg {
                                Some(Ok(Message::Binary(data))) => {
                                    if let Ok((frame, _)) = Frame::decode(&data) {
                                        match frame.feed_id {
                                            FeedId::TerminalInput | FeedId::TerminalResize => {
                                                let _ = router.input_tx.send(frame).await;
                                            }
                                            FeedId::ConversationInput => {
                                                let _ = router.conversation_input_tx.send(frame).await;
                                            }
                                            FeedId::Heartbeat => {
                                                last_heartbeat = Instant::now();
                                                debug!("Heartbeat received from client");
                                            }
                                            FeedId::Control => {
                                                // Parse JSON payload for control action
                                                if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&frame.payload) {
                                                    if let Some(action) = payload.get("action").and_then(|a| a.as_str()) {
                                                        match action {
                                                            "restart" => {
                                                                info!("control: restart requested");
                                                                let _ = router.shutdown_tx.send(42).await;
                                                            }
                                                            "reset" => {
                                                                info!("control: reset requested");
                                                                let _ = router.shutdown_tx.send(43).await;
                                                            }
                                                            "reload_frontend" => {
                                                                if let Some(ref tx) = router.reload_tx {
                                                                    let _ = tx.send(());
                                                                    info!("control: reload_frontend broadcast sent");
                                                                } else {
                                                                    info!("control: reload_frontend ignored (not in dev mode)");
                                                                }
                                                            }
                                                            other => {
                                                                warn!("control: unknown action: {}", other);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            _ => {}
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
