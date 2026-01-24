## Phase 10: Architectural Hardening {#phase-10}

**Purpose:** Address accumulated architectural debt: optimize PositionTable, complete scope span tracking, add PEP 420 namespace package support, implement value-level alias tracking, add environment verification, and simplify the CLI for AI assistant workflows.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-23 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

After completing Phase 9 (Editor Interop), the tugtool codebase is functionally complete for its core rename operation. However, several architectural improvements have accumulated:

1. **Performance** - PositionTable uses HashMap where Vec would be faster
2. **Span tracking gaps** - Lambda and comprehension scopes lack lexical spans
3. **Import resolution gaps** - PEP 420 namespace packages don't resolve
4. **Analysis gaps** - Value-level aliases (`b = bar`) aren't tracked
5. **UX gaps** - No environment verification command
6. **CLI complexity** - Multi-step workflow unsuited for AI assistants

This phase addresses these gaps before adding new refactoring operations.

#### Strategy {#strategy}

- **Low-risk first**: Start with isolated optimizations (PositionTable)
- **Build incrementally**: Scope spans → analyzer integration → output enrichment
- **Preserve stability**: Each step leaves tests passing
- **Informational over aggressive**: Value-level aliases shown, not auto-renamed
- **AI-first CLI**: One command to apply, optional preview

#### Success Criteria (Measurable) {#success-criteria}

- All existing tests pass: `cargo nextest run --workspace`
- PositionTable uses `Vec<Option<NodePosition>>` instead of HashMap
- Lambda and comprehension scopes have lexical spans
- PEP 420 namespace packages resolve correctly
- Impact analysis output includes value-level aliases
- `tug doctor` command verifies environment
- `tug rename` applies changes in one command
- `tug analyze` outputs unified diff by default
- No new clippy warnings

#### Scope {#scope}

1. PositionTable optimization (HashMap → Vec)
2. Lambda scope span tracking
3. Comprehension scope span tracking
4. Connect scope spans to analyzer (resolve analyzer.rs:543 TODO)
5. Line/col output enrichment
6. `tug doctor` command
7. PEP 420 namespace package support
8. Value-level alias tracking with impact analysis integration
9. CLI simplification (`rename` and `analyze` commands)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Import resolution for installed packages (requires venv integration)
- `__all__.extend()` pattern parsing (requires method call tracking)
- Cross-file value-level alias tracking (requires import chain integration)
- Automatic alias renaming (`--follow-aliases` flag)
- VS Code extension

#### Dependencies / Prerequisites {#dependencies}

- Phase 9 completion (editor interop in place)
- All existing tests passing

#### Constraints {#constraints}

- Must not break existing JSON output schemas (backward compatible)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| PositionTable change breaks assumptions | high | low | Comprehensive test coverage |
| Namespace package detection false positives | med | low | Exclude .tug/, .git/, __pycache__/; require .py files in dir |
| Alias chain explosion | med | low | Limit chain depth in transitive_aliases() |
| Shadowed variables cause incorrect aliases | med | med | Scope-aware analysis using scope_path |
| Generator expression span edge cases | low | med | Use node span when no explicit parens |
| Alias coverage gaps surprise users | low | med | Document tracked/untracked patterns in output |
| Namespace scan is O(n * depth) | low | med | Dedup parent dirs; cache visited parents |

---

### 10.0 Design Decisions {#design-decisions}

#### [D01] PositionTable Uses Vec Instead of HashMap (DECIDED) {#d01-position-table-vec}

**Decision:** Replace `HashMap<NodeId, NodePosition>` with `Vec<Option<NodePosition>>` indexed by `NodeId.0`.

**Rationale:** NodeIdGenerator assigns sequential IDs; Vec indexing is O(1) with lower constant.

#### [D02] Lambda and Comprehension Spans Start at Opening Token (DECIDED) {#d02-scope-spans}

**Decision:** Lambda spans start at `lambda` keyword; comprehension spans start at opening bracket.

**Rationale:** Consistent with function/class span semantics; opening token defines scope visibility.

#### [D03] Line/Col Computed Lazily at Output Boundary (DECIDED) {#d03-lazy-line-col}

**Decision:** Compute line/col from byte offsets only when serializing output.

**Rationale:** Avoids storing duplicate information; line/col only needed for human-readable output.

#### [D04] tug doctor Checks Environment (DECIDED) {#d04-tug-doctor}

**Decision:** Add `tug doctor` command that verifies workspace root and Python file discovery.

#### [D05] Namespace Packages Use Computed Set (DECIDED) {#d05-namespace-packages}

**Decision:** Build a set of implied namespace package paths by scanning workspace files for directories containing `.py` files but no `__init__.py`.

#### [D06] Value-Alias Tracking is Informational Only (DECIDED) {#d06-alias-informational}

**Decision:** Impact analysis will SHOW potential aliases but NOT automatically rename them.

**Rationale:** `b = bar` creates a NEW binding; user decides what to rename.

#### [D07] Alias Graph is Single-File Scope (DECIDED) {#d07-alias-single-file}

**Decision:** Value-level alias tracking operates per-file for Phase 10.

#### [D08] Use Existing TypeInferenceCollector Data (DECIDED) {#d08-reuse-type-inference}

**Decision:** Build alias graph from existing `AssignmentInfo` data rather than new CST visitor.

#### [D09] Primary Command is Apply-by-Default (DECIDED) {#d09-apply-default}

**Decision:** `tug rename` applies changes by default. Dry-run is opt-in via `--dry-run`.

**Rationale:** AI assistants want to apply changes directly; matches `mv`, `rm`, `git commit` semantics.

#### [D10] Analyze Command for Explicit Preview (DECIDED) {#d10-analyze-command}

**Decision:** Replace `analyze-impact` with `analyze`. Add `--format` flag (diff, json, summary).

**Note:** This is a new library with zero external users. Old commands are simply replaced.

#### [D11] Unified Diff as Default Analysis Output (DECIDED) {#d11-diff-default}

**Decision:** `tug analyze` outputs unified diff by default, not JSON.

**Rationale:** AI assistants read diffs naturally; diffs are compact; matches `git diff`.

#### [D12] Verification Defaults to Syntax (DECIDED) {#d12-verify-default}

**Decision:** All apply operations verify syntax by default. Use `--no-verify` to skip.

**Verification modes:**
- `none`: No verification, apply changes directly
- `syntax` (default): Re-parse all modified files with native CST parser. Verifies output is syntactically valid Python. Does NOT invoke Python interpreter or type checkers.
- `tests`: Run test command after apply (future, not Phase 10)
- `typecheck`: Run type checker after apply (future, not Phase 10)

**"syntax" verification catches:** Broken string literals, indentation errors, missing tokens from incomplete edits.

---

### 10.1 Specification {#specification}

#### 10.1.1 PositionTable {#spec-position-table}

```rust
#[derive(Debug, Default)]
pub struct PositionTable {
    positions: Vec<Option<NodePosition>>,
}

impl PositionTable {
    pub fn new() -> Self;
    pub fn with_capacity(capacity: usize) -> Self;
    pub fn get(&self, id: &NodeId) -> Option<&NodePosition>;
    pub fn insert(&mut self, id: NodeId, position: NodePosition);
    // get_or_insert requires explicit default since NodePosition is not Default
    pub fn get_or_insert(&mut self, id: NodeId, default: NodePosition) -> &mut NodePosition;
}
```

**Growth strategy:** `insert()` grows the Vec using `vec.resize(id.0 + 1, None)` when `id.0 >= positions.len()`. This ensures the Vec is exactly large enough to hold the new entry. Growth is expected to be rare since NodeIdGenerator assigns sequential IDs.

**Note:** `get_or_insert()` provides entry-like semantics with explicit default value.

#### 10.1.2 Scope Spans {#spec-scope-spans}

**Lambda:** Span from `lambda` keyword to end of body expression.

**Comprehensions:**
- `ListComp`: `[` to `]`
- `SetComp`: `{` to `}`
- `DictComp`: `{` to `}`
- `GeneratorExp`:
  - If parenthesized: `(` to `)`
  - If implicit (function argument with no parens): span of entire generator expression node
    - Example: `sum(x for x in xs)` → span covers `x for x in xs`

#### 10.1.3 Line/Col Helper {#spec-line-col}

**Spec S01:** Line/Col Position Computation

**Existing function:** `byte_offset_to_position_str(content: &str, offset: u64) -> (u32, u32)` in `tugtool-core/src/text.rs:124`

Returns 1-indexed (line, col) where:
- `line`: 1-based line number
- `col`: 1-based byte offset from start of line (not Unicode codepoints or graphemes)

**Decision:** Use the existing `byte_offset_to_position_str` function. Do NOT add a new `offset_to_line_col` function. The existing function is already used throughout `rename.rs` and `lookup.rs`.

**Note:** Byte offset matches tree-sitter and LibCST internal representation. Downstream consumers may convert to character columns for display if needed.

#### 10.1.4 tug doctor Response {#spec-doctor}

**Spec S02: Doctor Response Schema**

```json
{
  "status": "ok",
  "schema_version": "1",
  "checks": [
    { "name": "workspace_root", "status": "passed", "message": "..." },
    { "name": "python_files", "status": "passed", "message": "Found 42 Python files" }
  ],
  "summary": { "total": 2, "passed": 2, "warnings": 0, "failed": 0 }
}
```

**Example with warning:**

```json
{
  "status": "ok",
  "schema_version": "1",
  "checks": [
    { "name": "workspace_root", "status": "passed", "message": "Found git root at /path/to/repo" },
    { "name": "python_files", "status": "warning", "message": "Found 0 Python files" }
  ],
  "summary": { "total": 2, "passed": 1, "warnings": 1, "failed": 0 }
}
```

**Workspace root detection order:**
1. Cargo workspace root (directory containing `Cargo.toml` with `[workspace]`)
2. Git repository root (`.git` directory)
3. Current working directory (fallback)

The `workspace_root` check PASSES if a root is found; FAILS only on detection error.

**python_files check behavior:**
- `status: "passed"` with "Found N Python files" if N > 0
- `status: "warning"` with "Found 0 Python files" if no `.py` files exist
- This check never FAILS—it reports what was found with appropriate severity

**Check status values:**
- `passed`: Check succeeded with expected results
- `warning`: Check succeeded but result may indicate a problem (e.g., 0 files found)
- `failed`: Check detected an error condition

