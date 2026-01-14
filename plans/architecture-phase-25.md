## Phase 25: Arbor-centric API with Consistent Execution Model

**Purpose:** Establish a consistent eager/lazy execution model and make storage feel like just another file format. Developers work with `Arbor` as the primary interface—the execution model and storage are implementation details. **Everything is Arbor-in, Arbor-out.**

**Core principle:** A `.arbors` file contains named Arbors.

**Scope:**
1. Make all Arbor handle methods EAGER (errors now; may return view or materialized result)
2. Add ALL operations to ArborPlan for LAZY execution (including mutations)
3. Add module-level storage functions (`open`, `list`, `delete`)
4. Add `arbors.save_multiple()` for atomic multi-Arbor saves
5. Add instance methods to Arbor (`save`, `refresh`)
6. Improve Tree ergonomics (TreePlan + Tree.save)
7. Hide `ArborStoreSession` from Python public API
8. Full parity: Rust/Python, in-memory/stored

**Non-goals (explicitly out of scope):**
- True lazy `concat()` with binary plan nodes (future optimization)
- Changing `ArborStoreOptions` API
- EagerMode/LazyMode toggle (use `plan()` as explicit lazy mode)
- Exposing transactions/snapshots in the public mental model
- Cache warming API (`warm()` removed from public API)

**Dependencies / prerequisites:**
- `ArborStoreSession` rename (completed)
- Existing `Session`, `Snapshot`, `ArborStore` infrastructure in `arbors-store`
- Existing `OwnedReadTxn` and `OwnedWriteTxn` transaction types (internal use only)

---

### 25.0 Design Decisions

#### 25.0.1 Eager Handle, Lazy Plan (DECIDED)

**Decision:** All Arbor handle methods are **EAGER**; `ArborPlan` is the **LAZY** escape hatch.

**Rationale:**
- Predictable behavior: operations execute when called, errors surface immediately
- Matches mental model: `result = arbor.filter(p)` computes result now
- Performance-critical users opt into lazy mode explicitly via `plan()`
- Consistent with Polars eager vs lazy DataFrame pattern

**Implications:**
- **Eager does NOT mean “materialize into memory”.** Eager means: **validate + do the required work now so errors surface now**.
- Handle methods may still return **views** over existing data (including stored data). Example: “eager indices, lazy data” is valid and desirable.
- Slices (`head`, `tail`, `take`, etc.) change from “build plan node only” → “validate and (when needed) compute selection eagerly”
- Sorts (`sort_by`, etc.) change from “build plan node only” → “compute permutation eagerly”
- Mutations (`append`, `insert`, `set`, `remove`) change from “build plan node only” → “validate eagerly; compute mutation bookkeeping eagerly”
- ArborPlan gains all mutation methods for lazy execution

#### 25.0.2 ArborPlan Completeness (DECIDED)

**Decision:** ArborPlan supports ALL operations that Arbor handle supports, for full lazy pipelining.

**Rationale:**
- Users building complex pipelines should never need to leave lazy mode
- Mutations are semantically no different from queries—both transform arbors
- Enables: `arbor.plan().filter(p).append(trees).sort_by(k).head(10).collect()`

**Implications:**
- Add mutation methods: `append`, `insert`, `set`, `remove`, `concat`
- Add missing slice methods: `take`, `sample`, `shuffle`, `reverse`
- All return `Self` for chaining; execute at `collect()` / `materialize()`

#### 25.0.3 Index Validation Timing (DECIDED)

**Decision:** Index validation happens at execution time, not plan-building time.

**Rationale:**
- Consistent with lazy filter (predicate errors deferred to collect)
- Plan building should be infallible for ergonomic chaining
- Matches behavior: `plan.insert(100, trees)` on 10-tree arbor fails at `collect()`

**Implications:**
- `ArborPlan.insert()`, `set()`, `remove()` return `Self`, not `Result<Self>`
- Errors surface at `collect()` / `materialize()`
- Documentation must clarify error timing

#### 25.0.4 API Style: Module Functions (DECIDED)

**Decision:** Use module-level functions (Python) / free functions (Rust) for storage operations.

**Rationale:**
- Matches existing `read_jsonl` pattern
- Follows Python data library conventions (pandas, polars)
- Consistent API: `arbors.read_jsonl()` and `arbors.open()`

**Implications:**
- Python exports `arbors.open()`, not `Arbor.open()`
- Instance methods (`save`, `refresh`) remain on `Arbor`

#### 25.0.5 Atomic Multi-Arbor Saves via `save_multiple()` (DECIDED)

**Decision:** Provide `arbors.save_multiple(path, ...)` for atomic multi-Arbor saves.

**Rationale:**
- Single `save()` auto-commits for simplicity in common case
- Batch saves need atomicity guarantee (all-or-nothing)
- Keep the user-facing API Arbor-centric: pass Arbors in, get errors out; no exposed context/transaction objects
- **No transactions or snapshots in the public mental model**—just Arbors

**User-facing API:**
```python
# Simple case - auto-commit
users.save("/tmp/data.arbors", "users")

# Atomic case - multiple Arbors saved in one call (dict style)
arbors.save_multiple("/tmp/data.arbors", {"users": users, "orders": orders})
```

**Implications:**
- Add `arbors.save_multiple()` module function
- `save_multiple()` writes all named Arbors in a single internal write transaction and commits atomically
- Rust: returns `Result<(), ArborStoreError>`; Python: returns `None`, raises on failure
- No partial writes on error
- Internally uses `OwnedWriteTxn`—but this is hidden from users

**Edge cases:**
- Empty dict `{}` → no-op (valid, commits empty transaction)
- Duplicate names → last-write-wins **if duplicates appear**.
  - **Determinism rule:** This is only deterministic if the caller’s input iteration order is deterministic and the implementation preserves that order (no internal reordering).
  - **Rust note:** `HashMap` iteration order is unspecified, so passing a `HashMap` with duplicates (or constructing the iterator in a non-deterministic order) can make “last” non-deterministic. Prefer an ordered iterator (e.g., a `Vec<(String, Arbor)>`, or a `BTreeMap` if you want key-sorted order).
  - **Python note:** `dict` preserves insertion order, so “last-write-wins” is deterministic for a given dict literal/construction order.
- Names that already exist in file → overwrite (same as single `save()`)

#### 25.0.6 No Transactions in Public API (DECIDED)

**Decision:** Remove `ReadTxn`, `WriteTxn`, `read_txn()`, `write_txn()` from the public API. Use `save_multiple()` for atomic batch writes and `open()` for reads.

**Rationale:**
- **Everything is Arbor-in, Arbor-out**
- Developers should think about Arbors, not transactions or snapshots
- `save_multiple()` covers the batch-write use case
- `open()` returns an Arbor directly—no intermediate transaction object
- Simpler mental model: files contain named Arbors; you save and open Arbors

**Implications:**
- Remove `ReadTxn`, `WriteTxn` from Python public exports
- Remove `read_txn()`, `write_txn()` module functions
- Keep transaction types internal for implementation
- `open()` is the only way to read; `save()` + `save_multiple()` are the only ways to write

#### 25.0.7 Hide ArborStoreSession (DECIDED)

**Decision:** Remove `ArborStoreSession` from Python public API.

**Rationale:**
- Developers should think about Arbors, not stores
- Module functions provide all needed functionality
- No transaction types exposed—`save_multiple()` handles batch operations

**Implications:**
- Keep `ArborStoreOptions`, `ArborStoreError`, `ArborStoreStats` (configuration types)
- Hide `ArborStoreSession`, `ReadTxn`, `WriteTxn`, `WarmOptions` (implementation details)
- Internal implementation unchanged

#### 25.0.8 Storage Model: "Files contain named Arbors" (DECIDED)

**Decision:** Storage is exposed via module/free functions (`open`, `list`, `delete`, `save_multiple`) and the `save()` instance method. The mental model is: **a `.arbors` file contains named Arbors**.

