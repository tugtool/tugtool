//! Implementation of the `tug beads link` command (Spec S07)

use std::fs;

use tugtool_core::{
    BeadsCli, Config, ResolveResult, find_project_root, is_valid_bead_id, parse_tugplan,
    resolve_plan,
};

use crate::output::{JsonIssue, JsonResponse};

/// Link result data for JSON output
#[derive(Debug, serde::Serialize)]
pub struct LinkData {
    pub file: String,
    pub step_anchor: String,
    pub bead_id: String,
    pub linked: bool,
}

/// Run the beads link command
pub fn run_link(
    file: String,
    step_anchor: String,
    bead_id: String,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Find project root
    let project_root = match find_project_root() {
        Ok(root) => root,
        Err(_) => {
            return output_error(
                json_output,
                "E009",
                ".tug directory not initialized",
                &file,
                &step_anchor,
                &bead_id,
                9,
            );
        }
    };

    // Load config
    let config = Config::load_from_project(&project_root).unwrap_or_default();
    let bd_path =
        std::env::var("TUG_BD_PATH").unwrap_or_else(|_| config.tugtool.beads.bd_path.clone());

    // Validate bead ID format
    if !is_valid_bead_id(&bead_id) {
        return output_error(
            json_output,
            "E012",
            &format!("invalid bead ID format: {}", bead_id),
            &file,
            &step_anchor,
            &bead_id,
            1,
        );
    }

    // Check beads is installed and initialized (unconditional)
    let beads = BeadsCli::new(bd_path);
    if !beads.is_installed(None) {
        return output_error(
            json_output,
            "E005",
            "beads CLI not installed or not found",
            &file,
            &step_anchor,
            &bead_id,
            5,
        );
    }
    if !beads.is_initialized(&project_root) {
        return output_error(
            json_output,
            "E013",
            "beads not initialized. Run: tugcode worktree create <plan>",
            &file,
            &step_anchor,
            &bead_id,
            13,
        );
    }

    // If beads validation is enabled, verify bead exists
    if config.tugtool.beads.enabled && config.tugtool.beads.validate_bead_ids {
        if !beads.bead_exists(&bead_id, None)
        {
            return output_error(
                json_output,
                "E015",
                &format!("bead not found: {}", bead_id),
                &file,
                &step_anchor,
                &bead_id,
                1,
            );
        }
    }

    // Resolve file path
    let path = match resolve_plan(&file, &project_root) {
        Ok(ResolveResult::Found { path, .. }) => path,
        Ok(ResolveResult::NotFound) | Ok(ResolveResult::Ambiguous(_)) => {
            return output_error(
                json_output,
                "E002",
                &format!("file not found: {}", file),
                &file,
                &step_anchor,
                &bead_id,
                2,
            );
        }
        Err(e) => {
            return output_error(
                json_output,
                e.code(),
                &format!("Resolution failed: {}", e),
                &file,
                &step_anchor,
                &bead_id,
                e.exit_code(),
            );
        }
    };

    // Read and parse the plan
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            return output_error(
                json_output,
                "E002",
                &format!("failed to read file: {}", e),
                &file,
                &step_anchor,
                &bead_id,
                2,
            );
        }
    };

    let tugplan = match parse_tugplan(&content) {
        Ok(s) => s,
        Err(e) => {
            return output_error(
                json_output,
                "E001",
                &format!("failed to parse plan: {}", e),
                &file,
                &step_anchor,
                &bead_id,
                1,
            );
        }
    };

    // Find the step with the given anchor
    let step_info = find_step_by_anchor(&tugplan, &step_anchor);
    if step_info.is_none() {
        return output_error(
            json_output,
            "E017",
            &format!("step anchor not found: {}", step_anchor),
            &file,
            &step_anchor,
            &bead_id,
            2,
        );
    }

    let (step_line, _is_substep) = step_info.unwrap();

    // Write bead ID to the step
    let updated_content = write_bead_to_step(&content, &step_anchor, step_line, &bead_id);

    // Write back to file
    if let Err(e) = fs::write(&path, &updated_content) {
        return output_error(
            json_output,
            "E002",
            &format!("failed to write file: {}", e),
            &file,
            &step_anchor,
            &bead_id,
            1,
        );
    }

    if json_output {
        let data = LinkData {
            file: file.clone(),
            step_anchor: step_anchor.clone(),
            bead_id: bead_id.clone(),
            linked: true,
        };
        let response = JsonResponse::ok("beads link", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!(
            "Linked bead {} to step #{} in {}",
            bead_id, step_anchor, file
        );
    }

    Ok(0)
}

