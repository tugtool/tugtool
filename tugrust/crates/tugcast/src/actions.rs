use std::collections::HashMap;

use tokio::sync::{broadcast, mpsc};
use tracing::info;
use tugcast_core::{FeedId, Frame};

use crate::router::LagPolicy;

/// Dispatch an action received from any ingress path (HTTP tell, WebSocket control frame, UDS tell).
///
/// Classifies the action and routes it to the appropriate channel(s).
/// `raw_payload` is the full JSON body bytes, used to construct the Control frame for broadcasting.
/// The `stream_outputs` map is used to look up the CONTROL broadcast sender.
pub async fn dispatch_action(
    action: &str,
    raw_payload: &[u8],
    shutdown_tx: &mpsc::Sender<u8>,
    stream_outputs: &HashMap<FeedId, (broadcast::Sender<Frame>, LagPolicy)>,
    shared_dev_state: &crate::dev::SharedDevState,
    pending_evals: &crate::router::PendingEvals,
) {
    match action {
        "relaunch" => {
            info!("dispatch_action: relaunch requested");
            let shared = shared_dev_state.clone();
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            let stx = shutdown_tx.clone();
            tokio::spawn(async move {
                if let Some(cat) = cat {
                    crate::control::handle_relaunch(shared, cat, stx).await;
                }
            });
        }
        "eval-response" => {
            // Complete a pending eval request
            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(raw_payload) {
                if let Some(request_id) = payload.get("requestId").and_then(|r| r.as_str()) {
                    let mut pending = pending_evals.lock().unwrap();
                    if let Some(tx) = pending.remove(request_id) {
                        let result = payload
                            .get("result")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let _ = tx.send(result);
                        info!(
                            "dispatch_action: eval-response completed for {}",
                            request_id
                        );
                    }
                }
            }
        }
        other => {
            info!("dispatch_action: broadcasting client action: {}", other);
            if let Some((tx, _)) = stream_outputs.get(&FeedId::CONTROL) {
                let frame = Frame::new(FeedId::CONTROL, raw_payload.to_vec());
                let _ = tx.send(frame);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dispatch_action_unknown() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let (client_action_tx, mut client_action_rx) = broadcast::channel(16);
        let dev_state = crate::dev::new_shared_dev_state();

        let mut stream_outputs = HashMap::new();
        stream_outputs.insert(FeedId::CONTROL, (client_action_tx, LagPolicy::Warn));

        let pending_evals = std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));

        dispatch_action(
            "show-card",
            br#"{"action":"show-card"}"#,
            &shutdown_tx,
            &stream_outputs,
            &dev_state,
            &pending_evals,
        )
        .await;

        let frame = client_action_rx.recv().await.unwrap();
        assert_eq!(frame.feed_id, FeedId::CONTROL);
        assert_eq!(frame.payload, br#"{"action":"show-card"}"#);
    }
}
