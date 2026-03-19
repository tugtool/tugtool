## Phase 1.0: Add Tugstate (Embedded SQLite State Management) {#phase-tugstate}

**Purpose:** Ship an embedded SQLite-based state management system (Tugstate) alongside the existing beads system, enabling atomic step claiming, checklist tracking, lease-based ownership, and progress display for multi-worktree plan implementations -- all without removing or breaking any existing beads functionality.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-23 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Beads has failed as the coordination layer for Tug's multi-agent workflow. It cannot track checklist items at the granularity users need, requires a painful temp-file dance for agent data passing, causes merge conflicts when worktree branches return to main, depends on an external `bd` binary that refuses to run in git worktrees, and has consumed a disproportionate amount of development effort. See `roadmap/multi-agent-coordination.md` for the full problem statement and `roadmap/tugstate-proposal.md` for the design document.

Tugstate replaces beads with an embedded SQLite database in the repo root `.tugtool/` directory, managed entirely by `tugcode` via `rusqlite`. No external binary. No server process. No daemon. The database is never committed to git. Phase 1 is purely additive -- beads remains the source of truth, and no existing functionality is removed or broken. Phase 2 (a future plan) will remove beads entirely.

#### Strategy {#strategy}

- Build the core `state.rs` module in `tugtool-core` first, establishing the schema, connection management, and all query functions as a reusable library.
- Refactor `resolve_main_repo_root()` out of `worktree.rs` into `tugtool-core` as `find_repo_root()` early, since all state commands depend on it to locate `state.db`.
- Wire up the CLI commands (`tugcode state init/claim/start/heartbeat/update/artifact/complete/show/ready/reset/reconcile`) against the core module.
- Integrate into existing workflows (`worktree create`, `commit`) as non-fatal additions that log warnings on failure rather than blocking the primary operation.
- Write integration tests that exercise the full lifecycle: init, claim, start, update, complete, show, ready, reset, reconcile.
- Keep every step independently compilable -- each commit leaves `cargo build` and `cargo nextest run` green.

#### Stakeholders / Primary Customers {#stakeholders}

1. Tug orchestrator (implement skill) -- consumes `state claim`, `state update`, `state heartbeat`, `state complete` to coordinate multi-worktree step execution.
2. Tug users -- consume `state show` for progress visibility, `state ready` for planning, `state reset` for recovery.
3. Future tugdeck/tugcast -- consume JSON output from state commands for web UI and remote coordination.

#### Success Criteria (Measurable) {#success-criteria}

- `tugcode state init <plan>` parses any valid tugplan and populates `state.db` with correct steps, substeps, dependencies, and checklist items (verified by integration tests).
- `tugcode state claim` atomically returns the next ready step respecting the dependency graph and lease expiry (verified by concurrent-claim test).
- `tugcode state show <plan>` renders step-by-step progress with task/test/checkpoint counts matching the plan file (verified by golden output test).
- `tugcode state complete` enforces strict completion by default and supports `--force <reason>` with audit trail (verified by integration tests).
- `tugcode worktree create` calls `state init` after beads sync; failure is non-fatal (verified by integration test).
- `tugcode commit` appends `Tug-Step` and `Tug-Plan` trailers during active IMPLEMENT and calls `state complete` after bead close; failure is non-fatal (verified by integration test).
- All existing tests pass unchanged (`cargo nextest run` green).
- Zero new warnings (`-D warnings` enforced).

#### Scope {#scope}

1. Add `rusqlite` dependency (version 0.33 with bundled feature) to `tugtool-core`.
2. New module `tugtool-core/src/state.rs` -- database connection, schema creation, all query functions.
3. Refactor `find_repo_root()` into `tugtool-core` (replace `resolve_main_repo_root()` from `worktree.rs`).
4. New CLI commands under `tugcode state`: init, claim, start, heartbeat, update, artifact, complete, show, ready, reset, reconcile.
5. Update `tugcode worktree create` to call `state init` after beads sync (non-fatal on failure).
6. Update `tugcode commit` to call `state complete` after bead close and append `Tug-Step`/`Tug-Plan` trailers (step-only: only during active IMPLEMENT phase).
7. Update `.gitignore` with `state.db`, `state.db-wal`, `state.db-shm` patterns.
8. Integration tests for all state commands.
9. Update `tugcode doctor` to check `state.db` health.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Removing any beads code, commands, or integration (that is Phase 2).
- Modifying agent markdown files or input contracts.
- Modifying the implement skill (SKILL.md) or the Bead Write Protocol.
- Multi-machine coordination (future tugcast WebSocket endpoints).
- Replacing `tugcode status` with state-backed progress (Phase 2).
- Adding a `tugcode state prune` command (Phase 2 cleanup).

#### Dependencies / Prerequisites {#dependencies}

