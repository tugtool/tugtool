use tokio::sync::{broadcast, mpsc};
use tracing::info;
use tugcast_core::{FeedId, Frame};

/// Dispatch an action received from any ingress path (HTTP tell, WebSocket control frame, UDS tell).
///
/// Classifies the action and routes it to the appropriate channel(s).
/// `raw_payload` is the full JSON body bytes, used to construct the Control frame for broadcasting.
pub async fn dispatch_action(
    action: &str,
    raw_payload: &[u8],
    shutdown_tx: &mpsc::Sender<u8>,
    client_action_tx: &broadcast::Sender<Frame>,
) {
    match action {
        "restart" => {
            info!("dispatch_action: restart requested");
            let _ = shutdown_tx.send(42).await;
        }
        "reset" => {
            info!("dispatch_action: reset requested (hybrid)");
            let frame = Frame::new(FeedId::Control, raw_payload.to_vec());
            let _ = client_action_tx.send(frame);
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let _ = shutdown_tx.send(43).await;
        }
        other => {
            info!("dispatch_action: broadcasting client action: {}", other);
            let frame = Frame::new(FeedId::Control, raw_payload.to_vec());
            let _ = client_action_tx.send(frame);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dispatch_action_restart() {
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel(1);
        let (client_action_tx, _) = broadcast::channel(16);

        dispatch_action(
            "restart",
            br#"{"action":"restart"}"#,
            &shutdown_tx,
            &client_action_tx,
        )
        .await;

        assert_eq!(shutdown_rx.recv().await, Some(42));
    }

    #[tokio::test]
    async fn test_dispatch_action_unknown() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let (client_action_tx, mut client_action_rx) = broadcast::channel(16);

        dispatch_action(
            "show-card",
            br#"{"action":"show-card"}"#,
            &shutdown_tx,
            &client_action_tx,
        )
        .await;

        let frame = client_action_rx.recv().await.unwrap();
        assert_eq!(frame.feed_id, FeedId::Control);
        assert_eq!(frame.payload, br#"{"action":"show-card"}"#);
    }
}
