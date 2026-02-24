//! Doctor command - health checks for tugtool project

use std::path::Path;
use std::process::Command;

use crate::output::{DoctorData, DoctorSummary, HealthCheck, JsonResponse};

/// Exit codes per Table T02
const EXIT_PASS: u8 = 0;
const EXIT_WARN: u8 = 1;
const EXIT_FAIL: u8 = 2;

/// Log size thresholds per Table T02
const LOG_LINE_WARN: usize = 400;
const LOG_LINE_FAIL: usize = 500;
const LOG_BYTE_WARN: usize = 80 * 1024; // 80KB
const LOG_BYTE_FAIL: usize = 100 * 1024; // 100KB

/// PR state from gh pr view
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PrState {
    Merged,
    Open,
    Closed,
    NotFound,
    Unknown,
}

/// Check PR state using GitHub API
///
/// Queries `gh pr view <branch> --json state,mergedAt` to detect PR state.
///
/// # Arguments
/// * `branch` - Branch name to check
///
/// # Returns
/// * `PrState::Merged` - PR is merged
/// * `PrState::Open` - PR is open
/// * `PrState::Closed` - PR is closed but not merged
/// * `PrState::NotFound` - No PR exists for this branch
/// * `PrState::Unknown` - gh CLI error or unavailable
fn get_pr_state(branch: &str) -> PrState {
    // Check if gh CLI is available
    let gh_check = Command::new("gh").arg("--version").output();
    if gh_check.is_err() {
        return PrState::Unknown;
    }

    // Query PR information
    let output = match Command::new("gh")
        .args(["pr", "view", branch, "--json", "state,mergedAt"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return PrState::Unknown,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // "no pull requests found" means no PR exists
        if stderr.contains("no pull requests found") {
            return PrState::NotFound;
        }
        // Other gh errors
        return PrState::Unknown;
    }

    // Parse the JSON response
    let stdout = String::from_utf8_lossy(&output.stdout);

    #[derive(serde::Deserialize)]
    struct PrStateJson {
        state: String,
        #[allow(dead_code)]
        #[serde(rename = "mergedAt")]
        merged_at: Option<String>,
    }

    match serde_json::from_str::<PrStateJson>(&stdout) {
        Ok(pr_state) => match pr_state.state.as_str() {
            "MERGED" => PrState::Merged,
            "OPEN" => PrState::Open,
            "CLOSED" => PrState::Closed,
            _ => PrState::Unknown,
        },
        Err(_) => PrState::Unknown,
    }
}

/// Run the doctor command
pub fn run_doctor(json_output: bool, quiet: bool) -> Result<i32, String> {
    // Run all health checks
    let checks = vec![
        check_initialized(),
        check_log_size(),
        check_worktrees(),
        check_stale_branches(),
        check_orphaned_worktrees(),
        check_orphaned_sessions(),
        check_closed_pr_worktrees(),
        check_broken_refs(),
        check_state_health(),
    ];

    // Calculate summary
    let passed = checks.iter().filter(|c| c.status == "pass").count();
    let warnings = checks.iter().filter(|c| c.status == "warn").count();
    let failures = checks.iter().filter(|c| c.status == "fail").count();

    let summary = DoctorSummary {
        passed,
        warnings,
        failures,
    };

    let data = DoctorData { checks, summary };

    // Determine exit code
    let exit_code = if failures > 0 {
        EXIT_FAIL as i32
    } else if warnings > 0 {
        EXIT_WARN as i32
    } else {
        EXIT_PASS as i32
    };

    // Output results
    if json_output {
        let response = if exit_code == EXIT_PASS as i32 {
            JsonResponse::ok("doctor", data)
        } else {
            JsonResponse::error("doctor", data, vec![])
        };
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        print_doctor_results(&data);
    }

    Ok(exit_code)
}

/// Print doctor results in text format
fn print_doctor_results(data: &DoctorData) {
    println!("Health Check Results:");
    println!();

    for check in &data.checks {
        let icon = match check.status.as_str() {
            "pass" => "✓",
            "warn" => "⚠",
            "fail" => "✗",
            _ => "?",
        };
        println!("  {} {} - {}", icon, check.name, check.message);
    }

    println!();
    println!(
        "Summary: {} passed, {} warnings, {} failures",
        data.summary.passed, data.summary.warnings, data.summary.failures
    );
}

/// Check if tugtool is initialized
fn check_initialized() -> HealthCheck {
    let tug_dir = Path::new(".tugtool");

    if !tug_dir.exists() {
        return HealthCheck {
            name: "initialized".to_string(),
            status: "fail".to_string(),
            message: "Tugtool is not initialized (.tugtool/ directory missing)".to_string(),
            details: None,
        };
    }

    // Check for required files
    let required_files = ["tugplan-skeleton.md", "config.toml"];
    let missing: Vec<_> = required_files
        .iter()
        .filter(|f| !tug_dir.join(f).exists())
        .collect();

    if !missing.is_empty() {
        return HealthCheck {
            name: "initialized".to_string(),
            status: "fail".to_string(),
            message: format!(
                "Tugtool directory missing required files: {}",
                missing
                    .iter()
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            details: None,
        };
    }

    HealthCheck {
        name: "initialized".to_string(),
        status: "pass".to_string(),
        message: "Tugtool is initialized".to_string(),
        details: None,
    }
}

/// Check implementation log size
fn check_log_size() -> HealthCheck {
    let log_path = Path::new(".tugtool/tugplan-implementation-log.md");

    if !log_path.exists() {
        return HealthCheck {
            name: "log_size".to_string(),
            status: "pass".to_string(),
            message: "Implementation log not found (no history yet)".to_string(),
            details: None,
        };
    }

    // Read the file to get line count and byte size
    let content = match std::fs::read_to_string(log_path) {
        Ok(c) => c,
        Err(e) => {
            return HealthCheck {
                name: "log_size".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to read implementation log: {}", e),
                details: None,
            };
        }
    };

    let lines = content.lines().count();
    let bytes = content.len();

    let details = serde_json::json!({
        "lines": lines,
        "bytes": bytes
    });

    // Determine status based on thresholds
    if lines > LOG_LINE_FAIL || bytes > LOG_BYTE_FAIL {
        HealthCheck {
            name: "log_size".to_string(),
            status: "fail".to_string(),
            message: format!(
                "Implementation log exceeds limits ({} lines, {} bytes)",
                lines, bytes
            ),
            details: Some(details),
        }
    } else if lines > LOG_LINE_WARN || bytes > LOG_BYTE_WARN {
        HealthCheck {
            name: "log_size".to_string(),
            status: "warn".to_string(),
            message: format!(
                "Implementation log approaching limits ({} lines, {} bytes)",
                lines, bytes
            ),
            details: Some(details),
        }
    } else {
        HealthCheck {
            name: "log_size".to_string(),
            status: "pass".to_string(),
            message: format!(
                "Implementation log size OK ({} lines, {} bytes)",
                lines, bytes
            ),
            details: Some(details),
        }
    }
}

/// Check worktree consistency
fn check_worktrees() -> HealthCheck {
    let worktrees_dir = Path::new(".tugtree");

    if !worktrees_dir.exists() {
        return HealthCheck {
            name: "worktrees".to_string(),
            status: "pass".to_string(),
            message: "No worktrees directory (no implementations yet)".to_string(),
            details: None,
        };
    }

    // List all worktree directories
    let entries = match std::fs::read_dir(worktrees_dir) {
        Ok(e) => e,
        Err(e) => {
            return HealthCheck {
                name: "worktrees".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to read worktrees directory: {}", e),
                details: None,
            };
        }
    };

    let mut valid_count = 0;
    let mut invalid_paths = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Only validate directories matching tugtool__* pattern
            // Exclude infrastructure directories like .sessions
            let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
            if !dir_name.starts_with("tugtool__") {
                continue;
            }

            // Check if path follows the expected pattern
            if !tugtool_core::is_valid_worktree_path(&path) {
                invalid_paths.push(path.to_string_lossy().to_string());
            } else {
                valid_count += 1;
            }
        }
    }

    if !invalid_paths.is_empty() {
        let details = serde_json::json!({
            "invalid_paths": invalid_paths
        });
        HealthCheck {
            name: "worktrees".to_string(),
            status: "fail".to_string(),
            message: format!("{} invalid worktree path(s) found", invalid_paths.len()),
            details: Some(details),
        }
    } else if valid_count == 0 {
        HealthCheck {
            name: "worktrees".to_string(),
            status: "pass".to_string(),
            message: "No worktrees found".to_string(),
            details: None,
        }
    } else {
        HealthCheck {
            name: "worktrees".to_string(),
            status: "pass".to_string(),
            message: format!("{} worktree(s) found, all paths valid", valid_count),
            details: None,
        }
    }
}

