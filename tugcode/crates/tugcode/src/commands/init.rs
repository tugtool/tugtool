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

[tugtool.beads]
# Enable beads integration
enabled = true

# Validate bead IDs when present
validate_bead_ids = true

# Path to beads CLI binary (default: "bd" on PATH)
bd_path = "bd"

# Sync behavior defaults (safe, non-destructive)
prune_deps = false

# Root bead type (epic recommended for bd ready --parent)
root_issue_type = "epic"

# Substep mapping: "none" (default) or "children"
substeps = "none"

# Pull behavior: which checkboxes to update when a bead is complete
# - "checkpoints": update only **Checkpoint:** items (default)
# - "all": update Tasks/Tests/Checkpoints
pull_checkbox_mode = "checkpoints"

# Warn when checkboxes and bead status disagree
pull_warn_on_conflict = true
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

        // Remove beads git hooks
        let hooks_removed = remove_beads_hooks(Path::new("."));
        for hook in &hooks_removed {
            files_created.push(format!("removed .git/hooks/{}", hook));
        }

        // Remove AGENTS.md dropped by bd init
        if remove_agents_md(Path::new(".")) {
            files_created.push("removed AGENTS.md".to_string());
        }

        // Remove stale .beads/ directory (beads now lives in worktrees)
        if remove_stale_beads_dir(Path::new(".")) {
            files_created.push("removed .beads/".to_string());
        }

        // Remove stale beads merge driver from git config
        for key in remove_beads_merge_driver(Path::new(".")) {
            files_created.push(format!("removed git config {}", key));
        }

        // Remove stale beads entries from .gitattributes
        if clean_beads_gitattributes(Path::new(".")) {
            files_created.push("cleaned .gitattributes".to_string());
        }

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

    // Remove beads git hooks
    let hooks_removed = remove_beads_hooks(Path::new("."));

    let mut files_created = vec![
        "tugplan-skeleton.md".to_string(),
        "config.toml".to_string(),
        "tugplan-implementation-log.md".to_string(),
    ];
    for hook in &hooks_removed {
        files_created.push(format!("removed .git/hooks/{}", hook));
    }

    // Remove AGENTS.md dropped by bd init
    if remove_agents_md(Path::new(".")) {
        files_created.push("removed AGENTS.md".to_string());
    }

    // Remove stale .beads/ directory (beads now lives in worktrees)
    if remove_stale_beads_dir(Path::new(".")) {
        files_created.push("removed .beads/".to_string());
    }

    // Remove stale beads merge driver from git config
    for key in remove_beads_merge_driver(Path::new(".")) {
        files_created.push(format!("removed git config {}", key));
    }

    // Remove stale beads entries from .gitattributes
    if clean_beads_gitattributes(Path::new(".")) {
        files_created.push("cleaned .gitattributes".to_string());
    }

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
        for hook in &hooks_removed {
            println!("  Removed .git/hooks/{}", hook);
        }
    }

    Ok(0)
}

/// Remove beads-related git hooks from .git/hooks/
///
/// Scans .git/hooks/ for pre-commit and post-merge files that contain beads/bd references.
/// Returns a list of removed hook filenames.
fn remove_beads_hooks(root: &Path) -> Vec<String> {
    let hooks_dir = root.join(".git/hooks");

    // If .git/hooks doesn't exist, nothing to do
    if !hooks_dir.exists() {
        return vec![];
    }

    let mut removed_hooks = vec![];
    let hook_names = ["pre-commit", "post-merge"];

    for hook_name in &hook_names {
        let hook_path = hooks_dir.join(hook_name);

        // Skip if hook file doesn't exist
        if !hook_path.exists() {
            continue;
        }

        // Read hook content
        let content = match fs::read_to_string(&hook_path) {
            Ok(c) => c,
            Err(_) => continue, // Skip files we can't read
        };

        // Check if content contains beads/bd references
        // Look for "bd " (with space), "bd\n" (at line end), "bd\t" (with tab), or "beads"
        if content.contains("bd ")
            || content.contains("bd\n")
            || content.contains("bd\t")
            || content.contains("beads")
        {
            // Remove the hook file
            if fs::remove_file(&hook_path).is_ok() {
                removed_hooks.push(hook_name.to_string());
            }
        }
    }

    removed_hooks
}

/// Remove AGENTS.md file dropped by `bd init`.
///
/// Returns true if the file existed and was removed.
fn remove_agents_md(root: &Path) -> bool {
    let agents_md = root.join("AGENTS.md");
    fs::remove_file(agents_md).is_ok()
}

