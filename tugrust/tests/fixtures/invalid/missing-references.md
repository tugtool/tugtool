## Phase 1.0: Missing References Test {#phase-1}

**Purpose:** A plan with steps that have missing or broken references.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test Owner |
| Status | draft |
| Last updated | 2026-02-03 |

---

### Phase Overview {#phase-overview}

This plan has steps that reference non-existent anchors and decisions.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Only Decision (DECIDED) {#d01-only}

**Decision:** This is the only decision.

**Rationale:**
- For testing

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 1: References Non-Existent Decision {#step-1}

**Commit:** `test: missing references`

**References:** [D01] Only decision, [D99] Non-existent decision, (#non-existent-anchor)

**Tasks:**
- [ ] Task

**Tests:**
- [ ] Test

**Checkpoint:**
- [ ] Check

**Rollback:**
- Revert

**Commit after all checkpoints pass.**

---

#### Step 2: References Non-Existent Step {#step-2}

**Depends on:** #step-1, #step-99

**Commit:** `test: bad dependency`

**References:** [D01] Only decision

**Tasks:**
- [ ] Task

**Tests:**
- [ ] Test

**Checkpoint:**
- [ ] Check

**Rollback:**
- Revert

**Commit after all checkpoints pass.**

---

### Deliverables {#deliverables}

None.
