# Phase 19: CoreReboot: Refined Implementation Plan

## Design Decisions (Resolved)

Based on review and clarification:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ReadScope lifetime | **Arc-sharing** | Arbor holds `Arc<ReadScope>`, scope lives as long as any Arbor |
| ReadScope mutability / refresh | **Immutable snapshots** | `ReadScope` never mutates; `refresh()` returns a *new* `Arc<ReadScope>` |
| ReadScope thread-safety | **Send + Sync (promised)** | Rust core supports moving/sharing `ReadScope` across threads; Python enforces thread-affinity at the binding layer |
| Plan/scope boundary | **Scope-free `LogicalPlan`, scope-bound execution** | `LogicalPlan` (in `arbors-pipeline`) carries no `ReadScope` to avoid crate cycles; user-facing `Arbor` holds `Arc<ReadScope>` (in `arbors-base`) and binds it at execution time via an execution context |
| Iteration/threading model | **Python thread-confined; Rust core Send+Sync** | Python objects enforce thread-affinity (reject cross-thread use). Rust iterators/sinks are not treated as a cross-thread abstraction; internal rayon parallelism is used where safe (batch-local parallelism) |
| InMemory handles | **Scope-free** | InMemory arbors (e.g., from `read_jsonl`) do not require a `ReadScope`; `Arbor::from_inmemory(...)` remains a convenience API |
| Python REPL support | **Always valid** | `arbor = base['x']` works forever via Arc-sharing |
| Cost model | **Simple heuristics first** | Uniform distribution, batch count as IO proxy |
| “Staleness” detection | **Does not exist within MVCC snapshots** | Under MVCC, a scope is a consistent point-in-time view; users create a new scope to see newer data |

---

## Current Architecture (What Exists)

From codebase exploration:

```
Session                          # Wraps ArborStore + Mutex<Option<OwnedReadTxn>>
  ├── with_snapshot(|txn| ...)   # Lazy snapshot creation
  └── refresh()                  # Drop and recreate snapshot

ArborBacking                     # enum in handle.rs
  ├── InMemory(Arc<InMemoryArbor>)
  ├── Stored { session: Arc<Session>, name, meta }
  └── Filtered { source: Box<ArborBacking>, state, pinned_generation }

CloseToken                       # Python-only, Arc<AtomicBool>
  └── check()                    # Called on EVERY operation

validate_not_stale()             # Called on EVERY operation in handle.rs
  └── Compares meta.generation vs txn.get_meta().generation
```

**Problems with current design:**
1. Generation checking on every operation is expensive
2. CloseToken overhead on every Python call
3. Single cached snapshot in Session can cause refresh storms
4. No explicit ReadScope - staleness is implicit

---

## Target Architecture

```
ReadScope                        # Minimal: just MVCC snapshot
  ├── base: Arc<ArborStore>       # Keep base alive
  └── txn: OwnedReadTxn          # The MVCC snapshot (consistency guaranteed)
  # Immutable snapshot: never changes once created
  # NO generation tracking, NO staleness checks - MVCC provides snapshot isolation

WriteScope                       # Transactional writes
  ├── base: &ArborStore           # Reference to base
  └── txn: WriteTransaction      # Exclusive write lock
  # Explicit commit() or rollback()

Arbor (LogicalHandle)            # Redesigned handle.rs
  ├── plan: Arc<LogicalPlan>     # Logical plan (lazy)
  └── scope: Arc<ReadScope>      # Shared across all derived arbors

LogicalPlan                      # Replaces ArborBacking nesting
  ├── Source { backing, name }   # Root: InMemory or Stored
  ├── Filter { source, predicate, mode }
  ├── Select { source, exprs }
  ├── Head/Tail/Take { source, n }
  ├── Sort { source, keys }
  └── ... other plan nodes

PhysicalResult                   # Execution output (NOT trees)
  ├── Indices(IndexSet)          # Most ops produce indices
  ├── Aggregated(ExprResult)     # Terminal scalar results
  └── Projection { indices, transform }

IndexSet                         # Lazy index representation
  ├── Range { start, end }       # head/tail produce this
  ├── Sparse(Vec<usize>)         # filter produces this
  └── Permuted { perm, batch_grouped, restore_order? }  # sort produces this (batch-grouped by default)

Python: No CloseToken            # Removed entirely
  └── Arbor validity = Arc<ReadScope> validity
```

### Critical Design Principle: Indices-First Execution

**The physical layer operates on indices and batch coordinates, NOT on OwnedTree.**

Operations return `PhysicalResult` (indices/specs). Trees are only materialized at API boundaries:
- `iter()` in Python
- `collect()` / `materialize()`
- `to_json()`, `to_arrow()`
- `get(i)` / `__getitem__`

This preserves:
- Batch-level vectorization (`vectorized_ops`)
- Projection pushdown (`DecodePlan`)
- Batch-friendly locality
- Early-exit patterns

### Crate Ownership

| Component | Owner Crate |
|-----------|-------------|
| `LogicalPlan`, `PhysicalResult`, `IndexSet` | arbors-pipeline |
| `PipelineExecutor`, `TreeSource` | arbors-pipeline |
| Optimizer, cost model | arbors-pipeline |
| `Arbor` (user-facing handle wrapping `Arc<LogicalPlan>`) | arbors |
| `Session`, `WriteScope` | arbors |
| `ArborStore`, `OwnedReadTxn`, `ReadScope` | arbors-base |

**`arbors` is composition layer; `arbors-pipeline` is the engine.**

---

## Phase Plan

### Step 1: Sequencing Safety Rails (No-Migration, Still Safe)

**Exit Criteria:** Gates A/B/C are defined and referenced, and the "keep one end-to-end path working" rule is adopted for all subsequent steps.

**Goal**: Enable aggressive deletion (**no migration**) while keeping the repo continuously runnable and testable as behaviors/APIs move.

**Core rule**: **Always keep at least one end-to-end path working** (Rust + Python) at every step. Never land a change that requires "finish the refactor" before anything works again.

**Method**:
- **Test-first for semantics**: If a step changes observable behavior (lazy decode, ordering, close/refresh, commit rules), add/adjust tests *in the same step* before deleting old code.
- **One active engine at a time**: During transition, old implementation may remain in-tree, but each public API entrypoint should have exactly one "source of truth" implementation to avoid dual-engine drift.
- **Temporary adapters allowed, but short-lived**: Internal adapters (not user-facing shims) are allowed to bridge layers during a step, but must be deleted by Step 12.
- **Deletion gates**: Delete legacy paths only after:
  - the replacement passes invariants + conformance tests, and
  - Python delegation stays thin (no "logic creep").

**Per-step test gates (required to merge)**:
- **Gate A: Contract/invariants**: `crates/arbors/tests/invariants.rs` and `python/tests/test_invariants.py` cover lazy decode + streaming semantics using `arbors-base` counters.
- **Gate B: End-to-end user path**: at least one "golden" workflow works end-to-end:
  - Rust: open → read scope → query → iter/collect/to_json
  - Python: `open()` → `db["name"]` → `filter/sort/head` → `iter/to_json`
- **Gate C: Conformance** (introduced in Step 9): in-memory vs stored results match for the supported operator set.

*Gate B sequencing note*: Prior to Step 10 (Python thin layer rewrite), Gate B's Python path may temporarily be implemented via **internal adapters** (allowed by Step 1), as long as:
- user-visible Python semantics remain correct, and
- any adapter logic does not violate the Rust-first guardrails (no Python-side streaming/buffering/ordering logic), and
- adapters are deleted by Step 12.

*Note*: Because there are no external users, we do **not** preserve old APIs—however, we still sequence changes so the repo remains buildable/testable throughout.

---

#### Step 1 Implementation Summary

**Details**: See `plans/architecture-phase-19-implementations.md` (Step 1 Implementation Checklist) for the full checklisted procedure.

**What Step 1 establishes**:
- **Gates A/B/C** are defined and referenced for every subsequent step.
- **Gate A scaffolding** exists: `crates/arbors/tests/invariants.rs` and `python/tests/test_invariants.py` (skeletons; Step 2 fills in tests).
- **Gate B coverage** is confirmed to exist already (Rust + Python “golden path” tests).
- **Gate C** scope is explicitly documented as a future conformance suite (introduced in Step 9), with a pointer comment placed in the Gate A Rust file.
- **Instrumentation availability** is verified:
  - Rust: `arbors_base::reset_arborbase_stats()` / `arborbase_stats()`
  - Python: `arbors.reset_arborbase_stats()` / `arbors.arborbase_stats()` expose the core counters needed for invariant testing.

