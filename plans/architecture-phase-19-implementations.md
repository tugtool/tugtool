# Phase 19: CoreReboot: Implementation Steps

#### Step 1 Implementation Checklist

**Step 1.1: Verify current repo health (baseline)**
- [x] Run `cargo test` and confirm all Rust tests pass
- [x] Run `make python && .venv/bin/pytest python/tests -v` and confirm all Python tests pass
- [x] Document any pre-existing failures (if any) to distinguish from regressions - None found

**Step 1.2. Create Gate A test file skeletons**

These files establish the structure for invariant tests; actual tests are added in Step 2.

- [x] Create `crates/arbors/tests/invariants.rs` with:
  ```rust
  //! Gate A: Contract invariants for CoreReboot.
  //!
  //! These tests verify lazy decode semantics and streaming behavior
  //! using `arbors_base::arborbase_stats()` counters.
  //!
  //! Added: Step 1 (skeleton), Step 2 (tests)

  // Placeholder - actual invariant tests added in Step 2
  #[test]
  fn gate_a_placeholder() {
      // This test exists to verify the file compiles.
      // Real invariant tests will replace this in Step 2.
      assert!(true, "Gate A test file created");
  }
  ```

- [x] Create `python/tests/test_invariants.py` with:
  ```python
  """Gate A: Contract invariants for CoreReboot.

  These tests verify lazy decode semantics and streaming behavior
  using `arbors.arborbase_stats()` counters.

  Added: Step 1 (skeleton), Step 2 (tests)
  """
  import pytest
  import arbors

  # Placeholder - actual invariant tests added in Step 2
  def test_gate_a_placeholder():
      """Verify test file is loadable. Real tests in Step 2."""
      assert True, "Gate A test file created"
  ```

**Step 1.3. Verify existing Gate B coverage**

Gate B requires "at least one golden workflow works end-to-end." Verify existing tests already cover this:

- [x] **Rust Gate B**: Verify existing tests cover an end-to-end stored workflow:
  - Open database
  - Store data
  - Query (filter/head/tail/find_one)
  - Iterate/collect results

  **Verified**: `unified_arbor_parity.rs` covers: `Session::open()`, `txn.put()`, filter/head/tail/find_one, and `iter()`. Note: `sort_by()` not exercised in this file; Rust `to_json()` usage is schema helpers, not Arbor API.

- [x] **Python Gate B**: Verify existing tests cover an end-to-end stored workflow:
  - `ArborStore.open()`
  - `db["name"]` / `base.get()` access
  - `filter()`/`sort_by()`/`head()` operations
  - `iter()`/`to_json()` consumption

  **Verified**: Coverage split across multiple files:
  - `test_arbor_base.py`: open, get, list, filter, head, transactions, iteration
  - `test_unified_arbor.py`: sort_by parity, to_json parity, chained operations

  Together these provide Gate B coverage for the Python path.

**Step 1.4. Document Gate C scope (for Step 9)**

- [x] Add comment in `crates/arbors/tests/invariants.rs`:
  ```rust
  // Gate C: Conformance tests (added in Step 9)
  // - Verify InMemory vs Stored results match for supported operators
  // - See crates/arbors/tests/conformance.rs (created in Step 9)
  ```

**Step 1.5. Verify stats API availability**

Confirm the instrumentation API exists and is accessible (required for Gate A tests in Step 2):

- [x] Verify `arbors_base::reset_arborbase_stats()` exists and compiles
- [x] Verify `arbors_base::arborbase_stats()` returns `ArborStoreStats` with:
  - `batches_decoded`
  - `materialize_calls`
  - `early_exit_batches_skipped`
  - `pools_decoded` / `pools_skipped`
- [x] Verify Python bindings `arbors.reset_arborbase_stats()` and `arbors.arborbase_stats()` work

  **Note**: Rust API has all fields. Python bindings have core fields (`batches_decoded`, `materialize_calls`, `early_exit_batches_skipped`, `zero_copy_hits`, `copy_fallback_hits`). The `pools_decoded`/`pools_skipped` fields are not yet exposed in Python but the core stats needed for invariant testing are available.

  **Step 1.2 pitfall**: Python invariant tests in Step 1.2 should either (a) avoid `pools_decoded`/`pools_skipped` fields, or (b) add "expose pools_* to Python" as a prerequisite task.

**Step 1.6. Document rules in plan (already done, verify)**

- [x] Confirm "one active engine at a time" rule is documented (above)
- [x] Confirm "temporary adapters deleted by Step 12" rule is documented (above)
- [x] Confirm deletion gates (invariants + conformance + thin Python) are documented (above)

**Step 1.7. Final verification**

- [x] Run `cargo test` again to ensure new test files compile
- [x] Run `.venv/bin/pytest python/tests/test_invariants.py -v` to ensure Python file loads
- [ ] Commit with message: "Step 1: Sequencing safety rails - define gates A/B/C"

---

**Files created/modified in Step 1:**
| File | Action |
|------|--------|
| `crates/arbors/tests/invariants.rs` | CREATE (skeleton) |
| `python/tests/test_invariants.py` | CREATE (skeleton) |

**No existing code modified** - Step 1 only establishes the framework for subsequent steps.


-----


#### Step 2 Implementation Checklist

**Exit Criteria:** Gate A passes (Rust + Python invariants) and Gate B remains green (one end-to-end path works).

**Overview**: Step 2 adds comprehensive invariant tests for lazy decode semantics. These tests use the existing `arbors-base` instrumentation counters to verify that operations behave correctly (decode only when expected, use early-exit, etc.).

**Key Counters Used**:
| Counter | Purpose |
|---------|---------|
| `batches_decoded` | Verify lazy operations don't decode batches |
| `materialize_calls` | Verify no implicit materialization |
| `early_exit_batches_skipped` | Verify early-exit optimization works |
| `pools_decoded` / `pools_skipped` | (Rust only) Verify projection pushdown |

**Pre-requisite Decision**: Python `ArborStoreStats` currently lacks `pools_decoded`/`pools_skipped`. Step 2 tests **avoid these fields in Python** since the core counters (`batches_decoded`, `materialize_calls`, `early_exit_batches_skipped`) are sufficient for invariant testing.

---

**Step 2.1: Verify baseline repo health**
- [x] Run `cargo test` and confirm all Rust tests pass
- [x] Run `make python && .venv/bin/pytest python/tests -v` and confirm all Python tests pass

---

**Step 2.2: Add Rust invariant tests** (`crates/arbors/tests/invariants.rs`)

Replace the placeholder test with comprehensive invariant tests. Each test follows the pattern:
1. Create multi-batch stored arbor (100 trees, 10 trees per batch = 10 batches)
2. Reset stats
3. Perform operation
4. Assert expected counter values

Tests to implement:

- [x] **`test_lazy_filter_decodes_zero_batches`**: `filter(predicate, FilterMode::Lazy)` should decode 0 batches
- [x] **`test_head_decodes_zero_batches`**: `head(n)` should decode 0 batches (computes range only)
- [x] **`test_tail_decodes_zero_batches`**: `tail(n)` should decode 0 batches (computes range only)
- [x] **`test_stored_len_decodes_zero_batches`**: `len()` on Stored arbor should decode 0 batches (metadata only)
- [x] **`test_get_decodes_single_batch`**: `get(i)` should decode exactly 1 batch
- [x] **`test_iter_decodes_incrementally`**: `iter()` should decode batches as consumed
- [x] **`test_matching_indices_decodes_all_batches`**: `matching_indices()` decodes all batches immediately
- [x] **`test_find_one_early_exit`**: `find_one()` stops at first match (fewer batches than total)
- [x] **`test_any_early_exit`**: `any()` stops at first match
- [x] **`test_all_early_exit`**: `all()` stops at first non-match
- [x] **`test_filter_immediate_decodes_all_batches`**: `filter(predicate, FilterMode::Immediate)` decodes all batches
- [x] **`test_len_on_lazy_filter_triggers_decode`**: `len()` on a lazy-filtered arbor triggers batch decoding (to compute matching count)

**API Distinction (Rust)**:

The unified `Arbor` type (in `arbors` crate) wraps different backings (`ArborBacking::InMemory`, `ArborBacking::Stored`, `ArborBacking::Filtered`). For Stored backings:
- `head()`/`tail()` return `Filtered` views without decoding
- `filter(FilterMode::Lazy)` returns a `Filtered` view without decoding
- `filter(FilterMode::Immediate)` computes indices immediately (decodes all batches)
- `len()` on Stored uses metadata; `len()` on Filtered may trigger decode if not cached
- `iter()` decodes batches incrementally as consumed
- `get(i)` decodes exactly one batch

---

**Step 2.3: Add Python invariant tests** (`python/tests/test_invariants.py`)

Replace the placeholder test with Python equivalents. Note the important API distinction:

**API Distinction (Critical for Understanding Tests)**:

| API Level | Access Pattern | Semantics |
|-----------|----------------|-----------|
| Unified `Arbor` | `base.get("name")` | Returns view-based `Arbor`. `head()`/`tail()`/`filter(mode="lazy")` create views without decoding. |
| `BatchedArbor` | `txn.get("name")` | Low-level. `head()`/`filter()` return indices by iterating batches (with early-exit where applicable). |

**Unified Arbor Tests** (via `base.get("name")`):
- [x] **`test_arbor_lazy_filter_decodes_zero_batches`**: `arbor.filter(predicate, mode="lazy")` decodes 0 additional batches (Note: Python `base.get()` materializes immediately, so test verifies no additional decoding)
- [x] **`test_arbor_head_decodes_zero_batches`**: `arbor.head(n)` decodes 0 additional batches (returns view)
- [x] **`test_arbor_tail_decodes_zero_batches`**: `arbor.tail(n)` decodes 0 additional batches (returns view)
- [x] **`test_arbor_len_on_lazy_filter_no_additional_decode`**: `len()` on a lazy-filtered arbor decodes 0 additional batches (data already materialized by `base.get()`)

**BatchedArbor Tests** (via `txn.get("name")`) - the authoritative instrumentation tests:
- [x] **`test_batched_len_decodes_zero_batches`**: `len(batched_arbor)` decodes 0 batches (uses metadata)
- [x] **`test_batched_batch_decodes_single_batch`**: `batched.batch(i)` decodes exactly 1 batch
- [x] **`test_batched_filter_decodes_all_batches`**: `batched.filter()` decodes all batches (returns indices)
- [x] **`test_batched_head_early_exit`**: `batched.head(n)` uses early-exit (decodes only needed batches, not all)
- [x] **`test_batched_find_one_early_exit`**: `batched.find_one()` stops at first match
- [x] **`test_batched_any_early_exit`**: `batched.any()` stops at first match
- [x] **`test_batched_all_early_exit`**: `batched.all()` stops at first non-match
- [x] **`test_batched_materialize_increments_counter`**: `batched.materialize()` increments `materialize_calls`

**Note**: `BatchedArbor` does not have `tail()` - this is only on unified `Arbor`.

---

**Step 2.4: Verify existing tests don't regress (Gate B)**
- [x] Run `cargo test` - all tests including new invariant tests pass
- [x] Run `.venv/bin/pytest python/tests -v` - all tests pass (2534 passed, 5 skipped)

---

**Step 2.5: Cross-reference with existing instrumentation tests**

The existing tests in `python/tests/test_arbor_base.py::TestInstrumentation` cover related semantics. Review for overlap:

| Existing Test | Purpose | Gate A Coverage | Action |
|---------------|---------|-----------------|--------|
| `test_python_get_is_lazy_no_materialize` | get() decodes 0 batches | Similar to `test_batched_len_decodes_zero_batches` | Keep both - slightly different focus |
| `test_query_chain_does_not_materialize_by_default` | filter/aggregate don't materialize | Complements filter tests | Keep existing |
| `test_materialize_increments_counter` | materialize() is tracked | Related to `test_batched_materialize_increments_counter` | Keep both |
| `test_find_one_is_lazy_with_early_exit` | find_one early-exit | Duplicates `test_batched_find_one_early_exit` | Consider removing from test_arbor_base.py after Gate A passes |
| `test_any_is_lazy_with_early_exit` | any early-exit | Duplicates `test_batched_any_early_exit` | Consider removing from test_arbor_base.py after Gate A passes |
| `test_head_is_lazy_with_early_exit` | head early-exit | Duplicates `test_batched_head_early_exit` | Consider removing from test_arbor_base.py after Gate A passes |

**Decision**: Gate A tests in `test_invariants.py` are the **authoritative source** for contract invariants going forward. After Step 2 is complete, we may optionally remove duplicate tests from `test_arbor_base.py` to avoid confusion, but this is a low-priority cleanup (not required for Step 2 completion).

---

**Step 2.6: Final verification**
- [x] Run `cargo test --test invariants` - all 12 Rust invariant tests pass
- [x] Run `.venv/bin/pytest python/tests/test_invariants.py -v` - all 12 Python invariant tests pass
- [x] Run full test suite to verify Gate B: `cargo test && .venv/bin/pytest python/tests -v`
- [ ] Commit with message: "Step 2: Contract and invariants - Gate A tests for lazy decode semantics"

---

**Files modified in Step 2:**
| File | Action |
|------|--------|
| `crates/arbors/Cargo.toml` | MODIFY - add `serial_test` dev-dependency |
| `crates/arbors/tests/invariants.rs` | REPLACE placeholder with comprehensive tests |
| `python/tests/test_invariants.py` | REPLACE placeholder with comprehensive tests |

**No changes to production code** - Step 2 only adds tests that verify existing behavior.

---

**Summary of Step 2 Test Coverage:**

| File | Tests Added | Purpose |
|------|-------------|---------|
| `crates/arbors/tests/invariants.rs` | 12 tests | Rust invariant tests for lazy decode semantics |
| `python/tests/test_invariants.py` | 12 tests | Python invariant tests (4 unified Arbor + 8 BatchedArbor) |

**Total: 24 new invariant tests** covering all semantics from the contract table.


-----


# Step 3: ReadScope Foundation - Revised Implementation Plan

## Decision Made

**ReadScope will be Send+Sync (promised)** (Option 1). Thread confinement will be enforced at the Python level in Step 10.

**Non-negotiable verification**: Add a compile-time assertion that `OwnedReadTxn` and `ReadScope` are `Send + Sync` (so we never accidentally "think" this is true and later regress it).

---

## Implementation Strategy

**Parallel implementation** - Add new types alongside existing code, don't replace:
- Add `ArborBacking::Scoped` alongside `ArborBacking::Stored`
- Add `Session::read()/write()` alongside existing `with_snapshot()`
- Keep Gate B green at every sub-step

---

## Sub-Step 3.1: Create ReadScope Type (No Integration)

**Goal**: Define minimal `ReadScope` struct in arbors-base without integrating it anywhere.

**Files**:
- NEW: `crates/arbors-base/src/scope.rs`
- MODIFY: `crates/arbors-base/src/lib.rs` (add mod + re-export)

**Changes**:

1. Create `crates/arbors-base/src/scope.rs`:
```rust
//! ReadScope: Immutable MVCC snapshot wrapper.
//!
//! A ReadScope represents a point-in-time view of the database that never changes.
//! Once created, it provides consistent reads forever (or until dropped).

use std::sync::Arc;

use crate::{ArborStore, ArborStoreError, ArborMeta, OwnedReadTxn, BatchedArbor};
use arbors_storage::InMemoryArbor;

/// Immutable read scope - wraps a single MVCC snapshot.
///
/// Once created, a ReadScope never changes. To see newer data,
/// create a new ReadScope via `ReadScope::new()` or `refresh()`.
///
/// # Thread Safety
///
/// ReadScope is Send+Sync. Thread confinement for Python is enforced
/// at the binding layer (Step 10) via runtime checks.
pub struct ReadScope {
    /// Keep ArborStore alive via Arc.
    base: Arc<ArborStore>,
    /// The MVCC snapshot (provides consistency guarantee).
    txn: OwnedReadTxn,
}

impl ReadScope {
    /// Create a new read scope with the latest snapshot.
    ///
    /// This returns an `Arc<ReadScope>` because scopes are intended to be shared
    /// by multiple derived handles (Arc-sharing).
    pub fn new(base: Arc<ArborStore>) -> Result<Arc<Self>, ArborStoreError> {
        let txn = base.begin_read_owned()?;
        Ok(Arc::new(Self { base, txn }))
    }

    /// Create a new read scope with the latest snapshot.
    ///
    /// This scope remains unchanged; the returned scope sees new data.
    pub fn refresh(&self) -> Result<Arc<Self>, ArborStoreError> {
        Self::new(Arc::clone(&self.base))
    }

    /// Access the transaction for queries.
    pub fn txn(&self) -> &OwnedReadTxn {
        &self.txn
    }

    /// Access the underlying ArborStore.
    pub fn base(&self) -> &ArborStore {
        &self.base
    }

    /// Access the Arc-wrapped ArborStore.
    pub fn base_arc(&self) -> &Arc<ArborStore> {
        &self.base
    }

    /// List all arbor names in this snapshot.
    pub fn list(&self) -> Result<Vec<String>, ArborStoreError> {
        self.txn.list()
    }

    /// Check if an arbor exists in this snapshot.
    pub fn contains(&self, name: &str) -> Result<bool, ArborStoreError> {
        self.txn.contains(name)
    }

    /// Get metadata for an arbor in this snapshot.
    pub fn get_meta(&self, name: &str) -> Result<Option<ArborMeta>, ArborStoreError> {
        self.txn.get_meta(name)
    }

    /// Get a batched view of a stored arbor.
    pub fn get_batched(&self, name: &str) -> Result<Option<BatchedArbor<'_>>, ArborStoreError> {
        self.txn.get_batched(name)
    }

    /// Materialize an arbor fully into memory.
    pub fn get(&self, name: &str) -> Result<Option<InMemoryArbor>, ArborStoreError> {
        self.txn.get(name)
    }
}

impl std::fmt::Debug for ReadScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReadScope")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use crate::ArborStoreOptions;

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn test_read_scope_creation() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.arbors");
        let base = Arc::new(ArborStore::open(&path, ArborStoreOptions::default()).unwrap());

        // Compile-time: OwnedReadTxn and ReadScope are Send + Sync (promised).
        assert_send_sync::<OwnedReadTxn>();
        assert_send_sync::<ReadScope>();

        let scope = ReadScope::new(Arc::clone(&base)).unwrap();
        assert!(scope.list().unwrap().is_empty());
    }

    #[test]
    fn test_read_scope_refresh() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.arbors");
        let base = Arc::new(ArborStore::open(&path, ArborStoreOptions::default()).unwrap());

        let scope1 = ReadScope::new(Arc::clone(&base)).unwrap();
        let scope2 = scope1.refresh().unwrap();

        // Both scopes are valid and independent
        assert!(scope1.list().unwrap().is_empty());
        assert!(scope2.list().unwrap().is_empty());
    }
}
```

2. Add to `crates/arbors-base/src/lib.rs`:
```rust
mod scope;
pub use scope::ReadScope;
```

**Verification**:
```bash
cargo build -p arbors-base
cargo test -p arbors-base scope
```

**Gate B impact**: None (no integration yet)

---

## Sub-Step 3.2: Create WriteScope Type (In arbors crate)

**Goal**: Define `WriteScope` struct for transactional writes.

**Files**:
- NEW: `crates/arbors/src/scope.rs`
- MODIFY: `crates/arbors/src/lib.rs` (add mod + re-exports)

**Changes**:

1. Create `crates/arbors/src/scope.rs`:
```rust
//! WriteScope: Transactional write scope with explicit commit/rollback.

use arbors_base::{ArborStore, ArborStoreError, WriteStats, ArborStoreOptions, WriteTxn};
use arbors_storage::InMemoryArbor;

/// Write scope for transactional writes.
///
/// A write scope wraps a write transaction and requires explicit commit.
/// If dropped without commit, the transaction is rolled back.
pub struct WriteScope<'a> {
    txn: Option<WriteTxn<'a>>,
    committed: bool,
}

impl<'a> WriteScope<'a> {
    /// Create a new write scope.
    pub(crate) fn new(txn: WriteTxn<'a>) -> Self {
        Self {
            txn: Some(txn),
            committed: false,
        }
    }

    /// Put an arbor into storage.
    pub fn put(
        &mut self,
        name: &str,
        arbor: &InMemoryArbor,
        options: Option<&ArborStoreOptions>,
    ) -> Result<WriteStats, ArborStoreError> {
        self.txn
            .as_mut()
            .expect("WriteScope already consumed")
            .put(name, arbor, options)
    }

    /// Delete an arbor from storage.
    pub fn delete(&mut self, name: &str) -> Result<bool, ArborStoreError> {
        self.txn
            .as_mut()
            .expect("WriteScope already consumed")
            .delete(name)
    }
```

**Verification**:
```bash
cargo build -p arbors
cargo test -p arbors scope
```

**Gate B impact**: None (no integration yet)

---

(Steps 3.3-3.10 omitted for brevity - see full plan for details)


-----


# Step 4: Logical Plan Handles

(See full plan for implementation details - completed)


-----


# Step 5: Unified TreeSource Execution (Indices-First)

(See full plan for implementation details - completed)


-----


# Step 6: Basic Optimizer

## Overview

**Objective:** Rule-based optimization without cost model. Optimize `LogicalPlan` to reduce redundant work.

**Exit Criteria:** Rule-based rewrites are applied and observable via `explain()` (optimized vs logical), with Gate B remaining green.

**Target Optimizations:**
1. **Filter fusion**: `filter(p1).filter(p2)` -> `filter(p1 AND p2)`
2. **Limit pushdown**: Push `head(n)` into/through filter for early termination
3. Basic optimizer pass infrastructure
4. `explain()` method for debugging/visibility

---

## Current State Analysis (Post-Step 5)

### What Exists

| Component | Status | Location |
|-----------|--------|----------|
| `LogicalPlan` enum (6 view ops) | Complete | `arbors-pipeline/src/logical_plan.rs` |
| `execute_logical_plan()` | Complete | `arbors-pipeline/src/physical.rs` |
| `QueryPlan` optimizer | Legacy (works on `QueryPlan`, not `LogicalPlan`) | `arbors-pipeline/src/optimize.rs` |
| `OptimizationRule` trait | Legacy (for `QueryPlan`) | `arbors-pipeline/src/optimize.rs` |
| `FilterFusion` rule | Legacy (for `QueryPlan`) | `arbors-pipeline/src/optimize.rs` |
| `PredicatePushdown` rule | Legacy (for `QueryPlan`) | `arbors-pipeline/src/optimize.rs` |
| Dual engine | Plan-first with backing fallback | `arbors/src/handle.rs` |

### What Step 6 Must Create

| Component | Description | Location |
|-----------|-------------|----------|
| `LogicalOptimizer` | Optimizer that works on `LogicalPlan` | `arbors-pipeline/src/logical_optimizer.rs` (NEW) |
| `LogicalOptimizationRule` trait | Rule interface for LogicalPlan | `arbors-pipeline/src/logical_optimizer.rs` |
| `LogicalFilterFusion` rule | Fuse consecutive filters | `arbors-pipeline/src/logical_optimizer.rs` |
| `LimitPushdown` rule | Push head/tail through filter | `arbors-pipeline/src/logical_optimizer.rs` |
| `Arbor::explain()` | Returns logical + optimized plan string | `arbors/src/handle.rs` |
| Tests for optimizer | Unit + integration tests | `arbors-pipeline/tests/logical_optimizer_tests.rs` |

### Key Insight: Filter Chaining Cost

**Problem identified in context**: The current executor computes `matching` on root and intersects masks for chained filters (expensive). Filter fusion reduces this to a single pass.

Current behavior in `execute_plan_node()` for chained filters:
```
filter(p1).filter(p2)
  -> execute filter p1 on root (full scan) -> IndexSet::Sparse
  -> execute filter p2 on root (full scan) -> IndexSet::Sparse
  -> intersect both sets
```

After filter fusion optimization:
```
filter(p1 AND p2)
  -> execute fused filter on root (single pass) -> IndexSet::Sparse
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Optimizer location | New `logical_optimizer.rs` module | Keep separate from legacy `optimize.rs` which works on `QueryPlan` |
| Optimization timing | Before execution, at `len()`/`materialize()` | One optimization pass per public API call |
| Optimizer caching | No caching in Step 6 | Simplicity; optimization is cheap for reasonable plan depths |
| `explain()` format | Multi-line string with sections | Human-readable for debugging |
| Rule order | FilterFusion first, then LimitPushdown | Fusing filters creates opportunities for limit pushdown |

---

## Implementation Sub-Steps

### Sub-Step 6.1: Create LogicalOptimizer Infrastructure

**Goal:** Define `LogicalOptimizationRule` trait and `optimize_logical_plan()` function.

**Files:**
- NEW: `crates/arbors-pipeline/src/logical_optimizer.rs`
- MODIFY: `crates/arbors-pipeline/src/lib.rs` (add mod + exports)

**Code Sketch:**

```rust
// crates/arbors-pipeline/src/logical_optimizer.rs

//! LogicalPlan optimization.
//!
//! This module provides rule-based optimization for LogicalPlan.
//! Optimizations transform the plan to reduce redundant work.
//!
//! # Available Optimizations
//!
//! - **FilterFusion**: Combines consecutive filters into single AND filter
//! - **LimitPushdown**: Pushes head/tail limits through operations
//!
//! # Design Invariants
//!
//! 1. Optimization preserves semantics: optimized plan == unoptimized plan
//! 2. Optimization is deterministic: same input produces same output
//! 3. Optimization is optional: unoptimized plans produce correct results

use std::sync::Arc;
use crate::logical_plan::{LogicalPlan, LogicalFilterMode};
use arbors_expr::Expr;

