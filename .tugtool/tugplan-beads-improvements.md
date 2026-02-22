## Phase 1.0: Beads Integration Improvements {#phase-1}

**Purpose:** Fix three correctness and usability issues in the beads integration: move `.beads/` into worktrees for full isolation, make `beads sync` idempotent via plan-filename-based matching, and improve bead naming with plan-slug-derived prefixes.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-02-22 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current beads integration has three interrelated problems. First, `.beads/` is initialized at the repo root, meaning all worktrees share a single database and implementation work leaks state into the main checkout. Second, running `tugcode beads sync` twice creates duplicate beads because the system relies on bead IDs stored in plan files, but sync no longer writes IDs back to plan files. Third, bead IDs use the project name as prefix (e.g., `tugtool-imw`), which wastes characters that could carry meaningful context like the plan slug.

These issues undermine the core promise that `/tugplug:implement` runs are fully isolated to their worktree. Fixing them requires changes to worktree creation, the sync algorithm, the `BeadsCli` API, and the `bd-fake` test mock.

#### Strategy {#strategy}

- Fix worktree isolation first (most impactful correctness fix): init `.beads/` inside the worktree, not at repo root
- Standalone `tugcode beads sync` outside worktrees errors out, directing users to worktrees (clean break, no backward compatibility)
- Fix idempotency second: replace bead-ID-based matching with title-based matching in sync, status, and pull
- Fix naming last: pass `--prefix` derived from full plan slug to `bd init`
- Each fix is a separate step with independent tests and checkpoints
- Un-ignore existing broken tests and add new ones for each fix

#### Stakeholders / Primary Customers {#stakeholders}

1. Implementation agents that run in worktrees and rely on beads for step tracking
2. Developers running `tugcode worktree create` to set up isolated implementation environments

#### Success Criteria (Measurable) {#success-criteria}

- Running `tugcode beads sync` twice in a worktree produces exactly the same bead count (no duplicates)
- After `tugcode worktree create`, no `.beads/` directory exists at repo root; it exists only inside the worktree
- Bead IDs use plan-slug-derived prefixes (e.g., `auth-imw` for `tugplan-auth.md`)
- All four previously-ignored beads tests are un-ignored and passing: `test_beads_sync_is_idempotent`, `test_beads_status_computes_readiness`, `test_beads_pull_updates_checkboxes`, `test_full_beads_workflow_sync_work_pull`
- Running any `tugcode beads` subcommand outside a worktree returns E013 with a message directing users to `tugcode worktree create`
- Merge flow has no infrastructure save/restore/backup/discard/auto-resolve logic — any dirty tracked files on main block merge with a clear message

#### Scope {#scope}

1. Move `.beads/` initialization from repo root into worktree path
2. Replace ID-based bead matching in sync, status, and pull with title-based matching via `bd list --title-contains`
3. Add `--prefix` support to `BeadsCli::init()` and `bd-fake`
4. Make ALL beads subcommands worktree-only (sync, status, pull, link, close, inspect, update-notes, append-notes, append-design)
5. Add `.beads/` to `.gitignore` and delete existing `.beads/` from repo root
6. Fix `bd ready` call to pass worktree path
7. Un-ignore and update all previously-ignored tests (including pull and workflow tests)
8. Update CLI help text and module docs to remove references to writing bead IDs to plan files
9. Update merge SKILL.md to remove `.beads/` from infrastructure diff description

#### Non-goals (Explicitly out of scope) {#non-goals}

- Backward compatibility for standalone beads commands outside worktrees
- Writing bead IDs back into plan files (policy remains: plan files are never modified by sync; title-based resolution replaces ID-based lookups everywhere)
- Upstream changes to the real `bd` binary (only `bd-fake` is modified)

#### Dependencies / Prerequisites {#dependencies}

- The `bd list --title-contains` and `--parent` flags must be supported (real `bd` already supports them; will be added to `bd-fake`)
- The `bd init --prefix` flag must be supported (will be added to `bd-fake`; real `bd` already supports it)

#### Constraints {#constraints}

- All changes must pass `-D warnings` (warnings are errors per project policy)
- All existing non-ignored tests must continue to pass
- `bd-fake` must remain a bash script (no compiled dependencies for test infrastructure)

#### Assumptions {#assumptions}

- The `bd list` command supports `--title-contains` (case-insensitive substring) and `--parent` filters for server-side matching
- Worktree `.beads/` databases are disposable and get cleaned up with the worktree
- The `bd ready` call at `worktree.rs` line 818 needs to pass `Some(&worktree_path)` instead of `None`
- `.beads/` will be added to `.gitignore` at repo root
- Plan filenames rarely change after creation, making them stable matching keys for idempotency

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Plan title changes between syncs | med | low | Accept orphaned beads; title changes are rare | If title changes become common |
| `bd list --title-contains` returns unexpected matches | med | low | Use specific enough titles; per-worktree DBs are small | If false positives observed in testing |

