## Phase 1.0: Descriptive Plan Naming and Unified Plan Resolution {#phase-slug-resolve}

**Purpose:** Ship two ergonomic improvements to tugtool: (1) the author-agent derives a short descriptive slug from the idea so plan files read `tugplan-user-auth.md` instead of `tugplan-5.md`, and (2) a single `resolve_plan()` function in tugtool-core plus a `tugtool resolve` CLI subcommand replaces the eight separate normalize/resolve functions scattered across status.rs, merge.rs, worktree.rs, validate.rs, and four beads subcommands (sync.rs, status.rs, pull.rs, link.rs), giving every command and skill a consistent resolution cascade with full backward compatibility.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | -- |
| Last updated | 2026-02-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Today, the author-agent names plan files by incrementing a number (`tugplan-1.md`, `tugplan-2.md`, ...). Once a project accumulates several plans, the numbers are opaque -- you cannot tell what `tugplan-3.md` is about without opening it. Meanwhile, eight separate functions implement slightly different logic for turning user input into a `.tugtool/tugplan-*.md` path: `resolve_file_path` is copy-pasted in status.rs, validate.rs, and four beads subcommands (sync.rs, status.rs, pull.rs, link.rs), while `normalize_plan_path` exists independently in merge.rs and worktree.rs with distinct signatures. None of them support slug-based lookup, prefix matching, or auto-selection when only one plan exists.

Fixing both issues together is natural: descriptive slugs create the need for flexible resolution (users will type `user-auth` instead of the full path), and a unified resolver is the right place to handle the new slug inputs alongside legacy numeric ones.

#### Strategy {#strategy}

- Build the unified `resolve_plan()` function first (Step 0) since it is a pure library addition with no breaking changes.
- Add the `tugtool resolve` CLI subcommand next (Step 1) so skills and agents can use it immediately.
- Replace all eight existing normalize/resolve functions with calls to `resolve_plan()` (Step 2), deleting the duplicate code.
- Modify the author-agent to derive descriptive slugs (Step 3) as the final agent-layer change, which benefits from the resolver already being in place.
- Each step produces a compilable, testable codebase; no step depends on forward work.

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool users who invoke `/tugtool:plan` and `/tugtool:implement` skills
2. Agent developers maintaining the planning and implementation workflows

#### Success Criteria (Measurable) {#success-criteria}

- `tugtool resolve user-auth` returns the correct `.tugtool/tugplan-user-auth.md` path (or an error with candidates if ambiguous)
- `tugtool resolve 1` still returns `.tugtool/tugplan-1.md` (backward compatibility)
- `tugtool resolve` with no argument returns the single plan when only one exists, or an ambiguous error with all candidates
- All eight old normalize/resolve functions are deleted from status.rs, validate.rs, merge.rs, worktree.rs, and the four beads subcommands
- `/tugtool:plan "add user authentication"` produces a file named `tugplan-user-auth.md` (or similar descriptive slug) instead of `tugplan-N.md`
- On slug collision, the author-agent appends a numeric suffix (`user-auth-2`)
- All existing tests pass; `cargo nextest run` is green; `cargo clippy` has zero warnings

#### Scope {#scope}

1. New `resolve_plan()` function in `tugtool-core/src/config.rs` (or a new `resolve.rs` module)
2. New `tugtool resolve` CLI subcommand in `crates/tugtool/src/commands/resolve.rs`
3. Refactor merge.rs, status.rs, validate.rs, worktree.rs, and four beads subcommands to use `resolve_plan()`
4. Modify author-agent to derive descriptive slugs from ideas

#### Non-goals (Explicitly out of scope) {#non-goals}

- Migrating existing numeric plan files to descriptive slugs (they remain as-is)
- Interactive disambiguation (the resolver returns candidates in JSON; callers decide)
- Changing the plan file format or skeleton structure
- Adding plan renaming or aliasing capabilities

#### Dependencies / Prerequisites {#dependencies}

