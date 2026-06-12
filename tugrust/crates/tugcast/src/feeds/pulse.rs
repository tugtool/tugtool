//! pulse — the app-scoped PULSE bridge: spawns and supervises the
//! `tugpulse` commentator daemon, routes producer facts into its
//! stdin, and turns its stdout lines into ledger rows + `PULSE` feed
//! broadcasts.
//!
//! Topology (`roadmap/pulse.md`):
//!
//!   producers (per-session bridges) ──pulse_fact──▶ fact_tx ─▶ daemon stdin
//!   daemon stdout ──pulse line──▶ ledger (capped) + PULSE broadcast ─▶ decks
//!
//! One bridge per tugcast process; the daemon is spawned LAZILY on the
//! first fact while the `pulse/enabled` tugbank default reads true —
//! disabled means facts are dropped and no subprocess ever exists.
//! On daemon death the next fact respawns it (rate-limited), re-seeded
//! from the ledger tail so the narrative thread survives.
//!
//! One-way isolation: nothing in this module writes toward any work
//! session — the only outputs are the ledger, the PULSE broadcast, and
//! tracing.

use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use tugcast_core::{FeedId, Frame};

use crate::session_ledger::SessionLedger;

/// Rolling-log row cap ([P09]).
pub const PULSE_LEDGER_CAP: usize = 200;
/// Tail length used both for deck reads and daemon re-seeding.
pub const PULSE_TAIL_LEN: usize = 20;
/// Tugbank default for the kill switch ([P06]): `Value::Bool`; absent
/// or unreadable reads as ENABLED (PULSE is on by default). The deck's
/// settings surface writes the same `(domain, key)` as a `bool`.
pub const PULSE_ENABLED_DOMAIN: &str = "dev.tugtool.pulse";
pub const PULSE_ENABLED_KEY: &str = "enabled";
/// Minimum spacing between daemon (re)spawn attempts.
const RESPAWN_MIN_INTERVAL: Duration = Duration::from_secs(5);

/// Active daemon subprocess handles, mirrored on `SessionChild`'s
/// shape: boxed stdio + an opaque keepalive whose drop kills the child.
pub struct PulseChild {
    pub stdin: Box<dyn AsyncWrite + Send + Unpin>,
    pub stdout: Box<dyn AsyncRead + Send + Unpin>,
    pub keepalive: Box<dyn Send>,
}

/// Spawner abstraction so unit tests drive the bridge without a real
/// tugpulse binary (the `ChildSpawner` pattern, app-scoped flavor).
pub trait PulseSpawner: Send + Sync + 'static {
    /// Spawn the daemon, seeded with the ledger-tail lines (oldest
    /// first) so the commentator keeps its narrative memory.
    fn spawn(&self, seed_lines: &[String]) -> io::Result<PulseChild>;
}

/// Production spawner: runs the compiled `tugpulse` binary.
pub struct TugpulseSpawner {
    pub tugpulse_path: PathBuf,
}

impl PulseSpawner for TugpulseSpawner {
    fn spawn(&self, seed_lines: &[String]) -> io::Result<PulseChild> {
        let seed_json = serde_json::to_string(seed_lines).unwrap_or_else(|_| "[]".to_string());
        let mut child = Command::new(&self.tugpulse_path)
            .arg("--seed")
            .arg(seed_json)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("tugpulse stdin not available"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("tugpulse stdout not available"))?;
        // Forward daemon stderr into tracing so operator-visible
        // failures (claude auth, spawn errors) aren't lost to launchd.
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::warn!(target: "tugcast::tugpulse_stderr", "{line}");
                }
            });
        }
        Ok(PulseChild {
            stdin: Box::new(stdin),
            stdout: Box::new(stdout),
            keepalive: Box::new(child),
        })
    }
}

