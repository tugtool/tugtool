//! Build-replace-relaunch helper for Tug.app development
//!
//! This binary orchestrates the full development cycle for the macOS Tug.app:
//! 1. BUILD: cargo build, bun build, xcodebuild
//! 2. SIGNAL: Send SIGTERM to running Tug.app
//! 3. WAIT: kqueue wait for process exit (with SIGKILL fallback)
//! 4. COPY: Replace binaries in app bundle
//! 5. RELAUNCH: Open app bundle and write status

use clap::Parser;
use serde_json::json;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixListener;
use tokio::time::timeout;

// ============================================================================
// CLI
// ============================================================================

#[derive(Parser, Debug)]
#[command(name = "tugrelaunch")]
#[command(version)]
#[command(about = "Build-replace-relaunch helper for Tug.app development")]
struct Cli {
    /// Path to the tugtool source tree root
    #[arg(long)]
    source_tree: PathBuf,

    /// Path to the Tug.app bundle
    #[arg(long)]
    app_bundle: PathBuf,

    /// Path for the UDS progress listener
    #[arg(long)]
    progress_socket: PathBuf,

    /// PID of the Tug.app process to signal during SIGNAL phase
    #[arg(long)]
    pid: u32,
}

// ============================================================================
// Progress Protocol
// ============================================================================

/// Progress writer wraps an optional UDS connection
struct ProgressWriter {
    stream: Option<tokio::net::UnixStream>,
}

impl ProgressWriter {
    async fn send(&mut self, stage: &str, status: &str, error: Option<&str>) {
        if let Some(stream) = &mut self.stream {
            let msg = progress_json(stage, status, error);
            let line = format!("{}\n", msg);
            let _ = stream.write_all(line.as_bytes()).await;
        }
    }
}

fn progress_json(stage: &str, status: &str, error: Option<&str>) -> String {
    let mut obj = json!({
        "stage": stage,
        "status": status,
    });
    if let Some(err) = error {
        obj["error"] = json!(err);
    }
    obj.to_string()
}

async fn setup_progress_socket(socket_path: &PathBuf) -> ProgressWriter {
    // Remove existing socket if present
    let _ = std::fs::remove_file(socket_path);

    // Bind listener
    let listener = match UnixListener::bind(socket_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "tugrelaunch: warning: failed to bind progress socket: {}",
                e
            );
            return ProgressWriter { stream: None };
        }
    };

    // Accept one connection with 5-second timeout
    let stream = match timeout(Duration::from_secs(5), listener.accept()).await {
        Ok(Ok((stream, _))) => Some(stream),
        Ok(Err(e)) => {
            eprintln!(
                "tugrelaunch: warning: failed to accept progress connection: {}",
                e
            );
            None
        }
        Err(_) => {
            eprintln!("tugrelaunch: warning: timeout waiting for progress connection");
            None
        }
    };

    ProgressWriter { stream }
}

fn cleanup_socket(socket_path: &PathBuf) {
    let _ = std::fs::remove_file(socket_path);
}

// ============================================================================
// Build Orchestration
// ============================================================================

