//! State management CLI commands

use clap::Subcommand;
use serde::Deserialize;

/// Batch update entry for stdin JSON input
#[derive(Debug, Deserialize)]
struct BatchUpdateEntry {
    kind: String,
    ordinal: usize,
    status: String,
    reason: Option<String>,
}

impl tugtool_core::BatchEntry for BatchUpdateEntry {
    fn kind(&self) -> &str {
        &self.kind
    }

    fn ordinal(&self) -> usize {
        self.ordinal
    }

    fn status(&self) -> &str {
        &self.status
    }

    fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

/// Drift information for plan hash comparison
struct DriftInfo {
    stored_hash: String,
    current_hash: String,
}

/// Check if plan file has drifted from stored hash
fn check_plan_drift(
    repo_root: &std::path::Path,
    plan_rel: &std::path::Path,
    db: &tugtool_core::StateDb,
    plan_path_str: &str,
) -> Result<Option<DriftInfo>, String> {
    // Get stored plan state to retrieve hash
    let plan_state = db.show_plan(plan_path_str).map_err(|e| e.to_string())?;
    let stored_hash = plan_state.plan_hash;

    // Compute current hash
    let plan_abs = repo_root.join(plan_rel);
    let current_hash = tugtool_core::compute_plan_hash(&plan_abs).map_err(|e| e.to_string())?;

    if stored_hash != current_hash {
        Ok(Some(DriftInfo {
            stored_hash,
            current_hash,
        }))
    } else {
        Ok(None)
    }
}

/// Format drift warning message with truncated hashes
fn format_drift_message(drift: &DriftInfo) -> String {
    let stored_short = &drift.stored_hash[..8];
    let current_short = &drift.current_hash[..8];
    format!(
        "Plan file has been modified since state was initialized (stored: {}..., current: {}...)",
        stored_short, current_short
    )
}

/// State subcommands
#[derive(Subcommand, Debug)]
pub enum StateCommands {
    /// Initialize state database from a plan
    Init {
        /// Plan file path
        plan: String,
    },
    /// Claim the next available step for execution
    Claim {
        /// Plan file path
        plan: String,
        /// Worktree path (identifies the claimer)
        #[arg(long, value_name = "PATH")]
        worktree: String,
        /// Lease duration in seconds
        #[arg(long, default_value = "7200")]
        lease_duration: u64,
        /// Force claim, bypassing lease expiry checks (still respects dependencies)
        #[arg(long)]
        force: bool,
    },
    /// Start a claimed step
    Start {
        /// Plan file path
        plan: String,
        /// Step anchor to start
        step: String,
        /// Worktree path (must match claimer)
        #[arg(long, value_name = "PATH")]
        worktree: String,
    },
    /// Renew lease on a step
    Heartbeat {
        /// Plan file path
        plan: String,
        /// Step anchor
        step: String,
        /// Worktree path (must match claimer)
        #[arg(long, value_name = "PATH")]
        worktree: String,
        /// Lease duration in seconds
        #[arg(long, default_value = "7200")]
        lease_duration: u64,
    },
    /// Update checklist item(s) for a step
    Update {
        /// Plan file path
        plan: String,
        /// Step anchor
        step: String,
        /// Worktree path (must match claimer)
        #[arg(long, value_name = "PATH")]
        worktree: String,
        /// Update a specific task (1-indexed ordinal)
        #[arg(long, value_name = "ORDINAL:STATUS", conflicts_with = "batch")]
        task: Option<String>,
        /// Update a specific test (1-indexed ordinal)
        #[arg(long, value_name = "ORDINAL:STATUS", conflicts_with = "batch")]
        test: Option<String>,
        /// Update a specific checkpoint (1-indexed ordinal)
        #[arg(long, value_name = "ORDINAL:STATUS", conflicts_with = "batch")]
        checkpoint: Option<String>,
        /// Update all tasks
        #[arg(long, value_name = "STATUS", conflicts_with = "batch")]
        all_tasks: Option<String>,
        /// Update all tests
        #[arg(long, value_name = "STATUS", conflicts_with = "batch")]
        all_tests: Option<String>,
        /// Update all checkpoints
        #[arg(long, value_name = "STATUS", conflicts_with = "batch")]
        all_checkpoints: Option<String>,
        /// Update all checklist items
        #[arg(long, value_name = "STATUS", conflicts_with = "batch")]
        all: Option<String>,
        /// Read batch update JSON from stdin. Mutually exclusive with individual item flags.
        #[arg(long, conflicts_with_all = ["task", "test", "checkpoint", "all_tasks", "all_tests", "all_checkpoints", "all"])]
        batch: bool,
        /// Mark all non-specified open items as completed (use with --batch)
        #[arg(long, requires = "batch")]
        complete_remaining: bool,
        /// Allow setting item status back to open (manual recovery only)
        #[arg(long)]
        allow_reopen: bool,
        /// Allow operation even if plan file has been modified since state was initialized
        #[arg(long)]
        allow_drift: bool,
    },
    /// Record an artifact breadcrumb for a step
    Artifact {
        /// Plan file path
        plan: String,
        /// Step anchor
        step: String,
        /// Worktree path (must match claimer)
        #[arg(long, value_name = "PATH")]
        worktree: String,
        /// Artifact kind (architect_strategy, reviewer_verdict, auditor_summary)
        #[arg(long)]
        kind: String,
        /// Summary text (truncated to 500 chars)
        #[arg(long)]
        summary: String,
    },
    /// Complete a step
    Complete {
        /// Plan file path
        plan: String,
        /// Step anchor
        step: String,
        /// Worktree path (must match claimer)
        #[arg(long, value_name = "PATH")]
        worktree: String,
        /// Force completion despite incomplete items/substeps
        #[arg(long)]
        force: bool,
        /// Reason for forcing completion
        #[arg(long, value_name = "TEXT")]
        reason: Option<String>,
        /// Allow operation even if plan file has been modified since state was initialized
        #[arg(long)]
        allow_drift: bool,
    },
    /// Show plan progress and status
    Show {
        /// Plan file path (optional - shows all plans if not specified)
        plan: Option<String>,
        /// Show aggregate counts per step (default)
        #[arg(long, conflicts_with = "checklist")]
        summary: bool,
        /// Show every checklist item with its status
        #[arg(long, conflicts_with = "summary")]
        checklist: bool,
    },
    /// List ready steps for claiming
    Ready {
        /// Plan file path
        plan: String,
    },
    /// Reset a step to pending status
    Reset {
        /// Plan file path
        plan: String,
        /// Step anchor to reset
        step: String,
    },
    /// Release a step's claim, returning it to pending status
    Release {
        /// Plan file path
        plan: String,
        /// Step anchor to release
        step: String,
        /// Worktree path for ownership check (mutually exclusive with --force)
        #[arg(long, value_name = "PATH", conflicts_with = "force")]
        worktree: Option<String>,
        /// Skip ownership check (mutually exclusive with --worktree)
        #[arg(long, conflicts_with = "worktree")]
        force: bool,
    },
    /// Reconcile state from git commit trailers
    Reconcile {
        /// Plan file path
        plan: String,
        /// Force overwrite of existing commit hashes
        #[arg(long)]
        force: bool,
    },
}

pub fn run_state_init(plan: String, json: bool, quiet: bool) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (plan_abs, plan_rel) = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Parse the plan
    let plan_content =
        std::fs::read_to_string(&plan_abs).map_err(|e| format!("Failed to read plan: {}", e))?;
    let parsed = tugtool_core::parse_tugplan(&plan_content)
        .map_err(|e| format!("Failed to parse plan: {}", e))?;

