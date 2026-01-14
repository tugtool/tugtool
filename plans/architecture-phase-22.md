# Phase 22: Query Algebra Grounding + Materialization Elision

## Executive Summary

Phase 22 establishes **architectural discipline first**, then delivers **meaningful optimizations**. The key insight: `QueryPlan` already IS our logical algebra - we don't need to build a separate layer. We formalize equivalences with **property-based test coverage**, extract handle.rs for maintainability, add mutation elision and expression simplification rules, and **complete the jq-style algebra** with the critical `Explode` operator.

### Execution Order (User Priority)

1. **Handle extraction** - Reduce friction for adding/maintaining operations
2. **Formalized algebra with tests** - Property-based tests for optimization correctness
3. **Mutation elision optimizer** - 5 rules including append chain collapse
4. **Expression infrastructure** - Variables, free_vars(), substitution, ArrayFilter, short-circuit (PREREQUISITE for 22e-22f)
5. **Expression simplification** - Constant folding, boolean simplification (uses short-circuit from 22d)
6. **Explode operator + optimization** - Array expansion with pushdown (uses Variable, free_vars, ArrayFilter from 22d)

### What We're Building

| Deliverable | Impact | Effort |
|-------------|--------|--------|
| Targeted handle.rs extraction | Reduced friction for new ops | Medium |
| Property-based algebra tests | Proven optimization correctness | Medium |
| Mutation elision optimizer (5 rules) | Immediate perf wins | Medium |
| Append chain collapse (new) | Reduces plan complexity for chained mutations | Low |
| **Expression infrastructure** | **Enables all advanced optimizer rules** | **Medium-High** |
| Expression simplification | Boolean/constant folding | Medium |
| **Explode operator + ExplodePushdown** | **100x faster for filtered explodes** | Medium |
| SelectFusion rule | Cleaner query plans | Medium |
| ExplodeFilterFusion rule | Fewer elements produced | Medium |

### What We're Deferring

| Item | Why Defer |
|------|-----------|
| Full Cascades-style optimizer | Plan space too small to justify complexity |
| Python binding generator | Manual bindings more flexible at current scale |
| Cost-based rule selection | No workload data to calibrate |
| Operation registration system | Premature abstraction |
| Members/Descendants expressions | Lower priority, can add later |
| Index introduction rules | Need index infrastructure first |
| `tree_count_hint` for Stored plans | Nice-to-have for mutation elision on stored data |

---

## Part 1: Query Algebra Assessment

### Key Insight: We Already Have an Algebra

The `QueryPlan` enum in `arbors-planner/src/query_plan.rs` **is** a logical algebra:

```rust
pub enum QueryPlan {
    // Sources (base cases)
    InMemory { arbor: Arc<InMemoryArbor> },
    Stored { name: String },

    // Selection operators
    Filter { source, predicate, mode, limit },
    Head { source, n },
    Tail { source, n },
    Take { source, indices },
    Sample { source, n, seed },

    // Order operators
    Sort { source, keys },
    Shuffle { source, seed },
    TopK { source, keys, k },  // Derived: Head(Sort)

    // Shape operators
    Select { source, exprs },
    AddFields { source, fields },

    // Grouping operators
    GroupBy { source, key_expr },
    IndexBy { source, key_expr },
    UniqueBy { source, by },
    Aggregate { source, exprs },

    // Mutation operators
    Append { source, trees },
    Insert { source, position, trees, slot },
    Set { source, index, tree },
    Remove { source, indices },
}
```

### What's Missing: Formalized Equivalences

The 6 existing optimization rules (`FilterFusion`, `FilterSelectivityOrder`, `PredicatePushdown`, `LimitPushdown`, `LimitFusion`, `TopKFusion`) work but are **not documented as algebraic laws**.

**Phase 22 action**: Document each rule as an equivalence with preconditions:

```
LAW: FilterFusion
  Filter(p1, Filter(p2, S)) ≡ Filter(p1 AND p2, S)
  WHEN: neither filter has a limit

LAW: TopKFusion
  Head(k, Sort(keys, S)) ≡ TopK(keys, k, S)
  WHEN: Head is immediate parent of Sort

LAW: LimitPushdown
  Head(n, Filter(p, S)) ≡ Filter(p, S, limit=n)
  WHEN: S is not ordered (no Sort/Shuffle ancestor)
```

### Why Not a Separate Algebra Layer?

Building a separate "logical algebra" type that compiles to `QueryPlan` would:
1. **Double the maintenance burden** - two representations to keep in sync
2. **Add translation overhead** - every operation goes through two layers
3. **Defer optimization** - we can add rules now, not after building infrastructure

The better path: **treat QueryPlan as the algebra, formalize its laws, add rules incrementally**.

---

## Part 1.5: Operator Gap Analysis (Algebra v0 Comparison)

### Semantic Contract (Arbors-Specific)

Arbors operates with these semantics (matching an Algebra v0 **doc-row, lenient, jq-order** variant):

| Aspect | Arbors Choice |
|--------|---------------|
| Row model | **Documents** - each row is one tree |
| Navigation | **Schema-known + mostly-lenient** - missing/non-array paths generally produce `Missing/Null` (not errors); a small set of ops may still error on invalid use (e.g., array index on non-array) |
| Ordering | **Order-preserving** - operators maintain relative order unless explicitly changed |
| Error timing | **Optimizations may eliminate errors** - if a rewrite makes an erroring computation unreachable, it is allowed to remove that error (this matches developer expectations for short-circuiting and predicate pushdown) |
| Determinism | **All expressions are pure** - enables safe rewrites (subject to error-preservation constraints) |

**Important note on optimizations and errors**

Even with pure expressions, some expressions can still error (e.g., invalid operations). In Phase 22 we explicitly allow the optimizer to **eliminate** errors by making erroring computations unreachable (via pushdown, slicing-away, constant folding, etc.).

This means equivalence laws in this doc should be read as **output-equivalence** laws:
- For inputs where both plans succeed, the optimized plan must produce the same output as the unoptimized plan.
- If the unoptimized plan errors, the optimized plan is allowed to either error or succeed (i.e., it may remove the error) if the rewrite makes the erroring work unreachable.

**Constraint: no new errors**

Optimizations must **not introduce new errors** on inputs where the unoptimized plan would have succeeded.

### Current vs Proposed Operators

| Proposed Operator | Current in QueryPlan | Status | Notes |
|-------------------|---------------------|--------|-------|
| `Scan(source)` | `InMemory`/`Stored` | ✅ Present | |
| `Where(pred)` | `Filter` | ✅ Present | |
| `Select(fields)` | `Select` | ✅ Present | |
| `Let(name, expr)` | `AddFields` | 🟡 Partial | AddFields is similar but produces doc, not binding |
| **`Explode(expr, as)`** | `Explodable` trait | ❌ **GAP** | Exists as trait, NOT in QueryPlan |
| `Update(path, value)` | `Expr::WithField` | ✅ Present | At expression level |
| `Path/Field/Index` | `path()` expressions | ✅ Present | |
| `Children(node)` | `.children()` | ✅ Present | At expression level |
| `Members(node)` | Not present | 🔵 Defer | Lower priority |
| `Descendants(node)` | Not present | 🔵 Defer | Lower priority |
| `SelectByIndex` | Not present | 🔵 Defer | Requires index infrastructure |

### Critical Gap: Explode Not in QueryPlan

The `Explodable` trait exists in `arbors-query/src/explode.rs`, but **explode() is called eagerly outside the optimizer**. This prevents:

| Blocked Optimization | Description | Impact |
|---------------------|-------------|--------|
| **C4: Push Where before Explode** | Move filter before expansion when pred doesn't use exploded element | HUGE |
| **C5: Fuse element-local Where** | Push element filter INTO explode sequence | Large |
| **E1: Singleton Explode → Let** | `Explode([v], as=x) → Let(x=v)` | Small |
| **E2: Empty Explode → Empty** | `Explode([], as=x) → Empty` | Small |
| **E3: Fuse nested Explodes** | Flatmap associativity | Medium |

**Example of blocked optimization:**

```python
# Current: explode happens eagerly, filter runs on ALL exploded elements
arbor.explode("items").filter(path("category") == "books")

# With Explode in QueryPlan + C4 rule:
# If "category" is on the document (not the item), filter runs FIRST
# Then only matching documents get exploded - massive savings
```

### Rewrite Rules: Existing vs Proposed

| Proposed Rule | Current Rule | Status |
|---------------|--------------|--------|
| **C1: Combine Where** | `FilterFusion` | ✅ Present |
| **C3: Push Where before Select** | `PredicatePushdown` | ✅ Present |
| **A2: Constant folding** | Not present | 🟢 Add in 22e |
| **A2: Boolean simplification** | Not present | 🟢 Add in 22e |
| **D1: Merge adjacent Select** | Not present | 🟢 Add |
| **D2: Drop unused fields** | Not present | 🔵 Defer (liveness analysis) |
| **E1-E4: Explode rules** | Not present | ❌ Blocked (need Explode op) |
| **F1-F3: Index introduction** | Not present | 🔵 Defer (need index infra) |

