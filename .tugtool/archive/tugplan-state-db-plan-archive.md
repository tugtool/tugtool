<!-- tugplan-skeleton v2 -->

## State DB Plan Archive and Lifecycle {#state-db-plan-archive}

**Purpose:** Replace plan_path as primary key with a stable plan_id (slug-hash7-gen), add plan lifecycle states (active/archived), content snapshots, and a state list/archive command set -- preserving execution history instead of destroying it.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | state-db-plan-archive |
| Last updated | 2026-03-30 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The state database currently keys everything by `plan_path` (a relative file path), which is fragile: renames, deletions, and worktree moves orphan DB entries. The `gc` command destroys history rather than preserving it. There is no plan lifecycle beyond "active", no content snapshots, and no way to list plans from the DB. This phase replaces the file-path key with a stable `plan_id`, adds archival semantics, content snapshots, and a `state list` command.

The full design spec lives in `roadmap/state-db-plan-archive.md`. This plan operationalizes that spec into executable steps with a single v4-to-v5 schema migration.

#### Strategy {#strategy}

- Migrate the schema in a single v4-to-v5 upgrade within `StateDb::open()`, passing `repo_root` through to the migration so it can read plan files for snapshots.
- Replace `plan_path` as FK in all 6 tables with `plan_id` in a bulk mechanical pass through `state.rs` SQL and Rust code.
- Add `plan_snapshots` table for init and completion snapshots; wire completion snapshot into `complete_step()` as a filesystem side effect.
- Convert `reinit_plan()` to archive-then-init with generation increment.
- Replace `gc` CLI command with `archive`; add `state list` command.
- Add `plan_id` field to all JSON output structs alongside `plan_path` for backward-compatible agent migration.
- Add `resolve_plan_with_db()` as a new function for DB-fallback resolution of archived plans.
- Update integration tests to use `plan_id` throughout.

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build` passes with zero warnings (`-D warnings` enforced)
- `cargo nextest run` passes all tests including new migration, archive, and list tests
- `state init` generates a plan_id matching `<slug>-<hash7>-<gen>` format and creates an init snapshot
- `state archive <plan>` transitions active plans to archived with content snapshot
- `state list` shows active plans by default, `--all` includes archived
- `state reinit` archives old plan_id (gen N) and creates new plan_id (gen N+1)
- `complete_step()` auto-snapshots plan content when last step completes
- All JSON output includes both `plan_id` and `plan_path` fields
- `resolve_plan_with_db()` finds archived plans by slug or plan_id when filesystem resolution fails
- No remaining `plan_path` as FK in any SQL query or table definition (only as nullable column on `plans`)

#### Scope {#scope}

1. Schema migration v4 to v5 with `plan_id` as PK, `plan_snapshots` table, `plan_slug` column
2. All `state.rs` SQL queries and Rust functions migrated from `plan_path` FK to `plan_id`
3. `init_plan()` generates `plan_id`, reads file content, creates init snapshot
4. `complete_step()` creates completion snapshot when last step finishes
5. `reinit_plan()` becomes archive-then-init with gen+1
6. New `archive_plan()` function replacing `gc_orphaned_plans()`
7. New `state list` CLI command
8. New `state archive` CLI command replacing `state gc`
9. `resolve_plan_with_db()` function for DB-fallback plan resolution
10. All JSON output structs updated with `plan_id` field
11. All CLI commands in `commands/state.rs`, `commit.rs`, `worktree.rs`, `doctor.rs`, `dash.rs` updated (note: `log.rs` and `merge.rs` do not call `StateDb::open()` and need no changes)
12. Integration tests updated

#### Non-goals (Explicitly out of scope) {#non-goals}

- Updating tugplug/ agent files (deferred; dual-field JSON makes this safe)
- Restoring archived plans back to active
- Adding a purge/delete command for DB rows
- Adding a `state complete-plan` command (completion is derived, not a lifecycle state)
- Changing the `dashes` or `dash_rounds` tables

#### Dependencies / Prerequisites {#dependencies}

- Current schema is at v4 (confirmed by existing `migrate_schema()` code)
- `rusqlite` crate with bundled SQLite already in dependencies
- Design spec finalized in `roadmap/state-db-plan-archive.md`

#### Constraints {#constraints}

- `-D warnings` enforced: zero warnings allowed in `cargo build` and `cargo nextest run`
- Single-transaction migration: all v5 schema changes land atomically
- `StateDb::open()` signature change (adding `repo_root: &Path`) touches ~99 call sites across 7 files

#### Assumptions {#assumptions}

- Slug derivation strips `.tugtool/tugplan-` prefix and `.md` suffix from `plan_path`; plans not matching this pattern use basename-without-extension
- Existing `plan_hash` in the DB is a full SHA-256 hex string; first 7 chars are safe for hash7
- All plans currently in the DB have unique slugs (no collision on `<slug>-<hash7>-1`)
- The `state.rs` test suite uses tempdir-based DBs and can be updated incrementally

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Per skeleton v2 conventions. All anchors are explicit, kebab-case, and stable. Decisions use `[DNN]` format. Steps use step-N anchors.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Migration corrupts existing state.db | high | low | EXCLUSIVE transaction, create v5 tables first, copy data, then drop old | Any test failure in migration path |
| Slug collision during migration | med | low | Append numeric suffix if `<slug>-<hash7>-1` collides | Multiple plans with same slug+hash7 |
| `complete_step()` filesystem read fails | med | low | Log warning but do not fail the completion; snapshot is best-effort at completion time | Network mount or permission issues |

**Risk R01: Migration data loss** {#r01-migration-data-loss}

- **Risk:** The v5 migration drops old tables after copying data. If the copy is incomplete, data is lost.
- **Mitigation:** Use EXCLUSIVE transaction. Create new v5 tables, copy all rows with remapping, verify row counts, then drop old tables. The entire operation is atomic.
- **Residual risk:** SQLite crash during COMMIT could leave the DB in a rolled-back state (safe, just re-run migration).

**Risk R02: Completion snapshot failure** {#r02-completion-snapshot-failure}

- **Risk:** `complete_step()` gains a filesystem side effect (reading the plan file for snapshot). If the file is inaccessible, step completion could fail.
- **Mitigation:** Make the completion snapshot best-effort: log a warning if the file cannot be read, but do not fail the `complete_step()` operation. The init snapshot already exists as a baseline.
- **Residual risk:** Some completed plans may lack a completion snapshot if the file was moved before the last step completed.

---

### Design Decisions {#design-decisions}

#### [D01] plan_id format is slug-hash7-gen (DECIDED) {#d01-plan-id-format}

**Decision:** Plan identity uses format `<slug>-<hash7>-<gen>` (e.g., `worker-markdown-pipeline-a3f7c2e-1`).

**Rationale:**
- Human-readable at a glance (slug gives context)
- Collision-resistant (hash7 from SHA-256 content hash)
- Generation counter links reinit lineage by slug

**Implications:**
- `init_plan()` must compute plan_id from slug + content hash + generation query
- Migration must derive slug from existing `plan_path` values

#### [D02] Two lifecycle states only: active and archived (DECIDED) {#d02-lifecycle-states}

**Decision:** Plans have exactly two lifecycle states: `active` and `archived`. "Completed" is derived from all steps being done, not a separate state.

**Rationale:**
- Simpler model, fewer state transitions to manage
- Avoids ambiguity between "done" (all steps completed) and "archived" (historical record)

**Implications:**
- `state list` and `state show` derive "completed" status by checking if all steps are done
- No `state complete-plan` command needed

#### [D03] Content snapshots in separate table (DECIDED) {#d03-snapshots-separate-table}

**Decision:** Plan content is stored in a `plan_snapshots` table, not on the `plans` row. Snapshots are taken at init (event='init') and at last step completion (event='complete').

**Rationale:**
- Naturally supports multiple snapshots per plan without redundancy
- Keeps the `plans` table lean
- Completion snapshot captures the plan as-implemented

**Implications:**
- `init_plan()` must read the plan file and insert a snapshot row
- `complete_step()` must read the plan file when it detects last-step completion
- `show` for archived plans renders from the most recent snapshot

#### [D04] reinit becomes archive-then-init (DECIDED) {#d04-reinit-archive-then-init}

**Decision:** `reinit` archives the current plan_id (snapshot + status='archived'), then creates a new plan_id with gen+1 and a fresh init snapshot.

**Rationale:**
- Preserves history of the old plan instead of destroying it
- Generation number links old and new by slug
- Reinit on already-archived plans is disallowed (archive is final)

**Implications:**
- `reinit_plan()` signature changes: needs repo_root to read the plan file for archival snapshot
- Must query `MAX(gen) FROM plans WHERE plan_slug = ?` to determine next gen

#### [D05] StateDb::open() takes repo_root parameter (DECIDED) {#d05-statedb-open-repo-root}

**Decision:** Add `repo_root: &Path` to `StateDb::open()` and thread it through `migrate_schema()` so the v5 migration can read plan files from disk for snapshots.

**Rationale:**
- Migration needs filesystem access to snapshot existing plans
- Simplest threading: pass repo_root at open time, store on the struct or pass through

**Implications:**
- All callers of `StateDb::open()` must pass repo_root (mechanical change at ~99 call sites across 7 files, including production code and tests)
- `StateDb` struct may store `repo_root` for use by `init_plan()` and `complete_step()`

#### [D06] resolve_plan_with_db() as new function (DECIDED) {#d06-resolve-with-db}

**Decision:** Add a new `resolve_plan_with_db()` function alongside existing `resolve_plan()` that accepts a `&StateDb` parameter for DB fallback when filesystem resolution fails.

**Rationale:**
- Keeps existing `resolve_plan()` pure (filesystem only) for callers that don't need DB fallback
- DB fallback only needed for commands that operate on archived plans (show, list)

**Implications:**
- `ResolveResult::Found` gains `plan_id: Option<String>` field
- Commands that need archived plan access call `resolve_plan_with_db()` instead

#### [D07] gc removed, archive replaces it (DECIDED) {#d07-archive-replaces-gc}

**Decision:** Remove `state gc` command and `gc_orphaned_plans()` function. Replace with `state archive` command and `archive_plan()` function. Orphan auto-archive happens only in read-only commands (`list`, `show`).

**Rationale:**
- Preserves history instead of destroying it
- One cleanup command with clear semantics
- Auto-archive limited to read-only commands prevents accidental archival during transient filesystem issues

**Implications:**
- `StateCommands::Gc` variant removed, `StateCommands::Archive` added
- `StateCommands::List` variant added
- `GcResult` struct removed, replaced by archive result type
- `StateGcData` output struct removed, replaced by `StateArchiveData`

#### [D08] JSON output includes both plan_id and plan_path (DECIDED) {#d08-dual-field-json}

**Decision:** All JSON output structs include both `plan_id` and `plan_path`. For archived plans, `plan_path` is null.

**Rationale:**
- Allows tugplug/ agents to migrate from plan_path to plan_id incrementally
- No breaking change to existing agent contracts

**Implications:**
- Every State*Data struct in `output.rs` adds a `plan_id: String` field
- `plan_path` becomes `Option<String>` with `skip_serializing_if = "Option::is_none"` for archived plans

#### [D09] Completion snapshot is best-effort (DECIDED) {#d09-completion-snapshot-best-effort}

**Decision:** When `complete_step()` detects the last step completing, it attempts to read the plan file and create a completion snapshot. If the file read fails, step completion still succeeds with a logged warning.

**Rationale:**
- The init snapshot already provides a baseline record
- Failing step completion due to a missing file would break the operational workflow
- The user answer specified looking up plan_path from the plans table inside complete_step()

**Implications:**
- `complete_step()` gains a `repo_root: &Path` parameter (or accesses stored repo_root on StateDb)
- Must query `plan_path` from `plans` table to construct the file path
- Warning logged but not surfaced as error

---

### Specification {#specification}

#### Revised Schema (v5) {#schema-v5}

**Spec S01: plans table** {#s01-plans-table}

```sql
CREATE TABLE plans (
    plan_id      TEXT PRIMARY KEY,
    plan_path    TEXT,
    plan_slug    TEXT NOT NULL,
    plan_hash    TEXT NOT NULL,
    phase_title  TEXT,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
```

**Spec S02: plan_snapshots table** {#s02-plan-snapshots}

```sql
CREATE TABLE plan_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id      TEXT NOT NULL REFERENCES plans(plan_id),
    content      TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    event        TEXT NOT NULL,  -- 'init', 'complete'
    captured_at  TEXT NOT NULL
);
CREATE INDEX idx_snapshots_plan ON plan_snapshots(plan_id);
```

**Spec S03: FK-remapped tables** {#s03-fk-remapped-tables}

All child tables change their FK from `plan_path` to `plan_id`:

```sql
-- steps: (plan_id, anchor) as composite PK
-- step_deps: (plan_id, step_anchor, depends_on) as composite PK
-- checklist_items: plan_id + step_anchor FK
-- step_artifacts: plan_id + step_anchor FK
```

Indexes updated accordingly: `idx_steps_status(plan_id, status)`, `idx_steps_lease(plan_id, status, lease_expires_at)`, `idx_checklist_step(plan_id, step_anchor)`, `idx_artifacts_step(plan_id, step_anchor)`.

**Spec S04: plan_id format** {#s04-plan-id-format}

Format: `<slug>-<hash7>-<gen>`

- **slug**: Derived from plan filename. Strip `.tugtool/tugplan-` prefix and `.md` suffix. E.g., `.tugtool/tugplan-worker-markdown-pipeline.md` becomes `worker-markdown-pipeline`.
- **hash7**: First 7 characters of the plan content SHA-256 hash.
- **gen**: Generation number starting at 1. Per-slug counter computed in Rust: query `SELECT plan_id FROM plans WHERE plan_slug = ?`, parse the gen suffix from each plan_id (the last segment after the final hyphen), take the max, add 1. Gen is not stored as a separate column; it is embedded in the plan_id string and parsed in Rust code.

**Spec S05: state list output** {#s05-state-list-output}

Default: show active plans (including derived "completed" status). `--all` flag includes archived.

Human-readable table format:
```
PLAN                              STATUS      STEPS     CREATED     UPDATED
worker-markdown-pipeline-a3f7c2e  active      3/7       2026-03-28  2026-03-30
```

JSON format includes `plan_id`, `plan_path`, `plan_slug`, `status`, `steps_completed`, `steps_total`, `created_at`, `updated_at`.

**Spec S06: state archive behavior** {#s06-state-archive}

`state archive <plan>`:
1. Resolve plan (by path, slug, or plan_id)
2. Verify plan is active (error if already archived)
3. Read plan file content from disk (if available) and create a snapshot (event='archive')
4. Set `status = 'archived'`, `plan_path = NULL`, `updated_at = now`

Orphan auto-archive: `state list` and `state show` detect plans whose `plan_path` file no longer exists on disk and auto-archive them (same steps as above but triggered implicitly).

**Spec S07: resolve_plan_with_db() behavior** {#s07-resolve-with-db}

1. Run existing 5-stage filesystem cascade via `resolve_plan()`
2. If `Found`, look up `plan_id` from DB by matching `plan_path` and attach to result
3. If `NotFound`, search DB: first by exact `plan_id` match, then by `plan_slug` prefix match
4. Return `ResolveResult::Found` with `plan_id: Some(...)` and `path: None` for archived plans

#### Symbols and Signatures {#symbols-signatures}

**Table T01: New and modified symbols** {#t01-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `StateDb::open(path, repo_root)` | fn (modified) | `state.rs` | Add `repo_root: &Path` parameter |
| `StateDb::repo_root` | field | `state.rs` | Store repo_root on the struct for use by init/complete |
| `StateDb::migrate_v4_to_v5()` | fn (new) | `state.rs` | v5 migration logic |
| `StateDb::init_plan()` | fn (modified) | `state.rs` | Generate plan_id, read file, create snapshot; return plan_id |
| `StateDb::reinit_plan()` | fn (modified) | `state.rs` | Archive-then-init with gen+1 |
| `StateDb::archive_plan()` | fn (new) | `state.rs` | Snapshot + status=archived + plan_path=NULL |
| `StateDb::list_plans()` | fn (new) | `state.rs` | Return plan summaries for list command |
| `StateDb::show_plan()` | fn (modified) | `state.rs` | Render archived plans from snapshot |
| `StateDb::complete_step()` | fn (modified) | `state.rs` | Add completion snapshot on last step |
| `gc_orphaned_plans()` | fn (removed in Step 10) | `state.rs` | Replaced by archive_plan(); kept alive until Step 10 removes callers |
| `GcResult` | struct (removed in Step 10) | `state.rs` | Replaced by ArchiveResult; kept alive until Step 10 removes callers |
| `ArchiveResult` | struct (new) | `state.rs` | Result of archive operation |
| `InitResult` | struct (modified) | `state.rs` | Add `plan_id: String` field |
| `PlanState` | struct (modified) | `state.rs` | Replace `plan_path` with `plan_id`, add optional `plan_path` |
| `PlanListEntry` | struct (new) | `state.rs` | For list_plans() return |
| `resolve_plan_with_db()` | fn (new) | `resolve.rs` | DB-fallback resolution |
| `ResolveResult::Found` | enum variant (modified) | `resolve.rs` | Add `plan_id: Option<String>` |
| `StateCommands::Archive` | enum variant (new) | `commands/state.rs` | Replaces Gc |
| `StateCommands::List` | enum variant (new) | `commands/state.rs` | New list command |
| `StateCommands::Gc` | enum variant (removed) | `commands/state.rs` | Removed |
| `StateInitData` | struct (modified) | `output.rs` | Add `plan_id` field |
| `StateReinitData` | struct (modified) | `output.rs` | Add `plan_id`, `archived_plan_id` fields |
| `StateArchiveData` | struct (new) | `output.rs` | Replaces StateGcData |
| `StateListData` | struct (new) | `output.rs` | For state list JSON output |
| `StateGcData` | struct (removed in Step 10) | `output.rs` | Replaced by StateArchiveData; kept alive until Step 10 removes callers |
| All other State*Data structs | structs (modified) | `output.rs` | Add `plan_id` field, make `plan_path` optional |

---

### Compatibility / Migration / Rollout {#rollout}

- **Compatibility policy:** Schema version bumps from 4 to 5. Migration is automatic on first `StateDb::open()`.
- **Migration plan:**
  - All existing plans get `plan_id = <slug>-<hash7>-1` (gen=1 for all migrated plans)
  - Plans with missing files on disk get `status='archived'`, `plan_path=NULL`, no snapshot
  - Plans with files on disk get an init snapshot
  - All child table rows remapped from `plan_path` FK to `plan_id` FK
- **Rollout plan:**
  - Single migration, no feature gate
  - Rollback: restore state.db from backup (SQLite file copy)
  - tugplug/ agents continue working via dual-field JSON output

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test plan_id generation, slug derivation, gen computation | Core identity logic |
| **Integration** | Test migration path, init/archive/reinit/list end-to-end | Full StateDb operations |
| **Golden / Contract** | Verify JSON output shape includes both plan_id and plan_path | Output struct serialization |

---

### Execution Steps {#execution-steps}

#### Step 1: StateDb::open() signature change and v4-to-v5 migration logic {#step-1}

**Commit:** `feat(state): StateDb::open takes repo_root, add v4→v5 migration`

**References:** [D01] plan_id format, [D05] StateDb::open() takes repo_root, Spec S01, Spec S02, Spec S03, Spec S04, (#schema-v5, #rollout, #r01-migration-data-loss)

**Artifacts:**
- Modified `tugtool-core/src/state.rs`: `StateDb::open()` gains `repo_root: &Path`, struct stores `repo_root: PathBuf`
- Modified `tugtool-core/src/state.rs`: new `migrate_v4_to_v5()` method with full migration SQL
- Fresh-database DDL remains at v4 schema in this step (v5 DDL deferred to Step 2 where SQL queries and DDL change atomically)
- Modified all callers of `StateDb::open()` across `commands/state.rs`, `commands/commit.rs`, `commands/worktree.rs`, `commands/doctor.rs`, `commands/dash.rs`, and `tugtool-core/src/dash.rs`

**Tasks:**
- [ ] Add `repo_root: PathBuf` field to `StateDb` struct
- [ ] Change `StateDb::open(path: &Path)` to `StateDb::open(path: &Path, repo_root: &Path)`, store repo_root
- [ ] Keep the initial schema DDL in `open()` at v4 (unchanged) for fresh databases -- this ensures existing tests that call init_plan() with the current (plan_path, plan_hash) signature continue to work until Step 2 updates both DDL and SQL queries together
- [ ] Implement `migrate_v4_to_v5(&mut self)` called from `migrate_schema()` when version == 4:
  - Disable FK enforcement
  - BEGIN EXCLUSIVE
  - Create `plans_v5`, `steps_v5`, `step_deps_v5`, `checklist_items_v5`, `step_artifacts_v5`, `plan_snapshots` tables
  - For each plan in old `plans`: derive slug, compute plan_id (`<slug>-<hash7>-1`), try reading file at `repo_root.join(plan_path)` for snapshot, insert into `plans_v5` and optionally `plan_snapshots`
  - Copy steps, step_deps, checklist_items, step_artifacts into v5 tables remapping plan_path to plan_id
  - Drop old tables, rename v5 tables
  - Create indexes
  - UPDATE schema_version SET version = 5
  - COMMIT
  - Re-enable FK enforcement
- [ ] Update all callers of `StateDb::open()` to pass `repo_root` (~99 call sites across 7 files: `commands/state.rs` (14), `commands/dash.rs` (20), `commands/commit.rs` (2), `commands/worktree.rs` (1), `commands/doctor.rs` (3), `tugtool-core/src/state.rs` tests (50), `tugtool-core/src/dash.rs` tests (9))
- [ ] Update all existing tests in `state.rs` that call `StateDb::open()` to pass a tempdir repo_root

**Tests:**
- [ ] Test migration from v4 to v5 with plans that have files on disk (snapshot created)
- [ ] Test migration from v4 to v5 with orphaned plans (archived, no snapshot)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all existing tests pass unchanged against v4 fresh-DB DDL; Step 2 will update DDL to v5)

---

#### Step 2: Migrate SQL FK columns and internal structs from plan_path to plan_id {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(state): replace plan_path FK with plan_id in SQL, internal structs, and fresh-DB DDL`

