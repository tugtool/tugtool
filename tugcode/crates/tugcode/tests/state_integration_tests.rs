//! Integration tests for state command lifecycle

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::Duration;

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

/// Create a temp directory with .tugtool initialized and git repo set up
fn setup_test_git_repo() -> tempfile::TempDir {
    let temp = tempfile::tempdir().expect("failed to create temp dir");

    // Initialize git repo with explicit main branch
    let output = Command::new("git")
        .args(["init", "-b", "main"])
        .current_dir(temp.path())
        .output()
        .expect("failed to run git init");
    assert!(output.status.success(), "git init failed");

    // Configure git user
    Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(temp.path())
        .output()
        .expect("failed to configure git user");

    Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(temp.path())
        .output()
        .expect("failed to configure git email");

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

    // Create initial commit
    Command::new("git")
        .args(["add", "."])
        .current_dir(temp.path())
        .output()
        .expect("failed to stage files");

    Command::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(temp.path())
        .output()
        .expect("failed to create initial commit");

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

**Purpose:** Test plan for state integration testing.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-02-08 |

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

#### Step 0: Setup {#step-0}

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

#### Step 1: Implementation {#step-1}

**Depends on:** #step-0

**Commit:** `feat: implement`

**References:** [D01] Test Decision, (#context)

**Tasks:**
- [ ] Implement feature

**Tests:**
- [ ] Integration test

**Checkpoint:**
- [ ] Tests pass

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Working test feature.

#### Phase Exit Criteria {#exit-criteria}

- [ ] All tests pass
"#;

#[test]
fn test_state_claim_start_heartbeat_lifecycle() {
    let temp = setup_test_git_repo();
    create_test_plan(&temp, "test-state", MINIMAL_PLAN);

    // Commit the plan file
    Command::new("git")
        .args(["add", ".tugtool/tugplan-test-state.md"])
        .current_dir(temp.path())
        .output()
        .expect("failed to stage plan");

    Command::new("git")
        .args(["commit", "-m", "Add test plan"])
        .current_dir(temp.path())
        .output()
        .expect("failed to commit plan");

    // Step 1: Initialize state
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("init")
        .arg(".tugtool/tugplan-test-state.md")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run state init");

    assert!(
        output.status.success(),
        "state init failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let init_json: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse init JSON");
    assert_eq!(init_json["status"], "ok");
    assert_eq!(init_json["data"]["step_count"], 2); // step-0 and step-1

    // Step 2: Claim a step
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("claim")
        .arg(".tugtool/tugplan-test-state.md")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run state claim");

    assert!(
        output.status.success(),
        "state claim failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let claim_json: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse claim JSON");
    assert_eq!(claim_json["status"], "ok");
    assert_eq!(claim_json["data"]["claimed"], true);
    assert_eq!(claim_json["data"]["anchor"], "step-0");
    assert!(claim_json["data"]["lease_expires"].is_string());

    // Step 3: Start the claimed step
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("start")
        .arg(".tugtool/tugplan-test-state.md")
        .arg("step-0")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run state start");

    assert!(
        output.status.success(),
        "state start failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let start_json: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse start JSON");
    assert_eq!(start_json["status"], "ok");
    assert_eq!(start_json["data"]["anchor"], "step-0");
    assert_eq!(start_json["data"]["started"], true);

    // Sleep briefly to ensure timestamp changes (now_iso8601 has millisecond precision)
    thread::sleep(Duration::from_millis(10));

    // Step 4: Send heartbeat
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("heartbeat")
        .arg(".tugtool/tugplan-test-state.md")
        .arg("step-0")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run state heartbeat");

    assert!(
        output.status.success(),
        "state heartbeat failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let heartbeat_json: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse heartbeat JSON");
    assert_eq!(heartbeat_json["status"], "ok");
    assert_eq!(heartbeat_json["data"]["anchor"], "step-0");
    assert!(heartbeat_json["data"]["lease_expires"].is_string());

    // Verify the lease was extended (different from claim lease)
    let claim_lease = claim_json["data"]["lease_expires"].as_str().unwrap();
    let heartbeat_lease = heartbeat_json["data"]["lease_expires"].as_str().unwrap();
    assert_ne!(
        claim_lease, heartbeat_lease,
        "heartbeat should extend the lease"
    );
}

#[test]
fn test_state_update_artifact_complete_lifecycle() {
    let temp = setup_test_git_repo();
    create_test_plan(&temp, "test-state-full", MINIMAL_PLAN);

    // Commit the plan file
    Command::new("git")
        .args(["add", ".tugtool/tugplan-test-state-full.md"])
        .current_dir(temp.path())
        .output()
        .expect("failed to stage plan");

    Command::new("git")
        .args(["commit", "-m", "Add test plan"])
        .current_dir(temp.path())
        .output()
        .expect("failed to commit plan");

    // Step 1: Initialize state
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("init")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run state init");

    assert!(
        output.status.success(),
        "state init failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    // Step 2: Claim and start a step
    Command::new(tug_binary())
        .arg("state")
        .arg("claim")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .current_dir(temp.path())
        .output()
        .expect("failed to claim");

    Command::new(tug_binary())
        .arg("state")
        .arg("start")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("step-0")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .current_dir(temp.path())
        .output()
        .expect("failed to start");

    // Step 3: Update checklist items
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("update")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("step-0")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .arg("--task")
        .arg("1:completed")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run state update");

    assert!(
        output.status.success(),
        "state update failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let update_json: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse update JSON");
    assert_eq!(update_json["status"], "ok");
    assert_eq!(update_json["data"]["items_updated"], 1);

    // Step 4: Record an artifact
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("artifact")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("step-0")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .arg("--kind")
        .arg("architect_strategy")
        .arg("--summary")
        .arg("Test artifact summary")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run state artifact");

    assert!(
        output.status.success(),
        "state artifact failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let artifact_json: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse artifact JSON");
    assert_eq!(artifact_json["status"], "ok");
    assert_eq!(artifact_json["data"]["kind"], "architect_strategy");
    assert!(artifact_json["data"]["artifact_id"].is_number());

    // Step 5: Complete all remaining checklist items
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("update")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("step-0")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .arg("--all")
        .arg("completed")
        .current_dir(temp.path())
        .output()
        .expect("failed to complete all items");

    assert!(output.status.success());

    // Step 6: Complete the step
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("complete")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("step-0")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to run state complete");

    assert!(
        output.status.success(),
        "state complete failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let complete_json: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse complete JSON");
    assert_eq!(complete_json["status"], "ok");
    assert_eq!(complete_json["data"]["completed"], true);
    assert_eq!(complete_json["data"]["forced"], false);

    // Step 7: Test force complete on another step
    // Claim step-1 (depends on step-0 which is now complete)
    Command::new(tug_binary())
        .arg("state")
        .arg("claim")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .current_dir(temp.path())
        .output()
        .expect("failed to claim step-1");

    Command::new(tug_binary())
        .arg("state")
        .arg("start")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("step-1")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .current_dir(temp.path())
        .output()
        .expect("failed to start step-1");

    // Force complete without completing checklist items
    let output = Command::new(tug_binary())
        .arg("state")
        .arg("complete")
        .arg(".tugtool/tugplan-test-state-full.md")
        .arg("step-1")
        .arg("--worktree")
        .arg("/tmp/test-worktree")
        .arg("--force")
        .arg("--reason")
        .arg("testing force mode")
        .arg("--json")
        .current_dir(temp.path())
        .output()
        .expect("failed to force complete");

    assert!(
        output.status.success(),
        "force complete failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let force_complete_json: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("failed to parse force complete JSON");
    assert_eq!(force_complete_json["status"], "ok");
    assert_eq!(force_complete_json["data"]["forced"], true);
}
