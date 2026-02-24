//! Implementation of the `tug init` command (Spec S01)

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use crate::output::{InitCheckData, InitData, JsonResponse};

/// Embedded skeleton content
const SKELETON_CONTENT: &str = include_str!("../../../../../.tugtool/tugplan-skeleton.md");

/// Default config.toml content
const DEFAULT_CONFIG: &str = r#"[tugtool]
# Validation strictness: "lenient", "normal", "strict"
validation_level = "normal"

# Include info-level messages in validation output
show_info = false

[tugtool.naming]
# Plan file prefix (default: "plan-")
prefix = "tugplan-"

# Allowed name pattern (regex)
name_pattern = "^[a-z][a-z0-9-]{1,49}$"
"#;

/// Empty implementation log template
const IMPLEMENTATION_LOG_CONTENT: &str = r#"# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

"#;

/// Check if the project is initialized
///
/// # Arguments
/// * `root` - Optional root directory (uses current directory if None)
/// * `json_output` - Output in JSON format
pub fn run_init_check(root: Option<&Path>, json_output: bool) -> Result<i32, String> {
    let base = root.unwrap_or_else(|| Path::new("."));
    let skeleton_path = base.join(".tugtool/tugplan-skeleton.md");
    let initialized = skeleton_path.exists();

    if json_output {
        let response = JsonResponse::ok(
            "init",
            InitCheckData {
                initialized,
                path: ".tugtool/".to_string(),
            },
        );
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    }

    // Return exit code 0 if initialized, 9 (E009) if not
    if initialized { Ok(0) } else { Ok(9) }
}

/// Run the init command
pub fn run_init(force: bool, check: bool, json_output: bool, quiet: bool) -> Result<i32, String> {
    // Route to check if --check flag is set
    if check {
        return run_init_check(None, json_output);
    }
    let tug_dir = Path::new(".tugtool");

    // When .tugtool/ exists and --force is not set, create only missing files (idempotent).
    // When --force is set, remove and recreate everything.
    if tug_dir.exists() && !force {
        // Idempotent mode: create only missing files
        let mut files_created = vec![];

        let skeleton_path = tug_dir.join("tugplan-skeleton.md");
        if !skeleton_path.exists() {
            fs::write(&skeleton_path, SKELETON_CONTENT)
                .map_err(|e| format!("failed to write tugplan-skeleton.md: {}", e))?;
            files_created.push("tugplan-skeleton.md".to_string());
        }

        let config_path = tug_dir.join("config.toml");
        if !config_path.exists() {
            fs::write(&config_path, DEFAULT_CONFIG)
                .map_err(|e| format!("failed to write config.toml: {}", e))?;
            files_created.push("config.toml".to_string());
        }

        let log_path = tug_dir.join("tugplan-implementation-log.md");
        if !log_path.exists() {
            fs::write(&log_path, IMPLEMENTATION_LOG_CONTENT)
                .map_err(|e| format!("failed to write tugplan-implementation-log.md: {}", e))?;
            files_created.push("tugplan-implementation-log.md".to_string());
        }

        // Handle .gitignore even in idempotent mode
        ensure_gitignore(quiet)?;

        if json_output {
            let response = JsonResponse::ok(
                "init",
                InitData {
                    path: ".tugtool/".to_string(),
                    files_created: files_created.clone(),
                },
            );
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
        } else if !quiet {
            if files_created.is_empty() {
                println!("Tug project already initialized in .tugtool/ (nothing to do)");
            } else {
                println!("Tug project in .tugtool/ updated:");
                for f in &files_created {
                    if f.starts_with("removed ") || f.starts_with("cleaned ") {
                        println!("  {}", f);
                    } else {
                        println!("  Created: {}", f);
                    }
                }
            }
        }

        return Ok(0);
    }

    // Force mode: remove and recreate everything
    if force && tug_dir.exists() {
        fs::remove_dir_all(tug_dir)
            .map_err(|e| format!("failed to remove existing .tugtool directory: {}", e))?;
    }

    fs::create_dir_all(tug_dir)
        .map_err(|e| format!("failed to create .tugtool directory: {}", e))?;

    // Create skeleton
    let skeleton_path = tug_dir.join("tugplan-skeleton.md");
    fs::write(&skeleton_path, SKELETON_CONTENT)
        .map_err(|e| format!("failed to write tugplan-skeleton.md: {}", e))?;

    // Create config.toml
    let config_path = tug_dir.join("config.toml");
    fs::write(&config_path, DEFAULT_CONFIG)
        .map_err(|e| format!("failed to write config.toml: {}", e))?;

    // Create implementation log
    let log_path = tug_dir.join("tugplan-implementation-log.md");
    fs::write(&log_path, IMPLEMENTATION_LOG_CONTENT)
        .map_err(|e| format!("failed to write tugplan-implementation-log.md: {}", e))?;

    ensure_gitignore(quiet)?;

    let files_created = vec![
        "tugplan-skeleton.md".to_string(),
        "config.toml".to_string(),
        "tugplan-implementation-log.md".to_string(),
    ];

    if json_output {
        let response = JsonResponse::ok(
            "init",
            InitData {
                path: ".tugtool/".to_string(),
                files_created,
            },
        );
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Initialized tug project in .tugtool/");
        println!("  Created: tugplan-skeleton.md");
        println!("  Created: config.toml");
        println!("  Created: tugplan-implementation-log.md");
    }

    Ok(0)
}

