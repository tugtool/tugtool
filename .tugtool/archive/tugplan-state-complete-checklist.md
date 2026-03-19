<!-- tugplan-skeleton v2 -->

## State Complete-Checklist CLI Simplification {#state-complete-checklist}

**Purpose:** Replace the fragile `echo '[]' | tugcode state update ... --batch --complete-remaining` incantation with a dedicated `tugcode state complete-checklist` subcommand, and remove the dead `state update` command along with its unused per-item flags and library code.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-02-28 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `tugcode state update` command is a Rube Goldberg machine. Its sole production use case -- "reviewer approved, mark the step's checklist done" -- requires piping an empty JSON array through stdin with two flags (`--batch --complete-remaining`). The per-item flags (`--task`, `--test`, `--checkpoint`, `--all-tasks`, `--all-tests`, `--all-checkpoints`, `--all`, `--allow-reopen`) exist in the CLI but have zero production callers. The corresponding `ChecklistUpdate` enum and `update_checklist` method in tugtool-core serve only these dead flags.

The state system is a completion ledger: agents do work, the reviewer verifies, and the orchestrator records the result. This means exactly one operation is needed: "mark this step's checklist done, with optional deferrals." The current command shape obscures this intent behind flag ceremony.

#### Strategy {#strategy}

- Add a new `state complete-checklist` subcommand that expresses the sole production intent directly
- Use `std::io::IsTerminal` for TTY detection so stdin piping is optional (no pipe = no deferrals)
- Treat EOF/empty-read on non-TTY stdin the same as TTY (empty deferrals), so piping an empty string or `/dev/null` behaves identically to interactive invocation
- Remove `state update` entirely since no production callers exist (YAGNI per user decision)
- Delete the dead `ChecklistUpdate` enum and `update_checklist` method from tugtool-core, including their unit tests
- Keep `batch_update_checklist` unchanged -- it is the sound library implementation backing the new command
- Update all `state update` command references and `--complete-remaining` references in `SKILL.md` (12 lines with "state update", 17 lines with "complete-remaining")
- Delete tests for removed code; write new tests for `complete-checklist`

#### Success Criteria (Measurable) {#success-criteria}

- `tugcode state complete-checklist <plan> <step> --worktree <path>` succeeds and marks all open items completed (`cargo nextest run` passes)
- `tugcode state update` is not a recognized subcommand (clap rejects it)
- `ChecklistUpdate` and `update_checklist` do not exist in tugtool-core (grep returns zero matches)
- All `state update` command references and `--complete-remaining` references in `SKILL.md` are replaced (grep returns zero for `tugcode state update` and `complete-remaining`)
- `cargo nextest run` passes with zero warnings (project enforces `-D warnings`)
- No new crate-level dependencies added

#### Scope {#scope}

1. New `CompleteChecklist` variant in `StateCommands` enum with TTY-aware stdin handling
2. New `run_state_complete_checklist` function in `commands/state.rs`
3. Removal of `Update` variant from `StateCommands` and `run_state_update` function
4. Removal of `ChecklistUpdate` enum and `update_checklist` method from `tugtool-core/src/state.rs`
5. Removal of `ChecklistUpdate` from `tugtool-core/src/lib.rs` re-exports
6. Deletion of tugtool-core unit tests that call `update_checklist` or reference `ChecklistUpdate`
7. Deletion of integration tests exercising removed per-item flags and batch-without-complete-remaining
8. New integration tests for `complete-checklist` (happy path, with deferrals, EOF handling, drift checking)
9. Update all `state update` command references and `--complete-remaining` references in `tugplug/skills/implement/SKILL.md`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changes to reviewer-agent or coder-agent prompts (they do not call `state update`)
- Changes to `state complete` (step completion, called by `tugcode commit`)
- Changes to `state reconcile`
- Changes to `batch_update_checklist` internals (the library method is sound)
- Adding any new crate-level dependencies
- Renaming `state_update_failed` JSON field in `CommitData` or the `StateFailureReason` enum in `output.rs` -- these are part of the `tugcode commit` API contract, not the `state update` subcommand. The field name describes the commit's state-update outcome, which remains accurate. Renaming would be a breaking API change for commit JSON consumers.
- Renaming `state_update_failed` variable references in `SKILL.md` -- these reference the JSON field from `tugcode commit` output, not the removed subcommand

