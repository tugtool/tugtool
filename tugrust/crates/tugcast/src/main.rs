mod actions;
mod auth;
mod cli;
mod control;
mod defaults;
mod dev;
mod feeds;
mod migration;
mod router;
mod server;

#[cfg(test)]
mod integration_tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use tugbank_core::TugbankClient;
use tugbank_core::notify as tugbank_notify;
use tugcast_core::{FeedId, Frame, SnapshotFeed, StreamFeed};

use crate::auth::new_shared_auth_state;
use crate::feeds::filesystem::FilesystemFeed;
use crate::feeds::git::GitFeed;
use crate::feeds::stats::{
    BuildStatusCollector, ProcessInfoCollector, StatsRunner, TokenUsageCollector,
};
use crate::feeds::terminal::{self, TerminalFeed};
use crate::router::{BROADCAST_CAPACITY, FeedRouter};

#[tokio::main]
async fn main() {
    // Initialize tracing with RUST_LOG support
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Create own process group so the app can kill tugcast + all children
    // (tugcode, bun) with a single kill(-pgid, SIGTERM). Without this,
    // children become orphans when the app force-kills tugcast.
    unsafe {
        libc::setpgid(0, 0);
    }

    // Parse CLI arguments
    let cli = cli::Cli::parse();

    // --force: kill any existing process holding the TCP port before we try to bind.
    if cli.force {
        force_kill_port_holder(cli.port);
    }

    // Resolve bank path: use --bank-path if provided, otherwise default to ~/.tugbank.db
    let bank_path: PathBuf = cli.bank_path.clone().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()))
            .join(".tugbank.db")
    });

    info!(
        session = %cli.session,
        port = cli.port,
        dir = ?cli.dir,
        "tugcast starting"
    );

    // Verify tmux version
    match terminal::check_tmux_version().await {
        Ok(version) => info!("tmux version: {}", version),
        Err(e) => {
            eprintln!(
                "tugcast: error: tmux not found or version too old (requires 3.x+): {}",
                e
            );
            std::process::exit(1);
        }
    }

    // Ensure tmux session exists
    if let Err(e) = terminal::ensure_session(&cli.session).await {
        eprintln!(
            "tugcast: error: failed to create tmux session '{}': {}",
            cli.session, e
        );
        std::process::exit(1);
    }

    // Create auth state. With --no-auth, the token exchange and cookie still
    // work normally (so the app loads fine), but WebSocket validation is skipped
    // so external tools can connect without a session cookie.
    let auth = if cli.no_auth {
        auth::new_shared_auth_state_no_auth(cli.port)
    } else {
        new_shared_auth_state(cli.port)
    };

    let token = auth.lock().unwrap().token().unwrap().to_string();
    let auth_url = format!("http://127.0.0.1:{}/auth?token={}", cli.port, token);
    info!("Auth URL: {}", auth_url);

    // Connect to control socket if specified
    let control_socket = if let Some(ref path) = cli.control_socket {
        match control::ControlSocket::connect(path).await {
            Ok(cs) => Some(cs),
            Err(e) => {
                eprintln!("tugcast: error: failed to connect to control socket: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    // Create broadcast channel for terminal output
    let (terminal_tx, _) = broadcast::channel(BROADCAST_CAPACITY);

    // Create code channels
    let (code_tx, _) = broadcast::channel(feeds::code::CODE_BROADCAST_CAPACITY);
    let (code_input_tx, code_input_rx) = mpsc::channel(256);

    // Create terminal feed
    let feed = TerminalFeed::new(cli.session.clone());
    let input_tx = feed.input_sender();

    // Resolve watch directory: make absolute, then resolve symlinks so that
    // paths from FSEvents match our prefix for strip_prefix filtering.
    let watch_dir = if cli.dir.is_absolute() {
        cli.dir.clone()
    } else {
        std::env::current_dir().unwrap_or_default().join(&cli.dir)
    };
    let watch_dir = dev::resolve_symlinks(&watch_dir).unwrap_or(watch_dir);

    // Open the TugbankClient. On success, wrap in Arc for shared ownership between
    // migration, the defaults feed, and the HTTP server. On failure, log a warning
    // and continue without tugbank -- this preserves graceful degradation when the
    // bank path is inaccessible.
    let bank_client: Option<Arc<TugbankClient>> = match TugbankClient::open(&bank_path) {
        Ok(client) => Some(Arc::new(client)),
        Err(e) => {
            warn!(
                path = %bank_path.display(),
                error = %e,
                "failed to open TugbankClient — defaults endpoints and feed disabled"
            );
            None
        }
    };

    // Run the one-time flat-file-to-tugbank migration synchronously, before the
    // TCP listener binds, so no frontend fetch can race the migration writes [D05].
    if let Some(ref client) = bank_client {
        if let Err(e) = migration::migrate_settings_to_tugbank(&watch_dir, client) {
            warn!(error = %e, "settings migration encountered an error (non-fatal)");
        }
    }

    let notify_socket_path = tugbank_notify::socket_path();

    // Create DEFAULTS feed from the TugbankClient.
    let defaults_rx: Option<tokio::sync::watch::Receiver<Frame>> = bank_client
        .as_ref()
        .map(|client| feeds::defaults::defaults_feed(Arc::clone(client)));

    // Create filesystem feed and watch channel
    let (fs_watch_tx, fs_watch_rx) = watch::channel(Frame::new(FeedId::FILESYSTEM, vec![]));
    let fs_feed = FilesystemFeed::new(watch_dir.clone());

    // Create git feed and watch channel
    let (git_watch_tx, git_watch_rx) = watch::channel(Frame::new(FeedId::GIT, vec![]));
    let git_feed = GitFeed::new(watch_dir.clone());

    // Create stats collectors
    let process_info =
        Arc::new(ProcessInfoCollector::new()) as Arc<dyn crate::feeds::stats::StatCollector>;
    let token_usage = Arc::new(TokenUsageCollector::new(cli.session.clone()))
        as Arc<dyn crate::feeds::stats::StatCollector>;
    let target_dir = watch_dir.join("target");
    let build_status = Arc::new(BuildStatusCollector::new(target_dir))
        as Arc<dyn crate::feeds::stats::StatCollector>;

    // Create watch channels for stats feeds
    let (stats_agg_tx, stats_agg_rx) = watch::channel(Frame::new(FeedId::STATS, vec![]));
    let (stats_proc_tx, stats_proc_rx) =
        watch::channel(Frame::new(FeedId::STATS_PROCESS_INFO, vec![]));
    let (stats_token_tx, stats_token_rx) =
        watch::channel(Frame::new(FeedId::STATS_TOKEN_USAGE, vec![]));
    let (stats_build_tx, stats_build_rx) =
        watch::channel(Frame::new(FeedId::STATS_BUILD_STATUS, vec![]));

    // Create shutdown channel for control commands
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<u8>(1);

    // Create broadcast channel for client-bound Control frames
    let (client_action_tx, _) = broadcast::channel(BROADCAST_CAPACITY);

    // Create shared dev state (empty until runtime dev_mode control message)
    let shared_dev_state = dev::new_shared_dev_state();

    // Clone shutdown sender for control socket recv loop
    let ctl_shutdown_tx = shutdown_tx.clone();

    // Split control socket into reader and writer halves
    let mut control_writer: Option<control::ControlWriter> = None;
    let control_reader: Option<control::ControlReader> = if let Some(cs) = control_socket {
        let (writer, reader) = cs.split();
        control_writer = Some(writer);
        Some(reader)
    } else {
        None
    };

    // Start terminal feed in background task
    let cancel = CancellationToken::new();
    let feed_cancel = cancel.clone();
    let terminal_tx_for_router = terminal_tx.clone();
    tokio::spawn(async move {
        feed.run(terminal_tx, feed_cancel).await;
    });

    // Start the tugbank notification socket listener.
    // Receives domain-change datagrams and calls refresh_domain() with debounce.
    if let Some(ref client) = bank_client {
        let notify_client = Arc::clone(client);
        let notify_cancel = cancel.clone();
        let notify_path = notify_socket_path.clone();
        tokio::spawn(async move {
            run_notify_listener(notify_path, notify_client, notify_cancel).await;
        });
    }

    // Create replay buffer for CodeOutput lag recovery (P4)
    use crate::router::{LagPolicy, ReplayBuffer};
    let code_replay = ReplayBuffer::new(1000);

    // Resolve tugcode path and start agent bridge
    let tugcode_path =
        feeds::agent_bridge::resolve_tugcode_path(cli.tugcode_path.as_deref(), &watch_dir);
    if !tugcode_path.exists() {
        panic!(
            "tugcode not found at {} — tugcode is required for tugcast to run",
            tugcode_path.display()
        );
    }
    let agent_cancel = cancel.clone();
    let agent_watch_dir = watch_dir.clone();
    let agent_handles = feeds::agent_bridge::spawn_agent_bridge(
        code_tx.clone(),
        code_input_rx,
        tugcode_path,
        agent_watch_dir,
        agent_cancel,
        code_replay.clone(),
    );

    // Build feed router with dynamic registration
    let mut feed_router = FeedRouter::new(
        cli.session.clone(),
        auth.clone(),
        shutdown_tx,
        shared_dev_state.clone(),
    );

    // Register stream outputs (broadcast feeds, server → client)
    feed_router.register_stream(
        FeedId::TERMINAL_OUTPUT,
        terminal_tx_for_router,
        LagPolicy::Bootstrap,
    );
    feed_router.register_stream(
        FeedId::CODE_OUTPUT,
        code_tx.clone(),
        LagPolicy::Replay(code_replay),
    );
    feed_router.register_stream(FeedId::CONTROL, client_action_tx, LagPolicy::Warn);

    // Register input sinks (client → server backends)
    feed_router.register_input(FeedId::TERMINAL_INPUT, input_tx.clone());
    feed_router.register_input(FeedId::TERMINAL_RESIZE, input_tx);
    feed_router.register_input(FeedId::CODE_INPUT, code_input_tx);

    // Register snapshot watches
    let mut snapshot_watches = vec![
        fs_watch_rx,
        git_watch_rx,
        stats_agg_rx,
        stats_proc_rx,
        stats_token_rx,
        stats_build_rx,
    ];
    if let Some(rx) = defaults_rx {
        snapshot_watches.push(rx);
    }
    snapshot_watches.extend(agent_handles.snapshot_watches);
    feed_router.add_snapshot_watches(snapshot_watches);

    // Start filesystem feed in background task
    let fs_cancel = cancel.clone();
    tokio::spawn(async move {
        fs_feed.run(fs_watch_tx, fs_cancel).await;
    });

    // Start git feed in background task
    let git_cancel = cancel.clone();
    tokio::spawn(async move {
        git_feed.run(git_watch_tx, git_cancel).await;
    });

    // Start stats feeds in background task
    let stats_cancel = cancel.clone();
    let stats_runner = StatsRunner::new(vec![process_info, token_usage, build_status]);
    tokio::spawn(async move {
        stats_runner
            .run(
                stats_agg_tx,
                vec![stats_proc_tx, stats_token_tx, stats_build_tx],
                stats_cancel,
            )
            .await;
    });

    // Bind TCP listener
    let listener = match TcpListener::bind(format!("127.0.0.1:{}", cli.port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "tugcast: error: failed to bind to 127.0.0.1:{}: {}",
                cli.port, e
            );
            std::process::exit(1);
        }
    };
    info!(port = cli.port, "tugcast server listening");

    // Send ready message over control socket
    if let Some(ref mut writer) = control_writer {
        if let Err(e) = writer
            .send_ready(&auth_url, cli.port, std::process::id())
            .await
        {
            eprintln!("tugcast: warning: failed to send ready message: {}", e);
            // Non-fatal: continue without control socket
        }
    }

    // Create response channel and draining task for control socket writes
    let response_tx = if let Some(writer) = control_writer.take() {
        let (tx, mut rx) = mpsc::channel::<String>(4);
        let mut raw_writer = writer.into_inner();

        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            while let Some(msg) = rx.recv().await {
                let _ = raw_writer.write_all(msg.as_bytes()).await;
                let _ = raw_writer.write_all(b"\n").await;
                let _ = raw_writer.flush().await;
            }
            // Channel closed -- task exits
        });

        Some(tx)
    } else {
        None
    };

    // Spawn control socket receive loop
    if let Some(reader) = control_reader {
        let dev_state = shared_dev_state.clone();
        let ctl_stream_outputs = feed_router.stream_outputs.clone();
        let tx = response_tx
            .clone()
            .expect("response_tx must exist when control_reader exists");
        let ctl_pending_evals = feed_router.pending_evals.clone();
        tokio::spawn(reader.run_recv_loop(
            ctl_shutdown_tx,
            ctl_stream_outputs,
            dev_state,
            tx,
            auth.clone(),
            ctl_pending_evals,
        ));
    }

    // Start server and select! on shutdown channel + SIGTERM
    let server_future = server::run_server(
        listener,
        feed_router,
        shared_dev_state,
        Some(watch_dir),
        bank_client,
    );

    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("failed to register SIGTERM handler");

    // Watch for parent death (e.g. kill -9 on Tug.app). When our parent PID
    // changes to 1 (launchd/init), the parent is gone and we should exit.
    let parent_pid = unsafe { libc::getppid() };
    let parent_watch = async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let current_ppid = unsafe { libc::getppid() };
            if current_ppid != parent_pid {
                info!(
                    "Parent died (ppid {} → {}), shutting down",
                    parent_pid, current_ppid
                );
                break;
            }
        }
    };

    let exit_code = tokio::select! {
        result = server_future => {
            if let Err(e) = result {
                eprintln!("tugcast: error: server error: {}", e);
                1
            } else {
                0
            }
        }
        Some(code) = shutdown_rx.recv() => {
            info!("shutdown requested with exit code {}", code);
            code as i32
        }
        _ = sigterm.recv() => {
            info!("SIGTERM received, shutting down");
            0
        }
        _ = parent_watch => {
            0
        }
    };

    // Send shutdown message via response channel (draining task writes to socket)
    if let Some(tx) = response_tx {
        let reason = shutdown_reason_for_exit_code(exit_code);
        let shutdown_json = control::make_shutdown_message(reason, std::process::id());
        let _ = tx.send(shutdown_json).await;
        drop(tx); // Close channel -- draining task exits after writing
    }

    // Clean up the notification socket before shutting down tasks.
    if let Err(e) = std::fs::remove_file(&notify_socket_path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            warn!(error = %e, "failed to remove notification socket");
        }
    }

    // Signal shutdown for background tasks
    cancel.cancel();

    // Kill our entire process group (tugcast + tugcode + children).
    // std::process::exit doesn't run destructors, so kill_on_drop and
    // async cancellation can't be relied upon. Sending SIGTERM to our
    // own process group is the only reliable way to clean up children.
    info!("Killing process group before exit");
    unsafe {
        libc::kill(0, libc::SIGTERM);
    }

    info!("tugcast shut down");
    std::process::exit(exit_code);
}

