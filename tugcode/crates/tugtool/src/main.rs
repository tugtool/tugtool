use clap::Parser;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::process::Command;
use tokio::signal::unix::{signal, SignalKind};
use tokio::time::timeout;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// tugtool: Launcher binary for tugdeck dashboard
#[derive(Parser, Debug)]
#[command(name = "tugtool")]
#[command(version)]
#[command(about = "Launch tugdeck dashboard - starts tugcast and opens the browser")]
pub struct Cli {
    /// Tmux session name to attach to (passed to tugcast)
    #[arg(long, default_value = "cc0")]
    pub session: String,

    /// Port for tugcast HTTP server
    #[arg(long, default_value_t = 7890)]
    pub port: u16,

    /// Working directory for the tmux session
    #[arg(long, default_value = ".")]
    pub dir: PathBuf,

    /// Enable dev mode: auto-detect source tree, spawn bun dev, serve assets from disk
    #[arg(long)]
    pub dev: bool,

    /// Path to mono-repo root (overrides auto-detection when --dev is set)
    #[arg(long)]
    pub source_tree: Option<PathBuf>,
}

impl Cli {
    /// Parse CLI arguments from the environment
    pub fn parse() -> Self {
        <Self as Parser>::parse()
    }
}

/// Resolve the tugcast binary path: look next to the current executable first, then fall back to PATH
fn resolve_tugcast_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let sibling = exe.parent().unwrap_or(exe.as_path()).join("tugcast");
        if sibling.exists() {
            return sibling;
        }
    }
    PathBuf::from("tugcast")
}

/// Detect the mono-repo root by walking up from the current directory looking for tugdeck/
fn detect_source_tree() -> Result<PathBuf, String> {
    detect_source_tree_from(
        &std::env::current_dir().map_err(|e| format!("failed to get current directory: {}", e))?,
    )
}

/// Detect the mono-repo root by walking up from a starting directory looking for tugdeck/
fn detect_source_tree_from(start: &std::path::Path) -> Result<PathBuf, String> {
    let mut dir = start.to_path_buf();
    loop {
        if dir.join("tugdeck").is_dir() {
            return Ok(dir);
        }
        if !dir.pop() {
            return Err(
                "could not find tugdeck/ directory in any parent -- use --source-tree to specify the mono-repo root"
                    .to_string(),
            );
        }
    }
}

/// Check if a command is available in PATH
async fn check_command_available(command: &str) -> bool {
    Command::new(command)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .is_ok()
}

