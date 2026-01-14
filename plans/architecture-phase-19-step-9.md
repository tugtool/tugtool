# Step 9: InMemory/Stored/Filtered Parity - Conformance Suite

## Overview

**Exit Criteria:** Gate C conformance suite is green for the supported operator set (in-memory vs stored parity).

**Goal**: Create a comprehensive conformance test suite that verifies identical behavior across all arbor backings (InMemory, Stored, Filtered) for the supported operator set.

**Key Files**:
- `crates/arbors/tests/integration/conformance.rs` (new test file)
- `crates/arbors/tests/main.rs` (add module declaration)

**Test Location**: Per `crates/arbors/tests/README.md`, all integration tests are consolidated into a single binary. The conformance tests go in `integration/conformance.rs` and are declared in `main.rs`.

---

## Current State Analysis

### Existing Parity Tests

The codebase has two existing parity test files:

| File | Location | Coverage |
|------|----------|----------|
| `unified_arbor_parity.rs` | `crates/arbors/tests/integration/` | Basic operations (len, get, filter, head, tail, find_one, iter) across InMemory, Stored, Filtered |
| `batched_parity_tests.rs` | `crates/arbors/tests/integration/pipeline/` | Batched queries (filter, aggregate, select) match materialized results |

### Current Coverage Gaps

| Gap | Description | Impact |
|-----|-------------|--------|
| **Sort operations** | `sort_by` not tested for parity | Sort may behave differently with permuted indices |
| **Shuffle operations** | `shuffle` not tested for parity | Randomness seeding may differ |
| **Sample operations** | `sample` not tested for parity | Randomness seeding may differ |
| **Take operations** | `take` not tested for parity | Index mapping may differ |
| **Optimizer-affected behavior** | FilterSelectivityOrder error reordering | Intentional difference, needs documentation |
| **Edge cases** | Systematic nulls, empty, single-tree testing | May reveal hidden differences |
| **Performance invariants** | Batch counts, early exit | Not systematically verified across backings |
| **GroupBy/IndexBy** | New Step 7 operations | Not tested at all |
| **TopK optimization** | Fused sort+head | May behave differently from separate operations |

### Supported Operations (as of Step 7)

From `LogicalPlan` variants in `logical_plan.rs`:

**Source Nodes:**
- `InMemory` - in-memory arbor source
- `Stored` - stored (persistent) arbor source

**View Transforms:**
- `Filter` - filter trees by predicate (with mode: Immediate/Lazy, optional limit)
- `Head` - take first N trees
- `Tail` - take last N trees
- `Take` - take trees at specific indices
- `Sample` - random sample of N trees
- `Shuffle` - shuffle tree order
- `Sort` - sort trees by key expressions
- `TopK` - optimized sort + head

**Projection/Transform Nodes:**
- `Select` - project expressions to create new tree structure
- `AddFields` - add fields to each tree
- `Aggregate` - aggregate expressions across all trees

**Grouping/Indexing Nodes:**
- `GroupBy` - group trees by key expression
- `IndexBy` - index trees by key expression for O(1) lookup

### FilterSelectivityOrder Error Semantics

**Documented behavior from Step 8:**

> "Optimizer rewrites (e.g., FilterSelectivityOrder reordering AND predicates) may change which error is observed for fallible expressions. This is accepted behavior; users should not rely on specific error ordering from ANDed predicates."

**Implication for conformance testing:**
- Tests should NOT assert specific error ordering for ANDed predicates
- Tests should verify that errors are eventually raised (not swallowed)
- Tests may document this as an intentional semantic difference

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Test organization | By operation category, then backing type | Easier to add new operations, clear structure |
| Test data | Single fixture with 100 trees, 10 per batch | Sufficient for batch boundaries, reasonable size |
| Random seeds | Fixed seeds for reproducibility | Shuffle/sample must be deterministic |
| Error ordering | Do NOT assert specific error order | FilterSelectivityOrder intentionally reorders |
| Performance invariants | Test via counter-based assertions | No timing, only batch/decode counts |
| Edge cases | Systematic matrix of (operation, edge case) | Empty, single, all-nulls, boundary values |
| Fixture sharing | Group assertions per fixture where possible | Reduce DB creation overhead |

---

## Contract Clarifications

These clarifications define the semantic contracts that conformance tests verify. Tests MUST respect these contracts to avoid asserting non-guaranteed behavior.

### 1. Sort + Access Contract

**Contract:** Ordered views (sort_by, shuffle) affect `iter()` order but NOT `get(i)` order.

- `get(i)` always returns the tree at original index `i`, regardless of any sort/shuffle applied
- `iter()` respects the current view's ordering (sorted, shuffled, etc.)

**Implication for tests:**
- **Ordered parity tests** compare `iter()` output order across backings
- **`get(i)` parity tests** run on unsorted views only, or verify that `get(i)` returns the same original-index tree regardless of sort state

### 2. Group Ordering Contract

**Contract:** `group_by()` does NOT guarantee a stable group iteration order.

Group keys may be returned in any order (e.g., HashMap iteration order is nondeterministic).

**Implication for tests:**
- Compare group **keys as sets** (not ordered vectors)
- Compare group **members as sets of tree IDs** (not ordered sequences)
- Use `HashSet` or `BTreeSet` for comparison, never `Vec` with order assertion

