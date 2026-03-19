## Phase 3.0: Interrupted Session Recovery {#phase-slug}

**Purpose:** Ship three incremental fixes so that interrupted implementation sessions recover automatically (same-worktree auto-reclaim), manually (state release command), or forcefully (--force on claim) — eliminating the current 2-hour wait when a session is interrupted.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-24 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

When an implementation session is interrupted (crash, user abort, network failure), the in-progress step retains its lease for the full 2-hour default duration. Re-running `/tugplug:implement` on the same plan hits `NoReadySteps` because `state claim` refuses to claim a step with an unexpired lease — even when the claiming worktree is the same one that already owns it. The worktree is reused automatically (idempotent `worktree create`), so the new session has the same worktree path. But the claim SQL query only checks lease expiry, not ownership identity.

The result is that users must wait up to 2 hours before retrying, or manually edit state.db. This phase implements three complementary fixes from the roadmap document `roadmap/interrupted-session-recovery.md`, each targeting a different recovery scenario with no overlap.

#### Strategy {#strategy}

- Follow the roadmap's prescribed implementation order: auto-reclaim, then release, then --force on claim
- Each fix is a single commit that compiles and passes tests independently
- Core logic changes go in `tugtool-core/src/state.rs`; CLI wiring goes in `tugcode/src/commands/state.rs`
- Reuse existing transaction patterns (from `reset_step()`) for the new `release_step()` function
- Reuse existing error variants (`StateOwnershipViolation`, `StateStepNotClaimed`) rather than inventing new ones
- Add tests to the existing `#[cfg(test)] mod tests` section in `state.rs`
- Maintain all existing dependency ordering constraints in claim logic

#### Stakeholders / Primary Customers {#stakeholders}

1. Implementer agents that call `tugcode state claim` during plan execution
2. Users who manually invoke `tugcode state release` or `tugcode state claim --force` for recovery

#### Success Criteria (Measurable) {#success-criteria}

- Claim a step, do not heartbeat, re-claim from the same worktree: succeeds immediately with `reclaimed: true` (auto-reclaim)
- Claim a step, release it, re-claim from a different worktree: succeeds (release command)
- Claim a step with active lease, force-claim from a different worktree: succeeds with `reclaimed: true` (--force flag)
- Release a completed step: returns an error
- Force-claim respects step dependency ordering (does not claim step-2 if step-1 is not completed)
- All existing tests continue to pass without modification
- `cargo nextest run` passes with zero warnings

#### Scope {#scope}

1. Same-worktree auto-reclaim in `claim_step()` SQL query
2. New `release_step()` core function and `state release` CLI command
3. `--force` flag on `claim_step()` and `state claim` CLI command

#### Non-goals (Explicitly out of scope) {#non-goals}

- Orchestrator changes to automatically retry with `--force` on `NoReadySteps`
- Automatic `state release` calls from error recovery in the implement skill
- Changes to lease duration defaults or heartbeat intervals
- Multi-plan coordination or cross-plan step dependencies

#### Dependencies / Prerequisites {#dependencies}

- Existing `tugcode state claim`, `state reset`, and related commands are working correctly
- `tugtool-core/src/state.rs` contains the `claim_step()` and `reset_step()` functions
- `tugcode/src/commands/state.rs` contains the CLI dispatch for state subcommands
- Roadmap document `roadmap/interrupted-session-recovery.md` defines the three fixes and their implementation order

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` in `.cargo/config.toml`)
- Must run `cargo fmt --all` after code changes
- All crate-relative paths in this plan (e.g. `tugtool-core/src/state.rs`) are relative to `tugcode/crates/`; the full repo-relative path is `tugcode/crates/tugtool-core/src/state.rs`. Similarly, `tugcode/src/commands/state.rs` means `tugcode/crates/tugcode/src/commands/state.rs`.
- All changes confined to: `state.rs` (core), `lib.rs` (re-exports), `commands/state.rs` (CLI), `output.rs` (JSON types), and `main.rs` (dispatch)

#### Assumptions {#assumptions}

- The `claim_step()` function signature will be extended with a `force: bool` parameter
- The same-worktree auto-reclaim will use the existing `reclaimed` flag logic without additional flag changes
- The `release_step()` function will follow similar transaction patterns as `reset_step()`
- All three fixes will maintain existing dependency ordering constraints
- Tests will be added to the existing `#[cfg(test)] mod tests` section in `state.rs`
- Error handling will use existing `TugError` variants (`StateOwnershipViolation`, `StateStepNotClaimed`, etc.)