**Novel in Arbors (not in proposal):**
- `FilterSelectivityOrder` - Reorder AND predicates by estimated selectivity
- `LimitPushdown` - Push Head limits into Filter
- `LimitFusion` - Fuse Head/Head or Tail/Tail
- `TopKFusion` - Fuse Sort + Head into TopK
- Mutation elision rules (Phase 22c)

### Phase 22 Operator Additions

**HIGH PRIORITY (Phase 22):**

1. **Add `Explode` to QueryPlan**

```rust
/// Expand each tree by evaluating expr to a sequence.
/// Emits one output per element, binding to `as_binding`.
Explode {
    source: Arc<QueryPlan>,
    /// Expression that evaluates to a sequence (array path, .children(), etc.)
    expr: Arc<Expr>,
    /// Binding name for exploded elements
    as_binding: Option<String>,
},
```

2. **Add `ExplodePushdown` optimizer rule**

```rust
/// Push predicates before Explode when they don't reference the exploded binding.
/// LAW: Explode(S, expr, as=x) ∘ Filter(p) ≡ Filter(p) ∘ Explode(S, expr, as=x)
/// WHEN: x not in free_vars(p)
pub struct ExplodePushdown;
```

3. **Add `ExplodeFilterFusion` optimizer rule**

```rust
/// Fuse element-local predicates into Explode.
/// LAW: Explode(S, expr, as=x) ∘ Filter(p(x)) ≡ Explode(S, filter(expr, λx. p(x)), as=x)
/// WHEN: p references only x (and constants)
pub struct ExplodeFilterFusion;
```

**MEDIUM PRIORITY (Phase 22):**

4. **Add `SelectFusion` optimizer rule**

```rust
/// Merge adjacent Select operations.
/// LAW: Select(Select(S, F), G) ≡ Select(S, G[F])
pub struct SelectFusion;
```

**DEFERRED:**

- `Members`/`Descendants` expressions (lower priority, can add later)
- Index introduction rules (need index infrastructure first)
- Full liveness analysis for field pruning (complex, defer to Phase 23)

### Updated Operator Catalog (Post-Phase 22)

After Phase 22, QueryPlan will have **25 operators** organized as:

```rust
pub enum QueryPlan {
    // ═══════════════════════════════════════════════════════════════
    // Sources (2)
    // ═══════════════════════════════════════════════════════════════
    InMemory { arbor: Arc<InMemoryArbor> },
    Stored { name: String },

    // ═══════════════════════════════════════════════════════════════
    // Selection / View (10)
    // ═══════════════════════════════════════════════════════════════
    Filter { source, predicate, mode, limit },
    Head { source, n },
    Tail { source, n },
    Take { source, indices },
    Sample { source, n, seed },
    Shuffle { source, seed },
    Sort { source, keys },
    TopK { source, keys, k },
    Select { source, exprs },
    AddFields { source, fields },

    // ═══════════════════════════════════════════════════════════════
    // Expansion (1) - NEW in Phase 22
    // ═══════════════════════════════════════════════════════════════
    Explode { source, expr, as_binding },  // NEW

    // ═══════════════════════════════════════════════════════════════
    // Aggregation / Grouping (4)
    // ═══════════════════════════════════════════════════════════════
    GroupBy { source, key_expr },
    IndexBy { source, key_expr },
    UniqueBy { source, by },
    Aggregate { source, exprs },

    // ═══════════════════════════════════════════════════════════════
    // Mutation (4)
    // ═══════════════════════════════════════════════════════════════
    Append { source, trees },
    Insert { source, position, trees, slot },
    Set { source, index, tree },
    Remove { source, indices },
}
```

### Updated Optimizer Rules (Post-Phase 22)

After Phase 22, optimizer will have **14+ rules**:

| Category | Rule | Status |
|----------|------|--------|
| **Filter** | FilterFusion | Existing |
| | FilterSelectivityOrder | Existing |
| | PredicatePushdown | Existing |
| **Limit** | LimitPushdown | Existing |
| | LimitFusion | Existing |
| | TopKFusion | Existing |
| **Mutation** | AppendChainCollapse | Phase 22c |
| | AppendHeadElision | Phase 22c |
| | AppendRemoveLastElision | Phase 22c |
| | SetCollapsingElision | Phase 22c |
| | SetSliceElision | Phase 22c |
| **Expression** | ConstantFolding | Phase 22e |
| | BooleanSimplification | Phase 22e |
| **Explode** | ExplodePushdown | Phase 22f (NEW) |
| | ExplodeFilterFusion | Phase 22f (NEW) |
| **Select** | SelectFusion | Phase 22f (NEW) |

---

## Part 2: Materialization Elision (Phase 4 Implementation)

Phase 4 from the Phase 21 doc describes 4 mutation elision rules. These have NOT been implemented yet.

### 2.1 New File: `crates/arbors-planner/src/optimize/mutation.rs`

```rust
//! Mutation elision optimization rules.

use std::sync::Arc;
use crate::{QueryPlan, OptimizationRule};

/// Eliminates Append when subsequent Head excludes appended trees.
/// LAW: Head(n, Append(S, trees)) ≡ Head(n, S) WHEN len(S) >= n
pub struct AppendHeadElision;

/// Eliminates Append followed by Remove of the appended element.
/// LAW: Remove([len], Append(S, [tree])) ≡ S
pub struct AppendRemoveLastElision;

/// Collapses sequential Set operations on the same index.
/// LAW: Set(i, b, Set(i, a, S)) ≡ Set(i, b, S)
pub struct SetCollapsingElision;

/// Eliminates Set when modified index is sliced away.
/// LAW: Head(n, Set(i, t, S)) ≡ Head(n, S) WHEN i >= n
pub struct SetSliceElision;
```

### 2.2 New Rule: AppendChainCollapse (High Value)

This is NOT in the Phase 21 doc but delivers huge wins:

```rust
/// Collapses sequential Append operations.
/// LAW: Append(Append(S, [a,b]), [c,d]) ≡ Append(S, [a,b,c,d])
pub struct AppendChainCollapse;

impl OptimizationRule for AppendChainCollapse {
    fn apply(&self, plan: &Arc<QueryPlan>) -> Option<Arc<QueryPlan>> {
        match plan.as_ref() {
            QueryPlan::Append { source, trees: outer_trees } => {
                if let QueryPlan::Append { source: inner_source, trees: inner_trees } = source.as_ref() {
                    // Merge the tree vectors
                    let mut merged = Vec::with_capacity(inner_trees.len() + outer_trees.len());
                    merged.extend(inner_trees.iter().cloned());
                    merged.extend(outer_trees.iter().cloned());

                    return Some(Arc::new(QueryPlan::Append {
                        source: Arc::clone(inner_source),
                        trees: Arc::new(merged),
                    }));
                }
                None
            }
            _ => None,
        }
    }

    fn name(&self) -> &'static str { "AppendChainCollapse" }
}
```

**Why this matters**: Building arbors incrementally (`arbor.append(t1).append(t2).append(t3)...`) is common in data pipelines. Without this rule, each append creates a new Composite layer. With it, N appends become a single append of N trees.

### 2.3 Helper: get_source_length

```rust
/// Get known length of a plan (if determinable at optimization time).
fn get_source_length(plan: &QueryPlan) -> Option<usize> {
    match plan {
        QueryPlan::InMemory { arbor } => Some(arbor.num_trees()),
        QueryPlan::Head { source, n } => {
            get_source_length(source).map(|len| len.min(*n))
        }
        QueryPlan::Tail { source, n } => {
            get_source_length(source).map(|len| len.min(*n))
        }
        QueryPlan::Take { indices, .. } => Some(indices.len()),
        QueryPlan::Append { source, trees } => {
            get_source_length(source).map(|len| len + trees.len())
        }
        QueryPlan::Remove { source, indices } => {
            get_source_length(source).map(|len| len.saturating_sub(indices.len()))
        }
        _ => None,  // Filter, Sort, etc. don't have known output length
    }
}
```

---

## Part 3: Code Organization (Targeted Extraction)

### Current State

| File | Lines | Problem |
|------|-------|---------|
| `handle.rs` | 3,816 | 80+ methods, hard to navigate |
| `python/lib.rs` | 14,921 | No modularity, 50+ types |

### Proposed: Targeted Extraction for handle.rs

**New structure:**

```
crates/arbors/src/
├── handle.rs           # Core Arbor struct + constructors + utilities (~800 lines)
├── handle/
│   ├── mod.rs          # Re-exports
│   ├── filter.rs       # filter(), matching_indices(), find_one(), any(), all()
│   ├── slice.rs        # head(), tail(), take(), sample(), shuffle()
│   ├── sort.rs         # sort_by(), sort_by_desc(), sort_by_keys()
│   ├── transform.rs    # select(), add_field(), add_fields()
│   ├── aggregate.rs    # aggregate()
│   ├── group.rs        # group_by(), index_by(), unique_by()
│   ├── mutation.rs     # append(), concat(), insert(), set(), remove()
│   ├── iteration.rs    # iter(), iter_owned(), get(), len()
│   └── explain.rs      # explain(), explain_with(), explain_analyze()
```

