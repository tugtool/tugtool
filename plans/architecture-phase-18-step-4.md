# Phase 18B Step 4: Projection Pushdown (Column-Selective Decoding)

## Overview

**Objective:** Implement column-selective decoding to skip unused pools during batch loading, achieving ≥3× speedup for narrow projections on wide datasets.

**Closes Requirements:** Analytics on cold open, Instant open (no warm), Performance gates

**Gate H:** decode + run narrow query end-to-end ≥ 3× faster than full decode on wide dataset

---

## Critical Design Decisions (from user feedback)

### 1. Performance: Skip UTF-8 Validation for Skipped Pools

**Problem:** `VarWidthArrayV2::view_decode()` (lines 1349-1356) calls `std::str::from_utf8()` on the **entire** string pool when `validate_utf8=true`. Skipping only Arrow array construction won't hit Gate H if we still validate skipped string pools.

**Solution:** Add `BatchV2::view_decode_with_plan()` that:
- Still parses all pool headers (needed for sequential position tracking)
- Skips UTF-8 validation for skipped pools
- Returns a `BatchView` with zeroed/invalid slice ranges for skipped pools

### 2. Correctness: Accessing Skipped Pools Must Fail Loudly

**Invariant:** Projection-decoded Arbors are only valid for executing the same query that produced the decode plan. Accessing a skipped pool should **panic** (not silently return None).

**Implementation:**
- Add `loaded_pools: Option<DecodePlan>` field to `Arbor`
- `None` = all pools loaded (default, non-projected case)
- `Some(plan)` = projection-decoded, check access against plan
- **ALL** pool accessors check the mask and panic if pool not loaded:
  - `get_bool` (Bools)
  - `get_i64` (Int64s)
  - `get_f64` (Float64s)
  - `get_string` (Strings)
  - `get_date` (Dates)
  - `get_datetime` (DateTimes)
  - `get_duration` (Durations)
  - `get_binary` (Binaries)
- **Thread plan through ALL constructors:**
  - `Arbor::from_parts()` → default `loaded_pools: None`
  - `Arbor::from_parts_with_shared()` → default `loaded_pools: None`
  - `Arbor::from_parts_projected()` → NEW, takes `DecodePlan`
  - ArborStore decode path → pass through from `batch_view_to_arbor_with_projection()`

**Derived Arbors (e.g., `slice_by_indices`):**
- Must inherit `loaded_pools` from source Arbor
- If source is projected, slice is also projected with same plan

### 3. Analyzer Accuracy: Literals Don't Require Pools

**Correction:** Literals are constants; they don't cause pool reads. Only **path expressions** require pools (based on schema-resolved types). Remove "map literals to pool types" from the analyzer.

### 4. Integration is Mandatory (Not Optional)

**Per Phase 18 Step 4:** "wired end-to-end" means the analyzer must be integrated into the query execution path in the same step. Moving "Phase 5" into the main implementation.

### 5. DecodePlan as Bitmask (Not HashSet)

**Why:** We check `should_decode()` per pool per batch. An 8-bit mask is simpler, faster, and easier to log/count than a HashSet.

```rust
#[derive(Debug, Clone, Copy, Default)]
pub struct DecodePlan(u8);  // 8 bits for 8 pools

impl DecodePlan {
    pub const ALL: DecodePlan = DecodePlan(0xFF);
    pub const NONE: DecodePlan = DecodePlan(0x00);

    pub fn should_decode(&self, pool: PoolType) -> bool {
        (self.0 & (1 << pool as u8)) != 0
    }
}
```

### 6. Schemaless Behavior: Conservative

**Decision:** Without schema, decode all pools. Projection pushdown only helps schemaful datasets (explicit or inferred). This is acceptable for the expected use case.

### 7. Type Placement: `arbors-core` (IMPORTANT)

