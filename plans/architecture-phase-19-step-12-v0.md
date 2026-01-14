# Step 12: Cleanup - Remove Old Patterns

## Overview

**Exit Criteria:** Legacy patterns are deleted (no parallel engines), and Gates A + B + C are all green (repo stays buildable/testable).

**Goal**: Aggressively delete legacy code that has been superseded by the LogicalPlan-based architecture. This step removes the technical debt accumulated during the CoreReboot transition, leaving a clean, unified execution model.

**Key Principle**: This is a brand new library with ZERO external users. No backward compatibility, deprecation warnings, or migration guides needed. Delete aggressively.

---

## Current State Analysis

### Investigation Results

The following legacy patterns exist and need removal:

#### 1. ArborBacking Enum (`crates/arbors/src/handle.rs`)

| Item | Location | Status |
|------|----------|--------|
| `ArborBacking` enum definition | Lines 564-606 | Active, ~95 usages |
| `ArborBacking::Stored` variant | Lines 573-580 | Legacy, superseded by `Scoped` |
| `ArborBacking::Filtered` variant | Lines 592-605 | Legacy, superseded by `LogicalPlan::Filter` |
| `ArborBacking::InMemory` variant | Line 566 | Still needed for leaf node data |
| `ArborBacking::Scoped` variant | Lines 582-590 | Current, uses MVCC snapshots |
| `backing` field on `Arbor` struct | Line 665 | Legacy execution path |

#### 2. FilterState Enum (`crates/arbors/src/handle.rs`)

| Item | Location | Status |
|------|----------|--------|
| `FilterState` enum definition | Lines 56-67 | Legacy, state now in LogicalPlan nodes |
| `FilterState::Immediate` | Line 58 | Legacy |
| `FilterState::Lazy` | Lines 61-66 | Legacy |
| `get_indices()` method | Lines 97-119 | Legacy, used by ArborBacking::Filtered |

#### 3. Staleness Checking (`crates/arbors/src/handle.rs`)

| Item | Location | Status |
|------|----------|--------|
| `validate_not_stale()` function | Lines 3042-3093 | Legacy, no staleness under MVCC |
| 21 call sites of `validate_not_stale()` | Throughout file | Legacy |
| `pinned_generation` field | Lines 604, 629, 634, etc. | Legacy |

#### 4. Session Legacy Patterns (`crates/arbors/src/session.rs`)

| Item | Location | Status |
|------|----------|--------|
| `snapshot: Mutex<Option<OwnedReadTxn>>` field | Line 33 | Legacy, `cached_scope` is canonical |
| `with_snapshot()` method | Lines 81-94 | Legacy, ~20 call sites in handle.rs |
| `has_snapshot()` method | Lines 170-172 | Legacy |
| `drop_snapshot()` method | Lines 177-180 | Legacy |

#### 5. BackingIter (`crates/arbors/src/handle.rs`)

| Item | Location | Status |
|------|----------|--------|
| `BackingIter` struct | Lines 4476-4789 | Legacy, replaced by `PlanBasedIter` |
| `BackingIterState` enum | Lines 4488-4522 | Legacy |
| `backing_iter()` method on Arbor | Line 1239 | Legacy |

#### 6. Legacy Pipeline Types (`crates/arbors-pipeline/`)

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

#### 7. Legacy Helper Functions (`crates/arbors/src/handle.rs`)

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

#### 8. Python Bindings (`python/src/lib.rs`)

| Item | Location | Status |
|------|----------|--------|
| `RustArborBacking` usage | Lines 1643, 1772-1859 | Must update to use Arbor directly |
| ArborBacking tests | Lines 14223-14462 | Legacy tests to delete |

#### 9. Public API Exports (`crates/arbors/src/lib.rs`)

| Export | Location | Status |
|--------|----------|--------|
| `ArborBacking` in `__internal` | Line 65 | Remove from exports |
| `FilterState` in `__internal` | Line 65 | Remove from exports |
| `QueryPlan` in `lazy` module | Line 234 | Remove export |
| `LazyArbor` in `lazy` module | Line 225 | Remove export |
| `QueryOp`, `QueryNode`, `QueryNodeId` | Lines 231-233 | Remove exports |

#### 10. CloseToken and check_closed() (Already Removed)

Investigation confirms these were already removed in Step 10:
- No `CloseToken` found in Python bindings
- No `check_closed()` found in Python bindings

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Semantic model | **`LogicalPlan` is the only IR** | Makes “single source of truth” structural |
| User-facing query styles | **Keep both `Arbor` (eager) and `LazyArbor` (builder)** | Ergonomics + explicit build vs execute boundary |
| Eager work (w/o `ArborBacking`) | **Bake eager results into the plan** | Eliminates plan/backing synchronization |
| LazyArbor execution result | **Materialized (`InMemoryArbor`)** | Clear boundary: “builder → run → in-memory result” |
| Execution knobs | **Live on execution entrypoints** | Avoid coupling to QueryPlan-era builder types |
| Session snapshot Mutex | **Delete entirely** | `cached_scope`/`ReadScope` is canonical |
| Staleness checks | **Delete entirely** | MVCC snapshots cannot be stale |
| Gate verification | After each sub-step | Catch breakage immediately |

### Clarifications (to address known pitfalls)

1. **Where the new plan-based LazyArbor lives**
   - **Decision**: Implement the new plan-based `LazyArbor` in the **`arbors` crate**, not in `arbors-pipeline`.
   - **Recommended location**: `crates/arbors/src/lazy.rs` (new module), re-exported via `arbors::lazy`.
     - This keeps QueryPlan-era pipeline “lazy” fully deletable in Sub-Step 12.12.