**Artifacts**:
- `crates/arbors/tests/invariants.rs` (Gate A skeleton)
- `python/tests/test_invariants.py` (Gate A skeleton)

**Status**:
- Baseline tests were run and were green at the time Step 1 was completed (`cargo test`, `make python && .venv/bin/pytest python/tests -v`).
- Step 1 commit is still pending (see checklist in `plans/architecture-phase-19-implementations.md`).

### Step 2: Contract and Invariants

**Exit Criteria:** Gate A passes (Rust + Python invariants) and Gate B remains green (one end-to-end path works).

**Goal**: Lock in the new contract with tests before any refactoring.

**Deliverables**:
1. **Observable decode metrics** for testing lazy semantics (**single source of truth in `arbors-base`**).

   **Decision**: Reuse the existing `arbors-base` instrumentation counters and snapshot/reset helpers. Do **not** introduce a parallel metrics API.

   Source-of-truth API (already exists in `crates/arbors-base/src/lib.rs`):
   - `reset_arborbase_stats()`
   - `arborbase_stats() -> ArborStoreStats` (includes `batches_decoded`, `pools_decoded`, `pools_skipped`, `materialize_calls`, `early_exit_batches_skipped`, etc.)

   (Optional) convenience re-export is fine, but should be a direct re-export of these existing constructs (not a new metrics surface).

2. **Precise semantics table** (what decodes, when):
   | Operation | Decodes? | When |
   |-----------|----------|------|
   | `filter(mode=lazy)` | NO | Never until access |
   | `head(n)` / `tail(n)` | NO | Computes range only |
   | `len()` on Stored | NO | Metadata lookup |
   | `len()` on Filtered/Lazy | MAYBE | If cache empty |
   | `matching_indices()` | YES | Always immediate |
   | `iter()` | YES | Per batch |
   | `get(i)` | YES | Single batch |

3. **Tests using observable counters** (not timing):
   ```rust
   #[test]
   fn test_lazy_filter_decodes_zero_batches() {
       arbors_base::reset_arborbase_stats();
       let _filtered = arbor.filter(&pred, FilterMode::Lazy)?;
       let stats = arbors_base::arborbase_stats();
       assert_eq!(stats.batches_decoded, 0);
   }
   ```

**Files**:
- `crates/arbors-base/src/lib.rs` (reuse existing `ArborStoreStats` + snapshot/reset for invariants)
- `crates/arbors/tests/invariants.rs` (new test)
- `python/tests/test_invariants.py` (new test)

---

#### Step 2 Implementation Summary

**Details**: See `plans/architecture-phase-19-implementations.md` (Step 2 Implementation Checklist) for the full checklisted procedure.

**What Step 2 locks in (Gate A)**:
- **Counter-based invariants (no timing)** using the existing `arbors-base` stats API:
  - `reset_arborbase_stats()`
  - `arborbase_stats() -> ArborStoreStats`
- **Rust invariants** (`crates/arbors/tests/invariants.rs`): 12 tests covering:
  - “no-decode” view ops (`head`, `tail`, `filter(mode=lazy)`, `len` on Stored)
  - “single-batch decode” (`get(i)`)
  - “incremental decode” (`iter()`)
  - “full-scan decode” (`matching_indices`, `filter(mode=immediate)`, `len` on lazy filter)
  - “early-exit” (`find_one`, `any`, `all`) including `early_exit_batches_skipped`
- **Python invariants** (`python/tests/test_invariants.py`): 12 tests split as:
  - **Unified Arbor** invariants (4): verify *no additional decoding after* `base.get()` (Python currently materializes on `get`).
  - **BatchedArbor** invariants (8): authoritative counter-based semantics on batched iteration + early-exit.
- **Isolation of global counters**: Rust tests are serialized (via `serial_test`) to avoid cross-test counter contamination.
- **Gate B remains green**: full Rust + Python test suites still pass after adding invariants.

**Artifacts**:
- `crates/arbors/Cargo.toml` (adds `serial_test` dev dependency)
- `crates/arbors/tests/invariants.rs` (placeholder → 12 invariant tests)
- `python/tests/test_invariants.py` (placeholder → 12 invariant tests)

**Status**:
- Gate A is green at the time Step 2 was completed (`cargo test -p arbors --test invariants`, `.venv/bin/pytest python/tests/test_invariants.py`).
- Gate B is green at the time Step 2 was completed (`cargo test`, `.venv/bin/pytest python/tests`).
- Step 2 commit is still pending (see checklist in `plans/architecture-phase-19-implementations.md`).

---

### Step 3: ReadScope Foundation

**Exit Criteria:** `ReadScope`/`WriteScope` contracts are implemented (immutable refresh, rollback-on-drop), and Gate B remains green.

**Goal**: Replace Session snapshot model with explicit `ReadScope` + Arc-sharing.

**Key Insight**: MVCC via `OwnedReadTxn` already guarantees snapshot consistency. A `ReadScope` is an immutable snapshot.

**Design**:

```rust
// crates/arbors-base/src/scope.rs (new module; re-exported by arbors-base)

/// Immutable read scope - wraps a single MVCC snapshot.
///
/// Once created, a ReadScope never changes. To see newer data,
/// create a new ReadScope or call `refresh()` which returns a new Arc<ReadScope>.
pub struct ReadScope {
    base: Arc<ArborStore>,    // Keep base alive
    txn: OwnedReadTxn,       // MVCC snapshot (consistency guarantee)
}

impl ReadScope {
    pub fn new(base: Arc<ArborStore>) -> Result<Arc<Self>, Error> {
        let txn = base.begin_read_owned()?;
        Ok(Arc::new(Self { base, txn }))
    }

    /// Create a new read scope with the latest snapshot.
    ///
    /// This scope remains unchanged; the returned scope sees new data.
    /// Existing Arbor handles continue using their original scope.
    pub fn refresh(&self) -> Result<Arc<Self>, Error> {
        Self::new(Arc::clone(&self.base))
    }

    pub fn arbor(self: &Arc<Self>, name: &str) -> Result<Arbor, Error> {
        let meta = self.txn.get_meta(name)?
            .ok_or_else(|| Error::NotFound(name.into()))?;
        Ok(Arbor::from_scope(Arc::clone(self), name, meta))
    }

    /// Access the transaction for queries/execution.
    pub fn txn(&self) -> &OwnedReadTxn {
        &self.txn
    }
}

// NOTE: WriteScope remains in the `arbors` crate (composition/API layer).
// It is intentionally not part of `arbors-base` because it shapes higher-level
// user semantics (commit required, Python context manager behavior, etc.).

/// Write scope for transactional writes
pub struct WriteScope<'a> {
    base: &'a ArborStore,
    txn: WriteTransaction<'a>,
}

impl<'a> WriteScope<'a> {
    pub fn put(&mut self, name: &str, arbor: &InMemoryArbor) -> Result<WriteStats, Error>;
    pub fn delete(&mut self, name: &str) -> Result<bool, Error>;
    pub fn commit(self) -> Result<(), Error>;
    pub fn rollback(self);  // explicit rollback (dropping without commit also rolls back)
}
```

**Semantics** (confirmed by user):
- Long-lived Arbor sees original snapshot forever
- To see later changes, create a new scope (or call `ReadScope::refresh()` to get a new scope)
- Writes NEVER affect existing read scopes (MVCC isolation)
- There is **no “staleness” concept within a scope**: each scope is a valid point-in-time view forever

**Session scope policy (Step 3 API detail; must be consistent across Rust + Python)**:
- `Session` maintains a cached **implicit** read scope for convenience (mirrors Python’s `implicit_scope` model).
- **`Session::read()` returns the cached `Arc<ReadScope>`**, creating it on first use (stable snapshot until refreshed).
- **`Session::refresh()` eagerly replaces the cached implicit scope** (`cached_scope = Some(new_scope)`) (new snapshot for future reads).
- Optional convenience: **`Session::read_fresh()`** may be added to always create a new scope without touching the cached implicit scope.

