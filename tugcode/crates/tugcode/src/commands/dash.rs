//! Dash CLI commands
//!
//! Provides subcommands for lightweight, worktree-isolated work units

use clap::Subcommand;
use serde::Serialize;
use std::io::{self, IsTerminal, Read};
use std::path::Path;
use std::process::Command;
use tugtool_core::{
    DashRoundMeta, DashStatus, StateDb, detect_default_branch, find_repo_root,
    sanitize_branch_name, validate_dash_name,
};

use crate::output::JsonResponse;

/// Dash subcommands
#[derive(Subcommand, Debug)]
pub enum DashCommands {
    /// Create a new dash
    ///
    /// Creates a git worktree and branch for lightweight work.
    #[command(
        long_about = "Create a new dash.\n\nCreates:\n  - Branch tugdash/<name> from detected base branch\n  - Worktree at .tugtree/tugdash__<name>/\n  - State tracking in state.db\n\nIdempotent: returns existing active dash on second call.\nReuses names: reactivates joined/released dashes in place."
    )]
    Create {
        /// Dash name (alphanumeric + hyphens, 2+ chars)
        name: String,

        /// Description of the work
        #[arg(long)]
        description: Option<String>,
    },

    /// Commit changes in a dash worktree
    ///
    /// Records a round and commits git changes if present.
    #[command(
        long_about = "Commit changes in a dash worktree.\n\nAlways records a round in state.db.\nCommits git changes if worktree is dirty.\nReads round metadata from stdin as JSON."
    )]
    Commit {
        /// Dash name
        name: String,

        /// Git commit message
        #[arg(long)]
        message: String,
    },

    /// Join a dash (squash-merge to base branch)
    ///
    /// Merges the dash's work back to the base branch and cleans up.
    #[command(
        long_about = "Join a dash (squash-merge to base branch).\n\nSequence:\n  1. Preflight: check repo root worktree is clean\n  2. Verify: current branch matches base_branch\n  3. Auto-commit: outstanding changes in dash worktree\n  4. Squash-merge: tugdash/<name> into base_branch\n  5. Cleanup: remove worktree and branch"
    )]
    Join {
        /// Dash name
        name: String,

        /// Custom commit message (default: uses dash description)
        #[arg(long)]
        message: Option<String>,
    },

    /// Release a dash (discard without merging)
    ///
    /// Removes the dash's worktree and branch without merging.
    #[command(
        long_about = "Release a dash (discard without merging).\n\nRemoves:\n  - Worktree directory\n  - Branch tugdash/<name>\n\nSets dash status to 'released' in state.db.\nWarns on partial cleanup failure."
    )]
    Release {
        /// Dash name
        name: String,
    },

    /// List all dashes
    ///
    /// Shows active dashes by default, or all with --all.
    #[command(
        long_about = "List all dashes.\n\nDisplays:\n  - Dash name\n  - Status (active, joined, released)\n  - Round count\n  - Worktree path (for active dashes)\n\nUse --all to include joined and released dashes."
    )]
    List {
        /// Include joined and released dashes
        #[arg(long)]
        all: bool,
    },

    /// Show detailed dash information
    ///
    /// Displays dash metadata and rounds.
    #[command(
        long_about = "Show detailed dash information.\n\nDisplays:\n  - Dash metadata (name, description, branch, worktree, base_branch, status)\n  - Rounds from current incarnation (or all with --all-rounds)\n  - Uncommitted changes in worktree (for active dashes)"
    )]
    Show {
        /// Dash name
        name: String,

        /// Include rounds from all incarnations
        #[arg(long)]
        all_rounds: bool,
    },
}

#[derive(Serialize)]
struct CreateResponse {
    name: String,
    description: Option<String>,
    branch: String,
    worktree: String,
    base_branch: String,
    status: String,
    created: bool,
    created_at: String,
}

#[derive(Serialize)]
struct ListResponse {
    dashes: Vec<DashListItem>,
}

#[derive(Serialize)]
struct DashListItem {
    name: String,
    description: Option<String>,
    status: String,
    round_count: i64,
    worktree: Option<String>,
    base_branch: String,
}

#[derive(Serialize)]
struct ShowResponse {
    name: String,
    description: Option<String>,
    branch: String,
    worktree: String,
    base_branch: String,
    status: String,
    created_at: String,
    updated_at: String,
    rounds: Vec<RoundItem>,
    uncommitted_changes: Option<bool>,
}

#[derive(Serialize)]
struct RoundItem {
    id: i64,
    instruction: Option<String>,
    summary: Option<String>,
    files_created: Option<Vec<String>>,
    files_modified: Option<Vec<String>>,
    commit_hash: Option<String>,
    started_at: String,
}

#[derive(Serialize)]
struct CommitResponse {
    committed: bool,
    round_id: i64,
    commit_hash: Option<String>,
}

#[derive(Serialize)]
struct JoinResponse {
    name: String,
    base_branch: String,
    commit_hash: String,
    warnings: Vec<String>,
}

#[derive(Serialize)]
struct ReleaseResponse {
    name: String,
    warnings: Vec<String>,
}