**Overall status rule:**
- `status = "ok"` if all checks are `passed` or `warning`
- `status = "failed"` if any check is `failed`

**Note:** The `warning` status allows `tug doctor` to surface potential issues (like an empty workspace) without failing. This is consistent with the "tests must fail loudly" philosophy—a warning is visible, but doesn't block workflows where 0 Python files is intentional.

#### 10.1.5 Namespace Package Resolution {#spec-namespace}

**Spec S03: resolve_module_to_file Algorithm**

1. `resolved_path = module_path.replace('.', '/')`
2. Try `resolved_path + ".py"` → return if found
3. Try `resolved_path + "/__init__.py"` → return if found
4. If `resolved_path` in `namespace_packages` → return namespace marker
5. Return None

**Namespace marker type:**
- Introduce a dedicated enum (e.g., `ResolvedModule { File(&File), Namespace(PathBuf) }`).
- Update `resolve_module_to_file` to return `Option<ResolvedModule>` and adjust all call sites accordingly.

**compute_namespace_packages Algorithm:**

```
compute_namespace_packages(workspace_files, workspace_root):
  namespace_packages = Set()
  for path in workspace_files:
    if path.extension() == "py":
      parent = path.parent()
      while parent != workspace_root && parent.starts_with(workspace_root):
        if parent/__init__.py not in workspace_files:
          if not is_excluded(parent):
            namespace_packages.insert(parent)
        parent = parent.parent()
  return namespace_packages
```

**Performance note:**
- Deduplicate parent directories (e.g., `visited_dirs`) to avoid repeated scanning in large repos.

**Excluded directories:** `.tug/`, `.git/`, `__pycache__/`, any path outside `workspace_root`

#### 10.1.6 AliasGraph Types {#spec-alias-graph}

**Spec S04: AliasInfo and AliasGraph**

```rust
pub struct AliasInfo {
    pub alias_name: String,      // LHS - the new binding (e.g., "b")
    pub source_name: String,     // RHS - what it aliases (e.g., "bar")
    pub scope_path: Vec<String>, // e.g., ["module", "function:process"]
    pub alias_span: Option<Span>,
    pub source_is_import: bool,
    pub confidence: f32,         // 1.0 for simple assignment, lower for complex
}

pub struct AliasGraph {
    // Key is source_name only. Values may contain aliases from different scopes.
    // Consumers filter by scope_path when scope-specific results needed.
    forward: HashMap<String, Vec<AliasInfo>>,  // source -> aliases
    reverse: HashMap<String, Vec<String>>,     // alias -> sources
}
```

**Scope filtering requirement:**
- Impact analysis MUST filter alias candidates by `scope_path`.
- **Scope matching rule:** Exact match only. An alias at `["module", "function:foo"]` does NOT match a target at `["module", "function:foo", "function:inner"]`. This prevents incorrectly surfacing aliases from parent or child scopes.
- Use `alias.scope_path == target.scope_path` for filtering.

**Memory management:**
- AliasGraph lifetime is tied to single-file analysis. Create fresh per file in `analyze_file()`.
- No caching across files in Phase 10.
- Clear/drop after impact analysis is serialized to output.

**Cycle handling in `transitive_aliases()`:**
- Use a `visited: HashSet<String>` to track seen names during traversal.
- If a name is already in `visited`, skip it (do not recurse).
- Return the accumulated aliases excluding the cycle-causing entry.
- Example: `a = b; b = a` returns `[b]` when querying `a`, not infinite loop.

**Alias tracking coverage (Phase 10):**

| Pattern | Tracked? | Notes |
|---------|----------|-------|
| `b = bar` (simple) | Yes | |
| `c = b = bar` (chained) | Yes | Both b and c alias bar |
| `b = bar; c = b` (sequential) | Yes | Transitive: c -> b -> bar |
| `a = b = c = x` (multi-assignment) | Yes | All alias x |
| `a, b = foo, bar` (tuple unpacking) | No | |
| `b: Type = bar` (annotated) | No | |
| `if (b := bar):` (walrus) | No | |
| `b += bar` (augmented) | No | |
| `self.x = y` (attribute assignment) | No | Attribute targets not tracked |
| `for x in items` (loop target) | No | Loop variables not tracked as aliases |
| `obj = module` (attribute alias) | No | |
| `b = bar if cond else baz` (conditional) | No | |

**Spec S05: Impact Analysis Alias Output**

```json
{
  "aliases": [
    {
      "alias_name": "b",
      "source_name": "bar",
      "file": "consumer.py",
      "line": 3,
      "col": 1,
      "scope": ["module", "function:process"],
      "is_import_alias": false,
      "confidence": 1.0
    }
  ]
}
```

#### 10.1.7 CLI Commands {#spec-cli}

**Spec S06: Command Structure**

```
tug rename --at <file:line:col> --to <new_name> [--dry-run] [--verify <mode>] [--no-verify] [--format text|json]
tug analyze rename --at <file:line:col> --to <new_name> [--format diff|json|summary]
```

**Flag precedence:**
- `--no-verify` and `--verify <mode>` are mutually exclusive (CLI should reject both).

**Spec S07: Analyze Output Formats**

- `--format diff` (default): Unified diff
- `--format json`: Full JSON response
- `--format summary`: Brief text summary

**Diff format specification:**
- Use unified diff format (compatible with `git apply` and `patch -p1`)
- Context lines: 3 lines before and after each hunk (standard unified diff)
- Header format: `--- a/<file>` and `+++ b/<file>` (git-style paths)
- Multiple files concatenated with blank line separator
- No color codes in output (plain text)

**Spec S08: Rename Output**

- Default: Human-readable summary
- `--format json`: Full JSON with files_written, edits_count, verification status

---

### 10.2 Symbol Inventory {#symbol-inventory}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `PositionTable` | struct | `inflate_ctx.rs` | Change from type alias to newtype |
| `byte_offset_to_position_str` | fn | `text.rs` | Existing - no changes needed |
| `Command::Doctor` | variant | `main.rs` | New CLI command |
| `DoctorResponse` | struct | `output.rs` | Doctor JSON output |
| `CheckStatus` | enum | `output.rs` | New: `passed`, `warning`, `failed` |
| `compute_namespace_packages` | fn | `analyzer.rs` | Namespace package detection |
| `ResolvedModule` | enum | `analyzer.rs` | New: `File(PathBuf)`, `Namespace(PathBuf)` |
| `AliasInfo` | struct | `alias.rs` | Alias metadata |
| `AliasGraph` | struct | `alias.rs` | Alias graph |
| `AliasOutput` | struct | `output.rs` | Alias JSON output |
| `Command::Rename` | variant | `main.rs` | Top-level rename command |
| `Command::Analyze` | variant | `main.rs` | Preview command with format options |

---

### 10.3 Test Plan {#test-plan}

**Table T01: Namespace Package Test Cases**

| ID | Scenario | Expected |
|----|----------|----------|
| NS-01 | `from utils.helpers import foo` (no `utils/__init__.py`) | Resolves to `utils/helpers.py` |
| NS-02 | `import utils` (namespace package) | Recognizes as namespace |
| NS-03 | Relative import within namespace | Resolves correctly |
| NS-04 | Mixed regular and namespace packages | Both work |

**Table T02: Value-Level Alias Test Cases**

| ID | Pattern | Expected |
|----|---------|----------|
| VA-01 | `b = bar` (direct) | forward["bar"] contains b |
| VA-02 | `c = b = bar` (chained) | Both b and c alias bar |
| VA-03 | `b = bar; c = b` (sequential) | transitive_aliases("bar") = [b, c] |
| VA-04 | `x = x` (self) | Not tracked |
| VA-05 | `a = b; b = a` (cycle) | No infinite loop |

---

### 10.4 Execution Steps {#execution-steps}

#### Step 1: PositionTable Optimization {#step-1}

**Commit:** `perf(python-cst): optimize PositionTable with Vec indexing`

