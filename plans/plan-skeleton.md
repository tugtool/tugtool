## Phase X.Y: <Phase Title> {#phase-slug}

**Purpose:** <1–2 sentences. What capability ships at the end of this phase?>

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan format relies on **explicit, named anchors** in the front matter and **rich `References:` lines** in execution steps.

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
  - **`op-...`**: refactor operations, e.g. `{#op-rename}`, `{#op-extract-fn}`
  - **`cmd-...`**: CLI commands, e.g. `{#cmd-run}`
  - **`type-...`**: schema types, e.g. `{#type-span}`
  - **`seq-...`**: sequence diagrams, e.g. `{#seq-rename-python}`
  - **`fixture-...`**: fixture sections, e.g. `{#fixture-py-rename-fn}`
  - **Domain anchors**: for major concepts/sections, use a clear noun phrase, e.g. `{#cross-platform}`, `{#config-schema}`, `{#error-scenarios}`

#### 3) Stable label conventions (for non-heading artifacts)

Use stable labels so steps can cite exact plan artifacts even when prose moves around:

- **Design decisions**: `#### [D01] <Title> (DECIDED) {#d01-...}`
- **Specs**: `**Spec S01: <Title>** {#s01-slug}` (or make it a `####` heading if you prefer)
- **Tables**: `**Table T01: <Title>** {#t01-slug}`
- **Lists**: `**List L01: <Title>** {#l01-slug}`

Numbering rules:
- Always use **two digits**: `D01`, `S01`, `T01`, `L01`.
- Never reuse an ID within a plan. If you delete one, leave the gap.

#### 4) `**References:**` lines are required for every execution step

Every step must include a `**References:**` line that cites the specific front matter artifacts it implements.

Rules:
- Cite **decisions** by ID: `[D05] ...`
- Cite **specs/lists/tables** by label: `Spec S15`, `List L03`, `Tables T27-T28`, etc.
- Cite **anchors** for deep links in parentheses using `#anchor` tokens (keep them stable):
  - Example:
    - `1.0.11 Cross-Platform Support (#cross-platform, #platform-strategy, Tables T27-T28)`
- Prefer **rich, exhaustive citations**. Avoid `N/A` unless the step is truly refactor-only.

**Scope:**
1. <Scope item>
2. <Scope item>
3. <Scope item>

**Non-goals (explicitly out of scope):**
- <Non-goal>
- <Non-goal>

**Dependencies / prerequisites:**
- <Dependency>
- <Prerequisite>

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

#### X.Y.1.8 Internal Architecture {#internal-architecture}

> Explain how components fit together so work doesn’t fork midstream.

- **Single source of truth**: <what>
- **Compilation / interpretation pipeline**:
  - <step>
  - <step>
- **Where code lives**:
  - <crate/module ownership>
- **Non-negotiable invariants to prevent drift**:
  - <e.g., shared keyword list, shared $ref resolver, golden tests>

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

> Describe the kinds tests that prove the spec, especially unit tests, integration tests, golden / contract tests (recommended for schemas, APIs, parsers), “drift prevention” tests, but leave the actual enumeration of tests to the Execution Steps below.

---

### X.Y.5 Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.

#### Step 1: <Step Title>

**Commit:** `<conventional-commit message>`

**References:** `<citations to front matter from X.Y.0–X.Y.4, plus anchors like (#cross-platform, #cmd-run) as needed>`

**Tasks:**
- [ ] <task>
- [ ] <task>

**Tests:** (where T is one of: unit, integration, golden / contract, drift prevention)
- [ ] <T test>
- [ ] <T test>

**Checkpoint:**
- [ ] <command>
- [ ] <command>

**Commit after all checkpoints pass.**

---

#### Step 2: <Step Title>

**Commit:** `<conventional-commit message>`

**References:** `<citations to front matter from X.Y.0–X.Y.4, plus anchors like (#op-rename, #error-scenarios) as needed>`

**Tasks:**
- [ ] <task>
- [ ] <task>

**Tests:** (where T is one of: unit, integration, golden / contract, drift prevention)
- [ ] <T test>
- [ ] <T test>

**Checkpoint:**
- [ ] <command>
- [ ] <command>

**Commit after all checkpoints pass.**

---

### X.Y.6 Deliverables and Checkpoints {#deliverables}

> This is the single place we define “done”. No separate Success Criteria section.

**Deliverable:** <One sentence deliverable>

**Tests:** (where T is one of: unit, integration, golden / contract, drift prevention)
- [ ] <T test>
- [ ] <T test>

| Checkpoint | Verification |
|------------|--------------|
| <checkpoint> | <command/test/proof> |

**Commit after all checkpoints pass.**