    // 4. Compute plan hash
    let plan_hash = tugtool_core::compute_plan_hash(&plan_abs).map_err(|e| e.to_string())?;

    // 5. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 6. Init plan
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    let result = db
        .init_plan(&plan_rel_str, &parsed, &plan_hash)
        .map_err(|e| e.to_string())?;

    // 7. Output
    if json {
        use crate::output::{JsonResponse, StateInitData};
        let data = StateInitData {
            plan_path: plan_rel_str,
            plan_hash,
            already_initialized: result.already_initialized,
            step_count: result.step_count,
            substep_count: result.substep_count,
            dep_count: result.dep_count,
            checklist_count: result.checklist_count,
        };
        let response = JsonResponse::ok("state init", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        if result.already_initialized {
            println!("State already initialized for plan: {}", plan);
        } else {
            println!("Initialized state for plan: {}", plan);
            println!("  Steps: {}", result.step_count);
            println!("  Substeps: {}", result.substep_count);
            println!("  Dependencies: {}", result.dep_count);
            println!("  Checklist items: {}", result.checklist_count);
        }
    }

    Ok(0)
}

pub fn run_state_claim(
    plan: String,
    worktree: String,
    lease_duration: u64,
    force: bool,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (plan_abs, plan_rel) = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Compute plan hash
    let plan_hash = tugtool_core::compute_plan_hash(&plan_abs).map_err(|e| e.to_string())?;

    // 4. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 5. Claim step
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    let result = db
        .claim_step(&plan_rel_str, &worktree, lease_duration, &plan_hash, force)
        .map_err(|e| e.to_string())?;

    // 6. Output
    if json {
        use crate::output::{JsonResponse, StateClaimData};
        use tugtool_core::ClaimResult;

        let data = match result {
            ClaimResult::Claimed {
                anchor,
                title,
                index,
                remaining_ready,
                total_remaining,
                lease_expires,
                reclaimed,
            } => StateClaimData {
                plan_path: plan_rel_str,
                claimed: true,
                anchor: Some(anchor),
                title: Some(title),
                step_index: Some(index),
                lease_expires: Some(lease_expires),
                reclaimed,
                remaining_ready,
                total_remaining,
                all_completed: false,
            },
            ClaimResult::NoReadySteps {
                all_completed,
                blocked,
            } => StateClaimData {
                plan_path: plan_rel_str,
                claimed: false,
                anchor: None,
                title: None,
                step_index: None,
                lease_expires: None,
                reclaimed: false,
                remaining_ready: 0,
                total_remaining: blocked,
                all_completed,
            },
            ClaimResult::AllCompleted => StateClaimData {
                plan_path: plan_rel_str,
                claimed: false,
                anchor: None,
                title: None,
                step_index: None,
                lease_expires: None,
                reclaimed: false,
                remaining_ready: 0,
                total_remaining: 0,
                all_completed: true,
            },
        };

        let response = JsonResponse::ok("state claim", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        use tugtool_core::ClaimResult;

        match result {
            ClaimResult::Claimed {
                anchor,
                title,
                index,
                remaining_ready,
                total_remaining,
                lease_expires,
                reclaimed,
            } => {
                if reclaimed {
                    println!("Reclaimed step {} (index {}): {}", anchor, index, title);
                } else {
                    println!("Claimed step {} (index {}): {}", anchor, index, title);
                }
                println!("  Lease expires: {}", lease_expires);
                println!("  Remaining ready: {}", remaining_ready);
                println!("  Total remaining: {}", total_remaining);
            }
            ClaimResult::NoReadySteps {
                all_completed,
                blocked,
            } => {
                if all_completed {
                    println!("All steps completed!");
                } else {
                    println!("No steps ready for claiming ({} blocked)", blocked);
                }
            }
            ClaimResult::AllCompleted => {
                println!("All steps completed!");
            }
        }
    }

    Ok(0)
}

pub fn run_state_start(
    plan: String,
    step: String,
    worktree: String,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (_plan_abs, plan_rel) = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 4. Start step
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    db.start_step(&plan_rel_str, &step, &worktree)
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateStartData};
        let data = StateStartData {
            plan_path: plan_rel_str,
            anchor: step.clone(),
            started: true,
        };
        let response = JsonResponse::ok("state start", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Started step: {}", step);
    }

    Ok(0)
}

pub fn run_state_heartbeat(
    plan: String,
    step: String,
    worktree: String,
    lease_duration: u64,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (_plan_abs, plan_rel) = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 4. Heartbeat
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    let lease_expires = db
        .heartbeat_step(&plan_rel_str, &step, &worktree, lease_duration)
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateHeartbeatData};
        let data = StateHeartbeatData {
            plan_path: plan_rel_str,
            anchor: step.clone(),
            lease_expires: lease_expires.clone(),
        };
        let response = JsonResponse::ok("state heartbeat", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Heartbeat sent for step: {}", step);
        println!("  Lease expires: {}", lease_expires);
    }

