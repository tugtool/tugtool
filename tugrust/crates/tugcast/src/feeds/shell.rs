//! Shell feed — per-card block-oriented shell execution.
//!
//! The `$` route runs commands against a real shell and threads each
//! command/output exchange into the Dev transcript. This module is the
//! tugcast side: it consumes `SHELL_INPUT` (0x61) frames from the deck and
//! emits `SHELL_OUTPUT` (0x60) frames tagged with the card's `tug_session_id`.
//!
//! # Model (probe: `crates/tugcast/probes/shell-exec/FINDINGS.md`)
//!
//! Each card session owns a **long-lived POSIX-shell child in pipe mode** (no
//! PTY / no controlling TTY), driven by a **sentinel protocol**: after each
//! command the service writes a sentinel emitter, then reads the merged
//! stdout+stderr stream until the sentinel line, which carries the command's
//! exit code and post-command cwd. Pipe mode makes `isatty()` false, so
//! pagers and TUIs self-disable; a hardened env (`PAGER`/`GIT_PAGER`=cat,
//! `TERM=dumb`, `GIT_TERMINAL_PROMPT=0`) and a per-command `</dev/null`
//! redirect close the remaining hang vectors. A genuine long-runner wedges the
//! shell (it blocks on the foreground command), so cancellation cannot be
//! another write — it must **signal the process group** (SIGTERM→SIGKILL),
//! which the dispatcher does out-of-band via the shared pid.
//!
//! The child is the **user's own shell, spawned interactive-login** (`$SHELL
//! -il`), so it sources their startup files — PATH, exports, aliases,
//! functions — and the `$` route feels like their terminal rather than a bare
//! shell. A post-startup preamble then neutralizes the interactive baggage
//! (prompt paint, precmd/preexec hooks, and the SIGTERM-ignore that would
//! defeat the reap) and a discarded warmup exchange absorbs any rc chatter. A
//! profile that hangs or fails the warmup can never brick the route: the child
//! is reaped and a plain rc-less shell takes its place, flagged in the next
//! exchange's output.
//!
//! # Scope + lifecycle
//!
//! One shell child per `tug_session_id`, lazily spawned on the first `exec`
//! in the card's project dir. The child does NOT survive a tugcast restart;
//! it restarts fresh on the next `exec` (the transcript *record* persists via
//! the ledger, not the live process). A `kill` (or per-exchange timeout)
//! reaps the process group and the session respawns on the next `exec`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

use tugcast_core::protocol::{FeedId, Frame};

use super::code::parse_tug_session_id;
use super::session_scoped::SessionScopedFeed;
use crate::shell_ledger::{NewShellExchange, ShellLedger};

/// Broadcast capacity for `SHELL_OUTPUT`. Human-typed commands are low
/// volume; the restore tail comes from the ledger CONTROL read, not replay.
pub const SHELL_BROADCAST_CAPACITY: usize = 256;

/// Unique-per-process sentinel marker. The pid keeps it from colliding with
/// any literal text a command might print (a bare `__TUG_SHELL_SENTINEL__`
/// in a file, say) across concurrent tugcast instances.
fn sentinel_marker() -> String {
    format!("__TUG_SHELL_SENTINEL__{}__", std::process::id())
}

/// Per-exchange wall-clock cap. A command still running past this is reaped
/// (pgid signal) and its exchange settles with a null exit code.
const EXEC_TIMEOUT: Duration = Duration::from_secs(120);

/// Grace between SIGTERM and SIGKILL when reaping a wedged process group.
const KILL_GRACE: Duration = Duration::from_millis(400);

/// Cap on the warmup probe that sources the user's rc files. Heavy profiles
/// (nvm, pyenv, version managers) can take a second or two; past this the
/// login shell is judged wedged and the route falls back to a plain shell.
const WARMUP_TIMEOUT: Duration = Duration::from_secs(10);

/// Prefixed to the first exchange after a login-shell warmup failed and the
/// route fell back to a plain shell (no rc files sourced).
const SAFE_MODE_NOTICE: &str =
    "tug: your shell profile failed to load; running a plain shell without it.\n";

