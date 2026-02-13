//! Implementation of the `tug beads status` command (Spec S08)

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use tugtool_core::{
    BeadStatus, BeadsCli, Config, TugPlan, find_project_root, find_tugplans, parse_tugplan,
    tugplan_name_from_path,
};

use crate::output::{JsonIssue, JsonResponse};

/// Status result data for JSON output
#[derive(Debug, serde::Serialize)]
pub struct BeadsStatusData {
    pub files: Vec<FileBeadsStatus>,
}

/// Status for a single file
#[derive(Debug, serde::Serialize)]
pub struct FileBeadsStatus {
    pub file: String,
    pub name: String,
    pub root_bead_id: Option<String>,
    pub steps_complete: usize,
    pub steps_total: usize,
    pub steps: Vec<StepBeadsStatus>,
}

/// Status for a single step
#[derive(Debug, serde::Serialize)]
pub struct StepBeadsStatus {
    pub anchor: String,
    pub title: String,
    pub bead_id: Option<String>,
    pub status: String,
    pub blocked_by: Vec<String>,
}

/// Run the beads status command
pub fn run_beads_status(
    file: Option<String>,
    do_pull: bool,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Find project root
    let project_root = match find_project_root() {
        Ok(root) => root,
        Err(_) => {
            return output_error(json_output, "E009", ".tug directory not initialized", 9);
        }
    };

    // Load config
    let config = Config::load_from_project(&project_root).unwrap_or_default();
    let bd_path =
        std::env::var("TUG_BD_PATH").unwrap_or_else(|_| config.tugtool.beads.bd_path.clone());
    let beads = BeadsCli::new(bd_path);

    // Check if beads CLI is installed
    if !beads.is_installed(None) {
        return output_error(
            json_output,
            "E005",
            "beads CLI not installed or not found",
            5,
        );
    }

    // Get files to process
    let files = match &file {
        Some(f) => {
            let path = resolve_file_path(&project_root, f);
            if !path.exists() {
                return output_error(json_output, "E002", &format!("file not found: {}", f), 2);
            }
            vec![path]
        }
        None => find_tugplans(&project_root).unwrap_or_default(),
    };

    let mut all_status: Vec<FileBeadsStatus> = Vec::new();

    for path in files {
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let plan = match parse_tugplan(&content) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let file_status = get_file_beads_status(&path, &plan, &beads);
        all_status.push(file_status);
    }

    // If --pull flag is set, also run pull
    if do_pull {
        // Delegate to pull command
        let pull_file = file.clone();
        crate::commands::beads::pull::run_pull(pull_file, false, json_output, true)?;
    }

    // Output results
    if json_output {
        let data = BeadsStatusData { files: all_status };
        let response = JsonResponse::ok("beads status", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        for file_status in &all_status {
            println!(
                "{}: {}/{} steps complete",
                file_status.name, file_status.steps_complete, file_status.steps_total
            );
            println!();

            for step in &file_status.steps {
                let check = if step.status == "complete" {
                    "[x]"
                } else {
                    "[ ]"
                };

                let bead_info = step
                    .bead_id
                    .as_ref()
                    .map(|id| format!("({})", id))
                    .unwrap_or_else(|| "(no bead)".to_string());

                let blocked_info = if !step.blocked_by.is_empty() {
                    format!(" <- waiting on {}", step.blocked_by.join(", "))
                } else {
                    String::new()
                };

                println!(
                    "{:<50} {} {:<10} {}{}",
                    step.title, check, step.status, bead_info, blocked_info
                );
            }
            println!();
        }
    }

    Ok(0)
}

/// Get beads status for a file
fn get_file_beads_status(path: &Path, plan: &TugPlan, beads: &BeadsCli) -> FileBeadsStatus {
    let name = tugplan_name_from_path(path).unwrap_or_else(|| "unknown".to_string());
    let file = path.to_string_lossy().to_string();

    // Build map of anchor -> bead status
    let mut bead_statuses: HashMap<String, (String, bool)> = HashMap::new(); // anchor -> (bead_id, is_complete)

    // First pass: get bead statuses
    for step in &plan.steps {
        if let Some(ref bead_id) = step.bead_id {
            let is_complete = check_bead_complete(bead_id, beads);
            bead_statuses.insert(step.anchor.clone(), (bead_id.clone(), is_complete));
        }

        for substep in &step.substeps {
            if let Some(ref bead_id) = substep.bead_id {
                let is_complete = check_bead_complete(bead_id, beads);
                bead_statuses.insert(substep.anchor.clone(), (bead_id.clone(), is_complete));
            }
        }
    }

    // Second pass: compute status for each step
    let mut steps_status: Vec<StepBeadsStatus> = Vec::new();
    let mut steps_complete = 0;
    let mut steps_total = 0;

    for step in &plan.steps {
        let status = compute_step_status(
            &step.anchor,
            &step.depends_on,
            &bead_statuses,
            &step.bead_id,
        );
        let blocked_by = get_blocked_by(&step.depends_on, &bead_statuses);

        if status == BeadStatus::Complete {
            steps_complete += 1;
        }
        steps_total += 1;

        steps_status.push(StepBeadsStatus {
            anchor: step.anchor.clone(),
            title: format!("Step {}: {}", step.number, step.title),
            bead_id: step.bead_id.clone(),
            status: status.to_string(),
            blocked_by,
        });

        // Add substeps
        for substep in &step.substeps {
            let sub_status = compute_step_status(
                &substep.anchor,
                &substep.depends_on,
                &bead_statuses,
                &substep.bead_id,
            );
            let sub_blocked_by = get_blocked_by(&substep.depends_on, &bead_statuses);

            if sub_status == BeadStatus::Complete {
                steps_complete += 1;
            }
            steps_total += 1;

            steps_status.push(StepBeadsStatus {
                anchor: substep.anchor.clone(),
                title: format!("  Step {}: {}", substep.number, substep.title),
                bead_id: substep.bead_id.clone(),
                status: sub_status.to_string(),
                blocked_by: sub_blocked_by,
            });
        }
    }

    FileBeadsStatus {
        file,
        name,
        root_bead_id: plan.metadata.beads_root_id.clone(),
        steps_complete,
        steps_total,
        steps: steps_status,
    }
}

/// Check if a bead is complete
fn check_bead_complete(bead_id: &str, beads: &BeadsCli) -> bool {
    match beads.show(bead_id, None) {
        Ok(details) => details.status.to_lowercase() == "closed",
        Err(_) => false,
    }
}

/// Compute status for a step based on its bead and dependencies
fn compute_step_status(
    _anchor: &str,
    depends_on: &[String],
    bead_statuses: &HashMap<String, (String, bool)>,
    bead_id: &Option<String>,
) -> BeadStatus {
    // No bead linked -> pending
    if bead_id.is_none() {
        return BeadStatus::Pending;
    }

    // Check if this bead is complete
    if let Some((_, is_complete)) = bead_statuses.get(_anchor) {
        if *is_complete {
            return BeadStatus::Complete;
        }
    }

    // Check dependencies
    let all_deps_complete = depends_on.iter().all(|dep| {
        bead_statuses
            .get(dep)
            .map(|(_, complete)| *complete)
            .unwrap_or(false)
    });

    if all_deps_complete {
        BeadStatus::Ready
    } else {
        BeadStatus::Blocked
    }
}

/// Get list of blocking dependencies
fn get_blocked_by(
    depends_on: &[String],
    bead_statuses: &HashMap<String, (String, bool)>,
) -> Vec<String> {
    depends_on
        .iter()
        .filter(|dep| {
            bead_statuses
                .get(*dep)
                .map(|(_, complete)| !*complete)
                .unwrap_or(true)
        })
        .filter_map(|dep| bead_statuses.get(dep).map(|(id, _)| id.clone()))
        .collect()
}

/// Resolve file path relative to project
fn resolve_file_path(project_root: &Path, file: &str) -> std::path::PathBuf {
    let path = Path::new(file);
    if path.is_absolute() {
        path.to_path_buf()
    } else if file.starts_with(".tugtool/") || file.starts_with(".tugtool\\") {
        project_root.join(file)
    } else if file.starts_with("tugplan-") && file.ends_with(".md") {
        project_root.join(".tugtool").join(file)
    } else if file.ends_with(".md") {
        let as_is = project_root.join(file);
        if as_is.exists() {
            as_is
        } else {
            project_root.join(".tugtool").join(format!("tugplan-{}", file))
        }
    } else {
        project_root.join(".tugtool").join(format!("tugplan-{}.md", file))
    }
}

/// Output an error in JSON or text format
fn output_error(
    json_output: bool,
    code: &str,
    message: &str,
    exit_code: i32,
) -> Result<i32, String> {
    if json_output {
        let issues = vec![JsonIssue {
            code: code.to_string(),
            severity: "error".to_string(),
            message: message.to_string(),
            file: None,
            line: None,
            anchor: None,
        }];
        let response: JsonResponse<BeadsStatusData> =
            JsonResponse::error("beads status", BeadsStatusData { files: vec![] }, issues);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else {
        eprintln!("error: {}", message);
    }
    Ok(exit_code)
}