### 3. Indexing Duplicates Contract

**Contract:** For `index_by()` with duplicate keys:
- `get(key)` returns "some matching tree" (not guaranteed which one)
- `get_all(key)` returns all matching trees (the robust API for duplicates)

**Implication for tests:**
- **Unique-key tests:** `get(key)` parity is valid
- **Duplicate-key tests:** Use `get_all(key)` and compare as sets/multisets
- Never assert that `get(key)` returns a specific tree when duplicates exist

### 4. Filtered Backing Definition

**Contract:** For Gate C, "Filtered" means a filtered view over Stored (not InMemory).

This exercises the stored execution path through the filtered backing, which is the more complex case.

```rust
// Filtered = filter over Stored (exercises stored path)
let filtered = stored.filter(&lit(true), FilterMode::Immediate).unwrap();
```

### 5. Tree Equality Comparison

**Contract:** Tree equality is determined by comparing canonical fields, not JSON strings.

JSON string comparison can be flaky due to field ordering or formatting differences.

**Implication for tests:**
- Use field-by-field comparison on known fields (`id`, `value`, `group`, etc.)
- Include at least one nullable/missing field to cover Null vs Missing semantics
- Or use a canonical comparison helper that extracts and compares specific fields
- Avoid `to_json_string()` comparison for parity assertions

---

## API Constraints (Important for Implementation)

The following constraints affect how conformance tests are implemented:

### GroupedArbor API

`GroupedArbor` does NOT have `keys()` or `get(key)` methods. It exposes:
- `len()`, `is_empty()`
- `result() -> &GroupedResult` - access to underlying grouped result

`GroupedResult` supports:
- `iter() -> impl Iterator<Item = (&ExprResult, &IndexSet)>`

**Implication:** Group parity helpers must use `grouped.result().iter()` to access key-value pairs.

### ExprResult Hashing

`ExprResult` is NOT `Hash` or `Ord` (only `Debug, Clone, PartialEq`).

**Implication:** Cannot use `HashSet<ExprResult>` or `BTreeSet<ExprResult>` directly.

**Solution:** Use `arbors_query::collection_ops::CanonicalKey` which provides hash + eq with canonical semantics:
```rust
use arbors_expr::ExprResult;  // ExprResult lives in arbors_expr
use arbors_query::collection_ops::CanonicalKey;  // Hashable wrapper

let keys: HashSet<CanonicalKey> = grouped.result().iter()
    .map(|(k, _)| CanonicalKey(k.clone()))  // Direct construction, no From impl
    .collect();
```

### ExprResult Construction

Use `ExprResult::from(…)` for key construction (as existing tests do):
```rust
// Correct:
ExprResult::from(42i64)
ExprResult::from("A".to_string())

// NOT:
ExprResult::Int(42)  // pseudo-variant, doesn't exist
```

### Group Membership Parity

For comparing group members, use `IndexSet::to_vec()` (sorted indices) rather than materializing trees:
```rust
// Efficient: compare index sets directly
let indices_a: Vec<usize> = index_set_a.to_vec();
let indices_b: Vec<usize> = index_set_b.to_vec();
assert_eq!(indices_a, indices_b);
```

This is cheaper and more direct since all backings share the same original ordering fixture.

---

## Test Categories

### Category 1: Basic Operations Parity

Operations that MUST produce identical results across all backings:

| Operation | Expected Parity | Notes |
|-----------|-----------------|-------|
| `len()` | Exact match | Count must be identical |
| `is_empty()` | Exact match | Boolean must be identical |
| `get(i)` | Exact match (by value) | Tree content must match; **test on unsorted views only** |
| `filter(predicate, mode)` | Exact match (indices) | Same trees must match |
| `head(n)` | Exact match | First N trees |
| `tail(n)` | Exact match | Last N trees |
| `take(indices)` | Exact match | Specified trees |
| `find_one(predicate)` | Exact match | Same tree or None |
| `matching_indices(predicate)` | Exact match | Same indices |

**Note on `get(i)`:** Per Contract Clarification #1, `get(i)` returns the tree at original index `i` regardless of sort state. Parity tests for `get(i)` should use unsorted views to avoid confusion.

### Category 2: Ordered Operations Parity

Operations with deterministic ordering:

| Operation | Expected Parity | Notes |
|-----------|-----------------|-------|
| `sort_by(keys)` | Exact match via `iter()` | Compare iteration order, NOT `get(i)` |
| `sort_by(keys).head(n)` | Exact match via `iter()` | TopK optimization must match |
| `iter()` | Exact match (order) | Same iteration order |

**Note:** Per Contract Clarification #1, ordered parity is verified by comparing `iter()` output, not `get(i)`. The `get(i)` method always returns the original-index tree regardless of sort state.

### Category 3: Randomized Operations Parity

Operations with seeded randomness:

| Operation | Expected Parity | Notes |
|-----------|-----------------|-------|
| `shuffle(seed)` | Exact match | Same seed = same order |
| `sample(n, seed)` | Exact match | Same seed = same selection |

### Category 4: Aggregation Parity

Operations producing aggregated results:

| Operation | Expected Parity | Notes |
|-----------|-----------------|-------|
| `aggregate(sum, count, mean, etc.)` | Numeric tolerance | Float comparisons need epsilon |
| `select(exprs)` | Exact match | Same projected values |
| `add_fields(fields)` | Exact match | Same added values |

