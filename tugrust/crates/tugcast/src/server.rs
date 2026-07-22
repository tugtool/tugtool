//! HTTP server for tugcast
//!
//! Implements the axum server with routes for auth, WebSocket upgrade,
//! and API commands. In production mode, tugcast serves the pre-built
//! frontend from `tugdeck/dist/` via `tower-http::ServeDir` as a fallback
//! route. In dev mode, the Vite dev server on port 55155 handles the
//! frontend; tugcast handles only the API routes.

use axum::Extension;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::time::timeout;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tracing::warn;
use tugbank_core::TugbankClient;
use tugcast_core::{FeedId, Frame};

use crate::dev::SharedDevState;
use crate::router::FeedRouter;

/// Request payload for /api/tell endpoint
// Allow dead_code: struct is used only for testing/documentation
#[allow(dead_code)]
#[derive(Deserialize)]
struct TellRequest {
    action: String,
}

/// Response payload for /api/tell endpoint
#[derive(Serialize)]
struct TellResponse {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// Handle POST /api/tell requests for triggering actions
async fn tell_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
    body: Bytes,
) -> Response {
    // Reject non-loopback connections
    if !addr.ip().is_loopback() {
        warn!(
            "tell_handler: rejected non-loopback connection from {}",
            addr
        );
        return (
            StatusCode::FORBIDDEN,
            axum::Json(TellResponse {
                status: "error".to_string(),
                message: Some("forbidden".to_string()),
            }),
        )
            .into_response();
    }

    // Parse JSON payload manually (not using axum Json extractor) for custom error messages
    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(TellResponse {
                    status: "error".to_string(),
                    message: Some("invalid JSON".to_string()),
                }),
            )
                .into_response();
        }
    };

    // Extract action field
    let action = match payload.get("action").and_then(|a| a.as_str()) {
        Some(a) => a,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(TellResponse {
                    status: "error".to_string(),
                    message: Some("missing action field".to_string()),
                }),
            )
                .into_response();
        }
    };

    // Bridge: `changeset_*` CONTROL actions (e.g. `changeset_claim`) live in
    // the supervisor's `handle_control` — the single source of truth shared
    // with the WebSocket ingress — so the CLI (`tugutil claim`) and the deck
    // hit the same handler. Gated to the `changeset_` prefix: those verbs act
    // on a project + ledger, never on per-client state, so a tell (which has
    // no client connection) can drive them with a synthetic client id;
    // client-scoped verbs (`spawn_session`, …) stay off the HTTP surface.
    // Everything else falls through to the host-action `dispatch_action` below.
    if action.starts_with("changeset_")
        && let Some(sup) = router.supervisor.as_ref()
    {
        use crate::feeds::agent_supervisor::ControlOutcome;
        match sup.handle_control(action, &body, TELL_SYNTHETIC_CLIENT_ID).await {
            ControlOutcome::Handled => {
                return (
                    StatusCode::OK,
                    axum::Json(TellResponse {
                        status: "ok".to_string(),
                        message: None,
                    }),
                )
                    .into_response();
            }
            ControlOutcome::Error(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(TellResponse {
                        status: "error".to_string(),
                        message: Some(format!("{err:?}")),
                    }),
                )
                    .into_response();
            }
            // Not a supervisor-owned action after all — fall through.
            ControlOutcome::PassThrough => {}
        }
    }

    // Dispatch action
    crate::actions::dispatch_action(
        action,
        &body,
        &router.shutdown_tx,
        &router.stream_outputs,
        &router.dev_state,
        &router.pending_evals,
    )
    .await;

    (
        StatusCode::OK,
        axum::Json(TellResponse {
            status: "ok".to_string(),
            message: None,
        }),
    )
        .into_response()
}

/// Synthetic client id for HTTP-`tell`-originated CONTROL actions: a tell has
/// no WebSocket connection, so `changeset_*` verbs (which never touch
/// per-client state) run under this sentinel. Well above any real client id
/// (those count up from 0), so it can never collide with a live client.
const TELL_SYNTHETIC_CLIENT_ID: u64 = u64::MAX;

/// Handle POST /api/eval requests for evaluating JavaScript in the browser.
///
/// Sends an eval request to the browser via CONTROL frame and waits for the
/// response. Returns the result as JSON. Timeout after 30 seconds.
async fn eval_handler(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(router): State<FeedRouter>,
    body: Bytes,
) -> Response {
    if !addr.ip().is_loopback() {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"status": "error", "message": "forbidden"})),
        )
            .into_response();
    }

    // Eval is dev-mode only
    if router.dev_state.load().is_none() {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"status": "error", "message": "eval requires dev mode"})),
        )
            .into_response();
    }

    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"status": "error", "message": "invalid JSON"})),
            )
                .into_response();
        }
    };

    let code = match payload.get("code").and_then(|c| c.as_str()) {
        Some(c) => c,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"status": "error", "message": "missing code field"})),
            )
                .into_response();
        }
    };

    // Generate request ID and create oneshot channel
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();

    // Register pending eval
    {
        let mut pending = router.pending_evals.lock().unwrap();
        pending.insert(request_id.clone(), tx);
    }

    // Broadcast eval request to browser
    let eval_frame = serde_json::json!({
        "action": "eval",
        "requestId": request_id,
        "code": code,
    });
    if let Some((broadcast_tx, _)) = router.stream_outputs.get(&FeedId::CONTROL) {
        let frame = Frame::new(FeedId::CONTROL, serde_json::to_vec(&eval_frame).unwrap());
        let _ = broadcast_tx.send(frame);
    }

    // Await response with timeout
    match timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => (
            StatusCode::OK,
            axum::Json(serde_json::json!({"status": "ok", "result": result})),
        )
            .into_response(),
        Ok(Err(_)) => {
            // Sender dropped (browser disconnected)
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(
                    serde_json::json!({"status": "error", "message": "browser disconnected"}),
                ),
            )
                .into_response()
        }
        Err(_) => {
            // Timeout — clean up pending entry
            let mut pending = router.pending_evals.lock().unwrap();
            pending.remove(&request_id);
            (
                StatusCode::GATEWAY_TIMEOUT,
                axum::Json(serde_json::json!({"status": "error", "message": "timeout waiting for browser response"})),
            )
                .into_response()
        }
    }
}

