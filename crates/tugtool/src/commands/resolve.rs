//! Resolve command implementation

use tugtool_core::{find_project_root, resolve_plan, ResolveResult, ResolveStage, TugError, tugplan_name_from_path};
use crate::output::{JsonIssue, JsonResponse, ResolveData};

/// Map ResolveStage enum to lowercase string for JSON output
fn stage_to_str(stage: ResolveStage) -> &'static str {
    match stage {
        ResolveStage::Exact => "exact",
        ResolveStage::Filename => "filename",
        ResolveStage::Slug => "slug",
        ResolveStage::Prefix => "prefix",
        ResolveStage::Auto => "auto",
    }
}

/// Run the resolve command
///
/// Resolves a plan identifier to a file path using the five-stage cascade.
pub fn run_resolve(identifier: Option<String>, json_output: bool, quiet: bool) -> Result<i32, String> {
    // Find project root
    let project_root = match find_project_root() {
        Ok(root) => root,
        Err(TugError::NotInitialized) => {
            if json_output {
                let data = ResolveData {
                    path: None,
                    slug: None,
                    stage: None,
                    candidates: Some(vec![]),
                };
                let issues = vec![JsonIssue {
                    code: "E009".to_string(),
                    severity: "error".to_string(),
                    message: ".tugtool directory not initialized (run 'tugtool init')".to_string(),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response = JsonResponse::error("resolve", data, issues);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: .tugtool directory not initialized (run 'tugtool init')");
            }
            return Ok(9);
        }
        Err(e) => {
            if json_output {
                let data = ResolveData {
                    path: None,
                    slug: None,
                    stage: None,
                    candidates: Some(vec![]),
                };
                let issues = vec![JsonIssue {
                    code: "E002".to_string(),
                    severity: "error".to_string(),
                    message: format!("Failed to find project root: {}", e),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response = JsonResponse::error("resolve", data, issues);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: failed to find project root: {}", e);
            }
            return Ok(2);
        }
    };

    // Get input (empty string if None)
    let input = identifier.as_deref().unwrap_or("");

    // Call resolve_plan
    let result = match resolve_plan(input, &project_root) {
        Ok(r) => r,
        Err(TugError::NotInitialized) => {
            if json_output {
                let data = ResolveData {
                    path: None,
                    slug: None,
                    stage: None,
                    candidates: Some(vec![]),
                };
                let issues = vec![JsonIssue {
                    code: "E009".to_string(),
                    severity: "error".to_string(),
                    message: ".tugtool directory not initialized (run 'tugtool init')".to_string(),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response = JsonResponse::error("resolve", data, issues);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: .tugtool directory not initialized (run 'tugtool init')");
            }
            return Ok(9);
        }
        Err(e) => {
            if json_output {
                let data = ResolveData {
                    path: None,
                    slug: None,
                    stage: None,
                    candidates: Some(vec![]),
                };
                let issues = vec![JsonIssue {
                    code: "E002".to_string(),
                    severity: "error".to_string(),
                    message: format!("Resolution failed: {}", e),
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response = JsonResponse::error("resolve", data, issues);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else {
                eprintln!("error: resolution failed: {}", e);
            }
            return Ok(2);
        }
    };

    // Handle result variants
    match result {
        ResolveResult::Found { path, stage } => {
            // Extract slug from path
            let slug = tugplan_name_from_path(&path);

            // Convert to relative path (strip project_root prefix if present)
            let relative_path = path
                .strip_prefix(&project_root)
                .unwrap_or(&path)
                .display()
                .to_string();

            if json_output {
                let data = ResolveData {
                    path: Some(relative_path.clone()),
                    slug,
                    stage: Some(stage_to_str(stage).to_string()),
                    candidates: None,
                };
                let response = JsonResponse::ok("resolve", data);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else if !quiet {
                println!("{} (via {})", relative_path, stage_to_str(stage));
            } else {
                println!("{}", relative_path);
            }
            Ok(0)
        }

        ResolveResult::NotFound => {
            if json_output {
                let data = ResolveData {
                    path: None,
                    slug: None,
                    stage: None,
                    candidates: Some(vec![]),
                };
                let issues = vec![JsonIssue {
                    code: "E041".to_string(),
                    severity: "error".to_string(),
                    message: if input.is_empty() {
                        "No plans found".to_string()
                    } else {
                        format!("No plan found matching '{}'", input)
                    },
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response = JsonResponse::error("resolve", data, issues);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else if input.is_empty() {
                eprintln!("error: no plans found");
            } else {
                eprintln!("error: no plan found matching '{}'", input);
            }
            Ok(1)
        }

        ResolveResult::Ambiguous(candidates) => {
            // Convert candidates to relative paths
            let relative_candidates: Vec<String> = candidates
                .iter()
                .map(|path| {
                    path.strip_prefix(&project_root)
                        .unwrap_or(path)
                        .display()
                        .to_string()
                })
                .collect();

            if json_output {
                let data = ResolveData {
                    path: None,
                    slug: None,
                    stage: None,
                    candidates: Some(relative_candidates.clone()),
                };
                let issues = vec![JsonIssue {
                    code: "E040".to_string(),
                    severity: "error".to_string(),
                    message: if input.is_empty() {
                        format!("Ambiguous: {} plans found", relative_candidates.len())
                    } else {
                        format!("Ambiguous plan identifier '{}': matches {} plans", input, relative_candidates.len())
                    },
                    file: None,
                    line: None,
                    anchor: None,
                }];
                let response = JsonResponse::error("resolve", data, issues);
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
            } else if input.is_empty() {
                eprintln!("error: ambiguous: {} plans found", relative_candidates.len());
                eprintln!("Candidates:");
                for candidate in &relative_candidates {
                    eprintln!("  {}", candidate);
                }
            } else {
                eprintln!("error: ambiguous plan identifier '{}': matches {} plans", input, relative_candidates.len());
                eprintln!("Candidates:");
                for candidate in &relative_candidates {
                    eprintln!("  {}", candidate);
                }
            }
            Ok(1)
        }
    }
}
