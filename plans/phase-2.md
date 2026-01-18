# Phase 2.0: Workspace Reorganization {#phase-2}

**Purpose:** Reorganize tugtool into a Cargo workspace with separate crates for core infrastructure, the main binary, and language-specific modules, enabling parallel compilation, feature-flag-based language inclusion, and easier contribution of new language support.

---

## Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | ready |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-17 |

---

## Plan Audit History {#plan-audit}

### Audit 2026-01-17: Critical Flaw in Migration Strategy {#audit-2026-01-17}

**Problem Identified:** The original Step 1 converted the root Cargo.toml to a virtual workspace (removing the `[package]` section) BEFORE migrating any code. This immediately orphaned the `src/` directory, breaking all 639 tests.

**Root Cause:** The plan confused the **end state** (virtual workspace, [D07]) with the **migration strategy**. Decision [D07] correctly describes the final structure but was incorrectly implemented as the starting point of Step 1.

**Contradiction:** The Strategy section promised "maintaining a working build at each step" but Step 1 as written immediately broke the build.

**Symptoms:**
- `cargo nextest run` shows "0 tests to run" after Step 1
- Root `src/` code is orphaned (no package compiles it)
- Empty crate skeletons in `crates/` don't help

**Current State (as of audit):**
- Git status shows Step 1 was partially executed with the WRONG approach
- Root Cargo.toml is a virtual workspace (no `[package]`)
- `crates/` exist with empty skeletons
- All code still in `src/` but orphaned
- **ACTION REQUIRED:** Revert to pre-Step-1 state and re-execute with corrected plan

**Resolution Applied:**
1. Updated [D07] to clarify it describes the END STATE, not the starting point
2. Rewrote Step 1 to use a **hybrid workspace** (both `[workspace]` AND `[package]` sections)
3. Updated all Step 2 substeps to require `cargo nextest run` at each checkpoint
4. Rewrote Step 6.1 to handle the final conversion from hybrid to virtual workspace
5. Added critical warnings throughout to prevent this mistake
6. Added Milestone M00 to verify hybrid workspace is established correctly
7. Added test count verification (639 tests) at all milestones

**Key Insight:** Incremental migration requires maintaining the existing compilation path until the new path is ready. You cannot delete the old structure until the new structure can build everything.

**Rollback Instructions (if Step 1 was already executed incorrectly):**
```bash
# Revert to state before Step 1
git checkout HEAD~1 -- Cargo.toml
git checkout HEAD~1 -- Cargo.lock
rm -rf crates/

# Verify tests pass again
cargo nextest run  # Should show 639 tests
```

---

## Phase Overview {#phase-overview}

### Context {#context}

Tugtool is currently structured as a single crate with all functionality in `src/`. As the project grows to support multiple languages (Python now, Rust planned), this monolithic structure creates challenges:

1. **Compilation time**: Any change recompiles everything
2. **Coupling**: Language-specific code can accidentally depend on other language modules
3. **Feature management**: No clean way to build without certain language support
4. **Contributor friction**: New language support requires understanding the entire codebase

A workspace structure with separate crates addresses all these concerns while maintaining the existing API surface.

### Strategy {#strategy}

- **Incremental migration**: Move code in phases, maintaining a working build at each step
- **Hybrid workspace during migration**: Root Cargo.toml has BOTH `[workspace]` AND `[package]` sections until Step 6
- **Core-first approach**: Extract the shared infrastructure first (`tugtool-core`), then build language crates on top
- **Preserve public API**: The `tugtool` crate re-exports everything users currently depend on
- **Feature flags for languages**: Each language crate is an optional dependency, controlled by features
- **Test migration alongside code**: Move tests with their corresponding modules to maintain coverage
- **No functional changes**: This is purely a structural refactor; behavior remains identical
- **Virtual workspace as END STATE**: Convert to virtual workspace only in Step 6 after all code is migrated

> **CRITICAL INVARIANT**: `cargo nextest run` must pass at every checkpoint. If tests fail after a step, do NOT proceed - fix the issue first.

### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool developers contributing new language support
2. Users who want minimal builds (core + specific languages only)
3. CI/CD pipelines benefiting from parallel compilation

### Success Criteria (Measurable) {#success-criteria}

- All existing tests pass (`cargo nextest run`)
- Clean incremental builds after touching only language-specific code
- `cargo build --no-default-features` produces a working binary (core only)
- `cargo build --features python` includes Python support
- No changes to CLI interface or JSON output schemas
- Build time improvement measurable via `cargo build --timings`

### Scope {#scope}

1. Create workspace structure with `crates/` directory
2. Extract `tugtool-core` crate (shared infrastructure)
3. Extract `tugtool-python` crate (Python language support)
4. Create placeholder `tugtool-rust` crate (future)
5. Refactor main `tugtool` crate to compose the above
6. Add feature flags for language inclusion/exclusion

### Non-goals (Explicitly out of scope) {#non-goals}

- Adding new functionality or refactoring operations
- Changing any public API signatures
- Implementing Rust language support (placeholder only)
- Breaking changes to CLI or JSON output
- Changing the `.tug/` session directory structure

### Dependencies / Prerequisites {#dependencies}

- All existing tests must pass before starting
- Understanding of current module interdependencies (analyzed below)

### Constraints {#constraints}

- Must maintain backwards compatibility with existing `cargo install tugtool` (from crates.io)
- Feature names must be stable for downstream users
- Workspace must work with existing CI configuration
- CI/scripts assuming root is a package must be updated (virtual workspace has no root package)
- Local development install changes from `cargo install --path .` to `cargo install --path crates/tugtool`

### Assumptions {#assumptions}

- Cargo workspace member ordering allows parallel compilation
- No circular dependencies exist between proposed crate boundaries
- All integration tests can run against the composed binary

---

## Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

### [Q01] MCP server crate placement (DECIDED) {#q01-mcp-placement}

**Question:** Should MCP server code live in `tugtool-core` or remain in the main `tugtool` crate?

**Why it matters:** MCP depends on `rmcp` which is a heavy dependency. Placing it in core means core carries that weight even for non-MCP builds.

**Options:**
- Keep MCP in main `tugtool` crate (current plan)
- Create separate `tugtool-mcp` crate
- Include in `tugtool-core` behind a feature flag

**Plan to resolve:** Start with MCP in main crate; evaluate if extraction needed based on build times.

**Resolution:** DECIDED - MCP stays in main `tugtool` crate, controlled by existing `mcp` feature flag.

### [Q02] Test organization strategy (OPEN) {#q02-test-organization}

**Question:** Should integration tests remain in the workspace root or move to individual crates?

**Why it matters:** Integration tests that exercise the full stack need access to all crates. Moving them complicates the test setup.

**Options:**
- Keep all integration tests in `tests/` at workspace root
- Move unit tests to crates, keep integration tests at root
- Each crate has its own `tests/` directory

**Plan to resolve:** Evaluate during Step 2; document chosen approach.

**Resolution:** OPEN - Will decide during implementation.

---

## Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Circular dependencies discovered | high | low | Analyze deps before moving; refactor if found | Build fails during migration |
| Test coverage gaps after migration | med | med | Run coverage before/after; diff reports | Coverage drops >1% |
| Build time regression | low | low | Measure with `--timings`; revert if slower | Build time increases |

