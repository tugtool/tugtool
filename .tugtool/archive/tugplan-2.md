## Phase 2.0: Fix Beads Git Integration Layer {#phase-beads-fix}

**Purpose:** Fix the beads git integration layer that breaks the four-step workflow (plan, implement, PR, merge). The daemon conflicts with worktrees, git hooks block commits, plan file annotations cause merge conflicts, and the bead completion check in merge is unreliable. Beads remains a hard requirement -- the fix is to eliminate the broken integration points, not to make beads optional.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-02-14 |
| Beads Root | `tugtool-f41` |
| Beads Root | `tugtool-g22` |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The beads integration in tugtool provides real value as an inter-agent communication channel (architect writes strategy to the design field, coder reads it; coder writes results to notes, reviewer reads them) and enables interrupt/resume via `bd ready`. However, the git integration layer is broken in four specific ways: (1) the beads daemon auto-flush conflicts with worktrees, (2) git hooks installed by `bd init` block ALL commits when `bd sync --flush-only` fails, (3) `**Bead:**` annotations and `Beads Root` rows written to plan files cause merge conflicts between the worktree branch and main, and (4) the bead completion check in merge preflight always shows incorrect results because it reads bead IDs from the main branch plan file while beads are synced in the worktree branch.

These problems collectively break the four-step workflow (plan, implement, PR, merge) about half the time, requiring manual intervention to recover. The fix is to eliminate the broken integration points while keeping beads as a hard requirement -- fail fast if beads itself is actually broken, but stop the git integration layer from causing collateral damage.

#### Strategy {#strategy}

- Hardcode `BEADS_NO_DAEMON=1` and `BEADS_NO_AUTO_FLUSH=1` in BeadsCli constructor so every `bd` call uses direct SQLite mode, eliminating daemon/worktree conflicts
- Have `tugtool init` detect and remove beads git hooks (pre-commit, post-merge) that contain `bd` references, preventing the hook-blocks-commit problem
- Stop writing `**Bead:**` and `Beads Root` annotations to plan files; return bead_mapping in JSON output from `beads sync` instead, eliminating the source of merge conflicts
- Remove the unreliable bead completion check from merge preflight entirely
- Convert the main sync check in merge from a blocker to a warning
- Keep beads sync errors in worktree create fatal -- beads is required, fail fast if broken
- Leave existing plan files with bead annotations as-is (backwards compatible)

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool users running the plan/implement/merge workflow
2. Agent authors who rely on bead-mediated communication

#### Success Criteria (Measurable) {#success-criteria}

- `BeadsCli::default()` sets `BEADS_NO_DAEMON=1` and `BEADS_NO_AUTO_FLUSH=1` (verified by unit test)
- `tugtool init` removes beads-related git hooks from `.git/hooks/` (verified by unit test)
- `tugtool beads sync` creates beads in SQLite, returns bead_mapping in JSON, and does not modify the plan file (verified by unit test)
- `tugtool merge` does not call `check_bead_completion` and does not block on `check_main_sync` (code inspection + test update)
- All existing tests pass (`cargo nextest run`)
- No new warnings (`-D warnings` enforced)

#### Scope {#scope}

1. BeadsCli constructor hardcodes env vars for direct SQLite mode
2. `tugtool init` removes beads git hooks from `.git/hooks/`
3. Remove plan file annotation writes from `beads sync`; add `bead_mapping` to `SyncData` JSON output
4. Update `sync_beads_in_worktree` to build bead_mapping from sync output instead of re-parsing plan
5. Remove `check_bead_completion` from merge preflight
6. Convert `check_main_sync` from blocker to warning in merge
7. Update skill markdown files and CLAUDE.md documentation

#### Non-goals (Explicitly out of scope) {#non-goals}

- Removing beads entirely (beads provides real inter-agent value)
- Changing the beads CLI (`bd`) itself
- Adding explicit JSONL flush points (deferred to future work)
- Modifying existing plan files to strip bead annotations
- Making beads optional or soft-fail (beads is a hard requirement)
- Changing agent markdown files (agents already use beads correctly)

#### Dependencies / Prerequisites {#dependencies}

