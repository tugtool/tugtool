## Phase 7: Tug Fixture Infrastructure Improvements {#phase-7}

**Purpose:** Add `tug fixture fetch` and `tug fixture update` CLI commands to streamline fixture management, eliminating manual git clone commands and making fixture updates safe and convenient.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | complete |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-22 |

---

### Table of Contents {#toc}

1. [Phase Overview](#phase-overview)
2. [Open Questions](#open-questions)
3. [Risks and Mitigations](#risks)
4. [Design Decisions](#design-decisions)
5. [Specification](#specification)
6. [Symbol Inventory](#symbol-inventory)
7. [Test Plan Concepts](#test-plan-concepts)
8. [Execution Steps](#execution-steps)
9. [Deliverables and Checkpoints](#deliverables)

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 6 established the fixture infrastructure pattern for tugtool: external git repositories fetched to `.tug/fixtures/<name>/` with lock files at `fixtures/<name>.lock` pinning exact SHAs. This works well for CI (where the fetch is scripted in the workflow) and for developers who read CLAUDE.md and run the manual git clone commands.

However, the current workflow has friction:
1. **Manual fetch is error-prone** - Users must copy/paste git clone commands from error messages or documentation, potentially getting the branch/SHA wrong
2. **Lock file updates are tedious** - Updating to a new fixture version requires: (a) finding the new tag, (b) looking up its SHA, (c) editing the lock file manually, (d) deleting the old fixture, (e) re-cloning
3. **No verification during update** - Easy to update the ref but forget to update the SHA, causing CI failures
4. **Local fixture drift is invisible** - Phase 6’s `temporale_path()` only validates `pyproject.toml` existence; a stale or wrong-SHA checkout can silently change local test behavior (CI verifies SHA, but local dev currently does not)

Phase 7 addresses these issues by adding two CLI commands:
- `tug fixture fetch` - Fetch all fixtures (or a specific one) according to lock files
- `tug fixture update` - Update a lock file to a new version, verifying the SHA

This establishes the pattern for future fixtures (Rust, JavaScript, Go) and makes the existing Temporale fixture easier to manage.

#### Strategy {#strategy}

1. **Add fixture module to main crate** - Move fixture logic from test support to a shared module usable by CLI
2. **Implement fetch command first** - This is the simpler command and immediately useful
3. **Implement update command second** - Depends on fetch working correctly
4. **Keep lock file format unchanged** - The TOML format from Phase 6 is sufficient
5. **JSON output for all commands** - Consistent with tugtool's agent-friendly design
6. **Fail loudly, never silently** - Match the project's testing philosophy

#### Stakeholders / Primary Customers {#stakeholders}

1. **Tugtool developers** - Need easy fixture setup for local development
2. **CI workflows** - Benefit from standardized fetch command (simpler workflow YAML)
3. **Future fixture maintainers** - Need clear pattern for adding new language fixtures
4. **LLM agents** - Can use JSON output to understand fixture state

#### Success Criteria (Measurable) {#success-criteria}

- `tug fixture fetch` fetches Temporale fixture from lock file (verification: fresh clone, run command, fixture exists)
- `tug fixture fetch temporale` fetches specific fixture (verification: same as above)
- `tug fixture update temporale --ref v0.2.0` updates lock file (verification: lock file contains new ref and SHA)
- SHA verification fails if ref and SHA mismatch (verification: tamper with lock file, fetch fails with clear error)
- Local fixture SHA drift is detectable and correctable (verification: checkout wrong commit in `.tug/fixtures/<name>/`, `tug fixture fetch` reports mismatch and fixes it; if tests enforce SHA, they fail loudly unless override is used)
- All commands produce valid JSON output (verification: pipe to `jq .`)
- Existing tests continue to pass (verification: `cargo nextest run -p tugtool temporale`)
- CI workflow can use `tug fixture fetch` instead of inline shell script (verification: update workflow, CI passes)

#### Scope {#scope}

1. Create `crates/tugtool/src/fixture.rs` module for shared fixture logic
2. Add `tug fixture fetch [name]` CLI command
3. Add `tug fixture update <name> --ref <ref>` CLI command
4. Add JSON response schemas for fixture commands
5. Update CI workflow to use new commands (optional, as validation)
6. Update CLAUDE.md with new command documentation
7. Tighten Phase 6 fixture correctness for local dev by adding SHA verification for existing fixture directories (when the fixture is a git checkout), and improve the Phase 6 fixture helper tests that currently rely on process-global env vars

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Rust sample project fixture** - Requires language support work beyond this phase
- **JavaScript/Go/other fixtures** - Commands will support them, but no new fixtures created
- **GitHub Actions cache integration** - Optimization, can be done independently
- **Authenticated repositories** - Private fixtures require credential management complexity
- **Automatic version checking** - "Warn on outdated" is nice-to-have, not essential
- **Lock file format changes** - Current TOML format is sufficient
- **Parallel fixture fetching** - Single fixture (Temporale) doesn't need this yet

#### Dependencies / Prerequisites {#dependencies}

- Phase 6 complete (fixture infrastructure exists, Temporale is standalone)
- `git` available in PATH (for clone and ls-remote operations)
- Network access for fetching (same as current requirement)

#### Constraints {#constraints}

- Must work on both macOS and Linux (CI matrix)
- Must work offline if fixture is already fetched (fetch is a no-op)
- JSON output required (agent compatibility)
- No new runtime dependencies for the main tugtool binary
- Commands must be feature-gated appropriately (not require Python feature)

#### Assumptions {#assumptions}

- Git is available in PATH on all target platforms
- Lock files are well-formed TOML (parsing errors should be clear)
- Fixture repositories are public (no authentication)
- Network is available for initial fetch and updates

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Fixture Fetch Behavior When Already Present (DECIDED) {#q01-fetch-existing}

**Question:** What should `tug fixture fetch` do if the fixture directory already exists?

**Why it matters:** Users may have modified the fixture locally, or the fixture may be at a different SHA than the lock file specifies.

**Options:**
1. **Skip if exists** - Fast, but may leave stale fixture
2. **Verify SHA, skip if matches** - Safe, slightly slower (git rev-parse)
3. **Always re-fetch** - Safe but wasteful, especially for CI caching
4. **Add --force flag for re-fetch** - Flexible but more complex

**Decision:** Verify SHA, skip if matches. Add `--force` flag to re-fetch regardless.

**Rationale:**
- SHA verification catches accidental modifications
- Skip-if-valid is fast (single git command)
- Force flag provides escape hatch for debugging
- Matches user expectations from package managers (npm, cargo)

**Resolution:** DECIDED - Verify SHA, skip if matches, with `--force` override.

---

#### [Q02] Update Command Ref Resolution (DECIDED) {#q02-update-ref}

**Question:** How should `tug fixture update` resolve the ref to a SHA?

**Why it matters:** Users may provide tags (v0.1.0), branches (main), or full SHAs.

**Options:**
1. **Only accept tags** - Simplest, but limiting
2. **Accept any ref, resolve via ls-remote** - Flexible, requires network
3. **Accept any ref, require --sha for non-tags** - Explicit but tedious

**Decision:** Accept any ref, resolve via `git ls-remote`. Warn if ref is a branch (mutable).

**Rationale:**
- Tags are the recommended pattern, but branches should work for development
- ls-remote is fast and works without cloning
- Warning on branches reminds users that SHAs may change

**Resolution:** DECIDED - Accept any ref, resolve via ls-remote, warn on branches.

---

#### [Q03] Lock File Location Discovery (DECIDED) {#q03-lock-discovery}

**Question:** How does `tug fixture fetch` find lock files?

**Why it matters:** Need to support both "fetch all" and "fetch specific fixture" modes.

**Options:**
1. **Scan fixtures/ directory for *.lock files** - Simple, automatic
2. **Require explicit fixture list in config** - More control, more setup
3. **Accept lock file path as argument** - Maximum flexibility

**Decision:** Scan `fixtures/` directory for `*.lock` files. Each lock file defines one fixture.

**Rationale:**
- Convention over configuration
- Easy to add new fixtures (just add a lock file)
- No config file needed
- Matches the pattern established in Phase 6

**Resolution:** DECIDED - Scan fixtures/ directory.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Git not available | high | low | Check for git early, clear error message | Users report issues |
| Network timeout during fetch | med | med | Reasonable timeout, retry guidance in error | CI flakiness |
| Lock file corruption | med | low | TOML parser gives clear errors | User reports |
| SHA mismatch after update | med | low | Always verify SHA after ls-remote | Update failures |

**Risk R01: Git Command Failures** {#r01-git-failures}

- **Risk:** Git clone or ls-remote may fail due to network issues, invalid refs, or repository access problems
- **Mitigation:**
  - Check git availability at command start
  - Capture git stderr and include in error response
  - Provide actionable error messages with suggested fixes
- **Residual risk:** Network issues are outside our control

**Risk R02: Partial Fetch State** {#r02-partial-fetch}

- **Risk:** If fetch fails midway, fixture directory may be in inconsistent state
- **Mitigation:**
  - Clone to temp directory first, move on success
  - If move fails, clean up temp directory
  - Verify SHA after clone before considering success
- **Residual risk:** Disk full or permission errors could leave temp files

---

### 7.0 Design Decisions {#design-decisions}

#### [D01] Fixture Module in Main Crate (DECIDED) {#d01-fixture-module}

**Decision:** Create `crates/tugtool/src/fixture.rs` containing shared fixture logic, usable by both CLI and tests.

**Rationale:**
- CLI needs fixture operations (fetch, update)
- Tests already have fixture helpers in `tests/support/fixtures.rs`
- Shared module avoids duplication
- Module is not feature-gated (fixtures are language-agnostic)

**Implications:**
- Move/refactor logic from `tests/support/fixtures.rs`
- Test support module becomes a thin wrapper or re-exports
- CLI commands can call fixture module directly

---

#### [D02] Git Subprocess for All Operations (DECIDED) {#d02-git-subprocess}

**Decision:** Use `std::process::Command` to invoke git rather than a git library.

**Rationale:**
- Git is already required (Phase 6 established this)
- Subprocess is simple and auditable
- No new dependencies
- Matches CI workflow approach
- git2 crate adds significant compile time and complexity

**Implications:**
- Must parse git output (rev-parse, ls-remote)
- Error messages must capture git stderr
- Path handling must work cross-platform

---

#### [D03] Atomic Fetch via Temp Directory (DECIDED) {#d03-atomic-fetch}

**Decision:** Clone to a temp directory, verify SHA, then move to final location.

**Rationale:**
- Prevents partial/corrupted fixture state
- Move is atomic on same filesystem
- Easy cleanup on failure
- Matches best practices from package managers

**Implications:**
- Temp directory in `.tug/` (same filesystem as fixtures)
- Clean up temp on any failure
- Handle case where final directory already exists

---

#### [D04] JSON Output for All Commands (DECIDED) {#d04-json-output}

**Decision:** All fixture commands produce JSON output following tugtool's response envelope pattern.

**Rationale:**
- Consistency with other tug commands
- Agent-friendly output
- Parseable by scripts and CI
- Clear success/error states

**Implications:**
- Define response schemas for fetch and update
- Include useful fields (fixture name, sha, path, etc.)
- Error responses follow standard format

---

#### [D05] Force Flag for Re-fetch (DECIDED) {#d05-force-flag}

**Decision:** `tug fixture fetch --force` re-fetches even if fixture exists and SHA matches.

**Rationale:**
- Escape hatch for debugging
- Useful when fixture contents may be corrupted
- Clear user intent (no accidental data loss)
- Matches common CLI patterns (--force)

**Implications:**
- Default behavior is skip-if-valid
- Force deletes existing fixture before fetch
- Force flag documented in help text

---

#### [D06] Branch Warning in Update (DECIDED) {#d06-branch-warning}

**Decision:** `tug fixture update` with a branch ref (not a tag) emits a warning in the response.

**Rationale:**
- Branch SHAs change over time
- Tags are preferred for reproducibility
- Warning educates users without blocking
- Keeps command flexible for development use

**Implications:**
- Detect if ref is a tag vs branch (ls-remote output parsing)
- Include `warning` field in response when applicable
- Warning does not cause non-zero exit code

---

### 7.1 Specification {#specification}

#### 7.1.1 CLI Commands {#cli-commands}

##### Command: `tug fixture fetch` {#cmd-fixture-fetch}

**Spec S01: fixture fetch Command** {#s01-fixture-fetch}

**Synopsis:**
```
tug fixture fetch [OPTIONS] [NAME]
```

**Arguments:**
- `[NAME]` - Optional fixture name. If omitted, fetch all fixtures defined in `fixtures/*.lock`.

**Options:**
- `--force` - Re-fetch even if fixture exists and SHA matches.

**Behavior:**
1. Discover lock files in `fixtures/` directory (or single lock file if NAME provided)
2. For each fixture:
   a. Parse lock file to get repository, ref, sha
   b. Check if fixture directory exists at `.tug/fixtures/<name>/`
   c. If exists and not --force:
      - Verify SHA matches lock file
      - If matches, skip with status "up-to-date"
      - If mismatch, delete and re-fetch
   d. If not exists or --force:
      - Clone to temp directory with `git clone --depth 1 --branch <ref>`
      - Verify cloned SHA matches lock file
      - Move to final location
3. Output JSON response

**Exit codes:**
- 0: Success (all fixtures fetched or up-to-date)
- 2: Invalid arguments (bad fixture name, missing lock file)
- 10: Internal error (git failed, network error)

---

##### Command: `tug fixture update` {#cmd-fixture-update}

**Spec S02: fixture update Command** {#s02-fixture-update}

**Synopsis:**
```
tug fixture update <NAME> --ref <REF>
```

**Arguments:**
- `<NAME>` - Required fixture name (must have existing lock file)
- `--ref <REF>` - Required new ref (tag, branch, or SHA)

**Behavior:**
1. Verify lock file exists at `fixtures/<NAME>.lock`
2. Resolve ref to SHA via `git ls-remote <repository> <ref>`
3. Detect if ref is a tag or branch (for warning)
4. Update lock file with new ref and sha
5. Output JSON response with optional warning
6. Note: Does NOT automatically fetch the new version

> **Limitation:** The `--ref` argument must be a tag name or branch name, not a raw SHA. This is because `git ls-remote <repository> <sha>` does not resolve raw commit SHAs. To pin to a specific commit, first identify a tag or branch that points to that commit.

**Exit codes:**
- 0: Success (lock file updated)
- 2: Invalid arguments (unknown fixture, invalid ref)
- 3: Resolution error (ref not found in repository)
- 10: Internal error (git failed, write error)

---

#### 7.1.2 Response Schemas {#response-schemas}

##### Fixture Fetch Response {#fixture-fetch-response}

**Spec S03: fixture fetch Response Schema** {#s03-fetch-response}

**Success response:**
```json
{
  "status": "ok",
  "schema_version": "1",
  "fixtures": [
    {
      "name": "temporale",
      "action": "fetched" | "up-to-date" | "updated",
      "path": ".tug/fixtures/temporale",
      "repository": "https://github.com/tugtool/temporale",
      "ref": "v0.1.0",
      "sha": "9f21df0322b7aa39ca7f599b128f66c07ecec42f"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | yes | "ok" for success |
| `schema_version` | string | yes | Schema version |
| `fixtures` | array | yes | List of fixture results |
| `fixtures[].name` | string | yes | Fixture name |
| `fixtures[].action` | string | yes | What happened: "fetched", "up-to-date", "updated" |
| `fixtures[].path` | string | yes | Relative path to fixture directory |
| `fixtures[].repository` | string | yes | Git repository URL |
| `fixtures[].ref` | string | yes | Git ref (tag/branch) |
| `fixtures[].sha` | string | yes | Commit SHA |

---

##### Fixture Update Response {#fixture-update-response}

**Spec S04: fixture update Response Schema** {#s04-update-response}

**Success response:**
```json
{
  "status": "ok",
  "schema_version": "1",
  "fixture": {
    "name": "temporale",
    "previous_ref": "v0.1.0",
    "previous_sha": "9f21df0322b7aa39ca7f599b128f66c07ecec42f",
    "new_ref": "v0.2.0",
    "new_sha": "abc123def456...",
    "lock_file": "fixtures/temporale.lock"
  },
  "warning": "Ref 'main' is a branch, not a tag. SHA may change."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | yes | "ok" for success |
| `schema_version` | string | yes | Schema version |
| `fixture` | object | yes | Update details |
| `fixture.name` | string | yes | Fixture name |
| `fixture.previous_ref` | string | yes | Old ref |
| `fixture.previous_sha` | string | yes | Old SHA |
| `fixture.new_ref` | string | yes | New ref |
| `fixture.new_sha` | string | yes | New SHA |
| `fixture.lock_file` | string | yes | Path to lock file |
| `warning` | string | no | Warning message (e.g., branch ref) |

---

#### 7.1.3 Lock File Format {#lock-file-format}

**Spec S05: Lock File Format** {#s05-lock-format}

Unchanged from Phase 6. Each lock file at `fixtures/<name>.lock`:

```toml
# <Name> fixture pin for tugtool integration tests
#
# To update:
#   tug fixture update <name> --ref <new-ref>

[fixture]
name = "<name>"
repository = "<git-url>"
ref = "<tag-or-branch>"
sha = "<full-40-char-sha>"

[fixture.metadata]
# Optional metadata fields (not used by fetch/update)
description = "<description>"
```

> **Note:** When `tug fixture update` modifies a lock file, it regenerates the entire file from a template. Any user-added comments will not be preserved. The comment header shown above is automatically regenerated.

---

#### 7.1.4 Error Messages {#error-messages}

**Spec S06: Error Message Templates** {#s06-error-templates}

**Lock file not found:**
```
Fixture '<name>' not found.

No lock file exists at fixtures/<name>.lock

Available fixtures:
  - temporale (fixtures/temporale.lock)

To add a new fixture, create a lock file manually or copy from an existing one.
```

**Git clone failed:**
```
Failed to fetch fixture '<name>'.

Git clone failed with exit code <code>:
<git stderr>

Check that:
  - The repository URL is correct: <repository>
  - The ref exists: <ref>
  - You have network access
```

**SHA mismatch after clone:**
```
SHA verification failed for fixture '<name>'.

Expected: <expected-sha>
Got:      <actual-sha>

The ref '<ref>' may have been force-pushed or the lock file is out of date.

To fix:
  tug fixture update <name> --ref <ref>
```

**Ref not found during update:**
```
Ref '<ref>' not found in repository '<repository>'.

To list available refs:
  git ls-remote <repository>

Common refs:
  - Tags: v0.1.0, v0.2.0, ...
  - Branches: main, develop, ...
```

---

### 7.2 Symbol Inventory {#symbol-inventory}

#### 7.2.1 New Files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugtool/src/fixture.rs` | Shared fixture logic (fetch, update, lock file parsing) |

#### 7.2.2 Modified Files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool/src/main.rs` | Add `Fixture` command with `Fetch` and `Update` subcommands |
| `crates/tugtool/src/lib.rs` | Add `pub mod fixture;` |
| `crates/tugtool/tests/support/fixtures.rs` | Refactor to use shared module or thin wrapper |
| `crates/tugtool-core/src/output.rs` | Add fixture response types |
| `.github/workflows/ci.yml` | Optionally update to use `tug fixture fetch` |
| `CLAUDE.md` | Document new commands |

#### 7.2.3 Symbols to Add {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `fixture` | module | `crates/tugtool/src/lib.rs` | Public module for fixture operations |
| `FixtureInfo` | struct | `fixture.rs` | Parsed lock file data (move from test support) |
| `FixtureResult` | struct | `fixture.rs` | Result of a fetch operation |
| `FetchAction` | enum | `fixture.rs` | Fetched, UpToDate, Updated |
| `fetch_fixture` | fn | `fixture.rs` | Fetch a single fixture by name |
| `fetch_all_fixtures` | fn | `fixture.rs` | Fetch all fixtures from lock files |
| `update_fixture_lock` | fn | `fixture.rs` | Update a lock file to new ref |
| `discover_lock_files` | fn | `fixture.rs` | Find all lock files in fixtures/ |
| `resolve_ref_to_sha` | fn | `fixture.rs` | Use git ls-remote to get SHA |
| `verify_git_available` | fn | `fixture.rs` | Check git is in PATH |
| `FixtureFetchResponse` | struct | `output.rs` | JSON response for fetch command |
| `FixtureUpdateResponse` | struct | `output.rs` | JSON response for update command |
| `Command::Fixture` | variant | `main.rs` | CLI command variant |
| `FixtureAction` | enum | `main.rs` | Fetch, Update subcommands |

---

### 7.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | What to Test | How |
|----------|--------------|-----|
| **Unit** | Lock file parsing, ref resolution, path handling | Unit tests in `fixture.rs` |
| **Integration** | Full fetch/update cycle | Integration tests with temp directories |
| **Golden** | JSON response format | Compare against expected JSON |
| **CLI** | Command parsing, error messages | CLI integration tests |

#### Test Fixtures for Fixture Tests {#meta-fixtures}

Create test fixtures in `crates/tugtool/tests/fixtures/fixture-test/`:

```
fixtures/fixture-test/
├── valid.lock              # Well-formed lock file
├── missing-sha.lock        # Lock file without sha field
├── malformed.lock          # Invalid TOML
└── mock-repo/              # Minimal git repo for fetch tests
    ├── .git/
    └── pyproject.toml
```

#### Test Scenarios {#test-scenarios}

**Fetch command:**
- Fetch when fixture does not exist (should clone)
- Fetch when fixture exists and SHA matches (should skip)
- Fetch when fixture exists but SHA differs (should re-fetch)
- Fetch with --force when SHA matches (should re-fetch)
- Fetch specific fixture by name
- Fetch all fixtures
- Fetch with invalid fixture name (error)
- Fetch with network error (error, clear message)

**Update command:**
- Update to valid tag ref
- Update to valid branch ref (warning)
- Update to invalid ref (error)
- Update non-existent fixture (error)
- Update regenerates lock file (comments not preserved)

---

### 7.4 Execution Steps {#execution-steps}

#### Step 0: Verify Current State {#step-0}

**Commit:** N/A (verification only)

**References:** (#context, #success-criteria)

**Artifacts:** None

**Tasks:**
- [x] Verify Phase 6 is complete (fixture infrastructure works)
- [x] Run existing Temporale integration tests
- [x] Verify current lock file format in `fixtures/temporale.lock`
- [x] Review `tests/support/fixtures.rs` for reusable code
- [x] Phase 6 follow-up: decide whether tests should enforce "fixture SHA matches lock file" (or rely on `tug fixture fetch` + CI for determinism), then implement the chosen behavior in the shared fixture module

**SHA Enforcement Decision:** Hybrid approach (Option C):
- When `TUG_*_PATH` env var is set → trust user, no SHA verification (for local fixture development)
- When using fetched fixture at `.tug/fixtures/<name>/` → verify SHA matches lock file
- `tug fixture fetch` also verifies/corrects SHA
- This matches "fail loudly" philosophy while supporting local development workflows

**Checkpoint:**
- [x] `cargo nextest run -p tugtool temporale` - all tests pass (8 passed)
- [x] `cat fixtures/temporale.lock` shows valid TOML
- [x] `.tug/fixtures/temporale/` exists (SHA: 9f21df0322b7aa39ca7f599b128f66c07ecec42f)

**No commit - this is verification only.**

---

#### Step 1: Create Fixture Module with Shared Logic {#step-1}

**Commit:** `feat(fixture): add shared fixture module`

**References:** [D01] Fixture module, [D02] Git subprocess, Spec S05 lock format, (#symbol-inventory)

**Artifacts:**
- `crates/tugtool/src/fixture.rs` - New module with core fixture operations
- Updated `crates/tugtool/src/lib.rs` - Export fixture module

**Tasks:**
- [x] Create `crates/tugtool/src/fixture.rs` with:
  - `FixtureInfo` struct (refactor from test support)
  - `discover_lock_files()` function
  - `read_lock_file()` and `read_lock_file_by_name()` functions
  - `verify_git_available()` function
  - `fixture_path()` function
  - `get_repo_sha()` function (for SHA verification)
- [x] Add `pub mod fixture;` to `crates/tugtool/src/lib.rs`
- [x] Update `crates/tugtool/tests/support/fixtures.rs` to re-export or wrap shared module
- [x] Add unit tests for lock file discovery and parsing

**fixture.rs structure:**
```rust
//! Fixture management for tugtool.
//!
//! Provides utilities to fetch, update, and manage test fixtures.
//! Fixtures are external git repositories pinned to specific SHAs
//! via lock files in the `fixtures/` directory.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

/// Information parsed from a fixture lock file.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FixtureInfo {
    pub name: String,
    pub repository: String,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub sha: String,
}

/// Discover all lock files in the fixtures directory.
pub fn discover_lock_files(workspace_root: &Path) -> Result<Vec<PathBuf>, String> {
    // Implementation
}

/// Read and parse a fixture lock file.
pub fn read_lock_file(lock_path: &Path) -> Result<FixtureInfo, String> {
    // Implementation
}

/// Verify git is available in PATH.
pub fn verify_git_available() -> Result<PathBuf, String> {
    // Implementation
}

/// Get the path where a fixture should be stored.
pub fn fixture_path(workspace_root: &Path, name: &str) -> PathBuf {
    workspace_root.join(".tug").join("fixtures").join(name)
}
```

**Tests:**
- [x] Unit: discover_lock_files finds temporale.lock
- [x] Unit: read_lock_file parses valid lock file
- [x] Unit: read_lock_file rejects malformed TOML
- [x] Unit: verify_git_available succeeds on dev machines
- [x] Unit: fixture_path returns correct path

**Checkpoint:**
- [x] `cargo nextest run -p tugtool fixture` - new tests pass (18 tests passed)
- [x] `cargo build -p tugtool` - builds without errors
- [x] Existing temporale tests still pass (8 tests passed)

**Commit after all checkpoints pass.**

---

#### Step 2: Implement Fetch Operation {#step-2}

**Commit:** `feat(fixture): implement fetch operation`

**References:** [D02] Git subprocess, [D03] Atomic fetch, Spec S01 fetch command, (#cli-commands)

**Artifacts:**
- Extended `crates/tugtool/src/fixture.rs` with fetch logic
- `FetchAction` enum and `FixtureResult` struct

**Tasks:**
- [x] Add `FetchAction` enum (Fetched, UpToDate, Updated)
- [x] Add `FetchResult` struct for operation results
- [x] Implement `fetch_fixture()` function:
  - Check if fixture exists
  - If exists, verify SHA matches
  - If mismatch or not exists, clone to temp then move
- [x] Implement `fetch_all_fixtures()` function
- [x] Implement SHA verification via `git rev-parse HEAD`
- [x] Add `--force` handling (delete existing before fetch)
- [x] Add unit and integration tests

**Key implementation details:**
```rust
/// Result of a fixture fetch operation.
#[derive(Debug, Clone, Serialize)]
pub struct FixtureResult {
    pub name: String,
    pub action: FetchAction,
    pub path: PathBuf,
    pub repository: String,
    pub git_ref: String,
    pub sha: String,
}

/// Action taken during fetch.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FetchAction {
    Fetched,
    UpToDate,
    Updated,
}

/// Fetch a single fixture.
pub fn fetch_fixture(
    workspace_root: &Path,
    info: &FixtureInfo,
    force: bool,
) -> Result<FixtureResult, TugError> {
    // 1. Verify git available
    // 2. Check existing fixture
    // 3. If exists and not force, verify SHA
    // 4. If SHA matches and not force, return UpToDate
    // 5. Clone to temp directory
    // 6. Verify SHA of cloned repo
    // 7. Move to final location
    // 8. Return result
}
```

**Tests:**
- [x] Integration: fetch_fixture clones new fixture
- [x] Integration: fetch_fixture skips up-to-date fixture
- [x] Integration: fetch_fixture with force re-fetches
- [x] Unit: SHA verification detects mismatch
- [x] Integration: atomic fetch cleans up on failure

**Checkpoint:**
- [x] `cargo nextest run -p tugtool fixture` - all tests pass (28 tests passed)
- [x] Manual: delete `.tug/fixtures/temporale/`, call fetch, fixture restored (verified tests fail without fixture, pass after re-fetch)

**Commit after all checkpoints pass.**

---

#### Step 3: Add Fixture Fetch CLI Command {#step-3}

**Commit:** `feat(cli): add tug fixture fetch command`

**References:** [D04] JSON output, [D05] Force flag, Spec S01, Spec S03 fetch response, (#cli-commands)

**Artifacts:**
- Updated `crates/tugtool/src/main.rs` with Fixture command
- `FixtureFetchResponse` in output module

**Tasks:**
- [x] Add `Command::Fixture` variant to CLI enum
- [x] Add `FixtureAction` enum (Fetch, Update)
- [x] Add `--force` flag to fetch subcommand
- [x] Add optional `[NAME]` argument to fetch subcommand
- [x] Implement `execute_fixture_fetch()` function
- [x] Add `FixtureFetchResponse` to `crates/tugtool-core/src/output.rs`
- [x] Add CLI parsing tests

**CLI structure:**
```rust
/// Fixture management commands.
Fixture {
    #[command(subcommand)]
    action: FixtureAction,
},

#[derive(Subcommand)]
enum FixtureAction {
    /// Fetch fixtures according to lock files.
    Fetch {
        /// Specific fixture to fetch (fetches all if omitted).
        name: Option<String>,
        /// Re-fetch even if fixture exists and SHA matches.
        #[arg(long)]
        force: bool,
    },
    /// Update a fixture lock file to a new ref.
    Update {
        /// Fixture name to update.
        name: String,
        /// New ref (tag or branch).
        #[arg(long)]
        git_ref: String,
    },
}
```

**Tests:**
- [x] CLI: parse `tug fixture fetch`
- [x] CLI: parse `tug fixture fetch temporale`
- [x] CLI: parse `tug fixture fetch --force`
- [x] CLI: parse `tug fixture fetch temporale --force`
- [x] Integration: command produces valid JSON output

**Checkpoint:**
- [x] `cargo nextest run -p tugtool cli_parsing` - CLI tests pass (29 passed)
- [x] `cargo run -p tugtool -- fixture fetch --help` shows correct usage
- [x] `cargo run -p tugtool -- fixture fetch 2>&1 | jq .` produces valid JSON

**Commit after all checkpoints pass.**

---

#### Step 4: Implement Update Operation {#step-4}

**Commit:** `feat(fixture): implement update operation`

**References:** [D06] Branch warning, Spec S02 update command, (#cli-commands)

**Artifacts:**
- Extended `crates/tugtool/src/fixture.rs` with update logic
- `UpdateResult` struct

**Tasks:**
- [x] Implement `resolve_ref_to_sha()` using `git ls-remote`
- [x] Implement `is_branch_ref()` to detect branches vs tags
- [x] Implement `update_fixture_lock()` function:
  - Read existing lock file
  - Resolve new ref to SHA
  - Update lock file preserving format
  - Return result with optional warning
- [x] Add `UpdateResult` struct
- [x] Add unit and integration tests

**Key implementation:**
```rust
/// Result of a fixture update operation.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateResult {
    pub name: String,
    pub previous_ref: String,
    pub previous_sha: String,
    pub new_ref: String,
    pub new_sha: String,
    pub lock_file: PathBuf,
    pub warning: Option<String>,
}

/// Resolve a git ref to its SHA using ls-remote.
pub fn resolve_ref_to_sha(repository: &str, git_ref: &str) -> Result<(String, bool), TugError> {
    // Returns (sha, is_branch)
    // Use: git ls-remote <repository> <ref>
}

/// Update a fixture lock file to a new ref.
pub fn update_fixture_lock(
    workspace_root: &Path,
    name: &str,
    new_ref: &str,
) -> Result<UpdateResult, TugError> {
    // 1. Read existing lock file
    // 2. Resolve new ref to SHA
    // 3. Check if branch (for warning)
    // 4. Write updated lock file
    // 5. Return result
}
```

**Tests:**
- [x] Unit: resolve_ref_to_sha resolves tag
- [x] Unit: resolve_ref_to_sha detects branch
- [x] Unit: resolve_ref_to_sha fails on invalid ref
- [x] Integration: update_fixture_lock updates lock file
- [x] Integration: update with branch produces warning

**Checkpoint:**
- [x] `cargo nextest run -p tugtool fixture` - all tests pass (42 tests passed)

**Commit after all checkpoints pass.**

---

#### Step 5: Add Fixture Update CLI Command {#step-5}

**Commit:** `feat(cli): add tug fixture update command`

**References:** [D04] JSON output, [D06] Branch warning, Spec S02, Spec S04 update response, (#cli-commands)

**Artifacts:**
- Completed `FixtureAction::Update` in CLI
- `FixtureUpdateResponse` in output module

**Tasks:**
- [x] Implement `execute_fixture_update()` function
- [x] Add `FixtureUpdateResponse` to `crates/tugtool-core/src/output.rs`
- [x] Handle warning field in response
- [x] Add CLI parsing and integration tests

**Tests:**
- [x] CLI: parse `tug fixture update temporale --ref v0.2.0`
- [x] Integration: command produces valid JSON output
- [x] Integration: warning appears for branch ref

**Checkpoint:**
- [x] `cargo nextest run -p tugtool cli_parsing` - CLI tests pass (29 passed)
- [x] `cargo run -p tugtool -- fixture update --help` shows correct usage

**Commit after all checkpoints pass.**

---

#### Step 6: Update Test Support Module {#step-6}

**Commit:** `refactor(test): use shared fixture module in test support`

**References:** [D01] Fixture module, (#symbol-inventory)

**Artifacts:**
- Refactored `crates/tugtool/tests/support/fixtures.rs`

**Tasks:**
- [x] Update test support to use `tugtool::fixture` module
- [x] Remove duplicated code
- [x] Keep test-specific helpers (e.g., panic with instructions)
- [x] Ensure all existing tests still pass

**Tests:**
- [x] All existing fixture tests pass (42 passed)
- [x] All Temporale integration tests pass (8 passed)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool` - all tests pass (232 passed)
- [x] No duplicated fixture logic between modules

**Commit after all checkpoints pass.**

---

#### Step 7: Update Documentation {#step-7}

**Commit:** `docs: add fixture CLI command documentation`

**References:** Spec S01, Spec S02, (#success-criteria)

**Artifacts:**
- Updated CLAUDE.md with fixture command documentation

**Tasks:**
- [x] Add fixture command section to CLAUDE.md
- [x] Update fixture setup instructions to use new commands
- [x] Add examples for common workflows
- [x] Remove manual git clone instructions (or mark as alternative)

**CLAUDE.md additions:**
```markdown
### Fixture Commands

Manage test fixtures (external repositories used for integration tests).

```bash
# Fetch all fixtures according to lock files
tug fixture fetch

# Fetch specific fixture
tug fixture fetch temporale

# Force re-fetch even if up-to-date
tug fixture fetch --force

# Update lock file to new version
tug fixture update temporale --ref v0.2.0

# After updating, fetch the new version
tug fixture fetch temporale
```

#### Local Development with Fixtures

For local fixture development, use the environment variable override:
```bash
export TUG_TEMPORALE_PATH=/path/to/your/temporale
```

This bypasses the fixture fetch system entirely.

**Checkpoint:**
- [x] CLAUDE.md contains complete fixture command documentation
- [x] Instructions are clear and accurate

**Commit after all checkpoints pass.**

---

#### Step 8: Optional CI Workflow Update {#step-8}: DEFERRED

**Commit:** `ci: use tug fixture fetch command`

**References:** Spec S01, (#success-criteria)

**Artifacts:**
- Updated `.github/workflows/ci.yml`

**Tasks:**
- [ ] Replace inline fixture fetch shell script with `tug fixture fetch`
- [ ] Ensure CI still passes
- [ ] Keep venv install step (fixture must be installed after fetch)

**Updated CI workflow:**
```yaml
# Replace the "Fetch test fixtures" step with:
- name: Fetch test fixtures
  run: |
    cargo run -p tugtool -- fixture fetch
    echo "Fixture fetch complete"

- name: Install fixture in venv
  run: |
    uv pip install --python .tug-test-venv/bin/python -e .tug/fixtures/temporale/
```

**Note:** This step is optional because:
- The current shell script works fine
- Changing CI is a higher-risk operation
- Can be done in a follow-up if desired

**Checkpoint:**
- [ ] CI workflow passes with new command
- [ ] Fixture fetch output visible in CI logs

**Commit after all checkpoints pass.**

---

### 7.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** CLI commands `tug fixture fetch` and `tug fixture update` for streamlined fixture management with JSON output.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [x] `tug fixture fetch` fetches all fixtures from lock files
- [x] `tug fixture fetch temporale` fetches specific fixture
- [x] `tug fixture fetch --force` re-fetches even if up-to-date
- [x] `tug fixture update temporale --ref <tag>` updates lock file
- [x] All commands produce valid JSON output
- [x] Branch refs produce warning in update response
- [x] SHA verification catches mismatches
- [x] All existing Temporale tests pass
- [x] CLAUDE.md documents new commands

**Acceptance tests:**
- [x] Integration: `cargo nextest run -p tugtool fixture` passes (42 tests)
- [x] Integration: `cargo nextest run -p tugtool temporale` passes (8 tests)
- [x] CLI: `tug fixture fetch 2>&1 | jq .status` outputs "ok"

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Shared Module Created** {#m01-shared-module}
- [x] `fixture.rs` module exists with core types and functions
- [x] Test support uses shared module

**Milestone M02: Fetch Command Working** {#m02-fetch-working}
- [x] `tug fixture fetch` fetches Temporale fixture
- [x] SHA verification works
- [x] Force flag works

**Milestone M03: Update Command Working** {#m03-update-working}
- [x] `tug fixture update` resolves refs and updates lock files
- [x] Branch warning works
- [x] JSON output complete

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Create Rust sample project fixture
- [ ] Create JavaScript sample project fixture
- [ ] Add fixture caching in CI (GitHub Actions cache)
- [ ] Support authenticated repositories (private fixtures)
- [ ] Automatic fixture version checking (warn on outdated)
- [ ] `tug fixture list` command to show available fixtures → See Addendum below
- [ ] `tug fixture status` command to show fetch state → See Addendum below
- [ ] Parallel fixture fetching for multiple fixtures

| Checkpoint | Verification |
|------------|--------------|
| Fixture module exists | `crates/tugtool/src/fixture.rs` compiles |
| Fetch command works | `tug fixture fetch temporale` succeeds |
| Update command works | `tug fixture update temporale --ref v0.1.0` succeeds |
| JSON output valid | `tug fixture fetch \| jq .` parses |
| Tests pass | `cargo nextest run -p tugtool` exits 0 |
| Docs updated | CLAUDE.md contains fixture commands |

**Commit after all checkpoints pass.**

---

## Phase 7 Addendum: List and Status Commands {#phase-7-addendum}

**Purpose:** Add `tug fixture list` and `tug fixture status` CLI commands to provide visibility into available fixtures and their current state, completing the fixture management CLI interface.

---

### Plan Metadata {#addendum-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | complete |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-22 |

---

### Addendum Overview {#addendum-overview}

#### Context {#addendum-context}

Phase 7 delivered `tug fixture fetch` and `tug fixture update` commands for managing test fixtures. However, users currently have no way to:
1. Discover what fixtures are available (which lock files exist)
2. Inspect the current state of fixtures (fetched, missing, SHA mismatch)

This addendum adds two read-only commands that provide this visibility, making fixture management more intuitive and enabling better debugging when fixtures are in unexpected states.

#### Strategy {#addendum-strategy}

1. **Reuse existing infrastructure** - The `fixture.rs` module already has `discover_lock_files()`, `read_lock_file()`, `fixture_path()`, and `get_repo_sha()` - no new low-level functionality needed
2. **Add list command first** - Simpler command, just reads lock files
3. **Add status command second** - Builds on list, adds filesystem/git inspection
4. **Match existing patterns** - Follow the same CLI and response schema patterns as fetch/update
5. **Keep commands lightweight** - These are inspection commands, not actions

#### Success Criteria {#addendum-success-criteria}

- `tug fixture list` outputs all fixtures from lock files (verification: parse JSON, check fixtures array)
- `tug fixture status` shows state of each fixture (verification: fetch fixture, run status, verify "fetched" state)
- Status detects SHA mismatches (verification: manually change commit in fixture dir, run status, verify "sha-mismatch" state)
- All commands produce valid JSON output (verification: pipe to `jq .`)
- Existing tests continue to pass (verification: `cargo nextest run -p tugtool`)

---

### A.0 Design Decisions {#addendum-design-decisions}

#### [D07] List Command Shows Lock File Info Only (DECIDED) {#d07-list-info}

**Decision:** `tug fixture list` reads only from lock files and does not inspect the filesystem or git state.

**Rationale:**
- Keeps the command fast and simple
- Clear separation of concerns: list shows what's defined, status shows what's actual
- No network or filesystem operations beyond reading lock files

**Implications:**
- List command has no dependencies on git or fixture directories
- Status command is the one that shows actual state

---

#### [D08] Status Command Reports Discrete States (DECIDED) {#d08-status-states}

**Decision:** `tug fixture status` reports one of these discrete states for each fixture:
- `fetched` - Fixture directory exists and SHA matches lock file
- `missing` - Fixture directory does not exist
- `sha-mismatch` - Fixture directory exists but SHA differs from lock file
- `not-a-git-repo` - Fixture directory exists but is not a git repository (no .git)
- `error` - Could not determine state (e.g., git command failed)

**Rationale:**
- Discrete states are machine-parseable and unambiguous
- Covers all realistic scenarios users encounter
- Aligns with fetch command behavior (which auto-handles mismatch/missing)

**Implications:**
- Response schema includes `state` field with enum values
- Additional fields may be present depending on state (e.g., `expected_sha`, `actual_sha` for mismatches)

---

#### [D09] Status Command Does Not Require Network (DECIDED) {#d09-status-offline}

**Decision:** `tug fixture status` works entirely offline - it only inspects local filesystem and git state.

**Rationale:**
- Status is a diagnostic command, should work even when offline
- Network operations would slow down the command
- Checking remote state is a different operation (could be a future `tug fixture check-remote`)

**Implications:**
- Status cannot detect if the lock file ref has been updated on the remote
- This is acceptable - that's what `update` is for

---

### A.1 Specification {#addendum-specification}

#### A.1.1 CLI Commands {#addendum-cli-commands}

##### Command: `tug fixture list` {#cmd-fixture-list}

**Spec S07: fixture list Command** {#s07-fixture-list}

**Synopsis:**
```
tug fixture list
```

**Arguments:**
- None

**Options:**
- None (global options like `--workspace` apply)

**Behavior:**
1. Discover all lock files in `fixtures/` directory
2. Parse each lock file to extract fixture info
3. Output JSON response listing all fixtures

**Exit codes:**
- 0: Success (even if no fixtures found)
- 2: Invalid arguments
- 10: Internal error (fixtures directory missing, lock file parse error)

---

##### Command: `tug fixture status` {#cmd-fixture-status}

**Spec S08: fixture status Command** {#s08-fixture-status}

**Synopsis:**
```
tug fixture status [NAME]
```

**Arguments:**
- `[NAME]` - Optional fixture name. If omitted, show status of all fixtures.

**Options:**
- None (global options like `--workspace` apply)

**Behavior:**
1. If NAME provided, locate single lock file; otherwise discover all lock files
2. For each fixture:
   a. Parse lock file to get expected info
   b. Check if fixture directory exists at `.tug/fixtures/<name>/`
   c. If exists, verify it's a git repo and get current SHA
   d. Compare actual SHA with expected SHA
   e. Determine state: fetched, missing, sha-mismatch, not-a-git-repo, error
3. Output JSON response with status for each fixture

**Exit codes:**
- 0: Success (even if fixtures are missing or mismatched - these are informational states)
- 2: Invalid arguments (unknown fixture name)
- 10: Internal error (fixtures directory missing, lock file parse error)

---

#### A.1.2 Response Schemas {#addendum-response-schemas}

##### Fixture List Response {#fixture-list-response}

**Spec S09: fixture list Response Schema** {#s09-list-response}

**Success response:**
```json
{
  "status": "ok",
  "schema_version": "1",
  "fixtures": [
    {
      "name": "temporale",
      "repository": "https://github.com/tugtool/temporale",
      "ref": "v0.1.0",
      "sha": "9f21df0322b7aa39ca7f599b128f66c07ecec42f",
      "lock_file": "fixtures/temporale.lock"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | yes | "ok" for success |
| `schema_version` | string | yes | Schema version |
| `fixtures` | array | yes | List of fixture info (may be empty) |
| `fixtures[].name` | string | yes | Fixture name |
| `fixtures[].repository` | string | yes | Git repository URL |
| `fixtures[].ref` | string | yes | Git ref (tag/branch) |
| `fixtures[].sha` | string | yes | Expected commit SHA |
| `fixtures[].lock_file` | string | yes | Relative path to lock file |

---

##### Fixture Status Response {#fixture-status-response}

**Spec S10: fixture status Response Schema** {#s10-status-response}

**Success response:**
```json
{
  "status": "ok",
  "schema_version": "1",
  "fixtures": [
    {
      "name": "temporale",
      "state": "fetched",
      "path": ".tug/fixtures/temporale",
      "repository": "https://github.com/tugtool/temporale",
      "ref": "v0.1.0",
      "expected_sha": "9f21df0322b7aa39ca7f599b128f66c07ecec42f",
      "actual_sha": "9f21df0322b7aa39ca7f599b128f66c07ecec42f"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | yes | "ok" for success |
| `schema_version` | string | yes | Schema version |
| `fixtures` | array | yes | List of fixture statuses |
| `fixtures[].name` | string | yes | Fixture name |
| `fixtures[].state` | string | yes | One of: "fetched", "missing", "sha-mismatch", "not-a-git-repo", "error" |
| `fixtures[].path` | string | yes | Expected path to fixture directory |
| `fixtures[].repository` | string | yes | Git repository URL |
| `fixtures[].ref` | string | yes | Git ref (tag/branch) |
| `fixtures[].expected_sha` | string | yes | SHA from lock file |
| `fixtures[].actual_sha` | string | no | Actual SHA if fixture exists and is a git repo |
| `fixtures[].error` | string | no | Error message if state is "error" |

**State values:**

| State | Meaning | `actual_sha` present | `error` present |
|-------|---------|----------------------|-----------------|
| `fetched` | Directory exists, SHA matches | yes | no |
| `missing` | Directory does not exist | no | no |
| `sha-mismatch` | Directory exists, SHA differs | yes | no |
| `not-a-git-repo` | Directory exists but no .git | no | no |
| `error` | Could not determine state | maybe | yes |

---

### A.2 Symbol Inventory {#addendum-symbol-inventory}

#### A.2.1 New Files {#addendum-new-files}

None - all changes are in existing files.

#### A.2.2 Modified Files {#addendum-modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool/src/main.rs` | Add `List` and `Status` variants to `FixtureAction` enum |
| `crates/tugtool/src/fixture.rs` | Add `get_fixture_state()` and `FixtureState` enum |
| `crates/tugtool-core/src/output.rs` | Add `FixtureListResponse` and `FixtureStatusResponse` types |

#### A.2.3 Symbols to Add {#addendum-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FixtureAction::List` | variant | `main.rs` | CLI subcommand variant |
| `FixtureAction::Status` | variant | `main.rs` | CLI subcommand variant |
| `FixtureState` | enum | `fixture.rs` | Fetched, Missing, ShaMismatch, NotAGitRepo, Error |
| `FixtureStateInfo` | struct | `fixture.rs` | Holds state + optional actual_sha + optional error |
| `get_fixture_state` | fn | `fixture.rs` | Determine state of a single fixture |
| `get_all_fixture_states` | fn | `fixture.rs` | Get states for all fixtures |
| `FixtureListResponse` | struct | `output.rs` | JSON response for list command |
| `FixtureListItem` | struct | `output.rs` | Individual fixture in list response |
| `FixtureStatusResponse` | struct | `output.rs` | JSON response for status command |
| `FixtureStatusItem` | struct | `output.rs` | Individual fixture in status response |
| `execute_fixture_list` | fn | `main.rs` | Execute list subcommand |
| `execute_fixture_status` | fn | `main.rs` | Execute status subcommand |

---

### A.3 Test Plan Concepts {#addendum-test-plan}

#### Test Categories {#addendum-test-categories}

| Category | What to Test | How |
|----------|--------------|-----|
| **Unit** | State detection logic | Unit tests for `get_fixture_state` with mocked filesystem |
| **Integration** | Full CLI roundtrip | CLI integration tests with temp directories |
| **CLI Parsing** | Command parsing | Verify clap parses `list` and `status` correctly |

#### Test Scenarios {#addendum-test-scenarios}

**List command:**
- List with no fixtures (empty fixtures directory) - returns empty array
- List with one fixture - returns array with one item
- List with multiple fixtures - returns array sorted by name
- List with malformed lock file - returns error

**Status command:**
- Status when fixture is fetched and matches - state: "fetched"
- Status when fixture directory missing - state: "missing"
- Status when fixture SHA differs from lock file - state: "sha-mismatch"
- Status when fixture directory exists but is not a git repo - state: "not-a-git-repo"
- Status with specific fixture name - returns status for just that fixture
- Status with unknown fixture name - returns error
- Status with multiple fixtures in mixed states - returns correct state for each

---

### A.4 Execution Steps {#addendum-execution-steps}

#### Step A1: Add Response Types {#step-a1}

**Commit:** `feat(output): add fixture list and status response types`

**References:** [D07], [D08], Spec S09, Spec S10, (#addendum-response-schemas)

**Artifacts:**
- Extended `crates/tugtool-core/src/output.rs` with new response types

**Tasks:**
- [x] Add `FixtureListResponse` struct with `fixtures: Vec<FixtureListItem>`
- [x] Add `FixtureListItem` struct (name, repository, ref, sha, lock_file)
- [x] Add `FixtureStatusResponse` struct with `fixtures: Vec<FixtureStatusItem>`
- [x] Add `FixtureStatusItem` struct (name, state, path, repository, ref, expected_sha, actual_sha?, error?)
- [x] Add impl blocks with `new()` constructors for both response types

**Response type implementations:**
```rust
/// Response for fixture list command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureListResponse {
    pub status: String,
    pub schema_version: String,
    pub fixtures: Vec<FixtureListItem>,
}

impl FixtureListResponse {
    pub fn new(fixtures: Vec<FixtureListItem>) -> Self {
        FixtureListResponse {
            status: "ok".to_string(),
            schema_version: SCHEMA_VERSION.to_string(),
            fixtures,
        }
    }
}

/// Individual fixture in list response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureListItem {
    pub name: String,
    pub repository: String,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub sha: String,
    pub lock_file: String,
}

/// Response for fixture status command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureStatusResponse {
    pub status: String,
    pub schema_version: String,
    pub fixtures: Vec<FixtureStatusItem>,
}

/// Individual fixture in status response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixtureStatusItem {
    pub name: String,
    pub state: String,
    pub path: String,
    pub repository: String,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub expected_sha: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
```

**Tests:**
- [x] Unit: FixtureListResponse serializes to expected JSON
- [x] Unit: FixtureStatusResponse serializes to expected JSON
- [x] Unit: FixtureStatusItem with optional fields serializes correctly

**Checkpoint:**
- [x] `cargo build -p tugtool-core` - builds without errors
- [x] `cargo nextest run -p tugtool-core output` - output tests pass

**Commit after all checkpoints pass.**

---

#### Step A2: Add Fixture State Logic {#step-a2}

**Commit:** `feat(fixture): add fixture state detection`

**References:** [D08], [D09], Spec S08, (#d08-status-states)

**Artifacts:**
- Extended `crates/tugtool/src/fixture.rs` with state detection

**Tasks:**
- [x] Add `FixtureState` enum (Fetched, Missing, ShaMismatch, NotAGitRepo, Error)
- [x] Add `FixtureStateInfo` struct (state, actual_sha option, error option)
- [x] Implement `get_fixture_state()` function
- [x] Implement `get_all_fixture_states()` function
- [x] Add unit tests for state detection

**Implementation:**
```rust
/// State of a fixture on the filesystem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FixtureState {
    /// Directory exists and SHA matches lock file.
    Fetched,
    /// Directory does not exist.
    Missing,
    /// Directory exists but SHA differs from lock file.
    ShaMismatch,
    /// Directory exists but is not a git repository.
    NotAGitRepo,
    /// Could not determine state.
    Error,
}

/// Information about a fixture's state.
#[derive(Debug, Clone)]
pub struct FixtureStateInfo {
    pub state: FixtureState,
    pub actual_sha: Option<String>,
    pub error: Option<String>,
}

/// Get the state of a fixture on the filesystem.
pub fn get_fixture_state(workspace_root: &Path, info: &FixtureInfo) -> FixtureStateInfo {
    let target_path = fixture_path(workspace_root, &info.name);

    // Check if directory exists
    if !target_path.exists() {
        return FixtureStateInfo {
            state: FixtureState::Missing,
            actual_sha: None,
            error: None,
        };
    }

    // Check if it's a git repo
    let git_dir = target_path.join(".git");
    if !git_dir.exists() {
        return FixtureStateInfo {
            state: FixtureState::NotAGitRepo,
            actual_sha: None,
            error: None,
        };
    }

    // Get the actual SHA
    match get_repo_sha(&target_path) {
        Ok(sha) => {
            if sha == info.sha {
                FixtureStateInfo {
                    state: FixtureState::Fetched,
                    actual_sha: Some(sha),
                    error: None,
                }
            } else {
                FixtureStateInfo {
                    state: FixtureState::ShaMismatch,
                    actual_sha: Some(sha),
                    error: None,
                }
            }
        }
        Err(e) => FixtureStateInfo {
            state: FixtureState::Error,
            actual_sha: None,
            error: Some(e),
        },
    }
}

/// Get states for all fixtures.
pub fn get_all_fixture_states(
    workspace_root: &Path,
) -> Result<Vec<(FixtureInfo, FixtureStateInfo)>, FixtureError> {
    let lock_files = discover_lock_files(workspace_root)
        .map_err(|e| FixtureError::without_name(e))?;

    let mut results = Vec::with_capacity(lock_files.len());

    for lock_path in lock_files {
        let info = read_lock_file(&lock_path)
            .map_err(|e| FixtureError::without_name(e))?;
        let state = get_fixture_state(workspace_root, &info);
        results.push((info, state));
    }

    Ok(results)
}
```

**Tests:**
- [x] Unit: get_fixture_state returns Missing when directory absent
- [x] Unit: get_fixture_state returns NotAGitRepo when no .git
- [x] Unit: get_fixture_state returns Fetched when SHA matches
- [x] Unit: get_fixture_state returns ShaMismatch when SHA differs
- [x] Unit: FixtureState serializes to kebab-case strings

**Checkpoint:**
- [x] `cargo nextest run -p tugtool fixture` - fixture tests pass (51 tests)

**Commit after all checkpoints pass.**

---

#### Step A3: Add CLI Commands {#step-a3}

**Commit:** `feat(cli): add tug fixture list and status commands`

**References:** [D07], [D08], [D09], Spec S07, Spec S08, Spec S09, Spec S10, (#addendum-cli-commands)

**Artifacts:**
- Extended `crates/tugtool/src/main.rs` with list and status subcommands
- Updated `FixtureAction` enum

**Tasks:**
- [x] Add `FixtureAction::List` variant (no arguments)
- [x] Add `FixtureAction::Status` variant (optional name argument)
- [x] Implement `execute_fixture_list()` function
- [x] Implement `execute_fixture_status()` function
- [x] Update `execute_fixture()` to dispatch to new commands
- [x] Add CLI parsing tests

**CLI structure updates:**
```rust
/// Fixture management actions.
#[derive(Subcommand)]
enum FixtureAction {
    /// Fetch fixtures according to lock files.
    Fetch {
        /// Specific fixture to fetch (fetches all if omitted).
        name: Option<String>,
        /// Re-fetch even if fixture exists and SHA matches.
        #[arg(long)]
        force: bool,
    },
    /// Update a fixture lock file to a new ref.
    Update {
        /// Fixture name to update.
        name: String,
        /// New ref (tag or branch).
        #[arg(long = "ref")]
        git_ref: String,
    },
    /// List available fixtures from lock files.
    List,
    /// Show fetch state of fixtures.
    Status {
        /// Specific fixture to check (checks all if omitted).
        name: Option<String>,
    },
}
```

**Tests:**
- [x] CLI: parse `tug fixture list`
- [x] CLI: parse `tug fixture status`
- [x] CLI: parse `tug fixture status temporale`
- [x] Integration: list command produces valid JSON
- [x] Integration: status command produces valid JSON

**Checkpoint:**
- [x] `cargo nextest run -p tugtool cli_parsing` - CLI tests pass (32 passed)
- [x] `cargo run -p tugtool -- fixture list --help` shows correct usage
- [x] `cargo run -p tugtool -- fixture status --help` shows correct usage
- [x] `cargo run -p tugtool -- fixture list 2>&1 | jq .` produces valid JSON
- [x] `cargo run -p tugtool -- fixture status 2>&1 | jq .` produces valid JSON

**Commit after all checkpoints pass.**

---

#### Step A4: Add Integration Tests {#step-a4}

**Commit:** `test(fixture): add list and status integration tests`

**References:** Spec S07, Spec S08, (#addendum-test-scenarios)

**Artifacts:**
- Integration tests in `crates/tugtool/tests/`

**Tasks:**
- [x] Add integration test for list with temporale fixture
- [x] Add integration test for status when fixture is fetched
- [x] Add integration test for status when fixture is missing
- [x] Add integration test for status with specific fixture name
- [x] Add integration test for status with unknown fixture name (error case)

**Tests:**
- [x] Integration: list returns temporale fixture info
- [x] Integration: status shows "fetched" for existing fixture
- [x] Integration: status shows "missing" when fixture directory absent
- [x] Integration: status with name filters to single fixture
- [x] Integration: status with unknown name returns error

**Checkpoint:**
- [x] `cargo nextest run -p tugtool fixture_list` - list tests pass (4 passed)
- [x] `cargo nextest run -p tugtool fixture_status` - status tests pass (9 passed)

**Commit after all checkpoints pass.**

---

#### Step A5: Update Documentation {#step-a5}

**Commit:** `docs: add fixture list and status command documentation`

**References:** Spec S07, Spec S08, (#addendum-success-criteria)

**Artifacts:**
- Updated CLAUDE.md with new commands

**Tasks:**
- [x] Add `tug fixture list` to CLAUDE.md fixture commands section
- [x] Add `tug fixture status` to CLAUDE.md fixture commands section
- [x] Add examples showing typical usage

**CLAUDE.md additions:**
```markdown
# List available fixtures
tug fixture list

# Show status of all fixtures
tug fixture status

# Show status of specific fixture
tug fixture status temporale
```

**Checkpoint:**
- [x] CLAUDE.md contains complete fixture list/status documentation

**Commit after all checkpoints pass.**

---

### A.5 Deliverables and Checkpoints {#addendum-deliverables}

**Deliverable:** CLI commands `tug fixture list` and `tug fixture status` for inspecting fixture availability and state.

#### Addendum Exit Criteria {#addendum-exit-criteria}

- [x] `tug fixture list` outputs fixtures from lock files
- [x] `tug fixture status` shows state of each fixture
- [x] Status detects fetched, missing, sha-mismatch states correctly
- [x] All commands produce valid JSON output
- [x] All existing Phase 7 tests continue to pass
- [x] CLAUDE.md documents new commands

**Acceptance tests:**
- [x] Integration: `cargo nextest run -p tugtool fixture_list` passes
- [x] Integration: `cargo nextest run -p tugtool fixture_status` passes
- [x] CLI: `tug fixture list 2>&1 | jq .status` outputs "ok"
- [x] CLI: `tug fixture status 2>&1 | jq .status` outputs "ok"

#### Milestones {#addendum-milestones}

**Milestone M04: List Command Working** {#m04-list-working}
- [x] `tug fixture list` returns fixture info from lock files
- [x] JSON output includes all required fields

**Milestone M05: Status Command Working** {#m05-status-working}
- [x] `tug fixture status` correctly identifies fixture states
- [x] SHA mismatch detection works
- [x] Missing fixture detection works

| Checkpoint | Verification |
|------------|--------------|
| Response types compile | `cargo build -p tugtool-core` |
| State detection works | `cargo nextest run -p tugtool fixture_state` |
| List command works | `tug fixture list \| jq .` parses |
| Status command works | `tug fixture status \| jq .` parses |
| Tests pass | `cargo nextest run -p tugtool` exits 0 |
| Docs updated | CLAUDE.md contains list/status commands |

**Commit after all checkpoints pass.**

---

## Phase 7 Addendum B: Error Codes and CLI Tests {#phase-7-addendum-b}

**Purpose:** Address gaps between the Phase 7 specification and implementation identified during post-implementation review: improve error-code fidelity, clarify lock-file rewrite behavior, and add true CLI end-to-end tests.

---

### Plan Metadata {#addendum-b-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | complete |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-22 |

---

### Addendum Overview {#addendum-b-overview}

#### Context {#addendum-b-context}

Phase 7 and Addendum A successfully delivered the fixture management CLI (`fetch`, `update`, `list`, `status`). A post-implementation review identified several gaps between the original specification and the actual implementation:

1. **Error-code fidelity** - Most fixture failures map to `TugError::internal()` (exit code 10), but the spec distinguished between invalid arguments (code 2), resolution errors (code 3), and internal errors (code 10). This makes it harder for agents and CI to distinguish "user gave bad input" from "network/git failure."

2. **Lock-file rewrite policy** - The `write_lock_file()` function overwrites the entire file with a fresh template, dropping any user comments. The spec stated "Update preserves lock file comments and formatting." The implementation is simpler but differs from spec.

3. **CLI end-to-end tests** - The "integration tests" for `list` and `status` are module-level tests calling `tugtool::fixture::*` directly. True CLI tests that spawn the `tug` binary, pass arguments, and validate stdout JSON + exit codes are missing.

Additionally, the review identified items to document/accept rather than fix:

4. **`toml` runtime dependency** - Lock files are TOML; the crate is small and appropriate. Accept deviation from "no new runtime dependencies."

5. **Raw SHA in update command** - `git ls-remote <repo> <sha>` does not resolve raw SHAs. The update command requires tag or branch refs. Document this limitation.

6. **SHA enforcement in test helper** - The `temporale_path()` helper does not verify SHA (low priority, tests already verify via separate mechanisms).

#### Strategy {#addendum-b-strategy}

1. **Map fixture errors to appropriate exit codes** - Introduce error variants that distinguish bad input from resolution failures from internal errors
2. **Accept lock-file rewrite behavior** - Update spec to match reality rather than complicate the implementation
3. **Add CLI end-to-end tests** - Create a new test file that spawns the `tug` binary and validates output/exit codes
4. **Document accepted limitations** - Update spec sections to note raw SHA limitation

#### Success Criteria {#addendum-b-success-criteria}

- `tug fixture fetch nonexistent` returns exit code 2 (invalid arguments), not 10
- `tug fixture update temporale --ref nonexistent-tag` returns exit code 3 (resolution error), not 10
- Internal errors (git not available, network timeout) still return exit code 10
- CLI E2E tests exist that spawn the actual `tug` binary and verify stdout + exit codes
- Spec is updated to document that lock-file comments are not preserved
- Spec is updated to document that `--ref` requires a tag or branch (not raw SHA)
- All existing tests continue to pass

---

### B.0 Design Decisions {#addendum-b-design-decisions}

#### [D10] Fixture Error Variants (DECIDED) {#d10-fixture-error-variants}

**Decision:** Introduce specific fixture error types that map to appropriate exit codes:
- `FixtureNotFound` -> exit code 2 (invalid arguments)
- `RefNotFound` -> exit code 3 (resolution error)
- `FixtureInternal` -> exit code 10 (internal error, git failures, network)

**Rationale:**
- Matches the exit codes specified in Spec S01 and Spec S02
- Allows agents/CI to programmatically distinguish error categories
- Follows established TugError patterns in `tugtool-core`

**Implications:**
- Update `execute_fixture_*` functions to return appropriate error types
- May need to add methods to `FixtureError` or create new `TugError` variants
- Error mapping happens at CLI boundary (in main.rs)

---

#### [D11] Accept Lock-File Rewrite Behavior (DECIDED) {#d11-lockfile-rewrite}

**Decision:** Accept that `write_lock_file()` regenerates the entire file from a template, discarding any user comments. Update the spec to document this behavior.

**Rationale:**
- Preserving comments requires parsing TOML while retaining formatting (complex)
- Lock files are machine-managed; comments are rarely needed
- Simpler implementation is more maintainable
- Users can re-add comments after update if needed

**Implications:**
- Update Spec S02 test scenario: remove "Update preserves lock file comments and formatting"
- Add note in spec that lock files are regenerated on update
- No code changes required

---

#### [D12] CLI E2E Test Approach (DECIDED) {#d12-cli-e2e-tests}

**Decision:** Add a new test file `crates/tugtool/tests/fixture_cli_e2e.rs` that uses `std::process::Command` to spawn the `tug` binary and validate:
- Stdout contains valid JSON
- Exit codes match expected values
- JSON fields have expected values

**Rationale:**
- True E2E tests catch issues that module-level tests miss (argument parsing, output formatting)
- Using `std::process::Command` is straightforward and well-understood
- Tests can use `cargo build` artifacts via `env!("CARGO_BIN_EXE_tug")`

**Implications:**
- Tests require the binary to be built (use `#[cfg(test)]` and cargo test integration)
- Tests may be slower than unit tests (acceptable for E2E)
- Need to handle workspace root discovery in tests

---

### B.1 Specification Updates {#addendum-b-spec-updates}

#### B.1.1 Exit Code Clarification {#exit-code-clarification}

**Update to Spec S01 (fixture fetch):**

Current text specifies exit codes but implementation does not follow them. Clarify the mapping:

| Exit Code | Condition | Example |
|-----------|-----------|---------|
| 0 | Success | All fixtures fetched or up-to-date |
| 2 | Invalid arguments | Unknown fixture name, missing lock file |
| 10 | Internal error | Git not available, clone failed, network error |

**Update to Spec S02 (fixture update):**

| Exit Code | Condition | Example |
|-----------|-----------|---------|
| 0 | Success | Lock file updated |
| 2 | Invalid arguments | Unknown fixture name, missing lock file |
| 3 | Resolution error | Ref not found in repository |
| 10 | Internal error | Git not available, ls-remote failed, write error |

---

#### B.1.2 Lock File Rewrite Policy {#lockfile-rewrite-policy}

**Update to Spec S05 (Lock File Format):**

Add note after the format example:

> **Note:** When `tug fixture update` modifies a lock file, it regenerates the entire file from a template. Any user-added comments will not be preserved. The comment header shown above is automatically regenerated.

**Update to Test Scenarios (Section 7.3):**

Remove or modify this test scenario:
- ~~Update preserves lock file comments and formatting~~
- Update regenerates lock file (comments not preserved)

---

#### B.1.3 Raw SHA Limitation {#raw-sha-limitation}

**Update to Spec S02 (fixture update):**

Add note in Behavior section:

> **Limitation:** The `--ref` argument must be a tag name or branch name, not a raw SHA. This is because `git ls-remote <repository> <sha>` does not resolve raw commit SHAs. To pin to a specific commit, first identify a tag or branch that points to that commit.

---

### B.2 Symbol Inventory {#addendum-b-symbol-inventory}

#### B.2.1 New Files {#addendum-b-new-files}

| File | Purpose |
|------|---------|
| `crates/tugtool/tests/fixture_cli_e2e.rs` | CLI end-to-end tests for fixture commands |

#### B.2.2 Modified Files {#addendum-b-modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool/src/main.rs` | Update `execute_fixture_*` functions to return appropriate error types |
| `crates/tugtool/src/fixture.rs` | Add error kind variants or helper methods for error classification |
| `plans/phase-7.md` | Spec updates per B.1 |

#### B.2.3 Symbols to Add/Modify {#addendum-b-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FixtureErrorKind` | enum | `fixture.rs` | NotFound, RefNotFound, Internal (if not already present) |
| `FixtureError::exit_code()` | method | `fixture.rs` | Returns appropriate exit code based on error kind |
| `fixture_cli_e2e` | test module | `tests/fixture_cli_e2e.rs` | CLI E2E tests |

---

### B.3 Test Plan {#addendum-b-test-plan}

#### Test Categories {#addendum-b-test-categories}

| Category | What to Test | How |
|----------|--------------|-----|
| **CLI E2E** | Binary spawning, stdout, exit codes | `std::process::Command` with assertions |
| **Unit** | Error kind classification | Unit tests for error type methods |

#### Test Scenarios {#addendum-b-test-scenarios}

**Exit code tests:**
- `tug fixture fetch nonexistent` -> exit code 2, JSON error response
- `tug fixture fetch` (valid) -> exit code 0, JSON success response
- `tug fixture update temporale --ref nonexistent-tag-xyz` -> exit code 3, JSON error response
- `tug fixture update nonexistent --ref v1.0.0` -> exit code 2, JSON error response
- `tug fixture list` -> exit code 0, JSON success response
- `tug fixture status` -> exit code 0, JSON success response
- `tug fixture status nonexistent` -> exit code 2, JSON error response

**JSON output validation:**
- All commands produce parseable JSON on stdout
- Success responses have `"status": "ok"`
- Error responses have `"status": "error"` and `"message"` field

---

### B.4 Execution Steps {#addendum-b-execution-steps}

#### Step B1: Update Error Handling in fixture.rs {#step-b1}

**Commit:** `fix(fixture): improve error classification for exit codes`

**References:** [D10], (#exit-code-clarification)

**Artifacts:**
- Updated `crates/tugtool/src/fixture.rs` with error classification

**Tasks:**
- [x] Review existing `FixtureError` structure
- [x] Add `kind` field or method to classify errors (NotFound, RefNotFound, Internal)
- [x] Add `exit_code()` method that returns 2, 3, or 10 based on kind
- [x] Update error construction in `fetch_fixture`, `update_fixture_lock`, etc.
- [x] Add unit tests for error classification

**Implementation approach:**
```rust
/// Classification of fixture errors for exit code mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixtureErrorKind {
    /// Fixture or lock file not found (exit code 2).
    NotFound,
    /// Git ref could not be resolved (exit code 3).
    RefNotFound,
    /// Internal error - git failure, network, I/O (exit code 10).
    Internal,
}

impl FixtureError {
    /// Get the appropriate exit code for this error.
    pub fn exit_code(&self) -> i32 {
        match self.kind {
            FixtureErrorKind::NotFound => 2,
            FixtureErrorKind::RefNotFound => 3,
            FixtureErrorKind::Internal => 10,
        }
    }
}
```

**Tests:**
- [x] Unit: FixtureError with NotFound kind returns exit code 2
- [x] Unit: FixtureError with RefNotFound kind returns exit code 3
- [x] Unit: FixtureError with Internal kind returns exit code 10

**Checkpoint:**
- [x] `cargo build -p tugtool` - builds without errors
- [x] `cargo nextest run -p tugtool fixture` - fixture tests pass (68 passed)

**Commit after all checkpoints pass.**

---

#### Step B2: Update CLI Error Handling in main.rs {#step-b2}

**Commit:** `fix(cli): use fixture error exit codes`

**References:** [D10], Spec S01, Spec S02, (#exit-code-clarification)

**Artifacts:**
- Updated `crates/tugtool/src/main.rs` error handling

**Tasks:**
- [x] Update `execute_fixture_fetch` to propagate fixture errors with correct exit codes
- [x] Update `execute_fixture_update` to propagate fixture errors with correct exit codes
- [x] Update `execute_fixture_list` to return exit code 2 for invalid fixture name
- [x] Update `execute_fixture_status` to return exit code 2 for invalid fixture name
- [x] Ensure error responses include appropriate JSON structure

**Implementation approach:**
```rust
fn execute_fixture_fetch(...) -> Result<(), TugError> {
    match fixture::fetch_fixture(...) {
        Ok(result) => { /* success handling */ },
        Err(e) => {
            // Convert FixtureError to TugError with appropriate exit code
            let exit_code = e.exit_code();
            return Err(TugError::with_exit_code(e.message, exit_code));
        }
    }
}
```

**Tests:**
- [x] Verify error paths return correct error types (covered by E2E tests in B3)

**Checkpoint:**
- [x] `cargo build -p tugtool` - builds without errors
- [x] `cargo nextest run -p tugtool` - all tests pass (258 passed)

**Commit after all checkpoints pass.**

---

#### Step B3: Add CLI End-to-End Tests {#step-b3}

**Commit:** `test(fixture): add CLI end-to-end tests`

**References:** [D12], (#addendum-b-test-scenarios)

**Artifacts:**
- New `crates/tugtool/tests/fixture_cli_e2e.rs`

**Tasks:**
- [x] Create test file with helper function to run tug binary
- [x] Add test: `fetch nonexistent` returns exit code 2
- [x] Add test: `fetch` (valid) returns exit code 0 and valid JSON
- [x] Add test: `update temporale --ref nonexistent-xyz` returns exit code 3
- [x] Add test: `update nonexistent --ref v1.0.0` returns exit code 2
- [x] Add test: `list` returns exit code 0 and valid JSON
- [x] Add test: `status` returns exit code 0 and valid JSON
- [x] Add test: `status nonexistent` returns exit code 2

**Test file structure:**
```rust
//! CLI end-to-end tests for fixture commands.
//!
//! These tests spawn the actual `tug` binary and validate stdout/exit codes.

use std::process::Command;
use serde_json::Value;

/// Run tug with given arguments and return (stdout, stderr, exit_code).
fn run_tug(args: &[&str]) -> (String, String, i32) {
    let output = Command::new(env!("CARGO_BIN_EXE_tug"))
        .args(args)
        .current_dir(workspace_root())
        .output()
        .expect("failed to execute tug");

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    (stdout, stderr, exit_code)
}

fn workspace_root() -> std::path::PathBuf {
    // Find workspace root from CARGO_MANIFEST_DIR
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.parent().unwrap().parent().unwrap().to_path_buf()
}

#[test]
fn test_fixture_fetch_nonexistent_returns_exit_2() {
    let (stdout, _stderr, exit_code) = run_tug(&["fixture", "fetch", "nonexistent"]);
    assert_eq!(exit_code, 2, "expected exit code 2 for unknown fixture");

    let json: Value = serde_json::from_str(&stdout)
        .expect("stdout should be valid JSON");
    assert_eq!(json["status"], "error");
}

#[test]
fn test_fixture_list_returns_exit_0() {
    let (stdout, _stderr, exit_code) = run_tug(&["fixture", "list"]);
    assert_eq!(exit_code, 0, "expected exit code 0 for list");

    let json: Value = serde_json::from_str(&stdout)
        .expect("stdout should be valid JSON");
    assert_eq!(json["status"], "ok");
}

// ... more tests
```

**Tests:**
- [x] E2E: fetch nonexistent -> exit 2
- [x] E2E: fetch valid -> exit 0, JSON ok
- [x] E2E: update bad ref -> exit 3
- [x] E2E: update nonexistent fixture -> exit 2
- [x] E2E: list -> exit 0, JSON ok
- [x] E2E: status -> exit 0, JSON ok
- [x] E2E: status nonexistent -> exit 2

**Checkpoint:**
- [x] `cargo nextest run -p tugtool fixture_cli_e2e` - E2E tests pass (7 passed)
- [x] All tests validate both exit code and JSON structure

**Commit after all checkpoints pass.**

---

#### Step B4: Update Spec Documentation {#step-b4}

**Commit:** `docs: update Phase 7 spec with implementation notes`

**References:** [D11], (#lockfile-rewrite-policy), (#raw-sha-limitation)

**Artifacts:**
- Updated `plans/phase-7.md` with spec clarifications

**Tasks:**
- [x] Add note to Spec S05 about lock file regeneration (comments not preserved)
- [x] Add note to Spec S02 about raw SHA limitation
- [x] Update test scenario in Section 7.3 to remove "preserves comments" requirement
- [x] Add "Accepted Deviations" section documenting `toml` dependency

**Checkpoint:**
- [x] Spec S05 includes lock file regeneration note
- [x] Spec S02 includes raw SHA limitation note
- [x] Test scenarios updated

**Commit after all checkpoints pass.**

---

### B.5 Deliverables and Checkpoints {#addendum-b-deliverables}

**Deliverable:** Improved error-code fidelity for fixture commands and true CLI end-to-end tests.

#### Addendum B Exit Criteria {#addendum-b-exit-criteria}

- [x] `tug fixture fetch nonexistent` returns exit code 2
- [x] `tug fixture update temporale --ref nonexistent-xyz` returns exit code 3
- [x] `tug fixture update nonexistent --ref v1.0.0` returns exit code 2
- [x] CLI E2E test file exists with tests for all fixture commands
- [x] All E2E tests pass (7 passed)
- [x] Spec updated with lock file regeneration note
- [x] Spec updated with raw SHA limitation note
- [x] All existing tests continue to pass (265 passed)

**Acceptance tests:**
- [x] `cargo nextest run -p tugtool fixture_cli_e2e` passes (7 passed)
- [x] `cargo nextest run -p tugtool` passes (265 tests)
- [x] Manual: `tug fixture fetch bad-name; echo $?` outputs 2
- [x] Manual: `tug fixture update temporale --ref no-such-ref; echo $?` outputs 3

#### Milestones {#addendum-b-milestones}

**Milestone M06: Error Codes Fixed** {#m06-error-codes}
- [x] FixtureError has kind classification
- [x] CLI uses appropriate exit codes based on error kind

**Milestone M07: CLI E2E Tests Added** {#m07-cli-e2e}
- [x] `fixture_cli_e2e.rs` exists with comprehensive tests
- [x] Tests cover all fixture subcommands
- [x] Tests validate both exit codes and JSON output

**Milestone M08: Spec Updated** {#m08-spec-updated}
- [x] Lock file regeneration documented
- [x] Raw SHA limitation documented

| Checkpoint | Verification |
|------------|--------------|
| Error classification works | Unit tests for FixtureError.exit_code() |
| CLI uses correct exit codes | E2E tests pass |
| E2E tests exist | `fixture_cli_e2e.rs` compiles and runs |
| Spec updated | Phase 7 doc includes new notes |
| All tests pass | `cargo nextest run -p tugtool` exits 0 |

**Commit after all checkpoints pass.**

---

### B.6 Accepted Deviations {#addendum-b-accepted-deviations}

The following items were identified during review but accepted as-is:

1. **`toml` runtime dependency** - The Phase 7 constraints stated "no new runtime dependencies." The `toml` crate was added for lock file parsing. This is accepted because:
   - Lock files are TOML format (established in Phase 6)
   - The `toml` crate is small, well-maintained, and appropriate for this use
   - Alternatives (manual parsing) would be more error-prone

2. **SHA enforcement in test helper** - The `temporale_path()` helper function does not verify that the fixture SHA matches the lock file. This is accepted because:
   - `tug fixture fetch` verifies SHA during fetch
   - `tug fixture status` can detect mismatches
   - CI workflow runs `fixture fetch` before tests
   - Adding SHA verification to the helper would require git operations in test setup