async fn run_builds(cli: &Cli, progress: &mut ProgressWriter) -> Result<(), String> {
    // Phase 1.1: cargo build
    progress.send("cargo", "building", None).await;
    let cargo_dir = cli.source_tree.join("tugcode");
    let cargo_output = tokio::process::Command::new("cargo")
        .arg("build")
        .arg("-p")
        .arg("tugcast")
        .arg("-p")
        .arg("tugtool")
        .arg("-p")
        .arg("tugcode")
        .current_dir(&cargo_dir)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn cargo: {}", e))?;

    if !cargo_output.status.success() {
        let stderr = String::from_utf8_lossy(&cargo_output.stderr);
        let error_msg = format!("cargo build failed: {}", stderr);
        progress.send("cargo", "failed", Some(&error_msg)).await;
        return Err(error_msg);
    }
    progress.send("cargo", "done", None).await;

    // Phase 1.2: bun build
    progress.send("bun", "building", None).await;
    let bun_dir = cli.source_tree.join("tugdeck");
    let bun_output = tokio::process::Command::new("bun")
        .arg("run")
        .arg("build")
        .current_dir(&bun_dir)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn bun: {}", e))?;

    if !bun_output.status.success() {
        let stderr = String::from_utf8_lossy(&bun_output.stderr);
        let error_msg = format!("bun build failed: {}", stderr);
        progress.send("bun", "failed", Some(&error_msg)).await;
        return Err(error_msg);
    }
    progress.send("bun", "done", None).await;

    // Phase 1.3: xcodebuild
    progress.send("xcode", "building", None).await;
    let xcode_output = tokio::process::Command::new("xcodebuild")
        .arg("-project")
        .arg("tugapp/Tug.xcodeproj")
        .arg("-scheme")
        .arg("Tug")
        .arg("-configuration")
        .arg("Debug")
        .arg("build")
        .current_dir(&cli.source_tree)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn xcodebuild: {}", e))?;

    if !xcode_output.status.success() {
        let stderr = String::from_utf8_lossy(&xcode_output.stderr);
        let error_msg = format!("xcodebuild failed: {}", stderr);
        progress.send("xcode", "failed", Some(&error_msg)).await;
        return Err(error_msg);
    }
    progress.send("xcode", "done", None).await;

    Ok(())
}

// ============================================================================
// Signal Phase
// ============================================================================

fn signal_process(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
}

// ============================================================================
// Wait Phase (kqueue)
// ============================================================================

#[cfg(target_os = "macos")]
fn wait_for_exit(pid: u32) {
    use std::mem::MaybeUninit;

    unsafe {
        // Create kqueue
        let kq = libc::kqueue();
        if kq < 0 {
            eprintln!("tugrelaunch: warning: kqueue() failed, cannot wait for exit");
            return;
        }

        // Set up kevent for EVFILT_PROC/NOTE_EXIT
        let mut kev = MaybeUninit::<libc::kevent>::zeroed().assume_init();
        kev.ident = pid as usize;
        kev.filter = libc::EVFILT_PROC;
        kev.flags = libc::EV_ADD | libc::EV_ENABLE | libc::EV_ONESHOT;
        kev.fflags = libc::NOTE_EXIT;
        kev.data = 0;
        kev.udata = std::ptr::null_mut();

        // Register the event
        let ret = libc::kevent(kq, &kev, 1, std::ptr::null_mut(), 0, std::ptr::null());
        if ret < 0 {
            eprintln!("tugrelaunch: warning: kevent() registration failed");
            libc::close(kq);
            return;
        }

        // Wait for event with 10-second timeout
        let mut out_kev = MaybeUninit::<libc::kevent>::zeroed().assume_init();
        let timeout_spec = libc::timespec {
            tv_sec: 10,
            tv_nsec: 0,
        };

        let ret = libc::kevent(kq, std::ptr::null(), 0, &mut out_kev, 1, &timeout_spec);

        if ret == 0 {
            // Timeout -- process didn't exit within 10 seconds, send SIGKILL
            eprintln!(
                "tugrelaunch: process {} did not exit within 10s, sending SIGKILL",
                pid
            );
            libc::kill(pid as i32, libc::SIGKILL);

            // Wait again with shorter timeout
            let short_timeout = libc::timespec {
                tv_sec: 2,
                tv_nsec: 0,
            };
            libc::kevent(kq, std::ptr::null(), 0, &mut out_kev, 1, &short_timeout);
        }

        libc::close(kq);
    }
}

#[cfg(not(target_os = "macos"))]
fn wait_for_exit(_pid: u32) {
    eprintln!("tugrelaunch: wait_for_exit only supported on macOS");
}

// ============================================================================
// Copy Phase
// ============================================================================

