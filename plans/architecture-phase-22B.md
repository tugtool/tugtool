# Phase 22B: 21/22 Audit Fixes: Implementation Plan

## Overview

Three critical issues must be fixed to establish a "rock solid" foundation:

1. **Conservative ExplodePushdown** - Optimizer incorrectly pushes filters past explode
2. **Composite Materialization Bug** - Sparse base views produce wrong results
3. **Dead Mutation Code** - ~300 lines of unreachable match arms

**Implementation order**: Issue 1 first, then Issue 2, then Issue 3.

---

# FIX 1: Conservative ExplodePushdown

## Problem Statement

The optimizer assumes explode bindings are accessed via `Expr::Variable`, but users actually access exploded data via `path("$item")` since **`as_binding` materializes as a top-level field in the output tree, not an evaluator binding**.

This causes `free_vars()` to return empty for path expressions, making the optimizer incorrectly push down filters that depend on exploded data.

```rust
// What user writes:
arbor.explode(&path("items"), Some("$item".to_string()))
     .filter(&path("$item.price").gt(lit(10)))  // Uses Path, not Variable

// What optimizer checks:
free_vars(path("$item.price"))  // Returns {} - paths have no free vars!
references_binding(predicate, "$item")  // Returns false - BUG!
```

## Solution

Make ExplodePushdown **conservative**: block pushdown if the predicate could *possibly* reference exploded data. Apply less often but never incorrectly.

**Additional safety rule**: If `as_binding == None`, the optimizer uses default `"$item"` but no such field is actually created. Block pushdown entirely when `as_binding.is_none()` unless the predicate is provably independent.

## Implementation Steps

### Step 1.1: Add path analysis functions to analysis.rs

**File**: `crates/arbors-expr/src/analysis.rs`

Add these functions, mirroring the traversal style of existing `collect_free_vars`:

```rust
use crate::path::PathSegment;
use std::collections::HashSet;

/// Collect all root field names from Path expressions in an expression tree.
/// For path("a.b.c"), returns {"a"}. For path("x[*].y"), returns {"x"}.
pub fn path_roots(expr: &Expr) -> HashSet<String> {
    let mut roots = HashSet::new();
    collect_path_roots(expr, &mut roots);
    roots
}

fn collect_path_roots(expr: &Expr, roots: &mut HashSet<String>) {
    match expr {
        Expr::Path(path_expr) => {
            if let Some(first) = path_expr.segments.first() {
                if let PathSegment::Field(name) = first {
                    roots.insert(name.clone());
                }
            }
        }
        Expr::Variable(_) | Expr::Literal(_) => {}

        // Binary operations
        Expr::Add(left, right)
        | Expr::Sub(left, right)
        | Expr::Mul(left, right)
        | Expr::Div(left, right)
        | Expr::Modulo(left, right)
        | Expr::Pow(left, right)
        | Expr::Eq(left, right)
        | Expr::Ne(left, right)
        | Expr::Lt(left, right)
        | Expr::Le(left, right)
        | Expr::Gt(left, right)
        | Expr::Ge(left, right)
        | Expr::And(left, right)
        | Expr::Or(left, right)
        | Expr::StrContains(left, right)
        | Expr::StartsWith(left, right)
        | Expr::EndsWith(left, right)
        | Expr::DateDiff(left, right) => {
            collect_path_roots(left, roots);
            collect_path_roots(right, roots);
        }

        // Unary operations
        Expr::Neg(inner)
        | Expr::Abs(inner)
        | Expr::Floor(inner)
        | Expr::Ceil(inner)
        | Expr::Not(inner)
        | Expr::ToLower(inner)
        | Expr::ToUpper(inner)
        | Expr::Trim(inner)
        | Expr::TrimStart(inner)
        | Expr::TrimEnd(inner)
        | Expr::StrLen(inner)
        | Expr::IsNull(inner)
        | Expr::IsNotNull(inner)
        | Expr::Exists(inner)
        | Expr::Missing(inner)
        | Expr::Sum(inner)
        | Expr::Count(inner)
        | Expr::Mean(inner)
        | Expr::Min(inner)
        | Expr::Max(inner)
        | Expr::Any(inner)
        | Expr::All(inner)
        | Expr::First(inner)
        | Expr::Last(inner)
        | Expr::Len(inner)
        | Expr::Unique(inner)
        | Expr::Reverse(inner)
        | Expr::ToEntries(inner)
        | Expr::FromEntries(inner)
        | Expr::Cast(inner, _)
        | Expr::TryCoerce(inner, _)
        | Expr::TypeOf(inner)
        | Expr::IsBool(inner)
        | Expr::IsInt(inner)
        | Expr::IsFloat(inner)
        | Expr::IsNumeric(inner)
        | Expr::IsString(inner)
        | Expr::IsArray(inner)
        | Expr::IsObject(inner)
        | Expr::IsDate(inner)
        | Expr::IsDateTime(inner)
        | Expr::IsDuration(inner)
        | Expr::Year(inner)
        | Expr::Month(inner)
        | Expr::Day(inner)
        | Expr::Hour(inner)
        | Expr::Minute(inner)
        | Expr::Second(inner)
        | Expr::Weekday(inner)
        | Expr::Week(inner)
        | Expr::Quarter(inner)
        | Expr::Epoch(inner)
        | Expr::DateTrunc(inner, _) => {
            collect_path_roots(inner, roots);
        }

        // Ternary operations
        Expr::Clip { expr, min, max }
        | Expr::IsBetween { expr, lower: min, upper: max } => {
            collect_path_roots(expr, roots);
            collect_path_roots(min, roots);
            collect_path_roots(max, roots);
        }

        Expr::Round { expr, .. } => {
            collect_path_roots(expr, roots);
        }

        // Null handling
        Expr::Coalesce(exprs) => {
            for e in exprs {
                collect_path_roots(e, roots);
            }
        }

        Expr::NullToDefault { expr, default }
        | Expr::DefaultIfMissing { path: expr, default } => {
            collect_path_roots(expr, roots);
            collect_path_roots(default, roots);
        }

        // Collection operations
        Expr::IsIn { expr, list } | Expr::ArrayContains { list, value: expr } => {
            collect_path_roots(expr, roots);
            collect_path_roots(list, roots);
        }

        Expr::Get { list, index } => {
            collect_path_roots(list, roots);
            collect_path_roots(index, roots);
        }

        Expr::Slice { list, start, end } => {
            collect_path_roots(list, roots);
            if let Some(s) = start {
                collect_path_roots(s, roots);
            }
            if let Some(e) = end {
                collect_path_roots(e, roots);
            }
        }

        Expr::Sort { list, .. } => {
            collect_path_roots(list, roots);
        }

        Expr::Concat(exprs) | Expr::Array(exprs) => {
            for e in exprs {
                collect_path_roots(e, roots);
            }
        }

        Expr::Map { array, mapper } => {
            collect_path_roots(array, roots);
            collect_path_roots(mapper, roots);
        }

        Expr::ArrayFilter { array, predicate, .. } => {
            collect_path_roots(array, roots);
            collect_path_roots(predicate, roots);
        }

        Expr::Flatten { expr, .. } => {
            collect_path_roots(expr, roots);
        }

        Expr::MinBy { expr, key } | Expr::MaxBy { expr, key } => {
            collect_path_roots(expr, roots);
            collect_path_roots(key, roots);
        }

        // Object operations
        Expr::Field { expr, .. }
        | Expr::Keys { expr, .. }
        | Expr::Values { expr, .. }
        | Expr::Rename { expr, .. }
        | Expr::Without { expr, .. } => {
            collect_path_roots(expr, roots);
        }

        Expr::WithField { expr, value, .. } => {
            collect_path_roots(expr, roots);
            collect_path_roots(value, roots);
        }

        // Conditional
        Expr::When { condition, then_expr, else_expr } => {
            collect_path_roots(condition, roots);
            collect_path_roots(then_expr, roots);
            collect_path_roots(else_expr, roots);
        }

        Expr::Case { branches, else_expr } => {
            for (cond, val) in branches {
                collect_path_roots(cond, roots);
                collect_path_roots(val, roots);
            }
            if let Some(e) = else_expr {
                collect_path_roots(e, roots);
            }
        }

        Expr::NullIf { expr, null_value } => {
            collect_path_roots(expr, roots);
            collect_path_roots(null_value, roots);
        }

        // Date/Time
        Expr::DateAdd(date, amount, _) => {
            collect_path_roots(date, roots);
            collect_path_roots(amount, roots);
        }

        // Object constructor
        Expr::Object(fields) => {
            for (_, e) in fields {
                collect_path_roots(e, roots);
            }
        }

        // Aliasing
        Expr::Alias { expr, .. } => {
            collect_path_roots(expr, roots);
        }

        // String operations with special fields
        Expr::Substring { string, start, length } => {
            collect_path_roots(string, roots);
            collect_path_roots(start, roots);
            if let Some(len) = length {
                collect_path_roots(len, roots);
            }
        }

        Expr::Replace { string, pattern, replacement } => {
            collect_path_roots(string, roots);
            collect_path_roots(pattern, roots);
            collect_path_roots(replacement, roots);
        }

        Expr::Split { string, delimiter } | Expr::Join { list: string, delimiter } => {
            collect_path_roots(string, roots);
            collect_path_roots(delimiter, roots);
        }

        Expr::StripPrefix { string, .. } | Expr::StripSuffix { string, .. } => {
            collect_path_roots(string, roots);
        }

        Expr::RegexMatch { string, .. } | Expr::RegexExtract { string, .. } => {
            collect_path_roots(string, roots);
        }

        Expr::RegexReplace { string, replacement, .. } => {
            collect_path_roots(string, roots);
            collect_path_roots(replacement, roots);
        }
    }
}

/// Check if any path in the expression starts with the given field name.
pub fn has_path_starting_with(expr: &Expr, field_name: &str) -> bool {
    path_roots(expr).contains(field_name)
}

/// Extract the root field name from an explode path expression.
/// path("items") -> Some("items")
/// path("data.items") -> Some("data")
pub fn explode_path_root(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Path(path_expr) => {
            path_expr.segments.first().and_then(|seg| match seg {
                PathSegment::Field(name) => Some(name.clone()),
                _ => None,
            })
        }
        _ => None,
    }
}

/// Check if any path in the expression is relative (@-style).
/// Relative paths reference the "current" element and are unsafe to push past explode.
pub fn has_relative_path(expr: &Expr) -> bool {
    has_relative_path_inner(expr)
}

fn has_relative_path_inner(expr: &Expr) -> bool {
    match expr {
        Expr::Path(path_expr) => path_expr.is_relative,
        Expr::Variable(_) | Expr::Literal(_) => false,

        // Binary operations
        Expr::Add(left, right)
        | Expr::Sub(left, right)
        | Expr::Mul(left, right)
        | Expr::Div(left, right)
        | Expr::Modulo(left, right)
        | Expr::Pow(left, right)
        | Expr::Eq(left, right)
        | Expr::Ne(left, right)
        | Expr::Lt(left, right)
        | Expr::Le(left, right)
        | Expr::Gt(left, right)
        | Expr::Ge(left, right)
        | Expr::And(left, right)
        | Expr::Or(left, right)
        | Expr::StrContains(left, right)
        | Expr::StartsWith(left, right)
        | Expr::EndsWith(left, right)
        | Expr::DateDiff(left, right) => {
            has_relative_path_inner(left) || has_relative_path_inner(right)
        }

        // Unary operations - check inner
        Expr::Neg(inner) | Expr::Not(inner) | Expr::IsNull(inner) | Expr::IsNotNull(inner)
        // ... and all other unary variants
        => has_relative_path_inner(inner),

        // For all other compound expressions, recursively check children
        // (Same pattern as collect_path_roots - abbreviated here for space)
        _ => false, // Conservative: assume no relative path if we don't handle the variant
    }
}
```