    Ok(0)
}

#[allow(clippy::too_many_arguments)]
pub fn run_state_update(
    plan: String,
    step: String,
    worktree: String,
    task: Option<String>,
    test: Option<String>,
    checkpoint: Option<String>,
    all_tasks: Option<String>,
    all_tests: Option<String>,
    all_checkpoints: Option<String>,
    all: Option<String>,
    batch: bool,
    complete_remaining: bool,
    allow_reopen: bool,
    allow_drift: bool,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (_plan_abs, plan_rel) = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    let plan_rel_str = plan_rel.to_string_lossy().to_string();

    // 4. Check for plan drift
    if let Some(drift) = check_plan_drift(&repo_root, &plan_rel, &db, &plan_rel_str)? {
        if !allow_drift {
            return Err(format!(
                "{}. Use --allow-drift to proceed.",
                format_drift_message(&drift)
            ));
        }
    }

    // 5. Handle batch mode or individual updates
    let result = if batch {
        // Read batch JSON from stdin
        let stdin = std::io::stdin();
        let entries: Vec<BatchUpdateEntry> =
            serde_json::from_reader(stdin).map_err(|e| format!("Invalid JSON: {}", e))?;

        // Empty-array guard: only error when complete_remaining is false
        if !complete_remaining && entries.is_empty() {
            return Err("Batch update array must contain at least one entry".to_string());
        }

        // Call batch_update_checklist with complete_remaining flag
        db.batch_update_checklist(
            &plan_rel_str,
            &step,
            &worktree,
            &entries,
            complete_remaining,
        )
        .map_err(|e| e.to_string())?
    } else {
        // 3a. Parse update arguments into ChecklistUpdate variants
        let mut updates = Vec::new();

        // Parse individual updates (format: "1:completed")
        if let Some(t) = task {
            let parts: Vec<&str> = t.split(':').collect();
            if parts.len() != 2 {
                return Err("Invalid task format. Use --task ORDINAL:STATUS".to_string());
            }
            let ordinal: i32 = parts[0]
                .parse::<i32>()
                .map_err(|_| "Invalid task ordinal")?
                - 1; // Convert 1-indexed to 0-indexed
            let status = parts[1].to_string();

            // Validate status for per-item updates
            if status == "deferred" {
                return Err(
                    "Per-item deferred status requires --batch mode with reason field".to_string(),
                );
            }
            if status == "open" && !allow_reopen {
                return Err("Setting status to 'open' requires --allow-reopen flag".to_string());
            }

            updates.push(tugtool_core::ChecklistUpdate::Individual {
                kind: "task".to_string(),
                ordinal,
                status,
            });
        }

        if let Some(t) = test {
            let parts: Vec<&str> = t.split(':').collect();
            if parts.len() != 2 {
                return Err("Invalid test format. Use --test ORDINAL:STATUS".to_string());
            }
            let ordinal: i32 = parts[0]
                .parse::<i32>()
                .map_err(|_| "Invalid test ordinal")?
                - 1; // Convert 1-indexed to 0-indexed
            let status = parts[1].to_string();

            // Validate status for per-item updates
            if status == "deferred" {
                return Err(
                    "Per-item deferred status requires --batch mode with reason field".to_string(),
                );
            }
            if status == "open" && !allow_reopen {
                return Err("Setting status to 'open' requires --allow-reopen flag".to_string());
            }

            updates.push(tugtool_core::ChecklistUpdate::Individual {
                kind: "test".to_string(),
                ordinal,
                status,
            });
        }

        if let Some(c) = checkpoint {
            let parts: Vec<&str> = c.split(':').collect();
            if parts.len() != 2 {
                return Err(
                    "Invalid checkpoint format. Use --checkpoint ORDINAL:STATUS".to_string()
                );
            }
            let ordinal: i32 = parts[0]
                .parse::<i32>()
                .map_err(|_| "Invalid checkpoint ordinal")?
                - 1; // Convert 1-indexed to 0-indexed
            let status = parts[1].to_string();

            // Validate status for per-item updates
            if status == "deferred" {
                return Err(
                    "Per-item deferred status requires --batch mode with reason field".to_string(),
                );
            }
            if status == "open" && !allow_reopen {
                return Err("Setting status to 'open' requires --allow-reopen flag".to_string());
            }

            updates.push(tugtool_core::ChecklistUpdate::Individual {
                kind: "checkpoint".to_string(),
                ordinal,
                status,
            });
        }

        // Parse bulk updates
        if let Some(status) = all_tasks {
            updates.push(tugtool_core::ChecklistUpdate::BulkByKind {
                kind: "task".to_string(),
                status,
            });
        }

        if let Some(status) = all_tests {
            updates.push(tugtool_core::ChecklistUpdate::BulkByKind {
                kind: "test".to_string(),
                status,
            });
        }

        if let Some(status) = all_checkpoints {
            updates.push(tugtool_core::ChecklistUpdate::BulkByKind {
                kind: "checkpoint".to_string(),
                status,
            });
        }

        if let Some(status) = all {
            updates.push(tugtool_core::ChecklistUpdate::AllItems { status });
        }

        if updates.is_empty() {
            return Err("No updates specified. Use --task, --test, --checkpoint, --all-tasks, --all-tests, --all-checkpoints, --all, or --batch".to_string());
        }

        // 5. Update checklist using old API
        db.update_checklist(&plan_rel_str, &step, &worktree, &updates)
            .map_err(|e| e.to_string())?
    };

    // 6. Output
    if json {
        use crate::output::{JsonResponse, StateUpdateData};
        let data = StateUpdateData {
            plan_path: plan_rel_str,
            anchor: step.clone(),
            items_updated: result.items_updated,
        };
        let response = JsonResponse::ok("state update", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!(
            "Updated {} checklist item(s) for step: {}",
            result.items_updated, step
        );
    }

    Ok(0)
}

pub fn run_state_artifact(
    plan: String,
    step: String,
    worktree: String,
    kind: String,
    summary: String,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (_plan_abs, plan_rel) = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 4. Record artifact
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    let artifact_id = db
        .record_artifact(&plan_rel_str, &step, &worktree, &kind, &summary)
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateArtifactData};
        let data = StateArtifactData {
            plan_path: plan_rel_str,
            anchor: step.clone(),
            artifact_id,
            kind: kind.clone(),
        };
        let response = JsonResponse::ok("state artifact", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Recorded {} artifact for step: {}", kind, step);
        println!("  Artifact ID: {}", artifact_id);
    }

    Ok(0)
}

