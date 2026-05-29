//! HTTP handler for `GET /api/fs/complete` — directory-path completion for the
//! `/permissions` Workspace tab's "Add directory" field.
//!
//! Given the session `base` (cwd) and the `partial` path the user has typed,
//! returns the child **directories** of the partial's parent whose names
//! prefix-match, so the dev-card form can offer Tab-style completion — the
//! graphical equivalent of the terminal's `Tab to complete` hint.
//!
//! Loopback-only, like the other `/api` handlers. Listing is best-effort: an
//! unreadable or non-existent parent yields an empty list rather than an error.
//! Only directory *names* are returned (never file contents) and the result is
//! capped, so the endpoint can't be used as a bulk filesystem oracle.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use axum::extract::{ConnectInfo, Query};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::warn;

/// Cap the number of completions returned, bounding the payload for a directory
/// with many children.
const MAX_COMPLETIONS: usize = 100;

/// Query string for `GET /api/fs/complete`: the session working directory
/// (`base`) relative paths resolve under, and the `partial` path typed so far.
#[derive(Debug, Deserialize)]
pub(crate) struct CompleteQuery {
    base: String,
    #[serde(default)]
    partial: String,
}

/// Resolve `$HOME`, mirroring `permissions.rs`.
fn home_dir() -> Option<PathBuf> {
    dirs::home_dir().or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

/// Split `partial` into the directory portion *as the user typed it* (up to and
/// including the last `/`, or empty when there is none) and the basename prefix
/// being completed.
fn split_partial(partial: &str) -> (&str, &str) {
    match partial.rfind('/') {
        Some(i) => (&partial[..=i], &partial[i + 1..]),
        None => ("", partial),
    }
}

/// Resolve the typed directory portion to an absolute path to read. `~/` expands
/// to home; an absolute portion is used as-is; a relative portion (including the
/// empty string) resolves under `base`.
fn resolve_dir(dir_part: &str, base: &Path, home: &Path) -> PathBuf {
    if dir_part == "~" || dir_part.starts_with("~/") {
        let rest = dir_part.trim_start_matches('~').trim_start_matches('/');
        return home.join(rest);
    }
    let p = Path::new(dir_part);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base.join(p)
    }
}

/// List child directories of `read_dir_path` whose names case-insensitively
/// prefix-match `prefix`, formatted as completion entries. The `dir_part` (as
/// typed) is prepended to each name so the returned `value` is a drop-in
/// replacement for the input. Best-effort: returns `[]` on any read error.
fn list_completions(read_dir_path: &Path, dir_part: &str, prefix: &str) -> Vec<Value> {
    let entries = match std::fs::read_dir(read_dir_path) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let needle = prefix.to_lowercase();
    let mut names: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let is_dir = match entry.file_type() {
            Ok(ft) => ft.is_dir(),
            Err(_) => false,
        };
        if !is_dir {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.to_lowercase().starts_with(&needle) {
            names.push(name);
        }
    }
    names.sort();
    names
        .into_iter()
        .take(MAX_COMPLETIONS)
        .map(|name| {
            json!({
                "label": format!("{name}/"),
                "value": format!("{dir_part}{name}/"),
            })
        })
        .collect()
}

/// Handle `GET /api/fs/complete?base=<abs>&partial=<text>`.
///
/// Returns `{ "completions": [ { "label": "<name>/", "value": "<dir-part><name>/" } ] }`.
/// Restricted to loopback. 400 when `base` is not absolute. A missing/unreadable
/// parent directory yields an empty list, not an error.
pub(crate) async fn get_fs_complete(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(query): Query<CompleteQuery>,
) -> Response {
    if !addr.ip().is_loopback() {
        warn!("get_fs_complete: rejected non-loopback connection from {addr}");
        return (
            StatusCode::FORBIDDEN,
            axum::Json(json!({"status": "error", "message": "forbidden"})),
        )
            .into_response();
    }
    let base = PathBuf::from(&query.base);
    if !base.is_absolute() {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(json!({"status": "error", "message": "base must be an absolute path"})),
        )
            .into_response();
    }
    let home = match home_dir() {
        Some(home) => home,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(json!({"status": "error", "message": "internal error"})),
            )
                .into_response();
        }
    };

    let partial = query.partial;
    let result = tokio::task::spawn_blocking(move || {
        let (dir_part, prefix) = split_partial(&partial);
        let read_dir_path = resolve_dir(dir_part, &base, &home);
        let completions = list_completions(&read_dir_path, dir_part, prefix);
        json!({ "completions": completions })
    })
    .await;

    match result {
        Ok(body) => (StatusCode::OK, axum::Json(body)).into_response(),
        Err(_join_err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({"status": "error", "message": "internal error"})),
        )
            .into_response(),
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_partial_separates_dir_and_prefix() {
        assert_eq!(split_partial(""), ("", ""));
        assert_eq!(split_partial("pri"), ("", "pri"));
        assert_eq!(split_partial("/pri"), ("/", "pri"));
        assert_eq!(split_partial("/private/"), ("/private/", ""));
        assert_eq!(split_partial("../sh"), ("../", "sh"));
        assert_eq!(split_partial("~/Doc"), ("~/", "Doc"));
    }

    #[test]
    fn resolve_dir_handles_absolute_relative_and_home() {
        let base = Path::new("/project");
        let home = Path::new("/home/user");
        assert_eq!(resolve_dir("", base, home), PathBuf::from("/project"));
        assert_eq!(resolve_dir("../", base, home), PathBuf::from("/project/../"));
        assert_eq!(resolve_dir("/abs/", base, home), PathBuf::from("/abs/"));
        assert_eq!(resolve_dir("~/", base, home), PathBuf::from("/home/user"));
        assert_eq!(
            resolve_dir("~/code/", base, home),
            PathBuf::from("/home/user/code")
        );
    }

    #[test]
    fn list_completions_returns_matching_child_dirs_only() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("private")).unwrap();
        std::fs::create_dir(dir.path().join("public")).unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("plan.txt"), "x").unwrap();

        // Prefix "p" matches the two p-dirs (sorted), not the plan.txt file.
        let out = list_completions(dir.path(), "/root/", "p");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["label"], json!("private/"));
        assert_eq!(out[0]["value"], json!("/root/private/"));
        assert_eq!(out[1]["label"], json!("public/"));
    }

    #[test]
    fn list_completions_is_case_insensitive_and_empty_prefix_lists_all_dirs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Private")).unwrap();
        assert_eq!(list_completions(dir.path(), "", "priv").len(), 1);
        assert_eq!(list_completions(dir.path(), "", "").len(), 1);
    }

    #[test]
    fn list_completions_missing_dir_is_empty() {
        assert!(list_completions(Path::new("/no/such/dir"), "", "").is_empty());
    }
}
