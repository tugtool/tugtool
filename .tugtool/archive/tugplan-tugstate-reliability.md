<!-- tugplan v2 -->

## Tugstate Reliability Improvements {#tugstate-reliability}

**Purpose:** Eliminate the broken substep abstraction, fix incorrect progress reporting on resume, correct mismatched task counts, and add consistent `--worktree` handling to `state show` -- making the tugstate management system correct, reliable, and robust.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugstate-reliability |
| Last updated | 2026-02-28 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Four interconnected issues in the tugstate management system cause incorrect progress reporting, unnecessary recovery loops, and confusing error messages during plan implementation. The most serious is a design flaw: substeps are a broken abstraction that adds complexity to the parser, state machine, validator, and orchestrator while providing no benefit the orchestrator actually uses. After a reviewer approves a step with substeps, the committer fails with `StateIncompleteSubsteps` because nobody manages the substep lifecycle between claiming and completion, triggering a 6+ CLI call recovery loop per substep.

The remaining issues are independent but share the theme of state reporting inaccuracy: `worktree setup` always reports 0 completed steps on resume, `state show` rejects `--worktree` despite every other state command accepting it, and the progress message displays non-authoritative coder task counts that contradict the reviewer's verified counts.

#### Strategy {#strategy}

- **Phase 1 (P0):** Update skeleton and author-agent to prevent new plans from creating substeps. This stops the bleeding immediately with 2 file edits.
- **Phase 2 (P2):** Simplify the state machine and CLI by auto-migrating to schema v4, promoting substep rows to top-level steps, and removing all parent-child logic from 9 Rust files.
- **Phase 3 (P3):** Simplify the parser and types by removing the `Substep` struct, dot-in-number parsing, and 11 substep iteration loops from the validator.
- **Phase 4 (P4):** Clean up test fixtures, delete substep integration tests, simplify the implement skill recovery loop, and remove cosmetic substep references.
- **Issue 2 (P1):** Fix wrong completion count on resume by querying `ready_steps` from the state DB after `init_plan` in `worktree setup`.
- **Issue 3 (P5):** Drop per-item count from progress message; show "Reviewer approved. Committing step." instead.
- **Issue 1 (P6):** Add `--worktree` as optional ignored parameter to `state show` for CLI consistency.

#### Success Criteria (Measurable) {#success-criteria}

- No `StateIncompleteSubsteps` error exists in the codebase (`rg StateIncompleteSubsteps` returns zero matches)
- `tugcode validate` passes on all test fixture plans (no substep-related validation errors)
- `worktree setup --json` on a resumed plan reports correct `ready_steps` count (verified by integration test)
- `state show --worktree /path plan.md` succeeds instead of returning "unexpected argument"
- `cargo nextest run` passes with zero warnings in both `tugcode` and `tugtool-core` crates
- No `Substep` struct, `parent_anchor` column, or `query_substeps` function remains in the codebase after Phase 3

#### Scope {#scope}

1. Eliminate the substep abstraction from skeleton, author-agent, state machine, parser, types, validator, CLI, and tests
2. Fix `worktree setup` to populate `ready_steps` from state DB on resume
3. Drop non-authoritative task count from progress message in implement skill
4. Add `--worktree` optional parameter to `state show` CLI command
5. Auto-migrate state DB from schema v3 to v4 (promote substeps, drop `parent_anchor`)
6. Simplify implement skill recovery loop (remove `open_items` retry loop)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Converting existing archived plans from substep format to flat format (all archived, parser keeps backward compat during Phase 2)
- Changing the orchestrator's step-claiming logic (it already treats substeps as individual steps)
- Modifying the reviewer or coder agent behavior (only the progress message in the implement skill changes)
- Adding new state management features beyond fixing the four identified issues

#### Dependencies / Prerequisites {#dependencies}

- All existing plans using substeps are archived (confirmed by user: "All archived")
- The `db.ready_steps()` function already exists in `tugtool-core/src/state.rs`
- Schema migration infrastructure exists (v1-to-v3 migrations already implemented in `StateDb::open`)

#### Constraints {#constraints}

- Warnings are errors: `-D warnings` enforced via `tugcode/.cargo/config.toml`
- Tests must pass: `cargo nextest run` must succeed after every step
- Parser backward compatibility during Phase 2: must continue accepting `##### Step N.M` headings for any existing plans that might be loaded
- Schema migration must be automatic on `StateDb::open()`, following the existing v1-to-v3 migration pattern

#### Assumptions {#assumptions}

- No active (non-archived) plans use substeps, so the schema migration only affects historical state DB entries
- The `ready_steps` function in `state.rs` currently filters `parent_anchor IS NULL`; this filter will be naturally removed in Phase 2
- The conformance-agent reads the skeleton dynamically and will stop expecting `##### Step N.M` once the skeleton changes
- Agents improvise `--worktree` on `state show` by pattern-matching other state commands; adding it is more robust than training skills to avoid it

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in `tugplan-skeleton.md`. All headings use explicit anchors in kebab-case. Steps use the `step-N` prefix pattern. Decisions use the `dNN-slug` prefix pattern. See the skeleton for full anchor naming rules.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Schema v4 migration corrupts state DB | high | low | Migration runs in a transaction; test with fixtures first | Migration fails on any real DB |
| Removing substep logic breaks non-substep paths | high | low | Every change is tested with `cargo nextest run` | Any test failure after removal |
| Parser backward compat gap during Phase 2 | medium | low | Keep `##### Step N.M` parsing until Phase 3 | Existing plan fails to parse |

