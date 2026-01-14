# Fast by Default: Making Phase 18 Lazy APIs the Natural Path

## The Problem We Discovered

After implementing all of Phase 18's "zero-copy" and "instant loading" optimizations, the baseball example was **still slow** (~650ms) - slower than pre-Phase 18!

Investigation revealed: **the example was calling `materialize()` which defeats ALL the lazy optimizations**.

## Performance Results

| Approach | Load Time | Speedup |
|----------|-----------|---------|
| `materialize()` then query | 650ms | baseline |
| Lazy `BatchedArbor` APIs | **40ms** | **16x faster** |

The Phase 18 work **was never meant to make `materialize()` fast** - it was meant to **eliminate the need for `materialize()` entirely**.

---

## Before vs After: Baseball Example

### BEFORE (Slow Path - 650ms)

```python
def load_from_cache():
    with ArborStore.open(str(CACHE_PATH)) as base:
        with base.begin_read() as txn:
            players_batched = txn.get("players")
            teams_batched = txn.get("teams")

            # THE PROBLEM: materialize() defeats all lazy optimizations!
            players = players_batched.materialize()  # 595ms!
            teams = teams_batched.materialize()      # 17ms

    return players, teams  # Returns Arbor objects

def run_queries(players, teams):
    # players is an Arbor - iteration loads everything into memory
    players_idx = players.index_by("playerID")

    # Full iteration over all 24,023 players
    for player in players:
        name = player["nameFirst"].value
        # ... tree-by-tree access
```

**Problems with the slow path:**
1. `materialize()` decodes ALL 10 batches (6.17M nodes!)
2. Iteration over `Arbor` loads all data into memory
3. Context managers close before queries run
4. Returns `Arbor` objects that don't support lazy ops

### AFTER (Fast Path - 40ms)

```python
def load_from_cache():
    # Keep base/txn open for lazy access
    base = ArborStore.open(str(CACHE_PATH))
    txn = base.begin_read()

    players = txn.get("players")  # Returns BatchedArbor - instant!
    teams = txn.get("teams")

    return players, teams, base, txn  # Caller manages cleanup

def run_queries(players, teams):
    # players is a BatchedArbor - all ops are lazy
    players_idx = players.index_by("playerID")  # Projection pushdown

    # select() extracts just the fields needed - batch by batch
    pitcher_data = players.select([
        path("nameFirst").alias("first"),
        path("career_pitching.W").alias("wins"),
    ])

    # Process in Python (data already extracted as dicts)
    for d in pitcher_data:
        name = d["first"]
        # ... dict access, not tree access
```

**Why the fast path is fast:**
1. `txn.get()` returns `BatchedArbor` - just metadata, no decoding
2. `index_by()` uses projection pushdown (only decodes key fields)
3. `select()` extracts just needed fields batch-by-batch
4. `find_one()` exits early when match found
5. No 6.17M node materialization!

---

## The API Friction Points

The current API makes it **too easy to fall into the slow path**:

### Friction Point 1: `txn.get()` returns `BatchedArbor`, not `Arbor`

Users expect `txn.get("players")` to return something they can immediately use like an `Arbor`. Instead, they get `BatchedArbor` which has different methods. The natural instinct is to call `materialize()` to "fix" it.

### Friction Point 2: Context Manager Scope

The "pythonic" pattern closes the transaction before you can use the data:
```python
with base.begin_read() as txn:
    players = txn.get("players")  # BatchedArbor
# Transaction closed! Can't access players anymore.
```

Users are forced to either:
- Call `materialize()` inside the context (slow path)
- Manually manage `base` and `txn` lifetime (fast path, but ugly)

### Friction Point 3: `Arbor` and `BatchedArbor` Have Different APIs

| Operation | `Arbor` | `BatchedArbor` |
|-----------|---------|----------------|
| `index_by()` | ✅ | ✅ (now) |
| `filter()` | ✅ returns `Arbor` | ✅ returns `list[int]` |
| `select()` | ✅ | ✅ |
| `find_one()` | ✅ | ✅ |
| `sort_by()` | ✅ | ❌ |
| `group_by()` | ✅ | ❌ |
| `nest()` | ✅ | ❌ |
| iteration | `for tree in arbor` | ❌ (need batch access) |

### Friction Point 4: Iteration Patterns Differ

```python
# Arbor iteration (intuitive but slow if from materialize)
for tree in arbor:
    print(tree["name"].value)

# BatchedArbor iteration (fast but awkward)
for batch_idx in range(batched.batch_count):
    batch = batched.batch(batch_idx)
    for tree in batch:
        print(tree["name"].value)
```

---

## Investigation Questions

Before designing solutions, we need to answer:

### Q1: What should `txn.get()` return?

Options:
- **A) Keep returning `BatchedArbor`** - users learn to use lazy APIs
- **B) Return a unified type** that acts like `Arbor` but is lazy underneath
- **C) Add `txn.get_lazy()` and `txn.get_materialized()`** - explicit choice

### Q2: How should transaction lifetime work?

Options:
- **A) Keep current model** - users manage manually when using lazy APIs
- **B) Auto-extend transaction** - keep alive as long as returned objects are in use
- **C) Detach from transaction** - lazy objects become self-contained after get()

### Q3: Should `BatchedArbor` support direct iteration?

Options:
- **A) No** - force users to use `select()` or batch access (current)
- **B) Yes, but with a warning** - `for tree in batched` works but logs perf warning
- **C) Yes, seamlessly** - iterator yields trees lazily from batches

### Q4: Should we unify `Arbor` and `BatchedArbor`?

Options:
- **A) Keep separate** - different types for different use cases
- **B) Make `Arbor` a protocol/interface** - both implement same methods
- **C) Merge into single type** - `Arbor` IS lazy, backed by batches or memory

---

## Decided Direction: Unified Types via Trait + Parity Testing

### Existing Building Blocks in the Repo

The codebase already has precedent for this pattern:
- `python/api_manifest.toml` + `scripts/check_api_parity.py` - module export parity
- `arbors_storage::TableOps` - keeps `Arbor` and `TableView` aligned
- `arbors_query::QueryOps` - method-syntax trait for multiple container flavors

---

## Implementation Plan

### Phase A: Fast, Low Risk (Prevent Drift)

#### A1: Rust `ArborOps` Trait

Define a single "Arbor surface area" trait implemented by all flavors:

```rust
/// Core query operations that all Arbor flavors must support.
/// Adding a method here forces implementation for ALL flavors.
pub trait ArborOps {
    // Query operations
    fn filter(&self, expr: &Expr) -> Result<Vec<usize>, Error>;
    fn select(&self, exprs: &[Expr]) -> Result<Vec<ExprResult>, Error>;
    fn aggregate(&self, exprs: &[Expr]) -> Result<ExprResult, Error>;
    fn find_one(&self, expr: &Expr) -> Result<Option<Tree>, Error>;

    // Index operations
    fn index_by(&self, keys: &[Expr], opts: IndexByOptions) -> Result<IndexedView, Error>;

    // Future: group_by, nest, unique_by, sort_by...
}

impl ArborOps for Arbor { /* delegates to in-memory paths */ }
impl<'txn> ArborOps for BatchedArbor<'txn> { /* delegates to pipeline */ }
```

**Key design principle**: Methods phrased in terms of **logical operations**, not implementation details.

#### A2: Macro to Prevent Drift

Define the canonical method list once and generate:
- The trait declaration
- `impl ArborOps for Arbor`
- `impl ArborOps for BatchedArbor<'_>`

```rust
arbor_ops! {
    // name, signature, doc
    filter(expr: &Expr) -> Result<Vec<usize>, Error>;
    select(exprs: &[Expr]) -> Result<Vec<ExprResult>, Error>;
    // ...
}
```

#### A3: Python Method-Parity Tests

Add `python/tests/test_api_parity.py`:

```python
def test_arbor_batched_arbor_method_parity():
    """Arbor and BatchedArbor must implement the same core methods."""
    required_methods = [
        "filter", "select", "aggregate", "find_one", "find_one_or_error",
        "index_by", "head", "any", "all",
        # Future: "group_by", "nest", "sort_by"
    ]

    arbor_methods = set(dir(arbors.Arbor))
    batched_methods = set(dir(arbors._arbors.BatchedArbor))

    for method in required_methods:
        assert method in arbor_methods, f"Arbor missing {method}"
        assert method in batched_methods, f"BatchedArbor missing {method}"
```

Optional: Create `python/api_methods_manifest.toml` for enshrined parity.

### Phase B: User Experience (Unified Python Type)

Collapse to a single public type (facade):