/// Check for stale tug/* branches without worktrees
fn check_stale_branches() -> HealthCheck {
    let repo_root = Path::new(".");

    // Get list of tug/* branches
    let branches = match tugtool_core::list_tugtool_branches(repo_root) {
        Ok(b) => b,
        Err(e) => {
            return HealthCheck {
                name: "stale_branches".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to list branches: {}", e),
                details: None,
            };
        }
    };

    // Get list of active worktrees
    let worktrees = match tugtool_core::list_worktrees(repo_root) {
        Ok(w) => w,
        Err(e) => {
            return HealthCheck {
                name: "stale_branches".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to list worktrees: {}", e),
                details: None,
            };
        }
    };

    // Build set of branches with worktrees
    let active_branches: std::collections::HashSet<_> =
        worktrees.iter().map(|s| s.branch.clone()).collect();

    // Find branches without worktrees
    let stale: Vec<_> = branches
        .iter()
        .filter(|b| !active_branches.contains(*b))
        .cloned()
        .collect();

    let stale_count = stale.len();

    if stale_count == 0 {
        HealthCheck {
            name: "stale_branches".to_string(),
            status: "pass".to_string(),
            message: "No stale branches found".to_string(),
            details: None,
        }
    } else if stale_count <= 2 {
        let details = serde_json::json!({
            "stale_branches": stale
        });
        HealthCheck {
            name: "stale_branches".to_string(),
            status: "warn".to_string(),
            message: format!("{} stale branch(es) without worktrees", stale_count),
            details: Some(details),
        }
    } else {
        let details = serde_json::json!({
            "stale_branches": stale
        });
        HealthCheck {
            name: "stale_branches".to_string(),
            status: "fail".to_string(),
            message: format!(
                "{} stale branches without worktrees (clean up recommended)",
                stale_count
            ),
            details: Some(details),
        }
    }
}

