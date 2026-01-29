## Phase 11E: Plug Holes in Python Refactoring Core {#phase-11e}

**Purpose:** Address three specific gaps identified in the Phase 11 review that could cause surprises or block certain refactoring patterns: function-level import tracking, generic type parameter resolution, and isinstance-based type narrowing.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-01-28 |
| Prior phases | Phase 11D (Cross-File Type Resolution and OOP Support) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 11 through 11D successfully built a robust type inference system for Python refactoring. The system now supports:

- Single-file type tracking (Level 1-3 inference)
- Cross-file type resolution with on-demand file analysis
- MRO-based attribute lookup for inheritance hierarchies
- Property decorator resolution
- Type stub (.pyi) file support

However, three specific gaps remain that can cause surprising failures in real-world codebases:

1. **Function-level imports are not tracked** - Currently, only module-level imports populate the `import_targets` map. Imports inside functions are ignored, causing resolution failures when types are imported locally within a function.

2. **Generic type parameter resolution is missing** - When a variable has type `List[Handler]`, subscript access like `items[0]` cannot resolve to `Handler`. The type parameter information is stored but not extracted during resolution.

3. **isinstance narrowing is not implemented** - After an `isinstance(x, Handler)` check, the type of `x` should be narrowed to `Handler` within the conditional branch. Currently, `x` retains its original type.

These gaps represent the most impactful remaining limitations for supporting real-world Python refactoring patterns. Addressing them before adding new refactoring operations (move, extract, etc.) will provide a more solid foundation.

#### Strategy {#strategy}

- **Incremental enhancement**: Build on existing infrastructure from Phase 11D
- **Function-level imports first**: This is the simplest gap to address and enables common lazy-import patterns
- **Container type extraction**: Parse generic type annotations to extract type parameters for subscript resolution
- **Scope-local type narrowing**: Implement flow-sensitive narrowing within conditional branches only
- **Conservative fallback**: Return `None` rather than incorrect resolution when uncertain
- **Comprehensive testing**: Add tests for each gap covering both positive and negative cases
- **Documentation of limits**: Explicitly document what remains unsupported

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code agent (primary consumer of tug refactoring)
2. Users refactoring Python codebases with function-level imports
3. Users working with typed containers (List, Dict, Optional)
4. Users using isinstance checks for type-safe code

#### Success Criteria (Measurable) {#success-criteria}

- [ ] `from handler import Handler` inside a function enables resolution of `Handler` usage within that function
- [ ] `items: List[Handler]` allows `items[0].process()` to resolve to `Handler.process`
- [ ] `isinstance(x, Handler)` followed by `x.process()` resolves to `Handler.process` within the if-branch
- [ ] Function-level imports are scoped correctly (not visible outside the function)
- [ ] Container type extraction handles common patterns: `List[T]`, `Dict[K, V]`, `Set[T]`, `Optional[T]`, `Tuple[T, ...]`
- [ ] isinstance narrowing handles tuple syntax: `isinstance(x, (A, B))` narrows to `Union[A, B]`
- [ ] All existing tests continue to pass (no regression)

#### Scope {#scope}

**Gap 1: Function-Level Import Tracking**
1. Add `scope_path` field to CST `ImportInfo` structure
2. Track scope context during import collection in `ImportCollector`
3. Extend `build_import_targets` to include function-scoped imports
4. Update `lookup_import_target` to find imports at the appropriate scope level
5. Add tests for function-level import resolution

**Gap 2: Generic Type Parameter Resolution**
6. Add type parameter extraction to `TypeTracker` or new helper module
7. Parse generic annotations to extract type arguments: `List[Handler]` -> `Handler`
8. Implement subscript resolution that returns the element type
9. Handle common container patterns (List, Dict, Set, Optional, Tuple)
10. Add tests for container element type resolution

**Gap 3: isinstance Type Narrowing**
11. Detect `isinstance(var, Type)` patterns in conditional expressions
12. Create narrowed type bindings for the if-branch scope
13. Handle tuple type syntax: `isinstance(x, (A, B))`
14. Ensure narrowing is scoped to the conditional branch only
15. Add tests for isinstance-based type narrowing

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full flow-sensitive type inference (beyond isinstance narrowing)
- Type narrowing from truthiness checks (`if x:`)
- Type narrowing from `type()` comparisons
- Type narrowing from `hasattr()` checks
- Generic TypeVar resolution (`T` -> concrete type)
- Protocol/structural subtyping
- Type guards (`TypeGuard`, `TypeIs`)
- Intersection types from multiple isinstance checks
- Narrowing in else branches (complement types)
- Analyzing external packages (outside workspace)

#### Dependencies / Prerequisites {#dependencies}

**Already Complete:**
- Phase 11D complete (CrossFileTypeCache, MRO, properties, stubs)
- TypeTracker with Level 1-3 inference
- `import_targets` map infrastructure in `cross_file_types.rs`
- Scope tracking in CST visitors
- `TypeNode` structure for parsed type annotations

**Needs Wiring:**
- ImportCollector needs scope_path tracking (currently stateless)
- TypeTracker needs type parameter extraction methods
- Need new data structure for scope-local type narrowings
- ReceiverPath needs subscript step representation for container element resolution

#### Constraints {#constraints}

- **Language-agnostic core**: No Python-specific additions to tugtool-core
- **Performance**: Minimal overhead from scope tracking and type parsing
- **Behavioral stability**: Existing resolution behavior must not regress
- **Conservative resolution**: Prefer `None` over incorrect inference

#### Assumptions {#assumptions}

- Function-level imports are primarily used for lazy loading or avoiding circular imports
- Generic containers follow standard typing patterns (`List`, `Dict`, etc.)
- isinstance checks use simple patterns (single type or tuple of types)
- Narrowing is most valuable in the if-branch; else-branch narrowing is rare

---

### Open Questions {#open-questions}

#### [Q01] Should function-level imports shadow module-level imports? (DECIDED) {#q01-import-shadowing}

**Question:** When a function has `from foo import Bar` and the module also has `from bar import Bar`, which should be used for resolution within the function?

**Why it matters:** Python's scoping rules say the function-level import shadows the module-level import within that function. We should match this behavior for correctness.

**Options:**
- Option A: Function-level always shadows module-level (matches Python semantics)
- Option B: Module-level takes precedence (simpler but incorrect)
- Option C: Report ambiguity and return `None`

**Resolution:** Option A - match Python's scoping rules exactly. Python's LEGB (Local, Enclosing, Global, Built-in) scoping means function-level imports are local bindings that shadow module-level (global) imports within that function's scope. This is unambiguous Python behavior and we must match it for correctness.

**Implications:**
- `lookup_import_target` must check innermost scope first
- Scope chain walk stops at first match (shadowing)
- Tests must verify shadowing behavior explicitly

#### [Q02] How to represent Union types from isinstance tuple syntax? (DECIDED) {#q02-union-representation}

**Question:** When `isinstance(x, (A, B))`, should we narrow `x` to `Union[A, B]` or just pick the first type?

**Why it matters:** True Union representation is more correct but adds complexity.

**Options:**
- Option A: Full Union type - `isinstance(x, (A, B))` narrows to `Union[A, B]`
- Option B: First type only - `isinstance(x, (A, B))` narrows to `A`
- Option C: Return `None` for tuple syntax (document limitation)

**Resolution:** Option A - represent as `Union[A, B]`. This is semantically correct: after `isinstance(x, (A, B))`, the variable `x` could be either type. The Union representation:
- Enables resolution if we later look up a method common to both types
- Matches type checker behavior (mypy, pyright)
- Is straightforward to implement since we already handle type strings

**Implementation notes:**
- Store narrowed type as `"Union[A, B]"` string
- For method resolution on Union types, try each member type and succeed if any resolves
- If Union members have no common methods, resolution returns `None` (correct behavior)

#### [Q03] Should narrowing persist across return/raise? (DECIDED) {#q03-narrowing-persistence}

**Question:** In early-return patterns, should narrowing persist after the guard?

```python
def process(x):
    if not isinstance(x, Handler):
        return None
    # Should x be narrowed to Handler here?
    x.process()
```

**Why it matters:** This is a common Python idiom that benefits from narrowing.

**Options:**
- Option A: Yes - track narrowing after early returns (more useful, more complex)
- Option B: No - only narrow within the if-branch body (simpler, less complete)

**Resolution:** Option B for Phase 11E - only narrow within the if-branch body. Early-return narrowing requires control flow analysis to detect that the if-branch unconditionally exits (return/raise/continue/break), then apply the negated narrowing to the rest of the function. This is significantly more complex:
- Requires tracking branch termination (return, raise, continue, break)
- Requires negating the isinstance check (`not isinstance(x, Handler)` → `x` is Handler after)
- Interacts with loops, try/except, and other control flow

**Deferred to follow-on phase.** Phase 11E focuses on the simpler, high-value case: direct isinstance checks in if-conditions with narrowing in the if-branch body.

**What works in Phase 11E:**
```python
if isinstance(x, Handler):
    x.process()  # ✓ Narrowed to Handler
```

**What doesn't work (yet):**
```python
if not isinstance(x, Handler):
    return None
x.process()  # ✗ Not narrowed (follow-on enhancement)
```

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Scope tracking in ImportCollector adds complexity | med | med | Keep changes minimal; test thoroughly | Import resolution bugs |
| Type parameter parsing handles edge cases incorrectly | med | med | Start with common patterns; document limits | False positives in subscript resolution |
| isinstance narrowing creates stale type bindings | high | low | Clear narrowings when exiting branch scope | Incorrect narrowed types outside branch |
| Breaking changes to ImportInfo struct | med | low | Add fields with defaults; update all consumers | Serialization errors |

