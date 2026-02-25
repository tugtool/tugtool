## Phase 1.0: Rename Plan Worktree Prefix from `tugtool/` to `tugplan/` {#phase-worktree-prefix-rename}

**Purpose:** Rename the git branch prefix for plan worktrees from `tugtool/` to `tugplan/`, and the corresponding directory prefix from `tugtool__` to `tugplan__`, so that worktrees are consistently named with either `tugplan/` or `tugdash/` prefixes. Fix `is_valid_worktree_path` to accept both prefixes, closing the gap where `tugdash__` worktrees fail validation.

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

Plan worktrees currently use `tugtool/` as their branch prefix (e.g., `tugtool/auth-20260208-143022`), producing directory names like `.tugtree/tugtool__auth-20260208-143022`. The more-recently-added dash feature uses `tugdash/` (e.g., `tugdash/my-task` producing `.tugtree/tugdash__my-task`). Having "tugtool" in worktree names is confusing since it does not distinguish plan worktrees from anything else. The naming should be `tugplan/` for plan worktrees and `tugdash/` for dash worktrees.

Additionally, `is_valid_worktree_path` currently only accepts `tugtool__` prefixed paths, which means dash worktrees (`.tugtree/tugdash__*`) fail validation in `doctor.rs`. This must be fixed as part of the rename.

#### Strategy {#strategy}

- Rename `tugtool/` to `tugplan/` and `tugtool__` to `tugplan__` everywhere. No existing branches or directories use these prefixes, so this is a pure code change.
- Update production Rust code first (constants, format strings, function names), then update tests to match.
- Update `is_valid_worktree_path` to accept both `tugplan__` and `tugdash__` prefixes, fixing the existing validation gap.
- Update `doctor.rs` worktree scanning to recognize both `tugplan__` and `tugdash__` directory prefixes.
- Update tugplug markdown and roadmap docs that reference `tugtool/` as a branch-name or worktree-directory pattern.
- Run a final verification grep across `tugcode/` and `tugplug/` to confirm no stale `tugtool/` branch-name or `tugtool__` directory-name references remain in executable code or active agent docs.

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool developers who create and manage plan worktrees via `tugcode worktree create`
2. Agent authors who reference branch name patterns in tugplug skill/agent markdown

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build` succeeds with zero warnings in `tugcode/` (verification: `cd tugcode && cargo build`)
- `cargo nextest run` passes all tests in `tugcode/` (verification: `cd tugcode && cargo nextest run`)
- `cargo fmt --all --check` passes (verification: `cd tugcode && cargo fmt --all --check`)
- `grep -rn 'tugtool/' tugcode/crates/ --include='*.rs'` returns only `.tugtool/` config directory references, not branch-name or directory-name references
- `grep -rn 'tugtool__' tugcode/crates/ --include='*.rs'` returns zero matches
- `grep -rn 'tugtool/' tugplug/ --include='*.md' --include='*.sh'` returns only `.tugtool/` config directory references, not branch-name references

#### Scope {#scope}

1. Rename `tugtool/` branch prefix to `tugplan/` in all Rust production code
2. Rename `tugtool__` directory prefix to `tugplan__` in all Rust production code
3. Rename `list_tugtool_branches` function to `list_tugplan_branches` and update all callers and re-exports
4. Update `is_valid_worktree_path` to accept both `tugplan__` and `tugdash__` prefixed paths
5. Update `doctor.rs` worktree scanning to check for both `tugplan__` and `tugdash__` directories
6. Update all Rust test code to use new prefixes
7. Update tugplug markdown files that reference `tugtool/` as a branch name example
8. Update roadmap docs that reference `tugtool/` branch or `tugtool__` directory patterns

#### Non-goals (Explicitly out of scope) {#non-goals}

- Renaming the `.tugtool/` configuration directory (stays as-is)
- Changing the `tugdash/` or `tugdash__` prefixes (already correct)
- Renaming the `tugtool-core` crate or any Rust module names
- Adding stale-branch cleanup for dash branches (dash manages its own lifecycle via `dash release` and `dash join` -- see (#dash-cleanup-note))

#### Dependencies / Prerequisites {#dependencies}

- All existing tests must pass before starting (baseline verification)

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` in `.cargo/config.toml`) -- all code must compile warning-free
- `cargo fmt --all` must be run after code changes