**Handle binding rule**:
- **Default (Step 3)**: `Session::arbor(name)` uses `Session::read()` (cached implicit scope) and returns an `Arbor` backed by that `Arc<ReadScope>` (**Scoped** path). The returned `Arbor` holds that scope forever.
- `ReadScope::arbor(name)` is the explicit-scope version and is the recommended primitive for precise snapshot control.
- Convenience: **`Session::arbor_fresh(name)`** returns an `Arbor` from a fresh scope (does not mutate the cached implicit scope).

**Legacy retention rule (No Migration Required)**:
- Keep the legacy `snapshot`/`with_snapshot()` machinery only as long as required to keep Gate B green during Step 3–Step 10 (notably, the existing Python path).
- Delete the legacy snapshot/with_snapshot path aggressively once Python is fully scope-based (Step 10) and no remaining code depends on it (Step 12 cleanup).

**Threading contract (explicit)**:
- **Rust promise**: `ReadScope` is **`Send + Sync`**. Rust callers may move/share scopes and handles across threads.
- **Execution model**: Query execution is still “single-threaded at the transaction boundary” by design:
  - decode/load batches on the calling thread
  - parallelize CPU work on decoded `InMemoryArbor` data (rayon)
  - do not rely on cross-thread shared iterators/sinks for correctness
- **Python enforcement**: Python-facing objects (`PyArborStore`, `PyArbor`, iterators, sinks) are **thread-confined** and reject cross-thread use via a runtime thread-affinity check (important because Rust bindings may release the GIL during long operations).
  - Also mark the classes unsendable at the binding layer (e.g., `#[pyclass(unsendable)]`) as an additional guardrail.

**Write-safety guarantee (“hard to use wrong”)**:
- Writes are transactional and **never implicitly committed**.
- A write scope that exits without `commit()` is **rolled back**.
- In Python, the `with db.write() as tx:` context manager should make this mistake loud:
  - If the block exits normally and `commit()` was not called, raise an error like:  
    `"write transaction exited without commit (rolled back)"`
  - If the block exits due to an exception, rollback and re-raise the original exception (no additional noise).

**Changes**:
1. Add minimal `ReadScope` type (just `base` + `txn`; immutable; NO generations map)
2. Add `WriteScope` type with explicit commit/rollback
3. `Arbor` holds `Arc<ReadScope>` instead of `Arc<Session>`
4. Delete all staleness checking (`validate_not_stale()` and any generation comparisons)

**Files**:
- `crates/arbors-base/src/scope.rs` (new: minimal `ReadScope` snapshot wrapper)
- `crates/arbors-base/src/lib.rs` (re-export `ReadScope`)
- `crates/arbors/src/scope.rs` (new: `WriteScope` only)
- `crates/arbors/src/handle.rs` (use Arc<ReadScope>)
- `crates/arbors/src/session.rs` (add read()/write() methods)

---

#### Step 3 Implementation Summary

**Details**: See `plans/architecture-phase-19-implementations.md` (Step 3 Implementation Checklist) for the full checklisted procedure.

**What Step 3 establishes**:
- **Immutable snapshot primitive** (`arbors-base::ReadScope`):
  - `ReadScope::new(base: Arc<ArborStore>) -> Arc<ReadScope>` creates a single MVCC snapshot (`OwnedReadTxn`)
  - `ReadScope::refresh(&self) -> Arc<ReadScope>` returns a *new* scope; existing scopes never change
  - **Compile-time assertion** that `OwnedReadTxn` and `ReadScope` are `Send + Sync` (promised contract)
- **Write API primitive** (`arbors::WriteScope`):
  - Wraps a `WriteTxn`; explicit `commit()`; dropping without commit rolls back
  - Includes unit tests for commit and rollback-on-drop
- **Session scope policy is implemented**:
  - `Session` holds `Arc<ArborStore>` plus a cached implicit `Arc<ReadScope>`
  - `Session::read()` returns the cached implicit scope (stable until refreshed)
  - `Session::refresh()` eagerly replaces the cached implicit scope (new snapshot for future reads)
  - `Session::read_fresh()` creates a new scope without mutating the cached implicit scope
  - **Default stored-handle binding rule is now true**: `Session::arbor(name)` returns an `Arbor` backed by `Arc<ReadScope>` (**Scoped**) and remains valid forever (point-in-time view)
- **Scoped stored backing exists end-to-end**:
  - `ArborBacking::Scoped { scope: Arc<ReadScope>, name, meta }` implemented across the unified handle
  - `Arbor::from_scope(...)` is the preferred constructor for stored handles
  - `open_arbor(scope, name)` convenience helper opens a scoped handle via metadata lookup
- **MVCC isolation is tested**:
  - New integration tests validate that older handles continue to work and see the original snapshot after writes + refresh
  - Legacy “stale after refresh” semantics are removed from the mainline tests and replaced with MVCC expectations
- **Legacy retention (explicit, temporary)**:
  - Legacy `snapshot`/`with_snapshot()` in `Session` and `ArborBacking::Stored` + `validate_not_stale()` remain in-tree but are **marked for removal in Step 12** (no longer the default path)

**Artifacts**:
- `crates/arbors-base/src/scope.rs` (new: `ReadScope` immutable MVCC snapshot wrapper)
- `crates/arbors-base/src/lib.rs` (re-export `ReadScope`)
- `crates/arbors/src/scope.rs` (new: `WriteScope` with explicit commit/rollback)
- `crates/arbors/src/session.rs` (Arc<ArborStore>; cached implicit scope; `read`/`read_fresh`/`refresh`/`write`; `arbor` returns Scoped)
- `crates/arbors/src/handle.rs` (`ArborBacking::Scoped`; `Arbor::from_scope`; legacy Stored/staleness code marked Step 12)
- `crates/arbors/src/lib.rs` (re-exports, incl. `ReadScope` and `open_arbor`)
- `crates/arbors/tests/scope_tests.rs` (integration tests for ReadScope + MVCC isolation)
- `crates/arbors/tests/unified_arbor_parity.rs` (staleness test rewritten to MVCC isolation expectations)

**Status**:
- Gate B is green at the time Step 3 was completed (full Rust + Python test suites pass; default parallel execution).

### Step 4: Logical Plan Handles

**Exit Criteria:** Public `Arbor` becomes a logical-plan handle (no backing nesting), and Gate B remains green.

**Goal**: Make `Arbor` a logical plan handle, not a materialized-data wrapper.

**Design**:

```rust
// Replace ArborBacking with LogicalPlan (owned by arbors-pipeline)
pub enum LogicalPlan {
    // Leaf nodes
    InMemory { arbor: Arc<InMemoryArbor> },
    /// Stored leaf is **scope-free** to avoid crate-boundary cycles and keep
    /// the plan purely logical. Snapshot binding happens at execution time.
    Stored { name: String },

    // Transform nodes (no nesting of Box<ArborBacking>)
    Filter { source: Arc<LogicalPlan>, predicate: Expr, mode: FilterMode },
    Select { source: Arc<LogicalPlan>, exprs: Vec<Expr> },
    Head { source: Arc<LogicalPlan>, n: usize },
    Tail { source: Arc<LogicalPlan>, n: usize },
    Take { source: Arc<LogicalPlan>, indices: Vec<usize> },
    Sort { source: Arc<LogicalPlan>, keys: Vec<SortKey> },
    // ... other transforms
}

pub struct Arbor {
    plan: Arc<LogicalPlan>,
    scope: Arc<ReadScope>, // scope is held by the user-facing handle (arbors crate)
    // No more direct backing - everything goes through plan
}

impl Arbor {
    pub fn filter(&self, predicate: Expr, mode: FilterMode) -> Arbor {
        Arbor {
            plan: Arc::new(LogicalPlan::Filter {
                source: Arc::clone(&self.plan),
                predicate,
                mode,
            })
        }
    }

    // Materialization boundary
    pub fn iter(&self) -> impl Iterator<Item = OwnedTree> {
        // Execute the plan by binding a ReadScope at execution time.
        execute_plan_with_ctx(&self.plan, ExecContext::from_scope(&self.scope))
    }
}
```

**Key insight**: Filter chains like `a.filter(p1).filter(p2).filter(p3)` become a flat DAG, not nested boxes.