**References:** [D01], (#spec-position-table)

**Files:** `crates/tugtool-python-cst/src/inflate_ctx.rs`

**Tasks:**
- [x] Change PositionTable from type alias to newtype struct
- [x] Implement `new()`, `with_capacity()`, `get()`, `insert()`, `get_or_insert()`
- [x] Update InflateCtx and all callers

**Checkpoint:** `cargo nextest run -p tugtool-python-cst` ✓

---

#### Step 2: Lambda Scope Spans {#step-2}

**Commit:** `feat(python-cst): add lexical span tracking for lambda scopes`

**References:** [D02], (#spec-scope-spans)

**Files:**
- `crates/tugtool-python-cst/src/nodes/expression.rs` - Add token fields, helper function, Lambda inflate
- `crates/tugtool-python-cst/src/parser/grammar.rs` - Pass tokens to literals
- `crates/tugtool-python-cst/src/parser/numbers.rs` - Accept token parameter
- `crates/tugtool-python-cst/src/visitor/scope.rs` - Update visit_lambda

##### Problem Statement

To compute lambda scope spans (from `lambda` keyword to end of body expression), we need to determine the end position of the body expression. However, several expression types currently lack the token fields needed to compute their end positions:

- `Ellipsis` - no `tok` field
- `Integer` - no `tok` field (only stores `value: &'a str`)
- `Float` - no `tok` field (only stores `value: &'a str`)
- `Imaginary` - no `tok` field (only stores `value: &'a str`)
- `SimpleString` - no `tok` field (only stores `value: &'a str`)

Example: For `lambda: 42`, we cannot get the end position of the `42` literal without a token field.

##### Architecture Overview

###### CST Node Structure

The codebase uses a two-phase architecture:
1. **Deflated types** - Parser output, contains `TokenRef` fields for position info
2. **Inflated types** - Final CST, `TokenRef` fields are stripped during inflation

The `#[cst_node]` proc macro in `tugtool-python-cst-derive` automatically:
- Generates `Deflated*` type from the struct definition
- Keeps `TokenRef` fields only in the deflated version
- Filters out `TokenRef` fields from the inflated version (line 284-289 in cstnode.rs)

###### Key Pattern

Looking at existing types like `Name`, `Lambda`, `Yield`, etc., the pattern is:
1. Add `pub(crate) tok: TokenRef<'a>` field to the struct
2. The field is automatically kept in `DeflatedName` but filtered from `Name`
3. During `inflate()`, access `self.tok.start_pos.byte_idx()` and `self.tok.end_pos.byte_idx()`

##### Step 2.1: Add Token Fields to Expression Types {#step-2-1}

###### 2.1.1 Ellipsis

**File:** `crates/tugtool-python-cst/src/nodes/expression.rs`

**Current definition (lines 506-510):**
```rust
#[cst_node(ParenthesizedNode)]
pub struct Ellipsis<'a> {
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,
}
```

**Updated definition:**
```rust
#[cst_node(ParenthesizedNode)]
pub struct Ellipsis<'a> {
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    /// Token for the `...` ellipsis literal.
    pub(crate) tok: TokenRef<'a>,
}
```

**Grammar change required:** Yes - see Step 2.2

**Inflate update (lines 519-526):**
```rust
impl<'r, 'a> Inflate<'a> for DeflatedEllipsis<'r, 'a> {
    type Inflated = Ellipsis<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        let lpar = self.lpar.inflate(ctx)?;
        let rpar = self.rpar.inflate(ctx)?;
        Ok(Self::Inflated { lpar, rpar })
    }
}
```
No changes needed - the `tok` field is automatically filtered out from the inflated type.

###### 2.1.2 Integer

**File:** `crates/tugtool-python-cst/src/nodes/expression.rs`

**Current definition (lines 528-538):**
```rust
#[cst_node(ParenthesizedNode)]
pub struct Integer<'a> {
    /// A string representation of the integer, such as ``"100000"`` or
    /// ``"100_000"``.
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    /// Stable identity assigned during inflation.
    pub(crate) node_id: Option<NodeId>,
}
```

**Updated definition:**
```rust
#[cst_node(ParenthesizedNode)]
pub struct Integer<'a> {
    /// A string representation of the integer, such as ``"100000"`` or
    /// ``"100_000"``.
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    /// Token for the integer literal.
    pub(crate) tok: TokenRef<'a>,

    /// Stable identity assigned during inflation.
    pub(crate) node_id: Option<NodeId>,
}
```

**Inflate method (lines 548-562):** No changes needed - `tok` filtered automatically.

###### 2.1.3 Float

**File:** `crates/tugtool-python-cst/src/nodes/expression.rs`

**Current definition (lines 565-575):**
```rust
#[cst_node(ParenthesizedNode)]
pub struct Float<'a> {
    /// A string representation of the floating point number, such as ```"0.05"``,
    /// ``".050"``, or ``"5e-2"``.
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    /// Stable identity assigned during inflation.
    pub(crate) node_id: Option<NodeId>,
}
```

**Updated definition:**
```rust
#[cst_node(ParenthesizedNode)]
pub struct Float<'a> {
    /// A string representation of the floating point number, such as ```"0.05"``,
    /// ``".050"``, or ``"5e-2"``.
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    /// Token for the float literal.
    pub(crate) tok: TokenRef<'a>,

    /// Stable identity assigned during inflation.
    pub(crate) node_id: Option<NodeId>,
}
```

**Inflate method (lines 585-599):** No changes needed.

###### 2.1.4 Imaginary

**File:** `crates/tugtool-python-cst/src/nodes/expression.rs`

**Current definition (lines 602-608):**
```rust
#[cst_node(ParenthesizedNode)]
pub struct Imaginary<'a> {
    /// A string representation of the complex number, such as ``"2j"``
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,
}
```

**Updated definition:**
```rust
#[cst_node(ParenthesizedNode)]
pub struct Imaginary<'a> {
    /// A string representation of the complex number, such as ``"2j"``
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    /// Token for the imaginary literal.
    pub(crate) tok: TokenRef<'a>,
}
```

**Inflate method (lines 618-628):** No changes needed.

###### 2.1.5 SimpleString

**File:** `crates/tugtool-python-cst/src/nodes/expression.rs`

**Current definition (lines 2439-2450):**
```rust
#[cst_node(ParenthesizedNode, Default)]
pub struct SimpleString<'a> {
    /// The texual representation of the string, including quotes, prefix
    /// characters, and any escape characters present in the original source code,
    /// such as ``r"my string\n"``.
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    /// Stable identity assigned during inflation.
    pub(crate) node_id: Option<NodeId>,
}
```

**Updated definition:**
```rust
#[cst_node(ParenthesizedNode, Default)]
pub struct SimpleString<'a> {
    /// The texual representation of the string, including quotes, prefix
    /// characters, and any escape characters present in the original source code,
    /// such as ``r"my string\n"``.
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    /// Token for the string literal.
    pub(crate) tok: TokenRef<'a>,

    /// Stable identity assigned during inflation.
    pub(crate) node_id: Option<NodeId>,
}
```

**Inflate method (lines 2452-2466):** No changes needed.

##### Step 2.2: Update Parser/Grammar to Populate Tokens {#step-2-2}

###### Ellipsis (grammar.rs line 1072)

**Current:**
```rust
/ lit("...") { Expression::Ellipsis(Box::new(Ellipsis {lpar: vec![], rpar: vec![]}))}
```

**Updated:**
```rust
/ tok:lit("...") { Expression::Ellipsis(Box::new(Ellipsis {lpar: vec![], rpar: vec![], tok}))}
```

###### Numbers - make_number function (grammar.rs lines 1772-1774)

The current `make_number` function receives a `TokenRef` but only passes the string to `parse_number`:

```rust
fn make_number<'input, 'a>(num: TokenRef<'input, 'a>) -> Expression<'input, 'a> {
    super::numbers::parse_number(num.string)
}
```

**Updated:**
```rust
fn make_number<'input, 'a>(num: TokenRef<'input, 'a>) -> Expression<'input, 'a> {
    super::numbers::parse_number(num.string, num)
}
```

###### numbers.rs parse_number (lines 43-69)

**Current:**
```rust
pub(crate) fn parse_number(raw: &str) -> Expression {
    if INTEGER_RE.with(|r| r.is_match(raw)) {
        Expression::Integer(Box::new(Integer {
            value: raw,
            lpar: Default::default(),
            rpar: Default::default(),
        }))
    } else if FLOAT_RE.with(|r| r.is_match(raw)) {
        Expression::Float(Box::new(Float {
            value: raw,
            lpar: Default::default(),
            rpar: Default::default(),
        }))
    } else if IMAGINARY_RE.with(|r| r.is_match(raw)) {
        Expression::Imaginary(Box::new(Imaginary {
            value: raw,
            lpar: Default::default(),
            rpar: Default::default(),
        }))
    } else {
        Expression::Integer(Box::new(Integer {
            value: raw,
            lpar: Default::default(),
            rpar: Default::default(),
        }))
    }
}
```

**Updated:**
```rust
use crate::tokenizer::Token;

type TokenRef<'r, 'a> = &'r Token<'a>;

