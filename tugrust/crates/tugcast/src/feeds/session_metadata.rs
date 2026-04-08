//! Session metadata snapshot feed.
//!
//! Subscribes to the CODE_OUTPUT broadcast, filters for `system_metadata`
//! events, and republishes the latest one on a dedicated watch channel
//! (FeedId::SESSION_METADATA). Late-connecting clients receive the current
//! metadata via the watch channel's `borrow_and_update()` on handshake.
//!
//! This follows the same snapshot-feed pattern as FILESYSTEM, GIT, and
//! DEFAULTS — the router delivers the current watch value to every new
//! client before streaming begins.

use tokio::sync::{broadcast, watch};
use tokio_util::sync::CancellationToken;
use tracing::info;
use tugcast_core::{FeedId, Frame};

/// Needle bytes for identifying system_metadata events without a full
/// JSON parse. The CODE_OUTPUT stream is high-volume; scanning bytes
/// is significantly cheaper than deserializing every frame.
const SYSTEM_METADATA_NEEDLE: &[u8] = b"\"type\":\"system_metadata\"";

/// Filters `system_metadata` events from the CODE_OUTPUT broadcast and
/// publishes them as snapshot frames on SESSION_METADATA.
pub struct SessionMetadataFeed {
    code_rx: broadcast::Receiver<Frame>,
}

impl SessionMetadataFeed {
    pub fn new(code_rx: broadcast::Receiver<Frame>) -> Self {
        Self { code_rx }
    }

    pub async fn run(mut self, tx: watch::Sender<Frame>, cancel: CancellationToken) {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                result = self.code_rx.recv() => {
                    match result {
                        Ok(frame) => {
                            if is_system_metadata(&frame.payload) {
                                info!("session_metadata: publishing snapshot ({} bytes)", frame.payload.len());
                                let meta_frame = Frame::new(
                                    FeedId::SESSION_METADATA,
                                    frame.payload.clone(),
                                );
                                let _ = tx.send(meta_frame);
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
        }
    }
}

/// Check if a payload contains a system_metadata event by scanning for
/// the type field. This avoids a full JSON parse on every CODE_OUTPUT frame.
fn is_system_metadata(payload: &[u8]) -> bool {
    payload
        .windows(SYSTEM_METADATA_NEEDLE.len())
        .any(|w| w == SYSTEM_METADATA_NEEDLE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_system_metadata() {
        let payload = br#"{"type":"system_metadata","session_id":"abc","cwd":"/tmp","slash_commands":[]}"#;
        assert!(is_system_metadata(payload));
    }

    #[test]
    fn rejects_non_metadata() {
        let payload = br#"{"type":"assistant","content":"hello"}"#;
        assert!(!is_system_metadata(payload));
    }

    #[test]
    fn rejects_empty() {
        assert!(!is_system_metadata(b""));
    }

    #[test]
    fn rejects_other_type() {
        let payload = br#"{"type":"system","subtype":"init"}"#;
        assert!(!is_system_metadata(payload));
    }
}
