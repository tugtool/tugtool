# State DB: Plan Archive and Lifecycle

## Problem Statement

The state database tracks plan execution but treats plans as transient. Several issues arise from this:

1. **File-path fragility.** Plans are keyed by relative file path (`plans.plan_path`). If a plan file moves, renames, or gets deleted, the DB entry becomes orphaned. The `gc` subcommand's answer is to destroy the record entirely.

2. **No plan content in DB.** The database stores a SHA-256 hash of the plan file, plus parsed structure (step titles, anchors, deps, checklist items), but not the plan's actual markdown content. To see what was planned, you must find the original file — which may no longer exist or may have been edited since implementation.

3. **No lifecycle beyond "active".** The `plans.status` column defaults to `'active'` and never transitions to any other value. The plan file's own metadata has draft/active/done states, but these aren't reflected in the DB. There's no concept of a plan being "done" or "archived."

4. **GC destroys history.** `tugcode state gc` deletes all DB rows for plans whose files no longer exist on disk. This is the opposite of archiving — it erases the record of completed work.

5. **Post-hoc edits go undetected.** Someone could edit a plan file after implementation. The hash would no longer match, but nothing currently surfaces this or preserves the original. The DB points to a file that *isn't* what was implemented.

## Current Schema (relevant parts)

```sql
CREATE TABLE plans (
    plan_path    TEXT PRIMARY KEY,    -- relative file path, fragile
    plan_hash    TEXT NOT NULL,       -- SHA-256, detect drift only
    phase_title  TEXT,
    status       TEXT NOT NULL DEFAULT 'active',  -- never transitions
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
```

Steps, checklist items, deps, and artifacts reference `plan_path` as a foreign key.

## Design

### Stable Plan Identity

Plans get a stable `plan_id` as the true primary key, replacing the file-path key.

**Identity format:** `<slug>-<hash7>-<gen>`, e.g. `worker-markdown-pipeline-a3f7c2e-1`

- **slug**: Derived from the plan filename (e.g., `tugplan-worker-markdown-pipeline.md` → `worker-markdown-pipeline`).
- **hash7**: First 7 characters of the plan content's SHA-256 hash (git-style), computed at init time.
- **gen**: Generation number, starting at 1. Per-slug counter: incremented on reinit regardless of content changes, so the gen tracks lineage across revisions (e.g., `foo-abc1234-1` → reinit with changed content → `foo-def5678-2`). To generate: query `MAX(gen) FROM plans WHERE plan_slug = <slug>`, then +1.

This format is human-readable at a glance, collision-resistant, and deterministic from the plan file content.

### Plan Lifecycle States

```
active → archived
```

Two states, one transition. A plan is either being worked on or it's historical.

- **active**: Plan is being executed or has completed execution. File expected on disk. Whether all steps are completed is a queryable property, not a separate state.
- **archived**: Plan preserved in DB, file may or may not exist. Not shown in default output.

**Transitions:**
- `state archive <plan>`: active → archived. Works on any active plan (in-progress or all-steps-completed). Snapshots content and nulls out `plan_path`.
- Auto-complete detection: when the last step completes, `state show` and `state list` can display "completed" as a derived status (all steps done) without it being a separate lifecycle state.
- `reinit`: Archives the current plan_id, then creates a new plan_id with gen+1 (see below).

### Content Snapshots

Plan content is stored in a `plan_snapshots` table, not on the `plans` row itself. This avoids redundancy and naturally supports multiple snapshots per plan.

```sql
CREATE TABLE plan_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id      TEXT NOT NULL REFERENCES plans(plan_id),
    content      TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    event        TEXT NOT NULL,       -- 'init', 'complete'
    captured_at  TEXT NOT NULL
);
CREATE INDEX idx_snapshots_plan ON plan_snapshots(plan_id);
```

- **At init**: Snapshot the plan file content (event = `'init'`).
- **At last step completion**: Snapshot again (event = `'complete'`), auto-triggered when the last step completes. This means `complete_step()` gains a filesystem side effect — it must read the plan file from disk to capture the snapshot. It's currently a pure DB operation; this is a deliberate change in its contract. If the plan wasn't amended mid-execution, the snapshot is identical to init — that's fine, the duplication is negligible and the record is explicit.
- `state show` for archived plans renders from the most recent snapshot.

