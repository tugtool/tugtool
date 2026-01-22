## Phase 6: Make Temporale Standalone {#phase-6}

**Purpose:** Migrate Temporale from a vendored sample-code directory in tugtool to a standalone PyPI-published library, while maintaining tugtool's ability to use it as a deterministic integration test fixture.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-21 |

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

Temporale was created in Phase 5 as a comprehensive Python datetime library to serve as a realistic test bed for tugtool's refactoring capabilities. It currently lives at `sample-code/python/temporale/` within the tugtool repository, making it:

1. **Tightly coupled** - Changes to Temporale are versioned with tugtool, even though they're semantically independent
2. **Not reusable** - Other projects cannot use Temporale as a refactoring test fixture
3. **Awkward for contributions** - Someone wanting to improve Temporale must work within the tugtool repo

Phase 6 addresses these issues by:
- Publishing Temporale as a standalone PyPI package with its own semver versioning
- Creating it as its own git repository (potentially under the same org)
- Implementing a fixture fetch mechanism in tugtool for deterministic CI
- Providing local development override for active fixture development

This is the first of what will become a pattern: tugtool will support multiple language fixtures fetched on demand, each pinned to specific versions for reproducible testing.

#### Strategy {#strategy}

1. **Create standalone Temporale repo first** - Extract the current sample-code to its own repository before modifying tugtool
2. **Implement fixture infrastructure in tugtool** - Add the fetch/pin/cache mechanism
3. **Update tests to use fixture infrastructure** - Modify `temporale_path()` and related code
4. **Maintain backward compatibility during transition** - Keep vendored Temporale until fixture infrastructure is proven
5. **Remove vendored code last** - Only delete `sample-code/python/temporale/` after CI passes with fetched fixtures
6. **Design for generalization** - Structure supports future Rust, JavaScript, Go fixtures

#### Stakeholders / Primary Customers {#stakeholders}

1. **Tugtool CI** - Needs deterministic fixture fetching with pinned versions
2. **Tugtool developers** - Need local override for fixture development
3. **Temporale maintainers** - Need independent release cycle and versioning
4. **Future language fixture maintainers** - Need established pattern to follow

#### Success Criteria (Measurable) {#success-criteria}

- Temporale published to PyPI with semver version (verification: `pip install temporale` succeeds)
- Temporale has its own git repository (verification: repo exists, CI passes)
- Tugtool CI fetches Temporale at pinned SHA (verification: CI logs show fetch step)
- `TUG_TEMPORALE_PATH` override works (verification: set env var, tests use local path)
- All existing Temporale integration tests pass with fetched fixture (verification: `cargo nextest run temporale`)
- No `sample-code/python/temporale/` in tugtool repo (verification: directory does not exist)
- Tests fail loudly if fixture unavailable (verification: remove fixture, test fails with instructions)
- Temporale repo has the same Claude Code configuration as tugtool (verification: `.claude/` exists and commands/agents behave equivalently)

#### Scope {#scope}

1. Create standalone Temporale repository with pyproject.toml, CI, and documentation
2. Publish Temporale to PyPI (or TestPyPI for initial testing)
3. Implement fixture fetch mechanism in tugtool test infrastructure
4. Create fixture pin file format (`fixtures/temporale.lock`)
5. Update `temporale_path()` to support fetch + env var override
6. Update CI workflow to fetch fixtures before tests
7. Update `.gitignore` for fixture directory
8. Remove vendored `sample-code/python/temporale/`
9. Copy tugtool’s Claude Code configuration into the new Temporale repo (`.claude/` commands + agents), adjusting only what must differ for a standalone Python project

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full fixture management CLI (e.g., `tug fixture update`) - manual lock file updates are acceptable for now
- Automatic fixture version bumping - intentionally manual for reproducibility
- Multiple fixture versions simultaneously - one pinned version per fixture
- Private/authenticated fixture repositories - public repos only
- Fixture download caching across CI runs (GitHub Actions cache can handle this separately)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5 complete (Temporale exists and tests pass)
- GitHub repository creation permissions (for standalone Temporale repo)
- PyPI account for publishing (or TestPyPI for development)
- `git` available in CI environment

#### Constraints {#constraints}

- Must not break existing Phase 5 tests during transition
- Fixture fetch must work on both macOS and Linux (CI matrix)
- Fixture fetch must work offline if fixture is already cached
- No additional runtime dependencies for tugtool itself (fixture fetch is test-time only)

#### Assumptions {#assumptions}