pub(crate) fn parse_number<'r, 'a>(raw: &'a str, tok: TokenRef<'r, 'a>) -> Expression<'r, 'a> {
    if INTEGER_RE.with(|r| r.is_match(raw)) {
        Expression::Integer(Box::new(Integer {
            value: raw,
            lpar: Default::default(),
            rpar: Default::default(),
            tok,
        }))
    } else if FLOAT_RE.with(|r| r.is_match(raw)) {
        Expression::Float(Box::new(Float {
            value: raw,
            lpar: Default::default(),
            rpar: Default::default(),
            tok,
        }))
    } else if IMAGINARY_RE.with(|r| r.is_match(raw)) {
        Expression::Imaginary(Box::new(Imaginary {
            value: raw,
            lpar: Default::default(),
            rpar: Default::default(),
            tok,
        }))
    } else {
        Expression::Integer(Box::new(Integer {
            value: raw,
            lpar: Default::default(),
            rpar: Default::default(),
            tok,
        }))
    }
}
```

###### Strings - make_string function (grammar.rs lines 2903-2908)

**Current:**
```rust
fn make_string<'input, 'a>(tok: TokenRef<'input, 'a>) -> String<'input, 'a> {
    String::Simple(SimpleString {
        value: tok.string,
        ..Default::default()
    })
}
```

**Updated:**
```rust
fn make_string<'input, 'a>(tok: TokenRef<'input, 'a>) -> String<'input, 'a> {
    String::Simple(SimpleString {
        value: tok.string,
        lpar: Default::default(),
        rpar: Default::default(),
        tok,
        // Note: node_id is NOT included - it's filtered from DeflatedSimpleString by the cst_node macro
    })
}
```

##### Step 2.3: Create `deflated_expression_end_pos()` Helper {#step-2-3}

**File:** `crates/tugtool-python-cst/src/nodes/expression.rs`

Add this helper function to compute the end position of any deflated expression. This needs to be added near the end of the file, possibly after the Expression enum definition or in a dedicated section.

```rust
/// Compute the end byte position of a deflated expression.
///
/// This is needed during Lambda inflation to determine the lexical span end.
/// The span goes from `lambda` keyword to the end of the body expression.
///
/// # Returns
/// The byte index of the end position of the expression.
pub(crate) fn deflated_expression_end_pos<'r, 'a>(expr: &DeflatedExpression<'r, 'a>) -> u64 {
    match expr {
        // Literals with token fields
        DeflatedExpression::Name(n) => {
            // Name may or may not have a token; if it does, use end_pos
            // If not (rare), we can't compute - return 0 as fallback
            n.tok.map(|t| t.end_pos.byte_idx() as u64).unwrap_or(0)
        }
        DeflatedExpression::Ellipsis(e) => {
            if !e.rpar.is_empty() {
                // Parenthesized: use rpar end
                e.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                e.tok.end_pos.byte_idx() as u64
            }
        }
        DeflatedExpression::Integer(i) => {
            if !i.rpar.is_empty() {
                i.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                i.tok.end_pos.byte_idx() as u64
            }
        }
        DeflatedExpression::Float(f) => {
            if !f.rpar.is_empty() {
                f.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                f.tok.end_pos.byte_idx() as u64
            }
        }
        DeflatedExpression::Imaginary(i) => {
            if !i.rpar.is_empty() {
                i.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                i.tok.end_pos.byte_idx() as u64
            }
        }
        DeflatedExpression::SimpleString(s) => {
            if !s.rpar.is_empty() {
                s.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                s.tok.end_pos.byte_idx() as u64
            }
        }

        // Compound expressions - recurse to rightmost component
        DeflatedExpression::Comparison(c) => {
            if !c.rpar.is_empty() {
                c.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else if let Some(last) = c.comparisons.last() {
                deflated_expression_end_pos(&last.comparator)
            } else {
                deflated_expression_end_pos(&c.left)
            }
        }
        DeflatedExpression::UnaryOperation(u) => {
            if !u.rpar.is_empty() {
                u.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&u.expression)
            }
        }
        DeflatedExpression::BinaryOperation(b) => {
            if !b.rpar.is_empty() {
                b.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&b.right)
            }
        }
        DeflatedExpression::BooleanOperation(b) => {
            if !b.rpar.is_empty() {
                b.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&b.right)
            }
        }
        DeflatedExpression::Attribute(a) => {
            if !a.rpar.is_empty() {
                a.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                // Attribute ends at the attr name token
                a.attr.tok.map(|t| t.end_pos.byte_idx() as u64).unwrap_or(0)
            }
        }
        DeflatedExpression::Tuple(t) => {
            if !t.rpar.is_empty() {
                t.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else if let Some(last) = t.elements.last() {
                // Tuple element is Element<Expression>
                deflated_expression_end_pos(&last.value)
            } else {
                0 // Empty tuple - shouldn't happen without parens
            }
        }
        DeflatedExpression::Call(c) => {
            // Call always ends with ) - use the call's rpar_tok
            c.rpar_tok.end_pos.byte_idx() as u64
        }
        DeflatedExpression::GeneratorExp(g) => {
            // Generator expressions: if parenthesized, use rpar; otherwise use for_in end
            if !g.rpar.is_empty() {
                g.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                // Implicit genexp (like sum(x for x in xs)) - use for_in span
                deflated_comp_for_end_pos(&g.for_in)
            }
        }
        DeflatedExpression::ListComp(l) => {
            // List comp ends with ]
            l.rbracket.tok.end_pos.byte_idx() as u64
        }
        DeflatedExpression::SetComp(s) => {
            // Set comp ends with }
            s.rbrace.tok.end_pos.byte_idx() as u64
        }
        DeflatedExpression::DictComp(d) => {
            // Dict comp ends with }
            d.rbrace.tok.end_pos.byte_idx() as u64
        }
        DeflatedExpression::List(l) => {
            // List ends with ]
            l.rbracket.tok.end_pos.byte_idx() as u64
        }
        DeflatedExpression::Set(s) => {
            // Set ends with }
            s.rbrace.tok.end_pos.byte_idx() as u64
        }
        DeflatedExpression::Dict(d) => {
            // Dict ends with }
            d.rbrace.tok.end_pos.byte_idx() as u64
        }
        DeflatedExpression::Subscript(s) => {
            // Subscript ends with ]
            s.rbracket.tok.end_pos.byte_idx() as u64
        }
        DeflatedExpression::StarredElement(s) => {
            if !s.rpar.is_empty() {
                s.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&s.value)
            }
        }
        DeflatedExpression::IfExp(i) => {
            if !i.rpar.is_empty() {
                i.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&i.orelse)
            }
        }
        DeflatedExpression::Lambda(l) => {
            if !l.rpar.is_empty() {
                l.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&l.body)
            }
        }
        DeflatedExpression::Yield(y) => {
            if !y.rpar.is_empty() {
                y.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else if let Some(value) = &y.value {
                match value.as_ref() {
                    DeflatedYieldValue::Expression(e) => deflated_expression_end_pos(e),
                    DeflatedYieldValue::From(f) => deflated_expression_end_pos(&f.item),
                }
            } else {
                y.yield_tok.end_pos.byte_idx() as u64
            }
        }
        DeflatedExpression::Await(a) => {
            if !a.rpar.is_empty() {
                a.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&a.expression)
            }
        }
        DeflatedExpression::ConcatenatedString(c) => {
            if !c.rpar.is_empty() {
                c.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_string_end_pos(&c.right)
            }
        }
        DeflatedExpression::FormattedString(f) => {
            if !f.rpar.is_empty() {
                f.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                // Formatted string ends at its end token (the closing quote)
                // The end field is a &str, we need the token position
                // This is tricky - FormattedString doesn't have an end_tok field
                // We may need to add one or use the last part's position
                // For now, use a heuristic: end of last part or start + estimated length
                if let Some(last_part) = f.parts.last() {
                    deflated_formatted_string_content_end_pos(last_part)
                } else {
                    0 // Fallback
                }
            }
        }
        DeflatedExpression::TemplatedString(t) => {
            if !t.rpar.is_empty() {
                t.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                if let Some(last_part) = t.parts.last() {
                    deflated_templated_string_content_end_pos(last_part)
                } else {
                    0 // Fallback
                }
            }
        }
        DeflatedExpression::NamedExpr(n) => {
            if !n.rpar.is_empty() {
                n.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&n.value)
            }
        }
    }
}

/// Helper for CompFor end position (used by GeneratorExp)
fn deflated_comp_for_end_pos<'r, 'a>(comp_for: &DeflatedCompFor<'r, 'a>) -> u64 {
    // CompFor may have inner_for_in (nested comprehensions) or end at ifs/iter
    if let Some(inner) = &comp_for.inner_for_in {
        deflated_comp_for_end_pos(inner)
    } else if let Some(last_if) = comp_for.ifs.last() {
        deflated_expression_end_pos(&last_if.test)
    } else {
        deflated_expression_end_pos(&comp_for.iter)
    }
}

/// Helper for String end position
fn deflated_string_end_pos<'r, 'a>(s: &DeflatedString<'r, 'a>) -> u64 {
    match s {
        DeflatedString::Simple(ss) => {
            if !ss.rpar.is_empty() {
                ss.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                ss.tok.end_pos.byte_idx() as u64
            }
        }
        DeflatedString::Concatenated(cs) => {
            if !cs.rpar.is_empty() {
                cs.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else {
                deflated_string_end_pos(&cs.right)
            }
        }
        DeflatedString::Formatted(fs) => {
            if !fs.rpar.is_empty() {
                fs.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else if let Some(last_part) = fs.parts.last() {
                deflated_formatted_string_content_end_pos(last_part)
            } else {
                0
            }
        }
        DeflatedString::Templated(ts) => {
            if !ts.rpar.is_empty() {
                ts.rpar.last().unwrap().rpar_tok.end_pos.byte_idx() as u64
            } else if let Some(last_part) = ts.parts.last() {
                deflated_templated_string_content_end_pos(last_part)
            } else {
                0
            }
        }
    }
}

/// Helper for FormattedStringContent end position
fn deflated_formatted_string_content_end_pos<'r, 'a>(
    content: &DeflatedFormattedStringContent<'r, 'a>,
) -> u64 {
    match content {
        DeflatedFormattedStringContent::Text(_) => 0, // Text doesn't have position info
        DeflatedFormattedStringContent::Expression(e) => {
            // Expression ends at its closing brace
            // The after_expr_tok points to conversion/format_spec/rbrace
            if let Some(tok) = &e.after_expr_tok {
                tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&e.expression)
            }
        }
    }
}

/// Helper for TemplatedStringContent end position
fn deflated_templated_string_content_end_pos<'r, 'a>(
    content: &DeflatedTemplatedStringContent<'r, 'a>,
) -> u64 {
    match content {
        DeflatedTemplatedStringContent::Text(_) => 0,
        DeflatedTemplatedStringContent::Expression(e) => {
            if let Some(tok) = &e.after_expr_tok {
                tok.end_pos.byte_idx() as u64
            } else {
                deflated_expression_end_pos(&e.expression)
            }
        }
    }
}
```

**Note:** The above helper function handles all 26 Expression variants. Some edge cases (like FormattedString without end token) may need additional token fields added to those types, or we may need to accept some fallback behavior for rare cases. The implementation above handles most common cases correctly.

##### Step 2.4: Update Lambda inflate() Method {#step-2-4}

**File:** `crates/tugtool-python-cst/src/nodes/expression.rs`

**Current Lambda inflate (lines 2173-2199):**
```rust
impl<'r, 'a> Inflate<'a> for DeflatedLambda<'r, 'a> {
    type Inflated = Lambda<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        let lpar = self.lpar.inflate(ctx)?;
        let whitespace_after_lambda = if !self.params.is_empty() {
            Some(parse_parenthesizable_whitespace(
                &ctx.ws,
                &mut self.lambda_tok.whitespace_after.borrow_mut(),
            )?)
        } else {
            Default::default()
        };
        let mut params = self.params.inflate(ctx)?;
        adjust_parameters_trailing_whitespace(&ctx.ws, &mut params, self.colon.tok)?;
        let colon = self.colon.inflate(ctx)?;
        let body = self.body.inflate(ctx)?;
        let rpar = self.rpar.inflate(ctx)?;
        Ok(Self::Inflated {
            params,
            body,
            colon,
            lpar,
            rpar,
            whitespace_after_lambda,
        })
    }
}
```

**Updated Lambda inflate:**
```rust
impl<'r, 'a> Inflate<'a> for DeflatedLambda<'r, 'a> {
    type Inflated = Lambda<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        // Assign identity for this Lambda node
        let node_id = ctx.next_id();

        // Compute lexical span BEFORE inflating (tokens are stripped during inflation).
        // Lambda lexical span: from `lambda` keyword to end of body expression.
        let lexical_start = self.lambda_tok.start_pos.byte_idx() as u64;
        let lexical_end = deflated_expression_end_pos(&self.body);

        // Record lexical span (if position tracking is enabled)
        ctx.record_lexical_span(
            node_id,
            Span {
                start: lexical_start,
                end: lexical_end,
            },
        );

        let lpar = self.lpar.inflate(ctx)?;
        let whitespace_after_lambda = if !self.params.is_empty() {
            Some(parse_parenthesizable_whitespace(
                &ctx.ws,
                &mut self.lambda_tok.whitespace_after.borrow_mut(),
            )?)
        } else {
            Default::default()
        };
        let mut params = self.params.inflate(ctx)?;
        adjust_parameters_trailing_whitespace(&ctx.ws, &mut params, self.colon.tok)?;
        let colon = self.colon.inflate(ctx)?;
        let body = self.body.inflate(ctx)?;
        let rpar = self.rpar.inflate(ctx)?;
        Ok(Self::Inflated {
            params,
            body,
            colon,
            lpar,
            rpar,
            whitespace_after_lambda,
            node_id: Some(node_id),
        })
    }
}
```

##### Step 2.5: Update visit_lambda() in scope.rs {#step-2-5}

**File:** `crates/tugtool-python-cst/src/visitor/scope.rs`

**Current visit_lambda (lines 321-329):**
```rust
fn visit_lambda(&mut self, _node: &Lambda<'a>) -> VisitResult {
    // Lambda spans are follow-on work (no lexical_span recorded yet)
    self.enter_scope(ScopeKind::Lambda, None);
    VisitResult::Continue
}

