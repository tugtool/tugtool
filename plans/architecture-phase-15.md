# Phase 15: Documentation Refresh and API Completion

**Goal:** Bring documentation fully up to date with the implemented codebase, complete remaining Phase 14 gaps, and add Tree Diff functionality from the Phase 13 desiderata.

**Status:** In Progress (15.1 Documentation Refresh complete)

---

## Overview

Phase 15 consolidates documentation and closes out remaining feature gaps from Phases 11-14. The codebase has evolved significantly with API renames (Phase 13), the validation crate, join/explode operations (Phase 14), and extensive Python bindings work (Phase 11). This phase synchronizes documentation with reality and completes a few missing pieces.

### What's Complete (from prior phases)

**Phase 14 implementation (14a-14d) is largely complete:**

| Category | Features | Status |
|----------|----------|--------|
| Numeric ops | `abs`, `round`, `floor`, `ceil`, `pow`, `modulo` | Rust + Python |
| Object introspection | `keys`, `values`, `keys_lenient`, `values_lenient` | Rust + Python |
| Object transformation | `to_entries`, `from_entries`, `map` | Rust + Python |
| Temporal ops | `weekday`, `week`, `quarter`, `epoch` | Rust + Python |
| String ops | `strip_prefix`, `strip_suffix` | Rust + Python |
| Membership | `is_in` | Rust + Python |
| Type predicates | `is_null`, `is_bool`, `is_int`, `is_float`, `is_numeric`, `is_string`, `is_array`, `is_object`, `is_date`, `is_datetime`, `is_duration`, `type_of` | Rust + Python |
| Query ops | `join` (all JoinType variants), `explode` (Arbor, Tree, ArborView) | Rust + Python |
| Table ops | `sample`, `shuffle`, `add_fields` | Rust + Python |

### What's Missing (carried forward)

| Item | Source | Status |
|------|--------|--------|
| ~~Python binding for `modulo`~~ | Phase 14 | ✅ Complete (via `__mod__` operator) |
| ~~`flatten(depth)`~~ | Phase 14 P1 | ✅ Complete |
| ~~`clip`/`is_between`~~ | Phase 14 P1 | ✅ Complete |
| ~~`min_by`/`max_by`~~ | Phase 14 P1 | ✅ Complete |
| Tree Diff | Phase 13.6 desiderata | Compare trees, find differences |

---

## 15.1 Documentation Refresh ✅ COMPLETE

**Purpose:** Synchronize `docs/ARCHITECTURE.md` and `docs/API.md` with the current codebase.

### 15.1.1 ARCHITECTURE.md Restructure

The architecture document was restructured from a phase-based historical record to a conceptual architecture guide. The new document explains what Arbors is and how it works, organized by concept rather than implementation order.

**New conceptual structure:**
- Core Concepts (design principles, data model)
- Project Structure (crate organization)
- Storage Architecture (node structure, columnar storage, primitive pools, interning)
- Expression System (building, evaluation, total order)
- Query Operations (collection ops, transformations, lazy evaluation)
- ArborView (tabular access to columnar data)
- Schema System (JSON Schema input, inference, validation)
- Arrow Integration
- Python Bindings
- Dependencies and test coverage

**Removed:** All "Phase N" headings and implementation status tracking (this belongs in plans/, not docs/).

### 15.1.2 API.md Updates

**Added sections:**
- Join Operations with JoinType enum and semantics
- Explode Operations with semantics
- Sampling Operations (sample, shuffle)
- Numeric Operations (abs, round, floor, ceil, pow, modulo)
- Arithmetic Operators (add, sub, mul, div, neg)
- Object Introspection (keys, values, to_entries, from_entries)
- ArborView Materialization (materialize_view, materialize_view_row, materialize_view_rows)
- Expanded Validation section with policies and usage

**Updated sections:**
- String Operations: added strip_prefix, strip_suffix
- Temporal Operations: added weekday, week, quarter, epoch
- Array Operations: added is_in, map
- Transformation Functions: added add_fields (plural)
- LazyArbor: added aggregate method
- Type Predicates: confirmed is_date, is_datetime, is_duration present
- Version updated to Phase 15, status updated

### 15.1.3 Tasks

- [x] Restructure ARCHITECTURE.md as conceptual guide (not phase history)
- [x] Update project structure (all 11 crates)
- [x] Update test coverage numbers (2700+ Rust, 1900+ Python)
- [x] Update dependency versions (Arrow 57, PyO3 0.26)
- [x] Add Join, Explode, Sampling sections to API.md
- [x] Add Numeric and Arithmetic operations to API.md
- [x] Add Object Introspection section to API.md
- [x] Add ArborView Materialization to API.md
- [x] Expand Validation section in API.md
- [x] Add add_fields and aggregate to transformation/lazy sections

### 15.1.4 Deliverables and Checkpoints

**Deliverable:** Updated documentation matching current codebase.

| Checkpoint | Verification |
|------------|--------------|
| ARCHITECTURE.md is conceptual, not phase-based | No "Phase N" headings |
| Project structure includes all 11 crates | Diagram matches `ls crates/` |
| API.md has no old method names | No `agg`, `with_column` references |
| API.md includes ArborView materialization | Section present |
| Test numbers are current | 2700+ Rust, 1900+ Python |

**Commit:** `docs: restructure ARCHITECTURE.md and update API.md`

---

## 15.2 Complete Remaining Phase 14 Gaps

**Purpose:** Close out the P1 items from Phase 14 that weren't implemented.

> Execution steps correspond to implementable sub-phases (15.2a–15.2c).

---

### Step 15.2a: `flatten(depth)` — Flatten Nested Arrays

**Commit:** `feat(expr): add flatten for nested array flattening`

**References:** Phase 14 P1 array operations, jq `flatten` semantics

