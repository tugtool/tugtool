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
            let candidate_strs: Vec<String> = candidates
                .iter()
                .map(|p| p.display().to_string())
                .collect();
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
