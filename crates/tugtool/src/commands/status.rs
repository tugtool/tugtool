//! Implementation of the `tug status` command (Spec S04)

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use tugtool_core::{
    BeadsCli, IssueDetails, TugPlan, find_project_root, parse_close_reason, parse_tugplan,
    tugplan_name_from_path,
};

use crate::output::{
    BeadStepStatus, JsonIssue, JsonResponse, Progress, StatusData, StepInfo, StepStatus,
    SubstepStatus,
};

/// Run the status command
pub fn run_status(
    file: String,
    verbose: bool,
    full: bool,
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
                        bead_mapping: None,
                        dependencies: None,
                        mode: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                        bead_steps: None,
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
    let path = resolve_file_path(&project_root, &file);
    if !path.exists() {
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
                    bead_mapping: None,
                    dependencies: None,
                    mode: None,
                    plan: None,
                    phase_title: None,
                    total_step_count: None,
                    completed_step_count: None,
                    ready_step_count: None,
                    blocked_step_count: None,
                    bead_steps: None,
                },
                issues,
            );
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
        } else {
            eprintln!("error: {}", message);
        }
        return Ok(2);
    }

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
                        bead_mapping: None,
                        dependencies: None,
                        mode: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                        bead_steps: None,
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
                        bead_mapping: None,
                        dependencies: None,
                        mode: None,
                        plan: None,
                        phase_title: None,
                        total_step_count: None,
                        completed_step_count: None,
                        ready_step_count: None,
                        blocked_step_count: None,
                        bead_steps: None,
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

    // Check if beads integration is available
    if let Some(ref root_id) = plan.metadata.beads_root_id {
        // Try beads path
        let beads_cli = BeadsCli::default();

        if !beads_cli.is_installed(None) {
            eprintln!("warning: beads CLI not found, falling back to checkbox mode");
            // Fall back to checkbox mode
            let status_data = build_checkbox_status_data(&plan, &name);
            if json_output {
                let response = JsonResponse::ok("status", status_data);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                output_text(&status_data, &plan, verbose);
            }
            return Ok(0);
        }

        match build_beads_status_data(&plan, &name, &file, root_id, &beads_cli) {
            Ok((status_data, details_map)) => {
                if json_output {
                    let response = JsonResponse::ok("status", status_data);
                    println!("{}", serde_json::to_string_pretty(&response).unwrap());
                } else {
                    output_beads_text(&status_data, &plan, full, &details_map);
                }
                Ok(0)
            }
            Err(e) => {
                eprintln!(
                    "warning: beads query failed ({}), falling back to checkbox mode",
                    e
                );
                // Fall back to checkbox mode
                let status_data = build_checkbox_status_data(&plan, &name);
                if json_output {
                    let response = JsonResponse::ok("status", status_data);
                    println!("{}", serde_json::to_string_pretty(&response).unwrap());
                } else {
                    output_text(&status_data, &plan, verbose);
                }
                Ok(0)
            }
        }
    } else {
        // No beads_root_id, use checkbox mode
        let status_data = build_checkbox_status_data(&plan, &name);
        if json_output {
            let response = JsonResponse::ok("status", status_data);
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
        } else {
            output_text(&status_data, &plan, verbose);
        }
        Ok(0)
    }
}