- Existing `TugPlan` parser (`tugtool_core::parse_tugplan`) must correctly parse steps, substeps, dependencies, and checklist items.
- Existing `resolve_worktree()` in `tugtool-core` (added in `b35c91d`) complements the new `find_repo_root()`.
- Rust toolchain must include a C compiler for `rusqlite` bundled feature (already required for all Tug target platforms).

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` via `.cargo/config.toml`). Every commit must compile clean.
- SQLite WAL mode with 5-second `BUSY_TIMEOUT` for concurrent access.
- `state.db` is never committed to git (gitignored).
- All existing beads commands must remain fully functional. Phase 1 is purely additive.
- CLI ordinals are 1-indexed for user-facing commands (internally stored as 0-indexed, translated at the CLI boundary).

#### Assumptions {#assumptions}

- Phase 1 tests use tempdir-based integration tests similar to existing `worktree_integration_tests.rs`, creating real git repos and calling `tugcode state` commands as subprocesses.
- The `rusqlite` bundled feature is acceptable (adds ~1MB to binary, requires C compiler at build time).
- The `state.db` file is created automatically by `tugcode state init` if it does not exist.
- Lease duration of 2 hours (7200 seconds) is the default, configurable via `--lease-duration` flag.
- The `tugcode state show` command renders progress bars using ASCII characters.
- The `tugcode state reconcile` command scans git log for `Tug-Step`/`Tug-Plan` trailers (recovery tool, not hot path).
- During Phase 1, all existing beads commands remain functional and untouched.
- The `step_index` column uses depth-first interleaved order matching how the parser traverses `Step.substeps`.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| SQLite lock contention in multi-worktree | med | low | WAL mode + BUSY_TIMEOUT 5s; claim/complete are sub-ms | Lock timeout errors in tests |
| state.db corruption from power loss | low | low | WAL mode is crash-safe; reconcile from git trailers | Corruption report from user |
| Plan file drift after init | high | med | SHA-256 plan hash enforcement on structure-dependent commands | False-positive hash failures |
| Build time increase from rusqlite bundled | low | high | ~5-10s incremental; acceptable for zero external deps | Build time > 30s incremental |

**Risk R01: Dual-write divergence during Phase 1** {#r01-dual-write}

- **Risk:** Beads and Tugstate disagree on step status during Phase 1 parallel operation.
- **Mitigation:** Beads is the source of truth. State writes are best-effort. If state write fails, warn and continue. State becomes authoritative only in Phase 2.
- **Residual risk:** Users who rely on `state show` during Phase 1 may see stale data if state writes silently fail.

**Risk R02: find_repo_root refactor breaks worktree commands** {#r02-repo-root-refactor}

- **Risk:** Moving `resolve_main_repo_root()` to `tugtool-core` introduces subtle path resolution differences.
- **Mitigation:** The refactored function uses the exact same `git rev-parse --path-format=absolute --git-common-dir` strategy. Existing worktree integration tests verify behavior is preserved.
- **Residual risk:** Edge case with non-standard git configurations.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Embedded SQLite via rusqlite with bundled feature (DECIDED) {#d01-rusqlite-bundled}

**Decision:** Use `rusqlite = { version = "0.33", features = ["bundled"] }` in `tugtool-core` for embedded SQLite.

**Rationale:**
- No external binary dependency (unlike beads requiring `bd`).
- Bundled feature compiles SQLite from source, eliminating system SQLite version concerns.
- Adds ~1MB to binary, acceptable trade-off.

**Implications:**
- Requires C compiler at build time (already required for Rust toolchains on all target platforms).
- Build time increases by ~5-10s for initial compile.

#### [D02] SQLite WAL mode with 5-second BUSY_TIMEOUT (DECIDED) {#d02-wal-mode}

**Decision:** Configure SQLite with WAL journal mode and a 5000ms busy timeout on every connection open.

**Rationale:**
- WAL mode supports concurrent readers with a single exclusive writer.
- 5-second timeout handles brief contention from parallel worktree operations.
- WAL mode is crash-safe by design.

**Implications:**
- Creates `state.db-wal` and `state.db-shm` sidecar files (gitignored).
- Network filesystems may not support SQLite locking correctly (documented limitation).

#### [D03] Lease-based claims with 2-hour default (DECIDED) {#d03-lease-claims}

**Decision:** Claims have a lease that expires after a configurable duration (default: 7200 seconds). Claimers must heartbeat to keep their lease alive. Expired claims are automatically reclaimable.

**Rationale:**
- Solves the stranded-claim problem when an orchestrator crashes.
- 2-hour default is generous enough for long implementation steps.
- Heartbeat at half the lease duration (1 hour) prevents races.

**Implications:**
- Orchestrator must call `tugcode state heartbeat` periodically during step execution.
- Manual `tugcode state reset` is the immediate escape hatch.

#### [D04] Strict completion by default with --force override (DECIDED) {#d04-strict-completion}

**Decision:** `tugcode state complete` requires all checklist items and substeps to be completed. The `--force <reason>` flag bypasses checks, recording the reason in `complete_reason` for audit trail.

**Rationale:**
- Strict mode provides trust in progress tracking ([R-08]).
- Force override gives agents flexibility during implementation.
- Audit trail makes force-completions visible in `state show`.

**Implications:**
- Agents must mark all checklist items before completing a step, or provide a force reason.
- Force-completions are annotated in `state show` output.

#### [D05] Plan hash enforcement via SHA-256 (DECIDED) {#d05-plan-hash}

**Decision:** `state init` computes SHA-256 of the plan file and stores it as `plan_hash`. Structure-dependent commands (`claim`, `update`, `complete`) verify the hash before operating.

**Rationale:**
- Enforces plan-immutable-during-IMPLEMENT policy at the DB level.
- Prevents subtle bugs from plan edits after initialization.

**Implications:**
- Plan file changes after init require `state init --force` to re-initialize.
- Runtime-only commands (`start`, `heartbeat`, `artifact`, `reset`) skip the check.

#### [D06] Ownership model with --worktree enforcement (DECIDED) {#d06-ownership}

**Decision:** Mutating commands on claimed steps require `--worktree <path>` matching `claimed_by`. Ownership is resolved via a single COALESCE query that handles both top-level and substep ownership uniformly.

**Rationale:**
- Prevents one orchestrator from mutating another's work in multi-worktree scenarios.
- Reset is intentionally unguarded (admin operation) so any operator can unstick a step.

**Implications:**
- All ownership-requiring commands (`start`, `heartbeat`, `update`, `artifact`, `complete`) use the same resolution algorithm.
- Substeps inherit their parent step's claim.

#### [D07] Substep support via parent_anchor column (DECIDED) {#d07-substeps}

**Decision:** Substeps are stored in the same `steps` table as top-level steps, differentiated by `parent_anchor` (NULL for top-level, parent anchor for substeps). The claim unit is the top-level step; substep progress is tracked individually.

**Rationale:**
- Single-table design simplifies queries and avoids joins.
- Matches the plan parser's `Step.substeps: Vec<Substep>` structure.
- Individual substep tracking delivers [R-08] display granularity.

**Implications:**
- `step_index` uses interleaved declaration order (step-0=0, step-1=1, step-1-1=2, step-1-2=3, step-2=4).
- Top-level step completion requires all substeps to be completed (or `--force`).

#### [D08] Git commit trailers for deterministic reconcile (DECIDED) {#d08-git-trailers}

**Decision:** `tugcode commit` appends `Tug-Step` and `Tug-Plan` trailers to every step commit. `tugcode state reconcile` scans git log for these trailers to recover DB state.

**Rationale:**
- Deterministic recovery without heuristic message parsing.
- Trailers are `git interpret-trailers`-compatible.
- Reconcile conflict precedence: DB wins on hash mismatch (warn and skip); `--force` overwrites.

**Implications:**
- Trailers are only added during active IMPLEMENT phase (step-only, per user answer).
- `tugcode commit` must detect whether it is in an active IMPLEMENT context.

#### [D09] CLI ordinals are 1-indexed (DECIDED) {#d09-cli-ordinals}

**Decision:** User-facing CLI commands use 1-indexed ordinals for checklist items (e.g., `--task 1 completed`). Internally, ordinals are stored 0-indexed and translated at the CLI boundary.

**Rationale:**
- 1-indexed is more natural for human users.
- 0-indexed storage is simpler for array-like operations.
- Translation at the boundary keeps the core logic clean.

**Implications:**
- CLI argument parsing subtracts 1 from user-provided ordinals.
- JSON output uses 1-indexed ordinals for consistency with CLI.

#### [D10] find_repo_root replaces resolve_main_repo_root entirely (DECIDED) {#d10-find-repo-root}

**Decision:** Move `resolve_main_repo_root()` from `tugcode/crates/tugcode/src/commands/worktree.rs` into `tugtool-core` as `find_repo_root()` and `find_repo_root_from()`. Delete the old function entirely and update all callers to use the new one.

**Rationale:**
- Avoids duplicating the repo-root resolution strategy.
- Makes the function available to `state.rs` (in `tugtool-core`) and all CLI commands.
- Complements the existing `resolve_worktree()` in `tugtool-core`.

**Implications:**
- Four call sites in `worktree.rs` must be updated to use `tugtool_core::find_repo_root()`.
- Error type changes from `Result<PathBuf, String>` to `Result<PathBuf, TugError>`.

#### [D11] Non-fatal state init in worktree create (DECIDED) {#d11-nonfatal-init}

**Decision:** `tugcode worktree create` calls `state init` after beads sync. If state init fails, it warns, sets `state_initialized: false` in output, and returns success (beads is the source of truth in Phase 1).

**Rationale:**
- Phase 1 is additive. Beads is still the source of truth.
- A state init failure should not block worktree creation.
- The `state_initialized` flag lets the orchestrator know whether state is available.

**Implications:**
- `CreateData` struct gains a `state_initialized: bool` field.
- Orchestrator can check `state_initialized` and fall back to beads-only mode.

#### [D12] Non-fatal state complete in commit with trailers (DECIDED) {#d12-nonfatal-commit}

**Decision:** `tugcode commit` calls `state complete` after bead close. If the state update fails, it sets `state_update_failed: true` in output and exits 0 (the git commit succeeded). Tug-Step/Tug-Plan trailers are only added when committing within an active IMPLEMENT phase.

**Rationale:**
- Mirrors the existing `bead_close_failed` pattern.
- Git commit is the source of truth for "did the code land."
- Trailers during IMPLEMENT only avoids polluting non-step commits.

**Implications:**
- `CommitData` struct gains a `state_update_failed: bool` field.
- Commit logic must detect active IMPLEMENT context (presence of step anchor and plan path).

#### [D13] Use sha2 crate for plan hash computation (DECIDED) {#d13-sha2-crate}

**Decision:** Use the `sha2` crate (pure Rust, from the RustCrypto project) for computing SHA-256 plan file hashes. Add `sha2` as a workspace dependency alongside `rusqlite` in Step 0.

**Rationale:**
- Pure Rust implementation, no subprocess overhead (unlike shelling out to `shasum`).
- Deterministic across all platforms (no system tool version differences).
- Standard approach in the Rust ecosystem for SHA-256.
- Lightweight dependency (~50KB, no C code).

**Implications:**
- `sha2` added to `[workspace.dependencies]` in `tugcode/Cargo.toml`.
- `sha2.workspace = true` added to `[dependencies]` in `tugcode/crates/tugtool-core/Cargo.toml`.
- `compute_plan_hash()` uses `sha2::Sha256` via the `Digest` trait.

---

### 1.0.1 Schema Specification {#schema-spec}

The following SQL is the authoritative schema. `StateDb::open()` executes this verbatim (minus comments) when creating a new database.

**Spec S01: Tugstate Schema v1** {#s01-schema}

```sql
-- Tugstate schema v1

-- Track schema version for forward compatibility
CREATE TABLE schema_version (
    version INTEGER NOT NULL
);
INSERT INTO schema_version (version) VALUES (1);

-- One row per plan
CREATE TABLE plans (
    plan_path    TEXT PRIMARY KEY,          -- e.g. ".tugtool/tugplan-foo.md"
    plan_hash    TEXT NOT NULL,             -- SHA-256 of plan file at init time
    phase_title  TEXT,                      -- from plan metadata
    status       TEXT NOT NULL DEFAULT 'active',  -- active/done
    created_at   TEXT NOT NULL,             -- ISO 8601
    updated_at   TEXT NOT NULL              -- ISO 8601
);

-- One row per execution step or substep
CREATE TABLE steps (
    plan_path        TEXT NOT NULL REFERENCES plans(plan_path),
    anchor           TEXT NOT NULL,           -- "step-0", "step-2-1"
    parent_anchor    TEXT,                    -- NULL for top-level steps; parent anchor for substeps
    step_index       INTEGER NOT NULL,        -- parse order (0-indexed), for deterministic scheduling
    title            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
        -- pending: not started
        -- claimed: atomically reserved by an orchestrator
        -- in_progress: work underway
        -- completed: done, committed
    claimed_by       TEXT,                    -- worktree_path of the claimer (NULL if unclaimed)
    claimed_at       TEXT,                    -- ISO 8601, when claim was acquired
    lease_expires_at TEXT,                    -- ISO 8601, claim expires if not heartbeated
    heartbeat_at     TEXT,                    -- ISO 8601, last heartbeat from claimer
    started_at       TEXT,                    -- ISO 8601
    completed_at     TEXT,                    -- ISO 8601
    commit_hash      TEXT,                    -- git commit hash when completed
    complete_reason  TEXT,                    -- NULL for normal completion; set when --force used
    PRIMARY KEY (plan_path, anchor),
    FOREIGN KEY (plan_path, parent_anchor) REFERENCES steps(plan_path, anchor)
);