/// Check for orphaned worktrees (no PR and not in progress)
fn check_orphaned_worktrees() -> HealthCheck {
    let repo_root = Path::new(".");

    // Get list of active worktrees
    let worktrees = match tugtool_core::list_worktrees(repo_root) {
        Ok(w) => w,
        Err(e) => {
            return HealthCheck {
                name: "orphaned_worktrees".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to list worktrees: {}", e),
                details: None,
            };
        }
    };

    // Find worktrees that have no PR
    let mut orphaned = Vec::new();
    for wt in &worktrees {
        let pr_state = get_pr_state(&wt.branch);
        if pr_state == PrState::NotFound {
            orphaned.push(wt.branch.clone());
        }
    }

    let orphaned_count = orphaned.len();

    if orphaned_count == 0 {
        HealthCheck {
            name: "orphaned_worktrees".to_string(),
            status: "pass".to_string(),
            message: "No orphaned worktrees found".to_string(),
            details: None,
        }
    } else if orphaned_count <= 2 {
        let details = serde_json::json!({
            "orphaned_worktrees": orphaned
        });
        HealthCheck {
            name: "orphaned_worktrees".to_string(),
            status: "warn".to_string(),
            message: format!("{} orphaned worktree(s) without PRs", orphaned_count),
            details: Some(details),
        }
    } else {
        let details = serde_json::json!({
            "orphaned_worktrees": orphaned
        });
        HealthCheck {
            name: "orphaned_worktrees".to_string(),
            status: "fail".to_string(),
            message: format!(
                "{} orphaned worktrees without PRs (clean up recommended)",
                orphaned_count
            ),
            details: Some(details),
        }
    }
}

