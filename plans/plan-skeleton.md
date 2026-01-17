## Phase X.Y: <Phase Title> {#phase-slug}

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

#### Stakeholders / Primary Customers {#stakeholders}

1. <customer or team>
2. <customer or team>

#### Success Criteria (Measurable) {#success-criteria}

> Make these falsifiable. Avoid “works well”.

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

### Section Numbering Convention {#section-numbering}

This skeleton uses `X.Y` placeholders. When writing a real plan, replace them with actual numbers:

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `X` | Major phase number | `1`, `2`, `3` |
| `Y` | Minor phase number (usually `0`) | `1.0`, `2.0` |
| `X.Y.N` | Numbered section within phase | `1.0.1`, `1.0.2` |
| `X.Y.N.M` | Subsection within a numbered section | `1.0.1.1`, `1.0.2.3` |

**Standard section numbers:**
- `X.Y.0` — Design Decisions (always `.0`)
- `X.Y.1` — Specification
- `X.Y.2` — Symbol Inventory
- `X.Y.3` — Documentation Plan
- `X.Y.4` — Test Plan Concepts
- `X.Y.5` — Execution Steps
- `X.Y.6` — Deliverables and Checkpoints

**Deep dives** are just numbered sections within the phase, typically starting at `X.Y.1` *after* `X.Y.0 Design Decisions` (e.g., `1.0.1 Refactoring Operations Analysis`, `1.0.2 Type Inference Roadmap`). Use `X.Y.N.M` for deep-dive subsections when needed.

---

### Document Size Guidance {#document-size}

Plans can grow large. When a plan exceeds **~100KB or ~2000 lines**, consider these strategies:

#### When to Split

| Symptom | Action |
|---------|--------|
| Deep dives exceed 50% of document | Extract to `phase-X-deepdives.md` |
| Multiple independent feature tracks | Split into `phase-X.1.md`, `phase-X.2.md` |
| Reference material dominates | Extract to `phase-X-reference.md` |

#### Navigation Aids for Large Documents

- Add a **Table of Contents** after the Purpose statement
- Use **collapsible sections** (if your renderer supports `<details>`)
- Add **"Back to top"** links after major sections

#### Cross-File References

When splitting across files, use relative links with anchors:

```markdown
See [Worker Protocol](./phase-1-deepdives.md#worker-protocol) for details.
```

Keep all **decisions** ([D01], [D02], ...) in the main plan file—they're the source of truth.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan format relies on **explicit, named anchors** and **rich `References:` lines** in execution steps.

#### 1) Use explicit anchors everywhere you will cite later

- **Technique**: append an explicit anchor to the end of a heading using `{#anchor-name}`.
  - Example:
    - `### X.Y.0 Design Decisions {#design-decisions}`
    - `#### [D01] Workspace snapshots are immutable (DECIDED) {#d01-snapshots-immutable}`
- **Why**: do not rely on auto-generated heading slugs; explicit anchors are stable when titles change.

#### 2) Anchor naming rules (lock these in)

- **Allowed characters**: lowercase `a–z`, digits `0–9`, and hyphen `-` only.
- **Style**: short, semantic, **kebab-case**, no phase numbers (anchors should survive renumbering).
- **Prefix conventions (use these consistently)**:
  - **`dNN-...`**: design decisions (`[D01]`) anchors, e.g. `{#d01-sandbox-copy}`
  - **`qNN-...`**: open questions (`[Q01]`) anchors, e.g. `{#q01-import-resolution}`
  - **`rNN-...`**: risk notes (`Risk R01`) anchors, e.g. `{#r01-perf-regression}`
  - **`cNN-...`**: concepts (`Concept C01`) anchors, e.g. `{#c01-type-inference-wall}`
  - **`diagNN-...`**: diagrams (`Diagram Diag01`) anchors, e.g. `{#diag01-rename-flow}`
  - **`op-...`**: refactor operations, e.g. `{#op-rename}`, `{#op-extract-fn}`
  - **`cmd-...`**: CLI commands, e.g. `{#cmd-run}`
  - **`type-...`**: schema types, e.g. `{#type-span}`
  - **`seq-...`**: sequence diagrams, e.g. `{#seq-rename-python}`
  - **`fixture-...`**: fixture sections, e.g. `{#fixture-py-rename-fn}`
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
- **Concepts**: `**Concept C01: <Title>** {#c01-slug}` (for key conceptual explanations)
- **Diagrams**: `**Diagram Diag01: <Title>** {#diag01-slug}` (for ASCII diagrams, sequence flows, architecture visuals)

