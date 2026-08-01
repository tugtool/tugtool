use std::collections::HashMap;

use tokio::sync::{broadcast, mpsc};
use tracing::info;
use tugcast_core::{FeedId, Frame};

use crate::router::LagPolicy;

/// Broadcast a `claude_auth_result` CONTROL frame from a resolved auth state.
/// Shared by the `check_auth` (probe) and `claude_sign_in` (login) actions so
/// both report login state to the deck in one shape. `tug_session_id` is echoed
/// when present so a per-card sign-in can resume the originating card.
fn broadcast_auth_result(
    cat: Option<broadcast::Sender<Frame>>,
    state: crate::feeds::claude_auth::AuthState,
    tug_session_id: Option<String>,
) {
    use crate::feeds::claude_auth::AuthState;
    // `reason` distinguishes the two signed-out cases so the gate can show
    // install guidance vs. a sign-in prompt: "claude_missing" (no CLI) vs
    // "logged_out" (CLI present, not signed in). `null` when logged in.
    let (logged_in, email, subscription_type, auth_method, reason) = match state {
        AuthState::LoggedIn(info) => (
            true,
            info.email,
            info.subscription_type,
            info.auth_method,
            None,
        ),
        AuthState::ClaudeMissing => (false, None, None, None, Some("claude_missing")),
        AuthState::LoggedOut => (false, None, None, None, Some("logged_out")),
    };
    let Some(cat) = cat else { return };
    let body = serde_json::json!({
        "action": "claude_auth_result",
        "loggedIn": logged_in,
        "reason": reason,
        "tug_session_id": tug_session_id,
        "email": email,
        "subscriptionType": subscription_type,
        "authMethod": auth_method,
    });
    if let Ok(bytes) = serde_json::to_vec(&body) {
        let _ = cat.send(Frame::new(FeedId::CONTROL, bytes));
    }
}

/// Pull the `model` field out of a local-model action payload.
fn model_id_from(raw_payload: &[u8]) -> Option<String> {
    serde_json::from_slice::<serde_json::Value>(raw_payload)
        .ok()?
        .get("model")?
        .as_str()
        .map(str::to_owned)
}

