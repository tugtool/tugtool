//! Implementation of the `tug beads pull` command (Spec S09)

use std::fs;

use tugtool_core::{
    BeadsCli, Config, ResolveResult, find_project_root, find_tugplans, parse_tugplan, resolve_plan,
    tugplan_name_from_path,
};

use crate::output::{JsonIssue, JsonResponse};

/// Pull result data for JSON output
#[derive(Debug, serde::Serialize)]
pub struct PullData {
    pub files: Vec<FilePullResult>,
    pub total_updated: usize,
}

/// Pull result for a single file
#[derive(Debug, serde::Serialize)]
pub struct FilePullResult {
    pub file: String,
    pub name: String,
    pub checkboxes_updated: usize,
    pub steps_updated: Vec<String>,
}

/// Run the beads pull command
pub fn run_pull(
    file: Option<String>,
    no_overwrite: bool,
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
    if !beads.is_installed(Some(&project_root)) {
        return output_error(
            json_output,
            "E005",
            "beads CLI not installed or not found",
            5,
        );
    }

    // Check if beads is initialized
    if !beads.is_initialized(&project_root) {
        return output_error(
            json_output,
            "E013",
            "beads not initialized. Run: tugcode worktree create <plan>",
            13,
        );
    }

    // Get files to process
    let files = match &file {
        Some(f) => {
            let path = match resolve_plan(f, &project_root) {
                Ok(ResolveResult::Found { path, .. }) => path,
                Ok(ResolveResult::NotFound) | Ok(ResolveResult::Ambiguous(_)) => {
                    return output_error(json_output, "E002", &format!("file not found: {}", f), 2);
                }
                Err(e) => {
                    return output_error(
                        json_output,
                        e.code(),
                        &format!("Resolution failed: {}", e),
                        e.exit_code(),
                    );
                }
            };
            vec![path]
        }
        None => find_tugplans(&project_root).unwrap_or_default(),
    };

    let mut all_results: Vec<FilePullResult> = Vec::new();
    let mut total_updated = 0;

    for path in files {
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let tugplan = match parse_tugplan(&content) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let (updated_content, checkboxes_updated, steps_updated) =
            pull_bead_status_to_checkboxes(&tugplan, &content, &beads, &config, no_overwrite);

        if checkboxes_updated > 0 {
            // Write updated content back to file
            if let Err(e) = fs::write(&path, &updated_content) {
                if !quiet {
                    eprintln!("warning: failed to write {}: {}", path.display(), e);
                }
                continue;
            }
        }

        let name = tugplan_name_from_path(&path).unwrap_or_else(|| "unknown".to_string());
        total_updated += checkboxes_updated;

        all_results.push(FilePullResult {
            file: path.to_string_lossy().to_string(),
            name,
            checkboxes_updated,
            steps_updated,
        });
    }

    // Output results
    if json_output {
        let data = PullData {
            files: all_results,
            total_updated,
        };
        let response = JsonResponse::ok("beads pull", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        for result in &all_results {
            if result.checkboxes_updated > 0 {
                println!(
                    "{}: {} checkboxes updated",
                    result.name, result.checkboxes_updated
                );
                for step in &result.steps_updated {
                    println!("  {} - marked complete", step);
                }
            }
        }
        if total_updated == 0 {
            println!("No checkboxes updated (all in sync)");
        }
    }

    Ok(0)
}

/// Resolve beads for a plan using title-based matching
fn resolve_beads_for_pull(
    plan: &tugtool_core::TugPlan,
    beads: &BeadsCli,
) -> std::collections::HashMap<String, String> {
    let mut anchor_to_bead: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    // Find root bead by phase title
    let phase_title = plan
        .phase_title
        .as_ref()
        .map(|s| s.as_str())
        .unwrap_or("Untitled plan");

    let root_id = match beads.find_by_title(phase_title, None, None) {
        Ok(Some(issue)) => issue.id,
        _ => return anchor_to_bead, // No root bead, return empty map
    };

    // Resolve each step bead by title
    for step in &plan.steps {
        let title = format!("Step {}: {}", step.number, step.title);
        if let Ok(Some(issue)) = beads.find_by_title(&title, Some(&root_id), None) {
            anchor_to_bead.insert(step.anchor.clone(), issue.id.clone());

            // Resolve substeps
            for substep in &step.substeps {
                let sub_title = format!("Step {}: {}", substep.number, substep.title);
                if let Ok(Some(sub_issue)) = beads.find_by_title(&sub_title, Some(&issue.id), None)
                {
                    anchor_to_bead.insert(substep.anchor.clone(), sub_issue.id);
                }
            }
        }
    }

    anchor_to_bead
}

/// Pull bead status to checkboxes
fn pull_bead_status_to_checkboxes(
    tugplan: &tugtool_core::TugPlan,
    content: &str,
    beads: &BeadsCli,
    config: &Config,
    no_overwrite: bool,
) -> (String, usize, Vec<String>) {
    let mut updated_content = content.to_string();
    let mut checkboxes_updated = 0;
    let mut steps_updated: Vec<String> = Vec::new();

    let checkbox_mode = &config.tugtool.beads.pull_checkbox_mode;

    // Resolve all beads by title
    let anchor_to_bead = resolve_beads_for_pull(tugplan, beads);

    for step in &tugplan.steps {
        if let Some(bead_id) = anchor_to_bead.get(&step.anchor) {
            // Check if bead is complete
            if is_bead_complete(bead_id, beads) {
                // Update checkboxes for this step
                let (new_content, count) = mark_step_checkboxes_complete(
                    &updated_content,
                    step.line,
                    &step.anchor,
                    checkbox_mode,
                    no_overwrite,
                );
                if count > 0 {
                    updated_content = new_content;
                    checkboxes_updated += count;
                    steps_updated.push(format!("Step {}: {}", step.number, step.title));
                }
            }
        }

        // Process substeps
        for substep in &step.substeps {
            if let Some(bead_id) = anchor_to_bead.get(&substep.anchor) {
                if is_bead_complete(bead_id, beads) {
                    let (new_content, count) = mark_step_checkboxes_complete(
                        &updated_content,
                        substep.line,
                        &substep.anchor,
                        checkbox_mode,
                        no_overwrite,
                    );
                    if count > 0 {
                        updated_content = new_content;
                        checkboxes_updated += count;
                        steps_updated.push(format!("Step {}: {}", substep.number, substep.title));
                    }
                }
            }
        }
    }

    (updated_content, checkboxes_updated, steps_updated)
}

/// Check if a bead is complete (closed)
fn is_bead_complete(bead_id: &str, beads: &BeadsCli) -> bool {
    match beads.show(bead_id, None) {
        Ok(details) => details.status.to_lowercase() == "closed",
        Err(_) => false,
    }
}

/// Mark checkboxes as complete for a step
fn mark_step_checkboxes_complete(
    content: &str,
    step_line: usize,
    step_anchor: &str,
    checkbox_mode: &str,
    no_overwrite: bool,
) -> (String, usize) {
    let lines: Vec<&str> = content.lines().collect();
    let mut new_lines: Vec<String> = Vec::new();
    let mut count = 0;

    let checkbox_pattern = regex::Regex::new(r"^(\s*-\s+)\[ \](.*)$").unwrap();
    let checked_pattern = regex::Regex::new(r"^(\s*-\s+)\[[xX]\](.*)$").unwrap();

    let mut in_target_step = false;
    let mut in_checkpoint_section = false;
    let mut past_step = false;

    for (i, line) in lines.iter().enumerate() {
        let line_num = i + 1;

        // Check if we've entered the target step
        if line.contains(&format!("{{#{}}}", step_anchor)) || line_num == step_line {
            in_target_step = true;
            past_step = false;
        }

        // Check if we've exited the step (next step header or section divider)
        if in_target_step
            && past_step
            && (line.starts_with("####") || line.starts_with("#####") || line.starts_with("---"))
        {
            in_target_step = false;
        }

        if in_target_step
            && !line.contains(&format!("{{#{}}}", step_anchor))
            && line_num != step_line
        {
            past_step = true;
        }

        // Track section context
        if in_target_step {
            if line.starts_with("**Checkpoint:**") || line.starts_with("**Checkpoints:**") {
                in_checkpoint_section = true;
            } else if line.starts_with("**Tasks:**") || line.starts_with("**Tests:**") {
                in_checkpoint_section = checkbox_mode == "all";
            } else if line.starts_with("**") && !line.starts_with("**Bead:**") {
                // Other bold sections reset checkpoint context
                if !line.contains("Checkpoint")
                    && !line.contains("Tasks")
                    && !line.contains("Tests")
                {
                    in_checkpoint_section = false;
                }
            }
        }

        // Update checkboxes
        if in_target_step && (in_checkpoint_section || checkbox_mode == "all") {
            if checkbox_pattern.is_match(line) {
                // Unchecked checkbox - mark as complete
                let new_line = checkbox_pattern.replace(line, "$1[x]$2").to_string();
                new_lines.push(new_line);
                count += 1;
                continue;
            } else if no_overwrite && checked_pattern.is_match(line) {
                // Already checked and no_overwrite - keep as is
                new_lines.push(line.to_string());
                continue;
            }
        }

        new_lines.push(line.to_string());
    }

    (new_lines.join("\n"), count)
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
        let response: JsonResponse<PullData> = JsonResponse::error(
            "beads pull",
            PullData {
                files: vec![],
                total_updated: 0,
            },
            issues,
        );
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else {
        eprintln!("error: {}", message);
    }
    Ok(exit_code)
}