**Rationale:**
- The previous "Session + cached snapshot + transactions" mental model was hard to internalize
- The user intent is simply: "save this Arbor", "open that Arbor", "save these Arbors atomically"
- Transactions, snapshots, and MVCC are implementation details users shouldn't need to know

**User-facing mental model (Rust + Python):**
- A `.arbors` **file** contains **named Arbors**
- `arbors.open(path, name)` → `Arbor` — open a named Arbor from a file
- `arbor.save(path, name)` — save an Arbor to a file under a name
- `arbors.save_multiple(path, {...})` — save multiple named Arbors atomically
- `arbors.list(path)` → `list[str]` — list names of Arbors in a file
- `arbors.delete(path, name)` → `bool` — delete a named Arbor from a file
- `arbor.refresh()` → `Arbor` — get a fresh view (for stored Arbors only)

#### 25.0.9 Internal Transaction Wrappers (DECIDED)

**Decision:** Internally, the Rust façade uses safe wrapper types over `arbors-store` transactions, but these are not exposed publicly.

**Rationale:**
- `arbors-store::{OwnedReadTxn, OwnedWriteTxn}` require careful lifetime management
- Internal wrappers (snapshots + internal write transaction helpers) handle this safely
- Public API is purely Arbor-centric

**Implications:**
- Internal write helper wraps `Arc<ArborStore>` + `OwnedWriteTxn` for `save_multiple()`
- `open()` internally creates a snapshot, extracts the Arbor, manages lifetimes
- All transaction complexity is hidden from users

#### 25.0.10 Breaking Change: `Arbor::refresh()` Signature (DECIDED)

**Decision:** Change `Arbor::refresh()` signature from `Result<(), PipelineError>` to `Result<Self, PipelineError>`.

**Rationale:**
- Current implementation is a no-op that returns `Ok(())`
- Correct semantics require returning a NEW arbor bound to a fresh snapshot
- Matches immutable Arbor design: operations return new Arbors, never mutate

**Breaking change:**
- Existing calls to `arbor.refresh()` that ignore the result will need to capture the returned Arbor
- Code pattern changes from `arbor.refresh()?;` to `let arbor = arbor.refresh()?;`

**Implications:**
- Update `handle/mod.rs` implementation
- Update Python bindings
- Update all tests and examples

#### 25.0.11 Tree Ergonomics: "Pail" API for Single JSON Object (DECIDED)

**Decision:** Treat `Tree` as a first-class "single Arbor row" with Arbor-consistent eager/lazy semantics.

**Goals:**
- Great ergonomics for the common case: "I have one JSON object"
- Preserve the Phase 25 principle: **Everything is Arbor-in, Arbor-out** (storage is named Arbors)
- Avoid surprising cardinality changes when planning a single tree (e.g., explode)

**API decisions:**
- `Tree.save(path, name)` exists and is sugar for saving a single-tree Arbor under `name`. Inherits schema from source Arbor if available.
- `Tree.plan()` returns a `TreePlan`.
- `TreePlan.collect()` returns an `Arbor` (0..N trees; supports explode).
- `TreePlan.collect_tree()` returns a `Tree` and **errors unless the result cardinality is exactly 1**.

**Breaking change (intentional):** Replace the existing `TreePlan` implementation and API surface (tree-structure edit plan) with this new Arbor-consistent `TreePlan`.
- Existing Python `TreePlan` operations like `remove_field`, `delete_subtree`, `ensure_path`, etc. are removed in Phase 25.
- Existing Rust integration tests that target `arbors_planner::TreePlan` are replaced to target the new `arbors::TreePlan`.

**Implementation:** `TreePlan` wraps an `ArborPlan` internally. `Tree.plan()` creates a 1-tree Arbor under the hood, then wraps its plan. This reuses the existing query plan infrastructure and ensures TreePlan uses the same eager/lazy model as ArborPlan.

**TreePlan operation surface:** TreePlan exposes all operations that make sense for tree-level transforms:

| Operation | Included | Rationale |
|-----------|----------|-----------|
| `select()` | Yes | Core tree transform |
| `add_field()` | Yes | Core tree transform |
| `explode()` | Yes | Cardinality-changing (0..N result) |
| `filter()` | Yes | "Keep or drop" — 0 or 1 result |
| `head(n)` | No | Meaningless on 1 tree (identity or drop) |
| `tail(n)` | No | Meaningless on 1 tree |
| `sort_by()` | No | Sorting 1 tree is a no-op |
| `append()` | No | Use Arbor for multi-tree operations |
| `sample()` | No | Meaningless on 1 tree |
| `shuffle()` | No | Meaningless on 1 tree |

**Error handling:** `collect_tree()` returns `PipelineError::CardinalityError` (Rust) / raises `ValueError` (Python) when result cardinality ≠ 1.

**Rationale:**
- `TreePlan.collect() -> Arbor` is predictable even when plan operations can change cardinality.
- `collect_tree()` gives "pail ergonomics" for the 1-tree case without type instability.

---

### 25.1 Specification

#### 25.1.1 Inputs and Outputs (Data Model)

**Inputs:**
- `path: impl AsRef<Path>` (Rust) / `path: str` (Python) — path to `.arbors` file
- `name: &str` (Rust) / `name: str` (Python) — name of an Arbor within the file
- `options: Option<&ArborStoreOptions>` — optional configuration
- Operations on Arbor handle take expressions, indices, trees as appropriate

**Outputs:**
- `open()` → `Result<Arbor, ArborStoreError>` / `Arbor` (raises `KeyError` if not found)
- `list()` → `Result<Vec<String>, ArborStoreError>` / `list[str]`
- `delete()` → `Result<bool, ArborStoreError>` / `bool` (true if deleted)
- `save_multiple()` → `Result<(), ArborStoreError>` / `None` (atomic batch save)
- `arbor.save()` → `Result<(), ArborStoreError>` / `None`
- `arbor.refresh()` → `Result<Arbor, PipelineError>` / `Arbor`
- All eager handle methods → `Result<Arbor, PipelineError>` / `Arbor` (**may be view or materialized result**)
- All lazy plan methods → `Self` (chainable)

**Key invariants:**
- Eager operations execute immediately and return results with **eagerly-realized semantics** (errors now), but results may still be **views** over existing data.
- Lazy operations (via `plan()`) defer until `collect()` / `materialize()`
- `save()` is single-Arbor auto-commit; `save_multiple()` is atomic batch save
- `refresh()` on in-memory arbor is an error
- All operations are thread-safe (Rust); Python enforces thread affinity

#### 25.1.2 Terminology and Naming

- **eager**: Execute immediately, return errors at call time (result may be a view or materialized, op-dependent)
- **lazy**: Build plan node, defer execution until terminal method
- **`.arbors` file**: A file containing zero or more named Arbors
- **named Arbor**: An Arbor stored in a `.arbors` file under a string name
- **atomic batch save**: Saving multiple named Arbors to a file with all-or-nothing semantics

#### 25.1.3 Supported Features (Exhaustive)

**Supported:**
- Eager execution of all Arbor handle methods (filter, select, head, sort_by, append, etc.)
- Lazy execution of all operations via ArborPlan
- Opening a named Arbor from a `.arbors` file
- Listing and deleting named Arbors
- Saving any Arbor to a `.arbors` file under a name
- Refreshing stored Arbors for latest view
- Atomic multi-Arbor saves via `save_multiple()`

**Explicitly not supported:**
- True lazy `concat()` (materializes RHS; future optimization)
- Atomic saves spanning multiple `.arbors` files
- EagerMode/LazyMode toggle
- Direct transaction/snapshot access (implementation detail)

**Behavior when unsupported is encountered:**
- `open()` with nonexistent name: `KeyError` (Python) / `ArborStoreError::NotFound` (Rust)
- `refresh()` on in-memory Arbor: `RuntimeError` (Python) / `PipelineError::ExecutionError` (Rust)
- Index out of bounds in lazy plan: error at `collect()` time

