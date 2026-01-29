# Phase 13: Implement Core Python Refactor Operations

## Executive Summary

Phase 13 transforms tugtool from a single-operation tool (rename) into a comprehensive Python refactoring engine. Our architecture advantages—origin-aware MRO, cross-file type resolution, agent-native design—position us to deliver **more correct refactors** than rope, bowler, or ruff in key dimensions.

This plan inventories operations we can implement, ordered by feasibility and impact. The goal: **significantly close the functional gap** with rope while leveraging our architectural strengths.

---

## Competitive Landscape

### Current State

| Capability          | tugtool | rope | bowler | ruff |
|---------------------|---------|------|--------|------|
| Rename              | ✓       | ✓    | ✓      | ✓    |
| Extract Method      | ✗       | ✓    | ~      | ✗    |
| Extract Variable    | ✗       | ✓    | ~      | ✗    |
| Inline Variable     | ✗       | ✓    | ✗      | ✗    |
| Inline Method       | ✗       | ✓    | ✗      | ✗    |
| Move Function/Class | ✗       | ✓    | ~      | ✗    |
| Move Module         | ✗       | ✓    | ✗      | ✗    |
| Change Signature    | ✗       | ✓    | ✗      | ✗    |
| Organize Imports    | ✗       | ✓    | ✗      | ✓    |
| Safe Delete         | ✗       | ~    | ✗      | ✗    |
| Pattern Transforms  | ✗       | ✓    | ✓      | ✗    |

**Legend:**
- ✓ = Fully supported
- ~ = Partially supported (limited functionality or specific use cases)
- ✗ = Not supported

### Our Advantages

1. **Origin-aware MRO** - Unique. Tracks where methods originate across inheritance hierarchies
2. **Cross-file type resolution** - Better than bowler/ruff; comparable to rope
3. **Agent-native design** - JSON output, deterministic operations, verification pipeline
4. **Native Rust performance** - No Python runtime required
5. **Type stub support** - `.pyi` files for better type inference

### Our Gaps

1. **Operation breadth** - Only rename implemented vs. rope's 15+ operations
2. **Import manipulation** - No insert/remove/organize capability yet
3. **Control flow analysis** - Needed for extract method
4. **Code generation** - Can only replace spans, not insert new constructs

---

## Operations Inventory

### Tier 1: Low-Hanging Fruit (Minimal New Infrastructure)

These operations leverage existing infrastructure directly.

#### 1.1 Extract Variable

**Description:** Extract an expression into a named variable.

```python
# Before
result = calculate_tax(get_price() * 1.08)

# After (extracting `get_price() * 1.08`)
total_with_markup = get_price() * 1.08
result = calculate_tax(total_with_markup)
```

**Why feasible:**
- Scope analysis complete (know where to insert)
- Span-based replacement works
- Only single-file operation

**Missing pieces:**
- Expression boundary detection at cursor
- Unique name generation (avoid shadowing)
- Similar expression detection (optional: extract all occurrences)

**Competitive advantage:** Origin-aware scoping prevents incorrect extractions in complex class hierarchies.

---

#### 1.2 Inline Variable

**Description:** Replace variable usages with its value, then remove the assignment.

```python
# Before
base_price = get_price()
total = base_price * 1.08

# After
total = get_price() * 1.08
```

**Why feasible:**
- Alias tracking exists (`AliasGraph`)
- Reference resolution complete
- Single-file operation