**Surface:** `Expr::flatten(depth: Option<usize>) -> Expr`

**Semantics:**
- `[[1, 2], [3, 4]].flatten()` → `[1, 2, 3, 4]` (depth=1, default)
- `[[[1]], [[2]]].flatten(2)` → `[1, 2]` (depth=2)
- `flatten(None)` or `flatten(-1)` = flatten all levels recursively
- Non-array input: wrap in single-element array `[value]` (lenient) or pass through unchanged
- Null input: returns null (null propagation)
- Missing input: returns missing (missing propagation)

**Implementation:**

| File | Changes |
|------|---------|
| `crates/arbors-expr/src/expr.rs` | Add `Flatten { expr: Box<Expr>, depth: Option<usize> }` variant |
| `crates/arbors-expr/src/expr.rs` | Add `fn flatten(self, depth: Option<usize>) -> Expr` builder |
| `crates/arbors-query/src/eval.rs` | Add evaluation logic with recursive flattening |
| `python/src/lib.rs` | Add `fn flatten(&self, depth: Option<usize>) -> Expr` to PyExpr |
| `python/arbors/_arbors.pyi` | Add `def flatten(self, depth: int | None = None) -> Expr` stub |

**Tasks:**
- [x] Add `Flatten` variant to Expr enum with `expr` and `depth` fields
- [x] Add `fn flatten(self, depth: Option<usize>) -> Expr` builder method
- [x] Implement evaluation in eval.rs with recursive depth handling
- [x] Add Rust unit tests (see below)
- [x] Add Python binding with optional depth parameter
- [x] Add Python unit tests (see below)
- [x] Update type stubs

**Unit Tests — Rust (`crates/arbors-expr/tests/` or `crates/arbors-query/tests/`):**
- [x] `test_flatten_depth_1_simple` — `[[1, 2], [3, 4]].flatten()` → `[1, 2, 3, 4]`
- [x] `test_flatten_depth_1_mixed_lengths` — `[[1], [2, 3], [4, 5, 6]].flatten()` → `[1, 2, 3, 4, 5, 6]`
- [x] `test_flatten_depth_1_with_empty` — `[[1, 2], [], [3]].flatten()` → `[1, 2, 3]`
- [x] `test_flatten_depth_1_single_nested` — `[[1, 2, 3]].flatten()` → `[1, 2, 3]`
- [x] `test_flatten_depth_2` — `[[[1, 2]], [[3, 4]]].flatten(2)` → `[1, 2, 3, 4]`
- [x] `test_flatten_depth_2_mixed` — `[[[1], [2]], [[3]]].flatten(2)` → `[1, 2, 3]`
- [x] `test_flatten_depth_exceeds_nesting` — `[[1, 2]].flatten(10)` → `[1, 2]` (stops at leaves)
- [x] `test_flatten_all_levels` — `[[[1]], [[2]], [[[3]]]].flatten(None)` → `[1, 2, 3]`
- [x] `test_flatten_already_flat` — `[1, 2, 3].flatten()` → `[1, 2, 3]` (no change)
- [x] `test_flatten_empty_array` — `[].flatten()` → `[]`
- [x] `test_flatten_empty_nested` — `[[], [], []].flatten()` → `[]`
- [x] `test_flatten_non_array_passthrough` — `42.flatten()` → `42` (or error, define behavior)
- [x] `test_flatten_object_passthrough` — `{"a": 1}.flatten()` → `{"a": 1}` (or error)
- [x] `test_flatten_null_propagation` — `null.flatten()` → `null`
- [x] `test_flatten_missing_propagation` — `missing.flatten()` → `missing`
- [x] `test_flatten_mixed_types_in_array` — `[[1, "a"], [true, null]].flatten()` → `[1, "a", true, null]`
- [x] `test_flatten_nested_objects` — `[[{"a": 1}], [{"b": 2}]].flatten()` → `[{"a": 1}, {"b": 2}]`
- [x] `test_flatten_depth_0` — `[[1, 2]].flatten(0)` → `[[1, 2]]` (no flattening)

**Unit Tests — Python (`python/tests/test_flatten.py`):**
- [x] `test_flatten_default_depth` — `path("arr").flatten()` with default depth=1
- [x] `test_flatten_explicit_depth_1` — `path("arr").flatten(1)` matches default
- [x] `test_flatten_depth_2` — `path("arr").flatten(2)` flattens two levels
- [x] `test_flatten_all_levels` — `path("arr").flatten(None)` flattens completely
- [x] `test_flatten_in_filter` — Use flatten result in filter predicate
- [x] `test_flatten_chained` — `path("arr").flatten().flatten()` double flatten
- [x] `test_flatten_with_map` — `path("arr").flatten().arr.map(@ * 2)` combination

**Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test -p arbors-expr` ✓
- [x] `cargo test -p arbors-query` ✓
- [x] `make test` ✓ (Python tests pass)
- [x] `make check-stubs` ✓

---

### Step 15.2b: `clip(min, max)` and `is_between(lower, upper)`

**Commit:** `feat(expr): add clip and is_between for range operations`

**References:** Phase 14 P1 numeric operations, NumPy `clip`, Polars `is_between`

**Surface:**
- `Expr::clip(min: Expr, max: Expr) -> Expr`
- `Expr::is_between(lower: Expr, upper: Expr) -> Expr`

**Semantics — clip:**
- Clamps value to `[min, max]` range
- `5.clip(0, 10)` → `5` (in range, unchanged)
- `(-3).clip(0, 10)` → `0` (below min, clamped to min)
- `15.clip(0, 10)` → `10` (above max, clamped to max)
- Works with int and float (preserves type when possible)
- If `min > max`: error (invalid range)
- Null propagation: `null.clip(0, 10)` → `null`
- Missing propagation: `missing.clip(0, 10)` → `missing`
- Non-numeric: error

**Semantics — is_between:**
- Returns true if `lower <= value <= upper` (inclusive on both ends)
- `5.is_between(0, 10)` → `true`
- `0.is_between(0, 10)` → `true` (inclusive lower bound)
- `10.is_between(0, 10)` → `true` (inclusive upper bound)
- `(-1).is_between(0, 10)` → `false`
- `11.is_between(0, 10)` → `false`
- Works with all comparable types using Total Order (D1)
- Null propagation: `null.is_between(0, 10)` → `null`
- Missing propagation: `missing.is_between(0, 10)` → `missing`

**Implementation:**

| File | Changes |
|------|---------|
| `crates/arbors-expr/src/expr.rs` | Add `Clip { expr, min, max }` variant |
| `crates/arbors-expr/src/expr.rs` | Add `IsBetween { expr, lower, upper }` variant |
| `crates/arbors-expr/src/expr.rs` | Add `fn clip(self, min: Expr, max: Expr) -> Expr` builder |
| `crates/arbors-expr/src/expr.rs` | Add `fn is_between(self, lower: Expr, upper: Expr) -> Expr` builder |
| `crates/arbors-query/src/eval.rs` | Add evaluation logic for both |
| `python/src/lib.rs` | Add `fn clip(&self, min: ExprInput, max: ExprInput) -> Expr` |
| `python/src/lib.rs` | Add `fn is_between(&self, lower: ExprInput, upper: ExprInput) -> Expr` |
| `python/arbors/_arbors.pyi` | Add stubs for both methods |

**Tasks:**
- [x] Add `Clip { expr, min, max }` variant to Expr enum
- [x] Add `IsBetween { expr, lower, upper }` variant to Expr enum
- [x] Add `fn clip(self, min: Expr, max: Expr) -> Expr` builder method
- [x] Add `fn is_between(self, lower: Expr, upper: Expr) -> Expr` builder method
- [x] Implement `Clip` evaluation with range clamping
- [x] Implement `IsBetween` evaluation using Total Order comparator
- [x] Add Rust unit tests for clip (see below)
- [x] Add Rust unit tests for is_between (see below)
- [x] Add Python bindings
- [x] Add Python unit tests
- [x] Update type stubs

**Unit Tests — clip (Rust):**
- [x] `test_clip_in_range_int` — `5.clip(0, 10)` → `5`
- [x] `test_clip_in_range_float` — `5.5.clip(0.0, 10.0)` → `5.5`
- [x] `test_clip_below_min_int` — `(-5).clip(0, 10)` → `0`
- [x] `test_clip_below_min_float` — `(-5.5).clip(0.0, 10.0)` → `0.0`
- [x] `test_clip_above_max_int` — `15.clip(0, 10)` → `10`
- [x] `test_clip_above_max_float` — `15.5.clip(0.0, 10.0)` → `10.0`
- [x] `test_clip_at_min_boundary` — `0.clip(0, 10)` → `0`
- [x] `test_clip_at_max_boundary` — `10.clip(0, 10)` → `10`
- [x] `test_clip_negative_range` — `(-5).clip(-10, -1)` → `-5`
- [x] `test_clip_single_value_range` — `5.clip(3, 3)` → `3` (clamped to single value)
- [x] `test_clip_mixed_int_float_bounds` — `5.clip(0.0, 10)` → `5` (type coercion)
- [x] `test_clip_invalid_range_error` — `5.clip(10, 0)` → error (min > max)
- [x] `test_clip_null_value` — `null.clip(0, 10)` → `null`
- [x] `test_clip_null_min` — `5.clip(null, 10)` → `null` (or error, define behavior)
- [x] `test_clip_null_max` — `5.clip(0, null)` → `null` (or error, define behavior)
- [x] `test_clip_missing_propagation` — `missing.clip(0, 10)` → `missing`
- [x] `test_clip_non_numeric_error` — `"hello".clip(0, 10)` → error
- [x] `test_clip_preserves_int_type` — `15.clip(0, 10)` returns int, not float
- [ ] `test_clip_nan_handling` — `NaN.clip(0, 10)` → define behavior (NaN or error)

**Unit Tests — is_between (Rust):**
- [x] `test_is_between_in_range_int` — `5.is_between(0, 10)` → `true`
- [x] `test_is_between_in_range_float` — `5.5.is_between(0.0, 10.0)` → `true`
- [x] `test_is_between_below_lower` — `(-1).is_between(0, 10)` → `false`
- [x] `test_is_between_above_upper` — `11.is_between(0, 10)` → `false`
- [x] `test_is_between_at_lower_bound` — `0.is_between(0, 10)` → `true` (inclusive)
- [x] `test_is_between_at_upper_bound` — `10.is_between(0, 10)` → `true` (inclusive)
- [x] `test_is_between_negative_range` — `(-5).is_between(-10, -1)` → `true`
- [x] `test_is_between_single_value_range` — `5.is_between(5, 5)` → `true`
- [x] `test_is_between_single_value_outside` — `4.is_between(5, 5)` → `false`
- [x] `test_is_between_string_range` — `"cat".is_between("ant", "dog")` → `true` (lexicographic)
- [ ] `test_is_between_date_range` — date in range → `true`
- [ ] `test_is_between_datetime_range` — datetime in range → `true`
- [ ] `test_is_between_mixed_types_total_order` — uses D1 ladder for cross-type comparison
- [x] `test_is_between_null_value` — `null.is_between(0, 10)` → `null`
- [x] `test_is_between_null_lower` — `5.is_between(null, 10)` → `null` (or false, define behavior)
- [x] `test_is_between_null_upper` — `5.is_between(0, null)` → `null` (or false, define behavior)
- [x] `test_is_between_missing_propagation` — `missing.is_between(0, 10)` → `missing`
- [x] `test_is_between_invalid_range` — `5.is_between(10, 0)` → `false` (empty range)

**Unit Tests — Python (`python/tests/test_range_ops.py`):**
- [x] `test_clip_basic` — `path("x").clip(lit(0), lit(10))` works
- [x] `test_clip_with_path_bounds` — `path("x").clip(path("min"), path("max"))`
- [x] `test_clip_in_filter` — Use clip result in filter
- [x] `test_clip_chained` — `path("x").abs().clip(lit(0), lit(100))`
- [x] `test_is_between_basic` — `path("x").is_between(lit(0), lit(10))`
- [x] `test_is_between_with_path_bounds` — `path("x").is_between(path("lo"), path("hi"))`
- [x] `test_is_between_in_filter` — `arbor.filter(path("x").is_between(lit(0), lit(10)))`
- [x] `test_is_between_chained` — `path("x").abs().is_between(lit(0), lit(100))`

**Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test -p arbors-expr` ✓
- [x] `cargo test -p arbors-query` ✓
- [x] `make test` ✓ (Python tests pass)
- [x] `make check-stubs` ✓

