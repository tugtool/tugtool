# Body Spans Analysis and Implementation Plan

**Purpose:** Analyze and plan the addition of "body spans" to tugtool's symbol infrastructure to support future AI-driven Python refactoring operations beyond rename.

**Created:** 2026-01-19

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state)
3. [Body Span Semantics](#body-span-semantics)
4. [Relationship to Issue 4 (Scope Spans)](#relationship-to-issue-4)
5. [Use Case Analysis](#use-case-analysis)
6. [Design Decisions](#design-decisions)
7. [Implementation Plan (Issue 5)](#issue-5-body-spans)

---

## Executive Summary {#executive-summary}

Tugtool currently tracks **name-only spans** for symbols (e.g., just "foo" in `def foo():`). This is sufficient for rename operations but insufficient for future AI-driven refactoring operations that need to:

1. Extract/copy/move entire function or class bodies
2. Query containment relationships ("what's inside this class?")
3. Replace function implementations while preserving signatures
4. Inline function bodies at call sites

This document proposes adding **body spans** as a new field on `Symbol`, distinct from but complementary to the existing scope span infrastructure described in Issue 4.

**Key insight:** Body spans and scope spans serve different purposes:
- **Scope spans** (Issue 4): Enable scope containment queries ("which scope is this reference in?")
- **Body spans** (this proposal): Enable code extraction ("give me the code for this function")

Both are needed. This document focuses on body spans.

---

## Current State Analysis {#current-state}

### Symbol Structure (tugtool-core/src/facts/mod.rs)

```rust
pub struct Symbol {
    pub symbol_id: SymbolId,
    pub kind: SymbolKind,
    pub name: String,
    pub decl_file_id: FileId,
    pub decl_span: Span,  // Currently: name-only span
    pub container_symbol_id: Option<SymbolId>,
    pub module_id: Option<ModuleId>,
}
```

The `decl_span` field currently stores **name-only spans**:
- For `def foo():`, `decl_span` covers bytes for "foo" only
- For `class Bar:`, `decl_span` covers bytes for "Bar" only

### CST Node Structure

The CST nodes have rich body information available:

```rust
// FunctionDef in crates/tugtool-cst/src/nodes/statement.rs
pub struct FunctionDef<'a> {
    pub name: Name<'a>,
    pub params: Parameters<'a>,
    pub body: Suite<'a>,         // <-- Body is here
    pub decorators: Vec<Decorator<'a>>,
    pub returns: Option<Annotation<'a>>,
    // ... whitespace fields
    pub(crate) def_tok: TokenRef<'a>,  // <-- Start marker
    pub(crate) colon_tok: TokenRef<'a>,
}

// ClassDef similarly has:
pub struct ClassDef<'a> {
    pub name: Name<'a>,
    pub body: Suite<'a>,         // <-- Body is here
    pub bases: Vec<Arg<'a>>,
    // ... other fields
    pub(crate) class_tok: TokenRef<'a>,  // <-- Start marker
    pub(crate) colon_tok: TokenRef<'a>,
}

// Suite (the body type):
pub enum Suite<'a> {
    IndentedBlock(IndentedBlock<'a>),
    SimpleStatementSuite(SimpleStatementSuite<'a>),
}
```

### What Span Information is Collectible

From the CST, we can compute:

1. **Name span**: Already collected (start of identifier to end)
2. **Declaration span**: From first decorator/keyword to end of body
3. **Body-only span**: From colon to end of body (the Suite)
4. **Signature span**: From keyword to colon (excludes body)

### Current Collection (BindingCollector)

`crates/tugtool-cst/src/visitor/binding.rs` collects bindings with name-only spans:

```rust
fn add_binding(&mut self, name: &str, kind: BindingKind) {
    let span = self.find_and_advance(name);  // Just finds the name string
    let binding = BindingInfo::new(name.to_string(), kind, self.scope_path.clone())
        .with_span(span);
    self.bindings.push(binding);
}
```

---

## Body Span Semantics {#body-span-semantics}

### What is a "Body Span"?

A **body span** is the source range that contains the complete, extractable code for a symbol. The exact semantics differ by symbol kind:

| Symbol Kind | Body Span Meaning | Example |
|-------------|------------------|---------|
| `Function` | Entire function from decorators through body | `@decorator\ndef foo():\n    pass` |
| `Method` | Same as function (methods are functions) | `def bar(self):\n    return 1` |
| `Class` | Entire class from decorators through body | `class Foo:\n    x = 1` |
| `Variable` | The full assignment statement | `x = some_value` |
| `Parameter` | Just the parameter (may have default) | `x: int = 5` |
| `Import` | The import statement | `from os import path` |
| `Lambda` | The lambda expression | `lambda x: x + 1` |

### Span Boundary Decisions

For each symbol kind, we need to decide what boundaries to use:

**Functions/Methods:**
```python
@decorator           # <-- Include decorators? YES
async def foo(       # <-- Start of signature
    x: int,
    y: str
) -> bool:           # <-- End of signature, start of body
    """Docstring"""
    return True      # <-- End of body
```

**Decision:** Body span for functions includes decorators (if present) through end of body.
- Start: First decorator's `@` OR `def`/`async def` keyword
- End: Last byte of the function body

**Rationale:** When extracting or moving a function, you want the complete definition including decorators.

**Classes:**
```python
@dataclass           # <-- Include decorators? YES
class Foo(Base):     # <-- Start (or @dataclass if present)
    x: int = 1

    def method(self):
        pass         # <-- End of body
```

**Decision:** Body span for classes includes decorators through end of body.

**Variables:**
```python
x = 1                # Simple: whole statement
x: int = 1           # Annotated: whole statement
x = y = z = 1        # Chained: whole statement (all targets)
a, b = 1, 2          # Tuple unpacking: whole statement
```

**Decision:** For variables, the body span is the entire assignment statement.

**Parameters:**
```python
def foo(
    x,               # Just "x"
    y: int,          # "y: int"
    z: int = 5,      # "z: int = 5"
    *args,           # "*args"
    **kwargs         # "**kwargs"
):
```

**Decision:** Parameter body span covers the full parameter including annotation and default.

---

## Relationship to Issue 4 (Scope Spans) {#relationship-to-issue-4}

### Issue 4: Scope Spans

From `plans/phase-3.md:3268`:

> **Problem:** Scopes are inserted into the FactsStore with placeholder `Span::new(0, 0)` values instead of actual scope spans.

Issue 4 addresses `ScopeInfo.span` which answers: "What range of code is lexically inside this scope?"

### Key Differences

| Aspect | Scope Spans (Issue 4) | Body Spans (This Proposal) |
|--------|----------------------|---------------------------|
| **Entity** | `ScopeInfo` | `Symbol` |
| **Purpose** | Containment queries | Code extraction |
| **Question answered** | "Is this reference inside that scope?" | "What is the complete code for this symbol?" |
| **Use cases** | Variable resolution, scope filtering | Extract function, move method, inline |

### Are They the Same?

**No.** They are related but distinct:

1. **Scope spans** apply to all scopes (module, function, class, lambda, comprehension)
2. **Body spans** apply to all symbols (function, class, variable, parameter, import)
3. Scopes and symbols are different entities with different lifecycles

However, for `Function` and `Class` symbols, the body span will often overlap significantly with the corresponding scope span. The differences:

- **Body span** includes decorators; scope span does not
- **Scope span** starts after the colon; body span starts at first decorator or keyword
- **Scope span** exists for comprehensions and lambdas which may not be tracked as symbols

### Implementation Independence

These should be implemented independently:
- Issue 4 updates `ScopeCollector` to compute scope spans
- This proposal adds `body_span` to `Symbol` and updates `BindingCollector`

They can share span computation utilities but are logically separate.

---

## Use Case Analysis {#use-case-analysis}

### Use Case 1: Extract Function Body

**AI Agent Request:** "Extract the body of function `calculate_total` to inline it elsewhere"

**Current capability:** Cannot do. We only have the name span for "calculate_total".

**With body spans:**
```python
# Given this code
def calculate_total(items):
    total = 0
    for item in items:
        total += item.price
    return total

# AI agent can:
# 1. Find symbol "calculate_total"
# 2. Get body_span to slice source: entire function
# 3. Extract and manipulate the code
```

### Use Case 2: Move Method to Another Class

**AI Agent Request:** "Move method `Foo.bar` to class `Baz`"

**Required spans:**
1. Body span of method `bar` (to extract complete method)
2. Body span of class `Baz` (to find insertion point)

**Current capability:** Cannot get complete method code or find class body end.

### Use Case 3: Replace Function Implementation

**AI Agent Request:** "Replace the body of function `validate` with a new implementation"

**Required information:**
1. Signature span (to preserve: `def validate(data: dict) -> bool:`)
2. Body-only span (to replace: everything after the colon)

**Design consideration:** Do we need separate `signature_span` and `body_only_span`?

**Recommendation:** For v1, provide full `body_span`. Deriving body-only span requires:
- Finding the colon position (stored in `colon_tok`)
- Adjusting for indentation

This can be computed from `body_span` + parsing knowledge if needed.

### Use Case 4: Containment Queries

**AI Agent Request:** "What symbols are defined inside class `Configuration`?"

**With body spans:**
1. Get body span of `Configuration` class
2. Query all symbols where `decl_span.start >= config_body_span.start && decl_span.start < config_body_span.end`

**Alternative (using container_symbol_id):** This already works via `container_symbol_id` relationship:
```rust
// Already supported:
symbols.iter().filter(|s| s.container_symbol_id == Some(config_symbol_id))
```

**Recommendation:** Containment via `container_symbol_id` is preferred. Body spans enable positional containment queries for edge cases.

### Use Case 5: Get Complete Symbol Code

**AI Agent Request:** "Show me the code for function `process_data`"

**With body spans:**
```rust
let symbol = store.symbols_by_name("process_data").first()?;
let file = store.file(symbol.decl_file_id)?;
let code = &source[symbol.body_span.start as usize..symbol.body_span.end as usize];
```

This is the simplest, most common use case for body spans.

### Use Case 6: Inline Function

**AI Agent Request:** "Inline function `helper` at all call sites"

**Required:**
1. Body span of `helper` (to get the implementation)
2. All call references to `helper` (already supported)
3. Parameter mapping (requires more than just spans)

Body spans are necessary but not sufficient for full inlining.

---

## Design Decisions {#design-decisions}

### [D01] Add body_span Field to Symbol (PROPOSED) {#d01-body-span-field}

**Decision:** Add `body_span: Option<Span>` to the `Symbol` struct.

**Rationale:**
- Body spans are only meaningful for certain symbol kinds (function, class, variable)
- Parameters and imports may have minimal or no body
- `Option<Span>` allows graceful handling of edge cases

**Alternative considered:** Separate `SymbolSpans` struct with multiple span fields.

**Rejected because:** Over-engineering for current needs. Can expand later if needed.

**Implication:**
```rust
pub struct Symbol {
    pub symbol_id: SymbolId,
    pub kind: SymbolKind,
    pub name: String,
    pub decl_file_id: FileId,
    pub decl_span: Span,      // Name-only (unchanged)
    pub body_span: Option<Span>,  // NEW: Full declaration span
    pub container_symbol_id: Option<SymbolId>,
    pub module_id: Option<ModuleId>,
}
```

### [D02] Collect Body Spans in BindingCollector (PROPOSED) {#d02-binding-collector}

**Decision:** Extend `BindingCollector` to compute and store body spans alongside name spans.

**Rationale:**
- `BindingCollector` already traverses all binding sites
- Adding body span computation is incremental to existing logic
- Keeps span collection centralized

**Alternative considered:** New `BodySpanCollector` visitor.

**Rejected because:** Unnecessary complexity; spans are logically part of binding info.

### [D03] Span Computation Strategy (PROPOSED) {#d03-span-computation}

**Decision:** Compute body spans during CST traversal using token references and codegen state.

**Strategy for functions:**
1. Track the starting token (`def_tok` or first decorator's `@` token)
2. After visiting all children, compute end position from last token of body
3. Create span from start to end

**Challenge:** The CST nodes don't store end positions directly.

**Solution approaches:**
1. **Approach A:** Use codegen to render the subtree and count bytes (expensive)
2. **Approach B:** Track cursor position during traversal (current approach in collectors)
3. **Approach C:** Add span fields to CST nodes during inflate (invasive change)

**Recommended:** Approach B with enhancements. The cursor-based approach is already used in `BindingCollector` and `SpanCollector`. Extend it to track body extent.

### [D04] Body Span for Variables (PROPOSED) {#d04-variable-spans}

**Decision:** For variable bindings, body span covers the entire assignment statement.

**Rationale:**
- Variables don't have "bodies" in the function/class sense
- The meaningful unit is the assignment statement
- For `x = y = z = 1`, include all targets

**Edge cases:**
- Tuple unpacking: `a, b = 1, 2` - span covers entire statement
- Walrus operator: `if (x := 5)` - span covers just the `:=` expression
- Annotated assignment without value: `x: int` - span covers the annotation

### [D05] API for Body Span Access (PROPOSED) {#d05-api}

**Decision:** Provide both direct field access and helper methods.

```rust
impl Symbol {
    /// Get the body span if available.
    pub fn body_span(&self) -> Option<&Span> {
        self.body_span.as_ref()
    }

    /// Extract the body source code from file content.
    pub fn extract_body<'a>(&self, source: &'a str) -> Option<&'a str> {
        self.body_span.as_ref().map(|span| {
            &source[span.start as usize..span.end as usize]
        })
    }
}

impl FactsStore {
    /// Get symbols fully contained within a span.
    pub fn symbols_in_span(&self, file_id: FileId, span: Span) -> Vec<&Symbol> {
        self.symbols_by_file(file_id)
            .into_iter()
            .filter(|s| s.body_span.map_or(false, |bs|
                bs.start >= span.start && bs.end <= span.end))
            .collect()
    }
}
```

---

## Implementation Plan (Issue 5) {#issue-5-body-spans}

### Issue 5: Add Body Spans to Symbol Infrastructure {#issue-5}

**Priority:** P1 (enables future refactoring operations)

**Depends on:** Issue 4 (scope spans) should be resolved first as it establishes span computation patterns.

**Problem:** Symbols only have name-only spans (`decl_span`), which is insufficient for:
- Extracting complete function/class code
- Moving methods between classes
- Inlining function bodies
- Replacing implementations

**Root Cause:** `BindingCollector` only computes name spans, not full declaration spans.

---

#### Step 5.1: Extend Symbol Struct {#step-5-1}

**Commit:** `feat(core): add body_span field to Symbol`

**Artifacts:**
- Updated `crates/tugtool-core/src/facts/mod.rs`

**Tasks:**
- [ ] Add `body_span: Option<Span>` field to `Symbol` struct
- [ ] Add `with_body_span(span: Span) -> Self` builder method
- [ ] Update `Symbol::new()` to initialize `body_span: None`
- [ ] Add `body_span()` accessor method
- [ ] Add `extract_body()` helper method
- [ ] Update serialization derives

**Tests:**
- [ ] Unit: Symbol creation with body span
- [ ] Unit: Symbol serialization includes body_span
- [ ] Unit: `extract_body()` returns correct substring

**Checkpoint:**
- [ ] `cargo build -p tugtool-core` succeeds
- [ ] `cargo test -p tugtool-core` passes
- [ ] Existing code compiles (body_span is Option, backward compatible)

---

#### Step 5.2: Extend BindingInfo in tugtool-cst {#step-5-2}

**Commit:** `feat(cst): add body_span to BindingInfo`

**Artifacts:**
- Updated `crates/tugtool-cst/src/visitor/binding.rs`

**Tasks:**
- [ ] Add `body_span: Option<Span>` field to `BindingInfo` struct
- [ ] Update `BindingInfo::new()` to initialize `body_span: None`
- [ ] Add `with_body_span(span: Span) -> Self` builder method

**Tests:**
- [ ] Unit: BindingInfo creation with body span

**Checkpoint:**
- [ ] `cargo build -p tugtool-cst` succeeds
- [ ] `cargo test -p tugtool-cst` passes

---

#### Step 5.3: Implement Body Span Collection for Functions {#step-5-3}

**Commit:** `feat(cst): collect body spans for function definitions`

**Artifacts:**
- Updated `crates/tugtool-cst/src/visitor/binding.rs`

**Tasks:**
- [ ] Track function start position (first decorator or `def` keyword)
- [ ] Track function end position (after body traversal)
- [ ] Compute body span for function bindings
- [ ] Handle `async def` functions
- [ ] Handle decorated functions (include decorator in span)

**Implementation approach:**
```rust
fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
    // Find start: first decorator or "def"/"async def"
    let start_pos = if !node.decorators.is_empty() {
        self.find_decorator_start(&node.decorators[0])
    } else if node.asynchronous.is_some() {
        self.find_and_advance("async").map(|s| s.start)
    } else {
        self.find_and_advance("def").map(|s| s.start)
    };

    // Record name span (existing logic)
    self.add_binding(node.name.value, BindingKind::Function);

    // We'll compute end after visiting children...
    // Store start for later use
    self.pending_body_start.push(start_pos);

    // ... enter scope, continue traversal
}

fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
    // Compute body span using current cursor as end
    let start = self.pending_body_start.pop();
    if let (Some(start), Some(binding)) = (start, self.bindings.last_mut()) {
        let end = self.cursor as u64;
        binding.body_span = Some(Span::new(start, end));
    }

    self.scope_path.pop();
}
```

**Tests:**
- [ ] Unit: Simple function has correct body span
- [ ] Unit: Async function includes `async` in span
- [ ] Unit: Decorated function includes decorators
- [ ] Unit: Nested function has independent body span

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst body_span` passes
- [ ] Function body spans are byte-accurate

---

#### Step 5.4: Implement Body Span Collection for Classes {#step-5-4}

**Commit:** `feat(cst): collect body spans for class definitions`

**Artifacts:**
- Updated `crates/tugtool-cst/src/visitor/binding.rs`

**Tasks:**
- [ ] Track class start position (first decorator or `class` keyword)
- [ ] Track class end position (after body traversal)
- [ ] Compute body span for class bindings
- [ ] Handle decorated classes

**Tests:**
- [ ] Unit: Simple class has correct body span
- [ ] Unit: Decorated class includes decorators
- [ ] Unit: Class with base classes has correct span
- [ ] Unit: Nested class has independent body span

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst class_body_span` passes

---

#### Step 5.5: Implement Body Span Collection for Variables {#step-5-5}

**Commit:** `feat(cst): collect body spans for variable assignments`

**Artifacts:**
- Updated `crates/tugtool-cst/src/visitor/binding.rs`

**Tasks:**
- [ ] Track assignment statement boundaries
- [ ] Compute body span covering entire statement
- [ ] Handle tuple unpacking (all targets share same body span)
- [ ] Handle chained assignment (`x = y = 1`)
- [ ] Handle annotated assignment (`x: int = 1`)
- [ ] Handle for loop targets

**Tests:**
- [ ] Unit: Simple assignment `x = 1`
- [ ] Unit: Tuple unpacking `a, b = 1, 2`
- [ ] Unit: Chained assignment `x = y = 1`
- [ ] Unit: Annotated assignment `x: int = 1`
- [ ] Unit: For loop variable

**Checkpoint:**
- [ ] `cargo test -p tugtool-cst variable_body_span` passes

---

#### Step 5.6: Integrate Body Spans into FactsStore {#step-5-6}

**Commit:** `feat(python): populate Symbol.body_span from BindingInfo`

**Artifacts:**
- Updated `crates/tugtool-python/src/analyzer.rs`
- Updated `crates/tugtool-python/src/cst_bridge.rs`

**Tasks:**
- [ ] Update `NativeSymbol` type to include body_span
- [ ] Update `to_facts_symbol()` conversion to pass body_span
- [ ] Update `analyze_files()` to set body_span on inserted symbols

**Tests:**
- [ ] Unit: FactsStore symbols have body_span populated
- [ ] Integration: End-to-end body span availability

**Checkpoint:**
- [ ] `cargo test -p tugtool-python body_span` passes
- [ ] `cargo nextest run --workspace` passes

---

#### Step 5.7: Add API Helpers and Documentation {#step-5-7}

**Commit:** `feat(core): add body span helper methods`

**Artifacts:**
- Updated `crates/tugtool-core/src/facts/mod.rs`

**Tasks:**
- [ ] Add `FactsStore::symbols_in_span()` method
- [ ] Add `Symbol::extract_body()` helper
- [ ] Add rustdoc documentation for body span semantics
- [ ] Document span meaning for each symbol kind

**Tests:**
- [ ] Unit: `symbols_in_span()` returns correct symbols
- [ ] Unit: `extract_body()` returns correct source slice

**Checkpoint:**
- [ ] `cargo doc -p tugtool-core` generates documentation
- [ ] API helpers work correctly

---

#### Step 5.8: Golden Tests for Body Spans {#step-5-8}

**Commit:** `test(cst): add golden tests for body span collection`

**Artifacts:**
- New golden test fixtures in `crates/tugtool-cst/tests/fixtures/`
- Golden output files for body span validation

**Tasks:**
- [ ] Create fixture: functions with decorators
- [ ] Create fixture: nested classes and methods
- [ ] Create fixture: various assignment forms
- [ ] Create fixture: complex scoping scenarios
- [ ] Generate and verify golden output

**Tests:**
- [ ] Golden: Body spans match expected values

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-cst body_span_golden` passes
- [ ] Golden files committed

---

### Issue 5 Summary {#issue-5-summary}

After completing Issue 5 (Steps 5.1-5.8), tugtool will have:

1. **Extended Symbol struct** with `body_span: Option<Span>`
2. **BindingCollector** that computes body spans for functions, classes, and variables
3. **FactsStore** populated with body span information
4. **API helpers** for extracting code and querying containment
5. **Comprehensive tests** validating span accuracy

**Success Criteria:**
- [ ] All existing tests pass (no regressions)
- [ ] Body spans are accurate to the byte for all symbol kinds
- [ ] `extract_body()` returns complete, extractable code
- [ ] API is documented with clear semantics per symbol kind

**Effort Estimate:** Medium (3-5 days)

**Risk:** Low - additive feature, no breaking changes

---

## Appendix: Relationship Summary

| Entity | Span Field | Purpose | Collected By |
|--------|-----------|---------|--------------|
| Symbol | `decl_span` | Name-only span for rename | `BindingCollector` (existing) |
| Symbol | `body_span` | Full declaration for extraction | `BindingCollector` (proposed) |
| ScopeInfo | `span` | Scope extent for containment | `ScopeCollector` (Issue 4) |
| Reference | `span` | Reference site for rename | `ReferenceCollector` (existing) |

---

## Appendix: Sample Body Span Outputs

```python
# Source file: example.py
@decorator
def foo(x: int) -> bool:
    return x > 0

class Bar:
    value: int = 0

    def method(self):
        pass

x = 1
a, b = 1, 2
```

Expected body spans:

| Symbol | Kind | Name Span | Body Span |
|--------|------|-----------|-----------|
| `foo` | Function | `@decorator\ndef foo` | `@decorator\ndef foo(x: int) -> bool:\n    return x > 0` |
| `x` | Parameter | `x` | `x: int` |
| `Bar` | Class | `class Bar` | `class Bar:\n    value: int = 0\n    \n    def method(self):\n        pass` |
| `value` | Variable | `value` | `value: int = 0` |
| `method` | Method | `def method` | `def method(self):\n        pass` |
| `self` | Parameter | `self` | `self` |
| `x` | Variable | `x` | `x = 1` |
| `a` | Variable | `a` | `a, b = 1, 2` |
| `b` | Variable | `b` | `a, b = 1, 2` |

Note: For tuple unpacking (`a, b`), both variables share the same body span (the entire assignment statement).
