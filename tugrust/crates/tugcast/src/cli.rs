use clap::Parser;
use std::path::PathBuf;

const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), " (", env!("TUG_COMMIT"), ")");

/// Default tmux session name. When `TUG_INSTANCE_ID` is set, the
/// session is named `cc-<id>` so concurrent instances do not collide;
/// otherwise the legacy `cc0` default applies.
fn default_session() -> String {
    match tugcore::instance::instance_id() {
        Some(id) => format!("cc-{id}"),
        None => "cc0".to_owned(),
    }
}

/// tugcast: WebSocket multiplexer — bridges multiple backends to tugdeck via binary-framed feeds
#[derive(Parser, Debug)]
#[command(name = "tugcast")]
#[command(version = VERSION)]
#[command(
    about = "WebSocket multiplexer serving terminal, code, filesystem, git, and stats feeds to tugdeck",
    long_about = "tugcast multiplexes multiple data feeds over a single WebSocket connection to\nthe tugdeck browser frontend. Feeds include: terminal I/O (via tmux), Claude Code\nevents (via tugcode bridge), filesystem watching, git status, system stats, and\ntugbank defaults. Each feed is identified by a FeedId byte in binary-framed messages.\n\nUsage:\n  tugcast                               Start with defaults (session: cc-<TUG_INSTANCE_ID> or cc0, port: 55255)\n  tugcast --session dev --port 8080         Custom session and port\n  tugcast --source-tree /path/to/project    Watch a specific directory"
)]
pub struct Cli {
    /// Tmux session name to attach to (created if it doesn't exist).
    /// Default is `cc-<TUG_INSTANCE_ID>` when set, else `cc0`.
    #[arg(long, default_value_t = default_session())]
    pub session: String,

    /// Port to bind the HTTP server to. When omitted, the port is
    /// derived from the per-instance identifier via
    /// `tugcore::ports::tugcast_port_default` (window 55300–55399),
    /// walking forward on collision. Pass `0` to request an
    /// OS-ephemeral port.
    #[arg(long)]
    pub port: Option<u16>,

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
    use std::ffi::OsString;
    use std::sync::Mutex;

    /// `default_session()` reads `TUG_INSTANCE_ID` from the process env.
    /// Serialize tests that mutate it.
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    /// Verify the per-instance session default. Clap parsing itself is
    /// vendor code — we don't test that defaults parse or that --help
    /// works. We test the *one* piece of logic we own: the session
    /// name computed from TUG_INSTANCE_ID.
    #[test]
    fn session_default_unset_is_cc0() {
        let _lock = ENV_MUTEX.lock().unwrap_or_else(|p| p.into_inner());
        let prior = std::env::var_os("TUG_INSTANCE_ID");
        unsafe {
            std::env::remove_var("TUG_INSTANCE_ID");
        }
        // default_session() is the one piece of logic we own here;
        // clap parsing itself is vendor code.
        assert_eq!(default_session(), "cc0");
        unsafe {
            match prior {
                Some(v) => std::env::set_var("TUG_INSTANCE_ID", v),
                None => std::env::remove_var("TUG_INSTANCE_ID"),
            }
        }
        let _: Option<OsString> = std::env::var_os("TUG_INSTANCE_ID");
    }

    #[test]
    fn session_default_with_instance_id_is_cc_id() {
        let _lock = ENV_MUTEX.lock().unwrap_or_else(|p| p.into_inner());
        let prior = std::env::var_os("TUG_INSTANCE_ID");
        unsafe {
            std::env::set_var("TUG_INSTANCE_ID", "development-foo");
        }
        assert_eq!(default_session(), "cc-development-foo");
        unsafe {
            match prior {
                Some(v) => std::env::set_var("TUG_INSTANCE_ID", v),
                None => std::env::remove_var("TUG_INSTANCE_ID"),
            }
        }
        let _: Option<OsString> = std::env::var_os("TUG_INSTANCE_ID");
    }
}