### Category 5: Grouping/Indexing Parity

Operations producing grouped or indexed results:

| Operation | Expected Parity | Notes |
|-----------|-----------------|-------|
| `group_by(key)` | Set-based comparison | Keys as sets; members as sets of IDs |
| `index_by(key)` unique keys | `get(key)` parity | Same tree returned for unique keys |
| `index_by(key)` duplicate keys | `get_all(key)` parity | Compare as sets, NOT `get()` |

**Note on group_by:** Per Contract Clarification #2, group iteration order is NOT guaranteed. Compare keys and members as sets, not ordered vectors.

**Note on index_by:** Per Contract Clarification #3, `get(key)` for duplicate keys returns "some matching tree" (nondeterministic). Use `get_all(key)` and compare as sets for duplicate-key tests.

### Category 6: Performance Invariants

Not about results, but about execution characteristics:

| Invariant | Verification | Notes |
|-----------|--------------|-------|
| Batch count | Same number of batches decoded | View ops should not decode |
| Early exit | Same early exit behavior | find_one, any, all |
| No implicit materialization | materialize_calls unchanged | View ops never materialize |

### Category 7: Edge Cases

Systematic edge case testing across all operations:

| Edge Case | Data Shape | Notes |
|-----------|------------|-------|
| Empty arbor | 0 trees | All operations should handle gracefully |
| Single tree | 1 tree | Boundary condition |
| All nulls | All null values for filtered field | Null handling consistency |
| All match | 100% match predicate | Full set behavior |
| No match | 0% match predicate | Empty result behavior |
| Boundary indices | get(0), get(len-1), get(len) | Index boundary handling |
| Cross-batch | head(15) on 10 trees/batch | Batch boundary handling |

### Category 8: Known Semantic Differences (Documentation-Only)

These are NOT conformance failures but intentional differences:

| Difference | Cause | Documentation |
|------------|-------|---------------|
| Error ordering in ANDed predicates | FilterSelectivityOrder optimization | "Users should not rely on error ordering" |
| Optimizer cost estimates | Heuristics vary by source | Only affects explain(), not results |

---

## Implementation Sub-Steps

### Sub-Step 9.1: Create Conformance Test Scaffold

**Goal:** Create the test file with test fixtures and helper infrastructure.

**Files:**
- NEW: `crates/arbors/tests/integration/conformance.rs`
- MODIFY: `crates/arbors/tests/main.rs` (add `pub mod conformance;` to integration block)

**Checklist:**
- [ ] Create `integration/conformance.rs` with module documentation
- [ ] Add `pub mod conformance;` to `main.rs` inside the `mod integration { }` block
- [ ] Add helper function to create multi-batch test arbor (100 trees, 10/batch)
- [ ] Add helper function to store arbor and get InMemory, Stored, and Filtered handles
- [ ] Add helper function to compare tree content (field-by-field, including nullable field)
- [ ] Add `serial_test` dependency for counter isolation (already exists from Step 2)
- [ ] Verify: `cargo build -p arbors`

**Code Sketch:**