2. **Fate of pipeline `lazy_tree.rs` and `lazy_result.rs`**
   - These are **not QueryPlan-era**:
     - `lazy_tree.rs` implements **single-tree** lazy transforms (`LazyTree`, `TreePlan`, `TreeOp`).
     - `lazy_result.rs` implements **lazy result wrappers** (`LazyFilterResult`, `LazyTreeIter`) over `TreeSource/PipelineExecutor`.
   - **Decision**: Keep them (no Step 12 deletion).
     - Step 12 does **not** rebase or rewrite these modules; they may only require mechanical updates if compilation requires it after QueryPlan-era deletions.
     - Step 12 deletes only the QueryPlan-era `lazy.rs` and QueryPlan stack.

3. **Where in-memory data lives after `ArborBacking` is deleted**
   - `ArborScope::InMemory` remains a marker only.
   - The actual data lives in `LogicalPlan::InMemory { arbor: Arc<InMemoryArbor> }`.

---

## Implementation Sub-Steps

### Sub-Step 12.1: Rebase `LazyArbor` on `LogicalPlan` (keep `LazyArbor`, delete QueryPlan dependency)

**Goal:** Keep `LazyArbor` as a supported option, but make it a pure `LogicalPlan` builder WITH ZERO TEST REGRESSIONS.

---

## 12.1.A: API Surface Inventory

### LazyArbor Methods (from `crates/arbors-pipeline/src/lazy.rs`)

| Method | Signature | QueryOp Dependency | Returns |
|--------|-----------|-------------------|---------|
| **Constructors** |
| `new` | `fn new(arbor: Arc<InMemoryArbor>) -> Self` | Creates Source node | `Self` |
| `from_arbor` | `fn from_arbor(arbor: InMemoryArbor) -> Self` | Wraps in Arc | `Self` |
| **Query Builders** |
| `filter` | `fn filter(self, predicate: Expr) -> Self` | `QueryOp::Filter` | `Self` |
| `select` | `fn select(self, exprs: &[Expr]) -> Self` | `QueryOp::Select` | `Self` |
| `add_field` | `fn add_field(self, name: &str, expr: Expr) -> Self` | `QueryOp::AddField` | `Self` |
| `head` | `fn head(self, n: usize) -> Self` | `QueryOp::Head` | `Self` |
| `tail` | `fn tail(self, n: usize) -> Self` | `QueryOp::Tail` | `Self` |
| `aggregate` | `fn aggregate(self, exprs: &[Expr]) -> Self` | `QueryOp::Aggregate` | `Self` |
| `sort_by` | `fn sort_by(self, by: &[Expr], descending: &[bool]) -> Self` | `QueryOp::Sort` | `Self` |
| `unique_by` | `fn unique_by(self, by: Expr) -> Self` | `QueryOp::UniqueBy` | `Self` |
| **Execution** |
| `collect` | `fn collect(self) -> Result<InMemoryArbor, PipelineError>` | optimize + execute_plan | `Result` |
| `collect_with_mode` | `fn collect_with_mode(self, mode: ExecutionMode) -> Result<...>` | optimize + execute_plan with mode | `Result` |
| ~~`collect_unoptimized`~~ | ~~DELETED~~ | Zero external users = no backward compat | - |
| ~~`collect_unoptimized_with_mode`~~ | ~~DELETED~~ | Zero external users = no backward compat | - |
| **Inspection** |
| `ends_with_aggregate` | `fn ends_with_aggregate(&self) -> bool` | plan.root() + plan.get() | `bool` |
| `describe_plan` | `fn describe_plan(&self) -> String` | plan.describe() | `String` |
| `plan_len` | `fn plan_len(&self) -> usize` | plan.len() | `usize` |
| `source` | `fn source(&self) -> &Arc<InMemoryArbor>` | plan.source() | `&Arc<...>` |

---

## 12.1.A2: Python Binding API Inventory (the actual contract)

### Python `LazyArbor` Methods (from `python/src/lib.rs`)

| Method | Signature | Rust Dependency | Notes |
|--------|-----------|-----------------|-------|
| **Constructors** |
| (via `Arbor.lazy()`) | `fn lazy(&self) -> LazyArbor` | `RustLazyArbor::new()` | Only constructor path |
| **Query Builders** |
| `filter` | `fn filter(&self, expr: &Expr) -> LazyArbor` | `.filter()` | Returns new LazyArbor |
| `select` | `fn select(&self, exprs: Vec<Expr>) -> LazyArbor` | `.select()` | |
| `add_field` | `fn add_field(&self, name: &str, expr: &Expr) -> LazyArbor` | `.add_field()` | |
| `head` | `fn head(&self, n: usize) -> LazyArbor` | `.head()` | |
| `tail` | `fn tail(&self, n: usize) -> LazyArbor` | `.tail()` | |
| `aggregate` | `fn aggregate(&self, exprs: Vec<Expr>) -> LazyArbor` | `.aggregate()` | |
| `sort_by` | `fn sort_by(&self, by, descending, nulls_last) -> LazyArbor` | `.sort_by()` | **Flexible args**: single Expr, list of Expr, bool or list of bool |
| `unique_by` | `fn unique_by(&self, by: ExprOrPath) -> LazyArbor` | `.unique_by()` | Accepts Expr or path string |
| **Execution** |
| `collect` | `fn collect(&self, parallel: bool = true) -> Arbor` | `.collect_with_mode()` | Returns Arbor (Python wrapper over InMemoryArbor) |
| ~~`collect_unoptimized`~~ | ~~DELETED~~ | Zero external users = no backward compat | |
| `collect_scalar` | `fn collect_scalar(&self, parallel: bool = true) -> PyObject` | `.collect_with_mode()` + extract | **Python-only convenience** - requires plan ends with aggregate |
| **Inspection** |
| `describe_plan` | `fn describe_plan(&self) -> String` | `.describe_plan()` | |
| `plan_len` | `#[getter] fn plan_len(&self) -> usize` | `.plan_len()` | **Property**, not method |
| `__repr__` | Returns `"LazyArbor(plan_len={}, source_trees={})"` | `.plan_len()` + `.source().len()` | Format must be preserved |

