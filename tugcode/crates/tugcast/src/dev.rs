//! Dev mode: SSE reload endpoint, file watcher, and index.html injection

use axum::extract::Extension;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response, sse::{Event, KeepAlive, Sse}};
use futures::Stream;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::info;

/// Newtype wrapper for the reload broadcast sender (shared state for SSE handlers)
#[derive(Clone)]
pub(crate) struct ReloadSender(pub broadcast::Sender<()>);

/// Newtype wrapper for the dev path (shared state for serve_dev_index)
#[derive(Clone)]
pub(crate) struct DevPath(pub PathBuf);

/// Inject the reload script tag before </body>
fn inject_reload_script(html: &str) -> String {
    let script_tag = r#"<script src="/dev/reload.js"></script>"#;
    if let Some(pos) = html.rfind("</body>") {
        let mut result = String::with_capacity(html.len() + script_tag.len() + 1);
        result.push_str(&html[..pos]);
        result.push_str(script_tag);
        result.push('\n');
        result.push_str(&html[pos..]);
        result
    } else {
        format!("{}\n{}", html, script_tag)
    }
}

/// Serve the reload client JS file
pub(crate) async fn serve_dev_reload_js() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
        r#"new EventSource("/dev/reload").onmessage = () => location.reload();"#,
    )
}

/// SSE endpoint for live reload notifications
pub(crate) async fn dev_reload_handler(
    Extension(reload_tx): Extension<ReloadSender>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = reload_tx.0.subscribe();

    let stream = futures::stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(()) => return Some((Ok(Event::default().data("reload")), rx)),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// Serve index.html with injected reload script
pub(crate) async fn serve_dev_index(
    Extension(dev_path): Extension<DevPath>,
) -> Response {
    let index_path = dev_path.0.join("index.html");
    match std::fs::read_to_string(&index_path) {
        Ok(html) => {
            let modified = inject_reload_script(&html);
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                modified,
            ).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "index.html not found").into_response(),
    }
}

/// Start file watcher for dev mode live reload
pub(crate) fn dev_file_watcher(
    dev_path: &Path,
) -> Result<(broadcast::Sender<()>, RecommendedWatcher), String> {
    let (reload_tx, _) = broadcast::channel::<()>(16);
    let tx_clone = reload_tx.clone();

    // Use std::sync::mpsc for the notify callback
    let (event_tx, event_rx) = std::sync::mpsc::channel();

    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        let _ = event_tx.send(res);
    })
    .map_err(|e| format!("failed to create dev file watcher: {}", e))?;

    watcher
        .watch(dev_path, RecursiveMode::Recursive)
        .map_err(|e| format!("failed to watch dev path: {}", e))?;

    // Spawn debounce task
    tokio::spawn(async move {
        let debounce_duration = Duration::from_millis(300);
        loop {
            match event_rx.try_recv() {
                Ok(Ok(event)) => {
                    // Extension filter: only .html, .css, .js
                    let should_reload = event.paths.iter().any(|p| {
                        p.extension().map_or(false, |ext| {
                            ext == "html" || ext == "css" || ext == "js"
                        })
                    });
                    if should_reload {
                        // Debounce: wait 300ms
                        tokio::time::sleep(debounce_duration).await;
                        // Drain remaining events
                        while event_rx.try_recv().is_ok() {}
                        // Send reload signal
                        let _ = tx_clone.send(());
                        info!("dev: triggered reload");
                    }
                }
                Ok(Err(_)) => {}
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }
    });

    Ok((reload_tx, watcher))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inject_reload_script() {
        let html = "<html><head></head><body><h1>Test</h1></body></html>";
        let result = inject_reload_script(html);
        assert!(result.contains(r#"<script src="/dev/reload.js"></script>"#));
        assert!(result.contains("</body>"));
        // Script should be before </body>
        let script_pos = result.find(r#"<script src="/dev/reload.js"></script>"#).unwrap();
        let body_pos = result.find("</body>").unwrap();
        assert!(script_pos < body_pos);
    }

    #[test]
    fn test_inject_reload_script_no_body_tag() {
        let html = "<html><head></head><div>Test</div>";
        let result = inject_reload_script(html);
        assert!(result.contains(r#"<script src="/dev/reload.js"></script>"#));
        // Script should be at the end
        assert!(result.ends_with(r#"<script src="/dev/reload.js"></script>"#));
    }

    #[tokio::test]
    async fn test_serve_dev_reload_js() {
        let response = serve_dev_reload_js().await.into_response();
        assert_eq!(response.status(), StatusCode::OK);

        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(content_type.contains("application/javascript"));

        // Read body
        use http_body_util::BodyExt;
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body = String::from_utf8(body_bytes.to_vec()).unwrap();
        assert!(body.contains("EventSource"));
        assert!(body.contains("/dev/reload"));
    }
}
