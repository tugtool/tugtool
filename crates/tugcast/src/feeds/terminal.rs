//! Terminal feed implementation
//!
//! Implements a PTY-tmux bridge that attaches to a tmux session and streams
//! terminal I/O over WebSocket frames.

#![allow(dead_code)]

use std::sync::Mutex;

use async_trait::async_trait;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command as TokioCommand;
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use tugcast_core::{FeedId, Frame, StreamFeed};

/// Size of the PTY read buffer
const READ_BUF_SIZE: usize = 8192;

/// Size of the input channel (for terminal input and resize frames)
const INPUT_CHANNEL_SIZE: usize = 256;

/// Resize payload structure
#[derive(Deserialize, Debug)]
struct ResizePayload {
    cols: u16,
    rows: u16,
}

/// Terminal feed errors
#[derive(Debug, thiserror::Error)]
pub enum TmuxError {
    #[error("tmux not found or version check failed: {0}")]
    NotFound(String),

    #[error("tmux version {found} is below minimum {required}")]
    VersionTooOld { found: String, required: String },

    #[error("tmux command failed: {0}")]
    CommandFailed(String),

    #[error("PTY error: {0}")]
    PtyError(String),
}

/// Check tmux version (must be >= 3.0)
pub async fn check_tmux_version() -> Result<String, TmuxError> {
    let output = TokioCommand::new("tmux")
        .arg("-V")
        .output()
        .await
        .map_err(|e| TmuxError::NotFound(e.to_string()))?;

    if !output.status.success() {
        return Err(TmuxError::NotFound("tmux -V failed".to_string()));
    }

    let version_str = String::from_utf8_lossy(&output.stdout);
    let version = version_str.trim();

    // Parse version string like "tmux 3.4" or "tmux 3.3a"
    if let Some(version_num) = version.split_whitespace().nth(1) {
        // Extract major version number
        if let Some(major) = version_num.chars().next().and_then(|c| c.to_digit(10)) {
            if major >= 3 {
                return Ok(version.to_string());
            }
            return Err(TmuxError::VersionTooOld {
                found: version.to_string(),
                required: "3.0".to_string(),
            });
        }
    }

    Err(TmuxError::NotFound(format!(
        "could not parse version: {}",
        version
    )))
}

/// Ensure a tmux session exists (create if it doesn't)
pub async fn ensure_session(session: &str) -> Result<(), TmuxError> {
    // Check if session exists
    let status = TokioCommand::new("tmux")
        .args(["has-session", "-t", session])
        .status()
        .await
        .map_err(|e| TmuxError::CommandFailed(e.to_string()))?;

    if status.success() {
        info!(session = %session, "tmux session exists");
        return Ok(());
    }

    // Create new session
    info!(session = %session, "creating new tmux session");
    let status = TokioCommand::new("tmux")
        .args(["new-session", "-d", "-s", session])
        .status()
        .await
        .map_err(|e| TmuxError::CommandFailed(e.to_string()))?;

    if !status.success() {
        return Err(TmuxError::CommandFailed(format!(
            "failed to create session {}",
            session
        )));
    }

    Ok(())
}

/// Capture current tmux pane content
pub async fn capture_pane(session: &str) -> Result<Vec<u8>, TmuxError> {
    let output = TokioCommand::new("tmux")
        .args(["capture-pane", "-t", session, "-p", "-e"])
        .output()
        .await
        .map_err(|e| TmuxError::CommandFailed(e.to_string()))?;

    if !output.status.success() {
        return Err(TmuxError::CommandFailed(format!(
            "capture-pane failed for session {}",
            session
        )));
    }

    Ok(output.stdout)
}

/// Terminal feed that bridges PTY to WebSocket frames
pub struct TerminalFeed {
    session: String,
    input_tx: mpsc::Sender<Frame>,
    input_rx: Mutex<Option<mpsc::Receiver<Frame>>>,
}

impl TerminalFeed {
    /// Create a new terminal feed for the given tmux session
    pub fn new(session: String) -> Self {
        let (input_tx, input_rx) = mpsc::channel(INPUT_CHANNEL_SIZE);

        Self {
            session,
            input_tx,
            input_rx: Mutex::new(Some(input_rx)),
        }
    }

    /// Get a sender for input frames (used by the router)
    pub fn input_sender(&self) -> mpsc::Sender<Frame> {
        self.input_tx.clone()
    }
}

#[async_trait]
impl StreamFeed for TerminalFeed {
    fn feed_id(&self) -> FeedId {
        FeedId::TerminalOutput
    }

    fn name(&self) -> &str {
        "terminal"
    }