### Reinit Semantics

Under the new identity scheme, the plan_id includes the content hash. Changing plan content produces a different hash and therefore a different plan_id. So `reinit` becomes a two-phase operation:

1. **Archive the old plan**: Snapshot current state → transition old plan_id to `archived`.
2. **Init the new plan**: Create a new plan_id with the new content hash and gen+1. Take an init snapshot.

This preserves the history of the old plan while giving the revised plan a fresh start. The generation number links them by slug.

`reinit` on an already-archived plan is not allowed. Archive is final.

### Revised Schema

```sql
CREATE TABLE plans (
    plan_id      TEXT PRIMARY KEY,    -- slug-hash7-gen, stable identity
    plan_path    TEXT,                -- current file location, nullable for archived plans
    plan_slug    TEXT NOT NULL,       -- derived from filename, human-friendly
    plan_hash    TEXT NOT NULL,       -- full SHA-256
    phase_title  TEXT,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

-- steps, step_deps, checklist_items, step_artifacts all change FK from plan_path → plan_id
-- composite keys change accordingly: (plan_id, anchor), (plan_id, step_anchor, depends_on), etc.
```

### Plan Resolution

`resolve_plan()` currently does filesystem-based resolution (5-stage path cascade) and returns a `ResolveResult::Found { path, stage }`. This needs two changes:

1. **Carry plan_id in the result.** The unified return type becomes:
   - `ResolveResult::Found { plan_id: Option<String>, path: Option<PathBuf>, stage: ResolveStage }` — `plan_id` is `Some` for plans already initialized in the DB, `None` for new plans being init'd for the first time. `path` is `Some` for active plans on disk, `None` for archived plans found via DB fallback.

2. **DB fallback.** After the existing 5-stage filesystem cascade fails, search the DB by slug prefix or plan_id. This requires `resolve_plan()` to accept a `&StateDb` parameter (or a new `resolve_plan_with_db()` function).

CLI commands continue to accept file paths, slugs, or plan_ids as input — the resolution layer handles all three.

### `init_plan()` Signature

`init_plan()` currently takes a path and parsed plan structure. Under the new design, it also needs to:
- Read the plan file content itself (for snapshotting) — callers should not need to pass raw content.
- Generate the `plan_id` from the slug and content hash.
- Insert the init snapshot into `plan_snapshots`.
- Return the generated `plan_id` to the caller.

### Cleanup: Just `archive`

The current `state gc` command is removed. The new `state archive` command is the single cleanup operation.

- `state archive <plan>` — explicitly archive a plan. Snapshots content, transitions to `archived`, nulls out `plan_path`. Works on any active plan.
- **Orphan auto-archive:** Limited to read-only commands (`state list`, `state show`). When these commands encounter a plan whose file no longer exists on disk, they auto-archive it. Operational commands (`claim`, `start`, `heartbeat`, `complete`) do NOT auto-archive — a temporarily inaccessible file (network mount hiccup, worktree churn) should not trigger archival mid-workflow.
- **No purge command.** If someone truly needs to delete a row from the DB, that's a `sqlite3` session, not a product feature. The whole point of this work is to preserve history.

Net effect: one plan-level cleanup command (`archive`) replaces the current one (`gc`), but preserves instead of destroys.

### JSON Output

CLI JSON output includes both `plan_id` and `plan_path` in all response structs. This allows agents in tugplug/ to migrate from `plan_path` to `plan_id` incrementally rather than all at once.

```json
{
  "plan_id": "worker-markdown-pipeline-a3f7c2e-1",
  "plan_path": ".tugtool/tugplan-worker-markdown-pipeline.md",
  ...
}
```

For archived plans where the file no longer exists, `plan_path` is `null`.

### `state list` Command

A new command that lists all known plans with their status, step completion counts, and dates.

```
$ tugcode state list
PLAN                              STATUS      STEPS     CREATED     UPDATED
worker-markdown-pipeline-a3f7c2e  active      3/7       2026-03-28  2026-03-30
tug-worker-pool-b12d4f8           completed   4/4       2026-03-25  2026-03-27

$ tugcode state list --all
PLAN                              STATUS      STEPS     CREATED     UPDATED
worker-markdown-pipeline-a3f7c2e  active      3/7       2026-03-28  2026-03-30
tug-worker-pool-b12d4f8           completed   4/4       2026-03-25  2026-03-27
auth-middleware-9e3a1c0           archived    6/6       2026-03-10  2026-03-15
```

