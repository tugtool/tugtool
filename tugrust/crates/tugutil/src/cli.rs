//! CLI argument parsing for the unified `tugutil` binary.
//!
//! One command tree over three surfaces: the top-level git verbs
//! (`changes`/`context`/`commit`/`log`/`diff`, backed by `tugmark_core`), the
//! `dash` namespace (worktree work units, backed by `tugdash_core`), and the
//! `host` namespace (instance/gate/state-dir/tell/init plumbing).

use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};

use tugdash_core::JoinStrategy;

use crate::commands::{GateCommands, InstanceCommands};

const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), " (", env!("TUG_COMMIT"), ")");

/// tugutil — the unified Tug developer CLI.
#[derive(Parser)]
#[command(name = "tugutil")]
#[command(version = VERSION)]
#[command(about = "tugutil — changes & commits, dashes, and host plumbing")]
#[command(
    long_about = "tugutil — the unified Tug developer CLI.\n\nTop-level verbs own this session's git surface: changes (which files this\nsession changed), context (one-shot commit context), commit (stage → commit →\nstructured receipt), log, and diff. `tugutil dash …` drives worktree-isolated work\nunits; `tugutil host …` is instance/project plumbing (instance, gate, state-dir,\ntell, init)."
)]
pub struct Cli {
    /// Increase output verbosity
    #[arg(short, long, global = true)]
    pub verbose: bool,

    /// Suppress non-error output (no effect on `--json`)
    #[arg(short, long, global = true)]
    pub quiet: bool,

    /// Emit machine-readable JSON
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Which files this session changed (ledger ∩ git status).
    Changes {
        /// Session id (default: $TUG_SESSION_ID).
        #[arg(long)]
        session: Option<String>,
        /// Project dir (default: cwd).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Keep committed/reverted files too.
        #[arg(long)]
        all: bool,
        /// Attach each file's unified diff.
        #[arg(long)]
        diff: bool,
    },
    /// One-shot commit context: changed files (with diff), branch/head, recent commits.
    Context {
        /// Session id (default: $TUG_SESSION_ID).
        #[arg(long)]
        session: Option<String>,
        /// Project dir (default: cwd).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Recent-commit depth.
        #[arg(long, default_value_t = 10)]
        log_limit: u32,
    },
    /// Stage the session's changed files, commit, and print a structured receipt.
    Commit {
        /// Git commit message (subject, optional body).
        #[arg(long)]
        message: String,
        /// Session id (default: $TUG_SESSION_ID).
        #[arg(long)]
        session: Option<String>,
        /// Project dir (default: cwd).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Explicit file set (overrides the session's changed files).
        #[arg(long, num_args = 1..)]
        paths: Vec<String>,
        /// Include ambiguous files.
        #[arg(long)]
        all: bool,
    },
    /// Recent commits, or a range's commits.
    Log {
        /// Number of commits (default 10).
        #[arg(long)]
        limit: Option<u32>,
        /// Two-dot range `a..b`.
        #[arg(long)]
        range: Option<String>,
    },
    /// Per-file diff stats for the working tree, the index, a range, or the session.
    Diff {
        /// Two-dot range `a..b`.
        #[arg(long)]
        range: Option<String>,
        /// Diff the index instead of the working tree.
        #[arg(long)]
        staged: bool,
        /// Narrow to the session's changed files (default session: $TUG_SESSION_ID).
        #[arg(long)]
        session: bool,
        /// Project dir (default: cwd).
        #[arg(long)]
        project: Option<PathBuf>,
    },

    /// Worktree-isolated work units (create/commit/join/release/list/show).
    #[command(subcommand)]
    Dash(DashCommands),

    /// Instance discovery, the build gate, project state, and the tell bridge.
    #[command(subcommand)]
    Host(HostCommands),
}

/// Clap-facing mirror of {@link JoinStrategy}.
#[derive(Copy, Clone, Debug, ValueEnum)]
pub enum CliStrategy {
    Squash,
    Merge,
    Rebase,
}

impl From<CliStrategy> for JoinStrategy {
    fn from(s: CliStrategy) -> Self {
        match s {
            CliStrategy::Squash => JoinStrategy::Squash,
            CliStrategy::Merge => JoinStrategy::Merge,
            CliStrategy::Rebase => JoinStrategy::Rebase,
        }
    }
}

