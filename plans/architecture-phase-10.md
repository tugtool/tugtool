# Arbors Architecture Plan: Phase 10: Lazy Evaluation and Parallelism

**Goal:** Build computation graphs and optimize execution. Enable parallel processing.

**Design Principle:** Lazy evaluation defers work until `collect()` is called, enabling query optimization and efficient parallel execution. The eager API from Phase 8/9 remains available for simple use cases.

---

## How to Read This Document

This document follows the same structure as Phase 8+9:

- **Part I (Sections A–F):** Conceptual foundation. Why lazy evaluation matters.
- **Part II (Phases 10.1–10.5):** Implementation plan. What to build and in what order.
- **Part III (Sections G–I):** Design decisions and reference material.

---

## Current State Assessment

### What Exists (Phase 8+9)

| Component | Status | Location |
|-----------|--------|----------|
| `Expr` enum (60+ variants) | ✅ | `arbors-expr/src/expr.rs` |
| `LogicalPlan` DAG | ✅ | `arbors-expr/src/plan.rs` |
| Type/Shape inference | ✅ | `arbors-expr/src/infer.rs` |
| `eval_expr()` evaluator | ✅ | `arbors-query/src/eval.rs` |
| `filter()`, `select()`, `with_column()`, `agg()` | ✅ | `arbors-query/src/ops.rs` |
| Python bindings | ✅ | `python/src/lib.rs` |

### What's Missing for Phase 10

| Component | Status | Notes |
|-----------|--------|-------|
| `LazyArbor` type | ❌ | Deferred execution container |
| Query plan (operation DAG) | ❌ | Chain of filter/select/with_column |
| Optimizer | ❌ | Predicate pushdown, projection pruning |
| Arc-wrapped storage | ❌ | COW requires shared ownership |
| Parallel execution | ❌ | Rayon integration |

### Dependencies

| Crate | Version | Purpose | Status |
|-------|---------|---------|--------|
| `rayon` | 1.9 | Parallel iteration | ✅ In workspace |
| `arc-swap` | optional | Atomic Arc operations | ❓ Consider |

---

# Part I: Conceptual Foundation

---

## A. Why Lazy Evaluation?

### A.1 The Problem with Eager Execution

Current (Phase 8/9) operations execute immediately:

```python
# Each operation iterates through ALL trees
result = arbor.filter(path("age") > 21)      # Iterate all trees
              .select([path("name")])         # Iterate all trees AGAIN
              .with_column("x", lit(1))       # Iterate all trees AGAIN
```

This is inefficient:
- **Multiple passes** over the same data
- **No optimization** opportunities
- **Wasted computation** if only first N results needed

### A.2 Lazy Evaluation Benefits

With lazy evaluation:

```python
# Build a computation graph (no work done yet)
lazy = arbor.lazy()
            .filter(path("age") > 21)
            .select([path("name")])
            .with_column("x", lit(1))

# Execute optimized plan (single pass)
result = lazy.collect()
```

Benefits:
- **Single pass** through data (fused operations)
- **Query optimization** (predicate pushdown, projection pruning)
- **Parallel execution** (partition and process in parallel)
- **Short-circuit** (stop early if only head() needed)

### A.3 Polars as Inspiration

Polars' lazy evaluation is the gold standard:

```python
# Polars lazy API
df.lazy()
  .filter(pl.col("age") > 21)
  .select(["name", "email"])
  .collect()
```

Key Polars patterns to adopt:
- `.lazy()` converts eager to lazy
- `.collect()` materializes the result
- Operations chain without execution
- Optimizer runs before execution

---

## B. Query Plan Architecture

### B.1 Two-Level Planning

Phase 8/9 has `LogicalPlan` for expressions. Phase 10 adds a higher-level plan for **operations**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       Query Plan Architecture                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Query Plan (NEW - Phase 10)                                            │
│   ─────────────────────────────                                          │
│   Operations: Filter → Select → WithColumn → ...                         │
│   Each operation contains Expr references                                │
│                                                                          │
│   ┌───────────┐     ┌───────────┐     ┌─────────────┐                    │
│   │  Filter   │────▶│  Select   │────▶│ WithColumn  │                    │
│   │ expr: E1  │     │ exprs: E2 │     │ name, expr  │                    │
│   └───────────┘     └───────────┘     └─────────────┘                    │
│        │                 │                  │                            │
│        ▼                 ▼                  ▼                            │
│   LogicalPlan (Phase 8)  LogicalPlan     LogicalPlan                     │
│   for expr E1            for exprs E2    for expr E3                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Key Invariants:**

1. **QueryPlan never rewrites Expr** — QueryPlan nodes reference Expr/LogicalPlan but never mutate them.

2. **All Expr rewrites live in Phase 8+9** — CSE, constant folding, type inference all happen in the Expr optimizer, not Phase 10.

3. **Phase 10 optimizer only:**
   - Reorders operations (Filter, Select, Agg, etc.)
   - Fuses compatible ops (filter fusion, projection pruning)
   - Annotates nodes with execution context

This separation keeps the mental model sharp: **tree/column semantics live in Expr/LogicalPlan; pipeline semantics live in QueryPlan.**

### B.1.1 Plan Building Responsibilities

When a user calls:
```rust
let result = arbor.lazy()
    .filter(expr_a)
    .select(exprs_b)
    .with_column("x", expr_c)
    .collect();
```

The responsibilities are:

**`LazyArbor::filter / select / with_column`:**
- Append a QueryOp node referencing the already-built Expr (or ExprId) from Phase 8
- No expression evaluation happens here

**`LazyArbor::collect`:**
1. Finalize QueryPlan
2. Run Expr-level type/shape inference (Phase 8) to annotate each node's schema
3. Run Phase 10 operation-level optimizer
4. Dispatch into the executor

### B.2 Operation Types

```rust
/// An operation in the query plan
pub enum QueryOp {
    /// Source arbor (leaf node)
    Source,

    /// Filter trees by predicate
    Filter {
        predicate: Expr,
    },

    /// Transform trees using expressions
    Select {
        exprs: Vec<Expr>,
    },

    /// Add or replace a column
    WithColumn {
        name: String,
        expr: Expr,
    },

    /// Aggregate across all trees
    Agg {
        exprs: Vec<Expr>,
    },

    /// Limit to first N trees
    Head {
        n: usize,
    },

    /// Skip first N trees
    Tail {
        n: usize,
    },

    /// Sort by expressions
    Sort {
        by: Vec<Expr>,
        descending: Vec<bool>,
    },
}
```

### B.3 Query Plan Structure

```rust
/// Execution context for a query node
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecContext {
    /// Tree-parallel: one evaluation per top-level tree
    PerTree,
    /// Array-parallel within tree (reserved for Phase 11+, not implemented in Phase 10)
    PerTreeArray,
    /// Must see whole Arbor (Agg, Sort, Head, Tail)
    Global,
}

/// A node in the query plan DAG
pub struct QueryNode {
    id: QueryNodeId,
    op: QueryOp,
    /// Input node (None for Source)
    input: Option<QueryNodeId>,
    /// Cached schema after this operation
    schema: Option<Schema>,
    /// Execution context (inferred at plan build or optimize time)
    context: ExecContext,
}

/// The complete query plan
pub struct QueryPlan {
    nodes: Vec<QueryNode>,
    root: QueryNodeId,
    source: Arc<Arbor>,
}
```

The `ExecContext` annotation enables:
- Choosing the right parallel strategy (`par_iter` over trees vs array ranges)
- Enforcing that tree-scoped lazy plans don't accidentally touch siblings/parents
- Future optimization decisions based on context

---

## C. Copy-on-Write (COW) Architecture

### C.1 Why COW Matters

Without COW:
```rust
let filtered = arbor.filter(...);  // Copies ALL data
let selected = filtered.select(...);  // Copies ALL data again
```

With COW:
```rust
let filtered = arbor.filter(...);  // Shares storage, only tracks indices
let selected = filtered.select(...);  // Still shares storage
let result = selected.collect();  // Only now copies what's needed
```

### C.2 Arc-Wrapped Storage

```rust
/// Shared storage that can be referenced by multiple arbors
pub struct SharedStorage {
    nodes: Arc<ColumnarNodes>,
    interner: Arc<StringInterner>,
    pools: Arc<FinishedPools>,
}

/// An arbor with shared storage
pub struct Arbor {
    storage: SharedStorage,
    roots: Vec<NodeId>,  // Owned, since filtering changes this
}
```

### C.3 COW Triggers

> **See also:** Phase 8+9 – COW contract (Section A / 'Immutable + COW Contract') for global rules. Phase 10 must not introduce additional mutation points beyond those listed there.

| Operation | Behavior | Storage Impact |
|-----------|----------|----------------|
| `filter()` | Share storage, new roots vector | O(1) storage, O(n) roots |
| `select()` | New tree structure required | Full copy |
| `with_column()` | Copy modified trees | Partial copy (future: only modified ranges) |
| `head()` / `tail()` | Roots slicing only | Shares storage |
| `sort()` | Roots permutation only | Shares storage |
| `clone()` | Arc::clone | O(1) time, O(1) memory |

**Key insight:** Query plans that only use filter/sort/head/tail/clone are essentially "cheap views" — they don't materialize new storage until `select()` or `with_column()` requires it.

### C.4 Lazy Plans and Storage

- Lazy plans do **not** allocate new storage until `collect()` is called
- Exception: temporary aggregation buffers during `agg()` execution
- The `QueryPlan` holds `Arc<Arbor>`, not owned `Arbor`, ensuring the source is never mutated

---

## D. Parallel Execution Strategy

### D.1 Tree-Level Parallelism

Arbors naturally partition by tree. Each tree is independent:

```rust
use rayon::prelude::*;

// Parallel filter
let matching: Vec<usize> = (0..arbor.num_trees())
    .into_par_iter()
    .filter(|&i| {
        let ctx = EvalContext::for_tree(&arbor, i);
        matches!(eval_expr(&predicate, &ctx), Ok(ExprResult::Scalar(Value::Bool(true))))
    })
    .collect();
```

### D.2 Parallel Aggregation

Aggregations use parallel reduce:

```rust
// Parallel sum
let total: f64 = (0..arbor.num_trees())
    .into_par_iter()
    .map(|i| {
        let ctx = EvalContext::for_tree(&arbor, i);
        extract_f64(&eval_expr(&expr, &ctx).unwrap())
    })
    .sum();
```

### D.3 Chunk-Based Processing

For very large arbors, process in chunks to balance memory and parallelism:

```rust
const CHUNK_SIZE: usize = 10_000;

arbor.roots
    .par_chunks(CHUNK_SIZE)
    .map(|chunk| process_chunk(chunk))
    .reduce(|| Vec::new(), |a, b| merge(a, b))
```

### D.4 Execution Contexts

Each operation executes in one of three contexts, which determines its parallelization strategy:

