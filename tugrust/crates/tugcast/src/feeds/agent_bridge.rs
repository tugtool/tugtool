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

use super::agent_supervisor::{
    LedgerEntry, LiveSessionsTracker, SessionsRecorder, SpawnState, build_session_state_frame,
};
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
/// 4. `.ts` fallback via `bun run` (debug-only)
pub fn resolve_tugcode_path(cli_override: Option<&Path>) -> PathBuf {
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

    // Fallback: bun-run the `.ts` source directly. Dev-only — a shipped
    // Tug.app bundles a compiled tugcode at Contents/MacOS/tugcode and
    // the sibling lookup above resolves it. Release tugcast that reaches
    // this point without finding a sibling or PATH binary is a bug.
    #[cfg(debug_assertions)]
    {
        info!("tugcode binary not found, falling back to bun run");
        crate::resources::source_tree().join("tugcode/src/main.ts")
    }
    #[cfg(not(debug_assertions))]
    panic!(
        "tugcode binary not found via sibling (Contents/MacOS/tugcode) or PATH; \
         required in release builds"
    );
}

// ---------------------------------------------------------------------------
// SessionMode
// ---------------------------------------------------------------------------

/// User's choice of session mode on spawn. Threaded from the tugdeck
/// `spawn_session` CONTROL payload through the supervisor into
/// `ChildSpawner::spawn_child`, which surfaces it as a `--session-mode`
/// CLI flag on the tugcode subprocess.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionMode {
    /// Fresh Claude session: tugcode passes `--session-id <id>` so
    /// claude claims the tugdeck-generated UUID as its own session id.
    New,
    /// Resume an existing session: tugcode passes `--resume <id>` so
    /// claude reopens the prior conversation under that same id.
    Resume,
}

impl SessionMode {
    /// CLI flag value for `--session-mode`.
    pub fn as_flag_value(&self) -> &'static str {
        match self {
            SessionMode::New => "new",
            SessionMode::Resume => "resume",
        }
    }

    /// JSON/wire identifier. Matches `as_flag_value` today; kept as a
    /// separate method so the two callers (tugcode CLI vs JSON ack)
    /// stay independently evolvable.
    pub fn as_wire_str(&self) -> &'static str {
        self.as_flag_value()
    }

    /// Decode a wire string (`"new"` / `"resume"`) into a `SessionMode`.
    /// Unknown / absent values default to `New`.
    pub fn from_wire_str(raw: Option<&str>) -> SessionMode {
        match raw {
            Some("resume") => SessionMode::Resume,
            _ => SessionMode::New,
        }
    }
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
///
/// W2: `spawn_child` takes the target `project_dir` per call rather than
/// capturing it at spawner construction. This lets a single spawner
/// instance service multiple sessions, each with its own workspace, and
/// removes the need for the supervisor to rebuild a spawner every time a
/// new session starts. Implementations must clone the path into owned
/// storage before `await`-ing, since the returned `SpawnFuture` outlives
/// the call frame.
pub trait ChildSpawner: Send + Sync + 'static {
    /// `project_dir` is the user-typed path tugdeck sent in the
    /// `spawn_session` CONTROL payload; tugcode uses it as the
    /// subprocess cwd.
    ///
    /// `session_id` is the single identifier for this session: the same
    /// UUID that tugdeck pre-generated for fresh spawns (or picked from
    /// the sessions record for resume), that tugcast uses as the feed
    /// routing key, and that claude adopts as its own session id (via
    /// `--session-id` for new, `--resume` for resume).
    ///
    /// `session_mode` is the user's new-vs-resume choice from the Tide
    /// picker. Forwarded to tugcode as `--session-mode new|resume`.
    fn spawn_child(
        &self,
        project_dir: &Path,
        session_id: &str,
        session_mode: SessionMode,
    ) -> SpawnFuture;
}