/// Check for sessionless worktrees (directories in git worktree list without parseable sessions)
/// Check for orphaned .sessions/ directory
///
/// After session elimination, the `.tugtree/.sessions/` directory
/// should not exist. If it does, it's orphaned and should be manually removed.
fn check_orphaned_sessions() -> HealthCheck {
    let sessions_dir = Path::new(".tugtree/.sessions");

    if !sessions_dir.exists() {
        return HealthCheck {
            name: "orphaned_sessions".to_string(),
            status: "pass".to_string(),
            message: "No orphaned session directory found".to_string(),
            details: None,
        };
    }

    // Directory exists - check if it has files
    let entries: Vec<_> = match std::fs::read_dir(sessions_dir) {
        Ok(e) => e.filter_map(|entry| entry.ok()).collect(),
        Err(e) => {
            return HealthCheck {
                name: "orphaned_sessions".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to read .sessions directory: {}", e),
                details: None,
            };
        }
    };

    if entries.is_empty() {
        // Empty directory - warn with cleanup suggestion
        HealthCheck {
            name: "orphaned_sessions".to_string(),
            status: "warn".to_string(),
            message: "Orphaned .sessions/ directory found (empty)".to_string(),
            details: Some(serde_json::json!({
                "recommendation": "Remove empty directory: rm -rf .tugtree/.sessions"
            })),
        }
    } else {
        // Contains files - warn with file list
        let session_files: Vec<String> = entries
            .iter()
            .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
            .collect();

        HealthCheck {
            name: "orphaned_sessions".to_string(),
            status: "warn".to_string(),
            message: format!(
                "Orphaned .sessions/ directory found with {} file(s)",
                session_files.len()
            ),
            details: Some(serde_json::json!({
                "session_files": session_files,
                "recommendation": "Session files are no longer used. Review and remove: rm -rf .tugtree/.sessions"
            })),
        }
    }
}

/// Check for worktrees with closed-but-unmerged PRs
fn check_closed_pr_worktrees() -> HealthCheck {
    let repo_root = Path::new(".");

    // Get list of active worktrees
    let worktrees = match tugtool_core::list_worktrees(repo_root) {
        Ok(w) => w,
        Err(e) => {
            return HealthCheck {
                name: "closed_pr_worktrees".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to list worktrees: {}", e),
                details: None,
            };
        }
    };

    // Find worktrees with closed PRs
    let mut closed_pr_worktrees = Vec::new();
    for wt in &worktrees {
        let pr_state = get_pr_state(&wt.branch);
        if pr_state == PrState::Closed {
            closed_pr_worktrees.push(wt.branch.clone());
        }
    }

    let closed_count = closed_pr_worktrees.len();

    if closed_count == 0 {
        HealthCheck {
            name: "closed_pr_worktrees".to_string(),
            status: "pass".to_string(),
            message: "No worktrees with closed PRs found".to_string(),
            details: None,
        }
    } else {
        let details = serde_json::json!({
            "closed_pr_worktrees": closed_pr_worktrees,
            "recommendation": "These PRs are closed but not merged. Review and either reopen or clean up the worktree."
        });
        HealthCheck {
            name: "closed_pr_worktrees".to_string(),
            status: "warn".to_string(),
            message: format!("{} worktree(s) with closed-but-unmerged PRs", closed_count),
            details: Some(details),
        }
    }
}

