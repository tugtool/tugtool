//! CLI argument parsing with clap derive

use clap::{Parser, Subcommand};

use crate::commands::{DashCommands, InstanceCommands};

const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), " (", env!("TUG_COMMIT"), ")");

/// Tug utility — project management, state tracking, and developer tools
#[derive(Parser)]
#[command(name = "tugutil")]
#[command(version = VERSION)]
#[command(about = "Tug utility — project management, state tracking, and developer tools")]
#[command(
    long_about = "Tug utility for project management, state tracking, and developer tools.\n\nManages tugplans, worktrees, state databases, and provides developer utilities.\n\nPlanning and execution are invoked via Claude Code skills (/tugplug:plan, /tugplug:implement).\n\nThe CLI provides utilities to initialize, validate, list, track progress, and manage state."
)]
pub struct Cli {
    /// Increase output verbosity
    #[arg(short, long, global = true)]
    pub verbose: bool,

    /// Suppress non-error output
    #[arg(short, long, global = true)]
    pub quiet: bool,

    /// Output in JSON format
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Initialize a tug project in current directory
    ///
    /// Creates .tugtool/ directory with skeleton template and config.
    /// Idempotent: safe to run multiple times (creates only missing files).
    #[command(
        long_about = "Initialize a tug project in current directory.\n\nCreates:\n  .tugtool/config.toml                    Project configuration\n  .tugtool/tugplan-implementation-log.md  Implementation progress tracking\n\nIdempotent: if .tugtool/ already exists, creates only missing files without overwriting.\nWith --force, removes and recreates everything.\nWith --check, performs a lightweight verification of initialization status without side effects."
    )]
    Init {
        /// Overwrite existing .tug directory
        #[arg(long, conflicts_with = "check")]
        force: bool,

        /// Check if project is initialized (no side effects)
        #[arg(long, conflicts_with = "force")]
        check: bool,
    },

    /// Validate plan structure against format conventions
    ///
    /// Checks anchors, references, metadata, and step dependencies.
    #[command(
        long_about = "Validate plan structure against format conventions.\n\nChecks:\n  - Required metadata fields (Owner, Status, Last updated)\n  - Anchor format and uniqueness\n  - Reference validity ([D01], #step-1, etc.)\n  - Step dependency cycles\n  - Cross-reference consistency"
    )]
    Validate {
        /// Plan file to validate (validates all if not specified)
        file: Option<String>,

        /// Enable strict validation mode (deprecated: use --level strict)
        #[arg(long, hide = true)]
        strict: bool,

        /// Validation level: lenient, normal, or strict
        #[arg(long, value_name = "LEVEL")]
        level: Option<String>,
    },

    /// List all plans with summary information
    ///
    /// Shows each plan's name, status, and completion percentage.
    #[command(
        long_about = "List all plans with summary information.\n\nDisplays:\n  - Plan name (from filename)\n  - Status (draft, active, done)\n  - Progress (completed/total items)\n\nPlans are found in .tugtool/ matching the naming pattern."
    )]
    List {
        /// Filter by status (draft, active, done)
        #[arg(long)]
        status: Option<String>,
    },

    /// Resolve a plan identifier to a file path
    ///
    /// Uses the five-stage resolution cascade: exact path, bare filename, slug, prefix, auto-select.
    #[command(
        long_about = "Resolve a plan identifier to a file path.\n\nResolution cascade (tried in order):\n  1. Exact path: Input starts with / or . and file exists\n  2. Bare filename: Input starts with tugplan- (joined with .tugtool/)\n  3. Slug: .tugtool/tugplan-{input}.md exists\n  4. Prefix: Unique slug starting with input\n  5. Auto-select: Exactly one plan exists\n\nReturns the resolved path, or an error with candidates if ambiguous.\nUse --json for machine-readable output."
    )]
    Resolve {
        /// Plan identifier (path, filename, slug, prefix, or empty for auto-select)
        identifier: Option<String>,
    },

    /// Show version information
    ///
    /// Display package version and optionally build metadata.
    #[command(
        long_about = "Show version information.\n\nBy default, displays the package version. With --verbose, also shows:\n  - Git commit hash\n  - Build date\n  - Rust compiler version\n\nUse --json for machine-readable output."
    )]
    Version {
        /// Show extended build information (commit, date, rustc version)
        #[arg(short, long)]
        verbose: bool,
    },

    /// Send an action to tugcast via HTTP POST
    ///
    /// Posts a JSON action to the tugcast /api/tell endpoint.
    #[command(
        long_about = "Send an action to tugcast via HTTP POST.\n\nPosts a JSON body to http://127.0.0.1:<port>/api/tell.\nThe body contains {\"action\": \"<ACTION>\", ...params}.\n\nParameters are specified with -p KEY=VALUE (repeatable).\nValues are auto-coerced: true/false -> bool, null -> null,\nintegers -> number, floats -> number, everything else -> string.\n\nExamples:\n  tugcode tell restart\n  tugcode tell show-card -p component=about\n  tugcode tell set-dev-mode -p enabled=true"
    )]
    Tell {
        /// Action name (e.g., reload, show-card, set-dev-mode)
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

    /// Convert a color to TugColor notation
    ///
    /// Accepts hex, rgb(), rgba(), hsl(), hsla(), hsv(), oklch(), and CSS named colors.
    #[command(
        long_about = "Convert a color to TugColor notation.\n\nAccepts many color formats:\n  Hex:     #RGB, #RRGGBB, #RRGGBBAA\n  RGB:     rgb(255, 0, 0), rgba(255, 0, 0, 0.5)\n  HSL:     hsl(0, 100%, 50%), hsla(0, 100%, 50%, 0.5)\n  HSV:     hsv(0, 100%, 100%)\n  OKLCH:   oklch(0.771 0.143 230)\n  Named:   red, coral, steelblue, ...\n\nOutputs the TugColor decomposition (hue, intensity, tone) along with\nthe oklch() and hex equivalents.\n\nExamples:\n  tugcode color '#3b82f6'\n  tugcode color 'rgb(59, 130, 246)'\n  tugcode color 'oklch(0.771 0.143 230)'\n  tugcode color coral"
    )]
    Color {
        /// Color string to convert
        color: String,
    },

    /// Dash commands for lightweight worktree-isolated work
    ///
    /// Create, work on, and complete dashes without the full plan/implement pipeline.
    #[command(
        subcommand,
        long_about = "Dash commands for lightweight worktree-isolated work.\n\nProvides quick project workflows for:\n  - Bug fixes\n  - Spikes and experiments\n  - Small features\n  - Prototyping\n\nSubcommands:\n  create   Create dash worktree and branch\n  commit   Record round and commit changes\n  join     Squash-merge to base branch\n  release  Discard without merging\n  list     Show all dashes\n  show     Show dash details and rounds"
    )]
    Dash(DashCommands),

    /// Per-instance discovery and lifecycle management.
    ///
    /// Backed by $TMPDIR/tug-instances.json and the per-instance
    /// data dirs under ~/Library/Application Support/Tug/instances/.
    /// Subcommands: list, stop, current, remove, prune.
    #[command(subcommand)]
    Instance(InstanceCommands),

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
        // arg derives. Real argument-parsing behavior is clap's
        // responsibility and not retested here.
        Cli::command().debug_assert();
    }
}