/// Dispatch an action received from any ingress path (HTTP tell, WebSocket control frame, UDS tell).
///
/// Classifies the action and routes it to the appropriate channel(s).
/// `raw_payload` is the full JSON body bytes, used to construct the Control frame for broadcasting.
/// The `stream_outputs` map is used to look up the CONTROL broadcast sender.
///
/// NOTE: session-lifecycle actions (`spawn_session`, `close_session`,
/// `reset_session`) are handled upstream by `AgentSupervisor::handle_control`
/// in `feeds/agent_supervisor.rs` and never reach this function — per [D09]
/// the supervisor owns the per-session state machine, not the router.
pub async fn dispatch_action(
    action: &str,
    raw_payload: &[u8],
    shutdown_tx: &mpsc::Sender<u8>,
    stream_outputs: &HashMap<FeedId, (broadcast::Sender<Frame>, LagPolicy)>,
    shared_dev_state: &crate::dev::SharedDevState,
    pending_evals: &crate::router::PendingEvals,
    pending_asks: &crate::router::PendingAsks,
    local_model: &crate::local_model::SharedLocalModelState,
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
        "ask-response" => {
            // Complete a pending ask request. Unlike eval-response, a missing
            // entry is unremarkable: the requester may have already timed out
            // and gone away, and the deck has no way to know that.
            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(raw_payload) {
                if let Some(request_id) = payload.get("requestId").and_then(|r| r.as_str()) {
                    let choice = payload
                        .get("choice")
                        .and_then(|c| c.as_str())
                        .unwrap_or_default()
                        .to_owned();
                    let mut pending = pending_asks.lock().unwrap();
                    if let Some(tx) = pending.remove(request_id) {
                        let _ = tx.send(choice);
                        info!("dispatch_action: ask-response completed for {}", request_id);
                    }
                }
            }
        }
        "check_auth" => {
            // App-level auth probe (no login): runs `claude auth status` and
            // broadcasts the result so the deck can gate at launch and before
            // the session picker without spawning a session.
            info!("dispatch_action: claude auth check requested");
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            tokio::spawn(async move {
                let state = crate::feeds::claude_auth::probe().await;
                broadcast_auth_result(cat, state, None);
            });
        }
        "install_claude" => {
            // Tug-managed install: run the official installer, report the
            // outcome, then re-probe (the installer drops `claude` in
            // ~/.local/bin, which claude_executable() finds without a PATH
            // edit). Spawned so dispatch returns while the install runs.
            info!("dispatch_action: claude install requested");
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            tokio::spawn(async move {
                let (ok, error) = crate::feeds::claude_auth::install().await;
                if let Some(cat) = &cat {
                    let body = serde_json::json!({
                        "action": "claude_install_result",
                        "ok": ok,
                        "error": error,
                    });
                    if let Ok(bytes) = serde_json::to_vec(&body) {
                        let _ = cat.send(Frame::new(FeedId::CONTROL, bytes));
                    }
                }
                // Re-probe regardless — on success `claude` is now reachable.
                let state = crate::feeds::claude_auth::probe().await;
                broadcast_auth_result(cat, state, None);
            });
        }
        "claude_sign_in" => {
            // Drive `claude auth login` and report the result back so the
            // app-wide sheet (and the card that asked) can resume. login()
            // awaits the CLI's exit — the CLI blocks on its own browser OAuth
            // callback, so there's no polling. Spawned as a task so dispatch
            // returns promptly while the user completes sign-in in the browser.
            info!("dispatch_action: claude sign-in requested");
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            let tug_session_id = serde_json::from_slice::<serde_json::Value>(raw_payload)
                .ok()
                .and_then(|v| {
                    v.get("tug_session_id")
                        .and_then(|s| s.as_str())
                        .map(str::to_owned)
                });
            tokio::spawn(async move {
                let state = crate::feeds::claude_auth::login().await;
                broadcast_auth_result(cat, state, tug_session_id);
            });
        }
        "claude_logout" => {
            // Drive `claude auth logout`. Report the command's own success as a
            // `claude_logout_result` (so a failed logout surfaces an error
            // rather than a silent no-op), then re-probe and broadcast the
            // resulting auth state — logged out on success — which reopens
            // TugSetup for the user to log back in.
            info!("dispatch_action: claude logout requested");
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            tokio::spawn(async move {
                let (ok, error) = crate::feeds::claude_auth::logout().await;
                if let Some(cat) = &cat {
                    let body = serde_json::json!({
                        "action": "claude_logout_result",
                        "ok": ok,
                        "error": error,
                    });
                    if let Ok(bytes) = serde_json::to_vec(&body) {
                        let _ = cat.send(Frame::new(FeedId::CONTROL, bytes));
                    }
                }
                let state = crate::feeds::claude_auth::probe().await;
                broadcast_auth_result(cat, state, None);
            });
        }
        "local_model_download" => {
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            match model_id_from(raw_payload) {
                Some(id) => {
                    info!("dispatch_action: local model download requested: {}", id);
                    crate::local_model::start_download(local_model, cat, &id);
                }
                None => info!("dispatch_action: local_model_download missing model"),
            }
        }
        "local_model_download_cancel" => {
            info!("dispatch_action: local model download cancel requested");
            local_model.cancel_all();
        }
        "local_model_delete" => {
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            match model_id_from(raw_payload) {
                Some(id) => {
                    info!("dispatch_action: local model delete requested: {}", id);
                    crate::local_model::delete_model(local_model, cat, &id);
                }
                None => info!("dispatch_action: local_model_delete missing model"),
            }
        }
        // The two summarize lanes: the live intent and the past-tense
        // retrospective the idle collapse emits. Same seam, same normalization,
        // different instructions on the app side.
        "local_model_summarize" | "local_model_summarize_done" => {
            let retrospective = action == "local_model_summarize_done";
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            let prompt = serde_json::from_slice::<serde_json::Value>(raw_payload)
                .ok()
                .and_then(|v| v.get("prompt")?.as_str().map(str::to_owned));
            match prompt {
                Some(prompt) => {
                    crate::local_model::request_summary(local_model, cat, prompt, retrospective)
                }
                None => info!(action, "dispatch_action: summarize missing prompt"),
            }
        }
        "local_model_classify" => {
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            let payload = serde_json::from_slice::<serde_json::Value>(raw_payload).ok();
            let text = payload
                .as_ref()
                .and_then(|v| v.get("text")?.as_str().map(str::to_owned));
            // The program's documentation, when the caller is driving the
            // grammar-bearing variant. Absent means the base classify prompt.
            let grammar = payload
                .as_ref()
                .and_then(|v| v.get("grammar")?.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_owned);
            match text {
                Some(text) => {
                    crate::local_model::request_classification(local_model, cat, text, grammar)
                }
                None => info!("dispatch_action: local_model_classify missing text"),
            }
        }
        "local_model_list" => {
            let cat = stream_outputs
                .get(&FeedId::CONTROL)
                .map(|(tx, _)| tx.clone());
            crate::local_model::broadcast_inventory(local_model, cat.as_ref());
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
        let pending_asks = std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));

        dispatch_action(
            "show-card",
            br#"{"action":"show-card"}"#,
            &shutdown_tx,
            &stream_outputs,
            &dev_state,
            &pending_evals,
            &pending_asks,
            &crate::local_model::LocalModelState::new(
                std::env::temp_dir().join("tugcast-dispatch-test-models"),
                crate::local_model::DEFAULT_BASE_URL.to_string(),
            ),
        )
        .await;

        let frame = client_action_rx.recv().await.unwrap();
        assert_eq!(frame.feed_id, FeedId::CONTROL);
        assert_eq!(frame.payload, br#"{"action":"show-card"}"#);
    }

    /// The deck's answer reaches the waiting requester.
    #[tokio::test]
    async fn test_dispatch_ask_response_resolves_pending() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let (client_action_tx, _rx) = broadcast::channel(16);
        let dev_state = crate::dev::new_shared_dev_state();

        let mut stream_outputs = HashMap::new();
        stream_outputs.insert(FeedId::CONTROL, (client_action_tx, LagPolicy::Warn));

        let pending_evals = std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));
        let pending_asks: crate::router::PendingAsks =
            std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));

        let (tx, rx) = tokio::sync::oneshot::channel();
        pending_asks.lock().unwrap().insert("req-1".to_owned(), tx);

        dispatch_action(
            "ask-response",
            br#"{"action":"ask-response","requestId":"req-1","choice":"run-background-only"}"#,
            &shutdown_tx,
            &stream_outputs,
            &dev_state,
            &pending_evals,
            &pending_asks,
            &crate::local_model::LocalModelState::new(
                std::env::temp_dir().join("tugcast-dispatch-test-models"),
                crate::local_model::DEFAULT_BASE_URL.to_string(),
            ),
        )
        .await;

        assert_eq!(rx.await.unwrap(), "run-background-only");
        assert!(pending_asks.lock().unwrap().is_empty());
    }

    /// An answer for a request that already timed out is dropped, not a panic.
    #[tokio::test]
    async fn test_dispatch_ask_response_unknown_request_is_ignored() {
        let (shutdown_tx, _) = mpsc::channel(1);
        let (client_action_tx, _rx) = broadcast::channel(16);
        let dev_state = crate::dev::new_shared_dev_state();

        let mut stream_outputs = HashMap::new();
        stream_outputs.insert(FeedId::CONTROL, (client_action_tx, LagPolicy::Warn));

        let pending_evals = std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));
        let pending_asks: crate::router::PendingAsks =
            std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));

        dispatch_action(
            "ask-response",
            br#"{"action":"ask-response","requestId":"gone","choice":"run-all"}"#,
            &shutdown_tx,
            &stream_outputs,
            &dev_state,
            &pending_evals,
            &pending_asks,
            &crate::local_model::LocalModelState::new(
                std::env::temp_dir().join("tugcast-dispatch-test-models"),
                crate::local_model::DEFAULT_BASE_URL.to_string(),
            ),
        )
        .await;

        assert!(pending_asks.lock().unwrap().is_empty());
    }
}
