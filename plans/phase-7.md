## Phase 7: Tug Fixture Infrastructure Improvements {#phase-7}

**Purpose:** Add `tug fixture fetch` and `tug fixture update` CLI commands to streamline fixture management, eliminating manual git clone commands and making fixture updates safe and convenient.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
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
- Update preserves lock file comments and formatting

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
- [ ] Add fixture command section to CLAUDE.md
- [ ] Update fixture setup instructions to use new commands
- [ ] Add examples for common workflows
- [ ] Remove manual git clone instructions (or mark as alternative)

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
- [ ] CLAUDE.md contains complete fixture command documentation
- [ ] Instructions are clear and accurate

**Commit after all checkpoints pass.**

---

#### Step 8: Optional CI Workflow Update {#step-8}

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

- [ ] `tug fixture fetch` fetches all fixtures from lock files
- [ ] `tug fixture fetch temporale` fetches specific fixture
- [ ] `tug fixture fetch --force` re-fetches even if up-to-date
- [ ] `tug fixture update temporale --ref <tag>` updates lock file
- [ ] All commands produce valid JSON output
- [ ] Branch refs produce warning in update response
- [ ] SHA verification catches mismatches
- [ ] All existing Temporale tests pass
- [ ] CLAUDE.md documents new commands

**Acceptance tests:**
- [ ] Integration: `cargo nextest run -p tugtool fixture` passes
- [ ] Integration: `cargo nextest run -p tugtool temporale` passes
- [ ] CLI: `tug fixture fetch 2>&1 | jq .status` outputs "ok"

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Shared Module Created** {#m01-shared-module}
- [ ] `fixture.rs` module exists with core types and functions
- [ ] Test support uses shared module

**Milestone M02: Fetch Command Working** {#m02-fetch-working}
- [ ] `tug fixture fetch` fetches Temporale fixture
- [ ] SHA verification works
- [ ] Force flag works

**Milestone M03: Update Command Working** {#m03-update-working}
- [ ] `tug fixture update` resolves refs and updates lock files
- [ ] Branch warning works
- [ ] JSON output complete

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Create Rust sample project fixture
- [ ] Create JavaScript sample project fixture
- [ ] Add fixture caching in CI (GitHub Actions cache)
- [ ] Support authenticated repositories (private fixtures)
- [ ] Automatic fixture version checking (warn on outdated)
- [ ] `tug fixture list` command to show available fixtures
- [ ] `tug fixture status` command to show fetch state
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
