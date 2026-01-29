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
- [ ] **All Layer 0-3 infrastructure complete:** Each layer has dedicated tests
- [ ] **Rename hardened:** All edge cases in [Table T02](#t02-rename-gaps) addressed
- [ ] **Cross-layer integration tests:** 50+ integration tests across operations
- [ ] **Temporale fixture coverage:** All operations tested against real Python code

#### Scope {#scope}

1. Harden existing rename operation (Layer 0)
2. Implement Layers 1-4 infrastructure
3. Ship operations: Extract Variable, Inline Variable, Safe Delete, Move Function, Move Class, Extract Method, Inline Method, Change Signature
4. Document all operations in AGENT_API.md

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
- Span-based replacement only (no CST node insertion)
- Must preserve all formatting/comments (CST-based)

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

#### [Q02] Code generation strategy (OPEN) {#q02-code-generation}

**Question:** Template-based generation vs. CST construction?

**Why it matters:** Affects maintainability and formatting consistency.

**Options:**
- Templates: String interpolation with explicit indentation
- CST: Build nodes programmatically, serialize

**Plan to resolve:** Prototype property generation both ways, compare

**Resolution:** OPEN

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|-------------------|
| Control flow complexity | High | High | Simple-cases-first, clear error messages | >50% of extractions rejected |
| Import manipulation bugs | High | Medium | Extensive golden tests, conservative updates | Any incorrect import after move |
| Side-effect false positives | Medium | Medium | Conservative = safe; document limitations | User complaints about refused refactors |

**Risk R01: Layer 4 Complexity** {#r01-layer4-complexity}

- **Risk:** Control flow analysis for Extract Method is significantly more complex than other infrastructure
- **Mitigation:** Define strict MVP scope (single entry/exit, no exceptions crossing boundary); defer complex cases
- **Residual risk:** Some valid extractions will be rejected; document clearly

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

**Decision:** For MVP, assume expressions with function calls are impure.

**Rationale:**
- Full purity analysis requires deep type system integration
- Conservative analysis is safe (may refuse valid refactors, never breaks code)
- Can be refined incrementally

**Implications:**
- Inline Variable may refuse to inline some safe cases
- Error message explains why and suggests manual refactoring

---

#### [D03] Simple-Cases-First for Control Flow (DECIDED) {#d03-simple-control-flow}

**Decision:** Extract Method MVP supports only:
- Single-entry, single-exit blocks
- No exception handlers crossing selection boundary
- Single return value (or tuple)

**Rationale:**
- Complex control flow significantly increases complexity
- Simple cases cover majority of real-world extractions
- Clear error messages for rejected cases

**Implications:**
- Some extractions will be rejected
- Future enhancement can expand scope

---

#### [D04] Template-Based Code Generation (DECIDED) {#d04-template-generation}

**Decision:** Use string templates (not CST construction) for generated code.

**Rationale:**
- CST construction is verbose and error-prone
- Templates are readable and maintainable
- Indentation handling is explicit

**Implications:**
- Generated code formatting may not exactly match user's style
- Consider black integration for post-generation formatting

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
| Batch Span Replacement | `tugtool-python-cst/src/visitor/rename.rs` | CST-preserving edits |
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
| `ExpressionBoundaryDetector` | Find complete expression at cursor position | Medium |
| `ExpressionExtractor` | Extract expression text with proper span | Low |
| `UniqueNameGenerator` | Generate non-conflicting names in scope | Low |
| `SingleAssignmentChecker` | Verify variable has exactly one assignment | Low |
| `LiteralDetector` | Identify extractable literals (numbers, strings) | Low |

**Implementation Notes:**

- Expression boundary uses CST node parent traversal
- Handle parenthesized expressions correctly
- Unique names consult scope bindings at target location
- Literal detection identifies magic numbers/strings

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

Adds the ability to modify import statements programmatically.

**Components:**

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `ImportInserter` | Add new import statement at correct location | Medium |
| `ImportRemover` | Remove import with proper cleanup | Low |
| `ImportUpdater` | Change import source or target | Medium |
| `StdlibDetector` | Identify standard library modules | Low |
| `CircularImportChecker` | Detect import cycles before move | Low |

**Implementation Notes:**

- Import insertion finds correct position (after docstring, before code)
- Handle `from X import Y as Z` correctly
- Stdlib detection uses bundled module list
- Circular import check uses existing import graph

**Operations Enabled:**

| Operation | Layer 3 Dependencies |
|-----------|---------------------|
| Move Function | Import insertion, import update |
| Move Class | Import insertion, import update |
| Safe Delete (with cleanup) | Import removal |

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
| Inline Method | Parameter substitution, return handling |
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

**Description:** Add, remove, or reorder function parameters.

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

---

### 13.5 Symbol Inventory {#symbol-inventory}

#### 13.5.1 New Files {#new-files}

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

#### Stage 1: Foundation Hardening + Layer 1 {#stage-1}

##### Step 1.1: Rename Hardening {#step-1-1}

**Commit:** `fix(python): address rename edge cases and add missing tests`

**References:** [D05] Rename as reference, [Table T02](#t02-rename-gaps), (#layer-0)

**Artifacts:**
- Updated `crates/tugtool-python/src/ops/rename.rs`
- New tests in `crates/tugtool-python/tests/`

**Tasks:**
- [ ] Address decorator argument renaming
- [ ] Add comprehension scope edge case handling
- [ ] Add `__init__.py` re-export detection
- [ ] Add multi-inheritance rename tests
- [ ] Add aliased import rename tests
- [ ] Add property setter rename tests

**Tests:**
- [ ] Unit: `test_rename_decorator_arg`
- [ ] Unit: `test_rename_comprehension_scope`
- [ ] Integration: `test_rename_init_reexport`
- [ ] Integration: `test_rename_diamond_inheritance`

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

**Tests:**
- [ ] Integration: `test_rename_param_basic`
- [ ] Integration: `test_rename_param_keyword_only`
- [ ] Golden: `rename_param_response.json`

**Checkpoint:**
- [ ] `tug apply python rename-param --at test.py:5:10 --to new_name`

**Rollback:** Revert commit

---

##### Step 1.3: Layer 1 Infrastructure {#step-1-3}

**Commit:** `feat(python): add Layer 1 expression analysis infrastructure`

**References:** (#layer-1), [Table T05](#t05-layer1-components)

**Artifacts:**
- New `crates/tugtool-python/src/layers/` module
- New `crates/tugtool-python/src/layers/expression.rs`

**Tasks:**
- [ ] Create `layers/mod.rs` with module structure
- [ ] Implement `ExpressionBoundaryDetector`
- [ ] Implement `UniqueNameGenerator`
- [ ] Implement `SingleAssignmentChecker`
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

**Tasks:**
- [ ] Implement extract-variable operation
- [ ] Validate expression boundary
- [ ] Generate unique name if not provided
- [ ] Insert variable assignment at correct location
- [ ] Replace expression with variable reference

**Tests:**
- [ ] Integration: `test_extract_variable_basic`
- [ ] Integration: `test_extract_variable_nested`
- [ ] Integration: `test_extract_variable_in_function`
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

**Tasks:**
- [ ] Implement extract-constant operation
- [ ] Detect literal expressions (numbers, strings)
- [ ] Insert constant at module level (after imports)
- [ ] Validate constant naming (UPPER_SNAKE_CASE)

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
- [ ] Unit: `test_import_insert_grouped`
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

**Tests:**
- [ ] Integration: `test_move_function_basic`
- [ ] Integration: `test_move_function_with_deps`
- [ ] Integration: `test_move_function_update_imports`
- [ ] Integration: `test_move_function_reject_circular`
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

**Tests:**
- [ ] Integration: `test_move_class_basic`
- [ ] Integration: `test_move_class_with_subclass`
- [ ] Integration: `test_move_class_type_annotations`

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

**Tests:**
- [ ] Integration: `test_change_sig_add_param`
- [ ] Integration: `test_change_sig_remove_param`
- [ ] Integration: `test_change_sig_reorder`
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

**Milestone M01: Stage 1 Complete** {#m01-stage1}
- [ ] 4 operations: Rename, Rename Parameter, Extract Variable, Extract Constant
- [ ] Layer 1 infrastructure complete

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
