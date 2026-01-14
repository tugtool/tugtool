# Python Binding Semantics for Tug

This document specifies how the Tug Python analyzer resolves names and collects bindings, implementing Level 0 (Scope + Binding) of the type inference roadmap.

## Scope Types

Python has the following scope types:

| Scope Kind | Created By | Notes |
|------------|------------|-------|
| Module | Top-level file | One per file, contains all top-level bindings |
| Class | `class` definition | Special semantics: class body doesn't create closure scope |
| Function | `def` statement | Creates closure scope, captures outer variables |
| Lambda | `lambda` expression | Anonymous function scope |
| Comprehension | List/set/dict comprehension, generator expression | Python 3: own scope; loop vars don't leak |

## Binding Rules

### Definition Binding Sites

Bindings are created at these locations:

1. **Function definitions** (`def foo():`)
   - Binds the function name in the **enclosing scope** (not the function's own scope)
   - The function body creates a new scope

2. **Class definitions** (`class Foo:`)
   - Binds the class name in the **enclosing scope**
   - The class body creates a new scope (but not a closure scope)

3. **Assignment statements** (`x = ...`, `x, y = ...`)
   - Binds target names in the **current scope**
   - Subject to `global` and `nonlocal` declarations
   - Tuple/list unpacking binds all extracted names

4. **Annotated assignments** (`x: int = ...`, `x: int`)
   - Same as regular assignment, but may not have a value
   - The annotation itself is not a binding

5. **Import statements**
   - `import foo` → binds `foo` in current scope
   - `import foo as bar` → binds `bar` in current scope
   - `import foo.bar.baz` → binds `foo` (the root) in current scope
   - `from foo import bar` → binds `bar` in current scope
   - `from foo import bar as baz` → binds `baz` in current scope
   - `from foo import *` → binds all public names from `foo`

6. **Function parameters**
   - Bind parameter names in the **function scope**
   - Includes positional, keyword-only, *args, **kwargs

7. **For loop targets** (`for x in ...`)
   - Binds target in the **current scope**
   - Does NOT create a new scope

8. **With statement** (`with ... as x:`)
   - Binds `x` in the **current scope**

9. **Exception handlers** (`except E as e:`)
   - Binds `e` in the **current scope**
   - Note: `e` is deleted after the except block in Python 3

10. **Named expressions** (`:=` walrus operator)
    - Binds in the **nearest enclosing non-comprehension scope**
    - Exception: in comprehensions, targets enclosing function/module scope

## Scope Chain Resolution

When resolving a name reference:

1. Look in the current scope
2. Walk up the scope chain (parent → grandparent → ... → module)
3. First binding found wins
4. If not found in any scope, name is unresolved (might be a builtin or global)

### Shadowing

A binding in an inner scope shadows the same name in outer scopes:

```python
x = 10  # module scope, SymbolId=S1

def foo():
    x = 20  # function scope, SymbolId=S2, shadows S1
    print(x)  # refers to S2

print(x)  # refers to S1
```

### `global` Declaration

The `global` statement makes a name refer to the module-level binding:

```python
counter = 0  # module scope, SymbolId=S1

def increment():
    global counter  # declaration, not a binding
    counter += 1    # refers to S1, not a new local binding
```

Rules:
- `global x` must appear before any use of `x` in the function
- After `global x`, all uses of `x` in that function refer to module scope
- `global x` does NOT create a binding; it modifies resolution

### `nonlocal` Declaration

The `nonlocal` statement makes a name refer to the nearest enclosing non-global binding:

```python
def outer():
    value = 10  # SymbolId=S1

    def inner():
        nonlocal value  # declaration, not a binding
        value += 1      # refers to S1

    inner()
    print(value)  # refers to S1, now 11
```

Rules:
- `nonlocal x` must refer to a binding in an enclosing function scope (not module)
- After `nonlocal x`, all uses of `x` refer to that enclosing binding
- `nonlocal x` does NOT create a binding; it modifies resolution

### Closures

Functions capture bindings from enclosing scopes:

```python
def make_adder(n):  # n bound here, SymbolId=S1
    def adder(x):
        return x + n  # n refers to S1 (captured)
    return adder
```

The reference to `n` in `adder` resolves to the parameter `n` in `make_adder`.

## Comprehension Scopes (Python 3)

In Python 3, comprehensions have their own scope:

```python
x = 10  # SymbolId=S1

result = [x for x in range(5)]  # 'x' here is SymbolId=S2, in comprehension scope

print(x)  # refers to S1, still 10 (not shadowed)
```

The comprehension loop variable `x` is in the comprehension's scope, not the enclosing scope.

### Walrus Operator in Comprehensions

Named expressions (`:=`) escape the comprehension scope:

```python
# 'last' is bound in the enclosing scope, not the comprehension
result = [last := x for x in range(5)]
print(last)  # 4
```

## Class Scope Semantics

Class bodies are special: they don't create a closure scope:

```python
class Foo:
    x = 10  # class variable, SymbolId=S1

    def method(self):
        # Cannot refer to 'x' directly here!
        # print(x)  # NameError
        print(Foo.x)  # Must qualify with class name or self
        print(self.x)  # Access via instance
```

Names defined in a class body are accessible only via:
- The class object (`Foo.x`)
- Instances (`self.x` in methods)

## Reference Kinds

When collecting references, we categorize them:

| Kind | Example | Notes |
|------|---------|-------|
| `Definition` | `def foo():` (the `foo`) | Where the binding is created |
| `Call` | `foo()` | Function/method invocation |
| `Reference` | `print(foo)` | Simple name reference (read) |
| `Import` | `import foo` | Import statement |
| `Write` | `foo = 5` | Assignment target |
| `Attribute` | `obj.foo` | Attribute access (not a direct name ref) |
| `TypeAnnotation` | `x: Foo` | Type annotation reference |

## Implementation Notes

### Two-Pass Analysis

The analyzer uses two passes:

1. **Pass 1: Binding Collection**
   - Walk the CST
   - Maintain scope stack
   - Record all bindings with their containing scope
   - Track `global`/`nonlocal` declarations

2. **Pass 2: Reference Resolution**
   - Walk the CST again
   - For each `Name` node, resolve via scope chain
   - Record reference with resolved `SymbolId`

### Deterministic ID Assignment

Symbol IDs are assigned deterministically:
- Files processed in sorted path order
- Within a file, symbols ordered by `(span_start, kind, name)`
- Same snapshot → same IDs

### Workspace-Only Import Resolution

For v1, import resolution is limited to workspace files:
- `from myproject.utils import helper` → resolved if `myproject/utils.py` exists
- `from os.path import join` → NOT resolved (stdlib)
- `from requests import get` → NOT resolved (site-packages)

External imports are recorded with `is_resolved: false`.

## Edge Cases

### Star Imports

`from foo import *` imports all public names from `foo`:

1. If `foo` defines `__all__`, import those names
2. Otherwise, import all names not starting with `_`

Star imports are recorded but references through them may not be fully resolved (warning issued).

### Forward References

In type annotations, names may be forward references:

```python
class Node:
    next: "Node"  # Forward reference (string literal)
```

String annotations are NOT resolved as references in v1.

### Conditional Imports

```python
if TYPE_CHECKING:
    from typing import Protocol
```

All imports are collected regardless of condition (static analysis).

### Dynamic Patterns

These patterns cannot be statically resolved:

- `getattr(obj, name_var)`
- `globals()[name]`
- `eval("foo")`
- `exec(code_string)`

The analyzer detects and warns about these patterns but does not resolve them.
