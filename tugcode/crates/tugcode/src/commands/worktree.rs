//! Worktree CLI commands
//!
//! Provides subcommands for creating, listing, and cleaning up worktrees
//! for isolated plan implementation environments.

use clap::Subcommand;
use serde::Serialize;
use std::path::Path;
use tugtool_core::{
    ResolveResult, TugError, ValidationLevel, derive_tugplan_slug, resolve_plan,
    worktree::{
        CleanupMode, DiscoveredWorktree, WorktreeConfig, cleanup_worktrees, create_worktree,
        list_worktrees, remove_worktree, resolve_worktree,
    },
};

/// Worktree subcommands
#[derive(Subcommand, Debug)]
pub enum WorktreeCommands {
    /// Set up worktree for implementation
    ///
    /// Sets up a git worktree and branch for implementing a plan in isolation.
    #[command(name = "setup")]
    Setup {
        /// Plan file to implement
        plan: String,

        /// Base branch to create worktree from (default: main)
        #[arg(long, default_value = "main")]
        base: String,

        /// Skip validation checks (for migrating legacy plans)
        #[arg(long)]
        skip_validation: bool,
    },

    /// List active worktrees with progress
    ///
    /// Shows all worktrees with their branch and progress.
    #[command(
        long_about = "List active worktrees.\n\nDisplays:\n  - Branch name\n  - Worktree path\n  - Progress (completed / total steps)\n\nUse --json for machine-readable output."
    )]
    List,

    /// Remove worktrees based on cleanup mode
    ///
    /// Cleans up worktrees based on PR state.
    #[command(
        long_about = "Remove worktrees based on cleanup mode.\n\nModes:\n  --merged: Remove worktrees with merged PRs\n  --orphaned: Remove worktrees with no PR\n  --stale: Remove tug/* branches without worktrees\n  --all: Remove all eligible worktrees (merged + orphaned + closed + stale branches)\n\nUse --dry-run to preview what would be removed.\n\nWorktrees with open PRs are always protected."
    )]
    Cleanup {
        /// Only remove merged worktrees
        #[arg(long)]
        merged: bool,

        /// Only remove orphaned worktrees (no PR)
        #[arg(long)]
        orphaned: bool,

        /// Only remove stale branches (tug/* branches without worktrees)
        #[arg(long)]
        stale: bool,

        /// Remove all eligible worktrees (merged + orphaned + closed + stale branches)
        #[arg(long)]
        all: bool,

        /// Show what would be removed without removing
        #[arg(long)]
        dry_run: bool,
    },

    /// Remove a specific worktree
    ///
    /// Removes a worktree identified by plan path, branch name, or worktree path.
    #[command(
        long_about = "Remove a specific worktree.\n\nIdentifies worktree by (in resolution order):\n  1. Branch name (e.g., tugplan/14-20250209-172637)\n  2. Worktree path (e.g., /abs/path/.tugtree/tugplan__14-...)\n  3. Directory name (e.g., tugplan__14-20250209-172637)\n  4. Plan filename (e.g., .tugtool/tugplan-14.md)\n  5. Plan slug (e.g., dev-mode-notifications)\n  6. Plan prefix via resolve_plan fallback (e.g., dev)\n\nIf multiple worktrees match, an error is returned listing all\ncandidates. Use branch name or worktree path to disambiguate.\n\nUse --force to remove dirty worktrees with uncommitted changes."
    )]
    Remove {
        /// Target identifier (plan path, branch name, or worktree path)
        target: String,

        /// Force removal of dirty worktree
        #[arg(long)]
        force: bool,
    },
}

/// JSON output for setup command
#[derive(Serialize)]
pub struct SetupData {
    pub worktree_path: String,
    pub branch_name: String,
    pub base_branch: String,
    pub plan_path: String,
    pub total_steps: usize,
    #[serde(skip_serializing_if = "is_false")]
    pub reused: bool,
    // Plan-derived fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub all_steps: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready_steps: Option<Vec<String>>,
    // Tugstate fields
    #[serde(skip_serializing_if = "is_false")]
    pub state_initialized: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

fn is_false(b: &bool) -> bool {
    !b
}

/// JSON output for list command
#[derive(Serialize)]
pub struct ListData {
    pub worktrees: Vec<DiscoveredWorktree>,
}

/// JSON output for cleanup command
#[derive(Serialize)]
pub struct CleanupData {
    pub merged_removed: Vec<String>,
    pub orphaned_removed: Vec<String>,
    pub stale_branches_removed: Vec<String>,
    pub skipped: Vec<(String, String)>,
    pub dry_run: bool,
}

/// JSON output for remove command
#[derive(Serialize)]
pub struct RemoveData {
    pub worktree_path: String,
    pub branch_name: String,
    pub plan_path: String,
}

/// Ensure the working directory is a git repo with at least one commit on the base branch.
///
/// For fresh directories where the planner created a plan but git hasn't been initialized:
/// 1. Runs `git init -b <base>` if .git doesn't exist
/// 2. Creates an initial commit with .tugtool/ files if no commits exist
/// 3. Ensures the base branch exists
fn ensure_git_repo(repo_root: &Path, base_branch: &str) -> Result<(), String> {
    use std::process::Command;

    let git_dir = repo_root.join(".git");

    // Step 1: Initialize git if not a repo
    if !git_dir.exists() {
        let output = Command::new("git")
            .args(["init", "-b", base_branch])
            .current_dir(repo_root)
            .output()
            .map_err(|e| format!("Failed to run git init: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git init failed: {}", stderr));
        }
    }

