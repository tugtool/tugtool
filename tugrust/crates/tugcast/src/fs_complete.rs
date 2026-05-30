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
/// (`base`) relative paths resolve under, the `partial` path typed so far, and
/// the `kind` of entry to surface — `directory` (default) lists only child
/// directories; `file` lists files too (directories still appear so the user
/// can descend toward a file).
#[derive(Debug, Deserialize)]
pub(crate) struct CompleteQuery {
    base: String,
    #[serde(default)]
    partial: String,
    #[serde(default)]
    kind: Option<String>,
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

/// List children of `read_dir_path` whose names case-insensitively prefix-match
/// `prefix`, formatted as completion entries. Directories always appear (so a
/// file chooser can descend); files appear only when `include_files`. The
/// `dir_part` (as typed) is prepended to each name so the returned `value` is a
/// drop-in replacement for the input — directories get a trailing `/` (to keep
/// descending), files do not. Each entry carries `isDir`. Directories sort
/// before files, then alphabetically. Best-effort: returns `[]` on any read
/// error.
fn list_completions(
    read_dir_path: &Path,
    dir_part: &str,
    prefix: &str,
    include_files: bool,
) -> Vec<Value> {
    let entries = match std::fs::read_dir(read_dir_path) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let needle = prefix.to_lowercase();
    // (is_dir, name) — sorted dirs-first then by name.
    let mut found: Vec<(bool, String)> = Vec::new();
    for entry in entries.flatten() {
        let is_dir = match entry.file_type() {
            Ok(ft) => ft.is_dir(),
            Err(_) => false,
        };
        if !is_dir && !include_files {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.to_lowercase().starts_with(&needle) {
            found.push((is_dir, name));
        }
    }
    // Directories first (so descending is one keystroke away), then by name.
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    found
        .into_iter()
        .take(MAX_COMPLETIONS)
        .map(|(is_dir, name)| {
            let suffix = if is_dir { "/" } else { "" };
            json!({
                "label": format!("{name}{suffix}"),
                "value": format!("{dir_part}{name}{suffix}"),
                "isDir": is_dir,
            })
        })
        .collect()
}

/// Handle `GET /api/fs/complete?base=<abs>&partial=<text>&kind=<directory|file>`.
///
/// Returns `{ "completions": [ { "label", "value", "isDir" } ] }`. Restricted to
/// loopback. 400 when `base` is not absolute. A missing/unreadable parent
/// directory yields an empty list, not an error.
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
    let include_files = query.kind.as_deref() == Some("file");
    let result = tokio::task::spawn_blocking(move || {
        let (dir_part, prefix) = split_partial(&partial);
        let read_dir_path = resolve_dir(dir_part, &base, &home);
        let completions = list_completions(&read_dir_path, dir_part, prefix, include_files);
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
    fn list_completions_directory_kind_returns_child_dirs_only() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("private")).unwrap();
        std::fs::create_dir(dir.path().join("public")).unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("plan.txt"), "x").unwrap();

        // Prefix "p", directory kind → the two p-dirs only, not plan.txt.
        let out = list_completions(dir.path(), "/root/", "p", false);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["label"], json!("private/"));
        assert_eq!(out[0]["value"], json!("/root/private/"));
        assert_eq!(out[0]["isDir"], json!(true));
        assert_eq!(out[1]["label"], json!("public/"));
    }

    #[test]
    fn list_completions_file_kind_includes_files_dirs_first() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("pkg")).unwrap();
        std::fs::write(dir.path().join("plan.txt"), "x").unwrap();

        // Prefix "p", file kind → both, directory sorted first, files have no
        // trailing slash and isDir=false.
        let out = list_completions(dir.path(), "", "p", true);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["label"], json!("pkg/"));
        assert_eq!(out[0]["isDir"], json!(true));
        assert_eq!(out[1]["label"], json!("plan.txt"));
        assert_eq!(out[1]["value"], json!("plan.txt"));
        assert_eq!(out[1]["isDir"], json!(false));
    }

    #[test]
    fn list_completions_is_case_insensitive_and_empty_prefix_lists_all_dirs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Private")).unwrap();
        assert_eq!(list_completions(dir.path(), "", "priv", false).len(), 1);
        assert_eq!(list_completions(dir.path(), "", "", false).len(), 1);
    }

    #[test]
    fn list_completions_missing_dir_is_empty() {
        assert!(list_completions(Path::new("/no/such/dir"), "", "", false).is_empty());
    }
}
