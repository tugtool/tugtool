//! State management CLI commands

use clap::Subcommand;

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
        #[arg(long, value_name = "ORDINAL:STATUS")]
        task: Option<String>,
        /// Update a specific test (1-indexed ordinal)
        #[arg(long, value_name = "ORDINAL:STATUS")]
        test: Option<String>,
        /// Update a specific checkpoint (1-indexed ordinal)
        #[arg(long, value_name = "ORDINAL:STATUS")]
        checkpoint: Option<String>,
        /// Update all tasks
        #[arg(long, value_name = "STATUS")]
        all_tasks: Option<String>,
        /// Update all tests
        #[arg(long, value_name = "STATUS")]
        all_tests: Option<String>,
        /// Update all checkpoints
        #[arg(long, value_name = "STATUS")]
        all_checkpoints: Option<String>,
        /// Update all checklist items
        #[arg(long, value_name = "STATUS")]
        all: Option<String>,
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
        .claim_step(&plan_rel_str, &worktree, lease_duration, &plan_hash)
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

    // 3. Parse update arguments into ChecklistUpdate variants
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
        updates.push(tugtool_core::ChecklistUpdate::Individual {
            kind: "task".to_string(),
            ordinal,
            status: parts[1].to_string(),
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
        updates.push(tugtool_core::ChecklistUpdate::Individual {
            kind: "test".to_string(),
            ordinal,
            status: parts[1].to_string(),
        });
    }

    if let Some(c) = checkpoint {
        let parts: Vec<&str> = c.split(':').collect();
        if parts.len() != 2 {
            return Err("Invalid checkpoint format. Use --checkpoint ORDINAL:STATUS".to_string());
        }
        let ordinal: i32 = parts[0]
            .parse::<i32>()
            .map_err(|_| "Invalid checkpoint ordinal")?
            - 1; // Convert 1-indexed to 0-indexed
        updates.push(tugtool_core::ChecklistUpdate::Individual {
            kind: "checkpoint".to_string(),
            ordinal,
            status: parts[1].to_string(),
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
        return Err("No updates specified. Use --task, --test, --checkpoint, --all-tasks, --all-tests, --all-checkpoints, or --all".to_string());
    }

    // 4. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugtool_core::StateDb::open(&db_path).map_err(|e| e.to_string())?;

    // 5. Update checklist
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    let result = db
        .update_checklist(&plan_rel_str, &step, &worktree, &updates)
        .map_err(|e| e.to_string())?;

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

pub fn run_state_complete(
    plan: String,
    step: String,
    worktree: String,
    force: bool,
    reason: Option<String>,
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

    // 4. Complete step
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
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
