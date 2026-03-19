## Phase 1.0: Robust Step Completion for tugstate {#phase-slug}

**Purpose:** Make `complete_step()` reliable in the `tugcode commit` path by resolving plan paths consistently, distinguishing "step not found" from generic DB errors, making already-completed steps idempotent, and adding diagnostic context to error messages.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-25 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

During a real implementation run, `tugcode state update --batch --complete-remaining` succeeded, but the subsequent `tugcode commit` call to `complete_step()` failed with E047 ("Query returned no rows"). The committer-agent reported `state_failure_reason=db_error` despite the git commit itself succeeding. The root cause is a combination of: (a) `commit.rs` not resolving the plan path through `resolve_plan()` like every other state command does, (b) `complete_step()` not distinguishing "step not found in DB" from other rusqlite errors, (c) no idempotency for already-completed steps, and (d) error messages lacking the plan_path and anchor needed for debugging.

#### Strategy {#strategy}

- Fix the plan path resolution gap in `commit.rs` first, since it is the most likely root cause of the observed failure.
- Add a dedicated `StateStepNotFound` error variant so "step not found" is distinguishable from generic DB errors at the type level.
- Make `complete_step()` idempotent for already-completed steps -- succeed silently regardless of calling worktree.
- Enrich error messages in `complete_step()` with plan_path and anchor so that mismatches are immediately visible.
- Keep changes focused and testable: each improvement has its own execution step and commit.

#### Stakeholders / Primary Customers {#stakeholders}

1. committer-agent (calls `tugcode commit` which internally calls `complete_step()`)
2. Developers debugging state failures in implementation logs

#### Success Criteria (Measurable) {#success-criteria}

- `tugcode commit` resolves plan paths identically to `tugcode state` commands (verified by code review and existing integration tests)
- Calling `complete_step()` on an already-completed step returns success with `completed: true, forced: false` (verified by new unit test)
- A nonexistent step anchor produces `TugError::StateStepNotFound` with error code E059 (verified by new unit test)
- Error messages from `complete_step()` include both plan_path and anchor (verified by asserting on error `.to_string()` output)

#### Scope {#scope}

1. Add `resolve_plan()` to `commit.rs` for both `complete_step()` and `check_commit_drift()` calls
2. New `TugError::StateStepNotFound` variant with error code E059
3. Idempotent early-return in `complete_step()` for already-completed steps
4. Diagnostic plan_path and anchor in `complete_step()` error messages

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the `tugcode commit` git workflow (stage, commit, rev-parse)
- Modifying `force` mode semantics
- Changing how `committer-agent` interprets `state_failure_reason` (that is a downstream concern)

#### Dependencies / Prerequisites {#dependencies}

- Existing `resolve_plan()` function in `tugtool-core` (already used by all state commands)
- Existing `find_repo_root_from()` function (already called in `commit.rs`)

#### Constraints {#constraints}

- All changes must compile with `-D warnings` (project policy)
- `cargo nextest run` must pass after each step
- No breaking changes to `complete_step()` return type (`CompleteResult`) or `CommitData` JSON schema

#### Assumptions {#assumptions}