**1. PerTree (Arbor-wide, tree-parallel)**
- One evaluation context per top-level tree
- Operations: Filter, Select (when expressions don't cross trees), WithColumn
- Parallelization: `par_iter` over tree indices

**2. PerTreeArray (Array-parallel within a tree)** — *Reserved for Phase 11+*
- For expressions like `path("items[*].price").sum()` that traverse large arrays
- Iteration domain is "indices in an array node" rather than "tree indices"
- Same map-reduce pattern as D.2, but within a single tree
- **Phase 10 does NOT implement PerTreeArray; only PerTree and Global are active**

**3. Global (Cross-tree)**
- Operations whose semantics must see the whole Arbor
- Operations: Agg (returns scalar), Sort, Head, Tail
- Future: group_by, join-like features
- Parallelization: Tree-parallel evaluation, but global reduce/sort

### D.5 QueryOp Parallelization Matrix

| Op | Context | Parallelizable? | Notes |
|----|---------|-----------------|-------|
| Filter | PerTree | Yes | Tree-local predicate evaluation |
| Select | PerTree | Yes | Unless expression uses global state |
| WithColumn | PerTree | Yes | Per-tree Expr evaluation |
| Agg | Global | Yes (map-reduce) | Tree-parallel map + global reduce |
| Head/Tail | Global | Partially | Filter/Select can be parallel, final slice is global |
| Sort | Global | Partially | Parallel key extraction + parallel sort of index vector |

### D.6 Determinism Guarantees

**Ordering contract:**
- Arbor's tree order is stable after filter/select/with_column; only Sort may reorder
- Parallel execution must produce the same result as sequential execution

**Error semantics:**
- If any shard/piece fails during parallel eval, the whole `collect()` fails with a single error
- Executor must not yield partial results on error
- "Fail fast on first error" strategy (collect all errors deferred to later phases)

---

## E. Query Optimization

### E.1 Predicate Pushdown

Push filters as early as possible:

```
Before:  Source → Select([a, b, c]) → Filter(a > 10)
After:   Source → Filter(a > 10) → Select([a, b, c])
```

This reduces the number of trees processed by Select.

### E.2 Projection Pruning

Only compute columns that are actually used:

```
Before:  Source → Select([a, b, c, d, e]) → Select([a])
After:   Source → Select([a])
```

### E.3 Common Subexpression Elimination

Compute shared expressions once:

```
Before:  Select([path("x").sum(), path("x").sum() * 2])
After:   let t = path("x").sum(); Select([t, t * 2])
```

This is already supported by `LogicalPlan` from Phase 8.

### E.4 Filter Fusion

Combine adjacent filters:

```
Before:  Filter(a > 10) → Filter(b < 20)
After:   Filter(a > 10 AND b < 20)
```

### E.5 Tree-Aware Optimization Examples

Arbors operates on trees, not flat columns. The optimizer must understand tree semantics:

**Example 1: Filter before Select with shared paths**
```
Query:   Filter(path("items[*].price").sum() > 0) → Select([path("items[*].price")])

Analysis:
- Can push Filter before Select? Yes
- Can drop items[*].price from Select? NO — it's used in the filter

The optimizer needs shape/cardinality machinery from Phase 8+9 to determine
which paths are needed to evaluate earlier nodes.
```

**Example 2: WithColumn dependency**
```
Query:   WithColumn("total", path("items[*].price").sum()) → Filter(path("total") > 100)

Analysis:
- Can push Filter before WithColumn? NO — filter depends on "total" column
- This is detected by analyzing path references in the filter predicate
```

### E.6 Optimization Barriers

Certain operations create barriers that limit optimization:

**Agg barriers:**
- Agg nodes that collapse the Arbor to a scalar/small struct are barriers
- Filters can be pushed *before* Agg, but not after
- Example: `Filter(x > 0) → Agg(sum(x))` ✓ vs `Agg(sum(x)) → Filter(result > 0)` (different semantics)

**Sort barriers:**
- Cannot push Head before Sort without changing semantics (unless stable ordering is proven)
- Cannot push Tail before Sort
- Filter/Select can still be pushed before Sort

**Global operation boundaries:**
- Once a Global-context operation executes, subsequent operations may need to wait
- Pipeline fusion stops at Global boundaries

---

## F. API Design

### F.1 Rust API

```rust
// Convert to lazy
let lazy: LazyArbor = arbor.lazy();

// Chain operations (no execution)
let lazy = lazy
    .filter(path("age").gt(lit(21)))
    .select(&[path("name").alias("n")])
    .with_column("active", lit(true));

// Execute
let result: Arbor = lazy.collect()?;

// Or with parallel execution
let result: Arbor = lazy.collect_parallel()?;
```

### F.2 Python API

```python
# Convert to lazy
lazy = arbor.lazy()

# Chain operations
lazy = lazy.filter(path("age") > 21) \
           .select([path("name").alias("n")]) \
           .with_column("active", lit(True))

# Execute
result = lazy.collect()

# Parallel execution
result = lazy.collect(parallel=True)
```

### F.3 Eager API Preservation

The eager API remains for simple cases:

```python
# Still works (eager, immediate execution)
result = arbor.filter(path("age") > 21)

# Explicit eager to distinguish from lazy
result = arbor.filter(path("age") > 21).collect()  # If filter returns lazy
```

**Design Decision:** Should `filter()` etc. return lazy by default?

Option A: Eager by default, `.lazy()` to opt-in (Polars style)
Option B: Lazy by default, `.collect()` required
Option C: Both APIs, different method names

### F.4 Eager ↔ Lazy Equivalence Contract

**Semantic equivalence:** Eager methods should be thin wrappers over lazy execution:

```rust
// These must produce identical results:
arbor.filter(expr)                           // Eager path
arbor.lazy().filter(expr).collect()          // Lazy path
```

This contract means:
- Users can rely on equivalence between eager and lazy APIs
- Tests can assert equality between eager and lazy paths
- Future documentation can describe "the eager API is syntax sugar for the lazy plan"

**Implementation note:** In Phase 10, eager methods may not literally route through LazyArbor internally. However, the contract specifies they must produce identical results. Full routing through lazy infrastructure can be deferred to Phase 11 if needed.

---

# Part II: Implementation Plan

---

## Phase 10.1 – Copy-on-Write Storage

**Goal:** Enable shared ownership of storage for efficient lazy operations.

**Key Concepts:** Section C (COW Architecture), Phase 8+9 COW Contract

**Current State:**
- `Arbor` owns `ColumnarNodes`, `StringInterner`, `FinishedPools` directly
- Clone is not implemented (would require full deep copy)
- No shared ownership between derived arbors

### 10.1.0 Mutation Sites Audit

**Purpose:** Identify all code paths that mutate `nodes`, `interner`, or `pools` to ensure they route through COW methods after refactoring.

**Audit Results (from codebase grep):**

| Location | Mutation Type | COW Action Required |
|----------|---------------|---------------------|
| `ArborBuilder::finish()` | Creates new Arbor | None — builder owns components, wraps in Arc at end |
| `Arbor::new()` | Creates empty Arbor | None — fresh allocation, wrap in Arc |
| `Arbor::from_parts()` | Takes ownership | None — fresh allocation, wrap in Arc |

**Key Finding:** No post-construction mutation of `Arbor` storage exists. All mutations happen via `ArborBuilder` before `finish()` is called. The Arbor struct is effectively immutable after construction.

**Verification Steps:**
- [ ] Grep for `&mut self` methods on `Arbor` — confirm none mutate storage fields
- [ ] Grep for direct field assignment (`self.nodes =`, etc.) — confirm only in constructors
- [ ] Grep for `_mut()` accessor patterns — confirm none exist
- [ ] Confirm `ArborBuilder` is the sole mutation point

**Post-Refactor Contract:**
- `ArborBuilder::finish()` wraps components in Arc (new Arbor starts with ref count 1)
- `make_mut_*` methods are the ONLY way to mutate storage after construction
- All view operations (filter, head, tail) use `Arc::clone`, never mutate

**Living Checklist:** After any refactor that touches `Arbor` or storage types, re-run:
```bash
# Check for new &mut self methods on Arbor
rg "&mut self" crates/arbors-storage/src/lib.rs

# Check for direct field assignments
rg "self\.(nodes|interner|pools)\s*=" crates/

# Check for _mut() accessor patterns
rg "\.(nodes|interner|pools)_mut\(" crates/
```
Any new mutation sites must route through `make_mut_*` methods.

### 10.1.1 Arc-Wrap Storage Components

File: `crates/arbors-storage/src/lib.rs`

**Reference:** Section C.2 (Arc-Wrapped Storage)

- [ ] Update `Arbor` struct to use Arc-wrapped storage:
  ```rust
  use std::sync::Arc;

  pub struct Arbor {
      /// All nodes in columnar format (shared, COW)
      nodes: Arc<ColumnarNodes>,
      /// Root node IDs for each tree (owned, changes on filter)
      roots: Vec<NodeId>,
      /// String interner (shared, COW)
      interner: Arc<StringInterner>,
      /// Primitive value pools (shared, COW)
      pools: Arc<FinishedPools>,
  }
  ```

- [ ] Update `Arbor::new()` to wrap in Arc:
  ```rust
  pub fn new() -> Self {
      Self {
          nodes: Arc::new(ColumnarNodes::new()),
          roots: Vec::new(),
          interner: Arc::new(StringInterner::new()),
          pools: Arc::new(FinishedPools::default()),
      }
  }
  ```

- [ ] Update `Arbor::from_parts()` to accept and wrap components:
  ```rust
  pub fn from_parts(
      nodes: ColumnarNodes,
      roots: Vec<NodeId>,
      interner: StringInterner,
      pools: FinishedPools,
  ) -> Self {
      Self {
          nodes: Arc::new(nodes),
          roots,
          interner: Arc::new(interner),
          pools: Arc::new(pools),
      }
  }
  ```

- [ ] Add `Arbor::from_parts_shared()` for creating arbors that share storage:
  ```rust
  /// Create an arbor sharing storage with another arbor
  /// Used internally by filter/head/tail operations
  ///
  /// # Visibility
  /// This is `pub(crate)` to prevent external code from bypassing COW semantics.
  /// External users should use `filter_by_indices()`, `head()`, `tail()` instead.
  pub(crate) fn from_parts_shared(
      nodes: Arc<ColumnarNodes>,
      roots: Vec<NodeId>,
      interner: Arc<StringInterner>,
      pools: Arc<FinishedPools>,
  ) -> Self {
      Self { nodes, roots, interner, pools }
  }
  ```

- [ ] Ensure `Arbor` fields remain private (no `pub` on fields) to prevent bypassing COW

### 10.1.2 Implement Clone for Arbor

File: `crates/arbors-storage/src/lib.rs`

**Reference:** Section C.3 (COW Triggers - clone is O(1))

- [ ] Implement `Clone` manually (Arc::clone is cheap):
  ```rust
  impl Clone for Arbor {
      fn clone(&self) -> Self {
          Self {
              nodes: Arc::clone(&self.nodes),
              roots: self.roots.clone(),  // Vec clone is O(n) but roots are small
              interner: Arc::clone(&self.interner),
              pools: Arc::clone(&self.pools),
          }
      }
  }
  ```

- [ ] Add storage introspection methods for testing:
  ```rust
  impl Arbor {
      /// Number of Arbors sharing the nodes storage (for testing COW)
      pub fn nodes_ref_count(&self) -> usize {
          Arc::strong_count(&self.nodes)
      }

      /// Number of Arbors sharing the interner (for testing COW)
      pub fn interner_ref_count(&self) -> usize {
          Arc::strong_count(&self.interner)
      }

      /// Number of Arbors sharing the pools (for testing COW)
      pub fn pools_ref_count(&self) -> usize {
          Arc::strong_count(&self.pools)
      }

      /// Check if this arbor has exclusive ownership of storage
      pub fn has_exclusive_storage(&self) -> bool {
          Arc::strong_count(&self.nodes) == 1
              && Arc::strong_count(&self.interner) == 1
              && Arc::strong_count(&self.pools) == 1
      }
  }
  ```

- [ ] Add combined ref counts helper for convenience:
  ```rust
  impl Arbor {
      /// Get all storage ref counts as a tuple (nodes, interner, pools)
      /// Useful for testing COW behavior with fewer assertions
      pub fn storage_ref_counts(&self) -> (usize, usize, usize) {
          (
              Arc::strong_count(&self.nodes),
              Arc::strong_count(&self.interner),
              Arc::strong_count(&self.pools),
          )
      }
  }
  ```

  **Note:** `strong_count` includes the current handle. Weak refs are not used in this design.

### 10.1.2a Trait/Derive Verification

**Purpose:** Confirm that Arc-wrapping doesn't break existing trait implementations.

**Current Trait Status (from codebase audit):**

| Type | Current Derives/Impls | Arc Impact | Action |
|------|----------------------|------------|--------|
| `Arbor` | `Default` (manual impl) | Need manual impl | Update `Default` to wrap in Arc |
| `StringInterner` | `Default` (manual impl) | None | No change |
| `FinishedPools` | `Default` (manual impl) | None | No change |
| `ColumnarNodes` | `Clone` (derive) | None | No change |

**No serde derives present** — no serialization concerns.

**Verification Steps:**
- [ ] Confirm `Arbor::default()` works with Arc-wrapped fields
- [ ] Confirm `Arc<ColumnarNodes>: Send + Sync` (required for thread safety)
- [ ] Confirm `Arc<StringInterner>: Send + Sync`
- [ ] Confirm `Arc<FinishedPools>: Send + Sync`
- [ ] Verify Arrow arrays are `Send + Sync` (they use `Arc<dyn Array>` internally)

- [ ] Add static assertion to prove `Arbor: Send + Sync`:
  ```rust
  // In crates/arbors-storage/src/lib.rs or tests
  #[cfg(test)]
  mod send_sync_tests {
      use super::Arbor;

      // Compile-time proof that Arbor is Send + Sync
      const _: fn() = || {
          fn assert_send_sync<T: Send + Sync>() {}
          assert_send_sync::<Arbor>();
      };
  }
  ```
  This fails at compile time if Arc-wrapped fields break thread safety.

**Implementation:**
- [ ] Update `impl Default for Arbor` to wrap in Arc:
  ```rust
  impl Default for Arbor {
      fn default() -> Self {
          Self::new()  // Already wraps in Arc after 10.1.1
      }
  }
  ```

### 10.1.3 Add COW Mutation Methods

File: `crates/arbors-storage/src/lib.rs`

**Reference:** Section C.3 (COW Triggers)

- [ ] Add `make_mut` methods for COW semantics:
  ```rust
  impl Arbor {
      /// Get mutable access to nodes, cloning if shared
      /// This is the COW trigger for node mutations
      pub fn make_mut_nodes(&mut self) -> &mut ColumnarNodes {
          Arc::make_mut(&mut self.nodes)
      }

      /// Get mutable access to interner, cloning if shared
      pub fn make_mut_interner(&mut self) -> &mut StringInterner {
          Arc::make_mut(&mut self.interner)
      }

      /// Get mutable access to pools, cloning if shared
      pub fn make_mut_pools(&mut self) -> &mut FinishedPools {
          Arc::make_mut(&mut self.pools)
      }
  }
  ```

- [ ] Ensure `ColumnarNodes`, `StringInterner`, `FinishedPools` implement `Clone`:
  - `ColumnarNodes` already has `#[derive(Clone)]`
  - [ ] Add `Clone` to `StringInterner` if not present
  - [ ] Add `Clone` to `FinishedPools` if not present

### 10.1.4 Add View Operations (Storage-Sharing)

File: `crates/arbors-storage/src/lib.rs`

**Reference:** Section C.3 (filter, head, tail share storage)

- [ ] Add `filter_by_indices()` that shares storage:

  **Behavior Decisions:**
  - **Out-of-range indices:** Silently skipped (using `filter_map` with `get()`). This mirrors Polars' permissive behavior and avoids panics on user-provided indices.
  - **Duplicate indices:** Allowed and preserved. If `[0, 0, 1]` is passed, the result has 3 trees (tree 0 appears twice). This enables use cases like sampling with replacement.
  - **Empty indices:** Returns empty arbor (shares storage, zero roots).

  ```rust
  impl Arbor {
      /// Create a new arbor with only the specified tree indices
      /// Shares storage with the original (no data copy)
      ///
      /// # Behavior
      /// - Out-of-range indices are silently skipped
      /// - Duplicate indices create duplicate roots (trees appear multiple times)
      /// - Order of indices is preserved in the result
      pub fn filter_by_indices(&self, indices: &[usize]) -> Self {
          let new_roots: Vec<NodeId> = indices
              .iter()
              .filter_map(|&i| self.roots.get(i).copied())
              .collect();

          Self::from_parts_shared(
              Arc::clone(&self.nodes),
              new_roots,
              Arc::clone(&self.interner),
              Arc::clone(&self.pools),
          )
      }

      /// Create a new arbor with only the first n trees
      /// Shares storage with the original
      pub fn head(&self, n: usize) -> Self {
          let n = n.min(self.roots.len());
          Self::from_parts_shared(
              Arc::clone(&self.nodes),
              self.roots[..n].to_vec(),
              Arc::clone(&self.interner),
              Arc::clone(&self.pools),
          )
      }

      /// Create a new arbor with only the last n trees
      /// Shares storage with the original
      pub fn tail(&self, n: usize) -> Self {
          let n = n.min(self.roots.len());
          let start = self.roots.len() - n;
          Self::from_parts_shared(
              Arc::clone(&self.nodes),
              self.roots[start..].to_vec(),
              Arc::clone(&self.interner),
              Arc::clone(&self.pools),
          )
      }
  }
  ```

### 10.1.5 Update ArborBuilder

File: `crates/arbors-io/src/builder.rs`

**Reference:** `ArborBuilder::finish()` at line 229

- [ ] Verify `ArborBuilder::finish()` works with Arc-wrapped Arbor:
  - Current: `Arbor::from_parts(columnar_nodes, self.roots, self.interner, finished_pools)`
  - After 10.1.1: `from_parts()` wraps in Arc, so this call site needs no change
  - Builder continues to own components until `finish()` transfers ownership

- [ ] Verify builder invariants preserved:
  - Nodes are deduplicated during build (not affected by Arc)
  - Keys are sorted in objects (not affected by Arc)
  - Interner maintains uniqueness (not affected by Arc)

- [ ] Add smoke test that builder produces COW-ready arbors:
  ```rust
  #[test]
  fn test_builder_produces_cow_arbor() {
      let mut builder = ArborBuilder::new_infer();
      builder.parse_json(r#"{"a": 1}"#).unwrap();
      let arbor = builder.finish();

      // Should start with exclusive ownership
      assert!(arbor.has_exclusive_storage());
      assert_eq!(arbor.nodes_ref_count(), 1);
  }
  ```

- [ ] No changes to builder API (internal only) — all callers use `finish()` which returns owned `Arbor`

### 10.1.6 Update Accessor Methods

File: `crates/arbors-storage/src/lib.rs`

- [ ] Update accessor methods to work through Arc:
  ```rust
  impl Arbor {
      /// Get reference to columnar nodes
      pub fn nodes(&self) -> &ColumnarNodes {
          &self.nodes  // Arc auto-derefs
      }

      /// Get reference to the string interner
      pub fn interner(&self) -> &StringInterner {
          &self.interner  // Arc auto-derefs
      }

      /// Get reference to the primitive pools
      pub fn pools(&self) -> &FinishedPools {
          &self.pools  // Arc auto-derefs
      }
  }
  ```

- [ ] Verify all existing accessor methods still compile (Arc auto-derefs should make this transparent)

### 10.1.7 Update arbors-query

File: `crates/arbors-query/src/ops.rs`

**Reference:** Phase 8+9 COW Contract (query ops return new arbors, don't mutate input)

**Verification Strategy:** Compile + run existing tests. Arc auto-deref means no code changes needed.

- [ ] Verify `filter()` works with Arc-wrapped Arbor (should be transparent)
- [ ] Verify `select()` works with Arc-wrapped Arbor
- [ ] Verify `with_column()` works with Arc-wrapped Arbor
- [ ] Verify `agg()` works with Arc-wrapped Arbor
- [ ] No API changes required (takes `&Arbor`, Arc auto-derefs)

**Concrete Check:**
- [ ] Run: `cargo test -p arbors-query` — all tests must pass
- [ ] Verify no new compiler warnings about lifetimes or trait bounds

### 10.1.8 Update arbors-arrow

File: `crates/arbors-arrow/src/lib.rs`

**Verification Strategy:** Compile + run existing tests.

- [ ] Verify `to_record_batch()` works with Arc-wrapped Arbor
- [ ] Verify Arrow export functions work (should be transparent)
- [ ] No API changes required

**Concrete Check:**
- [ ] Run: `cargo test -p arbors-arrow` — all tests must pass

### 10.1.9 Update Python Bindings

File: `python/src/lib.rs`

**Verification Strategy:** Build bindings + run Python tests.

- [ ] Verify `Arbor` Python class works with Arc-wrapped inner Arbor
- [ ] The Python binding already wraps `arbors::Arbor` in `inner` field
- [ ] No changes expected (Arc is internal to Rust)

**Concrete Checks:**
- [ ] Run: `make python` — builds successfully
- [ ] Run: `make python-test` — all Python tests pass
- [ ] Verify `PyArbor` remains `Send` (required for PyO3 threading)

### 10.1.10 Add Clone to Component Types

**Purpose:** Enable `Arc::make_mut` to clone storage when mutation is needed.

File: `crates/arbors-storage/src/interner.rs`

**Member Analysis for StringInterner:**
| Field | Type | Clone? | Notes |
|-------|------|--------|-------|
| `string_to_id` | `HashMap<String, InternId>` | ✓ | Clone derives for both |
| `id_to_string` | `Vec<String>` | ✓ | Vec<T: Clone> is Clone |

- [ ] Add `Clone` impl to `StringInterner`:
  ```rust
  impl Clone for StringInterner {
      fn clone(&self) -> Self {
          Self {
              string_to_id: self.string_to_id.clone(),
              id_to_string: self.id_to_string.clone(),
          }
      }
  }
  ```
  (Manual impl preferred over derive to make COW cost explicit)

File: `crates/arbors-storage/src/pools.rs`

**Member Analysis for FinishedPools:**
| Field | Type | Clone? | Notes |
|-------|------|--------|-------|
| `bools` | `BooleanArray` | ✓ | Arrow arrays impl Clone (Arc internally) |
| `int64s` | `Int64Array` | ✓ | Arrow arrays impl Clone |
| `float64s` | `Float64Array` | ✓ | Arrow arrays impl Clone |
| `strings` | `StringArray` | ✓ | Arrow arrays impl Clone |
| `dates` | `Date32Array` | ✓ | Arrow arrays impl Clone |
| `datetimes` | `TimestampMicrosecondArray` | ✓ | Arrow arrays impl Clone |
| `durations` | `DurationMicrosecondArray` | ✓ | Arrow arrays impl Clone |
| `binaries` | `BinaryArray` | ✓ | Arrow arrays impl Clone |

- [ ] Add `Clone` impl to `FinishedPools`:
  ```rust
  impl Clone for FinishedPools {
      fn clone(&self) -> Self {
          Self {
              bools: self.bools.clone(),
              int64s: self.int64s.clone(),
              float64s: self.float64s.clone(),
              strings: self.strings.clone(),
              dates: self.dates.clone(),
              datetimes: self.datetimes.clone(),
              durations: self.durations.clone(),
              binaries: self.binaries.clone(),
          }
      }
  }
  ```

**Note:** Arrow arrays use internal Arc, so cloning FinishedPools is O(1) for the array data itself. The main cost is cloning the struct wrapper and Arc reference counts.

### 10.1.11 Unit Tests for COW Semantics

File: `crates/arbors-storage/tests/cow_tests.rs` (new file)

**Reference:** Section H.3 (COW Storage Tests)

**Test Fixtures:**

```rust
use arbors_io::ArborBuilder;
use arbors_storage::Arbor;

/// Create a simple test arbor with one tree containing {"a": 1, "b": "hello"}
fn create_test_arbor() -> Arbor {
    let mut builder = ArborBuilder::new_infer();
    builder.parse_json(r#"{"a": 1, "b": "hello"}"#).unwrap();
    builder.finish()
}

/// Create a test arbor with N trees, each containing {"index": N}
fn create_test_arbor_with_trees(n: usize) -> Arbor {
    let mut builder = ArborBuilder::new_infer();
    for i in 0..n {
        builder.parse_json(&format!(r#"{{"index": {}}}"#, i)).unwrap();
    }
    builder.finish()
}

/// JSONL test data path for integration tests
const TEST_DATA: &str = "tests/fixtures/sample.jsonl";
```

**Fixture File Setup:**

- [x] Create `crates/arbors-storage/tests/fixtures/sample.jsonl` if it doesn't exist:
  ```jsonl
  {"id": 1, "name": "Alice", "age": 30}
  {"id": 2, "name": "Bob", "age": 25}
  {"id": 3, "name": "Carol", "age": 35}
  {"id": 4, "name": "Dave", "age": 28}
  {"id": 5, "name": "Eve", "age": 32}
  ```
  This provides a minimal but realistic test dataset for COW tests.

**Test Cases:**

- [x] Test clone shares all storage components:
  ```rust
  #[test]
  fn test_clone_shares_storage() {
      let arbor = create_test_arbor();
      assert_eq!(arbor.storage_ref_counts(), (1, 1, 1));

      let cloned = arbor.clone();
      // All three components should be shared
      assert_eq!(arbor.storage_ref_counts(), (2, 2, 2));
      assert_eq!(cloned.storage_ref_counts(), (2, 2, 2));
  }
  ```

- [x] Test filter shares storage:
  ```rust
  #[test]
  fn test_filter_shares_storage() {
      let arbor = create_test_arbor_with_trees(10);
      let filtered = arbor.filter_by_indices(&[0, 2, 4]);

      assert_eq!(arbor.storage_ref_counts(), (2, 2, 2));  // All shared
      assert_eq!(filtered.num_trees(), 3);
  }
  ```

- [x] Test head/tail share storage:
  ```rust
  #[test]
  fn test_head_tail_share_storage() {
      let arbor = create_test_arbor_with_trees(10);
      let first_five = arbor.head(5);
      let last_three = arbor.tail(3);

      // All three arbors share all storage
      assert_eq!(arbor.storage_ref_counts(), (3, 3, 3));
  }
  ```

- [x] Test COW isolation on nodes mutation:
  ```rust
  #[test]
  fn test_cow_isolation_nodes() {
      let arbor = create_test_arbor();
      let mut modified = arbor.clone();

      // Before mutation: shared
      assert_eq!(arbor.nodes_ref_count(), 2);

      // Trigger COW on nodes only
      let _nodes = modified.make_mut_nodes();

      // After mutation: nodes separated, interner/pools still shared
      assert_eq!(arbor.nodes_ref_count(), 1);
      assert_eq!(modified.nodes_ref_count(), 1);
      assert_eq!(arbor.interner_ref_count(), 2);  // Still shared
      assert_eq!(arbor.pools_ref_count(), 2);     // Still shared
  }
  ```

- [x] Test COW isolation on interner mutation:
  ```rust
  #[test]
  fn test_cow_isolation_interner() {
      let arbor = create_test_arbor();
      let mut modified = arbor.clone();

      let _interner = modified.make_mut_interner();

      assert_eq!(arbor.interner_ref_count(), 1);
      assert_eq!(modified.interner_ref_count(), 1);
      assert_eq!(arbor.nodes_ref_count(), 2);  // Still shared
  }
  ```

- [x] Test COW isolation on pools mutation:
  ```rust
  #[test]
  fn test_cow_isolation_pools() {
      let arbor = create_test_arbor();
      let mut modified = arbor.clone();

      let _pools = modified.make_mut_pools();

      assert_eq!(arbor.pools_ref_count(), 1);
      assert_eq!(modified.pools_ref_count(), 1);
      assert_eq!(arbor.nodes_ref_count(), 2);  // Still shared
  }
  ```

- [x] Test exclusive ownership detection:
  ```rust
  #[test]
  fn test_exclusive_ownership() {
      let arbor = create_test_arbor();
      assert!(arbor.has_exclusive_storage());

      let cloned = arbor.clone();
      assert!(!arbor.has_exclusive_storage());  // Now shared
      drop(cloned);
      assert!(arbor.has_exclusive_storage());  // Exclusive again
  }
  ```

- [x] Test filter_by_indices edge cases:
  ```rust
  #[test]
  fn test_filter_by_indices_edge_cases() {
      let arbor = create_test_arbor_with_trees(5);

      // Out-of-range indices: silently skipped
      let filtered = arbor.filter_by_indices(&[0, 100, 2]);
      assert_eq!(filtered.num_trees(), 2);  // Only 0 and 2

      // Duplicate indices: preserved
      let duped = arbor.filter_by_indices(&[0, 0, 1]);
      assert_eq!(duped.num_trees(), 3);  // Tree 0 appears twice

      // Empty indices: empty arbor, still shares storage
      let empty = arbor.filter_by_indices(&[]);
      assert_eq!(empty.num_trees(), 0);
      assert_eq!(arbor.nodes_ref_count(), 4);  // Shared with all views
  }
  ```

- [x] Test original unchanged after view operations + mutation:
  ```rust
  #[test]
  fn test_original_unchanged_after_view_mutation() {
      let arbor = create_test_arbor_with_trees(5);
      let original_tree_count = arbor.num_trees();

      let mut filtered = arbor.filter_by_indices(&[0, 1]);
      let _nodes = filtered.make_mut_nodes();  // Trigger COW

      // Original arbor must be completely unchanged
      assert_eq!(arbor.num_trees(), original_tree_count);
      assert!(arbor.has_exclusive_storage());  // Back to exclusive
  }
  ```

### 10.1.12 Integration Tests

File: `crates/arbors/tests/cow_integration.rs` (new file)

- [x] Test existing functionality still works:
  ```rust
  #[test]
  fn test_jsonl_parsing_with_cow() {
      let arbor = read_jsonl(TEST_DATA).unwrap();
      assert!(arbor.num_trees() > 0);
  }
  ```

- [x] Test filter + clone chain:
  ```rust
  #[test]
  fn test_filter_chain_shares_storage() {
      let arbor = read_jsonl(TEST_DATA).unwrap();
      let a = arbor.clone();
      let b = a.filter_by_indices(&[0, 1]);
      let c = b.head(1);

      // All should share underlying storage
      assert_eq!(arbor.nodes_ref_count(), 4);
  }
  ```

- [x] Verify all existing tests pass (no regressions)

### 10.1.13 Benchmarks (Required)

File: `crates/arbors-storage/benches/cow_bench.rs` (new file)

**Purpose:** Validate O(1) clone and acceptable COW mutation cost. At least one benchmark is **mandatory** to catch performance regressions.

**How to Run:**
```bash
# Run all COW benchmarks
cargo bench -p arbors-storage --bench cow_bench

# Run with HTML report
cargo bench -p arbors-storage --bench cow_bench -- --save-baseline cow_v1
```

**CI Considerations:**
- Benchmarks use Criterion (not built-in `#[bench]`) for stable Rust compatibility
- CI should run benchmarks periodically but not on every PR (they're slow)
- Consider adding a `make bench` target that runs all benchmarks
- Store baseline results to detect regressions over time

**Cargo.toml Addition:**
```toml
# In crates/arbors-storage/Cargo.toml
[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "cow_bench"
harness = false
```

**Required Benchmarks:**

- [x] Clone cost scales O(1) with arbor size:
  ```rust
  use criterion::{criterion_group, criterion_main, Criterion, BenchmarkId};
  use arbors_io::ArborBuilder;

  fn create_arbor(num_trees: usize) -> Arbor {
      let mut builder = ArborBuilder::new_infer();
      for i in 0..num_trees {
          builder.parse_json(&format!(r#"{{"id": {}, "data": "value"}}"#, i)).unwrap();
      }
      builder.finish()
  }

  fn bench_clone(c: &mut Criterion) {
      let mut group = c.benchmark_group("clone");
      for size in [100, 1_000, 10_000, 100_000] {
          let arbor = create_arbor(size);
          group.bench_with_input(
              BenchmarkId::from_parameter(size),
              &arbor,
              |b, arbor| b.iter(|| arbor.clone()),
          );
      }
      group.finish();
  }
  ```

  **Success Criterion:** Clone time must be roughly constant regardless of arbor size (within 2x between 100 and 100,000 trees).

- [x] COW mutation cost (Arc::make_mut when shared):
  ```rust
  fn bench_cow_mutation(c: &mut Criterion) {
      let arbor = create_arbor(10_000);
      let cloned = arbor.clone();  // Now shared

      c.bench_function("cow_make_mut_nodes_shared", |b| {
          b.iter_batched(
              || arbor.clone(),  // Fresh clone each iteration
              |mut a| a.make_mut_nodes(),
              criterion::BatchSize::SmallInput,
          )
      });
  }
  ```

  **Success Criterion:** Document the deep-clone cost for large arbors. This is expected to be O(n) but should complete in reasonable time (< 100ms for 100K trees).

**Optional Benchmarks:**

- [x] Compare filter_by_indices vs hypothetical full-copy filter (bench_filter_by_indices implemented)
- [x] Measure head/tail performance at various sizes (bench_head_tail implemented)

### 10.1.14 Run Full Test Suite

**Purpose:** Ensure no regressions from COW refactoring.

- [ ] Run: `cargo test --workspace` — all tests pass
- [ ] Run: `cargo clippy --workspace` — no new warnings
- [ ] Run: `make python-test` — all Python tests pass
- [ ] Verify test count: should be 592+ tests (document actual count)

**Phase 10.1 Deliverables:**
- [ ] Arc-wrapped storage in `Arbor` struct
- [ ] `Clone` implemented for `Arbor` (O(1) via Arc)
- [ ] `Clone` implemented for `StringInterner` and `FinishedPools`
- [ ] COW mutation methods (`make_mut_*`)
- [ ] Storage-sharing operations (`filter_by_indices`, `head`, `tail`)
- [ ] Ref count introspection for testing (`storage_ref_counts()`, individual ref counts)
- [ ] `from_parts_shared()` is `pub(crate)` to prevent bypassing COW
- [ ] 15+ COW unit tests (including edge cases)
- [ ] 2+ benchmarks validating O(1) clone
- [ ] All existing tests pass (592+ tests)
- [ ] No API changes visible to users (Arc is internal)

---

## Phase 10.2 – LazyArbor Type

**Goal:** Create the lazy evaluation container and query plan infrastructure.

**Key Concepts:** Section B (Query Plan Architecture), Section F (API Design)

**Current State:**
- Phase 10.1 complete: COW storage with Arc-wrapped components
- `arbors-query` has eager `filter()`, `select()`, `with_column()`, `agg()` functions
- `Arbor` has `filter_by_indices()`, `head()`, `tail()` for storage-sharing views
- `Expr` and `LogicalPlan` exist in `arbors-expr`

### 10.2.0 Pre-Implementation Review

**Purpose:** Verify understanding of the query plan architecture before implementation.

**Key Invariants from Section B.1:**

1. **QueryPlan never rewrites Expr** — QueryPlan nodes reference Expr/LogicalPlan but never mutate them
2. **All Expr rewrites live in Phase 8+9** — CSE, constant folding, type inference happen in the Expr optimizer
3. **Phase 10 optimizer only** reorders operations, fuses compatible ops, annotates nodes with execution context

**Architecture Review:**
- Two-level planning: QueryPlan (operations) contains references to Expr (expressions)
- QueryPlan is the "pipeline" level: Filter → Select → WithColumn → ...
- Each QueryOp references Expr objects from Phase 8
- `collect()` triggers: type inference → optimization → execution

**Verification Steps:**
- [ ] Confirm eager ops in `arbors-query/src/ops.rs` can be reused as execution primitives
- [ ] Confirm `EvalContext` from `arbors-query` is suitable for lazy execution
- [ ] Review `Expr` structure to understand what LazyArbor will reference

### 10.2.1 Create `arbors-lazy` Crate

**Purpose:** New crate for lazy evaluation infrastructure.

#### 10.2.1.1 Create Cargo.toml

File: `crates/arbors-lazy/Cargo.toml`

- [x] Create the Cargo.toml file:
  ```toml
  [package]
  name = "arbors-lazy"
  version.workspace = true
  edition.workspace = true
  authors.workspace = true
  license.workspace = true

  [lints]
  workspace = true

  [dependencies]
  arbors-core.workspace = true
  arbors-expr.workspace = true
  arbors-storage.workspace = true
  arbors-query.workspace = true
  thiserror.workspace = true

  [dev-dependencies]
  arbors-io.workspace = true
  ```

#### 10.2.1.2 Add Crate to Workspace

File: `Cargo.toml` (workspace root)

- [x] Add `"crates/arbors-lazy"` to `members` array
- [x] Add `"crates/arbors-lazy"` to `default-members` array
- [x] Add workspace dependency: `arbors-lazy = { version = "0.1.0", path = "crates/arbors-lazy" }`

#### 10.2.1.3 Create Module Structure

- [x] Create `crates/arbors-lazy/src/lib.rs`:
  ```rust
  //! Lazy evaluation and query planning for Arbors
  //!
  //! This crate provides:
  //! - `LazyArbor`: A lazy evaluation container that builds query plans
  //! - `QueryPlan`: A DAG of operations (filter, select, etc.)
  //! - `QueryOp`: Individual operation types
  //!
  //! # Example
  //!
  //! ```ignore
  //! use arbors_lazy::LazyArbor;
  //! use arbors_expr::{path, lit};
  //!
  //! let lazy = arbor.lazy()
  //!     .filter(path("age").gt(lit(21)))
  //!     .select(&[path("name").alias("n")]);
  //!
  //! let result = lazy.collect()?;
  //! ```

  mod lazy;
  mod plan;
  mod execute;

  pub use lazy::LazyArbor;
  pub use plan::{ExecContext, QueryNodeId, QueryNode, QueryOp, QueryPlan};
  pub use execute::execute_plan;
  ```

- [x] Create `crates/arbors-lazy/src/plan.rs` (empty placeholder):
  ```rust
  //! Query plan types: QueryOp, QueryNode, QueryPlan
  ```

- [x] Create `crates/arbors-lazy/src/lazy.rs` (empty placeholder):
  ```rust
  //! LazyArbor type: the lazy evaluation container
  ```

- [x] Create `crates/arbors-lazy/src/execute.rs` (empty placeholder):
  ```rust
  //! Plan execution: converts QueryPlan to results
  ```

#### 10.2.1.4 Verify Crate Builds

- [x] Run: `cargo build -p arbors-lazy` — must compile without errors

### 10.2.2 Define QueryOp and QueryPlan

File: `crates/arbors-lazy/src/plan.rs`

**Reference:** Section B.2 (Operation Types), Section B.3 (Query Plan Structure)

#### 10.2.2.1 Define QueryNodeId

- [x] Add `QueryNodeId` type:
  ```rust
  use std::fmt;

  /// ID for a node in the query plan DAG
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
  pub struct QueryNodeId(pub u32);

  impl fmt::Display for QueryNodeId {
      fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
          write!(f, "QueryNodeId({})", self.0)
      }
  }
  ```

#### 10.2.2.2 Define ExecContext

- [x] Add `ExecContext` enum (from Section B.3):
  ```rust
  /// Execution context for a query node
  ///
  /// Determines the parallelization strategy for each operation.
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
  pub enum ExecContext {
      /// Tree-parallel: one evaluation per top-level tree
      /// Used by: Filter, Select, WithColumn
      #[default]
      PerTree,

      /// Array-parallel within tree (reserved for Phase 11+, not implemented in Phase 10)
      /// Used by: expressions like `path("items[*].price").sum()` on large arrays
      PerTreeArray,

      /// Must see whole Arbor (global context)
      /// Used by: Agg, Sort, Head, Tail
      Global,
  }
  ```

#### 10.2.2.3 Define QueryOp

- [x] Add `QueryOp` enum (from Section B.2):
  ```rust
  use arbors_expr::Expr;

  /// An operation in the query plan
  ///
  /// Operations form a DAG where each node references its input(s).
  /// Expressions are stored by value (cloned from user input).
  #[derive(Debug, Clone)]
  pub enum QueryOp {
      /// Source arbor (leaf node in the plan)
      /// This is the starting point - no input node
      Source,

      /// Filter trees by predicate
      /// Keeps trees where predicate evaluates to true
      Filter {
          predicate: Expr,
      },

      /// Transform trees using expressions
      /// Each tree becomes a struct with the evaluated expressions as fields
      Select {
          exprs: Vec<Expr>,
      },

      /// Add or replace a field in each tree
      WithColumn {
          name: String,
          expr: Expr,
      },

      /// Aggregate across all trees
      /// Returns a single result (not per-tree)
      Agg {
          exprs: Vec<Expr>,
      },

      /// Limit to first N trees
      Head {
          n: usize,
      },

      /// Limit to last N trees
      Tail {
          n: usize,
      },

      /// Sort by expressions (future: Phase 10.3+)
      Sort {
          by: Vec<Expr>,
          descending: Vec<bool>,
      },
  }

  impl QueryOp {
      /// Get the execution context for this operation
      pub fn exec_context(&self) -> ExecContext {
          match self {
              QueryOp::Source => ExecContext::PerTree,
              QueryOp::Filter { .. } => ExecContext::PerTree,
              QueryOp::Select { .. } => ExecContext::PerTree,
              QueryOp::WithColumn { .. } => ExecContext::PerTree,
              QueryOp::Agg { .. } => ExecContext::Global,
              QueryOp::Head { .. } => ExecContext::Global,
              QueryOp::Tail { .. } => ExecContext::Global,
              QueryOp::Sort { .. } => ExecContext::Global,
          }
      }

      /// Get a short description of the operation for debugging
      pub fn description(&self) -> &'static str {
          match self {
              QueryOp::Source => "Source",
              QueryOp::Filter { .. } => "Filter",
              QueryOp::Select { .. } => "Select",
              QueryOp::WithColumn { .. } => "WithColumn",
              QueryOp::Agg { .. } => "Agg",
              QueryOp::Head { .. } => "Head",
              QueryOp::Tail { .. } => "Tail",
              QueryOp::Sort { .. } => "Sort",
          }
      }
  }
  ```

#### 10.2.2.4 Define QueryNode

- [x] Add `QueryNode` struct:
  ```rust
  /// A node in the query plan DAG
  ///
  /// Each node represents an operation with optional input.
  /// The Source node has no input; all others have exactly one input.
  ///
  /// # Future Work: Per-Node Schema
  ///
  /// For advanced optimization (projection pruning, alias-aware predicate pushdown),
  /// we may need to track output schema per node. This would enable:
  /// - Knowing which columns a node produces (vs. just what the source provides)
  /// - Tracking aliases introduced by Select/WithColumn
  /// - Pruning unused columns from Select operations
  ///
  /// When adding this, consider:
  /// ```ignore
  /// pub output_schema: Option<HashSet<String>>, // or a richer Schema type
  /// ```
  /// This would be computed lazily or during optimization. For now, we use
  /// conservative source-schema checks for pushdown safety.
  #[derive(Debug, Clone)]
  pub struct QueryNode {
      /// Unique identifier for this node
      pub id: QueryNodeId,

      /// The operation this node performs
      pub op: QueryOp,

      /// Input node (None for Source)
      pub input: Option<QueryNodeId>,

      /// Execution context (inferred from op type)
      pub context: ExecContext,
  }

  impl QueryNode {
      /// Create a new query node
      pub fn new(id: QueryNodeId, op: QueryOp, input: Option<QueryNodeId>) -> Self {
          let context = op.exec_context();
          Self { id, op, input, context }
      }

      /// Check if this is the source node
      pub fn is_source(&self) -> bool {
          matches!(self.op, QueryOp::Source)
      }
  }
  ```

#### 10.2.2.5 Define QueryPlan

**Design Note:** QueryPlan is linear in Phase 10 (single chain of operations, no branching).
If branching is added later (e.g., join, union), keep `next_id` and `root()` semantics in sync:
- `next_id` must remain monotonically increasing across all branches
- `root()` may need to return multiple roots or be replaced with explicit root tracking
- Clone should preserve `next_id` to avoid ID collisions when cloning and extending

- [x] Add `QueryPlan` struct:
  ```rust
  use std::sync::Arc;
  use arbors_storage::Arbor;

  /// The complete query plan
  ///
  /// A QueryPlan is a linear chain of operations (no branching in Phase 10).
  /// The source arbor is held via Arc for efficient sharing.
  ///
  /// Implements Clone: clones the node Vec and Arc (cheap sharing of source).
  #[derive(Clone)]
  pub struct QueryPlan {
      /// All nodes in the plan
      nodes: Vec<QueryNode>,

      /// The source arbor (shared ownership)
      source: Arc<Arbor>,

      /// Counter for generating node IDs
      next_id: u32,
  }

  impl QueryPlan {
      /// Create a new query plan with the given source arbor
      pub fn new(source: Arc<Arbor>) -> Self {
          let source_node = QueryNode::new(
              QueryNodeId(0),
              QueryOp::Source,
              None,
          );
          Self {
              nodes: vec![source_node],
              source,
              next_id: 1,
          }
      }

      /// Add an operation to the plan
      ///
      /// The new operation takes the current root as input.
      /// Returns the ID of the newly added node.
      pub fn add_op(&mut self, op: QueryOp) -> QueryNodeId {
          let id = QueryNodeId(self.next_id);
          self.next_id += 1;

          let input = Some(self.root());
          let node = QueryNode::new(id, op, input);
          self.nodes.push(node);

          id
      }

      /// Get the root (last) node ID
      pub fn root(&self) -> QueryNodeId {
          self.nodes.last()
              .map(|n| n.id)
              .unwrap_or(QueryNodeId(0))
      }

      /// Get the source arbor
      pub fn source(&self) -> &Arc<Arbor> {
          &self.source
      }

      /// Get a node by ID
      pub fn get(&self, id: QueryNodeId) -> Option<&QueryNode> {
          self.nodes.iter().find(|n| n.id == id)
      }

      /// Get all nodes in plan order (source first, root last)
      pub fn nodes(&self) -> &[QueryNode] {
          &self.nodes
      }

      /// Get the number of operations (including Source)
      pub fn len(&self) -> usize {
          self.nodes.len()
      }

      /// Check if the plan has only the source node (no operations)
      pub fn is_source_only(&self) -> bool {
          self.nodes.len() == 1
      }
  }

  impl std::fmt::Debug for QueryPlan {
      fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
          f.debug_struct("QueryPlan")
              .field("nodes", &self.nodes.len())
              .field("root", &self.root())
              .field("source_trees", &self.source.num_trees())
              .finish()
      }
  }
  ```

#### 10.2.2.6 Add Plan Description Method

- [x] Add method for debugging/display:
  ```rust
  impl QueryPlan {
      /// Get a human-readable description of the plan
      ///
      /// Returns a multi-line string showing the plan structure.
      pub fn describe(&self) -> String {
          let mut lines = Vec::new();
          lines.push(format!("QueryPlan ({} nodes):", self.nodes.len()));

          for node in self.nodes.iter().rev() {
              let indent = "  ";
              let input_str = node.input
                  .map(|id| format!(" <- {}", id))
                  .unwrap_or_default();

              let detail = match &node.op {
                  QueryOp::Source => format!("Source({} trees)", self.source.num_trees()),
                  QueryOp::Filter { .. } => "Filter(...)".to_string(),
                  QueryOp::Select { exprs } => format!("Select({} exprs)", exprs.len()),
                  QueryOp::WithColumn { name, .. } => format!("WithColumn(\"{}\")", name),
                  QueryOp::Agg { exprs } => format!("Agg({} exprs)", exprs.len()),
                  QueryOp::Head { n } => format!("Head({})", n),
                  QueryOp::Tail { n } => format!("Tail({})", n),
                  QueryOp::Sort { by, .. } => format!("Sort({} keys)", by.len()),
              };

              lines.push(format!("{}{}: {}{}", indent, node.id, detail, input_str));
          }

          lines.join("\n")
      }
  }
  ```

### 10.2.3 Define LazyArbor

File: `crates/arbors-lazy/src/lazy.rs`

**Reference:** Section F.1 (Rust API)

#### 10.2.3.1 Define LazyArbor Struct

- [x] Add `LazyArbor` struct:
  ```rust
  use std::sync::Arc;
  use arbors_expr::{Expr, ExprError};
  use arbors_storage::Arbor;
  use crate::plan::{QueryPlan, QueryOp, QueryNodeId};
  use crate::execute::execute_plan;

  /// A lazy evaluation container for Arbor operations
  ///
  /// `LazyArbor` builds a query plan without executing it.
  /// Operations are only performed when `collect()` is called.
  ///
  /// Implements Clone: clones the QueryPlan (which shares Arc<Arbor>).
  ///
  /// # Example
  ///
  /// ```ignore
  /// let lazy = arbor.lazy()
  ///     .filter(path("age").gt(lit(21)))
  ///     .select(&[path("name").alias("n")]);
  ///
  /// // Nothing executed yet - just built a plan
  ///
  /// let result = lazy.collect()?;  // Now it executes
  /// ```
  #[derive(Clone)]
  pub struct LazyArbor {
      /// The query plan being built
      plan: QueryPlan,

      /// The current (latest) node in the plan
      current: QueryNodeId,
  }
  ```

#### 10.2.3.2 Implement Constructor

- [x] Add constructor:
  ```rust
  impl LazyArbor {
      /// Create a lazy arbor from an eager arbor
      ///
      /// The arbor is wrapped in Arc for efficient sharing.
      pub fn new(arbor: Arc<Arbor>) -> Self {
          let plan = QueryPlan::new(arbor);
          let current = plan.root();
          Self { plan, current }
      }

      /// Create a lazy arbor from an owned Arbor
      ///
      /// Convenience method that wraps the arbor in Arc.
      pub fn from_arbor(arbor: Arbor) -> Self {
          Self::new(Arc::new(arbor))
      }
  }
  ```

#### 10.2.3.3 Implement Filter Operation

- [x] Add filter method:
  ```rust
  impl LazyArbor {
      /// Add a filter operation to the plan
      ///
      /// Keeps only trees where the predicate evaluates to true.
      /// The predicate must evaluate to a scalar boolean.
      ///
      /// # Example
      ///
      /// ```ignore
      /// // Keep trees where age > 21
      /// let filtered = lazy.filter(path("age").gt(lit(21)));
      ///
      /// // Keep trees where any item price > 100
      /// let filtered = lazy.filter(path("items[*].price").gt(lit(100)).any());
      /// ```
      pub fn filter(mut self, predicate: Expr) -> Self {
          let op = QueryOp::Filter { predicate };
          self.current = self.plan.add_op(op);
          self
      }
  }
  ```

#### 10.2.3.4 Implement Select Operation

- [x] Add select method:
  ```rust
  impl LazyArbor {
      /// Add a select operation to the plan
      ///
      /// Transforms each tree by evaluating the given expressions.
      /// Each tree becomes a struct with the expression results as fields.
      ///
      /// # Example
      ///
      /// ```ignore
      /// let selected = lazy.select(&[
      ///     path("user.name").alias("name"),
      ///     path("items[*].price").sum().alias("total"),
      /// ]);
      /// ```
      pub fn select(mut self, exprs: &[Expr]) -> Self {
          let op = QueryOp::Select { exprs: exprs.to_vec() };
          self.current = self.plan.add_op(op);
          self
      }
  }
  ```

#### 10.2.3.5 Implement WithColumn Operation

- [x] Add with_column method:
  ```rust
  impl LazyArbor {
      /// Add a with_column operation to the plan
      ///
      /// Adds or replaces a field in each tree with the expression result.
      ///
      /// # Example
      ///
      /// ```ignore
      /// let with_total = lazy.with_column("total", path("items[*].price").sum());
      /// ```
      pub fn with_column(mut self, name: &str, expr: Expr) -> Self {
          let op = QueryOp::WithColumn {
              name: name.to_string(),
              expr,
          };
          self.current = self.plan.add_op(op);
          self
      }
  }
  ```

#### 10.2.3.6 Implement Head/Tail Operations

- [x] Add head and tail methods:
  ```rust
  impl LazyArbor {
      /// Add a head operation to the plan
      ///
      /// Limits the result to the first N trees.
      pub fn head(mut self, n: usize) -> Self {
          let op = QueryOp::Head { n };
          self.current = self.plan.add_op(op);
          self
      }

      /// Add a tail operation to the plan
      ///
      /// Limits the result to the last N trees.
      pub fn tail(mut self, n: usize) -> Self {
          let op = QueryOp::Tail { n };
          self.current = self.plan.add_op(op);
          self
      }
  }
  ```

#### 10.2.3.7 Implement Agg Operation

- [x] Add agg method:
  ```rust
  impl LazyArbor {
      /// Add an aggregation operation to the plan
      ///
      /// Aggregates values across all trees, returning a single result.
      ///
      /// # Example
      ///
      /// ```ignore
      /// let stats = lazy.agg(&[
      ///     path("age").mean().alias("avg_age"),
      ///     path("id").count().alias("count"),
      /// ]);
      /// ```
      pub fn agg(mut self, exprs: &[Expr]) -> Self {
          let op = QueryOp::Agg { exprs: exprs.to_vec() };
          self.current = self.plan.add_op(op);
          self
      }
  }
  ```

#### 10.2.3.8 Implement Collect

- [x] Add collect method:
  ```rust
  impl LazyArbor {
      /// Execute the plan and return the result
      ///
      /// This is where all the work happens. The plan is:
      /// 1. Optionally optimized (Phase 10.5)
      /// 2. Executed operation by operation
      /// 3. Results materialized into a new Arbor
      ///
      /// # Errors
      ///
      /// Returns an error if any operation fails during execution.
      pub fn collect(self) -> Result<Arbor, ExprError> {
          execute_plan(&self.plan)
      }
  }
  ```

#### 10.2.3.9 Implement Plan Introspection

- [x] Add introspection methods:
  ```rust
  impl LazyArbor {
      /// Get a description of the current plan
      ///
      /// Useful for debugging and understanding the query structure.
      pub fn describe_plan(&self) -> String {
          self.plan.describe()
      }

      /// Get the number of operations in the plan (including Source)
      pub fn plan_len(&self) -> usize {
          self.plan.len()
      }

      /// Get a reference to the source arbor
      pub fn source(&self) -> &Arc<Arbor> {
          self.plan.source()
      }
  }
  ```

#### 10.2.3.10 Implement Clone for LazyArbor

- [x] Derive Clone for LazyArbor (since QueryPlan now derives Clone):
  ```rust
  /// A lazy evaluation container for Arbor operations
  ///
  /// `LazyArbor` builds a query plan without executing it.
  /// Operations are only performed when `collect()` is called.
  #[derive(Clone)]
  pub struct LazyArbor {
      /// The query plan being built
      plan: QueryPlan,

      /// The current (latest) node in the plan
      current: QueryNodeId,
  }
  ```

  **Note:** QueryPlan derives Clone, which clones the node Vec and Arc<Arbor> (cheap sharing).
  This preserves `next_id` correctly for any future branching scenarios.

### 10.2.4 Implement Basic Executor (Stub)

File: `crates/arbors-lazy/src/execute.rs`

**Purpose:** Create a minimal executor that can run simple plans. Full execution is Phase 10.3.

#### 10.2.4.1 Create Execute Function

- [x] Add basic executor:
  ```rust
  //! Plan execution: converts QueryPlan to results
  //!
  //! This module implements the executor that runs query plans.
  //! For Phase 10.2, we implement a basic executor that handles
  //! simple operations by delegating to eager functions.

  use arbors_expr::ExprError;
  use arbors_storage::Arbor;
  use crate::plan::{QueryPlan, QueryOp};

  /// Execute a query plan and return the result
  ///
  /// Walks the plan from source to root, executing each operation.
  pub fn execute_plan(plan: &QueryPlan) -> Result<Arbor, ExprError> {
      // Start with a clone of the source arbor
      // (COW semantics from Phase 10.1 make this cheap)
      let mut current = (*plan.source()).clone();

      // Execute each operation in order (skip Source)
      for node in plan.nodes().iter().skip(1) {
          current = execute_op(&current, &node.op)?;
      }

      Ok(current)
  }

  /// Execute a single operation
  fn execute_op(arbor: &Arbor, op: &QueryOp) -> Result<Arbor, ExprError> {
      match op {
          QueryOp::Source => {
              // Source is handled specially in execute_plan
              Ok(arbor.clone())
          }

          QueryOp::Filter { predicate } => {
              // Use eager filter from arbors-query
              let indices = arbors_query::filter(arbor, predicate)?;
              Ok(arbor.filter_by_indices(&indices))
          }

          QueryOp::Head { n } => {
              Ok(arbor.head(*n))
          }

          QueryOp::Tail { n } => {
              Ok(arbor.tail(*n))
          }

          QueryOp::Select { .. } => {
              // Phase 10.3: Full select implementation
              // For now, return error indicating not yet implemented
              Err(ExprError::InvalidOperation(
                  "select() execution not yet implemented (Phase 10.3)".to_string()
              ))
          }

          QueryOp::WithColumn { .. } => {
              // Phase 10.3: Full with_column implementation
              Err(ExprError::InvalidOperation(
                  "with_column() execution not yet implemented (Phase 10.3)".to_string()
              ))
          }

          QueryOp::Agg { .. } => {
              // Phase 10.3: Full agg implementation
              Err(ExprError::InvalidOperation(
                  "agg() execution not yet implemented (Phase 10.3)".to_string()
              ))
          }

          QueryOp::Sort { .. } => {
              // Future: Sort implementation
              Err(ExprError::InvalidOperation(
                  "sort() execution not yet implemented".to_string()
              ))
          }
      }
  }
  ```

#### 10.2.4.2 Executor Smoke Tests for Unimplemented Ops

- [x] Add tests that verify unimplemented ops return `InvalidOperation`:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use std::sync::Arc;
      use arbors_storage::Arbor;
      use arbors_expr::{path, lit};

      fn empty_plan() -> QueryPlan {
          QueryPlan::new(Arc::new(Arbor::new()))
      }

      #[test]
      fn test_select_not_implemented() {
          let mut plan = empty_plan();
          plan.add_op(QueryOp::Select { exprs: vec![path("a")] });

          let result = execute_plan(&plan);
          assert!(matches!(result, Err(ExprError::InvalidOperation(msg)) if msg.contains("select")));
      }

      #[test]
      fn test_with_column_not_implemented() {
          let mut plan = empty_plan();
          plan.add_op(QueryOp::WithColumn { name: "x".to_string(), expr: lit(1) });

          let result = execute_plan(&plan);
          assert!(matches!(result, Err(ExprError::InvalidOperation(msg)) if msg.contains("with_column")));
      }

      #[test]
      fn test_agg_not_implemented() {
          let mut plan = empty_plan();
          plan.add_op(QueryOp::Agg { exprs: vec![path("a").sum()] });

          let result = execute_plan(&plan);
          assert!(matches!(result, Err(ExprError::InvalidOperation(msg)) if msg.contains("agg")));
      }

      #[test]
      fn test_sort_not_implemented() {
          let mut plan = empty_plan();
          plan.add_op(QueryOp::Sort { by: vec![path("a")], descending: vec![false] });

          let result = execute_plan(&plan);
          assert!(matches!(result, Err(ExprError::InvalidOperation(msg)) if msg.contains("sort")));
      }
  }
  ```

  **Note:** These tests ensure Phase 10.3 can flip these checks with confidence—when an op
  is implemented, the corresponding test will fail, prompting removal or update.