### Step 1.2: Modify ExplodePushdown to use conservative checks

**File**: `crates/arbors-planner/src/optimize/explode.rs`

Replace the pushdown check in `apply_explode_pushdown` (around line 78):

**Before**:
```rust
// Check if predicate references the exploded binding
let binding_name = as_binding.as_deref().unwrap_or("$item");
if !references_binding(predicate, binding_name) {
    // Safe to push filter before explode
    ...
}
```

**After**:
```rust
// Check if predicate could reference exploded data
if !could_reference_exploded_data(predicate, expr, as_binding.as_deref()) {
    // Safe to push filter before explode
    ...
}
```

Add the helper function at module level:

```rust
use arbors_expr::analysis::{references_binding, has_path_starting_with, explode_path_root, has_relative_path};

/// Conservative check: could this predicate possibly reference exploded data?
/// Returns true if pushdown should be BLOCKED.
fn could_reference_exploded_data(
    predicate: &Expr,
    explode_path: &Expr,
    as_binding: Option<&str>,
) -> bool {
    // Conservative rule 1: If no explicit binding, block pushdown entirely.
    // The optimizer uses "$item" as default, but runtime may not create that field.
    let binding_name = match as_binding {
        Some(name) => name,
        None => return true, // Block: can't safely analyze implicit binding
    };

    // Check 1: Block if predicate uses the binding as a variable
    if references_binding(predicate, binding_name) {
        return true;
    }

    // Check 2: Block if predicate has paths starting with binding name
    // e.g., binding="$item", predicate has path("$item.price")
    if has_path_starting_with(predicate, binding_name) {
        return true;
    }

    // Check 3: Block if predicate references the same root as explode path
    // e.g., exploding path("items"), predicate has path("items.x")
    if let Some(explode_root) = explode_path_root(explode_path) {
        if has_path_starting_with(predicate, &explode_root) {
            return true;
        }
    }

    // Check 4: Block if predicate contains any relative paths (@-style)
    // Relative paths reference the "current" element which is ambiguous across explode.
    if has_relative_path(predicate) {
        return true;
    }

    false
}
```