// ---------------------------------------------------------------------------
// Wire types (Spec S01)
// ---------------------------------------------------------------------------

/// Inbound `SHELL_INPUT` frame. `cwd` rides the `exec` verb so the service can
/// spawn the session's shell in the card's project dir without a session→dir
/// lookup; it is honored only on the lazy spawn (cwd is shell state after).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ShellInput {
    Exec {
        tug_session_id: String,
        exchange_id: String,
        command: String,
        #[serde(default)]
        cwd: Option<String>,
    },
    // `kill` reaps the session's whole process group (the shell + whatever it
    // is running), so it needs only the routing key; any `exchange_id` the
    // deck sends is ignored by serde.
    Kill {
        tug_session_id: String,
    },
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The exec shell: the user's `$SHELL` if it is bash/zsh (the sentinel protocol
/// is POSIX/bash/zsh syntax), else `/bin/zsh`. A fish/nushell user still gets a
/// POSIX exec child — a block-exec shell need not *be* the login shell.
fn resolve_exec_shell() -> String {
    if let Ok(sh) = std::env::var("SHELL") {
        let leaf = sh.rsplit('/').next().unwrap_or("");
        if leaf == "bash" || leaf == "zsh" {
            return sh;
        }
    }
    "/bin/zsh".to_string()
}

// ---------------------------------------------------------------------------
// Per-session shell child
// ---------------------------------------------------------------------------

/// Shared handle onto a running shell child: the process-group leader pid the
/// dispatcher signals to reap a wedged command out-of-band. `None` when no
/// child is live (never spawned, or reaped and awaiting respawn).
#[derive(Default)]
struct SessionShared {
    pid: Option<i32>,
}

/// Commands routed to a per-session task. `kill` is NOT here — it is handled
/// by the dispatcher signaling the shared pid directly, because a wedged task
/// is blocked reading the child's stdout and could never dequeue it.
enum ShellCmd {
    Exec {
        exchange_id: String,
        command: String,
    },
}

/// A live per-session actor: the command channel plus the shared pid the
/// dispatcher signals for `kill`.
struct ShellSession {
    tx: mpsc::Sender<ShellCmd>,
    shared: Arc<Mutex<SessionShared>>,
}

/// The child's stdin + a line reader over its merged stdout.
struct ShellChild {
    stdin: ChildStdin,
    lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    // Held so the child is killed on drop (session teardown / task exit).
    _child: tokio::process::Child,
}

/// Spawn the session shell, preferring the user's interactive login shell so
/// their rc files are in force — the whole point of the `$` route is that it
/// feels like *their* terminal, not some bare shell. A hung or broken rc file
/// must never brick the route, so the login spawn is health-checked (see
/// `spawn_shell_child`'s warmup); on failure the child is reaped and a plain
/// rc-less shell takes its place, with a one-line notice for the next output.
async fn spawn_session_shell(
    spawn_cwd: &PathBuf,
    marker: &str,
) -> std::io::Result<(ShellChild, i32, Option<String>)> {
    if let Ok((sh, pid)) = spawn_shell_child(spawn_cwd, marker, true).await {
        return Ok((sh, pid, None));
    }
    let (sh, pid) = spawn_shell_child(spawn_cwd, marker, false).await?;
    Ok((sh, pid, Some(SAFE_MODE_NOTICE.to_string())))
}