**Execution binding contract (critical)**:
- `LogicalPlan` is scope-free and can be optimized/rewritten without any live I/O handles.
- The user-facing `Arbor` (in `arbors`) carries `Arc<ReadScope>` (from `arbors-base`).
- The pipeline executor accepts an execution context (e.g., `ExecContext`) that provides access to:
  - `&OwnedReadTxn` for stored reads (`ReadScope::txn()`)
  - any metadata/schema needed without decoding
  - source adapters (e.g., `BatchedSource<'txn>`) constructed *within* the execution call

**Stored source resolution happens at execution time (not in the plan)**:
- When executing `LogicalPlan::Stored { name }`, the executor uses the bound transaction:
  - `let batched = ctx.txn.get_batched(name)?;`
  - `let source = BatchedSource::new(&batched);`
- This keeps lifetimes correct (the batched view and source cannot outlive the txn) while keeping the logical plan pure.

**Threading decision**:
- `ReadScope` is **`Send + Sync` (promised)**; scope/handle movement across Rust threads is supported.
- Iterators and sinks produced by `iter()` / `to_json()` / `to_arrow()` are **not treated as a cross-thread abstraction**. They are Rust-owned and encode streaming semantics in Rust; Python enforces thread-affinity for these objects.
- Internal parallelism (where safe) uses rayon within operators/batch processing, but must not touch the read transaction concurrently:
  - decode/load batches on the calling thread
  - parallelize CPU work on the decoded `InMemoryArbor` data

This keeps plan/explain clean while avoiding crate cycles.

**Files**:
- `crates/arbors-pipeline/src/plan.rs` (modify existing: adapt/replace `QueryPlan` with `LogicalPlan`)
- `crates/arbors/src/handle.rs` (rewrite to use LogicalPlan)

---

#### Step 4 Implementation Summary

**Details**: See `~/.claude/plans/linear-leaping-dream.md` (Step 4 Implementation Checklist) for the full checklisted procedure.

**What Step 4 establishes**:
- **LogicalPlan is THE semantic model** (non-optional):
  - Every `Arbor` has `plan: Arc<LogicalPlan>` (always present)
  - Every `Arbor` has `scope: ArborScope` (InMemory or Scoped)
  - `ArborBacking` remains **temporarily** as the execution mechanism
- **Scope-free LogicalPlan** (`arbors-pipeline::LogicalPlan`):
  - Sources: `InMemory { arbor: Arc<InMemoryArbor> }`, `Stored { name: String }`
  - View transforms: `Filter`, `Head`, `Tail`, `Take`, `Sample`, `Shuffle`
  - Transform ops that materialize (`Select`, `AddField`, `Aggregate`) are NOT plan nodes
- **Execution binding via ArborScope**:
  - `ArborScope::InMemory` for in-memory arbors (no scope needed)
  - `ArborScope::Scoped(Arc<ReadScope>)` for database-backed arbors (MVCC snapshot)
  - Plan + scope bound at execution time to resolve stored sources
- **Both plan AND backing kept in sync**:
  - Constructors (`from_inmemory`, `from_scope`) create both plan and backing
  - View operations (`filter`, `head`, `tail`, `take`, `sample`, `shuffle`) update both
  - Debug invariants check plan/scope consistency
- **Legacy code marked for removal**:
  - `ArborBacking` enum → REFACTOR FIXME (Step 12: delete)
  - `backing` field on Arbor → REFACTOR FIXME (Step 12: delete)
  - `FilterState` enum → REFACTOR FIXME (Step 12: delete)
  - `validate_not_stale()` → REFACTOR FIXME (Step 12: delete)
- **QueryPlan demoted** (`arbors-pipeline`):
  - `QueryPlan`, `QueryOp`, `LazyArbor` marked REFACTOR FIXME (Step 12: delete)
  - LogicalPlan is the forward path

**Key implementation decisions**:
- **Deleted `from_stored()`**: Legacy constructor retired; use `from_scope()` instead
- **Replaced `from_filtered()`**: Now `from_backing_with_plan()` for explicit plan construction
- **6 view operations** have plan nodes; transform ops materialize and don't

**Artifacts**:
- `crates/arbors-pipeline/src/logical_plan.rs` (new: LogicalPlan enum and builder methods)
- `crates/arbors-pipeline/src/plan.rs` (demotion comments added)
- `crates/arbors/src/handle.rs` (Arbor struct with plan + scope + backing; ArborScope enum)
- `crates/arbors/src/lib.rs` (`__internal` exports for LogicalPlan, LogicalFilterMode, ArborScope)
- `crates/arbors/tests/logical_plan_tests.rs` (23 tests validating plan structure and scope binding)

**Status**:
- Gate B is green at the time Step 4 was completed (full Rust + Python test suites pass).

**Next steps**:
- **Step 5**: Plan-based execution replaces backing-based execution (ArborBacking becomes vestigial)
- **Step 12**: Delete ArborBacking, FilterState, validate_not_stale(), QueryPlan, LazyArbor

---

### Step 5: Unified TreeSource Execution (Indices-First)

**Exit Criteria:** Indices-first execution is the default path (no hidden materialization), and Gates A + B are green.

**Goal**: Execute `LogicalPlan` producing `PhysicalResult` (indices), NOT trees. Materialize only at API boundaries.

**Critical Design**: Physical layer operates on **(batch_idx, local_idx) / global indices**, not `OwnedTree`.

**Design**:

```rust
// crates/arbors-pipeline/src/physical.rs

/// Physical execution result - lazy until materialized
pub enum PhysicalResult {
    /// Most operations produce indices
    Indices(IndexSet),

    /// Terminal aggregation result
    Aggregated(ExprResult),

    /// Lazy projection spec (transform applied at materialization)
    Projection { indices: IndexSet, transform: TransformSpec },
}

/// Lazy index set representation
pub enum IndexSet {
    /// Contiguous range [start, end) - head/tail produce this
    Range { start: usize, end: usize },

    /// Sparse indices from filter
    Sparse(Vec<usize>),

    /// Sorted permutation (with batch-grouping flag)
    ///
    /// NOTE: for streaming sinks, permutations are produced batch-grouped by default
    /// (see Step 7) to bound memory. When batch_grouped=true, `restore_order`
    /// provides a compact mapping to emit in logical (sorted) order while reading
    /// sequentially by batch.
    Permuted {
        perm: Vec<usize>,
        batch_grouped: bool,
        restore_order: Option<Vec<usize>>,
    },
}

// Physical filter - returns INDICES, not trees
pub fn physical_filter<S: TreeSource>(
    source: &S,
    predicate: &Expr,
    input: &IndexSet,
) -> Result<IndexSet, PipelineError> {
    let plan = analyze_required_pools(predicate, source.schema());

    match input {
        IndexSet::Range { start, end } => {
            let mut matching = Vec::new();
            source.for_each_batch_with_plan(plan, |arbor, batch_idx| {
                // Use vectorized_filter for the batch
                let batch_matches = vectorized_filter(arbor, predicate)?;
                // ... collect matching global indices
            })?;
            Ok(IndexSet::Sparse(matching))
        }
        IndexSet::Sparse(indices) => {
            // Group by batch for locality, then filter
            filter_at_indices_batch_grouped(source, indices, predicate, plan)
        }
        // ...
    }
}

// Only materialize at API boundary
pub fn materialize<S: TreeSource>(
    source: &S,
    result: &PhysicalResult,
) -> Result<InMemoryArbor, PipelineError> {
    let global_indices = result.indices().to_vec();
    // Batch-optimal extraction is a first-class TreeSource capability (see below).
    source.extract_trees(&global_indices, /* plan */ DecodePlan::all())
}
```

#### TreeSource: batch-grouped subset API (required for indices-first execution)

**Problem being addressed**: Many physical operators naturally produce sparse global indices (`Vec<usize>`). For stored/batched sources, efficient access requires grouping those indices by batch so each batch is loaded once.

**Decision**: Extend the **existing** `TreeSource` trait in `arbors-pipeline` (do not introduce a parallel abstraction). Add batch-grouped subset operations as methods on `TreeSource` (not ad-hoc free functions). This makes locality guarantees explicit and shared across operators.

