mod auth;
mod cli;
mod feeds;
mod router;
mod server;

#[cfg(test)]
mod integration_tests;

use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use tugcast_core::StreamFeed;

use crate::auth::new_shared_auth_state;
use crate::feeds::terminal::{self, TerminalFeed};
use crate::router::{BROADCAST_CAPACITY, FeedRouter};

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
        open = cli.open,
        "tugcast starting"
    );

    // Verify tmux version
    match terminal::check_tmux_version().await {
        Ok(version) => info!("tmux version: {}", version),
        Err(e) => {
            error!("tmux check failed: {}", e);
            std::process::exit(1);
        }
    }

    // Ensure tmux session exists
    if let Err(e) = terminal::ensure_session(&cli.session).await {
        error!("Failed to ensure tmux session: {}", e);
        std::process::exit(1);
    }

    // Create auth state
    let auth = new_shared_auth_state(cli.port);

    // Print auth URL
    let token = auth.lock().unwrap().token().unwrap().to_string();
    let auth_url = format!("http://127.0.0.1:{}/auth?token={}", cli.port, token);
    info!("Auth URL: {}", auth_url);
    println!("\ntugcast: {}\n", auth_url);

    // Create broadcast channel for terminal output
    let (terminal_tx, _) = broadcast::channel(BROADCAST_CAPACITY);

    // Create terminal feed
    let feed = TerminalFeed::new(cli.session.clone());
    let input_tx = feed.input_sender();

    // Create feed router
    let feed_router = FeedRouter::new(
        terminal_tx.clone(),
        input_tx,
        cli.session.clone(),
        auth.clone(),
    );

    // Start terminal feed in background task
    let cancel = CancellationToken::new();
    let feed_cancel = cancel.clone();
    tokio::spawn(async move {
        feed.run(terminal_tx, feed_cancel).await;
    });

    // Open browser if --open flag
    if cli.open {
        server::open_browser(&auth_url);
    }

    // Start server (blocks until shutdown)
    if let Err(e) = server::run_server(cli.port, feed_router, auth).await {
        error!("Server error: {}", e);
        std::process::exit(1);
    }

    // Signal shutdown
    cancel.cancel();
    info!("tugcast shut down");
}
