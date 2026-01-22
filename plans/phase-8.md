## Phase 8: Claude Code Spike Test Fixups {#phase-8}

**Purpose:** Fix cross-file rename for relative imports so that the Claude Code interop spike test passes, unblocking Phase 9 (Editor Interop).

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

### Phase Overview {#phase-overview}

#### Context {#context}

During spike testing for Phase 9 (Claude Code interop), we discovered that tug's cross-file rename is broken for relative imports - a common Python package pattern. The spike test in `spikes/interop-spike/` demonstrates this failure:

```
# Before rename: process_data appears in 8 locations across 4 files
# After rename: only 2 locations were updated, code is broken

$ tug run --apply --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data
# Result: 2 files changed, 2 edits (should have been 4 files, ~8 edits)

$ python3 main.py
# ImportError: cannot import name 'process_data' from 'lib.utils'
```

The root cause is documented in `crates/tugtool-python/tests/acceptance_criteria.rs` (lines 682-683):
- "Relative imports return None (documented limitation)"
- "Star imports return None (documented limitation)"

The tests verify parsing doesn't crash, but they do NOT verify that cross-file references are created. Since existing tests use absolute imports exclusively, they pass despite the broken relative import handling.

**The gap:**
- Absolute imports (`from x import foo`) - cross-file references work
- Relative imports (`from .utils import foo`) - NO cross-file references created
- Real Python packages commonly use relative imports

This is a **blocker** for Phase 9. Before implementing Claude Code interop, tug itself must correctly rename symbols across files.

#### Strategy {#strategy}

1. **Fix relative import resolution first** - Update `FileImportResolver` and `resolve_module_to_file` to handle relative imports
2. **Create failing tests before fixing** - Write tests that expose the gap, then fix the implementation
3. **Validate with spike test** - Use `spikes/interop-spike/` as the acceptance test
4. **Add additional spike scenarios** - Star imports, aliased imports, re-exports
5. **Update acceptance criteria tests** - Change from "doesn't crash" to "creates correct references"
6. **Keep scope tight** - Only fix what's needed for the spike; comprehensive import support is future work

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers using tug for Python refactoring (via Claude Code or CLI)
2. Phase 9 implementation (blocked by this fix)

#### Success Criteria (Measurable) {#success-criteria}

- `tug run --apply --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data` in `spikes/interop-spike/` produces 4 files changed, approximately 8 edits
- After rename, `python3 spikes/interop-spike/main.py` executes without ImportError
- `cargo nextest run --workspace` passes (all existing tests still pass)
- New acceptance criteria tests verify relative import references are created (not just "doesn't crash")

#### Scope {#scope}

1. Fix `FileImportResolver` to handle relative imports (`from .utils import foo`)
2. Fix `resolve_module_to_file` to resolve relative paths
3. Add support for star imports (`from .utils import *`) - at minimum, track them; full reference expansion is optional
4. Make the `spikes/interop-spike/` scenario pass completely
5. Add 2-3 additional spike scenarios for edge cases
6. Update `acceptance_criteria.rs` tests to verify reference creation

#### Non-goals (Explicitly out of scope) {#non-goals}

- Comprehensive import resolution for all Python edge cases
- Supporting imports from installed packages (only workspace files)
- Re-implementing Python's full `importlib` semantics
- Performance optimization of import resolution
- Supporting Python 2 import semantics

#### Dependencies / Prerequisites {#dependencies}

- Working CLI with JSON output (already complete)
- Native CST parser with import collection (already complete via `ImportCollector`)
- Existing spike test setup at `spikes/interop-spike/`

#### Constraints {#constraints}

- Must not break existing tests - all current tests must continue to pass
- Must maintain backward compatibility for absolute imports
- Implementation must work without Python runtime (native Rust only)
- Relative import resolution requires knowing the importing file's location

#### Assumptions {#assumptions}