    async fn run(&self, tx: broadcast::Sender<Frame>, cancel: CancellationToken) {
        // Take the input receiver (can only run once)
        let mut input_rx = match self.input_rx.lock().unwrap().take() {
            Some(rx) => rx,
            None => {
                error!("terminal feed run() called multiple times");
                return;
            }
        };

        info!(session = %self.session, "starting terminal feed");

        // Open PTY
        let (pty, pts) = match pty_process::open() {
            Ok(pair) => pair,
            Err(e) => {
                error!("failed to open PTY: {}", e);
                return;
            }
        };

        // Set initial size
        if let Err(e) = pty.resize(pty_process::Size::new(24, 80)) {
            error!("failed to set initial PTY size: {}", e);
            return;
        }

        // Spawn tmux attach-session
        let _child = match pty_process::Command::new("tmux")
            .arg("attach-session")
            .arg("-t")
            .arg(&self.session)
            .spawn(pts)
        {
            Ok(child) => child,
            Err(e) => {
                error!("failed to spawn tmux attach: {}", e);
                return;
            }
        };

        // Split PTY into reader and writer
        let (mut reader, mut writer) = pty.into_split();

        // Spawn read loop task
        let read_tx = tx.clone();
        let read_cancel = cancel.clone();
        let read_task = tokio::spawn(async move {
            let mut buf = vec![0u8; READ_BUF_SIZE];
            loop {
                tokio::select! {
                    _ = read_cancel.cancelled() => {
                        debug!("PTY read loop cancelled");
                        break;
                    }
                    result = reader.read(&mut buf) => {
                        match result {
                            Ok(0) => {
                                info!("PTY read EOF");
                                break;
                            }
                            Ok(n) => {
                                let frame = Frame::new(FeedId::TerminalOutput, buf[..n].to_vec());
                                if read_tx.send(frame).is_err() {
                                    debug!("no broadcast receivers");
                                }
                            }
                            Err(e) => {
                                error!("PTY read error: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        });

        // Spawn write/resize loop task
        let write_cancel = cancel.clone();
        let session_clone = self.session.clone();
        let write_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = write_cancel.cancelled() => {
                        debug!("PTY write loop cancelled");
                        break;
                    }
                    Some(frame) = input_rx.recv() => {
                        match frame.feed_id {
                            FeedId::TerminalInput => {
                                if let Err(e) = writer.write_all(&frame.payload).await {
                                    error!("PTY write error: {}", e);
                                    break;
                                }
                            }
                            FeedId::TerminalResize => {
                                // Parse resize payload and run tmux resize-pane
                                if let Ok(resize) = serde_json::from_slice::<ResizePayload>(&frame.payload) {
                                    let _ = TokioCommand::new("tmux")
                                        .args([
                                            "resize-pane",
                                            "-t",
                                            &session_clone,
                                            "-x",
                                            &resize.cols.to_string(),
                                            "-y",
                                            &resize.rows.to_string(),
                                        ])
                                        .output()
                                        .await;
                                    info!(cols = resize.cols, rows = resize.rows, "terminal resized");
                                } else {
                                    warn!("failed to parse resize payload");
                                }
                            }
                            _ => {
                                // Ignore other feed IDs
                            }
                        }
                    }
                }
            }
        });

        // Wait for cancellation or task completion
        tokio::select! {
            _ = cancel.cancelled() => {
                info!("terminal feed shutting down");
            }
            _ = read_task => {
                info!("PTY read loop ended");
            }
            _ = write_task => {
                info!("PTY write loop ended");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feedid_mapping() {
        let feed = TerminalFeed::new("test-session".to_string());
        assert_eq!(feed.feed_id(), FeedId::TerminalOutput);
    }

    #[test]
    fn test_feed_name() {
        let feed = TerminalFeed::new("test-session".to_string());
        assert_eq!(feed.name(), "terminal");
    }

    #[test]
    fn test_resize_payload_parsing() {
        let json = r#"{"cols": 80, "rows": 24}"#;
        let payload: ResizePayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.cols, 80);
        assert_eq!(payload.rows, 24);
    }

    #[test]
    fn test_input_sender_cloneable() {
        let feed = TerminalFeed::new("test-session".to_string());
        let sender1 = feed.input_sender();
        let sender2 = feed.input_sender();
        // Both senders should work
        assert_eq!(sender1.capacity(), INPUT_CHANNEL_SIZE);
        assert_eq!(sender2.capacity(), INPUT_CHANNEL_SIZE);
    }

    #[tokio::test]
    #[ignore] // Requires tmux installed
    async fn test_check_tmux_version() {
        let result = check_tmux_version().await;
        match result {
            Ok(version) => {
                println!("tmux version: {}", version);
                assert!(version.contains("tmux"));
            }
            Err(e) => {
                panic!("tmux version check failed: {}", e);
            }
        }
    }

    #[tokio::test]
    #[ignore] // Requires tmux installed
    async fn test_ensure_session_creates() {
        let session = "tugcast-test-session";

        // Clean up any existing test session
        let _ = TokioCommand::new("tmux")
            .args(["kill-session", "-t", session])
            .status()
            .await;

        // Create session
        let result = ensure_session(session).await;
        assert!(result.is_ok());

        // Verify it exists
        let status = TokioCommand::new("tmux")
            .args(["has-session", "-t", session])
            .status()
            .await
            .unwrap();
        assert!(status.success());

        // Clean up
        let _ = TokioCommand::new("tmux")
            .args(["kill-session", "-t", session])
            .status()
            .await;
    }

    #[tokio::test]
    #[ignore] // Requires tmux installed
    async fn test_capture_pane() {
        let session = "tugcast-test-capture";

        // Clean up any existing test session
        let _ = TokioCommand::new("tmux")
            .args(["kill-session", "-t", session])
            .status()
            .await;

        // Create session
        ensure_session(session).await.unwrap();

        // Send some text to the session
        let _ = TokioCommand::new("tmux")
            .args(["send-keys", "-t", session, "echo 'test'", "Enter"])
            .status()
            .await;

        // Wait a bit for output
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Capture pane
        let output = capture_pane(session).await.unwrap();
        assert!(!output.is_empty());

        // Clean up
        let _ = TokioCommand::new("tmux")
            .args(["kill-session", "-t", session])
            .status()
            .await;
    }
}
