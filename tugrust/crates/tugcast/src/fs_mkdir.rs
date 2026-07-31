//! HTTP handler for `POST /api/fs/mkdir` — create a directory on demand.
//!
//! The default project directory (`~/tug` unless the user chose another) is
//! created lazily: when the user accepts the TugSetup step, and before the
//! frontend first acquires it as a workspace. Nothing creates it at boot, so
//! a user who never opts in never gets a stray directory.
//!
//! Creation lives here rather than in the Swift host because the deck can run
//! off-host and tugcast already owns the filesystem surface (`/api/fs/read`,
//! `/api/fs/write`, `/api/fs/stat`, `/api/fs/complete`).
//!
//! Loopback-only, and gated by the same `guard_absolute_path` the other
//! `/api/fs` handlers use: relative, `..`-traversing, and secret-denylisted
//! paths are rejected before any directory is created.

use std::net::SocketAddr;

use axum::extract::ConnectInfo;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::warn;

use crate::fs_read::{fs_error, guard_absolute_path};

/// Request body for `POST /api/fs/mkdir`.
#[derive(Debug, Deserialize)]
pub(crate) struct MkdirRequest {
    path: String,
}

/// Create `raw` and any missing parents. An existing directory is success;
/// an existing non-directory is `not_a_directory`. Synchronous — the handler
/// runs it under `spawn_blocking`.
fn mkdir(raw: &str) -> Result<Value, (StatusCode, Value)> {
    let resolved = guard_absolute_path(raw)?;
    match std::fs::metadata(&resolved) {
        Ok(md) if md.is_dir() => {
            return Ok(json!({
                "status": "ok",
                "path": resolved.to_string_lossy(),
                "created": false,
            }));
        }
        Ok(_) => return Err(fs_error(StatusCode::BAD_REQUEST, "not_a_directory")),
        Err(_) => {}
    }
    match std::fs::create_dir_all(&resolved) {
        Ok(()) => Ok(json!({
            "status": "ok",
            "path": resolved.to_string_lossy(),
            "created": true,
        })),
        Err(err) => Err(fs_error(StatusCode::BAD_REQUEST, io_error_kind(&err))),
    }
}

/// A stable, client-readable name for the failure. The frontend only branches
/// on "did it work"; the name goes into its warning so a report says why.
fn io_error_kind(err: &std::io::Error) -> &'static str {
    match err.kind() {
        std::io::ErrorKind::PermissionDenied => "permission_denied",
        std::io::ErrorKind::NotFound => "not_found",
        std::io::ErrorKind::AlreadyExists => "already_exists",
        _ => "io_error",
    }
}

/// Handle `POST /api/fs/mkdir`. Restricted to loopback.
pub(crate) async fn post_fs_mkdir(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    axum::Json(request): axum::Json<MkdirRequest>,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!("post_fs_mkdir: rejected non-loopback connection from {addr}");
        return (
            StatusCode::FORBIDDEN,
            axum::Json(json!({ "error": "denied" })),
        )
            .into_response();
    }
    let result = tokio::task::spawn_blocking(move || mkdir(&request.path)).await;
    match result {
        Ok(Ok(body)) => (StatusCode::OK, axum::Json(body)).into_response(),
        Ok(Err((status, body))) => (status, axum::Json(body)).into_response(),
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
    use std::path::Path;

    /// Whether `path` names an existing directory.
    fn is_dir(path: &Path) -> bool {
        std::fs::metadata(path)
            .map(|md| md.is_dir())
            .unwrap_or(false)
    }

    #[test]
    fn mkdir_creates_nested_directories() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a").join("b").join("c");
        let body = mkdir(target.to_string_lossy().as_ref()).unwrap();
        assert_eq!(body["status"], "ok");
        assert_eq!(body["created"], true);
        assert!(is_dir(&target));
    }

    #[test]
    fn mkdir_on_an_existing_directory_is_ok_and_reports_not_created() {
        let dir = tempfile::tempdir().unwrap();
        let body = mkdir(dir.path().to_string_lossy().as_ref()).unwrap();
        assert_eq!(body["status"], "ok");
        assert_eq!(body["created"], false);
    }

    #[test]
    fn mkdir_on_an_existing_file_reports_not_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("here.txt");
        std::fs::write(&file, "x").unwrap();
        let (status, body) = mkdir(file.to_string_lossy().as_ref()).unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "not_a_directory");
    }

    #[test]
    fn mkdir_rejects_a_relative_path() {
        let (status, body) = mkdir("relative/dir").unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "bad_path");
    }

    #[test]
    fn mkdir_rejects_a_traversing_path() {
        let (status, body) = mkdir("/tmp/../etc/tugtest").unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "bad_path");
        assert!(!is_dir(Path::new("/etc/tugtest")));
    }

    #[test]
    fn mkdir_rejects_a_secret_path() {
        let home = dirs::home_dir().unwrap();
        let target = home.join(".ssh").join("tugtest-should-not-exist");
        let (status, body) = mkdir(target.to_string_lossy().as_ref()).unwrap_err();
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(body["error"], "denied");
        assert!(!is_dir(&target));
    }
}