**Why this extraction pattern:**
1. **Same public API** - No breaking changes
2. **Incremental** - Extract one module at a time
3. **Navigable** - Find mutation ops in `handle/mutation.rs`
4. **Testable** - Each module can have focused unit tests

### Python Bindings: Defer Full Refactor

The 15K-line `lib.rs` is painful but:
1. It's Python-side only (doesn't affect Rust architecture)
2. Manual bindings offer flexibility for edge cases
3. A binding generator would be premature at current scale

**Phase 22 action**: Document binding patterns, defer extraction to Phase 23+.

---

## Part 4: Expression Simplification (New Rules)

### 4.1 Constant Folding

```rust
/// Fold constant expressions at optimization time.
/// LAW: lit(1) + lit(2) ≡ lit(3)
pub struct ConstantFolding;
```

**Examples:**
- `lit(1) + lit(2)` -> `lit(3)`
- `lit(true) && lit(false)` -> `lit(false)`
- `lit("abc").len()` -> `lit(3)`

### 4.2 Boolean Simplification

```rust
/// Simplify boolean expressions.
/// LAWS:
///   x AND true ≡ x
///   x AND false ≡ false
///   x OR true ≡ true
///   x OR false ≡ x
///   NOT NOT x ≡ x
pub struct BooleanSimplification;
```

### 4.3 Dead Expression Elimination

```rust
/// Eliminate expressions that cannot affect output.
/// LAW: Select([a, b], S) where only 'a' is used downstream ≡ Select([a], S)
pub struct DeadExpressionElimination;
```

---

## Part 4.5: Expression Infrastructure (Prerequisites for Advanced Optimizations)

The code-architect review identified several missing pieces in the expression system that are **prerequisites** for `ExplodePushdown`, `ExplodeFilterFusion`, and `SelectFusion`. These must be built in Phase 22d before Phases 22e-22f.

### 4.5.1 Problem: No Variable Expression

**Current state:** `EvalContext::current_element` provides stack-based binding via `PathSegment::Current` (`@`), but there's no `Expr::Variable(String)` to reference named bindings.

**Impact:** The `as_binding: Option<String>` in `QueryPlan::Explode` has no expression-level counterpart. `predicate_references_binding()` cannot be implemented.

**Solution:** Add `Expr::Variable`:

```rust
// In crates/arbors-expr/src/expr.rs
pub enum Expr {
    // ... existing variants ...

    /// Reference a named binding introduced by Explode, Let, or similar.
    /// Resolved from EvalContext's binding map at evaluation time.
    Variable(String),
}
```

### 4.5.2 Problem: No free_vars() Analysis

**Current state:** No utility to determine which variables an expression references.

**Impact:** `ExplodePushdown` rule needs `predicate_references_binding(predicate, as_binding)` which requires knowing `free_vars(predicate)`.

**Solution:** Add expression analysis utilities:

```rust
// In crates/arbors-expr/src/analysis.rs (new file)
use std::collections::HashSet;

/// Collect all free variable names referenced by an expression.
pub fn free_vars(expr: &Expr) -> HashSet<String> {
    let mut vars = HashSet::new();
    collect_free_vars(expr, &mut vars);
    vars
}

fn collect_free_vars(expr: &Expr, vars: &mut HashSet<String>) {
    match expr {
        Expr::Variable(name) => { vars.insert(name.clone()); }
        // NOTE: arbors-expr does NOT have generic BinaryOp/UnaryOp variants.
        // We must explicitly recurse into each expression's child nodes.
        //
        // Recommended implementation approach:
        // - Add a small internal helper that yields child expressions for each Expr variant.
        // - Then `collect_free_vars` just walks that child list.
        //
        // Pseudocode sketch (actual implementation enumerates all variants):
        //   for child in expr.children() { collect_free_vars(child, vars); }
        _ => {}
    }
}

/// Check if an expression references a specific binding.
pub fn references_binding(expr: &Expr, binding: &str) -> bool {
    free_vars(expr).contains(binding)
}
```

### 4.5.3 Problem: No Expression Substitution/Rewriting

**Current state:** No infrastructure for substituting expressions within expressions.

**Impact:** `SelectFusion` requires composing `G ∘ F` where `G` references outputs of `F`. This needs expression substitution.

**Solution:** Add expression rewriting utilities:

```rust
// In crates/arbors-expr/src/rewrite.rs (new file)

/// Substitute all occurrences of a variable with a replacement expression.
pub fn substitute(expr: &Expr, var: &str, replacement: &Expr) -> Expr {
    match expr {
        Expr::Variable(name) if name == var => replacement.clone(),
        // NOTE: arbors-expr does NOT have a generic BinaryOp representation.
        // Implement substitution by matching each variant and recursively
        // substituting into its children, rebuilding the node.
        //
        // Pseudocode sketch:
        //   Expr::Add(a,b) => Expr::Add(sub(a), sub(b))
        //   Expr::And(a,b) => Expr::And(sub(a), sub(b))
        //   Expr::Not(x)   => Expr::Not(sub(x))
        //   ...
        _ => expr.clone(),
    }
}

/// Apply a mapping of variable names to replacement expressions.
pub fn substitute_all(expr: &Expr, bindings: &HashMap<String, Expr>) -> Expr {
    let mut result = expr.clone();
    for (var, replacement) in bindings {
        result = substitute(&result, var, replacement);
    }
    result
}
```

### 4.5.4 Problem: No Expression-Level Array Filter

**Current state:** Filtering is only available at the QueryPlan level (`Filter`), not within expressions.

**Impact:** `ExplodeFilterFusion` needs to transform:
```
Filter(p(x), Explode(S, expr, as=x)) → Explode(S, filter(expr, λx. p(x)), as=x)
```
This requires `expr.filter(predicate)` at the expression level.

**Solution:** Add `Expr::ArrayFilter`:

```rust
// In crates/arbors-expr/src/expr.rs
pub enum Expr {
    // ... existing variants ...

    /// Filter elements of an array expression by a predicate.
    /// Each element is bound to `element_binding` during predicate evaluation.
    ArrayFilter {
        array: Box<Expr>,
        predicate: Box<Expr>,
        element_binding: String,
    },
}
```

**Evaluation:**

```rust
// In crates/arbors-query/src/eval.rs
use arbors_expr::{ExprResult, Value};

/// Truthiness policy used by array-filtering and other boolean contexts:
/// - Only Scalar(Bool(true)) is truthy.
/// - Everything else (false/null/missing/arrays/objects) is not truthy.
#[inline]
fn is_truthy(result: &ExprResult) -> bool {
    matches!(result, ExprResult::Scalar(Value::Bool(true)))
}

fn eval_array_filter(
    array: &Expr,
    predicate: &Expr,
    element_binding: &str,
    ctx: &EvalContext
) -> Result<ExprResult, ExprError> {
    let array_result = eval_expr(array, ctx)?;
    match array_result {
        ExprResult::Array(elements) => {
            let mut filtered = Vec::new();
            for elem in elements {
                let ctx_with_binding = ctx.with_binding(element_binding, &elem);
                let pred_result = eval_expr(predicate, &ctx_with_binding)?;
                if is_truthy(&pred_result) {
                    filtered.push(elem);
                }
            }
            Ok(ExprResult::Array(filtered))
        }
        _ => Ok(array_result), // Pass-through for non-arrays (lenient)
    }
}
```

### 4.5.5 Problem: No Short-Circuit AND/OR Evaluation

**Current state:** Both sides of AND/OR are always evaluated:

```rust
// Current: crates/arbors-query/src/eval.rs:1648-1653
fn eval_logical_and(left: &Expr, right: &Expr, ctx: &EvalContext) -> Result<ExprResult, ExprError> {
    let left_result = eval_expr(left, ctx)?;  // ALWAYS evaluated
    let right_result = eval_expr(right, ctx)?;  // ALWAYS evaluated
    apply_logical_and(&left_result, &right_result)
}
```

**Impact:**
- Performance: Unnecessary evaluation of right-hand side
- Semantics: Boolean simplification rules may have surprising effects
- Error behavior: `x AND false` evaluates `x` even though result is predetermined

**Solution:** Implement short-circuit evaluation:

```rust
fn eval_logical_and(left: &Expr, right: &Expr, ctx: &EvalContext) -> Result<ExprResult, ExprError> {
    let left_result = eval_expr(left, ctx)?;

    // Short-circuit: if left is false, don't evaluate right
    if !is_truthy(&left_result) {
        return Ok(ExprResult::Scalar(Value::Bool(false)));
    }

    let right_result = eval_expr(right, ctx)?;
    apply_logical_and(&left_result, &right_result)
}

fn eval_logical_or(left: &Expr, right: &Expr, ctx: &EvalContext) -> Result<ExprResult, ExprError> {
    let left_result = eval_expr(left, ctx)?;

    // Short-circuit: if left is true, don't evaluate right
    if is_truthy(&left_result) {
        return Ok(ExprResult::Scalar(Value::Bool(true)));
    }

    let right_result = eval_expr(right, ctx)?;
    apply_logical_or(&left_result, &right_result)
}
```

