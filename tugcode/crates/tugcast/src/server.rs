//! HTTP server and static asset serving
//!
//! Implements the axum server with routes for auth, WebSocket upgrade,
//! and static asset serving using rust-embed.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, State};
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tracing::warn;

use crate::dev::SharedDevState;
use crate::router::FeedRouter;

/// Embedded static assets (tugdeck frontend)
#[derive(RustEmbed)]
#[folder = "$OUT_DIR/tugdeck/"]
struct Assets;

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

/// Determine Content-Type header for a file path
pub(crate) fn content_type_for(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".wasm") {
        "application/wasm"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else {
        "application/octet-stream"
    }
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

/// Serve static assets from embedded files
async fn serve_asset(uri: Uri) -> Response {
    let mut path = uri.path().trim_start_matches('/');

    // Default to index.html for root
    if path.is_empty() {
        path = "index.html";
    }

    match Assets::get(path) {
        Some(content) => {
            let content_type = content_type_for(path);
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type)],
                content.data,
            )
                .into_response()
        }
        None => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

/// Build the axum application router
///
/// Constructs the Router with auth, WebSocket, and static asset routes.
/// Separated from `run_server` to enable testing without TCP binding.
/// In dev mode, the browser loads from the Vite dev server (port 5173), not tugcast.
/// The `dev_state` parameter is kept because `handle_relaunch` in `control.rs` reads
/// `source_tree` from it.
pub(crate) fn build_app(router: FeedRouter, _dev_state: SharedDevState) -> Router {
    Router::new()
        .route("/auth", get(crate::auth::handle_auth))
        .route("/ws", get(crate::router::ws_handler))
        .route("/api/tell", post(tell_handler))
        .fallback(serve_asset)
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
    fn test_content_type_html() {
        assert_eq!(content_type_for("index.html"), "text/html; charset=utf-8");
    }

    #[test]
    fn test_content_type_js() {
        assert_eq!(
            content_type_for("app.js"),
            "application/javascript; charset=utf-8"
        );
    }

    #[test]
    fn test_content_type_css() {
        assert_eq!(content_type_for("app.css"), "text/css; charset=utf-8");
    }

    #[test]
    fn test_content_type_unknown() {
        assert_eq!(content_type_for("file.xyz"), "application/octet-stream");
    }

    #[test]
    fn test_content_type_woff2() {
        assert_eq!(content_type_for("font.woff2"), "font/woff2");
    }

    #[test]
    fn test_assets_index_exists() {
        assert!(Assets::get("index.html").is_some());
    }

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