- Existing beads.rs module with BeadsCli struct
- Existing merge.rs with `check_bead_completion` and `check_main_sync` functions
- Existing beads sync command implementation in `commands/beads/sync.rs`
- Existing init command implementation in `commands/init.rs`

#### Constraints {#constraints}

- `cargo build` with `-D warnings` must pass after every step
- All existing tests must continue to pass
- Backwards compatible: existing plans with `**Bead:**` lines must still parse and validate
- Beads sync failures in worktree create remain fatal (fail fast)

#### Assumptions {#assumptions}

- The BeadsCli struct already has `env_vars: HashMap<String, String>` and `set_env` method
- All tugtool commands that spawn `bd` already use the BeadsCli wrapper
- The implementer skill reads `bead_mapping` from `worktree create` JSON output and passes it to agents
- Beads git hooks contain identifiable strings like `bd` or `beads` that can be detected by content inspection

---

### 2.0.0 Design Decisions {#design-decisions}

#### [D01] Hardcode daemon-disable env vars in BeadsCli constructor (DECIDED) {#d01-no-daemon}

**Decision:** Set `BEADS_NO_DAEMON=1` and `BEADS_NO_AUTO_FLUSH=1` as default env vars in `BeadsCli::default()` and `BeadsCli::new()`.

**Rationale:**
- The beads daemon is unsafe with git worktrees (SQLite locks across directory boundaries)
- Direct SQLite mode is always correct for tugtool's use case
- Hardcoding in the constructor ensures every `bd` call gets these vars automatically

**Implications:**
- Every `bd` subprocess spawned by tugtool will use direct SQLite mode
- No runtime configuration needed
- Callers can still override via `set_env` if needed

#### [D02] Stop writing bead annotations to plan files (DECIDED) {#d02-no-annotations}

**Decision:** The `beads sync` command will create beads in SQLite and return `bead_mapping` (anchor-to-bead-ID HashMap) in JSON output, but will not write `**Bead:** bd-xxx` lines or `Beads Root` rows to plan files.

**Rationale:**
- Bead annotations in plan files cause merge conflicts between worktree branches and main
- The bead_mapping is already returned in the `worktree create` JSON output, which is the primary consumer
- SQLite is the source of truth for bead state, not the plan file

**Implications:**
- `sync_plan_to_beads` will stop calling `write_bead_to_step` and `write_beads_root_to_content`; those functions become dead code and are removed
- `sync_plan_to_beads` return type changes: replace `Option<String>` (updated_content) with `HashMap<String, String>` (anchor_to_bead mapping)
- The caller in `run_sync` must be updated to handle the new return type and serialize the mapping into `SyncData`
- `SyncData` gains a `bead_mapping: Option<HashMap<String, String>>` field
- `sync_beads_in_worktree` in worktree.rs builds bead_mapping from the `SyncData.bead_mapping` field instead of re-parsing the plan file for `**Bead:**` lines
- Existing plans with annotations will still parse correctly (backwards compatible)

#### [D03] Remove bead completion check from merge (DECIDED) {#d03-remove-bead-check}

**Decision:** Remove the `check_bead_completion` function and its invocation in `run_preflight_checks` entirely.

**Rationale:**
- The check always shows incorrect results because it reads bead IDs from the main branch plan file, but beads are synced in the worktree branch
- False negatives ("N of M steps incomplete") confuse users and erode trust in the merge command

**Implications:**
- The `check_bead_completion` function and its call in `run_preflight_checks` will be deleted
- The `BeadsCli` and `Step` imports in merge.rs may become unused and should be cleaned up
- The `parse_tugplan` import may become unused if no other code in merge.rs uses it

#### [D04] Convert main sync check to warning (DECIDED) {#d04-sync-warning}

**Decision:** The `check_main_sync` call at line 1124 of merge.rs becomes a warning rather than a blocking error. If the local main branch is behind origin/main, inform the user but do not prevent the merge.

**Rationale:**
- Blocking on sync state is overly cautious and can be wrong (e.g., when there is no remote, the check fails and blocks merge for repos that never had a remote)
- The user has already confirmed they want to merge; a warning is sufficient