/// Spawn one shell child in pipe mode, hardened, as its own process-group
/// leader, in `spawn_cwd`. Merges stderr into stdout (`exec 2>&1`) so the
/// combined stream is what the deck renders and the sentinel rides.
///
/// `login` spawns the user's shell as interactive-login (`-il`), so it sources
/// their startup files (PATH, exports, aliases, functions) exactly as their
/// terminal does; `-i` is also what enables alias expansion. The spawn then
/// runs a discarded warmup probe: it flushes any stdout an rc file printed and
/// confirms the shell answers the sentinel protocol, so a wedged profile is
/// caught here rather than corrupting the first real exchange.
async fn spawn_shell_child(
    spawn_cwd: &PathBuf,
    marker: &str,
    login: bool,
) -> std::io::Result<(ShellChild, i32)> {
    let shell = resolve_exec_shell();
    let mut cmd = Command::new(&shell);
    if login {
        cmd.arg("-il");
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        // Hardening ([Q03]): no pager, no TUI, no prompts.
        .env("PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .env("TERM", "dumb")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("PS1", "")
        .env("PROMPT", "");
    if spawn_cwd.is_dir() {
        cmd.current_dir(spawn_cwd);
    }
    // `setsid` before exec: the child leads a NEW SESSION with NO controlling
    // TTY. Two payoffs: (1) `/dev/tty` opens fail (ENXIO), so a command that
    // grabs the terminal directly — vim, `ssh` / `sudo` password prompts —
    // declines fast instead of hanging on tugcast's tty; (2) the child is a
    // process-group leader (pgid == pid), so `kill(-pid, …)` reaps the shell
    // AND whatever command it is currently running.
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    let mut child = cmd.spawn()?;
    let pid = child.id().map(|p| p as i32).unwrap_or(0);
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("shell stdin unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("shell stdout unavailable"))?;
    // Drain stderr (it is redirected into stdout below, but anything the shell
    // writes before `exec 2>&1` takes effect must not fill the pipe buffer).
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });
    }
    let mut sh = ShellChild {
        stdin,
        lines: BufReader::new(stdout).lines(),
        _child: child,
    };
    // Preamble, run AFTER the shell has finished sourcing its rc files (so it
    // wins over anything they set). Line by line:
    //   - `exec 2>&1`: merge stderr into stdout so ordering is preserved and
    //     the sentinel (printf to stdout) terminates every exchange.
    //   - `trap - TERM QUIT`: an interactive shell IGNORES SIGTERM, which would
    //     defeat the kill/timeout reap (the shell would outlive the group
    //     signal). Reset the disposition so `reap_group` kills it as before.
    //   - clear precmd/preexec/chpwd hooks and `unfunction` the standalone
    //     `precmd`/`preexec` a theme may have defined (the array clear misses
    //     those) so the prompt is not re-armed after each command.
    //   - `unsetopt promptsp promptcr`: kill zsh's partial-line `%` marker,
    //     which paints even with an empty prompt.
    //   - empty every prompt parameter.
    // Any prompt paint from before this takes effect is absorbed by the warmup
    // exchange below and discarded, so real exchanges start clean.
    sh.stdin
        .write_all(
            b"exec 2>&1\n\
              trap - TERM QUIT\n\
              precmd_functions=() preexec_functions=() chpwd_functions=()\n\
              unfunction precmd preexec chpwd 2>/dev/null\n\
              unsetopt promptsp promptcr 2>/dev/null\n\
              PS1= PS2= PROMPT= RPROMPT= RPS1= PROMPT_COMMAND=\n",
        )
        .await?;
    sh.stdin.flush().await?;

    // Warmup probe: a discarded no-op exchange. It absorbs any stdout an rc
    // file printed and confirms the shell answers the sentinel; a login shell
    // whose profile hangs or never reaches the sentinel is unusable, so reap
    // its process group and report failure for the plain-shell fallback.
    match tokio::time::timeout(WARMUP_TIMEOUT, run_command(&mut sh, marker, ":")).await {
        Ok(Ok(r)) if r.exit_code.is_some() => Ok((sh, pid)),
        _ => {
            reap_group(pid);
            Err(std::io::Error::other("shell warmup failed"))
        }
    }
}

/// Outcome of running one command through the sentinel protocol.
struct ExecResult {
    output: String,
    exit_code: Option<i32>,
    cwd_after: Option<String>,
}