```python
# Publicly: one Arbor type
class Arbor:
    """Unified Arbor - backed by in-memory or batched storage."""

    def __init__(self, inner: _InMemory | _Batched):
        self._inner = inner

    # All methods delegate to inner
    def filter(self, expr): return self._inner.filter(expr)
    def select(self, exprs): return self._inner.select(exprs)
    # ...

# txn.get() returns unified Arbor (batched-backed)
# read_jsonl() returns unified Arbor (in-memory-backed)
```

Escape hatch for power users:
```python
txn.get_batched_handle()  # Returns explicit BatchedArbor if needed
```

### Phase C: Capabilities (Full Parity)

Bring remaining ops into shared surface area:
- `nest()` - with documented performance characteristics
- `group_by()`
- `sort_by()`
- `unique_by()`

---

## BatchedArbor Iteration: Seamless

**Decision**: `for tree in batched` should work seamlessly.

Implementation:
```python
class BatchedArbor:
    def __iter__(self):
        """Iterate trees lazily, batch by batch."""
        for batch_idx in range(self.batch_count):
            batch = self.batch(batch_idx)
            for tree in batch:
                yield tree
```

This makes the fast path the natural path - users don't need to know about batches.

---

## Transaction Lifetime: Analysis Needed

Three options with tradeoffs:

### Option A: Manual Management (Current)

```python
base = ArborStore.open(path)
txn = base.begin_read()
players = txn.get("players")  # BatchedArbor tied to txn

# User responsible for cleanup
# ... use players ...
txn.close()
```

**Pros:**
- Explicit, no magic
- User controls exactly when resources are freed
- No GC unpredictability

**Cons:**
- Ugly API (return multiple objects, try/finally everywhere)
- Easy to forget cleanup → resource leaks
- Transaction scope doesn't match "logical scope" of data use

### Option B: Reference Counting (Python GC Integration)

```python
with ArborStore.open(path) as base:
    with base.begin_read() as txn:
        players = txn.get("players")
    # Transaction stays open because players holds a reference

# Transaction closes when players is garbage collected
del players  # Now txn closes
```

**Pros:**
- Most "pythonic" - follows Python's RAII pattern
- Context managers work as expected
- No manual cleanup

**Cons:**
- GC timing unpredictable (especially in CPython with cycles)
- Transactions held longer than necessary → redb lock contention
- Reference cycles could prevent cleanup entirely
- Harder to debug "why is my transaction still open?"

### Option C: Copy-on-Detach (Hybrid)

```python
with ArborStore.open(path) as base:
    with base.begin_read() as txn:
        players = txn.get("players")
# Transaction closes, players "detaches" - copies essential data

# players still works! (using copied data or reopening as needed)
players.filter(...)  # Works
```

**Pros:**
- Context managers work naturally
- Lazy objects remain usable after txn closes
- Predictable resource cleanup

**Cons:**
- Hidden copies could be expensive
- Semantic complexity: when is data copied? What's the memory cost?
- "Reopening as needed" adds latency unpredictably
- May need to keep ArborStore path around

---

## Files to Investigate

| File | Purpose |
|------|---------|
| `crates/arbors-pipeline/src/lazy.rs` | Existing `LazyArbor` implementation |
| `python/src/lib.rs` | Python bindings for `BatchedArbor`, `Arbor` |
| `crates/arbors-base/src/lib.rs` | `BatchedArbor` implementation |
| `python/arbors/_arbors.pyi` | Type stubs showing current API |
| `crates/arbors-storage/src/table_ops.rs` | Existing `TableOps` trait pattern |
| `crates/arbors-query/src/lib.rs` | Existing `QueryOps` pattern |
| `python/api_manifest.toml` | Export parity pattern to extend |

---

## Key Decisions (from user feedback)

### 1. Semantic Interchangeability is Required

Users should NOT care whether they have an in-memory or batched Arbor. The API must be identical:
- Same method names
- Same return types
- Same iteration behavior

Current problem: `Arbor.filter() -> Arbor` but `BatchedArbor.filter() -> list[int]`

This means we need BOTH:
- A **unified facade type** (single `Arbor` class)
- **Redesigned primitives** (consistent return types)

### 2. Hide Transactions from Users

The `with base.begin_read() as txn:` pattern feels broken - it forces users into awkward code to get performance.

**The transaction should be an implementation detail, not a user-facing concept.**

### 3. Natural Iteration is Non-Negotiable

`for tree in arbor` must be the encouraged, natural API. No warnings, no discouragement.

### 4. No Rush - Get It Right

We can take time to design this properly.

---

## Clean Break: One Arbor Type, One Set of Semantics

### User-Facing Types (Public API)

| Type | Description |
|------|-------------|
| `Arbor` | The ONLY collection users interact with |
| `ArborStore` | Session object; `arbor["players"]` returns Arbor |
| `Tree` | Single tree view (unchanged) |
| `IndexedView` | Result of `index_by()` |

**NOT public**: `BatchedArbor`, `ReadTxn`, `WriteTxn` - these become internal implementation details.

### Internal Backing (Hidden from Users)

`Arbor` wraps an internal enum (in Rust via PyO3):

```rust
enum ArborBacking {
    InMemory(arbors_storage::Arbor),
    Stored { base_session, name, meta, interner },
    Filtered { source: Arbor, indices: Vec<usize> },
}
```

**Semantic interchangeability is true by construction** - there's only one `Arbor` type.

---

## Canonical Semantics (No Exceptions)

### `filter(expr) -> Arbor` (immediate)

```python
filtered = players.filter(path("age") > 21)
# Returns Filtered { source: players, indices: [computed immediately] }
# NOT a list of ints
```

- Computes indices once (immediate)
- Returns `Arbor` backed by source + indices
- Chainable: `players.filter(a).filter(b)`

### `select(exprs) -> Arbor` (structural transform)

```python
# Both backings: returns Arbor
projected = players.select([path("name"), path("age")])
# Returns new Arbor with projected trees

# Chainable
result = arbor.select([...]).filter(...).select([...])
```

- `select()` is a **structural transform** that always returns `Arbor`
- Same semantics for all backings (semantic interchangeability)
- For analytics-style dict extraction, use `iterate_selected_dicts()` instead

### Iteration: `for tree in arbor`

```python
for tree in players:
    print(tree["name"].value)
```

- Works for ALL backings:
  - `InMemory`: direct iteration
  - `Stored`: batch-by-batch lazy
  - `Filtered`: yields `source[idx]` for each index
- **No special batched iteration API exposed**

### `index_by(...) -> IndexedView`

- Works on any backing
- For `Stored`: uses projection-pushdown, non-cache-polluting build
- Same semantics regardless of backing

---

## Dict Extraction API Strategy

The key insight: **`select() -> Arbor` must be preserved for semantic interchangeability.**

For fast dict extraction, use the new streaming APIs:

### API Overview

| Method | Returns | Purpose |
|--------|---------|---------|
| `select(exprs)` | `Arbor` | Structural transform (chainable) |
| `iterate_dicts()` | `Iterator[dict]` | Stream full trees as dicts |
| `iterate_selected_dicts(exprs)` | `Iterator[dict]` | **Fast path** - fused projection + dict stream |
| `materialize_dicts()` | `list[dict]` | Eager full materialization |
| `materialize_selected_dicts(exprs)` | `list[dict]` | Eager projected materialization |

### Baseball Example Pattern

```python
# SLOW (double materialization)
pitcher_data = players.select([...]).to_dicts()
for d in pitcher_data:
    ...

# FAST (streaming, fused projection)
for d in players.iterate_selected_dicts([
    path("nameFirst").alias("first"),
    path("career_pitching.W").alias("wins"),
]):
    ...
```

### Why Not Change `select()`?

Breaking `select() -> Arbor` would violate semantic interchangeability:
- `select()` is a structural transform that produces a new Arbor
- Users can chain: `arbor.select([...]).filter(...).select([...])`
- Both in-memory and stored backings must return `Arbor`

The streaming dict APIs are the correct solution for analytics-style workloads.

---

## ArborStore Session Model (Transactions Disappear)

```python
# The ONLY context-manager you encourage
with ArborStore.open("baseball.arbors") as arbor:
    players = arbor["players"]      # Returns Arbor(Stored{...})
    teams = arbor["teams"]

    for tree in players:           # Natural iteration
        print(tree["name"].value)

    # To see new writes:
    arbor.refresh()                 # Advances snapshot

# arbor.close() called automatically, invalidates stored-backed arbors
```

**Key behaviors:**
- `arbor["name"]` returns `Arbor` tied to session lifetime
- `arbor.refresh()` explicitly advances the snapshot
- `arbor.close()` ends session, invalidates stored arbors (clean + predictable)
- **No `ReadTxn.__exit__` invalidation bug** - it doesn't exist anymore

---

## Design Risk: `Arbor.__getitem__(i)` for Stored/Filtered