**Implications:**
- The call site at line 1124 changes from `if let Err(e) = check_main_sync(...)` returning an error, to pushing a warning string and continuing
- `check_main_sync` return type may change from `Result<(), String>` to `Option<String>` (returning a warning message), or the call site wraps the error in a warning
- Three existing tests must be updated: `test_check_main_sync_in_sync`, `test_check_main_sync_diverged`, `test_check_main_sync_no_origin` -- the diverged and no-origin cases now produce warnings instead of errors

#### [D05] Init removes beads git hooks (DECIDED) {#d05-remove-hooks}

**Decision:** The `tugtool init` command will check for and remove `.git/hooks/pre-commit` and `.git/hooks/post-merge` if they contain beads/bd references (e.g., `bd sync`, `bd `, `beads`).

**Rationale:**
- The beads pre-commit hook runs `bd sync --flush-only` and blocks ALL commits when it fails
- These hooks are installed by `bd init` or `bd hooks install` and persist even when tugtool manages all beads operations via BeadsCli
- Removing them at init time prevents the hook-blocks-commit problem proactively

**Implications:**
- `run_init` gains a new step: after creating `.tugtool/` files, scan `.git/hooks/` for beads-related hooks and remove them
- The function must detect whether a hook file contains beads references (not just blindly delete hooks)
- Hook removal happens in both fresh and idempotent init modes
- A new helper function `remove_beads_hooks` handles the detection and removal logic
- Unit tests verify that beads hooks are removed and non-beads hooks are preserved

---

### 2.0.1 Execution Steps {#execution-steps}

#### Step 0: Hardcode env vars in BeadsCli constructor {#step-0}

**Bead:** `tugtool-g22.1`

**Commit:** `fix(beads): hardcode BEADS_NO_DAEMON and BEADS_NO_AUTO_FLUSH in BeadsCli`