**Python builtin shadowing:**
- `arbors.open` and `arbors.list` shadow Python builtins
- This is acceptable: users do `import arbors` (not `from arbors import *`)
- Call as `arbors.open(...)` and `arbors.list(...)` explicitly

#### 25.1.4 Modes / Policies

| Mode | API | Behavior | Result |
|------|-----|----------|--------|
| Eager | `arbor.method()` | Execute immediately (errors now) | `Arbor` (view or materialized, op-dependent) |
| Lazy | `arbor.plan().method().collect()` | Defer until terminal | Optimized execution |
| Auto-commit | `arbor.save(path, name)` | Single save, auto-commit | Persisted Arbor |
| Atomic | `arbors.save_multiple(path, ...)` | Batch save, atomic commit | Atomic persistence |

| Storage Op | File exists? | Name exists? | Behavior |
|------------|--------------|--------------|----------|
| `open` | No | N/A | Error: file not found |
| `open` | Yes | No | Error: KeyError / NotFound |
| `open` | Yes | Yes | Returns Arbor |
| `save` | No | N/A | Creates file, saves Arbor |
| `save` | Yes | No | Saves Arbor under new name |
| `save` | Yes | Yes | Overwrites existing Arbor |
| `delete` | No | N/A | Error: file not found |
| `delete` | Yes | No | Returns false |
| `delete` | Yes | Yes | Deletes, returns true |

#### 25.1.5 Semantics (Normative Rules)

- **Eager execution (handle)**: Handle methods perform the required work **at call time** so errors surface immediately. This includes:
  - validating arguments (e.g., index bounds for handle-level `take/remove/insert/set`)
  - eagerly computing and caching any required **selection** (indices / permutation / composite indices / mutation layer bookkeeping)
  - **NOTE:** This does not necessarily imply "materialize all trees into memory".
- **Lazy execution**: Plan methods build plan nodes; execution deferred to `collect()`/`materialize()`
- **Views vs materialization (handle)**:
  - Some eager handle ops are **eager-view** (e.g., filter computes indices eagerly but does not force full materialization).
  - Some eager handle ops are **eager-materializing** (e.g., shape transforms that inherently produce new trees).
- **Snapshot isolation**: `open()` internally creates MVCC snapshot; Arbor sees consistent point-in-time view
- **Auto-commit**: `save(path, name)` commits immediately for that single named Arbor
- **Atomic batch save**: `save_multiple(path, ...)` writes all named Arbors in one internal write transaction and commits atomically; on error, nothing is persisted
- **Refresh semantics**: `refresh()` returns NEW Arbor that preserves the `LogicalPlan` but swaps to a fresh MVCC snapshot; the plan is **re-executed from scratch** against the new snapshot. Original Arbor unchanged. For in-memory Arbors it is an error.
- **Index validation**: Validated at execution time, not plan-building time

#### 25.1.6 Error and Warning Model

**Error types (Rust):**
- `ArborStoreError` — storage-related errors (file I/O, not found)
- `PipelineError::ExecutionError` — execution errors (refresh on in-memory, index out of bounds)
- `PipelineError::CardinalityError` — cardinality mismatch (e.g., `collect_tree()` when result ≠ 1 tree)

**Error mapping (Python):**
| Rust Error | Python Exception |
|------------|------------------|
| `ArborStoreError::NotFound` | `KeyError` |
| Other `ArborStoreError` | `ArborStoreError` |
| `PipelineError::ExecutionError` | `RuntimeError` |
| `PipelineError::CardinalityError` | `ValueError` |

**No warnings defined for this phase.**

#### 25.1.7 Public API Surface

**Rust free functions (crates/arbors/src/lib.rs):**
```rust
pub fn open(path: impl AsRef<Path>, name: &str) -> Result<Arbor, ArborStoreError>;
pub fn open_with_options(path: impl AsRef<Path>, name: &str, options: &ArborStoreOptions) -> Result<Arbor, ArborStoreError>;
pub fn list(path: impl AsRef<Path>) -> Result<Vec<String>, ArborStoreError>;
pub fn delete(path: impl AsRef<Path>, name: &str) -> Result<bool, ArborStoreError>;
pub fn save_multiple(
    path: impl AsRef<Path>,
    arbors: impl IntoIterator<Item = (impl Into<String>, Arbor)>,
    options: Option<&ArborStoreOptions>,
) -> Result<(), ArborStoreError>;
```

**Rust Arbor instance methods (crates/arbors/src/handle/):**
```rust
impl Arbor {
    // Existing methods become eager (execute immediately)
    pub fn head(&self, n: usize) -> Result<Self, PipelineError>;       // Was lazy
    pub fn tail(&self, n: usize) -> Result<Self, PipelineError>;       // Was lazy
    pub fn take(&self, indices: &[usize]) -> Result<Self, PipelineError>;  // Was lazy
    pub fn sort_by(&self, key: impl Into<SortKeySpec>) -> Result<Self, PipelineError>;  // Was lazy
    pub fn append<I>(&self, trees: I) -> Result<Self, PipelineError>;  // Was lazy
    pub fn insert(&self, position: usize, trees: I) -> Result<Self, PipelineError>;  // Was lazy
    pub fn set(&self, index: usize, tree: Tree) -> Result<Self, PipelineError>;  // Was lazy
    pub fn remove(&self, indices: &[usize]) -> Result<Self, PipelineError>;  // Was lazy
    // ... etc for sample, shuffle, reverse, sort_by_desc, sort_by_keys

    // Storage methods
    pub fn save(&self, path: impl AsRef<Path>, name: &str) -> Result<(), ArborStoreError>;
    pub fn save_with_options(&self, path: impl AsRef<Path>, name: &str, options: &ArborStoreOptions) -> Result<(), ArborStoreError>;
    pub fn refresh(&self) -> Result<Self, PipelineError>;
}
```

**Rust ArborPlan additions (crates/arbors/src/plan.rs):**
```rust
impl ArborPlan {
    // New slice methods (lazy)
    pub fn take(self, indices: Vec<usize>) -> Self;
    pub fn sample(self, n: usize, seed: Option<u64>) -> Self;
    pub fn shuffle(self, seed: Option<u64>) -> Self;
    pub fn reverse(self) -> Self;

    // New mutation methods (lazy)
    pub fn append(self, trees: Vec<Tree>) -> Self;
    pub fn insert(self, position: usize, trees: Vec<Tree>) -> Self;
    pub fn set(self, index: usize, tree: Tree) -> Self;
    pub fn remove(self, indices: Vec<usize>) -> Self;
    pub fn concat(self, other: &Arbor) -> Result<Self, PipelineError>;  // Materializes RHS
}
```

**Rust Tree extension traits (crates/arbors/src/plan.rs + crates/arbors/src/lib.rs):**
```rust
 /// Note: `Tree` is defined in `arbors-storage`, so these are provided via extension traits
 /// in `crates/arbors` (method-call syntax still works).
 pub trait TreePlanExt {
     fn plan(&self) -> TreePlan;
 }
 
 pub trait TreeStoreExt {
     fn save(&self, path: impl AsRef<Path>, name: &str) -> Result<(), ArborStoreError>;
     fn save_with_options(
         &self,
         path: impl AsRef<Path>,
         name: &str,
         options: &ArborStoreOptions,
     ) -> Result<(), ArborStoreError>;
 }
```

**Rust TreePlan (crates/arbors/src/plan.rs):**
```rust
/// TreePlan wraps an ArborPlan internally for a single-tree source.
/// Exposes tree-level transforms; terminals return Arbor or Tree.
pub struct TreePlan {
    inner: ArborPlan,  // 1-tree Arbor plan
}

impl TreePlan {
    // Tree-level transforms (subset of ArborPlan ops)
    pub fn select(self, exprs: impl IntoIterator<Item = Expr>) -> Self;
    pub fn add_field(self, name: &str, expr: Expr) -> Self;
    pub fn explode(self, path_expr: Expr, as_binding: Option<&str>) -> Self;
    pub fn filter(self, predicate: Expr) -> Self;

    // Terminals
    pub fn collect(self) -> Result<Arbor, PipelineError>;  // 0..N trees
    pub fn collect_tree(self) -> Result<Tree, PipelineError>;  // Exactly 1 tree or CardinalityError
}
```

