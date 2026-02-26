## Phase 1.0: Complete Valid Plan {#phase-1}

**Purpose:** A complete plan with all sections populated for testing.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test Owner |
| Status | active |
| Target branch | main |
| Tracking issue/PR | #123 |
| Last updated | 2026-02-03 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

This is a complete plan demonstrating all sections properly populated.
It serves as a reference implementation for the tug validation system.

#### Strategy {#strategy}

- Demonstrate all required sections
- Include examples of each artifact type
- Show proper anchor usage
- Validate cross-references

#### Stakeholders / Primary Customers {#stakeholders}

1. Test framework
2. Documentation readers

#### Success Criteria (Measurable) {#success-criteria}

- All sections present and valid
- Passes validation with no errors

#### Scope {#scope}

1. Demonstrate valid metadata
2. Demonstrate valid design decisions
3. Demonstrate valid execution steps

#### Non-goals (Explicitly out of scope) {#non-goals}

- Real implementation work
- Production use

#### Dependencies / Prerequisites {#dependencies}

- Tug validation engine

#### Constraints {#constraints}

- Must pass strict validation

#### Assumptions {#assumptions}

- Validation rules are correctly implemented

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Example Question (DECIDED) {#q01-example}

**Question:** How should we structure the test fixture?

**Why it matters:** Ensures consistent testing.

**Options (if known):**
- Minimal structure
- Complete structure

**Plan to resolve:** Design review

**Resolution:** DECIDED (see [D01])

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Fixture becomes outdated | low | low | Review with schema changes | Schema update |

**Risk R01: Schema Drift** {#r01-schema-drift}

- **Risk:** Test fixture may not match latest schema
- **Mitigation:** Update fixture when schema changes
- **Residual risk:** Minor lag in updates

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Use Complete Structure (DECIDED) {#d01-complete}

**Decision:** This fixture demonstrates all sections for comprehensive testing.

**Rationale:**
- Ensures all validation paths are exercised
- Provides reference for documentation

**Implications:**
- Fixture must be updated when schema changes

#### [D02] Include All Artifact Types (DECIDED) {#d02-artifacts}

**Decision:** Include examples of decisions, questions, specs, tables, risks.

**Rationale:**
- Comprehensive coverage

**Implications:**
- Larger file size

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs:**
- Markdown plan file

**Outputs:**
- Validation result

**Key invariants:**
- All anchors must be unique

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New crates (if any) {#new-crates}

| Crate | Purpose |
|-------|---------|
| N/A | This is a test fixture |

#### 1.0.2.2 New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| complete.md | Complete test fixture |

---

### 1.0.3 Documentation Plan {#documentation-plan}

- [x] Document fixture purpose
- [x] Include inline examples

---

### 1.0.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Golden** | Compare validation output | Schema changes |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 1: Setup {#step-1}

**Commit:** `test: add complete fixture`

**References:** [D01] Use complete structure, [D02] Include all artifact types, (#context, #strategy)

**Artifacts:**
- Complete test fixture

**Tasks:**
- [x] Create fixture file
- [x] Add all sections

**Tests:**
- [x] Validate fixture passes

**Checkpoint:**
- [x] `tug validate complete.md` passes

**Rollback:**
- Delete fixture file

**Commit after all checkpoints pass.**

---

#### Step 2: Verify {#step-2}

**Depends on:** #step-1

**Commit:** `test: verify complete fixture`

**References:** [D01] Use complete structure, (#specification)

**Artifacts:**
- Validation confirmation

**Tasks:**
- [x] Run validation
- [x] Confirm no errors

**Tests:**
- [x] Golden test matches

**Checkpoint:**
- [x] All validation checks pass

**Rollback:**
- Fix validation errors

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Complete valid test fixture

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [x] Fixture passes strict validation
- [x] All sections present

**Acceptance tests:**
- [x] `tug validate` returns success

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Fixture Created** {#m01-created}
- [x] File exists with all sections

#### Roadmap / Follow-ons {#roadmap}

- [ ] Add more complex examples
- [ ] Add edge case fixtures

| Checkpoint | Verification |
|------------|--------------|
| Valid structure | `tug validate` |

**Commit after all checkpoints pass.**