**References:** [D01] Hardcode daemon-disable env vars in BeadsCli constructor, (#d01-no-daemon, #context)

**Artifacts:**
- Modified `crates/tugtool-core/src/beads.rs`

**Tasks:**
- [ ] In `BeadsCli::default()`, initialize `env_vars` with `BEADS_NO_DAEMON=1` and `BEADS_NO_AUTO_FLUSH=1` instead of an empty HashMap
- [ ] In `BeadsCli::new()`, initialize `env_vars` with the same two env vars
- [ ] Add a unit test that verifies `BeadsCli::default().env_vars` contains both keys
- [ ] Add a unit test that verifies `BeadsCli::new("bd".to_string()).env_vars` contains both keys

**Tests:**
- [ ] Unit test: `test_beadscli_default_env_vars` verifies both env vars are set
- [ ] Unit test: `test_beadscli_new_env_vars` verifies both env vars are set
- [ ] Integration: All existing beads tests still pass

**Checkpoint:**
- [ ] `cargo build`
- [ ] `cargo nextest run`

**Rollback:**
- Revert changes to `beads.rs`

**Commit after all checkpoints pass.**

---

#### Step 1: Stop writing bead annotations to plan files {#step-1}

**Depends on:** #step-0

**Bead:** `tugtool-g22.2`

**Commit:** `fix(beads): stop writing bead annotations to plan files during sync`

**References:** [D02] Stop writing bead annotations to plan files, (#d02-no-annotations, #strategy)

**Artifacts:**
- Modified `crates/tugtool/src/commands/beads/sync.rs`
- Modified `crates/tugtool/src/commands/worktree.rs`

**Tasks:**
- [ ] In `sync_plan_to_beads`, change the return type: replace `Option<String>` (updated_content) with `HashMap<String, String>` (the `anchor_to_bead` mapping built during sync). The new return type is `Result<(Option<String>, usize, usize, HashMap<String, String>, Vec<String>), TugError>` where the fields are `(root_id, steps_synced, deps_added, bead_mapping, enrich_errors)`
- [ ] Remove all calls to `write_bead_to_step` and `write_beads_root_to_content` inside `sync_plan_to_beads`; remove the `updated_content` variable and tracking
- [ ] Return `anchor_to_bead.clone()` as the bead_mapping in the result tuple
- [ ] Delete the `write_bead_to_step` function (now dead code)
- [ ] Delete the `write_beads_root_to_content` function (now dead code)
- [ ] Update the caller in `run_sync`: destructure the new return tuple, remove the `updated_content` file-write block, and populate a new `bead_mapping` field on `SyncData`
- [ ] Add `bead_mapping: Option<HashMap<String, String>>` field to `SyncData` struct with `#[serde(skip_serializing_if = "Option::is_none")]`
- [ ] In `sync_beads_in_worktree` (worktree.rs), update to build the `bead_mapping` from the `SyncData.bead_mapping` field in the JSON response instead of re-parsing the plan file for `**Bead:**` lines (currently at lines 200-205 of worktree.rs)
- [ ] Update or remove tests that assert plan file content is modified by sync

**Tests:**
- [ ] Unit test: verify that sync does not modify the plan file content
- [ ] Unit test: verify `SyncData` serializes `bead_mapping` field correctly
- [ ] Integration: `cargo nextest run` passes

**Checkpoint:**
- [ ] `cargo build`
- [ ] `cargo nextest run`

**Rollback:**
- Revert changes to `sync.rs` and `worktree.rs`

**Commit after all checkpoints pass.**

---

#### Step 2: Init removes beads git hooks {#step-2}

**Depends on:** #step-0

**Bead:** `tugtool-g22.3`

**Commit:** `fix(init): remove beads git hooks during init`

**References:** [D05] Init removes beads git hooks, (#d05-remove-hooks, #context)

**Artifacts:**
- Modified `crates/tugtool/src/commands/init.rs`

**Tasks:**
- [ ] Add a `remove_beads_hooks` helper function that: (a) checks if `.git/hooks/` directory exists, (b) for each of `pre-commit` and `post-merge`, reads the file content, (c) if the content contains `bd ` or `bd\n` or `beads` references, removes the file, (d) returns a list of removed hook filenames for reporting
- [ ] Call `remove_beads_hooks` in `run_init` after creating `.tugtool/` files, in both the idempotent and force paths
- [ ] Add the removed hooks to the `files_created` reporting (or a separate `hooks_removed` message) so the user knows what happened
- [ ] If `.git/hooks/` does not exist or hook files do not contain beads references, do nothing (safe no-op)

**Tests:**
- [ ] Unit test: `test_remove_beads_hooks_removes_bd_hook` -- create a `.git/hooks/pre-commit` with `bd sync --flush-only` content, run `remove_beads_hooks`, verify file is deleted
- [ ] Unit test: `test_remove_beads_hooks_preserves_non_bd_hook` -- create a `.git/hooks/pre-commit` with unrelated content (e.g., `#!/bin/sh\nrustfmt`), run `remove_beads_hooks`, verify file is NOT deleted
- [ ] Unit test: `test_remove_beads_hooks_no_git_dir` -- run `remove_beads_hooks` when `.git/hooks/` does not exist, verify no error
- [ ] Integration: `cargo nextest run` passes

**Checkpoint:**
- [ ] `cargo build`
- [ ] `cargo nextest run`

**Rollback:**
- Revert changes to `init.rs`

**Commit after all checkpoints pass.**

---

#### Step 3: Remove bead completion check and convert main sync to warning in merge {#step-3}

**Depends on:** #step-0

**Bead:** `tugtool-g22.4`

**Commit:** `fix(merge): remove bead completion check, convert main sync to warning`

**References:** [D03] Remove bead completion check from merge, [D04] Convert main sync check to warning, (#d03-remove-bead-check, #d04-sync-warning)

**Artifacts:**
- Modified `crates/tugtool/src/commands/merge.rs`

**Tasks:**
- [ ] Delete the `check_bead_completion` function entirely (lines 216-261)
- [ ] Remove the call to `check_bead_completion` in `run_preflight_checks` (line 441)
- [ ] Remove the `BeadsCli`, `Step`, and `parse_tugplan` imports from merge.rs if they become unused (verify with `cargo build`)
- [ ] Convert the `check_main_sync` call site at line 1124 from a blocking error to a warning: change `if let Err(e) = check_main_sync(&repo_root) { return Err(e); }` to push the error message as a warning string to a warnings list and continue execution
- [ ] Update `test_check_main_sync_diverged`: the diverged case should now produce a warning string rather than an Err; test that the merge proceeds (or test the warning output)
- [ ] Update `test_check_main_sync_no_origin`: the no-origin case should now produce a warning rather than an Err
- [ ] Preserve `test_check_main_sync_in_sync` (should still pass cleanly with no warning)

**Tests:**
- [ ] Updated test: `test_check_main_sync_diverged` verifies warning is produced but merge is not blocked
- [ ] Updated test: `test_check_main_sync_no_origin` verifies warning is produced but merge is not blocked
- [ ] Existing test: `test_check_main_sync_in_sync` still passes (no warning in success case)
- [ ] Integration: `cargo nextest run` passes
- [ ] Verify `cargo build` produces no unused import warnings

**Checkpoint:**
- [ ] `cargo build`
- [ ] `cargo nextest run`

**Rollback:**
- Revert changes to `merge.rs`

**Commit after all checkpoints pass.**

---

#### Step 4: Update skill files and CLAUDE.md {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Bead:** `tugtool-g22.5`

**Commit:** `docs: update skill files and CLAUDE.md for fixed beads integration`

**References:** [D01] Hardcode daemon-disable env vars in BeadsCli constructor, [D02] Stop writing bead annotations to plan files, [D03] Remove bead completion check from merge, [D05] Init removes beads git hooks, (#d01-no-daemon, #d02-no-annotations, #d03-remove-bead-check, #d05-remove-hooks, #strategy)

**Artifacts:**
- Modified `skills/implement/SKILL.md`
- Modified `skills/merge/SKILL.md`
- Modified `CLAUDE.md`

**Tasks:**
- [ ] In `skills/implement/SKILL.md`, update the "Reference: Beads Integration" section to note: beads uses direct SQLite mode (no daemon, no auto-flush), bead_mapping comes from JSON output (not plan file annotations), beads sync errors remain fatal
- [ ] In `skills/merge/SKILL.md`, remove mention of "Incomplete steps/beads" from the warnings list since the bead completion check has been removed; note that main sync check is now a warning not a blocker
- [ ] In `CLAUDE.md`, add a "Beads Policy" section (after "Git Policy") documenting: beads is a hard requirement, uses direct SQLite mode (no daemon, no auto-flush), plan files are not modified by beads sync, `tugtool init` removes beads git hooks, unreliable merge checks have been removed
- [ ] In `CLAUDE.md`, update the "Worktree Workflow" step 3 description: change "Beads synced: Bead annotations are synced and committed to the worktree" to reflect that beads are synced to SQLite (no plan file annotations)
- [ ] In `CLAUDE.md`, update the "Step commit succeeds but bead close fails" troubleshooting section to be consistent with the current behavior

**Tests:**
- [ ] Manual review: skill files and CLAUDE.md reflect the fixed beads integration behavior
- [ ] `cargo build` (no Rust changes, but verify no regressions)

**Checkpoint:**
- [ ] `cargo build`
- [ ] `cargo nextest run`

**Rollback:**
- Revert changes to skill and documentation files

**Commit after all checkpoints pass.**

---

### 2.0.2 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Beads integration that uses direct SQLite mode, does not modify plan files, removes beads git hooks at init time, and eliminates unreliable merge preflight checks -- while keeping beads as a hard requirement that fails fast when actually broken.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build` passes with zero warnings
- [ ] `cargo nextest run` passes all tests
- [ ] `BeadsCli::default()` sets `BEADS_NO_DAEMON=1` and `BEADS_NO_AUTO_FLUSH=1`
- [ ] `tugtool init` removes beads-related git hooks from `.git/hooks/`
- [ ] `tugtool beads sync` does not modify plan files and returns `bead_mapping` in JSON output
- [ ] `tugtool merge` does not call `check_bead_completion`
- [ ] `tugtool merge` treats `check_main_sync` failure as a warning, not a blocker
- [ ] CLAUDE.md documents the beads policy

| Checkpoint | Verification |
|------------|--------------|
| Build passes | `cargo build` |
| Tests pass | `cargo nextest run` |
| No dead code warnings | `cargo build` with `-D warnings` |

**Commit after all checkpoints pass.**