**Problem:** `DecodePlan`/`PoolType` are defined in `arbors-base/src/v2_codec.rs`, but `arbors-storage::Arbor` needs `loaded_pools: Option<DecodePlan>`. This creates a dependency problem:
- `arbors-storage` shouldn't depend on `arbors-base` (storage is lower-level)
- Importing `DecodePlan` from `arbors-base` into `arbors-storage` would create an unwanted edge

**Decision:** Move `PoolType` and `DecodePlan` to `arbors-core` alongside `NodeType`.
- `PoolType` is conceptually paired with `NodeType` (maps node types to pools)
- Both `arbors-base` and `arbors-storage` already depend on `arbors-core`
- No new dependencies introduced

**Implementation:**
- Add `PoolType` enum and `DecodePlan` struct to `crates/arbors-core/src/lib.rs`
- Export from `arbors-core` public API
- Import into `arbors-base` for codec use and `arbors-storage` for Arbor field

### 8. Batch Cache Policy: Full Only (IMPORTANT)

**Problem:** Today, `BatchedArbor::batch()` caches decoded batches keyed by `(name, generation, batch_index)`. With projection pushdown, the same batch index can be decoded into different "shapes" (different pools loaded). If cache doesn't account for plan:
- Decode once with narrow plan → later query asks for full → receives cached **projected** arbor → panic
- Or receive cached **full** arbor → projection skip counters lie / Gate H skewed

**Decision:** Cache full batches only. Don't cache projected batches.

**Rationale:**
- Projected batches are query-specific and transient
- Full batches are the "canonical" form
- Memory blowup from per-plan caching would be severe
- Simpler implementation

**Implementation:**
- `for_each_tree_with_plan()` skips cache for non-ALL plans
- If `plan == DecodePlan::ALL`, use existing cache
- If `plan != DecodePlan::ALL`, decode directly without caching

### 9. Loud-Fail Applies to Serialization

**Scope:** The panic-on-skipped-access invariant applies to ALL access paths:
- `Arbor::get_bool/get_i64/get_string/...` (direct pool access)
- `Tree`/`RowRef` helpers (they delegate to `Arbor::get_*`)
- `arbor_to_json` / serialization paths (they touch pools for values)

**Rationale:** Projection-decoded Arbors are "query-scoped" views. Serializing them would produce incomplete/garbage JSON. Better to fail loudly than produce corrupt output.

### 10. Counter Semantics

**Definition:** `pools_decoded`/`pools_skipped` count **actual decode operations only**, not cache hits.

**Rationale:**
- Counters measure the *work saved* by projection pushdown
- Cache hits don't involve decode work regardless of plan
- Gate H evidence should reflect actual decode savings

### 11. Corruption Detection Tradeoff (Acknowledged)

**Behavior change:** By skipping UTF-8 validation for skipped pools, a DB with corrupted string pool bytes can still answer numeric-only queries successfully.

**Rationale:** This is acceptable and consistent with "query-scoped view" semantics. The corruption would only surface if a later query actually needs the string pool. Full integrity checks remain available via `DecodePlan::ALL` decode path.

---

## Requirements from Architecture Plan (18B.5)

**Deliverables:**
- [ ] Query analyzer computes required pools for a query chain
- [ ] Decoder honors decode plan and skips unused pools (including UTF-8 validation)
- [ ] Counters report decoded/skipped pools per batch
- [ ] Wired end-to-end into query execution path

**Tests:**
- [ ] `test_projection_pushdown_skips_unused_pools` (unit-level; asserts skip counters)
- [ ] `test_narrow_projection_does_not_decode_wide_columns` (integration; wide dataset)
- [ ] `test_access_skipped_pool_panics` (correctness invariant)

**Dataset:**
- [ ] Synthetic "WideTable" dataset with variety of types (not just string-heavy)

---

## Current State (from exploration)

### V2 Codec: UTF-8 Validation Location (`v2_codec.rs:1349-1356`)

```rust
if validate_utf8 {
    let values_offset = values_start - current_pos;
    std::str::from_utf8(&data[values_offset..values_offset + values_len]).map_err(|e| {
        CodecError::InvalidUtf8 { cause: e.to_string() }
    })?;
}
```

