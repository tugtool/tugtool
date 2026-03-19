## Phase 1.0: Dash Workflow {#phase-dash-workflow}

**Purpose:** Ship the dash workflow -- a lightweight, worktree-isolated project mode that lets users dash off quick work (bug fixes, spikes, small features) without the full plan/implement pipeline, using `/tugplug:dash <name> <instruction>` to create, continue, join, or release dashes.

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

The plan/implement pipeline (`tugplug:plan` -> `tugplug:implement` -> `tugplug:merge`) is designed for structured, multi-step projects with formal plans, step tracking, drift detection, and multi-agent review. This works well for significant features and complex changes, but adds unnecessary ceremony for quick tasks: fixing a bug, spiking an idea, adding a small feature, or prototyping something.

The dash workflow fills this gap. It creates a git worktree, puts a single coding agent in it, and lets the user direct work with natural language. When done, the user either joins the results back to the base branch (squash merge) or releases the worktree (discards everything). No plans, no steps, no drift budgets, no review loops. The design document at `roadmap/dash-workflow.md` is the authoritative specification.

#### Strategy {#strategy}

- Build foundation first: schema migration and core dash state functions in `tugtool-core` before any CLI or plugin work
- Add CLI subcommands incrementally: `create`/`list`/`show` first (testable independently), then `commit`, then `join`/`release`
- Reuse existing infrastructure: `GitCli` patterns from `worktree.rs`, `StateDb` connection handling from `state.rs`, `JsonResponse` envelope from `output.rs`
- Keep dash and plan/implement completely separate: distinct tables, distinct branch prefixes (`tugdash/` vs `tugtool/`), distinct agents, no shared lifecycle
- Build the dash-agent as an independent prompt document (not a fork of coder-agent) to avoid coupling
- Wire up the dash skill last, since it depends on all CLI subcommands and the dash-agent being ready
- Use `--json` flag pattern (human-readable by default) consistent with existing tugcode commands

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool users who need lightweight, quick project workflows alongside the full pipeline
2. The dash skill (`tugplug:dash`) which calls all `tugcode dash` subcommands programmatically

#### Success Criteria (Measurable) {#success-criteria}

- `tugcode dash create <name> --description "..." --json` creates a worktree at `.tugtree/tugdash__<name>/`, a branch `tugdash/<name>` from the detected base branch, and a row in state.db `dashes` table with `base_branch` (verified by `tugcode dash show <name> --json`)
- `tugcode dash commit <name> --message "..."` always records a round in `dash_rounds`; stages and commits git changes when present, skips git commit with null `commit_hash` when worktree is clean (verified by `tugcode dash show <name> --json` showing round count incremented in both cases)
- `tugcode dash join <name>` performs preflight before side effects, squash-merges to base_branch, removes worktree and branch, sets status to `joined` (verified by `git log --oneline -1` showing squash commit and `tugcode dash list --json` showing no active dashes)
- `tugcode dash release <name>` removes worktree and branch (warn-only on partial cleanup failure), sets status to `released` (verified by `git worktree list` and `git branch --list tugdash/*`)
- `/tugplug:dash <name> <instruction>` creates or continues a dash, spawns the dash-agent, auto-commits after each round, and reports results to user
- `/tugplug:dash <name> join` and `/tugplug:dash <name> release` complete the dash lifecycle
- `cargo nextest run` passes with no warnings after all steps (enforced by `-D warnings`)
- All six `tugcode dash` subcommands produce valid JSON when `--json` is passed

#### Scope {#scope}

1. Schema migration: `dashes` and `dash_rounds` tables in state.db
2. Core library: dash state functions (CRUD, round recording) in `tugtool-core`
3. CLI: `tugcode dash` subcommand group with `create`, `commit`, `join`, `release`, `list`, `show`
4. Agent: `tugplug/agents/dash-agent.md` -- lightweight coding agent
5. Skill: `tugplug/skills/dash/SKILL.md` -- orchestrator that parses input, calls CLI, spawns agent

#### Non-goals (Explicitly out of scope) {#non-goals}

- Promoting a dash to a plan/implement project or vice versa
- Multi-agent review loops (architect, reviewer, auditor) within dashes
- Drift detection or step tracking within dashes
- Plan file generation for dashes
- Remote mode for `tugcode dash join` (PR-based merge) -- local squash-merge only for now

#### Dependencies / Prerequisites {#dependencies}

- Existing `StateDb` infrastructure in `tugtool-core/src/state.rs` (schema creation, connection handling)
- Existing worktree utilities in `tugtool-core/src/worktree.rs` (`find_repo_root`, `sanitize_branch_name`, `remove_worktree`)
- Existing `JsonResponse` envelope in `tugcode/src/output.rs`
- Existing clap subcommand group pattern (`WorktreeCommands`, `StateCommands`)
- Auto-approve hook already handles `tugplug:*` and `tugcode` patterns

#### Constraints {#constraints}

- Warnings are errors: `-D warnings` enforced via `.cargo/config.toml`
- All git operations from the skill must go through `tugcode dash` subcommands (no raw git)
- Branch prefix `tugdash/` must be distinct from `tugtool/` used by plan/implement
- Worktree directory pattern `.tugtree/tugdash__<name>/` must coexist with `.tugtree/tugtool__<slug>-<timestamp>/`
- JSON output uses existing `JsonResponse` envelope when `--json` flag is passed; human-readable text otherwise

#### Assumptions {#assumptions}