/// Ensure .tugtree/ is listed in .gitignore
fn ensure_gitignore(_quiet: bool) -> Result<(), String> {
    let gitignore_path = Path::new(".gitignore");
    let gitignore_entry = ".tugtree/";

    let should_add_entry = if gitignore_path.exists() {
        let content = fs::read_to_string(gitignore_path)
            .map_err(|e| format!("failed to read .gitignore: {}", e))?;
        !content.lines().any(|line| line.trim() == gitignore_entry)
    } else {
        true
    };

    if should_add_entry {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(gitignore_path)
            .map_err(|e| format!("failed to open .gitignore: {}", e))?;

        if gitignore_path.exists() {
            let content = fs::read_to_string(gitignore_path).unwrap_or_default();
            if !content.is_empty() && !content.ends_with('\n') {
                writeln!(file).map_err(|e| format!("failed to write to .gitignore: {}", e))?;
            }
        }

        writeln!(
            file,
            "\n# Tug worktrees (isolated implementation environments)"
        )
        .map_err(|e| format!("failed to write to .gitignore: {}", e))?;
        writeln!(file, "{}", gitignore_entry)
            .map_err(|e| format!("failed to write to .gitignore: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_init_check_not_initialized() {
        let temp = TempDir::new().expect("failed to create temp dir");
        let temp_path = temp.path();

        // No .tugtool directory - should return exit code 9
        let result = run_init_check(Some(temp_path), false).expect("init check should not error");
        assert_eq!(result, 9, "should return exit code 9 for not initialized");
        // TempDir auto-cleans on drop - no manual cleanup needed
    }

    #[test]
    fn test_init_check_initialized() {
        let temp = TempDir::new().expect("failed to create temp dir");
        let temp_path = temp.path();

        // Create .tugtool directory with skeleton
        let tug_dir = temp_path.join(".tugtool");
        fs::create_dir_all(&tug_dir).expect("failed to create .tugtool");
        fs::write(tug_dir.join("tugplan-skeleton.md"), "test content")
            .expect("failed to write skeleton");

        let result = run_init_check(Some(temp_path), false).expect("init check should not error");
        assert_eq!(result, 0, "should return exit code 0 for initialized");
        // TempDir auto-cleans on drop - no manual cleanup needed
    }

    #[test]
    fn test_init_check_json_output() {
        let temp = TempDir::new().expect("failed to create temp dir");
        let temp_path = temp.path();

        // Capture stdout would require more infrastructure, so we just verify it doesn't error
        let result = run_init_check(Some(temp_path), true).expect("init check should not error");
        assert_eq!(result, 9, "should return exit code 9");
        // TempDir auto-cleans on drop - no manual cleanup needed
    }
}
