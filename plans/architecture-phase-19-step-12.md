# Step 12: Cleanup - Remove Old Patterns

## Overview

**Exit Criteria:** Legacy patterns deleted, single execution engine (LogicalPlan only), Gates A + B + C green.

**Goal**: Delete QueryPlan-era code and ArborBacking infrastructure, leaving a clean unified architecture where all execution flows through LogicalPlan.

**Key Principle**: Zero external users = no backward compatibility needed. Delete aggressively.

---

## Current State Analysis

### 1. ArborBacking Enum (`crates/arbors/src/handle.rs`)

| Item | Location | Status |
|------|----------|--------|
| `ArborBacking` enum definition | Lines 564-606 | Active, ~95 usages |
| `ArborBacking::Stored` variant | Lines 573-580 | Legacy, superseded by `Scoped` |
| `ArborBacking::Filtered` variant | Lines 592-605 | Legacy, superseded by `LogicalPlan::Filter` |
| `ArborBacking::InMemory` variant | Line 566 | Still needed for leaf node data |
| `ArborBacking::Scoped` variant | Lines 582-590 | Current, uses MVCC snapshots |
| `backing` field on `Arbor` struct | Line 665 | Legacy execution path |

### 2. FilterState Enum (`crates/arbors/src/handle.rs`)

| Item | Location | Status |
|------|----------|--------|
| `FilterState` enum definition | Lines 56-67 | Legacy, state now in LogicalPlan nodes |
| `FilterState::Immediate` | Line 58 | Legacy |
| `FilterState::Lazy` | Lines 61-66 | Legacy |
| `get_indices()` method | Lines 97-119 | Legacy, used by ArborBacking::Filtered |

### 3. Staleness Checking (`crates/arbors/src/handle.rs`)

| Item | Location | Status |
|------|----------|--------|
| `validate_not_stale()` function | Lines 3042-3093 | Legacy, no staleness under MVCC |
| 21 call sites of `validate_not_stale()` | Throughout file | Legacy |
| `pinned_generation` field | Lines 604, 629, 634, etc. | Legacy |

### 4. Session Legacy Patterns (`crates/arbors/src/session.rs`)

| Item | Location | Status |
|------|----------|--------|
| `snapshot: Mutex<Option<OwnedReadTxn>>` field | Line 33 | Legacy, `cached_scope` is canonical |
| `with_snapshot()` method | Lines 81-94 | Legacy, ~20 call sites in handle.rs |
| `has_snapshot()` method | Lines 170-172 | Legacy |
| `drop_snapshot()` method | Lines 177-180 | Legacy |

### 5. BackingIter (`crates/arbors/src/handle.rs`)

| Item | Location | Status |
|------|----------|--------|
| `BackingIter` struct | Lines 4476-4789 | Legacy, replaced by `PlanBasedIter` |
| `BackingIterState` enum | Lines 4488-4522 | Legacy |
| `backing_iter()` method on Arbor | Line 1239 | Legacy |

### 6. Legacy Pipeline Types (`crates/arbors-pipeline/`)

| Item | Location | Status |
|------|----------|--------|
| `QueryPlan` struct | `plan.rs:189` | Legacy, replaced by `LogicalPlan` |
| `QueryOp` enum | `plan.rs:67` | Legacy, replaced by LogicalPlan nodes |
| `QueryNode` struct | `plan.rs` | Legacy |
| `QueryNodeId` type | `plan.rs:25` | Legacy |
| `ExecContext` enum | `plan.rs:41` | Legacy |
| `LazyArbor` struct | `lazy.rs:57` | Legacy, replaced by unified `Arbor` |
| `execute_plan()` function | `execute.rs:57` | Legacy |
| `execute_plan_with_mode()` | `execute.rs:71` | Legacy |
| `optimize()` (for QueryPlan) | `optimize/query_plan.rs` | Legacy |

### 7. Legacy Helper Functions (`crates/arbors/src/handle.rs`)

| Function | Line | Status |
|----------|------|--------|
| `compute_indices_for_backing()` | ~2764 | Legacy |
| `get_tree_by_index()` | ~2930 | Legacy |
| `refresh_backing()` | ~3016 | Legacy |
| `materialize_backing()` | ~3335 | Legacy |
| `find_one_in_backing()` | ~3187 | Legacy |
| `matching_indices_in_backing()` | ~3098 | Legacy |
| `any_in_backing()` | ~3247 | Legacy |
| `all_in_backing()` | ~3289 | Legacy |
| `count_in_backing()` | ~3397 | Legacy |
| `sum_in_backing()` | ~3442 | Legacy |
| `mean_in_backing()` | ~3487 | Legacy |
| `group_by_in_backing()` | ~3528 | Legacy |
| `index_by_in_backing()` | ~3689 | Legacy |
| `sort_by_in_backing()` | ~3881 | Legacy |

### 8. Python Bindings (`python/src/lib.rs`)

| Item | Location | Status |
|------|----------|--------|
| `RustArborBacking` usage | Lines 1643, 1772-1859 | Must update to use Arbor directly |
| ArborBacking tests | Lines 14223-14462 | Legacy tests to delete |

### 9. Public API Exports (`crates/arbors/src/lib.rs`)

| Export | Location | Status |
|--------|----------|--------|
| `ArborBacking` in `__internal` | Line 65 | Remove from exports |
| `FilterState` in `__internal` | Line 65 | Remove from exports |
| `QueryPlan` in `lazy` module | Line 234 | Remove export |
| `LazyArbor` in `lazy` module | Line 225 | Remove export |
| `QueryOp`, `QueryNode`, `QueryNodeId` | Lines 231-233 | Remove exports |

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Semantic model | **`LogicalPlan` is the only IR** | Makes "single source of truth" structural |
| User-facing query styles | **Keep both `Arbor` (eager) and `LazyArbor` (builder)** | Ergonomics + explicit build vs execute boundary |
| Eager work (w/o `ArborBacking`) | **Bake eager results into the plan** | Eliminates plan/backing synchronization |
| LazyArbor execution result | **Materialized (`InMemoryArbor`)** | Clear boundary: "builder → run → in-memory result" |
| LazyArbor.collect() | **NO FALLBACK** | Forces complete implementation, errors propagate directly |
| collect_unoptimized | **DELETE** | Zero external users = no backward compat |
| UniqueBy implementation | **Indices-first in physical layer** | No architectural debt, supports both in-memory and stored |
| LazyArbor plan inspection | **Use `LazyArbor.explain()` (logical-only)** | No “describe” concept; tests updated in same commit |
| Error classification | **Variant-based** | Use `PipelineError::ExprError` etc., not string matching |
| Session snapshot Mutex | **Delete entirely** | `cached_scope`/`ReadScope` is canonical |
| Staleness checks | **Delete entirely** | MVCC snapshots cannot be stale |
| Gate verification | **After each sub-step** | Catch breakage immediately |

### Clarifications

1. **Where the new plan-based LazyArbor lives**
   - Implement in **`arbors` crate** at `crates/arbors/src/lazy.rs`
   - Re-export via `arbors::lazy`
   - This keeps QueryPlan-era pipeline `lazy.rs` fully deletable