**Risk R01: Orphaned beads after title changes** {#r01-orphaned-beads}

- **Risk:** If a plan or step title changes between syncs, a new bead is created and the old one becomes orphaned.
- **Mitigation:**
  - Match on plan filename (not title) for root bead resolution, which is more stable
  - Step titles rarely change after initial plan creation
  - Orphaned beads are a cosmetic issue, not a correctness issue
- **Residual risk:** Manual cleanup may occasionally be needed for renamed plans.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Init beads in worktree, not repo root (DECIDED) {#d01-beads-in-worktree}

**Decision:** `bd init` runs against the worktree path, creating `.beads/` inside the worktree directory. The repo root never has `.beads/`.

**Rationale:**
- Implementation runs should be fully isolated to their worktree
- Shared `.beads/` at repo root leaks state between implementations
- `.beads/` is disposable and gets cleaned up with the worktree

**Implications:**
- All `BeadsCli` calls from worktree context must pass worktree path as `working_dir`
- `is_initialized()` no longer walks parent directories; checks only the given path
- The `bd ready` call at line 818 of `worktree.rs` must pass `Some(&worktree_path)`

#### [D02] ALL beads commands are worktree-only (DECIDED) {#d02-no-standalone-sync}

**Decision:** Every beads subcommand (`sync`, `status`, `pull`, `link`, `close`, `inspect`, `update-notes`, `append-notes`, `append-design`) requires a worktree context. Running any beads command outside a worktree errors out with E013 directing users to `tugcode worktree create`.

**Rationale:**
- The primary (and only real) use case is worktree-based beads operations
- Maintaining backward compatibility for standalone beads commands adds complexity with no benefit
- Clean break simplifies the codebase -- no ambiguity about which commands work where

**Implications:**
- All seven beads command files must have a worktree guard: `sync.rs`, `status.rs`, `pull.rs`, `link.rs`, `close.rs`, `inspect.rs`, `update.rs`
- Files that already have an unconditional `beads.is_initialized(&project_root)` check: `sync.rs` (line 84), `pull.rs` (line 60) -- their E013 messages must be updated
- Files that need an unconditional `is_initialized` check added: `link.rs`, `close.rs`, `inspect.rs`, `update.rs`, `status.rs`
- `link.rs` (line 64-80) has a CONDITIONAL check inside `if config.tugtool.beads.enabled && config.tugtool.beads.validate_bead_ids` -- if `validate_bead_ids` is false, link proceeds without any worktree guard. An unconditional early guard must be added BEFORE the config-gated validation block
- `close.rs` calls `beads.close(&bead_id, ..., None)` at line 40 -- `None` must become `working_dir`
- `inspect.rs` already accepts `working_dir` parameter but lacks `is_initialized` guard
- `update.rs` already accepts `working_dir` parameter but lacks `is_initialized` guard
- Agents calling beads commands must be in a worktree context (which they already are)

#### [D03] Title-based matching via `bd list --title-contains` for idempotent sync (DECIDED) {#d03-filename-matching}

**Decision:** Resolve beads by title using the `bd list --title-contains <title> --json --limit 1` command, which performs case-insensitive substring search server-side. For step beads, additionally filter by `--parent <root_id>`. This replaces the previously considered approach of fetching all beads client-side.

**Rationale:**
- Bead IDs are not stored in plan files, so cannot be used for matching
- Plan filenames rarely change after creation, making them stable matching keys
- The beads database itself becomes the source of truth
- `bd list` natively supports `--title-contains` (case-insensitive substring) and `--parent` filters, so matching can be done server-side in a single call rather than fetching all beads and filtering client-side
- Using `--limit 1` keeps queries efficient
- Per-worktree databases (from D01) ensure title uniqueness: each worktree has exactly one plan's beads, so substring matches cannot bind to wrong beads

**Implications:**
- Root bead title must include the plan phase title for stable matching
- A single new `BeadsCli::find_by_title(title, parent, working_dir)` method wraps `bd list --title-contains <title> [--parent <parent>] --json --limit 1` and returns `Option<Issue>`
- Root resolution: `find_by_title(&phase_title, None, working_dir)` -- no parent filter needed since root beads have no parent
- Step resolution: `find_by_title(&step_title, Some(&root_id), working_dir)` -- `--parent` scopes to children of the root bead
- `bd-fake` `cmd_list` must support `--title-contains` (substring match) and `--parent` (ID prefix match) filters

#### [D04] Full slug for prefix derivation (DECIDED) {#d04-full-slug-prefix}

**Decision:** Derive the `bd init --prefix` from the full plan slug: everything after `tugplan-` and before `.md`. For example, `tugplan-user-auth-system.md` produces prefix `user-auth-system`.

**Rationale:**
- Full slug preserves maximum context in bead IDs
- The `derive_tugplan_slug()` function already extracts this correctly
- Short slugs could collide across plans

**Implications:**
- `BeadsCli::init()` gains an optional `prefix` parameter
- `bd-fake` must accept `--prefix` and use it in ID generation
- Bead IDs become self-documenting (e.g., `user-auth-system-imw` for plan `tugplan-user-auth-system.md`)

#### [D05] Title and parent filters in bd-fake list command (DECIDED) {#d05-list-filters}

**Decision:** Extend `bd-fake`'s existing `cmd_list` to support `--title-contains` (case-insensitive substring match on title) and `--parent` (filter to children of a specific bead by ID prefix matching) flags, matching the real `bd list --title-contains` and `--parent` behavior.

**Rationale:**
- The idempotent sync algorithm uses `bd list --title-contains` and `--parent` for bead resolution
- `bd-fake` already has a `cmd_list` function; adding filters to it is simpler than adding a separate `children` command
- Real `bd` already supports these flags on `bd list`

**Implications:**
- `bd-fake` `cmd_list` gains `--title-contains` and `--parent` flag parsing and filtering logic
- No separate `cmd_children` is needed -- `bd list --parent <id>` covers the same use case
- Tests can verify idempotent sync behavior deterministically

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Worktree Beads Lifecycle {#worktree-beads-lifecycle}

**Current flow (broken):**
1. `worktree create` calls `beads.init(&repo_root)` at line 595-596, BEFORE worktree directory exists
2. `beads sync` runs in worktree but `bd` finds `.beads/` in parent via walk-up
3. All worktrees share a single `.beads/` database

**New flow:**
1. `worktree create` creates the worktree directory first (via `create_worktree()`)
2. After worktree exists (around current line 679, after `create_worktree()` returns), call `beads.init_with_prefix(&worktree_path, Some(&slug))`
3. `beads sync` runs in worktree, `bd` finds local `.beads/`
4. Each worktree has its own isolated `.beads/` database

**Critical timing detail:** The current `beads.init()` call at lines 574-605 runs BEFORE `create_worktree()` at line 642. Since we are moving `.beads/` into the worktree, the init must move to AFTER `create_worktree()` succeeds, inside the `Ok((worktree_path, ...))` match arm. The old pre-worktree beads init block (lines 574-605) must be removed entirely.

**Rollback on beads init failure:** If `beads.init_with_prefix()` fails after `create_worktree()` succeeds, the worktree must be rolled back via `rollback_worktree_creation(&worktree_path, &branch_name, &repo_root)`. This follows the existing rollback pattern used elsewhere in `worktree.rs` (lines 660, 673, 707, etc.).

**Merge workflow simplification:** Moving `.beads/` into worktrees and adding it to `.gitignore` eliminates the original reason for the complex "infrastructure file" handling in `merge.rs`. The entire infrastructure machinery — save/restore/backup/discard/auto-resolve — is over-engineering. Replace it with a simple dirty-file check: if any tracked files on main are dirty, bail with a list and a message telling the user to commit before merging. This is a no-op most of the time, but prevents work loss.

**Functions to DELETE entirely from `merge.rs`:**
- `is_infrastructure_path()` (line 219) — no infra/non-infra distinction needed
- `check_infra_diff()` (lines 328-355) — infrastructure diff preflight warning
- `prepare_main_for_merge()` (lines 447-539) — auto-commit/discard of infra files
- `try_auto_resolve_conflicts()` (lines 634-697) — auto-resolve infra merge conflicts
- `save_infra_to_temp()` (lines 703-738) — temp backup of infra files
- `copy_infra_from_temp()` (lines 745-773) — copy infra from temp
- `restore_infra_from_temp()` (lines 781-828) — restore and commit infra from temp
- `TempDirGuard` struct and `Drop` impl (lines 836-865) — RAII guard for temp backup

**Inline code to simplify:**
- The 30-line infra/non-infra partitioning (lines 1121-1151) → simple "any dirty tracked files? bail"
- Remote mode save/discard/restore dance (lines 1267-1434) → removed entirely; `git fetch + reset --hard` is safe when main is clean
- Local mode `prepare_main_for_merge` call (lines 1441-1444) → removed; main is already clean
- `squash_merge_branch` conflict auto-resolution (lines 555-582) → conflicts just fail with `git reset --merge`
- Infra-diff preflight warning (line 434) → removed
- Post-merge infra sync (lines 1539-1577) → removed
- Dry-run infra file reporting (lines 1228-1233) → removed (dirty files block merge, so there are none to report)

**Tests to DELETE:**
- All tests creating `.beads/` files for infrastructure handling
- `test_save_infra_to_temp`, `test_copy_infra_from_temp`, `test_restore_infra_from_temp`, `test_save_infra_nested_dirs`
- `test_check_infra_diff_with_tug_changes`
- `test_merge_allows_infra_only_dirty_files` (no longer a concept — all dirty files block)
- `test_squash_merge_auto_resolves_infrastructure_conflicts`
- `test_targeted_infra_discard`
- `test_infra_restored_on_merge_failure`, `test_infra_restored_on_pull_failure`
- `TempDirGuard` drop/defuse tests

**New behavior:** Any dirty tracked files on main → bail with file list + "Please commit or stash these changes before merging." Untracked files remain a non-blocking warning. No infra/non-infra distinction. No auto-handling.

**Merge SKILL.md:** Remove `.beads/` from infrastructure diff description and update to reflect the simplified dirty-file check.

#### 1.0.1.2 Idempotent Sync Algorithm {#idempotent-sync-algorithm}

**Root bead resolution:**
1. Call `beads.find_by_title(&phase_title, None, working_dir)` -- wraps `bd list --title-contains <phase_title> --json --limit 1`
2. If found (returns `Some(issue)`), reuse its ID; if `None`, create it

Note: `list_by_ids()` cannot be used because we do not have IDs to search for. `find_by_title()` uses `--title-contains` for case-insensitive substring matching and `--limit 1` to return at most one result.

**Step bead resolution:**
1. For each step in the plan, call `beads.find_by_title(&step_title, Some(&root_id), working_dir)` -- wraps `bd list --title-contains <step_title> --parent <root_id> --json --limit 1`
2. The `--parent` flag scopes the search to children of the root bead
3. If found, reuse it; if not, create it

**Key invariant:** Running sync N times produces the same set of beads as running it once.

**Title uniqueness guarantee:** Per-worktree databases ensure title matching is safe from false positives. Each worktree is created for a single plan, so the worktree's `.beads/` database contains only that plan's beads. There is no risk of `--title-contains` binding to beads from a different plan because no other plan's beads exist in the same database. This is a direct consequence of [D01] worktree isolation.

**Note on bead ID hash length:** Bead IDs use an adaptive hash suffix: 4 characters for small databases (0-500 issues), 5 for medium, 6+ for large. The `min_hash_length` and `max_hash_length` are configurable via `bd config`. Per-worktree databases will be small, so expect 4-character suffixes (e.g., `auth-imw` has a 3-char hash portion after the prefix).

#### 1.0.1.3 Standalone Beads Command Errors {#standalone-sync-error}

ALL beads subcommands must error when run outside a worktree. The seven command files in `tugcode/crates/tugcode/src/commands/beads/` are:

**Already have unconditional `is_initialized` check (update E013 message):**
- `sync.rs` (line 84-91) -- calls `beads.is_initialized(&project_root)` unconditionally
- `pull.rs` (line 60-67) -- calls `beads.is_initialized(&project_root)` unconditionally

**Need unconditional `is_initialized` check added:**
- `link.rs` -- existing check at line 64-80 is CONDITIONAL (gated on `config.tugtool.beads.enabled && config.tugtool.beads.validate_bead_ids`); if `validate_bead_ids` is false, link proceeds without any worktree guard. An unconditional early guard must be added BEFORE the config-gated block
- `close.rs` -- no check; also needs `working_dir` threading for `beads.close()` at line 40
- `inspect.rs` -- no check; already accepts `working_dir` parameter
- `update.rs` -- no check; three entry points (`run_update_notes`, `run_append_notes`, `run_append_design`) all need the guard; already accept `working_dir`
- `status.rs` -- no check; needs `is_initialized` guard added before bead queries

**Guard semantics for `--working-dir`:** Commands that accept `--working-dir` (inspect, update, close) may be invoked from the main checkout with an explicit worktree path. The guard must check `is_initialized(working_dir)` when `--working-dir` is provided, falling back to `is_initialized(&project_root)` when not. This way, agents running from the orchestrator context can pass `--working-dir /path/to/worktree` and the guard succeeds if that worktree has `.beads/`.

Detection is natural: `is_initialized()` checks only the given path (no walk-up), and since `.beads/` only exists inside worktrees, it returns false at repo root but true at a valid worktree path.

The E013 error message must be updated from `"beads not initialized (run 'bd init')"` to `"beads not initialized. Run: tugcode worktree create <plan>"`.

The `is_installed(None)` checks across all files should also pass `working_dir` for consistency.

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 Modified Symbols {#modified-symbols}

| Symbol | Kind | Location | Change |
|--------|------|----------|--------|
| `BeadsCli::init` | fn | `beads.rs` | Add optional `prefix: Option<&str>` parameter, pass as `--prefix` to `bd init` |
| `BeadsCli::is_initialized` | fn | `beads.rs` | Remove walk-up logic; check only given path |
| `ensure_root_bead` | fn | `sync.rs` | Replace ID-based check with title-based matching via `find_by_title()` |
| `ensure_step_bead` | fn | `sync.rs` | Replace ID-based check with title-based matching via `find_by_title()` with `--parent` |
| `ensure_substep_bead` | fn | `sync.rs` | Replace ID-based check with title-based matching via `find_by_title()` with `--parent` |
| `sync_plan_to_beads` | fn | `sync.rs` | Remove `known_ids`/`existing_ids` phases; add title-based resolution |
| `run_sync` | fn | `sync.rs` | Add worktree-only guard; update E013 message to direct users to worktrees |
| `run_worktree_create_with_root` | fn | `worktree.rs` (CLI) | Move `beads.init()` to after worktree creation (around line 679); change to `beads.init_with_prefix(&worktree_path, ...)` |
| `sync_dependencies` | fn | `sync.rs` | Pass `working_dir` to `dep_list`, `dep_add`, `dep_remove` |
| `enrich_root_bead` | fn | `sync.rs` | Pass `working_dir` to bead update calls |
| `enrich_step_bead` | fn | `sync.rs` | Pass `working_dir` to bead update calls |
| `run_pull` | fn | `pull.rs` | Add title-based bead resolution (replacing `step.bead_id` reads); update E013 message |
| `pull_bead_status_to_checkboxes` | fn | `pull.rs` | Replace `step.bead_id` reads with title-based lookup via `find_by_title()`; thread `working_dir` |
| `run_link` | fn | `link.rs` | Add unconditional `is_initialized` guard before config-gated validation; update E013 message |
| `get_file_beads_status` | fn | `status.rs` | Replace `step.bead_id` / `plan.metadata.beads_root_id` reads with title-based bead lookup via `find_by_title()` |
| `run_close` | fn | `close.rs` | Add `is_initialized` guard; thread `working_dir` to `beads.close()` |
| `run_inspect` | fn | `inspect.rs` | Add `is_initialized` guard with E013 worktree message |
| `run_update_notes` | fn | `update.rs` | Add `is_initialized` guard with E013 worktree message |
| `run_append_notes` | fn | `update.rs` | Add `is_initialized` guard with E013 worktree message |
| `run_append_design` | fn | `update.rs` | Add `is_initialized` guard with E013 worktree message |
| `TugError::BeadsNotInitialized` | variant | `error.rs` | Update Display text to direct users to `tugcode worktree create` |
| `BeadsCommands` | enum | `beads/mod.rs` | Update help text and doc comments to remove bead-ID-to-plan-file references; reflect worktree-only usage |
| module docs | comment | `beads/mod.rs` | Update to remove `.beads/ initialized` prerequisite; replace with worktree requirement |
| `squash_merge_branch` | fn | `merge.rs` | Remove `try_auto_resolve_conflicts` call — conflicts just fail with `git reset --merge` |
| `run_merge` | fn | `merge.rs` | Replace infra/non-infra partitioning with simple dirty-file check; remove save/restore/prepare calls; remove post-merge infra sync |
| merge SKILL.md | doc | `tugplug/skills/merge/SKILL.md` | Remove `.beads/` from infrastructure diff description; update to reflect simplified dirty-file check |
| `cmd_init` | fn | `bd-fake` | Accept `--prefix` flag and use in ID generation |
| `cmd_list` | fn | `bd-fake` | Add `--title-contains` (case-insensitive substring match) and `--parent` (ID prefix match) filter support |
| `next_id` | fn | `bd-fake` | Use prefix from init instead of hardcoded `bd-fake` |

#### 1.0.2.2 New Symbols {#new-symbols}

| Symbol | Kind | Location | Purpose |
|--------|------|----------|---------|
| `BeadsCli::init_with_prefix` | fn | `beads.rs` | Init beads with optional prefix parameter |
| `BeadsCli::find_by_title` | fn | `beads.rs` | Find a bead by title substring match, optionally scoped to a parent; wraps `bd list --title-contains <title> [--parent <parent>] --json --limit 1`, returns `Result<Option<Issue>>` |
| `resolve_beads_for_status` | fn | `status.rs` | Query beads DB via `find_by_title()` to build anchor-to-bead-ID map and resolve root bead, replacing `step.bead_id` / `plan.metadata.beads_root_id` reads |
| `resolve_beads_for_pull` | fn | `pull.rs` | Query beads DB via `find_by_title()` to build anchor-to-bead-ID map for pull, replacing `step.bead_id` reads |

#### 1.0.2.3 Deleted Symbols {#deleted-symbols}

| Symbol | Kind | Location | Reason |
|--------|------|----------|--------|
| `is_infrastructure_path` | fn | `merge.rs` line 219 | No infra/non-infra distinction needed — all dirty tracked files block merge |
| `check_infra_diff` | fn | `merge.rs` line 328 | Infrastructure diff preflight warning removed |
| `prepare_main_for_merge` | fn | `merge.rs` line 447 | Auto-commit/discard of infra files removed — dirty files just block |
| `try_auto_resolve_conflicts` | fn | `merge.rs` line 634 | Auto-resolve of infra merge conflicts removed — conflicts just fail |
| `save_infra_to_temp` | fn | `merge.rs` line 703 | Temp backup machinery removed |
| `copy_infra_from_temp` | fn | `merge.rs` line 745 | Temp restore machinery removed |
| `restore_infra_from_temp` | fn | `merge.rs` line 781 | Temp restore + commit machinery removed |
| `TempDirGuard` | struct + impl | `merge.rs` line 836 | RAII guard for temp backup removed |
| inline `is_infrastructure` closure | closure | `merge.rs` line 655 | Was inside `try_auto_resolve_conflicts` — deleted with parent |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `is_initialized` without walk-up, `init_with_prefix` argument passing | Core logic changes |
| **Integration** | Test end-to-end sync idempotency, worktree isolation, naming | Full workflow verification |

#### Key Test Scenarios {#key-test-scenarios}

1. **Idempotency:** Two syncs produce same bead count (un-ignore `test_beads_sync_is_idempotent`)
2. **Worktree isolation:** After worktree create, no `.beads/` at repo root
3. **Prefix naming:** `bd-fake` uses prefix in generated IDs
4. **Standalone error:** Any `tugcode beads` subcommand outside worktree returns error
5. **Status readiness:** Un-ignore `test_beads_status_computes_readiness` and update to work with new sync
6. **Pull via title resolution:** Un-ignore `test_beads_pull_updates_checkboxes` -- pull resolves beads by title instead of reading `step.bead_id`
7. **Full workflow:** Un-ignore `test_full_beads_workflow_sync_work_pull` -- end-to-end sync-work-pull cycle with title-based resolution

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Move `.beads/` into worktrees and add `.beads/` to `.gitignore` {#step-0}

**Commit:** `fix(beads): init .beads/ in worktree instead of repo root`

**References:** [D01] Init beads in worktree not repo root, [D02] No standalone sync outside worktrees, (#worktree-beads-lifecycle, #context, #standalone-sync-error)

**Artifacts:**
- Modified `beads.rs`: `is_initialized()` checks only given path (no walk-up), new `init_with_prefix()` method
- Modified `worktree.rs` (CLI): Remove pre-worktree beads init block (lines 574-605); add `beads.init(&worktree_path)` after `create_worktree()` succeeds (inside the `Ok(...)` arm around line 679)
- Modified `worktree.rs` (CLI): `bd.ready()` call passes `Some(&worktree_path)` instead of `None`
- Modified `sync.rs`: All `beads.*()` calls pass `working_dir` parameter -- this includes the three `beads.create()` calls in `ensure_root_bead`, `ensure_step_bead`, and `ensure_substep_bead` (all currently pass `None`), plus `list_by_ids`, `dep_list`, `dep_add`, `dep_remove`, `update_description`, `update_design`, `update_acceptance`, and `is_installed`
- Modified `sync.rs`: E013 message updated to `"beads not initialized. Run: tugcode worktree create <plan>"`
- Modified `pull.rs`: E013 message updated to direct users to worktrees
- Modified `link.rs`: Add unconditional `is_initialized` guard before the config-gated validation block (existing check at lines 64-80 is conditional on `validate_bead_ids`)
- Modified `close.rs`: Add `is_initialized` guard and thread `working_dir` to `beads.close()` call
- Modified `inspect.rs`: Add `is_initialized` guard with E013 worktree message
- Modified `update.rs`: Add `is_initialized` guard to all three entry points (`run_update_notes`, `run_append_notes`, `run_append_design`)
- Modified `status.rs`: Add `is_initialized` guard with E013 worktree message
- Modified `error.rs`: Update `TugError::BeadsNotInitialized` Display text from `"run 'bd init'"` to `"Run: tugcode worktree create <plan>"`
- Modified `.gitignore`: Add `.beads/` entry
- Deleted `.beads/` directory at repo root via `git rm -r .beads/` (all git-tracked files removed from version control)

**Tasks:**

*Part A — Core beads.rs changes and worktree init flow:*
- [ ] Remove walk-up logic from `BeadsCli::is_initialized()` -- check only `project_root.join(".beads").is_dir()`
- [ ] Add `init_with_prefix()` method to `BeadsCli` that accepts `prefix: Option<&str>` and passes `--prefix` to `bd init`
- [ ] In `worktree.rs` (CLI): remove the entire pre-worktree beads init block (lines 574-605) and move `beads.init(&worktree_path)` to after `create_worktree()` returns successfully, inside the `Ok((worktree_path, branch_name, _plan_slug))` arm (around line 679, before `sync_beads_in_worktree`)
- [ ] Fix `bd.ready()` call at worktree.rs line 818 to pass `Some(&worktree_path)` instead of `None`
- [ ] Add `beads.init()` failure rollback in `worktree.rs`: if `beads.init_with_prefix()` fails after `create_worktree()` succeeds, call `rollback_worktree_creation(&worktree_path, &branch_name, &repo_root)` before returning the error (follow the existing rollback pattern at lines 660, 673, 707, etc.)

*Part B — Thread working_dir through sync.rs:*
- [ ] Add `SyncContext.working_dir: Option<&'a Path>` field and thread it through ALL beads calls in sync.rs, including:
  - `beads.is_installed(None)` at sync.rs line 73
  - `beads.is_initialized(&project_root)` at sync.rs line 84
  - `beads.list_by_ids(&known_ids, None)` at sync.rs line 275
  - `beads.create(... None)` in `ensure_root_bead` at sync.rs line 462
  - `beads.create(... None)` in `ensure_step_bead` at sync.rs line 517
  - `beads.create(... None)` in `ensure_substep_bead` at sync.rs line 589
  - `beads.dep_list(bead_id, None)` in `sync_dependencies` at sync.rs line 628
  - `beads.dep_add(bead_id, dep_bead_id, None)` at sync.rs line 636
  - `beads.dep_remove(bead_id, &dep.id, None)` at sync.rs line 653
  - `beads.update_description(root_id, ..., None)` in `enrich_root_bead` at sync.rs line 736
  - `beads.update_design(root_id, ..., None)` at sync.rs line 744
  - `beads.update_acceptance(root_id, ..., None)` at sync.rs line 752
  - `beads.update_description(bead_id, ..., None)` in `enrich_step_bead` at sync.rs line 776
  - `beads.update_acceptance(bead_id, ..., None)` at sync.rs line 788
  - `beads.update_design(bead_id, ..., None)` at sync.rs line 798
- [ ] Note: Step 1 will further modify `ensure_root_bead`, `ensure_step_bead`, `ensure_substep_bead`, and `sync_plan_to_beads` to replace ID-based matching with title-based matching. The working_dir threading done here provides the foundation for those changes.

*Part C — Add worktree-only guards to all beads command files:*
- [ ] Update E013 error message in `sync.rs` (line 88) from `"beads not initialized (run 'bd init')"` to `"beads not initialized. Run: tugcode worktree create <plan>"`
- [ ] Update E013 error message in `pull.rs` (line 64) similarly
- [ ] Add unconditional `is_initialized` guard to `link.rs`: the existing check at lines 64-80 is CONDITIONAL (inside `if config.tugtool.beads.enabled && config.tugtool.beads.validate_bead_ids`). Add an early unconditional `beads.is_initialized(&project_root)` check BEFORE the config-gated validation block, returning E013 with the worktree message if not initialized
- [ ] Add `is_initialized` guard to `close.rs`: after `is_installed` check, add `beads.is_initialized(&project_root)` check returning E013 with worktree message; thread `working_dir` to `beads.close(&bead_id, ..., None)` at line 40
- [ ] Add `is_initialized` guard to `inspect.rs`: after `is_installed` check (line 55), add `beads.is_initialized(&project_root)` check returning E013; `working_dir` is already threaded
- [ ] Add `is_initialized` guard to `update.rs`: all three functions (`run_update_notes`, `run_append_notes`, `run_append_design`) need the guard after their `is_installed` check; `working_dir` is already threaded
- [ ] Add `is_initialized` guard to `status.rs`: add check before file processing loop (around line 94)
- [ ] Update `TugError::BeadsNotInitialized` Display impl in `error.rs` (line 64): change from `"E013: Beads not initialized in project (run \`bd init\`)"` to `"E013: Beads not initialized. Run: tugcode worktree create <plan>"`

*Part D — Git cleanup:*
- [ ] Delete the existing `.beads/` directory at the repo root via `git rm -r .beads/` (removes all git-tracked files from version control and stages the deletion; verify with `git ls-files .beads/` first to confirm scope)
- [ ] Add `.beads/` to root `.gitignore`

**Tests:**
- [ ] Unit test: `is_initialized()` returns false when `.beads/` exists only in parent directory
- [ ] Unit test: `is_initialized()` returns true when `.beads/` exists in given directory
- [ ] Integration test: `test_beads_sync_in_worktree_does_not_touch_repo_root` -- after worktree create, verify no `.beads/` at repo root

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run`
- [ ] Verify `.beads/` is in `.gitignore`
- [ ] Verify `is_initialized()` does not walk parent directories

**Rollback:**
- Revert commit; restore walk-up logic in `is_initialized()`

**Commit after all checkpoints pass.**

---

#### Step 1: Make beads sync idempotent via title-based matching {#step-1}

**Depends on:** #step-0

**Commit:** `fix(beads): make sync idempotent via title-based matching`

**References:** [D03] Title-based matching via bd list --title-contains for idempotent sync, [D05] Title and parent filters in bd-fake list command, (#idempotent-sync-algorithm, #modified-symbols, #new-symbols, #key-test-scenarios)

**Artifacts:**
- Modified `beads.rs`: New `BeadsCli::find_by_title()` method wrapping `bd list --title-contains <title> [--parent <parent>] --json --limit 1`
- Modified `sync.rs`: `sync_plan_to_beads()` uses `find_by_title()` for title-based resolution instead of `known_ids`/`existing_ids`
- Modified `status.rs`: New `resolve_beads_for_status()` function; `get_file_beads_status()` resolves bead IDs via `find_by_title()` instead of reading `step.bead_id` (always `None`) and `plan.metadata.beads_root_id` (always `None`)
- Modified `pull.rs`: New `resolve_beads_for_pull()` function; `pull_bead_status_to_checkboxes()` resolves bead IDs via `find_by_title()` instead of reading `step.bead_id` (always `None`); `is_bead_complete()` passes `working_dir`
- Modified `bd-fake`: `cmd_list` gains `--title-contains` and `--parent` filter support
- Modified `beads_integration_tests.rs`: Un-ignore `test_beads_sync_is_idempotent`, `test_beads_pull_updates_checkboxes`, and `test_full_beads_workflow_sync_work_pull`; update assertions for title-based resolution

**Tasks:**
- [ ] Add `BeadsCli::find_by_title(title: &str, parent: Option<&str>, working_dir: Option<&Path>)` method to `beads.rs`: wraps `bd list --title-contains <title> [--parent <parent>] --json --limit 1`, returns `Result<Option<Issue>>`. This single method replaces the previously proposed `list_all()`, `find_root_bead_by_title()`, and `find_step_bead_by_title()` -- the matching is done server-side by `bd`
- [ ] Update `bd-fake` `cmd_list` to support `--title-contains <substring>` flag: case-insensitive substring match on issue title field when filtering `issues.json`
- [ ] Update `bd-fake` `cmd_list` to support `--parent <id>` flag: filter issues whose ID starts with `$parent.` prefix (matching the parent-child ID hierarchy)
- [ ] Refactor `sync_plan_to_beads()`: remove `known_ids` and `existing_ids` phases; use `beads.find_by_title(&phase_title, None, working_dir)` for root resolution, and `beads.find_by_title(&step_title, Some(&root_id), working_dir)` for each step
- [ ] Update `ensure_root_bead()` to call `find_by_title()` for root resolution; if found, reuse; if not, create
- [ ] Update `ensure_step_bead()` to call `find_by_title()` with `parent: Some(&root_id)` for step resolution
- [ ] Update `ensure_substep_bead()` similarly, with `parent: Some(&step_id)`
- [ ] Refactor `get_file_beads_status()` in `status.rs` to resolve bead IDs via title-based lookup instead of reading `step.bead_id` from the plan:
  - Add a `resolve_beads_for_status()` helper that calls `beads.find_by_title(&phase_title, None, working_dir)` to find the root bead, then for each step calls `beads.find_by_title(&step_title, Some(&root_id), working_dir)`, building an `anchor -> bead_id` map
  - Replace the first pass (lines 171-183) which reads `step.bead_id` (always `None`) with a call to `resolve_beads_for_status()` that populates `bead_statuses` from the beads DB
  - Replace `plan.metadata.beads_root_id.clone()` at line 240 with the root bead ID resolved by title-based matching
  - Thread `working_dir` into `get_file_beads_status()` so beads queries target the worktree's `.beads/` database
  - Update `is_installed(None)` at status.rs line 63 to pass `working_dir`
- [ ] Refactor `pull_bead_status_to_checkboxes()` in `pull.rs` to resolve bead IDs via title-based lookup instead of reading `step.bead_id` from the plan:
  - Add a `resolve_beads_for_pull()` helper (or reuse the pattern from `resolve_beads_for_status()`) that calls `beads.find_by_title(&phase_title, None, working_dir)` to find the root bead, then for each step calls `beads.find_by_title(&step_title, Some(&root_id), working_dir)`, returning a map of `anchor -> bead_id`
  - Replace the `if let Some(ref bead_id) = step.bead_id` guard at line 172 with a lookup into the resolved map
  - Do the same for substep resolution at line 193
  - Thread `working_dir` into `pull_bead_status_to_checkboxes()` and `is_bead_complete()` (line 217 passes `None` to `beads.show()`)
- [ ] Un-ignore `test_beads_sync_is_idempotent` and verify it passes with title-based matching
- [ ] Un-ignore `test_beads_status_computes_readiness` and update to work with new sync flow (status now resolves beads by title, so the test must verify that status returns non-Pending results after sync)
- [ ] Un-ignore `test_beads_pull_updates_checkboxes` and update to work with title-based resolution (pull now resolves beads by title instead of reading `step.bead_id`)
- [ ] Un-ignore `test_full_beads_workflow_sync_work_pull` and update to work with title-based resolution end-to-end

**Tests:**
- [ ] Integration test: `test_beads_sync_is_idempotent` -- two syncs produce same bead count (un-ignored)
- [ ] Integration test: `test_beads_status_computes_readiness` -- status correctly computes readiness (un-ignored)
- [ ] Integration test: `test_beads_pull_updates_checkboxes` -- pull correctly updates checkboxes via title-based resolution (un-ignored)
- [ ] Integration test: `test_full_beads_workflow_sync_work_pull` -- full sync-work-pull cycle works end-to-end (un-ignored)
- [ ] Integration test: `test_beads_sync_idempotent_with_title_matching` -- explicit test that sync reuses existing beads by title

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run`
- [ ] Run sync twice on a test plan and verify bead count is identical

**Rollback:**
- Revert commit; re-ignore the four tests

**Commit after all checkpoints pass.**

---

#### Step 2: Better bead naming with plan-slug-derived prefixes {#step-2}

**Depends on:** #step-0

**Commit:** `feat(beads): use plan-slug-derived prefix for bead IDs`

**References:** [D04] Full slug for prefix derivation, (#new-symbols, #modified-symbols)

**Artifacts:**
- Modified `worktree.rs` (CLI): Pass plan slug as prefix to `beads.init_with_prefix()`
- Modified `bd-fake`: `cmd_init` accepts `--prefix`, stores prefix in state; `next_id` uses stored prefix
- Modified `beads_integration_tests.rs`: Update assertions to expect slug-based prefixes

**Tasks:**
- [ ] Update `bd-fake` `cmd_init` to accept `--prefix <name>` flag and store it in `$STATE_DIR/prefix.txt`
- [ ] Update `bd-fake` `next_id` to read prefix from `$STATE_DIR/prefix.txt` (default to `bd-fake` if not set)
- [ ] In worktree.rs (CLI), derive slug via `derive_tugplan_slug(&plan_path)` and pass to `beads.init_with_prefix(&worktree_path, Some(&slug))`
- [ ] Update integration tests that assert on `bd-fake-N` IDs to expect `<slug>-N` format

**Tests:**
- [ ] Unit test: `bd-fake init --prefix auth` followed by `bd-fake create` produces IDs with `auth-` prefix
- [ ] Integration test: worktree create with `tugplan-auth.md` produces bead IDs with `auth-` prefix

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run`
- [ ] Verify bead IDs use plan slug as prefix in test output

**Rollback:**
- Revert commit; `bd-fake` falls back to `bd-fake` prefix

**Commit after all checkpoints pass.**

---

#### Step 3: Simplify merge flow — remove infrastructure file machinery {#step-3}

**Depends on:** #step-0

**Commit:** `refactor(merge): simplify merge flow; remove infrastructure file machinery`

**References:** [D01] Init beads in worktree not repo root, (#deleted-symbols)

**Artifacts:**
- Modified `merge.rs`: Deleted 8 functions/structs (infrastructure handling machinery); simplified dirty-file check to bail on any dirty tracked files; simplified `squash_merge_branch` to let conflicts fail without auto-resolution
- Deleted merge.rs tests: ~12 tests for infrastructure save/restore/backup/discard/auto-resolve
- Modified `tugplug/skills/merge/SKILL.md`: Updated to reflect simplified dirty-file check

**Tasks:**

*Delete infrastructure handling functions:*
- [ ] Delete `is_infrastructure_path()` (line 219) — no infra/non-infra distinction needed
- [ ] Delete `check_infra_diff()` (lines 328-355) — infrastructure diff preflight warning removed
- [ ] Delete `prepare_main_for_merge()` (lines 447-539) — auto-commit/discard of infra files removed
- [ ] Delete `try_auto_resolve_conflicts()` (lines 634-697) — auto-resolve of infra merge conflicts removed
- [ ] Delete `save_infra_to_temp()` (lines 703-738) — temp backup machinery removed
- [ ] Delete `copy_infra_from_temp()` (lines 745-773) — temp copy machinery removed
- [ ] Delete `restore_infra_from_temp()` (lines 781-828) — temp restore + commit machinery removed
- [ ] Delete `TempDirGuard` struct and `Drop` impl (lines 836-865) — RAII guard removed

*Simplify merge flow:*
- [ ] Simplify `squash_merge_branch()` (lines 555-582): remove `try_auto_resolve_conflicts` call; on merge conflict, just `git reset --merge` and return error
- [ ] Simplify dirty-file check in `run_merge()` (lines 1117-1174): replace the 30-line infra/non-infra partitioning with a simple check — if any tracked modified files exist, bail with list + "Please commit or stash these changes before merging." Untracked files remain a non-blocking warning
- [ ] Remove remote mode save/discard/restore dance (lines 1267-1434): with main guaranteed clean, `git fetch + reset --hard origin/main` is safe without temp backup. Remove the `_guard`, `save_infra_to_temp`, discard loop, `restore_infra_from_temp`, and post-restore push
- [ ] Remove local mode `prepare_main_for_merge` call (lines 1441-1444): main is already clean
- [ ] Remove `check_infra_diff` preflight warning call (line 434)
- [ ] Remove post-merge infra sync (lines 1539-1577): no dirty infra files to commit after merge
- [ ] Remove dry-run infra file reporting (lines 1228-1233): dirty files block merge, so there are none to report in dry-run
- [ ] Remove `dirty_files` field from `MergeData` struct entirely — dirty tracked files now block before dry-run output is reached, so this field is always `None`. Remove the field from the struct definition, all construction sites, and update the merge skill's JSON parsing in `tugplug/skills/merge/SKILL.md` to remove `dirty_files` from the documented dry-run output fields table

*Delete tests for removed machinery:*
- [ ] Delete `test_save_infra_to_temp` (line 2966)
- [ ] Delete `test_copy_infra_from_temp` (line 3012)
- [ ] Delete `test_restore_infra_from_temp` (line 3057)
- [ ] Delete `test_save_infra_nested_dirs` (line 3164)
- [ ] Delete `test_check_infra_diff_with_tug_changes` (line 2670)
- [ ] Delete `test_squash_merge_auto_resolves_infrastructure_conflicts` (line 2291)
- [ ] Delete `test_merge_allows_infra_only_dirty_files` (line 3369) — no longer a concept; all dirty tracked files block
- [ ] Delete `test_targeted_infra_discard` (line 3651)
- [ ] Delete `test_infra_restored_on_merge_failure` (line 3849)
- [ ] Delete `test_infra_restored_on_pull_failure` (line 3900)
- [ ] Delete TempDirGuard tests (drop behavior, defuse behavior — around lines 3208, 3244)
- [ ] Update `test_merge_rejects_non_infra_dirty_files` (line 3282): rename to `test_merge_rejects_dirty_files` — now ALL dirty tracked files block, not just non-infra
- [ ] Update dry-run output test at line 1793 (`dirty_files: Some(vec![".beads/beads.jsonl"])`) — remove or update since dirty files now block before dry-run output
- [ ] Add new test: `test_merge_rejects_dirty_tugtool_files` — verify `.tugtool/` dirty files also block merge (previously they were auto-handled)
- [ ] Add new test: `test_merge_succeeds_with_clean_main` — verify merge works when main has no dirty files

*Merge SKILL.md and JSON contract:*
- [ ] Update merge SKILL.md: remove `.beads/` from "Infrastructure diff" description; remove "Infrastructure file differences" from the preflight warnings list; update dirty_files documentation to reflect that all dirty tracked files block the merge
- [ ] Verify dry-run JSON output fields consumed by the merge skill still match after `dirty_files` changes

**Tests:**
- [ ] `test_merge_rejects_dirty_tugtool_files`
- [ ] `test_merge_succeeds_with_clean_main`
- [ ] Full test suite: `cd tugcode && cargo nextest run`

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, zero warnings
- [ ] `merge.rs` contains zero references to `is_infrastructure_path`, `save_infra`, `restore_infra`, `TempDirGuard`, or `prepare_main_for_merge`
- [ ] Dirty `.tugtool/` files on main block merge (not auto-handled)
- [ ] Dry-run JSON output consumed by merge skill matches updated contract

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

#### Step 4: Beads verification, CLI help text, and final test pass {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `chore(beads): update CLI help text and verify all improvements end-to-end`

**References:** [D01] Init beads in worktree not repo root, [D02] No standalone sync outside worktrees, [D03] Title-based matching via bd list, [D04] Full slug for prefix derivation, (#key-test-scenarios, #success-criteria)

**Artifacts:**
- Modified `beads_integration_tests.rs`: All previously-ignored tests un-ignored and passing
- New test: standalone sync error test
- Cleaned up any remaining `None` working_dir arguments
- Modified `beads/mod.rs`: Updated help text and module docs to remove bead-ID-to-plan-file references; reflect worktree-only usage

**Tasks:**
- [ ] Verify the four tests un-ignored in Step 1 pass: `test_beads_sync_is_idempotent`, `test_beads_status_computes_readiness`, `test_beads_pull_updates_checkboxes`, `test_full_beads_workflow_sync_work_pull`
- [ ] Add integration test: `test_standalone_sync_errors_outside_worktree` -- running sync from a non-worktree directory returns E013 with the updated message
- [ ] Audit all remaining `None` working_dir arguments in beads-related code (sync.rs, status.rs, pull.rs, link.rs, close.rs, inspect.rs, update.rs) and fix any missed ones (status.rs and pull.rs should already be fixed in Step 1; verify)
- [ ] Update CLI help text in `beads/mod.rs`:
  - `BeadsCommands::Sync` doc comment (line 30): remove "writes IDs back" from summary
  - `BeadsCommands::Sync` `long_about` (line 35): remove "Writes bead IDs back to the plan file" section; update to explain title-based matching for idempotency
  - `BeadsCommands::Link` `long_about` (line 62): remove "Writes **Bead:** `<bead-id>` line to the specified step"
  - `BeadsCommands::Status` `long_about` (line 79): update "pending: no bead linked yet" to reflect title-based resolution
  - `BeadsCommands::Pull` `long_about` (line 94): update to explain title-based bead resolution
  - Module-level doc comment (line 7): remove "`.beads/` initialized" prerequisite or update to "worktree context required"
- [ ] Run full test suite and verify zero warnings

**Tests:**
- [ ] Integration test: `test_standalone_sync_errors_outside_worktree`
- [ ] Full test suite: `cd tugcode && cargo nextest run`

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, zero warnings
- [ ] All four previously-ignored tests are un-ignored and passing: `test_beads_sync_is_idempotent`, `test_beads_status_computes_readiness`, `test_beads_pull_updates_checkboxes`, `test_full_beads_workflow_sync_work_pull`
- [ ] CLI help text accurately reflects title-based resolution and worktree-only usage

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Beads integration that is isolated per worktree, idempotent on re-sync, and produces self-documenting bead IDs with plan-slug-derived prefixes.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cd tugcode && cargo nextest run` passes with zero warnings
- [ ] All four previously-ignored beads tests are un-ignored and passing
- [ ] Running `tugcode worktree create` creates `.beads/` only inside the worktree, not at repo root
- [ ] Running `tugcode beads sync` twice in a worktree produces identical bead sets (no duplicates)
- [ ] Running any `tugcode beads` subcommand outside a worktree returns E013 error with worktree-directing message
- [ ] Bead IDs use plan slug as prefix (e.g., `auth-imw` for `tugplan-auth.md`)
- [ ] `.beads/` is in `.gitignore`; no `.beads/` directory exists at repo root
- [ ] CLI help text and module docs accurately reflect title-based resolution and worktree-only usage
- [ ] Merge SKILL.md does not reference `.beads/` in infrastructure diff description; reflects simplified dirty-file check
- [ ] `merge.rs` contains no infrastructure handling machinery — no `is_infrastructure_path`, `save_infra_to_temp`, `restore_infra_from_temp`, `prepare_main_for_merge`, `try_auto_resolve_conflicts`, `TempDirGuard`
- [ ] Any dirty tracked files on main (including `.tugtool/`) block merge with a clear message
- [ ] Merge flow has no save/restore/backup/discard/auto-resolve logic

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Consider adding a `tugcode beads cleanup` command to remove orphaned beads after title changes
- [ ] Investigate whether `bd init --prefix` could be propagated to the real `bd` binary if not already supported
- [ ] Consider passing `--readonly` to `bd` commands invoked by read-only agents (reviewer, architect) for defense-in-depth
- [ ] If cross-worktree bead visibility is ever needed, beads supports `.beads/redirect` files that point to a shared database. This could restore the shared model without walk-up logic
- [ ] The `--db <path>` global flag on all `bd` commands can specify the database path directly, bypassing cwd-based discovery. Useful as a fallback if worktree isolation via cwd causes issues

| Checkpoint | Step | Verification |
|------------|------|--------------|
| Worktree isolation | 0 | `test_beads_sync_in_worktree_does_not_touch_repo_root` |
| Idempotent sync | 1 | `test_beads_sync_is_idempotent` |
| Status readiness | 1 | `test_beads_status_computes_readiness` |
| Pull via title | 1 | `test_beads_pull_updates_checkboxes` |
| Full workflow | 1 | `test_full_beads_workflow_sync_work_pull` |
| Slug-based naming | 2 | Integration test with slug prefix |
| Merge simplification | 3 | Zero references to deleted infra functions in `merge.rs` |
| Merge dirty check | 3 | `test_merge_rejects_dirty_tugtool_files` |
| Merge JSON contract | 3 | Dry-run JSON fields match merge skill expectations |
| Standalone error | 4 | `test_standalone_sync_errors_outside_worktree` |
| CLI help text | 4 | Help text reflects title-based resolution and worktree-only usage |
| Full suite | 4 | `cd tugcode && cargo nextest run` |

**Commit after all checkpoints pass.**