- The existing `find_tugplans()` function in config.rs (used by the resolver to enumerate plans)
- The existing `tugplan_name_from_path()` function in config.rs (used to extract slug from path)
- The `^[a-z][a-z0-9-]{1,49}$` regex already enforced by `NamingConfig::name_pattern`

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` via `.cargo/config.toml`) -- all code must be warning-free
- The resolver must work without a project root for exact-path inputs
- Slug generation is LLM-based (author-agent), not a deterministic algorithm in Rust

#### Assumptions {#assumptions}

- The existing regex `^[a-z][a-z0-9-]{1,49}$` is sufficient for validating descriptive slugs
- Skills will call `tugtool resolve <arg>` via Bash and parse JSON output
- No two plans will ever have slugs that differ only by numeric suffix unless caused by collision handling

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| LLM-generated slugs are inconsistent or too long | low | medium | Validate against regex; truncate/reject if non-conforming | User reports confusing plan names |
| Prefix matching returns wrong plan | medium | low | Require unique prefix; return ambiguous error with candidates | False match reported |

**Risk R01: Slug quality from LLM** {#r01-slug-quality}

- **Risk:** The author-agent may generate slugs that are too generic ("add-feature") or too long.
- **Mitigation:** Validate slug against `^[a-z][a-z0-9-]{1,49}$` before writing the file. If validation fails, fall back to numeric naming.
- **Residual risk:** Slugs may be descriptive but not maximally helpful; this is acceptable and can be improved over time.

**Risk R02: Breaking existing command callers** {#r02-breaking-callers}

- **Risk:** Replacing the normalize/resolve functions could break existing callers that depend on specific path formats.
- **Mitigation:** Step 2 runs the full test suite after each replacement; the new function is a strict superset of the old behavior.
- **Residual risk:** Untested edge cases in external scripts calling `tugtool` directly.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Unified resolve_plan() lives in tugtool-core (DECIDED) {#d01-resolve-in-core}

**Decision:** The `resolve_plan()` function is implemented in `tugtool-core` (in a new `resolve.rs` module) so that both the CLI binary crate and any future library consumers can use it.

**Rationale:**
- The eight existing functions are in the CLI crate and cannot be shared.
- `tugtool-core` already hosts `find_tugplans()`, `find_project_root()`, and `tugplan_name_from_path()` which `resolve_plan()` depends on.

**Implications:**
- A new `resolve.rs` module is added to `tugtool-core/src/`.
- The `resolve_plan()` function is re-exported from `tugtool-core/src/lib.rs`.

#### [D02] Resolution cascade order is fixed (DECIDED) {#d02-cascade-order}

**Decision:** The resolution cascade is: exact path -> bare filename -> slug -> unique prefix match -> auto-select (single plan) -> ambiguous error with candidates.

**Rationale:**
- Most specific match first avoids surprising results.
- Auto-select (when only one plan exists) is last because it ignores the input entirely.
- Returning candidates in JSON for ambiguous matches lets callers decide presentation.

**Implications:**
- The resolver checks each stage in order, returning on the first match.
- The "auto-select" stage only triggers when no earlier stage matched and exactly one plan exists.

#### [D03] Legacy numeric plans are first-class (DECIDED) {#d03-legacy-numeric}

**Decision:** Bare numeric input (e.g., `1`, `42`) resolves to `tugplan-N.md` via the slug stage of the cascade, with no special-casing.

**Rationale:**
- `1` is a valid slug that matches `tugplan-1.md` -- the existing cascade handles it naturally.
- No migration or dual-path logic needed.

**Implications:**
- The slug stage checks for `tugplan-{input}.md` in the `.tugtool/` directory.
- Numeric-only slugs remain valid indefinitely.

#### [D04] Author-agent derives slugs via LLM judgment (DECIDED) {#d04-llm-slug}

**Decision:** The author-agent uses LLM judgment to pick a 2-4 word, kebab-case slug from the idea, rather than a deterministic algorithm.

**Rationale:**
- LLM judgment produces more natural, meaningful names than word-extraction heuristics.
- The author-agent already understands the idea context from the clarifier handoff.

**Implications:**
- The author-agent system prompt is updated with slug derivation instructions.
- Slug validation (regex check) happens after derivation.
- On collision with an existing plan, the author-agent appends a numeric suffix (e.g., `user-auth-2`).

#### [D05] Ambiguous resolution returns candidates in JSON (DECIDED) {#d05-ambiguous-candidates}

**Decision:** When resolution is ambiguous (multiple matches), the resolver returns an error containing a list of candidate paths in JSON, rather than prompting interactively or picking one.

**Rationale:**
- Agents and skills consume JSON output; interactive prompts would break automation.
- Returning candidates lets each caller decide how to present the ambiguity (error message, selection UI, etc.).

**Implications:**
- The `ResolveResult` type includes a `candidates` field for the ambiguous case.
- The CLI `tugtool resolve` command outputs `{"status": "error", "candidates": [...]}` on ambiguity.

#### [D06] resolve_plan() returns Result of structured enum (DECIDED) {#d06-structured-result}

**Decision:** `resolve_plan()` returns `Result<ResolveResult, TugError>` where `ResolveResult` has variants `Found { path: PathBuf, stage: ResolveStage }`, `NotFound`, and `Ambiguous(Vec<PathBuf>)`. The `Found` variant carries the `ResolveStage` that produced the match, enabling the CLI to report stage information in its JSON output.

**Rationale:**
- The ambiguous case is not an error in the traditional sense; it carries useful data (the candidate list).
- Filesystem/initialization errors (e.g., `.tugtool/` missing) are distinct from "not found" and should propagate as `TugError`.
- The stage information is needed by Spec S02 to populate the `stage` field in JSON output; embedding it in `Found` avoids requiring callers to track it separately.

**Implications:**
- The `ResolveResult` and `ResolveStage` types are defined in `resolve.rs` and re-exported from `lib.rs`.
- CLI and skill callers first handle `Err(TugError)`, then pattern-match on the `ResolveResult` variants.
- The `Found` variant uses named fields (`path`, `stage`) rather than positional tuple fields for clarity.

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs:**
- `input: &str` -- the user-provided plan identifier (path, filename, slug, numeric ID, or empty for auto-select)
- `project_root: &Path` -- the root directory containing `.tugtool/`

**Outputs:**
- `Result<ResolveResult, TugError>` -- `Ok` with one of:
  - `Found { path: PathBuf, stage: ResolveStage }` -- the resolved path and which cascade stage matched
  - `NotFound` -- no plan matched the input
  - `Ambiguous(Vec<PathBuf>)` -- multiple plans matched (candidates are sorted)
- `Err(TugError)` -- filesystem or initialization errors (e.g., `find_tugplans()` fails because `.tugtool/` does not exist)

**Key invariants:**
- If `input` is an absolute path that exists, it is returned directly (no project root needed); filesystem errors at this stage propagate as `Err`.
- The cascade never returns `Ambiguous` if exactly one plan matches at any stage.
- `NotFound` is returned only after all cascade stages have been exhausted.
- `Err(TugError::NotInitialized)` is returned if the project root lacks a `.tugtool/` directory and the input is not an exact path.

#### 1.0.1.2 Terminology {#terminology}

- **Slug:** The name portion of a plan file, e.g., `user-auth` from `tugplan-user-auth.md`.
- **Resolution cascade:** The ordered sequence of matching strategies applied to user input.
- **Prefix match:** A slug that starts with the input, e.g., input `user` matches `user-auth`.
- **Auto-select:** When exactly one plan exists and no other cascade stage matched, return it.

#### 1.0.1.3 Resolution Cascade Stages (Exhaustive) {#cascade-stages}

**Spec S01: Resolution Cascade** {#s01-cascade}

| Stage | Input pattern | Match logic | Example input | Example match |
|-------|--------------|-------------|---------------|---------------|
| 1. Exact path | Starts with `/` or `.` | `Path::new(input).exists()` | `.tugtool/tugplan-1.md` | `.tugtool/tugplan-1.md` |
| 2. Bare filename | Starts with `tugplan-` | Join with `.tugtool/` dir | `tugplan-user-auth.md` | `.tugtool/tugplan-user-auth.md` |
| 3. Slug | Any remaining string | Check `tugplan-{input}.md` exists | `user-auth` or `1` | `.tugtool/tugplan-user-auth.md` |
| 4. Prefix | Any remaining string | All slugs starting with input | `user` | `.tugtool/tugplan-user-auth.md` (if unique) |
| 5. Auto-select | Empty string or no match | Exactly one plan in directory | `` (empty) | `.tugtool/tugplan-only-plan.md` |

**Rules:**
- Stages are tried in order 1-5.
- If a stage finds exactly one match, return `Ok(Found { path, stage })`.
- If a stage finds multiple matches, return `Ok(Ambiguous(candidates))`.
- If no stage matches, return `Ok(NotFound)`.
- Stage 5 (auto-select) also triggers when input is empty/blank.
- If `find_tugplans()` fails (e.g., `.tugtool/` missing), return `Err(TugError)`. This only affects stages 4 and 5 which enumerate plans; stages 1-3 check specific paths and do not require enumeration.

#### 1.0.1.4 Public API Surface {#public-api}

**Rust:**
```rust
// In tugtool-core/src/resolve.rs

