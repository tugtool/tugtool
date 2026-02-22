//! Beads integration tests using mock-bd
//!
//! These tests use the bd-fake script to simulate the beads CLI,
//! enabling deterministic testing without network dependencies.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// Get the path to the tugtool binary
fn tug_binary() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // crates
    path.pop(); // repo root
    path.push("target");
    path.push("debug");
    path.push("tugcode");
    path
}

/// Get the path to the bd-fake script
fn bd_fake_path() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // crates
    path.pop(); // repo root
    path.push("tests");
    path.push("bin");
    path.push("bd-fake");
    path
}

/// Create a temp directory with .tugtool and .beads initialized
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

    // Create .beads directory (required for beads commands)
    fs::create_dir(temp.path().join(".beads")).expect("failed to create .beads dir");

    temp
}

/// Create a test plan in the project
fn create_test_plan(temp_dir: &tempfile::TempDir, name: &str, content: &str) {
    let plan_path = temp_dir
        .path()
        .join(".tugtool")
        .join(format!("tugplan-{}.md", name));
    fs::write(&plan_path, content).expect("failed to write test plan");
}

/// Minimal plan with one step
const SINGLE_STEP_PLAN: &str = r#"## Phase 1.0: Test Feature {#phase-1}

**Purpose:** Test plan for beads integration testing.

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

Test context.

---

### 1.0.0 Design Decisions {#design-decisions}

None.

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Setup {#step-0}

**Commit:** `feat: setup`

**References:** (#context)

**Tasks:**
- [ ] Create project

**Checkpoint:**
- [ ] Build passes

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Working feature.
"#;

/// Plan with multiple steps and dependencies
const MULTI_STEP_PLAN: &str = r#"## Phase 1.0: Multi-Step Feature {#phase-1}

**Purpose:** Test plan with dependencies for beads integration testing.

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

Test context.

---

### 1.0.0 Design Decisions {#design-decisions}

None.

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Foundation {#step-0}

**Commit:** `feat: foundation`

**References:** (#context)

**Tasks:**
- [ ] Create base

**Checkpoint:**
- [ ] Base works

---

#### Step 1: Build on Foundation {#step-1}

**Depends on:** #step-0

**Commit:** `feat: build`

**References:** (#context)

**Tasks:**
- [ ] Build feature

**Checkpoint:**
- [ ] Feature works

---

#### Step 2: Final Integration {#step-2}

**Depends on:** #step-0, #step-1

**Commit:** `feat: integrate`

**References:** (#context)

**Tasks:**
- [ ] Integrate all

**Checkpoint:**
- [ ] All works

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Complete feature.
"#;

// =============================================================================
// Mock-bd unit tests
// =============================================================================

#[test]
fn test_mock_bd_create_returns_valid_issue_json() {
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    let output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Test Issue", "--json"])
        .output()
        .expect("failed to run bd-fake create");

    assert!(output.status.success(), "bd create should succeed");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");

    // Verify required fields per Beads JSON Contract
    assert!(json["id"].is_string(), "should have id");
    assert!(json["title"].is_string(), "should have title");
    assert!(json["status"].is_string(), "should have status");
    assert!(json["priority"].is_number(), "should have priority");
    assert!(json["issue_type"].is_string(), "should have issue_type");

    assert_eq!(json["title"], "Test Issue");
    assert_eq!(json["status"], "open");
}

#[test]
fn test_mock_bd_show_returns_issue_details() {
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Create an issue first
    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Test Issue", "--json"])
        .output()
        .expect("failed to run bd-fake create");

    // Show the issue
    let output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["show", "bd-fake-1", "--json"])
        .output()
        .expect("failed to run bd-fake show");

    assert!(output.status.success(), "bd show should succeed");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");

    // Show returns single object (contract allows array or object)
    assert!(json["id"].is_string(), "should have id");
    assert!(
        json["dependencies"].is_array(),
        "should have dependencies array"
    );
}

#[test]
fn test_mock_bd_dep_add_and_list_track_dependencies() {
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Create two issues
    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Parent", "--json"])
        .output()
        .expect("failed to create parent");

    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Child", "--json"])
        .output()
        .expect("failed to create child");

    // Add dependency: Child depends on Parent
    let add_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["dep", "add", "bd-fake-2", "bd-fake-1", "--json"])
        .output()
        .expect("failed to add dep");

    assert!(add_output.status.success(), "dep add should succeed");

    let add_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&add_output.stdout))
            .expect("should be valid JSON");
    assert_eq!(add_json["status"], "added");

    // List dependencies
    let list_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["dep", "list", "bd-fake-2", "--json"])
        .output()
        .expect("failed to list deps");

    assert!(list_output.status.success(), "dep list should succeed");

    let list_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&list_output.stdout))
            .expect("should be valid JSON");

    assert!(list_json.is_array(), "dep list should return array");
    assert_eq!(list_json.as_array().unwrap().len(), 1);
    assert_eq!(list_json[0]["id"], "bd-fake-1");
}