/// Check for broken anchor references
fn check_broken_refs() -> HealthCheck {
    use tugtool_core::{Severity, parse_tugplan, validate_tugplan};

    let tug_dir = Path::new(".tugtool");
    if !tug_dir.exists() {
        return HealthCheck {
            name: "broken_refs".to_string(),
            status: "pass".to_string(),
            message: "No .tugtool directory to check".to_string(),
            details: None,
        };
    }

    // Find all plan files
    let entries = match std::fs::read_dir(tug_dir) {
        Ok(e) => e,
        Err(e) => {
            return HealthCheck {
                name: "broken_refs".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to read .tugtool directory: {}", e),
                details: None,
            };
        }
    };

    let mut broken_refs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let filename = path.file_name().unwrap().to_string_lossy();
            // Skip skeleton, config, and log files
            if filename.starts_with("tugplan-")
                && filename.ends_with(".md")
                && filename != "tugplan-skeleton.md"
                && filename != "tugplan-implementation-log.md"
            {
                // Read and parse the plan
                match std::fs::read_to_string(&path) {
                    Ok(content) => {
                        match parse_tugplan(&content) {
                            Ok(plan) => {
                                let result = validate_tugplan(&plan);
                                // Look for broken reference errors (E010)
                                for issue in &result.issues {
                                    if issue.code == "E010" && issue.severity == Severity::Error {
                                        broken_refs
                                            .push(format!("{}: {}", filename, issue.message));
                                    }
                                }
                            }
                            Err(_) => {
                                // Skip files that can't be parsed
                                continue;
                            }
                        }
                    }
                    Err(_) => {
                        // Skip files that can't be read
                        continue;
                    }
                }
            }
        }
    }

    if broken_refs.is_empty() {
        HealthCheck {
            name: "broken_refs".to_string(),
            status: "pass".to_string(),
            message: "No broken anchor references found".to_string(),
            details: None,
        }
    } else {
        let details = serde_json::json!({
            "refs": broken_refs
        });
        HealthCheck {
            name: "broken_refs".to_string(),
            status: "fail".to_string(),
            message: format!("{} broken anchor reference(s) found", broken_refs.len()),
            details: Some(details),
        }
    }
}

/// Check state.db health (inner implementation for testability)
fn check_state_health_at(db_path: &Path, plan_root: &Path) -> HealthCheck {
    // Phase 1: state.db is optional -- absence is OK
    if !db_path.exists() {
        return HealthCheck {
            name: "state_health".to_string(),
            status: "pass".to_string(),
            message: "No state.db found (optional in Phase 1)".to_string(),
            details: None,
        };
    }

    // Open the database
    let db = match tugtool_core::StateDb::open(db_path) {
        Ok(db) => db,
        Err(e) => {
            return HealthCheck {
                name: "state_health".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to open state.db: {}", e),
                details: None,
            };
        }
    };

    // Check schema version
    match db.schema_version() {
        Ok(version) => {
            if version != 3 {
                return HealthCheck {
                    name: "state_health".to_string(),
                    status: "fail".to_string(),
                    message: format!(
                        "state.db schema version mismatch: expected 3, got {}",
                        version
                    ),
                    details: None,
                };
            }
        }
        Err(e) => {
            return HealthCheck {
                name: "state_health".to_string(),
                status: "fail".to_string(),
                message: format!("Failed to read schema version: {}", e),
                details: None,
            };
        }
    }

    // Check for orphaned plans (plan_path in DB but file missing on disk)
    match db.list_plan_paths() {
        Ok(plan_paths) => {
            let orphaned: Vec<String> = plan_paths
                .iter()
                .filter(|p| !plan_root.join(p).exists())
                .cloned()
                .collect();

            if orphaned.is_empty() {
                if plan_paths.is_empty() {
                    HealthCheck {
                        name: "state_health".to_string(),
                        status: "pass".to_string(),
                        message: "state.db healthy (no plans initialized)".to_string(),
                        details: None,
                    }
                } else {
                    HealthCheck {
                        name: "state_health".to_string(),
                        status: "pass".to_string(),
                        message: format!("state.db healthy ({} plan(s) tracked)", plan_paths.len()),
                        details: None,
                    }
                }
            } else {
                let details = serde_json::json!({
                    "orphaned_plans": orphaned,
                    "recommendation": "These plans are tracked in state.db but their files no longer exist. Consider re-initializing state or cleaning up."
                });
                HealthCheck {
                    name: "state_health".to_string(),
                    status: "warn".to_string(),
                    message: format!(
                        "{} orphaned plan(s) in state.db (file not found on disk)",
                        orphaned.len()
                    ),
                    details: Some(details),
                }
            }
        }
        Err(e) => HealthCheck {
            name: "state_health".to_string(),
            status: "fail".to_string(),
            message: format!("Failed to query plans from state.db: {}", e),
            details: None,
        },
    }
}

