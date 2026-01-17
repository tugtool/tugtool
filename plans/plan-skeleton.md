## Phase X.Y <Phase Title>

**Purpose:** <1–2 sentences. What capability ships at the end of this phase?>

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

### X.Y.0 Design Decisions

> Record *decisions* (not options). Each decision includes the “why” so later phases don’t reopen it accidentally.

#### <Decision Name> (DECIDED)

**Decision:** <One sentence decision statement>

**Rationale:**
- <Why>
- <Why>

**Implications:**
- <What this forces in APIs / storage / tests>

---

### X.Y.1 Specification

> This section is the contract. It should be complete enough that implementation work can proceed without inventing semantics.

#### X.Y.1.1 Inputs and Outputs (Data Model)

**Inputs:**
- <Input artifact(s) and supported formats>

**Outputs:**
- <Output artifact(s), return types, side effects>

**Key invariants:**
- <Invariant>
- <Invariant>

#### X.Y.1.2 Terminology and Naming

- **<Term>**: <Definition>
- **<Term>**: <Definition>

#### X.Y.1.3 Supported Features (Exhaustive)

> Be explicit. Avoid “etc.” and “and more”.

- **Supported**:
  - <Feature>
  - <Feature>
- **Explicitly not supported**:
  - <Feature>
  - <Feature>
- **Behavior when unsupported is encountered**:
  - <Policy-specific or mode-specific behavior>

#### X.Y.1.4 Modes / Policies (if applicable)

| Mode/Policy | Applies to | Behavior | Result |
|------------|------------|----------|--------|
| `<mode>` | <where> | <what happens> | <what is returned> |

#### X.Y.1.5 Semantics (Normative Rules)

> Write this like a spec: bullet rules, deterministic ordering, and edge-case behavior.

- **Traversal / evaluation order**: <rule>
- **Ordering guarantees**: <rule>
- **Stopping conditions**: <rule>
- **Null vs missing**: <rule>
- **Coercion rules (if any)**:
  - <rule>

#### X.Y.1.6 Error and Warning Model

> Errors and warnings are the developer UI—be precise.

**Error fields (required):**
- <field>: <meaning>

**Warning fields (required):**
- <field>: <meaning>

**Path formats (if any):**
- Data path format: <e.g., RFC 6901 JSON Pointer>
- Schema path format: <e.g., keyword-level paths>
- Escaping rules: <e.g., "~" and "/">

#### X.Y.1.7 Public API Surface

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

#### X.Y.1.8 Internal Architecture

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

### X.Y.2 Definitive Symbol Inventory

> A concrete list of new crates/files/symbols to add. This is what keeps implementation crisp.

#### X.Y.2.1 New crates (if any)

| Crate | Purpose |
|-------|---------|
| `<crate>` | <purpose> |

#### X.Y.2.2 New files (if any)

| File | Purpose |
|------|---------|
| `<path>` | <purpose> |

#### X.Y.2.3 Symbols to add / modify

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `<Name>` | enum/struct/fn | `<path>` | <notes> |

---

### X.Y.3 Documentation Plan

- [ ] <Docs update>
- [ ] <Examples / schema examples / API docs>

---

### X.Y.3 Test Plan Concepts

> Describe the kinds tests that prove the spec, especially unit tests, integration tests, golden / contract tests (recommended for schemas, APIs, parsers), “drift prevention” tests, but leave the actual enumeration of tests to the Execution Steps below.

---

### X.Y.5 Execution Steps

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.

#### Step 1: <Step Title>

**Commit:** `<conventional-commit message>`

**References:** `<citations to front matter from X.Y.0–X.Y.4>`

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

**References:** `<citations to front matter from X.Y.0–X.Y.4>`

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

### X.Y.6 Deliverables and Checkpoints

> This is the single place we define “done”. No separate Success Criteria section.

**Deliverable:** <One sentence deliverable>

**Tests:** (where T is one of: unit, integration, golden / contract, drift prevention)
- [ ] <T test>
- [ ] <T test>

| Checkpoint | Verification |
|------------|--------------|
| <checkpoint> | <command/test/proof> |

**Commit after all checkpoints pass.**

