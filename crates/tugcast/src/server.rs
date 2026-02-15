//! HTTP server and static asset serving
//!
//! Implements the axum server with routes for auth, WebSocket upgrade,
//! and static asset serving using rust-embed.

use axum::Router;
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use rust_embed::RustEmbed;
use tokio::net::TcpListener;
use tracing::{error, info};

use crate::auth::SharedAuthState;
use crate::router::FeedRouter;

/// Embedded static assets (tugdeck frontend)
#[derive(RustEmbed)]
#[folder = "$OUT_DIR/tugdeck/"]
struct Assets;

/// Determine Content-Type header for a file path
fn content_type_for(path: &str) -> &'static str {
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
    } else {
        "application/octet-stream"
    }
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
pub(crate) fn build_app(router: FeedRouter) -> Router {
    Router::new()
        .route("/auth", get(crate::auth::handle_auth))
        .route("/ws", get(crate::router::ws_handler))
        .fallback(serve_asset)
        .with_state(router)
}

/// Run the HTTP server
///
/// Sets up axum routes and binds to `127.0.0.1:<port>`
pub async fn run_server(
    port: u16,
    router: FeedRouter,
    _auth: SharedAuthState,
) -> Result<(), std::io::Error> {
    let app = build_app(router);

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    info!(port = port, "tugcast server listening");

    axum::serve(listener, app).await
}

/// Open a URL in the default browser
pub fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let command = "open";

    #[cfg(target_os = "linux")]
    let command = "xdg-open";

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        error!("Browser auto-open not supported on this platform");
        return;
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        match std::process::Command::new(command).arg(url).spawn() {
            Ok(_) => info!("Opened browser to {}", url),
            Err(e) => error!("Failed to open browser: {}", e),
        }
    }
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
    fn test_assets_index_exists() {
        assert!(Assets::get("index.html").is_some());
    }
}