#[derive(Subcommand)]
pub enum DashCommands {
    /// Create a new dash (branch + worktree, hydrated via the post_create hook).
    Create {
        /// Dash name (lowercase letters, digits, hyphens; 2+ chars).
        name: String,
        /// Description of the work.
        #[arg(long)]
        description: Option<String>,
    },
    /// Commit the dash worktree (if dirty) and append a dash-log line.
    ///
    /// Reads round metadata (instruction/summary) from stdin as JSON.
    Commit {
        /// Dash name.
        name: String,
        /// Git commit message (the conventional-commit subject).
        #[arg(long)]
        message: String,
    },
    /// Join a dash into its base branch, then tear down ([P14]).
    Join {
        /// Dash name.
        name: String,
        /// Custom commit message (default: the maintained draft, else the
        /// dash description).
        #[arg(long)]
        message: Option<String>,
        /// Integration strategy.
        #[arg(long, value_enum, default_value_t = CliStrategy::Squash)]
        strategy: CliStrategy,
        /// Report conflicts in-memory (git merge-tree) without touching anything.
        #[arg(long)]
        preview: bool,
        /// Resume an interrupted join's teardown from the journal.
        #[arg(long = "continue")]
        continue_join: bool,
        /// Run the conflict resolution ladder ([P31]) — replay probe, rerere,
        /// re-merge, and a structured-merge driver — then land the result.
        #[arg(long)]
        resolve: bool,
    },
    /// Release a dash: discard its worktree + branch without merging.
    Release {
        /// Dash name.
        name: String,
    },
    /// List every active dash, derived from git.
    List,
    /// Show one dash's metadata, rounds, and worktree dirt.
    Show {
        /// Dash name.
        name: String,
    },
}

#[derive(Subcommand)]
pub enum HostCommands {
    /// Initialize a tugutil project in current directory
    ///
    /// Creates .tugtool/ directory with skeleton template and config.
    /// Idempotent: safe to run multiple times (creates only missing files).
    #[command(
        long_about = "Initialize a tugutil project in current directory.\n\nCreates:\n  .tugtool/config.toml  Project configuration (dash hydration hook)\n\nIdempotent: if .tugtool/ already exists, creates only missing files without overwriting.\nWith --force, removes and recreates everything.\nWith --check, performs a lightweight verification of initialization status without side effects."
    )]
    Init {
        /// Overwrite existing .tug directory
        #[arg(long, conflicts_with = "check")]
        force: bool,

        /// Check if project is initialized (no side effects)
        #[arg(long, conflicts_with = "force")]
        check: bool,
    },

    /// Send an action to tugcast via HTTP POST
    ///
    /// Posts a JSON action to the tugcast /api/tell endpoint.
    #[command(
        long_about = "Send an action to tugcast via HTTP POST.\n\nPosts a JSON body to http://127.0.0.1:<port>/api/tell.\nThe body contains {\"action\": \"<ACTION>\", ...params}.\n\nParameters are specified with -p KEY=VALUE (repeatable).\nValues are auto-coerced: true/false -> bool, null -> null,\nintegers -> number, floats -> number, everything else -> string.\n\nExamples:\n  tugutil host tell restart\n  tugutil host tell show-card -p component=about\n  tugutil host tell set-maker-mode -p enabled=true"
    )]
    Tell {
        /// Action name (e.g., reload, show-card, set-maker-mode)
        action: String,

        /// Tugcast server port (overrides --instance and CLI discovery).
        #[arg(long)]
        port: Option<u16>,

        /// Target a specific instance by ID (resolves to its
        /// registered port via $TMPDIR/tug-instances.json).
        #[arg(long, value_name = "ID")]
        instance: Option<String>,

        /// Parameters as KEY=VALUE pairs (repeatable)
        #[arg(short = 'p', long = "param", value_name = "KEY=VALUE")]
        param: Vec<String>,
    },

    /// Per-instance discovery and lifecycle management.
    ///
    /// Backed by $TMPDIR/tug-instances.json and the per-instance
    /// data dirs under ~/Library/Application Support/Tug/instances/.
    /// Subcommands: list, stop, current, remove, prune.
    #[command(subcommand)]
    Instance(InstanceCommands),

    /// Machine-wide mutual exclusion via a localhost port bind.
    ///
    /// Holding a listener on the gate's reserved port is the mutex;
    /// the kernel frees it on any holder death — no lock file.
    /// Used to serialize whole `just app-test` invocations.
    #[command(subcommand)]
    Gate(GateCommands),

    /// Print the per-project runtime-state directory
    ///
    /// Resolves the out-of-repo directory for per-user runtime state.
    #[command(
        long_about = "Print the per-project runtime-state directory.\n\nResolves <data_dir>/Tug/projects/<slug>/ for the current repository — the\nout-of-repo home for per-user runtime state (the dash-log, the code-sign\nsentinel, future side-command output). Creates the directory if absent, so\nshell consumers (the Justfile, the host) can write into it without re-deriving\nthe path."
    )]
    StateDir,
}

/// Get the command args for use in the application
pub fn parse() -> Cli {
    Cli::parse()
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn verify_cli() {
        // `debug_assert` is clap's own structural validator — catches
        // overlapping flag names, missing subcommand attrs, malformed
        // arg derives.
        Cli::command().debug_assert();
    }
}