#[test]
fn test_mock_bd_init_with_prefix() {
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Initialize with custom prefix
    let init_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["init", "--prefix", "auth"])
        .output()
        .expect("failed to init with prefix");

    assert!(init_output.status.success(), "init --prefix failed");

    // Create root issue
    let root_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Root Issue", "--json"])
        .output()
        .expect("failed to create root issue");

    assert!(root_output.status.success(), "create root failed");
    let root_json: serde_json::Value =
        serde_json::from_slice(&root_output.stdout).expect("failed to parse root JSON");

    let root_id = root_json["id"].as_str().expect("root id missing");
    assert!(
        root_id.starts_with("auth-"),
        "root ID should start with 'auth-', got: {}",
        root_id
    );

    // Create child issue
    let child_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Child", "--parent", root_id, "--json"])
        .output()
        .expect("failed to create child");

    assert!(child_output.status.success(), "create child failed");
    let child_json: serde_json::Value =
        serde_json::from_slice(&child_output.stdout).expect("failed to parse child JSON");

    let child_id = child_json["id"].as_str().expect("child id missing");
    let expected_prefix = format!("{}.", root_id);
    assert!(
        child_id.starts_with(&expected_prefix),
        "child ID should start with '{}', got: {}",
        expected_prefix,
        child_id
    );
}

#[test]
fn test_mock_bd_ready_returns_unblocked_issues() {
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Create parent and children
    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Root", "--type", "epic", "--json"])
        .output()
        .expect("failed to create root");

    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Step 0", "--parent", "bd-fake-1", "--json"])
        .output()
        .expect("failed to create step 0");

    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Step 1", "--parent", "bd-fake-1", "--json"])
        .output()
        .expect("failed to create step 1");

    // Add dependency: Step 1 depends on Step 0
    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["dep", "add", "bd-fake-1.2", "bd-fake-1.1", "--json"])
        .output()
        .expect("failed to add dep");

    // Check ready - only Step 0 should be ready
    let ready_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["ready", "--parent", "bd-fake-1", "--json"])
        .output()
        .expect("failed to get ready");

    let ready_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&ready_output.stdout))
            .expect("should be valid JSON");

    assert!(ready_json.is_array());
    let ready_arr = ready_json.as_array().unwrap();
    assert_eq!(ready_arr.len(), 1, "only Step 0 should be ready");
    assert_eq!(ready_arr[0]["id"], "bd-fake-1.1");

    // Close Step 0
    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["close", "bd-fake-1.1"])
        .output()
        .expect("failed to close");

    // Now Step 1 should be ready
    let ready_after = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["ready", "--parent", "bd-fake-1", "--json"])
        .output()
        .expect("failed to get ready after close");

    let ready_after_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&ready_after.stdout))
            .expect("should be valid JSON");

    let ready_after_arr = ready_after_json.as_array().unwrap();
    assert_eq!(ready_after_arr.len(), 1);
    assert_eq!(ready_after_arr[0]["id"], "bd-fake-1.2");
}

// =============================================================================
// Beads sync integration tests
// =============================================================================

