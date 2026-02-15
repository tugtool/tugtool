mod cli;
mod auth;
mod feeds;

use cli::Cli;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() {
    // Initialize tracing with RUST_LOG support
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Parse CLI arguments
    let cli = Cli::parse();

    info!(
        session = %cli.session,
        port = cli.port,
        dir = ?cli.dir,
        open = cli.open,
        "tugcast starting"
    );

    // TODO: Implementation in subsequent steps
    info!("tugcast initialized successfully");
}