```rust
// crates/arbors-pipeline/src/source.rs (extend existing trait)

/// Batch-grouped iteration over sparse indices.
pub struct BatchGroupedIndices {
    /// Sorted list of (batch_idx, Vec<(position_in_output, local_idx)>)
    groups: Vec<(usize, Vec<(usize, usize)>)>,
    /// Total number of indices
    len: usize,
}

impl BatchGroupedIndices {
    /// Create batch groups from global indices.
    pub fn from_indices(indices: &[usize], trees_per_batch: usize) -> Self {
        use std::collections::BTreeMap;

        let mut groups: BTreeMap<usize, Vec<(usize, usize)>> = BTreeMap::new();
        for (position, &global_idx) in indices.iter().enumerate() {
            let batch_idx = global_idx / trees_per_batch;
            let local_idx = global_idx % trees_per_batch;
            groups.entry(batch_idx).or_default().push((position, local_idx));
        }

        Self {
            groups: groups.into_iter().collect(),
            len: indices.len(),
        }
    }
}

pub trait TreeSource: Sync {
    // ... existing methods ...

    /// Metadata for batch-grouped operations.
    fn trees_per_batch(&self) -> usize;

    /// Iterate over trees at specific global indices, grouped by batch.
    ///
    /// Callback receives (arbor, local_idx, output_position).
    /// `output_position` is the index in the original indices slice.
    fn for_each_at_indices<F>(
        &self,
        indices: &[usize],
        plan: DecodePlan,
        callback: F,
    ) -> Result<(), PipelineError>
    where
        F: FnMut(&InMemoryArbor, usize, usize) -> Result<(), PipelineError>;

    /// Extract trees at specific global indices, returning in original order.
    fn extract_trees(
        &self,
        indices: &[usize],
        plan: DecodePlan,
    ) -> Result<Vec<OwnedTree>, PipelineError>;
}
```

**Maintainability rule**:
- Provide **default implementations** for the new methods in terms of existing primitives (e.g., `get_tree`, `for_each_batch_with_plan`) so correctness is immediate.
- Override in `BatchedSource` to implement true batch-grouped behavior (decode each batch once).

**Trait object note (important)**:
- `TreeSource` is not object-safe (it has generic callback methods), so do **not** plan on `Arc<dyn TreeSource>`.
- When the executor needs a single “source” variable, use a small enum adapter (e.g., `ResolvedSource<'txn>`) that delegates to `InMemorySource` or `BatchedSource<'txn>`.

**Concrete modification points (extension, not rewrite)**:
- `crates/arbors-pipeline/src/source.rs`: extend the existing `TreeSource` trait + define `BatchGroupedIndices` helper
- `crates/arbors-pipeline/src/batched_source.rs`: implement efficient overrides for `BatchedSource<'txn>` (batch-grouped sparse access; decode each batch once)

*Note*: the current codebase already performs batch grouping manually in some places; this phase formalizes the pattern as a trait contract so all physical operators can rely on it.

**Materialization boundaries** (where trees are actually decoded):
- `iter()` in Python → batch-by-batch streaming
- `collect()` / `materialize()` → full extraction
- `to_json()`, `to_arrow()` → streaming sinks
- `get(i)` / `__getitem__` → single batch decode

**Changes**:
1. Add `PhysicalResult` and `IndexSet` types to arbors-pipeline
2. Physical operators return indices, not trees
3. Preserve `DecodePlan` pushdown in all physical operators
4. `PipelineExecutor` works on `LogicalPlan`, outputs `PhysicalResult`

**Files**:
- `crates/arbors-pipeline/src/physical.rs` (new module)
- `crates/arbors-pipeline/src/execute.rs` (rewrite to use PhysicalResult)
- `crates/arbors-pipeline/src/source.rs` (extend existing TreeSource + BatchGroupedIndices helper)
- `crates/arbors-pipeline/src/batched_source.rs` (extend existing BatchedSource impl to support batch-grouped sparse access)

---

### Step 6: Basic Optimizer

**Exit Criteria:** Rule-based rewrites are applied and observable via `explain()` (optimized vs logical), with Gate B remaining green.

**Goal**: Rule-based optimization without cost model.

**Note on `explain()` availability**:
- A minimal `explain()` (logical + optimized + DecodePlan summary) should be available by the end of this step to support debugging during Steps 6–9.
- The fully parameterized `explain()` / `explain_analyze()` API contract is finalized in Step 11.

**Optimizations**:
1. **Filter fusion**: `filter(p1).filter(p2)` → `filter(p1 AND p2)`
2. **Predicate pushdown**: Push filters before selects when possible
3. **Projection pruning**: Compute minimal `DecodePlan` for the whole query
4. **Limit pushdown**: Push `head(n)` into filters for early termination

**Files**:
- `crates/arbors-pipeline/src/optimize.rs` (extend existing)

---

### Step 7: Planned Global Operations

**Exit Criteria:** `sort_by`/`group_by`/`index_by` honor bounded-memory streaming defaults (fail-fast rather than silently materialize), and Gates A + B are green.

**Goal**: `sort_by`, `group_by`, `index_by`, etc. work without source materialization.

**Design principles**:
- Operations return *views* that reference source, not copies
- Indices/permutations are stored as lightweight side-structures
- **Batch-grouped access** to avoid pathological I/O patterns
- Source arbor stays lazy until actual tree access

#### Global-op memory honesty (fast-by-default ≠ free)

**Decision**: “Fast by default” means we avoid implicit **tree materialization** and unnecessary decoding. Some global operations still require **O(n)** auxiliary structures (keys/indices/permutations) to compute global order or grouping.

Examples:
- `sort_by`: may allocate O(n) sort keys and/or an O(n) permutation vector (even though trees are not materialized).
- streaming `group_by` (sort+run): may allocate O(n) keys/permutation to sort by key (while emitting groups without materializing trees).

**Permutation construction note**:
- `physical_sort` may temporarily build multiple O(n) index vectors (e.g., an initial permutation, a batch-grouped permutation, and a restore-order map). This is acceptable because these are indices (not trees), but should be kept visible in `explain()`/`explain_analyze()` and not accidentally multiplied further.

These costs must be visible in `explain()` (estimated) and `explain_analyze()` (observed), and bounded buffering rules still apply for sinks/iteration.

#### Rust-first guardrail: streaming behavior lives in Rust (no Python “logic creep”)

**Motivation**: The easiest way to accidentally violate “Rust-first” is to implement small pieces of query semantics in Python when Rust iteration is inconvenient (e.g., “just buffer a little,” “just restore order,” “just sort keys,” “just chunk batches”).

**Rule**: Any behavior that affects **streaming order**, **buffering**, **restoring order after batch-grouping**, or **sink semantics** must be implemented in Rust (engine layer). Python must remain a thin wrapper that only:
- constructs/holds handles and scopes
- invokes Rust methods
- converts returned results to Python types

**Explicitly prohibited in Python** (non-exhaustive):
- implementing “restore sorted order” logic for `sort_by(...).to_json()` or `sort_by(...).__iter__()`
- implementing buffering/windowing to make iteration “work”
- implementing fallback materialization when streaming is hard (e.g., `list(arbor)` inside `to_json`)

**Implementation instruction**: Provide Rust iterators/sinks that fully encode streaming semantics:
- `Arbor::iter()` / `PyArbor.__iter__` delegates to a Rust iterator that yields in the correct logical order
- `to_json()` / `to_arrow()` are Rust-owned streaming sinks that consume an index-stream and apply any required order restoration internally
- any bounded buffering (e.g., for `IndexSet::Permuted`) is handled inside Rust with explicit buffer limits/errors (never “papered over” by Python)

**Threading note (updated)**:
- Rust core is **Send+Sync** (including `ReadScope`), so Rust callers may execute queries from multiple threads.
- Python remains **thread-confined**: `PyArborStore` / `PyArbor` / iterators / sinks reject cross-thread use (Step 10).
- Do not implement any “make it work across threads” logic in Python (this is a common source of hidden buffering/materialization and correctness bugs).

#### Permutations and streaming memory model (critical for `to_json()` / sinks)

**Problem being addressed**: A naive “read in batch order then restore full sorted order” approach can require \(O(n)\) buffering for large permutations, which breaks streaming sinks.

**Decision**: Accept bounded buffering \(O(\text{batch\_size})\) (or a caller-configured cap), not \(O(n)\). If a permutation would exceed the buffer cap, return a clear error suggesting materialization.

