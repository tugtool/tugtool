# Phase 18B Step 3 + Step 3.U: Unified Query Pipeline and Streaming

## Overview

**Objective:** Unify query execution paths and add streaming/early-exit capabilities.

**Key Decisions (from user):**
1. Rename `arbors-lazy` → `arbors-pipeline`
2. Remove `arbors_query::ops` functions immediately (clean break)
3. Full pipeline unification (not minimal source abstraction)
4. **No backwards compatibility required** — zero external users, can break anything
5. **`find_one` has two variants** — `find_one_index()` returns index only, `find_one()` returns owned Tree
6. **Vectorize + parallelize** — combine both (rayon for task parallelism, Arrow for SIMD)
7. **Vectorize everything** — not just filter (select, add_fields, aggregate all get vectorized paths)

**Closes Requirements:** Analytics on cold open, Instant open (no warm), Simplicity preserved

---

## Design Clarifications (from review)

### Lifetime Safety for TreeSource

The original `TreeView<'a>` design doesn't work for batched sources:
- BatchedSource loads batches on-demand (owned `Arbor` values)
- Returning a borrowed view to a batch that will be dropped is unsafe
- GAT-style iterators add complexity; Box<dyn Iterator> has overhead

**Solution:** Callback-based iteration (`for_each_tree`) + owned returns (`get_tree`)

### Vectorization + Parallelism Strategy

**Not mutually exclusive** — we combine both:

| Level | Technique | Used For |
|-------|-----------|----------|
| Task parallelism | rayon `par_iter` | Distribute trees across cores |
| Data parallelism | Arrow kernels | SIMD within each tree's arrays |

**Per-batch vectorization**: For batched sources, vectorize each batch separately:
```rust
// In filter_vectorized:
source.for_each_batch(|batch, _| {
    let batch_indices = vectorized_filter(batch, predicate)?;  // Arrow SIMD
    indices.extend(batch_indices.iter().map(|i| i + offset));
    ...
})
```

This avoids materializing the full dataset while still using Arrow kernels.

---

## Current Problem

Query execution is fragmented across 4 paths:

| Path | Location | Issue |
|------|----------|-------|
| `arbors-query::ops` | `ops.rs:53-585` | filter/select/aggregate with tree loops |
| `BatchedArbor` | `lib.rs:2734-2816` | Loops batches, calls arbors_query per batch |
| `arbors-lazy` | `execute.rs:51-328` | Plans → executes via arbors_query |
| `vectorized.rs` | foundation only | Not integrated |

**Result:** Streaming/early-exit must be implemented in multiple places.

---

## Step 3.U: Unify Query Execution Paths

### 3.U.0: Add Schema to ArborMeta (Prerequisite)

**Problem:** Schema is embedded in each batch's Arrow IPC metadata, requiring batch decoding to check vectorizability. This defeats "instant open" and skews Gate G/I.

**Solution:** Store schema in `ArborMeta` so it's available without decoding any batches.

**Modify:** `crates/arbors-base/src/lib.rs`

```rust
pub struct ArborMeta {
    pub generation: u64,
    pub tree_count: u32,
    pub batch_count: u32,
    pub trees_per_batch: u32,
    pub dict_digest: Digest,
    pub key_index_digest: Digest,
    pub batch_digests: Vec<Digest>,
    /// Schema bytes (JSON-serialized SchemaRegistry), if present.
    /// Available without decoding any batches.
    pub schema_bytes: Option<Vec<u8>>,
}
```

**Encoding strategy (forward-compatible):**
- Append `schema_len: u32` + `schema_bytes` **after** batch digests
- In `decode()`, treat "buffer ends after digests" as `schema_bytes=None`
- This gives forward compatibility: old DBs read as schemaless, new DBs include schema

```rust
// In encode():
buf.extend_from_slice(&self.batch_digests...);
match &self.schema_bytes {
    Some(bytes) => {
        buf.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        buf.extend_from_slice(bytes);
    }
    None => buf.extend_from_slice(&0u32.to_le_bytes()),
}

// In decode():
let schema_bytes = if bytes.len() > offset {
    let schema_len = u32::from_le_bytes(...) as usize;
    if schema_len > 0 { Some(bytes[offset+4..offset+4+schema_len].to_vec()) }
    else { None }
} else { None };  // Old format: no schema
```

**Changes required:**
1. Add `schema_bytes: Option<Vec<u8>>` to `ArborMeta`
2. Update `ArborMeta::encode()` with tail-appended schema (length-prefixed)
3. Update `ArborMeta::decode()` with optional tail parsing
4. Update `WriteTxn::put()` to serialize `arbor.schema()` if present
5. Add `ArborMeta::schema() -> Option<SchemaRegistry>` helper

**BatchedArbor gets cached schema access:**
```rust
pub struct BatchedArbor<'txn> {
    meta: ArborMeta,
    interner: Arc<StringInterner>,
    // Cached deserialized schema (avoid repeated JSON parsing)
    cached_schema: OnceLock<Option<SchemaRegistry>>,
    ...
}

impl BatchedArbor {
    pub fn schema(&self) -> Option<&SchemaRegistry> {
        self.cached_schema.get_or_init(|| self.meta.schema()).as_ref()
    }
}
```

**Checkpoint:** `cargo test -p arbors-base` passes

---

### 3.U.1: Rename arbors-lazy → arbors-pipeline