**Risk R01: Schema migration data loss** {#r01-schema-migration}

- **Risk:** The v4 migration promotes substep rows and removes parent rows. If the migration logic is wrong, step state could be lost.
- **Mitigation:**
  - Migration runs inside a SQLite transaction (atomic rollback on error)
  - Integration test exercises migration with a fixture DB containing substep rows
  - All existing plans are archived, so lost state has minimal operational impact
- **Residual risk:** A corrupted `state.db` could require manual deletion and re-init, losing historical step completion timestamps.

**Risk R02: Removing parent-child logic breaks edge cases** {#r02-removal-edge-cases}

- **Risk:** Some query in `state.rs` implicitly depends on `parent_anchor IS NULL` filtering in a way we do not anticipate.
- **Mitigation:**
  - Systematic removal guided by the line-by-line inventory in `roadmap/tugstate-reliability.md`
  - Full test suite run after each removal
  - The roadmap enumerates every file and line number that touches `parent_anchor`
- **Residual risk:** An untested code path could surface a runtime error; the existing test suite may not cover all CLI combinations.

---

### Design Decisions {#design-decisions}

#### [D01] Eliminate substeps in favor of flat steps with explicit dependencies (DECIDED) {#d01-flat-steps}

**Decision:** Remove the parent-child substep model entirely. All steps are top-level `#### Step N:` headings with explicit `**Depends on:**` lines. Large work units use multiple flat steps plus an integration checkpoint step at the end.

**Rationale:**
- Substeps are structurally identical to steps (same fields, same pipeline treatment by orchestrator)
- The parent-child hierarchy causes `StateIncompleteSubsteps` failures because the orchestrator does not manage substep lifecycle
- Explicit dependencies are clearer and more flexible than implicit parent-child grouping
- Removes ~200 lines of parent-child logic from `state.rs` alone

**Implications:**
- Skeleton must replace `##### Step N.M` template with flat step + integration checkpoint pattern
- Author-agent must be instructed to generate only flat steps
- Parser keeps backward compat for `##### Step N.M` during Phase 2, removed in Phase 3
- Schema v4 migration promotes existing substep rows to top-level

#### [D02] Auto-migrate schema to v4 on StateDb::open (DECIDED) {#d02-auto-migrate-v4}

**Decision:** The schema v4 migration runs automatically when `StateDb::open()` detects schema version 3, following the same pattern as existing v1-to-v3 migrations.

**Rationale:**
- Consistent with existing migration infrastructure (no new migration CLI needed)
- Users do not need to run manual migration commands
- Migration is idempotent (v4 check prevents re-running)

**Implications:**
- Migration must promote substep rows (`parent_anchor IS NOT NULL`) to top-level (`parent_anchor = NULL`, renumber `step_index`)
- Pure container parent rows (no checklist items of their own) must be removed
- The `parent_anchor` column, self-referential FK, and partial indexes are dropped after data migration

#### [D03] Fix ready_steps by querying state DB in worktree setup (DECIDED) {#d03-ready-steps-fix}

**Decision:** After `init_plan` succeeds in `worktree setup`, query `db.ready_steps(plan_path)` to populate `ready_steps` in the `SetupData` output. This gives the orchestrator accurate completion counts on resume.

**Rationale:**
- The `ready_steps` function already exists in `state.rs`
- The state DB is already open at the point where `ready_steps` is set to `None` (line 583 of `worktree.rs`)
- A ~15 line change gives accurate progress reporting on resume

**Implications:**
- `SetupData.ready_steps` changes from always-`None` to a populated `Vec<String>` after successful init
- The orchestrator skill can compute correct `completed_count` from `all_steps.len() - ready_steps.len()`

#### [D04] Drop per-item count from progress message (DECIDED) {#d04-drop-task-count}

**Decision:** Replace the "Coder reported: N/M tasks completed" progress message with "Reviewer approved. Committing step." after reviewer APPROVE.

**Rationale:**
- The coder's `checklist_status` is explicitly labeled "non-authoritative progress telemetry"
- The `--complete-remaining` flag makes exact counting irrelevant (CLI handles it server-side)
- Displaying mismatched counts (coder says 9/9, reviewer says 10/10) erodes user trust
- The simpler message is unambiguous and always correct

**Implications:**
- Single edit in `tugplug/skills/implement/SKILL.md` progress message template (~line 571)

#### [D05] Add --worktree as optional ignored parameter to state show (DECIDED) {#d05-worktree-show}

**Decision:** Add `--worktree` as an optional argument to the `StateShow` CLI variant. The value is accepted but ignored (or used for CWD resolution). This makes `state show` consistent with all other state commands.

**Rationale:**
- Agents improvise `--worktree` by pattern-matching other state commands that all accept it
- Training agents to never use `--worktree` with `show` is fragile
- Making the CLI surface consistent prevents wasted tool calls and confusing errors

**Implications:**
- Add optional `--worktree` arg to the `Show` variant in `commands/state.rs` (where `StateCommands` is defined)
- Update the `StateCommands::Show` match arm in `main.rs` to destructure the new `worktree` field
- The handler ignores the value (or uses it for plan path resolution)

#### [D06] Integration checkpoint step pattern (DECIDED) {#d06-integration-checkpoint}

**Decision:** When breaking large work into multiple flat steps, add a lightweight integration checkpoint step at the end that depends on all constituent steps and verifies they work together.

**Rationale:**
- Preserves the value of aggregate verification from the old "Step N Summary" pattern
- Works within the flat step model (no parent-child hierarchy needed)
- Checkpoint steps have `Commit: N/A (verification only)` to signal no separate commit

**Implications:**
- Skeleton must document the integration checkpoint pattern as guidance
- Author-agent must be instructed to generate integration checkpoints for multi-step work units

---

### Specification {#specification}

#### Schema v4 Migration Logic {#schema-v4-migration}

**Spec S01: Schema v4 migration procedure** {#s01-v4-migration}

When `StateDb::open()` detects `schema_version = 3`:

1. Begin transaction
2. For each plan with substep rows (`parent_anchor IS NOT NULL`):
   a. Collect all substep rows ordered by `step_index`
   b. Set `parent_anchor = NULL` on all substep rows (promoting to top-level)
   c. Identify parent rows that have zero checklist items (pure containers): `SELECT anchor FROM steps WHERE plan_path = ? AND anchor NOT IN (SELECT step_anchor FROM checklist_items WHERE plan_path = ?) AND anchor IN (SELECT DISTINCT parent_anchor FROM steps WHERE plan_path = ? AND parent_anchor IS NOT NULL)`
   d. Delete pure container parent rows from `steps`, `step_deps`, and `step_artifacts`
   e. Renumber `step_index` sequentially for all remaining steps, preserving declaration order
3. Drop partial indexes `idx_steps_status` and `idx_steps_parent`
4. Create new table `steps_v4` without `parent_anchor` column and FK
5. Copy all data from `steps` to `steps_v4`
6. Drop `steps`, rename `steps_v4` to `steps`
7. Recreate remaining indexes on new `steps` table
8. Update `schema_version` to 4
9. Commit transaction

#### Worktree Setup ready_steps Population {#ready-steps-population}

**Spec S02: ready_steps after init_plan** {#s02-ready-steps}

The `ready_steps` variable is declared outside the state-init block expression (the `let ready_steps: Option<Vec<String>> = None;` line) and the `db` variable is created inside the block (the `StateDb::open(&db_path)` match). The `db` goes out of scope when the block ends. To query `ready_steps` from the DB, expand the block return type from `(bool, Vec<String>)` to `(bool, Vec<String>, Option<Vec<String>>)` where the third element carries the ready step anchors:

```rust
// Change the block expression to return ready_steps as a third element:
let (state_initialized, state_warnings, ready_steps) = {
    let db_path = repo_root.join(".tugtool").join("state.db");
    match tugtool_core::compute_plan_hash(&synced_plan_path) {
        Ok(plan_hash) => match tugtool_core::StateDb::open(&db_path) {
            Ok(mut db) => match db.init_plan(&plan, &synced_plan, &plan_hash) {
                Ok(_) => {
                    // Query ready steps while db is still in scope
                    let ready = match db.ready_steps(&plan) {
                        Ok(result) => Some(
                            result.ready.iter().map(|s| s.anchor.clone()).collect()
                        ),
                        Err(e) => {
                            if !quiet { eprintln!("warning: ready_steps query failed: {}", e); }
                            None
                        }
                    };
                    (true, vec![], ready)
                }
                Err(e) => { /* ... existing error handling ... */ (false, vec![msg], None) }
            },
            Err(e) => { /* ... */ (false, vec![msg], None) }
        },
        Err(e) => { /* ... */ (false, vec![msg], None) }
    }
};
// ready_steps is now populated; remove the old `let ready_steps: Option<Vec<String>> = None;`
```

The `ready_steps` function already exists in `state.rs` and returns steps that are `pending` with all dependencies `completed`. After Phase 2, it will no longer filter `parent_anchor IS NULL` since that column will not exist. On error, the query falls back to `None` (the old behavior) so setup never fails due to a ready_steps query issue.

#### CLI State Show --worktree {#show-worktree-spec}

**Spec S03: state show --worktree parameter** {#s03-show-worktree}

Add to the `Show` variant in `tugcode/crates/tugcode/src/commands/state.rs` (where `StateCommands` is defined):

```rust
Show {
    plan: Option<String>,
    #[arg(long, conflicts_with = "checklist")]
    summary: bool,
    #[arg(long, conflicts_with = "summary")]
    checklist: bool,
    /// Worktree path (accepted for CLI consistency, currently unused)
    #[arg(long, value_name = "PATH")]
    worktree: Option<String>,
},
```

The handler ignores the `worktree` value. This prevents `error: unexpected argument '--worktree' found` when agents pattern-match from other state commands.

#### Progress Message Simplification {#progress-message-spec}

**Spec S04: Simplified progress message after APPROVE** {#s04-progress-message}

Replace in `tugplug/skills/implement/SKILL.md` (~line 571):

**Before:**
```
Coder reported: {tasks_completed}/{tasks_total} tasks completed, {tests_completed}/{tests_total} tests completed
```

**After:**
```
Reviewer approved. Committing step.
```

Remove the paragraph that computes counts from `checklist_status.tasks` and `checklist_status.tests`. The `--complete-remaining` flag is the single source of truth.

#### Recovery Loop Simplification {#recovery-loop-spec}

**Spec S05: Simplified recovery loop after substep elimination** {#s05-recovery-loop}

Replace SKILL.md lines 688-762 recovery loop with a simplified escalation-only handler:

- Keep immediate escalation for `"drift"` and `"ownership"` cases (unchanged)
- Keep immediate escalation for `"db_error"` (no retry -- transient locks are rare enough that manual recovery is acceptable)
- Treat `"open_items"` as immediate escalation (this reason becomes unreachable after `StateIncompleteSubsteps` removal, but keep the case as a defensive fallback that escalates rather than silently dropping)
- For null/missing `state_failure_reason`: escalate immediately (catch-all for any unrecognized reason)
- Delete the entire retry loop (3 attempts, `query open items`, re-send batch, post-recovery verification) -- none of these cases retry

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files are created. This is a simplification/removal effort.

#### Symbols to remove {#symbols-to-remove}

| Symbol | Kind | Location | Phase |
|--------|------|----------|-------|
| `Substep` | struct | `tugtool-core/src/types.rs` | Phase 3 |
| `Substep` | re-export | `tugtool-core/src/lib.rs` | Phase 3 |
| `StateIncompleteSubsteps` | enum variant | `tugtool-core/src/error.rs` | Phase 2 |
| `SubstepStatus` | struct | `tugcode/src/output.rs` | Phase 2 |
| `query_substeps` | fn | `tugtool-core/src/state.rs` | Phase 2 |
| `parent_anchor` | column | `steps` table schema | Phase 2 |
| `idx_steps_parent` | index | `steps` table schema | Phase 2 |
| `substep_count` | field | `InitResult` struct, `StateInitData` struct | Phase 2 |

#### Symbols to modify {#symbols-to-modify}

| Symbol | Kind | Location | Change | Phase |
|--------|------|----------|--------|-------|
| `StepState` | struct | `tugtool-core/src/state.rs` | Remove `parent_anchor` and `substeps` fields | Phase 2 |
| `InitResult` | struct | `tugtool-core/src/state.rs` | Remove `substep_count` field | Phase 2 |
| `StepStatus` | struct | `tugcode/src/output.rs` | Remove `substeps: Vec<SubstepStatus>` field | Phase 2 |
| `StateInitData` | struct | `tugcode/src/output.rs` | Remove `substep_count` field | Phase 2 |
| `Step` | struct | `tugtool-core/src/types.rs` | Remove `substeps: Vec<Substep>` field | Phase 3 |
| `Show` (in `StateCommands`) | enum variant | `tugcode/crates/tugcode/src/commands/state.rs` | Add optional `--worktree` arg | Phase 2 |
| `SetupData` | struct usage | `tugcode/src/commands/worktree.rs` | Populate `ready_steps` from DB query | Phase 2 |

---

### Documentation Plan {#documentation-plan}

- [ ] Update skeleton in-plan (this is Phase 1 of the execution)
- [ ] Update author-agent instructions (Phase 1)
- [ ] Update implement skill recovery loop documentation (Phase 4)
- [ ] CLI help text for `state show --worktree` updated in code (Phase 2)

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual functions in isolation | Schema migration logic, ready_steps population, parser changes |
| **Integration** | Test components working together | State DB lifecycle without substeps, CLI commands with --worktree |
| **Golden / Contract** | Compare output against known-good snapshots | Validator output on flat-step plans |
| **Drift Prevention** | Detect unintended behavior changes | Existing non-substep tests must continue passing |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Update skeleton to remove substep pattern and add integration checkpoint {#step-1}

**Commit:** `docs(skeleton): replace substep pattern with flat steps and integration checkpoints`

**References:** [D01] Flat steps, [D06] Integration checkpoint, (#strategy, #context)

**Artifacts:**
- Updated `.tugtool/tugplan-skeleton.md` with flat step pattern and integration checkpoint guidance

**Tasks:**
- [ ] In `tugplan-skeleton.md`, remove the `step-N-M` anchor convention from anchor naming rules (the line documenting substep anchors like `{#step-2-1}`)
- [ ] Remove the implicit dependency rule for substeps ("Substeps implicitly depend on their parent step")
- [ ] Replace the "split into substeps" guidance in the execution steps intro with guidance on using multiple flat steps with explicit dependencies and an integration checkpoint
- [ ] Replace the `##### Step 3.1` / `##### Step 3.2` template block and `Step 3 Summary` block with a flat multi-step example using `#### Step N:` headings, explicit `**Depends on:**` lines, and an integration checkpoint step
- [ ] Add integration checkpoint step template showing `Commit: N/A (verification only)` pattern

**Tests:**
- [ ] `tugcode validate .tugtool/tugplan-skeleton.md` passes
- [ ] No `#####` step headings remain in the skeleton except as historical reference (if any)

**Checkpoint:**
- [ ] `tugcode validate .tugtool/tugplan-skeleton.md` exits 0
- [ ] The skeleton documents only flat `#### Step N:` headings with explicit dependencies

---

#### Step 2: Update author-agent to generate flat steps only {#step-2}

**Depends on:** #step-1

**Commit:** `docs(author-agent): instruct flat steps with explicit dependencies`

**References:** [D01] Flat steps, [D06] Integration checkpoint, (#strategy)

**Artifacts:**
- Updated `tugplug/agents/author-agent.md` with flat step generation instructions

**Tasks:**
- [ ] Add instruction to author-agent: do not generate `##### Step N.M` substep blocks; use flat `#### Step N:` headings with explicit `**Depends on:**` lines
- [ ] Add integration checkpoint step guidance: when breaking large work into multiple steps, add a checkpoint step at the end that depends on all constituent steps

**Tests:**
- [ ] Read author-agent.md and verify the new instructions are present and clear

**Checkpoint:**
- [ ] `tugplug/agents/author-agent.md` contains instruction against generating substep blocks
- [ ] `tugplug/agents/author-agent.md` contains integration checkpoint guidance

---

#### Step 3: Fix ready_steps population in worktree setup {#step-3}

**Depends on:** #step-1

**Commit:** `fix(worktree): populate ready_steps from state DB on resume`

**References:** [D03] Ready steps fix, Spec S02, (#ready-steps-population, #context)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/worktree.rs` to query `ready_steps` after `init_plan`

**Tasks:**
- [ ] In `worktree.rs`, expand the state-init block expression (lines 586-616) return type from `(bool, Vec<String>)` to `(bool, Vec<String>, Option<Vec<String>>)` where the third element carries `ready_steps`
- [ ] In the `Ok(_)` branch of `db.init_plan()`, call `db.ready_steps(&plan)` while `db` is still in scope; extract anchor strings from the `ready` field of the result
- [ ] Remove the old `let ready_steps: Option<Vec<String>> = None;` declaration since the block now returns it
- [ ] In all error branches of the block, return `None` as the third element (preserving old behavior on failure)
- [ ] Handle the `ready_steps` query error case: if the query fails, log a warning and return `None` (do not fail the entire setup)

**Tests:**
- [ ] Existing `cargo nextest run` tests pass (no regression)
- [ ] Manual verification: `tugcode worktree setup --json` on a resumed plan shows correct `ready_steps`

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `ready_steps` is no longer hardcoded to `None` in the success path of worktree setup

---

#### Step 4: Add schema v4 migration to StateDb::open {#step-4}

**Depends on:** #step-1

**Commit:** `feat(state): add schema v4 migration to promote substeps to top-level steps`

**References:** [D02] Auto-migrate v4, Spec S01, Risk R01, (#schema-v4-migration, #strategy)

**Artifacts:**
- Modified `tugtool-core/src/state.rs` with v4 migration logic in `StateDb::open()`
- New unit test for v4 migration

**Tasks:**
- [ ] In `StateDb::open()`, after existing migration checks, add a v3-to-v4 migration block that runs when `schema_version = 3`
- [ ] Implement the migration per Spec S01: promote substep rows (set `parent_anchor = NULL`), delete pure container parent rows, renumber `step_index`, recreate `steps` table without `parent_anchor` column, update schema version to 4
- [ ] Ensure migration runs inside a transaction for atomicity
- [ ] Update the schema DDL (the `CREATE TABLE IF NOT EXISTS steps` block) to remove `parent_anchor` column, the self-referential FK, and the `idx_steps_parent` index
- [ ] Update the initial schema version insert from 3 to 4 for new databases
- [ ] Update the `idx_steps_status` partial index to remove the `WHERE parent_anchor IS NULL` filter

**Tests:**
- [ ] Write unit test that creates a v3 schema DB with substep rows, opens it with `StateDb::open()`, and verifies: schema version is 4, substep rows are promoted, container parents are deleted, `step_index` is renumbered
- [ ] `cd tugcode && cargo nextest run` passes

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] New v4 migration test passes
- [ ] Schema DDL no longer contains `parent_anchor`

---

#### Step 5: Remove parent-child logic from state.rs core functions {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(state): remove substep parent-child logic from state machine`

**References:** [D01] Flat steps, [D02] Auto-migrate v4, (#strategy, #symbol-inventory)

**Artifacts:**
- Simplified `tugtool-core/src/state.rs`: removed `query_substeps`, substep cascade logic, `parent_anchor` predicates, and related struct fields

**Tasks:**
- [ ] In `init_plan`: delete the three inner `for substep in &step.substeps` loops (step INSERT, dep INSERT, checklist INSERT); remove `substep_count` variable; remove `parent_anchor` from INSERT column lists
- [ ] In `claim_step`: remove all `parent_anchor IS NULL` SQL predicates (use `rg "parent_anchor IS NULL"` within the function to find every instance); delete substep cascade UPDATE block; delete reclaim checklist reset subquery
- [ ] In `check_ownership`: replace `COALESCE((SELECT parent_anchor ...), ?4)` with plain parameter reference
- [ ] In `complete_step`: delete `is_substep` detection query; delete `StateIncompleteSubsteps` check; delete force-mode substep auto-complete; remove `parent_anchor IS NULL` from remaining-steps counts
- [ ] In `show_plan`: remove `parent_anchor IS NULL` filter; delete `query_substeps()` call; remove `parent_anchor` and `substeps` from `StepState` construction
- [ ] Delete entire `query_substeps` function
- [ ] In `ready_steps`: remove `parent_anchor IS NULL` predicate
- [ ] In `reset_step`: delete `is_substep` detection; delete substep cascade block
- [ ] In `release_step`: delete `is_substep` detection; delete substep cascade block
- [ ] Remove `parent_anchor: Option<String>` and `substeps: Vec<StepState>` from `StepState` struct
- [ ] Remove `substep_count: usize` from `InitResult` struct
- [ ] Update test schema copies (3 DDL literals in unit tests) to remove `parent_anchor TEXT`
- [ ] Delete unit tests: `test_reclaim_preserves_completed_substeps`, `test_show_includes_substeps`, `test_reset_cascades_to_substeps`, `test_release_cascades_to_substeps`

**Tests:**
- [ ] `cd tugcode && cargo nextest run` passes (all remaining tests work without substep logic)
- [ ] No `parent_anchor` references remain in `state.rs` (except migration code)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `rg parent_anchor tugcode/crates/tugtool-core/src/state.rs` returns only migration-related hits

---

#### Step 6: Remove substep artifacts from error.rs, output.rs, and CLI commands {#step-6}

**Depends on:** #step-5

**Commit:** `refactor(cli): remove substep types from error, output, and CLI commands`

**References:** [D01] Flat steps, [D05] Worktree show, Spec S03, (#symbols-to-remove, #symbols-to-modify, #show-worktree-spec)

**Artifacts:**
- Simplified `tugtool-core/src/error.rs`, `tugcode/src/output.rs`, `tugcode/src/commands/state.rs`, `tugcode/src/commands/status.rs`, `tugcode/src/commands/list.rs`, `tugcode/src/commands/commit.rs`, `tugcode/src/cli.rs`, `tugcode/src/main.rs`
- Updated golden test fixture `tugcode/tests/fixtures/golden/status_fallback.json`

**Tasks:**
- [ ] In `error.rs`: remove `StateIncompleteSubsteps` variant, its error code E052, and exit code 14
- [ ] In `output.rs`: delete `SubstepStatus` struct; remove `substeps: Vec<SubstepStatus>` from `StepStatus`; remove `substep_count` from `StateInitData`; update the `OpenItems` doc comment on `StateFailureReason` from "open checklist items or substeps remain" to "open checklist items remain"
- [ ] In `commands/state.rs`: remove `substep_count` output from init handler; delete substep display loops in `print_step_state` and `print_step_checklist`; update `--force` help text to not mention substeps
- [ ] In `commands/status.rs`: remove `SubstepStatus` import; delete substep collection logic; delete substep progress display loop
- [ ] In `commands/list.rs`: delete inner `for substep in &step.substeps` loop in `count_checkboxes()`
- [ ] In `commands/commit.rs`: remove `StateIncompleteSubsteps` match arm in `classify_state_error()`; delete unit test `test_classify_state_error_open_items_incomplete_substeps`
- [ ] In `cli.rs`: remove "Substep progress if present" from the `Status` command's `long_about` help text
- [ ] In `commands/state.rs`: add optional `--worktree` arg to the `Show` variant of `StateCommands` per Spec S03
- [ ] In `main.rs`: update the `StateCommands::Show` match arm to include `worktree: _` in the destructured fields (the new `--worktree` arg added in `commands/state.rs` must be handled in the match)
- [ ] In `tugcode/tests/fixtures/golden/status_fallback.json`: remove the `"substeps": []` field from step objects to match the updated `StepStatus` struct

**Tests:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `rg SubstepStatus tugcode/` returns zero matches
- [ ] `rg StateIncompleteSubsteps tugcode/` returns zero matches

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `rg -c "SubstepStatus\|StateIncompleteSubsteps\|substep_count" tugcode/crates/ tugcode/src/` returns zero matches

---

#### Step 7: Phase 2 Integration Checkpoint {#step-7}

**Depends on:** #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only -- no separate commit)`

**References:** [D01] Flat steps, [D02] Auto-migrate v4, [D03] Ready steps fix, [D05] Worktree show, (#success-criteria)

**Tasks:**
- [ ] Verify all Phase 2 artifacts are committed and tests pass

**Tests:**
- [ ] `cd tugcode && cargo nextest run` passes with zero warnings (aggregate verification)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with zero warnings
- [ ] `cd tugcode && cargo fmt --all --check` passes
- [ ] `rg "parent_anchor" tugcode/crates/tugtool-core/src/state.rs` returns only migration code hits
- [ ] `rg "SubstepStatus\|StateIncompleteSubsteps\|query_substeps" tugcode/` returns zero matches
- [ ] `tugcode validate .tugtool/tugplan-skeleton.md` passes

---

#### Step 8: Remove Substep struct and parsing from types and parser {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(parser): remove Substep struct and dot-in-number parsing`

**References:** [D01] Flat steps, (#symbols-to-remove, #strategy)

**Artifacts:**
- Simplified `tugtool-core/src/types.rs`, `tugtool-core/src/parser.rs`, `tugtool-core/src/lib.rs`

**Tasks:**
- [ ] In `types.rs`: delete `Substep` struct and its `impl` block; remove `substeps: Vec<Substep>` field from `Step`; delete inner substep loop in `TugPlan::completion_counts()`
- [ ] In `parser.rs`: remove `Substep` import; simplify `STEP_HEADER` regex to not match `\.\d+` (change from `\d+(?:\.\d+)?` to `\d+`); delete `in_substep` state variable; delete `if number.contains('.')` branch; remove all `if let Some(substep_idx) = in_substep` routing branches; delete `test_parse_substeps` test
- [ ] In `lib.rs`: remove `Substep` from public re-export

**Tests:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `rg "Substep" tugcode/crates/tugtool-core/src/` returns zero matches (struct, import, field all removed)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `rg "Substep" tugcode/crates/tugtool-core/src/` returns zero matches

---

#### Step 9: Remove substep iteration loops from validator {#step-9}

**Depends on:** #step-8

**Commit:** `refactor(validator): remove substep iteration from validator`

**References:** [D01] Flat steps, (#strategy)

**Artifacts:**
- Simplified `tugtool-core/src/validator.rs`

**Tasks:**
- [ ] Delete 10 `for substep in &step.substeps` loops across rules E004, E010, E011, W006, E005/W007, W009, W010, W011, W012, W013
- [ ] Delete the `.chain(s.substeps.iter()...)` expression in anchor collection (this is the 11th substep-related code removal in the validator, but it is a chain expression rather than a loop)
- [ ] Delete `test_w013_substep_references` test

**Tests:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `rg "substep" tugcode/crates/tugtool-core/src/validator.rs` returns zero matches (case-insensitive check: `rg -i substep`)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `rg -i "substep" tugcode/crates/tugtool-core/src/validator.rs` returns zero matches

---

#### Step 10: Phase 3 Integration Checkpoint {#step-10}

**Depends on:** #step-8, #step-9

**Commit:** `N/A (verification only -- no separate commit)`

**References:** [D01] Flat steps, (#success-criteria)

**Tasks:**
- [ ] Verify all Phase 3 artifacts are committed and the `Substep` type is fully removed

**Tests:**
- [ ] `cd tugcode && cargo nextest run` passes with zero warnings (aggregate verification)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with zero warnings
- [ ] `rg -i "substep" tugcode/crates/tugtool-core/src/` returns zero matches (excluding comments about migration)
- [ ] `cd tugcode && cargo fmt --all --check` passes

---

#### Step 11: Clean up test fixtures and integration tests {#step-11}

**Depends on:** #step-10

**Commit:** `test: remove substep test fixtures and integration tests`

**References:** [D01] Flat steps, (#strategy)

**Artifacts:**
- Deleted or replaced `tugcode/tests/fixtures/valid/with-substeps.md`
- Cleaned up `tugcode/crates/tugcode/tests/state_integration_tests.rs` and `tugcode/crates/tugtool-core/tests/integration_tests.rs`
- Updated `.tugtool/config.toml` (removed dead `substeps` key)

**Tasks:**
- [ ] Delete `tugcode/tests/fixtures/valid/with-substeps.md` (or replace with a flat-step equivalent if needed for test coverage)
- [ ] In `tugcode/crates/tugcode/tests/state_integration_tests.rs`: delete `PLAN_WITH_SUBSTEPS` constant; delete `test_substep_tracking` function
- [ ] In `tugcode/crates/tugtool-core/tests/integration_tests.rs`: delete or rewrite `test_valid_with_substeps_fixture`; remove `"with-substeps"` from `test_full_validation_workflow` fixture list
- [ ] Remove `substeps = "none"` config key and its comment from `.tugtool/config.toml` (no Rust code reads this key; it is a dead config entry)

**Tests:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] No test references substeps by name

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `rg -i "substep" tugcode/tests/` returns zero matches
- [ ] `with-substeps.md` fixture no longer exists

---

#### Step 12: Simplify implement skill recovery loop and update cosmetic references {#step-12}

**Depends on:** #step-11

**Commit:** `docs(skill): simplify recovery loop and remove substep references`

**References:** [D01] Flat steps, [D04] Drop task count, Spec S04, Spec S05, (#recovery-loop-spec, #progress-message-spec)

**Artifacts:**
- Updated `tugplug/skills/implement/SKILL.md` with simplified progress message and recovery loop
- Updated `tugrelaunch/src/main.rs` with corrected comment labels

**Tasks:**
- [ ] In `SKILL.md` (~line 571): replace the "Coder reported: N/M tasks completed" progress message with "Reviewer approved. Committing step." per Spec S04; remove the paragraph computing counts from `checklist_status`
- [ ] In `SKILL.md` (lines 688-762): replace the recovery loop per Spec S05: delete the entire retry loop; keep immediate escalation for `"drift"`, `"ownership"`, and `"db_error"`; change `"open_items"` from retry-loop entry to immediate escalation (this reason becomes unreachable after `StateIncompleteSubsteps` removal but is kept as a defensive fallback); for null/missing reason, escalate immediately
- [ ] In `tugrelaunch/src/main.rs`: update cosmetic comment labels "Substep 5.1/5.2/5.3" to remove substep terminology

**Tests:**
- [ ] Read `SKILL.md` and verify recovery loop no longer contains `open_items` retry logic
- [ ] Read `SKILL.md` and verify progress message is "Reviewer approved. Committing step."
- [ ] `cargo build` in `tugcode/` passes (tugrelaunch comment change is cosmetic only)

**Checkpoint:**
- [ ] `rg "open_items" tugplug/skills/implement/SKILL.md` returns zero matches in the recovery loop section
- [ ] `rg "Coder reported" tugplug/skills/implement/SKILL.md` returns zero matches
- [ ] `rg -i "substep" tugrelaunch/src/main.rs` returns zero matches in comments

---

#### Step 13: Final Integration Checkpoint {#step-13}

**Depends on:** #step-7, #step-10, #step-11, #step-12

**Commit:** `N/A (verification only -- no separate commit)`

**References:** [D01] Flat steps, [D02] Auto-migrate v4, [D03] Ready steps fix, [D04] Drop task count, [D05] Worktree show, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all four issues are resolved and all phases are complete

**Tests:**
- [ ] `cd tugcode && cargo nextest run` passes with zero warnings (final aggregate verification)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with zero warnings
- [ ] `cd tugcode && cargo fmt --all --check` passes
- [ ] `rg "StateIncompleteSubsteps" tugcode/` returns zero matches
- [ ] `rg "SubstepStatus" tugcode/` returns zero matches
- [ ] `rg "query_substeps" tugcode/` returns zero matches
- [ ] `tugcode validate .tugtool/tugplan-skeleton.md` passes
- [ ] `tugcode validate .tugtool/tugplan-tugstate-reliability.md` passes

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A tugstate management system with flat steps, correct progress reporting, consistent CLI surface, and simplified recovery logic -- all four reliability issues resolved.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] No `Substep` struct, `SubstepStatus` struct, `StateIncompleteSubsteps` variant, `parent_anchor` column (outside migration), `query_substeps` function, or substep iteration loops remain in the codebase
- [ ] `worktree setup --json` on a resumed plan reports correct `ready_steps` count
- [ ] `state show --worktree /path plan.md` succeeds (no "unexpected argument" error)
- [ ] Implement skill progress message says "Reviewer approved. Committing step." (no per-item count)
- [ ] Implement skill recovery loop has no `open_items` retry logic
- [ ] `cd tugcode && cargo nextest run` passes with zero warnings
- [ ] `cd tugcode && cargo fmt --all --check` passes

**Acceptance tests:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass
- [ ] `tugcode validate .tugtool/tugplan-skeleton.md` -- skeleton is valid
- [ ] `rg -c "Substep\b" tugcode/crates/tugtool-core/src/types.rs` returns 0
- [ ] `rg "parent_anchor" tugcode/crates/tugtool-core/src/state.rs` returns only migration hits

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add integration test for `worktree setup --json` ready_steps on resume (requires test harness for worktree commands)
- [ ] Remove parser backward compat for `##### Step N.M` if no plans use it after 30 days
- [ ] Consider adding `--worktree` to `state ready` for the same CLI consistency reason
- [ ] Audit remaining tugplug agents for substep terminology in prompts

| Checkpoint | Verification |
|------------|--------------|
| Schema v4 migration works | Unit test with v3 fixture DB |
| Substep types removed | `rg Substep tugcode/crates/` returns zero |
| ready_steps populated | `worktree setup --json` shows ready_steps |
| CLI consistent | `state show --worktree` succeeds |
| Recovery loop simplified | No `open_items` in SKILL.md recovery |
| All tests pass | `cargo nextest run` zero failures, zero warnings |