This runs for every `VarWidthArrayV2::view_decode()` call with `validate_utf8=true`, even if the pool will be skipped later.

### Batch Decode Path (`v2_codec.rs:1994-2008`)

```rust
let (pool_strings, next_pos) = VarWidthArrayV2::view_decode(&payload[pos..], true, pos)?;  // Validates UTF-8!
// ... more pools ...
let (pool_binaries, _next_pos) = VarWidthArrayV2::view_decode(&payload[pos..], false, pos)?;
```

**Key observation:** All 8 pools are decoded in fixed order. We can still parse headers (needed for positions) but skip validation.

---

## Implementation Plan

### 1. Add PoolType Enum and DecodePlan Bitmask

**File:** `crates/arbors-core/src/lib.rs` (alongside `NodeType`)

```rust
/// Identifies which primitive pool a node type uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PoolType {
    Bools = 0, Int64s = 1, Float64s = 2, Strings = 3,
    Dates = 4, DateTimes = 5, Durations = 6, Binaries = 7,
}

impl PoolType {
    pub const ALL: [PoolType; 8] = [
        PoolType::Bools, PoolType::Int64s, PoolType::Float64s, PoolType::Strings,
        PoolType::Dates, PoolType::DateTimes, PoolType::Durations, PoolType::Binaries,
    ];

    pub fn from_node_type(node_type: NodeType) -> Option<PoolType> {
        match node_type {
            NodeType::Bool => Some(PoolType::Bools),
            NodeType::Int64 => Some(PoolType::Int64s),
            NodeType::Float64 => Some(PoolType::Float64s),
            NodeType::String => Some(PoolType::Strings),
            NodeType::Date => Some(PoolType::Dates),
            NodeType::DateTime => Some(PoolType::DateTimes),
            NodeType::Duration => Some(PoolType::Durations),
            NodeType::Binary => Some(PoolType::Binaries),
            NodeType::Null | NodeType::Array | NodeType::Object => None,
        }
    }
}

/// Bitmask specifying which pools to decode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DecodePlan(u8);

impl DecodePlan {
    pub const ALL: Self = Self(0xFF);
    pub const NONE: Self = Self(0x00);

    pub fn with_pool(mut self, pool: PoolType) -> Self {
        self.0 |= 1 << pool as u8;
        self
    }

    pub fn should_decode(&self, pool: PoolType) -> bool {
        (self.0 & (1 << pool as u8)) != 0
    }

    pub fn decode_count(&self) -> u32 { self.0.count_ones() }
    pub fn skip_count(&self) -> u32 { 8 - self.0.count_ones() }
}
```

**Note:** Types placed in `arbors-core` so both `arbors-base` (codec) and `arbors-storage` (Arbor) can use them without creating dependency cycles.

### 2. Add BatchV2::view_decode_with_plan()

**File:** `crates/arbors-base/src/v2_codec.rs`

**Signature:** Match existing pattern (takes full framed bytes = header + payload):
```rust
impl BatchV2 {
    /// View decode with selective pool validation.
    ///
    /// - Always parses all pool headers (needed for sequential layout)
    /// - Skips UTF-8 validation for pools not in the decode plan
    /// - Returns BatchView with zeroed SliceRanges for skipped pools
    pub fn view_decode_with_plan(
        data: &[u8],  // Full framed bytes (header + payload), same as existing view_decode
        plan: DecodePlan,
    ) -> Result<BatchView> {
        // ... parse header, validate codec version ...
        let payload = &data[HEADER_LEN..];

        // ... parse structural arrays as before ...

        // For pool_strings: only validate UTF-8 if plan.should_decode(Strings)
        let validate_strings = plan.should_decode(PoolType::Strings);
        let (pool_strings, next_pos) = VarWidthArrayV2::view_decode(&payload[pos..], validate_strings, pos)?;
        // ... etc for other pools ...

        // Return zeroed SliceRange for skipped pools
        let pool_strings = if plan.should_decode(PoolType::Strings) {
            pool_strings
        } else {
            VarWidthArrayView::empty()  // Zeroed/invalid
        };
    }
}
```