/// Resolve a file path relative to the project
fn resolve_file_path(project_root: &Path, file: &str) -> PathBuf {
    let path = Path::new(file);
    if path.is_absolute() {
        path.to_path_buf()
    } else if file.starts_with(".tugtool/") || file.starts_with(".tugtool\\") {
        project_root.join(file)
    } else if file.starts_with("tugplan-") || file.ends_with(".md") {
        // Assume it's in .tugtool/
        let filename = if file.starts_with("tugplan-") && file.ends_with(".md") {
            file.to_string()
        } else if file.starts_with("tugplan-") {
            format!("{}.md", file)
        } else {
            format!("tugplan-{}.md", file)
        };
        project_root.join(".tugtool").join(filename)
    } else {
        // Try as-is first
        let as_is = project_root.join(file);
        if as_is.exists() {
            as_is
        } else {
            project_root.join(".tugtool").join(format!("tugplan-{}.md", file))
        }
    }
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
                        anchor: format!("#{}", substep.anchor),
                        done: sub_done,
                        total: sub_total,
                    }
                })
                .collect();

            StepStatus {
                title: step.title.clone(),
                anchor: format!("#{}", step.anchor),
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
            anchor: format!("#{}", step.anchor),
            title: step.title.clone(),
            number: step.number.clone(),
            bead_id: step.bead_id.clone(),
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
            anchor: format!("#{}", step.anchor),
            title: step.title.clone(),
            number: step.number.clone(),
            bead_id: step.bead_id.clone(),
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

    // Build bead mapping (only include steps with bead_id)
    let bead_mapping: HashMap<String, String> = plan
        .steps
        .iter()
        .filter_map(|step| {
            step.bead_id
                .as_ref()
                .map(|bead_id| (format!("#{}", step.anchor), bead_id.clone()))
        })
        .collect();

    // Build dependencies mapping
    let dependencies: HashMap<String, Vec<String>> = plan
        .steps
        .iter()
        .map(|step| {
            let deps = step
                .depends_on
                .iter()
                .map(|dep| format!("#{}", dep))
                .collect();
            (format!("#{}", step.anchor), deps)
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
        bead_mapping: Some(bead_mapping),
        dependencies: Some(dependencies),
        mode: Some("checkbox".to_string()),
        plan: None,
        phase_title: None,
        total_step_count: None,
        completed_step_count: None,
        ready_step_count: None,
        blocked_step_count: None,
        bead_steps: None,
    }
}

/// Classify steps based on bead data (pure function for testability)
fn classify_steps(
    plan: &TugPlan,
    children: &[IssueDetails],
    ready_ids: &HashSet<String>,
) -> (Vec<BeadStepStatus>, HashMap<String, IssueDetails>) {
    // Build bead_id -> IssueDetails map
    let bead_id_to_details: HashMap<String, &IssueDetails> =
        children.iter().map(|d| (d.id.clone(), d)).collect();

    // Build bead_id -> step anchor map (for blocked_by resolution)
    let bead_id_to_anchor: HashMap<String, String> = plan
        .steps
        .iter()
        .filter_map(|step| {
            step.bead_id
                .as_ref()
                .map(|bead_id| (bead_id.clone(), format!("#{}", step.anchor)))
        })
        .collect();

    // Build a map of bead ID to full IssueDetails for --full rendering
    let mut details_map: HashMap<String, IssueDetails> = HashMap::new();

    let bead_steps: Vec<BeadStepStatus> = plan
        .steps
        .iter()
        .map(|step| {
            let anchor = format!("#{}", step.anchor);
            let title = step.title.clone();
            let number = step.number.clone();

            match &step.bead_id {
                None => BeadStepStatus {
                    anchor,
                    title,
                    number,
                    bead_status: Some("pending".to_string()),
                    bead_id: None,
                    commit_hash: None,
                    commit_summary: None,
                    close_reason: None,
                    task_count: None,
                    test_count: None,
                    checkpoint_count: None,
                    blocked_by: None,
                },
                Some(bead_id) => {
                    if let Some(&details) = bead_id_to_details.get(bead_id) {
                        // Store full details for --full rendering
                        details_map.insert(anchor.clone(), details.clone());

                        if details.status == "closed" {
                            // Complete step
                            let parsed = details
                                .close_reason
                                .as_ref()
                                .map(|r| parse_close_reason(r))
                                .unwrap_or_else(|| parse_close_reason(""));

                            BeadStepStatus {
                                anchor,
                                title,
                                number,
                                bead_status: Some("complete".to_string()),
                                bead_id: Some(bead_id.clone()),
                                commit_hash: parsed.commit_hash,
                                commit_summary: parsed.commit_summary,
                                close_reason: Some(parsed.raw),
                                task_count: None,
                                test_count: None,
                                checkpoint_count: None,
                                blocked_by: None,
                            }
                        } else if ready_ids.contains(bead_id) {
                            // Ready step
                            BeadStepStatus {
                                anchor,
                                title,
                                number,
                                bead_status: Some("ready".to_string()),
                                bead_id: Some(bead_id.clone()),
                                commit_hash: None,
                                commit_summary: None,
                                close_reason: None,
                                task_count: Some(step.tasks.len()),
                                test_count: Some(step.tests.len()),
                                checkpoint_count: Some(step.checkpoints.len()),
                                blocked_by: None,
                            }
                        } else {
                            // Blocked step
                            // Compute blocked_by: find dependencies that are not closed
                            let blocked_by: Vec<String> = details
                                .dependencies
                                .iter()
                                .filter_map(|dep| {
                                    // Check if this dependency is still open
                                    if let Some(&dep_details) = bead_id_to_details.get(&dep.id) {
                                        if dep_details.status != "closed" {
                                            // Resolve to step anchor
                                            bead_id_to_anchor.get(&dep.id).cloned()
                                        } else {
                                            None
                                        }
                                    } else {
                                        None
                                    }
                                })
                                .collect();

                            BeadStepStatus {
                                anchor,
                                title,
                                number,
                                bead_status: Some("blocked".to_string()),
                                bead_id: Some(bead_id.clone()),
                                commit_hash: None,
                                commit_summary: None,
                                close_reason: None,
                                task_count: None,
                                test_count: None,
                                checkpoint_count: None,
                                blocked_by: if blocked_by.is_empty() {
                                    None
                                } else {
                                    Some(blocked_by)
                                },
                            }
                        }
                    } else {
                        // Bead ID present but not in children (edge case)
                        BeadStepStatus {
                            anchor,
                            title,
                            number,
                            bead_status: Some("pending".to_string()),
                            bead_id: Some(bead_id.clone()),
                            commit_hash: None,
                            commit_summary: None,
                            close_reason: None,
                            task_count: None,
                            test_count: None,
                            checkpoint_count: None,
                            blocked_by: None,
                        }
                    }
                }
            }
        })
        .collect();

    (bead_steps, details_map)
}

/// Build status data using beads integration
fn build_beads_status_data(
    plan: &TugPlan,
    name: &str,
    file_path: &str,
    root_id: &str,
    beads_cli: &BeadsCli,
) -> Result<(StatusData, HashMap<String, IssueDetails>), String> {
    // Query all child beads with details
    let children = beads_cli
        .list_children_detailed(root_id, None)
        .map_err(|e| format!("failed to query bead children: {}", e))?;

    // Query ready beads
    let ready_beads = beads_cli
        .ready(Some(root_id), None)
        .map_err(|e| format!("failed to query ready beads: {}", e))?;

    let ready_ids: HashSet<String> = ready_beads.iter().map(|b| b.id.clone()).collect();

    // Classify steps
    let (bead_steps, details_map) = classify_steps(plan, &children, &ready_ids);

    // Count step statuses
    let completed_count = bead_steps
        .iter()
        .filter(|s| s.bead_status.as_deref() == Some("complete"))
        .count();
    let ready_count = bead_steps
        .iter()
        .filter(|s| s.bead_status.as_deref() == Some("ready"))
        .count();
    let blocked_count = bead_steps
        .iter()
        .filter(|s| s.bead_status.as_deref() == Some("blocked"))
        .count();

    let status = plan
        .metadata
        .status
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let status_data = StatusData {
        name: name.to_string(),
        status,
        progress: Progress {
            done: completed_count,
            total: plan.steps.len(),
        },
        steps: vec![], // Empty in beads mode
        all_steps: None,
        completed_steps: None,
        remaining_steps: None,
        next_step: None,
        bead_mapping: None,
        dependencies: None,
        mode: Some("beads".to_string()),
        plan: Some(file_path.to_string()),
        phase_title: plan.phase_title.clone(),
        total_step_count: Some(plan.steps.len()),
        completed_step_count: Some(completed_count),
        ready_step_count: Some(ready_count),
        blocked_step_count: Some(blocked_count),
        bead_steps: Some(bead_steps),
    };

    Ok((status_data, details_map))
}

/// Format beads-mode status as text (returns String for testability)
fn format_beads_text(
    data: &StatusData,
    full: bool,
    details_map: &HashMap<String, IssueDetails>,
) -> String {
    let mut output = String::new();

    // Print phase title or plan name
    if let Some(ref phase_title) = data.phase_title {
        output.push_str(&format!("## {}\n", phase_title));
    } else {
        output.push_str(&format!("## {}\n", data.name));
    }
    output.push('\n');

    // Print summary
    let completed = data.completed_step_count.unwrap_or(0);
    let total = data.total_step_count.unwrap_or(0);
    output.push_str(&format!(
        "Status: {} | {}/{} steps complete\n",
        data.status, completed, total
    ));
    output.push('\n');

    // Print each step
    if let Some(ref bead_steps) = data.bead_steps {
        for step in bead_steps {
            let indicator = match step.bead_status.as_deref() {
                Some("complete") => "[✓]",
                Some("ready") => "[...]",
                Some("blocked") => "[⏳]",
                _ => "[ ]",
            };

            let status_label = step.bead_status.as_deref().unwrap_or("pending");

            output.push_str(&format!(
                "Step {}: {}   {} {}\n",
                step.number, step.title, indicator, status_label
            ));

            // Show close reason for completed steps
            if let Some(ref close_reason) = step.close_reason {
                output.push_str(&format!("  {}\n", close_reason));
            }

            // Show task/test/checkpoint counts for ready steps
            if step.bead_status.as_deref() == Some("ready") {
                let tasks = step.task_count.unwrap_or(0);
                let tests = step.test_count.unwrap_or(0);
                let checkpoints = step.checkpoint_count.unwrap_or(0);
                output.push_str(&format!(
                    "  Tasks: {} | Tests: {} | Checkpoints: {}\n",
                    tasks, tests, checkpoints
                ));
            }

            // Show blocked_by for blocked steps
            if let Some(ref blocked_by) = step.blocked_by {
                let blocked_str = blocked_by
                    .iter()
                    .map(|anchor| {
                        // Convert #step-N to "Step N"
                        anchor.trim_start_matches('#').replace("step-", "Step ")
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                output.push_str(&format!("  Blocked by: {}\n", blocked_str));
            }

            // --full mode: show raw bead field content
            if full {
                if let Some(details) = details_map.get(&step.anchor) {
                    if !details.description.is_empty() {
                        output.push_str("  --- Description ---\n");
                        for line in details.description.lines() {
                            output.push_str(&format!("  {}\n", line));
                        }
                    }
                    if let Some(ref design) = details.design {
                        if !design.is_empty() {
                            output.push_str("  --- Design ---\n");
                            for line in design.lines() {
                                output.push_str(&format!("  {}\n", line));
                            }
                        }
                    }
                    if let Some(ref acceptance) = details.acceptance_criteria {
                        if !acceptance.is_empty() {
                            output.push_str("  --- Acceptance Criteria ---\n");
                            for line in acceptance.lines() {
                                output.push_str(&format!("  {}\n", line));
                            }
                        }
                    }
                    if let Some(ref notes) = details.notes {
                        if !notes.is_empty() {
                            output.push_str("  --- Notes ---\n");
                            for line in notes.lines() {
                                output.push_str(&format!("  {}\n", line));
                            }
                        }
                    }
                }
            }
        }
    }

    output
}

/// Output beads-mode status in text format
fn output_beads_text(
    data: &StatusData,
    _plan: &TugPlan,
    full: bool,
    details_map: &HashMap<String, IssueDetails>,
) {
    print!("{}", format_beads_text(data, full, details_map));
}

/// Output status in text format
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
    use tugtool_core::{Step, TugPlanMetadata};

    /// Helper to build a minimal plan for testing
    fn build_test_plan(steps: Vec<Step>) -> TugPlan {
        TugPlan {
            path: None,
            phase_title: Some("Test Beads Feature".to_string()),
            phase_anchor: None,
            purpose: None,
            metadata: TugPlanMetadata {
                owner: None,
                status: Some("active".to_string()),
                target_branch: None,
                tracking: None,
                last_updated: None,
                beads_root_id: None,
            },
            anchors: vec![],
            decisions: vec![],
            questions: vec![],
            steps,
            raw_content: String::new(),
            diagnostics: vec![],
        }
    }

    #[test]
    fn test_golden_beads_status_json() {
        // Build test plan with 3 steps
        let step0 = Step {
            anchor: "step-0".to_string(),
            number: "0".to_string(),
            title: "Setup infrastructure".to_string(),
            line: 10,
            bead_id: Some("bd-001".to_string()),
            beads_hints: None,
            commit_message: None,
            references: None,
            tasks: vec![],
            tests: vec![],
            checkpoints: vec![],
            artifacts: vec![],
            depends_on: vec![],
            substeps: vec![],
        };

        let step1 = Step {
            anchor: "step-1".to_string(),
            number: "1".to_string(),
            title: "Implement core logic".to_string(),
            line: 20,
            bead_id: Some("bd-002".to_string()),
            beads_hints: None,
            commit_message: None,
            references: None,
            tasks: vec![
                tugtool_core::Checkpoint {
                    text: "task 1".to_string(),
                    kind: tugtool_core::CheckpointKind::Task,
                    checked: false,
                    line: 21,
                },
                tugtool_core::Checkpoint {
                    text: "task 2".to_string(),
                    kind: tugtool_core::CheckpointKind::Task,
                    checked: false,
                    line: 22,
                },
            ],
            tests: vec![tugtool_core::Checkpoint {
                text: "test 1".to_string(),
                kind: tugtool_core::CheckpointKind::Test,
                checked: false,
                line: 23,
            }],
            checkpoints: vec![tugtool_core::Checkpoint {
                text: "checkpoint 1".to_string(),
                kind: tugtool_core::CheckpointKind::Checkpoint,
                checked: false,
                line: 24,
            }],
            artifacts: vec![],
            depends_on: vec![],
            substeps: vec![],
        };

        let step2 = Step {
            anchor: "step-2".to_string(),
            number: "2".to_string(),
            title: "Add documentation".to_string(),
            line: 30,
            bead_id: Some("bd-003".to_string()),
            beads_hints: None,
            commit_message: None,
            references: None,
            tasks: vec![],
            tests: vec![],
            checkpoints: vec![],
            artifacts: vec![],
            depends_on: vec!["step-1".to_string()],
            substeps: vec![],
        };

        let plan = build_test_plan(vec![step0, step1, step2]);

        // Build mock IssueDetails
        let bd001 = IssueDetails {
            id: "bd-001".to_string(),
            title: "Setup infrastructure".to_string(),
            description: String::new(),
            status: "closed".to_string(),
            priority: 2,
            issue_type: "task".to_string(),
            dependencies: vec![],
            dependents: vec![],
            design: None,
            acceptance_criteria: None,
            notes: None,
            close_reason: Some("Committed: abc123d -- feat: setup".to_string()),
            metadata: None,
        };

        let bd002 = IssueDetails {
            id: "bd-002".to_string(),
            title: "Implement core logic".to_string(),
            description: String::new(),
            status: "open".to_string(),
            priority: 2,
            issue_type: "task".to_string(),
            dependencies: vec![],
            dependents: vec![],
            design: None,
            acceptance_criteria: None,
            notes: None,
            close_reason: None,
            metadata: None,
        };

        let bd003 = IssueDetails {
            id: "bd-003".to_string(),
            title: "Add documentation".to_string(),
            description: String::new(),
            status: "open".to_string(),
            priority: 2,
            issue_type: "task".to_string(),
            dependencies: vec![tugtool_core::beads::DependencyRef {
                id: "bd-002".to_string(),
                dependency_type: String::new(),
            }],
            dependents: vec![],
            design: None,
            acceptance_criteria: None,
            notes: None,
            close_reason: None,
            metadata: None,
        };

        let children = vec![bd001, bd002, bd003];
        let ready_ids: HashSet<String> = vec!["bd-002".to_string()].into_iter().collect();

        // Classify steps
        let (bead_steps, _details_map) = classify_steps(&plan, &children, &ready_ids);

        // Build StatusData
        let status_data = StatusData {
            name: "test-beads".to_string(),
            status: "active".to_string(),
            progress: Progress { done: 1, total: 3 },
            steps: vec![],
            all_steps: None,
            completed_steps: None,
            remaining_steps: None,
            next_step: None,
            bead_mapping: None,
            dependencies: None,
            mode: Some("beads".to_string()),
            plan: Some(".tug/plan-test-beads.md".to_string()),
            phase_title: Some("Test Beads Feature".to_string()),
            total_step_count: Some(3),
            completed_step_count: Some(1),
            ready_step_count: Some(1),
            blocked_step_count: Some(1),
            bead_steps: Some(bead_steps),
        };

        let response = JsonResponse::ok("status", status_data);
        let actual_json = serde_json::to_value(&response).unwrap();

        // Load golden file (from workspace root)
        let golden_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/golden/status_beads.json"
        );
        let golden_content = fs::read_to_string(golden_path)
            .unwrap_or_else(|_| panic!("Failed to read golden file: {}", golden_path));
        let expected_json: serde_json::Value = serde_json::from_str(&golden_content).unwrap();

        // Compare key fields
        assert_eq!(actual_json["status"], expected_json["status"]);
        assert_eq!(actual_json["command"], expected_json["command"]);
        assert_eq!(actual_json["data"]["mode"], expected_json["data"]["mode"]);
        assert_eq!(
            actual_json["data"]["total_step_count"],
            expected_json["data"]["total_step_count"]
        );
        assert_eq!(
            actual_json["data"]["completed_step_count"],
            expected_json["data"]["completed_step_count"]
        );
        assert_eq!(
            actual_json["data"]["ready_step_count"],
            expected_json["data"]["ready_step_count"]
        );
        assert_eq!(
            actual_json["data"]["blocked_step_count"],
            expected_json["data"]["blocked_step_count"]
        );

        // Verify bead_steps array
        let actual_bead_steps = actual_json["data"]["bead_steps"].as_array().unwrap();
        let expected_bead_steps = expected_json["data"]["bead_steps"].as_array().unwrap();
        assert_eq!(actual_bead_steps.len(), expected_bead_steps.len());

        // Check first step (complete)
        assert_eq!(
            actual_bead_steps[0]["bead_status"],
            expected_bead_steps[0]["bead_status"]
        );
        assert_eq!(
            actual_bead_steps[0]["commit_hash"],
            expected_bead_steps[0]["commit_hash"]
        );

        // Check second step (ready)
        assert_eq!(
            actual_bead_steps[1]["bead_status"],
            expected_bead_steps[1]["bead_status"]
        );
        assert_eq!(
            actual_bead_steps[1]["task_count"],
            expected_bead_steps[1]["task_count"]
        );

        // Check third step (blocked)
        assert_eq!(
            actual_bead_steps[2]["bead_status"],
            expected_bead_steps[2]["bead_status"]
        );
        assert_eq!(
            actual_bead_steps[2]["blocked_by"],
            expected_bead_steps[2]["blocked_by"]
        );
    }

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

### Step 0: Bootstrap {#step-0}

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
        assert_eq!(actual_json["data"]["mode"], expected_json["data"]["mode"]);
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

    #[test]
    fn test_full_text_output_has_section_headers() {
        // Build minimal StatusData with one complete bead_step
        let bead_step = BeadStepStatus {
            anchor: "#step-0".to_string(),
            title: "Test step".to_string(),
            number: "0".to_string(),
            bead_status: Some("complete".to_string()),
            bead_id: Some("bd-001".to_string()),
            commit_hash: Some("abc123".to_string()),
            commit_summary: Some("feat: test".to_string()),
            close_reason: Some("Committed: abc123 -- feat: test".to_string()),
            task_count: None,
            test_count: None,
            checkpoint_count: None,
            blocked_by: None,
        };

        let status_data = StatusData {
            name: "test".to_string(),
            status: "active".to_string(),
            progress: Progress { done: 1, total: 1 },
            steps: vec![],
            all_steps: None,
            completed_steps: None,
            remaining_steps: None,
            next_step: None,
            bead_mapping: None,
            dependencies: None,
            mode: Some("beads".to_string()),
            plan: Some("test.md".to_string()),
            phase_title: Some("Test Phase".to_string()),
            total_step_count: Some(1),
            completed_step_count: Some(1),
            ready_step_count: Some(0),
            blocked_step_count: Some(0),
            bead_steps: Some(vec![bead_step]),
        };

        // Build details_map with content
        let mut details_map = HashMap::new();
        details_map.insert(
            "#step-0".to_string(),
            IssueDetails {
                id: "bd-001".to_string(),
                title: "Test step".to_string(),
                description: "This is a test description".to_string(),
                status: "closed".to_string(),
                priority: 2,
                issue_type: "task".to_string(),
                dependencies: vec![],
                dependents: vec![],
                design: Some("This is test design content".to_string()),
                acceptance_criteria: Some("Test acceptance".to_string()),
                notes: Some("Test notes".to_string()),
                close_reason: Some("Committed: abc123 -- feat: test".to_string()),
                metadata: None,
            },
        );

        // Test full=true output
        let output = format_beads_text(&status_data, true, &details_map);

        // Verify section headers are present
        assert!(output.contains("--- Description ---"));
        assert!(output.contains("--- Design ---"));
        assert!(output.contains("--- Acceptance Criteria ---"));
        assert!(output.contains("--- Notes ---"));

        // Verify content is included
        assert!(output.contains("This is a test description"));
        assert!(output.contains("This is test design content"));

        // Test full=false output (should not have headers)
        let output_brief = format_beads_text(&status_data, false, &details_map);
        assert!(!output_brief.contains("--- Description ---"));
        assert!(!output_brief.contains("--- Design ---"));
    }
}