### Python-Specific API Contracts to Preserve

| Contract | Test(s) | Requirement |
|----------|---------|-------------|
| `collect_scalar` requires aggregate | `test_collect_scalar*` | Raise `ArborsError` if plan doesn't end with aggregate |
| `plan_len` is a **property** | `test_lazy_plan_len_*` | Access as `lazy.plan_len`, not `lazy.plan_len()` |
| `plan_len` increases with each op | `test_lazy_plan_length` | Source=1, +filter=2, +sort=3, +unique_by=4 |
| `__repr__` format | Various | Must include `plan_len=` and `source_trees=` |
| Error propagation | `test_filter_cardinality_error` | Semantic errors must raise `ArborsError`, not be swallowed |

---

## 12.1.B: LogicalPlan Node Mapping

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

### MISSING LogicalPlan Node

| QueryOp | LazyArbor Method | LogicalPlan Status |
|---------|------------------|-------------------|
| `QueryOp::UniqueBy` | `unique_by()` | **❌ MISSING** |

---

## 12.1.C: Identified Gaps

### Gap 1: UniqueBy Node Missing from LogicalPlan

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

**Solution:** Add `LogicalPlan::UniqueBy { source, by: Expr }` BEFORE rebasing LazyArbor.

**Scope:** UniqueBy supports BOTH in-memory AND stored sources from the start. No artificial limitations.

**Semantics:** Operates on current input order (post-filter/sort/etc.), keeps first encountered row per key.

### UniqueBy Physical Implementation (indices-first, no debt)

UniqueBy MUST be implemented as an **indices-producing op** in the physical layer, NOT as "delegate to `arbors_query::unique_by()`":

```rust
// In physical.rs - execute_plan_node() match arm
LogicalPlan::UniqueBy { source, by } => {
    let source_result = execute_plan_node(source, txn, budget)?;
    let input_indices = source_result.indices()?;

    // Iterate over input trees (works for BOTH in-memory and stored via TreeSource)
    let mut seen_keys: HashSet<CanonicalKey> = HashSet::new();
    let mut output_indices = Vec::new();

    for &idx in input_indices.iter() {
        let tree = source_result.get_tree(idx)?;  // TreeSource abstracts storage
        let key = evaluate_to_canonical_key(&tree, by)?;
        if seen_keys.insert(key) {
            output_indices.push(idx);  // First occurrence
        }
    }

    Ok(PhysicalResult::Indices(IndexSet::Sparse(output_indices)))
}
```

**Why this approach:**
1. Fits existing physical execution model (indices-first)
2. Works with both in-memory and stored sources (via TreeSource trait)
3. Returns `IndexSet::Sparse(Vec<usize>)` - no new PhysicalResult variants
4. Same pattern as Filter, Sort, etc. - no architectural debt
5. Uses `CanonicalKey` for consistent numeric canonicalization (matches existing index_by behavior)

**DO NOT:** Delegate to `arbors_query::unique_by()` which requires full materialization and would force adding a `PhysicalResult::Materialized` variant.

### Gap 2: describe_plan Format Change

**Problem:** Current format from `QueryPlan::describe()`:
```
QueryPlan (N nodes):
  QueryNodeId(X): Head(10) <- QueryNodeId(Y)
  QueryNodeId(Y): Filter(...) <- QueryNodeId(Z)
  QueryNodeId(Z): Source(N trees)
```

LogicalPlan format (from `Debug` impl) will be different.

**Impact:** 4 Python tests check describe_plan format:
- `test_describe_plan_source_only`
- `test_describe_plan_with_filter`
- `test_describe_plan_with_head`
- `test_describe_plan_complex_chain`

**Decision:** Use new LogicalPlan-native format and UPDATE THE TESTS in the same commit.

### Required Tokens for describe_plan (from test assertions)

| Test | Asserts Present |
|------|-----------------|
| `test_describe_plan_source_only` | `"Source"`, `"3 trees"` |
| `test_describe_plan_with_filter` | `"Filter"`, `"Source"` |
| `test_describe_plan_with_head` | `"Head(10)"` |
| `test_describe_plan_complex_chain` | `"Filter"`, `"Select"`, `"Head"`, `"Source"` |

**New Format Requirements:**
1. Must contain `"Source"` token for the root source node
2. Must include tree count in format `"N trees"` (e.g., `"3 trees"`)
3. Must contain operation names: `"Filter"`, `"Select"`, `"Head"`, `"Tail"`, `"Sort"`, `"UniqueBy"`, `"Aggregate"`
4. For `Head` and `Tail`, must include count: `"Head(10)"`, `"Tail(5)"`

**Proposed Format:**
```
Head(10) ← Filter ← Source(3 trees)
```

Or multi-line for readability:
```
Head(10)
  └── Filter(predicate: path("age") > 21)
      └── Select([path("name")])
          └── Source(3 trees)
```

**Key:** The format can be new, but it MUST contain the required tokens to pass tests.

### Gap 3: Error Propagation