/// Production spawner: launches `tugcode --dir <project_dir>` (or the bun
/// fallback when the resolved path ends in `.ts`).
///
/// Stateless with respect to `project_dir` per W2 Step 4 — the supervisor
/// passes the target workspace to each `spawn_child` call. The only
/// captured state is the path to the tugcode binary.
pub struct TugcodeSpawner {
    pub tugcode_path: PathBuf,
}

impl TugcodeSpawner {
    pub fn new(tugcode_path: PathBuf) -> Self {
        Self { tugcode_path }
    }
}

/// Resolve the `(program, args)` pair for invoking tugcode at `tugcode_path`
/// against `project_dir`. Pure helper extracted so unit tests can assert the
/// exact argv without spawning a real subprocess.
///
/// - Paths ending in `.ts` are run via `bun run <path>` (dev fallback).
/// - Anything else is invoked directly.
///
/// In both cases the returned args vector ends with
/// `["--dir", <project_dir>, "--session-id", <uuid>, "--session-mode", <new|resume>]`.
pub(crate) fn build_tugcode_command(
    tugcode_path: &Path,
    project_dir: &Path,
    session_id: &str,
    session_mode: SessionMode,
) -> (String, Vec<String>) {
    let (program, mut args): (String, Vec<String>) =
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
    args.push("--dir".to_string());
    args.push(project_dir.display().to_string());
    args.push("--session-id".to_string());
    args.push(session_id.to_string());
    args.push("--session-mode".to_string());
    args.push(session_mode.as_flag_value().to_string());
    (program, args)
}