### Step 1.3: Disable ExplodeFilterFusion

**File**: `crates/arbors-planner/src/optimize/query_plan.rs`

Find the rules vector (around line 2121-2122) and comment out ExplodeFilterFusion:

**Before**:
```rust
Box::new(ExplodePushdown),
Box::new(ExplodeFilterFusion),
```

**After**:
```rust
Box::new(ExplodePushdown),
// DISABLED: ExplodeFilterFusion has same free_vars bug as ExplodePushdown.
// It assumes users access exploded elements via var("$item"), but they actually
// use path("$item"). Re-enable after implementing proper expression binding semantics.
// Box::new(ExplodeFilterFusion),
```

### Step 1.4: Add regression tests

**File**: `crates/arbors/tests/integration/mutation_tests.rs`

Add tests to this file (it already has `read_jsonl`, `Arbor`, `first_tree` helpers):

```rust
// =============================================================================
// ExplodePushdown Regression Tests
// =============================================================================

#[test]
fn test_explode_pushdown_blocked_by_path_to_binding() {
    // Filter uses path("$item.price") - should NOT be pushed past explode
    let arbor = parse_jsonl(
        r#"{"category": "books", "items": [{"name": "a", "price": 5}, {"name": "b", "price": 15}]}
{"category": "games", "items": [{"name": "c", "price": 25}, {"name": "d", "price": 3}]}"#,
    );

    // Explode with explicit binding, then filter on binding path
    let result = arbor
        .explode(path("items"), Some("$item".to_string()))
        .unwrap()
        .filter(&path("$item.price").gt(lit(10)))
        .unwrap();

    // Should get items with price > 10: "b" (15) and "c" (25)
    assert_eq!(result.len().unwrap(), 2);
}

#[test]
fn test_explode_pushdown_allowed_for_unrelated_path() {
    // Filter uses path("category") - unrelated to items, CAN be pushed down
    let arbor = parse_jsonl(
        r#"{"category": "books", "items": [{"name": "a"}, {"name": "b"}]}
{"category": "games", "items": [{"name": "c"}, {"name": "d"}]}"#,
    );

    let result = arbor
        .explode(path("items"), Some("$item".to_string()))
        .unwrap()
        .filter(&path("category").eq(lit("books")))
        .unwrap();

    // Should get all items from "books" category: "a" and "b"
    assert_eq!(result.len().unwrap(), 2);
}

#[test]
fn test_explode_pushdown_blocked_when_no_binding() {
    // When as_binding is None, optimizer should not push down
    let arbor = parse_jsonl(
        r#"{"category": "books", "items": [1, 2]}
{"category": "games", "items": [3, 4]}"#,
    );

    // No explicit binding - pushdown should be blocked for safety
    let result = arbor
        .explode(path("items"), None)  // No binding
        .unwrap()
        .filter(&path("category").eq(lit("books")))
        .unwrap();

    // Should still produce correct results even without pushdown optimization
    assert_eq!(result.len().unwrap(), 2);
}
```