**Files to modify:**
```
crates/arbors-lazy/Cargo.toml          → name = "arbors-pipeline"
crates/arbors-lazy/                    → rename directory to arbors-pipeline/
Cargo.toml                             → update workspace member
crates/arbors/Cargo.toml               → arbors-lazy → arbors-pipeline
python/Cargo.toml                      → arbors-lazy → arbors-pipeline
crates/arbors/src/lib.rs               → update re-exports
```

**Checkpoint:** `cargo build` succeeds

---

### 3.U.2: Define TreeSource Trait (Revised for Lifetime Safety)

**Problem with original design:** `TreeView<'a>` borrowing an `&Arbor` doesn't work for batched sources because the batch is an owned value that gets dropped. GAT-style iterators are complex and Box<dyn Iterator> has performance overhead.

**Solution:** Use a callback/cursor approach with explicit batch boundaries. Return indices, not borrowed views.

**Schema decision:** After 3.U.0, schema is available in `ArborMeta` without batch decoding. `TreeSource::schema()` returns borrowed `Option<&SchemaRegistry>` (cached in BatchedArbor via OnceLock). This enables vectorization for batched sources while keeping Gate G/I honest.

**New file:** `crates/arbors-pipeline/src/source.rs`

```rust
pub trait TreeSource: Sync {
    fn tree_count(&self) -> usize;
    fn batch_count(&self) -> usize;

    /// Schema for vectorization decisions.
    /// InMemorySource: from Arbor::schema()
    /// BatchedSource: from BatchedArbor::schema() (cached, no batch decoding)
    fn schema(&self) -> Option<&SchemaRegistry>;

    fn for_each_tree<F>(&self, callback: F) -> Result<usize, PipelineError>
    where F: FnMut(&Arbor, usize, usize) -> Result<ControlFlow<()>, PipelineError>;

    fn for_each_batch<F>(&self, callback: F) -> Result<(), PipelineError>
    where F: FnMut(&Arbor, usize) -> Result<(), PipelineError>;

    fn par_map<T, F>(&self, f: F) -> Result<Vec<T>, PipelineError>
    where T: Send, F: Fn(&Arbor, usize) -> Result<T, PipelineError> + Sync;

    fn get_tree(&self, global_index: usize) -> Result<Tree, PipelineError>;
}

pub struct Tree { arbor: Arbor }
impl Tree { pub fn arbor(&self) -> &Arbor { &self.arbor } }
```

---

### 3.U.3: Implement InMemorySource and BatchedSource

**InMemorySource** — Uses rayon for parallelism

```rust
pub struct InMemorySource { arbor: Arc<Arbor> }

impl TreeSource for InMemorySource {
    fn tree_count(&self) -> usize { self.arbor.num_trees() }
    fn batch_count(&self) -> usize { 1 }
    fn schema(&self) -> Option<&SchemaRegistry> { self.arbor.schema() }
    // for_each_tree, par_map, get_tree: standard implementations
}
```

**BatchedSource** — Lazy batch loading, schema from metadata (no batch decoding)

```rust
pub struct BatchedSource<'txn> { batched: &'txn BatchedArbor<'txn> }

impl TreeSource for BatchedSource<'txn> {
    fn tree_count(&self) -> usize { self.batched.tree_count() }
    fn batch_count(&self) -> usize { self.batched.batch_count() }

    /// Schema from cached ArborMeta — no batch decoding required.
    fn schema(&self) -> Option<&SchemaRegistry> { self.batched.schema() }

    // for_each_tree: iterates batches, calls batch() which already records stats
    // par_map: sequential batch loading, parallel within each batch
    // get_tree: locates batch/local from global index, uses slice_by_indices
}
```

**Note:** `Tree` is a COW view via `slice_by_indices` (Arc-backed storage).

---

### 3.U.4: Unified Pipeline Executor (Revised)

**Modify:** `crates/arbors-pipeline/src/execute.rs`