fn leave_lambda(&mut self, _node: &Lambda<'a>) {
    self.exit_scope();
}
```

**Updated visit_lambda:**
```rust
fn visit_lambda(&mut self, node: &Lambda<'a>) -> VisitResult {
    // Look up lexical span from PositionTable using Lambda's node_id
    self.enter_scope_with_id(ScopeKind::Lambda, None, node.node_id);
    VisitResult::Continue
}

fn leave_lambda(&mut self, _node: &Lambda<'a>) {
    self.exit_scope();
}
```

##### Step 2.6: Add Test Cases {#step-2-6}

**File:** `crates/tugtool-python-cst/src/visitor/scope.rs`

Add new tests in the `#[cfg(test)]` module:

```rust
#[test]
fn test_scope_lambda_has_lexical_span() {
    let source = "f = lambda x: x + 1";
    //            01234567890123456789
    //                ^lambda starts at byte 4
    //                              ^body ends after '1' at byte 19

    let parsed = parse_module_with_positions(source, None).unwrap();
    let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

    assert_eq!(scopes.len(), 2);

    // Module scope
    assert_eq!(scopes[0].kind, ScopeKind::Module);

    // Lambda scope - should now have lexical span
    assert_eq!(scopes[1].kind, ScopeKind::Lambda);
    let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
    assert_eq!(
        lambda_span.start, 4,
        "Lambda lexical span should start at 'lambda' keyword (byte 4)"
    );
    assert_eq!(
        lambda_span.end, 19,
        "Lambda lexical span should end after body expression (byte 19)"
    );
}

#[test]
fn test_scope_lambda_with_integer_body() {
    let source = "f = lambda: 42";
    //            01234567890123
    //                ^lambda at 4
    //                        ^42 ends at 14

    let parsed = parse_module_with_positions(source, None).unwrap();
    let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

    assert_eq!(scopes.len(), 2);
    let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
    assert_eq!(lambda_span.start, 4);
    assert_eq!(lambda_span.end, 14);
}

#[test]
fn test_scope_lambda_with_string_body() {
    let source = r#"f = lambda: "hello""#;
    //            0123456789012345678
    //                ^lambda at 4
    //                        ^string ends at 19

    let parsed = parse_module_with_positions(source, None).unwrap();
    let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

    assert_eq!(scopes.len(), 2);
    let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
    assert_eq!(lambda_span.start, 4);
    // String is "hello" which is 7 chars, starting at 12, ending at 19
    assert_eq!(lambda_span.end, 19);
}

#[test]
fn test_scope_lambda_with_ellipsis_body() {
    let source = "f = lambda: ...";
    //            012345678901234
    //                ^lambda at 4
    //                        ^... ends at 15

    let parsed = parse_module_with_positions(source, None).unwrap();
    let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

    assert_eq!(scopes.len(), 2);
    let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
    assert_eq!(lambda_span.start, 4);
    assert_eq!(lambda_span.end, 15);
}

#[test]
fn test_scope_nested_lambda_containment() {
    let source = "f = lambda x: lambda y: x + y";
    //            01234567890123456789012345678
    //                ^outer lambda at 4
    //                          ^inner lambda at 14
    //                                      ^ends at 29

    let parsed = parse_module_with_positions(source, None).unwrap();
    let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

    assert_eq!(scopes.len(), 3);

    // Outer lambda
    let outer_span = scopes[1].span.expect("Outer lambda should have span");
    assert_eq!(outer_span.start, 4);
    assert_eq!(outer_span.end, 29);

    // Inner lambda
    let inner_span = scopes[2].span.expect("Inner lambda should have span");
    assert_eq!(inner_span.start, 14);
    assert_eq!(inner_span.end, 29);

    // Verify containment
    assert!(
        outer_span.start <= inner_span.start && inner_span.end <= outer_span.end,
        "Inner lambda should be contained within outer lambda"
    );
}
```

##### Implementation Order

1. **Add token fields to expression types** (Step 2.1)
   - Modify struct definitions in expression.rs
   - No inflate changes needed (proc macro handles filtering)

2. **Update parser/grammar** (Step 2.2)
   - Modify grammar.rs: Ellipsis rule, make_number, make_string
   - Modify numbers.rs: parse_number signature and body

3. **Add deflated_expression_end_pos() helper** (Step 2.3)
   - Add helper function to expression.rs
   - Handle all Expression variants

4. **Update Lambda inflate()** (Step 2.4)
   - Compute and record lexical_span during inflation
   - Add node_id assignment

5. **Update visit_lambda()** (Step 2.5)
   - Change from enter_scope() to enter_scope_with_id()

6. **Add tests** (Step 2.6)
   - Verify lambda spans are correct
   - Test various body expression types

##### Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing parsing | Token fields are optional in proc-macro expansion; existing code continues to work |
| Missing edge cases in deflated_expression_end_pos | Comprehensive match on all Expression variants; fallback to 0 for truly pathological cases |
| FormattedString/TemplatedString missing end position | These are rare lambda bodies; acceptable to have less precise spans for these edge cases |

##### Follow-on Work

Step 3 (Comprehension Scope Spans) will use a similar pattern but is simpler because comprehensions use explicit bracket tokens (`[`, `]`, `{`, `}`) that already exist and have position information.

**Checkpoint:** `cargo nextest run -p tugtool-python-cst scope`

---

#### Step 3: Comprehension Scope Spans {#step-3}

**Commit:** `feat(python-cst): add lexical span tracking for comprehension scopes`

