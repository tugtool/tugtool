# Step 1.1.5: Harden Walrus Operator Handling {#step-1-1-5}

**Commit:** `fix(python): properly handle walrus operators in comprehensions`

**References:** [D05](#d05-rename-reference), [D09](#d09-comprehension-scope), [Table T02](#t02-rename-gaps), [Step 0.4](#step-0-4), [Step 1.1](#step-1-1)

**Prerequisites:** [Step 0.4](#step-0-4) (reference scope infrastructure), [Step 1.1](#step-1-1) (rename hardening partial)

---

## Problem Statement

The test `test_rename_walrus_in_comprehension` fails with `SymbolNotFound` when trying to rename `y` in:

```python
results = [y for x in range(10) if (y := compute(x)) > 5]
```

The other two walrus operator tests pass:
- `test_rename_walrus_target` - walrus in if condition: `if (result := compute()):`
- `test_rename_walrus_in_while` - walrus in while condition: `while (line := get_line()):`

---

## Root Cause Analysis

### Python Semantics: Walrus Operator Scoping in Comprehensions

The walrus operator (`:=`) has **special scoping semantics** in Python 3.8+ (PEP 572):

1. **Inside function/module scope:** The walrus operator binds to the enclosing function or module scope (normal behavior).

2. **Inside comprehensions:** The walrus operator **leaks the binding to the enclosing function or module scope**, NOT the comprehension scope.

This is different from comprehension iteration variables (`for x in ...`) which ARE confined to the comprehension scope.

**Example:**
```python
# After execution:
results = [y for x in range(10) if (y := x * 2) > 5]
# y is accessible at module scope!
print(y)  # Works! y = 18 (last value assigned)
```

### Current Implementation Issue

The `BindingCollector` in `crates/tugtool-python-cst/src/visitor/binding.rs` handles walrus operators:

```rust
fn visit_named_expr(&mut self, node: &NamedExpr<'a>) -> VisitResult {
    // Walrus operator creates a binding for its target
    self.extract_from_expression(&node.target, BindingKind::Variable);
    VisitResult::Continue
}
```

The problem is that `scope_path` is updated when entering comprehension scopes:

```rust
fn visit_list_comp(&mut self, _node: &ListComp<'a>) -> VisitResult {
    self.scope_path.push(SCOPE_LISTCOMP.to_string());
    VisitResult::Continue
}
```

So when a walrus operator is encountered inside a comprehension, the binding's `scope_path` is `["<module>", "<listcomp>"]` instead of the correct `["<module>"]`.

This causes symbol lookup to fail because:
1. The `BindingCollector` creates a symbol with `scope_path: ["<module>", "<listcomp>"]`
2. The `analyze_files` pipeline maps bindings to scopes using `find_scope_for_path_indexed()`
3. With no matching scope (comprehensions have no named scope), the symbol gets assigned to `ScopeId(0)` (module)
4. But the reference scope tracking puts references at `["<module>", "<listcomp>"]`
5. Symbol lookup at the walrus location fails because the span-based lookup finds the comprehension scope

### Why Other Walrus Tests Pass

The other walrus tests work because the walrus operator is NOT inside a comprehension:
- `if (result := compute()):` - `result` is at module scope, scope_path is `["<module>"]`
- `while (line := get_line()):` - `line` is at module scope, scope_path is `["<module>"]`

---

## Solution Design

### Approach: Track Enclosing Non-Comprehension Scope

The fix requires `BindingCollector` to track the **enclosing non-comprehension scope** separately from the current scope path. When processing a walrus operator inside a comprehension, the binding should be recorded with the enclosing scope's path.

### Implementation Strategy

**Option A: Add Enclosing Scope Stack (Recommended)**

Add a secondary stack that tracks the most recent non-comprehension scope:

```rust
pub struct BindingCollector<'pos> {
    positions: Option<&'pos PositionTable>,
    bindings: Vec<BindingInfo>,
    scope_path: Vec<String>,           // Current full path (includes comprehensions)
    enclosing_scope_path: Vec<String>, // Most recent non-comprehension scope
}
```

When entering a comprehension, push to `scope_path` but NOT to `enclosing_scope_path`.
When processing a walrus operator, use `enclosing_scope_path` instead of `scope_path`.

**Option B: Filter Comprehension Scopes at Walrus Processing**

Compute the enclosing scope dynamically when processing walrus operators:

```rust
fn visit_named_expr(&mut self, node: &NamedExpr<'a>) -> VisitResult {
    // For walrus operator, use enclosing non-comprehension scope (PEP 572)
    let enclosing_scope = self.scope_path.iter()
        .filter(|s| !is_comprehension_scope(s))
        .cloned()
        .collect::<Vec<_>>();

    self.extract_from_expression_with_scope(&node.target, BindingKind::Variable, &enclosing_scope);
    VisitResult::Continue
}
```

**Recommendation:** Option A is cleaner and more efficient (O(1) lookup vs O(n) filter per walrus).

---

## Artifacts

**Modified Files:**
- `crates/tugtool-python-cst/src/visitor/binding.rs`
- `crates/tugtool-python-cst/src/visitor/reference.rs` (matching changes)
- `crates/tugtool-python/tests/rename_hardening.rs` (test verification)

**New Files:**
- None

---

## Tasks

- [ ] **1.1.5.1** Add `enclosing_scope_path` field to `BindingCollector`
- [ ] **1.1.5.2** Update comprehension scope entry/exit to only modify `scope_path`
- [ ] **1.1.5.3** Modify `visit_named_expr` to use `enclosing_scope_path` for walrus bindings
- [ ] **1.1.5.4** Add matching changes to `ReferenceCollector` for walrus reference scope tracking
- [ ] **1.1.5.5** Add unit tests for walrus scoping behavior
- [ ] **1.1.5.6** Verify `test_rename_walrus_in_comprehension` passes

---

## Implementation Details

### Step 1.1.5.1: Add Enclosing Scope Path Field

In `crates/tugtool-python-cst/src/visitor/binding.rs`:

```rust
pub struct BindingCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected bindings.
    bindings: Vec<BindingInfo>,
    /// Current scope path for tracking where bindings are defined.
    /// Includes all scopes (comprehensions, lambdas, etc.)
    scope_path: Vec<String>,
    /// Enclosing non-comprehension scope path for walrus operator bindings.
    /// Per PEP 572, walrus operators in comprehensions bind to the enclosing
    /// function/module scope, not the comprehension scope.
    enclosing_scope_path: Vec<String>,
}
```

Update constructors:
```rust
pub fn new() -> Self {
    Self {
        positions: None,
        bindings: Vec::new(),
        scope_path: vec![SCOPE_MODULE.to_string()],
        enclosing_scope_path: vec![SCOPE_MODULE.to_string()],
    }
}

pub fn with_positions(positions: &'pos PositionTable) -> Self {
    Self {
        positions: Some(positions),
        bindings: Vec::new(),
        scope_path: vec![SCOPE_MODULE.to_string()],
        enclosing_scope_path: vec![SCOPE_MODULE.to_string()],
    }
}
```

### Step 1.1.5.2: Update Scope Entry/Exit

Add helper to check if a scope name is a comprehension:
```rust
fn is_comprehension_scope(scope_name: &str) -> bool {
    matches!(scope_name, "<listcomp>" | "<dictcomp>" | "<setcomp>" | "<genexpr>")
}
```

Update function/class scope handling (these update BOTH stacks):
```rust
fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
    self.add_binding_with_id(node.name.value, BindingKind::Function, node.name.node_id);
    self.scope_path.push(node.name.value.to_string());
    self.enclosing_scope_path.push(node.name.value.to_string());
    VisitResult::Continue
}

fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
    self.scope_path.pop();
    self.enclosing_scope_path.pop();
}

fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
    self.add_binding_with_id(node.name.value, BindingKind::Class, node.name.node_id);
    self.scope_path.push(node.name.value.to_string());
    self.enclosing_scope_path.push(node.name.value.to_string());
    VisitResult::Continue
}

fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
    self.scope_path.pop();
    self.enclosing_scope_path.pop();
}
```

**Note:** Comprehension handlers do NOT exist in `BindingCollector` currently because comprehension iteration variables are not collected as bindings. They should NOT update `enclosing_scope_path`.

### Step 1.1.5.3: Modify Walrus Binding Scope

Update `visit_named_expr` to use the enclosing scope:

```rust
fn visit_named_expr(&mut self, node: &NamedExpr<'a>) -> VisitResult {
    // Walrus operator creates a binding for its target.
    // Per PEP 572, walrus operators in comprehensions bind to the enclosing
    // function/module scope, not the comprehension scope.
    self.extract_from_expression_with_enclosing_scope(&node.target, BindingKind::Variable);
    VisitResult::Continue
}

/// Extract name bindings with enclosing scope (for walrus operators in comprehensions).
fn extract_from_expression_with_enclosing_scope(&mut self, expr: &Expression<'_>, kind: BindingKind) {
    match expr {
        Expression::Name(name) => {
            self.add_binding_with_id_and_scope(
                name.value,
                kind,
                name.node_id,
                self.enclosing_scope_path.clone()
            );
        }
        // Other cases unchanged (tuple, list, starred don't apply to walrus targets)
        _ => {}
    }
}

/// Add a binding with explicit scope path (for walrus in comprehensions).
fn add_binding_with_id_and_scope(
    &mut self,
    name: &str,
    kind: BindingKind,
    node_id: Option<NodeId>,
    scope_path: Vec<String>
) {
    let span = self.lookup_span(node_id);
    let binding = BindingInfo::new(name.to_string(), kind, scope_path).with_span(span);
    self.bindings.push(binding);
}
```

### Step 1.1.5.4: Update ReferenceCollector

The `ReferenceCollector` needs similar changes to properly track walrus references. However, since walrus targets are treated as Definitions (not References), and the reference to `y` in `[y for ...]` is handled correctly as a Reference within the comprehension scope, the key fix is in `BindingCollector`.

If needed, `ReferenceCollector.visit_named_expr` should also use enclosing scope for the Definition reference it creates.

### Step 1.1.5.5: Add Unit Tests

In `crates/tugtool-python-cst/src/visitor/binding.rs`:

```rust
#[test]
fn test_binding_walrus_in_comprehension_binds_to_enclosing_scope() {
    // Per PEP 572: walrus in comprehension binds to enclosing scope
    let source = "results = [y for x in range(10) if (y := x * 2) > 5]";
    let parsed = parse_module_with_positions(source, None).unwrap();
    let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

    // Should have: results (module), y (module - NOT listcomp)
    assert_eq!(bindings.len(), 2);

    // results is at module scope
    let results_binding = bindings.iter().find(|b| b.name == "results").unwrap();
    assert_eq!(results_binding.scope_path, vec!["<module>"]);

    // y is at module scope (PEP 572 walrus scope leak)
    let y_binding = bindings.iter().find(|b| b.name == "y").unwrap();
    assert_eq!(y_binding.scope_path, vec!["<module>"],
        "Walrus operator in comprehension should bind to enclosing module scope");
}

#[test]
fn test_binding_walrus_in_nested_comprehension() {
    // Walrus in nested comprehension also binds to enclosing function scope
    let source = r#"
def process():
    result = [[y for _ in [1]] for x in items if (y := compute(x))]
    return result
"#;
    let parsed = parse_module_with_positions(source, None).unwrap();
    let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

    let y_binding = bindings.iter().find(|b| b.name == "y").unwrap();
    assert_eq!(y_binding.scope_path, vec!["<module>", "process"],
        "Walrus in nested comprehension should bind to enclosing function scope");
}

#[test]
fn test_binding_walrus_in_lambda_in_comprehension() {
    // Walrus in lambda (which is in comprehension) binds to lambda scope
    let source = "result = [(lambda: (y := x))() for x in items]";
    let parsed = parse_module_with_positions(source, None).unwrap();
    let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

    let y_binding = bindings.iter().find(|b| b.name == "y").unwrap();
    // Lambda creates a new enclosing scope, so y binds to lambda
    assert_eq!(y_binding.scope_path, vec!["<module>", "<lambda>"],
        "Walrus in lambda should bind to lambda scope even when lambda is in comprehension");
}

#[test]
fn test_binding_walrus_not_in_comprehension() {
    // Regular walrus (not in comprehension) should still work normally
    let source = "if (x := 5) > 0:\n    print(x)";
    let parsed = parse_module_with_positions(source, None).unwrap();
    let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

    let x_binding = bindings.iter().find(|b| b.name == "x").unwrap();
    assert_eq!(x_binding.scope_path, vec!["<module>"]);
}
```

### Step 1.1.5.6: Verify Integration Test

Run the failing test:
```bash
cargo nextest run -p tugtool-python test_rename_walrus_in_comprehension
```

---

## Edge Cases

### Lambda Inside Comprehension

When a lambda is inside a comprehension, the lambda creates a new enclosing scope:

```python
result = [(lambda: (y := x))() for x in items]
```

Here, `y` binds to the lambda scope, NOT the module scope. This is correct behavior because the lambda is the innermost enclosing function scope.

### Nested Comprehensions

```python
result = [[y for _ in [1]] for x in items if (y := x * 2)]
```

The walrus `y := x * 2` is in the outer comprehension. It should bind to the module scope. The inner comprehension's reference to `y` should still work because `y` is visible from module scope.

### Generator Expression Argument Position

```python
# The iterator in a generator expression is evaluated in the enclosing scope
sum(y for x in items if (y := compute(x)))
```

Here `y` should bind to module scope (enclosing the generator expression).

---

## Tests

**Unit Tests (in `binding.rs`):**
- [x] Existing: `test_binding_walrus_operator` - simple walrus at module scope
- [ ] New: `test_binding_walrus_in_comprehension_binds_to_enclosing_scope`
- [ ] New: `test_binding_walrus_in_nested_comprehension`
- [ ] New: `test_binding_walrus_in_lambda_in_comprehension`
- [ ] New: `test_binding_walrus_not_in_comprehension` (regression)

**Integration Tests (in `rename_hardening.rs`):**
- [ ] `test_rename_walrus_target` (existing, should continue to pass)
- [ ] `test_rename_walrus_in_while` (existing, should continue to pass)
- [ ] `test_rename_walrus_in_comprehension` (existing, should now pass)

---

## Checkpoint

- [ ] `cargo build -p tugtool-python-cst` succeeds
- [ ] `cargo nextest run -p tugtool-python-cst binding` passes (including new walrus tests)
- [ ] `cargo nextest run -p tugtool-python test_rename_walrus` passes (all 3 tests)
- [ ] `cargo clippy -p tugtool-python-cst -- -D warnings` passes

---

## Rollback

Revert commit

---

## Notes on PEP 572 Semantics

From PEP 572:

> The scope of the target is determined by the enclosing scope: if the target would be legal as an assignment target in the enclosing scope, then the named expression is valid, and the target has that scope.

For comprehensions specifically:
> The scope of the target is the enclosing scope.

This is different from comprehension iteration variables:
> Comprehension iteration variables are strictly local to the comprehension and cannot leak out.

This asymmetry is why we need special handling for walrus operators inside comprehensions.