/// Spawn bun dev as a child process
async fn spawn_bun_dev(source_tree: &std::path::Path) -> Result<tokio::process::Child, String> {
    // Check if bun is installed
    if !check_command_available("bun").await {
        return Err(
            "bun is required for dev mode but was not found in PATH. Install it from https://bun.sh"
                .to_string(),
        );
    }

    let tugdeck_dir = source_tree.join("tugdeck");

    // Check if node_modules exists, run bun install if not
    if !tugdeck_dir.join("node_modules").exists() {
        info!("node_modules/ not found, running bun install...");
        let install_status = Command::new("bun")
            .arg("install")
            .current_dir(&tugdeck_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await
            .map_err(|e| format!("failed to run bun install: {}", e))?;

        if !install_status.success() {
            return Err("bun install failed".to_string());
        }
    }

    // Spawn bun run dev
    Command::new("bun")
        .arg("run")
        .arg("dev")
        .current_dir(&tugdeck_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn bun dev: {}", e))
}

/// Spawn tugcast as a child process with control socket path
fn spawn_tugcast(
    session: &str,
    port: u16,
    dir: &std::path::Path,
    dev_path: Option<&std::path::Path>,
    control_socket_path: &std::path::Path,
) -> std::io::Result<tokio::process::Child> {
    let mut cmd = Command::new(resolve_tugcast_path());
    cmd.arg("--session")
        .arg(session)
        .arg("--port")
        .arg(port.to_string())
        .arg("--dir")
        .arg(dir.to_string_lossy().as_ref());

    if let Some(path) = dev_path {
        cmd.arg("--dev").arg(path.to_string_lossy().as_ref());
    }

    cmd.arg("--control-socket")
        .arg(control_socket_path.to_string_lossy().as_ref());

    cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit()).spawn()
}

/// Create a Unix domain socket listener for control socket IPC
fn create_control_listener(port: u16) -> std::io::Result<(UnixListener, PathBuf)> {
    let tmpdir = std::env::temp_dir();
    let path = tmpdir.join(format!("tugcast-ctl-{}.sock", port));
    // Delete stale socket file if it exists
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    let listener = UnixListener::bind(&path)?;
    Ok((listener, path))
}

/// Wait for a tugcast child to connect and send a `ready` message over UDS.
/// Returns the auth URL and the connected stream (kept alive for shutdown messages).
async fn wait_for_ready(
    listener: &UnixListener,
) -> Result<
    (
        String,
        BufReader<tokio::net::unix::OwnedReadHalf>,
        tokio::net::unix::OwnedWriteHalf,
    ),
    String,
> {
    let (stream, _) = match timeout(Duration::from_secs(30), listener.accept()).await {
        Ok(Ok(conn)) => conn,
        Ok(Err(e)) => return Err(format!("control socket accept failed: {}", e)),
        Err(_) => return Err("timeout waiting for tugcast ready".to_string()),
    };

    let (read_half, write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let mut line = String::new();

    loop {
        line.clear();
        match timeout(Duration::from_secs(30), reader.read_line(&mut line)).await {
            Ok(Ok(0)) => return Err("tugcast disconnected before sending ready".to_string()),
            Ok(Ok(_)) => {
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                    if msg.get("type").and_then(|t| t.as_str()) == Some("ready") {
                        let auth_url = msg
                            .get("auth_url")
                            .and_then(|u| u.as_str())
                            .ok_or("ready message missing auth_url")?
                            .to_string();
                        return Ok((auth_url, reader, write_half));
                    }
                }
            }
            Ok(Err(e)) => return Err(format!("error reading control socket: {}", e)),
            Err(_) => return Err("timeout reading ready message".to_string()),
        }
    }
}

/// Open the auth URL in the system browser
fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let command = "open";

    #[cfg(target_os = "linux")]
    let command = "xdg-open";

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        info!(
            "auto-open not supported on this platform, open manually: {}",
            url
        );
        return;
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        match std::process::Command::new(command).arg(url).spawn() {
            Ok(_) => info!("opened browser to {}", url),
            Err(e) => eprintln!("tugtool: warning: failed to open browser: {}", e),
        }
    }
}

/// Shutdown the child process gracefully with SIGTERM, then SIGKILL if needed
async fn shutdown_child(child: &mut tokio::process::Child) -> i32 {
    if let Some(pid) = child.id() {
        // Send SIGTERM to child for graceful shutdown
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }

        // Wait up to 3 seconds for graceful exit
        match timeout(Duration::from_secs(3), child.wait()).await {
            Ok(Ok(status)) => return status.code().unwrap_or(1),
            _ => {
                // Child did not exit in time, send SIGKILL
                info!("tugcast did not exit after SIGTERM, sending SIGKILL");
                unsafe {
                    libc::kill(pid as i32, libc::SIGKILL);
                }
                let _ = child.wait().await;
            }
        }
    }
    1
}

/// Shutdown multiple child processes gracefully
async fn shutdown_children(mut children: Vec<&mut tokio::process::Child>) {
    for child in children.iter_mut() {
        let _ = shutdown_child(child).await;
    }
}

/// Restart decision for the supervisor loop
#[derive(Debug, Clone, Copy, PartialEq)]
enum RestartDecision {
    Pending,
    Restart,
    RestartWithBackoff,
    DoNotRestart,
}

