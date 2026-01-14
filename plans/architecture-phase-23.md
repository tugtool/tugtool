# Phase 23: API Cleanup With Examples

## Overview

Clean up the Arbors API and then write real-world examples to exercise the improved API:

1. **Rename**: `QueryPlan` → `LogicalPlan`, `ArborQuery` → `ArborPlan`, `TreeQuery` → `TreePlan`, `query()` → `plan()`, `execute()` → `collect()`
2. **Unify**: Make `plan()` work for both in-memory and stored/scoped arbors
3. **Simplify**: Remove mode knobs - bare Arbor methods become eager by default
4. **Write-back**: Add `Transaction::put_arbor()` and `Session::store()`
5. **Examples**: Real-world examples in Rust and Python

---

## Design Decisions

### Q1: What should `ArborPlan` terminal methods do?

**Decision: Three-method API with clear semantics.**

| Method | Signature | Returns | Use Case |
|--------|-----------|---------|----------|
| `optimize()` | `fn optimize(self) -> Arbor` | Lazy Arbor (optimized plan) | Streaming, pass around without forcing |
| `materialize()` | `fn materialize(self) -> Result<Arbor, PipelineError>` | Materialized in-memory Arbor | Random access, repeated iteration |
| `collect()` | `fn collect(self) -> Result<Arbor, PipelineError>` | Materialized in-memory Arbor | Convenience (optimize + materialize) |

Rationale:
- **`optimize()`** is infallible—it just applies plan optimizations (filter pushdown, etc.) and returns a lazy `Arbor` that can still stream
- **`materialize()`** is fallible—it executes the plan and forces all data into memory
- **`collect()`** is shorthand for the common case: `self.optimize().materialize()`
- Developers get exactly what they need: streaming vs materialized, with explicit control

### Q2: Error type for `Transaction::put_arbor()` / `Session::store()`?

**Decision: (b) Keep `ArborStoreError`, map `PipelineError` into it (lossy string mapping).**

Rationale:
- Pragmatic and quick to implement
- Write-back is fundamentally a storage operation; storage errors dominate
- `PipelineError` during write-back is rare (only if materialization fails)
- Can refine to unified error type later if needed

Implementation:
```rust
// Step 1: Add variant to ArborStoreError (in arbors-base/src/error.rs or similar)
pub enum ArborStoreError {
    // ... existing variants ...
    /// Catch-all for errors from other subsystems (e.g., PipelineError during materialize)
    Other(String),
}

// Step 2: In put_arbor:
let materialized = arbor.materialize()
    .map_err(|e| ArborStoreError::Other(format!("materialize failed: {}", e)))?;
```

---

## Known Pitfalls (Must Address)

### Pitfall 1: Name collision - `Arbor::plan()` already exists

**Problem**: `Arbor` already has `#[doc(hidden)] pub fn plan(&self) -> &Arc<QueryPlan>`.

**Solution**: Rename existing accessor to `inner()` and rename `QueryPlan` → `LogicalPlan` in sub-phase 23a *before* adding user-facing `plan()`.

```rust
// Before (current)
#[doc(hidden)]
pub fn plan(&self) -> &Arc<QueryPlan> { ... }

// After
#[doc(hidden)]
pub fn inner(&self) -> &Arc<LogicalPlan> { ... }

// New user-facing method
pub fn plan(&self) -> ArborPlan { ... }
```

### Pitfall 2: `execute_with_mode` ignores its argument

**Problem**: Current `execute_with_mode(self, _mode: ExecutionMode)` ignores `_mode`.

**Solution**: Remove from public surface. Keep only `collect()`. If parallel execution is needed later, add it as internal/test-only.

### Pitfall 3: Test churn is significant

**Scope acknowledgment**: Many Python tests exercise lazy/query/explode optimizer behavior. Files affected:
- `test_transform_mode.py` (rewrite entirely)
- `test_lazy_filter.py`, `test_lazy_explode.py`, etc. (update method names)
- `test_arborquery.py` or similar (rename to `test_arborplan.py`)
- Any test calling `.query()` or `.execute()` or passing `mode=`

Plan to grep for: `ArborQuery|TreeQuery|\.query\(|\.execute\(|mode="lazy"|mode="eager"|FilterMode|TransformMode`

### Pitfall 4: Tree API requires cascading renames

**Problem**: The Tree API has a naming collision: renaming `TreeQuery` → `TreePlan` requires renaming the existing `TreePlan` struct first.

