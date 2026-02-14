//! CLI argument parsing with clap derive

use clap::{Parser, Subcommand};

use crate::commands::{BeadsCommands, LogCommands, WorktreeCommands};

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Tug - From ideas to implementation via multi-agent orchestration
#[derive(Parser)]
#[command(name = "tugtool")]
#[command(version = VERSION)]
#[command(about = "From ideas to implementation via multi-agent orchestration")]
#[command(
    long_about = "Tug transforms ideas into working software through orchestrated LLM agents.\n\nA multi-agent suite collaborates to create structured plans and execute them to completion.\n\nPlanning and execution are invoked via Claude Code skills (/tugtool:plan, /tugtool:implement).\n\nThe CLI provides utilities to initialize, validate, list, track progress, and integrate with beads for execution tracking."
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
        long_about = "Validate plan structure against format conventions.\n\nChecks:\n  - Required metadata fields (Owner, Status, Last updated)\n  - Anchor format and uniqueness\n  - Reference validity ([D01], #step-0, etc.)\n  - Step dependency cycles\n  - Cross-reference consistency"
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
        long_about = "Show detailed completion status for a plan.\n\nDisplays:\n  - Overall progress percentage\n  - Per-step completion (tasks, tests, checkpoints)\n  - Substep progress if present\n\nUse -v/--verbose to see individual task and checkpoint items.\nUse --full to include bead-enriched status (bead IDs, commit info, block status)."
    )]
    Status {
        /// Plan file to show status for
        file: String,

        /// Show individual task and checkpoint details
        #[arg(short, long)]
        verbose: bool,

        /// Include bead-enriched status (requires beads integration)
        #[arg(long)]
        full: bool,
    },

    /// Beads integration commands
    ///
    /// Sync steps to beads, link beads, show status, pull completion.
    #[command(
        subcommand,
        long_about = "Beads integration for two-way sync between plans and work tracking.\n\nRequires:\n  - Beads CLI (bd) installed and in PATH\n  - Beads initialized (bd init creates .beads/)\n  - Network connectivity\n\nSubcommands:\n  sync   Create beads from plan steps, write IDs back\n  link   Manually link a step to an existing bead\n  status Show execution status (complete/ready/blocked)\n  pull   Update plan checkboxes from bead completion\n\nTypical workflow:\n  1. tugtool beads sync tugplan-1.md    # Create beads\n  2. bd close <bead-id>          # Complete work\n  3. tugtool beads pull tugplan-1.md    # Update checkboxes"
    )]
    Beads(BeadsCommands),

    /// Worktree commands for isolated implementation environments
    ///
    /// Create, list, and clean up git worktrees for plan implementations.
    #[command(
        subcommand,
        long_about = "Worktree commands for isolated implementation environments.\n\nProvides git worktree integration for plan implementations:\n  - Each plan gets its own branch and worktree\n  - Isolated working directory prevents conflicts\n  - Clean up merged worktrees after PR completion\n\nSubcommands:\n  create  Create worktree and branch for a plan (optionally sync beads)\n  list    Show all active worktrees\n  cleanup Remove worktrees for merged branches\n\nTypical workflow:\n  1. tugtool worktree create .tugtool/tugplan-auth.md --sync-beads\n  2. (implement in worktree, create PR, merge)\n  3. tugtool worktree cleanup --merged"
    )]
    Worktree(WorktreeCommands),

    /// Log management commands
    ///
    /// Rotate and prepend entries to the implementation log.
    #[command(
        subcommand,
        long_about = "Log management commands.\n\nProvides log rotation and prepend functionality:\n  - Rotate: Archive logs exceeding size thresholds\n  - Prepend: Add new entries atomically\n\nSubcommands:\n  rotate  Archive log when over 500 lines or 100KB\n  prepend Add entry to log atomically\n\nTypical workflow:\n  1. tug log rotate  # Manual rotation\n  2. (automatic rotation happens via beads close and committer)"
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
        long_about = "Merge a plan's implementation and clean up worktree.\n\nMode auto-detection:\n  Remote mode: Repository has 'origin' remote\n  Local mode:  No remote configured\n\nRemote mode workflow:\n  1. Find worktree for plan\n  2. Check main is synced with origin\n  3. Find PR for worktree branch\n  4. Verify PR checks have passed\n  5. Auto-commit infrastructure files\n  6. Push main to origin\n  7. Merge PR via squash\n  8. Pull main to get squashed commit\n  9. Clean up worktree and branch\n\nLocal mode workflow:\n  1. Find worktree for plan\n  2. Check branch has commits to merge\n  3. Auto-commit infrastructure files\n  4. Squash merge branch into main\n  5. Clean up worktree and branch\n\nInfrastructure files (auto-committed):\n  - agents/*.md, skills/**, .claude/skills/**\n  - .tugtool/tugplan-skeleton.md, .tugtool/config.toml\n  - .tugtool/tugplan-implementation-log.md\n  - .beads/*, CLAUDE.md\n\nUse --dry-run to preview operations.\nUse --force to proceed with non-infrastructure uncommitted files (not recommended)."
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
    /// Atomically performs log rotation, prepend, git commit, and bead close.
    #[command(
        long_about = "Commit a single implementation step.\n\nAtomic sequence:\n  1. Rotate log if over threshold\n  2. Prepend log entry\n  3. Stage files\n  4. Git commit\n  5. Close bead\n\nAll file paths are relative to worktree root.\n\nPartial success: If commit succeeds but bead close fails, exits 0 with bead_close_failed=true."
    )]
    Commit {
        /// Absolute path to the worktree directory
        #[arg(long, value_name = "PATH")]
        worktree: String,

        /// Step anchor (e.g., #step-0)
        #[arg(long, value_name = "ANCHOR")]
        step: String,

        /// Plan file path relative to repo root
        #[arg(long, value_name = "PATH")]
        plan: String,

        /// Git commit message
        #[arg(long, value_name = "MESSAGE")]
        message: String,

        /// Files to stage (relative to worktree root, repeatable)
        #[arg(long, value_name = "FILE", num_args = 1..)]
        files: Vec<String>,

        /// Bead ID to close (e.g., bd-abc123)
        #[arg(long, value_name = "BEAD_ID")]
        bead: String,

        /// One-line summary for log entry
        #[arg(long, value_name = "TEXT")]
        summary: String,

        /// Reason for closing the bead (optional)
        #[arg(long, value_name = "TEXT")]
        close_reason: Option<String>,
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
        let cli = Cli::try_parse_from(["tugtool", "init"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "init", "--force"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "init", "--check"]).unwrap();

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
        let result = Cli::try_parse_from(["tugtool", "init", "--check", "--force"]);
        assert!(
            result.is_err(),
            "--check and --force should be mutually exclusive"
        );
    }

    #[test]
    fn test_validate_command() {
        let cli = Cli::try_parse_from(["tugtool", "validate"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "validate", "tugplan-1.md"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "validate", "--level", "strict"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "validate", "--level", "lenient"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "validate", "--strict"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "list"]).unwrap();

        match cli.command {
            Some(Commands::List { status }) => {
                assert!(status.is_none());
            }
            _ => panic!("Expected List command"),
        }
    }

    #[test]
    fn test_status_command() {
        let cli = Cli::try_parse_from(["tugtool", "status", "tugplan-1.md"]).unwrap();

        match cli.command {
            Some(Commands::Status {
                file,
                verbose,
                full,
            }) => {
                assert_eq!(file, "tugplan-1.md");
                assert!(!verbose);
                assert!(!full);
            }
            _ => panic!("Expected Status command"),
        }
    }

    #[test]
    fn test_status_command_with_full() {
        let cli = Cli::try_parse_from(["tugtool", "status", "tugplan-1.md", "--full"]).unwrap();

        match cli.command {
            Some(Commands::Status {
                file,
                verbose,
                full,
            }) => {
                assert_eq!(file, "tugplan-1.md");
                assert!(!verbose);
                assert!(full);
            }
            _ => panic!("Expected Status command"),
        }
    }

    #[test]
    fn test_version_command() {
        let cli = Cli::try_parse_from(["tugtool", "version"]).unwrap();

        match cli.command {
            Some(Commands::Version { verbose }) => {
                assert!(!verbose);
            }
            _ => panic!("Expected Version command"),
        }
    }

    #[test]
    fn test_global_flags() {
        let cli = Cli::try_parse_from(["tugtool", "--json", "--quiet", "list"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "merge", ".tugtool/tugplan-1.md"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "merge", ".tugtool/tugplan-1.md", "--dry-run"])
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
            Cli::try_parse_from(["tugtool", "merge", ".tugtool/tugplan-1.md", "--force"]).unwrap();

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
            "tugtool",
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
        let cli = Cli::try_parse_from(["tugtool", "log", "rotate"]).unwrap();

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
        let cli = Cli::try_parse_from(["tugtool", "log", "rotate", "--force"]).unwrap();

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
            "#step-0",
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
                    bead,
                } => {
                    assert_eq!(step, "#step-0");
                    assert_eq!(plan, ".tugtool/tugplan-13.md");
                    assert_eq!(summary, "Completed step 0");
                    assert!(bead.is_none());
                }
                _ => panic!("Expected Log Prepend command"),
            },
            _ => panic!("Expected Log command"),
        }
    }

    #[test]
    fn test_log_prepend_command_with_bead() {
        let cli = Cli::try_parse_from([
            "tug",
            "log",
            "prepend",
            "--step",
            "#step-0",
            "--plan",
            ".tugtool/tugplan-13.md",
            "--summary",
            "Completed step 0",
            "--bead",
            "bd-abc123",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::Log(log_cmd)) => match log_cmd {
                LogCommands::Prepend {
                    step,
                    plan,
                    summary,
                    bead,
                } => {
                    assert_eq!(step, "#step-0");
                    assert_eq!(plan, ".tugtool/tugplan-13.md");
                    assert_eq!(summary, "Completed step 0");
                    assert_eq!(bead, Some("bd-abc123".to_string()));
                }
                _ => panic!("Expected Log Prepend command"),
            },
            _ => panic!("Expected Log command"),
        }
    }

    #[test]
    fn test_log_rotate_with_json_flag() {
        let cli = Cli::try_parse_from(["tugtool", "--json", "log", "rotate"]).unwrap();

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
            "#step-0",
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
        let cli = Cli::try_parse_from(["tugtool", "doctor"]).unwrap();

        match cli.command {
            Some(Commands::Doctor) => {}
            _ => panic!("Expected Doctor command"),
        }
    }

    #[test]
    fn test_doctor_with_json_flag() {
        let cli = Cli::try_parse_from(["tugtool", "--json", "doctor"]).unwrap();

        assert!(cli.json);
        match cli.command {
            Some(Commands::Doctor) => {}
            _ => panic!("Expected Doctor command"),
        }
    }

    #[test]
    fn test_doctor_with_quiet_flag() {
        let cli = Cli::try_parse_from(["tugtool", "--quiet", "doctor"]).unwrap();

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
            "#step-0",
            "--plan",
            ".tugtool/tugplan-1.md",
            "--message",
            "feat: add feature",
            "--files",
            "src/a.rs",
            "src/b.rs",
            "--bead",
            "bd-123",
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
                files,
                bead,
                summary,
                close_reason,
            }) => {
                assert_eq!(worktree, "/path/to/worktree");
                assert_eq!(step, "#step-0");
                assert_eq!(plan, ".tugtool/tugplan-1.md");
                assert_eq!(message, "feat: add feature");
                assert_eq!(files, vec!["src/a.rs", "src/b.rs"]);
                assert_eq!(bead, "bd-123");
                assert_eq!(summary, "Completed step 0");
                assert!(close_reason.is_none());
            }
            _ => panic!("Expected Commit command"),
        }
    }

    #[test]
    fn test_commit_with_close_reason() {
        let cli = Cli::try_parse_from([
            "tug",
            "commit",
            "--worktree",
            "/path",
            "--step",
            "#step-1",
            "--plan",
            ".tugtool/tugplan-2.md",
            "--message",
            "fix: something",
            "--files",
            "a.rs",
            "--bead",
            "bd-456",
            "--summary",
            "Done",
            "--close-reason",
            "Step completed successfully",
        ])
        .unwrap();

        match cli.command {
            Some(Commands::Commit { close_reason, .. }) => {
                assert_eq!(
                    close_reason,
                    Some("Step completed successfully".to_string())
                );
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
}