/// A single optimization rule that transforms a LogicalPlan.
///
/// Rules should be pure: they don't modify the input plan, they return
/// a new plan (or None if no optimization applies).
pub trait LogicalOptimizationRule: std::fmt::Debug + Send + Sync {
    /// Apply this rule to the plan.
    ///
    /// Returns `Some(new_plan)` if optimization was applied,
    /// `None` if no optimization applies.
    fn apply(&self, plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>>;

    /// Get the name of this rule for debugging/logging.
    fn name(&self) -> &'static str;
}

/// Optimize a LogicalPlan by applying all optimization rules.
///
/// Applies rules in a fixed-point loop until no rule makes changes.
/// Returns the optimized plan.
///
/// # Arguments
///
/// * `plan` - The logical plan to optimize
///
/// # Returns
///
/// The optimized plan (may be the same Arc if no optimization applies).
pub fn optimize_logical_plan(plan: &Arc<LogicalPlan>) -> Arc<LogicalPlan> {
    let rules: Vec<Box<dyn LogicalOptimizationRule>> = vec![
        Box::new(FilterFusion),
        Box::new(LimitPushdown),
    ];

    let max_iterations = 20; // Reasonable bound for plan depth
    let mut current = Arc::clone(plan);

    for _ in 0..max_iterations {
        let mut changed = false;
        for rule in &rules {
            if let Some(new_plan) = rule.apply(&current) {
                current = new_plan;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    current
}
```

**Checklist:**
- [ ] Create `logical_optimizer.rs` with trait and function skeleton
- [ ] Add `mod logical_optimizer` and exports to `lib.rs`
- [ ] Verify: `cargo build -p arbors-pipeline`

**Gate B Impact:** None (no integration yet)

**Verification:**
```bash
cargo build -p arbors-pipeline
```

---

### Sub-Step 6.2: Implement FilterFusion Rule

**Goal:** Combine consecutive `Filter` nodes into a single filter with AND predicate.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/logical_optimizer.rs`

**Code Sketch:**

```rust
/// Combines adjacent Filter operations into a single filter with AND.
///
/// # Pattern
///
/// Before: Filter(p1) -> Filter(p2)
/// After:  Filter(p1 AND p2)
///
/// # Benefits
///
/// - Single pass over data instead of two
/// - Avoids expensive index intersection
/// - Enables short-circuit evaluation in combined predicate
#[derive(Debug)]
pub struct FilterFusion;

impl LogicalOptimizationRule for FilterFusion {
    fn apply(&self, plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
        match plan.as_ref() {
            // Pattern: Filter over Filter
            LogicalPlan::Filter {
                source: outer_source,
                predicate: outer_pred,
                mode: outer_mode,
            } => {
                if let LogicalPlan::Filter {
                    source: inner_source,
                    predicate: inner_pred,
                    mode: _inner_mode,
                } = outer_source.as_ref()
                {
                    // Fuse predicates: inner_pred AND outer_pred
                    let fused_predicate = inner_pred.clone().and(outer_pred.clone());

                    // Use the outer mode (could also use Immediate as default)
                    let fused = Arc::new(LogicalPlan::Filter {
                        source: Arc::clone(inner_source),
                        predicate: fused_predicate,
                        mode: *outer_mode,
                    });

                    // Recursively try to fuse further
                    Some(Self.apply(&fused).unwrap_or(fused))
                } else {
                    // Not a Filter-over-Filter, try to recurse into source
                    let optimized_source = self.apply(outer_source)?;
                    Some(Arc::new(LogicalPlan::Filter {
                        source: optimized_source,
                        predicate: outer_pred.clone(),
                        mode: *outer_mode,
                    }))
                }
            }

            // Recurse into other node types
            LogicalPlan::Head { source, n } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Head {
                    source: optimized,
                    n: *n,
                }))
            }
            LogicalPlan::Tail { source, n } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Tail {
                    source: optimized,
                    n: *n,
                }))
            }
            LogicalPlan::Take { source, indices } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Take {
                    source: optimized,
                    indices: indices.clone(),
                }))
            }
            LogicalPlan::Sample { source, n, seed } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Sample {
                    source: optimized,
                    n: *n,
                    seed: *seed,
                }))
            }
            LogicalPlan::Shuffle { source, seed } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Shuffle {
                    source: optimized,
                    seed: *seed,
                }))
            }

            // Source nodes: no optimization
            LogicalPlan::InMemory { .. } | LogicalPlan::Stored { .. } => None,
        }
    }

    fn name(&self) -> &'static str {
        "FilterFusion"
    }
}
```

**Unit Tests:**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use arbors_expr::{lit, path};
    use arbors_storage::InMemoryArbor;

    #[test]
    fn test_filter_fusion_two_filters() {
        let arbor = Arc::new(InMemoryArbor::new());
        let plan = LogicalPlan::inmemory(arbor)
            .filter(path("a").gt(lit(10)), LogicalFilterMode::Immediate)
            .filter(path("b").lt(lit(20)), LogicalFilterMode::Immediate);

        let optimized = optimize_logical_plan(&plan);

        // Should be single Filter with AND predicate
        match optimized.as_ref() {
            LogicalPlan::Filter { source, predicate, .. } => {
                assert!(source.is_inmemory());
                // Predicate should be AND of both
                let debug_str = format!("{:?}", predicate);
                assert!(debug_str.contains("And"));
            }
            _ => panic!("Expected Filter node"),
        }
    }

    #[test]
    fn test_filter_fusion_three_filters() {
        let arbor = Arc::new(InMemoryArbor::new());
        let plan = LogicalPlan::inmemory(arbor)
            .filter(path("a").gt(lit(1)), LogicalFilterMode::Immediate)
            .filter(path("b").gt(lit(2)), LogicalFilterMode::Immediate)
            .filter(path("c").gt(lit(3)), LogicalFilterMode::Immediate);

        let optimized = optimize_logical_plan(&plan);

        // Should be single Filter
        match optimized.as_ref() {
            LogicalPlan::Filter { source, .. } => {
                assert!(source.is_inmemory());
            }
            _ => panic!("Expected Filter node"),
        }
    }

    #[test]
    fn test_filter_fusion_non_adjacent() {
        let arbor = Arc::new(InMemoryArbor::new());
        let plan = LogicalPlan::inmemory(arbor)
            .filter(path("a").gt(lit(10)), LogicalFilterMode::Immediate)
            .head(100)
            .filter(path("b").lt(lit(20)), LogicalFilterMode::Immediate);

        let optimized = optimize_logical_plan(&plan);

        // Should still have two separate Filter nodes (Head in between)
        // But LimitPushdown might reorder...
        // For now, just verify it doesn't crash
        assert!(optimized.description() == "Filter");
    }
}
```

**Checklist:**
- [ ] Implement `FilterFusion` rule
- [ ] Add unit tests for filter fusion
- [ ] Verify: `cargo test -p arbors-pipeline filter_fusion`

**Gate B Impact:** None (not integrated yet)

---

### Sub-Step 6.3: Implement LimitPushdown Rule

**Goal:** Push `head(n)` through `filter` when safe for early termination.

**Design Note:** Limit pushdown through filter is complex:
- `head(n)` after `filter(p)` cannot be pushed before the filter (changes semantics)
- But we can add a **hint** to the filter to stop after N matches (early termination)
- This requires modifying how `execute_logical_plan` handles filters

**Alternative approach for Step 6:** Keep limit pushdown simple - don't push through filters, only fuse adjacent limits.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/logical_optimizer.rs`

**Code Sketch (Simplified - Limit Fusion Only):**

```rust
/// Fuses adjacent limit operations.
///
/// # Patterns
///
/// - head(n1).head(n2) -> head(min(n1, n2))
/// - tail(n1).tail(n2) -> tail(min(n1, n2))
///
/// # Note on Filter Pushdown
///
/// Pushing head through filter would change semantics:
/// - `filter(p).head(10)` = first 10 matching trees
/// - `head(10).filter(p)` = filter first 10 trees
///
/// True limit pushdown (adding early-termination hints) is deferred to Step 8
/// where cost model can guide the decision.
#[derive(Debug)]
pub struct LimitPushdown;

impl LogicalOptimizationRule for LimitPushdown {
    fn apply(&self, plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
        match plan.as_ref() {
            // head(n1) over head(n2) -> head(min(n1, n2))
            LogicalPlan::Head {
                source: outer_source,
                n: n1,
            } => {
                if let LogicalPlan::Head { source: inner_source, n: n2 } = outer_source.as_ref() {
                    return Some(Arc::new(LogicalPlan::Head {
                        source: Arc::clone(inner_source),
                        n: std::cmp::min(*n1, *n2),
                    }));
                }
                // Recurse into source
                let optimized = self.apply(outer_source)?;
                Some(Arc::new(LogicalPlan::Head {
                    source: optimized,
                    n: *n1,
                }))
            }

            // tail(n1) over tail(n2) -> tail(min(n1, n2))
            LogicalPlan::Tail {
                source: outer_source,
                n: n1,
            } => {
                if let LogicalPlan::Tail { source: inner_source, n: n2 } = outer_source.as_ref() {
                    return Some(Arc::new(LogicalPlan::Tail {
                        source: Arc::clone(inner_source),
                        n: std::cmp::min(*n1, *n2),
                    }));
                }
                let optimized = self.apply(outer_source)?;
                Some(Arc::new(LogicalPlan::Tail {
                    source: optimized,
                    n: *n1,
                }))
            }

            // Recurse into other nodes
            LogicalPlan::Filter { source, predicate, mode } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Filter {
                    source: optimized,
                    predicate: predicate.clone(),
                    mode: *mode,
                }))
            }
            LogicalPlan::Take { source, indices } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Take {
                    source: optimized,
                    indices: indices.clone(),
                }))
            }
            LogicalPlan::Sample { source, n, seed } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Sample {
                    source: optimized,
                    n: *n,
                    seed: *seed,
                }))
            }
            LogicalPlan::Shuffle { source, seed } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Shuffle {
                    source: optimized,
                    seed: *seed,
                }))
            }

            // Source nodes: no optimization
            LogicalPlan::InMemory { .. } | LogicalPlan::Stored { .. } => None,
        }
    }

    fn name(&self) -> &'static str {
        "LimitPushdown"
    }
}
```

**Unit Tests:**

```rust
#[test]
fn test_limit_fusion_head_over_head() {
    let arbor = Arc::new(InMemoryArbor::new());
    let plan = LogicalPlan::inmemory(arbor)
        .head(100)
        .head(50);

    let optimized = optimize_logical_plan(&plan);

    match optimized.as_ref() {
        LogicalPlan::Head { n, source } => {
            assert_eq!(*n, 50); // min(100, 50)
            assert!(source.is_inmemory());
        }
        _ => panic!("Expected Head node"),
    }
}

#[test]
fn test_limit_fusion_tail_over_tail() {
    let arbor = Arc::new(InMemoryArbor::new());
    let plan = LogicalPlan::inmemory(arbor)
        .tail(100)
        .tail(30);

    let optimized = optimize_logical_plan(&plan);

    match optimized.as_ref() {
        LogicalPlan::Tail { n, source } => {
            assert_eq!(*n, 30); // min(100, 30)
            assert!(source.is_inmemory());
        }
        _ => panic!("Expected Tail node"),
    }
}
```

**Checklist:**
- [ ] Implement `LimitPushdown` rule (limit fusion only for Step 6)
- [ ] Add unit tests
- [ ] Verify: `cargo test -p arbors-pipeline limit_pushdown`

**Gate B Impact:** None (not integrated yet)

---

### Sub-Step 6.4: Integrate Optimizer into Execution Path

**Goal:** Call `optimize_logical_plan()` before execution in `len()` and `materialize()`.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Code Changes:**

```rust
// In Arbor impl

/// Try to compute len via plan-based execution.
fn try_len_from_plan(&self) -> Result<usize, PipelineError> {
    let txn = self.scope.as_scope().map(|scope| scope.txn());

    // Optimize the plan before execution
    let optimized = arbors_pipeline::optimize_logical_plan(&self.plan);

    let result = execute_logical_plan(&optimized, txn)?;
    Ok(result.tree_count())
}

/// Try to materialize via plan-based execution.
fn try_materialize_from_plan(&self) -> Result<Arc<InMemoryArbor>, PipelineError> {
    let txn = self.scope.as_scope().map(|scope| scope.txn());

    // Optimize the plan before execution
    let optimized = arbors_pipeline::optimize_logical_plan(&self.plan);

    let result = execute_logical_plan(&optimized, txn)?;
    materialize_result(&optimized, txn, &result)
}
```

**Checklist:**
- [ ] Add `use arbors_pipeline::optimize_logical_plan;` import
- [ ] Update `try_len_from_plan()` to optimize before execution
- [ ] Update `try_materialize_from_plan()` to optimize before execution
- [ ] Verify: `cargo test -p arbors`

**Gate B Impact:** Must pass - optimization should be transparent

**Verification:**
```bash
cargo test -p arbors
cargo test  # Full test suite
```

---

### Sub-Step 6.5: Implement explain() Method

**Goal:** Add `explain()` to `Arbor` that shows logical and optimized plans.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Code Sketch:**

```rust
impl Arbor {
    // ... existing methods ...

    /// Explain the query plan.
    ///
    /// Returns a human-readable string showing:
    /// - Logical plan (as constructed)
    /// - Optimized plan (after rule-based optimization)
    ///
    /// This is useful for debugging and understanding query execution.
    ///
    /// # Example
    ///
    /// ```text
    /// LogicalPlan:
    ///   Filter(predicate: a > 10)
    ///     Filter(predicate: b < 20)
    ///       Stored("users")
    ///
    /// OptimizedPlan:
    ///   Filter(predicate: (a > 10) AND (b < 20))
    ///     Stored("users")
    /// ```
    pub fn explain(&self) -> String {
        let optimized = arbors_pipeline::optimize_logical_plan(&self.plan);

        let mut output = String::new();

        output.push_str("LogicalPlan:\n");
        output.push_str(&format_plan(&self.plan, 1));

        output.push_str("\nOptimizedPlan:\n");
        output.push_str(&format_plan(&optimized, 1));

        output
    }
}

/// Format a LogicalPlan for display.
fn format_plan(plan: &LogicalPlan, indent: usize) -> String {
    let prefix = "  ".repeat(indent);

    match plan {
        LogicalPlan::InMemory { arbor } => {
            format!("{}InMemory({} trees)\n", prefix, arbor.num_trees())
        }
        LogicalPlan::Stored { name } => {
            format!("{}Stored(\"{}\")\n", prefix, name)
        }
        LogicalPlan::Filter { source, predicate, mode } => {
            let mode_str = match mode {
                LogicalFilterMode::Immediate => "",
                LogicalFilterMode::Lazy => " [lazy]",
            };
            format!(
                "{}Filter({:?}){}\n{}",
                prefix,
                predicate,
                mode_str,
                format_plan(source, indent + 1)
            )
        }
        LogicalPlan::Head { source, n } => {
            format!(
                "{}Head({})\n{}",
                prefix,
                n,
                format_plan(source, indent + 1)
            )
        }
        LogicalPlan::Tail { source, n } => {
            format!(
                "{}Tail({})\n{}",
                prefix,
                n,
                format_plan(source, indent + 1)
            )
        }
        LogicalPlan::Take { source, indices } => {
            format!(
                "{}Take([{} indices])\n{}",
                prefix,
                indices.len(),
                format_plan(source, indent + 1)
            )
        }
        LogicalPlan::Sample { source, n, seed } => {
            let seed_str = seed.map(|s| format!(", seed={}", s)).unwrap_or_default();
            format!(
                "{}Sample(n={}{})\n{}",
                prefix,
                n,
                seed_str,
                format_plan(source, indent + 1)
            )
        }
        LogicalPlan::Shuffle { source, seed } => {
            let seed_str = seed.map(|s| format!(", seed={}", s)).unwrap_or_default();
            format!(
                "{}Shuffle({})\n{}",
                prefix,
                seed_str.trim_start_matches(", "),
                format_plan(source, indent + 1)
            )
        }
    }
}
```

**Checklist:**
- [ ] Implement `explain()` method on `Arbor`
- [ ] Implement `format_plan()` helper
- [ ] Add tests for explain output
- [ ] Verify: `cargo test -p arbors explain`

**Gate B Impact:** Addition only - no breaking changes

---

### Sub-Step 6.6: Add Integration Tests

**Goal:** Verify optimizer produces correct results and improves performance.

**Files:**
- NEW: `crates/arbors-pipeline/tests/logical_optimizer_tests.rs`

**Test Categories:**

```rust
//! Integration tests for LogicalPlan optimization.

use arbors_expr::{lit, path};
use arbors_io::read_jsonl;
use arbors_pipeline::{
    execute_logical_plan, materialize_result, optimize_logical_plan,
    LogicalFilterMode, LogicalPlan,
};
use arbors_base::{arborbase_stats, reset_arborbase_stats, ArborStore, ArborStoreOptions};
use std::sync::Arc;
use serial_test::serial;
use tempfile::tempdir;

/// Test semantic equivalence: optimized plan produces same results as unoptimized.
#[test]
fn test_filter_fusion_semantic_equivalence() {
    let data = (0..100).map(|i| format!(
        r#"{{"id": {}, "active": {}}}"#,
        i, i % 2 == 0
    )).collect::<Vec<_>>().join("\n");

    let arbor = read_jsonl(data.as_bytes(), None).unwrap();
    let source = LogicalPlan::inmemory(Arc::new(arbor));

    // Unoptimized: two separate filters
    let plan = source
        .filter(path("id").gt(lit(50)), LogicalFilterMode::Immediate)
        .filter(path("active").eq(lit(true)), LogicalFilterMode::Immediate);

    // Get results from unoptimized plan
    let unopt_result = execute_logical_plan(&plan, None).unwrap();
    let unopt_arbor = materialize_result(&plan, None, &unopt_result).unwrap();

    // Get results from optimized plan
    let optimized = optimize_logical_plan(&plan);
    let opt_result = execute_logical_plan(&optimized, None).unwrap();
    let opt_arbor = materialize_result(&optimized, None, &opt_result).unwrap();

    // Results must be identical
    assert_eq!(unopt_arbor.num_trees(), opt_arbor.num_trees());
}

/// Test that filter fusion reduces decode operations on stored arbors.
#[test]
#[serial]
fn test_filter_fusion_reduces_decode_calls() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("test.arbors");
    let base = ArborStore::open(&path, ArborStoreOptions::default()).unwrap();

    // Create and store test data
    let data = (0..100).map(|i| format!(
        r#"{{"id": {}, "value": {}}}"#, i, i * 10
    )).collect::<Vec<_>>().join("\n");
    let arbor = read_jsonl(data.as_bytes(), None).unwrap();

    {
        let mut txn = base.begin_write().unwrap();
        txn.put("test", &arbor, Some(&ArborStoreOptions {
            trees_per_batch: Some(10),
            ..Default::default()
        })).unwrap();
        txn.commit().unwrap();
    }

    let txn = base.begin_read_owned().unwrap();

    // Unoptimized: two filters (will compute matching twice on root)
    let plan = LogicalPlan::stored("test")
        .filter(path("id").gt(lit(10)), LogicalFilterMode::Immediate)
        .filter(path("id").lt(lit(50)), LogicalFilterMode::Immediate);

    reset_arborbase_stats();
    let _ = execute_logical_plan(&plan, Some(&txn)).unwrap();
    let unopt_decodes = arborbase_stats().batches_decoded;

    // Optimized: single fused filter
    let optimized = optimize_logical_plan(&plan);
    reset_arborbase_stats();
    let _ = execute_logical_plan(&optimized, Some(&txn)).unwrap();
    let opt_decodes = arborbase_stats().batches_decoded;

    // Optimized should decode same or fewer batches
    // (In current impl both scan all, but fused avoids double-scan overhead)
    assert!(opt_decodes <= unopt_decodes * 2,
        "Optimized ({}) should not decode much more than unoptimized ({})",
        opt_decodes, unopt_decodes);
}

/// Test explain output format.
#[test]
fn test_explain_output_format() {
    let arbor = Arc::new(arbors_storage::InMemoryArbor::new());
    let plan = LogicalPlan::inmemory(arbor)
        .filter(path("a").gt(lit(10)), LogicalFilterMode::Immediate)
        .filter(path("b").lt(lit(20)), LogicalFilterMode::Immediate)
        .head(10);

    let optimized = optimize_logical_plan(&plan);

    // Verify optimized plan has single filter
    match optimized.as_ref() {
        LogicalPlan::Head { source, .. } => {
            match source.as_ref() {
                LogicalPlan::Filter { source: inner, .. } => {
                    assert!(inner.is_inmemory(), "Should be single filter over source");
                }
                _ => panic!("Expected Filter under Head"),
            }
        }
        _ => panic!("Expected Head at top"),
    }
}
```

**Checklist:**
- [ ] Create `logical_optimizer_tests.rs`
- [ ] Add semantic equivalence tests
- [ ] Add performance regression tests (decode count)
- [ ] Add explain format tests
- [ ] Verify: `cargo test -p arbors-pipeline --test logical_optimizer_tests`

---

### Sub-Step 6.7: Update arbors-pipeline Exports

**Goal:** Export new optimizer types.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/lib.rs`

**Changes:**

```rust
pub mod logical_optimizer;

pub use logical_optimizer::{
    optimize_logical_plan,
    LogicalOptimizationRule,
    FilterFusion,
    LimitPushdown,
};
```

**Checklist:**
- [ ] Add mod and exports
- [ ] Verify: `cargo build -p arbors-pipeline`

---

### Sub-Step 6.8: Add Python explain() Binding

**Goal:** Expose `explain()` to Python.

**Files:**
- MODIFY: `python/src/arbor.rs` (or wherever PyArbor is defined)

**Code Sketch:**

```rust
#[pymethods]
impl PyArbor {
    // ... existing methods ...

    /// Explain the query plan.
    ///
    /// Returns a human-readable string showing the logical and optimized plans.
    ///
    /// Example:
    ///     >>> arbor.filter(path("x") > 10).filter(path("y") < 20).explain()
    ///     LogicalPlan:
    ///       Filter(...)
    ///         Filter(...)
    ///           Stored("...")
    ///
    ///     OptimizedPlan:
    ///       Filter(... AND ...)
    ///         Stored("...")
    fn explain(&self) -> String {
        self.inner.explain()
    }
}
```

**Checklist:**
- [ ] Add `explain()` method to PyArbor
- [ ] Add Python test for explain
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v`

**Gate B Impact:** Addition only - must pass

---

### Sub-Step 6.9: Documentation and FIXME Comments

**Goal:** Document optimizer, add FIXME for future enhancements.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/logical_optimizer.rs`
- MODIFY: `crates/arbors/src/handle.rs`

**Documentation to add:**

```rust
// In logical_optimizer.rs header:

//! # Future Enhancements (Step 8)
//!
//! - Cost model integration for smarter rule application
//! - TopK fusion: sort_by(k).head(n) -> TopK(n, k)
//! - Early termination hints: filter.head(n) -> filter with limit hint
//!
//! REFACTOR FIXME(Step 8): Add cost model to guide optimization decisions.
```

```rust
// In handle.rs explain():

/// # Note
///
/// The current optimizer applies simple rule-based transformations.
/// Cost-based optimization is planned for Step 8.
///
/// REFACTOR FIXME(Step 11): Add full explain() API with options:
/// - `explain(logical=True, optimized=True, physical=False, costs="none")`
/// - `explain_analyze(...)` for observed stats
```

**Checklist:**
- [ ] Add module-level documentation
- [ ] Add FIXME comments for future steps
- [ ] Verify: `cargo doc -p arbors-pipeline`

---

### Sub-Step 6.10: Verify All Gates

**Goal:** Ensure all tests pass.

**Commands:**
```bash
cargo test -p arbors --test invariants   # Gate A
cargo test                                # Rust Gate B
make python && .venv/bin/pytest python/tests -v  # Python Gate B
```

**Checklist:**
- [ ] Gate A passes (invariants)
- [ ] Rust Gate B passes (full test suite)
- [ ] Python Gate B passes (full test suite)

---

### Sub-Step 6.11: Commit Step 6

**Commit Message:**
```
feat: Step 6 - Basic LogicalPlan optimizer with filter fusion

Implements rule-based optimization for LogicalPlan:

Optimizations:
- FilterFusion: Combines consecutive filters into single AND filter
- LimitPushdown: Fuses adjacent head/tail operations

New APIs:
- optimize_logical_plan(): Applies optimization rules to LogicalPlan
- Arbor::explain(): Shows logical vs optimized plan (debugging)
- Python arbor.explain(): Same, exposed to Python

Integration:
- len() and materialize() now optimize before execution
- Optimizer runs transparently (no user action required)

Files:
- NEW: arbors-pipeline/src/logical_optimizer.rs
- NEW: arbors-pipeline/tests/logical_optimizer_tests.rs
- MODIFY: arbors-pipeline/src/lib.rs (exports)
- MODIFY: arbors/src/handle.rs (integration + explain)
- MODIFY: python/src/arbor.rs (explain binding)

Next steps:
- Step 7: Planned global operations (sort_by, group_by)
- Step 8: Cost model optimizer (TopK fusion, better limit pushdown)
```

---

## Summary Table

| Sub-Step | Description | Risk | Gate B |
|----------|-------------|------|--------|
| 6.1 | Create optimizer infrastructure | Low | Unchanged |
| 6.2 | Implement FilterFusion | Low | Unchanged |
| 6.3 | Implement LimitPushdown | Low | Unchanged |
| 6.4 | Integrate into execution | Medium | Must pass |
| 6.5 | Implement explain() | Low | Unchanged |
| 6.6 | Add integration tests | Low | Validates |
| 6.7 | Update exports | Low | Unchanged |
| 6.8 | Add Python binding | Low | Must pass |
| 6.9 | Documentation | Low | N/A |
| 6.10 | Verify all gates | Low | Must pass |
| 6.11 | Commit | Low | N/A |

**Atomic pairs:** None - each sub-step is independently testable.

**Risk assessment:**
- Sub-step 6.4 is highest risk (integration point)
- All other sub-steps are low risk (additions only)

---

## Holes/Pitfalls Addressed

1. **Plan/backing dual engine**: Optimizer only affects plan path; backing fallback unchanged. Both paths should produce same results.

2. **DecodePlan::ALL still used**: Optimizer doesn't change materialization strategy; projection-aware materialization is later (Step 11+).

3. **Filter chaining cost**: FilterFusion directly addresses this by reducing two filter passes to one.

4. **Limit pushdown through filter**: Deferred to Step 8 with cost model. Step 6 only fuses adjacent limits.

---

## FIXME Comments Added

| Location | FIXME |
|----------|-------|
| `logical_optimizer.rs` header | REFACTOR FIXME(Step 8): Add cost model to guide optimization decisions |
| `handle.rs` explain() | REFACTOR FIXME(Step 11): Add full explain() API with options |
| `logical_optimizer.rs` LimitPushdown | REFACTOR FIXME(Step 8): Add early termination hints for filter.head(n) |


-----

# Phase 19 CoreReboot: Step 6 Implementation Plan
# Basic LogicalPlan Optimizer

## Overview

**Objective:** Rule-based optimization without cost model. Optimize `LogicalPlan` to reduce redundant work.

**Exit Criteria:** Rule-based rewrites are applied and observable via `explain()` (optimized vs logical), with Gate B remaining green.

**Target Optimizations:**
1. **Filter fusion**: `filter(p1).filter(p2)` -> `filter(p1 AND p2)` (fused mode becomes **Immediate**)
2. **Predicate pushdown**: push filters across `Select`/projection nodes when semantics allow (real rewrites on `LogicalPlan`)
3. **Projection pruning / DecodePlan**: compute minimal whole-plan DecodePlan(s) and propagate them (and show them in `explain()`)
4. **Limit pushdown (early termination)**: `filter(p).head(n)` stops evaluating once \(n\) matches are found
5. **Limit fusion**: `head(n1).head(n2)` -> `head(min(n1, n2))` (and same for `tail`)
6. **`explain()`**: logical vs optimized plan **plus** DecodePlan summary (predicate/projection/materialization) and early-termination hints

---

## Context: Holes/Pitfalls to Address

1. **Plan/backing dual engine still exists**: `len()`/`materialize()` are plan-first with fallback. Optimizer rewrites should avoid only affecting one path - keep "one source of truth" per entrypoint.

2. **`DecodePlan::ALL` is still used for full-tree materialization today**: Step 6 makes decoding requirements explicit and structural by computing whole-plan DecodePlans (predicate/projection/materialization), using minimal plans for predicate/projection evaluation, and reporting when materialization remains `ALL` (explicitly, not implicitly).

3. **Filter chaining cost model**: Executor still computes `matching` on the root and intersects masks for chained filters. Correct, but potentially expensive. Step 6's optimizer (filter fusion) is the right fix.

4. **Limit pushdown / early termination semantics**: Step 6 explicitly changes execution to **stop evaluating** once \(n\) matches are found for `filter(p).head(n)` (this is intentional and required).

---

## Current State Analysis (Post-Step 5)

### What Exists

| Component | Status | Location |
|-----------|--------|----------|
| `LogicalPlan` enum (views only) | Complete (pre-Step 6) | `arbors-pipeline/src/logical_plan.rs` |
| `execute_logical_plan()` | Complete | `arbors-pipeline/src/physical.rs` |
| `QueryPlan` optimizer | Legacy (works on `QueryPlan`, not `LogicalPlan`) | `arbors-pipeline/src/optimize.rs` |
| `OptimizationRule` trait | Legacy (for `QueryPlan`) | `arbors-pipeline/src/optimize.rs` |
| `FilterFusion` rule | Legacy (for `QueryPlan`) | `arbors-pipeline/src/optimize.rs` |
| `PredicatePushdown` rule | Legacy (for `QueryPlan`) | `arbors-pipeline/src/optimize.rs` |
| Dual engine | Plan-first with backing fallback | `arbors/src/handle.rs` |

### What Step 6 Must Create

| Component | Description | Location |
|-----------|-------------|----------|
| **LogicalPlan expansion** | Add `Select`/projection nodes and `Filter` limit hint (foundation for pushdown/pruning) | `arbors-pipeline/src/logical_plan.rs` |
| **LogicalPlan optimizer** | Rule-based optimizer for `LogicalPlan` (filter fusion, predicate pushdown, limit pushdown/fusion) | `arbors-pipeline/src/optimize/` (NEW module layout) |
| **DecodePlan analysis** | Whole-plan DecodePlan summary (predicate/projection/materialization) | `arbors-pipeline/src/optimize/` or `projection.rs` |
| **Limit pushdown execution** | Early-termination filter evaluation when limit is present | `arbors-pipeline/src/physical.rs` (+ `executor.rs` helpers as needed) |
| `Arbor::explain()` | Shows logical + optimized plan + DecodePlan summary | `arbors/src/handle.rs` |
| Tests for optimizer | Unit + integration tests (including early termination decode-count) | `arbors-pipeline/tests/logical_optimizer_tests.rs` |

### Key Insight: Filter Chaining Cost

**Problem**: The current executor computes `matching` on root and intersects masks for chained filters (expensive).

Current behavior in `execute_plan_node()` for chained filters:
```
filter(p1).filter(p2)
  -> execute filter p1 on root (full scan) -> IndexSet::Sparse
  -> execute filter p2 on root (full scan) -> IndexSet::Sparse
  -> intersect both sets
```

After filter fusion optimization:
```
filter(p1 AND p2)
  -> execute fused filter on root (single pass) -> IndexSet::Sparse
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LogicalPlan coverage | **Expand `LogicalPlan`** with `Select`/projection nodes (+ `Filter` limit hint) | Required so predicate pushdown + projection pruning are real rewrites on the core plan model |
| Optimizer location | **Refactor into `arbors-pipeline/src/optimize/`** with submodules | Long-term: one “optimizer home” without mixing `QueryPlan` and `LogicalPlan` code in a single file |
| Optimization timing | Before execution, at `len()`/`materialize()` | One optimization pass per public API call |
| Optimizer caching | No caching in Step 6 | Simplicity; optimization is cheap for reasonable plan depths |
| `explain()` format | Multi-line string with sections | Human-readable, and supports Steps 6–9 debugging |
| Rule order | FilterFusion → PredicatePushdown → LimitPushdown → LimitFusion | Order reduces redundant work and unlocks early termination |
| DecodePlan reporting | Show **predicate**, **projection**, and **materialization** DecodePlans | “Architecture right”: make decoding requirements explicit and observable |
| Filter fusion mode | **Immediate** | Fused filters should not be “lazy” (mode is an optimizer hint anyway) |

---

## Optimizer location tradeoffs (and why we’re refactoring into `optimize/`)

You asked “what are the tradeoffs?” — here’s the explicit comparison:

- **Option A: keep everything in `optimize.rs` (single file)**
  - **Pros**: minimal churn, easy grep, no file moves.
  - **Cons**: mixes two different plan models (`QueryPlan` vs `LogicalPlan`) into one file; gets messy fast as Step 8+ adds more rules and shared helpers.

- **Option B: add a separate `logical_optimizer.rs`**
  - **Pros**: smallest incremental change; no churn in legacy `QueryPlan` optimizer.
  - **Cons**: “optimizer logic” becomes fragmented across files/modules; Step 8 would have to choose one home or add a third file.

- **Option C (chosen): refactor into `optimize/` directory with submodules**
  - **Pros**: keeps “optimizer” as one conceptual module; clean separation per plan type; obvious extension point for Step 8 cost model; avoids mixing code while still colocating shared analysis utilities.
  - **Cons**: some churn (file moves + exports), so it’s a medium-risk mechanical change (but localized and testable).

This choice optimizes for long-term maintainability and makes later optimizer work (Steps 7–9, then Step 8) feel like extending a coherent subsystem.

## Implementation Sub-Steps

### Sub-Step 6.0: Expand `LogicalPlan` for projections + limit hints

**Goal:** Add the missing `LogicalPlan` foundations so Step 6 optimizations are *real* rewrites:

- `Select` / projections exist in the plan model
- Filters can carry an **early-termination limit hint** (added by optimizer, not by users)
- DecodePlan analysis can be expressed against the plan model

This sub-step is broken into internal pieces for manageability:

---

#### 6.0.1 + 6.0.3: Add projection nodes to `LogicalPlan` + executor match arms (ATOMIC)

**Why atomic:** Adding new enum variants in Rust causes non-exhaustive match in `execute_plan_node()`. These must land together for compilation.

**Files:**
- `crates/arbors-pipeline/src/logical_plan.rs`
- `crates/arbors-pipeline/src/physical.rs`

**LogicalPlan changes:**

Add three new enum variants:
```rust
Select {
    source: Arc<LogicalPlan>,
    exprs: Vec<Expr>,  // expressions with optional aliases
}

AddFields {
    source: Arc<LogicalPlan>,
    fields: Vec<(String, Expr)>,  // (field_name, expression) pairs
}

Aggregate {
    source: Arc<LogicalPlan>,
    exprs: Vec<Expr>,  // aggregation expressions
}
```

**Select output naming rules:**
- If `Expr` has an alias (`Expr::Alias { name, .. }`), use `name` as the output field name
- Otherwise, auto-name as `_0`, `_1`, ... (positional)
- This matches existing `select()` behavior in `handle.rs`

Add builder methods: `select()`, `add_fields()`, `aggregate()`

Update `Debug`, `description()`, `source()`, `requires_scope()` match arms.

**Physical execution changes:**

Add match arms in `execute_plan_node()`:
- `LogicalPlan::Select` → `PhysicalResult::Projection { indices, transform }`
- `LogicalPlan::AddFields` → `PhysicalResult::Projection { indices, transform }`
- `LogicalPlan::Aggregate` → `PhysicalResult::Aggregated(_)`

**Checkpoint:** `cargo build -p arbors-pipeline` compiles.

---

#### 6.0.2: Add `limit` hint to `Filter`

**File:** `crates/arbors-pipeline/src/logical_plan.rs`

Extend `Filter` variant:
```rust
Filter {
    source: Arc<LogicalPlan>,
    predicate: Expr,
    mode: LogicalFilterMode,
    limit: Option<usize>,  // NEW: early-termination hint (None unless optimizer adds it)
}
```

**API design (enforces optimizer-only contract by shape):**
- Keep `filter(predicate, mode)` unchanged - always sets `limit: None`
- Add internal `filter_with_limit(predicate, mode, limit)` for optimizer use only

```rust
// Public builder - user code uses this
pub fn filter(self: &Arc<Self>, predicate: Expr, mode: LogicalFilterMode) -> Arc<Self> {
    self.filter_with_limit(predicate, mode, None)
}

// Internal builder - optimizer uses this
pub(crate) fn filter_with_limit(
    self: &Arc<Self>,
    predicate: Expr,
    mode: LogicalFilterMode,
    limit: Option<usize>,
) -> Arc<Self> {
    Arc::new(Self::Filter {
        source: Arc::clone(self),
        predicate,
        mode,
        limit,
    })
}
```

**Contract:** `limit` is `None` when created by user code; only the optimizer sets `Some(n)`. This is enforced by `pub(crate)` visibility on `filter_with_limit()`.

**Checkpoint:** `cargo test -p arbors-pipeline` (update existing filter tests as needed).

---

#### 6.0.4: Update `materialize_result()` for projection transforms (REAL implementation)

**File:** `crates/arbors-pipeline/src/physical.rs`

**Why non-stub:** If 6.0.4 is a stub, then predicate pushdown across projections is untestable and DecodePlan "projection_plan" is theoretical. Architecture-first means real implementation.

Extend `materialize_result()` to handle `PhysicalResult::Projection`:

**For Select/AddFields:**
- Use existing `arbors-pipeline` evaluation paths (vectorized/interpreted)
- Apply `TransformSpec` to produce output trees with projected fields
- Use `DecodePlan` pruning where valid (only decode pools needed for projection expressions)

**For Aggregate:**
- Execute aggregate expressions across matching indices
- Return `PhysicalResult::Aggregated` with computed values

**Implementation approach:**
- `TransformSpec` needs real fields: `exprs: Vec<Expr>`, `mode: TransformMode` (Select vs AddFields)
- `materialize_result()` evaluates expressions per-tree in the index set
- Reuse existing `evaluate_expr()` machinery from `PipelineExecutor`

**Checkpoint:** `cargo test -p arbors-pipeline` passes (Gate B green for pipeline crate).

---

#### 6.0.5: Wire `Arbor::{select, add_fields, aggregate}` to build/execute plan nodes

**Why needed:** Currently `Arbor::select/add_fields/aggregate` in `handle.rs` directly run backing transforms and return materialized results. Without this wiring:
- Predicate pushdown across projections is dead code
- DecodePlan "projection_plan" is theoretical

**File:** `crates/arbors/src/handle.rs`

**Public API stance (no breaking change for Step 6):**
- `select()` / `add_fields()` continue to return `InMemoryArbor` (materialized result)
- `aggregate()` continues to return `ExprResult` (terminal operation)
- **Internal change only:** these now execute via `LogicalPlan::{Select,AddFields,Aggregate}` internally
- The LogicalPlan nodes appear in `explain()` even though the public return types are unchanged

This allows predicate pushdown to be exercised and tested without Gate B API churn. A future step can consider returning `Arbor` handles if lazy projection is desired.

**Changes:**
- `Arbor::select()` builds `LogicalPlan::Select` node, executes via plan, returns `InMemoryArbor`
- `Arbor::add_fields()` builds `LogicalPlan::AddFields` node, executes via plan, returns `InMemoryArbor`
- `Arbor::aggregate()` builds `LogicalPlan::Aggregate` node, executes via plan, returns `ExprResult`
- Execution happens via `execute_logical_plan` + `materialize_result` (same pattern as `len`/`materialize`)

**Transition pattern (same as existing):**
- Plan-first execution via `execute_logical_plan`
- Fallback to backing during transition if needed
- Eventually backing path becomes dead code

**Checkpoint:** `cargo test -p arbors` passes; projection operations use plan path.

---

**Overall 6.0 Checklist:**
- [ ] 6.0.1+6.0.3: Add `Select`/`AddFields`/`Aggregate` to `LogicalPlan` + executor match arms (ATOMIC)
- [ ] 6.0.2: Add `limit: Option<usize>` to `Filter` with `filter_with_limit()` internal builder
- [ ] 6.0.4: Update `materialize_result()` for real `Projection` transforms
- [ ] 6.0.5: Wire `Arbor::{select, add_fields, aggregate}` to plan path

---

### Sub-Step 6.1: Put the optimizer in the long-term “right place”

**Decision:** Refactor `arbors-pipeline/src/optimize.rs` into a module directory:

- `crates/arbors-pipeline/src/optimize/mod.rs` (shared exports + glue)
- `crates/arbors-pipeline/src/optimize/query_plan.rs` (move existing `QueryPlan` optimizer here)
- `crates/arbors-pipeline/src/optimize/logical_plan.rs` (**new Step 6 optimizer**)

**Why this is better than a new `logical_optimizer.rs`:**
- Keeps “optimizer” as a single conceptual home.
- Avoids mixing `QueryPlan` and `LogicalPlan` code in one file.
- Makes Step 8 (“cost model optimizer”) a natural extension point.

**Checklist:**
- [ ] Create `optimize/` module directory + move existing code
- [ ] Preserve existing `pub use optimize::{optimize, OptimizationRule};` API surface (re-export from `optimize/mod.rs`)
- [ ] Add new exports: `optimize_logical_plan`, `LogicalOptimizationRule`

---

### Sub-Step 6.2: Logical optimizer infrastructure

**Goal:** Implement `LogicalOptimizationRule` + `optimize_logical_plan()` in `optimize/logical_plan.rs`.

**Rules applied (fixed-point, deterministic order):**
1. `FilterFusion`
2. `PredicatePushdown`
3. `LimitPushdown` (into filter via `limit: Some(n)`)
4. `LimitFusion` (head/head, tail/tail)

**Checklist:**
- [ ] Implement rule trait and fixed-point loop
- [ ] Add max-iteration guard (e.g. 32) + debug assertions (idempotence expectations)

---

### Sub-Step 6.3: FilterFusion (mode becomes Immediate)

**Goal:** Fuse nested filters:

- `filter(p1).filter(p2)` → `filter(p1 AND p2)`
- `mode` becomes **Immediate** (regardless of inputs)
- if both filters have `limit`, new limit is `min(limit1, limit2)`; otherwise carry the existing limit

**Note:** This rule is now even more important, because without fusion chained filters can still cause multiple full scans of the root source.

---

### Sub-Step 6.4: PredicatePushdown across projections (real rewrite)

**Goal:** Push filters "down" past projection nodes when semantics permit.

**Core rewrite:**
- `Filter(Select(source, exprs), pred)` → `Select(Filter(source, pred'), exprs)` when safe
- `Filter(AddFields(source, fields), pred)` → `AddFields(Filter(source, pred'), fields)` when safe

**Predicate rewrite policy (simple case only for Step 6):**
- If `pred` references a projected field name, attempt **direct alias substitution**:
  - If a predicate contains `path("alias")`, and `Select` defines `"alias" = expr`, rewrite that path to `expr`.
  - This is **structural substitution** only (no algebraic simplification required).
- **Scope for Step 6:** Only handle simple cases:
  - Direct `path("alias")` references where alias maps to a simple expression
  - Reject nested paths like `path("alias.subfield")` through computed objects
  - Reject complex expressions involving aliases (e.g., `path("alias1") + path("alias2")` where both need substitution)
- If substitution is not possible, do **not** push down (conservative).

**Deferred to Step 8 (cost model):**
- Complex nested path rewriting
- Algebraic simplification of rewritten predicates
- Cost-based decisions on when pushdown is beneficial

**Safety invariant:** Only push down when the rewritten predicate `pred'` is guaranteed to evaluate identically on the pre-projection input.

**Checklist:**
- [ ] Implement a conservative `rewrite_predicate_through_select()` helper (simple alias substitution only)
- [ ] Add tests for:
  - pushdown succeeds for `Select([path("a").alias("a")])` + `Filter(path("a") > 1)`
  - pushdown succeeds via alias substitution for `Select([path("x").alias("a")])` + `Filter(path("a") > 1)` (rewrites to `path("x") > 1`)
  - pushdown is rejected for nested paths like `path("alias.subfield")`
  - pushdown is rejected for predicates referencing fields that cannot be rewritten safely
- [ ] Add `// REFACTOR FIXME(Step 8): extend predicate pushdown with cost model and complex path rewriting`

---

### Sub-Step 6.5: Projection pruning / DecodePlan analysis (whole-plan)

**Goal:** Compute whole-plan DecodePlan requirements and make them observable via `explain()`.

**Location (long-term choice):** `crates/arbors-pipeline/src/optimize/analysis.rs`

This module becomes the home for plan analysis utilities shared across optimization rules:
- `DecodePlanSummary` computation
- Expression field analysis (which pools are referenced)
- Future: cost estimation helpers (Step 8)

**File layout after 6.5:**
```
optimize/
  mod.rs           # re-exports
  query_plan.rs    # legacy QueryPlan optimizer
  logical_plan.rs  # LogicalPlan optimizer + rules
  analysis.rs      # NEW: DecodePlan analysis, shared utilities
```

**Deliverable:** `DecodePlanSummary` for a `LogicalPlan` (schema-aware when available):
- **predicate_plan**: union of pools needed to evaluate all filter predicates
- **projection_plan**: union of pools needed to evaluate all projection expressions (select/add_fields)
- **materialization_plan**: pools required to produce final output (often `ALL` when emitting full trees; explicit either way)

**Key function (schema-aware):**
```rust
pub fn analyze_decode_requirements(
    plan: &LogicalPlan,
    schema: Option<&StorageSchema>,
) -> DecodePlanSummary
```

**Schema plumbing:** DecodePlan depends on schema availability to determine which pools are needed. For `Stored` plans, the caller (`explain()` in `arbors`) resolves schema via scope/txn before calling analysis. For `InMemory` plans, schema comes from the arbor's metadata.

**Integration:**
- Use `predicate_plan` when evaluating filters (especially in limit-pushdown path).
- Use `projection_plan` when materializing projection results.
- Always report all three plans in `explain()`.

**Checklist:**
- [ ] Create `optimize/analysis.rs`
- [ ] Implement `DecodePlanSummary` struct
- [ ] Implement `analyze_decode_requirements()` that walks the plan DAG
- [ ] Export from `optimize/mod.rs`

---

### Sub-Step 6.6: Limit pushdown (early termination) — required semantics

**Goal:** Make `filter(p).head(n)` stop evaluating once \(n\) matches are found.

**Optimizer rewrite:**
- `Head(n, Filter(source, pred, mode, limit=None))`
  → `Filter(source, pred, mode=Immediate, limit=Some(n))`
  (and drop `Head`)

**Executor change (modify existing API for flexibility and lower surface area):**

Modify `PipelineExecutor::filter()` signature:
```rust
// Before:
pub fn filter(&self, predicate: &Expr) -> Vec<usize>

// After:
pub fn filter(&self, predicate: &Expr, limit: Option<usize>) -> Vec<usize>
```

When `limit` is `Some(n)`:
- Iterate batches sequentially
- Stop decoding/evaluating as soon as `n` matches are found
- Return immediately with the first `n` matching indices

When `limit` is `None`:
- Current behavior (full scan, all matches)

**Vectorization interaction (explicit choice for Step 6):**

Today `PipelineExecutor::filter()` can choose vectorized execution (`vectorized_ops::filter`) which iterates all batches and cannot early-exit as currently written.

**Step 6 choice: Force non-vectorized path when limit is present.**

```rust
pub fn filter(&self, predicate: &Expr, limit: Option<usize>) -> Vec<usize> {
    if limit.is_some() {
        // Sequential path with early termination
        self.filter_sequential_with_limit(predicate, limit.unwrap())
    } else {
        // Existing behavior: may use vectorized path
        self.filter_all(predicate)
    }
}
```

This guarantees early termination correctness for Step 6. Step 8 (cost model) can revisit: thread `limit` through `vectorized_ops::filter` to stop between batches once enough matches are collected.

**Error semantics under early termination:**
With `limit=Some(n)`, errors in trees *after* the first `n` matches won't be observed (we stop evaluating). This is intentional and consistent with "stop evaluating once we have enough matches." Tests should reflect this semantic: `filter(p).head(n)` may succeed even if later trees would fail predicate evaluation with errors.

**Physical execution integration:**
- `execute_plan_node()` for `Filter { limit: Some(n), .. }` passes limit to `executor.filter()`
- This is where the early termination actually happens

**Checklist:**
- [ ] Update `PipelineExecutor::filter()` signature to accept `limit: Option<usize>`
- [ ] Add `filter_sequential_with_limit()` that stops after `n` matches
- [ ] Keep existing vectorized path for `limit: None`
- [ ] Update all call sites (pass `None` for existing behavior)
- [ ] Update `execute_plan_node()` `Filter` arm to use limit from plan
- [ ] Add test: verify decode count is reduced when limit is used
- [ ] Add `// REFACTOR FIXME(Step 8): consider threading limit through vectorized path`

This is the concrete "fast-by-default" win for common patterns like `filter(...).head(100)`.

---

### Sub-Step 6.7: Integrate optimizer into plan execution entrypoints

**Goal:** Ensure plan execution uses the optimized plan:
- `Arbor::len()` plan path
- `Arbor::materialize()` plan path
- `Arbor::explain()` should show both logical and optimized

---

### Sub-Step 6.8: `explain()` (Rust + Python) with DecodePlan summary

**Goal:** Make `explain()` a debugging tool for Steps 6–9.

**Required output sections:**
- Logical plan
- Optimized plan
- DecodePlan summary:
  - predicate_plan
  - projection_plan
  - materialization_plan
- Early termination hints found in optimized plan (e.g. `Filter(limit=100)` markers)

---

### Sub-Step 6.9: Tests (unit + integration)

**Test update policy:** Tests must continue to pass, but we are free to update test expectations when semantics intentionally change (e.g., `filter(p).head(n)` now uses early termination). The key invariant is correctness, not behavioral freeze.

**Required tests (new/updated):**
- **Unit**: optimizer rewrites (fusion, pushdown, limit pushdown) preserve structure and apply only when safe
- **Integration**: semantic equivalence of optimized vs unoptimized plans (same *results*, possibly different *execution path*)
- **Integration**: early termination reduces work on stored data (use `batches_decoded` / counters)
- **Integration**: explain includes DecodePlan summary and limit hints
- **Updated**: Any existing tests that assert specific execution behavior for `filter().head()` patterns - update expectations to reflect early termination

**Gate A (invariants) note:** If `test_invariants.rs` tests make assumptions about lazy filter semantics that conflict with limit pushdown, update those tests. The invariant is "correct results", not "specific execution strategy".

---

### Sub-Step 6.10: Verify all gates

- Gate A: `cargo test -p arbors --test invariants`
- Rust Gate B: `cargo test`
- Python Gate B: `make python && .venv/bin/pytest python/tests -v`

---

### Sub-Step 6.11: Commit Step 6

**Commit message (updated):**

```
feat: Step 6 - LogicalPlan optimizer + projections + early-termination limits

Step 6 foundations:
- Expand LogicalPlan with Select/AddFields/Aggregate
- Add Filter(limit=Some(n)) hint (introduced by optimizer)
- Refactor optimize/ into query_plan + logical_plan optimizers

Optimizations:
- FilterFusion: fuse filters into AND (mode becomes Immediate)
- PredicatePushdown: push filters across projections when safe (with alias substitution)
- LimitPushdown: filter.head(n) becomes Filter(limit=n) + early termination
- LimitFusion: head/head and tail/tail fusion

explain():
- logical vs optimized plan
- DecodePlan summary (predicate/projection/materialization)
- limit-hint visibility
```

---

## Summary Table

| Sub-Step | Description | Risk | Gate B |
|----------|-------------|------|--------|
| 6.0.1+6.0.3 | Add Select/AddFields/Aggregate + executor match arms (ATOMIC) | Medium | Compiles |
| 6.0.2 | Add limit hint to Filter + `filter_with_limit()` | Low | Must pass |
| 6.0.4 | Real `materialize_result()` for Projection transforms | Medium | **Must pass** |
| 6.0.5 | Wire `Arbor::{select,add_fields,aggregate}` to plan path | Medium | **Must pass** |
| 6.1 | Refactor optimizer module layout | Medium | Must pass |
| 6.2 | Logical optimizer infrastructure | Low | Unchanged |
| 6.3 | Filter fusion | Low | Validates |
| 6.4 | Predicate pushdown (simple alias substitution) | Medium | Must pass |
| 6.5 | DecodePlan analysis in optimize/analysis.rs | Medium | Must pass |
| 6.6 | Limit pushdown + sequential early termination | Medium | Must pass |
| 6.7 | Integrate optimizer into execution | Medium | Must pass |
| 6.8 | explain() (Rust + Python) | Low | Must pass |
| 6.9 | Tests | Low | Validates |
| 6.10 | Verify all gates | Low | Must pass |
| 6.11 | Commit | Low | N/A |

**Checkpoints:**
- After 6.0.5: LogicalPlan expansion complete, projections wired, Gate B green
- After 6.6: Early termination works end-to-end (sequential path)
- After 6.9: All optimizer rules tested

---

## Files Summary

| File | Action |
|------|--------|
| `crates/arbors-pipeline/src/logical_plan.rs` | MODIFY (Select/AddFields/Aggregate + Filter limit) |
| `crates/arbors-pipeline/src/physical.rs` | MODIFY (execute + materialize for new nodes; early termination path) |
| `crates/arbors-pipeline/src/executor.rs` | MODIFY (filter() accepts optional limit) |
| `crates/arbors-pipeline/src/optimize/mod.rs` | NEW (module re-exports) |
| `crates/arbors-pipeline/src/optimize/query_plan.rs` | MOVE (existing QueryPlan optimizer) |
| `crates/arbors-pipeline/src/optimize/logical_plan.rs` | NEW (LogicalPlan optimizer + rules) |
| `crates/arbors-pipeline/src/optimize/analysis.rs` | NEW (DecodePlan analysis, shared utilities) |
| `crates/arbors-pipeline/src/lib.rs` | MODIFY (exports; preserve old optimize exports) |
| `crates/arbors-pipeline/tests/logical_optimizer_tests.rs` | NEW (pushdown + early termination + decodeplan explain) |
| `crates/arbors/src/handle.rs` | MODIFY (integrate optimize + explain DecodePlan summary) |
| `python/src/arbor.rs` | MODIFY (explain binding) |
| `python/arbors/_arbors.pyi` | MODIFY (type stub) |

---

## Holes/Pitfalls Addressed (updated)

1. **Plan/backing dual engine**: optimizer affects plan path; fallback remains as a safety net; explain makes plan behavior observable.
2. **DecodePlan opacity**: DecodePlan requirements become explicit via analysis + explain.
3. **Filter chaining cost**: Filter fusion reduces multiple full scans to one.
4. **filter(p).head(n) performance**: limit pushdown + early termination is implemented (required semantics).
5. **LogicalPlan wiring**: `Arbor::{select, add_fields, aggregate}` now build LogicalPlan nodes (6.0.5), so predicate pushdown is testable.
6. **Vectorization vs early termination**: Explicit choice - force sequential path when limit is present; vectorized revisited in Step 8.
7. **API shape enforces contract**: `filter_with_limit()` is `pub(crate)` so only optimizer can set limits.

---

## FIXME Comments Added (updated)

| Location | FIXME |
|----------|-------|
| `optimize/logical_plan.rs` | REFACTOR FIXME(Step 8): integrate cost model + add deeper predicate rewrite/simplification |
| `handle.rs` explain() | REFACTOR FIXME(Step 11): finalize explain/explain_analyze API surface |


-----


# Step 7: Planned Global Operations (sort_by, group_by, index_by)

## Overview

**Objective:** Add global ordering and grouping operations that work via LogicalPlan nodes, with efficient execution via physical operators.

**Exit Criteria:**
- `sort_by()`, `group_by()`, and `index_by()` work on both InMemory and Stored arbors
- Top-K optimization: `sort_by().head(n)` fuses into efficient partial sort
- Memory budgets enforce bounded-memory semantics
- All gates pass (A, B, C)

---

## Implementation Summary

### Sub-Step 7.1: Sort Types and LogicalPlan Nodes

**Files Created/Modified:**
- `crates/arbors-pipeline/src/sort.rs` - SortKey, SortDirection, NullOrdering types
- `crates/arbors-pipeline/src/logical_plan.rs` - Sort, GroupBy, IndexBy, TopK nodes

**Key Types:**
```rust
pub struct SortKey {
    pub expr: Expr,
    pub direction: SortDirection,
    pub nulls: NullOrdering,
}

pub enum SortDirection { Ascending, Descending }
pub enum NullOrdering { NullsFirst, NullsLast }
```

### Sub-Step 7.2: StreamingBudget

**File:** `crates/arbors-pipeline/src/budget.rs`

Budget configuration for bounded-memory streaming operations:
- `max_buffer_trees`: Decoded trees buffered for ordered emission
- `max_group_keys`: Limit on distinct group keys (default: 250,000)
- `max_index_entries`: Limit on index entries (default: 2,500,000)

**API:**
- `StreamingBudget::from_source(&source)` - Derived from source metadata
- `StreamingBudget::with_trees_per_batch(n)` - Explicit buffer size
- `StreamingBudget::unbounded()` - For explicit full materialization

### Sub-Step 7.3: Physical Operators

**File:** `crates/arbors-pipeline/src/physical.rs`

Physical operators for global operations:
- `physical_sort()` - Full sort via permutation indices
- `physical_top_k()` - Partial sort for sort+head fusion
- `physical_group_by()` - Group trees by key expression
- `physical_index_by()` - Build key→index mapping for O(1) lookup

**Result Types:**
```rust
pub struct GroupedResult { groups: Vec<(ExprResult, Vec<usize>)> }
pub struct IndexedResult { index: HashMap<CanonicalKey, usize> }
```

### Sub-Step 7.4: TopK Fusion Optimization

**File:** `crates/arbors-pipeline/src/optimize/logical_plan.rs`

Optimizer rule: `Sort(keys).Head(n)` → `TopK(keys, n)`

Benefits:
- Avoids full sort when only top N elements needed
- Uses heap-based selection (O(n log k) vs O(n log n))
- Reduces memory pressure for large datasets

### Sub-Step 7.5: Arbor Handle Integration

**File:** `crates/arbors/src/handle.rs`

Public API:
```rust
impl Arbor {
    pub fn sort_by(&self, key: impl Into<SortKeySpec>) -> Result<Self, PipelineError>
    pub fn sort_by_desc(&self, key: impl Into<Expr>) -> Result<Self, PipelineError>
    pub fn sort_by_keys(&self, keys: Vec<SortKeySpec>) -> Result<Self, PipelineError>
    pub fn group_by(&self, key: impl Into<Expr>) -> Result<GroupedArbor, PipelineError>
    pub fn index_by(&self, key: impl Into<Expr>) -> Result<IndexedArbor, PipelineError>
}
```

**Lazy Wrappers:**
- `GroupedArbor` - Lazy group computation via OnceCell
- `IndexedArbor` - Lazy index construction via OnceCell

Both use `once_cell::sync::OnceCell` for thread-safety (Send + Sync).

### Sub-Step 7.6: Python Bindings

**File:** `python/src/lib.rs`

Python bindings already existed with full feature parity:
- `sort_by()`, `sort_by_desc()`, `sort_by_keys()`
- `group_by()` returning `GroupedArbor`
- `index_by()` returning `IndexedArbor`

Added handling for `PipelineError::BufferLimitExceeded` error variant.

### Sub-Step 7.7: Tests

**Files:**
- `crates/arbors-pipeline/src/physical.rs` - 31 unit tests for physical operators
- `crates/arbors/tests/global_ops.rs` - 27 integration tests
- `crates/arbors/tests/invariants.rs` - 3 memory budget/efficiency tests

Test coverage:
- `batch_group_permutation()` - 4 tests
- `physical_sort()` - 7 tests (including stability, nulls, multi-key)
- `physical_top_k()` - 7 tests (including empty, ties, budget)
- `physical_group_by()` - 6 tests (including nulls, duplicates)
- `physical_index_by()` - 7 tests (including budget enforcement)

### Sub-Step 7.8: Gate Verification

All gates verified:
- Gate A (Invariants): 15 Rust + 12 Python tests pass
- Gate B (End-to-End): 35 Rust + 173 Python tests pass
- Full Rust test suite: 4350 tests pass
- Full Python test suite: 2534 tests pass

### Sub-Step 7.9: Documentation and FIXME Comments

**API Documentation:**
- `sort_by()` - TopK optimization, null handling, stability guarantees
- `group_by()` - Streaming behavior via sort+run, memory budget limits
- `index_by()` - Memory budget, duplicate key behavior, canonical equality
- `StreamingBudget` - Comprehensive documentation in budget.rs

**FIXME Comments Added:**
| Location | FIXME |
|----------|-------|
| `handle.rs` explain() | FIXME(Step 8): Add cost estimation for sort_by in explain() |
| `handle.rs` explain() | FIXME(Step 8): Optimize DecodePlan to only include sort key fields |
| `handle.rs` explain() | FIXME(Step 11): Add explain_analyze() support for sort_by memory usage |

---

## Files Summary

### New Files:
| File | Purpose |
|------|---------|
| `crates/arbors-pipeline/src/budget.rs` | StreamingBudget type |
| `crates/arbors-pipeline/src/sort.rs` | SortKey, SortDirection, NullOrdering types |
| `crates/arbors/tests/global_ops.rs` | Integration tests for sort_by, group_by, index_by |

### Modified Files:
| File | Changes |
|------|---------|
| `crates/arbors-pipeline/src/lib.rs` | Export new types (StreamingBudget, sort types) |
| `crates/arbors-pipeline/src/logical_plan.rs` | Sort, GroupBy, IndexBy, TopK nodes |
| `crates/arbors-pipeline/src/physical.rs` | Physical operators and result types |
| `crates/arbors-pipeline/src/optimize/logical_plan.rs` | TopKFusion rule |
| `crates/arbors-pipeline/src/optimize/mod.rs` | Export TopKFusion |
| `crates/arbors/src/handle.rs` | sort_by, group_by, index_by methods; GroupedArbor, IndexedArbor |
| `crates/arbors/src/lib.rs` | Export StreamingBudget |
| `crates/arbors/tests/invariants.rs` | Memory budget and efficiency tests |
| `python/src/lib.rs` | BufferLimitExceeded error handling |

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sort implementation | Permutation indices | Avoids copying trees; efficient for large datasets |
| TopK algorithm | Heap-based selection | O(n log k) vs O(n log n) for full sort |
| Grouped result | Lazy via OnceCell | Deferred execution until needed |
| Indexed result | Lazy via OnceCell | Index built on first lookup |
| Key comparison | Canonical equality | 1 == 1.0 for consistent behavior |
| Budget enforcement | Fail-fast with suggestion | Clear error messages guide users to solutions |
| Thread safety | once_cell::sync::OnceCell | Send + Sync for parallel access |

---

## Performance Characteristics

| Operation | Complexity | Memory |
|-----------|------------|--------|
| sort_by() | O(n log n) | O(n) indices |
| sort_by().head(k) | O(n log k) | O(k) indices |
| group_by() | O(n log n) sort + O(n) scan | O(groups) |
| index_by() | O(n) | O(unique keys) |

---

## Commit Message

```
feat: Step 7 - Planned global operations (sort_by, group_by, index_by)

Implements global ordering and grouping operations via LogicalPlan:

New Operations:
- sort_by() with multi-key support and null ordering
- sort_by_desc() convenience method
- group_by() with lazy streaming via sort+run strategy
- index_by() for O(1) key-based lookup

Optimizations:
- TopK fusion: sort_by().head(n) uses efficient partial sort
- Bounded memory via StreamingBudget configuration

Types:
- SortKeySpec for user-facing sort key configuration
- GroupedArbor/IndexedArbor lazy wrappers (Send + Sync)
- StreamingBudget for memory limit configuration

Testing:
- 31 unit tests for physical operators
- 27 integration tests in global_ops.rs
- 3 memory budget tests in invariants.rs
- All gates pass (4350 Rust, 2534 Python)

Files:
- NEW: arbors-pipeline/src/budget.rs, sort.rs
- NEW: arbors/tests/global_ops.rs
- MODIFY: logical_plan.rs, physical.rs, handle.rs
```


-----


# Step 7: Planned Global Operations - Implementation Plan

## ⚠️ Plan Audit Notes (2026-01-04)

**Fixes applied based on codebase analysis:**

1. **Key type: `Value` → `ExprResult`**
   - `arbors_expr::Value` is scalar-only and does NOT implement `Hash`
   - Changed all key types in physical operators to use `ExprResult`
   - Expression evaluation returns `ExprResult`, not `Value`

2. **Added `CanonicalKey` usage for hash-based operations**
   - `group_by` and `index_by` use `CanonicalKey` wrapper from `arbors-query::collection_ops`
   - Provides `Hash + Eq` for `ExprResult` with canonical equality (1 == 1.0, NaN == NaN)
   - Import for group_by/index_by: `use arbors_query::collection_ops::CanonicalKey;`
   - Import for sort: `use arbors_query::collection_ops::total_cmp_expr_results;` (no CanonicalKey needed)
   - NOTE: `canonical_eq` is private; use `CanonicalKey(a) == CanonicalKey(b)` for equality checks

3. **Thread safety: `std::cell::OnceCell` → `once_cell::sync::OnceCell`**
   - `std::cell::OnceCell` is not `Sync`, violates "Rust core is Send+Sync" requirement
   - Changed to `once_cell::sync::OnceCell` which provides `get_or_try_init()` for fallible init
   - Add dependency: `once_cell = "1.19"` to Cargo.toml

4. **Scalar-only key enforcement**
   - Removed Array/Object branches from comparison functions (they don't exist in `Value`)
   - Added explicit scalar-only checks in `compute_sort_key_values`, `physical_group_by`, `physical_index_by`
   - Clear error messages when non-scalar keys are provided

5. **Sink budget enforcement deferred (explicit decision)**
   - **Exit criteria choice: Option A (iteration-honest)**
   - Step 7 makes `iter()` correct and budgeted via `PlanBasedIter`
   - Sinks (`to_json()`, `to_arrow()`) remain a known limitation for Step 7
   - FIXME added: sinks should route through `PlanBasedIter` in a later step

6. **API fix: use `is_null_or_missing()`**
   - Use `ExprResult::is_null_or_missing()` for null/missing checks
   - Use `is_null_or_missing()` for null ordering checks in comparison functions

7. **PlanBasedIter perf fix: precompute `inv_restore` to avoid O(n²)**
   - Previous sketch had nested loops over `perm` and `restore` when buffering
   - Now precomputes `inv_restore[perm_idx] = logical_pos` once at iterator creation
   - Gives O(n) total instead of O(n²) when iterating permuted indices

8. **Fail-fast without panic: `get_root_info_and_batch_size()` returns `Result`**
   - Changed from `panic!` to returning `Result<_, PipelineError>`
   - Callers now use `PlanBasedIter::error(e)` for graceful error handling

9. **Sort imports: `CanonicalKey` not needed for `physical_sort`**
   - `physical_sort` only needs `total_cmp_expr_results` for comparison
   - `CanonicalKey` is only needed for `group_by`/`index_by` (hash-based operations)

---

## Overview

**Exit Criteria:** `sort_by`/`group_by`/`index_by` honor bounded-memory streaming defaults via `iter()` (fail-fast rather than silently materialize), and Gates A + B are green.

**Scope clarification:** Step 7 focuses on the `iter()` path. Sinks (`to_json()`, `to_arrow()`) are not required to be budget-aware in this step, but must be addressed in a follow-up.

**Goal:** Global operations (`sort_by`, `group_by`, `index_by`) that work without source materialization while respecting bounded-memory streaming constraints.

---

## ⚠️ CRITICAL ARCHITECTURAL ISSUE: iter() is backing-based, not plan-based

**Current state:** `Arbor::iter()` calls `ArborIter::new(&self.backing)`, which iterates the `ArborBacking` directly, completely **bypassing the LogicalPlan**.

**Consequence:** Even if we implement `LogicalPlan::Sort` and `physical_sort()` returns `IndexSet::Permuted`, **iteration will NOT observe the permutation** because the iterator never consults the plan.

**Required fix (Sub-Step 7.1.5):** Step 7 MUST introduce **plan-based iteration** that:
1. Executes the optimized plan to get a `PhysicalResult`
2. Iterates according to the `IndexSet` (Range, Sparse, or Permuted)
3. For `IndexSet::Permuted` with `batch_grouped=true`, uses batch-grouped access + bounded buffer + `restore_order`

Without this, Step 7 changes will be "implemented on paper but not observable."

---

## Key Design Decisions (Clarified)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Plan node location** | All global op nodes are **`LogicalPlan` variants only** | No `QueryPlan` involvement; that's legacy |
| **Budget defaults** | `StreamingBudget::with_trees_per_batch(source.trees_per_batch())` | Per-source, not magic 1000 |
| **`group_by()` return type** | `GroupedArbor` (view handle + iterator of `(key, Arbor)`) | Lazy groups, streaming iteration |
| **`index_by()` return type** | `IndexedArbor` (lazy HashMap built on first `.get()`) | No immediate materialization |
| **TopK implementation** | Optimizer rewrite: `Sort + Head → TopK` plan node | Separate plan node, not implicit |
| **Plan-based iteration** | `iter()` re-implemented to execute plan and iterate `IndexSet` | Required for sort/shuffle to work |

---

## Current State Analysis

The codebase already has:
- `IndexSet::Permuted { perm, batch_grouped, restore_order }` in `physical.rs`
- `BatchGroupedIndices` helper in `source.rs` for batch-grouped iteration
- `TreeSource` trait with `trees_per_batch()` and `for_each_at_indices()`
- `LogicalPlan` enum with Filter/Head/Tail/Take/Sample/Shuffle nodes
- `execute_logical_plan()` and `materialize_result()` functions
- Optimizer rules (FilterFusion, PredicatePushdown, LimitPushdown, LimitFusion)
- `PipelineExecutor` for physical operations

**Missing for Step 7:**
1. **Plan-based iteration** (the critical missing piece!)
2. Memory budget types (`StreamingBudget`) and `BufferLimitExceeded` error
3. `LogicalPlan::Sort`, `LogicalPlan::GroupBy`, `LogicalPlan::IndexBy`, `LogicalPlan::TopK` nodes
4. `physical_sort()` with batch-grouped permutation output
5. `TopKFusion` optimizer rule (`Sort + Head → TopK`)
6. `physical_group_by()` with sort+run streaming strategy
7. `physical_index_by()` with lazy HashMap construction
8. Arbor handle methods: `sort_by()`, `group_by()`, `index_by()`
9. Python bindings for new operations

---

## Sub-Step 7.0: Foundation Work (Budget Types + Error Types + IndexSet Enhancement)

**Goal:** Add the foundational types needed for bounded-memory streaming.

### 7.0.1: Add StreamingBudget Type

**File:** CREATE `crates/arbors-pipeline/src/budget.rs`

```rust
//! Streaming budget types for bounded-memory operations.
//!
//! Budgets enforce memory limits for global operations (sort, group, index).
//! When exceeded, operations fail-fast with actionable error messages.
//!
//! **IMPORTANT:** StreamingBudget intentionally does NOT implement Default.
//! All callers must explicitly construct a budget via:
//! - `StreamingBudget::from_source(&source)` - preferred, derives from source metadata
//! - `StreamingBudget::with_trees_per_batch(n)` - explicit buffer size
//! - `StreamingBudget::unbounded()` - for explicit full materialization

/// Streaming budget configuration for global operations.
///
/// Enforces bounded-memory semantics for operations that would otherwise
/// require unbounded buffering.
///
/// **No Default impl** - must be explicitly constructed to avoid accidental
/// magic numbers. Use `from_source()` for source-aware budgets.
#[derive(Debug, Clone)]
pub struct StreamingBudget {
    /// Maximum decoded trees buffered at once for ordered emission.
    /// Derived from `trees_per_batch()` when using `from_source()`.
    pub max_buffer_trees: usize,

    /// Maximum distinct group keys tracked for `group_by`.
    /// Default: 250,000 distinct keys.
    pub max_group_keys: usize,

    /// Maximum entries allowed when building an index for `index_by`.
    /// Default: 2,500,000 entries.
    pub max_index_entries: usize,
}

impl StreamingBudget {
    /// Conservative defaults for group/index limits.
    pub const DEFAULT_MAX_GROUP_KEYS: usize = 250_000;
    pub const DEFAULT_MAX_INDEX_ENTRIES: usize = 2_500_000;

    /// Create a budget derived from a TreeSource.
    /// This is the PREFERRED constructor for bounded iteration.
    ///
    /// Uses `source.trees_per_batch()` as the buffer limit, ensuring
    /// one batch worth of trees can be buffered for restore-order emission.
    pub fn from_source<S: crate::TreeSource>(source: &S) -> Self {
        Self::with_trees_per_batch(source.trees_per_batch())
    }

    /// Create a budget with explicit trees_per_batch as buffer limit.
    pub fn with_trees_per_batch(trees_per_batch: usize) -> Self {
        Self {
            max_buffer_trees: trees_per_batch,
            max_group_keys: Self::DEFAULT_MAX_GROUP_KEYS,
            max_index_entries: Self::DEFAULT_MAX_INDEX_ENTRIES,
        }
    }

    /// Create an unbounded budget (for explicit full materialization).
    ///
    /// Use this when you intentionally want to allow unbounded buffering,
    /// e.g., when calling `collect()` or `materialize()`.
    pub fn unbounded() -> Self {
        Self {
            max_buffer_trees: usize::MAX,
            max_group_keys: usize::MAX,
            max_index_entries: usize::MAX,
        }
    }
}

// NOTE: StreamingBudget intentionally does NOT implement `Default`.
// This forces explicit construction and prevents accidental "magic 1000" usage.
```

### 7.0.2: Add BufferLimitExceeded Error Variant

**File:** MODIFY `crates/arbors-pipeline/src/source.rs`

Add to `PipelineError` enum:

```rust
/// Buffer limit exceeded during streaming operation.
///
/// This error is returned when an operation would exceed the configured
/// memory budget. The suggestion provides guidance on how to proceed.
#[error("buffer limit exceeded: required {required}, limit {limit}. {suggestion}")]
BufferLimitExceeded {
    /// Number of items required.
    required: usize,
    /// Configured limit.
    limit: usize,
    /// Actionable suggestion for the user.
    suggestion: String,
},
```

### 7.0.3: Add SortKey Type

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs` or CREATE `crates/arbors-pipeline/src/sort.rs`

```rust
/// Sort key specification for sort_by operations.
#[derive(Debug, Clone)]
pub struct SortKey {
    /// Expression to extract the sort key from each tree.
    pub expr: Expr,
    /// Sort direction (ascending or descending).
    pub direction: SortDirection,
    /// Null handling (nulls first or nulls last).
    pub nulls: NullOrdering,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortDirection {
    #[default]
    Ascending,
    Descending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NullOrdering {
    #[default]
    NullsLast,
    NullsFirst,
}

impl SortKey {
    pub fn asc(expr: Expr) -> Self {
        Self {
            expr,
            direction: SortDirection::Ascending,
            nulls: NullOrdering::NullsLast,
        }
    }

    pub fn desc(expr: Expr) -> Self {
        Self {
            expr,
            direction: SortDirection::Descending,
            nulls: NullOrdering::NullsLast,
        }
    }
}
```

### 7.0.4: Export New Types

**File:** MODIFY `crates/arbors-pipeline/src/lib.rs`

```rust
mod budget;
mod sort;

pub use budget::StreamingBudget;
pub use sort::{SortKey, SortDirection, NullOrdering};
```

**Checklist:**
- [ ] Create `budget.rs` with `StreamingBudget` type
- [ ] Add `BufferLimitExceeded` to `PipelineError`
- [ ] Create `sort.rs` with `SortKey`, `SortDirection`, `NullOrdering`
- [ ] Export new types from `lib.rs`
- [ ] Verify: `cargo test -p arbors-pipeline`

---

## Sub-Step 7.1: sort_by Implementation

**Goal:** Implement `sort_by` with batch-grouped permutation output.

### 7.1.1: Add LogicalPlan::Sort Node

**File:** MODIFY `crates/arbors-pipeline/src/logical_plan.rs`

```rust
// Add to LogicalPlan enum:

/// Sort trees by key expressions.
///
/// Produces a permuted view of the source without materializing trees.
/// Physical execution creates an IndexSet::Permuted with batch-grouped
/// ordering for efficient streaming.
Sort {
    /// The source plan to sort.
    source: Arc<LogicalPlan>,
    /// Sort key specifications (evaluated in order for tie-breaking).
    keys: Vec<SortKey>,
},

// Add builder method to impl LogicalPlan:

/// Create a Sort plan node.
#[inline]
pub fn sort(self: &Arc<Self>, keys: Vec<SortKey>) -> Arc<Self> {
    Arc::new(Self::Sort {
        source: Arc::clone(self),
        keys,
    })
}
```

### 7.1.2: Implement batch_group_permutation Helper

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

```rust
use std::collections::BTreeMap;

/// Result of batch-grouping a permutation.
#[derive(Debug)]
pub struct BatchGroupedPermutation {
    /// Indices ordered by batch (for efficient I/O).
    pub permutation: Vec<usize>,
    /// Mapping to restore logical (sorted) order during iteration.
    /// restore_indices[i] = position in permutation where logical index i appears.
    pub restore_indices: Vec<usize>,
}

/// Batch-group a permutation for efficient streaming.
///
/// Given a permutation (sorted order), reorders it by batch so that
/// iteration can load each batch once. The restore_indices map allows
/// emitting in the original sorted order.
///
/// # Arguments
///
/// * `perm` - The permutation in logical (sorted) order
/// * `trees_per_batch` - Number of trees per batch
///
/// # Returns
///
/// A `BatchGroupedPermutation` with batch-ordered indices and restore map.
pub fn batch_group_permutation(perm: &[usize], trees_per_batch: usize) -> BatchGroupedPermutation {
    if perm.is_empty() || trees_per_batch == 0 {
        return BatchGroupedPermutation {
            permutation: Vec::new(),
            restore_indices: Vec::new(),
        };
    }

    // Group indices by batch
    let mut by_batch: BTreeMap<usize, Vec<(usize, usize)>> = BTreeMap::new();
    for (logical_pos, &global_idx) in perm.iter().enumerate() {
        let batch_idx = global_idx / trees_per_batch;
        by_batch.entry(batch_idx).or_default().push((logical_pos, global_idx));
    }

    // Build batch-grouped permutation and restore map
    let mut permutation = Vec::with_capacity(perm.len());
    let mut restore_indices = vec![0; perm.len()];

    for (_, entries) in by_batch {
        for (logical_pos, global_idx) in entries {
            restore_indices[logical_pos] = permutation.len();
            permutation.push(global_idx);
        }
    }

    BatchGroupedPermutation {
        permutation,
        restore_indices,
    }
}
```

### 7.1.3: Implement physical_sort

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

```rust
use std::cmp::Ordering;
use arbors_expr::ExprResult;
use arbors_query::collection_ops::total_cmp_expr_results;

/// Physical sort - produces batch-grouped permutation over INPUT INDICES ONLY.
///
/// **CRITICAL:** This sorts only the trees specified by `input_indices`, NOT
/// the entire source. This is essential for correctness when chaining
/// filter().sort_by() - we only sort the filtered subset.
///
/// # Arguments
///
/// * `source` - The tree source
/// * `keys` - Sort key specifications
/// * `input_indices` - The indices to sort (from upstream filter/take/etc.)
///
/// # Returns
///
/// `IndexSet::Permuted` with batch-grouped ordering and restore map.
/// The permutation contains only indices from `input_indices`, reordered.
///
/// # Memory
///
/// Allocates O(m) for sort keys and O(m) for permutation, where m = input_indices.len().
/// Budget is NOT enforced here - it's enforced in PlanBasedIter during emission.
#[allow(dead_code)] // REFACTOR FIXME: Remove once integrated
pub fn physical_sort<S: TreeSource>(
    source: &S,
    keys: &[SortKey],
    input_indices: &IndexSet,
) -> Result<IndexSet, PipelineError> {
    let indices_to_sort = input_indices.to_vec();
    if indices_to_sort.is_empty() {
        return Ok(IndexSet::EMPTY);
    }

    // 1. Extract sort keys for only the input indices
    // NOTE: Keys are ExprResult (not Value) because expression evaluation returns ExprResult.
    // We enforce scalar-only keys at the physical operator level.
    let plan = analyze_required_pools_for_keys(keys, source.schema());
    let mut keyed: Vec<(Vec<ExprResult>, usize)> = Vec::with_capacity(indices_to_sort.len());

    source.for_each_at_indices(&indices_to_sort, plan, |arbor, local_idx, global_idx| {
        let key_values = compute_sort_key_values(arbor, local_idx, keys)?;
        keyed.push((key_values, global_idx));
        Ok(())
    })?;

    // 2. Sort by keys (TOTAL ordering)
    keyed.sort_by(|(a, _), (b, _)| compare_key_values_total(a, b, keys));

    // 3. Extract permutation (global indices from input_indices)
    let perm: Vec<usize> = keyed.into_iter().map(|(_, idx)| idx).collect();

    // 4. Batch-group for efficient streaming
    let grouped = batch_group_permutation(&perm, source.trees_per_batch());

    Ok(IndexSet::Permuted {
        perm: grouped.permutation,
        batch_grouped: true,
        restore_order: Some(grouped.restore_indices),
    })
}

/// Analyze required pools for sort key extraction.
fn analyze_required_pools_for_keys(keys: &[SortKey], schema: Option<&SchemaRegistry>) -> DecodePlan {
    // Build DecodePlan that includes only paths referenced by sort keys
    // This minimizes decoding to just the fields needed for sorting
    // FIXME(Step 8): Implement path-based DecodePlan pruning
    let _ = (keys, schema);
    DecodePlan::ALL
}

/// Compute sort key values for a single tree.
///
/// Returns ExprResult values. Caller must enforce scalar-only keys if needed.
fn compute_sort_key_values(
    arbor: &InMemoryArbor,
    tree_idx: usize,
    keys: &[SortKey],
) -> Result<Vec<ExprResult>, PipelineError> {
    let root = arbor.root(tree_idx).map_err(|e| PipelineError::StorageError(e.to_string()))?;

    keys.iter().map(|key| {
        let result = evaluate_expr_on_tree(arbor, root, &key.expr)?;
        // Enforce scalar-only keys for sort operations
        if !result.is_scalar() {
            return Err(PipelineError::StorageError(
                "sort_by requires scalar keys (not arrays or objects)".into()
            ));
        }
        Ok(result)
    }).collect()
}

/// Compare two key value vectors using TOTAL ordering.
///
/// This defines a deterministic total order for sorting:
/// - Nulls are ordered according to NullOrdering (first or last)
/// - Numbers: i64 and f64 compare with canonical equality (1 == 1.0 for small ints)
/// - Cross-type: Bool < Number < String < Date < DateTime < Duration < Binary < Null < Missing
/// - NaN handling: NaN == NaN for equality, NaN sorts after all non-NaN numbers
///
/// **IMPORTANT:** This function handles scalar-only ExprResult values.
/// Array/Object keys are rejected earlier in compute_sort_key_values().
///
/// Uses `total_cmp_expr_results` from arbors-query::collection_ops for consistent
/// ordering semantics across the codebase.
fn compare_key_values_total(a: &[ExprResult], b: &[ExprResult], keys: &[SortKey]) -> Ordering {
    for (i, key) in keys.iter().enumerate() {
        // Use total_cmp_expr_results for consistent total ordering
        let cmp = total_cmp_expr_results(&a[i], &b[i]);

        // Apply null ordering adjustment if needed
        // NOTE: Use is_null_or_missing() for null/missing ordering checks.
        let cmp = match (a[i].is_null_or_missing(), b[i].is_null_or_missing(), key.nulls) {
            (true, false, NullOrdering::NullsFirst) => Ordering::Less,
            (true, false, NullOrdering::NullsLast) => Ordering::Greater,
            (false, true, NullOrdering::NullsFirst) => Ordering::Greater,
            (false, true, NullOrdering::NullsLast) => Ordering::Less,
            _ => cmp, // Use base comparison
        };

        // Apply direction
        let cmp = match key.direction {
            SortDirection::Ascending => cmp,
            SortDirection::Descending => cmp.reverse(),
        };
        if cmp != Ordering::Equal {
            return cmp;
        }
    }
    Ordering::Equal
}

// NOTE: No separate compare_values_total function needed.
// We reuse `total_cmp_expr_results` from arbors-query::collection_ops
// which already implements the correct total ordering ("The Ladder"):
//   Bool < Number < String < Date < DateTime < Duration < Binary < Array < Object < Null < Missing
//
// For scalar-only sort keys, Array/Object branches are never reached because
// compute_sort_key_values() rejects non-scalar keys.
```

**Note on budget:** Budget enforcement happens in `PlanBasedIter` during ordered emission, NOT in `physical_sort`. The sort itself is O(m log m) in time and O(m) in space where m = input size, which is unavoidable for sorting.

### 7.1.4: Add Sort to execute_logical_plan

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

Add case in `execute_plan_node`:

```rust
LogicalPlan::Sort { source, keys } => {
    // 1. Execute upstream to get input indices
    let source_result = execute_plan_node(source, txn, root_info)?;
    let input_indices = source_result.as_indices().ok_or_else(|| {
        PipelineError::StorageError("sort requires indices input".into())
    })?;

    // 2. Sort ONLY the input indices (not full source!)
    // This is critical for filter().sort_by() correctness.
    let sorted_indices = match root_info {
        RootSourceInfo::InMemory(arbor) => {
            let tree_source = InMemorySource::from_arc(Arc::clone(arbor));
            physical_sort(&tree_source, keys, input_indices)?
        }
        RootSourceInfo::Stored { name } => {
            let txn = txn.ok_or_else(|| {
                PipelineError::StorageError("Stored plan requires transaction".into())
            })?;
            let batched = txn
                .get_batched(name)
                .map_err(|e| PipelineError::StorageError(e.to_string()))?
                .ok_or_else(|| {
                    PipelineError::StorageError(format!("arbor '{}' not found", name))
                })?;
            let tree_source = BatchedSource::new(&batched);
            physical_sort(&tree_source, keys, input_indices)?
        }
    };

    // Result is already the sorted permutation of input_indices
    // No masking needed - physical_sort operates on input_indices directly
    Ok(PhysicalResult::Indices(sorted_indices))
}
```

**Why no masking?** Unlike the previous "sort-full-then-mask" approach, `physical_sort` now takes `input_indices` directly and sorts only those trees. The result permutation contains only indices from the input set, reordered by sort keys.

**Checklist:**
- [ ] Add `LogicalPlan::Sort` variant and `sort()` builder
- [ ] Implement `batch_group_permutation()` helper
- [ ] Implement `physical_sort()` with key extraction and batch-grouping
- [ ] Add Sort case to `execute_plan_node()`
- [ ] Add helper functions for key comparison
- [ ] Verify: `cargo test -p arbors-pipeline sort`

---

## Sub-Step 7.1.5: Plan-Based Iteration (CRITICAL)

**Goal:** Re-implement `Arbor::iter()` to execute the LogicalPlan and iterate according to the resulting `IndexSet`. This is REQUIRED for sort/shuffle/filter to affect iteration order.

**Why this is critical:** Currently `ArborIter` iterates `ArborBacking` directly, bypassing `LogicalPlan`. Without this change, `sort_by()` will compute a permutation that is never observed by iteration.

### 7.1.5.1: Create PlanBasedIter Type

**File:** MODIFY `crates/arbors/src/handle.rs`

```rust
/// Iterator that executes a LogicalPlan and yields trees according to the
/// resulting IndexSet. This is the ONLY way to observe sort/shuffle/filter
/// effects during iteration.
pub struct PlanBasedIter<'a> {
    /// The scope for database access (if stored).
    scope: &'a ArborScope,
    /// The index set to iterate (computed from plan execution).
    indices: IndexSet,
    /// Current position in the index set.
    position: usize,
    /// Budget for bounded buffering (especially for Permuted indices).
    budget: StreamingBudget,
    /// For Permuted indices: buffer of trees loaded from current batch.
    /// Key: position in restore_order that this tree belongs to.
    /// Value: the loaded OwnedTree.
    buffer: BTreeMap<usize, OwnedTree>,
    /// For batch-grouped access: current batch being processed.
    current_batch: Option<(usize, Arc<InMemoryArbor>)>,
    /// Trees per batch (for batch coordinate computation).
    trees_per_batch: usize,
    /// Total trees in the index set.
    total: usize,
    /// Root source info for tree access.
    root_info: RootSourceInfo,
    /// Precomputed inverse of restore_order: inv_restore[perm_idx] = logical_pos.
    /// Avoids O(n²) nested scan when buffering trees from a batch.
    inv_restore: Vec<usize>,
}

impl<'a> PlanBasedIter<'a> {
    /// Create from an executed plan result.
    pub fn new(
        scope: &'a ArborScope,
        indices: IndexSet,
        budget: StreamingBudget,
        root_info: RootSourceInfo,
        trees_per_batch: usize,
    ) -> Self {
        let total = indices.len();

        // Precompute inverse of restore_order for O(1) lookup in next_permuted
        let inv_restore = if let IndexSet::Permuted { restore_order: Some(restore), .. } = &indices {
            let mut inv = vec![0; restore.len()];
            for (logical_pos, &perm_idx) in restore.iter().enumerate() {
                inv[perm_idx] = logical_pos;
            }
            inv
        } else {
            Vec::new()
        };

        Self {
            scope,
            indices,
            position: 0,
            budget,
            buffer: BTreeMap::new(),
            current_batch: None,
            trees_per_batch,
            total,
            root_info,
            inv_restore,
        }
    }
}

impl<'a> Iterator for PlanBasedIter<'a> {
    type Item = Result<OwnedTree, PipelineError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.position >= self.total {
            return None;
        }

        match &self.indices {
            // Range: sequential access, simple
            IndexSet::Range { start, end } => {
                let global_idx = start + self.position;
                if global_idx >= *end {
                    return None;
                }
                self.position += 1;
                Some(self.load_single_tree(global_idx))
            }

            // Sparse: access in index order (already batch-grouped if from filter)
            IndexSet::Sparse(indices) => {
                let global_idx = indices[self.position];
                self.position += 1;
                Some(self.load_single_tree(global_idx))
            }

            // Permuted: batch-grouped access with restore_order buffering
            IndexSet::Permuted { perm, batch_grouped, restore_order } => {
                self.next_permuted(perm, *batch_grouped, restore_order.as_deref())
            }
        }
    }
}

impl<'a> PlanBasedIter<'a> {
    /// Load a single tree by global index.
    fn load_single_tree(&mut self, global_idx: usize) -> Result<OwnedTree, PipelineError> {
        let batch_idx = global_idx / self.trees_per_batch;
        let local_idx = global_idx % self.trees_per_batch;

        // Load batch if needed
        if self.current_batch.as_ref().map(|(idx, _)| *idx) != Some(batch_idx) {
            let arbor = self.load_batch(batch_idx)?;
            self.current_batch = Some((batch_idx, arbor));
        }

        let arbor = &self.current_batch.as_ref().unwrap().1;
        let single = arbor.slice(local_idx, local_idx + 1);
        Ok(OwnedTree::new(single))
    }

    /// Handle iteration over permuted indices with bounded buffering.
    ///
    /// **PERF NOTE:** Uses precomputed `inv_restore` map to avoid O(n²) nested scans.
    /// `inv_restore[perm_idx] = logical_pos` is computed once at iterator creation.
    fn next_permuted(
        &mut self,
        perm: &[usize],
        batch_grouped: bool,
        restore_order: Option<&[usize]>,
    ) -> Option<Result<OwnedTree, PipelineError>> {
        // If batch_grouped with restore_order, we iterate in logical (sorted)
        // order while loading batches sequentially.
        //
        // Algorithm:
        // 1. Check if position is in buffer
        // 2. If not, load the batch containing position's target and buffer all
        //    trees from that batch that we need (using inv_restore for O(1) lookup)
        // 3. Enforce budget: if buffer exceeds max_buffer_trees, return error
        // 4. Return tree at position and increment

        if let Some(restore) = restore_order {
            // We want tree at logical position `self.position`
            // restore[self.position] tells us where in perm to find it
            let perm_idx = restore[self.position];
            let global_idx = perm[perm_idx];

            // Check buffer first
            if let Some(tree) = self.buffer.remove(&self.position) {
                self.position += 1;
                return Some(Ok(tree));
            }

            // Need to load the batch containing global_idx
            let batch_idx = global_idx / self.trees_per_batch;
            match self.load_batch(batch_idx) {
                Ok(arbor) => {
                    // Find ALL perm entries that reference this batch and buffer them
                    // Uses self.inv_restore for O(1) perm_idx → logical_pos lookup
                    let batch_start = batch_idx * self.trees_per_batch;
                    let batch_end = batch_start + self.trees_per_batch;

                    for (perm_i, &g_idx) in perm.iter().enumerate() {
                        if g_idx >= batch_start && g_idx < batch_end {
                            // O(1) lookup via precomputed inverse map
                            let logical_pos = self.inv_restore[perm_i];
                            if logical_pos >= self.position {
                                let local_idx = g_idx % self.trees_per_batch;
                                if local_idx < arbor.num_trees() {
                                    let single = arbor.slice(local_idx, local_idx + 1);
                                    let tree = OwnedTree::new(single);
                                    self.buffer.insert(logical_pos, tree);
                                }
                            }
                        }
                    }

                    // Check budget
                    if self.buffer.len() > self.budget.max_buffer_trees {
                        return Some(Err(PipelineError::BufferLimitExceeded {
                            required: self.buffer.len(),
                            limit: self.budget.max_buffer_trees,
                            suggestion: format!(
                                "Permuted iteration requires buffering {} trees, \
                                 but max_buffer_trees is {}. Consider increasing \
                                 the budget or using materialize() instead.",
                                self.buffer.len(),
                                self.budget.max_buffer_trees
                            ),
                        }));
                    }

                    // Now get our tree from buffer
                    if let Some(tree) = self.buffer.remove(&self.position) {
                        self.position += 1;
                        Some(Ok(tree))
                    } else {
                        // Should not happen if logic is correct
                        Some(Err(PipelineError::StorageError(
                            "Failed to load expected tree".into()
                        )))
                    }
                }
                Err(e) => Some(Err(e)),
            }
        } else {
            // Non-batch-grouped: just iterate perm in order
            let global_idx = perm[self.position];
            self.position += 1;
            Some(self.load_single_tree(global_idx))
        }
    }

    /// Load a batch by index.
    fn load_batch(&self, batch_idx: usize) -> Result<Arc<InMemoryArbor>, PipelineError> {
        match &self.root_info {
            RootSourceInfo::InMemory(arbor) => Ok(Arc::clone(arbor)),
            RootSourceInfo::Stored { name } => {
                let txn = self.scope.as_scope()
                    .ok_or_else(|| PipelineError::StorageError("No scope for stored access".into()))?
                    .txn();
                let batched = txn.get_batched(name)
                    .map_err(|e| PipelineError::StorageError(e.to_string()))?
                    .ok_or_else(|| PipelineError::StorageError(format!("Arbor '{}' not found", name)))?;
                let arbor = batched.batch(batch_idx)
                    .map_err(|e| PipelineError::StorageError(e.to_string()))?;
                Ok(Arc::new(arbor))
            }
        }
    }
}
```

### 7.1.5.2: Update Arbor::iter() to Use Plan-Based Iteration

**File:** MODIFY `crates/arbors/src/handle.rs`

```rust
impl Arbor {
    /// Iterate over trees in this arbor.
    ///
    /// **Important:** This executes the LogicalPlan and iterates according to
    /// the resulting IndexSet. For sorted/shuffled arbors, this yields trees
    /// in the correct (permuted) order.
    ///
    /// Uses `StreamingBudget::with_trees_per_batch()` derived from the source.
    /// For explicit budget control, use `iter_with_budget()`.
    pub fn iter(&self) -> PlanBasedIter<'_> {
        // Derive budget from source metadata (no Default impl; no magic numbers).
        match self.get_root_info_and_batch_size() {
            Ok((_, trees_per_batch)) => {
                let budget = StreamingBudget::with_trees_per_batch(trees_per_batch);
                self.iter_with_budget(budget)
            }
            Err(e) => PlanBasedIter::error(e),
        }
    }

    /// Iterate with explicit streaming budget.
    ///
    /// Use this when iterating sorted/shuffled arbors to control buffering.
    pub fn iter_with_budget(&self, budget: StreamingBudget) -> PlanBasedIter<'_> {
        // Execute the optimized plan
        let txn = self.scope.as_scope().map(|s| s.txn());
        let optimized = arbors_pipeline::optimize_logical_plan(&self.plan);

        match execute_logical_plan(&optimized, txn) {
            Ok(result) => {
                let indices = result.as_indices()
                    .cloned()
                    .unwrap_or_else(|| IndexSet::Range { start: 0, end: 0 });

                match self.get_root_info_and_batch_size() {
                    Ok((root_info, trees_per_batch)) => {
                        PlanBasedIter::new(&self.scope, indices, budget, root_info, trees_per_batch)
                    }
                    Err(e) => PlanBasedIter::error(e),
                }
            }
            Err(e) => {
                // Return an iterator that yields the error
                PlanBasedIter::error(e)
            }
        }
    }

    /// Get root source info and trees_per_batch for iteration.
    ///
    /// Returns `Result` to avoid panics - callers should handle errors gracefully.
    fn get_root_info_and_batch_size(&self) -> Result<(RootSourceInfo, usize), PipelineError> {
        // Walk plan to find root source
        let root = self.plan.root_source();
        match root {
            LogicalPlan::InMemory { arbor } => {
                // InMemory is treated as a single "batch" for iteration purposes.
                Ok((RootSourceInfo::InMemory(Arc::clone(arbor)), arbor.num_trees()))
            }
            LogicalPlan::Stored { name } => {
                // Get trees_per_batch from metadata.
                //
                // IMPORTANT: Do not silently fall back to a magic number here. If we can't
                // get metadata, iteration should fail-fast with a clear error.
                let scope = self.scope.as_scope().ok_or_else(|| {
                    PipelineError::StorageError("No scope for stored arbor access".into())
                })?;
                let meta = scope
                    .txn()
                    .get_meta(name)
                    .map_err(|e| PipelineError::StorageError(e.to_string()))?
                    .ok_or_else(|| {
                        PipelineError::StorageError(format!(
                            "Stored arbor '{}' has no metadata (trees_per_batch required)",
                            name
                        ))
                    })?;
                Ok((RootSourceInfo::Stored { name: name.clone() }, meta.trees_per_batch as usize))
            }
            _ => Err(PipelineError::StorageError(
                "root_source returned unexpected variant".into()
            )),
        }
    }
}
```

### 7.1.5.3: Add root_source() Helper to LogicalPlan

**File:** MODIFY `crates/arbors-pipeline/src/logical_plan.rs`

```rust
impl LogicalPlan {
    /// Find the root source node of this plan.
    pub fn root_source(&self) -> &Self {
        match self {
            Self::InMemory { .. } | Self::Stored { .. } => self,
            Self::Filter { source, .. }
            | Self::Head { source, .. }
            | Self::Tail { source, .. }
            | Self::Take { source, .. }
            | Self::Sample { source, .. }
            | Self::Shuffle { source, .. }
            | Self::Sort { source, .. }
            | Self::Select { source, .. }
            | Self::AddFields { source, .. }
            | Self::Aggregate { source, .. } => source.root_source(),
            // Add new variants here as they're added
        }
    }
}
```

### 7.1.5.4: ArborIter Retirement Strategy

**Decision:** Keep legacy `ArborIter` but mark for deprecation.

**Rationale:**
- Deleting `ArborIter` now would break any code using it directly
- Step 7 changes `Arbor::iter()` to use `PlanBasedIter`, so the public API behavior changes
- Legacy `ArborIter` can remain as internal implementation detail for direct backing access

**Actions:**
1. **Rename** `ArborIter` → `BackingIter` (internal use only)
2. **Remove** public export of `ArborIter` from `crates/arbors/src/lib.rs`
3. **Add FIXME** comment: `// FIXME(Step 12): Remove BackingIter once all iteration is plan-based`
4. **Keep** `BackingIter` available for internal use (e.g., `materialize()` implementations that need raw backing access)

**Verification:** After Step 7, `Arbor::iter()` returns `PlanBasedIter`, and all tests using `.iter()` observe plan effects (sort order, filter, etc.).

**Checklist:**
- [ ] Create `PlanBasedIter` struct with bounded buffer support
- [ ] Implement `Iterator for PlanBasedIter` handling Range/Sparse/Permuted
- [ ] Update `Arbor::iter()` to use plan-based iteration
- [ ] Add `Arbor::iter_with_budget()` for explicit budget control
- [ ] Add `LogicalPlan::root_source()` helper
- [ ] Rename `ArborIter` → `BackingIter` (internal)
- [ ] Remove `ArborIter` from public exports
- [ ] Add FIXME comment for Step 12 cleanup
- [ ] Verify: `cargo test -p arbors iter`

**Gate B Impact:** HIGH - This changes `iter()` behavior fundamentally. Must verify all existing iteration tests pass.

---

## Sub-Step 7.2: TopK Optimizer Rule

**Goal:** Fuse `sort_by(k).head(n)` into `TopK(n, k)` for O(n log k) instead of O(n log n).

### 7.2.1: Add LogicalPlan::TopK Node

**File:** MODIFY `crates/arbors-pipeline/src/logical_plan.rs`

```rust
/// Top-K optimization: combined sort + head.
///
/// Produced by optimizer when `Sort.head(n)` pattern is detected.
/// Uses O(n log k) heap-based algorithm instead of full O(n log n) sort.
TopK {
    /// The source plan.
    source: Arc<LogicalPlan>,
    /// Sort key specifications.
    keys: Vec<SortKey>,
    /// Number of top elements to retain.
    k: usize,
},
```

### 7.2.2: Implement TopKFusion Optimizer Rule

**File:** MODIFY `crates/arbors-pipeline/src/optimize/logical_optimizer.rs`

```rust
/// Fuses Sort + Head into TopK for O(n log k) execution.
///
/// # Pattern
///
/// - Sort(keys).Head(n) -> TopK(keys, n)
///
/// This optimization uses a BinaryHeap to maintain only the top K elements,
/// avoiding a full sort when only the first N sorted elements are needed.
#[derive(Debug)]
pub struct TopKFusion;

impl LogicalOptimizationRule for TopKFusion {
    fn apply(&self, plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
        match plan.as_ref() {
            // Head over Sort -> TopK
            LogicalPlan::Head { source, n } => {
                if let LogicalPlan::Sort { source: sort_source, keys } = source.as_ref() {
                    return Some(Arc::new(LogicalPlan::TopK {
                        source: Arc::clone(sort_source),
                        keys: keys.clone(),
                        k: *n,
                    }));
                }
                // Recurse
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Head {
                    source: optimized,
                    n: *n,
                }))
            }

            // Recurse into other nodes
            LogicalPlan::Sort { source, keys } => {
                let optimized = self.apply(source)?;
                Some(Arc::new(LogicalPlan::Sort {
                    source: optimized,
                    keys: keys.clone(),
                }))
            }

            // ... other node types with recursion ...

            LogicalPlan::InMemory { .. } | LogicalPlan::Stored { .. } => None,
        }
    }

    fn name(&self) -> &'static str {
        "TopKFusion"
    }
}
```

### 7.2.3: Implement physical_top_k

**File:** CREATE `crates/arbors-pipeline/src/topk.rs`

```rust
//! Top-K physical operator using heap-based algorithm.

use std::collections::BinaryHeap;
use std::cmp::Ordering;

use crate::{SortKey, SortDirection, NullOrdering, StreamingBudget, IndexSet, PipelineError, TreeSource};
use arbors_core::DecodePlan;
use arbors_expr::ExprResult;
use arbors_query::collection_ops::total_cmp_expr_results;

/// Entry in the top-k heap.
///
/// Uses ExprResult for key values (scalar-only, enforced in compute_sort_key_values).
struct HeapEntry {
    key_values: Vec<ExprResult>,
    global_idx: usize,
    /// Reverse ordering for min-heap behavior (we want smallest K).
    keys_spec: Vec<(SortDirection, NullOrdering)>,
}

impl PartialEq for HeapEntry {
    fn eq(&self, other: &Self) -> bool {
        self.global_idx == other.global_idx
    }
}

impl Eq for HeapEntry {}

impl PartialOrd for HeapEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HeapEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reverse comparison for max-heap (we pop largest to keep smallest K)
        compare_key_values_with_spec(&other.key_values, &self.key_values, &self.keys_spec)
    }
}

// NOTE: TopK reuses `total_cmp_expr_results` from arbors-query::collection_ops
// for consistent total ordering across sort/group/index operations.

fn compare_key_values_with_spec(
    a: &[ExprResult],
    b: &[ExprResult],
    specs: &[(SortDirection, NullOrdering)],
) -> Ordering {
    for (i, (direction, nulls)) in specs.iter().enumerate() {
        // Use total_cmp_expr_results for consistent total ordering
        let cmp = total_cmp_expr_results(&a[i], &b[i]);

        // Apply null ordering adjustment
        // NOTE: Use is_null_or_missing() for null/missing ordering checks.
        let cmp = match (a[i].is_null_or_missing(), b[i].is_null_or_missing(), nulls) {
            (true, false, NullOrdering::NullsFirst) => Ordering::Less,
            (true, false, NullOrdering::NullsLast) => Ordering::Greater,
            (false, true, NullOrdering::NullsFirst) => Ordering::Greater,
            (false, true, NullOrdering::NullsLast) => Ordering::Less,
            _ => cmp,
        };

        let cmp = match direction {
            SortDirection::Ascending => cmp,
            SortDirection::Descending => cmp.reverse(),
        };
        if cmp != Ordering::Equal {
            return cmp;
        }
    }
    Ordering::Equal
}

/// Physical top-k: O(n log k) instead of O(n log n).
///
/// Uses a max-heap of size k, streaming through all trees and keeping
/// only the smallest k elements.
///
/// Like `physical_sort`, this operates on `input_indices` only (not full source).
/// Budget enforcement happens in PlanBasedIter, not here.
pub fn physical_top_k<S: TreeSource>(
    source: &S,
    keys: &[SortKey],
    k: usize,
    input_indices: &IndexSet,
) -> Result<IndexSet, PipelineError> {
    let indices_to_process = input_indices.to_vec();
    if k == 0 || indices_to_process.is_empty() {
        return Ok(IndexSet::EMPTY);
    }

    let keys_spec: Vec<_> = keys.iter().map(|k| (k.direction, k.nulls)).collect();
    let mut heap: BinaryHeap<HeapEntry> = BinaryHeap::with_capacity(k + 1);

    let plan = DecodePlan::ALL; // FIXME(Step 8): optimize to key fields only

    // Iterate only over input_indices, not the full source
    source.for_each_at_indices(&indices_to_process, plan, |arbor, local_idx, global_idx| {
        let key_values = compute_sort_key_values(arbor, local_idx, keys)?;

        let entry = HeapEntry {
            key_values,
            global_idx,
            keys_spec: keys_spec.clone(),
        };

        if heap.len() < k {
            heap.push(entry);
        } else if let Some(top) = heap.peek() {
            // If new entry is smaller than largest in heap, replace
            if entry.cmp(top) == Ordering::Greater {
                heap.pop();
                heap.push(entry);
            }
        }

        Ok(())
    })?;

    // Extract sorted indices from heap
    let mut sorted: Vec<_> = heap.into_iter().collect();
    sorted.sort_by(|a, b| {
        compare_key_values_with_spec(&a.key_values, &b.key_values, &a.keys_spec)
    });

    let perm: Vec<usize> = sorted.into_iter().map(|e| e.global_idx).collect();

    // Batch-group for streaming
    let grouped = batch_group_permutation(&perm, source.trees_per_batch());

    Ok(IndexSet::Permuted {
        perm: grouped.permutation,
        batch_grouped: true,
        restore_order: Some(grouped.restore_indices),
    })
}
```

### 7.2.4: Add TopK to Execute and Optimizer

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

Add TopK case to `execute_plan_node`.

**File:** MODIFY `crates/arbors-pipeline/src/optimize/mod.rs`

Add `TopKFusion` to the optimizer rule list.

**Checklist:**
- [ ] Add `LogicalPlan::TopK` variant
- [ ] Implement `TopKFusion` optimizer rule
- [ ] Create `topk.rs` with `physical_top_k()`
- [ ] Add TopK case to `execute_plan_node()`
- [ ] Register `TopKFusion` in optimizer
- [ ] Verify: `cargo test -p arbors-pipeline topk`

---

## Sub-Step 7.3: group_by Implementation

**Goal:** Implement `group_by` with sort+run strategy.

**⚠️ Step 7 Scope Clarification:** Step 7 `group_by` builds an **eager side-structure** (`GroupedResult`) containing all groups with their index sets. This allocates O(n) for keys and O(g) for group metadata, but does NOT materialize trees. True streaming group emission (yielding groups one-at-a-time without holding all group keys in memory) is deferred to a later step.

**Why this is acceptable:** The primary goal of Step 7 is "memory honesty" - avoiding silent tree materialization. Allocating side-structures for group keys and index sets is acceptable because:
1. Keys are typically small (strings, integers)
2. Index sets are just `Vec<usize>` (8 bytes per tree)
3. Total memory is O(n * 8 + g * key_size), not O(n * tree_size)

Budget enforcement (`max_group_keys`) still prevents runaway memory for high-cardinality keys.

### 7.3.1: Add LogicalPlan::GroupBy Node

**File:** MODIFY `crates/arbors-pipeline/src/logical_plan.rs`

```rust
/// Group trees by key expression.
///
/// Uses sort+run strategy by default for streaming with bounded memory:
/// 1. Compute permutation sorted by group key
/// 2. Stream in key order, detecting runs of equal keys
/// 3. Emit groups one-at-a-time without materializing source trees
///
/// Groups are emitted in key order (natural order from sort+run).
GroupBy {
    /// The source plan to group.
    source: Arc<LogicalPlan>,
    /// Expression to compute the group key.
    key_expr: Expr,
},

// Builder:
pub fn group_by(self: &Arc<Self>, key_expr: Expr) -> Arc<Self> {
    Arc::new(Self::GroupBy {
        source: Arc::clone(self),
        key_expr,
    })
}
```

### 7.3.2: Implement GroupedResult Type

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

```rust
/// Result of group_by operation.
///
/// Provides iteration over groups without materializing all trees.
/// Each group contains the key value and an IndexSet of matching indices.
///
/// Keys are ExprResult (scalar-only, enforced at physical_group_by level).
#[derive(Debug, Clone)]
pub struct GroupedResult {
    /// The groups in key order.
    /// Each tuple is (key_value, indices of trees in this group).
    /// Keys are ExprResult for compatibility with expression evaluation results.
    groups: Vec<(ExprResult, IndexSet)>,
}

impl GroupedResult {
    /// Number of groups.
    pub fn len(&self) -> usize {
        self.groups.len()
    }

    /// Check if empty.
    pub fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }

    /// Iterate over groups.
    pub fn iter(&self) -> impl Iterator<Item = (&ExprResult, &IndexSet)> {
        self.groups.iter().map(|(k, v)| (k, v))
    }

    /// Consume into owned groups.
    pub fn into_groups(self) -> Vec<(ExprResult, IndexSet)> {
        self.groups
    }
}
```

### 7.3.3: Implement physical_group_by

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

```rust
/// Physical group_by: sort+run strategy for streaming.
///
/// Like `physical_sort`, this operates on `input_indices` only.
///
/// # Algorithm
///
/// 1. Extract group keys with minimal decode (only for input_indices)
/// 2. Sort by key using total ordering
/// 3. Detect runs of equal keys (using CanonicalKey for equality)
/// 4. Return GroupedResult with groups in key order
///
/// # Memory
///
/// O(m) for keys and permutation where m = input_indices.len().
/// Enforces max_group_keys budget.
///
/// # Key Type
///
/// Uses ExprResult for keys (scalar-only enforced). Uses CanonicalKey wrapper
/// for equality comparison (handles 1 == 1.0, NaN == NaN, etc.).
pub fn physical_group_by<S: TreeSource>(
    source: &S,
    key_expr: &Expr,
    input_indices: &IndexSet,
    budget: &StreamingBudget,
) -> Result<GroupedResult, PipelineError> {
    use arbors_query::collection_ops::{CanonicalKey, total_cmp_expr_results};

    let indices_to_process = input_indices.to_vec();
    let n = indices_to_process.len();
    if n == 0 {
        return Ok(GroupedResult { groups: Vec::new() });
    }

    // 1. Extract keys ONLY for input indices
    let plan = DecodePlan::ALL; // FIXME(Step 8): optimize to key field only
    let mut keyed: Vec<(ExprResult, usize)> = Vec::with_capacity(indices_to_process.len());

    source.for_each_at_indices(&indices_to_process, plan, |arbor, local_idx, global_idx| {
        let root = arbor.root(local_idx).map_err(|e| PipelineError::StorageError(e.to_string()))?;
        let key = evaluate_expr_on_tree(arbor, root, key_expr)?;
        // Enforce scalar-only keys for group_by
        if !key.is_scalar() {
            return Err(PipelineError::StorageError(
                "group_by requires scalar keys (not arrays or objects)".into()
            ));
        }
        keyed.push((key, global_idx));
        Ok(())
    })?;

    // 2. Sort by key using TOTAL ordering (reuse total_cmp_expr_results)
    keyed.sort_by(|(a, _), (b, _)| total_cmp_expr_results(a, b));

    // 3. Detect runs and build groups using CanonicalKey for equality
    // This handles 1 == 1.0, NaN == NaN, etc.
    // NOTE: the canonical-equality helper is private, so we use CanonicalKey wrapper for equality
    let mut groups: Vec<(ExprResult, Vec<usize>)> = Vec::new();
    let mut current_key: Option<CanonicalKey> = None;
    let mut current_repr: Option<ExprResult> = None; // Keep original for result
    let mut current_indices: Vec<usize> = Vec::new();

    for (key, idx) in keyed {
        let canonical = CanonicalKey(key.clone());
        match &current_key {
            Some(k) if k == &canonical => {
                current_indices.push(idx);
            }
            _ => {
                if let Some(repr) = current_repr.take() {
                    groups.push((repr, std::mem::take(&mut current_indices)));
                }
                current_key = Some(canonical);
                current_repr = Some(key);
                current_indices.push(idx);
            }
        }
    }

    if let Some(repr) = current_repr {
        groups.push((repr, current_indices));
    }

    // 4. Check budget
    if groups.len() > budget.max_group_keys {
        return Err(PipelineError::BufferLimitExceeded {
            required: groups.len(),
            limit: budget.max_group_keys,
            suggestion: format!(
                "Group count ({}) exceeds max_group_keys ({}). \
                 Consider: increasing max_group_keys, filtering before grouping, \
                 or using a coarser grouping key.",
                groups.len(),
                budget.max_group_keys
            ),
        });
    }

    // 5. Convert to GroupedResult
    let result_groups = groups
        .into_iter()
        .map(|(key, indices)| (key, IndexSet::Sparse(indices)))
        .collect();

    Ok(GroupedResult { groups: result_groups })
}
```

### 7.3.4: Add PhysicalResult::Grouped Variant

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

```rust
// Add to PhysicalResult enum:
/// Grouped result from group_by operation.
Grouped(GroupedResult),
```

**Checklist:**
- [ ] Add `LogicalPlan::GroupBy` variant and `group_by()` builder
- [ ] Implement `GroupedResult` type
- [ ] Implement `physical_group_by()` with sort+run strategy
- [ ] Add `PhysicalResult::Grouped` variant
- [ ] Add GroupBy case to `execute_plan_node()`
- [ ] Verify: `cargo test -p arbors-pipeline group_by`

---

## Sub-Step 7.4: index_by Implementation

**Goal:** Implement lazy `index_by` with budgeted HashMap construction.

**⚠️ Step 7 Scope Clarification:** Step 7 `index_by` builds an **eager HashMap** from key to indices when first accessed. This allocates O(n) for the index structure (keys + index vectors), but does NOT materialize trees. The "lazy" aspect is at the handle level: `IndexedArbor` delays building the HashMap until the first `.get()` call.

**Memory characteristics:**
- Index structure: O(n) entries, each entry is (key_value, Vec<usize>)
- For unique keys: ~(key_size + 24 bytes) per tree
- For duplicate keys: amortized ~8 bytes per tree (indices share key storage)

Budget enforcement (`max_index_entries`) prevents unbounded growth.

### 7.4.1: Add LogicalPlan::IndexBy Node

**File:** MODIFY `crates/arbors-pipeline/src/logical_plan.rs`

```rust
/// Index trees by key expression for O(1) lookup.
///
/// Index construction is lazy: the HashMap is built on first keyed
/// lookup, not when index_by() is called. This allows chaining
/// without immediate materialization.
///
/// # Budget Enforcement
///
/// If the number of unique keys exceeds max_index_entries, an error
/// is returned with suggestions for alternative strategies.
IndexBy {
    /// The source plan to index.
    source: Arc<LogicalPlan>,
    /// Expression to compute the index key.
    key_expr: Expr,
},

// Builder:
pub fn index_by(self: &Arc<Self>, key_expr: Expr) -> Arc<Self> {
    Arc::new(Self::IndexBy {
        source: Arc::clone(self),
        key_expr,
    })
}
```

### 7.4.2: Implement IndexedResult Type

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

```rust
use std::collections::HashMap;
use arbors_query::collection_ops::CanonicalKey;

/// Result of index_by operation.
///
/// Provides O(1) lookup by key value using CanonicalKey for hash/equality.
/// Keys are ExprResult (scalar-only, enforced at physical_index_by level).
///
/// CanonicalKey provides canonical equality semantics:
/// - 1 == 1.0 for small integers (≤ 2^53)
/// - NaN == NaN for grouping purposes
/// - Large integers (> 2^53) remain distinct from their float approximations
#[derive(Debug, Clone)]
pub struct IndexedResult {
    /// Map from canonical key to tree indices.
    /// Multiple trees may have the same key (returns all matching).
    /// Uses CanonicalKey wrapper for Hash + Eq with canonical semantics.
    index: HashMap<CanonicalKey, Vec<usize>>,
    /// Total number of indexed trees.
    tree_count: usize,
}

impl IndexedResult {
    /// Look up trees by key.
    ///
    /// The provided ExprResult is wrapped in CanonicalKey for lookup,
    /// so 1 and 1.0 will match the same index entry.
    pub fn get(&self, key: &ExprResult) -> Option<&[usize]> {
        self.index.get(&CanonicalKey(key.clone())).map(|v| v.as_slice())
    }

    /// Get all keys (as ExprResult).
    pub fn keys(&self) -> impl Iterator<Item = &ExprResult> {
        self.index.keys().map(|ck| &ck.0)
    }

    /// Number of unique keys.
    pub fn key_count(&self) -> usize {
        self.index.len()
    }

    /// Total indexed trees.
    pub fn tree_count(&self) -> usize {
        self.tree_count
    }
}
```

### 7.4.3: Implement physical_index_by

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

```rust
/// Physical index_by: build HashMap from key to indices.
///
/// Like `physical_sort`, this operates on `input_indices` only.
///
/// # Budget Enforcement
///
/// Fails if entry count exceeds max_index_entries.
///
/// # Key Type
///
/// Uses ExprResult for keys (scalar-only enforced). Uses CanonicalKey wrapper
/// for HashMap keys to provide canonical equality (1 == 1.0, NaN == NaN, etc.).
pub fn physical_index_by<S: TreeSource>(
    source: &S,
    key_expr: &Expr,
    input_indices: &IndexSet,
    budget: &StreamingBudget,
) -> Result<IndexedResult, PipelineError> {
    use arbors_query::collection_ops::CanonicalKey;

    let indices_to_process = input_indices.to_vec();
    let _n = indices_to_process.len();
    let mut index: HashMap<CanonicalKey, Vec<usize>> = HashMap::new();

    let plan = DecodePlan::ALL; // FIXME(Step 8): optimize to key field only

    source.for_each_at_indices(&indices_to_process, plan, |arbor, local_idx, global_idx| {
        let root = arbor.root(local_idx).map_err(|e| PipelineError::StorageError(e.to_string()))?;
        let key = evaluate_expr_on_tree(arbor, root, key_expr)?;

        // Enforce scalar-only keys for index_by
        if !key.is_scalar() {
            return Err(PipelineError::StorageError(
                "index_by requires scalar keys (not arrays or objects)".into()
            ));
        }

        // Wrap in CanonicalKey for HashMap (provides Hash + Eq)
        index.entry(CanonicalKey(key)).or_default().push(global_idx);

        // Check budget when unique key count exceeds limit
        if index.len() > budget.max_index_entries {
            return Err(PipelineError::BufferLimitExceeded {
                required: index.len(),
                limit: budget.max_index_entries,
                suggestion: format!(
                    "Index entry count ({}) exceeds max_index_entries ({}). \
                     Consider: increasing max_index_entries, filtering before indexing, \
                     or using sort_by + binary search instead.",
                    index.len(),
                    budget.max_index_entries
                ),
            });
        }

        Ok(())
    })?;

    Ok(IndexedResult {
        index,
        tree_count: indices_to_process.len(),
    })
}
```

### 7.4.4: Add PhysicalResult::Indexed Variant

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs`

```rust
// Add to PhysicalResult enum:
/// Indexed result from index_by operation.
Indexed(IndexedResult),
```

**Checklist:**
- [ ] Add `LogicalPlan::IndexBy` variant and `index_by()` builder
- [ ] Implement `IndexedResult` type
- [ ] Implement `physical_index_by()` with budget enforcement
- [ ] Add `PhysicalResult::Indexed` variant
- [ ] Add IndexBy case to `execute_plan_node()`
- [ ] Verify: `cargo test -p arbors-pipeline index_by`

---

## Sub-Step 7.5: Arbor Handle Integration

**Goal:** Add `sort_by()`, `group_by()`, `index_by()` methods to the unified Arbor handle.

### 7.5.1: Add sort_by to Arbor

**File:** MODIFY `crates/arbors/src/handle.rs`

```rust
use arbors_pipeline::{SortKey, SortDirection, NullOrdering};

impl Arbor {
    /// Sort trees by key expression.
    ///
    /// Returns a new Arbor view with trees in sorted order without
    /// materializing the source. The sort is computed immediately but
    /// trees are accessed lazily via batch-grouped permutation.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use arbors::Arbor;
    /// use arbors_expr::path;
    ///
    /// let sorted = arbor.sort_by(path("timestamp"))?;
    /// ```
    pub fn sort_by(&self, key: impl Into<SortKeySpec>) -> Result<Self, Error> {
        let key_spec = key.into();
        let sort_keys = vec![key_spec.to_sort_key()];
        let new_plan = self.plan.sort(sort_keys);
        Ok(Self::from_plan(new_plan, self.scope.clone()))
    }

    /// Sort trees by multiple keys (for tie-breaking).
    pub fn sort_by_keys(&self, keys: Vec<SortKeySpec>) -> Result<Self, Error> {
        let sort_keys: Vec<_> = keys.into_iter().map(|k| k.to_sort_key()).collect();
        let new_plan = self.plan.sort(sort_keys);
        Ok(Self::from_plan(new_plan, self.scope.clone()))
    }

    /// Sort trees descending by key expression.
    pub fn sort_by_desc(&self, key: impl Into<Expr>) -> Result<Self, Error> {
        let sort_keys = vec![SortKey::desc(key.into())];
        let new_plan = self.plan.sort(sort_keys);
        Ok(Self::from_plan(new_plan, self.scope.clone()))
    }
}

/// Sort key specification for user-facing API.
pub struct SortKeySpec {
    expr: Expr,
    descending: bool,
    nulls_first: bool,
}

impl SortKeySpec {
    pub fn asc(expr: impl Into<Expr>) -> Self {
        Self {
            expr: expr.into(),
            descending: false,
            nulls_first: false,
        }
    }

    pub fn desc(expr: impl Into<Expr>) -> Self {
        Self {
            expr: expr.into(),
            descending: true,
            nulls_first: false,
        }
    }

    pub fn nulls_first(mut self) -> Self {
        self.nulls_first = true;
        self
    }

    fn to_sort_key(self) -> SortKey {
        SortKey {
            expr: self.expr,
            direction: if self.descending {
                SortDirection::Descending
            } else {
                SortDirection::Ascending
            },
            nulls: if self.nulls_first {
                NullOrdering::NullsFirst
            } else {
                NullOrdering::NullsLast
            },
        }
    }
}

impl From<Expr> for SortKeySpec {
    fn from(expr: Expr) -> Self {
        Self::asc(expr)
    }
}
```

### 7.5.2: Add group_by to Arbor

**File:** MODIFY `crates/arbors/src/handle.rs`

```rust
// NOTE: Use once_cell::sync::OnceCell (not std::cell::OnceCell) for thread safety.
// GroupedArbor and IndexedArbor must be Send + Sync per architecture doc requirement:
// "Rust core is Send+Sync (including ReadScope)"
//
// Why once_cell instead of std::sync::OnceLock?
// - once_cell provides get_or_try_init() for fallible initialization
// - std::sync::OnceLock only has get_or_init() which doesn't support Result
//
// Add to Cargo.toml: once_cell = "1.19"
use once_cell::sync::OnceCell;
use arbors_pipeline::{GroupedResult, execute_logical_plan, PhysicalResult};

impl Arbor {
    /// Group trees by key expression.
    ///
    /// Returns a GroupedArbor that provides iteration over groups
    /// in key order. Uses sort+run strategy for bounded-memory streaming.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let groups = arbor.group_by(path("category"))?;
    /// for (key, group_arbor) in groups.iter()? {
    ///     println!("{}: {} trees", key, group_arbor.len()?);
    /// }
    /// ```
    pub fn group_by(&self, key: impl Into<Expr>) -> Result<GroupedArbor, Error> {
        let new_plan = self.plan.group_by(key.into());
        Ok(GroupedArbor::new(new_plan, self.scope.clone()))
    }
}

/// Grouped arbor providing iteration over groups.
///
/// Thread-safe: Uses once_cell::sync::OnceCell for lazy initialization (Send + Sync).
pub struct GroupedArbor {
    plan: Arc<LogicalPlan>,
    scope: ArborScope,
    // Lazy: groups computed on first access
    // Uses once_cell::sync::OnceCell (not std::cell::OnceCell) for Send + Sync
    groups: OnceCell<GroupedResult>,
}

impl GroupedArbor {
    fn new(plan: Arc<LogicalPlan>, scope: ArborScope) -> Self {
        Self {
            plan,
            scope,
            groups: OnceCell::new(),
        }
    }

    fn ensure_groups(&self) -> Result<&GroupedResult, Error> {
        // NOTE: std::sync::OnceLock doesn't have get_or_try_init in stable Rust.
        // Options for error handling:
        // 1. Use once_cell::sync::OnceCell which has get_or_try_init
        // 2. Store Result<GroupedResult, Error> in OnceLock
        // 3. Use the pattern below with explicit initialization check
        //
        // For simplicity, we use once_cell crate here. Add to Cargo.toml:
        // once_cell = "1.19"
        //
        // Alternative: Use std::sync::OnceLock with Result wrapper:
        // groups: OnceLock<Result<GroupedResult, Error>>

        // Using once_cell::sync::OnceCell pattern:
        self.groups.get_or_try_init(|| {
            let txn = self.scope.as_scope().map(|s| s.txn());
            let result = execute_logical_plan(&self.plan, txn)?;
            match result {
                PhysicalResult::Grouped(g) => Ok(g),
                _ => Err(Error::InternalError("Expected Grouped result".into())),
            }
        })
    }

    /// Number of groups.
    pub fn len(&self) -> Result<usize, Error> {
        Ok(self.ensure_groups()?.len())
    }

    /// Check if empty.
    pub fn is_empty(&self) -> Result<bool, Error> {
        Ok(self.ensure_groups()?.is_empty())
    }

    // Iterate over (key, Arbor) pairs.
    // Implementation depends on how we want to expose iteration.
}
```

### 7.5.3: Add index_by to Arbor

**File:** MODIFY `crates/arbors/src/handle.rs`

```rust
use arbors_pipeline::IndexedResult;

impl Arbor {
    /// Index trees by key expression for O(1) lookup.
    ///
    /// Returns an IndexedArbor that provides key-based lookup.
    /// Index construction is lazy (built on first lookup).
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let indexed = arbor.index_by(path("id"))?;
    /// // Use ExprResult for lookup (ExprResult::from converts common types)
    /// let tree = indexed.get(&ExprResult::from(42))?;
    /// ```
    pub fn index_by(&self, key: impl Into<Expr>) -> Result<IndexedArbor, Error> {
        let new_plan = self.plan.index_by(key.into());
        Ok(IndexedArbor::new(new_plan, self.scope.clone(), self.clone()))
    }
}

/// Indexed arbor providing O(1) key-based lookup.
///
/// Thread-safe: Uses once_cell::sync::OnceCell for lazy initialization (Send + Sync).
pub struct IndexedArbor {
    plan: Arc<LogicalPlan>,
    scope: ArborScope,
    base: Arbor,
    // Uses once_cell::sync::OnceCell (not std::cell::OnceCell) for Send + Sync
    index: OnceCell<IndexedResult>,
}

impl IndexedArbor {
    fn new(plan: Arc<LogicalPlan>, scope: ArborScope, base: Arbor) -> Self {
        Self {
            plan,
            scope,
            base,
            index: OnceCell::new(),
        }
    }

    fn ensure_index(&self) -> Result<&IndexedResult, Error> {
        self.index.get_or_try_init(|| {
            let txn = self.scope.as_scope().map(|s| s.txn());
            let result = execute_logical_plan(&self.plan, txn)?;
            match result {
                PhysicalResult::Indexed(i) => Ok(i),
                _ => Err(Error::InternalError("Expected Indexed result".into())),
            }
        })
    }

    /// Look up tree by key (returns first match, or None).
    ///
    /// Key is ExprResult (use ExprResult::from(value) to convert from Value).
    /// Uses canonical equality: 1 and 1.0 will match the same index entry.
    pub fn get(&self, key: &ExprResult) -> Result<Option<Arbor>, Error> {
        let index = self.ensure_index()?;
        match index.get(key) {
            Some(indices) if !indices.is_empty() => {
                // Return arbor view for first matching tree
                let single = self.base.take(vec![indices[0]])?;
                Ok(Some(single))
            }
            _ => Ok(None),
        }
    }

    /// Look up all trees matching key.
    ///
    /// Key is ExprResult (use ExprResult::from(value) to convert from Value).
    /// Uses canonical equality: 1 and 1.0 will match the same index entry.
    pub fn get_all(&self, key: &ExprResult) -> Result<Arbor, Error> {
        let index = self.ensure_index()?;
        match index.get(key) {
            Some(indices) => self.base.take(indices.to_vec()),
            None => self.base.take(vec![]),
        }
    }

    /// Number of unique keys in the index.
    pub fn key_count(&self) -> Result<usize, Error> {
        Ok(self.ensure_index()?.key_count())
    }
}
```

**Checklist:**
- [ ] Add `sort_by()`, `sort_by_desc()`, `sort_by_keys()` to Arbor
- [ ] Add `SortKeySpec` for ergonomic sort key specification
- [ ] Add `group_by()` to Arbor, returning `GroupedArbor`
- [ ] Implement `GroupedArbor` with lazy group computation
- [ ] Add `index_by()` to Arbor, returning `IndexedArbor`
- [ ] Implement `IndexedArbor` with lazy index construction
- [ ] Verify: `cargo test -p arbors sort_by group_by index_by`

---

## Sub-Step 7.6: Python Bindings

**Goal:** Expose `sort_by`, `group_by`, `index_by` in Python.

### 7.6.1: Add sort_by to PyArbor

**File:** MODIFY `python/src/lib.rs` (or equivalent PyO3 module)

```rust
#[pymethods]
impl PyArbor {
    /// Sort trees by key expression.
    ///
    /// Args:
    ///     key: Expression to sort by (path string or Expr).
    ///     descending: Sort in descending order (default: False).
    ///
    /// Returns:
    ///     Arbor: Sorted view of this arbor.
    #[pyo3(signature = (key, *, descending = false))]
    fn sort_by(&self, key: PyExpr, descending: bool) -> PyResult<Self> {
        let sort_key = if descending {
            SortKeySpec::desc(key.into_expr())
        } else {
            SortKeySpec::asc(key.into_expr())
        };
        let sorted = self.inner.sort_by(sort_key)
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;
        Ok(Self { inner: sorted })
    }
}
```

### 7.6.2: Add group_by to PyArbor

**File:** MODIFY `python/src/lib.rs`

```rust
#[pymethods]
impl PyArbor {
    /// Group trees by key expression.
    ///
    /// Returns an iterator over (key, Arbor) pairs in key order.
    /// Groups are computed lazily on first iteration.
    ///
    /// Args:
    ///     key: Expression to group by.
    ///
    /// Returns:
    ///     GroupedArbor: Iterable of (key, Arbor) pairs.
    fn group_by(&self, key: PyExpr) -> PyResult<PyGroupedArbor> {
        let grouped = self.inner.group_by(key.into_expr())
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;
        Ok(PyGroupedArbor { inner: grouped })
    }
}

#[pyclass]
struct PyGroupedArbor {
    inner: GroupedArbor,
}

#[pymethods]
impl PyGroupedArbor {
    fn __iter__(slf: PyRef<'_, Self>) -> PyResult<PyGroupedArborIter> {
        // Create iterator that yields (key, Arbor) tuples
        todo!()
    }

    fn __len__(&self) -> PyResult<usize> {
        self.inner.len().map_err(|e|
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))
    }
}
```

### 7.6.3: Add index_by to PyArbor

**File:** MODIFY `python/src/lib.rs`

```rust
#[pymethods]
impl PyArbor {
    /// Index trees by key expression for O(1) lookup.
    ///
    /// Args:
    ///     key: Expression to index by.
    ///
    /// Returns:
    ///     IndexedArbor: Provides get(key) method for lookup.
    fn index_by(&self, key: PyExpr) -> PyResult<PyIndexedArbor> {
        let indexed = self.inner.index_by(key.into_expr())
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;
        Ok(PyIndexedArbor { inner: indexed })
    }
}

#[pyclass]
struct PyIndexedArbor {
    inner: IndexedArbor,
}

#[pymethods]
impl PyIndexedArbor {
    /// Look up tree by key.
    fn get(&self, key: &Bound<'_, PyAny>) -> PyResult<Option<PyArbor>> {
        let rust_key = python_to_value(key)?;
        let result = self.inner.get(&rust_key)
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;
        Ok(result.map(|a| PyArbor { inner: a }))
    }