2. **Fate of pipeline `lazy_tree.rs` and `lazy_result.rs`**
   - These are **NOT QueryPlan-era** - they implement single-tree lazy transforms
   - **Keep them** (no Step 12 deletion)

3. **Where in-memory data lives after `ArborBacking` is deleted**
   - `ArborScope::InMemory` remains a marker only
   - Actual data lives in `LogicalPlan::InMemory { arbor: Arc<InMemoryArbor> }`

---

## Step 12.1: Add UniqueBy to LogicalPlan

**Goal:** Add missing `UniqueBy` node before rebasing LazyArbor.

### Gap Analysis

**Problem:** `LazyArbor.unique_by(by: Expr)` uses `QueryOp::UniqueBy`, but LogicalPlan has no `UniqueBy` variant.

**Impact:** 9 Python tests rely on `unique_by`:
- `test_lazy_unique_by_string`
- `test_lazy_unique_by`
- `test_lazy_unique_then_sort`
- `test_lazy_sort_then_unique`
- `test_unique_by_with_duplicates`
- `test_unique_by_with_nulls`
- `test_unique_by_numeric_canonicalization`
- `test_unique_by_then_sort_by`
- `test_select_then_unique_by`

### Existing LogicalPlan Nodes

| LogicalPlan Node | LazyArbor Method | Status |
|------------------|------------------|--------|
| `InMemory` | constructor | ✅ Ready |
| `Filter` | `filter()` | ✅ Ready |
| `Head` | `head()` | ✅ Ready |
| `Tail` | `tail()` | ✅ Ready |
| `Select` | `select()` | ✅ Ready |
| `AddFields` | `add_field()` | ✅ Ready |
| `Aggregate` | `aggregate()` | ✅ Ready |
| `Sort` | `sort_by()` | ✅ Ready |
| `Sample` | (not in LazyArbor) | ✅ Available |
| `Shuffle` | (not in LazyArbor) | ✅ Available |
| `Take` | (not in LazyArbor) | ✅ Available |
| `TopK` | (optimizer-generated) | ✅ Available |
| **`UniqueBy`** | `unique_by()` | **❌ MISSING** |

### Files

- MODIFY: `crates/arbors-pipeline/src/logical_plan.rs`
- MODIFY: `crates/arbors-pipeline/src/physical.rs`
- MODIFY: `crates/arbors-pipeline/src/optimize/logical_plan.rs`

### Implementation

1. Add `LogicalPlan::UniqueBy { source: Arc<LogicalPlan>, by: Expr }` variant

2. Implement physical execution as **indices-producing op**:

```rust
// In physical.rs - execute_plan_node() match arm (patterned after Sort/IndexBy)
LogicalPlan::UniqueBy { source, by } => {
    let source_result = execute_plan_node(source, txn, root_info)?;
    let source_indices = source_result
        .as_indices()
        .ok_or_else(|| PipelineError::StorageError("unique_by requires indices input".into()))?;

    let unique = match root_info {
        RootSourceInfo::InMemory(arbor) => {
            let src = InMemorySource::from_arc(Arc::clone(arbor));
            let budget = StreamingBudget::from_source(&src);
            physical_unique_by(&src, by, source_indices, &budget)?
        }
        RootSourceInfo::Stored { name } => {
            let txn = txn.ok_or_else(|| PipelineError::StorageError("Stored plan requires transaction".into()))?;
            let batched = txn
                .get_batched(name)
                .map_err(|e| PipelineError::StorageError(e.to_string()))?
                .ok_or_else(|| PipelineError::StorageError(format!("arbor '{}' not found", name)))?;
            let src = BatchedSource::new(&batched);
            let budget = StreamingBudget::from_source(&src);
            physical_unique_by(&src, by, source_indices, &budget)?
        }
    };
    Ok(PhysicalResult::Indices(unique))
}
```

**Why indices-first:**
1. Fits existing physical execution model
2. Works with both in-memory and stored sources (via TreeSource trait)
3. Returns `IndexSet::Sparse(Vec<usize>)` - no new PhysicalResult variants
4. Same pattern as Filter, Sort, etc. - no architectural debt
5. Uses `CanonicalKey` for consistent numeric canonicalization

**DO NOT:** Delegate to `arbors_query::unique_by()` (requires materialization).

3. Add optimizer handling (pass-through for now)

**Semantics:** Operates on current input order, keeps first encountered row per key.

**Scope:** Supports BOTH in-memory AND stored sources (via `TreeSource` implementations: `InMemorySource`, `BatchedSource`).

**Implementation note:** Implement `physical_unique_by<S: TreeSource>(source, key_expr, input, budget) -> Result<IndexSet, PipelineError>`
alongside other physical ops (mirroring `physical_index_by`), and enforce a budget (worst-case distinct keys = O(n)):
- Use `CanonicalKey` for canonical numeric equality (1 == 1.0 for small integers, NaN == NaN, etc.)
- Require scalar keys (error on arrays/objects, matching existing collection-op constraints)
- Treat null/missing keys as a single canonical key (nulls group together), matching existing tests.

### Checklist

- [ ] Add `LogicalPlan::UniqueBy { source, by }` variant
- [ ] Implement `execute_plan_node()` case for UniqueBy:
  - [ ] Iterate input indices via TreeSource
  - [ ] Use `CanonicalKey` for key canonicalization
  - [ ] Return `IndexSet::Sparse(Vec<usize>)` of first occurrence indices
- [ ] Add UniqueBy handling in optimizer passes (pass-through)
- [ ] Add explain/format-tree formatting: `"UniqueBy(by: <expr>)"`
- [ ] Add unit tests (in-memory and stored sources)
- [ ] Verify: `cargo test -p arbors-pipeline`

---

## Step 12.2: Unify plan introspection (reduce “Describe vs Explain vs Analyze” shag)

**Goal:** Make introspection ergonomic by using **one mental model**:
- **`explain()`** = static, cheap (no execution)
- **`explain_analyze()`** = runs the query and reports observed stats

We explicitly avoid introducing a third similarly-named concept (“describe”) as a separate API tier.

### Audit (current conceptual overlap)

- **Describe** (QueryPlan-era `describe_plan()`): “show builder chain” (to be deleted)
- **Explain** (`Arbor.explain*`): “show plan report (logical/optimized/physical/decode/costs)”
- **Analyze** (`Arbor.explain_analyze*`): “run query and add observed stats”

**Problem:** A developer can’t easily tell which to use, and “describe” is redundant with an `explain()` that can show only the logical plan.

### Updated proposal (reduced surface area)

1. **Do NOT add a new `LogicalPlan::describe()` public API.**
2. Add a single formatting helper used by `explain()` output:
   - `LogicalPlan::format_tree(...) -> String` (name illustrative; can be `format()` or `fmt_tree()`).
   - This is implementation detail supporting `explain()`’s “Logical Plan” section.
3. **DELETE `describe_plan()`** (Rust + Python).
   - This is a new library with zero external users; we do not keep legacy shims.
   - Replace it with `explain()` everywhere (including tests).
4. Provide a minimal `LazyArbor.explain()` that returns the **logical-only** plan view.
   - No `explain_analyze()` on LazyArbor (execution is `collect()`); keep analyze on `Arbor` only.

### Required tokens (for updated Python tests)

The logical-only explain view must contain these tokens (tests will be updated accordingly):