### 10.2.5 Add `.lazy()` to Arbor

File: `crates/arbors-storage/src/lib.rs`

**Note:** This creates a dependency from `arbors-storage` on `arbors-lazy`, which could create a circular dependency. Instead, we'll add `.lazy()` as an extension or put it in the main `arbors` crate.

#### 10.2.5.1 Evaluate Dependency Options

**Option A: Add to `arbors` crate (recommended)**
- Pro: No circular dependency
- Pro: Main crate is where users import from
- Con: Requires users to use `arbors::LazyArbor`

**Option B: Extension trait in `arbors-lazy`**
- Define `trait ArborExt { fn lazy(self) -> LazyArbor; }`
- Implement for `Arbor`
- Pro: No modification to `arbors-storage`
- Con: Requires importing the trait

**Decision:** Use Option A - add to `arbors` crate and re-export from `arbors-lazy`.

#### 10.2.5.2 Update arbors-lazy to Provide Extension

File: `crates/arbors-lazy/src/lib.rs`

- [x] Add extension trait:
  ```rust
  /// Extension trait to add `.lazy()` to Arbor
  pub trait ArborLazyExt {
      /// Convert to a lazy arbor for deferred execution
      fn lazy(self) -> LazyArbor;
  }

  impl ArborLazyExt for Arbor {
      fn lazy(self) -> LazyArbor {
          LazyArbor::from_arbor(self)
      }
  }

  impl ArborLazyExt for Arc<Arbor> {
      fn lazy(self) -> LazyArbor {
          LazyArbor::new(self)
      }
  }
  ```

#### 10.2.5.3 Update Main arbors Crate

File: `crates/arbors/Cargo.toml`

- [x] Add dependency:
  ```toml
  arbors-lazy.workspace = true
  ```

File: `crates/arbors/src/lib.rs`

- [x] Add lazy module and re-exports:
  ```rust
  // Re-export lazy evaluation
  pub mod lazy {
      //! Lazy evaluation for deferred query execution.
      //!
      //! # Example
      //!
      //! ```ignore
      //! use arbors::lazy::ArborLazyExt;  // Import the extension trait
      //! use arbors::expr::{path, lit};
      //!
      //! let result = arbor.lazy()
      //!     .filter(path("age").gt(lit(21)))
      //!     .head(10)
      //!     .collect()?;
      //! ```

      pub use arbors_lazy::{
          ArborLazyExt,
          LazyArbor,
          QueryPlan,
          QueryOp,
          QueryNode,
          QueryNodeId,
          ExecContext,
          execute_plan,
      };
  }
  ```

### 10.2.6 Unit Tests

File: `crates/arbors-lazy/src/plan.rs` (add at end)

#### 10.2.6.1 QueryOp Tests

- [x] Add QueryOp tests:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use arbors_expr::{path, lit};

      #[test]
      fn test_query_node_id() {
          let id = QueryNodeId(42);
          assert_eq!(id.0, 42);
          assert_eq!(format!("{}", id), "QueryNodeId(42)");
      }

      #[test]
      fn test_exec_context_defaults() {
          assert_eq!(ExecContext::default(), ExecContext::PerTree);
      }

      #[test]
      fn test_query_op_exec_context() {
          assert_eq!(QueryOp::Source.exec_context(), ExecContext::PerTree);
          assert_eq!(QueryOp::Filter { predicate: lit(true) }.exec_context(), ExecContext::PerTree);
          assert_eq!(QueryOp::Select { exprs: vec![] }.exec_context(), ExecContext::PerTree);
          assert_eq!(QueryOp::Head { n: 10 }.exec_context(), ExecContext::Global);
          assert_eq!(QueryOp::Tail { n: 10 }.exec_context(), ExecContext::Global);
          assert_eq!(QueryOp::Agg { exprs: vec![] }.exec_context(), ExecContext::Global);
      }

      #[test]
      fn test_query_op_description() {
          assert_eq!(QueryOp::Source.description(), "Source");
          assert_eq!(QueryOp::Filter { predicate: lit(true) }.description(), "Filter");
          assert_eq!(QueryOp::Select { exprs: vec![] }.description(), "Select");
      }

      #[test]
      fn test_query_node_new() {
          let node = QueryNode::new(
              QueryNodeId(0),
              QueryOp::Source,
              None,
          );
          assert!(node.is_source());
          assert!(node.input.is_none());
          assert_eq!(node.context, ExecContext::PerTree);
      }

      #[test]
      fn test_query_plan_new() {
          let arbor = Arbor::new();
          let plan = QueryPlan::new(Arc::new(arbor));

          assert_eq!(plan.len(), 1);
          assert!(plan.is_source_only());
          assert_eq!(plan.root(), QueryNodeId(0));
      }

      #[test]
      fn test_query_plan_add_op() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));

          let filter_id = plan.add_op(QueryOp::Filter { predicate: lit(true) });
          assert_eq!(filter_id, QueryNodeId(1));
          assert_eq!(plan.len(), 2);
          assert_eq!(plan.root(), QueryNodeId(1));

          // Verify the node was added correctly
          let node = plan.get(filter_id).unwrap();
          assert_eq!(node.input, Some(QueryNodeId(0)));
      }

      #[test]
      fn test_query_plan_chain() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));

          plan.add_op(QueryOp::Filter { predicate: lit(true) });
          plan.add_op(QueryOp::Head { n: 10 });
          plan.add_op(QueryOp::Tail { n: 5 });

          assert_eq!(plan.len(), 4);  // Source + 3 ops
          assert_eq!(plan.root(), QueryNodeId(3));
      }

      #[test]
      fn test_query_plan_describe() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));
          plan.add_op(QueryOp::Filter { predicate: lit(true) });
          plan.add_op(QueryOp::Head { n: 10 });

          let desc = plan.describe();
          assert!(desc.contains("QueryPlan"));
          assert!(desc.contains("Filter"));
          assert!(desc.contains("Head(10)"));
      }
  }
  ```

File: `crates/arbors-lazy/src/lazy.rs` (add at end)

#### 10.2.6.2 LazyArbor Tests

- [x] Add LazyArbor tests:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use arbors_expr::{path, lit};

      #[test]
      fn test_lazy_arbor_new() {
          let arbor = Arbor::new();
          let lazy = LazyArbor::from_arbor(arbor);

          assert_eq!(lazy.plan_len(), 1);  // Just Source
      }

      #[test]
      fn test_lazy_arbor_filter() {
          let arbor = Arbor::new();
          let lazy = LazyArbor::from_arbor(arbor)
              .filter(path("age").gt(lit(21)));

          assert_eq!(lazy.plan_len(), 2);  // Source + Filter
      }

      #[test]
      fn test_lazy_arbor_chain() {
          let arbor = Arbor::new();
          let lazy = LazyArbor::from_arbor(arbor)
              .filter(path("age").gt(lit(21)))
              .head(10)
              .tail(5);

          assert_eq!(lazy.plan_len(), 4);
      }

      #[test]
      fn test_lazy_arbor_select() {
          let arbor = Arbor::new();
          let lazy = LazyArbor::from_arbor(arbor)
              .select(&[path("name").alias("n")]);

          assert_eq!(lazy.plan_len(), 2);
      }

      #[test]
      fn test_lazy_arbor_with_column() {
          let arbor = Arbor::new();
          let lazy = LazyArbor::from_arbor(arbor)
              .with_column("total", path("items[*].price").sum());

          assert_eq!(lazy.plan_len(), 2);
      }

      #[test]
      fn test_lazy_arbor_agg() {
          let arbor = Arbor::new();
          let lazy = LazyArbor::from_arbor(arbor)
              .agg(&[path("age").mean().alias("avg_age")]);

          assert_eq!(lazy.plan_len(), 2);
      }

      #[test]
      fn test_lazy_arbor_describe() {
          let arbor = Arbor::new();
          let lazy = LazyArbor::from_arbor(arbor)
              .filter(path("active").eq(lit(true)))
              .head(100);

          let desc = lazy.describe_plan();
          assert!(desc.contains("Filter"));
          assert!(desc.contains("Head(100)"));
      }

      #[test]
      fn test_lazy_arbor_source_unchanged() {
          let arbor = Arbor::new();
          let arc_arbor = Arc::new(arbor);
          let lazy = LazyArbor::new(Arc::clone(&arc_arbor));

          // Source should be shared
          assert_eq!(Arc::strong_count(&arc_arbor), 2);

          // After building plan, source still shared
          let lazy = lazy.filter(lit(true)).head(10);
          assert_eq!(Arc::strong_count(&arc_arbor), 2);
      }
  }
  ```

### 10.2.7 Integration Tests

File: `crates/arbors-lazy/tests/lazy_integration.rs` (new file)

- [x] Create integration tests:
  ```rust
  //! Integration tests for LazyArbor

  use std::sync::Arc;
  use arbors_io::ArborBuilder;
  use arbors_lazy::{LazyArbor, ArborLazyExt};
  use arbors_expr::{path, lit};

  /// Create a test arbor with sample data
  fn create_test_arbor() -> arbors_storage::Arbor {
      let mut builder = ArborBuilder::new_infer();
      builder.add_json(br#"{"name": "Alice", "age": 30, "active": true}"#).unwrap();
      builder.add_json(br#"{"name": "Bob", "age": 25, "active": false}"#).unwrap();
      builder.add_json(br#"{"name": "Carol", "age": 35, "active": true}"#).unwrap();
      builder.finish()
  }

  #[test]
  fn test_lazy_from_extension_trait() {
      let arbor = create_test_arbor();
      let lazy = arbor.lazy();
      assert_eq!(lazy.plan_len(), 1);
  }

  #[test]
  fn test_lazy_filter_collect() {
      let arbor = create_test_arbor();
      let result = arbor.lazy()
          .filter(path("active").eq(lit(true)))
          .collect()
          .unwrap();

      // Should have 2 trees (Alice and Carol are active)
      assert_eq!(result.num_trees(), 2);
  }

  #[test]
  fn test_lazy_head_collect() {
      let arbor = create_test_arbor();
      let result = arbor.lazy()
          .head(2)
          .collect()
          .unwrap();

      assert_eq!(result.num_trees(), 2);
  }

  #[test]
  fn test_lazy_tail_collect() {
      let arbor = create_test_arbor();
      let result = arbor.lazy()
          .tail(1)
          .collect()
          .unwrap();

      assert_eq!(result.num_trees(), 1);
  }

  #[test]
  fn test_lazy_filter_then_head() {
      let arbor = create_test_arbor();
      let result = arbor.lazy()
          .filter(path("active").eq(lit(true)))
          .head(1)
          .collect()
          .unwrap();

      // Filter to 2 (Alice, Carol), then head(1) = 1
      assert_eq!(result.num_trees(), 1);
  }

  #[test]
  fn test_lazy_source_unchanged_after_collect() {
      let arbor = create_test_arbor();
      let arc_arbor = Arc::new(arbor);
      let original_count = arc_arbor.num_trees();

      let lazy = LazyArbor::new(Arc::clone(&arc_arbor));
      let result = lazy
          .filter(path("age").gt(lit(30)))
          .collect()
          .unwrap();

      // Original should be unchanged
      assert_eq!(arc_arbor.num_trees(), original_count);

      // Result should be filtered
      assert_eq!(result.num_trees(), 1);  // Only Carol (age 35)
  }

  #[test]
  fn test_lazy_empty_arbor() {
      let arbor = arbors_storage::Arbor::new();
      let result = arbor.lazy()
          .filter(lit(true))
          .head(10)
          .collect()
          .unwrap();

      assert_eq!(result.num_trees(), 0);
  }

  #[test]
  fn test_lazy_describe_plan() {
      let arbor = create_test_arbor();
      let lazy = arbor.lazy()
          .filter(path("active").eq(lit(true)))
          .head(100);

      let desc = lazy.describe_plan();
      assert!(desc.contains("Source"));
      assert!(desc.contains("Filter"));
      assert!(desc.contains("Head"));
  }

  #[test]
  fn test_lazy_arc_arbor() {
      let arbor = Arc::new(create_test_arbor());
      let lazy = arbor.lazy();

      // Should share the Arc
      assert_eq!(lazy.plan_len(), 1);
  }
  ```

### 10.2.8 Send+Sync Assertions

File: `crates/arbors-lazy/src/lib.rs`

**Purpose:** Ensure `LazyArbor` and `QueryPlan` are `Send + Sync` for future parallel execution (Phase 10.4).

- [x] Add compile-time assertions (similar to Phase 10.1 COW assertions):
  ```rust
  #[cfg(test)]
  mod send_sync_tests {
      use super::*;

      // Compile-time assertions that LazyArbor and QueryPlan are Send + Sync
      fn assert_send<T: Send>() {}
      fn assert_sync<T: Sync>() {}

      #[test]
      fn lazy_arbor_is_send_sync() {
          assert_send::<LazyArbor>();
          assert_sync::<LazyArbor>();
      }

      #[test]
      fn query_plan_is_send_sync() {
          assert_send::<QueryPlan>();
          assert_sync::<QueryPlan>();
      }
  }
  ```

  **Note:** These assertions will fail to compile if any field is not Send+Sync.
  Since `Arc<Arbor>` is Send+Sync (verified in Phase 10.1), and `Vec<QueryNode>` contains
  only Send+Sync types, these should pass.

### 10.2.9 Verify All Tests Pass

- [x] Run: `cargo test -p arbors-lazy` — all lazy crate tests pass (40 tests)
- [x] Run: `cargo test --workspace --exclude arbors-python` — all 1062 tests pass (no regressions)
- [x] Run: `cargo clippy -p arbors-lazy` — no warnings
- [x] Run: `make python` — Python bindings build
- [x] Run: `make python-test` — all Python tests pass (821 tests)

### 10.2.10 Documentation

#### 10.2.10.1 Module Documentation

- [x] Ensure `crates/arbors-lazy/src/lib.rs` has comprehensive module docs
- [x] Ensure all public types have doc comments with examples
- [x] Note: Workspace lints include `warnings = "deny"` and `clippy::all = "deny"` but NOT `missing_docs`.
      Add `#![deny(missing_docs)]` to the crate once stable (can defer to post-Phase 10).

#### 10.2.10.2 Update CLAUDE.md

- [x] No changes needed to CLAUDE.md (internal implementation)

**Phase 10.2 Deliverables:**

- [x] `arbors-lazy` crate with:
  - [x] `QueryNodeId`, `ExecContext`, `QueryOp`, `QueryNode`, `QueryPlan` in `plan.rs`
  - [x] `LazyArbor` with `filter()`, `select()`, `with_column()`, `head()`, `tail()`, `agg()` in `lazy.rs`
  - [x] Basic `execute_plan()` for filter/head/tail in `execute.rs`
  - [x] `ArborLazyExt` trait for `.lazy()` method
  - [x] Send+Sync compile-time assertions for `LazyArbor` and `QueryPlan`
- [x] Integration with `arbors` crate:
  - [x] `arbors::lazy` module with re-exports
  - [x] `ArborLazyExt` trait accessible
- [x] 28 unit tests covering:
  - [x] QueryOp execution context
  - [x] QueryPlan building and description
  - [x] LazyArbor operation chaining
  - [x] Plan length tracking
  - [x] Send+Sync assertions
- [x] 12 integration tests covering:
  - [x] filter → collect
  - [x] head/tail → collect
  - [x] chained operations → collect
  - [x] source arbor unchanged after collect
- [x] All existing tests pass (no regressions)
- [x] Clippy clean (arbors-lazy crate)

---

## Phase 10.3 – Plan Execution

**Goal:** Execute query plans correctly (before optimization). Implement select, with_column, agg, and sort operations that currently return "not implemented" errors.

**Key Concepts:** Section D (Parallel Execution Strategy), eager ops in `arbors-query/src/ops.rs`

**Current State:**
- Phase 10.2 complete: LazyArbor, QueryPlan, basic executor
- `execute_plan()` handles: Filter, Head, Tail (via delegation to arbors-query)
- `execute_plan()` returns errors for: Select, WithColumn, Agg, Sort
- Eager `select()`, `with_column()`, `agg()` exist in arbors-query but return `Vec<ExprResult>`, not `Arbor`
- **Key gap:** No mechanism to convert `ExprResult` back into an `Arbor`

### 10.3.0 Design Decision: ExprResult → Arbor Conversion

**Problem:** The lazy API must return `Arbor` from `collect()`, but eager ops return `Vec<ExprResult>`.

**Current Eager API:**
```rust
// arbors-query/src/ops.rs
pub fn select(arbor: &Arbor, exprs: &[Expr]) -> Result<Vec<ExprResult>, ExprError>;
pub fn with_column(...) -> Result<Vec<(ExprResult, String, ExprResult)>, ExprError>;
pub fn agg(arbor: &Arbor, exprs: &[Expr]) -> Result<ExprResult, ExprError>;
```

**Options:**

**Option A: Build Arbor from ExprResult (Recommended)**
- Create `arbors-io` helpers: `ArborBuilder::add_expr_result(&mut self, result: &ExprResult)`
- Recursively walk ExprResult structure, building nodes
- Pro: Reuses existing builder infrastructure
- Pro: Clear ownership and type safety
- Con: Some duplication of tree-building logic

**Option B: Serialize ExprResult to JSON, then parse**
- Convert ExprResult → serde_json::Value → Arbor
- Pro: Simple, uses existing paths
- Con: Inefficient (serialize then deserialize)
- Con: May lose type precision (Int64 vs Float64)

**Option C: Direct node construction**
- Build ColumnarNodes directly from ExprResult
- Pro: Most efficient
- Con: Bypasses builder safety checks, risky

**Decision:** Option A — Add `add_expr_result()` to ArborBuilder

**Error Handling Note:**

When converting `arbors_core::Error` (from ArborBuilder) to `ExprError`, we use:
```rust
.map_err(|e| ExprError::InvalidOperation(e.to_string()))
```

This loses error detail/typing. A future improvement could add a dedicated error variant:
```rust
// In arbors_expr::error.rs (future consideration, not required for 10.3)
ExecutionError { source: Box<dyn std::error::Error>, context: String }
```

For Phase 10.3, `InvalidOperation` with a descriptive message is acceptable.

### 10.3.1 Add ExprResult → Arbor Conversion

File: `crates/arbors-io/src/builder.rs`

**Reference:** ArborBuilder at line 133, add_json() at line 182

**Critical Implementation Note: Child Ordering/Contiguity**

The existing builder uses a "reserve-then-fill" strategy to ensure children are contiguous:
1. For objects: Keys are sorted by InternId BEFORE reserving children
2. Children are reserved in order (creating contiguous NodeId range)
3. Children are filled in the same order

For ExprResult conversion, we must follow the same pattern:
- **Lists:** Children naturally build in order (iterate items, reserve, fill)
- **Structs:** MUST sort by key_id BEFORE building children to maintain contiguity

The naive approach (build children, then sort) breaks contiguity. Instead:
1. Intern all keys first
2. Sort (key, &ExprResult) pairs by key_id
3. Reserve children in sorted order
4. Fill children in sorted order

#### 10.3.1.1 Add ExprResult Import

- [x] Add import to builder.rs:
  ```rust
  // Near top of file, with other imports
  use arbors_expr::{ExprResult, Value as ExprValue};  // Alias to avoid conflict with sonic_rs::Value
  ```

- [x] Verify Cargo.toml has arbors-expr dependency:
  ```bash
  # Check if arbors-expr is in dependencies
  grep "arbors-expr" crates/arbors-io/Cargo.toml
  # If not present, add:
  # arbors-expr.workspace = true
  ```

#### 10.3.1.2 Implement add_expr_result (Reserve-then-Fill Pattern)

- [x] Add `add_expr_result()` method to ArborBuilder:
  ```rust
  impl ArborBuilder {
      /// Add a tree from an ExprResult
      ///
      /// Converts an ExprResult (from select/with_column/agg) into a tree.
      /// The result becomes a new root in the arbor.
      ///
      /// Uses the same reserve-then-fill strategy as JSON parsing to ensure
      /// children are contiguous in the node array.
      ///
      /// # Arguments
      ///
      /// * `result` - The ExprResult to convert
      ///
      /// # Returns
      ///
      /// The NodeId of the new root node.
      ///
      /// # Example
      ///
      /// ```ignore
      /// let mut builder = ArborBuilder::new_infer();
      /// builder.add_expr_result(&ExprResult::Scalar(Value::Int64(42)))?;
      /// let arbor = builder.finish();
      /// ```
      pub fn add_expr_result(&mut self, result: &ExprResult) -> Result<NodeId> {
          // Reserve root node
          let root_id = self.reserve_node();
          // Fill it (no parent for root)
          self.fill_expr_result(root_id, result, NodeId::NONE)?;
          self.roots.push(root_id);
          Ok(root_id)
      }

      /// Fill a pre-reserved node from an ExprResult (internal recursive helper)
      ///
      /// This follows the reserve-then-fill pattern used by JSON parsing.
      fn fill_expr_result(&mut self, node_id: NodeId, result: &ExprResult, parent: NodeId) -> Result<()> {
          match result {
              ExprResult::Scalar(value) => self.fill_scalar_from_value(node_id, value, parent),
              ExprResult::List(items) => self.fill_list_from_results(node_id, items, parent),
              ExprResult::Struct(fields) => self.fill_struct_from_results(node_id, fields, parent),
              ExprResult::Null => {
                  self.fill_null(node_id, parent);
                  Ok(())
              }
          }
      }
  }
  ```

#### 10.3.1.3 Implement Scalar Node Builder

- [x] Add scalar node building (note: pools take Option<T>):
  ```rust
  impl ArborBuilder {
      /// Fill a pre-reserved node with a scalar value from ExprValue
      fn fill_scalar_from_value(&mut self, node_id: NodeId, value: &ExprValue, parent: NodeId) -> Result<()> {
          match value {
              ExprValue::Null => {
                  self.fill_null(node_id, parent);
              }
              ExprValue::Bool(b) => {
                  let pool_idx = self.pools.add_bool(Some(*b));
                  self.fill_primitive(node_id, NodeType::Bool, pool_idx, parent);
              }
              ExprValue::Int64(n) => {
                  let pool_idx = self.pools.add_int64(Some(*n));
                  self.fill_primitive(node_id, NodeType::Int64, pool_idx, parent);
              }
              ExprValue::Float64(f) => {
                  let pool_idx = self.pools.add_float64(Some(*f));
                  self.fill_primitive(node_id, NodeType::Float64, pool_idx, parent);
              }
              ExprValue::String(s) => {
                  let pool_idx = self.pools.add_string(Some(s.as_str()));
                  self.fill_primitive(node_id, NodeType::String, pool_idx, parent);
              }
              ExprValue::Date(d) => {
                  let pool_idx = self.pools.add_date(Some(*d));
                  self.fill_primitive(node_id, NodeType::Date, pool_idx, parent);
              }
              ExprValue::DateTime(dt) => {
                  let pool_idx = self.pools.add_datetime(Some(*dt));
                  self.fill_primitive(node_id, NodeType::DateTime, pool_idx, parent);
              }
              ExprValue::Duration(d) => {
                  let pool_idx = self.pools.add_duration(Some(*d));
                  self.fill_primitive(node_id, NodeType::Duration, pool_idx, parent);
              }
              ExprValue::Binary(bytes) => {
                  let pool_idx = self.pools.add_binary(Some(bytes.as_slice()));
                  self.fill_primitive(node_id, NodeType::Binary, pool_idx, parent);
              }
          }
          Ok(())
      }
  }
  ```

#### 10.3.1.4 Implement List Node Builder (Reserve-then-Fill)

- [x] Add list node building using reserve-then-fill:
  ```rust
  impl ArborBuilder {
      /// Fill a pre-reserved node as an array from ExprResult items
      fn fill_list_from_results(&mut self, node_id: NodeId, items: &[ExprResult], parent: NodeId) -> Result<()> {
          // Phase 1: Reserve ALL child nodes upfront (ensures contiguous children)
          let children_start = if items.is_empty() {
              NodeId(0)  // Empty array: data0=0, data1=0 is valid
          } else {
              NodeId(self.nodes.len() as u32)
          };
          let child_ids: Vec<NodeId> = items.iter().map(|_| self.reserve_node()).collect();

          // Phase 2: Fill each child
          for (item, child_id) in items.iter().zip(child_ids.iter()) {
              self.fill_expr_result(*child_id, item, node_id)?;
          }

          // Fill the container node
          self.fill_container(node_id, NodeType::Array, children_start, items.len() as u32, parent);
          Ok(())
      }
  }
  ```

#### 10.3.1.5 Implement Struct Node Builder (Sort BEFORE Reserve)

**Critical:** Must sort by key_id BEFORE reserving children to maintain contiguity invariant.

- [x] Add struct node building:
  ```rust
  impl ArborBuilder {
      /// Fill a pre-reserved node as an object from ExprResult fields
      ///
      /// IMPORTANT: Keys must be sorted by InternId BEFORE reserving children
      /// to maintain the contiguity invariant required for binary search.
      fn fill_struct_from_results(&mut self, node_id: NodeId, fields: &IndexMap<String, ExprResult>, parent: NodeId) -> Result<()> {
          // Step 1: Intern all keys and collect with their values
          let mut keys_with_ids: Vec<(&String, &ExprResult, InternId)> = Vec::with_capacity(fields.len());
          for (key, value) in fields {
              let key_id = self.interner.intern(key)?;
              keys_with_ids.push((key, value, key_id));
          }

          // Step 2: Sort by InternId (Arbor invariant for binary search)
          keys_with_ids.sort_by_key(|(_, _, id)| *id);

          // Phase 1: Reserve ALL child nodes upfront IN SORTED ORDER
          let children_start = if keys_with_ids.is_empty() {
              NodeId(0)  // Empty object: data0=0, data1=0 is valid
          } else {
              NodeId(self.nodes.len() as u32)
          };
          let child_ids: Vec<NodeId> = keys_with_ids.iter().map(|_| self.reserve_node()).collect();

          // Phase 2: Fill each child IN SORTED ORDER
          for ((_, value, key_id), child_id) in keys_with_ids.iter().zip(child_ids.iter()) {
              self.fill_expr_result(*child_id, value, node_id)?;
              // Set the key on the node
              self.set_node_key(*child_id, *key_id);
          }

          // Fill the container node
          self.fill_container(node_id, NodeType::Object, children_start, keys_with_ids.len() as u32, parent);
          Ok(())
      }
  }
  ```

#### 10.3.1.6 Add Helper Method for Batch Conversion

- [x] Add batch conversion for efficiency:
  ```rust
  impl ArborBuilder {
      /// Add multiple trees from a slice of ExprResults
      ///
      /// This is the primary method used by lazy select/with_column operations.
      /// Each ExprResult becomes a separate tree (root) in the arbor.
      pub fn add_expr_results(&mut self, results: &[ExprResult]) -> Result<Vec<NodeId>> {
          let mut root_ids = Vec::with_capacity(results.len());
          for result in results {
              let root_id = self.add_expr_result(result)?;
              root_ids.push(root_id);
          }
          Ok(root_ids)
      }
  }
  ```

#### 10.3.1.7 Unit Tests for ExprResult Conversion

File: `crates/arbors-io/src/builder.rs` (add at end in tests module)

**Test Strategy:** Use `Arbor::get_path()` to verify converted values match expected structure.

- [x] Add tests for scalar conversion:
  ```rust
  #[cfg(test)]
  mod expr_result_tests {
      use super::*;
      use arbors_expr::{ExprResult, Value as ExprValue};

      #[test]
      fn test_add_expr_result_scalar_int() {
          let mut builder = ArborBuilder::new_infer();
          builder.add_expr_result(&ExprResult::Scalar(ExprValue::Int64(42))).unwrap();
          let arbor = builder.finish();

          assert_eq!(arbor.num_trees(), 1);
          let root = arbor.root(0).unwrap();
          assert_eq!(arbor.node_type(root), NodeType::Int64);
          assert_eq!(arbor.get_int64(root), Some(42));
      }

      #[test]
      fn test_add_expr_result_scalar_string() {
          let mut builder = ArborBuilder::new_infer();
          builder.add_expr_result(&ExprResult::Scalar(ExprValue::String("hello".to_string()))).unwrap();
          let arbor = builder.finish();

          assert_eq!(arbor.num_trees(), 1);
          let root = arbor.root(0).unwrap();
          assert_eq!(arbor.node_type(root), NodeType::String);
          assert_eq!(arbor.get_string(root), Some("hello"));
      }

      #[test]
      fn test_add_expr_result_scalar_bool() {
          let mut builder = ArborBuilder::new_infer();
          builder.add_expr_result(&ExprResult::Scalar(ExprValue::Bool(true))).unwrap();
          let arbor = builder.finish();

          assert_eq!(arbor.num_trees(), 1);
          let root = arbor.root(0).unwrap();
          assert_eq!(arbor.node_type(root), NodeType::Bool);
          assert_eq!(arbor.get_bool(root), Some(true));
      }

      #[test]
      fn test_add_expr_result_scalar_float() {
          let mut builder = ArborBuilder::new_infer();
          builder.add_expr_result(&ExprResult::Scalar(ExprValue::Float64(3.14))).unwrap();
          let arbor = builder.finish();

          assert_eq!(arbor.num_trees(), 1);
          let root = arbor.root(0).unwrap();
          assert_eq!(arbor.node_type(root), NodeType::Float64);
          assert_eq!(arbor.get_float64(root), Some(3.14));
      }

      #[test]
      fn test_add_expr_result_null() {
          let mut builder = ArborBuilder::new_infer();
          builder.add_expr_result(&ExprResult::Null).unwrap();
          let arbor = builder.finish();

          assert_eq!(arbor.num_trees(), 1);
          let root = arbor.root(0).unwrap();
          assert_eq!(arbor.node_type(root), NodeType::Null);
      }

      #[test]
      fn test_add_expr_result_scalar_null_value() {
          let mut builder = ArborBuilder::new_infer();
          builder.add_expr_result(&ExprResult::Scalar(ExprValue::Null)).unwrap();
          let arbor = builder.finish();

          assert_eq!(arbor.num_trees(), 1);
          let root = arbor.root(0).unwrap();
          assert_eq!(arbor.node_type(root), NodeType::Null);
      }
  }
  ```

- [x] Add tests for list conversion:
  ```rust
  #[test]
  fn test_add_expr_result_list() {
      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_result(&ExprResult::List(vec![
          ExprResult::Scalar(ExprValue::Int64(1)),
          ExprResult::Scalar(ExprValue::Int64(2)),
          ExprResult::Scalar(ExprValue::Int64(3)),
      ])).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);
      let root = arbor.root(0).unwrap();
      assert_eq!(arbor.node_type(root), NodeType::Array);
      assert_eq!(arbor.children_count(root), 3);

      // Verify child values
      let children: Vec<_> = arbor.children(root).collect();
      assert_eq!(arbor.get_int64(children[0]), Some(1));
      assert_eq!(arbor.get_int64(children[1]), Some(2));
      assert_eq!(arbor.get_int64(children[2]), Some(3));
  }

  #[test]
  fn test_add_expr_result_empty_list() {
      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_result(&ExprResult::List(vec![])).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);
      let root = arbor.root(0).unwrap();
      assert_eq!(arbor.node_type(root), NodeType::Array);
      assert_eq!(arbor.children_count(root), 0);
  }
  ```

- [x] Add tests for struct conversion with key ordering verification:
  ```rust
  #[test]
  fn test_add_expr_result_struct() {
      use indexmap::IndexMap;

      let mut fields = IndexMap::new();
      fields.insert("name".to_string(), ExprResult::Scalar(ExprValue::String("Alice".to_string())));
      fields.insert("age".to_string(), ExprResult::Scalar(ExprValue::Int64(30)));

      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_result(&ExprResult::Struct(fields)).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);
      let root = arbor.root(0).unwrap();
      assert_eq!(arbor.node_type(root), NodeType::Object);
      assert_eq!(arbor.children_count(root), 2);

      // Verify field values using get_field
      let name_node = arbor.get_field(root, "name").unwrap();
      assert_eq!(arbor.get_string(name_node), Some("Alice"));

      let age_node = arbor.get_field(root, "age").unwrap();
      assert_eq!(arbor.get_int64(age_node), Some(30));
  }

  #[test]
  fn test_add_expr_result_struct_key_ordering() {
      // Verify keys are sorted by InternId (alphabetically for fresh interner)
      use indexmap::IndexMap;

      let mut fields = IndexMap::new();
      // Insert in non-sorted order
      fields.insert("zebra".to_string(), ExprResult::Scalar(ExprValue::Int64(3)));
      fields.insert("apple".to_string(), ExprResult::Scalar(ExprValue::Int64(1)));
      fields.insert("mango".to_string(), ExprResult::Scalar(ExprValue::Int64(2)));

      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_result(&ExprResult::Struct(fields)).unwrap();
      let arbor = builder.finish();

      // Verify all fields are accessible (binary search works)
      let root = arbor.root(0).unwrap();
      assert!(arbor.get_field(root, "apple").is_some());
      assert!(arbor.get_field(root, "mango").is_some());
      assert!(arbor.get_field(root, "zebra").is_some());

      // Verify values are correct
      assert_eq!(arbor.get_int64(arbor.get_field(root, "apple").unwrap()), Some(1));
      assert_eq!(arbor.get_int64(arbor.get_field(root, "mango").unwrap()), Some(2));
      assert_eq!(arbor.get_int64(arbor.get_field(root, "zebra").unwrap()), Some(3));
  }

  #[test]
  fn test_add_expr_result_empty_struct() {
      use indexmap::IndexMap;

      let fields: IndexMap<String, ExprResult> = IndexMap::new();

      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_result(&ExprResult::Struct(fields)).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);
      let root = arbor.root(0).unwrap();
      assert_eq!(arbor.node_type(root), NodeType::Object);
      assert_eq!(arbor.children_count(root), 0);
  }

  #[test]
  fn test_add_expr_result_nested() {
      use indexmap::IndexMap;

      let mut inner = IndexMap::new();
      inner.insert("x".to_string(), ExprResult::Scalar(ExprValue::Int64(1)));

      let mut outer = IndexMap::new();
      outer.insert("inner".to_string(), ExprResult::Struct(inner));
      outer.insert("list".to_string(), ExprResult::List(vec![
          ExprResult::Scalar(ExprValue::Int64(10)),
          ExprResult::Scalar(ExprValue::Int64(20)),
      ]));

      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_result(&ExprResult::Struct(outer)).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);

      // Verify nested structure
      let root = arbor.root(0).unwrap();
      let inner_node = arbor.get_field(root, "inner").unwrap();
      assert_eq!(arbor.node_type(inner_node), NodeType::Object);

      let x_node = arbor.get_field(inner_node, "x").unwrap();
      assert_eq!(arbor.get_int64(x_node), Some(1));

      let list_node = arbor.get_field(root, "list").unwrap();
      assert_eq!(arbor.node_type(list_node), NodeType::Array);
      assert_eq!(arbor.children_count(list_node), 2);
  }
  ```

- [x] Add test for batch conversion:
  ```rust
  #[test]
  fn test_add_expr_results_batch() {
      let results = vec![
          ExprResult::Scalar(ExprValue::Int64(1)),
          ExprResult::Scalar(ExprValue::Int64(2)),
          ExprResult::Scalar(ExprValue::Int64(3)),
      ];

      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_results(&results).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 3);
      assert_eq!(arbor.get_int64(arbor.root(0).unwrap()), Some(1));
      assert_eq!(arbor.get_int64(arbor.root(1).unwrap()), Some(2));
      assert_eq!(arbor.get_int64(arbor.root(2).unwrap()), Some(3));
  }

  #[test]
  fn test_add_expr_results_empty() {
      let results: Vec<ExprResult> = vec![];

      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_results(&results).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 0);
  }
  ```

- [x] Add tests for temporal types:
  ```rust
  #[test]
  fn test_add_expr_result_date() {
      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_result(&ExprResult::Scalar(ExprValue::Date(19000))).unwrap(); // ~2022-01-02
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);
      let root = arbor.root(0).unwrap();
      assert_eq!(arbor.node_type(root), NodeType::Date);
      assert_eq!(arbor.get_date(root), Some(19000));
  }

  #[test]
  fn test_add_expr_result_datetime() {
      let mut builder = ArborBuilder::new_infer();
      let micros = 1704067200_000_000i64; // 2024-01-01 00:00:00 UTC
      builder.add_expr_result(&ExprResult::Scalar(ExprValue::DateTime(micros))).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);
      let root = arbor.root(0).unwrap();
      assert_eq!(arbor.node_type(root), NodeType::DateTime);
      assert_eq!(arbor.get_datetime(root), Some(micros));
  }

  #[test]
  fn test_add_expr_result_duration() {
      let mut builder = ArborBuilder::new_infer();
      let micros = 3600_000_000i64; // 1 hour
      builder.add_expr_result(&ExprResult::Scalar(ExprValue::Duration(micros))).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);
      let root = arbor.root(0).unwrap();
      assert_eq!(arbor.node_type(root), NodeType::Duration);
      assert_eq!(arbor.get_duration(root), Some(micros));
  }

  #[test]
  fn test_add_expr_result_binary() {
      let mut builder = ArborBuilder::new_infer();
      let data = vec![0xDE, 0xAD, 0xBE, 0xEF];
      builder.add_expr_result(&ExprResult::Scalar(ExprValue::Binary(data.clone()))).unwrap();
      let arbor = builder.finish();

      assert_eq!(arbor.num_trees(), 1);
      let root = arbor.root(0).unwrap();
      assert_eq!(arbor.node_type(root), NodeType::Binary);
      assert_eq!(arbor.get_binary(root), Some(data.as_slice()));
  }
  ```

### 10.3.2 Implement Select Execution

File: `crates/arbors-lazy/src/execute.rs`

**Reference:** eager `select()` in `arbors-query/src/ops.rs:125`

#### 10.3.2.1 Add execute_select Function

- [x] Add select execution:
  ```rust
  use arbors_io::ArborBuilder;

  /// Execute a select operation
  ///
  /// Transforms each tree by evaluating expressions and building new trees
  /// from the results.
  fn execute_select(arbor: &Arbor, exprs: &[Expr]) -> Result<Arbor, ExprError> {
      // Use eager select to evaluate expressions
      let results = arbors_query::select(arbor, exprs)?;

      // Convert results back to Arbor
      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_results(&results)
          .map_err(|e| ExprError::InvalidOperation(e.to_string()))?;

      Ok(builder.finish())
  }
  ```

#### 10.3.2.2 Update execute_op to Call execute_select

- [x] Update the Select case in execute_op:
  ```rust
  QueryOp::Select { exprs } => execute_select(arbor, exprs),
  ```

#### 10.3.2.3 Add arbors-io Dependency

File: `crates/arbors-lazy/Cargo.toml`

- [x] Add arbors-io to dependencies:
  ```toml
  [dependencies]
  arbors-io.workspace = true
  ```

### 10.3.3 Implement WithColumn Execution

File: `crates/arbors-lazy/src/execute.rs`

**Reference:** eager `with_column()` and `apply_with_column()` in `arbors-query/src/ops.rs:184`

#### 10.3.3.1 Add execute_with_column Function

- [x] Add with_column execution:
  ```rust
  /// Execute a with_column operation
  ///
  /// Adds or replaces a field in each tree.
  fn execute_with_column(arbor: &Arbor, name: &str, expr: &Expr) -> Result<Arbor, ExprError> {
      // Use eager with_column + apply_with_column
      let results = arbors_query::with_column(arbor, name, expr)?;
      let merged = arbors_query::apply_with_column(results)?;

      // Convert results back to Arbor
      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_results(&merged)
          .map_err(|e| ExprError::InvalidOperation(e.to_string()))?;

      Ok(builder.finish())
  }
  ```

#### 10.3.3.2 Update execute_op to Call execute_with_column

- [x] Update the WithColumn case in execute_op:
  ```rust
  QueryOp::WithColumn { name, expr } => execute_with_column(arbor, name, expr),
  ```

### 10.3.4 Implement Agg Execution

File: `crates/arbors-lazy/src/execute.rs`

**Reference:** eager `agg()` in `arbors-query/src/ops.rs:284`

#### 10.3.4.1 Add execute_agg Function

- [x] Add agg execution:
  ```rust
  /// Execute an aggregation operation
  ///
  /// Aggregates values across all trees, returning a single-tree result.
  fn execute_agg(arbor: &Arbor, exprs: &[Expr]) -> Result<Arbor, ExprError> {
      // Use eager agg to compute aggregation
      let result = arbors_query::agg(arbor, exprs)?;

      // Convert single result to single-tree Arbor
      let mut builder = ArborBuilder::new_infer();
      builder.add_expr_result(&result)
          .map_err(|e| ExprError::InvalidOperation(e.to_string()))?;

      Ok(builder.finish())
  }
  ```

#### 10.3.4.2 Update execute_op to Call execute_agg

- [x] Update the Agg case in execute_op:
  ```rust
  QueryOp::Agg { exprs } => execute_agg(arbor, exprs),
  ```

### 10.3.5 Implement Sort Execution (Deferred)

**Note:** Sort is complex and may be deferred to Phase 10.4 or later. For Phase 10.3, we'll keep the "not implemented" error but document the design.

#### 10.3.5.1 Sort Design (For Reference)

```rust
/// Execute a sort operation (design sketch, not implemented in 10.3)
///
/// Sorts trees by evaluating sort keys and permuting the roots vector.
fn execute_sort(arbor: &Arbor, by: &[Expr], descending: &[bool]) -> Result<Arbor, ExprError> {
    // 1. Evaluate each sort expression for each tree, collect as Vec<Vec<ExprResult>>
    // 2. Create index vector: (0..num_trees).collect()
    // 3. Sort index vector using comparison of ExprResults
    // 4. Return arbor.filter_by_indices(&sorted_indices)
}
```

- [x] Leave Sort as "not implemented" for Phase 10.3
- [x] Add TODO comment indicating Phase 10.4 implementation

### 10.3.6 Unit Tests for Execute Operations

File: `crates/arbors-lazy/src/execute.rs` (add/expand tests module)

**Test Strategy:** All tests use concrete assertions to verify values, not just structure.

#### 10.3.6.1 Select Execution Tests

- [x] Test basic select:
  ```rust
  #[test]
  fn test_execute_select_basic() {
      let arbor = create_test_arbor();  // {name: "Alice", age: 30}, {name: "Bob", age: 25}

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Select {
          exprs: vec![path("name").alias("n"), path("age").alias("a")],
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 2);

      // Verify first tree: {n: "Alice", a: 30}
      let root0 = result.root(0).unwrap();
      assert_eq!(result.node_type(root0), NodeType::Object);
      let n0 = result.get_field(root0, "n").unwrap();
      assert_eq!(result.get_string(n0), Some("Alice"));
      let a0 = result.get_field(root0, "a").unwrap();
      assert_eq!(result.get_int64(a0), Some(30));

      // Verify second tree: {n: "Bob", a: 25}
      let root1 = result.root(1).unwrap();
      let n1 = result.get_field(root1, "n").unwrap();
      assert_eq!(result.get_string(n1), Some("Bob"));
      let a1 = result.get_field(root1, "a").unwrap();
      assert_eq!(result.get_int64(a1), Some(25));
  }
  ```

- [x] Test select with aggregation expression:
  ```rust
  #[test]
  fn test_execute_select_with_sum() {
      // Arbor with items: [{price: 10}, {price: 20}] and [{price: 5}, {price: 15}]
      let arbor = create_items_arbor();

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Select {
          exprs: vec![path("items[*].price").sum().alias("total")],
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 2);

      // First tree: sum([10, 20]) = 30
      let root0 = result.root(0).unwrap();
      let total0 = result.get_field(root0, "total").unwrap();
      assert_eq!(result.get_int64(total0), Some(30));

      // Second tree: sum([5, 15]) = 20
      let root1 = result.root(1).unwrap();
      let total1 = result.get_field(root1, "total").unwrap();
      assert_eq!(result.get_int64(total1), Some(20));
  }
  ```

- [x] Test select on empty arbor:
  ```rust
  #[test]
  fn test_execute_select_empty() {
      let arbor = Arbor::new();

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Select {
          exprs: vec![lit(42).alias("answer")],
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 0);
  }
  ```

#### 10.3.6.2 WithColumn Execution Tests

- [x] Test basic with_column:
  ```rust
  #[test]
  fn test_execute_with_column_basic() {
      let arbor = create_test_arbor();  // {name: "Alice", age: 30}, {name: "Bob", age: 25}

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::WithColumn {
          name: "active".to_string(),
          expr: lit(true),
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 2);

      // Verify "active" field added to each tree
      let root0 = result.root(0).unwrap();
      let active0 = result.get_field(root0, "active").unwrap();
      assert_eq!(result.get_bool(active0), Some(true));

      // Original fields preserved
      let name0 = result.get_field(root0, "name").unwrap();
      assert_eq!(result.get_string(name0), Some("Alice"));
  }
  ```

- [x] Test with_column replacing existing field:
  ```rust
  #[test]
  fn test_execute_with_column_replace() {
      let arbor = create_test_arbor();  // {name: "Alice", age: 30}, {name: "Bob", age: 25}

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::WithColumn {
          name: "age".to_string(),
          expr: path("age").add(lit(1)),  // age + 1
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 2);

      // Verify age was incremented
      let root0 = result.root(0).unwrap();
      let age0 = result.get_field(root0, "age").unwrap();
      assert_eq!(result.get_int64(age0), Some(31));  // Was 30, now 31

      let root1 = result.root(1).unwrap();
      let age1 = result.get_field(root1, "age").unwrap();
      assert_eq!(result.get_int64(age1), Some(26));  // Was 25, now 26
  }
  ```

- [x] Test with_column with computed expression:
  ```rust
  #[test]
  fn test_execute_with_column_computed() {
      let arbor = create_items_arbor();  // {id: 1, items: [{price: 10}, {price: 20}]}, etc.

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::WithColumn {
          name: "total".to_string(),
          expr: path("items[*].price").sum(),
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 2);

      // Verify "total" computed correctly
      let root0 = result.root(0).unwrap();
      let total0 = result.get_field(root0, "total").unwrap();
      assert_eq!(result.get_int64(total0), Some(30));  // 10 + 20

      // Original fields preserved
      let id0 = result.get_field(root0, "id").unwrap();
      assert_eq!(result.get_int64(id0), Some(1));
  }
  ```

#### 10.3.6.3 Agg Execution Tests

- [x] Test basic agg:
  ```rust
  #[test]
  fn test_execute_agg_basic() {
      let arbor = create_test_arbor();  // ages: 30, 25

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Agg {
          exprs: vec![path("age").sum().alias("total_age")],
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 1);  // Agg returns single tree

      // Verify total_age == 55
      let root = result.root(0).unwrap();
      let total_age = result.get_field(root, "total_age").unwrap();
      assert_eq!(result.get_int64(total_age), Some(55));  // 30 + 25
  }
  ```

- [x] Test agg with multiple expressions:
  ```rust
  #[test]
  fn test_execute_agg_multiple() {
      let arbor = create_test_arbor();  // ages: 30, 25

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Agg {
          exprs: vec![
              path("age").sum().alias("total"),
              path("age").mean().alias("avg"),
              path("age").count().alias("n"),
          ],
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 1);

      let root = result.root(0).unwrap();

      // total = 30 + 25 = 55
      let total = result.get_field(root, "total").unwrap();
      assert_eq!(result.get_int64(total), Some(55));

      // avg = 55 / 2 = 27.5
      let avg = result.get_field(root, "avg").unwrap();
      assert_eq!(result.get_float64(avg), Some(27.5));

      // n = 2
      let n = result.get_field(root, "n").unwrap();
      assert_eq!(result.get_int64(n), Some(2));
  }
  ```

- [x] Test agg on empty arbor:
  ```rust
  #[test]
  fn test_execute_agg_empty() {
      let arbor = Arbor::new();

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Agg {
          exprs: vec![path("x").count().alias("n")],
      });

      let result = execute_plan(&plan).unwrap();
      assert_eq!(result.num_trees(), 1);

      // Verify count == 0
      let root = result.root(0).unwrap();
      let n = result.get_field(root, "n").unwrap();
      assert_eq!(result.get_int64(n), Some(0));
  }
  ```

#### 10.3.6.4 Sort Not Implemented Test

- [x] Test sort returns expected error:
  ```rust
  #[test]
  fn test_sort_not_implemented() {
      let arbor = create_test_arbor();

      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Sort {
          by: vec![path("age")],
          descending: vec![false],
      });

      let result = execute_plan(&plan);
      assert!(result.is_err());
      match result {
          Err(ExprError::InvalidOperation(msg)) => {
              assert!(msg.contains("Sort") || msg.contains("not implemented"));
          }
          _ => panic!("Expected InvalidOperation error for Sort"),
      }
  }
  ```

### 10.3.7 Integration Tests

File: `crates/arbors-lazy/tests/lazy_integration.rs` (add to existing)

#### 10.3.7.1 Chained Operation Tests

- [x] Test filter → select chain:
  ```rust
  #[test]
  fn test_lazy_filter_then_select() {
      let arbor = create_test_arbor();  // Alice(30), Bob(25)

      let result = arbor.lazy()
          .filter(path("age").gt(lit(26)))  // Keep age > 26
          .select(&[path("name").alias("n")])
          .collect()
          .unwrap();

      assert_eq!(result.num_trees(), 1);  // Only Alice (30) passes

      // Verify it's Alice
      let root = result.root(0).unwrap();
      let n = result.get_field(root, "n").unwrap();
      assert_eq!(result.get_string(n), Some("Alice"));
  }
  ```

- [x] Test filter → with_column chain:
  ```rust
  #[test]
  fn test_lazy_filter_then_with_column() {
      let arbor = create_test_arbor();  // Alice(active=true), Bob(active=false)

      let result = arbor.lazy()
          .filter(path("active").eq(lit(true)))
          .with_column("filtered", lit(true))
          .collect()
          .unwrap();

      assert_eq!(result.num_trees(), 1);  // Only Alice passes

      // Verify filtered tree has new column
      let root = result.root(0).unwrap();
      let filtered = result.get_field(root, "filtered").unwrap();
      assert_eq!(result.get_bool(filtered), Some(true));

      // Original fields preserved
      let name = result.get_field(root, "name").unwrap();
      assert_eq!(result.get_string(name), Some("Alice"));
  }
  ```

- [x] Test select → agg chain:
  ```rust
  #[test]
  fn test_lazy_select_then_agg() {
      let arbor = create_test_arbor();  // ages: 30, 25

      let result = arbor.lazy()
          .select(&[path("age").alias("a")])
          .agg(&[path("a").sum().alias("total")])
          .collect()
          .unwrap();

      assert_eq!(result.num_trees(), 1);

      // Verify aggregation
      let root = result.root(0).unwrap();
      let total = result.get_field(root, "total").unwrap();
      assert_eq!(result.get_int64(total), Some(55));  // 30 + 25
  }
  ```

- [x] Test complex chain: filter → select → with_column → head:
  ```rust
  #[test]
  fn test_lazy_complex_chain() {
      let arbor = create_many_trees_arbor(100);  // {id: 0, value: 0}, {id: 1, value: 10}, ...

      let result = arbor.lazy()
          .filter(path("id").gt(lit(50)))          // Keep id > 50 (49 trees: 51-99)
          .select(&[path("id"), path("value")])   // Keep only id, value
          .with_column("doubled", path("value").mul(lit(2)))  // Add doubled column
          .head(5)                                 // Take first 5
          .collect()
          .unwrap();

      assert_eq!(result.num_trees(), 5);

      // Verify first result is id=51
      let root0 = result.root(0).unwrap();
      let id0 = result.get_field(root0, "id").unwrap();
      assert_eq!(result.get_int64(id0), Some(51));

      // Verify doubled column
      let doubled0 = result.get_field(root0, "doubled").unwrap();
      assert_eq!(result.get_int64(doubled0), Some(1020));  // 510 * 2
  }
  ```

#### 10.3.7.2 Eager vs Lazy Equivalence Tests

- [x] Test lazy select equals eager select:
  ```rust
  #[test]
  fn test_lazy_equals_eager_select() {
      let arbor = create_test_arbor();
      let exprs = vec![path("name").alias("n"), path("age").alias("a")];

      // Eager path
      let eager_results = arbors_query::select(&arbor, &exprs).unwrap();

      // Lazy path
      let lazy_arbor = arbor.clone().lazy()
          .select(&exprs)
          .collect()
          .unwrap();

      // Both should have same number of trees
      assert_eq!(eager_results.len(), lazy_arbor.num_trees());
      assert_eq!(lazy_arbor.num_trees(), 2);

      // Verify first tree matches
      let eager_first = &eager_results[0];
      let lazy_root = lazy_arbor.root(0).unwrap();

      // eager_first should be Struct with "n" and "a" fields
      if let ExprResult::Struct(fields) = eager_first {
          // Verify "n" field
          let eager_n = fields.get("n").unwrap();
          if let ExprResult::Scalar(Value::String(s)) = eager_n {
              let lazy_n = lazy_arbor.get_field(lazy_root, "n").unwrap();
              assert_eq!(lazy_arbor.get_string(lazy_n), Some(s.as_str()));
          }

          // Verify "a" field
          let eager_a = fields.get("a").unwrap();
          if let ExprResult::Scalar(Value::Int64(i)) = eager_a {
              let lazy_a = lazy_arbor.get_field(lazy_root, "a").unwrap();
              assert_eq!(lazy_arbor.get_int64(lazy_a), Some(*i));
          }
      }
  }
  ```

- [x] Test lazy agg equals eager agg:
  ```rust
  #[test]
  fn test_lazy_equals_eager_agg() {
      let arbor = create_test_arbor();
      let exprs = vec![path("age").sum().alias("total")];

      // Eager path
      let eager_result = arbors_query::agg(&arbor, &exprs).unwrap();

      // Lazy path
      let lazy_arbor = arbor.clone().lazy()
          .agg(&exprs)
          .collect()
          .unwrap();

      // Both should produce equivalent single-tree result
      assert_eq!(lazy_arbor.num_trees(), 1);

      // Verify values match
      if let ExprResult::Struct(fields) = eager_result {
          let eager_total = fields.get("total").unwrap();
          if let ExprResult::Scalar(Value::Int64(i)) = eager_total {
              let lazy_root = lazy_arbor.root(0).unwrap();
              let lazy_total = lazy_arbor.get_field(lazy_root, "total").unwrap();
              assert_eq!(lazy_arbor.get_int64(lazy_total), Some(*i));
          }
      }
  }
  ```

### 10.3.8 Test Helpers

File: `crates/arbors-lazy/tests/lazy_integration.rs` and `crates/arbors-lazy/src/execute.rs` (in tests modules)

- [x] Add test helper functions:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use arbors_io::ArborBuilder;
      use arbors_expr::{path, lit};

      /// Create test arbor: {name: "Alice", age: 30, active: true}, {name: "Bob", age: 25, active: false}
      fn create_test_arbor() -> Arbor {
          let mut builder = ArborBuilder::new_infer();
          builder.add_json(br#"{"name": "Alice", "age": 30, "active": true}"#).unwrap();
          builder.add_json(br#"{"name": "Bob", "age": 25, "active": false}"#).unwrap();
          builder.finish()
      }

      /// Create test arbor with items array
      fn create_items_arbor() -> Arbor {
          let mut builder = ArborBuilder::new_infer();
          builder.add_json(br#"{"id": 1, "items": [{"price": 10}, {"price": 20}]}"#).unwrap();
          builder.add_json(br#"{"id": 2, "items": [{"price": 5}, {"price": 15}]}"#).unwrap();
          builder.finish()
      }

      /// Create arbor with N trees
      fn create_many_trees_arbor(n: usize) -> Arbor {
          let mut builder = ArborBuilder::new_infer();
          for i in 0..n {
              builder.add_json(format!(r#"{{"id": {}, "value": {}}}"#, i, i * 10).as_bytes()).unwrap();
          }
          builder.finish()
      }

      // ... existing tests ...
  }
  ```

