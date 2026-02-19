## Phase 1.0: Substep Test {#phase-1}

**Purpose:** A valid plan demonstrating nested step structure with substeps.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test Owner |
| Status | draft |
| Target branch | feature/substeps |
| Last updated | 2026-02-03 |

---

### Phase Overview {#phase-overview}

This plan demonstrates the substep pattern where large steps are broken into
smaller, independently committable substeps (e.g., Step 2.1, Step 2.2).

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Use Substeps for Large Work (DECIDED) {#d01-substeps}

**Decision:** Break large steps into substeps with separate commits.

**Rationale:**
- Smaller commits are easier to review
- Substeps provide natural checkpoints

**Implications:**
- Each substep has its own commit and checkpoint

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Bootstrap {#step-0}

**Commit:** `feat: initial setup for substep demo`

**References:** [D01] Use substeps for large work

**Artifacts:**
- Initial project structure

**Tasks:**
- [ ] Create base structure

**Tests:**
- [ ] Verify structure exists

**Checkpoint:**
- [ ] Project compiles

**Rollback:**
- Revert initial commit

**Commit after all checkpoints pass.**

---

#### Step 1: Simple Step {#step-1}

**Depends on:** #step-0

**Commit:** `feat: add simple feature`

**References:** [D01] Use substeps for large work

**Artifacts:**
- Simple feature implementation

**Tasks:**
- [ ] Implement feature

**Tests:**
- [ ] Unit test for feature

**Checkpoint:**
- [ ] Feature works as expected

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 2: Complex Step with Substeps {#step-2}

**Depends on:** #step-1

**References:** [D01] Use substeps for large work

> This step is large, so it is broken into substeps with separate commits.

**Tasks:**
- [ ] Complete all substeps

**Tests:**
- [ ] All substep tests pass

**Checkpoint:**
- [ ] All substep checkpoints pass

##### Step 2.1: Foundation {#step-2-1}

**Commit:** `feat(core): add foundation layer`

**References:** [D01] Use substeps for large work

**Artifacts:**
- Foundation types and traits

**Tasks:**
- [ ] Define core types
- [ ] Implement base traits

**Tests:**
- [ ] Unit tests for types
- [ ] Unit tests for traits

**Checkpoint:**
- [ ] All type tests pass

**Rollback:**
- Revert substep commit

**Commit after all checkpoints pass.**

---

##### Step 2.2: Implementation {#step-2-2}

**Depends on:** #step-2-1

**Commit:** `feat(core): implement main logic`

**References:** [D01] Use substeps for large work

**Artifacts:**
- Main implementation

**Tasks:**
- [ ] Implement core logic
- [ ] Wire up dependencies

**Tests:**
- [ ] Integration tests

**Checkpoint:**
- [ ] Integration tests pass

**Rollback:**
- Revert substep commit

**Commit after all checkpoints pass.**

---

##### Step 2.3: Polish {#step-2-3}

**Depends on:** #step-2-2

**Commit:** `feat(core): add error handling and docs`

**References:** [D01] Use substeps for large work

**Artifacts:**
- Error handling
- Documentation

**Tasks:**
- [ ] Add error types
- [ ] Add documentation

**Tests:**
- [ ] Error path tests

**Checkpoint:**
- [ ] Documentation complete

**Rollback:**
- Revert substep commit

**Commit after all checkpoints pass.**

---

### Substeps 2.1–2.3 Summary {#step-2-summary}

After completing Steps 2.1–2.3, you will have:
- Core types and traits
- Main implementation
- Error handling and documentation

**Final Step 2 Checkpoint:**
- `cargo test` passes all tests
- `cargo doc` generates without warnings

---

#### Step 3: Final Integration {#step-3}

**Depends on:** #step-2

**Commit:** `feat: integrate all components`

**References:** [D01] Use substeps for large work

**Artifacts:**
- Fully integrated feature

**Tasks:**
- [ ] Connect all components
- [ ] Add end-to-end tests

**Tests:**
- [ ] End-to-end tests

**Checkpoint:**
- [ ] Full test suite passes

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables {#deliverables}

- Complete feature with substeps demonstrated

| Checkpoint | Verification |
|------------|--------------|
| Substeps work | All checkpoints pass |