| Token | Example | Notes |
|-------|---------|-------|
| `"Source"` | `Source(3 trees)` | Root source node |
| `"N trees"` | `"3 trees"` | In-memory only (LazyArbor is in-memory by construction) |
| `"Head(N)"` | `"Head(10)"` | Include count |
| `"Tail(N)"` | `"Tail(5)"` | Include count |
| `"Filter"` | | |
| `"Select"` | | |
| `"Sort"` | | |
| `"UniqueBy"` | | |
| `"Aggregate"` | | |

### Recommended formatting shape

Human-readable tree (any style is fine as long as tokens match):

```
Head(10)
  └── Filter
      └── Select
          └── Source(3 trees)
```

### Files

- MODIFY: `crates/arbors-pipeline/src/logical_plan.rs` (add formatting helper for logical plan section)
- MODIFY: `crates/arbors/src/lazy.rs` (add `LazyArbor.explain()` that uses the formatter)
- MODIFY: `python/src/lib.rs` (remove `LazyArbor.describe_plan`, add `LazyArbor.explain`)
- MODIFY: `python/tests/test_lazy.py` (rename tests to `test_explain_*` and assert required tokens)

### Checklist

- [ ] Implement `LogicalPlan` plan-tree formatter used by `explain()` output (no new “describe” tier)
- [ ] Ensure required tokens are present (tests)
- [ ] Delete `LazyArbor.describe_plan()` from Rust + Python
- [ ] Add `LazyArbor.explain()` (logical-only view)
- [ ] Verify: `cargo test -p arbors-pipeline`
- [ ] Verify: updated Python explain tests pass

---

## Step 12.3: Create Plan-Based LazyArbor

**Goal:** Implement new LazyArbor in `arbors` crate using LogicalPlan.

### Rust API Surface Inventory

| Method | Signature | Returns |
|--------|-----------|---------|
| **Constructors** |
| `new` | `fn new(arbor: Arc<InMemoryArbor>) -> Self` | `Self` |
| `from_arbor` | `fn from_arbor(arbor: InMemoryArbor) -> Self` | `Self` |
| **Query Builders** |
| `filter` | `fn filter(self, predicate: Expr) -> Self` | `Self` |
| `select` | `fn select(self, exprs: &[Expr]) -> Self` | `Self` |
| `add_field` | `fn add_field(self, name: &str, expr: Expr) -> Self` | `Self` |
| `head` | `fn head(self, n: usize) -> Self` | `Self` |
| `tail` | `fn tail(self, n: usize) -> Self` | `Self` |
| `aggregate` | `fn aggregate(self, exprs: &[Expr]) -> Self` | `Self` |
| `sort_by` | `fn sort_by(self, by: &[Expr], descending: &[bool]) -> Self` | `Self` |
| `unique_by` | `fn unique_by(self, by: Expr) -> Self` | `Self` |
| **Execution** |
| `collect` | `fn collect(self) -> Result<InMemoryArbor, PipelineError>` | `Result` |
| `collect_with_mode` | `fn collect_with_mode(self, mode: ExecutionMode) -> Result<...>` | `Result` |
| ~~`collect_unoptimized`~~ | ~~DELETED~~ | - |
| **Inspection** |
| `ends_with_aggregate` | `fn ends_with_aggregate(&self) -> bool` | `bool` |
| `explain` | `fn explain(&self) -> String` | `String` (logical-only view) |
| `plan_len` | `fn plan_len(&self) -> usize` | `usize` |
| `source` | `fn source(&self) -> &Arc<InMemoryArbor>` | `&Arc<...>` |

### Implementation

```rust
pub struct LazyArbor {
    plan: Arc<LogicalPlan>,
    source_arbor: Arc<InMemoryArbor>,
}

impl LazyArbor {
    // NO FALLBACK - execute LogicalPlan directly
    pub fn collect(self) -> Result<InMemoryArbor, PipelineError> {
        let optimized = optimize_logical_plan(&self.plan);
        // No txn/scope required: LazyArbor is in-memory by construction.
        let result = execute_logical_plan(&optimized, None)?;
        Ok(materialize_result(&optimized, None, &result)?.as_ref().clone())
    }
}
```

### Error Propagation

**Decision:** LazyArbor.collect() does NOT use fallback. Errors propagate directly.

| Error Variant | Classification | Action |
|--------------|----------------|--------|
| `PipelineError::ExprError(_)` | **Semantic** | **Propagate** |
| `PipelineError::IndexOutOfBounds { .. }` | **Semantic** | **Propagate** |
| `PipelineError::BufferLimitExceeded { .. }` | **Resource** | **Propagate** |
| `PipelineError::StorageError(_)` | **Infrastructure** | **Propagate** |

### plan_len Semantics

Count LogicalPlan depth. Must increment by 1 for each operation:
- Source = 1
- +filter = 2
- +sort = 3
- +unique_by = 4

### Files

- ADD: `crates/arbors/src/lazy.rs`
- MODIFY: `crates/arbors/src/lib.rs`

### Checklist

- [ ] Create `crates/arbors/src/lazy.rs`
- [ ] Implement all builder methods (filter, select, add_field, head, tail, aggregate, sort_by, unique_by)
- [ ] Implement inspection methods (plan_len, ends_with_aggregate, source)
- [ ] Implement `explain()` returning the logical-only plan view (Step 12.2)
- [ ] Implement collect() with NO FALLBACK
- [ ] Implement collect_with_mode()
- [ ] Add `from_inmemory_arc()` constructor for Python bindings
- [ ] Implement `source()` that traverses to root `InMemory` node
- [ ] Add module to `lib.rs`
- [ ] Verify: `cargo test -p arbors`
- [ ] Verify: `test_filter_cardinality_error` passes (error propagates)

---

## Step 12.3.5: Chained Projections in Physical Execution

**Goal:** Fix physical execution to correctly handle chained projection operations (e.g., `AddFields → Select`).

### Problem Statement

The current physical execution layer loses intermediate transforms when chaining projection operations.

**Failing pattern:**
```rust
lazy.filter(...)
    .add_field("doubled", path("age") * 2)  // Produces Projection{indices, add_fields}
    .select(&[path("doubled").alias("d")])  // LOSES add_fields transform!
    .collect()
```

**Root cause:** In `execute_plan_node`, when `Select` executes on a `Projection` source:
1. It calls `source_result.as_indices()` which extracts only the indices
2. It creates a new `Projection{indices, select}`
3. The original `add_fields` transform is discarded

**Why QueryPlan doesn't have this problem:** QueryPlan execution materializes at every step—each operation produces a new `InMemoryArbor`. LogicalPlan physical execution tries to be lazy/indices-first, which causes this issue.

### Critical missing piece (must fix for correctness): root switching

The current physical executor threads a single `root_info: &RootSourceInfo` derived from the *original* plan root (stored or in-memory). If we “materialize a Projection and then run Filter/Sort/etc on it”, the executor will produce indices that are **relative to the materialized arbor** — but downstream execution and final `materialize_result(plan, ...)` will still interpret those indices as **global indices into the original plan root**. That is incorrect.

So: **it is not enough to just chain transforms**. We must also represent “the effective root has become this new in-memory arbor” in the physical result so downstream ops (and final materialization) operate on the right dataset.