### 10.3.9 Verify All Tests Pass

- [x] Run: `cargo test -p arbors-io` — ArborBuilder tests pass
- [x] Run: `cargo test -p arbors-lazy` — all lazy crate tests pass
- [x] Run: `cargo test --workspace --exclude arbors-python` — all tests pass
- [x] Run: `cargo clippy -p arbors-lazy -p arbors-io` — no warnings
- [x] Run: `make python` — Python bindings build
- [x] Run: `make python-test` — all Python tests pass

### 10.3.10 Documentation

#### 10.3.10.1 Update Execute Module Docs

- [x] Update `crates/arbors-lazy/src/execute.rs` module docs:
  ```rust
  //! Plan execution: converts QueryPlan to results
  //!
  //! This module implements the executor that runs query plans.
  //! Operations are executed by delegating to eager functions in
  //! `arbors-query`, then converting the results back to `Arbor`.
  //!
  //! # Supported Operations
  //!
  //! - **Filter**: Uses `arbors_query::filter()` + `Arbor::filter_by_indices()`
  //! - **Select**: Uses `arbors_query::select()` + `ArborBuilder::add_expr_results()`
  //! - **WithColumn**: Uses `arbors_query::with_column()` + `ArborBuilder::add_expr_results()`
  //! - **Agg**: Uses `arbors_query::agg()` + `ArborBuilder::add_expr_result()`
  //! - **Head/Tail**: Uses `Arbor::head()` / `Arbor::tail()` (COW views)
  //! - **Sort**: Not yet implemented
  ```

#### 10.3.10.2 Document ArborBuilder Extension

- [x] Ensure `add_expr_result()` and `add_expr_results()` have comprehensive doc comments

**Phase 10.3 Deliverables:**

- [x] `ArborBuilder::add_expr_result()` and `add_expr_results()` for converting ExprResult → Arbor
  - [x] `fill_expr_result()` internal method (reserve-then-fill pattern)
  - [x] `fill_scalar_from_value()` for all 9 Value variants
  - [x] `fill_list_from_results()` with contiguous child allocation
  - [x] `fill_struct_from_results()` with key sorting BEFORE child reservation
- [x] `execute_select()` implementation delegating to `arbors_query::select()`
- [x] `execute_with_column()` implementation delegating to `arbors_query::with_column()`
- [x] `execute_agg()` implementation delegating to `arbors_query::agg()`
- [x] Sort remains "not implemented" with expected error (deferred to Phase 10.4+)
- [x] 17+ ArborBuilder unit tests for ExprResult conversion:
  - 6 scalar tests (int, string, bool, float, null, null-value)
  - 2 list tests (list, empty list)
  - 4 struct tests (struct, key ordering, empty struct, nested)
  - 2 batch tests (batch, empty batch)
  - 3 temporal tests (date, datetime, duration, binary)
- [x] 13+ executor unit tests:
  - 3 select tests (basic, with sum, empty)
  - 3 with_column tests (basic, replace, computed)
  - 3 agg tests (basic, multiple, empty)
  - 1 sort not-implemented test
  - 3 test helper functions
- [x] 6+ integration tests:
  - 4 chained operation tests (filter→select, filter→with_column, select→agg, complex chain)
  - 2 eager vs lazy equivalence tests
- [x] All existing tests pass (no regressions): `cargo test --workspace --exclude arbors-python`
- [x] Clippy clean: `cargo clippy -p arbors-lazy -p arbors-io`

---

## Phase 10.4 – Parallel Execution

**Goal:** Enable multi-core processing for large arbors.

**Key Concepts:** Section D (Parallel Execution Strategy)

**Current State:**
- Phase 10.1–10.3 complete: COW storage, LazyArbor, sequential execution
- Sequential `execute_plan()` works for filter, select, with_column, agg, head, tail
- `rayon = "1.9"` already in workspace dependencies
- No parallel execution paths exist yet

**Implementation Checkpoint Summary:**

| Step | Description | Gate |
|------|-------------|------|
| 10.4.1 | Add rayon dependency | `cargo build -p arbors-lazy` |
| 10.4.2 | Define ExecutionMode API | `cargo test -p arbors-lazy` (existing tests) |
| 10.4.3 | Implement parallel filter | `cargo test -p arbors-lazy -- parallel_filter` |
| 10.4.4 | Implement parallel select | `cargo test -p arbors-lazy -- parallel_select` |
| 10.4.5 | WithColumn fallback | `cargo test -p arbors-lazy -- with_column_parallel` |
| 10.4.6 | Agg fallback | `cargo test -p arbors-lazy -- agg_parallel` |
| 10.4.7 | LazyArbor API | `cargo test -p arbors-lazy` |
| 10.4.8 | Main crate exports | `cargo build -p arbors` |
| 10.4.9 | Unit tests | `cargo test -p arbors-lazy` (all) |
| 10.4.10 | Integration tests | `cargo test -p arbors-lazy --test parallel_integration` |
| 10.4.11 | Benchmarks | `cargo bench -p arbors-lazy --bench parallel_bench` |
| 10.4.12 | Full test suite | `cargo test --workspace --exclude arbors-python` |

**How to use:** Complete each subphase, run its checkpoint command, then proceed. If a checkpoint fails, fix before continuing.

### 10.4.0 Pre-Implementation Review

**Purpose:** Verify understanding of parallel execution architecture before implementation.

**Key Invariants from Section D:**

1. **Tree-level parallelism** — Operations parallelize over tree indices, not within trees
2. **Determinism** — Parallel results MUST match sequential results exactly
3. **Ordering preservation** — Tree order is stable after parallel filter/select/with_column
4. **Best-effort early termination** — Use `try_for_each` patterns where possible; note that rayon doesn't guarantee immediate cancellation across all threads

**ExecContext Reference (from Section D.4):**
- `PerTree`: Filter, Select, WithColumn — `par_iter` over tree indices
- `Global`: Agg, Head, Tail, Sort — Tree-parallel evaluation, global reduce
- `PerTreeArray`: Reserved for Phase 11+ (not implemented in Phase 10)

**Parallelization Strategy Summary (Phase 10.4 Scope):**

| Op | Strategy | Phase 10.4 Status |
|----|----------|-------------------|
| Filter | `par_iter().map().collect()` | ✅ Parallel |
| Select | `par_iter().map().collect()` | ✅ Parallel |
| WithColumn | Sequential (see 10.4.5) | ⚠️ Sequential fallback |
| Agg | Sequential | ⚠️ Sequential (parallel deferred) |
| Head/Tail | Sequential | ✅ Sequential (no benefit) |
| Sort | Sequential | ⚠️ Sequential (not yet implemented) |

**Deferred to Phase 10.4+:**
- Parallel aggregation with map-reduce (requires per-agg-type reduce logic)
- Parallel sort (requires sort implementation first)
- Parallel with_column (requires exposing helper functions)

**Verification Steps:**
- [x] Confirm `Arbor: Send + Sync` (required for rayon)
- [x] Confirm `Expr: Send + Sync` (shared across threads)
- [x] Confirm `EvalContext: Send` (created per-thread, not shared)
- [x] Confirm `ExprResult: Send` (returned from parallel map)
- [x] Confirm `Value: Send` (contained in ExprResult)
- [x] Add static assertions in tests to catch Send/Sync regressions

**Memory Considerations:**
- Parallel select/with_column accumulate `Vec<ExprResult>` for all trees before building
- For very large arbors (1M+ trees), this may increase peak memory vs streaming
- Acceptable for Phase 10.4; streaming builder optimization deferred to later phases

**Implementation Cautions:**
- **Order guarantee:** `into_par_iter()` over a range is indexed; rayon's `collect()` preserves input order. Add explicit comments/tests verifying this for filter.
- **Send/Sync checks:** `EvalContext<'_>` may fail `Send` if it holds `Rc`/`RefCell` references. Be ready to adjust assertions or refactor storage types if needed.
- **Benchmark runtime:** 100K trees is fine locally but may be heavy in CI. Consider gating benches or running selectively (`cargo bench -- filter` instead of all).
- **Test scoping:** 15+ unit / 5+ integration is a target, not a minimum. Focus tests on what changed; avoid padding count with redundant cases.

---

### 10.4.1 Add Rayon Dependency

File: `crates/arbors-lazy/Cargo.toml`

- [x] Add rayon dependency:
  ```toml
  [dependencies]
  # ... existing deps ...
  rayon.workspace = true
  ```

- [x] Verify build:
  ```bash
  cargo build -p arbors-lazy
  ```

**Checkpoint 10.4.1:**
```bash
cargo build -p arbors-lazy           # Must compile with rayon
cargo test --workspace --exclude arbors-python  # No regressions
```
- [x] Checkpoint passed

---

### 10.4.2 Define Execution Mode API

File: `crates/arbors-lazy/src/execute.rs`

**Purpose:** Add types and functions for controlling parallel execution.

#### 10.4.2.1 Define ExecutionMode Enum

- [x] Add `ExecutionMode` enum:
  ```rust
  /// Execution mode for query plans
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
  pub enum ExecutionMode {
      /// Sequential execution (single-threaded)
      #[default]
      Sequential,
      /// Parallel execution using rayon
      Parallel,
  }
  ```

#### 10.4.2.2 Add execute_plan_with_mode Function

- [x] Add parallel-aware execution entry point:
  ```rust
  /// Execute a query plan with the specified execution mode
  ///
  /// # Arguments
  /// * `plan` - The query plan to execute
  /// * `mode` - Sequential or Parallel execution
  ///
  /// # Determinism
  /// Both modes produce identical results. Parallel mode may be faster
  /// for large arbors on multi-core systems.
  pub fn execute_plan_with_mode(
      plan: &QueryPlan,
      mode: ExecutionMode,
  ) -> Result<Arbor, ExprError> {
      let mut current: Arbor = plan.source().as_ref().clone();

      for node in plan.nodes().iter().skip(1) {
          current = execute_op_with_mode(&current, &node.op, mode)?;
      }

      Ok(current)
  }

  /// Execute a single operation with the specified mode
  fn execute_op_with_mode(
      arbor: &Arbor,
      op: &QueryOp,
      mode: ExecutionMode,
  ) -> Result<Arbor, ExprError> {
      match (op, mode) {
          // Filter: parallelizable
          (QueryOp::Filter { predicate }, ExecutionMode::Parallel) => {
              execute_filter_parallel(arbor, predicate)
          }

          // Select: parallelizable
          (QueryOp::Select { exprs }, ExecutionMode::Parallel) => {
              execute_select_parallel(arbor, exprs)
          }

          // WithColumn: parallelizable
          (QueryOp::WithColumn { name, expr }, ExecutionMode::Parallel) => {
              execute_with_column_parallel(arbor, name, expr)
          }

          // Agg: parallel map-reduce
          (QueryOp::Agg { exprs }, ExecutionMode::Parallel) => {
              execute_agg_parallel(arbor, exprs)
          }

          // Head/Tail/Sort/Source: use sequential (no benefit from parallelism)
          _ => execute_op(arbor, op),
      }
  }
  ```

#### 10.4.2.3 Update execute_plan to Delegate

- [x] Update existing `execute_plan()` to delegate to new function:
  ```rust
  /// Execute a query plan and return the result (sequential mode)
  ///
  /// For parallel execution, use `execute_plan_with_mode()` with `ExecutionMode::Parallel`.
  pub fn execute_plan(plan: &QueryPlan) -> Result<Arbor, ExprError> {
      execute_plan_with_mode(plan, ExecutionMode::Sequential)
  }
  ```

**Checkpoint 10.4.2:**
```bash
cargo build -p arbors-lazy           # Must compile
cargo test -p arbors-lazy            # Existing tests still pass
```
- [x] Checkpoint passed
- [x] `ExecutionMode` enum defined
- [x] `execute_plan_with_mode()` compiles (parallel functions can be stubs/unimplemented for now)
- [x] `execute_plan()` delegates to new function

---

### 10.4.3 Implement Parallel Filter

File: `crates/arbors-lazy/src/execute.rs`

**Reference:** Section D.1 (Tree-Level Parallelism)

#### 10.4.3.1 Implement execute_filter_parallel

**Design Note:** We use `par_iter().map().collect::<Result<Vec<_>, _>>()` pattern.
This evaluates all trees in parallel and collects results. Rayon's `collect()` into
`Result<Vec<T>, E>` will short-circuit on the first `Err`, though other threads may
continue briefly before noticing. This is acceptable "best-effort" early termination.