Numbering rules:
- Always use **two digits**: `D01`, `Q01`, `S01`, `T01`, `L01`, `R01`, `M01`, `C01`, `Diag01`.
- Never reuse an ID within a plan. If you delete one, leave the gap.

#### 4) `**References:**` lines are required for every execution step

Every step must include a `**References:**` line that cites the plan artifacts it implements.

Rules:
- Cite **decisions** by ID: `[D05] ...`
- Cite **open questions** by ID when the step resolves/de-risks them: `[Q03] ...`
- Cite **specs/lists/tables/risks/milestones/concepts/diagrams** by label: `Spec S15`, `List L03`, `Tables T27-T28`, `Risk R02`, `Milestone M01`, `Concept C01`, `Diagram Diag01`, etc.
- Cite **anchors** for deep links in parentheses using `#anchor` tokens (keep them stable).
- **Do not cite line numbers.** If you find yourself writing "lines 5–10", add an anchor and cite that instead.
- Prefer **rich, exhaustive citations**. Avoid `N/A` unless the step is truly refactor-only.

**Good References examples:**

```
**References:** [D05] Sandbox verification, [D12] Git-based undo, Spec S15, Tables T21-T25,
(#session-lifecycle, #worker-process-mgmt, #config-precedence)
```

```
**References:** [D01] Refactoring kernel, [D06] Python analyzer, Concept C01, List L04,
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

### X.Y.0 Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the “why” so later phases don’t reopen it accidentally.

#### [D01] <Decision Name> (DECIDED) {#d01-decision-slug}

**Decision:** <One sentence decision statement>

**Rationale:**
- <Why>
- <Why>

**Implications:**
- <What this forces in APIs / storage / tests>

---

### Deep Dives (Optional) {#deep-dives}

> Use this section for structured analysis that is not quite “decision” or “spec”, but is critical for implementation alignment.
>
> Examples: operation analysis, end-to-end flows, protocols, schemas, sequence diagrams, CI/CD shape, cross-platform strategy, perf notes, rejection rationale.

#### <Topic Title> {#topic-slug}

<Write-up, diagrams, tables, and any referenced specs/lists/tables.>

---

### X.Y.1 Specification {#specification}

> This section is the contract. It should be complete enough that implementation work can proceed without inventing semantics.

#### X.Y.1.1 Inputs and Outputs (Data Model) {#inputs-outputs}

**Inputs:**
- <Input artifact(s) and supported formats>

**Outputs:**
- <Output artifact(s), return types, side effects>

**Key invariants:**
- <Invariant>
- <Invariant>

#### X.Y.1.2 Terminology and Naming {#terminology}

- **<Term>**: <Definition>
- **<Term>**: <Definition>

#### X.Y.1.3 Supported Features (Exhaustive) {#supported-features}

> Be explicit. Avoid “etc.” and “and more”.

- **Supported**:
  - <Feature>
  - <Feature>
- **Explicitly not supported**:
  - <Feature>
  - <Feature>
- **Behavior when unsupported is encountered**:
  - <Policy-specific or mode-specific behavior>

#### X.Y.1.4 Modes / Policies (if applicable) {#modes-policies}

| Mode/Policy | Applies to | Behavior | Result |
|------------|------------|----------|--------|
| `<mode>` | <where> | <what happens> | <what is returned> |

#### X.Y.1.5 Semantics (Normative Rules) {#semantics}

> Write this like a spec: bullet rules, deterministic ordering, and edge-case behavior.

- **Traversal / evaluation order**: <rule>
- **Ordering guarantees**: <rule>
- **Stopping conditions**: <rule>
- **Null vs missing**: <rule>
- **Coercion rules (if any)**:
  - <rule>

#### X.Y.1.6 Error and Warning Model {#errors-warnings}

> Errors and warnings are the developer UI—be precise.

**Error fields (required):**
- <field>: <meaning>

**Warning fields (required):**
- <field>: <meaning>

**Path formats (if any):**
- Data path format: <e.g., RFC 6901 JSON Pointer>
- Schema path format: <e.g., keyword-level paths>
- Escaping rules: <e.g., "~" and "/">

#### X.Y.1.7 Public API Surface {#public-api}

> Provide Rust + Python signatures at the level needed to implement bindings and stubs.

**Rust:**
```rust
// Core types (enums, structs)
// Public functions / methods
```

**Python:**
```python
# Enums, dataclasses, methods
```

**<Language>:**
```<language>
# <Appropriate language constructs to define>
```

#### X.Y.1.8 Internal Architecture {#internal-architecture}

> Explain how components fit together so work doesn't fork midstream.

- **Single source of truth**: <what>
- **Compilation / interpretation pipeline**:
  - <step>
  - <step>
- **Where code lives**:
  - <crate/module ownership>
- **Non-negotiable invariants to prevent drift**:
  - <e.g., shared keyword list, shared $ref resolver, golden tests>

#### X.Y.1.9 Output Schemas (if applicable) {#output-schemas}

> Use this section when your phase defines CLI output, API responses, or wire formats. These schemas are the **contract**—changes require versioning.

##### Common Types {#schema-common-types}

Define reusable types that appear in multiple responses:

###### `<TypeName>` {#type-typename}

```json
{
  "field1": "string",
  "field2": 123,
  "nested": { ... }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field1` | string | yes | <description> |
| `field2` | integer | no | <description> |
| `nested` | object | no | <description> |

##### Response Envelope {#response-envelope}

> Define the standard wrapper for all responses.

```json
{
  "status": "ok" | "error",
  "schema_version": "1",
  ...response-specific fields...
}
```

##### Command Responses {#command-responses}

For each command, define success and error response schemas:

###### Command: `<command-name>` {#cmd-command-name}

**Spec S01: <command-name> Response Schema** {#s01-command-response}

**Success response:**

```json
{
  "status": "ok",
  "schema_version": "1",
  ...
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field` | type | yes/no | <description> |

##### Error Codes (Exhaustive) {#error-codes}

> List all error codes by category. This table is the contract for error handling.

**Table T01: Error Codes** {#t01-error-codes}

###### <Category> Errors (exit code N)

| Code | Meaning | `details` fields |
|------|---------|------------------|
| `ErrorCode` | <what went wrong> | `field1`, `field2` |

##### Exit Codes {#exit-codes}

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| N | <category-specific> |

#### X.Y.1.10 Configuration Schema (if applicable) {#config-schema}

> Use this section when your phase introduces configuration options.

##### Configuration Precedence (highest to lowest) {#config-precedence}

1. CLI flags (`--flag=value`)
2. Environment variables (`PREFIX_KEY`)
3. Project config file (`pyproject.toml`, `Cargo.toml`, etc.)
4. Built-in defaults

##### Config File Schema {#config-file-schema}

```toml
[tool.<name>]
# <category>
field = "default"           # <description>
another_field = true        # <description>

[tool.<name>.<subsection>]
nested_field = "value"      # <description>
```

##### CLI Flag Mapping {#cli-flag-mapping}

| Config Key | CLI Flag | Environment Variable | Default |
|------------|----------|---------------------|---------|
| `field` | `--field=<value>` | `PREFIX_FIELD` | `"default"` |

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

### X.Y.2 Definitive Symbol Inventory {#symbol-inventory}

> A concrete list of new crates/files/symbols to add. This is what keeps implementation crisp.

#### X.Y.2.1 New crates (if any) {#new-crates}

| Crate | Purpose |
|-------|---------|
| `<crate>` | <purpose> |

#### X.Y.2.2 New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `<path>` | <purpose> |

#### X.Y.2.3 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `<Name>` | enum/struct/fn | `<path>` | <notes> |

---

### X.Y.3 Documentation Plan {#documentation-plan}

- [ ] <Docs update>
- [ ] <Examples / schema examples / API docs>

---

### X.Y.4 Test Plan Concepts {#test-plan-concepts}

> Describe the kinds of tests that prove the spec. Leave the actual enumeration of tests to the Execution Steps below.

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual functions/methods in isolation | Core logic, edge cases, error paths |
| **Integration** | Test components working together | End-to-end operations, CLI commands |
| **Golden / Contract** | Compare output against known-good snapshots | Schemas, APIs, parsers, serialization |
| **Drift Prevention** | Detect unintended behavior changes | Regression testing, API stability |

#### Test Fixtures (if applicable) {#test-fixtures}

> Use this section when your phase requires structured test data. Fixtures provide reproducible, self-contained test scenarios.

##### Fixture Directory Structure {#fixture-structure}

```
tests/fixtures/
├── <language>/                     # Language-specific fixtures
│   ├── <scenario>/                 # Scenario directory
│   │   ├── <input-files>           # Test input files
│   │   └── expected/               # Expected outputs (optional)
│   └── manifest.json               # Test case manifest
└── golden/                         # Golden output files
    └── <language>/
        └── <scenario>.{json,patch,txt}
```

##### Fixture Manifest Format {#fixture-manifest}

Each fixture directory should have a `manifest.json` describing test cases:

```json
{
  "fixtures": [
    {
      "name": "<test_name>",
      "description": "<what this tests>",
      "path": "<relative_path_to_input>",
      "operation": "<operation_being_tested>",
      "args": { "<arg>": "<value>" },
      "expected": {
        "status": "ok|error",
        "edits": 3,
        "files_changed": 1
      },
      "golden_output": "golden/<language>/<test_name>.json"
    }
  ]
}
```

##### Fixture Requirements {#fixture-requirements}

- **Self-contained**: Each fixture must be runnable/compilable on its own
- **Deterministic**: No randomness, timestamps, or environment-dependent behavior
- **Minimal**: Just enough code to exercise the scenario
- **Documented**: Include comments explaining what's being tested
- **Valid**: All fixtures must pass basic validation (syntax check, type check, etc.)

##### Golden Test Workflow {#golden-workflow}

```bash
# Run golden tests (compare against snapshots)
<test-command> golden

# Update golden files after intentional changes
<UPDATE_ENV_VAR>=1 <test-command> golden
```

---

### X.Y.5 Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Patterns:**
> - Use **Step 0** for prep/bootstrapping that unblocks everything else.
> - If a step is big, split into **substeps** (`Step 2.1`, `Step 2.2`, …) with separate commits and checkpoints.
> - After completing a multi-substep step, add a **Step N Summary** block that consolidates what was achieved and provides an aggregate checkpoint.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers—add an anchor instead.

#### Step 0: <Prep Step Title> {#step-0}

**Commit:** `<conventional-commit message>`

**References:** [D01] <decision name>, (#strategy, #context)

**Artifacts:** (what this step produces/changes)
- <new files / new commands / new schema fields / new docs>

**Tasks:**
- [ ] <task>
- [ ] <task>

**Tests:** (where T is one of: unit, integration, golden / contract, drift prevention)
- [ ] <T test>
- [ ] <T test>

**Checkpoint:**
- [ ] <command>
- [ ] <command>

**Rollback:** (how to undo if this step goes sideways)
- <e.g., revert commit, delete temp dirs, remove config entries>

**Commit after all checkpoints pass.**

---

#### Step 1: <Step Title> {#step-1}

**Commit:** `<conventional-commit message>`

**References:** [D02] <decision>, [D03] <decision>, Spec S01, List L01, (#terminology, #semantics)

**Artifacts:** (what this step produces/changes)
- <new files / new commands / new schema fields / new docs>

**Tasks:**
- [ ] <task>
- [ ] <task>

**Tests:** (where T is one of: unit, integration, golden / contract, drift prevention)
- [ ] <T test>
- [ ] <T test>

**Checkpoint:**
- [ ] <command>
- [ ] <command>

**Rollback:** (how to undo if this step goes sideways)
- <e.g., revert commit, delete temp dirs, remove config entries>

**Commit after all checkpoints pass.**

---

#### Step 2: <Big Step Title> {#step-2}

> If this step is large, break it into substeps with separate commits and checkpoints.
> The parent step explains the structure; each substep has its own commit and checkpoint.

##### Step 2.1: <Substep Title> {#step-2-1}

**Commit:** `<conventional-commit message>`

**References:** [D04] <decision>, Spec S02, Table T01, (#inputs-outputs)

**Artifacts:** (what this substep produces/changes)
- <artifact>

**Tasks:**
- [ ] <task>

**Tests:** (unit / integration / golden / drift prevention)
- [ ] <test>

**Checkpoint:**
- [ ] <command>

**Rollback:**
- <rollback>

**Commit after all checkpoints pass.**

---

##### Step 2.2: <Substep Title> {#step-2-2}

**Commit:** `<conventional-commit message>`

**References:** [D05] <decision>, Concept C01, (#public-api)

**Artifacts:** (what this substep produces/changes)
- <artifact>

**Tasks:**
- [ ] <task>

**Tests:** (unit / integration / golden / drift prevention)
- [ ] <test>

**Checkpoint:**
- [ ] <command>

**Rollback:**
- <rollback>

**Commit after all checkpoints pass.**

---

#### Step 2 Summary {#step-2-summary}

> After a multi-substep step, add a summary block to consolidate what was achieved.

After completing Steps 2.1–2.N, you will have:
- <capability or artifact 1>
- <capability or artifact 2>
- <capability or artifact 3>

**Final Step 2 Checkpoint:**
- [ ] `<aggregate verification command covering all substeps>`

---

#### Step N: Audit / Improvement Round (Optional Pattern) {#step-audit}

> Use this pattern for code review, audit, or cleanup steps. Organize issues by priority and track them systematically.

##### Priority-Based Issue Tracking {#audit-issues}

Organize findings by priority:

###### P0 (Critical): Bugs Causing Incorrect Behavior {#audit-p0}

| ID | File | Issue | Fix | Status |
|----|------|-------|-----|--------|
| S2-R2-01 | path.rs:L | <issue description> | <fix approach> | ✅ / ⏳ / ❌ |

**Tests added:**
- [ ] test: `<test_name_describing_fix>`

###### P1 (High): Security, Race Conditions, Missing Validation {#audit-p1}

| ID | File | Issue | Fix | Status |
|----|------|-------|-----|--------|
| S2-R2-04 | module.rs:L | <issue description> | <fix approach> | ✅ / ⏳ / ❌ |

###### P2 (Medium): API Inconsistencies, Error Handling {#audit-p2}

| ID | File | Issue | Fix | Status |
|----|------|-------|-----|--------|
| S2-R2-09 | api.rs:L | <issue description> | <fix approach> | ✅ / ⏳ / ❌ |

###### P3 (Low): Code Quality, Documentation {#audit-p3}

| ID | File | Issue | Fix | Status |
|----|------|-------|-----|--------|
| S2-R2-16 | lib.rs:L | <issue description> | <fix approach> | ✅ / ⏳ / ❌ |

##### Test Coverage Gaps {#audit-test-gaps}

List missing tests discovered during audit:

**<module>.rs:**
- [ ] `<scenario not currently tested>`
- [ ] `<edge case missing coverage>`

##### Architectural Concerns {#audit-arch-concerns}

> Capture structural issues that don't fit into bug fixes but affect long-term maintainability.

| ID | Concern | Recommendation | Priority |
|----|---------|----------------|----------|
| A1 | <pattern that may cause issues> | <recommended fix or refactor> | P1/P2/P3 |
| A2 | <missing abstraction or API gap> | <suggested approach> | P1/P2/P3 |

##### Dependency Concerns {#audit-dep-concerns}

| ID | Concern | Fix |
|----|---------|-----|
| D1 | <dependency with issues> | <alternative or mitigation> |
| D2 | <missing platform support> | <what to add> |

**Checkpoint:**
- [ ] All P0 issues resolved
- [ ] All P1 issues resolved or explicitly deferred with rationale
- [ ] `<verification command>`

---

### X.Y.6 Deliverables and Checkpoints {#deliverables}

> This is the single place we define “done” for the phase. Keep it crisp and testable.

**Deliverable:** <One sentence deliverable>

#### Phase Exit Criteria (“Done means…”) {#exit-criteria}

- [ ] <criterion> (verification)
- [ ] <criterion> (verification)

**Acceptance tests:** (where T is one of: unit, integration, golden / contract, drift prevention)
- [ ] <T test>
- [ ] <T test>

#### Milestones (Within Phase) (Optional) {#milestones}

**Milestone M01: <Title>** {#m01-milestone-slug}
- [ ] <what becomes true at this point>

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] <follow-on item>
- [ ] <follow-on item>

| Checkpoint | Verification |
|------------|--------------|
| <checkpoint> | <command/test/proof> |

**Commit after all checkpoints pass.**