#[allow(clippy::too_many_arguments)]
pub fn run_state_complete(
    plan: String,
    step: String,
    worktree: String,
    force: bool,
    reason: Option<String>,
    allow_drift: bool,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (_plan_abs, plan_rel) = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    let plan_rel_str = plan_rel.to_string_lossy().to_string();

    // 4. Check for plan drift
    if let Some(drift) = check_plan_drift(&repo_root, &plan_rel, &db, &plan_rel_str)? {
        if !allow_drift {
            return Err(format!(
                "{}. Use --allow-drift to proceed.",
                format_drift_message(&drift)
            ));
        }
    }

    // 5. Complete step
    let result = db
        .complete_step(&plan_rel_str, &step, &worktree, force, reason.as_deref())
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateCompleteData};
        let data = StateCompleteData {
            plan_path: plan_rel_str,
            anchor: step.clone(),
            completed: result.completed,
            forced: result.forced,
            all_steps_completed: result.all_steps_completed,
        };
        let response = JsonResponse::ok("state complete", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        if result.forced {
            println!("Force-completed step: {}", step);
        } else {
            println!("Completed step: {}", step);
        }
        if result.all_steps_completed {
            println!("All steps completed!");
        }
    }

    Ok(0)
}

pub fn run_state_show(
    plan: Option<String>,
    _summary: bool,
    checklist: bool,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    if let Some(plan) = plan {
        // Show specific plan
        let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

        let plan_rel = match resolved {
            tugtool_core::ResolveResult::Found { path, .. } => {
                path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf()
            }
            tugtool_core::ResolveResult::NotFound => {
                return Err(format!("Plan not found: {}", plan));
            }
            tugtool_core::ResolveResult::Ambiguous(candidates) => {
                let candidate_strs: Vec<String> =
                    candidates.iter().map(|p| p.display().to_string()).collect();
                return Err(format!(
                    "Ambiguous plan reference '{}'. Matches: {}",
                    plan,
                    candidate_strs.join(", ")
                ));
            }
        };

        let plan_rel_str = plan_rel.to_string_lossy().to_string();
        let plan_state = db.show_plan(&plan_rel_str).map_err(|e| e.to_string())?;

        // Check for plan drift and warn (non-blocking)
        if let Some(drift) = check_plan_drift(&repo_root, &plan_rel, &db, &plan_rel_str)? {
            eprintln!("Warning: {}", format_drift_message(&drift));
        }

        if json {
            use crate::output::{JsonResponse, StateShowData};
            let data = StateShowData { plan: plan_state };
            let response = JsonResponse::ok("state show", data);
            println!(
                "{}",
                serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
            );
        } else if !quiet {
            // Dispatch based on display mode
            if checklist {
                // Checklist mode: show all items with status markers
                let items = db
                    .get_checklist_items(&plan_rel_str)
                    .map_err(|e| e.to_string())?;
                print_checklist_view(&plan_state, &items);
            } else {
                // Summary mode (default)
                print_plan_state(&plan_state);
            }
        }
    } else {
        // Show all plans
        let plan_paths = db.list_plan_paths().map_err(|e| e.to_string())?;

        if plan_paths.is_empty() {
            if !quiet && !json {
                println!("No plans initialized in state database.");
            }
            return Ok(0);
        }

        // Collect plan states
        let mut plan_states = Vec::new();
        for plan_path in &plan_paths {
            let plan_state = db.show_plan(plan_path).map_err(|e| e.to_string())?;
            plan_states.push(plan_state);
        }

        if json {
            use crate::output::JsonResponse;
            #[derive(serde::Serialize)]
            struct StateShowAllData {
                plans: Vec<tugtool_core::PlanState>,
            }
            let data = StateShowAllData { plans: plan_states };
            let response = JsonResponse::ok("state show", data);
            println!(
                "{}",
                serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
            );
        } else if !quiet {
            // Display each plan based on mode
            for (idx, plan_state) in plan_states.iter().enumerate() {
                if idx > 0 {
                    println!("\n{}", "=".repeat(80));
                    println!();
                }

                if checklist {
                    // Checklist mode: show all items with status markers
                    let items = db
                        .get_checklist_items(&plan_state.plan_path)
                        .map_err(|e| e.to_string())?;
                    print_checklist_view(plan_state, &items);
                } else {
                    // Summary mode (default)
                    print_plan_state(plan_state);
                }
            }
        }
    }

    Ok(0)
}

