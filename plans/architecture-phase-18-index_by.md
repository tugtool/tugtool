# Add `index_by` to BatchedArbor

## Goal

Enable `BatchedArbor.index_by()` in Python without requiring `materialize()`. Trees are loaded lazily when accessed by key.

## Background

The baseball example fails because `BatchedArbor` (returned by `txn.get()`) lacks `index_by`:
```python
players_idx = players.index_by("playerID")  # AttributeError!
```

Currently `index_by` only exists on materialized `Arbor`. The goal is to add it to `BatchedArbor` with:
- **Projection pushdown**: Index build decodes only key-related pools (via `DecodePlan`), not full batches
- **No cache pollution**: Use `batch_with_plan()` which bypasses cache when plan != `ALL`
- **Lazy tree loading**: Trees loaded on-demand when accessed by key
- **Same Python API** as `Arbor.index_by()`

## Design Decisions (User-Confirmed)

| Decision | Choice |
|----------|--------|
| Projection during index build | **Use DecodePlan** - decode only key pools, avoid cache |
| Rust API scope | **Python-only initially** - keep Rust types crate-private |
| Schema in returned Trees | **Preserve schema** from `BatchedArbor.meta` |
| Iteration strategy | **Batch-grouped** - minimize redundant batch decodes |

## Critical Semantics to Match

From existing `arbors_query::index_by`:

1. **Duplicate policy only at final level**: Intermediate levels of multi-key indexing always build nested sub-indices (no dupe policy). Only the final key level applies `error/first/last/collect`.

2. **Null/missing handling**: `null_keys="drop"` drops both `Null` and `Missing`; `null_keys="error"` errors on either.

3. **Key ordering**: Keys iterate in **first-seen insertion order** via `ordered_keys`.

4. **Canonical key equality**: `CanonicalKey` has special equality (e.g., `1 == 1.0`, all NaNs equal).

## Architecture

### Key Insight

`PyBatchedArbor` already stores:
- `txn: Py<PyReadTxn>` - transaction reference (keeps Rust transaction alive)
- `name: String` - arbor name for re-acquiring `BatchedArbor`
- `meta: ArborMeta` - metadata (includes schema)
- `interner: Arc<StringInterner>` - shared interner

Operations like `filter()` re-acquire `BatchedArbor` from the transaction for each call. The same pattern works for `index_by`.

### Data Structures

**Rust side** (`arbors-pipeline`, crate-private):
```rust
/// Location of a tree within batched storage.
pub(crate) struct TreeLocation {
    pub batch_idx: usize,
    pub local_idx: usize,
}

/// Index over batched data - NOT public API, only used by Python bindings.
pub(crate) struct BatchedIndexData {
    depth: usize,
    is_collect: bool,
    single_index: HashMap<CanonicalKey, TreeLocation>,
    collect_index: HashMap<CanonicalKey, Vec<TreeLocation>>,
    nested_index: HashMap<CanonicalKey, BatchedIndexData>,
    ordered_keys: Vec<ExprResult>,
}
```

**Python side** (owns all data, no lifetimes):
```rust
#[pyclass(name = "BatchedIndexedView")]
pub struct PyBatchedIndexedView {
    // For re-acquiring BatchedArbor on access
    txn: Py<PyReadTxn>,
    name: String,
    meta: ArborMeta,  // Includes schema for returned Trees
    interner: Arc<StringInterner>,

    // Index data (owned)
    index: BatchedIndexData,
}
```

---

## Implementation Steps

### Step 1: Create `batched_index.rs` module

**File**: `crates/arbors-pipeline/src/batched_index.rs` (NEW, ~300 lines)