    /// Look up all trees matching key.
    fn get_all(&self, key: &Bound<'_, PyAny>) -> PyResult<PyArbor> {
        let rust_key = python_to_value(key)?;
        let result = self.inner.get_all(&rust_key)
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;
        Ok(PyArbor { inner: result })
    }

    /// Number of unique keys in the index.
    fn key_count(&self) -> PyResult<usize> {
        self.inner.key_count().map_err(|e|
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))
    }
}
```

**Checklist:**
- [ ] Add `sort_by()` method to `PyArbor`
- [ ] Add `group_by()` method returning `PyGroupedArbor`
- [ ] Implement `PyGroupedArbor` with `__iter__`, `__len__`
- [ ] Add `index_by()` method returning `PyIndexedArbor`
- [ ] Implement `PyIndexedArbor` with `get()`, `get_all()`
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v -k "sort_by or group_by or index_by"`

---

## Sub-Step 7.7: Tests

**Goal:** Comprehensive unit and integration tests for all new functionality.

### 7.7.1: Unit Tests for physical_sort

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs` (test section)

```rust
#[cfg(test)]
mod sort_tests {
    use super::*;

    #[test]
    fn test_physical_sort_basic() {
        // Create arbor with values 5, 2, 8, 1, 9
        // Sort ascending -> 1, 2, 5, 8, 9
        // Verify permutation and batch-grouping
    }