**Empty view constructors (must zero both lengths AND slice ranges):**

```rust
impl VarWidthArrayView {
    pub const fn empty() -> Self {
        Self {
            len: 0,  // MUST be zero
            null_count: 0,
            validity: SliceRange::EMPTY,
            offsets: SliceRange::EMPTY,
            values: SliceRange::EMPTY,
        }
    }
}

impl FixedWidthArrayView {
    pub const fn empty() -> Self {
        Self { len: 0, null_count: 0, validity: SliceRange::EMPTY, values: SliceRange::EMPTY }
    }
}

impl BoolArrayView {
    pub const fn empty() -> Self {
        Self { len: 0, null_count: 0, validity: SliceRange::EMPTY, values: SliceRange::EMPTY }
    }
}

impl SliceRange {
    pub const EMPTY: Self = Self { start: 0, len: 0 };
}
```

### 3. Add Loaded Pool Tracking to Arbor

**File:** `crates/arbors-storage/src/lib.rs`

```rust
pub struct Arbor {
    // ... existing fields ...
    /// Which pools were loaded (for projection pushdown safety).
    /// If None, all pools are loaded (default/non-projected case).
    loaded_pools: Option<DecodePlan>,
}

impl Arbor {
    pub fn get_i64(&self, id: NodeId) -> Option<i64> {
        // Safety check: panic if pool not loaded
        if let Some(plan) = self.loaded_pools {
            assert!(plan.should_decode(PoolType::Int64s),
                "attempted to access skipped pool Int64s in projection-decoded Arbor");
        }
        // ... existing implementation ...
    }
}
```

### 4. Add Pool Analyzer (Reuse Existing Schema Resolver)

**File:** `crates/arbors-pipeline/src/projection.rs` (new file)

**Key decision:** Reuse existing schema path resolution from `arbors_query::vectorized` to avoid drift.
Either export `resolve_path_type()` from `arbors-query` or move to a shared utility module.

```rust
// Reuse existing path resolver to avoid subtle divergence
use arbors_query::vectorized::resolve_path_type;  // OR move to shared module

/// Analyze expressions to determine required pools.
///
/// Returns DecodePlan::ALL if:
/// - No schema is available (can't infer types)
/// - Expression contains patterns we can't analyze
pub fn analyze_required_pools(
    expr: &Expr,
    schema: Option<&SchemaRegistry>,
) -> DecodePlan {
    let Some(schema) = schema else {
        return DecodePlan::ALL;  // Conservative: no schema = all pools
    };
    let mut plan = DecodePlan::NONE;
    collect_pools(expr, schema, &mut plan);
    plan
}

fn collect_pools(expr: &Expr, schema: &SchemaRegistry, plan: &mut DecodePlan) {
    match expr {
        Expr::Path(path_expr) => {
            // Use SHARED resolver (from vectorized or extracted utility)
            if let Some(storage_type) = resolve_path_type(path_expr, schema) {
                require_pools_for_type(&storage_type, plan);
            } else {
                *plan = DecodePlan::ALL;  // Can't resolve = conservative
            }
        }
        Expr::Literal(_) => {
            // Literals don't require pools - they're constants
        }
        // Recurse into subexpressions...
        Expr::Add(lhs, rhs) | Expr::Eq(lhs, rhs) | ... => {
            collect_pools(lhs, schema, plan);
            collect_pools(rhs, schema, plan);
        }
        _ => {
            *plan = DecodePlan::ALL;  // Unknown = conservative
        }
    }
}

fn require_pools_for_type(storage: &StorageType, plan: &mut DecodePlan) {
    match storage {
        StorageType::Int64 => *plan = plan.with_pool(PoolType::Int64s),
        StorageType::Float64 => *plan = plan.with_pool(PoolType::Float64s),
        StorageType::String => *plan = plan.with_pool(PoolType::Strings),
        StorageType::Bool => *plan = plan.with_pool(PoolType::Bools),
        // ... temporal and binary types ...
        StorageType::Union { variants } => {
            // Conservative: require all variant pools
            for variant in variants {
                require_pools_for_type(variant, plan);
            }
        }
        _ => {}
    }
}
```