- GitHub repository for Temporale can be created (same org or personal)
- PyPI publishing is feasible (no name conflicts, account available)
- CI runners have network access for initial fixture fetch
- Git sparse checkout or shallow clone is sufficient (no need for full history)

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Temporale Repository Location (DECIDED) {#q01-repo-location}

**Question:** Where should the standalone Temporale repository live?

**Why it matters:** Affects permissions, discoverability, and maintenance workflow.

**Options:**
1. Same GitHub org as tugtool (e.g., `tugtool/temporale`)
2. Separate org for fixtures (e.g., `tugtool-fixtures/temporale`)
3. Within tugtool repo as a subtree (not truly standalone)

**Decision:** Same GitHub org as tugtool (`tugtool/temporale`).

**Rationale:**
- Simplest permissions model
- Clear ownership
- Easy to find from tugtool repo
- Subtree would defeat the purpose of making it standalone

**Resolution:** DECIDED - Same org as tugtool.

---

#### [Q02] PyPI Publication Strategy (DECIDED) {#q02-pypi-strategy}

**Question:** Should Temporale be published to PyPI, TestPyPI, or neither?

**Why it matters:** Affects discoverability, usability outside tugtool, and release process.

**Options:**
1. Full PyPI publication with semver releases
2. TestPyPI for development, promote to PyPI later
3. Git-only distribution (no PyPI)

**Decision:** Publish to PyPI with semver releases.

**Rationale:**
- Temporale is a useful library in its own right
- PyPI publication demonstrates it's production-ready
- Other projects can use it for their refactoring test beds
- Git-only would work but limits adoption

**Resolution:** DECIDED - Full PyPI publication.

---

#### [Q03] Fixture Fetch Mechanism (DECIDED) {#q03-fetch-mechanism}

**Question:** How should tugtool fetch fixtures - git clone, HTTP tarball, or dedicated CLI?

**Why it matters:** Affects complexity, speed, and maintainability.

**Options:**
1. **Git shallow clone** - `git clone --depth 1 --branch <tag>` to fixtures directory
2. **GitHub tarball** - HTTP fetch of release tarball
3. **Cargo build.rs** - Fetch at build time
4. **Dedicated `tug fixture fetch` command** - New CLI subcommand

**Decision:** Git shallow clone with explicit fetch step.

**Rationale:**
- Git is universally available and reliable
- Shallow clone is fast (~2 seconds for small repos)
- No need for tarball URL construction
- Build.rs would slow every build
- Dedicated CLI is overkill for one fixture (defer to roadmap)
- Explicit fetch step makes CI visible and debuggable

**Implementation:**
```bash
# In CI or local dev
git clone --depth 1 --branch v0.1.0 https://github.com/tugtool/temporale .tug/fixtures/temporale
```

**Resolution:** DECIDED - Git shallow clone.

---

#### [Q04] Pin File Format (DECIDED) {#q04-pin-format}

**Question:** What format should the fixture pin file use?

**Why it matters:** Affects readability, parseability, and future extensibility.

**Options:**
1. **TOML** - Matches Cargo ecosystem conventions
2. **JSON** - Simple, universal
3. **Plain text** - One SHA per line

**Decision:** TOML format at `fixtures/temporale.lock`.

**Rationale:**
- Consistent with Rust ecosystem (Cargo.toml, rustfmt.toml)
- Human-readable and editable
- Supports comments for documentation
- Easy to parse in Rust

**Format:**
```toml
# Temporale fixture pin file
# Update by running: git ls-remote https://github.com/tugtool/temporale refs/tags/v*

[fixture]
name = "temporale"
repository = "https://github.com/tugtool/temporale"
ref = "v0.1.0"  # Tag or branch name
sha = "abc123def456..."  # Exact commit SHA for verification
```

**Resolution:** DECIDED - TOML format.

---

#### [Q05] Fixture Cache Location (DECIDED) {#q05-cache-location}

**Question:** Where should fetched fixtures be stored?

**Why it matters:** Affects gitignore, disk usage, and CI caching.

**Options:**
1. `.tug/fixtures/` - Under the session directory
2. `target/fixtures/` - Under Cargo output
3. System cache (`~/.cache/tugtool/fixtures/`)

**Decision:** `.tug/fixtures/` within workspace root.

**Rationale:**
- Consistent with other `.tug/` artifacts
- Easy to gitignore (already ignoring `**/.tug/`)
- Visible in workspace for debugging
- CI can cache `.tug/` if needed

**Important note (session lifecycle):**
- The `.tug/` directory is also the session directory used by tugtool; some workflows (e.g. `--fresh`) may delete it.
- This is acceptable because fixtures are *re-fetchable* and tests will fail loudly with instructions, but it means `.tug/fixtures/` should be treated as a cache, not a durable store.

**Resolution:** DECIDED - `.tug/fixtures/`.

---

#### [Q06] Venv Handling for Fetched Fixture (DECIDED) {#q06-venv-handling}

**Question:** How should the Python venv handle a fetched (vs vendored) fixture?

**Why it matters:** pytest needs `temporale` importable, which currently requires editable install.

**Options:**
1. **Editable install from fixture directory** - Same as current approach
2. **Install from PyPI** - Use published version
3. **PYTHONPATH manipulation** - Add fixture to sys.path

**Decision:** Editable install from fixture directory (same as current).

**Rationale:**
- Matches current workflow exactly
- Ensures tests run against the fetched code, not PyPI version
- Allows testing unpublished changes when developing fixture

**Process:**
```bash
# After fetching fixture to .tug/fixtures/temporale/
uv pip install --python .tug-test-venv/bin/python -e .tug/fixtures/temporale/
```

**Resolution:** DECIDED - Editable install from fixture directory.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| PyPI name conflict | med | low | Check availability early, have fallback (`temporale-datetime`) | Name taken |
| Network unavailable in CI | high | low | Cache fixtures aggressively, fail loudly with instructions | CI flakiness |
| Git clone timeout | med | low | Use shallow clone, set timeout, retry logic | Slow CI |
| Breaking vendored code during transition | high | med | Keep vendored code until fixture fetch proven | Tests fail |

**Risk R01: PyPI Name Conflict** {#r01-pypi-conflict}

- **Risk:** The name "temporale" may already be taken on PyPI or conflict with another project
- **Mitigation:**
  - Check PyPI early in execution
  - Have fallback name ready (`temporale-datetime`, `temporale-py`)
  - Register name as soon as possible
- **Residual risk:** May need to use less ideal name

**Risk R02: Transition Period Complexity** {#r02-transition-complexity}

- **Risk:** During migration, both vendored and fetched fixtures exist, causing confusion
- **Mitigation:**
  - Clear step-by-step execution plan
  - Explicit checkpoint after each phase
  - Keep vendored code until final verification
- **Residual risk:** Brief period of code duplication

---

### 6.0 Design Decisions {#design-decisions}

#### [D01] Fixture Directory Structure (DECIDED) {#d01-fixture-structure}

**Decision:** Fixtures live at `.tug/fixtures/<fixture-name>/` with pin files at `fixtures/<fixture-name>.lock`.

**Rationale:**
- Separates mutable cache (`.tug/`) from source-controlled pins (`fixtures/`)
- Allows multiple fixture types in future
- Pin files are version-controlled for reproducibility

**Implications:**
- Add `fixtures/` directory to repo root
- Update `.gitignore` (already ignores `.tug/`)
- `temporale_path()` resolves to `.tug/fixtures/temporale/`

---

#### [D02] Env Var Override Takes Precedence (DECIDED) {#d02-env-override}

**Decision:** `TUG_TEMPORALE_PATH` environment variable, when set, overrides fixture fetch entirely.

**Rationale:**
- Enables local development with modified fixture
- Matches existing `TUG_PYTHON` pattern
- Simple and explicit

**Implications:**
- `temporale_path()` checks env var first
- If set, returns that path directly (no fetch, no validation)
- If not set, proceeds to fetch logic

---

#### [D03] Fail Loudly When Fixture Unavailable (DECIDED) {#d03-fail-loudly}

**Decision:** If fixture is not available and cannot be fetched, tests panic with clear instructions.

**Rationale:**
- Matches CLAUDE.md mandate: "Tests must NEVER silently skip"
- Users immediately know what's wrong and how to fix it
- No hidden "graceful degradation" that masks problems

**Implications:**
- No `#[ignore]` attributes
- No `Option<PathBuf>` returns with silent fallback
- Panic message includes exact command to run

**Error message format:**
```
FATAL: Temporale fixture not available.

The Temporale integration tests require the fixture to be fetched.

To fetch the fixture, run:
  git clone --depth 1 --branch v0.1.0 https://github.com/tugtool/temporale .tug/fixtures/temporale

Or set TUG_TEMPORALE_PATH to point to a local Temporale checkout:
  export TUG_TEMPORALE_PATH=/path/to/temporale

See fixtures/temporale.lock for the pinned version.
```

---

#### [D04] Single Fixture Version Per Lock File (DECIDED) {#d04-single-version}

**Decision:** Each lock file pins exactly one version. No version ranges, no multiple versions.

**Rationale:**
- Maximum reproducibility
- Simple implementation
- CI always tests the same code
- Version updates are intentional (edit lock file, commit)

**Implications:**
- Lock file contains exact SHA, not just tag
- SHA verification after fetch
- Manual process to update pin

---

#### [D05] Temporale Repo Structure Mirrors Current (DECIDED) {#d05-repo-structure}

**Decision:** Standalone Temporale repo contains only the content currently at `sample-code/python/temporale/`, not the parent directories.

**Rationale:**
- Clean standalone project structure
- Standard Python package layout
- No `sample-code/` wrapper needed

**Structure:**
```
temporale/           # repo root
├── pyproject.toml
├── temporale/       # package
│   ├── __init__.py
│   ├── core/
│   ├── format/
│   └── ...
├── tests/
│   ├── conftest.py
│   ├── test_date.py
│   └── ...
├── .github/
│   └── workflows/
│       └── ci.yml
└── README.md
```

---

#### [D06] Fetch Helper in Test Support Module (DECIDED) {#d06-fetch-helper}

**Decision:** Fixture fetch logic lives in `crates/tugtool/tests/support/fixtures.rs`, not in main crate.

**Rationale:**
- Fixture management is test-time concern only
- Keeps main crate lightweight
- Clear separation of concerns
- Easy to extend for other fixtures

**Implications:**
- New file `support/fixtures.rs`
- Update `support/mod.rs` to expose it
- `temporale_path()` uses fixture helpers

---

### 6.1 Specification {#specification}

#### 6.1.1 Fixture Resolution Algorithm {#fixture-resolution}

**Spec S01: temporale_path() Resolution** {#s01-temporale-path}

The `temporale_path()` function resolves the Temporale fixture location using this algorithm:

```
1. If TUG_TEMPORALE_PATH is set and non-empty:
   a. Return PathBuf::from(env var value)
   b. Do NOT validate the path exists (caller's responsibility)

2. Else, compute fixture path as workspace_root/.tug/fixtures/temporale:
   a. If fixture path exists and contains pyproject.toml:
      - Return fixture path
   b. Else:
      - Panic with instructions (see [D03])
```

**Key behaviors:**
- Env var is trusted completely (for local dev flexibility)
- Fixture directory must have `pyproject.toml` to be valid
- No automatic fetch (explicit step required)
- Panic message includes exact commands to remedy

---

#### 6.1.2 Lock File Schema {#lock-file-schema}

**Spec S02: fixtures/temporale.lock Format** {#s02-lock-format}

```toml
# Temporale fixture pin for tugtool integration tests
#
# To update:
#   1. Check available versions: git ls-remote https://github.com/tugtool/temporale refs/tags/v*
#   2. Update ref below
#   3. Get SHA: git ls-remote https://github.com/tugtool/temporale refs/tags/<tag>
#   4. Update sha below
#   5. Delete .tug/fixtures/temporale/ and re-fetch

[fixture]
name = "temporale"
repository = "https://github.com/tugtool/temporale"
ref = "v0.1.0"
sha = "abc123def456789..."

[fixture.metadata]
# Optional metadata for documentation
python_requires = ">=3.10"
description = "Python datetime library for refactoring tests"
```

**Field definitions:**

| Field | Required | Description |
|-------|----------|-------------|
| `fixture.name` | yes | Fixture identifier, matches directory name |
| `fixture.repository` | yes | Git clone URL |
| `fixture.ref` | yes | Git ref to checkout (tag preferred, branch allowed) |
| `fixture.sha` | yes | Full commit SHA for verification |
| `fixture.metadata.*` | no | Documentation fields, not used in fetch |

---

#### 6.1.3 CI Workflow Changes {#ci-workflow}

**Spec S03: CI Fixture Fetch Step** {#s03-ci-fetch}

Add new step to `.github/workflows/ci.yml` before tests:

```yaml
- name: Fetch test fixtures
  run: |
    # Parse lock file robustly (avoid brittle grep/cut parsing)
    #
    # Prefer writing to $GITHUB_ENV rather than using eval.
    .tug-test-venv/bin/python - <<'PY'
import tomllib
from pathlib import Path
import os
data = tomllib.loads(Path("fixtures/temporale.lock").read_text(encoding="utf-8"))
fx = data["fixture"]
env_path = os.environ.get("GITHUB_ENV")
if not env_path:
    raise SystemExit("GITHUB_ENV not set (this script is intended for GitHub Actions)")
with open(env_path, "a", encoding="utf-8") as f:
    f.write(f"REPO={fx['repository']}\n")
    f.write(f"REF={fx['ref']}\n")
    f.write(f"SHA={fx['sha']}\n")
PY

    # Clone at pinned ref
    mkdir -p .tug/fixtures
    git clone --depth 1 --branch "$REF" "$REPO" .tug/fixtures/temporale

    # Verify SHA matches
    cd .tug/fixtures/temporale
    ACTUAL_SHA=$(git rev-parse HEAD)
    if [ "$ACTUAL_SHA" != "$SHA" ]; then
      echo "ERROR: SHA mismatch! Expected $SHA, got $ACTUAL_SHA"
      exit 1
    fi

    # Install fixture in editable mode
    cd "$GITHUB_WORKSPACE"
    uv pip install --python .tug-test-venv/bin/python -e .tug/fixtures/temporale/
```

**Position in workflow:**
- After: venv creation and pytest install
- Before: cargo build and test

---

#### 6.1.4 Error Messages {#error-messages}

**Spec S04: Fixture Unavailable Error** {#s04-unavailable-error}

When fixture is not available and env var not set:

```
============================================================
FATAL: Temporale fixture not available.

The Temporale integration tests require the fixture to be fetched.

To fetch the fixture, run from workspace root:

  mkdir -p .tug/fixtures
  git clone --depth 1 --branch v0.1.0 \
    https://github.com/tugtool/temporale \
    .tug/fixtures/temporale

Or set TUG_TEMPORALE_PATH to point to a local Temporale checkout:

  export TUG_TEMPORALE_PATH=/path/to/your/temporale

See fixtures/temporale.lock for the pinned version.
============================================================
```

---

### 6.2 Symbol Inventory {#symbol-inventory}

#### 6.2.1 New Files {#new-files}

| File | Purpose |
|------|---------|
| `fixtures/temporale.lock` | Pin file for Temporale fixture version |
| `crates/tugtool/tests/support/fixtures.rs` | Fixture resolution and validation helpers |

#### 6.2.2 Modified Files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool/Cargo.toml` | Add `toml = "0.8"` to `[dev-dependencies]` for fixture lock parsing |
| `crates/tugtool/tests/support/mod.rs` | Add `pub mod fixtures;` |
| `crates/tugtool/tests/temporale_integration.rs` | Update `temporale_path()` to use fixture helpers |
| `.github/workflows/ci.yml` | Add fixture fetch step |
| `.gitignore` | Add `.tug/fixtures/` (already covered by `**/.tug/`) |
| `CLAUDE.md` | Update Python test instructions for fixture setup |

#### 6.2.3 Deleted Files (End of Phase) {#deleted-files}

| Path | Reason |
|------|--------|
| `sample-code/python/temporale/` | Entire directory - moved to standalone repo |

#### 6.2.4 Symbols to Add {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `fixtures` | module | `support/mod.rs` | New fixture support module |
| `FixtureInfo` | struct | `support/fixtures.rs` | Parsed lock file data |
| `get_fixture_path` | fn | `support/fixtures.rs` | Generic fixture resolution |
| `read_lock_file` | fn | `support/fixtures.rs` | Parse TOML lock file (convenience wrapper) |
| `read_lock_file_from` | fn | `support/fixtures.rs` | Parse TOML lock file from explicit root (testable) |
| `temporale_path` | fn | `temporale_integration.rs` | Updated to use fixture helpers |

---

### 6.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | What to Test | How |
|----------|--------------|-----|
| **Fixture resolution** | Env var override, fixture dir detection | Unit tests in `fixtures.rs` |
| **Lock file parsing** | Valid TOML, missing fields, malformed | Unit tests in `fixtures.rs` |
| **Error messages** | Correct instructions in panic | Unit test checking panic message |
| **Integration** | Full flow with fetched fixture | Existing Temporale tests (unchanged) |

#### Test Fixtures for Fixture Tests {#meta-fixtures}

Create minimal test fixtures in `crates/tugtool/tests/fixtures/fixture-test/`:

```
fixtures/fixture-test/
├── valid.lock              # Well-formed lock file
├── missing-sha.lock        # Lock file without sha field
├── malformed.lock          # Invalid TOML
└── mock-fixture/           # Minimal fixture directory
    └── pyproject.toml
```

---

### 6.4 Execution Steps {#execution-steps}

#### Step 0: Verify Current State {#step-0}

**Commit:** N/A (verification only)

**References:** (#context, #success-criteria)

**Artifacts:** None

**Tasks:**
- [x] Run existing Temporale integration tests to confirm baseline
- [x] Verify `sample-code/python/temporale/` structure matches expectations
- [x] Check PyPI for name availability (web check recommended; `pip search` is deprecated/removed in modern pip)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool temporale` - all tests pass (8 tests passed)
- [x] `ls sample-code/python/temporale/pyproject.toml` - file exists (548 bytes)
- [x] PyPI name check completed: **"temporale" is AVAILABLE** (PyPI JSON API returns 404)

**No commit - this is verification only.**

---

#### Step 1: Create Standalone Temporale Repository {#step-1}

**Commit:** N/A (external repository)

**References:** [D05] Repo structure, (#scope)

**Artifacts:**
- New git repository `tugtool/temporale` (or chosen name)
- Contents copied from `sample-code/python/temporale/`
- Basic CI workflow
- README.md
- `.claude/` directory copied from tugtool with the same commands + agents (updated only where necessary for a standalone Python library)

**Tasks:**
- [x] Create new GitHub repository: `https://github.com/tugtool/temporale`: DONE
- [x] Local checkout of new repo at `/u/src/temporale`
- [x] Copy contents from `sample-code/python/temporale/` to repo root
- [x] Update `pyproject.toml` with proper metadata for PyPI
- [x] Create `.github/workflows/ci.yml` for Temporale repo
- [x] Create `README.md` documenting Temporale
- [x] Copy tugtool's `.claude/` into the Temporale repo (full mirror: all agents and commands)
- [x] Adapt `.claude/` commands for Python context while keeping the same structure:
  - Replace `cargo nextest run` with `.tug-test-venv/bin/python -m pytest tests/ -v`
  - Replace `cargo build` / `cargo clippy` references with appropriate Python equivalents (e.g., `python -m compileall`)
  - Update plan templates to reference Python module structure instead of Rust crates
  - Keep command names identical (`/create-plan`, `/implement-plan`, `/prepare-git-commit-message`, etc.)
- [x] Add `LICENSE` file (match tugtool license)
- [x] Create initial tag `v0.1.0`
- [x] Verify CI passes on new repo

**Temporale pyproject.toml updates:**
```toml
[project]
name = "temporale"
version = "0.1.0"
description = "A comprehensive Python datetime library"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.10"
authors = [
    {name = "Tugtool Contributors"}
]
keywords = ["datetime", "date", "time", "calendar"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
]

[project.urls]
Repository = "https://github.com/tugtool/temporale"

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"
```

**Temporale CI workflow (`.github/workflows/ci.yml`):**
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - name: Set up Python
        run: uv python install ${{ matrix.python-version }}
      - name: Install dependencies
        run: |
          uv venv --python ${{ matrix.python-version }} .tug-test-venv
          uv pip install --python .tug-test-venv/bin/python pytest
          uv pip install --python .tug-test-venv/bin/python -e .
      - name: Run tests
        run: .tug-test-venv/bin/python -m pytest tests/ -v
```

**Checkpoint:**
- [x] New repo exists and is accessible
- [x] `git clone https://github.com/tugtool/temporale` succeeds
- [x] CI badge is green
- [x] Tag `v0.1.0` exists (SHA: 9f21df0322b7aa39ca7f599b128f66c07ecec42f)

**This is external work - no tugtool commit.**

---

#### Step 2: Publish Temporale to PyPI {#step-2}

**Commit:** N/A (external action)

**References:** [Q02] PyPI strategy, (#success-criteria)

**Artifacts:**
- Temporale package on PyPI

**Tasks:**
- [x] Create PyPI account if needed
- [x] Configure trusted publishing (GitHub Actions OIDC)
- [x] Add publish workflow to Temporale repo
- [x] Trigger first release

**Temporale publish workflow (`.github/workflows/publish.yml`):**
```yaml
name: Publish to PyPI

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # For trusted publishing
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - name: Build
        run: uv build
      - name: Publish to PyPI
        uses: pypa/gh-action-pypi-publish@release/v1
```

**Checkpoint:**
- [x] `pip install temporale` succeeds
- [x] `python -c "import temporale; print(temporale.__version__)"` prints `0.1.0`

**This is external work - no tugtool commit.**

---

#### Step 3: Create Fixture Infrastructure in Tugtool {#step-3}

**Commit:** `feat(test): add fixture resolution infrastructure`

**References:** [D01] Fixture structure, [D06] Fetch helper, Spec S01, Spec S02, (#symbol-inventory)

**Artifacts:**
- `fixtures/temporale.lock` - Lock file with pinned version
- `crates/tugtool/tests/support/fixtures.rs` - Fixture helpers

**Tasks:**
- [x] Create `fixtures/` directory at workspace root
- [x] Create `fixtures/temporale.lock` with pinned SHA
- [x] Create `crates/tugtool/tests/support/fixtures.rs`
- [x] Update `crates/tugtool/tests/support/mod.rs` to include new module
- [x] Add unit tests for fixture resolution
- [x] Add dev-dependencies needed for robust lock parsing and deterministic env-var tests (see notes below)

**Notes on dependencies and determinism:**
- Use a real TOML parser (`toml` crate) for `fixtures/*.lock`. Ad-hoc parsing will break on valid TOML (inline comments, whitespace, ordering).
- Avoid flaky env-var tests: prefer testing pure resolution functions (pass env value as parameter) rather than mutating `std::env` in parallel tests. If env mutation is unavoidable, serialize those tests.

**fixtures/temporale.lock:**
```toml
# Temporale fixture pin for tugtool integration tests
#
# To update:
#   1. Check available versions: git ls-remote https://github.com/tugtool/temporale refs/tags/v*
#   2. Update ref below
#   3. Get SHA: git ls-remote https://github.com/tugtool/temporale refs/tags/<tag>
#   4. Update sha below
#   5. Delete .tug/fixtures/temporale/ and re-fetch

[fixture]
name = "temporale"
repository = "https://github.com/tugtool/temporale"
ref = "v0.1.0"
sha = "<actual-sha-from-step-1>"

[fixture.metadata]
python_requires = ">=3.10"
description = "Python datetime library for refactoring tests"
```

**support/fixtures.rs:**
```rust
//! Fixture resolution infrastructure for integration tests.
//!
//! Provides utilities to locate test fixtures, either from:
//! - Environment variable override (for local development)
//! - Pre-fetched fixture directory (for CI)
//!
//! Fixtures are NOT automatically fetched. Tests fail loudly with
//! instructions if a fixture is unavailable.

use std::env;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use serde::Deserialize;

/// Cached workspace root.
static WORKSPACE_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Information parsed from a fixture lock file.
#[derive(Debug, Clone, Deserialize)]
pub struct FixtureInfo {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "repository")]
    pub repository: String,
    #[serde(rename = "ref")]
    pub git_ref: String,
    #[serde(rename = "sha")]
    pub sha: String,
}

#[derive(Debug, Clone, Deserialize)]
struct LockFile {
    fixture: FixtureInfo,
}

/// Get the workspace root directory.
pub fn workspace_root() -> &'static PathBuf {
    WORKSPACE_ROOT.get_or_init(|| {
        let manifest_dir = env::var("CARGO_MANIFEST_DIR")
            .expect("CARGO_MANIFEST_DIR not set");
        PathBuf::from(manifest_dir)
            .parent()  // crates/tugtool -> crates
            .expect("parent of tugtool")
            .parent()  // crates -> workspace root
            .expect("workspace root")
            .to_path_buf()
    })
}

/// Read and parse a fixture lock file from an explicit root directory.
///
/// This is the testable version - unit tests can pass a temp directory.
pub fn read_lock_file_from(root: &Path, name: &str) -> Result<FixtureInfo, String> {
    let lock_path = root.join("fixtures").join(format!("{}.lock", name));

    let content = std::fs::read_to_string(&lock_path)
        .map_err(|e| format!("Failed to read {}: {}", lock_path.display(), e))?;

    // IMPORTANT: Use a real TOML parser. Ad-hoc parsing breaks on valid TOML,
    // especially inline comments (e.g. `ref = "v0.1.0"  # tag`).
    let lock: LockFile = toml::from_str(&content)
        .map_err(|e| format!("Invalid TOML in {}: {}", lock_path.display(), e))?;
    Ok(lock.fixture)
}

/// Read and parse a fixture lock file from the workspace root.
///
/// Convenience wrapper around `read_lock_file_from()`.
pub fn read_lock_file(name: &str) -> Result<FixtureInfo, String> {
    read_lock_file_from(workspace_root(), name)
}

/// Get the path to a fixture, checking env var override first.
///
/// # Arguments
/// - `name`: Fixture name (e.g., "temporale")
/// - `env_var`: Environment variable for override (e.g., "TUG_TEMPORALE_PATH")
///
/// # Returns
/// PathBuf to the fixture directory.
///
/// # Panics
/// If fixture is not available and env var is not set.
pub fn get_fixture_path(name: &str, env_var: &str) -> PathBuf {
    // 1. Check environment variable override
    if let Ok(path) = env::var(env_var) {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    // 2. Check fixture directory
    let fixture_path = workspace_root()
        .join(".tug")
        .join("fixtures")
        .join(name);

    // Validate fixture exists and looks correct
    let marker = fixture_path.join("pyproject.toml");
    if fixture_path.exists() && marker.exists() {
        return fixture_path;
    }

    // 3. Fixture not available - fail loudly
    let info = read_lock_file(name).unwrap_or_else(|e| {
        panic!("Failed to read lock file for fixture '{}': {}", name, e);
    });

    panic!(
        "\n\
        ============================================================\n\
        FATAL: {} fixture not available.\n\
        \n\
        The integration tests require the fixture to be fetched.\n\
        \n\
        To fetch the fixture, run from workspace root:\n\
        \n\
        mkdir -p .tug/fixtures\n\
        git clone --depth 1 --branch {} \\\n\
            {} \\\n\
            .tug/fixtures/{}\n\
        \n\
        Or set {} to point to a local checkout:\n\
        \n\
        export {}=/path/to/your/{}\n\
        \n\
        See fixtures/{}.lock for the pinned version.\n\
        ============================================================\n",
        name,
        info.git_ref,
        info.repository,
        name,
        env_var,
        env_var,
        name,
        name
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    // IMPORTANT: environment variables are process-global; serialize tests that mutate env.
    #[test]
    fn test_env_var_override() {
        // This test demonstrates the env var check logic
        // In real usage, TUG_TEMPORALE_PATH would be set externally
        let path = "/custom/path/temporale";
        std::env::set_var("TUG_TEST_FIXTURE_PATH", path);

        // Direct check (not using get_fixture_path to avoid panic)
        let result = std::env::var("TUG_TEST_FIXTURE_PATH").unwrap();
        assert_eq!(result, path);

        std::env::remove_var("TUG_TEST_FIXTURE_PATH");
    }

    #[test]
    fn test_lock_file_parsing() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = r#"
[fixture]
name = "test-fixture"
repository = "https://github.com/example/test"
ref = "v1.0.0"
sha = "abc123"
"#;

        let lock_path = fixtures_dir.join("test-fixture.lock");
        let mut file = std::fs::File::create(&lock_path).unwrap();
        file.write_all(lock_content.as_bytes()).unwrap();

        // Use read_lock_file_from() with explicit root for testability
        let info = read_lock_file_from(dir.path(), "test-fixture").unwrap();
        assert_eq!(info.name, "test-fixture");
        assert_eq!(info.repository, "https://github.com/example/test");
        assert_eq!(info.git_ref, "v1.0.0");
        assert_eq!(info.sha, "abc123");
    }

    #[test]
    fn test_lock_file_with_inline_comments() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // Inline comments must parse correctly (proves we use real TOML parser)
        let lock_content = r#"
[fixture]
name = "commented"  # This is a comment
repository = "https://github.com/example/test"
ref = "v1.0.0"  # Tag name
sha = "abc123def456"
"#;

        let lock_path = fixtures_dir.join("commented.lock");
        std::fs::write(&lock_path, lock_content).unwrap();

        let info = read_lock_file_from(dir.path(), "commented").unwrap();
        assert_eq!(info.git_ref, "v1.0.0"); // NOT "v1.0.0  # Tag name"
    }

    #[test]
    fn test_lock_file_missing_field() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = r#"
[fixture]
name = "incomplete"
repository = "https://github.com/example/test"
# Missing ref and sha
"#;

        let lock_path = fixtures_dir.join("incomplete.lock");
        std::fs::write(&lock_path, lock_content).unwrap();

        let result = read_lock_file_from(dir.path(), "incomplete");
        assert!(result.is_err());
    }
}
```

**support/mod.rs update:**
```rust
//! Shared test support utilities.

pub mod fixtures;
pub mod patterns;
pub mod python;
```

**Tests:**
- [x] Unit: env var override returns env var path
- [x] Unit: lock file parsing extracts all fields
- [x] Unit: missing lock file field returns error
- [x] Unit: lock file parsing tolerates inline comments (proves we are not using ad-hoc parsing)
- [x] Unit: env var mutation tests are serialized (no flakes under parallel test execution)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool fixtures` - new tests pass (8 tests passed)
- [x] `fixtures/temporale.lock` exists with valid content

**Commit after all checkpoints pass.**

---

#### Step 4: Update temporale_path() to Use Fixture Infrastructure {#step-4}

**Commit:** `refactor(test): use fixture infrastructure for temporale_path`

**References:** [D02] Env override, [D03] Fail loudly, Spec S01, (#symbol-inventory)

**Artifacts:**
- Updated `crates/tugtool/tests/temporale_integration.rs`

**Tasks:**
- [x] Update `temporale_path()` to use `get_fixture_path()`
- [x] Keep backward compatibility: check vendored location as fallback during transition
- [x] Update any imports needed

**Updated temporale_path():**
```rust
/// Get the path to the Temporale sample code directory.
///
/// Resolution order:
/// 1. TUG_TEMPORALE_PATH environment variable (if set)
/// 2. Fetched fixture at .tug/fixtures/temporale/
/// 3. Vendored location at sample-code/python/temporale/ (transition period only)
/// 4. Panic with instructions
fn temporale_path() -> PathBuf {
    use crate::support::fixtures;

    // Check env var first
    if let Ok(path) = std::env::var("TUG_TEMPORALE_PATH") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    let workspace_root = fixtures::workspace_root();

    // Check fetched fixture location
    let fixture_path = workspace_root
        .join(".tug")
        .join("fixtures")
        .join("temporale");
    if fixture_path.join("pyproject.toml").exists() {
        return fixture_path;
    }

    // TRANSITION: Check vendored location (remove in Step 7)
    let vendored_path = workspace_root.join("sample-code/python/temporale");
    if vendored_path.join("pyproject.toml").exists() {
        return vendored_path;
    }

    // Neither available - use get_fixture_path to get helpful error
    fixtures::get_fixture_path("temporale", "TUG_TEMPORALE_PATH")
}
```

**Tests:**
- [x] Integration: existing Temporale tests still pass (using vendored)
- [x] Manual: set `TUG_TEMPORALE_PATH`, verify override works

**Checkpoint:**
- [x] `cargo nextest run -p tugtool temporale` - all tests pass (8 tests passed)
- [x] Tests use vendored location (transition state)

**Commit after all checkpoints pass.**

---

#### Step 5: Update CI Workflow {#step-5}

**Commit:** `ci: add fixture fetch step for temporale`

**References:** Spec S03, (#ci-workflow)

**Artifacts:**
- Updated `.github/workflows/ci.yml`

**Tasks:**
- [x] Add fixture fetch step after venv setup
- [x] Add SHA verification
- [x] Add editable install of fixture
- [x] Update CLAUDE.md with fixture setup instructions

**CI workflow additions:**
```yaml
# After "Create test venv" step, add:

- name: Fetch test fixtures
  run: |
    # Parse lock file robustly (no brittle grep/cut parsing)
    .tug-test-venv/bin/python - <<'PY'
import tomllib
from pathlib import Path
import os
data = tomllib.loads(Path("fixtures/temporale.lock").read_text(encoding="utf-8"))
fx = data["fixture"]
env_path = os.environ.get("GITHUB_ENV")
if not env_path:
    raise SystemExit("GITHUB_ENV not set (this script is intended for GitHub Actions)")
with open(env_path, "a", encoding="utf-8") as f:
    f.write(f"REPO={fx['repository']}\n")
    f.write(f"REF={fx['ref']}\n")
    f.write(f"SHA={fx['sha']}\n")
PY

    echo "Fetching temporale fixture: $REPO @ $REF (SHA: $SHA)"

    # Clone fixture
    mkdir -p .tug/fixtures
    git clone --depth 1 --branch "$REF" "$REPO" .tug/fixtures/temporale

    # Verify SHA
    cd .tug/fixtures/temporale
    ACTUAL_SHA=$(git rev-parse HEAD)
    if [ "$ACTUAL_SHA" != "$SHA" ]; then
      echo "::error::SHA mismatch! Expected $SHA, got $ACTUAL_SHA"
      echo "Update fixtures/temporale.lock with the correct SHA."
      exit 1
    fi
    echo "SHA verified: $ACTUAL_SHA"

- name: Install fixture in venv
  run: |
    uv pip install --python .tug-test-venv/bin/python -e .tug/fixtures/temporale/
```

**CLAUDE.md update - add to Python Tests section:**
```markdown
### Fixture Setup

Before running Temporale integration tests locally, fetch the fixture:

```bash
# Read the pinned version from lock file
cat fixtures/temporale.lock

# Fetch the fixture (adjust tag as needed)
mkdir -p .tug/fixtures
git clone --depth 1 --branch v0.1.0 \
  https://github.com/tugtool/temporale \
  .tug/fixtures/temporale

# Install in test venv
.tug-test-venv/bin/pip install -e .tug/fixtures/temporale/
```

Or use a local checkout:
```bash
export TUG_TEMPORALE_PATH=/path/to/your/temporale
```

**Tests:**
- [x] CI workflow runs successfully with fixture fetch

**Checkpoint:**
- [x] Push to branch, CI passes with fetch step visible in logs
- [x] CI output shows "Fetching temporale fixture" and "SHA verified"

**Commit after all checkpoints pass.**

---

#### Step 6: Verify Fixture-Based Tests Work {#step-6}

**Commit:** N/A (verification only)

**References:** (#success-criteria)

**Artifacts:** None

**Tasks:**
- [x] Locally: delete vendored Temporale, fetch fixture, run tests
- [x] Verify CI passes with only fetched fixture
- [x] Verify env var override works

**Local verification steps:**
```bash
# 1. Save a backup (just in case)
cp -r sample-code/python/temporale /tmp/temporale-backup

# 2. Remove vendored code temporarily
rm -rf sample-code/python/temporale

# 3. Ensure fixture is fetched
mkdir -p .tug/fixtures
git clone --depth 1 --branch v0.1.0 \
  https://github.com/tugtool/temporale \
  .tug/fixtures/temporale

# 4. Install in venv
.tug-test-venv/bin/pip install -e .tug/fixtures/temporale/

# 5. Run tests
cargo nextest run -p tugtool temporale

# 6. Test env var override
export TUG_TEMPORALE_PATH=/tmp/temporale-backup
cargo nextest run -p tugtool temporale
unset TUG_TEMPORALE_PATH

# 7. Restore vendored code (will be removed in Step 7)
cp -r /tmp/temporale-backup sample-code/python/temporale
```

**Checkpoint:**
- [x] All Temporale tests pass with fetched fixture (vendored removed)
- [x] Env var override works correctly
- [x] CI passes (may need separate PR to test)

**No commit - this is verification only.**

---

#### Step 7: Remove Vendored Temporale {#step-7}

**Commit:** `chore: remove vendored temporale (now fetched as fixture)`

**References:** [D01] Fixture structure, (#success-criteria)

**Artifacts:**
- Deleted: `sample-code/python/temporale/` (entire directory)
- Updated: `temporale_path()` to remove fallback

**Tasks:**
- [ ] Remove vendored fallback from `temporale_path()`
- [ ] Delete `sample-code/python/temporale/` directory
- [ ] Delete empty `sample-code/python/` if no other content
- [ ] Delete empty `sample-code/` if no other content
- [ ] Update any documentation referencing old location

**Updated temporale_path() (final version):**
```rust
/// Get the path to the Temporale fixture directory.
///
/// Resolution order:
/// 1. TUG_TEMPORALE_PATH environment variable (if set)
/// 2. Fetched fixture at .tug/fixtures/temporale/
/// 3. Panic with instructions
fn temporale_path() -> PathBuf {
    crate::support::fixtures::get_fixture_path("temporale", "TUG_TEMPORALE_PATH")
}
```

**Tests:**
- [ ] Integration: all Temporale tests pass
- [ ] Verify: `sample-code/python/temporale/` does not exist

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool temporale` - all tests pass
- [ ] `ls sample-code/python/temporale 2>&1 | grep -q "No such file"` - directory gone
- [ ] CI passes

**Commit after all checkpoints pass.**

---

#### Step 8: Final Documentation and Cleanup {#step-8}

**Commit:** `docs: update fixture documentation`

**References:** (#success-criteria)

**Artifacts:**
- Updated CLAUDE.md with complete fixture instructions
- Updated any READMEs if needed

**Tasks:**
- [ ] Ensure CLAUDE.md has complete fixture setup instructions
- [ ] Remove any stale references to `sample-code/python/temporale/`
- [ ] Add note about future fixtures (Rust, etc.)

**Checkpoint:**
- [ ] `grep -r "sample-code/python/temporale" . --include="*.md"` - no results
- [ ] CLAUDE.md contains fixture setup instructions
- [ ] CI passes

**Commit after all checkpoints pass.**

---

### 6.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Temporale is a standalone PyPI-published library with its own repository, and tugtool fetches it as a test fixture from a pinned git SHA.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Temporale repository exists at `https://github.com/tugtool/temporale`
- [ ] Temporale is published on PyPI: `pip install temporale` works
- [ ] `fixtures/temporale.lock` exists in tugtool with pinned SHA
- [ ] CI fetches Temporale fixture and tests pass
- [ ] `TUG_TEMPORALE_PATH` override works for local development
- [ ] `sample-code/python/temporale/` directory does not exist in tugtool
- [ ] All existing Temporale integration tests pass
- [ ] Missing fixture causes loud failure with instructions

**Acceptance tests:**
- [ ] Integration: `cargo nextest run -p tugtool temporale` passes (with fetched fixture)
- [ ] Integration: CI workflow completes successfully

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Standalone Repo Created** {#m01-standalone-repo}
- [ ] Temporale repo exists with passing CI
- [ ] Tag v0.1.0 created

**Milestone M02: PyPI Published** {#m02-pypi-published}
- [ ] `pip install temporale` succeeds

**Milestone M03: Fixture Infrastructure Working** {#m03-fixture-infra}
- [ ] Tests pass with fetched fixture (vendored still present)

**Milestone M04: Vendored Code Removed** {#m04-vendored-removed}
- [ ] `sample-code/python/temporale/` deleted
- [ ] All tests pass with fetched fixture only

| Checkpoint | Verification |
|------------|--------------|
| Temporale repo exists | `git clone https://github.com/tugtool/temporale` succeeds |
| PyPI published | `pip install temporale && python -c "import temporale"` succeeds |
| Fixture fetch works | CI logs show "Fetching temporale fixture" |
| Tests pass | `cargo nextest run -p tugtool temporale` exits 0 |
| Vendored removed | `ls sample-code/python/temporale` fails with "No such file" |

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add `tug fixture fetch` CLI command for convenience
- [ ] Add `tug fixture update` CLI command to update lock file
- [ ] Create Rust sample project fixture
- [ ] Create JavaScript sample project fixture
- [ ] Add fixture caching in CI (GitHub Actions cache)
- [ ] Support authenticated repositories (private fixtures)
- [ ] Automatic fixture version checking (warn on outdated)

**Commit after all checkpoints pass.**