```rust
//! Gate C: Conformance tests for InMemory/Stored/Filtered parity.
//!
//! These tests verify that the same operations produce identical results
//! across all arbor backing types. This is the authoritative parity test
//! suite for the CoreReboot architecture.
//!
//! # Categories
//!
//! 1. Basic operations (len, get, filter, head, tail, find_one)
//! 2. Ordered operations (sort_by, iter) - compare via iter(), NOT get(i)
//! 3. Randomized operations (shuffle, sample with fixed seeds)
//! 4. Aggregation (aggregate, select, add_fields)
//! 5. Grouping/Indexing (group_by, index_by) - compare as sets, NOT ordered
//! 6. Performance invariants (batch counts, early exit)
//! 7. Edge cases (empty, single, nulls, boundaries)
//!
//! # Contract Clarifications
//!
//! - `get(i)` returns original index regardless of sort; test on unsorted views
//! - Group iteration order is NOT guaranteed; compare keys/members as sets
//! - For index_by with duplicates, use get_all() not get()
//! - FilterSelectivityOrder may reorder AND predicates (intentional)
//!
//! # API Notes
//!
//! - GroupedArbor uses result().iter() not keys()/get()
//! - Use CanonicalKey for ExprResult hashing (ExprResult is not Hash)
//! - Use ExprResult::from(…) for key construction

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use arbors::expr::{lit, path};
use arbors::{Arbor, FilterMode, Session, SortKeySpec};
use arbors_base::{arborbase_stats, reset_arborbase_stats, ArborStoreOptions};
use arbors_expr::ExprResult;  // ExprResult lives in arbors_expr
use arbors_io::ArborBuilder;
use arbors_query::collection_ops::CanonicalKey;  // Hashable wrapper only
use serial_test::serial;
use tempfile::TempDir;

// ============================================================================
// Test Fixtures
// ============================================================================

/// Create test arbor with 100 trees (10 per batch when stored).
///
/// Trees have structure:
/// ```json
/// {"id": 0, "name": "item_0", "value": 0, "group": "A", "nullable": null}      // i % 5 == 0: null
/// {"id": 1, "name": "item_1", "value": 10, "group": "B", "nullable": 1}        // normal
/// {"id": 7, "name": "item_7", "value": 70, "group": "D"}                       // i % 7 == 0: MISSING
/// ...
/// ```
///
/// The `nullable` field exercises three states:
/// - `null` (present but null): i % 5 == 0
/// - missing (field omitted): i % 7 == 0 (and i % 5 != 0)
/// - present with value: all others
fn create_test_arbor() -> arbors::InMemoryArbor {
    let mut builder = ArborBuilder::new_schemaless();
    for i in 0..100 {
        let group = match i % 4 {
            0 => "A",
            1 => "B",
            2 => "C",
            _ => "D",
        };

        // Three states for nullable field: null, missing, or present
        let nullable_part = if i % 5 == 0 {
            r#", "nullable": null"#.to_string()  // Null
        } else if i % 7 == 0 {
            String::new()  // Missing (field omitted entirely)
        } else {
            format!(r#", "nullable": {}"#, i)  // Present with value
        };

        let json = format!(
            r#"{{"id": {}, "name": "item_{}", "value": {}, "group": "{}"{}}}"#,
            i, i, i * 10, group, nullable_part
        );
        builder.add_json(json.as_bytes()).unwrap();
    }
    builder.finish()
}

/// Create all three backing types from the same test data.
///
/// Returns (TempDir, InMemory, Stored, Filtered) where Filtered is a simple
/// filter over Stored with a predicate that matches all trees.
fn create_all_backings() -> (TempDir, Arbor, Arbor, Arbor) {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("test.arbors");

    let inmem_arbor = create_test_arbor();
    let inmemory = Arbor::from_inmemory(inmem_arbor.clone());

    let session = Arc::new(Session::open(&db_path).unwrap());

    // Store with 10 trees per batch
    {
        let mut txn = session.base().begin_write().unwrap();
        txn.put("test", &inmem_arbor, Some(&ArborStoreOptions {
            trees_per_batch: Some(10),
            ..Default::default()
        })).unwrap();
        txn.commit().unwrap();
    }

    session.refresh().unwrap();
    let stored = session.arbor("test").unwrap();

    // Filtered: filter that matches all (to test Filtered backing)
    let filtered = stored.filter(&lit(true), FilterMode::Immediate).unwrap();

    (tmp, inmemory, stored, filtered)
}

/// Compare two arbor results for value equality via iter().
///
/// Uses field-by-field comparison on canonical fields to avoid JSON string flakiness.
/// Per Contract Clarification #5, we compare specific fields, not JSON strings.
fn assert_arbors_equal(a: &Arbor, b: &Arbor) {
    assert_eq!(a.len().unwrap(), b.len().unwrap(), "Length mismatch");

    for (i, (tree_a, tree_b)) in a.iter().zip(b.iter()).enumerate() {
        let tree_a = tree_a.unwrap();
        let tree_b = tree_b.unwrap();
        // Compare canonical fields instead of JSON strings
        assert_tree_fields_equal(&tree_a, &tree_b, i);
    }
}

/// Compare tree fields for parity.
///
/// Uses the known fixture fields: id, value, group, name, nullable.
/// Includes nullable field to test Null vs Missing semantics.
fn assert_tree_fields_equal(a: &OwnedTree, b: &OwnedTree, index: usize) {
    // Extract and compare the "id" field (integer)
    let id_a = extract_field_i64(a, "id");
    let id_b = extract_field_i64(b, "id");
    assert_eq!(id_a, id_b, "Tree {} id mismatch", index);

    // Extract and compare the "value" field (integer)
    let value_a = extract_field_i64(a, "value");
    let value_b = extract_field_i64(b, "value");
    assert_eq!(value_a, value_b, "Tree {} value mismatch", index);

    // Extract and compare the "group" field (string)
    let group_a = extract_field_str(a, "group");
    let group_b = extract_field_str(b, "group");
    assert_eq!(group_a, group_b, "Tree {} group mismatch", index);

    // Extract and compare the "nullable" field (tests Null vs Missing semantics)
    // This field is null for i % 5 == 0, otherwise contains the integer i
    let nullable_a = extract_field_nullable(a, "nullable");
    let nullable_b = extract_field_nullable(b, "nullable");
    assert_eq!(nullable_a, nullable_b, "Tree {} nullable mismatch", index);
}

/// Helper to extract integer field from tree.
fn extract_field_i64(tree: &OwnedTree, field: &str) -> Option<i64> {
    // Use tree navigation to extract field value
    let root = tree.arbor().root(0)?;
    let field_node = tree.arbor().get_field(root, field)?;
    tree.arbor().get_i64(field_node)  // Note: API is get_i64, not get_int
}

/// Helper to extract string field from tree.
fn extract_field_str(tree: &OwnedTree, field: &str) -> Option<String> {
    let root = tree.arbor().root(0)?;
    let field_node = tree.arbor().get_field(root, field)?;
    tree.arbor().get_string(field_node).map(|s| s.to_string())
}

/// Helper to extract nullable field - returns None for null, Some for value.
/// Distinguishes between null and missing via Option<Option<i64>>.
fn extract_field_nullable(tree: &OwnedTree, field: &str) -> Option<Option<i64>> {
    let root = tree.arbor().root(0)?;
    let field_node = tree.arbor().get_field(root, field);
    match field_node {
        None => None, // Field missing
        Some(node) => {
            if tree.arbor().is_null(node) {
                Some(None) // Field present but null
            } else {
                Some(tree.arbor().get_i64(node)) // Note: API is get_i64
            }
        }
    }
}
```

**Gate B Impact:** None (new test file only)

---

### Sub-Step 9.2: Basic Operations Parity Tests

**Goal:** Add tests for len, is_empty, get, filter, head, tail, take, find_one, matching_indices.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add `test_parity_len` - verify len() matches across all backings
- [ ] Add `test_parity_is_empty` - verify is_empty() matches
- [ ] Add `test_parity_get` - verify get(i) returns same content
- [ ] Add `test_parity_filter_immediate` - verify filter indices match
- [ ] Add `test_parity_filter_lazy` - verify lazy filter produces same results
- [ ] Add `test_parity_head` - verify head(n) produces same trees
- [ ] Add `test_parity_tail` - verify tail(n) produces same trees
- [ ] Add `test_parity_take` - verify take(indices) produces same trees
- [ ] Add `test_parity_find_one` - verify find_one returns same tree
- [ ] Add `test_parity_matching_indices` - verify indices match
- [ ] Verify: `cargo test -p arbors --test conformance parity_basic`

**Test Pattern:**

```rust
#[test]
fn test_parity_len() {
    let (_tmp, inmemory, stored, filtered) = create_all_backings();

    let len_inmemory = inmemory.len().unwrap();
    let len_stored = stored.len().unwrap();
    let len_filtered = filtered.len().unwrap();

    assert_eq!(len_inmemory, len_stored, "InMemory vs Stored len mismatch");
    assert_eq!(len_inmemory, len_filtered, "InMemory vs Filtered len mismatch");
    assert_eq!(len_inmemory, 100);
}

#[test]
fn test_parity_filter_immediate() {
    let (_tmp, inmemory, stored, filtered) = create_all_backings();

    let pred = path("value").gt(lit(500));

    let filtered_inmem = inmemory.filter(&pred, FilterMode::Immediate).unwrap();
    let filtered_stored = stored.filter(&pred, FilterMode::Immediate).unwrap();
    let filtered_filt = filtered.filter(&pred, FilterMode::Immediate).unwrap();

    assert_arbors_equal(&filtered_inmem, &filtered_stored);
    assert_arbors_equal(&filtered_inmem, &filtered_filt);
}
```

**Gate B Impact:** None

---

### Sub-Step 9.3: Ordered Operations Parity Tests

**Goal:** Add tests for sort_by and iteration order.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add `test_parity_sort_by_ascending` - verify ascending sort order
- [ ] Add `test_parity_sort_by_descending` - verify descending sort order
- [ ] Add `test_parity_sort_by_multi_key` - verify multi-key sort order
- [ ] Add `test_parity_sort_by_with_nulls` - verify null ordering
- [ ] Add `test_parity_topk` - verify sort_by().head() matches across backings
- [ ] Add `test_parity_iter_order` - verify iteration produces same order
- [ ] Verify: `cargo test -p arbors --test conformance parity_ordered`

**Test Pattern:**

```rust
#[test]
fn test_parity_sort_by_ascending() {
    let (_tmp, inmemory, stored, filtered) = create_all_backings();

    let sorted_inmem = inmemory.sort_by(vec![SortKeySpec::asc(path("value"))]).unwrap();
    let sorted_stored = stored.sort_by(vec![SortKeySpec::asc(path("value"))]).unwrap();
    let sorted_filt = filtered.sort_by(vec![SortKeySpec::asc(path("value"))]).unwrap();

    assert_arbors_equal(&sorted_inmem, &sorted_stored);
    assert_arbors_equal(&sorted_inmem, &sorted_filt);
}
```

**Gate B Impact:** None

---

### Sub-Step 9.4: Randomized Operations Parity Tests

**Goal:** Add tests for shuffle and sample with fixed seeds.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add `test_parity_shuffle_seeded` - verify same seed produces same order
- [ ] Add `test_parity_sample_seeded` - verify same seed produces same selection
- [ ] Add `test_parity_shuffle_reproducible` - verify multiple calls with same seed match
- [ ] Verify: `cargo test -p arbors --test conformance parity_random`

**Test Pattern:**

```rust
#[test]
fn test_parity_shuffle_seeded() {
    let (_tmp, inmemory, stored, filtered) = create_all_backings();

    let seed = Some(42u64);

    let shuffled_inmem = inmemory.shuffle(seed).unwrap();
    let shuffled_stored = stored.shuffle(seed).unwrap();
    let shuffled_filt = filtered.shuffle(seed).unwrap();

    assert_arbors_equal(&shuffled_inmem, &shuffled_stored);
    assert_arbors_equal(&shuffled_inmem, &shuffled_filt);
}
```

**Gate B Impact:** None

---

### Sub-Step 9.5: Aggregation Parity Tests

**Goal:** Add tests for aggregate, select, add_fields.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add `test_parity_aggregate_sum` - verify sum aggregation matches
- [ ] Add `test_parity_aggregate_count` - verify count aggregation matches
- [ ] Add `test_parity_aggregate_mean` - verify mean (with float epsilon)
- [ ] Add `test_parity_select` - verify select projection matches
- [ ] Add `test_parity_add_fields` - verify add_fields matches
- [ ] Verify: `cargo test -p arbors --test conformance parity_aggregate`

**Gate B Impact:** None

---

### Sub-Step 9.6: Grouping/Indexing Parity Tests

**Goal:** Add tests for group_by and index_by.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add `test_parity_group_by` - verify groups match (keys as sets, members as ID sets)
- [ ] Add `test_parity_index_by_unique` - verify index with unique keys (get() parity valid)
- [ ] Add `test_parity_index_by_duplicates` - verify index with duplicate keys (get_all() as sets)
- [ ] Verify: `cargo test -p arbors --test conformance parity_grouping`

**Test Pattern:**

```rust
use std::collections::{HashSet, HashMap};
use arbors_query::collection_ops::CanonicalKey;

#[test]
fn test_parity_group_by() {
    let (_tmp, inmemory, stored, filtered) = create_all_backings();

    let grouped_inmem = inmemory.group_by(path("group")).unwrap();
    let grouped_stored = stored.group_by(path("group")).unwrap();
    let grouped_filt = filtered.group_by(path("group")).unwrap();

    // Per API Constraints: Use result().iter() to access key-value pairs
    // Per Contract Clarification #2: Compare keys as SETS (order not guaranteed)

    // Build maps from key -> sorted index set for each backing
    let map_inmem = build_group_map(&grouped_inmem);
    let map_stored = build_group_map(&grouped_stored);
    let map_filt = build_group_map(&grouped_filt);

    // Compare keys as sets
    let keys_inmem: HashSet<_> = map_inmem.keys().cloned().collect();
    let keys_stored: HashSet<_> = map_stored.keys().cloned().collect();
    let keys_filt: HashSet<_> = map_filt.keys().cloned().collect();

    assert_eq!(keys_inmem, keys_stored, "InMemory vs Stored group keys mismatch");
    assert_eq!(keys_inmem, keys_filt, "InMemory vs Filtered group keys mismatch");

    // Compare group members as sorted index vectors (more efficient than tree materialization)
    for key in &keys_inmem {
        let indices_inmem = map_inmem.get(key).unwrap();
        let indices_stored = map_stored.get(key).unwrap();
        assert_eq!(indices_inmem, indices_stored, "Group {:?} indices mismatch", key);
    }
}

/// Build a map from CanonicalKey -> sorted Vec<usize> for group comparison.
/// Uses result().iter() per API Constraints.
fn build_group_map(grouped: &GroupedArbor) -> HashMap<CanonicalKey, Vec<usize>> {
    let mut map = HashMap::new();
    for (key, index_set) in grouped.result().iter() {
        let canonical_key = CanonicalKey(key.clone());  // Direct construction
        let mut indices = index_set.to_vec();
        indices.sort(); // Sort for deterministic comparison
        map.insert(canonical_key, indices);
    }
    map
}

#[test]
fn test_parity_index_by_unique() {
    let (_tmp, inmemory, stored, _filtered) = create_all_backings();

    // "id" field is unique
    let indexed_inmem = inmemory.index_by(path("id")).unwrap();
    let indexed_stored = stored.index_by(path("id")).unwrap();

    // For unique keys, get() returns Option<Arbor> (1-tree view)
    // Use ExprResult::from() per API Constraints
    for id in 0..100i64 {
        let key = ExprResult::from(id);
        let arbor_inmem = indexed_inmem.get(&key).unwrap();
        let arbor_stored = indexed_stored.get(&key).unwrap();

        // Both should find or not find
        assert_eq!(arbor_inmem.is_some(), arbor_stored.is_some());

        if let (Some(a), Some(b)) = (arbor_inmem, arbor_stored) {
            // Compare the single tree from each arbor
            let tree_a = a.iter().next().unwrap().unwrap();
            let tree_b = b.iter().next().unwrap().unwrap();
            assert_tree_fields_equal(&tree_a, &tree_b, id as usize);
        }
    }
}

#[test]
fn test_parity_index_by_duplicates() {
    let (_tmp, inmemory, stored, _filtered) = create_all_backings();

    // "group" field has duplicates (A, B, C, D repeat)
    let indexed_inmem = inmemory.index_by(path("group")).unwrap();
    let indexed_stored = stored.index_by(path("group")).unwrap();

    // Per Contract Clarification #3: Use result().get() for index access
    // This returns Option<&[usize]> - compare indices directly (cheaper)
    for group in ["A", "B", "C", "D"] {
        let key = ExprResult::from(group.to_string());

        // Get indices via result().get() and compare as sorted vectors
        let indices_inmem: Vec<usize> = indexed_inmem.result().unwrap()
            .get(&key)
            .map(|slice| { let mut v = slice.to_vec(); v.sort(); v })
            .unwrap_or_default();
        let indices_stored: Vec<usize> = indexed_stored.result().unwrap()
            .get(&key)
            .map(|slice| { let mut v = slice.to_vec(); v.sort(); v })
            .unwrap_or_default();

        assert_eq!(indices_inmem, indices_stored, "Index {:?} indices mismatch", group);
    }
}
```

**Gate B Impact:** None

---

### Sub-Step 9.7: Performance Invariants Tests

**Goal:** Add tests verifying batch counts and early exit behavior are consistent.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add `test_invariant_head_zero_decode` - head(n) decodes 0 batches for Stored
- [ ] Add `test_invariant_tail_zero_decode` - tail(n) decodes 0 batches for Stored
- [ ] Add `test_invariant_filter_lazy_zero_decode` - lazy filter decodes 0 batches
- [ ] Add `test_invariant_find_one_early_exit` - find_one stops at first match
- [ ] Add `test_invariant_no_implicit_materialize` - view ops never materialize
- [ ] Verify: `cargo test -p arbors --test conformance invariant`

**Test Pattern:**

```rust
#[test]
#[serial]
fn test_invariant_head_zero_decode() {
    let (_tmp, _inmemory, stored, _filtered) = create_all_backings();

    reset_arborbase_stats();
    let _ = stored.head(5).unwrap();
    let stats = arborbase_stats();

    assert_eq!(stats.batches_decoded, 0, "head() should not decode any batches");
}
```

**Gate B Impact:** None

---

### Sub-Step 9.8: Edge Cases Tests

**Goal:** Add systematic edge case testing.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add `test_edge_empty_arbor_*` - operations on empty arbor
- [ ] Add `test_edge_single_tree_*` - operations on single-tree arbor
- [ ] Add `test_edge_all_nulls_filter` - filter on all-null field
- [ ] Add `test_edge_no_matches` - filter with 0% match rate
- [ ] Add `test_edge_all_match` - filter with 100% match rate
- [ ] Add `test_edge_boundary_get` - get(0), get(len-1)
- [ ] Add `test_edge_cross_batch_head` - head(15) when batch_size=10
- [ ] Add `test_edge_head_larger_than_len` - head(1000) when len=100
- [ ] Verify: `cargo test -p arbors --test conformance edge`

**Test Pattern:**

```rust
fn create_empty_backings() -> (TempDir, Arbor, Arbor, Arbor) {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("test.arbors");

    let empty = arbors::InMemoryArbor::new();
    let inmemory = Arbor::from_inmemory(empty.clone());

    let session = Arc::new(Session::open(&db_path).unwrap());
    {
        let mut txn = session.base().begin_write().unwrap();
        txn.put("empty", &empty, None).unwrap();
        txn.commit().unwrap();
    }
    session.refresh().unwrap();
    let stored = session.arbor("empty").unwrap();
    let filtered = stored.filter(&lit(true), FilterMode::Immediate).unwrap();

    (tmp, inmemory, stored, filtered)
}

#[test]
fn test_edge_empty_arbor_len() {
    let (_tmp, inmemory, stored, filtered) = create_empty_backings();

    assert_eq!(inmemory.len().unwrap(), 0);
    assert_eq!(stored.len().unwrap(), 0);
    assert_eq!(filtered.len().unwrap(), 0);
}
```

**Gate B Impact:** None

---

### Sub-Step 9.9: Chained Operations Parity Tests

**Goal:** Test complex operation chains for parity.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add `test_parity_filter_then_sort` - filter().sort_by() chains
- [ ] Add `test_parity_sort_then_filter` - sort_by().filter() chains
- [ ] Add `test_parity_filter_filter` - nested filter chains
- [ ] Add `test_parity_sort_then_head` - sort_by().head() (TopK path)
- [ ] Add `test_parity_filter_sort_head` - filter().sort_by().head() chain
- [ ] Verify: `cargo test -p arbors --test conformance parity_chained`

**Gate B Impact:** None

---

### Sub-Step 9.10: Document Known Semantic Differences

**Goal:** Add test that documents (not asserts against) FilterSelectivityOrder behavior.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs`

**Checklist:**
- [ ] Add doc comment section explaining FilterSelectivityOrder error reordering
- [ ] Add `test_filter_selectivity_order_documented` - demonstrates the behavior
- [ ] Ensure no tests rely on specific error ordering for ANDed predicates
- [ ] Verify: `cargo test -p arbors --test conformance documented`

**Test Pattern:**

```rust
/// # Known Semantic Differences
///
/// ## FilterSelectivityOrder Error Reordering
///
/// The `FilterSelectivityOrder` optimization may reorder AND predicates by
/// estimated selectivity (most selective first). This is intentional and
/// documented in Step 8.
///
/// **Implication:** When multiple ANDed predicates would each produce an error,
/// the error that is observed may differ based on predicate order after optimization.
///
/// **User Guidance:** Do not rely on specific error ordering from ANDed predicates.
/// If a specific error is important, use a separate filter call.
///
/// ```rust,ignore
/// // Do NOT rely on this producing a specific error:
/// arbor.filter(path("x").eq(lit(error1)).and(path("y").eq(lit(error2))))
///
/// // If error1 must be observed, use separate filters:
/// arbor.filter(path("x").eq(lit(error1))).filter(path("y").eq(lit(error2)))
/// ```

#[test]
fn test_filter_selectivity_order_documented() {
    // This test documents the behavior, not asserts against it.
    // See doc comment above for explanation.

    let (_tmp, inmemory, stored, _filtered) = create_all_backings();

    // Create a filter with two predicates of different selectivity
    let eq_pred = path("id").eq(lit(42)); // 1% selectivity (equality)
    let range_pred = path("value").gt(lit(0)); // 99% selectivity (nearly all match)

    // The optimizer may reorder these predicates
    let combined = range_pred.and(eq_pred);

    let result_inmem = inmemory.filter(&combined, FilterMode::Immediate).unwrap();
    let result_stored = stored.filter(&combined, FilterMode::Immediate).unwrap();

    // Results should match even if evaluation order differs
    assert_arbors_equal(&result_inmem, &result_stored);
}
```

**Gate B Impact:** None

---

### Sub-Step 9.11: Final Integration and Verification

**Goal:** Run full conformance suite and verify Gate C.

**Files:**
- MODIFY: `crates/arbors/tests/conformance.rs` (final polish)

**Checklist:**
- [ ] Run full conformance suite: `cargo test -p arbors --test conformance`
- [ ] Verify no flaky tests (run 3x)
- [ ] Verify Gate B still green: `cargo test`
- [ ] Update Gate C pointer in `crates/arbors/tests/invariants.rs` (if exists)
- [ ] Document test count and coverage in this file

**Gate C Verification:**

```bash
# Run conformance tests (part of integrated test binary per README)
cargo nextest run -p arbors -- conformance

# Run multiple times to check for flakiness
for i in 1 2 3; do cargo nextest run -p arbors -- conformance; done

# Full test suite (Gate B)
cargo nextest run
```

---

## Summary Table

| Sub-Step | Description | Files | Tests Added |
|----------|-------------|-------|-------------|
| 9.1 | Scaffold and fixtures | conformance.rs (new) | 0 (helpers only) |
| 9.2 | Basic operations | conformance.rs | ~10 |
| 9.3 | Ordered operations (via iter()) | conformance.rs | ~6 |
| 9.4 | Randomized operations | conformance.rs | ~3 |
| 9.5 | Aggregation | conformance.rs | ~5 |
| 9.6 | Grouping/Indexing (set-based) | conformance.rs | ~3 |
| 9.7 | Performance invariants | conformance.rs | ~5 |
| 9.8 | Edge cases | conformance.rs | ~8 |
| 9.9 | Chained operations | conformance.rs | ~5 |
| 9.10 | Documented differences | conformance.rs | ~1 |
| 9.11 | Final verification | - | - |

**Total: ~46 new conformance tests**

---

## Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `crates/arbors/tests/integration/conformance.rs` | CREATE | Gate C conformance suite |
| `crates/arbors/tests/main.rs` | MODIFY | Add `pub mod conformance;` to integration block |
| `crates/arbors/Cargo.toml` | VERIFY | Ensure `serial_test` dev-dependency exists (added in Step 2) |

**Per README**: All tests go in `tests/integration/` and are declared in `main.rs` to share a single binary (avoids ~25min link times).

---

## Dependencies

| Dependency | Purpose | Notes |
|------------|---------|-------|
| Step 7 | Supported operator set | Tests all Step 7 operations |
| Step 8 | FilterSelectivityOrder | Documents known semantic difference |
| `serial_test` | Counter isolation | For performance invariant tests |

---

## Relationship to Existing Tests

### Avoiding Duplication

**Important:** The repo already has meaningful coverage in:
- `crates/arbors/tests/integration/global_ops.rs` - sort, null ordering, group_by, index_by, chained ops, TopK
- `crates/arbors/tests/integration/invariants.rs` - Gate A invariants using counters

Step 9's `conformance.rs` should be the **authoritative Gate C suite** but should NOT duplicate tests that already exist. When implementing:
1. Check if a test already exists in `global_ops.rs` or `invariants.rs`
2. If coverage exists, reference it rather than duplicating
3. Focus on **cross-backing parity** (the unique value of Gate C), not individual operation correctness

**Gate C's unique value is verifying that InMemory, Stored, and Filtered backings produce identical results for the same operations.** Leave single-backing correctness (like null ordering specifics, edge case handling) to `global_ops.rs` and `invariants.rs`.

### unified_arbor_parity.rs

The existing `unified_arbor_parity.rs` tests provide a foundation but have limitations:

| Aspect | Existing Tests | Step 9 Conformance |
|--------|---------------|-------------------|
| Coverage | Basic ops only | All Step 7 operations |
| Sort | Not tested | Comprehensive sort testing |
| Shuffle/Sample | Not tested | Seeded randomness parity |
| GroupBy/IndexBy | Not tested | Full grouping parity |
| Performance | Not verified | Counter-based invariants |
| Edge cases | Minimal | Systematic matrix |
| Organization | Mixed | Categorized by operation type |

**Recommendation:** Keep `unified_arbor_parity.rs` as a "quick sanity check" and use `conformance.rs` as the authoritative Gate C suite. Consider deprecating the overlap after Step 9 is complete.

### batched_parity_tests.rs

These tests focus on `PipelineExecutor` vs materialized results (batch-level parity), which is complementary to Step 9's backing-level parity:

| Test File | Focus | Level |
|-----------|-------|-------|
| batched_parity_tests.rs | PipelineExecutor vs materialize() | Batch execution |
| conformance.rs | InMemory vs Stored vs Filtered | Arbor backing |

Both are valuable; they test different aspects of parity.

---

## Exit Criteria

- [ ] All ~45 conformance tests pass
- [ ] No flaky tests (verified by multiple runs)
- [ ] Gate B (full test suite) remains green
- [ ] FilterSelectivityOrder behavior is documented, not asserted against
- [ ] Performance invariants verified via counter-based tests
- [ ] Edge cases systematically covered