```rust
pub struct PipelineExecutor<S: TreeSource> {
    source: S,
    execution_mode: ExecutionMode,
}

impl<S: TreeSource> PipelineExecutor<S> {
    pub fn new(source: S) -> Self {
        Self { source, execution_mode: ExecutionMode::default() }
    }

    /// Filter: returns indices of matching trees
    pub fn filter(&self, predicate: &Expr) -> Result<Vec<usize>, PipelineError> {
        // Choose backend based on vectorizability
        if self.should_vectorize(predicate) {
            self.filter_vectorized(predicate)
        } else if self.execution_mode.is_parallel() {
            self.filter_parallel(predicate)
        } else {
            self.filter_sequential(predicate)
        }
    }

    fn filter_parallel(&self, predicate: &Expr) -> Result<Vec<usize>, PipelineError> {
        // par_map returns bools, not indices — we re-index by position after
        let results: Vec<bool> = self.source.par_map(|arbor, local_idx| {
            let ctx = EvalContext::for_tree(arbor, local_idx);
            match eval_expr(predicate, &ctx)? {
                ExprResult::Scalar(Value::Bool(true)) => Ok(true),
                ExprResult::Scalar(Value::Bool(false)) => Ok(false),
                ExprResult::Scalar(Value::Null) | ExprResult::Null | ExprResult::Missing => Ok(false),
                ExprResult::Array(_) => Err(cardinality_error("vector")),
                other => Err(type_mismatch_error("Bool", &other)),
            }
        })?;
        // Convert bools to global indices — position in results IS the global index
        Ok(results.into_iter()
            .enumerate()
            .filter_map(|(global_idx, matched)| if matched { Some(global_idx) } else { None })
            .collect())
    }

    fn filter_vectorized(&self, predicate: &Expr) -> Result<Vec<usize>, PipelineError> {
        // Per-batch vectorization
        let mut indices = Vec::new();
        let mut offset = 0;
        self.source.for_each_batch(|batch, _| {
            let batch_indices = arbors_query::vectorized::vectorized_filter(batch, predicate)?;
            indices.extend(batch_indices.iter().map(|i| i + offset));
            offset += batch.num_trees();
            Ok(())
        })?;
        Ok(indices)
    }

    /// Select: transform each tree via expressions
    pub fn select(&self, exprs: &[Expr]) -> Result<Vec<ExprResult>, PipelineError> {
        if self.execution_mode.is_parallel() {
            self.select_parallel(exprs)
        } else {
            self.select_sequential(exprs)
        }
    }

    fn select_parallel(&self, exprs: &[Expr]) -> Result<Vec<ExprResult>, PipelineError> {
        self.source.par_map(|arbor, local_idx| {
            let ctx = EvalContext::for_tree(arbor, local_idx);
            let mut fields = IndexMap::new();
            for (i, expr) in exprs.iter().enumerate() {
                let result = eval_expr(expr, &ctx)?;
                let name = get_alias_name(expr, i);
                fields.insert(name, result);
            }
            Ok(ExprResult::Object(fields))
        })
    }

    /// AddFields: add multiple fields to each tree
    pub fn add_fields(&self, fields: &[(&str, &Expr)]) -> Result<Vec<ExprResult>, PipelineError> {
        // Same parallel strategy as select
        self.source.par_map(|arbor, local_idx| {
            let root = arbor.root(local_idx).ok_or(index_error())?;
            let ctx = EvalContext::for_tree(arbor, local_idx);
            let original = extract_result(arbor, root);

            let mut tree_obj = match original {
                ExprResult::Object(map) => map,
                ExprResult::Null => IndexMap::new(),
                other => {
                    let mut map = IndexMap::new();
                    map.insert("_original".to_string(), other);
                    map
                }
            };

            for (name, expr) in fields {
                let value = eval_expr(expr, &ctx)?;
                tree_obj.insert((*name).to_string(), value);
            }

            Ok(ExprResult::Object(tree_obj))
        })
    }

    /// Aggregate: cross-tree aggregation
    pub fn aggregate(&self, exprs: &[Expr]) -> Result<ExprResult, PipelineError> {
        // For batched sources: per-batch aggregate + combine
        // For in-memory: single-pass aggregate
        aggregate_impl(&self.source, exprs)
    }

    // === Streaming / Early-Exit (Step 3) ===

    /// Find first matching tree, returns global index only (no materialization)
    pub fn find_one_index(&self, predicate: &Expr) -> Result<Option<usize>, PipelineError> {
        let mut found_index = None;
        self.source.for_each_tree(|arbor, local_idx, global_idx| {
            let ctx = EvalContext::for_tree(arbor, local_idx);
            match eval_expr(predicate, &ctx)? {
                ExprResult::Scalar(Value::Bool(true)) => {
                    found_index = Some(global_idx);
                    Ok(ControlFlow::Break(()))  // Early exit
                }
                _ => Ok(ControlFlow::Continue(())),
            }
        })?;
        Ok(found_index)
    }

    /// Find first matching tree, returns OWNED Tree (materializes the single tree)
    pub fn find_one(&self, predicate: &Expr) -> Result<Option<Tree>, PipelineError> {
        match self.find_one_index(predicate)? {
            Some(idx) => Ok(Some(self.source.get_tree(idx)?)),
            None => Ok(None),
        }
    }

    /// Filter with limit (early-exit after n matches)
    pub fn filter_head(&self, predicate: &Expr, n: usize) -> Result<Vec<usize>, PipelineError> {
        let mut matches = Vec::with_capacity(n);
        self.source.for_each_tree(|arbor, local_idx, global_idx| {
            let ctx = EvalContext::for_tree(arbor, local_idx);
            if let ExprResult::Scalar(Value::Bool(true)) = eval_expr(predicate, &ctx)? {
                matches.push(global_idx);
                if matches.len() >= n {
                    return Ok(ControlFlow::Break(()));
                }
            }
            Ok(ControlFlow::Continue(()))
        })?;
        Ok(matches)
    }

    pub fn any(&self, predicate: &Expr) -> Result<bool, PipelineError> {
        Ok(self.find_one_index(predicate)?.is_some())
    }

    pub fn all(&self, predicate: &Expr) -> Result<bool, PipelineError> {
        let not_predicate = Expr::Not(Box::new(predicate.clone()));
        Ok(self.find_one_index(&not_predicate)?.is_none())  // No materialization
    }
}
```

---

### 3.U.5: Remove Bespoke Query Methods from BatchedArbor

**Modify:** `crates/arbors-base/src/lib.rs`

```rust
impl BatchedArbor {
    // KEEP: Source-related methods
    pub fn tree_count(&self) -> usize { ... }
    pub fn batch_count(&self) -> usize { ... }
    pub fn batch(&self, idx: usize) -> Result<Arbor> { ... }
    pub fn materialize(&self) -> Result<Arbor> { ... }

    // ADD: Streaming iterator
    pub fn iter_trees(&self) -> BatchedTreeIter { ... }

    // REMOVE: lines 2734-2816
    // - filter()
    // - aggregate()
    // - select()
}

// REMOVE: combine_batch_aggregates() (lines 2825-2874)
// REMOVE: ReadTxn::filter_batched/aggregate_batched/select_batched (lines 4186-4259)
```

