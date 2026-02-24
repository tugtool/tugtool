## Phase 1.0: Accurate State Tracking {#phase-slug}

**Purpose:** Replace bulk force-completion with granular, per-item checklist tracking in the plan/implement pipeline so that `tugcode state show` reflects what actually happened during implementation.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | accurate-state-tracking |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-24 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Today, plan step progress tracking is a fiction. The coder-agent implements a step and returns a JSON blob with `tests_passed: true/false`. The implement skill then runs `tugcode state update {plan} {step} --all completed`, marking every task, test, and checkpoint as completed in one shot regardless of which items were actually verified. Finally, `tugcode commit` calls `complete_step(force=true)`, auto-completing any remaining items. The state DB ends up as a rubber stamp: 100% completion with a "Force-completed" annotation that contradicts the numbers.

The state system already has the machinery for granular tracking (individual checklist items with separate statuses in the `checklist_items` table), but the agent workflow never uses it. This phase wires up per-item reporting from agents through the orchestrator to the state DB, making the tracking truthful.

#### Strategy {#strategy}

- **Bottom-up**: Start with the Rust CLI changes (schema migration, batch update, deferred status, display modes) so the tooling supports granular tracking before agents are updated.
- **Clean break on coder output**: Replace `tests_passed`/`tests_run` with `checklist_status` in the coder-agent output contract. The coder reports tasks and tests only. Checkpoints are exclusively the reviewer's domain.
- **Deferred status as escape hatch**: Items requiring human verification get `deferred` status with a persisted reason, which is non-blocking for step completion. This replaces force-complete as the normal path.
- **Plan hash drift as a gate**: Drift detection warns on read (`state show`) and blocks `state update` / `state complete` unless `--allow-drift` is passed. For `tugcode commit`, drift warns and skips the state update while the git commit still proceeds.
- **Strict commit last**: The flip from `force=true` to `force=false` in `tugcode commit` is the capstone step, deployed only after batch updates and agent prompt changes are all in place.
- **Agent updates after CLI**: Update coder-agent and implement skill after the CLI supports batch updates, so there is a working target to code against.
- **Flag removal deferred**: Removal of global `--verbose` and `--quiet` flags is out of scope for this phase; it will be a separate future refactor.

#### Stakeholders / Primary Customers {#stakeholders}

1. Users running `tugcode state show` who need truthful progress visibility
2. The implement skill orchestrator that manages the coder/reviewer/commit lifecycle

#### Success Criteria (Measurable) {#success-criteria}

- `tugcode state show --checklist` displays every checklist item with its individual status (`[x]`, `[ ]`, `[~]`) and deferred reason (verified by integration test)
- `tugcode commit` defaults to `force=false` and succeeds when all items are `completed` or `deferred` (verified by integration test)
- A batch update via `--batch` on stdin updates N items in a single CLI invocation and single DB transaction (verified by integration test)
- The coder-agent output JSON includes `checklist_status` with per-item status for tasks and tests (verified by schema validation in implement skill)
- The reviewer-agent is the sole authority for checkpoint status reporting (verified by prompt inspection)
- `tugcode state show` warns when plan file hash has drifted from stored hash (verified by integration test)
- Mutating state commands (`state update`, `state complete`) block on plan drift unless `--allow-drift` is passed (verified by integration test)
- `tugcode commit` warns and skips state update on plan drift while allowing git commit to proceed (verified by integration test)

#### Scope {#scope}

1. Schema migration: add `reason` TEXT column to `checklist_items` table, bump schema version to 3
2. `deferred` status recognized in strict completion check
3. Batch update command for `tugcode state update` (JSON on stdin with `--batch` flag)
4. Three explicit display modes for `tugcode state show`: `--summary`, `--checklist`, `--json`
5. Plan hash drift detection: warning in `state show`, blocking gate with `--allow-drift` on `state update` / `state complete`
6. Coder-agent output contract: add `checklist_status` for tasks and tests only, remove `tests_passed`/`tests_run`
7. Reviewer-agent: sole authority for checkpoint verdicts, report per-checkpoint ordinals
8. Implement skill: use batch update with coder's checklist_status and reviewer's checkpoint ordinals
9. `tugcode commit` defaults to `force=false` (capstone, final step)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Automated test execution by the state system itself (state tracks what agents report)
- Manual checkpoint review queue (`tugcode state review` for human sign-off)
- Dash workflow changes (dashes use different tables and have no checklist items)
- Editing the plan document during implementation (plan remains immutable after `state init`)
- Removal of global `--verbose` and `--quiet` flags (separate future refactor)

#### Dependencies / Prerequisites {#dependencies}

