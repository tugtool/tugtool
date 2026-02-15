use clap::Parser;
use std::path::PathBuf;

/// tugcast: WebSocket terminal bridge for tmux sessions
#[derive(Parser, Debug)]
#[command(name = "tugcast")]
#[command(about = "Attach to a tmux session and serve it over WebSocket", long_about = None)]
pub struct Cli {
    /// Tmux session name to attach to (created if it doesn't exist)
    #[arg(long, default_value = "cc0")]
    pub session: String,

    /// Port to bind the HTTP server to
    #[arg(long, default_value_t = 7890)]
    pub port: u16,

    /// Working directory for the tmux session
    #[arg(long, default_value = ".")]
    pub dir: PathBuf,

    /// Automatically open the browser after starting
    #[arg(long, default_value_t = false)]
    pub open: bool,
}

impl Cli {
    /// Parse CLI arguments from the environment
    pub fn parse() -> Self {
        <Self as Parser>::parse()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_values() {
        let cli = Cli::try_parse_from(["tugcast"]).unwrap();
        assert_eq!(cli.session, "cc0");
        assert_eq!(cli.port, 7890);
        assert_eq!(cli.dir, PathBuf::from("."));
        assert!(!cli.open);
    }

    #[test]
    fn test_override_session() {
        let cli = Cli::try_parse_from(["tugcast", "--session", "mySession"]).unwrap();
        assert_eq!(cli.session, "mySession");
        assert_eq!(cli.port, 7890);
    }

    #[test]
    fn test_override_port() {
        let cli = Cli::try_parse_from(["tugcast", "--port", "8080"]).unwrap();
        assert_eq!(cli.port, 8080);
        assert_eq!(cli.session, "cc0");
    }

    #[test]
    fn test_override_dir() {
        let cli = Cli::try_parse_from(["tugcast", "--dir", "/tmp/test"]).unwrap();
        assert_eq!(cli.dir, PathBuf::from("/tmp/test"));
    }

    #[test]
    fn test_open_flag() {
        let cli = Cli::try_parse_from(["tugcast", "--open"]).unwrap();
        assert!(cli.open);
    }

    #[test]
    fn test_all_overrides() {
        let cli = Cli::try_parse_from([
            "tugcast",
            "--session",
            "test",
            "--port",
            "9000",
            "--dir",
            "/workspace",
            "--open",
        ])
        .unwrap();
        assert_eq!(cli.session, "test");
        assert_eq!(cli.port, 9000);
        assert_eq!(cli.dir, PathBuf::from("/workspace"));
        assert!(cli.open);
    }
}
