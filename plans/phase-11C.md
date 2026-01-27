## Phase 11C: Enhanced Type Inference and Scope Tracking {#phase-11c}

**Purpose:** Address remaining gaps from Phase 11/11B by implementing step-by-step receiver resolution for dotted paths, proper nested class scope tracking, and improved type inference for method call resolution.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | implementation-ready |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-01-26 |
| Prior phases | Phase 11 (FactsStore Architectural Improvements), Phase 11B (Implementation Gaps) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 11 and 11B successfully implemented the FactsStore architectural improvements including visibility, exports, adapter trait, semantic facts, and cross-file symbol resolution. However, the post-11B review documented three remaining limitations that reduce refactoring fidelity for complex Python code:

1. **Symbol resolution for `base_symbol_index` and `callee_symbol_index` requires type inference** - Currently these fields are only populated when the receiver is a simple variable name with a known type. Method calls on complex expressions or untyped variables have no resolution.

2. **Nested class handling uses simplified boolean tracking** - The analyzer tracks class context but doesn't properly track multiple levels of nesting or provide accurate scope context for inner classes accessing outer class attributes.

3. **Receiver resolution limited to simple names** - `resolve_receiver_to_symbol` only works for simple names like `obj` in `obj.method()`. Dotted paths like `self.field.method()` and call results like `get_obj().method()` are not resolved.

These limitations impact rename operations when working with nested class structures, chained method calls, and attribute access on instance attributes.

#### Strategy {#strategy}

- **Incremental enhancement**: Build on existing infrastructure rather than replacing it
- **Step-by-step receiver resolution**: Implement chained type resolution for dotted paths
- **Scope stack for nested classes**: Replace boolean flag with proper nesting depth tracking
- **Attribute type tracking**: Extend TypeTracker to track instance attribute types (class-level + __init__)
- **Structured receiver paths**: Collect receiver segments from CST to avoid string heuristics
- **Constructor semantics**: Treat `ClassName()` as returning the class type
- **Return type precedence**: Use the most precise type source available (TypeNode > annotation)
- **Scope-aware lookup**: Resolve local symbols using scope-aware maps to avoid shadowing bugs
- **Callable attribute handling**: Resolve `obj.callable_attr()` when attr is typed as `Callable`
- **Clear limitation documentation**: Document what remains impossible without full type inference
- **Comprehensive test coverage**: Add tests that explicitly verify the enhanced behaviors and their limits
- **Fail-fast for unsupported patterns**: Return `None` clearly rather than producing incorrect results

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code agent (primary consumer of tug refactoring)
2. Tugtool developers extending analysis capabilities
3. Users depending on reliable rename operations for complex class hierarchies

#### Success Criteria (Measurable) {#success-criteria}

- [ ] `resolve_receiver_to_symbol("self.handler")` resolves when `self` has known type and `handler` is a typed attribute
- [ ] `resolve_receiver_to_symbol("get_obj()")` resolves when `get_obj` has a return type annotation
- [ ] Nested class scope tracking reports accurate nesting depth for inner classes
- [ ] `self.attr.method()` resolves `base_symbol_index` when attribute type is known
- [ ] `self.handler.process()` resolves via class-level annotation when `__init__` lacks type info
- [ ] `Handler().process()` resolves without requiring an explicit return annotation
- [ ] Chained call receiver (`factory().create().process()`) resolves via return types when annotated
- [ ] `obj.callable_attr()` resolves when `callable_attr: Callable[..., T]` is annotated
- [ ] Tests cover at least 5 distinct dotted path patterns with expected resolutions
- [ ] Tests cover nested class scenarios with inner class accessing outer class attributes
- [ ] Documentation explicitly lists patterns that cannot be resolved statically

#### Scope {#scope}

**Receiver Resolution Enhancement (Finding 3):**
1. Extend `resolve_receiver_to_symbol` to handle dotted paths step-by-step
2. Add attribute type lookup to TypeTracker
3. Handle call expression receivers via return type inference
4. Add support for `self.attr` patterns using class definition analysis
5. Add structured receiver-path extraction in CST visitors (avoid string parsing)

**Type Inference Improvement (Finding 1):**
6. Track instance attribute types from class-level annotations and `__init__` assignments
7. Use return type annotations for call expression type inference (TypeNode preferred)
8. Propagate types through simple attribute chains (including call returns)

**Scope Tracking Enhancement (Finding 2):**
9. Replace `in_nested_class` boolean with scope depth counter
10. Track class nesting path for accurate inner class scope context
11. Support inner class attribute access patterns

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full flow-sensitive type inference (conditionals, loops)
- Type inference across function boundaries without annotations
- Generic type parameter resolution (e.g., `List[T]` -> `T`)
- Duck typing or protocol-based type inference
- Type inference for dynamically added attributes
- Inheritance-based method resolution (MRO)
- Property decorator resolution
- Type narrowing from isinstance checks
- External type stub (`.pyi`) support

#### Dependencies / Prerequisites {#dependencies}

- Phase 11 complete (FactsStore architectural improvements)
- Phase 11B complete (implementation gaps addressed)
- TypeTracker infrastructure operational with Level 1-3 inference
- CrossFileSymbolMap functional for cross-file resolution

#### Constraints {#constraints}

- **No full type system**: We're enhancing pattern-based inference, not building a type checker
- **Static analysis only**: No runtime information, no actual execution
- **Performance**: No significant regression in analysis speed
- **Breaking changes allowed**: Prefer correctness and completeness over compatibility
- **Behavioral stability**: Existing resolution behavior must not regress

#### Assumptions {#assumptions}

- Instance attributes assigned in `__init__` represent the canonical attribute types
- Class-level annotations represent intended instance attribute types
- Return type annotations are accurate and sufficient for call expression inference
- Chained attribute access follows predictable patterns (`self.a.b` style)
- Inner classes are relatively rare in typical Python codebases

---

### Clarifying Questions (Answered) {#clarifying-questions}

#### Q-A: Where exactly does `self.attr = ...` detection need to happen?

**Answer:** Detection happens in the **TypeInferenceCollector** (`crates/tugtool-python-cst/src/visitor/type_inference.rs`). Currently it only processes `AssignTargetExpression::Name` targets. We need to add a branch for `AssignTargetExpression::Attribute` where the receiver is a `Name("self")` or `Name("cls")`. The collector must:
1. Detect that the target is `self.attr` (Attribute with Name receiver)
2. Extract the attribute name
3. Emit an AssignmentInfo with new fields: `is_self_attribute: true`, `attribute_name: Some("attr")`
4. Include the class name from scope_path (second-to-last element when in `__init__`)

#### Q-B: When is TypeNode available vs just annotation string? How to get canonical names?

**Answer:** TypeNode is available when the annotation is processed by the **AnnotationCollector** (`crates/tugtool-python-cst/src/visitor/annotation.rs`). The collector builds `TypeNode` from the CST during collection time, stored in `AnnotationInfo.type_node`. For class-level attribute annotations (source_kind: "attribute"), the TypeNode captures canonical names. To get canonical names from TypeNode, use `TypeNode::name()` for simple types or traverse the structure for generics. When TypeNode is unavailable (e.g., string annotations, forward references), fall back to `type_str`.

#### Q-C: Where is implicit self typing implemented? How do explicit annotations override?

**Answer:** Implicit self/cls typing is implemented in the **AnnotationCollector** (`crates/tugtool-python-cst/src/visitor/annotation.rs`). When visiting a method parameter named "self" or "cls", the collector emits an annotation with:
- `annotation_kind: "implicit"`
- `type_str` set to the enclosing class name (from scope_path)
- `source_kind: "parameter"`

Explicit annotations override implicit ones through TypeTracker's precedence: annotated types (explicit) are stored separately from inferred types, and `type_of()` checks annotated_types first. No code change is needed for precedence; it's already enforced.

#### Q-D: Should ReceiverPath be emitted for Read/Write contexts, or just Call?

**Answer:** ReceiverPath should be emitted for **all contexts** (Read, Write, Call) in `AttributeAccessInfo`. The receiver path is needed to resolve the type chain regardless of how the final attribute is accessed. For example, `self.handler.data = value` (Write) needs the same resolution as `self.handler.data` (Read) or `self.handler.process()` (Call). CallSiteInfo also needs `receiver_path` for resolving chained calls like `factory().create()`.

#### Q-E: How does TypeTracker access FileAnalysis.signatures? New method? New parameter?

**Answer:** TypeTracker will access signatures via a new method `process_signatures(&mut self, signatures: &[SignatureInfo])` called from `analyze_types_from_analysis()` in `crates/tugtool-python/src/type_tracker.rs`. This method iterates over signatures, extracting method return types into a new field `method_return_types: HashMap<(String, String), String>` keyed by `(class_name, method_name)`. The class_name comes from the signature's scope_path (element before the method name).

#### Q-F: Does ScopeTracker replace ScopeCollector or is it additional?

**Answer:** ScopeTracker is **additional** to ScopeCollector, not a replacement. ScopeCollector (`crates/tugtool-python-cst/src/visitor/scope.rs`) collects scope hierarchy (module/class/function nesting) for the analysis result. ScopeTracker is a lightweight shared component used **within** individual visitors (TypeInferenceCollector, AttributeAccessCollector, AnnotationCollector) to maintain consistent class stack information. Each visitor instantiates its own ScopeTracker (or uses shared code) to track scope_path identically. The existing scope_path tracking in each visitor IS the ScopeTracker pattern; this step ensures they all use the SAME logic for class stack construction.

---

### Open Questions {#open-questions}

#### [Q01] How deep should dotted path resolution go? (DECIDED) {#q01-dotted-depth}

**Question:** Should we limit the depth of dotted path resolution (e.g., `a.b.c.d`)?

**Why it matters:** Arbitrarily deep chains increase complexity and risk of incorrect inference.

**Options:**
- Option A: Unlimited depth - resolve as far as type information allows
- Option B: Limited to 4 segments (e.g., `self.field.attr.method`) - covers common patterns
- Option C: Limited to 2 levels (e.g., `self.field`) - minimal change

**Plan to resolve:** Analyze Temporale codebase for common patterns.

**Decision:** Option B. Most real-world patterns are 2-4 segments. Deeper chains often involve external types we can't track anyway.

#### [Q02] Should `self` type be implicit or explicit? (DECIDED) {#q02-self-type}

**Question:** Should `self` in methods automatically have the class type, or require explicit annotation collection?

**Why it matters:** Implicit handling simplifies common patterns but may be fragile.

**Resolution:** ALREADY IMPLEMENTED with precedence clarified: explicit annotations (if present) override implicit self/cls typing inferred from scope path. No change needed beyond documenting the precedence.

#### [Q03] How to handle attribute shadowing? (DECIDED) {#q03-attribute-shadowing}

**Question:** When a method has a local variable with the same name as an instance attribute, which wins?

**Why it matters:** Incorrect resolution could cause rename to miss or include wrong references.

**Decision:** Option B (context-aware). This matches Python semantics exactly: `self.x` accesses instance attribute, bare `x` accesses local/closure/global.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Type propagation introduces incorrect resolutions | high | med | Add tests for false positive cases; conservative `None` returns | Any rename produces incorrect edits |
| Performance regression from chain resolution | med | low | Limit depth; cache intermediate results | >10% slowdown on Temporale |
| Scope tracking changes break existing tests | med | med | Run full suite after each change; update golden files | Any test failure |
| Attribute type collection misses assignments | med | med | Focus on `__init__` patterns; document limitations | Missing expected resolutions |
| Inner class patterns rarely used in practice | low | high | Document; don't over-engineer | Demand materializes |
| Constructor call inference incorrect | med | low | Treat `ClassName()` as class type only when ClassName resolves to a class symbol | Constructor chains mis-resolve |