- Existing `checklist_items` table in state.db stores full item text, kind, ordinal, and status
- Existing `plan_hash` field in `plans` table (stored at `init_plan` time)
- Existing `compute_plan_hash()` function in `tugtool-core` (exported via `lib.rs`)
- Design document: `roadmap/accurate-state-tracking.md`

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` in `.cargo/config.toml`): all Rust code must compile warning-free
- Tests use `cargo nextest run` from the `tugcode/` directory
- Agent prompt files are Markdown in `tugplug/agents/` and `tugplug/skills/`

#### Assumptions {#assumptions}

- The implement skill orchestrator can parse coder-agent JSON and construct batch update commands
- The `--checklist` display mode can query `checklist_items` table which already stores full item text
- Consumers of coder-agent output are: implement skill (parsing + validation schema), reviewer-agent (reads coder context), and auditor-agent (does NOT reference coder output fields directly)

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Clean break on coder-agent output -- tasks and tests only (DECIDED) {#d01-coder-clean-break}

**Decision:** Replace `tests_passed` and `tests_run` fields with `checklist_status` in the coder-agent output contract. The coder reports status for tasks and tests only. Checkpoints are NOT reported by the coder -- the reviewer is the sole authority for checkpoint verdicts. No backward compatibility. Note: `build_passed` does not exist in coder-agent.md -- build status is reported via `build_and_test_report.build.exit_code`. The `build_and_test_report` object is retained for detailed build/test/lint output.

**Rationale:**
- There are no external users of the coder-agent output format
- A clean break produces a simpler schema than maintaining legacy fields alongside new ones
- `checklist_status` maps directly to state DB operations, eliminating interpretation guesswork
- Checkpoints verify the coder's work -- having the coder self-report checkpoint status is a conflict of interest

**Implications:**
- Coder-agent prompt must be updated to document the new output schema with tasks and tests only
- Implement skill must parse `checklist_status` instead of `tests_passed`/`tests_run`
- All coder-agent examples and error templates must be updated
- The implement skill's coder validation schema (~line 966 in SKILL.md) also references `tests_passed` and `tests_run` and must be updated
- All consumers must be verified before migration: implement skill, reviewer-agent, auditor-agent

#### [D02] Deferred items are non-blocking for step completion with persisted reason (DECIDED) {#d02-deferred-non-blocking}

**Decision:** Modify the `complete_step` strict mode WHERE clause to `status NOT IN ('completed', 'deferred')` so that deferred items do not prevent step completion. Persist a `reason` TEXT column on `checklist_items` so the deferred reason is stored in the DB and displayed in `state show`.

**Rationale:**
- Some checklist items genuinely require human verification that agents cannot perform
- Force-completion should be an error-recovery escape hatch, not the standard path
- Deferred items remain visible in `state show` for human follow-up
- Persisting the reason makes the audit trail meaningful -- users see WHY something was deferred

**Implications:**
- `complete_step` in `state.rs` needs a one-line WHERE clause change in the `checklist_items` query (the query at ~line 869 that counts incomplete items). The substep completion query (`status != 'completed'` on the `steps` table) is NOT modified -- substeps must still be fully completed.
- Schema migration: add `reason TEXT` column to `checklist_items`, bump schema version from 2 to 3
- All update paths that set `status=deferred` must require and persist a non-empty `reason` (batch and per-item update paths)
- Display logic must show deferred reasons in `--checklist` mode

#### [D03] Batch update via stdin JSON with --batch flag (DECIDED) {#d03-batch-stdin}

**Decision:** Add a `--batch` flag to `tugcode state update` that reads a JSON array from stdin, updating multiple checklist items in a single CLI invocation and single DB transaction.

**Rationale:**
- Per-item tracking means N items per step; N separate CLI invocations is wasteful
- A single transaction ensures atomicity: either all items update or none do
- JSON on stdin is the simplest contract for the orchestrator to construct

**Implications:**
- New `--batch` flag on `StateCommands::Update` that conflicts with individual item flags
- Add a new `batch_update_checklist` method in `state.rs` that wraps all updates in an explicit transaction (the existing `update_checklist` does NOT use transactions -- each update is a separate `execute` call). The new method opens a transaction, iterates the batch entries, and commits atomically.
- Stdin parsing with `serde_json::from_reader`
- Batch accepts only `completed` and `deferred` as valid status values
- Re-opening items to `open` is blocked by default and requires non-batch per-item update with explicit `--allow-reopen` (manual recovery only)

#### [D05] Three explicit display modes for state show (DECIDED) {#d05-display-modes}

**Decision:** Add `--summary` (default), `--checklist` (new per-item view), and `--json` (unchanged) as mutually exclusive display modes on `tugcode state show`.

**Rationale:**
- `--summary` makes the existing default behavior explicit and named
- `--checklist` fills the display gap: item-level text and status are in the DB but never shown
- Named modes provide precise behavior instead of vague global flags

**Implications:**
- `--summary` and `--checklist` flags on `StateCommands::Show`, mutually exclusive with each other and with global `--json`
- New query in `state.rs` to fetch all checklist items for a plan (not just aggregates)
- New display function `print_checklist_view` in `commands/state.rs`
- Status markers: `[x]` completed, `[ ]` open, `[~]` deferred (with reason annotation)

#### [D06] Plan hash drift detection: warn on read, block on mutation (DECIDED) {#d06-hash-drift-gate}

**Decision:** Check plan hash drift in all relevant commands. For read-only command `state show`, display a warning. For mutating state commands (`state update`, `state complete`), block and return an error unless `--allow-drift` is passed. For `tugcode commit`, drift causes a warning and skips state update while git commit proceeds.

**Rationale:**
- The plan document is the source of truth during planning; the state DB is the source of truth during implementation
- If someone edits the plan after `state init`, the DB may not reflect the current plan
- Mutating state against a drifted plan risks recording status for items that no longer exist or have changed
- `--allow-drift` provides an explicit escape hatch for intentional plan edits

**Implications:**
- `run_state_show` computes hash and warns if mismatched (non-blocking)
- `run_state_update`, `run_state_complete` compute hash and error if mismatched (blocking unless `--allow-drift`)
- `run_commit` computes hash and warns/skips state update if mismatched (git commit still succeeds)
- New `--allow-drift` flag on `state update` and `state complete`
- Uses existing `tugtool_core::compute_plan_hash()` and `PlanState.plan_hash`

#### [D07] Strict completion is the capstone step (DECIDED) {#d07-strict-default}

**Decision:** Change `commit.rs` from `complete_step(force=true)` to `complete_step(force=false)` as the FINAL step, after batch updates and agent prompt changes are deployed.

**Rationale:**
- Flipping to strict mode before per-item tracking is in place would cause all normal flows to fail state completion
- With granular tracking and deferred status, the normal flow should complete in strict mode
- Force-complete remains available via `tugcode state complete --force` for error recovery
- Deploying this last ensures the entire pipeline supports strict mode before it's enforced

**Implications:**
- One-line change in `commit.rs`: `true` becomes `false`
- When strict completion fails, the commit still happens but the state update is skipped; a warning is printed
- The orchestrator must ensure all items are ticked (completed or deferred) before calling `tugcode commit`
- This step MUST be the last execution step in the plan

#### [D08] Reviewer is sole authority for checkpoint verdicts (DECIDED) {#d08-reviewer-checkpoints}

**Decision:** The reviewer-agent is the sole authority for reporting checkpoint status. The coder-agent does NOT report checkpoint status in `checklist_status`. The reviewer-agent output includes ordinal-indexed checkpoint verdicts that the implement skill maps to batch update items.

**Rationale:**
- Checkpoints verify the coder's work -- having the coder self-report checkpoint status is a conflict of interest
- The reviewer already verifies checkpoints via `plan_conformance.checkpoints[]`
- Clean separation: coder owns tasks+tests, reviewer owns checkpoints
- Ordinal-based mapping aligns with the batch update schema

**Implications:**
- Coder-agent `checklist_status` contains `tasks` and `tests` arrays only -- no `checkpoints`
- Reviewer-agent `plan_conformance.checkpoints[]` gets an `ordinal` field
- Implement skill constructs batch update by combining coder's task/test statuses with reviewer's checkpoint verdicts

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Schema Migration {#schema-migration}

**Spec S05: Schema Version 3 Migration** {#s05-schema-migration}

Add `reason` column to `checklist_items` table:

```sql
ALTER TABLE checklist_items ADD COLUMN reason TEXT;
```

- Bump `schema_version` from 2 to 3
- Migration runs in `StateDb::open()` when existing DB has version 2
- Existing rows get `reason = NULL` (default)
- New `open` or `completed` items have `reason = NULL`; `deferred` items have a non-null reason string

#### 1.0.1.2 Batch Update Input Schema {#batch-update-schema}

**Spec S01: Batch Update JSON Schema** {#s01-batch-update}

```json
[
  {"kind": "task", "ordinal": 0, "status": "completed"},
  {"kind": "task", "ordinal": 1, "status": "completed"},
  {"kind": "test", "ordinal": 0, "status": "completed"},
  {"kind": "test", "ordinal": 2, "status": "deferred", "reason": "manual verification required"},
  {"kind": "checkpoint", "ordinal": 0, "status": "completed"}
]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | string | yes | One of: `task`, `test`, `checkpoint` |
| `ordinal` | integer | yes | 0-indexed position within the kind for that step |
| `status` | string | yes | One of: `completed`, `deferred` (batch does NOT accept `open`) |
| `reason` | string | conditional | Required when status is `deferred`; ignored otherwise |