**Python module functions:**
```python
def open(path: str, name: str, options: Optional[ArborStoreOptions] = None) -> Arbor: ...
def list(path: str) -> list[str]: ...
def delete(path: str, name: str) -> bool: ...
def save_multiple(path: str, arbors: dict[str, Arbor],
                  options: Optional[ArborStoreOptions] = None) -> None: ...
```

**Python Arbor instance methods:**
```python
class Arbor:
    def save(self, path: str, name: str,
             options: Optional[ArborStoreOptions] = None) -> None: ...
    def refresh(self) -> Arbor: ...
```

**Python Tree and TreePlan (single-object ergonomics):**
```python
class Tree:
    def save(self, path: str, name: str,
             options: Optional[ArborStoreOptions] = None) -> None: ...
    def plan(self) -> TreePlan: ...

class TreePlan:
    # Plan-building ops (tree-level transforms only)
    def select(self, exprs: list[Expr]) -> TreePlan: ...
    def add_field(self, name: str, expr: Expr) -> TreePlan: ...
    def explode(self, path_expr: Expr, as_binding: str | None = None) -> TreePlan: ...
    def filter(self, predicate: Expr) -> TreePlan: ...  # 0 or 1 result

    # Terminals
    def collect(self) -> Arbor: ...
    def collect_tree(self) -> Tree: ...  # Raises ValueError unless exactly 1 tree
```

**Python ArborPlan additions:**
```python
class ArborPlan:
    def take(self, indices: list[int]) -> ArborPlan: ...
    def sample(self, n: int, seed: Optional[int] = None) -> ArborPlan: ...
    def shuffle(self, seed: Optional[int] = None) -> ArborPlan: ...
    def reverse(self) -> ArborPlan: ...
    def append(self, trees: list[Tree]) -> ArborPlan: ...
    def insert(self, position: int, trees: list[Tree]) -> ArborPlan: ...
    def set(self, index: int, tree: Tree) -> ArborPlan: ...
    def remove(self, indices: list[int]) -> ArborPlan: ...
    def concat(self, other: Arbor) -> ArborPlan: ...
```

**Implementation note (Python bindings):**
- Transaction types (`ReadTxn`, `WriteTxn`) are NOT exported—internal only
- Delete legacy `ArborStoreSession.begin_read()` and related surfaces

#### 25.1.7.1 Method Parity Checklist

This table tracks what exists vs. what needs to be added:

| Operation | Arbor Handle | ArborPlan | Py Arbor | Py ArborPlan | Status |
|-----------|--------------|-----------|----------|--------------|--------|
| head | EXISTS | EXISTS | EXISTS | EXISTS | Make eager |
| tail | EXISTS | EXISTS | EXISTS | EXISTS | Make eager |
| take | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| sample | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| shuffle | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| reverse | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| sort_by | EXISTS | EXISTS | EXISTS | EXISTS | Make eager |
| sort_by_desc | EXISTS | N/A (use `sort_by(..., descending=True)`) | EXISTS | N/A (use `sort_by(..., descending=True)`) | Make eager (handle) |
| sort_by_keys | EXISTS | N/A (use `sort_by([...], [...])`) | EXISTS | N/A (use `sort_by([...], [...])`) | Make eager (handle) |
| append | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| insert | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| set | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| remove | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| concat | EXISTS | **ADD** | EXISTS | **ADD** | Make eager, add to plan |
| save | **ADD** | N/A | **ADD** | N/A | New instance method |
| refresh | EXISTS (wrong sig) | N/A | **ADD** | N/A | Fix signature |

**Tree and TreePlan parity:**

| Operation | Tree (Rust) | TreePlan (Rust) | Py Tree | Py TreePlan | Status |
|-----------|-------------|-----------------|---------|-------------|--------|
| plan | **ADD** | N/A | **ADD** | N/A | New instance method |
| save | **ADD** | N/A | **ADD** | N/A | New instance method |
| select | N/A | **ADD** | N/A | **ADD** | New TreePlan type |
| add_field | N/A | **ADD** | N/A | **ADD** | New TreePlan type |
| explode | N/A | **ADD** | N/A | **ADD** | New TreePlan type |
| filter | N/A | **ADD** | N/A | **ADD** | New TreePlan type |
| collect | N/A | **ADD** | N/A | **ADD** | Terminal → Arbor |
| collect_tree | N/A | **ADD** | N/A | **ADD** | Terminal → Tree (or error) |

#### 25.1.8 Internal Architecture

**Single source of truth:**
- `LogicalPlan` defines all operations (already complete)
- `arbors-store` provides storage primitives (`ArborStore`, `Snapshot`, owned txns)
- Internal write helper for `save_multiple()` wraps these primitives and keeps the store alive

**Snapshot lifetime:** `open()` returns an `Arbor` whose `DataBinding::Scoped` holds an `Arc<Snapshot>`. This keeps the snapshot alive for the lifetime of the Arbor handle (and any handles derived from it).

**Eager execution pipeline:**
1. Validate arguments (bounds, invariants)
2. Build `LogicalPlan` node for operation
3. If the operation requires a stable selection/permutation, eagerly compute and cache it
4. For operations that inherently produce new trees, execute + materialize immediately
5. Return a new `Arbor` handle (may be a view, may be materialized)

**Implementation pattern for eager handle methods (concrete example):**
```rust
// In handle/slice.rs
pub fn head(&self, n: usize) -> Result<Self, PipelineError> {
    // 1. Build plan node (same as before)
    let new_plan = self.plan.head(n);

    // 2. Create new arbor with the plan
    let new_arbor = self.with_plan(new_plan);

    // 3. Eagerly compute and cache the selection so errors surface NOW.
    //    Use the existing filter() pattern: initialize cached_selection once.
    let _ = new_arbor.cached_selection.get_or_try_init(|| {
        let txn = new_arbor.binding.as_scope().map(|s| s.txn());
        let optimized = optimize_query_plan(&new_arbor.plan);
        let physical = execute_query_plan(&optimized, txn)?;

        Ok::<CachedSelection, PipelineError>(CachedSelection::Indices(
            physical.as_indices().cloned().unwrap_or(IndexSet::EMPTY),
        ))
    })?;

    Ok(new_arbor)
}
```

The key insight: **"eager" means we compute and cache the selection NOW**, but we don't necessarily materialize all tree data into memory. The `cached_selection` field (already exists in `Arbor`) stores the computed indices/permutation. When the user later iterates or accesses trees, the cached selection is used.

**Lazy execution pipeline:**
1. Build `LogicalPlan` nodes (chainable)
2. `optimize()` returns lazy `Arbor`
3. `collect()` / `materialize()` executes full pipeline

**Where code lives:**
- Free functions: `crates/arbors/src/lib.rs`
- Handle methods: `crates/arbors/src/handle/slice.rs`, `sort.rs`, `mutation.rs`
- Plan methods: `crates/arbors/src/plan.rs`
- Python bindings: `python/src/lib.rs`

**Non-negotiable invariants:**
- All storage functions delegate to `arbors-store` primitives (`ArborStore`, `Snapshot`, owned txns)
- Python is thin wrapper—no business logic in bindings
- Eager handle + lazy plan pattern is consistent across ALL operations
- Public API is Arbor-centric—no transactions or snapshots exposed
- `save()` is the single-Arbor interface; `save_multiple()` is the atomic batch interface

---

### 25.2 Definitive Symbol Inventory

#### 25.2.1 New crates

None.

#### 25.2.2 New files

| File | Purpose |
|------|---------|
| (none required) | All additions fit in existing files |

#### 25.2.3 Symbols to add / modify