-- Dependency edges between steps
CREATE TABLE step_deps (
    plan_path    TEXT NOT NULL,
    step_anchor  TEXT NOT NULL,
    depends_on   TEXT NOT NULL,
    PRIMARY KEY (plan_path, step_anchor, depends_on),
    FOREIGN KEY (plan_path, step_anchor) REFERENCES steps(plan_path, anchor),
    FOREIGN KEY (plan_path, depends_on) REFERENCES steps(plan_path, anchor)
);

-- Individual checklist items (tasks, tests, checkpoints)
CREATE TABLE checklist_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_path    TEXT NOT NULL,
    step_anchor  TEXT NOT NULL,
    kind         TEXT NOT NULL,            -- 'task' / 'test' / 'checkpoint'
    ordinal      INTEGER NOT NULL,         -- position within its kind group (0-indexed)
    text         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',
        -- open: not started
        -- in_progress: work underway
        -- completed: done
    updated_at   TEXT,                     -- ISO 8601, NULL until first update
    FOREIGN KEY (plan_path, step_anchor) REFERENCES steps(plan_path, anchor)
);

-- Minimal per-step artifact audit trail
CREATE TABLE step_artifacts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_path    TEXT NOT NULL,
    step_anchor  TEXT NOT NULL,
    kind         TEXT NOT NULL,            -- 'architect_strategy' / 'reviewer_verdict' / 'auditor_summary'
    summary      TEXT NOT NULL,            -- brief description (first ~200 chars of approach, verdict, etc.)
    recorded_at  TEXT NOT NULL,            -- ISO 8601
    FOREIGN KEY (plan_path, step_anchor) REFERENCES steps(plan_path, anchor)
);

-- Index for fast ready-step queries (top-level steps only)
CREATE INDEX idx_steps_status ON steps(plan_path, status) WHERE parent_anchor IS NULL;

-- Index for substep queries by parent
CREATE INDEX idx_steps_parent ON steps(plan_path, parent_anchor) WHERE parent_anchor IS NOT NULL;

-- Index for lease expiry queries
CREATE INDEX idx_steps_lease ON steps(plan_path, status, lease_expires_at);

-- Index for fast checklist queries by step
CREATE INDEX idx_checklist_step ON checklist_items(plan_path, step_anchor);

-- Index for artifact queries by step
CREATE INDEX idx_artifacts_step ON step_artifacts(plan_path, step_anchor);
```

**Table T01: Database Tables** {#t01-tables}

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `schema_version` | Track schema version for forward compatibility | (single row) |
| `plans` | One row per initialized plan | `plan_path` |
| `steps` | One row per step or substep | `(plan_path, anchor)` |
| `step_deps` | Dependency edges between steps | `(plan_path, step_anchor, depends_on)` |
| `checklist_items` | Individual tasks, tests, checkpoints | `id` (autoincrement) |
| `step_artifacts` | Minimal per-step audit breadcrumbs | `id` (autoincrement) |

**Table T02: Status Values** {#t02-statuses}

| Entity | Statuses | Transitions |
|--------|----------|-------------|
| Plan | `active`, `done` | `active` -> `done` (when last step completes) |
| Step | `pending`, `claimed`, `in_progress`, `completed` | `pending` -> `claimed` -> `in_progress` -> `completed` |
| Checklist item | `open`, `in_progress`, `completed` | `open` -> `in_progress` -> `completed` |

**Table T03: Indexes** {#t03-indexes}

| Index | Columns | Filter | Purpose |
|-------|---------|--------|---------|
| `idx_steps_status` | `(plan_path, status)` | `WHERE parent_anchor IS NULL` | Fast ready-step queries (top-level only) |
| `idx_steps_parent` | `(plan_path, parent_anchor)` | `WHERE parent_anchor IS NOT NULL` | Substep queries by parent |
| `idx_steps_lease` | `(plan_path, status, lease_expires_at)` | None | Lease expiry queries |
| `idx_checklist_step` | `(plan_path, step_anchor)` | None | Fast checklist queries by step |
| `idx_artifacts_step` | `(plan_path, step_anchor)` | None | Artifact queries by step |

---

### 1.0.2 CLI Command Specification {#cli-commands}

All commands live under `tugcode state`. They all operate on the repo-root `state.db`.

**Table T04: Command Summary** {#t04-commands}

| Command | Arguments | Ownership | Hash Check | Description |
|---------|-----------|-----------|------------|-------------|
| `init` | `<plan_path>` | No | No (computes) | Parse plan, populate DB |
| `claim` | `<plan_path> --worktree <path>` | No (creates) | Yes | Atomically claim next ready step |
| `start` | `<plan_path> <step> --worktree <path>` | Yes | No | Transition claimed -> in_progress |
| `heartbeat` | `<plan_path> <step> --worktree <path>` | Yes | No | Renew lease |
| `update` | `<plan_path> <step> --worktree <path> [opts]` | Yes | Yes | Update checklist items |
| `artifact` | `<plan_path> <step> --kind <k> --summary <t> --worktree <path>` | Yes | No | Record audit breadcrumb |
| `complete` | `<plan_path> <step> --worktree <path> --commit <hash>` | Yes | Yes | Mark step done |
| `show` | `[plan_path] [--json]` | No | No | Display progress |
| `ready` | `<plan_path>` | No | No | List ready steps |
| `reset` | `<plan_path> <step>` | No | No | Reset step to pending |
| `reconcile` | `<plan_path> [--force]` | No | No | Recover DB from git trailers |

**Table T05: Ownership Model** {#t05-ownership}

| Command | Ownership required? | Notes |
|---------|-------------------|-------|
| `init` | No | Creates plan state, no step claims involved |
| `claim` | No | Creates ownership (sets `claimed_by`) |
| `start` | Yes | Only the claimer can transition to `in_progress` |
| `heartbeat` | Yes | Only the claimer can renew the lease |
| `update` | Yes | Only the claimer can update checklist items |
| `artifact` | Yes | Only the claimer can record artifacts |
| `complete` | Yes | Only the claimer can mark a step done |
| `show` | No | Read-only |
| `ready` | No | Read-only |
| `reset` | No | Admin operation -- intentionally unguarded |
| `reconcile` | No | Admin recovery tool |

**Table T06: Plan Hash Enforcement** {#t06-hash-enforcement}

| Command | Hash check? | Rationale |
|---------|------------|-----------|
| `init` | No | Computes and stores the hash |
| `claim` | Yes | Step identity depends on plan structure |
| `start` | No | Only changes runtime status |
| `heartbeat` | No | Only changes lease timestamp |
| `update` | Yes | Checklist ordinals depend on plan structure |
| `artifact` | No | Appends audit data, structure-independent |
| `complete` | Yes | Checklist verification depends on plan structure |
| `reset` | No | Admin operation, structure-independent |
| `reconcile` | No | Recovery tool, works from git log |

---

### 1.0.3 Symbol Inventory {#symbol-inventory}

#### 1.0.3.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugtool-core/src/state.rs` | Core state module: connection, schema, queries |
| `tugcode/crates/tugcode/src/commands/state.rs` | CLI command implementations for `tugcode state` |
| `tugcode/crates/tugcode/tests/state_integration_tests.rs` | Integration tests for state commands |

#### 1.0.3.2 Modified files {#modified-files}

| File | Change |
|------|--------|
| `tugcode/Cargo.toml` | Add `rusqlite` and `sha2` to workspace dependencies |
| `tugcode/crates/tugtool-core/Cargo.toml` | Add `rusqlite` and `sha2` dependencies |
| `tugcode/crates/tugtool-core/src/lib.rs` | Add `pub mod state;` and re-exports |
| `tugcode/crates/tugtool-core/src/worktree.rs` | Add `find_repo_root()`, `find_repo_root_from()` |
| `tugcode/crates/tugtool-core/src/error.rs` | Add state-related error variants (E046-E053) |
| `tugcode/crates/tugcode/src/commands/worktree.rs` | Replace `resolve_main_repo_root()` with `find_repo_root()` calls; add state init |
| `tugcode/crates/tugcode/src/commands/commit.rs` | Add trailer append and state complete call |
| `tugcode/crates/tugcode/src/commands/doctor.rs` | Add state.db health check |
| `tugcode/crates/tugcode/src/commands/mod.rs` | Add `pub mod state;` and re-exports |
| `tugcode/crates/tugcode/src/cli.rs` | Add `State(StateCommands)` variant to `Commands` enum |
| `tugcode/crates/tugcode/src/main.rs` | Add `State` match arm |
| `tugcode/crates/tugcode/src/output.rs` | Add state-related output data types |
| `.gitignore` | Add `state.db`, `state.db-wal`, `state.db-shm` patterns |

