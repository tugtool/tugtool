//! Implementation of the `tug beads update-notes`, `append-notes`, and `append-design` commands

use tugtool_core::{BeadsCli, Config, find_project_root};

use crate::output::{JsonIssue, JsonResponse};

/// Update result data for JSON output
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct UpdateData {
    pub bead_id: String,
    pub operation: String,
    pub success: bool,
}

/// Run the beads update-notes command
pub fn run_update_notes(
    bead_id: String,
    content_file: String,
    working_dir: Option<String>,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    let content_text = std::fs::read_to_string(&content_file)
        .map_err(|e| format!("Failed to read content file {}: {}", content_file, e))?;

    // Convert working_dir to Path if provided
    let working_path = working_dir
        .as_ref()
        .map(|s| std::path::Path::new(s.as_str()));

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
    if !beads.is_installed(working_path) {
        return output_error(
            json_output,
            "E005",
            "beads CLI not installed or not found",
            5,
        );
    }

    // Check if beads is initialized
    let check_path = working_path.unwrap_or(&project_root);
    if !beads.is_initialized(check_path) {
        return output_error(
            json_output,
            "E013",
            "beads not initialized. Run: tugcode worktree create <plan>",
            13,
        );
    }

    // Update notes
    match beads.update_notes(&bead_id, &content_text, working_path) {
        Ok(()) => {
            let data = UpdateData {
                bead_id: bead_id.clone(),
                operation: "update-notes".to_string(),
                success: true,
            };

            if json_output {
                let response = JsonResponse::ok("beads update-notes", data);
                let json = serde_json::to_string_pretty(&response)
                    .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
                println!("{}", json);
            } else if !quiet {
                println!("Updated notes for bead {}", bead_id);
            }

            Ok(0)
        }
        Err(e) => {
            let error_msg = format!("failed to update notes: {}", e);
            output_error(json_output, "E018", &error_msg, 18)
        }
    }
}

/// Run the beads append-notes command
pub fn run_append_notes(
    bead_id: String,
    content_file: String,
    working_dir: Option<String>,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    let content_text = std::fs::read_to_string(&content_file)
        .map_err(|e| format!("Failed to read content file {}: {}", content_file, e))?;

    // Convert working_dir to Path if provided
    let working_path = working_dir
        .as_ref()
        .map(|s| std::path::Path::new(s.as_str()));

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
    if !beads.is_installed(working_path) {
        return output_error(
            json_output,
            "E005",
            "beads CLI not installed or not found",
            5,
        );
    }

    // Check if beads is initialized
    let check_path = working_path.unwrap_or(&project_root);
    if !beads.is_initialized(check_path) {
        return output_error(
            json_output,
            "E013",
            "beads not initialized. Run: tugcode worktree create <plan>",
            13,
        );
    }

    // Append notes
    match beads.append_notes(&bead_id, &content_text, working_path) {
        Ok(()) => {
            let data = UpdateData {
                bead_id: bead_id.clone(),
                operation: "append-notes".to_string(),
                success: true,
            };

            if json_output {
                let response = JsonResponse::ok("beads append-notes", data);
                let json = serde_json::to_string_pretty(&response)
                    .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
                println!("{}", json);
            } else if !quiet {
                println!("Appended notes to bead {}", bead_id);
            }

            Ok(0)
        }
        Err(e) => {
            let error_msg = format!("failed to append notes: {}", e);
            output_error(json_output, "E019", &error_msg, 19)
        }
    }
}

/// Run the beads append-design command
pub fn run_append_design(
    bead_id: String,
    content_file: String,
    working_dir: Option<String>,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
    let content_text = std::fs::read_to_string(&content_file)
        .map_err(|e| format!("Failed to read content file {}: {}", content_file, e))?;

    // Convert working_dir to Path if provided
    let working_path = working_dir
        .as_ref()
        .map(|s| std::path::Path::new(s.as_str()));

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
    if !beads.is_installed(working_path) {
        return output_error(
            json_output,
            "E005",
            "beads CLI not installed or not found",
            5,
        );
    }

    // Check if beads is initialized
    let check_path = working_path.unwrap_or(&project_root);
    if !beads.is_initialized(check_path) {
        return output_error(
            json_output,
            "E013",
            "beads not initialized. Run: tugcode worktree create <plan>",
            13,
        );
    }

    // Append design
    match beads.append_design(&bead_id, &content_text, working_path) {
        Ok(()) => {
            let data = UpdateData {
                bead_id: bead_id.clone(),
                operation: "append-design".to_string(),
                success: true,
            };

            if json_output {
                let response = JsonResponse::ok("beads append-design", data);
                let json = serde_json::to_string_pretty(&response)
                    .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
                println!("{}", json);
            } else if !quiet {
                println!("Appended design to bead {}", bead_id);
            }

            Ok(0)
        }
        Err(e) => {
            let error_msg = format!("failed to append design: {}", e);
            output_error(json_output, "E020", &error_msg, 20)
        }
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
        let data = UpdateData {
            bead_id: String::new(),
            operation: String::new(),
            success: false,
        };
        let response: JsonResponse<UpdateData> = JsonResponse::error("beads update", data, issues);
        let json = serde_json::to_string_pretty(&response)
            .unwrap_or_else(|_| r#"{"error":"Failed to serialize JSON response"}"#.to_string());
        println!("{}", json);
    } else {
        eprintln!("error: {}", message);
    }
    Ok(exit_code)
}