**Rust - New Functions / Helpers (add to façade):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `save_multiple` | fn | `crates/arbors/src/lib.rs` | Atomic multi-Arbor save (single internal write txn) |

**Rust - Free Functions:**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `open` | fn | `crates/arbors/src/lib.rs` | Opens named Arbor from file |
| `open_with_options` | fn | `crates/arbors/src/lib.rs` | With options |
| `list` | fn | `crates/arbors/src/lib.rs` | Lists names of Arbors in file |
| `delete` | fn | `crates/arbors/src/lib.rs` | Deletes named Arbor from file |
| `save_multiple` | fn | `crates/arbors/src/lib.rs` | Atomic multi-Arbor save |

**Rust - Arbor Instance Methods:**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Arbor::save` | method | `handle/mod.rs` | Auto-commit save |
| `Arbor::save_with_options` | method | `handle/mod.rs` | With options |
| `Arbor::refresh` | method | `handle/mod.rs` | Returns new Arbor |

**Rust - Arbor Handle Methods (modify to eager):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Arbor::head` | method | `handle/slice.rs` | Change lazy → eager |
| `Arbor::tail` | method | `handle/slice.rs` | Change lazy → eager |
| `Arbor::take` | method | `handle/slice.rs` | Change lazy → eager |
| `Arbor::sample` | method | `handle/slice.rs` | Change lazy → eager |
| `Arbor::shuffle` | method | `handle/slice.rs` | Change lazy → eager |
| `Arbor::reverse` | method | `handle/slice.rs` | Change lazy → eager |
| `Arbor::sort_by` | method | `handle/sort.rs` | Change lazy → eager |
| `Arbor::sort_by_desc` | method | `handle/sort.rs` | Change lazy → eager |
| `Arbor::sort_by_keys` | method | `handle/sort.rs` | Change lazy → eager |
| `Arbor::append` | method | `handle/mutation.rs` | Change lazy → eager |
| `Arbor::concat` | method | `handle/mutation.rs` | Change lazy → eager |
| `Arbor::insert` | method | `handle/mutation.rs` | Change lazy → eager |
| `Arbor::set` | method | `handle/mutation.rs` | Change lazy → eager |
| `Arbor::remove` | method | `handle/mutation.rs` | Change lazy → eager |

**Rust - ArborPlan Methods (add):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ArborPlan::take` | method | `plan.rs` | Lazy take |
| `ArborPlan::sample` | method | `plan.rs` | Lazy sample |
| `ArborPlan::shuffle` | method | `plan.rs` | Lazy shuffle |
| `ArborPlan::reverse` | method | `plan.rs` | Lazy reverse |
| `ArborPlan::append` | method | `plan.rs` | Lazy append |
| `ArborPlan::insert` | method | `plan.rs` | Lazy insert |
| `ArborPlan::set` | method | `plan.rs` | Lazy set |
| `ArborPlan::remove` | method | `plan.rs` | Lazy remove |
| `ArborPlan::concat` | method | `plan.rs` | Lazy concat |

**Rust - Tree Extension Traits (add):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TreePlanExt` | trait | `crates/arbors/src/plan.rs` | Extension trait for `tree.plan()` |
| `TreePlanExt::plan` | method | `crates/arbors/src/plan.rs` | Returns TreePlan |
| `TreeStoreExt` | trait | `crates/arbors/src/lib.rs` | Extension trait for `tree.save()` |
| `TreeStoreExt::save` | method | `crates/arbors/src/lib.rs` | Sugar: save single-tree Arbor |
| `TreeStoreExt::save_with_options` | method | `crates/arbors/src/lib.rs` | With options |

**Rust - TreePlan (new type + methods):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TreePlan` | struct | `plan.rs` | Wraps ArborPlan internally |
| `TreePlan::select` | method | `plan.rs` | Tree-level transform |
| `TreePlan::add_field` | method | `plan.rs` | Tree-level transform |
| `TreePlan::explode` | method | `plan.rs` | Cardinality-changing |
| `TreePlan::filter` | method | `plan.rs` | 0 or 1 result |
| `TreePlan::collect` | method | `plan.rs` | Terminal → Arbor (0..N) |
| `TreePlan::collect_tree` | method | `plan.rs` | Terminal → Tree (exactly 1 or CardinalityError) |

**Python - Module Functions (add):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `open` | pyfunction | `python/src/lib.rs` | Opens named Arbor from file |
| `list` | pyfunction | `python/src/lib.rs` | Lists names in file |
| `delete` | pyfunction | `python/src/lib.rs` | Deletes named Arbor |
| `save_multiple` | pyfunction | `python/src/lib.rs` | Atomic multi-Arbor save |

**Python - Tree Ergonomics (add):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Tree.save` | pymethod | `python/src/lib.rs` | Sugar: save single-tree Arbor under name |
| `Tree.plan` | pymethod | `python/src/lib.rs` | Returns `TreePlan` |

**Python - TreePlan (new type + methods):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TreePlan` | pyclass | `python/src/lib.rs` | Wraps Rust TreePlan |
| `TreePlan.select` | pymethod | `python/src/lib.rs` | Tree-level transform |
| `TreePlan.add_field` | pymethod | `python/src/lib.rs` | Tree-level transform |
| `TreePlan.explode` | pymethod | `python/src/lib.rs` | Cardinality-changing |
| `TreePlan.filter` | pymethod | `python/src/lib.rs` | 0 or 1 result |
| `TreePlan.collect` | pymethod | `python/src/lib.rs` | Terminal → Arbor |
| `TreePlan.collect_tree` | pymethod | `python/src/lib.rs` | Terminal → Tree (or ValueError) |

**Python - New Types (add):**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TreePlan` | pyclass | `python/src/lib.rs` | New type for tree-level lazy planning |

**Python - Symbols to Remove from Public API:**

| Symbol | Location | Notes |
|--------|----------|-------|
| `ArborStoreSession` | `__init__.py`, `_arbors.pyi`, `api_manifest.toml` | Hide from public |
| `ReadTxn` | `_arbors.pyi`, `api_manifest.toml` | Internal only (not exported) |
| `WriteTxn` / `Transaction` | `_arbors.pyi`, `api_manifest.toml` | Internal only (not exported) |
| `Snapshot` | `_arbors.pyi`, `api_manifest.toml` | Internal only (not exported) |

**Python - Internal Cleanup:**

| Action | Location | Notes |
|--------|----------|-------|
| Delete `begin_read()` | `python/src/lib.rs` | Legacy API, replaced by `open()` |
| Delete old `ReadTxn` pyclass | `python/src/lib.rs` | Was backed by `OwnedReadTxn` |
| Keep `WriteScope` internal | `python/src/lib.rs` | Used by internal write plumbing, not exported |

---

### 25.3 Documentation Plan

- [ ] Update module docstring in `python/arbors/__init__.py` with eager/lazy examples
- [ ] Update `CLAUDE.md` immutable semantics section for eager handle behavior
- [ ] Add docstrings to all new Rust free functions
- [ ] Update `crates/arbors/src/handle/mod.rs` module docs
- [ ] Update `crates/arbors/src/plan.rs` ArborPlan docs with mutation examples
- [ ] Update `examples/python/12_persistence.py` for new API
- [ ] Update `examples/python/13_mvcc_snapshots.py` for new API

---

### 25.4 Test Plan Concepts

**Unit tests (Rust):**
- Test each eager handle method executes immediately
- Test each lazy plan method defers until `collect()`
- Test storage free functions with temp directories
- Test `save()` and `refresh()` instance methods
- Test `save_multiple()` for atomic batch saves
- Test error cases (nonexistent file, nonexistent name, refresh on in-memory)
- Test index validation at execution time for lazy plans

**Integration tests (Rust):**
- Round-trip: `read_jsonl` → `save` → `open` → verify equality
- MVCC: `open` → external write → `refresh` → see new data
- Eager vs lazy: same results, different execution timing
- Atomic saves: multiple Arbors saved atomically via `save_multiple()`