### 4.5.6 Problem: AddFields Doesn't Create Expression-Scope Bindings

**Current state:** `AddFields` is represented as a **Projection transform** in the planner. When a later operation (like `Filter`) needs to evaluate predicates against those added fields, the planner will **materialize the projection and root-switch** so evaluation happens on the transformed trees.

**Impact:** Users expect:
```python
arbor.add_field("total", path("price") * path("qty")).filter(path("total") > 100)
```
...to filter on the computed `total`. This already works, but it triggers materialization at the filter boundary.

**Real limitation (optimizer / semantics):**

This is *not* an expression-scope binding problem. The true risk is **incorrect predicate pushdown**:
- The optimizer must **not** push a filter *below* an `AddFields` node if the predicate references any newly-added field names.
- Conversely, it is safe to push the filter below `AddFields` when the predicate does not reference added fields.

**Phase 22 action:** Document this rule and its precondition in `docs/QUERY_ALGEBRA.md` (and, if needed, refine `PredicatePushdown` to enforce it).

**Future (optional):** Add a dedicated analysis pass to compute referenced field names precisely (including aliases), rather than string-matching on simple `path("field")` patterns.

### 4.5.7 EvalContext Extension for Named Bindings

**Current state:** `EvalContext` has `current_element: Option<Box<ExprResult>>` but no named binding map.

**Solution:** Extend EvalContext:

```rust
// In crates/arbors-query/src/context.rs
use std::sync::Arc;

/// Persistent binding chain.
///
/// This avoids cloning a HashMap per element when iterating arrays (explode/filter/map).
/// Depth is expected to be tiny (often 0-2), so linear lookup is fine.
#[derive(Clone, Default)]
pub struct Bindings {
    parent: Option<Arc<Bindings>>,
    name: Arc<str>,
    value: Arc<ExprResult>,
}

impl Bindings {
    pub fn extend(parent: Option<Arc<Bindings>>, name: impl Into<Arc<str>>, value: ExprResult) -> Arc<Self> {
        Arc::new(Self { parent, name: name.into(), value: Arc::new(value) })
    }

    pub fn get(&self, name: &str) -> Option<&ExprResult> {
        if self.name.as_ref() == name {
            Some(self.value.as_ref())
        } else {
            self.parent.as_deref().and_then(|p| p.get(name))
        }
    }
}

pub struct EvalContext<'a> {
    pub arbor: &'a InMemoryArbor,
    pub root: NodeId,
    pub current: NodeId,
    pub current_element: Option<Box<ExprResult>>,
    /// Optional named bindings (used by Expr::Variable).
    pub bindings: Option<Arc<Bindings>>,  // NEW (persistent, low-clone)
}

impl<'a> EvalContext<'a> {
    /// Create a new context with an additional named binding.
    pub fn with_binding(&self, name: &str, value: &ExprResult) -> Self {
        EvalContext {
            arbor: self.arbor,
            root: self.root,
            current: self.current,
            current_element: self.current_element.clone(),
            bindings: Some(Bindings::extend(self.bindings.clone(), name, value.clone())),
        }
    }

    /// Resolve a variable binding by name.
    pub fn resolve_binding(&self, name: &str) -> Option<&ExprResult> {
        self.bindings.as_deref().and_then(|b| b.get(name))
    }
}
```

---

## Part 5: Implementation Plan

### Phase 22a: Handle Extraction (First Priority)

**Goal:** Reduce friction for adding/maintaining operations by modularizing handle.rs.

**Cross-References:**
- **Part 3: Code Organization** - Full rationale for extraction pattern, target directory structure
- **Critical Files: Phase 22a** - Complete list of new and modified files

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Create `handle/` directory structure | New directory | Per Part 3 structure |
| 2 | Create `handle/mod.rs` with re-exports | `handle/mod.rs` | Export all submodules publicly |
| 3 | Extract `handle/mutation.rs` | Move append/concat/insert/set/remove | ~150 lines; these ops are grouped for Phase 22c mutation elision |
| 4 | Extract `handle/slice.rs` | Move head/tail/take/sample/shuffle | ~120 lines |
| 5 | Extract `handle/filter.rs` | Move filter/matching_indices/find_one/any/all | ~200 lines |
| 6 | Extract `handle/iteration.rs` | Move iter/iter_owned/get/len | ~100 lines |
| 7 | Extract `handle/explain.rs` | Move explain/explain_with/explain_analyze | ~80 lines |
| 8 | Extract `handle/sort.rs` | Move sort_by/sort_by_desc/sort_by_keys | ~100 lines |
| 9 | Extract `handle/transform.rs` | Move select/add_field/add_fields | ~120 lines; will add explode() in Phase 22f |
| 10 | Extract `handle/aggregate.rs` | Move aggregate/group_by/index_by/unique_by | ~150 lines |
| 11 | Update `handle.rs` to re-export via `mod handle` | handle.rs (~800 lines remaining) | Core struct, constructors, utilities only |
| 12 | Update `lib.rs` if needed | `crates/arbors/src/lib.rs` | Ensure module visibility correct |

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Unit tests | `cargo nextest run -p arbors --lib` | All pass (no behavioral changes) |
| Integration tests | `cargo nextest run -p arbors` | All pass |
| Python tests | `make python-test` | All pass |
| Parity tests | `cargo nextest run -p arbors conformance` | All pass |
| Doc build | `cargo doc -p arbors` | Builds without warnings |

**Checkpoint:**

- [ ] `handle/` directory exists with 9 submodules (mod.rs + 8 category files)
- [ ] `handle.rs` reduced to ~800 lines (struct, constructors, utilities)
- [ ] All existing tests pass: `make test && make python-test`
- [ ] Public API unchanged (same method signatures, same return types)
- [ ] `cargo doc` produces correct documentation with cross-module links
- [ ] No new clippy warnings: `make lint`

### Phase 22b: Formalized Algebra with Property-Based Tests

**Goal:** Each optimization rule has corresponding property-based tests proving semantic equivalence.

**Cross-References:**
- **Part 1: Query Algebra Assessment** - Lists the 6 existing rules to test: `FilterFusion`, `FilterSelectivityOrder`, `PredicatePushdown`, `LimitPushdown`, `LimitFusion`, `TopKFusion`
- **Part 1: "What's Missing"** - Shows the algebraic law format to document (LAW: name, equivalence, WHEN: precondition)
- **Part 1.5: Rewrite Rules table** - Maps proposed rules to existing implementations
- **Open Questions #4-5** - Property test generators and proptest vs quickcheck decision
- **Critical Files: Phase 22b** - New files and modified Cargo.toml

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add `proptest` to dev-deps | `crates/arbors/Cargo.toml` | Per Open Question #5: proptest preferred |
| 2 | Create test generators module | `tests/integration/pipeline/generators.rs` | Per Open Question #4: arb_jsonl, arb_predicate, arb_tree |
| 3 | Create optimizer properties test file | `tests/integration/pipeline/optimizer_properties.rs` | Will hold all property tests |
| 4 | Property: FilterFusion preserves semantics | optimizer_properties.rs | LAW from Part 1: `Filter(p1, Filter(p2, S)) ≡ Filter(p1 AND p2, S)` |
| 5 | Property: TopKFusion preserves semantics | optimizer_properties.rs | LAW from Part 1: `Head(k, Sort(keys, S)) ≡ TopK(keys, k, S)` |
| 6 | Property: LimitPushdown preserves semantics | optimizer_properties.rs | LAW from Part 1: `Head(n, Filter(p, S)) ≡ Filter(p, S, limit=n)` |
| 7 | Property: LimitFusion preserves semantics | optimizer_properties.rs | `Head(n2, Head(n1, S)) ≡ Head(min(n1,n2), S)` |
| 8 | Property: PredicatePushdown preserves semantics | optimizer_properties.rs | Test for Select/AddFields cases |
| 9 | Property: FilterSelectivityOrder preserves semantics | optimizer_properties.rs | Reordering AND predicates |
| 10 | Create `docs/QUERY_ALGEBRA.md` | New file | Document ALL laws with preconditions (format per Part 1) |
| 11 | Add invariant test: optimized length == unoptimized length | optimizer_properties.rs | For filter-free, sample-free plans |

**Property Test Pattern:**
```rust
proptest! {
    #[test]
    fn filter_fusion_preserves_semantics(
        data in arb_jsonl(1..100),
        p1 in arb_predicate(),
        p2 in arb_predicate()
    ) {
        let arbor = read_jsonl(&data)?;

        // Unoptimized: two separate filters
        let result1: Vec<_> = arbor
            .filter(&p1, FilterMode::Immediate)?
            .filter(&p2, FilterMode::Immediate)?
            .iter()
            .collect();

        // What optimizer produces: fused filter
        let fused = Expr::and(p1.clone(), p2.clone());
        let result2: Vec<_> = arbor
            .filter(&fused, FilterMode::Immediate)?
            .iter()
            .collect();

        prop_assert_eq!(result1, result2);
    }
}
```

