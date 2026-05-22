//! HTTP handler for the `GET /api/host` endpoint.
//!
//! Exposes static facts about the host tugcast runs on — its network
//! `hostname` and the basename of the login `$SHELL` — so the frontend
//! can name what each prompt-entry route targets. Read-only; restricted
//! to loopback connections like the other `/api` handlers.
//!
//! The response shape is fixed by Spec S01: `{ "hostname": <str>, "shell":
//! <str> }`. Both values are resolved once per request from the running
//! process's environment; host facts do not change over a server's lifetime.

use std::net::SocketAddr;

use axum::extract::ConnectInfo;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use tracing::warn;

/// JSON body of `GET /api/host` (Spec S01).
///
/// Field names are part of the cross-stack contract — `HostFactsStore`
/// in tugdeck parses these exact keys. Do not rename without updating
/// both sides.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct HostFacts {
    /// The host's network name, from `gethostname(2)`. Empty if the
    /// system call fails or the name is not valid UTF-8.
    hostname: String,
    /// The basename of the login shell (`$SHELL` → `zsh`, `bash`, …).
    /// Empty when `$SHELL` is unset, per Spec S01.
    shell: String,
}

impl HostFacts {
    /// Resolve host facts from the running process's environment.
    fn resolve() -> Self {
        HostFacts {
            hostname: resolve_hostname(),
            shell: shell_basename(std::env::var("SHELL").ok().as_deref()),
        }
    }
}

/// Resolve the host's network name via `gethostname(2)`.
///
/// Returns an empty string if the call fails or the name is not valid
/// UTF-8 — the frontend treats an empty value as "not yet known".
fn resolve_hostname() -> String {
    // `HOST_NAME_MAX` is 64 on Linux and 255 on macOS; 256 bytes holds
    // either plus the NUL terminator with room to spare.
    const BUF_LEN: usize = 256;
    let mut buf = [0u8; BUF_LEN];
    // SAFETY: `gethostname` writes at most `BUF_LEN` bytes into `buf` and
    // NUL-terminates when there is room. `buf` is a stack array that
    // outlives the call; the pointer and length describe it exactly.
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, BUF_LEN) };
    if rc != 0 {
        return String::new();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(BUF_LEN);
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

/// Extract the basename of a shell path: `/bin/zsh` → `zsh`.
///
/// `None` (an unset `$SHELL`), an empty string, and a path with no final
/// component all yield an empty string, per Spec S01.
fn shell_basename(shell_path: Option<&str>) -> String {
    let Some(path) = shell_path else {
        return String::new();
    };
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_owned()
}

/// Handle `GET /api/host`.
///
/// Returns `{ "hostname": <str>, "shell": <str> }` (Spec S01) with
/// `Content-Type: application/json`. Read-only; restricted to loopback
/// connections like the other `/api` handlers.
pub(crate) async fn get_host(ConnectInfo(addr): ConnectInfo<SocketAddr>) -> Response {
    if !addr.ip().is_loopback() {
        warn!("get_host: rejected non-loopback connection from {}", addr);
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"status": "error", "message": "forbidden"})),
        )
            .into_response();
    }
    (StatusCode::OK, axum::Json(HostFacts::resolve())).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_facts_serializes_with_spec_s01_field_names() {
        let facts = HostFacts {
            hostname: "studio.local".to_owned(),
            shell: "zsh".to_owned(),
        };
        let json = serde_json::to_value(&facts).expect("HostFacts serializes");
        let obj = json.as_object().expect("serializes to a JSON object");

        // Exactly the two Spec S01 fields, both JSON strings.
        assert_eq!(obj.len(), 2);
        assert_eq!(obj.get("hostname").and_then(|v| v.as_str()), Some("studio.local"));
        assert_eq!(obj.get("shell").and_then(|v| v.as_str()), Some("zsh"));
    }

    #[test]
    fn shell_basename_strips_the_directory_prefix() {
        assert_eq!(shell_basename(Some("/bin/zsh")), "zsh");
        assert_eq!(shell_basename(Some("/bin/bash")), "bash");
        assert_eq!(shell_basename(Some("/usr/local/bin/fish")), "fish");
    }

    #[test]
    fn shell_basename_is_empty_when_shell_is_unset() {
        // `std::env::var("SHELL").ok()` yields `None` when `$SHELL` is unset.
        assert_eq!(shell_basename(None), "");
    }

    #[test]
    fn shell_basename_is_empty_for_a_blank_or_trailing_slash_path() {
        assert_eq!(shell_basename(Some("")), "");
        // A bare shell name with no directory is its own basename.
        assert_eq!(shell_basename(Some("zsh")), "zsh");
        // A trailing slash does not hide the final component.
        assert_eq!(shell_basename(Some("/bin/zsh/")), "zsh");
    }
}