---

### 3.U.6: API Parity — Preserve All Query Behavior

**CRITICAL:** The unified pipeline MUST preserve 100% functional parity with `arbors_query::ops`.

#### Current Public API (from `crates/arbors-query/src/ops.rs`)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `filter` | `(arbor: &Arbor, expr: &Expr) -> Result<Vec<usize>>` | Return indices of trees matching predicate |
| `select` | `(arbor: &Arbor, exprs: &[Expr]) -> Result<Vec<ExprResult>>` | Transform each tree via expressions |
| `add_field` | `(arbor: &Arbor, name: &str, expr: &Expr) -> Result<Vec<(ExprResult, String, ExprResult)>>` | Add/replace field in each tree (raw) |
| `apply_add_field` | `(results: Vec<...>) -> Result<Vec<ExprResult>>` | Merge add_field results |
| `add_fields` | `(arbor: &Arbor, fields: &[(&str, &Expr)]) -> Result<Vec<ExprResult>>` | Batch add multiple fields |
| `aggregate` | `(arbor: &Arbor, exprs: &[Expr]) -> Result<ExprResult>` | Cross-tree aggregation (sum/count/mean/min/max/any/all/first/last) |

#### Pipeline Equivalents

**PipelineExecutor must provide:**

```rust
impl<S: TreeSource> PipelineExecutor<S> {
    // === Direct equivalents ===

    /// Exact parity with ops::filter
    pub fn filter(&self, expr: &Expr) -> Result<Vec<usize>, PipelineError>;

    /// Exact parity with ops::select
    pub fn select(&self, exprs: &[Expr]) -> Result<Vec<ExprResult>, PipelineError>;

    /// Exact parity with ops::add_fields (preferred over add_field)
    pub fn add_fields(&self, fields: &[(&str, &Expr)]) -> Result<Vec<ExprResult>, PipelineError>;

    /// Exact parity with ops::aggregate
    /// Supports: Sum, Count, Mean, Min, Max, Any, All, First, Last
    pub fn aggregate(&self, exprs: &[Expr]) -> Result<ExprResult, PipelineError>;

    // === New streaming extensions (Step 3) ===

    pub fn filter_head(&self, expr: &Expr, n: usize) -> Result<Vec<usize>>;
    pub fn find_one(&self, expr: &Expr) -> Result<Option<TreeView>>;
    pub fn any(&self, expr: &Expr) -> Result<bool>;
    pub fn all(&self, expr: &Expr) -> Result<bool>;
}
```

#### Implementation Strategy

1. **Copy semantics exactly** — The executor methods use the same evaluation logic:
   - `EvalContext::for_tree(arbor, tree_idx)`
   - `eval_expr(expr, &ctx)`
   - Same handling of Null/Missing as false in filter
   - Same alias extraction logic (`get_alias_name`)

2. **Aggregate edge cases (MUST preserve exactly)**:
   | Operation | Empty Input | Behavior |
   |-----------|-------------|----------|
   | `sum` | Empty | Returns `0` (Int64) |
   | `count` | Empty | Returns `0` (counts non-null, **Missing counts as non-null**) |
   | `mean` | Empty | **Error** (`EmptyAggregation`) |
   | `min` | Empty | **Error** (`EmptyAggregation`) |
   | `max` | Empty | **Error** (`EmptyAggregation`) |
   | `any` | Empty | Returns `false` |
   | `all` | Empty | Returns `true` (vacuous truth) |
   | `first` | Empty/all-null | Returns `Null` |
   | `last` | Empty/all-null | Returns `Null` |

   **Array flattening**: When aggregating over vector paths like `items[*].price`, per-tree arrays are flattened into the aggregate pool.

3. **add_field/add_fields parity** — The executor must:
   - Handle non-object roots (wrap in `{"_original": ..., "new_field": ...}`)
   - Preserve field insertion order
   - Allow field overwriting
   - **Later fields cannot reference earlier added fields** (expressions evaluate against the original tree)

4. **QueryOp::AddField migration** — `arbors-lazy` has `QueryOp::AddField { name, expr }`:
   ```rust
   // In execute.rs, map AddField to add_fields with single element
   QueryOp::AddField { name, expr } => {
       let fields = [(name.as_str(), expr)];
       executor.add_fields(&fields)
   }
   ```

#### Re-export for Backwards Compatibility

**Add to:** `crates/arbors-pipeline/src/lib.rs`

```rust
// Re-export convenience functions that mirror the old ops API
// These create an InMemorySource internally for API compatibility

pub fn filter(arbor: &Arbor, expr: &Expr) -> Result<Vec<usize>, PipelineError> {
    let source = InMemorySource::new(arbor);
    PipelineExecutor::new(source).filter(expr)
}

pub fn select(arbor: &Arbor, exprs: &[Expr]) -> Result<Vec<ExprResult>, PipelineError> {
    let source = InMemorySource::new(arbor);
    PipelineExecutor::new(source).select(exprs)
}

pub fn add_fields(arbor: &Arbor, fields: &[(&str, &Expr)]) -> Result<Vec<ExprResult>, PipelineError> {
    let source = InMemorySource::new(arbor);
    PipelineExecutor::new(source).add_fields(fields)
}

pub fn aggregate(arbor: &Arbor, exprs: &[Expr]) -> Result<ExprResult, PipelineError> {
    let source = InMemorySource::new(arbor);
    PipelineExecutor::new(source).aggregate(exprs)
}

// add_field and apply_add_field are intentionally NOT re-exported
// - add_fields is the preferred API (single pass, simpler)
// - Users needing raw tuples can use the executor directly
```

