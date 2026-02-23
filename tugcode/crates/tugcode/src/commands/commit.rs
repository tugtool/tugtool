//! commit command implementation
//!
//! Atomically performs log rotation, prepend, git commit, and bead close.

use crate::commands::log::{log_prepend_inner, log_rotate_inner};
use crate::output::{CommitData, JsonResponse};
use std::path::Path;
use std::process::Command;

/// Run the commit command
#[allow(clippy::too_many_arguments)]
pub fn run_commit(
    worktree: String,
    step: String,
    plan: String,
    message: String,
    bead: String,
    summary: String,
    close_reason: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Convert paths to Path references
    let worktree_path = Path::new(&worktree);

    // Validate inputs
    if !worktree_path.exists() {
        return error_response("Worktree directory does not exist", json, quiet);
    }

    // Check that we're in a linked worktree, not the main worktree
    let git_path = worktree_path.join(".git");
    if git_path.is_dir() {
        return error_response(
            "Refusing to auto-stage in main worktree. \
             tugtool commit must run in a linked worktree (.git must be a file, not a directory).",
            json,
            quiet,
        );
    }

    // Step 1: Rotate log if needed
    let rotate_result = log_rotate_inner(worktree_path, false)
        .map_err(|e| format!("Log rotation failed: {}", e))?;

    // Step 2: Prepend log entry
    let _prepend_result = log_prepend_inner(worktree_path, &step, &plan, &summary, Some(&bead))
        .map_err(|e| format!("Log prepend failed: {}", e))?;

    // Step 3: Stage all changes
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("add")
        .arg("-A")
        .output()
        .map_err(|e| format!("Failed to run git add -A: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return error_response(&format!("git add -A failed: {}", stderr), json, quiet);
    }

    // Step 3b: Collect actually-staged files for reporting
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("diff")
        .arg("--cached")
        .arg("--name-only")
        .output()
        .map_err(|e| format!("Failed to run git diff --cached: {}", e))?;

    let files_staged: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    // Step 3c: Append Tug-Step and Tug-Plan trailers to commit message
    let message = add_or_replace_trailers(&message, &step, &plan);

    // Step 4: Commit
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("commit")
        .arg("-m")
        .arg(&message)
        .output()
        .map_err(|e| format!("Failed to run git commit: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return error_response(&format!("git commit failed: {}", stderr), json, quiet);
    }

    // Step 5: Get commit hash
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("Failed to run git rev-parse: {}", e))?;

    if !output.status.success() {
        return error_response("Failed to get commit hash", json, quiet);
    }

    let commit_hash = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Step 6: Close bead
    let (bead_closed, warnings) =
        close_bead_in_worktree(worktree_path, &bead, close_reason.as_deref())?;

    // If bead close failed after commit, record in output
    let bead_close_failed = !bead_closed;

    // Step 7: Complete step in state.db (non-fatal)
    let (state_update_failed, state_warnings) = {
        match tugtool_core::find_repo_root_from(worktree_path) {
            Ok(repo_root) => {
                let db_path = repo_root.join(".tugtool").join("state.db");
                match tugtool_core::StateDb::open(&db_path) {
                    Ok(mut db) => {
                        match db.complete_step(
                            &plan,
                            &step,
                            &worktree,
                            true, // force: commit already happened
                            Some("committed via tugcode commit"),
                        ) {
                            Ok(_) => (false, vec![]),
                            Err(e) => {
                                let msg = format!("state complete failed: {}", e);
                                (true, vec![msg])
                            }
                        }
                    }
                    Err(e) => {
                        let msg = format!("state complete failed: {}", e);
                        (true, vec![msg])
                    }
                }
            }
            Err(e) => {
                let msg = format!("state complete failed: {}", e);
                (true, vec![msg])
            }
        }
    };

    // Build response
    let data = CommitData {
        committed: true,
        commit_hash: Some(commit_hash),
        bead_closed,
        bead_id: if bead_closed {
            Some(bead.clone())
        } else {
            None
        },
        log_updated: true,
        log_rotated: rotate_result.rotated,
        archived_path: rotate_result.archived_path.clone(),
        files_staged,
        bead_close_failed,
        state_update_failed,
        warnings: {
            let mut w = warnings; // bead close warnings
            w.extend(state_warnings);
            w
        },
    };

    if json {
        let response = JsonResponse::ok("commit", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Step committed successfully");
        println!("  Commit: {}", data.commit_hash.as_ref().unwrap());
        println!(
            "  Bead: {} ({})",
            bead,
            if bead_closed {
                "closed"
            } else {
                "FAILED - needs reconcile"
            }
        );
        if rotate_result.rotated {
            println!(
                "  Log rotated: {}",
                rotate_result.archived_path.unwrap_or_default()
            );
        }
        if state_update_failed {
            println!("  State: FAILED - needs reconcile");
        } else {
            println!("  State: completed");
        }
    }

    // Exit 0 even if bead_close_failed or state_update_failed (commit succeeded)
    Ok(0)
}

/// Helper to close bead in worktree context
fn close_bead_in_worktree(
    worktree_path: &Path,
    bead_id: &str,
    reason: Option<&str>,
) -> Result<(bool, Vec<String>), String> {
    use tugtool_core::{BeadsCli, Config};

    // Load config from worktree
    let config = Config::load_from_project(worktree_path).unwrap_or_default();
    let bd_path =
        std::env::var("TUG_BD_PATH").unwrap_or_else(|_| config.tugtool.beads.bd_path.clone());

    let beads = BeadsCli::new(bd_path);

    // Check if beads CLI is installed (from worktree context)
    if !beads.is_installed(Some(worktree_path)) {
        return Ok((
            false,
            vec!["beads CLI not installed or not found".to_string()],
        ));
    }

    // Close bead via BeadsCli with working_dir so bd finds .beads/
    match beads.close(bead_id, reason, Some(worktree_path)) {
        Ok(_) => Ok((true, vec![])),
        Err(e) => Ok((false, vec![format!("Bead close failed: {}", e)])),
    }
}

/// Helper to construct error response
fn error_response(message: &str, json: bool, quiet: bool) -> Result<i32, String> {
    let data = CommitData {
        committed: false,
        commit_hash: None,
        bead_closed: false,
        bead_id: None,
        log_updated: false,
        log_rotated: false,
        archived_path: None,
        files_staged: vec![],
        bead_close_failed: false,
        state_update_failed: false,
        warnings: vec![],
    };

    if json {
        let response = JsonResponse::error("commit", data, vec![]);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        eprintln!("Error: {}", message);
    }

    Err(message.to_string())
}

/// Append or replace Tug-Step and Tug-Plan trailers in a commit message.
/// If trailers already exist, their values are replaced (idempotent).
/// If not, they are appended after a blank line separator.
fn add_or_replace_trailers(message: &str, step: &str, plan: &str) -> String {
    let mut lines: Vec<String> = message.lines().map(|l| l.to_string()).collect();
    let mut found_step = false;
    let mut found_plan = false;

    for line in lines.iter_mut() {
        if line.starts_with("Tug-Step:") {
            *line = format!("Tug-Step: {}", step);
            found_step = true;
        } else if line.starts_with("Tug-Plan:") {
            *line = format!("Tug-Plan: {}", plan);
            found_plan = true;
        }
    }

    let mut result = lines.join("\n");

    if !found_step || !found_plan {
        // Ensure blank line separator before trailer block
        if !result.ends_with("\n\n") {
            if !result.ends_with('\n') {
                result.push('\n');
            }
            result.push('\n');
        }
        if !found_step {
            result.push_str(&format!("Tug-Step: {}", step));
            result.push('\n');
        }
        if !found_plan {
            result.push_str(&format!("Tug-Plan: {}", plan));
            result.push('\n');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_trailers_to_simple_message() {
        let msg = "feat: add feature";
        let result = add_or_replace_trailers(msg, "step-0", ".tugtool/tugplan-foo.md");
        assert!(result.contains("Tug-Step: step-0"));
        assert!(result.contains("Tug-Plan: .tugtool/tugplan-foo.md"));
        // Should have blank line separator
        assert!(result.contains("\n\nTug-"));
    }

    #[test]
    fn test_add_trailers_to_multiline_message() {
        let msg = "feat: add feature\n\nDetailed description here.";
        let result = add_or_replace_trailers(msg, "step-1", ".tugtool/tugplan-bar.md");
        assert!(result.contains("Tug-Step: step-1"));
        assert!(result.contains("Tug-Plan: .tugtool/tugplan-bar.md"));
        assert!(result.contains("Detailed description here."));
    }

    #[test]
    fn test_replace_existing_trailers() {
        let msg = "feat: update\n\nTug-Step: step-0\nTug-Plan: .tugtool/old.md";
        let result = add_or_replace_trailers(msg, "step-1", ".tugtool/new.md");
        assert!(result.contains("Tug-Step: step-1"));
        assert!(result.contains("Tug-Plan: .tugtool/new.md"));
        // Old values should NOT be present
        assert!(!result.contains("step-0"));
        assert!(!result.contains("old.md"));
        // Should not duplicate trailer keys
        assert_eq!(result.matches("Tug-Step:").count(), 1);
        assert_eq!(result.matches("Tug-Plan:").count(), 1);
    }

    #[test]
    fn test_replace_partial_trailers() {
        let msg = "feat: update\n\nTug-Step: step-0";
        let result = add_or_replace_trailers(msg, "step-1", ".tugtool/new.md");
        assert!(result.contains("Tug-Step: step-1"));
        assert!(result.contains("Tug-Plan: .tugtool/new.md"));
        assert_eq!(result.matches("Tug-Step:").count(), 1);
        assert_eq!(result.matches("Tug-Plan:").count(), 1);
    }
}