/// Run the tugbank notification socket listener.
///
/// Binds a Unix datagram socket at `path`, receives domain names as datagrams,
/// and calls `client.refresh_domain()` with 50ms per-domain debounce.
async fn run_notify_listener(path: PathBuf, client: Arc<TugbankClient>, cancel: CancellationToken) {
    // Remove stale socket from a previous run.
    let _ = std::fs::remove_file(&path);

    // Bind the socket (std UnixDatagram, then wrap for tokio).
    let std_sock = match std::os::unix::net::UnixDatagram::bind(&path) {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, path = %path.display(), "failed to bind notification socket");
            return;
        }
    };
    std_sock.set_nonblocking(true).unwrap();
    let sock = match tokio::net::UnixDatagram::from_std(std_sock) {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, "failed to convert notification socket to tokio");
            return;
        }
    };

    info!(path = %path.display(), "tugbank notification socket listening");

    let mut buf = [0u8; 512];
    let debounce_ms = Duration::from_millis(50);
    let mut pending: HashMap<String, tokio::time::Instant> = HashMap::new();

    loop {
        // Wait for the next datagram or a debounce timer to fire.
        let next_deadline = pending.values().copied().min();

        tokio::select! {
            _ = cancel.cancelled() => {
                info!("notification listener shutting down");
                break;
            }
            result = sock.recv(&mut buf) => {
                match result {
                    Ok(n) => {
                        if let Ok(domain) = std::str::from_utf8(&buf[..n]) {
                            let domain = domain.to_owned();
                            // Reset the debounce timer for this domain.
                            pending.insert(domain, tokio::time::Instant::now() + debounce_ms);
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "notification socket recv error");
                    }
                }
            }
            _ = async {
                match next_deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                // At least one debounce timer has fired. Drain all ready domains.
            }
        }

        // Drain any domains whose debounce timer has expired.
        let now = tokio::time::Instant::now();
        let ready: Vec<String> = pending
            .iter()
            .filter(|(_, deadline)| **deadline <= now)
            .map(|(domain, _)| domain.clone())
            .collect();
        for domain in ready {
            pending.remove(&domain);
            info!(domain = %domain, "tugbank domain changed — refreshing");
            client.refresh_domain(&domain);
        }
    }
}