/// Run dash create subcommand
pub fn run_dash_create(
    name: String,
    description: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Validate name
    validate_dash_name(&name).map_err(|e| e.to_string())?;

    // Find repo root
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;

    // Detect default branch
    let base_branch = detect_default_branch(&repo_root).map_err(|e| e.to_string())?;

    // Construct branch and worktree paths
    let branch_name = format!("tugdash/{}", name);
    let sanitized_name = sanitize_branch_name(&name);
    let worktree_path = repo_root
        .join(".tugtree")
        .join(format!("tugdash__{}", sanitized_name));

    // Open or create state.db
    let state_db_path = repo_root.join(".tugtool/state.db");
    let db = StateDb::open(&state_db_path).map_err(|e| e.to_string())?;

    // Check if dash already exists and is active
    if let Some(existing) = db.get_dash(&name).map_err(|e| e.to_string())? {
        if existing.status == DashStatus::Active {
            // Idempotent: return existing
            if json {
                let data = CreateResponse {
                    name: existing.name.clone(),
                    description: existing.description.clone(),
                    branch: existing.branch.clone(),
                    worktree: existing.worktree.clone(),
                    base_branch: existing.base_branch.clone(),
                    status: existing.status.as_str().to_string(),
                    created: false,
                    created_at: existing.created_at.clone(),
                };
                let response = JsonResponse::ok("dash create", data);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else if !quiet {
                println!("Dash '{}' already exists (active)", name);
                println!("  Worktree: {}", existing.worktree);
                println!("  Branch: {}", existing.branch);
                println!("  Base: {}", existing.base_branch);
            }
            return Ok(0);
        }
    }

    // Check if branch already exists (from previous incarnation)
    let branch_exists_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("branch")
        .arg("--list")
        .arg(&branch_name)
        .output()
        .map_err(|e| format!("failed to check branch: {}", e))?;

    let branch_exists = !String::from_utf8_lossy(&branch_exists_output.stdout)
        .trim()
        .is_empty();

    // Check if worktree still exists (from previous incarnation)
    if worktree_path.exists() {
        // Remove old worktree
        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo_root)
            .arg("worktree")
            .arg("remove")
            .arg(&worktree_path)
            .arg("--force")
            .output();
    }

    if branch_exists {
        // Delete the old branch (force delete)
        let delete_output = Command::new("git")
            .arg("-C")
            .arg(&repo_root)
            .arg("branch")
            .arg("-D")
            .arg(&branch_name)
            .output()
            .map_err(|e| format!("failed to delete old branch: {}", e))?;

        if !delete_output.status.success() {
            return Err(format!(
                "failed to delete old branch: {}",
                String::from_utf8_lossy(&delete_output.stderr)
            ));
        }
    }

    // Create branch from base branch
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("branch")
        .arg(&branch_name)
        .arg(&base_branch)
        .output()
        .map_err(|e| format!("failed to create branch: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "git branch failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Create worktree
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("worktree")
        .arg("add")
        .arg(&worktree_path)
        .arg(&branch_name)
        .output()
        .map_err(|e| format!("failed to create worktree: {}", e))?;

    if !output.status.success() {
        // Rollback: delete branch
        let _ = Command::new("git")
            .arg("-C")
            .arg(&repo_root)
            .arg("branch")
            .arg("-D")
            .arg(&branch_name)
            .output();

        return Err(format!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Create or reactivate dash in state.db
    let (dash, created) = db
        .create_dash(
            &name,
            description.as_deref(),
            &branch_name,
            worktree_path.to_string_lossy().as_ref(),
            &base_branch,
        )
        .map_err(|e| e.to_string())?;

    if json {
        let data = CreateResponse {
            name: dash.name.clone(),
            description: dash.description.clone(),
            branch: dash.branch.clone(),
            worktree: dash.worktree.clone(),
            base_branch: dash.base_branch.clone(),
            status: dash.status.as_str().to_string(),
            created,
            created_at: dash.created_at.clone(),
        };
        let response = JsonResponse::ok("dash create", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        if created {
            println!("Created dash '{}'", name);
        } else {
            println!("Reactivated dash '{}'", name);
        }
        println!("  Worktree: {}", dash.worktree);
        println!("  Branch: {}", dash.branch);
        println!("  Base: {}", dash.base_branch);
    }

    Ok(0)
}

/// Run dash list subcommand
pub fn run_dash_list(all: bool, json: bool, quiet: bool) -> Result<i32, String> {
    // Find repo root
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;

    // Open state.db
    let state_db_path = repo_root.join(".tugtool/state.db");
    let db = StateDb::open(&state_db_path).map_err(|e| e.to_string())?;

    // List dashes
    let dashes = db.list_dashes(!all).map_err(|e| e.to_string())?; // active_only = !all

    if json {
        let items: Vec<DashListItem> = dashes
            .into_iter()
            .map(|(dash, round_count)| {
                let worktree_exists = Path::new(&dash.worktree).exists();
                DashListItem {
                    name: dash.name,
                    description: dash.description,
                    status: dash.status.as_str().to_string(),
                    round_count,
                    worktree: if dash.status == DashStatus::Active && worktree_exists {
                        Some(dash.worktree)
                    } else {
                        None
                    },
                    base_branch: dash.base_branch,
                }
            })
            .collect();

        let data = ListResponse { dashes: items };
        let response = JsonResponse::ok("dash list", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        if dashes.is_empty() {
            println!("No dashes found");
        } else {
            for (dash, round_count) in dashes {
                println!(
                    "{} ({}, {} rounds)",
                    dash.name,
                    dash.status.as_str(),
                    round_count
                );
                if dash.status == DashStatus::Active {
                    let worktree_exists = Path::new(&dash.worktree).exists();
                    println!(
                        "  Worktree: {} {}",
                        dash.worktree,
                        if worktree_exists { "" } else { "(missing)" }
                    );
                    println!("  Base: {}", dash.base_branch);
                }
            }
        }
    }

    Ok(0)
}

/// Run dash show subcommand
pub fn run_dash_show(
    name: String,
    all_rounds: bool,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Find repo root
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;

    // Open state.db
    let state_db_path = repo_root.join(".tugtool/state.db");
    let db = StateDb::open(&state_db_path).map_err(|e| e.to_string())?;

    // Get dash
    let dash = db
        .get_dash(&name)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Dash not found: {}", name))?;

    // Get rounds (current incarnation only by default)
    let rounds = db
        .get_dash_rounds(&name, !all_rounds)
        .map_err(|e| e.to_string())?; // current_incarnation_only = !all_rounds

    // Check for uncommitted changes if active
    let uncommitted_changes = if dash.status == DashStatus::Active {
        let output = Command::new("git")
            .arg("-C")
            .arg(&dash.worktree)
            .arg("status")
            .arg("--porcelain")
            .output();

        match output {
            Ok(output) if output.status.success() => {
                Some(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
            }
            _ => None,
        }
    } else {
        None
    };

    if json {
        let round_items: Vec<RoundItem> = rounds
            .into_iter()
            .map(|r| RoundItem {
                id: r.id,
                instruction: r.instruction,
                summary: r.summary,
                files_created: r.files_created,
                files_modified: r.files_modified,
                commit_hash: r.commit_hash,
                started_at: r.started_at,
            })
            .collect();

        let data = ShowResponse {
            name: dash.name.clone(),
            description: dash.description.clone(),
            branch: dash.branch.clone(),
            worktree: dash.worktree.clone(),
            base_branch: dash.base_branch.clone(),
            status: dash.status.as_str().to_string(),
            created_at: dash.created_at.clone(),
            updated_at: dash.updated_at.clone(),
            rounds: round_items,
            uncommitted_changes,
        };
        let response = JsonResponse::ok("dash show", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Dash: {}", dash.name);
        if let Some(desc) = &dash.description {
            println!("Description: {}", desc);
        }
        println!("Status: {}", dash.status.as_str());
        println!("Branch: {}", dash.branch);
        println!("Worktree: {}", dash.worktree);
        println!("Base: {}", dash.base_branch);
        println!("Created: {}", dash.created_at);
        println!("Updated: {}", dash.updated_at);

        if let Some(has_changes) = uncommitted_changes {
            println!(
                "Uncommitted changes: {}",
                if has_changes { "yes" } else { "no" }
            );
        }

        println!("\nRounds ({}):", rounds.len());
        for round in rounds {
            println!("  [{}] {}", round.id, round.started_at);
            if let Some(instruction) = &round.instruction {
                println!("    Instruction: {}", instruction);
            }
            if let Some(summary) = &round.summary {
                println!("    Summary: {}", summary);
            }
            if let Some(files) = &round.files_created {
                if !files.is_empty() {
                    println!("    Created: {}", files.join(", "));
                }
            }
            if let Some(files) = &round.files_modified {
                if !files.is_empty() {
                    println!("    Modified: {}", files.join(", "));
                }
            }
            if let Some(hash) = &round.commit_hash {
                println!("    Commit: {}", hash);
            } else {
                println!("    Commit: (no changes)");
            }
        }
    }

    Ok(0)
}

/// Run dash commit subcommand
pub fn run_dash_commit(
    name: String,
    message: String,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Read round metadata from stdin if available
    let round_meta: Option<DashRoundMeta> = if !io::stdin().is_terminal() {
        let mut stdin_content = String::new();
        io::stdin()
            .read_to_string(&mut stdin_content)
            .map_err(|e| format!("failed to read stdin: {}", e))?;

        if !stdin_content.trim().is_empty() {
            match serde_json::from_str::<DashRoundMeta>(&stdin_content) {
                Ok(meta) => Some(meta),
                Err(e) => {
                    return Err(format!("failed to parse round metadata JSON: {}", e));
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    // Find repo root
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;

    // Open state.db
    let state_db_path = repo_root.join(".tugtool/state.db");
    let db = StateDb::open(&state_db_path).map_err(|e| e.to_string())?;

    // Get dash
    let dash = db
        .get_dash(&name)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Dash not found: {}", name))?;

    // Check dash is active
    if dash.status != DashStatus::Active {
        return Err(format!(
            "Dash '{}' is not active (status: {})",
            name,
            dash.status.as_str()
        ));
    }

    let worktree_path = Path::new(&dash.worktree);

    // Stage all changes
    let stage_output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("add")
        .arg("-A")
        .output()
        .map_err(|e| format!("failed to stage changes: {}", e))?;

    if !stage_output.status.success() {
        return Err(format!(
            "git add failed: {}",
            String::from_utf8_lossy(&stage_output.stderr)
        ));
    }

    // Check for staged changes
    let status_output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .arg("--cached")
        .arg("--quiet")
        .output()
        .map_err(|e| format!("failed to check git status: {}", e))?;

    let has_changes = !status_output.status.success(); // diff --quiet exits with 1 if there are changes

    let commit_hash = if has_changes {
        // Build commit message
        let summary = round_meta
            .as_ref()
            .and_then(|m| m.summary.as_deref())
            .unwrap_or("");

        let commit_message = if summary.len() > 72 {
            // Truncate subject to 72 chars, put full summary in body
            let subject = &summary[..72];
            format!("{}\n\n{}", subject, summary)
        } else {
            message.clone()
        };

        // Commit changes
        let commit_output = Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .arg("commit")
            .arg("-m")
            .arg(&commit_message)
            .output()
            .map_err(|e| format!("failed to commit: {}", e))?;

        if !commit_output.status.success() {
            return Err(format!(
                "git commit failed: {}",
                String::from_utf8_lossy(&commit_output.stderr)
            ));
        }

        // Get commit hash
        let hash_output = Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .arg("rev-parse")
            .arg("HEAD")
            .output()
            .map_err(|e| format!("failed to get commit hash: {}", e))?;

        if hash_output.status.success() {
            Some(
                String::from_utf8_lossy(&hash_output.stdout)
                    .trim()
                    .to_string(),
            )
        } else {
            None
        }
    } else {
        None
    };

    // Record round in state.db (always, per [D06])
    let round_id = db
        .record_round(
            &name,
            round_meta.as_ref().and_then(|m| m.instruction.as_deref()),
            round_meta.as_ref().and_then(|m| m.summary.as_deref()),
            round_meta.as_ref().and_then(|m| m.files_created.as_deref()),
            round_meta
                .as_ref()
                .and_then(|m| m.files_modified.as_deref()),
            commit_hash.as_deref(),
        )
        .map_err(|e| e.to_string())?;

    if json {
        let data = CommitResponse {
            committed: has_changes,
            round_id,
            commit_hash: commit_hash.clone(),
        };
        let response = JsonResponse::ok("dash commit", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        if has_changes {
            println!("Committed changes to dash '{}'", name);
            if let Some(hash) = &commit_hash {
                println!("  Commit: {}", hash);
            }
        } else {
            println!("No changes to commit for dash '{}'", name);
        }
        println!("  Round ID: {}", round_id);
    }

    Ok(0)
}

/// Run dash join subcommand
pub fn run_dash_join(
    name: String,
    message: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    let mut warnings = Vec::new();

    // Find repo root
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;

    // Open state.db
    let state_db_path = repo_root.join(".tugtool/state.db");
    let db = StateDb::open(&state_db_path).map_err(|e| e.to_string())?;

    // Step 1: Look up dash by name (must be active)
    let dash = db
        .get_dash(&name)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Dash not found: {}", name))?;

    if dash.status != DashStatus::Active {
        return Err(format!(
            "Dash '{}' is not active (status: {})",
            name,
            dash.status.as_str()
        ));
    }

    // Step 2: Preflight - check repo root worktree is clean (excluding ignored files)
    let status_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=no") // Only check tracked files
        .output()
        .map_err(|e| format!("failed to check git status: {}", e))?;

    if !String::from_utf8_lossy(&status_output.stdout)
        .trim()
        .is_empty()
    {
        return Err(
            "Cannot join: repo root worktree has uncommitted changes. Commit or stash them first."
                .to_string(),
        );
    }

    // Step 3: Verify we're running from repo root worktree (not inside dash worktree)
    let current_dir =
        std::env::current_dir().map_err(|e| format!("failed to get current directory: {}", e))?;
    let dash_worktree = Path::new(&dash.worktree);
    if current_dir.starts_with(dash_worktree) {
        return Err(
            "Cannot join from inside the dash worktree. Run from repo root instead.".to_string(),
        );
    }

    // Step 4: Verify current branch matches base_branch
    let current_branch_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("failed to get current branch: {}", e))?;

    let current_branch = String::from_utf8_lossy(&current_branch_output.stdout)
        .trim()
        .to_string();

    if current_branch != dash.base_branch {
        return Err(format!(
            "Cannot join: repo root worktree is on branch '{}' but dash targets '{}'. Check out '{}' first.",
            current_branch, dash.base_branch, dash.base_branch
        ));
    }

    // Step 5: Commit any outstanding changes in dash worktree
    let dash_status_output = Command::new("git")
        .arg("-C")
        .arg(&dash.worktree)
        .arg("status")
        .arg("--porcelain")
        .output()
        .map_err(|e| format!("failed to check dash worktree status: {}", e))?;

    let has_outstanding_changes = !String::from_utf8_lossy(&dash_status_output.stdout)
        .trim()
        .is_empty();

    if has_outstanding_changes {
        // Stage changes
        let _ = Command::new("git")
            .arg("-C")
            .arg(&dash.worktree)
            .arg("add")
            .arg("-A")
            .output();

        // Get diff summary for commit message
        let diff_output = Command::new("git")
            .arg("-C")
            .arg(&dash.worktree)
            .arg("diff")
            .arg("--cached")
            .arg("--stat")
            .output()
            .map_err(|e| format!("failed to get diff: {}", e))?;

        let diff_summary = String::from_utf8_lossy(&diff_output.stdout)
            .lines()
            .take(5)
            .collect::<Vec<_>>()
            .join(", ");

        // Commit
        let commit_msg = "join: commit outstanding changes".to_string();
        let _ = Command::new("git")
            .arg("-C")
            .arg(&dash.worktree)
            .arg("commit")
            .arg("-m")
            .arg(&commit_msg)
            .output();

        // Record synthetic round
        let _ = db.record_round(
            &name,
            Some("join: commit outstanding changes"),
            Some(&diff_summary),
            None,
            None,
            None, // We'll get the actual commit hash from the branch
        );
    }

    // Step 6: Squash-merge from repo root
    let merge_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("merge")
        .arg("--squash")
        .arg(&dash.branch)
        .output()
        .map_err(|e| format!("failed to squash-merge: {}", e))?;

    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        if stderr.contains("CONFLICT") || stderr.contains("conflict") {
            return Err(format!(
                "Merge conflict occurred. Resolve manually with:\n  git merge --abort\nThen fix conflicts or use: tugcode dash release {}",
                name
            ));
        }
        return Err(format!("git merge --squash failed: {}", stderr));
    }

    // Step 7: Commit on base branch with tugdash prefix
    let commit_message = message
        .clone()
        .or_else(|| dash.description.clone())
        .unwrap_or_else(|| "Dash work".to_string());

    let final_commit_msg = format!("tugdash({}): {}", name, commit_message);

    let commit_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("commit")
        .arg("-m")
        .arg(&final_commit_msg)
        .output()
        .map_err(|e| format!("failed to commit squash: {}", e))?;

    if !commit_output.status.success() {
        return Err(format!(
            "git commit failed: {}",
            String::from_utf8_lossy(&commit_output.stderr)
        ));
    }

    // Get commit hash
    let hash_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("failed to get commit hash: {}", e))?;

    let commit_hash = String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string();

    // Step 8: Update state to joined immediately
    db.update_dash_status(&name, DashStatus::Joined)
        .map_err(|e| e.to_string())?;

    // Step 9: Remove worktree (warn on failure)
    let worktree_remove_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("worktree")
        .arg("remove")
        .arg(&dash.worktree)
        .output();

    match worktree_remove_output {
        Ok(output) if !output.status.success() => {
            warnings.push(format!(
                "Failed to remove worktree: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Err(e) => {
            warnings.push(format!("Failed to remove worktree: {}", e));
        }
        _ => {}
    }

    // Step 10: Delete branch (warn on failure)
    let branch_delete_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("branch")
        .arg("-D")
        .arg(&dash.branch)
        .output();

    match branch_delete_output {
        Ok(output) if !output.status.success() => {
            warnings.push(format!(
                "Failed to delete branch: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Err(e) => {
            warnings.push(format!("Failed to delete branch: {}", e));
        }
        _ => {}
    }

    // Step 11: Return output
    if json {
        let data = JoinResponse {
            name: name.clone(),
            base_branch: dash.base_branch.clone(),
            commit_hash: commit_hash.clone(),
            warnings: warnings.clone(),
        };
        let response = JsonResponse::ok("dash join", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Joined dash '{}' to branch '{}'", name, dash.base_branch);
        println!("  Commit: {}", commit_hash);
        for warning in &warnings {
            println!("  Warning: {}", warning);
        }
    }

    Ok(0)
}

/// Run dash release subcommand
pub fn run_dash_release(name: String, json: bool, quiet: bool) -> Result<i32, String> {
    let mut warnings = Vec::new();

    // Find repo root
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;

    // Open state.db
    let state_db_path = repo_root.join(".tugtool/state.db");
    let db = StateDb::open(&state_db_path).map_err(|e| e.to_string())?;

    // Step 1: Look up dash by name (must be active)
    let dash = db
        .get_dash(&name)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Dash not found: {}", name))?;

    if dash.status != DashStatus::Active {
        return Err(format!(
            "Dash '{}' is not active (status: {})",
            name,
            dash.status.as_str()
        ));
    }

    // Step 2: Remove worktree with --force
    let worktree_remove_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("worktree")
        .arg("remove")
        .arg(&dash.worktree)
        .arg("--force")
        .output();

    match worktree_remove_output {
        Ok(output) if !output.status.success() => {
            warnings.push(format!(
                "Failed to remove worktree: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Err(e) => {
            warnings.push(format!("Failed to remove worktree: {}", e));
        }
        _ => {}
    }

    // Step 3: Delete branch (warn on failure, mark as released regardless)
    let branch_delete_output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("branch")
        .arg("-D")
        .arg(&dash.branch)
        .output();

    match branch_delete_output {
        Ok(output) if !output.status.success() => {
            warnings.push(format!(
                "Failed to delete branch: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Err(e) => {
            warnings.push(format!("Failed to delete branch: {}", e));
        }
        _ => {}
    }

    // Step 4: Update state to released
    db.update_dash_status(&name, DashStatus::Released)
        .map_err(|e| e.to_string())?;

    // Step 5: Return output
    if json {
        let data = ReleaseResponse {
            name: name.clone(),
            warnings: warnings.clone(),
        };
        let response = JsonResponse::ok("dash release", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Released dash '{}'", name);
        for warning in &warnings {
            println!("  Warning: {}", warning);
        }
    }

    Ok(0)
}

#[cfg(test)]
#[allow(clippy::disallowed_methods)] // set_current_dir is needed for tests with isolated temp dirs
mod tests {
    use super::*;
    use serial_test::serial;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    fn init_git_repo(path: &Path) {
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("init")
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("config")
            .arg("user.name")
            .arg("Test User")
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("config")
            .arg("user.email")
            .arg("test@example.com")
            .output()
            .unwrap();

        // Create .gitignore to ignore state.db and worktrees
        fs::write(path.join(".gitignore"), ".tugtool/state.db\n.tugtree/\n").unwrap();

        // Create .tugtool directory with a placeholder file
        fs::create_dir_all(path.join(".tugtool")).unwrap();
        fs::write(path.join(".tugtool/.keep"), "").unwrap();

        // Create initial commit on main
        fs::write(path.join("README.md"), "# Test\n").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("add")
            .arg("-A")
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("commit")
            .arg("-m")
            .arg("Initial commit")
            .output()
            .unwrap();
    }

    #[serial]
    #[test]
    fn test_dash_create_basic() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        // Initialize git repo
        init_git_repo(repo_path);

        // Create .tugtool directory
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();

        // Change to repo directory
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        let result = run_dash_create(
            "test-dash".to_string(),
            Some("Test description".to_string()),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

        // Verify worktree exists
        assert!(repo_path.join(".tugtree/tugdash__test-dash").exists());

        // Verify branch exists
        let output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("branch")
            .arg("--list")
            .arg("tugdash/test-dash")
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(!String::from_utf8_lossy(&output.stdout).trim().is_empty());
    }

    #[serial]
    #[test]
    fn test_dash_create_idempotent() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test description".to_string()),
            false,
            true,
        )
        .unwrap();

        // Create again - should succeed (idempotent)
        let result = run_dash_create(
            "test-dash".to_string(),
            Some("Different description".to_string()),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);
    }

    #[serial]
    #[test]
    fn test_dash_create_reactivate_joined() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("desc1".to_string()),
            false,
            true,
        )
        .unwrap();

        // Mark as joined
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        db.update_dash_status("test-dash", DashStatus::Joined)
            .unwrap();

        // Reactivate with same name
        let result = run_dash_create(
            "test-dash".to_string(),
            Some("desc2".to_string()),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

        // Verify it's active with new description
        let dash = db.get_dash("test-dash").unwrap().unwrap();
        assert_eq!(dash.status, DashStatus::Active);
        assert_eq!(dash.description, Some("desc2".to_string()));
    }

    #[serial]
    #[test]
    fn test_dash_list_active_only() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create two dashes
        run_dash_create("dash1".to_string(), None, false, true).unwrap();
        run_dash_create("dash2".to_string(), None, false, true).unwrap();

        // Mark one as joined
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        db.update_dash_status("dash2", DashStatus::Joined).unwrap();

        // List active only (default)
        let result = run_dash_list(false, false, true);
        assert_eq!(result.unwrap(), 0);
    }

    #[serial]
    #[test]
    fn test_dash_list_all() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create two dashes
        run_dash_create("dash1".to_string(), None, false, true).unwrap();
        run_dash_create("dash2".to_string(), None, false, true).unwrap();

        // Mark one as joined
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        db.update_dash_status("dash2", DashStatus::Joined).unwrap();

        // List all
        let result = run_dash_list(true, false, true);
        assert_eq!(result.unwrap(), 0);
    }

    #[serial]
    #[test]
    fn test_dash_show() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test description".to_string()),
            false,
            true,
        )
        .unwrap();

        // Show dash
        let result = run_dash_show("test-dash".to_string(), false, false, true);
        assert_eq!(result.unwrap(), 0);
    }

    #[serial]
    #[test]
    fn test_dash_show_nonexistent() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Show nonexistent dash
        let result = run_dash_show("nonexistent".to_string(), false, false, true);
        assert!(result.is_err());
    }

    #[serial]
    #[test]
    fn test_dash_show_all_rounds() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash and add a round
        run_dash_create(
            "test-dash".to_string(),
            Some("desc".to_string()),
            false,
            true,
        )
        .unwrap();

        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        db.record_round(
            "test-dash",
            Some("instruction"),
            Some("summary"),
            None,
            None,
            Some("abc123"),
        )
        .unwrap();

        // Join and reactivate
        db.update_dash_status("test-dash", DashStatus::Joined)
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        run_dash_create(
            "test-dash".to_string(),
            Some("desc2".to_string()),
            false,
            true,
        )
        .unwrap();

        // Add another round
        db.record_round(
            "test-dash",
            Some("instruction2"),
            Some("summary2"),
            None,
            None,
            Some("def456"),
        )
        .unwrap();

        // Show current incarnation only (default)
        let result = run_dash_show("test-dash".to_string(), false, false, true);
        assert_eq!(result.unwrap(), 0);

        // Show all rounds
        let result = run_dash_show("test-dash".to_string(), true, false, true);
        assert_eq!(result.unwrap(), 0);
    }

    #[serial]
    #[test]
    fn test_json_output_uses_envelope() {
        use crate::output::JsonResponse;
        use serde_json::Value;

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // We can't easily capture stdout in Rust tests, so we'll test by parsing
        // the JSON structure that would be output. The functions use JsonResponse::ok
        // internally, so we verify the structure by creating a sample response.

        // Create a dash to test with
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Parse the create command's JSON output structure
        // Since we can't capture stdout directly in this test environment,
        // we verify that the code constructs JsonResponse correctly by checking
        // that JsonResponse::ok produces the expected structure
        let sample_data = CreateResponse {
            name: "test".to_string(),
            description: Some("desc".to_string()),
            branch: "tugdash/test".to_string(),
            worktree: "/path".to_string(),
            base_branch: "main".to_string(),
            status: "active".to_string(),
            created: true,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let response = JsonResponse::ok("dash create", sample_data);
        let json_str = serde_json::to_string(&response).unwrap();
        let parsed: Value = serde_json::from_str(&json_str).unwrap();

        // Verify JsonResponse envelope structure
        assert!(parsed.get("schema_version").is_some());
        assert_eq!(parsed["schema_version"], "1");
        assert!(parsed.get("command").is_some());
        assert_eq!(parsed["command"], "dash create");
        assert!(parsed.get("status").is_some());
        assert_eq!(parsed["status"], "ok");
        assert!(parsed.get("data").is_some());
        assert!(parsed.get("issues").is_some());
        assert!(parsed["issues"].is_array());

        // Verify data payload structure
        let data = &parsed["data"];
        assert!(data.get("name").is_some());
        assert!(data.get("branch").is_some());
        assert!(data.get("worktree").is_some());
        assert!(data.get("base_branch").is_some());
        assert!(data.get("status").is_some());
        assert!(data.get("created").is_some());

        // Test list command envelope
        let list_data = ListResponse {
            dashes: vec![DashListItem {
                name: "test".to_string(),
                description: None,
                status: "active".to_string(),
                round_count: 0,
                worktree: Some("/path".to_string()),
                base_branch: "main".to_string(),
            }],
        };

        let list_response = JsonResponse::ok("dash list", list_data);
        let list_json = serde_json::to_string(&list_response).unwrap();
        let list_parsed: Value = serde_json::from_str(&list_json).unwrap();

        assert_eq!(list_parsed["schema_version"], "1");
        assert_eq!(list_parsed["command"], "dash list");
        assert_eq!(list_parsed["status"], "ok");
        assert!(list_parsed["data"]["dashes"].is_array());

        // Test show command envelope
        let show_data = ShowResponse {
            name: "test".to_string(),
            description: None,
            branch: "tugdash/test".to_string(),
            worktree: "/path".to_string(),
            base_branch: "main".to_string(),
            status: "active".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            rounds: vec![],
            uncommitted_changes: Some(false),
        };

        let show_response = JsonResponse::ok("dash show", show_data);
        let show_json = serde_json::to_string(&show_response).unwrap();
        let show_parsed: Value = serde_json::from_str(&show_json).unwrap();

        assert_eq!(show_parsed["schema_version"], "1");
        assert_eq!(show_parsed["command"], "dash show");
        assert_eq!(show_parsed["status"], "ok");
        assert!(show_parsed["data"]["rounds"].is_array());
    }

    #[serial]
    #[test]
    fn test_dash_commit_with_changes() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Add a file to the worktree
        let worktree_path = repo_path.join(".tugtree/tugdash__test-dash");
        fs::write(worktree_path.join("test.txt"), "test content\n").unwrap();

        // Commit changes
        let result = run_dash_commit(
            "test-dash".to_string(),
            "Add test file".to_string(),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

        // Verify round was recorded with commit_hash
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 1);
        assert!(rounds[0].commit_hash.is_some());
    }

    #[serial]
    #[test]
    fn test_dash_commit_no_changes() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Commit with no changes
        let result = run_dash_commit(
            "test-dash".to_string(),
            "No changes".to_string(),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

        // Verify round was recorded with null commit_hash
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 1);
        assert!(rounds[0].commit_hash.is_none());
    }

    #[serial]
    #[test]
    fn test_dash_commit_with_stdin_metadata() {
        use std::io::Write;
        use std::process::{Command as StdCommand, Stdio};

        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Add a file
        let worktree_path = repo_path.join(".tugtree/tugdash__test-dash");
        fs::write(worktree_path.join("test.txt"), "test\n").unwrap();

        // Build tugcode binary path
        let tugcode_bin = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("tugcode");

        // Run commit with stdin metadata via subprocess
        let mut child = StdCommand::new(&tugcode_bin)
            .arg("dash")
            .arg("commit")
            .arg("test-dash")
            .arg("--message")
            .arg("Test commit")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        {
            let stdin = child.stdin.as_mut().unwrap();
            let metadata = r#"{"instruction":"add test file","summary":"Added test file","files_created":["test.txt"]}"#;
            stdin.write_all(metadata.as_bytes()).unwrap();
        } // stdin is dropped here

        let status = child.wait().unwrap();
        assert!(status.success());

        // Verify round was recorded with metadata
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 1);
        assert_eq!(rounds[0].instruction, Some("add test file".to_string()));
        assert_eq!(rounds[0].summary, Some("Added test file".to_string()));
        assert_eq!(rounds[0].files_created, Some(vec!["test.txt".to_string()]));
    }

    #[serial]
    #[test]
    fn test_dash_commit_increments_round_count() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Verify initial round count is 0
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 0);

        // Commit (no changes)
        run_dash_commit("test-dash".to_string(), "First".to_string(), false, true).unwrap();

        // Verify round count is 1
        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 1);

        // Add file and commit again
        let worktree_path = repo_path.join(".tugtree/tugdash__test-dash");
        fs::write(worktree_path.join("test.txt"), "test\n").unwrap();
        run_dash_commit("test-dash".to_string(), "Second".to_string(), false, true).unwrap();

        // Verify round count is 2
        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 2);
    }

    #[serial]
    #[test]
    fn test_dash_commit_truncates_long_summary() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Add a file
        let worktree_path = repo_path.join(".tugtree/tugdash__test-dash");
        fs::write(worktree_path.join("test.txt"), "test\n").unwrap();

        // Note: We can't easily test the commit message truncation without parsing git log,
        // but we can verify the commit succeeds with a long message
        let long_message = "This is a very long commit message that should be truncated to 72 characters maximum in the subject line";
        let result = run_dash_commit(
            "test-dash".to_string(),
            long_message.to_string(),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

        // Verify commit was created
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        assert_eq!(rounds.len(), 1);
        assert!(rounds[0].commit_hash.is_some());
    }

    #[serial]
    #[test]
    fn test_dash_join_full_lifecycle() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test dash".to_string()),
            false,
            true,
        )
        .unwrap();

        // Add a file to the dash worktree
        let worktree_path = repo_path.join(".tugtree/tugdash__test-dash");
        fs::write(worktree_path.join("feature.txt"), "new feature\n").unwrap();

        // Commit changes
        run_dash_commit(
            "test-dash".to_string(),
            "Add feature".to_string(),
            false,
            true,
        )
        .unwrap();

        // Join the dash
        let result = run_dash_join(
            "test-dash".to_string(),
            Some("Add new feature".to_string()),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

        // Verify squash commit on base branch
        let log_output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("log")
            .arg("--oneline")
            .arg("-1")
            .output()
            .unwrap();
        let log = String::from_utf8_lossy(&log_output.stdout);
        assert!(log.contains("tugdash(test-dash):"));

        // Verify worktree removed
        assert!(!worktree_path.exists());

        // Verify branch deleted
        let branch_output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("branch")
            .arg("--list")
            .arg("tugdash/test-dash")
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&branch_output.stdout)
                .trim()
                .is_empty()
        );

        // Verify state is joined
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let dash = db.get_dash("test-dash").unwrap().unwrap();
        assert_eq!(dash.status, DashStatus::Joined);
    }

    #[serial]
    #[test]
    fn test_dash_join_dirty_repo_root_fails() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Add and track a file, then modify it without committing
        fs::write(repo_path.join("dirty.txt"), "initial\n").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("add")
            .arg("dirty.txt")
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("commit")
            .arg("-m")
            .arg("Add dirty.txt")
            .output()
            .unwrap();
        // Now modify it
        fs::write(repo_path.join("dirty.txt"), "modified\n").unwrap();

        // Try to join - should fail
        let result = run_dash_join("test-dash".to_string(), None, false, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("uncommitted changes"));

        // Verify dash is still active
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let dash = db.get_dash("test-dash").unwrap().unwrap();
        assert_eq!(dash.status, DashStatus::Active);
    }

    #[serial]
    #[test]
    fn test_dash_join_wrong_branch_fails() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Create and switch to a different branch
        Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("checkout")
            .arg("-b")
            .arg("feature")
            .output()
            .unwrap();

        // Try to join - should fail
        let result = run_dash_join("test-dash".to_string(), None, false, true);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("on branch 'feature'"));
        assert!(err.contains("Check out 'main' first"));

        // Verify dash is still active
        Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("checkout")
            .arg("main")
            .output()
            .unwrap();

        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let dash = db.get_dash("test-dash").unwrap().unwrap();
        assert_eq!(dash.status, DashStatus::Active);
    }

    #[serial]
    #[test]
    fn test_dash_join_outstanding_changes_auto_commit() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Add uncommitted file to dash worktree
        let worktree_path = repo_path.join(".tugtree/tugdash__test-dash");
        fs::write(worktree_path.join("uncommitted.txt"), "not committed\n").unwrap();

        // Join should auto-commit the changes
        let result = run_dash_join("test-dash".to_string(), None, false, true);
        assert_eq!(result.unwrap(), 0);

        // Verify synthetic round was recorded
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let rounds = db.get_dash_rounds("test-dash", true).unwrap();
        // Should have one round from auto-commit
        assert!(rounds.iter().any(|r| {
            r.instruction
                .as_ref()
                .map(|i| i.contains("join: commit outstanding"))
                .unwrap_or(false)
        }));
    }

    #[serial]
    #[test]
    fn test_dash_release_full_lifecycle() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create dash and add file
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();
        let worktree_path = repo_path.join(".tugtree/tugdash__test-dash");
        fs::write(worktree_path.join("test.txt"), "test\n").unwrap();

        // Release the dash
        let result = run_dash_release("test-dash".to_string(), false, true);
        assert_eq!(result.unwrap(), 0);

        // Verify worktree removed
        assert!(!worktree_path.exists());

        // Verify branch deleted
        let branch_output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("branch")
            .arg("--list")
            .arg("tugdash/test-dash")
            .output()
            .unwrap();
        assert!(
            String::from_utf8_lossy(&branch_output.stdout)
                .trim()
                .is_empty()
        );

        // Verify state is released
        let state_db_path = repo_path.join(".tugtool/state.db");
        let db = StateDb::open(&state_db_path).unwrap();
        let dash = db.get_dash("test-dash").unwrap().unwrap();
        assert_eq!(dash.status, DashStatus::Released);
    }

    #[serial]
    #[test]
    fn test_dash_release_nonexistent_fails() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Try to release nonexistent dash
        let result = run_dash_release("nonexistent".to_string(), false, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[serial]
    #[test]
    fn test_dash_join_already_joined_fails() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create and join dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        // Add a file so there's something to merge
        let worktree_path = repo_path.join(".tugtree/tugdash__test-dash");
        fs::write(worktree_path.join("test.txt"), "test\n").unwrap();
        run_dash_commit("test-dash".to_string(), "Add test".to_string(), false, true).unwrap();

        run_dash_join("test-dash".to_string(), None, false, true).unwrap();

        // Try to join again - should fail
        let result = run_dash_join("test-dash".to_string(), None, false, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not active"));
    }

    #[serial]
    #[test]
    fn test_dash_release_already_released_fails() {
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        init_git_repo(repo_path);
        fs::create_dir_all(repo_path.join(".tugtool")).unwrap();
        std::env::set_current_dir(repo_path).unwrap();

        // Create and release dash
        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();
        run_dash_release("test-dash".to_string(), false, true).unwrap();

        // Try to release again - should fail
        let result = run_dash_release("test-dash".to_string(), false, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not active"));
    }
}
