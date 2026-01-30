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
| Last updated | 2026-01-29 |

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
- [ ] **Stage 0 infrastructure complete:** Edit primitives, position lookup, stub discovery
- [ ] **All Layer 0-4 infrastructure complete:** Each layer has dedicated tests
- [ ] **Rename hardened:** All edge cases in [Table T02](#t02-rename-gaps) addressed
- [ ] **Cross-layer integration tests:** 50+ integration tests across operations
- [ ] **Temporale fixture coverage:** All operations tested against real Python code

#### Scope {#scope}

1. Build Stage 0 infrastructure (edit primitives, position lookup, stub discovery)
2. Harden existing rename operation (Layer 0)
3. Implement Layers 1-4 infrastructure
4. Ship operations: Extract Variable, Inline Variable, Safe Delete, Move Function, Move Class, Extract Method, Inline Method, Change Signature
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
    "kind": "stub_parse",
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
| Decorator arguments | `@decorator(foo)` where `foo` is renamed | Medium | TODO |
| Comprehension scope | Variable in nested comprehension scope | Low | TODO |
| Type comments | `# type: Foo` comments | Low | TODO |
| `__init__.py` re-exports | Implicit re-exports not in `__all__` | Medium | TODO |
| Multi-inheritance rename | Method rename in diamond hierarchy | Medium | TODO |
| Aliased import rename | `from x import foo as bar; bar()` | Medium | TODO |
| Property setter rename | Renaming property with getter/setter | Medium | TODO |
| Nested class rename | Class defined inside function | Low | TODO |
| Walrus operator | Rename target of `:=` | Low | TODO |

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
    "kind": "position_out_of_range",
    "message": "Location 120:80 is outside file bounds",
    "suggestion": "Choose a location within the file"
  }
}
```

**Symbol location:** For some operations, the cursor can be anywhere on the symbol name.

#### 13.4.3 Output Schemas {#output-schemas}

See Phase 12 documentation for base schemas. New operations follow the same envelope format:

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
- **Numeric exit codes** (process exit status): 2, 3, 4, 5, 10 per CLAUDE.md Table T26
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

**Tasks:**
- [ ] Create `EditPrimitive` enum with variants: Replace, InsertBefore, InsertAfter, Delete, InsertAt
- [ ] Create `BatchSpanEditor` struct that collects edit primitives
- [ ] Implement `apply_edits()` that applies edits in reverse position order
- [ ] Implement overlapping edit detection and rejection
- [ ] Implement indentation detection and insertion for InsertBefore/InsertAfter
- [ ] Handle Unicode/multi-byte character spans correctly
- [ ] Add comprehensive documentation and examples

**Tests:**
- [ ] Unit: `test_replace_single_span`
- [ ] Unit: `test_replace_multiple_spans`
- [ ] Unit: `test_insert_before_statement`
- [ ] Unit: `test_insert_after_expression`
- [ ] Unit: `test_insert_at_position`
- [ ] Unit: `test_delete_span`
- [ ] Unit: `test_multiple_edits_non_overlapping`
- [ ] Unit: `test_overlapping_edits_rejected`
- [ ] Unit: `test_adjacent_edits_allowed`
- [ ] Unit: `test_unicode_multibyte_spans`
- [ ] Unit: `test_indentation_preservation`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python-cst batch_edit`
- [ ] All edit primitive variants have tests

**Rollback:** Revert commit

---

##### Step 0.2: Position Lookup Infrastructure {#step-0-2}

**Commit:** `feat(python-cst): add position-to-node lookup and parent context`

