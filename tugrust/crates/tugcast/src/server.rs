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
use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
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
                axum::Json(serde_json::json!({"status": "error", "message": "browser disconnected"})),
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
/// When `source_tree` is `Some(path)`, tugcast checks for a built frontend
/// at `{source_tree}/tugdeck/dist/`. If found, a `ServeDir` fallback is added
/// so that tugcast serves the production frontend directly on port 55255.
/// If the dist directory does not exist, a warning is logged and unmatched
/// routes return axum's default 404 (API routes remain fully functional).
///
/// Pass `None` for `source_tree` (e.g., in tests) to disable static file
/// serving entirely.
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
    source_tree: Option<PathBuf>,
    bank_store: Option<Arc<TugbankClient>>,
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

    if let Some(tree) = source_tree {
        let dist_path = tree.join("tugdeck").join("dist");
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
    }

    base
}

/// Run the HTTP server
///
/// Serves the axum application on the provided `TcpListener`.
/// The `source_tree` path is forwarded to `build_app` to enable
/// `ServeDir` static file serving in production mode.
/// The `bank_store` is forwarded to `build_app` to enable the defaults
/// endpoints backed by the tugbank SQLite database. The client is created
/// in `main.rs` before startup so migration can share the same connection.
pub async fn run_server(
    listener: TcpListener,
    router: FeedRouter,
    dev_state: SharedDevState,
    source_tree: Option<PathBuf>,
    bank_store: Option<Arc<TugbankClient>>,
) -> Result<(), std::io::Error> {
    let app = build_app(router, dev_state, source_tree, bank_store);

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
