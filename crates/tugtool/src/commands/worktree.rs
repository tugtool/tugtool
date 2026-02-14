//! Worktree CLI commands
//!
//! Provides subcommands for creating, listing, and cleaning up worktrees
//! for isolated plan implementation environments.

use clap::Subcommand;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tugtool_core::{
    ValidationLevel,
    worktree::{
        CleanupMode, DiscoveredWorktree, WorktreeConfig, cleanup_worktrees, create_worktree,
        list_worktrees, remove_worktree,
    },
};

/// Worktree subcommands
#[derive(Subcommand, Debug)]
pub enum WorktreeCommands {
    /// Create worktree for implementation
    ///
    /// Creates a git worktree and branch for implementing a plan in isolation.
    #[command(
        long_about = "Create worktree for plan implementation.\n\nCreates:\n  - Branch: tugtool/<slug>-<timestamp>\n  - Worktree: .tugtool-worktrees/<sanitized-branch-name>/\n\nBeads sync is always-on:\n  - Atomically syncs beads and commits annotations in worktree\n  - Full rollback if sync or commit fails\n\nWorktree creation is idempotent:\n  - Returns existing worktree if one exists for this plan\n  - Creates new worktree if none exists\n\nValidates that the plan has at least one execution step."
    )]
    Create {
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
        long_about = "Remove a specific worktree.\n\nIdentifies worktree by:\n  - Plan path (e.g., .tugtool/tugplan-14.md)\n  - Branch name (e.g., tugtool/14-20250209-172637)\n  - Worktree path (e.g., .tugtool-worktrees/tugtool__14-...)\n\nIf multiple worktrees match a plan path, an error is returned\nlisting all candidates. Use branch name or worktree path to disambiguate.\n\nUse --force to remove dirty worktrees with uncommitted changes."
    )]
    Remove {
        /// Target identifier (plan path, branch name, or worktree path)
        target: String,

        /// Force removal of dirty worktree
        #[arg(long)]
        force: bool,
    },
}