**Solution**: Rename in dependency order:
1. `TreePlan` (underlying struct) → `TreeLogicalPlan`
2. `TreeQuery` (builder) → `TreePlan`
3. `TreeQuery::plan()` (accessor) → `TreePlan::inner()`
4. Update all references

This mirrors the Arbor pattern where `LogicalPlan` is internal and `ArborPlan` is the builder.

---

## Sub-phase 23a: Rename Plan API

### Objective
Rename the lazy evaluation API for consistency across Arbor and Tree types:

**Arbor level:**
- `lazy.rs` → `plan.rs`
- `QueryPlan` → `LogicalPlan` (internal plan struct)
- `ArborQuery` → `ArborPlan` (builder)
- `Arbor.query()` → `Arbor.plan()`
- `Arbor.plan()` (old accessor) → `Arbor.inner()`
- `ArborQuery.execute()` → `ArborPlan.collect()`

**Tree level (full consistency):**
- `TreePlan` (underlying struct) → `TreeLogicalPlan`
- `TreeQuery` (builder) → `TreePlan`
- `Tree.query()` → `Tree.plan()`
- `TreeQuery.plan()` (accessor) → `TreePlan.inner()`
- `TreeQuery.execute()` → `TreePlan.collect()`

### Step 0: Fix name collision and rename structs FIRST

1. Rename `QueryPlan` → `LogicalPlan` throughout codebase
2. Rename existing hidden `Arbor::plan()` accessor to `inner()`:

```rust
// crates/arbors/src/handle/mod.rs
#[doc(hidden)]
pub fn inner(&self) -> &Arc<LogicalPlan> { ... }  // was plan() -> &Arc<QueryPlan>
```

Update all internal callers of `.plan()` to `.inner()`.

### Files to Modify

**Arbor API:**
| File | Changes |
|------|---------|
| `crates/arbors-planner/src/plan.rs` | Rename `QueryPlan` → `LogicalPlan` |
| `crates/arbors-planner/src/lib.rs` | Update re-exports for `LogicalPlan` |
| `crates/arbors/src/handle/mod.rs` | Rename `plan()` → `inner()`, use `LogicalPlan` |
| `crates/arbors/src/lazy.rs` | Rename to `plan.rs`, rename struct/trait/methods |
| `crates/arbors/src/lib.rs` | Change `pub mod lazy` → `pub mod plan`, update re-exports |

**Tree API:**
| File | Changes |
|------|---------|
| `crates/arbors-planner/src/lazy_tree.rs` | Rename `TreePlan` → `TreeLogicalPlan`, `TreeQuery` → `TreePlan`, accessor `plan()` → `inner()`, `execute()` → `collect()` |
| `crates/arbors-planner/src/lib.rs` | Update re-exports |
| `crates/arbors/tests/integration/pipeline/lazy_tree_integration.rs` | Update test usages |

**Python bindings:**
| File | Changes |
|------|---------|
| `python/src/lib.rs` | Rename `ArborQuery` → `ArborPlan`, `TreeQuery` → `TreePlan`, `query()` → `plan()`, `execute()` → `collect()` |

### Key Changes

**Rust internal plan struct (in `arbors-planner`):**
```rust
pub enum LogicalPlan { ... }           // was QueryPlan
pub struct TreeLogicalPlan { ... }     // was TreePlan
```

**Rust Arbor API (`plan.rs`, was `lazy.rs`):**
```rust
pub struct ArborPlan { ... }           // was ArborQuery
pub trait ArborPlanExt {
    fn plan(self) -> ArborPlan;         // was query()
}
impl ArborPlan {
    #[doc(hidden)]
    pub fn inner(&self) -> &Arc<LogicalPlan>              // internal accessor
    pub fn optimize(self) -> Arbor                        // NEW: infallible, returns lazy Arbor
    pub fn materialize(self) -> Result<Arbor, PipelineError>  // NEW: executes + materializes
    pub fn collect(self) -> Result<Arbor, PipelineError>  // was execute(), now = optimize+materialize
    // Remove execute_with_mode from public API
}
```

**Rust Tree API (`lazy_tree.rs`):**
```rust
pub struct TreeLogicalPlan { ... }     // was TreePlan (underlying plan data)
pub struct TreePlan { ... }            // was TreeQuery (builder)

impl TreePlan {
    #[doc(hidden)]
    pub fn inner(&self) -> &TreeLogicalPlan               // was plan()
    pub fn collect(self) -> Result<(InMemoryArbor, NodeId), ExprError>  // was execute()
}

// Tree extension
impl Tree {
    pub fn plan(&self) -> TreePlan { ... }  // was query()
}
```