/// Helper function to print plan state in text format
fn print_plan_state(plan: &tugtool_core::PlanState) {
    println!("Plan: {}", plan.plan_path);
    if let Some(title) = &plan.phase_title {
        println!("Title: {}", title);
    }
    println!("Status: {}", plan.status);
    println!();

    for step in &plan.steps {
        print_step_state(step, 0);
    }
}

/// Helper function to print step state with indentation
fn print_step_state(step: &tugtool_core::StepState, indent: usize) {
    let prefix = "  ".repeat(indent);

    // Status indicator
    let status_icon = match step.status.as_str() {
        "completed" => "✓",
        "in_progress" => "→",
        "claimed" => "◆",
        _ => "○",
    };

    println!("{}{} {} - {}", prefix, status_icon, step.anchor, step.title);

    // Show human-readable status label
    let status_label = match step.status.as_str() {
        "completed" => "Done",
        "in_progress" => "In progress",
        "claimed" => "Claimed",
        _ => "Pending",
    };
    println!("{}  Status: {}", prefix, status_label);

    // Show checklist progress
    let cl = &step.checklist;
    if cl.tasks_total > 0 {
        print_progress_bar(
            &format!("{}  Tasks", prefix),
            cl.tasks_completed,
            cl.tasks_total,
        );
    }
    if cl.tests_total > 0 {
        print_progress_bar(
            &format!("{}  Tests", prefix),
            cl.tests_completed,
            cl.tests_total,
        );
    }
    if cl.checkpoints_total > 0 {
        print_progress_bar(
            &format!("{}  Checkpoints", prefix),
            cl.checkpoints_completed,
            cl.checkpoints_total,
        );
    }

    // Show claim/lease info (only for non-completed steps)
    if step.status != "completed" {
        if let Some(claimed_by) = &step.claimed_by {
            println!("{}  Claimed by: {}", prefix, claimed_by);
            if let Some(expires) = &step.lease_expires_at {
                println!("{}  Lease expires: {}", prefix, expires);
            }
        }
    }

    // Show force-completion reason (only when non-empty)
    if let Some(reason) = &step.complete_reason {
        if !reason.is_empty() {
            println!("{}  Force-completed: {}", prefix, reason);
        }
    }

    // Show substeps
    for substep in &step.substeps {
        print_step_state(substep, indent + 1);
    }

    println!();
}