fn copy_binaries(cli: &Cli) -> Result<(), String> {
    let macos_dir = cli.app_bundle.join("Contents/MacOS");
    if !macos_dir.exists() {
        return Err(format!("MacOS directory does not exist: {:?}", macos_dir));
    }

    let binaries = vec!["tugcast", "tugtool", "tugcode", "tugrelaunch"];
    let target_dir = cli.source_tree.join("tugcode/target/debug");

    for binary in binaries {
        let src = target_dir.join(binary);
        let dest = macos_dir.join(binary);

        if !src.exists() {
            return Err(format!("Source binary does not exist: {:?}", src));
        }

        // Try atomic rename first (same filesystem)
        if std::fs::rename(&src, &dest).is_err() {
            // Fall back to copy+remove for cross-device
            std::fs::copy(&src, &dest).map_err(|e| format!("Failed to copy {}: {}", binary, e))?;
            std::fs::remove_file(&src)
                .map_err(|e| format!("Failed to remove source {}: {}", binary, e))?;
        }
    }

    Ok(())
}

// ============================================================================
// Relaunch Phase
// ============================================================================

fn relaunch_app(app_bundle: &PathBuf) -> Result<(), String> {
    // Retry with delay: Launch Services may return -600 (procNotFound) if the
    // previous instance hasn't fully deregistered yet after SIGTERM.
    for attempt in 1..=5 {
        let output = std::process::Command::new("open")
            .arg(app_bundle)
            .output()
            .map_err(|e| format!("Failed to run open: {}", e))?;

        if output.status.success() {
            return Ok(());
        }

        if attempt < 5 {
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    Err("open failed after 5 attempts".to_string())
}

fn write_status_file() -> Result<(), String> {
    let status = json!({
        "status": "success",
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    });

    let mut file = std::fs::File::create("/tmp/tugrelaunch-status.json")
        .map_err(|e| format!("Failed to create status file: {}", e))?;

    file.write_all(status.to_string().as_bytes())
        .map_err(|e| format!("Failed to write status file: {}", e))?;

    Ok(())
}

// ============================================================================
// Main Orchestrator
// ============================================================================

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // Set up progress socket (UDS listener)
    let mut progress = setup_progress_socket(&cli.progress_socket).await;

    // Phase 1: BUILD
    if let Err(e) = run_builds(&cli, &mut progress).await {
        eprintln!("tugrelaunch: build failed: {}", e);
        cleanup_socket(&cli.progress_socket);
        std::process::exit(1);
    }

    // Phase 2: SIGNAL
    progress.send("relaunch", "quitting", None).await;
    signal_process(cli.pid);

    // Phase 3: WAIT
    wait_for_exit(cli.pid);

    // Phase 4: COPY
    if let Err(e) = copy_binaries(&cli) {
        // Log but don't fail -- old binaries stay, app still launches
        eprintln!("tugrelaunch: warning: copy failed: {}", e);
    }

    // Phase 5: RELAUNCH
    if let Err(e) = relaunch_app(&cli.app_bundle) {
        eprintln!("tugrelaunch: error: relaunch failed: {}", e);
        cleanup_socket(&cli.progress_socket);
        std::process::exit(1);
    }

    if let Err(e) = write_status_file() {
        eprintln!("tugrelaunch: warning: status file write failed: {}", e);
    }

    progress.send("relaunch", "done", None).await;
    cleanup_socket(&cli.progress_socket);
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // Substep 5.1: CLI + Progress
    // ========================================================================

    #[test]
    fn test_cli_parsing_accepts_all_required_arguments() {
        let cli = Cli::try_parse_from([
            "tugrelaunch",
            "--source-tree",
            "/path/to/source",
            "--app-bundle",
            "/path/to/app",
            "--progress-socket",
            "/tmp/progress.sock",
            "--pid",
            "12345",
        ]);

        assert!(cli.is_ok());
        let cli = cli.unwrap();
        assert_eq!(cli.source_tree, PathBuf::from("/path/to/source"));
        assert_eq!(cli.app_bundle, PathBuf::from("/path/to/app"));
        assert_eq!(cli.progress_socket, PathBuf::from("/tmp/progress.sock"));
        assert_eq!(cli.pid, 12345);
    }

    #[test]
    fn test_cli_parsing_fails_on_missing_arguments() {
        let result = Cli::try_parse_from(["tugrelaunch"]);
        assert!(result.is_err());

        let result = Cli::try_parse_from([
            "tugrelaunch",
            "--source-tree",
            "/path/to/source",
            "--app-bundle",
            "/path/to/app",
        ]);
        assert!(result.is_err()); // Missing progress-socket and pid
    }

    #[test]
    fn test_progress_message_serialization_stage_and_status() {
        let msg = progress_json("cargo", "building", None);
        let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();

        assert_eq!(parsed["stage"], "cargo");
        assert_eq!(parsed["status"], "building");
        assert!(parsed["error"].is_null());
    }

    #[test]
    fn test_progress_message_serialization_with_error() {
        let msg = progress_json("cargo", "failed", Some("build error"));
        let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();

        assert_eq!(parsed["stage"], "cargo");
        assert_eq!(parsed["status"], "failed");
        assert_eq!(parsed["error"], "build error");
    }

    // ========================================================================
    // Substep 5.2: Build orchestration
    // ========================================================================

    #[test]
    fn test_build_phase_returns_error_for_invalid_source_tree() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let cli = Cli {
                source_tree: PathBuf::from("/nonexistent/path"),
                app_bundle: PathBuf::from("/tmp/app"),
                progress_socket: PathBuf::from("/tmp/sock"),
                pid: 1,
            };
            let mut progress = ProgressWriter { stream: None };

            let result = run_builds(&cli, &mut progress).await;
            assert!(result.is_err());
        });
    }

    // ========================================================================
    // Substep 5.3: Signal/Wait/Copy/Relaunch
    // ========================================================================

    #[test]
    fn test_binary_copy_to_target_directory() {
        use tempfile::TempDir;

        // Create temp directories
        let temp_dir = TempDir::new().unwrap();
        let source_dir = temp_dir.path().join("tugcode/target/debug");
        let app_dir = temp_dir.path().join("Tug.app/Contents/MacOS");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&app_dir).unwrap();

        // Create dummy binaries
        let binaries = vec!["tugcast", "tugtool", "tugcode", "tugrelaunch"];
        for binary in &binaries {
            let path = source_dir.join(binary);
            std::fs::write(&path, "dummy binary content").unwrap();
        }

        // Run copy
        let cli = Cli {
            source_tree: temp_dir.path().to_path_buf(),
            app_bundle: temp_dir.path().join("Tug.app"),
            progress_socket: PathBuf::from("/tmp/sock"),
            pid: 1,
        };

        let result = copy_binaries(&cli);
        assert!(result.is_ok());

        // Verify files copied
        for binary in &binaries {
            let dest = app_dir.join(binary);
            assert!(dest.exists());
            let content = std::fs::read_to_string(&dest).unwrap();
            assert_eq!(content, "dummy binary content");
        }
    }

    #[test]
    fn test_status_file_is_written_correctly() {
        let result = write_status_file();
        assert!(result.is_ok());

        let content = std::fs::read_to_string("/tmp/tugrelaunch-status.json").unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        assert_eq!(parsed["status"], "success");
        assert!(parsed["timestamp"].is_number());
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_signal_sending_to_child_process() {
        // Spawn a child process that sleeps
        let mut child = std::process::Command::new("sleep")
            .arg("10")
            .spawn()
            .unwrap();

        let pid = child.id();

        // Send SIGTERM
        signal_process(pid);

        // Wait for child to exit
        let status = child.wait().unwrap();
        assert!(!status.success()); // SIGTERM causes non-zero exit
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_kqueue_wait_for_short_lived_process() {
        // Spawn a child that exits quickly
        let mut child = std::process::Command::new("sleep")
            .arg("0.1")
            .spawn()
            .unwrap();

        let pid = child.id();

        // Wait should complete successfully
        wait_for_exit(pid);

        // Child should be exited
        let result = child.try_wait().unwrap();
        assert!(result.is_some());
    }
}
