## Phase 3.0: Native Python Refactoring via Adapted LibCST Core {#phase-3}

**Purpose:** Extract the Rust core from LibCST and build Python semantic analysis directly into Tug, eliminating all Python subprocess dependencies and enabling zero-Python-dependency refactoring operations.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current tugtool-python architecture spawns a Python worker process (`libcst_worker.py`) and communicates via JSON-lines IPC. All semantic analysis happens in Python using LibCST's Python API, with approximately 2200 lines of Python visitor code for scopes, bindings, references, types, etc. This introduces significant overhead: subprocess management, IPC latency, Python venv requirements, and deployment complexity.

LibCST already has a production-grade Rust core (16,400 lines) with a complete tokenizer, full PEG parser, 248 CST node types, and round-trip codegen. The only missing piece is visitor/transformer infrastructure, which exists only in the Python layer. By adapting LibCST's Rust core and building native visitors, we can eliminate all Python dependencies for refactoring operations while dramatically improving performance.

#### Guiding Principles (Grounding for Future Refactorings) {#guiding-principles}

This phase is explicitly **not** a “do-the-minimum-to-make-rename-work” effort. The goal is to build a **durable Rust foundation** for a growing set of Python refactorings, which implies:

- **Own the core model:** a stable, Rust-native CST + traversal + transformation model (even if it diverges from LibCST Python APIs)
- **Round-trip fidelity is foundational:** lossless parsing/codegen remains a non-negotiable invariant
- **Spans + identity are first-class:** deterministic node identity plus precise byte spans power refactorings and diagnostics
- **Python dependency is temporary and test-only:** Python worker is allowed only as a transitional comparison tool during Phase 3

#### Strategy {#strategy}

- Vendor LibCST's Rust parser (`native/libcst/`) into a new `tugtool-cst` crate
- Strip PyO3 dependencies and `#[cfg(feature = "py")]` blocks to create pure Rust crate
- Build visitor/transformer infrastructure (`Visitor<'a>`, `Transformer<'a>` traits)
- Port Python visitors to Rust in priority order (P0 for rename, P1/P2 for extended analysis)
- Integrate via feature flags (`native-cst` default, `python-worker` fallback)
- Verify correctness via parallel testing before making native path the default (equivalence is “behavioral stability”, not byte-for-byte JSON identity)

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool users who need fast, reliable Python refactoring without Python environment setup
2. AI agents using MCP integration that benefit from reduced latency
3. Maintainers who benefit from simplified deployment (single binary)

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build -p tugtool-python` produces binary with no Python dependencies (verify: `ldd` shows no libpython)
- Rename operations produce correct, stable results and preserve formatting (verify: existing rename integration tests + new native golden suite)
- FactsStore behavior remains stable for rename-driven workflows (verify: rename affects the same set of symbols/references and passes verification)
- Performance improvement: 10x faster for large files (verify: benchmark suite)
- All existing integration tests pass with native backend (verify: `cargo nextest run`)
- Zero Python subprocess spawned when using native backend (verify: `strace` shows no fork/exec to Python)
- Default CI path runs without Python installed (Python allowed only for opt-in equivalence tests during Phase 3)

#### Scope {#scope}

1. New `tugtool-cst-derive` crate (proc macros adapted from libcst_derive)
2. New `tugtool-cst` crate (CST types, parser, visitors)
3. Visitor/Transformer trait infrastructure with walk functions for all node types
4. P0 visitors: ScopeCollector, BindingCollector, ReferenceCollector, RenameTransformer
5. P1 visitors: ImportCollector, AnnotationCollector, TypeInferenceCollector, InheritanceCollector, MethodCallCollector
6. P2 visitors: DynamicPatternDetector
7. Integration with tugtool-python via `native-cst` feature flag
8. Comprehensive test suite (round-trip, equivalence, golden files, benchmarks)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Publishing tugtool-cst as a standalone crate to crates.io
- Supporting Python versions < 3.8 syntax
- Implementing additional refactoring operations beyond rename (extract function, etc.)
- Upstream contribution back to LibCST
- Full type inference (Level 2+)

#### Dependencies / Prerequisites {#dependencies}

- Phase 2 workspace migration completed (verified)
- LibCST source available at `adapt-libcst/LibCST/native/`
- Existing tugtool-python test suite passing

#### Constraints {#constraints}

- Must maintain backward compatibility with existing CLI and MCP interfaces
- Feature flag must allow fallback to Python worker for edge cases
- Memory usage must remain acceptable (no more than 2x increase for large files)
- Must parse and round-trip the syntax supported by the vendored `adapt-libcst` snapshot at Phase start; expand syntax coverage over time as tugtool-owned work (do not assume “3.8–3.12” without measured confirmation)

#### Assumptions {#assumptions}

- LibCST's Rust parser is production-ready and handles all standard Python syntax
- Round-trip codegen preserves whitespace and comments exactly
- Visitor pattern will be sufficient for all current analysis needs
- Performance improvement justifies the engineering investment

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Position tracking strategy (DECIDED) {#q01-position-tracking}

**Question:** How should we track byte positions (spans) for CST nodes?

**Why it matters:** Refactoring requires accurate byte spans for every rename. Wrong strategy leads to either memory bloat or computation overhead.

**Options (if known):**
- Option A: Add position fields to all nodes (~16 bytes per node overhead)
- Option B: Compute positions on-demand from token references
- Option C: Build parallel HashMap<NodeId, Span> during traversal

**Plan to resolve:** Analyze memory usage vs. performance tradeoffs during Phase 3.2

**Resolution:** DECIDED - Option C (NodeId → Span table). Rationale: We need spans for many node kinds now and for future refactorings, but we do not want to reshape all vendored node structs. A side table keyed by stable NodeId provides full coverage with low structural intrusion.

Span representation uses `tugtool_core::patch::Span` (u64 offsets). See [D03] and [D07].

---

#### [Q02] Visitor implementation approach (DECIDED) {#q02-visitor-implementation}

**Question:** Should we use proc macros or manual dispatch for visitor infrastructure?

**Why it matters:** Affects maintainability, compile time, and flexibility for new node types.

**Options (if known):**
- Option A: Full proc macro generation (`#[derive(Visitable)]` on all nodes)
- Option B: Fully manual dispatch functions
- Option C: Hybrid (macro_rules for signatures, manual for complex nodes)

**Plan to resolve:** Prototype during Phase 3.2

**Resolution:** DECIDED - Option C (Hybrid approach). See [D04].

---

#### [Q03] Crate structure approach (DECIDED) {#q03-crate-structure}

**Question:** How should we incorporate LibCST's Rust code?

**Why it matters:** Affects maintenance burden, control over modifications, and dependency management.

**Options (if known):**
- Option A: Git subtree (copy into `crates/tugtool-cst/`)
- Option B: Forked crate (publish to crates.io as `tugtool-cst`)

**Plan to resolve:** Evaluate maintenance requirements

**Resolution:** DECIDED - Option A (Git subtree). Rationale: We need significant modifications to remove PyO3 and add visitor traits. A vendored copy gives complete control and avoids the complexity of maintaining a public fork. See [D01].

---

#### [Q04] Node identity strategy (DECIDED) {#q04-node-identity}

**Question:** What is the stable “node identity” mechanism used to key side tables (spans, metadata) during traversal and transforms?

**Why it matters:** Future refactorings will need to attach analysis results to nodes deterministically, correlate diagnostics to spans, and maintain stable relationships across passes.

**Resolution:** DECIDED - explicit `NodeId(u32)` assigned deterministically during CST inflation/construction. See [D07].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Parser edge cases vs CPython | high | medium | Extensive round-trip tests on real code | Any parse failure on standard library |
| Position accuracy (byte spans) | high | medium | Compare spans against Python worker output | Diff mismatch in any golden test |
| Scope complexity (closures, comprehensions) | medium | medium | Port Python test cases, test edge cases | Wrong rename in closure tests |
| Integration complexity with FactsStore | medium | low | Clear conversion layer, feature flags | Type errors during integration |
| Performance regression in edge cases | medium | low | Benchmark diverse samples, keep fallback | 10x target not met |