#### 1.0.3.3 New symbols in tugtool-core {#symbols-core}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `find_repo_root()` | fn | `worktree.rs` | Resolve CWD to main repo root |
| `find_repo_root_from(path)` | fn | `worktree.rs` | Resolve given path to main repo root |
| `StateDb` | struct | `state.rs` | Holds `rusqlite::Connection`, provides all query methods |
| `StateDb::open(path)` | fn | `state.rs` | Open/create DB, run migrations, set WAL+BUSY_TIMEOUT |
| `StateDb::init_plan(plan_path, plan)` | fn | `state.rs` | Parse plan into DB (idempotent) |
| `StateDb::claim_step(plan_path, worktree, lease_dur)` | fn | `state.rs` | Atomic next-ready claim |
| `StateDb::start_step(plan_path, anchor, worktree)` | fn | `state.rs` | claimed -> in_progress |
| `StateDb::heartbeat_step(plan_path, anchor, worktree, lease_dur)` | fn | `state.rs` | Renew lease |
| `StateDb::update_checklist(plan_path, anchor, worktree, updates)` | fn | `state.rs` | Update checklist items |
| `StateDb::record_artifact(plan_path, anchor, worktree, kind, summary)` | fn | `state.rs` | Record audit breadcrumb |
| `StateDb::complete_step(plan_path, anchor, worktree, commit, force_reason)` | fn | `state.rs` | Mark step done |
| `StateDb::show_plan(plan_path)` | fn | `state.rs` | Query plan progress |
| `StateDb::ready_steps(plan_path)` | fn | `state.rs` | List ready steps |
| `StateDb::reset_step(plan_path, anchor)` | fn | `state.rs` | Reset to pending |
| `StateDb::reconcile(plan_path, trailer_entries, force)` | fn | `state.rs` | Recover from git trailers |
| `StateDb::verify_plan_hash(plan_path, expected_hash)` | fn | `state.rs` | Check plan file hash |
| `StateDb::check_ownership(plan_path, anchor, worktree)` | fn | `state.rs` | COALESCE ownership query |
| `compute_plan_hash(path)` | fn | `state.rs` | SHA-256 of plan file |
| `StepState` | struct | `state.rs` | Query result for step status |
| `PlanState` | struct | `state.rs` | Query result for plan overview |
| `ChecklistSummary` | struct | `state.rs` | Counts by kind and status |
| `ClaimResult` | enum | `state.rs` | Claimed / NoReadySteps / AllCompleted |
| `ReadyResult` | struct | `state.rs` | Lists of ready/blocked/completed steps |
| `ReconcileEntry` | struct | `state.rs` | Parsed git trailer data |

#### 1.0.3.4 New symbols in tugcode CLI {#symbols-cli}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `StateCommands` | enum | `commands/state.rs` | Clap subcommand enum for state subcommands |
| `run_state_init()` | fn | `commands/state.rs` | CLI handler for `state init` |
| `run_state_claim()` | fn | `commands/state.rs` | CLI handler for `state claim` |
| `run_state_start()` | fn | `commands/state.rs` | CLI handler for `state start` |
| `run_state_heartbeat()` | fn | `commands/state.rs` | CLI handler for `state heartbeat` |
| `run_state_update()` | fn | `commands/state.rs` | CLI handler for `state update` |
| `run_state_artifact()` | fn | `commands/state.rs` | CLI handler for `state artifact` |
| `run_state_complete()` | fn | `commands/state.rs` | CLI handler for `state complete` |
| `run_state_show()` | fn | `commands/state.rs` | CLI handler for `state show` |
| `run_state_ready()` | fn | `commands/state.rs` | CLI handler for `state ready` |
| `run_state_reset()` | fn | `commands/state.rs` | CLI handler for `state reset` |
| `run_state_reconcile()` | fn | `commands/state.rs` | CLI handler for `state reconcile` |

#### 1.0.3.5 New error variants {#error-variants}

Error codes E038-E045 are reserved to avoid collision with ad-hoc error code string literals in `resolve.rs` (E040, E041) and `status.rs` (E040). These codes are not defined as `TugError` enum variants but appear as hardcoded strings in `JsonIssue` construction. State errors start at E046 to leave a clean gap.

| Variant | Code | Description |
|---------|------|-------------|
| `StateDbOpen` | E046 | Failed to open state.db |
| `StateDbQuery` | E047 | SQL query failed |
| `StatePlanHashMismatch` | E048 | Plan file changed since init |
| `StateOwnershipViolation` | E049 | Worktree does not match claimed_by |
| `StateStepNotClaimed` | E050 | Step not in expected status for operation |
| `StateIncompleteChecklist` | E051 | Checklist items incomplete (strict mode) |
| `StateIncompleteSubsteps` | E052 | Substeps incomplete (strict mode) |
| `StateNoReadySteps` | E053 | No steps ready for claiming |

---

### 1.0.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual state.rs functions in isolation | Schema creation, hash computation, ownership resolution |
| **Integration** | Test full CLI command lifecycle via subprocess | init/claim/start/complete flow, multi-step plans, worktree create |

#### Integration Test Strategy {#integration-test-strategy}

Tests create temporary git repos with a `.tugtool/` directory containing a sample tugplan, then run `tugcode state` commands as subprocess invocations and verify JSON output. This matches the pattern established in `worktree_integration_tests.rs`.