- The design document at `roadmap/dash-workflow.md` is the authoritative specification and will not change during implementation
- The existing worktree and state management code can be reused with minimal changes for dash worktrees
- The dash-agent will be a new, independent prompt document (not a fork of coder-agent) to avoid coupling
- The `tugdash/` branch prefix is distinct from `tugtool/` to allow dashes and plans to coexist
- The auto-approve hook already covers `tugplug:dash` and `tugcode dash` patterns
- Error handling and rollback follow existing patterns from `tugcode worktree` and `tugcode merge` commands
- One active session per dash at a time (no concurrency locking per [D11])

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Dash state lives in the same state.db as plan state (DECIDED) {#d01-shared-statedb}

**Decision:** Dash tables (`dashes`, `dash_rounds`) are added to the existing `state.db` SQLite database rather than a separate database file.

**Rationale:**
- Single database simplifies initialization and discovery (already handled by `tugcode init`)
- WAL mode and busy timeout already configured
- `tugcode doctor` can check dash state alongside plan state

**Implications:**
- Schema migration must be additive (new tables only, no changes to existing tables)
- Schema version in `schema_version` table must be bumped
- `StateDb::open()` must create dash tables alongside plan tables

#### [D02] Schema migration uses CREATE TABLE IF NOT EXISTS (DECIDED) {#d02-idempotent-migration}

**Decision:** Dash tables are created with `CREATE TABLE IF NOT EXISTS` in the same `StateDb::open()` method that creates plan tables, rather than a separate migration system.

**Rationale:**
- Matches the existing pattern: all tables use `CREATE TABLE IF NOT EXISTS` in `StateDb::open()`
- No migration versioning complexity needed since new tables don't conflict with existing ones
- Idempotent: safe to run on databases created before or after dash support

**Implications:**
- Schema version bump from 1 to 2 documents that dash tables exist but doesn't gate behavior
- No down-migration path (acceptable for additive-only changes)

#### [D03] Dash names are validated to alphanumeric plus hyphens, reuse allowed (DECIDED) {#d03-name-validation}

**Decision:** Dash names must match `^[a-z][a-z0-9-]*[a-z0-9]$` (start with letter, end with letter or digit, lowercase alphanumeric and hyphens only, minimum 2 characters). Reserved words (`release`, `join`, `status`) are rejected. Names of previously joined or released dashes may be reused: the existing row is reactivated in place (one row per name, `dashes.name` is PRIMARY KEY).

**Rationale:**
- Names become branch suffixes (`tugdash/<name>`) and directory names (`tugdash__<name>`) so they must be filesystem and git safe
- Lowercase-only prevents case-sensitivity issues across platforms
- Reserved words would collide with skill parsing (second token is checked for lifecycle commands)
- Name reuse is natural -- a user who joined `fix-login` last week should be able to start a new `fix-login` dash

**Implications:**
- Validation function shared between CLI and (implicitly) the skill via CLI error messages
- Single-character names are rejected to avoid ambiguity
- Reuse semantics: dash-level metadata (description, branch, worktree, base_branch, status, timestamps) is overwritten on reactivation. Round history from all incarnations persists in `dash_rounds` (rows remain associated by `dash_name`)
- The `created_at` timestamp on the dash row marks the start of the current incarnation; rounds with `started_at` before that `created_at` are from previous incarnations
- All timestamps are UTC ISO 8601; current-incarnation filtering compares normalized UTC timestamps

#### [D04] JSON output uses --json flag, human-readable by default (DECIDED) {#d04-json-flag}

**Decision:** All `tugcode dash` subcommands produce human-readable text by default and JSON (using the existing `JsonResponse` envelope) when `--json` is passed.

**Rationale:**
- Matches existing tugcode pattern (global `--json` flag on `Cli` struct)
- Human-readable output is useful for manual testing and debugging
- The skill always passes `--json` for reliable parsing

**Implications:**
- Each subcommand needs both human-readable and JSON output paths
- JSON responses use the `JsonResponse<T>` envelope from `output.rs`

#### [D05] Dash create is idempotent with name reuse (DECIDED) {#d05-idempotent-create}

**Decision:** `tugcode dash create <name>` returns the existing dash info if a dash with that name already exists and is `active`, rather than erroring. If a dash with that name exists but is `joined` or `released`, the row is reactivated in place: status set back to `active`, description/branch/worktree/base_branch/timestamps overwritten with fresh values.

**Rationale:**
- The skill calls `create` on every first invocation; idempotency avoids race conditions and retry complexity
- Matches the pattern from `tugcode init` which is also idempotent
- Name reuse is natural for recurring tasks (per [D03])

**Implications:**
- Response includes `created: true|false` to distinguish new vs existing active dash
- Reactivation of a terminated name overwrites dash-level metadata and returns `created: true`
- Round history from previous incarnations persists (rows in `dash_rounds` remain keyed by `dash_name`); the dash's `created_at` timestamp distinguishes incarnation boundaries

#### [D06] Git commit skips when no changes, but round is always recorded (DECIDED) {#d06-skip-empty-commit}

**Decision:** `tugcode dash commit` always records a `dash_rounds` row (preserving full intent history), but skips the git commit if the worktree is clean. The response distinguishes `committed: true|false` and always includes the `round_id`.

**Rationale:**
- User answer: "Skip silently -- skip the commit and report to user that no changes were made"
- A dash round represents every agent invocation, not just commits -- even exploration-only rounds are valuable audit trail
- The `commit_hash` field is nullable; null means no git commit was created for that round

**Implications:**
- Round is always recorded with instruction, summary, and file lists; `commit_hash` is null when no git changes
- Skill reports "no changes made" to user when `committed: false`
- Round count in `dash show` reflects total agent invocations, not just commits

#### [D07] Dash-agent is independent from coder-agent (DECIDED) {#d07-independent-agent}

**Decision:** The dash-agent is a new, self-contained prompt document that specifies its own contract, not a fork or derivative of coder-agent.

**Rationale:**
- Dash-agent has no plan/step/drift concepts -- sharing a prompt would mean dead weight or confusing conditional sections
- Structural similarities (file path handling, build/test, persistent agent pattern) are intentionally duplicated to keep the two agents fully decoupled
- Changes to coder-agent (e.g., new drift thresholds) should never affect dash-agent

**Implications:**
- `tugplug/agents/dash-agent.md` is a standalone file with its own input/output contracts
- Shared behavioral concepts (absolute paths, no commits) are re-specified rather than inherited

#### [D08] Build and test runs are conditional on instruction type (DECIDED) {#d08-conditional-build-test}

**Decision:** The dash-agent runs build/test only when the instruction explicitly involves code or implementation changes, skipping for exploration, research, or documentation tasks.

**Rationale:**
- User answer: "Only when relevant -- only run build/test when the instruction explicitly involves code/implementation, skip for exploration"
- Avoids wasting time on build/test for non-code instructions

**Implications:**
- Agent prompt includes guidance on when to run build/test
- Output contract includes `build_passed` and `tests_passed` fields that may be null when skipped

#### [D09] Cross-session dash continuity via worktree context (DECIDED) {#d09-cross-session}

**Decision:** Full cross-session support from day one. When a dash is continued in a new session, a fresh agent is spawned with the worktree path and instruction; the worktree provides full file and git history continuity.

**Rationale:**
- User answer: "Full support now -- fresh agent gets worktree context, works across sessions from day one"
- The worktree on disk is the persistent state; the agent does not need session-to-session memory
- The skill calls `tugcode dash show` to get worktree path before spawning the agent

**Implications:**
- Skill must handle both "same session resume" (persistent agent) and "new session" (fresh agent spawn) transparently
- No session ID tracking needed in dash state

#### [D10] Join uses local squash-merge only (DECIDED) {#d10-local-join}

**Decision:** `tugcode dash join` performs a local `git merge --squash` to the base branch, not a PR-based merge. This is the local-mode pattern from `tugcode merge`.

**Rationale:**
- Dashes are lightweight and quick -- creating a PR adds ceremony
- The existing `tugcode merge` already demonstrates local squash-merge logic
- PR-based join can be added later as an enhancement

**Implications:**
- Join preflight checks that the repo root worktree has no uncommitted changes
- Squash commit message uses `tugdash(<name>): <message or description>` prefix
- No GitHub CLI (`gh`) dependency for dash operations

#### [D11] No concurrency locking for v1 (DECIDED) {#d11-no-locking}

**Decision:** Dashes have no lease or lock mechanism. One active session per dash at a time is a usage constraint, not an enforced invariant.

**Rationale:**
- Dashes are personal, single-developer quick work -- concurrency conflicts are unlikely
- The worktree provides natural filesystem isolation
- Adding locking infrastructure contradicts the lightweight philosophy
- The plan/implement pipeline's lease mechanism is overkill here

**Implications:**
- If two sessions work on the same dash simultaneously, git operations may conflict at the filesystem level (acceptable for v1)
- Documentation and agent prompt should note "one active session per dash" as a usage guideline
- Locking can be added in a future version if usage patterns demand it

#### [D12] Default branch detection at create time (DECIDED) {#d12-default-branch}

**Decision:** `tugcode dash create` detects the default branch at creation time using a fallback chain. The detected branch is stored in the `dashes` table as `base_branch` and used by `tugcode dash join` as the merge target.

Detection fallback chain:
1. `git symbolic-ref refs/remotes/origin/HEAD` -- extract branch name (works when origin is configured)
2. If that fails: check if `main` exists locally (`git rev-parse --verify main`)
3. If that fails: check if `master` exists locally (`git rev-parse --verify master`)
4. If all fail: error with message listing available local branches

**Rationale:**
- Not all repositories use `main` as the default branch -- some use `master`, `develop`, or custom names
- The chain covers: repos with origin (step 1), repos without origin but with `main` (step 2), legacy repos with `master` (step 3), and the edge case where none exist (step 4, clear error)
- Detecting once and storing avoids repeated detection and ensures consistency between create and join

**Implications:**
- `dashes` table gains `base_branch TEXT NOT NULL DEFAULT 'main'` column
- `detect_default_branch()` implements the four-step fallback chain
- `run_dash_create` detects default branch before creating the dash branch
- `run_dash_join` reads `base_branch` from state rather than assuming any particular branch name

#### [D13] Round metadata passed via stdin as JSON (DECIDED) {#d13-round-json}

**Decision:** Round metadata (instruction, summary, files_created, files_modified) is passed to `tugcode dash commit` via stdin as a JSON object, rather than as CLI flags. This avoids shell-argument escaping issues because the metadata does not pass through command-line flag parsing.

**Rationale:**
- Agent summaries and instructions can contain quotes, newlines, and special characters that are impossible to reliably escape in CLI flags
- Stdin transport avoids shell-argument escaping issues because metadata is not encoded in CLI flags
- Commit subject line is truncated to 72 characters from the summary; full summary goes in the commit body

**Implications:**
- `Commit` variant in `DashCommands` has `--message` for the commit message; round metadata is read from stdin
- If stdin is empty or not provided, round metadata fields default to null (the round is still recorded per [D06])
- The stdin JSON is parsed into `DashRoundMeta` with fields: `instruction`, `summary`, `files_created`, `files_modified` (all optional)
- Commit message: subject line is the `--message` value (or auto-generated from summary, truncated to 72 chars); body contains full summary if truncated

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Terminology {#terminology}

- **Dash**: A lightweight, worktree-isolated work unit identified by a name. Has a lifecycle: active -> joined or released.
- **Dash round**: A single agent invocation or system-initiated action within a dash. Always recorded in `dash_rounds` regardless of whether files changed. Records instruction (nullable for system rounds), summary, file changes, and commit hash (nullable if no git changes).
- **Join**: Squash-merge a dash's work back to the base branch and clean up the worktree and branch.
- **Release**: Discard a dash's worktree and branch without merging.

#### 1.0.1.2 Schema {#schema}

**Table T01: dashes Table Schema** {#t01-dashes-schema}

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `name` | TEXT | PRIMARY KEY | Dash name (validated per [D03]) |
| `description` | TEXT | | User-provided description from first instruction |
| `branch` | TEXT | NOT NULL | Branch name: `tugdash/<name>` |
| `worktree` | TEXT | NOT NULL | Absolute worktree path: `.tugtree/tugdash__<name>/` |
| `base_branch` | TEXT | NOT NULL DEFAULT 'main' | Base branch detected at create time per [D12] |
| `status` | TEXT | NOT NULL DEFAULT 'active' | Lifecycle: `active`, `joined`, `released` |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 timestamp |

**Table T02: dash_rounds Table Schema** {#t02-dash-rounds-schema}

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Auto-incrementing ID |
| `dash_name` | TEXT | NOT NULL REFERENCES dashes(name) | Foreign key to dashes |
| `instruction` | TEXT | | User instruction for this round (null for system-initiated rounds, e.g., join auto-commit) |
| `summary` | TEXT | | Agent summary of what was done |
| `files_created` | TEXT | | JSON array of created file paths |
| `files_modified` | TEXT | | JSON array of modified file paths |
| `commit_hash` | TEXT | | Git commit hash (null if no git changes per [D06]) |
| `started_at` | TEXT | NOT NULL | ISO 8601 timestamp |
| `completed_at` | TEXT | | ISO 8601 timestamp |

**Spec S01: SQL DDL for Dash Tables** {#s01-dash-ddl}

```sql
CREATE TABLE IF NOT EXISTS dashes (
    name        TEXT PRIMARY KEY,
    description TEXT,
    branch      TEXT NOT NULL,
    worktree    TEXT NOT NULL,
    base_branch TEXT NOT NULL DEFAULT 'main',
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dash_rounds (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dash_name      TEXT NOT NULL REFERENCES dashes(name),
    instruction    TEXT,
    summary        TEXT,
    files_created  TEXT,
    files_modified TEXT,
    commit_hash    TEXT,
    started_at     TEXT NOT NULL,
    completed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_dash_rounds_name ON dash_rounds(dash_name);
```

#### 1.0.1.3 CLI Subcommands {#cli-subcommands}

**Spec S02: tugcode dash create** {#s02-dash-create}

```
tugcode dash create <name> --description "..." [--json]
```

Behavior:
1. Validate name per [D03]
2. Check if dash already exists in state.db
   - If active: return existing info with `created: false` per [D05]
   - If joined/released: proceed to create new dash (name reuse per [D03], [D05])
3. Find repo root via `find_repo_root()`
4. Detect default branch via fallback chain per [D12]: (1) `git symbolic-ref refs/remotes/origin/HEAD`, (2) check `main` exists, (3) check `master` exists, (4) error with available branches
5. Create branch `tugdash/<name>` from HEAD of the detected base branch
6. Create worktree at `<repo_root>/.tugtree/tugdash__<name>/`
7. Insert new row into `dashes` table, or reactivate terminated row in place (UPDATE status to `active`, overwrite description/branch/worktree/base_branch/created_at/updated_at)
8. Return JSON or human-readable output

Rollback: if worktree creation fails after branch creation, delete the branch.

**Spec S03: tugcode dash commit** {#s03-dash-commit}

```
echo '{"instruction":"...","summary":"...","files_created":[...],"files_modified":[...]}' | tugcode dash commit <name> --message "..." [--json]
```

Round metadata is passed via stdin as a JSON object per [D13]. This avoids shell-argument escaping issues because metadata is not passed via CLI flags. If stdin is non-interactive and non-empty, parse it as round metadata JSON; otherwise, round metadata fields default to null. The skill uses a heredoc for multi-line content:

```
tugcode dash commit <name> --message "..." --json <<'EOF'
{"instruction":"add login page","summary":"Created login form with validation","files_created":["src/login.tsx"]}
EOF
```

Behavior:
1. Look up dash by name (must be `active`)
2. Read stdin and parse as `DashRoundMeta` JSON if present (all fields optional within the JSON)
3. Stage all changes in worktree: `git -C <worktree> add -A`
4. Check for staged changes
   - If changes: commit with `git -C <worktree> commit -m "<message>"` (subject truncated to 72 chars per [D13], full summary in body)
   - If no changes: skip git commit per [D06]
5. Always insert row into `dash_rounds` with instruction, summary, file lists, and commit_hash (null if no git changes)
6. Return JSON or human-readable output including `committed: true|false` and `round_id`

**Spec S04: tugcode dash join** {#s04-dash-join}

```
tugcode dash join <name> [--message "..."] [--json]
```

Behavior:
1. Look up dash by name (must be `active`)
2. **Preflight first (fail early, no side effects):** check repo root worktree is clean (no uncommitted changes)
3. **Verify context:** ensure we are running from the repo root worktree (not from inside a dash worktree)
4. **Verify current branch:** run `git rev-parse --abbrev-ref HEAD` in the repo root; if the result does not equal the dash's `base_branch`, error: "Cannot join: repo root worktree is on branch '<current>' but dash targets '<base_branch>'. Check out '<base_branch>' first." Do NOT auto-checkout -- the user must be in control of branch switching.
5. Commit any outstanding changes in the dash worktree (internal commit logic); if changes exist, record a synthetic round with instruction `"join: commit outstanding changes"` and summary derived from the diff
6. Squash-merge from repo root: `git merge --squash tugdash/<name>` (merge target is `base_branch` from state per [D12])
7. Commit on base branch: `git commit -m "tugdash(<name>): <message or description>"`
8. Update state: set dash status to `joined`, update `updated_at` (status goes to `joined` immediately on successful squash-merge commit)
9. Remove worktree: `git worktree remove <path>` (warn on failure, do not fail -- work is on base branch)
10. Delete branch: `git branch -D tugdash/<name>` (warn on failure, do not fail)
11. Return JSON or human-readable output

Partial failure recovery:
- Merge conflict: dash stays `active`, no state change, clear error message with recovery instructions ("resolve manually or release")
- Cleanup failure after successful merge: warn but mark as `joined` -- `tugcode worktree cleanup` can sweep orphans later

**Spec S05: tugcode dash release** {#s05-dash-release}

```
tugcode dash release <name> [--json]
```

Behavior:
1. Look up dash by name (must be `active`)
2. Remove worktree: `git worktree remove <path> --force`
3. Delete branch: `git branch -D tugdash/<name>` (warn on failure, do not fail -- mark as `released` regardless)
4. Update state: set dash status to `released`, update `updated_at`
5. Return JSON or human-readable output (include warnings if cleanup was partial)

**Spec S06: tugcode dash list** {#s06-dash-list}

```
tugcode dash list [--all] [--json]
```

Behavior:
1. Query `dashes` table for `active` dashes by default; with `--all`, include `joined` and `released` dashes too
2. For each active dash, verify worktree still exists on disk
3. Include round count from `dash_rounds` per dash
4. Return JSON array or human-readable table

**Spec S07: tugcode dash show** {#s07-dash-show}

```
tugcode dash show <name> [--all-rounds] [--json]
```

Behavior:
1. Query dash metadata from `dashes` table
2. Query rounds from `dash_rounds` table:
   - By default: only rounds from the **current incarnation** (where `started_at >= dash.created_at`). This keeps the default output clean -- you see only "this run."
   - With `--all-rounds`: all rounds including those from previous incarnations (for debugging/audit). Rounds from previous incarnations are those with `started_at < dash.created_at`.
   - Timestamp precision: all timestamps are stored as UTC ISO 8601 and compared as normalized UTC values for incarnation filtering.
3. For active dashes, check worktree for uncommitted changes via `git -C <worktree> status --porcelain`
4. Return JSON or human-readable detailed view

#### 1.0.1.4 Naming Conventions {#naming-conventions}

**Table T03: Naming Conventions** {#t03-naming-conventions}

| Item | Pattern | Example |
|------|---------|---------|
| Branch | `tugdash/<name>` | `tugdash/login-page` |
| Worktree dir | `.tugtree/tugdash__<name>/` | `.tugtree/tugdash__login-page/` |
| CLI namespace | `tugcode dash <subcommand>` | `tugcode dash create login-page` |
| Commit prefix | `tugdash(<name>):` | `tugdash(login-page): add login form` |
| Dash agent | `tugplug:dash-agent` | (Task subagent) |
| Dash skill | `tugplug:dash` | `/tugplug:dash login-page ...` |

#### 1.0.1.5 Dash-Agent Contract {#dash-agent-contract}

**Spec S08: Dash-Agent Input** {#s08-dash-agent-input}

Initial spawn:
```json
{
    "worktree_path": "/abs/path/to/.tugtree/tugdash__<name>/",
    "instruction": "natural language instruction from user"
}
```

Resume (same session):
```
<new instruction>
```

Resume (new session):
```json
{
    "worktree_path": "/abs/path/to/.tugtree/tugdash__<name>/",
    "instruction": "natural language instruction from user"
}
```

**Spec S09: Dash-Agent Output** {#s09-dash-agent-output}

```json
{
    "summary": "description of what was done",
    "files_created": ["relative/path/to/new-file.rs"],
    "files_modified": ["relative/path/to/changed-file.rs"],
    "build_passed": true,
    "tests_passed": true,
    "notes": "optional context for the skill"
}
```

Fields `build_passed` and `tests_passed` may be `null` when build/test was not relevant per [D08].

#### 1.0.1.6 Skill Parsing Rules {#skill-parsing-rules}

**Spec S10: Skill Input Parsing** {#s10-skill-parsing}

Input format: `/tugplug:dash <tokens...>`

Parsing:
1. First token is the dash name (e.g., `login-page`)
2. If name is `status` with no further tokens: list all dashes (`tugcode dash list`)
3. If second token is a reserved word (`release`, `join`, `status`): execute lifecycle command
4. If `join` has additional tokens: use as custom commit message
5. Otherwise: everything after the name is the instruction to the dash-agent

Reserved words: `release`, `join`, `status`

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New files {#new-files}

**Table T04: New Files** {#t04-new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugtool-core/src/dash.rs` | Core dash state functions (CRUD, round recording) |
| `tugcode/crates/tugcode/src/commands/dash.rs` | CLI `tugcode dash` subcommand implementations |
| `tugplug/agents/dash-agent.md` | Dash-agent prompt with input/output contracts |
| `tugplug/skills/dash/SKILL.md` | Dash skill orchestrator |

#### 1.0.2.2 Modified files {#modified-files}

**Table T05: Modified Files** {#t05-modified-files}

| File | Change |
|------|--------|
| `tugcode/crates/tugtool-core/src/state.rs` | Add dash table creation DDL to `StateDb::open()`, bump schema version |
| `tugcode/crates/tugtool-core/src/lib.rs` | Add `pub mod dash;` and re-exports |
| `tugcode/crates/tugtool-core/src/error.rs` | Add dash-specific error variants |
| `tugcode/crates/tugcode/src/cli.rs` | Add `Dash(DashCommands)` variant to `Commands` enum |
| `tugcode/crates/tugcode/src/commands/mod.rs` | Add `pub mod dash;` and re-exports |
| `tugcode/crates/tugcode/src/main.rs` | Add `Commands::Dash` match arm |

#### 1.0.2.3 Symbols to add {#symbols}

**Table T06: New Symbols** {#t06-new-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DashInfo` | struct | `tugtool-core/src/dash.rs` | Dash metadata: name, description, branch, worktree, base_branch, status, timestamps |
| `DashRound` | struct | `tugtool-core/src/dash.rs` | Round record: id, dash_name, instruction (nullable), summary, files, commit_hash (nullable), timestamps |
| `DashRoundMeta` | struct | `tugtool-core/src/dash.rs` | Parsed from stdin JSON: instruction, summary, files_created, files_modified (all optional) |
| `DashStatus` | enum | `tugtool-core/src/dash.rs` | `Active`, `Joined`, `Released` |
| `validate_dash_name` | fn | `tugtool-core/src/dash.rs` | Name validation per [D03] |
| `detect_default_branch` | fn | `tugtool-core/src/dash.rs` | Four-step fallback chain: origin/HEAD -> main -> master -> error per [D12] |
| `StateDb::create_dash` | method | `tugtool-core/src/dash.rs` (impl block) | INSERT new or UPDATE terminated row in place, idempotent per [D05], reuse per [D03] |
| `StateDb::get_dash` | method | `tugtool-core/src/dash.rs` | Query dash by name |
| `StateDb::list_dashes` | method | `tugtool-core/src/dash.rs` | Query dashes with round counts; `active_only` parameter controls filter |
| `StateDb::update_dash_status` | method | `tugtool-core/src/dash.rs` | Set status to joined/released |
| `StateDb::record_round` | method | `tugtool-core/src/dash.rs` | Always insert dash_rounds row; commit_hash nullable per [D06] |
| `StateDb::get_dash_rounds` | method | `tugtool-core/src/dash.rs` | Query rounds for a dash; `current_incarnation_only` parameter (default true) filters by `started_at >= created_at` |
| `DashCommands` | enum | `tugcode/src/commands/dash.rs` | Clap subcommand enum: Create, Commit, Join, Release, List, Show |
| `run_dash_create` | fn | `tugcode/src/commands/dash.rs` | Create subcommand with base branch detection per [D12] |
| `run_dash_commit` | fn | `tugcode/src/commands/dash.rs` | Commit subcommand reading round metadata from stdin per [D13], always records round per [D06] |
| `run_dash_join` | fn | `tugcode/src/commands/dash.rs` | Join subcommand with reordered preflight, branch verification, base_branch merge target per [D12] |
| `run_dash_release` | fn | `tugcode/src/commands/dash.rs` | Release subcommand with warn-only cleanup |
| `run_dash_list` | fn | `tugcode/src/commands/dash.rs` | List subcommand with --all flag |
| `run_dash_show` | fn | `tugcode/src/commands/dash.rs` | Show subcommand with --all-rounds flag for incarnation history |
| `TugError::DashNotFound` | variant | `tugtool-core/src/error.rs` | Dash name not found in state.db |
| `TugError::DashNameInvalid` | variant | `tugtool-core/src/error.rs` | Name fails validation per [D03] |
| `TugError::DashNotActive` | variant | `tugtool-core/src/error.rs` | Dash exists but is not in `active` status |
| `TugError::DashJoinFailed` | variant | `tugtool-core/src/error.rs` | Squash-merge failed (merge conflict or other git error) |
| `TugError::DashWrongBranch` | variant | `tugtool-core/src/error.rs` | Repo root worktree is on wrong branch for join (expected base_branch, got current) |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test dash name validation, state functions in isolation | Core logic in `dash.rs` |
| **Integration** | Test full CLI subcommand flows with real git repos | All `tugcode dash` subcommands end-to-end |

#### Key Test Scenarios {#test-scenarios}

**List L01: Dash State Unit Tests** {#l01-dash-state-tests}

- `validate_dash_name` accepts valid names (`login-page`, `fix-bug`, `ab`)
- `validate_dash_name` rejects invalid names (uppercase, special chars, reserved words, single char, leading/trailing hyphens)
- `StateDb::create_dash` inserts a row and returns `created: true`
- `StateDb::create_dash` returns `created: false` for existing active dash (idempotent)
- `StateDb::create_dash` reactivates a joined/released dash in place (name reuse per [D03], [D05]); previous round history persists
- `StateDb::get_dash` returns `None` for nonexistent dash
- `StateDb::record_round` inserts round with commit_hash and increments count
- `StateDb::record_round` inserts round with null commit_hash (no-change round per [D06])
- `StateDb::get_dash_rounds` with `current_incarnation_only=true` returns only current incarnation rounds
- `StateDb::get_dash_rounds` with `current_incarnation_only=false` returns all rounds across incarnations
- `StateDb::update_dash_status` transitions active -> joined and active -> released
- `StateDb::list_dashes` with `active_only=true` returns only active dashes
- `StateDb::list_dashes` with `active_only=false` returns all dashes with correct round counts

**List L02: Dash CLI Integration Tests** {#l02-dash-cli-tests}

- `tugcode dash create` creates worktree and branch in a real git repo
- `tugcode dash create` is idempotent (second call returns existing active dash)
- `tugcode dash create` reuses name of previously joined dash (name reuse)
- `tugcode dash create` detects default branch via fallback chain (origin/HEAD -> main -> master -> error)
- `tugcode dash commit` stages, commits, and records round with commit_hash
- `tugcode dash commit` skips git commit when worktree is clean but still records round with null commit_hash
- `tugcode dash commit` reads and parses round metadata from stdin correctly
- `tugcode dash commit` parses round metadata correctly when provided via heredoc stdin
- `tugcode dash join` performs preflight before any side effects
- `tugcode dash join` verifies current branch matches base_branch (errors when on wrong branch, does not auto-checkout)
- `tugcode dash join` squash-merges to base_branch and cleans up
- `tugcode dash join` fails gracefully when repo root worktree is dirty (no state change)
- `tugcode dash join` auto-commits outstanding changes and records synthetic round
- `tugcode dash join` on merge conflict: dash stays active, clear error
- `tugcode dash release` removes worktree and branch, warns on partial cleanup failure
- `tugcode dash list` shows only active dashes by default
- `tugcode dash list --all` includes joined and released dashes
- `tugcode dash show` shows dash details and current incarnation rounds by default (including no-change rounds)
- `tugcode dash show --all-rounds` includes rounds from previous incarnations
- JSON output conforms to `JsonResponse` envelope for all subcommands

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Schema Migration and Core Dash State Functions {#step-0}

**Commit:** `feat(state): add dashes and dash_rounds tables to state.db`

**References:** [D01] Shared state.db, [D02] Idempotent migration, [D03] Name validation and reuse, [D05] Idempotent create with reuse, [D06] Round always recorded, [D11] No locking, [D12] Default branch detection, [D13] Round metadata via stdin, Spec S01, Tables T01-T02, Table T04, Table T06, (#schema, #t01-dashes-schema, #t02-dash-rounds-schema, #s01-dash-ddl)

**Artifacts:**
- New file `tugcode/crates/tugtool-core/src/dash.rs` with all dash state types and functions
- Modified `tugcode/crates/tugtool-core/src/state.rs` with dash table DDL in `StateDb::open()`
- Modified `tugcode/crates/tugtool-core/src/lib.rs` with `pub mod dash;` and re-exports
- Modified `tugcode/crates/tugtool-core/src/error.rs` with dash error variants

**Tasks:**
- [ ] Add dash table creation DDL (`CREATE TABLE IF NOT EXISTS dashes ...` with `base_branch` column, `CREATE TABLE IF NOT EXISTS dash_rounds ...` with nullable `instruction`, index) to `StateDb::open()` in `state.rs` per Spec S01
- [ ] Bump schema version from 1 to 2 in `StateDb::open()`
- [ ] Create `tugcode/crates/tugtool-core/src/dash.rs` with types: `DashInfo` (including `base_branch` field), `DashRound` (nullable instruction and commit_hash), `DashRoundMeta` (deserialized from stdin JSON), `DashStatus` enum
- [ ] Implement `validate_dash_name()` function with regex validation and reserved word check
- [ ] Implement `detect_default_branch()` function with four-step fallback chain per [D12]: (1) `git symbolic-ref refs/remotes/origin/HEAD` and extract branch name, (2) `git rev-parse --verify main`, (3) `git rev-parse --verify master`, (4) error listing available local branches
- [ ] Implement `StateDb::create_dash()` -- idempotent for active dashes per [D05]; reactivates joined/released dashes in place (name reuse per [D03]) by UPDATE-ing the existing row: status back to `active`, description/branch/worktree/base_branch/created_at/updated_at overwritten with new values; previous `dash_rounds` rows remain associated
- [ ] Implement `StateDb::get_dash()` -- query by name, returns `Option<DashInfo>`
- [ ] Implement `StateDb::list_dashes()` -- query dashes with round counts via JOIN; `active_only` parameter to filter active-only (default) vs all dashes
- [ ] Implement `StateDb::update_dash_status()` -- transition active -> joined/released
- [ ] Implement `StateDb::record_round()` -- always insert round row per [D06]; instruction and commit_hash are nullable
- [ ] Implement `StateDb::get_dash_rounds()` -- query rounds for a dash ordered by id; `current_incarnation_only` parameter (default true) filters by `started_at >= dash.created_at` to show only current incarnation rounds
- [ ] Add `pub mod dash;` to `lib.rs` and add re-exports for all public types and functions
- [ ] Add `TugError::DashNotFound`, `TugError::DashNameInvalid`, `TugError::DashNotActive`, `TugError::DashJoinFailed`, `TugError::DashWrongBranch` variants to `error.rs`

**Tests:**
- [ ] Unit test: `validate_dash_name` accepts valid names and rejects invalid names (List L01)
- [ ] Unit test: `create_dash` idempotent behavior -- new dash returns created=true, existing active returns created=false
- [ ] Unit test: `create_dash` reactivates joined/released dash in place (name reuse: returns created=true with new timestamps; previous rounds still accessible via `get_dash_rounds`)
- [ ] Unit test: `get_dash` returns None for nonexistent, Some for existing
- [ ] Unit test: `record_round` with commit_hash and `get_dash_rounds` round-trip
- [ ] Unit test: `record_round` with null commit_hash (no-change round per [D06])
- [ ] Unit test: `get_dash_rounds` with `current_incarnation_only=true` returns only rounds from current incarnation (after reactivation, old rounds are excluded)
- [ ] Unit test: `get_dash_rounds` with `current_incarnation_only=false` returns all rounds across incarnations
- [ ] Unit test: `list_dashes` with `active_only=true` returns only active dashes
- [ ] Unit test: `list_dashes` with `active_only=false` returns all dashes with correct round counts
- [ ] Unit test: `update_dash_status` transitions correctly
- [ ] Unit test: schema version is bumped to 2

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings
- [ ] New unit tests for dash state functions all pass

**Rollback:**
- Revert the four modified/created files; schema is additive-only so existing databases are unaffected

**Commit after all checkpoints pass.**

---

#### Step 1: CLI Subcommand Skeleton and Create/List/Show {#step-1}

**Depends on:** #step-0

**Commit:** `feat(cli): add tugcode dash create, list, show subcommands`

**References:** [D04] JSON via --json flag, [D05] Idempotent create with reuse, [D12] Default branch detection, Spec S02, Spec S06, Spec S07, Table T03, Table T04, Table T05, Table T06, (#cli-subcommands, #s02-dash-create, #s06-dash-list, #s07-dash-show, #naming-conventions)

**Artifacts:**
- New file `tugcode/crates/tugcode/src/commands/dash.rs` with `DashCommands` enum and `run_dash_create`, `run_dash_list`, `run_dash_show`
- Modified `tugcode/crates/tugcode/src/cli.rs` -- `Dash(DashCommands)` in `Commands` enum
- Modified `tugcode/crates/tugcode/src/commands/mod.rs` -- `pub mod dash;` and re-exports
- Modified `tugcode/crates/tugcode/src/main.rs` -- `Commands::Dash` match arm dispatching to subcommands

**Tasks:**
- [ ] Create `tugcode/crates/tugcode/src/commands/dash.rs` with `DashCommands` enum (Create, Commit, Join, Release, List, Show) using clap derive, following `WorktreeCommands` pattern; List variant includes `--all` flag
- [ ] Implement `run_dash_create()`: validate name, find repo root, detect default branch per [D12], create branch (`git branch tugdash/<name> <base_branch>`), create worktree (`git worktree add`), INSERT or UPDATE (reactivate in place) state per [D05], handle rollback on partial failure
- [ ] Implement `run_dash_list()`: query state with `active_only` based on `--all` flag, verify worktrees exist on disk, format output
- [ ] Implement `run_dash_show()`: query state and rounds (current incarnation by default, all with `--all-rounds`), check for uncommitted changes, format output; Show variant in `DashCommands` includes `--all-rounds` flag
- [ ] Add `Dash(DashCommands)` variant to `Commands` enum in `cli.rs`
- [ ] Add `pub mod dash;` and re-exports to `commands/mod.rs`
- [ ] Add `Commands::Dash` match arm to `main.rs` dispatching all six subcommands (stub `todo!()` for commit, join, release)
- [ ] Add JSON output using `JsonResponse` envelope for all three implemented subcommands
- [ ] Add human-readable output for all three implemented subcommands

**Tests:**
- [ ] Integration test: `tugcode dash create` creates worktree and branch in a temp git repo
- [ ] Integration test: `tugcode dash create` returns existing dash on second call (idempotent)
- [ ] Integration test: `tugcode dash create` reuses name of previously joined dash
- [ ] Integration test: `tugcode dash list` shows only active dashes by default
- [ ] Integration test: `tugcode dash list --all` includes joined/released dashes
- [ ] Integration test: `tugcode dash show` returns dash details with base_branch and empty rounds list (current incarnation only by default)
- [ ] Integration test: `tugcode dash show --all-rounds` includes rounds from previous incarnations after name reuse
- [ ] Integration test: JSON output conforms to `JsonResponse` envelope

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings
- [ ] Manual: `tugcode dash create test-dash --description "test" --json` produces valid JSON with worktree path and base_branch
- [ ] Manual: `tugcode dash list --json` shows the created dash
- [ ] Manual: `tugcode dash show test-dash --json` shows dash details including base_branch

**Rollback:**
- Revert new file and modifications to cli.rs, mod.rs, main.rs

**Commit after all checkpoints pass.**

---

#### Step 2: Dash Commit Subcommand {#step-2}

**Depends on:** #step-1

**Commit:** `feat(cli): add tugcode dash commit subcommand`

**References:** [D06] Round always recorded, [D13] Round metadata via stdin, Spec S03, Table T02, Table T06, (#s03-dash-commit, #t02-dash-rounds-schema)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/dash.rs` -- `run_dash_commit` implementation replacing `todo!()`

**Tasks:**
- [ ] Implement `run_dash_commit()`: look up dash, read stdin and parse as `DashRoundMeta` JSON per [D13] (empty stdin results in null metadata fields), stage all changes, check for changes, commit if dirty (subject truncated to 72 chars per [D13], full summary in body), always record round in state.db per [D06] (commit_hash is null when no git changes)
- [ ] Add stdin reading logic to `Commit` handler: detect non-interactive stdin (not a TTY), read and parse as JSON when non-empty; if interactive or empty, use null metadata
- [ ] Add JSON and human-readable output for commit subcommand including `committed: true|false` and `round_id`
- [ ] Wire up `--message` flag for commit message

**Tests:**
- [ ] Integration test: `dash commit` after creating a file in the worktree stages, commits, and records round with commit_hash
- [ ] Integration test: `dash commit` with clean worktree returns `committed: false` but still records round with null commit_hash
- [ ] Integration test: `dash commit` with round metadata piped via stdin records instruction and summary in round
- [ ] Integration test: `dash commit` with round metadata via heredoc stdin records instruction and summary in round
- [ ] Integration test: `dash commit` records a round in state.db (verified via `dash show` showing round count incremented)
- [ ] Integration test: commit subject line is truncated to 72 chars when summary is long

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings
- [ ] Manual: create dash, add file to worktree, `tugcode dash commit test-dash --message "test" --json` succeeds with `committed: true`
- [ ] Manual: `tugcode dash commit test-dash --message "noop" --json` on clean worktree succeeds with `committed: false`
- [ ] Manual: `tugcode dash show test-dash --json` shows 2 rounds (one with commit_hash, one without)

**Rollback:**
- Revert changes to `commands/dash.rs`

**Commit after all checkpoints pass.**

---

#### Step 3: Dash Join and Release Subcommands {#step-3}

**Depends on:** #step-2

**Commit:** `feat(cli): add tugcode dash join and release subcommands`

**References:** [D10] Local join, [D12] Default branch detection, Spec S04, Spec S05, Table T06, (#s04-dash-join, #s05-dash-release)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/dash.rs` -- `run_dash_join` and `run_dash_release` implementations replacing `todo!()`

**Tasks:**
- [ ] Implement `run_dash_join()` with reordered steps per Spec S04: (1) look up dash, (2) preflight -- check repo root worktree is clean (fail early, no side effects), (3) verify running from repo root worktree not inside dash worktree, (4) verify current branch matches dash's `base_branch` via `git rev-parse --abbrev-ref HEAD` -- error with `DashWrongBranch` if mismatch (do NOT auto-checkout), (5) commit outstanding worktree changes and record synthetic round with instruction `"join: commit outstanding changes"`, (6) squash-merge to base_branch from state per [D12], (7) commit with `tugdash(<name>):` prefix, (8) update state to `joined` immediately, (9) remove worktree (warn on failure), (10) delete branch (warn on failure)
- [ ] Implement merge conflict handling for join: dash stays `active`, no state change, clear error message with recovery instructions ("resolve manually or release")
- [ ] Implement partial failure handling: state goes to `joined` on successful squash-merge commit; cleanup failures (worktree/branch removal) are warnings, not errors
- [ ] Implement `run_dash_release()`: remove worktree with `--force`, delete branch (warn on failure per Spec S05), update state to `released`
- [ ] Add JSON and human-readable output for both subcommands (include warnings array for partial cleanup failures)

**Tests:**
- [ ] Integration test: full join lifecycle -- create, add file, commit, join -- verifies squash commit on base branch, worktree removed, branch deleted, state is `joined`
- [ ] Integration test: join with dirty repo root worktree fails with clear error before any side effects
- [ ] Integration test: join verifies context (not running from inside dash worktree)
- [ ] Integration test: join verifies current branch matches base_branch -- errors with clear message when on wrong branch
- [ ] Integration test: join with outstanding worktree changes auto-commits first and records synthetic round
- [ ] Integration test: join merge conflict -- dash stays active, error returned
- [ ] Integration test: full release lifecycle -- create, add file, release -- verifies worktree removed, branch deleted, state is `released`
- [ ] Integration test: release of nonexistent dash returns error
- [ ] Integration test: join/release of already-joined dash returns `DashNotActive` error

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings
- [ ] Manual: create dash, add file, join -- `git log --oneline -1` shows squash commit with `tugdash(...)` prefix
- [ ] Manual: create dash, release -- `git worktree list` shows no dash worktree, `tugcode dash list --all --json` shows status `released`

**Rollback:**
- Revert changes to `commands/dash.rs`

**Commit after all checkpoints pass.**

---

#### Step 4: Dash-Agent Prompt {#step-4}

**Depends on:** #step-0

**Commit:** `feat(plugin): add dash-agent prompt`

**References:** [D07] Independent agent, [D08] Conditional build/test, [D09] Cross-session support, [D11] No locking, Spec S08, Spec S09, Table T04, (#dash-agent-contract, #s08-dash-agent-input, #s09-dash-agent-output)

**Artifacts:**
- New file `tugplug/agents/dash-agent.md` with frontmatter, input/output contracts, behavioral rules

**Tasks:**
- [ ] Create `tugplug/agents/dash-agent.md` with YAML frontmatter: name `dash-agent`, model `sonnet`, tools `Read, Grep, Glob, Write, Edit, Bash, WebFetch, WebSearch`, `permissionMode: dontAsk`
- [ ] Write "Your Role" section: persistent coding agent for lightweight dash work, no plan/step/drift concepts
- [ ] Write "Persistent Agent Pattern" section: initial spawn (worktree_path + instruction), resume in same session (new instruction), resume in new session (worktree_path + instruction again)
- [ ] Write "Input Contract" section per Spec S08
- [ ] Write "Output Contract" section per Spec S09 with JSON schema
- [ ] Write "Behavioral Rules" section: absolute paths, relative output paths, never commit, build/test when relevant per [D08], stay within worktree, no plan context, persistent knowledge accumulation, note one active session per dash per [D11]
- [ ] Write "File Path Handling" section: all operations use `{worktree_path}/{relative_path}`, output paths are relative to worktree root

**Tests:**
- [ ] Manual: verify frontmatter parses correctly (valid YAML, correct tool list)
- [ ] Manual: verify agent can be spawned via Task tool with test input

**Checkpoint:**
- [ ] File `tugplug/agents/dash-agent.md` exists and has valid YAML frontmatter
- [ ] Agent prompt covers all behavioral rules from the design document

**Rollback:**
- Delete `tugplug/agents/dash-agent.md`

**Commit after all checkpoints pass.**

---

#### Step 5: Dash Skill {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `feat(plugin): add tugplug:dash skill`

**References:** [D04] JSON via --json flag, [D06] Round always recorded, [D09] Cross-session support, [D13] Round metadata via stdin, Spec S10, Table T03, Table T04, (#skill-parsing-rules, #s10-skill-parsing, #naming-conventions)

**Artifacts:**
- New file `tugplug/skills/dash/SKILL.md` with frontmatter, parsing logic, lifecycle orchestration, agent management

**Tasks:**
- [ ] Create `tugplug/skills/dash/SKILL.md` with YAML frontmatter: name `dash`, allowed tools `Task, AskUserQuestion, Bash`, Bash restriction hook (only `tugcode` commands)
- [ ] Write input parsing section per Spec S10: extract dash name, detect lifecycle commands vs instructions
- [ ] Write "New Dash" flow: `tugcode dash create` -> parse JSON -> spawn dash-agent via Task -> parse output -> pipe round metadata via stdin to `tugcode dash commit` per [D13] -> report to user
- [ ] Write "Continue Dash" flow: `tugcode dash show` -> parse JSON -> resume or spawn dash-agent -> parse output -> pipe round metadata via stdin to `tugcode dash commit` -> report to user
- [ ] Write "Join" flow: `tugcode dash show` -> confirm with user via AskUserQuestion -> `tugcode dash join` -> report result
- [ ] Write "Release" flow: confirm with user via AskUserQuestion -> `tugcode dash release` -> report result
- [ ] Write "Status" flow: `tugcode dash show` or `tugcode dash list` -> format and report
- [ ] Write progress reporting format: post-action messages showing summary, files, commit hash (or "no changes" when `committed: false`)
- [ ] Handle no-change round: when `dash commit` returns `committed: false`, report "no changes made" to user per [D06] (round is still recorded)
- [ ] Handle cross-session continuity: detect whether dash-agent was previously spawned in this session (resume via Task) or needs fresh spawn per [D09]
- [ ] Construct stdin JSON payload from agent output: map `summary`, `files_created`, `files_modified` from agent JSON, plus the user's original instruction; pipe via heredoc to `tugcode dash commit`

**Tests:**
- [ ] Manual: `/tugplug:dash test-feature add a hello world endpoint` creates dash, runs agent, commits
- [ ] Manual: `/tugplug:dash test-feature add tests for the endpoint` continues dash with agent
- [ ] Manual: `/tugplug:dash test-feature status` shows dash info
- [ ] Manual: `/tugplug:dash test-feature join` merges to base branch
- [ ] Manual: `/tugplug:dash status` lists all active dashes

**Checkpoint:**
- [ ] File `tugplug/skills/dash/SKILL.md` exists and has valid YAML frontmatter
- [ ] Skill covers all lifecycle commands: new dash, continue, join, release, status (single dash), status (all dashes)
- [ ] Bash restriction hook limits to `tugcode` commands only

**Rollback:**
- Delete `tugplug/skills/dash/SKILL.md` (and `tugplug/skills/dash/` directory)

**Commit after all checkpoints pass.**

---

#### Step 6: End-to-End Validation {#step-6}

**Depends on:** #step-5

**Commit:** `test(dash): end-to-end validation of dash workflow`

**References:** [D01] Shared state.db, [D05] Idempotent create with reuse, [D06] Round always recorded, [D10] Local join, [D12] Default branch detection, (#success-criteria)

**Artifacts:**
- No new files; validation of the complete integrated workflow

**Tasks:**
- [ ] Run full lifecycle test: create -> work -> commit -> work -> commit -> join; verify squash commit on base branch
- [ ] Run release lifecycle: create -> work -> release; verify cleanup
- [ ] Run idempotent create: create same active dash twice, verify second returns existing
- [ ] Run name reuse: join a dash, then create a new dash with the same name, verify new worktree and branch
- [ ] Run no-change round: create dash, immediately commit with no changes, verify round recorded with null commit_hash
- [ ] Run timestamp boundary check: reactivate a dash and immediately record a new round; verify default `dash show` excludes pre-reactivation rounds
- [ ] Verify `tugcode dash list` (active only) and `tugcode dash list --all` produce correct data at each stage
- [ ] Verify `tugcode dash show` includes all rounds (with and without commit hashes)
- [ ] Verify JSON output from all subcommands conforms to `JsonResponse` envelope
- [ ] Verify coexistence: create a plan worktree and a dash worktree simultaneously, confirm no interference
- [ ] Verify base_branch is stored and used correctly by join (test with non-main default branch if possible)
- [ ] Run `cargo nextest run` to confirm all unit and integration tests pass

**Tests:**
- [ ] Integration test: full lifecycle end-to-end (create -> commit -> join -> verify base branch)
- [ ] Integration test: name reuse after join
- [ ] Integration test: coexistence with plan worktree

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` -- all tests pass, no warnings
- [ ] Manual end-to-end test via `/tugplug:dash` skill completes successfully
- [ ] `tugcode dash list --json` returns empty array after all dashes are joined/released (no active dashes remain)
- [ ] `tugcode dash list --all --json` shows full history including joined/released dashes

**Rollback:**
- No structural changes to rollback; this step only validates

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** The dash workflow is fully operational -- users can create, work on, and complete lightweight dashes via `/tugplug:dash` without the full plan/implement pipeline.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All six `tugcode dash` subcommands work correctly with both human-readable and JSON output
- [ ] `dashes` and `dash_rounds` tables exist in state.db and are populated correctly through the full lifecycle
- [ ] The dash-agent prompt (`tugplug/agents/dash-agent.md`) is complete and functional
- [ ] The dash skill (`tugplug/skills/dash/SKILL.md`) orchestrates the full lifecycle correctly
- [ ] `cd tugcode && cargo nextest run` passes with no warnings
- [ ] End-to-end manual test: create dash, do work, join to base branch -- all automated

**Acceptance tests:**
- [ ] Integration test: full lifecycle (create -> commit -> join) in temp git repo
- [ ] Integration test: release lifecycle (create -> release) in temp git repo
- [ ] Integration test: name reuse (join -> create same name) in temp git repo
- [ ] Integration test: no-change round (commit with clean worktree records round with null commit_hash)
- [ ] Integration test: coexistence with plan worktree
- [ ] Unit tests: all dash state functions in `tugtool-core`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Remote mode for `tugcode dash join` (PR-based merge via `gh`)
- [ ] `tugcode dash rename` to rename an active dash
- [ ] `tugcode dash diff` to show a summary of all changes vs base branch
- [ ] Dash history browser in tugdeck web frontend
- [ ] Metrics/telemetry for dash usage patterns

| Checkpoint | Verification |
|------------|--------------|
| Schema migration | `tugcode dash create` + `tugcode dash show` return valid data |
| CLI subcommands | All six subcommands produce correct output with `--json` |
| Agent prompt | Dash-agent can be spawned via Task and returns valid JSON |
| Skill orchestration | `/tugplug:dash` drives the full lifecycle |
| Full integration | End-to-end test passes |

**Commit after all checkpoints pass.**