**Python tests:**
- Mirror Rust tests through Python bindings
- Verify `KeyError` raised for nonexistent name
- Verify `RuntimeError` raised for refresh on in-memory
- Verify `ArborStoreSession` not accessible
- Verify `save_multiple()` is atomic
- Verify no `ReadTxn`/`WriteTxn` in public API
- Verify `TreePlan.collect()` returns an `Arbor` (including explode)
- Verify `TreePlan.collect_tree()` returns `Tree` for 1-tree result and errors for 0/2+
- Verify `Tree.save(path, name)` writes a named Arbor with exactly 1 tree

**Drift prevention:**
- `check_api_parity.py` validates manifest matches runtime exports
- `stubtest` validates stubs match runtime

---

### 25.5 Execution Steps

#### Step 1: Make Slice Operations Eager

**Commit:** `refactor(arbors): make slice operations eager on Arbor handle`

**References:** 25.0.1 (Eager Handle), 25.1.5 (Semantics: eager execution), 25.1.8 (Implementation Pattern)

**Tasks:**
- [ ] Update `head()` in `slice.rs` to execute immediately
- [ ] Update `tail()` to execute immediately
- [ ] Update `take()` to execute immediately
- [ ] Update `sample()` to execute immediately
- [ ] Update `shuffle()` to execute immediately
- [ ] Update `reverse()` to execute immediately

**Tests:**
- [ ] Unit test: each method returns an Arbor with eager semantics (errors at call site; stable selection cached when required)
- [ ] Unit test: errors returned at call site, not iteration
- [ ] Unit test: `take()` out-of-bounds errors at call site (not at iteration)

**Checkpoint:**
- [ ] `cargo nextest run -p arbors -- slice`
- [ ] `cargo clippy -p arbors -- -D warnings`

**Commit after all checkpoints pass.**

---

#### Step 2: Make Sort Operations Eager

**Commit:** `refactor(arbors): make sort operations eager on Arbor handle`

**References:** 25.0.1 (Eager Handle), 25.1.5 (Semantics: eager execution), 25.1.8 (Implementation Pattern)

**Tasks:**
- [ ] Update `sort_by()` in `sort.rs` to execute immediately
- [ ] Update `sort_by_desc()` to execute immediately
- [ ] Update `sort_by_keys()` to execute immediately
- [ ] Verify `top_k()` and `bottom_k()` are transitively eager

**Tests:**
- [ ] Unit test: each method returns an Arbor with eager semantics (permutation computed/cached at call site; stable order)
- [ ] Unit test: sort errors returned at call site
- [ ] Unit test: `top_k()` / `bottom_k()` errors (if any) are returned at call site (transitively eager)

**Checkpoint:**
- [ ] `cargo nextest run -p arbors -- sort`
- [ ] `cargo clippy -p arbors -- -D warnings`

**Commit after all checkpoints pass.**

---

#### Step 3: Make Mutation Operations Eager

**Commit:** `refactor(arbors): make mutation operations eager on Arbor handle`

**References:** 25.0.1 (Eager Handle), 25.1.5 (Semantics: eager execution), 25.1.8 (Implementation Pattern)

**Tasks:**
- [ ] Update `append()` in `mutation.rs` to execute immediately
- [ ] Update `concat()` to execute immediately
- [ ] Update `insert()` to execute immediately
- [ ] Update `set()` to execute immediately
- [ ] Update `remove()` to execute immediately

**Tests:**
- [ ] Unit test: each method returns an Arbor with eager semantics (validation at call site; mutation bookkeeping stable)
- [ ] Unit test: index errors returned at call site
- [ ] Unit test: `insert()`/`set()`/`remove()` out-of-bounds errors are returned at call site

**Checkpoint:**
- [ ] `cargo nextest run -p arbors -- mutation`
- [ ] `cargo clippy -p arbors -- -D warnings`

**Commit after all checkpoints pass.**

---

#### Step 4: Add Missing Lazy Operations to ArborPlan

**Commit:** `feat(arbors): add mutation and slice methods to ArborPlan for lazy execution`

**References:** 25.0.2 (ArborPlan Completeness), 25.0.3 (Index Validation Timing), 25.1.5 (Semantics: lazy execution)

**Tasks:**
- [ ] Add `take()` to ArborPlan in `plan.rs`
- [ ] Add `sample()` to ArborPlan
- [ ] Add `shuffle()` to ArborPlan
- [ ] Add `reverse()` to ArborPlan
- [ ] Add `append()` to ArborPlan
- [ ] Add `insert()` to ArborPlan
- [ ] Add `set()` to ArborPlan
- [ ] Add `remove()` to ArborPlan
- [ ] Add `concat()` to ArborPlan

**Tests:**
- [ ] Unit test: each method returns `Self` for chaining
- [ ] Unit test: execution deferred until `collect()`
- [ ] Unit test: errors surface at `collect()` time
- [ ] Unit test: index out-of-bounds in lazy plan (e.g., `plan.insert(100, ...)`) does NOT error until `collect()`

**Checkpoint:**
- [ ] `cargo nextest run -p arbors -- plan`
- [ ] `cargo clippy -p arbors -- -D warnings`

**Commit after all checkpoints pass.**

---

#### Step 5: Clean Up Legacy Transaction Types

**Commit:** `refactor(arbors-python): remove legacy transaction types from public API`

**References:** 25.0.6 (No Transactions in Public API), 25.1.7 (Public API Surface)

**Rationale for early placement:** Clean up legacy types BEFORE adding new Python bindings (Steps 6, 10) so all new code uses the Arbor-centric API.

**Tasks:**
- [ ] Delete the old owned/batched `ReadTxn` pyclass in `python/src/lib.rs`
- [ ] Delete `begin_read()` entry points that return it
- [ ] Keep `WriteScope` and `Snapshot` internal (not exported)
- [ ] Remove `ReadTxn`, `WriteTxn`, `Transaction`, `Snapshot` from `__init__.py` exports
- [ ] Remove from `_arbors.pyi` stubs (or mark as internal)
- [ ] Remove from `api_manifest.toml`
- [ ] Update `stubtest_allowlist.txt` as needed

**Tests:**
- [ ] Python test: `hasattr(arbors, 'ReadTxn')` returns `False`
- [ ] Python test: `hasattr(arbors, 'WriteTxn')` returns `False`
- [ ] Python test: `hasattr(arbors, 'Transaction')` returns `False`
- [ ] Python test: `hasattr(arbors, 'Snapshot')` returns `False`
- [ ] Python test: legacy entry points like `begin_read` / `read_txn` / `write_txn` are not present on `arbors`

**Checkpoint:**
- [ ] `just python`
- [ ] `just python-test`
- [ ] `just check-stubs`

**Commit after all checkpoints pass.**

---

#### Step 6: Update Python Bindings for ArborPlan

**Commit:** `feat(arbors-python): expose new ArborPlan methods`

**References:** 25.0.2 (ArborPlan Completeness), 25.0.3 (Index Validation Timing), 25.1.7 (Python ArborPlan additions)

**Tasks:**
- [ ] Add `take` method to PyArborPlan in `python/src/lib.rs`
- [ ] Add `sample`, `shuffle`, `reverse` methods
- [ ] Add `append`, `insert`, `set`, `remove`, `concat` methods
- [ ] Update `_arbors.pyi` stubs
- [ ] Update `api_manifest.toml`

**Tests:**
- [ ] Python test: lazy chaining works as expected
- [ ] Python test: `collect()` returns materialized result
- [ ] Python test: index errors in lazy plan surface at `collect()` time (not at plan-building time)

**Checkpoint:**
- [ ] `just python`
- [ ] `just python-test`
- [ ] `just check-stubs`

**Commit after all checkpoints pass.**

---

#### Step 7: Add Rust Storage Free Functions

**Commit:** `feat(arbors): add storage free functions (open, list, delete)`

**References:** 25.0.4 (Module Functions), 25.0.8 (Storage Model), 25.1.6 (Error model: ArborStoreError), 25.1.7 (Rust free functions)