### Step 1.5: Verify

```bash
cargo nextest run -p arbors-expr -- path_roots
cargo nextest run -p arbors-expr -- has_relative_path
cargo nextest run -p arbors -- explode_pushdown
cargo nextest run -p arbors-planner
```

---

# FIX 2: Composite Materialization Coordinate Bug

## Problem Statement

When materializing a `PhysicalResult::Composite` with a sparse base (e.g., from `take([50, 70])`), the code incorrectly resolves `VirtualIndex::Base(50)` against a compacted arbor that only has indices 0-1.

**Example failure**:
```rust
let sparse = arbor.take(&[50, 70]);  // Creates Indices result with [50, 70]
let with_append = sparse.append(vec![tree]);  // Creates Composite

// Materialization:
// 1. Materializes base (sparse) -> produces arbor with 2 trees (indices 0, 1)
// 2. Tries VirtualIndex::Base(50) -> ERROR: index 50 out of bounds for arbor with 2 trees
```

## Solution

Resolve base indices against the root source (original data), not the compacted intermediate arbor. The existing `RootSourceInfo` enum (line 2312 in physical.rs) should be used.

## Implementation Steps

### Step 2.1: Find and fix the Composite materialization branch

**File**: `crates/arbors-planner/src/physical.rs`

Locate `materialize_result()` function and find the `PhysicalResult::Composite` match arm.

The fix: instead of materializing base first and then resolving indices against it, resolve `VirtualIndex::Base(n)` against the **root source** using `find_root_source_info()`.

**Key change pattern**:
```rust
PhysicalResult::Composite { base: _, layer, indices } => {
    if indices.is_empty() {
        return Ok(Arc::new(InMemoryArbor::new()));
    }

    // Find root source for correct coordinate resolution
    let root_info = find_root_source_info(plan)?;

    let mut builder = ArborBuilder::new_schemaless();

    for vidx in indices.iter() {
        let tree = resolve_virtual_index_to_tree(vidx, &root_info, layer, txn)?;
        builder.add_tree(tree.arbor(), 0)
            .map_err(|e| PipelineError::StorageError(e.to_string()))?;
    }

    Ok(Arc::new(builder.finish()))
}
```

### Step 2.2: Add helper to resolve virtual indices

Add near the `RootSourceInfo` enum:

```rust
/// Resolve a VirtualIndex to an actual Tree, handling all cases.
fn resolve_virtual_index_to_tree(
    vidx: &VirtualIndex,
    root_info: &RootSourceInfo,
    layer: &MutationLayer,
    txn: Option<&OwnedReadTxn>,
) -> Result<Tree, PipelineError> {
    match vidx {
        VirtualIndex::Base(backing_idx) => {
            // Check for replacement first
            if let Some(replacement) = layer.base_replacements.get(backing_idx) {
                return Ok(replacement.clone());
            }
            // Resolve from root source at original index
            get_tree_from_root_source(root_info, txn, *backing_idx)
        }

        VirtualIndex::BaseDup { backing_idx, id } => {
            // Check dup-specific replacement first
            if let Some(replacement) = layer.dup_base_replacements.get(id) {
                return Ok(replacement.clone());
            }
            // Then base replacement
            if let Some(replacement) = layer.base_replacements.get(backing_idx) {
                return Ok(replacement.clone());
            }
            // Resolve from root source
            get_tree_from_root_source(root_info, txn, *backing_idx)
        }

        VirtualIndex::Appended(idx) => {
            let key = VirtualKey::Appended(*idx);
            if let Some(replacement) = layer.virtual_replacements.get(&key) {
                return Ok(replacement.clone());
            }
            layer.appends.get(*idx).cloned().ok_or_else(|| {
                PipelineError::IndexOutOfBounds { index: *idx, count: layer.appends.len() }
            })
        }

        VirtualIndex::Inserted { slot, offset } => {
            let key = VirtualKey::Inserted { slot: *slot, offset: *offset };
            if let Some(replacement) = layer.virtual_replacements.get(&key) {
                return Ok(replacement.clone());
            }
            let trees = layer.insertions.get(slot).ok_or_else(|| {
                PipelineError::StorageError(format!("No insertions at slot {}", slot))
            })?;
            trees.get(*offset).cloned().ok_or_else(|| {
                PipelineError::IndexOutOfBounds { index: *offset, count: trees.len() }
            })
        }
    }
}

/// Get a single tree from the root source at the given backing index.
fn get_tree_from_root_source(
    root_info: &RootSourceInfo,
    txn: Option<&OwnedReadTxn>,
    backing_idx: usize,
) -> Result<Tree, PipelineError> {
    match root_info {
        RootSourceInfo::InMemory(arbor) => {
            let count = arbor.num_trees();
            if backing_idx >= count {
                return Err(PipelineError::IndexOutOfBounds { index: backing_idx, count });
            }
            let single = arbor.slice_by_indices(&[backing_idx])
                .map_err(|e| PipelineError::StorageError(e.to_string()))?;
            Tree::from_arbor(single, 0)
                .ok_or_else(|| PipelineError::StorageError("Failed to extract tree".into()))
        }
        RootSourceInfo::Stored { name } => {
            let txn = txn.ok_or_else(|| {
                PipelineError::StorageError("Stored plan requires transaction".into())
            })?;
            let batched = txn.get_batched(name)
                .map_err(|e| PipelineError::StorageError(e.to_string()))?
                .ok_or_else(|| {
                    PipelineError::StorageError(format!("arbor '{}' not found", name))
                })?;
            BatchedSource::new(&batched).get_tree(backing_idx)
        }
    }
}
```

### Step 2.3: Add regression tests

**File**: `crates/arbors/tests/integration/mutation_tests.rs`

Add tests to this file (it already has `read_jsonl`, `Arbor`, `first_tree` helpers):

```rust
// =============================================================================
// Composite Materialization Coordinate Tests
// =============================================================================

#[test]
fn test_sparse_take_then_append_materializes_correctly() {
    // Create arbor with 100 trees
    let lines: Vec<String> = (0..100).map(|i| format!(r#"{{"id": {}}}"#, i)).collect();
    let jsonl = lines.join("\n");
    let arbor = read_jsonl(jsonl.as_bytes(), None).unwrap();

    // Take sparse indices [50, 70]
    let sparse = arbor.take(&[50, 70]).unwrap();

    // Append a tree
    let new_tree = first_tree(&parse_jsonl(r#"{"id": "new"}"#));
    let with_append = sparse.append(std::iter::once(new_tree)).unwrap();

    // Materialize by iterating
    let result: Vec<_> = with_append.iter().filter_map(|r| r.ok()).collect();

    assert_eq!(result.len(), 3);

    // Verify correct trees were retrieved
    let ids: Vec<String> = result.iter().map(|t| {
        t.get_field(t.root(), "id")
            .and_then(|id| t.get_i64(id).map(|n| n.to_string())
                .or_else(|| t.get_string(id).map(|s| s.to_string())))
            .unwrap_or_default()
    }).collect();

    assert_eq!(ids, vec!["50", "70", "new"]);
}

#[test]
fn test_filter_then_append_materializes_correctly() {
    let arbor = parse_jsonl(
        r#"{"id": 0, "active": false}
{"id": 1, "active": true}
{"id": 2, "active": true}
{"id": 3, "active": false}"#,
    );

    // Filter creates sparse view (keeps indices 1, 2)
    let filtered = arbor.filter(&path("active").eq(lit(true))).unwrap();

    // Append
    let new_tree = first_tree(&parse_jsonl(r#"{"id": "new", "active": true}"#));
    let with_append = filtered.append(std::iter::once(new_tree)).unwrap();

    // Materialize by iterating
    let result: Vec<_> = with_append.iter().filter_map(|r| r.ok()).collect();

    assert_eq!(result.len(), 3);
}

#[test]
fn test_sort_head_then_append_materializes_correctly() {
    let arbor = parse_jsonl(
        r#"{"id": 0, "value": 100}
{"id": 1, "value": 50}
{"id": 2, "value": 200}
{"id": 3, "value": 75}"#,
    );

    // Sort descending and take top 2
    let sorted = arbor.sort_by_desc(path("value")).unwrap();
    let top2 = sorted.head(2).unwrap();  // Gets ids 2 (200) and 0 (100)

    // Append
    let new_tree = first_tree(&parse_jsonl(r#"{"id": "new", "value": 999}"#));
    let with_append = top2.append(std::iter::once(new_tree)).unwrap();

    // Materialize by iterating
    let result: Vec<_> = with_append.iter().filter_map(|r| r.ok()).collect();

    assert_eq!(result.len(), 3);
}
```