    // Step 2: Check if any commits exist
    let has_commits = Command::new("git")
        .args([
            "-C",
            &repo_root.to_string_lossy(),
            "rev-parse",
            "--verify",
            "HEAD",
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !has_commits {
        // Stage .tugtool/ directory (includes plan, skeleton, config, log)
        let output = Command::new("git")
            .args(["-C", &repo_root.to_string_lossy(), "add", ".tugtool/"])
            .output()
            .map_err(|e| format!("Failed to stage files: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git add failed: {}", stderr));
        }

        // Also stage .gitignore if it exists
        if repo_root.join(".gitignore").exists() {
            let _ = Command::new("git")
                .args(["-C", &repo_root.to_string_lossy(), "add", ".gitignore"])
                .output();
        }

        // Create initial commit
        let output = Command::new("git")
            .args([
                "-C",
                &repo_root.to_string_lossy(),
                "commit",
                "-m",
                "Initial commit",
            ])
            .output()
            .map_err(|e| format!("Failed to create initial commit: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git commit failed: {}", stderr));
        }

        // Ensure base branch exists (current branch may differ if git was
        // initialized earlier without the -b flag)
        let base_exists = Command::new("git")
            .args([
                "-C",
                &repo_root.to_string_lossy(),
                "rev-parse",
                "--verify",
                base_branch,
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !base_exists {
            let output = Command::new("git")
                .args([
                    "-C",
                    &repo_root.to_string_lossy(),
                    "branch",
                    base_branch,
                    "HEAD",
                ])
                .output()
                .map_err(|e| format!("Failed to create {} branch: {}", base_branch, e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!(
                    "Failed to create {} branch: {}",
                    base_branch, stderr
                ));
            }
        }
    }

    Ok(())
}

/// Rollback worktree creation by removing worktree and branch
fn rollback_worktree_creation(
    worktree_path: &Path,
    branch_name: &str,
    repo_root: &Path,
) -> Result<(), tugtool_core::error::TugError> {
    use std::process::Command;

    // Remove worktree directory
    let _ = Command::new("git")
        .args([
            "-C",
            &repo_root.to_string_lossy(),
            "worktree",
            "remove",
            &worktree_path.to_string_lossy(),
            "--force",
        ])
        .status();

    // Delete branch
    let _ = Command::new("git")
        .args([
            "-C",
            &repo_root.to_string_lossy(),
            "branch",
            "-D",
            branch_name,
        ])
        .status();

    Ok(())
}

/// Run worktree setup command
///
/// If `override_root` is provided, use it instead of `current_dir()`.
/// This avoids the `set_current_dir` anti-pattern in tests.
pub fn run_worktree_setup(
    plan: String,
    base: String,
    skip_validation: bool,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    run_worktree_setup_with_root(plan, base, skip_validation, json_output, quiet, None)
}

/// Inner implementation that accepts an explicit repo root.
pub fn run_worktree_setup_with_root(
    plan: String,
    base: String,
    skip_validation: bool,
    json_output: bool,
    quiet: bool,
    override_root: Option<&Path>,
) -> Result<i32, String> {
    let repo_root = match override_root {
        Some(root) => root.to_path_buf(),
        None => match tugtool_core::find_repo_root() {
            Ok(root) => root,
            Err(tugtool_core::TugError::NotAGitRepository) => {
                // Fresh directory — ensure_git_repo() below will initialize git
                std::env::current_dir().map_err(|e| e.to_string())?
            }
            Err(e) => return Err(e.to_string()),
        },
    };

    // Resolve plan path and strip repo_root to get relative path
    let (plan, plan_path) = match resolve_plan(&plan, &repo_root) {
        Ok(ResolveResult::Found { path, .. }) => {
            // Get relative path from absolute resolved path
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            let plan_str = relative_path.to_string_lossy().to_string();
            (plan_str, relative_path)
        }
        Ok(ResolveResult::NotFound) | Ok(ResolveResult::Ambiguous(_)) => {
            if json_output {
                println!(r#"{{"error": "Plan file not found: {}"}}"#, plan);
            } else if !quiet {
                eprintln!("error: Plan file not found: {}", plan);
            }
            return Ok(7);
        }
        Err(TugError::NotInitialized) => {
            if json_output {
                println!(r#"{{"error": ".tugtool directory not initialized"}}"#);
            } else if !quiet {
                eprintln!("error: .tugtool directory not initialized");
            }
            return Ok(9);
        }
        Err(e) => {
            if json_output {
                println!(r#"{{"error": "Resolution failed: {}"}}"#, e);
            } else if !quiet {
                eprintln!("error: Resolution failed: {}", e);
            }
            return Ok(e.exit_code());
        }
    };

    // Pre-flight validation (unless --skip-validation is used)
    if !skip_validation {
        // Read plan content
        let plan_content = std::fs::read_to_string(repo_root.join(&plan_path))
            .map_err(|e| format!("Failed to read plan: {}", e))?;

        // Parse plan
        let parsed_plan = match tugtool_core::parse_tugplan(&plan_content) {
            Ok(s) => s,
            Err(e) => {
                if json_output {
                    println!(r#"{{"error": "Parse error: {}"}}"#, e);
                } else if !quiet {
                    eprintln!("error: Parse error: {}", e);
                    eprintln!(
                        "\nPlan failed to parse. Fix the parse errors before creating worktree."
                    );
                }
                return Ok(8); // Exit code 8: Validation failed
            }
        };

        // Validate with normal level
        let validation_config = tugtool_core::validator::ValidationConfig {
            level: ValidationLevel::Normal,
        };
        let validation_result =
            tugtool_core::validate_tugplan_with_config(&parsed_plan, &validation_config);

        // Check for validation errors or diagnostics
        if !validation_result.valid || !validation_result.diagnostics.is_empty() {
            if json_output {
                // Format JSON error response with validation details
                use crate::output::{JsonDiagnostic, JsonIssue};

                let issues: Vec<JsonIssue> = validation_result
                    .issues
                    .iter()
                    .map(|i| JsonIssue::from(i).with_file(&plan))
                    .collect();

                let diagnostics: Vec<JsonDiagnostic> = validation_result
                    .diagnostics
                    .iter()
                    .map(|d| JsonDiagnostic::from(d).with_file(&plan))
                    .collect();

                let error_data = serde_json::json!({
                    "error": "Validation failed",
                    "issues": issues,
                    "diagnostics": diagnostics
                });
                println!("{}", serde_json::to_string_pretty(&error_data).unwrap());
            } else if !quiet {
                eprintln!("error: Plan failed validation");
                eprintln!("\nValidation issues:");

                // Print validation errors
                for issue in &validation_result.issues {
                    if let Some(line) = issue.line {
                        eprintln!("  error[{}]: line {}: {}", issue.code, line, issue.message);
                    } else {
                        eprintln!("  error[{}]: {}", issue.code, issue.message);
                    }
                }

                // Print parse diagnostics
                if !validation_result.diagnostics.is_empty() {
                    eprintln!("\nDiagnostics:");
                    for diagnostic in &validation_result.diagnostics {
                        eprintln!(
                            "  warning[{}]: line {}: {}",
                            diagnostic.code, diagnostic.line, diagnostic.message
                        );
                        if let Some(ref suggestion) = diagnostic.suggestion {
                            eprintln!("    suggestion: {}", suggestion);
                        }
                    }
                }

                eprintln!("\nFix validation issues before creating worktree.");
                eprintln!("Run: tugtool validate {}", plan);
                eprintln!("Or use --skip-validation to bypass this check.");
            }
            return Ok(8); // Exit code 8: Validation failed
        }
    }

    // Ensure git repository is ready (auto-init for fresh directories)
    ensure_git_repo(&repo_root, &base)?;

    // Commit the plan file to the current branch so it's in the worktree after branching
    {
        use std::process::Command;
        let root_str = repo_root.to_string_lossy();

        // Stage the plan file
        let _ = Command::new("git")
            .args(["-C", &root_str, "add", &plan])
            .output();

        // Check if anything is staged
        let staged = Command::new("git")
            .args(["-C", &root_str, "diff", "--cached", "--quiet"])
            .status()
            .map(|s| !s.success()) // exit 1 = something staged
            .unwrap_or(false);

        if staged {
            let plan_filename = plan_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("tugplan");
            let msg = format!("Add {}", plan_filename);
            let _ = Command::new("git")
                .args(["-C", &root_str, "commit", "-m", &msg])
                .output();
        }
    }

    let config = WorktreeConfig {
        plan_path: plan_path.clone(),
        base_branch: base,
        repo_root: repo_root.clone(),
    };

    match create_worktree(&config) {
        Ok((worktree_path, branch_name, _plan_slug)) => {
            let _plan_name = plan_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown");

            // Reuse detection is now handled by find_existing_worktree() in core
            // We can determine reuse by checking if the worktree already had content
            let reused = worktree_path.join(".tugtool").exists();

            // Ensure plan file exists in worktree (it may not be committed to base branch)
            if !reused {
                let worktree_plan = worktree_path.join(&plan_path);
                if !worktree_plan.exists() {
                    let source_plan = repo_root.join(&plan_path);
                    if let Some(parent) = worktree_plan.parent() {
                        if let Err(e) = std::fs::create_dir_all(parent) {
                            let _ = rollback_worktree_creation(
                                &worktree_path,
                                &branch_name,
                                &repo_root,
                            );
                            return Err(format!(
                                "Failed to create plan directory in worktree: {}",
                                e
                            ));
                        }
                    }
                    if let Err(e) = std::fs::copy(&source_plan, &worktree_plan) {
                        let _ =
                            rollback_worktree_creation(&worktree_path, &branch_name, &repo_root);
                        return Err(format!("Failed to copy plan to worktree: {}", e));
                    }
                }
            }

            // Run tugtool init in the worktree (idempotent, creates .tugtool/ infrastructure)
            let init_result = std::env::current_exe()
                .map_err(|e| tugtool_core::error::TugError::InitFailed {
                    reason: format!("failed to get current executable: {}", e),
                })
                .and_then(|exe| {
                    use std::process::Command;
                    Command::new(exe)
                        .arg("init")
                        .current_dir(&worktree_path)
                        .output()
                        .map_err(|e| tugtool_core::error::TugError::InitFailed {
                            reason: format!("failed to execute init: {}", e),
                        })
                })
                .and_then(|output| {
                    if output.status.success() {
                        Ok(())
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        Err(tugtool_core::error::TugError::InitFailed {
                            reason: format!("init failed: {}", stderr),
                        })
                    }
                });

            if let Err(e) = init_result {
                // Init failed - rollback
                let _ = rollback_worktree_creation(&worktree_path, &branch_name, &repo_root);

                if json_output {
                    let data = SetupData {
                        worktree_path: String::new(),
                        branch_name: String::new(),
                        base_branch: config.base_branch.clone(),
                        plan_path: plan.clone(),
                        total_steps: 0,
                        reused: false,
                        all_steps: None,
                        ready_steps: None,
                        state_initialized: false,
                        warnings: vec![],
                    };
                    eprintln!(
                        "{}",
                        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
                    );
                } else if !quiet {
                    eprintln!("error: {}", e);
                    eprintln!("Rolled back worktree creation");
                }
                return Ok(e.exit_code());
            }

            let synced_plan_path = worktree_path.join(&plan);
            let synced_plan_content = std::fs::read_to_string(&synced_plan_path)
                .map_err(|e| format!("failed to read synced plan: {}", e))?;
            let synced_plan = tugtool_core::parse_tugplan(&synced_plan_content)
                .map_err(|e| format!("failed to parse synced plan: {}", e))?;

            let all_steps: Vec<String> =
                synced_plan.steps.iter().map(|s| s.anchor.clone()).collect();
            let total_steps = synced_plan.steps.len();

            // ready_steps is computed from tugstate claim operation (orchestrator responsibility)
            let ready_steps: Option<Vec<String>> = None;

            // Initialize tugstate for this worktree
            let (state_initialized, state_warnings) = {
                let db_path = repo_root.join(".tugtool").join("state.db");
                match tugtool_core::compute_plan_hash(&synced_plan_path) {
                    Ok(plan_hash) => match tugtool_core::StateDb::open(&db_path) {
                        Ok(mut db) => match db.init_plan(&plan, &synced_plan, &plan_hash) {
                            Ok(_) => (true, vec![]),
                            Err(e) => {
                                let msg = format!("state init failed: {}", e);
                                if !quiet {
                                    eprintln!("warning: {}", msg);
                                }
                                (false, vec![msg])
                            }
                        },
                        Err(e) => {
                            let msg = format!("state init failed: {}", e);
                            if !quiet {
                                eprintln!("warning: {}", msg);
                            }
                            (false, vec![msg])
                        }
                    },
                    Err(e) => {
                        let msg = format!("state init failed: {}", e);
                        if !quiet {
                            eprintln!("warning: {}", msg);
                        }
                        (false, vec![msg])
                    }
                }
            };

            // Create artifact directories inside worktree
            let artifacts_base = worktree_path.join(".tugtool/artifacts");
            if let Err(e) = std::fs::create_dir_all(&artifacts_base) {
                eprintln!("warning: failed to create artifacts base directory: {}", e);
            }

            // Create per-step artifact directories using step anchors as directory names
            for step_anchor in &all_steps {
                let step_dir = artifacts_base.join(step_anchor);
                if let Err(e) = std::fs::create_dir_all(&step_dir) {
                    eprintln!(
                        "warning: failed to create {} artifact directory: {}",
                        step_anchor, e
                    );
                }
            }

            if json_output {
                let data = SetupData {
                    worktree_path: worktree_path.display().to_string(),
                    branch_name: branch_name.clone(),
                    base_branch: config.base_branch.clone(),
                    plan_path: plan.clone(),
                    total_steps,
                    reused,
                    all_steps: Some(all_steps),
                    ready_steps,
                    state_initialized,
                    warnings: state_warnings.clone(),
                };
                println!(
                    "{}",
                    serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
                );
            } else if !quiet {
                if reused {
                    println!("Reused existing worktree for plan: {}", plan);
                } else {
                    println!("Created worktree for plan: {}", plan);
                }
                println!("  Branch: {}", branch_name);
                println!("  Worktree: {}", worktree_path.display());
                println!("  Steps: {}", total_steps);
                if state_initialized {
                    println!("  State initialized");
                }
                for w in &state_warnings {
                    println!("  Warning: {}", w);
                }
            }
            Ok(0)
        }
        Err(e) => {
            // Map error to appropriate exit code
            let exit_code = match &e {
                tugtool_core::error::TugError::NotAGitRepository => 5,
                tugtool_core::error::TugError::GitVersionInsufficient => 4,
                tugtool_core::error::TugError::BaseBranchNotFound { .. } => 6,
                tugtool_core::error::TugError::PlanHasNoSteps => 8,
                tugtool_core::error::TugError::WorktreeAlreadyExists => 3,
                _ => 1,
            };

            if json_output {
                eprintln!(r#"{{"error": "{}"}}"#, e);
            } else if !quiet {
                eprintln!("error: {}", e);
            }
            Ok(exit_code)
        }
    }
}

/// Run worktree list command
pub fn run_worktree_list(json_output: bool, quiet: bool) -> Result<i32, String> {
    run_worktree_list_with_root(json_output, quiet, None)
}

/// Inner implementation that accepts an explicit repo root.
pub fn run_worktree_list_with_root(
    json_output: bool,
    quiet: bool,
    override_root: Option<&Path>,
) -> Result<i32, String> {
    let repo_root = match override_root {
        Some(root) => root.to_path_buf(),
        None => tugtool_core::find_repo_root().map_err(|e| e.to_string())?,
    };

    match list_worktrees(&repo_root) {
        Ok(worktrees) => {
            if json_output {
                let data = ListData { worktrees };
                println!(
                    "{}",
                    serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
                );
            } else if !quiet {
                if worktrees.is_empty() {
                    println!("No active worktrees");
                } else {
                    println!("Active worktrees:\n");
                    for wt in worktrees {
                        println!("  Branch:      {}", wt.branch);
                        println!("  Path:        {}", wt.path.display());
                        println!("  Plan slug:  {}", wt.plan_slug);
                        println!("  Base branch: {}", wt.base_branch);
                        println!();
                    }
                }
            }
            Ok(0)
        }
        Err(e) => {
            if json_output {
                eprintln!(r#"{{"error": "{}"}}"#, e);
            } else if !quiet {
                eprintln!("error: {}", e);
            }
            Ok(1)
        }
    }
}

/// Run worktree cleanup command
pub fn run_worktree_cleanup(
    merged: bool,
    orphaned: bool,
    stale: bool,
    all: bool,
    dry_run: bool,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    run_worktree_cleanup_with_root(
        merged,
        orphaned,
        stale,
        all,
        dry_run,
        json_output,
        quiet,
        None,
    )
}

/// Inner implementation that accepts an explicit repo root.
#[allow(clippy::too_many_arguments)]
pub fn run_worktree_cleanup_with_root(
    merged: bool,
    orphaned: bool,
    stale: bool,
    all: bool,
    dry_run: bool,
    json_output: bool,
    quiet: bool,
    override_root: Option<&Path>,
) -> Result<i32, String> {
    let repo_root = match override_root {
        Some(root) => root.to_path_buf(),
        None => tugtool_core::find_repo_root().map_err(|e| e.to_string())?,
    };

    // Determine cleanup mode
    let mode = if all {
        CleanupMode::All
    } else if stale {
        CleanupMode::Stale
    } else if orphaned {
        CleanupMode::Orphaned
    } else if merged {
        CleanupMode::Merged
    } else {
        // Default to Merged for backward compatibility
        CleanupMode::Merged
    };

    match cleanup_worktrees(&repo_root, mode, dry_run) {
        Ok(result) => {
            if json_output {
                let data = CleanupData {
                    merged_removed: result.merged_removed.clone(),
                    orphaned_removed: result.orphaned_removed.clone(),
                    stale_branches_removed: result.stale_branches_removed.clone(),
                    skipped: result.skipped.clone(),
                    dry_run,
                };
                println!(
                    "{}",
                    serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
                );
            } else if !quiet {
                let total_removed = result.merged_removed.len()
                    + result.orphaned_removed.len()
                    + result.stale_branches_removed.len();

                if dry_run {
                    if total_removed == 0 {
                        println!("No worktrees or branches to remove");
                    } else {
                        println!("Would remove {} item(s):", total_removed);
                        if !result.merged_removed.is_empty() {
                            println!("\nMerged PRs:");
                            for branch in &result.merged_removed {
                                println!("  - {}", branch);
                            }
                        }
                        if !result.orphaned_removed.is_empty() {
                            println!("\nOrphaned (no PR):");
                            for branch in &result.orphaned_removed {
                                println!("  - {}", branch);
                            }
                        }
                        if !result.stale_branches_removed.is_empty() {
                            println!("\nStale branches (no worktree):");
                            for branch in &result.stale_branches_removed {
                                println!("  - {}", branch);
                            }
                        }
                    }
                } else if total_removed == 0 {
                    println!("No worktrees or branches removed");
                } else {
                    println!("Removed {} item(s):", total_removed);
                    if !result.merged_removed.is_empty() {
                        println!("\nMerged PRs:");
                        for branch in &result.merged_removed {
                            println!("  - {}", branch);
                        }
                    }
                    if !result.orphaned_removed.is_empty() {
                        println!("\nOrphaned (no PR):");
                        for branch in &result.orphaned_removed {
                            println!("  - {}", branch);
                        }
                    }
                    if !result.stale_branches_removed.is_empty() {
                        println!("\nStale branches (no worktree):");
                        for branch in &result.stale_branches_removed {
                            println!("  - {}", branch);
                        }
                    }
                }

                if !result.skipped.is_empty() {
                    println!("\nSkipped {} item(s):", result.skipped.len());
                    for (branch, reason) in &result.skipped {
                        println!("  - {}: {}", branch, reason);
                    }
                }
            }
            Ok(0)
        }
        Err(e) => {
            if json_output {
                eprintln!(r#"{{"error": "{}"}}"#, e);
            } else if !quiet {
                eprintln!("error: {}", e);
            }
            Ok(1)
        }
    }
}

/// Run worktree remove command
pub fn run_worktree_remove(
    target: String,
    force: bool,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    run_worktree_remove_with_root(target, force, json_output, quiet, None)
}

/// Inner implementation that accepts an explicit repo root.
pub fn run_worktree_remove_with_root(
    target: String,
    force: bool,
    json_output: bool,
    quiet: bool,
    override_root: Option<&Path>,
) -> Result<i32, String> {
    use std::process::Command;

    let repo_root = match override_root {
        Some(root) => root.to_path_buf(),
        None => tugtool_core::find_repo_root().map_err(|e| e.to_string())?,
    };

    // List all worktrees
    let worktrees = list_worktrees(&repo_root).map_err(|e| e.to_string())?;

    // Resolve target via the 5-stage cascade
    let mut matches = resolve_worktree(&target, &worktrees);

    // If no matches, try resolve_plan fallback (prefix matching, etc.)
    if matches.is_empty() {
        if let Ok(ResolveResult::Found { path, .. }) = resolve_plan(&target, &repo_root) {
            let slug = derive_tugplan_slug(&path);
            matches = worktrees.iter().filter(|wt| wt.plan_slug == slug).collect();
        }
    }

    // Handle match count
    if matches.len() > 1 {
        if json_output {
            eprintln!(r#"{{"error": "Multiple worktrees found for {}"}}"#, target);
        } else if !quiet {
            eprintln!("Error: Multiple worktrees found for {}\n", target);
            for wt in &matches {
                eprintln!("  {}  {}", wt.branch, wt.path.display());
            }
            eprintln!("\nUse branch name or worktree path to disambiguate:");
            if let Some(first) = matches.first() {
                eprintln!("  tug worktree remove {}", first.branch);
            }
        }
        return Ok(1);
    }

    let worktree = if matches.len() == 1 {
        matches[0]
    } else {
        if json_output {
            eprintln!(r#"{{"error": "No worktree found matching: {}"}}"#, target);
        } else if !quiet {
            eprintln!("error: No worktree found matching: {}", target);
        }
        return Ok(1);
    };

    // Check if worktree has uncommitted changes (unless --force)
    if !force {
        let status_output = Command::new("git")
            .args([
                "-C",
                &worktree.path.to_string_lossy(),
                "status",
                "--porcelain",
            ])
            .output()
            .map_err(|e| format!("failed to check git status: {}", e))?;

        if status_output.status.success() {
            let stdout = String::from_utf8_lossy(&status_output.stdout);
            if !stdout.trim().is_empty() {
                if json_output {
                    eprintln!(
                        r#"{{"error": "Worktree has uncommitted changes. Use --force to override."}}"#
                    );
                } else if !quiet {
                    eprintln!("error: Worktree has uncommitted changes");
                    eprintln!("Use --force to override:");
                    eprintln!("  tug worktree remove {} --force", target);
                }
                return Ok(1);
            }
        }
    }

    // Remove the worktree
    let worktree_path = &worktree.path;

    // If --force is passed, we need to manually force-remove the worktree
    if force {
        // Use git worktree remove --force directly
        let remove_output = Command::new("git")
            .args([
                "-C",
                &repo_root.to_string_lossy(),
                "worktree",
                "remove",
                "--force",
                &worktree_path.to_string_lossy(),
            ])
            .output()
            .map_err(|e| format!("failed to remove worktree: {}", e))?;

        if !remove_output.status.success() {
            let stderr = String::from_utf8_lossy(&remove_output.stderr);
            if json_output {
                eprintln!(r#"{{"error": "Failed to remove worktree: {}"}}"#, stderr);
            } else if !quiet {
                eprintln!("error: Failed to remove worktree: {}", stderr);
            }
            return Ok(1);
        }
    } else {
        // Use the remove_worktree function which handles cleanup
        if let Err(e) = remove_worktree(worktree_path, &repo_root) {
            if json_output {
                eprintln!(r#"{{"error": "{}"}}"#, e);
            } else if !quiet {
                eprintln!("error: {}", e);
            }
            return Ok(1);
        }
    }

    // Delete the branch
    let delete_output = Command::new("git")
        .args([
            "-C",
            &repo_root.to_string_lossy(),
            "branch",
            "-D",
            &worktree.branch,
        ])
        .output()
        .map_err(|e| format!("failed to delete branch: {}", e))?;

    if !delete_output.status.success() {
        let stderr = String::from_utf8_lossy(&delete_output.stderr);
        // Warn but don't fail - worktree removal succeeded
        if !quiet && !json_output {
            eprintln!("warning: Failed to delete branch: {}", stderr);
        }
    }

    // Prune stale worktree metadata
    let _ = Command::new("git")
        .args(["-C", &repo_root.to_string_lossy(), "worktree", "prune"])
        .output();

    if json_output {
        let plan_path = format!(".tugtool/tugplan-{}.md", worktree.plan_slug);
        let data = RemoveData {
            worktree_path: worktree_path.display().to_string(),
            branch_name: worktree.branch.clone(),
            plan_path,
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Removed worktree:");
        println!("  Branch: {}", worktree.branch);
        println!("  Worktree: {}", worktree_path.display());
        println!("  Plan slug: {}", worktree.plan_slug);
    }

    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_data_serialization() {
        let data = SetupData {
            worktree_path: "/path/to/worktree".to_string(),
            branch_name: "tug/test-20260208-120000".to_string(),
            base_branch: "main".to_string(),
            plan_path: ".tugtool/tugplan-test.md".to_string(),
            total_steps: 5,
            reused: false,
            all_steps: None,
            ready_steps: None,
            state_initialized: false,
            warnings: vec![],
        };

        let json = serde_json::to_string(&data).expect("serialization should succeed");
        assert!(json.contains("worktree_path"));
        assert!(json.contains("branch_name"));
        // reused should be skipped when false
        assert!(!json.contains("reused"));
        // state_initialized should be skipped when false
        assert!(!json.contains("state_initialized"));
        // warnings should be skipped when empty
        assert!(!json.contains("warnings"));
        // session fields should not be present
        assert!(!json.contains("session_id"));
        assert!(!json.contains("session_file"));
        assert!(!json.contains("artifacts_base"));
    }

    #[test]
    fn test_create_data_state_initialized_serialization() {
        let data = SetupData {
            worktree_path: "/path/to/worktree".to_string(),
            branch_name: "tug/test-20260208-120000".to_string(),
            base_branch: "main".to_string(),
            plan_path: ".tugtool/tugplan-test.md".to_string(),
            total_steps: 5,
            reused: false,
            all_steps: None,
            ready_steps: None,
            state_initialized: true,
            warnings: vec![],
        };
        let json = serde_json::to_string(&data).expect("serialization should succeed");
        assert!(json.contains("state_initialized"));
        assert!(json.contains("true"));
        // warnings should be skipped when empty
        assert!(!json.contains("warnings"));
    }

    #[test]
    fn test_create_data_warnings_serialization() {
        let data = SetupData {
            worktree_path: "/path/to/worktree".to_string(),
            branch_name: "tug/test-20260208-120000".to_string(),
            base_branch: "main".to_string(),
            plan_path: ".tugtool/tugplan-test.md".to_string(),
            total_steps: 5,
            reused: false,
            all_steps: None,
            ready_steps: None,
            state_initialized: false,
            warnings: vec!["state init failed: forced".to_string()],
        };
        let json = serde_json::to_string(&data).expect("serialization should succeed");
        assert!(json.contains("warnings"));
        assert!(json.contains("state init failed: forced"));
    }

    #[test]
    fn test_list_data_serialization() {
        let data = ListData { worktrees: vec![] };

        let json = serde_json::to_string(&data).expect("serialization should succeed");
        assert!(json.contains("worktrees"));
    }

    #[test]
    fn test_cleanup_data_serialization() {
        let data = CleanupData {
            merged_removed: vec!["tug/merged-123".to_string()],
            orphaned_removed: vec!["tug/orphan-456".to_string()],
            stale_branches_removed: vec![],
            skipped: vec![("tug/skip-789".to_string(), "InProgress".to_string())],
            dry_run: true,
        };

        let json = serde_json::to_string(&data).expect("serialization should succeed");
        assert!(json.contains("merged_removed"));
        assert!(json.contains("orphaned_removed"));
        assert!(json.contains("stale_branches_removed"));
        assert!(json.contains("skipped"));
        assert!(json.contains("dry_run"));
    }

    #[test]
    fn test_remove_data_serialization() {
        let data = RemoveData {
            worktree_path: ".tugtree/tugplan__test-20260210-120000".to_string(),
            branch_name: "tugplan/test-20260210-120000".to_string(),
            plan_path: ".tugtool/tugplan-test.md".to_string(),
        };

        let json = serde_json::to_string(&data).expect("serialization should succeed");
        assert!(json.contains("worktree_path"));
        assert!(json.contains("branch_name"));
        assert!(json.contains("plan_path"));
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use tempfile::TempDir;

    /// Create a test git repository with a minimal plan
    fn setup_test_repo() -> (TempDir, PathBuf) {
        let temp = tempfile::tempdir().expect("failed to create temp dir");
        let repo_path = temp.path().to_path_buf();

        // Initialize git repo with explicit main branch
        Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&repo_path)
            .output()
            .expect("failed to init git repo");

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .expect("failed to set git user.email");

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .expect("failed to set git user.name");

        // Create .tugtool directory and a minimal tugplan
        let tugtool_dir = repo_path.join(".tugtool");
        fs::create_dir(&tugtool_dir).expect("failed to create .tugtool dir");

        let plan_path = tugtool_dir.join("tugplan-test.md");
        let plan_content = r#"## Phase 1.0: Test {#phase-1}

**Purpose:** Test plan.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-08 |

---

### 1.0.0 Execution Steps {#execution-steps}

#### Step 0: Test Step {#step-0}

**Tasks:**
- [ ] Test task
"#;
        fs::write(&plan_path, plan_content).expect("failed to write plan");

        // Initial commit
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .expect("failed to git add");

        Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&repo_path)
            .output()
            .expect("failed to git commit");

        (temp, repo_path)
    }

    #[test]
    fn test_create_worktree_succeeds() {
        let (_temp, repo_path) = setup_test_repo();
        let plan_path = ".tugtool/tugplan-test.md";

        let config = WorktreeConfig {
            plan_path: PathBuf::from(plan_path),
            base_branch: "main".to_string(),
            repo_root: repo_path.clone(),
        };

        let result = create_worktree(&config);
        assert!(
            result.is_ok(),
            "create_worktree should succeed: {:?}",
            result.err()
        );

        let (worktree_path, branch_name, plan_slug) = result.unwrap();
        assert_eq!(plan_slug, "test");
        assert!(branch_name.starts_with("tugplan/test-"));

        // Verify worktree directory exists
        assert!(worktree_path.exists(), "worktree directory should exist");
    }

    #[test]
    fn test_ensure_git_repo_initializes_fresh_directory() {
        let temp = tempfile::tempdir().expect("failed to create temp dir");
        let repo_path = temp.path().to_path_buf();

        // Create .tugtool directory with a plan (simulates post-planner state)
        let tugtool_dir = repo_path.join(".tugtool");
        fs::create_dir(&tugtool_dir).expect("failed to create .tugtool dir");
        fs::write(
            tugtool_dir.join("tugplan-test.md"),
            "# Test plan\n## Phase {#phase-1}\n",
        )
        .expect("failed to write plan");

        // No .git directory exists yet
        assert!(!repo_path.join(".git").exists());

        // Configure git identity for the test
        // (ensure_git_repo needs this for the initial commit)
        let result = ensure_git_repo(&repo_path, "main");
        if result.is_err() {
            // May fail if git user.name/email not configured globally;
            // configure them and retry
            Command::new("git")
                .args(["config", "user.email", "test@example.com"])
                .current_dir(&repo_path)
                .output()
                .expect("failed to set git user.email");
            Command::new("git")
                .args(["config", "user.name", "Test User"])
                .current_dir(&repo_path)
                .output()
                .expect("failed to set git user.name");

            ensure_git_repo(&repo_path, "main")
                .expect("ensure_git_repo should succeed after config");
        }

        // Verify: .git exists
        assert!(repo_path.join(".git").exists(), ".git should exist");

        // Verify: main branch exists with a commit
        let output = Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "rev-parse",
                "--verify",
                "main",
            ])
            .output()
            .expect("failed to check main branch");
        assert!(output.status.success(), "main branch should exist");

        // Verify: .tugtool/ is committed
        let output = Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "ls-tree",
                "--name-only",
                "HEAD",
            ])
            .output()
            .expect("failed to list committed files");
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains(".tugtool"),
            ".tugtool should be committed, got: {}",
            stdout
        );
    }

    #[test]
    fn test_ensure_git_repo_noop_for_existing_repo() {
        let (_temp, repo_path) = setup_test_repo();

        // Get the current HEAD commit
        let before = Command::new("git")
            .args(["-C", &repo_path.to_string_lossy(), "rev-parse", "HEAD"])
            .output()
            .expect("failed to get HEAD");
        let before_hash = String::from_utf8_lossy(&before.stdout).trim().to_string();

        // Run ensure_git_repo — should be a no-op
        ensure_git_repo(&repo_path, "main").expect("ensure_git_repo should succeed");

        // Verify HEAD hasn't changed
        let after = Command::new("git")
            .args(["-C", &repo_path.to_string_lossy(), "rev-parse", "HEAD"])
            .output()
            .expect("failed to get HEAD");
        let after_hash = String::from_utf8_lossy(&after.stdout).trim().to_string();

        assert_eq!(
            before_hash, after_hash,
            "HEAD should not change for existing repo"
        );
    }
}
