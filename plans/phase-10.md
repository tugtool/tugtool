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
| Last updated | 2026-01-22 |

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
| Namespace package detection false positives | med | low | Only treat as namespace if contains .py files |
| Alias chain explosion | med | low | Limit chain depth in transitive_aliases() |
| Shadowed variables cause incorrect aliases | med | med | Scope-aware analysis using scope_path |

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
    pub fn entry(&mut self, id: NodeId) -> &mut NodePosition;
}
```

#### 10.1.2 Scope Spans {#spec-scope-spans}

**Lambda:** Span from `lambda` keyword to end of body expression.
**Comprehensions:** Span from opening bracket to closing bracket.

#### 10.1.3 Line/Col Helper {#spec-line-col}

**Spec S01:** `offset_to_line_col(source: &str, byte_offset: u64) -> (u32, u32)`

Returns 1-indexed (line, col). Column is UTF-8 bytes from start of line.

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
  "summary": { "total": 2, "passed": 2, "failed": 0 }
}
```

#### 10.1.5 Namespace Package Resolution {#spec-namespace}

**Spec S03: resolve_module_to_file Algorithm**

1. `resolved_path = module_path.replace('.', '/')`
2. Try `resolved_path + ".py"` → return if found
3. Try `resolved_path + "/__init__.py"` → return if found
4. If `resolved_path` in `namespace_packages` → return namespace marker
5. Return None

#### 10.1.6 AliasGraph Types {#spec-alias-graph}

**Spec S04: AliasInfo and AliasGraph**

```rust
pub struct AliasInfo {
    pub target: String,
    pub source: String,
    pub scope_path: Vec<String>,
    pub target_span: Option<Span>,
    pub source_is_import: bool,
    pub confidence: f32,
}

pub struct AliasGraph {
    forward: HashMap<String, Vec<AliasInfo>>,
    reverse: HashMap<String, Vec<String>>,
}
```

**Spec S05: Impact Analysis Alias Output**

```json
{ "aliases": [{ "name": "b", "aliases": "bar", "file": "consumer.py", "line": 3 }] }
```

#### 10.1.7 CLI Commands {#spec-cli}

**Spec S06: Command Structure**

```
tug rename --at <file:line:col> --to <new_name> [--dry-run] [--verify <mode>] [--no-verify] [--format text|json]
tug analyze rename --at <file:line:col> --to <new_name> [--format diff|json|summary]
```

**Spec S07: Analyze Output Formats**

- `--format diff` (default): Unified diff
- `--format json`: Full JSON response
- `--format summary`: Brief text summary

**Spec S08: Rename Output**

- Default: Human-readable summary
- `--format json`: Full JSON with files_written, edits_count, verification status

---

### 10.2 Symbol Inventory {#symbol-inventory}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `PositionTable` | struct | `inflate_ctx.rs` | Change from type alias to newtype |
| `offset_to_line_col` | fn | `types.rs` | Line/col computation |
| `Command::Doctor` | variant | `main.rs` | New CLI command |
| `DoctorResponse` | struct | `output.rs` | Doctor JSON output |
| `compute_namespace_packages` | fn | `analyzer.rs` | Namespace package detection |
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
- [ ] Change PositionTable from type alias to newtype struct
- [ ] Implement `new()`, `with_capacity()`, `get()`, `insert()`, `entry()`
- [ ] Update InflateCtx and all callers

**Checkpoint:** `cargo nextest run -p tugtool-python-cst`

---

#### Step 2: Lambda Scope Spans {#step-2}

**Commit:** `feat(python-cst): add lexical span tracking for lambda scopes`