**Tasks:**
- [ ] Add `open()` to `crates/arbors/src/lib.rs`
- [ ] Add `open_with_options()`
- [ ] Add `list()`
- [ ] Add `delete()`

**Tests:**
- [ ] Unit test: `open` returns Arbor for existing name
- [ ] Unit test: `open` returns error for nonexistent name
- [ ] Unit test: `list` returns names of Arbors in file
- [ ] Unit test: `delete` returns bool correctly
- [ ] Unit test: storage ops error on nonexistent file (open/list/delete)
- [ ] Unit test: `delete` returns `false` for missing name in an existing file

**Checkpoint:**
- [ ] `cargo nextest run -p arbors -- storage`
- [ ] `cargo clippy -p arbors -- -D warnings`

**Commit after all checkpoints pass.**

---

#### Step 8: Add Rust save_multiple()

**Commit:** `feat(arbors): add save_multiple() for atomic multi-Arbor saves`

**References:** 25.0.5 (Atomic Multi-Arbor Saves), 25.0.8 (Storage Model), 25.0.9 (Internal Transaction Wrappers)

**Tasks:**
- [ ] Add `save_multiple()` free function to `crates/arbors/src/lib.rs`
- [ ] Internally: open store, begin one write txn, write all named Arbors, commit once

**Tests:**
- [ ] Unit test: `save_multiple` persists all names on success
- [ ] Unit test: `save_multiple` is atomic (if one write fails, none persist)
- [ ] Unit test: `save_multiple(path, [])` / empty input is a no-op (no error)
- [ ] Unit test: `save_multiple` overwrites existing names (same semantics as `save()`)
- [ ] Unit test: duplicate names are last-write-wins for deterministic input order (e.g., a `Vec<(String, Arbor)>`)

**Checkpoint:**
- [ ] `cargo nextest run -p arbors -- save_multiple`
- [ ] `cargo clippy -p arbors -- -D warnings`

**Commit after all checkpoints pass.**

---

#### Step 9: Add Rust Arbor Instance Methods (save, refresh)

**Commit:** `feat(arbors): add Arbor::save and Arbor::refresh instance methods`

**References:** 25.0.8 (Storage Model), 25.0.10 (Breaking Change: refresh signature), 25.1.5 (Semantics: refresh), 25.1.7 (Rust Arbor instance methods)

**Tasks:**
- [ ] Add `save()` to Arbor in `handle/mod.rs`
- [ ] Add `save_with_options()`
- [ ] **BREAKING:** Change `refresh()` signature from `Result<(), _>` to `Result<Self, _>`
- [ ] Implement `refresh()` to return NEW Arbor with fresh snapshot

**Tests:**
- [ ] Unit test: `save` writes to new file
- [ ] Unit test: `save` overwrites existing Arbor
- [ ] Unit test: `refresh` returns new arbor with fresh snapshot
- [ ] Unit test: `refresh` on in-memory returns error
- [ ] Unit test: `refresh()` preserves the logical plan but re-executes against a fresh snapshot (old Arbor unchanged)

**Checkpoint:**
- [ ] `cargo nextest run -p arbors`
- [ ] `cargo clippy -p arbors -- -D warnings`

**Commit after all checkpoints pass.**

---

#### Step 10: Add Tree Ergonomics (TreePlan + Tree.save)

**Commit:** `feat(arbors): add TreePlan terminals and Tree.save`

**References:** 25.0.11 (Tree Ergonomics), 25.1.6 (Cardinality error), 25.1.7 (Public API Surface)

**Tasks (Rust core):**
- [ ] Replace the existing `TreePlan` re-export (currently `arbors_planner::TreePlan`) with the new Arbor-consistent `arbors::TreePlan`
- [ ] Ensure `TreePlan.collect()` returns `Result<Arbor, PipelineError>` (0..N trees)
- [ ] Add `TreePlan.collect_tree()` returning `Result<Tree, PipelineError>` and error unless exactly 1 tree (`PipelineError::CardinalityError`)
- [ ] Add `TreePlanExt` trait (`tree.plan()`) and `TreeStoreExt` trait (`tree.save(...)`) in `crates/arbors`
- [ ] Remove or rewrite Rust tests that target `arbors_planner::TreePlan` (they should target the new `arbors::TreePlan`)

**Tasks (Python bindings):**
- [ ] Replace the existing Python `TreePlan` API surface (tree edit plan) with the new `TreePlan` (query-style, Arbor-consistent)
- [ ] Bind `Tree.plan()` → `TreePlan` (new semantics)
- [ ] Bind `TreePlan.collect()` → `Arbor`
- [ ] Bind `TreePlan.collect_tree()` → `Tree` (raise `ValueError` unless exactly 1 tree)
- [ ] Bind `Tree.save(path, name)` (delegates to single-tree Arbor save)
- [ ] Update `_arbors.pyi` stubs and `api_manifest.toml`
- [ ] **Delete or rewrite** `python/tests/test_tree_plan.py` (it targets the old TreePlan semantics)

**Tests:**
- [ ] Rust test: `TreePlan.collect_tree()` succeeds for 1-tree result
- [ ] Rust test: `TreePlan.collect_tree()` errors for 0-tree and 2+ tree results (e.g., explode)
- [ ] Python test: `TreePlan.collect()` returns `Arbor` (including explode)
- [ ] Python test: `TreePlan.collect_tree()` returns `Tree` for 1-tree result; raises `ValueError` for 0/2+
- [ ] Python test: `Tree.save(path, name)` creates a named Arbor with exactly 1 tree
- [ ] Python test: `TreePlan.filter(...)` can yield 0 trees; `collect()` returns empty Arbor; `collect_tree()` raises `ValueError`

**Checkpoint:**
- [ ] `cargo nextest run -p arbors -- tree`
- [ ] `just python-test`
- [ ] `just check-stubs`

**Commit after all checkpoints pass.**

---

#### Step 11: Add Python Storage Functions and Methods

**Commit:** `feat(arbors-python): add storage module functions and instance methods`

**References:** 25.0.4 (Module Functions), 25.0.5 (save_multiple), 25.0.8 (Storage Model), 25.1.6 (Error mapping), 25.1.7 (Python module functions, instance methods)

**Tasks:**
- [ ] Add `open` pyfunction to `python/src/lib.rs`
- [ ] Add `list`, `delete` pyfunctions
 - [ ] Add `save_multiple` pyfunction
- [ ] Add `save`, `refresh` pymethods to PyArbor
   - `save(path, name)` auto-commits
- [ ] Update `__init__.py` imports and `__all__`
- [ ] Update `_arbors.pyi` stubs
- [ ] Update `api_manifest.toml`

**Tests:**
- [ ] Python test: `arbors.open()` returns Arbor
- [ ] Python test: `arbors.list()` returns names
- [ ] Python test: `arbor.save(path, name)` auto-commits
 - [ ] Python test: `arbors.save_multiple(path, {"users": users, "orders": orders})` works
 - [ ] Python test: `save_multiple` is atomic (both names appear or neither appears)
- [ ] Python test: `arbor.refresh()` returns new Arbor
- [ ] Python test: `open()` missing name raises `KeyError`; `delete()` missing name returns `False`

**Checkpoint:**
- [ ] `just python`
- [ ] `just python-test`
- [ ] `just check-parity`
- [ ] `just check-stubs`

**Commit after all checkpoints pass.**

---

#### Step 12: Hide ArborStoreSession and Finalize API

**Commit:** `refactor(arbors-python): hide ArborStoreSession from public API`

**References:** 25.0.6 (No Transactions in Public API), 25.0.7 (Hide ArborStoreSession), 25.1.7 (Public API Surface)

**Tasks:**
- [ ] Remove `ArborStoreSession` from `__init__.py` imports and `__all__`
- [ ] Remove from `_arbors.pyi`
- [ ] Remove from `api_manifest.toml`
- [ ] Update `stubtest_allowlist.txt` if needed
- [ ] Keep `ArborStoreOptions`, `ArborStoreError`, `ArborStoreStats` (config types)
 - [ ] Ensure `save_multiple` is exported

