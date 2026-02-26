//! Implementation of the `tug status` command (Spec S04)

use std::collections::HashMap;
use std::fs;

use tugtool_core::{
    ResolveResult, TugError, TugPlan, find_project_root, parse_tugplan, resolve_plan,
    tugplan_name_from_path,
};

use crate::output::{
    JsonIssue, JsonResponse, Progress, StatusData, StepInfo, StepStatus, SubstepStatus,
};

/// Run the status command
pub fn run_status(
    file: String,
    verbose: bool,
    json_output: bool,
    _quiet: bool,
) -> Result<i32, String> {
    // Find project root
    let project_root = match find_project_root() {
        Ok(root) => root,
        Err(_) => {
            let message = ".tugtool directory not initialized".to_string();
            if json_output {
                let issues = vec![JsonIssue {
                    code: "E009".to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<StatusData> = JsonResponse::error(
                    "status",
                    StatusData {
                        name: String::new(),
                        status: String::new(),
                        progress: Progress { done: 0, total: 0 },
                        steps: vec![],
                        all_steps: None,
                        completed_steps: None,
                        remaining_steps: None,
                        next_step: None,
                        dependencies: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                    },
                    issues,
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(9);
        }
    };

    // Resolve file path
    let path = match resolve_plan(&file, &project_root) {
        Ok(ResolveResult::Found { path, .. }) => path,
        Ok(ResolveResult::NotFound) => {
            let message = format!("file not found: {}", file);
            if json_output {
                let issues = vec![JsonIssue {
                    code: "E002".to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: Some(file),
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<StatusData> = JsonResponse::error(
                    "status",
                    StatusData {
                        name: String::new(),
                        status: String::new(),
                        progress: Progress { done: 0, total: 0 },
                        steps: vec![],
                        all_steps: None,
                        completed_steps: None,
                        remaining_steps: None,
                        next_step: None,
                        dependencies: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                    },
                    issues,
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(2);
        }
        Ok(ResolveResult::Ambiguous(candidates)) => {
            let message = format!(
                "Ambiguous plan identifier '{}': matches {} plans",
                file,
                candidates.len()
            );
            if json_output {
                let issues = vec![JsonIssue {
                    code: "E040".to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: Some(file),
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<StatusData> = JsonResponse::error(
                    "status",
                    StatusData {
                        name: String::new(),
                        status: String::new(),
                        progress: Progress { done: 0, total: 0 },
                        steps: vec![],
                        all_steps: None,
                        completed_steps: None,
                        remaining_steps: None,
                        next_step: None,
                        dependencies: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                    },
                    issues,
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(2);
        }
        Err(TugError::NotInitialized) => {
            let message = ".tugtool directory not initialized".to_string();
            if json_output {
                let issues = vec![JsonIssue {
                    code: "E009".to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<StatusData> = JsonResponse::error(
                    "status",
                    StatusData {
                        name: String::new(),
                        status: String::new(),
                        progress: Progress { done: 0, total: 0 },
                        steps: vec![],
                        all_steps: None,
                        completed_steps: None,
                        remaining_steps: None,
                        next_step: None,
                        dependencies: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                    },
                    issues,
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(9);
        }
        Err(e) => {
            let message = format!("Resolution failed: {}", e);
            if json_output {
                let issues = vec![JsonIssue {
                    code: e.code().to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<StatusData> = JsonResponse::error(
                    "status",
                    StatusData {
                        name: String::new(),
                        status: String::new(),
                        progress: Progress { done: 0, total: 0 },
                        steps: vec![],
                        all_steps: None,
                        completed_steps: None,
                        remaining_steps: None,
                        next_step: None,
                        dependencies: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                    },
                    issues,
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(e.exit_code());
        }
    };

    // Read and parse the plan
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            let message = format!("failed to read file: {}", e);
            if json_output {
                let issues = vec![JsonIssue {
                    code: "E002".to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: Some(file),
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<StatusData> = JsonResponse::error(
                    "status",
                    StatusData {
                        name: String::new(),
                        status: String::new(),
                        progress: Progress { done: 0, total: 0 },
                        steps: vec![],
                        all_steps: None,
                        completed_steps: None,
                        remaining_steps: None,
                        next_step: None,
                        dependencies: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                    },
                    issues,
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(2);
        }
    };

    let plan = match parse_tugplan(&content) {
        Ok(s) => s,
        Err(e) => {
            let message = format!("failed to parse plan: {}", e);
            if json_output {
                let issues = vec![JsonIssue {
                    code: "E001".to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: Some(file),
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<StatusData> = JsonResponse::error(
                    "status",
                    StatusData {
                        name: String::new(),
                        status: String::new(),
                        progress: Progress { done: 0, total: 0 },
                        steps: vec![],
                        all_steps: None,
                        completed_steps: None,
                        remaining_steps: None,
                        next_step: None,
                        dependencies: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                    },
                    issues,
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(1);
        }
    };

    let name = tugplan_name_from_path(&path).unwrap_or_else(|| file.clone());

    // Use checkbox mode
    let status_data = build_checkbox_status_data(&plan, &name);
    if json_output {
        let response = JsonResponse::ok("status", status_data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else {
        output_text(&status_data, &plan, verbose);
    }
    Ok(0)
}

/// Build status data from a parsed plan using checkbox counting (fallback mode)
fn build_checkbox_status_data(plan: &TugPlan, name: &str) -> StatusData {
    let mut total_done = 0;
    let mut total_items = 0;

    let steps: Vec<StepStatus> = plan
        .steps
        .iter()
        .map(|step| {
            let step_done = step.completed_items();
            let step_total = step.total_items();
            total_done += step_done;
            total_items += step_total;

            let substeps: Vec<SubstepStatus> = step
                .substeps
                .iter()
                .map(|substep| {
                    let sub_done = substep.completed_items();
                    let sub_total = substep.total_items();
                    total_done += sub_done;
                    total_items += sub_total;

                    SubstepStatus {
                        title: substep.title.clone(),
                        anchor: substep.anchor.clone(),
                        done: sub_done,
                        total: sub_total,
                    }
                })
                .collect();

            StepStatus {
                title: step.title.clone(),
                anchor: step.anchor.clone(),
                done: step_done,
                total: step_total,
                substeps,
            }
        })
        .collect();

    let status = plan
        .metadata
        .status
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    // Build extended fields
    let all_steps: Vec<StepInfo> = plan
        .steps
        .iter()
        .map(|step| StepInfo {
            anchor: step.anchor.clone(),
            title: step.title.clone(),
            number: step.number.clone(),
        })
        .collect();

    // A step is complete if all its items are checked (both tasks and substeps)
    let completed_steps: Vec<StepInfo> = plan
        .steps
        .iter()
        .filter(|step| {
            let step_done = step.completed_items();
            let step_total = step.total_items();
            step_total > 0 && step_done == step_total
        })
        .map(|step| StepInfo {
            anchor: step.anchor.clone(),
            title: step.title.clone(),
            number: step.number.clone(),
        })
        .collect();

    // Remaining steps are those not in completed_steps
    let completed_anchors: std::collections::HashSet<String> =
        completed_steps.iter().map(|s| s.anchor.clone()).collect();

    let remaining_steps: Vec<StepInfo> = all_steps
        .iter()
        .filter(|step| !completed_anchors.contains(&step.anchor))
        .cloned()
        .collect();

    // Next step is the first remaining step
    let next_step = remaining_steps.first().cloned();

    // Build dependencies mapping
    let dependencies: HashMap<String, Vec<String>> = plan
        .steps
        .iter()
        .map(|step| {
            let deps = step.depends_on.to_vec();
            (step.anchor.clone(), deps)
        })
        .collect();

    StatusData {
        name: name.to_string(),
        status,
        progress: Progress {
            done: total_done,
            total: total_items,
        },
        steps,
        all_steps: Some(all_steps),
        completed_steps: Some(completed_steps),
        remaining_steps: Some(remaining_steps),
        next_step,
        dependencies: Some(dependencies),
        plan: None,
        phase_title: None,
        total_step_count: None,
        completed_step_count: None,
        ready_step_count: None,
        blocked_step_count: None,
    }
}

fn output_text(data: &StatusData, plan: &TugPlan, verbose: bool) {
    // Calculate percentage
    let percentage = if data.progress.total > 0 {
        (data.progress.done as f64 / data.progress.total as f64 * 100.0) as usize
    } else {
        0
    };

    println!(
        "{}.md: {} ({}% complete)",
        data.name, data.status, percentage
    );
    println!();

    for (i, step) in data.steps.iter().enumerate() {
        let check = if step.total > 0 && step.done == step.total {
            "[x]"
        } else {
            "[ ]"
        };

        let progress = format!("{}/{}", step.done, step.total);
        println!(
            "Step {}: {:<40} {} {}",
            plan.steps[i].number, step.title, check, progress
        );

        // Show substeps
        for (j, substep) in step.substeps.iter().enumerate() {
            let sub_check = if substep.total > 0 && substep.done == substep.total {
                "[x]"
            } else {
                "[ ]"
            };
            let sub_progress = format!("{}/{}", substep.done, substep.total);
            println!(
                "  Step {}: {:<38} {} {}",
                plan.steps[i].substeps[j].number, substep.title, sub_check, sub_progress
            );
        }

        // Verbose mode: show individual tasks
        if verbose {
            let step_data = &plan.steps[i];
            if !step_data.tasks.is_empty() {
                println!("    Tasks:");
                for task in &step_data.tasks {
                    let check = if task.checked { "[x]" } else { "[ ]" };
                    println!("      {} {}", check, task.text);
                }
            }
            if !step_data.tests.is_empty() {
                println!("    Tests:");
                for test in &step_data.tests {
                    let check = if test.checked { "[x]" } else { "[ ]" };
                    println!("      {} {}", check, test.text);
                }
            }
            if !step_data.checkpoints.is_empty() {
                println!("    Checkpoints:");
                for checkpoint in &step_data.checkpoints {
                    let check = if checkpoint.checked { "[x]" } else { "[ ]" };
                    println!("      {} {}", check, checkpoint.text);
                }
            }
            if let Some(ref refs) = step_data.references {
                println!("    References: {}", refs);
            }
            println!();
        }
    }

    println!();
    println!(
        "Total: {}/{} tasks complete",
        data.progress.done, data.progress.total
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn test_golden_fallback_status_json() {
        // Build a minimal plan inline
        let plan_content = r#"
---
Owner: test
Status: draft
Last updated: 2026-02-01
---

## Execution

### Step 1: Bootstrap {#step-1}

## Tasks
- [x] Setup project
- [ ] Add tests
- [x] Document API
- [ ] Deploy

"#;

        let plan = parse_tugplan(plan_content).unwrap();
        let status_data = build_checkbox_status_data(&plan, "test-fallback");

        let response = JsonResponse::ok("status", status_data);
        let actual_json = serde_json::to_value(&response).unwrap();

        // Load golden file (from workspace root)
        let golden_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/golden/status_fallback.json"
        );
        let golden_content = fs::read_to_string(golden_path)
            .unwrap_or_else(|_| panic!("Failed to read golden file: {}", golden_path));
        let expected_json: serde_json::Value = serde_json::from_str(&golden_content).unwrap();

        // Compare key fields
        assert_eq!(actual_json["status"], expected_json["status"]);
        assert_eq!(actual_json["data"]["name"], expected_json["data"]["name"]);
        assert_eq!(
            actual_json["data"]["progress"]["done"],
            expected_json["data"]["progress"]["done"]
        );
        assert_eq!(
            actual_json["data"]["progress"]["total"],
            expected_json["data"]["progress"]["total"]
        );

        // Verify steps array
        let actual_steps = actual_json["data"]["steps"].as_array().unwrap();
        assert_eq!(actual_steps.len(), 1);
        assert_eq!(actual_steps[0]["title"], "Bootstrap");
        assert_eq!(actual_steps[0]["done"], 2);
        assert_eq!(actual_steps[0]["total"], 4);
    }
}