**References:** [D02], (#spec-scope-spans)

**Files:** `crates/tugtool-python-cst/src/inflate.rs`, `visitor/scope.rs`

**Tasks:**
- [x] In `expression.rs`, modify the inflate implementations to record `lexical_span` in PositionTable:
  - `DeflatedListComp::inflate()` - span from `[` to `]`
  - `DeflatedSetComp::inflate()` - span from `{` to `}`
  - `DeflatedDictComp::inflate()` - span from `{` to `}`
  - `DeflatedGeneratorExp::inflate()` - span from `(` to `)` or node span if implicit
- [x] In `visitor/scope.rs`, update the following visitor methods to retrieve spans and set `ScopeInfo.lexical_span`:
  - `visit_list_comp()`
  - `visit_set_comp()`
  - `visit_dict_comp()`
  - `visit_generator_exp()`

**Tests:**

**Table T03: Comprehension Scope Span Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| CS-01 | `test_scope_list_comp_has_lexical_span` | unit | ListComp span from `[` to `]` |
| CS-02 | `test_scope_set_comp_has_lexical_span` | unit | SetComp span from `{` to `}` |
| CS-03 | `test_scope_dict_comp_has_lexical_span` | unit | DictComp span from `{` to `}` |
| CS-04 | `test_scope_generator_exp_parenthesized_has_lexical_span` | unit | GeneratorExp with parens |
| CS-05 | `test_scope_generator_exp_implicit_has_lexical_span` | unit | Implicit genexp in function call |
| CS-06 | `test_scope_nested_comprehensions` | unit | Outer contains inner span |
| CS-07 | `test_scope_comprehension_with_condition` | unit | Span includes if clause |
| CS-08 | `test_scope_comprehension_with_multiple_fors` | unit | Span includes nested for clauses |
| CS-09 | `test_scope_comprehension_inside_lambda` | unit | Lambda span contains comprehension |

- [x] unit test: `test_scope_list_comp_has_lexical_span` - ListComp span boundaries
- [x] unit test: `test_scope_set_comp_has_lexical_span` - SetComp span boundaries
- [x] unit test: `test_scope_dict_comp_has_lexical_span` - DictComp span boundaries
- [x] unit test: `test_scope_generator_exp_parenthesized_has_lexical_span` - Parenthesized genexp
- [x] unit test: `test_scope_generator_exp_implicit_has_lexical_span` - Implicit genexp (sum(x for x in xs))
- [x] unit test: `test_scope_nested_comprehensions` - Containment verification
- [x] unit test: `test_scope_comprehension_with_condition` - if clause included in span
- [x] unit test: `test_scope_comprehension_with_multiple_fors` - nested for in span
- [x] unit test: `test_scope_comprehension_inside_lambda` - lambda contains comprehension
- [x] golden test: `golden_comprehensions_scopes` - verify span fields in JSON output

**Checkpoint:** `cargo nextest run -p tugtool-python-cst scope` ✓

---

#### Step 4: Connect Scope Spans to Analyzer {#step-4}

**Commit:** `fix(python): use native scope spans in analyzer`

**References:** [D02], resolves analyzer.rs:543 TODO

**Prerequisites:** Steps 2-3 must be complete (lambda and comprehension spans implemented)

**Files:** `crates/tugtool-python/src/analyzer.rs`, `cst_bridge.rs`

**Tasks:**
- [x] Pass scope spans from ScopeInfo to CoreScopeInfo
- [x] Remove TODO at analyzer.rs:543

**Tests:**

**Table T04: Scope Span Analyzer Integration Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| SA-01 | `test_analyzer_lambda_scope_has_span` | unit | CoreScopeInfo.span populated for lambda |
| SA-02 | `test_analyzer_listcomp_scope_has_span` | unit | CoreScopeInfo.span populated for listcomp |
| SA-03 | `test_analyzer_function_scope_has_span` | unit | Function scopes retain existing spans |
| SA-04 | `test_analyzer_class_scope_has_span` | unit | Class scopes retain existing spans |
| SA-05 | `test_analyzer_module_scope_has_span` | unit | Module scope (whole file) span |

- [x] unit test: `test_analyzer_lambda_scope_has_span` - verify lambda span flows to CoreScopeInfo
- [x] unit test: `test_analyzer_listcomp_scope_has_span` - verify comprehension span flows to CoreScopeInfo
- [x] unit test: `test_analyzer_function_scope_has_span` - existing function spans unaffected
- [x] unit test: `test_analyzer_class_scope_has_span` - existing class spans unaffected
- [x] unit test: `test_analyzer_module_scope_has_span` - module scope covers full file
- [x] drift prevention test: verify TODO at analyzer.rs:543 is removed (grep for "TODO.*scope.*span")

**Checkpoint:** `cargo nextest run -p tugtool-python` ✓

---

#### Step 5: Line/Col Output Enrichment {#step-5}

**Commit:** `feat(core): add line/col helpers to Location type`

**References:** [D03], Spec S01

**Files:** `crates/tugtool-core/src/types.rs`

**Tasks:**
- [x] Add `with_line_col` helper to Location type that uses existing `byte_offset_to_position_str` from `text.rs`
- [x] No new `offset_to_line_col` function needed - use existing `byte_offset_to_position_str`

**Tests:**

**Table T05: Line/Col Helper Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| LC-01 | `test_with_line_col_first_line` | unit | Byte 0 → (1, 1) |
| LC-02 | `test_with_line_col_second_line` | unit | After newline → (2, 1) |
| LC-03 | `test_with_line_col_mid_line` | unit | Middle of line → correct col |
| LC-04 | `test_with_line_col_unicode` | unit | Unicode chars (byte vs char offset) |
| LC-05 | `test_with_line_col_empty_file` | unit | Empty content edge case |
| LC-06 | `test_with_line_col_trailing_newline` | unit | File ending with newline |

- [x] unit test: `test_with_line_col_first_line` - byte 0 maps to line 1, col 1
- [x] unit test: `test_with_line_col_second_line` - first char after newline
- [x] unit test: `test_with_line_col_mid_line` - arbitrary position on line
- [x] unit test: `test_with_line_col_unicode` - UTF-8 multibyte characters (byte offset, not char)
- [x] unit test: `test_with_line_col_empty_file` - edge case: empty content
- [x] unit test: `test_with_line_col_trailing_newline` - file ends with newline

**Checkpoint:** `cargo nextest run -p tugtool-core` ✓

---

#### Step 6: tug doctor Command {#step-6}

**Commit:** `feat(cli): add tug doctor command`

**References:** [D04], Spec S02

**Files:** `crates/tugtool/src/main.rs`, `cli.rs`, `tugtool-core/src/output.rs`

**Tasks:**
- [x] Add `Command::Doctor` variant
- [x] Add `DoctorResponse`, `CheckResult` types with `status` enum (`passed`, `warning`, `failed`)
- [x] Implement workspace_root check (passes if root found, fails on detection error)
- [x] Implement python_files check (passes if N > 0, warns if N == 0)

**Tests:**

**Table T06: tug doctor Command Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| DR-01 | `test_doctor_git_repo` | integration | Finds git root, status=ok |
| DR-02 | `test_doctor_cargo_workspace` | integration | Finds Cargo.toml root |
| DR-03 | `test_doctor_no_python_files` | integration | 0 Python files → warning |
| DR-04 | `test_doctor_with_python_files` | integration | N > 0 Python files → passed |
| DR-05 | `test_doctor_empty_directory` | integration | No git/cargo → uses cwd |
| DR-06 | `test_doctor_json_schema` | golden | Output matches DoctorResponse schema |
| DR-07 | `test_doctor_summary_counts` | unit | summary.total = len(checks) |

- [x] integration test: `test_doctor_git_repo` - detects .git, workspace_root passes
- [x] integration test: `test_doctor_cargo_workspace` - detects Cargo.toml with [workspace]
- [x] integration test: `test_doctor_no_python_files` - python_files check has status=warning
- [x] integration test: `test_doctor_with_python_files` - python_files check has status=passed
- [x] integration test: `test_doctor_empty_directory` - falls back to cwd, all checks run
- [x] golden test: `test_doctor_json_schema` - verify DoctorResponse schema stability
- [x] unit test: `test_doctor_summary_counts` - summary.total/passed/warnings/failed correct

**Checkpoint:** `tug doctor` produces valid JSON; verify warning status appears when run in empty directory ✓

---

#### Step 7: Compute Namespace Packages {#step-7}

**Commit:** `feat(python): compute namespace packages from workspace files`

**References:** [D05], Spec S03

**Files:** `crates/tugtool-python/src/analyzer.rs`

**Tasks:**
- [x] Add `compute_namespace_packages()` function
- [x] Compute at start of `analyze_files()`

**Tests:**

Uses **Table T01: Namespace Package Test Cases** from Section 10.3.

**Table T07: compute_namespace_packages() Unit Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| NP-01 | `test_compute_namespace_simple` | unit | Dir with .py but no __init__.py |
| NP-02 | `test_compute_namespace_nested` | unit | Multiple levels without __init__.py |
| NP-03 | `test_compute_namespace_mixed` | unit | Some dirs have __init__.py, some don't |
| NP-04 | `test_compute_namespace_excludes_git` | unit | .git/ excluded |
| NP-05 | `test_compute_namespace_excludes_pycache` | unit | __pycache__/ excluded |
| NP-06 | `test_compute_namespace_excludes_tug` | unit | .tug/ excluded |
| NP-07 | `test_compute_namespace_deduplicates` | unit | Same dir not counted twice |

- [x] unit test: `test_compute_namespace_simple` - single namespace package detected
- [x] unit test: `test_compute_namespace_nested` - parent/child namespace packages
- [x] unit test: `test_compute_namespace_mixed` - regular and namespace packages coexist
- [x] unit test: `test_compute_namespace_excludes_git` - .git/ not included
- [x] unit test: `test_compute_namespace_excludes_pycache` - __pycache__/ not included
- [x] unit test: `test_compute_namespace_excludes_tug` - .tug/ not included
- [x] unit test: `test_compute_namespace_deduplicates` - visited dirs cached

**Checkpoint:** `cargo nextest run -p tugtool-python namespace` ✓

---

#### Step 8: Namespace Package Resolution {#step-8}

**Commit:** `feat(python): support PEP 420 namespace packages in import resolution`

**References:** [D05], Spec S03, Table T01

**Files:** `crates/tugtool-python/src/analyzer.rs` (tests), `crates/tugtool-python/src/lookup.rs` (rename only)

##### Naming Clarification (Architecture Fix)

**Problem:** Two functions named `resolve_module_to_file` caused confusion. They do different things at different phases.

**Solution:** Distinct names with clear semantics:

| Function | File | Purpose | When |
|----------|------|---------|------|
| `resolve_module_to_file` | analyzer.rs | **Resolve** module path → file/namespace | During analysis |
| `lookup_module_file` | lookup.rs | **Look up** module's file in FactsStore | Post-analysis |

##### Function Details

1. **`resolve_module_to_file`** (analyzer.rs) - **Resolution during analysis**
   - **Purpose:** Computes what file a module path maps to, handling namespace packages
   - **Signature:** `fn resolve_module_to_file(..., namespace_packages: &HashSet<String>) -> Option<ResolvedModule>`
   - **Returns:** `ResolvedModule::File(path)` or `ResolvedModule::Namespace(path)` or `None`
   - **Status:** ✅ Complete from Step 7

2. **`lookup_module_file`** (lookup.rs) - **Post-analysis query**
   - **Purpose:** Finds a module's File record in the already-built FactsStore
   - **Signature:** `fn lookup_module_file(store: &FactsStore, module_path: &str) -> Option<&File>`
   - **Returns:** Reference to File record or `None` (namespace packages return `None` - correct)
   - **Status:** ✅ Renamed from `resolve_module_to_file`

##### Why lookup.rs Doesn't Need Namespace Package Support

`lookup_module_file` is a **query** on existing data, not a **resolution** algorithm:
- It queries the FactsStore for Files that were analyzed
- Namespace packages have no File (no `__init__.py` to analyze)
- Returning `None` is semantically correct: "no file to look up symbols in"
- The caller (`resolve_import_to_origin`) handles `None` gracefully

**Key Insight:** Namespace packages enable `from namespace_pkg.module import foo` to resolve `namespace_pkg/module.py` during analysis. Post-analysis lookup correctly reports "no file" for the namespace package itself.

##### What Step 7 Already Implemented

- [x] `ResolvedModule` enum with `File(String)` and `Namespace(String)` variants
- [x] `compute_namespace_packages()` function
- [x] `resolve_module_to_file` accepts `namespace_packages` parameter
- [x] Algorithm: try `.py` → try `__init__.py` → check namespace_packages → return None
- [x] All 5 analyzer.rs call sites pass `namespace_packages`
- [x] All call sites use `.as_file()` appropriately (skip namespace packages for symbol lookup)

##### Step 8 Tasks

**Architecture Fix (Done):**
- [x] Rename `resolve_module_to_file` → `lookup_module_file` in lookup.rs
- [x] Update docstring to clarify post-analysis query semantics
- [x] Update call site in `resolve_import_to_origin`

**Tests:**
- [x] Write test `test_resolve_namespace_import_from` (NR-01)
- [x] Write test `test_resolve_namespace_import` (NR-02)
- [x] Write test `test_resolve_namespace_relative` (NR-03)
- [x] Write test `test_resolve_mixed_packages` (NR-04)
- [x] Write test `test_resolve_namespace_deep_nesting` (NR-05)
- [x] Write test `test_resolve_namespace_fallback` (NR-06)
- [x] Write test `test_resolve_namespace_returns_marker` (NR-07)

**Tests:**

Uses **Table T01: Namespace Package Test Cases** from Section 10.3.

**Table T08: Namespace Package Resolution Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| NR-01 | `test_resolve_namespace_import_from` | integration | `from utils.helpers import foo` resolves to `utils/helpers.py` |
| NR-02 | `test_resolve_namespace_import` | integration | `import utils` recognizes namespace package |
| NR-03 | `test_resolve_namespace_relative` | integration | `from . import other` within namespace package |
| NR-04 | `test_resolve_mixed_packages` | integration | Mix of regular (`__init__.py`) and namespace packages |
| NR-05 | `test_resolve_namespace_deep_nesting` | integration | `a.b.c.d.e` where `a/`, `b/`, `c/`, `d/` are all namespace packages |
| NR-06 | `test_resolve_namespace_fallback` | unit | Regular file/init resolution tried before namespace |
| NR-07 | `test_resolve_namespace_returns_marker` | unit | `ResolvedModule::Namespace` returned for namespace package |

##### Test Implementation Notes

**Test fixture structure for NR-01 through NR-05:**
```
test_workspace/
├── utils/                    # Namespace package (no __init__.py)
│   └── helpers.py            # Contains: def foo(): pass
├── regular_pkg/              # Regular package
│   ├── __init__.py
│   └── module.py
└── consumer.py               # from utils.helpers import foo
```

**Key assertions:**
- `resolve_module_to_file("utils", ..., namespace_packages)` → `ResolvedModule::Namespace("utils")`
- `resolve_module_to_file("utils.helpers", ..., namespace_packages)` → `ResolvedModule::File("utils/helpers.py")`
- Star imports from namespace packages produce no exports (correct behavior)
- Rename operations across namespace package boundaries work correctly

**Checkpoint:** `cargo nextest run -p tugtool-python` ✓

---

#### Step 9: AliasGraph Module {#step-9}

**Commit:** `feat(python): add AliasGraph for value-level alias tracking`

**References:** [D06], [D07], [D08], Spec S04, Table T02

**Files:** New `crates/tugtool-python/src/alias.rs`, update `lib.rs`

**Detailed spec:** See `plans/step-9-alias-graph.md` for complete implementation reference.

##### Codebase Integration

**AssignmentInfo source:** The `TypeInferenceCollector` in `tugtool-python-cst/src/visitor/type_inference.rs` produces `AssignmentInfo` with:
- `type_source: TypeSource` enum (`Constructor`, `Variable`, `FunctionCall`, `Unknown`)
- `rhs_name: Option<String>` for variable aliases
- `scope_path: Vec<String>` for scope tracking
- `span: Option<Span>` for location

**Alias-relevant filter:** Only `type_source == "variable"` assignments with `rhs_name.is_some()` are alias candidates.

**Integration point:** In `analyzer.rs` (around line 967), assignments are already collected and processed.

##### Tasks

**Task 9.1: Create alias.rs with type definitions**
- [x] Create `crates/tugtool-python/src/alias.rs`
- [x] Define `AliasInfo` struct with fields: `alias_name`, `source_name`, `scope_path`, `alias_span`, `source_is_import`, `confidence`
- [x] Implement `AliasInfo::from_assignment()` constructor
- [x] Define `AliasGraph` struct with `forward: HashMap<String, Vec<AliasInfo>>` and `reverse: HashMap<String, Vec<String>>`

**Task 9.2: Implement AliasGraph::from_analysis**
- [x] Accept `assignments: &[AssignmentInfo]` and `imports: &HashSet<String>`
- [x] Filter for `type_source == "variable"` only
- [x] Skip self-assignments (`x = x`)
- [x] Populate forward map (source → aliases)
- [x] Populate reverse map (alias → sources)
- [x] Set `source_is_import` based on imports set

**Task 9.3: Implement query methods**
- [x] `direct_aliases(&self, source_name: &str) -> &[AliasInfo]` - all scopes
- [x] `direct_aliases_in_scope(&self, source_name: &str, scope_path: &[String]) -> Vec<&AliasInfo>` - exact scope match
- [x] `reverse_lookup(&self, alias_name: &str) -> &[String]` - reverse map access

**Task 9.4: Implement transitive_aliases**
- [x] Add `visited: HashSet<String>` for cycle detection (per Spec S04)
- [x] Add `max_depth` parameter with default 10
- [x] Implement recursive traversal following alias chain
- [x] Return early on cycle or depth limit

**Task 9.5: Add utility methods**
- [x] `is_empty(&self) -> bool`
- [x] `source_count(&self) -> usize`
- [x] `alias_count(&self) -> usize`
- [x] Implement `Default` trait

**Task 9.6: Update lib.rs**
- [x] Add `pub mod alias;` to module list

##### Tests

Uses **Table T02: Value-Level Alias Test Cases** from Section 10.3.

**Table T09: AliasGraph Unit Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| AG-01 | `test_alias_direct_simple` | unit | VA-01: `b = bar` → forward["bar"] has b |
| AG-02 | `test_alias_chained_assignment` | unit | VA-02: `c = b = bar` → both alias bar |
| AG-03 | `test_alias_transitive` | unit | VA-03: `b = bar; c = b` → transitive |
| AG-04 | `test_alias_self_assignment` | unit | VA-04: `x = x` not tracked |
| AG-05 | `test_alias_cycle_no_infinite_loop` | unit | VA-05: `a = b; b = a` terminates |
| AG-06 | `test_alias_reverse_lookup` | unit | reverse["b"] → ["bar"] |
| AG-07 | `test_alias_scope_filtering` | unit | Filter by scope_path (exact match) |
| AG-08 | `test_alias_confidence_simple` | unit | Simple assignment → confidence 1.0 |
| AG-09 | `test_alias_from_analysis_empty` | unit | No assignments → empty graph |
| AG-10 | `test_alias_transitive_depth_limit` | unit | Deep chain (15 levels) stops at max_depth |
| AG-11 | `test_alias_multi_target_same_source` | unit | `a = x; b = x` → both in forward["x"] |
| AG-12 | `test_alias_nested_scope_separate` | unit | Same name in different scopes tracked separately |
| AG-13 | `test_alias_import_flag_set` | unit | Imported source has `source_is_import: true` |
| AG-14 | `test_alias_span_populated` | unit | alias_span contains correct byte offsets |
| AG-15 | `test_alias_constructor_ignored` | unit | `x = MyClass()` not tracked as alias |
| AG-16 | `test_alias_function_call_ignored` | unit | `x = get_data()` not tracked as alias |

- [x] AG-01: `test_alias_direct_simple` - basic forward lookup
- [x] AG-02: `test_alias_chained_assignment` - chained assignment (`c = b = bar`)
- [x] AG-03: `test_alias_transitive` - transitive_aliases() follows chain
- [x] AG-04: `test_alias_self_assignment` - `x = x` filtered out
- [x] AG-05: `test_alias_cycle_no_infinite_loop` - cycle detection with visited set
- [x] AG-06: `test_alias_reverse_lookup` - reverse map lookup
- [x] AG-07: `test_alias_scope_filtering` - exact scope_path match
- [x] AG-08: `test_alias_confidence_simple` - simple assignment has confidence 1.0
- [x] AG-09: `test_alias_from_analysis_empty` - empty input → empty graph
- [x] AG-10: `test_alias_transitive_depth_limit` - reasonable depth handling
- [x] AG-11: `test_alias_multi_target_same_source` - multiple aliases for same source
- [x] AG-12: `test_alias_nested_scope_separate` - scope isolation
- [x] AG-13: `test_alias_import_flag_set` - import flag correct
- [x] AG-14: `test_alias_span_populated` - span byte offsets correct
- [x] AG-15: `test_alias_constructor_ignored` - constructor assignments filtered
- [x] AG-16: `test_alias_function_call_ignored` - function call assignments filtered

##### Checkpoint

```bash
# Run all alias tests
cargo nextest run -p tugtool-python alias

# Verify no clippy warnings
cargo clippy -p tugtool-python -- -D warnings

# Verify formatting
cargo fmt -p tugtool-python -- --check
```

All 16 tests should pass.

##### Integration Notes for Subsequent Steps

**Step 10 (Integrate into Analyzer):** Will call `AliasGraph::from_analysis()` from `analyze_file()`, passing `NativeAnalysisResult.assignments` and a set of imported names.

**Step 12 (Wire to Impact Analysis):** Will query `alias_graph.transitive_aliases(symbol_name, Some(scope_path), None)` and convert results to `AliasOutput`.

---

#### Step 10: Integrate AliasGraph into Analyzer {#step-10}

**Commit:** `feat(python): build AliasGraph during file analysis`

**References:** [D08]

**Files:** `crates/tugtool-python/src/analyzer.rs`

**Tasks:**
- [ ] Build `AliasGraph` per file using `NativeAnalysisResult.assignments`
- [ ] Add `alias_graph` field to `FileAnalysis`

**Tests:**

**Table T10: AliasGraph Analyzer Integration Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| AI-01 | `test_analyzer_alias_graph_populated` | unit | FileAnalysis.alias_graph not empty |
| AI-02 | `test_analyzer_alias_from_assignments` | unit | Uses NativeAnalysisResult.assignments |
| AI-03 | `test_analyzer_alias_per_file` | unit | Each file gets its own graph |
| AI-04 | `test_analyzer_alias_scope_preserved` | unit | scope_path flows through |
| AI-05 | `test_analyzer_alias_no_cross_file` | unit | Aliases don't leak across files |

- [ ] unit test: `test_analyzer_alias_graph_populated` - alias_graph field set
- [ ] unit test: `test_analyzer_alias_from_assignments` - built from assignments data
- [ ] unit test: `test_analyzer_alias_per_file` - fresh graph per file
- [ ] unit test: `test_analyzer_alias_scope_preserved` - scope_path correctly populated
- [ ] unit test: `test_analyzer_alias_no_cross_file` - no cross-file leakage

**Checkpoint:** `cargo nextest run -p tugtool-python analyzer`

---

#### Step 11: Alias Output Types {#step-11}

**Commit:** `feat(core): add AliasOutput type for impact analysis`

**References:** Spec S05

**Files:** `crates/tugtool-core/src/output.rs`

**Tasks:**
- [ ] Define `AliasOutput` struct with serialization

**Tests:**

**Table T11: AliasOutput Type Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| AO-01 | `test_alias_output_serialize` | unit | Serializes to JSON correctly |
| AO-02 | `test_alias_output_deserialize` | unit | Deserializes from JSON correctly |
| AO-03 | `test_alias_output_all_fields` | unit | All fields present in output |
| AO-04 | `test_alias_output_schema` | golden | Schema matches Spec S05 |

- [ ] unit test: `test_alias_output_serialize` - serde_json::to_string works
- [ ] unit test: `test_alias_output_deserialize` - round-trip serialization
- [ ] unit test: `test_alias_output_all_fields` - alias_name, source_name, file, line, col, scope, is_import_alias, confidence
- [ ] golden test: `test_alias_output_schema` - verify against Spec S05 schema

**Checkpoint:** `cargo nextest run -p tugtool-core output`

---

#### Step 12: Wire Aliases to Impact Analysis {#step-12}

**Commit:** `feat(python): include aliases in rename impact analysis`

**References:** [D06], Spec S05

**Files:** `crates/tugtool-python/src/ops/rename.rs`

**Tasks:**
- [ ] Query AliasGraph for target symbol
- [ ] Include aliases in ImpactAnalysis response

**Tests:**

**Table T12: Alias Impact Analysis Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| IA-01 | `test_impact_includes_direct_alias` | integration | `b = bar` shown in aliases |
| IA-02 | `test_impact_includes_transitive_alias` | integration | `b = bar; c = b` shows c |
| IA-03 | `test_impact_alias_scope_filtered` | integration | Only same-scope aliases |
| IA-04 | `test_impact_no_aliases_when_none` | integration | aliases: [] when no aliases |
| IA-05 | `test_impact_alias_line_col_correct` | integration | Line/col match source |
| IA-06 | `test_impact_alias_import_flag` | integration | is_import_alias set correctly |
| IA-07 | `test_impact_alias_json_schema` | golden | aliases field matches Spec S05 |

- [ ] integration test: `test_impact_includes_direct_alias` - basic alias in output
- [ ] integration test: `test_impact_includes_transitive_alias` - transitive chain
- [ ] integration test: `test_impact_alias_scope_filtered` - scope_path filtering
- [ ] integration test: `test_impact_no_aliases_when_none` - empty aliases array
- [ ] integration test: `test_impact_alias_line_col_correct` - position verification
- [ ] integration test: `test_impact_alias_import_flag` - import vs value alias
- [ ] golden test: `test_impact_alias_json_schema` - schema stability

**Checkpoint:** `cargo nextest run -p tugtool-python rename`

---

#### Step 13: Add `rename` Command {#step-13}

**Commit:** `feat(cli): add top-level rename command with apply-by-default`

**References:** [D09], [D12], Spec S06, Spec S08

**Files:** `crates/tugtool/src/main.rs`, `cli.rs`

**Tasks:**
- [ ] Add `Command::Rename` with `--at`, `--to`, `--dry-run`, `--verify`, `--no-verify`, `--format`
- [ ] Configure clap mutual exclusion: `#[arg(long, conflicts_with = "verify")]` on `no_verify` field
- [ ] Default `--verify` to `syntax`
- [ ] Output human-readable summary by default

**Tests:**

**Table T13: rename Command Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| RC-01 | `test_rename_applies_by_default` | integration | No --dry-run → files modified |
| RC-02 | `test_rename_dry_run_no_changes` | integration | --dry-run → no file writes |
| RC-03 | `test_rename_verify_syntax_default` | integration | Default verification is syntax |
| RC-04 | `test_rename_no_verify_skips` | integration | --no-verify skips syntax check |
| RC-05 | `test_rename_verify_no_verify_conflict` | integration | --verify + --no-verify → error |
| RC-06 | `test_rename_format_text_default` | integration | Default output is text summary |
| RC-07 | `test_rename_format_json` | integration | --format json produces JSON |
| RC-08 | `test_rename_at_required` | integration | Missing --at → error |
| RC-09 | `test_rename_to_required` | integration | Missing --to → error |
| RC-10 | `test_rename_invalid_location` | integration | Bad --at format → error |
| RC-11 | `test_rename_syntax_error_detected` | integration | Broken syntax → verification fails |

- [ ] integration test: `test_rename_applies_by_default` - files are modified
- [ ] integration test: `test_rename_dry_run_no_changes` - preview only
- [ ] integration test: `test_rename_verify_syntax_default` - syntax checked by default
- [ ] integration test: `test_rename_no_verify_skips` - verification skipped
- [ ] integration test: `test_rename_verify_no_verify_conflict` - clap mutual exclusion
- [ ] integration test: `test_rename_format_text_default` - human-readable summary
- [ ] integration test: `test_rename_format_json` - JSON output format
- [ ] integration test: `test_rename_at_required` - missing argument error
- [ ] integration test: `test_rename_to_required` - missing argument error
- [ ] integration test: `test_rename_invalid_location` - malformed location
- [ ] integration test: `test_rename_syntax_error_detected` - verification catches errors

**Checkpoint:** `tug rename --at <loc> --to <name>` applies changes; verify `tug rename --verify syntax --no-verify` produces clap error

---

#### Step 14: Add `analyze` Command and Remove Old Commands {#step-14}

**Commit:** `feat(cli): add analyze command, remove analyze-impact and run commands`

**References:** [D10], [D11], Spec S06, Spec S07

**Files:** `crates/tugtool/src/main.rs`, `cli.rs`, `.claude/commands/`, `.claude/skills/`, `CLAUDE.md`

**Note:** This is a clean break. Old commands (`analyze-impact`, `run`) are removed entirely in the same commit that adds new commands. Skills and documentation are updated atomically. No transition period.

**Tasks:**

*CLI changes:*
- [ ] Add `Command::Analyze` with subcommand `rename`
- [ ] Add `--format` flag (diff, json, summary)
- [ ] Default to diff format
- [ ] Remove old `Command::AnalyzeImpact` and `Command::Run` entirely

*Skill and documentation updates (same commit):*
- [ ] Update `/tug-rename` to use `tug rename`
- [ ] Update `/tug-rename-plan` to use `tug analyze rename`
- [ ] Update `.claude/skills/tug-refactor/` if present
- [ ] Update CLAUDE.md quick reference

*Verification:*
- [ ] Grep codebase for `analyze-impact` and `run --apply` references - must find zero
- [ ] Update any internal scripts or test fixtures referencing old commands

**Tests:**

**Table T14: analyze Command Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| AC-01 | `test_analyze_rename_diff_default` | integration | Default format is unified diff |
| AC-02 | `test_analyze_rename_format_json` | integration | --format json produces JSON |
| AC-03 | `test_analyze_rename_format_summary` | integration | --format summary produces brief text |
| AC-04 | `test_analyze_rename_no_changes` | integration | Diff is empty if no edits |
| AC-05 | `test_analyze_rename_git_compatible` | integration | Diff applies with `git apply` |
| AC-06 | `test_analyze_rename_context_lines` | integration | 3 lines context before/after |
| AC-07 | `test_analyze_rename_multiple_files` | integration | Multi-file diff concatenated |

**Table T15: Old Command Removal Test Cases**

| ID | Test Name | Category | Description |
|----|-----------|----------|-------------|
| OR-01 | `test_analyze_impact_removed` | drift | `tug analyze-impact` → unknown command |
| OR-02 | `test_run_command_removed` | drift | `tug run` → unknown command |
| OR-03 | `test_no_analyze_impact_refs` | drift | grep finds 0 analyze-impact refs |
| OR-04 | `test_no_run_apply_refs` | drift | grep finds 0 `run --apply` refs |
| OR-05 | `test_skills_use_new_commands` | drift | Skills invoke tug rename/analyze |

- [ ] integration test: `test_analyze_rename_diff_default` - unified diff format
- [ ] integration test: `test_analyze_rename_format_json` - JSON output option
- [ ] integration test: `test_analyze_rename_format_summary` - summary output option
- [ ] integration test: `test_analyze_rename_no_changes` - empty diff when no edits
- [ ] integration test: `test_analyze_rename_git_compatible` - diff works with git apply
- [ ] integration test: `test_analyze_rename_context_lines` - 3 lines context
- [ ] integration test: `test_analyze_rename_multiple_files` - multi-file output
- [ ] drift prevention test: `test_analyze_impact_removed` - old command gone
- [ ] drift prevention test: `test_run_command_removed` - old command gone
- [ ] drift prevention test: `test_no_analyze_impact_refs` - no stale references
- [ ] drift prevention test: `test_no_run_apply_refs` - no stale references
- [ ] drift prevention test: `test_skills_use_new_commands` - skills updated

**Checkpoint:** `tug analyze rename --at <loc> --to <name>` outputs diff; skills work with new commands; `tug analyze-impact` and `tug run` produce "unknown command" errors

---

#### Step 15: Final Verification {#step-15}

**Tasks:**
- [ ] Full test suite: `cargo nextest run --workspace`
- [ ] Spike test: `spikes/interop-spike/` still works
- [ ] Build: `cargo build --release`
- [ ] Clippy: `cargo clippy --workspace -- -D warnings`

**Checkpoint:** All tests pass, no clippy warnings

---

### 10.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Architecturally hardened tugtool with optimized PositionTable, complete scope spans, PEP 420 support, value-level alias tracking, `tug doctor` command, and simplified AI-first CLI.

#### Phase Exit Criteria {#exit-criteria}

- [ ] PositionTable uses Vec instead of HashMap
- [ ] Lambda and comprehension scopes have lexical spans
- [ ] analyzer.rs:543 TODO is resolved
- [ ] PEP 420 namespace packages resolve correctly
- [ ] Impact analysis includes value-level aliases
- [ ] `tug doctor` produces valid JSON
- [ ] `tug rename --at <loc> --to <name>` applies changes
- [ ] `tug analyze rename` outputs unified diff by default
- [ ] All tests pass, no clippy warnings

#### Milestones {#milestones}

| Milestone | Steps | Focus |
|-----------|-------|-------|
| M01 | 1 | PositionTable optimization |
| M02 | 2-4 | Scope spans complete |
| M03 | 5-6 | Output enrichment and doctor |
| M04 | 7-8 | Namespace packages |
| M05 | 9-12 | Value-level aliases |
| M06 | 13-14 | CLI simplification (commands, skills, docs) |
| M07 | 15 | Final verification |

#### Roadmap / Follow-ons {#roadmap}

- [ ] Installed package import resolution
- [ ] Cross-file value-level alias tracking
- [ ] Automatic alias renaming (`--follow-aliases`)
- [ ] `__all__.extend()` pattern parsing

---

### Implementation Log {#implementation-log}

| Step | Status | Date | Notes |
|------|--------|------|-------|
| Step 1 | pending | | PositionTable optimization |
| Step 2 | pending | | Lambda scope spans |
| Step 3 | pending | | Comprehension scope spans |
| Step 4 | pending | | Connect scope spans to analyzer |
| Step 5 | pending | | Line/col output enrichment |
| Step 6 | pending | | tug doctor command |
| Step 7 | pending | | Compute namespace packages |
| Step 8 | pending | | Namespace package resolution |
| Step 9 | done | 2026-01-24 | AliasGraph module |
| Step 10 | pending | | Integrate AliasGraph into analyzer |
| Step 11 | pending | | Alias output types |
| Step 12 | pending | | Wire aliases to impact analysis |
| Step 13 | pending | | Add `rename` command |
| Step 14 | pending | | Add `analyze` command, remove old commands, update skills and docs |
| Step 15 | pending | | Final verification |