**Python:**
```python
# Arbor
arbor.plan()          # was arbor.query()
plan.optimize()       # NEW: returns lazy Arbor with optimized plan
plan.materialize()    # NEW: executes and materializes
plan.collect()        # was plan.execute(), convenience for optimize+materialize

# Tree
tree.plan()           # was tree.query()
plan.collect()        # was plan.execute()
```

### Verification
```bash
cargo nextest run -p arbors
```

---

## Sub-phase 23b: Plan for All Arbors

### Objective
Make `Arbor::plan()` work uniformly for in-memory AND stored/scoped arbors.

### Current Problem
- Python `Arbor.query()` calls `self.materialize()` first (line ~3478)
- This defeats lazy evaluation for stored data

### Solution
`ArborPlan` holds an `Arbor` reference (not `Arc<InMemoryArbor>`), uses arbor's binding for execution.

### Key Changes

**Rust `plan.rs`:**
```rust
pub struct ArborPlan {
    plan: Arc<LogicalPlan>,
    source: Arbor,  // holds the arbor for binding access
}

impl ArborPlan {
    pub fn from_arbor(arbor: Arbor) -> Self {
        Self {
            plan: Arc::clone(arbor.inner()),  // use renamed accessor
            source: arbor,
        }
    }

    /// Apply optimizations and return a lazy Arbor (infallible).
    ///
    /// The returned Arbor has an optimized plan but is not yet executed.
    /// Iteration will stream results lazily.
    pub fn optimize(self) -> Arbor {
        let optimized = optimize_logical_plan(&self.plan);
        // Uses existing #[doc(hidden)] constructor
        Arbor::from_plan_and_binding(optimized, self.source.binding.clone())
    }

    /// Execute the plan and materialize into a new in-memory Arbor.
    ///
    /// Forces all data into memory. Use for random access or repeated iteration.
    pub fn materialize(self) -> Result<Arbor, PipelineError> {
        let txn = self.source.binding.as_scope().map(|s| s.txn());
        let optimized = optimize_logical_plan(&self.plan);
        let result = execute_logical_plan(&optimized, txn)?;
        let materialized = materialize_result(&optimized, txn, &result)?;
        Ok(Arbor::from_inmemory(materialized))
    }

    /// Convenience: optimize then materialize.
    ///
    /// This is the most common terminal method. Internally calls `materialize()`,
    /// which applies optimizations before execution.
    pub fn collect(self) -> Result<Arbor, PipelineError> {
        // materialize() already applies optimize_query_plan() internally
        self.materialize()
    }
}
```

**Add `Arbor::plan()` method:**
```rust
impl Arbor {
    /// Create a plan builder for deferred execution.
    ///
    /// Operations on the plan are not executed until `collect()` is called.
    /// Works uniformly for in-memory and stored arbors.
    pub fn plan(&self) -> ArborPlan {
        ArborPlan::from_arbor(self.clone())
    }
}
```

### Files to Modify
- `crates/arbors/src/plan.rs`
- `crates/arbors/src/handle/mod.rs`
- `python/src/lib.rs`

---

## Sub-phase 23c: Remove Mode Knobs

### Objective
Remove `FilterMode` and `TransformMode` from public API. Bare Arbor methods become **eager by default**.

### Rationale
- Mode parameters add cognitive load
- Lazy evaluation → use `arbor.plan()...collect()` pattern
- Eager is safer (errors visible immediately)

### Current State (Rust)
```rust
// handle/mod.rs - publicly exported
pub enum FilterMode { Immediate, Lazy }
pub enum TransformMode { Lazy, Eager }

// Methods take mode parameter
fn filter(&self, predicate: &Expr, mode: FilterMode) -> ...
fn select(&self, exprs: &[Expr], mode: TransformMode) -> ...
```

### Current State (Python)
```python
# All take mode="eager" or mode="lazy"
arbor.filter(expr, mode="lazy")
arbor.select(exprs, mode="eager")
```

### New API

**Rust:**
```rust
// Remove from public exports
pub(crate) enum FilterMode { ... }  // internal only
pub(crate) enum TransformMode { ... }

impl Arbor {
    // Eager by default, no mode parameter
    pub fn filter(&self, predicate: &Expr) -> Result<Self, PipelineError> {
        self.filter_internal(predicate, FilterMode::Immediate)
    }

    pub fn select(&self, exprs: &[Expr]) -> Result<Self, PipelineError> {
        self.select_internal(exprs, TransformMode::Eager)
    }

    // _internal variants for ArborPlan use
    pub(crate) fn filter_internal(..., mode: FilterMode) -> ...
}
```