---

### Step 15.2c: `min_by(key)` and `max_by(key)`

**Commit:** `feat(expr): add min_by and max_by for key-based extrema`

**References:** Phase 14 P1 aggregation operations, jq `min_by`/`max_by`, Polars `arg_min`/`arg_max`

**Surface:**
- `Expr::min_by(key: Expr) -> Expr`
- `Expr::max_by(key: Expr) -> Expr`

**Semantics:**
- Given an array, return the **element** (not key) with minimum/maximum key value
- `[{name: "a", age: 30}, {name: "b", age: 20}].min_by(@.age)` → `{name: "b", age: 20}`
- `[{name: "a", age: 30}, {name: "b", age: 20}].max_by(@.age)` → `{name: "a", age: 30}`
- Key expression uses `@` to reference each element (same as `map`)
- Uses Total Order (D1) for key comparison
- **Ties:** Returns first element with extremal key (stable, preserves original order)
- **Empty array:** Returns `null` (not error)
- **Single element:** Returns that element
- **Non-array:** Error
- **Null propagation:** `null.min_by(@.x)` → `null`
- **Missing propagation:** `missing.min_by(@.x)` → `missing`
- **Null keys:** Elements with null keys are considered (nulls sort high in D1 ladder)

**Implementation:**

| File | Changes |
|------|---------|
| `crates/arbors-expr/src/expr.rs` | Add `MinBy { expr: Box<Expr>, key: Box<Expr> }` variant |
| `crates/arbors-expr/src/expr.rs` | Add `MaxBy { expr: Box<Expr>, key: Box<Expr> }` variant |
| `crates/arbors-expr/src/expr.rs` | Add `fn min_by(self, key: Expr) -> Expr` builder |
| `crates/arbors-expr/src/expr.rs` | Add `fn max_by(self, key: Expr) -> Expr` builder |
| `crates/arbors-query/src/eval.rs` | Add evaluation: iterate elements, evaluate key, track extremum |
| `python/src/lib.rs` | Add `fn min_by(&self, key: &Expr) -> Expr` |
| `python/src/lib.rs` | Add `fn max_by(&self, key: &Expr) -> Expr` |
| `python/arbors/_arbors.pyi` | Add stubs for both methods |

**Tasks:**
- [x] Add `MinBy { expr, key }` variant to Expr enum
- [x] Add `MaxBy { expr, key }` variant to Expr enum
- [x] Add `fn min_by(self, key: Expr) -> Expr` builder method
- [x] Add `fn max_by(self, key: Expr) -> Expr` builder method
- [x] Implement evaluation with `@` binding (reuse `map` infrastructure)
- [x] Use `compare_keys_d1` for key comparison (D1 Total Order)
- [x] Add Rust unit tests (see below)
- [x] Add Python bindings
- [x] Add Python unit tests
- [x] Update type stubs

**Unit Tests — min_by (Rust):**
- [x] `test_min_by_objects_numeric_key` — `[{n:"a", v:30}, {n:"b", v:20}].min_by(@.v)` → `{n:"b", v:20}`
- [x] `test_min_by_objects_string_key` — `[{n:"c"}, {n:"a"}, {n:"b"}].min_by(@.n)` → `{n:"a"}`
- [x] `test_min_by_primitives_identity` — `[3, 1, 4, 1, 5].min_by(@)` → `1`
- [x] `test_min_by_nested_key` — `[{a:{b:3}}, {a:{b:1}}].min_by(@.a.b)` → `{a:{b:1}}`
- [x] `test_min_by_computed_key` — `[{v:3}, {v:-5}].min_by(@.v.abs())` → `{v:3}` (|3|=3 < |-5|=5)
- [x] `test_min_by_empty_array` — `[].min_by(@.v)` → `null`
- [x] `test_min_by_single_element` — `[{v:42}].min_by(@.v)` → `{v:42}`
- [x] `test_min_by_tie_returns_first` — `[{v:1, i:0}, {v:1, i:1}].min_by(@.v)` → `{v:1, i:0}`
- [x] `test_min_by_null_key_sorts_high` — `[{v:null}, {v:1}].min_by(@.v)` → `{v:1}` (1 < null in D1)
- [x] `test_min_by_all_null_keys` — `[{v:null}, {v:null}].min_by(@.v)` → `{v:null}` (first)
- [x] `test_min_by_missing_key` — `[{v:1}, {}].min_by(@.v)` → `{v:1}` (missing sorts highest)
- [x] `test_min_by_mixed_types_total_order` — uses D1 ladder for cross-type keys
- [x] `test_min_by_non_array_error` — `42.min_by(@)` → error
- [x] `test_min_by_object_error` — `{a:1}.min_by(@)` → error
- [x] `test_min_by_null_propagation` — `null.min_by(@.v)` → `null`
- [x] `test_min_by_missing_propagation` — `missing.min_by(@.v)` → `missing`

