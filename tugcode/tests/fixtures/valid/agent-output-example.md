## Phase 1.0: Example Agent Output {#phase-1}

**Purpose:** Demonstrates what a plan looks like after agent execution, including bead IDs and completed checkpoints.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | tug-planner |
| Status | active |
| Target branch | feature/example |
| Tracking issue/PR | #42 |
| Last updated | 2026-02-04 |
| Beads Root | `bd-abc123` |

---

### Phase Overview {#phase-overview}

#### Context {#context}

This plan demonstrates the output format after agents have processed it.
Key features shown:
- Bead IDs written by `tug beads sync`
- Checked checkboxes from completed work
- Agent-generated references

#### Strategy {#strategy}

- Show bead ID placement (Beads Root in metadata, Bead per step)
- Demonstrate checkpoint completion markers
- Include realistic references

#### Success Criteria (Measurable) {#success-criteria}

- All steps have valid structure
- Bead IDs appear in correct positions

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Use Standard Bead Format (DECIDED) {#d01-bead-format}

**Decision:** Bead IDs follow the pattern `bd-<hash>` with optional `.N` suffix for substeps.

**Rationale:**
- Consistent with Beads CLI output
- Supports hierarchical relationships

**Implications:**
- Validation can check bead ID format

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Bootstrap {#step-0}

**Bead:** `bd-def456`

**Commit:** `feat: initial project setup`

**References:** [D01] Use standard bead format, (#context, #strategy)

**Artifacts:**
- Project structure
- Initial configuration

**Tasks:**
- [x] Create directory structure
- [x] Add configuration files
- [x] Set up build system

**Tests:**
- [x] Project builds successfully
- [x] Configuration loads correctly

**Checkpoint:**
- [x] `cargo build` succeeds
- [x] `cargo test` passes

**Rollback:**
- Remove created directories

**Commit after all checkpoints pass.**

---

#### Step 1: Core Implementation {#step-1}

**Depends on:** #step-0

**Bead:** `bd-ghi789`

**Commit:** `feat: implement core functionality`

**References:** [D01] Use standard bead format

**Artifacts:**
- Core module
- Public API

**Tasks:**
- [x] Define core types
- [x] Implement main logic
- [ ] Add error handling

**Tests:**
- [x] Unit tests for types
- [ ] Integration tests

**Checkpoint:**
- [x] Core module compiles
- [ ] All tests pass

**Rollback:**
- Revert to Step 0 commit

**Commit after all checkpoints pass.**

---

#### Step 2: Documentation {#step-2}

**Depends on:** #step-1

**Bead:** `bd-jkl012`

**Commit:** `docs: add documentation`

**References:** [D01] Use standard bead format

**Artifacts:**
- README.md
- API documentation

**Tasks:**
- [ ] Write README
- [ ] Generate API docs
- [ ] Add examples

**Tests:**
- [ ] Documentation renders correctly

**Checkpoint:**
- [ ] README exists and is accurate
- [ ] `cargo doc` succeeds

**Rollback:**
- Remove documentation files

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables {#deliverables}

**Deliverable:** Complete example showing agent output format

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [x] Steps have bead IDs
- [x] Some checkboxes are checked (showing progress)
- [ ] All checkboxes checked (phase complete)

| Checkpoint | Verification |
|------------|--------------|
| Bead format | IDs match `bd-*` pattern |
| Progress tracking | Checkboxes reflect actual state |
