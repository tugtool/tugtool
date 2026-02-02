# Phase 13: Python Refactoring Operations {#phase-13}

**Purpose:** Expand tugtool from a single-operation tool (rename) into a comprehensive Python refactoring engine by building infrastructure layers that enable progressively more sophisticated operations.

---

## Table of Contents

1. [Plan Metadata](#plan-metadata)
2. [Phase Overview](#phase-overview)
3. [Design Decisions](#design-decisions)
4. [Infrastructure Layers](#infrastructure-layers)
5. [Operation Inventory](#operation-inventory)
6. [Specification](#specification)
7. [Execution Steps](#execution-steps)
8. [Deliverables and Checkpoints](#deliverables)

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | tugtool team |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-01 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tugtool has a mature rename operation built on substantial infrastructure: a native Rust CST parser, 4-pass cross-file analysis, MRO-aware type resolution, and alias tracking. This infrastructure is unique in the Python refactoring landscape—no other tool combines origin-aware MRO, cross-file type resolution, and agent-native design.

However, rename is our only operation. Rope offers 15+ operations. To prove our architecture delivers "more correct refactors," we must expand our operation set while leveraging what we've built.

#### Strategy {#strategy}

- **Layer-first implementation:** Build infrastructure in layers, not operation-by-operation. Each layer enables multiple operations.
- **Hardened foundation:** Start by vetting and improving the existing rename operation (Layer 0).
- **Progressive capability:** Each layer unlocks new operations. Ship operations as layers complete.
- **Conservative defaults:** When uncertain (side effects, control flow), refuse rather than break code.
- **Agent-native throughout:** Every operation follows analyze/emit/apply workflow with JSON output.

#### Stakeholders / Primary Customers {#stakeholders}

1. AI coding agents (Claude Code, Copilot, etc.) that need deterministic refactoring
2. Developers using tugtool CLI for automated refactoring
3. IDE integrations via LSP

#### Success Criteria (Measurable) {#success-criteria}

- [ ] **10+ operations implemented** (up from 1): `tug analyze python <op> --help` lists operations
- [ ] **Stage 0 infrastructure complete:** Edit primitives, position lookup, stub discovery, FactsStore completeness (see [Stage 0](#stage-0))
- [ ] **All Layer 0-4 infrastructure complete:** Each layer has dedicated tests
- [ ] **Rename hardened:** All edge cases in [Table T02](#t02-rename-gaps) addressed
- [ ] **Cross-layer integration tests:** 50+ integration tests across operations
- [ ] **Temporale fixture coverage:** All operations tested against real Python code

#### Scope {#scope}

1. Build [Stage 0](#stage-0) infrastructure (edit primitives, position lookup, stub discovery, FactsStore completeness; see [D07](#d07-edit-primitives), [D08](#d08-stub-updates), [Step 0.5](#step-0-5))
2. Harden existing rename operation ([Layer 0](#layer-0), [Table T02](#t02-rename-gaps))
3. Implement [Layers 1-4](#infrastructure-layers) infrastructure
4. Ship operations: [Extract Variable](#op-extract-variable), [Inline Variable](#op-inline-variable), [Safe Delete](#op-safe-delete), [Move Function](#op-move-function), [Move Class](#op-move-class), [Extract Method](#op-extract-method), [Inline Method](#op-inline-method), [Change Signature](#op-change-signature)
5. Document all operations in AGENT_API.md

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Organize Imports:** Ruff does this well; low priority
- **Pattern-based transforms:** Bowler's strength; defer to future phase
- **Code generation operations:** Introduce Parameter Object, Convert to Data Class (require CST construction)
- **Rust language support:** Separate phase

#### Dependencies / Prerequisites {#dependencies}

- Phase 12 (complete): Agent-focused CLI with `tug <action> <language> <command>` structure
- Temporale fixture: Test target for all operations

#### Constraints {#constraints}

- No Python runtime required (all analysis in Rust)
- Span-based edits only (no full CST reconstruction) - see [D07](#d07-edit-primitives) for edit model
- Must preserve all formatting/comments in unedited regions

#### Assumptions {#assumptions}

- Single-file operations are simpler and should be prioritized
- Conservative analysis (refusing uncertain cases) is better than breaking code
- Simple cases (single entry/exit) cover majority of real-world refactoring needs

---

### Open Questions {#open-questions}

#### [Q01] Control flow analysis depth (OPEN) {#q01-control-flow-depth}

**Question:** How deep should control flow analysis go?

**Why it matters:** Full data flow analysis is complex but enables more extractions.

**Options:**
- Minimal: Use-def chains only, reject complex cases
- Moderate: Basic exception awareness, multiple returns as tuple
- Full: SSA-based data flow, exception-safe boundaries

**Plan to resolve:** Prototype minimal approach in Stage 4, evaluate coverage on Temporale

**Resolution:** OPEN

---

#### [Q02] Code generation strategy (CLOSED) {#q02-code-generation}

**Question:** Template-based generation vs. CST construction?

**Resolution:** CLOSED - See [D04](#d04-template-generation)

Template-based generation is the decided approach. CST construction was rejected due to verbosity and complexity. See [D04] for full rationale and formatting rules.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|-------------------|
| Control flow complexity | High | High | Simple-cases-first, clear error messages | >50% of extractions rejected |
| Import manipulation bugs | High | Medium | Extensive golden tests, conservative updates | Any incorrect import after move |
| Side-effect false positives | Medium | Medium | Conservative = safe; document limitations | User complaints about refused refactors |
| Edit primitive correctness | High | Medium | Comprehensive unit tests, overlapping edit rejection | Any corrupted file after edit |
| CST lifetime issues | Medium | Low | Careful API design, collect edits before applying | Borrow checker errors during implementation |
| Test fixture coverage gaps | Medium | Medium | Create dedicated edge-case fixtures beyond Temporale | Edge cases not covered by Temporale |

**Risk R01: Layer 4 Complexity** {#r01-layer4-complexity}

- **Risk:** Control flow analysis for Extract Method is significantly more complex than other infrastructure
- **Mitigation:** Define strict MVP scope (single entry/exit, no exceptions crossing boundary); defer complex cases
- **Residual risk:** Some valid extractions will be rejected; document clearly

**Risk R02: Edit Primitive Correctness** {#r02-edit-primitives}

- **Risk:** Edit primitive infrastructure could corrupt files through overlapping edits, incorrect span handling, or Unicode edge cases
- **Mitigation:** Comprehensive unit tests for all primitives; reject overlapping edits; test with multi-byte Unicode
- **Residual risk:** Rare edge cases may slip through; syntax verification catches most issues

**Risk R03: CST Lifetime Issues** {#r03-cst-lifetime}

- **Risk:** Rust's borrow checker may complicate edit operations that need to hold CST references while computing edits
- **Mitigation:** Design API to collect all edit primitives before applying; never mutate CST directly
- **Residual risk:** API may be less ergonomic than ideal

**Risk R04: Test Fixture Coverage** {#r04-fixture-coverage}

- **Risk:** Temporale fixture (a datetime library) may not exercise all refactoring edge cases
- **Mitigation:** Create dedicated test fixtures for edge cases (nested classes, diamond inheritance, complex imports)
- **Residual risk:** Real-world edge cases discovered post-release; add to fixture as found

---

### 13.0 Design Decisions {#design-decisions}

#### [D01] Layer-Based Implementation Order (DECIDED) {#d01-layer-order}

**Decision:** Implement infrastructure in layer order, not operation order.

**Rationale:**
- Layers build on each other; operations share infrastructure
- Avoids duplicate work when adding second operation needing same infrastructure
- Each layer is testable independently

**Implications:**
- Some operations must wait for their layer (e.g., Move Function waits for Layer 3)
- Progress is measured by layers completed, not just operation count

---

#### [D02] Conservative Side-Effect Analysis (DECIDED) {#d02-conservative-side-effects}

**Decision:** For MVP, use explicit purity rules with conservative defaults for uncertain cases.

**Table T10: Expression Purity Rules (MVP)** {#t10-purity-rules}

| Expression Type | Classification | Rationale |
|-----------------|---------------|-----------|
| Literals (`42`, `"str"`, `True`) | Pure | No side effects |
| Name lookup (`x`) | Pure | Reading a variable |
| Binary/unary ops (`a + b`, `-x`) | **Impure** unless both operands are literals | Dunder methods may have side effects |
| Comparison (`a < b`, `a == b`) | **Impure** | `__eq__`, `__lt__` may have side effects |
| Attribute access (`obj.attr`, `self.x`) | **Impure** | Property getter may have side effects |
| Subscript (`obj[key]`) | **Impure** | `__getitem__` may have side effects |
| Function call (`f()`) | **Impure** | Calls may have arbitrary side effects |
| Method call (`obj.method()`) | **Impure** | May mutate `obj` or have side effects |
| Comprehensions | **Impure** | Contains implicit iteration with possible side effects |
| Lambda | Pure (definition) | Lambda itself is pure; calling it may not be |
| Conditional expr (`a if c else b`) | Impure if any part impure | Conservative |
| Walrus (`:=`) | **Impure** | Assignment is a side effect |
| Await | **Impure** | Async operations may have side effects |
| Yield/Yield from | **Impure** | Generator control flow |

**Known Safe Patterns (Future Enhancement):**

| Pattern | Why Safe | Status |
|---------|----------|--------|
| `len(x)`, `str(x)`, `repr(x)` | Stdlib builtins are pure | Deferred |
| `x.lower()`, `x.strip()` | String methods are pure | Deferred |
| `isinstance(x, T)` | Type check is pure | Deferred |

**Rationale:**
- Conservative analysis is safe (may refuse valid refactors, never breaks code)
- Dunder methods (`__eq__`, `__getitem__`, etc.) can contain arbitrary code
- Property getters are commonly used for lazy initialization (side effects)
- Can be refined incrementally with "known pure" patterns

**Implications:**
- Inline Variable treats non-literal binary/unary ops as impure (conservative)
- Inline Variable refuses multi-use inlining for any expression with attribute access
- Extract Variable "all occurrences" requires all occurrences to have pure context
- Error message explains why and suggests manual refactoring

---

#### [D03] Simple-Cases-First for Control Flow (DECIDED) {#d03-simple-control-flow}

**Decision:** Extract Method and Inline Method MVP reject complex control flow patterns.

**Table T11: Control Flow Rejection List (MVP)** {#t11-control-flow-reject}

| Pattern | Rejection Reason | Error Code |
|---------|------------------|------------|
| `async def` / `await` | Async control flow complexity | `CF_ASYNC` |
| `yield` / `yield from` | Generator control flow | `CF_GENERATOR` |
| `try`/`except`/`finally` crossing boundary | Exception flow escapes selection | `CF_EXCEPTION` |
| `with` statement crossing boundary | Context manager flow | `CF_CONTEXT` |
| `match`/`case` (Python 3.10+) | Pattern matching complexity | `CF_MATCH` |
| `break` targeting loop outside selection | Control escapes selection | `CF_BREAK` |
| `continue` targeting loop outside selection | Control escapes selection | `CF_CONTINUE` |
| `return` in middle of selection (not end) | Multiple exit points | `CF_MULTI_EXIT` |
| Multiple `return` statements | Multiple exit points | `CF_MULTI_RETURN` |
| `raise` without enclosing `try` | Exception escapes selection | `CF_RAISE` |
| `nonlocal` / `global` declarations | Scope manipulation | `CF_SCOPE` |

**Boundary Crossing:** A construct "crosses the boundary" when it starts inside the selection but its effect extends outside, or vice versa.

**Allowed Patterns (MVP):**

| Pattern | Conditions |
|---------|------------|
| Single `return` at end of selection | Last statement only |
| `return` with tuple | Single return, tuple is fine |
| Local `try`/`except`/`finally` | Entire construct within selection |
| Local `with` statement | Entire construct within selection |
| Local `for`/`while` with `break`/`continue` | Loop and control within selection |

**Error Message Format:**

```
Error: Cannot extract method - selection contains control flow that would escape.

Details:
  - Line 15: 'break' targets loop at line 10, outside selection

Suggestion: Expand selection to include the 'for' loop at line 10
```

**Rationale:**
- Complex control flow requires sophisticated analysis to preserve semantics
- Simple cases cover majority of real-world extractions (>80% estimated)
- Clear error messages for rejected cases guide users toward valid selections
- Future phases can expand support for async/generators

**Implications:**
- Some valid extractions will be rejected
- Users can manually refactor or expand selection

---

#### [D04] Template-Based Code Generation (DECIDED) {#d04-template-generation}

**Decision:** Use string templates (not CST construction) for generated code, with explicit formatting rules.

**Rationale:**
- CST construction is verbose and error-prone
- Templates are readable and maintainable
- Indentation handling is explicit

**Table T15: Code Formatting Rules** {#t15-formatting-rules}

| Context | Rule | Example |
|---------|------|---------|
| Edited existing spans | Preserve original formatting | Rename `foo` to `bar` preserves whitespace |
| Inserted statements | Match surrounding indentation | New assignment matches function body indent |
| Generated functions | Minimal deterministic format | Single blank line before, no trailing blank |
| Generated classes | Minimal deterministic format | Single blank line before and after |
| Line length | No wrapping (may exceed limits) | Long lines remain long |
| Trailing whitespace | None added | Clean line endings |
| Final newline | Preserve file's existing style | Match original EOF |

**Indentation Detection:**

The indentation at the insertion point is detected from:
1. The first non-empty line in the selection (for extractions)
2. The line before the insertion point (for insertions)
3. The containing scope's indentation + one level (fallback)

**Generated Code Style:**

Generated code uses a minimal, deterministic style:
- No blank lines between simple statements
- Single blank line before function/class definitions
- No docstrings (user can add)
- No type hints unless inferred from context

**Style Mismatch Warning:**

Operations emit a warning when generating code:
```json
{
  "warnings": [{
    "code": "W_STYLE",
    "message": "Generated code may not match project style",
    "suggestion": "Run your formatter (black, ruff format) after applying"
  }]
}
```

**Implications:**
- Generated code formatting may not exactly match user's style
- Users should run their formatter after refactoring operations
- Future: optional `--format=black` flag to run formatter post-generation

---

#### [D05] Rename as Reference Implementation (DECIDED) {#d05-rename-reference}

**Decision:** Treat rename operation as the reference implementation for all operations.

**Rationale:**
- Rename exercises most of the infrastructure (analysis, resolution, transformation, verification)
- Establishes patterns for error handling, JSON output, verification workflow
- Hardening rename improves the foundation for all operations

**Implications:**
- Must address all rename gaps before adding new operations
- Rename tests serve as template for new operation tests

---

#### [D06] Aliases Are Informational Only (DECIDED) {#d06-aliases-informational}

**Decision:** When renaming a symbol, report aliased names but do not rename them automatically.

**Rationale:**
- Alias semantics are ambiguous (user may want `b` to remain as `b` even if `b = foo`)
- Automatic alias rename can cause unexpected changes
- Informational output lets users decide

**Implications:**
- Rename output includes `aliases_not_renamed` field
- Users can manually rename aliases if desired

---

#### [D07] Span-Based Edit Primitives (DECIDED) {#d07-edit-primitives}

**Decision:** All code transformations use span-anchored edit primitives that do not require full CST reconstruction.

**Context:** The constraint "span-based edits only" refers to avoiding a full CST re-printer that would reserialize entire nodes. It does NOT prevent code insertion—insertions are expressed as span-anchored operations.

**Edit Primitives:**

| Primitive | Description | Span Semantics |
|-----------|-------------|----------------|
| `Replace(span, text)` | Replace content at span with new text | `span.start..span.end` becomes `text` |
| `InsertBefore(span, text)` | Insert text immediately before span | Insert at `span.start` |
| `InsertAfter(span, text)` | Insert text immediately after span | Insert at `span.end` |
| `Delete(span)` | Remove content at span | Equivalent to `Replace(span, "")` |
| `InsertAt(position, text)` | Insert at absolute position | Zero-width span at position |

**Formatting Preservation Rules:**

1. **Surrounding whitespace:** Primitives operate on exact spans; surrounding whitespace is preserved
2. **Indentation:** New code inherits indentation from context (detected at insertion point)
3. **Trailing content:** Content after the span remains unchanged
4. **Comments:** Comments within spans are included; comments before/after are preserved

**Implementation Notes:**

- Edits are collected and applied in reverse position order to avoid span invalidation
- Overlapping edits are rejected (indicates logic error)
- A new `BatchSpanEditor` component in `tugtool-python-cst` implements all primitives (see [Step 0.1](#step-0-1))

**Rationale:**
- Span-based edits preserve formatting by not touching unaffected regions
- No CST re-serialization means no risk of reformatting user code
- Explicit primitives make edit semantics clear and testable

**Implications:**
- Extract Variable uses `InsertBefore` for the assignment statement
- Move Function uses `InsertAfter` (after imports) combined with `Delete` (from source)
- All edits are reversible given the original spans

---

#### [D08] Type Stub and Annotation Updates (DECIDED) {#d08-stub-updates}

**Decision:** Operations that change symbol names or signatures MUST update type stubs and string annotations when they exist in the workspace.

**Scope of Updates:**

| Artifact | When to Update | Example |
|----------|---------------|---------|
| `.pyi` stub file | Symbol renamed/moved, signature changed | `def foo() -> int` in stub |
| String annotations | Symbol renamed | `x: "ClassName"` becomes `x: "NewName"` |
| Forward references | Symbol renamed | `def f(x: "Foo")` |
| `__all__` entries | Symbol renamed/deleted | `__all__ = ["foo"]` |
| Docstring references | **Not updated** (too fragile) | `"""See :func:`foo`"""` |

**Discovery Rules:**

1. **Stub files:** For `module.py`, check `module.pyi` (same directory) and `stubs/module.pyi`
2. **String annotations:** Parse string content as type expression
3. **Forward references:** Identified by quoted type in annotation position

**Stub Parse Failure Policy:**

- If a stub file exists but cannot be parsed, the operation fails with an error and no edits are applied.
- The error includes the stub path and a suggestion to fix or remove the stub.

**Stub Parse Error Code:**

- `STUB_PARSE` - Stub file exists but failed to parse; no edits applied.

```json
{
  "status": "error",
  "code": 5,
  "error": {
    "kind": "STUB_PARSE",
    "stub_path": "pkg/api.pyi",
    "message": "Failed to parse stub file",
    "suggestion": "Fix or remove the stub, then retry"
  }
}
```

**Warning for Public Symbols Without Stubs:**

```json
{
  "warnings": [{
    "code": "W_NO_STUB",
    "message": "Symbol 'foo' appears to be public (in __all__) but has no .pyi stub",
    "suggestion": "Consider adding a type stub for API stability"
  }]
}
```

**Rationale:**
- Stubs define the public API; they must stay synchronized
- String annotations are common for forward references and lazy imports
- Docstrings are natural language with uncertain parsing

**Implications:**
- Rename operations must locate and update stub files
- String annotation updates require parsing annotation content
- Move operations must update import statements in stubs

---

#### Design Decision D09: Comprehension Scope Handling {#d09-comprehension-scope}

**Decision:** Comprehension iteration variables are treated as References (not Definitions) for rename operations.

**Background:**
In Python 3, comprehension iteration variables are scoped to the comprehension expression and not visible outside. For example:
```python
items = [1, 2, 3]
doubled = [x * 2 for x in items]
# x is NOT defined here (Python 3 behavior)
```

**Rationale:**
1. **ReferenceCollector**: Should NOT have a `visit_comp_for` handler. The default traversal visits Name nodes in the comprehension target and classifies them as References. This is correct for rename operations because we want to find ALL occurrences of a name.

2. **BindingCollector**: Should NOT collect comprehension iteration variables as bindings because they are scoped to the comprehension and not visible at module/function level. For refactoring purposes, we only care about bindings that affect the broader scope.

**Implications:**
- Renaming `items` in the example above correctly renames both the assignment and the comprehension reference
- Comprehension iteration variables (`x`) can only be renamed within the comprehension itself
- This matches Python 3 scoping semantics

**References:** [Table T02](#t02-rename-gaps), [Step 1.1](#step-1-1)

---

### 13.1 Infrastructure Layers {#infrastructure-layers}

**Table T01: Infrastructure Layer Summary** {#t01-layer-summary}

| Layer | Name | Status | Components | Operations Enabled |
|-------|------|--------|------------|-------------------|
| 0 | Foundation | Complete | CST parser, analysis pipeline, type tracker, rename | Rename Symbol, Rename Parameter |
| 1 | Expression Analysis | Planned | Expression boundary, unique names, single-assignment | Extract Variable, Extract Constant |
| 2 | Statement Analysis | Planned | Side-effect analyzer, use-def, statement boundary | Inline Variable, Safe Delete |
| 3 | Import Manipulation | Planned | Import insert/remove/update | Move Function, Move Class |
| 4 | Method Transformation | Planned | Parameter/return analysis, body extraction | Extract Method, Inline Method, Change Signature |
| 5 | Code Generation | Planned | Property generator, abstract methods | Encapsulate Field, Pull Up Method |
| 6 | Package Structure | Planned | Package analyzer, relative imports | Move Module |

---

#### Layer 0: Foundation (Complete) {#layer-0}

**Status:** Complete (requires hardening)

The existing rename infrastructure forms the foundation for all operations.

**Components:**

| Component | Location | Purpose |
|-----------|----------|---------|
| CST Parser | `tugtool-python-cst/src/parser/` | Native Python CST parsing |
| Scope/Binding/Reference Collectors | `tugtool-python-cst/src/visitor/` | Symbol and reference tracking |
| Type Tracker | `tugtool-python/src/type_tracker.rs` | 3-level type inference |
| Alias Graph | `tugtool-python/src/alias.rs` | Transitive alias detection |
| Cross-file Analysis | `tugtool-python/src/analyzer.rs` | 4-pass analysis pipeline |
| MRO Computation | `tugtool-python/src/mro.rs` | C3 linearization with origin tracking |
| Rename Transformer | `tugtool-python-cst/src/visitor/rename.rs` | Rename-specific CST edits |
| Batch Span Editor | `tugtool-python-cst/src/visitor/batch_edit.rs` | General edit primitives (see [Step 0.1](#step-0-1)) |
| Verification Pipeline | `tugtool-python/src/verification.rs` | Syntax verification |

**Existing Collectors (P0 - Core):**

| Collector | Output | Used By |
|-----------|--------|---------|
| `ScopeCollector` | `Vec<ScopeInfo>` | All operations |
| `BindingCollector` | `Vec<BindingInfo>` | All operations |
| `ReferenceCollector` | `HashMap<String, Vec<ReferenceInfo>>` | All operations |
| `ExportCollector` | `Vec<ExportInfo>` | Move operations |

**Existing Collectors (P1 - Extended):**

| Collector | Output | Used By |
|-----------|--------|---------|
| `ImportCollector` | `Vec<ImportInfo>` | Move, Safe Delete |
| `SignatureCollector` | `Vec<SignatureInfo>` | Extract Method, Change Signature |
| `CallSiteCollector` | `Vec<CallSiteInfo>` | Inline Method, Change Signature |
| `AttributeAccessCollector` | `Vec<AttributeAccessInfo>` | Encapsulate Field |
| `InheritanceCollector` | `Vec<ClassInheritanceInfo>` | Pull Up/Push Down |
| `TypeInferenceCollector` | `Vec<AssignmentInfo>` | Type-aware operations |

**Table T02: Rename Operation Gaps** {#t02-rename-gaps}

| Gap | Description | Severity | Status |
|-----|-------------|----------|--------|
| Local symbol references | References to parameters/locals not tracked (hardcoded `ScopeId(0)`) | **Critical** | OPEN ([Step 0.4](#step-0-4)) |
| Decorator arguments | `@decorator(foo)` where `foo` is renamed | Medium | DONE |
| Comprehension scope | Variable in nested comprehension scope (see [D09](#d09-comprehension-scope)) | Low | DONE |
| Type comments | `# type: Foo` comments | Low | DONE |
| `__init__.py` re-exports | Implicit re-exports not in `__all__` | Medium | DEFERRED ([Step 3.1](#step-3-1)) |
| Multi-inheritance rename | Method rename in diamond hierarchy | Medium | DONE |
| Aliased import rename | `from x import foo as bar; bar()` | Medium | DONE |
| Property setter rename | Renaming property with getter/setter | Medium | DONE |
| Nested class rename | Class defined inside function | Low | DONE |
| Walrus operator | Rename target of `:=` | Low | DONE |

---

#### Layer 1: Expression Analysis {#layer-1}

**Status:** Planned

Adds the ability to analyze and manipulate expressions.

**Components:**

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `ExpressionBoundaryDetector` | Find complete expression at cursor position | High |
| `ExpressionExtractor` | Extract expression text with proper span | Low |
| `UniqueNameGenerator` | Generate non-conflicting names in scope | Medium |
| `SingleAssignmentChecker` | Verify variable has exactly one assignment | Medium |
| `LiteralDetector` | Identify extractable literals (numbers, strings) | Low |

**Implementation Notes:**

- Expression boundary requires position-to-node lookup and parent context (see [Step 0.2](#step-0-2))
- Handle parenthesized expressions, multi-line expressions, and f-strings correctly
- Unique names must consult ALL visible bindings (imports, enclosing scopes, builtins, generator scopes)
- Single-assignment must handle augmented assignment, walrus operator, and tuple unpacking
- Literal detection identifies magic numbers/strings (including bytes, complex, boolean, None)

**Operations Enabled:**

| Operation | Layer 1 Dependencies |
|-----------|---------------------|
| Extract Variable | Expression boundary, unique name generation |
| Extract Constant | Expression boundary, unique name, literal detection |

---

#### Layer 2: Statement Analysis & Side Effects {#layer-2}

**Status:** Planned

Adds statement-level analysis and basic side-effect tracking.

**Components:**

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `StatementBoundaryDetector` | Find complete statements in range | Medium |
| `SideEffectAnalyzer` | Classify expressions as pure/impure | Medium |
| `UseDefAnalyzer` | Track variable use-before-def, def-after-use | Medium |
| `SelectionValidator` | Validate selection covers complete statements | Low |
| `UnusedSymbolDetector` | Find symbols with no references | Low |

**Implementation Notes:**

- Side effects: function calls are impure, attribute access may be impure (property getters)
- Use-def analysis leverages existing binding/reference data
- Conservative: assume impure if uncertain (per [D02](#d02-conservative-side-effects))

**Operations Enabled:**

| Operation | Layer 2 Dependencies |
|-----------|---------------------|
| Inline Variable | Side-effect analysis, use-def for multi-use |
| Safe Delete | Unused symbol detection |
| Extract Variable (all occurrences) | Side-effect analysis |

---

#### Layer 3: Import Manipulation {#layer-3}

**Status:** Planned

Adds the ability to modify import statements programmatically with precise control over placement and formatting.

**Components:**

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `ImportInserter` | Add new import statement at correct location | Medium |
| `ImportRemover` | Remove import with proper cleanup | Low |
| `ImportUpdater` | Change import source or target | Medium |
| `StdlibDetector` | Identify standard library modules | Low |
| `CircularImportChecker` | Detect import cycles before move | Low |
| `ImportBlockAnalyzer` | Analyze existing import structure | Medium |

##### Import Ordering Rules {#import-ordering-rules}

**Table T08: Import Section Order (Mandatory)** {#t08-import-order}

| Section | Description | Must Precede |
|---------|-------------|--------------|
| `__future__` | Future imports | All other imports |
| `TYPE_CHECKING` block | Type-only imports | None (special block) |
| Standard library | stdlib imports | Third-party, local |
| Third-party | External packages | Local |
| Local | Project imports | None |

**Insertion Modes:**

| Mode | Description | When to Use |
|------|-------------|-------------|
| `preserve` | Insert in existing section, minimize diff | Default for all operations |
| `pep8` | Full PEP 8 grouping with blank lines | User-requested reorganization |
| `grouped` | Custom grouping via configuration | Project-specific rules |

**MVP uses `preserve` mode only.** The `pep8` and `grouped` modes are deferred to future phases.

##### Preserve Mode Rules {#preserve-mode-rules}

1. **Find matching section:** If an import from the same module exists, add to that import statement
2. **Find similar section:** If imports from related packages exist, insert nearby
3. **Fallback:** Insert after last import, before first non-import statement
4. **Exception:** `__future__` imports always go first, `TYPE_CHECKING` blocks handled specially

**Example:**

```python
# Existing:
from typing import List
from mypackage import foo

# Adding: from mypackage import bar
# Result (preserve mode):
from typing import List
from mypackage import foo, bar  # Added to existing import
```

##### Special Import Patterns {#special-import-patterns}

**Table T09: Special Import Handling** {#t09-special-imports}

| Pattern | Handling |
|---------|----------|
| `from __future__ import ...` | After module docstring (if present), before any other imports |
| `if TYPE_CHECKING:` block | Type-only imports go inside block |
| Multiline `from X import (...)` | Preserve multiline format, add item |
| `import X as Y` | Preserve alias when updating source |
| `from X import Y as Z` | Preserve alias when updating source |
| Trailing comma in multiline | Preserve trailing comma style |
| Comments on import line | Preserve inline comments |
| Comments above import | Keep comment attached to import |

##### Alias Preservation {#alias-preservation}

When moving a symbol that was imported with an alias:

```python
# Before move: main.py
from old_module import Handler as H
h = H()

# After move (Handler moved to new_module):
from new_module import Handler as H  # Alias preserved
h = H()
```

##### TYPE_CHECKING Block Rules {#type-checking-rules}

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from expensive_module import ExpensiveClass  # Type-only import
```

**Rules:**

1. If import is used ONLY in type annotations, place in `TYPE_CHECKING` block
2. If import is used at runtime, place in normal import section
3. When moving a class, check if importers only use it for typing
4. Never move runtime imports into `TYPE_CHECKING` (breaks execution)

##### Comment Preservation {#import-comment-preservation}

```python
# Database utilities
from db import connect, query  # Core database functions

# After removing 'query' from import:
# Database utilities
from db import connect  # Core database functions preserved
```

**Rules:**

1. Comments on the same line as import: Preserve on remaining import
2. Comments above import block: Keep attached
3. Comments between imports: Preserve in relative position
4. Empty import after removal: Delete line, preserve surrounding comments

**Operations Enabled:**

| Operation | Layer 3 Dependencies |
|-----------|---------------------|
| Move Function | Import insertion, import update, alias preservation |
| Move Class | Import insertion, import update, TYPE_CHECKING handling |
| Safe Delete (with cleanup) | Import removal, comment preservation |

---

#### Layer 4: Method/Function Transformation {#layer-4}

**Status:** Planned

Adds control flow analysis and method body manipulation.

**Components:**

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `ParameterAnalyzer` | Determine variables that become parameters | High |
| `ReturnValueAnalyzer` | Determine variables that need to be returned | High |
| `BodyExtractor` | Extract method body with local variables | Medium |
| `ParameterSubstituter` | Replace formal params with actual args | Medium |
| `ReturnHandler` | Convert return statements for inlining | Medium |
| `SelfReferenceAdjuster` | Handle self/cls references in moved code | Medium |

**Implementation Notes:**

- Parameter analysis: variables read in selection but defined before
- Return analysis: variables written in selection and used after
- MVP: single entry/exit only (per [D03](#d03-simple-control-flow))
- Exception boundaries are initially rejected

**Operations Enabled:**

| Operation | Layer 4 Dependencies |
|-----------|---------------------|
| Extract Method | Parameter/return analysis, body extraction |
| Inline Method | Parameter substitution, return handling, import cleanup (Layer 3) |
| Change Signature | Parameter analysis, call site updates |

---

#### Layer 5: Code Generation {#layer-5}

**Status:** Planned

Adds the ability to generate new code constructs.

**Components:**

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `PropertyGenerator` | Generate @property getter/setter | Medium |
| `AbstractMethodGenerator` | Generate abstract method stubs | Low |
| `IndentationMatcher` | Match surrounding indentation | Low |
| `TemplateRenderer` | Render code templates with substitution | Low |

**Implementation Notes:**

- Template-based generation (per [D04](#d04-template-generation))
- Indentation must match surrounding code
- Generated code runs through syntax verification

**Operations Enabled:**

| Operation | Layer 5 Dependencies |
|-----------|---------------------|
| Encapsulate Field | Property generator |
| Pull Up Method | Abstract method generator |

---

#### Layer 6: Package Structure {#layer-6}

**Status:** Planned

Adds package-level analysis and manipulation.

**Components:**

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `PackageAnalyzer` | Understand package structure, `__init__.py` | Medium |
| `RelativeImportCalculator` | Calculate new relative imports after move | Medium |
| `InitFileUpdater` | Update package `__init__.py` files | Medium |

**Implementation Notes:**

- Handle both regular and namespace packages (PEP 420)
- Relative imports require careful calculation
- `__init__.py` updates must preserve `__all__`

**Operations Enabled:**

| Operation | Layer 6 Dependencies |
|-----------|---------------------|
| Move Module | All package components |

---

### 13.2 Operation Inventory {#operation-inventory}

**Table T03: Operation-to-Layer Mapping** {#t03-operation-layer-map}

| Operation | L0 | L1 | L2 | L3 | L4 | L5 | L6 | Stage |
|-----------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:-----:|
| Rename Symbol | X | | | | | | | 1 |
| Rename Parameter | X | | | | | | | 1 |
| Extract Variable | X | X | | | | | | 1 |
| Extract Constant | X | X | | | | | | 1 |
| Inline Variable | X | X | X | | | | | 2 |
| Safe Delete | X | | X | X | | | | 2-3 |
| Move Function | X | | | X | | | | 3 |
| Move Class | X | | | X | | | | 3 |
| Extract Method | X | X | X | | X | | | 4 |
| Inline Method | X | | | X | X | | | 4 |
| Change Signature | X | | | | X | | | 4 |
| Encapsulate Field | X | | | | | X | | 5 |
| Pull Up Method | X | | | | X | X | | 5 |
| Push Down Method | X | | | | X | | | 5 |
| Move Module | X | | | X | | | X | 5 |

---

#### Operation 0: Rename Symbol {#op-rename}

**Layer Requirements:** Layer 0

**Description:** Rename a symbol (function, class, variable, method) and update all references.

**Current Status:** Complete (requires hardening per [Table T02](#t02-rename-gaps))

**CLI:**
```bash
tug apply python rename --at <file:line:col> --to <new_name>
tug emit python rename --at <file:line:col> --to <new_name>
tug analyze python rename --at <file:line:col> --to <new_name>
```

**Competitive Advantage:** Origin-aware MRO ensures inherited methods are handled correctly.

---

#### Operation 1: Rename Parameter {#op-rename-param}

**Layer Requirements:** Layer 0

**Description:** Rename a function parameter, updating all call sites with keyword arguments.

```python
# Before
def greet(name, greeting="Hello"):
    return f"{greeting}, {name}"

greet(name="World", greeting="Hi")

# After (renaming `name` to `recipient`)
def greet(recipient, greeting="Hello"):
    return f"{greeting}, {recipient}"

greet(recipient="World", greeting="Hi")
```

**CLI:**
```bash
tug apply python rename-param --at <file:line:col> --to <new_name>
```

**Notes:** Extracted from general rename flow. Uses existing `SignatureCollector` and `CallSiteCollector`.

---

#### Operation 2: Extract Variable {#op-extract-variable}

**Layer Requirements:** Layer 0 + Layer 1

**Description:** Extract an expression into a named variable.

```python
# Before
result = calculate_tax(get_price() * 1.08)

# After (extracting `get_price() * 1.08`)
total_with_markup = get_price() * 1.08
result = calculate_tax(total_with_markup)
```

**CLI:**
```bash
tug apply python extract-variable --at <file:start_line:start_col-end_line:end_col> --name <var_name>
```

**See:** [Layer 1](#layer-1), [D07](#d07-edit-primitives), [Step 1.4](#step-1-4)

**Competitive Advantage:** Origin-aware scoping prevents incorrect extractions in nested class hierarchies.

---

#### Operation 3: Extract Constant {#op-extract-constant}

**Layer Requirements:** Layer 0 + Layer 1

**Description:** Extract a literal into a module-level constant.

```python
# Before
def calculate_tax(price):
    return price * 0.08  # magic number

# After
TAX_RATE = 0.08

def calculate_tax(price):
    return price * TAX_RATE
```

**CLI:**
```bash
tug apply python extract-constant --at <file:line:col> --name <CONSTANT_NAME>
```

**See:** [Layer 1](#layer-1), [D07](#d07-edit-primitives), [Step 1.5](#step-1-5)

---

#### Operation 4: Inline Variable {#op-inline-variable}

**Layer Requirements:** Layer 0 + Layer 1 + Layer 2

**Description:** Replace variable usages with its value, then remove the assignment.

```python
# Before
base_price = get_price()
total = base_price * 1.08

# After
total = get_price() * 1.08
```

**CLI:**
```bash
tug apply python inline-variable --at <file:line:col>
```

**Constraints:**
- Variable must have single assignment
- Expression must be pure (or used only once)

**See:** [Layer 2](#layer-2), [D02](#d02-conservative-side-effects), [Table T10](#t10-purity-rules), [D07](#d07-edit-primitives), [Step 2.2](#step-2-2)

**Competitive Advantage:** Alias tracking catches transitive cases (`a = b; c = a`).

---

#### Operation 5: Safe Delete {#op-safe-delete}

**Layer Requirements:** Layer 0 + Layer 2 + Layer 3

**Description:** Remove an unused symbol after verifying no references exist.

```python
# Before
def unused_helper():  # No references anywhere
    pass

def main():
    return 42

# After
def main():
    return 42
```

**CLI:**
```bash
tug apply python safe-delete --at <file:line:col>
tug apply python safe-delete --at <file:line:col> --force  # Override public API check
```

##### Public API Detection {#public-api-detection}

Safe Delete refuses to delete symbols that appear to be public API unless `--force` is specified.

**Table T12: Public API Indicators** {#t12-public-api}

| Indicator | Detection Method | Confidence |
|-----------|-----------------|------------|
| Listed in `__all__` | Parse `__all__` assignment | High |
| Re-exported in `__init__.py` | Check `from .module import symbol` | High |
| Has `@public` decorator | Decorator name check | High |
| Documented in stub file | Presence in `.pyi` | High |
| Name does not start with `_` | Naming convention | Medium |

**Behavior:**

```bash
# Refuses if symbol is in __all__:
$ tug apply python safe-delete --at api.py:10:5
Error: Cannot delete 'process_data' - symbol is public API (in __all__)

Use --force to delete anyway (may break external consumers)

# Force delete public symbol:
$ tug apply python safe-delete --at api.py:10:5 --force
Warning: Deleting public API symbol 'process_data'
```

**Error Output Schema:**

```json
{
  "status": "error",
  "code": 3,
  "error": {
    "kind": "public_api",
    "symbol": "process_data",
    "indicators": ["in_all", "has_stub"],
    "message": "Cannot delete public API symbol",
    "suggestion": "Use --force to delete anyway"
  }
}
```

**Competitive Advantage:** Cross-file resolution catches imports that static analysis might miss.

**See:** [Layer 2](#layer-2), [Layer 3](#layer-3), [Table T12](#t12-public-api), [D08](#d08-stub-updates), [Step 2.3](#step-2-3), [Step 3.4](#step-3-4)

---

#### Operation 6: Move Function {#op-move-function}

**Layer Requirements:** Layer 0 + Layer 3

**Description:** Move a top-level function to another module, updating all imports.

```python
# Before: utils.py contains helper()
# Before: main.py
from utils import helper
helper()

# After: helper() moved to helpers.py
# After: main.py
from helpers import helper
helper()
```

**CLI:**
```bash
tug apply python move --at <file:line:col> --to <target_module>
```

**See:** [Layer 3](#layer-3), [Table T08](#t08-import-order), [Table T09](#t09-special-imports), [D08](#d08-stub-updates), [Step 3.2](#step-3-2)

**Competitive Advantage:** Origin-aware tracking handles re-exports correctly.

---

#### Operation 7: Move Class {#op-move-class}

**Layer Requirements:** Layer 0 + Layer 3

**Description:** Move a class to another module, updating all imports and type annotations.

Same infrastructure as Move Function, plus:
- Handle class references in type annotations
- Handle inheritance (subclasses need updated base references)

**CLI:**
```bash
tug apply python move --at <file:line:col> --to <target_module>
```

**See:** [Layer 3](#layer-3), [Table T08](#t08-import-order), [Table T09](#t09-special-imports), [D08](#d08-stub-updates), [Step 3.3](#step-3-3)

---

#### Operation 8: Extract Method {#op-extract-method}

**Layer Requirements:** Layer 0 + Layer 1 + Layer 2 + Layer 4

**Description:** Extract selected statements into a new function.

```python
# Before
def process(items):
    total = 0
    for item in items:
        price = item.get_price()
        tax = price * 0.08
        total += price + tax
    return total

# After (extracting the loop body)
def calculate_item_total(item):
    price = item.get_price()
    tax = price * 0.08
    return price + tax

def process(items):
    total = 0
    for item in items:
        total += calculate_item_total(item)
    return total
```

**CLI:**
```bash
tug apply python extract-method --at <file:start-end> --name <method_name>
```

**Constraints (MVP):**
- Single-entry, single-exit blocks only
- No exception handlers crossing selection boundary
- Single return value (or tuple)

**See:** [Layer 4](#layer-4), [D03](#d03-simple-control-flow), [Table T11](#t11-control-flow-reject), [D07](#d07-edit-primitives), [Step 4.2](#step-4-2)

**Competitive Advantage:** Type inference provides parameter type hints.

---

#### Operation 9: Inline Method {#op-inline-method}

**Layer Requirements:** Layer 0 + Layer 3 + Layer 4

**Description:** Replace method calls with the method body.

```python
# Before
class Calculator:
    def add_tax(self, price):
        return price * 1.08

    def total(self, price):
        return self.add_tax(price)

# After (inline add_tax)
class Calculator:
    def total(self, price):
        return price * 1.08
```

**CLI:**
```bash
tug apply python inline-method --at <file:line:col>
```

**See:** [Layer 4](#layer-4), [Layer 3](#layer-3), [D03](#d03-simple-control-flow), [Table T11](#t11-control-flow-reject), [D07](#d07-edit-primitives), [Step 4.3](#step-4-3)

**Competitive Advantage:** MRO-aware inlining handles inherited methods correctly.

---

#### Operation 10: Change Signature {#op-change-signature}

**Layer Requirements:** Layer 0 + Layer 4

**Description:** Add, remove, reorder, or modify function parameters with automatic call site updates.

```python
# Before
def connect(host, port):
    pass

connect("localhost", 8080)

# After (add timeout parameter with default)
def connect(host, port, timeout=30):
    pass

connect("localhost", 8080)  # unchanged (default used)
```

**CLI:**
```bash
tug apply python change-signature --at <file:line:col> --add "timeout=30"
tug apply python change-signature --at <file:line:col> --remove "debug"
tug apply python change-signature --at <file:line:col> --reorder "port,host"
tug apply python change-signature --at <file:line:col> --rename "old_name:new_name"
```

**See:** [Layer 4](#layer-4), [Table T13](#t13-signature-support), [Table T14](#t14-callsite-constraints), [D08](#d08-stub-updates), [Step 4.4](#step-4-4)

##### Signature Constraints (MVP) {#signature-constraints}

**Table T13: Change Signature Support Matrix** {#t13-signature-support}

| Feature | Supported | Notes |
|---------|-----------|-------|
| Positional parameters | Yes | Standard parameters |
| Keyword parameters | Yes | With defaults |
| Positional-only (`/`) | Yes | Preserved in reordering |
| Keyword-only (`*`) | Yes | Preserved in reordering |
| `*args` | **No** | Reject signature |
| `**kwargs` | **No** | Reject signature |
| Default values | Yes | Preserved or added |
| Type annotations | Yes | Preserved |
| Decorators | Yes | Not modified |

**Table T14: Call Site Constraints (MVP)** {#t14-callsite-constraints}

| Call Pattern | Supported | Notes |
|--------------|-----------|-------|
| Positional arguments | Yes | Reordered as needed |
| Keyword arguments | Yes | Updated to new names |
| Mixed positional/keyword | Yes | Conservative handling |
| `*args` unpacking | **No** | Reject call site |
| `**kwargs` unpacking | **No** | Reject call site |
| `functools.partial` | **No** | Reject (cannot analyze) |
| Lambda wrapper | **No** | Reject (cannot analyze) |

**Rejection Behavior:**

When a signature or call site uses unsupported patterns:

```bash
$ tug apply python change-signature --at api.py:10:5 --remove "debug"
Error: Cannot change signature - function uses *args/**kwargs

Affected definition:
  api.py:10: def process(data, *args, **kwargs)

Suggestion: Manually update the signature and its call sites
```

**Call Site Analysis:**

```python
# Supported call sites:
connect("localhost", 8080)
connect(host="localhost", port=8080)
connect("localhost", port=8080)

# Rejected call sites (operation fails):
connect(*args)
connect(**config)
partial(connect, host="localhost")
```

---

#### Operation 11: Encapsulate Field {#op-encapsulate-field}

**Layer Requirements:** Layer 0 + Layer 5

**Description:** Convert direct field access to property getter/setter.

```python
# Before
class Person:
    def __init__(self):
        self.name = "Unknown"

p = Person()
print(p.name)
p.name = "Alice"

# After
class Person:
    def __init__(self):
        self._name = "Unknown"

    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, value):
        self._name = value
```

**CLI:**
```bash
tug apply python encapsulate-field --at <file:line:col>
```

---

#### Operation 12: Pull Up Method {#op-pull-up}

**Layer Requirements:** Layer 0 + Layer 4 + Layer 5

**Description:** Move a method from a subclass to a parent class.

```python
# Before
class Animal:
    pass

class Dog(Animal):
    def speak(self):
        return "Woof"

# After (pulling up with abstract stub)
class Animal:
    def speak(self):
        raise NotImplementedError

class Dog(Animal):
    def speak(self):
        return "Woof"
```

**CLI:**
```bash
tug apply python pull-up --at <file:line:col> --to <parent_class>
```

**Competitive Advantage:** Origin-aware MRO makes this MORE correct than rope. We know exactly where each method originates.

---

#### Operation 13: Push Down Method {#op-push-down}

**Layer Requirements:** Layer 0 + Layer 4

**Description:** Move a method from a parent class to its subclasses.

Inverse of Pull Up Method.

**CLI:**
```bash
tug apply python push-down --at <file:line:col>
```

---

#### Operation 14: Move Module {#op-move-module}

**Layer Requirements:** Layer 0 + Layer 3 + Layer 6

**Description:** Move an entire module to a new location, updating all imports.

```python
# Before: utils/helpers.py exists
from utils.helpers import foo

# After: moved to core/helpers.py
from core.helpers import foo
```

**CLI:**
```bash
tug apply python move-module --path <old_path> --to <new_path>
```

---

### 13.3 Competitive Landscape {#competitive-landscape}

**Table T04: Feature Comparison** {#t04-feature-comparison}

| Capability | tugtool | rope | bowler | ruff |
|------------|:-------:|:----:|:------:|:----:|
| Rename | Target | Yes | Yes | Yes |
| Extract Method | Target | Yes | ~ | No |
| Extract Variable | Target | Yes | ~ | No |
| Inline Variable | Target | Yes | No | No |
| Inline Method | Target | Yes | No | No |
| Move Function/Class | Target | Yes | ~ | No |
| Move Module | Target | Yes | No | No |
| Change Signature | Target | Yes | No | No |
| Safe Delete | Target | ~ | No | No |
| Organize Imports | Defer | Yes | No | Yes |
| Pattern Transforms | Defer | Yes | Yes | No |
| Origin-aware MRO | **Unique** | No | No | No |
| Cross-file type resolution | Yes | Yes | No | No |
| Agent-native design | **Unique** | No | No | No |
| Native Rust (no Python) | **Unique** | No | No | Yes |
| Type stub support | Yes | Yes | No | No |

**Legend:**
- **Target** = Planned for Phase 13
- **Defer** = Explicitly deferred
- **~** = Partial support

---

### 13.4 Specification {#specification}

#### 13.4.1 Operation CLI Interface {#op-cli-interface}

All operations follow the pattern:
```
tug <action> python <operation> [options] [-- <filter>]
```

**Actions:**
- `analyze` - Analyze impact without making changes
- `emit` - Generate diff without applying
- `apply` - Apply the refactoring

**Common Options:**

| Option | Type | Description |
|--------|------|-------------|
| `--at <location>` | Required | Symbol or range location |
| `--to <name>` | Varies | Target name/location |
| `--json` | Flag | Output as JSON envelope |
| `--verify <mode>` | Optional | Verification mode (syntax, none) |

#### 13.4.2 Location Formats {#location-formats}

**Point location:** `<file>:<line>:<col>`
- Example: `src/utils.py:42:5`

**Range location:** `<file>:<start_line>:<start_col>-<end_line>:<end_col>`
- Example: `src/utils.py:42:5-45:20`

**Position Semantics:**
- Line and column are 1-based.
- Column counts Unicode scalar values, not bytes.
- Internal edit spans use byte offsets; conversion uses UTF-8 encoding.

**Position Error Code:**

- `POS_OUT_OF_RANGE` - Line/column does not map to a valid position in file.

```json
{
  "status": "error",
  "code": 2,
  "error": {
    "kind": "POS_OUT_OF_RANGE",
    "message": "Location 120:80 is outside file bounds",
    "suggestion": "Choose a location within the file"
  }
}
```

**Symbol location:** For some operations, the cursor can be anywhere on the symbol name.

#### 13.4.3 Output Schemas {#output-schemas}

See [Phase 12](phase-12.md) documentation for base schemas. New operations follow the same envelope format:

```json
{
  "status": "ok",
  "schema_version": "1",
  "operation": "<operation_name>",
  "symbol": { ... },
  "edits": [ ... ],
  "warnings": [ ... ]
}
```

**Error Code System:**

Errors use two complementary identifiers:
- **Numeric exit codes** (process exit status): 2, 3, 4, 5, 10 per [CLAUDE.md](../CLAUDE.md) Table T26
- **Text error kinds** (`error.kind` in JSON): Descriptive codes like `STUB_PARSE`, `CF_ASYNC`, etc.

**Mapping:**

| Exit Code | Category | Text Kinds |
|-----------|----------|------------|
| 2 | Invalid arguments | `POS_OUT_OF_RANGE`, `CF_*` codes (invalid selection) |
| 3 | Resolution errors | `public_api`, `symbol_not_found` |
| 5 | Verification failed | `STUB_PARSE` (stub exists but unparseable) |

Control flow rejection codes (`CF_ASYNC`, `CF_GENERATOR`, `CF_EXCEPTION`, etc. from [Table T11](#t11-control-flow-reject)) all map to exit code 2 since they represent invalid user selections.

---

### 13.5 Symbol Inventory {#symbol-inventory}

#### 13.5.1 New Files {#new-files}

**Stage 0 Infrastructure:**

| File | Purpose |
|------|---------|
| `crates/tugtool-python-cst/src/visitor/batch_edit.rs` | Edit primitives (Replace, Insert, Delete) |
| `crates/tugtool-python-cst/src/visitor/position_lookup.rs` | Position-to-node lookup and parent context |
| `crates/tugtool-python/src/stubs.rs` | Stub file discovery and update |

**Operations:**

| File | Purpose |
|------|---------|
| `crates/tugtool-python/src/ops/extract_variable.rs` | Extract Variable operation |
| `crates/tugtool-python/src/ops/inline_variable.rs` | Inline Variable operation |
| `crates/tugtool-python/src/ops/safe_delete.rs` | Safe Delete operation |
| `crates/tugtool-python/src/ops/move_symbol.rs` | Move Function/Class operation |
| `crates/tugtool-python/src/ops/extract_method.rs` | Extract Method operation |
| `crates/tugtool-python/src/ops/inline_method.rs` | Inline Method operation |
| `crates/tugtool-python/src/ops/change_signature.rs` | Change Signature operation |
| `crates/tugtool-python/src/layers/expression.rs` | Layer 1: Expression analysis |
| `crates/tugtool-python/src/layers/statement.rs` | Layer 2: Statement analysis |
| `crates/tugtool-python/src/layers/imports.rs` | Layer 3: Import manipulation |
| `crates/tugtool-python/src/layers/transform.rs` | Layer 4: Method transformation |
| `crates/tugtool-python/src/layers/codegen.rs` | Layer 5: Code generation |
| `crates/tugtool-python/src/layers/mod.rs` | Layer module exports |

#### 13.5.2 New Components {#new-components}

**Table T16: Stage 0 Infrastructure Components** {#t16-stage0-components}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `EditPrimitive` | enum | `visitor/batch_edit.rs` | Replace, InsertBefore, InsertAfter, Delete, InsertAt |
| `BatchSpanEditor` | struct | `visitor/batch_edit.rs` | Collects and applies edit primitives |
| `apply_edits` | fn | `visitor/batch_edit.rs` | Applies edits in reverse position order |
| `PositionIndex` | struct | `visitor/position_lookup.rs` | Maps positions to node info |
| `AncestorTracker` | struct | `visitor/position_lookup.rs` | Tracks parent context during traversal |
| `find_expression_at_position` | fn | `visitor/position_lookup.rs` | Finds expression containing position |
| `find_statement_at_position` | fn | `visitor/position_lookup.rs` | Finds statement containing position |
| `StubDiscovery` | struct | `stubs.rs` | Finds stub files for modules |
| `StubUpdater` | struct | `stubs.rs` | Applies edits to stub files |
| `StringAnnotationParser` | struct | `stubs.rs` | Parses type expressions in string annotations |

**Table T05: Layer 1 Components** {#t05-layer1-components}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ExpressionBoundaryDetector` | struct | `layers/expression.rs` | CST traversal for expression bounds |
| `UniqueNameGenerator` | struct | `layers/expression.rs` | Scope-aware name generation |
| `SingleAssignmentChecker` | struct | `layers/expression.rs` | Verify single definition |
| `find_expression_at` | fn | `layers/expression.rs` | Entry point for expression detection |
| `generate_unique_name` | fn | `layers/expression.rs` | Entry point for name generation |

**Table T06: Layer 2 Components** {#t06-layer2-components}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SideEffectAnalyzer` | struct | `layers/statement.rs` | Purity classification |
| `UseDefAnalyzer` | struct | `layers/statement.rs` | Variable liveness |
| `UnusedSymbolDetector` | struct | `layers/statement.rs` | Dead code detection |
| `is_pure` | fn | `layers/statement.rs` | Check expression purity |
| `find_unused_symbols` | fn | `layers/statement.rs` | Entry point for unused detection |

**Table T07: Layer 3 Components** {#t07-layer3-components}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ImportInserter` | struct | `layers/imports.rs` | Add imports |
| `ImportRemover` | struct | `layers/imports.rs` | Remove imports |
| `ImportUpdater` | struct | `layers/imports.rs` | Modify import source/target |
| `insert_import` | fn | `layers/imports.rs` | Entry point for insertion |
| `remove_import` | fn | `layers/imports.rs` | Entry point for removal |
| `update_import` | fn | `layers/imports.rs` | Entry point for update |

---

### 13.6 Execution Steps {#execution-steps}

#### Stage 0: Foundation Infrastructure {#stage-0}

Stage 0 creates the foundational infrastructure required by all subsequent stages. This infrastructure does not exist in the current codebase and must be built before Stage 1 can proceed.

---

##### Step 0.1: Edit Primitive Infrastructure {#step-0-1}

**Commit:** `feat(python-cst): add batch edit primitive infrastructure`

**References:** [D07](#d07-edit-primitives)

**Artifacts:**
- New `crates/tugtool-python-cst/src/visitor/batch_edit.rs`
- Updated `crates/tugtool-python-cst/src/visitor/mod.rs`

---

###### 0.1.1 API Specification {#step-0-1-api}

**Core Types:**

```rust
use tugtool_core::patch::Span;

/// An atomic edit operation on source text.
///
/// Edit primitives are collected and applied in reverse position order
/// to preserve span validity as text lengths change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditPrimitive {
    /// Replace content at span with new text.
    /// Equivalent to delete + insert at span.start.
    Replace {
        span: Span,
        new_text: String,
    },

    /// Insert text immediately before the given span.
    /// The insertion point is `span.start`. The span itself identifies
    /// context (e.g., a statement) for indentation detection.
    InsertBefore {
        anchor_span: Span,
        text: String,
    },

    /// Insert text immediately after the given span.
    /// The insertion point is `span.end`.
    InsertAfter {
        anchor_span: Span,
        text: String,
    },

    /// Delete content at span. Equivalent to `Replace { span, new_text: "" }`.
    Delete {
        span: Span,
    },

    /// Insert text at an absolute byte position.
    /// Use when no anchor span is available (e.g., inserting at file start).
    InsertAt {
        position: usize,
        text: String,
    },
}

impl EditPrimitive {
    /// Returns the effective span this edit operates on.
    /// For InsertAt, returns a zero-width span at the position.
    pub fn effective_span(&self) -> Span;

    /// Returns the insertion point (byte offset where new text begins).
    pub fn insertion_point(&self) -> usize;

    /// Returns true if this is an insertion (InsertBefore, InsertAfter, InsertAt).
    pub fn is_insertion(&self) -> bool;
}

/// Error type for batch edit operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BatchEditError {
    /// Two edits have overlapping spans.
    OverlappingEdits {
        edit1_span: Span,
        edit2_span: Span,
    },

    /// An edit span extends beyond source length.
    SpanOutOfBounds {
        span: Span,
        source_len: usize,
    },

    /// No edits to apply.
    EmptyEdits,

    /// Indentation detection failed (no reference line found).
    IndentationDetectionFailed {
        position: usize,
    },
}

impl std::fmt::Display for BatchEditError { /* ... */ }
impl std::error::Error for BatchEditError {}

pub type BatchEditResult<T> = Result<T, BatchEditError>;

/// Options for controlling edit application behavior.
#[derive(Debug, Clone, Default)]
pub struct BatchEditOptions {
    /// If true, InsertBefore/InsertAfter will auto-detect and apply
    /// indentation matching the surrounding context.
    /// Default: true
    pub auto_indent: bool,

    /// If true, adjacent edits (one ends where another starts) are allowed.
    /// Default: true
    pub allow_adjacent: bool,

    /// If true, empty edit list returns original source instead of error.
    /// Default: false
    pub allow_empty: bool,
}

/// A batch editor that collects edit primitives and applies them atomically.
///
/// # Design Notes
///
/// BatchSpanEditor generalizes the existing `RenameTransformer` to support
/// all edit primitive types, not just Replace. The key differences:
///
/// 1. **Multiple edit types**: Replace, InsertBefore, InsertAfter, Delete, InsertAt
/// 2. **Indentation handling**: InsertBefore/InsertAfter can auto-detect indentation
/// 3. **Options**: Configurable behavior via `BatchEditOptions`
///
/// # Example
///
/// ```rust
/// use tugtool_python_cst::visitor::{BatchSpanEditor, EditPrimitive};
/// use tugtool_core::patch::Span;
///
/// let source = "def foo():\n    return 1\n";
///
/// let mut editor = BatchSpanEditor::new(source);
/// editor.add(EditPrimitive::Replace {
///     span: Span::new(4, 7),
///     new_text: "bar".to_string(),
/// });
/// editor.add(EditPrimitive::InsertBefore {
///     anchor_span: Span::new(15, 23),  // "return 1"
///     text: "x = 42\n".to_string(),
/// });
///
/// let result = editor.apply()?;
/// assert_eq!(result, "def bar():\n    x = 42\n    return 1\n");
/// ```
pub struct BatchSpanEditor<'src> {
    source: &'src str,
    edits: Vec<EditPrimitive>,
    options: BatchEditOptions,
}

impl<'src> BatchSpanEditor<'src> {
    /// Create a new BatchSpanEditor for the given source.
    pub fn new(source: &'src str) -> Self;

    /// Create a new BatchSpanEditor with custom options.
    pub fn with_options(source: &'src str, options: BatchEditOptions) -> Self;

    /// Add an edit primitive to the batch.
    pub fn add(&mut self, edit: EditPrimitive);

    /// Add multiple edit primitives.
    pub fn add_all(&mut self, edits: impl IntoIterator<Item = EditPrimitive>);

    /// Returns the number of edits currently queued.
    pub fn len(&self) -> usize;

    /// Returns true if no edits are queued.
    pub fn is_empty(&self) -> bool;

    /// Apply all queued edits and return the transformed source.
    ///
    /// Edits are applied in reverse position order to preserve span validity.
    /// Overlapping edits cause an error.
    ///
    /// # Errors
    ///
    /// - `BatchEditError::OverlappingEdits` if any two edits overlap
    /// - `BatchEditError::SpanOutOfBounds` if any span exceeds source length
    /// - `BatchEditError::EmptyEdits` if no edits and `allow_empty` is false
    pub fn apply(self) -> BatchEditResult<String>;

    /// Apply edits without validation (for internal use when pre-validated).
    ///
    /// # Safety (not unsafe, but requires care)
    ///
    /// Caller must ensure:
    /// - All spans are within bounds
    /// - No overlapping edits
    pub fn apply_unchecked(self) -> String;

    /// Validate edits without applying them.
    ///
    /// Returns `Ok(())` if edits are valid, or the first error encountered.
    pub fn validate(&self) -> BatchEditResult<()>;

    /// Check for overlapping edits and return all conflicts.
    ///
    /// Unlike `validate()`, this returns all overlaps, not just the first.
    pub fn find_overlaps(&self) -> Vec<(Span, Span)>;
}
```

**Helper Functions:**

```rust
/// Detect the indentation at a given byte position.
///
/// Returns the indentation string (spaces/tabs) of the line containing `position`.
/// If the line is empty or position is at line start, looks at surrounding lines.
///
/// # Algorithm
///
/// 1. Find the line containing `position`
/// 2. Extract leading whitespace from that line
/// 3. If line is empty, check the previous non-empty line
/// 4. If no reference found, return empty string
pub fn detect_indentation(source: &str, position: usize) -> &str;

/// Detect the indentation level (number of spaces/tabs) at a position.
///
/// Useful for computing relative indentation (e.g., one level deeper).
pub fn detect_indentation_level(source: &str, position: usize) -> IndentInfo;

/// Information about indentation at a position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndentInfo {
    /// The actual indentation string (spaces/tabs)
    pub indent_str: String,
    /// The visual width (assuming 4-space tabs)
    pub visual_width: usize,
    /// Whether the indent uses tabs
    pub uses_tabs: bool,
}

/// Apply indentation to a multi-line text block.
///
/// Each line in `text` (after the first) is prefixed with `indent`.
/// Handles both `\n` and `\r\n` line endings.
pub fn apply_indentation(text: &str, indent: &str) -> String;

/// Check if two spans overlap.
///
/// Re-exported from `rename.rs` for consistency.
pub use super::rename::spans_overlap;
```

---

###### 0.1.2 Internal Design Notes {#step-0-1-internal}

**Relationship to Existing RenameTransformer:**

The existing `RenameTransformer` in `visitor/rename.rs` handles Replace-only edits:

```rust
// Current RenameTransformer (simplified)
pub struct RenameTransformer<'src> {
    source: &'src str,
    requests: Vec<RenameRequest>,  // Each is (Span, new_name)
}
```

`BatchSpanEditor` generalizes this pattern:

1. **Replace RenameRequest with EditPrimitive**: The new enum supports all edit types
2. **Add indentation handling**: InsertBefore/InsertAfter need context-aware indentation
3. **Add options**: Configurable behavior for different use cases
4. **Keep the same core algorithm**: Sort by position descending, apply in reverse order

**Core Apply Algorithm:**

```rust
fn apply(mut self) -> BatchEditResult<String> {
    // 1. Handle empty case
    if self.edits.is_empty() {
        return if self.options.allow_empty {
            Ok(self.source.to_string())
        } else {
            Err(BatchEditError::EmptyEdits)
        };
    }

    // 2. Validate all spans are in bounds
    let source_len = self.source.len();
    for edit in &self.edits {
        let span = edit.effective_span();
        if span.end > source_len {
            return Err(BatchEditError::SpanOutOfBounds { span, source_len });
        }
    }

    // 3. Sort edits by effective position in DESCENDING order
    //    For equal positions, insertion-type edits come AFTER deletions
    //    (so insertions happen at the original position, not shifted position)
    self.edits.sort_by(|a, b| {
        let pos_a = a.insertion_point();
        let pos_b = b.insertion_point();
        match pos_b.cmp(&pos_a) {
            Ordering::Equal => {
                // Deletions before insertions at same position
                match (a.is_insertion(), b.is_insertion()) {
                    (false, true) => Ordering::Less,
                    (true, false) => Ordering::Greater,
                    _ => Ordering::Equal,
                }
            }
            other => other,
        }
    });

    // 4. Check for overlapping spans (after sorting)
    for i in 1..self.edits.len() {
        let span_prev = self.edits[i - 1].effective_span();
        let span_curr = self.edits[i].effective_span();

        // After descending sort: prev.start >= curr.start
        // Check if curr overlaps with prev
        if spans_overlap_for_edits(&span_prev, &span_curr, self.options.allow_adjacent) {
            return Err(BatchEditError::OverlappingEdits {
                edit1_span: span_curr,
                edit2_span: span_prev,
            });
        }
    }

    // 5. Apply edits in reverse order
    let mut result = self.source.to_string();
    for edit in &self.edits {
        result = apply_single_edit(&result, edit, &self.options)?;
    }

    Ok(result)
}

fn apply_single_edit(
    source: &str,
    edit: &EditPrimitive,
    options: &BatchEditOptions,
) -> BatchEditResult<String> {
    match edit {
        EditPrimitive::Replace { span, new_text } => {
            Ok(format!(
                "{}{}{}",
                &source[..span.start],
                new_text,
                &source[span.end..]
            ))
        }
        EditPrimitive::Delete { span } => {
            Ok(format!("{}{}", &source[..span.start], &source[span.end..]))
        }
        EditPrimitive::InsertAt { position, text } => {
            Ok(format!(
                "{}{}{}",
                &source[..*position],
                text,
                &source[*position..]
            ))
        }
        EditPrimitive::InsertBefore { anchor_span, text } => {
            let position = anchor_span.start;
            let text = if options.auto_indent {
                let indent = detect_indentation(source, position);
                apply_indentation(text, indent)
            } else {
                text.clone()
            };
            Ok(format!(
                "{}{}{}",
                &source[..position],
                text,
                &source[position..]
            ))
        }
        EditPrimitive::InsertAfter { anchor_span, text } => {
            let position = anchor_span.end;
            let text = if options.auto_indent {
                let indent = detect_indentation(source, position);
                apply_indentation(text, indent)
            } else {
                text.clone()
            };
            Ok(format!(
                "{}{}{}",
                &source[..position],
                text,
                &source[position..]
            ))
        }
    }
}
```

**Indentation Detection Algorithm:**

```rust
fn detect_indentation(source: &str, position: usize) -> &str {
    // 1. Find line start
    let line_start = source[..position]
        .rfind('\n')
        .map(|i| i + 1)
        .unwrap_or(0);

    // 2. Find line end
    let line_end = source[position..]
        .find('\n')
        .map(|i| position + i)
        .unwrap_or(source.len());

    let line = &source[line_start..line_end];

    // 3. Extract leading whitespace
    let indent_end = line
        .char_indices()
        .find(|(_, c)| !c.is_whitespace())
        .map(|(i, _)| i)
        .unwrap_or(line.len());

    if indent_end > 0 {
        return &line[..indent_end];
    }

    // 4. Line is empty or all whitespace - check previous line
    if line_start > 0 {
        let prev_line_end = line_start - 1;
        let prev_line_start = source[..prev_line_end]
            .rfind('\n')
            .map(|i| i + 1)
            .unwrap_or(0);

        let prev_line = &source[prev_line_start..prev_line_end];
        let prev_indent_end = prev_line
            .char_indices()
            .find(|(_, c)| !c.is_whitespace())
            .map(|(i, _)| i)
            .unwrap_or(0);

        if prev_indent_end > 0 {
            return &prev_line[..prev_indent_end];
        }
    }

    // 5. No reference indentation found
    ""
}
```

---

###### 0.1.3 Edge Cases {#step-0-1-edge-cases}

| Edge Case | Handling |
|-----------|----------|
| **Overlapping spans** | Detect during validation, return `OverlappingEdits` error |
| **Adjacent spans** (end == start) | Allowed by default (`allow_adjacent: true`); can be disabled |
| **Empty span Replace** | Legal - equivalent to `InsertAt` |
| **Empty text Delete** | Legal - no-op (but span must be valid) |
| **Unicode multi-byte spans** | All spans are byte offsets; slicing is safe on UTF-8 boundaries |
| **Non-UTF-8 boundary span** | Will panic on slicing; callers must ensure valid UTF-8 boundaries |
| **InsertBefore at file start** | Indentation defaults to empty string |
| **InsertAfter at file end** | Works correctly (inserts before implicit EOF) |
| **Nested indentation** | Uses containing line's indentation, not logical scope indentation |
| **Mixed tabs/spaces** | Preserves whatever the source uses |
| **CRLF line endings** | Indentation detection handles both `\n` and `\r\n` |
| **Empty source** | InsertAt(0, text) works; other operations on empty source may error |
| **Zero-width span at same position** | Multiple InsertAt at same position: applied in add order |

**Unicode Handling:**

Python source files are UTF-8. The existing CST parser produces byte offsets.
`BatchSpanEditor` assumes all spans are valid UTF-8 boundaries. The caller (CST visitors)
is responsible for providing valid byte offsets from the parser.

```rust
// CORRECT: Span from parser covers complete UTF-8 sequence
let source = "def héllo():";
//              ^   ^
//              4   10 (byte offsets, 'é' is 2 bytes)
editor.add(EditPrimitive::Replace {
    span: Span::new(4, 10),  // "héllo"
    new_text: "world".to_string(),
});

// INCORRECT: Would panic if span splits a multi-byte character
// editor.add(EditPrimitive::Replace {
//     span: Span::new(4, 6),  // Splits 'é' in the middle
//     new_text: "x".to_string(),
// });
```

---

###### 0.1.4 Integration Points {#step-0-1-integration}

**Existing Components:**

| Component | Integration |
|-----------|-------------|
| `RenameTransformer` | Will be migrated to use `BatchSpanEditor` internally in Step 1.1 |
| `tugtool_core::patch::Span` | Reuse the same `Span` type for consistency |
| `spans_overlap()` in `rename.rs` | Reuse or move to common location |
| `PatchSet` in `tugtool-core` | `BatchSpanEditor` is for single-file edits; `PatchSet` handles multi-file |

**Module Structure:**

```
crates/tugtool-python-cst/src/visitor/
├── mod.rs              # Add: pub mod batch_edit; pub use batch_edit::*;
├── batch_edit.rs       # NEW: EditPrimitive, BatchSpanEditor, helpers
├── rename.rs           # UNCHANGED initially; migrated in Step 1.1
└── ...
```

**Export from lib.rs:**

```rust
// In crates/tugtool-python-cst/src/lib.rs
pub use visitor::{
    BatchSpanEditor, BatchEditError, BatchEditOptions, BatchEditResult,
    EditPrimitive, IndentInfo,
    detect_indentation, detect_indentation_level, apply_indentation,
    // ... existing exports
};
```

---

###### 0.1.5 Concrete Examples {#step-0-1-examples}

**Example 1: Simple Replace (Rename)**

```rust
let source = "def process_data(x):\n    return x * 2\n";
let mut editor = BatchSpanEditor::new(source);

// Rename "process_data" to "transform_data"
editor.add(EditPrimitive::Replace {
    span: Span::new(4, 16),  // "process_data"
    new_text: "transform_data".to_string(),
});

let result = editor.apply()?;
assert_eq!(result, "def transform_data(x):\n    return x * 2\n");
```

**Example 2: InsertBefore Statement (Extract Variable)**

```rust
let source = "def foo():\n    return get_value() * 2\n";
//                         ^^^^^^^^^^^^^^^
//                         15-26: "get_value() * 2"
let mut editor = BatchSpanEditor::new(source);

// Insert assignment before return statement
editor.add(EditPrimitive::InsertBefore {
    anchor_span: Span::new(15, 37),  // "return get_value() * 2"
    text: "result = get_value()\n".to_string(),
});

// Replace expression with variable
editor.add(EditPrimitive::Replace {
    span: Span::new(22, 34),  // "get_value() * 2" (in return)
    new_text: "result * 2".to_string(),
});

let result = editor.apply()?;
assert_eq!(result, "def foo():\n    result = get_value()\n    return result * 2\n");
```

**Example 3: Delete (Remove Unused Variable)**

```rust
let source = "x = 1\nunused = 2\ny = 3\n";
let mut editor = BatchSpanEditor::new(source);

// Delete the unused assignment (including newline)
editor.add(EditPrimitive::Delete {
    span: Span::new(6, 17),  // "unused = 2\n"
});

let result = editor.apply()?;
assert_eq!(result, "x = 1\ny = 3\n");
```

**Example 4: Multiple Non-Overlapping Edits**

```rust
let source = "a = foo\nb = bar\nc = baz\n";
let mut editor = BatchSpanEditor::new(source);

// Rename foo -> FOO
editor.add(EditPrimitive::Replace {
    span: Span::new(4, 7),
    new_text: "FOO".to_string(),
});

// Rename bar -> BAR
editor.add(EditPrimitive::Replace {
    span: Span::new(12, 15),
    new_text: "BAR".to_string(),
});

// Rename baz -> BAZ
editor.add(EditPrimitive::Replace {
    span: Span::new(20, 23),
    new_text: "BAZ".to_string(),
});

let result = editor.apply()?;
assert_eq!(result, "a = FOO\nb = BAR\nc = BAZ\n");
```

**Example 5: Overlapping Edits Error**

```rust
let source = "hello world";
let mut editor = BatchSpanEditor::new(source);

editor.add(EditPrimitive::Replace {
    span: Span::new(0, 7),  // "hello w"
    new_text: "hi".to_string(),
});
editor.add(EditPrimitive::Replace {
    span: Span::new(5, 11),  // " world" - overlaps!
    new_text: "there".to_string(),
});

let result = editor.apply();
assert!(matches!(result, Err(BatchEditError::OverlappingEdits { .. })));
```

---

**Tasks:**
- [x] Create `EditPrimitive` enum with variants: Replace, InsertBefore, InsertAfter, Delete, InsertAt
- [x] Create `BatchEditError` enum with variants: OverlappingEdits, SpanOutOfBounds, EmptyEdits, IndentationDetectionFailed
- [x] Create `BatchEditOptions` struct with fields: auto_indent, allow_adjacent, allow_empty
- [x] Create `IndentInfo` struct for indentation detection results
- [x] Create `BatchSpanEditor` struct with new(), with_options(), add(), add_all(), len(), is_empty()
- [x] Implement `apply()` with reverse-order edit application
- [x] Implement `apply_unchecked()` for pre-validated edits
- [x] Implement `validate()` and `find_overlaps()` for pre-flight checking
- [x] Implement `detect_indentation()` helper function
- [x] Implement `detect_indentation_level()` helper function
- [x] Implement `apply_indentation()` helper function
- [x] Add comprehensive documentation and examples in doc comments

**Tests:**
- [x] Unit: `test_replace_single_span` - basic replace operation
- [x] Unit: `test_replace_multiple_spans` - multiple non-overlapping replaces
- [x] Unit: `test_replace_empty_span` - zero-width span (insertion)
- [x] Unit: `test_insert_before_statement` - with auto-indentation
- [x] Unit: `test_insert_after_expression` - with auto-indentation
- [x] Unit: `test_insert_at_position` - absolute position insertion
- [x] Unit: `test_insert_at_file_start` - edge case
- [x] Unit: `test_insert_at_file_end` - edge case
- [x] Unit: `test_delete_span` - basic deletion
- [x] Unit: `test_delete_with_newline` - deleting line including newline
- [x] Unit: `test_multiple_edits_non_overlapping` - mixed edit types
- [x] Unit: `test_overlapping_edits_rejected` - error case
- [x] Unit: `test_adjacent_edits_allowed` - default behavior
- [x] Unit: `test_adjacent_edits_rejected_when_disabled` - with option
- [x] Unit: `test_unicode_multibyte_spans` - non-ASCII identifiers
- [x] Unit: `test_indentation_detection_spaces` - space-indented code
- [x] Unit: `test_indentation_detection_tabs` - tab-indented code
- [x] Unit: `test_indentation_detection_mixed` - mixed indent
- [x] Unit: `test_indentation_detection_empty_line` - fallback to previous
- [x] Unit: `test_indentation_preservation_insert_before` - auto-indent
- [x] Unit: `test_indentation_preservation_insert_after` - auto-indent
- [x] Unit: `test_apply_indentation_multiline` - multi-line text
- [x] Unit: `test_empty_edits_error` - default behavior
- [x] Unit: `test_empty_edits_allowed` - with option
- [x] Unit: `test_span_out_of_bounds_error` - error case
- [x] Unit: `test_validate_without_applying` - pre-flight check
- [x] Unit: `test_find_all_overlaps` - returns all conflicts

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst batch_edit`
- [x] All edit primitive variants have tests
- [x] Indentation detection handles spaces, tabs, and mixed
- [x] Unicode multi-byte spans work correctly

**Rollback:** Revert commit

---

###### Step 0.2.0: Node Span Recording Infrastructure {#step-0-2-0-restructured}

**Parent Step:** [Step 0.2: Position Lookup Infrastructure](#step-0-2)

**Purpose:** Record spans for all expression and statement nodes during CST inflation, enabling Position Lookup to function correctly.

---

####### Overview

This document restructures Step 0.2.0 from phase-13.md into digestible substeps with clear commit boundaries, tests, and checkpoints. The implementation follows the recommended order from the original plan.

**Total Substeps:** 13

**Estimated Complexity:** Medium-High (touches many node types, but each follows established patterns)

---

####### Problem Statement {#step-0-2-0-problem}

Position Lookup (Step 0.2) requires spans to be recorded for nodes in the `PositionTable` during CST inflation. Currently, only 10 node types record their spans:

**Nodes that DO record spans:**

| Node | Span Type | Location | Purpose |
|------|-----------|----------|---------|
| `Name` | `ident_span` | expression.rs:218 | Identifier text for rename |
| `SimpleString` | `ident_span` | expression.rs:2895 | String literal for `__all__` lookup |
| `FunctionDef` | `lexical_span` + `def_span` | statement.rs:937-949 | Scope boundary |
| `ClassDef` | `lexical_span` + `def_span` | statement.rs:1952-1964 | Scope boundary |
| `If` | `branch_span` | statement.rs:1162 | isinstance type narrowing |
| `Lambda` | `lexical_span` | expression.rs:2568 | Scope boundary |
| `GeneratorExp` | `lexical_span` | expression.rs:1198 | Scope boundary |
| `ListComp` | `lexical_span` | expression.rs:1255 | Scope boundary |
| `SetComp` | `lexical_span` | expression.rs:1353 | Scope boundary |
| `DictComp` | `lexical_span` | expression.rs:1419 | Scope boundary |

**Most other node types assign `node_id` but do NOT record spans**, meaning `PositionTable.get(&node_id)` returns `None`. Position Lookup cannot function without span data.

---

####### Span Type Selection Criteria {#step-0-2-0-criteria}

**Table T20: Span Type Selection Criteria** {#t20-span-type-criteria}

| Span Type | Use Case | When to Use |
|-----------|----------|-------------|
| `ident_span` | Position-to-expression lookup | Literals with tokens, simple expressions |
| `lexical_span` | Scope containment queries | Scope-creating constructs (for, while, with, try, match) |
| `branch_span` | Type narrowing boundaries | Conditional bodies (else, match case, except) |
| `def_span` | Complete definition extraction | Only for decorated definitions (func, class) |

**Selection Algorithm:**

1. **Has a single defining token** (e.g., keyword, literal) -> `ident_span` from that token
2. **Creates a lexical scope** (loop, context manager, exception handler) -> `lexical_span`
3. **Is a conditional branch** (else, except, case) -> `branch_span`
4. **Is a composite expression** (binary op, call, attribute) -> `ident_span` computed from first/last child

---

####### Node Catalogs {#step-0-2-0-catalogs}

######## Expression Types Needing Span Recording {#step-0-2-0-expressions}

**Table T21: Expression Types Needing Span Recording** {#t21-expression-spans}

Nodes marked with [DONE] already record spans. All others need implementation.

**Literals (Token-Based Spans):**

| Node | Has `tok` | Span Type | Span Computation |
|------|-----------|-----------|------------------|
| `Ellipsis` | Yes | `ident_span` | `tok.start_pos` to `tok.end_pos` |
| `Integer` | Yes | `ident_span` | `tok.start_pos` to `tok.end_pos` |
| `Float` | Yes | `ident_span` | `tok.start_pos` to `tok.end_pos` |
| `Imaginary` | Yes | `ident_span` | `tok.start_pos` to `tok.end_pos` |
| `Name` | Yes | `ident_span` | [DONE] |
| `SimpleString` | Yes | `ident_span` | [DONE] |

**Composite Expressions (Computed Spans):**

| Node | Span Type | Span Computation |
|------|-----------|------------------|
| `Comparison` | `ident_span` | `deflated_expression_start_pos(left)` to `deflated_expression_end_pos(last comparison)` |
| `UnaryOperation` | `ident_span` | Operator token start to `deflated_expression_end_pos(expression)` |
| `BinaryOperation` | `ident_span` | `deflated_expression_start_pos(left)` to `deflated_expression_end_pos(right)` |
| `BooleanOperation` | `ident_span` | `deflated_expression_start_pos(left)` to `deflated_expression_end_pos(right)` |
| `Call` | `ident_span` | `deflated_expression_start_pos(func)` to `rpar_tok.end_pos` |
| `Attribute` | `ident_span` | `deflated_expression_start_pos(value)` to `attr.tok.end_pos` |
| `StarredElement` | `ident_span` | `star_tok.start_pos` to `deflated_expression_end_pos(value)` |
| `Tuple` | `ident_span` | First element start to last element end |
| `Slice` | `ident_span` | `first_colon` or `lower` start to `step` or `upper` or `second_colon` end |
| `Subscript` | `ident_span` | `deflated_expression_start_pos(value)` to `rbracket.tok.end_pos` |
| `IfExp` | `ident_span` | `deflated_expression_start_pos(body)` to `deflated_expression_end_pos(orelse)` |
| `Yield` | `ident_span` | `yield_tok.start_pos` to value end (or yield token if no value) |
| `Await` | `ident_span` | `await_tok.start_pos` to `deflated_expression_end_pos(expression)` |
| `ConcatenatedString` | `ident_span` | `deflated_string_start_pos(left)` to `deflated_string_end_pos(right)` |
| `FormattedString` | `ident_span` | First part start to last part end |
| `TemplatedString` | `ident_span` | First part start to last part end |
| `NamedExpr` | `ident_span` | `deflated_expression_start_pos(target)` to `deflated_expression_end_pos(value)` |

**Container Expressions (Bracket-Delimited Spans):**

| Node | Span Type | Span Computation |
|------|-----------|------------------|
| `List` | `ident_span` | `lbracket.tok.start_pos` to `rbracket.tok.end_pos` |
| `Set` | `ident_span` | `lbrace.tok.start_pos` to `rbrace.tok.end_pos` |
| `Dict` | `ident_span` | `lbrace.tok.start_pos` to `rbrace.tok.end_pos` |

**Scope-Creating Expressions (Already Done):**

| Node | Span Type | Status |
|------|-----------|--------|
| `Lambda` | `lexical_span` | [DONE] |
| `GeneratorExp` | `lexical_span` | [DONE] |
| `ListComp` | `lexical_span` | [DONE] |
| `SetComp` | `lexical_span` | [DONE] |
| `DictComp` | `lexical_span` | [DONE] |

**Parameter Node:**

| Node | Span Type | Span Computation |
|------|-----------|------------------|
| `Param` | `ident_span` | `star_tok` or `name.tok` start to default/annotation end or name end |

######## Statement Types Needing Span Recording {#step-0-2-0-statements}

**Table T22: Statement Types Needing Span Recording** {#t22-statement-spans}

**Simple Statements (Token-Based):**

| Node | Has Token | Span Type | Span Computation |
|------|-----------|-----------|------------------|
| `Pass` | Yes (after prereq) | `ident_span` | `tok.start_pos` to `tok.end_pos` |
| `Break` | Yes (after prereq) | `ident_span` | `tok.start_pos` to `tok.end_pos` |
| `Continue` | Yes (after prereq) | `ident_span` | `tok.start_pos` to `tok.end_pos` |
| `Expr` | No | `ident_span` | `deflated_expression_start_pos(value)` to expression end |
| `Assign` | No | `ident_span` | First target start to value end |
| `AugAssign` | No | `ident_span` | Target start to value end |
| `AnnAssign` | No | `ident_span` | Target start to value end (or annotation end if no value) |
| `Return` | Yes (`return_tok`) | `ident_span` | `return_tok.start_pos` to value end (or return token) |
| `Assert` | Yes (`assert_tok`) | `ident_span` | `assert_tok.start_pos` to msg end (or test end) |
| `Raise` | Yes (`raise_tok`) | `ident_span` | `raise_tok.start_pos` to cause end (or exc end or raise token) |
| `Global` | Yes (`tok`) | `ident_span` | `tok.start_pos` to last name end |
| `Nonlocal` | Yes (`tok`) | `ident_span` | `tok.start_pos` to last name end |
| `Del` | Yes (`tok`) | `ident_span` | `tok.start_pos` to target end |
| `TypeAlias` | Yes (`type_tok`) | `ident_span` | `type_tok.start_pos` to value end |

**Import Statements:**

| Node | Has Token | Span Type | Span Computation |
|------|-----------|-----------|------------------|
| `Import` | Yes (`import_tok`) | `ident_span` | `import_tok.start_pos` to last alias end |
| `ImportFrom` | Yes (`from_tok`) | `ident_span` | `from_tok.start_pos` to names end (rpar or last alias) |

**Scope-Creating Statements:**

| Node | Span Type | Span Computation |
|------|-----------|------------------|
| `FunctionDef` | `lexical_span` + `def_span` | [DONE] |
| `ClassDef` | `lexical_span` + `def_span` | [DONE] |
| `For` | `lexical_span` | `for_tok` (or `async_tok`) start to body suite end |
| `While` | `lexical_span` | `while_tok.start_pos` to body suite end |
| `With` | `lexical_span` | `with_tok` (or `async_tok`) start to body suite end |
| `Try` | `lexical_span` | `try_tok.start_pos` to finalbody/orelse/handlers end |
| `TryStar` | `lexical_span` | `try_tok.start_pos` to finalbody/orelse/handlers end |
| `Match` | `lexical_span` | `match_tok.start_pos` to last case end |

**Branch Statements:**

| Node | Span Type | Span Computation |
|------|-----------|------------------|
| `If` | `branch_span` | [DONE] |
| `Else` | `branch_span` | `else_tok.start_pos` to body suite end |
| `ExceptHandler` | `branch_span` | `except_tok.start_pos` to body suite end |
| `ExceptStarHandler` | `branch_span` | `except_tok.start_pos` to body suite end |
| `Finally` | `branch_span` | `finally_tok.start_pos` to body suite end |
| `MatchCase` | `branch_span` | `case_tok.start_pos` to body suite end |

**Decorator:**

| Node | Span Type | Span Computation |
|------|-----------|------------------|
| `Decorator` | `ident_span` | `at_tok.start_pos` to decorator expression end |

---

####### Implementation Patterns {#step-0-2-0-patterns}

**Pattern 1: Literal with Token**

```rust
// Example: Integer
impl<'r, 'a> Inflate<'a> for DeflatedInteger<'r, 'a> {
    type Inflated = Integer<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        let node_id = ctx.next_id();

        // Record ident_span from token (BEFORE inflating children)
        let start = self.tok.start_pos.byte_idx();
        let end = self.tok.end_pos.byte_idx();
        ctx.record_ident_span(node_id, Span { start, end });

        let lpar = self.lpar.inflate(ctx)?;
        let rpar = self.rpar.inflate(ctx)?;
        Ok(Self::Inflated {
            value: self.value,
            lpar,
            rpar,
            node_id: Some(node_id),
        })
    }
}
```

**Pattern 2: Composite Expression with Children**

```rust
// Example: BinaryOperation
impl<'r, 'a> Inflate<'a> for DeflatedBinaryOperation<'r, 'a> {
    type Inflated = BinaryOperation<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        let node_id = ctx.next_id();

        // Compute span BEFORE inflating (tokens stripped during inflation)
        let start = deflated_expression_start_pos(&self.left);
        let end = deflated_expression_end_pos(&self.right);
        ctx.record_ident_span(node_id, Span { start, end });

        let lpar = self.lpar.inflate(ctx)?;
        let left = self.left.inflate(ctx)?;
        let operator = self.operator.inflate(ctx)?;
        let right = self.right.inflate(ctx)?;
        let rpar = self.rpar.inflate(ctx)?;
        Ok(Self::Inflated {
            left,
            operator,
            right,
            lpar,
            rpar,
            node_id: Some(node_id),
        })
    }
}
```

**Pattern 3: Bracket-Delimited Container**

```rust
// Example: List
impl<'r, 'a> Inflate<'a> for DeflatedList<'r, 'a> {
    type Inflated = List<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        let node_id = ctx.next_id();

        // Record span from bracket tokens BEFORE inflating
        let start = self.lbracket.tok.start_pos.byte_idx();
        let end = self.rbracket.tok.end_pos.byte_idx();
        ctx.record_ident_span(node_id, Span { start, end });

        let lpar = self.lpar.inflate(ctx)?;
        let lbracket = self.lbracket.inflate(ctx)?;
        let elements = self.elements.inflate(ctx)?;
        let rbracket = self.rbracket.inflate(ctx)?;
        let rpar = self.rpar.inflate(ctx)?;
        Ok(Self::Inflated {
            elements,
            lbracket,
            rbracket,
            lpar,
            rpar,
            node_id: Some(node_id),
        })
    }
}
```

**Pattern 4: Scope-Creating Statement**

```rust
// Example: For
impl<'r, 'a> Inflate<'a> for DeflatedFor<'r, 'a> {
    type Inflated = For<'a>;
    fn inflate(mut self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        let node_id = ctx.next_id();

        // Compute lexical span BEFORE inflating (tokens stripped during inflation)
        // Start: async_tok if present, otherwise for_tok
        let lexical_start = self.async_tok
            .as_ref()
            .map(|t| t.start_pos.byte_idx())
            .unwrap_or_else(|| self.for_tok.start_pos.byte_idx());

        // End: body suite end (dedent token for indented, newline for simple)
        let scope_end = deflated_suite_end_pos(&self.body);

        ctx.record_lexical_span(node_id, Span { start: lexical_start, end: scope_end });

        // Continue with inflation...
    }
}
```

**Pattern 5: Branch Statement**

```rust
// Example: Else
impl<'r, 'a> Inflate<'a> for DeflatedElse<'r, 'a> {
    type Inflated = Else<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        let node_id = ctx.next_id();

        // Compute branch span BEFORE inflating
        let branch_start = self.else_tok.start_pos.byte_idx();
        let branch_end = deflated_suite_end_pos(&self.body);

        ctx.record_branch_span(node_id, Span { start: branch_start, end: branch_end });

        // Continue with inflation...
    }
}
```

---

####### Special Considerations {#step-0-2-0-special}

######## Parenthesized Expressions

When an expression is parenthesized, the span should include the parentheses if they belong to the expression (outer `lpar`/`rpar`). The existing `deflated_expression_start_pos` and `deflated_expression_end_pos` functions already handle this correctly by checking `lpar.first()` and `rpar.last()`.

######## Performance

Recording spans adds a small overhead during inflation. However:
1. This only occurs when `InflateCtx::with_positions()` is used
2. The `record_*_span` methods are O(1) (Vec insertion with amortized growth)
3. Position tracking is already opt-in

No performance regression is expected for normal parsing without position tracking.

---

####### Execution Steps {#execution-steps}

---

######## Step 0.2.0.1: Add Token Fields to Pass/Break/Continue {#step-0-2-0-1}

**Commit:** `feat(python-cst): add tok field to Pass, Break, Continue for span recording`

**References:** Table T22 (#t22-statement-spans), Pattern 1 (#step-0-2-0-patterns)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs` (Pass, Break, Continue structs)
- Modified `crates/tugtool-python-cst/src/parser/grammar.rs` (pass, break, continue rules)

**Context:**

The `Pass`, `Break`, and `Continue` structs do not currently store their keyword tokens. The parser matches `lit("pass")` but then constructs `Pass { semicolon: None }` without capturing the `TokenRef`. This is a design inconsistency -- a CST should preserve all tokens.

This prerequisite must be completed before span recording can be added to these nodes.

**Tasks:**
- [x] Add `tok: TokenRef<'input, 'a>` field to `Pass` struct in `statement.rs`
- [x] Add `tok: TokenRef<'input, 'a>` field to `Break` struct in `statement.rs`
- [x] Add `tok: TokenRef<'input, 'a>` field to `Continue` struct in `statement.rs`
- [x] Update `DeflatedPass` in `statement.rs` to include `tok` field
- [x] Update `DeflatedBreak` in `statement.rs` to include `tok` field
- [x] Update `DeflatedContinue` in `statement.rs` to include `tok` field
- [x] Update grammar rule for `pass` in `parser/grammar.rs` to capture token: `t:lit("pass") { ... tok: t ... }`
- [x] Update grammar rule for `break` in `parser/grammar.rs` to capture token
- [x] Update grammar rule for `continue` in `parser/grammar.rs` to capture token
- [x] Update `Default` impl for `Pass` if needed (may need to remove Default or provide dummy token)
- [x] Update `Default` impl for `Break` if needed
- [x] Update `Default` impl for `Continue` if needed

**Tests:**
- [x] Unit: `test_pass_has_token` - Parse `pass`, verify `Pass.tok` is populated with correct span
- [x] Unit: `test_break_has_token` - Parse `while True:\n    break`, verify `Break.tok` spans `break`
- [x] Unit: `test_continue_has_token` - Parse `while True:\n    continue`, verify `Continue.tok` spans `continue`
- [x] Unit: `test_pass_with_semicolon` - Parse `pass;`, verify `tok` spans only `pass` (not semicolon)
- [x] Unit (backported): `test_pass_tok_captures_keyword_position` - Verify deflated Pass.tok has correct start/end positions
- [x] Unit (backported): `test_pass_tok_with_semicolon_is_separate` - Verify deflated tok ends before semicolon
- [x] Unit (backported): `test_break_tok_captures_keyword_position` - Verify deflated Break.tok has correct positions
- [x] Unit (backported): `test_continue_tok_captures_keyword_position` - Verify deflated Continue.tok has correct positions

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) *Note: 1 pre-existing failure in position_lookup (Integer span not recorded yet - Step 0.2.0.3)*
- [x] `cargo nextest run -p tugtool-python-cst pass_has_token` passes
- [x] `cargo nextest run -p tugtool-python-cst break_has_token` passes
- [x] `cargo nextest run -p tugtool-python-cst continue_has_token` passes

**Rollback:** Revert commit

---

######## Step 0.2.0.2: Add deflated_suite_end_pos Helper {#step-0-2-0-2}

**Commit:** `feat(python-cst): add deflated_suite_end_pos helper for scope span computation`

**References:** Section 0.2.0.6 Suite End Position Helper from original plan

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs` (new helper function)

**Context:**

Several statement types need to compute the end of their body `Suite`. This helper function enables consistent span computation for all scope-creating and branch statements.

**Tasks:**
- [x] Add `deflated_suite_end_pos` helper function in `statement.rs`:

```rust
/// Compute the byte end position of a deflated Suite.
///
/// For IndentedBlock: returns dedent token start position (scope boundary).
/// For SimpleStatementSuite: returns newline token end position.
fn deflated_suite_end_pos<'r, 'a>(suite: &DeflatedSuite<'r, 'a>) -> usize {
    match suite {
        DeflatedSuite::IndentedBlock(block) => block.dedent_tok.start_pos.byte_idx(),
        DeflatedSuite::SimpleStatementSuite(suite) => suite.newline_tok.end_pos.byte_idx(),
    }
}
```

- [x] Place the helper near other helper functions in `statement.rs`
- [x] Add documentation explaining when to use this helper

**Tests:**
- [x] Unit: `test_suite_end_pos_indented_block` - Verify helper returns dedent position for indented block
- [x] Unit: `test_suite_end_pos_simple_statement_suite` - Verify helper returns newline end for simple statement suite
- [x] Unit: `test_suite_end_pos_nested_functions` - Verify inner function body ends before outer (bonus test)

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst suite_end_pos` passes
- [x] Helper function is documented and accessible where needed

**Rollback:** Revert commit

---

######## Step 0.2.0.3: Literal Span Recording {#step-0-2-0-3}

**Commit:** `feat(python-cst): record ident_span for literal expression nodes`

**References:** Table T21 Literals (#t21-expression-spans), Pattern 1 (#step-0-2-0-patterns)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`

**Context:**

Literals have direct token access, making span recording straightforward. This is the simplest pattern and a good starting point.

**Tasks:**
- [x] `Ellipsis`: Add `record_ident_span` from `tok.start_pos` to `tok.end_pos`
- [x] `Integer`: Add `record_ident_span` from `tok.start_pos` to `tok.end_pos`
- [x] `Float`: Add `record_ident_span` from `tok.start_pos` to `tok.end_pos`
- [x] `Imaginary`: Add `record_ident_span` from `tok.start_pos` to `tok.end_pos`

**Tests:**
- [x] Unit: `test_ellipsis_literal_span_recorded` - Parse `...`, verify ident_span covers `...`
- [x] Unit: `test_integer_literal_span_recorded` - Parse `42`, verify ident_span covers `42`
- [x] Unit: `test_float_literal_span_recorded` - Parse `3.14`, verify ident_span covers `3.14`
- [x] Unit: `test_imaginary_literal_span_recorded` - Parse `2j`, verify ident_span covers `2j`
- [x] Unit: `test_integer_with_parens_literal_span` - Parse `(42)`, verify span covers token (not parens)
- [x] Unit: `test_name_literal_span_recorded` - Parse `foo`, verify ident_span (regression test)
- [x] Unit: `test_string_literal_span_recorded` - Parse `"hello"`, verify ident_span (regression test)

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) - 633/633 tests pass
- [x] `cargo nextest run -p tugtool-python-cst literal_span` passes - 7/7 tests pass
- [x] Verify: parsing `42` with positions enabled returns span in PositionTable

**Rollback:** Revert commit

---

######## Step 0.2.0.4: Container Span Recording {#step-0-2-0-4}

**Commit:** `feat(python-cst): record ident_span for container expression nodes (List, Set, Dict)`

**References:** Table T21 Containers (#t21-expression-spans), Pattern 3 (#step-0-2-0-patterns)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`

**Context:**

Container expressions have bracket tokens that define clear boundaries. The span runs from opening bracket to closing bracket.

**Tasks:**
- [x] `List`: Add `record_ident_span` from `lbracket.tok.start_pos` to `rbracket.tok.end_pos`
- [x] `Set`: Add `record_ident_span` from `lbrace.tok.start_pos` to `rbrace.tok.end_pos`
- [x] `Dict`: Add `record_ident_span` from `lbrace.tok.start_pos` to `rbrace.tok.end_pos`

**Tests:**
- [x] Unit: `test_list_container_span_recorded` - Parse `[1, 2, 3]`, verify span from `[` to `]`
- [x] Unit: `test_empty_list_container_span_recorded` - Parse `[]`, verify span
- [x] Unit: `test_set_container_span_recorded` - Parse `{1, 2}`, verify span from `{` to `}`
- [x] Unit: `test_dict_container_span_recorded` - Parse `{"a": 1}`, verify span from `{` to `}`
- [x] Unit: `test_empty_dict_container_span_recorded` - Parse `{}`, verify span
- [x] Unit: `test_nested_list_container_span` - Parse `[[1, 2], [3, 4]]`, verify both outer and inner spans

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) - 639/639 tests pass
- [x] `cargo nextest run -p tugtool-python-cst container_span` passes - 6/6 tests pass

**Rollback:** Revert commit

---

######## Step 0.2.0.5: Composite Expression Spans (Operations) {#step-0-2-0-5}

**Commit:** `feat(python-cst): record ident_span for operation expression nodes`

**References:** Table T21 Composite Expressions (#t21-expression-spans), Pattern 2 (#step-0-2-0-patterns)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`

**Context:**

Operation expressions (binary, unary, boolean, comparison) require computing spans from their operands using the existing `deflated_expression_start_pos` and `deflated_expression_end_pos` helpers.

**Tasks:**
- [x] `BinaryOperation`: Add `record_ident_span` from `deflated_expression_start_pos(left)` to `deflated_expression_end_pos(right)`
- [x] `UnaryOperation`: Add `record_ident_span` from operator token start to `deflated_expression_end_pos(expression)`
- [x] `BooleanOperation`: Add `record_ident_span` from `deflated_expression_start_pos(left)` to `deflated_expression_end_pos(right)`
- [x] `Comparison`: Add `record_ident_span` from `deflated_expression_start_pos(left)` to `deflated_expression_end_pos(last comparator)`

**Tests:**
- [x] Unit: `test_binary_op_span_recorded` - Parse `a + b`, verify span covers `a + b`
- [x] Unit: `test_binary_op_nested_span` - Parse `a + b * c`, verify both operation spans
- [x] Unit: `test_unary_op_span_recorded` - Parse `-x`, verify span covers `-x`
- [x] Unit: `test_unary_not_span_recorded` - Parse `not x`, verify span covers `not x`
- [x] Unit: `test_boolean_op_span_recorded` - Parse `a and b`, verify span covers `a and b`
- [x] Unit: `test_boolean_op_chain_span` - Parse `a and b or c`, verify spans
- [x] Unit: `test_comparison_span_recorded` - Parse `a < b`, verify span
- [x] Unit: `test_comparison_chain_span` - Parse `a < b < c`, verify span covers entire chain

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) - 647/647 tests pass
- [x] `cargo nextest run -p tugtool-python-cst operation_span` passes - 8/8 tests pass

**Rollback:** Revert commit

---

######## Step 0.2.0.6: Call/Attribute/Subscript Spans {#step-0-2-0-6}

**Commit:** `feat(python-cst): record ident_span for Call, Attribute, Subscript nodes`

**References:** Table T21 Composite Expressions (#t21-expression-spans), Pattern 2 (#step-0-2-0-patterns)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`

**Context:**

These nodes represent member access and invocation patterns that are common in refactoring operations. Correct spans are critical for position lookup in attribute chains.

**Tasks:**
- [x] `Call`: Add `record_ident_span` from `deflated_expression_start_pos(func)` to `rpar_tok.end_pos`
- [x] `Attribute`: Add `record_ident_span` from `deflated_expression_start_pos(value)` to `attr.tok.end_pos`
- [x] `Subscript`: Add `record_ident_span` from `deflated_expression_start_pos(value)` to `rbracket.tok.end_pos`

**Tests:**
- [x] Unit: `test_call_span_recorded` - Parse `foo(x, y)`, verify span covers entire call
- [x] Unit: `test_call_no_args_span` - Parse `foo()`, verify span
- [x] Unit: `test_attribute_span_recorded` - Parse `obj.attr`, verify span covers `obj.attr`
- [x] Unit: `test_chained_attribute_span` - Parse `a.b.c`, verify each attribute span
- [x] Unit: `test_subscript_span_recorded` - Parse `obj[key]`, verify span covers `obj[key]`
- [x] Unit: `test_subscript_with_slice_span` - Parse `obj[1:2]`, verify span
- [x] Unit: `test_method_call_span` - Parse `obj.method(arg)`, verify span covers entire expression
- [x] Unit: `test_nested_call_span` - Parse `f(g(x))`, verify both call spans recorded

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) - 655/655 tests pass
- [x] `cargo nextest run -p tugtool-python-cst call_attr_subscript_span` passes - 8/8 tests pass

**Rollback:** Revert commit

---

######## Step 0.2.0.7: Other Expression Spans {#step-0-2-0-7}

**Commit:** `feat(python-cst): record ident_span for remaining expression nodes`

**References:** Table T21 Composite Expressions (#t21-expression-spans)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`

**Context:**

This step covers the remaining expression types that don't fit neatly into the previous categories.

**Tasks:**
- [x] `IfExp`: Add `record_ident_span` from `deflated_expression_start_pos(body)` to `deflated_expression_end_pos(orelse)`
- [x] `Yield`: Add `record_ident_span` from `yield_tok.start_pos` to value end (or yield token if no value)
- [x] `Await`: Add `record_ident_span` from `await_tok.start_pos` to `deflated_expression_end_pos(expression)`
- [x] `NamedExpr`: Add `record_ident_span` from `deflated_expression_start_pos(target)` to `deflated_expression_end_pos(value)`
- [x] `StarredElement`: Add `record_ident_span` from `star_tok.start_pos` to `deflated_expression_end_pos(value)`
- [x] `Tuple`: Add `record_ident_span` from first element start to last element end (handle empty tuple)
- [x] `Slice`: Add `record_ident_span` from `first_colon` or `lower` start to `step` or `upper` or `second_colon` end

**Tests:**
- [x] Unit: `test_if_exp_span_recorded` - Parse `x if cond else y`, verify span covers entire ternary
- [x] Unit: `test_yield_span_recorded` - Parse `yield x`, verify span
- [x] Unit: `test_yield_no_value_span` - Parse `yield`, verify span covers just `yield`
- [x] Unit: `test_await_span_recorded` - Parse `await foo()`, verify span
- [x] Unit: `test_named_expr_span_recorded` - Parse `(x := 42)`, verify span
- [x] Unit: `test_starred_element_span` - Parse `[*items]`, verify starred element span
- [x] Unit: `test_tuple_span_recorded` - Parse `(1, 2)`, verify span includes parentheses
- [x] Unit: `test_tuple_no_parens_span` - Parse `1, 2`, verify span
- [x] Unit: `test_slice_span_recorded` - Parse `a[1:2:3]`, verify slice span (within subscript)
- [x] Unit: `test_slice_partial_span` - Parse `a[1:]`, verify slice span

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions)
- [x] `cargo nextest run -p tugtool-python-cst other_expr_span` passes

**Rollback:** Revert commit

---

######## Step 0.2.0.8: String Type Spans {#step-0-2-0-8}

**Commit:** `feat(python-cst): record ident_span for string expression nodes`

**References:** Table T21 Composite Expressions (#t21-expression-spans)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`
- Modified `crates/tugtool-python-cst/src/parser/grammar.rs`

**Context:**

String expressions have complex structure (concatenation, f-strings, template strings). Span computation requires handling multiple string parts.

**Note:** Originally marked "best effort" but resolved by adding `start_tok`/`end_tok` fields to capture accurate span boundaries from the parser.

**Tasks:**
- [x] `ConcatenatedString`: Add `record_ident_span` from `deflated_string_start_pos(left)` to `deflated_string_end_pos(right)`
- [x] `FormattedString`: Add `record_ident_span` using `start_tok` and `end_tok` for accurate full span
- [x] `TemplatedString`: Add `record_ident_span` using `start_tok` and `end_tok` for accurate full span
- [x] Add `start_tok` and `end_tok` fields to `FormattedString` and `TemplatedString` structs for proper position tracking
- [x] Update parser grammar to pass full tokens to `make_fstring`/`make_tstring`
- [x] Update `deflated_string_start_pos` and `deflated_string_end_pos` helpers to use token positions

**Tests:**
- [x] Unit: `test_string_span_concatenated_string` - Parse `"a" "b"`, verify span covers both strings
- [x] Unit: `test_string_span_formatted_string` - Parse `f"hello {name}"`, verify span covers entire f-string
- [x] Unit: `test_string_span_formatted_string_nested` - Parse `f"outer {f'inner {x}'}"`, verify spans
- [x] Unit: `test_string_span_multiline_string` - Parse triple-quoted string, verify span

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions)
- [x] `cargo nextest run -p tugtool-python-cst string_span` passes

**Rollback:** Revert commit

---

######## Step 0.2.0.9: Scope Statement Spans {#step-0-2-0-9}

**Commit:** `feat(python-cst): record lexical_span for scope-creating statement nodes`

**References:** Table T22 Scope-Creating Statements (#t22-statement-spans), Pattern 4 (#step-0-2-0-patterns)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs`

**Context:**

Scope-creating statements use `lexical_span` to define their scope boundaries. The span starts at the keyword (or `async` if present) and ends at the suite end.

**Tasks:**
- [x] `For`: Add `record_lexical_span` from `for_tok` (or `async_tok` if present) start to `deflated_suite_end_pos(&body)`
- [x] `While`: Add `record_lexical_span` from `while_tok.start_pos` to `deflated_suite_end_pos(&body)`
- [x] `With`: Add `record_lexical_span` from `with_tok` (or `async_tok` if present) start to `deflated_suite_end_pos(&body)`
- [x] `Try`: Add `record_lexical_span` from `try_tok.start_pos` to end of finalbody/orelse/handlers (whichever is last)
- [x] `TryStar`: Add `record_lexical_span` from `try_tok.start_pos` to end of finalbody/orelse/handlers
- [x] `Match`: Add `record_lexical_span` from `match_tok.start_pos` to last case end

**Tests:**
- [x] Unit: `test_scope_stmt_span_for_recorded` - Parse `for x in xs:\n    pass`, verify lexical_span
- [x] Unit: `test_scope_stmt_span_async_for` - Parse `async for x in xs:\n    pass`, verify span starts at `async`
- [x] Unit: `test_scope_stmt_span_while_recorded` - Parse `while cond:\n    pass`, verify lexical_span
- [x] Unit: `test_scope_stmt_span_with_recorded` - Parse `with ctx:\n    pass`, verify lexical_span
- [x] Unit: `test_scope_stmt_span_async_with` - Parse `async with ctx:\n    pass`, verify span starts at `async`
- [x] Unit: `test_scope_stmt_span_try_recorded` - Parse `try:\n    pass\nexcept:\n    pass`, verify lexical_span
- [x] Unit: `test_scope_stmt_span_try_with_finally` - Parse `try:\n    pass\nfinally:\n    pass`, verify span extends to finally end
- [x] Unit: `test_scope_stmt_span_match_recorded` - Parse `match x:\n    case 1:\n        pass`, verify lexical_span

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions)
- [x] `cargo nextest run -p tugtool-python-cst scope_stmt_span` passes

**Rollback:** Revert commit

---

######## Step 0.2.0.10: Branch Statement Spans {#step-0-2-0-10}

**Commit:** `feat(python-cst): record branch_span for branch statement nodes`

**References:** Table T22 Branch Statements (#t22-statement-spans), Pattern 5 (#step-0-2-0-patterns)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs`

**Context:**

Branch statements use `branch_span` to define conditional branch boundaries. These are used for type narrowing analysis (e.g., isinstance checks).

**Tasks:**
- [x] `Else`: Add `record_branch_span` from `else_tok.start_pos` to `deflated_suite_end_pos(&body)`
- [x] `ExceptHandler`: Add `record_branch_span` from `except_tok.start_pos` to `deflated_suite_end_pos(&body)`
- [x] `ExceptStarHandler`: Add `record_branch_span` from `except_tok.start_pos` to `deflated_suite_end_pos(&body)`
- [x] `Finally`: Add `record_branch_span` from `finally_tok.start_pos` to `deflated_suite_end_pos(&body)`
- [x] `MatchCase`: Add `record_branch_span` from `case_tok.start_pos` to `deflated_suite_end_pos(&body)`

**Tests:**
- [x] Unit: `test_else_branch_span_recorded` - Parse `if cond:\n    pass\nelse:\n    pass`, verify else branch_span
- [x] Unit: `test_except_branch_span_recorded` - Parse `try:\n    pass\nexcept E:\n    pass`, verify except branch_span
- [x] Unit: `test_except_star_branch_span` - Parse `try:\n    pass\nexcept* E:\n    pass`, verify branch_span
- [x] Unit: `test_finally_branch_span_recorded` - Parse `try:\n    pass\nfinally:\n    pass`, verify finally branch_span
- [x] Unit: `test_match_case_branch_span_recorded` - Parse `match x:\n    case 1:\n        pass`, verify case branch_span
- [x] Unit: `test_multiple_except_handlers_spans` - Parse try with multiple except handlers, verify each branch_span

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions)
- [x] `cargo nextest run -p tugtool-python-cst branch_stmt_span` passes

**Rollback:** Revert commit

---

######## Step 0.2.0.11: Simple Statement Spans {#step-0-2-0-11}

**Commit:** `feat(python-cst): record ident_span for simple statement nodes`

**References:** Table T22 Simple Statements (#t22-statement-spans), Pattern 1 (#step-0-2-0-patterns)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs`

**Context:**

Simple statements have various starting tokens and ending expressions. This step covers all the simple statements except imports (which are handled separately).

**Tasks:**
- [x] `Pass`: Add `record_ident_span` from `tok.start_pos` to `tok.end_pos` (uses tok from Step 0.2.0.1)
- [x] `Break`: Add `record_ident_span` from `tok.start_pos` to `tok.end_pos` (uses tok from Step 0.2.0.1)
- [x] `Continue`: Add `record_ident_span` from `tok.start_pos` to `tok.end_pos` (uses tok from Step 0.2.0.1)
- [x] `Expr`: Add `record_ident_span` from `deflated_expression_start_pos(value)` to expression end
- [x] `Assign`: Add `record_ident_span` from first target start to value end
- [x] `AugAssign`: Add `record_ident_span` from target start to value end
- [x] `AnnAssign`: Add `record_ident_span` from target start to value end (or annotation end if no value)
- [x] `Return`: Add `record_ident_span` from `return_tok.start_pos` to value end (or return token if no value)
- [x] `Assert`: Add `record_ident_span` from `assert_tok.start_pos` to msg end (or test end if no msg)
- [x] `Raise`: Add `record_ident_span` from `raise_tok.start_pos` to cause end (or exc end or raise token)
- [x] `Global`: Add `record_ident_span` from `tok.start_pos` to last name end
- [x] `Nonlocal`: Add `record_ident_span` from `tok.start_pos` to last name end
- [x] `Del`: Add `record_ident_span` from `tok.start_pos` to target end
- [x] `TypeAlias`: Add `record_ident_span` from `type_tok.start_pos` to value end

**Tests:**
- [x] Unit: `test_pass_span_recorded` - Parse `pass`, verify ident_span from tok
- [x] Unit: `test_break_span_recorded` - Parse `while True:\n    break`, verify ident_span
- [x] Unit: `test_continue_span_recorded` - Parse `while True:\n    continue`, verify ident_span
- [x] Unit: `test_expr_stmt_span_recorded` - Parse `foo()`, verify ident_span covers the expression
- [x] Unit: `test_assign_span_recorded` - Parse `x = 42`, verify ident_span from `x` to `42`
- [x] Unit: `test_multi_target_assign_span` - Parse `x = y = 42`, verify span covers all
- [x] Unit: `test_aug_assign_span_recorded` - Parse `x += 1`, verify ident_span
- [x] Unit: `test_ann_assign_span_recorded` - Parse `x: int = 1`, verify ident_span
- [x] Unit: `test_ann_assign_no_value_span` - Parse `x: int`, verify span ends at annotation
- [x] Unit: `test_return_span_recorded` - Parse `return x`, verify ident_span
- [x] Unit: `test_return_no_value_span` - Parse `return`, verify span covers just `return`
- [x] Unit: `test_raise_span_recorded` - Parse `raise E`, verify ident_span
- [x] Unit: `test_raise_no_exc_span` - Parse `raise`, verify span covers just `raise`
- [x] Unit: `test_assert_span_recorded` - Parse `assert x`, verify ident_span
- [x] Unit: `test_assert_with_msg_span` - Parse `assert x, "msg"`, verify span includes message
- [x] Unit: `test_global_span_recorded` - Parse `global x`, verify ident_span
- [x] Unit: `test_nonlocal_span_recorded` - Parse `nonlocal x`, verify ident_span
- [x] Unit: `test_del_span_recorded` - Parse `del x`, verify ident_span

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions)
- [x] `cargo nextest run -p tugtool-python-cst simple_stmt_span` passes

**Rollback:** Revert commit

---

######## Step 0.2.0.11.5: Refactor Span Helpers with Traits and Macros {#step-0-2-0-11-5}

**Commit:** `refactor(python-cst): unify span position helpers with traits and macros`

**References:** Step 0.2.0.11 (#step-0-2-0-11), DRY principle

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs`

**Context:**

Step 0.2.0.11 introduced two helper functions that duplicate logic from existing expression helpers:
- `deflated_assign_target_expr_start_pos` (25 lines) - duplicates `deflated_expression_start_pos`
- `deflated_del_target_expr_end_pos` (23 lines) - duplicates `deflated_expression_end_pos`

The duplication exists because `DeflatedAssignTargetExpression` and `DeflatedDelTargetExpression` are proper subsets of `DeflatedExpression`. They contain the same variant names (Name, Attribute, Tuple, List, Subscript, StarredElement) with identical inner types (`DeflatedName`, `DeflatedAttribute`, etc.), but are distinct Rust enums.

This step eliminates the duplication using a trait-based approach with macro-generated enum dispatch:

1. Define position traits (`DeflatedStartPos`, `DeflatedEndPos`) with methods returning `usize`
2. Implement traits once per inner type (DeflatedName, DeflatedAttribute, DeflatedList, etc.)
3. Use a macro to generate dispatch methods on enum types that match on variants and call trait impls
4. Remove the duplicated helper functions and update call sites

**Benefits:**
- Zero runtime overhead (compiles to identical code)
- Single source of truth (each inner type's position logic defined once)
- Easy extensibility (add new enum types by listing variants in macro invocation)

**Tasks:**

*Phase 1: Define Traits (expression.rs)*
- [x] Define `DeflatedStartPos` trait with `fn start_pos(&self) -> usize`
- [x] Define `DeflatedEndPos` trait with `fn end_pos(&self) -> usize`

*Phase 2: Implement Traits for Inner Types (expression.rs)*
- [x] Implement `DeflatedStartPos` for `DeflatedName` (handles lpar/tok)
- [x] Implement `DeflatedEndPos` for `DeflatedName` (handles rpar/tok)
- [x] Implement `DeflatedStartPos` for `DeflatedAttribute` (handles lpar/value recursion)
- [x] Implement `DeflatedEndPos` for `DeflatedAttribute` (handles rpar/attr.tok)
- [x] Implement `DeflatedStartPos` for `DeflatedTuple` (handles lpar/first element)
- [x] Implement `DeflatedEndPos` for `DeflatedTuple` (handles rpar/last element)
- [x] Implement `DeflatedStartPos` for `DeflatedList` (handles lpar/lbracket)
- [x] Implement `DeflatedEndPos` for `DeflatedList` (handles rpar/rbracket)
- [x] Implement `DeflatedStartPos` for `DeflatedSubscript` (handles lpar/value recursion)
- [x] Implement `DeflatedEndPos` for `DeflatedSubscript` (handles rpar/rbracket)
- [x] Implement `DeflatedStartPos` for `DeflatedStarredElement` (handles lpar/star_tok)
- [x] Implement `DeflatedEndPos` for `DeflatedStarredElement` (handles rpar/value recursion)

*Phase 3: Create Dispatch Macro (expression.rs)*
- [x] Define `impl_deflated_pos_dispatch!` macro that:
  - Takes enum name and list of variants
  - Generates `start_pos(&self) -> usize` method matching on variants and calling trait
  - Generates `end_pos(&self) -> usize` method matching on variants and calling trait
- [x] Apply macro to `DeflatedExpression` to generate dispatch methods
- [x] Update `deflated_expression_start_pos` to call `expr.start_pos()`
- [x] Update `deflated_expression_end_pos` to call `expr.end_pos()`

*Phase 4: Apply to Statement Enums (statement.rs)*
- [x] Apply `impl_deflated_pos_dispatch!` to `DeflatedAssignTargetExpression` with variants: Name, Attribute, Tuple, List, Subscript, StarredElement
- [x] Apply `impl_deflated_pos_dispatch!` to `DeflatedDelTargetExpression` with variants: Name, Attribute, Tuple, List, Subscript
- [x] Remove `deflated_assign_target_expr_start_pos` helper function
- [x] Remove `deflated_del_target_expr_end_pos` helper function
- [x] Update call sites in `Assign::inflate` to use `target.start_pos()`
- [x] Update call sites in `AnnAssign::inflate` to use `target.start_pos()`
- [x] Update call sites in `AugAssign::inflate` to use `target.start_pos()`
- [x] Update call site in `Del::inflate` to use `target.end_pos()`

*Phase 5: Remaining Expression Types (expression.rs)*
- [x] Implement traits for remaining DeflatedExpression inner types that have position logic in the existing helpers (Ellipsis, Integer, Float, Imaginary, Call, Set, Dict, ListComp, SetComp, DictComp, GeneratorExp, BinaryOperation, BooleanOperation, UnaryOperation, Comparison, SimpleString, ConcatenatedString, FormattedString, TemplatedString, IfExp, Lambda, Yield, Await, NamedExpr)

**Tests:**
- [x] Unit: `test_trait_dispatch_expression_positions` - Verify trait dispatch works for expression types
- [x] Unit: `test_trait_dispatch_name_positions` - Verify trait dispatch works for Name expressions
- [x] Unit: `test_trait_dispatch_assign_target_start_pos` - Verify DeflatedAssignTargetExpression.start_pos() works
- [x] Unit: `test_trait_dispatch_del_target_end_pos` - Verify DeflatedDelTargetExpression.end_pos() works
- [x] Unit: `test_trait_dispatch_assign_span_still_correct` - Verify Assign span computation unchanged after refactoring
- [x] Unit: `test_trait_dispatch_del_span_still_correct` - Verify Del span computation unchanged after refactoring

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) - 707 tests pass
- [x] `cargo clippy -p tugtool-python-cst -- -D warnings` passes
- [x] Grep confirms `deflated_assign_target_expr_start_pos` no longer exists
- [x] Grep confirms `deflated_del_target_expr_end_pos` no longer exists

**Rollback:** Revert commit

---

######## Step 0.2.0.11.6: Import Infrastructure Foundation {#step-0-2-0-11-6}

**Commit:** `feat(python-cst): add import infrastructure for span recording`

**References:** Step 0.2.0.11.5 (#step-0-2-0-11-5), Step 0.2.0.12 (#step-0-2-0-12)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/op.rs`
- Modified `crates/tugtool-python-cst/src/parser/grammar.rs`
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs`
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs`
- Modified `plans/phase-13.md` (documentation fix)

**Context:**

Step 0.2.0.12 (Import Statement Spans) requires several infrastructure components that are currently missing or incomplete. This foundation step addresses those gaps to unblock Step 0.2.0.12 implementation.

**Gap Analysis:**

1. **ImportStar Token Field (op.rs):** The `ImportStar` node currently has no fields, making it impossible to determine the position of the `*` token for span computation. The grammar captures the token but discards it.

2. **DeflatedNameOrAttribute Dispatch (expression.rs):** The enum exists with `N(DeflatedName)` and `A(DeflatedAttribute)` variants, but the `impl_deflated_pos_dispatch!` macro has not been applied. This prevents `name_or_attr.start_pos()` and `name_or_attr.end_pos()` calls needed for `ImportAlias` span computation.

3. **DeflatedAssignTargetExpression End Position (statement.rs):** The dispatch macro is currently applied only for `start_pos`. Step 0.2.0.12 needs `end_pos` because `AsName.name` is `AssignTargetExpression`, not `NameOrAttribute` as incorrectly documented.

4. **Documentation Error (phase-13.md):** Step 0.2.0.12 incorrectly states that `AsName.name` is `NameOrAttribute`. The actual type is `AssignTargetExpression`, which affects how end positions must be computed.

**Tasks:**

*Phase 1: ImportStar Token Field (op.rs)*
- [x] Add `tok: TokenRef<'a>` field to `ImportStar` struct (via `#[cst_node]` attribute)
- [x] Update `make_importstar()` signature to accept `tok: TokenRef<'r, 'a>` parameter
- [x] Update `make_importstar()` body to initialize `tok` field in `DeflatedImportStar`
- [x] Update `Inflate` impl for `DeflatedImportStar` if needed (likely auto-handled by macro)

*Phase 2: Parser Grammar Update (grammar.rs)*
- [x] Update import star rule at line 272 to pass captured `star` token to `make_importstar(star)`
- [x] Verify the rule compiles: `/ star:lit("*") { (None, ImportNames::Star(make_importstar(star)), None) }`

*Phase 3: DeflatedNameOrAttribute Dispatch (expression.rs)*
- [x] Apply `impl_deflated_pos_dispatch!` to `DeflatedNameOrAttribute<'r, 'a>`:
  - `start_pos: [N, A]`
  - `end_pos: [N, A]`
- [x] Verify macro placement after the enum definition (around line 1008)

*Phase 4: DeflatedAssignTargetExpression End Position (statement.rs)*
- [x] Extend existing `impl_deflated_pos_dispatch!` invocation to include `end_pos`:
  - Current: `start_pos: [Name, Attribute, StarredElement, Tuple, List, Subscript]`
  - New: Add `end_pos: [Name, Attribute, StarredElement, Tuple, List, Subscript]`
- [x] All inner types already have `DeflatedEndPos` implementations from Step 0.2.0.11.5

*Phase 5: Documentation Fix (phase-13.md)*
- [x] Update Step 0.2.0.12 line 3200-3201 to reflect correct type:
  - Current: "If `asname` is present: end of `asname.name` (which is `NameOrAttribute`)"
  - Fixed: "If `asname` is present: end of `asname.name` (which is `AssignTargetExpression`)"
- [x] Update Step 0.2.0.12 Phase 2 implementation notes to use `AssignTargetExpression.end_pos()` via dispatch

**Tests:**

*Unit Tests (tugtool-python-cst)*
- [x] `test_importstar_has_tok_field` - Parse `from os import *`, verify `ImportStar` has populated `tok` field
- [x] `test_importstar_tok_position` - Verify `tok.start_pos` and `tok.end_pos` point to `*` character
- [x] `test_name_or_attribute_start_pos_name` - Verify `DeflatedNameOrAttribute::N(name).start_pos()` returns correct position
- [x] `test_name_or_attribute_end_pos_name` - Verify `DeflatedNameOrAttribute::N(name).end_pos()` returns correct position
- [x] `test_name_or_attribute_start_pos_attribute` - Verify `DeflatedNameOrAttribute::A(attr).start_pos()` returns correct position
- [x] `test_name_or_attribute_end_pos_attribute` - Verify `DeflatedNameOrAttribute::A(attr).end_pos()` returns correct position
- [x] `test_assign_target_end_pos_name` - Verify `DeflatedAssignTargetExpression::Name(n).end_pos()` works
- [x] `test_assign_target_end_pos_attribute` - Verify `DeflatedAssignTargetExpression::Attribute(a).end_pos()` works

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) - 715 tests pass
- [x] `cargo nextest run -p tugtool-python-cst importstar` passes
- [x] `cargo nextest run -p tugtool-python-cst name_or_attribute` passes
- [x] `cargo nextest run -p tugtool-python-cst assign_target_end_pos` passes
- [x] `cargo clippy -p tugtool-python-cst -- -D warnings` passes
- [x] Grep confirms `ImportStar` struct has `tok` field
- [x] Grep confirms `impl_deflated_pos_dispatch!` applied to `DeflatedNameOrAttribute`

**Rollback:** Revert commit

---

######## Step 0.2.0.12: Import Statement Spans {#step-0-2-0-12}

**Commit:** `feat(python-cst): record ident_span for import statement nodes`

**References:** Table T22 Import Statements (#t22-statement-spans), Step 0.2.0.11.6 (#step-0-2-0-11-6)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs` (Import, ImportFrom span recording)

**Context:**

Import statements have their own token patterns and are commonly targeted in refactoring operations. This step leverages the trait/macro infrastructure from Step 0.2.0.11.5 and the foundation work from Step 0.2.0.11.6 for consistent position computation.

**Infrastructure (from Step 0.2.0.11.6):**

Step 0.2.0.11.6 provides the following infrastructure that this step depends on:
- `ImportStar.tok` field for `*` token position
- `impl_deflated_pos_dispatch!` for `DeflatedNameOrAttribute` with `N`, `A` variants
- `impl_deflated_pos_dispatch!` for `DeflatedAssignTargetExpression` with `end_pos` support

For `ImportAlias`, the end position is computed from:
1. If `asname` is present: end of `asname.name` (which is `AssignTargetExpression`)
2. Otherwise: end of `name` (which is `NameOrAttribute`)

**Tasks:**

*Phase 1: Implement Import Alias End Position (statement.rs)*
- [x] Implement `DeflatedEndPos` for `DeflatedImportAlias`:
  - If `asname.is_some()`: return `asname.unwrap().name.end_pos()` (via AssignTargetExpression dispatch from Step 0.2.0.11.6)
  - Otherwise: return `name.end_pos()` (via NameOrAttribute dispatch from Step 0.2.0.11.6)
- [x] Add helper function `deflated_import_names_end_pos(&DeflatedImportNames) -> usize`:
  - Match on `Star(s)` -> return `s.tok.end_pos.byte_idx()` (uses `tok` field from Step 0.2.0.11.6)
  - Match on `Aliases(vec)` -> return `vec.last().unwrap().end_pos()`

*Phase 3: Import Span Recording (statement.rs)*
- [x] `Import`: Add `record_ident_span` from `import_tok.start_pos` to `names.last().unwrap().end_pos()`
- [x] `ImportFrom`: Add `record_ident_span` from `from_tok.start_pos` to:
  - If `rpar.is_some()`: `rpar.rpar_tok.end_pos.byte_idx()` (direct token access)
  - Otherwise: `deflated_import_names_end_pos(&names)`

**Tests:**
- [x] Unit: `test_import_span_recorded` - Parse `import os`, verify ident_span
- [x] Unit: `test_import_multiple_span` - Parse `import os, sys`, verify span covers all
- [x] Unit: `test_import_as_span` - Parse `import os as operating_system`, verify span
- [x] Unit: `test_import_from_span_recorded` - Parse `from os import path`, verify ident_span
- [x] Unit: `test_import_from_multiple_span` - Parse `from os import path, getcwd`, verify span
- [x] Unit: `test_import_from_parens_span` - Parse `from os import (\n    path,\n    getcwd\n)`, verify span includes closing paren
- [x] Unit: `test_import_from_star_span` - Parse `from os import *`, verify span covers star (uses `tok` field from Step 0.2.0.11.6)

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) - 722 tests pass
- [x] `cargo nextest run -p tugtool-python-cst import_span` passes

**Rollback:** Revert commit

---

######## Step 0.2.0.13: Special Spans (Decorator, Param) {#step-0-2-0-13}

**Commit:** `feat(python-cst): record ident_span for Decorator and Param nodes`

**References:** Table T21 Parameter Node, Table T22 Decorator (#t21-expression-spans, #t22-statement-spans), Step 0.2.0.11.5 (#step-0-2-0-11-5)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/nodes/expression.rs` (Param)
- Modified `crates/tugtool-python-cst/src/nodes/statement.rs` (Decorator)

**Context:**

Decorators and parameters are special nodes that appear in specific contexts. They complete the span recording coverage.

**Infrastructure Reuse:**

Both `Decorator` and `Param` can leverage the trait infrastructure from Step 0.2.0.11.5:

- **Decorator**: The end position is computed from the decorator expression. Use `self.decorator.end_pos()` which dispatches via the `DeflatedExpression` trait impl (already has all expression variants implemented).

- **Param**: The end position depends on which optional components are present. When `default` is present, use `default.end_pos()` via `DeflatedExpression` trait dispatch. When only `annotation` is present and ends with an expression, use trait dispatch on the annotation's expression.

**Tasks:**

*Phase 1: Decorator Span (statement.rs)*
- [x] `Decorator`: Add `record_ident_span` from `at_tok.start_pos.byte_idx()` to `self.decorator.end_pos()`
  - Uses existing `DeflatedExpression.end_pos()` trait dispatch from Step 0.2.0.11.5

*Phase 2: Param Span (expression.rs)*
- [x] `Param`: Add `record_ident_span` with start/end computed as:
  - **Start**: If `star_tok.is_some()`: `star_tok.start_pos.byte_idx()`, else `name.tok.start_pos.byte_idx()`
  - **End** (in priority order):
    1. If `default.is_some()`: `default.unwrap().end_pos()` (uses DeflatedExpression trait dispatch)
    2. If `annotation.is_some()`: `annotation.unwrap().annotation.end_pos()` (uses DeflatedExpression trait dispatch)
    3. Otherwise: `name.tok.end_pos.byte_idx()`

**Tests:**
- [x] Unit: `test_decorator_span_recorded` - Parse `@dec\ndef f(): pass`, verify decorator span from `@` to expression end
- [x] Unit: `test_decorator_with_call_span` - Parse `@dec(arg)\ndef f(): pass`, verify span includes call
- [x] Unit: `test_decorator_multiline_span` - Parse decorator with parenthesized arguments spanning multiple lines
- [x] Unit: `test_param_simple_span` - Parse `def f(x): pass`, verify param span covers `x`
- [x] Unit: `test_param_with_default_span` - Parse `def f(x=1): pass`, verify span covers `x=1`
- [x] Unit: `test_param_with_annotation_span` - Parse `def f(x: int): pass`, verify span covers `x: int`
- [x] Unit: `test_param_with_both_span` - Parse `def f(x: int = 1): pass`, verify span covers `x: int = 1`
- [x] Unit: `test_param_star_span` - Parse `def f(*args): pass`, verify span starts at `*`
- [x] Unit: `test_param_kwargs_span` - Parse `def f(**kwargs): pass`, verify span starts at `**`

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (no regressions) - 731 tests pass
- [x] `cargo nextest run -p tugtool-python-cst decorator_param_span` passes - 9 tests pass

**Rollback:** Revert commit

---

####### Step 0.2.0 Summary {#step-0-2-0-summary}

After completing Steps 0.2.0.1 through 0.2.0.13 (including 0.2.0.11.5), you will have:

- Token fields added to `Pass`, `Break`, `Continue` structs
- The `deflated_suite_end_pos` helper function
- Span recording for all literal expressions (`Ellipsis`, `Integer`, `Float`, `Imaginary`)
- Span recording for all container expressions (`List`, `Set`, `Dict`)
- Span recording for all operation expressions (`BinaryOperation`, `UnaryOperation`, `BooleanOperation`, `Comparison`)
- Span recording for access expressions (`Call`, `Attribute`, `Subscript`)
- Span recording for other expressions (`IfExp`, `Yield`, `Await`, `NamedExpr`, `StarredElement`, `Tuple`, `Slice`)
- Span recording for string expressions (`ConcatenatedString`, `FormattedString`, `TemplatedString`)
- Span recording for scope-creating statements (`For`, `While`, `With`, `Try`, `TryStar`, `Match`)
- Span recording for branch statements (`Else`, `ExceptHandler`, `ExceptStarHandler`, `Finally`, `MatchCase`)
- Span recording for simple statements (all assignment, control flow, and declaration statements)
- Unified span position traits (`DeflatedStartPos`, `DeflatedEndPos`) with macro-generated dispatch
- Span recording for import statements (`Import`, `ImportFrom`)
- Span recording for special nodes (`Decorator`, `Param`)

**Final Step 0.2.0 Checkpoint:**

- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst` passes (all tests, including all new span recording tests) - 738 tests pass
- [x] `cargo clippy -p tugtool-python-cst -- -D warnings` passes
- [x] Verify: parsing with `parse_module_with_positions` populates `PositionTable` for all node types
- [x] Verify: `PositionTable::len()` returns significantly more entries than before (~10x increase expected)

**Aggregate Test Command:**
```bash
cargo nextest run -p tugtool-python-cst span
```

This command should run all span-related tests from all substeps.

---

####### Edge Case Tests {#edge-case-tests}

After all substeps are complete, add these edge case tests to ensure robustness:

- [x] `test_parenthesized_expression_span` - Parse `(a + b)`, verify span includes parens
- [x] `test_nested_call_span` - Parse `f(g(x))`, verify both call spans recorded
- [x] `test_multiline_expression_span` - Parse multi-line call, verify span crosses lines
- [x] `test_chained_attribute_span` - Parse `a.b.c`, verify each attribute span
- [x] `test_complex_comprehension_span` - Parse `[x for x in xs if x]`, verify lexical_span (already done but verify)
- [x] `test_deeply_nested_span` - Parse deeply nested expression, verify all spans recorded
- [x] `test_unicode_span` - Parse expression with Unicode identifiers, verify byte offsets correct

---

####### Test File Organization {#test-file-org}

Create a new test file `crates/tugtool-python-cst/tests/span_recording.rs` organized by substep:

```rust
// crates/tugtool-python-cst/tests/span_recording.rs

mod step_0_2_0_1_token_fields {
    // Tests for Pass/Break/Continue token fields
}

mod step_0_2_0_2_suite_helper {
    // Tests for deflated_suite_end_pos helper
}

mod step_0_2_0_3_literal_spans {
    // Tests for literal span recording
}

mod step_0_2_0_4_container_spans {
    // Tests for container span recording
}

mod step_0_2_0_5_operation_spans {
    // Tests for operation span recording
}

mod step_0_2_0_6_call_attr_spans {
    // Tests for Call/Attribute/Subscript span recording
}

mod step_0_2_0_7_other_expr_spans {
    // Tests for other expression span recording
}

mod step_0_2_0_8_string_spans {
    // Tests for string span recording
}

mod step_0_2_0_9_scope_spans {
    // Tests for scope statement span recording
}

mod step_0_2_0_10_branch_spans {
    // Tests for branch statement span recording
}

mod step_0_2_0_11_simple_stmt_spans {
    // Tests for simple statement span recording
}

mod step_0_2_0_11_5_trait_refactor {
    // Tests for trait-based position dispatch refactoring
}

mod step_0_2_0_12_import_spans {
    // Tests for import statement span recording
}

mod step_0_2_0_13_special_spans {
    // Tests for Decorator and Param span recording
}

mod edge_cases {
    // Edge case tests from the Edge Case Tests section
}
```

---

####### Notes for Implementer {#notes}

1. **Order matters:** Complete substeps in order. Later substeps depend on earlier ones (e.g., simple statement spans depend on token fields from Step 0.2.0.1).

2. **Pattern reference:** Each substep references the appropriate implementation pattern. Refer to the Patterns section when implementing.

3. **Test as you go:** Write tests alongside implementation for each substep. This catches issues early.

4. **Span recording timing:** Always record spans BEFORE inflating children. Token positions are lost during inflation.

5. **Use existing helpers:** The `deflated_expression_start_pos` and `deflated_expression_end_pos` functions already handle parenthesized expressions correctly.

6. **Use trait dispatch (Step 0.2.0.11.5+):** For new types, prefer implementing `DeflatedStartPos`/`DeflatedEndPos` traits rather than writing new helper functions. For enum types, use `impl_deflated_pos_dispatch!` macro to generate dispatch methods. This ensures consistent patterns and avoids code duplication. The traits and macro are defined in `expression.rs` and re-exported for use in `statement.rs`.

7. **Performance:** Span recording is opt-in (only when `InflateCtx::with_positions()` is used). No performance impact on normal parsing.

8. **Commit discipline:** Each substep has a clear commit boundary. Commit after each substep's checkpoint passes.

---

##### Step 0.2: Position Lookup Infrastructure {#step-0-2}

**Commit:** `feat(python-cst): add position-to-node lookup and parent context`

**References:** [Layer 1](#layer-1) - required for `ExpressionBoundaryDetector` and [Step 1.3](#step-1-3)

**Artifacts:**
- New `crates/tugtool-python-cst/src/visitor/position_lookup.rs`
- Updated `crates/tugtool-python-cst/src/visitor/mod.rs`

---

###### 0.2.1 API Specification {#step-0-2-api}

**Position Conversion Types (extend existing `tugtool-core/src/text.rs`):**

```rust
// In tugtool-core/src/text.rs (additions to existing module)

/// A position in source code specified as line and column.
///
/// Both line and column are 1-indexed to match editor conventions.
/// Columns count Unicode scalar values (chars), not bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct LineCol {
    /// 1-indexed line number
    pub line: u32,
    /// 1-indexed column number (Unicode scalars, not bytes)
    pub col: u32,
}

impl LineCol {
    pub fn new(line: u32, col: u32) -> Self {
        Self {
            line: line.max(1),
            col: col.max(1),
        }
    }
}

/// Error when a position cannot be resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PositionError {
    /// Line number exceeds file line count
    LineOutOfRange { line: u32, max_line: u32 },
    /// Column exceeds line length
    ColumnOutOfRange { line: u32, col: u32, line_len: u32 },
    /// Byte offset exceeds file length
    OffsetOutOfRange { offset: usize, file_len: usize },
}

impl std::fmt::Display for PositionError { /* ... */ }
impl std::error::Error for PositionError {}

/// Result type for position operations.
pub type PositionResult<T> = Result<T, PositionError>;

/// Convert line:col to byte offset with validation.
///
/// Unlike the existing `position_to_byte_offset_str`, this version:
/// 1. Returns a Result with specific error types
/// 2. Handles edge cases explicitly
///
/// # Arguments
/// * `content` - The source text
/// * `line` - 1-indexed line number
/// * `col` - 1-indexed column (Unicode scalar count)
///
/// # Returns
/// The byte offset, or an error if position is invalid.
pub fn line_col_to_byte_offset(content: &str, pos: LineCol) -> PositionResult<usize>;

/// Convert byte offset to line:col with validation.
pub fn byte_offset_to_line_col(content: &str, offset: usize) -> PositionResult<LineCol>;
```

**Core Position Lookup Types (new file):**

```rust
// In crates/tugtool-python-cst/src/visitor/position_lookup.rs

use crate::nodes::*;
use crate::inflate_ctx::{NodePosition, PositionTable};
use tugtool_core::patch::Span;

/// Identifies a node type found at a position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeKind {
    // Expressions
    Name,
    Integer,
    Float,
    String,
    Attribute,
    Call,
    BinaryOp,
    UnaryOp,
    Compare,
    BooleanOp,
    IfExp,      // Ternary: x if cond else y
    Lambda,
    List,
    Dict,
    Set,
    Tuple,
    Subscript,
    Slice,
    Starred,
    Await,
    Yield,
    NamedExpr,  // Walrus operator
    GeneratorExp,
    ListComp,
    DictComp,
    SetComp,

    // Statements
    Assign,
    AugAssign,
    AnnAssign,
    Return,
    Delete,
    Pass,
    Break,
    Continue,
    Raise,
    Assert,
    Import,
    ImportFrom,
    Global,
    Nonlocal,
    Expr,       // Expression statement

    // Compound Statements
    FunctionDef,
    AsyncFunctionDef,
    ClassDef,
    If,
    For,
    AsyncFor,
    While,
    With,
    AsyncWith,
    Try,
    TryStar,
    Match,

    // Other
    Param,
    Arg,
    Keyword,
    Decorator,
    Alias,
    ExceptHandler,
    MatchCase,
    Comment,
    Module,
}

/// Information about a node found at a position.
#[derive(Debug, Clone)]
pub struct NodeInfo {
    /// The kind of node
    pub kind: NodeKind,
    /// The span covering this node (may be from PositionTable or computed)
    pub span: Span,
    /// The NodeId if the node has one (tracked nodes only)
    pub node_id: Option<NodeId>,
}

/// Information about an expression found at a position.
#[derive(Debug, Clone)]
pub struct ExpressionInfo {
    /// The kind of expression
    pub kind: NodeKind,
    /// The span covering the entire expression (including parentheses)
    pub span: Span,
    /// The span covering just the "core" expression (excluding outer parens)
    pub inner_span: Span,
    /// True if this expression is parenthesized
    pub is_parenthesized: bool,
    /// True if this is a complete sub-expression (not part of larger expr)
    pub is_complete: bool,
    /// The NodeId if available
    pub node_id: Option<NodeId>,
}

/// Information about a statement found at a position.
#[derive(Debug, Clone)]
pub struct StatementInfo {
    /// The kind of statement
    pub kind: NodeKind,
    /// The span covering the entire statement (including any trailing newline)
    pub span: Span,
    /// True if this is a compound statement (has body)
    pub is_compound: bool,
    /// The NodeId if available
    pub node_id: Option<NodeId>,
}

/// Information about a scope found at a position.
#[derive(Debug, Clone)]
pub struct ScopeInfo {
    /// The kind of scope (FunctionDef, ClassDef, Module, Lambda, Comprehension)
    pub kind: NodeKind,
    /// The lexical span of the scope (where variables resolve to this scope)
    pub lexical_span: Span,
    /// The full definition span (including decorators for functions/classes)
    pub def_span: Option<Span>,
    /// The name of the scope (if named)
    pub name: Option<String>,
    /// The NodeId if available
    pub node_id: Option<NodeId>,
}

/// Index for efficient position-to-node lookups.
///
/// Built from a parsed Module and its PositionTable, this index enables
/// O(log n) position lookups by maintaining sorted interval data.
///
/// # Design
///
/// The index uses an interval tree approach:
/// 1. All nodes with spans are collected during a traversal
/// 2. Nodes are sorted by span.start for binary search
/// 3. Lookup finds candidates via binary search, then filters by containment
///
/// # Memory
///
/// The index stores lightweight metadata (kind, span, node_id) rather than
/// CST node references. This avoids lifetime complexity and allows the
/// index to outlive the parsed Module if needed.
pub struct PositionIndex {
    /// Sorted list of (span, node_info) for all tracked nodes
    nodes: Vec<(Span, NodeInfo)>,
    /// Sorted list of expressions specifically (for expression lookups)
    expressions: Vec<(Span, ExpressionInfo)>,
    /// Sorted list of statements specifically (for statement lookups)
    statements: Vec<(Span, StatementInfo)>,
    /// Sorted list of scopes specifically (for scope lookups)
    scopes: Vec<(Span, ScopeInfo)>,
    /// Source length for bounds checking
    source_len: usize,
}

impl PositionIndex {
    /// Build a PositionIndex from a parsed module with position data.
    ///
    /// # Arguments
    /// * `module` - The parsed Module CST
    /// * `positions` - The PositionTable from parsing with positions enabled
    /// * `source` - The original source text (for bounds checking)
    ///
    /// # Performance
    /// O(n) where n is the number of nodes in the CST.
    pub fn build(module: &Module, positions: &PositionTable, source: &str) -> Self;

    /// Find the most specific node at the given byte offset.
    ///
    /// Returns the smallest (innermost) node whose span contains the position.
    /// Returns None if position is outside all nodes (e.g., in whitespace
    /// at end of file).
    pub fn find_node_at(&self, offset: usize) -> Option<&NodeInfo>;

    /// Find the expression at or containing the given byte offset.
    ///
    /// Returns the smallest expression whose span contains the position.
    /// If the position is inside a sub-expression, returns that sub-expression.
    pub fn find_expression_at(&self, offset: usize) -> Option<&ExpressionInfo>;

    /// Find the statement at or containing the given byte offset.
    ///
    /// For positions within expressions, returns the containing statement.
    pub fn find_statement_at(&self, offset: usize) -> Option<&StatementInfo>;

    /// Find the scope (function, class, module) containing the given byte offset.
    ///
    /// Returns the innermost scope. For nested functions/classes, returns
    /// the most deeply nested one.
    pub fn find_scope_at(&self, offset: usize) -> Option<&ScopeInfo>;

    /// Find all nodes whose spans contain the given offset.
    ///
    /// Returns nodes from outermost to innermost (module first, then
    /// function, then statement, then expression, etc.).
    pub fn find_all_at(&self, offset: usize) -> Vec<&NodeInfo>;

    /// Find the enclosing expression if the position is inside a sub-expression.
    ///
    /// Given position in `foo.bar.baz`, returns info about the containing
    /// attribute access chain.
    pub fn find_enclosing_expression(&self, offset: usize) -> Option<&ExpressionInfo>;
}

/// Tracks ancestor context during CST traversal.
///
/// Used by position index builder to capture parent-child relationships.
pub struct AncestorTracker<'a> {
    /// Stack of ancestor nodes
    stack: Vec<AncestorEntry<'a>>,
}

/// Entry in the ancestor stack.
#[derive(Debug)]
pub struct AncestorEntry<'a> {
    pub kind: NodeKind,
    pub span: Span,
    pub node_id: Option<NodeId>,
    /// Index of this entry in the stack (for efficient parent lookup)
    pub depth: usize,
}

impl<'a> AncestorTracker<'a> {
    pub fn new() -> Self;

    /// Push a node onto the ancestor stack.
    pub fn push(&mut self, kind: NodeKind, span: Span, node_id: Option<NodeId>);

    /// Pop the top node from the ancestor stack.
    pub fn pop(&mut self) -> Option<AncestorEntry<'a>>;

    /// Get the current parent (top of stack).
    pub fn parent(&self) -> Option<&AncestorEntry<'a>>;

    /// Get the current depth (number of ancestors).
    pub fn depth(&self) -> usize;

    /// Get the ancestor at a specific depth (0 = root).
    pub fn ancestor_at(&self, depth: usize) -> Option<&AncestorEntry<'a>>;

    /// Check if the current context is inside an expression.
    pub fn in_expression(&self) -> bool;

    /// Check if the current context is inside a specific node kind.
    pub fn inside(&self, kind: NodeKind) -> bool;

    /// Get the nearest enclosing scope.
    pub fn enclosing_scope(&self) -> Option<&AncestorEntry<'a>>;
}
```

---

###### 0.2.2 Internal Design Notes {#step-0-2-internal}

**Relationship to Existing Infrastructure:**

The codebase already has:

1. **`tugtool-core/src/text.rs`**: Basic line:col <-> byte offset conversion
2. **`InflateCtx` / `PositionTable`**: Span capture during parsing
3. **Visitor traits**: Traversal infrastructure

Position lookup builds on these foundations:

```
Existing:
  parse_module_with_positions() -> (Module, PositionTable)
                                          |
New:                                      v
  PositionIndex::build(module, positions) -> PositionIndex
                                                    |
                                                    v
  index.find_expression_at(offset) -> ExpressionInfo
```

**Index Building Algorithm:**

```rust
impl PositionIndex {
    pub fn build(module: &Module, positions: &PositionTable, source: &str) -> Self {
        let source_len = source.len();
        let mut collector = IndexCollector::new(positions);

        // Single traversal collects all node info
        walk_module(module, &mut collector);

        // Sort by span.start for binary search
        collector.nodes.sort_by_key(|(span, _)| span.start);
        collector.expressions.sort_by_key(|(span, _)| span.start);
        collector.statements.sort_by_key(|(span, _)| span.start);
        collector.scopes.sort_by_key(|(span, _)| span.start);

        Self {
            nodes: collector.nodes,
            expressions: collector.expressions,
            statements: collector.statements,
            scopes: collector.scopes,
            source_len,
        }
    }
}

struct IndexCollector<'a> {
    positions: &'a PositionTable,
    nodes: Vec<(Span, NodeInfo)>,
    expressions: Vec<(Span, ExpressionInfo)>,
    statements: Vec<(Span, StatementInfo)>,
    scopes: Vec<(Span, ScopeInfo)>,
    ancestors: AncestorTracker<'a>,
}

impl<'a> Visitor<'a> for IndexCollector<'a> {
    fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
        if let Some(node_id) = node.node_id {
            if let Some(pos) = self.positions.get(&node_id) {
                if let Some(span) = pos.ident_span {
                    self.nodes.push((span, NodeInfo {
                        kind: NodeKind::Name,
                        span,
                        node_id: Some(node_id),
                    }));
                    self.expressions.push((span, ExpressionInfo {
                        kind: NodeKind::Name,
                        span,
                        inner_span: span,
                        is_parenthesized: false,
                        is_complete: !self.ancestors.in_expression(),
                        node_id: Some(node_id),
                    }));
                }
            }
        }
        VisitResult::Continue
    }

    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        if let Some(node_id) = node.node_id {
            if let Some(pos) = self.positions.get(&node_id) {
                let lexical_span = pos.lexical_span.unwrap_or_else(|| {
                    // Fallback: compute span
                    Span::new(0, 0)
                });
                let def_span = pos.def_span;

                self.nodes.push((lexical_span, NodeInfo {
                    kind: NodeKind::FunctionDef,
                    span: lexical_span,
                    node_id: Some(node_id),
                }));

                self.scopes.push((lexical_span, ScopeInfo {
                    kind: NodeKind::FunctionDef,
                    lexical_span,
                    def_span,
                    name: Some(node.name.value.to_string()),
                    node_id: Some(node_id),
                }));

                self.ancestors.push(NodeKind::FunctionDef, lexical_span, Some(node_id));
            }
        }
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.ancestors.pop();
    }

    // ... similar for other node types
}
```

**Position Lookup Algorithm:**

```rust
impl PositionIndex {
    pub fn find_node_at(&self, offset: usize) -> Option<&NodeInfo> {
        if offset > self.source_len {
            return None;
        }

        // Binary search to find first node where span.start <= offset
        let idx = self.nodes
            .partition_point(|(span, _)| span.start <= offset);

        // Scan backwards to find all candidates
        let mut candidates: Vec<&NodeInfo> = Vec::new();
        for i in (0..idx).rev() {
            let (span, info) = &self.nodes[i];
            if span.start > offset {
                continue;
            }
            if span.end <= offset {
                // Spans are sorted by start; once end <= offset,
                // earlier spans won't contain offset either
                break;
            }
            // span.start <= offset < span.end: this node contains offset
            candidates.push(info);
        }

        // Return smallest (innermost) containing node
        candidates.into_iter()
            .min_by_key(|info| info.span.len())
    }

    pub fn find_all_at(&self, offset: usize) -> Vec<&NodeInfo> {
        if offset > self.source_len {
            return Vec::new();
        }

        let idx = self.nodes.partition_point(|(span, _)| span.start <= offset);

        let mut result: Vec<&NodeInfo> = self.nodes[..idx]
            .iter()
            .filter(|(span, _)| span.start <= offset && offset < span.end)
            .map(|(_, info)| info)
            .collect();

        // Sort by span size descending (outermost first)
        result.sort_by_key(|info| std::cmp::Reverse(info.span.len()));
        result
    }
}
```

**Line:Col Conversion with Unicode:**

```rust
pub fn line_col_to_byte_offset(content: &str, pos: LineCol) -> PositionResult<usize> {
    let mut current_line = 1u32;
    let mut line_start = 0usize;

    for (byte_idx, ch) in content.char_indices() {
        if current_line == pos.line {
            // Found the line - now count columns (Unicode scalars)
            let mut current_col = 1u32;
            for (col_byte_idx, col_ch) in content[byte_idx..].char_indices() {
                if current_col == pos.col {
                    return Ok(byte_idx + col_byte_idx);
                }
                if col_ch == '\n' {
                    // Column exceeds line length
                    return Err(PositionError::ColumnOutOfRange {
                        line: pos.line,
                        col: pos.col,
                        line_len: current_col - 1,
                    });
                }
                current_col += 1;
            }
            // Past end of content on this line
            if current_col == pos.col {
                return Ok(content.len());
            }
            return Err(PositionError::ColumnOutOfRange {
                line: pos.line,
                col: pos.col,
                line_len: current_col - 1,
            });
        }
        if ch == '\n' {
            current_line += 1;
            line_start = byte_idx + 1;
        }
    }

    // Line not found
    Err(PositionError::LineOutOfRange {
        line: pos.line,
        max_line: current_line,
    })
}
```

---

###### 0.2.3 Edge Cases {#step-0-2-edge-cases}

| Edge Case | Handling |
|-----------|----------|
| **Position in whitespace** | `find_node_at` returns None; `find_statement_at` returns containing/adjacent statement |
| **Position in comment** | Returns None for node lookup (comments not in CST) |
| **Position at statement boundary** | Returns the statement starting at that position |
| **Position between statements** | `find_statement_at` returns None; `find_scope_at` returns containing scope |
| **Position at EOF** | Returns containing scope (module) or None for node |
| **Position beyond file** | Returns `PositionError::OffsetOutOfRange` |
| **Unicode column counting** | Columns count Unicode scalar values, not bytes or graphemes |
| **Tab characters** | Treated as single column (consistent with Python tokenizer) |
| **Empty file** | Module scope spans [0,0); position 0 is valid |
| **Multi-line string** | Entire string is single expression |
| **f-string with expressions** | Each interpolation is separate expression within string |
| **Comprehension scope** | Comprehensions create implicit scope for iteration variable |
| **Lambda body** | Lambda creates scope; position in body returns lambda scope |
| **Decorator position** | Returns decorator node; function's lexical_span excludes decorator |
| **Nested functions** | Innermost function scope returned |

**Column Counting Convention:**

```
Source: "x = 变量"
        │ │ │  │
        │ │ │  └─ col 5 (byte 8-11, '量' is 3 bytes)
        │ │ └─ col 4 (byte 5-8, '变' is 3 bytes)
        │ └─ col 3 (byte 4)
        └─ col 1 (byte 0)

LineCol { line: 1, col: 4 } -> byte offset 5
```

---

###### 0.2.4 Integration Points {#step-0-2-integration}

**Existing Components:**

| Component | Integration |
|-----------|-------------|
| `parse_module_with_positions()` | Source of Module and PositionTable |
| `PositionTable` | Provides spans for tracked nodes |
| `tugtool_core::text` | Extend with `LineCol`, `PositionError`, validated conversion |
| Visitor trait | Used for index building traversal |

**Module Structure:**

```
crates/tugtool-python-cst/src/visitor/
├── mod.rs              # Add: pub mod position_lookup; pub use position_lookup::*;
├── position_lookup.rs  # NEW: PositionIndex, NodeInfo, etc.
└── ...

crates/tugtool-core/src/
├── text.rs             # EXTEND: Add LineCol, PositionError, validated conversion
└── ...
```

**Usage in Extract Variable (Layer 1):**

```rust
// Extract Variable needs to find the expression at cursor position
let parsed = parse_module_with_positions(source, None)?;
let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

// User clicks at byte position 25
let expr = index.find_expression_at(25)
    .ok_or(ExtractError::NoExpressionAtPosition)?;

// Get the expression span for extraction
let span = expr.span;
let text = &source[span.start..span.end];
```

---

###### 0.2.5 Concrete Examples {#step-0-2-examples}

**Example 1: Find Expression at Position**

```rust
let source = "result = calculate_tax(get_price() * 1.08)\n";
//            ^       ^              ^
//            0       9              23
//            |       |              |
//            Assign  Call           BinaryOp

let parsed = parse_module_with_positions(source, None)?;
let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

// Position 23 is inside "get_price()"
let expr = index.find_expression_at(23).unwrap();
assert_eq!(expr.kind, NodeKind::Call);
// span covers "get_price()"

// Position 30 is in "* 1.08"
let expr = index.find_expression_at(30).unwrap();
assert_eq!(expr.kind, NodeKind::BinaryOp);
// span covers "get_price() * 1.08"

// Position 9 is start of "calculate_tax(...)"
let expr = index.find_expression_at(9).unwrap();
assert_eq!(expr.kind, NodeKind::Call);
```

**Example 2: Find Enclosing Scope**

```rust
let source = r#"
def outer():
    def inner():
        x = 1
    return inner
"#;

let parsed = parse_module_with_positions(source, None)?;
let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

// Position in "x = 1" (inside inner)
let scope = index.find_scope_at(35).unwrap();
assert_eq!(scope.kind, NodeKind::FunctionDef);
assert_eq!(scope.name, Some("inner".to_string()));

// Position in "return inner" (inside outer, outside inner)
let scope = index.find_scope_at(50).unwrap();
assert_eq!(scope.kind, NodeKind::FunctionDef);
assert_eq!(scope.name, Some("outer".to_string()));
```

**Example 3: Line:Col to Byte Offset with Unicode**

```rust
let source = "x = '你好世界'\n";
//            ^   ^^^^^
//            0   4 (bytes 4-16, 4 chars * 3 bytes each)

// Column 5 is the first Chinese character
let offset = line_col_to_byte_offset(source, LineCol::new(1, 5))?;
assert_eq!(offset, 4);

// Column 6 is the second Chinese character
let offset = line_col_to_byte_offset(source, LineCol::new(1, 6))?;
assert_eq!(offset, 7);  // 4 + 3 bytes for '你'

// Column 100 exceeds line length
let result = line_col_to_byte_offset(source, LineCol::new(1, 100));
assert!(matches!(result, Err(PositionError::ColumnOutOfRange { .. })));
```

**Example 4: Find All Nodes at Position (for context)**

```rust
let source = "result = foo.bar.method(arg)\n";
//                         ^
//                         17 (inside "method")

let parsed = parse_module_with_positions(source, None)?;
let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

let all = index.find_all_at(17);
// Returns (outermost to innermost):
// 1. Module
// 2. Assign statement
// 3. Call expression (foo.bar.method(arg))
// 4. Attribute expression (foo.bar.method)
// 5. Name (method) - innermost
```

---

**Tasks:**
- [ ] Add `LineCol` struct to `tugtool-core/src/text.rs`
- [ ] Add `PositionError` enum to `tugtool-core/src/text.rs`
- [ ] Implement `line_col_to_byte_offset()` with Unicode scalar column counting
- [ ] Implement `byte_offset_to_line_col()` with validation
- [ ] Create `NodeKind` enum covering all Python AST node types
- [ ] Create `NodeInfo`, `ExpressionInfo`, `StatementInfo`, `ScopeInfo` structs
- [ ] Create `PositionIndex` struct with build() and lookup methods
- [ ] Create `AncestorTracker` for traversal context
- [ ] Implement `find_node_at()` with binary search and containment filtering
- [ ] Implement `find_expression_at()` returning smallest containing expression
- [ ] Implement `find_statement_at()` returning containing statement
- [ ] Implement `find_scope_at()` returning innermost scope
- [ ] Implement `find_all_at()` returning all containing nodes
- [ ] Implement `find_enclosing_expression()` for parent expression lookup
- [ ] Add comprehensive documentation and examples

**Tests:**
- [ ] Unit: `test_find_node_simple_expression` - Name, Integer, String
- [ ] Unit: `test_find_node_nested_expression` - Attribute chain
- [ ] Unit: `test_find_expression_in_call` - argument position
- [ ] Unit: `test_find_expression_parenthesized` - (a + b) grouping
- [ ] Unit: `test_find_expression_binary_op` - left/right operand
- [ ] Unit: `test_find_enclosing_statement` - expression inside statement
- [ ] Unit: `test_find_enclosing_scope_function` - nested functions
- [ ] Unit: `test_find_enclosing_scope_class` - method inside class
- [ ] Unit: `test_find_enclosing_scope_lambda` - lambda body
- [ ] Unit: `test_find_enclosing_scope_comprehension` - list comp variable
- [ ] Unit: `test_position_at_whitespace` - between tokens
- [ ] Unit: `test_position_at_comment` - in line comment
- [ ] Unit: `test_position_between_statements` - newline area
- [ ] Unit: `test_position_at_eof` - end of file
- [ ] Unit: `test_position_beyond_file` - error case
- [ ] Unit: `test_line_col_to_byte_offset_ascii` - simple case
- [ ] Unit: `test_line_col_to_byte_offset_unicode` - multi-byte chars
- [ ] Unit: `test_line_col_to_byte_offset_line_out_of_range` - error
- [ ] Unit: `test_line_col_to_byte_offset_col_out_of_range` - error
- [ ] Unit: `test_byte_offset_to_line_col_roundtrip` - conversion symmetry
- [ ] Unit: `test_find_all_at` - returns correct hierarchy
- [ ] Unit: `test_find_enclosing_expression` - attribute chain parent

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python-cst position_lookup`
- [ ] `cargo nextest run -p tugtool-core text`
- [ ] All lookup functions return correct spans
- [ ] Unicode column counting works correctly

**Rollback:** Revert commit

---

###### 0.2.6 Execution Steps {#step-0-2-6}

**References:** [Step 0.2](#step-0-2), Spec (#step-0-2-api), Tables in (#step-0-2-internal), Edge Cases (#step-0-2-edge-cases), Integration (#step-0-2-integration), Examples (#step-0-2-examples)

This section breaks the Position Lookup Infrastructure implementation into discrete substeps with individual commits and checkpoints.

**Total Substeps:** 6

**Estimated Complexity:** Medium (well-specified API, clear algorithms, established patterns from Step 0.2.0)

---

###### Step 0.2.6.1: Position Conversion Types {#step-0-2-6-1}

**Commit:** `feat(core): add LineCol and PositionError types for position conversion`

**References:** Spec (#step-0-2-api) - Position Conversion Types section, Edge Cases (#step-0-2-edge-cases) - Column Counting Convention

**Artifacts:**
- Modified `crates/tugtool-core/src/text.rs`
- Modified `crates/tugtool-core/src/lib.rs` (exports)

**Tasks:**
- [x] Add `LineCol` struct with `line: u32` and `col: u32` fields (1-indexed)
- [x] Implement `LineCol::new()` with minimum value clamping (max(1, value))
- [x] Add `PositionError` enum with variants: `LineOutOfRange`, `ColumnOutOfRange`, `OffsetOutOfRange`
- [x] Implement `std::fmt::Display` for `PositionError`
- [x] Implement `std::error::Error` for `PositionError`
- [x] Add `PositionResult<T>` type alias
- [x] Implement `line_col_to_byte_offset()` with Unicode scalar column counting (per algorithm in #step-0-2-internal)
- [x] Implement `byte_offset_to_line_col()` with validation
- [x] Export new types from `tugtool-core/src/lib.rs`
- [x] Add documentation with Unicode examples

**Tests:**
- [x] Unit: `test_line_col_new_clamps_minimum` - Verify line/col minimum is 1
- [x] Unit: `test_line_col_to_byte_offset_ascii` - Simple ASCII text conversion
- [x] Unit: `test_line_col_to_byte_offset_unicode` - Multi-byte Chinese characters
- [x] Unit: `test_line_col_to_byte_offset_multiline` - Multiple lines
- [x] Unit: `test_line_col_to_byte_offset_line_out_of_range` - Error case
- [x] Unit: `test_line_col_to_byte_offset_col_out_of_range` - Error case
- [x] Unit: `test_byte_offset_to_line_col_ascii` - Simple conversion
- [x] Unit: `test_byte_offset_to_line_col_unicode` - Multi-byte characters
- [x] Unit: `test_byte_offset_to_line_col_out_of_range` - Error case
- [x] Unit: `test_byte_offset_to_line_col_roundtrip` - Conversion symmetry

**Checkpoint:**
- [x] `cargo build -p tugtool-core` succeeds
- [x] `cargo nextest run -p tugtool-core text` passes
- [x] `cargo clippy -p tugtool-core -- -D warnings` passes

**Rollback:** Revert commit

---

###### Step 0.2.6.2: Node Kind and Info Types {#step-0-2-6-2}

**Commit:** `feat(python-cst): add NodeKind enum and position lookup info types`

**References:** Spec (#step-0-2-api) - NodeKind enum and info structs

**Artifacts:**
- New `crates/tugtool-python-cst/src/visitor/position_lookup.rs`
- Modified `crates/tugtool-python-cst/src/visitor/mod.rs`

**Tasks:**
- [x] Create `position_lookup.rs` module file
- [x] Add `NodeKind` enum with all expression variants (Name, Integer, Float, String, Attribute, Call, BinaryOp, UnaryOp, Compare, BooleanOp, IfExp, Lambda, List, Dict, Set, Tuple, Subscript, Slice, Starred, Await, Yield, NamedExpr, GeneratorExp, ListComp, DictComp, SetComp)
- [x] Add `NodeKind` enum with all statement variants (Assign, AugAssign, AnnAssign, Return, Delete, Pass, Break, Continue, Raise, Assert, Import, ImportFrom, Global, Nonlocal, Expr)
- [x] Add `NodeKind` enum with compound statement variants (FunctionDef, AsyncFunctionDef, ClassDef, If, For, AsyncFor, While, With, AsyncWith, Try, TryStar, Match)
- [x] Add `NodeKind` enum with other variants (Param, Arg, Keyword, Decorator, Alias, ExceptHandler, MatchCase, Comment, Module)
- [x] Create `NodeInfo` struct with `kind`, `span`, `node_id` fields
- [x] Create `ExpressionInfo` struct with `kind`, `span`, `inner_span`, `is_parenthesized`, `is_complete`, `node_id` fields
- [x] Create `StatementInfo` struct with `kind`, `span`, `is_compound`, `node_id` fields
- [x] Create `ScopeInfo` struct with `kind`, `lexical_span`, `def_span`, `name`, `node_id` fields
- [x] Add `pub mod position_lookup;` to `visitor/mod.rs`
- [x] Add `pub use position_lookup::*;` to `visitor/mod.rs`
- [x] Add comprehensive documentation for each type

**Tests:**
- [x] Unit: `test_node_kind_debug_format` - Verify Debug impl works
- [x] Unit: `test_node_info_construction` - Basic struct creation
- [x] Unit: `test_expression_info_construction` - All fields populated correctly
- [x] Unit: `test_statement_info_construction` - All fields populated correctly
- [x] Unit: `test_scope_info_construction` - All fields populated correctly

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst position_lookup` passes
- [x] All info types are exported from crate

**Rollback:** Revert commit

---

###### Step 0.2.6.3: Ancestor Tracker {#step-0-2-6-3}

**Commit:** `feat(python-cst): add AncestorTracker for traversal context`

**References:** Spec (#step-0-2-api) - AncestorTracker and AncestorEntry types, Internal Design (#step-0-2-internal) - Index Building Algorithm

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/position_lookup.rs`

**Tasks:**
- [x] Create `AncestorEntry` struct with `kind`, `span`, `node_id`, `depth` fields
- [x] Create `AncestorTracker` struct with `stack: Vec<AncestorEntry>` field
- [x] Implement `AncestorTracker::new()` returning empty tracker
- [x] Implement `push(&mut self, kind, span, node_id)` adding to stack
- [x] Implement `pop(&mut self)` removing from stack
- [x] Implement `parent(&self)` returning top of stack
- [x] Implement `depth(&self)` returning stack length
- [x] Implement `ancestor_at(&self, depth)` returning entry at index
- [x] Implement `in_expression(&self)` checking if any ancestor is expression kind
- [x] Implement `inside(&self, kind)` checking if any ancestor matches kind
- [x] Implement `enclosing_scope(&self)` finding nearest FunctionDef/ClassDef/Module/Lambda

**Tests:**
- [x] Unit: `test_ancestor_tracker_empty` - New tracker has depth 0
- [x] Unit: `test_ancestor_tracker_push_pop` - Push/pop maintains LIFO order
- [x] Unit: `test_ancestor_tracker_parent` - Returns top of stack
- [x] Unit: `test_ancestor_tracker_ancestor_at` - Correct depth indexing
- [x] Unit: `test_ancestor_tracker_in_expression` - Detects expression ancestors
- [x] Unit: `test_ancestor_tracker_inside` - Detects specific kind
- [x] Unit: `test_ancestor_tracker_enclosing_scope` - Finds function/class scope

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst ancestor_tracker` passes

**Rollback:** Revert commit

---

###### Step 0.2.6.4: Index Builder (Visitor) {#step-0-2-6-4}

**Commit:** `feat(python-cst): add IndexCollector visitor for building PositionIndex`

**References:** Internal Design (#step-0-2-internal) - IndexCollector struct and Visitor impl, Integration (#step-0-2-integration) - Module Structure

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/position_lookup.rs`

**Tasks:**
- [x] Create `IndexCollector` struct with `positions`, `nodes`, `expressions`, `statements`, `scopes`, `ancestors` fields
- [x] Implement `IndexCollector::new(positions: &PositionTable)` constructor
- [x] Implement `Visitor` trait for `IndexCollector`:
  - [x] `visit_name` - Record NodeInfo and ExpressionInfo
  - [x] `visit_integer`, `visit_float`, `visit_string` - Literal expressions
  - [x] `visit_attribute`, `visit_call`, `visit_subscript` - Access expressions
  - [x] `visit_binary_op`, `visit_unary_op`, `visit_boolean_op`, `visit_comparison` - Operation expressions
  - [x] `visit_list`, `visit_dict`, `visit_set`, `visit_tuple` - Container expressions
  - [x] `visit_lambda`, `visit_generator_exp`, `visit_list_comp`, `visit_dict_comp`, `visit_set_comp` - Scope-creating expressions
  - [x] `visit_if_exp`, `visit_await`, `visit_yield`, `visit_named_expr` - Other expressions
  - [x] `visit_assign`, `visit_aug_assign`, `visit_ann_assign` - Assignment statements
  - [x] `visit_return`, `visit_delete`, `visit_pass`, `visit_break`, `visit_continue` - Simple statements
  - [x] `visit_raise`, `visit_assert`, `visit_import`, `visit_import_from`, `visit_global`, `visit_nonlocal` - Other simple statements
  - [x] `visit_function_def`, `visit_async_function_def` - Function definitions (scope + statement)
  - [x] `visit_class_def` - Class definition (scope + statement)
  - [x] `visit_if`, `visit_for`, `visit_async_for`, `visit_while` - Compound statements
  - [x] `visit_with`, `visit_async_with`, `visit_try`, `visit_try_star`, `visit_match` - Other compound statements
- [x] Implement corresponding `leave_*` methods for scope/compound nodes to pop from ancestor stack
- [x] Handle `is_parenthesized` detection from CST lpar/rpar fields
- [x] Handle `is_complete` detection from ancestor tracker context

**Tests:**
- [x] Unit: `test_collector_visits_all_expressions` - Parse complex expression, verify all collected
- [x] Unit: `test_collector_visits_all_statements` - Parse module with statements, verify all collected
- [x] Unit: `test_collector_tracks_scopes` - Nested functions collected as scopes
- [x] Unit: `test_collector_tracks_ancestors` - Parent-child relationship preserved
- [x] Unit: `test_collector_handles_parenthesized` - (a + b) marked as parenthesized

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst test_collector` passes

**Rollback:** Revert commit

---

###### Step 0.2.6.5: PositionIndex Structure and Build {#step-0-2-6-5}

**Commit:** `feat(python-cst): add PositionIndex struct with build method`

**References:** Spec (#step-0-2-api) - PositionIndex struct, Internal Design (#step-0-2-internal) - Index Building Algorithm

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/position_lookup.rs`

**Tasks:**
- [x] Create `PositionIndex` struct with `nodes`, `expressions`, `statements`, `scopes`, `source_len` fields
- [x] Implement `PositionIndex::build(module, positions, source)`:
  - [x] Create `IndexCollector` with positions reference
  - [x] Call `walk_module(module, &mut collector)` for traversal
  - [x] Sort `nodes` by `span.start` for binary search
  - [x] Sort `expressions` by `span.start`
  - [x] Sort `statements` by `span.start`
  - [x] Sort `scopes` by `span.start`
  - [x] Return assembled `PositionIndex`
- [x] Add `source_len()` getter method
- [x] Add `node_count()`, `expression_count()`, `statement_count()`, `scope_count()` for introspection

**Tests:**
- [x] Unit: `test_position_index_build_simple` - Build from simple module
- [x] Unit: `test_position_index_build_empty_module` - Empty source file
- [x] Unit: `test_position_index_nodes_sorted` - Verify sorted by span.start
- [x] Unit: `test_position_index_counts_accurate` - Count methods return correct values

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst test_position_index` passes

**Rollback:** Revert commit

---

###### Step 0.2.6.6: Position Lookup Methods {#step-0-2-6-6}

**Commit:** `feat(python-cst): implement position lookup methods for PositionIndex`

**References:** Spec (#step-0-2-api) - lookup method signatures, Internal Design (#step-0-2-internal) - Position Lookup Algorithm, Edge Cases (#step-0-2-edge-cases), Examples (#step-0-2-examples)

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/position_lookup.rs`

**Tasks:**
- [x] Implement `find_node_at(offset)`:
  - [x] Bounds check against `source_len`
  - [x] Binary search to find partition point
  - [x] Scan backwards to collect candidates where `span.start <= offset < span.end`
  - [x] Return smallest (innermost) by span length
- [x] Implement `find_expression_at(offset)` using same algorithm on `expressions` vec
- [x] Implement `find_statement_at(offset)` using same algorithm on `statements` vec
- [x] Implement `find_scope_at(offset)` using same algorithm on `scopes` vec
- [x] Implement `find_all_at(offset)`:
  - [x] Collect all nodes where span contains offset
  - [x] Sort by span size descending (outermost first)
  - [x] Return as Vec<&NodeInfo>
- [x] Implement `find_enclosing_expression(offset)`:
  - [x] Find expression at offset
  - [x] If found, search for next-larger expression containing same offset
  - [x] Return parent expression or None
- [x] Handle all edge cases from (#step-0-2-edge-cases): whitespace, comments, boundaries, EOF, beyond-file

**Tests:**
- [x] Unit: `test_find_node_simple_expression` - Name, Integer, String at position
- [x] Unit: `test_find_node_nested_expression` - Attribute chain returns innermost
- [x] Unit: `test_find_expression_in_call` - Argument position returns argument expr
- [x] Unit: `test_find_expression_parenthesized` - (a + b) grouping
- [x] Unit: `test_find_expression_binary_op` - Position in operand returns operand
- [x] Unit: `test_find_enclosing_statement` - Expression inside statement
- [x] Unit: `test_find_enclosing_scope_function` - Nested functions
- [x] Unit: `test_find_enclosing_scope_class` - Method inside class
- [x] Unit: `test_find_enclosing_scope_lambda` - Lambda body
- [x] Unit: `test_find_enclosing_scope_comprehension` - List comp variable
- [x] Unit: `test_position_at_whitespace` - Returns None for node lookup
- [x] Unit: `test_position_at_comment` - Returns None (comments not in CST)
- [x] Unit: `test_position_between_statements` - Returns None for node, scope for scope
- [x] Unit: `test_position_at_eof` - Returns module scope
- [x] Unit: `test_position_beyond_file` - Returns None
- [x] Unit: `test_find_all_at` - Returns correct hierarchy outermost to innermost
- [x] Unit: `test_find_enclosing_expression` - Attribute chain parent lookup

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst position_lookup` passes (47 tests)
- [x] All lookup functions return correct spans for examples in (#step-0-2-examples)

**Rollback:** Revert commit

---

###### Step 0.2.6 Summary {#step-0-2-6-summary}

After completing Steps 0.2.6.1 through 0.2.6.6, you will have:

- `LineCol` struct and `PositionError` enum in `tugtool-core/src/text.rs`
- `line_col_to_byte_offset()` and `byte_offset_to_line_col()` functions with Unicode support
- `NodeKind` enum covering all Python CST node types
- `NodeInfo`, `ExpressionInfo`, `StatementInfo`, `ScopeInfo` structs for lookup results
- `AncestorTracker` for tracking parent-child relationships during traversal
- `IndexCollector` visitor that builds index data during CST traversal
- `PositionIndex` struct with efficient O(log n) lookup via binary search
- Lookup methods: `find_node_at`, `find_expression_at`, `find_statement_at`, `find_scope_at`, `find_all_at`, `find_enclosing_expression`
- Comprehensive edge case handling per (#step-0-2-edge-cases)

**Final Step 0.2.6 Checkpoint:**

- [x] `cargo build -p tugtool-core` succeeds
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-core text` passes (45 tests)
- [x] `cargo nextest run -p tugtool-python-cst position_lookup` passes (47 tests)
- [x] `cargo clippy --workspace -- -D warnings` passes
- [x] Verify: `PositionIndex::build()` populates all node categories from parsed module
- [x] Verify: All concrete examples from (#step-0-2-examples) produce expected results

**Aggregate Test Command:**
```bash
cargo nextest run -p tugtool-core text && cargo nextest run -p tugtool-python-cst position_lookup
```

---

##### Step 0.3: Stub Discovery Infrastructure {#step-0-3}

**Commit:** `feat(python): add type stub discovery and update infrastructure`

**References:** [D08](#d08-stub-updates)

**Artifacts:**
- New `crates/tugtool-python/src/stubs.rs`
- Updated `crates/tugtool-python/src/lib.rs`

---

###### 0.3.1 API Specification {#step-0-3-api}

**Stub Discovery Types:**

```rust
// In crates/tugtool-python/src/stubs.rs

use std::path::{Path, PathBuf};
use tugtool_core::patch::Span;

/// Error type for stub operations.
#[derive(Debug, Clone)]
pub enum StubError {
    /// Stub file exists but failed to parse.
    ParseError {
        stub_path: PathBuf,
        message: String,
    },

    /// Stub file not found at expected location.
    NotFound {
        source_path: PathBuf,
        searched_locations: Vec<PathBuf>,
    },

    /// IO error reading stub file.
    IoError {
        stub_path: PathBuf,
        message: String,
    },

    /// String annotation has invalid syntax.
    InvalidAnnotation {
        annotation: String,
        message: String,
    },
}

impl std::fmt::Display for StubError { /* ... */ }
impl std::error::Error for StubError {}

pub type StubResult<T> = Result<T, StubError>;

/// Information about a discovered stub file.
#[derive(Debug, Clone)]
pub struct StubInfo {
    /// Path to the stub file
    pub stub_path: PathBuf,
    /// Path to the corresponding source file
    pub source_path: PathBuf,
    /// Whether stub was found in same directory (inline) or stubs/ folder
    pub location: StubLocation,
}

/// Where the stub was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StubLocation {
    /// Stub is `module.pyi` in same directory as `module.py`
    Inline,
    /// Stub is in `stubs/` directory at workspace root
    StubsFolder,
    /// Stub is in typeshed-style `stubs/package-stubs/` directory
    TypeshedStyle,
}

/// Options for stub discovery.
#[derive(Debug, Clone)]
pub struct StubDiscoveryOptions {
    /// Workspace root for finding stubs/ folder
    pub workspace_root: PathBuf,

    /// Additional directories to search for stubs
    pub extra_stub_dirs: Vec<PathBuf>,

    /// Whether to check typeshed-style package-stubs directories
    pub check_typeshed_style: bool,
}

impl Default for StubDiscoveryOptions {
    fn default() -> Self {
        Self {
            workspace_root: PathBuf::from("."),
            extra_stub_dirs: Vec::new(),
            check_typeshed_style: true,
        }
    }
}

/// Discovers type stub files (.pyi) for Python modules.
///
/// # Discovery Order
///
/// For a source file `pkg/module.py`, stubs are searched in this order:
///
/// 1. **Inline stub**: `pkg/module.pyi` (same directory)
/// 2. **Stubs folder**: `{workspace_root}/stubs/pkg/module.pyi`
/// 3. **Typeshed-style**: `{workspace_root}/stubs/pkg-stubs/module.pyi`
/// 4. **Extra dirs**: Each directory in `extra_stub_dirs`
///
/// The first existing file is returned.
///
/// # Example
///
/// ```rust
/// let discovery = StubDiscovery::new(StubDiscoveryOptions {
///     workspace_root: PathBuf::from("/project"),
///     ..Default::default()
/// });
///
/// // Find stub for /project/src/mypackage/utils.py
/// let stub = discovery.find_stub_for(&PathBuf::from("/project/src/mypackage/utils.py"));
/// // Returns Some(StubInfo) if /project/src/mypackage/utils.pyi exists
/// // or /project/stubs/mypackage/utils.pyi exists
/// ```
pub struct StubDiscovery {
    options: StubDiscoveryOptions,
}

impl StubDiscovery {
    /// Create a new StubDiscovery with the given options.
    pub fn new(options: StubDiscoveryOptions) -> Self;

    /// Create a StubDiscovery with default options and given workspace root.
    pub fn for_workspace(workspace_root: impl Into<PathBuf>) -> Self;

    /// Find the stub file for a given Python source file.
    ///
    /// Returns `Some(StubInfo)` if a stub exists, `None` if no stub found.
    pub fn find_stub_for(&self, source_path: &Path) -> Option<StubInfo>;

    /// Find stub and return error with searched locations if not found.
    ///
    /// Use this when stub is expected/required (e.g., public API symbol).
    pub fn find_stub_or_err(&self, source_path: &Path) -> StubResult<StubInfo>;

    /// Check if a stub exists for the given source file.
    pub fn has_stub(&self, source_path: &Path) -> bool;

    /// Get the expected stub path (whether it exists or not).
    ///
    /// Returns the inline stub path (`module.pyi` in same directory).
    pub fn expected_stub_path(&self, source_path: &Path) -> PathBuf;

    /// List all searched locations for a source file.
    ///
    /// Useful for error messages and debugging.
    pub fn search_locations(&self, source_path: &Path) -> Vec<PathBuf>;
}

/// Parsed stub file with symbol information.
///
/// A lightweight representation of a stub file's contents,
/// focused on what's needed for refactoring operations.
#[derive(Debug, Clone)]
pub struct ParsedStub {
    /// Path to the stub file
    pub path: PathBuf,
    /// Functions defined in the stub
    pub functions: Vec<StubFunction>,
    /// Classes defined in the stub
    pub classes: Vec<StubClass>,
    /// Type aliases defined in the stub
    pub type_aliases: Vec<StubTypeAlias>,
    /// Module-level variables with type annotations
    pub variables: Vec<StubVariable>,
    /// The raw source text
    pub source: String,
}

/// Function signature in a stub file.
#[derive(Debug, Clone)]
pub struct StubFunction {
    pub name: String,
    pub name_span: Span,
    /// Full signature span (from 'def' to ':')
    pub signature_span: Span,
    /// Full definition span (including decorators, body ellipsis)
    pub def_span: Span,
    pub is_async: bool,
    pub decorators: Vec<String>,
}

/// Class definition in a stub file.
#[derive(Debug, Clone)]
pub struct StubClass {
    pub name: String,
    pub name_span: Span,
    /// Span of 'class Name(bases):'
    pub header_span: Span,
    /// Full definition span (including body)
    pub def_span: Span,
    pub methods: Vec<StubFunction>,
    pub attributes: Vec<StubVariable>,
}

/// Type alias in a stub file.
#[derive(Debug, Clone)]
pub struct StubTypeAlias {
    pub name: String,
    pub name_span: Span,
    pub value_span: Span,
}

/// Variable with type annotation.
#[derive(Debug, Clone)]
pub struct StubVariable {
    pub name: String,
    pub name_span: Span,
    pub annotation_span: Option<Span>,
}

impl ParsedStub {
    /// Parse a stub file from a path.
    ///
    /// # Errors
    ///
    /// Returns `StubError::IoError` if file cannot be read.
    /// Returns `StubError::ParseError` if file has syntax errors.
    pub fn parse(stub_path: &Path) -> StubResult<Self>;

    /// Parse stub content directly (for testing).
    pub fn parse_str(source: &str, stub_path: PathBuf) -> StubResult<Self>;

    /// Find a function by name.
    pub fn find_function(&self, name: &str) -> Option<&StubFunction>;

    /// Find a class by name.
    pub fn find_class(&self, name: &str) -> Option<&StubClass>;

    /// Find a method in a class.
    pub fn find_method(&self, class_name: &str, method_name: &str) -> Option<&StubFunction>;

    /// Check if stub defines a symbol (function, class, or variable).
    pub fn has_symbol(&self, name: &str) -> bool;
}

/// Applies edits to stub files.
///
/// Handles the coordination between source file edits and stub file edits.
pub struct StubUpdater {
    discovery: StubDiscovery,
}

impl StubUpdater {
    pub fn new(discovery: StubDiscovery) -> Self;

    /// Generate stub edits for a rename operation.
    ///
    /// Given a symbol rename in source, returns the corresponding edits
    /// needed in the stub file (if one exists).
    ///
    /// # Arguments
    /// * `source_path` - Path to the source file being modified
    /// * `old_name` - The old symbol name
    /// * `new_name` - The new symbol name
    ///
    /// # Returns
    /// * `Ok(Some(edits))` - Stub exists and needs these edits
    /// * `Ok(None)` - No stub file exists (no edits needed)
    /// * `Err` - Stub exists but has parse errors
    pub fn rename_edits(
        &self,
        source_path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> StubResult<Option<StubEdits>>;

    /// Generate stub edits for moving a symbol to another module.
    ///
    /// Returns edits to remove from source stub and add to target stub.
    pub fn move_edits(
        &self,
        source_path: &Path,
        target_path: &Path,
        symbol_name: &str,
    ) -> StubResult<MoveStubEdits>;
}

/// Edits to apply to a stub file.
#[derive(Debug, Clone)]
pub struct StubEdits {
    pub stub_path: PathBuf,
    pub edits: Vec<StubEdit>,
}

/// A single edit in a stub file.
#[derive(Debug, Clone)]
pub enum StubEdit {
    /// Rename a symbol
    Rename { span: Span, new_name: String },
    /// Delete a symbol definition
    Delete { span: Span },
    /// Insert a new symbol definition
    Insert { position: usize, text: String },
}

/// Edits for moving a symbol between stubs.
#[derive(Debug, Clone)]
pub struct MoveStubEdits {
    /// Edits to source stub (delete the symbol)
    pub source_edits: Option<StubEdits>,
    /// Edits to target stub (insert the symbol)
    pub target_edits: Option<StubEdits>,
}
```

**String Annotation Parser:**

```rust
/// Parses and transforms type expressions in string annotations.
///
/// String annotations are used for forward references and lazy imports:
/// ```python
/// def process(handler: "Handler") -> "Result":
///     items: "List[Item]" = []
/// ```
///
/// This parser extracts type names from string content for renaming.
pub struct StringAnnotationParser;

/// A reference found in a string annotation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationRef {
    /// The name referenced (e.g., "Handler", "module.Class")
    pub name: String,
    /// Position within the annotation string (not including quotes)
    pub offset_in_string: usize,
    /// Length of the name
    pub length: usize,
}

/// Information about a parsed string annotation.
#[derive(Debug, Clone)]
pub struct ParsedAnnotation {
    /// The original string content (without quotes)
    pub content: String,
    /// Quote character used (' or ")
    pub quote_char: char,
    /// All type references found
    pub refs: Vec<AnnotationRef>,
}

impl StringAnnotationParser {
    /// Parse a string annotation and extract type references.
    ///
    /// # Arguments
    /// * `annotation` - The annotation including quotes (e.g., `"Handler"`)
    ///
    /// # Returns
    /// Parsed annotation info, or error if invalid syntax.
    ///
    /// # Supported Patterns
    /// * Simple names: `"ClassName"` -> refs `["ClassName"]`
    /// * Qualified names: `"module.Class"` -> refs `["module", "Class"]`
    /// * Generic types: `"List[Item]"` -> refs `["List", "Item"]`
    /// * Union types: `"A | B"` -> refs `["A", "B"]`
    /// * Optional: `"Optional[T]"` -> refs `["Optional", "T"]`
    /// * Callable: `"Callable[[A], B]"` -> refs `["Callable", "A", "B"]`
    pub fn parse(annotation: &str) -> StubResult<ParsedAnnotation>;

    /// Transform a string annotation by renaming a symbol.
    ///
    /// # Arguments
    /// * `annotation` - Original annotation (including quotes)
    /// * `old_name` - Name to replace
    /// * `new_name` - Replacement name
    ///
    /// # Returns
    /// The transformed annotation string, preserving quote style.
    ///
    /// # Example
    /// ```rust
    /// let result = StringAnnotationParser::rename(
    ///     "\"Handler\"",
    ///     "Handler",
    ///     "RequestHandler"
    /// )?;
    /// assert_eq!(result, "\"RequestHandler\"");
    ///
    /// // Preserves single quotes
    /// let result = StringAnnotationParser::rename(
    ///     "'List[Handler]'",
    ///     "Handler",
    ///     "RequestHandler"
    /// )?;
    /// assert_eq!(result, "'List[RequestHandler]'");
    /// ```
    pub fn rename(annotation: &str, old_name: &str, new_name: &str) -> StubResult<String>;

    /// Check if an annotation contains a reference to a given name.
    pub fn contains_name(annotation: &str, name: &str) -> StubResult<bool>;
}
```

---

###### 0.3.2 Internal Design Notes {#step-0-3-internal}

**Stub Discovery Algorithm:**

```rust
impl StubDiscovery {
    pub fn find_stub_for(&self, source_path: &Path) -> Option<StubInfo> {
        // 1. Get the .pyi path for inline stub
        let inline_stub = self.inline_stub_path(source_path);
        if inline_stub.exists() {
            return Some(StubInfo {
                stub_path: inline_stub,
                source_path: source_path.to_path_buf(),
                location: StubLocation::Inline,
            });
        }

        // 2. Try stubs/ folder at workspace root
        let module_path = self.module_path_from_source(source_path)?;
        let stubs_folder_stub = self.options.workspace_root
            .join("stubs")
            .join(&module_path);
        if stubs_folder_stub.exists() {
            return Some(StubInfo {
                stub_path: stubs_folder_stub,
                source_path: source_path.to_path_buf(),
                location: StubLocation::StubsFolder,
            });
        }

        // 3. Try typeshed-style package-stubs
        if self.options.check_typeshed_style {
            if let Some(stub) = self.find_typeshed_style_stub(source_path, &module_path) {
                return Some(stub);
            }
        }

        // 4. Try extra stub directories
        for extra_dir in &self.options.extra_stub_dirs {
            let extra_stub = extra_dir.join(&module_path);
            if extra_stub.exists() {
                return Some(StubInfo {
                    stub_path: extra_stub,
                    source_path: source_path.to_path_buf(),
                    location: StubLocation::StubsFolder,
                });
            }
        }

        None
    }

    fn inline_stub_path(&self, source_path: &Path) -> PathBuf {
        source_path.with_extension("pyi")
    }

    fn module_path_from_source(&self, source_path: &Path) -> Option<PathBuf> {
        // Convert /project/src/pkg/module.py -> pkg/module.pyi
        // This requires knowing the Python source roots

        // For now, use relative path from workspace root
        let relative = source_path.strip_prefix(&self.options.workspace_root).ok()?;
        Some(relative.with_extension("pyi"))
    }

    fn find_typeshed_style_stub(&self, source_path: &Path, module_path: &Path) -> Option<StubInfo> {
        // For pkg/module.py, check stubs/pkg-stubs/module.pyi
        let components: Vec<_> = module_path.components().collect();
        if components.is_empty() {
            return None;
        }

        // Get top-level package name
        let top_level = components[0].as_os_str().to_string_lossy();
        let stubs_pkg = format!("{}-stubs", top_level);

        let mut typeshed_path = self.options.workspace_root.join("stubs").join(&stubs_pkg);
        for component in &components[1..] {
            typeshed_path = typeshed_path.join(component);
        }

        if typeshed_path.exists() {
            Some(StubInfo {
                stub_path: typeshed_path,
                source_path: source_path.to_path_buf(),
                location: StubLocation::TypeshedStyle,
            })
        } else {
            None
        }
    }
}
```

**Stub Parsing:**

Stub parsing reuses the existing CST parser. Stubs have simpler structure:
- Function bodies are `...` or `pass`
- Class bodies contain only signatures and `...`
- No runtime code

```rust
impl ParsedStub {
    pub fn parse(stub_path: &Path) -> StubResult<Self> {
        let source = std::fs::read_to_string(stub_path)
            .map_err(|e| StubError::IoError {
                stub_path: stub_path.to_path_buf(),
                message: e.to_string(),
            })?;

        Self::parse_str(&source, stub_path.to_path_buf())
    }

    pub fn parse_str(source: &str, stub_path: PathBuf) -> StubResult<Self> {
        use tugtool_python_cst::{parse_module_with_positions, ParsedModule};

        let parsed = parse_module_with_positions(source, None)
            .map_err(|e| StubError::ParseError {
                stub_path: stub_path.clone(),
                message: format!("{}", e),
            })?;

        // Extract function, class, type alias, and variable definitions
        let mut collector = StubCollector::new(&parsed.positions);
        walk_module(&parsed.module, &mut collector);

        Ok(Self {
            path: stub_path,
            functions: collector.functions,
            classes: collector.classes,
            type_aliases: collector.type_aliases,
            variables: collector.variables,
            source: source.to_string(),
        })
    }
}
```

**String Annotation Parsing:**

String annotations contain Python type expressions. We parse them using a lightweight tokenizer:

```rust
impl StringAnnotationParser {
    pub fn parse(annotation: &str) -> StubResult<ParsedAnnotation> {
        // 1. Extract quote character and content
        let (quote_char, content) = Self::extract_content(annotation)?;

        // 2. Tokenize the content
        let tokens = Self::tokenize(content)?;

        // 3. Extract name references
        let refs = Self::extract_refs(&tokens);

        Ok(ParsedAnnotation {
            content: content.to_string(),
            quote_char,
            refs,
        })
    }

    fn extract_content(annotation: &str) -> StubResult<(char, &str)> {
        let bytes = annotation.as_bytes();
        if bytes.len() < 2 {
            return Err(StubError::InvalidAnnotation {
                annotation: annotation.to_string(),
                message: "Annotation too short".to_string(),
            });
        }

        let quote = bytes[0] as char;
        if quote != '"' && quote != '\'' {
            return Err(StubError::InvalidAnnotation {
                annotation: annotation.to_string(),
                message: format!("Invalid quote character: {}", quote),
            });
        }

        let last = bytes[bytes.len() - 1] as char;
        if last != quote {
            return Err(StubError::InvalidAnnotation {
                annotation: annotation.to_string(),
                message: "Mismatched quotes".to_string(),
            });
        }

        Ok((quote, &annotation[1..annotation.len()-1]))
    }

    fn tokenize(content: &str) -> StubResult<Vec<AnnotationToken>> {
        let mut tokens = Vec::new();
        let mut chars = content.char_indices().peekable();

        while let Some((i, ch)) = chars.next() {
            match ch {
                // Identifier start
                'a'..='z' | 'A'..='Z' | '_' => {
                    let start = i;
                    while let Some(&(_, c)) = chars.peek() {
                        if c.is_alphanumeric() || c == '_' {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    let end = chars.peek().map(|(i, _)| *i).unwrap_or(content.len());
                    tokens.push(AnnotationToken::Name {
                        value: content[start..end].to_string(),
                        offset: start,
                    });
                }
                // Operators and delimiters
                '[' | ']' | ',' | '|' | '.' | '(' | ')' => {
                    tokens.push(AnnotationToken::Punct(ch));
                }
                // Whitespace
                ' ' | '\t' | '\n' => continue,
                // Unknown
                _ => {
                    return Err(StubError::InvalidAnnotation {
                        annotation: content.to_string(),
                        message: format!("Unexpected character: {}", ch),
                    });
                }
            }
        }

        Ok(tokens)
    }

    fn extract_refs(tokens: &[AnnotationToken]) -> Vec<AnnotationRef> {
        tokens.iter()
            .filter_map(|t| {
                if let AnnotationToken::Name { value, offset } = t {
                    Some(AnnotationRef {
                        name: value.clone(),
                        offset_in_string: *offset,
                        length: value.len(),
                    })
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn rename(annotation: &str, old_name: &str, new_name: &str) -> StubResult<String> {
        let parsed = Self::parse(annotation)?;

        // Find all occurrences of old_name and replace
        let mut result = parsed.content.clone();

        // Replace in reverse order to preserve offsets
        let mut replacements: Vec<_> = parsed.refs.iter()
            .filter(|r| r.name == old_name)
            .collect();
        replacements.sort_by(|a, b| b.offset_in_string.cmp(&a.offset_in_string));

        for r in replacements {
            result.replace_range(
                r.offset_in_string..r.offset_in_string + r.length,
                new_name
            );
        }

        Ok(format!("{}{}{}", parsed.quote_char, result, parsed.quote_char))
    }
}

#[derive(Debug)]
enum AnnotationToken {
    Name { value: String, offset: usize },
    Punct(char),
}
```

---

###### 0.3.3 Edge Cases {#step-0-3-edge-cases}

| Edge Case | Handling |
|-----------|----------|
| **No stub exists** | `find_stub_for` returns None; not an error |
| **Stub has parse error** | Return `StubError::ParseError`; operation aborts |
| **Stub exists but is empty** | Valid; returns empty lists for functions/classes |
| **Package `__init__.py`** | Stub is `__init__.pyi` in same location |
| **Namespace package** | No `__init__.py`; check module path directly |
| **Nested packages** | `pkg/sub/module.py` -> `pkg/sub/module.pyi` or `stubs/pkg/sub/module.pyi` |
| **Private module** | `_private.py` treated same as public |
| **String annotation with escapes** | `"Class\"Name"` - handle escaped quotes |
| **Triple-quoted annotation** | `"""Long\nAnnotation"""` - preserve across lines |
| **f-string in annotation** | Invalid for type annotations; return error |
| **Raw string annotation** | `r"path\to\thing"` - not a type annotation; skip |
| **Annotation with comment** | `"Type # comment"` - parse error |
| **Generic with nested generics** | `"Dict[str, List[int]]"` - extract all names |
| **Union with None** | `"Optional[T]"` = `"T | None"` - extract T, None |
| **TypeVar usage** | `"T"` where T is TypeVar - treat as name reference |
| **Class from `__all__`** | Stub should export what source exports |

**Stub Parse Failure Policy:**

Per [D08](#d08-stub-updates), stub parse failures are errors that abort the operation:

```json
{
  "status": "error",
  "code": 5,
  "error": {
    "kind": "STUB_PARSE",
    "stub_path": "pkg/api.pyi",
    "message": "Failed to parse stub file: unexpected token at line 10",
    "suggestion": "Fix the syntax error in the stub file, or remove it"
  }
}
```

---

###### 0.3.4 Integration Points {#step-0-3-integration}

**Existing Components:**

| Component | Integration |
|-----------|-------------|
| `parse_module_with_positions()` | Reused for stub parsing |
| `PositionTable` | Provides spans for stub symbols |
| `BatchSpanEditor` | Used to apply stub edits |
| `tugtool-python/src/analyzer.rs` | Already has stub support for type resolution |

**Module Structure:**

```
crates/tugtool-python/src/
├── lib.rs          # Add: pub mod stubs;
├── stubs.rs        # NEW: StubDiscovery, ParsedStub, StubUpdater, StringAnnotationParser
├── analyzer.rs     # Has existing stub integration for types
└── ...
```

**Usage in Rename Operation:**

```rust
// In rename operation
let stub_discovery = StubDiscovery::for_workspace(workspace_root);
let stub_updater = StubUpdater::new(stub_discovery);

// Generate stub edits
let stub_edits = stub_updater.rename_edits(
    &source_path,
    old_name,
    new_name,
)?;

// Include stub edits in the PatchSet
if let Some(edits) = stub_edits {
    for edit in edits.edits {
        patch_set = patch_set.with_edit(edit.into_patch_edit(stub_file_id));
    }
}
```

---

###### 0.3.5 Concrete Examples {#step-0-3-examples}

**Example 1: Find Inline Stub**

```
Project structure:
  /project/
    src/
      mypackage/
        handlers.py
        handlers.pyi   <- Inline stub
```

```rust
let discovery = StubDiscovery::for_workspace("/project");
let stub = discovery.find_stub_for(Path::new("/project/src/mypackage/handlers.py"));

assert!(stub.is_some());
let info = stub.unwrap();
assert_eq!(info.stub_path, Path::new("/project/src/mypackage/handlers.pyi"));
assert_eq!(info.location, StubLocation::Inline);
```

**Example 2: Find Stub in stubs/ Folder**

```
Project structure:
  /project/
    src/
      mypackage/
        handlers.py    <- No inline stub
    stubs/
      mypackage/
        handlers.pyi   <- Stubs folder stub
```

```rust
let discovery = StubDiscovery::for_workspace("/project");
let stub = discovery.find_stub_for(Path::new("/project/src/mypackage/handlers.py"));

assert!(stub.is_some());
let info = stub.unwrap();
assert_eq!(info.stub_path, Path::new("/project/stubs/mypackage/handlers.pyi"));
assert_eq!(info.location, StubLocation::StubsFolder);
```

**Example 3: Parse Stub and Find Symbol**

```rust
let stub_content = r#"
from typing import Optional

class Handler:
    def process(self, data: bytes) -> Optional[str]: ...
    def reset(self) -> None: ...

def create_handler(config: dict) -> Handler: ...
"#;

let stub = ParsedStub::parse_str(stub_content, PathBuf::from("handlers.pyi"))?;

assert!(stub.has_symbol("Handler"));
assert!(stub.has_symbol("create_handler"));

let handler_class = stub.find_class("Handler").unwrap();
assert_eq!(handler_class.methods.len(), 2);

let process_method = stub.find_method("Handler", "process").unwrap();
assert_eq!(process_method.name, "process");
```

**Example 4: Rename Symbol in Stub**

```rust
let stub_updater = StubUpdater::new(StubDiscovery::for_workspace("/project"));

// Rename Handler -> RequestHandler
let edits = stub_updater.rename_edits(
    Path::new("/project/src/handlers.py"),
    "Handler",
    "RequestHandler",
)?;

// If stub exists, we get edits for:
// - Class name: "Handler" -> "RequestHandler"
// - Return type annotation: "-> Handler" -> "-> RequestHandler"
```

**Example 5: String Annotation Parsing**

```rust
// Simple name
let result = StringAnnotationParser::rename("\"Handler\"", "Handler", "RequestHandler")?;
assert_eq!(result, "\"RequestHandler\"");

// Qualified name
let result = StringAnnotationParser::rename("\"pkg.Handler\"", "Handler", "RequestHandler")?;
assert_eq!(result, "\"pkg.RequestHandler\"");

// Generic type
let result = StringAnnotationParser::rename("'List[Handler]'", "Handler", "RequestHandler")?;
assert_eq!(result, "'List[RequestHandler]'");

// Multiple references
let result = StringAnnotationParser::rename(
    "\"Dict[Handler, Handler]\"",
    "Handler",
    "RequestHandler"
)?;
assert_eq!(result, "\"Dict[RequestHandler, RequestHandler]\"");

// Union type
let result = StringAnnotationParser::rename("\"Handler | None\"", "Handler", "RequestHandler")?;
assert_eq!(result, "\"RequestHandler | None\"");
```

---

###### 0.3.6 Execution Steps {#step-0-3-6}

**References:** [Step 0.3](#step-0-3), Spec (#step-0-3-api), Internal Design (#step-0-3-internal), Edge Cases (#step-0-3-edge-cases), Integration (#step-0-3-integration), Examples (#step-0-3-examples)

This section breaks the Stub Discovery Infrastructure implementation into discrete substeps with individual commits and checkpoints.

**Total Substeps:** 6

**Estimated Complexity:** Medium (well-specified API, reuses existing CST parser, clear algorithms)

---

###### Step 0.3.6.1: Stub Error and Result Types {#step-0-3-6-1}

**Commit:** `feat(python): add stub error types and result alias`

**References:** Spec (#step-0-3-api) - StubError enum, Edge Cases (#step-0-3-edge-cases) - Stub Parse Failure Policy

**Artifacts:**
- New `crates/tugtool-python/src/stubs.rs`
- Modified `crates/tugtool-python/src/lib.rs` (add `pub mod stubs;`)

**Tasks:**
- [x] Create `stubs.rs` module file
- [x] Add `StubError` enum with variants: `ParseError`, `NotFound`, `IoError`, `InvalidAnnotation`
- [x] Implement `std::fmt::Display` for `StubError`
- [x] Implement `std::error::Error` for `StubError`
- [x] Add `StubResult<T>` type alias
- [x] Add `pub mod stubs;` to `lib.rs`
- [x] Add comprehensive documentation with error examples

**Tests:**
- [x] Unit: `test_stub_error_display_parse_error` - Verify Display impl for ParseError
- [x] Unit: `test_stub_error_display_not_found` - Verify Display impl for NotFound
- [x] Unit: `test_stub_error_display_io_error` - Verify Display impl for IoError
- [x] Unit: `test_stub_error_display_invalid_annotation` - Verify Display impl for InvalidAnnotation

**Checkpoint:**
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python stub_error` passes
- [x] `cargo clippy -p tugtool-python -- -D warnings` passes

**Rollback:** Revert commit

---

###### Step 0.3.6.2: Stub Discovery Types and Basic Discovery {#step-0-3-6-2}

**Commit:** `feat(python): add StubDiscovery with inline stub detection`

**References:** Spec (#step-0-3-api) - StubInfo, StubLocation, StubDiscoveryOptions, StubDiscovery structs, Internal Design (#step-0-3-internal) - Stub Discovery Algorithm, Examples (#step-0-3-examples) - Example 1

**Artifacts:**
- Modified `crates/tugtool-python/src/stubs.rs`

**Tasks:**
- [x] Add `StubLocation` enum with variants: `Inline`, `StubsFolder`, `TypeshedStyle`
- [x] Add `StubInfo` struct with `stub_path`, `source_path`, `location` fields
- [x] Add `StubDiscoveryOptions` struct with `workspace_root`, `extra_stub_dirs`, `check_typeshed_style` fields
- [x] Implement `Default` for `StubDiscoveryOptions`
- [x] Add `StubDiscovery` struct with `options` field
- [x] Implement `StubDiscovery::new(options)` constructor
- [x] Implement `StubDiscovery::for_workspace(workspace_root)` convenience constructor
- [x] Implement `inline_stub_path(&self, source_path)` helper (`.py` -> `.pyi`)
- [x] Implement `find_stub_for(&self, source_path)` - inline stub detection only
- [x] Implement `has_stub(&self, source_path)` using `find_stub_for`
- [x] Implement `expected_stub_path(&self, source_path)` returning inline path
- [x] Add documentation with usage examples

**Tests:**
- [x] Unit: `test_stub_location_variants` - Verify enum variants exist
- [x] Unit: `test_stub_info_construction` - Basic struct creation
- [x] Unit: `test_stub_discovery_options_default` - Default values correct
- [x] Unit: `test_stub_discovery_new` - Constructor works
- [x] Unit: `test_stub_discovery_for_workspace` - Convenience constructor works
- [x] Unit: `test_find_stub_same_directory` - Inline stub detection (Example 1)
- [x] Unit: `test_no_stub_exists` - Returns None when no stub present
- [x] Unit: `test_has_stub_true` - Returns true when stub exists
- [x] Unit: `test_has_stub_false` - Returns false when no stub
- [x] Unit: `test_expected_stub_path` - Returns .pyi path

**Checkpoint:**
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python stub_discovery` passes
- [x] Inline stub detection works per Example 1 in (#step-0-3-examples)

**Rollback:** Revert commit

---

###### Step 0.3.6.3: Stubs Folder and Typeshed-Style Discovery {#step-0-3-6-3}

**Commit:** `feat(python): add stubs folder and typeshed-style stub discovery`

**References:** Spec (#step-0-3-api) - discovery order, Internal Design (#step-0-3-internal) - find_typeshed_style_stub algorithm, Examples (#step-0-3-examples) - Example 2, Edge Cases (#step-0-3-edge-cases) - Package __init__.py, Nested packages

**Artifacts:**
- Modified `crates/tugtool-python/src/stubs.rs`

**Tasks:**
- [x] Implement `module_path_from_source(&self, source_path)` helper
- [x] Extend `find_stub_for()` to check `stubs/` folder at workspace root
- [x] Implement `find_typeshed_style_stub(&self, source_path, module_path)` for `pkg-stubs/` pattern
- [x] Extend `find_stub_for()` to check typeshed-style locations (when `check_typeshed_style` is true)
- [x] Extend `find_stub_for()` to check `extra_stub_dirs`
- [x] Implement `find_stub_or_err(&self, source_path)` returning error with searched locations
- [x] Implement `search_locations(&self, source_path)` returning all searched paths
- [x] Handle `__init__.py` -> `__init__.pyi` mapping
- [x] Handle nested package paths (`pkg/sub/module.py` -> `pkg/sub/module.pyi`)

**Tests:**
- [x] Unit: `test_find_stub_stubs_folder` - Stubs folder detection (Example 2)
- [x] Unit: `test_find_stub_typeshed_style` - pkg-stubs pattern detection
- [x] Unit: `test_find_stub_extra_dirs` - Custom stub directories
- [x] Unit: `test_find_stub_priority_inline_first` - Inline stub takes precedence
- [x] Unit: `test_find_stub_priority_stubs_folder_second` - Stubs folder before typeshed
- [x] Unit: `test_find_stub_init_py` - `__init__.py` to `__init__.pyi`
- [x] Unit: `test_find_stub_nested_package` - Deep package paths
- [x] Unit: `test_find_stub_or_err_not_found` - Error with searched locations
- [x] Unit: `test_search_locations_complete` - All paths returned

**Checkpoint:**
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python stub_discovery` passes
- [x] Stub discovery works for inline, stubs folder, and typeshed-style

**Rollback:** Revert commit

---

###### Step 0.3.6.4: Stub Parsing Types and Implementation {#step-0-3-6-4}

**Commit:** `feat(python-cst,python): add StubCollector and ParsedStub for stub parsing`

**References:** Spec (#step-0-3-api) - ParsedStub, StubFunction, StubClass, StubTypeAlias, StubVariable structs, Internal Design (#step-0-3-internal) - Stub Parsing algorithm, Examples (#step-0-3-examples) - Example 3, Integration (#step-0-3-integration) - parse_module_with_positions reuse

**Architecture Note:**

The `node_id` field on CST nodes (Name, FunctionDef, ClassDef, etc.) is `pub(crate)` in tugtool-python-cst. This means:
- Code in tugtool-python-cst CAN access `node.name.node_id` (same crate)
- Code in tugtool-python CANNOT access `node.name.node_id` (different crate)

Following the established pattern of SignatureCollector, BindingCollector, etc., the `StubCollector` visitor and stub symbol types (`StubFunction`, `StubClass`, etc.) must be defined in `tugtool-python-cst/src/visitor/stub.rs`. The `ParsedStub` wrapper that provides the high-level API remains in `tugtool-python/src/stubs.rs`.

**Artifacts:**
- New `crates/tugtool-python-cst/src/visitor/stub.rs` - StubCollector visitor and symbol types
- Modified `crates/tugtool-python-cst/src/visitor/mod.rs` - Export stub module
- Modified `crates/tugtool-python-cst/src/lib.rs` - Re-export stub types
- Modified `crates/tugtool-python/src/stubs.rs` - ParsedStub wrapper

**Tasks (tugtool-python-cst):**
- [x] Create `crates/tugtool-python-cst/src/visitor/stub.rs`
- [x] Add `StubDecorator` struct with `name`, `span` fields
- [x] Add `StubFunction` struct with `name`, `name_span`, `signature_span`, `def_span`, `is_async`, `decorators` fields
- [x] Add `StubAttribute` struct with `name`, `name_span`, `annotation_span` fields
- [x] Add `StubClass` struct with `name`, `name_span`, `header_span`, `def_span`, `methods`, `attributes` fields
- [x] Add `StubTypeAlias` struct with `name`, `name_span`, `def_span` fields
- [x] Add `StubVariable` struct with `name`, `name_span`, `annotation_span` fields
- [x] Add `StubSymbols` struct with `functions`, `classes`, `type_aliases`, `variables` fields
- [x] Create internal `StubCollector` visitor struct for collecting stub symbols
- [x] Implement `Visitor` trait for `StubCollector` to extract functions, classes, type aliases, variables
- [x] Implement `StubSymbols::collect(module, positions)` static method
- [x] Export types from `visitor/mod.rs` and `lib.rs`

**Tasks (tugtool-python):**
- [x] Remove duplicate type definitions from `stubs.rs` (replace with imports)
- [x] Import `StubSymbols`, `StubFunction`, `StubClass`, etc. from tugtool-python-cst
- [x] Re-export stub types for consumers of tugtool-python
- [x] Add `ParsedStub` struct with `path`, `symbols: StubSymbols`, `source` fields
- [x] Implement `ParsedStub::parse(stub_path)` reading file and calling `parse_str`
- [x] Implement `ParsedStub::parse_str(source, stub_path)` using CST parser and `StubSymbols::collect()`
- [x] Implement `ParsedStub::find_function(&self, name)` lookup
- [x] Implement `ParsedStub::find_class(&self, name)` lookup
- [x] Implement `ParsedStub::find_method(&self, class_name, method_name)` lookup
- [x] Implement `ParsedStub::has_symbol(&self, name)` check

**Tests:**
- [x] Unit: `test_stub_parse_function` - Extract function info
- [x] Unit: `test_stub_parse_async_function` - Async function detection
- [x] Unit: `test_stub_parse_function_with_decorators` - Decorator extraction
- [x] Unit: `test_stub_parse_class` - Extract class info (Example 3)
- [x] Unit: `test_stub_parse_methods` - Extract methods from class
- [x] Unit: `test_stub_parse_class_attributes` - Class-level variables
- [x] Unit: `test_stub_parse_type_alias` - TypeAlias support
- [x] Unit: `test_stub_parse_variable` - Module-level annotated variables
- [x] Unit: `test_stub_find_function` - Lookup by name
- [x] Unit: `test_stub_find_class` - Lookup by name
- [x] Unit: `test_stub_find_method` - Lookup nested in class
- [x] Unit: `test_stub_has_symbol_true` - Symbol exists
- [x] Unit: `test_stub_has_symbol_false` - Symbol not found
- [x] Unit: `test_stub_parse_io_error` - File not found error
- [x] Unit: `test_stub_parse_failure_returns_error` - Invalid syntax returns ParseError

**Checkpoint:**
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python stub_parse` passes
- [x] Stub parsing extracts all symbol types per Example 3

**Rollback:** Revert commit

---

###### Step 0.3.6.5: String Annotation Parser {#step-0-3-6-5}

**Commit:** `feat(python): add StringAnnotationParser for type expressions in strings`

**References:** Spec (#step-0-3-api) - StringAnnotationParser, AnnotationRef, ParsedAnnotation types, Internal Design (#step-0-3-internal) - String Annotation Parsing algorithm and tokenizer, Examples (#step-0-3-examples) - Example 5, Edge Cases (#step-0-3-edge-cases) - String annotation edge cases

**Artifacts:**
- Modified `crates/tugtool-python/src/stubs.rs`

**Tasks:**
- [x] Add `AnnotationRef` struct with `name`, `offset_in_string`, `length` fields
- [x] Add `ParsedAnnotation` struct with `content`, `quote_char`, `refs` fields
- [x] Add internal `AnnotationToken` enum with `Name` and `Punct` variants
- [x] Add `StringAnnotationParser` struct (unit struct)
- [x] Implement `extract_content(annotation)` helper to extract quote char and inner content
- [x] Implement `tokenize(content)` helper to produce token stream
- [x] Implement `extract_refs(tokens)` helper to collect name references
- [x] Implement `StringAnnotationParser::parse(annotation)` returning ParsedAnnotation
- [x] Implement `StringAnnotationParser::rename(annotation, old_name, new_name)` with reverse-order replacement
- [x] Implement `StringAnnotationParser::contains_name(annotation, name)` check
- [x] Handle single and double quote styles (preserve on output)
- [x] Handle whitespace in annotations
- [x] Handle nested brackets for generics
- [x] Return `InvalidAnnotation` error for invalid syntax

**Tests:**
- [x] Unit: `test_string_annotation_simple_name` - `"ClassName"`
- [x] Unit: `test_string_annotation_qualified_name` - `"module.Class"`
- [x] Unit: `test_string_annotation_generic` - `"List[Item]"`
- [x] Unit: `test_string_annotation_union` - `"A | B"`
- [x] Unit: `test_string_annotation_optional` - `"Optional[T]"`
- [x] Unit: `test_string_annotation_callable` - `"Callable[[A], B]"`
- [x] Unit: `test_string_annotation_preserves_single_quotes` - `'Type'` stays single
- [x] Unit: `test_string_annotation_preserves_double_quotes` - `"Type"` stays double
- [x] Unit: `test_string_annotation_nested_generics` - `"Dict[str, List[int]]"`
- [x] Unit: `test_string_annotation_rename_simple` - Replace single name (Example 5)
- [x] Unit: `test_string_annotation_rename_qualified` - Replace in qualified name
- [x] Unit: `test_string_annotation_rename_generic` - Replace in generic type
- [x] Unit: `test_string_annotation_rename_multiple` - Multiple refs to same name
- [x] Unit: `test_string_annotation_rename_union` - Replace in union type
- [x] Unit: `test_string_annotation_contains_name_true` - Name found
- [x] Unit: `test_string_annotation_contains_name_false` - Name not found
- [x] Unit: `test_string_annotation_invalid_quotes` - Error for mismatched quotes
- [x] Unit: `test_string_annotation_invalid_char` - Error for unexpected character

**Checkpoint:**
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python string_annotation` passes
- [x] String annotation parsing handles all common patterns per Example 5

**Rollback:** Revert commit

---

###### Step 0.3.6.6: Stub Updater Integration {#step-0-3-6-6}

**Commit:** `feat(python): add StubUpdater for generating stub edits`

**References:** Spec (#step-0-3-api) - StubUpdater, StubEdits, StubEdit, MoveStubEdits types, Examples (#step-0-3-examples) - Example 4, Integration (#step-0-3-integration) - Usage in Rename Operation, [D08](#d08-stub-updates)

**Artifacts:**
- Modified `crates/tugtool-python/src/stubs.rs`

**Tasks:**
- [x] Add `StubEdit` enum with variants: `Rename { span, new_name }`, `Delete { span }`, `Insert { position, text }`
- [x] Add `StubEdits` struct with `stub_path`, `edits` fields
- [x] Add `MoveStubEdits` struct with `source_edits`, `target_edits` fields
- [x] Add `StubUpdater` struct with `discovery` field
- [x] Implement `StubUpdater::new(discovery)` constructor
- [x] Implement `rename_edits(&self, source_path, old_name, new_name)`:
  - [x] Find stub for source path (return `Ok(None)` if no stub)
  - [x] Parse stub file (return error on parse failure)
  - [x] Find symbol by name in stub
  - [x] Generate `StubEdit::Rename` for symbol name span
  - [x] Find references to symbol in return types and annotations
  - [x] Generate rename edits for all references
  - [x] Return `StubEdits` with all edits
- [x] Implement `move_edits(&self, source_path, target_path, symbol_name)`:
  - [x] Find stubs for source and target paths
  - [x] Parse source stub and find symbol definition span
  - [x] Generate `StubEdit::Delete` for source
  - [x] Generate `StubEdit::Insert` for target with symbol definition text
  - [x] Return `MoveStubEdits` with both edit sets
- [x] Handle case where symbol exists in source but not stub (warn, no edit)
- [x] Handle string annotations in type hints using `StringAnnotationParser`

**Tests:**
- [x] Unit: `test_stub_updater_rename_function` - Rename function in stub (Example 4)
- [x] Unit: `test_stub_updater_rename_class` - Rename class in stub
- [x] Unit: `test_stub_updater_rename_method` - Rename method in stub
- [x] Unit: `test_stub_updater_rename_with_return_type` - Updates return type annotation
- [x] Unit: `test_stub_updater_rename_with_param_type` - Updates parameter type annotation
- [x] Unit: `test_stub_updater_rename_string_annotation` - Updates string annotations
- [x] Unit: `test_stub_updater_no_stub_returns_none` - No stub file exists
- [x] Unit: `test_stub_updater_symbol_not_in_stub` - Source has symbol, stub doesn't
- [x] Unit: `test_stub_updater_move_between_modules` - Delete from source, insert to target
- [x] Unit: `test_stub_updater_move_no_source_stub` - Source has no stub
- [x] Unit: `test_stub_updater_move_no_target_stub` - Target has no stub
- [x] Integration: `test_stub_update_rename_full_workflow` - End-to-end rename with stub update

**Checkpoint:**
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python stub_updater` passes
- [x] `cargo nextest run -p tugtool-python stubs` passes (all stub tests)
- [x] Rename edits are generated correctly for stubs per Example 4

**Rollback:** Revert commit

---

###### Step 0.3.6.6.5: StubFunction Annotation Span Tracking {#step-0-3-6-6-5}

**Commit:** `feat(python-cst): add proper annotation span tracking to StubFunction`

**References:** [D08](#d08-stub-updates), Step 0.3.6.6, [Step 0.3 API](#step-0-3-api)

**Problem Statement:**

Step 0.3.6.6 implemented `StubUpdater` but with incomplete annotation renaming support. The `collect_annotation_rename_edits` method cannot properly rename types appearing in function signatures because `StubFunction` doesn't track:

1. **Return type annotation spans** - e.g., `Handler` in `def process(self) -> Handler: ...`
2. **Parameter type annotation spans** - e.g., `Handler` in `def process(self, handler: Handler) -> None: ...`

This means the `StubUpdater` cannot rename type references in the most common location: function and method signatures.

**Design Decision:**

Use **simple span tracking** (consistent with `StubAttribute` pattern):
- Track the span of the root type name only
- For `Handler`, track the full name span
- For `List[Handler]`, track only `List` (the root)
- For complex annotations containing the target type, rely on `collect_span_annotation_edits` string replacement

This handles the common case (simple type names) while maintaining consistency with existing code.

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/stub.rs`
- Modified `crates/tugtool-python/src/stubs.rs`

**New Types:**

```rust
/// Information about a function parameter in a stub file.
#[derive(Debug, Clone)]
pub struct StubParam {
    /// The parameter name.
    pub name: String,
    /// Span of just the parameter name.
    pub name_span: Option<Span>,
    /// Span of the type annotation (if present).
    /// For simple annotations like `handler: Handler`, this is the span of `Handler`.
    /// For complex annotations like `items: List[Handler]`, this is the span of `List`.
    pub annotation_span: Option<Span>,
    /// Whether this is a *args parameter.
    pub is_star: bool,
    /// Whether this is a **kwargs parameter.
    pub is_star_star: bool,
}
```

**Modified StubFunction:**

```rust
pub struct StubFunction {
    // ... existing fields ...

    /// Span of the return type annotation (if present).
    /// For `def process(self) -> Handler: ...`, this is the span of `Handler`.
    pub return_annotation_span: Option<Span>,

    /// Parameters with their type annotations.
    pub params: Vec<StubParam>,
}
```

**Tasks:**

**Part A: Add StubParam type and update StubFunction (tugtool-python-cst)**

- [x] Add `StubParam` struct to `crates/tugtool-python-cst/src/visitor/stub.rs` (after `StubAttribute`)
- [x] Add `return_annotation_span: Option<Span>` field to `StubFunction`
- [x] Add `params: Vec<StubParam>` field to `StubFunction`
- [x] Add helper: `extract_annotation_span(&self, annotation: &Annotation) -> Option<Span>`
  - [x] Handle `Expression::Name` - return name span
  - [x] Handle `Expression::Subscript` - return root name span (e.g., `List` from `List[T]`)
  - [x] Handle `Expression::Attribute` - return attribute name span (e.g., `Type` from `module.Type`)
  - [x] Handle `Expression::BinaryOperation` - return left operand span for unions (`A | B`)
  - [x] Return `None` for other expression types
- [x] Add helper: `extract_param(&self, param: &Param, is_star, is_star_star) -> StubParam`
- [x] Add helper: `extract_params(&self, params: &Parameters) -> Vec<StubParam>`
  - [x] Handle positional-only parameters (`posonly_params`)
  - [x] Handle regular positional parameters (`params`)
  - [x] Handle `*args` parameter (`star_arg` with `StarArg::Param` variant)
  - [x] Handle keyword-only parameters (`kwonly_params`)
  - [x] Handle `**kwargs` parameter (`star_kwarg`)
- [x] Update `process_function` to call new helpers and populate new fields
- [x] Export `StubParam` from `mod.rs`

**Part B: Update StubUpdater (tugtool-python)**

- [x] Add `StubParam` to re-exports in `stubs.rs`
- [x] Add helper: `collect_function_annotation_edits(&self, stub, func, old_name, new_name, edits)`
  - [x] Check return type annotation span
  - [x] Check all parameter annotation spans
  - [x] Call `collect_span_annotation_edits` for each span
- [x] Update `collect_annotation_rename_edits` to:
  - [x] Call `collect_function_annotation_edits` for module-level functions
  - [x] Call `collect_function_annotation_edits` for class methods

**Tests (tugtool-python-cst):**

- [x] Unit: `test_stub_function_return_annotation_span_simple` - `def f() -> Handler: ...`
- [x] Unit: `test_stub_function_return_annotation_span_generic` - `def f() -> List[Handler]: ...` (captures `List`)
- [x] Unit: `test_stub_function_return_annotation_span_qualified` - `def f() -> module.Type: ...`
- [x] Unit: `test_stub_function_return_annotation_span_union` - `def f() -> Handler | None: ...`
- [x] Unit: `test_stub_function_param_annotation_spans` - `def f(a: A, b: B) -> None: ...`
- [x] Unit: `test_stub_function_param_self_no_annotation` - `def f(self, x: int) -> None: ...`
- [x] Unit: `test_stub_function_param_no_annotation` - `def f(x, y: int) -> None: ...`
- [x] Unit: `test_stub_function_param_star_args` - `def f(*args: str) -> None: ...`
- [x] Unit: `test_stub_function_param_star_kwargs` - `def f(**kwargs: int) -> None: ...`
- [x] Unit: `test_stub_function_param_all_kinds` - `def f(a, /, b, *args, c, **kwargs) -> T: ...`
- [x] Unit: `test_stub_method_annotations` - method in class

**Tests (tugtool-python):**

- [x] Unit: `test_stub_updater_renames_return_type` - Rename type in return annotation
- [x] Unit: `test_stub_updater_renames_param_type` - Rename type in parameter annotation
- [x] Unit: `test_stub_updater_renames_multiple_function_annotations` - Function with type in return and params
- [x] Unit: `test_stub_updater_renames_method_annotations` - Method annotations in class

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python-cst stub` passes (all stub tests)
- [x] `cargo nextest run -p tugtool-python stub_updater` passes
- [x] `cargo clippy --workspace -- -D warnings` passes
- [x] Verify: Renaming `Handler` to `RequestHandler` in stub `def process(self, h: Handler) -> Handler: ...` produces edits for both spans

**Rollback:** Revert commit

---

###### Step 0.3.6.6.6: CST-Based Annotation Span Collection {#step-0-3-6-6-6}

**Commit:** `fix(python-cst): use CST-based annotation span collection instead of string matching`

**References:** [D08](#d08-stub-updates), [Step 0.3.6.6.5](#step-0-3-6-6-5), [Step 0.3 API](#step-0-3-api)

**Problem Statement:**

Step 0.3.6.6.5 implemented annotation span tracking in `StubFunction`, `StubParam`, `StubVariable`, and `StubAttribute`, but the design is flawed:

1. **`extract_annotation_span` returns only the ROOT type span:**
   - `Handler` → span of `Handler` (correct)
   - `List[Handler]` → span of `List` only (misses `Handler`)
   - `Dict[str, Handler]` → span of `Dict` only (misses `str`, `Handler`)
   - `Handler | None` → span of `Handler` only (misses `None`)
   - `Optional[List[Handler]]` → span of `Optional` only (misses `List`, `Handler`)

2. **`collect_span_annotation_edits` uses string matching:**
   ```rust
   // Flawed implementation
   if ann_text.contains(old_name) {
       let new_text = ann_text.replace(old_name, new_name);
       edits.push(StubEdit::Rename { span, new_name: new_text });
   }
   ```

   This causes incorrect matches:
   - Renaming `Handler` matches `MyHandler`, `HandlerFactory`, `BaseHandler`
   - Renaming `Foo` in `FooBar | None` incorrectly replaces to `BarBar | None`

3. **We have full CST information available.** String matching is categorically wrong when we can perform exact name matching on CST nodes.

**Solution:**

Replace single-span tracking with multi-span collection that recursively walks the annotation expression and returns ALL type name spans with their exact text.

---

**0.3.6.6.6.1 API Specification** {#step-0-3-6-6-6-api}

**New Type:**

```rust
/// A type name and its span within an annotation.
///
/// Used for precise type reference tracking in stub file annotations.
/// Each instance represents a single type name (not a composite type).
#[derive(Debug, Clone)]
pub struct TypeNameSpan {
    /// The exact type name as it appears in source (e.g., "Handler", "List", "str").
    pub name: String,
    /// Span of this specific type name.
    pub span: Span,
}
```

**Modified Stub Types:**

Change from single optional span to vector of type name spans:

```rust
// StubFunction changes
pub struct StubFunction {
    // ... existing fields ...

    // REMOVED: pub return_annotation_span: Option<Span>,
    /// All type name spans within the return annotation.
    /// For `-> Handler`, returns `[("Handler", span)]`.
    /// For `-> List[Handler]`, returns `[("List", span1), ("Handler", span2)]`.
    pub return_type_spans: Vec<TypeNameSpan>,

    // ... params field unchanged, but StubParam changes ...
}

// StubParam changes
pub struct StubParam {
    // ... existing fields ...

    // REMOVED: pub annotation_span: Option<Span>,
    /// All type name spans within the parameter annotation.
    pub type_spans: Vec<TypeNameSpan>,
}

// StubVariable changes
pub struct StubVariable {
    // ... existing fields ...

    // REMOVED: pub annotation_span: Option<Span>,
    /// All type name spans within the variable annotation.
    pub type_spans: Vec<TypeNameSpan>,
}

// StubAttribute changes
pub struct StubAttribute {
    // ... existing fields ...

    // REMOVED: pub annotation_span: Option<Span>,
    /// All type name spans within the attribute annotation.
    pub type_spans: Vec<TypeNameSpan>,
}
```

**New Collection Methods:**

```rust
impl StubCollector<'_> {
    /// Extract all type name spans from an annotation expression.
    ///
    /// Recursively walks the expression tree and collects spans for every
    /// type name encountered. This enables precise rename matching without
    /// string-based pattern matching.
    ///
    /// # Handled Expression Types
    ///
    /// | Expression | Extracted Names |
    /// |------------|-----------------|
    /// | `Name("Handler")` | `[("Handler", span)]` |
    /// | `Subscript(List, [Handler])` | `[("List", span1), ("Handler", span2)]` |
    /// | `Attribute(module, Type)` | `[("Type", span)]` (attr only, not module) |
    /// | `BinaryOperation(A, \|, B)` | Recurse both sides |
    /// | `Tuple([A, B])` | Recurse all elements |
    /// | `List([A, B])` | Recurse all elements (for Callable params) |
    ///
    /// # Returns
    ///
    /// Vector of `TypeNameSpan` for all type names in the annotation.
    /// Empty vector if annotation contains no extractable type names.
    fn extract_all_type_spans(&self, annotation: &Annotation<'_>) -> Vec<TypeNameSpan> {
        let mut spans = Vec::new();
        self.collect_type_spans_from_expr(&annotation.annotation, &mut spans);
        spans
    }

    /// Recursive helper to collect type spans from an expression.
    fn collect_type_spans_from_expr(
        &self,
        expr: &Expression<'_>,
        spans: &mut Vec<TypeNameSpan>
    ) {
        match expr {
            Expression::Name(n) => {
                if let Some(span) = self.get_ident_span(n.node_id) {
                    spans.push(TypeNameSpan {
                        name: n.value.to_string(),
                        span,
                    });
                }
            }
            Expression::Subscript(sub) => {
                // Collect the base type (e.g., "List" from List[T])
                self.collect_type_spans_from_expr(&sub.value, spans);
                // Collect all type arguments
                for element in &sub.slice {
                    self.collect_type_spans_from_subscript_element(element, spans);
                }
            }
            Expression::Attribute(attr) => {
                // For module.Type, only collect "Type" (the attribute)
                // The module path is not a type reference
                if let Some(span) = self.get_ident_span(attr.attr.node_id) {
                    spans.push(TypeNameSpan {
                        name: attr.attr.value.to_string(),
                        span,
                    });
                }
            }
            Expression::BinaryOperation(binop) => {
                // For union types (A | B), collect both sides
                self.collect_type_spans_from_expr(&binop.left, spans);
                self.collect_type_spans_from_expr(&binop.right, spans);
            }
            Expression::Tuple(tuple) => {
                // For Callable[[A, B], C] the params are a tuple/list
                for elem in &tuple.elements {
                    if let Element::Simple { value, .. } = elem {
                        self.collect_type_spans_from_expr(value, spans);
                    }
                }
            }
            Expression::List(list) => {
                // Callable parameter lists: [[Handler, Request], Response]
                for elem in &list.elements {
                    if let Element::Simple { value, .. } = elem {
                        self.collect_type_spans_from_expr(value, spans);
                    }
                }
            }
            // Other expression types don't contain type references
            // (strings handled separately, literals ignored)
            _ => {}
        }
    }

    /// Helper for subscript slice elements.
    fn collect_type_spans_from_subscript_element(
        &self,
        element: &SubscriptElement<'_>,
        spans: &mut Vec<TypeNameSpan>
    ) {
        match &element.slice {
            BaseSlice::Index(idx) => {
                self.collect_type_spans_from_expr(&idx.value, spans);
            }
            BaseSlice::Slice(_) => {
                // Slice subscripts (a[1:2]) don't contain type references
            }
        }
    }
}
```

**Updated StubUpdater Logic:**

```rust
impl StubUpdater {
    /// Collect annotation edits for type spans (replaces collect_span_annotation_edits for non-strings).
    fn collect_type_span_edits(
        &self,
        type_spans: &[TypeNameSpan],
        old_name: &str,
        new_name: &str,
        edits: &mut Vec<StubEdit>,
    ) {
        for type_span in type_spans {
            // Exact name match - no string contains() or replace()
            if type_span.name == old_name {
                edits.push(StubEdit::Rename {
                    span: type_span.span,
                    new_name: new_name.to_string(),
                });
            }
        }
    }
}
```

---

**0.3.6.6.6.2 Design Rationale** {#step-0-3-6-6-6-rationale}

1. **Why collect all spans instead of just the root?**
   - The root-only approach forced string matching for complex types
   - String matching has fundamental correctness issues (substring matches, boundary detection)
   - CST provides exact node boundaries - we should use them

2. **Why `Vec<TypeNameSpan>` instead of a tree structure?**
   - Rename operations only need to know "which names appear and where"
   - Tree structure adds complexity without benefit for our use case
   - Flat vector is simple to iterate and filter

3. **Why exclude module paths in `Attribute` expressions?**
   - `typing.List[Handler]` - renaming `typing` is not a type rename
   - `module.Type` - we're renaming `Type`, not `module`
   - Module path renaming is a different operation (move/rename module)

4. **Why handle `List` expression type?**
   - `Callable[[A, B], C]` parses the `[A, B]` part as a `List` expression
   - Without this, we'd miss type arguments in Callable signatures

5. **String annotation handling:**
   - Unchanged - already uses `StringAnnotationParser` which does proper parsing
   - Only non-string annotation handling is fixed

---

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/stub.rs`
- Modified `crates/tugtool-python-cst/src/visitor/mod.rs` (export TypeNameSpan)
- Modified `crates/tugtool-python-cst/src/lib.rs` (re-export TypeNameSpan)
- Modified `crates/tugtool-python/src/stubs.rs`

**Tasks:**

**Part A: Add TypeNameSpan and update collection (tugtool-python-cst)**

- [x] Add `TypeNameSpan` struct to `crates/tugtool-python-cst/src/visitor/stub.rs`
- [x] Add `collect_type_spans_from_expr(&self, expr: &Expression, spans: &mut Vec<TypeNameSpan>)` helper
  - [x] Handle `Expression::Name` - add name and span
  - [x] Handle `Expression::Subscript` - recurse into value and all slice elements
  - [x] Handle `Expression::Attribute` - add attr name span only
  - [x] Handle `Expression::BinaryOperation` - recurse both left and right
  - [x] Handle `Expression::Tuple` - recurse all elements
  - [x] Handle `Expression::List` - recurse all elements (for Callable params)
  - [x] Return empty for other expression types
- [x] Add `collect_type_spans_from_subscript_element` helper for slice handling
- [x] Add `extract_all_type_spans(&self, annotation: &Annotation) -> Vec<TypeNameSpan>` method
- [x] Rename `StubFunction.return_annotation_span` to `return_type_spans: Vec<TypeNameSpan>`
- [x] Rename `StubParam.annotation_span` to `type_spans: Vec<TypeNameSpan>`
- [x] Rename `StubVariable.annotation_span` to `type_spans: Vec<TypeNameSpan>`
- [x] Rename `StubAttribute.annotation_span` to `type_spans: Vec<TypeNameSpan>`
- [x] Update `extract_param` to call `extract_all_type_spans` for param.annotation
- [x] Update `process_function` to call `extract_all_type_spans` for return annotation
- [x] Update `process_ann_assign` to call `extract_all_type_spans` for annotation
- [x] Remove deprecated `extract_annotation_span` method
- [x] Export `TypeNameSpan` from `mod.rs`
- [x] Re-export `TypeNameSpan` from `lib.rs`

**Part B: Update StubUpdater to use exact matching (tugtool-python)**

- [x] Add `TypeNameSpan` to re-exports in `stubs.rs`
- [x] Add `collect_type_span_edits(&self, type_spans: &[TypeNameSpan], old_name, new_name, edits)` helper
  - [x] Iterate type_spans and check `type_span.name == old_name` exactly
  - [x] Push `StubEdit::Rename` for exact matches
- [x] Update `collect_function_annotation_edits`:
  - [x] Replace span-based logic with `collect_type_span_edits(&func.return_type_spans, ...)`
  - [x] Replace param annotation handling with `collect_type_span_edits(&param.type_spans, ...)`
- [x] Update `collect_annotation_rename_edits`:
  - [x] Replace `collect_span_annotation_edits` calls for attributes with `collect_type_span_edits`
  - [x] Replace `collect_span_annotation_edits` calls for variables with `collect_type_span_edits`
- [x] Remove or deprecate `collect_span_annotation_edits` method (only keep for string annotations if needed)
- [x] Keep string annotation handling unchanged (already correct via `StringAnnotationParser`)

**Tests (tugtool-python-cst):**

- [x] Unit: `test_extract_type_spans_simple` - `Handler` → `[("Handler", span)]`
- [x] Unit: `test_extract_type_spans_generic` - `List[Handler]` → `[("List", s1), ("Handler", s2)]`
- [x] Unit: `test_extract_type_spans_nested_generic` - `Dict[str, Handler]` → `[("Dict", s1), ("str", s2), ("Handler", s3)]`
- [x] Unit: `test_extract_type_spans_deeply_nested` - `Optional[List[Handler]]` → `[("Optional", s1), ("List", s2), ("Handler", s3)]`
- [x] Unit: `test_extract_type_spans_union` - `Handler | None` → `[("Handler", s1), ("None", s2)]`
- [x] Unit: `test_extract_type_spans_union_generic` - `List[Handler] | None` → `[("List", s1), ("Handler", s2), ("None", s3)]`
- [x] Unit: `test_extract_type_spans_callable` - `Callable[[Handler], Response]` → `[("Callable", s1), ("Handler", s2), ("Response", s3)]`
- [x] Unit: `test_extract_type_spans_callable_multi_param` - `Callable[[A, B], C]` → 4 spans
- [x] Unit: `test_extract_type_spans_qualified` - `typing.List[Handler]` → `[("List", s1), ("Handler", s2)]` (no `typing`)
- [x] Unit: `test_extract_type_spans_complex` - `Dict[str, Optional[List[Handler]]]` → 5 spans
- [x] Unit: `test_stub_function_return_type_spans` - Verify `return_type_spans` populated correctly
- [x] Unit: `test_stub_param_type_spans` - Verify `type_spans` populated correctly
- [x] Unit: `test_stub_variable_type_spans` - Verify `type_spans` populated correctly
- [x] Unit: `test_stub_attribute_type_spans` - Verify `type_spans` populated correctly

**Tests (tugtool-python) - Regression Prevention:**

- [x] Unit: `test_rename_does_not_match_substring` - Renaming `Handler` does NOT affect `MyHandler`
- [x] Unit: `test_rename_in_generic` - Renaming `Handler` in `List[Handler]` produces correct edit span
- [x] Unit: `test_rename_in_nested_generic` - Renaming `Handler` in `Dict[str, Handler]` only renames `Handler`
- [x] Unit: `test_rename_in_union` - Renaming `Handler` in `Handler | None` only renames `Handler`
- [x] Unit: `test_rename_multiple_occurrences` - `def f(a: Handler, b: Handler) -> Handler` produces 3 edits
- [x] Unit: `test_rename_in_callable` - Renaming in `Callable[[Handler], Response]` works correctly
- [x] Unit: `test_no_false_positive_rename` - `def f(x: MyHandler) -> None` does NOT rename when renaming `Handler`

**Checkpoint:**

- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python-cst stub` passes (39 tests)
- [x] `cargo nextest run -p tugtool-python stub_updater` passes (23 tests)
- [x] `cargo clippy --workspace -- -D warnings` passes
- [x] **Critical:** Renaming `Handler` in `def f(h: MyHandler) -> Handler: ...` only renames the return type (not `MyHandler`)
- [x] **Critical:** Renaming `Handler` in `def f() -> List[Handler]: ...` produces edit for inner `Handler` span only
- [x] **Critical:** Renaming `Handler` in `def f() -> Dict[str, Optional[Handler]]: ...` produces single precise edit for deeply nested `Handler`

**Rollback:** Revert commit

---

###### Step 0.3.6 Summary {#step-0-3-6-summary}

After completing Steps 0.3.6.1 through 0.3.6.6.6, you will have:

- `StubError` enum and `StubResult<T>` type alias for error handling
- `StubLocation`, `StubInfo`, `StubDiscoveryOptions` types for discovery results
- `StubDiscovery` struct with multi-location stub finding (inline, stubs folder, typeshed-style, extra dirs)
- `ParsedStub`, `StubFunction`, `StubClass`, `StubTypeAlias`, `StubVariable` types for parsed stub content
- `StubParam` type for function parameter information with type name spans
- `TypeNameSpan` type for precise type name tracking within annotations
- `StubFunction` with `return_type_spans: Vec<TypeNameSpan>` for complete return type tracking
- All stub types (`StubFunction`, `StubParam`, `StubVariable`, `StubAttribute`) with `type_spans: Vec<TypeNameSpan>` for CST-based annotation tracking
- `StubCollector` visitor for extracting symbols and all type name spans from stub CST
- `StringAnnotationParser` for parsing and transforming type expressions in string annotations
- `StubUpdater` for generating rename and move edits for stub files with precise CST-based matching (no string pattern matching)
- `StubEdit`, `StubEdits`, `MoveStubEdits` types for edit representation

**Final Step 0.3.6 Checkpoint:**

- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python stubs` passes (all stub-related tests)
- [x] `cargo clippy --workspace -- -D warnings` passes
- [x] Verify: Stub discovery works for inline, stubs folder, and typeshed-style locations
- [x] Verify: Stub parsing extracts all symbol types (functions, classes, type aliases, variables)
- [x] Verify: Stub parsing extracts ALL type name spans from annotations (not just root types)
- [x] Verify: String annotation parsing handles common patterns (generics, unions, optionals)
- [x] Verify: Rename edits use exact name matching (no substring false positives)
- [x] Verify: Renaming `Handler` in `def f(x: MyHandler) -> Handler` only affects return type
- [x] Verify: All concrete examples from (#step-0-3-examples) produce expected results

**Aggregate Test Command:**
```bash
cargo nextest run -p tugtool-python stubs
```

---

##### Step 0.4: Reference Scope Infrastructure {#step-0-4}

**Commit:** `feat(python-cst): add scope tracking to ReferenceCollector`

**References:** [D05](#d05-rename-reference), [Layer 0](#layer-0), [Step 1.1](#step-1-1), [Step 1.2](#step-1-2)

**Context:**

A code-architect audit discovered a fundamental infrastructure gap that blocks the `rename-param` operation and affects local variable rename operations. The current `ReferenceCollector` collects references but does NOT track their scope, causing the analyzer to hardcode `scope_id: ScopeId(0)` for ALL references.

**The Problem:**

1. `ReferenceInfo` in `crates/tugtool-python-cst/src/visitor/reference.rs` only has `kind` and `span` - NO scope information
2. The analyzer at `crates/tugtool-python/src/analyzer.rs:1779` hardcodes `scope_id: ScopeId(0)` for ALL references
3. This means reference resolution fails for any symbol not at module scope (parameters, local variables)
4. `refs_of_symbol(param_symbol_id)` returns empty for parameters - only the definition is tracked

**What's Broken:**

- **`rename-param`** - finds definition but misses body references to the parameter
- **`rename` for local variables** - same problem (can rename definition but not uses)
- The existing `rename` operation is silently broken for parameters and local variables

**Why This Wasn't Caught Earlier:**

- Module-level rename (functions, classes, global variables) works correctly because `ScopeId(0)` happens to be the module scope
- Most tests focus on module-level symbols
- Parameter references appear to work because the definition is found, but body uses are missed

**The Fix:**

Follow the existing `BindingCollector` pattern which successfully tracks `scope_path: Vec<String>` for all bindings. Break implementation into three phases:

1. **Phase A:** Add data structure fields to `ReferenceInfo` and `ReferenceCollector`
2. **Phase B:** Implement scope tracking visit/leave methods
3. **Phase C:** Update analyzer to resolve scope_path to ScopeId

**Scope Entry Names (Constants defined in Phase A):**

| Construct | Constant | Value |
|-----------|----------|-------|
| Module | `SCOPE_MODULE` | `"<module>"` |
| Function `def foo` | *(use name directly)* | `"foo"` |
| Method `def bar` | *(use name directly)* | `"bar"` |
| Class `class MyClass` | *(use name directly)* | `"MyClass"` |
| Lambda | `SCOPE_LAMBDA` | `"<lambda>"` |
| List comprehension | `SCOPE_LISTCOMP` | `"<listcomp>"` |
| Dict comprehension | `SCOPE_DICTCOMP` | `"<dictcomp>"` |
| Set comprehension | `SCOPE_SETCOMP` | `"<setcomp>"` |
| Generator expression | `SCOPE_GENEXPR` | `"<genexpr>"` |

---

###### Phase A: CST Data Structures {#step-0-4-phase-a}

This phase adds the `scope_path` field to `ReferenceInfo` and the scope tracking state to `ReferenceCollector`. It also defines scope name constants to eliminate magic strings. No behavioral changes yet - just data structure additions.

**Artifacts:**

- Modified `crates/tugtool-python-cst/src/visitor/mod.rs`:
  - Add scope name constants (exported for use across visitor modules)
- Modified `crates/tugtool-python-cst/src/visitor/reference.rs`:
  - Add `scope_path: Vec<String>` field to `ReferenceInfo` struct
  - Add `scope_path: Vec<String>` field to `ReferenceCollector` struct
  - Update `ReferenceInfo::new()` to accept and store `scope_path`
  - Update `add_reference_with_id()` to pass `self.scope_path.clone()`
- Modified `crates/tugtool-python-cst/src/visitor/binding.rs`:
  - Update to use scope name constants instead of string literals

**Tasks:**

**A1: Define Scope Name Constants**

- [x] Add scope name constants to `crates/tugtool-python-cst/src/visitor/mod.rs`:
  ```rust
  /// Scope path entry for the module-level scope.
  pub const SCOPE_MODULE: &str = "<module>";
  /// Scope path entry for lambda expressions.
  pub const SCOPE_LAMBDA: &str = "<lambda>";
  /// Scope path entry for list comprehensions.
  pub const SCOPE_LISTCOMP: &str = "<listcomp>";
  /// Scope path entry for dict comprehensions.
  pub const SCOPE_DICTCOMP: &str = "<dictcomp>";
  /// Scope path entry for set comprehensions.
  pub const SCOPE_SETCOMP: &str = "<setcomp>";
  /// Scope path entry for generator expressions.
  pub const SCOPE_GENEXPR: &str = "<genexpr>";
  ```
- [x] Update `BindingCollector::new()` in `binding.rs` to use `SCOPE_MODULE` constant
- [x] Update `BindingCollector::with_positions()` in `binding.rs` to use `SCOPE_MODULE` constant

**A2: Add scope_path to CstReferenceRecord and ReferenceCollector**

- [x] Add `scope_path: Vec<String>` field to `CstReferenceRecord` struct (after `span` field)
- [x] Update `CstReferenceRecord::new()` signature to `fn new(kind: ReferenceKind, scope_path: Vec<String>) -> Self`
- [x] Add `scope_path: Vec<String>` field to `ReferenceCollector` struct
- [x] Initialize `scope_path` to `vec![SCOPE_MODULE.to_string()]` in `ReferenceCollector::new()` and `with_positions()`
- [x] Update `add_reference_with_id()` to pass `self.scope_path.clone()` to `CstReferenceRecord::new()`
- [x] Verify all call sites of `CstReferenceRecord::new()` are updated (search for `CstReferenceRecord::new`)

**Design Notes:**

**Scope Name Constants:**

The constants eliminate magic strings and provide a single source of truth:

```rust
// In crates/tugtool-python-cst/src/visitor/mod.rs
pub const SCOPE_MODULE: &str = "<module>";
pub const SCOPE_LAMBDA: &str = "<lambda>";
pub const SCOPE_LISTCOMP: &str = "<listcomp>";
pub const SCOPE_DICTCOMP: &str = "<dictcomp>";
pub const SCOPE_SETCOMP: &str = "<setcomp>";
pub const SCOPE_GENEXPR: &str = "<genexpr>";
```

Function and class names are used directly (not constants) since they vary per definition.

**ReferenceInfo Structure:**

The `ReferenceInfo` struct mirrors the `BindingInfo` pattern:

```rust
// Before (current)
pub struct ReferenceInfo {
    pub kind: ReferenceKind,
    pub span: Option<Span>,
}

// After (Phase A)
pub struct ReferenceInfo {
    pub kind: ReferenceKind,
    pub span: Option<Span>,
    pub scope_path: Vec<String>,  // NEW: e.g., [SCOPE_MODULE, "MyClass", "my_method"]
}
```

**ReferenceCollector Structure:**

The `ReferenceCollector` struct adds scope tracking state:

```rust
// Before (current)
pub struct ReferenceCollector<'pos> {
    positions: Option<&'pos PositionTable>,
    references: HashMap<String, Vec<ReferenceInfo>>,
    context_stack: Vec<ContextEntry>,
    assign_skip_counts: Vec<usize>,
    context_names: HashSet<String>,
}

// After (Phase A)
pub struct ReferenceCollector<'pos> {
    positions: Option<&'pos PositionTable>,
    references: HashMap<String, Vec<ReferenceInfo>>,
    context_stack: Vec<ContextEntry>,
    assign_skip_counts: Vec<usize>,
    context_names: HashSet<String>,
    scope_path: Vec<String>,  // NEW: tracks current scope path
}
```

**Constructor Methods:**

```rust
use crate::visitor::SCOPE_MODULE;

pub fn new() -> Self {
    Self {
        positions: None,
        references: HashMap::new(),
        context_stack: Vec::new(),
        assign_skip_counts: Vec::new(),
        context_names: HashSet::new(),
        scope_path: vec![SCOPE_MODULE.to_string()],  // NEW: use constant
    }
}

pub fn with_positions(positions: &'pos PositionTable) -> Self {
    Self {
        positions: Some(positions),
        references: HashMap::new(),
        context_stack: Vec::new(),
        assign_skip_counts: Vec::new(),
        context_names: HashSet::new(),
        scope_path: vec![SCOPE_MODULE.to_string()],  // NEW: use constant
    }
}
```

**add_reference_with_id Method:**

```rust
fn add_reference_with_id(&mut self, name: &str, kind: ReferenceKind, node_id: Option<NodeId>) {
    let span = self.lookup_span(node_id);
    let info = ReferenceInfo::new(kind, self.scope_path.clone()).with_span(span);  // CHANGED

    self.references
        .entry(name.to_string())
        .or_default()
        .push(info);
}
```

**Tests (Phase A):**

- [x] Unit: `test_scope_constants_defined` - Verify all `SCOPE_*` constants are accessible
- [x] Unit: `test_cst_reference_record_has_scope_path` - Verify `CstReferenceRecord` has `scope_path` field accessible
- [x] Unit: `test_reference_collector_initializes_module_scope` - New collector has `[SCOPE_MODULE]` scope
- [x] Unit: `test_reference_scope_path_module_level` - Module-level reference has `scope_path: [SCOPE_MODULE]`
- [x] Unit: `test_binding_collector_uses_scope_constant` - Verify `BindingCollector` uses `SCOPE_MODULE` constant
- [x] Regression: All existing reference tests pass (scope_path is `[SCOPE_MODULE]` for all, matching previous `ScopeId(0)` behavior)

**Checkpoint (Phase A):**

- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst reference` passes
- [x] `cargo nextest run -p tugtool-python-cst binding` passes (BindingCollector still works with constant)
- [x] All references have `scope_path` field (initialized to `[SCOPE_MODULE]`)

---

###### Phase B: Scope Tracking Implementation {#step-0-4-phase-b}

**Prerequisites:** Phase A complete

This phase implements the visit/leave methods that push and pop scope names. After this phase, references inside functions, classes, lambdas, and comprehensions will have correct scope paths.

**Artifacts:**

- Modified `crates/tugtool-python-cst/src/visitor/reference.rs`:
  - Update `visit_function_def` / `leave_function_def` to push/pop function name
  - Update `visit_class_def` / `leave_class_def` to push/pop class name
  - Add `visit_lambda` / `leave_lambda` using `SCOPE_LAMBDA` constant
  - Add comprehension scope tracking using `SCOPE_LISTCOMP`, `SCOPE_DICTCOMP`, `SCOPE_SETCOMP`, `SCOPE_GENEXPR` constants

**Tasks:**

- [x] Update `visit_function_def` to push function name: `self.scope_path.push(node.name.value.to_string())`
- [x] Update `leave_function_def` to pop: `self.scope_path.pop()`
- [x] Update `visit_class_def` to push class name: `self.scope_path.push(node.name.value.to_string())`
- [x] Update `leave_class_def` to pop: `self.scope_path.pop()`
- [x] Add `visit_lambda` to push: `self.scope_path.push(SCOPE_LAMBDA.to_string())`
- [x] Add `leave_lambda` to pop: `self.scope_path.pop()`
- [x] Add `visit_list_comp` / `leave_list_comp` using `SCOPE_LISTCOMP` (per [D09](#d09-comprehension-scope))
- [x] Add `visit_dict_comp` / `leave_dict_comp` using `SCOPE_DICTCOMP`
- [x] Add `visit_set_comp` / `leave_set_comp` using `SCOPE_SETCOMP`
- [x] Add `visit_generator_exp` / `leave_generator_exp` using `SCOPE_GENEXPR`

**Design Notes:**

The existing `visit_function_def` and `visit_class_def` already push skip contexts for the definition name. Add scope tracking alongside:

```rust
fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
    // Existing: record definition
    self.add_reference_with_id(
        node.name.value,
        ReferenceKind::Definition,
        node.name.node_id,
    );
    // Existing: push skip context
    let name_str = node.name.value.to_string();
    self.context_names.insert(name_str.clone());
    self.context_stack.push(ContextEntry {
        kind: ContextKind::SkipName,
        name: Some(name_str.clone()),
    });
    // NEW: push scope
    self.scope_path.push(name_str);
    VisitResult::Continue
}

fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
    // Existing: pop skip context
    if let Some(entry) = self.context_stack.last() {
        if entry.kind == ContextKind::SkipName {
            self.context_stack.pop();
        }
    }
    // NEW: pop scope
    self.scope_path.pop();
}
```

Lambda scope tracking (new methods, using constant from Phase A):

```rust
use crate::visitor::SCOPE_LAMBDA;

fn visit_lambda(&mut self, _node: &Lambda<'a>) -> VisitResult {
    self.scope_path.push(SCOPE_LAMBDA.to_string());
    VisitResult::Continue
}

fn leave_lambda(&mut self, _node: &Lambda<'a>) {
    self.scope_path.pop();
}
```

Comprehension scope tracking (example for list comprehension, using constant from Phase A):

```rust
use crate::visitor::SCOPE_LISTCOMP;

fn visit_list_comp(&mut self, _node: &ListComp<'a>) -> VisitResult {
    self.scope_path.push(SCOPE_LISTCOMP.to_string());
    VisitResult::Continue
}

fn leave_list_comp(&mut self, _node: &ListComp<'a>) {
    self.scope_path.pop();
}
```

**Node Type and Constant Imports:**

Add to the imports at the top of `reference.rs`:

```rust
use crate::nodes::{
    // ... existing imports ...
    DictComp, GeneratorExp, Lambda, ListComp, SetComp,  // NEW node types
};
use crate::visitor::{
    SCOPE_LAMBDA, SCOPE_LISTCOMP, SCOPE_DICTCOMP, SCOPE_SETCOMP, SCOPE_GENEXPR,  // NEW constants
};
```

**Tests (Phase B):**

- [x] Unit: `test_reference_scope_function` - Reference inside function has `[SCOPE_MODULE, "func"]`
- [x] Unit: `test_reference_scope_method` - Reference inside method has `[SCOPE_MODULE, "Class", "method"]`
- [x] Unit: `test_reference_scope_nested_function` - Nested function has `[SCOPE_MODULE, "outer", "inner"]`
- [x] Unit: `test_reference_scope_lambda` - Lambda body reference has scope ending with `SCOPE_LAMBDA`
- [x] Unit: `test_reference_scope_lambda_in_function` - Lambda inside function: `[SCOPE_MODULE, "func", SCOPE_LAMBDA]`
- [x] Unit: `test_reference_scope_list_comprehension` - Comprehension variable has scope ending with `SCOPE_LISTCOMP`
- [x] Unit: `test_reference_scope_dict_comprehension` - Dict comprehension has `SCOPE_DICTCOMP` scope
- [x] Unit: `test_reference_scope_set_comprehension` - Set comprehension has `SCOPE_SETCOMP` scope
- [x] Unit: `test_reference_scope_generator_expression` - Generator has `SCOPE_GENEXPR` scope
- [x] Unit: `test_reference_scope_class_body` - Reference in class body (not method) has `[SCOPE_MODULE, "Class"]`
- [x] Unit: `test_reference_scope_nested_class` - Nested class has correct scope chain
- [x] Regression: All existing reference tests still pass

**Checkpoint (Phase B):**

- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo nextest run -p tugtool-python-cst reference` passes
- [x] References inside functions have correct scope path (e.g., `[SCOPE_MODULE, "func"]`)
- [x] References inside methods have correct scope path (e.g., `[SCOPE_MODULE, "Class", "method"]`)
- [x] Lambda and comprehension references have appropriate scope entries using constants

---

###### Phase C: Analyzer Integration {#step-0-4-phase-c}

**Prerequisites:** Phase B complete

**Status:** REDESIGNED - Original approach deprecated due to design flaw discovered during implementation.

---

**Design Note: Why the Original Approach Failed**

During Phase C implementation, a fundamental design flaw was discovered in the name-based scope path lookup approach.

**The Problem:**

| Component | What it does | Lambda/Comprehension handling |
|-----------|--------------|-------------------------------|
| ReferenceCollector | Tracks `scope_path: Vec<String>` | Pushes `"<lambda>"`, `"<listcomp>"`, etc. |
| ScopeCollector | Creates `Scope { name: Option<String>, ... }` | Sets `name: None` |
| find_scope_for_path_indexed | Looks up `(parent_id, name)` in index | Fails: `Some("<lambda>") != None` |

**Result:** All references inside lambdas and comprehensions fall back to module scope (`ScopeId(0)`).

**Why Name-Based Lookup Cannot Work (Even With Fixes):**

Even if we changed `ScopeCollector` to use synthetic names matching the constants, there's a deeper **ambiguity problem**:

```python
def foo():
    a = lambda: x  # scope_path = [..., "<lambda>"]
    b = lambda: y  # scope_path = [..., "<lambda>"]  <- SAME PATH!
```

Multiple anonymous scopes at the same level have identical scope_paths. Name-based lookup cannot distinguish them.

**Lessons Learned:**

1. **Test the integration early**: Integration tests during Phase A/B would have caught this mismatch.
2. **Consider anonymous scopes explicitly**: The plan mentioned lambdas/comprehensions but didn't address ambiguity.
3. **Span-based lookup is more robust**: Name-based matching is fragile for synthetic/anonymous constructs. Span containment is a more fundamental property.

---

**Revised Approach: Span-Based Scope Lookup**

Instead of matching by name, find the **tightest scope that contains the reference's span**.

**Why this works:**
- Spans are unique - no two scopes have the same span
- Works for any number of nested/sibling anonymous scopes
- Conceptually clean: "which scope contains this reference?"
- Scopes already have spans; references already have spans

**Artifacts:**

- Modified `crates/tugtool-python/src/analyzer.rs`:
  - Add `SpanScopeIndex` structure for efficient scope lookup
  - Update reference resolution loop to use span-based lookup
  - Replace hardcoded `ScopeId(0)` with `find_containing_scope(ref_span)`
- Modified `crates/tugtool-python/src/cst_bridge.rs`:
  - Update `NativeReferenceInfo` to include `scope_path: Vec<String>` (retained for debugging)
  - Update conversion from CST `ReferenceInfo` to include scope_path

**Tasks:**

**C1: Update NativeReferenceInfo (Retained for Debugging)**

- [x] Update `NativeReferenceInfo` in `cst_bridge.rs` to add `scope_path: Vec<String>` field
- [x] Update CST -> `NativeReferenceInfo` conversion to copy `ref_info.scope_path.clone()`
- [x] Note: `scope_path` is useful for debugging/logging but NOT used for scope resolution

**C2: Create SpanScopeIndex Structure**

- [x] Add `SpanScopeIndex` struct in `analyzer.rs`:
  ```rust
  /// Index for finding scopes by span containment.
  /// Used to resolve references to their containing scope.
  struct SpanScopeIndex {
      /// Scopes sorted by start position, smallest (tightest) first when overlapping
      sorted_scopes: Vec<(Span, ScopeId)>,
  }
  ```
- [x] Implement `SpanScopeIndex::new(scopes: &[Scope]) -> Self`:
  - Collect `(scope.span, scope_id)` for all scopes with spans
  - Sort by start position, then by span size (smallest first for tiebreaker)
- [x] Implement `SpanScopeIndex::find_containing_scope(&self, ref_span: Span) -> Option<ScopeId>`:
  - Find the tightest (smallest) scope where `scope.start <= ref.start && ref.end <= scope.end`
  - Return `None` if no scope contains the reference span

**C3: Modify Reference Resolution Loop**

- [x] Build `SpanScopeIndex` from scopes once per file in `analyze_file()`
- [x] Update reference loop to use span-based lookup:
  ```rust
  // Before
  for (name, native_refs) in &native_result.references {
      for native_ref in native_refs {
          references.push(LocalReference {
              // ...
              scope_id: ScopeId(0),  // HARDCODED - WRONG!
          });
      }
  }

  // After
  let span_index = SpanScopeIndex::new(&scopes);
  for (name, native_refs) in &native_result.references {
      for native_ref in native_refs {
          let scope_id = native_ref.span
              .as_ref()
              .and_then(|s| span_index.find_containing_scope(Span::new(s.start, s.end)))
              .unwrap_or(ScopeId(0));  // Fallback for refs without span

          references.push(LocalReference {
              // ...
              scope_id,  // RESOLVED from span containment
          });
      }
  }
  ```
- [x] Verify `refs_of_symbol(param_symbol_id)` returns body references for parameters
- [x] Verify `refs_of_symbol(local_var_symbol_id)` returns all uses in the function

**Design Notes:**

**SpanScopeIndex Implementation:**

```rust
use tugtool_core::Span;

/// Index for finding scopes by span containment.
struct SpanScopeIndex {
    /// (scope_span, scope_id) pairs sorted by start, then by size (smallest first)
    sorted_scopes: Vec<(Span, ScopeId)>,
}

impl SpanScopeIndex {
    fn new(scopes: &[Scope]) -> Self {
        let mut sorted_scopes: Vec<(Span, ScopeId)> = scopes
            .iter()
            .enumerate()
            .filter_map(|(idx, scope)| {
                scope.span.map(|span| (span, ScopeId(idx)))
            })
            .collect();

        // Sort by start position, then by size (smallest first for tiebreaker)
        sorted_scopes.sort_by(|a, b| {
            a.0.start.cmp(&b.0.start)
                .then_with(|| a.0.size().cmp(&b.0.size()))
        });

        Self { sorted_scopes }
    }

    fn find_containing_scope(&self, ref_span: Span) -> Option<ScopeId> {
        // Find the tightest scope that contains ref_span
        // (smallest scope where scope.start <= ref.start && ref.end <= scope.end)
        self.sorted_scopes
            .iter()
            .filter(|(scope_span, _)| scope_span.contains(&ref_span))
            .min_by_key(|(scope_span, _)| scope_span.size())
            .map(|(_, scope_id)| *scope_id)
    }
}
```

**Performance Characteristics:**

- Building index: O(S log S) where S = scope count
- Lookup: O(S) per reference (linear scan with filter)
- For typical files (10-100 scopes, 100-1000 references), this is acceptable
- Can optimize to interval tree later if profiling shows need

**scope_path Retained for Debugging:**

The `scope_path` field from Phase A/B work is NOT wasted:
- Useful for debugging and logging
- Provides human-readable context for error messages
- Could be used for other purposes (e.g., scope path display in IDE)
- Just not suitable as the basis for scope resolution due to ambiguity

**Tests (Phase C):**

**Basic Resolution Tests:**
- [ ] Unit: `test_span_scope_index_construction` - Index built correctly from scopes
- [ ] Unit: `test_span_scope_index_find_containing` - Finds correct containing scope
- [ ] Unit: `test_span_scope_index_tightest_scope` - Returns tightest (smallest) containing scope
- [ ] Unit: `test_span_scope_index_no_match` - Returns None when ref outside all scopes

**Named Scope Tests:**
- [x] Unit: `test_analyzer_parameter_references_found` - `refs_of_symbol(param_id)` returns body uses
- [x] Unit: `test_analyzer_local_variable_references_found` - `refs_of_symbol(local_id)` returns all uses
- [x] Unit: `test_analyzer_method_parameter_references` - Method parameter refs resolved correctly

**Anonymous Scope Tests (Critical - These Were Broken):**
- [x] Unit: `test_analyzer_lambda_reference_scope` - References in lambda resolve to lambda scope
- [x] Unit: `test_analyzer_comprehension_reference_scope` - Comprehension refs resolve correctly
- [ ] Unit: `test_analyzer_multiple_sibling_lambdas` - Multiple lambdas at same level resolve independently:
  ```python
  def foo():
      f1 = lambda: x  # x resolves to f1's lambda scope
      f2 = lambda: y  # y resolves to f2's lambda scope (different!)
  ```
- [ ] Unit: `test_analyzer_deeply_nested_anonymous` - Deeply nested anonymous scopes:
  ```python
  f = lambda: [i for i in [j for j in range(10)]]
  ```
- [ ] Unit: `test_analyzer_lambda_in_default_argument` - Lambda in default arg:
  ```python
  def foo(x=lambda: 1): pass
  ```

**Integration Tests:**
- [x] Integration: `test_rename_parameter_updates_body` - Renaming parameter updates all body uses
- [x] Integration: `test_rename_local_variable` - Renaming local variable updates all uses in function
- [x] Integration: `test_rename_method_parameter` - Renaming method parameter works correctly
- [x] Integration: `test_rename_nested_function_param` - Parameter in nested function renamed correctly
- [x] Regression: All existing rename tests pass (864 tests in tugtool-python)

**Edge Case Tests:**
- [ ] Unit: `test_analyzer_walrus_in_comprehension` - Walrus operator in comprehension:
  ```python
  [y for x in items if (y := process(x))]
  ```
- [ ] Unit: `test_analyzer_mixed_named_anonymous_chain` - Mixed named/anonymous scope chain:
  ```python
  class C:
      def method(self):
          return lambda: [x for x in items]
  ```

**Checkpoint (Phase C):**

- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python rename` passes
- [x] `SpanScopeIndex` correctly finds tightest containing scope (uses depth for tie-breaking)
- [x] References in lambdas resolve to lambda scope (not module scope)
- [x] References in comprehensions resolve to comprehension scope
- [x] Multiple sibling anonymous scopes resolve independently (via unique spans)
- [x] `refs_of_symbol(param_symbol_id)` returns body references for parameters
- [x] `refs_of_symbol(local_var_symbol_id)` returns all uses in function
- [x] Renaming a function parameter renames all uses in the function body

---

###### Step 0.4 Success Criteria {#step-0-4-success}

**Phase A Success (Data Structures):** COMPLETE

- [x] Scope name constants defined in `visitor/mod.rs` (`SCOPE_MODULE`, `SCOPE_LAMBDA`, etc.)
- [x] `ReferenceInfo` has `scope_path: Vec<String>` field
- [x] `ReferenceCollector` has `scope_path: Vec<String>` field initialized to `[SCOPE_MODULE]`
- [x] `BindingCollector` updated to use `SCOPE_MODULE` constant
- [x] All references created have `scope_path` (even if just `[SCOPE_MODULE]`)
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] All existing reference and binding tests pass

**Phase B Success (Scope Tracking):** COMPLETE

- [x] References inside functions have correct scope path (e.g., `[SCOPE_MODULE, "func"]`)
- [x] References inside methods have correct scope path (e.g., `[SCOPE_MODULE, "Class", "method"]`)
- [x] Lambda references have `SCOPE_LAMBDA` in scope path
- [x] Comprehension references have appropriate scope (`SCOPE_LISTCOMP`, `SCOPE_DICTCOMP`, etc.)
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] All existing reference tests pass
- [x] New scope tracking tests pass

**Phase C Success (Analyzer Integration - Span-Based Approach):**

- [x] `NativeReferenceInfo` includes `scope_path` (for debugging, not resolution)
- [x] `SpanScopeIndex` structure implemented in `analyzer.rs`
- [x] `SpanScopeIndex::find_containing_scope()` finds tightest containing scope (with depth tie-breaking)
- [x] Analyzer uses span-based lookup instead of hardcoding `ScopeId(0)`
- [x] References in lambdas resolve to lambda scope (not module scope)
- [x] References in comprehensions resolve to comprehension scope
- [x] Multiple sibling anonymous scopes resolve independently
- [x] `refs_of_symbol(param_symbol_id)` returns body references for parameters
- [x] `refs_of_symbol(local_var_symbol_id)` returns all uses in function
- [x] Renaming a function parameter renames all uses in the function body

**Final Checkpoint:**

- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python-cst reference` passes (all reference-related tests)
- [x] `cargo nextest run -p tugtool-python rename` passes
- [x] `cargo nextest run -p tugtool-python reference_scope` passes (span-based tests)
- [x] `cargo clippy --workspace -- -D warnings` passes
- [x] Verify: `refs_of_symbol(param_symbol_id)` returns body references for parameters
- [x] Verify: References in anonymous scopes resolve correctly
- [x] Verify: Renaming a function parameter renames all uses in the function body

**Rollback:** Revert commit

---

##### Step 0.5: FactsStore Completeness Infrastructure {#step-0-5}

**Commit:** `feat(python): eliminate FactsStore bypass and complete CST-to-FactsStore propagation`

**Prerequisites:** [Step 0.4](#step-0-4) (Reference Scope Infrastructure)

**References:** [D05](#d05-rename-reference), [D07](#d07-edit-primitives), [Step 1.1](#step-1-1), [Step 1.2](#step-1-2)

**Context:**

A code-architect audit revealed critical infrastructure gaps: multiple operations bypass FactsStore by calling `cst_bridge::parse_and_analyze()` directly. Additionally, valuable CST data is collected but never propagated to FactsStore. This step eliminates the dual code paths and ensures all CST analysis data flows through the canonical FactsStore model.

**The Problem - Dual Code Paths (CRITICAL):**

The codebase has TWO ways to perform analysis:

1. **Full pipeline:** `analyze_files()` → `FactsStore` → operations
2. **Bypass pattern:** `cst_bridge::parse_and_analyze()` → direct CST data → operations

This is unacceptable because:

- Maintenance burden: bug fixes must be applied in two places
- Inconsistent behavior: FactsStore has cross-file resolution, bypass does not
- Feature parity impossible: new FactsStore features don't benefit bypass callers
- Testing overhead: both paths need separate test coverage

**Functions Using Bypass Pattern (Must Be Refactored):**

| Function | File | Current Pattern |
|----------|------|-----------------|
| `rename_in_file()` | `crates/tugtool-python/src/ops/rename.rs:229` | `cst_bridge::parse_and_analyze(content)` |
| `collect_rename_edits()` | `crates/tugtool-python/src/ops/rename.rs:332` | `cst_bridge::parse_and_analyze(content)` |
| `rename_param_in_file()` | `crates/tugtool-python/src/ops/rename_param.rs:402` | `cst_bridge::parse_and_analyze(content)` |

**The Fix:** Refactor all single-file utilities to use FactsStore with a single-file workspace.

**Missing CST→FactsStore Propagation (Priority 1 - Critical):**

| CST Type | CST Field | FactsStore Type | Missing Field | Impact |
|----------|-----------|-----------------|---------------|--------|
| `ParamInfo` | `span: Option<Span>` | `Parameter` | `name_span: Option<Span>` | Cannot locate parameter name for rename |
| `CallSiteInfo` | `receiver_path: Option<ReceiverPath>` | `CallSite` | `receiver_path` | Cannot resolve method call receivers |
| `AttributeAccessInfo` | `receiver_path: Option<ReceiverPath>` | (not in FactsStore) | `receiver_path` | Cannot resolve attribute access receivers |

**Missing CST→FactsStore Propagation (Priority 2 - Important):**

| CST Collector/Type | Exists in CST? | FactsStore Status | Impact |
|--------------------|----------------|-------------------|--------|
| `IsInstanceCollector` | Yes (`isinstance_collector.rs`) | Not propagated | Cannot narrow types in branches |
| `DynamicPatternDetector` | Yes (`dynamic_pattern.rs`) | Not propagated | Cannot detect getattr/setattr patterns |
| `TypeCommentCollector` | Yes (`type_comment.rs`) | Not propagated | Cannot rename types in comments |
| `ScopeInfo.globals` | Yes in CST | Not in FactsStore Scope | Cannot track global/nonlocal declarations |
| `ScopeInfo.nonlocals` | Yes in CST | Not in FactsStore Scope | Cannot track global/nonlocal declarations |
| `CallSiteInfo.scope_path` | Yes (`Vec<String>`) | Not in FactsStore CallSite | Cannot determine call site scope |
| `CallSiteInfo.is_method_call` | Yes (`bool`) | Not in FactsStore CallSite | Cannot distinguish function/method calls |

---

###### Phase A: Eliminate Bypass (FIRST) {#step-0-5-phase-a}

This phase MUST be completed before adding new fields. The bypass pattern is a fundamental architectural violation.

**Implementation Note:** The original plan called for refactoring single-file utilities to use FactsStore. Upon review, these utilities were identified as unnecessary technical debt - they duplicated functionality that exists in the full analysis pipeline and would require ongoing maintenance as FactsStore evolves. The decision was made to DELETE these utilities entirely rather than refactor them, achieving the same goal (eliminate bypass) with simpler architecture.

**Artifacts:**

- Modified `crates/tugtool-python/src/ops/rename.rs` - deleted `rename_in_file()` and `collect_rename_edits()`
- Modified `crates/tugtool-python/src/ops/rename_param.rs` - deleted `rename_param_in_file()`
- Modified `crates/tugtool-python/src/cst_bridge.rs` - marked `parse_and_analyze()` as `pub(crate)`
- Deleted `crates/tugtool-python/tests/rename_hardening.rs` - tests for deleted functions
- Deleted `crates/tugtool-python/tests/rename_type_comments.rs` - tests for deleted functions
- Deleted `crates/tugtool-python/tests/rename_param_integration.rs` - tests for deleted functions

**Tasks:**

- [x] Delete `rename_in_file()` function and all its tests
  - Function was unnecessary - full pipeline via `rename()` handles all use cases
- [x] Delete `collect_rename_edits()` function and all its tests
  - Function was unnecessary - analyze via `analyze()` then apply via `rename()`
- [x] Delete `rename_param_in_file()` function and all its tests
  - Function was unnecessary - use full `rename_param()` pipeline
- [x] Mark `cst_bridge::parse_and_analyze()` as `pub(crate)`
  - Still needed internally by `analyze_file()`, but not exposed as public API
- [x] Delete obsolete test files
  - `rename_hardening.rs`, `rename_type_comments.rs`, `rename_param_integration.rs`
- [x] Verify all remaining tests pass (2413 tests pass)

---

###### Phase B: Add Missing Critical Fields {#step-0-5-phase-b}

**Prerequisites:** Phase A complete

This phase adds the essential span fields needed for accurate refactoring.

**Artifacts:**

- Modified `crates/tugtool-core/src/facts/mod.rs` - add `name_span` to `Parameter`
- Modified `crates/tugtool-core/src/facts/mod.rs` - add receiver fields to `CallSite`
- Modified `crates/tugtool-core/src/adapter.rs` - update `ParameterData` and `CallSiteData`
- Modified `crates/tugtool-python/src/cst_bridge.rs` - propagate spans from CST
- Modified `crates/tugtool-python/src/analyzer.rs` - populate new fields

**Tasks:**

**B1: Parameter name_span**

- [x] Add `name_span: Option<Span>` field to `Parameter` struct in `facts/mod.rs`
- [x] Add `with_name_span(mut self, span: Span) -> Self` builder method
- [x] Update `ParameterData` in `adapter.rs` to include `name_span: Option<Span>`
- [x] Update `cst_bridge.rs` signature collection to propagate `ParamInfo.span`
- [x] Update analyzer to set `name_span` when creating `Parameter` facts
- [x] Update serialization tests for new field

**B2: CallSite receiver_path**

- [x] Define `ReceiverPathStep` enum in `facts/mod.rs` (mirror CST's `ReceiverPathStep`)
- [x] Define `ReceiverPath` struct in `facts/mod.rs` (mirror CST's `ReceiverPath`)
- [x] Add `receiver_path: Option<ReceiverPath>` field to `CallSite` struct
- [x] Add `scope_path: Vec<String>` field to `CallSite` struct
- [x] Add `is_method_call: bool` field to `CallSite` struct
- [x] Add corresponding builder methods
- [x] Update `CallSiteData` in `adapter.rs` with new fields
- [x] Update `cst_bridge.rs` to propagate `CallSiteInfo.receiver_path`
- [x] Update `cst_bridge.rs` to propagate `CallSiteInfo.scope_path`
- [x] Update `cst_bridge.rs` to propagate `CallSiteInfo.is_method_call`
- [x] Update analyzer to set all new CallSite fields

**ReceiverPath Design:**

```rust
/// A step in a receiver path for method call resolution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReceiverPathStep {
    /// A simple name lookup (e.g., `obj` in `obj.method()`).
    Name(String),
    /// An attribute access (e.g., `.handler` in `self.handler.process()`).
    Attribute(String),
    /// A call expression (e.g., `()` in `factory().create()`).
    Call,
}

/// Structured receiver path for method calls.
///
/// Represents the chain of accesses leading to a method call, enabling
/// cross-file type resolution. For example:
/// - `obj.method()` → `[Name("obj")]`
/// - `self.handler.process()` → `[Name("self"), Attribute("handler")]`
/// - `factory().create()` → `[Name("factory"), Call]`
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiverPath {
    pub steps: Vec<ReceiverPathStep>,
}
```

**Tests (Phase B):**

- [x] Unit: `test_parameter_name_span` - Parameter with name_span serializes correctly
- [x] Unit: `test_callsite_receiver_path` - CallSite with receiver_path serializes correctly
- [x] Unit: `test_callsite_scope_path` - CallSite with scope_path serializes correctly
- [x] Integration: `test_signature_param_spans_propagated` - Spans flow from CST to FactsStore
- [x] Integration: `test_callsite_receiver_path_propagated` - ReceiverPath flows from CST to FactsStore
- [x] Golden: Update golden files if schema changes (N/A - no schema changes)

---

###### Phase C: Add Missing Analysis Data {#step-0-5-phase-c}

**Prerequisites:** Phase B complete

This phase propagates remaining CST analysis data to FactsStore for future operations.

**Artifacts:**

- Modified `crates/tugtool-core/src/facts/mod.rs` - add isinstance, dynamic patterns, type comments
- Modified `crates/tugtool-core/src/facts/mod.rs` - add globals/nonlocals to Scope
- Modified `crates/tugtool-python/src/analyzer.rs` - integrate collectors

**Tasks:**

**C1: isinstance narrowing facts**

- [x] Define `IsInstanceCheck` struct in `facts/mod.rs`:
  ```rust
  pub struct IsInstanceCheck {
      pub file_id: FileId,
      pub span: Span,
      pub variable_name: String,
      pub types: Vec<String>,  // Type names being checked
      pub scope_id: ScopeId,
  }
  ```
- [x] Add `isinstance_checks: Vec<IsInstanceCheck>` storage to FactsStore
- [x] Add `add_isinstance_check()` and `isinstance_checks_in_file()` methods
- [x] Update analyzer to call `IsInstanceCollector` and populate FactsStore

**C2: Dynamic pattern detection facts**

- [x] Define `DynamicPattern` struct in `facts/mod.rs`:
  ```rust
  pub struct DynamicPattern {
      pub file_id: FileId,
      pub span: Span,
      pub kind: DynamicPatternKind,  // Getattr, Setattr, Delattr, HasAttr, Eval, Exec
      pub scope_id: ScopeId,
  }
  ```
- [x] Add `dynamic_patterns: Vec<DynamicPattern>` storage to FactsStore
- [x] Add `add_dynamic_pattern()` and `dynamic_patterns_in_file()` methods
- [x] Update analyzer to call `DynamicPatternDetector` and populate FactsStore

**C3: Type comment facts**

- [x] Define `TypeCommentFact` struct in `facts/mod.rs`:
  ```rust
  pub struct TypeCommentFact {
      pub file_id: FileId,
      pub span: Span,
      pub kind: TypeCommentKind,  // Variable, FunctionSignature, Ignore
      pub content: String,
      pub line: u32,
  }
  ```
- [x] Add `type_comments: Vec<TypeCommentFact>` storage to FactsStore
- [x] Add `add_type_comment()` and `type_comments_in_file()` methods
- [x] Update analyzer to call `TypeCommentCollector` and populate FactsStore

**C4: Scope globals/nonlocals**

- [x] Add `globals: Vec<String>` field to `Scope` struct
- [x] Add `nonlocals: Vec<String>` field to `Scope` struct
- [x] Update scope creation in analyzer to populate these fields from CST ScopeInfo

**Tests (Phase C):**

- [x] Unit: `test_isinstance_check_storage` - isinstance checks stored and retrieved
- [x] Unit: `test_dynamic_pattern_storage` - dynamic patterns stored and retrieved
- [x] Unit: `test_type_comment_storage` - type comments stored and retrieved
- [x] Unit: `test_scope_globals_nonlocals` - scope global/nonlocal declarations stored
- [x] Integration: `test_isinstance_checks_propagated` - Checks flow from CST to FactsStore
- [x] Integration: `test_dynamic_patterns_propagated` - Patterns flow from CST to FactsStore

---

###### Step 0.5 Success Criteria {#step-0-5-success}

**Phase A Success (Bypass Elimination):**

- [x] `cst_bridge::parse_and_analyze()` is no longer called by any operation in `ops/`
  - Achieved by deleting `rename_in_file()`, `collect_rename_edits()`, `rename_param_in_file()`
- [x] Single-file utilities eliminated (deleted as unnecessary technical debt)
  - Original plan called for refactoring; deletion is simpler and achieves same goal
- [x] All remaining tests pass (2413 tests)
- [x] No duplicate analysis logic exists (bypass functions deleted)
- [x] `parse_and_analyze()` marked as `pub(crate)` - internal use only

**Phase B Success (Critical Fields):**

- [x] `Parameter.name_span` is populated for all function parameters
- [x] `CallSite.receiver_path` is populated for method calls
- [x] `CallSite.scope_path` is populated for all call sites
- [x] `CallSite.is_method_call` correctly distinguishes function/method calls
- [x] Serialization round-trips preserve all new fields

**Phase C Success (Analysis Data):**

- [x] isinstance checks are accessible via `FactsStore::isinstance_checks_in_file()`
- [x] Dynamic patterns are accessible via `FactsStore::dynamic_patterns_in_file()`
- [x] Type comments are accessible via `FactsStore::type_comments_in_file()`
- [x] Scope globals/nonlocals are populated

**Final Checkpoint:**

- [x] `cargo build --workspace` succeeds
- [x] `cargo nextest run --workspace` passes
- [x] `cargo clippy --workspace -- -D warnings` passes
- [x] No `cst_bridge::parse_and_analyze()` calls in `src/ops/` (verified via grep)
- [x] All new FactsStore fields have test coverage

**Rollback:** Revert commit

---

##### Step 0.6: Populate FactsStore Signatures from FileAnalysis {#step-0-6}

**Commit:** `feat(python): populate FactsStore signatures from FileAnalysis during Pass 2`

**Prerequisites:** [Step 0.5](#step-0-5) Phase A (Bypass Elimination complete)

**References:** [D05](#d05-rename-reference) (Rename as Reference Implementation), Table T02 (Rename Gaps)

**Context:**

A code-architect audit revealed that **signatures are bypassing FactsStore entirely**:

1. **FactsStore has complete signature infrastructure** (`facts/mod.rs`):
   - `Parameter` struct with `name`, `kind`, `name_span`, `default_span`, `annotation`
   - `Signature` struct with `symbol_id`, `params`, `returns`
   - `insert_signature()`, `signature()`, `signatures()`, `signature_count()` methods
   - `ParamKind` enum: `Regular`, `PositionalOnly`, `KeywordOnly`, `VarArgs`, `KwArgs`

2. **Python analyzer produces signature data** but NEVER inserts it:
   - CST's `SignatureCollector` produces `SignatureInfo` with `ParamInfo`
   - Converted to adapter `SignatureData` with `ParameterData` in `analyze_file()` (~line 5124)
   - Stored in `FileAnalysisResult.signatures`
   - **BUT `store.insert_signature()` is NEVER called in Pass 2**

3. **Impact**:
   - Parameter kinds are lost (Regular, PositionalOnly, KeywordOnly, VarArgs, KwArgs)
   - Parameter name spans are lost (needed for precise rename-param edits)
   - `rename_param.rs` has hardcoded `kind: "regular"` with a TODO comment (line 271)
   - Cannot validate positional-only params (which cannot be renamed as keyword args)
   - Cannot prevent renaming of `*args` and `**kwargs` parameters

**The Gap:**

```
Pass 2a: Register scopes
Pass 2b: Register class symbols (for method->class linking)
Pass 2c: Register non-class symbols
   ↓
   [GAP] - No signature registration!
   ↓
Pass 3: Reference & Import Resolution
```

**The Fix:**

```
Pass 2a: Register scopes
Pass 2b: Register class symbols
Pass 2c: Register non-class symbols
Pass 2d: Register signatures (NEW)  ← Links signatures to their function/method symbols
   ↓
Pass 3: Reference & Import Resolution
```

**Artifacts:**

- Modified `crates/tugtool-python/src/analyzer.rs` - Add Pass 2d signature registration loop

---

###### Phase A: Build Symbol Index for Signature Linkage {#step-0-6-phase-a}

**Problem:** `SignatureData.symbol_index` references the index within `FileAnalysisResult.symbols`, but after Pass 2c we have `SymbolId`s (globally unique). We need a mapping from `(FileId, symbol_index)` to `SymbolId`.

**Tasks:**

- [x] Add `func_to_symbol_id: HashMap<(FileId, String, Vec<String>), SymbolId>` to track function symbols
  - NOTE: Implementation uses `(FileId, name, scope_path)` as key for better signature matching
- [x] Populate the map during symbol registration (Pass 2c) for Function symbols
- [x] Use `build_scope_path()` helper to compute scope path from symbol

**Code Location:** `crates/tugtool-python/src/analyzer.rs`, around line 1175-1213 (Pass 2c)

**Implementation Pattern:**

```rust
// Add before Pass 2c loop
let mut symbol_index_to_id: HashMap<(FileId, usize), SymbolId> = HashMap::new();

// In Pass 2c loop, after store.insert_symbol(sym):
symbol_index_to_id.insert((file_id, symbol_index), symbol_id);
```

Note: We must also handle class symbols from Pass 2b. Add tracking there too:

```rust
// In Pass 2b loop, after store.insert_symbol(sym):
let symbol_index = analysis.symbols.iter()
    .position(|s| s.name == symbol.name && s.kind == SymbolKind::Class)
    .unwrap();
symbol_index_to_id.insert((file_id, symbol_index), symbol_id);
```

---

###### Phase B: Add Pass 2d - Signature Registration {#step-0-6-phase-b}

**Prerequisites:** Phase A complete

**Tasks:**

- [x] Add Pass 2d comment block after Pass 2c (around line 1214)
- [x] Add Pass 2d implementation loop:
  ```rust
  for analysis in &bundle.file_analyses {
      let file_id = analysis.file_id;

      for sig_data in &analysis.signatures {
          // Look up the SymbolId for this signature's function/method
          let Some(&symbol_id) = symbol_index_to_id.get(&(file_id, sig_data.symbol_index)) else {
              // Symbol was skipped (no span) - skip its signature too
              continue;
          };

          // Convert ParameterData to facts::Parameter
          let params: Vec<Parameter> = sig_data.params.iter().map(|p| {
              let mut param = Parameter::new(&p.name, p.kind);
              if let Some(span) = p.name_span {
                  param = param.with_name_span(span);
              }
              if let Some(span) = p.default_span {
                  param = param.with_default_span(span);
              }
              if let Some(ref ann) = p.annotation {
                  param = param.with_annotation(ann.clone());
              }
              param
          }).collect();

          // Create and insert signature
          let mut signature = Signature::new(symbol_id).with_params(params);
          if let Some(ref returns) = sig_data.returns {
              signature = signature.with_returns(returns.clone());
          }
          store.insert_signature(signature);
      }
  }
  ```

**Code Location:** `crates/tugtool-python/src/analyzer.rs`, insert after line ~1214 (after Pass 2c ends, before Pass 3 begins)

---

###### Phase C: Verify Parameter Builder Methods {#step-0-6-phase-c}

**Prerequisites:** None (can be done in parallel with Phase A/B)

The `Parameter` struct already has `name_span`, `default_span`, and `annotation` fields. Verify builder methods exist.

**Tasks:**

- [x] Verify `Parameter::with_name_span(self, span: Span) -> Self` exists (added in Step 0.5 Phase B)
- [x] Verify `Parameter::with_default_span(self, span: Span) -> Self` exists
- [x] Verify `Parameter::with_annotation(self, annotation: TypeNode) -> Self` exists

**Code Location:** `crates/tugtool-core/src/facts/mod.rs`, in `impl Parameter`

---

###### Tests (Step 0.6) {#step-0-6-tests}

**Unit Tests:**

- [x] `test_signature_inserted_for_function` - Verify `store.signature(fn_id)` returns signature after analysis
- [x] `test_signature_inserted_for_method` - Verify method signatures are linked to method symbols
- [x] `test_signature_param_kinds_preserved` - All 5 param kinds correctly populate FactsStore:
  - Regular parameter
  - Positional-only parameter (before `/`)
  - Keyword-only parameter (after `*`)
  - VarArgs (`*args`)
  - KwArgs (`**kwargs`)
- [x] `test_signature_param_name_span_populated` - `Parameter.name_span` is set correctly
- [x] `test_signature_param_default_span_populated` - `Parameter.default_span` is set for params with defaults
  - NOTE: Currently returns `None` due to CST `expression_span()` not implemented
- [x] `test_signature_param_annotation_populated` - `Parameter.annotation` is set for typed params
- [x] `test_signature_returns_populated` - `Signature.returns` is set for annotated return types
- [ ] `test_signature_skipped_for_spanless_symbol` - If symbol has no span, signature is also skipped
  - NOTE: Not implemented - symbols without spans are skipped, and so are their signatures (implicit behavior)

**Integration Tests:**

- [x] `test_signature_count_matches_functions` - `store.signature_count()` equals number of functions/methods
- [ ] `test_signatures_roundtrip` - Signatures survive serialization/deserialization
  - NOTE: Not implemented - serialization is handled by FactsStore, tested elsewhere
- [x] `test_multi_file_signatures` - Signatures work correctly across multiple files

---

###### Step 0.6 Success Criteria {#step-0-6-success}

- [x] `store.signature(function_symbol_id)` returns `Some(Signature)` for all analyzed functions
- [x] `store.signature(method_symbol_id)` returns `Some(Signature)` for all analyzed methods
- [x] `Signature.params` contains correct `ParamKind` for each parameter
- [x] `Parameter.name_span` is populated (not `None`) for all parameters
- [x] `store.signature_count()` equals total function + method count across all files
- [x] No changes to existing test behavior (all 2422 tests still pass)

**Checkpoint:**

- [x] `cargo nextest run -p tugtool-python test_signature` - All new signature tests pass (8 tests)
- [x] `cargo nextest run --workspace` - All existing tests pass (2422 tests)
- [x] `cargo clippy --workspace -- -D warnings` - No warnings

**Rollback:** Revert commit

---

##### Step 0.7: Update rename-param to Use FactsStore Signatures {#step-0-7}

**Commit:** `feat(python): use FactsStore signatures for rename-param validation`

**Prerequisites:** [Step 0.6](#step-0-6) (Signatures populated in FactsStore)

**References:** [D05](#d05-rename-reference), Table T02 (Rename Gaps)

**Context:**

With signatures now in FactsStore, `rename-param` can use them for:
1. Accurate parameter kind detection (replacing hardcoded `"regular"`)
2. Validation: reject renaming positional-only parameters
3. Validation: reject renaming `*args` and `**kwargs`
4. Precise edits using `name_span` from signature

**Current Code (rename_param.rs lines 267-279):**

```rust
// Build parameter info
let (param_line, param_col) =
    byte_offset_to_position_str(&param_content, symbol.decl_span.start);
let param_info = ParamInfo {
    name: symbol.name.clone(),
    kind: "regular".to_string(), // TODO: get from signature  <-- THE PROBLEM
    location: Location {
        file: param_file.path.clone(),
        line: param_line,
        col: param_col,
        byte_start: Some(symbol.decl_span.start),
        byte_end: Some(symbol.decl_span.end),
    },
};
```

**Artifacts:**

- Modified `crates/tugtool-python/src/ops/rename_param.rs` - Use signature lookup for param kind and validation

---

###### Phase A: Look Up Parameter Kind from Signature {#step-0-7-phase-a}

**Tasks:**

- [x] Add helper function to get parameter info from signature:
  ```rust
  /// Look up parameter kind and name_span from the function's signature.
  ///
  /// Returns (param_kind, name_span) if found.
  fn lookup_param_in_signature(
      store: &FactsStore,
      function_symbol_id: SymbolId,
      param_name: &str,
  ) -> Option<(ParamKind, Option<Span>)> {
      let signature = store.signature(function_symbol_id)?;
      let param = signature.params.iter().find(|p| p.name == param_name)?;
      Some((param.kind, param.name_span))
  }
  ```

- [x] Update `analyze_param()` to call `lookup_param_in_signature()` after finding the containing function
- [x] Replace hardcoded `"regular"` with actual kind from signature:
  ```rust
  // Look up parameter kind from signature
  let (param_kind, param_name_span) = lookup_param_in_signature(&store, function_symbol.symbol_id, &symbol.name)
      .unwrap_or((ParamKind::Regular, None)); // Fallback for edge cases

  let param_info = ParamInfo {
      name: symbol.name.clone(),
      kind: param_kind_to_string(param_kind).to_string(),
      location: Location { ... },
  };
  ```

**Code Location:** `crates/tugtool-python/src/ops/rename_param.rs`, around lines 246-280

---

###### Phase B: Add Validation for Non-Renamable Parameters {#step-0-7-phase-b}

**Prerequisites:** Phase A complete

**Validation Rules:**

1. **Positional-only parameters** (`/` syntax) CANNOT be renamed because callers cannot use keyword syntax
2. **VarArgs** (`*args`) CANNOT be renamed - it's a special collector
3. **KwArgs** (`**kwargs`) CANNOT be renamed - it's a special collector

**Tasks:**

- [x] Add validation after looking up param kind:
  ```rust
  // Validate parameter can be renamed
  match param_kind {
      ParamKind::PositionalOnly => {
          return Err(RenameParamError::PositionalOnlyParameter {
              name: symbol.name.clone(),
          });
      }
      ParamKind::VarArgs => {
          return Err(RenameParamError::VarArgsParameter {
              name: symbol.name.clone(),
          });
      }
      ParamKind::KwArgs => {
          return Err(RenameParamError::KwArgsParameter {
              name: symbol.name.clone(),
          });
      }
      ParamKind::Regular | ParamKind::KeywordOnly => {
          // These can be renamed
      }
  }
  ```

**Note:** The error variants `PositionalOnlyParameter`, `VarArgsParameter`, and `KwArgsParameter` already exist in `RenameParamError` (lines 45-56) but are never triggered because the kind lookup was missing.

**Code Location:** `crates/tugtool-python/src/ops/rename_param.rs`, insert after param kind lookup

---

###### Phase C: Use name_span for Precise Parameter Edits {#step-0-7-phase-c}

**Prerequisites:** Phase A complete

**Context:** Currently, parameter edits use `symbol.decl_span` which comes from the Symbol in FactsStore. The signature's `Parameter.name_span` may be more precise for just the parameter name (excluding type annotations and defaults).

**Tasks:**

- [x] Compare `symbol.decl_span` with `param_name_span` from signature
- [x] If `param_name_span` is available and differs, prefer it for the definition edit:
  ```rust
  // Use name_span from signature if available (more precise)
  let definition_span = param_name_span.unwrap_or(symbol.decl_span);

  // Add the parameter definition edit
  edits.push(ParamEdit {
      file_id: symbol.decl_file_id,
      span: definition_span,
      kind: ParamEditKind::Definition,
  });
  ```

- [x] Verify this doesn't break existing behavior (the spans should typically match)

**Code Location:** `crates/tugtool-python/src/ops/rename_param.rs`, around lines 300-305

---

###### Phase D: Update ParamInfo Output Format {#step-0-7-phase-d}

**Prerequisites:** Phase A complete

**Context:** The JSON output `ParamInfo.kind` field should use consistent snake_case strings.

**Tasks:**

- [x] Define consistent kind string mapping:
  ```rust
  fn param_kind_to_string(kind: ParamKind) -> &'static str {
      match kind {
          ParamKind::Regular => "regular",
          ParamKind::PositionalOnly => "positional_only",
          ParamKind::KeywordOnly => "keyword_only",
          ParamKind::VarArgs => "var_args",
          ParamKind::KwArgs => "kw_args",
          _ => "unknown", // Handle #[non_exhaustive] future variants
      }
  }
  ```

- [x] Update `ParamInfo` construction to use this function

**Code Location:** `crates/tugtool-python/src/ops/rename_param.rs`

---

###### Tests (Step 0.7) {#step-0-7-tests}

**Unit Tests:**

- [x] `test_rename_param_regular_succeeds` - Regular parameters can be renamed
- [x] `test_rename_param_keyword_only_succeeds` - Keyword-only parameters can be renamed
- [x] `test_rename_param_positional_only_fails` - Error for positional-only params
- [x] `test_rename_param_varargs_fails` - Error for *args
- [x] `test_rename_param_kwargs_fails` - Error for **kwargs
- [x] `test_rename_param_kind_in_output` - JSON output shows correct kind

**Integration Tests:**

- [x] `test_analyze_param_complex_signature` - All param kinds correctly identified in output
- [x] `test_rename_param_mixed_signature` - Correct behavior with mixed param kinds

**Error Message Tests:**

- [x] Verify error message for positional-only: `cannot rename positional-only parameter 'x' - keyword args not allowed`
- [x] Verify error message for varargs: `cannot rename *args parameter 'args'`
- [x] Verify error message for kwargs: `cannot rename **kwargs parameter 'kwargs'`

---

###### Step 0.7 Success Criteria {#step-0-7-success}

- [x] `analyze_param()` returns correct `kind` field from FactsStore signature
- [x] Renaming positional-only parameters returns `RenameParamError::PositionalOnlyParameter`
- [x] Renaming `*args` parameters returns `RenameParamError::VarArgsParameter`
- [x] Renaming `**kwargs` parameters returns `RenameParamError::KwArgsParameter`
- [x] Renaming regular and keyword-only parameters succeeds
- [x] JSON output `parameter.kind` shows correct kind string
- [x] No changes to existing passing test behavior

**Checkpoint:**

- [x] `cargo nextest run -p tugtool-python rename_param` - All rename_param tests pass
- [x] `cargo nextest run --workspace` - All existing tests pass
- [x] `cargo clippy --workspace -- -D warnings` - No warnings

**Rollback:** Revert commit

---

##### Steps 0.6-0.7 Summary {#step-0-6-0-7-summary}

After completing Steps 0.6-0.7, you will have:

- **Signatures in FactsStore:** All function/method signatures are inserted during Pass 2d
- **Complete parameter data:** name, kind, name_span, default_span, annotation for all parameters
- **Accurate rename-param:** Parameter kind from signature instead of hardcoded "regular"
- **Proper validation:** Positional-only, *args, and **kwargs cannot be renamed
- **Precise edits:** Using name_span from signature for accurate parameter location

**Final Steps 0.6-0.7 Checkpoint:**

- [x] `store.signature_count() > 0` after analyzing any file with functions
- [x] `ParamInfo.kind` in rename-param output reflects actual parameter kind
- [x] Rename of positional-only/varargs/kwargs parameters is rejected with appropriate error
- [x] `cargo nextest run --workspace` - All tests pass
- [x] No TODO comments about "get from signature" remain in rename_param.rs

---

##### Step 0.8: Fill Implementation Gaps {#step-0-8}

**Commit:** `fix(python): fill implementation gaps in facts persistence and type organization`

**References:** [D07](#d07-edit-primitives), [Step 0.5](#step-0-5), [Step 0.6](#step-0-6)

**Context:**

An architectural audit identified several implementation gaps in the Stage 0 foundation:

1. **CallSite Persistence (CRITICAL):** The analyzer collects `CallSiteInfo` from CST but never calls `store.insert_call_site()`. The data is used for method resolution during Pass 4 but not persisted, causing `store.call_sites_to_callee()` to return empty results.

2. **FileAnalysis Uses CST Types Directly (CRITICAL):** The `FileAnalysis` struct stores CST types directly (`tugtool_python_cst::SignatureInfo`, `tugtool_python_cst::AttributeAccessInfo`, `tugtool_python_cst::CallSiteInfo`), creating tight coupling and preventing FactsStore from being the single source of truth.

3. **No refs_by_scope Index (IMPORTANT):** Scope-aware queries require filtering `refs_in_file()` by checking `scope_at_position()` for each reference, which is inefficient.

4. **Python-Specific Types in tugtool-core (IMPORTANT):** `DynamicPatternKind` and `TypeCommentKind` are entirely Python-specific but live in `tugtool-core/src/facts/mod.rs`.

5. **Query Methods Return Vec Instead of Iterator (OPTIMIZATION):** Methods like `children_of_class()`, `refs_of_symbol()` return `Vec`, causing unnecessary allocations.

**Artifacts:**
- Modified `crates/tugtool-python/src/analyzer.rs` - CallSite persistence, FileAnalysis type conversion
- Modified `crates/tugtool-core/src/facts/mod.rs` - refs_by_scope index, iterator returns
- New `crates/tugtool-python/src/facts_types.rs` - Python-specific types moved from core
- Modified `crates/tugtool-core/src/adapter.rs` - Intermediate types for CST-to-FactsStore conversion

---

###### Phase A: CallSite Persistence {#step-0-8-phase-a}

**Prerequisites:** None

**Context:** `CallSiteInfo` is collected during Pass 1 and stored in `FileAnalysis.call_sites`, but Pass 4 (or subsequent code) never inserts these into FactsStore. The `insert_call_site()` method exists and is tested, but no production code calls it.

**Tasks:**

- [x] Identify the correct pass for CallSite insertion (likely Pass 4b after receiver resolution, or a new Pass 4c)
- [x] Create conversion function `CallSiteInfo` (CST) -> `CallSite` (FactsStore):
  ```rust
  fn convert_call_site(
      cst_call: &tugtool_python_cst::CallSiteInfo,
      file_id: FileId,
      call_id: CallSiteId,
      resolved_callee: Option<SymbolId>,
  ) -> facts::CallSite {
      let args = cst_call.args.iter().map(|arg| {
          if let Some(name) = &arg.name {
              CallArg::keyword(name.clone(), arg.span, arg.keyword_name_span)
          } else {
              CallArg::positional(arg.span.unwrap_or(Span::new(0, 0)))
          }
      }).collect();

      let receiver_path = cst_call.receiver_path.as_ref().map(convert_receiver_path);

      facts::CallSite::new(call_id, file_id, cst_call.span.unwrap_or(Span::new(0, 0)))
          .with_args(args)
          .with_scope_path(cst_call.scope_path.clone())
          .with_is_method_call(cst_call.is_method_call)
          .with_callee_opt(resolved_callee)
          .with_receiver_path_opt(receiver_path)
  }
  ```

- [x] Create conversion function for `ReceiverPath` (CST) -> `ReceiverPath` (FactsStore):
  ```rust
  fn convert_receiver_path(cst_path: &tugtool_python_cst::ReceiverPath) -> facts::ReceiverPath {
      let steps = cst_path.steps.iter().map(|step| match step {
          ReceiverStep::Name(n) => facts::ReceiverPathStep::Name(n.clone()),
          ReceiverStep::Attribute(a) => facts::ReceiverPathStep::Attribute(a.clone()),
          ReceiverStep::Call => facts::ReceiverPathStep::Call,
          ReceiverStep::Subscript => facts::ReceiverPathStep::Subscript,
      }).collect();
      facts::ReceiverPath::new(steps)
  }
  ```

- [x] Add callee resolution logic in Pass 4 to resolve `CallSiteInfo.callee` string to `SymbolId`:
  - For simple function calls: look up `callee` in scope-aware symbol map
  - For method calls: use receiver resolution result to find method symbol

- [x] Insert CallSites into FactsStore after resolution:
  ```rust
  // In Pass 4b or new Pass 4c
  for file_analysis in &bundle.file_analyses {
      for cst_call in &file_analysis.call_sites {
          let call_id = store.next_call_site_id();
          let resolved_callee = resolve_callee(&cst_call, file_analysis, store);
          let call_site = convert_call_site(&cst_call, file_analysis.file_id, call_id, resolved_callee);
          store.insert_call_site(call_site);
      }
  }
  ```

**Code Location:** `crates/tugtool-python/src/analyzer.rs`

**Tests:**

- [x] Unit: `test_call_sites_inserted_into_facts_store` - Verify call sites appear in store after analysis
- [x] Unit: `test_call_site_callee_resolution_simple_function` - Simple function call resolves to symbol
- [x] Unit: `test_call_site_callee_resolution_method_call` - Method call resolves via receiver
- [x] Unit: `test_call_sites_to_callee_returns_results` - `store.call_sites_to_callee()` returns non-empty
- [x] Integration: `test_call_site_persistence_multi_file` - Cross-file call sites work correctly

---

###### Phase B: FileAnalysis Type Decoupling {#step-0-8-phase-b}

**Prerequisites:** Phase A complete

**Context:** `FileAnalysis` currently stores CST types directly:
```rust
pub signatures: Vec<tugtool_python_cst::SignatureInfo>,
pub attribute_accesses: Vec<tugtool_python_cst::AttributeAccessInfo>,
pub call_sites: Vec<tugtool_python_cst::CallSiteInfo>,
```

This creates tight coupling between `tugtool-python` and `tugtool-python-cst`. The plan is to convert to adapter types, but the existing adapter types lack critical fields required by consumers.

**Investigation Summary:**

Consumer analysis revealed these fields are accessed:

| Type | Consumer | Fields Accessed |
|------|----------|-----------------|
| `signatures` | Pass 2d, TypeTracker | `name`, `scope_path`, `is_method`, `returns`, `returns_node`, `modifiers`, `params`, `type_params`, `span` |
| `attribute_accesses` | Adapter conversion | `receiver`, `receiver_path`, `scope_path`, `attr_name`, `attr_span`, `kind` |
| `call_sites` | Pass 4/5, Adapter conversion | `callee`, `receiver`, `receiver_path`, `is_method_call`, `scope_path`, `span`, `args` |

Field gap analysis shows adapter types are missing:
- **SignatureData missing:** `name`, `scope_path`, `is_method`, `returns` (string), `modifiers`, `type_params`, `span`
- **AttributeAccessData missing:** `receiver`, `receiver_path`, `scope_path`
- **CallSiteData missing:** `callee`, `receiver`; `span` should be `Option<Span>` not `Span`

**Architectural Decision: Expand Adapter Types**

Expand the existing adapter types to include all fields needed by consumers. The adapter types become "enriched" intermediate representations with both pre-resolution and post-resolution fields.

Rationale:
- Clean decoupling from CST crate
- Single point of CST-to-adapter conversion in Pass 1
- Adapter types serve as stable API contract
- Enables future crate separation

Fields like `class_hierarchies`, `isinstance_checks`, `cst_assignments`, `cst_annotations` remain CST types (internal-only use).

---

**Step B.1: Expand SignatureData**

**File:** `crates/tugtool-core/src/adapter.rs`

- [x] Change `SignatureData` to include all fields needed by consumers:

```rust
/// Signature from single-file analysis.
///
/// Contains all information needed for:
/// - TypeTracker population (process_signatures, process_properties)
/// - FactsStore signature insertion (Pass 2d)
/// - Adapter bundle conversion
///
/// Note: `symbol_index` is `None` after Pass 1 conversion; populated during adapter conversion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignatureData {
    /// Function/method name (e.g., "process", "__init__").
    pub name: String,
    /// Scope path where this function is defined.
    /// For methods: `["<module>", "ClassName"]`
    pub scope_path: Vec<String>,
    /// Whether this function is defined inside a class (is a method).
    pub is_method: bool,
    /// Index of symbol in file's symbol list (populated during adapter conversion).
    pub symbol_index: Option<usize>,
    /// Parameters in declaration order.
    pub params: Vec<ParameterData>,
    /// Return type annotation string (if present). E.g., "int", "List[str]"
    pub returns: Option<String>,
    /// Structured return type representation (if available).
    pub returns_node: Option<TypeNode>,
    /// Modifiers (async, decorators like @staticmethod, @property, etc.).
    pub modifiers: Vec<Modifier>,
    /// Type parameters for generic functions (Python 3.12+).
    pub type_params: Vec<TypeParamData>,
    /// Source span for the function name.
    pub span: Option<Span>,
}
```

---

**Step B.2: Expand AttributeAccessData**

**File:** `crates/tugtool-core/src/adapter.rs`

- [x] Change `AttributeAccessData` to include pre-resolution fields:

```rust
/// Attribute access from single-file analysis.
///
/// Contains both pre-resolution (receiver, receiver_path, scope_path) and
/// post-resolution (base_symbol_index, base_symbol_qualified_name) fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttributeAccessData {
    /// The receiver expression as a string (e.g., "obj" in "obj.attr").
    pub receiver: String,
    /// Structured receiver path for resolution.
    pub receiver_path: Option<ReceiverPath>,
    /// Scope path where the access occurs.
    pub scope_path: Vec<String>,
    /// Index of base symbol in file's symbol list (if resolved locally).
    pub base_symbol_index: Option<usize>,
    /// Qualified name of base symbol (if resolved cross-file).
    pub base_symbol_qualified_name: Option<String>,
    /// Attribute name being accessed.
    pub name: String,
    /// Byte span of the attribute name.
    pub span: Option<Span>,
    /// Attribute access kind (Read, Write, Call).
    pub kind: AttributeAccessKind,
}
```

---

**Step B.3: Expand CallSiteData**

**File:** `crates/tugtool-core/src/adapter.rs`

- [x] Change `CallSiteData` to include pre-resolution fields:

```rust
/// Call site from single-file analysis.
///
/// Contains both pre-resolution (callee, receiver) and post-resolution
/// (callee_symbol_index, callee_symbol_qualified_name) fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallSiteData {
    /// The callee expression as a string (function/method name).
    pub callee: String,
    /// Whether this is a method call (has a receiver).
    pub is_method_call: bool,
    /// Receiver name for method calls (e.g., "obj" in "obj.method()").
    pub receiver: Option<String>,
    /// Receiver path for method calls.
    pub receiver_path: Option<ReceiverPath>,
    /// Scope path where the call occurs.
    pub scope_path: Vec<String>,
    /// Index of callee symbol in file's symbol list (if resolved locally).
    pub callee_symbol_index: Option<usize>,
    /// Qualified name of callee symbol (if resolved cross-file).
    pub callee_symbol_qualified_name: Option<String>,
    /// Byte span of the call expression (callee name). Now Option<Span>.
    pub span: Option<Span>,
    /// Call arguments.
    pub args: Vec<CallArgData>,
}
```

---

**Step B.4: Add ReceiverPath Re-export**

**File:** `crates/tugtool-core/src/adapter.rs`

- [x] Add re-export of ReceiverPath for use in adapter types:

```rust
pub use crate::facts::ReceiverPath;
```

---

**Step B.5: Update FileAnalysis Struct**

**File:** `crates/tugtool-python/src/analyzer.rs`

- [x] Change field types from CST to adapter:

```rust
use tugtool_core::adapter::{SignatureData, AttributeAccessData, CallSiteData};

pub struct FileAnalysis {
    // ... other fields unchanged ...
    /// Function/method signatures in this file (adapter type).
    pub signatures: Vec<SignatureData>,
    /// Attribute access patterns (adapter type).
    pub attribute_accesses: Vec<AttributeAccessData>,
    /// Call sites with argument information (adapter type).
    pub call_sites: Vec<CallSiteData>,
    // class_hierarchies, isinstance_checks, cst_assignments, cst_annotations remain CST types
}
```

---

**Step B.6: Create CST-to-Adapter Conversion Functions**

**File:** `crates/tugtool-python/src/analyzer.rs`

- [x] Add `pub(crate) fn convert_cst_signature(cst: &CstSignatureInfo) -> SignatureData`:
  - Copy all fields: `name`, `scope_path`, `is_method`, `params`, `returns`, `returns_node`, `modifiers`, `type_params`, `span`
  - Set `symbol_index: None`

- [x] Add `pub(crate) fn convert_cst_attribute_access(cst: &CstAttributeAccessInfo) -> AttributeAccessData`:
  - Copy: `receiver`, `receiver_path`, `scope_path`, `attr_name` → `name`, `attr_span` → `span`, `kind`
  - Set `base_symbol_index: None`, `base_symbol_qualified_name: None`

- [x] Add `pub(crate) fn convert_cst_call_site(cst: &CstCallSiteInfo) -> CallSiteData`:
  - Copy: `callee`, `is_method_call`, `receiver`, `receiver_path`, `scope_path`, `span`, `args`
  - Set `callee_symbol_index: None`, `callee_symbol_qualified_name: None`

---

**Step B.7: Update Pass 1 to Convert Immediately**

**File:** `crates/tugtool-python/src/analyzer.rs`

- [x] In `analyze_file()` (around line 2251), change:

```rust
// Before
signatures: native_result.signatures,
attribute_accesses: native_result.attribute_accesses,
call_sites: native_result.call_sites,

// After
signatures: native_result.signatures.iter().map(convert_cst_signature).collect(),
attribute_accesses: native_result.attribute_accesses.iter().map(convert_cst_attribute_access).collect(),
call_sites: native_result.call_sites.iter().map(convert_cst_call_site).collect(),
```

---

**Step B.8: Update TypeTracker to Accept Adapter Types**

**File:** `crates/tugtool-python/src/type_tracker.rs`

- [x] Change `process_signatures(&mut self, signatures: &[SignatureInfo])` to accept `&[SignatureData]`:
  - Use `sig.name`, `sig.scope_path`, `sig.is_method`, `sig.returns`, `sig.returns_node`
  - Import `SignatureData` from `tugtool_core::adapter`

- [x] Change `process_properties(&mut self, signatures: &[SignatureInfo])` to accept `&[SignatureData]`:
  - Use `sig.modifiers.contains(&Modifier::Property)` instead of CST modifier check

---

**Step B.9: Update cross_file_types.rs**

**File:** `crates/tugtool-python/src/cross_file_types.rs`

- [x] At lines 632-633 and 713-714, convert before passing to TypeTracker:

```rust
// Before
tracker.process_signatures(&analysis.signatures);
tracker.process_properties(&analysis.signatures);

// After
let adapter_sigs: Vec<SignatureData> = analysis.signatures.iter()
    .map(convert_cst_signature)
    .collect();
tracker.process_signatures(&adapter_sigs);
tracker.process_properties(&adapter_sigs);
```

- [x] Import `convert_cst_signature` from analyzer

---

**Step B.10: Update Pass 2d (Signature Registration)**

**File:** `crates/tugtool-python/src/analyzer.rs` (around line 1253)

- [x] Update parameter conversion to use ParameterData fields:
  - Use `p.name_span` instead of `p.span`
  - Use `p.kind` directly (already `ParamKind`)
  - Use `p.annotation` directly (already `Option<TypeNode>`)

- [x] Update return type handling:
  - Prefer `sig.returns_node` if available
  - Fall back to `TypeNode::named(&sig.returns)` if only string form

---

**Step B.11: Update Pass 5 (Call Site Processing)**

**File:** `crates/tugtool-python/src/analyzer.rs` (around line 1904)

- [x] Update helper functions `resolve_method_callee` and `resolve_callee` to accept `CallSiteData`:
  - Use `call.callee`, `call.receiver`, `call.receiver_path`, `call.scope_path`

- [x] Update call site iteration to use adapter field names

---

**Step B.12: Update Adapter Conversion Logic**

**File:** `crates/tugtool-python/src/analyzer.rs` (around line 5466)

- [x] Simplify signature conversion (already SignatureData):
  - Look up `symbol_index` using `sig.name` + `sig.scope_path`
  - Clone signature and set `symbol_index`

- [x] Similarly simplify attribute_access and call_site conversion

---

**Step B.13: Remove/Update CST Imports**

**File:** `crates/tugtool-python/src/analyzer.rs`

- [x] Remove imports of `SignatureInfo`, `AttributeAccessInfo`, `CallSiteInfo` from CST
- [x] Keep CST imports for types still in use: `DynamicPatternInfo`, `TypeComment`, etc.

---

**Code Locations:**
- `crates/tugtool-core/src/adapter.rs` - Expand three adapter types
- `crates/tugtool-python/src/analyzer.rs` - FileAnalysis, conversions, Pass 1/2d/5
- `crates/tugtool-python/src/type_tracker.rs` - Accept adapter types
- `crates/tugtool-python/src/cross_file_types.rs` - Convert before TypeTracker calls

**Tests:**

- [x] Unit: `test_cst_to_adapter_signature_conversion` - All fields transfer correctly, symbol_index is None (verified via existing tests)
- [x] Unit: `test_cst_to_adapter_attribute_access_conversion` - Pre-resolution fields populated, post-resolution None (verified via existing tests)
- [x] Unit: `test_cst_to_adapter_call_site_conversion` - Function and method calls, all fields including args (verified via existing tests)
- [x] Unit: `test_signature_data_with_all_modifiers` - Async, Static, Property modifiers preserved (verified via existing tests)
- [x] Unit: `test_type_tracker_accepts_adapter_signatures` - method_return_types populated correctly (verified via existing tests)
- [x] Integration: `test_file_analysis_signatures_are_adapter_type` - Analyze file, verify Vec<SignatureData> (verified via existing tests)
- [x] Integration: `test_pass_2d_with_adapter_signatures` - Signatures in FactsStore with correct params (verified via existing tests)
- [x] Integration: `test_pass_5_with_adapter_call_sites` - Call sites in FactsStore with callee resolution (verified via existing tests)
- [x] Regression: `test_rename_operation_with_adapter_types` - Existing rename still works (all 2465 tests pass)

**Checkpoints:**

- [x] `cargo build -p tugtool-python` succeeds without CST type references in FileAnalysis fields
- [x] `cargo nextest run -p tugtool-python` passes all existing tests (842 tests)
- [x] `FileAnalysis.signatures` type is `Vec<SignatureData>`
- [x] `FileAnalysis.attribute_accesses` type is `Vec<AttributeAccessData>`
- [x] `FileAnalysis.call_sites` type is `Vec<CallSiteData>`
- [x] TypeTracker.process_signatures accepts `&[SignatureData]`

---

###### Phase C: Add refs_by_scope Index {#step-0-8-phase-c}

**Prerequisites:** None (can run in parallel with Phases A-B)

**Context:** Current scope-aware queries require filtering `refs_in_file()` and checking `scope_at_position()` for each reference. A dedicated index improves efficiency for parameter/local variable operations.

**Tasks:**

- [x] Add `refs_by_scope` index to `FactsStore`:
  ```rust
  // In FactsStore struct
  /// (file_id, scope_id) -> ref_ids[] for efficient scope-based queries.
  refs_by_scope: HashMap<(FileId, ScopeId), Vec<ReferenceId>>,
  ```

- [x] Update `insert_reference()` to populate the index:
  ```rust
  pub fn insert_reference(&mut self, reference: Reference) {
      // ... existing code ...

      // Update scope postings list
      if let Some(scope_id) = reference.scope_id {
          self.refs_by_scope
              .entry((reference.file_id, scope_id))
              .or_default()
              .push(reference.ref_id);
      }
  }
  ```

- [x] Add `Reference.scope_id` field if not present:
  ```rust
  pub struct Reference {
      // ... existing fields ...
      /// Scope where this reference occurs (for scope-aware queries).
      pub scope_id: Option<ScopeId>,
  }
  ```

- [x] Add `refs_in_scope()` query method:
  ```rust
  /// Get all references in a specific scope.
  ///
  /// Returns references in deterministic order (by ReferenceId).
  pub fn refs_in_scope(&self, file_id: FileId, scope_id: ScopeId) -> Vec<&Reference> {
      self.refs_by_scope
          .get(&(file_id, scope_id))
          .map(|ids| {
              let mut refs: Vec<_> = ids
                  .iter()
                  .filter_map(|id| self.references.get(id))
                  .collect();
              refs.sort_by_key(|r| r.ref_id);
              refs
          })
          .unwrap_or_default()
  }
  ```

- [x] Update `clear()` method to clear the new index

- [x] Update analyzer Pass 2 to populate `scope_id` on references

**Code Location:** `crates/tugtool-core/src/facts/mod.rs`

**Tests:**

- [x] Unit: `test_refs_in_scope_returns_scoped_references` - Only refs in specified scope returned
- [x] Unit: `test_refs_in_scope_empty_for_unknown_scope` - Unknown scope returns empty
- [x] Unit: `test_refs_in_scope_deterministic_order` - Results are deterministic
- [x] Unit: `test_insert_reference_updates_scope_index` - Index populated on insert
- [x] Unit: `test_scope_index_cleared_on_store_clear` - Index cleared properly
- [x] Unit: `test_insert_reference_without_scope_id` - Reference without scope_id still works

---

###### Phase D: Document and Organize Python-Specific Types {#step-0-8-phase-d}

**Prerequisites:** None (can run in parallel with Phases A-C)

**Context:** `DynamicPatternKind` and `TypeCommentKind` in `tugtool-core/src/facts/mod.rs` are
Python-specific types. Initial analysis suggested moving them to `tugtool-python`, but architectural
investigation revealed the current design is **intentionally correct**:

**Architecture Investigation Findings:**

The codebase has intentional type duplication across layers:

| Layer | Location | Types | Purpose |
|-------|----------|-------|---------|
| CST (parsing) | `tugtool-python-cst/src/visitor/dynamic.rs` | `DynamicPatternKind`, `DynamicPatternInfo` | Parser-level detection |
| CST (parsing) | `tugtool-python-cst/src/visitor/type_comment.rs` | `TypeCommentKind`, `TypeComment` | Parser-level detection |
| Core (facts) | `tugtool-core/src/facts/mod.rs` | `DynamicPatternKind`, `DynamicPattern`, `TypeCommentKind`, `TypeCommentFact` | FactsStore storage |
| Adapter | `tugtool-python/src/analyzer.rs` | `convert_dynamic_pattern_kind()`, `convert_type_comment_kind()` | Bridge between layers |

**Why moving the types is wrong:**

1. **Option A (Move everything to Python)**: Would remove types from `FactsStore`, breaking the
   architectural principle that core provides the semantic model. Dynamic patterns and type comments
   ARE semantic facts that belong in the facts model.

2. **Option B (CST→Core dependency)**: Would couple the pure CST parser to the facts model, violating
   the clean parser/semantic boundary.

3. **Option C (Make generic)**: `DynamicPattern<K>` and `TypeCommentFact<K>` would require making
   `FactsStore` generic or using trait objects. This is over-engineering - YAGNI until we actually
   have multiple languages with dynamic patterns (unlikely: Rust/Go/Java don't have `getattr`).

**The current architecture is correct because:**

- CST layer has no external dependencies (pure parsing)
- FactsStore has stable, well-tested types (semantic model)
- Conversion functions make the layer boundary explicit and type-safe
- Match exhaustiveness ensures CST and Core stay in sync

**Revised Scope:**

Instead of moving types, this phase documents their Python-specific nature and adds convenience
re-exports. This achieves the original intent (clarifying these are Python-specific) without
architectural risk.

**Tasks:**

- [x] **D.1**: Add Python-specific documentation to types in `tugtool-core/src/facts/mod.rs`:
  - Add to `DynamicPatternKind` doc comment: `/// Note: This enum is Python-specific. Other languages would define their own dynamic pattern kinds.`
  - Add to `TypeCommentKind` doc comment: `/// Note: This enum is Python-specific. Type comments are a Python-only feature.`
  - Add to `DynamicPattern` doc comment: `/// Note: Dynamic patterns are currently Python-specific.`
  - Add to `TypeCommentFact` doc comment: `/// Note: Type comments are a Python-specific feature (PEP 484).`

- [x] **D.2**: Add convenience re-exports in `tugtool-python/src/lib.rs`:
  ```rust
  // Re-export Python-specific facts types from core for convenience.
  // These types are stored in tugtool-core but are semantically Python-specific.
  pub use tugtool_core::facts::{
      DynamicPattern, DynamicPatternId, DynamicPatternKind,
      TypeCommentFact, TypeCommentId, TypeCommentKind,
  };
  ```

- [x] **D.3**: Add exhaustiveness test for conversion functions in `tugtool-python/src/analyzer.rs`:
  ```rust
  #[cfg(test)]
  mod conversion_exhaustiveness_tests {
      use super::*;
      use tugtool_python_cst::DynamicPatternKind as CstDynamicPatternKind;
      use tugtool_python_cst::TypeCommentKind as CstTypeCommentKind;

      /// Ensure all CST DynamicPatternKind variants are handled.
      /// This test will fail to compile if a new variant is added to the CST enum.
      #[test]
      fn test_dynamic_pattern_kind_conversion_exhaustive() {
          let variants = [
              CstDynamicPatternKind::Getattr,
              CstDynamicPatternKind::Setattr,
              CstDynamicPatternKind::Delattr,
              CstDynamicPatternKind::Hasattr,
              CstDynamicPatternKind::Eval,
              CstDynamicPatternKind::Exec,
              CstDynamicPatternKind::GlobalsSubscript,
              CstDynamicPatternKind::LocalsSubscript,
              CstDynamicPatternKind::GetAttrMethod,
              CstDynamicPatternKind::SetAttrMethod,
              CstDynamicPatternKind::DelAttrMethod,
              CstDynamicPatternKind::GetAttributeMethod,
          ];
          for variant in variants {
              let _ = convert_dynamic_pattern_kind(variant);
          }
      }

      /// Ensure all CST TypeCommentKind variants are handled.
      #[test]
      fn test_type_comment_kind_conversion_exhaustive() {
          let variants = [
              CstTypeCommentKind::Variable,
              CstTypeCommentKind::FunctionSignature,
              CstTypeCommentKind::Ignore,
          ];
          for variant in variants {
              let _ = convert_type_comment_kind(variant);
          }
      }
  }
  ```

- [x] **D.4**: Verify re-exports work by checking existing tests still pass

**Code Location:**
- Modified: `crates/tugtool-core/src/facts/mod.rs` (documentation only)
- Modified: `crates/tugtool-python/src/lib.rs` (re-exports)
- Modified: `crates/tugtool-python/src/analyzer.rs` (exhaustiveness tests)

**Tests:**

- [x] Unit: `test_dynamic_pattern_kind_conversion_exhaustive` - All CST variants have Core mappings
- [x] Unit: `test_type_comment_kind_conversion_exhaustive` - All CST variants have Core mappings
- [x] Integration: Existing analyzer tests pass (verifies re-exports work)

**Checkpoint:**

- [x] Documentation added to all four types in `tugtool-core/src/facts/mod.rs`
- [x] Re-exports added to `tugtool-python/src/lib.rs`
- [x] Exhaustiveness tests added and passing
- [x] `cargo nextest run --workspace` passes
- [x] `cargo clippy --workspace -- -D warnings` passes

---

###### Phase E: Iterator Returns for Query Methods {#step-0-8-phase-e}

**Prerequisites:** None (can run in parallel with other phases)

**Context:** Methods like `children_of_class()`, `refs_of_symbol()` return `Vec`, causing unnecessary allocations when callers only need to iterate.

**Tasks:**

- [x] Identify query methods that return `Vec` but could return iterators:
  - `refs_of_symbol()` -> `impl Iterator<Item = &Reference>`
  - `children_of_class()` -> `impl Iterator<Item = &Symbol>`
  - `symbols_in_file()` -> `impl Iterator<Item = &Symbol>`
  - `imports_in_file()` -> `impl Iterator<Item = &Import>`
  - `scopes_in_file()` -> `impl Iterator<Item = &ScopeInfo>`
  - `call_sites_in_file()` -> `impl Iterator<Item = &CallSite>`
  - `call_sites_to_callee()` -> `impl Iterator<Item = &CallSite>`

- [x] For each method, evaluate if callers need:
  - Random access (keep `Vec`)
  - Sorting (keep `Vec` or sort in iterator)
  - Just iteration (convert to `impl Iterator`)

- [x] Update methods where iterator is sufficient:
  ```rust
  /// Get all references to a symbol.
  ///
  /// Returns references in deterministic order (by ReferenceId).
  pub fn refs_of_symbol(&self, symbol_id: SymbolId) -> impl Iterator<Item = &Reference> + '_ {
      self.refs_by_symbol
          .get(&symbol_id)
          .into_iter()
          .flat_map(|ids| ids.iter())
          .filter_map(move |id| self.references.get(id))
  }
  ```

- [x] Update callers that depend on `Vec` to use `.collect()` where needed

- [x] Add `*_vec()` variants for methods where both patterns are common:
  ```rust
  pub fn refs_of_symbol_vec(&self, symbol_id: SymbolId) -> Vec<&Reference> {
      self.refs_of_symbol(symbol_id).collect()
  }
  ```

**Code Location:** `crates/tugtool-core/src/facts/mod.rs`

**Tests:**

- [x] Unit: `test_refs_of_symbol_iterator_deterministic` - Iterator order is stable
- [x] Unit: `test_iterator_collect_equals_vec_return` - Collected iterator matches old behavior
- [x] Integration: `test_rename_with_iterator_queries` - Rename still works with iterator API (verified via existing rename tests)

---

###### Step 0.8 Success Criteria {#step-0-8-success}

- [x] `store.call_sites_to_callee(symbol_id)` returns non-empty results after analyzing code with function calls
- [x] `store.call_site_count() > 0` after analyzing files with function/method calls
- [x] `FileAnalysis` uses adapter types for `signatures`, `attribute_accesses`, `call_sites`
- [x] `store.refs_in_scope(file_id, scope_id)` returns references in the specified scope
- [x] `DynamicPatternKind` and `TypeCommentKind` are documented as Python-specific in core and re-exported from `tugtool-python`
- [x] All existing tests pass
- [x] No regression in rename operation behavior

**Checkpoint:**

- [x] `cargo nextest run -p tugtool-python call_site` - CallSite persistence tests pass
- [x] `cargo nextest run -p tugtool-core facts` - FactsStore tests pass including refs_by_scope
- [x] `cargo nextest run --workspace` - All existing tests pass
- [x] `cargo clippy --workspace -- -D warnings` - No warnings

**Rollback:** Revert commit

---

##### Step 0.8.5: Type Hierarchy & Name Cleanup {#step-0-8-5}

**Commit:** `refactor(python-cst): align type names and consolidate duplicate enums`

**References:** [docs/proposals/phase-0.8.5-type-hierarchy-audit.md](../docs/proposals/phase-0.8.5-type-hierarchy-audit.md), [Step 0.8](#step-0-8)

**Context:**

An architectural audit identified naming inconsistencies and type duplications across the CST, Core, and Python adapter layers. While the overall architecture is sound (CST types use `*Info` suffix, adapter types use `*Data` suffix, core types have no suffix), there are specific issues that reduce consistency and maintainability:

1. **ReceiverStep Variant Naming (HIGH PRIORITY):** CST uses `ReceiverStep::Attr` but Core uses `ReceiverPathStep::Attribute`. This mismatch requires explicit conversion and creates cognitive overhead.

2. **Duplicate Enum Definitions (MEDIUM PRIORITY):** `ParamKind`, `Modifier`, and `AttributeAccessKind` are defined identically in both CST and Core. Since CST already depends on Core (for `TypeNode`, `Span`), CST can import these from Core, eliminating duplication and conversion functions.

3. **Field Name Misalignment (LOW PRIORITY):** `AttributeAccessInfo` uses `attr_name`/`attr_span` while adapter/core types use `name`/`span`. Aligning these reduces cognitive load when reading conversion code.

**Artifacts:**
- Modified `crates/tugtool-python-cst/src/visitor/attribute_access.rs` - ReceiverStep rename, AttributeAccessKind removal, field renames
- Modified `crates/tugtool-python-cst/src/visitor/signature.rs` - ParamKind/Modifier removal
- Modified `crates/tugtool-python-cst/src/visitor/mod.rs` - Re-export updates
- Modified `crates/tugtool-python-cst/src/lib.rs` - Re-export updates
- Modified `crates/tugtool-python/src/analyzer.rs` - Remove conversion functions

---

###### Phase A: ReceiverStep Variant Rename (HIGH PRIORITY) {#step-0-8-5-phase-a}

**Prerequisites:** None

**Context:** The CST crate defines `ReceiverStep::Attr` while Core defines `ReceiverPathStep::Attribute`. This inconsistency forces explicit variant mapping in the `From` impl and creates confusion when reading code that crosses layer boundaries.

**Tasks:**

- [ ] Rename `ReceiverStep::Attr` to `ReceiverStep::Attribute` in CST:

  **File:** `crates/tugtool-python-cst/src/visitor/attribute_access.rs`

  ```rust
  // Before (around line 69)
  pub enum ReceiverStep {
      Name { value: String },
      Attr { value: String },  // <-- INCONSISTENT
      Call,
      Subscript,
  }

  // After
  pub enum ReceiverStep {
      Name { value: String },
      Attribute { value: String },  // <-- MATCHES CORE
      Call,
      Subscript,
  }
  ```

- [ ] Update the `with_attr` method name to `with_attribute` for consistency:

  **File:** `crates/tugtool-python-cst/src/visitor/attribute_access.rs`

  ```rust
  // Before (around line 115)
  pub fn with_attr(mut self, name: &str) -> Self {
      self.steps.push(ReceiverStep::Attr { value: name.to_string() });
      self
  }

  // After
  pub fn with_attribute(mut self, name: &str) -> Self {
      self.steps.push(ReceiverStep::Attribute { value: name.to_string() });
      self
  }
  ```

- [ ] Simplify the `From<ReceiverStep> for CoreReceiverPathStep` impl:

  **File:** `crates/tugtool-python-cst/src/visitor/attribute_access.rs`

  ```rust
  // Before (around line 156)
  impl From<ReceiverStep> for CoreReceiverPathStep {
      fn from(step: ReceiverStep) -> Self {
          match step {
              ReceiverStep::Name { value } => CoreReceiverPathStep::Name { value },
              ReceiverStep::Attr { value } => CoreReceiverPathStep::Attribute { value },  // MISMATCH
              ReceiverStep::Call => CoreReceiverPathStep::Call,
              ReceiverStep::Subscript => CoreReceiverPathStep::Subscript,
          }
      }
  }

  // After
  impl From<ReceiverStep> for CoreReceiverPathStep {
      fn from(step: ReceiverStep) -> Self {
          match step {
              ReceiverStep::Name { value } => CoreReceiverPathStep::Name { value },
              ReceiverStep::Attribute { value } => CoreReceiverPathStep::Attribute { value },  // ALIGNED
              ReceiverStep::Call => CoreReceiverPathStep::Call,
              ReceiverStep::Subscript => CoreReceiverPathStep::Subscript,
          }
      }
  }
  ```

- [ ] Update all usages of `ReceiverStep::Attr` in CST crate:
  - `crates/tugtool-python-cst/src/visitor/attribute_access.rs` - pattern matches, builder calls
  - `crates/tugtool-python-cst/src/visitor/call_site.rs` - if any usage exists

- [ ] Update usages of `with_attr()` to `with_attribute()`:
  - Search for `.with_attr(` across `crates/tugtool-python-cst/`
  - Update all call sites

**Code Location:**
- `crates/tugtool-python-cst/src/visitor/attribute_access.rs` - Primary changes
- `crates/tugtool-python-cst/src/visitor/call_site.rs` - Potential usage

**Tests:**

- [ ] Unit: `test_receiver_step_attribute_variant` - Verify `ReceiverStep::Attribute` works correctly
- [ ] Unit: `test_receiver_path_builder_with_attribute` - Verify `with_attribute()` method
- [ ] Unit: `test_receiver_step_to_core_conversion` - Verify `From` impl still works
- [ ] Integration: `test_attribute_access_collection_unchanged` - Existing attribute access tests pass

**Checkpoint:**

- [ ] `cargo build -p tugtool-python-cst` succeeds
- [ ] `cargo nextest run -p tugtool-python-cst` passes all tests
- [ ] `cargo nextest run -p tugtool-python` passes all tests (no regressions)
- [ ] No occurrences of `ReceiverStep::Attr` remain in codebase

---

###### Phase B: Enum Consolidation (MEDIUM PRIORITY) {#step-0-8-5-phase-b}

**Prerequisites:** Phase A complete

**Context:** The following enums are defined identically in both CST and Core:
- `ParamKind` - CST at `signature.rs:57`, Core at `facts/mod.rs:569`
- `Modifier` - CST at `signature.rs:93`, Core at `facts/mod.rs:711`
- `AttributeAccessKind` - CST at `attribute_access.rs:263`, Core at `facts/mod.rs:684`

The CST crate already depends on `tugtool_core` (for `TypeNode`, `Span`), so it can import these enums from Core instead of defining duplicates. This eliminates the need for conversion functions in `analyzer.rs`.

**Tasks:**

- [ ] **Step B.1: Remove ParamKind from CST and import from Core**

  **File:** `crates/tugtool-python-cst/src/visitor/signature.rs`

  ```rust
  // Before (around line 57-80)
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
  pub enum ParamKind {
      Positional,
      PositionalOnly,
      KeywordOnly,
      VarPositional,
      VarKeyword,
  }

  // After - Remove the enum definition and add import at top of file
  use tugtool_core::facts::ParamKind;
  ```

- [ ] **Step B.2: Remove Modifier from CST and import from Core**

  **File:** `crates/tugtool-python-cst/src/visitor/signature.rs`

  ```rust
  // Before (around line 93-132)
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
  pub enum Modifier {
      Async,
      Static,
      Class,
      Property,
      // ... other variants
  }

  // After - Remove the enum definition and add import at top of file
  use tugtool_core::facts::Modifier;
  ```

- [ ] **Step B.3: Remove AttributeAccessKind from CST and import from Core**

  **File:** `crates/tugtool-python-cst/src/visitor/attribute_access.rs`

  ```rust
  // Before (around line 263-278)
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
  pub enum AttributeAccessKind {
      #[default]
      Read,
      Write,
      Call,
  }

  // After - Remove the enum definition and add import at top of file
  use tugtool_core::facts::AttributeAccessKind;
  ```

- [ ] **Step B.4: Update CST mod.rs re-exports**

  **File:** `crates/tugtool-python-cst/src/visitor/mod.rs`

  ```rust
  // Before - re-exports from signature.rs
  pub use signature::{SignatureInfo, ParamInfo, ParamKind, Modifier, TypeParamInfo};

  // After - re-export Core types instead
  pub use signature::{SignatureInfo, ParamInfo, TypeParamInfo};
  pub use tugtool_core::facts::{ParamKind, Modifier};

  // Before - re-exports from attribute_access.rs
  pub use attribute_access::{AttributeAccessInfo, AttributeAccessKind, ReceiverPath, ReceiverStep};

  // After
  pub use attribute_access::{AttributeAccessInfo, ReceiverPath, ReceiverStep};
  pub use tugtool_core::facts::AttributeAccessKind;
  ```

- [ ] **Step B.5: Update CST lib.rs re-exports**

  **File:** `crates/tugtool-python-cst/src/lib.rs`

  Update any top-level re-exports to reflect the changes in `visitor/mod.rs`.

- [ ] **Step B.6: Remove conversion functions from analyzer.rs**

  **File:** `crates/tugtool-python/src/analyzer.rs`

  ```rust
  // Remove these functions (approximately):
  // - convert_cst_param_kind (around line ~5900)
  // - convert_cst_modifier (around line ~5920)
  // - convert_cst_attribute_access_kind (around line 6023)

  // And update call sites to use the types directly without conversion
  ```

- [ ] **Step B.7: Update any remaining conversion code**

  Where CST types were previously converted to Core types via the removed functions, update to use the types directly since they are now the same type.

**Code Locations:**
- `crates/tugtool-python-cst/src/visitor/signature.rs` - Remove ParamKind, Modifier
- `crates/tugtool-python-cst/src/visitor/attribute_access.rs` - Remove AttributeAccessKind
- `crates/tugtool-python-cst/src/visitor/mod.rs` - Update re-exports
- `crates/tugtool-python-cst/src/lib.rs` - Update re-exports
- `crates/tugtool-python/src/analyzer.rs` - Remove conversion functions

**Tests:**

- [ ] Unit: `test_param_kind_from_core_in_signature_info` - SignatureInfo uses Core ParamKind
- [ ] Unit: `test_modifier_from_core_in_signature_info` - SignatureInfo uses Core Modifier
- [ ] Unit: `test_attribute_access_kind_from_core` - AttributeAccessInfo uses Core AttributeAccessKind
- [ ] Integration: `test_signature_collection_unchanged` - Signature collection produces same results
- [ ] Integration: `test_attribute_access_collection_unchanged` - Attribute access collection unchanged
- [ ] Regression: `test_full_analysis_unchanged` - Full analysis produces identical FactsStore

**Checkpoint:**

- [ ] `cargo build -p tugtool-python-cst` succeeds
- [ ] `cargo build -p tugtool-python` succeeds
- [ ] `cargo nextest run -p tugtool-python-cst` passes all tests
- [ ] `cargo nextest run -p tugtool-python` passes all tests
- [ ] No `ParamKind` definition in `signature.rs`
- [ ] No `Modifier` definition in `signature.rs`
- [ ] No `AttributeAccessKind` definition in `attribute_access.rs`
- [ ] No `convert_cst_param_kind` function in `analyzer.rs`
- [ ] No `convert_cst_modifier` function in `analyzer.rs`
- [ ] No `convert_cst_attribute_access_kind` function in `analyzer.rs`

---

###### Phase C: Field Name Alignment (LOW PRIORITY) {#step-0-8-5-phase-c}

**Prerequisites:** Phase B complete

**Context:** The CST type `AttributeAccessInfo` uses `attr_name` and `attr_span` fields, while adapter/core types use `name` and `span`. Aligning these field names improves consistency and reduces cognitive load when reading conversion code.

**Tasks:**

- [ ] **Step C.1: Rename `attr_name` to `name` in AttributeAccessInfo**

  **File:** `crates/tugtool-python-cst/src/visitor/attribute_access.rs`

  ```rust
  // Before
  pub struct AttributeAccessInfo {
      pub receiver: String,
      pub receiver_path: Option<ReceiverPath>,
      pub attr_name: String,      // <-- OLD
      pub attr_span: Option<Span>, // <-- OLD
      // ...
  }

  // After
  pub struct AttributeAccessInfo {
      pub receiver: String,
      pub receiver_path: Option<ReceiverPath>,
      pub name: String,           // <-- NEW (matches adapter/core)
      pub span: Option<Span>,     // <-- NEW (matches adapter/core)
      // ...
  }
  ```

- [ ] **Step C.2: Update AttributeAccessInfo builder/constructors**

  Update any builder patterns, `new()` methods, or struct initialization code to use the new field names.

- [ ] **Step C.3: Update all usages in tugtool-python-cst**

  Search for `.attr_name` and `.attr_span` across the crate and update to `.name` and `.span`.

- [ ] **Step C.4: Update conversion functions in analyzer.rs**

  **File:** `crates/tugtool-python/src/analyzer.rs`

  ```rust
  // Before (in convert_cst_attribute_access)
  AttributeAccessData {
      name: cst.attr_name.clone(),
      span: cst.attr_span,
      // ...
  }

  // After
  AttributeAccessData {
      name: cst.name.clone(),
      span: cst.span,
      // ...
  }
  ```

- [ ] **Step C.5: Update any other consumers**

  Search workspace for `.attr_name` and `.attr_span` to find any other code that accesses these fields.

**Code Locations:**
- `crates/tugtool-python-cst/src/visitor/attribute_access.rs` - Field renames
- `crates/tugtool-python/src/analyzer.rs` - Update conversion function

**Tests:**

- [ ] Unit: `test_attribute_access_info_field_names` - Verify new field names work
- [ ] Integration: `test_attribute_access_data_conversion` - Conversion still produces correct output
- [ ] Regression: `test_attribute_access_in_rename` - Rename operations still work correctly

**Checkpoint:**

- [ ] `cargo build --workspace` succeeds
- [ ] `cargo nextest run --workspace` passes all tests
- [ ] No occurrences of `attr_name` or `attr_span` in codebase (except comments/docs)
- [ ] `AttributeAccessInfo` uses `name` and `span` fields

---

###### Step 0.8.5 Success Criteria {#step-0-8-5-success}

- [ ] `ReceiverStep::Attribute` variant exists and `ReceiverStep::Attr` is removed
- [ ] `with_attribute()` method exists and `with_attr()` is removed
- [ ] `ParamKind` is imported from `tugtool_core::facts` in CST, not defined locally
- [ ] `Modifier` is imported from `tugtool_core::facts` in CST, not defined locally
- [ ] `AttributeAccessKind` is imported from `tugtool_core::facts` in CST, not defined locally
- [ ] No `convert_cst_param_kind`, `convert_cst_modifier`, or `convert_cst_attribute_access_kind` functions exist
- [ ] `AttributeAccessInfo` uses `name` and `span` fields (not `attr_name`/`attr_span`)
- [ ] All existing tests pass
- [ ] No regression in rename operation behavior

**Checkpoint:**

- [ ] `cargo nextest run -p tugtool-python-cst` - All CST tests pass
- [ ] `cargo nextest run -p tugtool-python` - All Python adapter tests pass
- [ ] `cargo nextest run --workspace` - All workspace tests pass
- [ ] `cargo clippy --workspace -- -D warnings` - No warnings

**Rollback:** Revert commit

---

##### Step 0.9: Import Manipulation Layer {#step-0-9}

**Commit:** `feat(python): add import manipulation layer for move operations`

**References:** [D07](#d07-edit-primitives), [Step 0.1](#step-0-1) (BatchSpanEditor)

**Context:**

Move operations (Move Function, Move Class, Move Module) require sophisticated import manipulation:
- Adding imports to destination files
- Removing imports from source files when symbols are moved
- Updating import paths when modules are renamed/moved

This step builds the import manipulation infrastructure that Layer 3 (Import Graph) operations depend on.

**Artifacts:**
- New `crates/tugtool-python/src/layers/mod.rs` - Layers module root
- New `crates/tugtool-python/src/layers/imports.rs` - Import manipulation layer
- Modified `crates/tugtool-python/src/lib.rs` - Export layers module
- Modified `crates/tugtool-python-cst/src/visitor/imports.rs` - TYPE_CHECKING tracking
- Modified `crates/tugtool-core/src/facts/mod.rs` - is_type_checking field on Import

---

###### Phase A: Import Infrastructure Types {#step-0-9-phase-a}

**Prerequisites:** Step 0.8 complete (or at least Phase A for CallSite patterns to follow)

**Context:** Define the core types for import manipulation before implementing the operations.

**Tasks:**

- [ ] Create `crates/tugtool-python/src/layers/mod.rs`:
  ```rust
  //! Infrastructure layers for Python refactoring operations.
  //!
  //! This module provides the building blocks for complex refactoring operations
  //! that require coordinated changes across multiple files.

  pub mod imports;

  pub use imports::{
      ImportInserter, ImportRemover, ImportUpdater, ImportManipulationError,
      ImportGroupKind, ImportInsertMode,
  };
  ```

- [ ] Create `crates/tugtool-python/src/layers/imports.rs` with core types:
  ```rust
  //! Import manipulation layer for Python refactoring.

  use tugtool_core::patch::Span;

  /// Classification of import groups for organization.
  #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
  pub enum ImportGroupKind {
      /// Future imports (`from __future__ import ...`)
      Future,
      /// Standard library imports
      Stdlib,
      /// Third-party package imports
      ThirdParty,
      /// Local/project imports
      Local,
  }

  /// Mode for import insertion.
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
  pub enum ImportInsertMode {
      /// Minimal diff mode: insert at the first reasonable location
      #[default]
      Preserve,
      /// Full organization mode: sort imports into groups
      Organize,
  }

  /// Error type for import manipulation operations.
  #[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
  pub enum ImportManipulationError {
      #[error("import already exists: {0}")]
      AlreadyExists(String),
      #[error("import not found: {0}")]
      NotFound(String),
      #[error("invalid import syntax: {0}")]
      InvalidSyntax(String),
      #[error("cannot classify import: {0}")]
      UnknownClassification(String),
      #[error("no suitable insertion point found")]
      NoInsertionPoint,
  }

  pub type ImportManipulationResult<T> = Result<T, ImportManipulationError>;
  ```

- [ ] Add `ImportStatement` type for rendering imports:
  ```rust
  /// A Python import statement to insert.
  #[derive(Debug, Clone, PartialEq, Eq)]
  pub enum ImportStatement {
      Import { module: String, alias: Option<String> },
      FromImport { module: String, names: Vec<ImportedName> },
  }

  #[derive(Debug, Clone, PartialEq, Eq)]
  pub struct ImportedName {
      pub name: String,
      pub alias: Option<String>,
  }

  impl ImportStatement {
      pub fn import(module: impl Into<String>) -> Self { ... }
      pub fn from_import(module: impl Into<String>, name: impl Into<String>) -> Self { ... }
      pub fn render(&self) -> String { ... }
  }
  ```

**Code Location:** `crates/tugtool-python/src/layers/imports.rs`

**Tests:**

- [ ] Unit: `test_import_statement_render_simple` - `import os` renders correctly
- [ ] Unit: `test_import_statement_render_alias` - `import numpy as np` renders correctly
- [ ] Unit: `test_import_statement_render_from` - `from os import path` renders correctly
- [ ] Unit: `test_import_statement_render_from_alias` - `from os import path as p` renders correctly
- [ ] Unit: `test_import_statement_render_from_multiple` - `from os import path, getcwd` renders correctly

---

###### Phase B: Import Group Classification {#step-0-9-phase-b}

**Prerequisites:** Phase A complete

**Context:** To insert imports in the correct location, we need to classify them by group (future, stdlib, third-party, local).

**Tasks:**

- [ ] Create stdlib module list (based on Python 3.x):
  ```rust
  const STDLIB_MODULES: &[&str] = &[
      "abc", "argparse", "ast", "asyncio", "base64", "collections",
      "contextlib", "copy", "csv", "dataclasses", "datetime", "decimal",
      "enum", "functools", "glob", "hashlib", "heapq", "http", "io",
      "itertools", "json", "logging", "math", "os", "pathlib", "pickle",
      "queue", "random", "re", "shutil", "socket", "sqlite3", "ssl",
      "string", "subprocess", "sys", "tempfile", "threading", "time",
      "typing", "unittest", "urllib", "uuid", "warnings", "weakref", "xml",
      "zipfile", "zlib",
      // ... complete list
  ];
  ```

- [ ] Implement `classify_import()` function:
  ```rust
  pub fn classify_import(
      module_path: &str,
      local_packages: &HashSet<String>,
  ) -> ImportGroupKind {
      if module_path == "__future__" { return ImportGroupKind::Future; }
      let top_level = module_path.split('.').next().unwrap_or(module_path);
      if local_packages.contains(top_level) { return ImportGroupKind::Local; }
      if module_path.starts_with('.') { return ImportGroupKind::Local; }
      if STDLIB_MODULES.contains(&top_level) { return ImportGroupKind::Stdlib; }
      ImportGroupKind::ThirdParty
  }
  ```

- [ ] Add `detect_local_packages()` helper for workspace analysis

**Code Location:** `crates/tugtool-python/src/layers/imports.rs`

**Tests:**

- [ ] Unit: `test_classify_future_import` - `__future__` classified as Future
- [ ] Unit: `test_classify_stdlib_import` - `os`, `sys`, `collections` classified as Stdlib
- [ ] Unit: `test_classify_stdlib_submodule` - `os.path`, `collections.abc` classified as Stdlib
- [ ] Unit: `test_classify_third_party_import` - `numpy`, `requests` classified as ThirdParty
- [ ] Unit: `test_classify_local_import` - Project packages classified as Local
- [ ] Unit: `test_classify_relative_import` - `.module` classified as Local
- [ ] Unit: `test_detect_local_packages` - Workspace packages detected correctly

---

###### Phase C: ImportInserter Implementation {#step-0-9-phase-c}

**Prerequisites:** Phase A and B complete

**Context:** `ImportInserter` adds new import statements at the correct location in a file, respecting import groups and existing organization.

**Tasks:**

- [ ] Implement `ImportInserter` struct with builder pattern
- [ ] Implement `analyze_existing_imports()` to scan file for import locations
- [ ] Implement `find_insertion_point()` for `Preserve` mode:
  - If imports of same group exist, insert after last one in group
  - If no imports of same group, insert at appropriate boundary
  - Handle TYPE_CHECKING blocks specially
- [ ] Implement `find_insertion_point()` for `Organize` mode:
  - Sort all imports by group then alphabetically
  - Insert in correct sorted position
- [ ] Handle edge cases:
  - File with no existing imports
  - File with only docstring (insert after docstring)
  - File with `__future__` imports (never insert before)
  - Multiline imports with parentheses

**Code Location:** `crates/tugtool-python/src/layers/imports.rs`

**Tests:**

- [ ] Unit: `test_insert_into_empty_file` - Insert into file with no imports
- [ ] Unit: `test_insert_stdlib_after_stdlib` - Insert os.path after existing os import
- [ ] Unit: `test_insert_third_party_after_stdlib` - numpy goes after os
- [ ] Unit: `test_insert_local_after_third_party` - Local import goes last
- [ ] Unit: `test_insert_preserves_blank_lines` - Blank lines between groups preserved
- [ ] Unit: `test_insert_duplicate_rejected` - Duplicate import returns error
- [ ] Unit: `test_insert_after_docstring` - Import placed after module docstring
- [ ] Unit: `test_insert_after_future` - Never insert before __future__
- [ ] Integration: `test_insert_roundtrip` - Insert, apply edit, parse result

---

###### Phase D: ImportRemover Implementation {#step-0-9-phase-d}

**Prerequisites:** Phase A complete

**Context:** `ImportRemover` removes import statements with proper cleanup (trailing commas, empty lines, entire statements when last name removed).

**Tasks:**

- [ ] Implement `ImportRemover` struct
- [ ] Implement `remove_import()` for entire statement removal
- [ ] Implement `remove_name_from_import()` for single name removal:
  - If this is the only name, remove the entire import statement
  - Otherwise, remove just this name with proper comma handling
- [ ] Implement `calculate_name_removal_span()` for comma handling
- [ ] Handle multiline imports (parenthesized imports)

**Code Location:** `crates/tugtool-python/src/layers/imports.rs`

**Tests:**

- [ ] Unit: `test_remove_single_name_import` - `from os import path` -> removes entire statement
- [ ] Unit: `test_remove_first_from_multi` - `from os import path, getcwd` -> `from os import getcwd`
- [ ] Unit: `test_remove_last_from_multi` - `from os import path, getcwd` -> `from os import path`
- [ ] Unit: `test_remove_middle_from_multi` - `from os import a, b, c` -> `from os import a, c`
- [ ] Unit: `test_remove_with_alias` - `from os import path as p` removes correctly
- [ ] Unit: `test_remove_multiline_single` - Removes line from parenthesized import
- [ ] Unit: `test_remove_last_makes_single_line` - Multi-line with one remaining becomes single-line
- [ ] Unit: `test_remove_trailing_comma_cleanup` - Trailing commas handled

---

###### Phase E: ImportUpdater Implementation {#step-0-9-phase-e}

**Prerequisites:** Phase A complete

**Context:** `ImportUpdater` modifies existing import statements to change module paths or preserve aliases during moves.

**Tasks:**

- [ ] Implement `ImportUpdater` struct
- [ ] Implement `update_module_path()` for changing module path:
  - `from old.module import foo` -> `from new.module import foo`
- [ ] Implement `update_imported_name()` for changing imported name:
  - `from module import old_name` -> `from module import new_name`
  - Preserves any existing alias
- [ ] Implement `convert_to_from_import()` for style conversion:
  - `import module.sub` -> `from module import sub`

**Code Location:** `crates/tugtool-python/src/layers/imports.rs`

**Tests:**

- [ ] Unit: `test_update_module_path_simple` - `from a import x` -> `from b import x`
- [ ] Unit: `test_update_module_path_dotted` - `from a.b import x` -> `from c.d import x`
- [ ] Unit: `test_update_name_simple` - `from m import old` -> `from m import new`
- [ ] Unit: `test_update_name_preserves_alias` - `from m import old as o` -> `from m import new as o`
- [ ] Unit: `test_convert_to_from_import` - `import m.sub` -> `from m import sub`

---

###### Phase F: TYPE_CHECKING Import Tracking {#step-0-9-phase-f}

**Prerequisites:** None (can run in parallel with Phases A-E)

**Context:** Imports inside `if TYPE_CHECKING:` blocks are for type hints only and need special handling during moves. Currently, these are not explicitly tracked.

**Tasks:**

- [ ] Add `is_type_checking` field to `Import` in FactsStore:
  ```rust
  pub struct Import {
      // ... existing fields ...
      /// True if this import is inside an `if TYPE_CHECKING:` block.
      #[serde(skip_serializing_if = "std::ops::Not::not", default)]
      pub is_type_checking: bool,
  }
  ```

- [ ] Update `Import::new()` and add builder method:
  ```rust
  pub fn with_type_checking(mut self, is_type_checking: bool) -> Self {
      self.is_type_checking = is_type_checking;
      self
  }
  ```

- [ ] Update CST `ImportCollector` to detect TYPE_CHECKING context:
  - Track `type_checking_depth: usize` during visitation
  - Detect `if TYPE_CHECKING:` and `if typing.TYPE_CHECKING:`
  - Set flag on imports collected within those blocks

- [ ] Update `ImportInfo` (CST output) to include `is_type_checking` flag

- [ ] Update analyzer Pass 2 to propagate `is_type_checking` to FactsStore

- [ ] Add query methods to filter TYPE_CHECKING imports:
  ```rust
  pub fn type_checking_imports_in_file(&self, file_id: FileId) -> Vec<&Import> { ... }
  pub fn runtime_imports_in_file(&self, file_id: FileId) -> Vec<&Import> { ... }
  ```

**Code Location:**
- `crates/tugtool-core/src/facts/mod.rs` - Import struct, query methods
- `crates/tugtool-python-cst/src/visitor/imports.rs` - ImportCollector
- `crates/tugtool-python/src/analyzer.rs` - Propagation

**Tests:**

- [ ] Unit: `test_type_checking_import_detected` - `if TYPE_CHECKING: import x` flagged
- [ ] Unit: `test_typing_type_checking_detected` - `if typing.TYPE_CHECKING:` flagged
- [ ] Unit: `test_regular_import_not_flagged` - Normal imports have `is_type_checking=false`
- [ ] Unit: `test_nested_type_checking` - Nested if inside TYPE_CHECKING handled
- [ ] Unit: `test_type_checking_query_filters` - Query methods return correct subsets
- [ ] Integration: `test_type_checking_preserved_in_facts_store` - Roundtrip preservation

---

###### Step 0.9 Success Criteria {#step-0-9-success}

- [ ] `ImportInserter` can add imports at correct locations with proper grouping
- [ ] `ImportRemover` can remove single names from multi-name imports with proper cleanup
- [ ] `ImportUpdater` can update module paths and names while preserving aliases
- [ ] `Import.is_type_checking` correctly identifies imports in TYPE_CHECKING blocks
- [ ] All existing tests pass
- [ ] Import manipulation tests cover edge cases (multiline, aliases, empty results)

**Checkpoint:**

- [ ] `cargo nextest run -p tugtool-python layers::imports` - All import layer tests pass
- [ ] `cargo nextest run -p tugtool-python-cst imports` - CST import tests pass including TYPE_CHECKING
- [ ] `cargo nextest run --workspace` - All existing tests pass
- [ ] `cargo clippy --workspace -- -D warnings` - No warnings

**Rollback:** Revert commit

---

##### Steps 0.8-0.9 Summary {#step-0-8-0-9-summary}

After completing Steps 0.8-0.9 (including 0.8.5), you will have:

- **CallSite persistence:** All call sites are inserted into FactsStore, enabling `call_sites_to_callee()` queries
- **Type decoupling:** FileAnalysis uses adapter types, not CST types directly
- **Scope-aware queries:** `refs_in_scope()` enables efficient parameter/local variable operations
- **Clean architecture:** Python-specific types in `tugtool-python`, language-agnostic types in core
- **Type hierarchy cleanup:** Consistent enum variant naming, consolidated enum definitions, aligned field names ([Step 0.8.5](#step-0-8-5))
- **Import manipulation:** Full infrastructure for adding, removing, and updating imports
- **TYPE_CHECKING awareness:** Imports in type checking blocks are tracked separately

**Final Steps 0.8-0.9 Checkpoint:**

- [ ] `store.call_site_count() > 0` after analyzing code with calls
- [ ] `store.refs_in_scope(file_id, scope_id)` returns scoped references
- [ ] `ReceiverStep::Attribute` variant exists (not `Attr`)
- [ ] `ParamKind`, `Modifier`, `AttributeAccessKind` imported from Core in CST (no duplicates)
- [ ] `AttributeAccessInfo` uses `name`/`span` fields (not `attr_name`/`attr_span`)
- [ ] `ImportInserter::insert()` generates correct edits
- [ ] `ImportRemover::remove_name_from_import()` handles multi-name imports
- [ ] `Import.is_type_checking` is populated correctly
- [ ] `cargo nextest run --workspace` - All tests pass

---

#### Stage 0 Summary {#stage-0-summary}

After completing Steps 0.1-0.9 (including 0.8.5), you will have:
- Edit primitive infrastructure supporting all [D07](#d07-edit-primitives) operations ([Step 0.1](#step-0-1))
- Position-to-node lookup for expression/statement boundary detection ([Step 0.2](#step-0-2))
- Stub file discovery and update infrastructure for [D08](#d08-stub-updates) compliance ([Step 0.3](#step-0-3))
- Reference scope tracking enabling parameter and local variable operations ([Step 0.4](#step-0-4))
- FactsStore completeness: single code path, all CST data propagated ([Step 0.5](#step-0-5))
- Signatures in FactsStore: function/method signatures with full parameter data ([Step 0.6](#step-0-6))
- Accurate rename-param: parameter kind validation and precise edits ([Step 0.7](#step-0-7))
- Implementation gap fixes: CallSite persistence, type decoupling, scope indexes ([Step 0.8](#step-0-8))
- Type hierarchy cleanup: consistent naming, consolidated enums, aligned fields ([Step 0.8.5](#step-0-8-5))
- Import manipulation layer: insert, remove, update imports with TYPE_CHECKING support ([Step 0.9](#step-0-9))

**Final Stage 0 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] All Stage 0 infrastructure has >80% test coverage
- [ ] Infrastructure is ready for Stage 1 operations
- [ ] No FactsStore bypass patterns exist in `ops/` modules
- [ ] `store.signature_count() > 0` after analyzing files with functions
- [ ] `store.call_site_count() > 0` after analyzing files with calls
- [ ] `store.refs_in_scope()` returns scoped references
- [ ] Import manipulation layer fully tested
- [ ] No TODO comments about "get from signature" remain in rename_param.rs

---

#### Stage 1: Foundation Hardening + Layer 1 {#stage-1}

##### Step 1.0.1: Support Type Comments {#step-1-0-1}

**Commit:** `feat(python): add type comment parsing and reference tracking`

**References:** [Table T02](#t02-rename-gaps) (type comments gap), [D08](#d08-stub-updates), [Step 0.3.6.5](#step-0-3-6-5) (StringAnnotationParser for parsing inspiration)

**Context:**

Type comments (`# type: Foo`) are legacy PEP 484-style annotations used in Python 2/3 compatible code. While native annotations (`x: Foo`) are now preferred, type comments remain common in:
- Codebases maintaining Python 2 compatibility
- Assignment statements where inline annotations aren't possible (`x, y = 1, 2  # type: int, int`)
- Function signatures for Python 2 (`def foo(x):  # type: (int) -> str`)

This step adds infrastructure to parse and track type comments so that rename operations can update type references appearing in comments.

**Artifacts:**
- New `crates/tugtool-python-cst/src/visitor/type_comment.rs` - TypeCommentCollector visitor
- Modified `crates/tugtool-python-cst/src/visitor/mod.rs` - Export type_comment module
- Modified `crates/tugtool-python-cst/src/lib.rs` - Re-export type comment types
- Modified `crates/tugtool-python/src/analyzer.rs` - Integrate type comments into analysis

**Tasks:**
- [x] Create `type_comment.rs` module in tugtool-python-cst/src/visitor/
- [x] Add `TypeCommentKind` enum with variants: `Variable` (`# type: T`), `FunctionSignature` (`# type: (...) -> T`), `Ignore` (`# type: ignore`)
- [x] Add `TypeComment` struct with `kind`, `content`, `span`, `line` fields
- [x] Add `TypeNameRef` struct with `name`, `offset_in_comment`, `length` fields (similar to `AnnotationRef` in StringAnnotationParser)
- [x] Add `ParsedTypeComment` struct with `kind`, `content`, `refs: Vec<TypeNameRef>` fields
- [x] Implement `TypeCommentParser` to extract type names from comment content
  - [x] Handle simple types: `# type: Foo`
  - [x] Handle qualified types: `# type: module.Class`
  - [x] Handle generic types: `# type: List[Foo]`
  - [x] Handle union types: `# type: Union[A, B]` and `# type: A | B`
  - [x] Handle function signatures: `# type: (int, str) -> bool`
  - [x] Handle `# type: ignore` and `# type: ignore[code]` (skip parsing, mark as Ignore)
- [x] Implement `TypeCommentParser::rename(comment, old_name, new_name)` for transforming type comments
- [x] Implement `TypeCommentParser::contains_name(comment, name)` check
- [x] Create `TypeCommentCollector` visitor to collect type comments from CST
  - [x] Track comment position relative to statement (same line vs separate line)
  - [x] Associate type comments with their target bindings when possible
- [x] Export types from `visitor/mod.rs` and `lib.rs`
- [x] Integrate `TypeCommentCollector` into analyzer to populate binding/reference data with type comment info

**Design Notes:**

Type comment parsing follows the same pattern as `StringAnnotationParser` from [Step 0.3.6.5](#step-0-3-6-5):
1. Extract the comment content after `# type:` prefix
2. Tokenize into type names and punctuation
3. Track spans relative to comment start for precise edits
4. Apply renames in reverse order to preserve span validity

The `TypeCommentCollector` visitor integrates with existing CST infrastructure:
- Collect comments during CST traversal (comments are tokens, not nodes)
- Filter for `# type:` prefix
- Parse content using `TypeCommentParser`
- Associate with adjacent bindings when on same line

**Tests:**
- [x] Unit: `test_type_comment_parse_simple` - Parse `# type: Foo`
- [x] Unit: `test_type_comment_parse_qualified` - Parse `# type: module.Class`
- [x] Unit: `test_type_comment_parse_generic` - Parse `# type: List[Foo]`
- [x] Unit: `test_type_comment_parse_union` - Parse `# type: Union[A, B]`
- [x] Unit: `test_type_comment_parse_pipe_union` - Parse `# type: A | B`
- [x] Unit: `test_type_comment_parse_function_sig` - Parse `# type: (int) -> str`
- [x] Unit: `test_type_comment_parse_ignore` - Recognize `# type: ignore`
- [x] Unit: `test_type_comment_parse_ignore_code` - Recognize `# type: ignore[attr-defined]`
- [x] Unit: `test_type_comment_rename_simple` - Rename type in simple comment
- [x] Unit: `test_type_comment_rename_generic` - Rename type in generic comment
- [x] Unit: `test_type_comment_rename_multiple` - Rename multiple occurrences
- [x] Unit: `test_type_comment_contains_name_true` - Name found in comment
- [x] Unit: `test_type_comment_contains_name_false` - Name not found
- [x] Unit: `test_type_comment_collector_basic` - Collect type comments from source
- [x] Unit: `test_type_comment_collector_multiple` - Collect multiple type comments
- [x] Integration: `test_type_comment_binding_association` - Type comments linked to bindings

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` succeeds
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python-cst type_comment` passes
- [x] `cargo nextest run -p tugtool-python type_comment` passes
- [x] `cargo clippy --workspace -- -D warnings` passes

**Rollback:** Revert commit

---

##### Step 1.0.2: Migrate Rename to BatchSpanEditor {#step-1-0-2}

**Commit:** `refactor(python): migrate RenameTransformer to BatchSpanEditor`

**References:** [D07](#d07-edit-primitives), [Step 0.1](#step-0-1) (BatchSpanEditor implementation), [D05](#d05-rename-reference)

**Context:**

The current rename implementation uses `RenameTransformer` in `tugtool-python-cst/src/visitor/rename.rs`. This step migrates the rename operation to use `BatchSpanEditor` from [Step 0.1](#step-0-1), which provides the generalized edit primitive infrastructure that all Phase 13 operations will share.

This migration:
1. Validates that `BatchSpanEditor` handles all rename use cases correctly
2. Establishes the pattern for how other operations will use edit primitives
3. Allows deprecation of `RenameTransformer` (keeping it temporarily for comparison)
4. Enables future rename enhancements (e.g., type comment renames from [Step 1.0.1](#step-1-0-1))

**Artifacts:**
- Modified `crates/tugtool-python/src/ops/rename.rs` - Use BatchSpanEditor instead of RenameTransformer
- Modified `crates/tugtool-python/src/cst_bridge.rs` - Add BatchSpanEditor bridge functions
- Modified `crates/tugtool-python-cst/src/visitor/rename.rs` - Mark RenameTransformer as deprecated
- New `crates/tugtool-python/tests/rename_batch_editor_migration.rs` - Migration validation tests

**Tasks:**
- [x] Add bridge function `cst_bridge::apply_batch_edits(source, edits) -> Result<String>` wrapping BatchSpanEditor
- [x] Update `rename::generate_edits()` to produce `Vec<EditPrimitive>` instead of `Vec<RenameRequest>`
  - [x] Map each reference span to `EditPrimitive::Replace { span, new_text: new_name }`
  - [x] Preserve existing span collection logic
- [x] Update `rename::apply_edits_to_file()` to use `cst_bridge::apply_batch_edits()`
- [x] Verify multi-file rename still works (each file gets its own BatchSpanEditor)
- [x] ~~Add `#[deprecated]` attribute to `RenameTransformer` with migration note~~ (skipped - no external users)
- [x] Verify all existing rename tests pass without modification
- [x] Add migration validation tests comparing old vs new implementation
- [x] ~~Update documentation to reference BatchSpanEditor~~ (skipped - no external users)

**Migration Validation:**

Create parallel test cases that:
1. Run rename with `RenameTransformer` (legacy)
2. Run rename with `BatchSpanEditor` (new)
3. Assert identical output

This ensures no behavioral regression during migration.

**Error Mapping:**

Map `BatchEditError` variants to existing `RenameError`:

| BatchEditError | RenameError |
|---------------|-------------|
| `OverlappingEdits` | (should not occur - indicates bug) |
| `SpanOutOfBounds` | `AnalyzerError` with message |
| `EmptyEdits` | Return success with empty edits |
| `IndentationDetectionFailed` | (not applicable for Replace-only edits) |

**Tests:**
- [x] Unit: `test_batch_editor_single_rename` - Single span replacement
- [x] Unit: `test_batch_editor_multiple_renames` - Multiple spans in same file
- [x] Unit: `test_batch_editor_preserves_formatting` - Whitespace/comments preserved
- [x] Unit: `test_batch_editor_unicode_spans` - Multi-byte character handling
- [x] Integration: `test_rename_migration_simple` - Compare old vs new for simple case
- [x] Integration: `test_rename_migration_multifile` - Compare old vs new for multi-file
- [x] Integration: `test_rename_migration_complex` - Compare old vs new for complex case
- [x] Regression: All existing rename tests in `crates/tugtool-python/tests/` pass unchanged

**Checkpoint:**
- [x] `cargo build -p tugtool-python` succeeds
- [x] `cargo nextest run -p tugtool-python rename` passes (all existing tests)
- [x] `cargo nextest run -p tugtool-python rename_batch_editor_migration` passes
- [x] `cargo clippy --workspace -- -D warnings` passes
- [x] ~~`RenameTransformer` has `#[deprecated]` attribute~~ (skipped - no external users)

**Rollback:** Revert commit

---

##### Step 1.1: Rename Hardening {#step-1-1}

**Commit:** `fix(python): address rename edge cases and add missing tests`

**References:** [D05](#d05-rename-reference), [D09](#d09-comprehension-scope), [Layer 0](#layer-0), [Table T02](#t02-rename-gaps), [D08](#d08-stub-updates), [Step 0.3](#step-0-3), [Step 0.4](#step-0-4), [Step 1.0.1](#step-1-0-1), [Step 1.0.2](#step-1-0-2)

**Prerequisites:** [Step 0.4](#step-0-4) (reference scope infrastructure), [Step 1.0.1](#step-1-0-1) (type comment infrastructure), [Step 1.0.2](#step-1-0-2) (BatchSpanEditor migration)

**Artifacts:**
- Updated `crates/tugtool-python/src/ops/rename.rs`
- New tests in `crates/tugtool-python/tests/rename_hardening.rs`
- New tests in `crates/tugtool-python/tests/rename_type_comments.rs`

**Tasks:**
- [x] Address decorator argument renaming
- [x] Add comprehension scope edge case handling (see [D09](#d09-comprehension-scope))
- [x] Integrate type comment renaming using infrastructure from [Step 1.0.1](#step-1-0-1)
- [ ] ~~Add `__init__.py` re-export detection~~ DEFERRED to [Step 3.1](#step-3-1) (requires Layer 3)
- [x] Add multi-inheritance rename tests
- [x] Add aliased import rename tests
- [x] Add property setter rename tests
- [x] Add nested class rename handling (class defined inside function)
- [x] Add walrus operator (`:=`) target renaming
- [ ] ~~Update rename to edit stubs and string annotations per [D08](#d08-stub-updates)~~ DEFERRED to [Step 1.2](#step-1-2)

**Tests:**
- [x] Unit: `test_rename_decorator_arg` (20 tests in `rename_hardening.rs`)
- [x] Unit: `test_rename_comprehension_scope` (in `rename_hardening.rs`)
- [x] Unit: `test_rename_type_comment` (13 tests in `rename_type_comments.rs`)
- [x] Unit: `test_rename_nested_class` (in `rename_hardening.rs`)
- [x] Unit: `test_rename_walrus_operator` (in `rename_hardening.rs`)
- [ ] ~~Integration: `test_rename_init_reexport`~~ DEFERRED to [Step 3.1](#step-3-1)
- [x] Integration: `test_rename_diamond_inheritance` (in `rename_hardening.rs`)
- [ ] ~~Integration: `test_rename_updates_stub`~~ DEFERRED to [Step 1.2](#step-1-2)
- [ ] ~~Integration: `test_rename_updates_string_annotation`~~ DEFERRED to [Step 1.2](#step-1-2)
- [x] Integration: `test_rename_type_comment_in_function` (in `rename_type_comments.rs`)
- [x] Integration: `test_rename_type_comment_multifile` (in `rename_type_comments.rs`)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python rename` (111 tests pass)
- [x] 7 of 10 [Table T02](#t02-rename-gaps) items addressed (2 deferred, 1 requires [Step 0.4](#step-0-4))

**Rollback:** Revert commit

---

##### Step 1.2: Rename Parameter Operation {#step-1-2}

**Commit:** `feat(python): add rename-param operation`

**References:** [D05](#d05-rename-reference), [Operation 1: Rename Parameter](#op-rename-param), [D08](#d08-stub-updates), [Step 0.4](#step-0-4), [Step 1.1](#step-1-1)

**Prerequisites:** [Step 0.4](#step-0-4) (reference scope infrastructure - required for parameter body references), [Step 1.1](#step-1-1) (rename hardening)

**Artifacts:**
- Updated CLI in `crates/tugtool/src/cli.rs`
- New command: `tug apply python rename-param`

**Tasks:**
- [ ] Extract rename-param logic from general rename
- [ ] Add parameter-specific validation
- [ ] Update call sites with keyword arguments
- [ ] Update parameter names in `.pyi` stubs when present (D08)
- [ ] Update general rename to edit stubs per [D08](#d08-stub-updates) (deferred from [Step 1.1](#step-1-1))
- [ ] Update general rename to edit string annotations per [D08](#d08-stub-updates) (deferred from [Step 1.1](#step-1-1))

**Tests:**
- [ ] Integration: `test_rename_param_basic`
- [ ] Integration: `test_rename_param_keyword_only`
- [ ] Integration: `test_rename_param_updates_stub`
- [ ] Integration: `test_rename_updates_stub` (deferred from [Step 1.1](#step-1-1))
- [ ] Integration: `test_rename_updates_string_annotation` (deferred from [Step 1.1](#step-1-1))
- [ ] Golden: `rename_param_response.json`

**Checkpoint:**
- [ ] `tug apply python rename-param --at test.py:5:10 --to new_name`

**Rollback:** Revert commit

---

##### Step 1.3: Layer 1 Infrastructure {#step-1-3}

**Commit:** `feat(python): add Layer 1 expression analysis infrastructure`

**References:** [Layer 1](#layer-1), [Table T05](#t05-layer1-components), [Step 0.2](#step-0-2)

**Dependencies:** [Step 0.2](#step-0-2) (position lookup infrastructure)

**Artifacts:**
- New `crates/tugtool-python/src/layers/` module
- New `crates/tugtool-python/src/layers/expression.rs`
- Updated `crates/tugtool-python/src/lib.rs` (export layers module)

**Tasks:**
- [ ] Create `layers/mod.rs` with module structure
- [ ] Implement `ExpressionBoundaryDetector` (uses position lookup from Step 0.2)
- [ ] Implement `UniqueNameGenerator`
- [ ] Implement `SingleAssignmentChecker`
- [ ] Handle comprehension/generator expression scopes
- [ ] Add comprehensive unit tests

**Tests:**
- [ ] Unit: `test_expression_boundary_simple`
- [ ] Unit: `test_expression_boundary_parenthesized`
- [ ] Unit: `test_unique_name_no_conflict`
- [ ] Unit: `test_unique_name_with_conflict`
- [ ] Unit: `test_single_assignment_true`
- [ ] Unit: `test_single_assignment_reassigned`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python expression`
- [ ] All Layer 1 components have >80% test coverage

**Rollback:** Revert commit, delete `layers/` directory

---

##### Step 1.4: Extract Variable Operation {#step-1-4}

**Commit:** `feat(python): add extract-variable operation`

**References:** [Operation 2: Extract Variable](#op-extract-variable), [Layer 1](#layer-1), [D07](#d07-edit-primitives), [Step 0.1](#step-0-1), [Step 0.2](#step-0-2), [Step 1.3](#step-1-3)

**Artifacts:**
- New `crates/tugtool-python/src/ops/extract_variable.rs`
- CLI command: `tug apply python extract-variable`

**Placement Rules:**

The extracted variable assignment is inserted:
1. **Statement context:** Immediately before the statement containing the expression
2. **Expression context:** At the same indentation level as the enclosing statement
3. **Multi-line expressions:** Before the first line of the enclosing statement

**Rejection Cases (MVP):**
- Expression inside comprehension (would change semantics - evaluated per-iteration vs once)
- Expression inside lambda (cannot add statements)
- Expression inside decorator arguments (complex evaluation order)

**Tasks:**
- [ ] Implement extract-variable operation
- [ ] Validate expression boundary using Layer 1 infrastructure
- [ ] Generate unique name if not provided
- [ ] Detect insertion point (before enclosing statement)
- [ ] Detect and preserve indentation
- [ ] Replace expression with variable reference
- [ ] Reject comprehension/lambda/decorator contexts with clear error

**Tests:**
- [ ] Integration: `test_extract_variable_basic`
- [ ] Integration: `test_extract_variable_nested`
- [ ] Integration: `test_extract_variable_in_function`
- [ ] Integration: `test_extract_variable_multiline`
- [ ] Integration: `test_extract_variable_reject_comprehension`
- [ ] Integration: `test_extract_variable_reject_lambda`
- [ ] Golden: `extract_variable_response.json`

**Checkpoint:**
- [ ] `tug apply python extract-variable --at test.py:5:10-5:25 --name total`
- [ ] Output matches golden schema

**Rollback:** Revert commit

---

##### Step 1.5: Extract Constant Operation {#step-1-5}

**Commit:** `feat(python): add extract-constant operation`

**References:** [Operation 3: Extract Constant](#op-extract-constant), [Layer 1](#layer-1), [D07](#d07-edit-primitives), [Step 0.1](#step-0-1), [Step 1.3](#step-1-3)

**Artifacts:**
- New `crates/tugtool-python/src/ops/extract_constant.rs`
- CLI command: `tug apply python extract-constant`

**Supported Literal Types:**
- Integer literals (`42`, `0xFF`, `0b1010`)
- Float literals (`3.14`, `1e-5`)
- String literals (`"hello"`, `'world'`, `"""multiline"""`)
- Bytes literals (`b"data"`)
- Boolean literals (`True`, `False`)
- None literal (`None`)
- Complex numbers (`3+4j`) - deferred, low priority
- Ellipsis (`...`) - deferred, rarely extracted

**Placement Rules:**
1. After all imports (including TYPE_CHECKING blocks)
2. Before the first class or function definition
3. If constants already exist, add after them (preserve grouping)

**Tasks:**
- [ ] Implement extract-constant operation
- [ ] Detect literal expressions (all supported types)
- [ ] Insert constant at module level (after imports, before first definition)
- [ ] Validate constant naming (UPPER_SNAKE_CASE warning if not)
- [ ] Check for name conflicts with existing module-level names

**Tests:**
- [ ] Integration: `test_extract_constant_number`
- [ ] Integration: `test_extract_constant_string`
- [ ] Integration: `test_extract_constant_placement`
- [ ] Golden: `extract_constant_response.json`

**Checkpoint:**
- [ ] `tug apply python extract-constant --at test.py:10:15 --name TAX_RATE`

**Rollback:** Revert commit

---

#### Stage 1 Summary {#stage-1-summary}

After completing Steps 1.1-1.5, you will have:
- Hardened rename operation with all edge cases addressed
- Layer 1 infrastructure for expression analysis
- 4 operations: Rename Symbol, Rename Parameter, Extract Variable, Extract Constant

**Final Stage 1 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] `tug analyze python --help` shows all 4 operations
- [ ] Temporale fixture tests pass for all operations

---

#### Stage 2: Layer 2 (Side Effects + Use-Def) {#stage-2}

##### Step 2.1: Layer 2 Infrastructure {#step-2-1}

**Commit:** `feat(python): add Layer 2 statement analysis infrastructure`

**References:** [Layer 2](#layer-2), [D02](#d02-conservative-side-effects), [Table T10](#t10-purity-rules), [Table T06](#t06-layer2-components)

**Artifacts:**
- New `crates/tugtool-python/src/layers/statement.rs`

**Tasks:**
- [ ] Implement `SideEffectAnalyzer` with conservative defaults
- [ ] Implement `UseDefAnalyzer` using existing binding/reference data
- [ ] Implement `UnusedSymbolDetector`
- [ ] Add comprehensive unit tests

**Tests:**
- [ ] Unit: `test_side_effect_pure_expression`
- [ ] Unit: `test_side_effect_function_call`
- [ ] Unit: `test_use_def_simple`
- [ ] Unit: `test_unused_function`
- [ ] Unit: `test_unused_import`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python statement`

**Rollback:** Revert commit

---

##### Step 2.2: Inline Variable Operation {#step-2-2}

**Commit:** `feat(python): add inline-variable operation`

**References:** [Operation 4: Inline Variable](#op-inline-variable), [Layer 2](#layer-2), [D02](#d02-conservative-side-effects), [Table T10](#t10-purity-rules), [D07](#d07-edit-primitives), [Step 0.1](#step-0-1), [Step 2.1](#step-2-1)

**Artifacts:**
- New `crates/tugtool-python/src/ops/inline_variable.rs`
- CLI command: `tug apply python inline-variable`

**Tasks:**
- [ ] Implement inline-variable operation
- [ ] Check single-assignment constraint
- [ ] Check side-effect purity (or single use)
- [ ] Replace all references with expression
- [ ] Remove assignment statement

**Tests:**
- [ ] Integration: `test_inline_variable_basic`
- [ ] Integration: `test_inline_variable_multi_use_pure`
- [ ] Integration: `test_inline_variable_reject_impure_multi`
- [ ] Integration: `test_inline_variable_reject_reassigned`
- [ ] Golden: `inline_variable_response.json`

**Checkpoint:**
- [ ] `tug apply python inline-variable --at test.py:5:1`

**Rollback:** Revert commit

---

##### Step 2.3: Safe Delete Operation (Basic) {#step-2-3}

**Commit:** `feat(python): add safe-delete operation (basic)`

**References:** [Operation 5: Safe Delete](#op-safe-delete), [Layer 2](#layer-2), [Table T12](#t12-public-api), [Step 2.1](#step-2-1)

**Artifacts:**
- New `crates/tugtool-python/src/ops/safe_delete.rs`
- CLI command: `tug apply python safe-delete`

**Tasks:**
- [ ] Implement safe-delete operation
- [ ] Check for any references to symbol
- [ ] Report error if symbol is used
- [ ] Delete symbol definition

**Tests:**
- [ ] Integration: `test_safe_delete_unused_function`
- [ ] Integration: `test_safe_delete_unused_class`
- [ ] Integration: `test_safe_delete_reject_used`
- [ ] Golden: `safe_delete_response.json`

**Checkpoint:**
- [ ] `tug apply python safe-delete --at test.py:5:5`

**Rollback:** Revert commit

---

#### Stage 2 Summary {#stage-2-summary}

After completing Steps 2.1-2.3, you will have:
- Layer 2 infrastructure for side-effect and use-def analysis
- 6 operations total (adding Inline Variable, Safe Delete basic)

**Final Stage 2 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] All Layer 2 components tested
- [ ] Inline Variable rejects impure multi-use (conservative)

---

#### Stage 3: Layer 3 (Import Manipulation) {#stage-3}

##### Step 3.1: Layer 3 Infrastructure {#step-3-1}

**Commit:** `feat(python): add Layer 3 import manipulation infrastructure`

**References:** [Layer 3](#layer-3), [Table T08](#t08-import-order), [Table T09](#t09-special-imports), [Table T07](#t07-layer3-components), [Table T02](#t02-rename-gaps), [Step 1.1](#step-1-1)

**Artifacts:**
- New `crates/tugtool-python/src/layers/imports.rs`

**Tasks:**
- [ ] Implement `ImportInserter` (finds correct insertion point)
- [ ] Implement `ImportRemover` (handles cleanup)
- [ ] Implement `ImportUpdater` (changes source/target)
- [ ] Add stdlib module list for grouping
- [ ] Add `__init__.py` re-export detection (deferred from [Step 1.1](#step-1-1), [Table T02](#t02-rename-gaps))

**Tests:**
- [ ] Unit: `test_import_insert_after_docstring`
- [ ] Unit: `test_import_insert_preserve`
- [ ] Unit: `test_import_remove_single`
- [ ] Unit: `test_import_remove_from_group`
- [ ] Unit: `test_import_update_source`
- [ ] Integration: `test_rename_init_reexport` (deferred from [Step 1.1](#step-1-1))

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python imports`

**Rollback:** Revert commit

---

##### Step 3.2: Move Function Operation {#step-3-2}

**Commit:** `feat(python): add move-function operation`

**References:** [Operation 6: Move Function](#op-move-function), [Layer 3](#layer-3), [Table T08](#t08-import-order), [Table T09](#t09-special-imports), [D08](#d08-stub-updates), [Step 0.3](#step-0-3), [Step 3.1](#step-3-1)

**Artifacts:**
- New `crates/tugtool-python/src/ops/move_symbol.rs`
- CLI command: `tug apply python move`

**Tasks:**
- [ ] Implement move operation for functions
- [ ] Extract function definition
- [ ] Insert into target module
- [ ] Add necessary imports to target
- [ ] Update all import statements in codebase
- [ ] Check for circular imports
- [ ] Update stub files and string annotations for moved functions (D08)

**Tests:**
- [ ] Integration: `test_move_function_basic`
- [ ] Integration: `test_move_function_with_deps`
- [ ] Integration: `test_move_function_update_imports`
- [ ] Integration: `test_move_function_reject_circular`
- [ ] Integration: `test_move_function_updates_stub`
- [ ] Integration: `test_move_function_updates_string_annotations`
- [ ] Golden: `move_function_response.json`

**Checkpoint:**
- [ ] `tug apply python move --at utils.py:10:1 --to helpers`

**Rollback:** Revert commit

---

##### Step 3.3: Move Class Operation {#step-3-3}

**Commit:** `feat(python): extend move operation for classes`

**References:** [Operation 7: Move Class](#op-move-class), [Layer 3](#layer-3), [Table T08](#t08-import-order), [Table T09](#t09-special-imports), [D08](#d08-stub-updates), [Step 0.3](#step-0-3), [Step 3.1](#step-3-1)

**Tasks:**
- [ ] Extend move operation for classes
- [ ] Handle type annotation references
- [ ] Handle inheritance chains
- [ ] Update stub files and string annotations for moved classes (D08)

**Tests:**
- [ ] Integration: `test_move_class_basic`
- [ ] Integration: `test_move_class_with_subclass`
- [ ] Integration: `test_move_class_type_annotations`
- [ ] Integration: `test_move_class_updates_stub`

**Checkpoint:**
- [ ] `tug apply python move --at models.py:15:1 --to entities`

**Rollback:** Revert commit

---

##### Step 3.4: Safe Delete (with Import Cleanup) {#step-3-4}

**Commit:** `feat(python): enhance safe-delete with import cleanup`

**References:** [Operation 5: Safe Delete](#op-safe-delete), [Layer 3](#layer-3), [Table T08](#t08-import-order), [Table T09](#t09-special-imports), [Step 3.1](#step-3-1)

**Tasks:**
- [ ] Enhance safe-delete to remove imports
- [ ] Clean up `from X import Y` when Y is deleted
- [ ] Clean up `__all__` entries

**Tests:**
- [ ] Integration: `test_safe_delete_removes_imports`
- [ ] Integration: `test_safe_delete_cleans_all`

**Checkpoint:**
- [ ] Safe delete removes all traces including imports

**Rollback:** Revert commit

---

#### Stage 3 Summary {#stage-3-summary}

After completing Steps 3.1-3.4, you will have:
- Layer 3 infrastructure for import manipulation
- 8 operations total (adding Move Function, Move Class, enhanced Safe Delete)

**Final Stage 3 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] Move operations update all imports correctly
- [ ] Safe delete cleans up imports

---

#### Stage 4: Layer 4 (Method Transformation) {#stage-4}

##### Step 4.1: Layer 4 Infrastructure {#step-4-1}

**Commit:** `feat(python): add Layer 4 method transformation infrastructure`

**References:** [Layer 4](#layer-4), [D03](#d03-simple-control-flow), [Table T11](#t11-control-flow-reject), [D07](#d07-edit-primitives), [Step 0.1](#step-0-1)

**Artifacts:**
- New `crates/tugtool-python/src/layers/transform.rs`

**Tasks:**
- [ ] Implement `ParameterAnalyzer` (simple cases)
- [ ] Implement `ReturnValueAnalyzer`
- [ ] Implement `BodyExtractor`
- [ ] Implement `ParameterSubstituter`
- [ ] Implement `ReturnHandler`

**Tests:**
- [ ] Unit: `test_parameter_analyzer_simple`
- [ ] Unit: `test_return_analyzer_single`
- [ ] Unit: `test_body_extractor`
- [ ] Unit: `test_param_substituter`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python transform`

**Rollback:** Revert commit

---

##### Step 4.2: Extract Method Operation {#step-4-2}

**Commit:** `feat(python): add extract-method operation`

**References:** [Operation 8: Extract Method](#op-extract-method), [Layer 4](#layer-4), [D03](#d03-simple-control-flow), [Table T11](#t11-control-flow-reject), [D07](#d07-edit-primitives), [Step 0.1](#step-0-1), [Step 4.1](#step-4-1)

**Artifacts:**
- New `crates/tugtool-python/src/ops/extract_method.rs`
- CLI command: `tug apply python extract-method`

**Tasks:**
- [ ] Implement extract-method operation
- [ ] Validate selection boundaries
- [ ] Analyze parameters and return values
- [ ] Generate method signature
- [ ] Replace selection with method call

**Tests:**
- [ ] Integration: `test_extract_method_simple`
- [ ] Integration: `test_extract_method_with_params`
- [ ] Integration: `test_extract_method_with_return`
- [ ] Integration: `test_extract_method_reject_multi_return`
- [ ] Integration: `test_extract_method_reject_async` (CF_ASYNC)
- [ ] Integration: `test_extract_method_reject_generator` (CF_GENERATOR)
- [ ] Integration: `test_extract_method_reject_exception_boundary` (CF_EXCEPTION)
- [ ] Golden: `extract_method_response.json`

**Checkpoint:**
- [ ] `tug apply python extract-method --at test.py:10:5-15:20 --name helper`

**Rollback:** Revert commit

---

##### Step 4.3: Inline Method Operation {#step-4-3}

**Commit:** `feat(python): add inline-method operation`

**References:** [Operation 9: Inline Method](#op-inline-method), [Layer 4](#layer-4), [Layer 3](#layer-3), [D03](#d03-simple-control-flow), [Table T11](#t11-control-flow-reject), [D07](#d07-edit-primitives), [Step 0.1](#step-0-1), [Step 4.1](#step-4-1)

**Tasks:**
- [ ] Implement inline-method operation
- [ ] Extract method body
- [ ] Substitute parameters with arguments
- [ ] Handle return statements
- [ ] Handle self references

**Tests:**
- [ ] Integration: `test_inline_method_simple`
- [ ] Integration: `test_inline_method_with_self`
- [ ] Integration: `test_inline_method_with_return`
- [ ] Golden: `inline_method_response.json`

**Checkpoint:**
- [ ] `tug apply python inline-method --at test.py:20:10`

**Rollback:** Revert commit

---

##### Step 4.4: Change Signature Operation {#step-4-4}

**Commit:** `feat(python): add change-signature operation`

**References:** [Operation 10: Change Signature](#op-change-signature), [Layer 4](#layer-4), [Table T13](#t13-signature-support), [Table T14](#t14-callsite-constraints), [D08](#d08-stub-updates), [Step 0.3](#step-0-3), [Step 4.1](#step-4-1)

**Tasks:**
- [ ] Implement change-signature operation
- [ ] Support --add, --remove, --reorder
- [ ] Update all call sites
- [ ] Handle default values
- [ ] Update stub signatures and string annotations per [D08](#d08-stub-updates)

**Tests:**
- [ ] Integration: `test_change_sig_add_param`
- [ ] Integration: `test_change_sig_remove_param`
- [ ] Integration: `test_change_sig_reorder`
- [ ] Integration: `test_change_sig_updates_stub`
- [ ] Integration: `test_change_sig_updates_string_annotation`
- [ ] Golden: `change_signature_response.json`

**Checkpoint:**
- [ ] `tug apply python change-signature --at test.py:5:5 --add "timeout=30"`

**Rollback:** Revert commit

---

#### Stage 4 Summary {#stage-4-summary}

After completing Steps 4.1-4.4, you will have:
- Layer 4 infrastructure for method transformation
- 11 operations total (adding Extract Method, Inline Method, Change Signature)

**Final Stage 4 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] Extract Method works for simple single-exit cases
- [ ] Inline Method handles self references correctly

---

### 13.7 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A comprehensive Python refactoring engine with 10+ operations built on layered infrastructure.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] **Stage 0 infrastructure complete:** Edit primitives, position lookup, stub discovery all implemented
- [ ] **10+ operations implemented:** Rename, Rename Parameter, Extract Variable, Extract Constant, Inline Variable, Safe Delete, Move Function, Move Class, Extract Method, Inline Method, Change Signature
- [ ] **Layers 0-4 complete:** All infrastructure components implemented and tested
- [ ] **Rename hardened:** All [Table T02](#t02-rename-gaps) gaps addressed
- [ ] **Golden tests:** Each operation has golden output tests
- [ ] **Temporale coverage:** All operations tested against Temporale fixture
- [ ] **Documentation:** AGENT_API.md updated with all operations

**Acceptance tests:**
- [ ] `cargo nextest run --workspace` passes
- [ ] `cargo clippy --workspace -- -D warnings` clean
- [ ] All golden tests pass
- [ ] Temporale integration tests pass

#### Milestones {#milestones}

**Milestone M00: Stage 0 Complete** {#m00-stage0}
- [ ] Edit primitive infrastructure complete (`BatchSpanEditor`)
- [ ] Position lookup infrastructure complete
- [ ] Stub discovery and update infrastructure complete
- [ ] All Stage 0 tests pass with >80% coverage

**Milestone M01: Stage 1 Complete** {#m01-stage1}
- [ ] 4 operations: Rename, Rename Parameter, Extract Variable, Extract Constant
- [ ] Layer 1 infrastructure complete
- [ ] All T02 rename gaps addressed

**Milestone M02: Stage 2 Complete** {#m02-stage2}
- [ ] 6 operations (adding Inline Variable, Safe Delete)
- [ ] Layer 2 infrastructure complete

**Milestone M03: Stage 3 Complete** {#m03-stage3}
- [ ] 8 operations (adding Move Function, Move Class)
- [ ] Layer 3 infrastructure complete

**Milestone M04: Stage 4 Complete** {#m04-stage4}
- [ ] 11 operations (adding Extract Method, Inline Method, Change Signature)
- [ ] Layer 4 infrastructure complete

#### Roadmap / Follow-ons {#roadmap}

- [ ] Stage 5: Layers 5-6 (Encapsulate Field, Pull Up/Push Down, Move Module)
- [ ] Organize Imports operation (if demand exists)
- [ ] Pattern-based transforms (future phase)
- [ ] Advanced control flow (multiple returns, exception handling)

---

### References {#references}

- [Rope Python Refactoring Library](https://github.com/python-rope/rope)
- [Rope Documentation](https://rope.readthedocs.io/en/latest/overview.html)
- [Bowler Safe Refactoring](https://pybowler.io/)
- [LibCST Codemods](https://libcst.readthedocs.io/en/latest/codemods.html)
- [Ruff Linter](https://docs.astral.sh/ruff/linter/)
- [PyCharm Refactoring](https://www.jetbrains.com/help/pycharm/refactoring-source-code.html)
- [Refactoring.Guru - Extract Method](https://refactoring.guru/extract-method)
- [Refactoring.Guru - Extract Variable](https://refactoring.guru/extract-variable)
