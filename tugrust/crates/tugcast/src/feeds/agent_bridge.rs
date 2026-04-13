//! Agent bridge module
//!
//! Per-session relay between the supervisor and a tugcode subprocess. Each
//! live Claude Code session runs an instance of [`run_session_bridge`], which
//! spawns the configured subprocess, performs the protocol handshake, and
//! relays CODE_INPUT frames to stdin and splice-stamped stdout lines to the
//! supervisor's merger channel.
//!
//! Subprocess spawning is abstracted behind [`ChildSpawner`] so unit tests
//! can simulate crash loops, handshake failures, and `session_init` emissions
//! without actually executing a binary.

use std::collections::VecDeque;
use std::io;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, Lines};
use tokio::process::Command;
use tokio::sync::{Mutex, broadcast, mpsc};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use tugcast_core::protocol::{FeedId, Frame, TugSessionId};

use super::agent_supervisor::{LedgerEntry, SpawnState, build_session_state_frame};
use super::code::{parse_code_input, splice_tug_session_id};

// ---------------------------------------------------------------------------
// CrashBudget
// ---------------------------------------------------------------------------

/// Crash budget tracking
#[derive(Debug)]
pub struct CrashBudget {
    timestamps: VecDeque<Instant>,
    max_crashes: usize,
    window: Duration,
}

impl CrashBudget {
    /// Create a new crash budget
    pub fn new(max_crashes: usize, window: Duration) -> Self {
        Self {
            timestamps: VecDeque::new(),
            max_crashes,
            window,
        }
    }

    /// Record a crash and return true if budget is exhausted
    pub fn record_crash(&mut self) -> bool {
        let now = Instant::now();
        self.timestamps.push_back(now);

        // Remove crashes outside the window
        while let Some(&first) = self.timestamps.front() {
            if now.duration_since(first) > self.window {
                self.timestamps.pop_front();
            } else {
                break;
            }
        }

        self.is_exhausted()
    }

    /// Check if crash budget is exhausted
    pub fn is_exhausted(&self) -> bool {
        self.timestamps.len() >= self.max_crashes
    }
}

// ---------------------------------------------------------------------------
// resolve_tugcode_path
// ---------------------------------------------------------------------------

/// Resolve tugcode binary path
///
/// Priority order:
/// 1. CLI override if provided
/// 2. Sibling binary (next to current executable)
/// 3. PATH lookup
/// 4. Bun fallback (bun run tugcode/src/main.ts)
pub fn resolve_tugcode_path(cli_override: Option<&Path>, project_dir: &Path) -> PathBuf {
    // CLI override has highest priority
    if let Some(path) = cli_override {
        return path.to_path_buf();
    }

    // Try sibling binary
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let sibling = parent.join("tugcode");
            if sibling.exists() {
                info!("Found tugcode sibling binary at {}", sibling.display());
                return sibling;
            }
        }
    }

    // Try PATH lookup
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            let candidate = PathBuf::from(dir).join("tugcode");
            if candidate.exists() {
                info!("Found tugcode in PATH at {}", candidate.display());
                return candidate;
            }
        }
    }

    // Fallback to bun run (for development without cargo build)
    info!("tugcode binary not found, falling back to bun run");
    project_dir.join("tugcode/src/main.ts")
}

// ---------------------------------------------------------------------------
// ChildSpawner abstraction
// ---------------------------------------------------------------------------

/// Pinned-boxed future produced by [`ChildSpawner::spawn_child`].
pub type SpawnFuture = Pin<Box<dyn std::future::Future<Output = io::Result<SessionChild>> + Send>>;

/// Thin boxed wrapper around an active subprocess' stdin/stdout. The
/// `_keepalive` field owns whatever handle is needed to keep the child alive
/// and cleaned up on drop (e.g., `tokio::process::Child` with
/// `kill_on_drop(true)`).
pub struct SessionChild {
    pub stdin: Box<dyn AsyncWrite + Send + Unpin>,
    pub stdout: Box<dyn AsyncRead + Send + Unpin>,
    pub _keepalive: Box<dyn std::any::Any + Send>,
}

/// Abstraction over subprocess spawning so the supervisor can inject a
/// mock in unit tests without a real binary on disk. Production uses
/// [`TugcodeSpawner`].
pub trait ChildSpawner: Send + Sync + 'static {
    fn spawn_child(&self) -> SpawnFuture;
}

/// Production spawner: launches `tugcode --dir <project_dir>` (or the bun
/// fallback when the resolved path ends in `.ts`).
pub struct TugcodeSpawner {
    pub tugcode_path: PathBuf,
    pub project_dir: PathBuf,
}