**Tests:**
- [ ] Python test: `hasattr(arbors, 'ArborStoreSession')` returns `False`
 - [ ] Python test: `hasattr(arbors, 'save_multiple')` returns `True`
- [ ] Python test: config types still accessible

**Checkpoint:**
- [ ] `just python`
- [ ] `just python-test`
- [ ] `just check-parity`
- [ ] `just check-stubs`

**Commit after all checkpoints pass.**

---

#### Step 13: Update Tests and Examples

**Commit:** `test(arbors): update tests and examples for new API`

**References:** 25.3 (Documentation Plan), 25.6 (Deliverables and Checkpoints)

**Tasks:**
- [ ] Update `python/tests/test_arbor_store.py`
- [ ] Update `examples/python/12_persistence.py`
- [ ] Update `examples/python/13_mvcc_snapshots.py`
- [ ] Add **parity** integration tests: eager handle APIs vs lazy/plan APIs return the same final results
  - [ ] Rust: add `crates/arbors/tests/test_eager_lazy_parity.rs`
  - [ ] Python: add `python/tests/test_eager_lazy_parity.py` (or extend `python/tests/test_plan_parity.py`)
  - [ ] Keep tests deterministic (fixed seeds for `sample`/`shuffle`)
- [ ] Add integration tests for `save_multiple()`

**Tests:**
- [ ] Integration tests: **eager vs lazy parity** (same final results after execution)
  - [ ] Slice parity: `head`, `tail`, `take`, `reverse` (and `sample`/`shuffle` with fixed seed)
  - [ ] Sort parity: `sort_by` (and `top_k`/`bottom_k` if present)
  - [ ] Mutation parity: `append`, `insert`, `set`, `remove`, `concat`
  - [ ] Query parity: `filter`, `select`, `add_field`, `explode`
  - [ ] Multi-step pipeline parity: **a suite of ~20 representative pipelines** (each 4–10 ops), covering realistic mixes and common footguns
    - [ ] Include pipelines that mix: `filter` + `sort_by` + (`head`/`tail`/`take`) + mutations (`append`/`insert`/`set`/`remove`)
    - [ ] Include pipelines that exercise: `explode` (cardinality changes), `concat`, and chained sorts/slices
    - [ ] Include at least a few “boundary” pipelines: empty results, single-row results, and larger-ish inputs (but keep runtime reasonable)
    - [ ] Keep deterministic: fixed seeds for `sample`/`shuffle`, fixed input data, and stable ordering assertions
  - [ ] Tree parity (eager vs lazy): **a suite of ~20 Tree-focused parity cases**
    - [ ] For each case, compare:
      - **Eager path**: build an equivalent 1-tree `Arbor` and run the eager handle pipeline
      - **Lazy path**: run the equivalent `tree.plan().…` pipeline and call `collect()` / `collect_tree()`
    - [ ] `collect()` parity: `tree.plan().…collect()` returns an `Arbor` equal to the eager 1-tree Arbor pipeline result (0..N trees; include `explode`)
    - [ ] `collect_tree()` parity: for exactly-1 outputs, `collect_tree()` equals the eager pipeline’s single output tree; for 0/2+ outputs, `collect_tree()` raises `ValueError`
    - [ ] Include a mix of ops: `select`, `add_field`, `filter` (0/1), `explode` (0..N), and multi-op chains
    - [ ] Keep deterministic: fixed input trees and stable ordering assertions
- [ ] Integration test: atomic multi-Arbor saves via `save_multiple`

**Checkpoint:**
- [ ] `just python-test-all`
- [ ] `python examples/python/12_persistence.py`
- [ ] `python examples/python/13_mvcc_snapshots.py`

**Commit after all checkpoints pass.**

---

### 25.6 Deliverables and Checkpoints

**Deliverable:** Consistent eager/lazy execution model with Arbor-centric storage API. All Arbor handle methods are eager; ArborPlan provides lazy escape hatch. Storage accessible via module functions; everything is Arbor-in, Arbor-out.

**Tests:**
- [ ] Unit tests: eager execution for all handle methods
- [ ] Unit tests: lazy execution for all plan methods
- [ ] Integration tests: eager vs lazy/plan APIs produce the same final results (parity)
- [ ] Integration tests: storage round-trip
- [ ] Integration tests: atomic multi-Arbor saves (`save_multiple`)
- [ ] Drift prevention: API parity, stub validation

**Final verification:**

```python
import arbors

# Single JSON object ("Tree") ergonomics
tree = arbors.read_json(b'{"items":[{"id": 1}, {"id": 2}], "user": {"name": "Alice"}}')

# TreePlan: collect() always returns Arbor (0..N), so explode is safe
exploded = tree.plan().explode(arbors.path("items")).collect()
assert len(exploded) == 2

# TreePlan: collect_tree() is the ergonomic terminal for exactly-1 results
one = tree.plan().select([arbors.path("user.name").alias("name")]).collect_tree()
assert one["name"].value == "Alice"

# collect_tree() raises ValueError when result cardinality != 1
try:
    tree.plan().explode(arbors.path("items")).collect_tree()
    assert False, "expected ValueError"
except ValueError:
    pass

# Tree.save() persists as a named Arbor with exactly 1 tree
tree.save("/tmp/test.arbors", "one_tree")
loaded_tree = arbors.open("/tmp/test.arbors", "one_tree").get(0)
assert loaded_tree["user"]["name"].value == "Alice"

# EAGER handle operations
arbor = arbors.read_jsonl(b'{"id": 1}\n{"id": 2}\n{"id": 3}')
filtered = arbor.filter(arbors.path("id") > arbors.lit(1))  # Executes NOW
sorted_a = filtered.sort_by(arbors.path("id"))              # Executes NOW
top = sorted_a.head(1)                                       # Executes NOW
with_new = arbor.append([arbors.from_dict({"id": 4})])      # Executes NOW

# LAZY plan operations
result = (
    arbor.plan()
    .filter(arbors.path("id") > arbors.lit(1))
    .sort_by([arbors.path("id")], [False])
    .head(1)
    .append([arbors.from_dict({"id": 5})])
    .collect()  # Single optimized execution
)

# Storage API - save() is the single-Arbor interface
arbor.save("/tmp/test.arbors", "data")              # Auto-commits
loaded = arbors.open("/tmp/test.arbors", "data")    # Returns Arbor
names = arbors.list("/tmp/test.arbors")             # Returns list of names
arbors.delete("/tmp/test.arbors", "data")           # Deletes named Arbor

# Atomic multi-Arbor saves - single call, atomic
users = arbors.read_jsonl(b'{"name": "Alice"}')
orders = arbors.read_jsonl(b'{"item": "book"}')
arbors.save_multiple("/tmp/test.arbors", {"users": users, "orders": orders})

# Verify
assert "users" in arbors.list("/tmp/test.arbors")
assert "orders" in arbors.list("/tmp/test.arbors")

# Open returns Arbor directly - no transactions needed
loaded_users = arbors.open("/tmp/test.arbors", "users")
loaded_orders = arbors.open("/tmp/test.arbors", "orders")

# API surface - Arbor-centric, no transactions exposed
assert not hasattr(arbors, 'ArborStoreSession')
assert not hasattr(arbors, 'ReadTxn')
assert not hasattr(arbors, 'WriteTxn')
assert hasattr(arbors, 'save_multiple')
assert hasattr(arbors, 'ArborStoreOptions')
```

| Checkpoint | Verification |
|------------|--------------|
| Rust tests pass | `cargo nextest run -p arbors` |
| Python tests pass | `just python-test-all` |
| API parity | `just check-parity` |
| Stubs valid | `just check-stubs` |
| Clippy clean | `cargo clippy -p arbors -- -D warnings` |
| Examples run | `python examples/python/12_persistence.py` |

**Commit after all checkpoints pass.**
