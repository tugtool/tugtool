//! commit command implementation
//!
//! Atomically performs log rotation, prepend, and git commit.

use crate::commands::log::{log_prepend_inner, log_rotate_inner};
use crate::output::{CommitData, JsonResponse, StateFailureReason};
use std::path::Path;
use std::process::Command;

/// Classify a TugError from complete_step into a structured StateFailureReason.
///
/// This helper is only applicable on the complete_step error path (Path 2) where
/// a TugError is available. All other error paths set state_failure_reason directly.
fn classify_state_error(e: &tugtool_core::TugError) -> StateFailureReason {
    match e {
        tugtool_core::TugError::StateIncompleteChecklist { .. } => StateFailureReason::OpenItems,
        tugtool_core::TugError::StatePlanHashMismatch { .. } => StateFailureReason::Drift,
        tugtool_core::TugError::StateOwnershipViolation { .. }
        | tugtool_core::TugError::StateStepNotClaimed { .. } => StateFailureReason::Ownership,
        tugtool_core::TugError::StateStepNotFound { .. } => StateFailureReason::DbError,
        _ => StateFailureReason::DbError,
    }
}

/// Check if plan file has drifted from stored hash (for commit command)
/// Returns Ok(Some(warning_msg)) if drift detected, Ok(None) if no drift
fn check_commit_drift(
    repo_root: &Path,
    plan_path_str: &str,
    db: &tugtool_core::StateDb,
) -> Result<Option<String>, String> {
    // Get stored plan state to retrieve hash
    let plan_state = db.show_plan(plan_path_str).map_err(|e| e.to_string())?;
    let stored_hash = plan_state.plan_hash;

    // Compute current hash
    let plan_abs = repo_root.join(plan_path_str);
    let current_hash = tugtool_core::compute_plan_hash(&plan_abs).map_err(|e| e.to_string())?;

    if stored_hash != current_hash {
        let stored_short = &stored_hash[..8];
        let current_short = &current_hash[..8];
        Ok(Some(format!(
            "Plan file has been modified since state was initialized (stored: {}..., current: {}...). State update skipped.",
            stored_short, current_short
        )))
    } else {
        Ok(None)
    }
}