**References:** [D02], (#spec-scope-spans)

**Files:** `crates/tugtool-python-cst/src/inflate.rs`, `visitor/scope.rs`

**Tasks:**
- [ ] Record `lexical_span` for Lambda nodes during inflation
- [ ] Update `visit_lambda` to use span from PositionTable

**Checkpoint:** `cargo nextest run -p tugtool-python-cst scope`

---

#### Step 3: Comprehension Scope Spans {#step-3}

**Commit:** `feat(python-cst): add lexical span tracking for comprehension scopes`

**References:** [D02], (#spec-scope-spans)

**Files:** `crates/tugtool-python-cst/src/inflate.rs`, `visitor/scope.rs`

**Tasks:**
- [ ] Record `lexical_span` for ListComp, SetComp, DictComp, GeneratorExp
- [ ] Update corresponding `visit_*` methods

**Checkpoint:** `cargo nextest run -p tugtool-python-cst scope`

---

#### Step 4: Connect Scope Spans to Analyzer {#step-4}

**Commit:** `fix(python): use native scope spans in analyzer`

**References:** [D02], resolves analyzer.rs:543 TODO

**Files:** `crates/tugtool-python/src/analyzer.rs`, `cst_bridge.rs`

**Tasks:**
- [ ] Pass scope spans from ScopeInfo to CoreScopeInfo
- [ ] Remove TODO at analyzer.rs:543

**Checkpoint:** `cargo nextest run -p tugtool-python`

---

#### Step 5: Line/Col Output Enrichment {#step-5}

**Commit:** `feat(core): add line/col computation from byte offsets`

**References:** [D03], Spec S01

**Files:** `crates/tugtool-core/src/types.rs`

**Tasks:**
- [ ] Add `offset_to_line_col` function
- [ ] Add `with_line_col` helper to Location

**Checkpoint:** `cargo nextest run -p tugtool-core`

---

#### Step 6: tug doctor Command {#step-6}

**Commit:** `feat(cli): add tug doctor command`

**References:** [D04], Spec S02

**Files:** `crates/tugtool/src/main.rs`, `cli.rs`, `tugtool-core/src/output.rs`

**Tasks:**
- [ ] Add `Command::Doctor` variant
- [ ] Add `DoctorResponse`, `CheckResult` types
- [ ] Implement workspace_root and python_files checks

**Checkpoint:** `tug doctor` produces valid JSON

---

#### Step 7: Compute Namespace Packages {#step-7}

**Commit:** `feat(python): compute namespace packages from workspace files`

**References:** [D05], Spec S03

**Files:** `crates/tugtool-python/src/analyzer.rs`

**Tasks:**
- [ ] Add `compute_namespace_packages()` function
- [ ] Compute at start of `analyze_files()`

**Checkpoint:** `cargo nextest run -p tugtool-python namespace`

---

#### Step 8: Namespace Package Resolution {#step-8}

**Commit:** `feat(python): support PEP 420 namespace packages in import resolution`

**References:** [D05], Spec S03, Table T01

**Files:** `crates/tugtool-python/src/analyzer.rs`, `lookup.rs`

**Tasks:**
- [ ] Add `namespace_packages` parameter to `resolve_module_to_file`
- [ ] Check namespace_packages set after regular resolution fails

**Checkpoint:** `cargo nextest run -p tugtool-python`

---

#### Step 9: AliasGraph Module {#step-9}

**Commit:** `feat(python): add AliasGraph for value-level alias tracking`

**References:** [D06], [D07], [D08], Spec S04

**Files:** New `crates/tugtool-python/src/alias.rs`, update `lib.rs`

**Tasks:**
- [ ] Define `AliasInfo` and `AliasGraph` structs
- [ ] Implement `from_analysis()`, `direct_aliases()`, `transitive_aliases()`

**Checkpoint:** `cargo nextest run -p tugtool-python alias`

---

#### Step 10: Integrate AliasGraph into Analyzer {#step-10}

**Commit:** `feat(python): build AliasGraph during file analysis`

**References:** [D08]

**Files:** `crates/tugtool-python/src/analyzer.rs`

**Tasks:**
- [ ] Build `AliasGraph` per file using `NativeAnalysisResult.assignments`
- [ ] Add `alias_graph` field to `FileAnalysis`

**Checkpoint:** `cargo nextest run -p tugtool-python analyzer`

---

#### Step 11: Alias Output Types {#step-11}

**Commit:** `feat(core): add AliasOutput type for impact analysis`

**References:** Spec S05

**Files:** `crates/tugtool-core/src/output.rs`

**Tasks:**
- [ ] Define `AliasOutput` struct with serialization

**Checkpoint:** `cargo nextest run -p tugtool-core output`

---

#### Step 12: Wire Aliases to Impact Analysis {#step-12}

**Commit:** `feat(python): include aliases in rename impact analysis`

**References:** [D06], Spec S05

**Files:** `crates/tugtool-python/src/ops/rename.rs`

**Tasks:**
- [ ] Query AliasGraph for target symbol
- [ ] Include aliases in ImpactAnalysis response

**Checkpoint:** `cargo nextest run -p tugtool-python rename`

---

#### Step 13: Add `rename` Command {#step-13}

**Commit:** `feat(cli): add top-level rename command with apply-by-default`

**References:** [D09], [D12], Spec S06, Spec S08

**Files:** `crates/tugtool/src/main.rs`, `cli.rs`

**Tasks:**
- [ ] Add `Command::Rename` with `--at`, `--to`, `--dry-run`, `--verify`, `--no-verify`, `--format`
- [ ] Default `--verify` to `syntax`
- [ ] Output human-readable summary by default

**Checkpoint:** `tug rename --at <loc> --to <name>` applies changes

---

#### Step 14: Add `analyze` Command {#step-14}

**Commit:** `feat(cli): add analyze command with format options`

**References:** [D10], [D11], Spec S06, Spec S07

**Files:** `crates/tugtool/src/main.rs`, `cli.rs`

**Tasks:**
- [ ] Add `Command::Analyze` with subcommand `rename`
- [ ] Add `--format` flag (diff, json, summary)
- [ ] Default to diff format
- [ ] Remove old `Command::AnalyzeImpact` and `Command::Run`

**Checkpoint:** `tug analyze rename --at <loc> --to <name>` outputs diff

---

#### Step 15: Update Skills and Documentation {#step-15}

**Commit:** `docs: update skills and docs for simplified CLI`

**Files:** `.claude/commands/tug-rename.md`, `.claude/commands/tug-rename-plan.md`, `CLAUDE.md`

**Tasks:**
- [ ] Update `/tug-rename` to use `tug rename`
- [ ] Update `/tug-rename-plan` to use `tug analyze rename`
- [ ] Update CLAUDE.md quick reference

**Checkpoint:** Skills work with new commands

---

#### Step 16: Final Verification {#step-16}

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
| M06 | 13-14 | CLI simplification |
| M07 | 15-16 | Documentation and verification |

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
| Step 9 | pending | | AliasGraph module |
| Step 10 | pending | | Integrate AliasGraph into analyzer |
| Step 11 | pending | | Alias output types |
| Step 12 | pending | | Wire aliases to impact analysis |
| Step 13 | pending | | Add `rename` command |
| Step 14 | pending | | Add `analyze` command |
| Step 15 | pending | | Update skills and documentation |
| Step 16 | pending | | Final verification |
