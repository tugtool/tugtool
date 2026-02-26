## <Plan Title> {#phase-slug}

**Purpose:** <1–2 sentences. What capability ships at the end of this phase?>

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | <name> |
| Status | draft / active / done |
| Target branch | <branch> |
| Tracking issue/PR | <link or ID> |
| Last updated | <YYYY-MM-DD> |

---

### Phase Overview {#phase-overview}

#### Context {#context}

<1–2 paragraphs. What problem are we solving, and why now?>

#### Strategy {#strategy}

<3–7 bullets. The approach and sequencing philosophy for this phase.>

#### Success Criteria (Measurable) {#success-criteria}

> Make these falsifiable. Avoid "works well".

- <criterion> (how to measure / verify)
- <criterion> (how to measure / verify)

#### Scope {#scope}

1. <Scope item>
2. <Scope item>
3. <Scope item>

#### Non-goals (Explicitly out of scope) {#non-goals}

- <Non-goal>
- <Non-goal>

#### Dependencies / Prerequisites {#dependencies}

- <Dependency>
- <Prerequisite>

#### Constraints {#constraints}

- <platform/tooling/perf/security constraints>

#### Assumptions {#assumptions}

- <assumption>
- <assumption>

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan format relies on **explicit, named anchors** and **rich `References:` lines** in execution steps.

#### 1) Use explicit anchors everywhere you will cite later

- **Technique**: append an explicit anchor to the end of a heading using `{#anchor-name}`.
  - Example:
    - `### Design Decisions {#design-decisions}`
    - `#### [D01] Workspace snapshots are immutable (DECIDED) {#d01-snapshots-immutable}`
- **Why**: do not rely on auto-generated heading slugs; explicit anchors are stable when titles change.

#### 2) Anchor naming rules (lock these in)

- **Allowed characters**: lowercase `a–z`, digits `0–9`, and hyphen `-` only.
- **Style**: short, semantic, **kebab-case**, no phase numbers (anchors should survive renumbering).
- **Prefix conventions (use these consistently)**:
  - **`step-N`**: execution step anchors, e.g. `{#step-1}`, `{#step-2}`, `{#step-3}`
  - **`step-N-M`**: substep anchors, e.g. `{#step-2-1}`, `{#step-2-2}`
  - **`dNN-...`**: design decisions (`[D01]`) anchors, e.g. `{#d01-sandbox-copy}`
  - **`qNN-...`**: open questions (`[Q01]`) anchors, e.g. `{#q01-import-resolution}`
  - **`rNN-...`**: risk notes (`Risk R01`) anchors, e.g. `{#r01-perf-regression}`
  - **`lNN-...`**: lists (`List L01`) anchors, e.g. `{#l01-supported-ops}`
  - **`mNN-...`**: milestones (`Milestone M01`) anchors, e.g. `{#m01-first-ship}`
  - **`sNN-...`**: specs (`Spec S01`) anchors, e.g. `{#s01-command-response}`
  - **Domain anchors**: for major concepts/sections, use a clear noun phrase, e.g. `{#cross-platform}`, `{#config-schema}`, `{#error-scenarios}`

#### 3) Stable label conventions (for non-heading artifacts)

Use stable labels so steps can cite exact plan artifacts even when prose moves around:

- **Design decisions**: `#### [D01] <Title> (DECIDED) {#d01-...}`
- **Open questions**: `#### [Q01] <Title> (OPEN) {#q01-...}`
- **Specs**: `**Spec S01: <Title>** {#s01-slug}` (or make it a `####` heading if you prefer)
- **Tables**: `**Table T01: <Title>** {#t01-slug}`
- **Lists**: `**List L01: <Title>** {#l01-slug}`
- **Risks**: `**Risk R01: <Title>** {#r01-slug}`
- **Milestones**: `**Milestone M01: <Title>** {#m01-slug}`

Numbering rules:
- Always use **two digits**: `D01`, `Q01`, `S01`, `T01`, `L01`, `R01`, `M01`.
- Never reuse an ID within a plan. If you delete one, leave the gap.

#### 4) `**Depends on:**` lines for execution step dependencies

Steps that depend on other steps must include a `**Depends on:**` line that references step anchors.

**Format:**
```markdown
**Depends on:** #step-1, #step-2
```