Default shows active plans (including completed). `--all` includes archived. The "completed" status in the display is derived (all steps done), not a separate DB state.

## Implementation Notes

### Do it as one migration

Since this is a single-developer project with a clean cut-over strategy, all schema changes land in one migration (v4 → v5). The user experience is: stop work, build, run any state command, verify, resume.

The v5 migration needs to read plan files from disk for snapshots, but `StateDb::open()` currently only takes a DB path. Either pass the repo root into `open()` / `ensure_schema()`, or defer the migration to the first command that knows the repo root.

Migration steps within the v5 upgrade (all in one EXCLUSIVE transaction):

1. Create new tables: `plans_v5`, `steps_v5`, `step_deps_v5`, `checklist_items_v5`, `step_artifacts_v5`, `plan_snapshots`.
2. For each plan in the old `plans` table:
   a. Derive `plan_slug` from `plan_path` (strip `.tugtool/tugplan-` and `.md`).
   b. Use existing `plan_hash` to get `hash7` (first 7 chars).
   c. Generate `plan_id` = `<slug>-<hash7>-1`.
   d. Try to read the plan file from disk at `plan_path`:
      - **File exists:** Insert into `plan_snapshots` (event = `'init'`). Set status = `'active'`.
      - **File missing:** Set status = `'archived'`, `plan_path` = NULL. No snapshot — we don't have the content and won't pretend we do.
   e. Insert into `plans_v5`.
3. Copy steps, step_deps, checklist_items, step_artifacts into v5 tables, remapping `plan_path` → `plan_id`.
4. Drop old tables, rename v5 tables to final names.
5. Create indexes.
6. Update `schema_version` to 5.

### Blast radius

The `plan_path` → `plan_id` FK change touches ~150 code locations:

| Area | Scope |
|------|-------|
| Schema + migrations | `state.rs` — 6 tables, 4 indexes, all composite keys |
| SQL queries | `state.rs` — 50+ queries |
| CLI commands | `commands/state.rs` — 8+ functions |
| JSON output structs | `output.rs` — 12+ structs (add `plan_id`, keep `plan_path`) |
| Other commands | `merge.rs`, `log.rs`, `commit.rs`, `worktree.rs`, `doctor.rs` |
| Plan resolution | `resolve.rs` — add DB fallback path, new return type |
| Error types | `error.rs` — 2 error variants |
| Integration tests | `state_integration_tests.rs` — 115+ references |
| Agent specs | `tugplug/` — 11+ agent docs reference `plan_path` in commands/JSON |

This is a big change but it's mechanical — the pattern is the same everywhere (replace `plan_path` FK with `plan_id` FK). The agents in tugplug/ can be updated to use `plan_id` gradually since JSON output includes both fields.

## Design Decisions

- **Two lifecycle states, not three.** `active` and `archived`. No `done` state — "completed" is derived from all steps being done, not a separate lifecycle state. Simpler model, fewer transitions to manage.
- **Auto-complete on last step:** When the last step completes, a completion snapshot is taken automatically. No separate `state complete-plan` command.
- **Orphan auto-archive is read-only only.** Only `list` and `show` auto-archive orphaned plans. Operational commands (`claim`, `start`, `heartbeat`, `complete`) do not — prevents accidental archival during transient file access issues.
- **`init_plan()` reads file content itself.** Callers pass the path; `init_plan()` reads, hashes, snapshots, and generates the plan_id. Simpler API surface.
- **`reinit` on archived plans:** Not allowed. Archive is final. A `clone` command could be added later if the need arises, but defer until then.
- **Restoring archived → active:** Not supported. No real-world need yet.
- **`show` for archived plans:** Renders from the most recent `plan_snapshots` entry.
- **`gc` removed, `archive` replaces it.** One cleanup command. Orphans auto-archive on contact (read-only commands only). No purge command.
- **JSON output:** Both `plan_id` and `plan_path` in all output structs. Agents migrate incrementally.
