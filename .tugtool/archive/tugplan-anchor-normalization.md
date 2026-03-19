## Phase 1.0: Establish Bare Anchor Format as Canonical Convention {#phase-anchor-normalization}

**Purpose:** Establish `step-0` (bare, no `#` prefix) as the ONE canonical anchor format everywhere outside of markdown plan documents, and add a `normalize_anchor()` safety net in StateDb to handle any residual `#`-prefixed values.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | anchor-normalization |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-25 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `#` prefix on step anchors was markdown reference syntax (`#step-0` means "link to anchor `step-0`") that leaked into non-markdown contexts: CLI arguments, JSON payloads, git trailers, log entries, and DB storage. The StateDb stores anchors without the `#` prefix, but many callers pass `#step-0`, causing silent SQL lookup failures that manifest as "step not found" or "step not claimed" errors.

The canonical anchor format is `step-0` (bare, no `#`) EVERYWHERE except inside actual markdown plan documents (where anchor attributes and link references correctly use `#` as part of markdown syntax). The `#` never appears in CLI args, JSON payloads, log entries, git trailers, or DB storage.

This plan fixes all code that currently emits or expects `#`-prefixed anchors in non-markdown contexts, and adds a defensive `normalize_anchor()` helper in StateDb to handle any residual `#`-prefixed values from historical data or unfixed callers.

#### Strategy {#strategy}

- Fix all sources that emit `#`-prefixed anchors in non-markdown contexts (commit trailers, log entries, CLI docs, status JSON output, agent templates)
- Add a `normalize_anchor()` safety net inside StateDb that strips `#` if present — defensive, not the primary fix
- Update all tests to use and assert the bare format
- Update all agent markdown templates (SKILL.md, agent docs) to use bare `step-0` in JSON payloads and text references
- Do NOT fix historical data (existing git trailers, existing log entries stay as-is)

#### Stakeholders / Primary Customers {#stakeholders}

1. Implementer agent — relies on StateDb for step lifecycle operations during plan execution
2. Committer agent — writes Tug-Step trailers and log entries
3. Architect, coder, and reviewer agents — send step_anchor values in JSON payloads

#### Success Criteria (Measurable) {#success-criteria}

- All non-markdown contexts emit bare `step-0` format (verified by updated tests)
- All 10 StateDb methods accept both `step-0` and `#step-0` as a defensive measure (verified by unit tests)
- All agent templates and JSON examples use bare `step-0` format (verified by grep)
- Existing tests pass after updating assertions to bare format (`cargo nextest run`)
- No new warnings introduced (enforced by `-D warnings`)

#### Scope {#scope}

1. Add `normalize_anchor()` helper function in `state.rs` as a defensive safety net
2. Apply normalization in 10 StateDb methods (9 direct-parameter methods + `reconcile`)
3. Fix `log.rs`: strip `#` in `generate_yaml_entry` so log entries write `step: step-0` and `## step-0: summary`
4. Fix `log.rs`: update doc comments from `#step-0` to `step-0`
5. Fix `log.rs` tests: update all test inputs and assertions from `#step-0` to `step-0`
6. Fix `cli.rs`: update `Commit` step doc comment from `#step-0` to `step-0`
7. Fix `cli.rs` tests: update test inputs and assertions from `#step-0` to `step-0` (including `test_commit_command`)
8. Fix `status.rs`: remove `format!("#{}", ...)` wrapping from 6 locations in `build_checkbox_status_data` so JSON output uses bare anchors; update golden fixture `status_fallback.json`
9. Fix `implement/SKILL.md`: change all `step_anchor` JSON values from `"#step-N"` to `"step-N"`
10. Fix agent markdown files (`architect-agent.md`, `coder-agent.md`, `reviewer-agent.md`): change `step_anchor` JSON values and text references from `#step-N` to `step-N`
11. Add comprehensive tests for StateDb anchor normalization

#### Non-goals (Explicitly out of scope) {#non-goals}

- Fixing historical git trailers (existing commits stay as-is; StateDb normalization handles them via reconcile)
- Fixing historical log entries (existing log content stays as-is)
- Changing markdown plan document syntax (anchor attributes and link references keep their `#`)
- Changing `conformance-agent.md` plan-document references (these correctly use markdown `#step-N` syntax for plan headings and Depends-on lines)
- Changing `critic-agent.md` plan-anchor references in `references` arrays (these correctly reference markdown anchors)
- Simplifying the recovery loop in the implement skill (future work)