/// Kill any process currently holding the TCP port.
///
/// Uses lsof to find the PID, then sends SIGKILL. Waits briefly for
/// the port to become available.
fn force_kill_port_holder(port: u16) {
    let output = std::process::Command::new("lsof")
        .args(["-ti", &format!("tcp:{}", port)])
        .output();

    let pids = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return, // No process holding the port, or lsof not available.
    };

    for pid_str in pids.lines() {
        if let Ok(pid) = pid_str.trim().parse::<i32>() {
            eprintln!(
                "tugcast: --force: killing PID {} holding port {}",
                pid, port
            );
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
    }

    // Brief wait for the port to be released.
    std::thread::sleep(Duration::from_millis(100));
}

/// Map exit code to shutdown reason string
fn shutdown_reason_for_exit_code(code: i32) -> &'static str {
    match code {
        0 => "normal",
        42 => "restart",
        43 => "reset",
        45 => "relaunch",
        _ => "error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shutdown_reason_for_exit_code_normal() {
        assert_eq!(shutdown_reason_for_exit_code(0), "normal");
    }

    #[test]
    fn test_shutdown_reason_for_exit_code_restart() {
        assert_eq!(shutdown_reason_for_exit_code(42), "restart");
    }

    #[test]
    fn test_shutdown_reason_for_exit_code_reset() {
        assert_eq!(shutdown_reason_for_exit_code(43), "reset");
    }

    #[test]
    fn test_shutdown_reason_for_exit_code_relaunch() {
        assert_eq!(shutdown_reason_for_exit_code(45), "relaunch");
    }

    #[test]
    fn test_shutdown_reason_for_exit_code_error() {
        assert_eq!(shutdown_reason_for_exit_code(1), "error");
        assert_eq!(shutdown_reason_for_exit_code(-1), "error");
        assert_eq!(shutdown_reason_for_exit_code(99), "error");
    }
}