#### Update arbors Re-exports

**Modify:** `crates/arbors/src/lib.rs`

```rust
// BEFORE:
pub use arbors_query::{filter, select, add_field, add_fields, apply_add_field, aggregate};

// AFTER:
pub use arbors_pipeline::{filter, select, add_fields, aggregate};
// add_field/apply_add_field removed (add_fields is the preferred single-pass API)
```

#### Parity Tests

**Strategy:** Keep `arbors_query::{filter,select,add_fields,aggregate}` exports until parity tests pass.
Parity tests compare against the re-exported functions, not the internal `ops` module.

**File:** `crates/arbors-pipeline/tests/api_parity_tests.rs`

```rust
//! These tests prove the pipeline provides identical behavior to arbors_query

#[test]
fn test_filter_parity() {
    let arbor = make_test_arbor();
    let expr = path("age").gt(lit(21));

    // Compare old (arbors_query re-export) and new (pipeline) implementations
    let old_result = arbors_query::filter(&arbor, &expr).unwrap();  // NOT ops::filter
    let new_result = arbors_pipeline::filter(&arbor, &expr).unwrap();

    assert_eq!(old_result, new_result);
}

#[test]
fn test_filter_null_handling_parity() {
    // Null/Missing treated as false (drop tree)
    let arbor = make_arbor_with_nulls();
    let expr = path("maybe_field");

    let old = arbors_query::filter(&arbor, &expr).unwrap();
    let new = arbors_pipeline::filter(&arbor, &expr).unwrap();
    assert_eq!(old, new);
}

#[test]
fn test_filter_cardinality_error_parity() {
    // Vector result without .any()/.all() should error
    let arbor = make_test_arbor();
    let expr = path("items[*].price").gt(lit(100)); // Vector, no reduction

    let old = arbors_query::filter(&arbor, &expr);
    let new = arbors_pipeline::filter(&arbor, &expr);

    assert!(old.is_err());
    assert!(new.is_err());
}

#[test]
fn test_select_parity() {
    let arbor = make_test_arbor();
    let exprs = [path("name").alias("n"), path("age").alias("a")];

    let old = arbors_query::select(&arbor, &exprs).unwrap();
    let new = arbors_pipeline::select(&arbor, &exprs).unwrap();

    assert_eq!(old.len(), new.len());
    for (o, n) in old.iter().zip(new.iter()) {
        assert_expr_result_eq(o, n);
    }
}

#[test]
fn test_add_fields_parity() {
    let arbor = make_test_arbor();
    let doubled = path("x").mul(lit(2));
    let fields = [("doubled", &doubled)];

    let old = arbors_query::add_fields(&arbor, &fields).unwrap();
    let new = arbors_pipeline::add_fields(&arbor, &fields).unwrap();

    assert_eq!(old.len(), new.len());
    for (o, n) in old.iter().zip(new.iter()) {
        assert_expr_result_eq(o, n);
    }
}

#[test]
fn test_add_fields_overwrites_existing_field_parity() {
    let arbor = make_arbor(&[r#"{"a": 1, "b": 2}"#]);
    let new_b = lit(999);
    let fields = [("b", &new_b)];

    let old = arbors_query::add_fields(&arbor, &fields).unwrap();
    let new = arbors_pipeline::add_fields(&arbor, &fields).unwrap();

    // Both should have b=999
    assert_expr_result_eq(&old[0], &new[0]);
}

#[test]
fn test_aggregate_sum_parity() {
    let arbor = make_test_arbor();
    let exprs = [path("value").sum().alias("total")];

    let old = arbors_query::aggregate(&arbor, &exprs).unwrap();
    let new = arbors_pipeline::aggregate(&arbor, &exprs).unwrap();

    assert_expr_result_eq(&old, &new);
}

#[test]
fn test_aggregate_all_ops_parity() {
    // Test sum, count, mean, min, max
    let arbor = make_numeric_arbor();

    for (name, expr) in [
        ("sum", path("n").sum().alias("r")),
        ("count", path("n").count().alias("r")),
        ("mean", path("n").mean().alias("r")),
        ("min", path("n").min().alias("r")),
        ("max", path("n").max().alias("r")),
    ] {
        let old = arbors_query::aggregate(&arbor, &[expr.clone()]).unwrap();
        let new = arbors_pipeline::aggregate(&arbor, &[expr]).unwrap();
        assert_expr_result_eq(&old, &new, &format!("aggregate {} mismatch", name));
    }
}

#[test]
fn test_aggregate_boolean_ops_parity() {
    let arbor = make_bool_arbor();

    for (name, expr) in [
        ("any", path("flag").any().alias("r")),
        ("all", path("flag").all().alias("r")),
    ] {
        let old = arbors_query::aggregate(&arbor, &[expr.clone()]).unwrap();
        let new = arbors_pipeline::aggregate(&arbor, &[expr]).unwrap();
        assert_expr_result_eq(&old, &new, &format!("aggregate {} mismatch", name));
    }
}

#[test]
fn test_aggregate_first_last_parity() {
    let arbor = make_test_arbor();

    let old_first = arbors_query::aggregate(&arbor, &[path("name").first().alias("r")]).unwrap();
    let new_first = arbors_pipeline::aggregate(&arbor, &[path("name").first().alias("r")]).unwrap();
    assert_expr_result_eq(&old_first, &new_first);

    let old_last = arbors_query::aggregate(&arbor, &[path("name").last().alias("r")]).unwrap();
    let new_last = arbors_pipeline::aggregate(&arbor, &[path("name").last().alias("r")]).unwrap();
    assert_expr_result_eq(&old_last, &new_last);
}

#[test]
fn test_aggregate_empty_arbor_parity() {
    let arbor = Arbor::new();

    // sum returns 0, mean errors
    let old_sum = arbors_query::aggregate(&arbor, &[path("x").sum().alias("r")]).unwrap();
    let new_sum = arbors_pipeline::aggregate(&arbor, &[path("x").sum().alias("r")]).unwrap();
    assert_expr_result_eq(&old_sum, &new_sum);

    let old_mean = arbors_query::aggregate(&arbor, &[path("x").mean().alias("r")]);
    let new_mean = arbors_pipeline::aggregate(&arbor, &[path("x").mean().alias("r")]);
    assert!(old_mean.is_err() == new_mean.is_err());
}
```