**Risk R01: ReceiverPath Extraction Complexity** {#r01-complexity}

- **Risk:** Step 1a LOC estimate of 140 may be low given the complexity of CST traversal
- **Actual estimate:** ~200 lines for Step 1a (ReceiverPath types + CST extraction + tests)
- **Mitigation:**
  - Break extraction into helper functions
  - Add unit tests for each CST pattern independently
  - Document edge cases where extraction fails gracefully

**Risk R02: Type Precedence Rules Scattered** {#r02-precedence}

- **Risk:** Type precedence (TypeNode > annotation > constructor > propagation) may be enforced in multiple places
- **Mitigation:**
  - Document precedence in TypeTracker rustdoc (single source of truth)
  - TypeTracker.type_of() is the single enforcement point
  - attribute_type_of() follows same pattern

**Risk R03: `__init__` Detection Brittleness** {#r03-init-detection}

- **Risk:** Edge cases may break `__init__` detection: decorated `__init__`, async `__init__`, nested class `__init__`
- **Mitigation:**
  - Detect `__init__` by scope_path pattern: `[..., ClassName, "__init__"]`
  - Decorated `__init__` still has the same scope_path - decorators don't change function name
  - Async `__init__` is invalid Python; if encountered, fail gracefully
  - Nested class `__init__` uses full scope_path: `[..., OuterClass, InnerClass, "__init__"]`
- **Decision:** `__new__` is NOT considered for attribute types (it returns an instance but doesn't set attributes idiomatically)

**Risk R04: Breaking Changes to Data Structures** {#r04-breaking-changes}

- **Risk:** New fields on existing structs may break serialization/deserialization
- **Mitigation:** See Migration Notes section below

---

### Migration Notes {#migration-notes}

#### Data Structure Changes

**AssignmentInfo** (`crates/tugtool-python-cst/src/visitor/type_inference.rs`):
```rust
pub struct AssignmentInfo {
    // ... existing fields ...

    /// True if this assignment targets `self.attr` (instance attribute).
    /// Default: false for backward compatibility.
    #[serde(default)]
    pub is_self_attribute: bool,

    /// Attribute name when is_self_attribute is true (e.g., "handler" for `self.handler = ...`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribute_name: Option<String>,
}
```

**AttributeAccessInfo** (`crates/tugtool-python-cst/src/visitor/attribute_access.rs`):
```rust
pub struct AttributeAccessInfo {
    // ... existing fields ...

    /// Structured receiver path for resolution.
    /// None for expressions that cannot be represented as steps.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_path: Option<ReceiverPath>,
}
```

**CallSiteInfo** (`crates/tugtool-python-cst/src/visitor/call_site.rs`):
```rust
pub struct CallSiteInfo {
    // ... existing fields ...

    /// Structured receiver path for method calls (e.g., `obj.method()` or `factory().create()`).
    /// None for simple function calls without a receiver.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_path: Option<ReceiverPath>,
}
```

**TypeTracker** (`crates/tugtool-python/src/type_tracker.rs`):
```rust
pub struct TypeTracker {
    // ... existing fields ...

    /// Map from (class_name, attribute_name) to attribute type info.
    /// Stores both string and optional TypeNode for callable return extraction.
    /// Populated from class-level annotations and `self.attr = ...` in __init__.
    attribute_types: HashMap<(String, String), AttributeTypeInfo>,

    /// Map from (class_name, method_name) to return type.
    /// Populated from signature collector (return annotations).
    method_return_types: HashMap<(String, String), String>,
}
```

**AttributeTypeInfo** (`crates/tugtool-python/src/types.rs`):
```rust
/// Type information for a class attribute, including both string representation
/// and optional structured TypeNode for callable return extraction.
pub struct AttributeTypeInfo {
    pub type_str: String,
    pub type_node: Option<TypeNode>,
}
```

#### Backward Compatibility

All new fields use `#[serde(default)]` or `#[serde(skip_serializing_if = "Option::is_none")]` to maintain backward compatibility with existing JSON serialization. Old JSON without these fields will deserialize correctly with default values.

#### Legacy Field Handling

The existing `receiver: String` field in `AttributeAccessInfo` is PRESERVED for backward compatibility and debugging. Resolution code should prefer `receiver_path` when present, falling back to string parsing of `receiver` only if `receiver_path` is None.

---

### ReceiverPath Data Flow Diagram {#receiver-path-diagram}

```
                                    CST Parsing
                                        |
                                        v
    +-------------------------------------------------------------------+
    |                    AttributeAccessCollector                        |
    |  visit_attribute() / visit_call()                                  |
    |    |                                                               |
    |    +-> extract_receiver_path(expr) -> Option<ReceiverPath>         |
    |          |                                                         |
    |          |  Match expression type:                                 |
    |          |    Name("self")        -> [Name("self")]                |
    |          |    Name("obj")         -> [Name("obj")]                 |
    |          |    Attribute(a, "b")   -> extract(a) + [Attr("b")]      |
    |          |    Call(f, args)       -> extract(f) + [Call]           |
    |          |    Subscript(_)        -> None (unsupported)            |
    |          |    other               -> None (unsupported)            |
    |                                                                    |
    +-------------------------------------------------------------------+
                                        |
                                        v
                    AttributeAccessInfo.receiver_path: Option<ReceiverPath>
                    CallSiteInfo.receiver_path: Option<ReceiverPath>
                                        |
                                        v
    +-------------------------------------------------------------------+
    |                       PythonAdapter                                |
    |  resolve_receiver_path()                                           |
    |    |                                                               |
    |    +-> Walk ReceiverPath steps:                                    |
    |          |                                                         |
    |          |  Step 1: Name("self")                                   |
    |          |    -> type = scope_path class name (implicit self type) |
    |          |                                                         |
    |          |  Step 2: Attr("handler")                                |
    |          |    -> type = TypeTracker.attribute_type_of(type, "handler")
    |          |                                                         |
    |          |  Step 3: Attr("process") + Call                         |
    |          |    -> treat "process" as method name, NOT attribute     |
    |          |    -> type = TypeTracker.method_return_type_of(type, "process")
    |          |                                                         |
    |          |  Final: Resolve type to ResolvedSymbol                  |
    |                                                                    |
    +-------------------------------------------------------------------+
                                        |
                                        v
                        ResolvedSymbol (Local or CrossFile)
                                        |
                                        v
                        base_symbol_index / callee_symbol_index populated
```

**Example Resolutions:**

(Note: For brevity, `Name("x")` is shorthand for `Name { value: "x" }` and `Attr("x")` for `Attr { value: "x" }`)

| Expression | ReceiverPath | Resolution Chain |
|------------|--------------|------------------|
| `self.handler.process()` | `[Name("self"), Attr("handler"), Attr("process"), Call]` | self->MyClass (implicit), handler->Handler (attribute_type_of), process is method (attr lookup fails), Call resolves Handler.process |
| `get_handler().process()` | `[Name("get_handler"), Call, Attr("process"), Call]` | get_handler is function (via symbol_kinds), Call->Handler (return_type_of), process is method, Call resolves Handler.process |
| `factory().create().run()` | `[Name("factory"), Call, Attr("create"), Call, Attr("run"), Call]` | factory is function->Product (return_type_of), create is method->Widget (method_return_type_of), run is method->Result |
| `Handler()` | `[Name("Handler"), Call]` | Handler is class (via symbol_kinds), Call returns Handler (constructor semantics) |
| `obj` | `[Name("obj")]` | Single-element path, resolves obj's type directly |
| `data[0].method()` | `None` (subscript unsupported) | Falls back to legacy string-based receiver |

**Detailed Algorithm Trace for `self.handler.process()`:**

```
Input: ReceiverPath { steps: [Name("self"), Attr("handler"), Attr("process"), Call] }
       scope_path: ["<module>", "Service", "run"]
       symbol_kinds: { "Handler": Class, "Service": Class, ... }

Step 1: Name("self")
  - tracker.type_of(scope_path, "self") -> Some("Service") [implicit self type]
  - current_type = Some("Service")
  - is_class_in_scope("self", symbol_kinds) -> false
  - last_name_was_class = false
  - last_name_is_unresolved_callable = false

Step 2: Attr("handler")
  - current_type = Some("Service")
  - "Service" in symbol_map? -> yes (local)
  - tracker.attribute_type_of("Service", "handler") -> Some("Handler")
  - current_type = Some("Handler")  [attribute found - update type]
  - last_method_name = None  [clear because attribute found]

Step 3: Attr("process")
  - current_type = Some("Handler")
  - "Handler" in symbol_map? -> yes (local)
  - tracker.attribute_type_of("Handler", "process") -> None  [process is method, not attribute]
  - current_type = Some("Handler")  [UNCHANGED - key fix!]
  - last_method_name = Some("process")  [store for Call step]

Step 4: Call
  - current_type = Some("Handler")
  - last_method_name = Some("process")
  - tracker.method_return_type_of("Handler", "process") -> determines final type
  - OR: resolve Handler.process as the symbol

Final: resolve_type_to_symbol("Handler", ...) -> ResolvedSymbol::Local(handler_index)
```

**Detailed Algorithm Trace for `factory().create()`:**

```
Input: ReceiverPath { steps: [Name("factory"), Call, Attr("create"), Call] }
       scope_path: ["<module>"]
       symbol_kinds: { "factory": Function, "Product": Class, ... }

Step 1: Name("factory")
  - tracker.type_of(scope_path, "factory") -> None [factory is function name, not typed variable]
  - current_type = Some("factory")  [store name itself]
  - is_class_in_scope("factory", symbol_kinds) -> false [it's a function]
  - last_name_was_class = false
  - last_name_is_unresolved_callable = true  [function that wasn't typed variable]

Step 2: Call
  - current_type = Some("factory")
  - last_name_is_unresolved_callable = true
  - tracker.return_type_of(scope_path, "factory") -> Some("Product")
  - current_type = Some("Product")
  - Clear flags

Step 3: Attr("create")
  - current_type = Some("Product")
  - "Product" in symbol_map? -> yes
  - tracker.attribute_type_of("Product", "create") -> None [create is method]
  - current_type = Some("Product")  [UNCHANGED]
  - last_method_name = Some("create")

Step 4: Call
  - current_type = Some("Product")
  - last_method_name = Some("create")
  - tracker.method_return_type_of("Product", "create") -> Some("Widget")
  - current_type = Some("Widget")

Final: resolve_type_to_symbol("Widget", ...) -> appropriate symbol
```

---

### 11C.0 Design Decisions {#design-decisions}

#### [D01] Step-by-Step Receiver Resolution (DECIDED) {#d01-step-resolution}

**Decision:** Extend `resolve_receiver_to_symbol` to iteratively resolve dotted paths by looking up each segment's type.

**Algorithm:**
```rust
fn resolve_receiver_path(
    &self,
    receiver_path: &ReceiverPath,
    scope_path: &[String],
    tracker: &TypeTracker,
    symbol_map: &HashMap<(Vec<String>, String), usize>,
    symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
    cross_file_map: Option<&CrossFileSymbolMap>,
) -> Option<ResolvedSymbol> {
    if receiver_path.steps.is_empty() || receiver_path.steps.len() > MAX_RESOLUTION_DEPTH {
        return None;
    }

    let mut current_type: Option<String> = None;
    let mut last_method_name: Option<&str> = None;
    let mut last_name_was_class: bool = false;
    let mut last_name_is_unresolved_callable: bool = false;
    let mut pending_callable_return: Option<String> = None;

    for step in &receiver_path.steps {
        match step {
            ReceiverStep::Name(name) => {
                if let Some(type_str) = tracker.type_of(scope_path, name) {
                    // Found typed variable
                    current_type = Some(type_str.to_string());
                    last_name_was_class = is_class_in_scope(scope_path, name, symbol_kinds);
                    last_name_is_unresolved_callable = false;
                } else {
                    // Not a typed variable - could be function or class name
                    // Store the name itself for return_type lookup in Call step
                    current_type = Some(name.to_string());
                    last_name_was_class = is_class_in_scope(scope_path, name, symbol_kinds);
                    last_name_is_unresolved_callable = !last_name_was_class; // Function if not class
                }
                // Clear pending_callable_return - Name step starts fresh
                pending_callable_return = None;
            }
            ReceiverStep::Attr(attr_name) => {
                if let Some(ref class_type) = current_type {
                    // Check if current_type is cross-file BEFORE continuing
                    // Use scope-aware lookup to walk outward through scopes
                    if lookup_symbol_index_in_scope_chain(scope_path, class_type, symbol_map).is_none()
                        || lookup_symbol_kind_in_scope_chain(scope_path, class_type, symbol_kinds)
                            == Some(SymbolKind::Import)
                    {
                        // Not a local symbol - check cross-file
                        if let Some(ref map) = cross_file_map {
                            if let Some(qn) = map.resolve_to_qualified_name(class_type) {
                                return Some(ResolvedSymbol::CrossFile(qn));
                            }
                        }
                        return None; // Can't resolve - type not found locally or cross-file
                    }

                    // Look up attribute type on current class.
                    // If this Attr is followed by Call, treat it as method name (handled in Call step).
                    if let Some(attr_type) = tracker.attribute_type_of(class_type, attr_name) {
                        // Attribute type found - update current_type and clear last_method_name
                        current_type = Some(attr_type.type_str.clone());
                        last_method_name = None;
                        pending_callable_return = tracker.callable_return_type_of(attr_type);
                    } else {
                        // Attribute lookup failed - this is likely a method name
                        // Keep current_type UNCHANGED for method call resolution
                        // Set last_method_name for the Call step to use
                        last_method_name = Some(attr_name);
                        pending_callable_return = None;
                    }
                    last_name_was_class = false;
                    last_name_is_unresolved_callable = false;
                } else {
                    return None; // Can't resolve without known type
                }
            }
            ReceiverStep::Call => {
                if let Some(ref class_type) = current_type {
                    // Check if current_type is cross-file BEFORE continuing
                    // Use scope-aware lookup to walk outward through scopes
                    if !last_name_was_class
                        && (lookup_symbol_index_in_scope_chain(scope_path, class_type, symbol_map).is_none()
                            || lookup_symbol_kind_in_scope_chain(scope_path, class_type, symbol_kinds)
                                == Some(SymbolKind::Import))
                    {
                        // Not a local symbol - check cross-file
                        if let Some(ref map) = cross_file_map {
                            if let Some(qn) = map.resolve_to_qualified_name(class_type) {
                                return Some(ResolvedSymbol::CrossFile(qn));
                            }
                        }
                        return None; // Can't resolve - type not found locally or cross-file
                    }

                    if pending_callable_return.is_some() && last_method_name.is_none() {
                        // Callable attribute: use callable return type
                        current_type = pending_callable_return.take();
                    } else if let Some(method_name) = last_method_name {
                        // Method call: lookup method return type
                        current_type = tracker.method_return_type_of(class_type, method_name)
                            .map(|s| s.to_string());
                    } else if last_name_was_class {
                        // Constructor call: ClassName() returns the class type
                        current_type = Some(class_type.to_string());
                    } else if last_name_is_unresolved_callable {
                        // Function call where name wasn't a typed variable
                        // Use return_type_of with the name itself
                        current_type = tracker.return_type_of(scope_path, class_type)
                            .map(|s| s.to_string());
                    } else {
                        // Edge case: typed callable variable that's not a class (e.g., Callable type).
                        // This branch is effectively unreachable in practice since:
                        // - Classes have last_name_was_class = true
                        // - Functions have last_name_is_unresolved_callable = true
                        // - Typed variables with callable types are rare and would need special handling
                        // Fall back to return_type_of as a conservative approach.
                        current_type = tracker.return_type_of(scope_path, class_type)
                            .map(|s| s.to_string());
                    }
                    // Clear all state flags at end of Call step
                    last_method_name = None;
                    last_name_was_class = false;
                    last_name_is_unresolved_callable = false;
                    pending_callable_return = None;
                } else {
                    return None;
                }
            }
        }
    }

    // Resolve final type to symbol
    current_type.and_then(|t| self.resolve_type_to_symbol(&t, symbol_map, cross_file_map))
}

/// Helper function to look up a symbol's kind by walking outward through the scope chain.
/// Returns the SymbolKind of the closest matching symbol, or None if not found.
/// This ensures that inner-scope definitions shadow outer-scope definitions.
fn lookup_symbol_kind_in_scope_chain(
    scope_path: &[String],
    name: &str,
    symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
) -> Option<SymbolKind> {
    // Walk outward from innermost scope to module scope
    for depth in (0..=scope_path.len()).rev() {
        let key = (scope_path[..depth].to_vec(), name.to_string());
        if let Some(kind) = symbol_kinds.get(&key) {
            return Some(*kind);
        }
    }
    None
}

/// Helper function to look up a symbol's index by walking outward through the scope chain.
/// Returns the symbol index of the closest matching symbol, or None if not found.
fn lookup_symbol_index_in_scope_chain(
    scope_path: &[String],
    name: &str,
    symbol_map: &HashMap<(Vec<String>, String), usize>,
) -> Option<usize> {
    for depth in (0..=scope_path.len()).rev() {
        let key = (scope_path[..depth].to_vec(), name.to_string());
        if let Some(index) = symbol_map.get(&key) {
            return Some(*index);
        }
    }
    None
}

/// Helper function to check if a name refers to a class in the current scope.
/// Uses lookup_symbol_kind_in_scope_chain for consistent scope-aware lookup.
fn is_class_in_scope(
    scope_path: &[String],
    name: &str,
    symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
) -> bool {
    lookup_symbol_kind_in_scope_chain(scope_path, name, symbol_kinds) == Some(SymbolKind::Class)
}
```

**Rationale:**
- Builds on existing TypeTracker infrastructure
- Natural extension of single-segment resolution
- Fails gracefully when any segment's type is unknown
- Correctly handles method names vs attribute names by NOT updating current_type when attribute lookup fails
- Handles function names that aren't typed variables via `last_name_is_unresolved_callable`
- Uses `symbol_kinds` map to determine class vs function semantics (not TypeTracker)
- Stops at cross-file types mid-chain and returns `CrossFile` or `None`

**Implications:**
- Add `attribute_type_of` method to TypeTracker
- Add `method_return_type_of` method to TypeTracker
- Update `resolve_receiver_to_symbol` to call new method for dotted paths
- Tests for 1, 2, and 3+ segment paths
- **Build `symbol_kinds: HashMap<(Vec<String>, String), SymbolKind>` during `convert_file_analysis`** (see Symbol Inventory)
- **Build `symbol_map: HashMap<(Vec<String>, String), usize>` during `convert_file_analysis`** (see Symbol Inventory)
- Add `is_class_in_scope(scope_path, name, symbol_kinds)` helper function (NOT a TypeTracker method)
- Ensure `resolve_type_to_symbol` uses `lookup_symbol_index_in_scope_chain` (scope-aware)
- Treat Attr followed by Call as method name (attribute_type_of returning None triggers this)
- Treat Name followed by Call as constructor when Name resolves to class type via symbol_kinds

#### [D02] Attribute Type Tracking (DECIDED) {#d02-attribute-types}

**Decision:** Extend TypeTracker to track instance attribute types from class-level annotations and `__init__` assignments.

**Data Structure:**
```rust
// In TypeTracker
struct TypeTracker {
    // Existing fields...

    /// Map from (class_name, attribute_name) to attribute type info.
    /// Stores both string and optional TypeNode for callable return extraction.
    /// Populated from class-level annotations and `self.attr = ...` in __init__.
    attribute_types: HashMap<(String, String), AttributeTypeInfo>,
}
```

**Collection Rules (highest priority first):**
1. **Class-level annotation**: `class C: attr: TypeName` records `(C, "attr") -> "TypeName"`
2. **Instance annotation**: `self.attr: TypeName = ...` in `__init__` (or class body) records `(C, "attr") -> "TypeName"`
3. **Constructor assignment**: `self.attr = TypeName()` in `__init__` records `(C, "attr") -> "TypeName"`
4. **Assignment from typed var**: `self.attr = other_var` in `__init__` propagates known type of `other_var`
5. **Fallback**: if none apply, no attribute type is recorded

**Source Files:**
- Class-level annotations: Already collected by AnnotationCollector with `source_kind: "attribute"`
- Instance assignments: Need to extend TypeInferenceCollector to detect `self.attr = ...`

**Rationale:**
- Class-level annotations are common in typed Python and are unambiguous
- `__init__` is the canonical place for instance attribute definition
- Covers the majority of typed attribute patterns
- Simple to implement with existing CST collectors

**Implications:**
- Extend TypeInferenceCollector to recognize `self.attr = ...` and `self.attr: TypeName = ...`
- Index class-level annotations from AnnotationCollector into `(class, attr)` keys
- Preserve TypeNode when available (store in AttributeTypeInfo for callable return extraction)
- Add `attribute_type_of(class: &str, attr: &str) -> Option<&AttributeTypeInfo>` method
- Track scope path to identify class and `__init__` context

#### [D03] Call Expression Receiver Resolution (DECIDED) {#d03-call-receiver}

**Decision:** Resolve call expression receivers using the best available return type source (TypeNode if present, otherwise annotation string).

**Algorithm:**
```rust
fn resolve_call_step(
    &self,
    current_type: &str,
    method_name: Option<&str>,
    scope_path: &[String],
    tracker: &TypeTracker,
) -> Option<String> {
    match method_name {
        Some(name) => {
            // Method call: lookup method return type on class
            tracker.method_return_type_of(current_type, name)
                .map(|s| s.to_string())
        }
        None => {
            // Function call: lookup function return type
            tracker.return_type_of(scope_path, current_type)
                .map(|s| s.to_string())
        }
    }
}
```

**Rationale:**
- Return type annotations are increasingly common in typed Python
- TypeNode can provide canonical type names when available
- Level 3 TypeTracker already collects function return types
- Natural extension of existing infrastructure

**Implications:**
- Populate `method_return_types` from signature collector
- Add path in `resolve_receiver_path` to handle Call steps
- Tests for `get_obj().method()` and chained call patterns

#### [D04] Nested Class Scope Depth Tracking (DECIDED) {#d04-scope-depth}

**Decision:** Track class nesting as a stack of class names rather than a boolean flag.

**Class Detection Approach:**

Class detection uses the `symbol_kinds` map (same map used in D01), NOT scope_path string filtering. The scope_path itself is just `Vec<String>` with no type information embedded.

For Phase 11C, we use two complementary approaches:
1. **At resolution time**: Use `symbol_kinds: HashMap<(Vec<String>, String), SymbolKind>` built from `FileAnalysis.symbols` to determine if a name is a class (scope-aware)
2. **During collection**: ScopeCollector already tracks scope type (module/class/function) internally and can provide class depth

**Data Structure:**
```rust
// Shared pattern used by TypeInferenceCollector, AttributeAccessCollector, AnnotationCollector
// Each collector already has scope_path: Vec<String>
// Class depth is tracked by ScopeCollector during traversal, not derived from strings

// Built during convert_file_analysis from FileAnalysis.symbols
let symbol_kinds: HashMap<(Vec<String>, String), SymbolKind> = analysis.symbols
    .iter()
    .map(|s| ((s.scope_path.clone(), s.name.clone()), s.kind))
    .collect();

// Helper trait for scope_path navigation
impl ScopePathHelpers for Vec<String> {
    fn current_class(
        &self,
        symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
    ) -> Option<&str> {
        // Walk backwards through scope_path and use the scope-aware lookup helper.
        for name in self.iter().rev() {
            if lookup_symbol_kind_in_scope_chain(self, name, symbol_kinds)
                == Some(SymbolKind::Class)
            {
                return Some(name.as_str());
            }
        }
        None
    }

    fn enclosing_class(
        &self,
        symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
    ) -> Option<&str> {
        let mut found_first = false;
        for name in self.iter().rev() {
            if lookup_symbol_kind_in_scope_chain(self, name, symbol_kinds)
                == Some(SymbolKind::Class)
            {
                if found_first {
                    return Some(name.as_str());
                }
                found_first = true;
            }
        }
        None
    }
}
```

**Rationale:**
- Stack naturally models lexical nesting
- Provides accurate depth and access to enclosing class names
- Supports arbitrarily deep nesting (though rare in practice)
- Already implicitly tracked via scope_path in existing collectors
- Uses `symbol_kinds` map for reliable class detection (not string heuristics)

**Implications:**
- Verify all collectors build scope_path consistently
- Build `symbol_kinds` map during `convert_file_analysis` (see Symbol Inventory)
- Add helper methods for class depth extraction that accept `symbol_kinds`
- Tests for doubly-nested classes

#### [D05] Resolution Depth Limit (DECIDED) {#d05-depth-limit}

**Decision:** Limit dotted path resolution to 4 segments maximum.

**Constant:**
```rust
/// Maximum depth for chained attribute resolution.
/// Deeper chains are uncommon and often involve external types.
const MAX_RESOLUTION_DEPTH: usize = 4;
```

**Rationale:**
- Common patterns are 1-3 segments (`obj`, `self.field`, `self.field.attr`)
- 4 allows for `self.manager.handler.process` patterns
- Deeper chains likely involve types we can't track anyway
- Prevents infinite loops or pathological performance

**Implications:**
- Add depth check in resolution loop
- Return `None` if depth exceeded
- Document the limit in rustdoc

#### [D06] Structured Receiver Path (DECIDED) {#d06-receiver-path}

**Decision:** Collect a structured receiver path from CST instead of relying on string parsing. This makes chained call and dotted resolution correct by construction.

**Data Structure:**
```rust
/// A single step in a receiver path.
///
/// Serde representation uses adjacently tagged enum format for clear JSON output:
/// - Name: `{"type": "name", "value": "self"}`
/// - Attr: `{"type": "attr", "value": "handler"}`
/// - Call: `{"type": "call"}`
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReceiverStep {
    /// Simple name: `self`, `obj`, `factory`
    Name { value: String },
    /// Attribute access: `.handler`, `.process`
    Attr { value: String },
    /// Function/method call: `()`
    Call,
}

/// Structured receiver path extracted from CST.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ReceiverPath {
    pub steps: Vec<ReceiverStep>,
}
```

**Example Encodings (Rust):**
- `self.handler.process()` -> `[Name { value: "self" }, Attr { value: "handler" }, Attr { value: "process" }, Call]`
- `get_handler().process()` -> `[Name { value: "get_handler" }, Call, Attr { value: "process" }, Call]`
- `factory().create().process()` -> `[Name { value: "factory" }, Call, Attr { value: "create" }, Call, Attr { value: "process" }, Call]`

**Example JSON Serialization:**
```json
// self.handler.process()
{
  "steps": [
    {"type": "name", "value": "self"},
    {"type": "attr", "value": "handler"},
    {"type": "attr", "value": "process"},
    {"type": "call"}
  ]
}
```

**Rationale:**
- Preserves call vs attribute boundaries
- Enables correct step-by-step type propagation
- Avoids ambiguity from string heuristics (`"<call>"`, `"<expr>"`)

**Implications:**
- Extend AttributeAccessInfo / CallSiteInfo to carry `receiver_path`
- Update CST visitors to emit structured receiver steps
- Update resolution to consume `ReceiverPath` instead of receiver string

#### [D07] Resolution Precedence and Type Sources (DECIDED) {#d07-precedence}

**Decision:** Define explicit precedence for type sources at each resolution step.

**Precedence (highest first):**
1. **TypeNode-derived type** (canonical name from structured TypeNode)
2. **Explicit annotation string**
3. **Constructor inference** (`self.attr = TypeName()`)
4. **Assignment propagation** (`self.attr = other_var`)

**Rationale:**
- TypeNode captures canonical names and avoids string ambiguity
- Explicit annotations should override inference
- Constructor inference is the most reliable dynamic signal
- Assignment propagation is last-resort

**Implications:**
- TypeTracker already enforces annotated > inferred precedence
- attribute_types uses same pattern (annotation source > inferred source)
- Document precedence in rustdoc

#### [D08] Call Resolution for Methods and Functions (DECIDED) {#d08-call-resolution}

**Decision:** Resolve call steps based on the *current type context*:

- If the previous step resolves to a **function name**, use function return type
- If the previous step resolves to a **class type** and the step before was `Attr(name)`, resolve the **method return type** on that class

**Method Return Source:**
- Prefer signature return type collected in `analysis.signatures`
- Fall back to TypeTracker return type for top-level functions only

**Implications:**
- Add `TypeTracker.method_return_types: HashMap<(class, method), String>`
- Populate from signature collector (already in Phase 11)
- Add helper `method_return_type_of(class, method)`
- Add `TypeTracker.is_class_type(name)` for constructor handling

#### [D09] Cross-File Attribute Type Resolution (DECIDED) {#d09-cross-file}

**Decision:** For Phase 11C, cross-file attribute type resolution returns `ResolvedSymbol::CrossFile` when the intermediate type in a chain is defined in another file. Full resolution is deferred to future work.

**Import boundary:** If the intermediate type is an `Import` symbol in the current file,
stop chain resolution and return `ResolvedSymbol::CrossFile` (if qualified name is resolvable)
or `None` (conservative).

**Example:**
```python
# file_a.py
class Handler:
    def process(self): ...

# file_b.py
from file_a import Handler
class Service:
    handler: Handler  # Type is cross-file

    def run(self):
        self.handler.process()  # Resolution stops at Handler (cross-file)
```

**Behavior:**
- When `attribute_type_of("Service", "handler")` returns "Handler"
- And "Handler" is not in the current file's symbol map
- Return `ResolvedSymbol::CrossFile { qualified_name: "file_a.Handler" }` if resolvable
- Otherwise return `None` (conservative, no false positives)
- **Stop chain resolution** when a cross-file symbol appears mid-chain; do not attempt
  to resolve method returns or deeper attributes across files in Phase 11C.

**Rationale:**
- Full cross-file chain resolution requires loading and analyzing the target file
- This is a significant performance and complexity increase
- Phase 11C focuses on within-file resolution; cross-file is documented as limitation

#### [D10] Callable Attribute Resolution (DECIDED) {#d10-callable-attrs}

**Decision:** When an attribute is annotated as `Callable[..., T]`, treat
`obj.callable_attr()` as a callable invocation and use `T` as the resulting type.

**Rules:**
- If `attribute_type_of(class, attr)` returns `AttributeTypeInfo` with `TypeNode::Callable { returns }`,
  use `returns` as the type for the Call step.
- If `TypeNode` is missing but `type_str` is a `Callable[...]` annotation, attempt a
  minimal parse to extract the return type; otherwise return `None` (conservative).
- If the attribute is not callable, fall back to method/constructor logic as usual.

**Limitation:** Callable return extraction only handles **simple named return types**.
Complex return types (e.g., `Callable[..., Union[A, B]]` or `Callable[..., List[T]]`)
return `None` unless a simple `TypeNode::Named` is available.

**Implementation Pseudocode:**
```rust
impl TypeTracker {
    /// Extract the return type from a Callable type annotation.
    /// Returns Some(return_type) if the type is Callable[..., T], None otherwise.
    pub fn callable_return_type_of(type_info: &AttributeTypeInfo) -> Option<String> {
        // Prefer TypeNode if available (most precise)
        if let Some(TypeNode::Callable { returns, .. }) = &type_info.type_node {
            // Extract type name from the returns TypeNode
            return returns.as_ref().and_then(|r| r.name());
        }

        // Fall back to parsing type_str for "Callable[..., ReturnType]" pattern
        // This is a conservative parse - return None if uncertain
        let type_str = &type_info.type_str;
        if type_str.starts_with("Callable[") && type_str.ends_with("]") {
            // Find the last comma that separates params from return type
            // Handle nested brackets: Callable[[int, str], Handler]
            let inner = &type_str[9..type_str.len()-1]; // Strip "Callable[" and "]"
            if let Some(last_comma) = find_top_level_comma(inner) {
                let return_part = inner[last_comma + 1..].trim();
                if !return_part.is_empty() && return_part != "None" {
                    return Some(return_part.to_string());
                }
            }
        }

        None // Conservative: return None if we can't extract return type
    }
}
```

**Implications:**
- Add `TypeTracker.callable_return_type_of(type_info: &AttributeTypeInfo) -> Option<String>`
- Update `resolve_receiver_path` to use `pending_callable_return` when set
- Add tests for callable attributes (Fixture 11C-F13)

---

### 11C.1 Specification {#specification}

#### 11C.1.1 Inputs and Outputs {#inputs-outputs}

**Inputs:**
- Python source files
- TypeTracker with:
  - Variable types (existing)
  - Annotated types (existing)
  - Return types (existing)
  - Attribute types (new)
  - Method return types (new)
- CrossFileSymbolMap for cross-file resolution
- Structured `ReceiverPath` from CST collectors
- Consistent class stack scope paths across collectors

**Outputs:**
- Enhanced `base_symbol_index` / `base_symbol_qualified_name` for dotted receivers
- Enhanced `callee_symbol_index` / `callee_symbol_qualified_name` for call receivers
- Accurate scope path and class stack for nested class contexts

**Key Invariants:**
- Resolution depth never exceeds `MAX_RESOLUTION_DEPTH`
- `None` is returned rather than incorrect resolution
- Existing simple-name resolution behavior is preserved
- Constructor calls resolve to class type only when class symbol is known

#### 11C.1.2 Terminology {#terminology}

- **Dotted receiver**: A receiver expression with multiple segments separated by dots (e.g., `self.handler`)
- **Call receiver**: A receiver that is a function call result (e.g., `get_obj()`)
- **Receiver path**: Structured steps extracted from CST representing Name/Attr/Call
- **Attribute type**: The type of an instance attribute, typically inferred from `__init__`
- **Class stack**: The list of enclosing class names for nested class tracking
- **Resolution depth**: The number of segments in a dotted path being resolved

#### 11C.1.3 Supported Features {#supported-features}

**Supported Patterns:**
- `obj.method()` - simple receiver (existing)
- `self.method()` - self receiver with implicit class type
- `self.field.method()` - dotted path through instance attribute
- `self.field.attr.method()` - deeper dotted path (up to 4 segments)
- `self.attr.method()` resolved via class-level annotation when `__init__` is untyped
- `get_obj().method()` - call receiver with return type annotation
- `factory().create().process()` - chained calls with return types
- Inner class accessing outer class via explicit reference
- `obj.callable_attr()` - callable attribute via `Callable[..., T]`
 - `Handler().process()` - constructor call resolves when Handler is a class in scope

**Explicitly Not Supported:**
- `items[0].method()` - subscript receivers (returns `<subscript>`)
- `(a or b).method()` - conditional expressions (returns `<expr>`)
- `lambda: x().method()` - lambda bodies
- Dynamically added attributes
- Inherited attributes without explicit type annotation
- Method returns without annotations/signature info
- Generic type parameter resolution
- Unresolvable constructor (class name not resolved in scope)

**Behavior for Unsupported Patterns:**
- `base_symbol_index` / `callee_symbol_index` = `None`
- `base_symbol_qualified_name` / `callee_symbol_qualified_name` = `None`
- Receiver string is preserved for debugging (e.g., `<subscript>`, `<expr>`)

---

### 11C.2 Definitive Symbol Inventory {#symbol-inventory}

#### 11C.2.1 New files {#new-files}

None. All changes are to existing files.

#### 11C.2.2 Modified files {#modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool-python/src/type_tracker.rs` | Add `attribute_types`, `method_return_types` maps; add `attribute_type_of`, `method_return_type_of`, `process_signatures`, `process_instance_attributes` methods |
| `crates/tugtool-python/src/analyzer.rs` | Update `resolve_receiver_to_symbol` for dotted paths using ReceiverPath; add `resolve_receiver_path` method |
| `crates/tugtool-python-cst/src/visitor/type_inference.rs` | Collect `self.attr = ...` patterns; add `is_self_attribute`, `attribute_name` to AssignmentInfo |
| `crates/tugtool-python-cst/src/visitor/attribute_access.rs` | Emit structured `ReceiverPath`; add `ReceiverStep`, `ReceiverPath` types |
| `crates/tugtool-python-cst/src/visitor/call_site.rs` | Add `receiver_path` field to CallSiteInfo |
| `crates/tugtool-python-cst/src/lib.rs` | Re-export `ReceiverStep`, `ReceiverPath` |

#### 11C.2.3 Symbols to add/modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TypeTracker.attribute_types` | field | `type_tracker.rs` | New: Map from (class, attr) to AttributeTypeInfo (string + TypeNode) |
| `TypeTracker.attribute_type_of` | method | `type_tracker.rs` | New: Look up attribute type |
| `TypeTracker.process_instance_attributes` | method | `type_tracker.rs` | New: Collect from `__init__` |
| `TypeTracker.method_return_types` | field | `type_tracker.rs` | New: Map from (class, method) to return type |
| `TypeTracker.method_return_type_of` | method | `type_tracker.rs` | New: Lookup method return type |
| `TypeTracker.process_signatures` | method | `type_tracker.rs` | New: Extract method return types from signatures |
| `TypeTracker.callable_return_type_of` | method | `type_tracker.rs` | New: Extract return type from Callable AttributeTypeInfo |
| `PythonAdapter.resolve_receiver_path` | method | `analyzer.rs` | New: Step-by-step resolution using ReceiverPath |
| `MAX_RESOLUTION_DEPTH` | const | `analyzer.rs` | New: Depth limit = 4 |
| `AssignmentInfo.is_self_attribute` | field | `type_inference.rs` | New: Flag for `self.x = ...` |
| `AssignmentInfo.attribute_name` | field | `type_inference.rs` | New: Attribute name if `is_self_attribute` |
| `ReceiverPath` | struct | `attribute_access.rs` | New: Structured receiver steps |
| `ReceiverStep` | enum | `attribute_access.rs` | New: Name/Attr/Call segments |
| `AttributeAccessInfo.receiver_path` | field | `attribute_access.rs` | New: Structured path |
| `CallSiteInfo.receiver_path` | field | `call_site.rs` | New: Structured path for method calls |
| `symbol_kinds` | local variable | `analyzer.rs` | New: Map from (scope_path, name) to SymbolKind |
| `symbol_map` | local variable | `analyzer.rs` | New: Map from (scope_path, name) to symbol index |
| `lookup_symbol_kind_in_scope_chain` | helper fn | `analyzer.rs` | New: Walk scope chain to find symbol kind |
| `lookup_symbol_index_in_scope_chain` | helper fn | `analyzer.rs` | New: Walk scope chain to find symbol index |
| `is_class_in_scope` | helper fn | `analyzer.rs` | New: Scope-aware class lookup using lookup_symbol_kind_in_scope_chain |

#### 11C.2.4 Building symbol_kinds {#symbol-kinds}

The `symbol_kinds` map is built during `convert_file_analysis` from the `FileAnalysis.symbols` field.
It is **scope-aware**: the key includes the scope_path to avoid name shadowing.

**Important:** This map is built from the internal `Symbol` structs (which have a typed `SymbolKind` enum field),
NOT from `SymbolOutput` strings after JSON conversion. The `Symbol` struct in `tugtool-python/src/types.rs`
has `kind: SymbolKind` as an enum, making this mapping type-safe. The conversion to `SymbolOutput`
(with `kind: String`) happens later during JSON serialization.

**Symbol.scope_path clarification:** The internal `Symbol` struct in `tugtool-python/src/types.rs` has a
`scope_path: Vec<String>` field that captures the lexical scope chain (e.g., `["<module>", "MyClass", "method"]`).
If the internal `Symbol` struct does not currently have this field, it must be added as part of Step 3.
The `SymbolOutput` struct used for JSON output is a separate type and should not be used for building these maps.

**Duplicate key handling:** If there are duplicate `(scope_path, name)` keys (e.g., multiple symbols with the
same name in the same scope), the last one wins (standard HashMap behavior). This is expected and correct.

```rust
// In convert_file_analysis or resolve_receiver_path caller
// Note: Symbol.kind is SymbolKind enum, not a string
let symbol_kinds: HashMap<(Vec<String>, String), SymbolKind> = analysis.symbols
    .iter()
    .map(|s| ((s.scope_path.clone(), s.name.clone()), s.kind))
    .collect();
```

**Lookup rule:** walk `scope_path` outward (innermost → module) to find the closest
matching `(scope_path, name)` entry. This prevents a module-level class from
overriding a local function of the same name.

**Import rule:** if the resolved kind is `Import`, treat it as cross-file and stop
chain resolution (return `ResolvedSymbol::CrossFile` if possible, otherwise `None`).

This map is passed to `resolve_receiver_path` and `is_class_in_scope` for class/function disambiguation.

#### 11C.2.5 Building symbol_map {#symbol-map}

The `symbol_map` is built alongside `symbol_kinds` and is also **scope-aware**:

```rust
let symbol_map: HashMap<(Vec<String>, String), usize> = analysis.symbols
    .iter()
    .enumerate()
    .map(|(idx, s)| ((s.scope_path.clone(), s.name.clone()), idx))
    .collect();
```

Lookup uses `lookup_symbol_index_in_scope_chain` to walk outward through `scope_path`
so inner-scope symbols shadow outer ones.

**Duplicate key handling:** If there are duplicate `(scope_path, name)` keys, the last one wins (standard HashMap behavior). This is expected and correct.

---

### 11C.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md with supported receiver patterns
- [ ] Add rustdoc for `attribute_type_of`, `method_return_type_of`, and resolution depth limit
- [ ] Document `ReceiverPath` format and resolution precedence rules
- [ ] Document unsupported patterns explicitly in module docs
- [ ] Add examples in TypeTracker rustdoc showing attribute type collection

---

### 11C.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual resolution functions | `resolve_receiver_path`, `attribute_type_of` |
| **Integration** | End-to-end analysis with resolution | Complex code patterns, Temporale fixtures |
| **Golden** | Verify output format | Updated adapter output with resolved indices |
| **Regression** | Ensure existing behavior preserved | Run existing test suite |

#### Test Fixtures {#test-fixtures}

**Fixture 11C-F01: Dotted Path Resolution**
```python
# test_dotted_receiver.py
class Handler:
    def process(self): pass

class Service:
    def __init__(self):
        self.handler = Handler()

    def run(self):
        self.handler.process()  # Should resolve to Handler
```

**Fixture 11C-F02: Call Expression Resolution**
```python
# test_call_receiver.py
class Handler:
    def process(self): pass

def get_handler() -> Handler:
    return Handler()

h = get_handler()
h.process()  # Should resolve via return type

get_handler().process()  # Direct call receiver
```

**Fixture 11C-F03: Nested Class**
```python
# test_nested_class.py
class Outer:
    class Inner:
        def method(self): pass

    def use_inner(self):
        inner = self.Inner()
        inner.method()
```

**Fixture 11C-F04: Chained Calls**
```python
# test_chained_calls.py
class Builder:
    def with_name(self, n: str) -> "Builder":
        return self

    def build(self) -> "Product":
        pass

class Product:
    def process(self): pass

Builder().with_name("x").build().process()  # Chain through return types
```

**Fixture 11C-F05: Depth Limit**
```python
# test_depth_limit.py
class A:
    def __init__(self):
        self.b = B()

class B:
    def __init__(self):
        self.c = C()

class C:
    def __init__(self):
        self.d = D()

class D:
    def __init__(self):
        self.e = E()  # 5 levels deep

class E:
    def method(self): pass

a = A()
a.b.c.d.e.method()  # Exceeds MAX_RESOLUTION_DEPTH=4, should return None
a.b.c.d.method()    # 4 levels, should resolve if D has method
```

**Fixture 11C-F06: False Positive Prevention**
```python
# test_false_positive.py
class Handler:
    def process(self): pass

class OtherHandler:
    def process(self): pass

def unknown_factory():  # No return type annotation
    return Handler()

obj = unknown_factory()
obj.process()  # Should NOT resolve (no return type)
```

**Fixture 11C-F07: Annotated Attribute**
```python
# test_annotated_attr.py
class Handler:
    def process(self): pass

class Service:
    handler: Handler  # Type annotation at class level

    def __init__(self):
        self.handler = create_handler()  # No type from RHS

    def run(self):
        self.handler.process()  # Should resolve via annotation
```

**Fixture 11C-F08: Function Call Receiver (Not Typed Variable)**
```python
# test_function_call_receiver.py
class Product:
    def create(self) -> "Widget":
        return Widget()

class Widget:
    def run(self): pass

def factory() -> Product:
    return Product()

# factory is a function NAME, not a typed variable
# factory().create() should resolve via return_type_of("factory")
result = factory().create()  # Should resolve Product.create -> Widget
result.run()                 # Should resolve Widget.run

# Chained: factory().create().run()
factory().create().run()     # Full chain resolution
```

**Fixture 11C-F09: Constructor Call (Class Name)**
```python
# test_constructor_call.py
class Handler:
    def process(self): pass

# Handler is a class NAME
# Handler() should resolve as constructor returning Handler
Handler().process()  # Should resolve: Handler (class) -> Handler (type) -> process method
```

**Fixture 11C-F10: Cross-File Type Mid-Chain**
```python
# test_cross_file_mid_chain.py
# Assumes Handler is imported from another file

from other_module import Handler

class Service:
    handler: Handler

    def run(self):
        # Resolution should stop at Handler (cross-file) and return CrossFile
        self.handler.process()  # handler -> Handler (cross-file), stop here
```

**Fixture 11C-F11: Class/Function Shadowing (Scope-Aware Lookup)**
```python
# test_shadowing_scope.py

class Factory:
    def create(self) -> "Product":
        return Product()

class Product:
    def run(self): pass

def factory() -> Factory:
    return Factory()

def outer():
    # Shadowing: local function name matches class name (Factory)
    def Factory() -> Factory:
        return factory()

    # The Name("Factory") inside outer should resolve to the local function,
    # NOT the class. The Call should therefore use return_type_of("Factory"),
    # not constructor semantics.
    Factory().create().run()
```

**Fixture 11C-F12: Single-Element ReceiverPath**
```python
# test_single_element_receiver.py

class Handler:
    def process(self): pass

def use_handler():
    obj: Handler = Handler()
    # Single-element receiver path: just [Name("obj")]
    # No subsequent Call step in the receiver itself (the .process() is the call being analyzed)
    obj.process()

    # Also test attribute access without call
    data = obj  # Single-element path for reading
```

**Fixture 11C-F13: Callable Attribute**
```python
# test_callable_attribute.py
from typing import Callable

class Handler:
    def process(self): pass

class Service:
    handler_factory: Callable[[], Handler]

    def run(self):
        # callable attribute; should resolve via callable return type
        self.handler_factory().process()
```

**Fixture 11C-F14: cls.attr Pattern (Classmethod)**
```python
# test_cls_attr_classmethod.py
class Service:
    instance: "Service"

    @classmethod
    def get_instance(cls) -> "Service":
        cls.instance = Service()
        return cls.instance
```

**Fixture 11C-F15: Multiple Assignments (Last-Write-Wins)**
```python
# test_multiple_assignments.py
class Handler:
    def __init__(self):
        self.data = "string"  # First assignment
        self.data = 42        # Second assignment - this type wins
```

**Fixture 11C-F16: Nested Class Self Type**
```python
# test_nested_class_self.py
class Outer:
    class Inner:
        def method(self):
            # self should resolve to Inner, not Outer
            return self
```

---

### 11C.5 Execution Steps {#execution-steps}

#### Step 0: Audit Current Receiver Resolution {#step-0}

**Commit:** `chore: audit receiver resolution patterns in Temporale`

**References:** [D01] Step-by-Step Resolution, (#context)

**Tasks:**
- [x] Grep Temporale for `self.attr.method()` patterns
- [x] Count occurrences of dotted receivers in attribute accesses
- [x] Identify most common patterns (2-segment, 3-segment, etc.)
- [x] Document findings in `docs/receiver-patterns.md`

**Artifacts:**
- `docs/receiver-patterns.md`: List of common receiver patterns in real code with frequency analysis

**Tests:**
- N/A (audit step)

**Checkpoint:**
- [x] Pattern analysis documented
- [x] Findings guide depth limit decision

**Rollback:**
- N/A (documentation only)

**LOC Estimate:** 0 (audit)

---

#### Step 0.5: Fix Testing Infrastructure and Analyzer Integration {#step-0-5}

**BLOCKING:** This step MUST be completed before any other Phase 11C work proceeds. The current implementation has critical defects that make all Phase 11C tests unreliable.

**Commit:** `fix(python): correct TypeTracker call order in analyzer and add integration tests`

**References:** [D02] Attribute Type Tracking, (#inputs-outputs)

**Problem Summary:**

A complete audit revealed three critical issues that undermine all Phase 11C testing:

1. **analyzer.rs does NOT call `process_instance_attributes`** - The method exists in TypeTracker but is never invoked in the real analyzer code path (`analyze_files` and `build_type_tracker`).

2. **analyzer.rs has WRONG call order** - It calls `process_assignments` before `process_annotations`, but the correct order (documented in `analyze_types_from_analysis`) is:
   - annotations (highest priority)
   - instance_attributes
   - assignments
   - resolve_types

3. **ALL 49 tests in type_tracker.rs bypass the real code path** - They all create `TypeTracker::new()` directly and call methods manually instead of going through `analyze_file`. This means the tests pass even though the real code path is broken.

4. **ZERO integration tests verify Phase 11C features end-to-end** - No test parses actual Python code with `self.attr = Handler()` patterns and verifies that `analyze_file` produces correct attribute types in the TypeTracker.

5. **The function `analyze_types_from_analysis` has correct order but is NEVER USED** - analyzer.rs duplicates the logic incorrectly instead of calling this function.

**Specific Code Locations:**

**Location 1: `analyzer.rs` lines ~1137-1139 in `analyze_files`:**
```rust
// CURRENT (WRONG - missing process_instance_attributes, wrong order):
tracker.process_assignments(&cst_assignments);
tracker.process_annotations(&cst_annotations);
tracker.resolve_types();

// CORRECT (matches analyze_types_from_analysis):
tracker.process_annotations(&cst_annotations);
tracker.process_instance_attributes(&cst_assignments);
tracker.process_assignments(&cst_assignments);
tracker.resolve_types();
```

**Location 2: `analyzer.rs` lines ~1504-1506 in `build_type_tracker`:**
Same fix needed - wrong order and missing `process_instance_attributes` call.

**Tasks:**

Phase A: Fix the Analyzer Code
- [x] Fix `analyze_files` method in `analyzer.rs` (~line 1137-1139):
  - [x] Change order: call `process_annotations` BEFORE `process_assignments`
  - [x] Add missing call: `tracker.process_instance_attributes(&cst_assignments)` between annotations and assignments
- [x] Fix `build_type_tracker` function in `analyzer.rs` (~line 1504-1506):
  - [x] Same fix: correct order and add `process_instance_attributes` call
- [x] Consider refactoring: have analyzer.rs call `analyze_types_from_analysis` instead of duplicating logic (decision: keep both, document difference - they serve different purposes)

Phase B: Add Integration Tests That Use Real Code Path
- [x] Add integration test `test_analyze_file_tracks_instance_attribute_types`:
  - [x] Parse Python code: `class Service: def __init__(self): self.handler = Handler()`
  - [x] Call `analyze_file` (the REAL code path)
  - [x] Extract TypeTracker from result
  - [x] Assert `attribute_type_of("Service", "handler")` returns `Some("Handler")`
- [x] Add integration test `test_analyze_file_class_annotation_precedence`:
  - [x] Parse Python code with both class-level annotation and `__init__` assignment
  - [x] Verify annotation takes precedence (not assignment)
- [x] Add integration test `test_analyze_file_type_propagation`:
  - [x] Parse: `def setup(h: Handler): self.handler = h`
  - [x] Verify `self.handler` has type "Handler" via propagation

Phase C: Rename/Consolidate
- [x] Rename `analyze_types_from_analysis` to `build_type_tracker` (or keep both and document difference) - DECISION: Removed `analyze_types_from_analysis` entirely; `build_type_tracker` in analyzer.rs is the single implementation
- [x] Document in rustdoc that analyzer.rs uses the correct processing order

**Tests:**

Integration tests (MUST use `analyze_file`, NOT `TypeTracker::new()`):
- [x] `test_analyze_file_tracks_instance_attribute_types` - Parse `self.handler = Handler()`, verify `attribute_type_of` works
- [x] `test_analyze_file_class_annotation_overrides_init` - Class annotation `handler: Handler` takes precedence over `self.handler = create()`
- [x] `test_analyze_file_propagates_parameter_types` - `self.data = source` where `source: Logger` propagates type
- [x] `test_analyze_file_multiple_attributes` - Multiple `self.x = ...` patterns all tracked

Regression tests (verify existing behavior not broken):
- [x] Verify all 49 existing type_tracker.rs tests still pass
- [x] Verify analyzer unit tests still pass
- [x] Verify Temporale fixture tests still pass (via workspace test run)

**Checkpoint:**
- [x] Fix applied to `analyze_files` in analyzer.rs
- [x] Fix applied to `build_type_tracker` in analyzer.rs
- [x] `cargo nextest run -p tugtool-python type_tracker` - all existing tests pass (49 tests)
- [x] `cargo nextest run -p tugtool-python analyzer` - new integration tests pass (239 tests, +4 new)
- [x] `cargo nextest run --workspace` - no regressions (1708 tests passed)
- [x] Manual verification: analyze a Python file with `self.attr = Handler()` and confirm TypeTracker contains the attribute type (verified via integration test)

**Acceptance Criteria:**
- [x] The REAL code path (`analyze_file` -> `analyze_files` -> TypeTracker methods) correctly tracks instance attribute types
- [x] At least 4 new integration tests verify the real code path (not just unit tests with `TypeTracker::new()`)
- [x] Call order in analyzer.rs matches the documented correct order in `analyze_types_from_analysis`
- [x] `process_instance_attributes` is called in the real code path

**Rollback:**
- Revert commit

**LOC Estimate:** ~120 (fixes ~20, integration tests ~100)

---

#### Step 1: Add Attribute Type Infrastructure to TypeTracker {#step-1}

**Commit:** `feat(python): add attribute_types map and attribute_type_of method`

**References:** [D02] Attribute Type Tracking, (#inputs-outputs)

**Tasks:**
- [x] Add `attribute_types: HashMap<(String, String), AttributeTypeInfo>` field to TypeTracker
- [x] Add `attribute_type_of(class: &str, attr: &str) -> Option<&AttributeTypeInfo>` method
- [x] Add `process_instance_attributes` method (empty implementation for now)

**Tests:**
- [x] Unit: `attribute_type_of` returns None for unknown attribute
- [x] Unit: `attribute_type_of(...).type_str` returns type when manually inserted

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python attribute_type`
- [x] `cargo clippy --workspace`

**Rollback:**
- Revert commit

**LOC Estimate:** ~40

---

#### Step 1a: Detect Self-Attribute Patterns in TypeInferenceCollector {#step-1a}

**Commit:** `feat(python-cst): detect self.attr = ... patterns in type inference`

**References:** [D02] Attribute Type Tracking, Q-A

**Tasks:**
- [x] Add `is_self_attribute: bool` field to `AssignmentInfo` (default false)
- [x] Add `attribute_name: Option<String>` field to `AssignmentInfo`
- [x] Update `visit_assign` to detect `AssignTargetExpression::Attribute` targets
- [x] When target is `self.attr` or `cls.attr`, set `is_self_attribute: true` and extract `attribute_name`
- [x] Extract class name from scope_path for `__init__` context detection

**Tests:**
- [x] Unit: `self.handler = Handler()` sets `is_self_attribute: true`, `attribute_name: Some("handler")`
- [x] Unit: `self.handler: Handler = ...` (annotated) also sets flags
- [x] Unit: `other.attr = ...` does NOT set `is_self_attribute`
- [x] Unit: Assignment outside `__init__` still detected (for annotation-based types)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst type_inference`

**Rollback:**
- Revert commit

**LOC Estimate:** ~80

---

#### Step 1b: Process Class-Level Annotations for Attribute Types {#step-1b}

**Commit:** `feat(python): index class-level annotations into attribute_types`

**References:** [D02] Attribute Type Tracking, Q-B

**Tasks:**
- [x] In `TypeTracker.process_annotations`, detect annotations with `source_kind: "attribute"`
- [x] For attribute annotations, extract class name from scope_path
- [x] Insert into `attribute_types` map: `(class_name, attr_name) -> AttributeTypeInfo` (preserve TypeNode when present)
- [x] Respect precedence: annotation overrides inferred

**Tests:**
- [x] Unit: `class C: attr: Handler` -> `attribute_type_of("C", "attr").type_str == "Handler"`
- [x] Unit: Both annotation and inference present -> annotation wins

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python attribute`

**Rollback:**
- Revert commit

**LOC Estimate:** ~50

---

#### Step 1c: Process Instance Attributes from __init__ {#step-1c}

**Commit:** `feat(python): collect instance attribute types from __init__`

**References:** [D02] Attribute Type Tracking

**Tasks:**
- [x] Implement `TypeTracker.process_instance_attributes(assignments: &[AssignmentInfo])`
- [x] Filter for assignments where `is_self_attribute: true`
- [x] Detect `__init__` context from scope_path (ends with `__init__`)
- [x] Extract class name from scope_path (element before `__init__`)
- [x] Apply collection rules: annotation > constructor > propagation
- [x] Store AttributeTypeInfo (type_str + optional TypeNode) for attribute_types entries
- [x] Wire into `analyze_types_from_analysis`

**Tests:**
- [x] Unit: `self.handler = Handler()` in `__init__` -> attribute type_str is "Handler"
- [x] Unit: `self.handler: Handler = create()` -> annotation takes precedence
- [x] Unit: `self.data = other_var` propagates type_str of `other_var`
- [x] Unit: Non-`__init__` self assignments with annotation still recorded
- [x] Integration: Full analysis produces correct attribute types

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python type_tracker`
- [x] `cargo nextest run -p tugtool-python attribute`

**Rollback:**
- Revert commit

**LOC Estimate:** ~80

---

#### Step 1d: Add Method Return Type Tracking {#step-1d}

**Commit:** `feat(python): track method return types from signatures`

**References:** [D08] Call Resolution, Q-E

**Tasks:**
- [ ] Add `method_return_types: HashMap<(String, String), String>` to TypeTracker
- [ ] Add `method_return_type_of(class: &str, method: &str) -> Option<&str>` method
- [ ] Add `process_signatures(signatures: &[SignatureInfo])` method
- [ ] Add `callable_return_type_of(type_info: &AttributeTypeInfo) -> Option<String>` helper
- [ ] For each signature, extract class name from scope_path (if method)
- [ ] Store return type in `method_return_types` if present
- [ ] Wire `process_signatures` into `analyze_types_from_analysis`

**Tests:**
- [ ] Unit: `method_return_type_of` returns type for annotated method
- [ ] Unit: `method_return_type_of` returns None for method without return type
- [ ] Unit: Module-level function return type uses existing `return_types` (not method_return_types)
- [ ] Unit: `callable_return_type_of` extracts return type from `Callable[..., T]`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python method_return`

**Rollback:**
- Revert commit

**LOC Estimate:** ~70

---

#### Step 1e: Remove Dead Code for Obsolete Python Worker {#step-1e}

**Commit:** `chore: remove obsolete Python worker infrastructure`

**References:** CLAUDE.md (Architecture section describes native Rust CST parser)

**Context:** The old Python worker infrastructure was designed for subprocess-based LibCST parsing via IPC. This was replaced with native Rust CST parsing in `tugtool-python-cst`. The worker code was never cleaned up and is now dead code.

**Tasks:**
- [x] Remove `WorkerInfo` struct from `session.rs` (lines ~294-314)
- [x] Remove `register_worker()` method from `Session`
- [x] Remove `get_worker()` method from `Session`
- [x] Remove `is_worker_running()` method from `Session`
- [x] Remove `unregister_worker()` method from `Session`
- [x] Remove `cleanup_stale_workers()` method from `Session`
- [x] Remove `list_workers()` method from `Session`
- [x] Remove `clean_workers()` method from `Session`
- [x] Remove `workers_dir()` method from `Session`
- [x] Remove "Worker Process Tracking" section comment from `session.rs`
- [x] Remove `workers` field from `SessionStatus` struct
- [x] Remove `is_process_running()` helper function from `session.rs`
- [x] Remove `kill_process()` helper function from `session.rs`
- [x] Remove worker-related tests from `session.rs` (`test_worker_registration`, `test_orphan_pid_cleanup`, `test_register_worker_creates_pid_file`, `test_register_worker_atomic_no_orphan_temp`, `test_concurrent_worker_registration`)
- [x] Remove worker hash computation from `SessionVersion::compute()` if present
- [x] Remove "Worker process tracking" from module docstring in `session.rs`
- [x] Remove "workers" from subdirs array in `ensure_session_structure()`
- [x] Remove `WorkerError` variant from `TugError` enum in `error.rs`
- [x] Remove `TugError::WorkerError` mapping in `From<&TugError> for OutputErrorCode`
- [x] Remove `--workers` flag from `Clean` command in `main.rs`
- [x] Update `execute_clean()` to remove worker handling logic
- [x] Remove `workers_cleaned` field from clean output JSON
- [x] Remove test `worker_error_maps_to_exit_code_10` from `main.rs`
- [x] Remove test `parse_clean_workers` from `main.rs`
- [x] Remove `WorkerInfo` from imports in `api_surface.rs`

**Tests to verify removal:**
- [x] Verify `cargo nextest run --workspace` passes (all tests compile and run)
- [x] Verify `cargo clippy --workspace` has no warnings about unused code
- [x] Verify `cargo build --workspace` succeeds
- [x] Verify `tug clean --help` no longer shows `--workers` flag
- [x] Verify `tug session status` JSON output no longer includes `workers` field

**Checkpoint:**
- [x] `cargo nextest run --workspace`
- [x] `cargo clippy --workspace -- -D warnings`
- [x] `cargo build --workspace`

**Rollback:**
- Revert commit

**LOC Estimate:** -350 (removal)

---

#### Step 2: Collect Structured Receiver Paths {#step-2}

**Commit:** `feat(python-cst): emit structured receiver paths for attribute accesses`

**References:** [D06] Structured Receiver Path, (#supported-features)

**Artifacts:**
- `ReceiverPath` / `ReceiverStep` data types
- Attribute access collector emits receiver path
- Call site collector emits receiver path (if applicable)

**Tasks:**
- [x] Add `ReceiverStep` enum and `ReceiverPath` struct to `attribute_access.rs`
- [x] Add `extract_receiver_path(expr: &Expression) -> Option<ReceiverPath>` helper
- [x] Update `AttributeAccessInfo` to include `receiver_path: Option<ReceiverPath>`
- [x] Update `CallSiteInfo` to include `receiver_path: Option<ReceiverPath>`
- [x] Call `extract_receiver_path` in `add_attribute_access` and call site collection
- [x] Keep `receiver` string for display/debugging (resolution uses `receiver_path`)
- [x] Re-export types from `lib.rs`

**Tests:**
- [x] Unit: `self.handler.process()` emits steps `[Name(self), Attr(handler), Attr(process), Call]`
- [x] Unit: `get_handler().process()` emits `[Name(get_handler), Call, Attr(process), Call]`
- [x] Unit: `factory().create().process()` emits correct chain
- [x] Unit: `obj.method()` emits single-element receiver `[Name(obj)]` (Fixture 11C-F12)
- [x] Unit: `data[0].method()` emits `None` (subscript unsupported)
- [x] Unit: `(a or b).method()` emits `None` (expr unsupported)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python-cst receiver`
- [x] `cargo nextest run -p tugtool-python attribute`

**Rollback:**
- Revert commit

**LOC Estimate:** ~200

---

#### Step 3: Implement Dotted Path Resolution {#step-3}

**Commit:** `feat(python): resolve dotted receiver paths step-by-step`

**References:** [D01] Step-by-Step Resolution, [D05] Depth Limit, (#terminology), (#symbol-kinds)

**Artifacts:**
- `resolve_receiver_path` method
- `MAX_RESOLUTION_DEPTH` constant
- `symbol_kinds` map built from FileAnalysis.symbols (scope-aware)
- `symbol_map` map built from FileAnalysis.symbols (scope-aware)
- `lookup_symbol_kind_in_scope_chain` helper function
- `lookup_symbol_index_in_scope_chain` helper function
- `is_class_in_scope` helper function
- Updated `resolve_receiver_to_symbol` to handle dotted paths

**Tasks:**
- [x] Add `MAX_RESOLUTION_DEPTH` constant (= 4)
- [x] Add `lookup_symbol_kind_in_scope_chain` helper
- [x] Add `lookup_symbol_index_in_scope_chain` helper
- [x] Add `is_class_in_scope(scope_path: &[String], name: &str, symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>) -> bool` helper
- [x] Build `symbol_kinds: HashMap<(Vec<String>, String), SymbolKind>` from `analysis.symbols` in `convert_file_analysis` or resolution caller
- [x] Build `symbol_map: HashMap<(Vec<String>, String), usize>` from `analysis.symbols` in `convert_file_analysis` or resolution caller
- [x] Implement `resolve_receiver_path` using `ReceiverPath` steps (see D01 algorithm)
- [x] Update `resolve_receiver_to_symbol` to delegate to `resolve_receiver_path` when `receiver_path` is present
- [x] Handle `self` as first `Name` step (extract class from scope path)
- [x] Add depth limit check with `None` return if exceeded
- [x] Add helper `resolve_type_to_symbol` for final type lookup
- [x] Handle cross-file types mid-chain by returning `ResolvedSymbol::CrossFile` or `None`
- [x] When `attribute_type_of` fails, keep current_type unchanged and set `last_method_name`
- [x] When Name is not a typed variable, check symbol_kinds for class vs function
- [x] Treat Name followed by Call as constructor when Name is class (via symbol_kinds)
- [x] Treat Name followed by Call as function call when Name is function (use return_type_of)

**Tests:**
- [x] Unit: `self.handler` resolves when attribute type known (Fixture 11C-F01) → `resolve_receiver_path_self_handler_resolves_to_handler_type`
- [x] Unit: `self.handler.process` resolves through chain (process is method name, not attribute) → same test
- [x] Unit: `obj.field.method` resolves for non-self receivers → `resolve_receiver_path_single_element_resolves_type`
- [x] Unit: Depth limit exceeded returns None (Fixture 11C-F05) → `resolve_receiver_path_depth_limit_exceeded_returns_none`
- [x] Unit: Unknown intermediate type returns None → `resolve_receiver_path_unknown_intermediate_type_returns_none`
- [x] Unit: Empty receiver path returns None → `resolve_receiver_path_empty_path_returns_none`
- [x] Integration: Service.run() -> self.handler.process() resolves to Handler → `resolve_receiver_path_self_handler_resolves_to_handler_type`
- [x] Unit: `Handler().process()` resolves via constructor semantics (Handler is class) → `resolve_receiver_path_constructor_call_resolves`
- [x] Unit: `factory().create()` resolves via function return type (factory is function) → `resolve_receiver_path_function_return_type_resolves`
- [x] Unit: `factory().create().run()` chains through return types correctly → same test
- [x] Unit: Unknown class `MaybeClass().method()` returns None → `resolve_receiver_path_unknown_class_constructor_returns_none`
- [x] Unit: Cross-file type mid-chain returns CrossFile or None → `resolve_receiver_path_cross_file_type_mid_chain`
- [x] Unit: Single-element path `[Name("obj")]` resolves obj's type directly (Fixture 11C-F12) → `resolve_receiver_path_single_element_resolves_type`
- [x] Regression: Simple receivers still work → `resolve_receiver_path_simple_receivers_still_work`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-python resolve` → 75 tests passed (2026-01-27)
- [x] `cargo nextest run -p tugtool-python dotted` → 2 tests passed (2026-01-27)

**Rollback:**
- Revert commit

**LOC Estimate:** ~150

---

#### Step 4: Implement Call Expression Receiver Resolution {#step-4}

**Commit:** `feat(python): resolve call expression receivers via return type`

**References:** [D03] Call Expression Receiver Resolution, (#supported-features)

**Artifacts:**
- Updated `resolve_receiver_path` to handle Call steps
- Return type lookup integration

**Tasks:**
- [ ] Resolve `Call` steps in `resolve_receiver_path` using [D08] logic
- [ ] For `Name -> Call`, use function return type (lookup via return_types)
- [ ] For `Attr -> Call`, use method return type from `method_return_types`
- [ ] For callable attributes, use `callable_return_type_of` when pending
- [ ] Allow `Call` steps inside dotted chains (e.g., `factory().create().process()`)
- [ ] Return `None` for calls without return types (no false positives)

**Tests:**
- [ ] Unit: `get_handler()` receiver resolves when return type annotated (Fixture 11C-F02)
- [ ] Unit: `get_handler()` returns None when no return type (Fixture 11C-F06)
- [ ] Unit: `factory().create()` chained call resolves (Fixture 11C-F04)
- [ ] Unit: `self.handler_factory().process()` resolves via Callable return type (Fixture 11C-F13)
- [ ] Integration: Full method call `get_handler().process()` -> base_symbol_index set
- [ ] Regression: Non-call simple names still work

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python call`
- [ ] `cargo nextest run -p tugtool-python return_type`

**Rollback:**
- Revert commit

**LOC Estimate:** ~80

---

#### Step 5: Verify Nested Class Scope Tracking {#step-5}

**Commit:** `feat(python): verify nested class scope tracking with class stack`

**References:** [D04] Nested Class Scope Depth Tracking, (#scope)

**Note:** This step verifies that existing scope_path tracking correctly handles nested classes. The class stack is implicit in scope_path.

**Tasks:**
- [ ] Verify all collectors (TypeInferenceCollector, AttributeAccessCollector, AnnotationCollector) use consistent scope_path logic
- [ ] Add helper methods for class depth extraction if needed
- [ ] Verify scope path generation for nested classes is accurate
- [ ] Add tests for doubly-nested class scenarios

**Tests:**
- [ ] Unit: Nested class `Outer.Inner` produces correct scope_path
- [ ] Unit: Inner class method has scope_path `["<module>", "Outer", "Inner", "method"]`
- [ ] Integration: Inner class method references resolve correctly
- [ ] Integration: Doubly-nested class (Outer.Middle.Inner) scope paths correct

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool-python-cst nested`
- [ ] `cargo nextest run -p tugtool-python nested`
- [ ] `cargo nextest run -p tugtool-python scope`

**Rollback:**
- Revert commit

**LOC Estimate:** ~40

---

#### Step 6: Integration Testing and Documentation {#step-6}

**Commit:** `docs: document receiver resolution patterns and limitations`

**References:** (#documentation-plan), (#non-goals)

**Tasks:**
- [ ] Run full test suite including Temporale integration
- [ ] Update CLAUDE.md with supported receiver patterns
- [ ] Add rustdoc examples to TypeTracker for `attribute_type_of` and `method_return_type_of`
- [ ] Document unsupported patterns explicitly in module docs
- [ ] Document `MAX_RESOLUTION_DEPTH` limit
- [ ] Document `ReceiverPath` format and resolution precedence rules
- [ ] Verify no regression in existing resolution behavior
- [ ] Test performance on Temporale (no >10% regression)

**Tests:**
- [ ] Integration: Temporale fixture analysis completes successfully
- [ ] Integration: All existing golden tests pass
- [ ] Performance: Analysis time within acceptable bounds
- [ ] All fixtures 11C-F01 through 11C-F16 pass

**Checkpoint:**
- [ ] `cargo nextest run --workspace`
- [ ] `.tug-test-venv/bin/python -m pytest .tug/fixtures/temporale/tests/ -v`
- [ ] `cargo doc --workspace --no-deps`

**Rollback:**
- Revert commit (docs only)

**LOC Estimate:** ~50 (docs)

---

### 11C.6 Summary Table {#summary-table}

| Finding | Severity | Steps | LOC Estimate |
|---------|----------|-------|--------------|
| **BLOCKING: Analyzer integration broken** | **CRITICAL** | **0.5** | **~120** |
| F3: Receiver limited to simple names | MEDIUM | 1, 1a, 1b, 1c, 1d, 2, 3, 4 | ~750 |
| F1: Type inference for symbol resolution | MEDIUM | 1, 1a, 1b, 1c, 1d, 3, 4 (included) | included above |
| F2: Nested class tracking verification | LOW | 5 | ~40 |
| Dead code: Obsolete Python worker | HYGIENE | 1e | -350 |
| Documentation | - | 6 | ~50 |
| **Total** | | | **~610** |

---

### 11C.7 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Enhanced receiver resolution supporting dotted paths and call expressions with structured receiver paths, attribute type tracking, method return types, and nested class scope handling.

#### Phase Exit Criteria {#exit-criteria}

- [ ] **BLOCKING: Analyzer correctly calls TypeTracker methods** (Step 0.5 complete)
- [ ] **BLOCKING: Integration tests verify real code path** (Step 0.5 complete)
- [ ] `resolve_receiver_to_symbol("self.handler")` works when attribute type is known
- [ ] `resolve_receiver_to_symbol` for call expressions works when return type is annotated
- [ ] Dotted call chains resolve without false positives (`factory().create().process()`)
- [ ] Class-level attribute annotations drive resolution when `__init__` is untyped
- [ ] All existing tests pass (no regression)
- [ ] Temporale integration tests pass
- [ ] Documentation updated with supported patterns and limitations
- [ ] Obsolete Python worker dead code removed (no WorkerInfo, no --workers flag)

**Acceptance tests:**
- [ ] Unit: All new resolution tests pass (Steps 1-5)
- [ ] Integration: All fixtures 11C-F01 through 11C-F16 behave as expected
- [ ] Golden: Adapter output includes resolved indices or qualified names for dotted receivers
- [ ] Regression: Existing resolution behavior unchanged

#### Milestones {#milestones}

**Milestone M00: Testing Infrastructure Fix (BLOCKING)** {#m00-testing-fix}
- [ ] `process_instance_attributes` called in analyzer.rs `analyze_files`
- [ ] `process_instance_attributes` called in analyzer.rs `build_type_tracker`
- [ ] Call order fixed: annotations -> instance_attributes -> assignments -> resolve_types
- [ ] Integration tests verify real code path produces correct attribute types
- [ ] No regressions in existing test suite

**Milestone M01: Attribute Type Collection** {#m01-attr-types}
- [ ] TypeTracker tracks instance attribute types from `__init__`
- [ ] TypeTracker tracks class-level attribute annotations
- [ ] `attribute_type_of` method returns correct types
- [ ] Self-attribute detection works in TypeInferenceCollector

**Milestone M02: Method Return Type Collection** {#m02-method-returns}
- [ ] TypeTracker tracks method return types from signatures
- [ ] `method_return_type_of` method returns correct types

**Milestone M03: Structured Receiver Paths** {#m03-receiver-path}
- [ ] ReceiverPath/ReceiverStep types defined and exported
- [ ] AttributeAccessCollector emits receiver_path
- [ ] CallSiteCollector emits receiver_path
- [ ] Unsupported patterns (subscript, expr) return None

**Milestone M04: Dotted Path Resolution** {#m04-dotted}
- [ ] `self.handler.method()` resolves base_symbol_index
- [ ] Depth limit prevents pathological cases
- [ ] Unknown intermediate types return None gracefully
- [ ] Resolution uses structured `ReceiverPath` (no string heuristics)

**Milestone M05: Call Receiver Resolution** {#m05-call}
- [ ] `get_obj().method()` resolves via return type
- [ ] Chained calls resolve through the chain
- [ ] Missing return types return None (no false positives)
- [ ] Method return types resolved from signatures when available

**Milestone M06: Nested Class Handling** {#m06-nested}
- [ ] Scope tracking uses consistent scope_path across collectors
- [ ] Inner class scope paths are accurate

**Milestone M07: Dead Code Removal** {#m07-dead-code}
- [ ] Obsolete Python worker infrastructure removed from session.rs
- [ ] WorkerError removed from error.rs
- [ ] --workers flag removed from CLI
- [ ] No dead code warnings from clippy

#### Roadmap / Follow-ons {#roadmap}

- [ ] Inheritance-based attribute type lookup (MRO)
- [ ] Property decorator resolution
- [ ] Type narrowing from isinstance checks
- [ ] External type stub (`.pyi`) integration
- [ ] Generic type parameter resolution
- [ ] Full cross-file attribute type resolution (load target file)

---

### 11C.8 Documented Limitations {#documented-limitations}

The following patterns cannot be resolved statically and will return `None`:

| Pattern | Reason | Example |
|---------|--------|---------|
| Subscript receiver | No type for `items[i]` | `items[0].method()` |
| Conditional expression | No static type for `a or b` | `(x or y).method()` |
| Untyped function return | No return annotation | `def f(): return Obj()` |
| Untyped method return | No method return annotation | `obj.method()` where method lacks return type |
| Callable attribute without return | No return in Callable annotation | `obj.cb()` where `cb: Callable[..., Any]` |
| Dynamic attribute | Not in `__init__` | `obj.attr = x` outside `__init__` without annotation |
| Inherited attribute | No MRO traversal | `self.parent_attr` from base class |
| Generic type parameter | No type argument tracking | `List[T]` -> `T` |
| Unresolvable constructor | Class name not resolved | `MaybeClass().method()` |
| Depth > 4 | Intentional limit | `a.b.c.d.e.method()` |
| Lambda body | Complex scoping | `lambda: obj.method()` |
| Comprehension | Complex scoping | `[x.method() for x in items]` |
| Cross-file attribute chain | Requires loading target file | `self.handler.process()` where Handler is imported |

These limitations are fundamental to static analysis without a full type system. Users should ensure their code uses type annotations for the patterns they want resolved.

---

### 11C.9 Post-Phase Verification {#post-verification}

After completing all steps:

1. **Attribute type collection**: Verify `TypeTracker.attribute_type_of` returns correct types for class-level annotations and `__init__` assignments
2. **Method return types**: Verify `TypeTracker.method_return_type_of` returns correct types from signatures
3. **Dotted resolution**: Test `self.handler.method()` patterns resolve correctly
4. **Call resolution**: Test `get_handler().method()` patterns resolve via return type
5. **Depth limit**: Test that 5+ segment paths return None gracefully
6. **Nested classes**: Verify scope paths are accurate for inner classes
7. **ReceiverPath**: Verify structured receiver steps are emitted for chained calls
8. **False positives**: Verify untyped patterns return None, not wrong types
9. **Regression**: Run full test suite, verify no existing tests fail
10. **Performance**: Verify no >10% slowdown on Temporale analysis
11. **Documentation**: Verify limitations are clearly documented in CLAUDE.md and rustdoc

---

### 11C.10 Algorithm Verification Trace-Through {#algorithm-verification}

After making fixes, trace through these examples to verify correctness. Each trace should match the expected behavior.

#### Verification Case 1: `self.handler.process()`

**Setup:**
```python
class Handler:
    def process(self): pass

class Service:
    handler: Handler
    def run(self):
        self.handler.process()
```

**Expected Trace:**
1. `Name("self")`: `type_of("self")` -> "Service" (implicit), `is_class_in_scope("self")` -> false
2. `Attr("handler")`: `attribute_type_of("Service", "handler")` -> "Handler", update current_type, clear last_method_name
3. `Attr("process")`: `attribute_type_of("Handler", "process")` -> None (method!), keep current_type="Handler", set last_method_name="process"
4. `Call`: `method_return_type_of("Handler", "process")` -> return type OR resolve Handler.process

**Expected Result:** Resolves to Handler (or Handler.process depending on final resolution logic)

#### Verification Case 2: `Handler()` (Constructor)

**Setup:**
```python
class Handler:
    def process(self): pass

x = Handler()
```

**Expected Trace:**
1. `Name("Handler")`: `type_of("Handler")` -> None (class name, not variable), store "Handler", `is_class_in_scope("Handler")` -> true via symbol_kinds
2. `Call`: `last_name_was_class` = true, current_type = "Handler" (constructor returns class type)

**Expected Result:** Resolves to Handler class

#### Verification Case 3: `factory().create()` (Function Call)

**Setup:**
```python
class Product:
    def create(self) -> "Widget": ...

class Widget: pass

def factory() -> Product:
    return Product()

factory().create()
```

**Expected Trace:**
1. `Name("factory")`: `type_of("factory")` -> None (function name), store "factory", `is_class_in_scope("factory")` -> false, `last_name_is_unresolved_callable` = true
2. `Call`: `last_name_is_unresolved_callable` = true, `return_type_of(scope_path, "factory")` -> "Product"
3. `Attr("create")`: `attribute_type_of("Product", "create")` -> None (method), keep current_type="Product", last_method_name="create"
4. `Call`: `method_return_type_of("Product", "create")` -> "Widget"

**Expected Result:** Resolves to Widget

#### Verification Case 4: `factory().create().run()` (Chained)

**Setup:** Same as Case 3, plus `Widget.run()` method

**Expected Trace:**
1-4: Same as Case 3, ending with current_type="Widget"
5. `Attr("run")`: `attribute_type_of("Widget", "run")` -> None, keep current_type="Widget", last_method_name="run"
6. `Call`: `method_return_type_of("Widget", "run")` -> return type

**Expected Result:** Chains through correctly

#### Verification Case 5: Cross-File Type Mid-Chain

**Setup:**
```python
from external import Handler  # Handler defined elsewhere

class Service:
    handler: Handler
    def run(self):
        self.handler.process()
```

**Expected Trace:**
1. `Name("self")`: -> "Service"
2. `Attr("handler")`: `attribute_type_of("Service", "handler")` -> "Handler", BUT check symbol_map first
3. In Attr step: "Handler" not in symbol_map (it's imported), check cross_file_map -> return CrossFile

**Expected Result:** Returns `ResolvedSymbol::CrossFile` or None (stops at cross-file boundary)

#### Verification Case 6: Nested Class Self Type

**Setup:**
```python
class Outer:
    class Inner:
        def method(self):
            return self
```

**Input:** `self.method()` inside `Outer.Inner.method`
- scope_path: `["<module>", "Outer", "Inner", "method"]`
- ReceiverPath: `[Name("self")]`

**Expected Trace:**
1. `Name("self")`: `type_of(scope_path, "self")` -> "Inner" (implicit self type from innermost class in scope_path)

**Expected Result:** `self` resolves to type `Inner`, NOT `Outer`. The implicit self type is derived from the innermost class in the scope_path, which is `Inner`.