#### Dependencies / Prerequisites {#dependencies}

- None — this is a self-contained change across `state.rs`, `log.rs`, `cli.rs`, `status.rs`, a golden fixture, and agent template files

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` in `.cargo/config.toml`) — no new warnings allowed
- Must not break existing tests that pass bare anchors (without `#`)
- Historical data in git history and logs must not be retroactively modified

#### Assumptions {#assumptions}

- The `#` prefix is the only variant that needs normalization (no other prefix characters)
- `normalize_anchor()` will be a simple function, not a method on StateDb
- The 9 direct-parameter methods plus `reconcile` are the complete set of StateDb methods that use step anchors in SQL queries
- Existing tests use bare anchors (`step-0`) for StateDb and commit.rs and will continue to pass unchanged
- Agent templates are the source of truth for JSON payload format; agents will pick up the new bare format on next invocation

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Bare `step-0` is the canonical format everywhere outside markdown (DECIDED) {#d01-bare-canonical}

**Decision:** The canonical step anchor format is `step-0` (bare, no `#` prefix) in all non-markdown contexts: CLI arguments, JSON payloads, git trailers, log entries, and DB storage. The `#` prefix only appears in markdown plan document syntax (anchor attributes, link references, and `**Depends on:**` lines).

**Rationale:**
- The `#` was markdown reference syntax that leaked into non-markdown contexts
- Bare format matches what StateDb already stores internally
- Eliminates the class of bugs where `#`-prefixed strings fail exact SQL matches
- Clear rule: `#` means "markdown anchor reference" and nothing else

**Implications:**
- All code that writes anchors to non-markdown output must emit bare format
- Agent templates must use bare format in JSON examples
- Historical data is not retroactively fixed; the StateDb safety net handles it

#### [D02] StateDb normalize_anchor() as defensive safety net (DECIDED) {#d02-statedb-safety-net}

**Decision:** Add `normalize_anchor()` in StateDb that strips a leading `#` if present, applied at the entry point of every method that accepts an anchor parameter. This is a defensive measure, not the primary fix.

**Rationale:**
- Historical git trailers contain `#step-0` and will be read by reconcile indefinitely
- Defense-in-depth: even after fixing all callers, the DB layer should be tolerant
- A simple `strip_prefix('#').unwrap_or(input)` is clear, testable, and zero-allocation

**Implications:**
- The function signature is `fn normalize_anchor(anchor: &str) -> &str` — borrows input, returns a slice
- Zero heap allocation in either path
- Error messages from StateDb methods will report the normalized anchor value (e.g., `step-0` even if the caller passed `#step-0`); this is intentional since the normalized form matches what is stored in the DB

#### [D03] Fix sources, not just consumers (DECIDED) {#d03-fix-sources}

**Decision:** Fix all code that currently emits `#`-prefixed anchors in non-markdown contexts: `log.rs` (YAML entries), `cli.rs` (doc comments), `status.rs` (JSON output), agent templates (JSON examples). Do not rely solely on StateDb normalization.

**Rationale:**
- Fixing only the consumer (StateDb) would leave inconsistent formats in logs, trailers, and agent payloads
- Users reading git log, implementation log, or CLI help should see the canonical bare format
- Clean convention prevents future confusion about which format to use

**Implications:**
- `log.rs` `log_prepend_inner` must strip `#` at entry, normalizing the step value before it reaches `generate_yaml_entry` or `PrependResult`
- `status.rs` `build_checkbox_status_data` must emit bare anchors in JSON output (remove `format!("#{}", ...)` wrapping)
- CLI doc comments must show bare `step-0` in examples
- Agent templates must use bare `step-0` in JSON payloads
- All test assertions and golden fixtures must be updated to expect bare format

#### [D04] Do not fix historical data (DECIDED) {#d04-no-historical-fix}

**Decision:** Existing git trailers and log entries that contain `#step-0` are not retroactively modified.

**Rationale:**
- Rewriting git history is destructive and unnecessary
- Editing existing log entries risks corrupting the log
- The StateDb `normalize_anchor()` safety net handles historical `#`-prefixed values when they are read by reconcile

**Implications:**
- The reconcile flow will continue reading old `#step-0` trailers; StateDb normalization handles them transparently
- The implementation log may contain a mix of `#step-0` (old) and `step-0` (new) entries; this is acceptable

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 normalize_anchor Function {#function-signature}

**Spec S01: normalize_anchor function** {#s01-normalize-anchor}

```rust
/// Strip the leading '#' from an anchor if present.
/// StateDb stores anchors without the '#' prefix. This is a defensive
/// safety net for historical data and any residual '#'-prefixed callers.
fn normalize_anchor(anchor: &str) -> &str {
    anchor.strip_prefix('#').unwrap_or(anchor)
}
```

- Visibility: module-private (`fn`, not `pub fn`) — only used within `state.rs`
- Returns a `&str` borrowing from the input — zero allocation
- Idempotent: calling it on an already-bare anchor returns the same value

#### 1.0.1.2 StateDb Methods Requiring Normalization {#affected-methods}

**Table T01: StateDb Methods Requiring Normalization** {#t01-affected-methods}

| # | Method | Anchor source | Normalization point |
|---|--------|--------------|-------------------|
| 1 | `check_ownership` | `anchor: &str` parameter | First line of method body |
| 2 | `start_step` | `anchor: &str` parameter | First line of method body |
| 3 | `heartbeat_step` | `anchor: &str` parameter | First line of method body |
| 4 | `update_checklist` | `anchor: &str` parameter | First line of method body |
| 5 | `batch_update_checklist` | `anchor: &str` parameter | First line of method body |
| 6 | `record_artifact` | `anchor: &str` parameter | First line of method body |
| 7 | `complete_step` | `anchor: &str` parameter | First line of method body |
| 8 | `reset_step` | `anchor: &str` parameter | First line of method body |
| 9 | `release_step` | `anchor: &str` parameter | First line of method body |
| 10 | `reconcile` | `entry.step_anchor` in for-loop | First line of for-loop body |

#### 1.0.1.3 Normalization Pattern {#normalization-pattern}

Each method applies normalization by rebinding the `anchor` parameter at the start of the method body:

```rust
pub fn some_method(&self, plan_path: &str, anchor: &str, ...) -> Result<...> {
    let anchor = normalize_anchor(anchor);
    // ... rest of method unchanged, uses `anchor` which shadows the parameter
}
```

For `reconcile`, the anchor comes from `entry.step_anchor` rather than a method parameter:

```rust
for entry in entries {
    let step_anchor = normalize_anchor(&entry.step_anchor);
    // ... use &step_anchor (instead of &entry.step_anchor) in all 5 SQL query params
    // ... use step_anchor.to_string() (instead of entry.step_anchor.clone()) in SkippedMismatch construction
}
```

This replaces all 6 uses of `entry.step_anchor` in the loop body:
- 5 SQL query parameters: replace `&entry.step_anchor` with `&step_anchor`
- 1 `SkippedMismatch` struct construction: replace `entry.step_anchor.clone()` with `step_anchor.to_string()` (since `normalize_anchor` returns `&str`, not `String`, `.clone()` is not available; use `.to_string()` or `.to_owned()` instead)

#### 1.0.1.4 Source Fixes Outside StateDb {#source-fixes}

**Table T02: Non-StateDb Source Fixes** {#t02-source-fixes}

| # | File | Location | Current format | Fix |
|---|------|----------|---------------|-----|
| 1 | `tugcode/crates/tugcode/src/commands/log.rs` | `log_prepend_inner` fn | Passes raw `step` to `generate_yaml_entry` and stores it in `PrependResult.step` | Strip `#` from `step` at the top of `log_prepend_inner` so both the log file content and the returned `PrependResult` use bare format |
| 2 | `tugcode/crates/tugcode/src/commands/log.rs` | `Prepend` struct doc comment | `/// Step anchor (e.g., #step-0)` | Change to `/// Step anchor (e.g., step-0)` |
| 3 | `tugcode/crates/tugcode/src/commands/log.rs` | `run_log_prepend` doc comment | `/// * step - Step anchor (e.g., #step-0)` | Change to `/// * step - Step anchor (e.g., step-0)` |
| 4 | `tugcode/crates/tugcode/src/commands/log.rs` | Tests | Input `"#step-0"`, assertions `"step: #step-0"` | Change inputs to `"step-0"`, assertions to `"step: step-0"` |
| 5 | `tugcode/crates/tugcode/src/cli.rs` | `Commit` step doc comment | `/// Step anchor (e.g., #step-0)` | Change to `/// Step anchor (e.g., step-0)` |
| 6 | `tugcode/crates/tugcode/src/cli.rs` | Tests (`test_log_prepend_command`, `test_log_prepend_with_quiet_flag`, `test_commit_command`) | Input `"#step-0"`, assertion `"#step-0"` | Change inputs to `"step-0"`, assertions to `"step-0"` |
| 7 | `tugcode/crates/tugcode/src/commands/status.rs` | `build_checkbox_status_data` fn, 6 locations | `format!("#{}", step.anchor)` and `format!("#{}", dep)` | Remove `format!("#{}", ...)` wrapping — use `step.anchor.clone()`, `substep.anchor.clone()`, `dep.clone()` directly |
| 8 | `tugcode/tests/fixtures/golden/status_fallback.json` | All `anchor` and `dependencies` fields | `"#step-0"` | Change to `"step-0"` |

**Not changed (correct markdown plan-document context):**
- `cli.rs` `Validate` long_about: `#step-0` describes what the validator checks inside markdown plans, where `#` is correct reference syntax

**Table T03: Agent Template Fixes** {#t03-agent-template-fixes}

| # | File | Occurrences | Fix |
|---|------|------------|-----|
| 1 | `tugplug/skills/implement/SKILL.md` | `"step_anchor": "#step-0"`, `"all_steps": ["#step-0", ...]`, `"step_anchor": "#step-N"` | Change all `step_anchor` JSON values and `all_steps` array elements from `"#step-N"` to `"step-N"` |
| 2 | `tugplug/agents/architect-agent.md` | `"step_anchor": "#step-0"`, `"all_steps": ["#step-0", ...]`, `"step_anchor": "#step-N"`, text `step #step-1`, `step #step-N` | Change JSON values to `"step-N"` and text references to `step step-N` |
| 3 | `tugplug/agents/coder-agent.md` | `"step_anchor": "#step-0"`, text `step #step-1` | Change JSON value to `"step-0"` and text reference to `step step-1` |
| 4 | `tugplug/agents/reviewer-agent.md` | `"step_anchor": "#step-2"`, text `step #step-1`, text `locate #step-2` | Change JSON value to `"step-2"` and text references to `step step-1`, `locate step-2` |

**Not changed (correct markdown usage):**
- `conformance-agent.md`: heading anchors and `#step-N` in Depends-on suggestions are correct markdown syntax for plan documents
- `critic-agent.md`: `"references": ["#step-2"]` references plan anchors, which correctly use `#`

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `normalize_anchor` | fn | `tugcode/crates/tugtool-core/src/state.rs` | New module-private function |

No new files, crates, or public API changes. Modifications span `state.rs`, `log.rs`, `cli.rs`, `status.rs`, a golden fixture, and 4 agent template files.

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `normalize_anchor()` directly with various inputs | Core logic validation |
| **Unit** | Test each StateDb method with `#`-prefixed anchors | Verify safety net is wired correctly |
| **Unit** | Verify log and CLI tests emit bare format | Verify source fixes |
| **Integration** | Run existing test suite with updated assertions | Regression validation |

#### Test Strategy {#test-strategy}

**List L01: Normalization Test Cases** {#l01-normalization-tests}

1. `normalize_anchor("step-0")` returns `"step-0"` — bare anchor passthrough
2. `normalize_anchor("#step-0")` returns `"step-0"` — strips leading `#`
3. `normalize_anchor("")` returns `""` — empty string passthrough
4. `normalize_anchor("#")` returns `""` — lone hash produces empty string
5. `normalize_anchor("##step-0")` returns `"#step-0"` — only strips one leading `#`

**List L02: Method-Level Integration Tests** {#l02-method-tests}

For each of the 10 methods in Table T01, add a test that:
1. Sets up a plan and step with bare anchor `step-0` in the DB
2. Calls the method with `#step-0` (hash-prefixed anchor) — for `reconcile`, this means a `ReconcileEntry` with `step_anchor: "#step-0"`
3. Verifies the method succeeds with the same behavior as bare `step-0`

Priority methods to test with `#`-prefixed anchors (highest risk of user-visible failure):
- `reconcile` — the primary real-world entry point for `#`-prefixed anchors (reads historical Tug-Step trailers)
- `start_step` — called at step execution start
- `complete_step` — called at step completion
- `check_ownership` — called by most other methods internally
- `heartbeat_step` — called repeatedly during execution

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Add normalize_anchor safety net in StateDb {#step-0}

**Commit:** `fix: add normalize_anchor safety net in StateDb for '#'-prefixed anchors`

**References:** [D02] StateDb normalize_anchor() as defensive safety net, Spec S01, Table T01, (#function-signature, #normalization-pattern, #affected-methods)

**Artifacts:**
- Modified `tugcode/crates/tugtool-core/src/state.rs` — new `normalize_anchor()` function and normalization calls in 10 methods

**Tasks:**
- [ ] Add `normalize_anchor()` function near the top of `state.rs` (module-private, before the `impl StateDb` block or as a standalone fn)
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `check_ownership`
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `start_step`
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `heartbeat_step`
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `update_checklist`
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `batch_update_checklist`
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `record_artifact`
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `complete_step`
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `reset_step`
- [ ] Add `let anchor = normalize_anchor(anchor);` as the first line in `release_step`
- [ ] In `reconcile`, add `let step_anchor = normalize_anchor(&entry.step_anchor);` as the first line of the for-loop body and replace all 6 uses of `entry.step_anchor` in the loop: 5 SQL query params (`&entry.step_anchor` becomes `&step_anchor`) and 1 `SkippedMismatch` struct construction (`entry.step_anchor.clone()` becomes `step_anchor.to_string()`)

**Tests:**
- [ ] Unit test: `normalize_anchor` returns bare anchor unchanged
- [ ] Unit test: `normalize_anchor` strips leading `#`
- [ ] Unit test: `normalize_anchor` handles empty string
- [ ] Unit test: `normalize_anchor` strips only one leading `#` (double-hash case)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` — no warnings, no errors
- [ ] `cd tugcode && cargo nextest run` — all existing tests pass
- [ ] `cd tugcode && cargo fmt --all --check` — formatting is clean

**Rollback:**
- Revert the single commit; no database schema changes involved

**Commit after all checkpoints pass.**

---

#### Step 1: Fix log.rs, cli.rs, and status.rs to emit and document bare anchor format {#step-1}

**Depends on:** #step-0

**Commit:** `fix: use bare step anchor format in log entries, status JSON, CLI docs, and tests`

**References:** [D01] Bare step-0 is canonical, [D03] Fix sources not just consumers, [D04] Do not fix historical data, Table T02, (#source-fixes)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/log.rs` — `log_prepend_inner` strips `#` from step at entry, doc comments updated, tests updated
- Modified `tugcode/crates/tugcode/src/cli.rs` — doc comments updated, tests updated
- Modified `tugcode/crates/tugcode/src/commands/status.rs` — removed `format!("#{}", ...)` wrapping in `build_checkbox_status_data`
- Modified `tugcode/tests/fixtures/golden/status_fallback.json` — updated `"#step-0"` to `"step-0"`

**Tasks:**
- [ ] In `log.rs` `log_prepend_inner`: add `let step = step.strip_prefix('#').unwrap_or(step);` as the first line of the function body (before the log path construction). This normalizes the step value at entry so that both `generate_yaml_entry` (log file content) and `PrependResult { step: step.to_string(), ... }` (returned result) use the bare format. No change needed inside `generate_yaml_entry` itself since it receives the already-normalized value
- [ ] In `log.rs`: update `Prepend` struct doc comment from `/// Step anchor (e.g., #step-0)` to `/// Step anchor (e.g., step-0)`
- [ ] In `log.rs`: update `run_log_prepend` doc comment from `/// * step - Step anchor (e.g., #step-0)` to `/// * step - Step anchor (e.g., step-0)`
- [ ] In `log.rs` test `test_yaml_entry_generation`: change input from `"#step-0"` to `"step-0"` and update assertions from `"step: #step-0"` to `"step: step-0"` and `"## #step-0: Test summary"` to `"## step-0: Test summary"`
- [ ] In `log.rs` test `test_log_prepend_full_flow`: change input from `"#step-0".to_string()` to `"step-0".to_string()` and update all assertions from `"step: #step-0"` / `"## #step-0:"` to bare format
- [ ] In `log.rs` test `test_log_prepend_multiple_entries`: change inputs from `"#step-0"` / `"#step-1"` to `"step-0"` / `"step-1"` and update assertions from `"step: #step-0"` / `"step: #step-1"` to bare format
- [ ] In `log.rs` test `test_log_prepend_nonexistent_log`: change input from `"#step-0".to_string()` to `"step-0".to_string()`
- [ ] In `cli.rs`: update `Commit` step doc comment from `/// Step anchor (e.g., #step-0)` to `/// Step anchor (e.g., step-0)`
- [ ] In `cli.rs` test `test_log_prepend_command`: change input from `"#step-0"` to `"step-0"` and update assertion from `assert_eq!(step, "#step-0")` to `assert_eq!(step, "step-0")`
- [ ] In `cli.rs` test `test_log_prepend_with_quiet_flag`: change input from `"#step-0"` to `"step-0"`
- [ ] In `cli.rs` test `test_commit_command`: change input from `"#step-0"` to `"step-0"` and update assertion from `assert_eq!(step, "#step-0")` to `assert_eq!(step, "step-0")`
- [ ] In `status.rs` `build_checkbox_status_data`: remove `format!("#{}", ...)` wrapping from all 6 locations — use `step.anchor.clone()` / `substep.anchor.clone()` / `dep.clone()` directly instead of `format!("#{}", step.anchor)` / `format!("#{}", substep.anchor)` / `format!("#{}", dep)`
- [ ] Update golden fixture `tugcode/tests/fixtures/golden/status_fallback.json`: change all `"#step-0"` values to `"step-0"` in `anchor`, `dependencies`, and related fields
- [ ] Note: `cli.rs` `Validate` long_about keeps `#step-0` — it describes what the validator checks in markdown plans where `#` is correct

**Tests:**
- [ ] Unit test: `test_yaml_entry_generation` — verify output contains `step: step-0` (no `#`)
- [ ] Integration test: `test_log_prepend_full_flow` — verify log entry uses bare format
- [ ] Integration test: `test_log_prepend_multiple_entries` — verify both entries use bare format
- [ ] Unit test: CLI parsing tests pass with bare `step-0` input (`test_log_prepend_command`, `test_commit_command`)
- [ ] Golden test: `test_golden_fallback_status_json` — verify status JSON output uses bare anchors

**Checkpoint:**
- [ ] `cd tugcode && cargo build` — no warnings, no errors
- [ ] `cd tugcode && cargo nextest run` — all tests pass with updated assertions (including golden test)
- [ ] `cd tugcode && cargo fmt --all --check` — formatting is clean
- [ ] No remaining `format!("#{}"` in `status.rs` (verify with grep)
- [ ] No remaining `#step-` in `log.rs` or `cli.rs` tests outside of markdown-context references (verify with grep)

**Rollback:**
- Revert the single commit; test, doc comment, and format string changes only

**Commit after all checkpoints pass.**

---

#### Step 2: Update agent templates to use bare anchor format {#step-2}

**Depends on:** #step-0

**Commit:** `fix: use bare step anchor format in agent templates and SKILL.md`

**References:** [D01] Bare step-0 is canonical, [D03] Fix sources not just consumers, Table T03, (#source-fixes)

**Artifacts:**
- Modified `tugplug/skills/implement/SKILL.md` — JSON examples updated
- Modified `tugplug/agents/architect-agent.md` — JSON examples and text references updated
- Modified `tugplug/agents/coder-agent.md` — JSON example and text reference updated
- Modified `tugplug/agents/reviewer-agent.md` — JSON example and text references updated

**Tasks:**
- [ ] In `implement/SKILL.md`: change `"all_steps": ["#step-0", "#step-1"]` to `"all_steps": ["step-0", "step-1"]`; change all `"step_anchor": "#step-0"` and `"step_anchor": "#step-N"` to bare format
- [ ] In `architect-agent.md`: change `"step_anchor": "#step-0"` and `"step_anchor": "#step-N"` to bare format; change `"all_steps": ["#step-0", "#step-1", "#step-2"]` to bare format; change text `step #step-1` to `step step-1` and `step #step-N` to `step step-N`
- [ ] In `coder-agent.md`: change `"step_anchor": "#step-0"` to `"step_anchor": "step-0"`; change text `step #step-1` to `step step-1`
- [ ] In `reviewer-agent.md`: change `"step_anchor": "#step-2"` to `"step_anchor": "step-2"`; change text `step #step-1` to `step step-1`; change text `locate #step-2` to `locate step-2`
- [ ] Verify: `conformance-agent.md` is NOT changed (its heading anchors and `#step-N` references are correct markdown plan-document syntax)
- [ ] Verify: `critic-agent.md` is NOT changed (its `"references": ["#step-2"]` correctly references a markdown anchor)

**Tests:**
- [ ] Grep verification: no `"#step-` (quoted `#step-`) in any modified agent template file
- [ ] Manual review: confirm `conformance-agent.md` and `critic-agent.md` are untouched

**Checkpoint:**
- [ ] Grep `tugplug/` for `"#step-` (JSON context) returns 0 results in modified files
- [ ] Broader grep: no `#step-` (without leading quote) in modified agent template files except in correct markdown plan-document contexts
- [ ] `conformance-agent.md` and `critic-agent.md` have not changed (verified by `git diff`)

**Rollback:**
- Revert the single commit; template-only changes have no runtime risk

**Commit after all checkpoints pass.**

---

#### Step 3: Add comprehensive StateDb normalization tests {#step-3}

**Depends on:** #step-0

**Commit:** `test: add comprehensive tests for anchor normalization in StateDb`

**References:** [D02] StateDb normalize_anchor() as defensive safety net, List L01, List L02, Table T01, (#test-strategy, #l01-normalization-tests, #l02-method-tests)

**Artifacts:**
- Modified `tugcode/crates/tugtool-core/src/state.rs` — new test functions in the `#[cfg(test)] mod tests` block

**Tasks:**
- [ ] Add test `test_normalize_anchor_strips_hash` covering List L01 cases (bare, `#`-prefixed, empty, lone `#`, double `#`)
- [ ] Add test `test_start_step_with_hash_prefix` — set up plan with `step-0`, call `start_step` with `#step-0`, verify success
- [ ] Add test `test_complete_step_with_hash_prefix` — set up plan with `step-0`, claim and start it, call `complete_step` with `#step-0`, verify success
- [ ] Add test `test_heartbeat_step_with_hash_prefix` — set up plan with `step-0`, claim and start it, call `heartbeat_step` with `#step-0`, verify returns lease expiry
- [ ] Add test `test_check_ownership_with_hash_prefix` — set up plan with `step-0`, claim it, call `check_ownership` with `#step-0`, verify success
- [ ] Add test `test_update_checklist_with_hash_prefix` — set up plan with checklist items, call `update_checklist` with `#step-0`, verify items updated
- [ ] Add test `test_record_artifact_with_hash_prefix` — set up plan, call `record_artifact` with `#step-0`, verify artifact recorded
- [ ] Add test `test_reset_step_with_hash_prefix` — set up plan with claimed step, call `reset_step` with `#step-0`, verify step returns to pending
- [ ] Add test `test_release_step_with_hash_prefix` — set up plan with claimed step, call `release_step` with `#step-0`, verify step released
- [ ] Add test `test_batch_update_checklist_with_hash_prefix` — set up plan with checklist items, call `batch_update_checklist` with `#step-0`, verify items updated. Note: `batch_update_checklist` takes a generic `&[T] where T: BatchEntry`; the test should define a test-local `TestBatchEntry` struct implementing the `BatchEntry` trait (kind, ordinal, status, reason methods), or reference the existing `BatchUpdateEntry` struct in `tugcode/crates/tugcode/src/commands/state.rs` which already implements it
- [ ] Add test `test_reconcile_with_hash_prefix` — set up plan with `step-0` in DB, create a `ReconcileEntry` with `step_anchor: "#step-0".to_string()`, call `reconcile`, verify step is reconciled successfully

**Tests:**
- [ ] Unit test: `test_normalize_anchor_strips_hash` — 5 assertions covering all List L01 cases
- [ ] Integration test: `test_start_step_with_hash_prefix` — full lifecycle with `#`-prefixed anchor
- [ ] Integration test: `test_complete_step_with_hash_prefix` — full lifecycle with `#`-prefixed anchor
- [ ] Integration test: `test_heartbeat_step_with_hash_prefix` — heartbeat with `#`-prefixed anchor
- [ ] Integration test: `test_check_ownership_with_hash_prefix` — ownership check with `#`-prefixed anchor
- [ ] Integration test: `test_update_checklist_with_hash_prefix` — checklist update with `#`-prefixed anchor
- [ ] Integration test: `test_record_artifact_with_hash_prefix` — artifact recording with `#`-prefixed anchor
- [ ] Integration test: `test_reset_step_with_hash_prefix` — step reset with `#`-prefixed anchor
- [ ] Integration test: `test_release_step_with_hash_prefix` — step release with `#`-prefixed anchor
- [ ] Integration test: `test_batch_update_checklist_with_hash_prefix` — batch checklist update with `#`-prefixed anchor
- [ ] Integration test: `test_reconcile_with_hash_prefix` — reconcile with `#`-prefixed anchor in `ReconcileEntry`

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` — all new tests pass alongside existing tests
- [ ] `cd tugcode && cargo fmt --all --check` — formatting is clean
- [ ] All 10 methods have at least one `#`-prefixed anchor test

**Rollback:**
- Revert the single commit; test-only changes pose no runtime risk

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Bare `step-0` is the canonical anchor format everywhere outside markdown plan documents. All code that previously emitted `#step-0` in non-markdown contexts is fixed. StateDb has a defensive `normalize_anchor()` safety net for historical data and any residual `#`-prefixed values.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `normalize_anchor()` function exists in `state.rs` and strips leading `#` (verified by unit tests)
- [ ] All 10 StateDb methods listed in Table T01 call `normalize_anchor()` at their entry point or loop body (verified by code review)
- [ ] `log.rs` `log_prepend_inner` strips `#` prefix at entry so both log content and `PrependResult` use bare format (verified by `test_yaml_entry_generation` and `test_log_prepend_full_flow`)
- [ ] `status.rs` `build_checkbox_status_data` emits bare anchors in JSON output (verified by `test_golden_fallback_status_json`)
- [ ] CLI doc comments show bare `step-0` examples (verified by code review)
- [ ] All agent templates use bare `step-0` in JSON payloads (verified by grep)
- [ ] No `"#step-` pattern in agent template JSON contexts (verified by grep)
- [ ] All existing tests pass with updated assertions (`cd tugcode && cargo nextest run`)
- [ ] New StateDb normalization tests cover `#`-prefixed anchors for all 10 methods
- [ ] No new warnings (`cd tugcode && cargo build` succeeds with `-D warnings`)
- [ ] Code is formatted (`cd tugcode && cargo fmt --all --check`)

**Acceptance tests:**
- [ ] Unit test: `test_normalize_anchor_strips_hash` passes
- [ ] Unit test: `test_yaml_entry_generation` outputs `step: step-0` (no `#`)
- [ ] Golden test: `test_golden_fallback_status_json` passes with bare anchors
- [ ] Integration test: calling `start_step` then `complete_step` with `#step-0` succeeds end-to-end
- [ ] Integration test: `test_reconcile_with_hash_prefix` passes
- [ ] Integration test: all 10 method-specific `#`-prefix tests pass
- [ ] Grep: no `"#step-` in modified agent templates

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Simplify recovery loop in implement skill now that StateDb handles `#` transparently
- [ ] Consider adding normalization to any future StateDb methods that accept anchor parameters

| Checkpoint | Verification |
|------------|--------------|
| Build clean | `cd tugcode && cargo build` exits 0 with no warnings |
| All tests pass | `cd tugcode && cargo nextest run` exits 0 |
| Formatting clean | `cd tugcode && cargo fmt --all --check` exits 0 |
| No leaked `#step-` in non-markdown | `grep -r '"#step-' tugplug/` returns 0 matches in modified files |

**Commit after all checkpoints pass.**