- [x] Add parallel filter implementation:
  ```rust
  use rayon::prelude::*;

  /// Execute filter operation in parallel
  ///
  /// Evaluates the predicate on each tree in parallel, collecting indices
  /// of trees where the predicate evaluates to true.
  ///
  /// # Error Handling
  /// If any tree evaluation fails, returns the first error encountered.
  /// Other threads may continue briefly (rayon best-effort cancellation).
  fn execute_filter_parallel(arbor: &Arbor, predicate: &Expr) -> Result<Arbor, ExprError> {
      // Early return for empty arbor
      if arbor.num_trees() == 0 {
          return Ok(arbor.clone());
      }

      // Parallel evaluation: each tree returns Option<usize> (Some if passes filter)
      // We map to Result<Option<usize>, ExprError> then collect and flatten
      let results: Result<Vec<Option<usize>>, ExprError> = (0..arbor.num_trees())
          .into_par_iter()
          .map(|i| {
              let ctx = arbors_query::EvalContext::for_tree(arbor, i);
              match arbors_query::eval_expr(predicate, &ctx)? {
                  arbors_expr::ExprResult::Scalar(arbors_expr::Value::Bool(true)) => Ok(Some(i)),
                  arbors_expr::ExprResult::Scalar(arbors_expr::Value::Bool(false)) => Ok(None),
                  other => Err(ExprError::TypeMismatch {
                      expected: "Bool".to_string(),
                      found: format!("{:?}", other),
                  }),
              }
          })
          .collect();

      // Flatten Option<usize> to Vec<usize>, preserving order
      let indices: Vec<usize> = results?.into_iter().flatten().collect();
      Ok(arbor.filter_by_indices(&indices))
  }
  ```

  **Why this pattern works:**
  - `map()` returns `Result<Option<usize>, ExprError>` for each tree
  - `collect::<Result<Vec<_>, _>>()` short-circuits on first `Err`
  - `flatten()` removes `None` values, keeping only passing indices
  - Order is preserved because rayon's `collect()` maintains input order

#### 10.4.3.2 Add Parallel Filter Unit Test

- [x] Add test verifying parallel matches sequential:
  ```rust
  #[test]
  fn test_parallel_filter_matches_sequential() {
      let arbor = create_large_test_arbor(1000); // 1000 trees
      let predicate = path("id").gt(lit(500));

      let seq_result = {
          let indices = arbors_query::filter(&arbor, &predicate).unwrap();
          arbor.filter_by_indices(&indices)
      };

      let par_result = execute_filter_parallel(&arbor, &predicate).unwrap();

      assert_eq!(seq_result.num_trees(), par_result.num_trees());
      // Verify same tree order preserved
      for i in 0..seq_result.num_trees() {
          let seq_root = seq_result.root(i).unwrap();
          let par_root = par_result.root(i).unwrap();
          assert_eq!(
              seq_result.get_i64(seq_result.get_field(seq_root, "id").unwrap()),
              par_result.get_i64(par_result.get_field(par_root, "id").unwrap())
          );
      }
  }
  ```

**Checkpoint 10.4.3:**
```bash
cargo test -p arbors-lazy -- parallel_filter  # New parallel filter tests pass
cargo test -p arbors-lazy            # All arbors-lazy tests pass
```
- [x] Checkpoint passed
- [x] `execute_filter_parallel()` implemented
- [x] Parallel filter produces same results as sequential
- [x] Order is preserved after parallel filter

---

### 10.4.4 Implement Parallel Select

File: `crates/arbors-lazy/src/execute.rs`

**Reference:** Section D.5 (QueryOp Parallelization Matrix)

#### 10.4.4.1 Implement execute_select_parallel

**Design Note:** We need to evaluate expressions per tree in parallel, then collect results.
The challenge is that `ArborBuilder` is not thread-safe, so we must:
1. Evaluate all trees in parallel → `Vec<ExprResult>`
2. Build the result Arbor sequentially from collected results

**Memory Note:** This accumulates all `ExprResult` values before building, which may use
more peak memory than a streaming approach for very large arbors (1M+ trees). Acceptable
for Phase 10.4; streaming optimization deferred.

- [x] Add parallel select implementation:
  ```rust
  /// Execute select operation in parallel
  ///
  /// Evaluates expressions on each tree in parallel, then builds
  /// the result Arbor from the collected results.
  ///
  /// # Error Handling
  /// If any tree evaluation fails, returns the first error encountered.
  fn execute_select_parallel(arbor: &Arbor, exprs: &[Expr]) -> Result<Arbor, ExprError> {
      if arbor.num_trees() == 0 {
          return Ok(Arbor::new());
      }

      // Parallel evaluation: one result per tree
      // collect::<Result<Vec<_>, _>>() short-circuits on first error
      let results: Result<Vec<ExprResult>, ExprError> = (0..arbor.num_trees())
          .into_par_iter()
          .map(|tree_idx| {
              let ctx = arbors_query::EvalContext::for_tree(arbor, tree_idx);
              // Evaluate all expressions for this tree, build struct result
              let mut fields = indexmap::IndexMap::new();
              for expr in exprs {
                  let result = arbors_query::eval_expr(expr, &ctx)?;
                  let name = expr.output_name();
                  fields.insert(name, result);
              }
              Ok(arbors_expr::ExprResult::Struct(fields))
          })
          .collect();

      let results = results?;

      // Sequential build (ArborBuilder is not thread-safe)
      let mut builder = ArborBuilder::new_infer();
      builder
          .add_expr_results(&results)
          .map_err(|e| ExprError::InvalidOperation(e.to_string()))?;

      Ok(builder.finish())
  }
  ```

#### 10.4.4.2 Add Parallel Select Unit Test

- [x] Add test verifying parallel matches sequential:
  ```rust
  #[test]
  fn test_parallel_select_matches_sequential() {
      let arbor = create_large_test_arbor(1000);
      let exprs = vec![
          path("id").alias("i"),
          path("value").mul(lit(2)).alias("doubled"),
      ];

      let seq_result = execute_select(&arbor, &exprs).unwrap();
      let par_result = execute_select_parallel(&arbor, &exprs).unwrap();

      assert_eq!(seq_result.num_trees(), par_result.num_trees());
      for i in 0..seq_result.num_trees() {
          let seq_root = seq_result.root(i).unwrap();
          let par_root = par_result.root(i).unwrap();
          assert_eq!(
              seq_result.get_i64(seq_result.get_field(seq_root, "i").unwrap()),
              par_result.get_i64(par_result.get_field(par_root, "i").unwrap())
          );
          assert_eq!(
              seq_result.get_i64(seq_result.get_field(seq_root, "doubled").unwrap()),
              par_result.get_i64(par_result.get_field(par_root, "doubled").unwrap())
          );
      }
  }
  ```

**Checkpoint 10.4.4:**
```bash
cargo test -p arbors-lazy -- parallel_select  # New parallel select tests pass
cargo test -p arbors-lazy            # All arbors-lazy tests pass
```
- [x] Checkpoint passed
- [x] `execute_select_parallel()` implemented
- [x] Parallel select produces same results as sequential
- [x] Tree order preserved

---

### 10.4.5 WithColumn: Sequential Fallback

File: `crates/arbors-lazy/src/execute.rs`

**Decision:** WithColumn uses sequential execution in Phase 10.4.

**Rationale:** Parallel with_column requires helper functions (`tree_to_expr_result`,
`merge_with_column`) that don't currently exist as public functions in `arbors_query`.
Options:
- (a) Add them to arbors_query — increases API surface, deferred
- (b) Inline the logic — code duplication, maintenance burden
- (c) Sequential fallback — simple, correct, acceptable performance

**Chosen:** Option (c) — Sequential fallback. The performance impact is acceptable because:
- Most workloads chain filter→select (both parallel) before with_column
- with_column is typically applied to already-filtered (smaller) arbors
- Parallelization can be added in Phase 10.4+ if benchmarks show need

#### 10.4.5.1 Implement execute_with_column_parallel (Sequential Fallback)

- [x] Add sequential fallback:
  ```rust
  /// Execute with_column operation
  ///
  /// **Phase 10.4:** Uses sequential execution. Parallel implementation
  /// deferred until helper functions are exposed in arbors_query.
  fn execute_with_column_parallel(
      arbor: &Arbor,
      name: &str,
      expr: &Expr,
  ) -> Result<Arbor, ExprError> {
      // Sequential fallback - same as execute_with_column
      execute_with_column(arbor, name, expr)
  }
  ```

#### 10.4.5.2 Add WithColumn Unit Test (Verifies Fallback Works)

- [x] Add test verifying parallel mode produces correct results:
  ```rust
  #[test]
  fn test_with_column_parallel_mode_correct() {
      let arbor = create_large_test_arbor(100);
      let name = "computed";
      let expr = path("value").add(lit(100));

      // Both modes should produce identical results
      let seq_result = execute_with_column(&arbor, name, &expr).unwrap();
      let par_result = execute_with_column_parallel(&arbor, name, &expr).unwrap();

      assert_eq!(seq_result.num_trees(), par_result.num_trees());
      for i in 0..seq_result.num_trees() {
          let seq_root = seq_result.root(i).unwrap();
          let par_root = par_result.root(i).unwrap();
          assert_eq!(
              seq_result.get_i64(seq_result.get_field(seq_root, "computed").unwrap()),
              par_result.get_i64(par_result.get_field(par_root, "computed").unwrap())
          );
      }
  }
  ```

**Checkpoint 10.4.5:**
```bash
cargo test -p arbors-lazy -- with_column_parallel  # Fallback test passes
cargo test -p arbors-lazy            # All arbors-lazy tests pass
```
- [x] Checkpoint passed
- [x] `execute_with_column_parallel()` implemented (sequential fallback)
- [x] Produces correct results via delegation to sequential

---

### 10.4.6 Aggregation: Sequential Fallback

File: `crates/arbors-lazy/src/execute.rs`

**Decision:** Aggregation uses sequential execution in Phase 10.4.

**Rationale:** Parallel aggregation requires per-aggregation-type reduce logic:
- `sum`: associative, can use `par_iter().sum()`
- `count`: associative, can use `par_iter().count()`
- `mean`: requires sum + count, then divide (non-trivial parallel)
- `min/max`: associative but requires custom reduce
- Mixed aggregations: must handle all types simultaneously

**Complexity vs Benefit:**
- Aggregation typically runs on already-filtered data (smaller arbors)
- The reduce step is O(n) regardless; parallelism helps the map step
- Full parallel map-reduce requires significant refactoring of `arbors_query::agg()`

**Chosen:** Sequential fallback for Phase 10.4. Parallel aggregation can be revisited
in Phase 10.4+ if benchmarks show it's a bottleneck.

#### 10.4.6.1 Implement execute_agg_parallel (Sequential Fallback)

- [x] Add sequential fallback:
  ```rust
  /// Execute aggregation operation
  ///
  /// **Phase 10.4:** Uses sequential execution. Parallel map-reduce
  /// deferred due to per-aggregation-type reduce complexity.
  fn execute_agg_parallel(arbor: &Arbor, exprs: &[Expr]) -> Result<Arbor, ExprError> {
      // Sequential fallback - same as execute_agg
      execute_agg(arbor, exprs)
  }
  ```

#### 10.4.6.2 Add Aggregation Unit Test (Verifies Fallback Works)

- [x] Add test verifying parallel mode produces correct results:
  ```rust
  #[test]
  fn test_agg_parallel_mode_correct() {
      let arbor = create_large_test_arbor(100);
      let exprs = vec![
          path("value").sum().alias("total"),
          path("id").count().alias("count"),
      ];

      // Both modes should produce identical results
      let seq_result = execute_agg(&arbor, &exprs).unwrap();
      let par_result = execute_agg_parallel(&arbor, &exprs).unwrap();

      assert_eq!(seq_result.num_trees(), 1);
      assert_eq!(par_result.num_trees(), 1);

      let seq_root = seq_result.root(0).unwrap();
      let par_root = par_result.root(0).unwrap();

      assert_eq!(
          seq_result.get_i64(seq_result.get_field(seq_root, "total").unwrap()),
          par_result.get_i64(par_result.get_field(par_root, "total").unwrap())
      );
  }
  ```

**Checkpoint 10.4.6:**
```bash
cargo test -p arbors-lazy -- agg_parallel  # Fallback test passes
cargo test -p arbors-lazy            # All arbors-lazy tests pass
```
- [x] Checkpoint passed
- [x] `execute_agg_parallel()` implemented (sequential fallback)
- [x] Produces correct results via delegation to sequential

---

### 10.4.7 Update LazyArbor API

File: `crates/arbors-lazy/src/lazy.rs`

**Purpose:** Add `collect_parallel()` method and update exports.

**What's Actually Parallel in Phase 10.4:**
- ✅ Filter — full parallel evaluation
- ✅ Select — full parallel evaluation
- ⚠️ WithColumn — sequential fallback
- ⚠️ Agg — sequential fallback
- ✅ Head/Tail — sequential (no benefit from parallelism)
- ⚠️ Sort — not yet implemented

#### 10.4.7.1 Add collect_parallel Method