**Contract**:
- `IndexSet::Permuted { .., batch_grouped: true, restore_order: Some(..) }` is the **default output of `physical_sort`**.
- Iteration over a permuted set supports **bounded-memory ordered emission** using `restore_order` (compact mapping), reading batches sequentially.
- Non-batch-grouped permutations are allowed as an internal representation, but must be either converted to batch-grouped form or guarded by a buffer cap at iteration time.

**Error contract**:
Add an error variant (name can vary; behavior must match):
`PipelineError::BufferLimitExceeded { required, limit, suggestion }`

#### Bounded-memory streaming budgets (defaults + tuning)

**Problem being addressed**: Without explicit budgets, it’s too easy for “fast by default” operations to devolve into implicit materialization or unbounded buffering (especially in sinks).

**Decision**: Introduce an explicit **streaming budget** used by *all* ordered iteration and streaming sinks. Defaults are conservative and bounded; advanced users can tune them.

**Budget model** (conceptual; names can vary):
- **`max_buffer_trees`**: maximum number of decoded trees buffered at once for ordered emission (e.g., restoring order after batch-grouping).  
  - **Default**: `trees_per_batch()` (i.e., at most one batch-worth of trees buffered at a time).
- **`max_group_keys`**: maximum number of distinct group keys tracked for streaming `group_by`.  
  - **Default**: `250_000` distinct keys (fail-fast beyond this; see below).
- **`max_index_entries`**: maximum number of entries allowed when building an index for `index_by` (or keyed lookups).  
  - **Default**: `2_500_000` entries (fail-fast beyond this).

**Principle**: Budgets are enforced in Rust; when exceeded, return a **clear error** with an actionable suggestion (increase budget, choose an eager/materializing mode, or explicitly request a different strategy).

**User-facing API surface** (examples; exact naming TBD):
- Rust:
  - `arbor.iter_with_budget(budget)`
  - `arbor.to_json_with_budget(path, budget)`
  - `arbor.group_by_with_budget(expr, budget)`
  - `arbor.index_by_with_budget(expr, budget)`
- Python:
  - `arbor.to_json(path, *, max_buffer_trees=..., max_group_keys=..., max_index_entries=...)`
  - (Optional) `with db.options(...): ...` to set session-wide defaults

**User-facing tradeoffs**:

