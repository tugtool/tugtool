//! HTTP server for tugcast
//!
//! Implements the axum server with routes for auth, WebSocket upgrade,
//! and API commands. Static asset serving is handled by Vite (dev mode)
//! or `vite preview` (non-dev mode); tugcast does not serve web pages.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tracing::warn;

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
        &router.client_action_tx,
        &router.dev_state,
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

/// Build the axum application router
///
/// Constructs the Router with auth, WebSocket, and API routes.
/// Separated from `run_server` to enable testing without TCP binding.
/// The frontend is served by Vite; tugcast does not serve static assets.
/// The `dev_state` parameter is kept because `handle_relaunch` in `control.rs` reads
/// `source_tree` from it.
pub(crate) fn build_app(router: FeedRouter, _dev_state: SharedDevState) -> Router {
    Router::new()
        .route("/auth", get(crate::auth::handle_auth))
        .route("/ws", get(crate::router::ws_handler))
        .route("/api/tell", post(tell_handler))
        .with_state(router)
}

/// Run the HTTP server
///
/// Serves the axum application on the provided `TcpListener`
pub async fn run_server(
    listener: TcpListener,
    router: FeedRouter,
    dev_state: SharedDevState,
) -> Result<(), std::io::Error> {
    let app = build_app(router, dev_state);

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
        // Server-only
        assert_eq!("restart", "restart");

        // Hybrid
        assert!(matches!("reset", "reset"));

        // Client-only (everything else)
        assert!(!matches!("show-card", "restart" | "reset"));
        assert!(!matches!("reload_frontend", "restart" | "reset"));
    }
}