- Relative imports are resolved relative to the importing file's directory
- Package structure follows standard Python conventions (`__init__.py` for packages)
- All files in the workspace are available for resolution

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Relative Import Level Handling (OPEN) {#q01-relative-levels}

**Question:** How should we handle multi-level relative imports (`from ..utils import foo`)?

**Why it matters:** Python supports `..` (parent), `...` (grandparent), etc. The spike only uses `.` (current package), but real code uses deeper levels.

**Options:**
1. Support all relative levels (comprehensive)
2. Support only `.` (single-level) for Phase 8, defer deeper levels
3. Fail loudly on unsupported levels with clear error message

**Plan to resolve:** Implement single-level (`.`) first. If multi-level imports are encountered in practice, add support incrementally.

**Resolution:** OPEN - will resolve during implementation based on spike requirements.

#### [Q02] Star Import Reference Expansion (OPEN) {#q02-star-imports}

**Question:** Should `from .utils import *` expand to individual references for each exported symbol?

**Why it matters:** Full expansion requires analyzing the source module's `__all__` or public symbols. This is complex and may not be needed for the spike.

**Options:**
1. Full expansion - resolve to each individual symbol
2. Track star import but don't expand - no references created
3. Track star import and create a single "star reference" marker

**Plan to resolve:** Analyze the spike test to see if star imports are used. If not, defer to future work.

**Resolution:** OPEN - depends on spike requirements.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Relative import resolution is more complex than expected | med | med | Start with simplest case (single `.`), expand incrementally | Implementation takes > 2 days |
| Fix breaks existing absolute import tests | high | low | Run full test suite after each change; comprehensive golden tests | Any test failure |
| Performance regression from additional path resolution | low | low | Profile if needed; path operations are fast | Noticeable slowdown in CLI |

**Risk R01: Breaking Existing Import Resolution** {#r01-breaking-imports}

- **Risk:** Changes to `FileImportResolver` may break existing absolute import resolution.
- **Mitigation:**
  - Add new code path for relative imports, don't modify existing absolute import logic
  - Run acceptance criteria tests after each change
  - Use feature flag if needed for rollback
- **Residual risk:** Minor edge cases may be affected; comprehensive test coverage mitigates this.

---

### 8.0 Design Decisions {#design-decisions}

#### [D01] Relative Import Resolution via File Path Context (DECIDED) {#d01-relative-resolution}

**Decision:** Pass the importing file's path to `FileImportResolver` and use it to resolve relative imports to absolute workspace paths.

**Rationale:**
- Python's relative imports are resolved relative to the importing file's package location
- We already have the file path available during analysis
- Converting relative to absolute paths allows reuse of existing resolution logic

**Implications:**
- `FileImportResolver::from_imports` needs an additional `importing_file_path` parameter
- `resolve_module_to_file` needs a `context_path` parameter for relative imports
- All relative paths converted to workspace-relative absolute paths before lookup

#### [D02] Single-Level Relative Import First (DECIDED) {#d02-single-level-first}

**Decision:** Implement single-level relative imports (`from .module import x`) first. Multi-level (`from ..module import x`) can be added later if needed.

**Rationale:**
- The spike test only uses single-level relative imports
- Single-level is sufficient for most package-internal imports
- Keeps implementation simple and focused

**Implications:**
- Skip imports with `relative_level > 1` initially (log warning)
- Track in test coverage which levels are supported
- Clear path to extend support later

#### [D03] Update Acceptance Criteria Tests to Verify References (DECIDED) {#d03-acceptance-tests}

**Decision:** Change acceptance criteria tests from "parsing doesn't crash" to "references are actually created" for import scenarios.

**Rationale:**
- Current tests pass even though cross-file references are broken
- Tests should verify the observable behavior (references exist), not just absence of errors
- This aligns tests with actual user expectations

**Implications:**
- Update `ac4_import_resolution::relative_imports_handled` to assert reference count > 0
- Update `ac4_import_resolution::star_imports_handled` similarly
- Add new tests specifically for cross-file reference verification

#### [D04] Spike Test as Acceptance Gate (DECIDED) {#d04-spike-acceptance}

**Decision:** The `spikes/interop-spike/` scenario serves as the primary acceptance test for Phase 8 completion.

**Rationale:**
- The spike represents a real-world use case
- It exercises the exact code path that was broken
- Success is easily verifiable (run tug, then run Python)

**Implications:**
- Phase 8 is not complete until the spike passes end-to-end
- Spike should be run as part of CI or at minimum before merge
- Document the spike test procedure in the plan

---

### 8.1 Specification {#specification}

#### 8.1.1 Current Behavior (Broken) {#current-behavior}

**File:** `crates/tugtool-python/src/analyzer.rs`

In `FileImportResolver::from_imports` (line ~1163):

```rust
// Skip relative imports (Contract C3: unsupported)
if import.module_path.starts_with('.') {
    continue;
}
```

In `convert_imports` (line ~1570):

```rust
// Skip relative imports
if import.relative_level > 0 {
    continue;
}
```

These explicit skips mean:
1. Relative imports are never added to the resolver's aliases map
2. Cross-file references for relative imports are never created
3. Symbols imported via relative imports are never linked to their definitions

#### 8.1.2 Target Behavior (Fixed) {#target-behavior}

**Relative Import Resolution Algorithm:**

1. When processing `from .utils import foo` in file `lib/processor.py`:
   - Determine the importing file's directory: `lib/`
   - Resolve `.utils` relative to `lib/`: `lib/utils` (module path)
   - Convert to file path: `lib/utils.py` or `lib/utils/__init__.py`
   - Look up in workspace files
   - If found, create alias: `foo` -> `("lib.utils.foo", "lib/utils.py")`

2. When processing `from . import utils` in file `lib/__init__.py`:
   - Determine the importing file's directory: `lib/`
   - Resolve `.` to `lib/` (the package itself)
   - `utils` is a submodule: `lib/utils`
   - Convert to file path: `lib/utils.py`
   - If found, create alias: `utils` -> `("lib.utils", "lib/utils.py")`

**Spec S01: Relative Import Path Resolution** {#s01-relative-path}

```
resolve_relative_import(importing_file, relative_level, module_name):
    1. Let dir = directory_of(importing_file)
    2. For i in 0..relative_level:
        dir = parent_of(dir)
    3. If module_name is not empty:
        path = join(dir, module_name.replace('.', '/'))
    4. Else:
        path = dir
    5. Try path + ".py" first
    6. If not found, try path + "/__init__.py"
    7. Return resolved file path or None
```

#### 8.1.3 Files to Modify {#files-to-modify}

**List L01: Files Requiring Changes** {#l01-files}

| File | Changes |
|------|---------|
| `crates/tugtool-python/src/analyzer.rs` | Update `FileImportResolver`, `convert_imports`, `resolve_module_to_file` |
| `crates/tugtool-python/tests/acceptance_criteria.rs` | Update import tests to verify references |
| `spikes/interop-spike/` | Add verification scripts |

#### 8.1.4 API Changes {#api-changes}

**Spec S02: Updated FileImportResolver API** {#s02-resolver-api}

```rust
impl FileImportResolver {
    /// Build from imports, with context for relative import resolution.
    ///
    /// # Arguments
    /// * `imports` - List of imports from the file
    /// * `workspace_files` - Set of all workspace file paths
    /// * `importing_file_path` - Path of the file containing these imports (NEW)
    pub fn from_imports(
        imports: &[LocalImport],
        workspace_files: &HashSet<String>,
        importing_file_path: &str,  // NEW PARAMETER
    ) -> Self;
}
```

**Spec S03: Updated resolve_module_to_file API** {#s03-resolve-api}

```rust
/// Resolve a module path to a workspace file path.
///
/// # Arguments
/// * `module_path` - The module path (may be relative)
/// * `workspace_files` - Set of all workspace file paths
/// * `context_path` - Path of the importing file (for relative imports) (NEW)
/// * `relative_level` - Number of leading dots (0 for absolute) (NEW)
pub fn resolve_module_to_file(
    module_path: &str,
    workspace_files: &HashSet<String>,
    context_path: Option<&str>,  // NEW PARAMETER
    relative_level: u32,          // NEW PARAMETER
) -> Option<String>;
```

---

### 8.2 Symbol Inventory {#symbol-inventory}

#### 8.2.1 Symbols to Modify {#symbols-modify}

| Symbol | Kind | Location | Changes |
|--------|------|----------|---------|
| `FileImportResolver::from_imports` | fn | `analyzer.rs` | Add `importing_file_path` parameter |
| `resolve_module_to_file` | fn | `analyzer.rs` | Add `context_path` and `relative_level` parameters |
| `convert_imports` | fn | `analyzer.rs` | Remove `relative_level > 0` skip; pass level to resolver |
| `LocalImport` | struct | `analyzer.rs` | Add `relative_level: u32` field |

#### 8.2.2 New Symbols {#new-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `resolve_relative_path` | fn | `analyzer.rs` | Helper to compute relative -> absolute path |

---

### 8.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test relative path resolution logic | New `resolve_relative_path` function |
| **Integration** | Test full analyze -> rename flow | Spike test scenarios |
| **Acceptance** | Verify cross-file reference creation | Updated `acceptance_criteria.rs` |

#### Spike Test Scenarios {#spike-scenarios}

**Table T01: Spike Test Scenarios** {#t01-spike-scenarios}

| ID | Scenario | Files | Import Pattern | Expected |
|----|----------|-------|----------------|----------|
| S1 | Current spike | `lib/utils.py`, `lib/__init__.py`, `lib/processor.py`, `main.py` | `from .utils import process_data` | 4 files changed, ~8 edits |
| S2 | Star import | `pkg/base.py`, `pkg/consumer.py` | `from .base import *` | References to exported symbols |
| S3 | Aliased import | `pkg/utils.py`, `pkg/main.py` | `from .utils import func as f` | References resolve through alias |
| S4 | Re-export | `pkg/__init__.py` re-exports `pkg/internal.py` | `from .internal import x; __all__ = ['x']` | Cross-file reference chain works |

---

### 8.4 Execution Steps {#execution-steps}

#### Step 0: Add Failing Tests for Relative Imports {#step-0}

**Commit:** `test(python): add failing tests for relative import resolution`

**References:** [D03] Update Acceptance Criteria, Table T01, (#target-behavior)

**Artifacts:**
- Updated `crates/tugtool-python/tests/acceptance_criteria.rs`

**Tasks:**
- [x] Modify `relative_imports_handled` test to assert references ARE created
- [x] Modify `star_imports_handled` test to assert references or star marker exists
- [x] Add new test `relative_import_creates_cross_file_reference` that:
  - Creates `pkg/utils.py` with `def foo(): pass`
  - Creates `pkg/consumer.py` with `from .utils import foo; foo()`
  - Verifies that `foo` reference in consumer.py resolves to definition in utils.py
- [x] Run tests and verify they FAIL (documenting the gap)

**Tests:**
- [x] Acceptance: `cargo nextest run -p tugtool-python relative_import` (expect FAIL)

**Checkpoint:**
- [x] New tests exist and fail with clear "expected reference not found" messages
- [x] Existing tests still pass: `cargo nextest run -p tugtool-python -- --exclude relative`

**Rollback:**
- Revert test changes

---

#### Step 1: Implement Relative Path Resolution Helper {#step-1}

**Commit:** `feat(python): add resolve_relative_path helper function`

**References:** [D01] Relative Resolution via File Path, [D02] Single-Level First, Spec S01, (#s01-relative-path)

**Artifacts:**
- New function `resolve_relative_path` in `crates/tugtool-python/src/analyzer.rs`

**Tasks:**
- [x] Add `resolve_relative_path(importing_file: &str, relative_level: u32, module_name: &str) -> String`
- [x] Handle relative_level = 1 (single dot)
- [x] Handle relative_level = 0 (absolute, pass through)
- [x] Log warning for relative_level > 1 (not yet supported)
- [x] Add unit tests for path computation

**Tests:**
- [x] Unit: `resolve_relative_path("lib/foo.py", 1, "utils")` -> `"lib/utils"`
- [x] Unit: `resolve_relative_path("lib/sub/foo.py", 1, "bar")` -> `"lib/sub/bar"`
- [x] Unit: `resolve_relative_path("lib/foo.py", 1, "")` -> `"lib"` (package itself)
- [x] Unit: `resolve_relative_path("lib/foo.py", 0, "absolute.path")` -> `"absolute/path"`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python resolve_relative_path` passes
- [x] No warnings from clippy: `cargo clippy -p tugtool-python`

**Rollback:**
- Revert commit

---

#### Step 2: Update LocalImport to Track Relative Level {#step-2}

**Commit:** `feat(python): track relative_level in LocalImport`

**References:** Spec S02, (#symbols-modify)

**Artifacts:**
- Updated `LocalImport` struct
- Updated `convert_imports` function

**Tasks:**
- [x] Add `relative_level: u32` field to `LocalImport` struct
- [x] Update `convert_imports` to populate `relative_level` from CST import info
- [x] REMOVE the `if import.relative_level > 0 { continue; }` skip
- [x] Ensure all call sites of `convert_imports` compile

**Tests:**
- [x] Unit: Verify `LocalImport` captures relative_level correctly

**Checkpoint:**
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python` passes (no regressions)

**Rollback:**
- Revert commit

---

#### Step 3: Update FileImportResolver for Relative Imports {#step-3}

**Commit:** `feat(python): handle relative imports in FileImportResolver`

**References:** [D01] Relative Resolution, Spec S02, Spec S03, (#api-changes)

**Artifacts:**
- Updated `FileImportResolver::from_imports`
- Updated `resolve_module_to_file`

**Tasks:**
- [x] Add `importing_file_path: &str` parameter to `from_imports`
- [x] Add `context_path: Option<&str>` and `relative_level: u32` to `resolve_module_to_file`
- [x] In `from_imports`, handle relative imports:
  - Use `resolve_relative_path` to convert to absolute module path
  - Then proceed with normal resolution logic
- [x] REMOVE the `if import.module_path.starts_with('.') { continue; }` skip
- [x] Update all call sites in `analyze_files` to pass the importing file path

**Tests:**
- [x] Integration: Relative import creates resolver alias
- [x] Integration: Resolver resolves relative import to correct file

**Checkpoint:**
- [x] `cargo build --workspace` succeeds
- [x] `cargo nextest run -p tugtool-python` passes

**Rollback:**
- Revert commit

---

#### Step 4: Verify Cross-File Reference Creation {#step-4}

**Commit:** `test(python): verify relative imports create cross-file references`

**References:** [D03] Acceptance Tests, Table T01, (#test-plan-concepts)

**Artifacts:**
- Updated acceptance criteria tests

**Tasks:**
- [ ] Run the failing tests from Step 0 - they should now PASS
- [ ] Add additional test: `from . import module` pattern (import module, not symbol)
- [ ] Verify reference count is correct in tests

**Tests:**
- [ ] Acceptance: `cargo nextest run -p tugtool-python relative_import` (expect PASS now)
- [ ] Acceptance: `cargo nextest run -p tugtool-python ac4_import` (expect PASS)

**Checkpoint:**
- [ ] All relative import tests pass
- [ ] All existing tests pass: `cargo nextest run --workspace`

**Rollback:**
- If tests fail, debug the implementation from Steps 1-3

---

#### Step 5: Validate with Spike Test {#step-5}

**Commit:** N/A (validation only)

**References:** [D04] Spike as Acceptance Gate, Table T01 scenario S1, (#success-criteria)

**Tasks:**
- [ ] Build tug: `cargo build -p tugtool --release`
- [ ] Navigate to spike: `cd spikes/interop-spike`
- [ ] Reset spike files: `git checkout .`
- [ ] Run analyze-impact: `tug analyze-impact rename-symbol --at lib/utils.py:4:5 --to transform_data`
- [ ] Verify output shows 4 files affected, ~8 references
- [ ] Run dry-run: `tug run --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data`
- [ ] Verify patch preview shows changes in all 4 files
- [ ] Run apply: `tug run --apply --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data`
- [ ] Verify result: 4 files changed
- [ ] Run Python: `python3 main.py` - should execute without ImportError
- [ ] Reset: `git checkout .`

**Checkpoint:**
- [ ] `tug analyze-impact` shows files_affected >= 4
- [ ] `tug run --apply` succeeds with 4 files changed
- [ ] `python3 main.py` executes successfully after rename

---

#### Step 6: Add Additional Spike Scenarios {#step-6}

**Commit:** `test(spike): add additional interop spike scenarios`

**References:** Table T01, [Q02] Star Imports, (#spike-scenarios)

**Artifacts:**
- New directory `spikes/interop-spike/scenarios/`
- Scenario S2: Star import
- Scenario S3: Aliased import
- Scenario S4: Re-export

**Tasks:**
- [ ] Create `spikes/interop-spike/scenarios/` directory structure
- [ ] Scenario S2 - Star import:
  - `star/pkg/base.py` with `def foo(): pass` and `__all__ = ['foo']`
  - `star/pkg/consumer.py` with `from .base import *; foo()`
  - Test: rename `foo` in base.py, verify consumer.py updates
- [ ] Scenario S3 - Aliased import:
  - `alias/pkg/utils.py` with `def process(): pass`
  - `alias/pkg/main.py` with `from .utils import process as p; p()`
  - Test: rename `process` in utils.py, verify `process` (not `p`) changes
- [ ] Scenario S4 - Re-export:
  - `reexport/pkg/internal.py` with `def helper(): pass`
  - `reexport/pkg/__init__.py` with `from .internal import helper`
  - `reexport/main.py` with `from pkg import helper; helper()`
  - Test: rename `helper` in internal.py, verify all locations update
- [ ] Document each scenario in README

**Tests:**
- [ ] Manual: Run each scenario through tug rename flow
- [ ] Verify Python execution after rename

**Checkpoint:**
- [ ] At least 2 of the 3 additional scenarios pass
- [ ] Any failing scenarios are documented with specific failure mode

**Rollback:**
- Delete scenario directories

---

#### Step 7: Update Documentation {#step-7}

**Commit:** `docs: document relative import support and limitations`

**References:** (#specification)

**Artifacts:**
- Updated `CLAUDE.md` (if needed)
- Updated comments in `analyzer.rs`

**Tasks:**
- [ ] Update Contract C3 comments in `analyzer.rs` to reflect new capabilities
- [ ] Document supported relative import patterns
- [ ] Document known limitations (multi-level relative imports, etc.)
- [ ] Update any outdated "documented limitation" comments

**Checkpoint:**
- [ ] Comments accurately reflect current behavior
- [ ] No misleading "unsupported" comments for now-supported features

**Rollback:**
- Revert doc changes

---

#### Step 8: Final Verification and Cleanup {#step-8}

**Commit:** N/A (verification only)

**References:** (#success-criteria)

**Tasks:**
- [ ] Run full test suite: `cargo nextest run --workspace`
- [ ] Run clippy: `cargo clippy --workspace -- -D warnings`
- [ ] Run formatter: `cargo fmt --all -- --check`
- [ ] Run spike test one final time
- [ ] Verify CI would pass: `just ci`

**Checkpoint:**
- [ ] `cargo nextest run --workspace` passes
- [ ] `cargo clippy --workspace -- -D warnings` passes
- [ ] `cargo fmt --all -- --check` passes
- [ ] Spike test passes completely

---

### 8.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Cross-file rename working for relative imports in Python packages, validated by the interop spike test.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tug run --apply --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data` in `spikes/interop-spike/` produces 4 files changed
- [ ] `python3 spikes/interop-spike/main.py` executes without error after rename
- [ ] `cargo nextest run --workspace` passes (no regressions)
- [ ] Acceptance criteria tests verify references ARE created for relative imports
- [ ] At least one additional spike scenario (S2, S3, or S4) passes

**Acceptance tests:**
- [ ] Integration: `cargo nextest run -p tugtool-python ac4_import`
- [ ] Integration: `cargo nextest run -p tugtool-python relative_import`
- [ ] Manual: Spike test end-to-end flow

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Failing Tests Written** {#m01-failing-tests}
- [ ] Step 0 complete
- [ ] Tests exist that fail due to missing relative import support

**Milestone M02: Core Fix Implemented** {#m02-core-fix}
- [ ] Steps 1-4 complete
- [ ] Relative imports resolved in FileImportResolver
- [ ] Cross-file references created for relative imports

**Milestone M03: Spike Passes** {#m03-spike-passes}
- [ ] Step 5 complete
- [ ] Original spike test scenario passes end-to-end

**Milestone M04: Additional Validation** {#m04-validation}
- [ ] Steps 6-8 complete
- [ ] Additional spike scenarios documented
- [ ] Documentation updated

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Support multi-level relative imports (`from ..utils import foo`)
- [ ] Full star import expansion (resolve each symbol in `__all__`)
- [ ] Import resolution for installed packages (not just workspace files)
- [ ] Circular import detection and handling

| Checkpoint | Verification |
|------------|--------------|
| Tests fail before fix | Step 0 tests FAIL |
| Tests pass after fix | Step 4 tests PASS |
| Spike passes | `python3 main.py` succeeds |
| CI green | `just ci` passes |

---

### Implementation Log {#implementation-log}

| Step | Status | Date | Notes |
|------|--------|------|-------|
| Step 0 | complete | 2026-01-22 | Add failing tests - 4 tests fail as expected |
| Step 1 | complete | 2026-01-22 | Added resolve_relative_path with 10 unit tests passing |
| Step 2 | complete | 2026-01-22 | LocalImport now tracks relative_level; relative imports no longer skipped; one Step 0 test now passes |
| Step 3 | complete | 2026-01-22 | FileImportResolver + resolve_module_to_file now handle relative imports; all 288 tests pass |
| Step 4 | pending | | Verify tests pass |
| Step 5 | pending | | Spike validation |
| Step 6 | pending | | Additional scenarios |
| Step 7 | pending | | Documentation |
| Step 8 | pending | | Final verification |