**What does `arbor[i]` do?**

| Backing | Behavior |
|---------|----------|
| `InMemory` | Direct access, fast |
| `Stored` | Load right batch, slice 1 tree (potentially expensive per access) |
| `Filtered` | `source[indices[i]]` |

This is doable and expected by users. Be intentional - users will naturally index and iterate a lot once it "just works."

---

## Locking the API to Prevent Drift

### Python-level: Single Surface

If only `Arbor` is public, there's **no place for drift to show up** - there's only one type.

### Rust-level: Trait + Macro (Optional but Strong)

```rust
trait ArborOps {
    fn filter(&self, expr: &Expr) -> Result<Arbor>;
    fn select(&self, exprs: &[Expr]) -> Result<Arbor>;
    fn index_by(&self, keys: &[Expr], opts: IndexByOptions) -> Result<IndexedView>;
    // ...
}

impl ArborOps for InMemoryBacking { ... }
impl ArborOps for StoredBacking { ... }
impl ArborOps for FilteredBacking { ... }
```

Adding an op forces implementing it for ALL backings - drift becomes compiler-visible.

---

## Design Decisions (Finalized)

1. **Filter semantics**: **Immediate**
   - `filtered = arbor.filter(expr)` computes indices immediately
   - Returns `Arbor` backed by source + computed indices
   - Simpler mental model, no deferred surprises

2. **`base.refresh()` semantics**: **Snapshot is immutable per arbor**
   - Arbors are immutable - existing `Arbor` objects keep reading the old snapshot
   - `base.refresh()` creates a new snapshot for **future** lookups only
   - Existing `Filtered` indices, `IndexedView`s remain valid on their original snapshot

3. **Lifetime rule**: **Stored arbors keep the base session alive (ref-counting)**
   - Every `Stored`-backed arbor holds a strong reference to the `ArborStore` session state
   - `base.close()` just marks the *user-facing handle* closed and drops one ref
   - Actual DB/resources close when the last `Arbor` drops
   - This keeps "pay for what you use" without magical copies or invalidation surprises
   - Consistent with "transactions hidden" - it just works

4. **Write path**: **Keep `arbor.put("name", arbor)` + atomic writes for power users**
   - Reads: `players = arbor["players"]`
   - Writes: `arbor.put("players", new_arbor)` (simple API)
   - Multi-operation atomic writes exposed for devs who want explicit control

5. **`to_dicts()` ordering**: **Stable, identical to iteration order**
   - Guarantees ordering matches `for tree in arbor`
   - Predictable behavior for downstream processing

6. **`select() -> Arbor` always**: **Semantic interchangeability preserved**
   - Both `InMemory` and `Stored` backings return `Arbor` from `select()`
   - This allows chaining: `arbor.select([...]).filter(...).select([...])`
   - For fast dict extraction, use **`iterate_selected_dicts(exprs)`** instead
   - The streaming dict APIs are the "fast by default" path for analytics workloads

---

## Implementation Phases (Revised)

**IMPORTANT: No Migration Required**
This is a brand new library with ZERO external users. There is no need for:
- Deprecation warnings
- Legacy API shims
- Migration guides for external consumers
- Backward compatibility

---

### Phase 1: Core Refactor (Unified Arbor Type)

**Goal**: Refactor the existing `Arbor` pyclass into an enum-backed facade.

**The Big Structural Change:**
Today `Arbor` in `python/src/lib.rs` is:
```rust
pub struct Arbor { inner: arbors::Arbor, schema: Option<Py<Schema>> }
```

This must become:
```rust
pub struct Arbor {
    backing: ArborBacking,
    schema: Option<Py<Schema>>,
}

enum ArborBacking {
    InMemory(arbors::Arbor),
    Stored { /* base_session, name, meta, interner */ },
    Filtered { source: Box<Arbor>, indices: Vec<usize> },
}
```

**Critical plumbing required:**
- `Arbor.__getitem__(i)` for random access (needed by `Filtered` iteration)
  - `InMemory`: direct access
  - `Stored`: locate batch + local index + slice one tree
  - `Filtered`: `source[indices[i]]`

**Steps:**
1. Refactor `Arbor` struct to use `ArborBacking` enum
2. Update all methods that assume `self.inner` exists
3. Implement `__getitem__(i)` for all backings
4. Implement `__iter__` for all backings (batch-by-batch for `Stored`)
5. Implement `__len__` for all backings

### Phase 2: ArborStore Session Model

**Goal**: `arbor["players"]` returns unified `Arbor`, transactions hidden.

**Session Lifetime Model:**
- `ArborStore` holds session state (redb env + read snapshot) in `Arc<SessionState>`
- Each `Stored`-backed `Arbor` holds a clone of `Arc<SessionState>`
- `base.close()` marks user handle closed and drops one ref
- Real resources close when last `Arbor` drops (ref-counted)

**Thread-Safety Constraint (CRITICAL):**
- `OwnedReadTxn` (redb wrapper) may NOT be `Send+Sync`
- **Strategy**: Keep snapshot access behind `Mutex<Option<OwnedReadTxn>>` and document single-threaded session semantics
- Confirm during implementation whether `OwnedReadTxn` is `Send+Sync`; if not, guard all access under lock
- Python GIL provides natural single-thread guarantee for most cases

**Steps:**
1. Create `Arc<SessionState>` to hold shared redb env + snapshot
2. Implement `ArborStore.__getitem__("name")` returning `Arbor(Stored{...})` with `Arc` clone
3. Implement `base.refresh()` (creates new snapshot for future lookups)
4. Implement `base.close()` (marks closed, drops ref - real close at last ref)

### Phase 3: Semantic Parity

**Goal**: All operations return consistent types.

**Public MVP Surface (Phase 1-3):**
These methods MUST work for all backings before public release:
- `__len__`, `__iter__`, `__getitem__`
- `filter`, `select`, `to_dicts`
- `aggregate`, `find_one`, `find_one_or_error`
- `index_by`, `head`, `any`, `all`

**Deferred (implement later with same semantics):**
- `nest()`, `group_by()`, `sort_by()`, `unique_by()`
- These can initially raise `NotImplementedError` for `Stored` backing
- Or delegate to materialize internally with clear docs

**Steps:**
1. `filter(expr) -> Arbor` (returns `Filtered` backing, immediate evaluation)
2. `select(exprs) -> Arbor` (returns `InMemory` with projected trees)
3. Add `to_dicts()` method for explicit extraction
4. Update `index_by()` to work on all backings

### Phase 4: Remove Public Exports

**Goal**: Make `BatchedArbor`, `ReadTxn`, `WriteTxn` internal-only.

**Files requiring explicit changes:**
| File | Change |
|------|--------|
| `python/arbors/__init__.py` | Remove `BatchedArbor`, `ReadTxn`, `WriteTxn` exports |
| `python/api_manifest.toml` | Remove from manifest |
| `python/arbors/_arbors.pyi` | Remove type stubs |

### Phase 5: Add Streaming Dict APIs (CRITICAL for "Fast by Default")

**Goal**: Add streaming dict extraction APIs while preserving `select() -> Arbor` contract.

**The Real Problem**:
- `select() -> Arbor` is correct and must stay (semantic interchangeability)
- The performance issue is the **baseball example pattern**: `select([...]).to_dicts()`
- This does double work: materialize projected Arbor, then re-walk to make dicts
- Need a **fused streaming path** for dict extraction

**The Solution**: New streaming APIs (not changing `select()`)

```python
# Structural (returns Arbor) - UNCHANGED
select(exprs) -> Arbor

# Streaming (returns Iterator[dict]) - NEW
iterate_dicts() -> Iterator[dict]           # full trees as dicts
iterate_selected_dicts(exprs) -> Iterator[dict]  # fused projection + dict extraction

# Eager materialization (returns list[dict]) - RENAMED from to_dicts()
materialize_dicts() -> list[dict]           # full trees as list
materialize_selected_dicts(exprs) -> list[dict]  # fused projection + list
```

**Why These Names**:
- No "rows" terminology (avoids implying tabular flatness)
- `iterate_` always means streaming
- `materialize_` always means eager allocation
- "selected" is explicit that it's not the full tree

**Baseball Example Fix**:
```python
# BEFORE (slow - double materialization)
pitcher_data = players.select([...]).to_dicts()
for d in pitcher_data:
    ...

# AFTER (fast - streaming, fused)
for d in players.iterate_selected_dicts([...]):
    ...
```

**Implementation: `iterate_selected_dicts` for Stored backing**