**Problem:** If plan-based execution falls back on errors, semantic errors (like cardinality violations) may be silently swallowed.

**Example:** User writes `filter(path("items[*].price") > 10)` - this is wrong because `items[*].price` returns a vector, not a scalar. Currently, the error is caught, fallback kicks in, and unfiltered data is returned silently.

**Impact:** 1 Python test:
- `test_filter_cardinality_error` - expects ArborsError when filtering with vector predicate

### Error Classification (Variant-Based, NOT String-Based)

`PipelineError` already has structured variants. Use **type matching**, not substring matching:

| Error Variant | Classification | Action |
|--------------|----------------|--------|
| `PipelineError::ExprError(_)` | **Semantic** | **Propagate** - user query is invalid |
| `PipelineError::IndexOutOfBounds { .. }` | **Semantic** | **Propagate** - user requested invalid index |
| `PipelineError::BufferLimitExceeded { .. }` | **Resource** | **Propagate** - resource limits are user-configured |
| `PipelineError::StorageError(_)` | **Infrastructure** | Context-dependent (see below) |

For `StorageError`, the message often contains context about the actual problem. However, we can improve this by:
1. Adding a `PipelineError::NotImplemented { feature: String }` variant for "engine not ready" cases
2. Treating ALL non-`NotImplemented` errors as semantic (propagate)

**Decision for 12.1:** LazyArbor.collect() does NOT use fallback at all. It directly executes the LogicalPlan and fails if unsupported. This forces us to implement all required nodes (like UniqueBy) rather than papering over with fallback.

**Implementation:**
```rust
// LazyArbor::collect() - NO FALLBACK
pub fn collect(self) -> Result<InMemoryArbor, PipelineError> {
    let optimized = optimize_logical_plan(&self.plan);
    execute_logical_plan(&optimized, &self.scope)
}
```

The fallback pattern stays on `Arbor::materialize()` during the transitional period (for stored sources), but `LazyArbor` is pure-plan and must succeed or fail cleanly.

### Gap 4: plan_len Semantics

**Problem:** `plan_len` currently returns QueryPlan node count. With LogicalPlan, the count may differ due to different node structure.

**Impact:** 1 Python test:
- `test_lazy_plan_length` - checks plan_len increases with each operation

**Solution:** Implement `plan_len()` that counts LogicalPlan depth correctly.

---

## 12.1.D: Implementation Order (CRITICAL)

**Principle:** Add missing capabilities BEFORE rebasing. Tests pass throughout.

### Phase 1: Add UniqueBy to LogicalPlan (no LazyArbor changes yet)

**Files:**
- MODIFY: `crates/arbors-pipeline/src/logical_plan.rs`
- MODIFY: `crates/arbors-pipeline/src/physical.rs`
- MODIFY: `crates/arbors-pipeline/src/optimize/logical_plan.rs`
- ADD: Unit tests for UniqueBy execution

**Changes:**
1. Add `LogicalPlan::UniqueBy { source: Arc<LogicalPlan>, by: Expr }` variant
2. Implement physical execution in `execute_plan_node()` as **indices-producing op**:
   - Iterate over input indices via TreeSource
   - Use `CanonicalKey` for key canonicalization (consistent with index_by)
   - Return `IndexSet::Sparse(Vec<usize>)` of first occurrence indices
   - **DO NOT** delegate to `arbors_query::unique_by()` (requires materialization)
3. Add optimizer handling (pass-through for now)
4. Add describe formatting for UniqueBy: `"UniqueBy(by: <expr>)"`

**Gate:** `cargo test -p arbors-pipeline` passes

### Phase 2: Add describe() Method to LogicalPlan + Update Tests

**Files:**
- MODIFY: `crates/arbors-pipeline/src/logical_plan.rs`
- MODIFY: `python/tests/test_lazy.py` (update describe_plan tests)

**Changes:**
1. Add `pub fn describe(&self) -> String` that produces human-readable output
2. Use LogicalPlan-native format (NOT matching old QueryPlan format)
3. Update Python tests `test_describe_plan_*` to expect new format IN THE SAME COMMIT

**New Format Example:**
```
Filter { source: Head { source: InMemory { num_trees: 3 }, n: 10 }, predicate: ... }
```

**Gate:** `cargo test -p arbors-pipeline` AND updated Python tests pass

### Phase 3: Create Plan-Based LazyArbor (NO FALLBACK)

**Files:**
- ADD: `crates/arbors/src/lazy.rs` (NOT `lazy_plan.rs` - matches Step 12 plan)
- MODIFY: `crates/arbors/src/lib.rs`

**Changes:**
1. Implement `LazyArbor` as thin wrapper over `(plan: Arc<LogicalPlan>, scope: ArborScope)`
2. Implement ALL methods from BOTH inventories (Rust 12.1.A + Python 12.1.A2)
3. **NO FALLBACK in LazyArbor.collect()** - execute LogicalPlan directly:
   ```rust
   pub fn collect(self) -> Result<InMemoryArbor, PipelineError> {
       let optimized = optimize_logical_plan(&self.plan);
       execute_logical_plan(&optimized, &self.scope)
   }
   ```
   This forces complete implementation of all required nodes (UniqueBy, etc.) - no silent fallback.
4. Add `from_inmemory_arc()` constructor for Python bindings
5. Implement `source()` method that traverses to root `InMemory` node

**Note on Arbor.materialize():** The existing fallback in `Arbor::materialize()` stays for stored sources during transition. But `LazyArbor` is a fresh implementation - it doesn't use `Arbor::materialize()` at all.

**Gate:** `cargo test -p arbors` passes (Rust tests only)