### 5. Wire Into Query Execution Path (ALL Operations)

**Scope:** Projection pushdown applies to:
- Batched sources (ArborStore) — primary use case
- Future streaming in-memory sources — designed for extensibility

**File:** `crates/arbors-pipeline/src/executor.rs`

Modify `PipelineExecutor` to compute and pass decode plan for **ALL query operations**:

```rust
impl<S: TreeSource> PipelineExecutor<S> {
    // === All operations get projection pushdown ===

    pub fn filter(&self, predicate: &Expr) -> Result<Vec<usize>> {
        let plan = analyze_required_pools(predicate, self.source.schema());
        self.filter_with_plan(predicate, plan)
    }

    pub fn select(&self, exprs: &[Expr]) -> Result<Vec<ExprResult>> {
        let plan = analyze_required_pools_multi(&exprs.iter().collect::<Vec<_>>(), self.source.schema());
        self.select_with_plan(exprs, plan)
    }

    pub fn aggregate(&self, exprs: &[Expr]) -> Result<ExprResult> {
        let plan = analyze_required_pools_multi(&exprs.iter().collect::<Vec<_>>(), self.source.schema());
        self.aggregate_with_plan(exprs, plan)
    }

    pub fn find_one(&self, predicate: &Expr) -> Result<Option<Tree>> {
        let plan = analyze_required_pools(predicate, self.source.schema());
        self.find_one_with_plan(predicate, plan)
    }

    pub fn find_one_index(&self, predicate: &Expr) -> Result<Option<usize>> {
        let plan = analyze_required_pools(predicate, self.source.schema());
        self.find_one_index_with_plan(predicate, plan)
    }

    pub fn filter_head(&self, predicate: &Expr, n: usize) -> Result<Vec<usize>> {
        let plan = analyze_required_pools(predicate, self.source.schema());
        self.filter_head_with_plan(predicate, n, plan)
    }

    pub fn any(&self, predicate: &Expr) -> Result<bool> {
        let plan = analyze_required_pools(predicate, self.source.schema());
        self.any_with_plan(predicate, plan)
    }

    pub fn all(&self, predicate: &Expr) -> Result<bool> {
        let plan = analyze_required_pools(predicate, self.source.schema());
        self.all_with_plan(predicate, plan)
    }
}
```

**File:** `crates/arbors-pipeline/src/source.rs`

Add plan-aware batch loading:

```rust
pub trait TreeSource: Sync {
    // ... existing methods ...

    /// Load batches with projection pushdown.
    fn for_each_tree_with_plan<F>(
        &self,
        plan: DecodePlan,
        callback: F,
    ) -> Result<usize, PipelineError>
    where
        F: FnMut(&Arbor, usize, usize) -> Result<ControlFlow<()>, PipelineError>;
}
```

**File:** `crates/arbors-base/src/lib.rs` (BatchedArbor integration)

Add a new method that bypasses cache for projected decodes:

```rust
impl BatchedArbor {
    /// Decode batch with projection plan.
    /// - If plan == ALL: use existing cache (batch())
    /// - If plan != ALL: decode directly, skip cache
    ///
    /// Returns Arbor (not Arc<Arbor>) since pipeline expects &Arbor lifetimes in callbacks.
    pub fn batch_with_plan(&self, index: usize, plan: DecodePlan) -> Result<Arbor> {
        if plan == DecodePlan::ALL {
            // Clone from cache (or decode + cache if miss)
            Ok((*self.batch(index)?).clone())
        } else {
            // Decode directly with plan, don't cache
            let view = BatchV2::view_decode_with_plan(&self.batch_bytes(index), plan)?;
            batch_view_to_arbor_with_projection(&view, &self.payload, plan)
        }
    }
}
```

