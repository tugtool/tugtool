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

/// What kind of filesystem entry counts as "exists" for a probe. Defaults to
/// `File` so the Text-card MRU caller (which omits the field) is unchanged; the
/// session picker's project-path recents send `Dir`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StatKind {
    #[default]
    File,
    Dir,
}

/// Request body for `POST /api/fs/stat`.
#[derive(Debug, Deserialize)]
pub(crate) struct StatRequest {
    paths: Vec<String>,
    #[serde(default)]
    kind: StatKind,
}

/// Probe each path and build the
/// `{ "exists": { path: bool }, "canonical": { path: canonicalPath } }`
/// payload. `kind` selects whether a file or a directory counts as reachable.
/// `canonical` carries the resolved form (via the same `resolve_to_claude_form`
/// a Text card binds on open) for every reachable entry, so the caller can
/// normalize its stored paths and dedupe them against open cards' canonical
/// paths. Pure over the filesystem, synchronous — the handler runs it under
/// `spawn_blocking`.
fn stat_paths(paths: &[String], kind: StatKind) -> Value {
    let mut exists = Map::new();
    let mut canonical = Map::new();
    for raw in paths.iter().take(MAX_STAT_PATHS) {
        let reachable = match guard_absolute_path(raw) {
            Ok(resolved) => {
                let matched = std::fs::metadata(&resolved)
                    .map(|md| match kind {
                        StatKind::File => md.is_file(),
                        StatKind::Dir => md.is_dir(),
                    })
                    .unwrap_or(false);
                if matched {
                    canonical.insert(
                        raw.clone(),
                        Value::String(resolved.to_string_lossy().into_owned()),
                    );
                }
                matched
            }
            Err(_) => false,
        };
        exists.insert(raw.clone(), Value::Bool(reachable));
    }
    json!({ "exists": exists, "canonical": canonical })
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
    let result =
        tokio::task::spawn_blocking(move || stat_paths(&request.paths, request.kind)).await;
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

        let body = stat_paths(
            &[
                present.to_string_lossy().into_owned(),
                missing.to_string_lossy().into_owned(),
            ],
            StatKind::File,
        );
        assert_eq!(body["exists"][present.to_string_lossy().as_ref()], true);
        assert_eq!(body["exists"][missing.to_string_lossy().as_ref()], false);
        // A reachable file carries its resolved canonical form; a missing one
        // does not.
        assert!(body["canonical"][present.to_string_lossy().as_ref()].is_string());
        assert!(
            body["canonical"]
                .get(missing.to_string_lossy().as_ref())
                .is_none()
        );
    }

    #[test]
    fn stat_reports_directory_false() {
        let dir = tempfile::tempdir().unwrap();
        let body = stat_paths(&[dir.path().to_string_lossy().into_owned()], StatKind::File);
        assert_eq!(body["exists"][dir.path().to_string_lossy().as_ref()], false);
    }

    #[test]
    fn stat_dir_kind_reports_directory_true_and_file_false() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("here.txt");
        std::fs::write(&file, "x").unwrap();
        let missing = dir.path().join("gone");

        let body = stat_paths(
            &[
                dir.path().to_string_lossy().into_owned(),
                file.to_string_lossy().into_owned(),
                missing.to_string_lossy().into_owned(),
            ],
            StatKind::Dir,
        );
        assert_eq!(body["exists"][dir.path().to_string_lossy().as_ref()], true);
        assert_eq!(body["exists"][file.to_string_lossy().as_ref()], false);
        assert_eq!(body["exists"][missing.to_string_lossy().as_ref()], false);
        // A reachable directory carries its resolved canonical form.
        assert!(body["canonical"][dir.path().to_string_lossy().as_ref()].is_string());
    }

    #[test]
    fn stat_reports_relative_and_traversing_paths_false() {
        let body = stat_paths(
            &[
                "relative/path.txt".to_string(),
                "/tmp/../etc/passwd".to_string(),
            ],
            StatKind::File,
        );
        assert_eq!(body["exists"]["relative/path.txt"], false);
        assert_eq!(body["exists"]["/tmp/../etc/passwd"], false);
    }

    #[test]
    fn stat_caps_the_batch() {
        let paths: Vec<String> = (0..MAX_STAT_PATHS + 8)
            .map(|i| format!("/nonexistent/{i}"))
            .collect();
        let body = stat_paths(&paths, StatKind::File);
        assert_eq!(body["exists"].as_object().unwrap().len(), MAX_STAT_PATHS);
    }
}