/// Resolve the tugpulse binary the way tugcode resolves: the already-
/// resolved tugcode path's sibling, falling back to a PATH lookup.
pub fn resolve_tugpulse_path(tugcode_path: &std::path::Path) -> PathBuf {
    let sibling = tugcode_path.with_file_name("tugpulse");
    if sibling.exists() {
        return sibling;
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            let candidate = PathBuf::from(dir).join("tugpulse");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    // Last resort: the sibling path (spawn will fail loudly and the
    // bridge logs it; PULSE simply stays silent).
    sibling
}

/// Everything the bridge task needs. `enabled` is consulted per
/// spawn-opportunity (a fact arriving with no live daemon), so a
/// toggle flip takes effect without a tugcast restart.
pub struct PulseBridgeConfig {
    pub spawner: Arc<dyn PulseSpawner>,
    pub enabled: Arc<dyn Fn() -> bool + Send + Sync>,
    pub ledger: Option<Arc<SessionLedger>>,
    pub pulse_tx: broadcast::Sender<Frame>,
}

/// Cheap-to-clone handle producers use to submit raw `pulse_fact`
/// JSON lines (newline NOT included).
pub type PulseFactSender = mpsc::Sender<Vec<u8>>;

/// Spawn the bridge task. Returns the fact sender; the task lives
/// until `cancel` fires (killing any live daemon via keepalive drop).
pub fn spawn_pulse_bridge(config: PulseBridgeConfig, cancel: CancellationToken) -> PulseFactSender {
    let (fact_tx, fact_rx) = mpsc::channel::<Vec<u8>>(256);
    tokio::spawn(pulse_bridge_task(config, fact_rx, cancel));
    fact_tx
}

/// Internal: events from the daemon-stdout reader task.
enum DaemonEvent {
    Line(String),
    Died,
}

async fn pulse_bridge_task(
    config: PulseBridgeConfig,
    mut fact_rx: mpsc::Receiver<Vec<u8>>,
    cancel: CancellationToken,
) {
    let mut daemon_stdin: Option<Box<dyn AsyncWrite + Send + Unpin>> = None;
    let mut daemon_keepalive: Option<Box<dyn Send>> = None;
    let (event_tx, mut event_rx) = mpsc::channel::<DaemonEvent>(64);
    let mut last_spawn_attempt: Option<Instant> = None;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                info!("pulse bridge: cancelled; killing daemon");
                drop(daemon_stdin.take());
                drop(daemon_keepalive.take());
                return;
            }
            maybe_fact = fact_rx.recv() => {
                let Some(fact) = maybe_fact else {
                    info!("pulse bridge: all fact senders dropped; exiting");
                    drop(daemon_stdin.take());
                    drop(daemon_keepalive.take());
                    return;
                };
                if !(config.enabled)() {
                    // Disabled: drop facts, never spawn. A live daemon
                    // from before the flip is torn down here so the
                    // toggle takes effect at the next fact.
                    if daemon_keepalive.is_some() {
                        info!("pulse bridge: disabled; stopping daemon");
                        drop(daemon_stdin.take());
                        drop(daemon_keepalive.take());
                    }
                    continue;
                }
                if daemon_stdin.is_none() {
                    let throttled = last_spawn_attempt
                        .is_some_and(|t| t.elapsed() < RESPAWN_MIN_INTERVAL);
                    if throttled {
                        continue; // drop the fact; next one may retry
                    }
                    last_spawn_attempt = Some(Instant::now());
                    let seed = config
                        .ledger
                        .as_ref()
                        .and_then(|l| l.list_pulse_lines_tail(PULSE_TAIL_LEN).ok())
                        .map(|rows| rows.into_iter().map(|r| r.text).collect::<Vec<_>>())
                        .unwrap_or_default();
                    match config.spawner.spawn(&seed) {
                        Ok(child) => {
                            info!(seed_lines = seed.len(), "pulse bridge: daemon spawned");
                            daemon_stdin = Some(child.stdin);
                            daemon_keepalive = Some(child.keepalive);
                            spawn_stdout_reader(child.stdout, event_tx.clone());
                        }
                        Err(err) => {
                            warn!(error = %err, "pulse bridge: daemon spawn failed");
                            continue;
                        }
                    }
                }
                if let Some(stdin) = daemon_stdin.as_mut() {
                    let mut line = fact;
                    line.push(b'\n');
                    if let Err(err) = stdin.write_all(&line).await {
                        warn!(error = %err, "pulse bridge: stdin write failed; daemon marked dead");
                        drop(daemon_stdin.take());
                        drop(daemon_keepalive.take());
                    }
                }
            }
            maybe_event = event_rx.recv() => {
                match maybe_event {
                    Some(DaemonEvent::Line(line)) => {
                        handle_pulse_line(&config, &line);
                    }
                    Some(DaemonEvent::Died) => {
                        warn!("pulse bridge: daemon stdout closed");
                        drop(daemon_stdin.take());
                        drop(daemon_keepalive.take());
                    }
                    None => {
                        // event_tx is owned by this task + readers; with
                        // readers gone and our clone alive this can't
                        // happen, but exit defensively.
                        return;
                    }
                }
            }
        }
    }
}