---

### 3.U.7: Remove arbors_query Public Re-exports

**Terminology clarification:**
- **`arbors_query::ops` module**: Internal implementation file (`ops.rs`), never `pub` to external crates
- **`arbors_query::{filter, select, ...}`**: Public re-exports via `pub use ops::{...}` in `lib.rs`

**Strategy:**
1. Parity tests compare `arbors_query::filter` (public re-export) vs `arbors_pipeline::filter`
2. After parity passes, remove the re-exports from `arbors_query/src/lib.rs`
3. `ops.rs` file remains as `pub(crate)` for internal use during transition

**Modify:** `crates/arbors-query/src/lib.rs`

```rust
// REMOVE this line after parity tests pass:
pub use ops::{add_field, add_fields, aggregate, apply_add_field, filter, select};
```

---

### 3.U.8: Integrate Vectorization as Backend

**Modify:** `crates/arbors-pipeline/src/execute.rs`

```rust
impl<S: TreeSource> PipelineExecutor<S> {
    fn should_vectorize(&self, expr: &Expr) -> bool {
        self.source.schema()
            .map(|s| is_vectorizable(expr, Some(s)).is_ok())
            .unwrap_or(false)
    }

    pub fn filter(&self, predicate: &Expr) -> Result<Vec<usize>> {
        if self.should_vectorize(predicate) {
            vectorized_filter(&self.source, predicate)
        } else { self.filter_interpreted(predicate) }
    }

    pub fn select(&self, exprs: &[Expr]) -> Result<Vec<ExprResult>> {
        if exprs.iter().all(|e| self.should_vectorize(e)) {
            vectorized_select(&self.source, exprs)
        } else { self.select_interpreted(exprs) }
    }

    pub fn add_fields(&self, fields: &[(&str, &Expr)]) -> Result<Vec<ExprResult>> {
        if fields.iter().all(|(_, e)| self.should_vectorize(e)) {
            vectorized_add_fields(&self.source, fields)
        } else { self.add_fields_interpreted(fields) }
    }

    pub fn aggregate(&self, exprs: &[Expr]) -> Result<ExprResult> {
        if exprs.iter().all(|e| self.should_vectorize(e)) {
            vectorized_aggregate(&self.source, exprs)
        } else { self.aggregate_interpreted(exprs) }
    }
}
```

**Vectorization scope for this phase (all operations):**

| Operation | Vectorized? | Implementation |
|-----------|-------------|----------------|
| `filter` | ✅ | Extend existing `vectorized_filter()` |
| `select` | ✅ | Vectorized column projection → ExprResult assembly |
| `add_fields` | ✅ | Evaluate exprs vectorized, merge with original object |
| `aggregate` | ✅ | Arrow compute kernels (sum/count/mean/min/max) |

**Key principle:** Vectorization requires schema. Schema now available from ArborMeta (no batch decoding). If no schema, fallback to interpreted execution.

**Vectorized select/add_fields strategy:**
- Use vectorized expression evaluation to compute all field values
- Assemble `ExprResult::Object(IndexMap)` from columnar results
- For paths that return arrays, flatten appropriately

**Vectorized aggregate strategy:**
- For numeric aggregates (sum/count/min/max): use `arrow::compute` kernels
- For mean: compute sum + count, divide
- For boolean aggregates (any/all): use `arrow::compute::any`/`all` kernels
- For first/last: index into Arrow arrays directly

---

### 3.U.8b: Implement Vectorized Ops

**New file:** `crates/arbors-pipeline/src/vectorized_ops.rs`

```rust
/// Vectorized filter (extends existing vectorized_filter from arbors-query)
pub fn vectorized_filter<S: TreeSource>(source: &S, predicate: &Expr) -> Result<Vec<usize>> {
    // Per-batch vectorization with offset tracking
}

/// Vectorized select — evaluate expressions on columnar data
pub fn vectorized_select<S: TreeSource>(source: &S, exprs: &[Expr]) -> Result<Vec<ExprResult>> {
    // For each tree: evaluate all exprs vectorized, assemble Object result
    // Uses Arrow column projection for path expressions
}

/// Vectorized add_fields — merge new fields with original objects
pub fn vectorized_add_fields<S: TreeSource>(source: &S, fields: &[(&str, &Expr)]) -> Result<Vec<ExprResult>> {
    // Extract original object fields + evaluate new field exprs vectorized
}

/// Vectorized aggregate — Arrow compute kernels
pub fn vectorized_aggregate<S: TreeSource>(source: &S, exprs: &[Expr]) -> Result<ExprResult> {
    // For each aggregate expr:
    // - sum: arrow::compute::sum
    // - count: count non-null
    // - mean: sum / count
    // - min/max: arrow::compute::min/max
    // - any/all: arrow::compute::any/all
    // - first/last: index [0] / [len-1]
}
```

