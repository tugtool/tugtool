# Phase 21: Functional Arbor Mutations

## Overview

Add **functional mutation methods** to `Arbor` (append, concat, insert, set, remove) that return new Arbors, enabling chainable structural changes. This requires extending the current **single-root, indices-first** execution model to support **multi-source composition**.

## Key Decisions

| Decision | Choice |
|----------|--------|
| API style | Functional: all methods return NEW Arbor, original unchanged |
| Chainability | Full: `arbor.filter(...).append(tree).sort_by(...).head(10)` works |
| Evaluation | **Lazy with strategic materialization** |
| Index semantics | **Logical indices** (consistent with `get()` and Python `__getitem__`) |
| Negative indexing | Python-only sugar (Rust takes `usize`) |
| Schema behavior | Preserve if compatible; if not, materialize and infer |
| Python refactor | **Cancelled** - add bindings to existing `lib.rs` |
| IndexSet redesign | **Spread/Stretch** - run-length encoded for O(1) common cases |
| Phase 0 strategy | **All-in replacement** - no lossy bridges to O(N) representations |
| Concat staging | **Staged**: v1=single-root mutations, v1.5=concat-as-append, v2=binary nodes |
| Tree storage | **Arc-wrapped** - `Arc<Vec<OwnedTree>>` in QueryPlan to avoid clone cost |

---

## Critical Semantic: Logical vs Backing Indices

**Problem**: Mutation APIs take **logical indices** (position in current view), but `Spread::excluding()` operates on **backing indices** (positions in the underlying source).

After any view operation (filter/take/head/tail/sort), logical index 10 may map to backing index 47.

**Solution**: Use **`IndexSet::to_backing_indices()`** (not `Spread` directly) because it handles both ordered AND permuted variants.

### IndexSet-Level Conversion (Handles All Variants)

```rust
impl IndexSet {
    /// Convert logical positions to backing indices.
    ///
    /// This is the PRIMARY API for mutation operations. It handles both
    /// ordered (Spread-based) and permuted (sort/shuffle) variants correctly.
    ///
    /// # Errors
    ///
    /// Returns `IndexOutOfBounds` if any logical position is >= self.len().
    /// This is intentional: mutation APIs must fail loudly on invalid indices,
    /// not silently drop them.
    ///
    /// # Mutation Semantics
    ///
    /// Input is sorted and deduplicated before processing:
    /// - `remove([2, 1, 2])` is equivalent to `remove([1, 2])`
    /// - Duplicates don't cause double-removal attempts
    /// - Order of input doesn't affect result
    pub fn to_backing_indices_for_mutation(
        &self,
        logical_positions: &[usize],
    ) -> Result<Vec<usize>, PipelineError> {
        let len = self.len();

        // Sort and dedup input
        let mut positions: Vec<usize> = logical_positions.to_vec();
        positions.sort_unstable();
        positions.dedup();

        // Validate all positions (fail-fast)
        if let Some(&max_pos) = positions.last() {
            if max_pos >= len {
                return Err(PipelineError::IndexOutOfBounds {
                    index: max_pos,
                    count: len,
                });
            }
        }

        // Convert to backing - works for both Ordered and Permuted
        positions
            .into_iter()
            .map(|pos| {
                self.get_backing_index(pos)
                    .ok_or_else(|| PipelineError::IndexOutOfBounds {
                        index: pos,
                        count: len,
                    })
            })
            .collect()
    }

    /// Get backing index for a logical position.
    /// Handles both Ordered(Spread) and Permuted variants.
    pub fn get_backing_index(&self, logical_pos: usize) -> Option<usize> {
        match self {
            IndexSet::Ordered(spread) => spread.get(logical_pos),

            IndexSet::Permuted { spread, perm, restore_order, .. } => {
                // Apply restore_order if present (for batch-grouped iteration)
                let effective_pos = if let Some(restore) = restore_order {
                    *restore.get(logical_pos)?
                } else {
                    logical_pos
                };

                // perm[effective_pos] is an offset INTO spread
                let spread_offset = *perm.get(effective_pos)?;

                // spread.get() translates spread offset to backing index
                spread.get(spread_offset)
            }
        }
    }
}
```

**Usage in mutations:**

```rust
// In Remove execution:
QueryPlan::Remove { source, indices: logical_positions } => {
    let source_result = execute_plan_node(source, txn)?;
    let index_set = source_result.as_index_set()?;

    // Use IndexSet-level conversion (handles Ordered AND Permuted)
    let backing_indices = index_set.to_backing_indices_for_mutation(logical_positions)?;

    // Now exclude by backing index
    let spread = index_set.to_ordered_spread();
    let kept = spread.excluding(&backing_indices);
    Ok(PhysicalResult::Indices(IndexSet::Ordered(kept)))
}
```

This applies to: `remove()`, `set()`, `insert()` - any mutation that targets existing elements by position.

### Why Spread::to_backing_indices() is Insufficient

`Spread` only handles ordered indices. After `sort_by()` or `shuffle()`, you have a `Permuted` variant where:

- Logical position 10 maps to `perm[10]` (an offset into the spread)
- That offset then maps through `spread.get()` to the backing index

Using `spread.to_backing_indices()` directly would skip the permutation step and give wrong results.

---

## Phase 0: Spread/Stretch IndexSet Replacement

### Motivation

The current `IndexSet` has three ad-hoc variants that don't handle mutations efficiently:

| Current Variant | Limitation |
|-----------------|------------|
| `Range { start, end }` | Cannot represent holes (removals) |
| `Sparse(Vec<usize>)` | O(N) memory for large sets |
| `Permuted { perm, ... }` | O(N) memory, complex batch optimization |

**Problem for mutations:**
- `remove(indices)` from a `Range(0..1_000_000)` creates `Sparse` with 999,997 elements
- `append(tree)` to a `Range` requires conversion to O(N) representation
- This makes lazy mutations impractical at scale

### Solution: Spread/Stretch

**Spread** represents an index set as a union of sorted, non-overlapping **Stretches** (contiguous ranges):

| Representation | Example |
|----------------|---------|
| `0..1_000_000` | 1 stretch: `[Stretch(0, 1_000_000)]` |
| Same with 3 removals at 100, 500, 999 | 4 stretches: `[(0,100), (101,500), (501,999), (1000,1_000_000)]` |
| Range + 10 appended | 2 stretches: `[(0,N), (N,N+10)]` |

### New Types

**File:** `crates/arbors-planner/src/spread.rs` (new)

```rust
use smallvec::SmallVec;

/// A half-open range [start, end) representing a contiguous run of indices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stretch {
    pub start: usize,
    pub end: usize,
}

impl Stretch {
    #[inline]
    pub const fn new(start: usize, end: usize) -> Self {
        debug_assert!(start <= end);
        Self { start, end }
    }

    #[inline]
    pub const fn len(&self) -> usize {
        self.end - self.start
    }

    #[inline]
    pub const fn is_empty(&self) -> bool {
        self.start == self.end
    }

    #[inline]
    pub const fn contains(&self, index: usize) -> bool {
        index >= self.start && index < self.end
    }

    #[inline]
    pub const fn get(&self, offset: usize) -> Option<usize> {
        if offset < self.len() {
            Some(self.start + offset)
        } else {
            None
        }
    }

    pub fn iter(&self) -> std::ops::Range<usize> {
        self.start..self.end
    }
}

/// A set of indices represented as sorted, non-overlapping stretches.
///
/// Invariants:
/// - Stretches are sorted by `start`
/// - Stretches are non-overlapping and non-adjacent (merged)
/// - No empty stretches
///
/// Performance:
/// - `len()`: O(1) via cached count
/// - `get(i)`: O(S) linear scan through stretches (S typically 1-4, so effectively O(1))
/// - `contains(i)`: O(log S) via binary search
/// - `excluding(indices)`: O(K + S) where K = removals, S = stretch count
/// - `iter()`: O(N) but no allocation for iteration
///
/// Note: `get(i)` uses linear scan because S is small (usually 1-2 for common cases).
/// If large S becomes common, upgrade to prefix-sum binary search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spread {
    /// Sorted, non-overlapping, non-empty stretches.
    /// SmallVec inlines up to 2 stretches (common case: single range).
    stretches: SmallVec<[Stretch; 2]>,
    /// Cached total count for O(1) len().
    len: usize,
}
```

### Core Spread Methods

```rust
impl Spread {
    /// Empty spread (constant, no allocation).
    pub const EMPTY: Spread = Spread {
        stretches: SmallVec::new_const(),
        len: 0,
    };

    /// Create a spread covering [0, n).
    pub fn full(n: usize) -> Self {
        if n == 0 {
            return Self::EMPTY;
        }
        Self {
            stretches: SmallVec::from_buf([Stretch::new(0, n)]),
            len: n,
        }
    }

    /// Create from a single range [start, end).
    pub fn from_range(start: usize, end: usize) -> Self {
        if start >= end {
            return Self::EMPTY;
        }
        Self {
            stretches: SmallVec::from_buf([Stretch::new(start, end)]),
            len: end - start,
        }
    }

    /// Create from sorted, deduplicated indices.
    /// Coalesces runs into stretches automatically.
    pub fn from_sorted(indices: &[usize]) -> Self {
        if indices.is_empty() {
            return Self::EMPTY;
        }

        let mut stretches = SmallVec::new();
        let mut start = indices[0];
        let mut end = start + 1;

        for &idx in &indices[1..] {
            if idx == end {
                end += 1; // Extend current stretch
            } else {
                stretches.push(Stretch::new(start, end));
                start = idx;
                end = idx + 1;
            }
        }
        stretches.push(Stretch::new(start, end));

        Self {
            len: indices.len(),
            stretches,
        }
    }

    /// Create from unsorted, possibly duplicated indices.
    pub fn from_unsorted(indices: &[usize]) -> Self {
        if indices.is_empty() {
            return Self::EMPTY;
        }
        let mut sorted: Vec<usize> = indices.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        Self::from_sorted(&sorted)
    }

    #[inline]
    pub const fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn is_contiguous(&self) -> bool {
        self.stretches.len() <= 1
    }

    /// O(S) lookup of backing index at logical position.
    /// S is typically 1-4, so effectively O(1) for common cases.
    pub fn get(&self, logical_index: usize) -> Option<usize> {
        if logical_index >= self.len {
            return None;
        }

        // Fast path: single stretch (most common)
        if self.stretches.len() == 1 {
            return self.stretches[0].get(logical_index);
        }

        // Linear scan through stretches (S is small)
        let mut remaining = logical_index;
        for stretch in &self.stretches {
            if remaining < stretch.len() {
                return Some(stretch.start + remaining);
            }
            remaining -= stretch.len();
        }
        None // Should not reach
    }

    /// O(log S) containment check.
    pub fn contains(&self, index: usize) -> bool {
        let pos = self.stretches.partition_point(|s| s.end <= index);
        pos < self.stretches.len() && self.stretches[pos].contains(index)
    }

    /// Get as single range if contiguous.
    pub fn as_range(&self) -> Option<std::ops::Range<usize>> {
        match self.stretches.len() {
            0 => Some(0..0),
            1 => {
                let s = &self.stretches[0];
                Some(s.start..s.end)
            }
            _ => None,
        }
    }
}
```

### Spread Mutation Methods (Return New Spread)

```rust
impl Spread {
    /// Convert logical positions to backing indices.
    /// This is CRITICAL for mutation operations that take logical positions
    /// but need to operate on backing indices.
    ///
    /// Example: After filter, logical position 5 might be backing index 47.
    pub fn to_backing_indices(&self, logical_positions: &[usize]) -> Vec<usize> {
        logical_positions
            .iter()
            .filter_map(|&pos| self.get(pos))
            .collect()
    }

    /// Remove specific backing indices, splitting stretches as needed.
    /// O(K + S) where K = removals, S = stretch count.
    ///
    /// NOTE: Takes BACKING indices, not logical positions.
    /// Use `to_backing_indices()` first if you have logical positions.
    pub fn excluding(&self, removals: &[usize]) -> Self {
        if removals.is_empty() || self.is_empty() {
            return self.clone();
        }

        let mut sorted_removals = removals.to_vec();
        sorted_removals.sort_unstable();
        sorted_removals.dedup();

        let mut new_stretches = SmallVec::new();
        let mut removal_idx = 0;
        let mut removed_count = 0;

        for stretch in &self.stretches {
            // Skip removals before this stretch
            while removal_idx < sorted_removals.len()
                && sorted_removals[removal_idx] < stretch.start
            {
                removal_idx += 1;
            }

            let mut current_start = stretch.start;

            while removal_idx < sorted_removals.len() {
                let removal = sorted_removals[removal_idx];

                if removal >= stretch.end {
                    break;
                }

                if removal > current_start {
                    new_stretches.push(Stretch::new(current_start, removal));
                }

                removed_count += 1;
                current_start = removal + 1;
                removal_idx += 1;
            }

            if current_start < stretch.end {
                new_stretches.push(Stretch::new(current_start, stretch.end));
            }
        }

        Self {
            len: self.len.saturating_sub(removed_count),
            stretches: new_stretches,
        }
    }

    /// Append another spread's indices (assumes other comes after self).
    pub fn appending(&self, other: &Spread) -> Self {
        if other.is_empty() {
            return self.clone();
        }
        if self.is_empty() {
            return other.clone();
        }

        let mut new_stretches = self.stretches.clone();

        // Try to merge adjacent stretches
        if let (Some(last), Some(first)) = (new_stretches.last_mut(), other.stretches.first()) {
            if last.end == first.start {
                last.end = first.end;
                new_stretches.extend(other.stretches.iter().skip(1).cloned());
            } else {
                new_stretches.extend(other.stretches.iter().cloned());
            }
        }

        Self {
            len: self.len + other.len,
            stretches: new_stretches,
        }
    }

    /// Take first n indices.
    pub fn head(&self, n: usize) -> Self {
        if n == 0 {
            return Self::EMPTY;
        }
        if n >= self.len {
            return self.clone();
        }

        let mut new_stretches = SmallVec::new();
        let mut remaining = n;

        for stretch in &self.stretches {
            if remaining == 0 {
                break;
            }
            let take = remaining.min(stretch.len());
            new_stretches.push(Stretch::new(stretch.start, stretch.start + take));
            remaining -= take;
        }

        Self {
            len: n,
            stretches: new_stretches,
        }
    }

    /// Skip first n indices, return the rest.
    pub fn skip(&self, n: usize) -> Self {
        if n == 0 {
            return self.clone();
        }
        if n >= self.len {
            return Self::EMPTY;
        }

        let mut new_stretches = SmallVec::new();
        let mut to_skip = n;
        let mut started = false;

        for stretch in &self.stretches {
            if !started {
                if to_skip >= stretch.len() {
                    to_skip -= stretch.len();
                    continue;
                }
                // Partial skip in this stretch
                new_stretches.push(Stretch::new(stretch.start + to_skip, stretch.end));
                started = true;
            } else {
                new_stretches.push(*stretch);
            }
        }

        Self {
            len: self.len - n,
            stretches: new_stretches,
        }
    }

    /// Take last n indices.
    pub fn tail(&self, n: usize) -> Self {
        if n >= self.len {
            return self.clone();
        }
        self.skip(self.len - n)
    }

    /// Compute intersection with another spread.
    pub fn intersection(&self, other: &Spread) -> Self {
        if self.is_empty() || other.is_empty() {
            return Self::EMPTY;
        }

        let mut new_stretches = SmallVec::new();
        let mut i = 0;
        let mut j = 0;

        while i < self.stretches.len() && j < other.stretches.len() {
            let a = &self.stretches[i];
            let b = &other.stretches[j];

            let start = a.start.max(b.start);
            let end = a.end.min(b.end);

            if start < end {
                new_stretches.push(Stretch::new(start, end));
            }

            if a.end < b.end {
                i += 1;
            } else {
                j += 1;
            }
        }

        let len = new_stretches.iter().map(|s| s.len()).sum();
        Self { len, stretches: new_stretches }
    }
}
```

