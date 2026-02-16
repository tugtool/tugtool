use clap::Parser;
use regex::Regex;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::LazyLock;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

static AUTH_URL_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"tugcast:\s+(http://\S+)").unwrap()
});

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

/// Spawn tugcast as a child process with stdout piped and stderr inherited
fn spawn_tugcast(
    session: &str,
    port: u16,
    dir: &std::path::Path,
) -> std::io::Result<tokio::process::Child> {
    Command::new("tugcast")
        .arg("--session")
        .arg(session)
        .arg("--port")
        .arg(port.to_string())
        .arg("--dir")
        .arg(dir.to_string_lossy().as_ref())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
}

/// Extract auth URL from tugcast's stdout by reading lines and checking against regex
async fn extract_auth_url(
    stdout: tokio::process::ChildStdout,
) -> Result<(String, BufReader<tokio::process::ChildStdout>), String> {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                // EOF before URL found
                return Err("tugcast exited before printing auth URL".to_string());
            }
            Ok(_) => {
                // Forward the line to stdout (including the URL line per D05)
                print!("{}", line);

                // Check if this line matches the auth URL pattern
                if let Some(caps) = AUTH_URL_REGEX.captures(&line) {
                    let url = caps.get(1).unwrap().as_str().to_string();
                    return Ok((url, reader));
                }
            }
            Err(e) => {
                return Err(format!("error reading tugcast output: {}", e));
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // Spawn tugcast child process
    let mut child = match spawn_tugcast(&cli.session, cli.port, &cli.dir) {
        Ok(child) => child,
        Err(e) => {
            eprintln!("tugcode: failed to start tugcast: {}", e);
            std::process::exit(1);
        }
    };

    // Take stdout for URL extraction (must happen before waiting)
    let stdout = child.stdout.take().expect("stdout was piped");

    // Extract auth URL from tugcast output
    match extract_auth_url(stdout).await {
        Ok((url, reader)) => {
            println!("tugcode: auth URL: {}", url);
            // Forward remaining stdout in background
            tokio::spawn(async move {
                let mut reader = reader;
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => print!("{}", line),
                    }
                }
            });
        }
        Err(e) => {
            eprintln!("tugcode: {}", e);
            // Wait for child and propagate exit code
            let status = child.wait().await.ok();
            let code = status.and_then(|s| s.code()).unwrap_or(1);
            std::process::exit(code);
        }
    }

    // For now, just wait for the child to exit (signal handling comes in step 2)
    let status = child.wait().await.expect("failed to wait on tugcast");
    let code = status.code().unwrap_or(1);
    std::process::exit(code);
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

    #[test]
    fn test_auth_url_regex_matches_standard_url() {
        let line = "tugcast: http://127.0.0.1:7890/auth?token=abc123def456";
        let caps = AUTH_URL_REGEX.captures(line);
        assert!(caps.is_some(), "regex should match standard auth URL line");
        let url = caps.unwrap().get(1).unwrap().as_str();
        assert_eq!(url, "http://127.0.0.1:7890/auth?token=abc123def456");
    }

    #[test]
    fn test_auth_url_regex_captures_full_url() {
        let line = "tugcast: http://127.0.0.1:8080/auth?token=deadbeef0123456789abcdef";
        let caps = AUTH_URL_REGEX.captures(line).unwrap();
        let url = caps.get(1).unwrap().as_str();
        assert_eq!(
            url,
            "http://127.0.0.1:8080/auth?token=deadbeef0123456789abcdef"
        );
    }

    #[test]
    fn test_auth_url_regex_does_not_match_log_lines() {
        assert!(AUTH_URL_REGEX.captures("INFO tugcast starting").is_none());
        assert!(AUTH_URL_REGEX
            .captures("2024-01-01 tugcast ready")
            .is_none());
        assert!(AUTH_URL_REGEX.captures("").is_none());
        assert!(AUTH_URL_REGEX.captures("some random text").is_none());
    }

    #[test]
    fn test_auth_url_regex_various_ports() {
        // Port 80
        let caps = AUTH_URL_REGEX
            .captures("tugcast: http://127.0.0.1:80/auth?token=abc")
            .unwrap();
        assert_eq!(
            caps.get(1).unwrap().as_str(),
            "http://127.0.0.1:80/auth?token=abc"
        );

        // Port 8080
        let caps = AUTH_URL_REGEX
            .captures("tugcast: http://127.0.0.1:8080/auth?token=abc")
            .unwrap();
        assert_eq!(
            caps.get(1).unwrap().as_str(),
            "http://127.0.0.1:8080/auth?token=abc"
        );

        // Port 7890 (default)
        let caps = AUTH_URL_REGEX
            .captures("tugcast: http://127.0.0.1:7890/auth?token=abc")
            .unwrap();
        assert_eq!(
            caps.get(1).unwrap().as_str(),
            "http://127.0.0.1:7890/auth?token=abc"
        );
    }
}