**Integrity rules:**
- Array must contain at least one entry
- Each `(kind, ordinal)` pair must correspond to an existing checklist item for the step
- Duplicate `(kind, ordinal)` entries are rejected (error listing the duplicates)
- Invalid/unknown kind values are rejected
- Ordinals outside valid range for the step are rejected (error listing the out-of-range ordinal and valid range)
- Status must be `completed` or `deferred` only; `open` is not accepted (re-opening items requires existing per-item update path for manual recovery)
- Idempotency: setting an already-completed item to `completed` is a no-op (not an error)
- The batch executes in a single DB transaction; any validation error rejects the entire batch

#### 1.0.1.3 Coder-Agent Checklist Status Schema {#coder-checklist-schema}

**Spec S02: Coder-Agent checklist_status Field** {#s02-coder-checklist}

```json
{
  "checklist_status": {
    "tasks": [
      {"ordinal": 0, "status": "completed"},
      {"ordinal": 1, "status": "completed"},
      {"ordinal": 2, "status": "deferred", "reason": "manual verification required"}
    ],
    "tests": [
      {"ordinal": 0, "status": "completed"},
      {"ordinal": 1, "status": "completed"}
    ]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `checklist_status` | object | yes | Per-item checklist reporting |
| `checklist_status.tasks` | array | yes | Status of each task item |
| `checklist_status.tests` | array | yes | Status of each test item |
| `[].ordinal` | integer | yes | 0-indexed position of the item |
| `[].status` | string | yes | One of: `completed`, `deferred` |
| `[].reason` | string | conditional | Required when status is `deferred` |

The coder reports status for tasks and tests only. Checkpoints are NOT included -- the reviewer is the sole authority for checkpoint verdicts (see [D08]).

#### 1.0.1.4 Reviewer Checkpoint Ordinal Extension {#reviewer-checkpoint-ordinal}

**Spec S03: Reviewer Checkpoint Ordinal** {#s03-reviewer-ordinal}

```json
{
  "plan_conformance": {
    "checkpoints": [
      {"ordinal": 0, "command": "cargo nextest run", "status": "PASS", "output": "42 tests passed"},
      {"ordinal": 1, "command": "tugcode --help shows expected", "status": "PASS", "output": "..."}
    ]
  }
}
```

Add `ordinal` (0-indexed integer) to each checkpoint entry. The implement skill uses this to construct batch update entries for checkpoint items after reviewer approval. The reviewer is the sole authority for checkpoint status (see [D08]).

Checkpoint status mapping for implement skill:
- `PASS` -> batch entry `status="completed"`
- Non-pass verdicts (`FAIL`, `BLOCKED`, `UNVERIFIED`, or equivalent reviewer non-pass status) -> batch entry `status="deferred"` with `reason` derived from reviewer output (`output` or explicit failure reason)

#### 1.0.1.5 Display Mode Semantics {#display-modes}

**Spec S04: State Show Display Modes** {#s04-display-modes}

| Mode | Flag | Behavior |
|------|------|----------|
| Summary | `--summary` (default) | Aggregate counts per step with progress bars. Identical to current default. |
| Checklist | `--checklist` | Every checklist item with its status, organized by step and kind. Shows deferred reasons. |
| JSON | `--json` | Full machine-readable dump. Must include per-item text, status, and reason. |

**Checklist mode status markers:**
- `[x]` -- completed
- `[ ]` -- open (pending)
- `[~]` -- deferred (with reason annotation, e.g., `[~] Manual: verify UI renders correctly  (deferred: manual verification required)`)

**Mutual exclusivity:** `--summary`, `--checklist`, and `--json` are mutually exclusive. If none specified, `--summary` is the default.

#### 1.0.1.6 Drift Detection Semantics {#drift-detection}

**Spec S06: Plan Hash Drift Detection** {#s06-drift-detection}

| Command | Behavior on drift | Override |
|---------|-------------------|----------|
| `state show` | Print warning to stderr, continue | None needed |
| `state update` | Return error, reject operation | `--allow-drift` |
| `state complete` | Return error, reject operation | `--allow-drift` |
| `tugcode commit` | Print warning, skip state update, git commit proceeds | None (git commit always succeeds) |

Drift is detected by comparing the current plan file SHA-256 hash (via `compute_plan_hash()`) against the stored `plan_hash` in the `plans` table.

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New files (if any) {#new-files}

No new files. All changes are modifications to existing files.

#### 1.0.2.2 Symbols to add / modify {#symbols}

**Table T01: Rust Symbol Changes** {#t01-rust-symbols}

| Symbol | Kind | Location | Action | Notes |
|--------|------|----------|--------|-------|
| `StateCommands::Show::summary` | field | `commands/state.rs` | Add | `--summary` flag |
| `StateCommands::Show::checklist` | field | `commands/state.rs` | Add | `--checklist` flag |
| `StateCommands::Update::batch` | field | `commands/state.rs` | Add | `--batch` flag (read JSON from stdin) |
| `StateCommands::Update::allow_drift` | field | `commands/state.rs` | Add | `--allow-drift` flag |
| `StateCommands::Update::allow_reopen` | field | `commands/state.rs` | Add | `--allow-reopen` flag for manual recovery when setting status to `open` |
| `StateCommands::Complete::allow_drift` | field | `commands/state.rs` | Add | `--allow-drift` flag |
| `BatchUpdateEntry` | struct | `commands/state.rs` or `state.rs` | Add | Deserialization target for batch items; fields: `kind`, `ordinal`, `status`, `reason` |
| `run_state_show` | fn | `commands/state.rs` | Modify | Add display mode logic, add hash drift warning |
| `run_state_update` | fn | `commands/state.rs` | Modify | Add batch mode path, add drift gate |
| `run_state_complete` | fn | `commands/state.rs` | Modify | Add drift gate |
| `print_checklist_view` | fn | `commands/state.rs` | Add | Render checklist display mode with reasons |
| `StateDb::complete_step` | method | `state.rs` | Modify | WHERE clause: `status NOT IN ('completed', 'deferred')` |
| `StateDb::batch_update_checklist` | method | `state.rs` | Add | Transactional batch update with validation |
| `StateDb::get_checklist_items` | method | `state.rs` | Add | Query all items with text, status, reason for a plan |
| `ChecklistItemDetail` | struct | `state.rs` | Add | Return type: `step_anchor`, `kind`, `ordinal`, `text`, `status`, `reason` |
| `commit.rs` force parameter | literal | `commands/commit.rs` | Modify | `true` -> `false` (Step 4) |
| Schema migration v2->v3 | SQL | `state.rs` | Add | `ALTER TABLE checklist_items ADD COLUMN reason TEXT` |

**Table T02: Agent Prompt Changes** {#t02-agent-prompts}

| File | Change |
|------|--------|
| `tugplug/agents/coder-agent.md` | Replace `tests_passed`/`tests_run` with `checklist_status` (tasks and tests only, no checkpoints) |
| `tugplug/agents/reviewer-agent.md` | Add `ordinal` field to `plan_conformance.checkpoints[]` entries; document reviewer as sole checkpoint authority |
| `tugplug/skills/implement/SKILL.md` | Replace `--all completed` with batch update construction; combine coder task/test status with reviewer checkpoint verdicts; update coder validation schema (~line 966) |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `complete_step` with deferred items, batch validation, schema migration | Core logic, edge cases |
| **Integration** | Test batch update CLI, display modes, hash drift, commit strict mode | End-to-end operations |

**Key test scenarios:**

1. **Schema migration**: Opening a v2 DB migrates to v3 with `reason` column
2. **Deferred status in strict completion**: `complete_step(force=false)` succeeds when all items are `completed` or `deferred`
3. **Deferred status blocks with open items**: `complete_step(force=false)` fails when items are still `open`
4. **Batch update**: Single CLI call updates multiple items; verify each item's status and reason in DB
5. **Batch validation -- duplicates rejected**: Duplicate `(kind, ordinal)` entries return error
6. **Batch validation -- open status rejected**: Status `open` in batch returns error
7. **Batch validation -- idempotency**: Setting already-completed item to `completed` is a no-op
8. **Checklist display mode**: `state show --checklist` outputs per-item text, status markers, and deferred reasons
9. **Summary display mode**: `state show --summary` matches current default output
10. **JSON display includes per-item detail**: `state show --json` includes item text, status, and reason
11. **Plan hash drift warning in show**: Modify plan file after init, verify warning in `state show`
12. **Plan hash drift blocks update**: Modify plan file after init, verify `state update` fails without `--allow-drift`
13. **Plan hash drift allow-drift override**: Verify `state update --allow-drift` succeeds despite drift
14. **Strict commit default**: `tugcode commit` with incomplete items prints warning, commit still succeeds
15. **Per-item deferred reason required**: Non-batch `state update --status deferred` without reason is rejected
16. **Reopen requires explicit override**: Non-batch `state update --status open` is rejected unless `--allow-reopen` is provided

---

### 1.0.3b Documentation Plan {#documentation-plan}

No external documentation updates are required. All changes are internal to the tugcode CLI and agent prompt files. The design document at `roadmap/accurate-state-tracking.md` serves as the authoritative reference. New CLI flags (`--batch`, `--checklist`, `--summary`, `--allow-drift`, `--allow-reopen`) receive help text via clap annotations in the steps where they are introduced.

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Schema Migration and Deferred Status Recognition {#step-0}

**Commit:** `feat(state): add reason column to checklist_items and recognize deferred status`

**References:** [D02] Deferred non-blocking, Spec S05, Table T01, (#schema-migration, #context, #strategy)

**Artifacts:**
- Modified `tugcode/crates/tugtool-core/src/state.rs`: schema migration v2->v3, deferred-aware WHERE clause in `complete_step`

**Tasks:**
- [ ] Add `ALTER TABLE checklist_items ADD COLUMN reason TEXT` migration in `StateDb::open()`, triggered when schema version is 2
- [ ] Update `INSERT INTO schema_version` to insert version 3 for new databases
- [ ] Update migration logic to bump version from 2 to 3 after ALTER
- [ ] Modify `complete_step` in `state.rs`: change the `checklist_items` strict mode WHERE clause (~line 869) from `status != 'completed'` to `status NOT IN ('completed', 'deferred')`. Note: ONLY modify the checklist_items query. The substep completion query (`status != 'completed'` on the `steps` table at ~line 886) is NOT changed -- substeps must still be fully completed.

**Tests:**
- [ ] Unit test: `test_schema_migration_v2_to_v3` -- create a v2 DB, open it, verify schema version is 3 and `reason` column exists
- [ ] Unit test: `test_new_db_has_schema_v3` -- verify fresh DB has schema version 3
- [ ] Unit test: `test_complete_step_strict_with_deferred` -- mark some items `completed`, some `deferred`, verify strict completion succeeds
- [ ] Unit test: `test_complete_step_strict_fails_with_open_and_deferred` -- mark some `completed`, some `deferred`, leave some `open`, verify strict completion fails
- [ ] Unit test: update `test_open_creates_db_and_schema_version_is_2` (line 1895) to assert `schema_version == 3` and rename to `test_open_creates_db_and_schema_version_is_3`
- [ ] Unit test: update `test_open_is_idempotent` (line 1909) to assert `schema_version == 3` instead of 2
- [ ] Unit test: existing `test_complete_step_strict_mode_success` and `test_complete_step_force_mode` still pass

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings

**Rollback:**
- Revert migration logic and WHERE clause change in `state.rs`

**Commit after all checkpoints pass.**

---

#### Step 1: Batch Update Command {#step-1}

**Depends on:** #step-0

**Commit:** `feat(state): add --batch flag for bulk checklist updates via stdin JSON`

**References:** [D03] Batch stdin, Spec S01, Table T01, (#batch-update-schema)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/state.rs`: `--batch` flag on `Update`, batch parsing and execution
- Modified `tugcode/crates/tugcode/src/main.rs`: destructure new `batch` field in `StateCommands::Update` match arm (lines 84-108) and pass it to `run_state_update`
- Modified `tugcode/crates/tugtool-core/src/state.rs`: new `batch_update_checklist` method with explicit transaction

**Tasks:**
- [ ] Add `batch: bool` flag to `StateCommands::Update` in `commands/state.rs`, conflicting with individual item flags (`--task`, `--test`, `--checkpoint`, `--all-tasks`, `--all-tests`, `--all-checkpoints`, `--all`). Include clap help text: "Read batch update JSON from stdin. Mutually exclusive with individual item flags."
- [ ] Add `allow_reopen: bool` flag to `StateCommands::Update` with help text: "Allow setting item status back to open (manual recovery only)."
- [ ] Update `main.rs` `StateCommands::Update` match arm (lines 84-108): add `batch` to the destructuring pattern and pass it to `run_state_update`
- [ ] Update `run_state_update` signature to accept the new `batch: bool` parameter
- [ ] Define `BatchUpdateEntry` struct with `kind: String`, `ordinal: usize`, `status: String`, `reason: Option<String>` fields, deriving `Deserialize`
- [ ] In `run_state_update`, when `--batch` is set, read JSON array from stdin via `serde_json::from_reader(std::io::stdin())`
- [ ] Validate each entry: kind must be `task`/`test`/`checkpoint`; status must be `completed`/`deferred` only (reject `open`); ordinal must be in valid range for the step; `reason` required when status is `deferred`
- [ ] Reject duplicate `(kind, ordinal)` entries with error listing the duplicates
- [ ] Idempotency: setting an already-completed item to `completed` is a no-op (not an error), counts as 0 items updated for that entry
- [ ] Add new `batch_update_checklist(&mut self, ...)` method on `StateDb` that opens an explicit transaction via `self.conn.transaction()`, iterates all batch entries, executes each update (including writing `reason` to the new column), and commits atomically. Note: `transaction()` requires `&mut self` on `Connection`, so `batch_update_checklist` takes `&mut self` on `StateDb`. Callers in `run_state_update` must use `let mut db` (existing code at line 626 uses `let db`).
- [ ] In non-batch/per-item update path, enforce: `status=deferred` requires non-empty reason, and `status=open` requires `--allow-reopen`
- [ ] Return JSON response with count of items updated

**Tests:**
- [ ] Integration test: `test_batch_update_success` -- init a plan, batch-update multiple items via stdin, verify each item status and reason in DB
- [ ] Integration test: `test_batch_update_invalid_kind` -- send unknown kind, verify entire batch rejected
- [ ] Integration test: `test_batch_update_out_of_range_ordinal` -- send ordinal beyond item count, verify rejection with valid range in error
- [ ] Integration test: `test_batch_update_duplicate_entries` -- send duplicate `(kind, ordinal)`, verify rejection listing duplicates
- [ ] Integration test: `test_batch_update_open_status_rejected` -- send status `open`, verify rejection
- [ ] Integration test: `test_batch_update_idempotent` -- set already-completed item to `completed`, verify no error and 0 items updated for that entry
- [ ] Integration test: `test_batch_update_deferred_requires_reason` -- send `deferred` without `reason`, verify rejection
- [ ] Integration test: `test_batch_update_conflict_with_individual_flags` -- verify `--batch` and `--task` cannot be used together
- [ ] Integration test: `test_per_item_deferred_requires_reason` -- non-batch deferred update without reason is rejected
- [ ] Integration test: `test_per_item_open_requires_allow_reopen` -- non-batch open update rejected without `--allow-reopen`, succeeds with it

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings
- [ ] Manual: `echo '[{"kind":"task","ordinal":0,"status":"completed"}]' | tugcode state update <plan> <step> --worktree <wt> --batch` succeeds

**Rollback:**
- Revert additions to `commands/state.rs` and `state.rs`

**Commit after all checkpoints pass.**

---

#### Step 2: Display Modes and Plan Hash Drift Detection {#step-2}

**Depends on:** #step-0

**Commit:** `feat(state): display modes and plan hash drift detection`

**References:** [D05] Display modes, [D06] Hash drift gate, Spec S04, Spec S06, Table T01, (#display-modes, #drift-detection)

> This step is split into substeps with separate commits and checkpoints.

##### Step 2.1: Add --summary and --checklist Display Modes {#step-2-1}

**Commit:** `feat(state): add --summary and --checklist display modes to state show`

**References:** [D05] Display modes, Spec S04, Table T01, (#display-modes)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/state.rs`: `--summary` and `--checklist` flags on `Show`, new `print_checklist_view` function
- Modified `tugcode/crates/tugcode/src/main.rs`: destructure new `summary` and `checklist` fields in `StateCommands::Show` match arm (line 127) and pass them to `run_state_show`
- Modified `tugcode/crates/tugtool-core/src/state.rs`: new `ChecklistItemDetail` struct and `get_checklist_items` method

**Tasks:**
- [ ] Add `summary: bool` and `checklist: bool` flags to `StateCommands::Show`, mutually exclusive with each other (use clap groups or manual validation). Help text: `--summary` "Show aggregate counts per step (default)", `--checklist` "Show every checklist item with its status"
- [ ] Update `main.rs` `StateCommands::Show` match arm (line 127): add `summary` and `checklist` to the destructuring pattern and pass them to `run_state_show`
- [ ] Update `run_state_show` signature to accept the new `summary: bool` and `checklist: bool` parameters
- [ ] Add `ChecklistItemDetail` struct to `state.rs` with fields: `step_anchor: String`, `kind: String`, `ordinal: usize`, `text: String`, `status: String`, `reason: Option<String>`
- [ ] Add `get_checklist_items(plan_path) -> Vec<ChecklistItemDetail>` method to `StateDb` that queries the `checklist_items` table and returns all items for the plan, including the `reason` column
- [ ] Implement `print_checklist_view` function that renders per-item output with `[x]`/`[ ]`/`[~]` markers, grouped by step and kind. For deferred items, append reason: `[~] item text  (deferred: reason)`
- [ ] Update `run_state_show` to dispatch on display mode: summary (default), checklist, or JSON
- [ ] Ensure `--json` output includes per-item text, status, and reason (verify `PlanState` serialization includes item detail, or extend it)

**Tests:**
- [ ] Integration test: `test_state_show_summary_default` -- verify default output matches current format
- [ ] Integration test: `test_state_show_checklist_mode` -- init plan, complete some items, verify checklist output shows `[x]`/`[ ]` markers with item text
- [ ] Integration test: `test_state_show_checklist_deferred_with_reason` -- mark items as deferred with reason, verify `[~]` marker and reason text appear
- [ ] Integration test: `test_state_show_json_includes_items` -- verify JSON output includes per-item text, status, and reason
- [ ] Unit test: `test_display_mode_mutual_exclusivity` -- verify `--summary --checklist` is rejected

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings
- [ ] `tugcode state show <plan> --checklist` renders per-item view (manual verification)

**Rollback:**
- Revert changes to `commands/state.rs` and `state.rs`

**Commit after all checkpoints pass.**

---

##### Step 2.2: Plan Hash Drift Detection {#step-2-2}

**Depends on:** #step-2-1

**Commit:** `feat(state): add plan hash drift detection to state commands`

**References:** [D06] Hash drift gate, Spec S06, Table T01, (#drift-detection, #context)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/state.rs`: `--allow-drift` flags on `Update` and `Complete`, hash drift check in `run_state_show` (warning), `run_state_update` (blocking), `run_state_complete` (blocking)
- Modified `tugcode/crates/tugcode/src/main.rs`: destructure new `allow_drift` field in `StateCommands::Update` match arm (lines 84-108) and `StateCommands::Complete` match arm (lines 118-126), pass to respective functions
- Modified `tugcode/crates/tugcode/src/commands/commit.rs`: hash drift check integrated into existing `state_update_failed` flow

**Tasks:**
- [ ] Add `--allow-drift` flag to `StateCommands::Update` and `StateCommands::Complete`. Help text: "Allow operation even if plan file has been modified since state was initialized"
- [ ] Update `main.rs` `StateCommands::Update` match arm (lines 84-108): add `allow_drift` to the destructuring pattern and pass it to `run_state_update`
- [ ] Update `main.rs` `StateCommands::Complete` match arm (lines 118-126): add `allow_drift` to the destructuring pattern and pass it to `run_state_complete`
- [ ] Update `run_state_update` and `run_state_complete` signatures to accept the new `allow_drift: bool` parameter
- [ ] Extract a shared `check_plan_drift(repo_root, plan_path, db) -> Result<Option<DriftInfo>>` helper that computes current hash via `tugtool_core::compute_plan_hash()` and compares against `PlanState.plan_hash`. Note: `compute_plan_hash` reads the file, so it needs an absolute path. In `run_state_show`, the current code only has `plan_rel`; add an absolute path by joining `repo_root` + `plan_rel` (or retain the `plan_abs` from the resolve step, as `run_state_update` already has `_plan_abs` at line 523). In `run_state_show`, construct `plan_abs` as `repo_root.join(&plan_rel)`.
- [ ] In `run_state_show`: call drift check; if drift detected, print warning to stderr before output
- [ ] In `run_state_update`: call drift check; if drift detected and `--allow-drift` not set, return error: "Plan file has been modified since state was initialized. Use --allow-drift to proceed."
- [ ] In `run_state_complete`: same drift check and `--allow-drift` gate as `run_state_update`
- [ ] In `run_commit` (`commit.rs`): call drift check before `complete_step`. If drift detected, set `state_update_failed = true` and add a drift warning message to `state_warnings`, skip the `complete_step` call (git commit still proceeds). Integrate into the existing `state_update_failed` / `state_warnings` flow (lines 148-179) rather than adding a separate code path.
- [ ] Include stored hash (truncated) and current hash (truncated) in all drift messages

**Tests:**
- [ ] Integration test: `test_plan_hash_drift_no_warning` -- init plan, show state, verify no drift warning
- [ ] Integration test: `test_plan_hash_drift_warning_in_show` -- init plan, modify plan file, show state, verify warning appears
- [ ] Integration test: `test_plan_hash_drift_blocks_update` -- init plan, modify plan file, attempt batch update, verify error
- [ ] Integration test: `test_plan_hash_drift_allow_drift_override` -- init plan, modify plan file, batch update with `--allow-drift`, verify success
- [ ] Integration test: `test_plan_hash_drift_blocks_complete` -- init plan, modify plan file, attempt state complete, verify error
- [ ] Integration test: `test_plan_hash_drift_commit_warns` -- init plan, modify plan file, commit, verify git commit succeeds but state update skipped

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings

**Rollback:**
- Remove drift check logic from `state.rs`, `commit.rs`; remove `--allow-drift` flags

**Commit after all checkpoints pass.**

---

#### Step 2 Summary {#step-2-summary}

**Depends on:** #step-2-2

**Commit:** `test(state): verify display modes and drift detection integration`

**References:** [D05] Display modes, [D06] Hash drift gate, (#display-modes, #drift-detection)

After completing Steps 2.1--2.2, you will have:
- Three explicit display modes (`--summary`, `--checklist`, `--json`) on `tugcode state show` with deferred reason display
- Plan hash drift detection: warning in `state show`, blocking gate in mutating commands with `--allow-drift` override

**Final Step 2 Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- full test suite passes

---

#### Step 3: Agent Prompt Updates {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(agents): update agent prompts for granular state tracking`

**References:** [D01] Coder clean break, [D08] Reviewer checkpoints, Spec S02, Spec S03, Table T02, (#coder-checklist-schema, #reviewer-checkpoint-ordinal)

> This step is split into substeps with separate commits and checkpoints.
> All consumers of coder output must be verified before migration.

##### Step 3.1: Verify All Coder Output Consumers (Gate, No Commit) {#step-3-1}

**References:** [D01] Coder clean break, [D08] Reviewer checkpoints, Table T02, (#coder-checklist-schema)

**Artifacts:**
- No file changes (verification-only step)

**Tasks:**
- [ ] Verify `tugplug/skills/implement/SKILL.md`: locate all references to `tests_passed`, `tests_run`, and coder output parsing. Document the line numbers and context.
- [ ] Verify `tugplug/skills/implement/SKILL.md` coder validation schema (~line 966): confirm it references `tests_passed` and `tests_run` as required fields
- [ ] Verify `tugplug/agents/reviewer-agent.md`: confirm it reads coder results via context (not by field name). The reviewer references "coder's output" and "build and test report" generically, not `tests_passed`/`tests_run` field names.
- [ ] Verify `tugplug/agents/auditor-agent.md`: confirm it does NOT reference `tests_passed`, `tests_run`, or any coder-specific output field names
- [ ] Verify `tugplug/agents/architect-agent.md`: confirm it does NOT reference coder output fields
- [ ] Document findings: list of files and line numbers that must change in Steps 3.2-3.4

**Tests:**
- [ ] Deferred: this is a verification step with no code changes

**Checkpoint:**
- [ ] Consumer verification complete: all files referencing coder output fields are identified

**Rollback:**
- No changes to revert

No commit for this step (verification gate only).

---

##### Step 3.2: Update Coder-Agent Output Contract {#step-3-2}

**Depends on:** #step-3-1

**Commit:** `feat(agents): replace tests_passed/tests_run with checklist_status in coder-agent`

**References:** [D01] Coder clean break, [D08] Reviewer checkpoints, Spec S02, Table T02, (#coder-checklist-schema)

**Artifacts:**
- Modified `tugplug/agents/coder-agent.md`: new output contract with `checklist_status` for tasks and tests only

**Tasks:**
- [ ] Remove `tests_passed` and `tests_run` fields from the output contract section (note: `build_passed` does NOT exist in coder-agent.md -- build status is in `build_and_test_report.build.exit_code` and is retained)
- [ ] Add `checklist_status` object to the output contract with `tasks` and `tests` arrays only per Spec S02 -- no `checkpoints` array (reviewer owns checkpoints per [D08])
- [ ] Update the output JSON example to show `checklist_status` with tasks and tests only
- [ ] Update the output field description table to document `checklist_status` and its sub-fields
- [ ] Update the error/failure output examples (lines ~284-312) to include `checklist_status` with appropriate statuses instead of `tests_passed`/`tests_run`
- [ ] Update the "Record command, exit code" instructions (line ~196) to reference `checklist_status` instead of `tests_passed`/`tests_run`
- [ ] Add instructions for the coder to map each plan task/test to an ordinal and report its status. Explicitly state: "Do NOT report checkpoint status. Checkpoints are verified by the reviewer."
- [ ] Clarify that `build_and_test_report` is retained for detailed build/test/lint output while `checklist_status` is the structured per-item report

**Tests:**
- [ ] Deferred: verify by running the implement skill with the updated coder-agent (manual integration test)

**Checkpoint:**
- [ ] Coder-agent prompt contains `checklist_status` with `tasks` and `tests` arrays only
- [ ] No `checkpoints` array in `checklist_status`
- [ ] No references to `tests_passed` or `tests_run` remain in `coder-agent.md` as top-level output fields

**Rollback:**
- Revert `coder-agent.md` to previous version

**Commit after all checkpoints pass.**

---

##### Step 3.3: Update Reviewer-Agent for Checkpoint Ordinals {#step-3-3}

**Depends on:** #step-3-2

**Commit:** `feat(agents): add ordinal field to reviewer-agent checkpoint verdicts`

**References:** [D08] Reviewer checkpoints, Spec S03, Table T02, (#reviewer-checkpoint-ordinal)

**Artifacts:**
- Modified `tugplug/agents/reviewer-agent.md`: `ordinal` field in checkpoint entries, documented as sole checkpoint authority

**Tasks:**
- [ ] Add `ordinal` (0-indexed integer) to `plan_conformance.checkpoints[]` entries in the output contract
- [ ] Update the output contract JSON example to include `ordinal` in checkpoint objects
- [ ] Update the field description table to document the `ordinal` field
- [ ] Add instruction: "Number checkpoints in the order they appear in the plan step, starting from 0"
- [ ] Add statement: "The reviewer is the sole authority for checkpoint verification. The coder does not report checkpoint status."

**Tests:**
- [ ] Deferred: verify by running the implement skill with the updated reviewer-agent (manual integration test)

**Checkpoint:**
- [ ] Reviewer-agent prompt contains `ordinal` field in checkpoint entries
- [ ] Reviewer-agent prompt documents reviewer as sole checkpoint authority

**Rollback:**
- Revert `reviewer-agent.md` to previous version

**Commit after all checkpoints pass.**

---

##### Step 3.4: Update Implement Skill for Batch Updates {#step-3-4}

**Depends on:** #step-3-2, #step-3-3

**Commit:** `feat(skills): replace --all completed with batch update in implement skill`

**References:** [D01] Coder clean break, [D03] Batch stdin, [D08] Reviewer checkpoints, Spec S01, Spec S02, Spec S03, Table T02, (#batch-update-schema, #coder-checklist-schema)

**Artifacts:**
- Modified `tugplug/skills/implement/SKILL.md`: batch update construction from coder (tasks+tests) and reviewer (checkpoints) output

**Tasks:**
- [ ] Replace the `tugcode state update {plan} {step} --all completed` command (line ~560) with batch update construction
- [ ] Document how to construct the batch JSON from coder's `checklist_status`: map each task/test item to a `BatchUpdateEntry`. Explicitly note: coder provides tasks and tests only.
- [ ] Document how to construct checkpoint updates from reviewer's `plan_conformance.checkpoints[]` with ordinals. Note: reviewer is the sole source for checkpoint status.
- [ ] Define reviewer verdict mapping explicitly in the skill: `PASS -> completed`; any non-pass verdict (`FAIL`, `BLOCKED`, `UNVERIFIED`, or equivalent) -> `deferred` with required reason from reviewer output
- [ ] Show the combined batch update command: pipe JSON array (combining coder task/test items with reviewer checkpoint items) to `tugcode state update {plan} {step} --worktree {wt} --batch`
- [ ] Update the coder post-call template (line ~93) to replace `{tests_passed ? "pass" : "FAIL"}` with a `checklist_status`-based summary (e.g., `Tasks: {completed}/{total} | Tests: {completed}/{total}`)
- [ ] Update the state command sequence summary (line ~920) to reflect the new batch update flow
- [ ] Update the coder output parsing section to reference `checklist_status` instead of `tests_passed`
- [ ] Update the coder validation schema (~line 966) to replace `tests_run` and `tests_passed` with `checklist_status` in the required fields list
- [ ] Document whether the implement skill passes `--allow-drift` on batch update calls. Decision: the implement skill does NOT pass `--allow-drift` -- if the plan has drifted since state init, the batch update should fail and surface the drift to the orchestrator for resolution.

**Tests:**
- [ ] Deferred: verify by running full implement skill workflow (manual integration test)

**Checkpoint:**
- [ ] No references to `--all completed` remain in `SKILL.md`
- [ ] Batch update command is documented with JSON construction example
- [ ] Coder task/test status and reviewer checkpoint status are combined into single batch

**Rollback:**
- Revert `SKILL.md` to previous version

**Commit after all checkpoints pass.**

---

#### Step 3 Summary {#step-3-summary}

**Depends on:** #step-3-4

**Commit:** `docs(agents): verify agent prompt consistency for granular tracking`

**References:** [D01] Coder clean break, [D08] Reviewer checkpoints, (#coder-checklist-schema, #reviewer-checkpoint-ordinal)

After completing Steps 3.1--3.4, you will have:
- All coder output consumers verified before migration
- Coder-agent reporting per-item checklist status for tasks and tests only
- Reviewer-agent as sole checkpoint authority with ordinal reporting
- Implement skill constructing batch updates combining coder task/test status with reviewer checkpoint verdicts

**Final Step 3 Checkpoint:**
- [ ] All agent/skill files updated with consistent contracts
- [ ] No references to `--all completed` or `tests_passed`/`tests_run` as top-level coder output fields in the implement pipeline
- [ ] Coder does not report checkpoint status; reviewer is sole checkpoint authority

---

#### Step 4: Strict Completion Default in tugcode commit {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `feat(commit): default to strict completion (force=false)`

**References:** [D07] Strict default, [D02] Deferred non-blocking, (#strategy)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/commit.rs`: `force=false` default

**Tasks:**
- [ ] Change `commit.rs` line 158 from `true` (force) to `false` (strict)
- [ ] When strict completion fails in `commit.rs`, print a warning listing incomplete items but allow the git commit to succeed (state update is skipped)

**Tests:**
- [ ] Integration test: `test_commit_strict_default_succeeds` -- verify `tugcode commit` uses strict mode and succeeds with all items completed or deferred
- [ ] Integration test: `test_commit_strict_default_warns_on_incomplete` -- verify `tugcode commit` with open items prints warning, git commit succeeds, state update skipped
- [ ] Integration test: existing commit-related tests still pass

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings
- [ ] Existing `test_complete_step_strict_mode_success` and `test_complete_step_force_mode` still pass

**Rollback:**
- Revert the one changed line in `commit.rs` back to `true`

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Granular, per-item state tracking in the plan/implement pipeline, replacing bulk force-completion with truthful progress reporting.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugcode state show --checklist` displays per-item status with deferred reasons for every task, test, and checkpoint (integration test)
- [ ] `tugcode commit` defaults to strict mode (`force=false`) and succeeds with completed+deferred items (integration test)
- [ ] Batch update via `--batch` stdin JSON updates N items in one call with full validation (integration test)
- [ ] `deferred` status is non-blocking for step completion with persisted reason (unit test)
- [ ] Schema version is 3 with `reason` column on `checklist_items` (unit test)
- [ ] Plan hash drift warning appears in `state show` when plan file is modified (integration test)
- [ ] Plan hash drift blocks `state update` and `state complete` unless `--allow-drift` (integration test)
- [ ] `tugcode commit` on plan drift warns and skips state update while git commit proceeds (integration test)
- [ ] Coder-agent output uses `checklist_status` field for tasks and tests only (prompt inspection)
- [ ] Reviewer-agent is sole checkpoint authority with ordinal reporting (prompt inspection)
- [ ] Implement skill uses batch update combining coder and reviewer output (prompt inspection)
- [ ] Full test suite passes: `cd tugcode && cargo nextest run`

**Acceptance tests:**
- [ ] Integration test: end-to-end batch update flow (init -> claim -> start -> batch update -> complete)
- [ ] Integration test: checklist display mode shows correct markers for mixed statuses with deferred reasons
- [ ] Integration test: commit with all-completed items succeeds in strict mode
- [ ] Integration test: commit with open items warns but git commit succeeds

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] `tugcode state review` command for manual sign-off on deferred items
- [ ] Progress notifications (push deferred item count to user dashboard)
- [ ] Extend dash workflow with similar granular tracking (dashes use different tables)
- [ ] Remove global `--verbose` and `--quiet` flags (separate refactor)

| Checkpoint | Verification |
|------------|--------------|
| All Rust tests pass | `cd tugcode && cargo nextest run` |
| No compiler warnings | `cd tugcode && cargo build` |
| Agent prompts consistent | Grep for removed fields returns no matches |

**Commit after all checkpoints pass.**
