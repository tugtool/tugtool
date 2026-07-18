//! HTTP handler for `POST /api/fs/stat` — batch file-existence probes.
//!
//! The frontend's recently-open file surfaces (the Lens Text Files
//! section) list stored MRU paths that may have been deleted or moved
//! since they were recorded. This endpoint answers "is this still an
//! openable file?" for a batch of paths in one round trip, keyed by the
//! inbound path string so the client maps results without re-deriving
//! canonical forms.
//!
//! Loopback-only, like the other `/api/fs` handlers, and gated by the
//! same path guard: a relative / traversing / secret-denylisted path
//! reports `false` (not reachable) rather than erroring, since the
//! caller's question is precisely "can I open this?".

use std::net::SocketAddr;

use axum::extract::ConnectInfo;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use tracing::warn;

use crate::fs_read::guard_absolute_path;

/// Cap on paths per request — bounds the stat work; the MRU stores that
/// call this hold far fewer entries.
pub(crate) const MAX_STAT_PATHS: usize = 64;

/// Request body for `POST /api/fs/stat`.
#[derive(Debug, Deserialize)]
pub(crate) struct StatRequest {
    paths: Vec<String>,
}

/// Probe each path and build the `{ "exists": { path: bool } }` payload.
/// Pure over the filesystem, synchronous — the handler runs it under
/// `spawn_blocking`.
fn stat_paths(paths: &[String]) -> Value {
    let mut exists = Map::new();
    for raw in paths.iter().take(MAX_STAT_PATHS) {
        let reachable = match guard_absolute_path(raw) {
            Ok(canonical) => std::fs::metadata(&canonical)
                .map(|md| md.is_file())
                .unwrap_or(false),
            Err(_) => false,
        };
        exists.insert(raw.clone(), Value::Bool(reachable));
    }
    json!({ "exists": exists })
}

/// Handle `POST /api/fs/stat`. Restricted to loopback.
pub(crate) async fn post_fs_stat(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    axum::Json(request): axum::Json<StatRequest>,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!("post_fs_stat: rejected non-loopback connection from {addr}");
        return (
            StatusCode::FORBIDDEN,
            axum::Json(json!({ "error": "denied" })),
        )
            .into_response();
    }
    let result = tokio::task::spawn_blocking(move || stat_paths(&request.paths)).await;
    match result {
        Ok(body) => (StatusCode::OK, axum::Json(body)).into_response(),
        Err(_join_err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "error": "internal" })),
        )
            .into_response(),
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stat_reports_existing_file_true_and_missing_false() {
        let dir = tempfile::tempdir().unwrap();
        let present = dir.path().join("here.txt");
        std::fs::write(&present, "x").unwrap();
        let missing = dir.path().join("gone.txt");

        let body = stat_paths(&[
            present.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ]);
        assert_eq!(body["exists"][present.to_string_lossy().as_ref()], true);
        assert_eq!(body["exists"][missing.to_string_lossy().as_ref()], false);
    }

    #[test]
    fn stat_reports_directory_false() {
        let dir = tempfile::tempdir().unwrap();
        let body = stat_paths(&[dir.path().to_string_lossy().into_owned()]);
        assert_eq!(body["exists"][dir.path().to_string_lossy().as_ref()], false);
    }

    #[test]
    fn stat_reports_relative_and_traversing_paths_false() {
        let body = stat_paths(&[
            "relative/path.txt".to_string(),
            "/tmp/../etc/passwd".to_string(),
        ]);
        assert_eq!(body["exists"]["relative/path.txt"], false);
        assert_eq!(body["exists"]["/tmp/../etc/passwd"], false);
    }

    #[test]
    fn stat_caps_the_batch() {
        let paths: Vec<String> = (0..MAX_STAT_PATHS + 8)
            .map(|i| format!("/nonexistent/{i}"))
            .collect();
        let body = stat_paths(&paths);
        assert_eq!(
            body["exists"].as_object().unwrap().len(),
            MAX_STAT_PATHS
        );
    }
}
