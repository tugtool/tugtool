//! Implementation of the `tug list` command (Spec S03)

use std::fs;
use std::path::Path;

use tugtool_core::{
    TugPlan, find_project_root, find_tugplans, parse_tugplan, tugplan_name_from_path,
};

use crate::output::{JsonIssue, JsonResponse, ListData, PlanSummary, Progress};

/// Run the list command
pub fn run_list(
    status_filter: Option<String>,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Find project root
    let project_root = match find_project_root() {
        Ok(root) => root,
        Err(_) => {
            let message = ".tug directory not initialized".to_string();
            if json_output {
                let issues = vec![JsonIssue {
                    code: "E009".to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<ListData> =
                    JsonResponse::error("list", ListData { plans: vec![] }, issues);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(9); // E009 exit code
        }
    };

    // Find all plan files
    let plan_files = match find_tugplans(&project_root) {
        Ok(files) => files,
        Err(e) => {
            let message = format!("failed to find plans: {}", e);
            if json_output {
                let issues = vec![JsonIssue {
                    code: "E009".to_string(),
                    severity: "error".to_string(),
                    message: message.clone(),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response: JsonResponse<ListData> =
                    JsonResponse::error("list", ListData { plans: vec![] }, issues);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: {}", message);
            }
            return Ok(9);
        }
    };

    // Parse and collect plan summaries
    let mut summaries: Vec<PlanSummary> = Vec::new();

    for path in &plan_files {
        if let Some(summary) = parse_tugplan_summary(path) {
            // Apply status filter if specified
            if let Some(ref filter) = status_filter {
                if !summary.status.eq_ignore_ascii_case(filter) {
                    continue;
                }
            }
            summaries.push(summary);
        }
    }

    if json_output {
        let response = JsonResponse::ok("list", ListData { plans: summaries });
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        if summaries.is_empty() {
            println!("No plans found");
        } else {
            output_table(&summaries);
        }
    }

    Ok(0)
}

/// Parse a plan file and return a summary
fn parse_tugplan_summary(path: &Path) -> Option<PlanSummary> {
    let content = fs::read_to_string(path).ok()?;
    let tugplan = parse_tugplan(&content).ok()?;
    let name = tugplan_name_from_path(path)?;

    let (done, total) = count_checkboxes(&tugplan);
    let status = tugplan
        .metadata
        .status
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let updated = tugplan
        .metadata
        .last_updated
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    Some(PlanSummary {
        name,
        status,
        progress: Progress { done, total },
        updated,
    })
}

/// Count completed and total checkboxes in execution steps
fn count_checkboxes(tugplan: &TugPlan) -> (usize, usize) {
    let mut done = 0;
    let mut total = 0;

    for step in &tugplan.steps {
        total += step.total_items();
        done += step.completed_items();

        // Count substeps
        for substep in &step.substeps {
            total += substep.total_items();
            done += substep.completed_items();
        }
    }

    (done, total)
}

/// Output a formatted table
fn output_table(summaries: &[PlanSummary]) {
    // Calculate column widths
    let name_width = summaries
        .iter()
        .map(|s| s.name.len())
        .max()
        .unwrap_or(5)
        .max(5);
    let status_width = summaries
        .iter()
        .map(|s| s.status.len())
        .max()
        .unwrap_or(6)
        .max(6);

    // Print header
    println!(
        "{:<name_width$}  {:<status_width$}  {:>10}  {:>10}",
        "PLAN",
        "STATUS",
        "PROGRESS",
        "UPDATED",
        name_width = name_width,
        status_width = status_width
    );

    // Print rows
    for summary in summaries {
        let progress = format!("{}/{}", summary.progress.done, summary.progress.total);
        println!(
            "{:<name_width$}  {:<status_width$}  {:>10}  {:>10}",
            summary.name,
            summary.status,
            progress,
            summary.updated,
            name_width = name_width,
            status_width = status_width
        );
    }
}