### Spread Iterator

```rust
/// Iterator over indices in a Spread. Zero allocation.
pub struct SpreadIter<'a> {
    stretches: std::slice::Iter<'a, Stretch>,
    current: Option<std::ops::Range<usize>>,
}

impl<'a> Iterator for SpreadIter<'a> {
    type Item = usize;

    fn next(&mut self) -> Option<usize> {
        loop {
            if let Some(ref mut range) = self.current {
                if let Some(idx) = range.next() {
                    return Some(idx);
                }
            }
            match self.stretches.next() {
                Some(stretch) => {
                    self.current = Some(stretch.start..stretch.end);
                }
                None => return None,
            }
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining: usize = self.current.as_ref().map(|r| r.len()).unwrap_or(0)
            + self.stretches.clone().map(|s| s.len()).sum::<usize>();
        (remaining, Some(remaining))
    }
}

impl ExactSizeIterator for SpreadIter<'_> {}

impl Spread {
    pub fn iter(&self) -> SpreadIter<'_> {
        let mut stretches = self.stretches.iter();
        let current = stretches.next().map(|s| s.start..s.end);
        SpreadIter { stretches, current }
    }
}

impl<'a> IntoIterator for &'a Spread {
    type Item = usize;
    type IntoIter = SpreadIter<'a>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
```

### Migration Path (All-In Strategy)

**IMPORTANT**: No lossy bridge conversions. The old `From<Spread> for IndexSet` fallback to `Sparse(spread.to_vec())` would silently collapse back to O(N) and mask performance regressions.

**Step 0.1**: Create `crates/arbors-planner/src/spread.rs` with types and comprehensive tests.

**Step 0.2**: Replace `IndexSet` internals with `Spread` in a single commit:

```rust
// New IndexSet definition:

/// Index selection over a source.
///
/// # Variants
///
/// - `Ordered(Spread)`: Indices in natural order (filters, takes, head/tail)
/// - `Permuted`: Reordered indices (sort, shuffle)
///
/// # Permutation Semantics (CHANGED FROM CURRENT)
///
/// In `Permuted { spread, perm, ... }`:
/// - `spread` contains the backing indices being permuted
/// - `perm` contains offsets INTO spread (NOT backing indices directly)
/// - Mapping: `logical_pos -> perm[logical_pos] -> spread.get(perm[logical_pos]) -> backing`
///
/// This indirection enables composable operations (filter-after-sort works naturally).
pub enum IndexSet {
    /// Ordered indices (no permutation) - uses Spread internally.
    /// Covers all previous Range and Sparse cases efficiently.
    Ordered(Spread),

    /// Permuted indices (sorted/shuffled) - ordering matters.
    /// Permutations are inherently O(N); we don't try to optimize them.
    Permuted {
        /// The backing indices being permuted (the "what").
        spread: Spread,
        /// Offsets INTO spread giving the order (the "how").
        /// `perm[logical_pos]` gives the spread offset for that logical position.
        /// NOT backing indices directly.
        perm: Vec<usize>,
        /// Whether perm is batch-grouped for efficient I/O.
        batch_grouped: bool,
        /// Optional restore order for batch-grouped permutations.
        restore_order: Option<Vec<usize>>,
    },
}
```

### What Changes with New Permuted Semantics

**Old semantics (current code):**
```rust
Permuted { perm: Vec<usize>, ... }  // perm holds BACKING indices directly
```

**New semantics (Phase 21):**
```rust
Permuted { spread: Spread, perm: Vec<usize>, ... }  // perm holds offsets INTO spread
```

**Code that needs updating in Phase 0:**

| Location | Current | New |
|----------|---------|-----|
| `physical_sort()` | Returns `perm` as backing indices | Returns `spread` from input, `perm` as `0..n` permuted |
| `physical_shuffle()` | Same | Same fix |
| `IndexSet::to_vec()` | `perm.clone()` | `perm.iter().map(\|&i\| spread.get(i).unwrap())` |
| `IndexSet::get_backing_index()` | `perm[pos]` | `spread.get(perm[pos])` |
| `physical_head()` on Permuted | Indexes into `perm` directly | Must compose with spread |
| `physical_tail()` on Permuted | Same | Same |
| `apply_input_mask()` | Iterates `perm` as backing indices | Must go through spread |
| Filter after sort | Filters `perm` directly | Filter `spread`, rebuild `perm` |
| `PlanBasedIter` permuted path | Uses `perm` as backing | Must go through `spread.get()` |
| Batch grouping | Assumes `perm` is backing | Must translate through spread |

**Benefits of new semantics:**
1. Composable: filter-after-sort is natural (restrict the spread)
2. Mutations on permuted views work correctly (always go through spread)
3. Memory: spread compresses well even after sort

**Step 0.3**: Update all `IndexSet` consumers in the same commit:
- `physical.rs`: Update `PhysicalResult` variants and execution
- `iterator.rs` (or wherever `PlanBasedIter` lives): Update iteration logic
- Any other files that match on `IndexSet` variants

**Step 0.4**: Validate no O(N) fallbacks remain:
- Grep for any remaining `Vec<usize>` index representations
- Ensure all consumers use Spread methods directly

**Step 0.5**: Performance validation (benchmarks).

### Phase 0 Implementation Order

| Step | Description | Files |
|------|-------------|-------|
| 0.1 | Create Spread/Stretch types with full tests | `spread.rs` (new) |
| 0.2 | Replace IndexSet internals with Spread (all at once) | `physical.rs`, `lib.rs` |
| 0.3 | Update all IndexSet consumers (same commit) | various |
| 0.4 | Validate no O(N) fallbacks | grep + review |
| 0.5 | Performance validation (benchmarks) | `benches/` |

### Dependency Note

Phase 0 uses `smallvec` for inline-allocated stretch storage. The workspace already has:

```toml
smallvec = { version = "1.13", features = ["const_generics"] }
```

For the `SmallVec::new_const()` method used in `Spread::EMPTY`, the `const_new` feature may be needed. Check if the current configuration supports it; if not, add:

```toml
smallvec = { version = "1.13", features = ["const_generics", "const_new"] }
```

Alternatively, implement `EMPTY` as a function instead of a const if the feature isn't available.

---

## Concat Staging Strategy