/// Supervisor loop that manages tugcast lifecycle via UDS control socket
async fn supervisor_loop(
    cli: &Cli,
    bun_child: &mut Option<tokio::process::Child>,
    dev_path: Option<PathBuf>,
) -> i32 {
    let mut sigint = signal(SignalKind::interrupt()).expect("failed to install SIGINT handler");
    let mut sigterm = signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
    let mut first_spawn = true;
    let mut backoff_secs: u64 = 0;

    // Create UDS listener once -- persists across child restarts
    let (listener, socket_path) = match create_control_listener(cli.port) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("tugtool: failed to create control socket: {}", e);
            return 1;
        }
    };

    loop {
        // Apply backoff delay if needed
        if backoff_secs > 0 {
            info!("waiting {}s before respawning...", backoff_secs);
            tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
        }

        // Spawn tugcast
        let mut tugcast = match spawn_tugcast(
            &cli.session,
            cli.port,
            &cli.dir,
            dev_path.as_deref(),
            &socket_path,
        ) {
            Ok(child) => child,
            Err(e) => {
                eprintln!("tugtool: failed to start tugcast: {}", e);
                let _ = std::fs::remove_file(&socket_path);
                return 1;
            }
        };

        let child_pid = tugcast.id();

        // Wait for ready message
        let (auth_url, mut reader, mut write_half) = match wait_for_ready(&listener).await {
            Ok(result) => result,
            Err(e) => {
                eprintln!("tugtool: {}", e);
                let status = tugcast.wait().await.ok();
                let code = status.and_then(|s| s.code()).unwrap_or(1);
                let _ = std::fs::remove_file(&socket_path);
                return code;
            }
        };

        // Reset backoff on successful ready
        backoff_secs = 0;

        if first_spawn {
            info!("auth URL: {}", auth_url);
            open_browser(&auth_url);
            first_spawn = false;
        }

        // Supervisor select loop: wait for UDS messages, process exit, or signals
        let mut decision = RestartDecision::Pending;
        let mut line = String::new();

        enum LoopOutcome {
            ProcessExited(i32),
            Eof,
        }

        let outcome = loop {
            tokio::select! {
                // Read UDS messages from child
                result = reader.read_line(&mut line) => {
                    match result {
                        Ok(0) => {
                            // EOF: child disconnected without shutdown message
                            if decision == RestartDecision::Pending {
                                info!("control socket EOF without shutdown message");
                                decision = RestartDecision::RestartWithBackoff;
                            }
                            break LoopOutcome::Eof;
                        }
                        Ok(_) => {
                            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                                if msg.get("type").and_then(|t| t.as_str()) == Some("shutdown") {
                                    if decision == RestartDecision::Pending {
                                        // Validate PID
                                        let msg_pid = msg.get("pid").and_then(|p| p.as_u64()).map(|p| p as u32);
                                        if msg_pid != child_pid {
                                            info!("ignoring shutdown from unknown pid {:?}", msg_pid);
                                            line.clear();
                                            continue;
                                        }
                                        let reason = msg.get("reason").and_then(|r| r.as_str()).unwrap_or("unknown");
                                        match reason {
                                            "restart" | "reset" => {
                                                info!("tugcast shutdown: reason={}, restarting", reason);
                                                decision = RestartDecision::Restart;
                                            }
                                            "error" => {
                                                info!("tugcast shutdown: reason=error");
                                                decision = RestartDecision::DoNotRestart;
                                            }
                                            _ => {
                                                info!("tugcast shutdown: reason={}", reason);
                                                decision = RestartDecision::DoNotRestart;
                                            }
                                        }
                                    }
                                }
                            }
                            line.clear();
                        }
                        Err(e) => {
                            info!("control socket read error: {}", e);
                            if decision == RestartDecision::Pending {
                                decision = RestartDecision::RestartWithBackoff;
                            }
                            break LoopOutcome::Eof;
                        }
                    }
                }
                // Wait for process exit
                status = tugcast.wait() => {
                    let code = match status {
                        Ok(s) => s.code().unwrap_or(1),
                        Err(e) => {
                            eprintln!("tugtool: error waiting for tugcast: {}", e);
                            1
                        }
                    };
                    // If no decision was set by UDS, treat as unexpected death
                    if decision == RestartDecision::Pending {
                        decision = RestartDecision::RestartWithBackoff;
                    }
                    break LoopOutcome::ProcessExited(code);
                }
                _ = sigint.recv() => {
                    info!("received SIGINT, shutting down");
                    // Send shutdown over UDS (best effort)
                    let _ = write_half.write_all(b"{\"type\":\"shutdown\"}\n").await;
                    let mut children = vec![&mut tugcast];
                    if let Some(bun) = bun_child {
                        children.push(bun);
                    }
                    shutdown_children(children).await;
                    let _ = std::fs::remove_file(&socket_path);
                    return 130;
                }
                _ = sigterm.recv() => {
                    info!("received SIGTERM, shutting down");
                    let _ = write_half.write_all(b"{\"type\":\"shutdown\"}\n").await;
                    let mut children = vec![&mut tugcast];
                    if let Some(bun) = bun_child {
                        children.push(bun);
                    }
                    shutdown_children(children).await;
                    let _ = std::fs::remove_file(&socket_path);
                    return 143;
                }
            }
        };

        // Handle outcome and get exit code
        let exit_code = match outcome {
            LoopOutcome::ProcessExited(code) => code,
            LoopOutcome::Eof => {
                // Wait for process to actually exit
                match timeout(Duration::from_secs(5), tugcast.wait()).await {
                    Ok(Ok(s)) => s.code().unwrap_or(1),
                    _ => {
                        shutdown_child(&mut tugcast).await;
                        1
                    }
                }
            }
        };

        // Apply restart decision
        match decision {
            RestartDecision::Restart => {
                info!("restarting tugcast (immediate)");
                continue;
            }
            RestartDecision::RestartWithBackoff => {
                backoff_secs = if backoff_secs == 0 {
                    1
                } else {
                    (backoff_secs * 2).min(30)
                };
                info!("restarting tugcast with {}s backoff", backoff_secs);
                continue;
            }
            RestartDecision::DoNotRestart | RestartDecision::Pending => {
                info!("tugcast exited with code {}, not restarting", exit_code);
                if let Some(bun) = bun_child {
                    shutdown_children(vec![bun]).await;
                }
                let _ = std::fs::remove_file(&socket_path);
                return exit_code;
            }
        }
    }
}