```rust
//! Batched index_by: build index over BatchedArbor without materialization.
//!
//! Crate-private - only exposed via Python bindings.

use std::collections::HashMap;
use arbors_core::DecodePlan;
use arbors_query::{CanonicalKey, ExprResult, Expr, IndexByOptions, EvalContext};
use crate::projection::analyze_required_pools_multi;
use crate::source::PipelineError;

/// Location of a tree within batched storage.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TreeLocation {
    pub batch_idx: usize,
    pub local_idx: usize,
}

/// Owned index data (no lifetimes) - can be stored in Python wrapper.
#[derive(Clone)]
pub(crate) struct BatchedIndexData {
    pub depth: usize,
    pub is_collect: bool,
    pub single_index: HashMap<CanonicalKey, TreeLocation>,
    pub collect_index: HashMap<CanonicalKey, Vec<TreeLocation>>,
    pub nested_index: HashMap<CanonicalKey, BatchedIndexData>,
    pub ordered_keys: Vec<ExprResult>,
}

/// Build index over batched data using projection pushdown.
///
/// Uses `batch_with_plan()` to decode only key-related pools (bypasses cache).
///
/// **Memory note**: Collects all (key, location) pairs in memory before building
/// the index. For very large datasets (millions of trees), consider incremental
/// per-level grouping instead.
pub(crate) fn build_batched_index(
    batched: &arbors_base::BatchedArbor<'_>,
    keys: &[Expr],
    opts: IndexByOptions,
) -> Result<BatchedIndexData, PipelineError> {
    // 1. Compute DecodePlan from key expressions (only decode key pools)
    //    analyze_required_pools_multi expects &[&Expr] and Option<&SchemaRegistry>
    let key_refs: Vec<&Expr> = keys.iter().collect();
    let schema = batched.schema();
    let plan = analyze_required_pools_multi(&key_refs, schema.as_ref());
    // Returns DecodePlan directly, no Result (fallback to ALL if no schema)

    // 2. Iterate batches with plan (bypasses cache when plan != DecodePlan::ALL)
    let mut key_locations: Vec<(Vec<ExprResult>, TreeLocation)> = Vec::new();

    for batch_idx in 0..batched.batch_count() {
        let arbor = batched.batch_with_plan(batch_idx, plan.clone())?;
        for local_idx in 0..arbor.len() {
            // Evaluate key expression(s) using EvalContext (matches index_by.rs pattern)
            let ctx = EvalContext::for_tree(&arbor, local_idx);
            let key_values: Vec<ExprResult> = keys.iter()
                .map(|k| arbors_query::eval_expr(k, &ctx))
                .collect::<Result<_, _>>()?;

            key_locations.push((key_values, TreeLocation { batch_idx, local_idx }));
        }
    }

    // 3. Build index from collected keys (handles multi-key, dupe policy, null policy)
    build_index_from_keys(key_locations, keys.len(), opts)
}

/// Recursive index building (mirrors arbors_query::index_by logic).
fn build_index_from_keys(
    entries: Vec<(Vec<ExprResult>, TreeLocation)>,
    key_depth: usize,
    opts: IndexByOptions,
) -> Result<BatchedIndexData, PipelineError> {
    // Group by first key, then:
    // - If key_depth == 1 (final level): apply dupe policy (error/first/last/collect)
    // - If key_depth > 1 (intermediate): recursively build nested sub-indices
    // CRITICAL: dupe policy only at final level
    // Maintain ordered_keys in first-seen insertion order
    todo!("Mirror logic from arbors_query::index_by::build_index_level")
}
```

**API signature corrections** (verified against source):
- `analyze_required_pools_multi(&[&Expr], Option<&SchemaRegistry>) -> DecodePlan` (not Result)
- `DecodePlan::ALL` constant (not `DecodePlan::all()`)
- `EvalContext::for_tree(&arbor, tree_idx)` for expression evaluation

### Step 2: Update `arbors-pipeline/src/lib.rs`

Add module (crate-private, no public exports):
```rust
pub(crate) mod batched_index;
```

### Step 3: Add Python bindings for `PyBatchedIndexedView`

**File**: `python/src/lib.rs` (~400 lines added)