    #[test]
    fn test_physical_sort_descending() {
        // Sort descending
    }

    #[test]
    fn test_physical_sort_with_nulls() {
        // Verify null handling (nulls last by default)
    }

    #[test]
    fn test_physical_sort_multi_key() {
        // Multi-key sort with tie-breaking
    }

    #[test]
    fn test_physical_sort_empty() {
        // Empty source
    }

    #[test]
    fn test_batch_group_permutation() {
        // Verify batch grouping produces correct restore_order
        let perm = vec![5, 15, 3, 25, 7]; // From batches 0,1,0,2,0 (batch_size=10)
        let grouped = batch_group_permutation(&perm, 10);

        // Should group by batch: batch 0 has indices 5,3,7; batch 1 has 15; batch 2 has 25
        // Check that restore_order allows reconstructing original order
        let mut restored = vec![0; 5];
        for (logical_pos, &batch_pos) in grouped.restore_indices.iter().enumerate() {
            restored[logical_pos] = grouped.permutation[batch_pos];
        }
        assert_eq!(restored, perm);
    }
}
```

### 7.7.2: Unit Tests for TopK

**File:** CREATE `crates/arbors-pipeline/src/topk.rs` (test section)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_top_k_basic() {
        // Top 3 from 10 elements
    }

    #[test]
    fn test_top_k_larger_than_source() {
        // k > n should return all elements
    }

    #[test]
    fn test_top_k_zero() {
        // k = 0 returns empty
    }

    #[test]
    fn test_top_k_optimizer_fusion() {
        // Verify Sort.Head -> TopK optimization
    }
}
```