**Python:**
```python
# No mode parameter - eager by default
arbor.filter(expr)      # eager
arbor.select(exprs)     # eager

# Lazy via plan API - three terminal options
arbor.plan().filter(expr).select(exprs).optimize()     # lazy Arbor, streaming
arbor.plan().filter(expr).select(exprs).materialize()  # materialized Arbor
arbor.plan().filter(expr).select(exprs).collect()      # shorthand for materialize
```

### Files to Modify
- `crates/arbors/src/handle/mod.rs` - make enums `pub(crate)`
- `crates/arbors/src/handle/filter.rs` - remove mode param from public API
- `crates/arbors/src/handle/transform.rs` - remove mode param from public API
- `crates/arbors/src/lib.rs` - remove `FilterMode`/`TransformMode` from re-exports
- `python/src/lib.rs` - remove mode param from all methods

### Tests to Update
- `python/tests/test_transform_mode.py` - rewrite to use plan API for lazy

---

## Sub-phase 23d: Write-back API

### Objective
Add convenience methods for storing arbor handles (with automatic materialization).

### Error Handling Strategy
Map `PipelineError` → `ArborStoreError::Other(string)` for pragmatic implementation.

### New Rust Methods

**`scope.rs`:**
```rust
impl<'a> Transaction<'a> {
    /// Put an Arbor handle into storage (materializes if needed).
    ///
    /// If the arbor has pending operations, they are executed and materialized first.
    pub fn put_arbor(
        &mut self,
        name: &str,
        arbor: &Arbor,
        options: Option<&ArborStoreOptions>,
    ) -> Result<WriteStats, ArborStoreError> {
        let materialized = arbor.materialize()
            .map_err(|e| ArborStoreError::Other(format!("materialize failed: {}", e)))?;
        self.put(name, &materialized, options)
    }
}
```

**`session.rs`:**
```rust
impl Session {
    /// Store an arbor with a single transaction (convenience).
    ///
    /// Equivalent to: begin transaction, put_arbor, commit, refresh.
    /// For multiple writes, use `session.transaction()` directly.
    pub fn store(
        &self,
        name: &str,
        arbor: &Arbor,
        options: Option<&ArborStoreOptions>,
    ) -> Result<Arc<Snapshot>, ArborStoreError> {
        let mut txn = self.transaction()?;
        txn.put_arbor(name, arbor, options)?;
        let snapshot = txn.commit()?;
        self.refresh()?;
        Ok(snapshot)
    }
}
```

### New Python Methods

**`python/src/lib.rs` - ArborStore class:**
```rust
#[pymethods]
impl ArborStore {
    /// Store an arbor with a single transaction.
    ///
    /// Convenience method: opens transaction, stores arbor, commits, refreshes.
    #[pyo3(signature = (name, arbor, options=None))]
    fn store(
        &self,
        name: &str,
        arbor: &Arbor,
        options: Option<&ArborStoreOptions>,
    ) -> PyResult<()> {
        let session = self.get_session()?;
        session.store(name, &arbor.inner, options.map(|o| o.to_rust()).as_ref())
            .map_err(arborbase_error_to_py_err)?;
        Ok(())
    }
}
```

**`python/src/lib.rs` - WriteScope class:**
```rust
#[pymethods]
impl WriteScope {
    /// Put an Arbor handle (materializes if needed).
    #[pyo3(signature = (name, arbor, options=None))]
    fn put_arbor(
        &mut self,
        name: &str,
        arbor: &Arbor,
        options: Option<&ArborStoreOptions>,
    ) -> PyResult<()> {
        // ... delegate to Rust Transaction::put_arbor
    }
}
```

### Python Usage Pattern
```python
# Simple one-liner
base.store("active_users", filtered_arbor)

# In a transaction
with base.transaction() as txn:
    txn.put_arbor("users_v2", new_users)
    txn.put_arbor("products_v2", new_products)
    txn.commit()
```

### Rust Usage Pattern
```rust
let session = Session::open(path)?;
let users = session.arbor("users")?;

// Using collect() - most common
let derived = users
    .plan()
    .filter(path("active").eq(lit(true)))
    .head(10)
    .collect()?;

session.store("active_users", &derived, None)?;

// Or using optimize() for streaming without materialization
let lazy_view = users
    .plan()
    .filter(path("active").eq(lit(true)))
    .optimize();  // infallible, returns lazy Arbor

for tree in lazy_view.iter() {
    // streams without full materialization
}
```

