use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::UnixStream;
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::{broadcast, mpsc};
use tracing::info;
use tugcast_core::{FeedId, Frame};

/// Control message received from parent process over UDS
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ControlMessage {
    Tell {
        action: String,
        #[serde(flatten)]
        payload: serde_json::Value,
    },
    Shutdown,
    DevMode {
        enabled: bool,
        #[serde(default)]
        source_tree: Option<String>,
    },
}

/// Control socket writer half
pub struct ControlWriter {
    writer: BufWriter<OwnedWriteHalf>,
}

impl ControlWriter {
    /// Send ready message to parent
    pub async fn send_ready(&mut self, auth_url: &str, port: u16, pid: u32) -> std::io::Result<()> {
        #[derive(Serialize)]
        struct ReadyMessage<'a> {
            r#type: &'static str,
            auth_url: &'a str,
            port: u16,
            pid: u32,
        }

        let msg = ReadyMessage {
            r#type: "ready",
            auth_url,
            port,
            pid,
        };

        let json = serde_json::to_string(&msg)?;
        self.writer.write_all(json.as_bytes()).await?;
        self.writer.write_all(b"\n").await?;
        self.writer.flush().await?;
        Ok(())
    }

    /// Send shutdown message to parent
    #[allow(dead_code)] // Replaced by make_shutdown_message + draining task in Step 3
    pub async fn send_shutdown(&mut self, reason: &str, pid: u32) -> std::io::Result<()> {
        #[derive(Serialize)]
        struct ShutdownMessage<'a> {
            r#type: &'static str,
            reason: &'a str,
            pid: u32,
        }

        let msg = ShutdownMessage {
            r#type: "shutdown",
            reason,
            pid,
        };

        let json = serde_json::to_string(&msg)?;
        self.writer.write_all(json.as_bytes()).await?;
        self.writer.write_all(b"\n").await?;
        self.writer.flush().await?;
        Ok(())
    }

    /// Extract inner writer for use by draining task
    pub(crate) fn into_inner(self) -> BufWriter<OwnedWriteHalf> {
        self.writer
    }
}

/// Control socket reader half
pub struct ControlReader {
    reader: BufReader<OwnedReadHalf>,
}