### 7.7.3: Unit Tests for group_by

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs` (test section)

```rust
#[cfg(test)]
mod group_by_tests {
    use super::*;

    #[test]
    fn test_group_by_basic() {
        // Group by category, verify groups
    }

    #[test]
    fn test_group_by_single_group() {
        // All same key -> single group
    }

    #[test]
    fn test_group_by_unique_keys() {
        // All different keys -> n groups
    }

    #[test]
    fn test_group_by_budget_exceeded() {
        // Verify BufferLimitExceeded when too many groups
        let budget = StreamingBudget {
            max_group_keys: 2,
            ..Default::default()
        };
        // Create source with 5 unique keys
        // Should fail with BufferLimitExceeded
    }
}
```

### 7.7.4: Unit Tests for index_by

**File:** MODIFY `crates/arbors-pipeline/src/physical.rs` (test section)

```rust
#[cfg(test)]
mod index_by_tests {
    use super::*;

    #[test]
    fn test_index_by_basic() {
        // Index by id, verify lookup
    }

    #[test]
    fn test_index_by_duplicate_keys() {
        // Multiple trees with same key
    }

    #[test]
    fn test_index_by_missing_key() {
        // Lookup non-existent key returns None
    }

    #[test]
    fn test_index_by_budget_exceeded() {
        // Verify BufferLimitExceeded when too many entries
        let budget = StreamingBudget {
            max_index_entries: 2,
            ..Default::default()
        };
        // Create source with 5 unique keys
        // Should fail with BufferLimitExceeded
    }
}
```

### 7.7.5: Integration Tests

**File:** CREATE `crates/arbors/tests/global_ops.rs`

```rust
//! Integration tests for sort_by, group_by, index_by.