#[test]
fn test_beads_sync_creates_root_and_step_beads() {
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");
    create_test_plan(&temp, "test", SINGLE_STEP_PLAN);

    // Run tug beads sync with mock bd
    let output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "sync", "tugplan-test.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug beads sync");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        output.status.success(),
        "beads sync should succeed. stdout: {}, stderr: {}",
        stdout,
        stderr
    );

    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");

    assert_eq!(json["status"], "ok");
    assert!(
        json["data"]["root_bead_id"].is_string(),
        "should have root bead ID"
    );
    assert!(
        json["data"]["steps_synced"].as_u64().unwrap() >= 1,
        "should sync at least 1 step"
    );

    // Verify bead_mapping is present in JSON output
    assert!(
        json["data"]["bead_mapping"].is_object(),
        "should have bead_mapping in JSON output"
    );
    assert!(
        !json["data"]["bead_mapping"].as_object().unwrap().is_empty(),
        "bead_mapping should contain at least one entry"
    );

    // Verify the plan file was NOT modified (no bead annotations)
    let plan_content = fs::read_to_string(temp.path().join(".tugtool/tugplan-test.md"))
        .expect("failed to read plan");

    assert!(
        !plan_content.contains("**Bead:**") && !plan_content.contains("Beads Root"),
        "plan should NOT contain bead ID annotations (they are in JSON output only)"
    );
}

#[test]
fn test_beads_sync_is_idempotent() {
    // Validates that running sync twice on the same plan doesn't create duplicate beads.
    // With title-based matching, the second sync should find and reuse existing beads.
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");
    create_test_plan(&temp, "test", SINGLE_STEP_PLAN);

    // Run sync twice
    for i in 1..=2 {
        let output = Command::new(tug_binary())
            .env("TUG_BD_PATH", bd_fake_path())
            .env("TUG_BD_STATE", temp_state.path())
            .args(["beads", "sync", "tugplan-test.md", "--json"])
            .current_dir(temp.path())
            .output()
            .expect("failed to run tug beads sync");

        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success(),
            "beads sync run {} should succeed: {}",
            i,
            stdout
        );
    }

    // After two syncs, there should still be only one root bead
    let issues_file = temp_state.path().join("issues.json");
    let issues_content = fs::read_to_string(&issues_file).expect("failed to read issues");
    let issues: serde_json::Value =
        serde_json::from_str(&issues_content).expect("should be valid JSON");

    // Count root-level issues (no dots in ID)
    let root_count = issues
        .as_object()
        .unwrap()
        .keys()
        .filter(|k| !k.contains('.'))
        .count();

    assert_eq!(
        root_count, 1,
        "should have exactly one root bead after idempotent syncs"
    );
}

#[test]
fn test_beads_sync_creates_dependency_edges() {
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");
    create_test_plan(&temp, "multi", MULTI_STEP_PLAN);

    // Run sync
    let output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "sync", "tugplan-multi.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run tug beads sync");

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "sync should succeed: {}", stdout);

    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");
    assert!(
        json["data"]["deps_added"].as_u64().unwrap() >= 2,
        "should add dependency edges for step-1 and step-2"
    );

    // Verify dependencies in mock state
    let deps_file = temp_state.path().join("deps.json");
    let deps_content = fs::read_to_string(&deps_file).expect("failed to read deps");
    let deps: serde_json::Value =
        serde_json::from_str(&deps_content).expect("should be valid JSON");

    assert!(
        deps.as_array().unwrap().len() >= 2,
        "should have at least 2 dependency edges"
    );
}

// =============================================================================
// Beads status integration tests
// =============================================================================

#[test]
fn test_beads_status_computes_readiness() {
    // Validates that `beads status` correctly computes readiness based on dependencies.
    // With title-based matching, status resolves beads by title and shows correct readiness.
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");
    create_test_plan(&temp, "multi", MULTI_STEP_PLAN);

    // Run sync first to create beads
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "sync", "tugplan-multi.md"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run sync");

    // Check status
    let output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "status", "tugplan-multi.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run status");

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "status should succeed: {}", stdout);

    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");

    // All steps should initially be ready (open with deps not closed)
    // Step 0: ready (no deps)
    // Step 1: blocked (depends on step-0 which is open)
    // Step 2: blocked (depends on step-0 and step-1)
    let steps = json["data"]["files"][0]["steps"].as_array().unwrap();

    // Find step statuses
    let step_0_status = steps.iter().find(|s| s["anchor"] == "step-0").unwrap();
    let step_1_status = steps.iter().find(|s| s["anchor"] == "step-1").unwrap();
    let step_2_status = steps.iter().find(|s| s["anchor"] == "step-2").unwrap();

    assert_eq!(
        step_0_status["status"], "ready",
        "Step 0 has no deps, should be ready"
    );
    assert_eq!(
        step_1_status["status"], "blocked",
        "Step 1 depends on Step 0, should be blocked"
    );
    assert_eq!(
        step_2_status["status"], "blocked",
        "Step 2 depends on Step 0 and 1, should be blocked"
    );
}