**Rules:**
- Use **anchor references** (`#step-N`), not step titles or numbers
- Omit the line entirely for steps with no dependencies (typically Step 1)
- Substeps implicitly depend on their parent step; only add explicit dependencies for cross-substep relationships
- Multiple dependencies are comma-separated
- Dependencies must reference valid step anchors within the document (validated by `tug validate`)

---

#### 5) `**References:**` lines are required for every execution step

Every step must include a `**References:**` line that cites the plan artifacts it implements.

Rules:
- Cite **decisions** by ID: `[D05] ...`
- Cite **open questions** by ID when the step resolves/de-risks them: `[Q03] ...`
- Cite **specs/lists/tables/risks/milestones** by label: `Spec S15`, `List L03`, `Tables T27-T28`, `Risk R02`, `Milestone M01`, etc.
- Cite **anchors** for deep links in parentheses using `#anchor` tokens (keep them stable).
- **Do not cite line numbers.** If you find yourself writing "lines 5–10", add an anchor and cite that instead.
- Prefer **rich, exhaustive citations**. Avoid `N/A` unless the step is truly refactor-only.

**Good References examples:**

```
**References:** [D05] Sandbox verification, [D12] Git-based undo, Spec S15, Tables T21-T25,
(#session-lifecycle, #worker-process-mgmt, #config-precedence)
```

```
**References:** [D01] Refactoring kernel, [D06] Python analyzer, List L04,
Table T05, (#op-rename, #fundamental-wall)
```

**Bad References examples (avoid these):**

```
**References:** Strategy section (lines 5–10)     ← uses line numbers
**References:** See design decisions above        ← vague, no specific citations
**References:** N/A                               ← only acceptable for pure refactor steps
```

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

> Open questions are tracked work. If a question remains open at phase-end, explicitly defer it with a rationale and a follow-up plan.

#### [Q01] <Question title> (OPEN) {#q01-question-slug}

**Question:** <what is unknown / undecided?>

**Why it matters:** <what breaks or becomes expensive if we guess wrong?>

**Options (if known):**
- <option>
- <option>

**Plan to resolve:** <prototype / benchmark / spike / research / decision meeting>

**Resolution:** OPEN / DECIDED (see [DNN]) / DEFERRED (why, and where it will be revisited)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| <risk> | low/med/high | low/med/high | <mitigation> | <trigger> |

