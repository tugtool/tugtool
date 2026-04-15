use clap::Parser;
use std::path::PathBuf;

const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), " (", env!("TUG_COMMIT"), ")");

/// tugcast: WebSocket multiplexer — bridges multiple backends to tugdeck via binary-framed feeds
#[derive(Parser, Debug)]
#[command(name = "tugcast")]
#[command(version = VERSION)]
#[command(
    about = "WebSocket multiplexer serving terminal, code, filesystem, git, and stats feeds to tugdeck",
    long_about = "tugcast multiplexes multiple data feeds over a single WebSocket connection to\nthe tugdeck browser frontend. Feeds include: terminal I/O (via tmux), Claude Code\nevents (via tugcode bridge), filesystem watching, git status, system stats, and\ntugbank defaults. Each feed is identified by a FeedId byte in binary-framed messages.\n\nUsage:\n  tugcast                               Start with defaults (session: cc0, port: 55255)\n  tugcast --session dev --port 8080         Custom session and port\n  tugcast --source-tree /path/to/project    Watch a specific directory"
)]
pub struct Cli {
    /// Tmux session name to attach to (created if it doesn't exist)
    #[arg(long, default_value = "cc0")]
    pub session: String,

    /// Port to bind the HTTP server to
    #[arg(long, default_value_t = 55255)]
    pub port: u16,

    /// Workspace directory for the bootstrap file-tree/git feeds.
    /// Transitional: this flag will be removed in T3.4.c when the Tide
    /// card lands a real project picker at card-open time.
    #[arg(long, default_value = ".")]
    pub source_tree: PathBuf,

    /// Path to tugcode binary (overrides auto-detection)
    #[arg(long)]
    pub tugcode_path: Option<PathBuf>,

    /// Unix domain socket path for parent IPC
    #[arg(long)]
    pub control_socket: Option<PathBuf>,

    /// Path to the tugbank SQLite database (default: ~/.tugbank.db)
    #[arg(long)]
    pub bank_path: Option<PathBuf>,

    /// Skip authentication for development/testing. Allows any WebSocket
    /// connection without session cookies or origin checks. Do not use
    /// in production.
    #[arg(long)]
    pub no_auth: bool,

    /// Kill any existing tugcast process holding the TCP port before binding.
    /// Useful when a zombie tugcast is holding the port after a crash.
    #[arg(long)]
    pub force: bool,
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
        assert_eq!(cli.source_tree, PathBuf::from("."));
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
    fn test_override_source_tree() {
        let cli = Cli::try_parse_from(["tugcast", "--source-tree", "/tmp/test"]).unwrap();
        assert_eq!(cli.source_tree, PathBuf::from("/tmp/test"));
    }

    #[test]
    fn test_old_dir_flag_rejected() {
        // `--dir` was renamed to `--source-tree` in T3.0.W3.a. The old
        // flag name is not kept as an alias — clap rejects it outright.
        let result = Cli::try_parse_from(["tugcast", "--dir", "/tmp/test"]);
        assert!(
            result.is_err(),
            "--dir should no longer be a valid flag after the W3.a rename"
        );
    }

    #[test]
    fn test_all_overrides() {
        let cli = Cli::try_parse_from([
            "tugcast",
            "--session",
            "test",
            "--port",
            "9000",
            "--source-tree",
            "/workspace",
        ])
        .unwrap();
        assert_eq!(cli.session, "test");
        assert_eq!(cli.port, 9000);
        assert_eq!(cli.source_tree, PathBuf::from("/workspace"));
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
        assert!(
            help_text.contains("--source-tree"),
            "help should contain --source-tree"
        );
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
    fn test_tugcode_path_override() {
        let cli = Cli::try_parse_from(["tugcast", "--tugcode-path", "/custom/tugcode"]).unwrap();
        assert_eq!(cli.tugcode_path, Some(PathBuf::from("/custom/tugcode")));
    }

    #[test]
    fn test_default_tugcode_path_none() {
        let cli = Cli::try_parse_from(["tugcast"]).unwrap();
        assert_eq!(cli.tugcode_path, None);
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

    // T01: --bank-path absent defaults to None
    #[test]
    fn test_bank_path_default_none() {
        let cli = Cli::try_parse_from(["tugcast"]).unwrap();
        assert_eq!(cli.bank_path, None);
    }

    // T02: --bank-path present is parsed correctly
    #[test]
    fn test_bank_path_some() {
        let cli = Cli::try_parse_from(["tugcast", "--bank-path", "/tmp/test.db"]).unwrap();
        assert_eq!(cli.bank_path, Some(PathBuf::from("/tmp/test.db")));
    }

    // T03: --help output contains --bank-path
    #[test]
    fn test_help_contains_bank_path() {
        let result = Cli::try_parse_from(["tugcast", "--help"]);
        let err = result.unwrap_err();
        let help_text = err.to_string();
        assert!(
            help_text.contains("--bank-path"),
            "help should contain --bank-path"
        );
    }

    #[test]
    fn test_no_auth_default_false() {
        let cli = Cli::try_parse_from(["tugcast"]).unwrap();
        assert!(!cli.no_auth);
    }

    #[test]
    fn test_no_auth_flag() {
        let cli = Cli::try_parse_from(["tugcast", "--no-auth"]).unwrap();
        assert!(cli.no_auth);
    }

    #[test]
    fn test_help_contains_no_auth() {
        let result = Cli::try_parse_from(["tugcast", "--help"]);
        let err = result.unwrap_err();
        let help_text = err.to_string();
        assert!(
            help_text.contains("--no-auth"),
            "help should contain --no-auth"
        );
    }
}
