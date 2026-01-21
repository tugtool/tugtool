## Phase 4: Native CST Position/Span Infrastructure Done Right {#phase-4}

**Purpose:** Replace the cursor-based string search span computation with proper token position exposure from LibCST's internal tokenizer, providing accurate, deterministic byte positions for all CST nodes via embedded NodeId and InflateCtx architecture.

### Goal End State {#goal-end-state}

When Phase 4 is complete, `tugtool-python-cst` will expose accurate, deterministic **byte positions** for key CST nodes derived directly from LibCST tokenization. Parsing will optionally produce a `PositionTable` keyed by embedded `node_id`s on a tracked subset of inflated nodes (e.g., `Name`, `FunctionDef`, `ClassDef`, `Param`, `Decorator`, literals), with per-node `NodePosition` records that hold **identifier**, **lexical**, and **definition** spans. Lexical/definition scope extents for functions and classes will be computed directly from their deflated body suite tokens (e.g., `dedent_tok` / `newline_tok`) and recorded alongside other spans.

All collectors and downstream analysis (`tugtool-python` via `cst_bridge`) will consume these token-derived spans rather than re-discovering positions by scanning source text. The entire cursor-based `find_and_advance()` mechanism becomes unnecessary and is removed from collector code, eliminating correctness issues with repeated identifiers and fragility from traversal-order assumptions. This leaves a position-aware CST foundation that makes rename edits and future refactorings reliable, deterministic, and easy to extend.

**Clarifications and limitations:**

- **Identifier spans live on `Name` nodes only.** To get a function's name span, access `function_def.name.node_id` → lookup in `PositionTable` → `.ident_span`. Same for `Param` (access `param.name.node_id`), class names, etc. This avoids redundant storage and maintains a single source of truth.

- **Literals (`Integer`, `Float`, `SimpleString`) receive `node_id` but no spans in Phase 4.** They are tracked for future expansion (e.g., string literal renaming, constant extraction). Span recording for literals is a follow-on.

- **Module-level scope is not stored in `PositionTable`.** Module scope (byte 0 to EOF) is trivially synthesizable by collectors and doesn't require explicit tracking. If needed, Module can be added to the tracked node list in a follow-on.