impl ChildSpawner for TugcodeSpawner {
    fn spawn_child(
        &self,
        project_dir: &Path,
        session_id: &str,
        session_mode: SessionMode,
    ) -> SpawnFuture {
        let tugcode_path = self.tugcode_path.clone();
        let project_dir = project_dir.to_path_buf();
        let session_id = session_id.to_string();
        Box::pin(async move {
            let (cmd, args) =
                build_tugcode_command(&tugcode_path, &project_dir, &session_id, session_mode);
            tracing::info!(
                target: "tide::session-lifecycle",
                event = "bridge.tugcode_spawn",
                tug_session_id = %session_id,
                session_mode = session_mode.as_wire_str(),
                cmd = %cmd,
                args = ?args,
                cwd = %project_dir.display(),
            );
            // Scrub Anthropic auth env vars so the downstream claude CLI
            // authenticates via `~/.claude.json` (the user's Max/Pro
            // subscription) rather than per-token API billing. If the
            // developer has any of these variables exported for other
            // work (e.g. direct API scripts), we do NOT want it to leak
            // into tugcode → claude.
            //
            // Keep this list in sync with `AUTH_ENV_VARS` in
            // `tugrust/crates/tugcast/tests/common/catalog.rs` and the
            // destructure in `tugcode/src/session.ts::spawnClaude`.
            let mut child = Command::new(&cmd)
                .args(&args)
                .env_remove("ANTHROPIC_API_KEY")
                .env_remove("ANTHROPIC_AUTH_TOKEN")
                .env_remove("CLAUDE_CODE_OAUTH_TOKEN")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
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
            // Forward tugcode's stderr (which also carries Claude's
            // stderr via the `stderr: "inherit"` chain in
            // `tugcode/src/session.ts::spawnClaude`) into tugcast's
            // tracing log. Without this the subprocess stderr pipe
            // is lost to `launchd` when Tug.app is launched via
            // `open` (`just app`), and real errors (Claude API
            // failures, auth problems, missing configs) never reach
            // the operator. Each line is forwarded verbatim under
            // the `tugcast::tugcode_stderr` target so consumers can
            // grep by that tag.
            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(async move {
                    let mut lines = BufReader::new(stderr).lines();
                    loop {
                        match lines.next_line().await {
                            Ok(Some(line)) => {
                                tracing::warn!(
                                    target: "tugcast::tugcode_stderr",
                                    "{line}",
                                );
                            }
                            Ok(None) => break,
                            Err(err) => {
                                tracing::warn!(
                                    target: "tugcast::tugcode_stderr",
                                    "stderr read error: {err}",
                                );
                                break;
                            }
                        }
                    }
                });
            }
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
    /// Subprocess emitted `resume_failed` and then exited. The outer loop
    /// must NOT retry — re-spawning would just hit the same stale
    /// `--resume` id and loop until crash-budget exhausted. The bridge
    /// publishes `SESSION_STATE = errored { detail: "resume_failed" }`
    /// and tears down.
    ResumeFailed {
        stale_session_id: String,
        reason: String,
    },
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
    project_dir: PathBuf,
    session_mode: SessionMode,
    sessions_recorder: Arc<dyn SessionsRecorder>,
    live_sessions: Arc<dyn LiveSessionsTracker>,
    cancel: CancellationToken,
    retry_delay: Duration,
) {
    // `tug_session_id` is also the session id we pass to tugcode via
    // `--session-id` — the single identifier for this session.
    let session_id_str = tug_session_id.as_str().to_string();
    let project_dir_str = project_dir.display().to_string();
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
                // Release the live-card binding so a future resume
                // from any card is allowed.
                entry.card_id_live = None;
                drop(entry);
                live_sessions.set_live(tug_session_id.as_str(), false);
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
        tracing::info!(
            target: "tide::session-lifecycle",
            event = "spawn.child_invoke",
            tug_session_id = %tug_session_id,
            session_mode = session_mode.as_wire_str(),
            project_dir = %project_dir_str,
        );
        let spawn_result = tokio::select! {
            result = spawner.spawn_child(
                project_dir.as_path(),
                session_id_str.as_str(),
                session_mode,
            ) => result,
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
            &project_dir_str,
            sessions_recorder.as_ref(),
            &cancel,
        )
        .await;

        // `child._keepalive` (holding tokio::process::Child) drops here at end
        // of iteration if we fall through. `kill_on_drop(true)` cleans up.
        drop(child._keepalive);

        match outcome {
            RelayOutcome::Cancelled => {
                tracing::info!(
                    target: "tide::session-lifecycle",
                    event = "bridge.relay_outcome",
                    tug_session_id = %tug_session_id,
                    outcome = "cancelled",
                );
                return;
            }
            RelayOutcome::Crashed => {
                tracing::info!(
                    target: "tide::session-lifecycle",
                    event = "bridge.relay_outcome",
                    tug_session_id = %tug_session_id,
                    outcome = "crashed",
                );
                ledger_entry.lock().await.crash_budget.record_crash();
                info!(session = %tug_session_id, "tugcode crashed; retrying");
                tokio::select! {
                    _ = sleep(retry_delay) => continue,
                    _ = cancel.cancelled() => return,
                }
            }
            RelayOutcome::ResumeFailed {
                stale_session_id,
                reason,
            } => {
                tracing::info!(
                    target: "tide::session-lifecycle",
                    event = "bridge.relay_outcome",
                    tug_session_id = %tug_session_id,
                    outcome = "resume_failed",
                    stale_session_id = stale_session_id.as_str(),
                    reason = reason.as_str(),
                );
                // tugcode emitted `resume_failed` and exited.
                // Re-spawning would just hit the same stale id again,
                // so mark the session errored and return without
                // retrying. The bridge has already forwarded the
                // `resume_failed` CODE_OUTPUT frame to the card, and
                // `sessions_recorder` removed the stale record.
                let mut entry = ledger_entry.lock().await;
                let already_closed = entry.spawn_state == SpawnState::Closed;
                if !already_closed {
                    entry.spawn_state = SpawnState::Errored;
                }
                entry.input_tx = None;
                // Release the live-card binding so a future resume
                // from any card is allowed.
                entry.card_id_live = None;
                drop(entry);
                live_sessions.set_live(tug_session_id.as_str(), false);
                if !already_closed {
                    info!(
                        session = %tug_session_id,
                        stale_session_id,
                        reason,
                        "resume failed terminally; not retrying"
                    );
                    let _ = state_tx.send(build_session_state_frame(
                        &tug_session_id,
                        "errored",
                        Some("resume_failed"),
                    ));
                }
                return;
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
    project_dir: &str,
    sessions_recorder: &dyn SessionsRecorder,
    cancel: &CancellationToken,
) -> RelayOutcome {
    // Captured when tugcode emits `resume_failed`. tugcode then
    // exits cleanly (no silent fresh-spawn fallback); we promote the
    // subsequent EOF from `Crashed` (would retry) to `ResumeFailed`
    // (terminal).
    let mut resume_failed: Option<(String, String)> = None;

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
                            tracing::info!(
                                target: "tide::session-lifecycle",
                                event = "session_init.parse",
                                tug_session_id = %tug_session_id,
                                claude_session_id = claude_id.as_deref().unwrap_or(""),
                            );
                            let mut entry = ledger_entry.lock().await;
                            if let Some(id) = &claude_id {
                                entry.claude_session_id = Some(id.clone());
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

                            // Record under claude's own session id — that
                            // is the on-disk file name, the only thing
                            // `--resume` accepts, and the unforgeable
                            // identity of the conversation. Tugdeck's
                            // prompt history follows the same id (read
                            // from `CodeSessionStore.claudeSessionId`,
                            // which is captured from this same
                            // `session_init`), so picker → sessions
                            // record → prompt history all key on the
                            // string claude told us, never on a value
                            // we assumed and forced.
                            //
                            // If claude failed to emit one we still need
                            // SOMETHING to key by; fall back to the
                            // tug session id and log loudly. In practice
                            // this only happens on malformed payloads.
                            let record_id = match claude_id.as_deref() {
                                Some(id) => id,
                                None => {
                                    warn!(
                                        tug_session_id = %tug_session_id,
                                        "session_init payload missing session_id; \
                                         recording under tug_session_id as a fallback"
                                    );
                                    tug_session_id.as_str()
                                }
                            };
                            sessions_recorder.record(record_id, project_dir);
                        }

                        // `resume_failed` peek: tugcode emits this when
                        // a `--resume` attempt aborts before `session_init`.
                        // The stale id is no longer usable; remove its
                        // sessions record so the next picker doesn't
                        // re-offer it. The frame still gets forwarded to
                        // the card so `lastError` surfaces a notice.
                        if line.contains("\"type\":\"resume_failed\"") {
                            let reason = parse_resume_failed_reason(line.as_bytes())
                                .unwrap_or_else(|| "resume failed".to_string());
                            if let Some(stale) = parse_resume_failed_id(line.as_bytes()) {
                                tracing::info!(
                                    target: "tide::session-lifecycle",
                                    event = "bridge.resume_failed_recv",
                                    tug_session_id = %tug_session_id,
                                    stale_session_id = stale.as_str(),
                                    reason = reason.as_str(),
                                );
                                sessions_recorder.remove(&stale);
                                resume_failed = Some((stale, reason));
                            }
                        }

                        let spliced = splice_tug_session_id(line.as_bytes(), tug_session_id.as_str());
                        let frame = Frame::new(FeedId::CODE_OUTPUT, spliced);
                        if merger_tx.send(frame).await.is_err() {
                            warn!(session = %tug_session_id, "merger receiver closed; ending relay");
                            return RelayOutcome::Cancelled;
                        }
                    }
                    Ok(None) => {
                        if let Some((stale, reason)) = resume_failed.take() {
                            info!(
                                session = %tug_session_id,
                                stale_session_id = stale,
                                "tugcode exited after resume_failed; not retrying"
                            );
                            return RelayOutcome::ResumeFailed {
                                stale_session_id: stale,
                                reason,
                            };
                        }
                        warn!(session = %tug_session_id, "tugcode stdout closed");
                        return RelayOutcome::Crashed;
                    }
                    Err(e) => {
                        if let Some((stale, reason)) = resume_failed.take() {
                            info!(
                                session = %tug_session_id,
                                stale_session_id = stale,
                                error = %e,
                                "tugcode stdout error after resume_failed; not retrying"
                            );
                            return RelayOutcome::ResumeFailed {
                                stale_session_id: stale,
                                reason,
                            };
                        }
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

/// Extract the `stale_session_id` field from a `resume_failed` IPC line.
/// Used by the bridge to remove the stale sessions record after a
/// failed `--resume` attempt.
fn parse_resume_failed_id(line: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(line).ok()?;
    value
        .get("stale_session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Extract the `reason` field from a `resume_failed` IPC line.
/// Used by the bridge to thread the human-readable reason into the
/// `SESSION_STATE = errored { detail }` frame so the card surfaces it.
fn parse_resume_failed_reason(line: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(line).ok()?;
    value
        .get("reason")
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
        let result = resolve_tugcode_path(Some(override_path));
        assert_eq!(result, override_path);
    }

    #[test]
    fn test_resolve_without_override_finds_sibling_or_falls_back() {
        let result = resolve_tugcode_path(None);
        let s = result.to_str().unwrap();
        // In test builds, the tugcode binary sits next to the test binary in target/debug/,
        // so the sibling check succeeds. In environments without a sibling, it falls back
        // to the bun-run path (tugcode/src/main.ts).
        assert!(
            s.ends_with("/tugcode") || s.contains("tugcode/src/main.ts"),
            "Expected sibling binary or bun fallback, got: {s}"
        );
    }

    // ---- build_tugcode_command + TugcodeSpawner argv composition ----

    #[test]
    fn test_build_tugcode_command_binary_passes_all_args() {
        let (program, args) = build_tugcode_command(
            Path::new("/opt/tugtool/tugcode"),
            Path::new("/work/alpha"),
            "sess-alpha-uuid",
            SessionMode::New,
        );
        assert_eq!(program, "/opt/tugtool/tugcode");
        assert_eq!(
            args,
            vec![
                "--dir".to_string(),
                "/work/alpha".to_string(),
                "--session-id".to_string(),
                "sess-alpha-uuid".to_string(),
                "--session-mode".to_string(),
                "new".to_string(),
            ]
        );
    }

    #[test]
    fn test_build_tugcode_command_ts_uses_bun_run_and_passes_all_args() {
        let (program, args) = build_tugcode_command(
            Path::new("/u/src/tugtool/tugcode/src/main.ts"),
            Path::new("/work/beta"),
            "sess-beta-uuid",
            SessionMode::New,
        );
        assert_eq!(program, "bun");
        assert_eq!(
            args,
            vec![
                "run".to_string(),
                "/u/src/tugtool/tugcode/src/main.ts".to_string(),
                "--dir".to_string(),
                "/work/beta".to_string(),
                "--session-id".to_string(),
                "sess-beta-uuid".to_string(),
                "--session-mode".to_string(),
                "new".to_string(),
            ]
        );
    }

    #[test]
    fn test_tugcode_spawner_uses_per_call_project_dir_and_session_id() {
        // Belt-and-suspenders: the same TugcodeSpawner instance must
        // produce commands with per-call `project_dir` + `session_id`
        // arguments, not captured construction-time state.
        let spawner = TugcodeSpawner::new(PathBuf::from("/opt/tugtool/tugcode"));
        let (_p1, args1) = build_tugcode_command(
            &spawner.tugcode_path,
            Path::new("/work/a"),
            "sess-a",
            SessionMode::New,
        );
        let (_p2, args2) = build_tugcode_command(
            &spawner.tugcode_path,
            Path::new("/work/b"),
            "sess-b",
            SessionMode::New,
        );
        assert!(args1.iter().any(|a| a == "/work/a"));
        assert!(args1.iter().any(|a| a == "sess-a"));
        assert!(!args1.iter().any(|a| a == "/work/b"));
        assert!(!args1.iter().any(|a| a == "sess-b"));
        assert!(args2.iter().any(|a| a == "/work/b"));
        assert!(args2.iter().any(|a| a == "sess-b"));
    }

    #[test]
    fn test_build_tugcode_command_emits_session_mode_resume() {
        let (_, args) = build_tugcode_command(
            Path::new("/opt/tugtool/tugcode"),
            Path::new("/work/x"),
            "sess-x",
            SessionMode::Resume,
        );
        let i = args
            .iter()
            .position(|a| a == "--session-mode")
            .expect("--session-mode flag must be present");
        assert_eq!(args.get(i + 1).map(String::as_str), Some("resume"));
    }

    #[test]
    fn test_session_mode_wire_roundtrip() {
        assert_eq!(SessionMode::from_wire_str(Some("new")), SessionMode::New);
        assert_eq!(
            SessionMode::from_wire_str(Some("resume")),
            SessionMode::Resume
        );
        // Absent / unknown values default to New.
        assert_eq!(SessionMode::from_wire_str(None), SessionMode::New);
        assert_eq!(SessionMode::from_wire_str(Some("bogus")), SessionMode::New);
        assert_eq!(SessionMode::New.as_wire_str(), "new");
        assert_eq!(SessionMode::Resume.as_wire_str(), "resume");
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

    #[tokio::test]
    async fn test_session_child_drop_kills_subprocess() {
        // Verify `kill_on_drop(true)` on the tokio `Child` wrapped
        // inside `SessionChild` actually fires when
        // the `SessionChild` is dropped. This is the mechanism the
        // supervisor relies on to reap tugcode subprocesses when a session
        // closes or its bridge task exits. Using `/bin/sleep` (POSIX,
        // always present) avoids needing a built tugcode binary.
        use tokio::process::Command;

        let mut child = Command::new("/bin/sleep")
            .arg("300")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn /bin/sleep");
        let pid = child.id().expect("sleep should have a PID") as i32;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let session_child = SessionChild {
            stdin: Box::new(stdin),
            stdout: Box::new(stdout),
            _keepalive: Box::new(child),
        };

        // Confirm the process is alive before the drop.
        assert_eq!(
            unsafe { libc::kill(pid, 0) },
            0,
            "sleep subprocess should be alive before drop"
        );

        drop(session_child);

        // Subprocess teardown is asynchronous in the kernel: `kill_on_drop`
        // queues SIGKILL on drop, the kernel schedules the death, tokio's
        // driver reaps the zombie via SIGCHLD. We have no handle to block
        // on (the `Child` was consumed by the drop above), so a poll is
        // unavoidable here. Deterministic alternatives — `pidfd_open`,
        // `signal-hook`-backed SIGCHLD channel — are heavier than a single
        // kill_on_drop regression warrants.
        //
        // Constants chosen to make the test cheap on the happy path and
        // slow-to-false-fail on the pathological one:
        //   * `MAX_WAIT`: long enough that a real bug is the only way we
        //     time out, even on a contended CI host.
        //   * `POLL_INTERVAL`: short enough that the happy path returns
        //     in essentially one scheduler tick.
        const MAX_WAIT: Duration = Duration::from_secs(10);
        const POLL_INTERVAL: Duration = Duration::from_millis(5);
        let deadline = Instant::now() + MAX_WAIT;
        let mut reaped = false;
        while Instant::now() < deadline {
            // `kill(pid, 0)` returns ESRCH once the kernel has reaped
            // the process. Until then — including the zombie window —
            // it returns 0.
            if unsafe { libc::kill(pid, 0) } != 0 {
                reaped = true;
                break;
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }

        assert!(
            reaped,
            "SessionChild drop must terminate the underlying subprocess within {MAX_WAIT:?} \
             (kill_on_drop(true) is load-bearing for tugcode cleanup)"
        );
    }
}
