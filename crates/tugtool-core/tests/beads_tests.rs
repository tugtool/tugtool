//! Integration tests for beads functionality

use tugtool_core::beads::is_valid_bead_id;

#[test]
fn test_bead_id_validation() {
    // Valid IDs
    assert!(is_valid_bead_id("bd-abc123"));
    assert!(is_valid_bead_id("bd-fake-1"));
    assert!(is_valid_bead_id("bd-fake-1.1"));
    assert!(is_valid_bead_id("bd-fake-1.2.3"));
    assert!(is_valid_bead_id("gt-abc1"));
    assert!(is_valid_bead_id("prefix-xyz99"));

    // Invalid IDs
    assert!(!is_valid_bead_id(""));
    assert!(!is_valid_bead_id("bd"));
    assert!(!is_valid_bead_id("bd-"));
    assert!(!is_valid_bead_id("-abc123"));
    assert!(!is_valid_bead_id("BD-ABC123")); // Must be lowercase
    assert!(!is_valid_bead_id("bd_abc123")); // Underscores not allowed in format
}

#[test]
fn test_issue_json_parsing() {
    use tugtool_core::beads::Issue;

    let json = r#"{"id":"bd-fake-1","title":"Test Issue","description":"","status":"open","priority":2,"issue_type":"task"}"#;
    let issue: Issue = serde_json::from_str(json).expect("Failed to parse Issue JSON");

    assert_eq!(issue.id, "bd-fake-1");
    assert_eq!(issue.title, "Test Issue");
    assert_eq!(issue.status, "open");
    assert_eq!(issue.priority, 2);
    assert_eq!(issue.issue_type, "task");
}

#[test]
fn test_issue_details_json_parsing_array() {
    use tugtool_core::beads::IssueDetails;

    // bd show returns array
    let json = r#"[{"id":"bd-fake-1","title":"Test Issue","description":"","status":"open","priority":2,"issue_type":"task","dependencies":[]}]"#;
    let issues: Vec<IssueDetails> =
        serde_json::from_str(json).expect("Failed to parse IssueDetails array");

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].id, "bd-fake-1");
}

#[test]
fn test_issue_details_json_parsing_object() {
    use tugtool_core::beads::IssueDetails;

    // bd show may return single object
    let json = r#"{"id":"bd-fake-1","title":"Test Issue","description":"","status":"closed","priority":2,"issue_type":"task","dependencies":[{"id":"bd-fake-0","dependency_type":"blocks"}]}"#;
    let issue: IssueDetails =
        serde_json::from_str(json).expect("Failed to parse IssueDetails object");

    assert_eq!(issue.id, "bd-fake-1");
    assert_eq!(issue.status, "closed");
    assert_eq!(issue.dependencies.len(), 1);
    assert_eq!(issue.dependencies[0].id, "bd-fake-0");
}

#[test]
fn test_bead_status_display() {
    use tugtool_core::beads::BeadStatus;

    assert_eq!(format!("{}", BeadStatus::Complete), "complete");
    assert_eq!(format!("{}", BeadStatus::Ready), "ready");
    assert_eq!(format!("{}", BeadStatus::Blocked), "blocked");
    assert_eq!(format!("{}", BeadStatus::Pending), "pending");
}

#[test]
fn test_dep_result_json_parsing() {
    use tugtool_core::beads::DepResult;

    let json =
        r#"{"status":"added","issue_id":"bd-fake-1","depends_on_id":"bd-fake-0","type":"blocks"}"#;
    let result: DepResult = serde_json::from_str(json).expect("Failed to parse DepResult");

    assert_eq!(result.status, "added");
    assert_eq!(result.issue_id, "bd-fake-1");
    assert_eq!(result.depends_on_id, "bd-fake-0");
}

/// Helper: create a BeadsCli pointing at bd-fake with an isolated state dir
fn make_test_beads(state_dir: &std::path::Path) -> tugtool_core::beads::BeadsCli {
    let mut bd_fake_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    bd_fake_path.pop(); // crates/
    bd_fake_path.pop(); // workspace root
    bd_fake_path.push("tests/bin/bd-fake");

    let mut beads = tugtool_core::beads::BeadsCli::new(bd_fake_path.to_string_lossy().to_string());
    beads.set_env("TUG_BD_STATE", state_dir.to_string_lossy());
    beads
}

#[test]
fn test_bd_fake_create_with_rich_fields() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let beads = make_test_beads(temp_dir.path());

    // Create an issue with rich fields
    let issue = beads
        .create(
            "Test Issue",
            Some("Test description"),
            None,
            None,
            None,
            Some("Design content"),
            Some("Acceptance content"),
            Some("Notes content"),
            None,
        )
        .expect("Failed to create issue");

    assert_eq!(issue.title, "Test Issue");

    // Show the issue and verify rich fields
    let details = beads.show(&issue.id, None).expect("Failed to show issue");
    assert_eq!(details.design, Some("Design content".to_string()));
    assert_eq!(
        details.acceptance_criteria,
        Some("Acceptance content".to_string())
    );
    assert_eq!(details.notes, Some("Notes content".to_string()));
}

#[test]
fn test_bd_fake_update_rich_fields() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let beads = make_test_beads(temp_dir.path());

    // Create an issue without rich fields
    let issue = beads
        .create("Test Issue", None, None, None, None, None, None, None, None)
        .expect("Failed to create issue");

    // Verify no rich fields
    let details = beads.show(&issue.id, None).expect("Failed to show issue");
    assert!(details.design.is_none());
    assert!(details.acceptance_criteria.is_none());
    assert!(details.notes.is_none());

    // Update design field
    beads
        .update_design(&issue.id, "Updated design", None)
        .expect("Failed to update design");

    // Verify design was updated
    let details = beads.show(&issue.id, None).expect("Failed to show issue");
    assert_eq!(details.design, Some("Updated design".to_string()));
    assert!(details.acceptance_criteria.is_none());
    assert!(details.notes.is_none());

    // Update acceptance_criteria field
    beads
        .update_acceptance(&issue.id, "Updated acceptance", None)
        .expect("Failed to update acceptance");

    // Verify acceptance_criteria was updated
    let details = beads.show(&issue.id, None).expect("Failed to show issue");
    assert_eq!(details.design, Some("Updated design".to_string()));
    assert_eq!(
        details.acceptance_criteria,
        Some("Updated acceptance".to_string())
    );
    assert!(details.notes.is_none());

    // Update description field (existing functionality)
    beads
        .update_description(&issue.id, "Updated description", None)
        .expect("Failed to update description");

    // Verify description was updated
    let details = beads.show(&issue.id, None).expect("Failed to show issue");
    assert_eq!(details.description, "Updated description");
    assert_eq!(details.design, Some("Updated design".to_string()));
}
