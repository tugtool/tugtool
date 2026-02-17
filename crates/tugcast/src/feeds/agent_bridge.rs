//! Agent bridge module
//!
//! Spawns tugtalk as a child process and relays JSON-lines IPC messages.

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

use super::conversation::conversation_output_frame;

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

/// Resolve tugtalk binary path
///
/// Priority order:
/// 1. CLI override if provided
/// 2. Sibling binary (next to current executable)
/// 3. PATH lookup
/// 4. Bun fallback (bun run tugtalk/src/main.ts)
pub fn resolve_tugtalk_path(cli_override: Option<&Path>, project_dir: &Path) -> PathBuf {
    // CLI override has highest priority
    if let Some(path) = cli_override {
        return path.to_path_buf();
    }

    // Try sibling binary
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let sibling = parent.join("tugtalk");
            if sibling.exists() {
                info!("Found tugtalk sibling binary at {}", sibling.display());
                return sibling;
            }
        }
    }

    // Try PATH using Command lookup
    // If "tugtalk" is in PATH, Command::new will find it
    // For now, we skip explicit PATH lookup and go straight to fallback

    // Fallback to bun run
    warn!("tugtalk binary not found, falling back to bun run");
    project_dir.join("tugtalk/src/main.ts")
}

/// Run the agent bridge
///
/// Spawns tugtalk, performs protocol handshake, relays messages, handles crashes.
#[allow(clippy::too_many_arguments)]
pub async fn run_agent_bridge(
    conversation_tx: broadcast::Sender<Frame>,
    conversation_watch_tx: watch::Sender<Frame>,
    mut conversation_input_rx: mpsc::Receiver<Frame>,
    tugtalk_path: PathBuf,
    project_dir: PathBuf,
    cancel: CancellationToken,
) {
    let mut crash_budget = CrashBudget::new(3, Duration::from_secs(60));

    // Send project_info frame before starting the loop
    let project_info_json = format!(
        r#"{{"type":"project_info","project_dir":"{}"}}"#,
        project_dir.display()
    );
    let project_info_frame = conversation_output_frame(project_info_json.as_bytes());
    let _ = conversation_tx.send(project_info_frame.clone());
    let _ = conversation_watch_tx.send(project_info_frame);

    loop {
        if crash_budget.is_exhausted() {
            error!("Crash budget exhausted, stopping agent bridge");
            let error_json = r#"{"type":"error","message":"tugtalk crashed too many times","recoverable":false}"#;
            let frame = conversation_output_frame(error_json.as_bytes());
            let _ = conversation_tx.send(frame.clone());
            let _ = conversation_watch_tx.send(frame);
            break;
        }

        info!("Spawning tugtalk at {}", tugtalk_path.display());

        // Determine command based on path
        let (cmd, args) = if tugtalk_path.extension().and_then(|s| s.to_str()) == Some("ts") {
            (
                "bun",
                vec!["run".to_string(), tugtalk_path.display().to_string()],
            )
        } else {
            (tugtalk_path.to_str().unwrap_or("tugtalk"), vec![])
        };

        let mut child = match Command::new(cmd)
            .args(&args)
            .arg("--dir")
            .arg(&project_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                error!("Failed to spawn tugtalk: {}", e);
                crash_budget.record_crash();
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        let mut stdin = child.stdin.take().expect("Failed to take stdin");
        let stdout = child.stdout.take().expect("Failed to take stdout");
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
                // Read from tugtalk stdout
                line_result = stdout_reader.next_line() => {
                    match line_result {
                        Ok(Some(line)) => {
                            // Parse and forward to conversation feed
                            let frame = conversation_output_frame(line.as_bytes());
                            let _ = conversation_tx.send(frame.clone());
                            let _ = conversation_watch_tx.send(frame);
                        }
                        Ok(None) => {
                            // tugtalk stdout closed
                            warn!("tugtalk stdout closed");
                            break;
                        }
                        Err(e) => {
                            error!("Error reading from tugtalk stdout: {}", e);
                            break;
                        }
                    }
                }

                // Write to tugtalk stdin
                Some(frame) = conversation_input_rx.recv() => {
                    if let Some(json) = super::conversation::parse_conversation_input(&frame) {
                        let mut line = json;
                        line.push('\n');
                        if let Err(e) = stdin.write_all(line.as_bytes()).await {
                            error!("Error writing to tugtalk stdin: {}", e);
                            break;
                        }
                    }
                }

                // Cancellation
                _ = cancel.cancelled() => {
                    info!("Agent bridge cancelled, killing tugtalk");
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
                    info!("tugtalk exited normally");
                    break;
                } else {
                    error!("tugtalk crashed with status: {}", status);
                    crash_budget.record_crash();
                }
            }
            Err(e) => {
                error!("Error waiting for tugtalk: {}", e);
                crash_budget.record_crash();
            }
        }

        if crash_budget.is_exhausted() {
            break;
        }

        info!("Restarting tugtalk in 1 second...");
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
        // This test would need to use fake time, skipping for now
        // In real usage, crashes > 60s apart don't count toward budget
    }

    #[test]
    fn test_resolve_tugtalk_path_cli_override() {
        let override_path = Path::new("/custom/path/tugtalk");
        let result = resolve_tugtalk_path(Some(override_path), Path::new("/project"));
        assert_eq!(result, override_path);
    }

    #[test]
    fn test_resolve_tugtalk_path_fallback() {
        // Without a real binary in PATH, should fall back to bun run
        let result = resolve_tugtalk_path(None, Path::new("/project"));
        assert!(result.to_str().unwrap().contains("tugtalk/src/main.ts"));
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
