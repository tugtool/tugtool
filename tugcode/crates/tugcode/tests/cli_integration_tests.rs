//! CLI integration tests for tug commands

use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// Get the path to the tug binary
fn tug_binary() -> PathBuf {
    // Use the debug binary
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // crates
    path.pop(); // repo root
    path.push("target");
    path.push("debug");
    path.push("tugcode");
    path
}

/// Create a temp directory with .tugtool initialized
fn setup_test_project() -> tempfile::TempDir {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    // Run tug init
    let output = Command::new(tug_binary())
        .arg("init")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init");

    assert!(
        output.status.success(),
        "tug init failed: {:?}",
        String::from_utf8_lossy(&output.stderr)
    );

    temp
}

/// Create a minimal valid plan in the test project
fn create_test_plan(temp_dir: &tempfile::TempDir, name: &str, content: &str) {
    let plan_path = temp_dir
        .path()
        .join(".tugtool")
        .join(format!("tugplan-{}.md", name));
    fs::write(&plan_path, content).expect("failed to write test plan");
}

const MINIMAL_PLAN: &str = r#"## Phase 1.0: Test Feature {#phase-1}

**Purpose:** Test plan for integration testing.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-02-04 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Test context paragraph.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Test Decision (DECIDED) {#d01-test}

**Decision:** This is a test decision.

**Rationale:**
- Because testing

**Implications:**
- Tests work

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 1: Setup {#step-1}

**Commit:** `feat: setup`

**References:** [D01] Test Decision, (#context)

**Tasks:**
- [x] Create project
- [ ] Add tests

**Tests:**
- [ ] Unit test

**Checkpoint:**
- [x] Build passes

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Working test feature.

#### Phase Exit Criteria {#exit-criteria}

- [ ] All tests pass
"#;

#[test]
fn test_init_creates_expected_files() {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    let output = Command::new(tug_binary())
        .arg("init")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init");

    assert!(output.status.success(), "init should succeed");

    // Check files were created
    let tug_dir = temp.path().join(".tugtool");
    assert!(tug_dir.is_dir(), ".tugtool directory should exist");
    assert!(
        tug_dir.join("tugplan-skeleton.md").is_file(),
        "skeleton should exist"
    );
    assert!(tug_dir.join("config.toml").is_file(), "config should exist");
    assert!(
        tug_dir.join("tugplan-implementation-log.md").is_file(),
        "implementation log should exist"
    );
}

#[test]
fn test_init_idempotent_on_existing_project() {
    let temp = setup_test_project();

    // Running init again should succeed (idempotent — creates missing files only)
    let output = Command::new(tug_binary())
        .arg("init")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init");

    assert!(
        output.status.success(),
        "init should succeed idempotently on existing project"
    );

    // All files should still exist
    let tug_dir = temp.path().join(".tugtool");
    assert!(tug_dir.join("tugplan-skeleton.md").is_file());
    assert!(tug_dir.join("config.toml").is_file());
    assert!(tug_dir.join("tugplan-implementation-log.md").is_file());
}

#[test]
fn test_init_creates_missing_files() {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    // Create .tugtool/ with only a plan file (simulates worktree scenario)
    let tug_dir = temp.path().join(".tugtool");
    std::fs::create_dir_all(&tug_dir).expect("failed to create .tugtool");
    std::fs::write(tug_dir.join("tugplan-1.md"), "# My Plan\n").expect("failed to write plan");

    // Running init should create the missing infrastructure files
    let output = Command::new(tug_binary())
        .arg("init")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init");

    assert!(
        output.status.success(),
        "init should succeed and create missing files"
    );

    // Infrastructure files should now exist
    assert!(tug_dir.join("tugplan-skeleton.md").is_file());
    assert!(tug_dir.join("config.toml").is_file());
    assert!(tug_dir.join("tugplan-implementation-log.md").is_file());

    // Original plan file should be untouched
    let content =
        std::fs::read_to_string(tug_dir.join("tugplan-1.md")).expect("failed to read plan");
    assert_eq!(content, "# My Plan\n");
}

#[test]
fn test_init_with_force_succeeds() {
    let temp = setup_test_project();

    let output = Command::new(tug_binary())
        .arg("init")
        .arg("--force")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init --force");

    assert!(output.status.success(), "init --force should succeed");
}

#[test]
fn test_validate_valid_plan() {
    let temp = setup_test_project();
    create_test_plan(&temp, "test", MINIMAL_PLAN);

    let output = Command::new(tug_binary())
        .arg("validate")
        .arg("tugplan-test.md")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug validate");

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "validate should succeed on valid plan: {}",
        stdout
    );
    assert!(stdout.contains("valid"), "output should say valid");
}

#[test]
fn test_validate_invalid_plan() {
    let temp = setup_test_project();

    // Create an invalid plan (missing metadata)
    let invalid = r#"## Phase 1.0: Test {#phase-1}

**Purpose:** Test

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | |
| Status | invalid_status |

---

### Phase Overview {#phase-overview}

Test

---

### 1.0.0 Design Decisions {#design-decisions}

None

---

### 1.0.5 Execution Steps {#execution-steps}

None

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

None
"#;

    create_test_plan(&temp, "invalid", invalid);

    let output = Command::new(tug_binary())
        .arg("validate")
        .arg("tugplan-invalid.md")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug validate");

    assert!(
        !output.status.success(),
        "validate should fail on invalid plan"
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("error"), "output should contain error");
}

#[test]
fn test_list_shows_plans() {
    let temp = setup_test_project();
    create_test_plan(&temp, "test", MINIMAL_PLAN);

    let output = Command::new(tug_binary())
        .arg("list")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug list");

    assert!(output.status.success(), "list should succeed");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("test"), "output should contain plan name");
    assert!(stdout.contains("active"), "output should contain status");
}

#[test]
fn test_status_shows_step_breakdown() {
    let temp = setup_test_project();
    create_test_plan(&temp, "test", MINIMAL_PLAN);

    let output = Command::new(tug_binary())
        .arg("status")
        .arg("tugplan-test.md")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug status");

    assert!(output.status.success(), "status should succeed");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Step 1"), "output should contain step");
    assert!(stdout.contains("Setup"), "output should contain step title");
    assert!(stdout.contains("Total:"), "output should contain total");
}

#[test]
fn test_json_output_init() {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    let output = Command::new(tug_binary())
        .arg("init")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init --json");

    assert!(output.status.success(), "init --json should succeed");
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse JSON
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");
    assert_eq!(json["schema_version"], "1");
    assert_eq!(json["command"], "init");
    assert_eq!(json["status"], "ok");
    assert!(json["data"]["files_created"].is_array());
}

#[test]
fn test_json_output_list() {
    let temp = setup_test_project();
    create_test_plan(&temp, "test", MINIMAL_PLAN);

    let output = Command::new(tug_binary())
        .arg("list")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug list --json");

    assert!(output.status.success(), "list --json should succeed");
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse JSON
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");
    assert_eq!(json["schema_version"], "1");
    assert_eq!(json["command"], "list");
    assert_eq!(json["status"], "ok");
    assert!(json["data"]["plans"].is_array());
    assert_eq!(json["data"]["plans"][0]["name"], "test");
}

#[test]
fn test_json_output_validate() {
    let temp = setup_test_project();
    create_test_plan(&temp, "test", MINIMAL_PLAN);

    let output = Command::new(tug_binary())
        .arg("validate")
        .arg("tugplan-test.md")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug validate --json");

    assert!(
        output.status.success(),
        "validate --json should succeed on valid plan"
    );
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse JSON
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");
    assert_eq!(json["schema_version"], "1");
    assert_eq!(json["command"], "validate");
    assert_eq!(json["status"], "ok");
    assert!(json["data"]["files"].is_array());
    assert_eq!(json["data"]["files"][0]["valid"], true);
}

#[test]
fn test_json_output_status() {
    let temp = setup_test_project();
    create_test_plan(&temp, "test", MINIMAL_PLAN);

    let output = Command::new(tug_binary())
        .arg("status")
        .arg("tugplan-test.md")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug status --json");

    assert!(output.status.success(), "status --json should succeed");
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse JSON
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");
    assert_eq!(json["schema_version"], "1");
    assert_eq!(json["command"], "status");
    assert_eq!(json["status"], "ok");
    assert_eq!(json["data"]["name"], "test");
    assert!(json["data"]["steps"].is_array());
    assert!(json["data"]["progress"]["done"].is_number());
    assert!(json["data"]["progress"]["total"].is_number());
}

#[test]
fn test_init_check_uninitialized_project() {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    let output = Command::new(tug_binary())
        .arg("init")
        .arg("--check")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init --check");

    // Should return exit code 9 for uninitialized project
    assert_eq!(
        output.status.code(),
        Some(9),
        "init --check should return exit code 9 for uninitialized project"
    );
}

#[test]
fn test_init_check_initialized_project() {
    let temp = setup_test_project();

    let output = Command::new(tug_binary())
        .arg("init")
        .arg("--check")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init --check");

    // Should return exit code 0 for initialized project
    assert!(
        output.status.success(),
        "init --check should succeed on initialized project"
    );
    assert_eq!(output.status.code(), Some(0));
}

#[test]
fn test_init_check_json_uninitialized() {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    let output = Command::new(tug_binary())
        .arg("init")
        .arg("--check")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init --check --json");

    assert_eq!(output.status.code(), Some(9));
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse JSON
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");
    assert_eq!(json["schema_version"], "1");
    assert_eq!(json["command"], "init");
    assert_eq!(json["status"], "ok");
    assert_eq!(json["data"]["initialized"], false);
    assert_eq!(json["data"]["path"], ".tugtool/");
}

#[test]
fn test_init_check_json_initialized() {
    let temp = setup_test_project();

    let output = Command::new(tug_binary())
        .arg("init")
        .arg("--check")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init --check --json");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse JSON
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");
    assert_eq!(json["schema_version"], "1");
    assert_eq!(json["command"], "init");
    assert_eq!(json["status"], "ok");
    assert_eq!(json["data"]["initialized"], true);
    assert_eq!(json["data"]["path"], ".tugtool/");
}

#[test]
fn test_init_check_force_mutually_exclusive() {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    let output = Command::new(tug_binary())
        .arg("init")
        .arg("--check")
        .arg("--force")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug init --check --force");

    // Should fail due to mutually exclusive flags
    assert!(
        !output.status.success(),
        "init --check --force should fail due to mutually exclusive flags"
    );
}

#[test]
#[serial_test::serial]
fn test_validate_text_output_includes_diagnostics() {
    let temp = setup_test_project();

    // Create a plan with a near-miss pattern (lowercase step header)
    let plan_with_diagnostic = r#"## Phase 1.0: Test Feature {#phase-1}

**Purpose:** Test plan with diagnostic.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-02-04 |

---

### step 0: lowercase step header

This should trigger P001 diagnostic.

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 1: Real Step {#step-1}

**Commit:** `feat: setup`

**References:** (#plan-metadata)

**Tasks:**
- [ ] Task one

**Checkpoint:**
- [ ] Check one
"#;

    create_test_plan(&temp, "diagnostic-test", plan_with_diagnostic);

    let output = Command::new(tug_binary())
        .arg("validate")
        .arg(".tugtool/tugplan-diagnostic-test.md")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug validate");

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Should include diagnostics section with P001
    assert!(
        stdout.contains("warning[P001]:"),
        "Text output should contain warning[P001]: format. Output:\n{}",
        stdout
    );
    assert!(
        stdout.contains("Diagnostics:"),
        "Text output should contain Diagnostics section. Output:\n{}",
        stdout
    );
    assert!(
        stdout.contains("line"),
        "Diagnostic should include line number. Output:\n{}",
        stdout
    );
}

#[test]
#[serial_test::serial]
fn test_validate_json_output_includes_diagnostics() {
    let temp = setup_test_project();

    // Create a plan with multiple near-miss patterns
    let plan_with_diagnostics = r#"## Phase 1.0: Test Feature {#phase-1}

**Purpose:** Test plan with multiple diagnostics.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-02-04 |

---

### step 0: lowercase step header

This triggers P001.

### phase 1.0: lowercase phase

This triggers P003.

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 1: Real Step {#step-1}

**Commit:** `feat: setup`

**References:** (#plan-metadata)

**Tasks:**
- [ ] Task one

**Checkpoint:**
- [ ] Check one
"#;

    create_test_plan(&temp, "json-diagnostic-test", plan_with_diagnostics);

    let output = Command::new(tug_binary())
        .arg("validate")
        .arg(".tugtool/tugplan-json-diagnostic-test.md")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug validate --json");

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse JSON
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .unwrap_or_else(|_| panic!("Failed to parse JSON. Output:\n{}", stdout));

    // Should have diagnostics array in data
    assert!(
        json["data"]["diagnostics"].is_array(),
        "JSON output should contain diagnostics array in data. JSON:\n{}",
        serde_json::to_string_pretty(&json).unwrap()
    );

    let diagnostics = json["data"]["diagnostics"].as_array().unwrap();
    assert!(
        !diagnostics.is_empty(),
        "Diagnostics array should not be empty. JSON:\n{}",
        serde_json::to_string_pretty(&json).unwrap()
    );

    // Should have at least one P001 or P003
    let has_p_code = diagnostics.iter().any(|d| {
        let code = d["code"].as_str().unwrap_or("");
        code == "P001" || code == "P003"
    });
    assert!(
        has_p_code,
        "Diagnostics should contain P001 or P003. Diagnostics:\n{}",
        serde_json::to_string_pretty(&diagnostics).unwrap()
    );
}

#[test]
#[serial_test::serial]
fn test_validate_level_lenient_suppresses_diagnostics() {
    let temp = setup_test_project();

    // Create a plan with a diagnostic
    let plan_with_diagnostic = r#"## Phase 1.0: Test Feature {#phase-1}

**Purpose:** Test plan.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-02-04 |

---

### step 0: lowercase

This triggers P001.

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 1: Real Step {#step-1}

**Commit:** `feat: setup`

**References:** (#plan-metadata)

**Tasks:**
- [ ] Task one

**Checkpoint:**
- [ ] Check one
"#;

    create_test_plan(&temp, "lenient-test", plan_with_diagnostic);

    // Run with --level lenient
    let output = Command::new(tug_binary())
        .arg("validate")
        .arg(".tugtool/tugplan-lenient-test.md")
        .arg("--level")
        .arg("lenient")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug validate --level lenient");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .unwrap_or_else(|_| panic!("Failed to parse JSON. Output:\n{}", stdout));

    // Diagnostics should be empty in lenient mode
    let diagnostics = json["data"]["diagnostics"].as_array().unwrap();
    assert!(
        diagnostics.is_empty(),
        "Lenient mode should suppress diagnostics. JSON:\n{}",
        serde_json::to_string_pretty(&json).unwrap()
    );
}

#[test]
#[serial_test::serial]
fn test_validate_invalid_level_rejected() {
    let temp = setup_test_project();

    // Run with an invalid --level value
    let output = Command::new(tug_binary())
        .arg("validate")
        .arg("--level")
        .arg("bogus")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug validate --level bogus");

    // Should fail with exit code 2
    assert!(
        !output.status.success(),
        "Invalid --level value should cause failure"
    );

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("invalid validation level") || stderr.contains("bogus"),
        "Error should mention the invalid level. stderr:\n{}",
        stderr
    );
}

#[test]
#[serial_test::serial]
fn test_validate_invalid_level_rejected_json() {
    let temp = setup_test_project();

    // Run with an invalid --level value in JSON mode
    let output = Command::new(tug_binary())
        .arg("validate")
        .arg("--level")
        .arg("foo")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug validate --level foo --json");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .unwrap_or_else(|_| panic!("Failed to parse JSON. Output:\n{}", stdout));

    assert_eq!(
        json["status"].as_str().unwrap(),
        "error",
        "JSON response should have error status"
    );
    assert!(
        json["issues"][0]["message"]
            .as_str()
            .unwrap()
            .contains("invalid validation level"),
        "JSON error should mention invalid level. JSON:\n{}",
        serde_json::to_string_pretty(&json).unwrap()
    );
}