### Design Constraints

1. **Maximize laziness**: Avoid materializing intermediate arbors when possible
2. **Correctness**: Operations that evaluate expressions on transformed data must see the transformed trees
3. **Simplicity**: Prefer straightforward solutions over clever ones

### Analysis: Which Operations Can Follow a Projection?

| Operation | Can Chain? | Reason |
|-----------|------------|--------|
| `AddFields` | ✅ Yes | Just append to transform chain |
| `Select` | ✅ Yes | Just append to transform chain |
| `Head` | ✅ Yes | Truncate indices (projection preserves count) |
| `Tail` | ✅ Yes | Truncate indices (projection preserves count) |
| `Take` | ✅ Yes | Subset indices |
| `Filter` | ❌ Must materialize | Predicate may reference added fields |
| `Sort` | ❌ Must materialize | Sort key may reference added fields |
| `Aggregate` | ❌ Must materialize | Expressions may reference added fields |
| `GroupBy` | ❌ Must materialize | Key expression may reference added fields |
| `IndexBy` | ❌ Must materialize | Key expression may reference added fields |
| `UniqueBy` | ❌ Must materialize | Key expression may reference added fields |
| `Sample` | ✅ Yes | Random subset of indices |
| `Shuffle` | ✅ Yes | Permute indices |

**Key insight:** Projections preserve tree count (1:1 input→output). Operations that only manipulate indices can chain. Operations that evaluate expressions against tree content must materialize first.

### Solution: Transform Chains + Root-Carrying Results (root switch)

We need two changes:

1. **Transform chaining**: extend `PhysicalResult::Projection` to hold `Vec<TransformSpec>` so `AddFields → Select` composes without materialization.
2. **Root switching**: introduce a physical result variant that carries an explicit in-memory root when we *must* materialize (e.g., `Filter` after projection). Otherwise indices become ambiguous/incorrect.

The simplest root-switch representation is an explicit variant. **However**, there is one subtle follow-on case:

- After a root switch, downstream `AddFields/Select` must not “forget” that the current indices are **relative to the switched in-memory arbor**.

So we extend `Projection` slightly to optionally carry an in-memory base.

```rust
// In physical.rs (proposal)
pub enum PhysicalResult {
    Indices(IndexSet),
    Aggregated(ExprResult),
    /// Lazy projection chain.
    /// - `base: None` => indices are relative to the original plan root.
    /// - `base: Some(arbor)` => indices are relative to this in-memory arbor (root-switch continuation).
    Projection { base: Option<Arc<InMemoryArbor>>, indices: IndexSet, transforms: Vec<TransformSpec> },
    /// NEW: indices that are relative to this in-memory arbor (root switch).
    InMemory { arbor: Arc<InMemoryArbor>, indices: IndexSet },
    Grouped(GroupedResult),
    Indexed(IndexedResult),
}
```

Rule: **If a result is `InMemory { .. }`, all downstream ops must treat that arbor as the root.**

**Current:**
```rust
Projection {
    indices: IndexSet,
    transform: TransformSpec,
}
```

**Proposed:**
```rust
Projection {
    indices: IndexSet,
    transforms: Vec<TransformSpec>,  // Applied in order during materialization
}
```

### Implementation Details

#### 1. Extend PhysicalResult::Projection

```rust
// In physical.rs
pub enum PhysicalResult {
    Indices(IndexSet),
    Aggregated(ExprResult),
    Projection {
        base: Option<Arc<InMemoryArbor>>,
        indices: IndexSet,
        transforms: Vec<TransformSpec>,  // Chain of transforms
    },
    InMemory {
        arbor: Arc<InMemoryArbor>,
        indices: IndexSet,
    },
    Grouped(GroupedResult),
    Indexed(IndexedResult),
}
```

#### 2. Update execute_plan_node for Chainable Operations

**IMPORTANT (audit requirement):** This section shows examples, but the implementation must update **every** relevant `execute_plan_node` arm. Any arm that does `source_result.as_indices()` must be audited to ensure it does not:
- Drop a `Projection { base, transforms, .. }` transform chain, or
- Drop an `InMemory { arbor, indices }` root-switch.

Concrete rule of thumb:
- **Index-only ops** must preserve both flavors (`Projection { .. }` and `InMemory { .. }`) and never “fall back” to returning plain `Indices(...)` by accident.
- **Content-sensitive ops** must (a) root-switch when needed, and (b) honor mask semantics consistently (see below).

**AddFields on Projection source:**
```rust
LogicalPlan::AddFields { source, fields } => {
    let source_result = execute_plan_node(source, txn, root_info)?;

    match source_result {
        PhysicalResult::Projection { base, indices, mut transforms } => {
            // Chain: append our transform
            transforms.push(TransformSpec::add_fields(fields.clone()));
            Ok(PhysicalResult::Projection { base, indices, transforms })
        }
        PhysicalResult::InMemory { arbor, indices } => {
            // Root-switch continuation: keep the in-memory base, add a projection chain on top.
            Ok(PhysicalResult::Projection {
                base: Some(arbor),
                indices,
                transforms: vec![TransformSpec::add_fields(fields.clone())],
            })
        }
        _ => {
            // Normal case: create new Projection
            let source_indices = source_result.as_indices().ok_or_else(|| ...)?;
            Ok(PhysicalResult::Projection {
                base: None,
                indices: source_indices.clone(),
                transforms: vec![TransformSpec::add_fields(fields.clone())],
            })
        }
    }
}
```

**Select on Projection / InMemory source:** Same pattern—append to transforms vec, and if source is `InMemory { arbor, indices }`, produce `Projection { base: Some(arbor), .. }` to avoid losing the root-switch.

**Head/Tail on Projection source:**
```rust
LogicalPlan::Head { source, n } => {
    let source_result = execute_plan_node(source, txn, root_info)?;

    match source_result {
        PhysicalResult::Projection { base, indices, transforms } => {
            // Truncate indices, keep transforms
            let truncated = physical_head(&indices, *n);
            Ok(PhysicalResult::Projection { base, indices: truncated, transforms })
        }
        PhysicalResult::InMemory { arbor, indices } => {
            let truncated = physical_head(&indices, *n);
            Ok(PhysicalResult::InMemory { arbor, indices: truncated })
        }
        _ => {
            // Normal case
            ...
        }
    }
}
```

#### 3. Update execute_plan_node for Non-Chainable Operations

**Filter/Sort/Aggregate/GroupBy/IndexBy/UniqueBy on Projection source:**

**Mask strategy (must be uniform):** For `PhysicalResult::InMemory { arbor, indices }`, this plan uses **slice-to-mask then operate**. This implies indices are renumbered to `0..slice_len` after slicing. That is fine, but you must apply the same strategy consistently across *all* content-sensitive ops (Filter/Sort/TopK/UniqueBy/Aggregate/GroupBy/IndexBy) to avoid silent wrong results.

**TopK note:** `TopK` is optimizer-generated from `Sort + Head`. Treat it like `Sort` here:
- If its input is `Projection { .. }`, materialize/root-switch first.
- If its input is `InMemory { .. }`, slice-to-mask first (consistent with the chosen mask strategy), then run TopK.