/// Run the commit command
#[allow(clippy::too_many_arguments)]
pub fn run_commit(
    worktree: String,
    step: String,
    plan: String,
    message: String,

    summary: String,

    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Convert paths to Path references
    let worktree_path = Path::new(&worktree);

    // Validate inputs
    if !worktree_path.exists() {
        return {
            if json {
                let response =
                    JsonResponse::<CommitData>::error("commit", Default::default(), vec![]);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else if !quiet {
                eprintln!("error: Worktree directory does not exist");
            }
            Err("Worktree directory does not exist".to_string())
        };
    }

    // Check that we're in a linked worktree, not the main worktree
    let git_path = worktree_path.join(".git");
    if git_path.is_dir() {
        let msg = "Refusing to auto-stage in main worktree. tugtool commit must run in a linked worktree (.git must be a file, not a directory).";
        if json {
            let response = JsonResponse::<CommitData>::error("commit", Default::default(), vec![]);
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
        } else if !quiet {
            eprintln!("error: {}", msg);
        }
        return Err(msg.to_string());
    }

    // Step 1: Rotate log if needed
    let rotate_result = log_rotate_inner(worktree_path, false)
        .map_err(|e| format!("Log rotation failed: {}", e))?;

    // Step 2: Prepend log entry
    let _prepend_result = log_prepend_inner(worktree_path, &step, &plan, &summary)
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
        let msg = format!("git add -A failed: {}", stderr);
        if json {
            let response = JsonResponse::<CommitData>::error("commit", Default::default(), vec![]);
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
        } else if !quiet {
            eprintln!("error: {}", msg);
        }
        return Err(msg);
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
        let msg = format!("git commit failed: {}", stderr);
        if json {
            let response = JsonResponse::<CommitData>::error("commit", Default::default(), vec![]);
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
        } else if !quiet {
            eprintln!("error: {}", msg);
        }
        return Err(msg);
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
        return {
            if json {
                let response =
                    JsonResponse::<CommitData>::error("commit", Default::default(), vec![]);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else if !quiet {
                eprintln!("error: Failed to get commit hash");
            }
            Err("Failed to get commit hash".to_string())
        };
    }

    let commit_hash = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Step 7: Complete step in state.db (non-fatal)
    let (state_update_failed, state_failure_reason, state_warnings) = {
        match tugtool_core::find_repo_root_from(worktree_path) {
            Ok(repo_root) => {
                // Resolve the raw --plan argument to a repo-relative path, matching
                // what every other state command does. Without this, absolute paths or
                // bare filenames diverge from the relative key stored in the DB.
                let resolved_plan = match tugtool_core::resolve_plan(&plan, &repo_root)
                    .map_err(|e| e.to_string())
                {
                    Ok(tugtool_core::ResolveResult::Found { path, .. }) => path
                        .strip_prefix(&repo_root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .into_owned(),
                    Ok(tugtool_core::ResolveResult::NotFound) => {
                        let msg = format!("state complete failed: plan not found: {}", plan);
                        return Ok({
                            let data = CommitData {
                                committed: true,
                                commit_hash: Some(commit_hash),
                                log_updated: true,
                                log_rotated: rotate_result.rotated,
                                archived_path: rotate_result.archived_path,
                                files_staged,
                                state_update_failed: true,
                                state_failure_reason: Some(StateFailureReason::DbError),
                                warnings: vec![msg],
                            };
                            if json {
                                let response = JsonResponse::ok("commit", data);
                                println!("{}", serde_json::to_string_pretty(&response).unwrap());
                            }
                            0
                        });
                    }
                    Ok(tugtool_core::ResolveResult::Ambiguous(candidates)) => {
                        let candidate_strs: Vec<String> =
                            candidates.iter().map(|p| p.display().to_string()).collect();
                        let msg = format!(
                            "state complete failed: ambiguous plan '{}'. Matches: {}",
                            plan,
                            candidate_strs.join(", ")
                        );
                        return Ok({
                            let data = CommitData {
                                committed: true,
                                commit_hash: Some(commit_hash),
                                log_updated: true,
                                log_rotated: rotate_result.rotated,
                                archived_path: rotate_result.archived_path,
                                files_staged,
                                state_update_failed: true,
                                state_failure_reason: Some(StateFailureReason::DbError),
                                warnings: vec![msg],
                            };
                            if json {
                                let response = JsonResponse::ok("commit", data);
                                println!("{}", serde_json::to_string_pretty(&response).unwrap());
                            }
                            0
                        });
                    }
                    Err(e) => {
                        let msg = format!("state complete failed: {}", e);
                        return Ok({
                            let data = CommitData {
                                committed: true,
                                commit_hash: Some(commit_hash),
                                log_updated: true,
                                log_rotated: rotate_result.rotated,
                                archived_path: rotate_result.archived_path,
                                files_staged,
                                state_update_failed: true,
                                state_failure_reason: Some(StateFailureReason::DbError),
                                warnings: vec![msg],
                            };
                            if json {
                                let response = JsonResponse::ok("commit", data);
                                println!("{}", serde_json::to_string_pretty(&response).unwrap());
                            }
                            0
                        });
                    }
                };

                let db_path = repo_root.join(".tugtool").join("state.db");
                match tugtool_core::StateDb::open(&db_path) {
                    Ok(mut db) => {
                        // Check for plan drift (Path 1 and Path 3)
                        match check_commit_drift(&repo_root, &resolved_plan, &db) {
                            Ok(Some(drift_msg)) => {
                                // Path 1: Drift detected before complete_step
                                (true, Some(StateFailureReason::Drift), vec![drift_msg])
                            }
                            Ok(None) => {
                                // Path 2: No drift, proceed with complete_step
                                match db.complete_step(
                                    &resolved_plan,
                                    &step,
                                    &worktree,
                                    false, // strict mode: deferred items allowed, open items block
                                    Some("committed via tugcode commit"),
                                ) {
                                    Ok(_) => (false, None, vec![]),
                                    Err(e) => {
                                        let reason = classify_state_error(&e);
                                        let msg = format!("state complete failed: {}", e);
                                        (true, Some(reason), vec![msg])
                                    }
                                }
                            }
                            Err(e) => {
                                // Path 3: Drift check itself failed
                                let msg = format!("drift check failed: {}", e);
                                (true, Some(StateFailureReason::DbError), vec![msg])
                            }
                        }
                    }
                    Err(e) => {
                        // Path 4: StateDb::open() failed
                        let msg = format!("state complete failed: {}", e);
                        (true, Some(StateFailureReason::DbError), vec![msg])
                    }
                }
            }
            Err(e) => {
                // Path 5: find_repo_root_from() failed
                let msg = format!("state complete failed: {}", e);
                (true, Some(StateFailureReason::DbError), vec![msg])
            }
        }
    };

    // Build response
    let data = CommitData {
        committed: true,
        commit_hash: Some(commit_hash),
        log_updated: true,
        log_rotated: rotate_result.rotated,
        archived_path: rotate_result.archived_path.clone(),
        files_staged,
        state_update_failed,
        state_failure_reason,
        warnings: {
            let mut w = vec![];
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

    Ok(0)
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
        let result = add_or_replace_trailers(msg, "step-1", ".tugtool/tugplan-foo.md");
        assert!(result.contains("Tug-Step: step-1"));
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
        let msg = "feat: update\n\nTug-Step: step-1\nTug-Plan: .tugtool/old.md";
        let result = add_or_replace_trailers(msg, "step-2", ".tugtool/new.md");
        assert!(result.contains("Tug-Step: step-2"));
        assert!(result.contains("Tug-Plan: .tugtool/new.md"));
        // Old values should NOT be present
        assert!(!result.contains("step-1"));
        assert!(!result.contains("old.md"));
        // Should not duplicate trailer keys
        assert_eq!(result.matches("Tug-Step:").count(), 1);
        assert_eq!(result.matches("Tug-Plan:").count(), 1);
    }

    #[test]
    fn test_replace_partial_trailers() {
        let msg = "feat: update\n\nTug-Step: step-1";
        let result = add_or_replace_trailers(msg, "step-1", ".tugtool/new.md");
        assert!(result.contains("Tug-Step: step-1"));
        assert!(result.contains("Tug-Plan: .tugtool/new.md"));
        assert_eq!(result.matches("Tug-Step:").count(), 1);
        assert_eq!(result.matches("Tug-Plan:").count(), 1);
    }

    #[test]
    fn test_classify_state_error_open_items_incomplete_checklist() {
        let err = tugtool_core::TugError::StateIncompleteChecklist {
            anchor: "step-1".to_string(),
            incomplete_count: 3,
        };
        assert_eq!(
            classify_state_error(&err),
            StateFailureReason::OpenItems,
            "StateIncompleteChecklist should map to OpenItems"
        );
    }

    #[test]
    fn test_classify_state_error_drift() {
        let err = tugtool_core::TugError::StatePlanHashMismatch {
            plan_path: ".tugtool/tugplan-foo.md".to_string(),
        };
        assert_eq!(
            classify_state_error(&err),
            StateFailureReason::Drift,
            "StatePlanHashMismatch should map to Drift"
        );
    }

    #[test]
    fn test_classify_state_error_ownership_violation() {
        let err = tugtool_core::TugError::StateOwnershipViolation {
            anchor: "step-1".to_string(),
            claimed_by: "/tmp/wt1".to_string(),
            worktree: "/tmp/wt2".to_string(),
        };
        assert_eq!(
            classify_state_error(&err),
            StateFailureReason::Ownership,
            "StateOwnershipViolation should map to Ownership"
        );
    }

    #[test]
    fn test_classify_state_error_step_not_claimed() {
        let err = tugtool_core::TugError::StateStepNotClaimed {
            anchor: "step-1".to_string(),
            current_status: "pending".to_string(),
        };
        assert_eq!(
            classify_state_error(&err),
            StateFailureReason::Ownership,
            "StateStepNotClaimed should map to Ownership"
        );
    }

    #[test]
    fn test_classify_state_error_db_open() {
        let err = tugtool_core::TugError::StateDbOpen {
            reason: "could not open state.db".to_string(),
        };
        assert_eq!(
            classify_state_error(&err),
            StateFailureReason::DbError,
            "StateDbOpen should map to DbError"
        );
    }

    #[test]
    fn test_classify_state_error_db_query() {
        let err = tugtool_core::TugError::StateDbQuery {
            reason: "SQL error".to_string(),
        };
        assert_eq!(
            classify_state_error(&err),
            StateFailureReason::DbError,
            "StateDbQuery should map to DbError"
        );
    }

    #[test]
    fn test_classify_state_error_step_not_found() {
        let err = tugtool_core::TugError::StateStepNotFound {
            plan_path: ".tugtool/tugplan-foo.md".to_string(),
            anchor: "step-99".to_string(),
        };
        assert_eq!(
            classify_state_error(&err),
            StateFailureReason::DbError,
            "StateStepNotFound should map to DbError"
        );
    }
}