### Phase 4: Update Python Bindings

**Files:**
- MODIFY: `python/src/lib.rs`

**Changes:**
1. Update `LazyArbor` to use plan-based implementation
2. Ensure all methods work correctly
3. Ensure errors propagate as ArborsError

**Gate:** `make python && .venv/bin/pytest python/tests/test_lazy*.py -v` passes

### Phase 5: Update Exports (Coexistence)

**Files:**
- MODIFY: `crates/arbors/src/lib.rs`

**Changes:**
1. Export new plan-based `LazyArbor` from `arbors::lazy`
2. Keep QueryPlan-era exports marked with `#[doc(hidden)]` + `REFACTOR FIXME(Step 12.12)`

**Gate:** Full test suite passes: `cargo nextest run && make python-test`

---

## 12.1.E: Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `crates/arbors-pipeline/src/logical_plan.rs` | MODIFY | Add UniqueBy variant + describe() |
| `crates/arbors-pipeline/src/physical.rs` | MODIFY | Execute UniqueBy |
| `crates/arbors-pipeline/src/optimize/logical_plan.rs` | MODIFY | Handle UniqueBy in optimizer |
| `crates/arbors/src/lazy.rs` | ADD | New plan-based LazyArbor |
| `crates/arbors/src/lib.rs` | MODIFY | Add module + exports |
| `python/src/lib.rs` | MODIFY | Update bindings |

---

## 12.1.F: Checklist (Ordered)

**Phase 1: UniqueBy Node (indices-first)**
- [ ] Add `LogicalPlan::UniqueBy { source, by }` variant to `logical_plan.rs`
- [ ] Implement `execute_plan_node()` case for UniqueBy in `physical.rs`:
  - [ ] Iterate input indices via TreeSource (works for both in-memory and stored)
  - [ ] Use `CanonicalKey` for key canonicalization
  - [ ] Return `IndexSet::Sparse(Vec<usize>)` of first occurrence indices
- [ ] Add UniqueBy handling in optimizer passes (pass-through)
- [ ] Add unit tests for UniqueBy execution (in-memory and stored sources)
- [ ] Verify: `cargo test -p arbors-pipeline`

**Phase 2: describe() Method + Test Updates**
- [ ] Add `LogicalPlan::describe(&self) -> String` method
- [ ] Use new LogicalPlan-native format
- [ ] Update `python/tests/test_lazy.py` describe_plan tests to expect new format
- [ ] Verify: `cargo test -p arbors-pipeline`
- [ ] Verify: Updated Python describe tests pass