```rust
LogicalPlan::Filter { source, predicate, .. } => {
    let source_result = execute_plan_node(source, txn, root_info)?;

    // If source is a Projection, materialize it (root switch).
    // IMPORTANT: We must *carry* the materialized arbor forward, otherwise the
    // resulting indices will later be interpreted relative to the wrong root.
    match source_result {
        PhysicalResult::Projection { .. } => {
            let arbor = materialize_projection(plan, txn, &source_result)?;
            let src = InMemorySource::from_arc(Arc::clone(&arbor));
            let executor = PipelineExecutor::new(src);
            let filtered = executor.filter(predicate, /*limit*/ None)?;
            Ok(PhysicalResult::InMemory {
                arbor,
                indices: IndexSet::Sparse(filtered),
            })
        }
        PhysicalResult::InMemory { arbor, indices } => {
            // Filter within this in-memory root (indices mask must be applied)
            // Implementation detail: slice to indices first, then filter, then return
            // indices relative to the sliced arbor.
            let sliced = arbor.slice_by_indices(&indices.to_vec())?;
            let sliced = Arc::new(sliced);
            let src = InMemorySource::from_arc(Arc::clone(&sliced));
            let executor = PipelineExecutor::new(src);
            let filtered = executor.filter(predicate, /*limit*/ None)?;
            Ok(PhysicalResult::InMemory {
                arbor: sliced,
                indices: IndexSet::Sparse(filtered),
            })
        }
        _ => {
            // Normal case: operate against original plan root_info, producing global indices.
            ...
        }
    }
}
```

Notes:
- The above shows the required **dataflow shape**. The concrete implementation can reuse helpers already in `physical.rs`
  (e.g., `apply_input_mask`, existing `physical_sort`, `execute_aggregate`) but must preserve this invariant:
  - `Indices(IndexSet)` means indices are relative to the original plan root.
  - `InMemory { arbor, indices }` means indices are relative to `arbor`.
- `Projection { base: Some(arbor), .. }` means indices are relative to `arbor` (root-switch continuation); this prevents `AddFields/Select` from losing the effective root after a prior materialization.
- If desired, `InMemory { arbor, indices: IndexSet::full(arbor.num_trees()) }` can be treated as “materialized view”.

#### Implementation pitfalls (avoid these bugs)

1. **Index masking / “renumbering” semantics for `InMemory { arbor, indices }`**
   - If you implement `Filter` (or `Sort` / `UniqueBy` / `Aggregate` / etc.) by **slicing the arbor to the current `indices` first**, you have effectively created a new in-memory root where indices are **0..slice_len**.
   - That renumbering is fine, but it must be **consistent** across all content-sensitive operators:
     - either always (a) slice-to-mask then operate and return indices relative to the slice, **or**
     - always (b) operate in the full arbor while honoring the mask (harder; requires mask-aware executor paths).
   - Mixing strategies will silently produce wrong results.

2. **Index-only ops must preserve both projection flavors**
   - Operators like `Head/Tail/Take/Sample/Shuffle` must preserve:
     - `Projection { indices, transforms }` (keep transforms, modify indices), and
     - `InMemory { arbor, indices }` (keep arbor, modify indices)
   - If you accidentally “fall back” to `as_indices()` and return `Indices(...)`, you will drop transforms or lose the root-switch.
   - Regression can show up as `select().head()` or `add_fields().head()` producing incorrect output.

3. **PhysicalResult surface area / branching sprawl**
   - With `Indices` vs `InMemory` vs `Projection { base?, transforms }`, match logic can become ad-hoc if not disciplined.
   - If implementation starts accumulating many one-off cases, consider taking the optional 12.3.6.2 refactor (“results always carry their effective root”) sooner to keep the executor maintainable.

#### 4. Update materialize_result for Transform Chains

```rust
PhysicalResult::Projection { base, indices, transforms } => {
    // Start with source trees at indices.
    // If base is present, indices are relative to that in-memory arbor; otherwise they're relative to plan root.
    let mut current_arbor = match base {
        Some(arbor) => Arc::new(arbor.slice_by_indices(&indices.to_vec())?),
        None => materialize_indices(plan, txn, indices)?,
    };

    // Apply each transform in sequence
    for transform in transforms.iter() {
        let source = InMemorySource::from_arc(Arc::clone(&current_arbor));
        let executor = PipelineExecutor::new(source);

        let results = match transform.mode {
            TransformMode::Select => executor.select(transform.exprs())?,
            TransformMode::AddFields => {
                let fields: Vec<_> = transform.field_names()
                    .iter()
                    .zip(transform.exprs().iter())
                    .map(|(n, e)| (n.as_str(), e))
                    .collect();
                executor.add_fields(&fields)?
            }
        };

        // Convert to arbor for next iteration (or final output)
        let mut builder = ArborBuilder::new_schemaless();
        builder.add_expr_results(&results)?;
        current_arbor = Arc::new(builder.finish());
    }

    Ok(current_arbor)
}
```

Also add:

```rust
PhysicalResult::InMemory { arbor, indices } => {
    // Materialization is just applying the index set to the already-in-memory arbor.
    Ok(Arc::new(arbor.slice_by_indices(&indices.to_vec())?))
}
```

**Note:** This creates intermediate arbors during the transform chain application. However:
- This only happens at final materialization time (lazy until then)
- The number of transforms is typically small (1-3)
- This is simpler and more robust than expression rewriting

#### 5. Helper Function: materialize_projection

Add a helper that materializes a Projection result and returns the resulting arbor:

```rust
fn materialize_projection(
    plan: &LogicalPlan,
    txn: Option<&OwnedReadTxn>,
    result: &PhysicalResult,
) -> Result<Arc<InMemoryArbor>, PipelineError> {
    match result {
        PhysicalResult::Projection { base, indices, transforms } => {
            // Use the same logic as materialize_result for Projection
            ...
        }
        _ => Err(PipelineError::StorageError("expected Projection".into()))
    }
}
```

### Edge Cases

1. **Empty transform chain**: Should not happen (Projection always has at least one transform), but handle gracefully by just materializing indices.

2. **Projection → Filter/Sort/Aggregate/GroupBy/IndexBy/UniqueBy**: must root-switch by producing `PhysicalResult::InMemory { .. }` (or an equivalent root-carrying result), otherwise downstream indices become ambiguous.

3. **Deeply nested projections**: `AddFields → Select → AddFields → Select` just accumulates transforms. All applied at materialization.

4. **Filter → AddFields → Filter**: First filter produces Indices. AddFields creates Projection. Second filter materializes/root-switches the Projection, then filters.

5. **AddFields/Select after root-switch**: e.g. `Filter → AddFields → Filter → AddFields → Select` must preserve the effective in-memory root; do this by producing `Projection { base: Some(arbor), .. }` when the source is `InMemory { arbor, indices }`.

### Files

- MODIFY: `crates/arbors-pipeline/src/physical.rs`
  - Extend `PhysicalResult::Projection` to use `Vec<TransformSpec>`
  - Update `execute_plan_node` for AddFields, Select (chain transforms)
  - Update `execute_plan_node` for Head, Tail, Take, Sample, Shuffle (preserve transforms)
  - Update `execute_plan_node` for Filter, Sort, Aggregate, etc. (materialize first)
  - Update `materialize_result` to apply transform chain
  - Add `materialize_projection` helper

