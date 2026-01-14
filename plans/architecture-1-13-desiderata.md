# Phase 13 Desiderata (Deferred)

This document captures **deferred** Phase 13 work that is intentionally not part of the active Phase 13 implementation plan right now.

**Note:** The main plan in `plans/architecture-phase-13.md` has been renumbered/reordered. The sections below retain their original Phase 13 numbering (13.6–13.8) as a historical identifier for these deferred items.

---

## Phase 13.6 Tree Diff and Comparison

**Purpose:** Compare trees and find differences.

### 13.6.1 Diff Operations

```rust
// Compare two trees, return differences
tree1.diff(tree2) -> TreeDiff

struct TreeDiff {
    added: Vec<DiffEntry>,      // Paths that exist in tree2 but not tree1
    removed: Vec<DiffEntry>,    // Paths that exist in tree1 but not tree2
    changed: Vec<DiffChange>,   // Paths where values differ
}

struct DiffEntry {
    path: String,
    value: Value,  // The value at the path
}

struct DiffChange {
    path: String,
    old_value: Value,
    new_value: Value,
}

// Check structural equality
tree1.equals(tree2) -> bool

// Check structural equality with options
tree1.equals_with_options(tree2, options: EqualityOptions) -> bool

struct EqualityOptions {
    ignore_order: bool,      // Ignore array order
    ignore_paths: Vec<&str>, // Paths to exclude from comparison
    float_tolerance: f64,    // Tolerance for float comparison
}
```

### 13.6.2 Semantic Specification

**Null vs Missing:**
- `null` is a value; missing key means key doesn't exist
- `{"a": null}` differs from `{}`
- Diff reports: `added` (new key), `removed` (deleted key), `changed` (value changed including null↔non-null)

**Float comparison:**
- Default: exact equality (no tolerance)
- With `float_tolerance`: `|a - b| <= tolerance` considered equal
- NaN: `NaN == NaN` is `false` (IEEE semantics) unless `treat_nan_equal: true`

**Type differences:**
- Different types at same path = `changed`, not special category
- e.g., `"5"` → `5` is a change from string to int

### 13.6.3 Tasks

- [ ] Design `TreeDiff` structure
- [ ] Implement `diff()` algorithm
- [ ] Implement `equals()` and `equals_with_options()`
- [ ] Handle edge cases (null vs missing, type differences)
- [ ] Python bindings with Pythonic diff representation

### 13.6.4 Deliverables and Checkpoints

**Deliverable:** Tree diff and comparison API.

| Checkpoint | Verification |
|------------|--------------|
| Diff detects added/removed/changed | Unit tests per semantic spec |
| null vs missing handled correctly | `{"a": null}` differs from `{}` |
| Float tolerance works | Test with `float_tolerance` option |
| equals() works | Unit tests for structural equality |
| Rust tests pass | `cargo test` succeeds |
| Python tests pass | `make test` succeeds |

**Commit after all checkpoints pass.**

---

## Phase 13.7 Tree Merge Operations

**Purpose:** Deep merge trees with configurable conflict resolution.

### 13.7.1 Merge Operations

```rust
// Merge tree2 into tree1
tree1.merge(tree2) -> Tree  // Default: tree2 wins conflicts

// Merge with explicit strategy
tree1.merge_with_strategy(tree2, strategy: MergeStrategy) -> Tree

enum MergeStrategy {
    /// tree2 values overwrite tree1 values on conflict
    RightWins,
    /// tree1 values preserved on conflict
    LeftWins,
    /// Arrays are concatenated, objects are merged recursively
    Deep,
    /// Custom conflict resolution
    Custom(Box<dyn Fn(ConflictContext) -> Resolution>),
}

struct ConflictContext {
    path: String,
    left_value: Option<Value>,
    right_value: Option<Value>,
}

enum Resolution {
    UseLeft,
    UseRight,
    UseBoth,  // For arrays: concatenate
    UseCustom(Value),
    Skip,     // Omit from result
}
```

### 13.7.2 Semantic Specification

**Conflict definition:** Same path exists in both trees with different values.