**Problem**: `Concat { source, other }` is a **binary plan node** in a mostly-unary world. This creates blast radius in:
- Traversal utilities (`requires_scope`, `format_tree`, `depth`, root discovery)
- Optimizer recursion (every rule assumes a single `source`)
- Execution semantics (what's the "root" for materialization?)

**Solution**: Stage concat implementation:

| Version | Scope | Description |
|---------|-------|-------------|
| **v1** | Single-root | `append`, `remove`, `set`, `insert` only. No binary nodes. |
| **v1.5** | Concat-as-append | `concat(other)` materializes RHS and calls `append(other.trees())`. Avoids binary node but requires materialization. |
| **v2** | True binary | Add `Concat { left, right }` plan node. Update all traversal/optimizer code. |

**v1.5 Implementation:**

```rust
impl Arbor {
    /// Concatenate another arbor, returning a new Arbor.
    ///
    /// v1.5: Materializes the other arbor and appends its trees.
    /// This avoids binary-node complexity but has O(N) cost for RHS.
    pub fn concat(&self, other: &Self) -> Result<Self, PipelineError> {
        // Materialize RHS to get trees
        // Note: iter() returns iterator directly, not Result
        let other_trees: Vec<OwnedTree> = other
            .iter()
            .map(|t| t.to_owned())
            .collect();

        // Use append internally
        self.append(other_trees)
    }
}
```

**When to proceed to v2:**
- If materialization cost is unacceptable for common workloads
- When lazy concat is needed for large arbors
- Budget for traversal/optimizer refactor is available

---

## Phase 1: Architecture - Multi-Source Execution Model

### Current Problem

The current engine is **single-root, indices-first**:
- `IndexSet` (now `Spread`) only addresses trees in ONE source
- `find_root_source_info()` walks a single `source` pointer
- `PlanBasedIter` is hardwired to `IndexSet + RootSourceInfo`

Mutations introduce trees that **don't exist in the root source**:
- `append(tree)` - the tree has no index in the source
- `concat(other)` - other's trees have no indices in self's source
- `insert(pos, tree)` - same problem

### Solution: CompositeSource + Strategic Materialization

**Key insight**: Rather than extending Spread to handle multiple sources (which complicates everything), we:
1. **Keep Spread simple** - addresses one source
2. **Introduce CompositeSource** - layers mutations on base source
3. **Materialize at boundaries** - when ops need single-source semantics

### New Types

#### 1. CompositeSource

```rust
/// A TreeSource that layers mutations on top of a base source.
pub enum CompositeSource<'a> {
    /// Single base source (no mutations)
    Base(ResolvedSource<'a>),

    /// Layered mutations on a base
    Layered {
        base: Box<CompositeSource<'a>>,
        layer: MutationLayer,
    },
}

/// A layer of mutations applied to a base source.
/// All collections are Arc-wrapped for cheap cloning during optimization.
pub struct MutationLayer {
    /// Trees appended after the base (Arc-wrapped)
    appends: Arc<Vec<OwnedTree>>,

    /// Backing indices removed from base (skip these)
    /// Note: These are BACKING indices, not logical positions.
    removals: Arc<HashSet<usize>>,

    /// Replacements: (backing_idx, replacement_tree)
    /// Note: Keys are BACKING indices.
    replacements: Arc<HashMap<usize, Arc<OwnedTree>>>,

    /// Insertions: (logical_position, trees)
    insertions: Arc<BTreeMap<usize, Arc<Vec<OwnedTree>>>>,
}
```

#### 2. VirtualIndex

```rust
/// A virtual index that may reference base source or mutation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VirtualIndex {
    /// Index into the base source
    Base(usize),
    /// Index into the appends vector
    Appended(usize),
    /// Index into an insertion at position
    Inserted { position: usize, offset: usize },
}
```

#### 3. CompositeIndexSet (Lazy Segment-Based)

**IMPORTANT**: A naive `Mixed { indices: Vec<VirtualIndex> }` would allocate O(N) entries on any mutation (defeating Spread's purpose). Instead, use a **segment-based** representation.

**CRITICAL**: `Segment::Base` is insufficient for permuted inputs. A permuted view (from sort/shuffle) must preserve its ordering through mutations. We need separate variants for ordered and permuted base access.

```rust
/// Segment in a lazy composite index set.
/// Each segment represents a contiguous logical range mapping to virtual indices.
#[derive(Clone, Debug)]
pub enum Segment {
    /// Ordered base indices - logical position i maps to spread.get(i).
    /// Used for ordered views (filter, head, tail).
    Base { spread: Spread },

    /// Permuted base indices - logical position i maps to spread.get(perm[perm_start + i]).
    /// Used for sorted/shuffled views.
    ///
    /// # Fields
    /// - `spread`: The backing indices being permuted
    /// - `perm`: Shared permutation array (indices into spread) - Arc to avoid O(N) cloning
    /// - `perm_start`: Start offset into perm for this segment
    /// - `perm_len`: Length of this segment within perm
    ///
    /// # Invariant
    /// `perm_start + perm_len <= perm.len()`
    PermutedBase {
        spread: Spread,
        perm: Arc<Vec<usize>>,  // Shared, not cloned per segment
        perm_start: usize,
        perm_len: usize,
    },

    /// A range of appended indices [start_offset, start_offset + count).
    Appended { start_offset: usize, count: usize },

    /// Indices from an insertion at a specific position.
    Inserted { position: usize, count: usize },
}

impl Segment {
    pub fn len(&self) -> usize {
        match self {
            Segment::Base { spread } => spread.len(),
            Segment::PermutedBase { perm_len, .. } => *perm_len,
            Segment::Appended { count, .. } => *count,
            Segment::Inserted { count, .. } => *count,
        }
    }

    /// Get the VirtualIndex at a logical offset within this segment.
    pub fn get(&self, offset: usize) -> Option<VirtualIndex> {
        if offset >= self.len() { return None; }
        match self {
            Segment::Base { spread } => spread.get(offset).map(VirtualIndex::Base),
            Segment::PermutedBase { spread, perm, perm_start, .. } => {
                // perm[perm_start + offset] gives index into spread
                let perm_idx = perm_start + offset;
                let spread_offset = perm.get(perm_idx)?;
                spread.get(*spread_offset).map(VirtualIndex::Base)
            }
            Segment::Appended { start_offset, .. } => {
                Some(VirtualIndex::Appended(start_offset + offset))
            }
            Segment::Inserted { position, .. } => {
                Some(VirtualIndex::Inserted { position: *position, offset })
            }
        }
    }

    /// Get the backing index for a logical offset.
    /// Returns None for Appended/Inserted (they have no backing index).
    pub fn get_backing_index(&self, offset: usize) -> Option<usize> {
        match self {
            Segment::Base { spread } => spread.get(offset),
            Segment::PermutedBase { spread, perm, perm_start, perm_len } => {
                if offset >= *perm_len { return None; }
                let perm_idx = perm_start + offset;
                let spread_offset = *perm.get(perm_idx)?;
                spread.get(spread_offset)
            }
            Segment::Appended { .. } | Segment::Inserted { .. } => None,
        }
    }

    /// Split a segment at a local offset.
    /// Returns (before, after) where before has `at` elements.
    pub fn split_at(&self, at: usize) -> (Option<Segment>, Option<Segment>) {
        if at == 0 { return (None, Some(self.clone())); }
        if at >= self.len() { return (Some(self.clone()), None); }

        match self {
            Segment::Base { spread } => {
                let before = spread.head(at);
                let after = spread.skip(at);
                (
                    if before.is_empty() { None } else { Some(Segment::Base { spread: before }) },
                    if after.is_empty() { None } else { Some(Segment::Base { spread: after }) },
                )
            }
            Segment::PermutedBase { spread, perm, perm_start, perm_len } => {
                // Split by adjusting perm_start/perm_len - O(1), shares Arc
                let before = Segment::PermutedBase {
                    spread: spread.clone(),
                    perm: Arc::clone(perm),
                    perm_start: *perm_start,
                    perm_len: at,
                };
                let after = Segment::PermutedBase {
                    spread: spread.clone(),
                    perm: Arc::clone(perm),
                    perm_start: perm_start + at,
                    perm_len: perm_len - at,
                };
                (Some(before), Some(after))
            }
            Segment::Appended { start_offset, count } => (
                Some(Segment::Appended { start_offset: *start_offset, count: at }),
                Some(Segment::Appended { start_offset: start_offset + at, count: count - at }),
            ),
            Segment::Inserted { position, count } => (
                Some(Segment::Inserted { position: *position, count: at }),
                Some(Segment::Inserted { position: *position, count: count - at }),
            ),
        }
    }

    /// Remove elements at segment-local offsets.
    /// Returns None if the segment becomes empty.
    fn removing(&self, local_offsets: &[usize]) -> Option<Segment> {
        if local_offsets.is_empty() { return Some(self.clone()); }

        match self {
            Segment::Base { spread } => {
                // Convert local offsets to backing indices, then exclude
                let backing_indices: Vec<usize> = local_offsets
                    .iter()
                    .filter_map(|&off| spread.get(off))
                    .collect();
                let new_spread = spread.excluding(&backing_indices);
                if new_spread.is_empty() { None } else { Some(Segment::Base { spread: new_spread }) }
            }
            Segment::PermutedBase { spread, perm, perm_start, perm_len } => {
                // Build a new perm vector excluding the removed positions
                // This preserves the order of remaining elements
                let remove_set: HashSet<usize> = local_offsets.iter().copied().collect();
                let new_perm_slice: Vec<usize> = (0..*perm_len)
                    .filter(|i| !remove_set.contains(i))
                    .map(|i| perm[*perm_start + i])
                    .collect();

                if new_perm_slice.is_empty() {
                    None
                } else {
                    Some(Segment::PermutedBase {
                        spread: spread.clone(),
                        perm: Arc::new(new_perm_slice),
                        perm_start: 0,
                        perm_len: new_perm_slice.len(),
                    })
                }
            }
            Segment::Appended { start_offset, count } => {
                // Rebuild contiguous range if possible
                let new_count = count - local_offsets.len();
                if new_count == 0 { return None; }
                // Note: For simplicity, assume contiguous removal.
                // Full impl would track which specific indices remain.
                Some(Segment::Appended { start_offset: *start_offset, count: new_count })
            }
            Segment::Inserted { position, count } => {
                let new_count = count - local_offsets.len();
                if new_count == 0 { None } else { Some(Segment::Inserted { position: *position, count: new_count }) }
            }
        }
    }
}

/// Lazy, segment-based composite index set.
///
/// Maintains structure without flattening. O(1) `len()`, O(S) `get()`.
///
/// # Memory Complexity
///
/// - Base selection of N elements: O(stretches), typically 1-4
/// - Append of K trees: O(1) additional (just a new segment)
/// - M insertions: O(M) additional segments
/// - Total: O(stretches + segments), NOT O(N)
///
/// # Example Memory Savings
///
/// | Scenario | Old (Vec<VirtualIndex>) | New (Segmented) |
/// |----------|-------------------------|-----------------|
/// | 1M base + 1 append | 16 MB | ~64 bytes |
/// | 1M base + 10 appends | 16 MB | ~80 bytes |
/// | 1M base + 100 inserts | 16 MB | ~1.6 KB |
#[derive(Clone, Debug)]
pub struct CompositeIndexSet {
    /// Segments in logical order.
    segments: Vec<Segment>,
    /// Cached total length for O(1) len().
    cached_len: usize,
}

impl CompositeIndexSet {
    /// Create from a simple spread (no mutations).
    pub fn from_spread(spread: Spread) -> Self {
        let len = spread.len();
        if spread.is_empty() { return Self::empty(); }
        Self { segments: vec![Segment::Base { spread }], cached_len: len }
    }

    /// Create from an IndexSet, preserving permutation if present.
    /// This is the primary constructor for mutation operations on existing views.
    pub fn from_index_set(index_set: &IndexSet) -> Self {
        match index_set {
            IndexSet::Ordered(spread) => Self::from_spread(spread.clone()),
            IndexSet::Permuted { spread, perm, .. } => {
                // Create a PermutedBase segment - preserves the ordering
                let segment = Segment::PermutedBase {
                    spread: spread.clone(),
                    perm: Arc::new(perm.clone()),  // Wrap in Arc for sharing
                    perm_start: 0,
                    perm_len: perm.len(),
                };
                Self { segments: vec![segment], cached_len: perm.len() }
            }
        }
    }

    pub fn empty() -> Self {
        Self { segments: Vec::new(), cached_len: 0 }
    }

    #[inline]
    pub fn len(&self) -> usize { self.cached_len }

    /// Get virtual index at logical position. O(S) where S = segment count.
    pub fn get(&self, logical_pos: usize) -> Option<VirtualIndex> {
        if logical_pos >= self.cached_len { return None; }
        let mut remaining = logical_pos;
        for segment in &self.segments {
            let seg_len = segment.len();
            if remaining < seg_len { return segment.get(remaining); }
            remaining -= seg_len;
        }
        None
    }

    /// Append trees. O(1) - just adds or extends a segment.
    /// Works the same regardless of whether existing segments are permuted.
    pub fn appending(&self, append_start: usize, count: usize) -> Self {
        if count == 0 { return self.clone(); }
        let mut new_segments = self.segments.clone();

        // Try to extend existing Appended segment at the end
        if let Some(Segment::Appended { start_offset, count: existing }) =
            new_segments.last_mut()
        {
            if *start_offset + *existing == append_start {
                *existing += count;
                return Self { segments: new_segments, cached_len: self.cached_len + count };
            }
        }

        new_segments.push(Segment::Appended { start_offset: append_start, count });
        Self { segments: new_segments, cached_len: self.cached_len + count }
    }

    /// Remove elements at logical positions.
    /// For permuted segments, this preserves the permutation order of remaining elements.
    ///
    /// # Complexity
    /// O(K * log(K) + S) where K = positions to remove, S = segment count
    pub fn removing(&self, logical_positions: &[usize]) -> Result<Self, PipelineError> {
        if logical_positions.is_empty() { return Ok(self.clone()); }

        // Sort and dedup positions
        let mut positions: Vec<usize> = logical_positions.to_vec();
        positions.sort_unstable();
        positions.dedup();

        // Validate bounds
        if let Some(&max) = positions.last() {
            if max >= self.cached_len {
                return Err(PipelineError::IndexOutOfBounds { index: max, count: self.cached_len });
            }
        }

        // Process segments, tracking cumulative offset
        let mut new_segments = Vec::new();
        let mut pos_idx = 0;
        let mut cumulative_offset = 0usize;
        let mut removed_count = 0usize;

        for segment in &self.segments {
            let seg_len = segment.len();
            let seg_start = cumulative_offset;
            let seg_end = seg_start + seg_len;

            // Find positions within this segment
            let mut segment_removals: Vec<usize> = Vec::new();
            while pos_idx < positions.len() && positions[pos_idx] < seg_end {
                if positions[pos_idx] >= seg_start {
                    segment_removals.push(positions[pos_idx] - seg_start);
                }
                pos_idx += 1;
            }

            if segment_removals.is_empty() {
                new_segments.push(segment.clone());
            } else if let Some(new_seg) = segment.removing(&segment_removals) {
                new_segments.push(new_seg);
            }
            removed_count += segment_removals.len();
            cumulative_offset = seg_end;
        }

        Ok(Self { segments: new_segments, cached_len: self.cached_len - removed_count })
    }

    /// Insert trees at a logical position.
    /// Preserves permutation order - inserted trees appear at the specified position.
    ///
    /// # Complexity
    /// O(S) where S = segment count
    pub fn inserting(&self, logical_pos: usize, count: usize) -> Result<Self, PipelineError> {
        if count == 0 { return Ok(self.clone()); }
        if logical_pos > self.cached_len {
            return Err(PipelineError::IndexOutOfBounds { index: logical_pos, count: self.cached_len });
        }

        let mut new_segments = Vec::new();
        let mut cumulative_offset = 0usize;
        let mut inserted = false;

        for segment in &self.segments {
            let seg_len = segment.len();
            let seg_end = cumulative_offset + seg_len;

            if !inserted && logical_pos <= seg_end {
                if logical_pos == cumulative_offset {
                    // Insert before this segment
                    new_segments.push(Segment::Inserted { position: logical_pos, count });
                    new_segments.push(segment.clone());
                    inserted = true;
                } else if logical_pos == seg_end {
                    // Insert after this segment
                    new_segments.push(segment.clone());
                    new_segments.push(Segment::Inserted { position: logical_pos, count });
                    inserted = true;
                } else {
                    // Split this segment - O(1) for PermutedBase (just adjusts offsets)
                    let split_point = logical_pos - cumulative_offset;
                    let (before, after) = segment.split_at(split_point);
                    if let Some(b) = before { new_segments.push(b); }
                    new_segments.push(Segment::Inserted { position: logical_pos, count });
                    if let Some(a) = after { new_segments.push(a); }
                    inserted = true;
                }
            } else {
                new_segments.push(segment.clone());
            }
            cumulative_offset = seg_end;
        }

        if !inserted {
            new_segments.push(Segment::Inserted { position: logical_pos, count });
        }

        Ok(Self { segments: new_segments, cached_len: self.cached_len + count })
    }

    /// Check if this is just a simple spread (no appends/inserts/permutations).
    pub fn as_spread(&self) -> Option<&Spread> {
        match self.segments.as_slice() {
            [Segment::Base { spread }] => Some(spread),
            [] => Some(&Spread::EMPTY),
            _ => None,
        }
    }
}
```

### Materialization Strategy

**Operations that trigger materialization** (need to evaluate tree content):
- Filter with complex predicates
- Sort (needs to compare tree values)
- Aggregate (needs to access tree values)
- GroupBy/IndexBy

**Operations that do NOT require materialization** (work on indices):
- Head/Tail - just truncate indices
- Take - subset of indices
- Sample/Shuffle - reorder indices
- Iteration - CompositeSource implements TreeSource

**Auto-materialization in execution:**

```rust
fn materialize_if_needed(
    result: &PhysicalResult,
    next_op: &QueryPlan,
) -> Result<PhysicalResult, PipelineError> {
    match (result, next_op) {
        // Filter after composite -> materialize first
        (PhysicalResult::Composite { .. }, QueryPlan::Filter { .. }) => {
            let arbor = materialize_composite(result)?;
            Ok(PhysicalResult::InMemory {
                arbor,
                indices: Spread::full(arbor.num_trees()),
            })
        }
        // Sort after composite -> materialize first
        (PhysicalResult::Composite { .. }, QueryPlan::Sort { .. }) => {
            let arbor = materialize_composite(result)?;
            Ok(PhysicalResult::InMemory {
                arbor,
                indices: Spread::full(arbor.num_trees()),
            })
        }
        _ => Ok(result.clone()),
    }
}
```

### Preserving Permutation Order Through Mutations

**Invariant**: Mutations on permuted views (sorted/shuffled) preserve the logical ordering of remaining elements.

| Mutation | Input Type | Output Type | Ordering Preserved? |
|----------|------------|-------------|---------------------|
| `remove(indices)` | Ordered | `IndexSet::Ordered(Spread)` | N/A (no permutation) |
| `remove(indices)` | Permuted | `CompositeIndexSet` with `PermutedBase` | **Yes** |
| `set(idx, tree)` | Any | `Composite` (same indices, replacement in layer) | **Yes** |
| `insert(pos, trees)` | Ordered | `CompositeIndexSet` (split Base, add Inserted) | N/A |
| `insert(pos, trees)` | Permuted | `CompositeIndexSet` (split PermutedBase, add Inserted) | **Yes** (but no longer "sorted by X") |
| `append(trees)` | Any | `CompositeIndexSet` (add Appended segment) | **Yes** |

**Why this matters:**

```python
# User expectation: sorted order preserved through remove
sorted_arbor = arbor.sort_by(path("score"))
top_10 = sorted_arbor.head(10).remove(0)  # Remove highest scorer
# top_10 should still be sorted by score, just without element 0

# Without permutation preservation, remove(0) would lose sort order
```

**Complexity Analysis:**

| Operation | Ordered Input | Permuted Input | Notes |
|-----------|---------------|----------------|-------|
| `remove(K indices)` | O(K + stretches) | O(K) perm rebuild | Rebuilds perm slice, not full N |
| `set(1 index)` | O(1) | O(1) | Just adds to replacements map |
| `insert(K trees)` | O(segments) | O(segments) | Split via `split_at()` is O(1) |
| `append(K trees)` | O(1) | O(1) | Extends/adds Appended segment |
| `get(i)` | O(segments) | O(segments) | Linear scan through segments |
| `len()` | O(1) | O(1) | Cached |

**Memory Analysis:**

| Scenario | Memory |
|----------|--------|
| 1M permuted base | O(1M) for perm (unavoidable) |
| 1M permuted + 1 removal | O(perm_slice) - rebuild affected slice |
| 1M permuted + 1 append | O(1M + 1 segment) - shares perm via Arc |
| 1M permuted + 1 insert | O(1M + 2 segments) - split shares Arc |
| 1M ordered + K mutations | O(stretches + segments) |

The permutation array is inherently O(N), but we share it via `Arc` and slice into it rather than copying.

### Implementation Notes (v1 Simplifications)

**1. `PermutedBase::removing()` uses HashSet:**

The current design iterates `0..perm_len` and filters via `HashSet<usize>` of local offsets. This is O(K) for small K but has hash overhead. For large K, a linear merge with sorted `local_offsets` would be faster. Not required for v1 correctness; optimize later if profiling shows need.

**2. `Appended`/`Inserted` removal semantics:**

The plan hand-waves removal from `Appended`/`Inserted` segments ("assume contiguous removal"). For v1, document that:
- `remove()` on appended/inserted elements uses a fallback that may allocate O(K) for segment-local tracking
- A true "holes" representation or materialize-to-explicit-list can be added in v2 if needed

These simplifications keep v1 implementation tractable while identifying future optimization opportunities.

### Critical Test Checkpoints

**Phase 0 (after IndexSet semantics change):**
- `get_backing_index()` correctness for Permuted variant
- `to_vec()` correctness (must go through spread, not return perm directly)
- `PlanBasedIter` yields trees in expected permuted order

**Phase 1-2 (mutation implementation):**
- `arbor.sort_by(...).remove(0)` preserves sorted order of remaining elements
- `arbor.shuffle().remove([0,1,2])` preserves shuffled order of remaining elements
- `arbor.sort_by(...).insert(0, tree)` puts tree at position 0, rest still in sorted order

These tests catch 95% of likely regressions from the permutation-preservation changes.

---

## Phase 2: Implementation Steps

### Step 2.1: Add Core Types

**File:** `crates/arbors-planner/src/composite.rs` (new)

```rust
//! Composite source support for multi-source mutations.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use arbors_storage::InMemoryArbor;
use crate::{Spread, PipelineError, OwnedTree};

/// Virtual index referencing base or mutation data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VirtualIndex {
    Base(usize),
    Appended(usize),
    Inserted { position: usize, offset: usize },
}

/// A layer of mutations applied to a base.
#[derive(Clone, Default)]
pub struct MutationLayer {
    pub appends: Vec<OwnedTree>,
    pub removals: HashSet<usize>,
    pub replacements: HashMap<usize, OwnedTree>,
    pub insertions: BTreeMap<usize, Vec<OwnedTree>>,
}

impl MutationLayer {
    pub fn is_empty(&self) -> bool {
        self.appends.is_empty()
            && self.removals.is_empty()
            && self.replacements.is_empty()
            && self.insertions.is_empty()
    }
}

// NOTE: CompositeIndexSet is defined above using the segment-based approach.
// See "3. CompositeIndexSet (Lazy Segment-Based)" section for full definition.
// Key point: NO Vec<VirtualIndex> flattening - uses Segment::Base/Appended/Inserted.
```

### Step 2.2: Add QueryPlan Mutation Variants

**File:** `crates/arbors-planner/src/query_plan.rs`

**Note**: Trees are stored in `Arc<Vec<OwnedTree>>` to avoid expensive cloning during optimization passes. The optimizer clones `Arc<QueryPlan>` frequently, and `Arc::clone` is O(1).

```rust
// Add to QueryPlan enum:

// ========================================================================
// Mutation nodes (v1: single-root mutations)
// ========================================================================

/// Append trees to the end.
Append {
    source: Arc<QueryPlan>,
    /// Trees to append. Arc-wrapped to avoid clone cost during optimization.
    trees: Arc<Vec<OwnedTree>>,
},

/// Insert trees at a position.
Insert {
    source: Arc<QueryPlan>,
    /// Position to insert at (logical index).
    position: usize,
    /// Trees to insert. Arc-wrapped for cheap cloning.
    trees: Arc<Vec<OwnedTree>>,
},

/// Replace tree at index.
Set {
    source: Arc<QueryPlan>,
    /// Index to replace (logical index).
        index: usize,
    /// Replacement tree. Arc-wrapped for cheap cloning.
    tree: Arc<OwnedTree>,
},

/// Remove trees at indices.
Remove {
    source: Arc<QueryPlan>,
    /// Indices to remove (logical indices, will be converted to backing).
    indices: Arc<Vec<usize>>,
},

// ========================================================================
// Mutation nodes (v1.5: concat-as-append, deferred to after v1)
// ========================================================================

// NOTE: True binary Concat node is deferred to v2.
// In v1.5, concat materializes RHS and becomes Append:
//   arbor.concat(other) -> arbor.append(other.materialize().trees())
// This avoids binary-node blast radius in traversal/optimizer.
```

### Step 2.3: Add PhysicalResult::Composite

**File:** `crates/arbors-planner/src/physical.rs`

```rust
// Add to PhysicalResult enum:

/// Composite result with mutations layered on base.
/// Must be materialized before content-sensitive operations.
Composite {
    /// Base physical result
    base: Box<PhysicalResult>,
    /// Mutation layer
    layer: MutationLayer,
    /// Virtual indices in logical order
    indices: CompositeIndexSet,
},
```

### Step 2.4: Implement Mutation Execution

**File:** `crates/arbors-planner/src/physical.rs`

**CRITICAL**: Mutation operations receive **logical indices** but `Spread::excluding()` operates on **backing indices**. Always convert using `spread.to_backing_indices()`.

```rust
// In execute_plan_node() match:

QueryPlan::Append { source, trees } => {
    let source_result = execute_plan_node(source, txn)?;

    if trees.is_empty() {
        return Ok(source_result);
    }

    let layer = MutationLayer {
        appends: Arc::clone(trees),
        ..Default::default()
    };

    // Build composite index set using SEGMENT-BASED approach (O(1), not O(N))
    let indices = match &source_result {
        PhysicalResult::Indices(index_set) => {
            // Convert IndexSet to Spread, then create segmented composite
            let spread = index_set.to_ordered_spread();
            // O(1): just adds an Appended segment, no flattening
            CompositeIndexSet::from_spread(spread).appending(0, trees.len())
        }
        PhysicalResult::Composite { indices: existing, layer: existing_layer, .. } => {
            // Already composite: extend with more appends
            let existing_appends = existing_layer.appends.len();
            // O(1): extends or adds Appended segment
            existing.appending(existing_appends, trees.len())
        }
        _ => {
            // Materialize other variants first
            let spread = source_result.to_ordered_spread()?;
            CompositeIndexSet::from_spread(spread).appending(0, trees.len())
        }
    };

    Ok(PhysicalResult::Composite {
        base: Box::new(source_result),
        layer,
        indices,
    })
}

QueryPlan::Remove { source, indices: logical_positions } => {
    let source_result = execute_plan_node(source, txn)?;

    match &source_result {
        PhysicalResult::Indices(index_set) => {
            match index_set {
                IndexSet::Ordered(spread) => {
                    // Ordered: convert logical to backing, then exclude
                    let backing = spread.to_backing_indices(logical_positions);
                    let kept = spread.excluding(&backing);
                    Ok(PhysicalResult::Indices(IndexSet::Ordered(kept)))
                }
                IndexSet::Permuted { .. } => {
                    // IMPORTANT: Preserve permutation order through removal!
                    // Build CompositeIndexSet which handles permuted segments correctly
                    let composite = CompositeIndexSet::from_index_set(index_set);
                    let removed = composite.removing(logical_positions)?;
                    Ok(PhysicalResult::CompositeIndices(removed))
                }
            }
        }
        PhysicalResult::CompositeIndices(composite) => {
            // Already composite: use segment-based removal (preserves permutation)
            let removed = composite.removing(logical_positions)?;
            Ok(PhysicalResult::CompositeIndices(removed))
        }
        PhysicalResult::Composite { base, layer, indices } => {
            // For composite with layer: use segment-based removal
            let new_indices = indices.removing(logical_positions)?;
            Ok(PhysicalResult::Composite {
                base: base.clone(),
                layer: layer.clone(),
                indices: new_indices,
            })
        }
        _ => {
            // Materialize other variants first
            let index_set = source_result.to_index_set()?;
            // Recurse with the extracted index_set
            // (In real code, factor out to avoid recursion)
            let composite = CompositeIndexSet::from_index_set(&index_set);
            let removed = composite.removing(logical_positions)?;
            Ok(PhysicalResult::CompositeIndices(removed))
        }
    }
}

QueryPlan::Set { source, index: logical_pos, tree } => {
    let source_result = execute_plan_node(source, txn)?;

    match &source_result {
        PhysicalResult::Indices(index_set) => {
            // Use IndexSet-level conversion (handles Ordered AND Permuted)
            let backing_idx = index_set.get_backing_index(*logical_pos)
                .ok_or_else(|| PipelineError::IndexOutOfBounds {
                    index: *logical_pos,
                    count: index_set.len(),
                })?;

            let mut replacements = HashMap::new();
            replacements.insert(backing_idx, Arc::clone(tree));

            let layer = MutationLayer {
                replacements: Arc::new(replacements),
                ..Default::default()
            };

            // Segmented index set (same length, O(1))
            let spread = index_set.to_ordered_spread();
            let indices = CompositeIndexSet::from_spread(spread);

            Ok(PhysicalResult::Composite {
                base: Box::new(source_result.clone()),
                layer,
                indices,
            })
        }
        PhysicalResult::Composite { .. } => {
            // Composite case: add replacement to layer
            todo!("set on composite - extend layer")
        }
        _ => {
            // Materialize other variants first
            let index_set = source_result.to_index_set()?;
            let backing_idx = index_set.get_backing_index(*logical_pos)
                .ok_or_else(|| PipelineError::IndexOutOfBounds {
                    index: *logical_pos,
                    count: index_set.len(),
                })?;

            let mut replacements = HashMap::new();
            replacements.insert(backing_idx, Arc::clone(tree));

            let layer = MutationLayer {
                replacements: Arc::new(replacements),
                ..Default::default()
            };

            let spread = index_set.to_ordered_spread();
            let indices = CompositeIndexSet::from_spread(spread);

            Ok(PhysicalResult::Composite {
                base: Box::new(source_result.clone()),
                layer,
                indices,
            })
        }
    }
}

// Insert is similar - use index_set.get_backing_index() for position mapping
```

### Step 2.5: Implement CompositeSource TreeSource

**File:** `crates/arbors-planner/src/composite.rs`

```rust
impl CompositeSource {
    /// Get a tree by virtual index.
    pub fn get_tree(&self, vidx: VirtualIndex) -> Result<OwnedTree, PipelineError> {
        match vidx {
            VirtualIndex::Base(idx) => self.get_base_tree(idx),
            VirtualIndex::Appended(idx) => Ok(self.layer.appends[idx].clone()),
            VirtualIndex::Inserted { position, offset } => {
                Ok(self.layer.insertions[&position][offset].clone())
            }
        }
    }

    fn get_base_tree(&self, idx: usize) -> Result<OwnedTree, PipelineError> {
        // Check replacements first
        if let Some(replacement) = self.layer.replacements.get(&idx) {
            return Ok(replacement.clone());
        }
        // Get from base source
        self.base.get_tree(idx)
    }
}
```

### Step 2.6: Update Arbor Handle

**File:** `crates/arbors/src/handle.rs`

**Note**: All collections are Arc-wrapped for cheap cloning during optimization.

```rust
impl Arbor {
    /// Append trees to the end, returning a new Arbor.
    pub fn append<I>(&self, trees: I) -> Result<Self, PipelineError>
    where
        I: IntoIterator<Item = OwnedTree>,
    {
        let trees: Vec<_> = trees.into_iter().collect();
        if trees.is_empty() {
            return Ok(self.clone());
        }

        let new_plan = Arc::new(QueryPlan::Append {
            source: Arc::clone(&self.plan),
            trees: Arc::new(trees),  // Arc-wrapped
        });
        Ok(self.with_plan(new_plan))
    }

    /// Concatenate another arbor, returning a new Arbor.
    ///
    /// v1.5 implementation: Materializes RHS and uses append internally.
    /// True lazy concat (v2) requires binary-node support in optimizer.
    pub fn concat(&self, other: &Self) -> Result<Self, PipelineError> {
        // Materialize RHS to get trees
        // Note: iter() returns iterator directly, not Result
        let other_trees: Vec<OwnedTree> = other
            .iter()
            .map(|t| t.to_owned())
            .collect();

        // Delegate to append
        self.append(other_trees)
    }

    /// Insert trees at position, returning a new Arbor.
    /// Position is a logical index (0 = first, len() = append at end).
    pub fn insert<I>(&self, position: usize, trees: I) -> Result<Self, PipelineError>
    where
        I: IntoIterator<Item = OwnedTree>,
    {
        let trees: Vec<_> = trees.into_iter().collect();
        let len = self.len()?;

        if position > len {
            return Err(PipelineError::IndexOutOfBounds { index: position, count: len });
        }

        let new_plan = Arc::new(QueryPlan::Insert {
            source: Arc::clone(&self.plan),
            position,
            trees: Arc::new(trees),  // Arc-wrapped
        });
        Ok(self.with_plan(new_plan))
    }

    /// Replace tree at logical index, returning a new Arbor.
    pub fn set(&self, index: usize, tree: OwnedTree) -> Result<Self, PipelineError> {
        let len = self.len()?;
        if index >= len {
            return Err(PipelineError::IndexOutOfBounds { index, count: len });
        }

        let new_plan = Arc::new(QueryPlan::Set {
            source: Arc::clone(&self.plan),
            index,
            tree: Arc::new(tree),  // Arc-wrapped
        });
        Ok(self.with_plan(new_plan))
    }

    /// Remove trees at logical indices, returning a new Arbor.
    pub fn remove(&self, indices: &[usize]) -> Result<Self, PipelineError> {
        let len = self.len()?;
        for &idx in indices {
            if idx >= len {
                return Err(PipelineError::IndexOutOfBounds { index: idx, count: len });
            }
        }

        let new_plan = Arc::new(QueryPlan::Remove {
            source: Arc::clone(&self.plan),
            indices: Arc::new(indices.to_vec()),  // Arc-wrapped
        });
        Ok(self.with_plan(new_plan))
    }
}
```

### Step 2.7: Add Python Bindings

**File:** `python/src/lib.rs`

Add to existing `#[pymethods]` block for Arbor:

```rust
    /// Append a tree, returning a new Arbor.
    fn append(&self, py: Python<'_>, tree: &Tree) -> PyResult<Py<Arbor>> {
        self.check_thread_affinity()?;
        let owned = tree.to_owned_tree()?;
    let result = self.inner.append(std::iter::once(owned))
            .map_err(pipeline_error_to_py_err)?;
        Py::new(py, Arbor::from_inner(result))
    }

    /// Concatenate another Arbor, returning a new Arbor.
    ///
/// v1.5 implementation: This materializes the other arbor and appends
/// its trees. For large arbors, consider if this cost is acceptable.
    fn concat(&self, py: Python<'_>, other: &Arbor) -> PyResult<Py<Arbor>> {
        self.check_thread_affinity()?;
        other.check_thread_affinity()?;
    // Note: concat() internally materializes RHS and delegates to append
        let result = self.inner.concat(&other.inner)
            .map_err(pipeline_error_to_py_err)?;
        Py::new(py, Arbor::from_inner(result))
    }

    /// Remove tree at index, returning a new Arbor.
/// Supports negative indexing.
    fn remove(&self, py: Python<'_>, index: isize) -> PyResult<Py<Arbor>> {
        self.check_thread_affinity()?;
    let len = self.inner.len().map_err(pipeline_error_to_py_err)?;
    let actual_index = normalize_python_index(index, len)?;
    let result = self.inner.remove(&[actual_index])
            .map_err(pipeline_error_to_py_err)?;
        Py::new(py, Arbor::from_inner(result))
    }

    /// Replace tree at index, returning a new Arbor.
    /// Supports negative indexing.
    #[pyo3(signature = (index, tree))]
    fn set(&self, py: Python<'_>, index: isize, tree: &Tree) -> PyResult<Py<Arbor>> {
        self.check_thread_affinity()?;
    let len = self.inner.len().map_err(pipeline_error_to_py_err)?;
    let actual_index = normalize_python_index(index, len)?;
        let owned = tree.to_owned_tree()?;
    let result = self.inner.set(actual_index, owned)
            .map_err(pipeline_error_to_py_err)?;
        Py::new(py, Arbor::from_inner(result))
    }

    /// Insert tree at index, returning a new Arbor.
/// Supports negative indexing.
    #[pyo3(signature = (index, tree))]
    fn insert(&self, py: Python<'_>, index: isize, tree: &Tree) -> PyResult<Py<Arbor>> {
        self.check_thread_affinity()?;
    let len = self.inner.len().map_err(pipeline_error_to_py_err)?;
    // For insert, index can be 0..=len
    let actual_index = if index < 0 {
        let pos = (-index) as usize;
        if pos > len { return Err(PyIndexError::new_err("index out of range")); }
        len - pos
    } else {
        let idx = index as usize;
        if idx > len { return Err(PyIndexError::new_err("index out of range")); }
        idx
    };
        let owned = tree.to_owned_tree()?;
    let result = self.inner.insert(actual_index, std::iter::once(owned))
            .map_err(pipeline_error_to_py_err)?;
        Py::new(py, Arbor::from_inner(result))
    }

/// Python-only: parse JSON and append as a new tree.
    fn append_json(&self, py: Python<'_>, json_str: &str) -> PyResult<Py<Arbor>> {
        self.check_thread_affinity()?;
        let parsed = crate::read_json_impl(json_str, None)?;
    let tree = parsed.get(0).map_err(pipeline_error_to_py_err)?
        .ok_or_else(|| PyValueError::new_err("No tree in JSON"))?;
    let result = self.inner.append(std::iter::once(tree))
            .map_err(pipeline_error_to_py_err)?;
        Py::new(py, Arbor::from_inner(result))
    }

/// Python-only: convert dict and append as a new tree.
    fn append_dict(&self, py: Python<'_>, data: &Bound<'_, PyAny>) -> PyResult<Py<Arbor>> {
        self.check_thread_affinity()?;
        let tree = crate::py_to_owned_tree(data)?;
    let result = self.inner.append(std::iter::once(tree))
            .map_err(pipeline_error_to_py_err)?;
        Py::new(py, Arbor::from_inner(result))
}

fn normalize_python_index(index: isize, len: usize) -> PyResult<usize> {
    if index >= 0 {
        let idx = index as usize;
        if idx >= len {
            return Err(PyIndexError::new_err("index out of range"));
        }
        Ok(idx)
    } else {
        let pos = (-index) as usize;
        if pos > len {
            return Err(PyIndexError::new_err("index out of range"));
        }
        Ok(len - pos)
    }
}
```

---

## Phase 3: Tests

### Rust Integration Tests

**File:** `crates/arbors/tests/integration/mutation_tests.rs`

```rust
#[test]
fn test_append_returns_new_arbor() {
    let arbor = read_jsonl(r#"{"a":1}
{"a":2}"#).unwrap();
    let tree = read_json(r#"{"a":3}"#).unwrap().get(0).unwrap();

    let arbor2 = arbor.append(std::iter::once(tree)).unwrap();

    assert_eq!(arbor.len().unwrap(), 2);   // Original unchanged
    assert_eq!(arbor2.len().unwrap(), 3);  // New has extra tree
}

#[test]
fn test_concat_combines_arbors() {
    let a = read_jsonl(r#"{"x":1}
{"x":2}"#).unwrap();
    let b = read_jsonl(r#"{"x":3}
{"x":4}"#).unwrap();

    let combined = a.concat(&b).unwrap();

    assert_eq!(a.len().unwrap(), 2);       // Original unchanged
    assert_eq!(combined.len().unwrap(), 4);
}

#[test]
fn test_mutation_then_filter_materializes() {
    let arbor = read_jsonl(r#"{"n":1}
{"n":2}"#).unwrap();
    let tree = read_json(r#"{"n":3}"#).unwrap().get(0).unwrap();

    // Append then filter - should trigger materialization
    let result = arbor
        .append(std::iter::once(tree)).unwrap()
        .filter(&path("n").gt(lit(1)), FilterMode::Immediate).unwrap();

    assert_eq!(result.len().unwrap(), 2);  // n=2 and n=3
}

#[test]
fn test_chaining_mutations_with_queries() {
    let data = r#"{"active":true,"n":1}
{"active":false,"n":2}
{"active":true,"n":3}"#;
    let arbor = read_jsonl(data).unwrap();
    let extra = read_json(r#"{"active":true,"n":4}"#).unwrap().get(0).unwrap();

    let result = arbor
        .filter(&path("active").eq(lit(true)), FilterMode::Immediate).unwrap()
        .append(std::iter::once(extra)).unwrap()
        .head(2).unwrap();

    assert_eq!(arbor.len().unwrap(), 3);   // Original unchanged
    assert_eq!(result.len().unwrap(), 2);
}
```

### Python Tests

**File:** `python/tests/test_arbor_mutations.py`

```python
class TestArborMutations:
    def test_append_returns_new_arbor(self):
        arbor = arbors.read_jsonl('{"a":1}\n{"a":2}')
        tree = arbors.read_json('{"a":3}')[0]

        arbor2 = arbor.append(tree)

        assert len(arbor) == 2   # Original unchanged
        assert len(arbor2) == 3  # New has extra

    def test_concat_combines(self):
        a = arbors.read_jsonl('{"x":1}\n{"x":2}')
        b = arbors.read_jsonl('{"x":3}\n{"x":4}')

        combined = a.concat(b)

        assert len(a) == 2
        assert len(combined) == 4

    def test_chaining_mutations_and_queries(self):
        arbor = arbors.read_jsonl('{"n":1}\n{"n":2}\n{"n":3}')
        extra = arbors.read_json('{"n":4}')[0]

        result = (
            arbor
            .filter(path("n") > 1)
            .append(extra)
            .head(2)
        )

        assert len(result) == 2

    def test_remove_by_index(self):
        arbor = arbors.read_jsonl('{"i":0}\n{"i":1}\n{"i":2}')

        arbor2 = arbor.remove(1)

        assert len(arbor) == 3
        assert len(arbor2) == 2

    def test_remove_negative_index(self):
        arbor = arbors.read_jsonl('{"i":0}\n{"i":1}\n{"i":2}')

        arbor2 = arbor.remove(-1)  # Remove last

        assert len(arbor2) == 2
```

---

## Phase 21.1: Stabilization Patch Plan (Correctness + Predictable Performance)

Phase 21 got the **core architecture** in place (`Spread`, `CompositeIndexSet`, `CompositeSource`, mutation plan nodes). During implementation review, we found a small set of **blocking correctness and ergonomics gaps** that should be fixed *before* proceeding to Phase 4 (mutation elision) or larger refactors (Rust `ops/`, Python `arbor_ops/`).

### Goals

- **Correctness**: mutated arbors behave like lists in logical order across `iter()`, `get()`, and all mutation methods.
- **Chainability**: `append/insert/set/remove/concat` can be chained without execution-time “not implemented” errors.
- **Predictable performance**: avoid surprising full materialization on `iter()`/`get()` for common mutation chains; avoid obviously expensive fallbacks (e.g., per-tree JSON round-trips).
- **Consistency across backends**: in-memory and stored arbors behave the same (modulo I/O), and ordering invariants hold.
- **Stable tests**: no flakes under `cargo test` default parallelism.

### Non-goals (still deferred)

- True lazy binary `Concat` plan node (v2).
- Making `filter/sort/aggregate` run *without* materialization after mutations (Phase 21 intentionally materializes at those boundaries).
- Large refactors for cleanliness (Rust `ops/`, Python `arbor_ops/`) — those come after we lock down semantics.

---

### 21.1 Core data model corrections (applies to multiple items)

Phase 21 implementation revealed two subtle but critical modeling gaps. Phase 21.1 fixes these *first*, because they affect correctness and chainability across multiple items.

#### A) Insertions must be keyed by a stable identity, not a logical position

**Problem**: Modeling inserted trees as `Inserted { position, offset }` and storing them in `MutationLayer.insertions: BTreeMap<usize /* position */, Vec<OwnedTree>>` is not stable under chaining. The numeric `position` is in the logical coordinate space of the *current view*, and later mutations (especially insert/remove before that position) change what that `position` means (“position drift”).

**Fix (stable slot ids)**:
- Introduce a stable insertion slot identifier, allocated when an insertion is created:
  - `VirtualIndex::Inserted { slot: u64, offset: usize }`
  - `Segment::Inserted { slot: u64, start_offset: usize, offsets: Spread }`
  - `MutationLayer.insertions: HashMap<u64, Arc<Vec<OwnedTree>>>`
- `CompositeIndexSet` segments are the *only* structure that encodes where insertion output appears in the logical stream. The mutation layer stores the inserted trees keyed by `slot`, independent of position drift.

**Slot counter implementation**:
```rust
// In arbors-planner/src/composite.rs or similar
static NEXT_SLOT_ID: AtomicU64 = AtomicU64::new(0);

pub fn allocate_slot_id() -> u64 {
    NEXT_SLOT_ID.fetch_add(1, Ordering::Relaxed)
}
```

**Critical: Slot IDs are assigned at plan construction**, i.e., when building `QueryPlan::Insert`, not during execution:
- `QueryPlan::Insert` carries `slot: u64` (assigned when building the plan)
- Execution reads the slot from the plan node; it does **not** allocate IDs
- Optimizer cloning plans doesn't cause multiple allocations
- Plan structure is deterministic regardless of execution order
- The slot ID is stable across plan transformations

**Note on wrap-around**: u64 wrap-around is astronomically unlikely (18 quintillion insertions). No special handling required.

This makes chaining unambiguous:
- `insert(0, X).insert(0, Y)` is two slots; segments define their ordering.
- `insert(5, X).remove(0)` does not require shifting insertion keys.

#### B) Replacements must work for all virtual kinds (Base / Appended / Inserted)

**Problem**: `set()` must work on any logical position, which may resolve to:
- a base tree (`VirtualIndex::Base(i)`),
- an appended tree (`VirtualIndex::Appended(j)`), or
- an inserted tree (`VirtualIndex::Inserted { slot, offset }`).

Since appends/insertions are stored in immutable `Arc<Vec<OwnedTree>>` collections, we cannot “edit them in place”. We need a replacement overlay keyed by virtual identity.

**Fix (virtual replacement overlay)**:
- Keep base replacements keyed by backing index:
  - `MutationLayer.base_replacements: HashMap<usize, Arc<OwnedTree>>`
- Add a replacement overlay for non-base virtual indices:
  - `MutationLayer.virtual_replacements: HashMap<VirtualKey, Arc<OwnedTree>>`
  - where `VirtualKey` is a stable key for appended/inserted entries:
    - `Appended(j)`
    - `Inserted { slot, offset }`

**Resolution order in CompositeSource**:
1. If virtual_replacement exists for this virtual key, return it.
2. Else if base replacement exists (Base only), return it.
3. Else return underlying base/appended/inserted tree.

This is the minimal, uniform model that makes `set()` correct and chainable everywhere.

#### C) Composites are flattened, not nested (hard requirement)

**Problem**: Chained mutations like `append(tree1).append(tree2).remove(1)` could produce nested structures:
```rust
Composite { base: Composite { base: ..., layer1 }, layer2 }
```

This complicates caching, `get()`, lazy iteration, and replacement resolution.

**Requirement**: **Flatten at execution time**. Chained mutations produce a **single** `PhysicalResult::Composite { base, layer, indices }` with a merged layer:
- When executing a mutation on an existing `Composite` result, **extend** the existing layer rather than wrapping.
- `append` on `Composite` → add to existing `layer.appends`, update `indices`.
- `remove` on `Composite` → update `indices` only (see note below).
- `set` on `Composite` → update `layer.base_replacements` or `layer.virtual_replacements`.
- `insert` on `Composite` → add to `layer.insertions`, update `indices`.

**Note on removals**: `MutationLayer` does **not** have a `removals` field. Removal is fully represented by `CompositeIndexSet` segments/holes—indices that are removed simply don't appear in the index set. This is the simplest model with the fewest invariants to maintain.

This means:
- **One layer to consult** for resolution (no recursive descent).
- **Caching is simple**: `CachedSelection::Composite { indices, layer }` is sufficient.
- **Iteration walks one layer**, not a stack of layers.

---

### 21.1.1 Fix ordering bug in `CompositeIndices` materialization (**must-fix correctness**)

**Problem**: `CompositeIndices` exists specifically to preserve permutation order through mutations, but if its materialization path rebuilds an `IndexSet` via a sorted/dedup constructor, ordering is lost.

**Change**
- Update `materialize_composite_indices_base_only()` to preserve emission order:
  - Use `IndexSet::from_ordered_indices(backing_indices)` (or equivalent) instead of `from_unsorted` / `from_unsorted`-like constructors.
  - Maintain the invariant: **materialization order == logical order**.

**Files**
- `crates/arbors-planner/src/physical.rs`

**Minimal tests**
- Rust: `sort_by(...).remove(0)` then `iter()` yields remaining in sorted order.
- Rust: `shuffle(seed).remove([..])` then `iter()` yields remaining in shuffled order.
- Rust: `take([0, 0, 1])` then `iter()` yields duplicates in correct order (verifies `from_ordered_indices` path).

---

### 21.1.2 Make `Arbor::get()` work for Composite results (**must-fix correctness + ergonomics**)

**Problem**: `Arbor::get()` currently relies on caching an `IndexSet` (via `PhysicalResult::as_indices()`), which returns `None` for `Composite`/`CompositeIndices`. This breaks `get()` on mutated arbors (and Python `__getitem__` semantics by extension).

**Change**
- Extend `get()` to handle:
  - `PhysicalResult::Composite { layer, indices, .. }` by resolving the `VirtualIndex` at the logical position and fetching the tree from:
    - base (stored/in-memory) via backing index, **or**
    - mutation layer (appended/inserted/replaced).
  - `PhysicalResult::CompositeIndices(indices)` by mapping logical position to backing index and fetching from base.
- Cache the *resolved* index selection for subsequent `get()` calls (like existing `cached_indices`, but supporting composite).

**Files**
- `crates/arbors/src/handle.rs`
- `crates/arbors-planner/src/composite.rs` (if additional accessors/helpers are needed)

**Minimal tests**
- Rust: `append` + `get(last)` returns appended tree.
- Rust: `sort_by` + `remove(0)` + `get(0)` returns new first element in sorted order.
- Python: `append` + `__getitem__` works; negative indexing remains correct.

---

### 21.1.3 Fix `VirtualIndex::Base` coordinate space mismatch (**must-fix correctness, blocking 21.1.2**)

**Problem**: The current 21.1.2 implementation has a critical bug. When caching a `Composite` result for `get()`:

```rust
PhysicalResult::Composite { base, layer, indices } => {
    let base_arbor = materialize_result(&optimized, txn, &base)?;
    CachedSelection::Composite { base: base_arbor, layer, indices }
}
```

Later, when resolving `VirtualIndex::Base(backing_idx)`:

```rust
VirtualIndex::Base(backing_idx) => {
    self.get_tree_from_arbor(base, backing_idx)  // WRONG!
}
```

**The bug**: `VirtualIndex::Base(n)` represents a **backing index into the original source's address space**, not an index into the newly materialized arbor.

**Example that breaks** (gating test: `test_get_on_composite_with_sparse_base_indices`):
- Original arbor has 100 trees (indices 0..100)
- `take([50, 70])` creates a view with backing indices `[50, 70]`
- `append(tree)` creates `Composite { indices: [Base(50), Base(70), Appended(0)] }`
- `materialize_result(base)` materializes a **2-tree arbor** (positions 0 and 1)
- `get(0)` resolves to `VirtualIndex::Base(50)`, then calls `get_tree_from_arbor(base_arbor, 50)`
- **FAILS**: `IndexOutOfBounds { index: 50, count: 2 }`

**Root cause**: Materializing the base result compacts it into a new coordinate space (0..N), but `VirtualIndex::Base` values remain in the **original** coordinate space.

**Change**: Do NOT materialize the base for `get()`. Instead, resolve `VirtualIndex::Base(backing_idx)` through the **original plan's root source**, which preserves the backing coordinate space:

```rust
CachedSelection::Composite {
    // Do NOT store a materialized arbor here.
    // Store the information needed to resolve VirtualIndex values:
    root_source_info: RootSourceInfo,  // For VirtualIndex::Base resolution
    layer: Arc<MutationLayer>,         // For appends/insertions/replacements
    indices: CompositeIndexSet,        // For logical→virtual mapping
}
```

For `VirtualIndex::Base(backing_idx)`:
1. Check `layer.base_replacements` first
2. If not replaced, fetch from `root_source_info` using `backing_idx` (same path as non-composite `get()`)

For `VirtualIndex::Appended(j)` / `VirtualIndex::Inserted { slot, offset }`:
1. Check `layer.virtual_replacements` first
2. If not replaced, fetch from `layer.appends[j]` or `layer.insertions[slot][offset]`

**Performance benefit**: This also addresses the performance concern: `get()` no longer materializes the entire base for a single item access. Base trees are fetched on-demand through the existing batch-decode path.

**Files**
- `crates/arbors/src/handle.rs` (CachedSelection definition, get() resolution)
- `crates/arbors-planner/src/composite.rs` (accessors if needed)

**Gating test**: `test_get_on_composite_with_sparse_base_indices` in `crates/arbors/tests/integration/mutation_tests.rs` currently fails with `IndexOutOfBounds { index: 50, count: 2 }`. This test MUST pass after 21.1.3 is complete.

**Minimal tests**
- Rust: `take([50, 70]).append(tree).get(0)` returns tree at backing index 50 (not position 0 of a materialized slice)
- Rust: `filter(...).append(tree).get(n)` works for any valid n
- Rust: `sort_by(...).remove(0).get(0)` works (permuted base indices)

---

### 21.1.4 Correct `remove()` semantics for `Appended` / `Inserted` segments

**Problem**: A "just decrement count" implementation for removal on appended/inserted segments is only correct for very constrained cases (e.g., dropping from the end). It is not correct for arbitrary index removal.

**Change**
- Represent appended/inserted segment membership using `Spread` over **local offsets** to support holes:
  - `Segment::Appended { start_offset: usize, offsets: Spread }`
  - `Segment::Inserted { slot: u64, start_offset: usize, offsets: Spread }`
- Implement `Segment::removing()` for these variants using the same pattern as base:
  - Translate segment-local logical offsets to local backing offsets via `offsets.get()`
  - Call `offsets.excluding(...)` to create holes
- Ensure `split_at()/head()/tail()/take()` operate correctly by slicing these local-offset spreads.

**Slot-based insertion design** (critical for correctness):

Per section 21.1 A, insertions are keyed by a stable `slot: u64`, not by logical position:
- `VirtualIndex::Inserted { slot: u64, offset: usize }`
- `Segment::Inserted { slot: u64, start_offset: usize, offsets: Spread }`
- `MutationLayer.insertions: HashMap<u64, Arc<Vec<OwnedTree>>>`

Slot IDs are allocated at **plan construction time** (when building `QueryPlan::Insert`), not during execution. This ensures:
- Optimizer cloning doesn't cause multiple allocations
- Plan structure is deterministic regardless of execution order
- Position drift from later mutations doesn't break insertion identity

```rust
// In QueryPlan::Insert
Insert {
    source: Arc<QueryPlan>,
    slot: u64,           // Assigned at plan construction
    position: usize,     // Original logical position (for segment placement)
    trees: Arc<Vec<OwnedTree>>,
}
```

**Design rationale**: Using `Spread` for local offsets maintains consistency with the core index representation strategy. No ad-hoc alternatives like `HashSet<usize>` for "holes"—`Spread` is the unified approach for all index tracking throughout the system.

**Files**
- `crates/arbors-planner/src/composite.rs` (Segment types, CompositeIndexSet)
- `crates/arbors-planner/src/query_plan.rs` (QueryPlan::Insert with slot field)

**Minimal tests**
- Rust: append 3 trees, remove middle appended index, verify remaining appended trees' order and values.
- Rust: insert 3 trees, remove the middle inserted one, verify order and values.
- Rust: `insert(0, X).insert(0, Y)` creates two distinct slots; ordering is determined by segment order.

---

### 21.1.5 Implement `set()` on Composite and CompositeIndices (restore chainability)

**Problem**: Execution currently rejects `set()` on `Composite` and `CompositeIndices`, breaking chainability.

**Change**
- Define and implement `set()` for any logical position by resolving the `VirtualIndex`:
  - If `Base(i)`: update `layer.base_replacements[i]`.
  - If `Appended(j)`: update `layer.virtual_replacements[Appended(j)]`.
  - If `Inserted { slot, offset }`: update `layer.virtual_replacements[Inserted { slot, offset }]`.
- Update resolution order in `get()` (per 21.1.3) to consult replacement overlays for all virtual kinds.
- `set()` on `CompositeIndices` should produce a `Composite` result (same indices + new replacement layer).

**Split replacement design** (per section 21.1 B):

```rust
pub struct MutationLayer {
    /// Trees appended after the base
    pub appends: Arc<Vec<OwnedTree>>,

    /// Insertions keyed by stable slot ID
    pub insertions: HashMap<u64, Arc<Vec<OwnedTree>>>,

    /// Replacements for base trees (keyed by BACKING index)
    pub base_replacements: HashMap<usize, Arc<OwnedTree>>,

    /// Replacements for appended/inserted trees (keyed by virtual identity)
    pub virtual_replacements: HashMap<VirtualKey, Arc<OwnedTree>>,
}

/// Stable key for non-base virtual indices
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum VirtualKey {
    Appended(usize),
    Inserted { slot: u64, offset: usize },
}
```

**Resolution order in `get()` and iteration**:
1. Map logical position to `VirtualIndex` via `CompositeIndexSet`
2. For `Base(backing_idx)`:
   - Check `layer.base_replacements[backing_idx]`
   - If not found, fetch from root source using `backing_idx`
3. For `Appended(j)`:
   - Check `layer.virtual_replacements[Appended(j)]`
   - If not found, return `layer.appends[j]`
4. For `Inserted { slot, offset }`:
   - Check `layer.virtual_replacements[Inserted { slot, offset }]`
   - If not found, return `layer.insertions[slot][offset]`

**Note on removals**: `MutationLayer` does **not** have a `removals` field. Removal is fully represented by `CompositeIndexSet` segments/holes—indices that are removed simply don't appear in the index set. This is the simplest model.

**Files**
- `crates/arbors-planner/src/physical.rs` (mutation execution for Set on composite inputs)
- `crates/arbors-planner/src/composite.rs` (MutationLayer, VirtualKey, resolution logic)

**Minimal tests**
- Rust: `append(tree).set(last, new_tree).get(last)` yields `new_tree`.
- Rust: `insert(0, tree).set(0, new_tree).get(0)` yields `new_tree`.
- Rust: `sort_by(...).remove(0).set(0, new_tree)` preserves order and updates first element.
- Rust: `set(0, a).set(0, b).get(0)` yields `b` (replacement override).

---

### 21.1.6 Make iteration of mutated arbors lazy (remove eager composite materialization)

**Problem**: Current iteration path materializes `Composite`/`CompositeIndices` eagerly to an `InMemoryArbor` before iterating, which:
- Breaks the "lazy with strategic materialization" story for iteration,
- Forces full rebuild even for `head/take` of a composite,
- Makes `iter()` cost surprising and (often) too high.

**Dependency**: This item depends on 21.1.3 (coordinate space fix), 21.1.4 (segment types), and 21.1.5 (replacement resolution).

**Change**
- Extend `PlanBasedIter` to accept a `TreeSource` (including `CompositeSource`) plus an index selection abstraction (`IndexSet` or `CompositeIndexSet`):
  - Drive logical positions from `CompositeIndexSet` directly.
  - Resolve base trees lazily by batch (stored) or direct slice (in-memory), and merge with mutation-layer trees.
  - Preserve ordering for permuted segments.
  - Integrate with existing streaming budget mechanism.
- Keep materialization as the boundary for content-sensitive ops (`filter/sort/aggregate`) as in Phase 21.

**Note**: This is a brand-new library with zero external users. We are free to refactor `PlanBasedIter` as needed to build a proper architecture—there is no "destabilization risk" to worry about.

**Minimum viable execution strategy for stored bases** (no full materialization):
- Iterate logical positions in chunks based on streaming budget (e.g., `trees_per_batch`).
- For each chunk:
  - Scan the corresponding `CompositeIndexSet` slice and collect only the `VirtualIndex::Base(backing_idx)` entries for that slice.
  - Batch-group those backing indices (existing `BatchGroupedIndices`) and decode only the required batches once.
  - While emitting results for the slice, interleave:
    - base trees fetched from decoded batches,
    - appended trees from `MutationLayer.appends`,
    - inserted trees from `MutationLayer.insertions[slot]`,
    - replacements from `MutationLayer.base_replacements` / `MutationLayer.virtual_replacements`.

**Detailed batch-group strategy for mixed segments** (handles permuted/interleaved cases):

For a chunk of size B (budget) at logical offset L:
```
1. Partition the chunk's VirtualIndices into:
   - base_indices: Vec<(chunk_offset, backing_idx)>
   - appended_indices: Vec<(chunk_offset, append_idx)>
   - inserted_indices: Vec<(chunk_offset, slot, offset)>

2. For base_indices:
   - Batch-group by batch_idx = backing_idx / trees_per_batch
   - Decode each needed batch exactly once
   - Store results keyed by backing_idx in a local cache

3. Emit in chunk_offset order (0..B) by consulting:
   - base_indices: lookup in decoded batch cache by backing_idx
   - appended_indices: direct access from layer.appends[append_idx]
   - inserted_indices: direct access from layer.insertions[slot][offset]

4. For PermutedBase segments specifically:
   - The permutation array defines the logical->backing mapping
   - Batch-group over the *backing* indices (not logical order)
   - Re-emit in *logical* order after batch decoding
   - This preserves the permutation while minimizing batch decodes
```

**Memory accounting**: Appended/inserted trees count against the chunk budget (they're already in memory). The budget primarily governs batch decodes for stored bases.

**Files**
- `crates/arbors/src/handle.rs`
- `crates/arbors/src/lazy.rs` (or wherever `PlanBasedIter`/iteration plumbing lives)
- `crates/arbors-planner/src/composite.rs` (CompositeSource batching helpers as needed)

**Minimal tests**
- Rust: `append(...).head(1)` iterates without materializing full base.
- Rust: stored arbor + append + iter decodes batches incrementally (best-effort; see 21.1.9 for stats stability).

---

### 21.1.7 Align logical->backing conversion with plan (fail-fast at execution time)

**Problem**: mutation execution paths should not rely on unchecked conversions that silently skip invalid logical indices.

**Change**
- Implement the plan’s API in code: `IndexSet::to_backing_indices_for_mutation(&[usize]) -> Result<Vec<usize>, PipelineError>`.
- Use it in mutation execution for:
  - ordered and permuted removals (where appropriate),
  - set (already uses `get_backing_index`, keep it),
  - any other mutation that targets existing base elements by position.
- Keep `Spread::to_backing_indices()` explicitly documented as **unchecked** (or rename it to `unchecked_to_backing_indices()` if we want to prevent misuse).

**Files**
- `crates/arbors-planner/src/physical.rs`
- `crates/arbors-planner/src/spread.rs` (docs/rename if desired)

**Minimal tests**
- Rust: executing mutation plan nodes directly with out-of-bounds indices returns `IndexOutOfBounds` (not silent).

---

### 21.1.8 Eliminate per-tree JSON round-trips in composite materialization (**must-fix performance**)

**Problem**: the current composite materialization path serializes each tree to JSON and re-parses it. This is unacceptable—JSON round-trips are a complete non-starter for materialization performance.

**Hard rule**: **No JSON in production materialization paths.** JSON serialization/parsing is only permitted behind `cfg(test)` or debug validation tooling, never on the hot path.

**Change**
- Implement a direct materialization path that builds an `InMemoryArbor` from resolved trees without JSON:
  - Extend `ArborBuilder`/storage to ingest `OwnedTree` directly into a unified arena.
  - Add a dedicated "copy tree into builder" routine that traverses nodes and copies values directly, avoiding text conversion entirely.
- **Delete** the JSON fallback path entirely (not "remove once working"—there is no fallback).

**Implementation approach**:
```rust
impl ArborBuilder {
    /// Add a tree by direct node/value copying (no JSON).
    pub fn add_tree(&mut self, tree: &InMemoryArbor, tree_idx: usize) -> Result<(), Error> {
        // Traverse tree, copy nodes and values directly into pools
    }
}
```

**Files**
- `crates/arbors-planner/src/physical.rs`
- `crates/arbors-storage/src/builder.rs` (or equivalent builder location)
- `crates/arbors-io` (if builder lives there)

**Minimal tests**
- Rust: composite materialization produces equivalent JSON output to the previous approach (golden comparison).
- Rust: materialization of 1000+ trees completes in reasonable time (benchmark baseline).

---

### 21.1.9 Make ArborStore decode-stats tests stable under parallelism

**Problem**: tests that assert exact `batches_decoded` deltas can fail under intra-process parallel execution if other tests touch the same global counters.

**Change**
- Ensure all tests that:
  - call `reset_arborbase_stats()`, or
  - assert on `arborbase_stats()` deltas
  run with a shared lock / serial guard (cross-test).
- Important: these counters are **process-global**, so “best effort” deltas are inherently racy unless we serialize access.
- Options:
  - apply `#[serial]` broadly to all stats-sensitive tests in the `arbors` integration test binary, or
  - introduce a `StatsGuard` RAII lock in `arbors_base` (test-only feature) and use it in tests.

**Files**
- `crates/arbors/tests/integration/**` (stats tests)
- optionally `crates/arbors-base/src/**` (guard helper behind cfg(test) or a feature)

**Acceptance**
- `cargo test` passes reliably with default parallelism.

---

### 21.1.10 Unify caching strategy for composite results

**Problem**: `Arbor::get()` and `Arbor::len()` use `cached_indices: OnceLock<IndexSet>` which cannot hold `CompositeIndexSet`. When `as_indices()` returns `None` for composite results, the code falls back to an empty `IndexSet`, breaking both `get()` and `len()`.

**Change**
- Introduce a unified cache type that can hold either variant:
```rust
enum CachedSelection {
    Indices(IndexSet),
    CompositeIndices(CompositeIndexSet),
    Composite { indices: CompositeIndexSet, layer: Arc<MutationLayer> },
}
```
- Update `cached_indices` to use this type (or add a parallel `cached_composite` field).
- Ensure `len()` and `get()` work correctly for composite results by consulting `CompositeIndexSet::len()` and resolving through `MutationLayer`.

**Design consideration**: The `MutationLayer` contains `HashMap` and `BTreeMap` structures. Two approaches:

1. **Wrap in Arc** (recommended): Store `layer: Arc<MutationLayer>` in both the plan result and cache. Caching becomes a cheap Arc clone.

2. **Cache PhysicalResult directly**: Replace the decomposed cache with `cached_result: Arc<OnceCell<PhysicalResult>>`. This avoids duplication but changes the caching abstraction.

We recommend approach 1 (Arc-wrap MutationLayer) as it's more targeted and consistent with how plan nodes already store `Arc<Vec<OwnedTree>>` for appends/insertions.

**Files**
- `crates/arbors/src/handle.rs`

**Minimal tests**
- Rust: `append(tree).len()` returns correct count.
- Rust: `remove([0,1]).len()` returns correct count.

---

### 21.1.11 Synchronize Python bindings with Rust API changes

**Problem**: If Rust `get()`/`iter()`/mutation methods change signatures or error semantics, Python bindings (`__getitem__`, `__iter__`, mutation methods) must be updated to match.

**Change**
- After completing Rust changes, audit Python bindings in `python/src/lib.rs`:
  - Ensure `__getitem__` delegates correctly to the updated `get()`.
  - Ensure `__iter__` uses the new lazy iteration path.
  - Ensure mutation methods (`append`, `remove`, `set`, `insert`, `concat`) handle new result types.
- Update Python tests if needed.

**Files**
- `python/src/lib.rs`
- `python/tests/test_arbor_mutations.py`

**Minimal tests**
- Python: `arbor.append(tree)[len(arbor)]` returns appended tree.
- Python: `list(arbor.sort_by(...).remove(0))` yields correct order.

---

### 21.1.12 Comprehensive regression tests for mutation chains

**Problem**: individual mutation tests verify single operations, but complex chains like `sort_by().remove(0).set(0, x).iter()` can expose integration issues not caught by unit tests.

**Change**
- Add a dedicated regression test file with comprehensive chain tests:
  - Chains involving permuted views: `sort_by(...).remove(...).iter()`
  - Chains involving appends after permutation: `shuffle(...).append(...).head(...)`
  - Chains involving set on various virtual index types: `append(...).set(last, ...).get(last)`
  - Chains involving insert into sorted views: `sort_by(...).insert(0, ...).iter()`
  - Chains combining multiple mutation types: `append(...).remove(...).set(...).concat(...).iter()`
  - **Chained mutations (flattening)**: `append(tree1).append(tree2).remove(1)` — verifies single flat composite with merged layer
  - **Sort after mutation**: `append(tree).sort_by(path("x"))` — verifies materialization boundary before sort
  - **Duplicate indices**: `take([0, 0, 1]).iter()` — verifies duplicate handling in permuted results

**Files**
- `crates/arbors/tests/integration/mutation_chain_tests.rs` (new)
- `python/tests/test_mutation_chains.py` (new)

**Tests** (non-exhaustive):
```rust
#[test]
fn test_sort_remove_set_iter() {
    let arbor = parse_jsonl(r#"{"n":3}
{"n":1}
{"n":2}"#);
    let sorted = arbor.sort_by(&path("n")).unwrap();
    let removed = sorted.remove(&[0]).unwrap();  // Remove smallest (n=1)
    let replacement = first_tree(&parse_jsonl(r#"{"n":99}"#));
    let updated = removed.set(0, replacement).unwrap();  // Replace new first (was n=2)

    let values: Vec<_> = updated.iter()
        .map(|t| t.eval(&path("n")).unwrap())
        .collect();
    assert_eq!(values, vec![99, 3]);  // [n=99 (was n=2), n=3]
}

#[test]
fn test_shuffle_append_head() {
    // Shuffle, append, then head should preserve shuffle order + append
}

#[test]
fn test_append_remove_middle_appended() {
    // Append 3 trees, remove middle appended, verify order
}
```

---

### Edge Cases and Scenarios Requiring Verification

The following scenarios were identified during code-architect review as needing explicit verification:

#### 1. Chained Mutations (Flattening)

When mutations are chained:
```rust
arbor.append(tree1).append(tree2).remove(1)
```

**Requirement** (per section C above): This produces a **single flattened** `Composite { base, layer, indices }`, not nested composites. The `execute_plan_node` implementation must **extend** the existing layer rather than wrapping.

**Verification needed**: Confirm that chained mutations produce flat composites and that the merged layer resolves correctly.

#### 2. Sort After Mutation

```rust
arbor.append(tree).sort_by(path("x"))
```

**Current behavior**: `sort_by` triggers materialization because `find_root_source_info` walks through the `Append` node to find the root source. The sort operates on the materialized result.

**Verification needed**: Confirm that `execute_plan_node` for `Sort` on a `Composite` input materializes first, producing correct sorted output.

#### 3. Concurrent Iteration

Slot IDs use a process-global `AtomicU64` counter. When multiple threads simultaneously create insertions, slot IDs will interleave.

**Verification needed**: This is correct for correctness (each insertion gets a unique slot), but tests should verify that concurrent mutation chains produce correct results.

#### 4. Duplicate Indices in Permuted Results

Operations like `take([0, 0, 1])` create permuted results with duplicate backing indices.

**Verification needed**: `IndexSet::from_ordered_indices` handles this by creating a `Permuted` variant. Confirm the full pipeline (iteration, get, further mutations) handles duplicates correctly.

---

### Updated implementation order (Phase 21 continuation)

| Phase | Steps | Description |
|-------|-------|-------------|
| **0** | 0.1-0.5 | Spread/Stretch IndexSet replacement (all-in, no lossy bridges) |
| **1** | 1.1-1.3 | Composite types (VirtualIndex, MutationLayer, CompositeIndexSet, CompositeSource) |
| **2 (v1)** | 2.1-2.7 | Single-root mutations: `append`, `remove`, `set`, `insert` |
| **2.5 (v1.5)** | - | `concat` as wrapper over `append` (materializes RHS) |
| **3** | 3.1-3.3 | Tests (Rust + Python) |
| **21.1** | 21.1.1-21.1.12 | **Stabilize correctness + iteration + chainability** (required before Phase 4) |
| **4** | 4.1-4.8 | Materialization elision optimizer |

### Phase 21.1 Implementation Order (with dependencies)

The 12 items should be implemented in this order to minimize rework:

|✔︎| #  | Item | Description | Dependencies |
|-|-----------|------|-------------|--------------|
|✔︎|  1 | **21.1.1** | Fix `CompositeIndices` ordering bug | None (CRITICAL, one-line fix) |
|✔︎|  2 | **21.1.4** | Correct `Appended`/`Inserted` removal with `Spread` + slot counter | None (foundational) |
|✔︎|  3 | **21.1.7** | Fail-fast logical->backing conversion | None (defensive) |
|✔︎|  4 | **21.1.9** | Test stability under parallelism | None (can be parallel) |
|✔︎|  5 | **21.1.10** | Unify caching for composite results (Arc-wrap MutationLayer) | None |
|✔︎|  6 | **21.1.5** | Implement `set()` on Composite/CompositeIndices | 21.1.4 (layer structure + slot IDs) |
| |  7 | **21.1.8** | Eliminate JSON round-trips in materialization | None (but complex) |
| |  8 | **21.1.3** | Fix `VirtualIndex::Base` coordinate space mismatch | 21.1.1, 21.1.5, 21.1.10 (**BLOCKING 21.1.2**) |
| |  9 | **21.1.2** | Make `get()` work for Composite results | 21.1.3 (coordinate space fix) |
| | 10 | **21.1.6** | Make iteration lazy for mutated arbors | 21.1.3, 21.1.4, 21.1.5, 21.1.8 |
| | 11 | **21.1.11** | Synchronize Python bindings | 21.1.2, 21.1.6 (after Rust stabilizes) |
| | 12 | **21.1.12** | Comprehensive regression tests | All previous items |

**Key insight**: 21.1.3 (coordinate space fix) is the critical blocker for 21.1.2 (get() on Composite). The current 21.1.2 implementation is broken because it materializes the base into a new coordinate space but uses backing indices from the original space. 21.1.3 fixes this by NOT materializing, instead resolving through the original root source.

**Gating tests**:
    1. test_get_on_composite_with_sparse_base_indices - This is the expected gating test for Phase 21.1.3 (coordinate space fix)
    2. test_filter_set_works_correctly - This is also failing due to the same coordinate space issue

**Dependency note**: Phase 4's rules (like "append then head elision") assume mutation semantics are correct and observable through iteration/get; Phase 21.1 locks those semantics down first.

---

## Phase 4: Materialization Elision Optimizer

After mutations work correctly, add optimization rules to **elide unnecessary materializations** when we can prove mutations are "dead" (not visible in final output).

### Motivation

The baseline strategy is "materialize at filter/sort/aggregate boundaries." But many materializations are unnecessary:

| Pattern | Why Elide |
|---------|-----------|
| `arbor.append(tree).head(5)` where `len(arbor) >= 5` | Appended tree never accessed |
| `arbor.remove(999).filter(excludes 999)` | Removal is redundant |
| `arbor.set(0, tree).head(10).tail(5)` | Index 0 sliced away |
| `arbor.append(tree).remove(-1)` | Append then remove last = no-op |
| `arbor.set(0,a).set(0,b)` | Collapse to `set(0,b)` |

### New Module: `crates/arbors-planner/src/optimize/mutation.rs`

```rust
//! Mutation elision optimization rules.

use std::sync::Arc;
use crate::{QueryPlan, OptimizationRule};

/// Eliminates Append when subsequent Head excludes appended trees.
///
/// Pattern: `Head(n, Append(source, trees))` where `source.len() >= n`
/// -> `Head(n, source)`
#[derive(Debug, Clone, Copy)]
pub struct AppendHeadElision;

impl OptimizationRule for AppendHeadElision {
    fn apply(&self, plan: &Arc<QueryPlan>) -> Option<Arc<QueryPlan>> {
        match plan.as_ref() {
            QueryPlan::Head { source, n } => {
                if let QueryPlan::Append { source: append_source, .. } = source.as_ref() {
                    if let Some(source_len) = get_source_length(append_source) {
                        if source_len >= *n {
                            return Some(Arc::new(QueryPlan::Head {
                                source: Arc::clone(append_source),
                                n: *n,
                            }));
                        }
                    }
                }
                None
            }
            _ => None,
        }
    }

    fn name(&self) -> &'static str { "AppendHeadElision" }
}

/// Eliminates Append followed by Remove of the appended element.
///
/// Pattern: `Remove([-1], Append(source, [tree]))`
/// -> `source`
#[derive(Debug, Clone, Copy)]
pub struct AppendRemoveLastElision;

impl OptimizationRule for AppendRemoveLastElision {
    fn apply(&self, plan: &Arc<QueryPlan>) -> Option<Arc<QueryPlan>> {
        match plan.as_ref() {
            QueryPlan::Remove { source, indices } => {
                if indices.len() == 1 {
                    if let QueryPlan::Append { source: append_source, trees } = source.as_ref() {
                        if trees.len() == 1 {
                            if let Some(source_len) = get_source_length(append_source) {
                                if indices[0] == source_len {
                                    return Some(Arc::clone(append_source));
                                }
                            }
                        }
                    }
                }
                None
            }
            _ => None,
        }
    }

    fn name(&self) -> &'static str { "AppendRemoveLastElision" }
}

/// Collapses sequential Set operations on the same index.
///
/// Pattern: `Set(idx, b, Set(idx, a, source))`
/// -> `Set(idx, b, source)`
#[derive(Debug, Clone, Copy)]
pub struct SetCollapsingElision;

impl OptimizationRule for SetCollapsingElision {
    fn apply(&self, plan: &Arc<QueryPlan>) -> Option<Arc<QueryPlan>> {
        match plan.as_ref() {
            QueryPlan::Set { source, index: outer_idx, tree: outer_tree } => {
                if let QueryPlan::Set { source: inner_source, index: inner_idx, .. } = source.as_ref() {
                    if outer_idx == inner_idx {
                        return Some(Arc::new(QueryPlan::Set {
                            source: Arc::clone(inner_source),
                            index: *outer_idx,
                            tree: outer_tree.clone(),
                        }));
                    }
                }
                None
            }
            _ => None,
        }
    }

    fn name(&self) -> &'static str { "SetCollapsingElision" }
}

/// Eliminates Set when modified index is sliced away.
///
/// Pattern: `Head(n, Set(idx, tree, source))` where `idx >= n`
/// -> `Head(n, source)`
#[derive(Debug, Clone, Copy)]
pub struct SetSliceElision;

impl OptimizationRule for SetSliceElision {
    fn apply(&self, plan: &Arc<QueryPlan>) -> Option<Arc<QueryPlan>> {
        match plan.as_ref() {
            QueryPlan::Head { source, n } => {
                if let QueryPlan::Set { source: set_source, index, .. } = source.as_ref() {
                    if *index >= *n {
                        return Some(Arc::new(QueryPlan::Head {
                            source: Arc::clone(set_source),
                            n: *n,
                        }));
                    }
                }
                None
            }
            _ => None,
        }
    }

    fn name(&self) -> &'static str { "SetSliceElision" }
}

/// Get known length of a plan (if determinable at optimization time).
fn get_source_length(plan: &QueryPlan) -> Option<usize> {
    match plan {
        QueryPlan::InMemory { arbor } => Some(arbor.num_trees()),
        QueryPlan::Head { source, n } => {
            get_source_length(source).map(|len| len.min(*n))
        }
        QueryPlan::Tail { source, n } => {
            get_source_length(source).map(|len| len.min(*n))
        }
        QueryPlan::Take { indices, .. } => Some(indices.len()),
        QueryPlan::Append { source, trees } => {
            get_source_length(source).map(|len| len + trees.len())
        }
        QueryPlan::Remove { source, indices } => {
            get_source_length(source).map(|len| len.saturating_sub(indices.len()))
        }
        _ => None,
    }
}
```

### Index Bounds Analysis

```rust
/// Represents which indices are accessible in the final result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexBounds {
    /// All indices are potentially accessed
    All,
    /// Only indices in [start, end) are accessed
    Range { start: usize, end: Option<usize> },
    /// Only specific indices are accessed
    Sparse(HashSet<usize>),
    /// No indices are accessed (empty result)
    Empty,
}

impl IndexBounds {
    /// Check if an index is definitely NOT accessible.
    pub fn is_dead(&self, index: usize, total_len: usize) -> bool {
        match self {
            IndexBounds::All => false,
            IndexBounds::Empty => true,
            IndexBounds::Range { start, end } => {
                let end = end.unwrap_or(total_len);
                index < *start || index >= end
            }
            IndexBounds::Sparse(indices) => !indices.contains(&index),
        }
    }
}
```

### Integration with Optimizer

Add mutation elision rules to `optimize_query_plan()`:

```rust
let rules: Vec<Box<dyn OptimizationRule>> = vec![
    // Phase 1: Structural
    Box::new(FilterFusion),
    Box::new(FilterSelectivityOrder),
    Box::new(PredicatePushdown),

    // Phase 2: Mutation Elision (new)
    Box::new(AppendHeadElision),
    Box::new(AppendRemoveLastElision),
    Box::new(SetCollapsingElision),
    Box::new(SetSliceElision),

    // Phase 3: Limit-aware
    Box::new(LimitPushdown),
    Box::new(LimitFusion),
    Box::new(TopKFusion),
];
```

### Phase 4 Implementation Order

| Step | Description | Files |
|------|-------------|-------|
| 4.1 | Add `get_source_length()` helper | `optimize/mutation.rs` |
| 4.2 | Implement `AppendHeadElision` | `optimize/mutation.rs` |
| 4.3 | Implement `AppendRemoveLastElision` | `optimize/mutation.rs` |
| 4.4 | Implement `SetCollapsingElision` | `optimize/mutation.rs` |
| 4.5 | Implement `SetSliceElision` | `optimize/mutation.rs` |
| 4.6 | Add `IndexBounds` analysis infrastructure | `optimize/mutation_analysis.rs` |
| 4.7 | Add optimizer integration | `optimize/query_plan.rs` |
| 4.8 | Add comprehensive tests | `optimize/mutation_tests.rs` |

---

## Implementation Order Summary

| Phase | Steps | Description |
|-------|-------|-------------|
| **0** | 0.1-0.5 | Spread/Stretch IndexSet replacement (all-in, no lossy bridges) |
| **1** | 1.1-1.3 | Add composite types (VirtualIndex, MutationLayer, CompositeIndexSet) |
| **2 (v1)** | 2.1-2.7 | Implement single-root mutations: `append`, `remove`, `set`, `insert` |
| **2.5 (v1.5)** | - | Add `concat` as wrapper over `append` (materializes RHS) |
| **3** | 3.1-3.3 | Tests (Rust + Python) |
| **4** | 4.1-4.8 | Materialization elision optimizer |
| **Future (v2)** | - | True binary `Concat` node with optimizer/traversal updates |

### v1 vs v1.5 vs v2 Scope

| Version | Operations | Binary Nodes | Notes |
|---------|------------|--------------|-------|
| **v1** | append, remove, set, insert | No | Single-root mutations only |
| **v1.5** | concat | No | Materializes RHS, delegates to append |
| **v2** | concat (lazy) | Yes | Full binary Concat node, requires optimizer refactor |

v2 is explicitly deferred. Proceed if:
- v1.5's materialization cost is unacceptable
- Lazy concat for large arbors is needed
- Budget for traversal/optimizer refactor is available

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `crates/arbors-planner/src/spread.rs` | Spread, Stretch, SpreadIter types |
| `crates/arbors-planner/src/composite.rs` | VirtualIndex, Segment, CompositeIndexSet (segment-based), MutationLayer, CompositeSource |
| `crates/arbors-planner/src/optimize/mutation.rs` | Mutation elision rules |
| `crates/arbors-planner/src/optimize/mutation_analysis.rs` | IndexBounds analysis |
| `crates/arbors/tests/integration/mutation_tests.rs` | Rust mutation tests |
| `python/tests/test_arbor_mutations.py` | Python mutation tests |

### Modified Files

| File | Changes |
|------|---------|
| `crates/arbors-planner/src/lib.rs` | Add `mod spread`, `mod composite` |
| `crates/arbors-planner/src/physical.rs` | Replace IndexSet internals with Spread; add `PhysicalResult::Composite` and `PhysicalResult::CompositeIndices` variants; update mutation execution to preserve permutation order |
| `crates/arbors-planner/src/query_plan.rs` | Add mutation variants (Append, Remove, Set, Insert) |
| `crates/arbors-planner/src/optimize/mod.rs` | Add mutation elision rules |
| `crates/arbors/src/handle.rs` | Add append, concat, insert, set, remove methods |
| `python/src/lib.rs` | Add Python bindings for mutations |
| `CLAUDE.md` | Document mutation methods and immutable semantics |

---

## Answers to Clarifying Questions

1. **Index meaning**: Logical indices (consistent with `get()` and Python `__getitem__`)

2. **Negative indexing**: Python-only sugar; Rust takes `usize`

3. **Chainability vs materialization**: Auto-materialize when downstream op needs it (filter, sort, aggregate). `len()` stays cheap (just counts indices).

4. **Cross-scope concat**: For now, both arbors must be in-memory or share the same scope. Cross-scope concat would materialize first.

5. **Schema behavior**: Preserve if compatible; if not, materialize and infer to preserve eventual schema presence.

6. **set() semantics**: Replace the i-th tree in logical order (like list assignment). Replacement participates in subsequent ops after materialization.

---

## Non-Goals

- No Python `arbor_ops/` refactor (deferred)
- No Rust `ops/` module refactor (deferred)
- No proc-macros for op generation
- No cross-snapshot mutations
- No lazy filter/sort after mutations (always materialize at those boundaries)