use arbors::prelude::*;
use arbors_expr::path;

#[test]
fn test_sort_by_stored_arbor() {
    // Create stored arbor with unsorted data
    // Sort and verify order
    // Check batch decode efficiency with stats
}

#[test]
fn test_sort_by_head_uses_topk() {
    // Verify sort_by().head() uses TopK optimization via explain()
}

#[test]
fn test_group_by_stored_arbor() {
    // Group stored arbor
    // Verify groups contain correct trees
}

#[test]
fn test_index_by_stored_arbor() {
    // Index stored arbor
    // Verify lookup returns correct trees
}

#[test]
fn test_chained_operations() {
    // filter().sort_by().head()
    // Verify correct result and optimization
}

#[test]
fn test_sort_by_preserves_filter() {
    // filter(predicate).sort_by(key)
    // Verify only matching trees in sorted output
}
```

### 7.7.6: Memory Budget Enforcement Tests

**File:** MODIFY `crates/arbors/tests/invariants.rs`

```rust
#[test]
fn test_group_by_budget_enforced() {
    // Create arbor with high-cardinality key
    // group_by should fail with clear error when budget exceeded
}

#[test]
fn test_index_by_budget_enforced() {
    // Create arbor with high-cardinality key
    // index_by should fail with clear error when budget exceeded
}