### Test Cases

**Transform chaining (no root switch needed):**
1. **Basic chaining**: `AddFields → Select` (the original failing case)
2. **Multi-step chaining**: `AddFields → AddFields → Select`
3. **Head after projection**: `AddFields → Head`
4. **Tail after projection**: `Select → Tail`
5. **Complex index-only chain**: `AddFields → Select → Head → Tail`

**Root switch required (critical for correctness):**
6. **Filter on added field**: `AddFields("doubled", age*2) → Filter(doubled > 50)` — without root-switch, Filter would compute indices relative to the materialized arbor but they'd be interpreted against original, causing wrong results or OOB
7. **Sort on added field**: `AddFields("name_upper", upper(name)) → Sort(by: name_upper)`
8. **Filter then head after projection**: `AddFields → Filter(on added field) → Head` — ensures indices remain correct through the full pipeline
9. **UniqueBy on added field**: `AddFields("key", ...) → UniqueBy(key)`
10. **Aggregate on added field**: `AddFields("doubled", age*2) → Aggregate(sum(doubled))`

**Mixed pipelines:**
11. **Filter before and after projection**: `Filter(age > 21) → AddFields → Filter(on added field) → Head`
12. **Multiple root switches**: `AddFields → Filter → AddFields → Sort` — two materialization points

### Checklist

- [ ] Extend `PhysicalResult::Projection` to hold `Vec<TransformSpec>`
- [ ] Extend `PhysicalResult::Projection` to hold `base: Option<Arc<InMemoryArbor>>` so projections can continue after a root-switch
- [ ] Update `TransformSpec` construction (if needed)
- [ ] Grep/audit: every `execute_plan_node` arm that uses `source_result.as_indices()` is updated for `Projection { base, .. }` and `InMemory { .. }` (no dropped transforms, no lost root-switch)
- [ ] Enforce consistent `InMemory { arbor, indices }` masking semantics across **all** content-sensitive ops (Filter/Sort/UniqueBy/Aggregate/GroupBy/IndexBy)
- [ ] Update `execute_plan_node` for AddFields: chain on Projection source
- [ ] Update `execute_plan_node` for Select: chain on Projection source (and handle `InMemory { .. }` by creating `Projection { base: Some(..), .. }`)
- [ ] Update `execute_plan_node` for Head/Tail/Take: preserve transforms, modify indices
- [ ] Update `execute_plan_node` for Sample/Shuffle: preserve transforms, modify indices
- [ ] Ensure index-only ops handle **both** `Projection { .. }` and `InMemory { .. }` without dropping transforms or root-switch
- [ ] Update `execute_plan_node` for Filter/Sort/Aggregate/GroupBy/IndexBy/UniqueBy: materialize Projection first
- [ ] Ensure `TopK` (optimizer-generated) treats Projection input the same as Sort: materialize/root-switch first
- [ ] Add `materialize_projection` helper function
- [ ] Update `materialize_result` to apply transform chain sequentially
- [ ] Add unit tests for chained projections
- [ ] Add unit tests for projection-then-filter pattern
- [ ] Verify: `cargo test -p arbors-pipeline`
- [ ] Verify: `cargo test -p arbors` (LazyArbor tests pass)

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Performance regression from intermediate arbors | Low | Only at materialization, typically 1-3 transforms |
| Missed operation that needs materialization | Medium | Comprehensive test coverage |
| Incorrect transform ordering | Medium | Unit tests for specific patterns |
| Memory usage for long chains | Low | Chains are typically short; budget system exists |

---

## Step 12.3.6: Follow-on simplifications (post-implementation)

**Goal:** After Step 12.3.5 lands and tests pass, do a small cleanup pass to remove now-unnecessary complexity and prevent future “indices relative to the wrong root” bugs.

### 12.3.6.1 Delete earlier ad-hoc projection/context hacks

Once we implement **(a)** transform chains and **(b)** root-switch via `PhysicalResult::InMemory { arbor, indices }`, we no longer need scattered special-casing like “if source was projection, materialize somewhere else but still pretend indices are global”. This approach gives a single coherent rule for index interpretation.

### 12.3.6.2 Optional bigger refactor: stop threading `root_info`

An optional, nice simplification is to stop threading `root_info` as a separate parameter, and instead make the *result* carry its effective root:

- e.g. make results always carry something like `{ root: RootSourceInfo, indices: IndexSet, pending_transforms: ... }`
- This eliminates the entire class of “indices ambiguous w.r.t root” bugs.

This is a refactor; Step 12.3.5’s incremental variant approach is fine.

### 12.3.6.3 `cached_indices` stays (for now)

We will **keep `cached_indices`** during Step 12. It is orthogonal to projection-chaining and is currently needed for stable, consistent iteration semantics for permutation plans (sort/shuffle).

### Checklist

- [ ] Delete any now-redundant special-casing added during the projection/root-switch transition (keep one coherent rule: indices are always interpreted relative to their current root)
- [ ] (Optional) Refactor physical execution so results carry their effective root and we no longer thread `root_info`
- [ ] Confirm `cached_indices` is unchanged (do not delete it as part of this cleanup)

---

## Step 12.4: Update Python Bindings

**Goal:** Update Python LazyArbor to use new plan-based implementation.

### Python API Surface Inventory

| Method | Signature | Notes |
|--------|-----------|-------|
| **Constructors** |
| (via `Arbor.lazy()`) | `fn lazy(&self) -> LazyArbor` | Only constructor path |
| **Query Builders** |
| `filter` | `fn filter(&self, expr: &Expr) -> LazyArbor` | Returns new LazyArbor |
| `select` | `fn select(&self, exprs: Vec<Expr>) -> LazyArbor` | |
| `add_field` | `fn add_field(&self, name: &str, expr: &Expr) -> LazyArbor` | |
| `head` | `fn head(&self, n: usize) -> LazyArbor` | |
| `tail` | `fn tail(&self, n: usize) -> LazyArbor` | |
| `aggregate` | `fn aggregate(&self, exprs: Vec<Expr>) -> LazyArbor` | |
| `sort_by` | `fn sort_by(&self, by, descending, nulls_last) -> LazyArbor` | Flexible args |
| `unique_by` | `fn unique_by(&self, by: ExprOrPath) -> LazyArbor` | Accepts Expr or path string |
| **Execution** |
| `collect` | `fn collect(&self, parallel: bool = true) -> Arbor` | Returns Arbor |
| ~~`collect_unoptimized`~~ | ~~DELETED~~ | |
| `collect_scalar` | `fn collect_scalar(&self, parallel: bool = true) -> PyObject` | Python-only convenience |
| **Inspection** |
| `explain` | `fn explain(&self) -> String` | Logical-only view |
| `plan_len` | `#[getter] fn plan_len(&self) -> usize` | **Property**, not method |
| `__repr__` | Returns `"LazyArbor(plan_len={}, source_trees={})"` | Format must be preserved |

### Python-Specific Contracts to Preserve