**QUERY_ALGEBRA.md Structure:**

```markdown
# Arbors Query Algebra

## Semantic Contract
[Copy from Part 1.5: doc-row, strict, order-preserving semantics]

## Operators
[Copy from Part 1.5: Updated Operator Catalog]

## Equivalence Laws

### Filter Laws
LAW: FilterFusion
  Filter(p1, Filter(p2, S)) ≡ Filter(p1 AND p2, S)
  WHEN: neither filter has a limit

### Limit Laws
[etc...]
```

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Property tests | `cargo nextest run -p arbors optimizer_properties` | All properties hold |
| Existing tests | `cargo nextest run -p arbors` | No regressions |
| Generator tests | `cargo nextest run -p arbors generators` | Generators produce valid data |

**Checkpoint:**

- [ ] `proptest` added to `crates/arbors/Cargo.toml` dev-dependencies
- [ ] `generators.rs` provides: `arb_jsonl`, `arb_predicate`, `arb_tree`
- [ ] Property tests exist for ALL 6 existing optimizer rules (Part 1 list)
- [ ] `docs/QUERY_ALGEBRA.md` documents all laws with preconditions
- [ ] All property tests pass: `cargo nextest run -p arbors optimizer_properties`
- [ ] Laws in QUERY_ALGEBRA.md match actual optimizer behavior

### Phase 22c: Mutation Elision Optimizer

**Goal:** Add 5 mutation elision rules to avoid unnecessary materialization.

**Cross-References:**
- **Part 2: Materialization Elision** - Complete rule specifications with algebraic laws:
  - Section 2.1: `AppendHeadElision`, `AppendRemoveLastElision`, `SetCollapsingElision`, `SetSliceElision`
  - Section 2.2: `AppendChainCollapse` (high-value addition not in Phase 21 doc)
  - Section 2.3: `get_source_length()` helper implementation
- **Part 1.5: Updated Optimizer Rules table** - Shows these rules as "Phase 22c" additions
- **Open Questions #1-2** - Insert/Remove chain collapse decisions (both likely DEFER)
- **Critical Files: Phase 22c** - New mutation.rs and modified mod.rs, query_plan.rs

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Create `optimize/mutation.rs` | New file | Per Critical Files section |
| 2 | Implement `get_source_length()` helper | mutation.rs | Code in Part 2.3; handles InMemory, Head, Tail, Take, Append, Remove |
| 3 | Implement `AppendChainCollapse` rule | mutation.rs | LAW from Part 2.2: `Append(Append(S, [a,b]), [c,d]) ≡ Append(S, [a,b,c,d])` |
| 4 | Implement `AppendHeadElision` rule | mutation.rs | LAW from Part 2.1: `Head(n, Append(S, trees)) ≡ Head(n, S) WHEN len(S) >= n` |
| 5 | Implement `AppendRemoveLastElision` rule | mutation.rs | LAW from Part 2.1: `Remove([len], Append(S, [tree])) ≡ S` |
| 6 | Implement `SetCollapsingElision` rule | mutation.rs | LAW from Part 2.1: `Set(i, b, Set(i, a, S)) ≡ Set(i, b, S)` |
| 7 | Implement `SetSliceElision` rule | mutation.rs | LAW from Part 2.1: `Head(n, Set(i, t, S)) ≡ Head(n, S) WHEN i >= n` |
| 8 | Add `pub mod mutation` to mod.rs | `optimize/mod.rs` | Export new module |
| 9 | Register rules in optimizer | `optimize/query_plan.rs` | Add to rule list in optimization pass |
| 10 | Add unit tests for each rule | mutation.rs `#[cfg(test)]` | Test each LAW individually |
| 11 | Add property tests for mutation rules | optimizer_properties.rs | Extend generators per Phase 22b |

**Rule Implementation Order Rationale:**
1. `get_source_length()` first - other rules depend on it
2. `AppendChainCollapse` - highest impact (10-100x for chained appends per Executive Summary)
3. `AppendHeadElision` - uses get_source_length
4. `AppendRemoveLastElision` - simple pattern match
5. `SetCollapsingElision` - simple pattern match
6. `SetSliceElision` - uses get_source_length

**Property Test for AppendChainCollapse:**
```rust
proptest! {
    #[test]
    fn append_chain_collapse_preserves_semantics(
        base in arb_jsonl(0..50),
        trees in vec(arb_json(), 1..10)
    ) {
        let arbor = read_jsonl(&base)?;

        // Chained appends
        let mut chained = arbor.clone();
        for t in &trees {
            chained = chained.append(std::iter::once(t.clone()))?;
        }

        // Single append (what optimizer produces)
        let single = arbor.append(trees.iter().cloned())?;

        prop_assert_eq!(chained.len()?, single.len()?);
        prop_assert!(chained.iter().zip(single.iter()).all(|(a, b)| a == b));
    }
}
```

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Unit tests | `cargo nextest run -p arbors-planner mutation` | All pass |
| Property tests | `cargo nextest run -p arbors optimizer_properties` | All mutation properties hold |
| explain() verification | Manual | Rules visible in optimized plan output |
| Benchmark | Manual timing | Chained appends measurably faster |

**Checkpoint:**

- [ ] `optimize/mutation.rs` exists with 5 rules + helper
- [ ] Each rule implements `OptimizationRule` trait correctly
- [ ] Unit tests cover each rule's LAW (positive and negative cases)
- [ ] Property tests added to optimizer_properties.rs
- [ ] Rules registered in optimizer pass order
- [ ] `explain()` shows mutation rules when applicable
- [ ] `docs/QUERY_ALGEBRA.md` documents added/updated laws with preconditions
- [ ] All tests pass: `cargo nextest run -p arbors-planner`
- [ ] Benchmark: `arbor.append(t1).append(t2)...append(t100).collect()` is measurably faster

### Phase 22d: Expression Infrastructure (PREREQUISITE for 22e-22f)

**Goal:** Build the expression-level infrastructure needed for advanced optimizer rules: Variable expressions, free_vars() analysis, expression substitution, ArrayFilter, and short-circuit AND/OR.

**Cross-References:**
- **Part 4.5: Expression Infrastructure** - Complete problem statements and solutions:
  - Section 4.5.1: `Expr::Variable` for named bindings
  - Section 4.5.2: `free_vars()` and `references_binding()` analysis
  - Section 4.5.3: Expression substitution for SelectFusion
  - Section 4.5.4: `Expr::ArrayFilter` for ExplodeFilterFusion
  - Section 4.5.5: Short-circuit AND/OR evaluation
  - Section 4.5.6: AddFields limitation documentation
  - Section 4.5.7: EvalContext extension for named bindings
- **Critical Files: Phase 22d** - New analysis.rs, rewrite.rs, and modified expr.rs, eval.rs, context.rs

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add `Expr::Variable(String)` variant | `arbors-expr/src/expr.rs` | Per Part 4.5.1 |
| 2 | Add `bindings: HashMap<String, ExprResult>` to EvalContext | `arbors-query/src/context.rs` | Per Part 4.5.7 |
| 3 | Add `with_binding()` and `resolve_binding()` to EvalContext | `arbors-query/src/context.rs` | Per Part 4.5.7 |
| 4 | Implement `eval_variable()` in evaluator | `arbors-query/src/eval.rs` | Resolve from context.bindings |
| 5 | Create `analysis.rs` with `free_vars()` | `arbors-expr/src/analysis.rs` | Per Part 4.5.2; new file |
| 6 | Add `references_binding()` helper | `arbors-expr/src/analysis.rs` | Per Part 4.5.2 |
| 7 | Create `rewrite.rs` with `substitute()` | `arbors-expr/src/rewrite.rs` | Per Part 4.5.3; new file |
| 8 | Add `substitute_all()` helper | `arbors-expr/src/rewrite.rs` | Per Part 4.5.3 |
| 9 | Add `Expr::ArrayFilter` variant | `arbors-expr/src/expr.rs` | Per Part 4.5.4 |
| 10 | Implement `eval_array_filter()` in evaluator | `arbors-query/src/eval.rs` | Per Part 4.5.4 |
| 11 | Implement short-circuit AND evaluation | `arbors-query/src/eval.rs` | Per Part 4.5.5 |
| 12 | Implement short-circuit OR evaluation | `arbors-query/src/eval.rs` | Per Part 4.5.5 |
| 13 | Document AddFields limitation in QUERY_ALGEBRA.md | `docs/QUERY_ALGEBRA.md` | Per Part 4.5.6 Option A |
| 14 | Add unit tests for Variable expression | `arbors-expr` tests | Test eval with bindings |
| 15 | Add unit tests for free_vars() | `arbors-expr` tests | Cover all Expr variants |
| 16 | Add unit tests for substitute() | `arbors-expr` tests | Cover nested substitution |
| 17 | Add unit tests for ArrayFilter | `arbors-query` tests | Test filtering arrays |
| 18 | Add unit tests for short-circuit | `arbors-query` tests | Verify right-hand side not evaluated when short-circuited |