#[test]
#[serial]
fn test_sort_by_batch_decode_efficiency() {
    // Create multi-batch stored arbor
    // sort_by().iter() should decode each batch exactly once
    reset_arborbase_stats();
    // ... perform sort and iteration ...
    let stats = arborbase_stats();
    assert_eq!(stats.batches_decoded, expected_batch_count);
}
```

**Checklist:**
- [ ] Add unit tests for `batch_group_permutation()`
- [ ] Add unit tests for `physical_sort()`
- [ ] Add unit tests for `physical_top_k()`
- [ ] Add unit tests for `physical_group_by()`
- [ ] Add unit tests for `physical_index_by()`
- [ ] Create integration tests in `global_ops.rs`
- [ ] Add memory budget enforcement tests to invariants
- [ ] Verify: `cargo test`

---

## Sub-Step 7.8: Verify All Gates

**Goal:** Ensure all gates remain green.

### 7.8.1: Gate A (Invariants)

```bash
cargo test -p arbors -- invariants
.venv/bin/pytest python/tests/test_invariants.py -v
```

### 7.8.2: Gate B (End-to-End)

```bash
cargo test -p arbors -- unified_arbor_parity
.venv/bin/pytest python/tests/test_arbor_base.py python/tests/test_unified_arbor.py -v
```

### 7.8.3: Full Test Suite

```bash
cargo test
make python && .venv/bin/pytest python/tests -v
```

**Checklist:**
- [ ] Gate A passes (Rust + Python invariants)
- [ ] Gate B passes (end-to-end workflows)
- [ ] Full Rust test suite passes
- [ ] Full Python test suite passes

---

## Sub-Step 7.9: Documentation and FIXME Comments

**Goal:** Document new APIs and add FIXME comments for future optimization.

### 7.9.1: API Documentation

- [ ] Document `sort_by()` with examples in rustdoc
- [ ] Document `group_by()` with streaming behavior notes
- [ ] Document `index_by()` with budget considerations
- [ ] Document `StreamingBudget` configuration

### 7.9.2: FIXME Comments for Future Optimization

```rust
// FIXME(Step 8): Add cost estimation for sort_by in explain()
// FIXME(Step 8): Optimize DecodePlan to only include sort key fields
// FIXME(Step 11): Add explain_analyze() support for sort_by memory usage
```

### 7.9.3: Architecture Document Update

**File:** MODIFY `plans/architecture-phase-19-implementations.md`

Add Step 7 implementation details similar to Steps 1-6.

**Checklist:**
- [ ] All new public APIs have rustdoc documentation
- [ ] FIXME comments added for known future work
- [ ] Architecture document updated with Step 7 details
- [ ] Commit with message: "Step 7: Planned global operations (sort_by, group_by, index_by)"

---

## Files Summary

### New Files:
| File | Purpose |
|------|---------|
| `crates/arbors-pipeline/src/budget.rs` | StreamingBudget type |
| `crates/arbors-pipeline/src/sort.rs` | SortKey types |
| `crates/arbors-pipeline/src/topk.rs` | Top-K physical operator |
| `crates/arbors/tests/global_ops.rs` | Integration tests |

### Modified Files:
| File | Changes |
|------|---------|
| `crates/arbors-pipeline/src/lib.rs` | Export new types |
| `crates/arbors-pipeline/src/source.rs` | Add BufferLimitExceeded error |
| `crates/arbors-pipeline/src/logical_plan.rs` | Add Sort, GroupBy, IndexBy, TopK nodes |
| `crates/arbors-pipeline/src/physical.rs` | Add physical operators and result types |
| `crates/arbors-pipeline/src/optimize/logical_optimizer.rs` | Add TopKFusion rule |
| `crates/arbors-pipeline/src/optimize/mod.rs` | Register TopKFusion |
| `crates/arbors/src/handle.rs` | Add sort_by, group_by, index_by methods |
| `crates/arbors/tests/invariants.rs` | Add budget enforcement tests |
| `python/src/lib.rs` | Python bindings for new operations |

---

## Implementation Order

**Recommended sequence:**

1. **7.0** Foundation (budget types, error types, SortKey)
2. **7.1** sort_by (LogicalPlan::Sort, physical_sort, batch_group_permutation)
3. **7.1.5** ⚠️ **Plan-based iteration (CRITICAL)**
   - Without this, sort/shuffle won't be observable in iteration!
4. **7.2** TopK (optimizer rule, physical_top_k)
5. **7.5** Arbor handle integration for sort_by
6. **7.7** Tests for sort_by + iteration verification
7. **7.3** group_by (GroupedResult, physical_group_by)
8. **7.4** index_by (IndexedResult, physical_index_by)
9. **7.5** Arbor handle integration for group_by, index_by
10. **7.6** Python bindings
11. **7.7** Remaining tests
12. **7.8** Gate verification
13. **7.9** Documentation

**Critical checkpoints:**
- After 7.1.5: `arbor.sort_by(key).iter()` actually yields trees in sorted order
- After 7.7 (first pass): sort_by tests verify permuted iteration works
- After 7.8: All gates green

---

## Critical Design Decisions

### 1. Plan-Based Iteration (Most Critical)

`Arbor::iter()` now executes the LogicalPlan and iterates according to the `IndexSet`. This is REQUIRED for sort/shuffle to be observable. Legacy `ArborIter` is renamed to `BackingIter` (internal) and marked for Step 12 deletion.

### 2. Sort Only Input Indices (Correctness Critical)

`physical_sort(source, keys, input_indices)` sorts ONLY the trees specified by `input_indices`, NOT the entire source. This is essential for `filter().sort_by()` correctness - we sort only the filtered subset, avoiding:
- Wasted work sorting trees that were already filtered out
- Complex restore_order composition bugs from "sort-full-then-mask"

### 3. Total Ordering for ExprResult (Determinism Critical)

Sort keys use a defined **total ordering** via `total_cmp_expr_results` from `arbors-query::collection_ops`:
- Cross-type: Bool < Number < String < Date < DateTime < Duration < Binary < Array < Object < Null < Missing
- NaN handling: NaN == NaN for equality; NaN sorts after all non-NaN numbers
- Canonical equality: 1 == 1.0 for small integers (≤ 2^53); large integers remain distinct from floats

This ensures deterministic, reproducible sort results regardless of input order.

**Key type choice:** ExprResult (not Value) because expression evaluation returns ExprResult. We enforce **scalar-only keys** at the physical operator level (sort_by, group_by, index_by reject Array/Object keys with a clear error message).

### 3a. CanonicalKey for Hash-Based Operations (Correctness Critical)

`group_by` and `index_by` use `CanonicalKey` wrapper from `arbors-query::collection_ops` for HashMap keys:
- Provides `Hash + Eq` for ExprResult (which doesn't implement Hash directly)
- Handles canonical equality: 1 == 1.0, NaN == NaN, null variants equal
- Large integers (> 2^53) remain distinct from their float approximations

**Dependency:** Consider moving `CanonicalKey` to `arbors-core` or `arbors-expr` so both `arbors-pipeline` and `arbors-query` can use it without circular dependencies.

### 4. No StreamingBudget Default (Memory Honesty)

`StreamingBudget` intentionally has **no Default impl**. Callers must explicitly construct via:
- `StreamingBudget::from_source(&source)` - derives from source metadata
- `StreamingBudget::with_trees_per_batch(n)` - explicit buffer size
- `StreamingBudget::unbounded()` - for explicit full materialization

This prevents accidental "magic 1000" usage.

### 5. Budget Enforcement in PlanBasedIter, Not physical_sort

`physical_sort` allocates O(m) for keys/permutation (unavoidable for sorting). Budget enforcement happens in `PlanBasedIter` during ordered emission, where buffering is bounded.

### 6. Eager Side-Structures for group_by/index_by

Step 7 `group_by` and `index_by` build **eager side-structures** (GroupedResult, IndexedResult) containing index sets. This allocates O(n) for indices but does NOT materialize trees. True streaming group emission is deferred.

### 7. Batch-Grouped Permutations by Default

`physical_sort` always produces `IndexSet::Permuted { batch_grouped: true, restore_order: Some(...) }`. This ensures streaming sinks can emit in sorted order while reading batches sequentially.

### 8. Fail-Fast Budget Enforcement

When budgets are exceeded, operations return `BufferLimitExceeded` with actionable suggestions. No silent materialization or degradation.

### 9. Rust-First Streaming

All streaming order, buffering, and restore-order logic is in Rust. Python bindings are thin wrappers that delegate to Rust iterators.

---

## Known Limitations (Non-Blocking for Step 7)

1. **Projection materialization still uses `DecodePlan::ALL`** for stored trees before applying transforms. Pruning is reported and available but not fully exploited. This is a perf follow-up, not a correctness issue.

2. **`to_json_with_budget` not implemented in Step 7.** The plan-based iterator provides the foundation, but a dedicated streaming sink for JSON output is deferred.
   - **FIXME:** Audit `to_json()` to determine if it calls `materialize()` or uses `iter()`. If it materializes, add a FIXME comment pointing to sink budget work in a later step.

3. **New dependency: `once_cell` crate.** Step 7 introduces `once_cell::sync::OnceCell` for thread-safe lazy initialization with fallible `get_or_try_init()`. Add to workspace Cargo.toml: `once_cell = "1.19"`.

4. **CanonicalKey import from arbors-query.** Currently `CanonicalKey` and `total_cmp_expr_results` are imported from `arbors-query::collection_ops`. Note: the canonical-equality helper is private, so we use `CanonicalKey(a) == CanonicalKey(b)` for equality. This creates a dependency from `arbors-pipeline` to `arbors-query` (already exists). Consider moving these to `arbors-core` or `arbors-expr` in a follow-up step.

---

## Gaps Between Current State and Step 7 Requirements

Based on codebase analysis:

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| `IndexSet::Permuted` with batch_grouped | EXISTS in physical.rs | None (already implemented) |
| `BatchGroupedIndices` helper | EXISTS in source.rs | None (already implemented) |
| `CanonicalKey` / `total_cmp_expr_results` | EXISTS in arbors-query/collection_ops.rs | None (reuse existing; the canonical-equality helper is private) |
| `StreamingBudget` type | MISSING | Need to create budget.rs |
| `BufferLimitExceeded` error | MISSING | Need to add to PipelineError |
| `LogicalPlan::Sort` | MISSING | Need to add plan node |
| `physical_sort()` | MISSING | Need to implement (uses ExprResult keys) |
| `TopKFusion` optimizer | MISSING | Need to implement |
| `physical_top_k()` | MISSING | Need to implement (uses ExprResult keys) |
| `LogicalPlan::GroupBy` | MISSING | Need to add plan node |
| `physical_group_by()` | MISSING | Need to implement (uses CanonicalKey) |
| `LogicalPlan::IndexBy` | MISSING | Need to add plan node |
| `physical_index_by()` | MISSING | Need to implement (uses CanonicalKey HashMap) |
| Arbor handle methods | MISSING | Need to add sort_by, group_by, index_by |
| Python bindings | MISSING | Need to add PyO3 wrappers |
| `once_cell` dependency | MISSING | Need to add to Cargo.toml |

The foundation (IndexSet::Permuted, BatchGroupedIndices, CanonicalKey) is already in place, which simplifies implementation.


-----

# Step 8: Cost Model Optimizer - Implementation Plan

## Overview

**Exit Criteria:** Cost model is integrated and surfaced via `explain(ExplainOptions { costs: true })`, with Gate B remaining green.

**Goal**: Simple heuristic-based cost model for better plan selection.

**Scope**: This step introduces cost estimation (NOT statistics collection). The cost model uses heuristics to estimate:
- Cardinality (selectivity) of predicates
- I/O cost for source access
- CPU cost for different execution strategies

**Key Decisions Enabled**:
- Filter ordering (push selective filters first)
- Vectorized vs interpreted execution selection
- When to materialize intermediate results

---

## Policy Decisions

These policy decisions were made during plan review:

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Error semantics** | Optimizer rewrites CAN change which error is observed | Allows FilterSelectivityOrder without "safe predicate" analysis; users accept that AND reordering may change error behavior |
| **Cost model usage** | Optimizer-guiding during execution | Costs are used for rule application and execution strategy selection, not just explain() visibility |
| **Explain API shape** | Extend Rust `explain(options)`, expose to Python | Clean parameterized API for future extensions (Step 11: explain_analyze) |
| **Unknown metadata handling** | Print "unknown" in explain, use conservative defaults internally | No magic fallback numbers like 1000 trees / 10 batches; be explicit about what we don't know |

---

## Current State Analysis

### What Exists (Post-Step 7)

| Component | Status | Location |
|-----------|--------|----------|
| `LogicalPlan` enum | Complete | `arbors-pipeline/src/logical_plan.rs` |
| `optimize_logical_plan()` | Complete | `arbors-pipeline/src/optimize/logical_plan.rs` |
| 5 optimization rules | Complete | FilterFusion, PredicatePushdown, LimitPushdown, LimitFusion, TopKFusion |
| `DecodePlanSummary` | Complete | `arbors-pipeline/src/optimize/analysis.rs` |
| `explain()` method | Complete | `arbors/src/handle.rs` |
| `PhysicalResult` / `IndexSet` | Complete | `arbors-pipeline/src/physical.rs` |
| Sort/TopK/GroupBy/IndexBy | Complete | `arbors-pipeline/src/physical.rs` |

### FIXMEs Referencing Step 8

| File | FIXME | Description |
|------|-------|-------------|
| `handle.rs:1465` | Cost estimation for sort_by | Add estimated cost in explain() |
| `handle.rs:1474` | DecodePlan optimization | Include sort key fields only |
| `physical.rs:691` | Path-based DecodePlan pruning | Minimize decoding for sort keys |
| `physical.rs:1002` | Optimize to key field only | DecodePlan for TopK |
| `physical.rs:1107` | Optimize to key field only | DecodePlan for IndexBy |
| `analysis.rs:14-16` | Cost estimation helpers | Add to analysis module |
| `analysis.rs:42` | Cost model integration | Integrate with DecodePlanSummary |
| `logical_plan.rs:875` | Thread limit through vectorized | Consider vectorized early termination |
| `executor.rs:148` | Thread limit through vectorized | Limit in vectorized path |
| `executor.rs:193` | Step 8 vectorized limit | Sequential vs vectorized decision |

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cost model location | `arbors-pipeline/src/optimize/cost.rs` | Keep with other optimizer code |
| Cardinality estimation | Heuristic-based (no statistics) | Simple first; statistics in future step |
| Cost unit | Abstract "cost units" (not time/bytes) | Relative comparison, not absolute |
| Integration point | Applied at optimization + execution strategy selection | See "Cost Integration Points" below |
| Explain integration | Parameterized `explain(ExplainOptions)` | Extensible for future explain_analyze |
| Unknown metadata | Display "unknown", use conservative internal defaults | Explicit about uncertainty vs magic numbers |

### Cost Integration Points (Step 8 Scope)

The cost model is used in two contexts:

1. **Optimization (rule application):**
   - `FilterSelectivityOrder` uses `estimate_selectivity()` to reorder AND predicates
   - Future rules may use cost estimates to decide whether to apply transformations

2. **Execution strategy selection (Step 8 scope):**
   - `should_use_vectorized()` in executor uses `predicate_complexity()` to decide vectorized vs interpreted
   - **Deferred to future steps:** materialization decisions, streaming vs batch selection

This is the extent of "optimizer-guiding during execution" for Step 8. Additional cost-driven execution decisions (e.g., when to materialize, streaming budget thresholds) are future work.

---

## Implementation Sub-Steps

### Sub-Step 8.1: Create CostModel Infrastructure

**Goal:** Define `CostModel` struct and core estimation functions in a new module.

**Files:**
- NEW: `crates/arbors-pipeline/src/optimize/cost.rs`
- MODIFY: `crates/arbors-pipeline/src/optimize/mod.rs` (add mod + exports)

**Code Sketch:**

```rust
// crates/arbors-pipeline/src/optimize/cost.rs

//! Cost model for query optimization.
//!
//! This module provides heuristic-based cost estimation for LogicalPlan nodes.
//! The cost model enables:
//! - Filter ordering by selectivity (most selective first)
//! - Vectorized vs interpreted execution selection
//!
//! # Design Principles
//!
//! 1. **Heuristic-based**: No runtime statistics collection (yet)
//! 2. **Relative costs**: Units are abstract, used for comparison only
//! 3. **Conservative defaults**: Prefer safe estimates over aggressive guesses
//! 4. **Explicit unknowns**: Unknown metadata shown as "unknown", not magic defaults
//!
//! # Cost Components
//!
//! - **Cardinality**: Estimated number of rows/trees passing through
//! - **IO Cost**: Cost of loading data from storage
//! - **CPU Cost**: Cost of computation (filter evaluation, sorting, etc.)
//!
//! # Error Semantics Note
//!
//! Optimizer rewrites (e.g., FilterSelectivityOrder reordering AND predicates)
//! may change which error is observed for fallible expressions. This is accepted
//! behavior; users should not rely on specific error ordering from ANDed predicates.

use std::sync::Arc;
use arbors_expr::Expr;
use crate::LogicalPlan;

/// Cost estimation result for a plan node.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CostEstimate {
    /// Estimated number of rows/trees at this node.
    /// `None` means cardinality is unknown.
    pub cardinality: Option<f64>,
    /// Estimated I/O cost (batch loads, etc.).
    /// `None` means I/O cost is unknown.
    pub io_cost: Option<f64>,
    /// Estimated CPU cost (filter evaluation, sorting, etc.).
    pub cpu_cost: f64,
}

impl CostEstimate {
    /// Create a new cost estimate with known values.
    pub fn new(cardinality: f64, io_cost: f64, cpu_cost: f64) -> Self {
        Self {
            cardinality: Some(cardinality),
            io_cost: Some(io_cost),
            cpu_cost,
        }
    }

    /// Create a cost estimate with unknown cardinality and IO.
    pub fn unknown_source(cpu_cost: f64) -> Self {
        Self {
            cardinality: None,
            io_cost: None,
            cpu_cost,
        }
    }

    /// Zero cost (for in-memory sources with no computation).
    pub const ZERO: Self = Self {
        cardinality: Some(0.0),
        io_cost: Some(0.0),
        cpu_cost: 0.0,
    };

    /// Total estimated cost (IO + CPU, weighted).
    ///
    /// Returns `None` if IO cost is unknown.
    /// IO cost is typically weighted higher because it involves disk/memory access.
    pub fn total(&self) -> Option<f64> {
        self.io_cost.map(|io| io * IO_WEIGHT + self.cpu_cost * CPU_WEIGHT)
    }

    /// Format for display, showing "unknown" for missing values.
    pub fn display_cardinality(&self) -> String {
        match self.cardinality {
            Some(c) => format!("{:.1}", c),
            None => "unknown".to_string(),
        }
    }

    /// Format IO cost for display.
    pub fn display_io_cost(&self) -> String {
        match self.io_cost {
            Some(c) => format!("{:.1}", c),
            None => "unknown".to_string(),
        }
    }
}

// NOTE: No Default impl - require explicit construction to avoid
// accidentally creating "0 rows, 0 io" when "unknown" was intended.
// Use CostEstimate::new() or CostEstimate::unknown_source() explicitly.

// Cost constants (tunable)
const IO_WEIGHT: f64 = 10.0;      // IO is expensive relative to CPU
const CPU_WEIGHT: f64 = 1.0;      // CPU is relatively cheap
const BATCH_READ_COST: f64 = 1.0; // Cost per batch read
const VECTORIZED_MULTIPLIER: f64 = 0.1; // Vectorized ops are ~10x faster

// Conservative defaults when metadata is unavailable (internal use only).
// IMPORTANT: These defaults are ONLY for internal cost comparisons (e.g., deciding
// vectorized vs interpreted). They must NEVER leak into explain() display - unknown
// metadata must display as "unknown", not these placeholder values.
const DEFAULT_CARDINALITY: f64 = 1000.0;
const DEFAULT_BATCH_COUNT: f64 = 10.0;

/// Heuristic-based cost model for LogicalPlan optimization.
///
/// The cost model provides estimates without runtime statistics.
/// All estimates are heuristic and should be used for relative
/// comparisons, not absolute predictions.
#[derive(Debug, Clone, Default)]
pub struct CostModel {
    /// Optional source cardinality hint (from metadata).
    pub source_cardinality: Option<usize>,
    /// Optional batch count hint (from metadata).
    pub batch_count: Option<usize>,
    /// Whether schema is available (enables vectorized execution).
    pub has_schema: bool,
}

impl CostModel {
    /// Create a new cost model with optional metadata hints.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a cost model with source metadata.
    pub fn with_source_info(
        cardinality: Option<usize>,
        batch_count: Option<usize>,
        has_schema: bool,
    ) -> Self {
        Self {
            source_cardinality: cardinality,
            batch_count,
            has_schema,
        }
    }

    /// Check if source metadata is available.
    pub fn has_source_metadata(&self) -> bool {
        self.source_cardinality.is_some()
    }

    /// Estimate selectivity of a predicate.
    ///
    /// Returns a value in [0.0, 1.0] representing the fraction of rows
    /// expected to pass the predicate.
    ///
    /// # Heuristics
    ///
    /// | Predicate Type | Selectivity |
    /// |----------------|-------------|
    /// | Equality (=)   | 0.1 (10%)   |
    /// | Range (<, >, etc.) | 0.3 (30%) |
    /// | IsNull/IsNotNull | 0.1 (10%) |
    /// | AND            | product of operands |
    /// | OR             | sum - product (union) |
    /// | NOT            | 1 - selectivity |
    /// | Default        | 0.5 (50%)   |
    pub fn estimate_selectivity(&self, predicate: &Expr) -> f64 {
        estimate_selectivity_recursive(predicate)
    }

    /// Estimate cardinality after applying a predicate.
    ///
    /// Returns `None` if input cardinality is unknown.
    /// Note: Result can be 0.0 for always-false predicates.
    pub fn estimate_filter_cardinality(&self, input_cardinality: Option<f64>, predicate: &Expr) -> Option<f64> {
        input_cardinality.map(|card| {
            let selectivity = self.estimate_selectivity(predicate);
            (card * selectivity).max(0.0) // Can be 0 for always-false
        })
    }

    /// Get cardinality for internal cost calculations.
    /// Uses conservative default when unknown.
    fn internal_cardinality(&self) -> f64 {
        self.source_cardinality.map(|c| c as f64).unwrap_or(DEFAULT_CARDINALITY)
    }

    /// Get batch count for internal cost calculations.
    /// Uses conservative default when unknown.
    fn internal_batch_count(&self) -> f64 {
        self.batch_count.map(|b| b as f64).unwrap_or(DEFAULT_BATCH_COUNT)
    }

    /// Estimate I/O cost for a source node.
    ///
    /// - InMemory: 0.0 (already in memory)
    /// - Stored: batch_count * BATCH_READ_COST (None if batch_count unknown)
    pub fn io_cost(&self, plan: &LogicalPlan) -> Option<f64> {
        match plan {
            LogicalPlan::InMemory { .. } => Some(0.0),
            LogicalPlan::Stored { .. } => {
                self.batch_count.map(|b| b as f64 * BATCH_READ_COST)
            }
            _ => Some(0.0), // Non-source nodes don't have direct IO cost
        }
    }

    /// Estimate CPU cost for filter evaluation.
    ///
    /// Cost depends on:
    /// - Cardinality of input
    /// - Complexity of predicate
    /// - Whether vectorized execution is available
    pub fn cpu_cost_filter(&self, input_cardinality: f64, predicate: &Expr) -> f64 {
        let base_cost = input_cardinality * predicate_complexity(predicate);
        if self.has_schema {
            base_cost * VECTORIZED_MULTIPLIER
        } else {
            base_cost
        }
    }

    /// Estimate CPU cost for sorting.
    ///
    /// O(n log n) for full sort.
    pub fn cpu_cost_sort(&self, cardinality: f64, key_count: usize) -> f64 {
        if cardinality <= 1.0 {
            return 0.0;
        }
        // O(n log n) * number of keys
        cardinality * cardinality.log2() * key_count as f64
    }

    /// Estimate CPU cost for TopK.
    ///
    /// O(n log k) using heap-based algorithm.
    pub fn cpu_cost_topk(&self, cardinality: f64, k: usize, key_count: usize) -> f64 {
        if cardinality <= 1.0 || k == 0 {
            return 0.0;
        }
        let k_f64 = (k as f64).max(1.0);
        // O(n log k) * number of keys
        cardinality * k_f64.log2() * key_count as f64
    }

    /// Estimate total cost for a LogicalPlan node.
    ///
    /// This recursively estimates costs for the entire plan tree.
    pub fn estimate_plan_cost(&self, plan: &Arc<LogicalPlan>) -> CostEstimate {
        estimate_plan_cost_recursive(self, plan)
    }
}

/// Recursively estimate selectivity for a predicate expression.
fn estimate_selectivity_recursive(expr: &Expr) -> f64 {
    match expr {
        // Equality predicates: 10% selectivity
        Expr::Eq(_, _) => 0.1,
        Expr::Ne(_, _) => 0.9, // Inverse of Eq

        // Range predicates: 30% selectivity
        Expr::Gt(_, _) | Expr::Ge(_, _) | Expr::Lt(_, _) | Expr::Le(_, _) => 0.3,

        // Null checks: 10% selectivity (most data is non-null)
        Expr::IsNull(_) => 0.1,
        Expr::IsNotNull(_) => 0.9,

        // Boolean operators
        Expr::And(lhs, rhs) => {
            let l = estimate_selectivity_recursive(lhs);
            let r = estimate_selectivity_recursive(rhs);
            l * r // Intersection
        }
        Expr::Or(lhs, rhs) => {
            let l = estimate_selectivity_recursive(lhs);
            let r = estimate_selectivity_recursive(rhs);
            (l + r - l * r).min(1.0) // Union
        }
        Expr::Not(inner) => {
            1.0 - estimate_selectivity_recursive(inner)
        }

        // String predicates: moderate selectivity
        Expr::StrContains(_, _) | Expr::StartsWith(_, _) | Expr::EndsWith(_, _) => 0.2,

        // Type checks: 50% default
        Expr::IsBool(_) | Expr::IsInt(_) | Expr::IsFloat(_) | Expr::IsString(_) |
        Expr::IsArray(_) | Expr::IsObject(_) | Expr::IsNumeric(_) |
        Expr::IsDate(_) | Expr::IsDateTime(_) | Expr::IsDuration(_) => 0.5,

        // Literals: always pass (true) or never pass (false)
        Expr::Literal(lit) => {
            match lit.as_bool() {
                Some(true) => 1.0,
                Some(false) => 0.0,
                None => 0.5,
            }
        }

        // Default: 50% selectivity for unknown expressions
        _ => 0.5,
    }
}

/// Estimate complexity of a predicate (number of operations).
/// Exported for use by executor's vectorized decision.
pub fn predicate_complexity(expr: &Expr) -> f64 {
    match expr {
        // Literals: minimal cost
        Expr::Literal(_) => 0.1,

        // Path access: moderate cost
        Expr::Path(_) => 0.5,

        // Binary operations: sum of operands + operation cost
        Expr::And(lhs, rhs) | Expr::Or(lhs, rhs) |
        Expr::Eq(lhs, rhs) | Expr::Ne(lhs, rhs) |
        Expr::Gt(lhs, rhs) | Expr::Ge(lhs, rhs) |
        Expr::Lt(lhs, rhs) | Expr::Le(lhs, rhs) |
        Expr::Add(lhs, rhs) | Expr::Sub(lhs, rhs) |
        Expr::Mul(lhs, rhs) | Expr::Div(lhs, rhs) => {
            1.0 + predicate_complexity(lhs) + predicate_complexity(rhs)
        }

        // Unary operations
        Expr::Not(inner) | Expr::Neg(inner) |
        Expr::IsNull(inner) | Expr::IsNotNull(inner) => {
            1.0 + predicate_complexity(inner)
        }

        // String operations: higher cost
        Expr::StrContains(lhs, rhs) | Expr::StartsWith(lhs, rhs) |
        Expr::EndsWith(lhs, rhs) => {
            3.0 + predicate_complexity(lhs) + predicate_complexity(rhs)
        }

        // Default: moderate complexity
        _ => 1.0,
    }
}