**Phase 3: Plan-Based LazyArbor (NO FALLBACK)**
- [ ] Create `crates/arbors/src/lazy.rs`
- [ ] Implement all LazyArbor methods (filter, select, add_field, head, tail, aggregate, sort_by, unique_by)
- [ ] Implement inspection methods (describe_plan, plan_len, ends_with_aggregate, source)
- [ ] Implement execution methods (collect, collect_with_mode) - NO collect_unoptimized variants
- [ ] Execute LogicalPlan directly in collect() - NO FALLBACK to Arbor::materialize()
- [ ] Verify: `cargo test -p arbors`
- [ ] Verify: `test_filter_cardinality_error` passes (error propagates since there's no fallback)

**Phase 4: Python Bindings**
- [ ] Update `python/src/lib.rs` to use plan-based LazyArbor
- [ ] Verify: `make python && .venv/bin/pytest python/tests/test_lazy.py -v`
- [ ] Verify: `.venv/bin/pytest python/tests/test_lazy_parity.py -v`
- [ ] Verify: `.venv/bin/pytest python/tests/test_collection_ops.py -v -k lazy`

**Phase 5: Exports + Final Verification**
- [ ] Update `arbors::lazy` exports
- [ ] Verify: `cargo nextest run -p arbors`
- [ ] Verify: `make python-test`
- [ ] Verify: 0 test regressions from pre-rebase baseline

---

## 12.1.G: Exit Criteria

| Criterion | Verification |
|-----------|--------------|
| UniqueBy works in LogicalPlan | `cargo test -p arbors-pipeline -- unique` |
| Plan-based LazyArbor complete | All methods implemented |
| Python bindings updated | `pytest python/tests/test_lazy*.py` passes |
| No test regressions | Same pass count as before Sub-Step 12.1 |
| Errors propagate correctly | `test_filter_cardinality_error` passes |

---

## 12.1.H: Risk Mitigation

| Risk | Mitigation |
|------|------------|
| UniqueBy execution differs from QueryPlan | Indices-first implementation using CanonicalKey (same semantics as index_by) |
| describe_plan format breaks tests | **Decision: New format, but MUST contain required tokens (Source, "N trees", operation names). Tests updated in same commit.** |
| Error swallowed by fallback | **Decision: NO FALLBACK in LazyArbor.collect() - errors propagate directly. Forces complete implementation.** |
| plan_len semantics differ | Count LogicalPlan depth. Must increment by 1 for each operation (Source=1, +filter=2, etc.) |
| Python API surface not covered | **Added 12.1.A2: Python binding inventory with collect_scalar, plan_len property, __repr__ format** |
| File naming inconsistency | Use `lazy.rs` (matches Step 12 plan), not `lazy_plan.rs` |

---

## 12.1.I: Key Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| describe_plan format | New LogicalPlan-native format with required tokens | Cleaner, but preserves `"Source"`, `"N trees"`, op names. Tests updated in same commit. |
| Error handling | NO FALLBACK in LazyArbor | Forces complete implementation. Errors propagate directly to user. |
| Error classification | Variant-based (not substring) | Use `PipelineError::ExprError` etc., not string matching |
| Implementation order | Add UniqueBy FIRST | Prevents test regressions |
| Test updates | Same commit as changes | No window of broken tests |
| UniqueBy scope | Both in-memory AND stored | No artificial limitations; indices-first implementation supports both |
| File naming | `lazy.rs` not `lazy_plan.rs` | Consistent with Step 12 plan |
| Python API | Full inventory in 12.1.A2 | Includes collect_scalar, plan_len property, __repr__ |
| Zero regressions | Suite stays green | Test format changes OK if tokens preserved |

---

## 12.1.J: Clarifying Questions (Answered)

| Question | Answer |
|----------|--------|
| Scope of "zero regressions"? | Suite stays green. Test format updates (for describe_plan) are OK if required tokens are preserved. |
| Fallback policy for LazyArbor.collect()? | **NO FALLBACK.** LazyArbor executes LogicalPlan directly. Fallback only stays on Arbor.materialize() for stored sources. |
| UniqueBy scope for 12.1? | **Both in-memory AND stored.** Indices-first implementation naturally supports both via TreeSource trait. No artificial limitations. |
| Freeze Python API for 12.1? | **Yes.** Python API inventory in 12.1.A2 is the contract. Only move knobs in 12.2. |
| UniqueBy semantics? | Operates on current input order (post-filter/sort/etc.), keeps first encountered row per key. |
| UniqueBy implementation? | **Indices-first.** Produces `IndexSet::Sparse(Vec<usize>)`. DO NOT delegate to `arbors_query::unique_by()`. |
| Where does describe() live? | `crates/arbors-pipeline/src/logical_plan.rs` - method on LogicalPlan itself. |
| collect_unoptimized? | **DELETE.** Zero external users = no backward compatibility needed. |

---

### Sub-Step 12.2: Execution knobs proposal (move off QueryPlan-era `ExecutionMode`)

**Goal:** Preserve execution controls while deleting QueryPlan-era APIs.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`
- MODIFY: `python/src/lib.rs`

**Proposal:**
- **Rust**:
  - `ExecutionOptions { mode: ExecutionMode, budget: StreamingBudget }`
  - Add `*_with_options(...)` execution methods on `Arbor`:
    - `iter_owned_with_options(...)`
    - `materialize_with_options(...)`
    - `to_json_with_options(...)`, `to_arrow_with_options(...)` (as applicable)
  - Add `LazyArbor::collect_with_options(...)` and default `collect()` uses defaults.
- **Python**:
  - Add keyword args on execution entrypoints, e.g.:
    - `LazyArbor.collect(*, mode="parallel"|"sequential", max_buffer_trees=..., ...)`
    - `Arbor.to_json(..., mode=..., max_buffer_trees=..., ...)`

**Checklist:**
- [ ] Execution knobs are accepted at execution entrypoints (Arbor + LazyArbor)
- [ ] No knobs depend on QueryPlan-era types

**Code sketch (Rust; execution knobs):**
```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionMode {
    Sequential,
    Parallel,
}

#[derive(Clone, Debug)]
pub struct ExecutionOptions {
    pub mode: ExecutionMode,
    pub budget: arbors_pipeline::StreamingBudget,
}

impl Default for ExecutionOptions {
    fn default() -> Self {
        Self {
            mode: ExecutionMode::Parallel,
            budget: arbors_pipeline::StreamingBudget::default(),
        }
    }
}
```

---

### Sub-Step 12.3: Cut over exports: keep `arbors::lazy`, but make it plan-based

**Goal:** `arbors::lazy` remains, but exports the rebased `LazyArbor` (no QueryPlan-era exports).

**Files:**
- MODIFY: `crates/arbors/src/lib.rs`

**Checklist:**
- [ ] `arbors::lazy` exports plan-based `LazyArbor`
- [ ] `arbors::lazy` exports no `QueryPlan`/`execute_plan*`/QueryPlan optimizer

---

### Sub-Step 12.4: Python binding cleanup (remove backing inspection and QueryPlan-era imports)

**Goal:** Python remains thin and does not depend on `ArborBacking` or QueryPlan-era types.

**Files:**
- MODIFY: `python/src/lib.rs`

**Checklist:**
- [ ] No `inner.backing()` matching for behavior
- [ ] No `Session::with_snapshot()` usage from Python
- [ ] `LazyArbor` uses plan-based implementation and materializes to `InMemoryArbor`
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v`

---

### Sub-Step 12.5: Add helper methods on `Arbor` needed by Python repr/introspection

**Goal:** Support Python `__repr__` without exposing legacy backings.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Checklist:**
- [ ] Add `source_name()` / `is_stored()` (and optional `root_source_info()`)

---

### Sub-Step 12.6: Remove `ArborBacking` and `FilterState` from `__internal` exports

**Goal:** Bindings/tests cannot depend on backings.

**Files:**
- MODIFY: `crates/arbors/src/lib.rs`

**Checklist:**
- [ ] Remove `ArborBacking` and `FilterState` from `__internal`

---

### Sub-Step 12.7: Delete `validate_not_stale()` (and pinned-generation plumbing)

**Goal:** Remove staleness checking entirely.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Checklist:**
- [ ] Delete `validate_not_stale()` and all call sites
- [ ] Delete pinned-generation logic

---

### Sub-Step 12.8: Delete Session legacy snapshot infrastructure

**Goal:** Remove `snapshot` mutex + `with_snapshot/has_snapshot/drop_snapshot`.

**Files:**
- MODIFY: `crates/arbors/src/session.rs`
- MODIFY: `crates/arbors/src/handle.rs`

**Checklist:**
- [ ] Delete `snapshot` field and methods
- [ ] Replace remaining `with_snapshot()` call sites with scope-based operations

---

### Sub-Step 12.9: Delete `BackingIter`

**Goal:** Plan-based iteration only.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Checklist:**
- [ ] Delete `BackingIter` and any callers

---

### Sub-Step 12.10: Bake eager work into the plan; delete `FilterState` and backing helpers

**Goal:** Eager work exists, but is expressed as plan rewrites (not cached backing state).

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Checklist:**
- [ ] Implement `filter(mode=Immediate)` as an eager rewrite to a plan node containing indices (e.g., `Take { indices }`)
- [ ] Delete `FilterState`
- [ ] Delete backing helper functions that existed only for backing-based execution

**Code sketch (Rust; eager filter baked into plan):**
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

            let indices = self.compute_indices_for_plan(&filter_plan)?; // returns Vec<usize>
            Ok(self.with_plan(Arc::new(LogicalPlan::Take {
                source: Arc::clone(&self.plan),
                indices,
            })))
        }
    }
}
```

---

### Sub-Step 12.11: Remove `ArborBacking` entirely (and remove `backing` field from `Arbor`)

**Goal:** Make plan-based execution inescapable.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Checklist:**
- [ ] Remove `backing` field from `Arbor`
- [ ] Delete `ArborBacking` enum
- [ ] Ensure all execution binds `(plan, scope)` only

---

### Sub-Step 12.12: Delete QueryPlan-era pipeline modules

**Goal:** Remove QueryPlan-era execution/optimization from `arbors-pipeline`.

**Files:**
- DELETE: `crates/arbors-pipeline/src/lazy.rs`
- DELETE: `crates/arbors-pipeline/src/plan.rs`
- DELETE: `crates/arbors-pipeline/src/execute.rs`
- DELETE: `crates/arbors-pipeline/src/optimize/query_plan.rs`
- MODIFY: `crates/arbors-pipeline/src/lib.rs`
- MODIFY: `crates/arbors-pipeline/src/optimize/mod.rs`

**Checklist:**
- [ ] Remove QueryPlan-era exports from `arbors-pipeline`
- [ ] Verify: `cargo build -p arbors-pipeline`

---

### Sub-Step 12.13: Update tests for plan-based `LazyArbor` (keep tests; rewrite assertions)

**Goal:** Tests continue to cover LazyArbor, but against the rebased plan-based implementation.

**Files:**
- MODIFY: `crates/arbors/tests/integration/pipeline/lazy_integration.rs` (rewrite)
- MODIFY: `python/tests/test_lazy*.py`
- MODIFY: `python/arbors/_arbors.pyi`

**Checklist:**
- [ ] No tests reference `QueryPlan` or `ArborBacking`
- [ ] `LazyArbor.collect()` materializes to `InMemoryArbor` (Rust + Python tests)

---

### Sub-Step 12.14: Grep sweep + integration surface cleanup

**Goal:** Ensure the repo is fully cut over.

**Checklist:**
- [ ] Grep for `QueryPlan`, `execute_plan`, `with_snapshot`, `ArborBacking`, `FilterState`, `BackingIter`, `validate_not_stale`
- [ ] Fix or delete any remaining references

---

### Sub-Step 12.15: Run Dead Code Elimination

**Goal:** Use compiler warnings to find any remaining unused code.

**Commands:**

```bash
# Enable warnings for dead code
RUSTFLAGS="-D dead_code" cargo build -p arbors 2>&1 | grep "dead_code"
RUSTFLAGS="-D dead_code" cargo build -p arbors-pipeline 2>&1 | grep "dead_code"