**Why This Phase is Critical:**

Without this infrastructure:
- `ExplodePushdown` cannot determine if predicate references exploded binding (needs `free_vars()`)
- `ExplodeFilterFusion` cannot create filtered array expressions (needs `Expr::ArrayFilter`)
- `SelectFusion` cannot compose expressions (needs `substitute()`)
- Boolean simplification may have surprising error behavior (needs short-circuit)

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Variable eval | `cargo nextest run -p arbors-query variable` | Bindings resolve correctly |
| free_vars | `cargo nextest run -p arbors-expr free_vars` | All variants covered |
| substitute | `cargo nextest run -p arbors-expr substitute` | Nested substitution works |
| ArrayFilter | `cargo nextest run -p arbors-query array_filter` | Filtering works, lenient on non-arrays |
| Short-circuit | `cargo nextest run -p arbors-query short_circuit` | Right side not evaluated when unnecessary |

**Checkpoint:**

- [ ] `Expr::Variable(String)` variant added to expr.rs
- [ ] `EvalContext` extended with `bindings` HashMap
- [ ] `with_binding()` and `resolve_binding()` methods work correctly
- [ ] `analysis.rs` exists with `free_vars()` covering all Expr variants
- [ ] `references_binding()` returns correct results
- [ ] `rewrite.rs` exists with `substitute()` and `substitute_all()`
- [ ] `Expr::ArrayFilter` variant added to expr.rs
- [ ] ArrayFilter evaluation works correctly with element bindings
- [ ] AND short-circuits on false left operand
- [ ] OR short-circuits on true left operand
- [ ] QUERY_ALGEBRA.md documents AddFields limitation
- [ ] All unit tests pass for new functionality
- [ ] All existing tests still pass: `make test`

### Phase 22e: Expression Simplification

**Goal:** Add constant folding and boolean simplification rules.

**PREREQUISITE:** Phase 22d (Expression Infrastructure) must be complete. Short-circuit evaluation semantics affect which simplifications are safe.

**Cross-References:**
- **Part 4: Expression Simplification** - Complete rule specifications:
  - Section 4.1: `ConstantFolding` with examples
  - Section 4.2: `BooleanSimplification` with 5 specific laws
  - Section 4.3: `DeadExpressionElimination` (DEFER - requires liveness analysis)