```rust
/// Batched indexed view for O(1) key lookup without materialization.
#[pyclass(name = "BatchedIndexedView")]
pub struct PyBatchedIndexedView {
    txn: Py<PyReadTxn>,
    name: String,
    meta: arbors_base::ArborMeta,  // Contains schema_bytes: Option<Vec<u8>>
    interner: Arc<StringInterner>,
    index: arbors_pipeline::batched_index::BatchedIndexData,
}

#[pymethods]
impl PyBatchedIndexedView {
    fn __len__(&self) -> usize {
        self.index.ordered_keys.len()
    }

    fn __contains__(&self, key: &Bound<'_, PyAny>) -> PyResult<bool> {
        let canon_key = py_to_canonical_key(key)?;
        Ok(self.index.single_index.contains_key(&canon_key)
            || self.index.collect_index.contains_key(&canon_key)
            || self.index.nested_index.contains_key(&canon_key))
    }

    fn __getitem__(&self, py: Python<'_>, key: &Bound<'_, PyAny>) -> PyResult<PyObject> {
        let canon_key = py_to_canonical_key(key)?;
        self.get_entry(py, &canon_key)?
            .ok_or_else(|| PyKeyError::new_err(format!("Key not found: {:?}", key)))
    }

    /// Get tree(s) for key, loading batch lazily.
    fn get_entry(&self, py: Python<'_>, key: &CanonicalKey) -> PyResult<Option<PyObject>> {
        // Check nested first (multi-key intermediate level)
        if let Some(nested) = self.index.nested_index.get(key) {
            return Ok(Some(self.nested_to_python(py, nested)?));
        }

        // Check single index
        if let Some(loc) = self.index.single_index.get(key) {
            let tree = self.load_tree(py, *loc)?;
            return Ok(Some(tree.into_py(py)));
        }

        // Check collect index
        if let Some(locs) = self.index.collect_index.get(key) {
            let trees: Vec<_> = locs.iter()
                .map(|loc| self.load_tree(py, *loc))
                .collect::<PyResult<_>>()?;
            return Ok(Some(trees.into_py(py)));
        }

        Ok(None)
    }

    /// Load a single tree from batched storage.
    fn load_tree(&self, py: Python<'_>, loc: TreeLocation) -> PyResult<Py<Tree>> {
        // Re-acquire BatchedArbor from transaction
        let py_txn = self.txn.borrow(py);
        let txn = py_txn.inner.as_ref()
            .ok_or_else(|| ArborStoreError::new_err("Transaction closed"))?;
        let batched = txn.get_batched(&self.name)?
            .ok_or_else(|| ArborStoreError::new_err("Arbor not found"))?;

        // Load specific batch (uses cache if available - good for repeated access)
        let batch_arbor = batched.batch(loc.batch_idx)?;

        // Slice to single tree
        let single_tree_arbor = batch_arbor.slice_by_indices(&[loc.local_idx])?;

        // Create Python Arbor WITHOUT schema (matches existing IndexedView behavior)
        // Note: schema_bytes in ArborMeta would need decoding; defer this complexity
        let py_arbor = Py::new(py, Arbor {
            inner: single_tree_arbor,
            schema: None,  // Like existing IndexedView - schemaless Trees
        })?;

        // Get actual root_id from the arbor (NOT NodeId::new(0))
        let root_id = py_arbor.borrow(py).inner.root(0)
            .ok_or_else(|| ArborStoreError::new_err("Tree has no root"))?;

        // Return Tree pointing at first (only) tree
        Py::new(py, Tree {
            arbor: py_arbor,
            root_id,
            tree_idx: 0,
        })
    }

    /// Return iterator over values in insertion order (matches IndexedView pattern).
    fn values(&self, py: Python<'_>) -> PyBatchedIndexedValueIter {
        // Return iterator struct, not Vec (matches IndexedView)
        PyBatchedIndexedValueIter {
            view: self.clone(),  // or Py reference
            index: 0,
        }
    }

    fn keys(&self) -> PyBatchedIndexedKeyIter {
        PyBatchedIndexedKeyIter {
            ordered_keys: self.index.ordered_keys.clone(),
            index: 0,
        }
    }

    fn items(&self, py: Python<'_>) -> PyBatchedIndexedItemIter {
        PyBatchedIndexedItemIter {
            view: self.clone(),
            index: 0,
        }
    }
}

// Iterator structs (match IndexedViewValueIter/IndexedViewItemIter pattern)
// See python/src/lib.rs around line 3500 for reference implementation
```