### Files to Modify
- `crates/arbors/src/scope.rs` - add `Transaction::put_arbor()`
- `crates/arbors/src/session.rs` - add `Session::store()`
- `python/src/lib.rs` - add `ArborStore.store()`, `WriteScope.put_arbor()`
- `python/arbors/_arbors.pyi` - update type stubs

---

## Sub-phase 23e: Update Straggling Names and Docs

### Objective
Clean up remaining naming inconsistencies and remove internal types from public exports.

### Task 1: Rename `PlanBasedIter` → `TreeIter`

**Rationale:** The iterator yields `Tree` values, so `TreeIter` follows Rust naming conventions (like `slice::Iter`). The name `PlanBasedIter` leaks implementation details.

**Risk:** Low - internal type, mostly accessed via type aliases.

**Files to modify:**

| File | Changes |
|------|---------|
| `crates/arbors/src/handle/iteration.rs` | Rename `struct PlanBasedIter<S>` → `struct TreeIter<S>` |
| `crates/arbors/src/handle/mod.rs` | Update re-export if needed |

**Type aliases remain unchanged:**
```rust
pub type ArborIter<'a> = TreeIter<&'a DataBinding>;
pub type OwnedArborIter = TreeIter<DataBinding>;
```

### Task 2: Rename `ArborView` trait → `TabularView`

**Rationale:** `ArborView` sounds related to the `Arbor` handle, but it's actually a trait for tabular access patterns over `InMemoryArbor`. Renaming to `TabularView` clarifies its purpose and eliminates confusion.

**Risk:** Low-Medium - trait rename across several files.

**Files to modify:**

| File | Changes |
|------|---------|
| `crates/arbors-storage/src/view.rs` | Rename `trait ArborView` → `trait TabularView` |
| `crates/arbors-storage/src/lib.rs` | Update re-export |
| `crates/arbors/src/lib.rs` | Update re-export |
| `crates/arbors-query/src/index_by.rs` | Update `impl ArborView` → `impl TabularView` |
| `crates/arbors/tests/integration/arbor_view_acceptance.rs` | Update references (consider renaming file to `tabular_view_acceptance.rs`) |

### Task 3: Remove `InMemoryArbor` from public re-exports

**Status:** Previously BLOCKED on sub-phase 23d, now UNBLOCKED.

**Rationale:** Now that `Transaction::put_arbor(&Arbor)` and `Session::store()` exist, tests can use the public API for storage operations. `InMemoryArbor` is an internal type.

**Files to modify:**

| File | Changes |
|------|---------|
| `crates/arbors/src/lib.rs` | Remove `InMemoryArbor` from `pub use arbors_storage::{...}` |

**Tests to update:**
Search for uses of `InMemoryArbor` in test code and convert to:
- `Arbor::from_inmemory(inner)` → store via `txn.put_arbor("name", &arbor, None)`
- Direct `InMemoryArbor` construction → use `read_jsonl()` + `Arbor::from_inmemory()`

```bash
# Find test usages
grep -r "InMemoryArbor" crates/arbors/tests/
grep -r "InMemoryArbor" python/tests/
```

### Task 4: Doc updates (if needed)

Review and update any documentation that references old names:
- `ArborView` → `TabularView` in doc comments
- Any remaining references to `query()` or `execute()` → `plan()` / `collect()`

### Verification

```bash
# Rust tests
cargo nextest run -p arbors

# Python tests
just python-test

# Check for stale references
grep -r "ArborView" crates/ --include="*.rs" | grep -v "TabularView"
grep -r "PlanBasedIter" crates/ --include="*.rs"
grep -r "InMemoryArbor" crates/arbors/src/lib.rs
```

---

## Sub-phase 23f: Write Examples

### Directory Structure
```
crates/arbors/examples/     # Rust examples
python/examples/            # Python examples (existing dir)
```

### Rust Examples (`crates/arbors/examples/`)

| File | Topic | Dataset |
|------|-------|---------|
| `01_basic_parsing.rs` | read_json, read_jsonl, field access | inline data |
| `02_filtering_sorting.rs` | filter, sort_by, head/tail | news.jsonl |
| `03_aggregations.rs` | aggregate, group_by | news.jsonl |
| `04_explode_transform.rs` | explode, select, add_field | news.jsonl |
| `05_plan_optimization.rs` | plan().filter().collect(), explain | github events |
| `06_persistence.rs` | Session, store, transaction | users.jsonl |

