//! Agent bridge module
//!
//! Spawns tugcode as a child process and relays JSON-lines IPC messages.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use tugcast_core::protocol::Frame;

use super::code::code_output_frame;

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

/// Handles returned from `spawn_agent_bridge` — contains the watch receivers
/// that clients need to get snapshots of persistent state.
pub struct AgentBridgeHandles {
    pub snapshot_watches: Vec<watch::Receiver<Frame>>,
}

/// Spawn the agent bridge background task.
///
/// Creates internal watch channels, spawns the async task, and returns handles
/// so callers don't need to manage channel creation themselves.
pub fn spawn_agent_bridge(
    code_tx: broadcast::Sender<Frame>,
    code_input_rx: mpsc::Receiver<Frame>,
    tugcode_path: PathBuf,
    project_dir: PathBuf,
    cancel: CancellationToken,
    replay_buffer: crate::router::ReplayBuffer,
) -> AgentBridgeHandles {
    use tugcast_core::FeedId;

    let (project_info_tx, project_info_rx) =
        watch::channel(Frame::new(FeedId::CODE_OUTPUT, vec![]));
    let (session_watch_tx, session_watch_rx) =
        watch::channel(Frame::new(FeedId::CODE_OUTPUT, vec![]));

    tokio::spawn(run_agent_bridge(
        code_tx,
        project_info_tx,
        session_watch_tx,
        code_input_rx,
        tugcode_path,
        project_dir,
        cancel,
        replay_buffer,
    ));

    AgentBridgeHandles {
        snapshot_watches: vec![project_info_rx, session_watch_rx],
    }
}

/// Run the agent bridge
///
/// Spawns tugcode, performs protocol handshake, relays messages, handles crashes.
async fn run_agent_bridge(
    code_tx: broadcast::Sender<Frame>,
    project_info_tx: watch::Sender<Frame>,
    session_watch_tx: watch::Sender<Frame>,
    mut code_input_rx: mpsc::Receiver<Frame>,
    tugcode_path: PathBuf,
    project_dir: PathBuf,
    cancel: CancellationToken,
    replay_buffer: crate::router::ReplayBuffer,
) {
    let mut crash_budget = CrashBudget::new(3, Duration::from_secs(60));

    // Send project_info frame before starting the loop
    let display_dir = crate::dev::shorten_synthetic_path(&project_dir);
    let project_info_json = format!(
        r#"{{"type":"project_info","project_dir":"{}"}}"#,
        display_dir.display()
    );
    let project_info_frame = code_output_frame(project_info_json.as_bytes());
    let _ = code_tx.send(project_info_frame.clone());
    let _ = project_info_tx.send(project_info_frame);

    loop {
        if crash_budget.is_exhausted() {
            error!("Crash budget exhausted, stopping agent bridge");
            let error_json = r#"{"type":"error","message":"tugcode crashed too many times","recoverable":false}"#;
            let frame = code_output_frame(error_json.as_bytes());
            let _ = code_tx.send(frame);
            break;
        }

        info!("Spawning tugcode at {}", tugcode_path.display());

        // Determine command based on path
        let (cmd, args) = if tugcode_path.extension().and_then(|s| s.to_str()) == Some("ts") {
            (
                "bun",
                vec!["run".to_string(), tugcode_path.display().to_string()],
            )
        } else {
            (tugcode_path.to_str().unwrap_or("tugcode"), vec![])
        };

        let mut child = match Command::new(cmd)
            .args(&args)
            .arg("--dir")
            .arg(&project_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                error!("Failed to spawn tugcode: {}", e);
                crash_budget.record_crash();
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        // stdin/stdout are guaranteed Some because we set Stdio::piped() above.
        let Some(mut stdin) = child.stdin.take() else {
            error!("tugcode stdin not available despite Stdio::piped()");
            crash_budget.record_crash();
            let _ = child.kill().await;
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let Some(stdout) = child.stdout.take() else {
            error!("tugcode stdout not available despite Stdio::piped()");
            crash_budget.record_crash();
            let _ = child.kill().await;
            sleep(Duration::from_secs(1)).await;
            continue;
        };
        let mut stdout_reader = BufReader::new(stdout).lines();

        // Send protocol_init
        let protocol_init = b"{\"type\":\"protocol_init\",\"version\":1}\n";
        if let Err(e) = stdin.write_all(protocol_init).await {
            error!("Failed to write protocol_init: {}", e);
            crash_budget.record_crash();
            let _ = child.kill().await;
            sleep(Duration::from_secs(1)).await;
            continue;
        }

        // Read protocol_ack
        let ack_result =
            tokio::time::timeout(Duration::from_secs(5), stdout_reader.next_line()).await;
        match ack_result {
            Ok(Ok(Some(line))) => {
                if !line.contains("\"type\":\"protocol_ack\"") {
                    error!("Invalid protocol_ack: {}", line);
                    let _ = child.kill().await;
                    crash_budget.record_crash();
                    sleep(Duration::from_secs(1)).await;
                    continue;
                }
                info!("Protocol handshake successful");
            }
            _ => {
                error!("Failed to receive protocol_ack");
                let _ = child.kill().await;
                crash_budget.record_crash();
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        }

        // Relay loop
        loop {
            tokio::select! {
                // Read from tugcode stdout
                line_result = stdout_reader.next_line() => {
                    match line_result {
                        Ok(Some(line)) => {
                            // Parse and forward to code broadcast feed
                            let frame = code_output_frame(line.as_bytes());
                            // Also latch session_init onto the watch channel so
                            // clients connecting after startup receive it.
                            if line.contains("\"type\":\"session_init\"") {
                                let _ = session_watch_tx.send(frame.clone());
                            }
                            replay_buffer.push(frame.clone());
                            let _ = code_tx.send(frame);
                        }
                        Ok(None) => {
                            // tugcode stdout closed
                            warn!("tugcode stdout closed");
                            break;
                        }
                        Err(e) => {
                            error!("Error reading from tugcode stdout: {}", e);
                            break;
                        }
                    }
                }

                // Write to tugcode stdin
                Some(frame) = code_input_rx.recv() => {
                    if let Some(json) = super::code::parse_code_input(&frame) {
                        let mut line = json;
                        line.push('\n');
                        if let Err(e) = stdin.write_all(line.as_bytes()).await {
                            error!("Error writing to tugcode stdin: {}", e);
                            break;
                        }
                    }
                }

                // Cancellation
                _ = cancel.cancelled() => {
                    info!("Agent bridge cancelled, killing tugcode");
                    let _ = child.kill().await;
                    return;
                }
            }
        }

        // Child process exited
        let status = child.wait().await;
        match status {
            Ok(status) => {
                if status.success() {
                    info!("tugcode exited normally");
                    break;
                } else {
                    error!("tugcode crashed with status: {}", status);
                    crash_budget.record_crash();
                }
            }
            Err(e) => {
                error!("Error waiting for tugcode: {}", e);
                crash_budget.record_crash();
            }
        }

        if crash_budget.is_exhausted() {
            break;
        }

        info!("Restarting tugcode in 1 second...");
        sleep(Duration::from_secs(1)).await;
    }
}

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
    fn test_project_info_frame_format() {
        // Test that project_info JSON is formatted correctly
        let project_dir = "/path/to/project";
        let expected_json = format!(
            r#"{{"type":"project_info","project_dir":"{}"}}"#,
            project_dir
        );

        // Parse to verify it's valid JSON
        let parsed: serde_json::Value = serde_json::from_str(&expected_json).unwrap();
        assert_eq!(parsed["type"], "project_info");
        assert_eq!(parsed["project_dir"], project_dir);
    }
}