// =============================================================================
// Beads pull integration tests
// =============================================================================

#[test]
fn test_beads_pull_updates_checkboxes() {
    // Validates that `beads pull` updates checkboxes based on bead status.
    // With title-based matching, pull resolves beads by title and updates checkboxes.
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");
    create_test_plan(&temp, "test", SINGLE_STEP_PLAN);

    // Run sync to create beads
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "sync", "tugplan-test.md"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run sync");

    // Get the step bead ID from the mock state
    let issues_content =
        fs::read_to_string(temp_state.path().join("issues.json")).expect("failed to read issues");
    let issues: serde_json::Value = serde_json::from_str(&issues_content).unwrap();

    // Find the step bead (child of root)
    let step_bead_id = issues
        .as_object()
        .unwrap()
        .keys()
        .find(|k| k.contains('.'))
        .expect("should have a step bead");

    // Close the step bead in mock
    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["close", step_bead_id])
        .output()
        .expect("failed to close bead");

    // Run pull to update checkboxes
    let output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "pull", "tugplan-test.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run pull");

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "pull should succeed: {}", stdout);

    let json: serde_json::Value = serde_json::from_str(&stdout).expect("should be valid JSON");

    // Verify checkboxes were updated
    assert!(
        json["data"]["total_updated"].as_u64().unwrap() >= 1,
        "should update at least one checkbox"
    );

    // Verify the plan file has checked checkboxes
    let plan_content = fs::read_to_string(temp.path().join(".tugtool/tugplan-test.md"))
        .expect("failed to read plan");

    // The checkpoint checkbox should be checked
    assert!(
        plan_content.contains("[x] Build passes") || plan_content.contains("[X] Build passes"),
        "checkpoint checkbox should be checked after pull"
    );
}

// =============================================================================
// Full workflow integration test (as documented in README)
// =============================================================================

#[test]
fn test_full_beads_workflow_sync_work_pull() {
    // This test exercises the complete workflow documented in README:
    // 1. tug beads sync (Plan → Beads)
    // 2. bd close (Work in Beads)
    // 3. tug beads status (Check readiness)
    // 4. tug beads pull (Beads → Plan)

    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");
    create_test_plan(&temp, "workflow", MULTI_STEP_PLAN);

    // Step 1: Sync plan to beads
    let sync_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "sync", "tugplan-workflow.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run sync");

    assert!(sync_output.status.success(), "sync should succeed");
    let sync_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&sync_output.stdout)).unwrap();
    assert_eq!(sync_json["data"]["steps_synced"], 3, "should sync 3 steps");

    // Step 2: Check initial status - Step 0 should be ready, others blocked
    let status_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "status", "tugplan-workflow.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run status");

    let status_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&status_output.stdout)).unwrap();
    let steps = status_json["data"]["files"][0]["steps"].as_array().unwrap();
    let step_0 = steps.iter().find(|s| s["anchor"] == "step-0").unwrap();
    assert_eq!(
        step_0["status"], "ready",
        "Step 0 should be ready initially"
    );

    // Step 3: Simulate work completion - close Step 0's bead
    let step_0_bead_id = step_0["bead_id"].as_str().unwrap();
    Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["close", step_0_bead_id])
        .output()
        .expect("failed to close step 0 bead");

    // Step 4: Check status again - Step 0 complete, Step 1 now ready
    let status_after_work = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "status", "tugplan-workflow.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run status after work");

    let status_after_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&status_after_work.stdout)).unwrap();
    let steps_after = status_after_json["data"]["files"][0]["steps"]
        .as_array()
        .unwrap();

    let step_0_after = steps_after
        .iter()
        .find(|s| s["anchor"] == "step-0")
        .unwrap();
    let step_1_after = steps_after
        .iter()
        .find(|s| s["anchor"] == "step-1")
        .unwrap();

    assert_eq!(
        step_0_after["status"], "complete",
        "Step 0 should be complete after closing bead"
    );
    assert_eq!(
        step_1_after["status"], "ready",
        "Step 1 should be ready after Step 0 complete"
    );

    // Step 5: Pull completion back to checkboxes
    let pull_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "pull", "tugplan-workflow.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run pull");

    assert!(pull_output.status.success(), "pull should succeed");
    let pull_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&pull_output.stdout)).unwrap();
    assert!(
        pull_json["data"]["total_updated"].as_u64().unwrap() >= 1,
        "should update checkboxes from completed bead"
    );

    // Verify checkboxes were updated in plan file
    let plan_after_pull = fs::read_to_string(temp.path().join(".tugtool/tugplan-workflow.md"))
        .expect("failed to read plan after pull");
    assert!(
        plan_after_pull.contains("[x] Base works") || plan_after_pull.contains("[X] Base works"),
        "Step 0 checkpoint should be checked after pull"
    );
}