/// Run one command: write it wrapped `</dev/null` (so a stdin-reading command
/// can't swallow the sentinel), then the sentinel emitter, and read the merged
/// stream until the sentinel line. `None` exit code = the stream ended before
/// the sentinel (the child was reaped mid-command).
async fn run_command(
    child: &mut ShellChild,
    marker: &str,
    command: &str,
) -> std::io::Result<ExecResult> {
    let line = format!(
        "{{ {command} ; }} </dev/null\nprintf '\\n%s\\t%d\\t%s\\n' \"{marker}\" \"$?\" \"$PWD\"\n"
    );
    child.stdin.write_all(line.as_bytes()).await?;
    child.stdin.flush().await?;

    let mut output = String::new();
    loop {
        match child.lines.next_line().await? {
            Some(l) => {
                if let Some(rest) = l.strip_prefix(marker) {
                    // `<marker>\t<code>\t<cwd>`
                    let mut parts = rest.trim_start_matches('\t').split('\t');
                    let exit_code = parts.next().and_then(|s| s.parse::<i32>().ok());
                    let cwd_after = parts.next().map(|s| s.to_string());
                    // Drop the single trailing empty line the sentinel's
                    // leading `\n` produced.
                    if output.ends_with('\n') {
                        output.pop();
                    }
                    return Ok(ExecResult {
                        output,
                        exit_code,
                        cwd_after,
                    });
                }
                output.push_str(&l);
                output.push('\n');
            }
            // EOF before the sentinel — the child was reaped (kill / crash).
            None => {
                return Ok(ExecResult {
                    output,
                    exit_code: None,
                    cwd_after: None,
                });
            }
        }
    }
}

/// Signal a process group: SIGTERM, then SIGKILL after a grace. Reaps a wedged
/// shell and the command it is running. Safe no-op for a non-positive pid.
fn reap_group(pid: i32) {
    if pid <= 0 {
        return;
    }
    unsafe {
        libc::kill(-pid, libc::SIGTERM);
    }
    tokio::spawn(async move {
        tokio::time::sleep(KILL_GRACE).await;
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    });
}