`BatchedSource::for_each_tree_with_plan()` will call `batched.batch_with_plan(i, plan)` instead of `batched.batch(i)`.

### 6. Add Counters

**File:** `crates/arbors-base/src/lib.rs`

```rust
static POOLS_DECODED: AtomicU64 = AtomicU64::new(0);
static POOLS_SKIPPED: AtomicU64 = AtomicU64::new(0);

pub struct ArborStoreStats {
    // ... existing fields ...
    pub pools_decoded: u64,
    pub pools_skipped: u64,
}

impl ArborStoreStats {
    pub fn projection_skip_percent(&self) -> f64 {
        let total = self.pools_decoded + self.pools_skipped;
        if total == 0 { 0.0 } else { (self.pools_skipped as f64 / total as f64) * 100.0 }
    }
}
```

### 7. WideTable Dataset Generator

**File:** `datasets/scripts/wide_table_generator.py`

Generate with variety of types (not just string-heavy):
- 100K rows, ~200 columns
- 50 int columns, 50 float columns, 50 string columns, 50 bool columns
- JSON Schema for precise type inference

### 8. Gate H Benchmark

**File:** `crates/arbors-base/benches/projection_bench.rs`

Measure **decode + run narrow query** end-to-end using `PipelineExecutor` over `BatchedSource`:

```rust
use arbors_pipeline::{BatchedSource, PipelineExecutor, DecodePlan};

fn bench_gate_h(c: &mut Criterion) {
    let filter_expr = path("int_col_000").gt(lit(0));  // Filter on single int column

    // Baseline: Full decode + filter (DecodePlan::ALL forced)
    let full_time = measure(|| {
        let txn = base.begin_read().unwrap();
        let batched = txn.get_batched("wide").unwrap().unwrap();
        let source = BatchedSource::new(&batched);
        let executor = PipelineExecutor::new_with_plan(source, DecodePlan::ALL);
        executor.filter(&filter_expr)
    });

    // Optimized: Narrow projection (analyzer computes minimal plan)
    let narrow_time = measure(|| {
        let txn = base.begin_read().unwrap();
        let batched = txn.get_batched("wide").unwrap().unwrap();
        let source = BatchedSource::new(&batched);
        let executor = PipelineExecutor::new(source);  // Uses analyzed plan
        executor.filter(&filter_expr)
    });

    let ratio = full_time / narrow_time;
    println!("Gate H: full={:.3}ms, narrow={:.3}ms, ratio={:.2}x (target ≥3.0)",
        full_time * 1000.0, narrow_time * 1000.0, ratio);
    // Gate H: ratio >= 3.0
}
```

**Note:** Benchmark uses `PipelineExecutor` (the current query API), NOT `batched.filter()` (removed in Step 3.U).

---

## Tests

```rust
#[test]
fn test_projection_pushdown_skips_unused_pools() {
    // Create dataset with int, string, bool
    // Filter on int only
    // Assert: pools_skipped >= 2 (string + bool)
}

#[test]
fn test_narrow_projection_does_not_decode_wide_columns() {
    // WideTable with 200 columns
    // Filter on single int column
    // Assert: pools_skipped > pools_decoded
}

#[test]
fn test_access_skipped_pool_panics() {
    // Load with DecodePlan that skips Strings
    // Assert: arbor.get_string(some_id) panics
}

#[test]
fn test_schemaless_decodes_all_pools() {
    // Load without schema
    // Assert: DecodePlan::ALL used, pools_skipped == 0
}

#[test]
fn test_literals_do_not_require_pools() {
    let expr = lit(42).gt(lit(0));
    let plan = analyze_required_pools(&expr, Some(&schema));
    assert_eq!(plan, DecodePlan::NONE);  // Literals are constants
}

#[test]
fn test_projected_batches_not_cached() {
    // Load batch twice with different plans
    // First with narrow plan (Int64s only)
    // Second with ALL plan
    // Assert: second load actually decodes (not cached narrow version)
}
```

