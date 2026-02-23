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