/// Helper function to print ASCII progress bar
fn print_progress_bar(label: &str, completed: usize, total: usize) {
    let percent = if total > 0 {
        (completed as f64 / total as f64 * 100.0) as usize
    } else {
        0
    };

    let bar_width = 12;
    let filled = (completed as f64 / total as f64 * bar_width as f64) as usize;
    let empty = bar_width - filled;

    let bar = format!("{}{}", "█".repeat(filled), "░".repeat(empty));

    println!("{}: {}/{}  {}  {}%", label, completed, total, bar, percent);
}

/// Print checklist view with per-item status markers
fn print_checklist_view(
    plan_state: &tugtool_core::PlanState,
    items: &[tugtool_core::ChecklistItemDetail],
) {
    println!("Plan: {}", plan_state.plan_path);
    if let Some(title) = &plan_state.phase_title {
        println!("Title: {}", title);
    }
    println!("Status: {}", plan_state.status);
    println!();

    // Group items by step_anchor
    let mut items_by_step: std::collections::HashMap<
        String,
        Vec<&tugtool_core::ChecklistItemDetail>,
    > = std::collections::HashMap::new();
    for item in items {
        items_by_step
            .entry(item.step_anchor.clone())
            .or_default()
            .push(item);
    }

    // Iterate through steps in order
    for step in &plan_state.steps {
        print_step_checklist(step, &items_by_step, 0);
    }
}