| Contract | Test(s) | Requirement |
|----------|---------|-------------|
| `collect_scalar` requires aggregate | `test_collect_scalar*` | Raise `ArborsError` if plan doesn't end with aggregate |
| `plan_len` is a **property** | `test_lazy_plan_len_*` | Access as `lazy.plan_len`, not `lazy.plan_len()` |
| `plan_len` increases with each op | `test_lazy_plan_length` | Source=1, +filter=2, +sort=3, +unique_by=4 |
| `__repr__` format | Various | Must include `plan_len=` and `source_trees=` |
| Error propagation | `test_filter_cardinality_error` | Semantic errors must raise `ArborsError` |

### Files

- MODIFY: `python/src/lib.rs`
- MODIFY: `python/tests/test_lazy.py`
- MODIFY: `python/arbors/_arbors.pyi`

### Checklist

- [ ] Update Python LazyArbor to use new Rust LazyArbor
- [ ] Remove `collect_unoptimized` from Python
- [ ] Delete `describe_plan()` and update tests to use `lazy.explain()` instead
- [ ] Update `Arbor.lazy()` implementation to stop calling `ArborLazyExt` / `inner.lazy()`
  - Current behavior: `Arbor.lazy()` materializes then calls `inner.lazy()` (QueryPlan-era)
  - New behavior: `Arbor.lazy()` materializes then constructs plan-based `LazyArbor::new(Arc<InMemoryArbor>)`
- [ ] Update type stubs
- [ ] Verify: `make python && .venv/bin/pytest python/tests/test_lazy.py -v`
- [ ] Verify: `.venv/bin/pytest python/tests/test_lazy_parity.py -v`
- [ ] Verify: `.venv/bin/pytest python/tests/test_collection_ops.py -v -k lazy`

---

## Step 12.5: Delete QueryPlan-Era Pipeline Modules

**Goal:** Remove QueryPlan execution stack from arbors-pipeline.

### Files

- DELETE: `crates/arbors-pipeline/src/lazy.rs`
- DELETE: `crates/arbors-pipeline/src/plan.rs`
- DELETE: `crates/arbors-pipeline/src/execute.rs`
- DELETE: `crates/arbors-pipeline/src/optimize/query_plan.rs`
- MODIFY: `crates/arbors-pipeline/src/lib.rs`
- MODIFY: `crates/arbors-pipeline/src/optimize/mod.rs`

**Keep:** `lazy_tree.rs` and `lazy_result.rs` (not QueryPlan-era)

### Checklist

- [ ] Delete `lazy.rs` (QueryPlan-era LazyArbor)
- [ ] Delete `plan.rs` (QueryPlan, QueryOp, QueryNode, QueryNodeId, ExecContext)
- [ ] Delete `execute.rs` (execute_plan, execute_plan_with_mode)
- [ ] Delete `optimize/query_plan.rs`
- [ ] Remove exports from `lib.rs`
- [ ] Remove from `optimize/mod.rs`
- [ ] Verify: `cargo build -p arbors-pipeline`
- [ ] Verify: `cargo test -p arbors-pipeline`

---

## Step 12.6: Delete ArborBacking Infrastructure

**Goal:** Remove ArborBacking enum and all related code from `arbors` crate.

### Delete from `crates/arbors/src/handle.rs`

**Enums:**
- `ArborBacking` enum (all variants: InMemory, Stored, Scoped, Filtered)
- `FilterState` enum (Immediate, Lazy)

**Fields:**
- `backing` field from `Arbor` struct

**Helper functions:**
- `compute_indices_for_backing()`
- `get_tree_by_index()`
- `refresh_backing()`
- `materialize_backing()`
- `find_one_in_backing()`
- `matching_indices_in_backing()`
- `any_in_backing()`
- `all_in_backing()`
- `count_in_backing()`
- `sum_in_backing()`
- `mean_in_backing()`
- `group_by_in_backing()`
- `index_by_in_backing()`
- `sort_by_in_backing()`

### Eager Filter Implementation

Implement eager filter as plan rewrite to `LogicalPlan::Take { indices }`:

```rust
pub fn filter(&self, predicate: Expr, mode: FilterMode) -> Result<Arbor, PipelineError> {
    match mode {
        FilterMode::Lazy => Ok(self.with_plan(Arc::new(LogicalPlan::Filter {
            source: Arc::clone(&self.plan),
            predicate,
            mode: LogicalFilterMode::Lazy,
            limit: None,
        }))),
        FilterMode::Immediate => {
            // Compute indices now, then bake them into the plan.
            let filter_plan = LogicalPlan::Filter {
                source: Arc::clone(&self.plan),
                predicate,
                mode: LogicalFilterMode::Immediate,
                limit: None,
            };

            let indices = self.compute_indices_for_plan(&filter_plan)?;
            Ok(self.with_plan(Arc::new(LogicalPlan::Take {
                source: Arc::clone(&self.plan),
                indices,
            })))
        }
    }
}
```

### Files

- MODIFY: `crates/arbors/src/handle.rs`
- MODIFY: `crates/arbors/src/lib.rs`

### Checklist

- [ ] Remove `backing` field from `Arbor` struct
- [ ] Delete `ArborBacking` enum
- [ ] Delete `FilterState` enum
- [ ] Delete all backing helper functions (14 functions)
- [ ] Implement eager filter as Take node
- [ ] Remove `ArborBacking` from `__internal` exports
- [ ] Remove `FilterState` from `__internal` exports
- [ ] Verify: `cargo test -p arbors`

---

## Step 12.7: Delete Session Snapshot Infrastructure

**Goal:** Remove legacy snapshot management from Session.

### Delete from `crates/arbors/src/session.rs`

- `snapshot: Mutex<Option<OwnedReadTxn>>` field
- `with_snapshot()` method
- `has_snapshot()` method
- `drop_snapshot()` method

### Replace Call Sites

All `with_snapshot()` call sites must be removed.

**Sequencing note:** After Step 12.6 (ArborBacking deletion), there should be *few to zero* remaining `with_snapshot()` call sites in
`handle.rs` because stored access should already be scope/txn-bound; Step 12.7 is the point where the legacy Session snapshot is deleted
and any remaining callers are eliminated.

### Files

- MODIFY: `crates/arbors/src/session.rs`
- MODIFY: `crates/arbors/src/handle.rs`

### Checklist

- [ ] Delete `snapshot` field from Session
- [ ] Delete `with_snapshot()` method
- [ ] Delete `has_snapshot()` method
- [ ] Delete `drop_snapshot()` method
- [ ] Replace all `with_snapshot()` call sites with scope-based operations
- [ ] Verify: `cargo test -p arbors`

---

## Step 12.8: Delete Staleness Checks and BackingIter

**Goal:** Remove staleness validation and legacy iteration.

### Delete from `crates/arbors/src/handle.rs`

**Staleness:**
- `validate_not_stale()` function
- All 21+ call sites of `validate_not_stale()`
- `pinned_generation` field/logic

**BackingIter:**
- `BackingIter` struct
- `BackingIterState` enum
- `backing_iter()` method

**Rationale:** MVCC snapshots cannot be stale; PlanBasedIter replaces BackingIter.

### Files

- MODIFY: `crates/arbors/src/handle.rs`

### Checklist

- [ ] Delete `validate_not_stale()` function
- [ ] Delete all call sites of `validate_not_stale()`
- [ ] Delete `pinned_generation` field/logic
- [ ] Delete `BackingIter` struct
- [ ] Delete `BackingIterState` enum
- [ ] Delete `backing_iter()` method
- [ ] Verify: `cargo test -p arbors`