impl ControlReader {
    /// Run receive loop, reading messages from parent and dispatching actions
    pub async fn run_recv_loop(
        mut self,
        shutdown_tx: mpsc::Sender<u8>,
        client_action_tx: broadcast::Sender<Frame>,
        shared_dev_state: crate::dev::SharedDevState,
        response_tx: mpsc::Sender<String>,
    ) {
        let mut line = String::new();
        let mut dev_runtime: Option<crate::dev::DevRuntime> = None;

        loop {
            line.clear();
            match self.reader.read_line(&mut line).await {
                Ok(0) => {
                    // EOF: parent disconnected
                    info!("Control socket: parent disconnected (EOF)");
                    return;
                }
                Ok(_) => {
                    // Parse message
                    match serde_json::from_str::<ControlMessage>(&line) {
                        Ok(ControlMessage::Tell { action, payload }) => {
                            // Re-serialize the full payload (including action) for dispatch
                            let mut full_payload = payload.clone();
                            full_payload["action"] = serde_json::Value::String(action.clone());
                            if let Ok(bytes) = serde_json::to_vec(&full_payload) {
                                crate::actions::dispatch_action(
                                    &action,
                                    &bytes,
                                    &shutdown_tx,
                                    &client_action_tx,
                                )
                                .await;
                            }
                        }
                        Ok(ControlMessage::DevMode {
                            enabled,
                            source_tree,
                        }) => {
                            if enabled {
                                // If already enabled, teardown old watcher first
                                if let Some(runtime) = dev_runtime.take() {
                                    crate::dev::disable_dev_mode(runtime, &shared_dev_state);
                                }

                                let source_path = match source_tree {
                                    Some(p) => std::path::PathBuf::from(p),
                                    None => {
                                        let _ = response_tx
                                            .send(make_dev_mode_result(
                                                false,
                                                Some(
                                                    "source_tree is required when enabled is true",
                                                ),
                                            ))
                                            .await;
                                        continue;
                                    }
                                };

                                match crate::dev::enable_dev_mode(
                                    source_path,
                                    &shared_dev_state,
                                    client_action_tx.clone(),
                                    shutdown_tx.clone(),
                                )
                                .await
                                {
                                    Ok(runtime) => {
                                        dev_runtime = Some(runtime);
                                        let _ = response_tx
                                            .send(make_dev_mode_result(true, None))
                                            .await;

                                        // Broadcast reload_frontend for mid-session toggles (per D11)
                                        let payload = br#"{"action":"reload_frontend"}"#;
                                        let frame = Frame::new(FeedId::Control, payload.to_vec());
                                        let _ = client_action_tx.send(frame);
                                    }
                                    Err(e) => {
                                        let _ = response_tx
                                            .send(make_dev_mode_result(false, Some(&e)))
                                            .await;
                                    }
                                }
                            } else {
                                // Disable
                                if let Some(runtime) = dev_runtime.take() {
                                    crate::dev::disable_dev_mode(runtime, &shared_dev_state);
                                }
                                let _ = response_tx.send(make_dev_mode_result(true, None)).await;
                            }
                        }
                        Ok(ControlMessage::Shutdown) => {
                            info!("Control socket: shutdown requested by parent");
                            let _ = shutdown_tx.send(0).await;
                            return;
                        }
                        Err(e) => {
                            info!("Control socket: failed to parse message: {}", e);
                            // Continue reading
                        }
                    }
                }
                Err(e) => {
                    info!("Control socket: read error: {}", e);
                    return;
                }
            }
        }
    }
}

/// Control socket connection
pub struct ControlSocket {
    writer: BufWriter<OwnedWriteHalf>,
    reader: BufReader<OwnedReadHalf>,
}

impl ControlSocket {
    /// Connect to control socket at the given path
    pub async fn connect(path: &Path) -> std::io::Result<Self> {
        let stream = UnixStream::connect(path).await?;
        let (read_half, write_half) = stream.into_split();
        Ok(Self {
            writer: BufWriter::new(write_half),
            reader: BufReader::new(read_half),
        })
    }

    /// Split into separate reader and writer halves
    pub fn split(self) -> (ControlWriter, ControlReader) {
        (
            ControlWriter {
                writer: self.writer,
            },
            ControlReader {
                reader: self.reader,
            },
        )
    }
}

/// Serialize dev_mode_result message
pub(crate) fn make_dev_mode_result(success: bool, error: Option<&str>) -> String {
    if let Some(err) = error {
        serde_json::json!({
            "type": "dev_mode_result",
            "success": success,
            "error": err
        })
        .to_string()
    } else {
        serde_json::json!({
            "type": "dev_mode_result",
            "success": success
        })
        .to_string()
    }
}