Key test scenarios:
- Single-step plan lifecycle (init -> claim -> start -> update -> complete -> show)
- Multi-step plan with dependencies (step-1 blocked until step-0 completes)
- Substep tracking (step with substeps, individual substep completion)
- Lease expiry and reclaim (claim, let lease expire, reclaim by different worktree)
- Strict completion vs force-complete
- Plan hash enforcement (modify plan after init, verify claim fails)
- Concurrent claim safety (two claims, only one succeeds)
- Reconcile from git trailers
- Reset and reclaim flow
- Worktree create integration (state init called, non-fatal on failure)
- Doctor state.db health check

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Add rusqlite and sha2 dependencies and .gitignore patterns {#step-0}

**Commit:** `feat(state): add rusqlite and sha2 dependencies, gitignore state.db`

**References:** [D01] Embedded SQLite via rusqlite, [D02] WAL mode, [D13] sha2 crate, (#t01-tables, #scope)

**Artifacts:**
- Modified `tugcode/Cargo.toml` -- add `rusqlite` and `sha2` to workspace dependencies
- Modified `tugcode/crates/tugtool-core/Cargo.toml` -- add `rusqlite` and `sha2` dependencies
- Modified `.gitignore` -- add state.db patterns

**Tasks:**
- [ ] Add `rusqlite = { version = "0.33", features = ["bundled"] }` to `[workspace.dependencies]` in `tugcode/Cargo.toml`
- [ ] Add `sha2 = "0.10"` to `[workspace.dependencies]` in `tugcode/Cargo.toml`
- [ ] Add `rusqlite.workspace = true` to `[dependencies]` in `tugcode/crates/tugtool-core/Cargo.toml`
- [ ] Add `sha2.workspace = true` to `[dependencies]` in `tugcode/crates/tugtool-core/Cargo.toml`
- [ ] Add the following three lines to `.gitignore` (with the `.tugtool/` prefix, under the existing "Tug step artifacts" section): `.tugtool/state.db`, `.tugtool/state.db-wal`, `.tugtool/state.db-shm`. Do NOT use bare `state.db*` glob patterns -- the prefix ensures only the repo-root database is ignored, not unrelated files named state.db elsewhere
- [ ] Verify `cargo build` succeeds in `tugcode/` directory

**Tests:**
- [ ] Unit test: verify `rusqlite::Connection::open_in_memory()` works (smoke test that the dependency is wired)
- [ ] Unit test: verify `sha2::Sha256` produces a known digest for a test string (smoke test that sha2 is wired)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes (all existing tests still green)
- [ ] `.gitignore` contains state.db patterns

**Rollback:**
- Revert Cargo.toml changes and `.gitignore` additions.

**Commit after all checkpoints pass.**

---

#### Step 1: Refactor find_repo_root into tugtool-core {#step-1}

**Depends on:** #step-0

**Commit:** `refactor(core): move resolve_main_repo_root to tugtool-core as find_repo_root`

**References:** [D10] find_repo_root replaces resolve_main_repo_root, Risk R02, (#d10-find-repo-root)

**Artifacts:**
- New functions `find_repo_root()` and `find_repo_root_from()` in `tugtool-core/src/worktree.rs`
- Removed function `resolve_main_repo_root()` from `tugcode/crates/tugcode/src/commands/worktree.rs`
- Updated 4 call sites in `commands/worktree.rs` to use `tugtool_core::find_repo_root()`
- Updated re-exports in `tugtool-core/src/lib.rs`

**Tasks:**
- [ ] Add `find_repo_root() -> Result<PathBuf, TugError>` to `tugtool-core/src/worktree.rs` using the same `git rev-parse --path-format=absolute --git-common-dir` strategy
- [ ] Add `find_repo_root_from(start: &Path) -> Result<PathBuf, TugError>` for testability
- [ ] Add re-exports to `tugtool-core/src/lib.rs`
- [ ] Delete `resolve_main_repo_root()` from `tugcode/crates/tugcode/src/commands/worktree.rs`
- [ ] Update all 4 call sites in `commands/worktree.rs` (lines 482, 963, 1037, 1163) to use `tugtool_core::find_repo_root()`
- [ ] Adapt error handling from `Result<PathBuf, String>` to `Result<PathBuf, TugError>` at call sites

**Tests:**
- [ ] Unit test: `find_repo_root_from()` on a directory with `.git` directory returns that directory
- [ ] Unit test: `find_repo_root_from()` on a non-git directory returns `TugError::NotAGitRepository`
- [ ] Integration test: existing worktree tests still pass (verifies refactor is behavior-preserving)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes (existing worktree tests verify refactor)
- [ ] `grep -r "resolve_main_repo_root" tugcode/` returns no matches

**Rollback:**
- Revert the worktree.rs changes in both crates and lib.rs re-exports.

**Commit after all checkpoints pass.**

---

#### Step 2: Core state module -- schema and connection {#step-2}

**Depends on:** #step-0

**Commit:** `feat(state): add state.rs with schema creation and connection management`

**References:** [D01] rusqlite bundled, [D02] WAL mode, [D07] substeps via parent_anchor, [D13] sha2 crate, Spec S01, Table T01, Table T02, Table T03, (#schema-spec, #s01-schema, #t01-tables, #t02-statuses, #t03-indexes)

**Artifacts:**
- New file `tugcode/crates/tugtool-core/src/state.rs`
- Modified `tugcode/crates/tugtool-core/src/lib.rs` -- add `pub mod state;`
- New error variants in `error.rs`

**Tasks:**
- [ ] Create `tugcode/crates/tugtool-core/src/state.rs` with `StateDb` struct holding `rusqlite::Connection`
- [ ] Implement `StateDb::open(path: &Path) -> Result<Self, TugError>` that creates the DB file, sets WAL mode and BUSY_TIMEOUT, and runs schema migration
- [ ] Implement schema creation using the exact SQL from Spec S01 (#s01-schema): all 6 tables (`schema_version`, `plans`, `steps`, `step_deps`, `checklist_items`, `step_artifacts`) and all 5 indexes
- [ ] Implement `compute_plan_hash(path: &Path) -> Result<String, TugError>` using `sha2::Sha256` via the `Digest` trait: read file contents, feed to hasher, format digest as lowercase hex string
- [ ] Add `StateDbOpen`, `StateDbQuery` error variants to `error.rs` with codes E046, E047
- [ ] Add `code()`, `exit_code()`, and `line()` match arms for `StateDbOpen` (E046) and `StateDbQuery` (E047) in the `TugError` impl block -- without these, the code will not compile due to non-exhaustive match
- [ ] Add `pub mod state;` to `lib.rs` and appropriate re-exports
- [ ] Reuse the existing `now_iso8601()` function from `tugtool_core::session` for all timestamp generation in `state.rs` (`created_at`, `updated_at`, `claimed_at`, `started_at`, `completed_at`, `heartbeat_at`, `lease_expires_at`, `recorded_at`). Do NOT import `chrono` or reimplement timestamp formatting -- `now_iso8601()` already uses `std::time::SystemTime` and produces ISO 8601 strings
- [ ] Implement `StateDb::schema_version() -> Result<i32, TugError>` for health checks

**Tests:**
- [ ] Unit test: `StateDb::open` on temp path creates file and schema version is 1
- [ ] Unit test: `StateDb::open` is idempotent (calling twice on same path succeeds)
- [ ] Unit test: schema has all expected tables (query `sqlite_master`)
- [ ] Unit test: `compute_plan_hash` returns consistent SHA-256 for same content

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Rollback:**
- Delete `state.rs`, revert `lib.rs` and `error.rs` changes.

**Commit after all checkpoints pass.**

---

#### Step 3: State init command {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(state): implement state init command with plan parsing`

**References:** [D05] plan hash enforcement, [D07] substeps via parent_anchor, [D09] CLI ordinals, Table T01, (#cli-commands, #t04-commands, #schema-spec)

**Artifacts:**
- New method `StateDb::init_plan()` in `state.rs`
- New file `tugcode/crates/tugcode/src/commands/state.rs` (initial, with just init subcommand)
- Modified `commands/mod.rs`, `cli.rs`, `main.rs`, `output.rs`

**Tasks:**
- [ ] Implement `StateDb::init_plan(plan_path, plan: &TugPlan, plan_hash: &str) -> Result<InitResult, TugError>` that populates all tables in a single transaction
- [ ] Handle idempotency: if plan already exists in DB, return `already_initialized: true` without error
- [ ] Assign `step_index` in interleaved declaration order (step-0=0, step-1=1, step-1-1=2, step-1-2=3, step-2=4)
- [ ] Create `steps` rows for both top-level steps and substeps (substeps have `parent_anchor` set)
- [ ] Create `step_deps` rows for both step and substep dependencies
- [ ] Create `checklist_items` rows for tasks, tests, and checkpoints with 0-indexed ordinals
- [ ] Create `StateCommands` clap subcommand enum in `commands/state.rs` with `Init` variant
- [ ] Wire `StateCommands` into `cli.rs` (`State(StateCommands)` variant in `Commands` enum)
- [ ] Wire `State` match arm into `main.rs`
- [ ] Add `StateInitData` output struct to `output.rs`
- [ ] Implement `run_state_init()` CLI handler: resolve plan path, parse plan, compute hash, open state.db via `find_repo_root()`, call `StateDb::init_plan()`

**Tests:**
- [ ] Unit test: init_plan creates correct number of steps, substeps, deps, and checklist items for a multi-step plan with substeps
- [ ] Unit test: init_plan is idempotent (second call returns `already_initialized: true`)
- [ ] Unit test: step_index is interleaved correctly for steps with substeps
- [ ] Integration test: `tugcode state init <plan> --json` returns expected JSON with step and checklist counts

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `tugcode state init .tugtool/tugplan-skeleton.md --json` produces valid JSON output (manual smoke test)

**Rollback:**
- Delete `commands/state.rs`, revert `mod.rs`, `cli.rs`, `main.rs`, `output.rs` changes.

**Commit after all checkpoints pass.**

---

#### Step 4: Claim, start, heartbeat commands {#step-4}

**Depends on:** #step-3

**Commit:** `feat(state): implement claim, start, and heartbeat commands`

**References:** [D03] lease-based claims, [D05] plan hash, [D06] ownership, Table T04, Table T05, Table T06, (#d03-lease-claims, #d05-plan-hash, #d06-ownership)

> This step is large, so it is split into substeps.

##### Step 4.1: Claim command {#step-4-1}

**Commit:** `feat(state): implement state claim with lease-based atomicity`

**References:** [D03] lease-based claims, [D05] plan hash, [D06] ownership, Table T04, Table T05, Table T06, (#d03-lease-claims, #d05-plan-hash, #d06-ownership)

**Artifacts:**
- New method `StateDb::claim_step()` in `state.rs`
- New error variants `StatePlanHashMismatch` (E048), `StateNoReadySteps` (E053) in `error.rs`
- New `ClaimResult` enum and `StateClaimData` output type
- Updated `commands/state.rs` with `Claim` subcommand

**Tasks:**
- [ ] Implement `StateDb::verify_plan_hash(plan_path, expected_hash) -> Result<(), TugError>` for hash enforcement
- [ ] Implement `StateDb::claim_step(plan_path, worktree, lease_duration, current_hash) -> Result<ClaimResult, TugError>` using `BEGIN EXCLUSIVE` transaction
- [ ] Claim query finds steps that are `pending` OR have expired lease, respects dependency graph (all deps completed), orders by `step_index`
- [ ] On claim (fresh or reclaim): execute the following operations within the same `BEGIN EXCLUSIVE` transaction, in this exact order: (a) UPDATE parent step -- set `status = 'claimed'`, `claimed_by`, `claimed_at`, `lease_expires_at`, clear `heartbeat_at` and `started_at`; (b) UPDATE all non-completed substeps (`status IN ('claimed', 'in_progress')`) -- set `status = 'claimed'`, `claimed_by`, `claimed_at`, `lease_expires_at`, clear `heartbeat_at` and `started_at`; (c) UPDATE checklist_items for those reclaimed substeps -- set `status = 'open'`, `updated_at = now` for all items where `status != 'completed'`. Completed substeps and their checklist items are untouched throughout. This ensures a clean fresh start for any reclaimed work while preserving finished work
- [ ] Return `ClaimResult::Claimed { anchor, title, index, remaining_ready, total_remaining, lease_expires, reclaimed }` or `ClaimResult::NoReadySteps { all_completed, blocked }` or `ClaimResult::AllCompleted`
- [ ] Add `StatePlanHashMismatch` and `StateNoReadySteps` error variants to `error.rs`
- [ ] Add `code()`, `exit_code()`, and `line()` match arms for `StatePlanHashMismatch` (E048) and `StateNoReadySteps` (E053) in the `TugError` impl block -- without these, the code will not compile due to non-exhaustive match
- [ ] Wire `Claim` subcommand in `commands/state.rs` with `--worktree`, `--lease-duration` args
- [ ] Implement `run_state_claim()` CLI handler

**Tests:**
- [ ] Unit test: claim returns first ready step by step_index
- [ ] Unit test: claim respects dependency graph (blocked step not returned when dep is pending)
- [ ] Unit test: claim with expired lease reclaims the step and resets non-completed substep checklist items to `open` (fresh-start invariant)
- [ ] Unit test: reclaim preserves already-completed substeps and their checklist items
- [ ] Unit test: claim on plan with all steps completed returns `AllCompleted`
- [ ] Unit test: plan hash mismatch returns error

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

##### Step 4.2: Start command {#step-4-2}

**Depends on:** #step-4-1

**Commit:** `feat(state): implement state start command`

**References:** [D06] ownership, Table T04, Table T05, (#d06-ownership, #t05-ownership)

**Artifacts:**
- New method `StateDb::start_step()` in `state.rs`
- New error variants `StateOwnershipViolation` (E049), `StateStepNotClaimed` (E050) in `error.rs`
- Updated `commands/state.rs` with `Start` subcommand

**Tasks:**
- [ ] Implement `StateDb::check_ownership(plan_path, anchor, worktree) -> Result<(), TugError>` using the COALESCE query from the proposal for both top-level and substep ownership: `SELECT claimed_by FROM steps WHERE plan_path = ? AND anchor = COALESCE((SELECT parent_anchor FROM steps WHERE plan_path = ? AND anchor = ?), ?) AND status IN ('claimed', 'in_progress')`
- [ ] Implement `StateDb::start_step(plan_path, anchor, worktree) -> Result<(), TugError>` that transitions `claimed` -> `in_progress`, sets `started_at`. Ownership MUST be enforced atomically -- include `AND claimed_by = ?` directly in the mutating SQL UPDATE predicate within the same transaction. Do NOT implement as a separate SELECT check followed by UPDATE (race condition between check and mutate)
- [ ] Add `StateOwnershipViolation` (E049), `StateStepNotClaimed` (E050) error variants
- [ ] Add `code()`, `exit_code()`, and `line()` match arms for `StateOwnershipViolation` (E049) and `StateStepNotClaimed` (E050) in the `TugError` impl block -- without these, the code will not compile due to non-exhaustive match
- [ ] Wire `Start` subcommand with `--worktree` arg
- [ ] Implement `run_state_start()` CLI handler

**Tests:**
- [ ] Unit test: start succeeds when called by claimer
- [ ] Unit test: start fails with ownership violation when called by different worktree
- [ ] Unit test: start fails when step is not in `claimed` status

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

##### Step 4.3: Heartbeat command {#step-4-3}

**Depends on:** #step-4-2

**Commit:** `feat(state): implement state heartbeat command`

**References:** [D03] lease-based claims, [D06] ownership, (#d03-lease-claims)

**Artifacts:**
- New method `StateDb::heartbeat_step()` in `state.rs`
- Updated `commands/state.rs` with `Heartbeat` subcommand

**Tasks:**
- [ ] Implement `StateDb::heartbeat_step(plan_path, anchor, worktree, lease_duration) -> Result<String, TugError>` that updates `heartbeat_at` and `lease_expires_at`. Ownership MUST be enforced atomically -- include `AND claimed_by = ?` directly in the UPDATE predicate (e.g., `UPDATE steps SET heartbeat_at = ?, lease_expires_at = ? WHERE plan_path = ? AND anchor = ? AND status IN ('claimed', 'in_progress') AND claimed_by = ?`). Check `rows_affected == 0` to detect ownership violation. Do NOT implement as separate SELECT then UPDATE
- [ ] Wire `Heartbeat` subcommand with `--worktree`, `--lease-duration` args
- [ ] Implement `run_state_heartbeat()` CLI handler

**Tests:**
- [ ] Unit test: heartbeat extends lease_expires_at by lease_duration from now
- [ ] Unit test: heartbeat fails with ownership violation for non-claimer

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

#### Step 4 Summary {#step-4-summary}

**Depends on:** #step-4-3

**Commit:** `test(state): verify claim/start/heartbeat integration`

**References:** [D03] lease-based claims, [D06] ownership, (#step-4-1, #step-4-2, #step-4-3)

After completing Steps 4.1-4.3, you will have:
- Atomic step claiming with lease-based reclaim
- Ownership enforcement via COALESCE query
- Plan hash verification on claim
- claimed -> in_progress transition with start
- Lease renewal via heartbeat

**Tasks:**
- [ ] Verify all claim/start/heartbeat unit tests pass

**Tests:**
- [ ] Integration test: claim -> start -> heartbeat lifecycle

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with all claim/start/heartbeat tests

---

#### Step 5: Update, artifact, complete commands {#step-5}

**Depends on:** #step-4

**Commit:** `feat(state): implement update, artifact, and complete commands`

**References:** [D04] strict completion, [D05] plan hash, [D06] ownership, [D09] CLI ordinals, Table T04, (#d04-strict-completion, #d05-plan-hash, #d06-ownership, #d09-cli-ordinals)

> This step is large, so it is split into substeps.

##### Step 5.1: Update command {#step-5-1}

**Commit:** `feat(state): implement state update command for checklist items`

**References:** [D06] ownership, [D05] plan hash, [D09] CLI ordinals, Table T04, (#d09-cli-ordinals, #t04-commands)

**Artifacts:**
- New method `StateDb::update_checklist()` in `state.rs`
- Updated `commands/state.rs` with `Update` subcommand

**Tasks:**
- [ ] Implement `StateDb::update_checklist(plan_path, anchor, worktree, updates, current_hash) -> Result<UpdateResult, TugError>` with ownership check and hash verification. Ownership MUST be enforced atomically within the same transaction -- verify ownership via the COALESCE query and gate the UPDATE on `claimed_by = ?` in the predicate. Do NOT implement as separate SELECT check then UPDATE (race condition)
- [ ] Support individual item updates: `--task <ordinal> <status>`, `--test <ordinal> <status>`, `--checkpoint <ordinal> <status>`
- [ ] Support bulk updates: `--all-tasks <status>`, `--all-tests <status>`, `--all-checkpoints <status>`, `--all <status>`
- [ ] Translate 1-indexed CLI ordinals to 0-indexed storage at the CLI boundary
- [ ] Wire `Update` subcommand with all option variants
- [ ] Implement `run_state_update()` CLI handler

**Tests:**
- [ ] Unit test: update individual task by ordinal (1-indexed input maps to 0-indexed storage)
- [ ] Unit test: update all tasks to completed
- [ ] Unit test: update fails with ownership violation for non-claimer
- [ ] Unit test: update fails with hash mismatch

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

##### Step 5.2: Artifact command {#step-5-2}

**Depends on:** #step-5-1

**Commit:** `feat(state): implement state artifact command for audit breadcrumbs`

**References:** [D06] ownership, Table T04, (#t04-commands)

**Artifacts:**
- New method `StateDb::record_artifact()` in `state.rs`
- Updated `commands/state.rs` with `Artifact` subcommand

**Tasks:**
- [ ] Implement `StateDb::record_artifact(plan_path, anchor, worktree, kind, summary) -> Result<i64, TugError>` with ownership check. Ownership MUST be enforced atomically within the same transaction -- verify via COALESCE ownership query and only INSERT the artifact row if ownership is confirmed. Do NOT implement as separate SELECT check then INSERT (race condition)
- [ ] Validate `kind` is one of `architect_strategy`, `reviewer_verdict`, `auditor_summary`
- [ ] Truncate summary to 500 characters
- [ ] Wire `Artifact` subcommand with `--kind`, `--summary`, `--worktree` args
- [ ] Implement `run_state_artifact()` CLI handler

**Tests:**
- [ ] Unit test: record artifact and verify it appears in DB
- [ ] Unit test: artifact fails with ownership violation for non-claimer
- [ ] Unit test: summary is truncated to 500 chars

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

##### Step 5.3: Complete command {#step-5-3}

**Depends on:** #step-5-2

**Commit:** `feat(state): implement state complete command with strict/force modes`

**References:** [D04] strict completion, [D05] plan hash, [D06] ownership, [D07] substeps, Table T04, (#d04-strict-completion, #d05-plan-hash)

**Artifacts:**
- New method `StateDb::complete_step()` in `state.rs`
- New error variants `StateIncompleteChecklist` (E051), `StateIncompleteSubsteps` (E052) in `error.rs`
- Updated `commands/state.rs` with `Complete` subcommand

**Tasks:**
- [ ] Implement `StateDb::complete_step(plan_path, anchor, worktree, commit_hash, force_reason, current_hash) -> Result<CompleteResult, TugError>`. Ownership MUST be enforced atomically -- include `AND claimed_by = ?` directly in the `UPDATE steps SET status = 'completed'` predicate within the same `BEGIN EXCLUSIVE` transaction. Check `rows_affected == 0` to detect ownership loss or status change. Do NOT implement as separate SELECT check then UPDATE (race condition)
- [ ] Strict mode (default): verify all checklist items for the step are `completed`; for top-level steps, also verify all substeps are `completed`
- [ ] On failure in strict mode: return error listing incomplete items/substeps
- [ ] Force mode: bypass checks, record reason in `complete_reason`, auto-complete remaining items and substeps
- [ ] When last step completes, set `plans.status = 'done'`
- [ ] Add `StateIncompleteChecklist` (E051), `StateIncompleteSubsteps` (E052) error variants
- [ ] Add `code()`, `exit_code()`, and `line()` match arms for `StateIncompleteChecklist` (E051) and `StateIncompleteSubsteps` (E052) in the `TugError` impl block -- without these, the code will not compile due to non-exhaustive match
- [ ] Wire `Complete` subcommand with `--worktree`, `--commit`, `--force` args
- [ ] Implement `run_state_complete()` CLI handler

**Tests:**
- [ ] Unit test: complete succeeds when all checklist items are completed
- [ ] Unit test: complete fails in strict mode when items are incomplete
- [ ] Unit test: force-complete succeeds with reason recorded
- [ ] Unit test: force-complete auto-completes remaining items and substeps
- [ ] Unit test: completing last step sets plan status to done
- [ ] Unit test: substep completion only checks its own checklist items

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

#### Step 5 Summary {#step-5-summary}

**Depends on:** #step-5-3

**Commit:** `test(state): verify update/artifact/complete integration`

**References:** [D04] strict completion, [D06] ownership, (#step-5-1, #step-5-2, #step-5-3)

After completing Steps 5.1-5.3, you will have:
- Checklist item tracking with individual and bulk updates
- Audit breadcrumb recording for crash recovery
- Strict and force-complete modes with audit trail
- Plan completion detection

**Tasks:**
- [ ] Verify all update/artifact/complete unit tests pass

**Tests:**
- [ ] Integration test: update -> artifact -> complete lifecycle

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with all update/artifact/complete tests

---

#### Step 6: Show, ready, reset, reconcile commands {#step-6}

**Depends on:** #step-5

**Commit:** `feat(state): implement show, ready, reset, and reconcile commands`

**References:** [D04] strict completion, [D07] substeps, [D08] git trailers, Table T02, Table T04, (#d04-strict-completion, #d07-substeps, #d08-git-trailers, #t02-statuses, #t04-commands)

> This step is large, so it is split into substeps.

##### Step 6.1: Show command {#step-6-1}

**Commit:** `feat(state): implement state show command with progress display`

**References:** [D04] strict completion (force annotation), [D07] substeps, Table T02, (#t02-statuses, #cli-commands)

**Artifacts:**
- New method `StateDb::show_plan()` in `state.rs`
- New types `PlanState`, `StepState`, `ChecklistSummary` in `state.rs`
- Updated `commands/state.rs` with `Show` subcommand

**Tasks:**
- [ ] Implement `StateDb::show_plan(plan_path) -> Result<PlanState, TugError>` querying all steps, substeps, checklist counts, and artifacts
- [ ] Implement text output with ASCII progress bars (e.g., `Tasks: 2/3  ████████░░░░  67%`)
- [ ] Show substeps indented under parent steps
- [ ] Annotate force-completed steps with reason
- [ ] Show lease expiry for claimed steps
- [ ] Show blocked-by information for pending steps
- [ ] Implement JSON output for machine consumption
- [ ] Support showing all plans when no plan_path specified
- [ ] Wire `Show` subcommand with optional `plan_path` and `--json` args
- [ ] Implement `run_state_show()` CLI handler

**Tests:**
- [ ] Unit test: show returns correct checklist counts by kind (task/test/checkpoint)
- [ ] Unit test: show includes substep data nested under parent
- [ ] Unit test: show annotates force-completed steps
- [ ] Integration test: `tugcode state show <plan> --json` returns valid JSON with expected structure

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

##### Step 6.2: Ready command {#step-6-2}

**Depends on:** #step-6-1

**Commit:** `feat(state): implement state ready command`

**References:** Table T04, (#t04-commands, #cli-commands)

**Artifacts:**
- New method `StateDb::ready_steps()` in `state.rs`
- New type `ReadyResult` in `state.rs`
- Updated `commands/state.rs` with `Ready` subcommand

**Tasks:**
- [ ] Implement `StateDb::ready_steps(plan_path) -> Result<ReadyResult, TugError>` listing ready, completed, blocked, and expired-claim steps
- [ ] Ready = pending with all deps completed, or expired lease
- [ ] Wire `Ready` subcommand with `plan_path` arg
- [ ] Implement `run_state_ready()` CLI handler

**Tests:**
- [ ] Unit test: ready returns correct ready/blocked/completed categorization
- [ ] Unit test: expired lease step appears in ready list

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

##### Step 6.3: Reset command {#step-6-3}

**Depends on:** #step-6-2

**Commit:** `feat(state): implement state reset command`

**References:** Table T04, Table T05, (#t04-commands, #t05-ownership, #cli-commands)

**Artifacts:**
- New method `StateDb::reset_step()` in `state.rs`
- Updated `commands/state.rs` with `Reset` subcommand

**Tasks:**
- [ ] Implement `StateDb::reset_step(plan_path, anchor) -> Result<(), TugError>` that resets step to `pending`, clears claim fields, resets non-completed checklist items
- [ ] For top-level steps: also reset all non-completed substeps and their checklist items
- [ ] No ownership check (admin operation)
- [ ] Do not reset already-completed steps (error if step is completed)
- [ ] Wire `Reset` subcommand with `plan_path`, `step_anchor` args
- [ ] Implement `run_state_reset()` CLI handler

**Tests:**
- [ ] Unit test: reset clears claim fields and sets status to pending
- [ ] Unit test: reset cascades to substeps
- [ ] Unit test: reset does not affect completed steps (returns error)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

##### Step 6.4: Reconcile command {#step-6-4}

**Depends on:** #step-6-3

**Commit:** `feat(state): implement state reconcile command for git trailer recovery`

**References:** [D08] git trailers, (#d08-git-trailers, #cli-commands)

**Artifacts:**
- New method `StateDb::reconcile()` in `state.rs`
- New type `ReconcileEntry` in `state.rs`
- Updated `commands/state.rs` with `Reconcile` subcommand

**Tasks:**
- [ ] Implement `ReconcileEntry` struct to hold parsed `Tug-Step` and `Tug-Plan` trailer data with commit hash
- [ ] Implement git log scanning function that extracts `Tug-Step`/`Tug-Plan` trailers from commit messages
- [ ] Implement `StateDb::reconcile(plan_path, entries: &[ReconcileEntry], force: bool) -> Result<ReconcileResult, TugError>`. `ReconcileResult` must include: `reconciled_count: usize` (steps marked completed), `skipped_count: usize` (steps skipped due to existing completion with different hash), and `skipped_mismatches: Vec<SkippedMismatch>` where `SkippedMismatch` has fields `{ step_anchor: String, db_hash: String, git_hash: String }`. This makes the reconcile output self-documenting and auditable
- [ ] Default behavior: skip steps already completed in DB. When the DB has a different commit hash than the trailer, increment `skipped_count` and push an entry to `skipped_mismatches` with both hashes (warn to stderr)
- [ ] Force mode: overwrite DB hashes with trailer-derived hashes (skipped_count remains 0)
- [ ] Wire `Reconcile` subcommand with `plan_path`, `--force` args
- [ ] Implement `run_state_reconcile()` CLI handler

**Tests:**
- [ ] Unit test: reconcile marks uncompleted steps as completed from trailer data, `reconciled_count` reflects count
- [ ] Unit test: reconcile skips already-completed steps with hash mismatch (default mode) -- verify `skipped_count > 0` and `skipped_mismatches` contains the correct `step_anchor`, `db_hash`, and `git_hash`
- [ ] Unit test: reconcile in force mode overwrites completed step hashes, `skipped_count == 0`

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Commit after all checkpoints pass.**

---

#### Step 6 Summary {#step-6-summary}

**Depends on:** #step-6-4

**Commit:** `test(state): verify show/ready/reset/reconcile integration`

**References:** [D07] substeps, [D08] git trailers, (#step-6-1, #step-6-2, #step-6-3, #step-6-4)

After completing Steps 6.1-6.4, you will have:
- Full progress display with ASCII bars and JSON output
- Ready-step querying for orchestrator consumption
- Manual reset escape hatch for admin operations
- Git trailer-based reconcile for crash recovery

**Tasks:**
- [ ] Verify all show/ready/reset/reconcile unit tests pass

**Tests:**
- [ ] Integration test: show/ready/reset/reconcile lifecycle

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with all show/ready/reset/reconcile tests
- [ ] All 11 state subcommands are wired and functional

---

#### Step 7: Integrate state init into worktree create {#step-7}

**Depends on:** #step-3

**Commit:** `feat(worktree): call state init after beads sync (non-fatal)`

**References:** [D11] non-fatal state init, (#d11-nonfatal-init, #scope)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/worktree.rs` -- add `state_initialized` field to `CreateData` struct (defined at line 93), add state init call after beads sync, update all `CreateData` construction sites

**Tasks:**
- [ ] Add `state_initialized: bool` field to the `CreateData` struct in `tugcode/crates/tugcode/src/commands/worktree.rs` (line 93). Note: `CreateData` is defined in worktree.rs, NOT in output.rs
- [ ] Update ALL `CreateData` construction sites in worktree.rs to include the new `state_initialized` field -- there are 5 existing sites (lines 715, 786, 816, 898, 1328) that must each gain `state_initialized: false` or the code will not compile due to missing field. The new success-path construction site will use `state_initialized: true`
- [ ] After beads sync in `run_worktree_create()`, call `StateDb::open()` then `StateDb::init_plan()` to initialize state for the plan
- [ ] Add `warnings: Vec<String>` field to `CreateData` (with `#[serde(skip_serializing_if = "Vec::is_empty")]`). Update all existing `CreateData` construction sites to include `warnings: vec![]`
- [ ] Wrap state init in try-catch pattern: on failure, push a warning string like `"state init failed: {error}"` into the `warnings` array, set `state_initialized: false`, and continue
- [ ] Set `state_initialized: true` on success, `false` on failure
- [ ] Add a test-only failure injection mechanism: when env var `TUGSTATE_FORCE_INIT_FAIL=1` is set, `StateDb::init_plan()` returns an error immediately before touching the database. Guard with `#[cfg(test)]` or check the env var only in debug builds to avoid production overhead

**Tests:**
- [ ] Integration test: worktree create with valid plan sets `state_initialized: true` in JSON output
- [ ] Integration test: worktree create with `TUGSTATE_FORCE_INIT_FAIL=1` env var set continues successfully with `state_initialized: false` in JSON output (deterministic failure injection, no filesystem-permission tricks)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes (existing worktree tests still green)

**Rollback:**
- Revert worktree.rs state-init additions and `state_initialized` field from `CreateData`.

**Commit after all checkpoints pass.**

---

#### Step 8: Integrate state complete and trailers into commit {#step-8}

**Depends on:** #step-5-3

**Commit:** `feat(commit): add Tug-Step/Tug-Plan trailers and state complete call`

**References:** [D08] git trailers, [D12] non-fatal commit, (#d08-git-trailers, #d12-nonfatal-commit, #scope)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/commit.rs` -- append trailers, call state complete
- Modified `tugcode/crates/tugcode/src/output.rs` -- add `state_update_failed: bool` to `CommitData`

**Tasks:**
- [ ] Before calling `git commit`, append `Tug-Step: <anchor>` and `Tug-Plan: <plan_path>` trailers to the commit message (only when step and plan args are provided, indicating active IMPLEMENT). If `Tug-Step` or `Tug-Plan` trailers already exist in the message, replace their values rather than appending duplicates -- this ensures idempotency over retries and reconcile workflows
- [ ] After successful git commit and bead close, call the equivalent of `StateDb::complete_step()` with the commit hash
- [ ] Add `state_update_failed: bool` field to `CommitData` output struct in `tugcode/crates/tugcode/src/output.rs`
- [ ] Add `warnings: Vec<String>` field to `CommitData` (with `#[serde(skip_serializing_if = "Vec::is_empty")]`)
- [ ] Wrap state complete in try-catch: on failure, push a warning string like `"state complete failed: {error}"` into the `warnings` array, set `state_update_failed: true`, and continue with exit 0
- [ ] Update the `error_response()` helper function in `tugcode/crates/tugcode/src/commands/commit.rs` (line 193) which also constructs `CommitData` -- add `state_update_failed: false` and `warnings: vec![]` to that construction site or the code will not compile due to missing fields
- [ ] Update the success-path `CommitData` construction (line 118) to include `warnings` and `state_update_failed` fields

**Tests:**
- [ ] Integration test: commit with step/plan args produces commit message containing `Tug-Step` and `Tug-Plan` trailers
- [ ] Integration test: trailer replacement is idempotent -- if a message already contains `Tug-Step`/`Tug-Plan` trailers, values are replaced not duplicated
- [ ] Integration test: commit succeeds even when state complete fails (state_update_failed: true)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes (existing commit tests still green)

**Rollback:**
- Revert commit.rs trailer and state-complete additions, revert output.rs field.

**Commit after all checkpoints pass.**

---

#### Step 9: Doctor state.db health check {#step-9}

**Depends on:** #step-3

**Commit:** `feat(doctor): add state.db health check`

**References:** (#scope)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/doctor.rs` -- add state health check
- Modified `tugcode/crates/tugcode/src/output.rs` -- add state health check entry to DoctorData

**Tasks:**
- [ ] Add a `state_health` check to `run_doctor()` that verifies:
  - `state.db` file exists and is readable (or skip if not present -- not an error since state is optional in Phase 1)
  - Schema version matches expected version (1)
  - No orphaned plans (plan_path in DB references files that exist on disk)
- [ ] Report as `pass` / `warn` / `fail` consistent with existing doctor checks
- [ ] Add check result to `DoctorData` output

**Tests:**
- [ ] Unit test: doctor passes when state.db is absent (Phase 1: optional)
- [ ] Unit test: doctor warns when state.db has orphaned plans
- [ ] Unit test: doctor passes when state.db is healthy

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Rollback:**
- Revert doctor.rs state health check additions.

**Commit after all checkpoints pass.**

---

#### Step 10: Comprehensive integration tests {#step-10}

**Depends on:** #step-6, #step-7, #step-8, #step-9

**Commit:** `test(state): add comprehensive integration tests for state lifecycle`

**References:** [D03] lease claims, [D04] strict completion, [D05] plan hash, [D06] ownership, [D07] substeps, [D08] git trailers, (#test-plan-concepts, #integration-test-strategy)

**Artifacts:**
- New file `tugcode/crates/tugcode/tests/state_integration_tests.rs`

**Tasks:**
- [ ] Create integration test file with tempdir-based git repo setup (matching existing worktree test pattern)
- [ ] Test: full lifecycle (init -> claim -> start -> update all items -> complete -> show confirms done)
- [ ] Test: multi-step plan with dependencies (step-1 blocked until step-0 complete; claim returns step-0 first)
- [ ] Test: substep tracking (init plan with substeps, verify individual substep completion, verify parent requires all substeps)
- [ ] Test: lease expiry and reclaim (claim with short lease, sleep past expiry, reclaim by different worktree)
- [ ] Test: strict completion rejection (attempt complete with incomplete items, verify error listing missing items)
- [ ] Test: force-complete with reason (verify reason in show output, verify auto-completion of remaining items)
- [ ] Test: plan hash enforcement (init, modify plan file, verify claim fails with hash mismatch)
- [ ] Test: ownership enforcement (claim by worktree-A, attempt start by worktree-B, verify rejection)
- [ ] Test: concurrent ownership race -- two worktrees race to start/update/complete the same claimed step in rapid succession; exactly one must succeed and the other must fail with `StateOwnershipViolation`. This validates atomic ownership enforcement under contention, not just functional correctness
- [ ] Test: reset and reclaim (claim, reset, verify step is pending, claim again)
- [ ] Test: reconcile from git trailers (create commits with trailers, run reconcile, verify steps completed)
- [ ] Test: ready command returns correct categorization
- [ ] Test: show command JSON output has expected structure

**Tests:**
- [ ] All integration tests listed above pass

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with all integration tests
- [ ] No warnings from any test compilation

**Rollback:**
- Delete `state_integration_tests.rs`.

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A fully functional embedded SQLite-based state management system (Tugstate) running alongside beads, with 11 CLI commands, integration into worktree create and commit, and comprehensive integration tests.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build` in `tugcode/` succeeds with zero warnings
- [ ] `cargo nextest run` in `tugcode/` passes all tests (existing + new)
- [ ] `tugcode state init` successfully parses and populates state.db for any valid tugplan
- [ ] `tugcode state claim` atomically claims ready steps respecting dependency graph
- [ ] `tugcode state complete` enforces strict completion and supports `--force`
- [ ] `tugcode state show` renders progress with ASCII bars (text mode) and structured data (JSON mode)
- [ ] `tugcode worktree create` calls state init (non-fatal on failure)
- [ ] `tugcode commit` appends Tug-Step/Tug-Plan trailers during IMPLEMENT and calls state complete (non-fatal on failure)
- [ ] `tugcode doctor` checks state.db health when present
- [ ] All existing beads commands remain fully functional (no regressions)
- [ ] `.gitignore` includes state.db patterns

**Acceptance tests:**
- [ ] Integration test: full lifecycle (init -> claim -> start -> update -> complete -> show)
- [ ] Integration test: multi-step plan with dependencies
- [ ] Integration test: lease expiry and reclaim
- [ ] Integration test: strict and force completion
- [ ] Integration test: plan hash enforcement
- [ ] Integration test: ownership enforcement
- [ ] Integration test: reconcile from git trailers
- [ ] Integration test: worktree create calls state init
- [ ] Integration test: commit appends trailers

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 2: Remove beads entirely (tugplan-remove-beads)
- [ ] Add `tugcode state prune` for orphaned state cleanup
- [ ] Replace `tugcode status` with state-backed progress
- [ ] Update implement skill (SKILL.md) to use state commands instead of Bead Write Protocol
- [ ] Remove bead_id from agent input contracts
- [ ] Wrap state operations behind tugcast WebSocket endpoints for multi-machine coordination

| Checkpoint | Verification |
|------------|--------------|
| Dependency added | `cargo build` succeeds, rusqlite in dependency tree |
| Schema correct | Unit tests verify all tables and indexes |
| All 11 commands functional | Integration tests exercise each command |
| Worktree integration | worktree create calls state init |
| Commit integration | commit appends trailers and calls state complete |
| Doctor integration | doctor checks state.db health |
| No regressions | All existing tests pass unchanged |

**Commit after all checkpoints pass.**