/// Print checklist items for a step
fn print_step_checklist(
    step: &tugtool_core::StepState,
    items_by_step: &std::collections::HashMap<String, Vec<&tugtool_core::ChecklistItemDetail>>,
    indent: usize,
) {
    let prefix = "  ".repeat(indent);

    // Status indicator
    let status_icon = match step.status.as_str() {
        "completed" => "✓",
        "in_progress" => "→",
        "claimed" => "◆",
        _ => "○",
    };

    println!("{}{} {} - {}", prefix, status_icon, step.anchor, step.title);

    // Print checklist items for this step
    if let Some(step_items) = items_by_step.get(&step.anchor) {
        // Group by kind
        let mut tasks: Vec<_> = step_items.iter().filter(|i| i.kind == "task").collect();
        let mut tests: Vec<_> = step_items.iter().filter(|i| i.kind == "test").collect();
        let mut checkpoints: Vec<_> = step_items
            .iter()
            .filter(|i| i.kind == "checkpoint")
            .collect();

        // Sort by ordinal
        tasks.sort_by_key(|i| i.ordinal);
        tests.sort_by_key(|i| i.ordinal);
        checkpoints.sort_by_key(|i| i.ordinal);

        if !tasks.is_empty() {
            println!("{}  Tasks:", prefix);
            for item in tasks {
                print_checklist_item(item, indent + 1);
            }
        }

        if !tests.is_empty() {
            println!("{}  Tests:", prefix);
            for item in tests {
                print_checklist_item(item, indent + 1);
            }
        }

        if !checkpoints.is_empty() {
            println!("{}  Checkpoints:", prefix);
            for item in checkpoints {
                print_checklist_item(item, indent + 1);
            }
        }
    }

    // Show substeps
    for substep in &step.substeps {
        print_step_checklist(substep, items_by_step, indent + 1);
    }

    println!();
}

/// Print a single checklist item with status marker
fn print_checklist_item(item: &tugtool_core::ChecklistItemDetail, indent: usize) {
    let prefix = "  ".repeat(indent);
    let marker = match item.status.as_str() {
        "completed" => "[x]",
        "deferred" => "[~]",
        _ => "[ ]",
    };

    if item.status == "deferred" {
        if let Some(reason) = &item.reason {
            println!("{}{} {}  (deferred: {})", prefix, marker, item.text, reason);
        } else {
            println!("{}{} {}", prefix, marker, item.text);
        }
    } else {
        println!("{}{} {}", prefix, marker, item.text);
    }
}

pub fn run_state_ready(plan: String, json: bool, quiet: bool) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let plan_rel = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf()
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 4. Query ready steps
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    let result = db.ready_steps(&plan_rel_str).map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateReadyData};
        let data = StateReadyData {
            plan_path: plan_rel_str,
            ready: result.ready,
            blocked: result.blocked,
            completed: result.completed,
            expired_claim: result.expired_claim,
        };
        let response = JsonResponse::ok("state ready", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Ready steps ({}):", result.ready.len());
        for step in &result.ready {
            println!("  {} - {}", step.anchor, step.title);
        }

        if !result.expired_claim.is_empty() {
            println!("\nExpired claims ({}):", result.expired_claim.len());
            for step in &result.expired_claim {
                println!("  {} - {}", step.anchor, step.title);
            }
        }

        if !result.blocked.is_empty() {
            println!("\nBlocked steps ({}):", result.blocked.len());
            for step in &result.blocked {
                println!("  {} - {}", step.anchor, step.title);
            }
        }

        println!("\nCompleted steps: {}", result.completed.len());
    }

    Ok(0)
}

pub fn run_state_reset(plan: String, step: String, json: bool, quiet: bool) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let plan_rel = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf()
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 4. Reset step
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    db.reset_step(&plan_rel_str, &step)
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateResetData};
        let data = StateResetData {
            plan_path: plan_rel_str,
            anchor: step.clone(),
            reset: true,
        };
        let response = JsonResponse::ok("state reset", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Reset step to pending: {}", step);
    }

    Ok(0)
}