impl TugcodeSpawner {
    pub fn new(tugcode_path: PathBuf, project_dir: PathBuf) -> Self {
        Self {
            tugcode_path,
            project_dir,
        }
    }
}

impl ChildSpawner for TugcodeSpawner {
    fn spawn_child(&self) -> SpawnFuture {
        let tugcode_path = self.tugcode_path.clone();
        let project_dir = self.project_dir.clone();
        Box::pin(async move {
            let (cmd, args): (String, Vec<String>) =
                if tugcode_path.extension().and_then(|s| s.to_str()) == Some("ts") {
                    (
                        "bun".to_string(),
                        vec!["run".to_string(), tugcode_path.display().to_string()],
                    )
                } else {
                    (
                        tugcode_path
                            .to_str()
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "tugcode".to_string()),
                        Vec::new(),
                    )
                };
            info!(cmd, ?args, "Spawning tugcode");
            let mut child = Command::new(&cmd)
                .args(&args)
                .arg("--dir")
                .arg(&project_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .kill_on_drop(true)
                .spawn()?;
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| io::Error::other("tugcode stdin not available"))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| io::Error::other("tugcode stdout not available"))?;
            Ok(SessionChild {
                stdin: Box::new(stdin),
                stdout: Box::new(stdout),
                _keepalive: Box::new(child),
            })
        })
    }
}

// ---------------------------------------------------------------------------
// run_session_bridge — outer loop (spawn, handshake, relay, crash budget)
// ---------------------------------------------------------------------------

/// Outcome of a single relay iteration, consumed by [`run_session_bridge`]
/// to decide whether to re-spawn the subprocess or exit the session.
///
/// There is no `ClosedNormally` variant: stdout EOF on a tugcode subprocess
/// is indistinguishable from a crash at this layer (we have no way to read
/// the exit status without losing the ability to drain remaining stdout
/// lines), so orderly shutdowns come through the cancel path.
#[derive(Debug, PartialEq, Eq)]
pub enum RelayOutcome {
    /// Cancellation token fired or the merger receiver closed — bridge exits.
    Cancelled,
    /// Subprocess died abnormally (or closed stdout) — bridge records a
    /// crash and may retry up to the per-session crash budget.
    Crashed,
}