fn spawn_stdout_reader(
    stdout: Box<dyn AsyncRead + Send + Unpin>,
    event_tx: mpsc::Sender<DaemonEvent>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if event_tx.send(DaemonEvent::Line(line)).await.is_err() {
                        return;
                    }
                }
                Ok(None) | Err(_) => {
                    let _ = event_tx.send(DaemonEvent::Died).await;
                    return;
                }
            }
        }
    });
}

/// Parse one daemon stdout line; persist + broadcast it. Non-`pulse`
/// or malformed lines are logged and dropped — wire delivery and
/// persistence must never panic on daemon output.
fn handle_pulse_line(config: &PulseBridgeConfig, line: &str) {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(err) => {
            warn!(error = %err, "pulse bridge: unparseable daemon line");
            return;
        }
    };
    if parsed.get("type").and_then(|v| v.as_str()) != Some("pulse") {
        return;
    }
    let text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("");
    if text.is_empty() {
        return;
    }
    let beat = parsed.get("beat").and_then(|v| v.as_i64()).unwrap_or(0);
    let at_ms = parsed.get("at").and_then(|v| v.as_i64()).unwrap_or(0);
    let scopes: Vec<String> = parsed
        .get("scopes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if let Some(ledger) = config.ledger.as_ref() {
        if let Err(err) = ledger.record_pulse_line(at_ms, beat, text, &scopes, PULSE_LEDGER_CAP) {
            warn!(error = %err, "pulse bridge: ledger write failed");
        }
    }
    let _ = config
        .pulse_tx
        .send(Frame::new(FeedId::PULSE, line.as_bytes().to_vec()));
}