pub fn run_state_release(
    plan: String,
    step: String,
    worktree: Option<String>,
    force: bool,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let plan_rel = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf()
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    // 3. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 4. Release step
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    let result = db
        .release_step(&plan_rel_str, &step, worktree.as_deref(), force)
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateReleaseData};
        let data = StateReleaseData {
            plan_path: plan_rel_str,
            anchor: step.clone(),
            released: result.released,
            was_claimed_by: result.was_claimed_by,
        };
        let response = JsonResponse::ok("state release", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Released step to pending: {}", step);
        if let Some(previous_owner) = result.was_claimed_by {
            println!("  Previously claimed by: {}", previous_owner);
        }
    }

    Ok(0)
}

pub fn run_state_reconcile(
    plan: String,
    force: bool,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugtool_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugtool_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let plan_rel = match resolved {
        tugtool_core::ResolveResult::Found { path, .. } => {
            path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf()
        }
        tugtool_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugtool_core::ResolveResult::Ambiguous(candidates) => {
            let candidate_strs: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            return Err(format!(
                "Ambiguous plan reference '{}'. Matches: {}",
                plan,
                candidate_strs.join(", ")
            ));
        }
    };

    let plan_rel_str = plan_rel.to_string_lossy().to_string();

    // 3. Scan git log for trailers
    let entries = scan_git_trailers(&repo_root, &plan_rel_str)?;

    // 4. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 5. Reconcile
    let result = db
        .reconcile(&plan_rel_str, &entries, force)
        .map_err(|e| e.to_string())?;

    // 6. Output warnings for mismatches
    if !result.skipped_mismatches.is_empty() && !quiet {
        eprintln!(
            "Warning: {} step(s) skipped due to commit hash mismatch:",
            result.skipped_mismatches.len()
        );
        for mismatch in &result.skipped_mismatches {
            eprintln!(
                "  {} (DB: {}, Git: {})",
                mismatch.step_anchor, mismatch.db_hash, mismatch.git_hash
            );
        }
        eprintln!("Use --force to overwrite DB hashes with git trailer hashes.");
    }

    // 7. Output
    if json {
        use crate::output::{JsonResponse, StateReconcileData};
        let data = StateReconcileData {
            plan_path: plan_rel_str,
            reconciled_count: result.reconciled_count,
            skipped_count: result.skipped_count,
            skipped_mismatches: result.skipped_mismatches,
        };
        let response = JsonResponse::ok("state reconcile", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!(
            "Reconciled {} step(s) from git trailers",
            result.reconciled_count
        );
        if result.skipped_count > 0 {
            println!(
                "Skipped {} step(s) with hash mismatches",
                result.skipped_count
            );
        }
    }

    Ok(0)
}

/// Scan git log for Tug-Step and Tug-Plan trailers
fn scan_git_trailers(
    repo_root: &std::path::Path,
    plan_path: &str,
) -> Result<Vec<tugtool_core::ReconcileEntry>, String> {
    use std::process::Command;

    // Run: git log --all --format="%H%n%B%n---END---" to get all commits with trailers
    let output = Command::new("git")
        .args(["log", "--all", "--format=%H%n%B%n---END---"])
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("failed to run git log: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "git log failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let log_output = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();

    // Parse commits
    let mut current_hash: Option<String> = None;
    let mut current_step: Option<String> = None;
    let mut current_plan: Option<String> = None;

    for line in log_output.lines() {
        if line == "---END---" {
            // End of commit - record entry if we have both step and plan
            if let (Some(hash), Some(step), Some(plan)) = (
                current_hash.take(),
                current_step.take(),
                current_plan.take(),
            ) {
                entries.push(tugtool_core::ReconcileEntry {
                    step_anchor: step,
                    plan_path: plan,
                    commit_hash: hash,
                });
            }
            current_hash = None;
            current_step = None;
            current_plan = None;
        } else if current_hash.is_none()
            && line.len() == 40
            && line.chars().all(|c| c.is_ascii_hexdigit())
        {
            // This looks like a commit hash
            current_hash = Some(line.to_string());
        } else if let Some(stripped) = line.strip_prefix("Tug-Step: ") {
            current_step = Some(stripped.trim().to_string());
        } else if let Some(stripped) = line.strip_prefix("Tug-Plan: ") {
            current_plan = Some(stripped.trim().to_string());
        }
    }

    // Filter to only entries for the requested plan
    let filtered: Vec<_> = entries
        .into_iter()
        .filter(|e| e.plan_path == plan_path)
        .collect();

    Ok(filtered)
}