**Checkpoint:** `cargo test -p arbors-pipeline` passes with vectorized paths

---

### 3.U.9: Update LazyArbor to Use Pipeline

**Modify:** `crates/arbors-pipeline/src/lazy.rs`

```rust
impl LazyArbor {
    pub fn collect(self) -> Result<Arbor> {
        let source = InMemorySource::new(self.source.clone());
        let executor = PipelineExecutor::new(source);
        // Execute plan operations using unified executor
    }
}
```

---

## Step 3: Streaming Query Core

### 3.1: Streaming via for_each_tree (NOT iter_trees)

**Design note:** An `iter_trees()` returning borrowed `Tree<'a>` is NOT safe for batched sources (batch gets dropped, dangling reference). Instead, use the callback-based `for_each_tree` from the TreeSource trait.

The streaming abstraction is already defined in TreeSource (Step 3.U.2/3.U.3):
- `for_each_tree(callback)` — callback receives `(&Arbor, local_idx, global_idx)`
- Callback returns `ControlFlow::Break` for early-exit

**No additional API needed on BatchedArbor** — streaming is handled at the TreeSource level via BatchedSource wrapper.

---

### 3.2: Lazy Query Results

**New file:** `crates/arbors-pipeline/src/lazy_result.rs`

```rust
pub struct LazyFilterResult<S: TreeSource> {
    source: S,
    predicate: Expr,
}

impl LazyFilterResult {
    pub fn count(&self) -> Result<usize> { /* no materialization */ }
    pub fn indices(&self) -> Result<Vec<usize>> { /* compute once */ }
    pub fn iter_trees(&self) -> impl Iterator { /* lazy filter */ }
}
```

---

### 3.3: Early-Exit Operators

**Add to:** `crates/arbors-pipeline/src/execute.rs`

```rust
impl PipelineExecutor {
    pub fn head(&self, n: usize) -> Result<Vec<usize>> {
        // Stop after n trees, record early_exit_batches_skipped
    }

    pub fn find_one(&self, predicate: &Expr) -> Result<Option<TreeView>> {
        // Stop on first match, record early_exit
    }

    pub fn any(&self, predicate: &Expr) -> Result<bool> {
        Ok(self.find_one(predicate)?.is_some())
    }

    pub fn all(&self, predicate: &Expr) -> Result<bool> {
        // Stop on first non-match
    }
}
```

---

## Required Tests

### Step 3.U.0 Tests (Schema in ArborMeta)

**File:** `crates/arbors-base/tests/meta_schema_tests.rs`

```rust
#[test]
fn test_schema_stored_in_meta() {
    // Put arbor with schema
    // Get ArborMeta without decoding batches
    // Verify meta.schema() returns the schema
}

#[test]
fn test_batched_arbor_schema_no_decode() {
    reset_arborbase_stats();
    let batched = txn.get_batched("test").unwrap();
    let schema = batched.schema();  // Should NOT decode any batches
    assert!(schema.is_some());
    assert_eq!(arborbase_stats().batches_decoded, 0);
}

#[test]
fn test_meta_encode_decode_with_schema() {
    // Encode ArborMeta with schema_bytes
    // Decode and verify schema roundtrips
}
```

### Step 3.U Tests

**File:** `crates/arbors-pipeline/tests/unified_pipeline_tests.rs`

```rust
#[test] fn test_batched_queries_use_unified_pipeline() { ... }
#[test] fn test_in_memory_and_batched_produce_identical_results_for_same_query() { ... }
#[test] fn test_query_pipeline_source_matrix_smoke() { ... }
```

### Step 3.U.8b Tests (Vectorized Ops)

**File:** `crates/arbors-pipeline/tests/vectorized_ops_tests.rs`

```rust
#[test]
fn test_vectorized_select_parity() {
    // Compare vectorized_select vs interpreted select
    // Must produce identical ExprResult for same expressions
}

#[test]
fn test_vectorized_add_fields_parity() {
    // Compare vectorized vs interpreted add_fields
}

#[test]
fn test_vectorized_aggregate_sum() {
    // Verify Arrow sum kernel matches interpreted sum
}

#[test]
fn test_vectorized_aggregate_mean() {
    // Verify mean = sum / count
}

#[test]
fn test_vectorized_aggregate_any_all() {
    // Verify boolean aggregate kernels
}

#[test]
fn test_vectorized_batched_no_materialization() {
    // Vectorized ops on batched source should NOT call materialize()
    reset_arborbase_stats();
    let source = BatchedSource::new(&batched);
    vectorized_aggregate(&source, &[path("n").sum()]);
    assert_eq!(arborbase_stats().materialize_calls, 0);
}
```

### Step 3 Tests

**File:** `crates/arbors-pipeline/tests/streaming_tests.rs`