**Strategies:**
| Strategy | Objects | Arrays | Scalars |
|----------|---------|--------|---------|
| `RightWins` | Merge keys, right wins conflicts | Replace entirely | Right value |
| `LeftWins` | Merge keys, left wins conflicts | Keep left | Left value |
| `Deep` | Recursive merge | Concatenate | Right value |

**Array merge detail (Deep strategy):**
- Concatenation: `[1,2] + [3,4]` → `[1,2,3,4]`
- No deduplication by default
- Future: `merge_by_key` for keyed array merging (not in Phase 13)

**Missing vs Null in merge:**
- Missing key + value → add the value
- Null + value → conflict (resolved by strategy)
- Value + null → conflict (resolved by strategy)

### 13.7.3 Tasks

- [ ] Design merge algorithm for nested structures
- [ ] Implement `MergeStrategy` enum
- [ ] Handle array merge strategies (concat, replace, merge-by-key)
- [ ] Implement custom conflict resolution callback
- [ ] Python bindings with Pythonic callback support

### 13.7.4 Deliverables and Checkpoints

**Deliverable:** Tree merge API with configurable strategies.

| Checkpoint | Verification |
|------------|--------------|
| RightWins strategy works | Unit tests: right value wins conflicts |
| LeftWins strategy works | Unit tests: left value wins conflicts |
| Deep strategy works | Unit tests: recursive merge, array concat |
| Custom callback works | Unit tests: callback receives conflict context |
| Rust tests pass | `cargo test` succeeds |
| Python tests pass | `make test` succeeds |

**Commit after all checkpoints pass.**

---

## Phase 13.8 Tree Flatten and Unflatten

**Purpose:** Convert between nested and flat representations.

### 13.8.1 Flatten Operations

```rust
// Flatten tree to path-value pairs
tree.flatten() -> Vec<(String, Value)>

// Flatten with options
tree.flatten_with_options(options: FlattenOptions) -> Vec<(String, Value)>

struct FlattenOptions {
    separator: String,        // Default: "."
    array_notation: ArrayNotation,
    include_containers: bool, // Include non-leaf nodes?
}

enum ArrayNotation {
    Bracket,   // "items[0].name"
    Dot,       // "items.0.name"
}

// Example:
// {"user": {"name": "Alice", "scores": [95, 87]}}
// Flattens to:
// [("user.name", "Alice"), ("user.scores[0]", 95), ("user.scores[1]", 87)]

// Unflatten back to tree
Tree::from_flat(pairs: Vec<(String, Value)>) -> Tree
```

### 13.8.2 Semantic Specification

**Defaults:**
- Separator: `"."`
- Array notation: `Bracket` (`items[0]`)
- Include containers: `false` (only leaf values)

**Edge cases:**
| Input | Output |
|-------|--------|
| `{}` | `[]` (empty) |
| `[]` | `[]` (empty) |
| `{"a": []}` | `[]` (empty array = no leaves) |
| `{"a": null}` | `[("a", null)]` (null is a leaf) |
| `{"a": {"b": []}}` | `[]` (nested empty = no leaves) |

**Unflatten ambiguity:**
- `"items.0"` with Dot notation → array index
- `"items[0]"` with Bracket notation → array index
- Conflicting paths error: `[("a", 1), ("a.b", 2)]` → error (can't be both scalar and object)

### 13.8.3 Tasks

- [ ] Implement `flatten()` with configurable options
- [ ] Implement `unflatten()` / `from_flat()`
- [ ] Handle edge cases (empty containers, nulls)
- [ ] Python bindings returning dict/list

### 13.8.4 Deliverables and Checkpoints

**Deliverable:** Flatten/unflatten API for nested ↔ flat conversion.

| Checkpoint | Verification |
|------------|--------------|
| flatten() produces correct paths | Unit tests per semantic spec |
| Empty containers handled | `{"a": []}` → `[]` |
| null is a leaf | `{"a": null}` → `[("a", null)]` |
| unflatten round-trips | `unflatten(flatten(tree)) == tree` |
| Conflicting paths error | `[("a", 1), ("a.b", 2)]` errors |
| Rust tests pass | `cargo test` succeeds |
| Python tests pass | `make test` succeeds |

**Commit after all checkpoints pass.**
