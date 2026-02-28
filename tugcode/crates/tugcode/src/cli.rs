//! CLI argument parsing with clap derive

use clap::{Parser, Subcommand};

use crate::commands::{DashCommands, LogCommands, StateCommands, WorktreeCommands};

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Tug - From ideas to implementation via multi-agent orchestration
#[derive(Parser)]
#[command(name = "tugcode")]
#[command(version = VERSION)]
#[command(about = "From ideas to implementation via multi-agent orchestration")]
#[command(
    long_about = "Tug transforms ideas into working software through orchestrated LLM agents.\n\nA multi-agent suite collaborates to create structured plans and execute them to completion.\n\nPlanning and execution are invoked via Claude Code skills (/tugplug:plan, /tugplug:implement).\n\nThe CLI provides utilities to initialize, validate, list, track progress, and manage state for execution tracking."
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
        long_about = "Initialize a tug project in current directory.\n\nCreates:\n  .tugtool/tugplan-skeleton.md  Template for new plans\n  .tugtool/config.toml       Project configuration\n  .tugtool/tugplan-implementation-log.md  Implementation progress tracking\n\nIdempotent: if .tugtool/ already exists, creates only missing files without overwriting.\nWith --force, removes and recreates everything.\nWith --check, performs a lightweight verification of initialization status without side effects."
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

    /// Show detailed completion status for a plan
    ///
    /// Displays step-by-step progress with task and checkpoint counts.
    #[command(
        long_about = "Show detailed completion status for a plan.\n\nDisplays:\n  - Overall progress percentage\n  - Per-step completion (tasks, tests, checkpoints)\n\nUse -v/--verbose to see individual task and checkpoint items.\nUse 'tugcode state show' for detailed execution state."
    )]
    Status {
        /// Plan file to show status for
        file: String,

        /// Show individual task and checkpoint details
        #[arg(short, long)]
        verbose: bool,
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
        long_about = "Merge a plan's implementation and clean up worktree.\n\nMode auto-detection:\n  Remote mode: Repository has 'origin' remote\n  Local mode:  No remote configured\n\nRemote mode workflow:\n  1. Find worktree for plan\n  2. Check main is synced with origin\n  3. Find PR for worktree branch\n  4. Verify PR checks have passed\n  5. Auto-commit infrastructure files\n  6. Push main to origin\n  7. Merge PR via squash\n  8. Pull main to get squashed commit\n  9. Clean up worktree and branch\n\nLocal mode workflow:\n  1. Find worktree for plan\n  2. Check branch has commits to merge\n  3. Auto-commit infrastructure files\n  4. Squash merge branch into main\n  5. Clean up worktree and branch\n\nInfrastructure files (auto-committed):\n  - agents/*.md, skills/**, .claude/skills/**\n  - .tugtool/tugplan-skeleton.md, .tugtool/config.toml\n  - .tugtool/tugplan-implementation-log.md\n  - CLAUDE.md\n\nUse --dry-run to preview operations.\nUse --force to proceed with non-infrastructure uncommitted files (not recommended)."
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
        long_about = "Resolve a plan identifier to a file path.\n\nResolution cascade (tried in order):\n  1. Exact path: Input starts with / or . and file exists\n  2. Bare filename: Input starts with tugplan- (joined with .tugtool/)\n  3. Slug: .tugtool/tugplan-{input}.md exists\n  4. Prefix: Unique slug starting with input\n  5. Auto-select: Exactly one plan exists\n\nReturns the resolved path, or an error with candidates if ambiguous.\nUse --json for machine-readable output (Spec S02)."
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
        /// Action name (e.g., restart, show-card, reload_frontend)
        action: String,

        /// Tugcast server port
        #[arg(long, default_value = "55255")]
        port: u16,

        /// Parameters as KEY=VALUE pairs (repeatable)
        #[arg(short = 'p', long = "param", value_name = "KEY=VALUE")]
        param: Vec<String>,
    },

    /// Dash commands for lightweight worktree-isolated work
    ///
    /// Create, work on, and complete dashes without the full plan/implement pipeline.
    #[command(
        subcommand,
        long_about = "Dash commands for lightweight worktree-isolated work.\n\nProvides quick project workflows for:\n  - Bug fixes\n  - Spikes and experiments\n  - Small features\n  - Prototyping\n\nSubcommands:\n  create   Create dash worktree and branch\n  commit   Record round and commit changes\n  join     Squash-merge to base branch\n  release  Discard without merging\n  list     Show all dashes\n  show     Show dash details and rounds"
    )]
    Dash(DashCommands),
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
        Cli::command().debug_assert();
    }

    #[test]
    fn build_env_vars_accessible() {
        // Verify that build.rs exports are accessible via env!()
        // These will fail at compile time if build.rs doesn't set them
        let commit = env!("TUG_COMMIT");
        let build_date = env!("TUG_BUILD_DATE");
        let rustc_version = env!("TUG_RUSTC_VERSION");

        // Basic sanity checks - values should be non-empty
        assert!(!commit.is_empty(), "TUG_COMMIT should not be empty");
        assert!(!build_date.is_empty(), "TUG_BUILD_DATE should not be empty");
        assert!(
            !rustc_version.is_empty(),
            "TUG_RUSTC_VERSION should not be empty"
        );

        // Build date should match YYYY-MM-DD format or be "unknown"
        if build_date != "unknown" {
            assert!(
                build_date.len() == 10 && build_date.chars().nth(4) == Some('-'),
                "TUG_BUILD_DATE should be YYYY-MM-DD format, got: {}",
                build_date
            );
        }
    }

    #[test]
    fn test_init_command() {
        let cli = Cli::try_parse_from(["tugcode", "init"]).unwrap();

        match cli.command {
            Some(Commands::Init { force, check }) => {
                assert!(!force);
                assert!(!check);
            }
            _ => panic!("Expected Init command"),
        }
    }

    #[test]
    fn test_init_command_with_force() {
        let cli = Cli::try_parse_from(["tugcode", "init", "--force"]).unwrap();

        match cli.command {
            Some(Commands::Init { force, check }) => {
                assert!(force);
                assert!(!check);
            }
            _ => panic!("Expected Init command"),
        }
    }

    #[test]
    fn test_init_command_with_check() {
        let cli = Cli::try_parse_from(["tugcode", "init", "--check"]).unwrap();

        match cli.command {
            Some(Commands::Init { force, check }) => {
                assert!(!force);
                assert!(check);
            }
            _ => panic!("Expected Init command"),
        }
    }

    #[test]
    fn test_init_check_and_force_mutually_exclusive() {
        let result = Cli::try_parse_from(["tugcode", "init", "--check", "--force"]);
        assert!(
            result.is_err(),
            "--check and --force should be mutually exclusive"
        );
    }

    #[test]
    fn test_validate_command() {
        let cli = Cli::try_parse_from(["tugcode", "validate"]).unwrap();

        match cli.command {
            Some(Commands::Validate {
                file,
                strict,
                level,
            }) => {
                assert!(file.is_none());
                assert!(!strict);
                assert!(level.is_none());
            }
            _ => panic!("Expected Validate command"),
        }
    }

    #[test]
    fn test_validate_command_with_file() {
        let cli = Cli::try_parse_from(["tugcode", "validate", "tugplan-1.md"]).unwrap();

        match cli.command {
            Some(Commands::Validate {
                file,
                strict,
                level,
            }) => {
                assert_eq!(file, Some("tugplan-1.md".to_string()));
                assert!(!strict);
                assert!(level.is_none());
            }
            _ => panic!("Expected Validate command"),
        }
    }

    #[test]
    fn test_validate_command_with_level_strict() {
        let cli = Cli::try_parse_from(["tugcode", "validate", "--level", "strict"]).unwrap();

        match cli.command {
            Some(Commands::Validate {
                file,
                strict,
                level,
            }) => {
                assert!(file.is_none());
                assert!(!strict);
                assert_eq!(level, Some("strict".to_string()));
            }
            _ => panic!("Expected Validate command"),
        }
    }

    #[test]
    fn test_validate_command_with_level_lenient() {
        let cli = Cli::try_parse_from(["tugcode", "validate", "--level", "lenient"]).unwrap();

        match cli.command {
            Some(Commands::Validate {
                file,
                strict,
                level,
            }) => {
                assert!(file.is_none());
                assert!(!strict);
                assert_eq!(level, Some("lenient".to_string()));
            }
            _ => panic!("Expected Validate command"),
        }
    }

    #[test]
    fn test_validate_command_with_strict_deprecated() {
        let cli = Cli::try_parse_from(["tugcode", "validate", "--strict"]).unwrap();

        match cli.command {
            Some(Commands::Validate {
                file,
                strict,
                level,
            }) => {
                assert!(file.is_none());
                assert!(strict);
                assert!(level.is_none());
            }
            _ => panic!("Expected Validate command"),
        }
    }

    #[test]
    fn test_list_command() {
        let cli = Cli::try_parse_from(["tugcode", "list"]).unwrap();

        match cli.command {
            Some(Commands::List { status }) => {
                assert!(status.is_none());
            }
            _ => panic!("Expected List command"),
        }
    }

    #[test]
    fn test_status_command() {
        let cli = Cli::try_parse_from(["tugcode", "status", "tugplan-1.md"]).unwrap();

        match cli.command {
            Some(Commands::Status { file, verbose }) => {
                assert_eq!(file, "tugplan-1.md");
                assert!(!verbose);
            }
            _ => panic!("Expected Status command"),
        }
    }

    #[test]
    fn test_version_command() {
        let cli = Cli::try_parse_from(["tugcode", "version"]).unwrap();

        match cli.command {
            Some(Commands::Version { verbose }) => {
                assert!(!verbose);
            }
            _ => panic!("Expected Version command"),
        }
    }

    #[test]
    fn test_global_flags() {
        let cli = Cli::try_parse_from(["tugcode", "--json", "--quiet", "list"]).unwrap();

        assert!(cli.json);
        assert!(cli.quiet);
    }

    #[test]
    fn test_init_help_includes_check_flag() {
        use clap::CommandFactory;
        let app = Cli::command();
        let init_subcommand = app
            .find_subcommand("init")
            .expect("init subcommand should exist");

        // Get the long_about text
        let long_about = init_subcommand
            .get_long_about()
            .expect("init should have long_about");

        // Verify --check flag is documented
        assert!(
            long_about.to_string().contains("--check"),
            "init help should document --check flag"
        );
        assert!(
            long_about.to_string().contains("without side effects"),
            "init help should explain --check has no side effects"
        );
    }

    #[test]
    fn test_merge_command() {
        let cli = Cli::try_parse_from(["tugcode", "merge", ".tugtool/tugplan-1.md"]).unwrap();

        match cli.command {
            Some(Commands::Merge {
                plan,
                dry_run,
                force,
            }) => {
                assert_eq!(plan, ".tugtool/tugplan-1.md");
                assert!(!dry_run);
                assert!(!force);
            }
            _ => panic!("Expected Merge command"),
        }
    }

    #[test]
    fn test_merge_command_with_dry_run() {
        let cli = Cli::try_parse_from(["tugcode", "merge", ".tugtool/tugplan-1.md", "--dry-run"])
            .unwrap();

        match cli.command {
            Some(Commands::Merge {
                plan,
                dry_run,
                force,
            }) => {
                assert_eq!(plan, ".tugtool/tugplan-1.md");
                assert!(dry_run);
                assert!(!force);
            }
            _ => panic!("Expected Merge command"),
        }
    }

    #[test]
    fn test_merge_command_with_force() {
        let cli =
            Cli::try_parse_from(["tugcode", "merge", ".tugtool/tugplan-1.md", "--force"]).unwrap();

        match cli.command {
            Some(Commands::Merge {
                plan,
                dry_run,
                force,
            }) => {
                assert_eq!(plan, ".tugtool/tugplan-1.md");
                assert!(!dry_run);
                assert!(force);
            }
            _ => panic!("Expected Merge command"),
        }
    }

    #[test]
    fn test_merge_command_with_both_flags() {
        let cli = Cli::try_parse_from([
            "tugcode",
            "merge",
            ".tugtool/tugplan-1.md",
            "--dry-run",
            "--force",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::Merge {
                plan,
                dry_run,
                force,
            }) => {
                assert_eq!(plan, ".tugtool/tugplan-1.md");
                assert!(dry_run);
                assert!(force);
            }
            _ => panic!("Expected Merge command"),
        }
    }

    #[test]
    fn test_log_rotate_command() {
        let cli = Cli::try_parse_from(["tugcode", "log", "rotate"]).unwrap();

        match cli.command {
            Some(Commands::Log(log_cmd)) => match log_cmd {
                LogCommands::Rotate { force } => {
                    assert!(!force);
                }
                _ => panic!("Expected Log Rotate command"),
            },
            _ => panic!("Expected Log command"),
        }
    }

    #[test]
    fn test_log_rotate_command_with_force() {
        let cli = Cli::try_parse_from(["tugcode", "log", "rotate", "--force"]).unwrap();

        match cli.command {
            Some(Commands::Log(log_cmd)) => match log_cmd {
                LogCommands::Rotate { force } => {
                    assert!(force);
                }
                _ => panic!("Expected Log Rotate command"),
            },
            _ => panic!("Expected Log command"),
        }
    }

    #[test]
    fn test_log_prepend_command() {
        let cli = Cli::try_parse_from([
            "tug",
            "log",
            "prepend",
            "--step",
            "step-1",
            "--plan",
            ".tugtool/tugplan-13.md",
            "--summary",
            "Completed step 0",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::Log(log_cmd)) => match log_cmd {
                LogCommands::Prepend {
                    step,
                    plan,
                    summary,
                } => {
                    assert_eq!(step, "step-1");
                    assert_eq!(plan, ".tugtool/tugplan-13.md");
                    assert_eq!(summary, "Completed step 0");
                }
                _ => panic!("Expected Log Prepend command"),
            },
            _ => panic!("Expected Log command"),
        }
    }

    #[test]
    fn test_log_rotate_with_json_flag() {
        let cli = Cli::try_parse_from(["tugcode", "--json", "log", "rotate"]).unwrap();

        assert!(cli.json);
        match cli.command {
            Some(Commands::Log(log_cmd)) => match log_cmd {
                LogCommands::Rotate { force } => {
                    assert!(!force);
                }
                _ => panic!("Expected Log Rotate command"),
            },
            _ => panic!("Expected Log command"),
        }
    }

    #[test]
    fn test_log_prepend_with_quiet_flag() {
        let cli = Cli::try_parse_from([
            "tug",
            "--quiet",
            "log",
            "prepend",
            "--step",
            "step-1",
            "--plan",
            ".tugtool/tugplan-1.md",
            "--summary",
            "Done",
        ])
        .unwrap();

        assert!(cli.quiet);
        match cli.command {
            Some(Commands::Log(log_cmd)) => match log_cmd {
                LogCommands::Prepend { .. } => {}
                _ => panic!("Expected Log Prepend command"),
            },
            _ => panic!("Expected Log command"),
        }
    }

    #[test]
    fn test_doctor_command() {
        let cli = Cli::try_parse_from(["tugcode", "doctor"]).unwrap();

        match cli.command {
            Some(Commands::Doctor) => {}
            _ => panic!("Expected Doctor command"),
        }
    }

    #[test]
    fn test_doctor_with_json_flag() {
        let cli = Cli::try_parse_from(["tugcode", "--json", "doctor"]).unwrap();

        assert!(cli.json);
        match cli.command {
            Some(Commands::Doctor) => {}
            _ => panic!("Expected Doctor command"),
        }
    }

    #[test]
    fn test_doctor_with_quiet_flag() {
        let cli = Cli::try_parse_from(["tugcode", "--quiet", "doctor"]).unwrap();

        assert!(cli.quiet);
        match cli.command {
            Some(Commands::Doctor) => {}
            _ => panic!("Expected Doctor command"),
        }
    }

    #[test]
    fn test_commit_command() {
        let cli = Cli::try_parse_from([
            "tug",
            "commit",
            "--worktree",
            "/path/to/worktree",
            "--step",
            "step-1",
            "--plan",
            ".tugtool/tugplan-1.md",
            "--message",
            "feat: add feature",
            "--summary",
            "Completed step 0",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::Commit {
                worktree,
                step,
                plan,
                message,
                summary,
            }) => {
                assert_eq!(worktree, "/path/to/worktree");
                assert_eq!(step, "step-1");
                assert_eq!(plan, ".tugtool/tugplan-1.md");
                assert_eq!(message, "feat: add feature");
                assert_eq!(summary, "Completed step 0");
            }
            _ => panic!("Expected Commit command"),
        }
    }

    #[test]
    fn test_open_pr_command() {
        let cli = Cli::try_parse_from([
            "tug",
            "open-pr",
            "--worktree",
            "/path/to/worktree",
            "--branch",
            "tug/auth-123",
            "--base",
            "main",
            "--title",
            "feat: add authentication",
            "--plan",
            ".tugtool/tugplan-1.md",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::OpenPr {
                worktree,
                branch,
                base,
                title,
                plan,
                repo,
            }) => {
                assert_eq!(worktree, "/path/to/worktree");
                assert_eq!(branch, "tug/auth-123");
                assert_eq!(base, "main");
                assert_eq!(title, "feat: add authentication");
                assert_eq!(plan, ".tugtool/tugplan-1.md");
                assert!(repo.is_none());
            }
            _ => panic!("Expected OpenPr command"),
        }
    }

    #[test]
    fn test_open_pr_with_repo() {
        let cli = Cli::try_parse_from([
            "tug",
            "open-pr",
            "--worktree",
            "/path",
            "--branch",
            "branch",
            "--base",
            "main",
            "--title",
            "title",
            "--plan",
            ".tugtool/tugplan-1.md",
            "--repo",
            "owner/repo",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::OpenPr { repo, .. }) => {
                assert_eq!(repo, Some("owner/repo".to_string()));
            }
            _ => panic!("Expected OpenPr command"),
        }
    }

    #[test]
    fn test_resolve_command() {
        let cli = Cli::try_parse_from(["tugcode", "resolve"]).unwrap();

        match cli.command {
            Some(Commands::Resolve { identifier }) => {
                assert!(identifier.is_none());
            }
            _ => panic!("Expected Resolve command"),
        }
    }

    #[test]
    fn test_resolve_command_with_identifier() {
        let cli = Cli::try_parse_from(["tugcode", "resolve", "user-auth"]).unwrap();

        match cli.command {
            Some(Commands::Resolve { identifier }) => {
                assert_eq!(identifier, Some("user-auth".to_string()));
            }
            _ => panic!("Expected Resolve command"),
        }
    }

    #[test]
    fn test_tell_command() {
        let cli =
            Cli::try_parse_from(["tugcode", "tell", "show-card", "-p", "component=about"]).unwrap();

        match cli.command {
            Some(Commands::Tell {
                action,
                port,
                param,
            }) => {
                assert_eq!(action, "show-card");
                assert_eq!(port, 55255); // default
                assert_eq!(param, vec!["component=about"]);
            }
            _ => panic!("Expected Tell command"),
        }
    }

    #[test]
    fn test_tell_command_no_params() {
        let cli = Cli::try_parse_from(["tugcode", "tell", "restart"]).unwrap();

        match cli.command {
            Some(Commands::Tell { action, param, .. }) => {
                assert_eq!(action, "restart");
                assert!(param.is_empty());
            }
            _ => panic!("Expected Tell command"),
        }
    }

    #[test]
    fn test_tell_command_with_port() {
        let cli = Cli::try_parse_from([
            "tugcode",
            "tell",
            "show-card",
            "--port",
            "8080",
            "-p",
            "component=settings",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::Tell { port, .. }) => {
                assert_eq!(port, 8080);
            }
            _ => panic!("Expected Tell command"),
        }
    }

    #[test]
    fn test_tell_command_multiple_params() {
        let cli = Cli::try_parse_from([
            "tugcode",
            "tell",
            "show-card",
            "-p",
            "component=about",
            "-p",
            "tab=1",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::Tell { param, .. }) => {
                assert_eq!(param.len(), 2);
                assert_eq!(param[0], "component=about");
                assert_eq!(param[1], "tab=1");
            }
            _ => panic!("Expected Tell command"),
        }
    }

    #[test]
    fn test_tell_with_json_flag() {
        let cli = Cli::try_parse_from(["tugcode", "--json", "tell", "show-card"]).unwrap();

        assert!(cli.json);
        match cli.command {
            Some(Commands::Tell { action, .. }) => {
                assert_eq!(action, "show-card");
            }
            _ => panic!("Expected Tell command"),
        }
    }
}