/// Find a step by its anchor, returning (line_number, is_substep)
fn find_step_by_anchor(tugplan: &tugtool_core::TugPlan, anchor: &str) -> Option<(usize, bool)> {
    // Check main steps
    for step in &tugplan.steps {
        if step.anchor == anchor {
            return Some((step.line, false));
        }
        // Check substeps
        for substep in &step.substeps {
            if substep.anchor == anchor {
                return Some((substep.line, true));
            }
        }
    }
    None
}

/// Write bead ID to a step in content
fn write_bead_to_step(content: &str, anchor: &str, step_line: usize, bead_id: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut new_lines: Vec<String> = Vec::new();
    let bead_line = format!("**Bead:** `{}`", bead_id);
    let bead_pattern = regex::Regex::new(r"^\*\*Bead:\*\*\s*`[^`]*`").unwrap();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        new_lines.push(line.to_string());

        // Check if this line contains the step anchor or is at step line
        if line.contains(&format!("{{#{}}}", anchor)) || (i + 1 == step_line) {
            let mut found_bead = false;
            let mut insert_before_commit = None;
            let mut depends_on_line = None;

            // Look at next lines
            for (j, next_line) in lines
                .iter()
                .enumerate()
                .take(std::cmp::min(i + 20, lines.len()))
                .skip(i + 1)
            {
                // Track **Depends on:** line
                if next_line.starts_with("**Depends on:**") {
                    depends_on_line = Some(j);
                }

                // Check if bead line already exists
                if bead_pattern.is_match(next_line) {
                    // Skip the old bead line, we'll insert new one
                    found_bead = true;
                    // Continue from here
                    i = j;
                    new_lines.push(bead_line.clone());
                    break;
                }

                // Check for **Commit:**
                if next_line.starts_with("**Commit:**") {
                    insert_before_commit = Some(j);
                    break;
                }

                // Check for next step/section header
                if next_line.starts_with("####")
                    || next_line.starts_with("#####")
                    || next_line.starts_with("---")
                {
                    insert_before_commit = Some(j);
                    break;
                }
            }

            if !found_bead {
                if let Some(pos) = insert_before_commit {
                    // Copy lines from after step header to insert position
                    let insert_after = depends_on_line.unwrap_or(i);
                    for line in lines.iter().take(insert_after + 1).skip(i + 1) {
                        new_lines.push(line.to_string());
                    }
                    // Insert bead line after Depends on (or after header)
                    new_lines.push(String::new());
                    new_lines.push(bead_line.clone());
                    // Continue with remaining lines before Commit
                    for line in lines.iter().take(pos).skip(insert_after + 1) {
                        if !bead_pattern.is_match(line) {
                            new_lines.push(line.to_string());
                        }
                    }
                    i = pos - 1;
                }
            }
        }

        i += 1;
    }

    new_lines.join("\n")
}

/// Output an error in JSON or text format
fn output_error(
    json_output: bool,
    code: &str,
    message: &str,
    file: &str,
    step_anchor: &str,
    bead_id: &str,
    exit_code: i32,
) -> Result<i32, String> {
    if json_output {
        let issues = vec![JsonIssue {
            code: code.to_string(),
            severity: "error".to_string(),
            message: message.to_string(),
            file: Some(file.to_string()),
            line: None,
            anchor: Some(step_anchor.to_string()),
        }];
        let response: JsonResponse<LinkData> = JsonResponse::error(
            "beads link",
            LinkData {
                file: file.to_string(),
                step_anchor: step_anchor.to_string(),
                bead_id: bead_id.to_string(),
                linked: false,
            },
            issues,
        );
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else {
        eprintln!("error: {}", message);
    }
    Ok(exit_code)
}