---

## Step 12.9: Final Cleanup and Verification

**Goal:** Ensure complete cutover and all gates green.

### Grep Sweep

All of these should return **no results**:

```bash
grep -r "QueryPlan" --include="*.rs" crates/
grep -r "execute_plan" --include="*.rs" crates/
grep -r "with_snapshot" --include="*.rs" crates/
grep -r "ArborBacking" --include="*.rs" crates/
grep -r "FilterState" --include="*.rs" crates/
grep -r "BackingIter" --include="*.rs" crates/
grep -r "validate_not_stale" --include="*.rs" crates/
grep -r "pinned_generation" --include="*.rs" crates/
grep -r "REFACTOR FIXME(Step 12)" --include="*.rs" crates/
```

### Dead Code Elimination

```bash
RUSTFLAGS="-D dead_code" cargo build -p arbors 2>&1 | grep "dead_code"
RUSTFLAGS="-D dead_code" cargo build -p arbors-pipeline 2>&1 | grep "dead_code"
cargo clippy -p arbors -- -D warnings
cargo clippy -p arbors-pipeline -- -D warnings
```

### Gate Verification (run 3x for flakiness)

```bash
# Gate A: Invariants
cargo test -p arbors --test invariants

# Gate B: Full Rust test suite
cargo nextest run

# Gate C: Conformance
cargo nextest run -p arbors -- conformance

# Python tests
make python && .venv/bin/pytest python/tests -v

# Lint
make lint
```

### Checklist

- [ ] Grep sweep returns no legacy patterns
- [ ] No dead code warnings
- [ ] No clippy warnings
- [ ] Gate A passes
- [ ] Gate B passes
- [ ] Gate C passes
- [ ] Python tests pass
- [ ] All gates pass 3x (no flakiness)

---

## Summary Table

| Step | Description | Risk | Dependencies |
|------|-------------|------|--------------|
| 12.1 | Add UniqueBy to LogicalPlan | Low | None |
| 12.2 | Unify plan introspection under explain/explain_analyze | Low | None |
| 12.3 | Create plan-based LazyArbor | Medium | 12.1, 12.2 |
| 12.3.5 | Chained projections in physical execution | Medium | 12.3 |
| 12.3.6 | Follow-on simplifications after 12.3.5 | Low | 12.3.5 |
| 12.4 | Update Python bindings | Medium | 12.3, 12.3.5 |
| 12.5 | Delete QueryPlan-era modules | Medium | 12.3, 12.3.5, 12.4 |
| 12.6 | Delete ArborBacking infrastructure | **High** | 12.5 |
| 12.7 | Delete Session snapshots | Medium | 12.6 |
| 12.8 | Delete staleness + BackingIter | Low | 12.6 |
| 12.9 | Final cleanup + verification | Low | All |

---

## Atomic Commit Groups

These changes must land together:

1. **12.1 + 12.2**: LogicalPlan capabilities (UniqueBy + explain formatting)
2. **12.3 + 12.3.5 + 12.4**: LazyArbor rebase (Rust + chained projections + Python)
3. **12.3.6**: Follow-on simplifications (optional; can land after group 2)
4. **12.5**: QueryPlan-era deletion
5. **12.6 + 12.7 + 12.8**: Backing/Session/Staleness deletion
6. **12.9**: Final verification

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking Python bindings | Medium | Land 12.3 + 12.3.5 + 12.4 together |
| Missing usage sites | Medium | Use grep extensively before deleting |
| Test failures | Medium | Update tests in same step as code changes |
| Semantic drift (eager vs builder) | Medium | Single LogicalPlan IR; eager = plan rewrite |
| Compilation failures | Medium | Build after each step |
| UniqueBy execution differs | Low | Indices-first using CanonicalKey (same as index_by) |
| LazyArbor explain output breaks tests | Low | Required tokens preserved; tests updated in same commit |
| Error swallowed by fallback | Low | NO FALLBACK in LazyArbor - errors propagate |
| plan_len semantics differ | Low | Count depth, increment by 1 per op |
| Chained projections lose transforms | Medium | Transform chains in PhysicalResult; materialize when needed |

---

## Exit Criteria

| Criterion | Verification |
|-----------|--------------|
| `QueryPlan` deleted | Grep returns no results |
| `execute_plan*` deleted | Grep returns no results |
| `ArborBacking` deleted | Grep returns no results |
| `FilterState` deleted | Grep returns no results |
| `validate_not_stale()` deleted | Grep returns no results |
| `pinned_generation` deleted | Grep returns no results |
| `with_snapshot()` deleted | Grep returns no results |
| `BackingIter` deleted | Grep returns no results |
| `REFACTOR FIXME(Step 12)` comments | Grep returns no results |
| Plan-based LazyArbor works | `LazyArbor.collect()` returns `InMemoryArbor` |
| Gate A green | `cargo test -p arbors --test invariants` |
| Gate B green | `cargo nextest run` |
| Gate C green | Conformance tests pass |
| Python tests green | `.venv/bin/pytest python/tests -v` |
| No clippy warnings | `make lint` |

---

## Files Summary

### Deleted Files

| File | Description |
|------|-------------|
| `crates/arbors-pipeline/src/lazy.rs` | QueryPlan-era LazyArbor |
| `crates/arbors-pipeline/src/plan.rs` | QueryPlan/QueryOp/QueryNode |
| `crates/arbors-pipeline/src/execute.rs` | QueryPlan executor |
| `crates/arbors-pipeline/src/optimize/query_plan.rs` | QueryPlan optimizer |

### New Files

| File | Description |
|------|-------------|
| `crates/arbors/src/lazy.rs` | Plan-based LazyArbor |

### Modified Files

| File | Changes |
|------|---------|
| `crates/arbors/src/handle.rs` | Remove backing/FilterState/BackingIter/staleness/helpers; add eager filter via Take |
| `crates/arbors/src/session.rs` | Remove snapshot mutex and methods |
| `crates/arbors/src/lib.rs` | Update exports, add lazy module |
| `crates/arbors-pipeline/src/lib.rs` | Remove QueryPlan-era exports |
| `crates/arbors-pipeline/src/logical_plan.rs` | Add UniqueBy, plan-tree formatter for explain() |
| `crates/arbors-pipeline/src/physical.rs` | Execute UniqueBy |
| `crates/arbors-pipeline/src/optimize/logical_plan.rs` | Handle UniqueBy |
| `crates/arbors-pipeline/src/optimize/mod.rs` | Remove QueryPlan optimizer |
| `python/src/lib.rs` | Use plan-based LazyArbor |
| `python/tests/test_lazy.py` | Update plan inspection tests (rename from describe_plan → explain) |
| `python/arbors/_arbors.pyi` | Update type stubs |

---

## What Remains After Step 12

1. **Arbor**: Handle with `plan: Arc<LogicalPlan>` and `scope: ArborScope` (no backing field)
2. **LazyArbor**: Builder that holds LogicalPlan, materializes on `collect()`
3. **LogicalPlan**: Single planning abstraction for both APIs
4. **PlanBasedIter**: Single iteration implementation
5. **Session**: Simplified with only `cached_scope`
6. **One engine**: All execution via LogicalPlan → physical execution
