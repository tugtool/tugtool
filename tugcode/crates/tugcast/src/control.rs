use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::{broadcast, mpsc};
use tracing::info;
use tugcast_core::Frame;

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
}

/// Control socket writer half
pub struct ControlWriter {
    writer: BufWriter<OwnedWriteHalf>,
}

impl ControlWriter {
    /// Send ready message to parent
    pub async fn send_ready(
        &mut self,
        auth_url: &str,
        port: u16,
        pid: u32,
    ) -> std::io::Result<()> {
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
        reload_tx: Option<broadcast::Sender<()>>,
    ) {
        let mut line = String::new();

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
                                    &reload_tx,
                                )
                                .await;
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
}