**Unit Tests — max_by (Rust):**
- [x] `test_max_by_objects_numeric_key` — `[{n:"a", v:30}, {n:"b", v:20}].max_by(@.v)` → `{n:"a", v:30}`
- [x] `test_max_by_objects_string_key` — `[{n:"c"}, {n:"a"}, {n:"b"}].max_by(@.n)` → `{n:"c"}`
- [x] `test_max_by_primitives_identity` — `[3, 1, 4, 1, 5].max_by(@)` → `5`
- [x] `test_max_by_nested_key` — `[{a:{b:3}}, {a:{b:1}}].max_by(@.a.b)` → `{a:{b:3}}`
- [x] `test_max_by_computed_key` — `[{v:3}, {v:-5}].max_by(@.v.abs())` → `{v:-5}` (|-5|=5 > |3|=3)
- [x] `test_max_by_empty_array` — `[].max_by(@.v)` → `null`
- [x] `test_max_by_single_element` — `[{v:42}].max_by(@.v)` → `{v:42}`
- [x] `test_max_by_tie_returns_first` — `[{v:5, i:0}, {v:5, i:1}].max_by(@.v)` → `{v:5, i:0}`
- [x] `test_max_by_null_key_wins` — `[{v:null}, {v:1}].max_by(@.v)` → `{v:null}` (null > 1 in D1)
- [x] `test_max_by_missing_key_wins` — `[{v:1}, {}].max_by(@.v)` → `{}` (missing > null > values)
- [x] `test_max_by_non_array_error` — `42.max_by(@)` → error
- [x] `test_max_by_null_propagation` — `null.max_by(@.v)` → `null`
- [x] `test_max_by_missing_propagation` — `missing.max_by(@.v)` → `missing`

**Unit Tests — Python (`python/tests/test_min_max_by.py`):**
- [x] `test_min_by_basic` — `path("items").min_by(path("@.price"))`
- [x] `test_min_by_with_current` — Verify `@` binding works
- [x] `test_max_by_basic` — `path("items").max_by(path("@.price"))`
- [x] `test_max_by_with_current` — Verify `@` binding works
- [x] `test_min_by_empty_returns_none` — Empty array returns Python `None`
- [x] `test_max_by_empty_returns_none` — Empty array returns Python `None`
- [x] `test_min_by_chained` — Chained expressions with min_by
- [x] `test_max_by_in_select` — Use max_by result in select projection

**Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test -p arbors-expr` ✓
- [x] `cargo test -p arbors-query` ✓
- [x] `make test` ✓ (Python tests pass)
- [x] `make check-stubs` ✓

---

### 15.2.4 Deliverables and Checkpoints

**Deliverable:** Complete Phase 14 P1 items with full Rust + Python support.

| Checkpoint | Verification |
|------------|--------------|
| flatten works at various depths | Tests for depth=1, depth=2, depth=None |
| flatten handles edge cases | Empty arrays, non-arrays, null/missing |
| clip clamps values correctly | Tests for in-range, below-min, above-max |
| clip handles edge cases | Null, missing, invalid range, non-numeric |
| is_between returns correct booleans | Tests for inside, outside, boundary |
| is_between handles edge cases | Null, missing, string/date ranges |
| min_by finds correct elements | Tests for objects, primitives, ties, empty |
| max_by finds correct elements | Tests for objects, primitives, ties, empty |
| min_by/max_by use Total Order | Cross-type comparison follows D1 ladder |
| All Python bindings have stubs | `make check-stubs` passes |
| All tests pass | `cargo test && make test` |

**Final Checkpoint:**
- [x] `cargo fmt --check` ✓
- [x] `cargo clippy -- -D warnings` ✓
- [x] `cargo test` ✓ (all Rust tests)
- [x] `make test` ✓ (all Python tests)
- [x] `make check-stubs` ✓
- [x] `make check-parity` ✓

**Commits:**
1. `feat(expr): add flatten for nested array flattening`
2. `feat(expr): add clip and is_between for range operations`
3. `feat(expr): add min_by and max_by for key-based extrema`

---

### Note: Python `modulo` Binding ✅ COMPLETE

The Phase 15 plan originally listed "Python binding for modulo" as missing. Investigation shows this is already complete:
- Rust `Expr::modulo()` is implemented in `crates/arbors-expr/src/expr.rs:704`
- Python binding uses `__mod__` and `__rmod__` operators (Pythonic approach)
- Type stubs present in `python/arbors/_arbors.pyi:3237-3243`
- Tests exist in `python/tests/test_numeric_ops.py` and `python/tests/test_array_map.py`

No additional work required for modulo.

---


## Implementation Order

### Phase A: Documentation ✅ COMPLETE

1. **15.1** Documentation refresh — Restructure ARCHITECTURE.md and update API.md

### Phase B: Expression Additions ✅ COMPLETE

2. **15.2a** `flatten(depth)` — Array flattening with configurable depth ✅
3. **15.2b** `clip`/`is_between` — Range operations (clamping and membership) ✅
4. **15.2c** `min_by`/`max_by` — Key-based extrema selection ✅

---

## Success Criteria

**15.1 Documentation:**
- [x] ARCHITECTURE.md restructured as conceptual guide (no phase references)
- [x] API.md reflects current method names and implemented features
- [x] ArborView materialization documented

**15.2 Phase 14 Gaps:**
- [x] `flatten(depth)` implemented with Rust + Python support
- [x] `clip(min, max)` implemented with Rust + Python support
- [x] `is_between(lower, upper)` implemented with Rust + Python support
- [x] `min_by(key)` implemented with Rust + Python support
- [x] `max_by(key)` implemented with Rust + Python support

**Build Verification:**
- [x] `cargo test` passes
- [x] `make test` passes
- [x] `make check-stubs` passes
- [x] `make check-parity` passes

---

## 15.3 Tree Refactor: Move Tree to arbors-storage

**Status:** Complete

### 15.3.0 Problem Analysis

#### The Dependency Chain Problem

The current crate dependency chain is:

```
arbors-core      (Node, NodeId, Error)
     ↑
