//! step-commit command implementation
//!
//! Atomically performs log rotation, prepend, git commit, and bead close.

use crate::commands::log::{log_prepend_inner, log_rotate_inner};
use crate::output::{JsonResponse, StepCommitData};
use std::path::Path;
use std::process::Command;

/// Run the step-commit command
#[allow(clippy::too_many_arguments)]
pub fn run_step_commit(
    worktree: String,
    step: String,
    plan: String,
    message: String,
    files: Vec<String>,
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

    // Validate that all files exist in worktree
    for file in &files {
        let file_path = worktree_path.join(file);
        if !file_path.exists() {
            return error_response(
                &format!("File not found in worktree: {}", file),
                json,
                quiet,
            );
        }
    }

    // Step 1: Rotate log if needed
    let rotate_result = log_rotate_inner(worktree_path, false)
        .map_err(|e| format!("Log rotation failed: {}", e))?;

    // Step 2: Prepend log entry
    let _prepend_result = log_prepend_inner(worktree_path, &step, &plan, &summary, Some(&bead))
        .map_err(|e| format!("Log prepend failed: {}", e))?;

    // Step 3: Stage files
    let mut files_to_stage = files.clone();

    // Add implementation log
    files_to_stage.push(".tugtool/tugplan-implementation-log.md".to_string());

    // If rotation occurred, add archive directory
    if rotate_result.rotated {
        files_to_stage.push(".tugtool/archive".to_string());
    }

    // Stage all files
    for file in &files_to_stage {
        let output = Command::new("git")
            .arg("-C")
            .arg(worktree_path)
            .arg("add")
            .arg(file)
            .output()
            .map_err(|e| format!("Failed to run git add: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git add failed for {}: {}", file, stderr));
        }
    }

    // Step 3b: Check for orphaned changes (unstaged modifications not in files list)
    // This prevents silently losing work when the caller's file list is incomplete.
    let orphaned = find_orphaned_changes(worktree_path)?;
    if !orphaned.is_empty() {
        let file_list = orphaned.join("\n  ");
        return error_response(
            &format!(
                "Worktree has unstaged changes not in --files list:\n  {}\n\
                 These files were modified but would not be committed. \
                 Add them to --files or revert them.",
                file_list
            ),
            json,
            quiet,
        );
    }

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

    // Build response
    let data = StepCommitData {
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
        files_staged: files_to_stage,
        bead_close_failed,
        warnings,
    };

    if json {
        let response = JsonResponse::ok("step-commit", data);
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
    }

    // Exit 0 even if bead_close_failed (commit succeeded)
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
    let data = StepCommitData {
        committed: false,
        commit_hash: None,
        bead_closed: false,
        bead_id: None,
        log_updated: false,
        log_rotated: false,
        archived_path: None,
        files_staged: vec![],
        bead_close_failed: false,
        warnings: vec![],
    };

    if json {
        let response = JsonResponse::error("step-commit", data, vec![]);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        eprintln!("Error: {}", message);
    }

    Err(message.to_string())
}

/// Check for modified/untracked files in the worktree that aren't staged.
/// Returns file paths that would be lost if we commit only the staged set.
fn find_orphaned_changes(worktree_path: &Path) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("status")
        .arg("--porcelain")
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut orphaned = Vec::new();

    for line in stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_status = line.as_bytes()[0];
        let worktree_status = line.as_bytes()[1];
        let file_path = line[3..].to_string();

        // Skip .tugtool/ infrastructure files — these are managed separately
        if file_path.starts_with(".tugtool/") {
            continue;
        }

        // A file is "orphaned" if it has worktree modifications that aren't staged:
        // - ' M' = modified but not staged
        // - ' D' = deleted but not staged
        // - '??' = untracked
        // - 'MM' = staged AND has additional unstaged modifications
        let is_orphaned = match (index_status, worktree_status) {
            (b' ', b'M') | (b' ', b'D') => true, // unstaged modification/deletion
            (b'?', b'?') => true,                // untracked file
            (_, b'M') | (_, b'D') => true,       // staged but also has unstaged changes
            _ => false,
        };

        if is_orphaned {
            orphaned.push(file_path);
        }
    }

    Ok(orphaned)
}