**Risk R01: Scope Tracking Complexity** {#r01-scope-tracking}

- **Risk:** Adding scope_path to ImportCollector requires maintaining a scope stack, similar to other visitors
- **Mitigation:**
  - Reuse the scope tracking pattern from AnnotationCollector/TypeInferenceCollector
  - Keep scope_path as `Vec<String>` for consistency
  - Add helper trait or shared code for scope management
- **Additional mitigation:** Ensure ImportCollector scope names match TypeTracker/ReceiverPath
  naming conventions (`<module>`, class names, function names) to avoid shadowing mismatches
- **Residual risk:** Edge cases with nested functions/classes may have incorrect scope paths

**Risk R02: Type Parameter Parsing Brittleness** {#r02-type-parsing}

- **Risk:** Parsing type annotations to extract parameters is inherently fragile
- **Mitigation:**
  - Leverage existing `TypeNode` structure from CST collection
  - Handle only simple, common patterns initially
  - Return `None` for complex patterns (e.g., deeply nested generics)
- **Residual risk:** Some valid patterns may not be supported

**Risk R03: Narrowing Scope Leakage** {#r03-narrowing-leakage}

- **Risk:** Narrowed types could incorrectly persist outside the conditional branch
- **Mitigation:**
  - Use a scoped HashMap that is created on branch entry and dropped on exit
  - Do not modify the main TypeTracker maps; use overlay pattern
  - Clear narrowings explicitly when exiting the branch
- **Residual risk:** Complex control flow (try/except, loops with breaks) may behave unexpectedly

---

### 11E.0 Design Decisions {#design-decisions}

#### [D01] Import Scope Tracking Approach (DECIDED) {#d01-import-scope-tracking}

**Decision:** Add `scope_path: Vec<String>` field to `ImportInfo` and maintain a scope stack in `ImportCollector`.

**Data Structure Changes:**

```rust
// In crates/tugtool-python-cst/src/visitor/import.rs

/// Information about a single import statement in the Python source.
#[derive(Debug, Clone)]
pub struct ImportInfo {
    // ... existing fields ...

    /// Scope path where this import is defined.
    /// For module-level imports: `["<module>"]`
    /// For function-level: `["<module>", "MyClass", "my_method"]`
    pub scope_path: Vec<String>,
}

/// A visitor that collects import information from a Python CST.
pub struct ImportCollector {
    imports: Vec<ImportInfo>,
    /// Current scope path (class/function nesting).
    scope_path: Vec<String>,
}
```

**Visitor Changes:**

```rust
impl<'a> Visitor<'a> for ImportCollector {
    fn visit_class_def(&mut self, node: &'a ClassDef<'a>) -> VisitResult {
        self.scope_path.push(node.name.value.to_string());
        walk_class_def(self, node)?;
        self.scope_path.pop();
        Ok(())
    }

    fn visit_function_def(&mut self, node: &'a FunctionDef<'a>) -> VisitResult {
        self.scope_path.push(node.name.value.to_string());
        walk_function_def(self, node)?;
        self.scope_path.pop();
        Ok(())
    }

    fn visit_import(&mut self, node: &'a Import<'a>) -> VisitResult {
        // ... existing logic ...
        info.scope_path = self.scope_path.clone();
        self.imports.push(info);
        Ok(())
    }
}
```

**Rationale:**
- Consistent with other visitors that track scope (AnnotationCollector, TypeInferenceCollector)
- Minimal change to existing infrastructure
- Enables proper scope-chain lookup for function-level imports

**Implications:**
- All consumers of `ImportInfo` need to handle the new `scope_path` field
- `build_import_targets` uses actual scope_path instead of hardcoded module scope
- `lookup_import_target` already supports scope-chain lookup

#### [D02] Generic Type Parameter Extraction (DECIDED) {#d02-type-parameter-extraction}

**Decision:** Add type parameter extraction to `TypeTracker` using the existing `TypeNode` structure.

**New Methods:**

```rust
// In crates/tugtool-python/src/type_tracker.rs

impl TypeTracker {
    /// Extract the element type from a container type annotation.
    ///
    /// For `List[Handler]`, returns `Some("Handler")`.
    /// For `Dict[str, Handler]`, returns `Some("Handler")` (value type).
    /// For `Optional[Handler]`, returns `Some("Handler")`.
    /// For non-generic types, returns `None`.
    pub fn extract_element_type(&self, type_str: &str) -> Option<String> {
        // Parse common patterns:
        // - List[T] -> T
        // - Sequence[T] -> T
        // - Iterable[T] -> T
        // - Set[T] -> T
        // - FrozenSet[T] -> T
        // - Dict[K, V] -> V (value type for subscript)
        // - Mapping[K, V] -> V
        // - Optional[T] -> T
        // - Tuple[T, ...] -> T (homogeneous tuple)
        // ...
    }

    /// Extract type parameter from a TypeNode, if available.
    ///
    /// More reliable than string parsing when TypeNode is present.
    pub fn extract_element_type_from_node(&self, node: &TypeNode) -> Option<String> {
        match node {
            TypeNode::Subscript { base, args } => {
                // Check if base is a known container type
                if is_sequence_type(base) && args.len() == 1 {
                    return args[0].name();
                }
                if is_mapping_type(base) && args.len() == 2 {
                    return args[1].name(); // Value type
                }
                None
            }
            _ => None,
        }
    }
}

/// Check if a type name is a sequence-like container.
fn is_sequence_type(name: &str) -> bool {
    matches!(
        name,
        "List" | "list" | "Sequence" | "Iterable" | "Set" | "set" |
        "FrozenSet" | "frozenset" | "Tuple" | "tuple"
    )
}

/// Check if a type name is a mapping-like container.
fn is_mapping_type(name: &str) -> bool {
    matches!(name, "Dict" | "dict" | "Mapping" | "MutableMapping")
}
```

**Resolution Integration:**

```rust
// In resolve_subscript_type (new function)

/// Resolve the type of a subscript expression like `items[0]`.
pub fn resolve_subscript_type(
    container_type: &str,
    type_node: Option<&TypeNode>,
) -> Option<String> {
    // Prefer TypeNode if available
    if let Some(node) = type_node {
        if let Some(elem_type) = extract_element_type_from_node(node) {
            return Some(elem_type);
        }
    }

    // Fall back to string parsing
    extract_element_type(container_type)
}
```

**Rationale:**
- Leverages existing `TypeNode` infrastructure from CST collection
- String parsing fallback handles cases where TypeNode isn't available
- Focuses on common container types that cover 90%+ of use cases

**Implications:**
- Subscript expressions in receiver paths can now be resolved
- `resolve_receiver_path` needs to handle `ReceiverStep::Subscript` using this infrastructure
- Complex nested generics (e.g., `List[Dict[str, Handler]]`) may not resolve correctly
- TypeNode source for subscript resolution is defined in [D10]

#### [D03] isinstance Type Narrowing Architecture (DECIDED) {#d03-isinstance-narrowing}

**Decision:** Implement narrowing as a scoped overlay on TypeTracker, created when entering a conditional branch.

**Data Structures:**

```rust
// In crates/tugtool-python/src/type_narrowing.rs (new file)

use std::collections::HashMap;

/// Type narrowing context for a conditional branch.
///
/// This struct stores narrowed type information that overrides the base
/// TypeTracker within a specific scope (e.g., inside an if-branch after
/// an isinstance check).
#[derive(Debug, Clone)]
pub struct NarrowingContext {
    /// Map from (scope_path, variable_name) to narrowed type.
    /// These override the base TypeTracker's types when looking up.
    narrowings: HashMap<(Vec<String>, String), String>,
}

impl NarrowingContext {
    /// Create a new empty narrowing context.
    pub fn new() -> Self {
        Self {
            narrowings: HashMap::new(),
        }
    }

    /// Add a narrowing for a variable in a scope.
    pub fn narrow(&mut self, scope_path: Vec<String>, name: String, narrowed_type: String) {
        self.narrowings.insert((scope_path, name), narrowed_type);
    }

    /// Look up a narrowed type, returning None if not narrowed.
    pub fn get_narrowed_type(&self, scope_path: &[String], name: &str) -> Option<&String> {
        self.narrowings.get(&(scope_path.to_vec(), name.to_string()))
    }
}

/// Information about an isinstance check.
#[derive(Debug, Clone)]
pub struct IsInstanceCheck {
    /// The variable being checked.
    pub variable: String,
    /// The scope path where the check occurs.
    pub scope_path: Vec<String>,
    /// The type(s) being checked against (e.g., ["Handler"] or ["A", "B"] for tuple).
    pub checked_types: Vec<String>,
    /// Span of the isinstance call (for diagnostics).
    pub check_span: Option<Span>,
    /// Span of the if-branch body where narrowing applies.
    /// Narrowing is only active when the site span falls within this span.
    pub branch_span: Span,
}
```

**Detection and Collection:**

```rust
// In crates/tugtool-python-cst/src/visitor/isinstance.rs (new file)

/// Collector for isinstance checks in conditional expressions.
pub struct IsInstanceCollector {
    checks: Vec<IsInstanceCheck>,
    scope_path: Vec<String>,
}

impl<'a> Visitor<'a> for IsInstanceCollector {
    fn visit_if(&mut self, node: &'a If<'a>) -> VisitResult {
        // Check if test is isinstance(var, Type) or isinstance(var, (T1, T2))
        if let Some(check) = self.extract_isinstance_check(&node.test) {
            self.checks.push(check);
        }
        walk_if(self, node)
    }

    // ... scope tracking methods ...
}
```

**Integration with TypeTracker:**

```rust
// Extended lookup in TypeTracker or resolution functions

/// Look up type with optional narrowing context.
pub fn type_of_with_narrowing(
    tracker: &TypeTracker,
    narrowing: Option<&NarrowingContext>,
    scope_path: &[String],
    name: &str,
) -> Option<String> {
    // Check narrowing context first
    if let Some(ctx) = narrowing {
        if let Some(narrowed) = ctx.get_narrowed_type(scope_path, name) {
            return Some(narrowed.clone());
        }
    }

    // Fall back to base TypeTracker
    tracker.type_of(scope_path, name).map(|s| s.to_string())
}
```

**Rationale:**
- Overlay pattern avoids mutating the base TypeTracker
- Narrowing context is naturally scoped to the conditional branch
- Easy to extend for future narrowing patterns (e.g., type guards)

**Implications:**
- Resolution functions need to accept optional `NarrowingContext`
- Need to track which scope corresponds to which if-branch
- Initial implementation covers only direct if-branches, not elif/else

#### [D04] Supported isinstance Patterns (DECIDED) {#d04-isinstance-patterns}

**Decision:** Support rope-level isinstance patterns (simple variable narrowing only):

**Supported:**
- `isinstance(x, SomeClass)` - single type, simple variable
- `isinstance(x, (ClassA, ClassB))` - tuple of types, narrows to `Union[ClassA, ClassB]`

**Not Supported (return None / no narrowing):**
- `isinstance(self.attr, SomeClass)` - attribute narrowing requires complex keying
- `isinstance(x, SomeClass) and other_condition` - compound conditions
- `not isinstance(x, SomeClass)` - negated checks
- `isinstance(x, type_var)` - dynamic type argument
- `type(x) is SomeClass` - type() comparison
- `isinstance(expr, SomeClass)` where expr is any complex expression
- Comprehension scope narrowing: `[h for h in items if isinstance(h, Handler)]`

**Rationale:**
- Simple variable patterns cover the most common isinstance usage
- Matches rope's isinstance narrowing capability
- Attribute narrowing requires keying by `(scope_path, receiver_path)` instead of `(scope_path, name)`, adding significant complexity for rare cases
- We can extend support in future phases if demand materializes

#### [D05] Scope Path Wiring for Imports (DECIDED) {#d05-import-scope-wiring}

**Decision:** Persist `scope_path` from CST `ImportInfo` through `LocalImport` and into
`FileAnalysis.imports`, so `build_import_targets` can use real scope paths.

**Rationale:**
- `build_import_targets` consumes `FileAnalysis.imports`, not CST `ImportInfo`
- Without wiring, function-level imports never reach resolution logic
- Keeps scope model consistent with other collectors

**Conversion Location:**

The conversion from CST `ImportInfo` to `LocalImport` happens in:
- **File:** `crates/tugtool-python/src/analyzer.rs`
- **Function:** `convert_imports()` at line ~3089
- **Signature:** `fn convert_imports(&[tugtool_python_cst::ImportInfo], ...) -> Vec<LocalImport>`

```rust
// In convert_imports(), add scope_path propagation:
result.push(LocalImport {
    kind: kind.to_string(),
    module_path: import.module.clone(),
    // ... existing fields ...
    scope_path: import.scope_path.clone(),  // NEW: propagate from CST
});
```

**Implications:**
- Add `scope_path: Vec<String>` to `ImportInfo` (tugtool-python-cst/src/visitor/import.rs:72)
- Add `scope_path: Vec<String>` to `LocalImport` (tugtool-python/src/analyzer.rs:427)
- Update `convert_imports()` to propagate scope_path
- Update `ImportInfo::new_import()` and `ImportInfo::new_from()` helper methods
- Update any `LocalImport` constructors in analyzer tests

#### [D06] ReceiverPath Subscript Representation (DECIDED) {#d06-receiver-subscript}

**Decision:** Extend `ReceiverPath` with `ReceiverStep::Subscript` as a simple marker variant
(like `Call`), representing `container[index]` in receiver chains.

**Rationale:**
- Subscript resolution requires a dedicated step to inject element-type resolution
- Treating subscript as a generic `Call`/`Attr` loses container/type semantics
- The container type annotation itself provides dict vs list disambiguation (`Dict[str, Handler]` vs `List[Handler]`), so no index data needed on the variant

**Code Location:**
- **File:** `crates/tugtool-python-cst/src/visitor/attribute_access.rs`
- **Enum:** `ReceiverStep` at line ~66
 - **Also used by:** `crates/tugtool-python-cst/src/visitor/call_site.rs` for call receiver paths

**Variant Definition:**

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReceiverStep {
    /// Simple name: `self`, `obj`, `factory`
    Name { value: String },
    /// Attribute access: `.handler`, `.process`
    Attr { value: String },
    /// Function/method call: `()`
    Call,
    /// Subscript access: `[index]` - element type resolved from container annotation
    Subscript,  // NEW: simple marker, like Call
}
```

**Resolution Logic:**

When `resolve_receiver_path` encounters `ReceiverStep::Subscript`:
1. Get container type from previous step (e.g., `List[Handler]`)
2. Call `extract_element_type()` to get element type (e.g., `Handler`)
3. Continue resolution with element type

**Subscript Recursion Behavior:**

When `extract_receiver_path_recursive()` encounters `Expression::Subscript(subscript)`:
1. First, recursively extract the receiver path from `subscript.value` (the container expression)
2. If recursion succeeds, append `ReceiverStep::Subscript` to the steps
3. Return true to continue building the path

```rust
// In extract_receiver_path_recursive():
Expression::Subscript(subscript) => {
    // First, process the container (value)
    if !extract_receiver_path_recursive(&subscript.value, steps) {
        return false;
    }
    // Then add the subscript step
    steps.push(ReceiverStep::Subscript);
    true
}
```

This produces paths like `items[0].process()` → `[Name(items), Subscript, Attr(process), Call]`.

**Implications:**
- Add `Subscript` variant to `ReceiverStep` enum
- Update `extract_receiver_path_recursive()` (line ~165) to handle `Expression::Subscript` as shown above
- Emit `Subscript` steps in call-site receiver path collection (call_site.rs uses `extract_receiver_path`)
- Add `ReceiverPath::with_subscript()` builder method
- Update `resolve_receiver_path` to handle Subscript via element-type extraction

#### [D07] Narrowing Integration Point (DECIDED) {#d07-narrowing-integration}

**Decision:** Add `NarrowingContext` as an optional parameter to `resolve_receiver_path`
and to the `TypeTracker::type_of` lookup wrapper.

**Rationale:**
- Keeps narrowing localized to resolution paths (no global TypeTracker mutation)
- Matches existing resolution call patterns with minimal surface change

**Implications:**
- Add `type_of_with_narrowing(...)` helper and use it inside `resolve_receiver_path`
- Callers that don’t participate in narrowing pass `None`

#### [D08] Star Import Resolution Rule (DECIDED) {#d08-star-import-resolution}

**Decision:** If a scope has any `from module import *`, `lookup_import_target`
returns `None` for that scope unless `__all__` is available and expanded into
explicit imports.

**Rationale:**
- Star imports are ambiguous without `__all__`
- Conservative failure is preferable to incorrect resolution

**Implications:**
- Track `is_star` on `LocalImport` alongside scope_path
- If `__all__` exists, expand star imports into explicit names at collection time
- Otherwise treat star-imported scopes as ambiguous (no resolution)

**Resolution Source for `__all__`:**
- Prefer `PublicExport` entries from prior analysis (FactsStore)
- If not available, use on-demand analysis (Phase 11D cache) to read `__all__`
- If neither source is available, treat as ambiguous and return `None`

#### [D09] Narrowing Context Scope Binding (DECIDED) {#d09-narrowing-scope-binding}

**Decision:** Narrowing context is computed per-branch and passed to resolution for
attribute accesses that fall within that branch's span.

**How it works:**

1. **IsInstanceCollector** visits `If` nodes and collects `IsInstanceCheck` records:
   - `variable`: the narrowed variable name
   - `scope_path`: where the isinstance check occurs (function scope)
   - `checked_types`: types being checked
   - `branch_span`: byte span of the if-branch body

2. **At resolution time** (method call or attribute access):
   - Check if the site span falls within any `branch_span` from isinstance checks
   - If yes, look up whether the receiver variable has a narrowing in that branch
   - Apply the narrowed type for resolution

**Keying strategy:**

Narrowings are keyed by `(scope_path, variable_name)` where:
- `scope_path`: the enclosing function/method scope (e.g., `["<module>", "MyClass", "process"]`)
- `variable_name`: simple identifier only (no attributes)

This simple keying works because:
- We only support simple variable narrowing (not attributes)
- The branch_span check ensures we don't apply narrowing outside the if-body

**Rationale:**
- Span-based branch detection is straightforward and accurate
- Simple keying avoids complexity of receiver-path matching
- Matches rope's scope-aware narrowing approach

**Implications:**
- `IsInstanceCheck` needs `branch_span: Span` field
- Resolution logic checks `site_span ⊆ branch_span` before applying narrowing
- No global state mutation; narrowing is query-time lookup

#### [D10] TypeNode Source for Subscript Resolution (DECIDED) {#d10-typenode-source}

**Decision:** Add an optional TypeNode lookup path in TypeTracker to avoid
string-only parsing for container types.

**Rationale:**
- TypeNode is already collected for annotations in Phase 11
- String parsing alone misses `A | B` and nested generics

**Implications:**
- Add `type_of_node(scope_path, name) -> Option<&TypeNode>` (or equivalent) to TypeTracker
- `type_of_node` must support both simple names and attribute types (e.g., `self.items`)
- `resolve_subscript_type` prefers TypeNode; falls back to string parsing when absent

**Implementation Detail - Attribute Type Lookup:**

For attribute types like `self.items`, the `type_of_node` lookup must route through existing infrastructure:

```rust
// For simple names: use annotated_type_of directly
fn type_of_node(&self, scope_path: &[String], name: &str) -> Option<&TypeNode> {
    self.annotated_types.get(&(scope_path.to_vec(), name.to_string()))
        .and_then(|at| at.type_node.as_ref())
}

// For attribute access like self.items:
// 1. Resolve `self` to class name (from scope_path or explicit annotation)
// 2. Use attribute_type_of(class_name, "items") which returns AttributeTypeInfo
// 3. Extract type_node from AttributeTypeInfo.type_node
```

The existing `TypeTracker::attribute_type_of(class_name, attr_name)` returns `AttributeTypeInfo` which already contains `type_node: Option<TypeNode>`. The wiring connects these pieces.

#### [D11] Union Parsing Rules (DECIDED) {#d11-union-parsing}

**Decision:** Support both `Union[A, B]` and `A | B` spellings.

**Rationale:**
- `A | B` is the default in Python 3.10+ codebases
- Union narrowing depends on accurate parsing

**Implications:**
- TypeNode parsing handles `A | B` when available
- String parsing must recognize both spellings when TypeNode is absent

---

### 11E.1 Specification {#specification}

#### 11E.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs:**
- Python source files with function-level imports
- Type annotations with generic containers (`List[T]`, `Dict[K, V]`, etc.)
- isinstance checks in conditional expressions

**Outputs:**
- Extended `ImportInfo` with `scope_path` field
- `LocalImport` entries with `scope_path` preserved
- Receiver paths include `Subscript` steps where applicable
- Resolved element types for container subscript access
- Narrowed types within conditional branches

**Key Invariants:**
- Function-level imports are only visible within their defining scope
- Subscript resolution returns `None` for non-container types
- Narrowing only applies within the if-branch body, not after

#### 11E.1.2 Terminology {#terminology}

- **Function-level import**: An import statement inside a function or method body
- **Element type**: The type parameter of a generic container (e.g., `T` in `List[T]`)
- **Type narrowing**: Refining a variable's type based on runtime checks
- **Narrowing context**: A scoped overlay that tracks narrowed types

#### 11E.1.2a Wiring Diagram (Scope Path) {#wiring-diagram}

**Goal:** Ensure `scope_path` flows from CST → analyzer → resolver without loss.

```
ImportCollector (CST)
  ImportInfo.scope_path
        |
        v
cst_bridge.rs
  NativeAnalysisResult.imports (ImportInfo[])
        |
        v
analyzer.rs
  LocalImport.scope_path
  FileAnalysis.imports (LocalImport[])
        |
        v
cross_file_types.rs
  build_import_targets(imports)
  ImportTarget keyed by (scope_path, local_name)
        |
        v
resolve_receiver_path / lookup_import_target
  scope-chain lookup uses scope_path
```

**Invariant:** `scope_path` uses the same naming conventions as TypeTracker and ReceiverPath:
`["<module>", "ClassName", "function_name"]`.

#### 11E.1.2b TypeNode Retrieval Diagram {#typenode-retrieval}

**Goal:** Ensure TypeNode flows are available for subscript resolution.

```
CST Type Annotation
  -> TypeNode (collected in Phase 11)
        |
        v
TypeTracker
  type_of_node(scope_path, name) -> Option<TypeNode>
        |
        v
resolve_subscript_type(container_type, type_node)
  - prefer TypeNode for element type extraction
  - fallback to string parsing when None
```

#### 11E.1.3 Supported Features {#supported-features}

**Function-Level Imports:**
- Regular imports: `import foo`
- From imports: `from foo import bar`
- Relative imports: `from . import bar`
- Aliased imports: `from foo import bar as baz`
- Star imports: `from foo import *` (only resolved when __all__ is expanded)

**Generic Type Parameter Extraction:**
- Sequence types: `List[T]`, `Sequence[T]`, `Iterable[T]`, `Set[T]`, `Tuple[T, ...]`
- Mapping types: `Dict[K, V]`, `Mapping[K, V]` (extracts value type `V`)
- Optional: `Optional[T]` (extracts `T`)
- Built-in generics: `list[T]`, `dict[K, V]`, `set[T]` (Python 3.9+ syntax)

**isinstance Narrowing:**
- Single type: `isinstance(x, Handler)`
- Tuple of types: `isinstance(x, (Handler, Worker))`

**Explicitly Not Supported:**
- Attribute narrowing: `isinstance(self.field, Handler)` (requires complex keying)
- Comprehension scope narrowing: `[h for h in items if isinstance(h, Handler)]`
- Nested generic extraction: `List[Dict[str, Handler]]` -> `Handler`
- TypeVar resolution: `T` -> concrete type
- Compound isinstance conditions: `isinstance(x, A) and x.ready`
- Negated isinstance: `if not isinstance(x, A)`
- Type guards: `TypeGuard[T]`, `TypeIs[T]`
- else-branch narrowing (complement types)
- Star-import resolution without `__all__` expansion

#### 11E.1.4 Semantics {#semantics}

**Import Scope Resolution Order:**
1. Check function-level imports at current scope
2. Walk outward through enclosing scopes
3. Check module-level imports
4. If any star import exists in the resolved scope and __all__ is not expanded, return None

**Subscript Type Resolution:**
1. Look up container variable type
2. If TypeNode available, extract element type from structured representation
3. Otherwise, parse type string to extract element type
4. Return element type or `None` if not a known container
5. Only applies when receiver path includes `ReceiverStep::Subscript`

**Type Resolution Order (Narrowing vs Imports):**
1. Resolve receiver type via `type_of_with_narrowing` (type-only narrowing)
2. Resolve imports via scope-chain lookup (function → module)
3. Do not use narrowing to influence import resolution

**Example Flow (`self.items[0].process()`):**
1. `self.items` → `type_of_with_narrowing` returns `List[Handler]` (from attribute annotation)
2. `ReceiverStep::Subscript` → `extract_element_type` returns `Handler`
3. `.process()` resolves against `Handler` (local or cross-file)

**isinstance Narrowing Scope:**
1. Detect isinstance check in if-condition
2. Extract variable name and checked type(s)
3. Create NarrowingContext with narrowed type
4. Apply narrowing only within the if-branch body
5. Discard narrowing when exiting the if-branch

**Union Method Resolution (Tuple Narrowing):**
1. If narrowed type is `Union[A, B]`, attempt method resolution for each member type
2. Succeed if any member resolves the method/attribute
3. If no members resolve, return `None`

---

### 11E.2 Symbol Inventory {#symbol-inventory}

#### 11E.2.1 New Files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugtool-python/src/type_narrowing.rs` | NarrowingContext, IsInstanceCheck, narrowing utilities |
| `crates/tugtool-python-cst/src/visitor/isinstance.rs` | IsInstanceCollector visitor |

#### 11E.2.2 Modified Files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool-python-cst/src/inflate_ctx.rs` | Add `branch_span` to NodePosition, add `record_branch_span` method |
| `crates/tugtool-python-cst/src/nodes/statement.rs` | Add `node_id` to If, For, While, Try, TryStar, With, Match structs; update inflate() methods |
| `crates/tugtool-python-cst/src/nodes/expression.rs` | Update DeflatedSimpleString::inflate() to record ident_span (Step 5B) |
| `crates/tugtool-python-cst/src/visitor/import.rs` | Add scope_path to ImportInfo, scope tracking to ImportCollector |
| `crates/tugtool-python-cst/src/visitor/exports.rs` | Remove string search, use PositionTable lookup via node_id (Step 5B) |
| `crates/tugtool-python-cst/src/visitor/mod.rs` | Export isinstance module |
| `crates/tugtool-python-cst/src/lib.rs` | Re-export isinstance types |
| `crates/tugtool-python-cst/src/visitor/attribute_access.rs` | Add ReceiverStep::Subscript and emit subscript steps |
| `crates/tugtool-python-cst/src/visitor/call_site.rs` | Emit ReceiverStep::Subscript in call-site receiver paths |
| `crates/tugtool-python/src/cross_file_types.rs` | Use actual scope_path in build_import_targets |
| `crates/tugtool-python/src/type_tracker.rs` | Add extract_element_type methods |
| `crates/tugtool-python/src/cst_bridge.rs` | Include isinstance checks in analysis result |
| `crates/tugtool-python/src/lib.rs` | Export type_narrowing module |
| `crates/tugtool-python/src/analyzer.rs` | Persist ImportInfo.scope_path into LocalImport |

#### 11E.2.3 Symbols to Add/Modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `NodePosition.branch_span` | field | `tugtool-python-cst/src/inflate_ctx.rs` | Branch body span for type narrowing |
| `InflateCtx::record_branch_span` | method | `tugtool-python-cst/src/inflate_ctx.rs` | Record branch span during inflation |
| `If.node_id` | field | `tugtool-python-cst/src/nodes/statement.rs` | Stable identity for span lookup |
| `For.node_id` | field | `tugtool-python-cst/src/nodes/statement.rs` | Stable identity (Step 5C) |
| `While.node_id` | field | `tugtool-python-cst/src/nodes/statement.rs` | Stable identity (Step 5C) |
| `Try.node_id` | field | `tugtool-python-cst/src/nodes/statement.rs` | Stable identity (Step 5C) |
| `TryStar.node_id` | field | `tugtool-python-cst/src/nodes/statement.rs` | Stable identity (Step 5C) |
| `With.node_id` | field | `tugtool-python-cst/src/nodes/statement.rs` | Stable identity (Step 5C) |
| `Match.node_id` | field | `tugtool-python-cst/src/nodes/statement.rs` | Stable identity (Step 5C) |
| `SimpleString` ident_span recording | inflate | `tugtool-python-cst/src/nodes/expression.rs` | Record token span (Step 5B) |
| `ExportCollector` refactor | visitor | `tugtool-python-cst/src/visitor/exports.rs` | Remove string search, use PositionTable (Step 5B) |
| `ImportInfo.scope_path` | field | `tugtool-python-cst/.../import.rs` | New field for scope tracking |
| `ImportCollector.scope_path` | field | `tugtool-python-cst/.../import.rs` | Internal scope stack |
| `LocalImport.scope_path` | field | `tugtool-python/src/analyzer.rs` | Persist CST scope_path for import resolution |
| `NarrowingContext` | struct | `tugtool-python/src/type_narrowing.rs` | New type for narrowing overlay |
| `IsInstanceCheck` | struct | `tugtool-python-cst/.../isinstance.rs` | isinstance check info with branch_span |
| `IsInstanceCollector` | struct | `tugtool-python-cst/.../isinstance.rs` | New visitor |
| `IsInstanceCollector::get_branch_span_from_if` | method | `tugtool-python-cst/.../isinstance.rs` | Lookup branch_span via node_id |
| `TypeTracker::extract_element_type` | method | `tugtool-python/src/type_tracker.rs` | New method |
| `TypeTracker::extract_element_type_from_node` | method | `tugtool-python/src/type_tracker.rs` | New method |
| `TypeTracker::type_of_node` | method | `tugtool-python/src/type_tracker.rs` | Optional TypeNode lookup for D10 |
| `type_of_with_narrowing` | fn | `tugtool-python/src/type_narrowing.rs` | New function |
| `ReceiverStep::Subscript` | enum variant | `tugtool-python-cst/.../attribute_access.rs` | New receiver step for subscripts |
| `ReceiverPath::with_subscript` | method | `tugtool-python-cst/.../attribute_access.rs` | Builder method for subscript steps |

---

### 11E.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | Examples |
|----------|---------|----------|
| **Unit** | Test individual functions in isolation | `extract_element_type`, `NarrowingContext::narrow` |
| **Integration** | Test components working together | Full resolution with function-level imports |
| **Regression** | Ensure existing behavior unchanged | All Phase 11D tests still pass |

#### Test Fixtures {#test-fixtures}

**Function-Level Import Tests:**

```python
# fixture: function_level_import_basic.py
from typing import List

def process():
    from handler import Handler
    h = Handler()
    h.process()  # Should resolve to Handler.process

def other():
    # Handler should NOT be visible here
    h = Handler()  # Resolution should fail or use module-level if exists
```

**Star Import Limitation Tests:**

```python
# fixture: function_level_star_import.py
def process():
    from handlers import *  # No __all__ expansion
    h = Handler()
    h.process()  # Should NOT resolve (ambiguous)
```

**Generic Container Tests:**

```python
# fixture: generic_container_subscript.py
from typing import List, Dict, Optional

handlers: List[Handler] = []
first = handlers[0]
first.process()  # Should resolve to Handler.process

config: Dict[str, Settings] = {}
settings = config["key"]
settings.apply()  # Should resolve to Settings.apply

maybe_handler: Optional[Handler] = None
if maybe_handler:
    maybe_handler.process()  # Should resolve to Handler.process
```

**isinstance Narrowing Tests:**

```python
# fixture: isinstance_narrowing_basic.py
class Base:
    pass

class Handler(Base):
    def process(self) -> None:
        pass

def handle(x: Base) -> None:
    if isinstance(x, Handler):
        x.process()  # Should resolve to Handler.process
    # x is still Base type here, process() should NOT resolve
```

**isinstance Tuple Narrowing Tests (Q02 - Union):**

```python
# fixture: isinstance_narrowing_union.py
class Handler:
    def process(self) -> None:
        pass

class Worker:
    def process(self) -> None:
        pass

    def work(self) -> None:
        pass

def handle(x: object) -> None:
    if isinstance(x, (Handler, Worker)):
        # x is narrowed to Union[Handler, Worker]
        x.process()  # Should resolve - common to both types
        # x.work() would NOT resolve - only on Worker
```

**Import Shadowing Tests (Q01):**

```python
# fixture: import_shadowing.py
from external import Handler as Handler  # Module-level

def process():
    from internal import Handler  # Function-level, shadows module-level
    h = Handler()
    h.process()  # Should resolve to internal.Handler.process, not external
```

---

### 11E.4 Execution Steps {#execution-steps}

#### Step 1: Add Scope Tracking to ImportCollector {#step-1}

**Commit:** `feat(python-cst): add scope_path tracking to ImportCollector`

**References:** [D01] Import Scope Tracking Approach (#d01-import-scope-tracking)

**Artifacts:**
- Modified `ImportInfo` struct with `scope_path` field
- Modified `ImportCollector` with scope tracking methods

**Tasks:**
- [x] Add `scope_path: Vec<String>` field to `ImportInfo`
- [x] Add `scope_path: Vec<String>` field to `ImportCollector`
- [x] Implement `visit_class_def` to push/pop class names
- [x] Implement `visit_function_def` to push/pop function names
- [x] Update `visit_import` and `visit_import_from` to include scope_path
- [x] Initialize scope_path with `["<module>"]` in `ImportCollector::new`
- [x] Propagate `ImportInfo.scope_path` into CST bridge output

**Tests:**
- [x] Unit: Import at module level has scope_path `["<module>"]`
- [x] Unit: Import inside function has correct scope_path
- [x] Unit: Import inside nested class/function has full scope_path
- [x] Unit: Existing import tests still pass

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst import`
- [x] Manual verification: parse file with function-level import, check scope_path

**Rollback:** Revert commit

---

#### Step 2: Wire Scoped Imports Through build_import_targets {#step-2}

**Commit:** `feat(python): use scope_path from ImportInfo in build_import_targets`

**References:** [D01] Import Scope Tracking Approach (#d01-import-scope-tracking), [D05] Scope Path Wiring for Imports (#d05-import-scope-wiring), [D08] Star Import Resolution Rule (#d08-star-import-resolution)

**Artifacts:**
- Modified `build_import_targets` functions to use actual scope_path
- Modified `build_import_targets_from_cst` to pass through scope_path

**Tasks:**
- [x] Add `scope_path: Vec<String>` field to `LocalImport` struct (analyzer.rs:427)
- [x] Update `build_import_targets` in `cross_file_types.rs` to use `import.scope_path` instead of hardcoded module_scope
- [x] Update `build_import_targets_from_cst` similarly
- [x] Ensure `lookup_import_target` correctly walks scope chain for function-level imports
- [x] Update LocalImport conversion in `convert_imports()` to propagate scope_path from ImportInfo
- [x] Define star-import behavior: expand via __all__ when available; otherwise mark scope ambiguous

**Note on star import expansion:** Star import expansion requires looking up the target module's exports. This may require passing `FileAnalysisBundle` (or an exports lookup function) to `build_import_targets`. If the target module's `FileAnalysis.exports` is available, expand the star import into explicit `ImportTarget` entries; otherwise treat as ambiguous.

**Tests:**
- [x] Integration: Function-level import populates import_targets with correct scope key
- [x] Integration: lookup_import_target finds function-level import from within function
- [x] Integration: lookup_import_target does NOT find function-level import from outside function
- [x] Regression: Module-level import resolution unchanged

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python cross_file`
- [x] `cargo nextest run -p tugtool-python import`

**Rollback:** Revert commit

---

#### Step 3-PREREQUISITE: Make Complete Use of CST Type Annotations & TypeNode Structures {#step-3-prereq}

**Purpose:** Eliminate redundant string-based type parsing code that duplicates TypeNode functionality. The CST already provides structured `TypeNode` representations at collection time - manually re-parsing type strings character-by-character is wasteful, error-prone, and a design flaw.

**Commit:** `refactor(python): remove string-based type parsing, use TypeNode exclusively`

**References:** Phase 11E code review feedback; CST TypeNode infrastructure (Phase 11D)

**Problem Statement:**

The type_tracker.rs file accumulated string-based type parsing functions that manually parse type annotation strings character-by-character (finding brackets, commas, extracting type arguments). This approach is:

1. **Redundant**: TypeNode already encodes the structure (generics, params, return types)
2. **Error-prone**: String parsing is fragile and can break on edge cases
3. **Wasteful**: Parsing work is done twice (once at CST collection, again at use sites)

**Functions to Remove:**

| Function | Lines | Description |
|----------|-------|-------------|
| `find_top_level_comma` | 972-986 | Character-by-character comma finding |
| `extract_first_type_arg` | 1252-1272 | Extracts first generic arg from string |
| `extract_second_type_arg` | 1277-1290 | Extracts second generic arg from string |
| `extract_element_type` (string version) | 1117-1140 | String-based container extraction |

**Functions to Modify:**

| Function | Current | New |
|----------|---------|-----|
| `callable_return_type_of` | TypeNode first, string fallback | TypeNode only, return None if unavailable |

**Design Decisions:**

1. **TypeNode is the single source of truth** for type structure - no string parsing fallbacks
2. **Graceful degradation**: Return `None` when TypeNode unavailable (don't mask issues with fallback code)
3. **Remove string-based API entirely**: Keep only `extract_element_type_from_node`

**Tasks:**

- [x] Remove string fallback from `callable_return_type_of` (keep only TypeNode extraction)
- [x] Remove `extract_element_type` method (string-based)
- [x] Remove `extract_first_type_arg` helper
- [x] Remove `extract_second_type_arg` helper
- [x] Remove `find_top_level_comma` function
- [x] Remove string-based tests that test fallback behavior
- [x] Keep `is_sequence_type` and `is_mapping_type` (used by TypeNode extraction)
- [x] Keep `extract_element_type_from_node` and its tests

**Tests to Remove:**

- [x] `callable_return_type_of_fallback_to_type_str`
- [x] `callable_return_type_of_fallback_empty_params`
- [x] `callable_return_type_of_fallback_nested`
- [x] `callable_return_type_of_non_callable_string`
- [x] All `extract_element_type_*` tests that use string input (keep TypeNode-based tests)

**Tests to Add:**

- [x] `callable_return_type_of_returns_none_without_typenode`

**Verification Searches (must all return empty):**

```bash
grep -n "find_top_level_comma" crates/tugtool-python/src/
grep -n "extract_first_type_arg" crates/tugtool-python/src/
grep -n "extract_second_type_arg" crates/tugtool-python/src/
```

**Checkpoint:**

- [x] All grep searches return empty (no string parsing remains)
- [x] `cargo nextest run -p tugtool-python` passes
- [x] `cargo clippy --workspace -- -D warnings` passes
- [x] `cargo fmt --all --check` passes

**Estimated Removal:** ~320 lines of code (including tests for string-based parsing)

**Rollback:** Revert commit

---

#### Step 3: Add Element Type Extraction to TypeTracker {#step-3}

**Commit:** `feat(python): add generic type parameter extraction to TypeTracker`

**References:** [D02] Generic Type Parameter Extraction (#d02-type-parameter-extraction)

**Artifacts:**
- New methods on TypeTracker for element type extraction
- Helper functions for container type detection

**Tasks:**
- [x] Add `extract_element_type(&self, type_str: &str) -> Option<String>` method
- [x] Add `extract_element_type_from_node(&self, node: &TypeNode) -> Option<String>` method
- [x] Add `type_of_node(&self, scope_path: &[String], name: &str) -> Option<&TypeNode>` (per D10)
- [x] Implement `is_sequence_type(name: &str) -> bool` helper
- [x] Implement `is_mapping_type(name: &str) -> bool` helper
- [x] Handle common patterns: List, Dict, Set, Optional, Tuple
- [x] Handle built-in generics: list, dict, set (Python 3.9+)

**Tests:**
- [x] Unit: `extract_element_type("List[Handler]")` returns `Some("Handler")`
- [x] Unit: `extract_element_type("Dict[str, Handler]")` returns `Some("Handler")`
- [x] Unit: `extract_element_type("Optional[Handler]")` returns `Some("Handler")`
- [x] Unit: `extract_element_type("str")` returns `None`
- [x] Unit: `extract_element_type_from_node` with TypeNode::Subscript
- [x] Unit: Built-in generics `list[Handler]` work

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python type_tracker`
- [x] `cargo nextest run -p tugtool-python extract`

**Rollback:** Revert commit

---

#### Step 4: Integrate Subscript Resolution into Receiver Path {#step-4}

**Commit:** `feat(python): resolve subscript expressions using element type extraction`

**References:** [D02] Generic Type Parameter Extraction (#d02-type-parameter-extraction), [D06] ReceiverPath Subscript Representation (#d06-receiver-subscript)

**Artifacts:**
- Extended receiver resolution to handle subscript steps
- Integration of element type extraction into resolution flow

**Tasks:**
- [x] Add `ReceiverStep::Subscript` to receiver path model (if not present)
- [x] Update receiver path collector to emit Subscript steps for `container[index]`
- [x] Update call-site receiver path collector to emit Subscript steps
- [x] Update `resolve_receiver_path` to handle `ReceiverStep::Subscript`
- [x] When resolving `container[index]`, look up container type and extract element type
- [x] Continue resolution chain with element type
- [x] Return `None` for unsupported subscript patterns

**Tests:**
- [x] Integration: `items[0].process()` resolves when `items: List[Handler]`
- [x] Integration: `config["key"].apply()` resolves when `config: Dict[str, Settings]`
- [x] Integration: Nested subscript `data[0][1]` returns `None` (unsupported)
- [x] Integration: Non-container subscript returns `None`
- [x] Unit: ReceiverPath includes `Subscript` step for `items[0].process()`
- [x] Unit: Call-site receiver path includes `Subscript` step for `items[0].process()`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python resolve`
- [x] `cargo nextest run -p tugtool-python subscript`

**Rollback:** Revert commit

---

#### Step 5: Create IsInstanceCollector Visitor with Proper Branch Span Capture {#step-5}

**Commit:** `feat(python-cst): add IsInstanceCollector with branch span capture during inflation`

**References:** [D03] isinstance Type Narrowing Architecture (#d03-isinstance-narrowing), [D04] Supported isinstance Patterns (#d04-isinstance-patterns), [D09] Narrowing Context Scope Binding (#d09-narrowing-scope-binding)

**Artifacts:**
- Modified `inflate_ctx.rs` - add `branch_span` to `NodePosition`, add `record_branch_span` method
- Modified `statement.rs` - add `node_id` to `If` struct, update `DeflatedIf::inflate()`
- New/Modified `isinstance.rs` visitor module - use `node_id` lookup for branch spans

##### Architecture: Capture Branch Spans During Inflation (DECIDED) {#step-5-architecture}

**Problem:** Token fields like `colon_tok` and `dedent_tok` are `pub(crate)` on the DEFLATED CST nodes only. The `#[cst_node]` macro filters out `TokenRef` fields from inflated structs (see `cstnode.rs` lines 284-289). Therefore, the `IsInstanceCollector` visitor cannot access token positions directly on inflated `If` nodes.

**Solution:** Capture branch spans during inflation, following the established pattern from `FunctionDef` and `ClassDef`:

1. **Add `node_id` to `If` struct** - Enables span lookup by identity
2. **Add `branch_span` to `NodePosition`** - New span type for conditional bodies
3. **Compute span during `DeflatedIf::inflate()`** - Before body inflation, when tokens are available
4. **Look up span in `IsInstanceCollector`** - Via `node_id` and `PositionTable`

**Pattern Reference (from FunctionDef, lines 886-899):**
```rust
// Compute scope end directly from our body suite (see [D10])
let scope_end = match &self.body {
    DeflatedSuite::IndentedBlock(block) => block.dedent_tok.start_pos.byte_idx(),
    DeflatedSuite::SimpleStatementSuite(suite) => suite.newline_tok.end_pos.byte_idx(),
};

// Record spans (if position tracking is enabled)
ctx.record_lexical_span(node_id, Span { start: lexical_start, end: scope_end });
```

---

**Tasks:**

**Part A: Infrastructure Changes**
- [x] Add `branch_span: Option<Span>` field to `NodePosition` struct in `inflate_ctx.rs`
- [x] Add `record_branch_span(&mut self, id: NodeId, span: Span)` method to `InflateCtx`
- [x] Add `node_id: Option<NodeId>` field to `If` struct in `statement.rs`
- [x] Update `DeflatedIf::inflate()` to:
  - Generate `node_id` via `ctx.next_id()`
  - Compute branch span from `colon_tok.end_pos` and body's terminating token
  - Call `ctx.record_branch_span(node_id, span)`
  - Include `node_id: Some(node_id)` in returned struct

**Part B: IsInstanceCollector Visitor**
- [x] Create `crates/tugtool-python-cst/src/visitor/isinstance.rs`
- [x] Define `IsInstanceCheck` struct with variable, scope_path, checked_types, check_span, branch_span
- [x] Implement `IsInstanceCollector` with scope tracking
- [x] Implement `get_branch_span_from_if()` using node_id lookup from PositionTable
- [x] Implement `extract_isinstance_check` helper for pattern matching
- [x] Handle single type: `isinstance(x, Type)`
- [x] Handle tuple of types: `isinstance(x, (A, B))`
- [x] Export from visitor/mod.rs and lib.rs

---

**Implementation Details:**

**Change 1: `inflate_ctx.rs` - Add branch_span support**

```rust
// Add to NodePosition struct (around line 48)
#[derive(Debug, Clone, Default)]
pub struct NodePosition {
    pub ident_span: Option<Span>,
    pub lexical_span: Option<Span>,
    pub def_span: Option<Span>,

    /// Branch span: the body of a conditional branch (for type narrowing).
    ///
    /// For If nodes, this spans from after the colon to the end of the body Suite.
    /// isinstance-based type narrowing only applies within this span.
    pub branch_span: Option<Span>,
}

// Add to InflateCtx impl (around line 230)
/// Record a branch span for a node (if position tracking enabled).
///
/// The branch span covers the body of a conditional, from after the colon
/// to the end of the suite. Used for isinstance-based type narrowing.
pub fn record_branch_span(&mut self, id: NodeId, span: Span) {
    if let Some(ref mut positions) = self.positions {
        positions
            .get_or_insert(id, NodePosition::default())
            .branch_span = Some(span);
    }
}
```

**Change 2: `statement.rs` - Add node_id to If struct**

```rust
// Around line 1053, add node_id field
#[cst_node]
pub struct If<'a> {
    pub test: Expression<'a>,
    pub body: Suite<'a>,
    pub orelse: Option<Box<OrElse<'a>>>,
    pub leading_lines: Vec<EmptyLine<'a>>,
    pub whitespace_before_test: SimpleWhitespace<'a>,
    pub whitespace_after_test: SimpleWhitespace<'a>,
    pub is_elif: bool,

    pub(crate) if_tok: TokenRef<'a>,
    pub(crate) colon_tok: TokenRef<'a>,

    /// Stable identity assigned during inflation.
    pub(crate) node_id: Option<NodeId>,
}
```

**Change 3: `statement.rs` - Update DeflatedIf::inflate()**

```rust
impl<'r, 'a> Inflate<'a> for DeflatedIf<'r, 'a> {
    type Inflated = If<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        // Assign identity for this If node
        let node_id = ctx.next_id();

        // Compute branch span BEFORE inflating body (tokens available here)
        let branch_start = self.colon_tok.end_pos.byte_idx();
        let branch_end = match &self.body {
            DeflatedSuite::IndentedBlock(block) => block.dedent_tok.start_pos.byte_idx(),
            DeflatedSuite::SimpleStatementSuite(suite) => suite.newline_tok.end_pos.byte_idx(),
        };

        // Record branch span in PositionTable
        ctx.record_branch_span(
            node_id,
            Span { start: branch_start, end: branch_end },
        );

        // Now inflate children (this consumes tokens)
        let leading_lines = parse_empty_lines(
            &ctx.ws,
            &mut self.if_tok.whitespace_before.borrow_mut(),
            None,
        )?;
        let whitespace_before_test =
            parse_simple_whitespace(&ctx.ws, &mut self.if_tok.whitespace_after.borrow_mut())?;
        let test = self.test.inflate(ctx)?;
        let whitespace_after_test =
            parse_simple_whitespace(&ctx.ws, &mut self.colon_tok.whitespace_before.borrow_mut())?;
        let body = self.body.inflate(ctx)?;
        let orelse = self.orelse.inflate(ctx)?;

        Ok(Self::Inflated {
            test,
            body,
            orelse,
            leading_lines,
            whitespace_before_test,
            whitespace_after_test,
            is_elif: self.is_elif,
            node_id: Some(node_id),
        })
    }
}
```

**Change 4: `isinstance.rs` - Use node_id lookup**

```rust
impl<'pos> IsInstanceCollector<'pos> {
    /// Get the branch span from the If node's position in the PositionTable.
    fn get_branch_span_from_if(&self, if_node: &If<'_>) -> Span {
        if let Some(positions) = self.positions {
            if let Some(node_id) = if_node.node_id {
                if let Some(pos) = positions.get(&node_id) {
                    if let Some(span) = pos.branch_span {
                        return span;
                    }
                }
            }
        }
        // Fallback: empty span (narrowing won't apply)
        Span::new(0, 0)
    }

    fn extract_isinstance_check(
        &self,
        test: &Expression<'_>,
        if_node: &If<'_>,
    ) -> Option<IsInstanceCheck> {
        // ... existing Call/isinstance pattern matching ...

        // Get branch span via node_id lookup
        let branch_span = self.get_branch_span_from_if(if_node);

        Some(IsInstanceCheck::new(
            variable,
            self.scope_path.clone(),
            checked_types,
            check_span,
            branch_span,
        ))
    }
}
```

---

**Tests:**
- [x] Unit: Single type isinstance detected correctly
- [x] Unit: Tuple isinstance detected with all types
- [x] Unit: Nested isinstance (in elif) detected
- [x] Unit: Non-isinstance conditions ignored
- [x] Unit: isinstance with complex expressions returns None
- [x] Unit: branch_span for multi-line if covers only the indented body
- [x] Unit: branch_span for single-line if covers only after colon to newline
- [x] Unit: branch_span with elif chains - each isinstance has own correct branch span
- [x] Unit: branch_span does NOT include the condition expression
- [x] Unit: branch_span does NOT include code after the if statement

**Branch Span Verification Tests:**

```rust
#[test]
fn test_isinstance_branch_span_multiline() {
    let source = r#"def process(x):
    if isinstance(x, Handler):
        x.process()
        x.finish()
    other()
"#;
    let parsed = parse_module_with_positions(source, None).unwrap();
    let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

    assert_eq!(checks.len(), 1);
    let check = &checks[0];

    // Branch span should cover the indented body, not the whole file
    let branch_text = &source[check.branch_span.start..check.branch_span.end];

    // Should contain the body statements
    assert!(branch_text.contains("x.process()"));
    assert!(branch_text.contains("x.finish()"));

    // Should NOT contain code outside the branch
    assert!(!branch_text.contains("other()"));
    assert!(!branch_text.contains("def process"));
}

#[test]
fn test_isinstance_branch_span_single_line() {
    let source = "if isinstance(x, A): x.process()\n";
    let parsed = parse_module_with_positions(source, None).unwrap();
    let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

    assert_eq!(checks.len(), 1);
    let check = &checks[0];

    let branch_text = &source[check.branch_span.start..check.branch_span.end];

    // Should contain just the single-line body
    assert!(branch_text.contains("x.process()"));

    // Should NOT contain the condition
    assert!(!branch_text.contains("isinstance"));
}

#[test]
fn test_isinstance_branch_span_with_elif() {
    let source = r#"def process(x):
    if isinstance(x, A):
        x.a_method()
    elif isinstance(x, B):
        x.b_method()
    else:
        x.default()
"#;
    let parsed = parse_module_with_positions(source, None).unwrap();
    let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

    // Should have two isinstance checks
    assert_eq!(checks.len(), 2);

    // First check's branch should only cover A's body
    let check_a = checks.iter().find(|c| c.checked_types == vec!["A"]).unwrap();
    let branch_a = &source[check_a.branch_span.start..check_a.branch_span.end];
    assert!(branch_a.contains("a_method"));
    assert!(!branch_a.contains("b_method"));
    assert!(!branch_a.contains("default"));

    // Second check's branch should only cover B's body
    let check_b = checks.iter().find(|c| c.checked_types == vec!["B"]).unwrap();
    let branch_b = &source[check_b.branch_span.start..check_b.branch_span.end];
    assert!(branch_b.contains("b_method"));
    assert!(!branch_b.contains("a_method"));
    assert!(!branch_b.contains("default"));
}
```

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` (verify compilation with new node_id field)
- [x] `cargo nextest run -p tugtool-python-cst isinstance`
- [x] `cargo nextest run -p tugtool-python-cst` (full crate - no regressions)

**Rollback:** Revert commit

---

#### Step 5B: Record SimpleString Spans During Inflation {#step-5b}

**Commit:** `feat(python-cst): record ident_span for SimpleString nodes during inflation`

**References:** CST infrastructure audit (2026-01-28)

**Artifacts:**
- Modified `DeflatedSimpleString::inflate()` in `expression.rs` to record spans
- Modified `ExportCollector` in `exports.rs` to use PositionTable lookup instead of string search
- Removed `search_from` cursor tracking from `ExportCollector`

##### Problem Statement {#step-5b-problem}

The `ExportCollector` currently uses a string search fallback to locate `SimpleString` literals in `__all__` assignments:

```rust
// Current workaround in parse_simple_string() (lines 281-342)
if let Some(offset) = self.source[self.search_from..].find(value) {
    let start = self.search_from + offset;
    // ... compute spans from string search
}
```

This is an anti-pattern because:
1. `SimpleString` already has a `node_id` field (assigned during inflation)
2. The span information is derivable from token positions during inflation
3. String search is O(n) and can return wrong positions for duplicate strings

##### Architecture {#step-5b-architecture}

**Current State:**
- `SimpleString` has `node_id: Option<NodeId>` field
- `DeflatedSimpleString::inflate()` calls `ctx.next_id()` but does NOT record any spans
- `ExportCollector` cannot look up spans, so it searches the source string

**Target State:**
- `DeflatedSimpleString::inflate()` records `ident_span` via `ctx.record_ident_span()`
- `ExportCollector` looks up spans via `node_id` from `PositionTable`
- String search code and `search_from` cursor removed

##### Tasks {#step-5b-tasks}

**Part A: Record Spans During Inflation**
- [x] In `expression.rs`, update `DeflatedSimpleString::inflate()` to compute and record `ident_span`
- [x] The span should be the full token span: `(tok.start_pos.byte_idx(), tok.end_pos.byte_idx())`
- [x] Call `ctx.record_ident_span(node_id, Span { start, end })`

**Part B: Update ExportCollector to Use PositionTable**
- [x] Add `PositionTable` reference to `ExportCollector` (already present but unused for this)
- [x] Update `extract_string_literal()` to look up `SimpleString.node_id` in PositionTable
- [x] Compute content_span by subtracting quote prefix/suffix lengths from ident_span
- [x] Remove `search_from` field from `ExportCollector`
- [x] Remove string search code from `parse_simple_string()`
- [x] Rename or refactor `parse_simple_string()` to reflect new purpose (span computation only)

**Part C: Update ExportCollector Assignment Visitors**
- [x] Remove `__all__` position search logic from `visit_assign()`
- [x] Remove `__all__` position search logic from `visit_ann_assign()`
- [x] Remove `__all__` position search logic from `visit_aug_assign()`

##### Implementation Details {#step-5b-implementation}

**Change 1: `expression.rs` - Record span during SimpleString inflation**

```rust
impl<'r, 'a> Inflate<'a> for DeflatedSimpleString<'r, 'a> {
    type Inflated = SimpleString<'a>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        // Assign identity for this SimpleString node
        let node_id = ctx.next_id();

        // Record the token span (full string including quotes)
        ctx.record_ident_span(
            node_id,
            Span {
                start: self.tok.start_pos.byte_idx(),
                end: self.tok.end_pos.byte_idx(),
            },
        );

        let lpar = self.lpar.inflate(ctx)?;
        let rpar = self.rpar.inflate(ctx)?;
        Ok(Self::Inflated {
            value: self.tok.string,
            lpar,
            rpar,
            node_id: Some(node_id),
        })
    }
}
```

**Change 2: `exports.rs` - Remove string search, use PositionTable**

```rust
impl<'a, 'pos> ExportCollector<'a, 'pos> {
    /// Get the span of a SimpleString from the PositionTable.
    fn get_string_span(&self, s: &SimpleString<'_>) -> Option<Span> {
        let positions = self.positions?;
        let node_id = s.node_id?;
        let pos = positions.get(&node_id)?;
        pos.ident_span
    }

    /// Compute content span by stripping quotes from the full span.
    fn compute_content_span(&self, value: &str, full_span: Option<Span>) -> Option<(String, Span)> {
        // Determine quote prefix/suffix lengths
        let (prefix_len, suffix_len) = Self::quote_lengths(value)?;

        // Extract content
        if value.len() < prefix_len + suffix_len {
            return None;
        }
        let content = &value[prefix_len..value.len() - suffix_len];

        // Compute content span from full span
        let span = full_span?;
        let content_span = Span {
            start: span.start + prefix_len,
            end: span.end - suffix_len,
        };

        Some((content.to_string(), content_span))
    }
}
```

##### Tests {#step-5b-tests}

**Existing tests must continue to pass:**
- [x] `test_export_simple_all_list`
- [x] `test_export_annotated_all`
- [x] `test_export_augmented_all`
- [x] `test_export_span_content`
- [x] All other export tests

**New tests to add:**
- [x] `test_simplestring_has_ident_span` - Verify SimpleString nodes have ident_span in PositionTable
- [x] `test_export_duplicate_strings` - Ensure duplicate string literals get correct distinct spans

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` (compilation succeeds)
- [x] `cargo nextest run -p tugtool-python-cst export` (all export tests pass)
- [x] `cargo nextest run -p tugtool-python-cst` (full crate - no regressions)
- [x] Verify: `search_from` is removed from ExportCollector (grep returns empty)
- [x] Verify: String search code is removed (no `.find(value)` pattern in exports.rs)

**Verification:**
```bash
grep -n "search_from" crates/tugtool-python-cst/src/visitor/exports.rs
# Should return empty

grep -n "\.find(value)" crates/tugtool-python-cst/src/visitor/exports.rs
# Should return empty
```

**Rollback:** Revert commit

---

#### Step 5C: Add node_id to Remaining Compound Statements {#step-5c}

**Commit:** `feat(python-cst): add node_id to For, While, Try, TryStar, With, Match compound statements`

**References:** CST infrastructure audit (2026-01-28)

**Artifacts:**
- Modified `For`, `While`, `Try`, `TryStar`, `With`, `Match` structs with `node_id` field
- Modified corresponding `Deflated*::inflate()` implementations to call `ctx.next_id()`

##### Problem Statement {#step-5c-problem}

The `If` struct has a `node_id` field (added in Step 5) which enables span lookup for isinstance-based type narrowing. Other compound statements lack this capability:

| Statement | Has `node_id`? | Potential Future Use |
|-----------|----------------|---------------------|
| `If` | Yes (Step 5) | isinstance narrowing branch spans |
| `For` | **No** | Iterator variable type tracking |
| `While` | **No** | Loop invariant tracking |
| `Try` | **No** | Exception handler type narrowing |
| `TryStar` | **No** | Exception group handling |
| `With` | **No** | Context manager `as` binding types |
| `Match` | **No** | Pattern matching type narrowing |

Adding `node_id` now creates infrastructure parity and enables future enhancements without additional struct changes.

##### Strategy {#step-5c-strategy}

For Phase 11E, we ONLY add the `node_id` field and generate IDs during inflation. We do NOT record any spans yet (no `ctx.record_*` calls) - those can be added in future phases when specific use cases arise.

This is the minimal change to establish infrastructure parity:
1. Add `node_id: Option<NodeId>` field to each struct
2. Call `ctx.next_id()` at the start of `inflate()`
3. Include `node_id: Some(node_id)` in the returned struct

##### Tasks {#step-5c-tasks}

**Part A: Add node_id to For**
- [x] Add `pub node_id: Option<NodeId>` field to `For` struct
- [x] Update `DeflatedFor::inflate()` to call `let node_id = ctx.next_id();` at start
- [x] Add `node_id: Some(node_id)` to the `Ok(Self::Inflated { ... })` return

**Part B: Add node_id to While**
- [x] Add `pub node_id: Option<NodeId>` field to `While` struct
- [x] Update `DeflatedWhile::inflate()` to call `let node_id = ctx.next_id();` at start
- [x] Add `node_id: Some(node_id)` to the `Ok(Self::Inflated { ... })` return

**Part C: Add node_id to Try**
- [x] Add `pub node_id: Option<NodeId>` field to `Try` struct
- [x] Update `DeflatedTry::inflate()` to call `let node_id = ctx.next_id();` at start
- [x] Add `node_id: Some(node_id)` to the `Ok(Self::Inflated { ... })` return

**Part D: Add node_id to TryStar**
- [x] Add `pub node_id: Option<NodeId>` field to `TryStar` struct
- [x] Update `DeflatedTryStar::inflate()` to call `let node_id = ctx.next_id();` at start
- [x] Add `node_id: Some(node_id)` to the `Ok(Self::Inflated { ... })` return

**Part E: Add node_id to With**
- [x] Add `pub node_id: Option<NodeId>` field to `With` struct
- [x] Update `DeflatedWith::inflate()` to call `let node_id = ctx.next_id();` at start
- [x] Add `node_id: Some(node_id)` to the `Ok(Self::Inflated { ... })` return

**Part F: Add node_id to Match**
- [x] Add `pub node_id: Option<NodeId>` field to `Match` struct
- [x] Update `DeflatedMatch::inflate()` to call `let node_id = ctx.next_id();` at start
- [x] Add `node_id: Some(node_id)` to the `Ok(Self::Inflated { ... })` return

##### Implementation Details {#step-5c-implementation}

**Pattern (same for all 6 statements):**

```rust
// 1. Add field to struct (e.g., For)
#[cst_node]
pub struct For<'a> {
    pub target: AssignTargetExpression<'a>,
    pub iter: Expression<'a>,
    pub body: Suite<'a>,
    // ... existing fields ...

    pub(crate) async_tok: Option<TokenRef<'a>>,
    pub(crate) for_tok: TokenRef<'a>,
    pub(crate) in_tok: TokenRef<'a>,
    pub(crate) colon_tok: TokenRef<'a>,

    /// Stable identity assigned during inflation.
    pub node_id: Option<NodeId>,  // NEW
}

// 2. Update inflate implementation
impl<'r, 'a> Inflate<'a> for DeflatedFor<'r, 'a> {
    type Inflated = For<'a>;
    fn inflate(mut self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        // Assign identity for this For node
        let node_id = ctx.next_id();  // NEW: at start of function

        // ... existing inflation code unchanged ...

        Ok(Self::Inflated {
            target,
            iter,
            body,
            orelse,
            asynchronous,
            leading_lines,
            whitespace_after_for,
            whitespace_before_in,
            whitespace_after_in,
            whitespace_before_colon,
            node_id: Some(node_id),  // NEW
        })
    }
}
```

##### Tests {#step-5c-tests}

**Verification tests (ensure node_id is assigned):**
- [x] `test_for_has_node_id` - For statement has node_id after parsing
- [x] `test_while_has_node_id` - While statement has node_id after parsing
- [x] `test_try_has_node_id` - Try statement has node_id after parsing
- [x] `test_try_star_has_node_id` - TryStar statement has node_id after parsing
- [x] `test_with_has_node_id` - With statement has node_id after parsing
- [x] `test_match_has_node_id` - Match statement has node_id after parsing

**Regression tests:**
- [x] All existing parsing tests continue to pass
- [x] All existing codegen tests continue to pass

**Checkpoint:**
- [x] `cargo build -p tugtool-python-cst` (compilation succeeds)
- [x] `cargo nextest run -p tugtool-python-cst` (all tests pass)
- [x] `cargo nextest run --workspace` (no regressions in dependent crates)

**Verification (ensure all compound statements have node_id):**

```bash
# Should show node_id field in each struct
grep -A 20 "pub struct For<" crates/tugtool-python-cst/src/nodes/statement.rs | grep node_id
grep -A 15 "pub struct While<" crates/tugtool-python-cst/src/nodes/statement.rs | grep node_id
grep -A 15 "pub struct Try<" crates/tugtool-python-cst/src/nodes/statement.rs | grep node_id
grep -A 15 "pub struct TryStar<" crates/tugtool-python-cst/src/nodes/statement.rs | grep node_id
grep -A 20 "pub struct With<" crates/tugtool-python-cst/src/nodes/statement.rs | grep node_id
grep -A 20 "pub struct Match<" crates/tugtool-python-cst/src/nodes/statement.rs | grep node_id

# All should return lines containing "node_id: Option<NodeId>"
```

**Rollback:** Revert commit

---

#### Step 6: Implement NarrowingContext and Integration {#step-6}

**Commit:** `feat(python): implement isinstance-based type narrowing`

**References:** [D03] isinstance Type Narrowing Architecture (#d03-isinstance-narrowing), [D09] Narrowing Context Scope Binding (#d09-narrowing-scope-binding)

**Artifacts:**
- New `type_narrowing.rs` module
- `NarrowingContext` struct
- `type_of_with_narrowing` function
- Span-based narrowing scope checking
- Integration with cst_bridge

**Tasks:**
- [ ] Create `crates/tugtool-python/src/type_narrowing.rs`
- [ ] Implement `NarrowingContext` with narrow/get methods
- [ ] Implement `type_of_with_narrowing` function
- [ ] Implement span-based scope checking: check if site_span ⊆ branch_span (per D09)
- [ ] Apply span check for both attribute accesses and call sites
- [ ] Integrate IsInstanceCollector into cst_bridge analysis
- [ ] Add optional `NarrowingContext` parameter to `resolve_receiver_path`
- [ ] Use `type_of_with_narrowing` inside receiver resolution for Name steps
- [ ] Export from lib.rs

**Tests:**
- [ ] Unit: NarrowingContext::narrow stores narrowing
- [ ] Unit: NarrowingContext::get_narrowed_type retrieves narrowing
- [ ] Unit: type_of_with_narrowing returns narrowed type when available
- [ ] Unit: type_of_with_narrowing falls back to tracker when not narrowed
- [ ] Integration: isinstance(x, Handler) narrows x to Handler in branch
- [ ] Integration: Narrowing does not persist outside if-branch (span check)

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python narrowing`
- [ ] `cargo nextest run -p tugtool-python isinstance`

**Rollback:** Revert commit

---

#### Step 7: End-to-End Integration Tests {#step-7}

**Commit:** `test(python): add Phase 11E integration tests`

**References:** All design decisions

**Artifacts:**
- Comprehensive integration test fixtures
- Tests covering all three gaps

**Tasks:**
- [ ] Create test fixtures for function-level imports
- [ ] Create test fixture for function-level star import ambiguity
- [ ] Create test fixtures for generic container subscripts
- [ ] Create test fixtures for isinstance narrowing
- [ ] Add integration tests that verify full resolution chains
- [ ] Add regression tests for existing behavior
- [ ] Update CLAUDE.md with Phase 11E features

**Tests:**
- [ ] Integration: Full rename operation with function-level imported type
- [ ] Integration: Method call resolution through List subscript
- [ ] Integration: Method call resolution after isinstance check
- [ ] Regression: All Phase 11D tests still pass

**Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] `cargo clippy --workspace -- -D warnings`
- [ ] `cargo fmt --all --check`

**Rollback:** Revert commit

---

#### Step 7 Summary {#step-7-summary}

After completing Steps 1-7, you will have:
- Function-level imports tracked with proper scope paths
- Scope-chain lookup for imports respecting Python's scoping rules
- Generic type parameter extraction for common container types
- Subscript expression resolution using element types
- isinstance detection and collection from conditional expressions
- Type narrowing within if-branches after isinstance checks
- Comprehensive test coverage for all three gaps

**Final Checkpoint:**
- [ ] `cargo nextest run --workspace` - all tests pass
- [ ] `cargo clippy --workspace -- -D warnings` - no warnings
- [ ] Documentation updated in CLAUDE.md

---

### 11E.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three specific gaps in Python type resolution plugged: function-level imports, generic type parameter extraction, and isinstance-based type narrowing.

#### Phase Exit Criteria {#exit-criteria}

- [ ] Function-level imports are tracked and resolvable within their defining scope
- [ ] `List[Handler]` subscript access resolves element type to `Handler`
- [ ] `isinstance(x, Handler)` narrows `x` to `Handler` within the if-branch
- [ ] All existing Phase 11D tests continue to pass
- [ ] CLAUDE.md updated with Phase 11E features and limitations

**Acceptance Tests:**
- [ ] Integration: Function-level import enables type resolution
- [ ] Integration: Container subscript enables method resolution
- [ ] Integration: isinstance enables method resolution in branch

#### Roadmap / Follow-ons {#roadmap}

**Deferred per Phase 11E decisions:**
- [ ] Support early-return narrowing patterns (Q03 deferral)
- [ ] Extend isinstance narrowing to elif/else branches
- [ ] Implement complement types for else-branch narrowing
- [ ] Attribute narrowing: `isinstance(self.attr, Type)` (D04 simplification)
- [ ] Comprehension scope narrowing: `[h for h in items if isinstance(h, Handler)]` (D04 simplification)

**Future enhancements:**
- [ ] Add type guard support (`TypeGuard`, `TypeIs`)
- [ ] Support nested generic extraction (`List[Dict[str, Handler]]`)
- [ ] Union type method resolution (try each member, succeed if any resolves)

| Checkpoint | Verification |
|------------|--------------|
| Function-level imports | `cargo nextest run -p tugtool-python import` |
| Element type extraction | `cargo nextest run -p tugtool-python extract` |
| isinstance narrowing | `cargo nextest run -p tugtool-python narrowing` |
| Full integration | `cargo nextest run --workspace` |

---
