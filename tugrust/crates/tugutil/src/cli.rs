//! CLI argument parsing with clap derive

use clap::{Parser, Subcommand};

use crate::commands::{
    DashCommands, InstanceCommands, LogCommands, StateCommands, WorktreeCommands,
};

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

    /// Worktree commands for isolated implementation environments
    ///
    /// Create, list, and clean up git worktrees for plan implementations.
    #[command(
        subcommand,
        long_about = "Worktree commands for isolated implementation environments.\n\nProvides git worktree integration for plan implementations:\n  - Each plan gets its own branch and worktree\n  - Isolated working directory prevents conflicts\n  - Clean up merged worktrees after PR completion\n\nSubcommands:\n  setup   Set up worktree and branch for a plan\n  list    Show all active worktrees\n  cleanup Remove worktrees for merged branches\n\nTypical workflow:\n  1. tugtool worktree setup .tugtool/tugplan-auth.md\n  2. (implement in worktree, create PR, merge)\n  3. tugtool worktree cleanup --merged"
    )]
    Worktree(WorktreeCommands),

    /// State management commands
    #[command(
        subcommand,
        long_about = "State management commands for tracking plan execution.\n\nSubcommands:\n  init  Initialize state database from a plan"
    )]
    State(StateCommands),

    /// Log management commands
    ///
    /// Rotate and prepend entries to the implementation log.
    #[command(
        subcommand,
        long_about = "Log management commands.\n\nProvides log rotation and prepend functionality:\n  - Rotate: Archive logs exceeding size thresholds\n  - Prepend: Add new entries atomically\n\nSubcommands:\n  rotate  Archive log when over 500 lines or 100KB\n  prepend Add entry to log atomically\n\nTypical workflow:\n  1. tug log rotate  # Manual rotation\n  2. (automatic rotation happens via commit)"
    )]
    Log(LogCommands),

    /// Health checks for tug project
    ///
    /// Verify initialization, log size, worktrees, and references.
    #[command(
        long_about = "Health checks for tug project.\n\nRuns checks:\n  - initialized: Verify .tugtool/ exists with required files\n  - log_size: Check implementation log within thresholds\n  - worktrees: Verify worktree paths are valid\n  - broken_refs: Check for broken anchor references\n\nExit codes:\n  0 - All checks passed\n  1 - Some checks have warnings\n  2 - Some checks failed\n\nUse --json for machine-readable output."
    )]
    Doctor,

    /// Merge a plan's implementation and clean up worktree
    ///
    /// Automates the post-implementation merge workflow with auto mode detection.
    #[command(
        long_about = "Merge a plan's implementation and clean up worktree.\n\nMode auto-detection:\n  Remote mode: Repository has 'origin' remote\n  Local mode:  No remote configured\n\nRemote mode workflow:\n  1. Find worktree for plan\n  2. Check main is synced with origin\n  3. Find PR for worktree branch\n  4. Verify PR checks have passed\n  5. Auto-commit infrastructure files\n  6. Push main to origin\n  7. Merge PR via squash\n  8. Pull main to get squashed commit\n  9. Clean up worktree and branch\n\nLocal mode workflow:\n  1. Find worktree for plan\n  2. Check branch has commits to merge\n  3. Auto-commit infrastructure files\n  4. Squash merge branch into main\n  5. Clean up worktree and branch\n\nInfrastructure files (auto-committed):\n  - agents/*.md, skills/**, .claude/skills/**\n  - .tugtool/config.toml, .tugtool/tugplan-implementation-log.md\n  - CLAUDE.md\n\nUse --dry-run to preview operations.\nUse --force to proceed with non-infrastructure uncommitted files (not recommended)."
    )]
    Merge {
        /// Plan file path (e.g., .tugtool/tugplan-12.md)
        plan: String,

        /// Show what would happen without executing
        #[arg(long)]
        dry_run: bool,

        /// Proceed even with non-infrastructure uncommitted files
        #[arg(long)]
        force: bool,
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

    /// Commit a single implementation step
    ///
    /// Atomically performs log rotation, prepend, and git commit.
    #[command(
        long_about = "Commit a single implementation step.\n\nAtomic sequence:\n  1. Rotate log if over threshold\n  2. Prepend log entry\n  3. Stage files\n  4. Git commit\n\nAll file paths are relative to worktree root.\n\nPartial success: If commit succeeds but state complete fails, exits 0 with state_update_failed=true."
    )]
    Commit {
        /// Absolute path to the worktree directory
        #[arg(long, value_name = "PATH")]
        worktree: String,

        /// Step anchor (e.g., step-1)
        #[arg(long, value_name = "ANCHOR")]
        step: String,

        /// Plan file path relative to repo root
        #[arg(long, value_name = "PATH")]
        plan: String,

        /// Git commit message
        #[arg(long, value_name = "MESSAGE")]
        message: String,

        /// One-line summary for log entry
        #[arg(long, value_name = "TEXT")]
        summary: String,
    },

    /// Push branch and open a pull request
    ///
    /// Pushes branch to remote and creates PR.
    #[command(
        long_about = "Push branch and open a pull request.\n\nSequence:\n  1. Check gh auth\n  2. Derive repo from remote (if not provided)\n  3. Generate PR body from git log\n  4. Push branch to remote\n  5. Create PR via gh\n\nRequires:\n  - GitHub CLI (gh) installed and authenticated\n  - Remote 'origin' configured"
    )]
    OpenPr {
        /// Absolute path to the worktree directory
        #[arg(long, value_name = "PATH")]
        worktree: String,

        /// Git branch name (e.g., tug/auth-20260208-143022)
        #[arg(long, value_name = "BRANCH")]
        branch: String,

        /// Base branch to merge into (e.g., main)
        #[arg(long, value_name = "BRANCH")]
        base: String,

        /// PR title
        #[arg(long, value_name = "TEXT")]
        title: String,

        /// Plan file path relative to repo root
        #[arg(long, value_name = "PATH")]
        plan: String,

        /// GitHub repo in owner/repo format (auto-derived if not provided)
        #[arg(long, value_name = "REPO")]
        repo: Option<String>,
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