arbors-storage   (Arbor)
     ↑
arbors-query     (filter, select, tree_eval, tree_filter, etc.)
     ↑
arbors           (Tree, read_json, re-exports)
```

**The problem:** `Tree` is defined in the top-level `arbors` crate, but `arbors-query` needs to work with single trees. Since `arbors-query` can't import from `arbors` (that would be a circular dependency), query functions must take `(&Arbor, tree_index: usize)` instead of `&Tree`.

This leads to:
- Awkward function signatures: `tree_eval(&arbor, tree_idx, expr)` instead of `tree_eval(&tree, expr)`
- Confusing semantics: functions named `arbor_*` that conceptually operate on trees
- Duplicate patterns: Tree methods in `arbors/src/lib.rs` manually delegate to query functions

#### API Consistency Analysis: Rust vs Python

**Question:** Is the Rust API Arbor-centric while Python is Tree-centric?

**Answer:** No. Both APIs are **semantically consistent**:

| Type | Rust Operations | Python Operations |
|------|-----------------|-------------------|
| `Arbor` (collection) | `filter`, `select`, `add_field`, `sort_by`, `group_by`, `aggregate`, `explode` | `filter`, `select`, `add_field`, `add_fields`, `sort_by`, `group_by`, `aggregate`, `explode` |
| `Tree` (single doc) | `select`, `add_field`, `filter_array`, `explode` | `select`, `add_field`, `add_fields`, `filter_array`, `explode` |

The semantics are correct:
- **Arbor.filter()** = keep/remove entire trees from the collection
- **Tree.filter_array()** = keep/remove elements within an array inside a single tree

The **code organization** is the problem, not the API design.

#### The Solution: Move Tree to arbors-storage

```
arbors-core      (Node, NodeId, Error)
     ↑
arbors-storage   (Arbor, Tree)  ← Tree moves here
     ↑
arbors-query     (can now take &Tree directly!)
     ↑
arbors           (re-exports, extension traits)
```

This enables:
- Query functions with clean signatures: `tree_eval(tree: &Tree, expr)`, `tree_diff(t1: &Tree, t2: &Tree)`
- No conceptual changes to Tree (still a view into an Arbor)
- Extension traits in `arbors` for method syntax

---

### 15.3.1 Design Decisions

#### Migration Strategy

**IMPORTANT:** This is a brand new library with ZERO external users. There is no need for:
- Deprecation warnings
- Legacy API shims
- Migration guides for external consumers
- Backward compatibility

We make breaking changes freely and get the API right.

#### Ownership Semantics (DECIDED)

**Decision:** Tree continues to own Arbor by value.

```rust
pub struct Tree {
    arbor: Arbor,      // Owned by value
    root_id: NodeId,
    tree_idx: usize,
}
```

**Rationale:**
- Arbor is already Arc-backed internally (columnar storage uses `Arc<NodeColumns>`, `Arc<PrimitivePool>`, etc.)
- Cloning an Arbor is O(1) — just incrementing reference counts
- Value ownership gives simple semantics — no lifetime parameters needed
- Tree can be freely passed, returned, and stored without lifetime complexity

**Implications:**
- `Tree::from_arbor(arbor, index)` takes ownership of the Arbor
- `tree.arbor()` returns `&Arbor` for inspection
- `tree.into_arbor()` consumes Tree and returns the Arbor
- Cloning a Tree clones the Arbor (cheap Arc increment)

#### Old Function Signatures (DECIDED)

**Decision:** Remove old signatures outright. No wrappers.

Current signatures like:
```rust
tree_eval(&arbor, tree_idx, expr)
tree_filter(&arbor, tree_idx, path, pred)
tree_select(&arbor, tree_idx, exprs)
```

Become:
```rust
tree_eval(tree: &Tree, expr)
tree_filter(tree: &Tree, path, pred)
tree_select(tree: &Tree, exprs)
```

**Rationale:** Zero external users means no migration burden. Just fix the API.

#### Python Parity (REQUIREMENT)

**Requirement:** Python bindings must be completely fixed up with no regressions.

**Verification:**
- `make test` — all Python tests pass
- `make check-stubs` — type stubs match implementation
- `make check-parity` — Rust/Python API parity verified
- Manual review of PyTree implementation for any Tree → storage changes

#### Feature Flags

**Status:** No special handling required, but verify with build matrix.

Tree is a simple struct with no feature-gated derives or conditional compilation. The `serde`, `arrow`, and `python` features don't affect Tree's definition.

**Build matrix to verify:**
- `cargo test -p arbors-storage --no-default-features`
- `cargo test -p arbors-storage --all-features`
- `cargo test` (default features)
- `make python && make test` (Python-enabled)

---

### 15.3.2 Pitfalls to Watch

1. **Clone semantics verification**: After refactor, verify that `Tree::clone()` still just increments Arc counts, not deep-copying data. Add a test using `storage_id()` to confirm two cloned Trees share storage.

2. **Arbor::tree helper ownership**: The new `Arbor::tree(index)` convenience method must not deep-clone. Add a test verifying `arbor.tree(0).unwrap().storage_id() == arbor.storage_id()`.

3. **EvalContext updates**: `EvalContext::for_tree(&arbor, tree_idx)` will need to change to `EvalContext::for_tree(&tree)` or similar. Audit all EvalContext construction sites.

4. **Python import path audit**: PyTree wraps the Rust Tree. The `arbors` crate re-exports Tree, so Python bindings should continue using `arbors::Tree`. Verify PyTree construction still works after the module move.

5. **Internal arbor_* stragglers**: Grep for any `arbor_`-prefixed helpers or tests that should be renamed. Even with zero external users, stale names cause confusion.

6. **Integration test coverage**: Run the full test suite including:
   - `cargo test` (all Rust crates)
   - `make test` (Python tests)
   - `make check-parity` (API parity)
   - Cross-crate tests in `crates/arbors/tests/`

7. **Documentation drift**: Update `docs/API.md` and any public doc comments to reflect `arbors_storage::Tree` origin and `TreeExt` usage pattern.

---

### 15.3.3 What Moves vs What Stays

#### Moves to arbors-storage

The `Tree` struct and its **basic accessor methods** (delegation to Arbor):

```rust
// crates/arbors-storage/src/tree.rs
pub struct Tree {
    arbor: Arbor,
    root_id: NodeId,
    tree_idx: usize,
}