```rust
#[pyclass]
pub struct SelectedDictIterator {
    /// Reference to the stored arbor's session
    session: Arc<SessionState>,
    /// Arbor name
    name: String,
    /// Expressions to evaluate
    exprs: Vec<arbors_expr::Expr>,
    /// Decode plan for projection pushdown (computed once at construction)
    decode_plan: DecodePlan,
    /// Current batch index
    current_batch: usize,
    /// Number of batches
    batch_count: usize,
    /// Results from current batch (Rust types, not Python)
    current_results: Option<std::vec::IntoIter<arbors_expr::ExprResult>>,
}

#[pymethods]
impl SelectedDictIterator {
    fn __iter__(slf: PyRef<'_, Self>) -> PyRef<'_, Self> {
        slf
    }

    fn __next__(&mut self, py: Python<'_>) -> PyResult<Option<PyObject>> {
        // Yield from current batch results
        if let Some(ref mut iter) = self.current_results {
            if let Some(result) = iter.next() {
                // Use existing expr_result_to_python helper
                // select() produces ExprResult::Object, which converts to PyDict
                return Ok(Some(expr_result_to_python(py, &result)?));
            }
        }

        // Move to next batch
        if self.current_batch >= self.batch_count {
            return Ok(None); // Done
        }

        // Load batch WITH PROJECTION PUSHDOWN
        // NOTE: batch_with_plan takes plan BY VALUE (clone if needed)
        let batch = self.session.with_snapshot(|txn| {
            let batched = txn.get_batched(&self.name)?;
            batched.batch_with_plan(self.current_batch, self.decode_plan.clone())
        })?;

        // Evaluate expressions AFTER releasing lock
        let results = arbors::lazy::select(&batch, &self.exprs)?;

        self.current_batch += 1;
        self.current_results = Some(results.into_iter());

        // Yield first item from new batch
        self.__next__(py)
    }
}
```

**CRITICAL Implementation Requirements**:

1. **Projection pushdown is REQUIRED** (not optional):
   - At iterator construction, compute `DecodePlan` via:
     ```rust
     let schema = batched.schema();
     let plan = analyze_required_pools_multi(&exprs, schema);
     // Note: analyze_required_pools_multi returns DecodePlan directly (not Result)
     // When schema is None, it returns DecodePlan::ALL internally as fallback
     ```
   - Pass `plan` by value to `batch_with_plan()` (it's Clone)
   - Without this, we decode all pools per batch and lose the performance win

2. **Real helper functions** (already in codebase):
   - `expr_result_to_python(py, &ExprResult) -> PyResult<PyObject>` - converts ExprResult::Object to PyDict
   - `node_to_python_deep(py, &Arbor, NodeId) -> PyResult<PyObject>` - converts full tree to Python recursively
   - Note: `select()` always produces `ExprResult::Object`, which converts to `PyDict`
   - **IMPORTANT**: Add an assertion in `__next__` to fail loudly if result is NOT `ExprResult::Object`:
     ```rust
     // In __next__, before converting:
     debug_assert!(matches!(result, ExprResult::Object(_)),
         "iterate_selected_dicts expects Object results, got {:?}", result);
     ```
     This prevents accidentally yielding scalars/arrays if select() semantics ever change

3. **Store Rust types, convert on-demand**:
   - Store `ExprResult` not `PyObject` in the iterator
   - Convert to Python dict only in `__next__`
   - Minimizes allocation pressure and GC overhead

4. **Schema fallback**:
   - If schema is absent, `DecodePlan::ALL` is used (best-effort pushdown)
   - Document that stored arbors with schema get optimal pushdown

5. **Iterator memory model**:
   - `SelectedDictIterator` buffers `Vec<ExprResult>` for one batch at a time
   - Peak memory is proportional to batch size, not total arbor size
   - This is acceptable and consistent with "batch-by-batch" processing
   - Batch sizing upstream (configured during storage) affects peak memory
   - No full materialization occurs - results are yielded and released batch-by-batch

**`iterate_dicts()` - Required for ALL backings**

| Backing | Implementation |
|---------|----------------|
| **InMemory** | Iterate root NodeIds, call `node_to_python_deep(py, &arbor, root_id)` per tree |
| **Stored** | Iterate batches, call `node_to_python_deep(py, &batch, root_id)` per tree in each batch |
| **Filtered** | Iterate indices, for each `idx` delegate `source[idx].to_python()` or evaluate lazily |

**`iterate_selected_dicts(exprs)` - Required for ALL backings**

| Backing | Implementation |
|---------|----------------|
| **InMemory** | Evaluate `arbors::lazy::select(&arbor, &exprs)`, yield `expr_result_to_python()` per result |
| **Stored** | Use `SelectedDictIterator` with projection pushdown (described above) |
| **Filtered** | **Correctness-first fallback**: materialize filtered arbor then evaluate. **Future optimization**: group indices by batch when source is Stored-backed (avoids materializing the full arbor, processes batch-by-batch instead). Note: may be slower than InMemory/Stored initially - this is acceptable for correctness. |

**`materialize_*` implemented via streaming (prevent regression)**

```rust
// materialize_dicts() == list(iterate_dicts())
fn materialize_dicts(&self, py: Python<'_>) -> PyResult<Vec<PyObject>> {
    self.iterate_dicts(py)?.collect()
}

// materialize_selected_dicts() == list(iterate_selected_dicts())
fn materialize_selected_dicts(&self, py: Python<'_>, exprs: Vec<Expr>) -> PyResult<Vec<PyObject>> {
    self.iterate_selected_dicts(py, exprs)?.collect()
}
```

This ensures eager forms are "just collecting the fast streaming path", not accidentally going through `select()` then re-walking.

**Naming Rule (encode in implementation)**:
> Any API that returns Python dicts must be streaming-first (`iterate_*`),
> and any eager list-returning API must have `materialize_` in the name.

**`to_dicts()` Removal (Clean Break)**:

Since this is a clean break with no external users:
1. **Delete `to_dicts()` entirely** (don't deprecate - just remove)
2. Replace with `materialize_dicts()` for the same semantics (eager list)
3. Update all docs/examples that reference `to_dicts()` or `select([...]).to_dicts()`

The pattern `arbor.select([...]).to_dicts()` is explicitly **removed** because:
- It's a performance trap (double materialization)
- The streaming alternative `iterate_selected_dicts()` is strictly better

**Files to modify**:
- `python/src/lib.rs`:
  - Add `SelectedDictIterator`, `DictIterator`
  - Add `iterate_dicts()`, `iterate_selected_dicts()`
  - Add `materialize_dicts()`, `materialize_selected_dicts()`
  - **Remove `to_dicts()`**
- `python/arbors/_arbors.pyi`: Add new method stubs, remove `to_dicts()` stub
- `python/examples/baseball-example.py`: Use `iterate_selected_dicts()` instead of `select().to_dicts()`
- `python/tests/test_unified_arbor.py`: Update tests that use `to_dicts()` to use `materialize_dicts()`

### Phase 5.5: Consolidate to `pick()` API (DONE)

**Goal**: Collapse 4 dict extraction methods into single `pick()` entry point.

**The Problem with Phase 5 Names**:
- 4 methods (`iterate_dicts`, `iterate_selected_dicts`, `materialize_dicts`, `materialize_selected_dicts`)
- Verbose, hard to remember
- Users need to learn 4 methods instead of 1

**The Solution**: Single `pick()` method

```python
pick(
    self,
    exprs: list[Expr | str] | None = None,
    *,
    mode: Literal["iterate", "materialize"] = "iterate",
) -> Iterator[dict] | list[dict]
```

**Semantics**:
- `exprs is None`: full tree dicts
- `exprs provided`: fused projection + dict extraction (fast path)
- `mode="iterate"` (default): streaming iterator (fast-by-default)
- `mode="materialize"`: eager list (explicit allocation)

**Mapping from existing methods**:
| Old Method | New Call |
|------------|----------|
| `iterate_dicts()` | `pick()` or `pick(mode="iterate")` |
| `iterate_selected_dicts(exprs)` | `pick(exprs)` |
| `materialize_dicts()` | `pick(mode="materialize")` |
| `materialize_selected_dicts(exprs)` | `pick(exprs, mode="materialize")` |

**Baseball Example Fix**:
```python
# Phase 5 (already better than to_dicts())
for d in players.iterate_selected_dicts([
    path("nameFirst").alias("first"),
    path("career_pitching.W").alias("wins"),
]):
    ...

# Phase 5.5 (clean, memorable)
for d in players.pick([
    path("nameFirst").alias("first"),
    path("career_pitching.W").alias("wins"),
]):
    ...
```

**Implementation Strategy**:

1. **Keep existing iterator classes** (`DictIterator`, `SelectedDictIterator`) as implementation details
2. **Add single `pick()` method** that dispatches to appropriate iterator:
   ```rust
   #[pyo3(signature = (exprs=None, *, mode="iterate"))]
   fn pick(
       slf: Py<Self>,
       py: Python<'_>,
       exprs: Option<ExprOrPaths<'_>>,  // Reuse existing type!
       mode: &str,
   ) -> PyResult<PyObject> {
       match (exprs, mode) {
           (None, "iterate") => {
               let iter = DictIterator { arbor: slf, ... };
               Ok(Py::new(py, iter)?.into_py(py))
           }
           (Some(e), "iterate") => {
               let rust_exprs = exprs_with_auto_alias(e);  // Auto-alias strings!
               let iter = SelectedDictIterator { arbor: slf, exprs: rust_exprs, ... };
               Ok(Py::new(py, iter)?.into_py(py))
           }
           (None, "materialize") => {
               // Reuse existing collect pattern (call __next__ until None)
               let iter = DictIterator { arbor: slf.clone(), ... };
               collect_iterator_to_list(py, iter)
           }
           (Some(e), "materialize") => {
               let rust_exprs = exprs_with_auto_alias(e);
               let iter = SelectedDictIterator { arbor: slf, exprs: rust_exprs, ... };
               collect_iterator_to_list(py, iter)
           }
           _ => Err(PyValueError::new_err("mode must be 'iterate' or 'materialize'"))
       }
   }
   ```

3. **Use `ExprOrPaths`** (existing type) for maximum ergonomics:
   - `pick("name")` works (single string → single-element list)
   - `pick(["name", "age"])` works (string list)
   - `pick([path("name"), path("age")])` works (Expr list)
   - Matches `select()`, `index_by()`, `group_by()` pattern exactly

4. **CRITICAL: Auto-alias string paths** (removes "special knowledge" requirement):
   ```rust
   fn exprs_with_auto_alias(exprs: ExprOrPaths<'_>) -> Vec<RustExpr> {
       let (pairs, _is_multi) = exprs.into_exprs_with_paths();
       pairs.into_iter().map(|(expr, original_path)| {
           // If original was a string path AND expr has no alias,
           // automatically set alias to the path string
           if let Some(path_str) = original_path {
               if expr.get_alias().is_none() {  // Use get_alias(), not has_alias()
                   return expr.alias(&path_str);
               }
           }
           expr
       }).collect()
   }
   ```
   - `pick(["name", "age"])` → dict keys are `"name"` and `"age"` automatically!
   - `pick([path("user.name").alias("n")])` → dict key is `"n"` (explicit alias wins)
   - `pick([path("user.name")])` → dict key is expression repr fallback (document in docstring)

5. **Extend `ExprOrPaths` to track original strings** (for auto-alias):
   ```rust
   impl<'py> ExprOrPaths<'py> {
       /// Convert to Vec<(Expr, Option<String>)> - expr + original path if was string
       fn into_exprs_with_paths(self) -> (Vec<(RustExpr, Option<String>)>, bool) {
           match self {
               ExprOrPaths::Single(e) => {
                   let (expr, path) = e.into_expr_with_path();
                   (vec![(expr, path)], false)
               }
               ExprOrPaths::List(items) => {
                   let pairs: Vec<_> = items.into_iter()
                       .map(|e| e.into_expr_with_path())
                       .collect();
                   (pairs, true)
               }
           }
       }
   }

   impl<'py> ExprOrPath<'py> {
       fn into_expr_with_path(self) -> (RustExpr, Option<String>) {
           match self {
               ExprOrPath::Expr(e) => (e.inner.clone(), None),
               ExprOrPath::Path(s) => (arbors::expr::path(&s), Some(s)),
           }
       }
   }
   ```

6. **Remove 4 old methods** (clean break):
   - `iterate_dicts()` → removed
   - `iterate_selected_dicts()` → removed
   - `materialize_dicts()` → removed
   - `materialize_selected_dicts()` → removed

**Files to modify**:
- `python/src/lib.rs`:
  - Add `pick()` method with dispatch logic
  - Remove 4 old methods
  - Keep `DictIterator`, `SelectedDictIterator` as internal
- `python/arbors/_arbors.pyi`:
  - Add `pick()` stub with overloads for return type
  - Remove 4 old method stubs
- `python/examples/baseball-example.py`:
  - Update to use `pick([...])` instead of `iterate_selected_dicts([...])`
- `python/tests/test_unified_arbor.py`:
  - Update tests to use `pick()` variants

**Type Stub Design** (overloads for precise return types):
```python
@overload
def pick(
    self,
    exprs: Expr | str | list[Expr | str] | None = None,
    *,
    mode: Literal["iterate"] = "iterate",
) -> Iterator[dict[str, Any]]: ...

@overload
def pick(
    self,
    exprs: Expr | str | list[Expr | str] | None = None,
    *,
    mode: Literal["materialize"],
) -> list[dict[str, Any]]: ...
```

Note: The `exprs` type matches `ExprOrPaths` - single or list of Expr/str.

**Docstring/API Surface**:
- Primary docs show only: `select(...) -> Arbor` and `pick(...) -> Iterator[dict] | list[dict]`
- `select()` = structural transform (chainable Arbor operations)
- `pick()` = dict extraction (Python-land processing)
- **Document edge case in docstring**: For Expr without alias (not from string path), dict key is expression repr (e.g., `"path(user.name).str.upper()"`)

### Phase 6: Polish

**Goal**: API feels natural and complete.

**Steps:**
1. Rust `ArborOps` trait to lock parity (optional but strong)
2. Rust tests cover new features broadly
3. Python parity tests
4. Verify baseball example is fast again

---

### Files to Modify (Complete List)

| File | Phase | Change |
|------|-------|--------|
| `python/src/lib.rs` | 1 | Refactor `Arbor` to enum-backed facade |
| `python/src/lib.rs` | 1 | Implement `__getitem__`, `__iter__`, `__len__` for all backings |
| `python/src/lib.rs` | 2 | Add `ArborStore.__getitem__`, internal session handle |
| `python/src/lib.rs` | 3 | Implement `filter() -> Arbor`, `select() -> Arbor`, `to_dicts()` |
| `python/arbors/__init__.py` | 4 | Remove `BatchedArbor`, `ReadTxn`, `WriteTxn` exports |
| `python/api_manifest.toml` | 4 | Remove from manifest |
| `python/arbors/_arbors.pyi` | 4 | Remove type stubs |
| `python/src/lib.rs` | 5 | Add `SelectedDictIterator`, `DictIterator` classes |
| `python/src/lib.rs` | 5 | Add `iterate_dicts()`, `iterate_selected_dicts()` (streaming) |
| `python/src/lib.rs` | 5 | Add `materialize_dicts()`, `materialize_selected_dicts()` (eager list) |
| `python/src/lib.rs` | 5 | **Remove `to_dicts()` entirely** (clean break) |
| `python/arbors/_arbors.pyi` | 5 | Add new method stubs, remove `to_dicts()` stub |
| `python/examples/baseball-example.py` | 5 | Use `iterate_selected_dicts()` |
| `python/tests/test_unified_arbor.py` | 5 | Update `to_dicts()` calls to `materialize_dicts()` |
| `python/src/lib.rs` | 5.5 | Add `pick()` with dispatch, remove 4 dict methods |
| `python/arbors/_arbors.pyi` | 5.5 | Add `pick()` with overloads, remove 4 stubs |
| `python/examples/baseball-example.py` | 5.5 | Update to use `pick([...])` |
| `python/tests/test_unified_arbor.py` | 5.5 | Update tests to use `pick()` variants |
| `crates/arbors-query/src/lib.rs` | 6 | `ArborOps` trait (optional) |
| `python/tests/test_api_parity.py` | 6 | Parity tests |

---

### Implementation Gotchas

**`Filtered` indexing semantics:**
- `filtered[i]` means "i-th element of the filtered view" (mapping through indices)
- Negative indexing must behave consistently across all backings
- `filtered[-1]` returns `source[indices[-1]]` (last element of filtered view)

**Circular references in `Filtered`:**
- `Filtered { source: Box<Arbor> }` is safe as long as no self-referential structures
- `filter()` on a filtered arbor produces NEW `Filtered` whose source is the filtered arbor
- Never try to "merge" filters in-place

**Cost model for `__iter__`:**
- Don't accidentally decode the same batch repeatedly (e.g., via `__getitem__` path from iteration)
- Stored-backed iterator should iterate batches directly, not call `__getitem__(i)` N times

**`select()` on stored backing:**
- Materializes to in-memory `Arbor`
- Implement via pipeline executor returning `ExprResult`s, then build new `Arbor`
- Do NOT route through Python dict conversion (stay in Rust)

**`pick()` ordering:**
- MUST match iteration order exactly
- This is the *only* ordering guarantee

**`select()` alias behavior:**
- Aliases work as they do today (field names from alias or path)
- `schema: None` on output initially (simplicity)

**Export removal scope:**
- `python/arbors/__init__.py` - remove exports
- `python/api_manifest.toml` - remove from manifest
- `python/arbors/_arbors.pyi` - remove type stubs
- Also update any docs/tests referencing `ReadTxn/WriteTxn/BatchedArbor`

**Error behavior when arbor is "closed" but session still alive:**
- `repr(arbor)` shows "closed" state
- `arbor["x"]` after `arbor.close()` raises immediately
- Existing arbors keep working (they hold refs to session state)

**`Filtered` preserves stable ordering:**
- Yes, it's index-based so ordering is deterministic
- `filtered[i]` always returns same tree for same `i`

**`__len__` computation:**
- Same API everywhere: `len(arbor)` works uniformly
- `InMemory`: delegates to inner `len()`
- `Stored`: uses metadata (same as inner `len()`)
- `Filtered`: `len(indices)`

---

### Success Criteria

- `arbor["players"]` returns unified `Arbor`
- `for tree in arbor` works naturally for all backings
- `arbor[i]` works for all backings (random access, including negative indices)
- `filter()` returns `Arbor` (consistent across backings)
- **`select()` returns `Arbor`** (consistent across backings - semantic interchangeability preserved)
- **`pick(exprs)` is the fast path** for analytics-style dict extraction (with projection pushdown!)
- **Single dict extraction API**: only `pick()` exposed, no 4 separate methods
- `pick()` works for all backings (InMemory, Stored, Filtered)
- `pick()` accepts string paths or Expr objects (matches `select`, `index_by` ergonomics)
- No `BatchedArbor`, `ReadTxn`, `WriteTxn` in public API
- No transactions exposed in typical usage
- Session lifetime is ref-counted (stored arbors keep session alive)
- **Baseball example uses `pick([...])` and runs in ~40ms**

---

## Phase 1 Detailed Refactoring Plan: ArborBacking

### Why the Previous Attempt Failed

The naive approach of global search-replace for `self.inner.` → `self.inner().` broke because:
1. **Multiple structs have `inner` fields**: `Expr`, `IndexedView`, `LazyArbor`, `PyLazyTree`, `PyReadTxn`
2. **Pattern variations**: `self.inner.`, `arbor.inner.`, `arbor_ref.inner.`, `&self.inner`
3. **Struct constructions**: `Arbor { inner: ..., schema: ... }` needs different treatment

### Pattern Inventory (from code analysis)

| Pattern | Count | Location |
|---------|-------|----------|
| `self.inner.` (Arbor methods) | 152 | Lines 1520-2989, 3296+, 4055+, 5911+, 6000+, 8600+, 9000+, 11100+, 12100+ |
| `arbor_ref.inner.` / `arbor.inner.` | 75 | Tree/Node impl blocks (4476+, 6205+) |
| `Arbor { inner: ..., schema: ... }` | 51 | Throughout file |
| `&self.inner` (borrows) | 16 | Various impl blocks |

### Structs to NOT Touch (also have `inner` field)

| Struct | Line | Field Type |
|--------|------|------------|
| `Expr` | 8673 | `inner: RustExpr` |
| `IndexedView` | 3296 | `inner: arbors_query::IndexedView` |
| `LazyArbor` | 4055 | `inner: RustLazyArbor` |
| `PyLazyTree` | 5911 | `inner: RustLazyTree` |
| `PyReadTxn` | 12004 | `inner: Option<OwnedReadTxn>` |

---

### Safe Refactoring Strategy: Helper Method Approach

**Key insight**: Instead of changing every `self.inner.foo()` to `self.backing.inner().foo()`, introduce a helper method `inner()` that returns `&arbors::Arbor`. This minimizes actual code changes.

#### Step 1: Define the Enum and Change the Struct (3 edits)

**1a. Add ArborBacking enum** (insert before Arbor struct, around line 1510):
```rust
/// Internal backing storage for Arbor - hidden from Python users
#[derive(Clone)]
enum ArborBacking {
    /// In-memory arbor (from read_json, read_jsonl, etc.)
    InMemory(arbors::Arbor),
    // Future variants:
    // Stored { session: Arc<SessionState>, name: String, ... },
    // Filtered { source: Box<Arbor>, indices: Vec<usize> },
}
```

**1b. Change Arbor struct field** (around line 1513):
```rust
// FROM:
pub struct Arbor {
    inner: arbors::Arbor,
    schema: Option<Py<Schema>>,
}

// TO:
pub struct Arbor {
    backing: ArborBacking,
    schema: Option<Py<Schema>>,
}
```

**1c. Add inner() helper method** (insert at start of impl Arbor, around line 1520):
```rust
impl Arbor {
    /// Get the underlying arbors::Arbor (works for all backings)
    fn inner(&self) -> &arbors::Arbor {
        match &self.backing {
            ArborBacking::InMemory(arbor) => arbor,
        }
    }

    /// Get mutable access (only for InMemory backing currently)
    fn inner_mut(&mut self) -> &mut arbors::Arbor {
        match &mut self.backing {
            ArborBacking::InMemory(arbor) => arbor,
        }
    }

    // ... rest of impl
}
```

#### Step 2: Fix Self-Access Patterns (scoped replacements)

**CRITICAL**: Use line-number-scoped replacements to avoid touching other structs.

**2a. Replace `self.inner.` with `self.inner().` in Arbor impl blocks only**

The Arbor impl block spans approximately lines 1520-2989 (main impl) plus additional pymethods blocks. Use a Python script to do scoped replacement:

```python
#!/usr/bin/env python3
"""
Safe scoped replacement for Arbor refactor.
Only replaces patterns within Arbor-related impl blocks.
"""
import re

# Read the file
with open('python/src/lib.rs', 'r') as f:
    content = f.read()
    lines = content.split('\n')

# Arbor impl block ranges (conservative - identified from analysis)
# These are approximate ranges where Arbor's self.inner is used
ARBOR_IMPL_RANGES = [
    (1520, 3000),   # Main Arbor impl and pymethods
    (3296, 3400),   # IndexedView uses arbor_ref.inner - skip self.inner here
    (5900, 6200),   # Some Arbor-related code
    (8600, 9500),   # Expr-heavy - but some Arbor patterns
    (11100, 11300), # More Arbor patterns
    (12100, 12800), # More Arbor patterns
]

# Pattern: self.inner. but NOT already self.inner()
# We want to add () to make it a method call
def should_replace(line_num, line_content):
    """Check if this line is in an Arbor impl block and has the pattern."""
    # Skip if already using inner()
    if 'self.inner()' in line_content:
        return False
    # Skip IndexedView, Expr, LazyArbor, PyReadTxn self.inner patterns
    # These structs have their own inner fields
    if 'IndexedView' in line_content or 'Expr {' in line_content:
        return False
    # Only replace in Arbor impl ranges
    for start, end in ARBOR_IMPL_RANGES:
        if start <= line_num <= end:
            return 'self.inner.' in line_content
    return False

# This is just for COUNTING - actual replacement needs more care
count = 0
for i, line in enumerate(lines, 1):
    if should_replace(i, line):
        count += 1
        print(f"Line {i}: {line.strip()[:80]}")

print(f"\nTotal lines to check: {count}")
```

**However**, the safer approach is to NOT use automated replacement, but instead:
1. Add the `inner()` helper method
2. Change `self.inner` to `self.inner()` **manually** or with very targeted sed
3. Verify with `cargo build` after each block

**2b. The actual replacement pattern**:
```bash
# ONLY in Arbor impl - use sed with line ranges
# Main Arbor impl block (approximate)
sed -i '' '1520,3000s/self\.inner\./self.inner()./g' python/src/lib.rs
```

**WARNING**: This is still risky. Better approach below.

#### Step 3: Fix Struct Constructions (51 sites)

Every `Arbor { inner: X, schema: Y }` becomes `Arbor { backing: ArborBacking::InMemory(X), schema: Y }`.

**Pattern transformation**:
```rust
// FROM:
Arbor {
    inner: some_arbor,
    schema: self.schema.clone(),
}

// TO:
Arbor {
    backing: ArborBacking::InMemory(some_arbor),
    schema: self.schema.clone(),
}
```

**Construction sites** (51 locations - line numbers):
```
1882, 2035, 2073, 2154, 2279, 2319, 2499, 2596, 2619, 2656, 2684, 2710,
2752, 2794, 2860, 2882, 3238, 3426, 3452, 3787, 4322, 4363, 5100, 5193,
5295, 5375, 5434, 5473, 5521, 5566, 5617, 5662, 5708, 5757, 6144, 7014,
7131, 7199, 7277, 7525, 8063, 8364, 8410, 10636, 10646, 10933, 11478,
11667, 11859, 12232, 12462
```

#### Step 4: Fix External Access Patterns (75 sites)

Patterns like `arbor_ref.inner.method()` where arbor_ref is a `PyRef<Arbor>` or `&Arbor`.

**Transformation**:
```rust
// FROM:
arbor_ref.inner.num_trees()

// TO:
arbor_ref.inner().num_trees()
```

These are primarily in:
- Tree impl block (lines 4476+)
- Node impl block (lines 6205+)
- Various helper functions

---

### Recommended Implementation Order

**Phase 1A: Minimal Viable Change (compile first)**

1. **Add enum above Arbor struct** (~line 1510)
2. **Change Arbor struct**: `inner:` → `backing:`
3. **Add `inner()` and `inner_mut()` helper methods**
4. **Run `cargo build`** - expect ~300 errors

**Phase 1B: Fix compilation errors incrementally**

5. **Fix struct constructions first** (51 sites)
   - These cause "no field `inner`" errors
   - Each is a simple wrap: `inner: X` → `backing: ArborBacking::InMemory(X)`

6. **Fix `self.inner.` patterns** (152 sites)
   - Add `()` after `inner`: `self.inner.` → `self.inner().`
   - Work through Arbor impl blocks only

7. **Fix external access patterns** (75 sites)
   - `arbor_ref.inner.` → `arbor_ref.inner().`
   - `arbor.inner.` → `arbor.inner().`

8. **Fix borrow patterns** (16 sites)
   - `&self.inner` → `self.inner()` (already returns a reference)

9. **Run `cargo build`** - should compile

10. **Run `make test`** - verify behavior unchanged

---

### Verification Commands

After each phase:
```bash
# Check compilation
cargo build -p arbors-python 2>&1 | head -50

# Count remaining errors
cargo build -p arbors-python 2>&1 | grep -c "^error"

# After all fixes
make python && make test
```

---

### Why This Approach is Safe

1. **Helper method minimizes text changes**: Instead of changing semantics, we add a layer of indirection
2. **Incremental verification**: Compile after each batch of changes
3. **Scoped changes**: Only touch Arbor-related code, not Expr/IndexedView/etc.
4. **Same runtime behavior**: `inner()` returns the same `&arbors::Arbor` as direct field access did

---

### Future Backing Variants (not in Phase 1)

When we add `Stored` and `Filtered` variants:

```rust
enum ArborBacking {
    InMemory(arbors::Arbor),
    Stored {
        session: Arc<SessionState>,
        name: String,
        // ... metadata
    },
    Filtered {
        source: Box<Arbor>,
        indices: Vec<usize>,
    },
}
```

The `inner()` method will need to change:
- `Stored`: Load from session or error
- `Filtered`: Return source's inner (for compatible operations)

But for Phase 1, we only have `InMemory`, so `inner()` is trivial.

---

## Compiler-Driven Refactor Workflow (Detailed)

This is the safest, most reliable approach: make structural changes, then let the compiler tell us exactly what to fix.

### Step-by-Step Execution Plan

#### Step 1: Make the Three Core Changes (Creates ~300 errors)

**Edit 1**: Add `ArborBacking` enum (before `pub struct Arbor`):

```rust
/// Internal backing storage for Arbor - hidden from Python users
#[derive(Clone)]
enum ArborBacking {
    /// In-memory arbor (from read_json, read_jsonl, etc.)
    InMemory(arbors::Arbor),
}
```

**Edit 2**: Change `Arbor` struct:
```rust
// Change this line:
    inner: arbors::Arbor,
// To:
    backing: ArborBacking,
```

**Edit 3**: Add helper methods at the START of `impl Arbor {`:
```rust
    /// Get the underlying arbors::Arbor (works for all backings)
    fn inner(&self) -> &arbors::Arbor {
        match &self.backing {
            ArborBacking::InMemory(arbor) => arbor,
        }
    }

    /// Get mutable access to the underlying arbors::Arbor
    fn inner_mut(&mut self) -> &mut arbors::Arbor {
        match &mut self.backing {
            ArborBacking::InMemory(arbor) => arbor,
        }
    }
```

**Verify**: `cargo build -p arbors-python 2>&1 | grep -c "^error"` → expect ~300 errors

---

#### Step 2: Categorize and Fix Errors by Type

Run `cargo build` and categorize errors. They will fall into these buckets:

**Error Type A: "struct `Arbor` has no field named `inner`"** (~51 errors)
- These are struct constructions: `Arbor { inner: X, schema: Y }`
- Fix: `Arbor { backing: ArborBacking::InMemory(X), schema: Y }`

**Error Type B: "field `inner` of struct `Arbor` is private"** (~75 errors)
- External access: `arbor_ref.inner.method()` or `arbor.inner.method()`
- Fix: Add `()` after `inner`: `arbor_ref.inner().method()`

**Error Type C: "attempted to take value of method `inner`"** (~150 errors)
- Self access where we forgot `()`: `self.inner.method()`
- Fix: `self.inner().method()`

**Error Type D: "cannot borrow as mutable"** (~5 errors)
- Mutable access needed: `self.inner.some_mut_method()`
- Fix: `self.inner_mut().some_mut_method()`

---

#### Step 3: Fix Errors in Batches

**Batch 1: Fix struct constructions (Type A)**

Find all with: `cargo build -p arbors-python 2>&1 | grep "no field named \`inner\`"`

These are easy - just wrap the value:
```rust
// Find lines like:
Arbor { inner: X, schema: Y }
// Replace with:
Arbor { backing: ArborBacking::InMemory(X), schema: Y }
```

**Batch 2: Fix external access (Type B)**

Find all with: `cargo build -p arbors-python 2>&1 | grep "field \`inner\` of struct"`

Pattern: `VARIABLE.inner.` → `VARIABLE.inner().`

Where VARIABLE is: `arbor`, `arbor_ref`, `arbor_py`, `self_arbor`, etc.

**Batch 3: Fix self access (Type C)**

Find all with: `cargo build -p arbors-python 2>&1 | grep "attempted to take value of method"`

Pattern: `self.inner.` → `self.inner().`

**CRITICAL**: Only fix in Arbor impl blocks! Check the line number - if it's in Expr, IndexedView, etc., DON'T change it.

**Batch 4: Fix mutable access (Type D)**

Pattern: Code that needs `&mut arbors::Arbor`
- `self.inner.` where the method mutates → `self.inner_mut().`

---

#### Step 4: Special Cases to Watch For

**Case 1: Clone then modify**
```rust
// FROM:
let inner_clone = self.inner.clone();

// TO:
let inner_clone = self.inner().clone();
```

**Case 2: Borrow for function call**
```rust
// FROM:
arbors::arbor_to_json(&self.inner)

// TO:
arbors::arbor_to_json(self.inner())  // inner() already returns &
```

**Case 3: Pattern matching on inner**
```rust
// If any code does:
match self.inner { ... }

// Needs:
match self.inner() { ... }  // or match &self.backing { ... }
```

**Case 4: Expr.inner and IndexedView.inner**

These should NOT be changed - they have their own `inner` fields. If you see errors like:
```
error[E0609]: no field `inner` on type `&Expr`
```
at lines 8673+, 3296+, 4055+, 5911+, 12004+ - **leave them alone**, they're different structs.

---

#### Step 5: Final Verification

```bash
# Should compile with no errors
cargo build -p arbors-python

# Run tests
make python && make test

# Specifically test Python bindings work
.venv/bin/python -c "import arbors; a = arbors.read_json('[1,2,3]'); print(len(a))"
```

---

### Error Count Expectations

| After Step | Expected Errors |
|------------|-----------------|
| Step 1 (structural changes) | ~300 |
| After fixing struct constructions | ~250 |
| After fixing external access | ~175 |
| After fixing self access | ~25 |
| After fixing mutable access | 0 |

---

### Rollback Plan

If something goes wrong:
```bash
git checkout python/src/lib.rs
```

We're only modifying one file, so rollback is simple.

---

### Time Estimate

- Step 1 (structural changes): 5 minutes
- Step 2-4 (fixing errors): 30-45 minutes (mostly mechanical)
- Step 5 (verification): 5 minutes

Total: ~45 minutes for a clean refactor

---

## Phase 7: Add `any()` and `all()` with Backing-Aware Dispatch

### Goal

Add `any(predicate)` and `all(predicate)` methods to the unified `Arbor` type with proper early-exit semantics for ALL backings.

### Why Backing-Aware Dispatch Matters

Both operations benefit from early-exit:
- `any(predicate)` - returns `true` on **first match** (no need to scan rest)
- `all(predicate)` - returns `false` on **first non-match** (no need to scan rest)

Using `materialize_if_stored()` would defeat this by loading ALL data first.

### Existing Rust Infrastructure

`PipelineExecutor` already has optimal implementations (`executor.rs:789-830`):

```rust
// any() - uses find_one_index for early-exit
pub fn any(&self, predicate: &Expr) -> Result<bool, PipelineError> {
    Ok(self.find_one_index(predicate)?.is_some())
}

// all() - uses ControlFlow::Break on first non-match
pub fn all(&self, predicate: &Expr) -> Result<bool, PipelineError> {
    let plan = analyze_required_pools(predicate, self.source.schema());
    let mut all_true = true;
    self.source.for_each_tree_with_plan(plan, |arbor, local_idx, _global_idx| {
        // ... evaluates predicate, breaks on first non-true
    })?;
    Ok(all_true)
}
```

### Implementation Steps

#### Step 1: Add Rust Convenience Functions

**File**: `crates/arbors-pipeline/src/lib.rs`

Add after `aggregate()` (around line 233):

```rust
/// Check if any tree matches the predicate (early-exit on first match).
///
/// This is a convenience function that creates an `InMemorySource` internally.
/// For batched sources or more control, use `PipelineExecutor` directly.
///
/// # Semantics
///
/// Returns `true` if at least one tree evaluates to `true`, `false` otherwise.
/// Short-circuits on first match (does not evaluate remaining trees).
///
/// # Example
///
/// ```text
/// use arbors_pipeline::any;
/// use arbors_expr::{path, lit};
///
/// let has_adult = any(&arbor, &path("age").ge(lit(18)))?;
/// ```
pub fn any(
    arbor: &Arbor,
    predicate: &arbors_expr::Expr,
) -> Result<bool, source::PipelineError> {
    let src = source::InMemorySource::new(arbor.clone());
    executor::PipelineExecutor::new(src).any(predicate)
}

/// Check if all trees match the predicate (early-exit on first non-match).
///
/// This is a convenience function that creates an `InMemorySource` internally.
/// For batched sources or more control, use `PipelineExecutor` directly.
///
/// # Semantics
///
/// Returns `true` if all trees evaluate to `true`, `false` otherwise.
/// Short-circuits on first non-match (does not evaluate remaining trees).
/// Trees evaluating to `null` or `Missing` are treated as non-matches.
///
/// # Example
///
/// ```text
/// use arbors_pipeline::all;
/// use arbors_expr::{path, lit};
///
/// let all_adults = all(&arbor, &path("age").ge(lit(18)))?;
/// ```
pub fn all(
    arbor: &Arbor,
    predicate: &arbors_expr::Expr,
) -> Result<bool, source::PipelineError> {
    let src = source::InMemorySource::new(arbor.clone());
    executor::PipelineExecutor::new(src).all(predicate)
}
```

#### Step 2: Export from `arbors::lazy`

**File**: `crates/arbors/src/lib.rs` (around line 178)

Add `any` and `all` to the re-exports:

```rust
pub use arbors_pipeline::{
    // ... existing exports ...
    add_fields,
    aggregate,
    all,        // NEW
    any,        // NEW
    execute_plan,
    // ...
};
```

#### Step 3: Add Python Methods with Backing-Aware Dispatch

**File**: `python/src/lib.rs`

Add after `find_one_or_error` (around line 2363):

```rust
/// Check if any tree matches the predicate.
///
/// Returns True if at least one tree satisfies the predicate.
/// Uses early-exit semantics - stops scanning on first match.
///
/// Args:
///     expr: The predicate expression to evaluate
///
/// Returns:
///     bool: True if any tree matches, False otherwise
///
/// Example:
///     >>> has_adult = arbor.any(path("age") >= 18)
///     >>> has_active = arbor.any(path("active") == True)
#[pyo3(signature = (expr))]
fn any(&self, expr: &Expr) -> PyResult<bool> {
    match &self.backing {
        ArborBacking::InMemory(arbor) => {
            arbors::lazy::any(arbor, &expr.inner)
                .map_err(pipeline_error_to_py_err)
        }
        ArborBacking::Stored { session, name, .. } => {
            session.with_snapshot(|txn| {
                let batched = txn
                    .get_batched(name)?
                    .ok_or_else(|| arbors_base::ArborStoreError::NotFound(name.clone()))?;
                let source = arbors::lazy::BatchedSource::new(&batched);
                let executor = arbors::lazy::PipelineExecutor::new(source);
                executor.any(&expr.inner)
                    .map_err(|e| arbors_base::ArborStoreError::Other(e.to_string()))
            })
            .map_err(arborbase_error_to_py_err)
        }
    }
}

/// Check if all trees match the predicate.
///
/// Returns True if every tree satisfies the predicate.
/// Uses early-exit semantics - stops scanning on first non-match.
///
/// Args:
///     expr: The predicate expression to evaluate
///
/// Returns:
///     bool: True if all trees match, False otherwise
///
/// Example:
///     >>> all_adults = arbor.all(path("age") >= 18)
///     >>> all_active = arbor.all(path("active") == True)
#[pyo3(signature = (expr))]
fn all(&self, expr: &Expr) -> PyResult<bool> {
    match &self.backing {
        ArborBacking::InMemory(arbor) => {
            arbors::lazy::all(arbor, &expr.inner)
                .map_err(pipeline_error_to_py_err)
        }
        ArborBacking::Stored { session, name, .. } => {
            session.with_snapshot(|txn| {
                let batched = txn
                    .get_batched(name)?
                    .ok_or_else(|| arbors_base::ArborStoreError::NotFound(name.clone()))?;
                let source = arbors::lazy::BatchedSource::new(&batched);
                let executor = arbors::lazy::PipelineExecutor::new(source);
                executor.all(&expr.inner)
                    .map_err(|e| arbors_base::ArborStoreError::Other(e.to_string()))
            })
            .map_err(arborbase_error_to_py_err)
        }
    }
}
```

#### Step 4: Add Type Stubs

**File**: `python/arbors/_arbors.pyi`

Add to the `Arbor` class:

```python
def any(self, expr: Expr) -> bool:
    """Check if any tree matches the predicate (early-exit on first match)."""
    ...

def all(self, expr: Expr) -> bool:
    """Check if all trees match the predicate (early-exit on first non-match)."""
    ...
```

#### Step 5: Add Parity Tests

**File**: `python/tests/test_api_parity.py`

Add `any` and `all` to `REQUIRED_METHODS` list and add test class:

```python
class TestAnyAllParity:
    """Test any() and all() parity."""

    def test_any_returns_bool(self, both_arbors):
        inmem, stored = both_arbors
        assert isinstance(inmem.any(path("age") > 25), bool)
        assert isinstance(stored.any(path("age") > 25), bool)

    def test_any_same_results(self, both_arbors):
        inmem, stored = both_arbors
        # Some trees have age > 30
        assert inmem.any(path("age") > 30) == stored.any(path("age") > 30) == True
        # No trees have age > 100
        assert inmem.any(path("age") > 100) == stored.any(path("age") > 100) == False

    def test_all_returns_bool(self, both_arbors):
        inmem, stored = both_arbors
        assert isinstance(inmem.all(path("age") > 20), bool)
        assert isinstance(stored.all(path("age") > 20), bool)

    def test_all_same_results(self, both_arbors):
        inmem, stored = both_arbors
        # All trees have age > 20
        assert inmem.all(path("age") > 20) == stored.all(path("age") > 20) == True
        # Not all trees have age > 30
        assert inmem.all(path("age") > 30) == stored.all(path("age") > 30) == False
```

### Files to Modify

| File | Change |
|------|--------|
| `crates/arbors-pipeline/src/lib.rs` | Add `any()` and `all()` convenience functions |
| `crates/arbors/src/lib.rs` | Export `any` and `all` from `lazy` module |
| `python/src/lib.rs` | Add `any()` and `all()` with backing-aware dispatch |
| `python/arbors/_arbors.pyi` | Add type stubs |
| `python/tests/test_api_parity.py` | Add `any` and `all` to REQUIRED_METHODS, add tests |

### Verification

```bash
# Build
make python

# Test new methods work
.venv/bin/python -c "
import arbors as aq
from arbors import path
a = aq.read_jsonl(b'{\"age\": 25}\n{\"age\": 35}')
print('any(age > 30):', a.any(path('age') > 30))  # True
print('all(age > 20):', a.all(path('age') > 20))  # True
print('all(age > 30):', a.all(path('age') > 30))  # False
"

# Run parity tests
.venv/bin/pytest python/tests/test_api_parity.py -v
```

### Success Criteria (Updated)

Add to the existing success criteria:
- `any(predicate)` works for all backings with early-exit semantics
- `all(predicate)` works for all backings with early-exit semantics
- Both methods are in the REQUIRED_METHODS list for parity testing