/// Is this tugcode stdout line a `pulse_fact` frame? The session
/// relay calls this on every line (cheap substring pre-filter, then
/// the payload inspector's parse) to divert producer facts to the
/// pulse bridge instead of the deck-bound CODE_OUTPUT broadcast.
pub fn is_pulse_fact_line(line: &str) -> bool {
    if !line.contains("\"pulse_fact\"") {
        return false;
    }
    super::payload_inspector::InspectedPayload::from_slice(line.as_bytes())
        .and_then(|p| p.msg_type.clone())
        .as_deref()
        == Some("pulse_fact")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Fake spawner: counts spawns and hands the bridge duplex pipes
    /// the test holds the far ends of.
    struct FakeSpawner {
        spawns: AtomicUsize,
        // One prepared child per spawn, handed out in order.
        children: std::sync::Mutex<Vec<PulseChild>>,
        seeds_seen: std::sync::Mutex<Vec<Vec<String>>>,
    }

    impl PulseSpawner for FakeSpawner {
        fn spawn(&self, seed_lines: &[String]) -> io::Result<PulseChild> {
            self.spawns.fetch_add(1, Ordering::SeqCst);
            self.seeds_seen.lock().unwrap().push(seed_lines.to_vec());
            self.children
                .lock()
                .unwrap()
                .pop()
                .ok_or_else(|| io::Error::other("no fake child prepared"))
        }
    }

    fn fact_line(scope: &str, fact: &str) -> Vec<u8> {
        serde_json::json!({
            "type": "pulse_fact",
            "source": "test",
            "scope": scope,
            "kind": "note",
            "fact": fact,
            "at": 1,
        })
        .to_string()
        .into_bytes()
    }

    #[tokio::test]
    async fn disabled_toggle_drops_facts_and_never_spawns() {
        let spawner = Arc::new(FakeSpawner {
            spawns: AtomicUsize::new(0),
            children: std::sync::Mutex::new(vec![]),
            seeds_seen: std::sync::Mutex::new(vec![]),
        });
        let (pulse_tx, _keep) = broadcast::channel(8);
        let cancel = CancellationToken::new();
        let fact_tx = spawn_pulse_bridge(
            PulseBridgeConfig {
                spawner: Arc::clone(&spawner) as Arc<dyn PulseSpawner>,
                enabled: Arc::new(|| false),
                ledger: None,
                pulse_tx,
            },
            cancel.clone(),
        );
        fact_tx.send(fact_line("s1", "hello")).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(spawner.spawns.load(Ordering::SeqCst), 0);
        cancel.cancel();
    }

    #[tokio::test]
    async fn facts_route_to_daemon_and_lines_broadcast() {
        // Far ends the test drives: read the daemon's stdin, write its
        // stdout.
        let (test_reads_stdin, bridge_stdin) = tokio::io::duplex(4096);
        let (bridge_stdout, mut test_writes_stdout) = tokio::io::duplex(4096);
        let spawner = Arc::new(FakeSpawner {
            spawns: AtomicUsize::new(0),
            children: std::sync::Mutex::new(vec![PulseChild {
                stdin: Box::new(bridge_stdin),
                stdout: Box::new(bridge_stdout),
                keepalive: Box::new(()),
            }]),
            seeds_seen: std::sync::Mutex::new(vec![]),
        });
        let (pulse_tx, mut pulse_rx) = broadcast::channel(8);
        let cancel = CancellationToken::new();
        let fact_tx = spawn_pulse_bridge(
            PulseBridgeConfig {
                spawner: Arc::clone(&spawner) as Arc<dyn PulseSpawner>,
                enabled: Arc::new(|| true),
                ledger: None,
                pulse_tx,
            },
            cancel.clone(),
        );

        // Fact flows to daemon stdin.
        fact_tx.send(fact_line("s1", "tests green")).await.unwrap();
        let mut stdin_lines = BufReader::new(test_reads_stdin).lines();
        let received = tokio::time::timeout(Duration::from_secs(2), stdin_lines.next_line())
            .await
            .expect("daemon received fact in time")
            .unwrap()
            .expect("a line");
        assert!(received.contains("\"tests green\""));
        assert_eq!(spawner.spawns.load(Ordering::SeqCst), 1);

        // Daemon line flows out as a PULSE frame.
        let line = serde_json::json!({
            "type": "pulse",
            "text": "Tests green — wiring next.",
            "scopes": ["s1"],
            "beat": 1,
            "at": 2,
        })
        .to_string();
        test_writes_stdout
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
        let frame = tokio::time::timeout(Duration::from_secs(2), pulse_rx.recv())
            .await
            .expect("PULSE frame in time")
            .expect("frame");
        assert_eq!(frame.feed_id, FeedId::PULSE);
        let payload: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(payload["text"], "Tests green — wiring next.");

        cancel.cancel();
    }

    #[test]
    fn pulse_fact_line_detection() {
        assert!(is_pulse_fact_line(
            r#"{"type":"pulse_fact","source":"claude-code","scope":"s","kind":"note","fact":"x","at":1}"#
        ));
        // Mentions the string but isn't the frame type.
        assert!(!is_pulse_fact_line(
            r#"{"type":"assistant_message","text":"discussing \"pulse_fact\" frames"}"#
        ));
        assert!(!is_pulse_fact_line(r#"{"type":"turn_complete"}"#));
        assert!(!is_pulse_fact_line("not json"));
    }
}