- **Part 1.5: Rewrite Rules table** - Shows "A2: Constant folding" and "A2: Boolean simplification" as Phase 22e additions
- **Open Question #3** - Expression simplification scope (definitely arithmetic/boolean, maybe len(), defer function calls)
- **Critical Files: Phase 22e** - New expression.rs and modified mod.rs, query_plan.rs

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Create `optimize/expression.rs` | New file | Per Critical Files section |
| 2 | Implement expression traversal helper | expression.rs | Walk Expr tree, apply simplifications |
| 3 | Implement `ConstantFolding` rule | expression.rs | Per Part 4.1 + Open Question #3 scope |
| 4 | Implement `BooleanSimplification` rule | expression.rs | Per Part 4.2: 5 specific laws |
| 5 | Add `pub mod expression` to mod.rs | `optimize/mod.rs` | Export new module |
| 6 | Register rules in optimizer | `optimize/query_plan.rs` | Add to rule list |
| 7 | Add unit tests for constant folding | expression.rs `#[cfg(test)]` | Cover arithmetic, string len (per Open Question #3) |
| 8 | Add unit tests for boolean simplification | expression.rs `#[cfg(test)]` | Cover all 5 laws from Part 4.2 |
| 9 | Add property tests | optimizer_properties.rs | Expression simplification preserves evaluation |

**Constant Folding Cases (Per Part 4.1 + Open Question #3):**

| Expression | Result | Scope |
|------------|--------|-------|
| `lit(1) + lit(2)` | `lit(3)` | Definitely |
| `lit(true) && lit(false)` | `lit(false)` | Definitely |
| `lit("abc").len()` | `lit(3)` | Maybe (per Open Question #3) |
| `pure_fn(lit(x))` | Deferred | Later (per Open Question #3) |

**Boolean Simplification Cases (Per Part 4.2):**

| Expression | Result | LAW |
|------------|--------|-----|
| `x && true` | `x` | AND-identity |
| `x && false` | `false` | AND-annihilator |
| `x \|\| true` | `true` | OR-annihilator |
| `x \|\| false` | `x` | OR-identity |
| `!!x` | `x` | Double-negation elimination |

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Unit tests | `cargo nextest run -p arbors-planner expression` | All pass |
| Property tests | `cargo nextest run -p arbors optimizer_properties` | Simplification preserves semantics |
| explain() verification | Manual | Simplified expressions visible |
| Performance | Manual | No regression in expression evaluation |

**Checkpoint:**

- [ ] `optimize/expression.rs` exists with 2 rules + traversal helper
- [ ] Constant folding handles: integer arithmetic, boolean literals
- [ ] Boolean simplification handles all 5 laws from Part 4.2
- [ ] Unit tests cover positive and negative cases for each simplification
- [ ] Property tests verify: `eval(simplify(expr)) == eval(expr)`
- [ ] Rules registered in optimizer pass order
- [ ] `explain()` shows simplified expressions
- [ ] `docs/QUERY_ALGEBRA.md` documents added/updated laws with preconditions
- [ ] All tests pass: `cargo nextest run -p arbors-planner`
- [ ] No performance regression in expression evaluation benchmarks

### Phase 22f: Explode Operator + Optimization Rules (Algebra Completion)

**Goal:** Add the critical `Explode` operator to QueryPlan, enabling array expansion with optimizer support.

**PREREQUISITE:** Phase 22d (Expression Infrastructure) must be complete. This phase uses:
- `Expr::Variable` for the exploded element binding
- `free_vars()` / `references_binding()` for ExplodePushdown safety check
- `Expr::ArrayFilter` for ExplodeFilterFusion
- `substitute()` for SelectFusion

**Cross-References:**
- **Part 1.5: Critical Gap** - Details why Explode not being in QueryPlan blocks major optimizations (C4, C5, E1-E4)
- **Part 1.5: "Example of blocked optimization"** - Shows the 100x speedup potential
- **Part 1.5: Phase 22 Operator Additions** - Complete `QueryPlan::Explode` variant definition with semantics
- **Part 1.5: Updated Operator Catalog** - Shows Explode as new "Expansion" category (25 operators total)
- **Part 1.5: Updated Optimizer Rules table** - Lists `ExplodePushdown`, `ExplodeFilterFusion`, `SelectFusion` as Phase 22f
- **Part 4.5: Expression Infrastructure** - Prerequisites built in Phase 22d
- **Open Questions #6-8** - Explode binding semantics, empty array behavior, missing path handling
- **Summary: "What Makes Phase 22 Special"** - Explains why ExplodePushdown is "THE big win"
- **Critical Files: Phase 22f** - Complete file list for this phase
- **Executive Summary** - "100x faster for filtered explodes"

| Step | Task | Files | Notes |
|------|------|-------|-------|
| 1 | Add `Explode` variant to `QueryPlan` enum | `query_plan.rs` | Definition in Part 1.5; semantics in Open Questions #6-8 |
| 2 | Add match arms for Explode | `query_plan.rs` | display(), source(), etc. |
| 3 | Add `Explode` execution in physical.rs | `physical.rs` | Use `Explodable` trait + Phase 22d Variable bindings |
| 4 | Add `explode()` method to Arbor handle | `handle/transform.rs` | Phase 22a extraction makes this easy |
| 5 | Add ArborQuery builder method | `lazy.rs` | Match other operators' lazy pattern |
| 6 | Add Python binding for `explode()` | `python/src/lib.rs` | Thin binding over Rust impl |
| 7 | Create `optimize/explode.rs` | New file | Per Critical Files section |
| 8 | Implement `ExplodePushdown` rule | `explode.rs` | Uses `references_binding()` from Phase 22d |
| 9 | Implement `ExplodeFilterFusion` rule | `explode.rs` | Uses `Expr::ArrayFilter` from Phase 22d |
| 10 | Implement `SelectFusion` rule | `explode.rs` or `select.rs` | Uses `substitute()` from Phase 22d |
| 11 | Add `pub mod explode` to mod.rs | `optimize/mod.rs` | Export new module |
| 12 | Register rules in optimizer | `optimize/query_plan.rs` | Add to rule list |
| 13 | Add unit tests for Explode execution | `arbors-planner` tests | Basic explode correctness |
| 14 | Add unit tests for each optimizer rule | `explode.rs` `#[cfg(test)]` | Test each LAW |
| 15 | Add property tests for Explode rules | `optimizer_properties.rs` | Extend generators with `arb_jsonl_with_arrays` per Open Question #4 |

**QueryPlan::Explode Definition:**

```rust
/// Expand each tree by evaluating expr to a sequence.
/// Emits one output tree per element, with element bound to as_binding.
///
/// # Semantics (jq-ish)
/// - Input order preserved: outputs for tree i appear before outputs for tree i+1
/// - Element order preserved: within a tree, elements emit in sequence order
/// - Empty sequences produce no output for that tree (not an error)
///
/// # Example
/// Input: [{"items": [1,2]}, {"items": [3]}]
/// Explode(path("items"), as="item")
/// Output: [{"$": ..., "item": 1}, {"$": ..., "item": 2}, {"$": ..., "item": 3}]
Explode {
    source: Arc<QueryPlan>,
    /// Expression evaluating to a sequence (array path, .children(), etc.)
    expr: Arc<Expr>,
    /// Optional binding name for exploded elements (default: "$item" or similar)
    as_binding: Option<String>,
},
```

**ExplodePushdown Rule (THE big optimization):**

```rust
/// Push predicates before Explode when they don't reference the exploded binding.
///
/// LAW: Filter(p, Explode(S, expr, as=x)) ≡ Explode(Filter(p, S), expr, as=x)
/// WHEN: x not in free_vars(p)
///
/// This is HUGE because it prevents exploding documents you'll later discard.
/// Example: If filtering on document.category, filter before exploding document.items[].
pub struct ExplodePushdown;

impl OptimizationRule for ExplodePushdown {
    fn apply(&self, plan: &Arc<QueryPlan>) -> Option<Arc<QueryPlan>> {
        match plan.as_ref() {
            QueryPlan::Filter { source, predicate, mode, limit } => {
                if let QueryPlan::Explode { source: explode_source, expr, as_binding } = source.as_ref() {
                    // Check if predicate references the exploded binding
                    if !predicate_references_binding(predicate, as_binding) {
                        // Safe to push filter before explode
                        let pushed_filter = Arc::new(QueryPlan::Filter {
                            source: Arc::clone(explode_source),
                            predicate: predicate.clone(),
                            mode: *mode,
                            limit: *limit,
                        });
                        return Some(Arc::new(QueryPlan::Explode {
                            source: pushed_filter,
                            expr: Arc::clone(expr),
                            as_binding: as_binding.clone(),
                        }));
                    }
                }
                None
            }
            _ => None,
        }
    }

    fn name(&self) -> &'static str { "ExplodePushdown" }
}
```

**ExplodeFilterFusion Rule:**

```rust
/// Fuse element-local predicates into Explode's sequence expression.
///
/// LAW: Filter(p(x), Explode(S, expr, as=x)) ≡ Explode(S, filter(expr, λx. p(x)), as=x)
/// WHEN: p references only x (and constants)
///
/// This turns:
///   .items[] | select(.price > 10)
/// into:
///   explode(filter(items, |item| item.price > 10))
/// So fewer elements are ever produced.
pub struct ExplodeFilterFusion;
```

**SelectFusion Rule:**

```rust
/// Merge adjacent Select operations.
///
/// LAW: Select(G, Select(F, S)) ≡ Select(G ∘ F, S)
/// WHERE: G ∘ F means substituting G's references with F's definitions
pub struct SelectFusion;
```

**Property Tests for Explode Rules:**

```rust
proptest! {
    #[test]
    fn explode_pushdown_preserves_semantics(
        data in arb_jsonl_with_arrays(1..20),
        pred_on_doc in arb_doc_predicate()  // Predicate NOT on exploded element
    ) {
        let arbor = read_jsonl(&data)?;

        // Unoptimized: explode then filter
        let result1: Vec<_> = arbor
            .explode("items")?
            .filter(&pred_on_doc, FilterMode::Immediate)?
            .iter()
            .collect();

        // Optimized: filter then explode (what optimizer should produce)
        let result2: Vec<_> = arbor
            .filter(&pred_on_doc, FilterMode::Immediate)?
            .explode("items")?
            .iter()
            .collect();

        prop_assert_eq!(result1, result2);
    }
}
```

**Semantic Decisions (Per Open Questions #6-8):**

| Question | Decision | Rationale |
|----------|----------|-----------|
| Binding name (OQ #6) | Option C: Named or default | `as_binding: Option<String>`, default to `"$item"` |
| Empty array (OQ #7) | Produces no output | Matches existing explode behavior (`[]` drops the row) |
| Missing path (OQ #8) | **Pass-through (no error)** | Matches current `Explodable` trait semantics: missing/non-array/null pass through unchanged |

**Tests:**

| Test Category | Command | Expected Result |
|--------------|---------|-----------------|
| Explode execution | `cargo nextest run -p arbors-planner explode` | Basic correctness |
| ExplodePushdown unit | `cargo nextest run -p arbors-planner explode_pushdown` | Rule applies when safe |
| ExplodeFilterFusion unit | `cargo nextest run -p arbors-planner explode_filter_fusion` | Rule applies for element-local predicates |
| SelectFusion unit | `cargo nextest run -p arbors-planner select_fusion` | Adjacent selects merge |
| Property tests | `cargo nextest run -p arbors optimizer_properties` | All explode properties hold |
| Python binding | `make python-test` | `arbor.explode("items")` works |
| explain() verification | Manual | ExplodePushdown visible in optimized plans |
| Benchmark | Manual | Filtered explodes measurably faster |

**Checkpoint:**

- [ ] `QueryPlan::Explode` variant added with all match arms
- [ ] `physical.rs` executes Explode using existing `Explodable` trait
- [ ] `handle/transform.rs` has `explode()` method (per Phase 22a structure)
- [ ] `lazy.rs` has `ArborQuery::explode()` builder method
- [ ] Python binding works: `arbor.explode("path")`
- [ ] `optimize/explode.rs` exists with 3 rules + helper
- [ ] `predicate_references_binding()` helper correctly detects binding usage
- [ ] Unit tests cover all 3 new rules
- [ ] Property tests verify ExplodePushdown preserves semantics
- [ ] Generators extended with `arb_jsonl_with_arrays` and `arb_doc_predicate`
- [ ] `explain()` shows ExplodePushdown when applicable
- [ ] All tests pass: `make test && make python-test`
- [ ] Benchmark: `arbor.explode("items").filter(doc_predicate)` is faster than eager explode

---

## Critical Files

### Phase 22a (Handle Extraction)

**New directory and files:**
```
crates/arbors/src/handle/
├── mod.rs          # Re-exports all submodules
├── mutation.rs     # append, concat, insert, set, remove
├── slice.rs        # head, tail, take, sample, shuffle
├── filter.rs       # filter, matching_indices, find_one, any, all
├── iteration.rs    # iter, iter_owned, get, len
├── explain.rs      # explain, explain_with, explain_analyze
├── sort.rs         # sort_by, sort_by_desc, sort_by_keys
├── transform.rs    # select, add_field, add_fields
└── aggregate.rs    # aggregate, group_by, index_by, unique_by
```

**Modified:**
- `crates/arbors/src/handle.rs` - Reduced to ~800 lines (struct, constructors, utilities)
- `crates/arbors/src/lib.rs` - May need mod adjustments

### Phase 22b (Algebra Tests)

**New:**
- `crates/arbors/tests/integration/pipeline/optimizer_properties.rs` - Property-based tests
- `docs/QUERY_ALGEBRA.md` - Formalized equivalences with preconditions

**Modified:**
- `crates/arbors/Cargo.toml` - Add proptest to dev-dependencies

### Phase 22c (Mutation Elision)

**New:**
- `crates/arbors-planner/src/optimize/mutation.rs` - 5 mutation elision rules

**Modified:**
- `crates/arbors-planner/src/optimize/mod.rs` - Add `pub mod mutation`
- `crates/arbors-planner/src/optimize/query_plan.rs` - Add rules to optimizer

### Phase 22d (Expression Infrastructure)

**New:**
- `crates/arbors-expr/src/analysis.rs` - `free_vars()`, `references_binding()`
- `crates/arbors-expr/src/rewrite.rs` - `substitute()`, `substitute_all()`

**Modified:**
- `crates/arbors-expr/src/expr.rs` - Add `Expr::Variable`, `Expr::ArrayFilter`
- `crates/arbors-expr/src/lib.rs` - Export new modules
- `crates/arbors-query/src/context.rs` - Add `bindings` HashMap, `with_binding()`, `resolve_binding()`
- `crates/arbors-query/src/eval.rs` - Add `eval_variable()`, `eval_array_filter()`, short-circuit AND/OR
- `docs/QUERY_ALGEBRA.md` - Document AddFields limitation

### Phase 22e (Expression Simplification)

**New:**
- `crates/arbors-planner/src/optimize/expression.rs` - Constant/boolean simplification

**Modified:**
- `crates/arbors-planner/src/optimize/mod.rs` - Add `pub mod expression`
- `crates/arbors-planner/src/optimize/query_plan.rs` - Add rules to optimizer

### Phase 22f (Explode Operator + Rules)

**New:**
- `crates/arbors-planner/src/optimize/explode.rs` - ExplodePushdown, ExplodeFilterFusion, SelectFusion

**Modified:**
- `crates/arbors-planner/src/query_plan.rs` - Add `Explode` variant
- `crates/arbors-planner/src/physical.rs` - Add Explode execution
- `crates/arbors/src/handle/transform.rs` - Add `explode()` method
- `python/src/lib.rs` - Add Python binding for `explode()`
- `crates/arbors-planner/src/optimize/mod.rs` - Add `pub mod explode`
- `crates/arbors-planner/src/optimize/query_plan.rs` - Add Explode rules to optimizer

---

## Verification Plan

> **Note:** Each phase in Part 5 contains detailed **Tests** tables and **Checkpoint** checklists. This section provides a summary and the overall verification strategy.

### After Phase 22a (Handle Extraction)

**See:** Part 5 → Phase 22a → Tests table and Checkpoint checklist

Key verification:
1. **All existing tests pass** - `make test && make python-test`
2. **Parity tests pass** - `cargo nextest run -p arbors conformance`
3. **Public API unchanged** - No breaking changes to Arbor methods
4. **Documentation still builds** - `cargo doc -p arbors` without warnings
5. **No new clippy warnings** - `make lint`

### After Phase 22b (Algebra Tests)

**See:** Part 5 → Phase 22b → Tests table and Checkpoint checklist

Key verification:
1. **Property tests pass** - `cargo nextest run -p arbors optimizer_properties`
2. **Generator tests pass** - `cargo nextest run -p arbors generators`
3. **Existing optimization behavior unchanged** - Same plans produced
4. **QUERY_ALGEBRA.md is accurate** - Laws match implementation

### After Phase 22c (Mutation Elision)

**See:** Part 5 → Phase 22c → Tests table and Checkpoint checklist

Key verification:
1. **All tests pass** - Including new mutation rule tests
2. **Property tests for new rules pass** - AppendChainCollapse etc.
3. **explain() shows new rules** - Rules visible in optimized plan output
4. **Benchmark improvement** - Mutation chains measurably faster

### After Phase 22d (Expression Infrastructure)

**See:** Part 5 → Phase 22d → Tests table and Checkpoint checklist

Key verification:
1. **Variable expression works** - `Expr::Variable` resolves from context bindings
2. **free_vars() complete** - All Expr variants handled correctly
3. **Substitution works** - Nested expression substitution is correct
4. **ArrayFilter works** - Element filtering with bindings is correct
5. **Short-circuit evaluation** - AND/OR don't evaluate unnecessary operands
6. **All tests pass** - `cargo nextest run -p arbors-expr && cargo nextest run -p arbors-query`

### After Phase 22e (Expression Simplification)

**See:** Part 5 → Phase 22e → Tests table and Checkpoint checklist

Key verification:
1. **All tests pass** - Including expression simplification tests
2. **Property tests pass** - Constant folding preserves semantics
3. **explain() shows simplifications** - Folded expressions visible
4. **No performance regression** - Expression evaluation not slower

### After Phase 22f (Explode Operator + Rules)

**See:** Part 5 → Phase 22f → Tests table, Semantic Decisions table, and Checkpoint checklist

Key verification:
1. **All tests pass** - Including new Explode operator tests
2. **Explode executes correctly** - Produces expected output trees per existing semantics
3. **ExplodePushdown verified** - Predicates pushed before explode when safe
4. **Property tests pass** - Explode pushdown preserves semantics
5. **Python binding works** - `arbor.explode("items")` callable
6. **explain() shows Explode rules** - ExplodePushdown visible when applicable
7. **Benchmark improvement** - Filtered explodes measurably faster

### End-to-End Verification

```bash
# Full CI suite (all phases must pass this)
make ci

# Property tests specifically (Phases 22b-22f)
cargo nextest run -p arbors optimizer_properties

# Benchmark mutation chains (Phase 22c - manual)
# Before: arbor.append(t1).append(t2)...append(t100).len()
# After: Same operation, measure time difference

# Benchmark filtered explodes (Phase 22f - manual)
# Before: arbor.explode("items").filter(doc_predicate).collect()
# After: Same operation with ExplodePushdown, measure time difference
```

### Phase Gate Criteria

**A phase is COMPLETE when:**
- [ ] All items in its Checkpoint checklist are checked
- [ ] All commands in its Tests table return expected results
- [ ] `make ci` passes after merging

### CRITICAL: Test Workflow During Implementation

**DO NOT run `make ci` during edit/test/debug cycles.** It runs 4 compilation passes and takes minutes.

**During development, use targeted nextest commands:**
```bash
# Run specific failing test (FAST - single compile)
cargo nextest run -p arbors-planner test_append_chain

# Run all tests in the crate you're modifying
cargo nextest run -p arbors-planner

# Run property tests
cargo nextest run -p arbors optimizer_properties
```

**Only run `make ci` once** at the end when all targeted tests pass and you're ready for final verification.

---

## Success Criteria Alignment

| Criterion | How Phase 22 Addresses It |
|-----------|---------------------------|
| Rust-first | All optimization logic in Rust; Python is thin binding |
| Fast by default | Mutation elision + Explode pushdown avoid unnecessary work |
| Hard to use wrong | No new footguns; existing ergonomics preserved; jq-style explode |
| Optimized | 14+ rules visible in `explain()` (6 existing + 8 new) |
| Unified | All backings pass same conformance tests (existing) |
| Algebra foundation | QueryPlan is the algebra; documented laws with property tests |

---

## Open Questions (To Resolve During Implementation)

1. **Insert chain collapse?** - Should `insert(0,a).insert(0,b)` collapse? (Semantics are trickier due to position shifting - likely NO)

2. **Remove chain collapse?** - Should `remove([1]).remove([2])` collapse to `remove([1,3])`? (Index adjustment is complex - likely DEFER)

3. **Expression simplification scope** - How deep should constant folding go?
   - Definitely: arithmetic on literals, boolean on literals
   - Maybe: len() on literal strings
   - Later: function calls that are pure

4. **Property test generators** - What arbitrary data generators do we need?
   - `arb_jsonl(size_range)` - Generate valid JSONL
   - `arb_predicate()` - Generate valid filter predicates
   - `arb_tree()` - Generate single tree
   - `arb_jsonl_with_arrays(size_range)` - Generate docs with array fields for explode tests

5. **Proptest vs quickcheck?** - Proptest has better shrinking, more widely used in Rust. Recommend proptest.

6. **Explode binding semantics** - What should the exploded element be bound to?
   - Option A: Named binding via `as_binding` (e.g., `"item"`)
   - Option B: Magic binding like `$item` or `_`
   - Option C: Both - allow named or default
   - Recommend: Option C with default binding name

7. **Explode empty array behavior** - What happens when explode path is empty array?
   - Current trait behavior: produces no output for that document
   - This is correct jq semantics - preserve it

8. **Explode on missing path** - What if the explode path doesn't exist?
   - Current behavior: **pass-through** (the input row is emitted unchanged)
   - Decision: **keep current behavior** for Phase 22 (no error; no drop-row)

**Follow-on (Phase 22+)**: if we ever want a strict variant, add a *separate* operator or flag (e.g., `explode_strict`) rather than changing baseline semantics.

---

## Summary

Phase 22 establishes **architectural discipline first** (handle extraction, formalized algebra with property tests), then delivers **meaningful optimizations** (mutation elision, expression simplification, Explode operator with pushdown).

### Key Design Decisions

1. **QueryPlan IS the algebra** - No separate logical layer needed
2. **Property-based tests prove correctness** - Each optimization rule tested for semantic equivalence
3. **Handle extraction reduces friction** - 8 focused modules instead of 1 monolithic file
4. **Explode completes the jq-style algebra** - The critical missing operator for array expansion
5. **Incremental improvement** - Each phase delivers independently valuable results

### Execution Order

```
22a: Handle Extraction        -> Reduced friction, better navigation
22b: Algebra Tests            -> Proven optimization correctness
22c: Mutation Elision         -> Performance wins for mutation chains
22d: Expression Infrastructure -> Variables, free_vars, ArrayFilter, short-circuit (PREREQUISITE)
22e: Expression Simplify      -> Cleaner expression evaluation (uses 22d)
22f: Explode Operator         -> Array expansion with optimizer support (uses 22d) - THE big win
```

### What Makes Phase 22 Special

The **Explode operator + ExplodePushdown rule** is the crown jewel:

```python
# Before: explode ALL documents, then filter (O(docs * items))
arbor.explode("items").filter(path("category") == "books")

# After optimization: filter documents FIRST, then explode (O(matching_docs * items))
# If 1% of docs are books, this is 100x faster
```

This optimization is impossible without `Explode` in QueryPlan. Phase 22f unlocks it.

The key trade-off is **proven correctness over speed of delivery**. Property-based tests add effort but prevent subtle semantic bugs in optimizations.