#[tokio::main]
async fn main() {
    // Initialize tracing with RUST_LOG support
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cli = Cli::parse();

    info!(
        session = %cli.session,
        port = cli.port,
        dir = ?cli.dir,
        dev = cli.dev,
        "tugtool starting"
    );

    let mut bun_child: Option<tokio::process::Child> = None;
    let dev_path: Option<PathBuf>;

    if cli.dev {
        // Check tmux is installed
        if !check_command_available("tmux").await {
            eprintln!(
                "tugtool: error: tmux is required but was not found in PATH. Install it with: brew install tmux"
            );
            std::process::exit(1);
        }

        // Resolve source tree
        let source_tree = if let Some(ref path) = cli.source_tree {
            path.clone()
        } else {
            match detect_source_tree() {
                Ok(path) => path,
                Err(e) => {
                    eprintln!("tugtool: error: {}", e);
                    std::process::exit(1);
                }
            }
        };

        // Validate source tree
        if !source_tree.join("tugdeck").is_dir() {
            eprintln!(
                "tugtool: error: No tugdeck/ directory found in {}. Is this the right source tree?",
                source_tree.display()
            );
            std::process::exit(1);
        }

        info!("source tree: {}", source_tree.display());

        // Set dev path
        dev_path = Some(source_tree.join("tugdeck/dist"));

        // Spawn bun dev
        match spawn_bun_dev(&source_tree).await {
            Ok(child) => {
                info!("bun dev started");
                bun_child = Some(child);
            }
            Err(e) => {
                eprintln!("tugtool: error: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        dev_path = None;
    }

    // Run supervisor loop
    let code = supervisor_loop(&cli, &mut bun_child, dev_path).await;
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_values() {
        let cli = Cli::try_parse_from(["tugtool"]).unwrap();
        assert_eq!(cli.session, "cc0");
        assert_eq!(cli.port, 7890);
        assert_eq!(cli.dir, PathBuf::from("."));
    }

    #[test]
    fn test_override_session() {
        let cli = Cli::try_parse_from(["tugtool", "--session", "mySession"]).unwrap();
        assert_eq!(cli.session, "mySession");
        assert_eq!(cli.port, 7890);
        assert_eq!(cli.dir, PathBuf::from("."));
    }

    #[test]
    fn test_override_port() {
        let cli = Cli::try_parse_from(["tugtool", "--port", "8080"]).unwrap();
        assert_eq!(cli.port, 8080);
        assert_eq!(cli.session, "cc0");
        assert_eq!(cli.dir, PathBuf::from("."));
    }

    #[test]
    fn test_override_dir() {
        let cli = Cli::try_parse_from(["tugtool", "--dir", "/tmp/test"]).unwrap();
        assert_eq!(cli.dir, PathBuf::from("/tmp/test"));
        assert_eq!(cli.session, "cc0");
        assert_eq!(cli.port, 7890);
    }

    #[test]
    fn test_all_overrides() {
        let cli = Cli::try_parse_from([
            "tugtool",
            "--session",
            "test",
            "--port",
            "9000",
            "--dir",
            "/workspace",
        ])
        .unwrap();
        assert_eq!(cli.session, "test");
        assert_eq!(cli.port, 9000);
        assert_eq!(cli.dir, PathBuf::from("/workspace"));
    }

    #[test]
    fn test_version_flag() {
        // --version should cause an early exit with version info
        let result = Cli::try_parse_from(["tugtool", "--version"]);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayVersion);
    }

    #[test]
    fn test_help_flag() {
        // --help should cause an early exit with help info
        let result = Cli::try_parse_from(["tugtool", "--help"]);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayHelp);
    }

    #[test]
    fn test_open_browser_compiles() {
        // Verify open_browser function exists and compiles on this platform.
        // We do NOT actually call it to avoid spawning a real browser in tests.
        let _fn_ptr: fn(&str) = open_browser;
    }

    #[test]
    fn test_cli_dev_flag() {
        let cli = Cli::try_parse_from(["tugtool"]).unwrap();
        assert!(!cli.dev);

        let cli = Cli::try_parse_from(["tugtool", "--dev"]).unwrap();
        assert!(cli.dev);
    }

    #[test]
    fn test_cli_source_tree_flag() {
        let cli = Cli::try_parse_from(["tugtool"]).unwrap();
        assert_eq!(cli.source_tree, None);

        let cli = Cli::try_parse_from(["tugtool", "--source-tree", "/path/to/repo"]).unwrap();
        assert_eq!(cli.source_tree, Some(PathBuf::from("/path/to/repo")));
    }

    #[test]
    fn test_detect_source_tree_validation() {
        use std::fs;
        use tempfile::TempDir;

        // Create a temp directory with a tugdeck/ subdirectory
        let temp_dir = TempDir::new().unwrap();
        let tugdeck_dir = temp_dir.path().join("tugdeck");
        fs::create_dir(&tugdeck_dir).unwrap();

        // Should find the temp_dir as the source tree
        let result = detect_source_tree_from(temp_dir.path());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), temp_dir.path());

        // Create a subdirectory and check it finds the parent
        let subdir = temp_dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        let result = detect_source_tree_from(&subdir);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), temp_dir.path());

        // Test failure case: directory without tugdeck/
        let temp_dir2 = TempDir::new().unwrap();
        let result = detect_source_tree_from(temp_dir2.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("could not find tugdeck/"));
    }
}
