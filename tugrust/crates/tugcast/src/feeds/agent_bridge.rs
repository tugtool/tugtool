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
    LedgerEntry, SessionRecord, SessionsRecorder, SpawnState, build_session_state_frame,
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

/// Number of trailing stderr lines retained per spawn for diagnostics.
/// On crash-budget exhaustion the bridge folds these into the errored
/// `SESSION_STATE` detail so the card surfaces *why* the subprocess died
/// (claude API failure, auth error, missing config) instead of an opaque
/// `crash_budget_exhausted`.
const STDERR_TAIL_CAP: usize = 40;

/// Grace period after a relay crash before snapshotting the subprocess
/// stderr tail. The dying child may flush a final error line (panic,
/// claude API failure) onto stderr *after* its stdout closes — the signal
/// the relay uses to detect the crash. This lets the stderr-forwarding
/// task drain those last lines so they make it into the errored detail.
const STDERR_DRAIN_GRACE: Duration = Duration::from_millis(50);

/// Thin boxed wrapper around an active subprocess' stdin/stdout. The
/// `_keepalive` field owns whatever handle is needed to keep the child alive
/// and cleaned up on drop (e.g., `tokio::process::Child` with
/// `kill_on_drop(true)`).
pub struct SessionChild {
    pub stdin: Box<dyn AsyncWrite + Send + Unpin>,
    pub stdout: Box<dyn AsyncRead + Send + Unpin>,
    /// OS pid of the spawned tugcode child, captured at spawn for the
    /// activity sampler's subtree root ([P08], [P20]). `None` for mock
    /// spawners that don't back a real process.
    pub pid: Option<u32>,
    pub _keepalive: Box<dyn std::any::Any + Send>,
    /// Ring of the last [`STDERR_TAIL_CAP`] stderr lines this subprocess
    /// emitted, populated by the stderr-forwarding task. Read by
    /// `run_session_bridge` after a crash to attach the real failure
    /// reason to the errored frame. Mock spawners leave it empty.
    pub stderr_tail: Arc<std::sync::Mutex<VecDeque<String>>>,
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
    /// `session_mode` is the user's new-vs-resume choice from the Dev
    /// picker. Forwarded to tugcode as `--session-mode new|resume`.
    ///
    /// `resume_claude_session_id` is the persisted claude session id for
    /// resume spawns whose claude id has diverged from `session_id` (e.g.,
    /// after a fork). When `Some`, tugcode forwards it to claude as
    /// `--resume <id>` instead of falling back to `session_id`. `None`
    /// for fresh spawns and for resume spawns whose claude id was never
    /// captured (in which case tugcode still uses `session_id` for
    /// `--resume` — the legacy fallback that works for un-forked
    /// sessions because their tug and claude ids match).
    ///
    /// `permission_mode` is the deck-wide / per-card default permission mode
    /// tugdeck resolved at spawn time. Forwarded to tugcode as
    /// `--permission-mode <mode>` so the spawned claude process starts in the
    /// right mode. `None` when tugdeck sent no mode (older client, or a card
    /// with no configured default).
    fn spawn_child(
        &self,
        project_dir: &Path,
        session_id: &str,
        session_mode: SessionMode,
        resume_claude_session_id: Option<&str>,
        permission_mode: Option<&str>,
    ) -> SpawnFuture;
}

/// Production spawner: launches `tugcode --dir <project_dir>` (or the bun
/// fallback when the resolved path ends in `.ts`).
///
/// Stateless with respect to `project_dir` — the supervisor
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
/// The returned args vector always carries
/// `["--dir", <project_dir>, "--session-id", <uuid>, "--session-mode", <new|resume>]`,
/// and additionally `["--resume-session", <claude_session_id>]` when
/// `resume_claude_session_id` is `Some` (only emitted for resume spawns
/// whose claude session id has diverged from `session_id`).
pub(crate) fn build_tugcode_command(
    tugcode_path: &Path,
    project_dir: &Path,
    session_id: &str,
    session_mode: SessionMode,
    resume_claude_session_id: Option<&str>,
    permission_mode: Option<&str>,
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
    if let Some(id) = resume_claude_session_id {
        args.push("--resume-session".to_string());
        args.push(id.to_string());
    }
    // The deck-wide / per-card default permission mode tugdeck resolved at
    // spawn time, forwarded so the spawned claude process starts in the
    // right mode rather than tugcode's hardcoded fallback (`--permission-mode`
    // is fixed at spawn; a post-spawn `permission_mode` frame can only change
    // it at runtime, racing the first turn). `None` when tugdeck sent no
    // mode (older client, or a card with neither a per-card mode nor a
    // configured default) — tugcode then keeps its own default.
    if let Some(mode) = permission_mode {
        args.push("--permission-mode".to_string());
        args.push(mode.to_string());
    }
    (program, args)
}