**Risk R01: LibCST Parser Edge Cases** {#r01-parser-edge-cases}

- **Risk:** LibCST's Rust parser may have subtle differences from CPython's parser, leading to incorrect refactoring
- **Mitigation:**
  - Run extensive round-trip tests against real-world Python code
  - Test against Python standard library modules
  - Maintain fallback to Python worker for complex cases
- **Residual risk:** Obscure syntax edge cases may still differ; fallback provides escape hatch

**Risk R02: Position Accuracy Issues** {#r02-position-accuracy}

- **Risk:** Byte spans may be off due to encoding or whitespace handling, causing incorrect renames
- **Mitigation:**
  - Add comprehensive span tests comparing against Python worker
  - Test encoding-specific cases (UTF-8 BOM, non-ASCII identifiers)
  - Verify spans match for all named entities
- **Residual risk:** Encoding corner cases may require special handling

**Risk R03: Python Scoping Complexity** {#r03-scoping-complexity}

- **Risk:** Python's scoping rules are complex (closures, comprehensions, walrus operator, global/nonlocal) and may be implemented incorrectly
- **Mitigation:**
  - Port all Python test cases to Rust visitor tests
  - Explicitly test comprehension scoping (Python 3 behavior)
  - Test global/nonlocal edge cases thoroughly
- **Residual risk:** Novel scoping patterns may require visitor updates

---

### 3.0.0 Design Decisions {#design-decisions}

#### [D01] Vendor LibCST via Git Subtree (DECIDED) {#d01-vendor-subtree}

**Decision:** Copy LibCST's Rust code into `crates/tugtool-cst/` and `crates/tugtool-cst-derive/` as vendored source.

**Rationale:**
- We need significant modifications (remove PyO3, add visitor traits)
- Full control over code without external dependency management
- No publishing overhead or version coordination
- Easy to modify as needed during development

**Implications:**
- Manual effort required if syncing upstream fixes
- Must maintain our own modifications
- Cargo.toml dependencies are local path references

---

#### [D02] Remove All PyO3 Dependencies (DECIDED) {#d02-remove-pyo3}

**Decision:** Strip all PyO3-related code including `py` feature, `TryIntoPy` derives, and `src/py.rs` module.

**Rationale:**
- PyO3 is only needed for Python bindings we don't use
- Removing it simplifies the crate and reduces compile time
- Eliminates any accidental Python dependency

**Implications:**
- Must update all node definitions to remove `#[cfg_attr(feature = "py", ...)]`
- Must update libcst_derive to remove `TryIntoPy` macro
- Cargo.toml must not include pyo3 dependency

---

#### [D03] Spans via `SpanTable` (DECIDED) {#d03-positions-in-nodes}

**Decision:** Use `tugtool_core::patch::Span` (u64 byte offsets) and store spans in a side table keyed by `NodeId` (`SpanTable`).

**Rationale:**
- Refactoring needs accurate byte spans for every rename operation
- On-demand computation would require re-traversal or token lookups and invites subtle bugs
- Side table gives full coverage without reshaping all node structs
- Using the existing core `Span` avoids conversion seams and keeps patch/edit code consistent

**Implications:**
- Define `NodeId` + `SpanTable` in `tugtool-cst` and thread it through inflate/traversal
- Provide helpers like `span_of(NodeId) -> Option<Span>` and convenience accessors for common nodes
- All spans are byte offsets into UTF-8 source, represented as `tugtool_core::patch::Span` (u64)

---

#### [D04] Hybrid Visitor Implementation (DECIDED) {#d04-hybrid-visitor}

**Decision:** Use macro_rules for visitor trait method signatures, manual walk implementations for complex nodes, derive only for simple leaf nodes.

**Rationale:**
- Full proc macro approach adds compile-time cost and complexity
- Full manual approach is verbose and error-prone
- Hybrid balances DRY principles with explicit control
- Complex nodes (compound statements) need careful manual traversal order

**Implications:**
- Create `visitor_methods!` macro for trait signature boilerplate
- Write ~50 `walk_*` functions manually in dispatch.rs
- Add `#[derive(Visitable)]` only to simple terminal nodes

---

#### [D05] Parallel Backend via Feature Flags (DECIDED) {#d05-feature-flags}

**Decision:** Implement native CST path alongside existing Python worker path, controlled by Cargo features.

**Rationale:**
- Allows gradual migration and testing
- Provides fallback for edge cases
- Enables A/B comparison during verification
- Users can opt for legacy path if needed

**Implications:**
- `native-cst` feature (default on) uses tugtool-cst
- `python-worker` feature uses existing WorkerHandle
- Both features can be enabled for equivalence testing
- Eventually deprecate and remove python-worker

---

#### [D06] Visitor Traversal Order Matches Python (DECIDED) {#d06-traversal-order}

**Decision:** Walk functions must visit nodes in the same order as Python LibCST's visitors.

**Rationale:**
- Enables direct equivalence testing between backends
- Ensures scope entry/exit order is consistent
- Reduces surprises when migrating

**Implications:**
- Must study Python visitor order carefully
- Write order-sensitive tests
- Document traversal order in walk function comments

---

#### [D07] Stable Node Identity via `NodeId` (DECIDED) {#d07-nodeid}

**Decision:** Introduce `NodeId(u32)` assigned deterministically during CST inflation/construction, and use it as the key for side tables (spans, future metadata).

**Rationale:**
- Pointer identity is brittle (allocation strategy changes, non-determinism across passes)
- Structural hashing is expensive and unstable under edits
- Explicit ids give a durable foundation for analysis, diagnostics, and future transform pipelines

**Implications:**
- Add `NodeId` plumbing to the inflate pipeline (or a post-inflate id assignment pass)
- Create `SpanTable` keyed by NodeId
- Ensure id assignment order is deterministic (e.g., pre-order traversal)

---

#### [D08] Python Version Abstraction from Day One (DECIDED) {#d08-version-abstraction}

**Decision:** Introduce `PythonVersion` and `ParseOptions` types in Step 2, threading version through the parse API even though version-specific validation is deferred.

**Rationale:**
- Python syntax evolves across versions (match statements in 3.10, walrus scoping changes in 3.9, etc.)
- Adding version abstraction later would require API changes across the crate boundary
- Version-aware feature queries (e.g., `has_match_statements()`) enable future version-specific analysis without redesign
- `Permissive` mode (default) accepts all syntax the grammar handles, preserving backward compatibility

**Implications:**
- `version.rs` module added in Step 2
- `parse_module_with_options(text, ParseOptions)` is the primary API; `parse_module(text)` is a convenience wrapper
- Visitors can accept `PythonVersion` in constructors for version-aware scoping/analysis
- Version validation (rejecting syntax not in target version) is explicitly deferred to future work
- `PythonVersion` must be safe to extend and must not rely on “magic values” (avoid `0.0` sentinels); do not depend on version ordering for semantics

---

### Deep Dives {#deep-dives}

#### Architecture Transition {#architecture-transition}

**Diagram Diag01: Architecture Before and After** {#diag01-architecture}

```
Current Architecture:
  tugtool-python (Rust)
       |
       | JSON-lines IPC (stdin/stdout)
       v
  libcst_worker.py (Python)
       |
       | LibCST Python API
       v
  libcst_native (Rust via PyO3)

Target Architecture:
  tugtool-python (Rust)
       |
       | Direct Rust calls
       v
  tugtool-cst (new crate)
       |
       | Pure Rust CST
       v
  Adapted libcst_native (no PyO3)
```

---

#### Visitor Mapping {#visitor-mapping}

**Table T01: Python to Rust Visitor Mapping** {#t01-visitor-mapping}

| Priority | Python Visitor | Rust Implementation | Purpose |
|----------|---------------|---------------------|---------|
| P0 | `ScopeVisitor` | `ScopeCollector` | Scope hierarchy with global/nonlocal |
| P0 | `BindingVisitor` | `BindingCollector` | All name definitions |
| P0 | `ReferenceVisitor` | `ReferenceCollector` | All name usages |
| P0 | Rewrite logic | `RenameTransformer` | Apply renames at spans |
| P1 | `ImportVisitor` | `ImportCollector` | Import statements |
| P1 | `AnnotationVisitor` | `AnnotationCollector` | Type annotations |
| P1 | `AssignmentTypeVisitor` | `TypeInferenceCollector` | Level 1 type inference |
| P1 | `ClassInheritanceVisitor` | `InheritanceCollector` | Class hierarchies |
| P1 | `MethodCallVisitor` | `MethodCallCollector` | `obj.method()` patterns |
| P2 | `DynamicPatternVisitor` | `DynamicPatternDetector` | getattr/eval detection |

---

#### Python Worker Protocol Reference {#worker-protocol-reference}

**Table T02: IPC Operations to Port** {#t02-ipc-operations}

| Operation | Description | Must Port |
|-----------|-------------|-----------|
| `parse` | Parse Python source to CST | Yes |
| `get_bindings` | Extract name definitions | Yes |
| `get_references` | Collect all name references | Yes |
| `get_imports` | Extract import statements | Yes |
| `get_scopes` | Build scope tree | Yes |
| `get_assignments` | Type inference from assignments | Yes |
| `get_method_calls` | Track obj.method() patterns | Yes |
| `get_annotations` | Extract type annotations | Yes |
| `get_class_inheritance` | Build inheritance graph | Yes |
| `get_dynamic_patterns` | Detect getattr/eval/etc | Yes |
| `get_analysis` | Combined analysis (all above) | Yes |
| `rewrite_name` | Single span rewrite | Yes |
| `rewrite_batch` | Multiple span rewrites | Yes |
| `release` | Free CST from cache | N/A (no cache) |
| `shutdown` | Terminate worker | N/A (no process) |

---

#### CST Node Categories {#cst-node-categories}

**Table T03: LibCST Node Type Summary** {#t03-node-types}

| Category | Count | Examples |
|----------|-------|----------|
| Expressions | ~80 | Name, Attribute, Call, Subscript, BinaryOperation, Lambda |
| Statements | ~40 | FunctionDef, ClassDef, If, For, While, Try, Import |
| Operators | ~30 | Add, Sub, Equal, And, Or, Not |
| Whitespace | ~20 | SimpleWhitespace, Newline, Comment |
| Other | ~78 | Module, Parameters, Param, Arg, Decorator |
| **Total** | **~248** | |

---

### 3.0.1 Specification {#specification}

#### 3.0.1.1 Inputs and Outputs (Data Model) {#inputs-outputs}

**Inputs:**
- Python source code as `&str` (UTF-8)
- Optional encoding hint for non-UTF-8 files

**Outputs:**
- Parsed `Module<'a>` CST with optional span information
- Analysis results: scopes, bindings, references, imports, annotations, etc.
- Transformed source code after renames

**Key invariants:**
- Round-trip: `parse(code).codegen() == code` for all valid Python
- Spans are byte offsets into the original source (`tugtool_core::patch::Span`, u64)
- Visitors see nodes in deterministic, documented order

---

#### 3.0.1.2 Terminology and Naming {#terminology}

- **CST (Concrete Syntax Tree):** Syntax tree preserving all whitespace and formatting
- **Span:** Byte offset range `tugtool_core::patch::Span { start: u64, end: u64 }` in source
- **NodeId:** Stable identifier for a CST node (`NodeId(u32)`) used to key span tables and future metadata
- **PythonVersion:** Target Python language version `{ major: u8, minor: u8 }` for syntax parsing and version-aware analysis
- **ParseOptions:** Configuration for parsing including target `PythonVersion` and encoding hints
- **Scope:** Lexical scope in Python (module, class, function, lambda, comprehension)
- **Binding:** A name definition (function, class, variable, parameter, import)
- **Reference:** A name usage (read, call, attribute access)
- **Walker:** Function that traverses CST calling visitor methods

---

#### 3.0.1.3 Supported Features (Exhaustive) {#supported-features}

- **Supported:**
  - Baseline syntax supported by the vendored `adapt-libcst` snapshot (measured via round-trip suite)
  - All expression types including walrus operator (`:=`)
  - All statement types including match statements (3.10+)
  - F-strings (as supported by snapshot)
  - Type annotations including PEP 604 union syntax (`X | Y`)
  - Async functions and comprehensions
  - Decorators with arguments
  - Star expressions in assignments and function calls

- **Explicitly not supported:**
  - Python 2 syntax
  - Invalid Python syntax (parse errors returned)
  - Type comments (only annotation syntax)

- **Behavior when unsupported is encountered:**
  - Parse errors return `Err(ParserError)` with location and message
  - Unsupported syntax from future Python versions causes parse error

---

#### 3.0.1.4 Visitor Traits {#visitor-traits}

**Spec S01: Visitor Trait** {#s01-visitor-trait}

```rust
/// Result of visiting a node - controls traversal
pub enum VisitResult {
    /// Continue traversal into children
    Continue,
    /// Skip children, continue with siblings
    SkipChildren,
    /// Stop traversal entirely
    Stop,
}

/// Immutable visitor for CST traversal
pub trait Visitor<'a> {
    // Called for any node (default: Continue)
    fn visit(&mut self, node: &dyn CstNode<'a>) -> VisitResult;
    fn leave(&mut self, node: &dyn CstNode<'a>);

    // Typed visit methods for each node type
    fn visit_module(&mut self, node: &Module<'a>) -> VisitResult;
    fn leave_module(&mut self, node: &Module<'a>);
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult;
    fn leave_function_def(&mut self, node: &FunctionDef<'a>);
    // ... methods for all ~248 node types
}

/// Transformer that can modify CST nodes
pub trait Transformer<'a> {
    // NOTE: The real API must be typed by node category, not a single Output type.
    // Some contexts allow removal/flattening (e.g., statement lists), mirroring LibCST's
    // RemovalSentinel / FlattenSentinel concepts.
}

/// Generic transform result for list-like contexts (e.g., statements)
pub enum Transform<T> {
    Keep(T),
    Remove,
    Flatten(Vec<T>),
}

pub trait TypedTransformer<'a> {
    fn transform_module(&mut self, node: Module<'a>) -> Module<'a>;
    fn transform_statement(&mut self, node: Statement<'a>) -> Transform<Statement<'a>>;
    fn transform_expression(&mut self, node: Expression<'a>) -> Expression<'a>;
    fn transform_name(&mut self, node: Name<'a>) -> Name<'a>;
    // ... typed transform_* methods for all node types
}
```

---

#### 3.0.1.5 Semantics (Normative Rules) {#semantics}

- **Traversal order:** Depth-first, pre-order for `visit_*`, post-order for `leave_*`
- **Child ordering:** Children visited in source order (left-to-right, top-to-bottom)
- **Scope entry:** `visit_*` called before entering scope body
- **Scope exit:** `leave_*` called after all children processed
- **SkipChildren:** Prevents recursion but `leave_*` still called
- **Stop:** Immediately terminates traversal, no further callbacks

---

#### 3.0.1.6 Error and Warning Model {#errors-warnings}

**Error fields (required):**
- `message`: Human-readable error description
- `location`: `{ line: usize, column: usize }` (1-based)
- `span`: `tugtool_core::patch::Span { start: u64, end: u64 }` (byte offsets)

**Warning fields (required):**
- `message`: Human-readable warning description
- `location`: Same as error

**Parse error codes:**
- `SyntaxError`: Invalid Python syntax
- `IndentationError`: Incorrect indentation
- `TokenError`: Tokenization failure (unclosed string, etc.)

---

#### 3.0.1.7 Public API Surface {#public-api}

**Rust:**

```rust
// Python version abstraction
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PythonVersion {
    /// Accept all syntax the grammar handles; no version validation.
    Permissive,
    /// A specific target language version (e.g., 3.10).
    V { major: u8, minor: u8 },
}

impl PythonVersion {
    pub const V3_8: Self = Self::V { major: 3, minor: 8 };
    pub const V3_9: Self = Self::V { major: 3, minor: 9 };
    pub const V3_10: Self = Self::V { major: 3, minor: 10 };
    pub const V3_11: Self = Self::V { major: 3, minor: 11 };
    pub const V3_12: Self = Self::V { major: 3, minor: 12 };

    /// Feature queries for version-aware analysis (validation deferred).
    pub fn has_match_statements(self) -> bool;
    pub fn has_walrus_in_comprehension_iterable(self) -> bool;
    // ... add feature queries as needed
}

pub struct ParseOptions {
    pub version: PythonVersion,
    pub encoding: Option<String>,
}

// Parsing (version-aware)
pub fn parse_module_with_options(text: &str, options: ParseOptions) -> Result<Module, ParserError>;
pub fn parse_module(text: &str) -> Result<Module, ParserError>; // uses PythonVersion::Permissive
pub fn parse_statement(text: &str) -> Result<Statement, ParserError>;
pub fn parse_expression(text: &str) -> Result<Expression, ParserError>;
pub fn tokenize(text: &str) -> Result<Vec<Token>, TokenError>;

// Error formatting
pub fn prettify_error(err: ParserError, label: &str) -> String;

// Code generation
pub trait Codegen {
    fn codegen(&self, state: &mut CodegenState);
}

// Visitor infrastructure
pub trait Visitor<'a> { /* see S01 */ }
pub trait TypedTransformer<'a> { /* see S01 */ }
pub fn walk_module<'a, V: Visitor<'a>>(visitor: &mut V, module: &Module<'a>);
// ... walk_* for all node types

// Analysis collectors (version-aware constructors)
pub struct ScopeCollector<'a>;
pub struct BindingCollector<'a>;
pub struct ReferenceCollector<'a>;
pub struct RenameTransformer<'a>;
// ... P1/P2 collectors
```

---

#### 3.0.1.8 Internal Architecture {#internal-architecture}

- **Single source of truth:** tugtool-cst crate owns all CST types and parsing
- **Compilation pipeline:**
  1. Tokenize source into token stream
  2. Parse tokens via PEG grammar into CST
  3. Inflate CST with position information
  4. (Optional) Run visitors for analysis
  5. (Optional) Transform for refactoring
  6. Codegen back to source string

- **Where code lives:**
  - `tugtool-cst-derive`: Proc macros for node derives
  - `tugtool-cst/src/tokenizer`: Tokenization
  - `tugtool-cst/src/parser`: PEG grammar and parsing
  - `tugtool-cst/src/nodes`: CST node type definitions
  - `tugtool-cst/src/visitor`: Visitor traits and walkers
  - `tugtool-python/src/cst_bridge.rs`: Integration layer

- **Non-negotiable invariants:**
  - Round-trip must preserve exact source text
  - Visitor order must match Python LibCST
  - Span byte offsets must be accurate

---

### 3.0.2 Definitive Symbol Inventory {#symbol-inventory}

#### 3.0.2.1 New crates {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugtool-cst-derive` | Proc macros for CST node derives (adapted from libcst_derive) |
| `tugtool-cst` | CST types, parser, tokenizer, visitors (adapted from libcst) |

---

#### 3.0.2.2 New files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugtool-cst-derive/Cargo.toml` | Crate manifest |
| `crates/tugtool-cst-derive/src/lib.rs` | Proc macro entry point |
| `crates/tugtool-cst-derive/src/cstnode.rs` | CstNode derive implementation |
| `crates/tugtool-cst-derive/src/codegen.rs` | Codegen derive implementation |
| `crates/tugtool-cst-derive/src/inflate.rs` | Inflate derive implementation |
| `crates/tugtool-cst/Cargo.toml` | Crate manifest |
| `crates/tugtool-cst/src/lib.rs` | Crate entry point |
| `crates/tugtool-cst/src/version.rs` | Python version abstraction and feature queries |
| `crates/tugtool-cst/src/nodes/mod.rs` | Node type re-exports |
| `crates/tugtool-cst/src/nodes/expression.rs` | Expression node types |
| `crates/tugtool-cst/src/nodes/statement.rs` | Statement node types |
| `crates/tugtool-cst/src/nodes/module.rs` | Module node type |
| `crates/tugtool-cst/src/nodes/codegen.rs` | Code generation traits |
| `crates/tugtool-cst/src/nodes/traits.rs` | Node traits |
| `crates/tugtool-cst/src/parser/mod.rs` | Parser entry point |
| `crates/tugtool-cst/src/parser/grammar.rs` | PEG grammar (~3600 lines) |
| `crates/tugtool-cst/src/parser/errors.rs` | Parser error types |
| `crates/tugtool-cst/src/tokenizer/mod.rs` | Tokenizer entry point |
| `crates/tugtool-cst/src/visitor/mod.rs` | Visitor module entry |
| `crates/tugtool-cst/src/visitor/traits.rs` | Visitor/Transformer traits |
| `crates/tugtool-cst/src/visitor/dispatch.rs` | Walk functions |
| `crates/tugtool-cst/src/visitor/scope.rs` | ScopeCollector |
| `crates/tugtool-cst/src/visitor/binding.rs` | BindingCollector |
| `crates/tugtool-cst/src/visitor/reference.rs` | ReferenceCollector |
| `crates/tugtool-cst/src/visitor/rename.rs` | RenameTransformer |
| `crates/tugtool-cst/src/visitor/import.rs` | ImportCollector (P1) |
| `crates/tugtool-cst/src/visitor/annotation.rs` | AnnotationCollector (P1) |
| `crates/tugtool-cst/src/visitor/type_inference.rs` | TypeInferenceCollector (P1) |
| `crates/tugtool-cst/src/visitor/inheritance.rs` | InheritanceCollector (P1) |
| `crates/tugtool-cst/src/visitor/method_call.rs` | MethodCallCollector (P1) |
| `crates/tugtool-cst/src/visitor/dynamic.rs` | DynamicPatternDetector (P2) |
| `crates/tugtool-python/src/cst_bridge.rs` | Integration layer for native CST |

---

#### 3.0.2.3 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `PythonVersion` | struct | `tugtool-cst/src/version.rs` | `{ major: u8, minor: u8 }` with version constants and feature queries |
| `ParseOptions` | struct | `tugtool-cst/src/version.rs` | Configuration for parsing: version + encoding |
| `Span` | type | `tugtool-cst` | Use `tugtool_core::patch::Span` (u64 byte offsets) |
| `NodeId` | struct | `tugtool-cst/src/nodes/traits.rs` | `pub struct NodeId(pub u32)` |
| `SpanTable` | struct | `tugtool-cst/src/nodes/traits.rs` | `NodeId -> Span` mapping for all nodes |
| `VisitResult` | enum | `tugtool-cst/src/visitor/traits.rs` | Continue, SkipChildren, Stop |
| `Visitor<'a>` | trait | `tugtool-cst/src/visitor/traits.rs` | Immutable visitor |
| `Transformer<'a>` | trait | `tugtool-cst/src/visitor/traits.rs` | Mutable transformer |
| `ScopeInfo` | struct | `tugtool-cst/src/visitor/scope.rs` | Scope data |
| `ScopeKind` | enum | `tugtool-cst/src/visitor/scope.rs` | Module/Class/Function/Lambda/Comprehension |
| `ScopeCollector<'a>` | struct | `tugtool-cst/src/visitor/scope.rs` | Implements Visitor |
| `BindingInfo` | struct | `tugtool-cst/src/visitor/binding.rs` | Binding data |
| `BindingKind` | enum | `tugtool-cst/src/visitor/binding.rs` | Function/Class/Parameter/Variable/Import |
| `BindingCollector<'a>` | struct | `tugtool-cst/src/visitor/binding.rs` | Implements Visitor |
| `ReferenceInfo` | struct | `tugtool-cst/src/visitor/reference.rs` | Reference data |
| `ReferenceKind` | enum | `tugtool-cst/src/visitor/reference.rs` | Definition/Reference/Call/Attribute/Import |
| `ReferenceCollector<'a>` | struct | `tugtool-cst/src/visitor/reference.rs` | Implements Visitor |
| `RenameRequest` | struct | `tugtool-cst/src/visitor/rename.rs` | Span + new_name |
| `RenameTransformer<'a>` | struct | `tugtool-cst/src/visitor/rename.rs` | Applies renames |
| `walk_module` | fn | `tugtool-cst/src/visitor/dispatch.rs` | Module walker |
| `walk_statement` | fn | `tugtool-cst/src/visitor/dispatch.rs` | Statement walker |
| `walk_expression` | fn | `tugtool-cst/src/visitor/dispatch.rs` | Expression walker |

---

### 3.0.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md with tugtool-cst crate documentation
- [ ] Add rustdoc comments to all public types and functions
- [ ] Document `PythonVersion` abstraction and `PERMISSIVE` mode semantics
- [ ] Document visitor traversal order guarantees
- [ ] Document feature flag usage (`native-cst` vs `python-worker`)
- [ ] Add examples in `tugtool-cst/examples/` for common visitor patterns
- [ ] Add examples showing version-aware parsing (`parse_example.rs`)

---

### 3.0.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual visitors/walkers in isolation | Each collector, transformer |
| **Integration** | Test end-to-end rename operations | CLI rename commands |
| **Golden / Contract** | Compare output against known-good snapshots | All analysis outputs |
| **Equivalence (opt-in)** | Compare Rust vs Python backend outputs | During migration only; may require Python |
| **Round-trip** | Verify parse -> codegen == original | Parser correctness |
| **Benchmark** | Measure performance improvement | Performance validation |

---

#### Test Fixtures {#test-fixtures}

##### Fixture Directory Structure {#fixture-structure}

```
crates/tugtool-cst/tests/fixtures/
├── python/
│   ├── simple_function/
│   │   └── input.py
│   ├── class_with_inheritance/
│   │   └── input.py
│   ├── nested_scopes/
│   │   └── input.py
│   ├── comprehensions/
│   │   └── input.py
│   └── type_annotations/
│       └── input.py
└── golden/
    ├── simple_function/
    │   ├── bindings.json
    │   ├── references.json
    │   └── scopes.json
    ├── class_with_inheritance/
    │   ├── bindings.json
    │   ├── references.json
    │   ├── scopes.json
    │   └── inheritance.json
    └── ...
```

##### Fixture Requirements {#fixture-requirements}

- **Self-contained:** Each fixture must be valid Python on its own
- **Deterministic:** No randomness, timestamps, or environment-dependent behavior
- **Minimal:** Just enough code to exercise the scenario
- **Documented:** Comments explaining what aspect is being tested
- **Valid:** All fixtures must pass `python -m py_compile`

**Python in tests policy (Phase 3):**
- Python is permitted **only** for opt-in equivalence tests and fixture validation (`py_compile`) during the migration window.
- Default CI should not require Python once the native backend is integrated and the default features exclude `python-worker`.

##### Golden Test Workflow {#golden-workflow}

```bash
# Run golden tests (compare against snapshots)
cargo nextest run -p tugtool-cst golden

# Update golden files after intentional changes
TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool-cst golden
```

---

### 3.0.5 Execution Steps {#execution-steps}

#### Step 1: Extract and Adapt LibCST Parser {#step-1}

**Commit:** `feat(cst): vendor LibCST Rust parser as tugtool-cst`

**References:** [D01] Vendor via subtree, [D02] Remove PyO3, (#d01-vendor-subtree, #d02-remove-pyo3, #architecture-transition)

**Artifacts:**
- `crates/tugtool-cst-derive/` - Proc macro crate
- `crates/tugtool-cst/` - Core CST crate
- Updated workspace Cargo.toml

**Tasks:**
- [ ] Copy `adapt-libcst/LibCST/native/libcst/` to `crates/tugtool-cst/src/`
- [ ] Copy `adapt-libcst/LibCST/native/libcst_derive/` to `crates/tugtool-cst-derive/src/`
- [ ] Create Cargo.toml for both crates (remove pyo3 dependency)
- [ ] Remove `src/py.rs` module entirely
- [ ] Remove `#[cfg(feature = "py")]` attributes from all files
- [ ] Remove `#[cfg_attr(feature = "py", derive(TryIntoPy))]` from nodes
- [ ] Update libcst_derive to remove TryIntoPy macro
- [ ] Add crates to workspace Cargo.toml
- [ ] Fix all compilation errors from PyO3 removal

**Tests:**
- [ ] Unit: `cargo build -p tugtool-cst-derive`
- [ ] Unit: `cargo build -p tugtool-cst`
- [ ] Integration: Existing LibCST parser tests compile and pass

**Checkpoint:**
- [ ] `cargo build -p tugtool-cst --no-default-features` succeeds
- [ ] `cargo test -p tugtool-cst` passes
- [ ] No pyo3 in `cargo tree -p tugtool-cst`

**Rollback:**
- Remove `crates/tugtool-cst/` and `crates/tugtool-cst-derive/` directories
- Revert workspace Cargo.toml changes

**Commit after all checkpoints pass.**

---

#### Step 2: Expose Clean Public API {#step-2}

**Commit:** `feat(cst): expose public parsing API with version abstraction`

**References:** [D02] Remove PyO3, [D08] Version abstraction, Spec S01, (#public-api, #inputs-outputs, #terminology)

**Artifacts:**
- `tugtool-cst/src/version.rs` with `PythonVersion` and `ParseOptions`
- Updated `tugtool-cst/src/lib.rs` with public exports
- API documentation

**Tasks:**
- [x] Create `version.rs` with `PythonVersion` struct
- [x] Define `PythonVersion` as an enum with `Permissive` and `V { major, minor }` variants
- [x] Add version constants: `V3_8`, `V3_9`, `V3_10`, `V3_11`, `V3_12`
- [x] Add feature query methods: `has_match_statements()`, `has_walrus_in_comprehension_iterable()`, etc.
- [x] Create `ParseOptions` struct with `version` and `encoding` fields
- [x] Add `parse_module_with_options` function accepting `ParseOptions`
- [x] Keep `parse_module` as convenience wrapper using `PythonVersion::Permissive`
- [x] Define public API surface in lib.rs
- [x] Re-export `PythonVersion`, `ParseOptions`, parsing functions
- [x] Re-export `prettify_error` for error formatting
- [x] Re-export all node types from nodes module
- [x] Re-export `Codegen`, `CodegenState` for code generation
- [x] Add rustdoc comments to all public items (document that version validation is deferred)
- [x] Create `tugtool-cst/examples/parse_example.rs` showing version-aware parsing

**Tests:**
- [x] Unit: `PythonVersion` constants exist and are stable (`V3_8`, `V3_9`, etc.)
- [x] Unit: `PythonVersion::Permissive` does not perform version validation
- [x] Unit: `parse_module_with_options` accepts version parameter
- [x] Unit: Same code parses identically regardless of version (for now—validation deferred)
- [x] Unit: Example code compiles and runs
- [x] Integration: Parse various Python files successfully

**Checkpoint:**
- [x] `cargo doc -p tugtool-cst --open` shows clean API documentation including `PythonVersion`
- [x] `cargo run --example parse_example` succeeds
- [x] `cargo test -p tugtool-cst version` passes
- [x] `cargo nextest run --workspace` passes

**Rollback:**
- Revert lib.rs and version.rs changes

**Commit after all checkpoints pass.**

---

#### Step 3: Build Visitor Infrastructure {#step-3}

##### Step 3.1: Visitor Traits {#step-3-1}

**Commit:** `feat(cst): add Visitor and Transformer traits`

**References:** [D04] Hybrid visitor, Spec S01, (#s01-visitor-trait, #semantics)

**Artifacts:**
- `tugtool-cst/src/visitor/mod.rs`
- `tugtool-cst/src/visitor/traits.rs`

**Tasks:**
- [x] Create `visitor/` module directory
- [x] Define `VisitResult` enum (Continue, SkipChildren, Stop)
- [x] Define `Visitor<'a>` trait with default implementations
- [x] Define `Transformer<'a>` trait
- [x] Create `visitor_methods!` macro for trait method boilerplate
- [x] Add visitor module to lib.rs exports

**Tests:**
- [x] Unit: Trait definitions compile
- [x] Unit: Default implementations work

**Checkpoint:**
- [x] `cargo build -p tugtool-cst` succeeds
- [x] Visitor trait has methods for key node types
- [x] `cargo nextest run --workspace` passes

**Rollback:**
- Remove visitor module

**Commit after all checkpoints pass.**

---

##### Step 3.2: Walk Functions {#step-3-2}

**Commit:** `feat(cst): implement walk functions for CST traversal`

**References:** [D06] Traversal order, (#semantics, #cst-node-categories)

**Artifacts:**
- `tugtool-cst/src/visitor/dispatch.rs`

**Tasks:**
- [ ] Implement `walk_module`
- [ ] Implement `walk_statement` with match on Statement variants
- [ ] Implement `walk_compound_statement` for FunctionDef, ClassDef, If, For, etc.
- [ ] Implement `walk_simple_statement` for Assign, Return, Import, etc.
- [ ] Implement `walk_expression` with match on Expression variants
- [ ] Implement ~50 walk functions for all compound node types
- [ ] Verify visit/leave order matches Python LibCST

**Tests:**
- [ ] Unit: Walk functions compile
- [ ] Unit: Simple traversal test visits nodes in expected order
- [ ] Integration: Walk entire Python file without errors

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst walk` passes
- [ ] Traversal order documented in dispatch.rs

**Rollback:**
- Remove dispatch.rs

**Commit after all checkpoints pass.**

---

##### Step 3.3: Position Tracking {#step-3-3}

**Commit:** `feat(cst): add NodeId + SpanTable position tracking`

**References:** [D03] Spans via SpanTable, [D07] NodeId, (#d03-positions-in-nodes, #d07-nodeid, #terminology)

**Artifacts:**
- `tugtool-cst/src/nodes/traits.rs`: `NodeId`, `SpanTable`
- Updated inflate implementations to assign NodeIds deterministically and record spans

**Tasks:**
- [ ] Adopt `tugtool_core::patch::Span` as the canonical span type (no local `Span` struct)
- [ ] Define `NodeId(u32)` and a `SpanTable` keyed by NodeId
- [ ] Assign a deterministic NodeId to each CST node during inflate (pre-order traversal)
- [ ] Record spans in `SpanTable` for nodes with meaningful source ranges (at minimum: identifiers, def names, params, import aliases, attributes)
- [ ] Provide helpers (e.g., `node_id() -> NodeId` for concrete nodes and `span_of(NodeId) -> Option<Span>` on the table)
- [ ] Document id assignment determinism and span semantics (byte offsets into UTF-8 source)

**Tests:**
- [ ] Unit: NodeId assignment is deterministic for a fixture
- [ ] Unit: Parse simple code and verify spans are populated in SpanTable
- [ ] Integration: Spans match expected byte offsets for representative constructs

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst span` passes
- [ ] SpanTable reports accurate spans for identifier nodes
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Revert node definition changes

**Commit after all checkpoints pass.**

---

#### Step 3 Summary {#step-3-summary}

After completing Steps 3.1-3.3, you will have:
- Complete `Visitor<'a>` and `Transformer<'a>` trait definitions
- Walk functions for all ~248 CST node types
- Position (span) tracking via `SpanTable` keyed by `NodeId`

**Final Step 3 Checkpoint:**
- [ ] `cargo test -p tugtool-cst visitor` passes all visitor infrastructure tests

---

#### Step 4: Port P0 Visitors {#step-4}

##### Step 4.1: ScopeCollector {#step-4-1}

**Commit:** `feat(cst): implement ScopeCollector visitor`

**References:** Table T01, (#t01-visitor-mapping, #visitor-mapping)

**Artifacts:**
- `tugtool-cst/src/visitor/scope.rs`

**Tasks:**
- [ ] Define `ScopeInfo` struct (id, kind, name, parent, span, globals, nonlocals)
- [ ] Define `ScopeKind` enum (Module, Class, Function, Lambda, Comprehension)
- [ ] Implement `ScopeCollector<'a>` struct
- [ ] Implement `Visitor<'a>` for ScopeCollector
- [ ] Handle `visit_module` - enter Module scope
- [ ] Handle `visit_function_def` - enter Function scope
- [ ] Handle `visit_class_def` - enter Class scope
- [ ] Handle `visit_lambda` - enter Lambda scope
- [ ] Handle `visit_list_comp`, `visit_dict_comp`, etc. - enter Comprehension scope
- [ ] Handle `visit_global` - record global declarations
- [ ] Handle `visit_nonlocal` - record nonlocal declarations
- [ ] Implement `leave_*` methods to exit scopes
- [ ] Add `into_scopes()` method to extract results

**Tests:**
- [ ] Unit: Simple function creates Function scope
- [ ] Unit: Nested functions create nested scopes
- [ ] Unit: Class with methods creates proper hierarchy
- [ ] Unit: Comprehensions create their own scope
- [ ] Unit: Global/nonlocal declarations tracked
- [ ] Golden: Compare output to Python visitor

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst scope` passes
- [ ] Scope output matches Python ScopeVisitor for test cases
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Remove scope.rs

**Commit after all checkpoints pass.**

---

##### Step 4.2: BindingCollector {#step-4-2}

**Commit:** `feat(cst): implement BindingCollector visitor`

**References:** Table T01, (#t01-visitor-mapping)

**Artifacts:**
- `tugtool-cst/src/visitor/binding.rs`

**Tasks:**
- [ ] Define `BindingInfo` struct (name, kind, scope_path, span)
- [ ] Define `BindingKind` enum (Function, Class, Parameter, Variable, Import, ImportAlias)
- [ ] Implement `BindingCollector<'a>` struct with scope_path tracking
- [ ] Implement `Visitor<'a>` for BindingCollector
- [ ] Handle function definitions as Function bindings
- [ ] Handle class definitions as Class bindings
- [ ] Handle parameter nodes as Parameter bindings
- [ ] Handle assignment targets as Variable bindings
- [ ] Handle for loop targets as Variable bindings
- [ ] Handle import statements as Import/ImportAlias bindings
- [ ] Handle except handlers with `as` clause
- [ ] Handle with statement `as` targets
- [ ] Implement `extract_assign_targets` for complex LHS patterns
- [ ] Add `into_bindings()` method

**Tests:**
- [ ] Unit: Function binding extracted
- [ ] Unit: Class binding extracted
- [ ] Unit: Parameter bindings extracted
- [ ] Unit: Assignment targets extracted (simple and tuple unpacking)
- [ ] Unit: Import and from-import bindings
- [ ] Golden: Compare output to Python BindingVisitor

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst binding` passes
- [ ] Binding output matches Python for test cases
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Remove binding.rs

**Commit after all checkpoints pass.**

---

##### Step 4.3: ReferenceCollector {#step-4-3}

**Commit:** `feat(cst): implement ReferenceCollector visitor`

**References:** Table T01, (#t01-visitor-mapping)

**Artifacts:**
- `tugtool-cst/src/visitor/reference.rs`

**Tasks:**
- [ ] Define `ReferenceInfo` struct (kind, span)
- [ ] Define `ReferenceKind` enum (Definition, Reference, Call, Attribute, Import)
- [ ] Implement `ReferenceCollector<'a>` with context tracking
- [ ] Track `Name` nodes as references
- [ ] Track function/class names as definitions
- [ ] Track call targets with Call kind
- [ ] Track attribute accesses
- [ ] Build reference map: `HashMap<String, Vec<ReferenceInfo>>`
- [ ] Add `references_for(name: &str)` method
- [ ] Add `into_references()` method

**Tests:**
- [ ] Unit: Name reference collected
- [ ] Unit: Definition reference collected
- [ ] Unit: Call reference collected
- [ ] Unit: All references for a name retrieved
- [ ] Golden: Compare output to Python ReferenceVisitor

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst reference` passes
- [ ] Reference output matches Python for test cases
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Remove reference.rs

**Commit after all checkpoints pass.**

---

##### Step 4.4: RenameTransformer {#step-4-4}

**Commit:** `feat(cst): implement RenameTransformer`

**References:** Table T01, Table T02, (#t01-visitor-mapping, #t02-ipc-operations)

**Artifacts:**
- `tugtool-cst/src/visitor/rename.rs`

**Tasks:**
- [ ] Define `RenameRequest` struct (span, new_name)
- [ ] Implement `RenameTransformer<'a>` struct
- [ ] Implement batch rename logic (apply from end to start)
- [ ] Handle overlapping spans (error or merge)
- [ ] Implement `apply()` method returning transformed source
- [ ] Ensure UTF-8 byte offset handling is correct

**Tests:**
- [ ] Unit: Single rename applied correctly
- [ ] Unit: Multiple renames in same file
- [ ] Unit: Renames don't corrupt surrounding code
- [ ] Unit: UTF-8 names handled correctly
- [ ] Golden: Compare output to Python rewrite_batch

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst rename` passes
- [ ] Rename output identical to Python for test cases
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Remove rename.rs

**Commit after all checkpoints pass.**

---

#### Step 4 Summary {#step-4-summary}

After completing Steps 4.1-4.4, you will have:
- ScopeCollector: Complete scope hierarchy extraction
- BindingCollector: All name definitions
- ReferenceCollector: All name usages with kinds
- RenameTransformer: Batch rename application

**Final Step 4 Checkpoint:**
- [ ] All P0 visitors pass equivalence tests against Python backend
- [ ] Basic rename refactoring works end-to-end in isolation

---

#### Step 5: Integrate with tugtool-python {#step-5}

##### Step 5.1: Feature Flags and Dependencies {#step-5-1}

**Commit:** `feat(python): add native-cst feature flag`

**References:** [D05] Feature flags, (#d05-feature-flags)

**Artifacts:**
- Updated `crates/tugtool-python/Cargo.toml`

**Tasks:**
- [ ] Add `native-cst` feature (default)
- [ ] Add `python-worker` feature (legacy)
- [ ] Add tugtool-cst dependency (optional, enabled by native-cst)
- [ ] Ensure both features can be enabled simultaneously for testing

**Tests:**
- [ ] Unit: Build with `--features native-cst`
- [ ] Unit: Build with `--features python-worker`
- [ ] Unit: Build with both features

**Checkpoint:**
- [ ] `cargo build -p tugtool-python --features native-cst` succeeds
- [ ] `cargo build -p tugtool-python --features python-worker` succeeds
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Revert Cargo.toml changes

**Commit after all checkpoints pass.**

---

##### Step 5.2: CST Bridge Module {#step-5-2}

**Commit:** `feat(python): implement cst_bridge for native analysis`

**References:** [D05] Feature flags, (#internal-architecture)

**Artifacts:**
- `crates/tugtool-python/src/cst_bridge.rs`

**Tasks:**
- [ ] Create cst_bridge.rs module
- [ ] Implement `parse_and_analyze` function using tugtool-cst
- [ ] Implement `rewrite_batch` function using RenameTransformer
- [ ] Define conversion types between tugtool-cst and existing types
- [ ] Implement From traits for type conversion
- [ ] Add error handling and mapping
- [ ] Feature-gate with `#[cfg(feature = "native-cst")]`

**Tests:**
- [ ] Unit: parse_and_analyze returns valid results
- [ ] Unit: rewrite_batch produces correct output
- [ ] Integration: Compare with Python worker output

**Checkpoint:**
- [ ] `cargo test -p tugtool-python cst_bridge` passes
- [ ] Bridge functions callable from analyzer.rs
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Remove cst_bridge.rs

**Commit after all checkpoints pass.**

---

##### Step 5.3: Analyzer Integration {#step-5-3}

**Commit:** `feat(python): integrate native CST in analyzer`

**References:** [D05] Feature flags, (#internal-architecture)

**Artifacts:**
- Updated `crates/tugtool-python/src/analyzer.rs`

**Tasks:**
- [ ] Add native analysis implementation module (feature-gated)
- [ ] Implement `analyze_file` using composite visitor pattern
- [ ] Run all collectors in traversal (scope, binding, reference, etc.)
- [ ] Return `AnalysisResult` compatible with existing code
- [ ] Keep Python worker implementation (feature-gated)
- [ ] Add runtime selection based on features

**Tests:**
- [ ] Unit: Native analysis produces valid results
- [ ] Integration: Analyze real Python files
- [ ] Equivalence: Compare native vs Python worker output

**Checkpoint:**
- [ ] `cargo test -p tugtool-python analyzer` passes
- [ ] Analysis results identical between backends
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Revert analyzer.rs changes

**Commit after all checkpoints pass.**

---

##### Step 5.4: Rename Operation Integration {#step-5-4}

**Commit:** `feat(python): integrate native CST in rename operation`

**References:** [D05] Feature flags, Table T02, (#t02-ipc-operations)

**Artifacts:**
- Updated `crates/tugtool-python/src/ops/rename.rs`

**Tasks:**
- [ ] Add native rename implementation (feature-gated)
- [ ] Use native reference collection
- [ ] Use native RenameTransformer
- [ ] Keep Python worker rename path (feature-gated)
- [ ] Verify identical output between paths

**Tests:**
- [ ] Unit: Native rename produces correct output
- [ ] Integration: Rename across multiple files
- [ ] Equivalence: Compare native vs Python worker rename

**Checkpoint:**
- [ ] `cargo test -p tugtool-python rename` passes
- [ ] Rename operations identical between backends
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Revert rename.rs changes

**Commit after all checkpoints pass.**

---

#### Step 5 Summary {#step-5-summary}

After completing Steps 5.1-5.4, you will have:
- Feature flags controlling backend selection
- CST bridge module for native analysis
- Analyzer using native CST when enabled
- Rename operation using native CST when enabled

**Final Step 5 Checkpoint:**
- [ ] `cargo build -p tugtool-python` produces binary with no Python deps (when python-worker disabled)
- [ ] All existing tests pass with native backend

---

#### Step 6: Port P1 Visitors {#step-6}

**Commit:** `feat(cst): implement P1 analysis visitors`

**References:** Table T01, (#t01-visitor-mapping)

**Artifacts:**
- `tugtool-cst/src/visitor/import.rs`
- `tugtool-cst/src/visitor/annotation.rs`
- `tugtool-cst/src/visitor/type_inference.rs`
- `tugtool-cst/src/visitor/inheritance.rs`
- `tugtool-cst/src/visitor/method_call.rs`

**Tasks:**
- [ ] Implement ImportCollector (import statements, aliases, star imports)
- [ ] Implement AnnotationCollector (type annotations from params, returns, variables)
- [ ] Implement TypeInferenceCollector (x = ClassName() patterns, variable propagation)
- [ ] Implement InheritanceCollector (base classes, Generic subscripts)
- [ ] Implement MethodCallCollector (obj.method() patterns)
- [ ] Add all to visitor module exports
- [ ] Integrate with cst_bridge analyze function

**Tests:**
- [ ] Unit: Each collector produces correct output
- [ ] Golden: Compare each to Python visitor output
- [ ] Integration: Full analysis includes P1 data

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst visitor` passes for all P1 visitors
- [ ] P1 visitor output matches Python for test cases
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Remove P1 visitor files

**Commit after all checkpoints pass.**

---

#### Step 7: Port P2 Visitors {#step-7}

**Commit:** `feat(cst): implement DynamicPatternDetector`

**References:** Table T01, (#t01-visitor-mapping)

**Artifacts:**
- `tugtool-cst/src/visitor/dynamic.rs`

**Tasks:**
- [ ] Implement DynamicPatternDetector
- [ ] Detect getattr/setattr/delattr calls
- [ ] Detect eval/exec calls
- [ ] Detect globals()/locals() subscripts
- [ ] Flag __getattr__/__setattr__ definitions
- [ ] Add to visitor module exports
- [ ] Integrate with cst_bridge

**Tests:**
- [ ] Unit: Each pattern detected
- [ ] Golden: Compare to Python DynamicPatternVisitor

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst dynamic` passes
- [ ] Dynamic pattern output matches Python
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Remove dynamic.rs

**Commit after all checkpoints pass.**

---

#### Step 8: Comprehensive Testing {#step-8}

##### Step 8.1: Round-Trip Test Suite {#step-8-1}

**Commit:** `test(cst): add comprehensive round-trip tests`

**References:** (#test-categories, #fixture-requirements)

**Artifacts:**
- `crates/tugtool-cst/tests/roundtrip.rs`
- Test fixtures in `tests/fixtures/python/`

**Tasks:**
- [ ] Create test fixtures for all major Python constructs
- [ ] Test simple functions, classes, methods
- [ ] Test complex expressions (comprehensions, f-strings)
- [ ] Test all statement types
- [ ] Test decorators and annotations
- [ ] Test async constructs
- [ ] Verify parse -> codegen == original for all fixtures

**Tests:**
- [ ] Golden: ~50 round-trip test cases

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-cst roundtrip` passes
- [ ] No round-trip failures

**Rollback:**
- Remove failing fixtures (investigate root cause)

**Commit after all checkpoints pass.**

---

##### Step 8.2: Visitor Equivalence Tests {#step-8-2}

**Commit:** `test(python): add opt-in visitor equivalence tests (python-worker)`

**References:** (#test-categories)

**Artifacts:**
- `crates/tugtool-python/tests/visitor_equivalence.rs`

**Tasks:**
- [ ] Create equivalence test infrastructure
- [ ] Test ScopeCollector vs Python ScopeVisitor
- [ ] Test BindingCollector vs Python BindingVisitor
- [ ] Test ReferenceCollector vs Python ReferenceVisitor
- [ ] Test all P1 collectors vs Python counterparts
- [ ] Test DynamicPatternDetector vs Python
- [ ] Test RenameTransformer vs Python rewrite_batch
- [ ] Gate these tests behind a feature / cfg so they are not required in default CI

**Tests:**
- [ ] Equivalence: All collectors match Python output

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python equivalence` passes
- [ ] No equivalence failures
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Investigate and fix collector bugs

**Commit after all checkpoints pass.**

---

##### Step 8.3: Golden File Suite {#step-8-3}

**Commit:** `test(cst): add golden file test suite`

**References:** (#test-fixtures, #golden-workflow)

**Artifacts:**
- `crates/tugtool-cst/tests/golden/`
- Golden JSON files for all analysis types

**Tasks:**
- [ ] Create golden test infrastructure
- [ ] Generate golden files for scope analysis
- [ ] Generate golden files for binding analysis
- [ ] Generate golden files for reference analysis
- [ ] Generate golden files for all P1/P2 analysis
- [ ] Document TUG_UPDATE_GOLDEN workflow

**Tests:**
- [ ] Golden: All golden tests pass

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-cst golden` passes
- [ ] `TUG_UPDATE_GOLDEN=1` workflow documented and working
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Update golden files if intentional changes

**Commit after all checkpoints pass.**

---

##### Step 8.4: Performance Benchmarks {#step-8-4}

**Commit:** `test(cst): add performance benchmarks`

**References:** (#success-criteria)

**Artifacts:**
- `crates/tugtool-cst/benches/`
- Benchmark results documentation

**Tasks:**
- [ ] Create benchmark infrastructure using criterion
- [ ] Benchmark parse_module on various file sizes
- [ ] Benchmark full analysis (all collectors)
- [ ] Benchmark rename operation
- [ ] Compare against Python worker baseline
- [ ] Document benchmark results

**Tests:**
- [ ] Benchmark: All benchmarks run successfully

**Checkpoint:**
- [ ] `cargo bench -p tugtool-cst` completes
- [ ] 10x improvement documented for target scenarios
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- N/A (benchmarks are informational)

**Commit after all checkpoints pass.**

---

#### Step 8 Summary {#step-8-summary}

After completing Steps 8.1-8.4, you will have:
- Comprehensive round-trip test coverage
- Visitor equivalence verification
- Golden file regression suite
- Performance benchmark validation

**Final Step 8 Checkpoint:**
- [ ] All test suites pass
- [ ] Performance meets 10x improvement target
- [ ] No regressions from Python backend

---

#### Step 9: Make Native CST Default {#step-9}

**Commit:** `feat(python): make native-cst the default backend`

**References:** [D05] Feature flags, (#success-criteria)

**Artifacts:**
- Updated `crates/tugtool-python/Cargo.toml`
- Updated documentation

**Tasks:**
- [ ] Change default feature from `python-worker` to `native-cst`
- [ ] Update CLAUDE.md documentation
- [ ] Update README with new architecture
- [ ] Add deprecation notice for python-worker feature
- [ ] Verify CI passes with new defaults

**Tests:**
- [ ] Integration: All tests pass with new defaults
- [ ] Golden: No golden file changes

**Checkpoint:**
- [ ] `cargo build -p tugtool` produces native-CST binary by default
- [ ] `ldd` shows no libpython dependency
- [ ] All CI checks pass
- [ ] `cargo nextest run --workspace` passes

**Rollback:**
- Revert default feature change

**Commit after all checkpoints pass.**

---

### 3.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Pure Rust Python refactoring with zero Python subprocess dependencies, achieving 10x performance improvement for large file operations.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build -p tugtool-python` produces binary with no Python dependencies (verify: `ldd` output)
- [ ] Rename operations produce correct, stable results and preserve formatting (verify: integration tests + native golden suite)
- [ ] FactsStore behavior used by rename is stable (verify: same logical symbol/reference set for representative fixtures)
- [ ] Performance improvement >= 10x for 10KB+ Python files (verify: benchmark suite)
- [ ] All existing integration tests pass with native backend (verify: `cargo nextest run`)
- [ ] No Python subprocess spawned when using native backend (verify: strace/dtruss)
- [ ] Default CI path runs with no Python installed (equivalence tests are opt-in during migration)
- [ ] `cargo nextest run --workspace` passes

**Acceptance tests:**
- [ ] Golden: All golden file tests pass
- [ ] Integration: End-to-end rename on real codebase succeeds
- [ ] Benchmark: parse_module 10x faster than Python worker for large files
- [ ] Opt-in: equivalence suite passes when `python-worker` backend is enabled (temporary migration aid)

---

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Parser Extraction Complete** {#m01-parser-extraction}
- [ ] tugtool-cst compiles with no PyO3 dependencies
- [ ] Round-trip tests pass

**Milestone M02: Visitor Infrastructure Complete** {#m02-visitor-infrastructure}
- [ ] Visitor/Transformer traits defined
- [ ] Walk functions for all node types
- [ ] Position tracking working

**Milestone M03: P0 Visitors Complete** {#m03-p0-visitors}
- [ ] ScopeCollector, BindingCollector, ReferenceCollector, RenameTransformer
- [ ] Basic rename works in isolation

**Milestone M04: Integration Complete** {#m04-integration}
- [ ] tugtool-python uses native CST by default
- [ ] All tests pass

---

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Remove python-worker feature entirely (after deprecation period)
- [ ] Add additional refactoring operations (extract function, etc.)
- [ ] Level 2+ type inference
- [ ] Incremental parsing for large files
- [ ] Parallel analysis for multi-file operations

| Checkpoint | Verification |
|------------|--------------|
| No Python deps | `cargo tree -p tugtool-python` shows no pyo3 |
| Identical output | `diff` native vs Python worker golden files |
| 10x performance | `cargo bench` shows improvement |
| Tests pass | `cargo nextest run --workspace` |

**Commit after all checkpoints pass.**