**Risk R01: Hidden coupling in current code** {#r01-hidden-coupling}

- **Risk:** Unexpected dependencies between modules may prevent clean separation
- **Mitigation:**
  - Analyze `use` statements before migration
  - Create abstraction traits if coupling found
  - Document any necessary restructuring
- **Residual risk:** Some coupling may require interface changes

---

## 2.0.0 Design Decisions {#design-decisions}

### [D01] Workspace structure with crates/ directory (DECIDED) {#d01-workspace-structure}

**Decision:** Use a `crates/` directory to hold all workspace members.

**Rationale:**
- Clean separation from workspace root files (Cargo.toml, README, etc.)
- Follows common Rust workspace conventions (rustc, cargo, ripgrep)
- Easy to glob for CI/tooling (`crates/*/Cargo.toml`)

**Implications:**
- Main binary moves from `src/` to `crates/tugtool/src/`
- Workspace Cargo.toml at root defines members

### [D02] Core crate contains shared infrastructure (DECIDED) {#d02-core-crate}

**Decision:** `tugtool-core` contains all language-agnostic infrastructure: session, workspace, patch, sandbox, output, error, facts, text, diff, util.

**Rationale:**
- These modules have no language-specific dependencies
- Forms the stable foundation for all language adapters
- Smaller core = faster compilation for language-specific changes

**Implications:**
- Core has no feature flags for languages
- Language crates depend on core, not vice versa
- `facts/` module provides language-agnostic symbol/reference types

### [D03] Language crates are optional dependencies (DECIDED) {#d03-optional-languages}

**Decision:** Each language crate (`tugtool-python`, `tugtool-rust`) is an optional dependency of the main `tugtool` crate, controlled by feature flags.

**Rationale:**
- Users can build minimal binaries
- Clear compilation boundaries
- Each language can have isolated dependencies

**Implications:**
- Default features include all supported languages
- Feature names: `python`, `rust` (short, clear)
- Conditional compilation in CLI dispatch code

### [D04] Main crate composes and re-exports (DECIDED) {#d04-main-crate}

**Decision:** The `tugtool` crate contains: main.rs, cli.rs, mcp.rs, and re-exports from core/language crates.

**Rationale:**
- Single binary entry point
- CLI logic dispatches to language crates based on file types
- MCP server stays here (depends on multiple languages)

**Implications:**
- `tugtool` crate has `[dependencies]` on core and language crates
- Public API surface maintained via `pub use` re-exports
- Version numbers stay synchronized

### [D05] Testcmd module stays in main crate (DECIDED) {#d05-testcmd}

**Decision:** `testcmd.rs` (test command resolution) remains in the main `tugtool` crate.

**Rationale:**
- Test command resolution may need to know about multiple languages
- It's primarily used by CLI and MCP, not by core or language crates

**Implications:**
- testcmd can import from language crates if needed
- Future: may spawn language-specific test runners

### [D06] Synchronized versions across workspace (DECIDED) {#d06-versions}

**Decision:** All crates in the workspace share the same version number, maintained in workspace Cargo.toml.

**Rationale:**
- Simplifies release process
- Clear compatibility guarantees
- Workspace inheritance makes this easy

**Implications:**
- Use `version.workspace = true` in member Cargo.toml files
- Bump all versions together on release

### [D07] Virtual workspace (no root package) - END STATE (DECIDED) {#d07-virtual-workspace}

**Decision:** The **final** root `Cargo.toml` is a **virtual workspace** with no `[package]` section. All crates live in `crates/`.

**CRITICAL: Migration Path**
This is the **end state**, not the starting point. The migration MUST use a **hybrid workspace** approach:

1. **During migration:** Root Cargo.toml has BOTH `[workspace]` AND `[package]` sections. This keeps `src/` compiled and all tests running throughout migration.
2. **After migration complete:** Remove `[package]` section from root, making it a pure virtual workspace.

Converting to virtual workspace **before** migrating code would orphan `src/` and break all tests.

**Rationale:**
- Matches Rust ecosystem conventions (rustc, ripgrep, cargo itself)
- Clean separation between workspace metadata and crate code
- Avoids confusion about "which crate am I building?"

**Implications:**
- `cargo build` from root builds all crates (or default members)
- `cargo install tugtool` works from crates.io (publishes from `crates/tugtool`)
- Local install requires: `cargo install --path crates/tugtool`
- CI scripts must be updated if they assume root is a package

### [D08] Naming and packaging contract (DECIDED) {#d08-naming-contract}

**Decision:** Maintain current naming for compatibility.

| Item | Value |
|------|-------|
| Package name | `tugtool` |
| Binary name | `tug` |
| Library name | `tugtool` |
| crates.io install | `cargo install tugtool` |
| Local dev install | `cargo install --path crates/tugtool` |
| Library usage | `use tugtool::*` (unchanged) |

**Rationale:**
- Users expect `cargo install tugtool` to continue working
- Binary name `tug` is already established
- Library re-exports maintain API compatibility

**Implications:**
- `crates/tugtool/Cargo.toml` publishes as `tugtool` on crates.io
- README and docs must clarify local vs crates.io install paths

### [D09] Feature-gated CLI behavior (DECIDED) {#d09-feature-gated-cli}

**Decision:** When a language feature is not compiled in, language-specific commands fail gracefully with a clear error message.

**Core-only build (`--no-default-features`) must support:**
- `tug --help`, `tug --version`
- `tug snapshot` (file scanning is language-agnostic)
- `tug session status`

**Language commands without the feature:**
```
$ tug run rename-symbol --at foo.py:1:1 --to bar
error: Python support not compiled in

To enable: cargo install tugtool --features python
```
Exit code: 2 (invalid arguments / unsupported operation)

**Rationale:**
- Users get actionable feedback instead of cryptic errors
- Core functionality remains useful for inspection/snapshot workflows
- Clear path to enable missing features

**Implications:**
- CLI dispatch code must check feature availability
- Error messages must include remediation instructions
- Exit code 2 for "feature not available" aligns with existing error codes

### [D10] MCP decoupled from language features (DECIDED) {#d10-mcp-decoupling}

**Decision:** The `mcp` feature is independent of language features. MCP server starts regardless of which languages are compiled in; individual tools check feature availability at runtime.

**Behavior:**
- `tug_snapshot` → always works
- `tug_rename_symbol` → returns error "Python support not compiled" if `!cfg!(feature = "python")`

**Rationale:**
- MCP server is useful even with partial language support
- Allows agents to discover available capabilities
- Simpler feature matrix (no `mcp-python` combo features)

**Implications:**
- MCP tool implementations must have feature guards
- Tool list/schema should indicate which tools are available
- Default features still include both `python` and `mcp`

### [D11] API surface compile-time guard (DECIDED) {#d11-api-surface-guard}

**Decision:** Add `tests/api_surface.rs` that imports all public types, serving as a compile-time contract for the public API. The test must be **feature-aware** to handle conditional re-exports.

**Implementation:**
```rust
//! Compile-only test to verify public API surface.
//! If this file fails to compile, the public API has regressed.
//!
//! Run with: cargo test -p tugtool --features full -- api_surface

use tugtool::{
    // Core types (always available)
    patch::{Span, FileId, Edit, PatchSet, ContentHash, /* ... */},
    facts::{FactsStore, Symbol, SymbolKind, ReferenceKind, /* ... */},
    error::TugError,
    output::{Location, ReferenceInfo, SymbolInfo},
    session::Session,
    workspace::WorkspaceSnapshot,
    // ... exhaustive list of core types
};

// Feature-gated re-exports
#[cfg(feature = "python")]
use tugtool::python;

#[cfg(feature = "rust")]
use tugtool::rust;

#[test]
fn api_surface_compiles() {
    // This test exists only to verify imports compile.
    // If you're here because this test broke, you may have
    // accidentally removed a public re-export.
}
```

**Rationale:**
- Catches accidental API breakage during refactoring
- Low maintenance cost (just a list of imports)
- Fails fast in CI if re-exports are missing
- Feature-aware structure prevents false failures on minimal builds

**Implications:**
- Must be created before migration begins (baseline)
- Must be updated when intentionally adding/removing public types
- Part of phase exit criteria
- **Must be tested with `--features full`** to validate all re-exports

---

## Deep Dives {#deep-dives}

### Current Module Dependency Analysis {#module-deps}

Analysis of `use` statements in the current codebase reveals the following dependency graph:

**Diagram Diag01: Current Module Dependencies** {#diag01-module-deps}

```
                    +-------------+
                    |   main.rs   |
                    +------+------+
                           |
                    +------v------+
                    |   cli.rs    |<------------+
                    +------+------+             |
                           |                    |
         +-----------------+---------------+    |
         |                 |               |    |
    +----v----+      +-----v-----+   +-----v----+--+
    | mcp.rs  |      | python/   |   | session     |
    +----+----+      +-----+-----+   +-----+-------+
         |                 |               |
         |           +-----v-----+   +-----v-------+
         |           | analyzer  |   | workspace   |
         |           |  worker   |   +-----+-------+
         |           |   ops/    |         |
         |           +-----+-----+         |
         |                 |               |
    +----v-----------------v---------------v------+
    |                  CORE LAYER                  |
    |  +--------+  +--------+  +--------+         |
    |  | patch  |  | facts  |  |sandbox |         |
    |  +--------+  +--------+  +--------+         |
    |  +--------+  +--------+  +--------+         |
    |  | output |  | error  |  |  text  |         |
    |  +--------+  +--------+  +--------+         |
    |  +--------+  +--------+                     |
    |  |  diff  |  |  util  |                     |
    |  +--------+  +--------+                     |
    +---------------------------------------------+
```

**Key observations:**

1. `patch.rs` is the foundation - used by facts, sandbox, output, diff, text, python
2. `facts/` depends only on patch (for Span, FileId, ContentHash)
3. `sandbox.rs` depends on patch and workspace
4. `output.rs` depends on patch (for Span) and facts (for SymbolKind)
5. `python/` depends on facts, patch, output, text, session, diff, util
6. `mcp.rs` depends on cli, error, output (and indirectly on python via cli)
7. `session.rs` depends on workspace
8. No circular dependencies detected

### Proposed Crate Boundaries {#crate-boundaries}

**Table T01: Module to Crate Mapping** {#t01-module-mapping}

| Current Module | Target Crate | Rationale |
|---------------|--------------|-----------|
| `patch.rs` | tugtool-core | Foundation types, no deps |
| `facts/mod.rs` | tugtool-core | Language-agnostic symbol model |
| `error.rs` | tugtool-core | Shared error types |
| `output.rs` | tugtool-core | Shared JSON output types |
| `text.rs` | tugtool-core | Text utilities |
| `diff.rs` | tugtool-core | Diff generation |
| `util.rs` | tugtool-core | General utilities |
| `workspace.rs` | tugtool-core | Workspace snapshots |
| `sandbox.rs` | tugtool-core | Sandboxed operations |
| `session.rs` | tugtool-core | Session management |
| `python/` (all) | tugtool-python | Python language support |
| `rust/mod.rs` | tugtool-rust | Rust placeholder |
| `main.rs` | tugtool | Binary entry point |
| `cli.rs` | tugtool | CLI implementation |
| `mcp.rs` | tugtool | MCP server |
| `testcmd.rs` | tugtool | Test command resolution |
| `lib.rs` | tugtool | Re-exports |

### Target Directory Structure {#target-structure}

**List L01: Final Directory Layout** {#l01-directory-layout}

```
tugtool/
+-- Cargo.toml              # workspace root
+-- Cargo.lock
+-- CLAUDE.md
+-- README.md
+-- crates/
|   +-- tugtool/            # main binary crate
|   |   +-- Cargo.toml
|   |   +-- src/
|   |       +-- main.rs     # CLI entry point
|   |       +-- lib.rs      # re-exports for library usage
|   |       +-- cli.rs      # CLI command implementations
|   |       +-- mcp.rs      # MCP server
|   |       +-- testcmd.rs  # test command resolution
|   |
|   +-- tugtool-core/       # shared infrastructure
|   |   +-- Cargo.toml
|   |   +-- src/
|   |       +-- lib.rs      # module exports
|   |       +-- patch.rs    # Patch IR
|   |       +-- error.rs    # TugError
|   |       +-- output.rs   # JSON output types
|   |       +-- session.rs  # Session management
|   |       +-- workspace.rs # Workspace snapshots
|   |       +-- sandbox.rs  # Sandboxed operations
|   |       +-- text.rs     # Text utilities
|   |       +-- diff.rs     # Diff generation
|   |       +-- util.rs     # General utilities
|   |       +-- facts/
|   |           +-- mod.rs  # Symbol/reference model
|   |
|   +-- tugtool-python/     # Python language support
|   |   +-- Cargo.toml
|   |   +-- src/
|   |       +-- lib.rs      # module exports (replaces mod.rs)
|   |       +-- analyzer.rs
|   |       +-- bootstrap.rs
|   |       +-- dynamic.rs
|   |       +-- env.rs      # Python environment resolution
|   |       +-- files.rs
|   |       +-- libcst_worker.py  # Embedded Python worker script
|   |       +-- lookup.rs
|   |       +-- test_helpers.rs
|   |       +-- type_tracker.rs
|   |       +-- validation.rs
|   |       +-- verification.rs
|   |       +-- worker.rs
|   |       +-- ops/
|   |           +-- mod.rs
|   |           +-- rename.rs
|   |
|   +-- tugtool-rust/       # Rust language support (placeholder)
|       +-- Cargo.toml
|       +-- src/
|           +-- lib.rs      # placeholder
|
+-- tests/                  # workspace-level integration tests
|   +-- integration/
+-- .tug/                   # session directory (unchanged)
+-- plans/                  # planning documents
```

### Feature Flag Design {#feature-flags}

**Table T02: Feature Flags** {#t02-feature-flags}

| Feature | Crate | Description | Dependencies |
|---------|-------|-------------|--------------|
| `default` | tugtool | Full build | `python`, `mcp` |
| `python` | tugtool | Python support | tugtool-python |
| `rust` | tugtool | Rust support (future) | tugtool-rust |
| `mcp` | tugtool | MCP server | rmcp, schemars |
| `full` | tugtool | All languages + MCP | `python`, `rust`, `mcp` |

**Spec S01: Feature Flag Usage** {#s01-feature-flags}

```toml
# crates/tugtool/Cargo.toml
[features]
default = ["python", "mcp"]
python = ["dep:tugtool-python"]
rust = ["dep:tugtool-rust"]
mcp = ["dep:rmcp", "dep:schemars"]
full = ["python", "rust", "mcp"]

[dependencies]
tugtool-core = { path = "../tugtool-core" }
tugtool-python = { path = "../tugtool-python", optional = true }
tugtool-rust = { path = "../tugtool-rust", optional = true }

# MCP dependencies (optional) - versions must match current Cargo.toml
rmcp = { version = "...", features = ["server", "transport-io"], optional = true }
schemars = { version = "...", optional = true }
```

**Note:** All dependency versions in this plan are illustrative. During implementation, use the exact versions from the current `Cargo.toml` to avoid version conflicts.

### Dependency Flow {#dependency-flow}

**Diagram Diag02: Crate Dependency Graph** {#diag02-crate-deps}

```
     +---------------------------------------+
     |              tugtool                   |
     |  (main binary, CLI, MCP)              |
     +-------------------+-------------------+
                         |
           +-------------+-------------+
           |             |             |
           v             v             v
+-------------+ +-------------+ +-------------+
|tugtool-python| |tugtool-rust | |  (MCP deps) |
|  (optional) | | (optional)  | | (optional)  |
+------+------+ +------+------+ +-------------+
       |               |
       +-------+-------+
               |
               v
     +-------------------+
     |   tugtool-core    |
     |  (always present) |
     +-------------------+
               |
               v
     +-------------------+
     |  External crates  |
     | (serde, sha2, etc)|
     +-------------------+
```

---

## 2.0.1 Specification {#specification}

### 2.0.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs:**
- Current single-crate tugtool source code
- Existing Cargo.toml configuration

**Outputs:**
- Cargo workspace with 4 member crates
- Updated CLAUDE.md with new structure documentation
- All tests passing

**Key invariants:**
- Public API surface unchanged (same re-exports from `tugtool`)
- CLI behavior identical
- JSON output schemas unchanged

### 2.0.1.2 Terminology {#terminology}

- **Workspace root**: The top-level `tugtool/` directory containing `Cargo.toml`
- **Member crate**: Each crate in `crates/` directory
- **Core crate**: `tugtool-core`, the shared infrastructure
- **Language crate**: `tugtool-python`, `tugtool-rust`, etc.
- **Main crate**: `tugtool`, the binary and re-export crate

### 2.0.1.3 Public API Surface {#public-api}

**Spec S02: Re-exports from tugtool crate** {#s02-reexports}

The main `tugtool` crate must re-export all types currently accessible via `tugtool::*`:

```rust
// crates/tugtool/src/lib.rs

// Re-export core types
pub use tugtool_core::{
    // patch module
    patch::{
        Anchor, AnchorResolution, ApplyContext, ApplyResult, Conflict,
        ContentHash, Edit, EditKind, EditLabels, FileId, MaterializedPatch,
        OutputEdit, PatchSet, Precondition, Span, WorkspaceSnapshotId,
    },
    // facts module
    facts::{
        FactsStore, FileEntry, ImportEntry, ImportId, Language, ModuleEntry,
        ModuleId, ModuleKind, ReferenceEntry, ReferenceId, ReferenceKind,
        ScopeEntry, ScopeId, ScopeKind, Symbol, SymbolId, SymbolKind,
    },
    // other modules
    error::TugError,
    output::{Location, ReferenceInfo, SymbolInfo},
    session::Session,
    workspace::WorkspaceSnapshot,
    sandbox::{SandboxConfig, SandboxHandle, VerificationResult},
    text, diff, util,
};

// Re-export language modules (conditional)
#[cfg(feature = "python")]
pub use tugtool_python as python;

#[cfg(feature = "rust")]
pub use tugtool_rust as rust;

// CLI and MCP are internal (not re-exported)
```

---

## 2.0.2 Symbol Inventory {#symbol-inventory}

### 2.0.2.1 New crates {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugtool-core` | Shared infrastructure: patch, facts, session, workspace, sandbox, output, error, text, diff, util |
| `tugtool-python` | Python language support: analyzer, worker, ops |
| `tugtool-rust` | Rust language support (placeholder) |

### 2.0.2.2 New files {#new-files}

| File | Purpose |
|------|---------|
| `Cargo.toml` (root) | Workspace definition |
| `crates/tugtool/Cargo.toml` | Main binary crate manifest |
| `crates/tugtool-core/Cargo.toml` | Core crate manifest |
| `crates/tugtool-python/Cargo.toml` | Python crate manifest |
| `crates/tugtool-rust/Cargo.toml` | Rust crate manifest |
| `crates/*/src/lib.rs` | Module root for each crate |

### 2.0.2.3 Moved files {#moved-files}

**Table T03: File Movement Map** {#t03-file-moves}

| Current Location | New Location |
|-----------------|--------------|
| `src/patch.rs` | `crates/tugtool-core/src/patch.rs` |
| `src/facts/mod.rs` | `crates/tugtool-core/src/facts/mod.rs` |
| `src/error.rs` | `crates/tugtool-core/src/error.rs` |
| `src/output.rs` | `crates/tugtool-core/src/output.rs` |
| `src/session.rs` | `crates/tugtool-core/src/session.rs` |
| `src/workspace.rs` | `crates/tugtool-core/src/workspace.rs` |
| `src/sandbox.rs` | `crates/tugtool-core/src/sandbox.rs` |
| `src/text.rs` | `crates/tugtool-core/src/text.rs` |
| `src/diff.rs` | `crates/tugtool-core/src/diff.rs` |
| `src/util.rs` | `crates/tugtool-core/src/util.rs` |
| `src/python/*` | `crates/tugtool-python/src/*` |
| `src/rust/mod.rs` | `crates/tugtool-rust/src/lib.rs` |
| `src/main.rs` | `crates/tugtool/src/main.rs` |
| `src/cli.rs` | `crates/tugtool/src/cli.rs` |
| `src/mcp.rs` | `crates/tugtool/src/mcp.rs` |
| `src/testcmd.rs` | `crates/tugtool/src/testcmd.rs` |
| `src/lib.rs` | `crates/tugtool/src/lib.rs` |

---

## 2.0.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md with new directory structure
- [ ] Add workspace-level README explaining crate organization
- [ ] Document feature flags in main crate README
- [ ] Add inline documentation to each crate's lib.rs

---

## 2.0.4 Test Plan Concepts {#test-plan-concepts}

### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual functions in isolation | Each crate's internal logic |
| **Integration** | Test crates working together | Full rename/analyze flows |
| **Golden** | Compare output against snapshots | JSON schemas, patch output |

### Test Migration Strategy {#test-migration}

1. **Unit tests**: Move with their modules (embedded `#[cfg(test)]` modules stay in place)
2. **Integration tests**: Keep in workspace root `tests/` directory
3. **Golden tests**: Remain in current location, update paths as needed

### Verification Commands {#test-verification}

```bash
# Run all tests (from workspace root)
cargo nextest run

# Run only core tests
cargo nextest run -p tugtool-core

# Run only Python tests
cargo nextest run -p tugtool-python

# Run with specific features
cargo nextest run --no-default-features --features python
```

---

## 2.0.5 Execution Steps {#execution-steps}

### Step 0: Preparation and Baseline {#step-0}

**Commit:** `chore: establish baseline metrics and API surface test before workspace migration`

**References:** [D01] Workspace structure, [D11] API surface guard, (#strategy, #success-criteria)

**Artifacts:**
- Baseline test count and coverage
- Baseline build times via `cargo build --timings`
- Verification that all tests pass
- `tests/api_surface.rs` - compile-time API contract

**Tasks:**
- [x] Run `cargo nextest run` and record pass/fail counts
- [x] Run `cargo build --timings` and save HTML report
- [x] Run `cargo clippy` and fix any warnings
- [x] Create `tests/api_surface.rs` with imports of all current public types (see [D11])
- [x] Ensure clean git status

**API surface test template:**
```rust
//! Compile-only test to verify public API surface.
//! Run with: cargo test -p tugtool --features full -- api_surface

use tugtool::{
    // Core types (always available)
    patch::{Span, FileId, Edit, PatchSet, ContentHash, OutputEdit, /* ... */},
    facts::{FactsStore, Symbol, SymbolKind, ReferenceKind, /* ... */},
    error::TugError,
    // ... exhaustive list of core types
};

// Feature-gated re-exports
#[cfg(feature = "python")]
use tugtool::python;

#[test]
fn api_surface_compiles() {
    // Intentionally empty - this test verifies imports compile
}
```

**Tests:**
- [x] All existing tests pass
- [x] `tests/api_surface.rs` compiles with `--features full`

**Checkpoint:**
- [x] `cargo nextest run` - all tests pass
- [x] `cargo clippy -- -D warnings` - no warnings
- [x] `cargo fmt --check` - no formatting issues
- [x] `tests/api_surface.rs` exists and compiles with `cargo test -p tugtool --features full -- api_surface`

**Rollback:** N/A (no changes yet)

**Commit after all checkpoints pass.**

---

### Step 1: Create Hybrid Workspace Structure {#step-1}

**Commit:** `refactor: create cargo workspace structure with crates directory`

**References:** [D01] Workspace structure, [D07] Virtual workspace (end state), Table T01, List L01, (#target-structure)

**CRITICAL: Hybrid Workspace Approach**

This step creates a **hybrid workspace** where the root is BOTH a workspace AND a package.
This keeps the existing `src/` code compiling and all 639 tests running throughout migration.

**DO NOT** convert to a virtual workspace (removing `[package]`) until Step 6 after all code is migrated.

**Artifacts:**
- `crates/` directory with empty crate skeletons
- **Hybrid** Workspace Cargo.toml at root (has BOTH `[workspace]` AND `[package]` sections)
- Each crate has minimal Cargo.toml and empty lib.rs
- Existing `src/` code continues to compile and run tests

**Tasks:**
- [x] Create `crates/` directory
- [x] Create `crates/tugtool/` with minimal Cargo.toml (empty, for future main crate)
- [x] Create `crates/tugtool-core/` with minimal Cargo.toml
- [x] Create `crates/tugtool-python/` with minimal Cargo.toml
- [x] Create `crates/tugtool-rust/` with minimal Cargo.toml
- [x] Add `[workspace]` section to root Cargo.toml **WHILE KEEPING THE EXISTING `[package]` SECTION**
- [x] Add workspace-level settings (resolver, lints, profile)

**Cargo.toml structure (HYBRID - note both [workspace] AND [package]):**

```toml
# Root Cargo.toml - HYBRID WORKSPACE
# Has both [workspace] and [package] so src/ keeps compiling

[workspace]
resolver = "2"
members = [
    "crates/tugtool-core",
    "crates/tugtool-python",
    "crates/tugtool-rust",
    # NOTE: Do NOT include "crates/tugtool" yet - root IS the tugtool package during migration
]

[workspace.package]
version = "0.1.0"
edition = "2021"
authors = ["Ken Kocienda"]
license = "MIT"
repository = "https://github.com/tugtool/tugtool"

[workspace.lints.rust]
warnings = "deny"

[workspace.lints.clippy]
all = { level = "deny", priority = -1 }
collapsible_if = "allow"

# KEEP THE EXISTING [package] SECTION - this is what makes src/ compile!
[package]
name = "tugtool"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true
# ... keep all existing package configuration ...

# KEEP THE EXISTING [dependencies] - required for src/ to compile
[dependencies]
# ... all existing dependencies stay here ...

# KEEP THE EXISTING [[bin]], [features], etc.

[profile.release]
lto = "thin"
debug = "line-tables-only"

[profile.dev]
debug = 1
incremental = true
codegen-units = 256
lto = false
panic = "unwind"

[profile.test]
debug = 1
incremental = true
lto = false
```

**Tests:**
- [x] `cargo nextest run` - ALL 639 TESTS STILL PASS (critical!)
- [x] `cargo check -p tugtool-core` succeeds (empty crate compiles)

**Checkpoint:**
- [x] `cargo nextest run` - **all existing tests pass** (this is the critical checkpoint!)
- [x] `cargo clippy -- -D warnings` - no warnings
- [x] All four crate directories exist with Cargo.toml and src/lib.rs
- [x] Root Cargo.toml has both `[workspace]` AND `[package]` sections

**Rollback:**
- Remove `crates/` directory
- Restore original Cargo.toml from git

**Commit after all checkpoints pass.**

---

> **WARNING: Common Mistake**
>
> Do NOT remove the `[package]` section from root Cargo.toml during this step!
> Doing so creates a "virtual workspace" which orphans `src/` and breaks all tests.
> The conversion to virtual workspace happens in Step 6 AFTER all code is migrated.

---

### Step 2: Extract tugtool-core {#step-2}

This step is large and broken into substeps.

**CRITICAL: Two-Phase Migration Per Module**

For each module migration, you must:

1. **Copy** the module to the target crate
2. **Wire up imports** in the source crate to use the new location
3. **Verify tests pass** before proceeding

The root package (`src/lib.rs`) must be updated to re-export from `tugtool-core` so that:
- External code using `tugtool::patch::*` continues to work
- Internal code in `src/` can gradually migrate to `use tugtool_core::*`

After Step 2 completes:
- `tugtool-core` contains the migrated modules
- Root `src/lib.rs` re-exports from `tugtool-core`
- Original files in `src/` may be deleted OR kept as thin re-export wrappers (decide per substep)
- All tests continue to pass

#### Step 2.1: Move patch.rs to tugtool-core {#step-2-1}

**Commit:** `refactor(core): move patch module to tugtool-core`

**References:** [D02] Core crate, Table T03, Diagram Diag01, (#module-deps)

**Artifacts:**
- `crates/tugtool-core/src/patch.rs` with full implementation
- Updated `crates/tugtool-core/Cargo.toml` with required dependencies
- Updated root `src/patch.rs` to re-export from tugtool-core (OR deleted with lib.rs updated)
- Updated root `Cargo.toml` with `tugtool-core` dependency

**Tasks:**
- [ ] Add `tugtool-core` as a dependency in root `Cargo.toml`:
      ```toml
      [dependencies]
      tugtool-core = { path = "crates/tugtool-core" }
      ```
- [ ] Copy `src/patch.rs` to `crates/tugtool-core/src/patch.rs`
- [ ] Add `pub mod patch;` to core lib.rs
- [ ] Add dependencies to core Cargo.toml: `serde`, `sha2`, `hex`
- [ ] Update imports in `crates/tugtool-core/src/patch.rs` (remove `crate::` prefix for now)
- [ ] Update root `src/lib.rs` to re-export: `pub use tugtool_core::patch;`
- [ ] Either delete `src/patch.rs` OR replace with: `pub use tugtool_core::patch::*;`
- [ ] Verify BOTH core crate AND root package compile
- [ ] Verify all tests pass

**Dependencies for tugtool-core/Cargo.toml:**
```toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
sha2 = "0.10"
hex = "0.4"
```

**Tests:**
- [ ] `cargo check -p tugtool-core` succeeds
- [ ] `cargo nextest run` - all tests pass (critical!)

**Checkpoint:**
- [ ] `cargo check -p tugtool-core` compiles without errors
- [ ] `cargo nextest run` - **all tests still pass** (do not skip this!)
- [ ] `use tugtool::patch::Span` still works (API compatibility)

**Rollback:**
- `git checkout -- crates/tugtool-core/ src/patch.rs src/lib.rs Cargo.toml`

**Commit after all checkpoints pass.**

---

#### Step 2.2: Move text.rs to tugtool-core {#step-2-2}

**Commit:** `refactor(core): move text module to tugtool-core`

**References:** [D02] Core crate, Table T03, (#module-deps)

**Artifacts:**
- `crates/tugtool-core/src/text.rs`
- Updated core lib.rs exports
- Updated root `src/lib.rs` to re-export from tugtool-core

**Tasks:**
- [ ] Copy `src/text.rs` to `crates/tugtool-core/src/text.rs`
- [ ] Add `pub mod text;` to core lib.rs
- [ ] Update imports in core: `use crate::patch::Span` (now internal to core)
- [ ] Update root `src/lib.rs` to re-export: `pub use tugtool_core::text;`
- [ ] Delete or convert `src/text.rs` to re-export wrapper
- [ ] Verify BOTH crates compile and all tests pass

**Tests:**
- [ ] `cargo check -p tugtool-core`
- [ ] `cargo nextest run` - all tests pass

**Checkpoint:**
- [ ] Core crate compiles
- [ ] `cargo nextest run` - **all tests still pass**

**Rollback:**
- `git checkout -- crates/tugtool-core/ src/text.rs src/lib.rs`

**Commit after all checkpoints pass.**

---

#### Step 2.3: Move util.rs, diff.rs to tugtool-core {#step-2-3}

**Commit:** `refactor(core): move util and diff modules to tugtool-core`

**References:** [D02] Core crate, Table T03

**Artifacts:**
- `crates/tugtool-core/src/util.rs`
- `crates/tugtool-core/src/diff.rs`
- Updated root `src/lib.rs` re-exports

**Tasks:**
- [ ] Copy `src/util.rs` to `crates/tugtool-core/src/util.rs`
- [ ] Copy `src/diff.rs` to `crates/tugtool-core/src/diff.rs`
- [ ] Add `pub mod util; pub mod diff;` to core lib.rs
- [ ] Update diff.rs imports to use `crate::patch::OutputEdit`
- [ ] Update root `src/lib.rs` to re-export: `pub use tugtool_core::{util, diff};`
- [ ] Delete or convert `src/util.rs` and `src/diff.rs` to re-export wrappers
- [ ] Verify BOTH crates compile and all tests pass

**Tests:**
- [ ] `cargo check -p tugtool-core`
- [ ] `cargo nextest run` - all tests pass

**Checkpoint:**
- [ ] Core crate compiles
- [ ] `cargo nextest run` - **all tests still pass**

**Rollback:**
- `git checkout -- crates/tugtool-core/ src/util.rs src/diff.rs src/lib.rs`

**Commit after all checkpoints pass.**

---

#### Step 2.4: Move facts/ to tugtool-core {#step-2-4}

**Commit:** `refactor(core): move facts module to tugtool-core`

**References:** [D02] Core crate, Table T03, Diagram Diag01

**Artifacts:**
- `crates/tugtool-core/src/facts/mod.rs`
- Updated core lib.rs
- Updated root `src/lib.rs` re-exports

**Tasks:**
- [ ] Copy `src/facts/mod.rs` to `crates/tugtool-core/src/facts/mod.rs`
- [ ] Add `pub mod facts;` to core lib.rs
- [ ] Update imports in core: `use crate::patch::{ContentHash, FileId, Span}`
- [ ] Update root `src/lib.rs` to re-export: `pub use tugtool_core::facts;`
- [ ] Delete or convert `src/facts/` to re-export wrapper
- [ ] Verify BOTH crates compile and all tests pass

**Tests:**
- [ ] `cargo check -p tugtool-core`
- [ ] `cargo nextest run` - all tests pass

**Checkpoint:**
- [ ] Core crate compiles
- [ ] `cargo nextest run` - **all tests still pass**

**Rollback:**
- `git checkout -- crates/tugtool-core/ src/facts/ src/lib.rs`

**Commit after all checkpoints pass.**

---

#### Step 2.5: Move error.rs and output.rs to tugtool-core {#step-2-5}

**Commit:** `refactor(core): move error and output modules to tugtool-core`

**References:** [D02] Core crate, Table T03

**Artifacts:**
- `crates/tugtool-core/src/error.rs`
- `crates/tugtool-core/src/output.rs`
- Updated root `src/lib.rs` re-exports

**Tasks:**
- [ ] Copy `src/error.rs` to `crates/tugtool-core/src/error.rs`
- [ ] Copy `src/output.rs` to `crates/tugtool-core/src/output.rs`
- [ ] Add `pub mod error; pub mod output;` to core lib.rs
- [ ] Add `thiserror` to core dependencies
- [ ] Update output.rs imports for patch and facts (use `crate::` for core-internal refs)
- [ ] Update root `src/lib.rs` to re-export: `pub use tugtool_core::{error, output};`
- [ ] Delete or convert `src/error.rs` and `src/output.rs` to re-export wrappers
- [ ] Verify BOTH crates compile and all tests pass

**Core dependencies update:**
```toml
thiserror = "2.0"
```

**Tests:**
- [ ] `cargo check -p tugtool-core`
- [ ] `cargo nextest run` - all tests pass

**Checkpoint:**
- [ ] Core crate compiles
- [ ] `cargo nextest run` - **all tests still pass**

**Rollback:**
- `git checkout -- crates/tugtool-core/ src/error.rs src/output.rs src/lib.rs`

**Commit after all checkpoints pass.**

---

#### Step 2.6: Move workspace.rs and session.rs to tugtool-core {#step-2-6}

**Commit:** `refactor(core): move workspace and session modules to tugtool-core`

**References:** [D02] Core crate, Table T03

**Artifacts:**
- `crates/tugtool-core/src/workspace.rs`
- `crates/tugtool-core/src/session.rs`
- Updated root `src/lib.rs` re-exports

**Tasks:**
- [ ] Copy `src/workspace.rs` to `crates/tugtool-core/src/workspace.rs`
- [ ] Copy `src/session.rs` to `crates/tugtool-core/src/session.rs`
- [ ] Add `pub mod workspace; pub mod session;` to core lib.rs
- [ ] Add dependencies: `walkdir`, `chrono`
- [ ] Update imports for workspace and session modules (use `crate::` for core-internal refs)
- [ ] Update root `src/lib.rs` to re-export: `pub use tugtool_core::{workspace, session};`
- [ ] Delete or convert `src/workspace.rs` and `src/session.rs` to re-export wrappers
- [ ] Verify BOTH crates compile and all tests pass

**Core dependencies update:**
```toml
walkdir = "2"
chrono = { version = "0.4", default-features = false, features = ["std"] }
serde_json = "1.0"
```

**Tests:**
- [ ] `cargo check -p tugtool-core`
- [ ] `cargo nextest run` - all tests pass

**Checkpoint:**
- [ ] Core crate compiles
- [ ] `cargo nextest run` - **all tests still pass**

**Rollback:**
- `git checkout -- crates/tugtool-core/ src/workspace.rs src/session.rs src/lib.rs`

**Commit after all checkpoints pass.**

---

#### Step 2.7: Move sandbox.rs to tugtool-core {#step-2-7}

**Commit:** `refactor(core): move sandbox module to tugtool-core`

**References:** [D02] Core crate, Table T03

**Artifacts:**
- `crates/tugtool-core/src/sandbox.rs`
- Updated root `src/lib.rs` re-exports

**Tasks:**
- [ ] Copy `src/sandbox.rs` to `crates/tugtool-core/src/sandbox.rs`
- [ ] Add `pub mod sandbox;` to core lib.rs
- [ ] Add dependencies: `tempfile`, `tracing`, `wait-timeout`
- [ ] Add target-specific dependency: `libc` (unix)
- [ ] Update imports for sandbox module (use `crate::` for core-internal refs)
- [ ] Update root `src/lib.rs` to re-export: `pub use tugtool_core::sandbox;`
- [ ] Delete or convert `src/sandbox.rs` to re-export wrapper
- [ ] Verify BOTH crates compile and all tests pass

**Core dependencies update:**
```toml
tempfile = "3"
tracing = "0.1"
wait-timeout = "0.2"

[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

**Tests:**
- [ ] `cargo check -p tugtool-core`
- [ ] `cargo nextest run` - all tests pass

**Checkpoint:**
- [ ] Core crate compiles
- [ ] `cargo nextest run` - **all tests still pass** (including sandbox tests)

**Rollback:**
- `git checkout -- crates/tugtool-core/ src/sandbox.rs src/lib.rs`

**Commit after all checkpoints pass.**

---

#### Step 2 Summary {#step-2-summary}

After completing Steps 2.1-2.7, you will have:
- Complete `tugtool-core` crate with all shared infrastructure
- All core modules migrated: patch, facts, error, output, session, workspace, sandbox, text, diff, util
- Root `src/lib.rs` re-exports everything from `tugtool-core`
- Original module files in `src/` either deleted or converted to re-export wrappers
- **All 639 tests still passing** (critical!)
- Clean dependency boundaries

**Final Step 2 Checkpoint:**
- [ ] `cargo nextest run` - **all tests pass** (not just core tests!)
- [ ] `cargo test -p tugtool-core` - core tests pass independently
- [ ] `cargo clippy -p tugtool-core -- -D warnings` - no warnings
- [ ] `cargo clippy -- -D warnings` - no warnings on root package
- [ ] Core crate can be used as dependency (verify with `cargo doc -p tugtool-core`)
- [ ] `tests/api_surface.rs` still compiles (API contract preserved)

---

### Step 3: Extract tugtool-python {#step-3}

#### Step 3.1: Create tugtool-python crate skeleton {#step-3-1}

**Commit:** `refactor(python): create tugtool-python crate with dependency on core`

**References:** [D03] Optional languages, Table T01, (#crate-boundaries)

**Artifacts:**
- `crates/tugtool-python/Cargo.toml` with core dependency
- Basic lib.rs structure

**Tasks:**
- [ ] Configure Cargo.toml with tugtool-core dependency
- [ ] Set up lib.rs module structure matching python/ layout
- [ ] Verify crate compiles (empty modules)

**Python crate Cargo.toml:**
```toml
[package]
name = "tugtool-python"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true

[dependencies]
tugtool-core = { path = "../tugtool-core" }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "2.0"
tempfile = "3"
tracing = "0.1"

[lints]
workspace = true
```

**Checkpoint:**
- [ ] `cargo check -p tugtool-python` succeeds

**Rollback:**
- `git checkout -- crates/tugtool-python/`

**Commit after all checkpoints pass.**

---

#### Step 3.2: Move Python modules to tugtool-python {#step-3-2}

**Commit:** `refactor(python): move all python modules to tugtool-python crate`

**References:** [D03] Optional languages, Table T03

**Artifacts:**
- All files from `src/python/` moved to `crates/tugtool-python/src/`
- Updated imports throughout
- Root `src/lib.rs` updated to re-export from `tugtool-python`
- Root `Cargo.toml` updated with `tugtool-python` dependency

**Tasks:**
- [ ] Add `tugtool-python` as a dependency in root `Cargo.toml`:
      ```toml
      [dependencies]
      tugtool-python = { path = "crates/tugtool-python" }
      ```
- [ ] Copy all files from `src/python/` to `crates/tugtool-python/src/`
- [ ] Update lib.rs in tugtool-python to export all public items
- [ ] Update imports: `use crate::` -> `use tugtool_core::`
- [ ] Fix any module path references
- [ ] Update root `src/lib.rs` to re-export: `pub use tugtool_python as python;`
- [ ] Delete `src/python/` directory (or convert mod.rs to re-export wrapper)
- [ ] Verify BOTH crates compile and all tests pass

**Import pattern changes:**
```rust
// Before (in python/ops/rename.rs)
use crate::facts::{FactsStore, ReferenceKind};
use crate::patch::{FileId, Span};

// After
use tugtool_core::facts::{FactsStore, ReferenceKind};
use tugtool_core::patch::{FileId, Span};
```

**Tests:**
- [ ] `cargo check -p tugtool-python`
- [ ] `cargo nextest run` - **all tests pass** (not just Python crate tests!)

**Checkpoint:**
- [ ] Python crate compiles
- [ ] `cargo nextest run` - **all tests still pass**
- [ ] `use tugtool::python::*` still works (API compatibility)

**Rollback:**
- `git checkout -- crates/tugtool-python/ src/python/ src/lib.rs Cargo.toml`

**Commit after all checkpoints pass.**

---

### Step 4: Create tugtool-rust placeholder {#step-4}

**Commit:** `refactor(rust): create tugtool-rust placeholder crate`

**References:** [D03] Optional languages, Table T01

**Artifacts:**
- `crates/tugtool-rust/Cargo.toml`
- `crates/tugtool-rust/src/lib.rs` with placeholder

**Tasks:**
- [ ] Configure Cargo.toml with tugtool-core dependency
- [ ] Create lib.rs with placeholder comment
- [ ] Move `src/rust/mod.rs` content (if any) to lib.rs
- [ ] Verify crate compiles

**Rust crate lib.rs:**
```rust
//! Rust language support for tugtool.
//!
//! This crate provides Rust-specific refactoring operations using rust-analyzer.
//!
//! **Status:** Placeholder - implementation planned for future phases.

use tugtool_core as _core;

/// Placeholder for Rust analyzer adapter.
pub struct RustAdapter;

impl RustAdapter {
    /// Create a new Rust adapter (placeholder).
    pub fn new() -> Self {
        RustAdapter
    }
}

impl Default for RustAdapter {
    fn default() -> Self {
        Self::new()
    }
}
```

**Checkpoint:**
- [ ] `cargo check -p tugtool-rust` succeeds

**Rollback:**
- `git checkout -- crates/tugtool-rust/`

**Commit after all checkpoints pass.**

---

### Step 5: Refactor main tugtool crate {#step-5}

**CRITICAL: Transitioning the Binary**

This step moves CLI/MCP code to `crates/tugtool/`. At this point:
- Core infrastructure is in `tugtool-core`
- Python support is in `tugtool-python`
- The root still has `src/main.rs`, `src/cli.rs`, etc.

After this step:
- `crates/tugtool/` becomes the main binary crate
- Root `src/` only has re-export lib.rs (will be removed in Step 6)
- All tests still pass

**Important:** During this step, we temporarily have TWO places that can build the `tug` binary (root and `crates/tugtool`). This is resolved in Step 6 when we convert to virtual workspace.

#### Step 5.1: Move CLI files to main crate {#step-5-1}

**Commit:** `refactor: move main, cli, mcp, testcmd to tugtool crate`

**References:** [D04] Main crate, [D05] Testcmd, Table T03

**Artifacts:**
- `crates/tugtool/src/main.rs`
- `crates/tugtool/src/cli.rs`
- `crates/tugtool/src/mcp.rs`
- `crates/tugtool/src/testcmd.rs`
- Updated `crates/tugtool/Cargo.toml` with all dependencies

**Tasks:**
- [ ] Copy `src/main.rs` to `crates/tugtool/src/main.rs`
- [ ] Copy `src/cli.rs` to `crates/tugtool/src/cli.rs`
- [ ] Copy `src/mcp.rs` to `crates/tugtool/src/mcp.rs`
- [ ] Copy `src/testcmd.rs` to `crates/tugtool/src/testcmd.rs`
- [ ] Update `crates/tugtool/Cargo.toml` with dependencies and features (see below)
- [ ] Update imports in all moved files to use `tugtool_core::` and `tugtool_python::`
- [ ] Verify `crates/tugtool` compiles independently
- [ ] Verify root package still compiles (tests still run against root)

**Main crate Cargo.toml:**
```toml
[package]
name = "tugtool"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true
description = "AI-native code transformation engine for verified, deterministic refactors"
repository.workspace = true
readme = "../../README.md"
keywords = ["refactoring", "code-transformation", "ai", "mcp", "cli"]
categories = ["development-tools", "command-line-utilities"]

[[bin]]
name = "tug"
path = "src/main.rs"

[lib]
name = "tugtool"
path = "src/lib.rs"

[dependencies]
tugtool-core = { path = "../tugtool-core" }
tugtool-python = { path = "../tugtool-python", optional = true }
tugtool-rust = { path = "../tugtool-rust", optional = true }

# CLI
clap = { version = "4", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }

# MCP (optional)
rmcp = { version = "0.12", features = ["server", "transport-io"], optional = true }
schemars = { version = "1", optional = true }

[features]
default = ["python", "mcp"]
python = ["dep:tugtool-python"]
rust = ["dep:tugtool-rust"]
mcp = ["dep:rmcp", "dep:schemars"]
full = ["python", "rust", "mcp"]

[lints]
workspace = true
```

**Tests:**
- [ ] `cargo check -p tugtool` (the crates/tugtool package)
- [ ] `cargo nextest run` - all tests still pass (against root package)

**Checkpoint:**
- [ ] `crates/tugtool` compiles: `cargo build -p tugtool`
- [ ] Root package still works: `cargo nextest run` - **all tests pass**
- [ ] Binary works from new location: `cargo run -p tugtool -- --help`

**Rollback:**
- `git checkout -- crates/tugtool/`

**Commit after all checkpoints pass.**

---

#### Step 5.2: Create lib.rs with re-exports {#step-5-2}

**Commit:** `refactor: add re-exports to tugtool lib.rs for API compatibility`

**References:** [D04] Main crate, Spec S02, (#public-api)

**Artifacts:**
- `crates/tugtool/src/lib.rs` with all re-exports

**Tasks:**
- [ ] Create `crates/tugtool/src/lib.rs` with public re-exports from core
- [ ] Add conditional re-exports for language crates
- [ ] Add re-exports for cli, mcp, testcmd modules
- [ ] Verify all previously-public types are accessible via `tugtool::*`
- [ ] Update main.rs to use new module paths

**Checkpoint:**
- [ ] `cargo check -p tugtool` (the crates/tugtool package)
- [ ] `cargo doc -p tugtool` - documentation builds
- [ ] `cargo nextest run` - **all tests still pass**

**Rollback:**
- `git checkout -- crates/tugtool/src/lib.rs`

**Commit after all checkpoints pass.**

---

#### Step 5.3: Update CLI imports and conditional compilation {#step-5-3}

**Commit:** `refactor: update CLI with conditional language support`

**References:** [D03] Optional languages, Table T02, Spec S01

**Artifacts:**
- Updated `cli.rs` with feature-gated language dispatch
- Updated `mcp.rs` with feature-gated tools

**Tasks:**
- [ ] Add `#[cfg(feature = "python")]` guards to Python-specific CLI code
- [ ] Add `#[cfg(feature = "rust")]` guards to Rust-specific CLI code
- [ ] Update MCP tool registration with feature guards
- [ ] Verify build with default features
- [ ] Verify build with `--no-default-features`

**Conditional compilation pattern:**
```rust
// In cli.rs
#[cfg(feature = "python")]
use tugtool_python::ops::rename::PythonRenameOp;

pub fn run_rename(args: &RenameArgs) -> Result<(), TugError> {
    match args.language {
        #[cfg(feature = "python")]
        Language::Python => {
            // Python rename logic
        }
        #[cfg(feature = "rust")]
        Language::Rust => {
            // Rust rename logic (placeholder)
        }
        _ => {
            return Err(TugError::unsupported_language(args.language));
        }
    }
}
```

**Tests:**
- [ ] `cargo build -p tugtool` (default features)
- [ ] `cargo build -p tugtool --no-default-features`
- [ ] `cargo build -p tugtool --features python`
- [ ] `cargo build -p tugtool --features mcp` (MCP without Python - verifies no accidental Python imports)
- [ ] `cargo build -p tugtool --features full`

**Checkpoint:**
- [ ] All feature combinations compile (including `--features mcp` alone)
- [ ] `cargo run -p tugtool -- --help` works
- [ ] MCP-only build has no Python dependencies (verify with `--features mcp` compile)
  - Violation: any `use tugtool_python::` or dependency edge to `tugtool-python` without `#[cfg(feature = "python")]` guard

**Rollback:**
- `git checkout -- crates/tugtool/src/`

**Commit after all checkpoints pass.**

---

### Step 6: Clean up and finalize {#step-6}

**CRITICAL: This step converts from hybrid to virtual workspace**

At this point:
- All code has been migrated to `crates/`
- `crates/tugtool/` is the new main binary crate with all CLI/MCP code
- Root `src/` is no longer needed
- We can now safely convert to a virtual workspace

#### Step 6.1: Convert to virtual workspace and remove old src/ {#step-6-1}

**Commit:** `refactor: convert to virtual workspace, remove old src/`

**References:** [D07] Virtual workspace, Table T03, (#success-criteria)

**Artifacts:**
- Virtual workspace Cargo.toml (no `[package]` section)
- Old `src/` directory removed
- `crates/tugtool` added to workspace members

**Tasks:**
- [ ] Add `"crates/tugtool"` to workspace members list
- [ ] Remove `[package]` section from root Cargo.toml
- [ ] Remove `[dependencies]` section from root Cargo.toml (dependencies are now in crates)
- [ ] Remove `[[bin]]`, `[lib]`, `[features]` sections from root Cargo.toml
- [ ] Delete `src/` directory entirely
- [ ] Update `tests/` directory to use `crates/tugtool` as the test target (may need to move to `crates/tugtool/tests/`)
- [ ] Update any hardcoded paths in tests

**Final root Cargo.toml (virtual workspace):**
```toml
[workspace]
resolver = "2"
members = [
    "crates/tugtool",        # NOW INCLUDED
    "crates/tugtool-core",
    "crates/tugtool-python",
    "crates/tugtool-rust",
]

[workspace.package]
version = "0.1.0"
edition = "2021"
authors = ["Ken Kocienda"]
license = "MIT"
repository = "https://github.com/tugtool/tugtool"

[workspace.lints.rust]
warnings = "deny"

[workspace.lints.clippy]
all = { level = "deny", priority = -1 }
collapsible_if = "allow"

# NO [package] section - this is now a virtual workspace
# NO [dependencies] section - dependencies are in individual crates

[profile.release]
lto = "thin"
debug = "line-tables-only"

[profile.dev]
debug = 1
incremental = true
codegen-units = 256
lto = false
panic = "unwind"

[profile.test]
debug = 1
incremental = true
lto = false
```

**Checkpoint:**
- [ ] `cargo build` succeeds from workspace root
- [ ] `cargo nextest run` - all tests pass
- [ ] `src/` directory no longer exists
- [ ] Root Cargo.toml has NO `[package]` section

**Rollback:**
- `git checkout HEAD~1 -- src/ Cargo.toml`

**Commit after all checkpoints pass.**

---

#### Step 6.2: Update documentation and CI {#step-6-2}

**Commit:** `docs: update CLAUDE.md, README, and CI for workspace structure`

**References:** (#documentation-plan), [D07] Virtual workspace

**Artifacts:**
- Updated CLAUDE.md with new architecture section
- Updated README.md if needed
- Updated CI workflows for workspace commands
- Updated Justfile (if present)

**Tasks:**
- [ ] Update CLAUDE.md Architecture section with new structure
- [ ] Update build commands to reference workspace
- [ ] Document feature flags
- [ ] Update any path references
- [ ] Update `.github/workflows/*.yml` to use `-p tugtool` or `--workspace` as appropriate
- [ ] Update `Justfile` commands (if present) for workspace structure
- [ ] Verify `cargo install --path crates/tugtool` works (document in README)

**CLAUDE.md updates:**
```markdown
## Architecture

tugtool is organized as a Cargo workspace with the following crates:

crates/
+-- tugtool/        # Main binary and CLI
+-- tugtool-core/   # Shared infrastructure
+-- tugtool-python/ # Python language support
+-- tugtool-rust/   # Rust language support (planned)

### Build Commands

# Build all crates
cargo build

# Build specific crate
cargo build -p tugtool-core

# Build with specific features
cargo build --no-default-features --features python
```

**Checkpoint:**
- [ ] CLAUDE.md reflects new structure
- [ ] `cargo doc --workspace` succeeds

**Rollback:**
- `git checkout -- CLAUDE.md README.md`

**Commit after all checkpoints pass.**

---

#### Step 6.3: Verify full test suite and metrics {#step-6-3}

**Commit:** `test: verify workspace migration maintains test coverage`

**References:** (#success-criteria)

**Artifacts:**
- Test report showing all tests pass
- Build timing comparison

**Tasks:**
- [ ] Run full test suite: `cargo nextest run`
- [ ] Run clippy: `cargo clippy --workspace -- -D warnings`
- [ ] Run fmt: `cargo fmt --all --check`
- [ ] Compare build times with baseline from Step 0
- [ ] Verify `cargo install --path crates/tugtool` works

**Checkpoint:**
- [ ] `cargo nextest run` - all tests pass
- [ ] `cargo clippy --workspace -- -D warnings` - no warnings
- [ ] `cargo fmt --all --check` - no formatting issues
- [ ] Build times similar or improved vs baseline

**Rollback:** N/A (verification step)

**Commit after all checkpoints pass.**

---

## 2.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tugtool restructured as Cargo workspace with 4 member crates (tugtool, tugtool-core, tugtool-python, tugtool-rust), feature flags for language selection, and preserved API compatibility.

### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Root Cargo.toml is a **virtual workspace** (no `[package]` section)
- [ ] `src/` directory no longer exists
- [ ] All 4 crates compile independently (`cargo check -p <crate>`)
- [ ] Full test suite passes (`cargo nextest run`)
- [ ] `cargo build -p tugtool --no-default-features` produces working binary
- [ ] `cargo build -p tugtool --features python` includes Python support
- [ ] CLAUDE.md updated with new structure
- [ ] CLI and JSON output unchanged from pre-migration behavior
- [ ] `tests/api_surface.rs` compiles (public API contract preserved)

**Acceptance tests:**
- [ ] Integration test: Full rename operation works end-to-end
- [ ] Integration test: MCP server starts and responds to tool calls
- [ ] Golden test: JSON output schemas unchanged
- [ ] API surface test: All public re-exports accessible

**CRITICAL: Test count verification**
- [ ] Final test count matches baseline from Step 0 (639 tests)

### Milestones (Within Phase) {#milestones}

**Milestone M00: Hybrid workspace established (Step 1)** {#m00-hybrid-workspace}
- [x] Root Cargo.toml has BOTH `[workspace]` AND `[package]` sections
- [x] All 639 tests still pass
- [x] Empty crate skeletons exist in `crates/`

**Milestone M01: Core crate complete (Step 2)** {#m01-core-complete}
- [ ] tugtool-core contains all shared infrastructure
- [ ] Root `src/lib.rs` re-exports from tugtool-core
- [ ] **All 639 tests still pass** (critical!)
- [ ] Core crate tests pass independently

**Milestone M02: Python crate complete (Step 3)** {#m02-python-complete}
- [ ] tugtool-python contains all Python support
- [ ] Root `src/lib.rs` re-exports from tugtool-python
- [ ] **All 639 tests still pass** (critical!)
- [ ] Python crate tests pass independently

**Milestone M03: Workspace integrated (Step 5)** {#m03-workspace-integrated}
- [ ] Main tugtool crate in `crates/tugtool/` composes all pieces
- [ ] Feature flags work correctly
- [ ] **All 639 tests still pass** (critical!)

**Milestone M04: Virtual workspace complete (Step 6)** {#m04-virtual-workspace}
- [ ] Root Cargo.toml has NO `[package]` section
- [ ] `src/` directory removed
- [ ] **All 639 tests still pass** (critical!)

### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Implement actual Rust language support in tugtool-rust
- [ ] Consider extracting MCP to separate crate if build times warrant
- [ ] Add per-crate CI jobs for parallel testing
- [ ] Investigate dynamic plugin loading for languages

| Checkpoint | Verification |
|------------|--------------|
| Virtual workspace | Root Cargo.toml has no `[package]` section |
| src/ removed | `! -d src` (directory does not exist) |
| Workspace compiles | `cargo build --workspace` |
| All tests pass | `cargo nextest run` (must show 639 tests) |
| Features work | `cargo build -p tugtool --no-default-features --features python` |
| No regressions | Compare test counts and build times with baseline |
| API preserved | `tests/api_surface.rs` compiles |

**CRITICAL: If test count drops below baseline at any step, STOP and investigate before proceeding.**

**Commit after all checkpoints pass.**