/// Default retry backoff between crash-loop iterations.
pub const DEFAULT_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Per-session bridge task. Spawns and supervises the tugcode subprocess
/// for a single `TugSessionId`. On crash, re-spawns until the per-session
/// `CrashBudget` (lives inside the ledger entry) is exhausted, at which point
/// publishes `SESSION_STATE = errored{detail: "crash_budget_exhausted"}` and
/// drops the dispatcher sender so the dispatcher stops forwarding input.
///
/// `retry_delay` is the backoff between crash-loop iterations. Production
/// uses [`DEFAULT_RETRY_DELAY`]; tests pass a sub-millisecond value so the
/// crash-loop completes synchronously.
#[allow(clippy::too_many_arguments)]
pub async fn run_session_bridge(
    tug_session_id: TugSessionId,
    ledger_entry: Arc<Mutex<LedgerEntry>>,
    mut input_rx: mpsc::Receiver<Frame>,
    merger_tx: mpsc::Sender<Frame>,
    state_tx: broadcast::Sender<Frame>,
    spawner: Arc<dyn ChildSpawner>,
    cancel: CancellationToken,
    retry_delay: Duration,
) {
    loop {
        // Crash-budget check: if exhausted, flip state + drop dispatcher
        // sender under a single lock acquisition so a racing `close_session`
        // can't have its `Closed` flip clobbered by our `Errored` assignment.
        // If close beat us here, skip the `errored` publish entirely —
        // close_session has already published `closed` and the client
        // observing both would see a conflicting lifecycle.
        {
            let mut entry = ledger_entry.lock().await;
            if entry.crash_budget.is_exhausted() {
                let already_closed = entry.spawn_state == SpawnState::Closed;
                if !already_closed {
                    entry.spawn_state = SpawnState::Errored;
                }
                entry.input_tx = None;
                drop(entry);
                if !already_closed {
                    error!(session = %tug_session_id, "crash budget exhausted");
                    let _ = state_tx.send(build_session_state_frame(
                        &tug_session_id,
                        "errored",
                        Some("crash_budget_exhausted"),
                    ));
                }
                return;
            }
        }

        // Spawn subprocess — interruptible by cancel so
        // `close_session` can tear down a stalled spawner.
        let spawn_result = tokio::select! {
            result = spawner.spawn_child() => result,
            _ = cancel.cancelled() => return,
        };
        let child = match spawn_result {
            Ok(c) => c,
            Err(e) => {
                error!(session = %tug_session_id, error = %e, "failed to spawn tugcode");
                ledger_entry.lock().await.crash_budget.record_crash();
                tokio::select! {
                    _ = sleep(retry_delay) => continue,
                    _ = cancel.cancelled() => return,
                }
            }
        };

        // Run one relay iteration.
        let lines = BufReader::new(child.stdout).lines();
        let outcome = relay_session_io(
            &tug_session_id,
            &ledger_entry,
            &mut input_rx,
            &merger_tx,
            &state_tx,
            child.stdin,
            lines,
            &cancel,
        )
        .await;

        // `child._keepalive` (holding tokio::process::Child) drops here at end
        // of iteration if we fall through. `kill_on_drop(true)` cleans up.
        drop(child._keepalive);

        match outcome {
            RelayOutcome::Cancelled => return,
            RelayOutcome::Crashed => {
                ledger_entry.lock().await.crash_budget.record_crash();
                info!(session = %tug_session_id, "tugcode crashed; retrying");
                tokio::select! {
                    _ = sleep(retry_delay) => continue,
                    _ = cancel.cancelled() => return,
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// relay_session_io — generic, testable inner relay
// ---------------------------------------------------------------------------

/// Single relay iteration: handshake with the child, pump CODE_INPUT into
/// stdin, splice-stamp stdout lines into the merger channel, populate
/// `claude_session_id` on `session_init`, and publish `SESSION_STATE = live`
/// once a `session_init` arrives.
///
/// Generic over the stdin/stdout concrete types so tests can drive this
/// directly with [`tokio::io::duplex`] streams instead of a real subprocess.
#[allow(clippy::too_many_arguments)]
pub async fn relay_session_io(
    tug_session_id: &TugSessionId,
    ledger_entry: &Arc<Mutex<LedgerEntry>>,
    input_rx: &mut mpsc::Receiver<Frame>,
    merger_tx: &mpsc::Sender<Frame>,
    state_tx: &broadcast::Sender<Frame>,
    mut stdin: Box<dyn AsyncWrite + Send + Unpin>,
    mut lines: Lines<BufReader<Box<dyn AsyncRead + Send + Unpin>>>,
    cancel: &CancellationToken,
) -> RelayOutcome {
    // Handshake: write protocol_init, then wait up to 5s for protocol_ack.
    let protocol_init = b"{\"type\":\"protocol_init\",\"version\":1}\n";
    if let Err(e) = stdin.write_all(protocol_init).await {
        error!(session = %tug_session_id, error = %e, "failed to write protocol_init");
        return RelayOutcome::Crashed;
    }

    let ack = tokio::time::timeout(Duration::from_secs(5), lines.next_line()).await;
    match ack {
        Ok(Ok(Some(line))) if line.contains("\"type\":\"protocol_ack\"") => {
            info!(session = %tug_session_id, "protocol handshake successful");
        }
        Ok(Ok(Some(line))) => {
            error!(session = %tug_session_id, line, "invalid protocol_ack");
            return RelayOutcome::Crashed;
        }
        Ok(Ok(None)) => {
            error!(session = %tug_session_id, "tugcode stdout closed before protocol_ack");
            return RelayOutcome::Crashed;
        }
        Ok(Err(e)) => {
            error!(session = %tug_session_id, error = %e, "read error during protocol_ack");
            return RelayOutcome::Crashed;
        }
        Err(_) => {
            error!(session = %tug_session_id, "protocol_ack timed out");
            return RelayOutcome::Crashed;
        }
    }

    // Relay loop.
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                info!(session = %tug_session_id, "relay cancelled");
                return RelayOutcome::Cancelled;
            }
            line_result = lines.next_line() => {
                match line_result {
                    Ok(Some(line)) => {
                        // `session_init` path: atomic promote. Lock the
                        // ledger entry once and perform all four side
                        // effects — populate `claude_session_id`, flip
                        // `spawn_state` to `Live`, drain the per-session
                        // queue into `input_tx`, and publish the wire
                        // `SESSION_STATE = live` frame — so there is no
                        // intermediate state visible to other tasks where
                        // `spawn_state == Live` but the queue still holds
                        // frames that must precede any dispatcher-forwarded
                        // frame on input_tx.
                        //
                        // This is the sole point in the supervisor where
                        // ledger `Live` and wire `live` are established;
                        // the two are now semantically identical
                        // ("handshake done and session_init received").
                        //
                        // Guard: only promote if we're still in `Spawning`.
                        // A racing `close_session` that has already flipped
                        // us to `Closed`, or a previous iteration that
                        // already promoted, both short-circuit cleanly.
                        if line.contains("\"type\":\"session_init\"") {
                            let claude_id = parse_claude_session_id(line.as_bytes());
                            let mut entry = ledger_entry.lock().await;
                            if let Some(id) = claude_id {
                                entry.claude_session_id = Some(id);
                            }
                            if entry.spawn_state == SpawnState::Spawning {
                                entry.spawn_state.try_transition(SpawnState::Live).ok();
                                if let Some(tx) = entry.input_tx.clone() {
                                    while let Some(queued) = entry.queue.pop() {
                                        if tx.try_send(queued).is_err() {
                                            break;
                                        }
                                    }
                                }
                                // broadcast::Sender::send is synchronous,
                                // so we can publish the wire frame while
                                // the ledger lock is still held.
                                let _ = state_tx.send(build_session_state_frame(
                                    tug_session_id,
                                    "live",
                                    None,
                                ));
                            }
                            drop(entry);
                        }

                        let spliced = splice_tug_session_id(line.as_bytes(), tug_session_id.as_str());
                        let frame = Frame::new(FeedId::CODE_OUTPUT, spliced);
                        if merger_tx.send(frame).await.is_err() {
                            warn!(session = %tug_session_id, "merger receiver closed; ending relay");
                            return RelayOutcome::Cancelled;
                        }
                    }
                    Ok(None) => {
                        warn!(session = %tug_session_id, "tugcode stdout closed");
                        return RelayOutcome::Crashed;
                    }
                    Err(e) => {
                        error!(session = %tug_session_id, error = %e, "stdout read error");
                        return RelayOutcome::Crashed;
                    }
                }
            }
            maybe_frame = input_rx.recv() => {
                let Some(frame) = maybe_frame else {
                    // Dispatcher sender dropped — we're being torn down.
                    return RelayOutcome::Cancelled;
                };
                if let Some(json) = parse_code_input(&frame) {
                    let mut line = json;
                    line.push('\n');
                    if let Err(e) = stdin.write_all(line.as_bytes()).await {
                        error!(session = %tug_session_id, error = %e, "stdin write error");
                        return RelayOutcome::Crashed;
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract Claude Code's internal `session_id` field from a `session_init`
/// stream-json line. Used to populate `LedgerEntry::claude_session_id`.
fn parse_claude_session_id(line: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(line).ok()?;
    value
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crash_budget_within_window() {
        let mut budget = CrashBudget::new(3, Duration::from_secs(60));
        assert!(!budget.record_crash());
        assert!(!budget.record_crash());
        assert!(budget.record_crash());
        assert!(budget.is_exhausted());
    }

    #[test]
    fn test_crash_budget_outside_window() {
        let mut budget = CrashBudget::new(3, Duration::from_millis(1));
        // Exhaust the budget
        budget.record_crash();
        budget.record_crash();
        assert!(budget.record_crash());
        assert!(budget.is_exhausted());

        // Wait for the window to expire
        std::thread::sleep(Duration::from_millis(10));

        // Budget should reset — old crashes fall outside the window
        assert!(!budget.record_crash());
        assert!(!budget.is_exhausted());
    }

    #[test]
    fn test_resolve_cli_override_returns_exact_path() {
        let override_path = Path::new("/custom/path/tugcode");
        let result = resolve_tugcode_path(Some(override_path), Path::new("/project"));
        assert_eq!(result, override_path);
    }

    #[test]
    fn test_resolve_without_override_finds_sibling_or_falls_back() {
        let result = resolve_tugcode_path(None, Path::new("/project"));
        let s = result.to_str().unwrap();
        // In test builds, the tugcode binary sits next to the test binary in target/debug/,
        // so the sibling check succeeds. In environments without a sibling, it falls back
        // to the bun-run path (tugcode/src/main.ts).
        assert!(
            s.ends_with("/tugcode") || s.contains("tugcode/src/main.ts"),
            "Expected sibling binary or bun fallback, got: {s}"
        );
    }

    #[test]
    fn test_parse_claude_session_id_present() {
        let line = br#"{"type":"session_init","session_id":"claude-abc"}"#;
        assert_eq!(parse_claude_session_id(line), Some("claude-abc".into()));
    }

    #[test]
    fn test_parse_claude_session_id_absent() {
        let line = br#"{"type":"session_init"}"#;
        assert_eq!(parse_claude_session_id(line), None);
        assert_eq!(parse_claude_session_id(b"not json"), None);
    }
}
