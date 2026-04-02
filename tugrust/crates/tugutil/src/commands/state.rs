//! State management CLI commands

use clap::Subcommand;
use serde::Deserialize;

/// Resolve a plan identifier (plan_id, slug prefix, or file path) to its plan_id in the database.
///
/// Resolution order:
/// 1. Exact plan_id match
/// 2. Slug prefix match
/// 3. File path match (for backward compatibility with existing callers)
fn resolve_plan_id(db: &tugutil_core::StateDb, input: &str) -> Result<String, String> {
    if let Ok(Some(id)) = db.lookup_plan_by_id_or_slug(input) {
        return Ok(id);
    }
    // Fall back to file path lookup
    if let Ok(Some(id)) = db.lookup_plan_id_by_path(input) {
        return Ok(id);
    }
    Err(format!("Plan not found in state database: {}", input))
}

/// Batch update entry for stdin JSON input
#[derive(Debug, Deserialize)]
struct BatchUpdateEntry {
    kind: String,
    ordinal: usize,
    status: String,
    reason: Option<String>,
}

impl tugutil_core::BatchEntry for BatchUpdateEntry {
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
        /// Force completion despite incomplete items
        #[arg(long)]
        force: bool,
        /// Reason for forcing completion
        #[arg(long, value_name = "TEXT")]
        reason: Option<String>,
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
        /// Worktree path (accepted for CLI consistency, currently unused)
        #[arg(long, value_name = "PATH")]
        worktree: Option<String>,
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
    /// Mark all open checklist items for a step as completed
    CompleteChecklist {
        /// Plan file path
        plan: String,
        /// Step anchor (e.g., step-1)
        step: String,
        /// Worktree path (ownership check)
        #[arg(long, value_name = "PATH")]
        worktree: String,
    },
    /// Drop all state for a plan and reinitialize from current plan file
    Reinit {
        /// Plan file path
        plan: String,
    },
    /// Archive a plan (transition to archived status)
    Archive {
        /// Plan identifier (plan_id or slug prefix)
        plan: String,
    },
    /// List all tracked plans
    List {
        /// Include archived plans
        #[arg(long)]
        all: bool,
    },
}