/// The per-session actor task. Owns the shell child, runs commands serially,
/// and emits exchange frames. Exits when its command channel closes.
#[allow(clippy::too_many_arguments)]
async fn shell_session_task(
    mut rx: mpsc::Receiver<ShellCmd>,
    output: SessionScopedFeed,
    ledger: Option<Arc<ShellLedger>>,
    shared: Arc<Mutex<SessionShared>>,
    tug_session_id: String,
    spawn_cwd: PathBuf,
    marker: String,
    exec_timeout: Duration,
) {
    let mut child: Option<ShellChild> = None;
    let mut cwd = spawn_cwd.to_string_lossy().to_string();
    // Prepended to the next exchange's output when a login-shell warmup failed
    // and this session fell back to a plain shell. Set on spawn, cleared once
    // emitted so the notice shows once per fallback, not on every command.
    let mut pending_notice: Option<String> = None;

    while let Some(cmd) = rx.recv().await {
        let ShellCmd::Exec {
            exchange_id,
            command,
        } = cmd;

        // Lazy spawn / respawn.
        if child.is_none() {
            match spawn_session_shell(&spawn_cwd, &marker).await {
                Ok((sh, pid, notice)) => {
                    child = Some(sh);
                    shared.lock().unwrap().pid = Some(pid);
                    if notice.is_some() {
                        pending_notice = notice;
                    }
                    emit(
                        &output,
                        &tug_session_id,
                        json!({ "type": "shell_state", "live": true, "cwd": cwd }),
                    );
                }
                Err(e) => {
                    warn!(error = %e, %tug_session_id, "shell spawn failed");
                    let at = now_ms();
                    emit(
                        &output,
                        &tug_session_id,
                        json!({
                            "type": "exchange_complete", "exchange_id": exchange_id,
                            "command": command, "cwd": cwd,
                            "exit_code": serde_json::Value::Null, "cwd_after": cwd,
                            "duration_ms": 0, "output": format!("shell failed to start: {e}\n"),
                            "started_at": at, "settled_at": at,
                        }),
                    );
                    continue;
                }
            }
        }
        let sh = child.as_mut().unwrap();

        let started_at = now_ms();
        let cwd_before = cwd.clone();
        emit(
            &output,
            &tug_session_id,
            json!({
                "type": "exchange_started", "exchange_id": exchange_id,
                "command": command, "cwd": cwd, "started_at": started_at,
            }),
        );

        let result = tokio::time::timeout(exec_timeout, run_command(sh, &marker, &command)).await;
        let (mut out, exit_code, cwd_after, reaped) = match result {
            Ok(Ok(r)) => {
                let reaped = r.exit_code.is_none();
                (r.output, r.exit_code, r.cwd_after, reaped)
            }
            Ok(Err(e)) => (format!("shell read error: {e}\n"), None, None, true),
            Err(_) => {
                // Timed out — reap the wedged group.
                let pid = shared.lock().unwrap().pid.unwrap_or(0);
                reap_group(pid);
                (String::new(), None, None, true)
            }
        };
        if let Some(notice) = pending_notice.take() {
            out.insert_str(0, &notice);
        }
        if let Some(c) = &cwd_after {
            cwd = c.clone();
        }
        let settled_at = now_ms();
        let duration_ms = settled_at.saturating_sub(started_at);
        // The settle frame is self-contained — it carries the same
        // command/cwd/timestamps the started frame did, because the deck
        // settles the transcript row in place from THIS frame alone (and
        // the restore path's ledger rows carry the full shape too).
        emit(
            &output,
            &tug_session_id,
            json!({
                "type": "exchange_complete", "exchange_id": exchange_id,
                "command": command, "cwd": cwd_before,
                "exit_code": exit_code.map(serde_json::Value::from).unwrap_or(serde_json::Value::Null),
                "cwd_after": cwd, "duration_ms": duration_ms, "output": out,
                "started_at": started_at, "settled_at": settled_at,
            }),
        );

        // Persist the settled exchange for restore ([P07]). Insert-on-settle
        // only: an exchange in flight at a crash never lands (it never settled).
        if let Some(ledger) = ledger.as_ref() {
            let row = NewShellExchange {
                tug_session_id: tug_session_id.clone(),
                command: command.clone(),
                output: out.clone(),
                exit_code,
                cwd: cwd_before,
                cwd_after: Some(cwd.clone()),
                started_at_ms: started_at as i64,
                settled_at_ms: settled_at as i64,
            };
            if let Err(e) = ledger.record_exchange(&row) {
                warn!(error = %e, %tug_session_id, "shell ledger: record_exchange failed");
            }
        }

        // A reaped child (kill / timeout / crash / EOF) is gone; the next exec
        // respawns fresh in the project dir ([Q04] restart-fresh).
        if reaped {
            child = None;
            shared.lock().unwrap().pid = None;
            cwd = spawn_cwd.to_string_lossy().to_string();
        }
    }

    // Channel closed (session teardown): reap any live child.
    let pid = shared.lock().unwrap().pid.take();
    if let Some(pid) = pid {
        reap_group(pid);
    }
    debug!(%tug_session_id, "shell session task exited");
}