/// Which cascade stage produced the match
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveStage {
    Exact,
    Filename,
    Slug,
    Prefix,
    Auto,
}

/// Result of resolving a plan identifier
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveResult {
    /// Exactly one plan matched, with the stage that matched
    Found { path: PathBuf, stage: ResolveStage },
    /// No plan matched the input
    NotFound,
    /// Multiple plans matched; candidates are sorted
    Ambiguous(Vec<PathBuf>),
}

/// Resolve a user-provided plan identifier to a plan file path.
///
/// Cascade: exact path -> bare filename -> slug -> prefix -> auto-select.
/// Returns Err(TugError) for filesystem/init errors (e.g., missing .tugtool/).
pub fn resolve_plan(input: &str, project_root: &Path) -> Result<ResolveResult, TugError>
```

#### 1.0.1.5 CLI Output Schema {#cli-output}

**Spec S02: `tugtool resolve` Response Schema** {#s02-resolve-response}

**Success response (found):**
```json
{
  "status": "ok",
  "command": "resolve",
  "data": {
    "path": ".tugtool/tugplan-user-auth.md",
    "slug": "user-auth",
    "stage": "slug"
  }
}
```

**Ambiguous response:**
```json
{
  "status": "error",
  "command": "resolve",
  "data": {
    "candidates": [
      ".tugtool/tugplan-user-auth.md",
      ".tugtool/tugplan-user-roles.md"
    ]
  },
  "issues": [
    {
      "code": "E040",
      "severity": "error",
      "message": "Ambiguous plan identifier 'user': matches 2 plans"
    }
  ]
}
```

**Not found response:**
```json
{
  "status": "error",
  "command": "resolve",
  "data": {
    "candidates": []
  },
  "issues": [
    {
      "code": "E041",
      "severity": "error",
      "message": "No plan found matching 'nonexistent'"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | on success | Relative path to the resolved plan file |
| `slug` | string | on success | Extracted slug (name portion without prefix/extension) |
| `stage` | string | on success | Which cascade stage matched: `exact`, `filename`, `slug`, `prefix`, `auto` |
| `candidates` | string[] | on error | List of candidate paths (empty for not-found) |

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugtool-core/src/resolve.rs` | Unified `resolve_plan()` function and `ResolveResult` type |
| `crates/tugtool/src/commands/resolve.rs` | `tugtool resolve` CLI subcommand implementation |

#### 1.0.2.2 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ResolveResult` | enum | `tugtool-core/src/resolve.rs` | `Found { path, stage }`, `NotFound`, `Ambiguous(Vec<PathBuf>)` |
| `ResolveStage` | enum | `tugtool-core/src/resolve.rs` | `Exact`, `Filename`, `Slug`, `Prefix`, `Auto`; carried in `Found` |
| `resolve_plan` | fn | `tugtool-core/src/resolve.rs` | `fn resolve_plan(input: &str, project_root: &Path) -> Result<ResolveResult, TugError>` |
| `Commands::Resolve` | variant | `tugtool/src/cli.rs` | New CLI subcommand |
| `run_resolve` | fn | `tugtool/src/commands/resolve.rs` | CLI handler for `tugtool resolve` |
| `ResolveData` | struct | `tugtool/src/output.rs` | JSON response data for resolve command |

#### 1.0.2.3 Symbols to delete {#symbols-delete}

**Table T01: Functions to delete** {#t01-functions-to-delete}

| Symbol | Location | Call sites | Replaced by |
|--------|----------|-----------|-------------|
| `resolve_file_path` | `commands/status.rs` (line 266) | line 72 | `resolve_plan()` |
| `resolve_file_path` | `commands/validate.rs` (line 195) | line 97 | `resolve_plan()` |
| `resolve_file_path` | `commands/beads/sync.rs` (line 646) | line 92 | `resolve_plan()` |
| `resolve_file_path` | `commands/beads/status.rs` (line 297) | line 75 | `resolve_plan()` |
| `resolve_file_path` | `commands/beads/pull.rs` (line 295) | line 72 | `resolve_plan()` |
| `resolve_file_path` | `commands/beads/link.rs` (line 277) | line 81 | `resolve_plan()` |
| `normalize_plan_path` | `commands/merge.rs` (line 700) | line 982 | `resolve_plan()` |
| `normalize_plan_path` | `commands/worktree.rs` (line 422) | lines 461, 1405, 1420, 1435 | `resolve_plan()` -- see note below |

**Note on worktree.rs:** The `normalize_plan_path` in worktree.rs has distinct semantics from the others. Its signature is `fn normalize_plan_path(plan: String, plan_path: PathBuf, repo_root: &Path) -> (String, PathBuf)` and its purpose is to strip an absolute path prefix back to a relative path so that `PathBuf::join` does not discard the base. When replacing this function, the implementer must ensure the caller (`run_worktree_create_with_root`) still receives a relative path. The recommended approach: call `resolve_plan()` to get the resolved absolute path, then strip `repo_root` to produce the relative path needed by the worktree path construction logic.

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `resolve_plan()` with various input patterns | Each cascade stage, edge cases |
| **Integration** | Test `tugtool resolve` CLI end-to-end | JSON output verification |
| **Golden** | Compare CLI JSON output against snapshots | Output schema stability |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Add resolve module with resolve_plan() function {#step-0}

**Commit:** `feat: add resolve_plan() function in tugtool-core`

**References:** [D01] Resolve in core, [D02] Cascade order, [D03] Legacy numeric, [D06] Structured result, Spec S01, (#inputs-outputs, #cascade-stages, #public-api, #new-files, #symbols)

**Artifacts:**
- New file `crates/tugtool-core/src/resolve.rs` with `ResolveResult`, `ResolveStage`, and `resolve_plan()` function
- Updated `crates/tugtool-core/src/lib.rs` to declare `pub mod resolve;` and re-export symbols

**Tasks:**
- [ ] Create `crates/tugtool-core/src/resolve.rs` with `ResolveStage` enum (`Exact`, `Filename`, `Slug`, `Prefix`, `Auto`)
- [ ] Create `ResolveResult` enum: `Found { path: PathBuf, stage: ResolveStage }`, `NotFound`, `Ambiguous(Vec<PathBuf>)`
- [ ] Implement `resolve_plan(input: &str, project_root: &Path) -> Result<ResolveResult, TugError>` following Spec S01 cascade
- [ ] Stage 1 (exact path): check if input starts with `/` or `.` and the path exists
- [ ] Stage 2 (bare filename): check if input starts with `tugplan-` and join with `.tugtool/`
- [ ] Stage 3 (slug): check if `.tugtool/tugplan-{input}.md` exists
- [ ] Stage 4 (prefix): call `find_tugplans()`, filter by slug prefix, return `Found` if unique or `Ambiguous` if multiple; propagate `Err(TugError)` if `find_tugplans()` fails
- [ ] Stage 5 (auto-select): if input is empty or no prior match, call `find_tugplans()` and check if exactly one plan exists
- [ ] Add `pub mod resolve;` to `crates/tugtool-core/src/lib.rs`
- [ ] Re-export `ResolveResult`, `ResolveStage`, and `resolve_plan` from `lib.rs`

**Tests:**
- [ ] Unit test: exact path resolves to `Found { stage: Exact }`
- [ ] Unit test: bare filename resolves to `Found { stage: Filename }`
- [ ] Unit test: slug resolves to `Found { stage: Slug }` (both descriptive and numeric)
- [ ] Unit test: unique prefix resolves to `Found { stage: Prefix }`
- [ ] Unit test: ambiguous prefix returns `Ambiguous` with sorted candidates
- [ ] Unit test: auto-select with single plan returns `Found { stage: Auto }`
- [ ] Unit test: auto-select with multiple plans returns `Ambiguous`
- [ ] Unit test: non-existent input returns `NotFound`
- [ ] Unit test: empty input with no plans returns `NotFound`
- [ ] Unit test: legacy numeric input `1` resolves to `tugplan-1.md` with `stage: Slug`
- [ ] Unit test: missing `.tugtool/` directory returns `Err(TugError::NotInitialized)` for prefix/auto stages
- [ ] Unit test: exact path still works even when `.tugtool/` is missing (stages 1-3 do not require enumeration)

**Checkpoint:**
- [ ] `cargo build -p tugtool-core`
- [ ] `cargo nextest run -p tugtool-core`
- [ ] `cargo clippy -p tugtool-core`

**Rollback:**
- Revert commit; delete `resolve.rs`; remove re-exports from `lib.rs`.

**Commit after all checkpoints pass.**

---

#### Step 1: Add tugtool resolve CLI subcommand {#step-1}

**Depends on:** #step-0

**Commit:** `feat: add tugtool resolve CLI subcommand`

**References:** [D05] Ambiguous candidates, [D06] Structured result, Spec S02, (#cli-output, #new-files, #symbols)

**Artifacts:**
- New file `crates/tugtool/src/commands/resolve.rs` with `run_resolve()` function
- Updated `crates/tugtool/src/cli.rs` with `Commands::Resolve` variant
- Updated `crates/tugtool/src/commands/mod.rs` to export the new module
- Updated `crates/tugtool/src/main.rs` to dispatch the new command
- New `ResolveData` struct in `crates/tugtool/src/output.rs`
- Updated `CLAUDE.md` with `tugtool resolve` in Common Commands section

**Tasks:**
- [ ] Add `ResolveData` struct to `crates/tugtool/src/output.rs` with fields: `path`, `slug`, `stage`, `candidates`
- [ ] Create `crates/tugtool/src/commands/resolve.rs` implementing `run_resolve(input: Option<String>, json_output: bool, quiet: bool) -> Result<i32, String>`
- [ ] Call `resolve_plan()` from tugtool-core, handle `Err(TugError)` as E009/E002, and map `Ok(ResolveResult)` variants to JSON response (extract `stage` from `Found { path, stage }`)
- [ ] Add `Resolve` variant to `Commands` enum in `cli.rs` with optional `identifier` positional arg
- [ ] Register the new module in `commands/mod.rs`
- [ ] Add dispatch arm in `main.rs`
- [ ] Add `tugtool resolve` to the "Common Commands" section of `CLAUDE.md` under "CLI (Utility Commands)"

**Tests:**
- [ ] Integration test: `tugtool resolve .tugtool/tugplan-1.md --json` returns ok with stage=exact
- [ ] Integration test: `tugtool resolve 1 --json` returns ok with stage=slug
- [ ] Integration test: `tugtool resolve nonexistent --json` returns error with E041
- [ ] CLI parse test: verify `Commands::Resolve` accepts optional identifier

**Checkpoint:**
- [ ] `cargo build -p tugtool`
- [ ] `cargo nextest run -p tugtool`
- [ ] `cargo clippy -p tugtool`
- [ ] `tugtool resolve --help` shows usage

**Rollback:**
- Revert commit; delete `resolve.rs`; remove CLI variant and dispatch.

**Commit after all checkpoints pass.**

---

#### Step 2: Replace all existing normalize/resolve functions with resolve_plan() {#step-2}

**Depends on:** #step-1

**Commit:** `refactor: replace 8 normalize/resolve functions with unified resolve_plan()`

**References:** [D01] Resolve in core, [D02] Cascade order, [D03] Legacy numeric, [D06] Structured result, Risk R02, Table T01, (#symbols-delete, #cascade-stages, #t01-functions-to-delete)

**Artifacts:**
- Modified `crates/tugtool/src/commands/status.rs` -- delete `resolve_file_path()`, use `resolve_plan()`
- Modified `crates/tugtool/src/commands/validate.rs` -- delete `resolve_file_path()`, use `resolve_plan()`
- Modified `crates/tugtool/src/commands/beads/sync.rs` -- delete `resolve_file_path()`, use `resolve_plan()`
- Modified `crates/tugtool/src/commands/beads/status.rs` -- delete `resolve_file_path()`, use `resolve_plan()`
- Modified `crates/tugtool/src/commands/beads/pull.rs` -- delete `resolve_file_path()`, use `resolve_plan()`
- Modified `crates/tugtool/src/commands/beads/link.rs` -- delete `resolve_file_path()`, use `resolve_plan()`
- Modified `crates/tugtool/src/commands/merge.rs` -- delete `normalize_plan_path()`, use `resolve_plan()`
- Modified `crates/tugtool/src/commands/worktree.rs` -- delete `normalize_plan_path()`, use `resolve_plan()` with relativization

**Tasks:**
- [ ] In `status.rs`: replace `resolve_file_path(&project_root, &file)` call (line 72) with `resolve_plan(&file, &project_root)?` and match on `ResolveResult` variants
- [ ] In `status.rs`: delete the `resolve_file_path` function (line 266)
- [ ] In `validate.rs`: replace `resolve_file_path(&project_root, &f)` call (line 97) with `resolve_plan(&f, &project_root)?` and match on variants
- [ ] In `validate.rs`: delete the `resolve_file_path` function (line 195)
- [ ] In `beads/sync.rs`: replace `resolve_file_path(&project_root, &file)` call (line 92) with `resolve_plan(&file, &project_root)?` and match on variants
- [ ] In `beads/sync.rs`: delete the `resolve_file_path` function (line 646)
- [ ] In `beads/status.rs`: replace `resolve_file_path(&project_root, f)` call (line 75) with `resolve_plan(f, &project_root)?` and match on variants
- [ ] In `beads/status.rs`: delete the `resolve_file_path` function (line 297)
- [ ] In `beads/pull.rs`: replace `resolve_file_path(&project_root, f)` call (line 72) with `resolve_plan(f, &project_root)?` and match on variants
- [ ] In `beads/pull.rs`: delete the `resolve_file_path` function (line 295)
- [ ] In `beads/link.rs`: replace `resolve_file_path(&project_root, &file)` call (line 81) with `resolve_plan(&file, &project_root)?` and match on variants
- [ ] In `beads/link.rs`: delete the `resolve_file_path` function (line 277)
- [ ] In `merge.rs`: replace `normalize_plan_path(&plan)` call (line 982) with `resolve_plan(&plan, &repo_root)?` and match on variants
- [ ] In `merge.rs`: delete the `normalize_plan_path` function (line 700) and its tests (lines 1876-1892)
- [ ] In `worktree.rs`: replace the `normalize_plan_path(plan, plan_path, &repo_root)` call (line 461) with `resolve_plan(&plan, &repo_root)?`, then strip `repo_root` prefix from the resolved absolute path to produce the relative path required by worktree path construction (see note in Table T01)
- [ ] In `worktree.rs`: update test call sites (lines 1405, 1420, 1435) to use `resolve_plan()` instead
- [ ] In `worktree.rs`: delete the `normalize_plan_path` function (line 422)
- [ ] Verify all callers handle `Err(TugError)`, `NotFound`, and `Ambiguous` with appropriate error messages and JSON output

**Tests:**
- [ ] Existing tests for `tugtool status` still pass (tests in status.rs)
- [ ] Existing tests for `tugtool validate` still pass (tests in validate.rs)
- [ ] Existing tests for `tugtool beads sync/status/pull/link` still pass (tests in beads/*.rs)
- [ ] Existing tests for `tugtool merge` still pass (tests in merge.rs)
- [ ] Existing tests for `tugtool worktree` still pass (tests in worktree.rs)
- [ ] Unit test: `status` command resolves slug input (e.g., `tugtool status 1`)
- [ ] Unit test: `merge` command resolves slug input (e.g., `tugtool merge user-auth`)
- [ ] Unit test: `worktree create` still works with absolute paths (verifying relativization logic)
- [ ] Unit test: `validate` command resolves slug input (e.g., `tugtool validate 1`)

**Checkpoint:**
- [ ] `cargo build`
- [ ] `cargo nextest run`
- [ ] `cargo clippy`
- [ ] `grep -r "resolve_file_path\|normalize_plan_path" crates/tugtool/src/commands/` returns no results (all 8 functions deleted)

**Rollback:**
- Revert commit; all old functions are restored.

**Commit after all checkpoints pass.**

---

#### Step 3: Update author-agent for descriptive slug naming {#step-3}

**Depends on:** #step-0

**Commit:** `feat: author-agent derives descriptive slugs from ideas`

**References:** [D04] LLM slug derivation, Risk R01, (#non-goals, #assumptions, #terminology)

**Artifacts:**
- Modified `agents/author-agent.md` -- updated file naming section with slug derivation instructions
- The author-agent now produces `tugplan-<slug>.md` instead of `tugplan-N.md`

**Tasks:**
- [ ] Update the "File Naming" section of `agents/author-agent.md` to instruct the agent to derive a 2-4 word kebab-case slug from the idea
- [ ] Add slug validation instructions: must match `^[a-z][a-z0-9-]{1,49}$`
- [ ] Add collision handling: if `tugplan-<slug>.md` already exists, append numeric suffix (`-2`, `-3`, etc.)
- [ ] Add fallback: if slug derivation fails validation, fall back to numeric naming
- [ ] Update example workflow to show slug-based naming
- [ ] Verify the author-agent output contract still produces valid `plan_path` values

**Tests:**
- [ ] Manual test: invoke `/tugtool:plan "add user authentication"` and verify the resulting file is named descriptively (e.g., `tugplan-user-auth.md`)
- [ ] Manual test: invoke `/tugtool:plan "add user authentication"` again and verify collision handling produces `tugplan-user-auth-2.md`

**Checkpoint:**
- [ ] The author-agent.md file contains slug derivation instructions
- [ ] The slug validation regex is documented in the agent file
- [ ] The collision handling logic is documented
- [ ] The fallback to numeric naming is documented

**Rollback:**
- Revert the author-agent.md changes; numeric naming is restored.

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A unified plan resolution system and descriptive plan naming, replacing eight ad-hoc normalize/resolve functions and opaque numeric file names.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `resolve_plan()` function exists in tugtool-core and handles all five cascade stages (verify with unit tests)
- [ ] `tugtool resolve` CLI subcommand exists and returns structured JSON (verify with `tugtool resolve 1 --json`)
- [ ] All eight old `normalize_plan_path` / `resolve_file_path` functions are deleted (verify with `grep -r "resolve_file_path\|normalize_plan_path" crates/tugtool/src/commands/`)
- [ ] `tugtool merge`, `tugtool status`, `tugtool validate`, `tugtool worktree create`, and all `tugtool beads` subcommands work with slug inputs (verify with integration tests)
- [ ] The author-agent produces descriptive slugs for new plans (verify with manual `/tugtool:plan` invocation)
- [ ] `cargo nextest run` passes with zero failures
- [ ] `cargo clippy` reports zero warnings

**Acceptance tests:**
- [ ] Unit test: `resolve_plan("user-auth", root)` returns `Ok(Found { stage: Slug, .. })` for existing `tugplan-user-auth.md`
- [ ] Unit test: `resolve_plan("1", root)` returns `Ok(Found { stage: Slug, .. })` for existing `tugplan-1.md`
- [ ] Integration test: `tugtool resolve user-auth --json` returns status=ok
- [ ] Integration test: `tugtool status user-auth` works the same as `tugtool status .tugtool/tugplan-user-auth.md`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add `tugtool rename` command to rename plans (with redirect/alias support)
- [ ] Add tab-completion for plan slugs in the CLI
- [ ] Consider deterministic slug generation as a fallback for non-LLM contexts

| Checkpoint | Verification |
|------------|--------------|
| resolve_plan() function complete | `cargo nextest run -p tugtool-core -- resolve` |
| CLI subcommand complete | `tugtool resolve --help` succeeds |
| All 8 old functions deleted | `grep -r "normalize_plan_path\|resolve_file_path" crates/tugtool/src/commands/` returns no results |
| Author-agent updated | `agents/author-agent.md` contains slug derivation instructions |
| Full regression | `cargo nextest run` green, `cargo clippy` clean |

**Commit after all checkpoints pass.**
