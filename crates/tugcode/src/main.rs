use clap::Parser;
use std::path::PathBuf;

/// tugcode: Launcher binary for tugdeck dashboard
#[derive(Parser, Debug)]
#[command(name = "tugcode")]
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
}

impl Cli {
    /// Parse CLI arguments from the environment
    pub fn parse() -> Self {
        <Self as Parser>::parse()
    }
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    println!("tugcode starting with:");
    println!("  session: {}", cli.session);
    println!("  port: {}", cli.port);
    println!("  dir: {}", cli.dir.display());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_values() {
        let cli = Cli::try_parse_from(["tugcode"]).unwrap();
        assert_eq!(cli.session, "cc0");
        assert_eq!(cli.port, 7890);
        assert_eq!(cli.dir, PathBuf::from("."));
    }

    #[test]
    fn test_override_session() {
        let cli = Cli::try_parse_from(["tugcode", "--session", "mySession"]).unwrap();
        assert_eq!(cli.session, "mySession");
        assert_eq!(cli.port, 7890);
        assert_eq!(cli.dir, PathBuf::from("."));
    }

    #[test]
    fn test_override_port() {
        let cli = Cli::try_parse_from(["tugcode", "--port", "8080"]).unwrap();
        assert_eq!(cli.port, 8080);
        assert_eq!(cli.session, "cc0");
        assert_eq!(cli.dir, PathBuf::from("."));
    }

    #[test]
    fn test_override_dir() {
        let cli = Cli::try_parse_from(["tugcode", "--dir", "/tmp/test"]).unwrap();
        assert_eq!(cli.dir, PathBuf::from("/tmp/test"));
        assert_eq!(cli.session, "cc0");
        assert_eq!(cli.port, 7890);
    }

    #[test]
    fn test_all_overrides() {
        let cli = Cli::try_parse_from([
            "tugcode",
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
        let result = Cli::try_parse_from(["tugcode", "--version"]);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayVersion);
    }

    #[test]
    fn test_help_flag() {
        // --help should cause an early exit with help info
        let result = Cli::try_parse_from(["tugcode", "--help"]);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayHelp);
    }
}
