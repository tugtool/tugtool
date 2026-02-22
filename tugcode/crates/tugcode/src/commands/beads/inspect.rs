//! Implementation of the `tug beads inspect` command

use tugtool_core::{BeadsCli, Config, find_project_root};

use crate::output::{JsonIssue, JsonResponse};

/// Inspect result data for JSON output
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct InspectData {
    pub bead_id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: i32,
    pub issue_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub design: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptance_criteria: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// Run the beads inspect command
pub fn run_inspect(
    bead_id: String,
    working_dir: Option<String>,
    json_output: bool,
    quiet: bool,
) -> Result<i32, String> {
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

    // Show the bead
    match beads.show(&bead_id, working_path) {
        Ok(details) => {
            let data = InspectData {
                bead_id: details.id.clone(),
                title: details.title.clone(),
                description: details.description.clone(),
                status: details.status.clone(),
                priority: details.priority,
                issue_type: details.issue_type.clone(),
                design: details.design.clone(),
                acceptance_criteria: details.acceptance_criteria.clone(),
                notes: details.notes.clone(),
                close_reason: details.close_reason.clone(),
                metadata: details.metadata.clone(),
            };

            if json_output {
                let response = JsonResponse::ok("beads inspect", data);
                let json = serde_json::to_string_pretty(&response)
                    .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
                println!("{}", json);
            } else if !quiet {
                println!("Bead: {}", details.id);
                println!("Title: {}", details.title);
                println!("Status: {}", details.status);
                println!("Priority: {}", details.priority);
                println!("Type: {}", details.issue_type);
                println!();

                if !details.description.is_empty() {
                    println!("Description:");
                    println!("{}", details.description);
                    println!();
                }

                if let Some(design) = &details.design {
                    println!("Design:");
                    println!("{}", design);
                    println!();
                }

                if let Some(acceptance) = &details.acceptance_criteria {
                    println!("Acceptance Criteria:");
                    println!("{}", acceptance);
                    println!();
                }

                if let Some(notes) = &details.notes {
                    println!("Notes:");
                    println!("{}", notes);
                    println!();
                }

                if let Some(reason) = &details.close_reason {
                    println!("Close Reason:");
                    println!("{}", reason);
                    println!();
                }

                if let Some(metadata) = &details.metadata {
                    println!("Metadata:");
                    println!(
                        "{}",
                        serde_json::to_string_pretty(metadata).unwrap_or_else(|_| "{}".to_string())
                    );
                }
            }

            Ok(0)
        }
        Err(e) => {
            let error_msg = format!("failed to inspect bead: {}", e);
            output_error(json_output, "E017", &error_msg, 17)
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
        let data = InspectData {
            bead_id: String::new(),
            title: String::new(),
            description: String::new(),
            status: String::new(),
            priority: 0,
            issue_type: String::new(),
            design: None,
            acceptance_criteria: None,
            notes: None,
            close_reason: None,
            metadata: None,
        };
        let response: JsonResponse<InspectData> =
            JsonResponse::error("beads inspect", data, issues);
        let json = serde_json::to_string_pretty(&response)
            .unwrap_or_else(|_| r#"{"error":"Failed to serialize JSON response"}"#.to_string());
        println!("{}", json);
    } else {
        eprintln!("error: {}", message);
    }
    Ok(exit_code)
}
