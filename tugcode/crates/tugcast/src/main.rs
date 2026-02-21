mod actions;
mod auth;
mod cli;
mod control;
mod dev;
mod feeds;
mod router;
mod server;

#[cfg(test)]
mod integration_tests;

use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tracing::info;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use tugcast_core::{FeedId, Frame, SnapshotFeed, StreamFeed};

use crate::auth::new_shared_auth_state;
use crate::feeds::filesystem::FilesystemFeed;
use crate::feeds::git::GitFeed;
use crate::feeds::stats::{
    BuildStatusCollector, ProcessInfoCollector, StatsRunner, TokenUsageCollector,
};
use crate::feeds::terminal::{self, TerminalFeed};
use crate::router::{BROADCAST_CAPACITY, FeedRouter};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    // Initialize tracing with RUST_LOG support
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Parse CLI arguments
    let cli = cli::Cli::parse();

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

    // Create auth state
    let auth = new_shared_auth_state(cli.port);

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

    // Create conversation channels
    let (conversation_tx, _) =
        broadcast::channel(feeds::conversation::CONVERSATION_BROADCAST_CAPACITY);
    let (conversation_input_tx, conversation_input_rx) = mpsc::channel(256);
    let (conversation_watch_tx, conversation_watch_rx) =
        watch::channel(Frame::new(FeedId::ConversationOutput, vec![]));

    // Create terminal feed
    let feed = TerminalFeed::new(cli.session.clone());
    let input_tx = feed.input_sender();

    // Resolve watch directory to absolute path without resolving symlinks,
    // so that paths from notify match our prefix for strip_prefix filtering.
    let watch_dir = if cli.dir.is_absolute() {
        cli.dir.clone()
    } else {
        std::env::current_dir().unwrap_or_default().join(&cli.dir)
    };

    // Create filesystem feed and watch channel
    let (fs_watch_tx, fs_watch_rx) = watch::channel(Frame::new(FeedId::Filesystem, vec![]));
    let fs_feed = FilesystemFeed::new(watch_dir.clone());

    // Create git feed and watch channel
    let (git_watch_tx, git_watch_rx) = watch::channel(Frame::new(FeedId::Git, vec![]));
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
    let (stats_agg_tx, stats_agg_rx) = watch::channel(Frame::new(FeedId::Stats, vec![]));
    let (stats_proc_tx, stats_proc_rx) =
        watch::channel(Frame::new(FeedId::StatsProcessInfo, vec![]));
    let (stats_token_tx, stats_token_rx) =
        watch::channel(Frame::new(FeedId::StatsTokenUsage, vec![]));
    let (stats_build_tx, stats_build_rx) =
        watch::channel(Frame::new(FeedId::StatsBuildStatus, vec![]));

    // Create shutdown channel for control commands
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<u8>(1);

    // Create broadcast channel for client-bound Control frames
    let (client_action_tx, _) = broadcast::channel(BROADCAST_CAPACITY);

    // Load manifest and start dev file watcher if dev mode is active
    let (dev_state, reload_tx, _watcher) = if let Some(ref dev_path) = cli.dev {
        // Load manifest
        let state = match dev::load_manifest(dev_path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("tugcast: error: failed to load asset manifest: {}", e);
                std::process::exit(1);
            }
        };

        // Validate manifest (logs warnings)
        dev::validate_manifest(&state);

        // Derive watch directories
        let watch_dirs = dev::watch_dirs_from_manifest(&state);

        // Start file watcher
        match dev::dev_file_watcher(&watch_dirs) {
            Ok((tx, watcher)) => {
                info!(path = ?dev_path, "dev file watcher started");
                (Some(Arc::new(state)), Some(tx), Some(watcher))
            }
            Err(e) => {
                eprintln!("tugcast: error: failed to start dev file watcher: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        (None, None, None)
    };

    // Clone channel senders for control socket recv loop BEFORE FeedRouter takes ownership
    let ctl_shutdown_tx = shutdown_tx.clone();
    let ctl_client_action_tx = client_action_tx.clone();
    let ctl_reload_tx = reload_tx.clone();

    // Split control socket into reader and writer halves
    let mut control_writer: Option<control::ControlWriter> = None;
    let control_reader: Option<control::ControlReader> = if let Some(cs) = control_socket {
        let (writer, reader) = cs.split();
        control_writer = Some(writer);
        Some(reader)
    } else {
        None
    };

    // Create feed router with reload_tx wired
    let feed_router = FeedRouter::new(
        terminal_tx.clone(),
        input_tx,
        conversation_tx.clone(),
        conversation_input_tx,
        cli.session.clone(),
        auth.clone(),
        vec![
            fs_watch_rx,
            git_watch_rx,
            stats_agg_rx,
            stats_proc_rx,
            stats_token_rx,
            stats_build_rx,
            conversation_watch_rx,
        ],
        shutdown_tx,
        reload_tx.clone(),
        client_action_tx,
    );

    // Start terminal feed in background task
    let cancel = CancellationToken::new();
    let feed_cancel = cancel.clone();
    tokio::spawn(async move {
        feed.run(terminal_tx, feed_cancel).await;
    });

    // Resolve tugtalk path and start agent bridge (only if tugtalk exists)
    let tugtalk_path =
        feeds::agent_bridge::resolve_tugtalk_path(cli.tugtalk_path.as_deref(), &watch_dir);
    if tugtalk_path.exists() {
        let agent_cancel = cancel.clone();
        let agent_tx = conversation_tx.clone();
        let agent_watch_dir = watch_dir.clone();
        tokio::spawn(async move {
            feeds::agent_bridge::run_agent_bridge(
                agent_tx,
                conversation_watch_tx,
                conversation_input_rx,
                tugtalk_path,
                agent_watch_dir,
                agent_cancel,
            )
            .await;
        });
    } else {
        info!(
            "tugtalk not found at {}, conversation feed disabled",
            tugtalk_path.display()
        );
    }

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
            eprintln!("tugcast: error: failed to bind to 127.0.0.1:{}: {}", cli.port, e);
            std::process::exit(1);
        }
    };
    info!(port = cli.port, "tugcast server listening");

    // Send ready message over control socket
    if let Some(ref mut writer) = control_writer {
        if let Err(e) = writer.send_ready(&auth_url, cli.port, std::process::id()).await {
            eprintln!("tugcast: warning: failed to send ready message: {}", e);
            // Non-fatal: continue without control socket
        }
    }

    // Spawn control socket receive loop
    if let Some(reader) = control_reader {
        tokio::spawn(reader.run_recv_loop(ctl_shutdown_tx, ctl_client_action_tx, ctl_reload_tx));
    }

    // Start server and select! on shutdown channel
    let server_future = server::run_server(listener, feed_router, dev_state, reload_tx);

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
    };

    // Send shutdown message over control socket (best-effort)
    if let Some(ref mut writer) = control_writer {
        let reason = match exit_code {
            42 => "restart",
            43 => "reset",
            0 => "normal",
            _ => "error",
        };
        let _ = writer.send_shutdown(reason, std::process::id()).await;
    }

    // Signal shutdown for background tasks
    cancel.cancel();
    info!("tugcast shut down");
    std::process::exit(exit_code);
}