**References:** (#layer-1) - required for `ExpressionBoundaryDetector`

**Artifacts:**
- New `crates/tugtool-python-cst/src/visitor/position_lookup.rs`
- Updated `crates/tugtool-python-cst/src/visitor/mod.rs`

**Tasks:**
- [ ] Create `PositionIndex` struct that maps byte offsets to node information
- [ ] Create `AncestorTracker` for maintaining parent context during traversal
- [ ] Implement `find_node_at_position(position) -> Option<NodeInfo>`
- [ ] Implement `find_expression_at_position(position) -> Option<ExpressionSpan>`
- [ ] Implement `find_statement_at_position(position) -> Option<StatementSpan>`
- [ ] Implement `find_enclosing_scope(position) -> Option<ScopeSpan>`
- [ ] Define `line:col` to byte offset conversion (1-based, Unicode scalar columns)
- [ ] Handle positions at whitespace/comments (find nearest node)
- [ ] Handle positions at statement boundaries

**Tests:**
- [ ] Unit: `test_find_node_simple_expression`
- [ ] Unit: `test_find_node_nested_expression`
- [ ] Unit: `test_find_expression_in_call`
- [ ] Unit: `test_find_expression_parenthesized`
- [ ] Unit: `test_find_enclosing_statement`
- [ ] Unit: `test_find_enclosing_scope`
- [ ] Unit: `test_position_at_whitespace`
- [ ] Unit: `test_position_at_comment`
- [ ] Unit: `test_position_between_statements`
- [ ] Unit: `test_line_col_to_byte_offset_unicode`
- [ ] Unit: `test_position_out_of_range_error`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python-cst position_lookup`
- [ ] All lookup functions return correct spans

**Rollback:** Revert commit

---

##### Step 0.3: Stub Discovery Infrastructure {#step-0-3}

**Commit:** `feat(python): add type stub discovery and update infrastructure`

**References:** [D08](#d08-stub-updates)

**Artifacts:**
- New `crates/tugtool-python/src/stubs.rs`
- Updated `crates/tugtool-python/src/lib.rs`

**Tasks:**
- [ ] Create `StubDiscovery` struct for finding stub files
- [ ] Implement `find_stub_for_module(module_path) -> Option<PathBuf>` (same-dir first, then stubs/)
- [ ] Implement stub file parsing using existing CST parser
- [ ] Create `StubUpdater` that applies rename/move edits to stub files
- [ ] Treat stub parse failures as errors (abort operation)
- [ ] Handle namespace packages (PEP 420)

**String Annotation Parsing:**
- [ ] Create `StringAnnotationParser` for parsing type expressions in string annotations
- [ ] Handle simple names: `"ClassName"` → rename to `"NewName"`
- [ ] Handle qualified names: `"module.ClassName"` → update appropriately
- [ ] Handle forward references in function annotations: `def f(x: "Foo")`
- [ ] Preserve quoting style (single vs double quotes)

**Tests:**
- [ ] Unit: `test_find_stub_same_directory`
- [ ] Unit: `test_find_stub_stubs_folder`
- [ ] Unit: `test_no_stub_exists`
- [ ] Unit: `test_stub_parse_class`
- [ ] Unit: `test_stub_parse_function`
- [ ] Unit: `test_stub_update_rename`
- [ ] Unit: `test_stub_parse_failure_errors`
- [ ] Unit: `test_string_annotation_simple_name`
- [ ] Unit: `test_string_annotation_qualified_name`
- [ ] Unit: `test_string_annotation_preserves_quotes`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python stubs`
- [ ] Stub discovery works for both locations
- [ ] String annotation parsing handles common cases

**Rollback:** Revert commit

---

#### Stage 0 Summary {#stage-0-summary}

After completing Steps 0.1-0.3, you will have:
- Edit primitive infrastructure supporting all D07 operations
- Position-to-node lookup for expression/statement boundary detection
- Stub file discovery and update infrastructure for D08 compliance

**Final Stage 0 Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] All Stage 0 infrastructure has >80% test coverage
- [ ] Infrastructure is ready for Stage 1 operations

---

#### Stage 1: Foundation Hardening + Layer 1 {#stage-1}

##### Step 1.1: Rename Hardening {#step-1-1}

**Commit:** `fix(python): address rename edge cases and add missing tests`