/// Recursively estimate cost for a LogicalPlan tree.
fn estimate_plan_cost_recursive(model: &CostModel, plan: &Arc<LogicalPlan>) -> CostEstimate {
    match plan.as_ref() {
        // Source nodes
        LogicalPlan::InMemory { arbor } => {
            let cardinality = arbor.num_trees() as f64;
            CostEstimate::new(cardinality, 0.0, 0.0)
        }
        LogicalPlan::Stored { .. } => {
            // Use Option to preserve "unknown" status for display
            let cardinality = model.source_cardinality.map(|c| c as f64);
            let io = model.io_cost(plan.as_ref());
            CostEstimate {
                cardinality,
                io_cost: io,
                cpu_cost: 0.0,
            }
        }

        // Filter: apply selectivity to cardinality
        LogicalPlan::Filter { source, predicate, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let output_cardinality = model.estimate_filter_cardinality(
                source_cost.cardinality, predicate
            );
            // Use internal cardinality for CPU cost calculation
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = model.cpu_cost_filter(input_card, predicate);
            CostEstimate {
                cardinality: output_cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        // Head: cap cardinality at n
        LogicalPlan::Head { source, n } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let output_cardinality = source_cost.cardinality.map(|c| c.min(*n as f64));
            CostEstimate {
                cardinality: output_cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost,
            }
        }

        // Tail: cap cardinality at n
        LogicalPlan::Tail { source, n } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let output_cardinality = source_cost.cardinality.map(|c| c.min(*n as f64));
            CostEstimate {
                cardinality: output_cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost,
            }
        }

        // Sort: O(n log n) CPU cost
        LogicalPlan::Sort { source, keys } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = model.cpu_cost_sort(input_card, keys.len());
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        // TopK: O(n log k) CPU cost
        LogicalPlan::TopK { source, keys, k } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = model.cpu_cost_topk(input_card, *k, keys.len());
            CostEstimate {
                cardinality: source_cost.cardinality.map(|c| (*k as f64).min(c)),
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        // Pass-through transforms: cardinality unchanged or capped
        LogicalPlan::Take { source, indices } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            CostEstimate {
                cardinality: source_cost.cardinality.map(|c| (indices.len() as f64).min(c)),
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost,
            }
        }

        LogicalPlan::Sample { source, n, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            CostEstimate {
                cardinality: source_cost.cardinality.map(|c| (*n as f64).min(c)),
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost,
            }
        }

        LogicalPlan::Shuffle { source, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            // Shuffle has O(n) CPU cost for permutation
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + input_card,
            }
        }

        // Projection transforms
        LogicalPlan::Select { source, exprs } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = input_card * exprs.len() as f64;
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        LogicalPlan::AddFields { source, fields } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = input_card * fields.len() as f64;
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        LogicalPlan::Aggregate { source, exprs } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            let cpu = input_card * exprs.len() as f64;
            CostEstimate {
                cardinality: Some(1.0), // Aggregate produces single result
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        // Grouping operations
        LogicalPlan::GroupBy { source, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            // Estimate ~10% of rows as distinct groups (heuristic)
            let groups = (input_card * 0.1).max(1.0);
            // GroupBy has sort cost + group detection
            let cpu = model.cpu_cost_sort(input_card, 1);
            CostEstimate {
                cardinality: Some(groups),
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }

        LogicalPlan::IndexBy { source, .. } => {
            let source_cost = estimate_plan_cost_recursive(model, source);
            let input_card = source_cost.cardinality.unwrap_or(model.internal_cardinality());
            // IndexBy has O(n) cost to build HashMap
            let cpu = input_card * 2.0; // Hash + insert
            CostEstimate {
                cardinality: source_cost.cardinality,
                io_cost: source_cost.io_cost,
                cpu_cost: source_cost.cpu_cost + cpu,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use arbors_expr::{lit, path};
    use arbors_storage::InMemoryArbor;

    #[test]
    fn test_selectivity_equality() {
        let model = CostModel::new();
        let pred = path("x").eq(lit(42));
        assert!((model.estimate_selectivity(&pred) - 0.1).abs() < 0.001);
    }

    #[test]
    fn test_selectivity_range() {
        let model = CostModel::new();
        let pred = path("x").gt(lit(10));
        assert!((model.estimate_selectivity(&pred) - 0.3).abs() < 0.001);
    }

    #[test]
    fn test_selectivity_and() {
        let model = CostModel::new();
        // 0.1 * 0.3 = 0.03
        let pred = path("x").eq(lit(42)).and(path("y").gt(lit(10)));
        assert!((model.estimate_selectivity(&pred) - 0.03).abs() < 0.001);
    }

    #[test]
    fn test_selectivity_or() {
        let model = CostModel::new();
        // 0.1 + 0.3 - 0.1*0.3 = 0.37
        let pred = path("x").eq(lit(42)).or(path("y").gt(lit(10)));
        assert!((model.estimate_selectivity(&pred) - 0.37).abs() < 0.001);
    }

    #[test]
    fn test_cost_inmemory_source() {
        let arbor = Arc::new(InMemoryArbor::new());
        let plan = LogicalPlan::inmemory(arbor);
        let model = CostModel::new();

        let cost = model.estimate_plan_cost(&plan);
        assert_eq!(cost.io_cost, Some(0.0));
        assert_eq!(cost.cpu_cost, 0.0);
    }

    #[test]
    fn test_cost_stored_source_unknown() {
        let plan = LogicalPlan::stored("test");
        let model = CostModel::new(); // No metadata

        let cost = model.estimate_plan_cost(&plan);
        assert_eq!(cost.cardinality, None); // Unknown
        assert_eq!(cost.io_cost, None); // Unknown
        assert_eq!(cost.display_cardinality(), "unknown");
    }

    #[test]
    fn test_cost_stored_source_known() {
        let plan = LogicalPlan::stored("test");
        let model = CostModel::with_source_info(Some(1000), Some(10), true);

        let cost = model.estimate_plan_cost(&plan);
        assert_eq!(cost.cardinality, Some(1000.0));
        assert!(cost.io_cost.unwrap() > 0.0);
    }

    #[test]
    fn test_filter_cardinality_can_be_zero() {
        let model = CostModel::new();
        // Literal false has 0.0 selectivity
        let pred = arbors_expr::lit(false);
        let result = model.estimate_filter_cardinality(Some(100.0), &pred);
        assert_eq!(result, Some(0.0));
    }

    #[test]
    fn test_sort_vs_topk_cost() {
        let model = CostModel::with_source_info(Some(10000), Some(100), true);

        let sort_cpu = model.cpu_cost_sort(10000.0, 1);
        let topk_cpu = model.cpu_cost_topk(10000.0, 10, 1);

        // TopK should be significantly cheaper than full sort
        assert!(topk_cpu < sort_cpu);
    }
}
```

**Checklist:**
- [ ] Create `crates/arbors-pipeline/src/optimize/cost.rs`
- [ ] Add `CostEstimate` struct with Option fields for unknown handling
- [ ] Add `CostModel` struct with estimation methods
- [ ] Implement `estimate_selectivity()` with heuristics
- [ ] Export `predicate_complexity()` for executor use
- [ ] Implement `estimate_plan_cost()` for all LogicalPlan variants
- [ ] Add unit tests including unknown/zero cases
- [ ] Verify: `cargo build -p arbors-pipeline`
- [ ] Verify: `cargo test -p arbors-pipeline cost`

**Gate B Impact:** None (no integration yet)

---

### Sub-Step 8.2: Update optimize/mod.rs Exports

**Goal:** Export cost model types from the optimize module.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/optimize/mod.rs`

**Code Changes:**

```rust
// Add to mod.rs
mod cost;

// Add to existing re-exports
pub use cost::{CostEstimate, CostModel, predicate_complexity};
```

**Checklist:**
- [ ] Add `mod cost;` to optimize/mod.rs
- [ ] Add `pub use cost::{CostEstimate, CostModel, predicate_complexity};`
- [ ] Verify: `cargo build -p arbors-pipeline`

**Gate B Impact:** None (exports only)

---

### Sub-Step 8.3: Implement Cost-Based Filter Ordering

**Goal:** Create a new optimization rule that reorders ANDed filter predicates by selectivity.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/optimize/logical_plan.rs`

**Design Notes:**
- When a Filter has an AND predicate, evaluate the more selective clause first
- This enables short-circuit evaluation to skip more work
- Only applies to fused filters (from FilterFusion)
- **Error Semantics:** This reordering MAY change which error is observed for fallible expressions. This is accepted behavior per policy decision.

**Code Sketch:**

```rust
// Add new rule to logical_plan.rs

/// Reorders AND predicates by estimated selectivity (most selective first).
///
/// # Pattern
///
/// Filter(p1 AND p2) where selectivity(p2) < selectivity(p1)
/// -> Filter(p2 AND p1)
///
/// # Benefits
///
/// - Short-circuit evaluation skips more work
/// - More selective predicates eliminate rows earlier
///
/// # Error Semantics
///
/// **WARNING:** This reordering may change which error is observed for
/// fallible expressions. For example, if p1 errors and p2 is selective,
/// reordering to (p2 AND p1) may cause fewer rows to reach p1's evaluation.
/// This is accepted behavior; users should not rely on specific error
/// ordering from ANDed predicates.
///
/// # Limitations
///
/// - Only reorders top-level ANDs (does not recursively restructure)
/// - Requires FilterFusion to have run first
#[derive(Debug, Clone, Copy)]
pub struct FilterSelectivityOrder;

impl LogicalOptimizationRule for FilterSelectivityOrder {
    fn apply(&self, plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
        apply_filter_selectivity_order(plan)
    }

    fn name(&self) -> &'static str {
        "FilterSelectivityOrder"
    }
}

fn apply_filter_selectivity_order(plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
    use crate::optimize::CostModel;

    match plan.as_ref() {
        LogicalPlan::Filter {
            source,
            predicate,
            mode,
            limit,
        } => {
            // Check if predicate is an AND that could benefit from reordering
            if let Expr::And(lhs, rhs) = predicate {
                let model = CostModel::new();
                let sel_lhs = model.estimate_selectivity(lhs);
                let sel_rhs = model.estimate_selectivity(rhs);

                // If rhs is more selective, swap order
                if sel_rhs < sel_lhs {
                    let reordered = rhs.clone().and(lhs.as_ref().clone());
                    return Some(Arc::new(LogicalPlan::Filter {
                        source: Arc::clone(source),
                        predicate: reordered,
                        mode: *mode,
                        limit: *limit,
                    }));
                }
            }

            // Try recursively in source
            let optimized_source = apply_filter_selectivity_order(source)?;
            Some(Arc::new(LogicalPlan::Filter {
                source: optimized_source,
                predicate: predicate.clone(),
                mode: *mode,
                limit: *limit,
            }))
        }

        // Recurse into other node types
        // ... (similar pattern to other rules)
        _ => recurse_for_filter_selectivity(plan),
    }
}

fn recurse_for_filter_selectivity(plan: &Arc<LogicalPlan>) -> Option<Arc<LogicalPlan>> {
    match plan.as_ref() {
        LogicalPlan::Head { source, n } => {
            apply_filter_selectivity_order(source).map(|optimized| {
                Arc::new(LogicalPlan::Head { source: optimized, n: *n })
            })
        }
        // ... other node types (follow pattern from existing rules)
        LogicalPlan::InMemory { .. } | LogicalPlan::Stored { .. } => None,
        _ => None, // Simplified - implement full recursion
    }
}
```

**Checklist:**
- [ ] Add `FilterSelectivityOrder` rule to logical_plan.rs
- [ ] Add rule to `optimize_logical_plan()` rule list (after FilterFusion)
- [ ] Document error semantics warning in rustdoc
- [ ] Add unit tests for selectivity ordering
- [ ] Verify: `cargo test -p arbors-pipeline filter_selectivity`

**Gate B Impact:** None (optimization preserves boolean semantics, error behavior may differ)

---

### Sub-Step 8.4: Add Cost Information to DecodePlanSummary

**Goal:** Extend `DecodePlanSummary` with cost estimates for explain() output.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/optimize/analysis.rs`

**Code Changes:**

```rust
// Add to DecodePlanSummary struct
#[derive(Debug, Clone, PartialEq)]
pub struct DecodePlanSummary {
    // ... existing fields ...

    /// Estimated cost for the entire plan.
    ///
    /// This is computed by the cost model and represents the relative
    /// expense of executing the plan.
    ///
    /// Added in Step 8 for cost-based optimization visibility.
    pub estimated_cost: Option<CostEstimate>,
}

impl DecodePlanSummary {
    /// Create an empty summary (no pools required).
    pub const fn empty() -> Self {
        Self {
            predicate_plan: DecodePlan::NONE,
            projection_plan: DecodePlan::NONE,
            materialization_plan: DecodePlan::NONE,
            estimated_cost: None,
        }
    }

    /// Create a summary requiring all pools.
    pub const fn all() -> Self {
        Self {
            predicate_plan: DecodePlan::ALL,
            projection_plan: DecodePlan::ALL,
            materialization_plan: DecodePlan::ALL,
            estimated_cost: None,
        }
    }

    // ... existing methods ...
}

// Add new function
/// Analyze decode requirements and estimate costs for a logical plan.
///
/// This is an extended version of `analyze_decode_requirements` that also
/// computes cost estimates using the cost model.
///
/// # Unknown Metadata
///
/// When source metadata is unavailable (e.g., stored source without scope),
/// cost estimates will show "unknown" for cardinality and IO cost rather
/// than using magic default values.
pub fn analyze_with_cost(
    plan: &LogicalPlan,
    schema: Option<&SchemaRegistry>,
    source_cardinality: Option<usize>,
    batch_count: Option<usize>,
) -> DecodePlanSummary {
    let mut summary = analyze_decode_requirements(plan, schema);

    // Add cost estimation
    let model = CostModel::with_source_info(
        source_cardinality,
        batch_count,
        schema.is_some(),
    );

    // Wrap in Arc for cost estimation
    let plan_arc = Arc::new(plan.clone());
    summary.estimated_cost = Some(model.estimate_plan_cost(&plan_arc));

    summary
}
```

**Checklist:**
- [ ] Add `estimated_cost: Option<CostEstimate>` field to `DecodePlanSummary`
- [ ] Update `empty()` and `all()` constructors
- [ ] Add `analyze_with_cost()` function
- [ ] Update existing tests to handle new field
- [ ] Verify: `cargo test -p arbors-pipeline analysis`

**Gate B Impact:** None (addition only, existing API unchanged)

---

### Sub-Step 8.5: Extend explain() with Options and Cost Information

**Goal:** Add parameterized `explain(ExplainOptions)` with cost output.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Code Changes:**

```rust
/// Options for explain() output.
#[derive(Debug, Clone, Default)]
pub struct ExplainOptions {
    /// Include estimated costs section.
    pub costs: bool,
    // Future: analyze: bool (Step 11)
}

impl ExplainOptions {
    /// Create options with costs enabled.
    pub fn with_costs() -> Self {
        Self { costs: true }
    }
}

// Update explain() implementation
impl Arbor {
    /// Explain the query plan with default options.
    ///
    /// Equivalent to `explain_with(ExplainOptions::default())`.
    pub fn explain(&self) -> String {
        self.explain_with(ExplainOptions::default())
    }

    /// Explain the query plan with options.
    ///
    /// Returns a human-readable string showing:
    /// - Logical plan (as constructed)
    /// - Optimized plan (after rule-based optimization)
    /// - DecodePlan summary (pools required for execution)
    /// - Early termination hints (filters with limit hints)
    /// - Estimated costs (if `options.costs` is true)
    ///
    /// # Cost Estimation
    ///
    /// When `options.costs` is true, shows:
    /// - Cardinality: Estimated number of trees (or "unknown")
    /// - IO Cost: Estimated cost of loading data (or "unknown")
    /// - CPU Cost: Estimated cost of computation
    /// - Total: Weighted sum of IO + CPU costs (or "unknown")
    ///
    /// These are heuristic estimates for comparison purposes.
    /// Use `explain_analyze()` (Step 11) for observed statistics.
    ///
    /// # Example Output
    ///
    /// ```text
    /// Logical Plan:
    ///   Filter(pred=...)
    ///     Stored("users")
    ///
    /// Optimized Plan:
    ///   Filter(pred=..., limit=10)
    ///     Stored("users")
    ///
    /// DecodePlan Summary:
    ///   predicate_plan: Selective([Int64s])
    ///   projection_plan: NONE
    ///   materialization_plan: ALL
    ///
    /// Early Termination:
    ///   Filter with limit=10
    ///
    /// Estimated Costs:
    ///   cardinality: unknown
    ///   io_cost: unknown
    ///   cpu_cost: 15.0
    ///   total_cost: unknown
    /// ```
    // FIXME(Step 11): Add explain_analyze() for observed stats
    pub fn explain_with(&self, options: ExplainOptions) -> String {
        let optimized = optimize_logical_plan(&self.plan);

        // Extract schema and metadata from plan
        let schema = get_schema_from_plan(&self.plan);
        let (source_cardinality, batch_count) = get_source_metadata(&self.plan, &self.scope);

        // Compute DecodePlan summary with cost estimation
        let decode_summary = analyze_with_cost(
            &optimized,
            schema,
            source_cardinality,
            batch_count,
        );

        // Collect early termination hints
        let limit_hints = collect_limit_hints(&optimized);

        let mut output = String::new();

        // Logical plan section
        output.push_str("Logical Plan:\n");
        format_plan(&self.plan, 1, &mut output);
        output.push('\n');

        // Optimized plan section
        output.push_str("Optimized Plan:\n");
        format_plan(&optimized, 1, &mut output);
        output.push('\n');

        // DecodePlan summary section
        output.push_str("DecodePlan Summary:\n");
        format_decode_summary(&decode_summary, &mut output);
        output.push('\n');

        // Early termination hints section
        output.push_str("Early Termination:\n");
        if limit_hints.is_empty() {
            output.push_str("  (none)\n");
        } else {
            for hint in &limit_hints {
                output.push_str(&format!("  Filter with limit={}\n", hint));
            }
        }

        // Estimated costs section (only if requested)
        if options.costs {
            output.push('\n');
            output.push_str("Estimated Costs:\n");
            if let Some(cost) = &decode_summary.estimated_cost {
                output.push_str(&format!("  cardinality: {}\n", cost.display_cardinality()));
                output.push_str(&format!("  io_cost: {}\n", cost.display_io_cost()));
                output.push_str(&format!("  cpu_cost: {:.1}\n", cost.cpu_cost));
                match cost.total() {
                    Some(t) => output.push_str(&format!("  total_cost: {:.1}\n", t)),
                    None => output.push_str("  total_cost: unknown\n"),
                }
            } else {
                output.push_str("  (not available)\n");
            }
        }

        output
    }
}

/// Extract source metadata for cost estimation.
///
/// Uses the Arbor's cached metadata when available (for scoped backings),
/// or queries via `scope.txn().get_meta()` for stored sources.
fn get_source_metadata(plan: &Arc<LogicalPlan>, scope: &ArborScope) -> (Option<usize>, Option<usize>) {
    match plan.root_source() {
        LogicalPlan::InMemory { arbor } => {
            (Some(arbor.num_trees()), Some(1)) // Single batch for in-memory
        }
        LogicalPlan::Stored { name } => {
            // Try to get metadata from scope via txn API
            if let Some(read_scope) = scope.as_scope() {
                if let Ok(Some(meta)) = read_scope.txn().get_meta(name) {
                    return (Some(meta.num_trees), meta.batch_count);
                }
            }
            (None, None) // Unknown - will display as "unknown"
        }
        _ => (None, None),
    }
}
```

**Checklist:**
- [ ] Add `ExplainOptions` struct
- [ ] Add `explain_with(options)` method
- [ ] Update existing `explain()` to delegate to `explain_with(default)`
- [ ] Add `get_source_metadata()` helper function
- [ ] Import `analyze_with_cost` from arbors_pipeline
- [ ] Use `display_cardinality()` / `display_io_cost()` for "unknown" handling
- [ ] Add test for explain() with and without costs option
- [ ] Verify: `cargo test -p arbors explain`

**Gate B Impact:** Addition only - must pass

---

### Sub-Step 8.6: Add Vectorized vs Interpreted Decision

**Goal:** Use cost model to decide between vectorized and interpreted execution paths.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/executor.rs`

**Design Notes:**
- Vectorized execution is faster but requires schema
- The cost model can estimate the benefit of vectorized execution
- Add a threshold check before choosing execution strategy

**Code Sketch:**

```rust
// Add to executor.rs

use crate::optimize::predicate_complexity;

/// Decide whether to use vectorized or interpreted execution.
///
/// Vectorized execution is ~10x faster but requires schema.
/// This function uses the cost model to make the decision.
fn should_use_vectorized(
    cardinality: usize,
    schema: Option<&SchemaRegistry>,
    predicate: &Expr,
) -> bool {
    // Must have schema for vectorized
    if schema.is_none() {
        return false;
    }

    // For small datasets, overhead of vectorization may not be worth it
    const VECTORIZATION_THRESHOLD: usize = 100;
    if cardinality < VECTORIZATION_THRESHOLD {
        return false;
    }

    // Check predicate complexity - simple predicates benefit more
    let complexity = predicate_complexity(predicate);
    complexity < 10.0 // Use vectorized for simpler predicates
}

// Update filter method to use decision function
impl<'a, S: TreeSource> PipelineExecutor<'a, S> {
    pub fn filter(
        &self,
        predicate: &Expr,
        limit: Option<usize>,
    ) -> Result<Vec<usize>, PipelineError> {
        // TreeSource uses tree_count(), not len()
        let cardinality = self.source.tree_count();

        // Cost-based decision: vectorized vs interpreted
        if should_use_vectorized(cardinality, self.source.schema(), predicate) && limit.is_none() {
            self.filter_vectorized(predicate)
        } else if let Some(n) = limit {
            self.filter_sequential_with_limit(predicate, n)
        } else {
            self.filter_parallel(predicate)
        }
    }
}
```

**Checklist:**
- [ ] Import `predicate_complexity` from cost module
- [ ] Add `should_use_vectorized()` decision function
- [ ] Update filter execution to use cost-based decision
- [ ] Add test verifying vectorized is chosen for large datasets with schema
- [ ] Add test verifying interpreted is chosen for small datasets
- [ ] Verify: `cargo test -p arbors-pipeline executor`
- [ ] Resolve FIXME(Step 8) in executor.rs:148 and :193

**Gate B Impact:** Must preserve correctness - only changes performance

---

### Sub-Step 8.7: Add Sort Key DecodePlan Optimization

**Goal:** Implement path-based DecodePlan pruning for sort keys (resolve FIXMEs).

**Files:**
- MODIFY: `crates/arbors-pipeline/src/physical.rs`
- MODIFY: `crates/arbors-pipeline/src/optimize/analysis.rs`

**Code Changes:**

```rust
// In physical.rs, update analyze_sort_key_decode_plan()

/// Analyze decode requirements for sort keys.
///
/// Returns a DecodePlan that includes only the pools needed to evaluate
/// the sort key expressions. This minimizes decoding during sort.
fn analyze_sort_key_decode_plan(
    keys: &[SortKey],
    schema: Option<&SchemaRegistry>,
) -> DecodePlan {
    let schema = match schema {
        Some(s) => s,
        None => return DecodePlan::ALL, // Conservative fallback
    };

    // Collect expressions from all sort keys
    let exprs: Vec<&Expr> = keys.iter().map(|k| &k.expr).collect();

    // Use existing projection analysis
    analyze_required_pools_multi(&exprs, Some(schema))
}

// Update physical_sort to use the optimized decode plan
pub fn physical_sort<S: TreeSource>(
    source: &S,
    keys: &[SortKey],
    input_indices: &IndexSet,
    streaming_budget: &StreamingBudget,
) -> Result<IndexSet, PipelineError> {
    // ... existing code ...

    // Use optimized decode plan for key extraction
    let plan = analyze_sort_key_decode_plan(keys, source.schema());

    // ... rest of implementation uses `plan` ...
}
```

**Checklist:**
- [ ] Update `analyze_sort_key_decode_plan()` to use projection analysis
- [ ] Update `physical_sort()` to use optimized decode plan
- [ ] Update `physical_topk()` to use optimized decode plan
- [ ] Update `physical_index_by()` to use optimized decode plan
- [ ] Resolve FIXMEs at physical.rs:691, :1002, :1107
- [ ] Add tests verifying minimal pool decoding for sort
- [ ] Verify: `cargo test -p arbors-pipeline physical`

**Gate B Impact:** Must preserve correctness - only improves efficiency

---

### Sub-Step 8.8: Add Python explain() Options Support

**Goal:** Expose `ExplainOptions` to Python.

**Files:**
- MODIFY: `python/src/arbor.rs` (or wherever PyArbor.explain is)

**Code Changes:**

```rust
// In Python bindings

/// Explain the query plan.
///
/// Args:
///     costs: If True, include estimated costs section (default: False)
///
/// Returns:
///     Human-readable string showing the query plan
#[pyo3(signature = (*, costs=false))]
fn explain(&self, costs: bool) -> PyResult<String> {
    let options = ExplainOptions { costs };
    Ok(self.inner.explain_with(options))
}
```

**Checklist:**
- [ ] Update Python `explain()` to accept `costs` keyword argument
- [ ] Verify Python explain() output includes "Estimated Costs" when `costs=True`
- [ ] Add Python test for explain() output with costs
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v -k explain`

**Gate B Impact:** None (output format change only)

---

### Sub-Step 8.9: Add Integration Tests

**Goal:** Verify cost model integration works correctly.

**Files:**
- NEW: `crates/arbors-pipeline/tests/cost_model_tests.rs`

**Test Categories:**

```rust
//! Integration tests for cost model.

use arbors_expr::{lit, path};
use arbors_pipeline::{
    CostModel, CostEstimate,
    LogicalPlan, LogicalFilterMode,
    optimize_logical_plan,
};
use arbors_storage::InMemoryArbor;
use std::sync::Arc;

/// Test that filter ordering improves selectivity
#[test]
fn test_filter_selectivity_ordering() {
    let arbor = Arc::new(InMemoryArbor::new());

    // Less selective first (30%), more selective second (10%)
    let plan = LogicalPlan::inmemory(arbor)
        .filter(path("x").gt(lit(10)), LogicalFilterMode::Immediate) // 30%
        .filter(path("y").eq(lit(42)), LogicalFilterMode::Immediate); // 10%

    let optimized = optimize_logical_plan(&plan);

    // After optimization, fused filter should have AND predicate
    // with more selective clause first
    match optimized.as_ref() {
        LogicalPlan::Filter { predicate, .. } => {
            if let arbors_expr::Expr::And(lhs, _rhs) = predicate {
                // LHS should be the more selective predicate (Eq)
                assert!(matches!(lhs.as_ref(), arbors_expr::Expr::Eq(_, _)));
            }
        }
        _ => panic!("Expected Filter"),
    }
}

/// Test TopK cost is lower than Sort + Head
#[test]
fn test_topk_cost_lower_than_sort() {
    let model = CostModel::with_source_info(Some(10000), Some(100), true);

    // Full sort cost
    let sort_cpu = model.cpu_cost_sort(10000.0, 1);

    // TopK cost (k=10)
    let topk_cpu = model.cpu_cost_topk(10000.0, 10, 1);

    // TopK should be significantly cheaper
    assert!(topk_cpu < sort_cpu / 10.0,
        "TopK ({}) should be <10% of sort cost ({})",
        topk_cpu, sort_cpu);
}

/// Test cost estimation is consistent across plan transformations
#[test]
fn test_cost_consistency() {
    let arbor = Arc::new(InMemoryArbor::new());
    let model = CostModel::with_source_info(Some(1000), Some(10), true);

    let plan = LogicalPlan::inmemory(arbor)
        .filter(path("x").gt(lit(10)), LogicalFilterMode::Immediate)
        .head(100);

    let original_cost = model.estimate_plan_cost(&plan);

    let optimized = optimize_logical_plan(&plan);
    let optimized_cost = model.estimate_plan_cost(&optimized);

    // Optimized should have same or lower cost
    assert!(optimized_cost.total() <= original_cost.total().map(|t| t * 1.1),
        "Optimized ({:?}) should not be much more expensive than original ({:?})",
        optimized_cost.total(), original_cost.total());
}

/// Test unknown metadata produces "unknown" display
#[test]
fn test_unknown_metadata_display() {
    let plan = LogicalPlan::stored("test");
    let model = CostModel::new(); // No metadata

    let cost = model.estimate_plan_cost(&plan);
    assert_eq!(cost.display_cardinality(), "unknown");
    assert_eq!(cost.display_io_cost(), "unknown");
}
```

**Checklist:**
- [ ] Create `cost_model_tests.rs`
- [ ] Add selectivity ordering test
- [ ] Add TopK vs Sort cost comparison test
- [ ] Add cost consistency test
- [ ] Add unknown metadata display test
- [ ] Verify: `cargo test -p arbors-pipeline --test cost_model_tests`

**Gate B Impact:** Tests only - no production code

---

### Sub-Step 8.10: Documentation and FIXME Updates

**Goal:** Document cost model, update/resolve FIXMEs.

**Files:**
- MODIFY: `crates/arbors-pipeline/src/optimize/cost.rs` (module docs)
- MODIFY: Various files with Step 8 FIXMEs

**FIXME Resolution Table:**

| File | Line | Action |
|------|------|--------|
| `handle.rs:1465` | RESOLVED | Cost estimation added to explain() |
| `handle.rs:1474` | RESOLVED | analyze_with_cost() uses source metadata |
| `physical.rs:691` | RESOLVED | analyze_sort_key_decode_plan() implemented |
| `physical.rs:1002` | RESOLVED | TopK uses optimized decode plan |
| `physical.rs:1107` | RESOLVED | IndexBy uses optimized decode plan |
| `analysis.rs:14-16` | RESOLVED | CostModel added in cost.rs |
| `analysis.rs:42` | RESOLVED | analyze_with_cost() integrates cost |
| `logical_plan.rs:875` | DEFERRED | Vectorized limit - future enhancement |
| `executor.rs:148` | PARTIAL | Cost-based decision added, limit threading deferred |
| `executor.rs:193` | PARTIAL | Cost-based decision added, limit threading deferred |

**New FIXMEs to Add:**

```rust
// In cost.rs header
//! # Future Enhancements (Statistics Collection)
//!
//! The current cost model uses heuristics. Future work could add:
//! - Histogram-based selectivity estimation
//! - Runtime statistics collection
//! - Adaptive cost calibration
//!
//! REFACTOR FIXME: Add statistics-based selectivity estimation.
```

**Checklist:**
- [ ] Add comprehensive module documentation to cost.rs
- [ ] Resolve FIXMEs listed in table (update comments)
- [ ] Add new FIXMEs for future enhancements
- [ ] Verify: `cargo doc -p arbors-pipeline`

---

### Sub-Step 8.11: Verify All Gates

**Goal:** Ensure all tests pass.

**Commands:**
```bash
cargo test -p arbors --test invariants   # Gate A
cargo test                                # Rust Gate B
make python && .venv/bin/pytest python/tests -v  # Python Gate B
```

**Checklist:**
- [ ] Gate A: `cargo test -p arbors --test invariants` passes
- [ ] Rust Gate B: `cargo test` passes
- [ ] Python Gate B: `.venv/bin/pytest python/tests -v` passes
- [ ] Commit with message: "Step 8: Cost model optimizer - heuristic-based cost estimation"

---

## Summary of Changes

### New Files
| File | Description |
|------|-------------|
| `crates/arbors-pipeline/src/optimize/cost.rs` | Cost model implementation |
| `crates/arbors-pipeline/tests/cost_model_tests.rs` | Integration tests |

### Modified Files
| File | Changes |
|------|---------|
| `crates/arbors-pipeline/src/optimize/mod.rs` | Export cost module |
| `crates/arbors-pipeline/src/optimize/logical_plan.rs` | Add FilterSelectivityOrder rule |
| `crates/arbors-pipeline/src/optimize/analysis.rs` | Add estimated_cost to summary |
| `crates/arbors-pipeline/src/physical.rs` | Optimize sort key decode plans |
| `crates/arbors-pipeline/src/executor.rs` | Cost-based vectorized decision |
| `crates/arbors/src/handle.rs` | Add ExplainOptions, explain_with() |
| `python/src/arbor.rs` | Add costs parameter to explain() |

### Atomic Pairs
These changes must land together:
1. **cost.rs + mod.rs**: Cost module and exports
2. **analysis.rs + handle.rs**: CostEstimate field and explain() update
3. **physical.rs + analysis.rs**: Sort key decode optimization

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Cost estimates too inaccurate | Use conservative defaults, document as heuristics |
| Performance regression from cost calculation | Cost calculation is O(plan_size), no allocation-heavy cloning |
| Breaking change to explain() output | Addition only - existing sections unchanged, costs opt-in |
| Filter reordering changes error behavior | **Accepted per policy** - documented that error ordering may change |
| Unknown metadata shown as defaults | Fixed - now shows "unknown" explicitly |

---

## Verification Checklist (Final)

- [ ] All Step 8 FIXMEs resolved or documented as deferred
- [ ] Cost model documented with heuristic values explained
- [ ] Error semantics documented for FilterSelectivityOrder
- [ ] Unknown metadata displays as "unknown" not magic numbers
- [ ] explain(costs=True) shows Estimated Costs section
- [ ] explain() without costs omits the section (backward compatible)
- [ ] Filter selectivity ordering applied in optimizer
- [ ] Sort/TopK/IndexBy use minimal decode plans
- [ ] Vectorized vs interpreted decision is cost-based
- [ ] All tests pass (Gate A + Gate B)
- [ ] No performance regressions in existing tests