/// Check state.db health
fn check_state_health() -> HealthCheck {
    check_state_health_at(Path::new(".tugtool/state.db"), Path::new("."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_state_health_absent_is_pass() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");
        let result = check_state_health_at(&db_path, temp.path());
        assert_eq!(result.status, "pass");
        assert!(result.message.contains("No state.db"));
    }

    #[test]
    fn test_state_health_healthy_db_is_pass() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");

        // Create a state.db with a plan whose file exists
        let plan_dir = temp.path().join(".tugtool");
        std::fs::create_dir_all(&plan_dir).unwrap();
        let plan_path = plan_dir.join("tugplan-test.md");
        std::fs::write(&plan_path, "## Phase 1.0: Test {#phase-1}\n\n---\n\n### Plan Metadata {#plan-metadata}\n\n| Field | Value |\n|------|-------|\n| Owner | test |\n| Status | active |\n| Last updated | 2026-02-23 |\n\n---\n\n### 1.0.0 Execution Steps {#execution-steps}\n\n#### Step 0: Test Step {#step-0}\n\n**Tasks:**\n- [ ] Test task\n").unwrap();

        let mut db = tugtool_core::StateDb::open(&db_path).unwrap();
        let plan_content = std::fs::read_to_string(&plan_path).unwrap();
        let parsed = tugtool_core::parse_tugplan(&plan_content).unwrap();
        let hash = tugtool_core::compute_plan_hash(&plan_path).unwrap();
        db.init_plan(".tugtool/tugplan-test.md", &parsed, &hash)
            .unwrap();

        let result = check_state_health_at(&db_path, temp.path());
        assert_eq!(result.status, "pass");
        assert!(result.message.contains("healthy"));
    }

    #[test]
    fn test_state_health_orphaned_plan_is_warn() {
        let temp = TempDir::new().unwrap();
        let db_path = temp.path().join("state.db");

        // Create a state.db, init a plan, then delete the plan file
        let plan_dir = temp.path().join(".tugtool");
        std::fs::create_dir_all(&plan_dir).unwrap();
        let plan_path = plan_dir.join("tugplan-test.md");
        std::fs::write(&plan_path, "## Phase 1.0: Test {#phase-1}\n\n---\n\n### Plan Metadata {#plan-metadata}\n\n| Field | Value |\n|------|-------|\n| Owner | test |\n| Status | active |\n| Last updated | 2026-02-23 |\n\n---\n\n### 1.0.0 Execution Steps {#execution-steps}\n\n#### Step 0: Test Step {#step-0}\n\n**Tasks:**\n- [ ] Test task\n").unwrap();

        let mut db = tugtool_core::StateDb::open(&db_path).unwrap();
        let plan_content = std::fs::read_to_string(&plan_path).unwrap();
        let parsed = tugtool_core::parse_tugplan(&plan_content).unwrap();
        let hash = tugtool_core::compute_plan_hash(&plan_path).unwrap();
        db.init_plan(".tugtool/tugplan-test.md", &parsed, &hash)
            .unwrap();

        // Delete the plan file to create orphan
        std::fs::remove_file(&plan_path).unwrap();

        let result = check_state_health_at(&db_path, temp.path());
        assert_eq!(result.status, "warn");
        assert!(result.message.contains("orphaned"));
    }
}