| Scenario | Memory | Strategy |
|----------|--------|----------|
| `head(n)` on Stored | O(1) | Range - sequential |
| `filter()` on Stored | O(#matching indices) | Sparse + batch-grouped access |
| `sort_by()` then `iter()` | O(batch_size) | Batch-grouped permutation + restore map |
| `sort_by()` then `to_json()` | O(batch_size) | Same streaming behavior |
| `shuffle()` then `iter()` | O(batch_size) | Same pattern (if supported) |

**Physical sort output (batch-grouped by default)**:

```rust
// crates/arbors-pipeline/src/physical.rs (sketch)
pub fn physical_sort<S: TreeSource>(
    source: &S,
    keys: &[SortKey],
) -> Result<IndexSet, PipelineError> {
    // ... compute sorted indices ...
    let perm: Vec<usize> = /* sorted global indices */;

    // Immediately batch-group the permutation for efficient streaming.
    let grouped = batch_group_permutation(&perm, source.trees_per_batch());

    Ok(IndexSet::Permuted {
        perm: grouped.permutation,
        batch_grouped: true,
        restore_order: Some(grouped.restore_indices),
    })
}
```

**sort_by** (with batch locality strategy):
```rust
LogicalPlan::Sort { source, keys }

// Physical execution produces IndexSet::Permuted
pub fn physical_sort<S: TreeSource>(
    source: &S,
    keys: &[SortKey],
) -> Result<IndexSet, PipelineError> {
    // 1. Extract sort keys (minimal decode via DecodePlan)
    let mut keyed: Vec<(SortKey, usize)> = Vec::new();
    let plan = analyze_required_pools_for_keys(keys, source.schema());

    source.for_each_tree_with_plan(plan, |_, global_idx, tree| {
        let key = compute_sort_key(tree, keys)?;
        keyed.push((key, global_idx));
        Ok(())
    })?;

    // 2. Sort keys, keep original indices
    keyed.sort_by(|(a, _), (b, _)| a.cmp(b));
    let perm: Vec<usize> = keyed.into_iter().map(|(_, idx)| idx).collect();

    // Batch-group immediately to bound memory for streaming sinks.
    let grouped = batch_group_permutation(&perm, source.trees_per_batch());
    Ok(IndexSet::Permuted {
        perm: grouped.permutation,
        batch_grouped: true,
        restore_order: Some(grouped.restore_indices),
    })
}

// Batch-grouping for iteration (avoids random I/O)
impl IndexSet {
    pub fn batch_group(&self, batch_size: usize) -> BatchGroupedIter {
        // Reorder indices by batch for sequential I/O
        // Track restore-order to emit in original sorted order
    }
}
```

**Top-K optimization** (fused sort+head):
```rust
pub fn physical_top_k<S: TreeSource>(
    source: &S,
    keys: &[SortKey],
    k: usize,
) -> Result<IndexSet, PipelineError> {
    // Stream with BinaryHeap, maintain only top K
    // O(n log k) instead of O(n log n)
}
```

**group_by**:
```rust
// Fast-by-default streaming model:
//
// Default behavior uses a sort+run strategy to enable streaming with bounded memory:
// 1) Compute an index permutation that sorts by the group key (DecodePlan includes only key fields)
// 2) Stream in key order, detecting runs of equal keys
// 3) Emit groups one-at-a-time (bounded buffering), without materializing source trees
//
// Ordering contract:
// - Groups are emitted in **key order** by default (the natural order produced by sort+run).
//
// This avoids building a full key -> Vec<indices> map by default.
//
// Guardrails:
// - Enforce max_group_keys budget (fail-fast on cardinality explosion)
// - If a caller explicitly requests "encounter-order groups" or random access by key,
//   that requires building an in-memory index; this must be opt-in and budgeted.
```

**index_by**:
```rust
// Fast-by-default model:
// - index construction is lazy: `index_by()` returns a view handle that does not immediately build the map.
// - On first keyed lookup / keyed iteration, build the HashMap<Key, usize> under a max_index_entries budget.
// - If the budget is exceeded, return an explicit error suggesting:
//   - increase max_index_entries, or
//   - use a different access pattern (e.g., sort+binary-search), or
//   - materialize explicitly.
```

**Locality strategy for all permuted access**:
1. When iterating `IndexSet::Permuted`, batch-group indices
2. Fetch each batch once, extract needed trees
3. Restore original order in output buffer
4. Emit in correct sorted order

**Files**:
- `crates/arbors/src/handle.rs` (add sort_by, group_by, index_by)
- `crates/arbors-pipeline/src/plan.rs` (add plan nodes)
- `crates/arbors-pipeline/src/physical.rs` (add physical operators)
- `crates/arbors-pipeline/src/topk.rs` (new module - Top-K optimization)

---

### Step 8: Cost Model Optimizer

**Exit Criteria:** Cost model is integrated and surfaced via `explain_with(ExplainOptions { costs: true })` (Rust) / `explain(costs=True)` (Python), with Gate B remaining green.

**Goal**: Simple heuristic-based cost model for better plan selection.

**Heuristics**:
```rust
struct CostModel {
    // Cardinality estimation
    fn estimate_selectivity(predicate: &Expr) -> f64 {
        // Default: 0.5 (50% of rows pass)
        // Equality: 0.1 (10% of rows)
        // Range: 0.3 (30% of rows)
    }

    // IO cost
    fn io_cost(source: &LogicalPlan) -> f64 {
        match source {
            InMemory { arbor } => 0.0,  // Already in memory
            Stored { .. } => batch_count * BATCH_READ_COST,
        }
    }

    // CPU cost
    fn cpu_cost(plan: &LogicalPlan) -> f64 {
        // Vectorized: 0.1x interpreted cost when schema available
    }
}
```

**Decisions enabled**:
- Filter ordering (push selective filters first)
- Vectorized vs interpreted execution
- When to materialize intermediate results

**Files**:
- `crates/arbors-pipeline/src/optimize/cost.rs` (new module)
- `crates/arbors-pipeline/src/optimize/mod.rs` (export cost model)
- `crates/arbors-pipeline/src/optimize/logical_plan.rs` (add FilterSelectivityOrder rule)
- `crates/arbors/src/handle.rs` (ExplainOptions, explain_with())

---

### Step 9: InMemory/Stored/Filtered Parity

**Exit Criteria:** Gate C conformance suite is green for the supported operator set (in-memory vs stored parity).

**Goal**: Conformance suite ensuring identical behavior across all backings.

**Test matrix**:
- Supported operations (as of Step 7) × All source types × All data shapes
- Performance invariants (batch counts, early exit)
- Edge cases (empty arbors, single tree, nulls)

**Files**:
- `crates/arbors/tests/conformance.rs` (new test)

---

### Step 10: Python Thin Layer

**Exit Criteria:** Python remains a thin layer (no planning/streaming logic, no CloseToken), and Gate B’s Python path remains green.

**Goal**: Remove CloseToken, delegate everything to Rust.

**Changes**:
1. Remove `CloseToken` struct entirely
2. `PyArborStore` holds `Arc<ArborStore>` - lives as long as any Python Arbor
3. `Arbor` holds `Arc<ReadScope>` from Rust side - validity = scope validity
4. All planning/optimization happens in Rust - Python is pure delegation
5. Add `read()` and `write()` context managers
6. Define explicit, non-ambiguous `refresh()` and `close()` semantics (below)
7. **Rust-first enforcement**: Python must not implement any streaming/ordering/buffering semantics; all iterators and sinks must be Rust-owned (see Step 7 “Rust-first guardrail”)
8. **Thread confinement enforcement (Python-only)**: Rust core (including `ReadScope`) is **`Send + Sync`**, but Python objects are thread-affined; calls from a different OS thread error (especially important if Rust releases the GIL during long operations)
9. Add a Python test that verifies thread confinement (cross-thread use raises)

**Read API** (REPL-friendly):
```python
# Default: implicit scope, always valid
db = arbors.open("data.arbors")
arbor = db["my_data"]  # Creates implicit ReadScope, Arc-shared
# arbor valid indefinitely - sees original snapshot forever

# Explicit refresh returns a *new* implicit scope
db.refresh()            # Creates new implicit scope v2
new_arbor = db["my_data"]  # Uses scope v2

# Optional explicit scope (advanced)
with db.read() as scope:
    arbor = scope["my_data"]
```

**Write API** (explicit transactions):
```python
# Explicit write scope with commit/rollback
with db.write() as tx:
    tx.put("users", updated_arbor)
    tx.commit()  # Required - no implicit commit

# After write, existing read scopes still see old data (MVCC)
# Call refresh() or create new scope to see changes
db.refresh()
```

**Context manager safety (prevents “forgot to commit”)**:
- `db.write()` returns a context-managed transaction object.
- On `__exit__`:
  - if `commit()` was not called and no exception occurred: **raise** (and rollback)
  - if an exception occurred: **rollback** and propagate the exception

Add a Python test to lock this in (name illustrative):
`python/tests/test_write_scope_commit_required.py::test_write_scope_raises_on_missing_commit()`

Add a Python test to lock thread confinement in (name illustrative):
`python/tests/test_thread_confinement.py::test_db_methods_raise_cross_thread()`

**Optional close for early resource release**:
```python
# close() is optional - resources freed when last reference drops.
# close() prevents *new operations on db* but does NOT invalidate existing arbors.
db.close()
```

#### Python `refresh()` semantics (precise contract)

- `db.refresh()` **replaces the cached implicit scope** with a newly-created `Arc<ReadScope>`.
- Existing `Arbor` handles keep using their original `Arc<ReadScope>` and continue to work forever (point-in-time view).

#### Python `close()` semantics (precise contract)

**Decision**: `close()` sets a “closed” flag on `PyArborStore` that prevents *new operations on the base*, but does not force-invalidate existing arbors. Existing arbors keep working until dropped because they hold `Arc<ReadScope>` → `Arc<ArborStore>`.

**After `db.close()`**:
- `db["name"]` raises
- `db.list()` raises
- `db.write()` raises
- `db.read()` raises (unless explicitly allowed; default: raises for clarity)
- Existing `PyArbor` objects continue working without any per-operation checks

**Implementation sketch** (structure, not exact types):

```rust
#[pyclass(unsendable)]
pub struct PyArborStore {
    /// Keeps DB alive via Arc.
    session: Arc<Session>,

    /// Implicit read scope for convenient access.
    implicit_scope: Mutex<Option<Arc<ReadScope>>>,

    /// Closed flag: prevents NEW operations on db.
    closed: AtomicBool,

    /// Thread-affinity guard: Python objects must be used from the creating thread.
    /// (This avoids surprising cross-thread usage, especially when releasing the GIL.)
    creator_thread: std::thread::ThreadId,
}

#[pymethods]
impl PyArborStore {
    fn check_thread_affinity(&self) -> PyResult<()> {
        if std::thread::current().id() != self.creator_thread {
            Err(PyRuntimeError::new_err("ArborStore is thread-confined; use from the creating thread"))
        } else {
            Ok(())
        }
    }

    fn refresh(&self) -> PyResult<()> {
        self.check_thread_affinity()?;
        self.check_not_closed()?;
        let mut guard = self.implicit_scope.lock().unwrap();
        let base = Arc::clone(self.session.base_arc());
        *guard = Some(ReadScope::new(base).map_err(arborbase_error_to_py_err)?);
        Ok(())
    }

    fn close(&self) {
        // close is thread-confined as well (keeps semantics predictable)
        let _ = self.check_thread_affinity();
        self.closed.store(true, Ordering::Release);
        let mut guard = self.implicit_scope.lock().unwrap();
        *guard = None;
    }

    fn check_not_closed(&self) -> PyResult<()> {
        if self.closed.load(Ordering::Acquire) {
            Err(PyRuntimeError::new_err("ArborStore has been closed"))
        } else {
            Ok(())
        }
    }
}
```

**Key invariant**:
- The “closed” flag is checked only on `PyArborStore` methods (no per-operation CloseToken).
- Thread-affinity is enforced on **both** `PyArborStore` and `PyArbor` methods for consistency (reject cross-thread use).

**Files**:
- `python/src/lib.rs` (remove CloseToken, add read()/write() methods)
- `python/src/base.rs` (expose write API)

---

### Step 11: Observability

**Exit Criteria:** `explain()` defaults to logical+optimized+DecodePlan summary (physical off by default), and `explain_analyze(...)` provides observed stats when requested.

**Goal**: `explain()` must reliably expose pushdowns and plan rewrites by showing the **logical**, **optimized**, and **physical** pipeline, plus the **chosen DecodePlan**. It should also optionally show estimated and/or observed costs/stats.

#### `explain()` contract (parameterized; no underspec)

**Decision**: `explain()` is parameterized so developers can ask for exactly what they need, while a sensible default remains concise.

**Model**:
- **Logical plan**: the plan DAG as constructed by the public API (before rewrites)
- **Optimized plan**: after rule-based and/or cost-based rewrites (filter fusion, limit pushdown, TopK fusion, etc.)
- **Physical plan**: execution strategy (opt-in), including:
  - operator selection (vectorized vs interpreted) - predicted via heuristics
  - index representation choices (`Range`, `Sparse`, `Permuted`)
  - batch-grouping / buffering strategy (including restore-order behavior)
- **DecodePlan**: the final pool projection chosen for execution (projection pruning/pushdown), plus early termination conditions
- **Costs**: estimated cardinality/selectivity from the cost model (opt-in)

#### Observed stats: "analyze" tier (bounded + best-effort)

**Decision**: `explain()` must remain purely static/cheap (no decoding). Observed stats are a second tier via `explain_analyze(...)`.

**Bounded analyze model** (implemented):
- `explain_analyze(...)` supports optional limits:
  - `max_trees`: stop after emitting N trees
  - `time_budget_ms`: stop after elapsed time (checked between yields)
- Output clearly indicates whether stats are **partial** (bounded) or **full**.
- **Note**: `max_batches` was **deferred** (not implemented).

**Bounds limitations** (documented in code):
- `max_trees` limits emission, not upstream work (a filter may scan many trees before returning N).
- `time_budget_ms` is only checked between yielded trees; for global pre-pass plans (e.g., full sort), it may not bound runtime.

**Stats source** (implemented):
- **`arbors-base` observed counters** (best-effort delta): snapshot `arborbase_stats()` before/after and report the delta.
  - These are global counters, so deltas can be noisy if other work executes concurrently.
  - Tests use `#[serial]` to avoid concurrent counter pollution.
  - Python thread-affinity reduces this for Python callers, but the API documents the best-effort nature.
- **Per-run executor stats** (preferred; deterministic) were **deferred** for future work.

#### Implemented API

**Rust**:
```rust
// Section flags (physical off by default)
pub struct ExplainOptions {
    pub logical: bool,      // default: true
    pub optimized: bool,    // default: true
    pub physical: bool,     // default: false (opt-in)
    pub decode_plan: bool,  // default: true
    pub costs: bool,        // default: false (opt-in)
}

// Analyze options (bounds)
pub struct AnalyzeOptions {
    pub max_trees: Option<usize>,
    pub time_budget_ms: Option<u64>,
}

// Static plan inspection
arbor.explain() -> String                           // default sections
arbor.explain_with(ExplainOptions) -> String        // custom sections

// Observed stats (runs the query)
arbor.explain_analyze() -> String                   // default sections + full execution
arbor.explain_analyze_with(ExplainOptions, AnalyzeOptions) -> String  // custom + bounded
```

**Python** (thin delegation to Rust):
```python
# Static plan inspection
arbor.explain(
    *,
    logical: bool = True,
    optimized: bool = True,
    physical: bool = False,
    decode_plan: bool = True,
    costs: bool = False,
) -> str

# Observed stats (runs the query)
arbor.explain_analyze(
    *,
    logical: bool = True,
    optimized: bool = True,
    physical: bool = False,
    decode_plan: bool = True,
    costs: bool = False,
    max_trees: int | None = None,
    time_budget_ms: int | None = None,
) -> str
```

**Example output**:
```python
>>> arbor.filter(p1).sort_by(key).head(10).explain_analyze(max_trees=10)
Logical Plan:
  Head(n=10)
    Sort(key=path("date"))
      Filter(p1)
        Stored("my_data")

Optimized Plan:
  TopK(n=10, key=path("date"))  # Fused sort+head
    Filter(p1)
      Stored("my_data")

DecodePlan Summary:
  Projection: ["date", "name"]
  Early termination: Some(10)

Observed Stats (PARTIAL - bounded execution):
  trees_returned: 10
  batches_decoded: 3
  execution_time_ms: 12
```

**Files**:
- `crates/arbors/src/handle.rs` (observability methods + `ExplainOptions`/`AnalyzeOptions`/`ExecutionStats`)
- `python/src/lib.rs` (Python bindings for `explain()` and `explain_analyze()`)
- `python/arbors/_arbors.pyi` (type stubs)
- `crates/arbors/tests/integration/observability_tests.rs` (Rust integration tests)
- `python/tests/test_observability.py` (Python integration tests)

---

### Step 12: Cleanup - Remove Old Patterns

**Exit Criteria:** Legacy patterns are deleted (no parallel engines), and Gates A + B + C are all green (repo stays buildable/testable).

**Goal**: Aggressively delete legacy code that's been superseded.

**Patterns to remove**:

| Old Pattern | Replacement | Location |
|-------------|-------------|----------|
| `ArborBacking` enum | `LogicalPlan` | `handle.rs` |
| `ArborBacking::Filtered` | `LogicalPlan::Filter` node | `handle.rs` |
| `validate_not_stale()` | **DELETE** (no staleness under MVCC snapshots) | `handle.rs` |
| `pinned_generation` field | **DELETE** (no staleness under MVCC snapshots) | `handle.rs` |
| `Session.snapshot` mutex | `ReadScope` owns txn directly | `session.rs` |
| `CloseToken` struct | Arc-sharing via `ReadScope` | `python/src/lib.rs` |
| `check_closed()` calls | Delete entirely | `python/src/lib.rs` |
| `LazyArbor` in pipeline | Unified with main `Arbor` | `arbors-pipeline/` |
| `QueryPlan` (InMemory-only) | `LogicalPlan` (source-agnostic) | `arbors-pipeline/` |

**Cleanup checklist**:
- [ ] Delete `ArborBacking` enum
- [ ] Delete `FilterState` enum (state lives in plan nodes)
- [ ] Delete `validate_not_stale()` function (entirely)
- [ ] Delete `CloseToken` struct and all `check_closed()` calls
- [ ] Remove `LazyArbor` - merge into main `Arbor`
- [ ] Remove old `QueryPlan` - replaced by `LogicalPlan`
- [ ] Remove any `materialize()` calls that are now unnecessary
- [ ] Delete dead code paths in Python bindings
- [ ] Run `cargo clippy` and `cargo test` to catch any dangling references

**Files**:
- All files modified in earlier phases
- Run project-wide dead code elimination

---

## No Migration Required

**IMPORTANT:** This is a brand new library with ZERO external users. There is no need for:
- Deprecation warnings
- Legacy API shims
- Migration guides for external consumers
- Backward compatibility

We can and should **delete old patterns aggressively** rather than maintaining parallel implementations.

---

## Summary: Refined Step Order

| Step | Description | Dependencies |
|------|-------------|--------------|
| 1 | Sequencing safety rails | - |
| 2 | Contract + invariants | Step 1 |
| 3 | ReadScope foundation | Step 2 |
| 4 | Logical plan handles | Step 3 |
| 5 | Unified TreeSource execution | Step 4 |
| 6 | Basic optimizer | Step 5 |
| 7 | Planned global ops | Step 6 |
| 8 | Cost model optimizer | Step 7 |
| 9 | Parity tests | Step 7 |
| 10 | Python thin layer | Step 3, 4 |
| 11 | Observability | Step 8 |
| **12** | **Cleanup: Remove old patterns** | All above |

---

## Gaps Addressed from Review

| Gap | Fix | Where |
|-----|-----|-------|
| Iterator-based loses perf | Indices-first PhysicalResult | Step 5 |
| Arc/mutability mismatch in `ReadScope::refresh` | Immutable snapshots; `refresh(&self) -> Arc<ReadScope>` | Step 3, 10 |
| Staleness story inconsistent | No staleness under MVCC snapshots; delete `validate_not_stale()` + generation checks | Step 3, 12 |
| Plan ownership unclear | arbors-pipeline owns engine | Architecture |
| Metrics duplication risk | Single metrics authority in `arbors-base`; pipeline re-exports | Step 2 |
| "lazy" semantics ambiguous | Contract tests assert decode behavior via metrics snapshots | Step 2 |
| Sorted views break streaming memory | Batch-grouped permutations + restore map; bounded buffering + buffer-limit error | Step 7 |
| Python `close()` semantics ambiguous | `close()` blocks new base ops; existing arbors keep working via Arc | Step 10 |
| Write-side underdeveloped | WriteScope + Python API | Step 3, 10 |

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `crates/arbors-base/src/scope.rs` | New module: minimal `ReadScope` (MVCC snapshot wrapper) |
| `crates/arbors/src/scope.rs` | New module: `WriteScope` (commit/rollback semantics; Python context manager integration) |
| `crates/arbors/src/handle.rs` | Replace ArborBacking with LogicalPlan |
| `crates/arbors-pipeline/src/physical.rs` | New module: PhysicalResult, IndexSet |
| `crates/arbors-base/src/lib.rs` | Enhance: global decode metrics counters (single source of truth) |
| `crates/arbors-pipeline/src/plan.rs` | Modify existing: replace `QueryPlan` with `LogicalPlan` (owned by pipeline crate) |
| `crates/arbors-pipeline/src/execute.rs` | Rewrite for indices-first execution |
| `crates/arbors-pipeline/src/optimize.rs` | Extend optimizer |
| `crates/arbors-pipeline/src/topk.rs` | New module: Top-K optimization |
| `crates/arbors-pipeline/src/cost.rs` | New module: Cost model |
| `python/src/lib.rs` | Remove CloseToken, add read()/write() |

---

## Success Criteria

1. **Rust-first**: Python contains no planning/optimization logic
2. **Fast by default**: `sort_by`, `group_by`, `to_json` do not materialize unless requested
3. **Hard to use wrong**: No CloseToken, REPL-friendly, ACID via ReadScope
4. **Optimized**: Filter/projection/limit pushdowns visible in `explain()`
5. **Unified**: InMemory/Stored/Filtered pass identical conformance tests
