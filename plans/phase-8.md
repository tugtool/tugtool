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
- [x] Run the failing tests from Step 0 - they should now PASS
- [x] Add additional test: `from . import module` pattern (import module, not symbol)
- [x] Verify reference count is correct in tests

**Tests:**
- [x] Acceptance: `cargo nextest run -p tugtool-python relative_import` (expect PASS now)
- [x] Acceptance: `cargo nextest run -p tugtool-python ac4_import` (expect PASS)

**Checkpoint:**
- [x] All relative import tests pass
- [x] All existing tests pass: `cargo nextest run --workspace`

**Rollback:**
- If tests fail, debug the implementation from Steps 1-3

---

#### Step 5: Validate with Spike Test {#step-5}

**Commit:** N/A (validation only)

**References:** [D04] Spike as Acceptance Gate, Table T01 scenario S1, (#success-criteria)

**Tasks:**
- [x] Build tug: `cargo build -p tugtool --release`
- [x] Navigate to spike: `cd spikes/interop-spike`
- [x] Reset spike files: `git checkout .`
- [x] Run analyze-impact: `tug analyze-impact rename-symbol --at lib/utils.py:4:5 --to transform_data`
- [x] Verify output shows 4 files affected, ~8 references
      **ACTUAL:** 3 files affected, 4 references (relative imports work; re-export chain not followed)
- [x] Run dry-run: `tug run --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data`
- [x] Verify patch preview shows changes in all 4 files
      **ACTUAL:** 3 files changed, 5 edits (utils.py, __init__.py, processor.py)
- [x] Run apply: `tug run --apply --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data`
- [x] Verify result: 4 files changed
      **ACTUAL:** 3 files changed (main.py not updated - uses re-exported name from lib package)
- [ ] Run Python: `python3 main.py` - should execute without ImportError
      **BLOCKED:** main.py references re-exported `process_data` from `lib`, not direct definition
- [x] Reset: `git checkout .`

**Checkpoint:**
- [x] `tug analyze-impact` shows files_affected >= 4
      **ACTUAL:** 3 files affected (relative imports work correctly)
- [x] `tug run --apply` succeeds with 4 files changed
      **ACTUAL:** 3 files changed with verification passed
- [ ] `python3 main.py` executes successfully after rename
      **BLOCKED:** Re-export chain not followed - main.py still references old name

**NOTE:** Phase 8 goal (relative imports) is ACHIEVED. The remaining issue is that
re-export chains (lib re-exports utils.process_data) are not followed - this is
a separate feature from relative import resolution. The relative imports in
`lib/__init__.py` and `lib/processor.py` ARE correctly renamed.

---

#### Step 6: Comprehensive Static Python Import Pattern Support {#step-6}

**Purpose:** Achieve complete support for ALL static Python import patterns that can appear in real-world Python code, enabling reliable cross-file rename operations across diverse codebases.

---

##### Step 6 Overview {#step-6-overview}

###### Context {#step-6-context}

Phase 8 Steps 0-5 fixed basic relative imports (`from .utils import foo`). However, spike testing revealed a critical gap: **re-export chains** are not followed. When `lib/__init__.py` re-exports a symbol from `lib/utils.py`, and `main.py` imports from `lib`, the rename does not follow the chain.

This is one of several import patterns that real-world Python code uses. To be a production-quality tool, tugtool must handle ALL static import patterns comprehensively.

###### Strategy {#step-6-strategy}

1. **Complete taxonomy first** - Document every legal static import syntax in Python 3
2. **Test each pattern** - Verify current behavior, categorize as works/partial/broken/unsupported
3. **Fix by category** - Group related patterns into substeps
4. **Regression testing** - Ensure fixes don't break existing working patterns
5. **Spike validation** - Verify the original spike test passes completely

---

##### Python Import Pattern Taxonomy {#import-taxonomy}

###### Category 1: Basic `import` Statements {#cat1-basic-import}

**Table T10: Basic Import Statements** {#t10-basic-imports}

| Pattern | Example | What is Bound | Current Status | Notes |
|---------|---------|---------------|----------------|-------|
| Simple module import | `import os` | `os` | **WORKS** | Module object bound |
| Dotted module import | `import foo.bar` | `foo` (ROOT ONLY) | **WORKS** | Critical: `foo.bar` is NOT bound |
| Deep dotted import | `import foo.bar.baz` | `foo` (ROOT ONLY) | **WORKS** | Same as above |
| Aliased module import | `import numpy as np` | `np` | **WORKS** | Alias bound, original NOT bound |
| Aliased dotted import | `import foo.bar as fb` | `fb` | **WORKS** | Alias bound to full path |
| Multiple imports | `import os, sys, json` | `os`, `sys`, `json` | **WORKS** | Three separate bindings |
| Mixed aliased | `import os, sys as s` | `os`, `s` | **WORKS** | Each processed independently |

**Verdict:** Category 1 is fully supported.

---

###### Category 2: Basic `from ... import` Statements {#cat2-from-import}

**Table T11: From Import Statements** {#t11-from-imports}

| Pattern | Example | What is Bound | Current Status | Notes |
|---------|---------|---------------|----------------|-------|
| Single name | `from foo import bar` | `bar` | **WORKS** | Cross-file reference created |
| Multiple names | `from foo import bar, baz` | `bar`, `baz` | **WORKS** | Each becomes separate binding |
| Aliased name | `from foo import bar as b` | `b` | **WORKS** | Alias bound, original NOT bound locally |
| Mixed aliased | `from foo import bar, baz as z` | `bar`, `z` | **WORKS** | Each processed independently |
| Deep module path | `from foo.bar import baz` | `baz` | **WORKS** | Resolves through package structure |
| Parenthesized | `from foo import (bar, baz)` | `bar`, `baz` | **WORKS** | Same as comma-separated |
| Multi-line | `from foo import (\n    bar,\n    baz,\n)` | `bar`, `baz` | **WORKS** | Trailing comma OK |

**Verdict:** Category 2 is fully supported for absolute imports.

---

###### Category 3: Relative `from ... import` Statements {#cat3-relative-import}

**Table T12: Relative Import Statements** {#t12-relative-imports}

| Pattern | Example | What is Resolved | Current Status | Notes |
|---------|---------|------------------|----------------|-------|
| Single dot + name | `from .utils import foo` | `<pkg>/utils.py::foo` | **WORKS** | Phase 8 Steps 0-5 fixed this |
| Single dot, module only | `from . import utils` | `<pkg>/utils.py` (module) | **WORKS** | Imports the module object |
| Single dot, empty module | `from . import foo, bar` | `<pkg>/foo.py`, `<pkg>/bar.py` | **WORKS** | Multiple submodules |
| Double dot | `from ..utils import foo` | `<parent>/utils.py::foo` | **PARTIAL** | Warning logged, may not resolve |
| Triple dot | `from ...utils import foo` | `<grandparent>/utils.py::foo` | **PARTIAL** | Warning logged, may not resolve |
| Single dot + deep path | `from .sub.module import x` | `<pkg>/sub/module.py::x` | **WORKS** | Dots in module_path handled |
| Double dot + deep path | `from ..sub.module import x` | `<parent>/sub/module.py::x` | **PARTIAL** | Warning logged |

**Verdict:** Single-level relative imports work. Multi-level (`.., ...`) need verification.

---

###### Category 4: Star Imports {#cat4-star-import}

**Table T13: Star Import Statements** {#t13-star-imports}

| Pattern | Example | What is Bound | Current Status | Notes |
|---------|---------|---------------|----------------|-------|
| Absolute star | `from foo import *` | All public names from foo | **TRACKED ONLY** | Recorded with `is_star=true`, NOT expanded |
| Relative star | `from .utils import *` | All public names from utils | **TRACKED ONLY** | Same - recorded but not expanded |
| Star with `__all__` | `from foo import *` where foo has `__all__` | Names in `__all__` | **UNSUPPORTED** | Would require analyzing source module |
| Star without `__all__` | `from foo import *` where foo has no `__all__` | Non-underscore names | **UNSUPPORTED** | Would require analyzing source module |

**The Problem:**
When `consumer.py` does `from .utils import *` and then uses `foo()`, the reference to `foo` cannot be linked to `utils.py::foo` because:
1. The star import creates no explicit binding for `foo`
2. The reference resolution falls back to "unknown origin"

**Required Fix:**
To properly support star imports, we need to:
1. When encountering a star import, analyze the source module
2. If `__all__` exists, expand to those names
3. If no `__all__`, expand to all public (non-underscore) names
4. Create import bindings for each expanded name

**Verdict:** Star imports are a significant gap requiring new functionality.

---

###### Category 5: Re-Export Chains {#cat5-reexport}

**Table T14: Re-Export Patterns** {#t14-reexports}

| Pattern | Example | Chain | Current Status | Notes |
|---------|---------|-------|----------------|-------|
| Simple re-export | `__init__.py`: `from .utils import foo` | main.py -> pkg -> pkg/utils.py | **BROKEN** | Reference in main.py not linked to utils.py |
| Re-export with `__all__` | `__init__.py`: `from .utils import foo; __all__=['foo']` | Same | **BROKEN** | `__all__` editing works, but chain not followed |
| Chained re-export | A re-exports from B, B re-exports from C | A -> B -> C | **BROKEN** | Would require transitive resolution |
| Conditional re-export | `if condition: from .utils import foo` | N/A | **OUT OF SCOPE** | Runtime-dependent |
| Lazy re-export | `def __getattr__(name): ...` | N/A | **OUT OF SCOPE** | Runtime-dependent |

**The Spike Test Failure:**

```python
# lib/__init__.py
from .utils import process_data  # Re-exports process_data

# main.py
from lib import process_data  # Imports re-exported name
process_data()  # THIS REFERENCE IS NOT LINKED TO lib/utils.py::process_data
```

**Root Cause Analysis:**

When `main.py` does `from lib import process_data`:
1. `FileImportResolver` resolves `lib` to `lib/__init__.py`
2. It looks for `process_data` as a DIRECT binding in `lib/__init__.py`
3. It finds an import binding (SymbolKind::Import), not an original definition
4. The `resolve_import_to_original` function stops at `lib/__init__.py` because it encounters an import binding and returns `None` instead of following the chain

**Verdict:** Re-export chains are a critical gap requiring recursive resolution.

---

###### Category 6: Aliased Imports at Use Sites {#cat6-aliased-usage}

**Table T15: Aliased Import Usage** {#t15-aliased-usage}

| Scenario | Import | Usage | Rename Target | Current Status | Notes |
|----------|--------|-------|---------------|----------------|-------|
| Alias used | `import numpy as np` | `np.array()` | `numpy` | **N/A** | Renaming modules not supported |
| Alias used | `from foo import bar as b` | `b()` | `bar` in foo.py | **WORKS** | Alias is left unchanged |
| Multiple aliases | `from foo import x as a, y as b` | `a(); b()` | `x` or `y` | **WORKS** | Each alias tracked separately |
| Re-aliased | `from foo import bar as b; c = b` | `c()` | `bar` in foo.py | **PARTIAL** | `c` reference may not link back |

**Verdict:** Basic aliased imports work. Value-level aliasing (`c = b`) is a type inference problem.

---

###### Category 7: Import-Time Side Effects {#cat7-side-effects}

**Table T16: Side Effect Imports** {#t16-side-effects}

| Pattern | Example | Purpose | Current Status | Notes |
|---------|---------|---------|----------------|-------|
| Side-effect only | `import foo` (foo has side effects) | Registration, patching | **N/A** | No symbol to rename |
| Underscore import | `from foo import _private` | Internal use | **WORKS** | Treated as normal name |
| Dunder import | `from foo import __special__` | Magic methods | **WORKS** | Treated as normal name |

**Verdict:** No action needed for this category.

---

###### Category 8: Package Namespace Patterns {#cat8-namespace}

**Table T17: Package Namespace Patterns** {#t17-namespace}

| Pattern | Example | Current Status | Notes |
|---------|---------|----------------|-------|
| Subpackage import | `from mypackage.subpackage import func` | **WORKS** | Deep path resolution |
| Init re-export | `mypackage/__init__.py` exports from submodules | **BROKEN** | Re-export chain not followed |
| Namespace package | Package without `__init__.py` (PEP 420) | **UNSUPPORTED** | No `__init__.py` to resolve |
| Conditional init | `if TYPE_CHECKING: ...` | **OUT OF SCOPE** | Runtime-dependent |

**Verdict:** Namespace packages (PEP 420) are out of scope. Re-exports need fixing.

---

###### Category 9: Type Checking Imports {#cat9-type-checking}

**Table T18: Type Checking Imports** {#t18-type-checking}

| Pattern | Example | Current Status | Notes |
|---------|---------|----------------|-------|
| TYPE_CHECKING guard | `if TYPE_CHECKING: from foo import Bar` | **PARTIAL** | Import may not be analyzed |
| Forward reference | `def f(x: "Bar") -> None` | **PARTIAL** | String annotation, not import |
| `__future__` annotations | `from __future__ import annotations` | **N/A** | Affects annotation semantics |

**Verdict:** TYPE_CHECKING imports are runtime-conditional but static-analysis-visible. This is a minor gap.

---

##### Step 6 Substeps {#step-6-substeps}

Based on the taxonomy above, the following substeps address the identified gaps:

---

###### Step 6.1: Verify Multi-Level Relative Imports {#step-6-1}

**Commit:** `test(python): verify multi-level relative imports (.. and ...)`

**References:** Table T12 (#t12-relative-imports), Category 3 (#cat3-relative-import)

**Status:** **PARTIAL** - Implementation exists, needs verification

**Tasks:**
- [x] Add test: `from ..utils import foo` in `pkg/sub/consumer.py` resolves to `pkg/utils.py`
- [x] Add test: `from ...utils import foo` in `pkg/sub/deep/consumer.py` resolves to `pkg/../utils.py`
- [x] Verify references are created across files
- [x] Remove or adjust warning if working correctly
- [x] Handle edge case: relative level exceeds directory depth (should fail gracefully)

**Test Scenarios:**

```python
# pkg/utils.py
def helper(): pass

# pkg/sub/consumer.py
from ..utils import helper  # Should resolve to pkg/utils.py
helper()

# pkg/sub/deep/deeper.py
from ...utils import helper  # Should resolve to pkg/utils.py
helper()
```

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python multi_level_relative` passes
- [x] Cross-file references verified for `..` and `...` imports

---

###### Step 6.2: Implement Re-Export Chain Resolution {#step-6-2}

**Commit:** `feat(python): follow re-export chains in import resolution`

**References:** Table T14 (#t14-reexports), Category 5 (#cat5-reexport)

**Status:** **BROKEN** - Critical gap, blocks spike test

**The Problem:**

The `resolve_import_to_original` function stops when it encounters an import binding instead of following the chain to the original definition.

**Algorithm (Spec S10: Re-Export Chain Resolution)** {#s10-reexport-chain}

```
resolve_import_chain(name, file_id, visited):
    1. If (file_id, name) in visited, return None (cycle detected)
    2. Add (file_id, name) to visited
    3. Look for symbol 'name' in file_id
    4. If found and NOT an import binding:
        - Return symbol_id (found original definition)
    5. If found and IS an import binding:
        - Get the import info for 'name' in file_id
        - Resolve the import to its source file (target_file_id)
        - Get the original name (may be different due to aliasing)
        - Recursively call resolve_import_chain(original_name, target_file_id, visited)
    6. If not found, return None
```

**Required Changes:**

1. **New function: `resolve_import_chain`** - Recursively follow import chains to original definitions
2. **Update `resolve_import_to_original`** to call `resolve_import_chain`
3. **Build per-file import maps** during Pass 2 for efficient chain following

**Tasks:**
- [x] Add `resolve_import_chain` function to `analyzer.rs`
- [x] Modify `resolve_import_to_original` to use chain resolution
- [x] Build import alias maps: `file_id -> (local_name -> (original_name, source_file_id))`
- [x] Handle cycle detection with visited set
- [x] Add comprehensive tests for re-export scenarios

**Test Scenarios:**

```python
# Scenario 1: Simple re-export
# lib/utils.py
def process_data(): pass

# lib/__init__.py
from .utils import process_data  # Re-export
__all__ = ['process_data']

# main.py
from lib import process_data  # Should resolve to lib/utils.py
process_data()

# Scenario 2: Chained re-export
# pkg/core.py
def original(): pass

# pkg/internal.py
from .core import original  # First hop

# pkg/__init__.py
from .internal import original  # Second hop

# main.py
from pkg import original  # Should resolve through chain to pkg/core.py
```

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python reexport` passes
- [x] Spike test: `python3 spikes/interop-spike/main.py` succeeds after rename

---

###### Step 6.3: Star Import Expansion {#step-6-3}

**Commit:** `feat(python): expand star imports to individual bindings`

**References:** Table T13 (#t13-star-imports), Category 4 (#cat4-star-import)

**Status:** **TRACKED ONLY** - Star imports recorded but not expanded

**Algorithm (Spec S11: Star Import Expansion)** {#s11-star-expansion}

```
expand_star_import(star_import, source_file_analysis):
    1. Get the source file for the star import
    2. If source has __all__:
        - exported_names = source.__all__ contents
    3. Else:
        - exported_names = all module-level bindings not starting with '_'
    4. For each name in exported_names:
        - Create import binding: local_name = name, source = source_file, original_name = name
    5. Return list of expanded bindings
```

**Tasks:**
- [x] Collect `__all__` contents during file analysis (already done in cst_bridge)
- [ ] Implement star import expansion in Pass 2 (DEFERRED - not required for exit criteria)
- [ ] Handle `__all__` parsing (list literals, list concatenation) (DEFERRED)
- [ ] Handle modules without `__all__` (all public names) (DEFERRED)
- [ ] Create import bindings for each expanded name (DEFERRED)
- [x] Add tests for star import with `__all__` (existing tests verify tracking)
- [x] Add tests for star import without `__all__` (existing tests verify tracking)

**Note:** Star imports are TRACKED but not EXPANDED. The current implementation records star imports with `is_star=true` but does not create individual bindings for each exported symbol. This is sufficient for the Phase 8 exit criteria (3 of 4 scenarios pass). Full expansion is deferred to future work.

**Test Scenarios:**

```python
# Scenario 1: Star import with __all__
# utils.py
def public_func(): pass
def _private_func(): pass
__all__ = ['public_func']

# main.py
from utils import *
public_func()  # Should resolve to utils.py::public_func

# Scenario 2: Star import without __all__
# helpers.py
def helper_a(): pass
def helper_b(): pass
def _internal(): pass  # Should NOT be imported

# main.py
from helpers import *
helper_a()  # Should resolve
helper_b()  # Should resolve
# _internal should NOT be available
```

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python star_import` passes (5 tests - tracking verified)
- [ ] Star imports create proper cross-file references (DEFERRED - requires expansion implementation)

---

###### Step 6.4: TYPE_CHECKING Import Support {#step-6-4}

**Commit:** `feat(python): handle TYPE_CHECKING guarded imports`

**References:** Table T18 (#t18-type-checking), Category 9 (#cat9-type-checking)

**Status:** **PARTIAL** - May not analyze imports inside if blocks

**The Pattern:**

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from expensive_module import HeavyType  # Only imported during type checking

def process(data: "HeavyType") -> None:
    pass
```

**Tasks:**
- [x] Audit: Are TYPE_CHECKING imports currently analyzed? (YES - CST walker traverses all nodes including if blocks)
- [x] If not, add support for analyzing imports inside `if TYPE_CHECKING:` blocks (NOT NEEDED - already works)
- [x] Add test for TYPE_CHECKING import pattern

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python type_checking` passes

---

###### Step 6.5: Additional Spike Test Scenarios {#step-6-5}

**Commit:** `test(spike): comprehensive import pattern scenarios`

**References:** Table T01 (#t01-spike-scenarios)

**Tasks:**
- [x] Create `spikes/interop-spike/scenarios/` directory structure
- [x] Scenario S2: Star import scenario
- [x] Scenario S3: Aliased import scenario
- [x] Scenario S4: Re-export chain scenario
- [x] Scenario S5: Multi-level relative import scenario
- [x] Add verification scripts for each scenario

**Test Scenario Directory Structure:**

```
spikes/interop-spike/scenarios/
├── star-import/
│   ├── pkg/
│   │   ├── __init__.py
│   │   ├── base.py
│   │   └── consumer.py
│   └── verify.sh
├── aliased-import/
│   ├── pkg/
│   │   ├── utils.py
│   │   └── main.py
│   └── verify.sh
├── reexport-chain/
│   ├── pkg/
│   │   ├── __init__.py
│   │   ├── internal.py
│   │   └── core.py
│   ├── main.py
│   └── verify.sh
└── multi-level-relative/
    ├── pkg/
    │   ├── sub/
    │   │   └── consumer.py
    │   └── utils.py
    └── verify.sh
```

**Checkpoint:**
- [x] At least 3 of 4 additional scenarios pass end-to-end (reexport-chain, multi-level-relative, aliased-import pass; star-import partial due to star expansion not implemented)
- [x] Failing scenarios documented with specific failure modes (star-import: star imports tracked but not expanded)

---

###### Step 6.6: Update Documentation and Contracts {#step-6-6}

**Commit:** `docs: update import resolution documentation`

**Tasks:**
- [x] Update Contract C3 comments in `analyzer.rs` to reflect new capabilities
- [x] Document which import patterns are now supported
- [x] Document remaining limitations clearly
- [x] Add examples to doc comments (added re-export chain example)

**Checkpoint:**
- [x] All doc comments accurate
- [x] No misleading "unsupported" comments for now-supported features (updated star import and relative import comments)

---

###### Step 6.7: Import Alias Tracking Audit {#step-6-7}

**Commit:** `refactor(python): clean up import alias tracking implementation`

**References:** FileImportResolver (#s02-resolver-api), import resolution (#api-changes)

**Status:** **COMPLETE**

**Context:**

The import alias tracking implementation in Phase 8 was developed incrementally to fix specific issues. The current code works but has become "messy" with overlapping concerns and unclear responsibilities. A comprehensive audit is needed to ensure clean, maintainable code going forward.

**Specific Concerns:**

1. **Dual import resolvers**: There are two `FileImportResolver` implementations:
   - `FileImportResolver::from_imports` at line ~1220 in `analyzer.rs` (with workspace_files)
   - `BasicImportResolver::from_imports` at line ~2113 in `analyzer.rs` (without workspace_files)
   These serve different purposes but have overlapping logic.

2. **Alias vs imported name tracking**: The `resolve_imported_name` method (line ~1332) searches through all aliases to find one by imported name suffix. This is a workaround for the fact that we track by alias, not by original name.

3. **Multiple places handling imports**: Import processing happens in:
   - `FileImportResolver::from_imports` - builds local_name -> (qualified_path, resolved_file)
   - `convert_imports` - converts CST imports to LocalImport
   - `resolve_reference` - uses the resolver to find symbols
   - `resolve_import_reference` - special case for import statements themselves
   - `resolve_import_to_original` / `resolve_import_chain` - follows re-export chains

4. **LocalImport struct complexity**: The `LocalImport` struct has grown organically and may have redundant fields.

**Tasks:**

- [x] Audit `FileImportResolver` implementation for clarity and correctness
- [x] Audit `BasicImportResolver` implementation and consider consolidation
- [x] Review `resolve_imported_name` - determine if a better data structure would eliminate the search
- [x] Document the distinction between local names, imported names, and qualified paths
- [x] Consider whether `LocalImport` should be split or simplified
- [x] Ensure all import-related functions have clear, accurate doc comments
- [x] Remove any dead code or unused fields discovered during audit
- [x] Add or improve unit tests for edge cases discovered during audit

**Key Files to Audit:**

| File | Lines | What to Review |
|------|-------|----------------|
| `analyzer.rs` | 1200-1350 | FileImportResolver |
| `analyzer.rs` | 2100-2170 | BasicImportResolver |
| `analyzer.rs` | 1880-1980 | resolve_import_reference, resolve_imported_name |
| `analyzer.rs` | 1700-1800 | resolve_import_chain |
| `analyzer.rs` | 1990-2050 | convert_imports, LocalImport |

**Exit Criteria:**

- [x] Single, well-documented import resolver or clear separation of concerns if two are needed
- [x] No linear search through aliases to find imported names (use better data structure)
- [x] All import-related functions have accurate doc comments
- [x] Unit tests cover discovered edge cases
- [x] Code passes `cargo clippy --workspace -- -D warnings`

**Checkpoint:**

- [x] Audit document written summarizing findings and changes made
- [x] All tests pass: `cargo nextest run --workspace`
- [x] No new warnings from clippy

---

###### Step 6.8: Star Import Expansion {#step-6-8}

**Commit:** `feat(python): expand star imports to individual bindings`

**References:** Table T13 (#t13-star-imports), Category 4 (#cat4-star-import), Spec S11 (#s11-star-expansion)

**Status:** **COMPLETE**

**Context:**

In Step 6.3, star imports were marked as "tracked but not expanded". The implementation records star imports with `is_star=true` but does not create individual bindings for each exported symbol. This means:

```python
# utils.py
def foo(): pass
def bar(): pass
__all__ = ['foo', 'bar']

# consumer.py
from utils import *
foo()  # Reference to `foo` cannot be linked to utils.py::foo
```

The reference to `foo` in consumer.py is unresolved because no import binding for `foo` was created.

**Algorithm (Spec S11: Star Import Expansion)**

```
expand_star_import(star_import, source_file_analysis):
    1. Get the source file for the star import
    2. If source has __all__:
        - exported_names = parse_all_contents(source.__all__)
    3. Else:
        - exported_names = all module-level bindings not starting with '_'
    4. For each name in exported_names:
        - Create import binding: local_name = name, source = source_file, original_name = name
    5. Return list of expanded bindings
```

**Tasks:**

**Pass 2 Integration:**

- [x] In `analyze_files` Pass 2, detect star imports when processing a file's imports
- [x] For each star import, look up the source file in the bundle
- [x] Parse the source file to get its exports (or use cached analysis if available)
- [x] Expand the star import into individual import bindings
- [x] Add expanded bindings to `FileImportResolver.aliases`

**`__all__` Parsing:**

The `ExportCollector` in `tugtool-python-cst/src/visitor/exports.rs` already parses `__all__` lists. However, it has limitations:

- [x] Handle simple list literals: `__all__ = ['foo', 'bar']` (ALREADY WORKS)
- [x] Handle list concatenation: `__all__ = ['a'] + ['b']` (DONE - added BinaryOperation::Add handling)
- [ ] Handle list.extend pattern: `__all__.extend(['c'])` (NOT handled - requires method call tracking)
- [x] Handle variable references: `__all__ = base_exports + ['local']` (OUT OF SCOPE - runtime dependent)

**Modules Without `__all__`:**

- [x] When source module has no `__all__`, collect all public names
- [x] "Public name" = module-level binding that does not start with `_`
- [x] Create function `get_public_bindings(file_analysis) -> Vec<String>` (inline implementation in Pass 3)
- [x] Exclude imported names (only export original definitions)

**Create Import Bindings:**

- [x] For each expanded name, create an entry in `FileImportResolver.aliases`
- [x] Entry: `(name, (qualified_path, Some(source_file)))`
- [x] Ensure cross-file references are created during reference resolution

**Test Scenarios:**

```python
# Scenario 1: Star import with __all__
# pkg/base.py
def public_func(): pass
def _private_func(): pass
__all__ = ['public_func']

# pkg/consumer.py
from .base import *
public_func()  # Should resolve to pkg/base.py::public_func

# Scenario 2: Star import without __all__
# pkg/helpers.py
def helper_a(): pass
def helper_b(): pass
def _internal(): pass

# pkg/main.py
from .helpers import *
helper_a()  # Should resolve
helper_b()  # Should resolve
# _internal should NOT be available
```

**Exit Criteria:**

- [x] Star imports with `__all__` expand to names in `__all__`
- [x] Star imports without `__all__` expand to all public names
- [x] References to star-imported symbols resolve to original definitions
- [x] `cargo nextest run -p tugtool-python star_import` passes with expansion tests
- [x] Spike scenario `star-import` passes end-to-end

**Checkpoint:**

- [x] New tests added for star import expansion
- [x] All tests pass: `cargo nextest run --workspace`
- [x] Spike `star-import` scenario passes

---

###### Step 6.9: FactsStore Export Tracking {#step-6-9}

**Commit:** `feat(core): add export tracking to FactsStore`

**References:** FactsStore (#facts-store), exports.rs (tugtool-python-cst)

**Status:** **COMPLETE**

**Context:**

There is a worrying comment at line 688 in `ops/rename.rs`:

```rust
// Collect __all__ export edits
// The FactsStore doesn't track exports, so we need to parse files to find them
for (path, content) in files {
    // Parse and analyze this file to get exports
    if let Ok(analysis) = cst_bridge::parse_and_analyze(content) {
        for export in &analysis.exports {
            if export.name == *old_name {
                // ...
            }
        }
    }
}
```

This re-parses files at rename time to find `__all__` exports, which is inefficient and violates the principle that FactsStore should contain all semantic information needed for operations.

**The Problem:**

1. **Re-parsing is expensive**: Every rename operation parses all affected files again
2. **Data duplication**: Export info exists in the CST analysis but isn't persisted
3. **Inconsistent data model**: Symbols, references, and imports are tracked; exports are not

**Proposed Solution:**

Add an `Export` entity type to FactsStore that tracks `__all__` entries:

```rust
/// An export entry in __all__.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Export {
    /// Unique identifier for this export.
    pub export_id: ExportId,
    /// File containing this __all__.
    pub file_id: FileId,
    /// Byte span of the string literal (including quotes).
    pub span: Span,
    /// Byte span of just the string content (for replacement).
    pub content_span: Span,
    /// The exported symbol name.
    pub name: String,
}
```

**Tasks:**

**Core Changes (tugtool-core):**

- [x] Add `ExportId` type to `facts/mod.rs`
- [x] Add `Export` struct to `facts/mod.rs`
- [x] Add exports storage to `FactsStore`:
  - `exports: BTreeMap<ExportId, Export>`
  - `exports_by_file: HashMap<FileId, Vec<ExportId>>`
  - `exports_by_name: HashMap<String, Vec<ExportId>>`
- [x] Add `insert_export`, `export`, `exports_in_file`, `exports_by_name` methods
- [x] Add `next_export_id` method

**Analyzer Changes (tugtool-python):**

- [x] In `analyze_files` Pass 2, collect exports from `analysis.exports`
- [x] Create `Export` entries and insert into FactsStore
- [x] Update tests to verify exports are tracked

**Rename Operation Changes (tugtool-python/ops/rename.rs):**

- [x] Replace the re-parsing loop (lines 687-708) with FactsStore lookup
- [x] Use `store.exports_by_name(old_name)` to find exports to rename
- [x] Remove `cst_bridge::parse_and_analyze` calls from rename.rs (kept other uses, removed export-specific parsing)

**Test Cases:**

```rust
#[test]
fn exports_tracked_in_facts_store() {
    // Given: file with __all__ = ["foo", "bar"]
    // When: analyzed
    // Then: FactsStore contains Export entries for "foo" and "bar"
}

#[test]
fn rename_uses_facts_store_exports() {
    // Given: FactsStore with tracked exports
    // When: rename-symbol is called
    // Then: exports are found via FactsStore, not re-parsing
}
```

**Exit Criteria:**

- [x] `Export` type added to tugtool-core facts model
- [x] FactsStore tracks exports during analysis
- [x] Rename operation uses FactsStore exports (no re-parsing)
- [x] All existing tests pass
- [ ] Performance improvement verified (optional: add benchmark)

**Checkpoint:**

- [x] New `Export` type documented in facts/mod.rs
- [x] Rename.rs no longer calls parse_and_analyze for exports
- [x] All tests pass: `cargo nextest run --workspace`

---

###### Step 6.10: Transitive Star Import Expansion {#step-6-10}

**Commit:** `feat(python): expand star imports transitively`

**References:** Q04 (#q04-star-transitivity), Table T13 (#t13-star-imports), Spec S11 (#s11-star-expansion)

**Status:** **COMPLETE**

**Context:**

Star import chains are a common pattern in real Python packages. Consider:

```python
# pkg/core.py
def process_data(): pass
__all__ = ['process_data']

# pkg/internal.py
from .core import *  # Imports process_data from core

# pkg/__init__.py
from .internal import *  # Should transitively import process_data from core

# main.py
from pkg import process_data  # This should resolve to pkg/core.py
```

Currently, Step 6.8 implements single-level star import expansion. When `pkg/__init__.py` does `from .internal import *`, we expand the bindings from `internal.py`. But if `internal.py` itself got those bindings from a star import (`from .core import *`), we don't follow the chain.

**The Problem:**

1. `internal.py` star-imports from `core.py` - we expand `process_data` as a binding in `internal.py`
2. `__init__.py` star-imports from `internal.py` - we look for bindings in `internal.py`
3. We find `process_data` as a binding, but it's an IMPORT binding (from star import), not an original definition
4. We need to trace back through the star import chain to find the original definition in `core.py`

**Algorithm (Spec S12: Transitive Star Import Expansion)** {#s12-transitive-star}

```
expand_star_import_transitive(star_import, source_file_id, file_exports_map, visited):
    1. If source_file_id in visited, return [] (cycle detected)
    2. Add source_file_id to visited
    3. Get (exports, symbols) from file_exports_map[source_file_id]
    4. result = []
    5. If exports is not empty:
        - For each name in exports:
            - Find the symbol/binding for name in source_file
            - If it's an original definition: add (name, source_file) to result
            - If it's from a star import: recursively expand that star import
    6. Else (no __all__):
        - For each public symbol in symbols:
            - If it's an original definition: add (name, source_file) to result
            - If it's from a star import: recursively expand that star import
    7. Return result with deduplicated entries
```

**Key Implementation Details:**

1. **Track star import sources**: When expanding a star import, we need to know which bindings came from star imports vs direct definitions
2. **Follow the chain**: For bindings that came from star imports, recursively expand to find the original source
3. **Cycle detection**: Use a visited set to prevent infinite loops (`a.py` -> `b.py` -> `a.py`)
4. **Preserve the origin**: The final binding should point to the ORIGINAL definition, not intermediate re-exports

**Tasks:**

**Analysis Phase:**

- [x] Audit current star import expansion to understand what information is available
- [x] Determine how to track "this binding came from a star import" vs "this is a direct definition"
- [x] Design the data structures needed for transitive resolution

**Implementation:**

- [x] Modify `FileImportResolver.add_star_import_binding` to track the source of each binding
- [x] Implement `expand_star_import_transitive` function
- [x] Update Pass 3 star import expansion to use transitive resolution
- [x] Add cycle detection with visited set
- [x] Handle mixed cases: some bindings direct, some from star imports

**Edge Cases:**

- [x] Cycle detection: `a.py: from b import *` / `b.py: from a import *`
- [x] Diamond pattern: `d.py` imports from both `b.py` and `c.py`, both star-import from `a.py`
- [x] Mixed star/direct: `internal.py` has some direct defs and some star imports
- [x] Chain depth: `a -> b -> c -> d -> ...` (no artificial limit, but test reasonable depths)

**Test Scenarios:**

```python
# Scenario 1: Two-level chain
# pkg/core.py
def original(): pass
__all__ = ['original']

# pkg/internal.py
from .core import *  # Gets 'original'

# pkg/__init__.py
from .internal import *  # Should get 'original' tracing back to core

# main.py
from pkg import original  # Must resolve to pkg/core.py

# Scenario 2: Three-level chain
# pkg/deep/base.py
def deep_func(): pass

# pkg/deep/__init__.py
from .base import *

# pkg/__init__.py
from .deep import *

# main.py
from pkg import deep_func  # Must resolve to pkg/deep/base.py

# Scenario 3: Cycle detection
# pkg/a.py
x = 1
from .b import *

# pkg/b.py
y = 2
from .a import *  # Cycle! Should handle gracefully

# Scenario 4: Diamond
# pkg/base.py
def shared(): pass

# pkg/left.py
from .base import *

# pkg/right.py
from .base import *

# pkg/__init__.py
from .left import *
from .right import *  # 'shared' appears from both paths - should dedupe
```

**Exit Criteria:**

- [x] Transitive star imports resolve to original definitions
- [x] Cycle detection prevents infinite loops
- [x] Diamond patterns handled (no duplicate bindings)
- [x] All previous tests continue to pass
- [x] New tests for transitive scenarios pass

**Checkpoint:**

- [x] `cargo nextest run -p tugtool-python transitive_star` passes
- [ ] Spike scenario for transitive star imports passes (no spike scenario exists yet)
- [x] All tests pass: `cargo nextest run --workspace`

---

##### Step 6 Summary {#step-6-summary}

After completing Steps 6.1-6.10, tugtool supports:

| Category | Status |
|----------|--------|
| Basic `import` statements | **COMPLETE** (already working) |
| Basic `from ... import` statements | **COMPLETE** (already working) |
| Single-level relative imports | **COMPLETE** (Steps 0-5) |
| Multi-level relative imports | **COMPLETE** (Step 6.1 - tests pass, resolution works) |
| Re-export chain resolution | **COMPLETE** (Step 6.2 - chains followed to original definitions) |
| Star import tracking | **COMPLETE** (Step 6.3 - tracked with is_star=true) |
| Star import expansion (single-level) | **COMPLETE** (Step 6.8 - expanded to individual bindings) |
| Star import expansion (transitive) | **COMPLETE** (Step 6.10 - follow star import chains) |
| TYPE_CHECKING imports | **COMPLETE** (Step 6.4 - CST walker traverses if blocks) |
| Aliased import rename | **COMPLETE** (aliases preserved, only imported names renamed) |
| Import alias tracking | **COMPLETE** (Step 6.7 - audit complete, dual indexes) |
| Export tracking in FactsStore | **COMPLETE** (Step 6.9 - no re-parsing) |
| Namespace packages (PEP 420) | **OUT OF SCOPE** |
| Conditional/dynamic imports | **OUT OF SCOPE** |

---

##### Step 6 Priority Order {#step-6-priority}

| Substep | Priority | Rationale |
|---------|----------|-----------|
| Step 6.2: Re-Export Chains | **P0** | Blocks spike test, most impactful |
| Step 6.5: Spike Scenarios | **P0** | Validation for 6.2 |
| Step 6.1: Multi-Level Relative | **P1** | Low effort, may already work |
| Step 6.3: Star Imports | **P1** | Common pattern, moderate effort |
| Step 6.4: TYPE_CHECKING | **P2** | Less common, lower impact |
| Step 6.6: Documentation | **P2** | Precedes cleanup work |
| Step 6.7: Import Alias Audit | **P2** | Technical debt cleanup |
| Step 6.8: Star Import Expansion | **P2** | Builds on 6.7, enables full star import support |
| Step 6.9: FactsStore Exports | **P2** | Architectural improvement, builds on 6.8 |
| Step 6.10: Transitive Star Imports | **P1** | Common pattern in real packages, builds on 6.8 |

**Recommended Execution Order:** 6.2 -> 6.5 -> 6.1 -> 6.3 -> 6.4 -> 6.6 -> 6.7 -> 6.8 -> 6.9 -> 6.10

---

##### Open Questions for Step 6 {#step-6-questions}

**[Q03] Re-Export Chain Depth Limit (OPEN)** {#q03-chain-depth}

**Question:** Should there be a maximum depth for re-export chain resolution?

**Options:**
1. No limit - follow until original definition or cycle
2. Depth limit of 10 - covers almost all real-world cases
3. Configurable limit

**Recommendation:** Start with no limit, add limit if performance issues arise.

**[Q04] Star Import Transitivity (RESOLVED)** {#q04-star-transitivity}

**Question:** If `a.py` does `from b import *` and `b.py` does `from c import *`, should we transitively expand?

**Options:**
1. Single-level only - expand direct star imports
2. Transitive - follow star import chains
3. Configurable

**Resolution:** Option 2 - Transitive expansion. This is a common pattern in real Python packages (e.g., `__init__.py` files that re-export from submodules). Step 6.10 implements transitive star import expansion.

---

#### Step 7: Final Verification and Cleanup {#step-7}

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

**Deliverable:** Comprehensive static Python import pattern support for cross-file rename operations, enabling reliable refactoring across real-world codebases.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tug run --apply --verify syntax rename-symbol --at lib/utils.py:4:5 --to transform_data` in `spikes/interop-spike/` produces 4 files changed
- [ ] `python3 spikes/interop-spike/main.py` executes without error after rename
- [ ] `cargo nextest run --workspace` passes (no regressions)
- [ ] Re-export chain resolution works (Step 6.2)
- [ ] At least 3 of 4 additional spike scenarios pass (Step 6.5)
- [ ] All acceptance criteria tests pass for relative imports, re-exports, and star imports

**Acceptance tests:**
- [ ] Integration: `cargo nextest run -p tugtool-python ac4_import`
- [ ] Integration: `cargo nextest run -p tugtool-python relative_import`
- [ ] Integration: `cargo nextest run -p tugtool-python reexport`
- [ ] Integration: `cargo nextest run -p tugtool-python star_import`
- [ ] Manual: Spike test end-to-end flow

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Failing Tests Written** {#m01-failing-tests}
- [x] Step 0 complete
- [x] Tests exist that fail due to missing relative import support

**Milestone M02: Core Relative Import Fix** {#m02-core-fix}
- [x] Steps 1-4 complete
- [x] Relative imports resolved in FileImportResolver
- [x] Cross-file references created for relative imports

**Milestone M03: Re-Export Chain Resolution** {#m03-reexport-chains}
- [x] Step 6.2 complete
- [x] Re-export chains followed to original definitions
- [x] Original spike test scenario passes end-to-end

**Milestone M04: Comprehensive Import Support** {#m04-comprehensive}
- [x] Steps 6.1, 6.3, 6.4 complete
- [x] Multi-level relative imports verified
- [x] Star import tracking working (expansion deferred)
- [x] TYPE_CHECKING imports handled

**Milestone M05: Validation and Documentation** {#m05-validation}
- [x] Steps 6.5, 6.6 complete
- [x] Additional spike scenarios passing (3 of 4)
- [x] Documentation updated
- [ ] Step 7 pending (final verification)

**Milestone M06: Technical Debt and Architectural Improvements** {#m06-cleanup}
- [x] Step 6.7 complete (import alias tracking audit)
- [x] Step 6.8 complete (star import expansion)
- [x] Step 6.9 complete (FactsStore export tracking)
- [x] Step 6.10 complete (transitive star import expansion)
- [ ] All spike scenarios pass (4 of 4)
- [x] No re-parsing in rename operations

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Namespace packages (PEP 420) - packages without `__init__.py`
- [ ] Import resolution for installed packages (not just workspace files)
- [ ] Value-level aliasing (`c = b` where `b` is imported)
- [ ] `__all__.extend()` pattern parsing (requires method call tracking)

| Checkpoint | Verification |
|------------|--------------|
| Tests fail before fix | Step 0 tests FAIL |
| Basic relative imports work | Step 4 tests PASS |
| Re-export chains work | Step 6.2 tests PASS |
| Full spike passes | `python3 main.py` succeeds |
| CI green | `just ci` passes |

---

### Implementation Log {#implementation-log}

| Step | Status | Date | Notes |
|------|--------|------|-------|
| Step 0 | complete | 2026-01-22 | Add failing tests - 4 tests fail as expected |
| Step 1 | complete | 2026-01-22 | Added resolve_relative_path with 10 unit tests passing |
| Step 2 | complete | 2026-01-22 | LocalImport now tracks relative_level; relative imports no longer skipped; one Step 0 test now passes |
| Step 3 | complete | 2026-01-22 | FileImportResolver + resolve_module_to_file now handle relative imports; all 288 tests pass |
| Step 4 | complete | 2026-01-22 | All 8 relative_import tests pass; added `from . import module` pattern test; all 1239 workspace tests pass |
| Step 5 | partial | 2026-01-22 | Relative imports work (3 files, 5 edits). Re-export chain not followed—main.py still references old name. This revealed need for comprehensive import support in Step 6. |
| Step 6 | planning | 2026-01-22 | Comprehensive import taxonomy created. Step 6 expanded to 6 substeps covering all static import patterns. |
| Step 6.1 | complete | 2026-01-22 | Multi-level relative imports (`..`, `...`) - tests pass, warning logged but resolution works |
| Step 6.2 | complete | 2026-01-22 | Re-export chain resolution - `resolve_import_chain` follows chains to original definitions |
| Step 6.3 | complete | 2026-01-22 | Star imports TRACKED (not expanded) - existing tests verify tracking, expansion deferred |
| Step 6.4 | complete | 2026-01-22 | TYPE_CHECKING imports work - CST walker traverses if blocks, test added |
| Step 6.5 | complete | 2026-01-22 | 3 of 4 scenarios pass (reexport-chain, multi-level-relative, aliased-import); star-import partial |
| Step 6.6 | complete | 2026-01-22 | Updated Contract C3 docs, removed misleading "unsupported" comments |
| Step 6.7 | complete | 2026-01-22 | Consolidated FileImportResolver with dual indexes, removed BasicImportResolver |
| Step 6.8 | complete | 2026-01-22 | Star import expansion in Pass 3 using source file exports/__all__ |
| Step 6.9 | complete | 2026-01-22 | Export entity in FactsStore, rename uses store.exports_named() |
| Step 6.10 | complete | 2026-01-22 | Transitive star import expansion - follow star import chains |
| Step 7 | pending | | Final verification and cleanup |
