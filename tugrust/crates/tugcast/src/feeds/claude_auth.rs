//! Detection of the user's Claude Code login state via `claude auth status`,
//! plus a `login()` helper that drives `claude auth login`.
//!
//! `claude` owns authentication (the credentials live in the macOS Keychain,
//! not a file we could read), so we ask the CLI rather than inspecting storage
//! directly. The same Anthropic auth env vars that `agent_bridge` scrubs before
//! spawning sessions are scrubbed here, so the reported status reflects the
//! subscription auth path (`~/.claude.json`) that sessions actually use rather
//! than a stray `ANTHROPIC_API_KEY` in the developer's environment.

use tokio::process::Command;

/// Resolved Claude Code login state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthState {
    /// The `claude` CLI is not on PATH.
    ClaudeMissing,
    /// CLI present but no valid login.
    LoggedOut,
    /// Logged in; carries account details for the sign-in UI.
    LoggedIn(AccountInfo),
}

/// Account details surfaced by `claude auth status --json`, shown in the
/// sign-in sheet (e.g. "Signed in as user@example.com — Max").
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AccountInfo {
    pub email: Option<String>,
    pub subscription_type: Option<String>,
    pub auth_method: Option<String>,
}

/// Anthropic auth env vars scrubbed so the probe and login authenticate via the
/// user's subscription, matching `agent_bridge` session spawns. Keep in sync
/// with `AUTH_ENV_VARS` in `tests/common/catalog.rs` and the destructure in
/// `tugcode/src/session.ts::spawnClaude`.
const AUTH_ENV_VARS: [&str; 3] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
];

/// A `claude` command with the Anthropic auth env vars scrubbed. Resolved from
/// PATH (the app forwards the user's full shell PATH to tugcast).
fn claude_command(args: &[&str]) -> Command {
    let mut cmd = Command::new("claude");
    cmd.args(args);
    for var in AUTH_ENV_VARS {
        cmd.env_remove(var);
    }
    cmd
}

/// Probe the current login state by running `claude auth status --json`.
///
/// Fast and local — the CLI reports stored auth without a model query. A
/// missing `claude` binary resolves to [`AuthState::ClaudeMissing`]; any other
/// failure resolves to [`AuthState::LoggedOut`] so the UI offers sign-in rather
/// than silently crash-looping a session.
pub async fn probe() -> AuthState {
    match claude_command(&["auth", "status", "--json"]).output().await {
        Ok(output) => parse_status(&String::from_utf8_lossy(&output.stdout)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => AuthState::ClaudeMissing,
        Err(_) => AuthState::LoggedOut,
    }
}

/// Parse `claude auth status --json` stdout into an [`AuthState`]. Output that
/// is unparseable or reports `loggedIn: false` is treated as logged-out.
fn parse_status(stdout: &str) -> AuthState {
    #[derive(serde::Deserialize)]
    struct Raw {
        #[serde(rename = "loggedIn")]
        logged_in: bool,
        email: Option<String>,
        #[serde(rename = "subscriptionType")]
        subscription_type: Option<String>,
        #[serde(rename = "authMethod")]
        auth_method: Option<String>,
    }
    match serde_json::from_str::<Raw>(stdout.trim()) {
        Ok(raw) if raw.logged_in => AuthState::LoggedIn(AccountInfo {
            email: raw.email,
            subscription_type: raw.subscription_type,
            auth_method: raw.auth_method,
        }),
        _ => AuthState::LoggedOut,
    }
}

/// Drive `claude auth login` and await completion, then return the freshly
/// probed state.
///
/// The CLI opens the browser and blocks on its own localhost OAuth callback,
/// so the child process exiting *is* the completion signal — no polling. We
/// re-probe afterward regardless of exit code because the probe is the
/// authoritative source of truth (the user may have completed or abandoned the
/// browser flow).
pub async fn login() -> AuthState {
    let _ = claude_command(&["auth", "login"]).status().await;
    probe().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_logged_in_max_subscription() {
        // The real shape of `claude auth status --json` for a Max subscription.
        let json = r#"{
            "loggedIn": true,
            "authMethod": "claude.ai",
            "apiProvider": "firstParty",
            "email": "user@example.com",
            "orgId": "abc",
            "orgName": "Org",
            "subscriptionType": "max"
        }"#;
        assert_eq!(
            parse_status(json),
            AuthState::LoggedIn(AccountInfo {
                email: Some("user@example.com".to_string()),
                subscription_type: Some("max".to_string()),
                auth_method: Some("claude.ai".to_string()),
            })
        );
    }

    #[test]
    fn logged_out_when_flag_false() {
        assert_eq!(parse_status(r#"{"loggedIn": false}"#), AuthState::LoggedOut);
    }

    #[test]
    fn logged_out_when_unparseable() {
        assert_eq!(parse_status("not json at all"), AuthState::LoggedOut);
    }
}