fn emit(output: &SessionScopedFeed, tug_session_id: &str, payload: serde_json::Value) {
    output.publish(tug_session_id, payload.to_string().as_bytes());
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/// Consume `SHELL_INPUT` frames and route them to per-session shell tasks:
/// `exec` lazily spawns a session's task and enqueues the command; `kill`
/// signals the session's shared pid out-of-band (a wedged task can't dequeue).
/// One task per `tug_session_id`; the map lives for the dispatcher's lifetime.
pub async fn shell_dispatcher_task(
    input_rx: mpsc::Receiver<Frame>,
    output: SessionScopedFeed,
    ledger: Option<Arc<ShellLedger>>,
    cancel: CancellationToken,
) {
    run_dispatcher(input_rx, output, ledger, cancel, EXEC_TIMEOUT).await;
}

/// Dispatcher core with an injectable per-exchange timeout (tests use a short
/// one to exercise the reap-on-timeout path without waiting the full cap).
async fn run_dispatcher(
    mut input_rx: mpsc::Receiver<Frame>,
    output: SessionScopedFeed,
    ledger: Option<Arc<ShellLedger>>,
    cancel: CancellationToken,
    exec_timeout: Duration,
) {
    let mut sessions: HashMap<String, ShellSession> = HashMap::new();
    let marker = sentinel_marker();

    loop {
        let frame = tokio::select! {
            _ = cancel.cancelled() => break,
            f = input_rx.recv() => match f {
                Some(f) => f,
                None => break,
            },
        };
        if frame.feed_id != FeedId::SHELL_INPUT {
            continue;
        }
        let Some(input) = parse_shell_input(&frame.payload) else {
            warn!("shell dispatcher: unparseable SHELL_INPUT frame");
            continue;
        };
        match input {
            ShellInput::Exec {
                tug_session_id,
                exchange_id,
                command,
                cwd,
            } => {
                let session = sessions.entry(tug_session_id.clone()).or_insert_with(|| {
                    let (tx, rx) = mpsc::channel(64);
                    let shared = Arc::new(Mutex::new(SessionShared::default()));
                    let spawn_cwd = cwd
                        .as_deref()
                        .map(PathBuf::from)
                        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
                    tokio::spawn(shell_session_task(
                        rx,
                        output.clone(),
                        ledger.clone(),
                        Arc::clone(&shared),
                        tug_session_id.clone(),
                        spawn_cwd,
                        marker.clone(),
                        exec_timeout,
                    ));
                    ShellSession { tx, shared }
                });
                if session
                    .tx
                    .send(ShellCmd::Exec {
                        exchange_id,
                        command,
                    })
                    .await
                    .is_err()
                {
                    // Task died — drop it so the next exec respawns.
                    sessions.remove(&tug_session_id);
                }
            }
            ShellInput::Kill { tug_session_id } => {
                if let Some(session) = sessions.get(&tug_session_id) {
                    let pid = session.shared.lock().unwrap().pid;
                    if let Some(pid) = pid {
                        reap_group(pid);
                    }
                }
            }
        }
    }

    // Drop all sessions — each task reaps its child on channel close.
    sessions.clear();
}

/// Parse a `SHELL_INPUT` payload. Requires a `tug_session_id` (the routing
/// key); a payload without one — or with an unknown `type` — is dropped.
fn parse_shell_input(payload: &[u8]) -> Option<ShellInput> {
    // Fast reject: a frame with no session id can't be routed.
    parse_tug_session_id(payload)?;
    serde_json::from_slice::<ShellInput>(payload).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tugcast_core::lag::LagPolicy;

    fn exec_frame(sid: &str, ex: &str, cmd: &str, cwd: Option<&str>) -> Frame {
        let mut v = json!({
            "type": "exec", "tug_session_id": sid,
            "exchange_id": ex, "command": cmd,
        });
        if let Some(c) = cwd {
            v["cwd"] = json!(c);
        }
        Frame::new(FeedId::SHELL_INPUT, v.to_string().into_bytes())
    }

    fn kill_frame(sid: &str) -> Frame {
        Frame::new(
            FeedId::SHELL_INPUT,
            json!({ "type": "kill", "tug_session_id": sid })
                .to_string()
                .into_bytes(),
        )
    }

    fn payload_json(f: &Frame) -> serde_json::Value {
        serde_json::from_slice(&f.payload).unwrap()
    }

    /// Drive the dispatcher; collect `exchange_complete` payloads for `sid`
    /// until `count` are seen or the timeout fires. Uses a short per-exchange
    /// timeout so a genuinely-hanging command (a TUI) is reaped within the test.
    async fn drive(frames: Vec<Frame>, sid: &str, count: usize) -> Vec<serde_json::Value> {
        let output = SessionScopedFeed::new(FeedId::SHELL_OUTPUT, 256, LagPolicy::Warn);
        let mut rx = output.subscribe();
        let (tx, in_rx) = mpsc::channel(64);
        let cancel = CancellationToken::new();
        let handle = tokio::spawn(run_dispatcher(
            in_rx,
            output.clone(),
            None,
            cancel.clone(),
            Duration::from_secs(3),
        ));
        for f in frames {
            tx.send(f).await.unwrap();
        }
        let mut completes = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        while completes.len() < count {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Ok(frame)) => {
                    let v = payload_json(&frame);
                    if v["tug_session_id"] == sid && v["type"] == "exchange_complete" {
                        completes.push(v);
                    }
                }
                _ => break,
            }
        }
        cancel.cancel();
        drop(tx);
        let _ = handle.await;
        completes
    }

    #[tokio::test]
    async fn exec_round_trip_and_exit_code() {
        let done = drive(
            vec![
                exec_frame("s1", "e1", "echo hello world", None),
                exec_frame("s1", "e2", "false", None),
            ],
            "s1",
            2,
        )
        .await;
        assert_eq!(done.len(), 2);
        assert_eq!(done[0]["exit_code"], 0);
        assert!(done[0]["output"].as_str().unwrap().contains("hello world"));
        assert_eq!(done[1]["exit_code"], 1);
        // The settle frame is self-contained: the deck settles the row in
        // place from this frame alone, so it must re-carry the command and
        // both timestamps (not just the delta).
        assert_eq!(done[0]["command"], "echo hello world");
        assert!(done[0]["started_at"].as_u64().is_some());
        assert!(done[0]["settled_at"].as_u64().is_some());
        assert!(done[0]["settled_at"].as_u64() >= done[0]["started_at"].as_u64());
    }

    #[tokio::test]
    async fn cwd_persists_across_commands() {
        let done = drive(
            vec![
                exec_frame("s1", "e1", "cd /tmp", None),
                exec_frame("s1", "e2", "pwd", None),
            ],
            "s1",
            2,
        )
        .await;
        assert_eq!(done.len(), 2);
        // The cwd sentinel tracked into /tmp...
        assert!(done[0]["cwd_after"].as_str().unwrap().contains("tmp"));
        // ...and a later `pwd` prints it — proving shell-state persistence.
        assert!(done[1]["output"].as_str().unwrap().contains("/tmp"));
    }

    #[tokio::test]
    async fn stdin_reading_command_does_not_desync() {
        // `cat` with no args would eat the sentinel emitter without the
        // per-command `</dev/null`; here it must exit 0 and the NEXT command
        // must still be answered (protocol stays synced).
        let done = drive(
            vec![
                exec_frame("s1", "e1", "cat", None),
                exec_frame("s1", "e2", "echo still-synced", None),
            ],
            "s1",
            2,
        )
        .await;
        assert_eq!(done.len(), 2);
        assert_eq!(done[0]["exit_code"], 0);
        assert!(done[1]["output"].as_str().unwrap().contains("still-synced"));
    }

    #[tokio::test]
    async fn interactive_tui_is_reaped_by_the_timeout() {
        // An interactive TUI (vim) renders to the pipe and waits for input —
        // it does NOT reliably auto-decline, so the per-exchange timeout is the
        // backstop: the shell must never hang forever. With the short test
        // timeout the exchange settles with a null exit code (reaped), and a
        // FOLLOW-UP command proves the session respawned and stayed usable.
        let done = drive(
            vec![
                exec_frame("s1", "e1", "vim", None),
                exec_frame("s1", "e2", "echo recovered", None),
            ],
            "s1",
            2,
        )
        .await;
        assert_eq!(done.len(), 2);
        assert_eq!(done[0]["exit_code"], serde_json::Value::Null, "vim reaped");
        assert!(done[1]["output"].as_str().unwrap().contains("recovered"));
    }

    #[tokio::test]
    async fn login_shell_sources_user_rc() {
        // The `$` route runs the user's shell interactive-login, so their rc
        // files are in force: an alias defined there EXPANDS (only interactive
        // shells expand aliases) and an exported var is visible. This is what
        // makes the route feel like *their* terminal, not a bare shell.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(".zshrc"),
            "alias tuggreet='echo hello-from-rc'\nexport TUG_RC_MARKER=rc-was-sourced\n",
        )
        .unwrap();
        // Force zsh reading THIS rc (via ZDOTDIR), independent of the dev's own
        // login shell, so the assertion is deterministic across machines.
        unsafe {
            std::env::set_var("SHELL", "/bin/zsh");
            std::env::set_var("ZDOTDIR", dir.path());
        }
        let done = drive(
            vec![
                exec_frame("s1", "e1", "tuggreet", None),
                exec_frame("s1", "e2", "echo \"$TUG_RC_MARKER\"", None),
            ],
            "s1",
            2,
        )
        .await;
        assert_eq!(done.len(), 2);
        assert!(
            done[0]["output"].as_str().unwrap().contains("hello-from-rc"),
            "rc alias must expand: {:?}",
            done[0]["output"]
        );
        assert!(
            done[1]["output"].as_str().unwrap().contains("rc-was-sourced"),
            "rc export must be visible: {:?}",
            done[1]["output"]
        );
    }

    #[tokio::test]
    async fn per_session_isolation() {
        // Two sessions cd to different dirs; neither sees the other's cwd.
        let done_a = drive(
            vec![
                exec_frame("sa", "e1", "cd /tmp", None),
                exec_frame("sa", "e2", "pwd", None),
                exec_frame("sb", "e3", "pwd", Some("/usr")),
            ],
            "sa",
            2,
        )
        .await;
        assert!(done_a[1]["output"].as_str().unwrap().contains("/tmp"));
    }

    #[tokio::test]
    async fn settled_exchange_is_recorded_to_the_ledger() {
        // The settle path writes each exchange to the ledger (insert-on-settle),
        // so a restore can reconstruct the shell rows.
        let ledger = Arc::new(crate::shell_ledger::ShellLedger::open_in_memory().unwrap());
        let output = SessionScopedFeed::new(FeedId::SHELL_OUTPUT, 256, LagPolicy::Warn);
        let mut rx = output.subscribe();
        let (tx, in_rx) = mpsc::channel(64);
        let cancel = CancellationToken::new();
        let handle = tokio::spawn(run_dispatcher(
            in_rx,
            output.clone(),
            Some(Arc::clone(&ledger)),
            cancel.clone(),
            Duration::from_secs(3),
        ));
        tx.send(exec_frame("s1", "e1", "echo persisted", Some("/tmp")))
            .await
            .unwrap();
        // Wait for the exchange to settle.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while let Ok(Ok(f)) = tokio::time::timeout_at(deadline, rx.recv()).await {
            if payload_json(&f)["type"] == "exchange_complete" {
                break;
            }
        }
        cancel.cancel();
        drop(tx);
        let _ = handle.await;
        let rows = ledger.list_exchanges("s1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].command, "echo persisted");
        assert!(rows[0].output.contains("persisted"));
        assert_eq!(rows[0].exit_code, Some(0));
    }

    #[tokio::test]
    async fn kill_reaps_a_long_runner() {
        // A long sleep wedges the shell; a kill frame reaps the group, and the
        // exchange settles with a null exit code.
        let output = SessionScopedFeed::new(FeedId::SHELL_OUTPUT, 256, LagPolicy::Warn);
        let mut rx = output.subscribe();
        let (tx, in_rx) = mpsc::channel(64);
        let cancel = CancellationToken::new();
        let handle = tokio::spawn(shell_dispatcher_task(
            in_rx,
            output.clone(),
            None,
            cancel.clone(),
        ));
        tx.send(exec_frame("s1", "e1", "sleep 60", None))
            .await
            .unwrap();
        // Wait for the exchange to start, then kill.
        tokio::time::sleep(Duration::from_millis(500)).await;
        tx.send(kill_frame("s1")).await.unwrap();
        let mut settled = None;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while settled.is_none() {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Ok(frame)) => {
                    let v = payload_json(&frame);
                    if v["type"] == "exchange_complete" && v["exchange_id"] == "e1" {
                        settled = Some(v);
                    }
                }
                _ => break,
            }
        }
        cancel.cancel();
        drop(tx);
        let _ = handle.await;
        let v = settled.expect("killed exchange must settle");
        assert_eq!(v["exit_code"], serde_json::Value::Null);
    }
}