```rust
#[test]
fn test_for_each_tree_is_lazy_by_counter() {
    // Create 10-batch dataset
    // Call for_each_tree with early-exit after processing 1 tree
    // Assert: arborbase_stats().batches_decoded == 1
}

#[test]
fn test_filter_count_uses_indices_not_materialization() {
    // Filter returns Vec<usize>, not materialized trees
    // Assert: arborbase_stats().materialize_calls == 0
}

#[test]
fn test_find_one_stops_after_first_match() {
    // Create 10-batch dataset, match is in batch 0
    // Call find_one
    // Assert: arborbase_stats().batches_decoded == 1
    // Assert: returned Tree is owned and valid
}

#[test]
fn test_find_one_returns_owned_tree() {
    // find_one returns Tree (owned), not a reference
    // The Tree can be used after the source is dropped
    let tree = executor.find_one(&predicate)?;
    drop(executor);  // Source dropped
    assert!(tree.is_some());
    let arbor = tree.unwrap().arbor();  // Still valid
    assert_eq!(arbor.num_trees(), 1);
}

#[test]
fn test_filter_head_early_exit() {
    // Create 10-batch dataset, 100 trees each
    // filter_head with n=5, all matching
    // Assert: batches_decoded == 1 (all 5 in first batch)
}

#[test]
fn test_any_early_exit() {
    // Match in batch 0
    // Assert: any() returns true, batches_decoded == 1
}

#[test]
fn test_all_early_exit_on_false() {
    // First batch has non-matching tree
    // Assert: all() returns false, batches_decoded == 1
}
```

---

## Instrumentation Requirements

**Existing counters** (from Phase 18B Step 1):
- `batches_decoded` — incremented by `record_batch_decoded()`
- `materialize_calls` — incremented when full Arbor is created from batches

**New counters needed for Step 3**:
- `trees_processed` — count of trees visited during streaming operations
- `early_exits` — count of operations that terminated early via ControlFlow::Break

**Usage in tests:**
```rust
reset_arborbase_stats();
executor.find_one(&predicate)?;
let stats = arborbase_stats();
assert_eq!(stats.batches_decoded, 1);
assert_eq!(stats.early_exits, 1);
```

---

## Files Summary

### Create
| File | Purpose |
|------|---------|
| `crates/arbors-pipeline/src/source.rs` | TreeSource trait + InMemorySource |
| `crates/arbors-pipeline/src/batched_source.rs` | BatchedSource wrapper |
| `crates/arbors-pipeline/src/vectorized_ops.rs` | Vectorized select/add_fields/aggregate |
| `crates/arbors-pipeline/src/lazy_result.rs` | Lazy query result types |
| `crates/arbors-base/tests/meta_schema_tests.rs` | Schema in ArborMeta tests |
| `crates/arbors-pipeline/tests/api_parity_tests.rs` | **Parity tests: verify pipeline = ops.rs** |
| `crates/arbors-pipeline/tests/unified_pipeline_tests.rs` | 3.U tests |
| `crates/arbors-pipeline/tests/streaming_tests.rs` | Step 3 tests |

### Modify
| File | Changes |
|------|---------|
| `crates/arbors-base/src/lib.rs` | ArborMeta schema_bytes, BatchedArbor::schema(), remove query methods |
| `crates/arbors-lazy/Cargo.toml` | Rename to arbors-pipeline |
| `crates/arbors-pipeline/src/lib.rs` | Add source module exports |
| `crates/arbors-pipeline/src/execute.rs` | Unified executor with vectorized backends |
| `crates/arbors-query/src/lib.rs` | Remove ops.rs exports |
| `python/src/lib.rs` | Update imports |

### Delete/Deprecate
| File/Code | Reason |
|------|--------|
| `arbors-query::ops` exports | Moved to pipeline |
| `BatchedArbor::filter/select/aggregate` | Use pipeline instead |
| `combine_batch_aggregates()` | Moved to pipeline |

---

## Execution Order

1. **3.U.0**: Add schema to ArborMeta (`cargo test -p arbors-base` checkpoint)
2. **3.U.1**: Rename arbors-lazy → arbors-pipeline (`cargo build` checkpoint)
3. **3.U.2**: TreeSource trait + InMemorySource (unit tests)
4. **3.U.3**: BatchedSource implementation (unit tests)
5. **3.U.4**: Unified executor with filter/select/add_fields/aggregate (integration tests)
6. **3.U.5**: Remove BatchedArbor query methods (update callers)
7. **3.U.6**: API parity — implement all ops.rs functions in pipeline + parity tests
   - Add convenience re-exports (filter, select, add_fields, aggregate)
   - Run parity tests to verify identical behavior
   - **GATE: All parity tests must pass before proceeding**
8. **3.U.7**: Remove arbors_query::ops public exports (only after parity verified)
9. **3.U.8**: Integrate vectorization decision logic
10. **3.U.8b**: Implement vectorized_select, vectorized_add_fields, vectorized_aggregate
11. **3.U.9**: Update LazyArbor to use pipeline
12. **3.1**: Streaming via for_each_tree (already in TreeSource)
13. **3.2**: Lazy query results
14. **3.3**: Early-exit operators

---

## Gates to Verify

- **Gate K**: In-memory parity (±10%)
- **Gate G**: First tree latency (<5ms warm-cache)
- **Gate I**: Early-exit touches ≤1 batch when match is early

---

## Exit Criteria

- [ ] **Schema in ArborMeta** — schema available without batch decoding
- [ ] **API Parity verified** — all parity tests pass (filter, select, add_fields, aggregate)
- [ ] Batched execution uses unified pipeline (no bespoke query engine)
- [ ] Vectorized execution is backend behind unified pipeline (for in-memory AND batched)
- [ ] for_each_tree() is lazy (verified by counter)
- [ ] Early-exit operators work and are measurable
- [ ] All required tests pass
- [ ] `arbors_query::ops` exports removed (after parity verified)
- [ ] `arbors::filter/select/add_fields/aggregate` re-exported from pipeline
