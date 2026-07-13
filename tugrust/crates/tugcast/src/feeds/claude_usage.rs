//! Single-shot subscription-usage fetch via `claude -p "/usage"`.
//!
//! The `/usage` panel (limit gauges + reset times + the "what's contributing"
//! breakdown) is owned by the `claude` CLI: it fetches the account-global
//! windows from `GET /api/oauth/usage` and computes the local-session
//! contribution characteristics itself. Rather than duplicate that (and handle
//! the OAuth token ourselves), we ask `claude` for it — exactly as
//! [`super::claude_auth`] shells out to `claude auth status`. `claude -p
//! "/usage"` runs the command headlessly and prints the whole panel as text,
//! which we forward verbatim for the deck to parse.
//!
//! The Anthropic auth env vars are scrubbed (via
//! [`super::claude_auth::claude_command`]) so the figures reflect the user's
//! subscription — the auth path that actually has usage limits — rather than a
//! stray `ANTHROPIC_API_KEY`.

use std::time::Duration;

use super::claude_auth::claude_command;

/// Hard ceiling on the `claude -p "/usage"` round-trip. The CLI itself times its
/// usage fetch out at ~5s, so a well-behaved run finishes well inside this; the
/// ceiling exists only to bound a pathological hang (an update check, an auth
/// re-prompt) so the sheet surfaces an error rather than spinning forever.
const USAGE_TIMEOUT: Duration = Duration::from_secs(20);

/// Run `claude -p "/usage"` and return `(ok, stdout_text, error)`.
///
/// `ok` is true only on a zero exit; on failure `error` carries the last stderr
/// line (or a not-found / spawn / timeout message) so the deck can surface a
/// reason instead of a blank sheet. A missing `claude` binary resolves to a
/// friendly "Claude Code isn't installed" rather than a raw OS error. The child
/// is `kill_on_drop`, so a timeout reaps it rather than orphaning a process.
pub async fn fetch_usage_text() -> (bool, String, Option<String>) {
    let mut cmd = claude_command(&["-p", "/usage"]);
    cmd.kill_on_drop(true);
    let result = match tokio::time::timeout(USAGE_TIMEOUT, cmd.output()).await {
        Ok(result) => result,
        Err(_elapsed) => {
            return (
                false,
                String::new(),
                Some("Timed out fetching usage".to_string()),
            );
        }
    };
    match result {
        Ok(out) if out.status.success() => (
            true,
            String::from_utf8_lossy(&out.stdout).into_owned(),
            None,
        ),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let detail = stderr
                .trim()
                .lines()
                .last()
                .filter(|l| !l.is_empty())
                .unwrap_or("`claude /usage` failed")
                .to_string();
            (
                false,
                String::from_utf8_lossy(&out.stdout).into_owned(),
                Some(detail),
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (
            false,
            String::new(),
            Some("Claude Code isn't installed".to_string()),
        ),
        Err(e) => (false, String::new(), Some(e.to_string())),
    }
}