#### Dependencies / Prerequisites {#dependencies}

- Rust 1.85+ (workspace already requires this; `std::io::IsTerminal` is stable since 1.70)
- No external dependencies -- everything needed is in the Rust stdlib

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` via `.cargo/config.toml`) -- all removed code must leave no dead imports or unused warnings
- `StateUpdateData` struct in `output.rs` is reused for JSON output of the new command (same shape: `plan_path`, `anchor`, `items_updated`)
- TTY detection must use `std::io::IsTerminal` (stable stdlib trait), not a new crate dependency

#### Assumptions {#assumptions}

- The `batch_update_checklist` library method in tugtool-core is kept unchanged -- only `ChecklistUpdate` enum and `update_checklist` method are deleted
- The `--allow-drift` flag is carried over to `complete-checklist` from the old `state update` signature
- The complete-checklist JSON output reuses the existing `StateUpdateData` struct shape under a `state complete-checklist` operation name
- No external consumers of `state update` exist beyond the implement skill and integration tests

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

All headings that will be cited use explicit `{#anchor-name}` anchors. Step anchors follow `step-N`, decisions follow `dNN-slug`, specs follow `sNN-slug`. See skeleton rules.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Missed `state update` caller | med | low | Grep entire repo for all variants | CI test failure on merge |
| TTY detection edge case in CI | low | low | EOF on non-TTY treated as empty deferrals | Integration test fails in CI |

**Risk R01: Missed callers of state update** {#r01-missed-callers}

- **Risk:** An undiscovered caller of `state update` breaks after removal.
- **Mitigation:** Grep the entire repo (`tugplug/`, `tugcode/`, `docs/`) for all `state update` references before removing. The roadmap audit already found zero external callers.
- **Residual risk:** A caller in a local script outside the repo would break, but this is acceptable since `state update` was never a stable public API.

---

### Design Decisions {#design-decisions}

#### [D01] Remove state update entirely (DECIDED) {#d01-remove-state-update}

**Decision:** Remove the `state update` subcommand entirely rather than keeping it as a batch-only wrapper.

**Rationale:**
- YAGNI: no production callers exist for batch-without-complete-remaining
- After stripping per-item flags, `state update --batch --complete-remaining` would be a strict subset of `complete-checklist`
- One command with clear intent is better than two commands with overlapping functionality

**Implications:**
- `StateCommands::Update` variant is deleted from `cli.rs` and `state.rs`
- `run_state_update` function is deleted from `commands/state.rs`
- All integration tests that invoke `state update` must be rewritten or deleted

#### [D02] Delete tests for removed code (DECIDED) {#d02-delete-removed-tests}

**Decision:** Delete all tests exercising per-item flags, batch-without-complete-remaining, and the `update_checklist` library method since that code is being deleted.

**Rationale:**
- Tests for removed code serve no purpose
- Tests for `state update --batch --complete-remaining` are replaced by new `complete-checklist` tests that test the same underlying `batch_update_checklist` library method
- Tugtool-core unit tests for `update_checklist` and `ChecklistUpdate` must be deleted alongside the code they test to avoid compilation failures

**Implications:**
- Integration tests to delete: per List L01
- Integration tests to rewrite: per List L02
- Tugtool-core unit tests to delete: per List L04
- Tests to keep as-is: `test_complete_remaining_*` tests are replaced by new `complete-checklist` tests

#### [D03] Use std::io::IsTerminal for TTY detection (DECIDED) {#d03-tty-detection}

**Decision:** Use `std::io::IsTerminal` from the Rust standard library for TTY detection instead of adding a new crate dependency.

**Rationale:**
- Stable since Rust 1.70; workspace already requires Rust 1.85
- No new dependency needed
- Standard, well-tested implementation

**Implications:**
- Import `std::io::IsTerminal` in `commands/state.rs`
- Check `std::io::stdin().is_terminal()` to decide whether to read stdin
- If TTY (no pipe): treat as empty deferrals array, auto-complete all open items
- If not TTY (piped): read stdin as JSON deferral array; if read returns empty/EOF, treat as empty deferrals (same as TTY path)

#### [D04] Reuse StateUpdateData for JSON output (DECIDED) {#d04-reuse-output-struct}

**Decision:** Reuse the existing `StateUpdateData` struct for the `complete-checklist` JSON output, changing only the operation name in the `JsonResponse` wrapper.

**Rationale:**
- The output shape is identical: `plan_path`, `anchor`, `items_updated`
- No new struct needed; reduces code churn
- Consumers (implement skill) parse the same fields

**Implications:**
- `StateUpdateData` struct in `output.rs` is kept (just renamed for clarity if desired, but the fields stay the same)
- JSON output uses `"state complete-checklist"` as the operation name instead of `"state update"`

#### [D05] Treat EOF on non-TTY stdin as empty deferrals (DECIDED) {#d05-eof-empty-deferrals}

**Decision:** When stdin is not a TTY but reads as empty or EOF, treat it as an empty deferrals array rather than erroring.

**Rationale:**
- `Stdio::null()` (which opens `/dev/null`) is not a terminal, so `is_terminal()` returns false. If the handler tried to parse JSON from `/dev/null`, it would get an empty read and fail. Treating EOF/empty as "no deferrals" makes the behavior consistent: no pipe, empty pipe, and `/dev/null` all mean "mark everything completed."
- This makes integration testing straightforward: tests can use `.stdin(Stdio::null())` for the happy path without needing to pipe `echo '[]'`
- The only error case is when non-empty data is piped that is not valid JSON

**Implications:**
- In `run_state_complete_checklist`: if not TTY, read stdin to string first. If empty, use empty vec. If non-empty, parse as JSON. If parse fails, return error.
- Integration tests use `.stdin(Stdio::null())` for the "no deferrals" path

---

### Specification {#specification}

#### CLI Interface {#cli-interface}

**Spec S01: complete-checklist subcommand** {#s01-complete-checklist-cli}

```
tugcode state complete-checklist <PLAN> <STEP> --worktree <PATH> [--allow-drift]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `PLAN` | yes | Plan file path (resolved via plan resolution cascade) |
| `STEP` | yes | Step anchor (e.g., `step-1`) |
| `--worktree PATH` | yes | Worktree path (ownership check) |
| `--allow-drift` | no | Allow operation even if plan file has drifted |

**Stdin behavior (TTY detection with EOF tolerance):**

| Stdin state | Behavior |
|-------------|----------|
| TTY (interactive, no pipe) | No deferrals; mark all open items completed |
| Not TTY, empty/EOF | No deferrals; mark all open items completed (same as TTY) |
| Not TTY, non-empty valid JSON | Parse as deferral array; apply deferrals, then complete remaining |
| Not TTY, non-empty invalid JSON | Return error |

**Deferral entry JSON schema:**
```json
[{"kind": "checkpoint", "ordinal": 0, "status": "deferred", "reason": "Flaky in CI"}]
```

**Exit codes:**
- 0: success
- non-zero: error (drift, ownership, invalid JSON, etc.)

**JSON output (with `--json`):**
```json
{
  "status": "ok",
  "operation": "state complete-checklist",
  "data": {
    "plan_path": ".tugtool/tugplan-foo.md",
    "anchor": "step-1",
    "items_updated": 5
  }
}
```

#### Symbols Removed {#symbols-removed}

**Table T01: Symbols to remove** {#t01-symbols-removed}

| Symbol | Kind | Location | Reason |
|--------|------|----------|--------|
| `ChecklistUpdate` | enum | `tugtool-core/src/state.rs` | Dead -- only used by per-item flags |
| `update_checklist` | method on `StateDb` | `tugtool-core/src/state.rs` | Dead -- only used by per-item flag path |
| `ChecklistUpdate` re-export | use | `tugtool-core/src/lib.rs` | Re-export of deleted enum |
| `StateCommands::Update` | enum variant | `tugcode/src/commands/state.rs` | Entire subcommand removed |
| `run_state_update` | function | `tugcode/src/commands/state.rs` | Handler for removed subcommand |
| `run_state_update` re-export | use | `tugcode/src/commands/mod.rs` | Re-export of deleted function |
| `StateCommands::Update` dispatch | match arm | `tugcode/src/main.rs` | Dispatch for removed subcommand |

#### Symbols Added {#symbols-added}

**Table T02: Symbols to add** {#t02-symbols-added}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `StateCommands::CompleteChecklist` | enum variant | `tugcode/src/commands/state.rs` | New subcommand variant with `plan`, `step`, `worktree`, `allow_drift` fields |
| `run_state_complete_checklist` | function | `tugcode/src/commands/state.rs` | Handler: TTY detection, optional stdin read with EOF tolerance, calls `batch_update_checklist` |

---

### Compatibility / Migration / Rollout {#rollout}

- **Compatibility policy:** This is a breaking CLI change for `state update`, but there are zero external consumers. The only callers are the implement skill orchestrator (updated in this plan) and integration tests (rewritten/deleted).
- **Migration plan:**
  - The implement skill `SKILL.md` is updated to use `complete-checklist` in the same commit that adds the command
  - All 12 "state update" command references and 17 "complete-remaining" references in SKILL.md are replaced
  - No external migration needed
- **Rollout:** Ship as a single version bump. No feature gate or staged rollout needed.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test library methods in isolation | tugtool-core `batch_update_checklist` (kept) |
| **Integration** | Test the new CLI command end-to-end via `Command::new(tug_binary())` | All `complete-checklist` scenarios |
| **Drift Prevention** | Verify `state update` is no longer recognized by clap | Regression test for removal |

**List L01: Integration tests to delete** {#l01-tests-to-delete}

- `test_batch_update_success` -- tests batch path that is now `complete-checklist`
- `test_batch_update_invalid_kind` -- tests batch validation (covered by new tests)
- `test_batch_update_out_of_range_ordinal` -- tests batch validation (covered by new tests)
- `test_batch_update_duplicate_entries` -- tests batch validation (covered by new tests)
- `test_batch_update_open_status_rejected` -- tests batch validation (covered by new tests)
- `test_batch_update_idempotent` -- tests batch idempotency (covered by new tests)
- `test_batch_update_deferred_requires_reason` -- tests batch validation (covered by new tests)
- `test_batch_update_conflict_with_individual_flags` -- tests removed flag conflicts
- `test_per_item_deferred_requires_reason` -- tests removed per-item path
- `test_per_item_open_requires_allow_reopen` -- tests removed per-item path
- `test_complete_remaining_empty_array_marks_all_open_completed` -- replaced by new test
- `test_complete_remaining_deferred_items_preserved` -- replaced by new test
- `test_complete_remaining_deferred_only_batch_orchestrator_path` -- replaced by new test
- `test_empty_array_without_complete_remaining_still_errors` -- tests removed error path
- `test_complete_remaining_without_batch_rejected_by_clap` -- tests removed clap constraint
- `test_complete_remaining_with_no_open_items_is_idempotent` -- replaced by new test
- `test_complete_remaining_respects_ownership_check` -- replaced by new test

**List L02: Integration tests to rewrite** {#l02-tests-to-rewrite}

- `test_state_update_artifact_complete_lifecycle` -- currently uses `--task 1:completed`; rewrite to use `complete-checklist` with `.stdin(Stdio::null())` for the checklist update portion
- `test_plan_hash_drift_blocks_update` -- rewrite to test drift blocking on `complete-checklist`
- `test_plan_hash_drift_allow_drift_override` -- rewrite to test `--allow-drift` on `complete-checklist`

**List L03: New integration tests** {#l03-new-tests}

- `test_complete_checklist_happy_path` -- use `.stdin(Stdio::null())`, verify all items completed via `state show --checklist`
- `test_complete_checklist_with_deferrals` -- pipe deferral JSON via stdin, verify deferred items have status `deferred` and non-deferred items are `completed`
- `test_complete_checklist_idempotent` -- run `complete-checklist` twice, second invocation succeeds with 0 items updated
- `test_complete_checklist_drift_blocks` -- verify drift check without `--allow-drift`
- `test_complete_checklist_drift_allow_override` -- verify `--allow-drift` bypasses drift check
- `test_complete_checklist_ownership_enforcement` -- wrong worktree rejected
- `test_complete_checklist_invalid_deferral_json` -- pipe malformed JSON, verify error
- `test_state_update_subcommand_rejected` -- verify `state update` is no longer recognized

**List L04: Tugtool-core unit tests to delete** {#l04-core-tests-to-delete}

These tests are in `tugcode/crates/tugtool-core/src/state.rs` and directly reference `ChecklistUpdate` or call `update_checklist`:

- `test_update_checklist_individual` (line ~3257) -- calls `db.update_checklist` with `ChecklistUpdate::Individual`
- `test_update_checklist_bulk_by_kind` (line ~3286) -- calls `db.update_checklist` with `ChecklistUpdate::BulkByKind`
- `test_update_checklist_all_items` (line ~3304) -- calls `db.update_checklist` with `ChecklistUpdate::AllItems`
- `test_update_checklist_ownership_enforced` (line ~3321) -- calls `db.update_checklist` with `ChecklistUpdate::AllItems`
- `test_update_checklist_with_hash_prefix` (line ~4682) -- calls `db.update_checklist` with `ChecklistUpdate::Individual`

Additionally, `test_complete_step_with_hash_prefix` (line ~4579) uses `db.update_checklist` with `ChecklistUpdate::AllItems` as setup to mark items complete before calling `complete_step`. This test must be rewritten to use `db.batch_update_checklist` instead.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add complete-checklist subcommand and handler {#step-1}

**Commit:** `feat: add state complete-checklist subcommand`

**References:** [D01] Remove state update entirely, [D03] Use std::io::IsTerminal for TTY detection, [D04] Reuse StateUpdateData for JSON output, [D05] Treat EOF on non-TTY stdin as empty deferrals, Spec S01, Table T02, (#cli-interface, #symbols-added, #strategy)

**Artifacts:**
- New `CompleteChecklist` variant in `StateCommands` enum in `tugcode/crates/tugcode/src/commands/state.rs`
- New `run_state_complete_checklist` function in `tugcode/crates/tugcode/src/commands/state.rs`
- New re-export in `tugcode/crates/tugcode/src/commands/mod.rs`
- New dispatch arm in `tugcode/crates/tugcode/src/main.rs`

**Tasks:**
- [ ] Add `CompleteChecklist` variant to `StateCommands` enum with fields: `plan: String`, `step: String`, `worktree: String` (with `--worktree` long arg), `allow_drift: bool` (with `--allow-drift` long arg)
- [ ] Implement `run_state_complete_checklist` function with this logic: resolve repo root, resolve plan path, open state.db, check drift (fail unless `--allow-drift`), detect TTY with `std::io::IsTerminal`. If TTY: use empty vec. If not TTY: read stdin to string; if empty/EOF use empty vec; if non-empty parse as `Vec<BatchUpdateEntry>` (error on invalid JSON). Call `db.batch_update_checklist(...)` with `complete_remaining: true`. Output JSON or text using `StateUpdateData` with operation name `"state complete-checklist"`.
- [ ] Add `run_state_complete_checklist` to the re-export list in `commands/mod.rs`
- [ ] Add `StateCommands::CompleteChecklist` match arm in `main.rs` that dispatches to `run_state_complete_checklist`
- [ ] Verify the existing `BatchUpdateEntry` struct and its `BatchEntry` impl in `commands/state.rs` are reused (no changes needed)

**Tests:**
- [ ] `cargo nextest run` passes (new command compiles alongside existing `state update`)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | grep -c warning` returns 0
- [ ] `cd tugcode && cargo nextest run` passes (no test changes yet, all existing tests still pass)
- [ ] `cd tugcode && cargo run -- state complete-checklist --help` shows the expected arguments

---

#### Step 2: Remove state update subcommand, dead library code, and their tests {#step-2}

**Depends on:** #step-1

**Commit:** `refactor: remove state update subcommand and dead per-item code`

**References:** [D01] Remove state update entirely, [D02] Delete tests for removed code, Table T01, List L04, (#symbols-removed, #scope, #l04-core-tests-to-delete)

**Artifacts:**
- `StateCommands::Update` variant removed from `tugcode/crates/tugcode/src/commands/state.rs`
- `run_state_update` function removed from `tugcode/crates/tugcode/src/commands/state.rs`
- `run_state_update` re-export removed from `tugcode/crates/tugcode/src/commands/mod.rs`
- `StateCommands::Update` dispatch arm removed from `tugcode/crates/tugcode/src/main.rs`
- `ChecklistUpdate` enum removed from `tugcode/crates/tugtool-core/src/state.rs`
- `update_checklist` method removed from `tugcode/crates/tugtool-core/src/state.rs`
- `ChecklistUpdate` removed from `tugcode/crates/tugtool-core/src/lib.rs` re-exports
- 5 unit tests deleted and 1 unit test rewritten in `tugcode/crates/tugtool-core/src/state.rs`

**Tasks:**
- [ ] Delete the `Update` variant from `StateCommands` enum in `commands/state.rs`
- [ ] Delete the entire `run_state_update` function from `commands/state.rs`
- [ ] Remove `run_state_update` from the re-export in `commands/mod.rs`
- [ ] Remove the `StateCommands::Update { .. }` match arm from `main.rs`
- [ ] Delete the `ChecklistUpdate` enum from `tugtool-core/src/state.rs` (lines ~1833-1844)
- [ ] Delete the `update_checklist` method from `StateDb` in `tugtool-core/src/state.rs` (lines ~787-833)
- [ ] Remove `ChecklistUpdate` from the `pub use state::{...}` line in `tugtool-core/src/lib.rs`
- [ ] Delete the 5 tugtool-core unit tests listed in List L04: `test_update_checklist_individual`, `test_update_checklist_bulk_by_kind`, `test_update_checklist_all_items`, `test_update_checklist_ownership_enforced`, `test_update_checklist_with_hash_prefix`
- [ ] Rewrite `test_complete_step_with_hash_prefix` (line ~4579): replace the `db.update_checklist(...)` call with `db.batch_update_checklist(...)` using a `BatchEntry`-implementing struct to mark all items completed before testing `complete_step`
- [ ] If `allow_reopen` was only used by the per-item path, verify it is no longer referenced and clean up any orphan validation code
- [ ] Verify no remaining references to `ChecklistUpdate`, `update_checklist`, or `run_state_update` in any Rust source (grep should return 0 matches)

**Tests:**
- [ ] `cargo build --tests` succeeds with zero warnings (no dead imports, no unused code, all test code compiles)

**Checkpoint:**
- [ ] `cd tugcode && cargo build --tests 2>&1 | grep -c warning` returns 0
- [ ] `cd tugcode && cargo nextest run` passes (tugtool-core unit tests compile and pass)
- [ ] `grep -r "ChecklistUpdate\|update_checklist\|run_state_update\|StateCommands::Update" tugcode/crates/ --include="*.rs" | wc -l` returns 0

---

#### Step 3: Rewrite and add integration tests {#step-3}

**Depends on:** #step-2

**Commit:** `test: replace state update tests with complete-checklist tests`

**References:** [D02] Delete tests for removed code, [D05] Treat EOF on non-TTY stdin as empty deferrals, List L01, List L02, List L03, (#test-plan-concepts, #test-categories)

**Artifacts:**
- Deleted tests from `tugcode/crates/tugcode/tests/state_integration_tests.rs` per List L01
- Rewritten tests per List L02
- New tests per List L03

**Tasks:**
- [ ] Delete all tests listed in List L01 from `state_integration_tests.rs`
- [ ] Rewrite `test_state_update_artifact_complete_lifecycle`: replace the `state update ... --task 1:completed` invocation with `state complete-checklist` using `.stdin(Stdio::null())`; keep the rest of the lifecycle (init, claim, start, artifact, complete) unchanged
- [ ] Rewrite `test_plan_hash_drift_blocks_update`: change to invoke `state complete-checklist` with `.stdin(Stdio::null())` and verify drift blocks it
- [ ] Rewrite `test_plan_hash_drift_allow_drift_override`: change to invoke `state complete-checklist --allow-drift` with `.stdin(Stdio::null())` and verify it succeeds
- [ ] Add `test_complete_checklist_happy_path`: init state, claim, start, run `complete-checklist` with `.stdin(Stdio::null())`, verify all items completed via `state show --checklist --json`
- [ ] Add `test_complete_checklist_with_deferrals`: pipe deferral JSON via `.stdin(Stdio::piped())` and write to child stdin, verify deferred items have status `deferred` and non-deferred items are `completed`
- [ ] Add `test_complete_checklist_idempotent`: run `complete-checklist` twice with `.stdin(Stdio::null())`, second invocation succeeds with 0 items updated
- [ ] Add `test_complete_checklist_ownership_enforcement`: invoke with wrong worktree and `.stdin(Stdio::null())`, verify error
- [ ] Add `test_complete_checklist_invalid_deferral_json`: pipe malformed JSON via stdin, verify error
- [ ] Add `test_state_update_subcommand_rejected`: run `tugcode state update ...` and verify clap returns a non-zero exit code with an error message

**Tests:**
- [ ] All new and rewritten tests pass via `cargo nextest run`

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with zero failures
- [ ] `cd tugcode && cargo nextest run 2>&1 | grep "test result"` shows all tests pass

---

#### Step 4: Update implement skill SKILL.md {#step-4}

**Depends on:** #step-1

**Commit:** `docs: update SKILL.md to use state complete-checklist`

**References:** [D01] Remove state update entirely, Spec S01, (#strategy, #rollout)

**Artifacts:**
- Updated `tugplug/skills/implement/SKILL.md` -- all `tugcode state update` command invocations replaced, all `--complete-remaining` references replaced

**Tasks:**

*Command invocations (replace `echo '[]' | tugcode state update ... --batch --complete-remaining` with `tugcode state complete-checklist ...` and `echo '<json>' | tugcode state update ... --batch --complete-remaining` with `echo '<json>' | tugcode state complete-checklist ...`):*

- [ ] Line ~196: manual recovery command in `state_update_failed` escalation block
- [ ] Line ~583: deferral path command (with deferred items piped)
- [ ] Line ~588: no-deferral path command (empty array piped -- replace with no-pipe invocation)
- [ ] Line ~693: manual recovery command in `"drift"` escalation message
- [ ] Line ~705: manual recovery command in `"db_error"` escalation message
- [ ] Line ~711: manual recovery command in `"open_items"` escalation message
- [ ] Line ~717: manual recovery command in `"catch-all"` escalation message
- [ ] Line ~991: Tugstate Protocol reference step 5 command
- [ ] Line ~1017: manual recovery command in error handling section

*Section headings and explanatory text (rewrite to describe `complete-checklist` behavior instead of `--batch --complete-remaining`):*

- [ ] Line ~185: update error label text from "state update failed" to "state complete-checklist failed" (note: this is display text, not the `state_update_failed` JSON field which is unchanged)
- [ ] Line ~193: update error label text from "state update failed -- escalating" to "state complete-checklist failed -- escalating"
- [ ] Line ~195: update "State: update failed" to "State: complete-checklist failed"
- [ ] Line ~577: update text "they will be auto-completed by `--complete-remaining`" to describe `complete-checklist` auto-completion
- [ ] Line ~579: update section heading "Send batch update with --complete-remaining" to "Send complete-checklist"
- [ ] Line ~591: rewrite the `--complete-remaining` explanation paragraph to describe `complete-checklist` behavior: no pipe = complete all; pipe deferrals = apply deferrals then complete remaining
- [ ] Line ~593: update the note about `--allow-drift` to reference `complete-checklist` instead of batch update
- [ ] Line ~991: rewrite the Tugstate Protocol step 5 description to describe `complete-checklist` with optional piped deferrals
- [ ] Lines ~994-1000: rewrite the "Simplified batch construction" section to describe `complete-checklist` stdin behavior (TTY = no deferrals; piped JSON = deferrals; piped empty = no deferrals)
- [ ] Line ~996: update "never for state updates" text -- keep the semantic point but remove `--complete-remaining` reference

*Error recovery text (update "State update failed" labels in AskUserQuestion strings):*

- [ ] Line ~693: update "State update failed due to plan drift" to "State complete-checklist failed due to plan drift"
- [ ] Line ~699: update "State update failed: step ownership mismatch" to "State complete-checklist failed: step ownership mismatch"
- [ ] Line ~705: update "State update failed: database error" to "State complete-checklist failed: database error"
- [ ] Line ~711: update "State update failed: open checklist items remain" to "State complete-checklist failed: open checklist items remain"
- [ ] Line ~717: update "State update failed for step" to "State complete-checklist failed for step"

- [ ] Verify no remaining `tugcode state update` command references in SKILL.md (grep returns 0 matches for the pattern `tugcode state update`)
- [ ] Verify no remaining `complete-remaining` references in SKILL.md (grep returns 0)

**Tests:**
- [ ] Verify the document is well-formed by reading through it for consistency

**Checkpoint:**
- [ ] `grep -c "tugcode state update" tugplug/skills/implement/SKILL.md` returns 0
- [ ] `grep -c "complete-remaining" tugplug/skills/implement/SKILL.md` returns 0
- [ ] `grep -c "complete-checklist" tugplug/skills/implement/SKILL.md` returns count >= 10
- [ ] `grep -c "state_update_failed" tugplug/skills/implement/SKILL.md` returns count > 0 (these references to the JSON field are intentionally kept)

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Remove state update entirely, [D02] Delete tests for removed code, [D03] Use std::io::IsTerminal for TTY detection, (#success-criteria)

**Tasks:**
- [ ] Verify all success criteria are met
- [ ] Verify no remaining references to `tugcode state update` commands, `ChecklistUpdate`, `update_checklist`, or `--complete-remaining` in the codebase (excluding git history and this plan)
- [ ] Run the full test suite one final time

**Tests:**
- [ ] `cargo nextest run` passes with zero failures and zero warnings (full suite)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with zero failures and zero warnings
- [ ] `cd tugcode && cargo fmt --all --check` passes (formatting clean)
- [ ] `grep -r "tugcode state update" tugplug/ tugcode/crates/ --include="*.rs" --include="*.md" | grep -v tugplan | grep -v CHANGELOG | wc -l` returns 0
- [ ] `grep -r "ChecklistUpdate\|update_checklist" tugcode/crates/ --include="*.rs" | wc -l` returns 0
- [ ] `grep -c "complete-remaining" tugplug/skills/implement/SKILL.md` returns 0

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A simplified `tugcode state complete-checklist` subcommand that replaces the fragile `state update --batch --complete-remaining` pattern, with all dead per-item code removed from the CLI and library.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugcode state complete-checklist <plan> <step> --worktree <path>` works end-to-end (integration test passes)
- [ ] `tugcode state update` is rejected by clap (regression test passes)
- [ ] `ChecklistUpdate` and `update_checklist` do not exist in Rust source (grep verification)
- [ ] All `SKILL.md` command references updated (zero `tugcode state update` and `complete-remaining` matches)
- [ ] `cargo nextest run` passes with zero failures and zero warnings
- [ ] `cargo fmt --all --check` passes

**Acceptance tests:**
- [ ] `test_complete_checklist_happy_path` passes
- [ ] `test_complete_checklist_with_deferrals` passes
- [ ] `test_state_update_subcommand_rejected` passes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Consider renaming `StateUpdateData` to `StateCompleteChecklistData` for clarity (cosmetic, low priority)
- [ ] Consider whether `state show` output should reference "complete-checklist" in its display text

| Checkpoint | Verification |
|------------|--------------|
| New command works | `cargo nextest run -E 'test(complete_checklist)'` |
| Old command rejected | `cargo nextest run -E 'test(state_update_subcommand_rejected)'` |
| Dead code removed | `grep -r "ChecklistUpdate" tugcode/crates/ --include="*.rs"` returns 0 |
| SKILL.md updated | `grep -c "tugcode state update" tugplug/skills/implement/SKILL.md` returns 0 |
| Full suite green | `cd tugcode && cargo nextest run` |