- **Lambda and comprehension scopes are not tracked in Phase 4.** Scope analysis covers `FunctionDef` and `ClassDef` only. Lambda/comprehension scope tracking is follow-on work (see [Roadmap](#roadmap)).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-20 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current span computation infrastructure in `tugtool-cst` uses a **cursor-based string search** approach (`find_and_advance()`) to compute byte positions for CST nodes. This approach has fundamental flaws:

1. **Incorrect results**: String search can find the wrong occurrence of an identifier if the same text appears multiple times
2. **Fragile ordering**: Relies on visitor traversal order matching source order exactly
3. **Redundant computation**: Re-computes positions that already exist in the tokenizer

Meanwhile, LibCST's tokenizer already computes accurate byte positions for every token:
- `Token.start_pos: TextPositionSnapshot` - contains `inner_byte_idx`, `inner_char_column_number`, `inner_line_number`
- `Token.end_pos: TextPositionSnapshot` - same fields
- These positions are accurate and computed once during tokenization

The `TokenRef` fields on deflated CST nodes (e.g., `pub(crate) def_tok: TokenRef<'a>`) hold references to these tokens with their position data. However:
- These fields are `pub(crate)` - not exposed to consumers
- After inflation, the `TokenRef` fields are stripped from the inflated nodes
- The position data is effectively lost

This phase will properly expose token positions through the CST API, eliminating the need for string search.

#### Relationship to Phase 3 {#relationship-to-phase-3}

**Phase 4 supersedes Phase 3's Span Infrastructure (Issues 3, 4, 5).**

Phase 3 defined three span types using cursor-based string search:
- Issue 3: Identifier Spans
- Issue 4: Lexical Spans
- Issue 5: Definition Spans

Phase 4 delivers the same three span types with the same semantics, but uses token positions instead of string search:

| Phase 3 Approach | Phase 4 Approach |
|------------------|------------------|
| `find_and_advance()` string search | Token `start_pos`/`end_pos` extraction |
| Positions re-computed during visitor traversal | Positions captured during inflation |
| Fragile ordering assumptions | Deterministic from parser |
| Edge cases with repeated identifiers | Accurate by construction |
| NodeId assigned during traversal | NodeId embedded directly on inflated nodes |

The span type definitions from Phase 3 remain valid (Identifier, Lexical, Definition). Only the implementation changes.

#### Strategy {#strategy}

1. **Understand the existing architecture** - The deflated/inflated node pattern, proc macro generation, and token position flow
2. **Introduce InflateCtx** - Replace `&Config` with `&mut InflateCtx` to thread identity assignment and position collection through inflation
3. **Embed NodeId on inflated nodes** - Put stable `node_id: NodeId` directly on inflated node structs that need tracking
4. **Compute scope spans directly** - `FunctionDef`/`ClassDef` inflate computes lexical/def spans from their own body suite (no SpanFrame stack)
5. **Use PositionTable with NodePosition** - Store separate ident/lexical/def spans per node to avoid overwrite conflicts
6. **Update collectors to use embedded NodeId** - Collectors read `node.node_id` instead of generating IDs during traversal
7. **Remove string search code** - Eliminate `find_and_advance()` from all collectors
8. **Maintain backward compatibility** - Existing code continues to work; new code can use accurate positions

#### Stakeholders / Primary Customers {#stakeholders}

1. tugtool-python rename operations - need accurate identifier spans for text replacement
2. tugtool-python scope analysis - need lexical spans for containment queries
3. Future code navigation features - need definition spans for "go to definition"

#### Success Criteria (Measurable) {#success-criteria}

- All span computation uses token positions, not string search (grep for `find_and_advance` returns zero results in collector code)
- Golden tests pass with identical or improved span accuracy
- No performance regression (benchmark before/after)
- Position data available for: `Name`, `FunctionDef`, `ClassDef`, `Param`, `ImportAlias`, `AsName`, `Attribute`, `Integer`, `Float`, `SimpleString`
- NodeId embedded on inflated nodes - no traversal-order coupling for identity

#### Scope {#scope}

1. Expose token positions from deflated CST nodes
2. Implement `InflateCtx` to replace `&Config` in `Inflate` trait
3. Embed `node_id: NodeId` on key inflated node structs
4. Implement `NodePosition` struct with separate ident/lexical/def span fields
5. Compute scope spans directly in `FunctionDef`/`ClassDef` inflate from body suite tokens
6. Replace `find_and_advance()` in all collectors with `PositionTable` lookups
7. Compute lexical spans (scope extents) from first/last tokens
8. Compute definition spans (including decorators) from token positions

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the deflated/inflated node architecture fundamentally
- Exposing `TokenRef` fields as public API
- **Variable/import statement-level def-spans** - follow-on work, not Phase 4 (see [Roadmap](#roadmap))
- **Parameter "full parameter spans"** - follow-on work covering tuple unpacking, chained assignment, `with/as`, `except as`, multi-import lines
- **Line/col as internal representation** - byte-only is the internal truth; line/col computed on demand at presentation boundaries
- Python version-specific parsing changes

#### Dependencies / Prerequisites {#dependencies}

- Phase 3 collectors exist and have tests (provides test coverage for regression detection)
- Understanding of LibCST's deflated/inflated pattern
- Understanding of `#[cst_node]` proc macro

#### Constraints {#constraints}

- Must not break existing `parse_module()` → `Module<'a>` API
- Must not require changes to consumer code that doesn't need positions
- Performance must not regress (parsing + position extraction must be faster than parsing + string search)

#### Assumptions {#assumptions}

- Token positions from LibCST's tokenizer are accurate (they are; this is well-tested)
- All nodes we need to track have associated `TokenRef` fields (verified via grep)
- The `#[cst_node]` macro can be extended to optionally add `node_id` fields

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Crate Structure: Keep Two Crates or Consolidate? (DECIDED) {#q01-crate-structure}

**Question:** Should `tugtool-cst` and `tugtool-cst-derive` remain separate, or be consolidated?

**Why it matters:** Maintenance overhead, discoverability, and namespace clarity.

**Analysis:**

The two-crate structure exists due to Rust's proc-macro constraints:
- Proc-macro crates can only export procedural macros
- They cannot export types, traits, or functions
- `tugtool-cst-derive` exports: `#[derive(Inflate)]`, `#[derive(Codegen)]`, `#[derive(ParenthesizedNode)]`, `#[cst_node]`
- `tugtool-cst` uses these macros and exports all CST types

**Decision:** KEEP SEPARATE - The separation is required by Rust's proc-macro rules. No consolidation is possible without major restructuring that provides no benefit.

**Resolution:** DECIDED - Keep the existing two-crate structure. Document the relationship in both crate READMEs.

---

#### [Q02] Should We Rename Crates to Include "Python"? (DECIDED) {#q02-crate-naming}

**Question:** Should `tugtool-cst` become `tugtool-python-cst` to clarify it's Python-specific?

**Why it matters:** Clarity for contributors and potential future multi-language support.

**Analysis:**

Arguments for renaming:
- These crates are Python-specific (adapted from LibCST, a Python parser)
- If we add Rust CST support later, naming would be confusing
- Clear naming prevents mistakes when adding other language support

Arguments against renaming:
- Breaking change for all imports
- The crates are internal implementation details of `tugtool-python`

**Decision:** RENAME - Add "python" to crate names for clarity as the project grows.

| Current Name | New Name |
|--------------|----------|
| `tugtool-cst` | `tugtool-python-cst` |
| `tugtool-cst-derive` | `tugtool-python-cst-derive` |

**Resolution:** DECIDED - Rename crates as a prerequisite step before other Phase 4 work.

---

#### [Q03] Position Exposure Approach (DECIDED) {#q03-position-approach}

**Question:** How should we expose token positions to collectors?

**Why it matters:** This is the core design decision for the phase.

**Decision:** VARIANT 1 - Embed NodeId directly on inflated nodes. Thread a mutable `InflateCtx` through inflation that owns identity assignment and position collection.

**Rationale:**
- No traversal-order coupling - NodeId is assigned during inflation, embedded on the node
- Collectors read `node.node_id` directly - no separate ID generation during traversal
- Clean separation of concerns - `InflateCtx` owns all inflation-time state
- Avoids the fragility of "inflation order == visitor traversal order" assumption

**Previous options considered but rejected:**

- **Option A (Add Methods to Inflated Nodes)**: Rejected - requires position storage on nodes, memory overhead
- **Option B (Parallel Position Collection via Config)**: Rejected - relies on inflation order == traversal order, which is fragile
- **Option C (Expose Deflated Tree Access)**: Subsumed by Variant 1
- **Option D (Token-Aware Visitor)**: Rejected - significant new infrastructure, unnecessary complexity

**Resolution:** DECIDED - Implement Variant 1 with `InflateCtx` and embedded `node_id`.

---

#### [Q04] What Identifier Scheme for Position Table? (DECIDED) {#q04-position-identifier}

**Question:** How should positions be keyed in the PositionTable?

**Why it matters:** Need a stable identifier to correlate positions with CST nodes.

**Decision:** NodeId embedded directly on inflated nodes. PositionTable keyed by NodeId, but nodes carry their own identity.

**Rationale:**
- NodeId is assigned during inflation via `InflateCtx.ids.next()`
- The NodeId is stored directly on the inflated node struct (e.g., `FunctionDef.node_id`)
- Collectors and consumers read `node.node_id` - no separate ID tracking needed
- PositionTable still keyed by NodeId for span lookups
- No dependence on traversal order matching inflation order

**Resolution:** DECIDED - Embed NodeId on nodes; see [D04].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Macro changes touch many generated nodes | medium | high | Incremental rollout, thorough testing | Build failures in generated code |
| Default trait for nodes with NodeId | medium | medium | Use `Option<NodeId>` with `None` default | Compile errors in Default derive |
| Performance regression | medium | low | Benchmark before/after | >10% slowdown in benchmarks |
| Position data missing for some nodes | medium | low | Audit all node types with `TokenRef` fields | Test failures for expected positions |

**Risk R02: Macro Changes Touch Many Generated Nodes** {#r02-macro-changes}

- **Risk:** Changing the `#[cst_node]` macro to add `node_id` fields affects every generated inflated node type.
- **Mitigation:**
  - Make `node_id` field opt-in via macro attribute (e.g., `#[cst_node(tracked)]`)
  - Roll out incrementally: first to `FunctionDef`, `ClassDef`, `Name`, then expand
  - Ensure thorough test coverage before and after
- **Residual risk:** Some edge cases in generated code may surface during implementation

**Risk R03: Default Trait Compatibility** {#r03-default-trait}

- **Risk:** Nodes with `#[cst_node(Default)]` derive `Default`. Adding a required `NodeId` field breaks this.
- **Mitigation:**
  - Use `node_id: Option<NodeId>` which defaults to `None`
  - Parser/inflation always sets `Some(id)`, only programmatic construction uses `None`
  - Alternative: use sentinel value like `NodeId(u32::MAX)` for default
- **Residual risk:** Code that relies on default-constructed nodes may need updates

---

### 4.0 Design Decisions {#design-decisions}

#### [D01] Keep Two-Crate Structure (DECIDED) {#d01-keep-two-crates}

**Decision:** Keep `tugtool-cst` and `tugtool-cst-derive` as separate crates.

**Rationale:**
- Rust requires proc-macro crates to be separate
- The current structure follows the original LibCST architecture
- No consolidation is possible without losing proc-macro functionality

**Implications:**
- No crate restructuring needed in this phase
- Document the relationship in both crates

---

#### [D02] Rename Crates to Include "Python" (DECIDED) {#d02-rename-crates}

**Decision:** Rename crates to clarify they are Python-specific.

| Current Name | New Name |
|--------------|----------|
| `tugtool-cst` | `tugtool-python-cst` |
| `tugtool-cst-derive` | `tugtool-python-cst-derive` |

**Rationale:**
- These crates are Python-specific (adapted from LibCST)
- Clear naming prevents confusion when adding support for other languages
- Better discoverability and self-documentation

**Implications:**
- Rename crate directories under `crates/`
- Update all `Cargo.toml` files (workspace and dependents)
- Update all `use` statements in consuming code
- Update CLAUDE.md documentation

---

#### [D03] Introduce InflateCtx to Replace Config (DECIDED) {#d03-inflate-ctx}

**Decision:** Change the `Inflate` trait to take `&mut InflateCtx<'a>` instead of `&Config<'a>`.

**Rationale:**
- Mutable access needed for NodeId assignment (`ids.next()`)
- Mutable access needed for position recording (`positions.insert()`)
- Single context struct is cleaner than threading multiple parameters
- Avoids borrow-checker issues with multiple mutable references

**InflateCtx structure:**

```rust
pub struct InflateCtx<'a> {
    /// Existing whitespace/config inputs needed by inflate code
    pub ws: whitespace_parser::Config<'a>,

    /// Stable identity assignment - generates sequential NodeIds
    pub ids: NodeIdGenerator,

    /// Optional position capture - None if caller doesn't need positions
    pub positions: Option<PositionTable>,
}
```

**Note:** No `span_stack` field - scope spans are computed directly in `FunctionDef`/`ClassDef` inflate (see [D10]).

**Implications:**
- Change `Inflate` trait signature from `fn inflate(self, config: &Config<'a>)` to `fn inflate(self, ctx: &mut InflateCtx<'a>)`
- Update all `Inflate` implementations (generated and manual)
- Update `#[cst_node]` macro to generate new signature
- The existing `Config` struct becomes a field within `InflateCtx`

---

#### [D04] Embed NodeId on Inflated Nodes (DECIDED) {#d04-embed-nodeid}

**Decision:** Add `pub(crate) node_id: Option<NodeId>` field directly to inflated node structs that need tracking.

**Rationale:**
- Decouples identity from traversal order - the node carries its own ID
- Collectors read `node.node_id` instead of generating IDs during traversal
- Eliminates the fragile assumption that "inflation order == visitor traversal order"
- `Option<NodeId>` allows `Default` trait to work (defaults to `None`)

**Nodes to track (initial set):**
- `Name` - identifiers, most critical for rename
- `Param` - function parameters
- `FunctionDef` - function definitions
- `ClassDef` - class definitions
- `Decorator` - for def_span start tracking
- `Integer`, `Float`, `SimpleString` - literals
- `IndentedBlock` / `Suite` - scope boundary tracking (if needed)

**Implications:**
- Modify `#[cst_node]` macro to optionally add `node_id` field
- Or manually add field to specific node structs
- Update `Inflate` implementations to call `ctx.ids.next()` and store result
- Collectors can directly access `node.node_id.unwrap()` (or handle None)

---

#### [D05] Add tok Field to DeflatedName (DECIDED) {#d05-name-tok-field}

**Decision:** Add `pub(crate) tok: Option<TokenRef<'a>>` field to the `Name` struct definition.

**Rationale:**
- `Name` nodes are the most critical for position tracking (identifiers in rename operations)
- Currently `DeflatedName` lacks a `tok` field, unlike `Dot`, `Comma`, `Param`, etc.
- The parser already has the token available but discards it
- This enables direct O(1) position lookup instead of string search

**Why `Option<TokenRef>`:**
- `TokenRef<'a>` is a reference type (`&'a Token<'a>`) that cannot implement `Default`
- `Name` has `#[cst_node(Default)]` which derives `Default` for `DeflatedName`
- Using `Option<TokenRef<'a>>` allows `Default` to work (defaults to `None`)
- All parser-created `Name` nodes will have `Some(tok)`; only default-constructed nodes have `None`

**Pattern Precedent:**
- `Param` uses `star_tok: Option<TokenRef<'a>>` for the same reason
- `Dot`, `Comma`, `Semicolon` have `tok: TokenRef<'a>` but don't derive `Default`

**Implications:**
- Modify `Name` struct in `expression.rs` to add `tok: Option<TokenRef<'a>>`
- Update `make_name()` in `grammar.rs` to store `Some(tok)`
- No changes needed to `Inflate` or `Codegen` implementations
- The `#[cst_node]` macro handles the rest automatically

---

#### [D06] Scope End Boundary Semantics (DECIDED) {#d06-scope-end-boundary}

**Decision:** Define precise scope end boundary rules for different suite types.

**Rules:**

1. **Indented suites**: `end = dedent_tok.start_pos.byte_idx()` (or EOF if no dedent)
2. **Single-line suites**: `end = suite_last_token.end_pos.byte_idx()`
3. **Trailing newline**: Not special-cased. Whatever falls before the boundary is included naturally.
4. **Span format**: Use half-open byte spans `[start, end)` for containment queries.

**Rationale:**
- `dedent_tok` marks the precise boundary where indentation decreases
- Half-open intervals `[start, end)` are standard and make containment checks simple: `start <= pos < end`
- Trailing newlines are part of the content if they're before the dedent

**Implications:**
- `FunctionDef`/`ClassDef` inflate computes scope end directly from body suite tokens (see [D10])
- Scope collectors use `NodePosition.lexical_span` for lexical spans
- Containment queries use `span.start <= pos && pos < span.end`

---

#### [D07] Definition Span Coverage - Phase 4 Scope (DECIDED) {#d07-def-span-scope}

**Decision:** Define what definition spans Phase 4 covers vs. follow-on work.

**Phase 4 Core (in scope):**
- `def_span` + `lexical_span` for `FunctionDef`/`ClassDef` (including decorators)
- Identifier spans for `Name`, `Param`, import names
- Sufficient for rename operations and scope infrastructure

**Follow-on Work (NOT Phase 4):**
- Variable "full statement spans" (e.g., `x = 1` entire line)
- Import "full statement spans" (e.g., `from foo import bar, baz` entire line)
- Parameter "full parameter spans" covering:
  - Tuple unpacking: `def f((a, b)): ...`
  - Chained assignment: `a = b = 1`
  - `with ... as x`: binding in context manager
  - `except E as e`: exception binding
  - Multi-import lines: `import a, b, c`

**Rationale:**
- Phase 4 focuses on infrastructure needed for rename + scope analysis
- Statement-level spans require additional tracking complexity
- Clean boundary allows Phase 4 to ship without scope creep

**Implications:**
- Record follow-on items explicitly in [Roadmap](#roadmap) section
- Don't attempt to capture statement-level spans in Phase 4

---

#### [D08] Definition Extraction Semantics (DECIDED) {#d08-def-extraction}

**Decision:** `def_span` strictly starts at the first `@` / `def` / `class` token.

**Rules:**
- `def_span` does NOT absorb leading comments or blank lines
- For decorated definitions: start at first decorator's `@` token
- For undecorated definitions: start at `def` or `class` token

**Rationale:**
- "Leading trivia" (comments, blank lines) is semantically ambiguous
- A comment above a function might be a docstring-style explanation, or unrelated
- Starting at the definition keyword/decorator is unambiguous
- If needed later, add a separate optional "leading trivia span" policy

**Implications:**
- `def_span` start computed from `decorators[0].at_tok.start_pos` if decorators exist
- Otherwise from `def_tok.start_pos` or `class_tok.start_pos`
- No special handling for preceding comments

---

#### [D09] Output Contract - Byte-Only Spans (DECIDED) {#d09-byte-only-spans}

**Decision:** Spans are byte-only internally everywhere. Line/col computed only at presentation boundaries.

**Rules:**
- Internal span representation uses `tugtool_core::patch::Span` with u64 byte offsets
- No storage of line/col alongside byte offsets
- Line/col computed on demand when needed for:
  - CLI/JSON output
  - Diagnostic messages
  - LSP-style interfaces

**Rationale:**
- Byte spans are what's needed for deterministic text edits
- Storing both byte and line/col invites inconsistencies
- Line/col can be derived cheaply when needed (single pass over source)
- Simpler internal representation, fewer invariants to maintain

**Implications:**
- `PositionTable` stores only byte spans (via `NodePosition`)
- Output formatters compute line/col from byte spans + source text
- No `LineCol` type needed in core span infrastructure

---

#### [D10] Scope End Computed in FunctionDef/ClassDef (DECIDED) {#d10-scope-end-direct}

**Decision:** Compute scope end positions directly in `FunctionDef::inflate()` and `ClassDef::inflate()` rather than using a `SpanFrame` stack with pop in `IndentedBlock::inflate()`.

**Problem with Stack Approach:**
`IndentedBlock` is the generic suite representation used for:
- Function/class bodies
- `if`/`elif`/`else` blocks
- `for`/`while` loop bodies
- `try`/`except`/`finally` blocks
- `with` statement bodies
- `match`/`case` blocks

If `IndentedBlock::inflate()` calls `ctx.pop_scope()`, it would pop on every nested block inside a function, not just the function's own body suite.

**Solution:**
`FunctionDef::inflate()` and `ClassDef::inflate()` directly access their body suite's end position:
1. Inflate the body (which is a `Suite`)
2. Access the body's `dedent_tok` (for `IndentedBlock`) or last token (for `SimpleStatementSuite`)
3. Compute and record spans immediately, before returning

**Rationale:**
- No risk of incorrect pops from nested blocks
- Simpler implementation - no stack management needed
- The deflated `FunctionDef` already holds its body suite, so we can access its tokens directly
- Single point of truth for scope boundary computation

**Implications:**
- Remove `span_stack: Vec<SpanFrame>` from `InflateCtx`
- Remove `push_scope()` and `pop_scope()` methods
- `FunctionDef`/`ClassDef` inflate implementations compute spans directly
- Spans recorded via `ctx.record_lexical_span()` and `ctx.record_def_span()`

---

#### [D11] Ident Span Lives on Name Node Only (DECIDED) {#d11-ident-span-policy}

**Decision:** Store `ident_span` only on `Name` nodes (and similar leaf identifier nodes like `Param.name`). Do NOT store redundant identifier spans on parent nodes like `FunctionDef`/`ClassDef`.

**Policy:**
- `Name` nodes: store `ident_span` (the identifier text span)
- `FunctionDef`/`ClassDef` nodes: store only `lexical_span` and `def_span`
- To get a function's name span: access `function_def.name.node_id` → lookup in `PositionTable` → `.ident_span`

**Rationale:**
- Avoids redundant storage (function name span stored twice)
- Single source of truth for identifier spans
- Consistent model: leaf nodes carry identifier spans, compound nodes carry scope spans
- Consumers follow the natural CST structure to find name spans

**Implications:**
- Remove `record_ident_span()` call from `FunctionDef::inflate()` example
- `FunctionDef::inflate()` only records `lexical_span` and `def_span`
- `Name::inflate()` records its own `ident_span` using its embedded `node_id`

---

#### [D12] Tracked Node Count Definition (DECIDED) {#d12-tracked-node-count}

**Decision:** `tracked_node_count` is the count of nodes that receive embedded `node_id` during inflation - a **subset** of all inflated nodes.

**Tracked nodes (receive `node_id`):**
- `Name` - identifiers (records `ident_span`)
- `Param` - function parameters (no spans; access `param.name.node_id` for name span)
- `FunctionDef` - function definitions (records `lexical_span`, `def_span`)
- `ClassDef` - class definitions (records `lexical_span`, `def_span`)
- `Decorator` - decorators (records `ident_span` for decorator name via nested `Name`)
- `Integer`, `Float`, `SimpleString` - literals (node_id only in Phase 4; span recording is follow-on)

**NOT tracked (no `node_id`):**
- Most expression nodes (`BinaryOperation`, `Call`, etc.)
- Most statement nodes (`If`, `For`, `While`, etc.)
- Whitespace/formatting nodes
- Structural nodes (`Parameters`, `Arguments`, etc.)

**Rationale:**
- Only nodes that need position lookup get IDs
- Keeps the tracked set small and focused
- Can expand in follow-on if needed

**Implications:**
- `ParsedModule.tracked_node_count` reflects subset size
- `PositionTable` will have entries for tracked nodes only
- Collectors must check `node.node_id.is_some()` or use only tracked node types

---

### 4.1 Token Position Data Model {#position-data-model}

#### 4.1.1 Existing Position Types {#existing-position-types}

LibCST's tokenizer provides position data through these types:

**File:** `crates/tugtool-python-cst/src/tokenizer/text_position/mod.rs`

```rust
/// Lightweight immutable snapshot of a position in source text.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TextPositionSnapshot {
    pub inner_byte_idx: usize,        // Byte offset in UTF-8 source
    pub inner_char_column_number: usize, // Column (character count)
    pub inner_line_number: usize,     // Line number (1-indexed)
}

impl TextPositionSnapshot {
    pub fn byte_idx(&self) -> usize { ... }
    pub fn char_column_number(&self) -> usize { ... }
    pub fn line_number(&self) -> usize { ... }
}
```

**File:** `crates/tugtool-python-cst/src/tokenizer/core/mod.rs`

```rust
#[derive(Clone)]
pub struct Token<'a> {
    pub r#type: TokType,
    pub string: &'a str,
    pub start_pos: TextPositionSnapshot,  // <-- Position data here
    pub end_pos: TextPositionSnapshot,    // <-- Position data here
    pub whitespace_before: Rc<RefCell<WhitespaceState<'a>>>,
    pub whitespace_after: Rc<RefCell<WhitespaceState<'a>>>,
    pub relative_indent: Option<&'a str>,
}
```

#### 4.1.2 Token References in CST Nodes {#token-refs-in-nodes}

Deflated CST nodes store `TokenRef<'r, 'a>` (which is `&'r Token<'a>`) for tokens that are semantically significant:

**Table T01: TokenRef Fields by Node Type** {#t01-tokenref-fields}

| Node Type | TokenRef Field(s) | Position Data Available |
|-----------|-------------------|-------------------------|
| `DeflatedFunctionDef` | `def_tok`, `open_paren_tok`, `close_paren_tok`, `colon_tok`, `async_tok?` | Function keyword, parens, body start |
| `DeflatedClassDef` | `class_tok`, `open_paren_tok?`, `close_paren_tok?`, `colon_tok` | Class keyword, body start |
| `DeflatedDecorator` | `at_tok`, `newline_tok` | Decorator start |
| `DeflatedParam` | `tok` | Parameter name position |
| `DeflatedName` | `tok` (after D05) | Identifier position |
| `DeflatedImportAlias` | (depends on underlying name) | Via nested nodes |
| `DeflatedAsName` | `as_tok` | "as" keyword position |
| `DeflatedIndentedBlock` | `newline_tok`, `indent_tok`, `dedent_tok` | Block boundaries |
| `DeflatedInteger` | `tok` | Literal position |
| `DeflatedFloat` | `tok` | Literal position |
| `DeflatedSimpleString` | `tok` | String literal position |
| `DeflatedAttribute` | (via nested `Name`) | Attribute name position |

---

### 4.2 Span Type Definitions {#span-type-definitions}

This phase implements three distinct span types, each serving a different purpose.

#### 4.2.1 Identifier Span {#identifier-span}

**Definition:** The byte range covering just the identifier text.

**Purpose:** Text replacement during rename operations.

**Examples:**

```python
def foo():     # Identifier span: bytes covering "foo" (3 bytes)
    x = 1      # Identifier span: bytes covering "x" (1 byte)
```

**Computation:** From token `start_pos.byte_idx()` to `end_pos.byte_idx()`.

#### 4.2.2 Lexical Span {#lexical-span}

**Definition:** The byte range defining the lexical extent of a scope - where variables resolve to this scope.

**Purpose:** Containment queries ("is position X inside scope Y?").

**Critical rule:** Lexical spans do NOT include decorators. Decorators execute before the scope exists.

**Examples:**

```python
@decorator           # NOT in lexical span
def foo():           # Lexical span starts at 'def' (or 'async def')
    x = 1            # Inside lexical span
                     # Lexical span ends at dedent_tok.start_pos
```

**Computation:**
- Start: `def_tok.start_pos.byte_idx()` (or `async_tok` if async)
- End: `dedent_tok.start_pos.byte_idx()` for indented suites, or last token end for single-line suites

**Table T02: Lexical Span Boundaries by Scope Kind** {#t02-lexical-spans}

| Scope Kind | Start Token | End Position |
|------------|-------------|--------------|
| Module | Byte 0 | `eof_tok.start_pos.byte_idx()` |
| Function | `def_tok` (or `async_tok`) | `dedent_tok.start_pos.byte_idx()` |
| Class | `class_tok` | `dedent_tok.start_pos.byte_idx()` |
| Lambda | `lambda_tok` | End of lambda expression |
| Comprehension | Opening `[`, `{`, or `(` | Closing bracket |

#### 4.2.3 Definition Span {#definition-span}

**Definition:** The byte range covering the complete extractable definition, including decorators.

**Purpose:** Code extraction, "copy definition", refactoring.

**Critical rule:** Definition spans INCLUDE decorators. They start at the first `@` token if decorators exist.

**Examples:**

```python
@decorator           # Definition span starts here (at @)
def foo():           #
    x = 1            # Definition span ends here (at dedent)
```

**Computation:**
- Start: First decorator's `at_tok.start_pos.byte_idx()`, or lexical span start if no decorators
- End: Same as lexical span end

---

### 4.3 Implementation Architecture {#implementation-architecture}

#### 4.3.1 InflateCtx Structure {#inflate-ctx-structure}

**File:** `crates/tugtool-python-cst/src/inflate_ctx.rs` (new)

```rust
use crate::nodes::traits::{NodeId, NodeIdGenerator};
use crate::tokenizer::whitespace_parser::Config as WhitespaceConfig;
use std::collections::HashMap;
use tugtool_core::patch::Span;

/// Position information for a single node. Different span types serve different purposes.
#[derive(Debug, Clone, Default)]
pub struct NodePosition {
    /// Identifier span: just the name text (for rename operations)
    pub ident_span: Option<Span>,

    /// Lexical span: scope extent, excludes decorators (for containment queries)
    pub lexical_span: Option<Span>,

    /// Definition span: complete extractable definition, includes decorators (for code extraction)
    pub def_span: Option<Span>,
}

/// Maps NodeId to position information. Keyed by NodeId, stores multiple span types per node.
/// Note: HashMap is fine for Phase 4. Follow-on optimization: since NodeIdGenerator is sequential,
/// `Vec<Option<NodePosition>>` indexed by `NodeId.0` would be faster and simpler.
pub type PositionTable = HashMap<NodeId, NodePosition>;

/// Context threaded through inflation for identity assignment and position capture.
pub struct InflateCtx<'a> {
    /// Existing whitespace/config inputs needed by inflate code
    pub ws: WhitespaceConfig<'a>,

    /// Stable identity assignment - generates sequential NodeIds
    pub ids: NodeIdGenerator,

    /// Optional position capture - None if caller doesn't need positions
    pub positions: Option<PositionTable>,
}

impl<'a> InflateCtx<'a> {
    /// Create context for inflation without position tracking.
    pub fn new(ws: WhitespaceConfig<'a>) -> Self {
        Self {
            ws,
            ids: NodeIdGenerator::new(),
            positions: None,
        }
    }

    /// Create context for inflation with position tracking enabled.
    pub fn with_positions(ws: WhitespaceConfig<'a>) -> Self {
        Self {
            ws,
            ids: NodeIdGenerator::new(),
            positions: Some(PositionTable::new()),
        }
    }

    /// Generate the next NodeId.
    pub fn next_id(&mut self) -> NodeId {
        self.ids.next()
    }

    /// Record an identifier span for a node (if position tracking enabled).
    pub fn record_ident_span(&mut self, id: NodeId, span: Span) {
        if let Some(ref mut positions) = self.positions {
            positions.entry(id).or_default().ident_span = Some(span);
        }
    }

    /// Record a lexical span for a node (if position tracking enabled).
    pub fn record_lexical_span(&mut self, id: NodeId, span: Span) {
        if let Some(ref mut positions) = self.positions {
            positions.entry(id).or_default().lexical_span = Some(span);
        }
    }

    /// Record a definition span for a node (if position tracking enabled).
    pub fn record_def_span(&mut self, id: NodeId, span: Span) {
        if let Some(ref mut positions) = self.positions {
            positions.entry(id).or_default().def_span = Some(span);
        }
    }
}
```

**Note:** The `SpanFrame` stack has been removed. See [D10] for why scope end is computed directly in `FunctionDef`/`ClassDef` inflate rather than using a stack.

#### 4.3.2 Changed Inflate Trait Signature {#inflate-trait-signature}

**File:** `crates/tugtool-python-cst/src/nodes/traits.rs`

**Change from:**
```rust
pub trait Inflate<'a>
where
    Self: Sized,
{
    type Inflated;
    fn inflate(self, config: &Config<'a>) -> Result<Self::Inflated>;
}
```

**Change to:**
```rust
pub trait Inflate<'a>
where
    Self: Sized,
{
    type Inflated;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated>;
}
```

#### 4.3.3 Embedded NodeId on Inflated Nodes {#embedded-nodeid}

Example for `FunctionDef`:

```rust
#[cst_node]
pub struct FunctionDef<'a> {
    pub name: Name<'a>,
    pub params: Parameters<'a>,
    pub body: Suite<'a>,
    pub decorators: Vec<Decorator<'a>>,
    pub returns: Option<Annotation<'a>>,
    pub asynchronous: Option<Asynchronous<'a>>,
    // ... other fields ...

    /// Stable identity assigned during inflation
    pub(crate) node_id: Option<NodeId>,
}
```

During inflation (using direct scope end computation per [D10]):

```rust
impl<'r, 'a> Inflate<'a> for DeflatedFunctionDef<'r, 'a> {
    type Inflated = FunctionDef<'a>;

    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        // Assign identity early
        let node_id = ctx.next_id();

        // Compute span starts from tokens
        let lexical_start = self.async_tok
            .map(|t| t.start_pos.byte_idx() as u64)
            .unwrap_or(self.def_tok.start_pos.byte_idx() as u64);

        let def_start = if !self.decorators.is_empty() {
            // First decorator's @ token
            self.decorators[0].at_tok.start_pos.byte_idx() as u64
        } else {
            lexical_start
        };

        // Compute scope end DIRECTLY from our own body suite (see [D10])
        // This avoids the IndentedBlock pop-on-every-block problem
        let scope_end = match &self.body {
            DeflatedSuite::IndentedBlock(block) => {
                block.dedent_tok.start_pos.byte_idx() as u64
            }
            DeflatedSuite::SimpleStatementSuite(suite) => {
                suite.newline_tok.end_pos.byte_idx() as u64
            }
        };

        // Record scope spans immediately (if position tracking enabled)
        // Note: ident_span is NOT recorded here - it lives on the Name node per [D11]
        ctx.record_lexical_span(node_id, Span { start: lexical_start, end: scope_end });
        ctx.record_def_span(node_id, Span { start: def_start, end: scope_end });

        // Inflate children (Name.inflate() will record its own ident_span)
        let name = self.name.inflate(ctx)?;
        let params = self.params.inflate(ctx)?;
        let body = self.body.inflate(ctx)?;
        let decorators = self.decorators.inflate(ctx)?;
        let returns = self.returns.inflate(ctx)?;
        // ...

        Ok(FunctionDef {
            name,
            params,
            body,
            decorators,
            returns,
            node_id: Some(node_id),
            // ...
        })
    }
}
```

**Key insight:** The scope end is computed from `self.body` (the *deflated* body) before inflation, so we have access to the raw `dedent_tok`. This is computed once per function/class, not on every nested block.

#### 4.3.4 New API Surface {#new-api-surface}

**File:** `crates/tugtool-python-cst/src/lib.rs`

```rust
/// Parse result that includes position information.
pub struct ParsedModule<'a> {
    pub module: Module<'a>,
    pub positions: PositionTable,
    pub tracked_node_count: u32,  // Renamed to clarify meaning
}

/// Parse a module and extract position information.
pub fn parse_module_with_positions<'a>(
    source: &'a str,
    encoding: Option<&str>,
) -> Result<'a, ParsedModule<'a>> {
    let tokens = tokenize(source)?;
    let ws_config = whitespace_parser::Config::new(source, &tokens);
    let mut ctx = InflateCtx::with_positions(ws_config);

    let module = parse_tokens(source, &tokens)?;
    let inflated = module.inflate(&mut ctx)?;

    Ok(ParsedModule {
        module: inflated,
        positions: ctx.positions.unwrap(),
        tracked_node_count: ctx.ids.count(),
    })
}
```

---

### 4.4 Symbol Inventory {#symbol-inventory}

#### 4.4.1 New Types {#new-types}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `InflateCtx<'a>` | struct | `crates/tugtool-python-cst/src/inflate_ctx.rs` | Context for inflation with id/position tracking |
| `NodePosition` | struct | `crates/tugtool-python-cst/src/inflate_ctx.rs` | Per-node position info (ident/lexical/def spans) |
| `PositionTable` | type alias | `crates/tugtool-python-cst/src/inflate_ctx.rs` | `HashMap<NodeId, NodePosition>` |
| `ParsedModule<'a>` | struct | `crates/tugtool-python-cst/src/lib.rs` | Parse result with positions |

#### 4.4.2 Modified Types {#modified-types}

| Symbol | Kind | Location | Change |
|--------|------|----------|--------|
| `Inflate<'a>` | trait | `crates/tugtool-python-cst/src/nodes/traits.rs` | Signature changes to take `&mut InflateCtx<'a>` |
| `Name<'a>` | struct | `crates/tugtool-python-cst/src/nodes/expression.rs` | Add `tok: Option<TokenRef<'a>>` and `node_id: Option<NodeId>` |
| `FunctionDef<'a>` | struct | `crates/tugtool-python-cst/src/nodes/statement.rs` | Add `node_id: Option<NodeId>` |
| `ClassDef<'a>` | struct | `crates/tugtool-python-cst/src/nodes/statement.rs` | Add `node_id: Option<NodeId>` |
| `Param<'a>` | struct | `crates/tugtool-python-cst/src/nodes/expression.rs` | Add `node_id: Option<NodeId>` |
| `Decorator<'a>` | struct | `crates/tugtool-python-cst/src/nodes/statement.rs` | Add `node_id: Option<NodeId>` |
| `Integer<'a>` | struct | `crates/tugtool-python-cst/src/nodes/expression.rs` | Add `node_id: Option<NodeId>` |
| `Float<'a>` | struct | `crates/tugtool-python-cst/src/nodes/expression.rs` | Add `node_id: Option<NodeId>` |
| `SimpleString<'a>` | struct | `crates/tugtool-python-cst/src/nodes/expression.rs` | Add `node_id: Option<NodeId>` |

#### 4.4.3 New Functions {#new-functions}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `parse_module_with_positions` | fn | `crates/tugtool-python-cst/src/lib.rs` | Main new API |
| `InflateCtx::new` | fn | `crates/tugtool-python-cst/src/inflate_ctx.rs` | Create context without positions |
| `InflateCtx::with_positions` | fn | `crates/tugtool-python-cst/src/inflate_ctx.rs` | Create context with position tracking |
| `InflateCtx::next_id` | fn | `crates/tugtool-python-cst/src/inflate_ctx.rs` | Generate next NodeId |
| `InflateCtx::record_ident_span` | fn | `crates/tugtool-python-cst/src/inflate_ctx.rs` | Record identifier span for a node |
| `InflateCtx::record_lexical_span` | fn | `crates/tugtool-python-cst/src/inflate_ctx.rs` | Record lexical span for a scope |
| `InflateCtx::record_def_span` | fn | `crates/tugtool-python-cst/src/inflate_ctx.rs` | Record definition span for a scope |

#### 4.4.4 Types with Usage Changes {#usage-changes}

| Symbol | Kind | Location | Change |
|--------|------|----------|--------|
| `Config<'a>` | struct | `crates/tugtool-python-cst/src/tokenizer/whitespace_parser.rs` | Now accessed via `ctx.ws` instead of directly |

---

### 4.5 Execution Steps {#execution-steps}

#### Prerequisite: Rename CST Crates {#step-prereq}

**Commit:** `refactor(cst): rename tugtool-cst to tugtool-python-cst`

**References:** [D02] Rename crates, [Q02] Crate naming decision

**Artifacts:**
- Renamed `crates/tugtool-cst/` → `crates/tugtool-python-cst/`
- Renamed `crates/tugtool-cst-derive/` → `crates/tugtool-python-cst-derive/`
- Updated all Cargo.toml files
- Updated all import statements

**Tasks:**
- [x] Rename `crates/tugtool-cst-derive/` directory to `crates/tugtool-python-cst-derive/`
- [x] Rename `crates/tugtool-cst/` directory to `crates/tugtool-python-cst/`
- [x] Update `crates/tugtool-python-cst-derive/Cargo.toml`: change `name = "tugtool-cst-derive"` to `name = "tugtool-python-cst-derive"`
- [x] Update `crates/tugtool-python-cst/Cargo.toml`: change `name = "tugtool-cst"` to `name = "tugtool-python-cst"`
- [x] Update `crates/tugtool-python-cst/Cargo.toml`: update dependency on derive crate
- [x] Update workspace `Cargo.toml`: update member paths
- [x] Update `crates/tugtool-python/Cargo.toml`: update dependency name
- [x] Update all `use tugtool_cst::` → `use tugtool_python_cst::`
- [x] Update all `use tugtool_cst_derive::` → `use tugtool_python_cst_derive::`
- [x] Update CLAUDE.md documentation

**Tests:**
- [x] `cargo build --workspace` succeeds
- [x] `cargo nextest run --workspace` passes

**Checkpoint:**
- [x] All crates build successfully
- [x] All tests pass
- [x] No references to old crate names remain

**Rollback:**
- Revert directory renames and Cargo.toml changes

---

#### Step 0: Audit Current Position Data Availability {#step-0}

**Commit:** `chore(cst): audit token position data availability`

**References:** [D03] InflateCtx introduction, [D04] Embed NodeId, Table T01, (#existing-position-types, #token-refs-in-nodes)

**Note (pitfall):** This phase tracks positions for a **subset** of nodes. During the audit, confirm the plan text stays consistent about “key/tracked nodes” vs “all nodes”, and update wording (especially in **Purpose**) if it still implies full-CST coverage.

**Artifacts:**
- Audit document listing all deflated node types with their TokenRef fields
- List of nodes that need `node_id` field added
- Verification that InflateCtx approach is viable

**Tasks:**
- [x] Grep all `tok: TokenRef` fields and their containing structs
- [x] Document which nodes have direct position access
- [x] Identify all nodes that need `node_id` field (see [D04])
- [x] Verify `#[cst_node]` macro can be extended for `node_id`
- [x] Prototype: Can InflateCtx thread through existing inflate implementations?
- [x] Write findings to `plans/phase-4-position-audit.md`

**Tests:**
- [x] Unit test: Verify Token has start_pos/end_pos with correct values for simple input

**Checkpoint:**
- [x] Audit document exists and is complete
- [x] InflateCtx approach validated

**Rollback:**
- Revert audit document if approach changes

---

#### Step 1: Add tok Field to Name Nodes {#step-1}

**Commit:** `feat(cst): add tok field to DeflatedName for direct position access`

**References:** [D05] Add tok field to DeflatedName

**Purpose:** Enable direct token position access for `Name` nodes, eliminating the need for string-based position searching for the most critical node type (identifiers).

**Note (pitfall):** `Name.tok` will be `Some(tok)` for parser-created nodes but can be `None` for `Default`-constructed nodes. Ensure `record_ident_span` is resilient to `None`, and add a test that parsed `Name` nodes always carry `tok: Some(_)` so identifier spans never silently go missing.

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`
- Modified `crates/tugtool-python-cst/src/parser/grammar.rs`

**Tasks:**
- [x] Add `pub(crate) tok: Option<TokenRef<'a>>` field to `Name` struct in `expression.rs`
- [x] Update `make_name` function in `grammar.rs` to store `tok: Some(tok)`

**Code Changes:**

**File:** `crates/tugtool-python-cst/src/nodes/expression.rs`

Change:
```rust
#[cst_node(ParenthesizedNode, Default)]
pub struct Name<'a> {
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,
}
```

To:
```rust
#[cst_node(ParenthesizedNode, Default)]
pub struct Name<'a> {
    pub value: &'a str,
    pub lpar: Vec<LeftParen<'a>>,
    pub rpar: Vec<RightParen<'a>>,

    pub(crate) tok: Option<TokenRef<'a>>,
}
```

**File:** `crates/tugtool-python-cst/src/parser/grammar.rs`

Change:
```rust
fn make_name<'input, 'a>(tok: TokenRef<'input, 'a>) -> Name<'input, 'a> {
    Name {
        value: tok.string,
        ..Default::default()
    }
}
```

To:
```rust
fn make_name<'input, 'a>(tok: TokenRef<'input, 'a>) -> Name<'input, 'a> {
    Name {
        value: tok.string,
        tok: Some(tok),
        ..Default::default()
    }
}
```

**Tests:**
- [x] `cargo build -p tugtool-python-cst` compiles without errors
- [x] `cargo nextest run -p tugtool-python-cst` passes all tests
- [x] `cargo nextest run --workspace` passes all tests

**Checkpoint:**
- [x] Build succeeds
- [x] All tests pass
- [x] `DeflatedName` has `tok: Option<TokenRef<'r, 'a>>` field (verify via macro expansion)

**Rollback:**
- Revert changes to expression.rs and grammar.rs

---

#### Step 2: Implement InflateCtx and Change Inflate Trait {#step-2}

**Commit:** `feat(cst): introduce InflateCtx and change Inflate trait signature`

**References:** [D03] InflateCtx introduction, (#inflate-ctx-structure, #inflate-trait-signature)

**Artifacts:**
- New `crates/tugtool-python-cst/src/inflate_ctx.rs` module
- Modified `Inflate` trait signature
- Updated all `Inflate` implementations

**Note (pitfall):** This is the highest-blast-radius change in the phase. The trait signature update must land consistently across:
- `tugtool-python-cst-derive` macro output (`#[cst_node]`, `#[derive(Inflate)]`)
- Manual `Inflate` impls in `nodes/` (and any helper modules)
- Blanket impls in `nodes/traits.rs` (`Option<T>`, `Vec<T>`, `Box<T>`)
- All parsing entry points that call `.inflate(...)` (e.g., `parse_module_with_options`, `parse_expression`, `parse_statement`)

**Tasks:**
- [x] Create `inflate_ctx.rs` module with `InflateCtx`, `NodePosition`, and `PositionTable` types
- [x] Change `Inflate` trait signature from `&Config<'a>` to `&mut InflateCtx<'a>`
- [x] **IMPORTANT:** Update blanket impls in `nodes/traits.rs` for `Option<T>`, `Vec<T>`, `Box<T>` - these affect all inflation
- [x] Update `#[cst_node]` macro to generate new signature in derive
- [x] Update all manual `Inflate` implementations (if any)
- [x] Update callers to create `InflateCtx` instead of `Config`
- [x] Export `InflateCtx` from `lib.rs`

**Tests:**
- [x] `cargo build -p tugtool-python-cst` compiles without errors
- [x] `cargo nextest run -p tugtool-python-cst` passes all tests
- [x] Unit test: InflateCtx id generation is sequential
- [x] Unit test: InflateCtx span recording works

**Checkpoint:**
- [x] Build succeeds with new trait signature
- [x] All existing tests pass
- [x] `InflateCtx` is exported and usable

**Rollback:**
- Revert trait signature change and new module

---

#### Step 3: Add node_id to Key Inflated Node Structs {#step-3}

**Commit:** `feat(cst): add node_id field to key inflated node structs`

**References:** [D04] Embed NodeId, (#embedded-nodeid)

**Artifacts:**
- Modified node structs with `node_id: Option<NodeId>` field
- Updated inflate implementations to assign NodeId

**Note (pitfall):** A single missed `node_id: Some(ctx.next_id())` on any tracked node will surface later as a hard-to-debug `unwrap()` panic in collectors. Add a unit test that parses representative code and asserts **all tracked node types encountered** have `node_id.is_some()` (and consider adding debug assertions in their `Inflate` impls).

**Tasks:**
- [x] Add `node_id: Option<NodeId>` to `Name` struct
- [x] Add `node_id: Option<NodeId>` to `FunctionDef` struct
- [x] Add `node_id: Option<NodeId>` to `ClassDef` struct
- [x] Add `node_id: Option<NodeId>` to `Param` struct
- [x] Add `node_id: Option<NodeId>` to `Decorator` struct
- [x] Add `node_id: Option<NodeId>` to `Integer`, `Float`, `SimpleString` structs
- [x] Update each node's `Inflate` implementation to call `ctx.next_id()` and store result
- [x] Ensure `Default` implementations set `node_id: None`

**Tests:**
- [x] `cargo build -p tugtool-python-cst` compiles without errors
- [x] `cargo nextest run -p tugtool-python-cst` passes all tests
- [x] Unit test: Parsed `Name` node has `Some(NodeId)` after inflation
- [x] Unit test: Parsed `FunctionDef` node has `Some(NodeId)` after inflation

**Checkpoint:**
- [x] Build succeeds
- [x] All tests pass
- [x] Inflated nodes have populated `node_id` fields

**Rollback:**
- Revert node struct changes

---

#### Step 4: Implement Direct Scope Span Collection {#step-4}

**Commit:** `feat(cst): implement direct lexical/def span collection in FunctionDef/ClassDef`

**References:** [D06] Scope end boundary, [D07] Def span coverage, [D08] Def extraction semantics, [D10] Direct scope end, (#span-type-definitions)

**Artifacts:**
- `FunctionDef::inflate()` and `ClassDef::inflate()` compute and record all three span types
- No SpanFrame stack needed - spans computed directly from deflated body suite

**Note (pitfall):** Single-line suites use `suite.newline_tok.end_pos` as the end boundary. Add tests for edge cases where the input file **does not end with a trailing newline**, to ensure `newline_tok` still yields a correct end position at EOF and spans remain valid half-open `[start, end)`.

**Note (pitfall):** Decorators are arbitrary expressions (`@a`, `@a.b`, `@a(b)`, etc.). Phase 4 uses decorators only to find `def_span` start (`@` token) and does **not** attempt to define a single “decorator identifier span” for the decorator node itself.

**Key Implementation Pattern:**

```rust
// In FunctionDef::inflate() - compute scope end from OUR body, not from IndentedBlock::inflate()
let scope_end = match &self.body {
    DeflatedSuite::IndentedBlock(block) => block.dedent_tok.start_pos.byte_idx() as u64,
    DeflatedSuite::SimpleStatementSuite(suite) => suite.newline_tok.end_pos.byte_idx() as u64,
};
```

**Tasks:**
- [x] In `FunctionDef::inflate()`:
  - Compute `lexical_start` from `async_tok` or `def_tok`
  - Compute `def_start` from first decorator's `at_tok` (or `lexical_start` if no decorators)
  - Compute `scope_end` directly from `self.body` (deflated suite's dedent/newline token)
  - Call `ctx.record_lexical_span()` and `ctx.record_def_span()`
  - **Note:** Do NOT record ident_span here - it lives on the Name node per [D11]
- [x] In `ClassDef::inflate()`: same pattern as FunctionDef
- [x] In `Name::inflate()`: record `ident_span` from `self.tok` (this is where identifier spans live per [D11])
- [x] Verify that nested scopes (function inside function) each record their own spans correctly
- [x] Verify that IndentedBlock::inflate() does NOT need any scope-related changes

**Tests:**
- [x] Unit test: `FunctionDef` lexical span starts at `def`, not decorator
- [x] Unit test: `FunctionDef` def span starts at first decorator `@`
- [x] Unit test: Undecorated function has `lexical_span.start == def_span.start`
- [x] Unit test: Nested functions have correct non-overlapping spans
- [x] Unit test: Class with decorators has correct def_span
- [x] Unit test: Single-line function (`def f(): pass`) has correct scope_end

**Checkpoint:**
- [x] Build succeeds
- [x] No changes to `IndentedBlock::inflate()` needed
- [x] Span collection integration test passes

**Rollback:**
- Revert `FunctionDef`/`ClassDef` inflate changes

---

#### Step 5: Implement parse_module_with_positions {#step-5}

**Commit:** `feat(cst): add parse_module_with_positions API`

**References:** [D03] InflateCtx, (#new-api-surface)

**Artifacts:**
- `ParsedModule` struct
- `parse_module_with_positions()` function

**Tasks:**
- [x] Implement `ParsedModule` struct
- [x] Implement `parse_module_with_positions()` that:
  - Creates `InflateCtx::with_positions()`
  - Calls existing inflation
  - Returns `ParsedModule` with positions
- [x] Export from `lib.rs`
- [x] Add doc comments and examples

**Tests:**
- [x] Unit test: Basic parsing returns positions
- [x] Unit test: Original `parse_module()` still works unchanged
- [x] Unit test: Positions are accurate for known input
- [x] Unit test: `node_count` matches number of tracked nodes

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes
- [x] Doc tests pass

**Rollback:**
- Revert new API

---

#### Step 6: Update Collectors to Use node.node_id {#step-6}

**Commit:** `refactor(cst): update collectors to use embedded node_id`

**References:** [D04] Embed NodeId, (#strategy)

**Artifacts:**
- Modified `SpanCollector`, `BindingCollector`, `ScopeCollector`, `ReferenceCollector`

**Tasks:**
- [x] Update `SpanCollector` to read `node.node_id.unwrap()` instead of generating IDs
- [x] Update `BindingCollector` to use `node.node_id` (N/A - doesn't use NodeId, uses name-based tracking)
- [x] Update `ScopeCollector` to use `node.node_id` (N/A - uses its own scope_N string IDs)
- [x] Update `ReferenceCollector` to use `node.node_id` (N/A - uses name-based keys in HashMap)
- [x] Remove `NodeIdGenerator` usage from collectors (IDs now come from nodes)

**Invariant:** Collectors only operate on parse-produced trees, so `node.node_id.unwrap()` is safe. Add debug assertions to enforce this.

**Note (pitfall):** If any collector code can be invoked on non-parse-produced CSTs (e.g., tests constructing nodes via `Default`), `unwrap()` will panic. Guard against this by either (a) restricting collector entry points to parse outputs, and/or (b) using explicit assertions with a clear message so failures are actionable.

**Tests:**
- [x] Unit test: Collector produces same NodeIds as embedded on nodes
- [x] Golden test: Compare span output before/after (existing tests verify span accuracy)

**Checkpoint:**
- [x] All collectors use embedded `node_id`
- [x] All tests pass

**Rollback:**
- Revert collector changes

---

#### Step 7: Update SpanCollector to Use PositionTable {#step-7}

**Commit:** `refactor(cst): update SpanCollector to use PositionTable from inflation`

**References:** (#identifier-span, #span-type-definitions)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/span_collector.rs`

**Note:** After this step, `SpanCollector` becomes a thin wrapper around `parse_module_with_positions()` + `PositionTable` access. Consider whether it should be simplified to a direct API in a follow-on cleanup.

**Tasks:**
- [x] Change SpanCollector to accept `PositionTable` from `parse_module_with_positions()`
- [x] Remove `find_and_advance()` from SpanCollector
- [x] Update `SpanCollector::collect()` to use `parse_module_with_positions()`
- [x] Verify all span lookups go through `PositionTable` (using `node.node_id` as key)
- [x] For identifier spans: `positions.get(&node_id).and_then(|p| p.ident_span)`
- [x] For lexical spans: `positions.get(&node_id).and_then(|p| p.lexical_span)`

**Tests:**
- [x] Unit test: Same span results as before for simple cases
- [x] Unit test: Correct spans for repeated identifiers (string search would fail)
- [x] Golden test: Compare span output before/after

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst span` passes
- [x] `grep find_and_advance crates/tugtool-python-cst/src/visitor/span_collector.rs` returns empty

**Rollback:**
- Revert SpanCollector changes

---

#### Step 8: Update BindingCollector to Use PositionTable {#step-8}

**Commit:** `refactor(cst): update BindingCollector to use PositionTable`

**References:** (#identifier-span)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/binding.rs`

**Tasks:**
- [x] Change BindingCollector to accept `PositionTable`
- [x] Remove `find_and_advance()` from BindingCollector
- [x] Update binding span assignment to use `PositionTable` lookup via `node.node_id`
- [x] Verify all bindings have correct spans from `NodePosition.ident_span`

**Tests:**
- [x] Unit test: Binding spans match token positions
- [x] Unit test: Multiple bindings with same name have distinct correct spans

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst binding` passes
- [x] `grep find_and_advance crates/tugtool-python-cst/src/visitor/binding.rs` returns empty

**Rollback:**
- Revert BindingCollector changes

---

#### Step 9: Update ScopeCollector to Use PositionTable {#step-9}

**Commit:** `refactor(cst): update ScopeCollector to use PositionTable for lexical spans`

**References:** (#lexical-span, Table T02, [D06] Scope end boundary)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/scope.rs`

**Tasks:**
- [x] Change ScopeCollector to accept `PositionTable`
- [x] Remove `find_and_advance()` from ScopeCollector
- [x] Use `NodePosition.lexical_span` from `PositionTable` for scope spans
- [x] Verify decorated functions have correct lexical spans (excluding decorators)

**Tests:**
- [x] Unit test: Function lexical span starts at `def`, not decorator
- [x] Unit test: Class lexical span starts at `class`
- [x] Unit test: Module scope spans entire file
- [x] Unit test: Nested scopes have correct containment

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst scope` passes
- [x] `grep find_and_advance crates/tugtool-python-cst/src/visitor/scope.rs` returns empty

**Rollback:**
- Revert ScopeCollector changes

---

#### Step 10: Update ReferenceCollector (if applicable) {#step-10}

**Commit:** `refactor(cst): update ReferenceCollector to use PositionTable`

**References:** (#identifier-span)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/reference.rs` (if exists)

**Tasks:**
- [x] Check if ReferenceCollector uses `find_and_advance()`
- [x] If so, update to use `PositionTable` with `node.node_id` lookup
- [x] Remove string search code

**Tests:**
- [x] Unit test: Reference spans are accurate

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst reference` passes

**Rollback:**
- Revert ReferenceCollector changes

---

#### Step 11: Update tugtool-python Integration {#step-11}

**Commit:** `refactor(python): update cst_bridge to use position-aware parsing`

**References:** (#implementation-architecture)

**Artifacts:**
- Modified `crates/tugtool-python/src/cst_bridge.rs`

**Tasks:**
- [x] Update cst_bridge to use `parse_module_with_positions()`
- [x] Pass `PositionTable` to collectors
- [x] Update collectors to access spans via `node.node_id` + `PositionTable` lookup
- [x] Verify all downstream code receives accurate positions

**Tests:**
- [x] Integration test: End-to-end rename with accurate spans
- [x] Integration test: Scope containment queries work correctly

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python` passes
- [x] Golden tests pass

**Rollback:**
- Revert cst_bridge changes

---

#### Step 12: Remove All String Search Code {#step-12}

**Commit:** `refactor(cst): remove deprecated find_and_advance infrastructure`

**References:** (#strategy)

**Artifacts:**
- Removed `find_and_advance()` implementations from all collectors
- Removed `cursor` fields from collectors

**Tasks:**
- [x] Search for remaining `find_and_advance` calls
- [x] Remove cursor fields from collector structs
- [x] Clean up any dead code
- [x] Update documentation

**Tests:**
- [x] All existing tests pass
- [x] `grep -r find_and_advance crates/tugtool-python-cst/src/visitor/` returns empty

**Checkpoint:**
- [x] `cargo nextest run --workspace` passes (1088 tests)
- [x] No string search code remains in collectors

**Rollback:**
- N/A (cleanup only)

---

#### Step 13: Performance Validation {#step-13}

**Commit:** `test(cst): add performance benchmarks for position extraction`

**References:** (#success-criteria)

**Artifacts:**
- Benchmark results comparing old vs new approach

**Tasks:**
- [x] Run existing parser benchmarks before and after
- [x] Measure: parse time, memory usage
- [x] Document any regressions or improvements

**Tests:**
- [x] Benchmark: `cargo bench -p tugtool-python-cst`

**Checkpoint:**
- [x] No >10% regression in parse time (actually ~0% difference)
- [x] Results documented in `plans/phase-4-benchmarks.md`

**Rollback:**
- If regression detected, profile and optimize before proceeding

---

### 4.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Accurate token-based position infrastructure with embedded NodeId replacing all string search span computation.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [x] `InflateCtx` replaces `&Config` in `Inflate` trait
- [x] Key inflated nodes have embedded `node_id: Option<NodeId>` field
- [x] `parse_module_with_positions()` API exists and is documented
- [x] All collectors use `PositionTable` and embedded NodeId, not string search
- [x] `grep -r find_and_advance crates/tugtool-python-cst/src/visitor/` returns empty
- [x] All golden tests pass with identical or improved output
- [x] Performance benchmarks show no regression >10%
- [x] Documentation updated in CLAUDE.md

**Acceptance tests:**
- [x] Integration test: Rename operation produces correct diffs for complex code
- [x] Golden test: Span output matches expected for fixture files
- [x] Unit test: Repeated identifiers get distinct, correct spans
- [x] Unit test: Inflated nodes have populated `node_id` after parsing

#### Milestones (Within Phase) {#milestones}

**Milestone M01: InflateCtx Infrastructure Available** {#m01-inflate-ctx}
- [x] `InflateCtx` implemented and `Inflate` trait signature changed
- [x] Build succeeds with new architecture

**Milestone M02: Embedded NodeId Working** {#m02-embedded-nodeid}
- [x] Key nodes have `node_id` field
- [x] `parse_module_with_positions()` returns nodes with populated IDs

**Milestone M03: All Collectors Updated** {#m03-collectors-updated}
- [x] SpanCollector, BindingCollector, ScopeCollector, ReferenceCollector all use `PositionTable`
- [x] No string search in any collector

**Milestone M04: Integration Complete** {#m04-integration-complete}
- [x] tugtool-python uses new infrastructure
- [x] All tests pass

| Checkpoint | Verification |
|------------|--------------|
| InflateCtx works | `InflateCtx::with_positions()` creates valid context |
| NodeId embedded | `parse_module_with_positions("def f(): pass", None)` returns node with `Some(NodeId)` |
| Position API works | `parse_module_with_positions("x = 1", None)` returns valid positions |
| No string search | `grep -r find_and_advance crates/tugtool-python-cst/src/visitor/` returns empty |
| Tests pass | `cargo nextest run --workspace` succeeds |
| Benchmarks pass | No >10% regression documented |

**Commit after all checkpoints pass.**

### 4.7 Cleanup After-Work {#cleanup-after-work}

#### Step 14: Remove Legacy Collector APIs That Re-Parse {#step-14}

**Commit:** `refactor(cst): remove legacy collector collect(module, source) APIs`

**References:** (#strategy), [D11] Ident Span Lives on Name Node Only

**Purpose:** Remove the legacy `collect(module, source)` APIs from all collectors. These APIs are dangerous because they silently re-parse the source internally using `parse_module_with_positions()`, which means:

1. The `Module` argument is **ignored** - creating a false sense of using a consistent parse
2. Callers can accidentally mix a `Module` from one parse with `NodeId`/spans from the internal re-parse
3. This creates subtle, hard-to-debug mismatches between CST nodes and position data

The new position-aware APIs (`collect_with_positions`, `from_positions`) provide a single source of truth by accepting both the `Module` and its corresponding `PositionTable` from the same parse.

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/span_collector.rs`
- Modified `crates/tugtool-python-cst/src/visitor/binding.rs`
- Modified `crates/tugtool-python-cst/src/visitor/scope.rs`
- Modified `crates/tugtool-python-cst/src/visitor/reference.rs`
- Modified tests in all four files

**Tasks:**
- [x] Remove `SpanCollector::collect(module, source)` method
- [x] Remove `BindingCollector::collect(module, source)` method
- [x] Remove `ScopeCollector::collect(module, source)` method
- [x] Remove `ReferenceCollector::collect(module, source)` method
- [x] Update tests in span_collector.rs to use `parse_module_with_positions` + `from_positions`
- [x] Update tests in binding.rs to use `parse_module_with_positions` + `collect_with_positions`
- [x] Update tests in scope.rs to use `parse_module_with_positions` + `collect_with_positions`
- [x] Update tests in reference.rs to use `parse_module_with_positions` + `collect_with_positions`
- [x] Remove doc comments mentioning "legacy compatibility" from the deleted methods
- [x] Update module-level doc examples in each file to show only the position-aware API
- [x] Verify no external callers remain (tugtool-python already uses position-aware APIs)

**Test Migration Example:**

Before:
```rust
#[test]
fn test_span_collector_basic() {
    let source = "x = 1";
    let module = parse_module(source, None).expect("parse error");
    let span_table = SpanCollector::collect(&module, source);
    assert!(!span_table.is_empty());
}
```

After:
```rust
#[test]
fn test_span_collector_basic() {
    let source = "x = 1";
    let parsed = parse_module_with_positions(source, None).expect("parse error");
    let span_table = SpanCollector::from_positions(&parsed.positions);
    assert!(!span_table.is_empty());
}
```

**Tests:**
- [x] `cargo nextest run -p tugtool-python-cst span_collector` passes
- [x] `cargo nextest run -p tugtool-python-cst binding` passes
- [x] `cargo nextest run -p tugtool-python-cst scope` passes
- [x] `cargo nextest run -p tugtool-python-cst reference` passes
- [x] `cargo nextest run --workspace` passes (all tests) - 1084 tests pass

**Checkpoint:**
- [x] No legacy APIs remain in the four targeted collectors (SpanCollector, BindingCollector, ScopeCollector, ReferenceCollector)
- [x] All migrated tests pass
- [x] No compilation errors from external crates

**Rollback:**
- Revert the four collector file changes
- Tests are independent per file, so partial rollback is possible if one collector has issues

---

#### Step 14b: Complete Collector API Cleanup and Rename {#step-14b}

**Commit:** `refactor(cst): rename collect_with_positions to collect`

**Purpose:** Complete the API cleanup by:
1. Removing legacy `collect(module, source)` from remaining collectors
2. Renaming `collect_with_positions` → `collect` across all collectors for a cleaner API

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/import.rs`
- Modified `crates/tugtool-python-cst/src/visitor/annotation.rs`
- Modified `crates/tugtool-python-cst/src/visitor/type_inference.rs`
- Modified `crates/tugtool-python-cst/src/visitor/method_call.rs`
- Modified `crates/tugtool-python-cst/src/visitor/inheritance.rs`
- Modified `crates/tugtool-python-cst/src/visitor/dynamic.rs`
- Modified all collector files: rename `collect_with_positions` → `collect`
- Modified `crates/tugtool-python-cst/tests/golden.rs`
- Modified `crates/tugtool-python/src/cst_bridge.rs`

**Tasks:**
- [x] Remove `ImportCollector::collect(module, source)` method (simplified to `collect(module)`)
- [x] Remove `AnnotationCollector::collect(module, source)` method
- [x] Remove `TypeInferenceCollector::collect(module, source)` method
- [x] Remove `MethodCallCollector::collect(module, source)` method
- [x] Remove `InheritanceCollector::collect(module, source)` method
- [x] Remove `DynamicPatternDetector::collect(module, source)` method
- [x] Rename `collect_with_positions` → `collect` in SpanCollector (kept `from_positions`)
- [x] Rename `collect_with_positions` → `collect` in BindingCollector
- [x] Rename `collect_with_positions` → `collect` in ScopeCollector
- [x] Rename `collect_with_positions` → `collect` in ReferenceCollector
- [x] ImportCollector has no positions, signature simplified to `collect(module)`
- [x] Rename `collect_with_positions` → `collect` in AnnotationCollector
- [x] Rename `collect_with_positions` → `collect` in TypeInferenceCollector
- [x] Rename `collect_with_positions` → `collect` in MethodCallCollector
- [x] Rename `collect_with_positions` → `collect` in InheritanceCollector
- [x] Rename `collect_with_positions` → `collect` in DynamicPatternDetector
- [x] Update golden.rs to use new `collect()` API
- [x] Update cst_bridge.rs to use new `collect()` API
- [x] Update all tests

**Tests:**
- [x] `cargo nextest run --workspace` passes - 1084 tests pass

**Checkpoint:**
- [x] `grep -r "collect_with_positions" crates/tugtool-python-cst/` returns empty
- [x] `grep -r "pub fn collect.*module.*source" crates/tugtool-python-cst/src/visitor/` returns empty
- [x] All tests pass

---

### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

**Variable/Import Statement-Level Spans (Follow-on):**
- [ ] Variable "full statement spans" (e.g., `x = 1` entire line as def_span)
- [ ] Import "full statement spans" (e.g., `from foo import bar, baz` entire line)
- [ ] Covers extracting/moving entire statements

**Parameter Full Spans (Follow-on):**
- [ ] Tuple unpacking: `def f((a, b)): ...` - span for entire `(a, b)`
- [ ] Chained assignment: `a = b = 1` - multiple bindings from one statement
- [ ] `with ... as x`: binding in context manager statement
- [ ] `except E as e`: exception binding in except clause
- [ ] Multi-import lines: `import a, b, c` - statement-level spans

**Line/Col Output Enrichment (Follow-on):**
- [ ] Compute line/col at presentation boundaries when needed
- [ ] Add optional line/col to CLI/JSON output
- [ ] LSP-style position output

**Scope Tracking Expansion (Follow-on):**
- [ ] Lambda scope tracking - `lambda_tok` to end of lambda expression
- [ ] Comprehension scope tracking - opening bracket to closing bracket
- [ ] Module-level scope in `PositionTable` (currently synthesizable, but could be explicit)

**Literal Span Recording (Follow-on):**
- [ ] Record `ident_span` for `Integer`, `Float`, `SimpleString` nodes
- [ ] Enable string literal renaming, constant extraction use cases

**Other Follow-ons:**
- [ ] Expose def_span in output schemas for "complete definition" extraction
- [ ] Add position data to more node types (all expressions, all statements)
- [ ] Consider caching parsed modules with positions for repeated analysis
- [ ] Evaluate whether inflation should always capture positions (no separate API)
- [ ] **PositionTable optimization:** Replace `HashMap<NodeId, NodePosition>` with `Vec<Option<NodePosition>>` indexed by `NodeId.0` (faster, simpler since IDs are sequential)