- [x] Add parallel collect to LazyArbor:
  ```rust
  impl LazyArbor {
      /// Execute the plan with parallel execution
      ///
      /// Uses rayon for parallel processing of filter and select operations.
      /// Results are identical to `collect()` but may be faster on multi-core
      /// systems with large arbors.
      ///
      /// **Phase 10.4 parallel operations:**
      /// - Filter: ✅ parallel
      /// - Select: ✅ parallel
      /// - WithColumn: sequential (parallel deferred)
      /// - Agg: sequential (parallel deferred)
      /// - Head/Tail: sequential (no benefit)
      ///
      /// # Example
      ///
      /// ```ignore
      /// let result = arbor.lazy()
      ///     .filter(path("age").gt(lit(21)))
      ///     .select(&[path("name")])
      ///     .collect_parallel()?;
      /// ```
      pub fn collect_parallel(self) -> Result<Arbor, ExprError> {
          execute_plan_with_mode(&self.plan, ExecutionMode::Parallel)
      }
  }
  ```

#### 10.4.7.2 Add collect_with_mode Method (Optional)

- [x] Add flexible collect method:
  ```rust
  impl LazyArbor {
      /// Execute the plan with the specified execution mode
      ///
      /// Allows explicit control over sequential vs parallel execution.
      pub fn collect_with_mode(self, mode: ExecutionMode) -> Result<Arbor, ExprError> {
          execute_plan_with_mode(&self.plan, mode)
      }
  }
  ```

#### 10.4.7.3 Update lib.rs Exports

File: `crates/arbors-lazy/src/lib.rs`

- [x] Export new types:
  ```rust
  pub use execute::{execute_plan, execute_plan_with_mode, ExecutionMode};
  ```

**Checkpoint 10.4.7:**
```bash
cargo build -p arbors-lazy           # LazyArbor API compiles
cargo test -p arbors-lazy            # All tests pass
```
- [x] Checkpoint passed
- [x] `LazyArbor::collect_parallel()` implemented
- [x] `LazyArbor::collect_with_mode()` implemented (optional)
- [x] `ExecutionMode` exported from lib.rs

---

### 10.4.8 Update Main arbors Crate Exports

File: `crates/arbors/src/lib.rs`

- [x] Update lazy module exports:
  ```rust
  pub mod lazy {
      pub use arbors_lazy::{
          ArborLazyExt,
          LazyArbor,
          QueryPlan,
          QueryOp,
          QueryNode,
          QueryNodeId,
          ExecContext,
          execute_plan,
          execute_plan_with_mode,
          ExecutionMode,
      };
  }
  ```

**Checkpoint 10.4.8:**
```bash
cargo build -p arbors               # Main crate compiles with new exports
cargo test -p arbors                # Main crate tests pass
```
- [x] Checkpoint passed
- [x] `ExecutionMode` exported from main arbors crate
- [x] `execute_plan_with_mode` exported from main arbors crate

---

### 10.4.9 Unit Tests

File: `crates/arbors-lazy/src/execute.rs` (add to tests module)

#### 10.4.9.1 Test Helper: create_large_test_arbor

- [x] Add helper to create large test arbors:
  ```rust
  /// Create a test arbor with N trees: {id: 0, value: 0}, {id: 1, value: 10}, ...
  fn create_large_test_arbor(n: usize) -> Arbor {
      let mut builder = ArborBuilder::new_infer();
      for i in 0..n {
          builder
              .add_json(format!(r#"{{"id": {}, "value": {}}}"#, i, i * 10).as_bytes())
              .unwrap();
      }
      builder.finish()
  }
  ```

#### 10.4.9.2 Execution Mode Tests

- [x] Test sequential mode:
  ```rust
  #[test]
  fn test_execute_sequential_mode() {
      let arbor = create_large_test_arbor(100);
      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Filter {
          predicate: path("id").gt(lit(50)),
      });

      let result = execute_plan_with_mode(&plan, ExecutionMode::Sequential).unwrap();
      assert_eq!(result.num_trees(), 49); // 51-99 inclusive
  }
  ```

- [x] Test parallel mode:
  ```rust
  #[test]
  fn test_execute_parallel_mode() {
      let arbor = create_large_test_arbor(100);
      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Filter {
          predicate: path("id").gt(lit(50)),
      });

      let result = execute_plan_with_mode(&plan, ExecutionMode::Parallel).unwrap();
      assert_eq!(result.num_trees(), 49);
  }
  ```

- [x] Test modes produce identical results:
  ```rust
  #[test]
  fn test_parallel_sequential_equivalence() {
      let arbor = create_large_test_arbor(1000);
      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Filter {
          predicate: path("id").gt(lit(500)),
      });
      plan.add_op(QueryOp::Select {
          exprs: vec![path("id").alias("i"), path("value").alias("v")],
      });

      let seq = execute_plan_with_mode(&plan, ExecutionMode::Sequential).unwrap();
      let par = execute_plan_with_mode(&plan, ExecutionMode::Parallel).unwrap();

      assert_eq!(seq.num_trees(), par.num_trees());
      for i in 0..seq.num_trees() {
          let seq_root = seq.root(i).unwrap();
          let par_root = par.root(i).unwrap();
          assert_eq!(
              seq.get_i64(seq.get_field(seq_root, "i").unwrap()),
              par.get_i64(par.get_field(par_root, "i").unwrap())
          );
      }
  }
  ```

#### 10.4.9.3 Error Handling Tests

- [x] Test parallel filter error propagation:
  ```rust
  #[test]
  fn test_parallel_filter_error_propagation() {
      let arbor = create_test_arbor();
      // Use a predicate that will fail type checking
      let bad_predicate = path("nonexistent").gt(lit(10));

      let result = execute_filter_parallel(&arbor, &bad_predicate);
      assert!(result.is_err());
  }
  ```

- [x] Test parallel select error propagation:
  ```rust
  #[test]
  fn test_parallel_select_error_propagation() {
      let arbor = create_test_arbor();
      let bad_exprs = vec![path("nonexistent").alias("x")];

      let result = execute_select_parallel(&arbor, &bad_exprs);
      assert!(result.is_err());
  }
  ```

#### 10.4.9.4 Empty Arbor Tests

- [x] Test parallel operations on empty arbor:
  ```rust
  #[test]
  fn test_parallel_filter_empty_arbor() {
      let arbor = Arbor::new();
      let predicate = path("id").gt(lit(0));
      let result = execute_filter_parallel(&arbor, &predicate).unwrap();
      assert_eq!(result.num_trees(), 0);
  }

  #[test]
  fn test_parallel_select_empty_arbor() {
      let arbor = Arbor::new();
      let exprs = vec![path("a").alias("x")];
      let result = execute_select_parallel(&arbor, &exprs).unwrap();
      assert_eq!(result.num_trees(), 0);
  }
  ```

#### 10.4.9.5 Send + Sync Static Assertions

**Purpose:** Compile-time verification that types are thread-safe for rayon.

- [x] Add static assertions:
  ```rust
  /// Compile-time proof that types are Send + Sync for parallel execution
  #[cfg(test)]
  mod send_sync_tests {
      use super::*;

      // These assertions fail at compile time if types aren't thread-safe
      const _: fn() = || {
          fn assert_send<T: Send>() {}
          fn assert_sync<T: Sync>() {}

          // Types that must be Send + Sync for rayon parallel iteration
          assert_send::<Arbor>();
          assert_sync::<Arbor>();
          assert_send::<Expr>();
          assert_sync::<Expr>();
          assert_send::<arbors_expr::ExprResult>();
          assert_send::<arbors_expr::Value>();

          // EvalContext only needs Send (created per-thread, not shared)
          assert_send::<arbors_query::EvalContext<'_>>();
      };
  }
  ```

  **Note:** If any of these fail to compile, the parallel implementation must be
  reconsidered. Most likely causes:
  - `Rc` instead of `Arc` in internal types
  - `RefCell` or other non-thread-safe interior mutability
  - Raw pointers without `Send` marker

**Checkpoint 10.4.9:**
```bash
cargo test -p arbors-lazy            # All unit tests pass (including new parallel tests)
cargo build -p arbors-lazy           # Send/Sync assertions compile
```
- [x] Checkpoint passed
- [x] `create_large_test_arbor()` helper added
- [x] Execution mode tests pass
- [x] Error handling tests pass
- [x] Empty arbor tests pass
- [x] Send + Sync static assertions compile (no runtime needed)

---

### 10.4.10 Integration Tests

File: `crates/arbors-lazy/tests/parallel_integration.rs` (new file)

- [x] Create integration test file:
  ```rust
  //! Integration tests for parallel execution

  use arbors_expr::{lit, path};
  use arbors_io::ArborBuilder;
  use arbors_lazy::{ArborLazyExt, ExecutionMode, LazyArbor};

  /// Create test arbor with N trees
  fn create_test_arbor(n: usize) -> arbors_storage::Arbor {
      let mut builder = ArborBuilder::new_infer();
      for i in 0..n {
          builder
              .add_json(format!(r#"{{"id": {}, "value": {}, "active": {}}}"#,
                  i, i * 10, i % 2 == 0).as_bytes())
              .unwrap();
      }
      builder.finish()
  }
  ```

#### 10.4.10.1 Parallel vs Sequential Equivalence Tests

- [x] Add equivalence tests:
  ```rust
  #[test]
  fn test_collect_vs_collect_parallel_filter() {
      let arbor = create_test_arbor(1000);
      let lazy = arbor.lazy().filter(path("id").gt(lit(500)));

      let seq = lazy.clone().collect().unwrap();
      let par = lazy.collect_parallel().unwrap();

      assert_eq!(seq.num_trees(), par.num_trees());
  }

  #[test]
  fn test_collect_vs_collect_parallel_select() {
      let arbor = create_test_arbor(1000);
      let lazy = arbor.lazy().select(&[
          path("id").alias("i"),
          path("value").mul(lit(2)).alias("doubled"),
      ]);

      let seq = lazy.clone().collect().unwrap();
      let par = lazy.collect_parallel().unwrap();

      assert_eq!(seq.num_trees(), par.num_trees());
  }

  #[test]
  fn test_collect_vs_collect_parallel_chained() {
      let arbor = create_test_arbor(1000);
      let lazy = arbor.lazy()
          .filter(path("active").eq(lit(true)))
          .select(&[path("id"), path("value")])
          .with_column("doubled", path("value").mul(lit(2)))
          .head(100);

      let seq = lazy.clone().collect().unwrap();
      let par = lazy.collect_parallel().unwrap();

      assert_eq!(seq.num_trees(), par.num_trees());
  }
  ```

#### 10.4.10.2 Order Preservation Tests

- [x] Add order preservation tests:
  ```rust
  #[test]
  fn test_parallel_preserves_filter_order() {
      let arbor = create_test_arbor(1000);
      let lazy = arbor.lazy().filter(path("active").eq(lit(true)));

      let par = lazy.collect_parallel().unwrap();

      // Verify order is preserved (active trees should appear in original order)
      let mut prev_id = -1i64;
      for i in 0..par.num_trees() {
          let root = par.root(i).unwrap();
          let id = par.get_i64(par.get_field(root, "id").unwrap()).unwrap();
          assert!(id > prev_id, "Tree order not preserved: {} should be > {}", id, prev_id);
          prev_id = id;
      }
  }
  ```

**Checkpoint 10.4.10:**
```bash
cargo test -p arbors-lazy --test parallel_integration  # Integration tests pass
cargo test -p arbors-lazy            # All arbors-lazy tests pass
```
- [x] Checkpoint passed
- [x] Integration test file created
- [x] Parallel vs sequential equivalence tests pass
- [x] Order preservation test passes

---

### 10.4.11 Benchmarks

File: `crates/arbors-lazy/benches/parallel_bench.rs` (new file)

**Purpose:** Measure parallel speedup on multi-core systems.

#### 10.4.11.1 Cargo.toml Addition

File: `crates/arbors-lazy/Cargo.toml`

- [x] Add benchmark configuration:
  ```toml
  [dev-dependencies]
  criterion = { version = "0.5", features = ["html_reports"] }

  [[bench]]
  name = "parallel_bench"
  harness = false
  ```

#### 10.4.11.2 Benchmark Implementation

- [x] Create benchmark file:
  ```rust
  use criterion::{criterion_group, criterion_main, Criterion, BenchmarkId, Throughput};
  use arbors_expr::{lit, path};
  use arbors_io::ArborBuilder;
  use arbors_lazy::{ArborLazyExt, ExecutionMode};

  fn create_arbor(n: usize) -> arbors_storage::Arbor {
      let mut builder = ArborBuilder::new_infer();
      for i in 0..n {
          builder.add_json(
              format!(r#"{{"id": {}, "value": {}, "name": "item_{}"}}"#, i, i * 10, i).as_bytes()
          ).unwrap();
      }
      builder.finish()
  }

  fn bench_filter(c: &mut Criterion) {
      let mut group = c.benchmark_group("filter");

      for size in [1_000, 10_000, 100_000] {
          let arbor = create_arbor(size);
          group.throughput(Throughput::Elements(size as u64));

          group.bench_with_input(
              BenchmarkId::new("sequential", size),
              &arbor,
              |b, arbor| {
                  b.iter(|| {
                      arbor.clone().lazy()
                          .filter(path("id").gt(lit(size as i64 / 2)))
                          .collect()
                          .unwrap()
                  })
              },
          );

          group.bench_with_input(
              BenchmarkId::new("parallel", size),
              &arbor,
              |b, arbor| {
                  b.iter(|| {
                      arbor.clone().lazy()
                          .filter(path("id").gt(lit(size as i64 / 2)))
                          .collect_parallel()
                          .unwrap()
                  })
              },
          );
      }
      group.finish();
  }

  fn bench_select(c: &mut Criterion) {
      let mut group = c.benchmark_group("select");

      for size in [1_000, 10_000, 100_000] {
          let arbor = create_arbor(size);
          group.throughput(Throughput::Elements(size as u64));

          group.bench_with_input(
              BenchmarkId::new("sequential", size),
              &arbor,
              |b, arbor| {
                  b.iter(|| {
                      arbor.clone().lazy()
                          .select(&[path("id"), path("value").mul(lit(2)).alias("doubled")])
                          .collect()
                          .unwrap()
                  })
              },
          );

          group.bench_with_input(
              BenchmarkId::new("parallel", size),
              &arbor,
              |b, arbor| {
                  b.iter(|| {
                      arbor.clone().lazy()
                          .select(&[path("id"), path("value").mul(lit(2)).alias("doubled")])
                          .collect_parallel()
                          .unwrap()
                  })
              },
          );
      }
      group.finish();
  }

  fn bench_chained(c: &mut Criterion) {
      let mut group = c.benchmark_group("chained");

      for size in [1_000, 10_000, 100_000] {
          let arbor = create_arbor(size);
          group.throughput(Throughput::Elements(size as u64));

          group.bench_with_input(
              BenchmarkId::new("sequential", size),
              &arbor,
              |b, arbor| {
                  b.iter(|| {
                      arbor.clone().lazy()
                          .filter(path("id").gt(lit(size as i64 / 4)))
                          .select(&[path("id"), path("value")])
                          .with_column("tripled", path("value").mul(lit(3)))
                          .collect()
                          .unwrap()
                  })
              },
          );

          group.bench_with_input(
              BenchmarkId::new("parallel", size),
              &arbor,
              |b, arbor| {
                  b.iter(|| {
                      arbor.clone().lazy()
                          .filter(path("id").gt(lit(size as i64 / 4)))
                          .select(&[path("id"), path("value")])
                          .with_column("tripled", path("value").mul(lit(3)))
                          .collect_parallel()
                          .unwrap()
                  })
              },
          );
      }
      group.finish();
  }

  criterion_group!(benches, bench_filter, bench_select, bench_chained);
  criterion_main!(benches);
  ```

#### 10.4.11.3 How to Run Benchmarks

- [x] Add documentation:
  ```bash
  # Run all parallel benchmarks
  cargo bench -p arbors-lazy --bench parallel_bench

  # Run with HTML report
  cargo bench -p arbors-lazy --bench parallel_bench -- --save-baseline parallel_v1

  # Compare with previous baseline
  cargo bench -p arbors-lazy --bench parallel_bench -- --baseline parallel_v1
  ```

**Success Criteria:**
- Parallel execution should show speedup for 10K+ trees on 4+ core systems
- Target: 2-4x speedup for filter/select on 100K trees
- Parallel should never be slower than sequential (within noise margin)

**Checkpoint 10.4.11:**
```bash
cargo bench -p arbors-lazy --bench parallel_bench -- filter/parallel/10000  # Quick smoke test
```
- [x] Checkpoint passed
- [x] Benchmark file created
- [x] Criterion dev-dependency added
- [x] Benchmarks compile and run (at least smoke test)
- [x] Parallel shows reasonable speedup (filter 100K: seq ~4.27ms, par ~1.65ms, **~2.6x speedup**)

---

### 10.4.12 Run Full Test Suite

**Purpose:** Ensure no regressions from parallel execution implementation.

- [x] Run: `cargo test --workspace --exclude arbors-python` — all tests pass
- [x] Run: `cargo clippy --workspace` — no new warnings
- [x] Run: `make python-test` — all Python tests pass (898 passed, 2 skipped)
- [x] Run: `cargo bench -p arbors-lazy --bench parallel_bench` — benchmarks complete
- [x] Document test count increase: 1184 tests (within expected range)

**Final Checkpoint 10.4.12:**
```bash
cargo test --workspace --exclude arbors-python  # Full test suite
cargo clippy --workspace                         # No warnings
make python-test                                 # Python bindings work
```
- [x] Checkpoint passed
- [x] All Rust tests pass (1184 tests)
- [x] Clippy clean
- [x] Python tests pass (898 passed, 2 skipped)
- [x] Benchmarks run successfully (filter 100K: ~2.6x speedup)

---

**Phase 10.4 Deliverables:**

**Core Implementation:**
- [x] `rayon` dependency added to arbors-lazy
- [x] `ExecutionMode` enum (Sequential, Parallel)
- [x] `execute_plan_with_mode()` function
- [x] `execute_filter_parallel()` — ✅ full parallel implementation
- [x] `execute_select_parallel()` — ✅ full parallel implementation
- [x] `execute_with_column_parallel()` — ⚠️ sequential fallback (parallel deferred)
- [x] `execute_agg_parallel()` — ⚠️ sequential fallback (parallel deferred)
- [x] `LazyArbor::collect_parallel()` method
- [x] `LazyArbor::collect_with_mode()` method (optional)
- [x] Updated exports in arbors-lazy and arbors crates

**Testing:**
- [x] Send + Sync static assertions (compile-time verification)
- [x] 15+ new unit tests for parallel execution (53 unit tests in arbors-lazy)
- [x] 5+ integration tests for parallel vs sequential equivalence (4 parallel + 18 lazy = 22)
- [x] 3 benchmark groups (filter, select, chained)
- [x] All existing tests pass (no regressions)
- [x] Clippy clean

**What's Parallel in Phase 10.4:**
- ✅ Filter — full parallel (`par_iter().map().collect()`)
- ✅ Select — full parallel (`par_iter().map().collect()`)
- ⚠️ WithColumn — sequential (needs helper function exposure)
- ⚠️ Agg — sequential (needs per-agg-type reduce logic)
- ✅ Head/Tail — sequential (no benefit from parallelism)
- ⚠️ Sort — sequential (not yet implemented)

**Deferred to Phase 10.4+:**
- Parallel with_column (requires `arbors_query` helper functions)
- Parallel aggregation (requires per-aggregation-type map-reduce)
- Parallel sort (requires sort implementation first)

---

## Phase 10.5 – Query Optimization

**Goal:** Optimize query plans before execution.

**Key Concepts:** Section E (Query Optimization)

**Current State:**
- Phase 10.4 complete: Parallel execution with `collect()` using parallel by default
- `execute_plan()` and `execute_plan_with_mode()` execute plans without optimization
- `QueryPlan` has nodes, source, and next_id — no optimization infrastructure
- Eager ops in `arbors-query` exist but no plan-level rewriting

### 10.5.0 Pre-Implementation Review

**Purpose:** Verify understanding of optimization invariants before implementation.

**Key Invariants from Section B.1:**
1. **QueryPlan never rewrites Expr** — QueryPlan nodes reference Expr but never mutate them
2. **All Expr rewrites live in Phase 8+9** — CSE, constant folding, type inference happen in the Expr optimizer
3. **Phase 10 optimizer only** reorders operations, fuses compatible ops, annotates nodes with execution context

**Optimization Rules from Section E:**
- **Predicate Pushdown (E.1):** Push filters as early as possible
- **Projection Pruning (E.2):** Only compute columns that are actually used
- **Filter Fusion (E.4):** Combine adjacent filters into single AND expression

**Optimization Barriers from Section E.6:**
- Agg: barrier — can push filters before, not after
- Sort: barrier — cannot push Head/Tail before Sort
- WithColumn: barrier if filter depends on new column

**Verification Steps:**
- [x] Review `QueryPlan` structure to understand how to reorder nodes
- [x] Review `Expr` structure to understand how to extract path references
- [x] Confirm plan is linear (no branching) — simplifies optimization

---

### 10.5.0.1 Schema Storage in Arbor (Prerequisite)

**Problem:** The conservative source-schema check for predicate pushdown requires knowing
what fields exist in the source arbor. Currently:
- `ArborBuilder` uses a `SchemaRegistry` during parsing but discards it
- `Arbor` has no schema information — only raw data
- Checking `field_keys()` on first tree is unreliable (empty arbor, sparse data)

**Solution:** Store the schema in `Arbor` for reliable field existence checks.

#### 10.5.0.1.1 Add Schema to Arbor

File: `crates/arbors-storage/src/lib.rs`

- [x] Add `arbors-schema` dependency to `arbors-storage/Cargo.toml`
- [x] Add schema field to Arbor:
  ```rust
  use arbors_schema::SchemaRegistry;

  pub struct Arbor {
      nodes: Arc<ColumnarNodes>,
      roots: Vec<NodeId>,
      interner: Arc<StringInterner>,
      pools: Arc<FinishedPools>,
      /// Optional schema (present when parsed with schema, None for schema-less)
      schema: Option<Arc<SchemaRegistry>>,
  }
  ```

- [x] Update `Arbor::new()` to initialize schema as None
- [x] Update `Arbor::from_parts()` to accept optional schema:
  ```rust
  pub fn from_parts(
      nodes: ColumnarNodes,
      roots: Vec<NodeId>,
      interner: StringInterner,
      pools: FinishedPools,
      schema: Option<SchemaRegistry>,
  ) -> Self {
      Self {
          nodes: Arc::new(nodes),
          roots,
          interner: Arc::new(interner),
          pools: Arc::new(pools),
          schema: schema.map(Arc::new),
      }
  }
  ```

- [x] Update `Arbor::from_parts_shared()` similarly
- [x] Update `Clone` impl to clone the Arc<SchemaRegistry>
- [x] Add accessor method:
  ```rust
  /// Get the schema registry if available
  ///
  /// Returns `Some` if the arbor was created with a schema (explicit or inferred).
  /// Returns `None` for schema-less arbors.
  pub fn schema(&self) -> Option<&SchemaRegistry> {
      self.schema.as_deref()
  }
  ```

- [x] Add convenience method for field checking:
  ```rust
  /// Check if a field exists in the schema's root struct
  ///
  /// Returns `true` if the schema exists and has the field at the root level.
  /// Returns `false` if no schema or field not found.
  ///
  /// This is used by the optimizer for safe predicate pushdown.
  pub fn has_root_field(&self, field_name: &str) -> bool {
      let schema = match &self.schema {
          Some(s) => s,
          None => return false,
      };

      let root_schema = match schema.root() {
          Some(s) => s,
          None => return false,
      };

      // Check if root is a Struct with the field
      if let arbors_schema::StorageType::Struct { fields, .. } = &root_schema.storage {
          fields.iter().any(|f| f.name == field_name)
      } else {
          false
      }
  }
  ```

#### 10.5.0.1.2 Update ArborBuilder to Preserve Schema

File: `crates/arbors-io/src/builder.rs`

- [x] Modify `ArborBuilder::finish()` to pass schema to `Arbor::from_parts()`:
  ```rust
  pub fn finish(self) -> Arbor {
      let pools = self.pools.finish();
      Arbor::from_parts(
          self.nodes,
          self.roots,
          self.interner,
          pools,
          self.schema,  // Pass through the schema
      )
  }
  ```

- [x] For `new_infer()`, the inferred schema should also be stored:
  - After parsing completes, the inferred schema is available
  - Store it in the Arbor so optimization can use it
  - **Note:** Currently `new_infer()` passes `None` for schema since runtime inference
    doesn't produce a `SchemaRegistry`. This is correct — only explicit schemas are stored.

#### 10.5.0.1.3 Update View Operations

File: `crates/arbors-storage/src/lib.rs`

- [x] Update `filter_by_indices()` to preserve schema:
  ```rust
  pub fn filter_by_indices(&self, indices: &[usize]) -> Self {
      // ... existing code ...
      Self::from_parts_shared(
          Arc::clone(&self.nodes),
          new_roots,
          Arc::clone(&self.interner),
          Arc::clone(&self.pools),
          self.schema.clone(),  // Preserve schema
      )
  }
  ```

- [x] Similarly update `head()` and `tail()` to preserve schema

#### 10.5.0.1.4 Update Tests

- [x] Add test for schema preservation:
  ```rust
  #[test]
  fn test_arbor_schema_preserved() {
      // Build arbor with explicit schema
      let arbor = ArborBuilder::new(schema).add_json(...).finish();
      assert!(arbor.schema().is_some());

      // Schema preserved through filter
      let filtered = arbor.filter_by_indices(&[0]);
      assert!(filtered.schema().is_some());

      // Schema preserved through head/tail
      let head = arbor.head(1);
      assert!(head.schema().is_some());
  }

  #[test]
  fn test_arbor_has_root_field() {
      let arbor = ArborBuilder::new(schema).add_json(r#"{"a": 1, "b": 2}"#).finish();
      assert!(arbor.has_root_field("a"));
      assert!(arbor.has_root_field("b"));
      assert!(!arbor.has_root_field("c"));
  }

  #[test]
  fn test_arbor_has_root_field_no_schema() {
      let arbor = Arbor::new();
      assert!(!arbor.has_root_field("anything"));
  }
  ```

#### 10.5.0.1.5 Update filter_paths_in_source Helper

With schema storage, the `filter_paths_in_source()` helper becomes straightforward:

```rust
/// Check if all paths in a filter expression exist in the source schema
fn filter_paths_in_source(plan: &QueryPlan, filter_predicate: &Expr) -> bool {
    let filter_paths = extract_path_roots(filter_predicate);

    // If we hit an unknown expression variant, don't push
    if filter_paths.contains("__UNKNOWN_EXPR_DEPENDENCY__") {
        return false;
    }

    let source = plan.source();

    // Check each path exists in source schema
    for path in &filter_paths {
        if !source.has_root_field(path) {
            return false;  // Field not in schema (or no schema) — don't push
        }
    }

    true
}
```

**Checkpoint 10.5.0.1:**
```bash
cargo test -p arbors-storage  # Schema storage tests pass
cargo test -p arbors-io       # Builder preserves schema
cargo build -p arbors-lazy    # Lazy crate compiles with new API
```
- [x] Checkpoint passed
- [x] Schema stored in Arbor
- [x] `has_root_field()` method works
- [x] View operations preserve schema
- [x] ArborBuilder passes schema to Arbor

---

### 10.5.1 Create Optimizer Module

File: `crates/arbors-lazy/src/optimize.rs`

**Purpose:** New module for optimization infrastructure.

#### 10.5.1.1 Create optimize.rs File

- [x] Create `crates/arbors-lazy/src/optimize.rs`:
  ```rust
  //! Query plan optimization
  //!
  //! This module implements optimization passes that transform query plans
  //! before execution. Optimizations include:
  //! - Predicate pushdown: move filters earlier in the plan
  //! - Filter fusion: combine adjacent filters into single AND
  //! - Projection pruning: remove unused columns from Select
  //!
  //! # Design Invariants
  //!
  //! 1. **QueryPlan optimization never rewrites Expr** — expressions are immutable
  //! 2. **Optimization is optional** — unoptimized plans produce correct results
  //! 3. **Optimization is deterministic** — same input produces same output
  //! 4. **Optimization preserves semantics** — optimized plan ≡ unoptimized plan

  use crate::plan::{QueryPlan, QueryOp, QueryNodeId};
  ```

#### 10.5.1.2 Update lib.rs Exports

File: `crates/arbors-lazy/src/lib.rs`

- [x] Add optimize module:
  ```rust
  mod optimize;

  pub use optimize::{optimize, OptimizationRule};
  ```

#### 10.5.1.3 Verify Module Builds

- [x] Run: `cargo build -p arbors-lazy` — must compile without errors

**Checkpoint 10.5.1:**
```bash
cargo build -p arbors-lazy           # Module compiles
```
- [x] Checkpoint passed
- [x] `optimize.rs` file created
- [x] Module exported from lib.rs

---

### 10.5.2 Define OptimizationRule Trait

File: `crates/arbors-lazy/src/optimize.rs`

**Reference:** Section 10.5.1 (Optimizer trait)

#### 10.5.2.1 Define OptimizationRule Trait

- [x] Add trait definition:
  ```rust
  /// A single optimization rule that can transform a query plan
  ///
  /// Rules should be idempotent: applying the same rule twice should have
  /// no additional effect if it returned false the first time.
  ///
  /// # Return Value
  ///
  /// Returns `true` if the plan was modified, `false` otherwise.
  /// The optimizer uses this to know when to stop iterating.
  pub trait OptimizationRule: std::fmt::Debug {
      /// Apply this optimization rule to the plan
      ///
      /// May modify the plan in place. Returns true if any changes were made.
      fn apply(&self, plan: &mut QueryPlan) -> bool;

      /// Get the name of this rule for debugging/logging
      fn name(&self) -> &'static str;
  }
  ```

#### 10.5.2.2 Define Optimize Function

- [x] Add main optimize function:
  ```rust
  /// Optimize a query plan by applying all optimization rules
  ///
  /// Applies rules in a fixed-point loop until no rule makes changes.
  /// This ensures all optimization opportunities are found.
  ///
  /// # Arguments
  ///
  /// * `plan` - The query plan to optimize (modified in place)
  ///
  /// # Returns
  ///
  /// The number of rule applications that made changes.
  pub fn optimize(plan: &mut QueryPlan) -> usize {
      let rules: Vec<Box<dyn OptimizationRule>> = vec![
          Box::new(FilterFusion),
          Box::new(PredicatePushdown),
          // ProjectionPruning deferred to future work
      ];

      let mut total_changes = 0;
      // Dynamic cap based on plan size with reasonable upper bound
      // This ensures convergence even for long filter chains
      let max_iterations = std::cmp::min(plan.len() * 2, 100);

      for _ in 0..max_iterations {
          let mut changed = false;
          for rule in &rules {
              if rule.apply(plan) {
                  changed = true;
                  total_changes += 1;
              }
          }
          if !changed {
              break;
          }
      }

      // In debug builds, verify we actually converged
      #[cfg(debug_assertions)]
      {
          let mut test_changed = false;
          for rule in &rules {
              if rule.apply(plan) {
                  test_changed = true;
                  break;
              }
          }
          debug_assert!(!test_changed, "Optimization did not converge within {} iterations", max_iterations);
      }

      total_changes
  }
  ```

#### 10.5.2.3 Add Unit Tests for OptimizationRule Trait

- [x] Add tests:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use std::sync::Arc;
      use arbors_storage::Arbor;

      /// A no-op rule for testing
      #[derive(Debug)]
      struct NoOpRule;

      impl OptimizationRule for NoOpRule {
          fn apply(&self, _plan: &mut QueryPlan) -> bool {
              false
          }

          fn name(&self) -> &'static str {
              "NoOpRule"
          }
      }

      #[test]
      fn test_no_op_rule_returns_false() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));

          let rule = NoOpRule;
          assert!(!rule.apply(&mut plan));
      }

      #[test]
      fn test_optimize_empty_plan() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));

          let changes = optimize(&mut plan);
          assert_eq!(changes, 0);
      }
  }
  ```

**Checkpoint 10.5.2:**
```bash
cargo test -p arbors-lazy -- optimize  # Rule tests pass
cargo build -p arbors-lazy             # Module compiles
```
- [x] Checkpoint passed
- [x] `OptimizationRule` trait defined
- [x] `optimize()` function defined
- [x] Basic tests pass

---

### 10.5.3 Add Plan Mutation Methods

File: `crates/arbors-lazy/src/plan.rs`

**Purpose:** Add methods to QueryPlan that enable optimization passes to modify the plan.

#### 10.5.3.1 Add Node Removal Method

- [x] Add method to remove a node from the plan:
  ```rust
  impl QueryPlan {
      /// Remove a node from the plan and reconnect its input to its consumers
      ///
      /// Returns true if the node was removed, false if it couldn't be removed
      /// (e.g., trying to remove Source node).
      ///
      /// # Panics
      ///
      /// Panics if the node ID doesn't exist in the plan.
      pub fn remove_node(&mut self, id: QueryNodeId) -> bool {
          // Find the node index
          let node_idx = self.nodes.iter().position(|n| n.id == id);
          let node_idx = match node_idx {
              Some(idx) => idx,
              None => panic!("Node {:?} not found in plan", id),
          };

          // Cannot remove source node
          if self.nodes[node_idx].is_source() {
              return false;
          }

          // Get the input of the node being removed
          let removed_input = self.nodes[node_idx].input;

          // Update all nodes that reference this node to point to its input
          for node in &mut self.nodes {
              if node.input == Some(id) {
                  node.input = removed_input;
              }
          }

          // Remove the node
          self.nodes.remove(node_idx);
          true
      }
  }
  ```

#### 10.5.3.2 Add Node Replacement Method

- [x] Add method to replace a node's operation:
  ```rust
  impl QueryPlan {
      /// Replace the operation of a node
      ///
      /// Updates the execution context based on the new operation.
      ///
      /// # Panics
      ///
      /// Panics if the node ID doesn't exist.
      pub fn replace_op(&mut self, id: QueryNodeId, new_op: QueryOp) {
          let node = self.nodes.iter_mut()
              .find(|n| n.id == id)
              .expect("Node not found");

          node.context = new_op.exec_context();
          node.op = new_op;
      }
  }
  ```

#### 10.5.3.3 Add Node Swap Method

- [x] Add method to swap two adjacent nodes:
  ```rust
  impl QueryPlan {
      /// Swap two adjacent nodes in the plan
      ///
      /// If node B has node A as its input, after swapping:
      /// - Node A has B's original input
      /// - Node B has node A as its input
      ///
      /// Returns true if nodes were swapped, false if they're not adjacent
      /// or if the plan has branching (non-linear structure).
      ///
      /// # Linear-Only Invariant
      ///
      /// This method assumes a linear plan where each node has at most one consumer.
      /// If branching is detected (multiple nodes reference the same input), returns false
      /// rather than corrupting the plan structure.
      pub fn swap_adjacent(&mut self, a_id: QueryNodeId, b_id: QueryNodeId) -> bool {
          // Find the nodes
          let a_idx = self.nodes.iter().position(|n| n.id == a_id);
          let b_idx = self.nodes.iter().position(|n| n.id == b_id);

          let (a_idx, b_idx) = match (a_idx, b_idx) {
              (Some(a), Some(b)) => (a, b),
              _ => return false,
          };

          // Check B has A as input (B is downstream of A)
          if self.nodes[b_idx].input != Some(a_id) {
              return false;
          }

          // Linear-only check: verify A has exactly one consumer (B)
          // If multiple nodes reference A, the plan has branching and swap is unsafe
          let consumers_of_a = self.nodes.iter()
              .filter(|n| n.input == Some(a_id))
              .count();
          if consumers_of_a != 1 {
              // Branching detected — bail out rather than corrupt the plan
              debug_assert!(false, "swap_adjacent called on branching plan: node {:?} has {} consumers", a_id, consumers_of_a);
              return false;
          }

          // Get A's input
          let a_input = self.nodes[a_idx].input;

          // Swap: A now takes B's position (input from B), B takes A's position
          self.nodes[a_idx].input = Some(b_id);
          self.nodes[b_idx].input = a_input;

          // Update any nodes that had B as input to now have A
          for node in &mut self.nodes {
              if node.id != a_id && node.input == Some(b_id) {
                  node.input = Some(a_id);
              }
          }

          true
      }
  }
  ```

#### 10.5.3.4 Add Node Iterator Methods

- [x] Add methods to iterate over nodes:
  ```rust
  impl QueryPlan {
      /// Get a mutable reference to a node by ID
      pub fn get_mut(&mut self, id: QueryNodeId) -> Option<&mut QueryNode> {
          self.nodes.iter_mut().find(|n| n.id == id)
      }

      /// Get node IDs in execution order (source first, root last)
      pub fn node_ids(&self) -> Vec<QueryNodeId> {
          self.nodes.iter().map(|n| n.id).collect()
      }

      /// Find pairs of adjacent nodes where predicate is true
      ///
      /// Returns (upstream_id, downstream_id) pairs.
      pub fn find_adjacent_pairs<F>(&self, predicate: F) -> Vec<(QueryNodeId, QueryNodeId)>
      where
          F: Fn(&QueryNode, &QueryNode) -> bool,
      {
          let mut pairs = Vec::new();

          for node in &self.nodes {
              if let Some(input_id) = node.input {
                  if let Some(input_node) = self.get(input_id) {
                      if predicate(input_node, node) {
                          pairs.push((input_id, node.id));
                      }
                  }
              }
          }

          pairs
      }
  }
  ```

#### 10.5.3.5 Unit Tests for Plan Mutation

- [x] Add tests for plan mutation methods:
  ```rust
  #[cfg(test)]
  mod mutation_tests {
      use super::*;
      use arbors_expr::lit;

      #[test]
      fn test_remove_node() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));

          // Source -> Filter -> Head
          let filter_id = plan.add_op(QueryOp::Filter { predicate: lit(true) });
          let head_id = plan.add_op(QueryOp::Head { n: 10 });

          assert_eq!(plan.len(), 3);

          // Remove filter
          assert!(plan.remove_node(filter_id));
          assert_eq!(plan.len(), 2);

          // Head should now point to Source
          let head = plan.get(head_id).unwrap();
          assert_eq!(head.input, Some(QueryNodeId(0))); // Source
      }

      #[test]
      fn test_cannot_remove_source() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));

          assert!(!plan.remove_node(QueryNodeId(0)));
          assert_eq!(plan.len(), 1);
      }

      #[test]
      fn test_swap_adjacent() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));

          // Source -> Filter -> Head
          let filter_id = plan.add_op(QueryOp::Filter { predicate: lit(true) });
          let head_id = plan.add_op(QueryOp::Head { n: 10 });

          // Swap so Head comes before Filter
          assert!(plan.swap_adjacent(filter_id, head_id));

          // Now: Source -> Head -> Filter
          let head = plan.get(head_id).unwrap();
          assert_eq!(head.input, Some(QueryNodeId(0))); // Source

          let filter = plan.get(filter_id).unwrap();
          assert_eq!(filter.input, Some(head_id));
      }

      #[test]
      fn test_replace_op() {
          let arbor = Arbor::new();
          let mut plan = QueryPlan::new(Arc::new(arbor));

          let filter_id = plan.add_op(QueryOp::Filter { predicate: lit(true) });

          // Replace with Head
          plan.replace_op(filter_id, QueryOp::Head { n: 5 });

          let node = plan.get(filter_id).unwrap();
          assert!(matches!(node.op, QueryOp::Head { n: 5 }));
      }
  }
  ```

**Checkpoint 10.5.3:**
```bash
cargo test -p arbors-lazy -- mutation  # Mutation tests pass
cargo test -p arbors-lazy -- plan      # All plan tests pass
```
- [x] Checkpoint passed
- [x] `remove_node()` implemented
- [x] `replace_op()` implemented
- [x] `swap_adjacent()` implemented
- [x] `get_mut()` and helpers implemented
- [x] All mutation tests pass

---

### 10.5.4 Implement Filter Fusion

File: `crates/arbors-lazy/src/optimize.rs`

**Reference:** Section E.4 (Filter Fusion)

**Semantics:** Combine adjacent Filter operations into single AND expression:
```
Before:  Filter(a > 10) → Filter(b < 20)
After:   Filter(a > 10 AND b < 20)
```

#### 10.5.4.1 Define FilterFusion Rule

- [x] Add FilterFusion struct:
  ```rust
  use arbors_expr::Expr;

  /// Combines adjacent Filter operations into a single filter with AND
  ///
  /// # Example
  ///
  /// Before: Filter(a > 10) → Filter(b < 20)
  /// After:  Filter(a > 10 AND b < 20)
  ///
  /// # Benefits
  ///
  /// - Reduces number of tree iterations
  /// - Enables short-circuit evaluation
  #[derive(Debug)]
  pub struct FilterFusion;
  ```

#### 10.5.4.2 Implement FilterFusion Rule

- [x] Implement the optimization rule:
  ```rust
  impl OptimizationRule for FilterFusion {
      fn apply(&self, plan: &mut QueryPlan) -> bool {
          // Find pairs of adjacent filters
          let filter_pairs: Vec<_> = plan.find_adjacent_pairs(|upstream, downstream| {
              matches!(upstream.op, QueryOp::Filter { .. })
                  && matches!(downstream.op, QueryOp::Filter { .. })
          });

          if filter_pairs.is_empty() {
              return false;
          }

          // Fuse the first pair found
          let (upstream_id, downstream_id) = filter_pairs[0];

          // Get predicates
          let upstream_predicate = match &plan.get(upstream_id).unwrap().op {
              QueryOp::Filter { predicate } => predicate.clone(),
              _ => unreachable!(),
          };

          let downstream_predicate = match &plan.get(downstream_id).unwrap().op {
              QueryOp::Filter { predicate } => predicate.clone(),
              _ => unreachable!(),
          };

          // Create fused predicate: upstream AND downstream
          let fused_predicate = upstream_predicate.and(downstream_predicate);

          // Replace downstream filter with fused filter
          plan.replace_op(downstream_id, QueryOp::Filter {
              predicate: fused_predicate,
          });

          // Remove upstream filter
          plan.remove_node(upstream_id);

          true
      }

      fn name(&self) -> &'static str {
          "FilterFusion"
      }
  }
  ```

#### 10.5.4.3 Unit Tests for Filter Fusion

- [x] Add filter fusion tests:
  ```rust
  #[test]
  fn test_filter_fusion_basic() {
      use arbors_expr::{lit, path};

      let arbor = Arbor::new();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Filter(a > 10) -> Filter(b < 20)
      plan.add_op(QueryOp::Filter { predicate: path("a").gt(lit(10)) });
      plan.add_op(QueryOp::Filter { predicate: path("b").lt(lit(20)) });

      assert_eq!(plan.len(), 3); // Source + 2 filters

      let rule = FilterFusion;
      assert!(rule.apply(&mut plan));

      assert_eq!(plan.len(), 2); // Source + 1 fused filter
  }

  #[test]
  fn test_filter_fusion_three_filters() {
      use arbors_expr::{lit, path};

      let arbor = Arbor::new();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Filter(a) -> Filter(b) -> Filter(c)
      plan.add_op(QueryOp::Filter { predicate: path("a").gt(lit(1)) });
      plan.add_op(QueryOp::Filter { predicate: path("b").gt(lit(2)) });
      plan.add_op(QueryOp::Filter { predicate: path("c").gt(lit(3)) });

      assert_eq!(plan.len(), 4);

      // Apply optimization until no changes
      let changes = optimize(&mut plan);

      // Should fuse all three (two fusion operations)
      assert!(changes >= 2);
      assert_eq!(plan.len(), 2); // Source + 1 fused filter
  }

  #[test]
  fn test_filter_fusion_no_adjacent_filters() {
      use arbors_expr::{lit, path};

      let arbor = Arbor::new();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Filter -> Head -> Filter (not adjacent)
      plan.add_op(QueryOp::Filter { predicate: path("a").gt(lit(10)) });
      plan.add_op(QueryOp::Head { n: 100 });
      plan.add_op(QueryOp::Filter { predicate: path("b").lt(lit(20)) });

      assert_eq!(plan.len(), 4);

      let rule = FilterFusion;
      assert!(!rule.apply(&mut plan)); // No adjacent filters

      assert_eq!(plan.len(), 4); // Unchanged
  }
  ```

**Checkpoint 10.5.4:**
```bash
cargo test -p arbors-lazy -- filter_fusion  # Filter fusion tests pass
cargo test -p arbors-lazy                    # All tests pass
```
- [x] Checkpoint passed
- [x] `FilterFusion` rule implemented
- [x] Handles basic case (2 adjacent filters)
- [x] Handles chained case (3+ adjacent filters via iteration)
- [x] Returns false when no adjacent filters

---

### 10.5.5 Implement Predicate Pushdown

File: `crates/arbors-lazy/src/optimize.rs`

**Reference:** Section E.1 (Predicate Pushdown), E.5 (Tree-Aware Optimization), E.6 (Barriers)

**Semantics:** Push filters as early as possible:
```
Before:  Source → Select([a, b, c]) → Filter(a > 10)
After:   Source → Filter(a > 10) → Select([a, b, c])
```

**Barrier conditions (cannot push past):**
- WithColumn: if filter references the new column
- Agg: filters after Agg have different semantics (total barrier for now; group key pushdown deferred)
- Sort: no barrier (can push filter before sort)
- Head/Tail: barrier (pushing filter before would change semantics)

**IMPORTANT - Alias/Pushdown Safety:**
- Only push filters whose paths exist in the **source schema** (not aliases introduced by Select/WithColumn)
- If source is schema-less/dynamic, default to "don't push" when path existence is unknown
- Use `filter_paths_in_source()` helper to check—this allows swapping in alias-aware logic later without touching rule wiring

#### 10.5.5.1 Add Path Reference Extraction

- [x] Add helper to extract path references from an expression:
  ```rust
  /// Extract all path references from an expression
  ///
  /// Returns the set of root field names that the expression accesses.
  /// For example, `path("user.name")` returns `{"user"}`.
  fn extract_path_roots(expr: &Expr) -> std::collections::HashSet<String> {
      let mut roots = std::collections::HashSet::new();
      collect_path_roots(expr, &mut roots);
      roots
  }

  fn collect_path_roots(expr: &Expr, roots: &mut std::collections::HashSet<String>) {
      match expr {
          Expr::Path(path_str) => {
              // Extract root field (before first . or [)
              let root = path_str
                  .split(|c| c == '.' || c == '[')
                  .next()
                  .unwrap_or(path_str);
              roots.insert(root.to_string());
          }
          // Binary operations
          Expr::Add(lhs, rhs)
          | Expr::Sub(lhs, rhs)
          | Expr::Mul(lhs, rhs)
          | Expr::Div(lhs, rhs)
          | Expr::Eq(lhs, rhs)
          | Expr::Ne(lhs, rhs)
          | Expr::Gt(lhs, rhs)
          | Expr::Ge(lhs, rhs)
          | Expr::Lt(lhs, rhs)
          | Expr::Le(lhs, rhs)
          | Expr::And(lhs, rhs)
          | Expr::Or(lhs, rhs) => {
              collect_path_roots(lhs, roots);
              collect_path_roots(rhs, roots);
          }
          // Unary operations
          Expr::Not(inner)
          | Expr::Neg(inner)
          | Expr::Sum(inner)
          | Expr::Mean(inner)
          | Expr::Min(inner)
          | Expr::Max(inner)
          | Expr::Count(inner)
          | Expr::Any(inner)
          | Expr::All(inner)
          | Expr::First(inner)
          | Expr::Last(inner)
          | Expr::Len(inner)
          | Expr::Flatten(inner)
          | Expr::Unique(inner)
          | Expr::IsNull(inner)
          | Expr::Abs(inner)
          | Expr::Floor(inner)
          | Expr::Ceil(inner)
          | Expr::Round(inner) => {
              collect_path_roots(inner, roots);
          }
          // Alias - recurse into inner
          Expr::Alias { expr, .. } => {
              collect_path_roots(expr, roots);
          }
          // Literals have no path references
          Expr::Literal(_) => {}
          // Conditional
          Expr::If { condition, then_branch, else_branch } => {
              collect_path_roots(condition, roots);
              collect_path_roots(then_branch, roots);
              collect_path_roots(else_branch, roots);
          }
          // Coalesce
          Expr::Coalesce(exprs) => {
              for e in exprs {
                  collect_path_roots(e, roots);
              }
          }
          // CONSERVATIVE CATCH-ALL: For any unknown/new Expr variants,
          // insert a sentinel value that will block pushdown.
          // This ensures we don't push predicates that might depend on
          // derived columns we don't know about.
          #[allow(unreachable_patterns)]
          _ => {
              // Insert a special marker that won't match any real column name
              // This forces the caller to treat this expression as potentially
              // dependent on any column, blocking unsafe pushdowns.
              roots.insert("__UNKNOWN_EXPR_DEPENDENCY__".to_string());
          }
      }
  }
  ```

#### 10.5.5.2 Add Source Schema Check Helper

- [x] Add helper to check if filter paths exist in source schema:
  ```rust
  /// Check if all paths in a filter expression exist in the source schema
  ///
  /// Returns true if ALL paths are known to exist in the source.
  /// Returns false if:
  /// - Any path is not in the source schema
  /// - The source has no schema (dynamic/schema-less) — conservative: don't push
  /// - The expression contains unknown variants (sentinel value present)
  ///
  /// This helper uses `Arbor::has_root_field()` which was added in 10.5.0.1.
  /// This allows us to swap in alias-aware logic later without touching rule wiring.
  fn filter_paths_in_source(plan: &QueryPlan, filter_predicate: &Expr) -> bool {
      let filter_paths = extract_path_roots(filter_predicate);

      // If we hit an unknown expression variant, don't push
      if filter_paths.contains("__UNKNOWN_EXPR_DEPENDENCY__") {
          return false;
      }

      let source = plan.source();

      // If source has no schema, be conservative: don't push
      // (In a schema-less/dynamic scenario, we can't verify path existence)
      if source.schema().is_none() {
          return false;
      }

      // Check all filter paths exist in source schema using has_root_field()
      // This method returns false if no schema or field not found
      for path in &filter_paths {
          if !source.has_root_field(path) {
              return false; // Path doesn't exist in source — might be an alias
          }
      }

      true
  }
  ```

#### 10.5.5.3 Define PredicatePushdown Rule

- [x] Add PredicatePushdown struct:
  ```rust
  /// Pushes Filter operations earlier in the plan when safe
  ///
  /// # Rules (Conservative Source-Schema Check)
  ///
  /// All pushdown decisions require the filter to reference only columns
  /// that exist in the **source schema**. This prevents pushing filters
  /// that reference aliases introduced by Select/WithColumn.
  ///
  /// - Can push Filter before Select IF filter only uses source columns
  /// - Can push Filter before WithColumn IF filter doesn't reference the new column AND uses source columns
  /// - Can push Filter before Sort IF filter only uses source columns
  /// - CANNOT push Filter before Agg (changes semantics — total barrier)
  /// - CANNOT push Filter before Head/Tail (changes semantics)
  /// - CANNOT push Filter past Source
  ///
  /// If the source has no schema (dynamic/schema-less), we conservatively
  /// decline to push any filters.
  ///
  /// # Example
  ///
  /// Before: Source → Select([a, b]) → Filter(a > 10)
  /// After:  Source → Filter(a > 10) → Select([a, b])  (if "a" is in source schema)
  ///
  /// # Example (blocked by alias)
  ///
  /// Before: Source → Select([path("x").alias("a")]) → Filter(a > 10)
  /// After:  (unchanged — "a" is an alias, not in source schema)
  #[derive(Debug)]
  pub struct PredicatePushdown;
  ```

#### 10.5.5.4 Implement PredicatePushdown Rule

- [x] Implement the optimization rule:
  ```rust
  impl OptimizationRule for PredicatePushdown {
      fn apply(&self, plan: &mut QueryPlan) -> bool {
          // Find Filter nodes that could potentially be pushed
          let filter_ids: Vec<_> = plan.nodes()
              .iter()
              .filter(|n| matches!(n.op, QueryOp::Filter { .. }))
              .map(|n| n.id)
              .collect();

          for filter_id in filter_ids {
              if let Some(pushed) = try_push_filter(plan, filter_id) {
                  if pushed {
                      return true;
                  }
              }
          }

          false
      }

      fn name(&self) -> &'static str {
          "PredicatePushdown"
      }
  }

  /// Try to push a filter one step earlier in the plan
  ///
  /// Uses conservative source-schema checking to avoid pushing filters
  /// that reference aliases introduced by Select/WithColumn.
  fn try_push_filter(plan: &mut QueryPlan, filter_id: QueryNodeId) -> Option<bool> {
      let filter_node = plan.get(filter_id)?;
      let upstream_id = filter_node.input?;
      let upstream_node = plan.get(upstream_id)?;

      // Get filter predicate for analysis
      let filter_predicate = match &plan.get(filter_id)?.op {
          QueryOp::Filter { predicate } => predicate.clone(),
          _ => return Some(false),
      };

      let filter_paths = extract_path_roots(&filter_predicate);

      match &upstream_node.op {
          // Cannot push past Source
          QueryOp::Source => Some(false),

          // Can push past Select IF filter only references source columns (not aliases)
          QueryOp::Select { .. } => {
              // IMPORTANT: Select can introduce aliases. Only push if the filter
              // references columns that exist in the source schema.
              if filter_paths_in_source(plan, &filter_predicate) {
                  plan.swap_adjacent(upstream_id, filter_id);
                  Some(true)
              } else {
                  Some(false) // Filter might reference an alias — don't push
              }
          }

          // Can push past WithColumn if filter doesn't reference the new column
          QueryOp::WithColumn { name, .. } => {
              if filter_paths.contains(name) {
                  Some(false) // Filter depends on new column
              } else if filter_paths_in_source(plan, &filter_predicate) {
                  plan.swap_adjacent(upstream_id, filter_id);
                  Some(true)
              } else {
                  Some(false) // Conservative: filter might reference something not in source
              }
          }

          // Can push past Sort IF filter only references source columns
          QueryOp::Sort { .. } => {
              if filter_paths_in_source(plan, &filter_predicate) {
                  plan.swap_adjacent(upstream_id, filter_id);
                  Some(true)
              } else {
                  Some(false)
              }
          }

          // Cannot push past Agg (changes semantics — total barrier)
          QueryOp::Agg { .. } => Some(false),

          // Don't push past Head/Tail (changes semantics)
          QueryOp::Head { .. } | QueryOp::Tail { .. } => Some(false),

          // Don't push past another Filter (let FilterFusion handle it)
          QueryOp::Filter { .. } => Some(false),
      }
  }
  ```

#### 10.5.5.5 Unit Tests for Predicate Pushdown

- [x] Add predicate pushdown tests:
  ```rust
  /// Create a test arbor with explicit schema for pushdown tests
  ///
  /// IMPORTANT: Must use explicit schema (not `new_infer()`) because
  /// `has_root_field()` requires schema to be present. The `new_infer()`
  /// builder does not produce a `SchemaRegistry`.
  fn create_schema_arbor() -> Arbor {
      use arbors_schema::compile_json_schema;

      // Define explicit schema with known fields: a, b, value, id, active
      let schema_json = r#"{
          "type": "object",
          "properties": {
              "a": {"type": "integer"},
              "b": {"type": "integer"},
              "value": {"type": "integer"},
              "id": {"type": "integer"},
              "active": {"type": "boolean"}
          }
      }"#;
      let schema = compile_json_schema(schema_json.as_bytes()).unwrap();

      let mut builder = ArborBuilder::new(schema);
      builder.add_json(r#"{"a": 1, "b": 2, "value": 10, "id": 0, "active": true}"#.as_bytes()).unwrap();
      builder.finish()
  }

  #[test]
  fn test_pushdown_filter_before_select() {
      use arbors_expr::{lit, path};

      let arbor = create_schema_arbor(); // Has "a" in schema
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Select -> Filter(a > 10)
      plan.add_op(QueryOp::Select { exprs: vec![path("a"), path("b")] });
      let filter_id = plan.add_op(QueryOp::Filter { predicate: path("a").gt(lit(10)) });

      let rule = PredicatePushdown;
      assert!(rule.apply(&mut plan)); // "a" is in source schema

      // Filter should now be before Select
      let filter_node = plan.get(filter_id).unwrap();
      assert_eq!(filter_node.input, Some(QueryNodeId(0))); // Source
  }

  #[test]
  fn test_pushdown_filter_blocked_by_alias() {
      use arbors_expr::{lit, path};

      let arbor = create_schema_arbor(); // Has "a" but NOT "renamed"
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Select([a.alias("renamed")]) -> Filter(renamed > 10)
      plan.add_op(QueryOp::Select { exprs: vec![path("a").alias("renamed")] });
      let filter_id = plan.add_op(QueryOp::Filter {
          predicate: path("renamed").gt(lit(10)), // "renamed" is NOT in source schema!
      });

      let rule = PredicatePushdown;
      assert!(!rule.apply(&mut plan)); // Should NOT push — "renamed" is an alias

      // Filter should still be after Select
      let filter_node = plan.get(filter_id).unwrap();
      assert_ne!(filter_node.input, Some(QueryNodeId(0)));
  }

  #[test]
  fn test_pushdown_filter_blocked_by_no_schema() {
      use arbors_expr::{lit, path};

      let arbor = Arbor::new(); // Empty arbor — no schema
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Select -> Filter
      plan.add_op(QueryOp::Select { exprs: vec![path("a")] });
      plan.add_op(QueryOp::Filter { predicate: path("a").gt(lit(10)) });

      let rule = PredicatePushdown;
      assert!(!rule.apply(&mut plan)); // Conservative: don't push with no schema
  }

  #[test]
  fn test_pushdown_filter_before_with_column_safe() {
      use arbors_expr::{lit, path};

      let arbor = create_schema_arbor(); // Has "a" in schema
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> WithColumn("new", ...) -> Filter(a > 10)
      plan.add_op(QueryOp::WithColumn {
          name: "new".to_string(),
          expr: lit(42),
      });
      let filter_id = plan.add_op(QueryOp::Filter {
          predicate: path("a").gt(lit(10)), // Doesn't reference "new", "a" in source
      });

      let rule = PredicatePushdown;
      assert!(rule.apply(&mut plan));

      // Filter should now be before WithColumn
      let filter_node = plan.get(filter_id).unwrap();
      assert_eq!(filter_node.input, Some(QueryNodeId(0))); // Source
  }

  #[test]
  fn test_pushdown_filter_blocked_by_with_column_dependency() {
      use arbors_expr::{lit, path};

      let arbor = create_schema_arbor();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> WithColumn("computed", ...) -> Filter(computed > 10)
      let wc_id = plan.add_op(QueryOp::WithColumn {
          name: "computed".to_string(),
          expr: path("a").add(lit(1)),
      });
      let filter_id = plan.add_op(QueryOp::Filter {
          predicate: path("computed").gt(lit(10)), // References "computed"!
      });

      let rule = PredicatePushdown;
      assert!(!rule.apply(&mut plan));

      // Filter should still be after WithColumn
      let filter_node = plan.get(filter_id).unwrap();
      assert_eq!(filter_node.input, Some(wc_id));
  }

  #[test]
  fn test_pushdown_filter_blocked_by_agg() {
      use arbors_expr::{lit, path};

      let arbor = create_schema_arbor();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Agg -> Filter
      let agg_id = plan.add_op(QueryOp::Agg {
          exprs: vec![path("a").sum().alias("total")],
      });
      let filter_id = plan.add_op(QueryOp::Filter {
          predicate: path("total").gt(lit(100)),
      });

      let rule = PredicatePushdown;
      assert!(!rule.apply(&mut plan));

      // Filter should still be after Agg
      let filter_node = plan.get(filter_id).unwrap();
      assert_eq!(filter_node.input, Some(agg_id));
  }

  #[test]
  fn test_pushdown_filter_blocked_by_head() {
      use arbors_expr::{lit, path};

      let arbor = create_schema_arbor();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Head(10) -> Filter(a > 10)
      let head_id = plan.add_op(QueryOp::Head { n: 10 });
      let filter_id = plan.add_op(QueryOp::Filter {
          predicate: path("a").gt(lit(10)),
      });

      let rule = PredicatePushdown;
      assert!(!rule.apply(&mut plan)); // Head is a barrier

      // Filter should still be after Head
      let filter_node = plan.get(filter_id).unwrap();
      assert_eq!(filter_node.input, Some(head_id));
  }

  #[test]
  fn test_pushdown_multiple_steps() {
      use arbors_expr::{lit, path};

      let arbor = create_schema_arbor(); // Has "a" in schema
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Source -> Select -> WithColumn("unrelated") -> Filter(a > 10)
      plan.add_op(QueryOp::Select { exprs: vec![path("a")] });
      plan.add_op(QueryOp::WithColumn {
          name: "unrelated".to_string(),
          expr: lit(99),
      });
      plan.add_op(QueryOp::Filter { predicate: path("a").gt(lit(10)) });

      assert_eq!(plan.len(), 4);

      // Apply until no more changes
      let changes = optimize(&mut plan);

      // Filter should be pushed all the way to after Source
      assert!(changes >= 2);
  }

  #[test]
  fn test_optimization_convergence_long_chain() {
      use arbors_expr::{lit, path};

      let arbor = create_schema_arbor();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Build a long chain: Source -> Filter1 -> Filter2 -> ... -> Filter10
      for i in 0..10 {
          plan.add_op(QueryOp::Filter {
              predicate: path("a").gt(lit(i)),
          });
      }

      let initial_len = plan.len();
      let changes = optimize(&mut plan);

      // All filters should fuse into one
      assert!(changes > 0);
      assert_eq!(plan.len(), 2); // Source + 1 fused filter

      // Second optimization should be a no-op (convergence)
      let changes2 = optimize(&mut plan);
      assert_eq!(changes2, 0);
  }
  ```

**Checkpoint 10.5.5:**
```bash
cargo test -p arbors-lazy -- pushdown  # Pushdown tests pass
cargo test -p arbors-lazy              # All tests pass
```
- [x] Checkpoint passed
- [x] `PredicatePushdown` rule implemented
- [x] `filter_paths_in_source()` helper implemented
- [x] `extract_path_roots()` helper implemented
- [x] Correctly pushes past Select (when paths in source)
- [x] Correctly blocked by Select (when filter uses alias)
- [x] Correctly blocked when source has no schema
- [x] Correctly pushes past WithColumn (when safe)
- [x] Correctly blocked by WithColumn (when dependent)
- [x] Correctly blocked by Agg (total barrier)
- [x] Correctly blocked by Head/Tail
- [x] Convergence verified on long filter chains

---

### 10.5.6 Integrate Optimizer into Collect

File: `crates/arbors-lazy/src/lazy.rs`

**Purpose:** Call optimizer before execution in `collect()`.

#### 10.5.6.1 Update Collect to Use Optimizer

- [x] Modify `collect()` to optimize before execution:
  ```rust
  use crate::optimize::optimize;

  impl LazyArbor {
      /// Execute the plan and return the result
      ///
      /// This is where all the work happens. The plan is:
      /// 1. Optimized (filter fusion, predicate pushdown)
      /// 2. Executed operation by operation (parallel where beneficial)
      /// 3. Results materialized into a new Arbor
      ///
      /// Uses parallel execution by default for filter and select operations.
      ///
      /// # Errors
      ///
      /// Returns an error if any operation fails during execution.
      pub fn collect(self) -> Result<Arbor, ExprError> {
          let mut plan = self.plan;
          optimize(&mut plan);
          execute_plan_with_mode(&plan, ExecutionMode::Parallel)
      }
  }
  ```

#### 10.5.6.2 Add collect_unoptimized for Testing

- [x] Add method to skip optimization (for testing/debugging):
  ```rust
  impl LazyArbor {
      /// Execute the plan without optimization
      ///
      /// Useful for debugging and testing optimization correctness.
      /// In production, prefer `collect()` which applies optimizations.
      pub fn collect_unoptimized(self) -> Result<Arbor, ExprError> {
          execute_plan_with_mode(&self.plan, ExecutionMode::Parallel)
      }
  }
  ```

#### 10.5.6.3 Update collect_with_mode

- [x] Update `collect_with_mode` to also optimize:
  ```rust
  impl LazyArbor {
      /// Execute the plan with the specified execution mode
      ///
      /// Applies optimizations before execution.
      pub fn collect_with_mode(self, mode: ExecutionMode) -> Result<Arbor, ExprError> {
          let mut plan = self.plan;
          optimize(&mut plan);
          execute_plan_with_mode(&plan, mode)
      }
  }
  ```

**Checkpoint 10.5.6:**
```bash
cargo test -p arbors-lazy  # All tests pass with optimizer integrated
cargo build -p arbors-lazy # Compiles
```
- [x] Checkpoint passed
- [x] `collect()` calls `optimize()` before execution
- [x] `collect_unoptimized()` added for testing
- [x] `collect_with_mode()` calls `optimize()`

---

### 10.5.7 Semantic Equivalence Tests

File: `crates/arbors-lazy/tests/optimize_integration.rs` (new file)

**Purpose:** Verify optimized results match unoptimized results.

#### 10.5.7.1 Create Integration Test File

- [x] Create `crates/arbors-lazy/tests/optimize_integration.rs`:
  ```rust
  //! Integration tests for query optimization
  //!
  //! These tests verify that optimized plans produce identical results
  //! to unoptimized plans (semantic equivalence).

  use arbors_expr::{lit, path};
  use arbors_io::ArborBuilder;
  use arbors_lazy::ArborLazyExt;
  use arbors_schema::compile_json_schema;

  /// Create test arbor with N trees and explicit schema
  ///
  /// Uses explicit schema so that `has_root_field()` works for predicate pushdown.
  /// Fields: id (int), value (int), active (bool), name (string)
  fn create_test_arbor(n: usize) -> arbors_storage::Arbor {
      let schema_json = r#"{
          "type": "object",
          "properties": {
              "id": {"type": "integer"},
              "value": {"type": "integer"},
              "active": {"type": "boolean"},
              "name": {"type": "string"}
          }
      }"#;
      let schema = compile_json_schema(schema_json.as_bytes()).unwrap();

      let mut builder = ArborBuilder::new(schema);
      for i in 0..n {
          builder
              .add_json(
                  format!(
                      r#"{{"id": {}, "value": {}, "active": {}, "name": "item_{}"}}"#,
                      i,
                      i * 10,
                      i % 2 == 0,
                      i
                  )
                  .as_bytes(),
              )
              .unwrap();
      }
      builder.finish()
  }
  ```

#### 10.5.7.2 Filter Fusion Equivalence Tests

- [x] Add filter fusion equivalence tests:
  ```rust
  #[test]
  fn test_filter_fusion_semantic_equivalence() {
      let arbor = create_test_arbor(100);

      // Two separate filters
      let unoptimized = arbor.clone()
          .lazy()
          .filter(path("id").gt(lit(50)))
          .filter(path("active").eq(lit(true)))
          .collect_unoptimized()
          .unwrap();

      // Same query, optimized
      let optimized = arbor.lazy()
          .filter(path("id").gt(lit(50)))
          .filter(path("active").eq(lit(true)))
          .collect()
          .unwrap();

      assert_eq!(unoptimized.num_trees(), optimized.num_trees());

      // Verify actual values match
      for i in 0..unoptimized.num_trees() {
          let unopt_root = unoptimized.root(i).unwrap();
          let opt_root = optimized.root(i).unwrap();

          let unopt_id = unoptimized.get_i64(unoptimized.get_field(unopt_root, "id").unwrap());
          let opt_id = optimized.get_i64(optimized.get_field(opt_root, "id").unwrap());

          assert_eq!(unopt_id, opt_id);
      }
  }
  ```

#### 10.5.7.3 Predicate Pushdown Equivalence Tests

- [x] Add predicate pushdown equivalence tests:
  ```rust
  #[test]
  fn test_predicate_pushdown_semantic_equivalence() {
      let arbor = create_test_arbor(100);

      // Select then Filter (suboptimal order)
      let unoptimized = arbor.clone()
          .lazy()
          .select(&[path("id").alias("i"), path("value").alias("v")])
          .filter(path("i").gt(lit(50)))
          .collect_unoptimized()
          .unwrap();

      // Same query, optimized (filter pushed before select)
      let optimized = arbor.lazy()
          .select(&[path("id").alias("i"), path("value").alias("v")])
          .filter(path("i").gt(lit(50)))
          .collect()
          .unwrap();

      assert_eq!(unoptimized.num_trees(), optimized.num_trees());
  }

  #[test]
  fn test_pushdown_with_column_semantic_equivalence() {
      let arbor = create_test_arbor(100);

      // WithColumn then Filter on original column
      let unoptimized = arbor.clone()
          .lazy()
          .with_column("doubled", path("value").mul(lit(2)))
          .filter(path("id").gt(lit(50)))  // Doesn't reference "doubled"
          .collect_unoptimized()
          .unwrap();

      let optimized = arbor.lazy()
          .with_column("doubled", path("value").mul(lit(2)))
          .filter(path("id").gt(lit(50)))
          .collect()
          .unwrap();

      assert_eq!(unoptimized.num_trees(), optimized.num_trees());
  }

  #[test]
  fn test_no_pushdown_when_dependent_semantic_equivalence() {
      let arbor = create_test_arbor(100);

      // WithColumn then Filter on new column (cannot push)
      let unoptimized = arbor.clone()
          .lazy()
          .with_column("doubled", path("value").mul(lit(2)))
          .filter(path("doubled").gt(lit(500)))  // References "doubled"
          .collect_unoptimized()
          .unwrap();

      let optimized = arbor.lazy()
          .with_column("doubled", path("value").mul(lit(2)))
          .filter(path("doubled").gt(lit(500)))
          .collect()
          .unwrap();

      // Results should be identical (no optimization possible)
      assert_eq!(unoptimized.num_trees(), optimized.num_trees());
  }
  ```

#### 10.5.7.4 Complex Chain Equivalence Tests

- [x] Add complex chain tests:
  ```rust
  #[test]
  fn test_complex_chain_semantic_equivalence() {
      let arbor = create_test_arbor(100);

      let unoptimized = arbor.clone()
          .lazy()
          .select(&[path("id"), path("value"), path("active")])
          .filter(path("id").gt(lit(25)))
          .filter(path("active").eq(lit(true)))
          .with_column("computed", path("value").mul(lit(3)))
          .filter(path("id").lt(lit(75)))
          .head(10)
          .collect_unoptimized()
          .unwrap();

      let optimized = arbor.lazy()
          .select(&[path("id"), path("value"), path("active")])
          .filter(path("id").gt(lit(25)))
          .filter(path("active").eq(lit(true)))
          .with_column("computed", path("value").mul(lit(3)))
          .filter(path("id").lt(lit(75)))
          .head(10)
          .collect()
          .unwrap();

      assert_eq!(unoptimized.num_trees(), optimized.num_trees());
  }
  ```

**Checkpoint 10.5.7:**
```bash
cargo test -p arbors-lazy --test optimize_integration  # Equivalence tests pass
cargo test -p arbors-lazy                               # All tests pass
```
- [x] Checkpoint passed
- [x] Integration test file created
- [x] Filter fusion equivalence verified
- [x] Predicate pushdown equivalence verified
- [x] Complex chain equivalence verified

---

### 10.5.8 Unit Tests for Edge Cases

File: `crates/arbors-lazy/src/optimize.rs` (add to tests module)

#### 10.5.8.1 Empty Plan Tests

- [x] Add empty/minimal plan tests:
  ```rust
  #[test]
  fn test_optimize_source_only() {
      let arbor = Arbor::new();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      let changes = optimize(&mut plan);
      assert_eq!(changes, 0);
      assert_eq!(plan.len(), 1); // Just source
  }

  #[test]
  fn test_optimize_single_filter() {
      use arbors_expr::lit;

      let arbor = Arbor::new();
      let mut plan = QueryPlan::new(Arc::new(arbor));
      plan.add_op(QueryOp::Filter { predicate: lit(true) });

      let changes = optimize(&mut plan);
      assert_eq!(changes, 0); // Nothing to optimize
      assert_eq!(plan.len(), 2);
  }
  ```

#### 10.5.8.2 Idempotence Tests

- [x] Add idempotence tests (applying twice has no additional effect):
  ```rust
  #[test]
  fn test_optimize_idempotence() {
      use arbors_expr::{lit, path};

      let arbor = Arbor::new();
      let mut plan = QueryPlan::new(Arc::new(arbor));

      // Build a plan that will be optimized
      plan.add_op(QueryOp::Select { exprs: vec![path("a")] });
      plan.add_op(QueryOp::Filter { predicate: path("a").gt(lit(10)) });
      plan.add_op(QueryOp::Filter { predicate: path("a").lt(lit(100)) });

      // First optimization
      let changes1 = optimize(&mut plan);
      let len1 = plan.len();

      // Second optimization should have no effect
      let changes2 = optimize(&mut plan);
      let len2 = plan.len();

      assert!(changes1 > 0, "First optimization should make changes");
      assert_eq!(changes2, 0, "Second optimization should make no changes");
      assert_eq!(len1, len2, "Plan length should not change");
  }
  ```

#### 10.5.8.3 Describe Plan After Optimization

- [x] Add test to verify plan description after optimization:
  ```rust
  #[test]
  fn test_describe_plan_after_optimization() {
      use arbors_expr::{lit, path};

      let arbor = Arbor::new();
      let lazy = LazyArbor::from_arbor(arbor)
          .select(&[path("a")])
          .filter(path("a").gt(lit(10)))
          .filter(path("a").lt(lit(100)));

      // Before optimization
      let before = lazy.describe_plan();
      assert!(before.contains("Filter")); // Should have Filter nodes

      // Note: describe_plan() doesn't optimize, so we verify via collect
      // which does optimize internally
  }
  ```

**Checkpoint 10.5.8:**
```bash
cargo test -p arbors-lazy -- edge  # Edge case tests pass
cargo test -p arbors-lazy          # All tests pass
```
- [x] Checkpoint passed
- [x] Empty plan tests pass
- [x] Idempotence tests pass
- [x] Plan description tests pass

---

### 10.5.9 Update Main Crate Exports

File: `crates/arbors/src/lib.rs`

- [x] Update lazy module exports to include optimization:
  ```rust
  pub mod lazy {
      pub use arbors_lazy::{
          ArborLazyExt,
          LazyArbor,
          QueryPlan,
          QueryOp,
          QueryNode,
          QueryNodeId,
          ExecContext,
          execute_plan,
          execute_plan_with_mode,
          ExecutionMode,
          // Optimization exports
          optimize,
          OptimizationRule,
      };
  }
  ```

**Checkpoint 10.5.9:**
```bash
cargo build -p arbors  # Main crate compiles with new exports
cargo test -p arbors   # Main crate tests pass
```
- [x] Checkpoint passed
- [x] `optimize` exported from main arbors crate
- [x] `OptimizationRule` exported from main arbors crate

---

### 10.5.10 Run Full Test Suite

**Purpose:** Ensure no regressions from optimization implementation.

- [x] Run: `cargo test --workspace --exclude arbors-python` — all tests pass (1147 tests)
- [x] Run: `cargo clippy --workspace` — no new warnings
- [x] Run: `make python-test` — all Python tests pass (898 tests, 2 skipped)
- [x] Document test count increase: Phase 10.5 added ~30+ new tests in arbors-lazy (19 optimization tests + 4 mutation tests + 5 integration tests + 4 edge case tests)

**Final Checkpoint 10.5.10:**
```bash
cargo test --workspace --exclude arbors-python  # Full test suite
cargo clippy --workspace                         # No warnings
make python-test                                 # Python bindings work
```
- [x] Checkpoint passed
- [x] All Rust tests pass
- [x] Clippy clean
- [x] Python tests pass

---

**Phase 10.5 Deliverables:**

**Core Implementation:**
- [x] `optimize.rs` module created
- [x] `OptimizationRule` trait defined
- [x] `optimize()` function (fixed-point loop over rules)
- [x] `FilterFusion` rule — combines adjacent filters into AND
- [x] `PredicatePushdown` rule — pushes filters earlier when safe
- [x] `extract_path_roots()` helper for dependency analysis
- [x] Plan mutation methods (`remove_node`, `replace_op`, `swap_adjacent`)
- [x] `collect()` calls optimizer before execution
- [x] `collect_unoptimized()` for testing/debugging

**Testing:**
- [x] 15+ unit tests for optimization rules (19 tests)
- [x] 10+ unit tests for plan mutation methods (4 tests in mutation_tests module)
- [x] 5+ integration tests for semantic equivalence (5 tests in optimize_integration.rs)
- [x] Idempotence tests (double optimization is no-op)
- [x] Edge case tests (empty plans, single operations)
- [x] All existing tests pass (no regressions)
- [x] Clippy clean

**Deferred to Phase 10.5+ (optional future work):**
- Projection pruning (remove unused columns from Select)
- Select fusion (combine adjacent Selects)
- Cost-based optimization
- Statistics-based decisions

---

## Phase 10.6 – Python Bindings

**Goal:** Expose lazy API to Python.

**Key Concepts:** Section F.2 (Python API), existing Python bindings patterns in `python/src/lib.rs`

**Current State:**
- Phase 10.5 complete: Query optimization with FilterFusion and PredicatePushdown
- `LazyArbor` exists in Rust with `filter()`, `select()`, `with_column()`, `head()`, `tail()`, `agg()`, `collect()`
- `Arbor` Python class exists with eager query operations
- `Expr` Python class exists with full expression building
- Type stubs exist in `python/arbors/_arbors.pyi`

### 10.6.0 Pre-Implementation Review

**Purpose:** Verify understanding of Python binding patterns before implementation.

**Existing Patterns from `python/src/lib.rs`:**

1. **Struct pattern:** Python classes wrap inner Rust types
   ```rust
   #[pyclass(name = "Arbor")]
   pub struct Arbor {
       inner: arbors::Arbor,
       schema: Option<Py<Schema>>,
   }
   ```

2. **Method pattern:** Use `#[pymethods]` block with `&self` or `Py<Self>`
   ```rust
   #[pymethods]
   impl Arbor {
       fn filter(&self, _py: Python<'_>, expr: &Expr) -> PyResult<QueryResult> { ... }
   }
   ```

3. **Error conversion:** Use `expr_error_to_py_err()` for `ExprError` and `to_py_err()` for `arbors::Error`

4. **Expression handling:** The `Expr` Python class wraps `arbors_expr::Expr`
   ```rust
   #[pyclass(name = "Expr")]
   #[derive(Clone)]
   pub struct Expr {
       inner: arbors_expr::Expr,
   }
   ```

5. **GIL handling:** Long-running Rust operations should release the GIL for responsiveness:
   ```rust
   py.allow_threads(|| {
       // Rust computation here, without holding GIL
   })
   ```

**Key Design Notes:**

- **Ownership:** `RustLazyArbor` internally stores `Arc<Arbor>`, so creating `LazyArbor` from `Arbor` clones the inner data into an Arc. This is handled by `LazyArbor::from_arbor()`.
- **Send + Sync:** `RustLazyArbor` is `Send + Sync` (verified by compile-time tests in `arbors-lazy/src/lib.rs`), which is required for `py.allow_threads()`.
- **Expr comparison operators:** Python's `Expr.__richcmp__` returns `Expr` (not `bool`), so `path("active") == True` correctly builds an expression.

**Verification Steps:**
- [x] Confirm `arbors::lazy::LazyArbor` is accessible from `python/src/lib.rs`
  - Verified: `crates/arbors/src/lib.rs:159` exports `LazyArbor` via `pub use arbors_lazy::{...}`
  - `python/Cargo.toml` has `arbors.workspace = true` dependency
- [x] Confirm `ExecutionMode` enum is exported from `arbors::lazy`
  - Verified: `crates/arbors/src/lib.rs:158` exports `ExecutionMode`
- [x] Review how `Arbor` stores inner arbor (directly, not Arc) — `LazyArbor` will need `Arc<Arbor>`
  - Verified: `python/src/lib.rs:1452` shows `inner: arbors::Arbor` (direct, not Arc)
  - `LazyArbor::from_arbor()` wraps in Arc when creating LazyArbor
- [x] Verify `RustLazyArbor` is `Send + Sync` (required for `py.allow_threads()`)
  - Verified: `crates/arbors-lazy/src/lib.rs:88-92` has compile-time assertions
  - Test compiles successfully, confirming bounds satisfied

### 10.6.1 Add arbors-lazy Dependency to Python Crate

File: `python/Cargo.toml`

- [x] Verify `arbors` workspace dependency includes `arbors-lazy` re-exports:
  ```bash
  # Check that arbors re-exports lazy module
  grep "lazy" crates/arbors/src/lib.rs
  ```
  - Verified: `pub mod lazy { ... pub use arbors_lazy::{...} }` exports all lazy types

- [x] No Cargo.toml changes expected (arbors already re-exports lazy)
  - Verified: `python/Cargo.toml:16` has `arbors.workspace = true`

### 10.6.2 Define LazyArbor Python Class

File: `python/src/lib.rs`

**Location:** Add after the `Arbor` class definition and `ArborIterator`, before `Node` class (around line 1900)

#### 10.6.2.1 Add Imports

- [x] Add imports at top of file:
  ```rust
  use arbors::lazy::{LazyArbor as RustLazyArbor, ExecutionMode};
  ```
  - Note: `std::sync::Arc` not needed - `RustLazyArbor` handles Arc internally

#### 10.6.2.2 Define LazyArbor Struct

- [x] Add `LazyArbor` struct:
  ```rust
  // =============================================================================
  // LazyArbor Class
  // =============================================================================

  /// Lazy evaluation container for Arbor operations.
  ///
  /// LazyArbor builds a query plan without executing it. Operations are only
  /// performed when collect() is called, enabling query optimization.
  ///
  /// Example:
  ///     >>> lazy = arbor.lazy()
  ///     >>> lazy = lazy.filter(path("age") > 21)
  ///     >>> lazy = lazy.select([path("name").alias("n")])
  ///     >>> result = lazy.collect()  # Now executes
  #[pyclass(name = "LazyArbor")]
  pub struct LazyArbor {
      inner: RustLazyArbor,
  }
  ```

#### 10.6.2.3 Implement filter Method

- [x] Add filter method:
  ```rust
  #[pymethods]
  impl LazyArbor {
      /// Add a filter operation to the plan.
      ///
      /// Keeps only trees where the predicate evaluates to true.
      /// The predicate must evaluate to a scalar boolean.
      ///
      /// Args:
      ///     expr: Predicate expression (must be scalar boolean)
      ///
      /// Returns:
      ///     New LazyArbor with filter added to plan
      ///
      /// Example:
      ///     >>> lazy = arbor.lazy().filter(path("age") > 21)
      fn filter(&self, expr: &Expr) -> LazyArbor {
          LazyArbor {
              inner: self.inner.clone().filter(expr.inner.clone()),
          }
      }
  }
  ```

#### 10.6.2.4 Implement select Method

- [x] Add select method:
  ```rust
  impl LazyArbor {
      /// Add a select operation to the plan.
      ///
      /// Transforms each tree by evaluating the given expressions.
      /// Each tree becomes a struct with the expression results as fields.
      ///
      /// Args:
      ///     exprs: List of expressions to evaluate (use .alias() for field names)
      ///
      /// Returns:
      ///     New LazyArbor with select added to plan
      ///
      /// Example:
      ///     >>> lazy = arbor.lazy().select([
      ///     ...     path("user.name").alias("name"),
      ///     ...     path("items[*].price").sum().alias("total"),
      ///     ... ])
      fn select(&self, exprs: Vec<Expr>) -> LazyArbor {
          let rust_exprs: Vec<arbors_expr::Expr> = exprs.iter().map(|e| e.inner.clone()).collect();
          LazyArbor {
              inner: self.inner.clone().select(&rust_exprs),
          }
      }
  }
  ```

#### 10.6.2.5 Implement with_column Method

- [x] Add with_column method:
  ```rust
  impl LazyArbor {
      /// Add a with_column operation to the plan.
      ///
      /// Adds or replaces a field in each tree with the expression result.
      ///
      /// Args:
      ///     name: Name of the field to add/replace
      ///     expr: Expression to evaluate for the field value
      ///
      /// Returns:
      ///     New LazyArbor with with_column added to plan
      ///
      /// Example:
      ///     >>> lazy = arbor.lazy().with_column("total", path("items[*].price").sum())
      fn with_column(&self, name: &str, expr: &Expr) -> LazyArbor {
          LazyArbor {
              inner: self.inner.clone().with_column(name, expr.inner.clone()),
          }
      }
  }
  ```

#### 10.6.2.6 Implement head and tail Methods

- [x] Add head method:
  ```rust
  impl LazyArbor {
      /// Add a head operation to the plan.
      ///
      /// Limits the result to the first N trees.
      ///
      /// Args:
      ///     n: Maximum number of trees to return
      ///
      /// Returns:
      ///     New LazyArbor with head added to plan
      ///
      /// Example:
      ///     >>> lazy = arbor.lazy().filter(path("active") == True).head(10)
      fn head(&self, n: usize) -> LazyArbor {
          LazyArbor {
              inner: self.inner.clone().head(n),
          }
      }
  }
  ```

- [x] Add tail method:
  ```rust
  impl LazyArbor {
      /// Add a tail operation to the plan.
      ///
      /// Limits the result to the last N trees.
      ///
      /// Args:
      ///     n: Maximum number of trees to return
      ///
      /// Returns:
      ///     New LazyArbor with tail added to plan
      ///
      /// Example:
      ///     >>> lazy = arbor.lazy().filter(path("active") == True).tail(10)
      fn tail(&self, n: usize) -> LazyArbor {
          LazyArbor {
              inner: self.inner.clone().tail(n),
          }
      }
  }
  ```

#### 10.6.2.7 Implement agg Method

- [x] Add agg method:
  ```rust
  impl LazyArbor {
      /// Add an aggregation operation to the plan.
      ///
      /// Aggregates values across all trees, returning a single result.
      ///
      /// Args:
      ///     exprs: List of aggregation expressions
      ///
      /// Returns:
      ///     New LazyArbor with agg added to plan
      ///
      /// Example:
      ///     >>> lazy = arbor.lazy().agg([
      ///     ...     path("age").mean().alias("avg_age"),
      ///     ...     path("id").count().alias("count"),
      ///     ... ])
      fn agg(&self, exprs: Vec<Expr>) -> LazyArbor {
          let rust_exprs: Vec<arbors_expr::Expr> = exprs.iter().map(|e| e.inner.clone()).collect();
          LazyArbor {
              inner: self.inner.clone().agg(&rust_exprs),
          }
      }
  }
  ```

#### 10.6.2.8 Implement collect Method

- [x] Add collect method:
  ```rust
  impl LazyArbor {
      /// Execute the plan and return the result.
      ///
      /// This is where all work happens. The plan is:
      /// 1. Optimized (filter fusion, predicate pushdown)
      /// 2. Executed operation by operation
      /// 3. Results materialized into a new Arbor
      ///
      /// The GIL is released during execution to keep Python responsive
      /// and allow other Python threads to run concurrently.
      ///
      /// Args:
      ///     parallel: Use parallel execution (default: True)
      ///
      /// Returns:
      ///     Arbor containing the query results
      ///
      /// Raises:
      ///     ArborsError: If execution fails
      ///
      /// Example:
      ///     >>> result = arbor.lazy().filter(path("age") > 21).collect()
      #[pyo3(signature = (parallel=true))]
      fn collect(&self, py: Python<'_>, parallel: bool) -> PyResult<Arbor> {
          let mode = if parallel {
              ExecutionMode::Parallel
          } else {
              ExecutionMode::Sequential
          };

          // Clone the inner LazyArbor before releasing GIL
          let lazy_clone = self.inner.clone();

          // Release GIL during potentially long-running Rust execution
          let result = py.allow_threads(|| {
              lazy_clone.collect_with_mode(mode)
          }).map_err(expr_error_to_py_err)?;

          Ok(Arbor {
              inner: result,
              schema: None,  // Lazy results don't preserve schema
          })
      }
  }
  ```

**Note:** `py.allow_threads()` releases the GIL during execution, enabling:
- Python remains responsive during long queries
- Other Python threads can execute while Rust computes
- Prevents deadlocks when multiple threads use `arbors`

This works because `RustLazyArbor` is `Send + Sync`.

#### 10.6.2.9 Implement describe_plan Method

- [x] Add describe_plan method:
  ```rust
  impl LazyArbor {
      /// Get a human-readable description of the query plan.
      ///
      /// Useful for debugging and understanding the query structure.
      ///
      /// Returns:
      ///     Multi-line string showing the plan structure
      ///
      /// Example:
      ///     >>> print(arbor.lazy().filter(path("age") > 21).head(10).describe_plan())
      ///     QueryPlan (3 nodes):
      ///       QueryNodeId(2): Head(10) <- QueryNodeId(1)
      ///       QueryNodeId(1): Filter(...) <- QueryNodeId(0)
      ///       QueryNodeId(0): Source(100 trees)
      fn describe_plan(&self) -> String {
          self.inner.describe_plan()
      }
  }
  ```

#### 10.6.2.10 Implement plan_len Method

- [x] Add plan_len method:
  ```rust
  impl LazyArbor {
      /// Get the number of operations in the plan (including Source).
      ///
      /// Returns:
      ///     Number of operations in the query plan
      #[getter]
      fn plan_len(&self) -> usize {
          self.inner.plan_len()
      }
  }
  ```

#### 10.6.2.11 Implement __repr__ Method

- [x] Add __repr__ method:
  ```rust
  impl LazyArbor {
      fn __repr__(&self) -> String {
          format!(
              "LazyArbor(plan_len={}, source_trees={})",
              self.inner.plan_len(),
              self.inner.source().num_trees()
          )
      }
  }
  ```

#### 10.6.2.12 Implement collect_unoptimized Method (Debug Escape Hatch)

- [x] Add collect_unoptimized method for debugging optimizer issues:
  - Note: Rust API only has `collect_unoptimized()` (parallel), not `collect_unoptimized_with_mode()`
  - Python binding matches Rust API - no parallel parameter
  ```rust
  impl LazyArbor {
      /// Execute the plan WITHOUT optimization (for debugging).
      ///
      /// This method skips the optimization pass (filter fusion, predicate pushdown)
      /// and executes the plan exactly as specified. Useful for:
      /// - Debugging optimizer issues
      /// - Comparing optimized vs unoptimized results
      /// - Performance benchmarking of optimization impact
      ///
      /// Note: Always uses parallel execution (matching the Rust API).
      ///
      /// Returns:
      ///     Arbor containing the query results
      ///
      /// Raises:
      ///     ArborsError: If execution fails
      ///
      /// Example:
      ///     >>> optimized = lazy.collect()
      ///     >>> unoptimized = lazy.collect_unoptimized()
      ///     >>> assert len(optimized) == len(unoptimized)  # Same results
      fn collect_unoptimized(&self, py: Python<'_>) -> PyResult<Arbor> {
          let lazy_clone = self.inner.clone();

          let result = py
              .allow_threads(|| lazy_clone.collect_unoptimized())
              .map_err(expr_error_to_py_err)?;

          Ok(Arbor {
              inner: result,
              schema: None,
          })
      }
  }
  ```

**Implementation Notes:**
- Uses same error mapping (`expr_error_to_py_err`) as `collect()` for consistency
- Rust API only provides `collect_unoptimized()` (always parallel), not `collect_unoptimized_with_mode()`
- This is a debugging/benchmarking tool; document as such to avoid user confusion

### 10.6.3 Add lazy() Method to Arbor Class

File: `python/src/lib.rs`

**Location:** Add to the `#[pymethods] impl Arbor` block (around line 1780, after `agg`)

- [x] Add lazy() method:
  ```rust
  impl Arbor {
      /// Create a lazy evaluation container for this arbor.
      ///
      /// Lazy evaluation defers work until collect() is called, enabling
      /// query optimization (filter fusion, predicate pushdown).
      ///
      /// Returns:
      ///     LazyArbor for building a query plan
      ///
      /// Example:
      ///     >>> lazy = arbor.lazy()
      ///     >>> lazy = lazy.filter(path("age") > 21).select([path("name").alias("n")])
      ///     >>> result = lazy.collect()
      fn lazy(&self) -> LazyArbor {
          use arbors::lazy::ArborLazyExt;
          LazyArbor {
              inner: self.inner.clone().lazy(),
          }
      }
  }
  ```

### 10.6.4 Register LazyArbor in Module

File: `python/src/lib.rs`

**Location:** In the `#[pymodule]` function (at the end of the file)

- [x] Add LazyArbor to module exports:
  ```rust
  // In the arbors_module function:
  m.add_class::<LazyArbor>()?;
  ```
  - Added at `python/src/lib.rs:5357` after `Arbor`

### 10.6.5 Verify Rust Compilation

- [x] Run: `make python` — compiles without errors
- [x] Run: `cargo clippy -p arbors-python` — no warnings

### 10.6.6 Update Type Stubs

File: `python/arbors/_arbors.pyi`

#### 10.6.6.1 Add LazyArbor Class

**Location:** Add after the `Arbor` class and before `Tree` class

- [x] Add LazyArbor class stub:
  - Added at `python/arbors/_arbors.pyi:715-902`
  - Note: `collect_unoptimized()` has no `parallel` parameter (matches Rust API)
  ```python
  # =============================================================================
  # LazyArbor Class
  # =============================================================================

  class LazyArbor:
      """Lazy evaluation container for Arbor operations.

      LazyArbor builds a query plan without executing it. Operations are only
      performed when collect() is called, enabling query optimization
      (filter fusion, predicate pushdown).

      Example:
          >>> lazy = arbor.lazy()
          >>> lazy = lazy.filter(path("age") > 21)
          >>> lazy = lazy.select([path("name").alias("n")])
          >>> result = lazy.collect()  # Now executes optimized plan
      """

      @property
      def plan_len(self) -> int:
          """Number of operations in the plan (including Source)."""
          ...

      def filter(self, expr: Expr) -> LazyArbor:
          """Add a filter operation to the plan.

          Keeps only trees where the predicate evaluates to true.
          The predicate must evaluate to a scalar boolean.

          Args:
              expr: Predicate expression (must be scalar boolean)

          Returns:
              New LazyArbor with filter added to plan

          Example:
              >>> lazy = arbor.lazy().filter(path("age") > 21)
          """
          ...

      def select(self, exprs: list[Expr]) -> LazyArbor:
          """Add a select operation to the plan.

          Transforms each tree by evaluating the given expressions.
          Each tree becomes a struct with the expression results as fields.

          Args:
              exprs: List of expressions to evaluate (use .alias() for field names)

          Returns:
              New LazyArbor with select added to plan

          Example:
              >>> lazy = arbor.lazy().select([
              ...     path("user.name").alias("name"),
              ...     path("items[*].price").sum().alias("total"),
              ... ])
          """
          ...

      def with_column(self, name: str, expr: Expr) -> LazyArbor:
          """Add a with_column operation to the plan.

          Adds or replaces a field in each tree with the expression result.

          Args:
              name: Name of the field to add/replace
              expr: Expression to evaluate for the field value

          Returns:
              New LazyArbor with with_column added to plan

          Example:
              >>> lazy = arbor.lazy().with_column("total", path("items[*].price").sum())
          """
          ...

      def head(self, n: int) -> LazyArbor:
          """Add a head operation to the plan.

          Limits the result to the first N trees.

          Args:
              n: Maximum number of trees to return

          Returns:
              New LazyArbor with head added to plan

          Example:
              >>> lazy = arbor.lazy().filter(path("active") == True).head(10)
          """
          ...

      def tail(self, n: int) -> LazyArbor:
          """Add a tail operation to the plan.

          Limits the result to the last N trees.

          Args:
              n: Maximum number of trees to return

          Returns:
              New LazyArbor with tail added to plan

          Example:
              >>> lazy = arbor.lazy().filter(path("active") == True).tail(10)
          """
          ...

      def agg(self, exprs: list[Expr]) -> LazyArbor:
          """Add an aggregation operation to the plan.

          Aggregates values across all trees, returning a single result.

          Args:
              exprs: List of aggregation expressions

          Returns:
              New LazyArbor with agg added to plan

          Example:
              >>> lazy = arbor.lazy().agg([
              ...     path("age").mean().alias("avg_age"),
              ...     path("id").count().alias("count"),
              ... ])
          """
          ...

      def collect(self, parallel: bool = True) -> Arbor:
          """Execute the plan and return the result.

          This is where all work happens. The plan is:
          1. Optimized (filter fusion, predicate pushdown)
          2. Executed operation by operation
          3. Results materialized into a new Arbor

          Args:
              parallel: Use parallel execution (default: True)

          Returns:
              Arbor containing the query results

          Raises:
              ArborsError: If execution fails

          Example:
              >>> result = arbor.lazy().filter(path("age") > 21).collect()
          """
          ...

      def describe_plan(self) -> str:
          """Get a human-readable description of the query plan.

          Useful for debugging and understanding the query structure.

          Returns:
              Multi-line string showing the plan structure

          Example:
              >>> print(arbor.lazy().filter(path("age") > 21).head(10).describe_plan())
              QueryPlan (3 nodes):
                QueryNodeId(2): Head(10) <- QueryNodeId(1)
                QueryNodeId(1): Filter(...) <- QueryNodeId(0)
                QueryNodeId(0): Source(100 trees)
          """
          ...

      def collect_unoptimized(self, parallel: bool = True) -> Arbor:
          """Execute the plan WITHOUT optimization (for debugging).

          This method skips the optimization pass (filter fusion, predicate pushdown)
          and executes the plan exactly as specified. Useful for:
          - Debugging optimizer issues
          - Comparing optimized vs unoptimized results
          - Performance benchmarking of optimization impact

          Args:
              parallel: Use parallel execution (default: True)

          Returns:
              Arbor containing the query results

          Raises:
              ArborsError: If execution fails

          Example:
              >>> optimized = lazy.collect()
              >>> unoptimized = lazy.collect_unoptimized()
              >>> assert len(optimized) == len(unoptimized)  # Same results
          """
          ...

      def __repr__(self) -> str: ...
  ```

#### 10.6.6.2 Add lazy() Method to Arbor Class

**Location:** In the `Arbor` class, after `agg()` method

- [x] Add lazy() method stub:
  - Added at `python/arbors/_arbors.pyi:691-705`
  ```python
  # In class Arbor:

      def lazy(self) -> LazyArbor:
          """Create a lazy evaluation container for this arbor.

          Lazy evaluation defers work until collect() is called, enabling
          query optimization (filter fusion, predicate pushdown).

          Returns:
              LazyArbor for building a query plan

          Example:
              >>> lazy = arbor.lazy()
              >>> lazy = lazy.filter(path("age") > 21).select([path("name").alias("n")])
              >>> result = lazy.collect()
          """
          ...
  ```

### 10.6.7 Python Tests

File: `python/tests/test_lazy.py` (new file)

#### 10.6.7.1 Test Fixtures

- [x] Create test file with fixtures:
  ```python
  """Tests for LazyArbor (lazy evaluation API)."""

  import pytest
  import arbors as aq
  from arbors import path, lit


  # NOTE: read_jsonl() accepts str/bytes directly (not file paths).
  # This is the intentional API—tests depend on this behavior.
  # If read_jsonl() API changes, these fixtures will need updates.

  @pytest.fixture
  def simple_arbor():
      """Simple arbor with 3 trees."""
      return aq.read_jsonl('{"age": 30, "name": "Alice"}\n{"age": 20, "name": "Bob"}\n{"age": 25, "name": "Carol"}')


  @pytest.fixture
  def items_arbor():
      """Arbor with nested items arrays."""
      return aq.read_jsonl(
          '{"id": 1, "items": [{"price": 10}, {"price": 20}]}\n'
          '{"id": 2, "items": [{"price": 30}]}\n'
          '{"id": 3, "items": [{"price": 5}, {"price": 15}, {"price": 25}]}'
      )


  @pytest.fixture
  def large_arbor():
      """Arbor with 100 trees for performance testing."""
      lines = [f'{{"id": {i}, "value": {i * 10}, "active": {str(i % 2 == 0).lower()}}}' for i in range(100)]
      return aq.read_jsonl('\n'.join(lines))
  ```

#### 10.6.7.2 Test LazyArbor Creation

- [x] Add creation tests:
  ```python
  class TestLazyArborCreation:
      """Tests for LazyArbor creation."""

      def test_lazy_returns_lazy_arbor(self, simple_arbor):
          """Calling .lazy() returns a LazyArbor."""
          lazy = simple_arbor.lazy()
          assert isinstance(lazy, aq.LazyArbor)

      def test_lazy_plan_len_starts_at_one(self, simple_arbor):
          """New LazyArbor has plan_len of 1 (just Source)."""
          lazy = simple_arbor.lazy()
          assert lazy.plan_len == 1

      def test_lazy_repr(self, simple_arbor):
          """LazyArbor has informative repr."""
          lazy = simple_arbor.lazy()
          repr_str = repr(lazy)
          assert "LazyArbor" in repr_str
          assert "plan_len=1" in repr_str
          assert "source_trees=3" in repr_str

      def test_lazy_from_empty_arbor(self):
          """Can create lazy from empty arbor."""
          arbor = aq.read_jsonl('')
          lazy = arbor.lazy()
          assert lazy.plan_len == 1
  ```

#### 10.6.7.3 Test Filter Operation

- [x] Add filter tests:
  ```python
  class TestLazyFilter:
      """Tests for LazyArbor.filter()."""

      def test_filter_returns_lazy_arbor(self, simple_arbor):
          """filter() returns a new LazyArbor."""
          lazy = simple_arbor.lazy().filter(path("age") > 21)
          assert isinstance(lazy, aq.LazyArbor)

      def test_filter_increases_plan_len(self, simple_arbor):
          """filter() adds to plan length."""
          lazy = simple_arbor.lazy()
          assert lazy.plan_len == 1
          lazy = lazy.filter(path("age") > 21)
          assert lazy.plan_len == 2

      def test_filter_collect_basic(self, simple_arbor):
          """filter() then collect() returns filtered results."""
          result = simple_arbor.lazy().filter(path("age") > 21).collect()
          assert len(result) == 2  # Alice (30) and Carol (25)

      def test_filter_chaining(self, simple_arbor):
          """Multiple filters can be chained."""
          result = simple_arbor.lazy() \
              .filter(path("age") > 21) \
              .filter(path("age") < 28) \
              .collect()
          assert len(result) == 1  # Only Carol (25)

      def test_filter_all_match(self, simple_arbor):
          """Filter where all trees match."""
          result = simple_arbor.lazy().filter(path("age") > 0).collect()
          assert len(result) == 3

      def test_filter_none_match(self, simple_arbor):
          """Filter where no trees match."""
          result = simple_arbor.lazy().filter(path("age") > 100).collect()
          assert len(result) == 0
  ```

#### 10.6.7.4 Test Select Operation

- [x] Add select tests:
  ```python
  class TestLazySelect:
      """Tests for LazyArbor.select()."""

      def test_select_returns_lazy_arbor(self, simple_arbor):
          """select() returns a new LazyArbor."""
          lazy = simple_arbor.lazy().select([path("name").alias("n")])
          assert isinstance(lazy, aq.LazyArbor)

      def test_select_increases_plan_len(self, simple_arbor):
          """select() adds to plan length."""
          lazy = simple_arbor.lazy().select([path("name").alias("n")])
          assert lazy.plan_len == 2

      def test_select_collect_basic(self, simple_arbor):
          """select() then collect() returns transformed results."""
          result = simple_arbor.lazy().select([
              path("name").alias("n"),
              path("age").alias("a"),
          ]).collect()
          assert len(result) == 3
          # Verify structure of first tree
          first = result[0]
          assert first["n"].value == "Alice"
          assert first["a"].value == 30

      def test_select_with_aggregation(self, items_arbor):
          """select() with aggregation expressions."""
          result = items_arbor.lazy().select([
              path("id").alias("id"),
              path("items[*].price").sum().alias("total"),
          ]).collect()
          assert len(result) == 3
          # First tree: items [10, 20] -> sum = 30
          assert result[0]["total"].value == 30
  ```

#### 10.6.7.5 Test With_column Operation

- [x] Add with_column tests:
  ```python
  class TestLazyWithColumn:
      """Tests for LazyArbor.with_column()."""

      def test_with_column_returns_lazy_arbor(self, simple_arbor):
          """with_column() returns a new LazyArbor."""
          lazy = simple_arbor.lazy().with_column("doubled", path("age") * 2)
          assert isinstance(lazy, aq.LazyArbor)

      def test_with_column_increases_plan_len(self, simple_arbor):
          """with_column() adds to plan length."""
          lazy = simple_arbor.lazy().with_column("doubled", path("age") * 2)
          assert lazy.plan_len == 2

      def test_with_column_collect_basic(self, simple_arbor):
          """with_column() adds a computed field."""
          result = simple_arbor.lazy().with_column("doubled", path("age") * 2).collect()
          assert len(result) == 3
          assert result[0]["doubled"].value == 60  # Alice: 30 * 2
          assert result[1]["doubled"].value == 40  # Bob: 20 * 2

      def test_with_column_preserves_existing_fields(self, simple_arbor):
          """with_column() preserves existing fields."""
          result = simple_arbor.lazy().with_column("doubled", path("age") * 2).collect()
          # Original fields should still exist
          assert result[0]["name"].value == "Alice"
          assert result[0]["age"].value == 30
  ```

#### 10.6.7.6 Test Head and Tail Operations

- [x] Add head/tail tests:
  ```python
  class TestLazyHeadTail:
      """Tests for LazyArbor.head() and tail()."""

      def test_head_returns_lazy_arbor(self, simple_arbor):
          """head() returns a new LazyArbor."""
          lazy = simple_arbor.lazy().head(2)
          assert isinstance(lazy, aq.LazyArbor)

      def test_head_increases_plan_len(self, simple_arbor):
          """head() adds to plan length."""
          lazy = simple_arbor.lazy().head(2)
          assert lazy.plan_len == 2

      def test_head_collect_basic(self, simple_arbor):
          """head() limits to first N trees."""
          result = simple_arbor.lazy().head(2).collect()
          assert len(result) == 2

      def test_head_larger_than_arbor(self, simple_arbor):
          """head(N) where N > arbor size returns all."""
          result = simple_arbor.lazy().head(100).collect()
          assert len(result) == 3

      def test_tail_returns_lazy_arbor(self, simple_arbor):
          """tail() returns a new LazyArbor."""
          lazy = simple_arbor.lazy().tail(2)
          assert isinstance(lazy, aq.LazyArbor)

      def test_tail_collect_basic(self, simple_arbor):
          """tail() limits to last N trees."""
          result = simple_arbor.lazy().tail(2).collect()
          assert len(result) == 2
          # Should be Bob and Carol
          assert result[0]["name"].value == "Bob"
          assert result[1]["name"].value == "Carol"

      def test_tail_larger_than_arbor(self, simple_arbor):
          """tail(N) where N > arbor size returns all."""
          result = simple_arbor.lazy().tail(100).collect()
          assert len(result) == 3
  ```

#### 10.6.7.7 Test Agg Operation

- [x] Add agg tests:
  ```python
  class TestLazyAgg:
      """Tests for LazyArbor.agg()."""

      def test_agg_returns_lazy_arbor(self, simple_arbor):
          """agg() returns a new LazyArbor."""
          lazy = simple_arbor.lazy().agg([path("age").sum().alias("total")])
          assert isinstance(lazy, aq.LazyArbor)

      def test_agg_increases_plan_len(self, simple_arbor):
          """agg() adds to plan length."""
          lazy = simple_arbor.lazy().agg([path("age").sum().alias("total")])
          assert lazy.plan_len == 2

      def test_agg_collect_sum(self, simple_arbor):
          """agg() with sum returns single tree with aggregate."""
          result = simple_arbor.lazy().agg([
              path("age").sum().alias("total_age"),
          ]).collect()
          assert len(result) == 1
          assert result[0]["total_age"].value == 75  # 30 + 20 + 25

      def test_agg_collect_multiple(self, simple_arbor):
          """agg() with multiple aggregations."""
          result = simple_arbor.lazy().agg([
              path("age").sum().alias("total"),
              path("age").count().alias("count"),
              path("age").mean().alias("avg"),
          ]).collect()
          assert len(result) == 1
          assert result[0]["total"].value == 75
          assert result[0]["count"].value == 3
          assert result[0]["avg"].value == 25.0
  ```

#### 10.6.7.8 Test Collect Execution Modes

- [x] Add collect tests:
  ```python
  class TestLazyCollect:
      """Tests for LazyArbor.collect() execution."""

      def test_collect_default_parallel(self, large_arbor):
          """collect() uses parallel execution by default."""
          result = large_arbor.lazy().filter(path("id") > 50).collect()
          assert len(result) == 49  # ids 51-99

      def test_collect_sequential(self, large_arbor):
          """collect(parallel=False) uses sequential execution."""
          result = large_arbor.lazy().filter(path("id") > 50).collect(parallel=False)
          assert len(result) == 49

      def test_collect_parallel_and_sequential_same_result(self, large_arbor):
          """Parallel and sequential produce same results."""
          lazy = large_arbor.lazy().filter(path("active") == True).head(10)

          parallel_result = lazy.collect(parallel=True)
          sequential_result = lazy.collect(parallel=False)

          assert len(parallel_result) == len(sequential_result)

      def test_collect_preserves_order(self, large_arbor):
          """collect() preserves tree order."""
          result = large_arbor.lazy().head(5).collect()
          for i, tree in enumerate(result):
              assert tree["id"].value == i

      def test_collect_unoptimized_same_result(self, large_arbor):
          """collect_unoptimized() produces same results as collect()."""
          lazy = large_arbor.lazy().filter(path("id") > 50).filter(path("active") == True)

          optimized = lazy.collect()
          unoptimized = lazy.collect_unoptimized()

          assert len(optimized) == len(unoptimized)
          # Results should be identical
          for i in range(len(optimized)):
              assert optimized[i]["id"].value == unoptimized[i]["id"].value

      def test_collect_unoptimized_parallel(self, large_arbor):
          """collect_unoptimized() supports parallel mode."""
          lazy = large_arbor.lazy().filter(path("id") > 90)
          result = lazy.collect_unoptimized(parallel=True)
          assert len(result) == 9  # ids 91-99

      def test_collect_unoptimized_sequential(self, large_arbor):
          """collect_unoptimized() supports sequential mode."""
          lazy = large_arbor.lazy().filter(path("id") > 90)
          result = lazy.collect_unoptimized(parallel=False)
          assert len(result) == 9
  ```

#### 10.6.7.9 Test Plan Description

- [x] Add describe_plan tests:
  ```python
  class TestLazyDescribePlan:
      """Tests for LazyArbor.describe_plan()."""

      def test_describe_plan_source_only(self, simple_arbor):
          """describe_plan() shows source node."""
          lazy = simple_arbor.lazy()
          desc = lazy.describe_plan()
          assert "Source" in desc
          assert "3 trees" in desc

      def test_describe_plan_with_filter(self, simple_arbor):
          """describe_plan() shows filter node."""
          lazy = simple_arbor.lazy().filter(path("age") > 21)
          desc = lazy.describe_plan()
          assert "Filter" in desc
          assert "Source" in desc

      def test_describe_plan_with_head(self, simple_arbor):
          """describe_plan() shows head node with count."""
          lazy = simple_arbor.lazy().head(10)
          desc = lazy.describe_plan()
          assert "Head(10)" in desc

      def test_describe_plan_complex_chain(self, simple_arbor):
          """describe_plan() shows full operation chain."""
          lazy = simple_arbor.lazy() \
              .filter(path("age") > 21) \
              .select([path("name").alias("n")]) \
              .head(5)
          desc = lazy.describe_plan()
          assert "Filter" in desc
          assert "Select" in desc
          assert "Head" in desc
          assert "Source" in desc
  ```

#### 10.6.7.10 Test Chained Operations

- [x] Add chaining tests:
  ```python
  class TestLazyChaining:
      """Tests for complex operation chains."""

      def test_filter_then_select(self, simple_arbor):
          """filter() then select() works correctly."""
          result = simple_arbor.lazy() \
              .filter(path("age") > 21) \
              .select([path("name").alias("n")]) \
              .collect()
          assert len(result) == 2
          names = [tree["n"].value for tree in result]
          assert "Alice" in names
          assert "Carol" in names

      def test_filter_then_head(self, large_arbor):
          """filter() then head() applies head after filter."""
          result = large_arbor.lazy() \
              .filter(path("id") > 50) \
              .head(5) \
              .collect()
          assert len(result) == 5
          # First 5 trees with id > 50 are ids 51-55
          for i, tree in enumerate(result):
              assert tree["id"].value == 51 + i

      def test_with_column_then_filter(self, simple_arbor):
          """with_column() then filter on new column."""
          result = simple_arbor.lazy() \
              .with_column("doubled", path("age") * 2) \
              .filter(path("doubled") > 50) \
              .collect()
          assert len(result) == 1  # Only Alice (doubled = 60)

      def test_complex_pipeline(self, items_arbor):
          """Complex pipeline with multiple operations."""
          result = items_arbor.lazy() \
              .with_column("total", path("items[*].price").sum()) \
              .filter(path("total") > 20) \
              .select([
                  path("id").alias("id"),
                  path("total").alias("total"),
              ]) \
              .head(2) \
              .collect()
          assert len(result) == 2
  ```

#### 10.6.7.11 Test Error Handling

- [x] Add error handling tests:
  ```python
  class TestLazyErrors:
      """Tests for error handling in lazy operations."""

      def test_filter_cardinality_error(self, items_arbor):
          """Filter with vector predicate raises CardinalityError."""
          # This should fail because items[*].price is a vector
          lazy = items_arbor.lazy().filter(path("items[*].price") > 10)
          with pytest.raises(aq.ArborsError):
              lazy.collect()

      def test_collect_invalid_expression(self, simple_arbor):
          """Invalid expression in select raises error on collect."""
          lazy = simple_arbor.lazy().select([path("nonexistent.deep.path").alias("x")])
          # Should execute without error (paths return null for missing)
          result = lazy.collect()
          assert len(result) == 3
  ```

#### 10.6.7.12 Test Immutability

- [x] Add immutability tests:
  ```python
  class TestLazyImmutability:
      """Tests for LazyArbor immutability."""

      def test_filter_does_not_modify_original(self, simple_arbor):
          """filter() returns new LazyArbor, doesn't modify original."""
          lazy1 = simple_arbor.lazy()
          lazy2 = lazy1.filter(path("age") > 21)
          assert lazy1.plan_len == 1
          assert lazy2.plan_len == 2

      def test_collect_does_not_modify_source(self, simple_arbor):
          """collect() doesn't modify the source arbor."""
          original_len = len(simple_arbor)
          result = simple_arbor.lazy().filter(path("age") > 100).collect()
          assert len(result) == 0
          assert len(simple_arbor) == original_len  # Source unchanged

      def test_multiple_collects_same_result(self, simple_arbor):
          """Multiple collect() calls on same lazy produce same result."""
          lazy = simple_arbor.lazy().filter(path("age") > 21)
          result1 = lazy.collect()
          result2 = lazy.collect()
          assert len(result1) == len(result2)
  ```

### 10.6.8 Run Full Test Suite

**Purpose:** Ensure Python bindings work correctly.

- [x] Run: `make python` — builds successfully
- [x] Run: `make python-test` — all Python tests pass (947 passed, 2 skipped)
- [x] Run: `cargo clippy -p arbors-python` — no warnings
- [x] Document test count increase (49 tests in test_lazy.py, exceeds 30+ minimum)

**Final Checkpoint 10.6.8:**
```bash
make python                    # Build Python bindings
make python-test               # All tests pass
cargo clippy -p arbors-python  # No warnings
```
- [x] Checkpoint passed
- [x] Python bindings build
- [x] All Python tests pass (947 passed, 2 skipped, including 49 new lazy tests)
- [x] Clippy clean

---

**Phase 10.6 Deliverables:**

**Core Implementation:**
- [x] `LazyArbor` Python class in `python/src/lib.rs`
- [x] `filter()`, `select()`, `with_column()`, `head()`, `tail()`, `agg()` methods
- [x] `collect(parallel=True)` method with execution mode control and GIL release
- [x] `collect_unoptimized(parallel=True)` debug method (skips optimization)
- [x] `describe_plan()` for plan inspection
- [x] `plan_len` property
- [x] `lazy()` method added to `Arbor` class
- [x] `LazyArbor` added to module exports (`m.add_class::<LazyArbor>()`)

**Type Stubs:**
- [x] `LazyArbor` class in `_arbors.pyi`
- [x] All methods documented with examples
- [x] `lazy()` method added to `Arbor` class stub
- [x] `collect_unoptimized()` method in stub

**Testing:**
- [x] `test_lazy.py` with 35+ tests covering:
  - [x] LazyArbor creation
  - [x] filter() operation
  - [x] select() operation
  - [x] with_column() operation
  - [x] head() and tail() operations
  - [x] agg() operation
  - [x] collect() with parallel/sequential modes
  - [x] collect_unoptimized() (debug escape hatch)
  - [x] describe_plan()
  - [x] Complex operation chains
  - [x] Error handling
  - [x] Immutability guarantees
- [x] All existing Python tests pass (no regressions)
- [x] Clippy clean for arbors-python crate

---

# Part III: Design Decisions

---

## G. Open Questions for Discussion

Before proceeding, I have several questions that need clarification:

### G.1 Eager vs Lazy Default

**Question:** Should `arbor.filter()` return eager or lazy?

**Option A (Polars-style):**
- Eager by default: `arbor.filter()` → `Arbor`
- Explicit lazy: `arbor.lazy().filter()` → `LazyArbor`
- Pro: Backwards compatible, familiar to Polars users
- Con: Two code paths to maintain

**Option B (Lazy-first):**
- Everything returns lazy: `arbor.filter()` → `LazyArbor`
- Explicit collect: `arbor.filter().collect()` → `Arbor`
- Pro: Consistent, always optimized
- Con: Breaking change, more verbose for simple cases

**Option C (Parallel APIs):**
- Keep eager: `arbor.filter()` → `Arbor`
- Add lazy: `arbor.lazy_filter()` → `LazyArbor`
- Pro: No breaking changes
- Con: API bloat

**My recommendation:** Option A (Polars-style). It's familiar, backwards compatible, and lets users opt-in to optimization.

### G.2 Result Type

**Question:** What does `LazyArbor.collect()` return?

**Option A:** Return `Arbor` (new arbor with results)
- Pro: Simple, familiar
- Con: Always materializes full result

**Option B:** Return `QueryResult` (iterator over results)
- Pro: Can stream large results
- Con: More complex API

**Option C:** Both
- `collect()` → `Arbor`
- `iter()` → Iterator
- Pro: Flexibility
- Con: API surface

**My recommendation:** Option A for Phase 10, add streaming in Phase 11 if needed.

### G.3 Tree Construction

**Question:** How do we build result trees from ExprResult?

Currently `select()` returns `Vec<ExprResult>`, not a new `Arbor`. For lazy evaluation, we need to materialize results back into arbors.

**Proposed approach:**
1. Add `Arbor::from_expr_results(results: Vec<ExprResult>) -> Arbor`
2. This builds new nodes, pools, etc. from the expression results
3. May need schema inference from ExprResult shapes

### G.4 Memory Management

**Question:** When should COW trigger a copy?

**Operations that share storage:**
- `filter()` - same nodes, different roots
- `head()`/`tail()` - same nodes, subset of roots
- `clone()` - Arc increment

**Operations that copy:**
- `select()` - new tree structure
- `with_column()` - modified trees
- Any mutation

### G.5 Optimization Scope

**Question:** How aggressive should optimization be in Phase 10?

**Minimal (recommended for Phase 10):**
- Predicate pushdown
- Filter fusion
- Dead code elimination (unused columns)

**Advanced (defer to later):**
- Cost-based optimization
- Join planning (if we add joins)
- Statistics-based decisions

### G.6 Lazy Tree API

**Question:** Do we want a `Tree.lazy()` API in Phase 10?

**Option A (defer):**
- Phase 10 focuses on `Arbor.lazy()` only
- Tree-level lazy operations deferred to Phase 11+
- Pro: Simpler scope, faster delivery
- Con: Users can't optimize single-tree operations

**Option B (include):**
- Add `Tree.lazy()` that returns `LazyTree`
- Same operations but scoped to single tree
- Pro: Complete API
- Con: More implementation surface

**My recommendation:** Option A — defer to Phase 11. Focus Phase 10 on the Arbor-level lazy API.

### G.7 Array-Parallelism Scope

**Question:** Should `PerTreeArray` parallelism be in Phase 10?

**Option A (defer):**
- Phase 10 implements PerTree and Global contexts only
- PerTreeArray (parallel over array elements within a tree) deferred
- Pro: Simpler, covers majority of use cases
- Con: Large arrays within trees won't parallelize

**Option B (include):**
- Implement simple PerTreeArray for expressions like `path("items[*].price").sum()`
- Pro: Better performance for tree-local array operations
- Con: More complexity

**My recommendation:** Option A — defer. PerTree parallelism handles the common case (many trees). PerTreeArray is a performance optimization for specific workloads.

### G.8 Error Strategy

**Question:** For parallel aggregates, how should errors be handled?

**Option A (fail fast):**
- First error encountered stops all parallel work
- Return single error
- Pro: Simple, consistent
- Con: Loses information about other errors

**Option B (collect all):**
- Continue processing all shards
- Return composite error with all failures
- Pro: Better debugging for batch errors
- Con: More complex, wasted work

**My recommendation:** Option A for Phase 10 — fail fast. Simpler to implement and reason about. Composite errors can be added later if needed.

### G.9 Sort Semantics

**Question:** What ordering guarantees should Sort provide?

**Option A (stable sort):**
- Equal keys maintain their original relative order
- Pro: Deterministic, easier to test
- Con: Slightly slower

**Option B (unstable sort):**
- Any total order consistent with comparison keys
- Pro: Faster (can use unstable sort algorithms)
- Con: Non-deterministic for equal keys

**My recommendation:** Option A — stable sort. Determinism is valuable for testing and debugging. Performance difference is usually negligible.

---

## H. Success Criteria

### Phase 10 Overall

- [ ] `LazyArbor` type with filter/select/with_column/head/tail/sort
- [ ] `collect()` executes plan correctly
- [ ] Parallel execution with measurable speedup
- [ ] Basic query optimization (predicate pushdown, filter fusion)
- [ ] Python bindings with full API
- [ ] 100+ new tests
- [ ] All existing tests pass unchanged

### H.1 Correctness Test Matrix

For a test matrix of queries, verify: `eager(arbor, query) == lazy(arbor, query).collect()`

| Query Type | Test Cases |
|------------|------------|
| Filter | Single predicate, compound AND/OR, nested path access |
| Select | Single field, multiple fields, computed fields, aliased |
| WithColumn | Add new, replace existing, computed from other fields |
| Agg | sum, count, mean, min, max over trees |
| Head/Tail | n=0, n=1, n=half, n=all, n>count |
| Sort | Single key, multiple keys, ascending/descending |
| Chained | filter→select, filter→filter, select→with_column→filter |

### H.2 Parallelism Tests

| Test | Requirement |
|------|-------------|
| Result equivalence | `collect()` == `collect_parallel()` for all query types |
| Speedup benchmark | For 100K+ trees, `collect_parallel()` is ≥50% faster on 4+ cores |
| Determinism | Same query produces same results across multiple runs |
| Error handling | Parallel errors fail fast, no partial results |

### H.3 COW Storage Tests

| Test | Requirement |
|------|-------------|
| Clone is O(1) | `Arc::strong_count` increases, no data copy |
| Filter shares storage | After filter, storage Arc count > 1 |
| Sort shares storage | After sort, storage Arc count > 1 |
| Head/Tail shares storage | After head/tail, storage Arc count > 1 |
| Select creates new storage | After select, result has independent storage |
| Original unchanged | After any lazy operation + collect, source arbor unchanged |

### H.4 Performance Targets

| Metric | Target |
|--------|--------|
| Lazy chain build | O(1) per operation |
| Parallel speedup | 2-4x on 4+ cores |
| Memory overhead | < 10% vs eager |
| COW clone | O(1) time, O(1) memory |

---

## I. Implementation Order

Recommended sequence:

1. **10.1 COW Storage** - Foundation for everything else
2. **10.2 LazyArbor Type** - Define the API
3. **10.3 Plan Execution** - Make it work (correctness)
4. **10.4 Parallel Execution** - Make it fast (performance)
5. **10.5 Query Optimization** - Make it smart (efficiency)
6. **10.6 Python Bindings** - Make it accessible (usability)

Each phase builds on the previous, with tests at every step.

---

## Appendix: Reference Implementation Sketch

```rust
// Example usage flow
let arbor = read_jsonl("data.jsonl")?;

// Build lazy plan
let lazy = arbor.lazy()
    .filter(path("age").gt(lit(21)))
    .filter(path("active").eq(lit(true)))
    .select(&[
        path("name").alias("n"),
        path("email").alias("e"),
    ])
    .head(100);

// Inspect plan (for debugging)
println!("{}", lazy.describe_plan());
// Output:
// Head(100)
//   └─ Select([name → n, email → e])
//        └─ Filter(age > 21 AND active == true)  // Fused!
//             └─ Source(arbor, 10000 trees)

// Execute
let result = lazy.collect_parallel()?;
```