impl Tree {
    pub fn from_arbor(arbor: Arbor, index: usize) -> Option<Self>;
    pub fn root(&self) -> NodeId;
    pub fn tree_index(&self) -> usize;
    pub fn arbor(&self) -> &Arbor;
    pub fn into_arbor(self) -> Arbor;

    // Delegation methods
    pub fn node_type(&self, id: NodeId) -> Option<NodeType>;
    pub fn is_null(&self, id: NodeId) -> bool;
    pub fn get_string(&self, id: NodeId) -> Option<&str>;
    pub fn get_i64(&self, id: NodeId) -> Option<i64>;
    pub fn get_f64(&self, id: NodeId) -> Option<f64>;
    pub fn get_bool(&self, id: NodeId) -> Option<bool>;
    pub fn get_field(&self, obj: NodeId, key: &str) -> Option<NodeId>;
    pub fn child_at(&self, parent: NodeId, index: usize) -> Option<NodeId>;
    pub fn child_count(&self, id: NodeId) -> u32;
    pub fn children(&self, parent: NodeId) -> impl Iterator<Item = NodeId>;
    pub fn get_path(&self, path: &str) -> Option<NodeId>;
    pub fn storage_id(&self) -> usize;
}
```

#### Stays in arbors (via extension trait)

The **query-dependent transformation methods** become an extension trait:

```rust
// crates/arbors/src/lib.rs
pub trait TreeExt {
    fn select(&self, exprs: &[Expr]) -> Result<Tree, ExprError>;
    fn add_field(&self, name: &str, expr: &Expr) -> Result<Tree, ExprError>;
    fn filter_array(&self, array_path: &str, predicate: &Expr) -> Result<Tree, ExprError>;
}

