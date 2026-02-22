use clap::Parser;
use std::path::PathBuf;

/// tugcast: WebSocket terminal bridge for tmux sessions
#[derive(Parser, Debug)]
#[command(name = "tugcast")]
#[command(version)]
#[command(
    about = "Attach to a tmux session and serve a live dashboard over WebSocket",
    long_about = "tugcast attaches to a tmux session and serves a live dashboard over WebSocket.\n\nIt provides real-time terminal output, filesystem events, git status, and system\nstats to the tugdeck browser frontend. Multiple data feeds run concurrently:\nterminal I/O, filesystem watching, git polling, and stats collection.\n\nUsage:\n  tugcast                        Start with defaults (session: cc0, port: 55255)\n  tugcast --session dev --port 8080  Custom session and port\n  tugcast --dir /path/to/project     Watch a specific directory"
)]
pub struct Cli {
    /// Tmux session name to attach to (created if it doesn't exist)
    #[arg(long, default_value = "cc0")]
    pub session: String,

    /// Port to bind the HTTP server to
    #[arg(long, default_value_t = 55255)]
    pub port: u16,

    /// Working directory for the tmux session
    #[arg(long, default_value = ".")]
    pub dir: PathBuf,

    /// Path to tugtalk binary (overrides auto-detection)
    #[arg(long)]
    pub tugtalk_path: Option<PathBuf>,

    /// Unix domain socket path for parent IPC
    #[arg(long)]
    pub control_socket: Option<PathBuf>,
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
        assert_eq!(cli.port, 55255);
        assert_eq!(cli.dir, PathBuf::from("."));
    }

    #[test]
    fn test_override_session() {
        let cli = Cli::try_parse_from(["tugcast", "--session", "mySession"]).unwrap();
        assert_eq!(cli.session, "mySession");
        assert_eq!(cli.port, 55255);
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
    fn test_all_overrides() {
        let cli = Cli::try_parse_from([
            "tugcast",
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
        let result = Cli::try_parse_from(["tugcast", "--version"]);
        // clap returns an Err with kind DisplayVersion for --version
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayVersion);
    }

    #[test]
    fn test_help_flag() {
        // --help should cause an early exit with help info
        let result = Cli::try_parse_from(["tugcast", "--help"]);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayHelp);
    }

    #[test]
    fn test_help_contains_flags() {
        // Verify help output contains expected flag names
        let result = Cli::try_parse_from(["tugcast", "--help"]);
        let err = result.unwrap_err();
        let help_text = err.to_string();
        assert!(
            help_text.contains("--session"),
            "help should contain --session"
        );
        assert!(help_text.contains("--port"), "help should contain --port");
        assert!(help_text.contains("--dir"), "help should contain --dir");
        assert!(
            help_text.contains("--version"),
            "help should contain --version"
        );
        assert!(
            help_text.contains("--control-socket"),
            "help should contain --control-socket"
        );
    }

    #[test]
    fn test_version_contains_version_string() {
        let result = Cli::try_parse_from(["tugcast", "--version"]);
        let err = result.unwrap_err();
        let version_text = err.to_string();
        // Should contain the package version from Cargo.toml
        assert!(
            version_text.contains(env!("CARGO_PKG_VERSION")),
            "version output should contain the package version"
        );
    }

    #[test]
    fn test_open_flag_rejected() {
        // --open flag was removed; verify it is no longer recognized
        let result = Cli::try_parse_from(["tugcast", "--open"]);
        assert!(result.is_err(), "--open should no longer be a valid flag");
    }

    #[test]
    fn test_tugtalk_path_override() {
        let cli = Cli::try_parse_from(["tugcast", "--tugtalk-path", "/custom/tugtalk"]).unwrap();
        assert_eq!(cli.tugtalk_path, Some(PathBuf::from("/custom/tugtalk")));
    }

    #[test]
    fn test_default_tugtalk_path_none() {
        let cli = Cli::try_parse_from(["tugcast"]).unwrap();
        assert_eq!(cli.tugtalk_path, None);
    }

    #[test]
    fn test_control_socket_flag_none() {
        let cli = Cli::try_parse_from(["tugcast"]).unwrap();
        assert_eq!(cli.control_socket, None);
    }

    #[test]
    fn test_control_socket_flag_some() {
        let cli = Cli::try_parse_from(["tugcast", "--control-socket", "/tmp/test.sock"]).unwrap();
        assert_eq!(cli.control_socket, Some(PathBuf::from("/tmp/test.sock")));
    }

    #[test]
    fn test_control_socket_with_other_flags() {
        let cli = Cli::try_parse_from([
            "tugcast",
            "--port",
            "8080",
            "--session",
            "dev",
            "--control-socket",
            "/tmp/ctl.sock",
        ])
        .unwrap();
        assert_eq!(cli.port, 8080);
        assert_eq!(cli.session, "dev");
        assert_eq!(cli.control_socket, Some(PathBuf::from("/tmp/ctl.sock")));
    }

    #[test]
    fn test_dev_flag_rejected() {
        // --dev flag was removed; verify it is no longer recognized
        let result = Cli::try_parse_from(["tugcast", "--dev", "/tmp"]);
        assert!(result.is_err(), "--dev should no longer be a valid flag");
    }
}