#### Assumptions {#assumptions}

- The `.tugtool/` configuration directory name is NOT being renamed -- only the git branch prefix `tugtool/` and worktree directory prefix `tugtool__` are changing.
- The `tugdash/` and `tugdash__` prefix for dash worktrees is already correct and is NOT being changed.
- The `list_worktrees` function (worktree.rs:688) currently only lists `tugtool/` branches; after the rename it should list `tugplan/` branches -- dash worktrees are tracked separately via dash.rs.
- No `tugtool/` branches or `tugtool__` directories exist in any active environment. This is a pure code rename with no runtime migration needed.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Straight rename -- tugtool/ becomes tugplan/ everywhere (DECIDED) {#d01-clean-break}

**Decision:** Rename `tugtool/` to `tugplan/` and `tugtool__` to `tugplan__` in all code and docs. No migration or fallback logic.

**Rationale:**
- There are no existing `tugtool/` branches or `tugtool__` directories in the wild -- this is purely a code rename
- The new naming (`tugplan/`, `tugdash/`) is self-documenting

**Implications:**
- Every string literal, doc comment, and code comment referencing the old prefixes gets updated
- No runtime migration code needed

#### [D02] is_valid_worktree_path accepts both tugplan__ and tugdash__ (DECIDED) {#d02-dual-prefix-validation}

**Decision:** Update `is_valid_worktree_path` to accept paths starting with either `.tugtree/tugplan__` or `.tugtree/tugdash__`, fixing the existing gap where dash worktrees fail validation.

**Rationale:**
- `doctor.rs` uses `is_valid_worktree_path` to validate worktree directories
- Currently only `tugtool__` (soon `tugplan__`) paths pass validation, but dash worktrees are legitimate
- A single validation function should recognize all valid worktree path patterns

**Implications:**
- `doctor.rs` worktree health check will correctly validate dash worktree paths
- Tests for `is_valid_worktree_path` must cover both `tugplan__` and `tugdash__` cases

#### [D03] Rename list_tugtool_branches to list_tugplan_branches (DECIDED) {#d03-rename-function}

**Decision:** Rename the public function `list_tugtool_branches` to `list_tugplan_branches` and update the lib.rs re-export and all callers (merge.rs, doctor.rs).

**Rationale:**
- Function name should match the prefix it searches for
- Keeps the codebase self-documenting

**Implications:**
- The re-export in `tugtool-core/src/lib.rs` must be updated
- Import statements in `merge.rs` and `doctor.rs` must be updated
- The git branch list pattern changes from `tugtool/*` to `tugplan/*`

#### [D04] doctor.rs scans for both tugplan__ and tugdash__ directories (DECIDED) {#d04-doctor-dual-scan}

**Decision:** Update the `check_worktree_health` function in `doctor.rs` to scan for directories matching both `tugplan__` and `tugdash__` prefixes, not just the plan prefix.

**Rationale:**
- Currently doctor.rs line 311 filters for `tugtool__` only, missing dash worktrees entirely
- After the rename, both `tugplan__` and `tugdash__` directories should be checked

**Implications:**
- The `starts_with("tugtool__")` filter becomes a check for either `tugplan__` or `tugdash__`

#### Dash Branch Cleanup Note {#dash-cleanup-note}

Dash branches do NOT need stale-branch cleanup added in this plan. Dash already manages its own lifecycle: `dash join` squash-merges and removes the worktree and branch, `dash release` removes the worktree and branch without merging. Both update `state.db` tracking. The `cleanup_stale_branches` / `list_tugplan_branches` functions are plan-only and do not need to handle `tugdash/` branches.

---

### 1.0.1 Change Inventory {#change-inventory}

**Table T01: Rust Production Code Changes** {#t01-rust-production}

| File | Change | Old | New |
|------|--------|-----|-----|
| `tugtool-core/src/worktree.rs` | `strip_prefix` call | `"tugtool/"` | `"tugplan/"` |
| `tugtool-core/src/worktree.rs` | `format!` branch name | `"tugtool/{}-{}"` | `"tugplan/{}-{}"` |
| `tugtool-core/src/worktree.rs` | `starts_with` in list_worktrees | `"tugtool/"` | `"tugplan/"` |
| `tugtool-core/src/worktree.rs` | `format!` branch prefix | `"tugtool/{}-"` | `"tugplan/{}-"` |
| `tugtool-core/src/worktree.rs` | `is_valid_worktree_path` | `starts_with(".tugtree/tugtool__")` | accepts `.tugtree/tugplan__` or `.tugtree/tugdash__` |
| `tugtool-core/src/worktree.rs` | `branch --list` pattern | `"tugtool/*"` | `"tugplan/*"` |
| `tugtool-core/src/worktree.rs` | function name | `list_tugtool_branches` | `list_tugplan_branches` |
| `tugtool-core/src/worktree.rs` | doc comments/examples | `tugtool/` branch refs | `tugplan/` branch refs |
| `tugtool-core/src/worktree.rs` | doc comments/examples | `tugtool__` dir refs | `tugplan__` dir refs |
| `tugtool-core/src/lib.rs` | re-export | `list_tugtool_branches` | `list_tugplan_branches` |
| `tugcode/src/commands/worktree.rs` | `long_about` CLI help string (line 77) | `tugtool/14-...`, `.tugtree/tugtool__14-...`, `tugtool__14-...` | `tugplan/14-...`, `.tugtree/tugplan__14-...`, `tugplan__14-...` |
| `tugcode/src/commands/doctor.rs` | directory filter | `"tugtool__"` | `"tugplan__"` or `"tugdash__"` |
| `tugcode/src/commands/doctor.rs` | function call | `list_tugtool_branches` | `list_tugplan_branches` |
| `tugcode/src/commands/merge.rs` | import | `list_tugtool_branches` | `list_tugplan_branches` |
| `tugcode/src/commands/merge.rs` | function call | `list_tugtool_branches` | `list_tugplan_branches` |
| `tugcode/src/commands/merge.rs` | code comment (line 982) | `tugtool/*` | `tugplan/*` |

**Table T02: Rust Test Code Changes** {#t02-rust-tests}

| File | Change |
|------|--------|
| `tugtool-core/src/worktree.rs` | All test `"tugtool/` to `"tugplan/`, `tugtool__` to `tugplan__` (do comprehensive search, do not rely on counts) |
| `tugcode/src/commands/merge.rs` | All test `"tugtool/` to `"tugplan/`, `tugtool__` to `tugplan__` (do comprehensive search, do not rely on counts) |
| `tugcode/src/commands/worktree.rs` | All test `"tugtool/` to `"tugplan/`, `tugtool__` to `tugplan__` (do comprehensive search, do not rely on counts) |

**Table T03: Tugplug Markdown Changes** {#t03-tugplug-changes}

| File | Line | Old | New |
|------|------|-----|-----|
| `tugplug/skills/implement/SKILL.md` | 332 | `"tugtool/slug-20260214-120000"` | `"tugplan/slug-20260214-120000"` |

**Table T04: Roadmap Doc Changes** {#t04-roadmap-changes}

| File | Change |
|------|--------|
| `roadmap/worktree-naming-cleanup.md` | Update line 19 (`is_valid_worktree_path` row) to say "accepts `.tugtree/tugplan__` or `.tugtree/tugdash__`" instead of just `tugplan__`. Update all other `tugtool/` and `tugtool__` references to `tugplan/` and `tugplan__`. |
| `roadmap/dash-workflow.md` | Lines 245, 342: update `tugtool/` branch prefix references to `tugplan/` |
| `roadmap/multi-agent-coordination-chat.md` | Line 166: update `.tugtree/tugtool__my-plan-20260223/` to `.tugtree/tugplan__my-plan-20260223/`; line 546: update `tugtool/foo-A` branch name to `tugplan/foo-A` |
| `roadmap/tugstate-proposal.md` | Lines 28-29: update `tugtool__foo-20260223` directory names to `tugplan__foo-20260223`; line 630: update `.tugtree/tugtool__foo-20260223/` to `.tugtree/tugplan__foo-20260223/` |

---

### 1.0.2 Symbols to Add / Modify {#symbol-inventory}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `list_tugplan_branches` | fn (renamed) | `tugtool-core/src/worktree.rs` | Renamed from `list_tugtool_branches` |
| `is_valid_worktree_path` | fn (modified) | `tugtool-core/src/worktree.rs` | Now accepts both `tugplan__` and `tugdash__` prefixes |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify individual functions work with new prefixes | `is_valid_worktree_path`, `sanitize_branch_name`, `generate_branch_name` |
| **Integration** | Verify end-to-end worktree create/list/merge flows | `list_tugplan_branches`, worktree creation, doctor checks |

All existing tests are updated (not new tests added) except for new `is_valid_worktree_path` test cases covering `tugdash__` paths.

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Baseline Verification {#step-0}

**Commit:** `test: verify baseline -- all tests pass before rename`

**References:** (#success-criteria, #context)

**Artifacts:**
- No file changes -- verification only

**Tasks:**
- [ ] Run `cd tugcode && cargo build` and confirm zero warnings
- [ ] Run `cd tugcode && cargo nextest run` and confirm all tests pass
- [ ] Run `cd tugcode && cargo fmt --all --check` and confirm formatting is clean

**Tests:**
- [ ] Integration test: full test suite passes at baseline

**Checkpoint:**
- [ ] `cd tugcode && cargo build` exits 0
- [ ] `cd tugcode && cargo nextest run` exits 0
- [ ] `cd tugcode && cargo fmt --all --check` exits 0

**Rollback:**
- No changes to roll back

---

#### Step 1: Update Production Rust Code {#step-1}

**Depends on:** #step-0

**Commit:** `refactor: rename worktree prefix tugtool/ to tugplan/ in production code`

**References:** [D01] Straight rename, [D02] Dual-prefix validation, [D03] Rename function, [D04] Doctor dual scan, Table T01, (#change-inventory, #symbol-inventory)

**Artifacts:**
- Modified `tugcode/crates/tugtool-core/src/worktree.rs` -- all `tugtool/` string literals become `tugplan/`, all `tugtool__` become `tugplan__`, function renamed, `is_valid_worktree_path` updated for dual-prefix
- Modified `tugcode/crates/tugtool-core/src/lib.rs` -- re-export updated
- Modified `tugcode/crates/tugcode/src/commands/worktree.rs` -- `long_about` CLI help string updated
- Modified `tugcode/crates/tugcode/src/commands/doctor.rs` -- directory filter updated, function call renamed
- Modified `tugcode/crates/tugcode/src/commands/merge.rs` -- import and call renamed, code comment updated

**Tasks:**
- [ ] In `tugtool-core/src/worktree.rs`: replace all `"tugtool/"` string literals with `"tugplan/"` in production code (not tests yet)
- [ ] In `tugtool-core/src/worktree.rs`: replace all `"tugtool__"` string literals with `"tugplan__"` in production code (not tests yet)
- [ ] In `tugtool-core/src/worktree.rs`: rename function `list_tugtool_branches` to `list_tugplan_branches`
- [ ] In `tugtool-core/src/worktree.rs`: update `is_valid_worktree_path` to accept both `.tugtree/tugplan__` and `.tugtree/tugdash__`
- [ ] In `tugtool-core/src/worktree.rs`: update all doc comments and doc-test examples to use `tugplan/` and `tugplan__`
- [ ] In `tugtool-core/src/worktree.rs`: sweep all remaining `tugtool/` and `tugtool__` references in production (non-test) code -- doc comments on `CleanupMode::Stale`, `cleanup_stale_branches`, and any other functions
- [ ] In `tugtool-core/src/lib.rs`: update re-export from `list_tugtool_branches` to `list_tugplan_branches`
- [ ] In `tugcode/src/commands/worktree.rs`: update the `long_about` attribute string (line 77) -- change `tugtool/14-20250209-172637` to `tugplan/14-20250209-172637`, `.tugtree/tugtool__14-...` to `.tugtree/tugplan__14-...`, and `tugtool__14-20250209-172637` to `tugplan__14-20250209-172637`
- [ ] In `tugcode/src/commands/doctor.rs`: update `starts_with("tugtool__")` to check for both `tugplan__` and `tugdash__`
- [ ] In `tugcode/src/commands/doctor.rs`: update `list_tugtool_branches` call to `list_tugplan_branches`
- [ ] In `tugcode/src/commands/merge.rs`: update import from `list_tugtool_branches` to `list_tugplan_branches`
- [ ] In `tugcode/src/commands/merge.rs`: update call from `list_tugtool_branches` to `list_tugplan_branches`
- [ ] In `tugcode/src/commands/merge.rs`: update code comment at line 982 from `tugtool/*` to `tugplan/*`
- [ ] Run `cd tugcode && cargo fmt --all`

**Tests:**
- [ ] Unit test: `cargo build` compiles with zero warnings (tests may fail until Step 2)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` exits 0

**Rollback:**
- Revert the commit

---

#### Step 2: Update All Rust Test Code {#step-2}

**Depends on:** #step-1

**Commit:** `test: update all test string literals from tugtool/ to tugplan/`

**References:** [D01] Straight rename, [D02] Dual-prefix validation, Table T02, (#change-inventory)

**Artifacts:**
- Modified `tugcode/crates/tugtool-core/src/worktree.rs` -- all test string literals updated
- Modified `tugcode/crates/tugcode/src/commands/merge.rs` -- all test string literals updated
- Modified `tugcode/crates/tugcode/src/commands/worktree.rs` -- all test string literals updated

**Tasks:**
- [ ] In `worktree.rs` tests: replace all `"tugtool/` with `"tugplan/` in string literals
- [ ] In `worktree.rs` tests: replace all `tugtool__` with `tugplan__` in string literals
- [ ] In `worktree.rs` tests: update `test_is_valid_worktree_path_valid` to use `tugplan__` paths and add explicit `tugdash__` assertions: `assert!(is_valid_worktree_path(Path::new(".tugtree/tugdash__my-task")))` and `assert!(is_valid_worktree_path(Path::new(".tugtree/tugdash__feature-name")))`
- [ ] In `worktree.rs` tests: update `test_is_valid_worktree_path_invalid` to use `tugplan__` in error path examples and verify that bare `.tugtree/foo` (no prefix) still fails
- [ ] In `worktree.rs` tests: update `test_list_tugtool_branches` (rename test function to `test_list_tugplan_branches` and update branch names)
- [ ] In `worktree.rs` tests: update `sanitize_branch_name` test to show `tugplan/auth -> tugplan__auth`
- [ ] In `merge.rs` tests: replace all `"tugtool/` with `"tugplan/` and `tugtool__` with `tugplan__`
- [ ] In `worktree.rs` commands tests: replace all `"tugtool/` with `"tugplan/` and `tugtool__` with `tugplan__`
- [ ] Run `cd tugcode && cargo fmt --all`

**Tests:**
- [ ] Unit test: `test_is_valid_worktree_path_valid` passes with both `tugplan__` and `tugdash__` paths accepted
- [ ] Unit test: `test_is_valid_worktree_path_invalid` passes with bare `.tugtree/foo` rejected
- [ ] Integration test: `cd tugcode && cargo nextest run` -- all tests pass

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` exits 0 (includes `test_is_valid_worktree_path_valid` and `test_is_valid_worktree_path_invalid` verifying dual-prefix support)
- [ ] `cd tugcode && cargo fmt --all --check` exits 0

**Rollback:**
- Revert the commit

---

#### Step 3: Update Tugplug Markdown and Roadmap Docs {#step-3}

**Depends on:** #step-2

**Commit:** `docs: update tugtool/ branch and tugtool__ directory references in tugplug and roadmap`

**References:** [D01] Straight rename, [D02] Dual-prefix validation, Table T03, Table T04, (#change-inventory)

**Artifacts:**
- Modified `tugplug/skills/implement/SKILL.md` -- branch name example updated
- Modified `roadmap/worktree-naming-cleanup.md` -- all `tugtool/` and `tugtool__` references updated, `is_valid_worktree_path` row updated to reflect dual-prefix
- Modified `roadmap/dash-workflow.md` -- `tugtool/` branch prefix references updated
- Modified `roadmap/multi-agent-coordination-chat.md` -- `tugtool__` directory name updated
- Modified `roadmap/tugstate-proposal.md` -- `tugtool__` directory names updated

**Tasks:**
- [ ] In `tugplug/skills/implement/SKILL.md` line 332: change `"tugtool/slug-20260214-120000"` to `"tugplan/slug-20260214-120000"`
- [ ] In `roadmap/worktree-naming-cleanup.md`: update line 19 (`is_valid_worktree_path` row) to say "accepts `.tugtree/tugplan__` or `.tugtree/tugdash__`"; update all other `tugtool/` branch and `tugtool__` directory references to `tugplan/` and `tugplan__`
- [ ] In `roadmap/dash-workflow.md`: update lines 245, 342 from `tugtool/` to `tugplan/`
- [ ] In `roadmap/multi-agent-coordination-chat.md`: update line 166 from `tugtool__my-plan-20260223` to `tugplan__my-plan-20260223`; update line 546 from `tugtool/foo-A` to `tugplan/foo-A`
- [ ] In `roadmap/tugstate-proposal.md`: update lines 28-29 from `tugtool__foo-20260223` to `tugplan__foo-20260223`; update line 630 from `.tugtree/tugtool__foo-20260223/` to `.tugtree/tugplan__foo-20260223/`

**Tests:**
- [ ] Manual review: only branch-name and directory-name references changed, not `.tugtool/` config directory references

**Checkpoint:**
- [ ] `tugplug/skills/implement/SKILL.md` line 332 reads `"tugplan/slug-20260214-120000"`
- [ ] `roadmap/worktree-naming-cleanup.md` has no remaining `tugtool/` branch or `tugtool__` directory references

**Rollback:**
- Revert the commit

---

#### Step 4: Final Verification and Stale Reference Audit {#step-4}

**Depends on:** #step-3

**Commit:** `chore: verify no stale tugtool/ branch-name references remain`

**References:** [D01] Straight rename, (#success-criteria)

**Artifacts:**
- No file changes -- verification only

**Tasks:**
- [ ] Run `grep -rn 'tugtool/' tugcode/crates/ --include='*.rs'` and confirm all matches are `.tugtool/` config directory references only -- no branch-name or worktree-path patterns remain
- [ ] Run `grep -rn 'tugtool__' tugcode/crates/ --include='*.rs'` and confirm zero matches
- [ ] Run `grep -rn 'tugtool/' tugplug/ --include='*.md' --include='*.sh'` and confirm all matches are `.tugtool/` config directory references only -- no branch-name references remain
- [ ] Run `grep -n 'tugtool/' roadmap/worktree-naming-cleanup.md roadmap/dash-workflow.md roadmap/multi-agent-coordination-chat.md roadmap/tugstate-proposal.md` and confirm all matches are `.tugtool/` config directory references only
- [ ] Run `grep -n 'tugtool__' roadmap/worktree-naming-cleanup.md roadmap/dash-workflow.md roadmap/multi-agent-coordination-chat.md roadmap/tugstate-proposal.md` and confirm zero matches
- [ ] Run `cd tugcode && cargo build` and confirm zero warnings
- [ ] Run `cd tugcode && cargo nextest run` and confirm all tests pass
- [ ] Run `cd tugcode && cargo fmt --all --check` and confirm formatting is clean

**Tests:**
- [ ] Integration test: full test suite passes after all changes
- [ ] Drift prevention test: grep audit of `tugcode/`, `tugplug/`, and Table T04 roadmap files confirms no stale references

**Checkpoint:**
- [ ] `grep -rn 'tugtool/' tugcode/crates/ --include='*.rs'` returns only `.tugtool/` config directory references
- [ ] `grep -rn 'tugtool__' tugcode/crates/ --include='*.rs'` returns zero matches
- [ ] `grep -rn 'tugtool/' tugplug/ --include='*.md' --include='*.sh'` returns only `.tugtool/` config directory references
- [ ] `grep -n 'tugtool/' roadmap/worktree-naming-cleanup.md roadmap/dash-workflow.md roadmap/multi-agent-coordination-chat.md roadmap/tugstate-proposal.md` returns only `.tugtool/` config directory references
- [ ] `grep -n 'tugtool__' roadmap/worktree-naming-cleanup.md roadmap/dash-workflow.md roadmap/multi-agent-coordination-chat.md roadmap/tugstate-proposal.md` returns zero matches
- [ ] `cd tugcode && cargo build` exits 0
- [ ] `cd tugcode && cargo nextest run` exits 0
- [ ] `cd tugcode && cargo fmt --all --check` exits 0

**Rollback:**
- No changes to roll back (verification only)

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** All plan worktree references renamed from `tugtool/` to `tugplan/` (branch prefix) and `tugtool__` to `tugplan__` (directory prefix) across Rust production code, Rust tests, tugplug markdown, and roadmap docs, with `is_valid_worktree_path` fixed to accept both `tugplan__` and `tugdash__` paths.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cd tugcode && cargo build` exits 0 with zero warnings
- [ ] `cd tugcode && cargo nextest run` passes all tests
- [ ] `cd tugcode && cargo fmt --all --check` exits 0
- [ ] `grep -rn 'tugtool/' tugcode/crates/ --include='*.rs'` returns only `.tugtool/` config directory references
- [ ] `grep -rn 'tugtool__' tugcode/crates/ --include='*.rs'` returns zero matches
- [ ] `grep -rn 'tugtool/' tugplug/ --include='*.md' --include='*.sh'` returns only `.tugtool/` config directory references
- [ ] Table T04 roadmap files have no remaining `tugtool/` branch or `tugtool__` directory references (`.tugtool/` config directory references are acceptable)

**Acceptance tests:**
- [ ] Integration test: `cd tugcode && cargo nextest run` all green
- [ ] Drift prevention test: grep audit confirms zero stale references

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Consider adding a `PLAN_BRANCH_PREFIX` and `DASH_BRANCH_PREFIX` constant to avoid scattered string literals

| Checkpoint | Verification |
|------------|--------------|
| Build succeeds | `cd tugcode && cargo build` exits 0 |
| All tests pass | `cd tugcode && cargo nextest run` exits 0 |
| No stale refs | grep of `tugcode/` and `tugplug/` returns zero branch-name or directory-name matches |

**Commit after all checkpoints pass.**