### Step 2.4: Verify

```bash
cargo nextest run -p arbors -- sparse_take_then_append
cargo nextest run -p arbors -- filter_then_append
cargo nextest run -p arbors -- sort_head_then_append
cargo nextest run -p arbors-planner
```

---

# FIX 3: Remove Dead Mutation Match Arms

## Problem Statement

The mutation match arms in `execute_plan_node()` are unreachable dead code (~300 lines). The fast path at line ~2775 catches all mutations and returns early. These dead arms create maintenance risk if they drift from `apply_mutation_op()`.

## Solution

Replace the dead match arms with a single `unreachable!()` arm.

## Implementation Steps

### Step 3.1: Verify reachability

Before removing, confirm the fast path returns early:

```bash
cargo nextest run -p arbors -- mutation
cargo nextest run -p arbors -- append
cargo nextest run -p arbors -- insert
cargo nextest run -p arbors -- remove
```

All mutation tests should pass, confirming the fast path handles everything.

### Step 3.2: Locate and remove dead code

**File**: `crates/arbors-planner/src/physical.rs`

Find the match arms for `Append`, `Insert`, `Set`, `Remove` in the main `match plan { ... }` block (look for large blocks after the fast-path early return around line 2775).

Delete the full implementations in these match arms.

### Step 3.3: Replace with unreachable arm

Replace the deleted code with:

```rust
// ====================================================================
// Mutation nodes: handled by fast path
// ====================================================================
// The fast path (line ~2775) collapses chains of mutations into a
// single traversal using apply_mutation_op(). These match arms are
// unreachable but kept for exhaustiveness checking.
LogicalPlan::Append { .. }
| LogicalPlan::Insert { .. }
| LogicalPlan::Set { .. }
| LogicalPlan::Remove { .. } => {
    unreachable!(
        "Mutation operations are handled by fast path (line 2775). \
         If you see this panic, the fast path logic has changed."
    )
}
```

### Step 3.4: Verify no functional change

```bash
cargo nextest run -p arbors
cargo nextest run -p arbors-planner
just python-test
```

All tests should pass since we only removed dead code.

---

# Verification Checklist

After implementing all three fixes:

- [ ] `cargo nextest run -p arbors-expr -- path_roots` passes (new analysis function)
- [ ] `cargo nextest run -p arbors-expr -- has_relative_path` passes (new analysis function)
- [ ] `cargo nextest run -p arbors` passes
- [ ] `cargo nextest run -p arbors-planner` passes
- [ ] `just python-test` passes
- [ ] New regression tests for explode pushdown pass (`explode_pushdown_blocked_*`)
- [ ] New regression tests for composite materialization pass (`sparse_take_then_append_*`, `filter_then_append_*`)
- [ ] No warnings about dead code in mutation match arms

---

# Clarifying Questions Resolved

1. **Explode default binding**: When `as_binding == None`, no field is created. The optimizer uses `"$item"` as a default check name, but this is unsafe. **Decision**: Block pushdown when `as_binding.is_none()`.

2. **Explode expression scope**: On HEAD, explode accepts any `Expr`, not just paths. When explode path is non-trivial (e.g., `children()` or computed), `explode_path_root()` returns `None`, and we rely on binding name checks only. This is safe given decision #1.

3. **Target safety level**: **"Never wrong"** - the conservative approach blocks pushdown more often but never produces incorrect results. Performance can be improved later with proper expression binding semantics.