**Small API fixes to apply during implementation**:
1. **CanonicalKey construction**: Use `CanonicalKey(key.clone())` not `CanonicalKey::from(key)` (it's a tuple struct)
2. **Error mapping**: Wrap `ExprError` into `PipelineError::Expr(e)` in `build_batched_index`
3. **Python helpers**: Reuse existing `pyobject_to_expr_result` + `expr_result_to_python` (don't invent new names)

**Tree construction** follows existing `IndexedView` pattern:
1. Load batch via `batched.batch(batch_idx)` (uses cache - good for repeated access)
2. `slice_by_indices(&[loc.local_idx])` to create single-tree Arbor
3. Wrap as `Py<Arbor>` with `schema: None` (matches existing IndexedView)
4. Get real `root_id` via `arbor.root(0).unwrap()` (NOT `NodeId::new(0)`)
5. Return `Tree { arbor, root_id, tree_idx: 0 }`

**Iteration**: Strict insertion order via `ordered_keys`, relies on batch cache/LRU

### Step 4: Add `index_by` method to `PyBatchedArbor`

**File**: `python/src/lib.rs` (in `#[pymethods] impl PyBatchedArbor`)

```rust
/// Build an index for O(1) key lookup.
///
/// Index construction scans batches once (using projection pushdown to decode
/// only key-related pools). Tree data is loaded lazily when accessed.
#[pyo3(signature = (key, *, duplicates = "error", null_keys = "drop"))]
fn index_by(
    &self,
    py: Python<'_>,
    key: ExprOrPaths<'_>,
    duplicates: &str,
    null_keys: &str,
) -> PyResult<Py<PyBatchedIndexedView>> {
    use arbors_pipeline::batched_index::build_batched_index;

    // Parse key expressions
    let (key_exprs, _) = key.into_exprs();

    // Parse options
    let opts = IndexByOptions {
        duplicates: parse_duplicate_policy(duplicates)?,
        null_keys: parse_null_policy(null_keys)?,
    };

    // Get BatchedArbor from transaction
    let py_txn = self.txn.borrow(py);
    let txn = py_txn.inner.as_ref()
        .ok_or_else(|| ArborStoreError::new_err("Transaction has been closed"))?;
    let batched = txn.get_batched(&self.name)
        .map_err(arborbase_error_to_py_err)?
        .ok_or_else(|| ArborStoreError::new_err("Arbor not found"))?;

    // Build index (uses projection pushdown, bypasses cache)
    let index_data = build_batched_index(&batched, &key_exprs, opts)
        .map_err(pipeline_error_to_py_err)?;

    // Create Python wrapper (stores index data + txn reference)
    Py::new(py, PyBatchedIndexedView {
        txn: self.txn.clone_ref(py),
        name: self.name.clone(),
        meta: self.meta.clone(),
        interner: self.interner.clone(),
        index: index_data,
    })
}
```

### Step 5: Update Python type stubs

**File**: `python/arbors/_arbors.pyi`

Add to `BatchedArbor`:
```python
def index_by(
    self,
    key: Union[str, Expr, List[Union[str, Expr]]],
    *,
    duplicates: Literal["error", "first", "last", "collect"] = "error",
    null_keys: Literal["drop", "error"] = "drop",
) -> BatchedIndexedView: ...
```

Add new class:
```python
@final
class BatchedIndexedView:
    """Indexed view over batched data for O(1) key lookup.

    Trees are loaded lazily when accessed by key.
    """
    def __len__(self) -> int: ...
    def __getitem__(self, key: Any) -> Union[Tree, List[Tree], "BatchedIndexedView"]: ...
    def __contains__(self, key: Any) -> bool: ...
    def __iter__(self) -> Iterator[Any]: ...
    def get(self, key: Any, default: Optional[Any] = None) -> Optional[Union[Tree, List[Tree], "BatchedIndexedView"]]: ...
    def keys(self) -> Iterator[Any]: ...
    def values(self) -> Iterator[Union[Tree, List[Tree], "BatchedIndexedView"]]: ...
    def items(self) -> Iterator[Tuple[Any, Union[Tree, List[Tree], "BatchedIndexedView"]]]: ...
    @property
    def depth(self) -> int: ...
```

### Step 6: Add tests

**File**: `crates/arbors-pipeline/tests/test_batched_index.rs` (NEW)

```rust
#[test]
fn test_batched_index_parity_with_materialized() {
    // Create test arbor, store as batched
    // Build index via build_batched_index
    // Materialize and build index via index_by
    // Assert identical results for same key lookups
    // Assert same ordered_keys (insertion order)
}

#[test]
fn test_batched_index_projection_pushdown() {
    // Build index on a key field that uses only one pool
    // Verify pools_decoded < total_pools * batch_count
    // (projection pushdown means not all pools decoded)
}

#[test]
fn test_batched_index_multikey_nesting() {
    // Test idx[key1][key2] nested access
    // Verify dupe policy only at final level
    // Intermediate level should group without applying dupe policy
}

#[test]
fn test_batched_index_duplicate_policies() {
    // error: should fail on duplicate key
    // first: keeps first tree
    // last: keeps last tree
    // collect: returns Vec of all matching trees
}

#[test]
fn test_batched_index_null_key_policies() {
    // drop: trees with null/missing keys excluded from index
    // error: should fail if any tree has null/missing key
}
```

**File**: `python/tests/test_batched_index.py` (NEW)

```python
def test_batched_index_basic():
    """Same API as Arbor.index_by()"""
    with ArborStore.open(path) as base:
        with base.begin_read() as txn:
            batched = txn.get("players")
            idx = batched.index_by("playerID")
            assert "ruthba01" in idx
            tree = idx["ruthba01"]
            assert tree["playerID"].value == "ruthba01"

def test_batched_index_multikey():
    """Nested access: idx[year][team]"""
    with ArborStore.open(path) as base:
        with base.begin_read() as txn:
            batched = txn.get("teams")
            idx = batched.index_by(["yearID", "teamID"])
            team = idx[1920]["NYA"]
            assert team["teamID"].value == "NYA"

def test_batched_index_no_materialize_on_build():
    """Index build should NOT call materialize()"""
    arbors.reset_stats()
    with ArborStore.open(path) as base:
        with base.begin_read() as txn:
            batched = txn.get("players")
            idx = batched.index_by("playerID")
    stats = arbors.stats()
    assert stats["materialize_calls"] == 0
    # Note: batches ARE decoded during build (to evaluate keys)
    # but with projection pushdown, only key pools are decoded

def test_batched_index_lookups_use_cache():
    """Tree lookups should benefit from batch cache"""
    with ArborStore.open(path) as base:
        with base.begin_read() as txn:
            batched = txn.get("players")
            idx = batched.index_by("playerID")

            arbors.reset_stats()
            # First access - decodes batch
            tree1 = idx["ruthba01"]
            stats1 = arbors.stats()

            arbors.reset_stats()
            # Second access to same batch - should hit cache
            tree2 = idx["aaronha01"]  # Same batch if close playerIDs
            stats2 = arbors.stats()

            # With cache, second access may not decode
            # (depends on whether both trees are in same batch)

def test_batched_index_insertion_order():
    """Iteration should preserve first-seen insertion order"""
    with ArborStore.open(path) as base:
        with base.begin_read() as txn:
            batched = txn.get("data")
            idx = batched.index_by("id")
            # Compare with materialized version
            materialized = batched.materialize()
            idx_mat = materialized.index_by("id")
            assert list(idx.keys()) == list(idx_mat.keys())
```

### Step 7: Update baseball example (verification)

After implementation, the example should work unchanged:
```python
players_idx = players.index_by("playerID")  # Now works on BatchedArbor!
ruth = players_idx["ruthba01"]
teams_idx = teams.index_by(["yearID", "teamID"])  # Multi-key works too
team = teams_idx[1920]["NYA"]
```

---

## Critical Files

| File | Action | Lines |
|------|--------|-------|
| `crates/arbors-pipeline/src/batched_index.rs` | NEW | ~300 |
| `crates/arbors-pipeline/src/lib.rs` | MODIFY | +1 |
| `python/src/lib.rs` | MODIFY | ~400 |
| `python/arbors/_arbors.pyi` | MODIFY | ~25 |
| `crates/arbors-pipeline/tests/test_batched_index.rs` | NEW | ~150 |
| `python/tests/test_batched_index.py` | NEW | ~100 |

## Reference Files (read during implementation)

| File | What to reference |
|------|-------------------|
| `crates/arbors-query/src/index_by.rs` | Index building logic, multi-key, dupe policies |
| `crates/arbors-query/src/collection_ops.rs` | `CanonicalKey` equality/hashing |
| `crates/arbors-pipeline/src/projection.rs` | `analyze_required_pools_multi` for DecodePlan |
| `crates/arbors-pipeline/src/batched_source.rs` | `BatchedSource` pattern |
| `crates/arbors-base/src/lib.rs:2872-3130` | `BatchedArbor`, `batch_with_plan()` |
| `python/src/lib.rs:11050-11200` | `PyBatchedArbor` pattern |
| `python/src/lib.rs:3275-3605` | Existing `IndexedView` Python bindings |

---

## Verification Checklist

- [ ] `cargo build --all-features` succeeds
- [ ] `cargo test -p arbors-pipeline` passes (including new tests)
- [ ] `make python` builds
- [ ] `.venv/bin/pytest python/tests/test_batched_index.py` passes
- [ ] `python python/examples/baseball-example.py` runs successfully
- [ ] Stats confirm `materialize_calls == 0` during index build
- [ ] Parity test: batched index produces same results as `materialize().index_by()`
- [ ] Insertion order preserved in `keys()`, `values()`, `items()`