# Run clippy for additional checks
cargo clippy -p arbors -- -D warnings
cargo clippy -p arbors-pipeline -- -D warnings
```

**Checklist:**
- [ ] Run dead code check on `arbors` crate
- [ ] Run dead code check on `arbors-pipeline` crate
- [ ] Delete any identified dead code
- [ ] Run clippy and fix warnings
- [ ] Verify: `cargo build`
- [ ] Verify: `cargo test`

**Gate B Impact:** None (cleanup only).

---

### Sub-Step 12.16: Final Verification

**Goal:** Ensure all gates are green.

**Commands:**

```bash
# Gate A: Invariants
cargo test -p arbors --test invariants

# Gate B: Full Rust test suite
cargo nextest run

# Gate C: Conformance (parity)
cargo nextest run -p arbors -- conformance

# Python tests
make python && .venv/bin/pytest python/tests -v

# Lint
make lint
```

**Checklist:**
- [ ] Gate A passes: `cargo test -p arbors --test invariants`
- [ ] Gate B passes: `cargo nextest run`
- [ ] Gate C passes: `cargo nextest run -p arbors -- conformance`
- [ ] Python tests pass: `.venv/bin/pytest python/tests -v`
- [ ] Clippy clean: `make lint`
- [ ] No dead code warnings
- [ ] Run test suite 3x to check for flakiness

**Gate B Impact:** Must pass.

---

## Summary Table

| Sub-Step | Description | Files | Risk |
|----------|-------------|-------|------|
| 12.1 | Rebase `LazyArbor` on `LogicalPlan` | lazy.rs, lib.rs, python/src/lib.rs | Medium |
| 12.2 | Move execution knobs to execution entrypoints | handle.rs, python/src/lib.rs | Medium |
| 12.3 | Cut over `arbors::lazy` exports to plan-based LazyArbor | lib.rs | Low |
| 12.4 | Python binding cleanup (no backing inspection, no QueryPlan-era imports) | python/src/lib.rs | Medium |
| 12.5 | Add helper methods for Python repr/introspection | handle.rs | Low |
| 12.6 | Remove backings from `__internal` exports | lib.rs | Low |
| 12.7 | Delete staleness checks | handle.rs | Low |
| 12.8 | Delete Session snapshot infrastructure | session.rs, handle.rs | Medium |
| 12.9 | Delete BackingIter | handle.rs | Low |
| 12.10 | Bake eager filter into the plan; delete `FilterState` + helpers | handle.rs | Medium |
| 12.11 | Delete `ArborBacking` + remove `backing` field | handle.rs | **High** |
| 12.12 | Delete QueryPlan-era pipeline modules | pipeline/*.rs | Medium |
| 12.13 | Update tests for plan-based `LazyArbor` | tests/ | Medium |
| 12.14 | Grep sweep + integration surface cleanup | all | Low |
| 12.15 | Dead code elimination | all | Low |
| 12.16 | Final verification | - | - |

---

## Atomic Pairs

These changes must land together:

1. **12.1 (+ minimal Python binding to compile)**: Introduce plan-based `LazyArbor` in `arbors` (can coexist with QueryPlan-era pipeline code temporarily)
2. **12.2 + 12.3 + 12.4**: Move execution knobs + cut over `arbors::lazy` exports + update Python imports/calls (still without deleting pipeline files yet)
3. **12.12 + 12.13 (+ 12.14 sweep)**: Delete QueryPlan-era pipeline modules + rewrite tests/assertions + grep sweep to ensure no QueryPlan-era references remain
4. **12.8 + 12.9**: Session snapshot removal + BackingIter removal (requires `with_snapshot()` not used anywhere)
5. **12.10 + 12.11**: Bake eager into plan + delete ArborBacking/backing field (requires plan-based execution to fully cover behavior)

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking Python bindings | Medium | Land 12.1–12.4 together (LazyArbor rebase + knobs + exports + Python cutover) |
| Missing usage sites | Medium | Use grep extensively before deleting |
| Test failures | Medium | Update tests in same sub-step as code changes |
| Semantic drift (eager `Arbor` vs builder `LazyArbor`) | Medium | Single LogicalPlan IR; eager = explicit plan rewrite (baked indices) |
| Compilation failures | Medium | Build after each sub-step |

---

## Exit Criteria Verification

| Criterion | Verification |
|-----------|--------------|
| `ArborBacking` enum deleted | Grep returns no results |
| `FilterState` enum deleted | Grep returns no results |
| `validate_not_stale()` deleted | Grep returns no results |
| `pinned_generation` deleted | Grep returns no results |
| `Session.snapshot` mutex deleted | Grep returns no results |
| `with_snapshot()` deleted | Grep returns no results |
| QueryPlan-era `QueryPlan` deleted | Grep returns no results |
| QueryPlan-era `execute_plan*` deleted | Grep returns no results |
| Plan-based `LazyArbor` still works | Rust + Python tests: `LazyArbor.collect()` returns materialized `InMemoryArbor` |
| `BackingIter` deleted | Grep returns no results |
| No REFACTOR FIXME(Step 12) comments | `grep "REFACTOR FIXME(Step 12)" returns no results` |
| Gate A green | `cargo test -p arbors --test invariants` |
| Gate B green | `cargo nextest run` |
| Gate C green | `cargo nextest run -p arbors -- conformance` |
| Python Gate B green | `.venv/bin/pytest python/tests -v` |
| No clippy warnings | `make lint` |

---

## Files Modified/Deleted Summary

### Deleted Files

| File | Description |
|------|-------------|
| `crates/arbors-pipeline/src/lazy.rs` | QueryPlan-era LazyArbor module |
| `crates/arbors-pipeline/src/plan.rs` | QueryPlan module |
| `crates/arbors-pipeline/src/execute.rs` | QueryPlan executor |
| `crates/arbors-pipeline/src/optimize/query_plan.rs` | QueryPlan optimizer |

### Modified Files

| File | Changes |
|------|---------|
| `crates/arbors/src/handle.rs` | Keep `LazyArbor` (plan-based); bake eager results into the plan; remove ArborBacking/FilterState/BackingIter/staleness/helpers/backing field |
| `crates/arbors/src/session.rs` | Remove snapshot mutex, with_snapshot, has_snapshot, drop_snapshot |
| `crates/arbors/src/lib.rs` | Update exports (`arbors::lazy` becomes plan-based; remove backings from `__internal`) |
| `crates/arbors-pipeline/src/lib.rs` | Remove QueryPlan-era exports |
| `crates/arbors-pipeline/src/optimize/mod.rs` | Remove QueryPlan optimizer |
| `python/src/lib.rs` | Keep LazyArbor but rebase; remove QueryPlan-era imports; remove backing inspection; move knobs to execution |
| Various test files | Rewrite tests to use plan-based LazyArbor; remove QueryPlan/backing references |

---

## What Remains After Step 12

After this cleanup, the codebase will have:

1. **Arbor**: Supported eager-capable handle with `plan: Arc<LogicalPlan>` and `scope: ArborScope` (**no backing field**)
2. **LazyArbor**: Supported builder that holds `LogicalPlan` and materializes to `InMemoryArbor` on `collect()`
3. **LogicalPlan**: Single planning abstraction for both APIs
4. **PlanBasedIter**: Single iteration implementation
5. **Session**: Simplified with only `cached_scope` for snapshot management
6. **One engine**: All execution flows through `LogicalPlan` → pipeline physical execution (no QueryPlan, no backings)

This is the clean, unified architecture that the CoreReboot project aimed to achieve.