impl ChildSpawner for TugcodeSpawner {
    fn spawn_child(
        &self,
        project_dir: &Path,
        session_id: &str,
        session_mode: SessionMode,
        resume_claude_session_id: Option<&str>,
        permission_mode: Option<&str>,
    ) -> SpawnFuture {
        let tugcode_path = self.tugcode_path.clone();
        let project_dir = project_dir.to_path_buf();
        let session_id = session_id.to_string();
        let resume_claude_session_id = resume_claude_session_id.map(|s| s.to_string());
        let permission_mode = permission_mode.map(|s| s.to_string());
        Box::pin(async move {
            let (cmd, args) = build_tugcode_command(
                &tugcode_path,
                &project_dir,
                &session_id,
                session_mode,
                resume_claude_session_id.as_deref(),
                permission_mode.as_deref(),
            );
            tracing::info!(
                target: "dev::session-lifecycle",
                event = "bridge.tugcode_spawn",
                tug_session_id = %session_id,
                session_mode = session_mode.as_wire_str(),
                resume_claude_session_id = resume_claude_session_id.as_deref().unwrap_or(""),
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
            let stderr_tail: Arc<std::sync::Mutex<VecDeque<String>>> =
                Arc::new(std::sync::Mutex::new(VecDeque::new()));
            if let Some(stderr) = child.stderr.take() {
                let tail = Arc::clone(&stderr_tail);
                tokio::spawn(async move {
                    let mut lines = BufReader::new(stderr).lines();
                    loop {
                        match lines.next_line().await {
                            Ok(Some(line)) => {
                                tracing::warn!(
                                    target: "tugcast::tugcode_stderr",
                                    "{line}",
                                );
                                if let Ok(mut buf) = tail.lock() {
                                    buf.push_back(line);
                                    while buf.len() > STDERR_TAIL_CAP {
                                        buf.pop_front();
                                    }
                                }
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
            let pid = child.id();
            Ok(SessionChild {
                stdin: Box::new(stdin),
                stdout: Box::new(stdout),
                pid,
                _keepalive: Box::new(child),
                stderr_tail,
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
    // Deck-wide / per-card default permission mode resolved by tugdeck at
    // spawn time, forwarded to tugcode as `--permission-mode`. `None` when
    // tugdeck sent no mode. Stable for the life of the session (read once
    // off the ledger entry), so crash-loop respawns re-apply the same mode.
    permission_mode: Option<String>,
    sessions_recorder: Arc<dyn SessionsRecorder>,
    // Optional handle to the sqlite session ledger. When present, the
    // relay loop loads per-turn telemetry on `replay_started` and
    // inlines it onto each replayed `turn_complete` frame before
    // forwarding to the wire. When `None` (test harnesses that don't
    // wire a ledger), replayed `turn_complete` frames pass through
    // unchanged and the client reducer's merge falls back to its
    // zero-telemetry derived block — correct behavior, no crash.
    session_ledger: Option<Arc<crate::session_ledger::SessionLedger>>,
    cancel: CancellationToken,
    retry_delay: Duration,
) {
    // `tug_session_id` is also the session id we pass to tugcode via
    // `--session-id` — the single identifier for this session.
    let session_id_str = tug_session_id.as_str().to_string();
    let project_dir_str = project_dir.display().to_string();
    // Trailing stderr (or spawn error) from the most recent failed spawn,
    // carried across crash-loop iterations so the top-of-loop budget-
    // exhaustion publish can fold the real failure reason into the errored
    // detail instead of an opaque `crash_budget_exhausted`.
    let mut last_failure_reason: Option<String> = None;
    loop {
        // Auth gate. A logged-out (or entirely missing) `claude` exits the
        // instant it's spawned, which the relay can't distinguish from a crash
        // — so without this it would crash-loop to a useless
        // `crash_budget_exhausted`. Probe first and surface an actionable auth
        // state instead. Re-probed every iteration (cheap local CLI call), so a
        // mid-session logout is caught on the next respawn, not just at open.
        let auth_detail = match crate::feeds::claude_auth::probe().await {
            crate::feeds::claude_auth::AuthState::LoggedIn(_) => None,
            crate::feeds::claude_auth::AuthState::ClaudeMissing => Some("claude_missing"),
            crate::feeds::claude_auth::AuthState::LoggedOut => Some("auth_required"),
        };
        if let Some(detail) = auth_detail {
            let mut entry = ledger_entry.lock().await;
            let already_closed = entry.spawn_state == SpawnState::Closed;
            if !already_closed {
                entry.spawn_state = SpawnState::Errored;
            }
            entry.input_tx = None;
            drop(entry);
            if !already_closed {
                info!(session = %tug_session_id, detail, "claude auth gate: not logged in");
                let _ = state_tx.send(build_session_state_frame(
                    &tug_session_id,
                    "errored",
                    Some(detail),
                ));
            }
            return;
        }

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
                // `card_id` is preserved across the errored transition;
                // liveness is encoded in `spawn_state`.
                let claude_id = entry.claude_session_id.clone();
                drop(entry);
                // Crash exhaustion is a `failed` lifecycle ending: the
                // session row stays in the ledger as a diagnostic crumb so
                // the picker can show what happened. Sessions that never
                // reached `session_init` have no row yet — nothing to mark.
                if let Some(id) = claude_id {
                    sessions_recorder.mark_failed(&id);
                }
                if !already_closed {
                    error!(session = %tug_session_id, "crash budget exhausted");
                    // Fold the last spawn's stderr (or spawn error) into the
                    // detail so the card shows *why* the subprocess died. The
                    // first line stays `crash_budget_exhausted` (the strip
                    // summary + the token existing consumers match on); any
                    // captured diagnostic follows on subsequent lines and the
                    // client routes it to the error detail panel.
                    let detail = match &last_failure_reason {
                        Some(reason) if !reason.is_empty() => {
                            format!("crash_budget_exhausted\n{reason}")
                        }
                        _ => "crash_budget_exhausted".to_string(),
                    };
                    let _ = state_tx.send(build_session_state_frame(
                        &tug_session_id,
                        "errored",
                        Some(detail.as_str()),
                    ));
                }
                return;
            }
        }

        // Read the persisted claude_session_id off the ledger entry
        // before each spawn iteration. On the first iteration after
        // rebind, this carries the value that `rebind_from_tugbank` read
        // from tugbank. On a crash-loop retry mid-life, it carries the
        // value the previous `relay_session_io` captured at session_init.
        // For fresh `do_spawn_session(mode=new)` flows the entry's id is
        // `None`, so the spawner falls back to the legacy `--resume
        // <session_id>` path that works because tug and claude ids are
        // equal for un-forked sessions.
        let resume_claude_session_id = {
            let entry = ledger_entry.lock().await;
            entry.claude_session_id.clone()
        };

        // Spawn subprocess — interruptible by cancel so
        // `close_session` can tear down a stalled spawner.
        tracing::info!(
            target: "dev::session-lifecycle",
            event = "spawn.child_invoke",
            tug_session_id = %tug_session_id,
            session_mode = session_mode.as_wire_str(),
            resume_claude_session_id = resume_claude_session_id.as_deref().unwrap_or(""),
            project_dir = %project_dir_str,
        );
        let spawn_result = tokio::select! {
            result = spawner.spawn_child(
                project_dir.as_path(),
                session_id_str.as_str(),
                session_mode,
                resume_claude_session_id.as_deref(),
                permission_mode.as_deref(),
            ) => result,
            _ = cancel.cancelled() => return,
        };
        let child = match spawn_result {
            Ok(c) => c,
            Err(e) => {
                error!(session = %tug_session_id, error = %e, "failed to spawn tugcode");
                last_failure_reason = Some(format!("spawn failed: {e}"));
                ledger_entry.lock().await.crash_budget.record_crash();
                tokio::select! {
                    _ = sleep(retry_delay) => continue,
                    _ = cancel.cancelled() => return,
                }
            }
        };

        // Retain the child's (pid, start_time) on the ledger entry for the
        // activity sampler ([P08], [P20]). Captured now, at spawn, so a pid
        // recycled after this session exits is rejected by the start-time
        // guard rather than misattributed. Cleared when the relay ends below.
        if let Some(pid) = child.pid {
            let start_time = crate::feeds::activity::resource::process_start_time(pid);
            let mut entry = ledger_entry.lock().await;
            entry.child_pid = Some(pid);
            entry.child_start_time = start_time;
        }

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
            session_ledger.as_deref(),
            &cancel,
        )
        .await;

        // Hold a handle to this spawn's captured stderr before the child
        // drops, so the crash arm below can snapshot the tail as the
        // failure reason.
        let stderr_tail = Arc::clone(&child.stderr_tail);

        // `child._keepalive` (holding tokio::process::Child) drops here at end
        // of iteration if we fall through. `kill_on_drop(true)` cleans up.
        drop(child._keepalive);

        // The child is gone — clear its (pid, start_time) so the sampler stops
        // attributing a subtree to a dead process. A retry re-captures on the
        // next spawn above.
        {
            let mut entry = ledger_entry.lock().await;
            entry.child_pid = None;
            entry.child_start_time = None;
        }

        match outcome {
            RelayOutcome::Cancelled => {
                tracing::info!(
                    target: "dev::session-lifecycle",
                    event = "bridge.relay_outcome",
                    tug_session_id = %tug_session_id,
                    outcome = "cancelled",
                );
                return;
            }
            RelayOutcome::Crashed => {
                tracing::info!(
                    target: "dev::session-lifecycle",
                    event = "bridge.relay_outcome",
                    tug_session_id = %tug_session_id,
                    outcome = "crashed",
                );
                // Let the stderr reader drain any final line the dying child
                // flushed after stdout closed, then snapshot the tail as the
                // failure reason for a possible budget exhaustion next round.
                sleep(STDERR_DRAIN_GRACE).await;
                if let Ok(buf) = stderr_tail.lock() {
                    if !buf.is_empty() {
                        last_failure_reason =
                            Some(buf.iter().cloned().collect::<Vec<_>>().join("\n"));
                    }
                }
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
                    target: "dev::session-lifecycle",
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
                // `relay_session_io` already called `mark_failed` on the
                // stale session id (so its ledger row is retained as a
                // `failed` diagnostic crumb).
                let mut entry = ledger_entry.lock().await;
                let already_closed = entry.spawn_state == SpawnState::Closed;
                if !already_closed {
                    entry.spawn_state = SpawnState::Errored;
                }
                entry.input_tx = None;
                // `card_id` is preserved across the errored transition;
                // liveness is encoded in `spawn_state`.
                drop(entry);
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
    // Optional `SessionLedger` handle for per-turn telemetry reads
    // during the replay window. `None` in tests that don't wire a
    // ledger — replayed `turn_complete` frames pass through unchanged.
    session_ledger: Option<&crate::session_ledger::SessionLedger>,
    cancel: &CancellationToken,
) -> RelayOutcome {
    // Captured when tugcode emits `resume_failed`. tugcode then
    // exits cleanly (no silent fresh-spawn fallback); we promote the
    // subsequent EOF from `Crashed` (would retry) to `ResumeFailed`
    // (terminal).
    let mut resume_failed: Option<(String, String)> = None;

    // Replay-window flag. Set when tugcode emits `replay_started`,
    // cleared on `replay_complete`. Gates `record_turn` so replayed
    // `turn_complete` frames (one per persisted turn from JSONL) do
    // NOT re-bump the ledger row's `turn_count` — only LIVE turns
    // count. Without this gate every reconnect / restore inflates
    // the picker's "N turns" subtitle by the full transcript length.
    let mut in_replay = false;

    // Per-replay-window telemetry index. Built once on `replay_started`
    // (when we have the claude session id from a prior `session_init`)
    // and consulted on every replayed `turn_complete` for the inline
    // attach. `None` between replay windows; `Some(empty)` when no
    // telemetry rows exist for the session (still a valid lookup, the
    // get just misses and the frame passes through unchanged).
    //
    // Built up-front rather than per-row to amortize the sqlite query
    // — one `list_turn_telemetry` call per replay window, then O(1)
    // HashMap lookups per turn.
    let mut replay_telemetry: Option<
        std::collections::HashMap<String, crate::session_ledger::TurnTelemetryRow>,
    > = None;

    // Replay-window forward instrumentation: wall-clock anchor + count
    // of frames forwarded to the merger inside the window. Emitted as
    // a `perf.replay_forward` session-lifecycle trace on the bracket
    // close so the per-resume waterfall has the tugcast leg. The mpsc
    // send to the merger is awaited (backpressure, never dropped);
    // the lossy hop is the per-client broadcast downstream, counted
    // separately at the router's lag-recovery branch.
    let mut replay_forward_started: Option<std::time::Instant> = None;
    let mut replay_frames_forwarded: u64 = 0;

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
                                target: "dev::session-lifecycle",
                                event = "session_init.parse",
                                tug_session_id = %tug_session_id,
                                claude_session_id = claude_id.as_deref().unwrap_or(""),
                            );
                            // Snapshot the per-session bookkeeping fields the
                            // ledger needs (workspace key + bound card id) under
                            // the same lock that promotes Spawning→Live. These
                            // are populated by `do_spawn_session` before the
                            // bridge starts, so they're guaranteed present.
                            //
                            // Persistence of the (card_id → session) binding
                            // flows through the `sessions_recorder.record(...)`
                            // call below, which writes into the sqlite-backed
                            // `SessionLedger` keyed by claude's session id. The
                            // ledger row's `card_id` column is the source of
                            // truth for the client-side restore (consumed via
                            // the `list_card_bindings` CONTROL verb).
                            let (workspace_key, card_id) = {
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
                                (
                                    entry.workspace_key.as_ref().to_owned(),
                                    entry.card_id.clone(),
                                )
                            };

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
                            // `card_id` is `None` only if `do_spawn_session`
                            // didn't populate it (which only happens for ledger
                            // entries rebound from tugbank at startup). The
                            // ledger column tolerates that — the row tracks
                            // "live, no current card" and a later real bind
                            // overwrites it.
                            let card_id_for_ledger = card_id.as_deref().unwrap_or("");
                            sessions_recorder.record(SessionRecord {
                                session_id: record_id,
                                workspace_key: &workspace_key,
                                project_dir,
                                card_id: card_id_for_ledger,
                            });
                            // After each successful spawn record, cap the
                            // workspace to the configured non-live row max.
                            // Eviction targets the oldest closed/failed row,
                            // never the just-spawned (live) row.
                            sessions_recorder.evict_for_workspace(
                                &workspace_key,
                                crate::session_ledger::DEV_LEDGER_MAX_PER_WORKSPACE,
                            );
                        }

                        // Track replay window so the LIVE-turn check
                        // below skips replayed `turn_complete` frames.
                        // Tugcode brackets every replay run with
                        // `replay_started` ... `replay_complete`; turn
                        // events between those markers are persisted
                        // history, not new turns, and must not re-bump
                        // the ledger's `turn_count`.
                        if line.contains("\"type\":\"replay_started\"") {
                            in_replay = true;
                            replay_forward_started = Some(std::time::Instant::now());
                            replay_frames_forwarded = 0;
                            // Lazily populate the per-replay-window
                            // telemetry index. The claude session id is
                            // set by a prior `session_init` (cold-boot
                            // path resumes only run after handshake);
                            // if it's absent we skip the load and
                            // replayed `turn_complete` frames pass
                            // through unchanged — the client reducer's
                            // zero-derived block applies.
                            if let Some(ledger) = session_ledger {
                                let claude_id = {
                                    let entry = ledger_entry.lock().await;
                                    entry.claude_session_id.clone()
                                };
                                if let Some(id) = claude_id {
                                    match ledger.list_turn_telemetry(&id) {
                                        Ok(rows) => {
                                            let map = rows
                                                .into_iter()
                                                .map(|r| (r.msg_id.clone(), r))
                                                .collect();
                                            replay_telemetry = Some(map);
                                        }
                                        Err(e) => {
                                            warn!(
                                                session = %tug_session_id,
                                                error = %e,
                                                "list_turn_telemetry failed; replay will carry zero-derived telemetry"
                                            );
                                        }
                                    }
                                    // Bind-time inline of the persisted
                                    // `/context`-style breakdown. Synthesize
                                    // a `context_breakdown` wire frame from
                                    // the stored payload and emit it ahead
                                    // of the replayed transcript so the
                                    // popover renders pre-populated instead
                                    // of falling through to the 20.4.7.C
                                    // `cost_update`-derived view.
                                    //
                                    // `from_supervisor_attach: true` tells
                                    // the tugdeck reducer to project this
                                    // frame onto its snapshot but NOT
                                    // dispatch a `record_context_breakdown`
                                    // effect — the row already exists, the
                                    // round-trip would be a no-op UPSERT.
                                    //
                                    // Parse-and-rebuild rather than
                                    // byte-splice: the parse cost is
                                    // microseconds for a payload of this
                                    // size, and the resulting JSON is
                                    // robust to any whitespace / key-order
                                    // shifts in how the payload was
                                    // originally serialized.
                                    match ledger.get_context_breakdown(&id) {
                                        Ok(Some(row)) => {
                                            match serde_json::from_slice::<serde_json::Value>(
                                                &row.payload,
                                            ) {
                                                Ok(payload_value) => {
                                                    let mut wire = serde_json::json!({
                                                        "type": "context_breakdown",
                                                        "ipc_version": 2,
                                                        "from_supervisor_attach": true,
                                                    });
                                                    if let (
                                                        Some(payload_obj),
                                                        Some(wire_obj),
                                                    ) = (
                                                        payload_value.as_object(),
                                                        wire.as_object_mut(),
                                                    ) {
                                                        for (k, v) in payload_obj {
                                                            wire_obj
                                                                .insert(k.clone(), v.clone());
                                                        }
                                                        match serde_json::to_vec(&wire) {
                                                            Ok(bytes) => {
                                                                let spliced =
                                                                    splice_tug_session_id(
                                                                        &bytes,
                                                                        tug_session_id.as_str(),
                                                                    );
                                                                let frame = Frame::new(
                                                                    FeedId::CODE_OUTPUT,
                                                                    spliced,
                                                                );
                                                                if merger_tx
                                                                    .send(frame)
                                                                    .await
                                                                    .is_err()
                                                                {
                                                                    warn!(
                                                                        session = %tug_session_id,
                                                                        "merger receiver closed during context_breakdown bind-attach"
                                                                    );
                                                                    return RelayOutcome::Cancelled;
                                                                }
                                                            }
                                                            Err(e) => {
                                                                warn!(
                                                                    session = %tug_session_id,
                                                                    error = %e,
                                                                    "context_breakdown bind-attach serialize failed; falling through"
                                                                );
                                                            }
                                                        }
                                                    } else {
                                                        warn!(
                                                            session = %tug_session_id,
                                                            "persisted context_breakdown payload not a JSON object; skipping bind-attach"
                                                        );
                                                    }
                                                }
                                                Err(e) => {
                                                    warn!(
                                                        session = %tug_session_id,
                                                        error = %e,
                                                        "persisted context_breakdown payload not valid JSON; falling through"
                                                    );
                                                }
                                            }
                                        }
                                        Ok(None) => {
                                            // No persisted breakdown for this
                                            // session yet — popover hits the
                                            // 20.4.7.C fallback view until
                                            // the first live `context_breakdown`
                                            // frame lands.
                                        }
                                        Err(e) => {
                                            warn!(
                                                session = %tug_session_id,
                                                error = %e,
                                                "get_context_breakdown failed during bind-attach; falling through"
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        // Set when a replay_complete frame is stamped with the
                        // engine count; consumed by the emit step below.
                        let mut replay_complete_emit: Option<Vec<u8>> = None;
                        if line.contains("\"type\":\"replay_complete\"") {
                            in_replay = false;
                            replay_telemetry = None;
                            if let Some(t0) = replay_forward_started.take() {
                                tracing::info!(
                                    target: "dev::session-lifecycle",
                                    event = "perf.replay_forward",
                                    tug_session_id = %tug_session_id,
                                    frames = replay_frames_forwarded,
                                    ms = t0.elapsed().as_millis() as u64,
                                );
                            }
                            // Reconcile + validate-and-stamp to the single count
                            // authority `engine(file)` ([P08], [Q01]). The ledger
                            // count is `engine(file)` — read it (the
                            // fingerprint-validated cached value, or the engine on
                            // the resolved path) and SET the row. Then compare
                            // tugcode's wire `totalTurns` to the engine: on a
                            // mismatch, log a contract breach and let the engine
                            // win; stamp the engine value onto the outgoing frame
                            // so the window indices can never silently diverge
                            // from the count. An error frame carries no
                            // `totalTurns`, so the stamp/compare is skipped and the
                            // engine lookup (file missing) returns `None` —
                            // nothing is zeroed.
                            let claude_id = {
                                let entry = ledger_entry.lock().await;
                                entry.claude_session_id.clone()
                            };
                            if let Some(id) = claude_id {
                                if let Some(engine_total) =
                                    sessions_recorder.engine_turn_count(&id, project_dir)
                                {
                                    if let Some(wire_total) =
                                        parse_replay_complete_total_turns(&line)
                                    {
                                        if wire_total != engine_total {
                                            warn!(
                                                target: "dev::turn-metric",
                                                event = "contract_breach.replay_total_turns",
                                                tug_session_id = %tug_session_id,
                                                session_id = id.as_str(),
                                                wire_total,
                                                engine_total,
                                                "tugcode replay totalTurns != engine(file); engine wins",
                                            );
                                        }
                                        replay_complete_emit = Some(
                                            stamp_replay_complete_total_turns(&line, engine_total),
                                        );
                                    }
                                    sessions_recorder.set_turn_count(&id, engine_total);
                                }
                            }
                        }

                        // `turn_complete` events mark the end of an
                        // assistant turn. Each LIVE one touches the ledger
                        // row's `last_used_at` only — the turn COUNT is
                        // `engine(file)` ([P08]), refreshed by the
                        // scan-on-`list_sessions` path, never incremented
                        // here. Tugcode emits this once per turn — substring
                        // match is sufficient given the surrounding
                        // stream-json shape; a more careful parser would be
                        // `serde_json::from_str` over the whole line, but
                        // that pays the deserialize cost on every output
                        // line for negligible benefit.
                        //
                        // Replay-bracketed `turn_complete` frames are
                        // skipped from the LIVE turn-count bump (they
                        // re-emit persisted history on every reconnect /
                        // restore, and counting them would inflate the
                        // picker subtitle by the full transcript length)
                        // BUT they are the surface where we INJECT the
                        // persisted per-turn telemetry — the client
                        // reducer's merge function adopts the inline
                        // payload on the replay path. See plan
                        // `#step-20-3-4`.
                        let line_to_emit: Vec<u8> = if let Some(stamped) = replay_complete_emit {
                            // The replay_complete frame, its `totalTurns`
                            // re-stamped from `engine(file)` (the authority).
                            stamped
                        } else if line.contains("\"type\":\"turn_complete\"") {
                            if in_replay {
                                if let Some(ref map) = replay_telemetry {
                                    inject_replay_telemetry(line.as_bytes(), map)
                                } else {
                                    line.as_bytes().to_vec()
                                }
                            } else {
                                let claude_id = {
                                    let entry = ledger_entry.lock().await;
                                    entry.claude_session_id.clone()
                                };
                                if let Some(id) = claude_id {
                                    sessions_recorder.record_turn(&id);
                                }
                                line.as_bytes().to_vec()
                            }
                        } else if line.contains("\"type\":\"system_metadata\"") {
                            // Bridge intercept for LIVE-ONLY session
                            // metadata. The live path delivers a rich
                            // payload (model with `[1m]` suffix, cwd,
                            // permissionMode, tools, …); the replay
                            // path (`tugcode/src/replay.ts:984`)
                            // synthesizes a bare-model payload with
                            // every other field empty. Without this
                            // merge the replay would clobber the live
                            // values on every resume.
                            //
                            // Key the ledger by `claude_session_id`
                            // (captured by the session_init interceptor
                            // above), NOT by the line's own
                            // `session_id` field — the live path's
                            // payload can have an empty session_id
                            // when the SDK omits it. See plan
                            // `#step-20-3-6` "Intercept-key sourcing".
                            //
                            // If the merge cannot proceed (ledger
                            // absent, claude_session_id absent, parse
                            // error, ledger write error), the line
                            // passes through unchanged. The wire
                            // delivery must not depend on persistence
                            // success.
                            let claude_id = {
                                let entry = ledger_entry.lock().await;
                                entry.claude_session_id.clone()
                            };
                            match (session_ledger, claude_id) {
                                (Some(ledger), Some(id)) => merge_and_persist_system_metadata(
                                    line.as_bytes(),
                                    ledger,
                                    &id,
                                    tug_session_id,
                                ),
                                _ => line.as_bytes().to_vec(),
                            }
                        } else {
                            line.as_bytes().to_vec()
                        };

                        // `resume_failed` peek: tugcode emits this when
                        // a `--resume` attempt aborts before `session_init`.
                        // The stale id is no longer usable; the ledger row
                        // for it transitions to `failed` as a diagnostic
                        // crumb the picker can show. The frame still gets
                        // forwarded to the card so `lastError` surfaces a
                        // notice.
                        if line.contains("\"type\":\"resume_failed\"") {
                            let reason = parse_resume_failed_reason(line.as_bytes())
                                .unwrap_or_else(|| "resume failed".to_string());
                            if let Some(stale) = parse_resume_failed_id(line.as_bytes()) {
                                tracing::info!(
                                    target: "dev::session-lifecycle",
                                    event = "bridge.resume_failed_recv",
                                    tug_session_id = %tug_session_id,
                                    stale_session_id = stale.as_str(),
                                    reason = reason.as_str(),
                                );
                                sessions_recorder.mark_failed(&stale);
                                resume_failed = Some((stale, reason));
                            }
                        }

                        let spliced = splice_tug_session_id(&line_to_emit, tug_session_id.as_str());
                        let frame = Frame::new(FeedId::CODE_OUTPUT, spliced);
                        if in_replay {
                            replay_frames_forwarded += 1;
                        }
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
                    // Capture the most-recent user-message text before
                    // forwarding it to claude. Claude does not echo user
                    // inputs back through stream-json (the assistant turn
                    // arrives alone), so this branch is the only place
                    // the picker's prompt snippet can be recorded. The
                    // ledger's `record_user_prompt` overwrites on every
                    // call — the picker shows the latest prompt so the
                    // user recognizes the most-recent thread.
                    if let Some(text) = parse_user_message_text(json.as_bytes()) {
                        let claude_id = {
                            let entry = ledger_entry.lock().await;
                            entry.claude_session_id.clone()
                        };
                        if let Some(id) = claude_id {
                            let truncated = crate::session_ledger::truncate_user_prompt(&text);
                            sessions_recorder.record_user_prompt(&id, &truncated);
                        }
                    }

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

/// Read tugcode's wire `totalTurns` off a `replay_complete` line — for the
/// **validate-and-stamp** comparison only ([Q01]), NOT as a count source.
/// The count authority is `engine(file)` ([P08]); this value is compared to
/// it (a mismatch is a logged contract breach, engine wins). Returns `Some`
/// for a SUCCESS frame carrying window metadata, `None` for an error/legacy
/// frame with no `totalTurns`. Reads `totalTurns`, never the sibling `count`
/// (the windowed `turnsCommitted`, which undercounts a windowed restore).
fn parse_replay_complete_total_turns(line: &str) -> Option<i64> {
    serde_json::from_str::<serde_json::Value>(line.trim())
        .ok()
        .as_ref()
        .and_then(|v| v.get("totalTurns"))
        .and_then(|t| t.as_i64())
}

/// Re-stamp a `replay_complete` line's `totalTurns` with the engine count
/// (the single authority, [P08]/[Q01]). Parses the frame, overwrites the
/// `totalTurns` field, and re-serializes. In the healthy case the wire value
/// already equals the engine, so this is a faithful round-trip; on a
/// mismatch (a logged contract breach) it makes the engine value win on the
/// wire so the window indices stay coherent with the count. Falls back to the
/// original bytes if the line does not parse as a JSON object.
fn stamp_replay_complete_total_turns(line: &str, engine_total: i64) -> Vec<u8> {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
        return line.as_bytes().to_vec();
    };
    let Some(obj) = value.as_object_mut() else {
        return line.as_bytes().to_vec();
    };
    obj.insert(
        "totalTurns".to_string(),
        serde_json::Value::from(engine_total),
    );
    match serde_json::to_vec(&value) {
        Ok(bytes) => bytes,
        Err(_) => line.as_bytes().to_vec(),
    }
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

/// Inline the per-turn telemetry payload onto a replayed
/// `turn_complete` stream-json line. Looks up the line's `msg_id`
/// against the per-replay-window `HashMap<msg_id, TurnTelemetryRow>`
/// built at `replay_started`; on hit, **overlays only the multi-clock
/// timing fields** from the row onto the line's existing `telemetry`
/// object, re-serializes. On miss (no persisted row for this turn —
/// pre-persistence-feature historical turns, see plan `#step-20-3-4`
/// "no retroactive backfill" caveat) or on a parse error, returns the
/// line bytes unchanged.
///
/// **The JSONL is authoritative for cost and model.** tugcode's replay
/// translator reconstructs each turn's `cost` (and `sessionInitTokens`)
/// from the file's own `message.usage` and attaches it to the
/// `turn_complete.telemetry` before this point. The `turn_telemetry`
/// side-table is the authoritative source only for the timing the JSONL
/// cannot carry (wall/active/ttft). So this overlay writes **only** the
/// timing keys (`wallClockMs … maxStreamGapMs`) and never touches `cost`
/// or `sessionInitTokens` — the JSONL cost survives even when a (possibly
/// stale) side-table row exists. See plan `[P03]` / Risk R02.
///
/// If the line carries no `telemetry` object yet (a legacy turn_complete
/// from a tugcode that predates the cost-on-replay emit), a fresh
/// timing-only object is attached — no cost is invented.
///
/// Field names are camelCase to mirror tugdeck's `TurnTelemetry` (what
/// the reducer's merge reads); the schema rows are snake_case and the
/// conversion happens here at the wire boundary.
fn inject_replay_telemetry(
    line: &[u8],
    telemetry_by_msg_id: &std::collections::HashMap<
        String,
        crate::session_ledger::TurnTelemetryRow,
    >,
) -> Vec<u8> {
    let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(line) else {
        return line.to_vec();
    };
    let Some(msg_id) = value.get("msg_id").and_then(|v| v.as_str()) else {
        return line.to_vec();
    };
    let Some(row) = telemetry_by_msg_id.get(msg_id) else {
        return line.to_vec();
    };

    // The timing keys this overlay owns — and ONLY these. `cost` /
    // `sessionInitTokens` / `turnEndReason` on the existing object are
    // left untouched (JSONL-authoritative — [P03]).
    let timing = [
        ("wallClockMs", serde_json::json!(row.wall_clock_ms)),
        (
            "awaitingApprovalMs",
            serde_json::json!(row.awaiting_approval_ms),
        ),
        (
            "transportDowntimeMs",
            serde_json::json!(row.transport_downtime_ms),
        ),
        ("activeMs", serde_json::json!(row.active_ms)),
        ("ttftMs", serde_json::json!(row.ttft_ms)),
        ("ttftcMs", serde_json::json!(row.ttftc_ms)),
        ("reconnectCount", serde_json::json!(row.reconnect_count)),
        ("maxStreamGapMs", serde_json::json!(row.max_stream_gap_ms)),
    ];

    let serde_json::Value::Object(ref mut obj) = value else {
        return line.to_vec();
    };
    // Overlay onto the existing telemetry object (tugcode attached it
    // with the JSONL-authoritative cost); create a timing-only object
    // if the line is a legacy telemetry-free turn_complete.
    let telemetry = obj
        .entry("telemetry")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !telemetry.is_object() {
        *telemetry = serde_json::Value::Object(serde_json::Map::new());
    }
    if let serde_json::Value::Object(tel) = telemetry {
        for (key, val) in timing {
            tel.insert(key.to_string(), val);
        }
    }
    serde_json::to_vec(&value).unwrap_or_else(|_| line.to_vec())
}

/// Merge a `system_metadata` line against the persisted
/// `session_metadata` row, write the merged payload back, and return
/// the merged line for forwarding. Pure pass-through fallback on any
/// failure mode so the wire delivery never depends on persistence
/// success.
///
/// Wall-clock millisecond `captured_at` uses
/// `SystemTime::now()` — purely diagnostic / staleness audits; the
/// merge rule itself does not consult timestamps.
fn merge_and_persist_system_metadata(
    line: &[u8],
    ledger: &crate::session_ledger::SessionLedger,
    claude_session_id: &str,
    tug_session_id: &TugSessionId,
) -> Vec<u8> {
    let Ok(incoming) = serde_json::from_slice::<serde_json::Value>(line) else {
        return line.to_vec();
    };

    let current_payload_bytes = match ledger.get_session_metadata(claude_session_id) {
        Ok(Some(row)) => Some(row.payload),
        Ok(None) => None,
        Err(e) => {
            warn!(
                session = %tug_session_id,
                error = %e,
                "get_session_metadata failed; forwarding system_metadata unmerged",
            );
            return line.to_vec();
        }
    };
    let current_value: Option<serde_json::Value> = current_payload_bytes
        .as_deref()
        .and_then(|bytes| serde_json::from_slice(bytes).ok());

    let merged_map =
        crate::session_metadata_merge::merge_session_metadata(current_value.as_ref(), &incoming);
    if merged_map.is_empty() {
        // The merge refused (malformed incoming non-object). Pass
        // through and let downstream consumers handle the malformed
        // payload — we don't have a better answer.
        return line.to_vec();
    }
    let merged_value = serde_json::Value::Object(merged_map);
    let Ok(merged_bytes) = serde_json::to_vec(&merged_value) else {
        return line.to_vec();
    };

    let captured_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    if let Err(e) = ledger.record_session_metadata(claude_session_id, &merged_bytes, captured_at) {
        warn!(
            session = %tug_session_id,
            error = %e,
            "record_session_metadata failed; forwarding merged payload without persistence",
        );
    }

    merged_bytes
}

/// Extract the user's text from a CODE_INPUT frame's JSON payload, when
/// it is a `user_message`. Returns `None` for any other inbound message
/// shape (interrupt, tool_approval, etc.) so the ledger only sees actual
/// user prompts. The picker uses this snippet to label resume rows.
///
/// Post-Step-5c, `user_message` carries an Anthropic-API `content` array
/// of blocks; the text is the concatenation of every `text` block's
/// `text` field (image blocks contribute nothing). A legacy top-level
/// `text` field is honored as a fallback so pre-5c payloads still
/// produce a snippet during transitional builds.
fn parse_user_message_text(json: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(json).ok()?;
    if value.get("type").and_then(|v| v.as_str()) != Some("user_message") {
        return None;
    }
    if let Some(blocks) = value.get("content").and_then(|v| v.as_array()) {
        let (text, _atts) = crate::feeds::payload_inspector::derive_legacy_journal_view(blocks);
        if !text.is_empty() {
            return Some(text);
        }
    }
    value
        .get("text")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
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
            None,
            None,
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
            None,
            None,
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
            None,
            None,
        );
        let (_p2, args2) = build_tugcode_command(
            &spawner.tugcode_path,
            Path::new("/work/b"),
            "sess-b",
            SessionMode::New,
            None,
            None,
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
            None,
            None,
        );
        let i = args
            .iter()
            .position(|a| a == "--session-mode")
            .expect("--session-mode flag must be present");
        assert_eq!(args.get(i + 1).map(String::as_str), Some("resume"));
    }

    /// When `resume_claude_session_id` is `Some`, the helper
    /// appends `--resume-session <id>` after `--session-mode`. When
    /// `None`, the flag is omitted entirely (legacy fallback path —
    /// tugcode then uses `--session-id` for its `--resume <id>` claude
    /// invocation, which works for un-forked sessions whose tug and
    /// claude ids are equal).
    #[test]
    fn test_build_tugcode_command_emits_resume_session_when_id_is_some() {
        let (_, args) = build_tugcode_command(
            Path::new("/opt/tugtool/tugcode"),
            Path::new("/work/y"),
            "sess-y-tug-uuid",
            SessionMode::Resume,
            Some("claude-internal-id-7"),
            None,
        );
        let i = args
            .iter()
            .position(|a| a == "--resume-session")
            .expect("--resume-session must be present when id is Some");
        assert_eq!(
            args.get(i + 1).map(String::as_str),
            Some("claude-internal-id-7")
        );
        // `--session-id` still carries the tug id; `--resume-session`
        // carries the claude id. They're distinct fields by design.
        let j = args
            .iter()
            .position(|a| a == "--session-id")
            .expect("--session-id still emitted alongside --resume-session");
        assert_eq!(args.get(j + 1).map(String::as_str), Some("sess-y-tug-uuid"));
    }

    #[test]
    fn test_build_tugcode_command_omits_resume_session_when_id_is_none() {
        let (_, args) = build_tugcode_command(
            Path::new("/opt/tugtool/tugcode"),
            Path::new("/work/z"),
            "sess-z",
            SessionMode::Resume,
            None,
            None,
        );
        assert!(
            !args.iter().any(|a| a == "--resume-session"),
            "--resume-session must be absent when id is None"
        );
    }

    /// When `permission_mode` is `Some`, the helper appends
    /// `--permission-mode <mode>` so the spawned claude starts in tugdeck's
    /// resolved default. When `None`, the flag is omitted and tugcode keeps
    /// its own default.
    #[test]
    fn test_build_tugcode_command_emits_permission_mode_when_some() {
        let (_, args) = build_tugcode_command(
            Path::new("/opt/tugtool/tugcode"),
            Path::new("/work/p"),
            "sess-p",
            SessionMode::New,
            None,
            Some("plan"),
        );
        let i = args
            .iter()
            .position(|a| a == "--permission-mode")
            .expect("--permission-mode must be present when mode is Some");
        assert_eq!(args.get(i + 1).map(String::as_str), Some("plan"));
    }

    #[test]
    fn test_build_tugcode_command_omits_permission_mode_when_none() {
        let (_, args) = build_tugcode_command(
            Path::new("/opt/tugtool/tugcode"),
            Path::new("/work/q"),
            "sess-q",
            SessionMode::New,
            None,
            None,
        );
        assert!(
            !args.iter().any(|a| a == "--permission-mode"),
            "--permission-mode must be absent when mode is None"
        );
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

    // ── reconcile decision (parse_replay_complete_total_turns) ───────────────

    #[test]
    fn reconcile_reads_total_turns_not_count_on_success() {
        // A SUCCESS replay_complete carries window metadata. The windowed
        // `count` (5) undercounts a windowed restore; reconcile must read
        // `totalTurns` (22) — the authority.
        let line = r#"{"type":"replay_complete","count":5,"firstLoadedTurnIndex":17,"totalTurns":22,"hasOlder":true,"ipc_version":2}"#;
        assert_eq!(parse_replay_complete_total_turns(line), Some(22));
    }

    #[test]
    fn reconcile_skips_error_frame_with_no_metadata() {
        // An error frame (missing/unreadable JSONL) carries count:0 and NO
        // totalTurns — reconcile must skip it, or it would zero a real count.
        let err = r#"{"type":"replay_complete","count":0,"error":{"kind":"jsonl_missing","message":"gone"},"ipc_version":2}"#;
        assert_eq!(parse_replay_complete_total_turns(err), None);
        // A legacy full replay (no window) also has no totalTurns: skip too.
        let legacy = r#"{"type":"replay_complete","count":3,"ipc_version":2}"#;
        assert_eq!(parse_replay_complete_total_turns(legacy), None);
        // A trailing newline (stream framing) does not defeat parsing.
        let with_nl = "{\"type\":\"replay_complete\",\"count\":2,\"totalTurns\":2}\n";
        assert_eq!(parse_replay_complete_total_turns(with_nl), Some(2));
    }

    #[test]
    fn stamp_overrides_wire_total_turns_with_engine_value() {
        // Validate-and-stamp ([Q01]): when tugcode's wire totalTurns
        // disagrees with engine(file), the engine value is stamped onto the
        // outgoing frame so the window indices stay coherent with the count.
        let line = r#"{"type":"replay_complete","count":5,"firstLoadedTurnIndex":17,"totalTurns":59,"hasOlder":true,"ipc_version":2}"#;
        let stamped = stamp_replay_complete_total_turns(line, 81);
        let v: serde_json::Value = serde_json::from_slice(&stamped).unwrap();
        assert_eq!(v["totalTurns"], 81, "engine value wins on the wire");
        // Other fields are preserved through the round-trip.
        assert_eq!(v["firstLoadedTurnIndex"], 17);
        assert_eq!(v["count"], 5);
        assert_eq!(v["hasOlder"], true);
        // Re-reading the stamped frame yields the engine value.
        assert_eq!(
            parse_replay_complete_total_turns(std::str::from_utf8(&stamped).unwrap()),
            Some(81)
        );
    }

    #[test]
    fn stamp_preserves_session_created_field() {
        // tugcast only re-stamps `totalTurns`; every other field tugcode put
        // on the frame must ride through untouched. `sessionCreatedAtMs`
        // (the dev transcript's "Session created" anchor) is a passthrough —
        // lock it so a future stamp refactor can't silently drop it.
        let line = r#"{"type":"replay_complete","count":5,"firstLoadedTurnIndex":17,"totalTurns":59,"hasOlder":true,"sessionCreatedAtMs":1750166400000,"ipc_version":2}"#;
        let stamped = stamp_replay_complete_total_turns(line, 81);
        let v: serde_json::Value = serde_json::from_slice(&stamped).unwrap();
        assert_eq!(v["totalTurns"], 81, "engine value still wins");
        assert_eq!(
            v["sessionCreatedAtMs"], 1750166400000_i64,
            "session-created anchor survives the re-stamp"
        );
    }

    #[test]
    fn stamp_passes_through_unparseable_line() {
        let garbage = "not json at all";
        assert_eq!(
            stamp_replay_complete_total_turns(garbage, 81),
            garbage.as_bytes().to_vec()
        );
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
            pid: Some(pid as u32),
            _keepalive: Box::new(child),
            stderr_tail: Arc::new(std::sync::Mutex::new(VecDeque::new())),
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

    // ── parse_user_message_text ──────────────────────────────────────────────

    #[test]
    fn parse_user_message_text_extracts_legacy_text_field() {
        let json =
            br#"{"tug_session_id":"abc","type":"user_message","text":"hello","attachments":[]}"#;
        assert_eq!(parse_user_message_text(json), Some("hello".to_owned()));
    }

    #[test]
    fn parse_user_message_text_concatenates_content_text_blocks() {
        let json = br#"{
            "tug_session_id":"abc",
            "type":"user_message",
            "content":[
                {"type":"text","text":"hello "},
                {"type":"image","source":{"type":"base64","media_type":"image/png","data":"PNG"}},
                {"type":"text","text":"world"}
            ]
        }"#;
        assert_eq!(
            parse_user_message_text(json),
            Some("hello world".to_owned())
        );
    }

    #[test]
    fn parse_user_message_text_returns_none_for_image_only_content() {
        let json = br#"{
            "tug_session_id":"abc",
            "type":"user_message",
            "content":[
                {"type":"image","source":{"type":"base64","media_type":"image/png","data":"PNG"}}
            ]
        }"#;
        assert_eq!(parse_user_message_text(json), None);
    }

    #[test]
    fn parse_user_message_text_returns_none_for_other_types() {
        let json = br#"{"tug_session_id":"abc","type":"interrupt"}"#;
        assert_eq!(parse_user_message_text(json), None);
        let json = br#"{"tug_session_id":"abc","type":"tool_approval","request_id":"r","decision":"allow"}"#;
        assert_eq!(parse_user_message_text(json), None);
    }

    #[test]
    fn parse_user_message_text_returns_none_for_empty_text() {
        let json = br#"{"tug_session_id":"abc","type":"user_message","text":"","attachments":[]}"#;
        assert_eq!(parse_user_message_text(json), None);
    }

    #[test]
    fn parse_user_message_text_returns_none_for_malformed_json() {
        assert_eq!(parse_user_message_text(b"not json"), None);
    }

    // ---- inject_replay_telemetry --------------------------------------

    fn sample_telemetry_row(msg_id: &str) -> crate::session_ledger::TurnTelemetryRow {
        crate::session_ledger::TurnTelemetryRow {
            session_id: "s1".to_string(),
            msg_id: msg_id.to_string(),
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
            total_cost_usd: 0.0123,
            wall_clock_ms: 4_000,
            awaiting_approval_ms: 200,
            transport_downtime_ms: 100,
            active_ms: 3_700,
            ttft_ms: Some(150),
            ttftc_ms: Some(300),
            reconnect_count: 0,
            max_stream_gap_ms: 90,
            ended_at: 1_000,
            session_init_tokens: Some(18_575),
        }
    }

    /// A `turn_complete` carrying tugcode's JSONL-authoritative
    /// telemetry (cost + sessionInitTokens + turnEndReason + zero
    /// timing) — the line shape the overlay augments.
    fn turn_complete_with_jsonl_telemetry() -> Vec<u8> {
        serde_json::json!({
            "type": "turn_complete",
            "msg_id": "msg-A",
            "seq": 1,
            "result": "success",
            "telemetry": {
                "cost": {
                    "inputTokens": 7,
                    "outputTokens": 8,
                    "cacheCreationInputTokens": 9,
                    "cacheReadInputTokens": 11,
                    "totalCostUsd": 0,
                },
                "wallClockMs": 0,
                "awaitingApprovalMs": 0,
                "transportDowntimeMs": 0,
                "activeMs": 0,
                "ttftMs": serde_json::Value::Null,
                "ttftcMs": serde_json::Value::Null,
                "reconnectCount": 0,
                "maxStreamGapMs": 0,
                "sessionInitTokens": 4_130,
                "turnEndReason": "complete",
            },
            "ipc_version": 2,
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn inject_replay_telemetry_overlays_timing_and_preserves_jsonl_cost() {
        // Row-present overlay onto a line that ALREADY carries the
        // JSONL-authoritative cost: the cost must survive byte-for-byte
        // (Risk R02, refute direction) AND every timing key must equal
        // the row's value (the add direction — guards a TIME-popover
        // regression for row-present sessions).
        let line = turn_complete_with_jsonl_telemetry();
        let before: serde_json::Value = serde_json::from_slice(&line).unwrap();
        let mut map = std::collections::HashMap::new();
        map.insert("msg-A".to_string(), sample_telemetry_row("msg-A"));
        let out = inject_replay_telemetry(&line, &map);
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        let telemetry = parsed.get("telemetry").expect("telemetry present");

        // Cost UNCHANGED — the JSONL value, NOT the row's (100/50/10/20).
        assert_eq!(telemetry["cost"], before["telemetry"]["cost"]);
        assert_eq!(telemetry["cost"]["inputTokens"], 7);
        // sessionInitTokens UNCHANGED — JSONL value, not the row's 18_575.
        assert_eq!(telemetry["sessionInitTokens"], 4_130);
        // turnEndReason UNTOUCHED.
        assert_eq!(telemetry["turnEndReason"], "complete");

        // Timing OVERLAID from the row.
        assert_eq!(telemetry["wallClockMs"], 4_000);
        assert_eq!(telemetry["awaitingApprovalMs"], 200);
        assert_eq!(telemetry["transportDowntimeMs"], 100);
        assert_eq!(telemetry["activeMs"], 3_700);
        assert_eq!(telemetry["ttftMs"], 150);
        assert_eq!(telemetry["ttftcMs"], 300);
        assert_eq!(telemetry["reconnectCount"], 0);
        assert_eq!(telemetry["maxStreamGapMs"], 90);

        // Original top-level fields preserved.
        assert_eq!(parsed["type"], "turn_complete");
        assert_eq!(parsed["msg_id"], "msg-A");
        assert_eq!(parsed["result"], "success");
    }

    #[test]
    fn inject_replay_telemetry_legacy_no_telemetry_attaches_timing_only() {
        // A legacy turn_complete with NO telemetry object (a tugcode
        // predating the cost-on-replay emit): timing is attached, but
        // no cost is invented — the JSONL is the only cost source.
        let line = br#"{"type":"turn_complete","msg_id":"msg-A","seq":1,"result":"success","ipc_version":2}"#;
        let mut map = std::collections::HashMap::new();
        map.insert("msg-A".to_string(), sample_telemetry_row("msg-A"));
        let out = inject_replay_telemetry(line, &map);
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        let telemetry = parsed
            .get("telemetry")
            .expect("timing-only telemetry attached");
        assert_eq!(telemetry["wallClockMs"], 4_000);
        assert_eq!(telemetry["activeMs"], 3_700);
        // No cost invented from the row.
        assert!(telemetry.get("cost").is_none());
        assert!(telemetry.get("sessionInitTokens").is_none());
    }

    #[test]
    fn inject_replay_telemetry_serializes_null_ttft_fields() {
        let line = turn_complete_with_jsonl_telemetry();
        let mut row = sample_telemetry_row("msg-A");
        row.ttft_ms = None;
        row.ttftc_ms = None;
        let mut map = std::collections::HashMap::new();
        map.insert("msg-A".to_string(), row);
        let out = inject_replay_telemetry(&line, &map);
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert!(parsed["telemetry"]["ttftMs"].is_null());
        assert!(parsed["telemetry"]["ttftcMs"].is_null());
    }

    #[test]
    fn inject_replay_telemetry_passes_through_on_miss() {
        // No row for this msg_id — line returns unchanged (the
        // client reducer's zero-derived block applies, per the
        // "no retroactive backfill" caveat in #step-20-3-4).
        let line = br#"{"type":"turn_complete","msg_id":"unknown","seq":1,"result":"success","ipc_version":2}"#;
        let map: std::collections::HashMap<String, crate::session_ledger::TurnTelemetryRow> =
            std::collections::HashMap::new();
        let out = inject_replay_telemetry(line, &map);
        assert_eq!(out, line.to_vec());
    }

    #[test]
    fn inject_replay_telemetry_passes_through_on_no_msg_id() {
        // A turn_complete without msg_id has nothing to look up;
        // pass through unchanged.
        let line = br#"{"type":"turn_complete","seq":1,"result":"success","ipc_version":2}"#;
        let mut map = std::collections::HashMap::new();
        map.insert("msg-A".to_string(), sample_telemetry_row("msg-A"));
        let out = inject_replay_telemetry(line, &map);
        assert_eq!(out, line.to_vec());
    }

    #[test]
    fn inject_replay_telemetry_passes_through_on_malformed_json() {
        let line = b"not json at all";
        let map: std::collections::HashMap<String, crate::session_ledger::TurnTelemetryRow> =
            std::collections::HashMap::new();
        let out = inject_replay_telemetry(line, &map);
        assert_eq!(out, line.to_vec());
    }

    // ---- merge_and_persist_system_metadata ----------------------------

    fn live_system_metadata_line(model: &str) -> Vec<u8> {
        // Mirror what `tugcode/src/session.ts:511-528` emits — rich
        // payload, suffixed model.
        serde_json::json!({
            "type": "system_metadata",
            "session_id": "sess-1",
            "cwd": "/home/user/project",
            "tools": ["Read", "Bash"],
            "model": model,
            "permissionMode": "default",
            "slash_commands": ["help"],
            "plugins": [],
            "agents": [],
            "skills": ["tugplug:plan"],
            "mcp_servers": [],
            "version": "2.1.105",
            "output_style": "",
            "fast_mode_state": "",
            "apiKeySource": "anthropic",
            "ipc_version": 2,
        })
        .to_string()
        .into_bytes()
    }

    fn replay_system_metadata_line(model: &str) -> Vec<u8> {
        // Mirror what `tugcode/src/replay.ts:989-1006` synthesizes —
        // bare model, every other field empty / empty-array.
        serde_json::json!({
            "type": "system_metadata",
            "session_id": "sess-1",
            "cwd": "",
            "tools": [],
            "model": model,
            "permissionMode": "",
            "slash_commands": [],
            "plugins": [],
            "agents": [],
            "skills": [],
            "mcp_servers": [],
            "version": "",
            "output_style": "",
            "fast_mode_state": "",
            "apiKeySource": "",
            "ipc_version": 2,
        })
        .to_string()
        .into_bytes()
    }

    fn test_tug_session_id() -> TugSessionId {
        TugSessionId::new("test-tug-session")
    }

    #[test]
    fn merge_and_persist_writes_first_observation_verbatim() {
        let ledger = crate::session_ledger::SessionLedger::open_in_memory().unwrap();
        let tug_id = test_tug_session_id();
        let line = live_system_metadata_line("claude-opus-4-7[1m]");
        let out = merge_and_persist_system_metadata(&line, &ledger, "sess-1", &tug_id);
        // Output line carries the full payload.
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["model"], "claude-opus-4-7[1m]");
        assert_eq!(parsed["cwd"], "/home/user/project");
        // Ledger holds the same payload.
        let row = ledger.get_session_metadata("sess-1").unwrap().unwrap();
        let persisted: serde_json::Value = serde_json::from_slice(&row.payload).unwrap();
        assert_eq!(persisted["model"], "claude-opus-4-7[1m]");
    }

    #[test]
    fn merge_and_persist_preserves_suffix_on_replay_after_live() {
        // The canary case. Live arrives first, then a bare-model
        // replay-synthesized payload. Without the merge, the wire
        // delivered to the client would carry the bare name and the
        // window-utilization gauge would regress 1M → 200k.
        let ledger = crate::session_ledger::SessionLedger::open_in_memory().unwrap();
        let tug_id = test_tug_session_id();

        let live = live_system_metadata_line("claude-opus-4-7[1m]");
        let _ = merge_and_persist_system_metadata(&live, &ledger, "sess-1", &tug_id);

        let replay = replay_system_metadata_line("claude-opus-4-7");
        let out = merge_and_persist_system_metadata(&replay, &ledger, "sess-1", &tug_id);

        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            parsed["model"], "claude-opus-4-7[1m]",
            "bridge intercept must preserve the [1m] suffix across resume",
        );
        // And the persisted payload retains the suffix.
        let row = ledger.get_session_metadata("sess-1").unwrap().unwrap();
        let persisted: serde_json::Value = serde_json::from_slice(&row.payload).unwrap();
        assert_eq!(persisted["model"], "claude-opus-4-7[1m]");
    }

    #[test]
    fn merge_and_persist_preserves_non_empty_fields_on_replay() {
        let ledger = crate::session_ledger::SessionLedger::open_in_memory().unwrap();
        let tug_id = test_tug_session_id();

        let _ = merge_and_persist_system_metadata(
            &live_system_metadata_line("claude-opus-4-7[1m]"),
            &ledger,
            "sess-1",
            &tug_id,
        );

        let replay = replay_system_metadata_line("claude-opus-4-7");
        let out = merge_and_persist_system_metadata(&replay, &ledger, "sess-1", &tug_id);

        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["cwd"], "/home/user/project");
        assert_eq!(parsed["permissionMode"], "default");
        assert_eq!(parsed["version"], "2.1.105");
        assert_eq!(parsed["apiKeySource"], "anthropic");
        // Array fields too.
        assert_eq!(parsed["tools"].as_array().unwrap().len(), 2);
        assert_eq!(parsed["slash_commands"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["skills"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn merge_and_persist_passes_through_on_malformed_incoming() {
        let ledger = crate::session_ledger::SessionLedger::open_in_memory().unwrap();
        let tug_id = test_tug_session_id();
        let line = b"not valid json";
        let out = merge_and_persist_system_metadata(line, &ledger, "sess-1", &tug_id);
        assert_eq!(
            out,
            line.to_vec(),
            "malformed incoming returns the line unchanged"
        );
        // And nothing was written to the ledger.
        assert!(ledger.get_session_metadata("sess-1").unwrap().is_none());
    }

    #[test]
    fn merge_and_persist_passes_through_when_incoming_is_not_an_object() {
        // The merge returns an empty map for a non-object incoming;
        // the helper detects that and forwards unchanged rather than
        // emitting `{}` on the wire.
        let ledger = crate::session_ledger::SessionLedger::open_in_memory().unwrap();
        let tug_id = test_tug_session_id();
        let line = br#""just a string""#;
        let out = merge_and_persist_system_metadata(line, &ledger, "sess-1", &tug_id);
        assert_eq!(out, line.to_vec());
        assert!(ledger.get_session_metadata("sess-1").unwrap().is_none());
    }

    #[test]
    fn merge_and_persist_idempotent_on_repeat_writes() {
        // Steady-state operation: the same payload is forwarded
        // multiple times (e.g., reconnect → live session_init → live
        // session_init again). The merged output is byte-stable and
        // the ledger row is overwritten with the same bytes.
        let ledger = crate::session_ledger::SessionLedger::open_in_memory().unwrap();
        let tug_id = test_tug_session_id();
        let line = live_system_metadata_line("claude-opus-4-7[1m]");
        let out1 = merge_and_persist_system_metadata(&line, &ledger, "sess-1", &tug_id);
        let out2 = merge_and_persist_system_metadata(&line, &ledger, "sess-1", &tug_id);
        let parsed1: serde_json::Value = serde_json::from_slice(&out1).unwrap();
        let parsed2: serde_json::Value = serde_json::from_slice(&out2).unwrap();
        assert_eq!(parsed1, parsed2);
    }

    #[test]
    fn merge_and_persist_upgrades_when_suffix_arrives_second() {
        // Symmetric edge: bare arrives first, suffix arrives second.
        // The wire must surface the upgrade so the client window-
        // utilization gauge picks up 1M.
        let ledger = crate::session_ledger::SessionLedger::open_in_memory().unwrap();
        let tug_id = test_tug_session_id();
        let _ = merge_and_persist_system_metadata(
            &replay_system_metadata_line("claude-opus-4-7"),
            &ledger,
            "sess-1",
            &tug_id,
        );
        let out = merge_and_persist_system_metadata(
            &live_system_metadata_line("claude-opus-4-7[1m]"),
            &ledger,
            "sess-1",
            &tug_id,
        );
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed["model"], "claude-opus-4-7[1m]");
    }
}