impl TreeExt for Tree {
    fn select(&self, exprs: &[Expr]) -> Result<Tree, ExprError> {
        // Implementation using arbors_query::tree_select
    }
    // ...
}
```

This pattern:
- Keeps `Tree` free of query dependencies
- Provides method syntax for users who `use arbors::TreeExt`
- Matches how `QueryOps` works for Arbor

---

### 15.3.4 Impact on arbors-query

After Tree moves, `arbors-query` can:

1. **Import Tree directly**: `use arbors_storage::Tree;`

2. **Update function signatures**:
   - `tree_eval(&arbor, tree_idx, expr)` → `tree_eval(tree: &Tree, expr)`
   - `tree_filter(&arbor, tree_idx, path, pred)` → `tree_filter(tree: &Tree, path, pred)`
   - `tree_select(&arbor, tree_idx, exprs)` → `tree_select(tree: &Tree, exprs)`

3. **Future tree_diff/tree_equals** can have clean signatures:
   - `tree_diff(t1: &Tree, t2: &Tree) -> TreeDiff`
   - `tree_equals(t1: &Tree, t2: &Tree) -> bool`

---

### 15.3.5 Execution Steps

#### Step 1: Create Tree in arbors-storage

**Commit:** `refactor(storage): move Tree struct to arbors-storage`

**References:**
- §15.3.0 The Solution diagram (Tree moves to arbors-storage)
- §15.3.1 Ownership Semantics (Tree owns Arbor by value, Arc-backed)
- §15.3.3 "Moves to arbors-storage" (struct definition and accessor methods)

**Tasks:**
- [x] Create `crates/arbors-storage/src/tree.rs`
- [x] Move `Tree` struct definition from `arbors/src/lib.rs`
- [x] Move basic accessor methods (delegation to Arbor) per §15.3.3
- [x] Add `pub mod tree;` and `pub use tree::Tree;` to `arbors-storage/src/lib.rs`
- [x] Add `Arbor::tree(index) -> Option<Tree>` convenience method

**Unit Tests:**
- [x] `test_tree_from_arbor_valid` — Tree::from_arbor works for valid index
- [x] `test_tree_from_arbor_invalid` — Tree::from_arbor returns None for out-of-bounds
- [x] `test_tree_clone_shares_storage` — Per §15.3.2 pitfall #1, verify storage_id matches after clone
- [x] `test_arbor_tree_shares_storage` — Per §15.3.2 pitfall #2, verify `arbor.tree(0).storage_id() == arbor.storage_id()`

**Checkpoint:** `cargo build -p arbors-storage && cargo test -p arbors-storage` ✓

**Build matrix verification:** `cargo test -p arbors-storage --no-default-features && cargo test -p arbors-storage --all-features` ✓

---

#### Step 2: Update arbors-query to use Tree

**Commit:** `refactor(query): update tree functions to take &Tree`

**References:**
- §15.3.1 Old Function Signatures (remove old signatures outright, no wrappers)
- §15.3.2 Pitfall #2 (EvalContext construction site audit)
- §15.3.4 Impact on arbors-query (signature changes)

**Tasks:**
- [x] Update imports to use `arbors_storage::Tree`
- [x] Update `tree_eval` signature: `(&Arbor, usize, &Expr)` → `(&Tree, &Expr)` per §15.3.4
- [x] Update `tree_filter` signature: `(&Arbor, usize, &str, &Expr)` → `(&Tree, &str, &Expr)`
- [x] Update `tree_select` signature: `(&Arbor, usize, &[Expr])` → `(&Tree, &[Expr])`
- [x] Update `extract_filtered_elements` signature
- [x] Audit and update `EvalContext::for_tree` per §15.3.2 pitfall #3
- [x] Grep for `arbor_`-prefixed helpers/tests per §15.3.2 pitfall #5; rename any stragglers
- [x] Update all tests in arbors-query to use Tree

**Unit Tests:**
- [x] `test_tree_eval_with_tree` — tree_eval works with &Tree parameter
- [x] `test_tree_filter_with_tree` — tree_filter works with &Tree parameter
- [x] `test_tree_select_with_tree` — tree_select works with &Tree parameter

**Checkpoint:** `cargo build -p arbors-query && cargo test -p arbors-query` ✓

---

#### Step 3: Update arbors crate

**Commit:** `refactor(arbors): use Tree from storage, add TreeExt trait`

**References:**
- §15.3.3 "Stays in arbors (via extension trait)" (TreeExt with select, add_field, filter_array)
- §15.3.1 Migration Strategy (no deprecation, just fix the API)

**Tasks:**
- [x] Remove Tree struct definition from `arbors/src/lib.rs`
- [x] Add `pub use arbors_storage::Tree;` re-export
- [x] Create `TreeExt` trait with `select`, `add_field`, `filter_array` per §15.3.3
- [x] Implement `TreeExt for Tree`
- [x] Update `Explodable` implementation for Tree (moved to arbors-query)
- [x] Update `read_json` to return Tree (should still work via re-export)
- [x] Update all tests in `crates/arbors/tests/`

**Unit Tests:**
- [x] `test_tree_select_uses_correct_index` — TreeExt::select works
- [x] `test_tree_add_field_uses_correct_index` — TreeExt::add_field works
- [x] `test_tree_filter_array_uses_correct_index` — TreeExt::filter_array works
- [x] `test_explode_tree_*` — Explodable still works for Tree (6 tests in tree_explode.rs)

**Checkpoint:** `cargo build && cargo test` ✓

---

#### Step 4: Update Python bindings

**Commit:** `refactor(python): update bindings for Tree from storage`

**References:**
- §15.3.1 Python Parity (must be completely fixed, no regressions)
- §15.3.2 Pitfall #4 (Python import path audit)
- §15.3.6 Success Criteria (Python section)

**Tasks:**
- [x] Audit Python binding import paths per §15.3.2 pitfall #4 — verify PyTree uses `arbors::Tree` re-export
- [x] Verify PyTree construction works with Tree from `arbors_storage`
- [x] Update any internal imports if needed
- [x] Verify all Tree methods work: select, add_field, add_fields, filter_array, explode
- [x] Run full Python test suite per §15.3.1 Python Parity requirement

**Integration Tests:**
- [x] All existing Python Tree tests pass
- [x] `make check-stubs` passes
- [x] `make check-parity` passes

**Checkpoint:** `make python && make test && make check-stubs && make check-parity` ✓

---

#### Step 5: Update documentation

**Commit:** `docs: update API.md for Tree refactor and TreeExt pattern`

**References:**
- §15.3.2 Pitfall #7 (documentation drift)
- §15.3.3 "Stays in arbors (via extension trait)"

**Tasks:**
- [x] Update `docs/API.md` to document `TreeExt` trait and usage pattern
- [x] Update any doc comments in `arbors/src/lib.rs` explaining Tree origin
- [x] Verify README examples still work (if any mention Tree)

**Checkpoint:** Doc examples compile, no broken links ✓

---

### 15.3.6 Success Criteria

**Rust:**
- [x] `Tree` struct lives in `arbors-storage`
- [x] `arbors-query` functions take `&Tree` directly
- [x] `TreeExt` trait provides method syntax in `arbors` crate
- [x] `cargo test` passes (all crates)
- [x] Clone semantics verified (storage_id tests for Tree::clone and Arbor::tree)
- [x] Build matrix passes (`--no-default-features`, `--all-features`)

**Python:**
- [x] `make test` passes (all Python tests)
- [x] `make check-stubs` passes
- [x] `make check-parity` passes
- [x] PyTree works identically before/after refactor

**Documentation:**
- [x] `docs/API.md` updated with `TreeExt` pattern
- [x] No stale references to old Tree location

---

### 15.3.7 Future Work (Out of Scope)

After this refactor, we can cleanly implement:

1. **Tree Diff** (Phase 15.4):
   - `tree_diff(t1: &Tree, t2: &Tree) -> TreeDiff`
   - `tree_equals(t1: &Tree, t2: &Tree) -> bool`
   - `TreeExt::diff(&self, other: &Tree) -> TreeDiff`

2. **Arbor Diff** (if needed):
   - `arbor_diff(a1: &Arbor, a2: &Arbor) -> ArborDiff`
   - Compares all trees: different counts, per-tree diffs

---

## References

- Phase 11: `plans/architecture-phase-11.md` — Python Bindings v1
- Phase 12: `plans/architecture-phase-12.md` — Test Data Redesign
- Phase 13: `plans/architecture-phase-13.md` — API Design Focus
- Phase 14: `plans/architecture-phase-14.md` — Parity with Polars/jq
- Phase 13.6 Desiderata: `plans/architecture-1-13-desiderata.md` — Tree Diff spec