pub fn run_state_init(plan: String, json: bool, quiet: bool) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugutil_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (plan_abs, plan_rel) = match resolved {
        tugutil_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugutil_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugutil_core::ResolveResult::Ambiguous(candidates) => {
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
    let parsed = tugutil_core::parse_tugplan(&plan_content)
        .map_err(|e| format!("Failed to parse plan: {}", e))?;

    // 4. Compute plan hash
    let plan_hash = tugutil_core::compute_plan_hash(&plan_abs).map_err(|e| e.to_string())?;

    // 5. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 6. Init plan
    let plan_rel_str = plan_rel.to_string_lossy().to_string();
    let result = db
        .init_plan(&plan_rel_str, &parsed, Some(&plan_hash))
        .map_err(|e| e.to_string())?;

    // 7. Output
    if json {
        use crate::output::{JsonResponse, StateInitData};
        let data = StateInitData {
            plan_id: result.plan_id.clone(),
            plan_path: Some(plan_rel_str),
            plan_hash,
            already_initialized: result.already_initialized,
            step_count: result.step_count,
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
            println!("  Dependencies: {}", result.dep_count);
            println!("  Checklist items: {}", result.checklist_count);
        }
    }

    Ok(0)
}

pub fn run_state_reinit(plan: String, json: bool, quiet: bool) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Resolve plan path
    let resolved = tugutil_core::resolve_plan(&plan, &repo_root).map_err(|e| e.to_string())?;

    let (plan_abs, plan_rel) = match resolved {
        tugutil_core::ResolveResult::Found { path, .. } => {
            let relative_path = path.strip_prefix(&repo_root).unwrap_or(&path).to_path_buf();
            (path, relative_path)
        }
        tugutil_core::ResolveResult::NotFound => {
            return Err(format!("Plan not found: {}", plan));
        }
        tugutil_core::ResolveResult::Ambiguous(candidates) => {
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
    let parsed = tugutil_core::parse_tugplan(&plan_content)
        .map_err(|e| format!("Failed to parse plan: {}", e))?;

    // 4. Compute plan hash
    let plan_hash = tugutil_core::compute_plan_hash(&plan_abs).map_err(|e| e.to_string())?;

    // 5. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 6. Reinit plan (drop all state, then re-initialize)
    let plan_rel_str = plan_rel.to_string_lossy().to_string();

    // Capture existing plan_id before reinit (it will be archived)
    let archived_plan_id = db.lookup_plan_id_by_path(&plan_rel_str).ok().flatten();

    let result = db
        .reinit_plan(&plan_rel_str, &parsed, Some(&plan_hash))
        .map_err(|e| e.to_string())?;

    // 7. Output
    if json {
        use crate::output::{JsonResponse, StateReinitData};
        let data = StateReinitData {
            plan_id: result.plan_id.clone(),
            plan_path: Some(plan_rel_str),
            plan_hash,
            reinitialized: true,
            step_count: result.step_count,
            dep_count: result.dep_count,
            checklist_count: result.checklist_count,
            archived_plan_id,
        };
        let response = JsonResponse::ok("state reinit", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Reinitialized state for plan: {}", plan);
        println!("  Steps: {}", result.step_count);
        println!("  Dependencies: {}", result.dep_count);
        println!("  Checklist items: {}", result.checklist_count);
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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Get stored hash from DB for claim_step verification
    let plan_state = db.show_plan(&plan_id).map_err(|e| e.to_string())?;
    let plan_hash = plan_state.plan_hash;

    // 5. Claim step
    let result = db
        .claim_step(&plan_id, &worktree, lease_duration, &plan_hash, force)
        .map_err(|e| e.to_string())?;

    // 6. Output
    if json {
        use crate::output::{JsonResponse, StateClaimData};
        use tugutil_core::ClaimResult;

        let plan_path_opt = plan_state.plan_path.clone();
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
                plan_id: plan_id.clone(),
                plan_path: plan_path_opt,
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
                plan_id: plan_id.clone(),
                plan_path: plan_path_opt,
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
                plan_id: plan_id.clone(),
                plan_path: plan_path_opt,
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
        use tugutil_core::ClaimResult;

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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Start step
    db.start_step(&plan_id, &step, &worktree)
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateStartData};
        let data = StateStartData {
            plan_id: plan_id.clone(),
            plan_path: None,
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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Heartbeat
    let lease_expires = db
        .heartbeat_step(&plan_id, &step, &worktree, lease_duration)
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateHeartbeatData};
        let data = StateHeartbeatData {
            plan_id: plan_id.clone(),
            plan_path: None,
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

pub fn run_state_complete_checklist(
    plan: String,
    step: String,
    worktree: String,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    use std::io::IsTerminal;

    // 1. Resolve repo root
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Determine deferral entries from stdin (TTY-aware with EOF tolerance)
    let entries: Vec<BatchUpdateEntry> = if std::io::stdin().is_terminal() {
        // Interactive invocation: no deferrals
        Vec::new()
    } else {
        // Piped invocation: read stdin to string first for EOF tolerance
        let mut buf = String::new();
        use std::io::Read;
        std::io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| format!("Failed to read stdin: {}", e))?;
        let trimmed = buf.trim();
        if trimmed.is_empty() {
            // Empty or EOF: treat as no deferrals (same as TTY)
            Vec::new()
        } else {
            serde_json::from_str(trimmed).map_err(|e| format!("Invalid JSON: {}", e))?
        }
    };

    // 6. Call batch_update_checklist with complete_remaining = true
    let result = db
        .batch_update_checklist(&plan_id, &step, &worktree, &entries, true)
        .map_err(|e| e.to_string())?;

    // 7. Output
    if json {
        use crate::output::{JsonResponse, StateUpdateData};
        let data = StateUpdateData {
            plan_id: plan_id.clone(),
            plan_path: None,
            anchor: step.clone(),
            items_updated: result.items_updated,
        };
        let response = JsonResponse::ok("state complete-checklist", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!(
            "Completed {} checklist item(s) for step: {}",
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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Read optional content from stdin (TTY-aware, same pattern as complete-checklist)
    use std::io::IsTerminal;
    let content: Option<String> = if std::io::stdin().is_terminal() {
        None
    } else {
        let mut buf = String::new();
        use std::io::Read;
        std::io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| format!("Failed to read stdin: {}", e))?;
        let trimmed = buf.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    };

    // 5. Record artifact
    let artifact_id = db
        .record_artifact(
            &plan_id,
            &step,
            &worktree,
            &kind,
            &summary,
            content.as_deref(),
        )
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateArtifactData};
        let data = StateArtifactData {
            plan_id: plan_id.clone(),
            plan_path: None,
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
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // 1. Resolve repo root
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Complete step
    let result = db
        .complete_step(&plan_id, &step, &worktree, force, reason.as_deref())
        .map_err(|e| e.to_string())?;

    // 6. Output
    if json {
        use crate::output::{JsonResponse, StateCompleteData};
        let data = StateCompleteData {
            plan_id: plan_id.clone(),
            plan_path: None,
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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    if let Some(plan) = plan {
        // Show specific plan
        let plan_id = resolve_plan_id(&db, &plan)?;
        let plan_state = db.show_plan(&plan_id).map_err(|e| e.to_string())?;

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
                    .get_checklist_items(&plan_id)
                    .map_err(|e| e.to_string())?;
                print_checklist_view(&plan_state, &items);
            } else {
                // Summary mode (default)
                print_plan_state(&plan_state);
            }
        }
    } else {
        // Show all plans
        let plan_ids = db.list_plan_ids().map_err(|e| e.to_string())?;

        if plan_ids.is_empty() {
            if !quiet && !json {
                println!("No plans initialized in state database.");
            }
            return Ok(0);
        }

        // Collect plan states
        let mut plan_states = Vec::new();
        for plan_id in &plan_ids {
            let plan_state = db.show_plan(plan_id).map_err(|e| e.to_string())?;
            plan_states.push(plan_state);
        }

        if json {
            use crate::output::JsonResponse;
            #[derive(serde::Serialize)]
            struct StateShowAllData {
                plans: Vec<tugutil_core::PlanState>,
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
                        .get_checklist_items(&plan_state.plan_id)
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
fn print_plan_state(plan: &tugutil_core::PlanState) {
    println!(
        "Plan: {}",
        plan.plan_path.as_deref().unwrap_or(&plan.plan_id)
    );
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
fn print_step_state(step: &tugutil_core::StepState, indent: usize) {
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
    plan_state: &tugutil_core::PlanState,
    items: &[tugutil_core::ChecklistItemDetail],
) {
    println!(
        "Plan: {}",
        plan_state
            .plan_path
            .as_deref()
            .unwrap_or(&plan_state.plan_id)
    );
    if let Some(title) = &plan_state.phase_title {
        println!("Title: {}", title);
    }
    println!("Status: {}", plan_state.status);
    println!();

    // Group items by step_anchor
    let mut items_by_step: std::collections::HashMap<
        String,
        Vec<&tugutil_core::ChecklistItemDetail>,
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
    step: &tugutil_core::StepState,
    items_by_step: &std::collections::HashMap<String, Vec<&tugutil_core::ChecklistItemDetail>>,
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

    println!();
}

/// Print a single checklist item with status marker
fn print_checklist_item(item: &tugutil_core::ChecklistItemDetail, indent: usize) {
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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Query ready steps
    let result = db.ready_steps(&plan_id).map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateReadyData};
        let data = StateReadyData {
            plan_id: plan_id.clone(),
            plan_path: None,
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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Reset step
    db.reset_step(&plan_id, &step).map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateResetData};
        let data = StateResetData {
            plan_id: plan_id.clone(),
            plan_path: None,
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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Release step
    let result = db
        .release_step(&plan_id, &step, worktree.as_deref(), force)
        .map_err(|e| e.to_string())?;

    // 5. Output
    if json {
        use crate::output::{JsonResponse, StateReleaseData};
        let data = StateReleaseData {
            plan_id: plan_id.clone(),
            plan_path: None,
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
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;

    // 2. Open state.db
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;

    // 3. Resolve plan_id
    let plan_id = resolve_plan_id(&db, &plan)?;

    // 4. Get plan file path for matching git trailers (trailers may contain file path)
    let plan_state = db.show_plan(&plan_id).map_err(|e| e.to_string())?;
    let plan_file_path = plan_state.plan_path;

    // 5. Scan git log for trailers
    let entries = scan_git_trailers(&repo_root, &plan_id, plan_file_path.as_deref())?;

    // 6. Reconcile
    let result = db
        .reconcile(&plan_id, &entries, force)
        .map_err(|e| e.to_string())?;

    // 7. Output warnings for mismatches
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

    // 8. Output
    if json {
        use crate::output::{JsonResponse, StateReconcileData};
        let data = StateReconcileData {
            plan_id: plan_id.clone(),
            plan_path: None,
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

pub fn run_state_archive(plan: String, json: bool, quiet: bool) -> Result<i32, String> {
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;
    let db_path = repo_root.join(".tugtool").join("state.db");
    let mut db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;
    let plan_id = resolve_plan_id(&db, &plan)?;
    let result = db.archive_plan(&plan_id).map_err(|e| e.to_string())?;

    if json {
        use crate::output::{JsonResponse, StateArchiveData};
        let data = StateArchiveData {
            plan_id: result.plan_id.clone(),
            archived: true,
            snapshot_taken: result.snapshot_taken,
        };
        let response = JsonResponse::ok("state archive", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        println!("Archived plan: {}", result.plan_id);
        if result.snapshot_taken {
            println!("  Snapshot: taken");
        }
    }
    Ok(0)
}

pub fn run_state_list(all: bool, json: bool, quiet: bool) -> Result<i32, String> {
    let repo_root = tugutil_core::find_repo_root().map_err(|e| e.to_string())?;
    let db_path = repo_root.join(".tugtool").join("state.db");
    let db = tugutil_core::StateDb::open(&db_path, &repo_root).map_err(|e| e.to_string())?;
    let plans = db.list_plans(all).map_err(|e| e.to_string())?;

    if json {
        use crate::output::{JsonResponse, StateListData, StateListEntry};
        let entries: Vec<StateListEntry> = plans
            .iter()
            .map(|p| StateListEntry {
                plan_id: p.plan_id.clone(),
                plan_slug: p.plan_slug.clone(),
                plan_path: p.plan_path.clone(),
                status: if p.status == "active"
                    && p.steps_total > 0
                    && p.steps_completed == p.steps_total
                {
                    "completed".to_string()
                } else {
                    p.status.clone()
                },
                steps_completed: p.steps_completed,
                steps_total: p.steps_total,
                created_at: p.created_at.clone(),
                updated_at: p.updated_at.clone(),
            })
            .collect();
        let data = StateListData { plans: entries };
        let response = JsonResponse::ok("state list", data);
        println!(
            "{}",
            serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
        );
    } else if !quiet {
        if plans.is_empty() {
            println!("No plans tracked.");
        } else {
            println!(
                "{:<40} {:<12} {:<10} {:<12} {:<12}",
                "PLAN", "STATUS", "STEPS", "CREATED", "UPDATED"
            );
            for p in &plans {
                let display_status = if p.status == "active"
                    && p.steps_total > 0
                    && p.steps_completed == p.steps_total
                {
                    "completed"
                } else {
                    &p.status
                };
                let created_short = if p.created_at.len() >= 10 {
                    &p.created_at[..10]
                } else {
                    &p.created_at
                };
                let updated_short = if p.updated_at.len() >= 10 {
                    &p.updated_at[..10]
                } else {
                    &p.updated_at
                };
                println!(
                    "{:<40} {:<12} {}/{:<8} {:<12} {}",
                    p.plan_id,
                    display_status,
                    p.steps_completed,
                    p.steps_total,
                    created_short,
                    updated_short
                );
            }
        }
    }
    Ok(0)
}

/// Scan git log for Tug-Step and Tug-Plan trailers
fn scan_git_trailers(
    repo_root: &std::path::Path,
    plan_id: &str,
    plan_file_path: Option<&str>,
) -> Result<Vec<tugutil_core::ReconcileEntry>, String> {
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
                entries.push(tugutil_core::ReconcileEntry {
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

    // Filter to only entries for the requested plan.
    // Match against both plan_id and plan_file_path (git trailers may contain
    // either the plan_id or the file path depending on when the commit was made).
    let filtered: Vec<_> = entries
        .into_iter()
        .filter(|e| e.plan_path == plan_id || plan_file_path.is_some_and(|fp| e.plan_path == fp))
        .collect();

    Ok(filtered)
}