/// Serialize shutdown message
pub(crate) fn make_shutdown_message(reason: &str, pid: u32) -> String {
    serde_json::json!({
        "type": "shutdown",
        "reason": reason,
        "pid": pid
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_control_message_tell_deserialization() {
        let json = r#"{"type":"tell","action":"restart"}"#;
        let msg: ControlMessage = serde_json::from_str(json).unwrap();
        match msg {
            ControlMessage::Tell { action, .. } => {
                assert_eq!(action, "restart");
            }
            _ => panic!("Expected Tell variant"),
        }
    }

    #[test]
    fn test_control_message_shutdown_deserialization() {
        let json = r#"{"type":"shutdown"}"#;
        let msg: ControlMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ControlMessage::Shutdown));
    }

    #[test]
    fn test_ready_message_format() {
        #[derive(Serialize)]
        struct ReadyMessage<'a> {
            r#type: &'static str,
            auth_url: &'a str,
            port: u16,
            pid: u32,
        }

        let msg = ReadyMessage {
            r#type: "ready",
            auth_url: "http://127.0.0.1:7890/auth?token=abc",
            port: 7890,
            pid: 12345,
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"ready""#));
        assert!(json.contains(r#""auth_url":"http://127.0.0.1:7890/auth?token=abc""#));
        assert!(json.contains(r#""port":7890"#));
        assert!(json.contains(r#""pid":12345"#));
    }

    #[test]
    fn test_shutdown_message_format() {
        #[derive(Serialize)]
        struct ShutdownMessage<'a> {
            r#type: &'static str,
            reason: &'a str,
            pid: u32,
        }

        let msg = ShutdownMessage {
            r#type: "shutdown",
            reason: "restart",
            pid: 12345,
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"shutdown""#));
        assert!(json.contains(r#""reason":"restart""#));
        assert!(json.contains(r#""pid":12345"#));
    }

    #[tokio::test]
    async fn test_connect_send_ready_recv() {
        use std::os::unix::fs::PermissionsExt;
        use tokio::net::UnixListener;

        // Create temporary socket path
        let dir = tempfile::tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        // Create listener
        let listener = UnixListener::bind(&socket_path).unwrap();

        // Set permissions (Unix sockets need to be writable)
        std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o777)).ok();

        // Spawn task to connect and send ready
        let socket_path_clone = socket_path.clone();
        let handle = tokio::spawn(async move {
            let cs = ControlSocket::connect(&socket_path_clone).await.unwrap();
            let (mut writer, _) = cs.split();
            writer
                .send_ready("http://127.0.0.1:7890/auth?token=test", 7890, 999)
                .await
                .unwrap();
        });

        // Accept connection and read message
        let (stream, _) = listener.accept().await.unwrap();
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();

        // Verify message format
        let msg: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(msg["type"], "ready");
        assert_eq!(msg["auth_url"], "http://127.0.0.1:7890/auth?token=test");
        assert_eq!(msg["port"], 7890);
        assert_eq!(msg["pid"], 999);

        handle.await.unwrap();
    }

    #[test]
    fn test_control_message_dev_mode_enable_deserialization() {
        let json = r#"{"type":"dev_mode","enabled":true,"source_tree":"/path/to/src"}"#;
        let msg: ControlMessage = serde_json::from_str(json).unwrap();
        match msg {
            ControlMessage::DevMode {
                enabled,
                source_tree,
            } => {
                assert!(enabled);
                assert_eq!(source_tree, Some("/path/to/src".to_string()));
            }
            _ => panic!("Expected DevMode variant"),
        }
    }

    #[test]
    fn test_control_message_dev_mode_disable_deserialization() {
        let json = r#"{"type":"dev_mode","enabled":false}"#;
        let msg: ControlMessage = serde_json::from_str(json).unwrap();
        match msg {
            ControlMessage::DevMode {
                enabled,
                source_tree,
            } => {
                assert!(!enabled);
                assert_eq!(source_tree, None);
            }
            _ => panic!("Expected DevMode variant"),
        }
    }

    #[test]
    fn test_make_dev_mode_result_success() {
        let result = make_dev_mode_result(true, None);
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["type"], "dev_mode_result");
        assert_eq!(parsed["success"], true);
        assert!(parsed.get("error").is_none());
    }

    #[test]
    fn test_make_dev_mode_result_error() {
        let result = make_dev_mode_result(false, Some("load failed"));
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["type"], "dev_mode_result");
        assert_eq!(parsed["success"], false);
        assert_eq!(parsed["error"], "load failed");
    }

    #[test]
    fn test_make_shutdown_message() {
        let result = make_shutdown_message("restart", 12345);
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["type"], "shutdown");
        assert_eq!(parsed["reason"], "restart");
        assert_eq!(parsed["pid"], 12345);
    }
}