// =============================================================================
// Bead-mediated communication CLI integration tests
// =============================================================================

#[test]
fn test_beads_append_design_adds_content_with_separator() {
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Create a bead via bd-fake
    let create_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Test Step", "--json"])
        .output()
        .expect("failed to create bead");

    let create_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&create_output.stdout)).unwrap();
    let bead_id = create_json["id"].as_str().unwrap();

    // Append design via tug beads append-design
    let append_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "append-design",
            bead_id,
            "Strategy: use exponential backoff",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to append design");

    assert!(
        append_output.status.success(),
        "append-design should succeed: {}",
        String::from_utf8_lossy(&append_output.stderr)
    );

    // Inspect to verify design field
    let inspect_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "inspect", bead_id, "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to inspect bead");

    let inspect_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&inspect_output.stdout)).unwrap();

    let design = inspect_json["data"]["design"].as_str().unwrap();
    // When appending to empty field, no separator is added
    assert!(
        !design.contains("---"),
        "design should NOT contain separator when starting empty"
    );
    assert!(
        design.contains("Strategy: use exponential backoff"),
        "design should contain appended content"
    );
    assert_eq!(
        design.trim(),
        "Strategy: use exponential backoff",
        "design should be just the appended content (no separator)"
    );
}

#[test]
fn test_beads_update_notes_overwrites_content() {
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Create a bead
    let create_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Test Step", "--json"])
        .output()
        .expect("failed to create bead");

    let create_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&create_output.stdout)).unwrap();
    let bead_id = create_json["id"].as_str().unwrap();

    // Update notes (first time)
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "update-notes",
            bead_id,
            "First implementation",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to update notes first time");

    // Update notes (second time - should overwrite)
    let update_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "update-notes",
            bead_id,
            "Second implementation - revised",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to update notes second time");

    assert!(
        update_output.status.success(),
        "update-notes should succeed"
    );

    // Inspect to verify notes were overwritten
    let inspect_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "inspect", bead_id, "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to inspect bead");

    let inspect_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&inspect_output.stdout)).unwrap();

    let notes = inspect_json["data"]["notes"].as_str().unwrap();
    assert!(
        !notes.contains("First implementation"),
        "notes should not contain old content after overwrite"
    );
    assert!(
        notes.contains("Second implementation - revised"),
        "notes should contain new content"
    );
}

#[test]
fn test_beads_append_notes_preserves_existing_content() {
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Create a bead
    let create_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Test Step", "--json"])
        .output()
        .expect("failed to create bead");

    let create_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&create_output.stdout)).unwrap();
    let bead_id = create_json["id"].as_str().unwrap();

    // Coder updates notes
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "update-notes",
            bead_id,
            "Coder: implementation complete",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to update notes");

    // Reviewer appends notes
    let append_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "append-notes",
            bead_id,
            "Reviewer: APPROVE - all tests pass",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to append notes");

    assert!(
        append_output.status.success(),
        "append-notes should succeed"
    );

    // Inspect to verify both entries present
    let inspect_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "inspect", bead_id, "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to inspect bead");

    let inspect_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&inspect_output.stdout)).unwrap();

    let notes = inspect_json["data"]["notes"].as_str().unwrap();
    assert!(
        notes.contains("---"),
        "notes should contain separator between coder and reviewer"
    );
    assert!(
        notes.contains("Coder: implementation complete"),
        "notes should contain coder content"
    );
    assert!(
        notes.contains("Reviewer: APPROVE - all tests pass"),
        "notes should contain reviewer content"
    );
}