### Python Examples (`python/examples/`)

| File | Topic | Dataset |
|------|-------|---------|
| `dataset_read_basics.py` | Parse, iterate, filter, aggregate | news.jsonl |
| `dataset_explode_filter.py` | Explode, filter pushdown | news.jsonl |
| `dataset_plan_pipeline.py` | plan/collect, explain | github events |
| `arborbase_read.py` | ArborStore open, list, snapshot | multiple |
| `arborbase_write.py` | Transaction, store, refresh | users.jsonl |
| `dataset_arrow_export.py` | to_arrow, to_parquet | products |

### Cargo.toml Addition
```toml
[[example]]
name = "01_basic_parsing"
path = "examples/01_basic_parsing.rs"
# ... etc
```

### Justfile Addition
```just
run-rust-examples:
    cargo run --example 01_basic_parsing
    cargo run --example 02_filtering_sorting
    # ...
```

---

## Implementation Order

1. **23a**: Rename plan API
   - Step 0: Rename internal plan structs:
     - `QueryPlan` → `LogicalPlan`
     - `TreePlan` → `TreeLogicalPlan`
   - Step 1: Rename `Arbor::plan()` → `Arbor::inner()` (fix collision)
   - Step 2: Rename `lazy.rs` → `plan.rs`
   - Step 3: Rename `ArborQuery` → `ArborPlan`, `execute()` → `collect()`, etc.
   - Step 4: Rename Tree API (in `lazy_tree.rs`):
     - `TreeQuery` → `TreePlan` (builder)
     - `TreeQuery::plan()` → `TreePlan::inner()` (accessor)
     - `TreeQuery::execute()` → `TreePlan::collect()`
   - Step 5: Update Python bindings (both Arbor and Tree)

2. **23b**: Plan for all arbors
   - `ArborPlan` holds `Arbor` reference
   - `collect()` materializes and returns `Arbor` handle

3. **23c**: Remove mode knobs
   - Make `FilterMode`/`TransformMode` `pub(crate)`
   - Remove mode params from public methods
   - Update Python bindings

4. **23d**: Write-back API
   - Add `Transaction::put_arbor()` with error mapping
   - Add `Session::store()` convenience
   - Add Python bindings

5. **23e**: Update straggling names and docs
   - Rename `PlanBasedIter` → `TreeIter`
   - Rename `ArborView` → `TabularView`
   - Remove `InMemoryArbor` from public re-exports
   - Update documentation

6. **23f**: Write examples
   - 6 Rust examples
   - 6 Python examples

---

## Verification

After each sub-phase:
```bash
cargo nextest run -p arbors --lib --tests
just python-test
```

Final:
```bash
just ci
```

---

## Critical Files Summary

**Rust internal plan structs (modify):**
- `crates/arbors-planner/src/plan.rs` - rename `QueryPlan` → `LogicalPlan`
- `crates/arbors-planner/src/lib.rs` - update re-exports

**Rust Arbor API (modify):**
- `crates/arbors/src/handle/mod.rs` - rename `plan()` → `inner()`, add new `plan()`
- `crates/arbors/src/lazy.rs` → `plan.rs`
- `crates/arbors/src/lib.rs`
- `crates/arbors/src/handle/filter.rs`
- `crates/arbors/src/handle/transform.rs`
- `crates/arbors/src/scope.rs`
- `crates/arbors/src/session.rs`

**Rust Tree API (modify):**
- `crates/arbors-planner/src/lazy_tree.rs` - rename `TreePlan` → `TreeLogicalPlan`, `TreeQuery` → `TreePlan`
- `crates/arbors/tests/integration/pipeline/lazy_tree_integration.rs` - update test usages

**Python (modify):**
- `python/src/lib.rs` - both `ArborQuery` and `TreeQuery` renames
- `python/arbors/_arbors.pyi`
- `python/tests/test_transform_mode.py`

**New files:**
- `crates/arbors/examples/*.rs` (6 files)
- `python/examples/*.py` (6 new files)

---

## Previously Blocked Tasks (Now Resolved)

### Remove InMemoryArbor from re-exports

**Status:** UNBLOCKED - integrated into Sub-phase 23e

**Resolution:** Sub-phase 23d added `Transaction::put_arbor()` and `Session::store()`. Tests can now use the public API for storage operations. The removal of `InMemoryArbor` from public re-exports is now part of Sub-phase 23e (Task 3).