---

### 3.0.0 Design Decisions {#design-decisions}

#### [D01] Same-worktree auto-reclaim by extending the claimability WHERE clause (DECIDED) {#d01-auto-reclaim-sql}

**Decision:** Add a third OR branch to the claimability query: `OR (s.status IN ('claimed', 'in_progress') AND s.claimed_by = ?3)`. This allows re-claiming a step when the requesting worktree matches `claimed_by`, regardless of lease expiry.

**Rationale:**
- The requesting worktree already owns the step, so there is no conflict
- The existing `reclaimed` flag in `ClaimResult` already signals this case downstream
- Refreshing `lease_expires_at` and `heartbeat_at` on auto-reclaim ensures the new session has a fresh lease window

**Implications:**
- The SQL query gains a third parameter (`?3`) for the worktree path
- `reclaimed` will be true when the step was previously claimed/in_progress (matching existing behavior)
- No change to `ClaimResult` enum or its fields
- Checklist reset on reclaim: the existing reclaim path only resets checklist items for substeps whose status is `'claimed'` (not the parent step's own items). This is the correct behavior for auto-reclaim because: (a) the parent step has no checklist items of its own in the current schema (checklist items belong to substeps), and (b) the substep filter `status = 'claimed'` correctly targets only the substeps that were just re-claimed, skipping any previously completed substeps. No change needed.

#### [D02] release_step() follows reset_step() transaction pattern (DECIDED) {#d02-release-pattern}

**Decision:** The new `release_step()` function will use the same transaction pattern as `reset_step()`: exclusive transaction, status check, cascade to substeps and checklist items.

**Rationale:**
- `reset_step()` already handles the exact state transitions needed (claimed/in_progress -> pending)
- The same cascade logic (substeps, checklist items) applies to release
- Using the same pattern reduces risk of subtle behavioral differences

**Implications:**
- `release_step()` will accept `plan_path`, `anchor`, `worktree` (optional), and `force` parameters
- When `worktree` is provided, ownership is verified before release
- When `force` is true, ownership check is skipped
- `--worktree` and `--force` are mutually exclusive at the CLI level
- Completed steps cannot be released (error returned)

#### [D03] Force claim bypasses lease expiry but respects dependency ordering (DECIDED) {#d03-force-claim}

**Decision:** When `force: true` is passed to `claim_step()`, the claimability query becomes `OR s.status IN ('claimed', 'in_progress')` without any lease check. Dependency ordering (`NOT EXISTS` subquery) is always enforced regardless of force flag.

**Rationale:**
- Force is for taking over from a different/gone worktree, not for breaking plan sequencing
- Dependency violations would leave the plan in an inconsistent state
- `reclaimed` is set to true when forcing takeover of a step claimed by a different worktree

**Implications:**
- `claim_step()` gains a `force: bool` parameter (added after `current_hash`)
- The CLI `state claim` command gains a `--force` flag
- Force-claiming sets `reclaimed = true` when the step was previously claimed/in_progress
- Existing callers pass `force: false` to maintain current behavior

#### [D04] Structured JSON output for release command (DECIDED) {#d04-release-json}

**Decision:** The `state release` command supports `--json` for structured output, using a `StateReleaseData` struct that follows the pattern of `StateResetData`.

**Rationale:**
- All other state commands support `--json` for agent consumption
- Consistency with existing `StateResetData` pattern simplifies implementation

**Implications:**
- New `StateReleaseData` struct in `output.rs` with fields: `plan_path`, `anchor`, `released`, `was_claimed_by`
- JSON response uses the standard `JsonResponse::ok("state release", data)` envelope

---

### 3.0.1 Specification {#specification}

#### 3.0.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs:**
- `claim_step()`: gains `force: bool` parameter
- `release_step()`: new function accepting `plan_path: &str`, `anchor: &str`, `worktree: Option<&str>`, `force: bool`
- CLI `state release`: `<plan> <step> --worktree <path>` OR `<plan> <step> --force`
- CLI `state claim`: gains `--force` flag

**Outputs:**
- `claim_step()`: unchanged `ClaimResult` enum
- `release_step()`: new `ReleaseResult` struct with `released: bool`, `was_claimed_by: Option<String>`
- CLI: JSON and text output formats

**Key invariants:**
- Dependency ordering is always enforced in claim, regardless of `--force`
- Completed steps cannot be released or force-claimed
- `--worktree` and `--force` are mutually exclusive on `state release`

#### 3.0.1.2 Terminology {#terminology}

- **Auto-reclaim**: When `claim_step()` silently re-claims a step because the requesting worktree matches `claimed_by`
- **Release**: Explicitly dropping a claim, returning a step to pending status
- **Force-claim**: Bypassing lease expiry checks to take over a step from any worktree

#### 3.0.1.3 Error Scenarios {#error-scenarios}

**Table T01: Error Scenarios** {#t01-error-scenarios}

| Scenario | Error | Code |
|----------|-------|------|
| Release a completed step | `StateStepNotClaimed` (current_status: "cannot release completed step") | E050 |
| Release with wrong worktree (no --force) | `StateOwnershipViolation` | E049 |
| Release a step that is not claimed | `StateStepNotClaimed` (current_status: "pending") | E050 |
| Force-claim with unmet dependencies | `NoReadySteps` (normal return, not error) | N/A |
| Both --worktree and --force on release | CLI argument conflict (clap handles) | exit 2 |

---

### 3.0.2 Symbol Inventory {#symbol-inventory}

#### 3.0.2.1 Symbols to add / modify {#symbols}

**Table T02: Symbol Changes** {#t02-symbol-changes}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `StateDb::release_step()` | fn | `tugtool-core/src/state.rs` | New function, follows `reset_step()` pattern |
| `ReleaseResult` | struct | `tugtool-core/src/state.rs` | New result type: `released: bool`, `was_claimed_by: Option<String>` |
| `StateDb::claim_step()` | fn (modify) | `tugtool-core/src/state.rs` | Add `force: bool` parameter |
| `StateCommands::Release` | enum variant | `tugcode/src/commands/state.rs` | New CLI subcommand |
| `run_state_release()` | fn | `tugcode/src/commands/state.rs` | New CLI handler |
| `run_state_claim()` | fn (modify) | `tugcode/src/commands/state.rs` | Pass `force` parameter |
| `StateReleaseData` | struct | `tugcode/src/output.rs` | New JSON output type |
| `StateCommands::Claim` | enum variant (modify) | `tugcode/src/commands/state.rs` | Add `--force` flag |

---

### 3.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `claim_step()` and `release_step()` in isolation with in-memory SQLite | Core logic, edge cases, error paths |
| **Integration** | Test CLI commands end-to-end | Command wiring, JSON output |

All tests go in the existing `#[cfg(test)] mod tests` block in `state.rs`.

---

### 3.0.4 Execution Steps {#execution-steps}

#### Step 0: Same-worktree auto-reclaim {#step-0}

**Commit:** `feat(state): add same-worktree auto-reclaim to claim_step()`

**References:** [D01] Same-worktree auto-reclaim by extending the claimability WHERE clause, Table T01, Table T02, (#context, #strategy, #inputs-outputs)

**Artifacts:**
- Modified `claim_step()` SQL query in `tugtool-core/src/state.rs`
- New unit tests for auto-reclaim behavior

**Tasks:**
- [ ] Modify the claimability SQL query in `claim_step()` to add a third OR branch: `OR (s.status IN ('claimed', 'in_progress') AND s.claimed_by = ?3)` where `?3` is the worktree parameter
- [ ] Update the `rusqlite::params!` call to pass `worktree` as the third parameter to the claimable query
- [ ] Ensure `lease_expires_at` and `heartbeat_at` are refreshed on auto-reclaim (already handled by the existing UPDATE statement)
- [ ] Verify that `reclaimed` is correctly set to `true` when auto-reclaiming (existing logic: `status != "pending"`)

**Tests:**
- [ ] Unit test: claim a step, then re-claim from the same worktree without waiting for lease expiry — should succeed with `reclaimed: true`
- [ ] Unit test: claim a step, then attempt to claim from a different worktree before lease expiry — should return `NoReadySteps` (not auto-reclaimable by different worktree)
- [ ] Unit test: auto-reclaim resets checklist items for non-completed substeps (existing reclaim behavior)

**Checkpoint:**
- [ ] `cd tugcode && cargo fmt --all`
- [ ] `cd tugcode && cargo nextest run` — all tests pass, zero warnings

**Rollback:**
- Revert the single SQL query change in `claim_step()`

**Commit after all checkpoints pass.**

---

#### Step 1: state release command {#step-1}

**Depends on:** #step-0

**Commit:** `feat(state): add state release command for explicit claim release`

**References:** [D02] release_step() follows reset_step() transaction pattern, [D04] Structured JSON output for release command, Table T01, Table T02, (#inputs-outputs, #error-scenarios, #terminology)

**Artifacts:**
- New `release_step()` function in `tugtool-core/src/state.rs`
- New `ReleaseResult` struct in `tugtool-core/src/state.rs`
- New `StateCommands::Release` variant in `tugcode/src/commands/state.rs`
- New `run_state_release()` function in `tugcode/src/commands/state.rs`
- New `StateReleaseData` struct in `tugcode/src/output.rs`
- Updated re-exports in `tugtool-core/src/lib.rs`
- Updated dispatch in `tugcode/src/main.rs`

**Tasks:**
- [ ] Add `ReleaseResult` struct to `state.rs`: `pub struct ReleaseResult { pub released: bool, pub was_claimed_by: Option<String> }`
- [ ] Implement `release_step(&mut self, plan_path: &str, anchor: &str, worktree: Option<&str>, force: bool) -> Result<ReleaseResult, TugError>` following `reset_step()` transaction pattern:
  - Begin exclusive transaction
  - Query step status and `claimed_by`
  - Reject if status is `completed` (return `StateStepNotClaimed` error)
  - Reject if status is `pending` (return `StateStepNotClaimed` error with "not claimed")
  - If `worktree` is provided and not `force`: verify `claimed_by` matches (return `StateOwnershipViolation` on mismatch)
  - Reset step to `pending`: clear `claimed_by`, `claimed_at`, `lease_expires_at`, `heartbeat_at`, `started_at`
  - Reset non-completed checklist items for the parent step itself to `open` (mirrors `reset_step()` which resets `checklist_items WHERE step_anchor = anchor AND status != 'completed'`)
  - Cascade to non-completed substeps: reset to `pending`, clear claim fields
  - Reset non-completed checklist items for those substeps to `open` (mirrors `reset_step()` cascade)
  - Commit transaction
  - Return `ReleaseResult { released: true, was_claimed_by }`
- [ ] Add `ReleaseResult` to the `pub use state::{ ... }` re-export in `lib.rs`
- [ ] Add `StateCommands::Release` variant to the `StateCommands` enum in `commands/state.rs`:
  - `plan: String` — plan file path
  - `step: String` — step anchor to release
  - `--worktree <PATH>` — optional worktree path for ownership check
  - `--force` — skip ownership check
  - Use clap `conflicts_with` to make `--worktree` and `--force` mutually exclusive
- [ ] Implement `run_state_release()` function following the pattern of `run_state_reset()`
- [ ] Add `StateReleaseData` struct to `output.rs` with fields: `plan_path: String`, `anchor: String`, `released: bool`, `was_claimed_by: Option<String>`
- [ ] Add dispatch arm in `main.rs` for `StateCommands::Release`

**Tests:**
- [ ] Unit test: claim a step, release with correct worktree — step returns to `pending`
- [ ] Unit test: claim a step, release with wrong worktree — returns `StateOwnershipViolation`
- [ ] Unit test: claim a step, release with `--force` — succeeds regardless of worktree
- [ ] Unit test: release a completed step — returns error
- [ ] Unit test: release a pending (unclaimed) step — returns error
- [ ] Unit test: release cascades to non-completed substeps and resets checklist items

**Checkpoint:**
- [ ] `cd tugcode && cargo fmt --all`
- [ ] `cd tugcode && cargo nextest run` — all tests pass, zero warnings

**Rollback:**
- Revert the commit (all new code is additive, no existing behavior changed)

**Commit after all checkpoints pass.**

---

#### Step 2: --force flag on state claim {#step-2}

**Depends on:** #step-1

**Commit:** `feat(state): add --force flag to state claim for lease bypass`

**References:** [D03] Force claim bypasses lease expiry but respects dependency ordering, Table T01, Table T02, (#inputs-outputs, #error-scenarios, #terminology)

**Artifacts:**
- Modified `claim_step()` signature in `tugtool-core/src/state.rs` (add `force: bool`)
- Updated 19 existing test call sites in `tugtool-core/src/state.rs` `#[cfg(test)] mod tests` to pass `false` for the new `force` parameter
- Modified `StateCommands::Claim` variant in `tugcode/src/commands/state.rs` (add `--force`)
- Modified `run_state_claim()` in `tugcode/src/commands/state.rs` (pass `force`)
- Modified dispatch in `tugcode/src/main.rs` (pass `force`)

**Tasks:**
- [ ] Add `force: bool` parameter to `claim_step()` after `current_hash`
- [ ] Modify the claimability SQL to use a conditional WHERE clause based on `force`:
  - When `force = false` (default): keep existing behavior plus auto-reclaim from Step 0
  - When `force = true`: use `OR s.status IN ('claimed', 'in_progress')` without lease check or worktree match
- [ ] Approach: build the SQL query string dynamically or use two separate query strings based on `force` flag
- [ ] Ensure `reclaimed` is set to `true` when force-claiming a step that was previously claimed/in_progress (existing logic handles this: `status != "pending"`)
- [ ] Update all 19 existing test calls to `claim_step()` in `state.rs` to append `false` as the `force` parameter. These call sites are in the `#[cfg(test)] mod tests` block at lines 1937, 1961, 1968, 1992, 2005, 2050, 2087, 2144, 2161, 2181, 2211, 2255, 2304, 2330, 2629, 2713, 2769, 2798, 2839. Each call currently looks like `.claim_step("...", "wt-a", 7200, "abc123hash")` and must become `.claim_step("...", "wt-a", 7200, "abc123hash", false)`.
- [ ] Update the single production caller of `claim_step()` in `run_state_claim()` (commands/state.rs) to pass the `force` CLI flag value
- [ ] Add `--force` flag to `StateCommands::Claim` in `commands/state.rs`
- [ ] Update `run_state_claim()` to accept and pass through the `force` parameter
- [ ] Update dispatch in `main.rs` to pass `force` from the parsed CLI args

**Tests:**
- [ ] Unit test: force-claim a step with active lease from a different worktree — succeeds with `reclaimed: true`
- [ ] Unit test: force-claim still respects dependency ordering — cannot claim step-2 if step-1 is not completed
- [ ] Unit test: force-claim a pending step — succeeds normally (same as non-force)
- [ ] Unit test: force-claim does not claim completed steps (completed steps are excluded from claimability query)
- [ ] Unit test: non-force claim from different worktree with active lease — returns `NoReadySteps` (existing behavior preserved)

**Checkpoint:**
- [ ] `cd tugcode && cargo fmt --all`
- [ ] `cd tugcode && cargo nextest run` — all tests pass, zero warnings

**Rollback:**
- Revert the commit; the signature change is backward-compatible since all callers are updated in the same commit

**Commit after all checkpoints pass.**

---

### 3.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three incremental fixes for interrupted session recovery: same-worktree auto-reclaim, explicit `state release` command, and `--force` flag on `state claim`.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Auto-reclaim: re-claiming from the same worktree succeeds immediately without waiting for lease expiry (`cd tugcode && cargo nextest run -E 'test(auto_reclaim)'`)
- [ ] Release: `tugcode state release <plan> <step> --worktree <path>` returns step to pending (`cd tugcode && cargo nextest run -E 'test(release)'`)
- [ ] Force: `tugcode state claim <plan> --worktree <path> --force` bypasses lease expiry (`cd tugcode && cargo nextest run -E 'test(force_claim)'`)
- [ ] All existing tests pass: `cd tugcode && cargo nextest run`
- [ ] Zero compiler warnings: `cd tugcode && cargo build` succeeds under `-D warnings`

**Acceptance tests:**
- [ ] Unit test: claim, interrupt, re-claim from same worktree (auto-reclaim)
- [ ] Unit test: claim, release, re-claim from different worktree (release)
- [ ] Unit test: claim with active lease, force-claim from different worktree (--force)
- [ ] Unit test: release a completed step returns error
- [ ] Unit test: force-claim respects dependency ordering

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Orchestrator retry: implement skill automatically retries with `--force` on `NoReadySteps` with blocked > 0
- [ ] Orchestrator recovery: implement skill calls `state release` as part of error recovery
- [ ] Lease duration auto-tuning based on step complexity

| Checkpoint | Verification |
|------------|--------------|
| All three fixes implemented and tested | `cd tugcode && cargo nextest run` |
| No compiler warnings | `cd tugcode && cargo build` |
| Code formatted | `cd tugcode && cargo fmt --all --check` |

**Commit after all checkpoints pass.**