- The observed E047 failure was caused by plan path mismatch (raw CLI argument vs. resolved relative path)
- The next available error code is E059 (E054-E058 are dash errors)
- `check_commit_drift()` in `commit.rs` also uses the raw `&plan` string for `show_plan()` and will be fixed as part of improvement 1
- Tests for idempotency will be added to `state.rs` unit tests following existing patterns

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Resolve plan path in commit.rs using existing resolve_plan + strip_prefix pattern (DECIDED) {#d01-resolve-plan-commit}

**Decision:** Add `resolve_plan()` to `commit.rs` to resolve the raw `--plan` CLI argument before passing it to `db.complete_step()` and `check_commit_drift()`, using the worktree-derived `repo_root` already computed via `find_repo_root_from(worktree_path)`.

**Rationale:**
- Every other state command (`init`, `show`, `update`, `claim`, etc.) resolves the plan path through `resolve_plan()` + `strip_prefix()` before calling StateDb methods.
- The raw CLI argument may be an absolute path, a bare filename, or a prefixed path -- all of which differ from the relative `.tugtool/tugplan-*.md` key stored in the DB.
- This mismatch is the most likely cause of the observed "Query returned no rows" failure.

**Implications:**
- `commit.rs` gains a dependency on `tugtool_core::resolve_plan` and `tugtool_core::ResolveResult`.
- Both `db.complete_step(&plan, ...)` and `check_commit_drift(&repo_root, &plan, &db)` must use the resolved relative path.
- The `add_or_replace_trailers()` call should continue to use the resolved path for consistency.

#### [D02] New TugError::StateStepNotFound variant with dedicated error code E059 (DECIDED) {#d02-step-not-found-variant}

**Decision:** Add a new `TugError::StateStepNotFound` variant with fields `{ plan_path: String, anchor: String }` and error code E059. Replace the generic `.map_err()` on the `is_substep` query in `complete_step()` with explicit handling for `rusqlite::Error::QueryReturnedNoRows`.

**Rationale:**
- The current code wraps all rusqlite errors from the `is_substep` query into `TugError::StateDbQuery`, which maps to `StateFailureReason::DbError` in the committer. This obscures the actual problem.
- `QueryReturnedNoRows` specifically means "the step anchor does not exist for this plan" -- a distinct semantic that callers need to handle differently from a SQL failure.
- A dedicated variant allows `classify_state_error()` in `commit.rs` to map it to a new or existing `StateFailureReason` variant.

**Implications:**
- `error.rs`: new variant, new `code()` arm returning `"E059"`, new `exit_code()` arm returning `14` (consistent with other state errors).
- `state.rs`: the `is_substep` query uses `match` on `rusqlite::Error` instead of `.map_err()`.
- `commit.rs`: `classify_state_error()` gains an arm for `StateStepNotFound` mapping to a suitable `StateFailureReason`.

#### [D03] Full idempotency for already-completed steps (DECIDED) {#d03-idempotent-completion}

**Decision:** Before the main `complete_step()` logic, query the step's current status. If the step is already completed, return `CompleteResult { completed: true, forced: false, all_steps_completed: <check remaining> }` immediately. This succeeds silently regardless of whether the calling worktree matches `claimed_by`.

**Rationale:**
- Once a step is completed, ownership is no longer relevant -- the work is done.
- The `tugcode commit` flow can encounter this when `state update --batch --complete-remaining` has already completed the step before `commit` runs.
- Failing on an already-completed step provides no value and causes spurious `state_failure_reason=db_error` in the committer output.

**Implications:**
- The idempotent check is a single query before the existing logic.
- `all_steps_completed` must be computed correctly even in the early-return path.
- No change to `CompleteResult` struct.

#### [D04] Enrich complete_step error messages with plan_path and anchor (DECIDED) {#d04-diagnostic-context}

**Decision:** Add `plan_path` and `anchor` to the `reason` field of `TugError::StateDbQuery` variants produced inside `complete_step()`, so that error messages include the plan and step being operated on.

**Rationale:**
- When `complete_step()` fails, the error message currently says things like "failed to query step: <rusqlite error>" with no indication of which plan or step was involved.
- Including plan_path and anchor makes mismatches immediately visible when debugging from implementation logs.

**Implications:**
- All `.map_err()` closures inside `complete_step()` interpolate `plan_path` and `anchor` into the reason string.
- The `StateStepNotClaimed` error at line 1165 already includes `anchor` but should also note `plan_path` for completeness.
- No API changes; this is purely better error message content.

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Inputs and Outputs (Data Model) {#inputs-outputs}

**Inputs:**
- `commit.rs` `run_commit()`: `plan: String` (raw CLI argument), `worktree: String`, `step: String`
- `state.rs` `complete_step()`: `plan_path: &str`, `anchor: &str`, `worktree: &str`, `force: bool`, `force_reason: Option<&str>`

**Outputs:**
- `CompleteResult { completed: bool, forced: bool, all_steps_completed: bool }` -- unchanged
- `TugError` variants on failure

**Key invariants:**
- `plan_path` passed to `complete_step()` must be a repo-relative path matching the key stored in the DB `plans` table
- Calling `complete_step()` on an already-completed step returns success (idempotent)
- Calling `complete_step()` on a nonexistent step returns `TugError::StateStepNotFound`

#### 1.0.1.2 Error and Warning Model {#errors-warnings}

**Spec S01: StateStepNotFound Error** {#s01-step-not-found-error}

- **Variant:** `TugError::StateStepNotFound`
- **Fields:** `plan_path: String`, `anchor: String`
- **Error code:** E059
- **Exit code:** 14
- **Display:** `"E059: Step {anchor} not found for plan {plan_path}"`
- **Produced by:** `complete_step()` when `is_substep` query returns `QueryReturnedNoRows`
- **Classified as:** `StateFailureReason::DbError` in `classify_state_error()` (the step genuinely does not exist in the DB)

**Table T01: Updated classify_state_error Mapping** {#t01-classify-mapping}

| TugError variant | StateFailureReason |
|-----------------|-------------------|
| `StateIncompleteChecklist` | `OpenItems` |
| `StateIncompleteSubsteps` | `OpenItems` |
| `StatePlanHashMismatch` | `Drift` |
| `StateOwnershipViolation` | `Ownership` |
| `StateStepNotClaimed` | `Ownership` |
| `StateStepNotFound` | `DbError` |
| All others | `DbError` |

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `StateStepNotFound` | enum variant | `tugtool-core/src/error.rs` | New variant with `plan_path: String, anchor: String` |
| `TugError::code()` | match arm | `tugtool-core/src/error.rs` | Returns `"E059"` for `StateStepNotFound` |
| `TugError::exit_code()` | match arm | `tugtool-core/src/error.rs` | Returns `14` for `StateStepNotFound` |
| `complete_step()` | fn (modified) | `tugtool-core/src/state.rs` | Idempotent early-return, `QueryReturnedNoRows` handling, enriched error messages |
| `run_commit()` | fn (modified) | `tugcode/src/commands/commit.rs` | Add `resolve_plan()` call, use resolved path |
| `check_commit_drift()` | fn (modified) | `tugcode/src/commands/commit.rs` | Use resolved plan path |
| `classify_state_error()` | fn (modified) | `tugcode/src/commands/commit.rs` | Add `StateStepNotFound` arm |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `complete_step()` idempotency, `StateStepNotFound` error, enriched messages | Core logic in `state.rs` |
| **Unit** | Test `classify_state_error()` mapping for new variant | Error classification in `commit.rs` |
| **Integration** | Verify `tugcode commit` resolves plan paths like other state commands | End-to-end in `state_integration_tests.rs` |

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Add StateStepNotFound variant and handle QueryReturnedNoRows {#step-0}

**Commit:** `fix(state): add StateStepNotFound variant (E059) and handle QueryReturnedNoRows in complete_step`

**References:** [D02] New TugError::StateStepNotFound variant with dedicated error code E059, Spec S01, (#errors-warnings, #symbols)

**Artifacts:**
- `tugcode/crates/tugtool-core/src/error.rs` -- new `StateStepNotFound` variant, `code()`, `exit_code()` arms
- `tugcode/crates/tugtool-core/src/state.rs` -- replace `.map_err()` on `is_substep` query with match on `rusqlite::Error::QueryReturnedNoRows`

**Tasks:**
- [ ] Add `StateStepNotFound { plan_path: String, anchor: String }` variant to `TugError` enum in `error.rs`
- [ ] Add `#[error("E059: Step {anchor} not found for plan {plan_path}")]` display format
- [ ] Add `TugError::StateStepNotFound { .. } => "E059"` arm in `code()`
- [ ] Add `TugError::StateStepNotFound { .. } => 14` arm in `exit_code()`
- [ ] In `complete_step()`, replace the `.map_err()` on the `is_substep` query (lines 1076-1084) with a `match` block that maps `rusqlite::Error::QueryReturnedNoRows` to `TugError::StateStepNotFound { plan_path, anchor }` and all other errors to `TugError::StateDbQuery`

**Tests:**
- [ ] Unit test: `test_step_not_found_error_variant` -- construct `StateStepNotFound`, assert code is `"E059"`, exit_code is `14`, display contains plan_path and anchor
- [ ] Unit test: `test_complete_step_nonexistent_anchor` -- call `complete_step()` with a valid plan but nonexistent anchor, assert `TugError::StateStepNotFound` is returned

**Checkpoint:**
- [ ] `cd tugcode && cargo build` (no warnings)
- [ ] `cd tugcode && cargo nextest run`

**Rollback:**
- Revert commit; no schema changes involved.

**Commit after all checkpoints pass.**

---

#### Step 1: Make complete_step idempotent for already-completed steps {#step-1}

**Depends on:** #step-0

**Commit:** `fix(state): make complete_step idempotent for already-completed steps`

**References:** [D03] Full idempotency for already-completed steps, (#inputs-outputs)

**Artifacts:**
- `tugcode/crates/tugtool-core/src/state.rs` -- idempotent early-return before main logic

**Tasks:**
- [ ] After the `is_substep` query and before the strict/force branching, query the step's current status: `SELECT status FROM steps WHERE plan_path = ?1 AND anchor = ?2`
- [ ] If `status == "completed"`, compute `all_steps_completed` by checking remaining uncompleted top-level steps (same query used later in the function)
- [ ] Return `Ok(CompleteResult { completed: true, forced: false, all_steps_completed })` immediately
- [ ] This check runs regardless of `force` flag and regardless of `worktree` vs `claimed_by`

**Tests:**
- [ ] Unit test: `test_complete_step_idempotent_same_worktree` -- complete a step, call `complete_step()` again from the same worktree, assert success with `completed: true, forced: false`
- [ ] Unit test: `test_complete_step_idempotent_different_worktree` -- complete a step from worktree A, call `complete_step()` from worktree B, assert success with `completed: true, forced: false`
- [ ] Unit test: `test_complete_step_idempotent_all_steps_completed` -- complete all steps, call `complete_step()` on the last one again, assert `all_steps_completed: true`

**Checkpoint:**
- [ ] `cd tugcode && cargo build` (no warnings)
- [ ] `cd tugcode && cargo nextest run`

**Rollback:**
- Revert commit.

**Commit after all checkpoints pass.**

---

#### Step 2: Add diagnostic context to complete_step error messages {#step-2}

**Depends on:** #step-1

**Commit:** `fix(state): include plan_path and anchor in complete_step error messages`

**References:** [D04] Enrich complete_step error messages with plan_path and anchor, (#specification)

**Artifacts:**
- `tugcode/crates/tugtool-core/src/state.rs` -- updated `reason` strings in all `.map_err()` closures inside `complete_step()`

**Tasks:**
- [ ] Update every `.map_err()` closure inside `complete_step()` to include `plan_path` and `anchor` in the reason string, e.g. `format!("failed to begin transaction for plan={} anchor={}: {}", plan_path, anchor, e)`
- [ ] Update the `StateStepNotClaimed` error at the `rows_affected == 0` check to include `plan_path` in the `current_status` message for debugging clarity
- [ ] Verify the `StateIncompleteChecklist` and `StateIncompleteSubsteps` errors already include `anchor` (they do); no change needed for those

**Tests:**
- [ ] Unit test: `test_complete_step_error_includes_plan_path` -- trigger a `StateStepNotClaimed` error, assert the error string contains the plan_path

**Checkpoint:**
- [ ] `cd tugcode && cargo build` (no warnings)
- [ ] `cd tugcode && cargo nextest run`

**Rollback:**
- Revert commit.

**Commit after all checkpoints pass.**

---

#### Step 3: Resolve plan path in commit.rs {#step-3}

**Depends on:** #step-2

**Commit:** `fix(commit): resolve plan path before calling complete_step and check_commit_drift`

**References:** [D01] Resolve plan path in commit.rs using existing resolve_plan + strip_prefix pattern, Table T01, (#d01-resolve-plan-commit, #symbols)

**Artifacts:**
- `tugcode/crates/tugcode/src/commands/commit.rs` -- add `resolve_plan()` + `strip_prefix()` before state operations; update `classify_state_error()` for `StateStepNotFound`

**Tasks:**
- [ ] Add `use tugtool_core::{resolve_plan, ResolveResult}` to `commit.rs` imports
- [ ] After `find_repo_root_from(worktree_path)` succeeds and before `check_commit_drift()`, resolve the plan: call `resolve_plan(&plan, &repo_root)`, handle `Found`/`NotFound`/`Ambiguous`, and `strip_prefix(&repo_root)` to get a relative path
- [ ] Use the resolved relative path for both `check_commit_drift(&repo_root, &resolved_plan, &db)` and `db.complete_step(&resolved_plan, ...)`
- [ ] Add `tugtool_core::TugError::StateStepNotFound { .. } => StateFailureReason::DbError` arm to `classify_state_error()`
- [ ] Add unit test for the new `classify_state_error` arm

**Tests:**
- [ ] Unit test: `test_classify_state_error_step_not_found` -- construct `StateStepNotFound`, assert it maps to `StateFailureReason::DbError`

**Checkpoint:**
- [ ] `cd tugcode && cargo build` (no warnings)
- [ ] `cd tugcode && cargo nextest run`
- [ ] `cd tugcode && cargo fmt --all --check` (formatting check)

**Rollback:**
- Revert commit.

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** `complete_step()` reliably handles plan path resolution, step-not-found, already-completed steps, and includes diagnostic context in all error messages.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugcode commit` resolves plan paths through `resolve_plan()` before any state operations (code review verification)
- [ ] `StateStepNotFound` variant exists with error code E059 and exit code 14
- [ ] Calling `complete_step()` on an already-completed step returns `CompleteResult { completed: true, forced: false, ... }` regardless of calling worktree
- [ ] All error messages from `complete_step()` include plan_path and anchor
- [ ] `cd tugcode && cargo nextest run` passes with zero failures
- [ ] `cd tugcode && cargo fmt --all --check` passes

**Acceptance tests:**
- [ ] Unit test: `test_step_not_found_error_variant`
- [ ] Unit test: `test_complete_step_nonexistent_anchor`
- [ ] Unit test: `test_complete_step_idempotent_same_worktree`
- [ ] Unit test: `test_complete_step_idempotent_different_worktree`
- [ ] Unit test: `test_complete_step_idempotent_all_steps_completed`
- [ ] Unit test: `test_complete_step_error_includes_plan_path`
- [ ] Unit test: `test_classify_state_error_step_not_found`

| Checkpoint | Verification |
|------------|--------------|
| All unit tests pass | `cd tugcode && cargo nextest run` |
| No compiler warnings | `cd tugcode && cargo build` |
| Code formatted | `cd tugcode && cargo fmt --all --check` |

**Commit after all checkpoints pass.**