/// JSON output for create command
#[derive(Serialize)]
pub struct CreateData {
    pub worktree_path: String,
    pub branch_name: String,
    pub base_branch: String,
    pub plan_path: String,
    pub total_steps: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bead_mapping: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_bead_id: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    pub reused: bool,
    // Bead-derived fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub all_steps: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready_steps: Option<Vec<String>>,
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

/// Sync beads within the worktree and return bead mapping
fn sync_beads_in_worktree(
    worktree_path: &Path,
    plan_path: &str,
) -> Result<
    (std::collections::HashMap<String, String>, Option<String>),
    tugtool_core::error::TugError,
> {
    use crate::commands::beads::sync::SyncData;
    use crate::output::JsonResponse;
    use std::process::Command;

    // Run tug beads sync in the worktree
    let output = Command::new(std::env::current_exe().map_err(|e| {
        tugtool_core::error::TugError::BeadsSyncFailed {
            reason: format!("failed to get current exe: {}", e),
        }
    })?)
    .args(["beads", "sync", plan_path, "--json"])
    .current_dir(worktree_path)
    .output()
    .map_err(|e| tugtool_core::error::TugError::BeadsSyncFailed {
        reason: format!("failed to execute beads sync: {}", e),
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(tugtool_core::error::TugError::BeadsSyncFailed {
            reason: format!("beads sync failed: {}", stderr),
        });
    }

    // Parse JSON output
    let stdout = String::from_utf8_lossy(&output.stdout);
    let response: JsonResponse<SyncData> = serde_json::from_str(&stdout).map_err(|e| {
        tugtool_core::error::TugError::BeadsSyncFailed {
            reason: format!("failed to parse sync output: {}", e),
        }
    })?;

    if response.status != "ok" {
        return Err(tugtool_core::error::TugError::BeadsSyncFailed {
            reason: "beads sync returned error status".to_string(),
        });
    }

    // Re-parse the plan to extract bead mapping
    let plan_content = std::fs::read_to_string(worktree_path.join(plan_path)).map_err(|e| {
        tugtool_core::error::TugError::BeadsSyncFailed {
            reason: format!("failed to read synced plan: {}", e),
        }
    })?;

    let parsed_plan = tugtool_core::parse_tugplan(&plan_content).map_err(|e| {
        tugtool_core::error::TugError::BeadsSyncFailed {
            reason: format!("failed to parse synced plan: {}", e),
        }
    })?;

    // Build bead mapping from step anchors to bead IDs
    let mut bead_mapping = std::collections::HashMap::new();
    for step in &parsed_plan.steps {
        if let Some(ref bead_id) = step.bead_id {
            bead_mapping.insert(step.anchor.clone(), bead_id.clone());
        }
    }

    Ok((bead_mapping, response.data.root_bead_id))
}

/// Commit bead annotations in the worktree
fn commit_bead_annotations(
    worktree_path: &Path,
    plan_path: &str,
    plan_name: &str,
) -> Result<(), tugtool_core::error::TugError> {
    use std::process::Command;

    // Stage the .tugtool/ directory (includes init files: config, log, skeleton)
    let status = Command::new("git")
        .args(["-C", &worktree_path.to_string_lossy(), "add", ".tugtool/"])
        .status()
        .map_err(|e| tugtool_core::error::TugError::BeadCommitFailed {
            reason: format!("failed to stage .tugtool/ directory: {}", e),
        })?;

    if !status.success() {
        return Err(tugtool_core::error::TugError::BeadCommitFailed {
            reason: "git add .tugtool/ failed".to_string(),
        });
    }

    // Stage the plan file (includes bead annotations)
    let status = Command::new("git")
        .args(["-C", &worktree_path.to_string_lossy(), "add", plan_path])
        .status()
        .map_err(|e| tugtool_core::error::TugError::BeadCommitFailed {
            reason: format!("failed to stage plan: {}", e),
        })?;

    if !status.success() {
        return Err(tugtool_core::error::TugError::BeadCommitFailed {
            reason: "git add plan failed".to_string(),
        });
    }

    // Check if anything was actually staged (beads may already be committed)
    let diff_status = Command::new("git")
        .args([
            "-C",
            &worktree_path.to_string_lossy(),
            "diff",
            "--cached",
            "--quiet",
        ])
        .status()
        .map_err(|e| tugtool_core::error::TugError::BeadCommitFailed {
            reason: format!("failed to check staged changes: {}", e),
        })?;

    // git diff --cached --quiet exits 0 if no staged changes, 1 if there are changes
    if diff_status.success() {
        // Nothing staged — beads and init files are already committed
        return Ok(());
    }

    // Commit the changes (both init files and bead annotations)
    let commit_msg = format!("chore: init worktree and sync beads for {}", plan_name);
    let status = Command::new("git")
        .args([
            "-C",
            &worktree_path.to_string_lossy(),
            "commit",
            "-m",
            &commit_msg,
        ])
        .status()
        .map_err(|e| tugtool_core::error::TugError::BeadCommitFailed {
            reason: format!("failed to commit: {}", e),
        })?;

    if !status.success() {
        return Err(tugtool_core::error::TugError::BeadCommitFailed {
            reason: "git commit failed".to_string(),
        });
    }

    Ok(())
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

/// Run worktree create command
///
/// If `override_root` is provided, use it instead of `current_dir()`.
/// This avoids the `set_current_dir` anti-pattern in tests.
pub fn run_worktree_create(
    plan: String,
    base: String,
    skip_validation: bool,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    run_worktree_create_with_root(plan, base, skip_validation, json_output, quiet, None)
}

/// Inner implementation that accepts an explicit repo root.
pub fn run_worktree_create_with_root(
    plan: String,
    base: String,
    skip_validation: bool,
    json_output: bool,
    quiet: bool,
    override_root: Option<&Path>,
) -> Result<i32, String> {
    let repo_root = match override_root {
        Some(root) => root.to_path_buf(),
        None => std::env::current_dir().map_err(|e| e.to_string())?,
    };
    let plan_path = PathBuf::from(&plan);

    // Check if plan file exists
    if !repo_root.join(&plan_path).exists() {
        if json_output {
            println!(
                r#"{{"error": "Plan file not found: {}"}}"#,
                plan_path.display()
            );
        } else if !quiet {
            eprintln!("error: Plan file not found: {}", plan_path.display());
        }
        return Ok(7); // Exit code 7: Plan file not found
    }

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
            beads_enabled: false,
            validate_bead_ids: false,
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

    let config = WorktreeConfig {
        plan_path: plan_path.clone(),
        base_branch: base,
        repo_root: repo_root.clone(),
    };

    match create_worktree(&config) {
        Ok((worktree_path, branch_name, _plan_slug)) => {
            let plan_name = plan_path
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
                    let data = CreateData {
                        worktree_path: String::new(),
                        branch_name: String::new(),
                        base_branch: config.base_branch.clone(),
                        plan_path: plan.clone(),
                        total_steps: 0,
                        bead_mapping: None,
                        root_bead_id: None,
                        reused: false,
                        all_steps: None,
                        ready_steps: None,
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

            // Sync beads and commit (always-on)
            // Try to sync beads
            let (bead_mapping, root_bead_id) = match sync_beads_in_worktree(&worktree_path, &plan) {
                Ok((mapping, root_id)) => {
                    // Try to commit the changes
                    match commit_bead_annotations(&worktree_path, &plan, plan_name) {
                        Ok(()) => (Some(mapping), root_id),
                        Err(e) => {
                            // Commit failed - rollback
                            let _ = rollback_worktree_creation(
                                &worktree_path,
                                &branch_name,
                                &repo_root,
                            );

                            if json_output {
                                let data = CreateData {
                                    worktree_path: String::new(),
                                    branch_name: String::new(),
                                    base_branch: config.base_branch.clone(),
                                    plan_path: plan.clone(),
                                    total_steps: 0,
                                    bead_mapping: None,
                                    root_bead_id: None,
                                    reused: false,
                                    all_steps: None,
                                    ready_steps: None,
                                };
                                eprintln!(
                                    "{}",
                                    serde_json::to_string_pretty(&data)
                                        .map_err(|e| e.to_string())?
                                );
                            } else if !quiet {
                                eprintln!("error: {}", e);
                                eprintln!("Rolled back worktree creation");
                            }
                            return Ok(e.exit_code());
                        }
                    }
                }
                Err(e) => {
                    // Sync failed - rollback
                    let _ = rollback_worktree_creation(&worktree_path, &branch_name, &repo_root);

                    if json_output {
                        let data = CreateData {
                            worktree_path: String::new(),
                            branch_name: String::new(),
                            base_branch: config.base_branch.clone(),
                            plan_path: plan.clone(),
                            total_steps: 0,
                            bead_mapping: None,
                            root_bead_id: None,
                            reused: false,
                            all_steps: None,
                            ready_steps: None,
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
            };

            // Parse the synced plan to extract all_steps (already have bead_mapping from sync_beads_in_worktree)
            let synced_plan_path = worktree_path.join(&plan);
            let synced_plan_content = std::fs::read_to_string(&synced_plan_path)
                .map_err(|e| format!("failed to read synced plan: {}", e))?;
            let synced_plan = tugtool_core::parse_tugplan(&synced_plan_content)
                .map_err(|e| format!("failed to parse synced plan: {}", e))?;

            let all_steps: Vec<String> =
                synced_plan.steps.iter().map(|s| s.anchor.clone()).collect();
            let total_steps = synced_plan.steps.len();

            // Query bd ready to get ready_steps (only if root_bead_id is available)
            let ready_steps: Option<Vec<String>> = if let Some(ref root_id) = root_bead_id {
                use tugtool_core::beads::BeadsCli;
                let bd = BeadsCli::default();
                match bd.ready(Some(root_id), None) {
                    Ok(ready_beads) => {
                        // Map bead IDs to step anchors using bead_mapping
                        if let Some(ref mapping) = bead_mapping {
                            let ready_anchors: Vec<String> = ready_beads
                                .iter()
                                .filter_map(|bead| {
                                    // Find step anchor for this bead ID
                                    mapping
                                        .iter()
                                        .find(|(_, bid)| *bid == &bead.id)
                                        .map(|(anchor, _)| anchor.clone())
                                })
                                .collect();
                            Some(ready_anchors)
                        } else {
                            None
                        }
                    }
                    Err(_) => None, // bd not available or failed - continue without ready_steps
                }
            } else {
                None
            };

            // Create artifact directories inside worktree
            let artifacts_base = worktree_path.join(".tugtool/artifacts");
            if let Err(e) = std::fs::create_dir_all(&artifacts_base) {
                eprintln!("warning: failed to create artifacts base directory: {}", e);
            }

            // Create per-step artifact directories
            for (idx, _step_anchor) in all_steps.iter().enumerate() {
                let step_dir = artifacts_base.join(format!("step-{}", idx));
                if let Err(e) = std::fs::create_dir_all(&step_dir) {
                    eprintln!(
                        "warning: failed to create step-{} artifact directory: {}",
                        idx, e
                    );
                }
            }

            if json_output {
                let data = CreateData {
                    worktree_path: worktree_path.display().to_string(),
                    branch_name: branch_name.clone(),
                    base_branch: config.base_branch.clone(),
                    plan_path: plan.clone(),
                    total_steps,
                    bead_mapping,
                    root_bead_id,
                    reused,
                    all_steps: Some(all_steps),
                    ready_steps,
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
                if bead_mapping.is_some() {
                    println!("  Beads synced and committed");
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
        None => std::env::current_dir().map_err(|e| e.to_string())?,
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
        None => std::env::current_dir().map_err(|e| e.to_string())?,
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
        None => std::env::current_dir().map_err(|e| e.to_string())?,
    };

    // List all worktrees
    let worktrees = list_worktrees(&repo_root).map_err(|e| e.to_string())?;

    // Try to identify the worktree by:
    // 1. Plan path (can match multiple - error if so)
    // 2. Branch name (exact match)
    // 3. Worktree path (exact match)

    let mut matching_worktrees: Vec<&DiscoveredWorktree> = Vec::new();

    // Check if target is a plan path (derive slug and match)
    let target_path = PathBuf::from(&target);
    if target_path.extension().and_then(|s| s.to_str()) == Some("md") {
        // Target looks like a plan file - derive slug and match
        let target_slug = tugtool_core::derive_tugplan_slug(&target_path);
        for wt in &worktrees {
            if wt.plan_slug == target_slug {
                matching_worktrees.push(wt);
            }
        }
    }

    // If multiple matches by plan path, error with candidate list (D10)
    if matching_worktrees.len() > 1 {
        if json_output {
            eprintln!(r#"{{"error": "Multiple worktrees found for {}"}}"#, target);
        } else if !quiet {
            eprintln!("Error: Multiple worktrees found for {}\n", target);
            for wt in &matching_worktrees {
                eprintln!("  {}  {}", wt.branch, wt.path.display());
            }
            eprintln!("\nUse branch name or worktree path to disambiguate:");
            if let Some(first) = matching_worktrees.first() {
                eprintln!("  tug worktree remove {}", first.branch);
            }
        }
        return Ok(1);
    }

    // If exactly one match by plan path, use it
    let worktree = if matching_worktrees.len() == 1 {
        matching_worktrees[0]
    } else {
        // Try to match by branch name or worktree path
        worktrees
            .iter()
            .find(|wt| wt.branch == target || wt.path.to_string_lossy() == target)
            .ok_or_else(|| {
                if json_output {
                    format!(r#"{{"error": "No worktree found matching: {}"}}"#, target)
                } else {
                    format!("error: No worktree found matching: {}", target)
                }
            })?
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
        let data = CreateData {
            worktree_path: "/path/to/worktree".to_string(),
            branch_name: "tug/test-20260208-120000".to_string(),
            base_branch: "main".to_string(),
            plan_path: ".tugtool/tugplan-test.md".to_string(),
            total_steps: 5,
            bead_mapping: None,
            root_bead_id: None,
            reused: false,
            all_steps: None,
            ready_steps: None,
        };

        let json = serde_json::to_string(&data).expect("serialization should succeed");
        assert!(json.contains("worktree_path"));
        assert!(json.contains("branch_name"));
        // reused should be skipped when false
        assert!(!json.contains("reused"));
        // session fields should not be present
        assert!(!json.contains("session_id"));
        assert!(!json.contains("session_file"));
        assert!(!json.contains("artifacts_base"));
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
            worktree_path: ".tugtool-worktrees/tugtool__test-20260210-120000".to_string(),
            branch_name: "tugtool/test-20260210-120000".to_string(),
            plan_path: ".tugtool/tugplan-test.md".to_string(),
        };

        let json = serde_json::to_string(&data).expect("serialization should succeed");
        assert!(json.contains("worktree_path"));
        assert!(json.contains("branch_name"));
        assert!(json.contains("plan_path"));
    }

    #[test]
    fn test_worktree_create_help_documents_always_on_beads() {
        use crate::cli::Cli;
        use clap::CommandFactory;

        let app = Cli::command();
        let worktree_subcommand = app
            .find_subcommand("worktree")
            .expect("worktree subcommand should exist");

        // Find the create subcommand
        let create_subcommand = worktree_subcommand
            .get_subcommands()
            .find(|cmd| cmd.get_name() == "create")
            .expect("create subcommand should exist");

        // Get the long_about text
        let long_about = create_subcommand
            .get_long_about()
            .expect("create should have long_about");

        // Verify beads sync is documented as always-on
        assert!(
            long_about.to_string().contains("always-on"),
            "create help should document always-on beads sync"
        );
        assert!(
            long_about.to_string().contains("atomically")
                || long_about.to_string().contains("rollback"),
            "create help should explain atomic behavior"
        );
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::fs;
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
        assert!(branch_name.starts_with("tugtool/test-"));

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