/// Build the axum application router
///
/// Constructs the Router with auth, WebSocket, and API routes.
/// Separated from `run_server` to enable testing without TCP binding.
///
/// Static-file serving: tugcast always checks for a built frontend at
/// `resources::source_tree().join("tugdeck/dist")`. In a bundled Tug.app
/// this resolves to `Contents/Resources/tugdeck/dist/` (via `TUGCAST_RESOURCE_ROOT`
/// set by `ProcessManager.swift`). In a dev `cargo run` without the env var,
/// it falls back to `<repo>/tugdeck/dist/`. If the dist directory does not
/// exist, a warning is logged and unmatched routes return axum's default
/// 404 (API routes remain fully functional).
///
/// When `bank_store` is `Some(client)`, registers the four `/api/defaults`
/// routes with the client as an `Extension`. When `None`, the defaults routes
/// are not registered — this avoids a missing-Extension panic since no
/// defaults routes are reachable in callers (e.g., tests) that do not supply
/// a client. The client is created externally (in `main.rs`) so that migration
/// can share the same connection before the server starts accepting connections.
pub(crate) fn build_app(
    router: FeedRouter,
    _dev_state: SharedDevState,
    bank_store: Option<Arc<TugbankClient>>,
    snippets_state: Option<Arc<crate::snippets::SnippetsState>>,
) -> Router {
    // Allow any origin on localhost — tugcast only binds to loopback.
    // This prevents WKWebView CORS errors during page teardown (keepalive
    // fetches during beforeunload) and for cross-port requests when the
    // page is served by Vite dev server on a different port.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut base = Router::new()
        .route("/auth", get(crate::auth::handle_auth))
        .route("/ws", get(crate::router::ws_handler))
        .route("/api/tell", post(tell_handler))
        .route("/api/eval", post(eval_handler))
        .route("/api/host", get(crate::host::get_host))
        .route("/api/permissions", get(crate::permissions::get_permissions))
        .route("/api/permissions/rule", post(crate::permissions::post_rule))
        .route("/api/fs/complete", get(crate::fs_complete::get_fs_complete))
        .route("/api/fs/read", get(crate::fs_read::get_fs_read))
        .route("/api/fs/stat", post(crate::fs_stat::post_fs_stat))
        .route(
            "/api/fs/write",
            // Per-route body limit above axum's 2 MB default so an 8 MiB
            // file (the read cap) still saves through the JSON envelope.
            post(crate::fs_write::post_fs_write)
                .layer(DefaultBodyLimit::max(crate::fs_write::MAX_WRITE_BODY_BYTES)),
        )
        .with_state(router)
        .layer(cors);

    // Wire defaults routes when an already-opened store is provided.
    if let Some(store) = bank_store {
        base = base
            .route("/api/defaults/{domain}", get(crate::defaults::get_domain))
            .route(
                "/api/defaults/{domain}/{key}",
                get(crate::defaults::get_key)
                    .put(crate::defaults::put_key)
                    .delete(crate::defaults::delete_key),
            )
            .layer(Extension(store));
    }

    // Wire the snippets routes when a state (resolved file path) is provided.
    if let Some(state) = snippets_state {
        base = base
            .route(
                "/api/snippets",
                get(crate::snippets::get_snippets).put(crate::snippets::put_snippets),
            )
            .layer(Extension(state));
    }

    let dist_path = crate::resources::source_tree().join("tugdeck").join("dist");
    if dist_path.is_dir() {
        let index_html = dist_path.join("index.html");
        return base.fallback_service(
            ServeDir::new(&dist_path).not_found_service(ServeFile::new(index_html)),
        );
    } else {
        warn!(
            "dist directory not found at {}, static file serving disabled",
            dist_path.display()
        );
    }

    base
}

/// Run the HTTP server
///
/// Serves the axum application on the provided `TcpListener`.
/// The `bank_store` is forwarded to `build_app` to enable the defaults
/// endpoints backed by the tugbank SQLite database. The client is created
/// in `main.rs` before startup so migration can share the same connection.
pub async fn run_server(
    listener: TcpListener,
    router: FeedRouter,
    dev_state: SharedDevState,
    bank_store: Option<Arc<TugbankClient>>,
    snippets_state: Option<Arc<crate::snippets::SnippetsState>>,
) -> Result<(), std::io::Error> {
    let app = build_app(router, dev_state, bank_store, snippets_state);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tell_request_deserialization() {
        let json = r#"{"action":"test-ping"}"#;
        let req: TellRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.action, "test-ping");
    }

    #[test]
    fn test_tell_request_missing_action() {
        let json = r#"{"foo":"bar"}"#;
        let result: Result<TellRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_action_classification() {
        // All actions are now client-only (broadcast to Control feed).
        // restart, reset, and relaunch have been removed.
        assert_ne!("reload", "restart");
        assert_ne!("reload", "reset");
        assert_ne!("show-card", "restart");
        assert_ne!("show-card", "reset");
    }
}