---

## Execution Order

### Phase 1: Core Types + Codec Foundation
1. Add `PoolType` enum and `DecodePlan` bitmask to `arbors-core/src/lib.rs`
2. Add `VarWidthArrayView::empty()` and other empty view constructors to `v2_codec.rs`
3. Add `BatchV2::view_decode_with_plan()` to `v2_codec.rs`
4. Unit tests for DecodePlan logic (in `arbors-core`)

### Phase 2: Decode Integration
5. Add `loaded_pools` tracking to `Arbor` (thread through all constructors)
6. Add safety asserts to pool accessors (panic on skipped access)
7. Add `batch_view_to_arbor_with_projection()` in `lib.rs`
8. Implement cache policy: skip cache for non-ALL plans
9. Add `pools_decoded`/`pools_skipped` counters
10. Test: `test_projection_pushdown_skips_unused_pools`
11. Test: `test_access_skipped_pool_panics`
12. Test: `test_projected_batches_not_cached`

### Phase 3: Analyzer + Pipeline Wiring
13. **FIRST:** Make `resolve_path_type()` a public/shared API in `arbors-query` (currently internal). Options:
    - Export from `arbors_query::vectorized` module (visibility change)
    - OR move to `arbors-schema` as shared utility
14. Create `crates/arbors-pipeline/src/projection.rs`
15. Implement `analyze_required_pools()` using the shared resolver
16. Add `for_each_tree_with_plan()` to `TreeSource` trait
17. Add `BatchedArbor::batch_with_plan()` method (cache bypass for non-ALL plans)
18. Wire analyzer into ALL PipelineExecutor ops: `filter`, `select`, `aggregate`, `find_one`, `find_one_index`, `filter_head`, `any`, `all`
19. Test: `test_schemaless_decodes_all_pools`
20. Test: `test_literals_do_not_require_pools`

### Phase 4: Dataset + Benchmark
21. Create `wide_table_generator.py`
22. Generate WideTable dataset (variety of types)
23. Implement Gate H benchmark (decode + query end-to-end)
24. Test: `test_narrow_projection_does_not_decode_wide_columns`
25. Verify Gate H passes: ratio ≥ 3.0

---

## Critical Files

| File | Changes |
|------|---------|
| `crates/arbors-core/src/lib.rs` | Add `PoolType`, `DecodePlan` (alongside `NodeType`) |
| `crates/arbors-base/src/v2_codec.rs` | Add `view_decode_with_plan()`, empty view constructors |
| `crates/arbors-base/src/lib.rs` | Add counters, `batch_view_to_arbor_with_projection()`, cache policy |
| `crates/arbors-storage/src/lib.rs` | Add `loaded_pools` to Arbor, safety asserts, constructor threading |
| `crates/arbors-pipeline/src/projection.rs` | New: analyzer |
| `crates/arbors-pipeline/src/source.rs` | Add `for_each_tree_with_plan()` |
| `crates/arbors-pipeline/src/executor.rs` | Wire analyzer into query methods |
| `crates/arbors-base/tests/projection_tests.rs` | New: tests |
| `crates/arbors-base/benches/projection_bench.rs` | New: Gate H |
| `datasets/scripts/wide_table_generator.py` | New: dataset |

---

## Exit Criteria

- [ ] `PoolType` and `DecodePlan` in `arbors-core` (no dependency issues)
- [ ] `DecodePlan` bitmask works correctly
- [ ] `view_decode_with_plan()` skips UTF-8 validation for skipped pools
- [ ] Accessing skipped pool panics (not silent None)
- [ ] Projected batches not cached (cache full-only policy)
- [ ] Analyzer is wired end-to-end into query execution
- [ ] `pools_decoded`/`pools_skipped` counters work
- [ ] All tests pass
- [ ] Gate H: decode + narrow query ≥ 3× faster than full decode