**References:** [D01] plan_id format, Spec S01, Spec S02, Spec S03, Table T01, (#schema-v5, #symbols-signatures)

**Artifacts:**
- Modified `tugtool-core/src/state.rs`: fresh-database DDL in `open()` switched from v4 to v5 schema (plan_id PK, plan_snapshots table, all child tables with plan_id FK) with initial version set to 5. This change is done atomically with the SQL query migration so that tests creating fresh databases never encounter a mismatch between DDL column names and query column references.
- Modified `tugtool-core/src/state.rs`: all ~50 SQL queries updated from `plan_path` to `plan_id` in WHERE, INSERT, SELECT, DELETE clauses for steps, step_deps, checklist_items, step_artifacts tables
- Modified `tugtool-core/src/state.rs`: internal structs (`PlanState`, `StepState`, `ChecklistItemDetail`) updated to carry `plan_id` instead of `plan_path` as their FK field
Note: Method parameter names remain `plan_path: &str` in this step even though they now contain plan_id values. The parameter rename to `plan_id: &str` happens atomically with caller updates in Steps 10-11 to avoid a runtime correctness gap where callers pass plan_path values to plan_id parameters. Similarly, `list_plan_paths()` is NOT renamed in this step — it continues to return plan_id values under the old function name until Step 10 renames it alongside its callers.

**Tasks:**
- [ ] Switch the initial schema DDL in `open()` from v4 to v5 table definitions (plan_id PK, plan_snapshots table, all child tables with plan_id FK columns and updated indexes) for fresh databases; set initial version to 5. This must happen in the same step as the SQL query migration so that fresh-DB tests (which create new databases) see v5 columns matching the updated queries.
- [ ] Update all SQL queries to use `plan_id` column instead of `plan_path` for FK references in steps, step_deps, checklist_items, step_artifacts tables
- [ ] Update `PlanState` struct: add `plan_id: String` field, change `plan_path` to `Option<String>`
- [ ] Update `StepState`, `ChecklistItemDetail`, and any other sub-structs that carry plan_path FK to use plan_id
- [ ] Update `list_plan_paths()` SQL query to SELECT plan_id instead of plan_path (keep the function name unchanged — rename to `list_plan_ids()` deferred to Step 10 alongside caller updates to avoid breaking `commands/state.rs`, `commands/doctor.rs`, and `gc_orphaned_plans()` which all call `list_plan_paths()`)
- [ ] Update all internal helper functions that pass plan_path FK through to use plan_id
- [ ] Update all state.rs tests to pass plan_id values where the SQL now expects plan_id
- [ ] Add `// TRANSITION: parameter named plan_path but carries plan_id value until Step 10 renames` comments on all method signatures that accept the renamed FK value, to mark the semantic mismatch explicitly during the transition window

**Tests:**
- [ ] Verify existing state.rs tests pass with updated SQL, struct fields, and v5 fresh-DB DDL
- [ ] Test fresh DB creation produces v5 schema directly (plan_id PK, plan_snapshots table exists)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 3: Update init_plan() for plan_id generation and snapshots {#step-3}

**Depends on:** #step-2

**Commit:** `feat(state): init_plan generates plan_id and creates init snapshot`

**References:** [D01] plan_id format, [D03] snapshots separate table, Spec S04, Spec S02, Table T01, (#schema-v5)

**Artifacts:**
- Modified `tugtool-core/src/state.rs`: `init_plan()` generates plan_id, inserts plan + snapshot
- Modified `tugtool-core/src/state.rs`: `InitResult` gains `plan_id: String` field
- New helper function `derive_plan_slug(plan_path: &str) -> String`
- New helper function `generate_plan_id(slug: &str, hash: &str, gen: u32) -> String`
- New test helper function `init_test_plan()` that writes a minimal plan file to disk and calls `init_plan()`
- Modified `tugcode/crates/tugcode/src/commands/state.rs`: callers of `init_plan()` updated to new signature (14 call sites)
- Modified `tugcode/crates/tugcode/src/commands/worktree.rs`: caller of `init_plan()` updated to new signature (1 call site)
- Modified `tugcode/crates/tugcode/src/commands/doctor.rs`: callers of `init_plan()` updated to new signature (2 call sites)

**Tasks:**
- [ ] Add `derive_plan_slug(plan_path: &str) -> String`: strips `.tugtool/tugplan-` and `.md`
- [ ] Add `generate_plan_id(slug: &str, hash: &str, gen: u32) -> String`: formats `<slug>-<hash7>-<gen>`
- [ ] Modify `init_plan()`: accept `plan_path: &str` (relative path) and `plan: &TugPlan` and `plan_hash: Option<&str>`; if `plan_hash` is None, read file content from `self.repo_root.join(plan_path)` and compute SHA-256; if `plan_hash` is Some, use the provided value (enables test callers to skip writing real files); compute slug; query existing plan_ids for this slug to find max gen; generate plan_id; insert into `plans` with plan_id; insert into `plan_snapshots` with event='init' (snapshot content read from disk; if file unreadable, skip snapshot)
- [ ] Add `plan_id: String` to `InitResult`
- [ ] Create `init_test_plan()` test helper that writes a minimal plan file to a tempdir and calls `init_plan()` with `plan_hash: None`. New tests should prefer this helper. Existing tests may continue using `plan_hash: Some("fake-hash")` to avoid rewriting ~47 call sites -- the optional hash override preserves testability while keeping production code reading from disk by default.
- [ ] Update all ~47 existing test call sites to pass `plan_hash` as `Some(existing_value)` to match the new `Option<&str>` signature (mechanical change: wrap existing `&str` arg in `Some(...)`)
- [ ] Update all production callers of `init_plan()` to the new signature: `commands/state.rs` (14 call sites, including `run_state_init` and `run_state_reinit`), `commands/worktree.rs` (1 call site in `run_worktree_setup`), and `commands/doctor.rs` (2 call sites in `run_doctor` orphan re-init logic)

**Tests:**
- [ ] Test init_plan() generates correct plan_id format
- [ ] Test init_plan() creates init snapshot with correct content (using init_test_plan helper)
- [ ] Test init_plan() increments gen when same slug exists (from a previous archived plan)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 4: Update complete_step() for completion snapshots {#step-4}

**Depends on:** #step-3

**Commit:** `feat(state): auto-snapshot plan content on last step completion`

**References:** [D03] snapshots separate table, [D09] completion snapshot best-effort, Spec S02, Risk R02, (#r02-completion-snapshot-failure)

**Artifacts:**
- Modified `tugtool-core/src/state.rs`: `complete_step()` checks if all steps are now completed after marking current step done; if so, reads plan file from disk using plan_path from plans table, creates snapshot with event='complete'

**Tasks:**
- [ ] Remove the `UPDATE plans SET status = 'done'` block from `complete_step()` (at line ~1329-1330). Per [D02], there is no 'done' lifecycle state -- "completed" is derived from all steps being done, not stored as a status value. The only valid status values are 'active' and 'archived'.
- [ ] Update the test at line ~3627-3636 that asserts `status = 'done'` after all steps complete: change assertion to verify `status = 'active'` (plan remains active; completion is derived).
- [ ] In `complete_step()`, after marking the step completed: query `SELECT plan_path FROM plans WHERE plan_id = ?` to get file path
- [ ] If `all_steps_completed` is true and plan_path is not NULL: read file content from `self.repo_root.join(plan_path)`, compute content_hash, insert into `plan_snapshots` with event='complete'
- [ ] If file read fails: log warning (eprintln) but return success -- completion snapshot is best-effort
- [ ] If plan_path is NULL (already archived somehow): skip snapshot silently

**Tests:**
- [ ] Test that completing the last step creates a completion snapshot and plan status remains 'active'
- [ ] Test that completing a non-last step does not create a snapshot
- [ ] Test that file-read failure during snapshot does not fail the completion

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 5: Implement archive_plan() and update reinit_plan() {#step-5}

**Depends on:** #step-4

**Commit:** `feat(state): archive_plan and archive-then-init reinit`

**References:** [D02] lifecycle states, [D04] reinit archive-then-init, [D07] archive replaces gc, Spec S06, Table T01, (#schema-v5)

**Artifacts:**
- New `tugtool-core/src/state.rs`: `archive_plan()` function
- New `tugtool-core/src/state.rs`: `ArchiveResult` struct
- Modified `tugtool-core/src/state.rs`: `reinit_plan()` rewritten as archive-then-init
- `gc_orphaned_plans()` and `GcResult` kept alive in this step (callers in `commands/state.rs` and `lib.rs` re-export still reference them; removal deferred to Step 10)

**Tasks:**
- [ ] Implement `archive_plan(plan_id: &str) -> Result<ArchiveResult, TugError>`:
  - Verify plan exists and is active
  - Read plan file from disk if plan_path is not NULL; create snapshot with event='archive'
  - SET status='archived', plan_path=NULL, updated_at=now
  - Return ArchiveResult with plan_id, snapshot_taken: bool
- [ ] Define `ArchiveResult` struct: `plan_id: String`, `snapshot_taken: bool`
- [ ] Rewrite `reinit_plan()`:
  - Accept plan_path (relative), plan (parsed), plan_hash
  - Look up current plan_id for this plan_path
  - If current plan is archived, return error (reinit on archived not allowed)
  - Archive the current plan (call archive_plan)
  - Call init_plan() which computes gen+1 automatically
  - Return new InitResult with new plan_id
- [ ] Keep `gc_orphaned_plans()` and `GcResult` alive (do NOT remove yet — `commands/state.rs:run_state_gc()` and `lib.rs` re-export still reference them; removal deferred to Step 10 where callers are updated)

**Tests:**
- [ ] Test archive_plan() transitions active to archived
- [ ] Test archive_plan() errors on already-archived plan
- [ ] Test reinit_plan() archives old plan and creates new with gen+1
- [ ] Test reinit_plan() errors on archived plan

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 6: Implement list_plans() and show_plan() for archived plans {#step-6}

**Depends on:** #step-5

**Commit:** `feat(state): list_plans and archived-plan show from snapshots`

**References:** [D02] lifecycle states, [D03] snapshots separate table, Spec S05, Table T01, (#schema-v5, #symbols-signatures)

**Artifacts:**
- New `tugtool-core/src/state.rs`: `list_plans()` function
- New `tugtool-core/src/state.rs`: `PlanListEntry` struct
- Modified `tugtool-core/src/state.rs`: `show_plan()` renders archived plans from snapshot content

**Tasks:**
- [ ] Define `PlanListEntry` struct: `plan_id`, `plan_slug`, `plan_path: Option<String>`, `status`, `steps_completed: usize`, `steps_total: usize`, `created_at`, `updated_at`
- [ ] Implement `list_plans(include_archived: bool) -> Result<Vec<PlanListEntry>, TugError>`:
  - Query plans table joined with step counts
  - Filter by status='active' unless include_archived
  - Derive "completed" display status when all steps are done
- [ ] Modify `show_plan()`: when plan status is 'archived', query most recent plan_snapshot and include content in the returned `PlanState`
- [ ] Add `content: Option<String>` to `PlanState` for archived plan content

**Tests:**
- [ ] Test list_plans() returns active plans only by default
- [ ] Test list_plans(true) includes archived plans
- [ ] Test show_plan() for archived plan returns snapshot content

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 7: Add resolve_plan_with_db() {#step-7}

**Depends on:** #step-6

**Commit:** `feat(resolve): add resolve_plan_with_db for DB-fallback resolution`

**References:** [D06] resolve_plan_with_db, Spec S07, Table T01, (#symbols-signatures)

**Artifacts:**
- Modified `tugtool-core/src/resolve.rs`: new `resolve_plan_with_db()` function
- Modified `tugtool-core/src/resolve.rs`: `ResolveResult::Found` gains `plan_id: Option<String>` field
- Modified all files matching on `ResolveResult::Found` to add `plan_id` field: `commands/validate.rs`, `commands/resolve.rs`, `commands/state.rs`, `commands/commit.rs`, `commands/worktree.rs`, `commands/merge.rs`, and `tugtool-core/src/resolve.rs` tests

**Tasks:**
- [ ] Add `plan_id: Option<String>` to `ResolveResult::Found`
- [ ] Update all existing matches on `ResolveResult::Found` across all 7 files to include `plan_id: _` or destructure as needed: `commands/validate.rs` (1 match), `commands/resolve.rs` (1 match), `commands/state.rs` (~13 matches), `commands/commit.rs` (1 match), `commands/worktree.rs` (2 matches), `commands/merge.rs` (1 match), `tugtool-core/src/resolve.rs` (~14 matches including tests and construction sites)
- [ ] Implement `resolve_plan_with_db(input: &str, project_root: &Path, db: &StateDb) -> Result<ResolveResult, TugError>`:
  - Call existing `resolve_plan()` first
  - If `Found { path, stage }`: look up plan_id from DB by matching plan_path, return `Found { plan_id: Some(...), path: Some(path), stage }`
  - If `NotFound`: query DB by exact plan_id match, then by slug prefix; return `Found { plan_id: Some(...), path: None, stage: ResolveStage::Db }` or `NotFound`
- [ ] Add `ResolveStage::Db` variant for DB-resolved plans
- [ ] Add `StateDb::lookup_plan_id_by_path()` and `StateDb::lookup_plan_by_id_or_slug()` helper methods
- [ ] Update `tugtool-core/src/lib.rs` re-exports to add `resolve_plan_with_db`

**Tests:**
- [ ] Test resolve_plan_with_db() finds active plan on disk and attaches plan_id
- [ ] Test resolve_plan_with_db() finds archived plan by plan_id from DB
- [ ] Test resolve_plan_with_db() finds archived plan by slug prefix from DB

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 8: Core library integration checkpoint {#step-8}

**Depends on:** #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] plan_id format, [D02] lifecycle states, [D03] snapshots, [D04] reinit, [D06] resolve_plan_with_db, (#success-criteria)

**Tasks:**
- [ ] Verify all tugtool-core functions compile and pass tests
- [ ] Verify no remaining `plan_path` as FK in any SQL query (search for `plan_path = ?` in WHERE clauses of non-plans-table queries)
- [ ] Verify plan_snapshots table is populated correctly by init and complete flows

**Tests:**
- [ ] Verify existing test suite covers init, complete, archive, and resolve flows end-to-end (no new tests; this is an aggregate verification step)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)
- [ ] `grep -n 'FROM steps.*plan_path\|FROM step_deps.*plan_path\|FROM checklist_items.*plan_path\|FROM step_artifacts.*plan_path' tugcode/crates/tugtool-core/src/state.rs` (expect zero matches)

---

#### Step 9: Update JSON output structs {#step-9}

**Depends on:** #step-8

**Commit:** `feat(output): add plan_id to all state JSON output structs`

**References:** [D08] dual-field JSON, Table T01, (#symbols-signatures)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/output.rs`: all State*Data structs gain `plan_id: String` field; `plan_path` becomes `Option<String>` where applicable
- New `StateArchiveData` struct
- New `StateListData` struct
- `StateGcData` kept alive in this step (caller in `commands/state.rs:run_state_gc()` still references it; removal deferred to Step 10)

**Tasks:**
- [ ] Add `plan_id: String` to: `StateInitData`, `StateReinitData`, `StateClaimData`, `StateStartData`, `StateHeartbeatData`, `StateUpdateData`, `StateArtifactData`, `StateCompleteData`, `StateReadyData`, `StateResetData`, `StateReleaseData`, `StateReconcileData`
- [ ] Change `plan_path: String` to `plan_path: Option<String>` with `#[serde(skip_serializing_if = "Option::is_none")]` on structs where archived plans may have null path
- [ ] Add `StateArchiveData` struct: `plan_id: String`, `archived: bool`, `snapshot_taken: bool`
- [ ] Add `StateListData` struct: `plans: Vec<StateListEntry>` with `StateListEntry` containing `plan_id`, `plan_slug`, `plan_path: Option<String>`, `status`, `steps_completed`, `steps_total`, `created_at`, `updated_at`
- [ ] Keep `StateGcData` struct alive (do NOT remove yet — `commands/state.rs:run_state_gc()` still imports and constructs it; removal deferred to Step 10 where `run_state_gc()` is removed)
- [ ] Add `plan_id: String` and `archived_plan_id: Option<String>` to `StateReinitData`

**Tests:**
- [ ] Checkpoint build verification is sufficient; output struct correctness is validated by the compiler (struct field type mismatches are compile errors)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)

---

#### Step 10: Update CLI commands in commands/state.rs {#step-10}

**Depends on:** #step-9

**Commit:** `feat(state-cli): archive and list commands, plan_id threading`

**References:** [D07] archive replaces gc, [D08] dual-field JSON, Spec S05, Spec S06, Table T01, (#symbols-signatures)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/state.rs`: `StateCommands::Gc` removed, `StateCommands::Archive` and `StateCommands::List` added
- Modified `tugcode/crates/tugcode/src/main.rs`: `StateCommands` match updated to route `Archive` and `List`, remove `Gc`
- Modified `tugcode/crates/tugcode/src/commands/mod.rs`: re-exports updated (`run_state_gc` removed, `run_state_archive` and `run_state_list` added)
- Modified all `run_state_*` functions to thread plan_id through to output structs
- Modified `tugtool-core/src/state.rs`: method parameter names renamed from `plan_path: &str` to `plan_id: &str` (atomic with caller updates in this step and Step 11)
- Modified `tugtool-core/src/state.rs`: `list_plan_paths()` renamed to `list_plan_ids()` (deferred from Step 2; callers updated here)
- Modified `tugtool-core/src/state.rs`: `gc_orphaned_plans()` and `GcResult` removed (deferred from Step 5; callers removed here)
- Modified `tugcode/crates/tugcode/src/output.rs`: `StateGcData` removed (deferred from Step 9; caller removed here)
- Modified `tugtool-core/src/lib.rs`: re-exports updated for renamed/added/removed symbols (`GcResult` removed, `ArchiveResult` and `PlanListEntry` added)
- New `run_state_archive()` and `run_state_list()` functions

**Tasks:**
- [ ] Rename `plan_path` parameters to `plan_id` in all StateDb method signatures (except `init_plan` which takes a path and generates the id) -- this is done atomically with callers in this step and Step 11
- [ ] Rename `list_plan_paths()` to `list_plan_ids()` (deferred from Step 2) and update all callers in this file and Step 11 files
- [ ] Remove `gc_orphaned_plans()` function and `GcResult` struct from `state.rs` (deferred from Step 5)
- [ ] Remove `StateGcData` struct from `output.rs` (deferred from Step 9)
- [ ] Remove `GcResult` re-export from `tugtool-core/src/lib.rs`, add `ArchiveResult` and `PlanListEntry`
- [ ] Remove `StateCommands::Gc` variant and its `dry_run` arg
- [ ] Add `StateCommands::Archive { plan: String }` variant
- [ ] Add `StateCommands::List { all: bool }` variant with `#[arg(long)]` for `--all`
- [ ] Implement `run_state_archive()`: resolve plan, call `db.archive_plan()`, output StateArchiveData
- [ ] Implement `run_state_list()`: call `db.list_plans(all)`, format human-readable table and JSON output
- [ ] Update `run_state_init()`: use plan_id from `InitResult` in output
- [ ] Update `run_state_reinit()`: use plan_id and archived_plan_id in output
- [ ] Update `run_state_claim()`, `run_state_start()`, `run_state_heartbeat()`, `run_state_complete()`, `run_state_show()`, `run_state_ready()`, `run_state_reset()`, `run_state_release()`, `run_state_reconcile()`, `run_state_complete_checklist()`: resolve plan_id from DB after plan resolution, pass plan_id to StateDb methods, include in output structs
- [ ] Remove `run_state_gc()` function
- [ ] Update `main.rs` `StateCommands` match to route `Archive` and `List`, remove `Gc`
- [ ] Update `commands/mod.rs` re-exports: remove `run_state_gc`, add `run_state_archive` and `run_state_list`
- [ ] Update `tugtool-core/src/lib.rs` re-exports for any renamed/added/removed public symbols (e.g., `ArchiveResult` replaces `GcResult`, `PlanListEntry` added)

**Tests:**
- [ ] Verify build and existing tests pass after command restructuring and parameter renames

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 11: Update other CLI commands (commit, log, merge, worktree, doctor) {#step-11}

**Depends on:** #step-10

**Commit:** `refactor(cli): thread plan_id through commit, log, merge, worktree, doctor`

**References:** [D05] StateDb::open() takes repo_root, [D08] dual-field JSON, Table T01, (#symbols-signatures)

**Artifacts:**
- Modified `commands/commit.rs`: pass repo_root to StateDb::open() (2 call sites), use plan_id in state operations
- Modified `commands/worktree.rs`: pass repo_root to StateDb::open() (1 call site), use plan_id in state init
- Modified `commands/doctor.rs`: pass repo_root to StateDb::open() (3 call sites including tests), update orphan detection to use plan_id
- Modified `commands/dash.rs`: pass repo_root to StateDb::open() (20 call sites including tests), use plan_id in dash state operations

Note: `commands/log.rs` and `commands/merge.rs` do not call `StateDb::open()` and need no changes in this step. The `tugtool-core/src/dash.rs` test calls (9 sites) were already handled in Step 1.

**Tasks:**
- [ ] Update `commands/commit.rs`: change StateDb::open() calls to pass repo_root; after resolving plan, look up plan_id from DB; use plan_id in complete_step() and other state calls
- [ ] Update `commands/worktree.rs`: change StateDb::open() call to pass repo_root; use plan_id in state init
- [ ] Update `commands/doctor.rs`: change StateDb::open() calls to pass repo_root; update orphan detection to use `list_plan_ids()` (renamed from `list_plan_paths()` in Step 10) and check plan_path from plans table
- [ ] Update `commands/dash.rs`: change all StateDb::open() calls (6 production + 14 test) to pass repo_root; use plan_id in dash state operations

**Tests:**
- [ ] Verify build and existing tests pass after all remaining caller updates

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 12: Update error types {#step-12}

**Depends on:** #step-11

**Commit:** `refactor(error): update state error variants for plan_id`

**References:** Table T01, (#symbols-signatures)

**Artifacts:**
- Modified `tugtool-core/src/error.rs`: error variants that reference `plan_path` updated to use `plan_id` where appropriate

**Tasks:**
- [ ] Update `StatePlanHashMismatch` variant: rename `plan_path` field to `plan_id`
- [ ] Update `StateStepNotFound` variant: rename `plan_path` field to `plan_id`
- [ ] Add `StateArchiveError` variant for archive-specific failures (e.g., "plan already archived")
- [ ] Update error display strings to reference plan_id
- [ ] Update error tests in `error.rs`

**Tests:**
- [ ] Verify error variant display strings render plan_id correctly (covered by existing error tests updated in tasks above)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -5` (all tests pass)

---

#### Step 13: Update integration tests {#step-13}

**Depends on:** #step-12

**Commit:** `test(state): update integration tests for plan_id and new commands`

**References:** [D01] plan_id format, [D02] lifecycle states, [D03] snapshots, [D07] archive replaces gc, Spec S05, Spec S06, (#success-criteria)

**Artifacts:**
- Modified `tugtool-core/src/state.rs` test module: all test functions updated to use plan_id
- New tests for archive, list, migration, snapshot flows

**Tasks:**
- [ ] Update all existing test helper functions to pass repo_root to StateDb::open()
- [ ] Update all test assertions that reference plan_path as FK to use plan_id instead
- [ ] Update test plan init calls to handle the new InitResult with plan_id
- [ ] Add migration test: create a v4 DB manually, open with StateDb::open(), verify v5 schema and plan_id generation
- [ ] Add archive flow test: init plan, complete all steps, archive, verify status and snapshot
- [ ] Add reinit flow test: init plan, reinit, verify old plan archived with gen=1 and new plan has gen=2
- [ ] Add list test: init multiple plans, archive some, verify list and list --all behavior
- [ ] Remove any tests for gc_orphaned_plans()

**Tests:**
- [ ] Migration test: v4 DB migrated to v5 with correct plan_id, slug, and snapshot
- [ ] Archive flow test: init, complete all steps, archive, verify status and snapshot
- [ ] Reinit flow test: init, reinit, verify old archived gen=1, new gen=2
- [ ] List test: multiple plans, archive some, verify list and list --all

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -10` (all tests pass, including new ones)

---

#### Step 14: Final integration checkpoint {#step-14}

**Depends on:** #step-10, #step-11, #step-12, #step-13

**Commit:** `N/A (verification only)`

**References:** [D01] plan_id format, [D02] lifecycle states, [D03] snapshots, [D07] archive replaces gc, [D08] dual-field JSON, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify full build with zero warnings
- [ ] Verify all tests pass
- [ ] Verify no remaining plan_path as FK in SQL queries (only as nullable column on plans table)
- [ ] Verify JSON output structs all include plan_id
- [ ] Spot-check: manually run `cargo run -- state init <plan>` and verify plan_id in output

**Tests:**
- [ ] Full test suite passes as aggregate verification (no new tests; this is a verification-only step)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` (zero warnings)
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -10` (all tests pass)
- [ ] `grep -rn 'plan_path' tugcode/crates/tugcode/src/output.rs | grep -v 'Option\|skip_serializing\|plan_path.*plan_id\|plan_id.*plan_path\|///\|//\|serde'` (verify all plan_path fields are Option or documented)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** State database uses stable plan_id as primary key with plan lifecycle management (active/archived), content snapshots, archive and list commands, and backward-compatible JSON output.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build` passes with zero warnings (`-D warnings`)
- [ ] `cargo nextest run` passes all tests
- [ ] `state init` outputs plan_id in format `<slug>-<hash7>-<gen>`
- [ ] `state archive <plan>` transitions plans to archived with snapshot
- [ ] `state list` shows active plans; `state list --all` includes archived
- [ ] `state reinit` archives old plan with gen N, creates new with gen N+1
- [ ] All JSON output includes both `plan_id` and `plan_path`
- [ ] No `plan_path` used as FK in any SQL query outside the `plans` table itself
- [ ] v4 to v5 migration works correctly (tested)

**Acceptance tests:**
- [ ] Init a plan, verify plan_id format and init snapshot exists
- [ ] Complete all steps, verify completion snapshot exists
- [ ] Archive a plan, verify status='archived' and plan_path=NULL
- [ ] Reinit a plan, verify gen increments and old plan is archived
- [ ] List plans with and without --all flag

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Update tugplug/ agent files to use plan_id instead of plan_path
- [ ] Add restore (archived to active) if use case arises
- [ ] Add plan comparison (diff between init and complete snapshots)
- [ ] Add snapshot browsing command (show specific snapshot by event)

| Checkpoint | Verification |
|------------|--------------|
| Build clean | `cd tugcode && cargo build` with zero warnings |
| Tests pass | `cd tugcode && cargo nextest run` all green |
| Schema version | `sqlite3 .tugtool/state.db "SELECT version FROM schema_version"` returns 5 |
| plan_id in JSON | `cargo run -- state init <plan> --json` includes plan_id field |