**Risk R01: <Title>** {#r01-risk-slug}

- **Risk:** <1 sentence>
- **Mitigation:** <1–3 bullets>
- **Residual risk:** <what remains true even after mitigation>

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] <Decision Name> (DECIDED) {#d01-decision-slug}

**Decision:** <One sentence decision statement>

**Rationale:**
- <Why>
- <Why>

**Implications:**
- <What this forces in APIs / storage / tests>

---

### Deep Dives (Optional) {#deep-dives}

> Use this section for structured analysis that is not quite "decision" or "spec", but is critical for implementation alignment.
>
> Examples: operation analysis, end-to-end flows, protocols, schemas, sequence diagrams, CI/CD shape, cross-platform strategy, perf notes, rejection rationale.

#### <Topic Title> {#topic-slug}

<Write-up, diagrams, tables, and any referenced specs/lists/tables.>

---

### Specification {#specification}

> This section is the contract. Pick the subsections that apply to your plan; omit the rest.

- **Inputs and Outputs**: data model, invariants, supported formats
- **Terminology and Naming**: key terms and their definitions
- **Supported Features**: exhaustive list; include what is explicitly not supported
- **Modes / Policies**: behavioral variants, flags, policies
- **Semantics**: normative rules, traversal order, edge cases
- **Error and Warning Model**: error fields, warning fields, path formats
- **Public API Surface**: Rust/Python/language signatures
- **Internal Architecture**: component relationships, pipeline, ownership
- **Output Schemas**: CLI output, API responses, wire formats (contract)
- **Configuration Schema**: config file format, precedence, CLI flag mapping

---

### Compatibility / Migration / Rollout (Optional) {#rollout}

> Use this section when you are changing public APIs, config formats, CLI contracts, or anything that affects adopters.

- **Compatibility policy**: <semver? schema versioning?>
- **Migration plan**:
  - <what changes>
  - <who is impacted>
  - <how to migrate, and how to detect breakage>
- **Rollout plan**:
  - <opt-in flag / staged rollout / canary / feature gate>
  - <rollback strategy>

---

### Definitive Symbol Inventory {#symbol-inventory}

> A concrete list of new crates/files/symbols to add. This is what keeps implementation crisp.

#### New crates (if any) {#new-crates}

| Crate | Purpose |
|-------|---------|
| `<crate>` | <purpose> |

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `<path>` | <purpose> |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `<Name>` | enum/struct/fn | `<path>` | <notes> |

---

### Documentation Plan {#documentation-plan}

- [ ] <Docs update>
- [ ] <Examples / schema examples / API docs>

---

### Test Plan Concepts {#test-plan-concepts}

> Describe the kinds of tests that prove the spec. Leave the actual enumeration of tests to the Execution Steps below.

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual functions/methods in isolation | Core logic, edge cases, error paths |
| **Integration** | Test components working together | End-to-end operations, CLI commands |
| **Golden / Contract** | Compare output against known-good snapshots | Schemas, APIs, parsers, serialization |
| **Drift Prevention** | Detect unintended behavior changes | Regression testing, API stability |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **Patterns:**
> - If a step is big, split into **substeps** (`Step 2.1`, `Step 2.2`, …) with separate commits and checkpoints.
> - After completing a multi-substep step, add a **Step N Summary** block that consolidates what was achieved and provides an aggregate checkpoint.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers—add an anchor instead.

#### Step 1: <Prep Step Title> {#step-1}

<!-- Step 1 typically has no dependencies (it is the root) -->

**Commit:** `<conventional-commit message>`

**References:** [D01] <decision name>, (#strategy, #context)

**Artifacts:** (what this step produces/changes)
- <new files / new commands / new schema fields / new docs>

**Tasks:**
- [ ] <task>
- [ ] <task>

**Tests:**
- [ ] <T test>
- [ ] <T test>

**Checkpoint:**
- [ ] <command>
- [ ] <command>

---

#### Step 2: <Step Title> {#step-2}

**Depends on:** #step-1

**Commit:** `<conventional-commit message>`

**References:** [D02] <decision>, [D03] <decision>, Spec S01, List L01, (#terminology, #semantics)

**Artifacts:** (what this step produces/changes)
- <new files / new commands / new schema fields / new docs>

**Tasks:**
- [ ] <task>
- [ ] <task>

**Tests:**
- [ ] <T test>
- [ ] <T test>

**Checkpoint:**
- [ ] <command>
- [ ] <command>

---

#### Step 3: <Big Step Title> {#step-3}

**Depends on:** #step-2

> If this step is large, break it into substeps with separate commits and checkpoints.
> The parent step explains the structure; each substep has its own commit and checkpoint.
> Substeps implicitly depend on their parent step; explicit **Depends on:** only needed for cross-substep dependencies.

##### Step 3.1: <Substep Title> {#step-3-1}

**Commit:** `<conventional-commit message>`

**References:** [D04] <decision>, Spec S02, Table T01, (#inputs-outputs)

**Artifacts:** (what this substep produces/changes)
- <artifact>

**Tasks:**
- [ ] <task>

**Tests:**
- [ ] <test>

**Checkpoint:**
- [ ] <command>

---

##### Step 3.2: <Substep Title> {#step-3-2}

**Depends on:** #step-3-1

**Commit:** `<conventional-commit message>`

**References:** [D05] <decision>, (#public-api)

**Artifacts:** (what this substep produces/changes)
- <artifact>

**Tasks:**
- [ ] <task>

**Tests:**
- [ ] <test>

**Checkpoint:**
- [ ] <command>

---

#### Step 3 Summary {#step-3-summary}

> After a multi-substep step, add a summary block to consolidate what was achieved.

After completing Steps 3.1–3.N, you will have:
- <capability or artifact 1>
- <capability or artifact 2>
- <capability or artifact 3>

**Final Step 3 Checkpoint:**
- [ ] `<aggregate verification command covering all substeps>`

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** <One sentence deliverable>

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] <criterion> (verification)
- [ ] <criterion> (verification)

**Acceptance tests:**
- [ ] <T test>
- [ ] <T test>

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] <follow-on item>
- [ ] <follow-on item>

| Checkpoint | Verification |
|------------|--------------|
| <checkpoint> | <command/test/proof> |