**References:** [D05] Rename as reference, [Table T02](#t02-rename-gaps), (#layer-0)

**Artifacts:**
- Updated `crates/tugtool-python/src/ops/rename.rs`
- Updated `crates/tugtool-python-cst/src/visitor/rename.rs` (migrate to BatchSpanEditor)
- New tests in `crates/tugtool-python/tests/`

**Tasks:**
- [ ] Address decorator argument renaming
- [ ] Add comprehension scope edge case handling
- [ ] Add type comment handling (`# type: Foo` comments)
- [ ] Add `__init__.py` re-export detection
- [ ] Add multi-inheritance rename tests
- [ ] Add aliased import rename tests
- [ ] Add property setter rename tests
- [ ] Add nested class rename handling (class defined inside function)
- [ ] Add walrus operator (`:=`) target renaming
- [ ] Migrate rename to use `BatchSpanEditor` from [Step 0.1](#step-0-1)
- [ ] Update rename to edit stubs and string annotations per [D08](#d08-stub-updates)

**Tests:**
- [ ] Unit: `test_rename_decorator_arg`
- [ ] Unit: `test_rename_comprehension_scope`
- [ ] Unit: `test_rename_type_comment`
- [ ] Unit: `test_rename_nested_class`
- [ ] Unit: `test_rename_walrus_operator`
- [ ] Integration: `test_rename_init_reexport`
- [ ] Integration: `test_rename_diamond_inheritance`
- [ ] Integration: `test_rename_updates_stub`
- [ ] Integration: `test_rename_updates_string_annotation`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python rename`
- [ ] All [Table T02](#t02-rename-gaps) items addressed

**Rollback:** Revert commit

---

##### Step 1.2: Rename Parameter Operation {#step-1-2}

**Commit:** `feat(python): add rename-param operation`

**References:** [D05] Rename as reference, (#op-rename-param)

**Artifacts:**
- Updated CLI in `crates/tugtool/src/cli.rs`
- New command: `tug apply python rename-param`

**Tasks:**
- [ ] Extract rename-param logic from general rename
- [ ] Add parameter-specific validation
- [ ] Update call sites with keyword arguments
- [ ] Update parameter names in `.pyi` stubs when present (D08)

**Tests:**
- [ ] Integration: `test_rename_param_basic`
- [ ] Integration: `test_rename_param_keyword_only`
- [ ] Integration: `test_rename_param_updates_stub`
- [ ] Golden: `rename_param_response.json`

**Checkpoint:**
- [ ] `tug apply python rename-param --at test.py:5:10 --to new_name`

**Rollback:** Revert commit

---

##### Step 1.3: Layer 1 Infrastructure {#step-1-3}

**Commit:** `feat(python): add Layer 1 expression analysis infrastructure`

**References:** (#layer-1), [Table T05](#t05-layer1-components)

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

**References:** (#op-extract-variable), (#layer-1)

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

**References:** (#op-extract-constant), (#layer-1)

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

**References:** (#layer-2), [Table T06](#t06-layer2-components)

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

**References:** (#op-inline-variable), (#layer-2), [D02](#d02-conservative-side-effects)

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

**References:** (#op-safe-delete), (#layer-2)

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

**References:** (#layer-3), [Table T07](#t07-layer3-components)

**Artifacts:**
- New `crates/tugtool-python/src/layers/imports.rs`

**Tasks:**
- [ ] Implement `ImportInserter` (finds correct insertion point)
- [ ] Implement `ImportRemover` (handles cleanup)
- [ ] Implement `ImportUpdater` (changes source/target)
- [ ] Add stdlib module list for grouping

**Tests:**
- [ ] Unit: `test_import_insert_after_docstring`
- [ ] Unit: `test_import_insert_preserve`
- [ ] Unit: `test_import_remove_single`
- [ ] Unit: `test_import_remove_from_group`
- [ ] Unit: `test_import_update_source`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python imports`

**Rollback:** Revert commit

---

##### Step 3.2: Move Function Operation {#step-3-2}

**Commit:** `feat(python): add move-function operation`

**References:** (#op-move-function), (#layer-3)

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

**References:** (#op-move-class), (#layer-3)

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

**References:** (#op-safe-delete), (#layer-3)

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

**References:** (#layer-4), [D03](#d03-simple-control-flow)

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

**References:** (#op-extract-method), (#layer-4), [D03](#d03-simple-control-flow)

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

**References:** (#op-inline-method), (#layer-4)

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

**References:** (#op-change-signature), (#layer-4)

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