#[test]
fn test_beads_inspect_shows_all_fields() {
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Create a bead
    let create_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "create",
            "Test Step",
            "--description",
            "Test task",
            "--json",
        ])
        .output()
        .expect("failed to create bead");

    let create_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&create_output.stdout)).unwrap();
    let bead_id = create_json["id"].as_str().unwrap();

    // Add design
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "append-design",
            bead_id,
            "Design: strategy here",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to append design");

    // Add notes
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "update-notes",
            bead_id,
            "Notes: implementation results",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to update notes");

    // Inspect
    let inspect_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "inspect", bead_id, "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to inspect");

    assert!(inspect_output.status.success(), "inspect should succeed");

    let inspect_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&inspect_output.stdout)).unwrap();

    // Verify all fields are present
    assert!(
        inspect_json["data"]["bead_id"].is_string(),
        "should have bead_id"
    );
    assert!(
        inspect_json["data"]["title"].is_string(),
        "should have title"
    );
    assert!(
        inspect_json["data"]["description"].is_string(),
        "should have description"
    );
    assert!(
        inspect_json["data"]["design"].is_string(),
        "should have design"
    );
    assert!(
        inspect_json["data"]["notes"].is_string(),
        "should have notes"
    );
    assert!(
        inspect_json["data"]["status"].is_string(),
        "should have status"
    );

    assert!(
        inspect_json["data"]["design"]
            .as_str()
            .unwrap()
            .contains("Design: strategy here"),
        "design field should contain appended content"
    );
    assert!(
        inspect_json["data"]["notes"]
            .as_str()
            .unwrap()
            .contains("Notes: implementation results"),
        "notes field should contain updated content"
    );
}

#[test]
fn test_full_agent_cycle_bead_audit_trail() {
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");
    create_test_plan(&temp, "agent-cycle", SINGLE_STEP_PLAN);

    // Step 1: Sync plan to create beads with description
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "sync", "tugplan-agent-cycle.md", "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to sync");

    // Get step bead ID from mock state
    let issues_content =
        fs::read_to_string(temp_state.path().join("issues.json")).expect("failed to read issues");
    let issues: serde_json::Value = serde_json::from_str(&issues_content).unwrap();
    let step_bead_id = issues
        .as_object()
        .unwrap()
        .keys()
        .find(|k| k.contains('.'))
        .expect("should have step bead");

    // Step 2: Architect appends design
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "append-design",
            step_bead_id,
            "Architect: approach is to create project structure",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to append design");

    // Step 3: Coder updates notes
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "update-notes",
            step_bead_id,
            "Coder: created files, tests pass",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to update notes");

    // Step 4: Reviewer appends notes
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "append-notes",
            step_bead_id,
            "Reviewer: APPROVE - plan conformance verified",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to append notes");

    // Step 5: Close bead with reason
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "close",
            step_bead_id,
            "--reason",
            "Step 0 complete: project created",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to close bead");

    // Step 6: Inspect to verify complete audit trail
    let inspect_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "inspect", step_bead_id, "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to inspect");

    let inspect_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&inspect_output.stdout)).unwrap();

    // Verify complete audit trail
    assert_eq!(
        inspect_json["data"]["status"], "closed",
        "bead should be closed"
    );

    let description = inspect_json["data"]["description"].as_str().unwrap();
    assert!(
        description.contains("Create project") || !description.is_empty(),
        "description should contain step task"
    );

    let design = inspect_json["data"]["design"].as_str().unwrap();
    assert!(
        design.contains("Architect: approach is to create project structure"),
        "design should contain architect strategy"
    );

    let notes = inspect_json["data"]["notes"].as_str().unwrap();
    assert!(
        notes.contains("Coder: created files, tests pass"),
        "notes should contain coder results"
    );
    assert!(
        notes.contains("Reviewer: APPROVE - plan conformance verified"),
        "notes should contain reviewer approval"
    );

    let close_reason = inspect_json["data"]["close_reason"].as_str().unwrap();
    assert!(
        close_reason.contains("Step 0 complete"),
        "close_reason should contain completion summary"
    );
}

