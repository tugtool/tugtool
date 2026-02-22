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

    // Create code channels
    let (code_tx, _) = broadcast::channel(feeds::code::CODE_BROADCAST_CAPACITY);
    let (code_input_tx, code_input_rx) = mpsc::channel(256);
    let (code_watch_tx, code_watch_rx) = watch::channel(Frame::new(FeedId::CodeOutput, vec![]));

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

    // Create shared dev state (empty until runtime dev_mode control message)
    let shared_dev_state = dev::new_shared_dev_state();

    // Clone channel senders for control socket recv loop BEFORE FeedRouter takes ownership
    let ctl_shutdown_tx = shutdown_tx.clone();
    let ctl_client_action_tx = client_action_tx.clone();

    // Split control socket into reader and writer halves
    let mut control_writer: Option<control::ControlWriter> = None;
    let control_reader: Option<control::ControlReader> = if let Some(cs) = control_socket {
        let (writer, reader) = cs.split();
        control_writer = Some(writer);
        Some(reader)
    } else {
        None
    };

    // Create feed router
    let feed_router = FeedRouter::new(
        terminal_tx.clone(),
        input_tx,
        code_tx.clone(),
        code_input_tx,
        cli.session.clone(),
        auth.clone(),
        vec![
            fs_watch_rx,
            git_watch_rx,
            stats_agg_rx,
            stats_proc_rx,
            stats_token_rx,
            stats_build_rx,
            code_watch_rx,
        ],
        shutdown_tx,
        client_action_tx,
    );

    // Start terminal feed in background task
    let cancel = CancellationToken::new();
    let feed_cancel = cancel.clone();
    tokio::spawn(async move {
        feed.run(terminal_tx, feed_cancel).await;
    });

    // Resolve tugtalk path and start agent bridge
    let tugtalk_path =
        feeds::agent_bridge::resolve_tugtalk_path(cli.tugtalk_path.as_deref(), &watch_dir);
    if !tugtalk_path.exists() {
        panic!(
            "tugtalk not found at {} — tugtalk is required for tugcast to run",
            tugtalk_path.display()
        );
    }
    let agent_cancel = cancel.clone();
    let agent_tx = code_tx.clone();
    let agent_watch_dir = watch_dir.clone();
    tokio::spawn(async move {
        feeds::agent_bridge::run_agent_bridge(
            agent_tx,
            code_watch_tx,
            code_input_rx,
            tugtalk_path,
            agent_watch_dir,
            agent_cancel,
        )
        .await;
    });

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
        let tx = response_tx
            .clone()
            .expect("response_tx must exist when control_reader exists");
        tokio::spawn(reader.run_recv_loop(ctl_shutdown_tx, ctl_client_action_tx, dev_state, tx));
    }

    // Start server and select! on shutdown channel
    let server_future = server::run_server(listener, feed_router, shared_dev_state);

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

    // Send shutdown message via response channel (draining task writes to socket)
    if let Some(tx) = response_tx {
        let reason = match exit_code {
            42 => "restart",
            43 => "reset",
            44 => "binary_updated",
            0 => "normal",
            _ => "error",
        };
        let shutdown_json = control::make_shutdown_message(reason, std::process::id());
        let _ = tx.send(shutdown_json).await;
        drop(tx); // Close channel -- draining task exits after writing
    }

    // Signal shutdown for background tasks
    cancel.cancel();
    info!("tugcast shut down");
    std::process::exit(exit_code);
}