**Missing pieces:**
- Single-assignment verification (can't inline reassigned vars)
- Side-effect analysis (can't inline if expression has side effects and is used multiple times)
- Expression capture from assignment RHS

**Competitive advantage:** Alias tracking catches transitive cases (`a = b; c = a`).

---

#### 1.3 Safe Delete

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

**Why feasible:**
- Reference tracking complete (`store.refs_of_symbol()`)
- Cross-file resolution handles imports
- Deletion is simpler than insertion

**Missing pieces:**
- Unused detection across entire project
- Confirmation flow for "might be used" cases (dynamic access)
- Import cleanup when deleting used-by-import symbols

**Competitive advantage:** Cross-file resolution catches imports that rope's static analysis might miss.

---

#### 1.4 Rename Parameter

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

**Why feasible:**
- Signatures collected (`SignatureCollector`)
- Call sites tracked (`CallSiteCollector`)
- Parameter → keyword argument mapping exists

**Missing pieces:**
- Keyword argument span capture
- Call site update logic

**Competitive advantage:** None over rope, but fills a gap.

---

### Tier 2: Moderate Complexity (Some New Infrastructure)

#### 2.1 Extract Method

**Description:** Extract selected statements into a new function, inferring parameters and return values.

```python
# Before
def process(items):
    total = 0
    for item in items:
        # Extract this block
        price = item.get_price()
        tax = price * 0.08
        total += price + tax
    return total

# After
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

**Why feasible:**
- Scope analysis shows variable definitions/uses
- Type inference provides parameter types
- Signature generation leverages existing collectors

**Missing pieces (significant):**
- **Control flow analysis** - Determine which variables are:
  - Read before the selection (→ parameters)
  - Written in the selection and used after (→ return values)
  - Local to the selection (→ local variables)
- **Selection boundary detection** - Ensure selection covers complete statements
- **Method vs function decision** - If extracting from method, should result be method or standalone?
- **Exception flow** - Handle try/except boundaries

**Competitive advantage:** Type inference + MRO provides better parameter type hints than rope.

---

#### 2.2 Extract Constant

**Description:** Extract a literal or expression into a module-level constant.

```python
# Before
def calculate_tax(price):
    return price * 0.08  # magic number

# After
TAX_RATE = 0.08

def calculate_tax(price):
    return price * TAX_RATE
```

**Why feasible:**
- Module scope tracking exists
- Span replacement works
- Simpler than extract variable (module scope only)

**Missing pieces:**
- Constant naming conventions
- Insertion point selection (after imports, before functions)
- Similar literal detection

---

#### 2.3 Move Function

**Description:** Move a top-level function to another module, updating all imports.

```python
# Before: utils.py
def helper():
    pass

# Before: main.py
from utils import helper
helper()

# After: moved to helpers.py, imports updated
from helpers import helper
helper()
```

**Why feasible:**
- Import resolution complete
- Cross-file symbol tracking exists
- Export tracking (`__all__`) exists

**Missing pieces (moderate):**
- **Import insertion** - Add import to target module if function has dependencies
- **Import update** - Change all `from old_module import func` to new location
- **Re-export handling** - Update `__all__` in source module
- **Circular import detection** - Ensure move doesn't create cycles

**Competitive advantage:** Origin-aware tracking handles re-exports correctly.

---

#### 2.4 Move Class

**Description:** Same as move function, but for classes.

Same infrastructure as 2.3, plus:
- Handle class references in type annotations
- Handle inheritance (if base class moves, subclasses need updates)

---

#### 2.5 Inline Method

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

**Why feasible:**
- Method resolution complete (including MRO)
- Call sites tracked
- Body extraction is span-based

**Missing pieces:**
- **Parameter substitution** - Replace formal params with actual args
- **Self-reference adjustment** - `self.x` in inlined code may need renaming
- **Return statement handling** - Convert returns to expression or handle control flow
- **Import preservation** - Inlined body might need its imports

**Competitive advantage:** MRO-aware inlining handles inherited methods correctly.

---

#### 2.6 Change Signature (Basic)

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

**Why feasible:**
- Signatures collected
- Call sites tracked
- Parameter order is explicit in AST

**Missing pieces:**
- **Default value insertion** - Add defaults for new required params at call sites
- **Argument reordering** - Handle positional vs keyword args
- **`*args/**kwargs` handling** - Complex expansion rules

---

### Tier 3: Higher Complexity (Significant New Infrastructure)

#### 3.1 Move Module

**Description:** Move an entire module to a new location, updating all imports across the project.

```python
# Before: utils/helpers.py exists
from utils.helpers import foo

# After: moved to core/helpers.py
from core.helpers import foo
```

**Why challenging:**
- Must update ALL imports across entire codebase
- Handle `__init__.py` files
- Handle relative imports
- Handle star imports
- Handle re-exports through package `__init__.py`

**Missing pieces:**
- Package structure analysis
- Relative import recalculation
- `__init__.py` content management

---

#### 3.2 Pull Up Method

**Description:** Move a method from a subclass to a parent class.

```python
# Before
class Animal:
    pass

class Dog(Animal):
    def speak(self):
        return "Woof"

class Cat(Animal):
    def speak(self):
        return "Meow"

# After (pulling up with abstract)
class Animal:
    def speak(self):
        raise NotImplementedError

class Dog(Animal):
    def speak(self):
        return "Woof"

class Cat(Animal):
    def speak(self):
        return "Meow"
```

**Why feasible:**
- MRO computation exists
- Inheritance graph tracked
- Method signatures collected

**Missing pieces:**
- Abstract method generation
- Conflict detection (method exists in parent with different signature)
- Self-reference adjustment between subclass and parent

**Competitive advantage:** Origin-aware MRO makes this MORE correct than rope. We know exactly where each method originates.

---

#### 3.3 Push Down Method

**Description:** Move a method from a parent class to its subclasses.

Inverse of pull up. Same infrastructure, opposite direction.

---

#### 3.4 Encapsulate Field

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

p = Person()
print(p.name)  # Unchanged - property is transparent
p.name = "Alice"
```

**Why challenging:**
- Requires generating new code (property decorator, getter, setter)
- Must handle all access patterns (read, write, augmented assign)
- Cross-file field access updates

**Missing pieces:**
- Property code generation
- Attribute access pattern classification (done: `AttributeAccessCollector` has Read/Write/Call)
- Generated code formatting

---

#### 3.5 Organize Imports

**Description:** Sort and group imports according to conventions.

```python
# Before
from myproject import utils
import os
from typing import List
import sys
from . import local

# After (PEP 8 grouping)
import os
import sys
from typing import List

from myproject import utils

from . import local
```

**Why feasible:**
- All imports collected
- Span information available

**Missing pieces:**
- Import parsing for sort keys (module path, name)
- Grouping rules (stdlib, third-party, local)
- stdlib module list
- Unused import detection (for removal)

**Note:** Ruff does this well. We'd be replicating, not innovating.

---

#### 3.6 Change Signature (Advanced)

**Description:** Full signature modification with complex argument handling.

Extensions to basic change signature:
- `*args` expansion to named parameters
- `**kwargs` expansion to typed parameters
- Parameter type annotation changes with call site validation
- Decorator preservation and adjustment

---

### Tier 4: Pattern-Based Operations

These are Bowler's strength. We could implement a subset.

#### 4.1 Use Function (Replace Pattern with Call)

**Description:** Find code patterns matching a function's implementation and replace with calls.

```python
# Pattern: price * 1.08 → add_tax(price)
# Before
total = base * 1.08
# After
total = add_tax(base)
```

**Why hard:**
- Pattern matching against CST subtrees
- Variable binding in patterns
- Expression equivalence determination

---

#### 4.2 Restructure (Pattern-to-Goal)

**Description:** Transform code matching one pattern to another.

```python
# Pattern: string.format(...) → f-string
# Before
"Hello {}".format(name)
# After
f"Hello {name}"
```

**LibCST already provides** this as a built-in codemod. Competition is steep here.

---

### Tier 5: Not Currently Feasible

These require capabilities beyond span-based replacement.

| Operation | Blocker |
|-----------|---------|
| Introduce Parameter Object | Requires generating new class |
| Convert to Data Class | Requires `@dataclass` decorator + field generation |
| Extract Superclass | Requires class generation + inheritance modification |
| Extract Interface | Python doesn't have interfaces; Protocol generation is complex |
| Generic Type Refactoring | TypeVar resolution not implemented |

---

## Recommended Implementation Order

### Phase 13A: Quick Wins

1. **Extract Variable** - Demonstrates extraction workflow
2. **Inline Variable** - Completes extraction/inline symmetry
3. **Safe Delete** - Useful safety operation

### Phase 13B: Method Operations

4. **Extract Method** - High-value operation, needs control flow analysis
5. **Inline Method** - Completes method extraction/inline symmetry
6. **Rename Parameter** - Low-hanging fruit, extends rename

### Phase 13C: Movement Operations

7. **Move Function** - Requires import insertion infrastructure
8. **Move Class** - Reuses move function infrastructure
9. **Move Module** - Complex but high-impact

### Phase 13D: Hierarchy Operations

10. **Pull Up Method** - Leverages MRO advantage
11. **Push Down Method** - Inverse of pull up
12. **Encapsulate Field** - Requires code generation

### Phase 13E: Signature Operations

13. **Change Signature (Basic)** - Parameter add/remove/reorder
14. **Change Signature (Advanced)** - `*args/**kwargs` handling

### Phase 13F: Import Operations

15. **Organize Imports** - Useful but ruff competition

---

## Infrastructure Required

### For Tier 1 Operations

| Component                        | Status | Required For              |
|----------------------------------|--------|---------------------------|
| Expression boundary detection    | NEW    | Extract Variable          |
| Unique name generation           | NEW    | Extract Variable/Method   |
| Single-assignment verification   | NEW    | Inline Variable           |
| Side-effect analysis (basic)     | NEW    | Inline Variable           |

### For Tier 2 Operations

| Component                | Status              | Required For                    |
|--------------------------|---------------------|---------------------------------|
| Control flow analysis    | NEW (significant)   | Extract Method                  |
| Import insertion         | NEW                 | Move Function, Inline Method    |
| Import update/removal    | NEW                 | Move Function, Safe Delete      |
| Parameter substitution   | NEW                 | Inline Method                   |
| Return statement handling| NEW                 | Inline Method                   |

### For Tier 3 Operations

| Component                      | Status | Required For      |
|--------------------------------|--------|-------------------|
| Package structure analysis     | NEW    | Move Module       |
| Relative import recalculation  | NEW    | Move Module       |
| Code generation (properties)   | NEW    | Encapsulate Field |
| Abstract method generation     | NEW    | Pull Up Method    |

---

## Success Metrics

### Functional Parity

| Metric                  | Current | Target |
|-------------------------|---------|--------|
| Operations implemented  | 1       | 10+    |
| Tier 1 operations       | 0/4     | 4/4    |
| Tier 2 operations       | 0/6     | 4/6    |
| Tier 3 operations       | 0/6     | 2/6    |

### Correctness Claims

| Dimension                  | Our Advantage                    | How to Prove                                    |
|----------------------------|----------------------------------|-------------------------------------------------|
| MRO-aware operations       | Pull up/down, inline method      | Test cases with diamond inheritance             |
| Cross-file type resolution | Move function, extract method    | Test cases with complex import chains           |
| Re-export handling         | Move, rename                     | Test cases with `__all__` and package re-exports|

### Agent Integration

All operations must:
- Produce structured JSON output
- Support analyze/emit/apply workflow
- Include verification step
- Handle filters consistently

---

## Risk Assessment

### Technical Risks

| Risk                              | Mitigation                                          |
|-----------------------------------|-----------------------------------------------------|
| Control flow analysis complexity  | Start with simple cases (no exceptions, single return) |
| Import insertion correctness      | Use LibCST patterns as reference                    |
| Code generation formatting        | Apply consistent style, consider black integration  |

### Competitive Risks

| Risk                        | Mitigation                                             |
|-----------------------------|--------------------------------------------------------|
| Rope has 20-year head start | Focus on correctness, not feature count                |
| Ruff is faster for linting  | Don't compete on lint; compete on semantic refactoring |
| IDEs bundle refactoring     | Optimize for agent workflows, not interactive use      |

---

## Dependencies

- Phase 12 (complete): Agent-focused CLI provides the command structure
- Temporale fixture: Test target for refactoring operations

---

## Open Questions

1. **Control flow analysis depth:** How far to go? Basic use-def chains vs. full data flow?
2. **Code generation strategy:** String templates vs. CST construction?
3. **Interactive mode:** Should `tug` support selection prompts for ambiguous cases?
4. **Verification levels:** Syntax-only vs. type-check vs. test-run?

---

## References

- [Rope Python Refactoring Library](https://github.com/python-rope/rope)
- [Rope Documentation](https://rope.readthedocs.io/en/latest/overview.html)
- [Bowler Safe Refactoring](https://pybowler.io/)
- [LibCST Codemods](https://libcst.readthedocs.io/en/latest/codemods.html)
- [Ruff Linter](https://docs.astral.sh/ruff/linter/)
- [PyCharm Refactoring](https://www.jetbrains.com/help/pycharm/refactoring-source-code.html)
- [Refactoring.Guru - Extract Method](https://refactoring.guru/extract-method)
- [Refactoring.Guru - Extract Variable](https://refactoring.guru/extract-variable)