#[test]
fn test_revision_loop_update_notes_overwrites() {
    let temp = setup_test_project();
    let temp_state = tempfile::tempdir().expect("failed to create temp state dir");

    // Create a bead
    let create_output = Command::new(bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["create", "Test Step", "--json"])
        .output()
        .expect("failed to create bead");

    let create_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&create_output.stdout)).unwrap();
    let bead_id = create_json["id"].as_str().unwrap();

    // Iteration 1: Coder updates notes
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "update-notes",
            bead_id,
            "Coder v1: implementation attempt",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to update notes v1");

    // Reviewer appends notes
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "append-notes",
            bead_id,
            "Reviewer v1: REVISE - missing tests",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to append notes v1");

    // Iteration 2: Coder updates notes again (should overwrite BOTH coder v1 AND reviewer v1)
    Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args([
            "beads",
            "update-notes",
            bead_id,
            "Coder v2: revised with tests added",
            "--json",
        ])
        .current_dir(temp.path())
        .output()
        .expect("failed to update notes v2");

    // Inspect to verify overwrite semantics
    let inspect_output = Command::new(tug_binary())
        .env("TUG_BD_PATH", bd_fake_path())
        .env("TUG_BD_STATE", temp_state.path())
        .args(["beads", "inspect", bead_id, "--json"])
        .current_dir(temp.path())
        .output()
        .expect("failed to inspect");

    let inspect_json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&inspect_output.stdout)).unwrap();

    let notes = inspect_json["data"]["notes"].as_str().unwrap();

    // Notes should ONLY contain coder v2 - all previous content overwritten
    assert!(
        !notes.contains("Coder v1: implementation attempt"),
        "notes should not contain old coder content"
    );
    assert!(
        !notes.contains("Reviewer v1: REVISE - missing tests"),
        "notes should not contain old reviewer content (update-notes overwrites all)"
    );
    assert!(
        notes.contains("Coder v2: revised with tests added"),
        "notes should contain new coder content"
    );
}

#[test]
fn test_standalone_sync_errors_outside_worktree() {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    // Run tug init to create .tugtool/ but DON'T create .beads/
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

    // Create a minimal tugplan
    let plan_content = r#"# Test Plan

## Execution Plan

### Phase 1

#### Step 0 {#step-0}

**Task:** Do something

**Checkpoint:**
- [ ] Something done
"#;
    fs::write(temp.path().join(".tugtool/tugplan-test.md"), plan_content)
        .expect("failed to write tugplan");

    // Run beads sync without .beads/ directory (should fail with E013)
    let sync_output = Command::new(tug_binary())
        .args(["beads", "sync", ".tugtool/tugplan-test.md", "--json"])
        .env("TUG_BD_PATH", bd_fake_path())
        .current_dir(temp.path())
        .output()
        .expect("failed to run beads sync");

    // Should fail
    assert!(
        !sync_output.status.success(),
        "beads sync should fail outside worktree"
    );

    // Parse JSON output
    let json: serde_json::Value =
        serde_json::from_str(&String::from_utf8_lossy(&sync_output.stdout))
            .expect("failed to parse JSON");

    // Check status is error
    assert_eq!(
        json["status"].as_str().unwrap(),
        "error",
        "Status should be error"
    );

    // Check issues array contains E013
    let issues = json["issues"].as_array().expect("Should have issues array");
    assert!(!issues.is_empty(), "Issues array should not be empty");

    let first_issue = &issues[0];
    assert_eq!(
        first_issue["code"].as_str().unwrap(),
        "E013",
        "Should return E013 error code"
    );

    // Check error message mentions worktree
    let error_msg = first_issue["message"].as_str().unwrap();
    assert!(
        error_msg.contains("worktree") || error_msg.contains("tugcode worktree create"),
        "Error message should mention worktree: {}",
        error_msg
    );
}