/// Remove stale `.beads/` directory from the repo root.
///
/// Beads now lives exclusively in worktrees. A `.beads/` at the repo root
/// is a leftover from the old beads-at-root setup and should be removed.
/// Returns true if the directory existed and was removed.
fn remove_stale_beads_dir(root: &Path) -> bool {
    let beads_dir = root.join(".beads");
    if beads_dir.is_dir() {
        fs::remove_dir_all(&beads_dir).is_ok()
    } else {
        false
    }
}

/// Remove stale beads merge driver from `.git/config`.
///
/// The old beads-at-root setup configured `merge.beads.driver` and `merge.beads.name`
/// in the local git config. These are no longer needed since `.beads/` files are not
/// tracked in the repo.
/// Returns a list of removed config keys.
fn remove_beads_merge_driver(root: &Path) -> Vec<String> {
    let mut removed = vec![];
    let keys = ["merge.beads.driver", "merge.beads.name"];

    for key in &keys {
        let check = std::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["config", "--local", "--get", key])
            .output();

        if let Ok(output) = check {
            if output.status.success() {
                let unset = std::process::Command::new("git")
                    .arg("-C")
                    .arg(root)
                    .args(["config", "--local", "--unset", key])
                    .output();
                if let Ok(o) = unset {
                    if o.status.success() {
                        removed.push(key.to_string());
                    }
                }
            }
        }
    }

    removed
}

/// Remove stale beads merge driver entry from `.gitattributes`.
///
/// The old beads-at-root setup added `.beads/issues.jsonl merge=beads` to
/// `.gitattributes`. This is no longer needed. If the file becomes empty
/// (or only whitespace/comments) after removal, delete it entirely.
/// Returns true if the file was modified or removed.
fn clean_beads_gitattributes(root: &Path) -> bool {
    let path = root.join(".gitattributes");
    if !path.exists() {
        return false;
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    // Filter out lines related to beads merge driver
    let filtered: Vec<&str> = content
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            // Remove the merge=beads attribute line and its comment
            !(trimmed.contains("merge=beads")
                || trimmed.starts_with('#') && trimmed.to_lowercase().contains("bd merge"))
        })
        .collect();

    // Check if anything meaningful remains
    let has_content = filtered
        .iter()
        .any(|line| !line.trim().is_empty() && !line.trim().starts_with('#'));

    if has_content {
        // Rewrite with beads lines removed
        let new_content = filtered.join("\n");
        if new_content != content {
            let _ = fs::write(&path, new_content);
            return true;
        }
        false
    } else {
        // File is empty or only comments — remove it
        fs::remove_file(&path).is_ok()
    }
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

    #[test]
    fn test_remove_beads_hooks_removes_bd_hook() {
        let temp = TempDir::new().expect("failed to create temp dir");
        let temp_path = temp.path();

        // Create .git/hooks directory
        let hooks_dir = temp_path.join(".git/hooks");
        fs::create_dir_all(&hooks_dir).expect("failed to create hooks dir");

        // Create pre-commit hook with bd reference
        let hook_path = hooks_dir.join("pre-commit");
        fs::write(&hook_path, "#!/bin/sh\nbd sync --flush-only\n").expect("failed to write hook");

        // Call remove_beads_hooks
        let removed = remove_beads_hooks(temp_path);

        // Verify hook was removed
        assert_eq!(removed, vec!["pre-commit"], "should remove pre-commit hook");
        assert!(!hook_path.exists(), "hook file should be deleted");
    }

    #[test]
    fn test_remove_beads_hooks_preserves_non_bd_hook() {
        let temp = TempDir::new().expect("failed to create temp dir");
        let temp_path = temp.path();

        // Create .git/hooks directory
        let hooks_dir = temp_path.join(".git/hooks");
        fs::create_dir_all(&hooks_dir).expect("failed to create hooks dir");

        // Create pre-commit hook with unrelated content
        let hook_path = hooks_dir.join("pre-commit");
        fs::write(&hook_path, "#!/bin/sh\nrustfmt\n").expect("failed to write hook");

        // Call remove_beads_hooks
        let removed = remove_beads_hooks(temp_path);

        // Verify hook was NOT removed
        assert!(removed.is_empty(), "should not remove non-bd hook");
        assert!(hook_path.exists(), "hook file should still exist");
    }

    #[test]
    fn test_remove_beads_hooks_no_git_dir() {
        let temp = TempDir::new().expect("failed to create temp dir");
        let temp_path = temp.path();

        // Don't create .git/hooks directory

        // Call remove_beads_hooks
        let removed = remove_beads_hooks(temp_path);

        // Verify no error and no hooks removed
        assert!(
            removed.is_empty(),
            "should return empty vec when no .git/hooks"
        );
    }
}
