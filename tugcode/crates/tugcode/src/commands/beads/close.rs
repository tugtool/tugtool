//! Implementation of the `tug beads close` command

use tugtool_core::{BeadsCli, Config, find_project_root};

use crate::commands::log::{LOG_BYTE_THRESHOLD, LOG_LINE_THRESHOLD};
use crate::output::{BeadsCloseData, JsonIssue, JsonResponse};

/// Run the beads close command
pub fn run_close(
    bead_id: String,
    reason: Option<String>,
    working_dir: Option<String>,
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

    // Convert working_dir to Path if provided
    let working_path = working_dir.as_ref().map(|s| std::path::Path::new(s));

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

    // Attempt to close the bead
    match beads.close(&bead_id, reason.as_deref(), working_path) {
        Ok(()) => {
            // Check if log rotation is needed
            let (log_rotated, archived_path) = check_and_rotate_log(&project_root)?;

            let data = BeadsCloseData {
                bead_id: bead_id.clone(),
                closed: true,
                reason: reason.clone(),
                log_rotated,
                archived_path: archived_path.clone(),
            };

            if json_output {
                let response = JsonResponse::ok("beads close", data);
                let json = serde_json::to_string_pretty(&response)
                    .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
                println!("{}", json);
            } else if !quiet {
                if let Some(r) = &reason {
                    println!("Closed bead {} (reason: {})", bead_id, r);
                } else {
                    println!("Closed bead {}", bead_id);
                }

                // Report rotation if it occurred
                if log_rotated {
                    if let Some(path) = archived_path {
                        println!("Implementation log rotated to {}", path);
                    } else {
                        println!("Implementation log rotated");
                    }
                }
            }

            Ok(0)
        }
        Err(e) => {
            let error_msg = format!("failed to close bead: {}", e);
            output_error(json_output, "E016", &error_msg, 16)
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
        let data = BeadsCloseData {
            bead_id: String::new(),
            closed: false,
            reason: None,
            log_rotated: false,
            archived_path: None,
        };
        let response: JsonResponse<BeadsCloseData> =
            JsonResponse::error("beads close", data, issues);
        let json = serde_json::to_string_pretty(&response)
            .unwrap_or_else(|_| r#"{"error":"Failed to serialize JSON response"}"#.to_string());
        println!("{}", json);
    } else {
        eprintln!("error: {}", message);
    }
    Ok(exit_code)
}

/// Check log size and rotate if needed
///
/// Returns (rotated, archived_path)
fn check_and_rotate_log(project_root: &std::path::Path) -> Result<(bool, Option<String>), String> {
    use std::fs;

    let log_path = project_root.join(".tugtool/tugplan-implementation-log.md");

    // If log doesn't exist, no rotation needed
    if !log_path.exists() {
        return Ok((false, None));
    }

    // Read log to check thresholds
    let content = fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read implementation log: {}", e))?;

    let line_count = content.lines().count();
    let byte_count = content.len();

    // Check if rotation is needed
    let should_rotate = line_count > LOG_LINE_THRESHOLD || byte_count > LOG_BYTE_THRESHOLD;

    if !should_rotate {
        return Ok((false, None));
    }

    // Perform rotation by calling the log rotation logic
    perform_log_rotation(project_root, &content, line_count, byte_count)
}

/// Perform the actual log rotation
///
/// Returns (rotated, archived_path)
fn perform_log_rotation(
    project_root: &std::path::Path,
    _content: &str,
    _line_count: usize,
    _byte_count: usize,
) -> Result<(bool, Option<String>), String> {
    use std::fs;

    let log_path = project_root.join(".tugtool/tugplan-implementation-log.md");
    let archive_dir = project_root.join(".tugtool/archive");

    // Create archive directory if it doesn't exist
    if !archive_dir.exists() {
        fs::create_dir_all(&archive_dir)
            .map_err(|e| format!("Failed to create archive directory: {}", e))?;
    }

    // Generate timestamp for archive filename
    let timestamp = generate_archive_timestamp()?;
    let archive_filename = format!("implementation-log-{}.md", timestamp);
    let archive_path = archive_dir.join(&archive_filename);

    // Atomic rename from log to archive
    fs::rename(&log_path, &archive_path)
        .map_err(|e| format!("Failed to move log to archive: {}", e))?;

    // Create fresh log with header template
    const IMPLEMENTATION_LOG_HEADER: &str = r#"# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

"#;

    fs::write(&log_path, IMPLEMENTATION_LOG_HEADER)
        .map_err(|e| format!("Failed to create fresh log file: {}", e))?;

    let archived_path_str = format!(".tugtool/archive/{}", archive_filename);
    Ok((true, Some(archived_path_str)))
}

/// Generate timestamp in YYYY-MM-DD-HHMMSS format for archive filenames
fn generate_archive_timestamp() -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("System time error: {}", e))?;

    let secs = duration.as_secs();

    // Convert to date/time components
    const SECONDS_PER_DAY: u64 = 86400;
    const DAYS_TO_EPOCH: i64 = 719162; // Days from 0000-01-01 to 1970-01-01

    let days_since_epoch = (secs / SECONDS_PER_DAY) as i64;
    let seconds_today = secs % SECONDS_PER_DAY;

    let hours = seconds_today / 3600;
    let minutes = (seconds_today % 3600) / 60;
    let seconds = seconds_today % 60;

    // Calculate year, month, day
    let total_days = DAYS_TO_EPOCH + days_since_epoch;

    let mut year = (total_days / 365) as i32;
    let mut remaining_days = total_days - year_to_days(year);

    while remaining_days < 0 {
        year -= 1;
        remaining_days = total_days - year_to_days(year);
    }
    while remaining_days >= days_in_year(year) {
        remaining_days -= days_in_year(year);
        year += 1;
    }

    let is_leap = is_leap_year(year);
    let mut month = 1;
    let mut day = remaining_days + 1;

    let days_in_months = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    for (m, &days) in days_in_months.iter().enumerate() {
        if day <= days as i64 {
            month = m + 1;
            break;
        }
        day -= days as i64;
    }

    Ok(format!(
        "{:04}-{:02}-{:02}-{:02}{:02}{:02}",
        year, month, day, hours, minutes, seconds
    ))
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn days_in_year(year: i32) -> i64 {
    if is_leap_year(year) { 366 } else { 365 }
}

fn year_to_days(year: i32) -> i64 {
    let y = year as i64;
    y * 365 + y / 4 - y / 100 + y / 400
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_beads_close_triggers_rotation_on_oversized_log() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        // Set up .tugtool directory structure
        let tug_dir = temp_path.join(".tugtool");
        fs::create_dir_all(&tug_dir).unwrap();

        // Create oversized log (> 500 lines)
        let log_path = tug_dir.join("tugplan-implementation-log.md");
        let mut content = String::new();
        for i in 0..510 {
            content.push_str(&format!("Line {}\n", i));
        }
        fs::write(&log_path, content).unwrap();

        // Call check_and_rotate_log
        let result = check_and_rotate_log(temp_path);
        assert!(result.is_ok());

        let (rotated, archived_path) = result.unwrap();
        assert!(rotated, "Log should have been rotated");
        assert!(archived_path.is_some(), "Archived path should be present");

        // Verify archive was created
        let archive_dir = tug_dir.join("archive");
        assert!(archive_dir.exists(), "Archive directory should exist");

        // Verify fresh log was created
        assert!(log_path.exists(), "Fresh log should exist");
        let new_content = fs::read_to_string(&log_path).unwrap();
        assert!(
            new_content.contains("# Tug Implementation Log"),
            "Fresh log should have header"
        );
        assert!(new_content.len() < 500, "Fresh log should be small");
    }

    #[test]
    fn test_beads_close_no_rotation_under_threshold() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        // Set up .tugtool directory structure
        let tug_dir = temp_path.join(".tugtool");
        fs::create_dir_all(&tug_dir).unwrap();

        // Create small log (< 500 lines)
        let log_path = tug_dir.join("tugplan-implementation-log.md");
        let mut content = String::new();
        for i in 0..100 {
            content.push_str(&format!("Line {}\n", i));
        }
        let original_content = content.clone();
        fs::write(&log_path, content).unwrap();

        // Call check_and_rotate_log
        let result = check_and_rotate_log(temp_path);
        assert!(result.is_ok());

        let (rotated, archived_path) = result.unwrap();
        assert!(!rotated, "Log should not have been rotated");
        assert!(
            archived_path.is_none(),
            "No archived path should be present"
        );

        // Verify log is unchanged
        let new_content = fs::read_to_string(&log_path).unwrap();
        assert_eq!(new_content, original_content, "Log should be unchanged");

        // Verify no archive was created
        let archive_dir = tug_dir.join("archive");
        assert!(!archive_dir.exists(), "Archive directory should not exist");
    }

    #[test]
    fn test_beads_close_rotation_byte_threshold() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        // Set up .tugtool directory structure
        let tug_dir = temp_path.join(".tugtool");
        fs::create_dir_all(&tug_dir).unwrap();

        // Create log with > 100KB (exceeds byte threshold)
        let log_path = tug_dir.join("tugplan-implementation-log.md");
        let line = "x".repeat(1000); // 1000 bytes per line
        let mut content = String::new();
        for i in 0..110 {
            // 110KB total
            content.push_str(&format!("Line {}: {}\n", i, line));
        }
        fs::write(&log_path, content).unwrap();

        // Call check_and_rotate_log
        let result = check_and_rotate_log(temp_path);
        assert!(result.is_ok());

        let (rotated, archived_path) = result.unwrap();
        assert!(rotated, "Log should have been rotated");
        assert!(archived_path.is_some(), "Archived path should be present");

        // Verify archive was created
        let archive_dir = tug_dir.join("archive");
        assert!(archive_dir.exists(), "Archive directory should exist");
    }

    #[test]
    fn test_beads_close_no_log_file() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        // Set up .tugtool directory but no log
        let tug_dir = temp_path.join(".tugtool");
        fs::create_dir_all(&tug_dir).unwrap();

        // Call check_and_rotate_log
        let result = check_and_rotate_log(temp_path);
        assert!(result.is_ok());

        let (rotated, archived_path) = result.unwrap();
        assert!(!rotated, "No rotation should occur");
        assert!(archived_path.is_none(), "No archived path");

        // Verify no archive was created
        let archive_dir = tug_dir.join("archive");
        assert!(!archive_dir.exists(), "Archive directory should not exist");
    }
}
