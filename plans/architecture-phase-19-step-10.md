# Step 10: Python Thin Layer - Implementation Plan

## Overview

**Exit Criteria:** Python remains a thin layer (no planning/streaming logic, no CloseToken), and Gate B's Python path remains green.

**Goal**: Remove CloseToken, delegate everything to Rust, and enforce the "Rust-first" principle where Python is pure delegation with no streaming, ordering, or buffering logic.

**Key Changes**:
1. Remove `CloseToken` struct entirely - replace with `closed` flag on PyArborStore only
2. `PyArborStore` holds `Arc<Session>` - lives as long as any Python Arbor
3. `Arbor` holds `Arc<ReadScope>` from Rust side - validity = scope validity (already done in Rust)
4. All planning/optimization happens in Rust - Python is pure delegation
5. Add `read()` and `write()` context managers with explicit semantics
6. Define explicit, non-ambiguous `refresh()` and `close()` semantics
7. **Rust-first enforcement**: Python must not implement any streaming/ordering/buffering
8. **Thread confinement enforcement**: Python objects reject cross-thread use

---

## Current State Analysis

### File Structure

The Python bindings are implemented in:
- `/Users/kocienda/Mounts/u/src/arbors/python/src/lib.rs` (~14,200 lines)

### CloseToken Implementation (Lines 1606-1636)

```rust
#[derive(Clone)]
pub struct CloseToken(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl CloseToken {
    fn new() -> Self { ... }
    fn close(&self) { ... }
    fn is_closed(&self) -> bool { ... }
    fn check(&self) -> PyResult<()> { ... }
}
```

**Current semantics (problematic)**:
- `CloseToken` is shared between `PyArborStore` and all derived `Arbor` handles
- When `PyArborStore.close()` is called, ALL derived arbors become invalid
- This violates MVCC semantics: existing handles should continue working forever

### CloseToken Usage Sites (21+ locations)

The `check_closed()` method or `close_token.check()` is called throughout:

| Location | Type | Method |
|----------|------|--------|
| Line 1650 | Arbor | `check_closed()` impl |
| Line 1685 | Arbor | `len_py()` |
| Line 1695 | Arbor | `materialize()` |
| Line 1721 | Arbor | `__getitem__` |
| Line 1765 | Arbor | `__iter__` |
| Line 1799 | Arbor | `num_nodes` getter |
| Line 2167 | Arbor | `filter()` |
| Line 2219 | Arbor | `to_dicts()` |
| Line 2249 | Arbor | `iterate_dicts()` |
| Line 2335 | Arbor | `to_arrow()` |
| Line 2366 | Arbor | `select()` |
| Line 2393 | Arbor | `add_field()` |
| Line 2461 | Arbor | `agg()` |
| Line 2604 | Arbor | `explode()` |
| Line 2651 | Arbor | `flatten()` |
| Line 2718 | Arbor | `nest()` |
| Line 3149 | Arbor | `index_by()` |
| Line 3177 | Arbor | `group_by()` |
| Line 3215 | Arbor | `sort()` |
| Line 3247 | Arbor | `shuffle()` |
| Line 3277 | Arbor | `validate()` |
| Line 3651 | ArborIterator | `__next__` |
| Line 3821 | DictIterator | `__next__` |
| Line 3937 | SelectedDictIterator | `__next__` |

### Current Write API (Lines 13456-13527)

**PyWriteTxn** currently auto-commits on success:
```rust
fn __exit__(...) -> PyResult<bool> {
    if let Some(txn) = self.inner.take() {
        if exc_type.is_some() {
            txn.abort();  // Exception: rollback
        } else {
            txn.commit()?;  // Success: AUTO-COMMIT (WRONG!)
        }
    }
    Ok(false)
}
```

**Issue**: Auto-commits on success. Step 10 requires explicit `commit()` with "forgot to commit" safety.

### Current close() Semantics (Lines 13943-13945)

```rust
fn close(&self) {
    self.close_token.close();  // INVALIDATES ALL DERIVED ARBORS
}
```

**Current**: Invalidates ALL derived arbors immediately.

**Required**: Only prevents NEW operations on db; existing arbors continue working.

### Thread Safety Current State

- **No thread affinity checks** exist in Python bindings
- Two classes marked `unsendable`: `ObjectBuilder`, `ArrayBuilder`
- GIL is released during: JSON parsing, Arrow export, LazyArbor collection
- ReadScope and Session are `Send + Sync` in Rust

### Python-Side Streaming Logic (Violation - WILL BE FIXED)

**ArborIterator** (lines 3617-3640) implements batch caching in Python:
```rust
struct StoredBatchCache {
    batch: std::sync::Arc<arbors::InMemoryArbor>,
    batch_idx: usize,
    trees_per_batch: usize,
    tree_count: usize,
}

pub struct ArborIterator {
    arbor: Py<Arbor>,
    index: usize,
    close_token: Option<CloseToken>,
    batch_cache: Option<StoredBatchCache>,  // Python-side caching!
}
```

**This violates the thin-layer principle.** Rust already has `PlanBasedIter` that handles batch caching. The fix is straightforward:

1. `ArborScope` is `Clone` and holds `Arc<ReadScope>` - already owned, not borrowed
2. `PlanBasedIter<'a>` borrows `&'a ArborScope` only for idiomatic Rust iterator pattern
3. We create `OwnedPlanBasedIter` that clones the scope (cheap - Arc-backed)
4. Python wraps `OwnedPlanBasedIter` - no batch caching in Python

**This will be fixed in Sub-Steps 10.8 and 10.9.**

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CloseToken removal | Replace with closed flag on PyArborStore only | Arbors should never be invalidated (MVCC) |
| Thread confinement scope | **PyArborStore + Arbor + iterators** - use shared helper | Users can hold and use any object from another thread |
| Write semantics | Delete `begin_write()`, add `write()` with commit-required | One API, no legacy cruft |
| `db.put()` semantics | **Accept any Arbor, materialize in Rust** | Thin-layer: Python shouldn't care about backing type |
| close() semantics | Only prevents new operations; **idempotent** | MVCC: existing handles work forever; multiple close() calls are fine |
| Context manager close | `with arbors.open(...) as db:` calls `close()` on exit | Standard Python resource management |
| `read()` context manager | **Optional** - not required for exit criteria | `db["name"]` already works; `read()` is for advanced snapshot control |
| Batch caching | **Move to Rust via generic `PlanBasedIter<S>`** | Avoid code duplication; thin-layer principle |
| #[pyclass(unsendable)] | Use for all stateful classes | Compile-time + runtime safety |

### Key Design Clarifications

**Thread Confinement Scope:**
Thread confinement must cover ALL Python-exposed types. Users can keep `Arbor`, `Tree`, `Node`, and iterators and call them from other OS threads. To truly enforce "Python objects are thread-confined," we need thread checks in:
- `PyArborStore` methods (db operations)
- `Arbor` methods that access stored backing
- `Tree` methods (holds arbor reference)
- `Node` methods (holds arbor reference)
- Iterator `__next__` methods (ArborIterator, DictIterator, SelectedDictIterator)
- Use a **shared helper function** to avoid duplication

**Write API (No Legacy):**
Delete `begin_write()` / `PyWriteTxn` entirely. Add `write()` with commit-required semantics:
- Zero external users = no migration needed
- One clean API: `db.write()`
- Tests updated to use new API

**Dict Iteration (Thin Layer Boundary):**
The thin-layer principle requires iteration order/buffering to be in Rust. For dict iterators:
- **Iteration order**: MUST be Rust (`OwnedArborIter`) - this is the correctness fix
- **Projection (SelectedDictIterator)**: Rust via `Expr::eval()` on each tree
- **Dict construction**: Can stay in Python (purely structural conversion, no ordering/buffering)

The key constraint: Python never decides *which* tree comes next or *when* to load batches. That's Rust's job.

**Performance Expectation:**
Correctness > performance. However, no significant regression expected because:
- Rust's `PlanBasedIter` already handles batch caching internally
- We're moving batch management from Python to Rust, not removing it
- Both approaches cache batches, just in different places

**Implementation Notes (Gotchas):**

1. **`Expr::eval()` API**: The code sketch uses `expr.eval(&arbor, root)` which may not exist as written. Actual implementation should use `arbors_query::eval_expr` + `EvalContext` (what `handle.rs` uses for `find_one`), or expose a small Rust helper for "evaluate exprs for a tree."

2. **Dict key ordering**: When converting tree→dict, ensure stable key order. Don't walk internal node structures in nondeterministic order if tests rely on stable output.

3. **Close + escaped arbor test**: Must test: create arbor inside `with open(...) as db:`, exit context, then verify arbor still iterates. This validates "close prevents new db ops but doesn't invalidate derived arbors."

**Generic Iterator (No Code Duplication):**
Instead of creating separate `OwnedPlanBasedIter` with copied logic, generalize `PlanBasedIter` to own or borrow:
```rust
pub struct PlanBasedIter<S> {
    scope: S,  // Either &ArborScope or ArborScope
    // ... rest unchanged
}

impl<S: Borrow<ArborScope>> Iterator for PlanBasedIter<S> {
    fn next(&mut self) -> Option<Self::Item> {
        let scope: &ArborScope = self.scope.borrow();
        // ... same logic
    }
}
```
- `Arbor::iter(&self) -> PlanBasedIter<&ArborScope>` (borrowing)
- `Arbor::iter_owned(&self) -> PlanBasedIter<ArborScope>` (owning, clones scope)

---

## Implementation Sub-Steps

### Sub-Step 10.1: Add Thread Confinement Infrastructure

**Goal:** Add thread affinity checking to ALL Python-exposed types: PyArborStore, Arbor, Tree, Node, and iterators.

**Files:**
- MODIFY: `python/src/lib.rs`

**Changes:**

1. Create a shared thread affinity helper function:
```rust
/// Check that the current thread matches the creator thread.
/// Used by all thread-confined Python objects.
fn check_thread_affinity(creator_thread: std::thread::ThreadId, type_name: &str) -> PyResult<()> {
    if std::thread::current().id() != creator_thread {
        Err(PyRuntimeError::new_err(
            format!("{} is thread-confined; use from the creating thread", type_name)
        ))
    } else {
        Ok(())
    }
}
```

2. Add `creator_thread` field to PyArborStore:
```rust
#[pyclass(name = "ArborStore", unsendable)]
pub struct PyArborStore {
    session: std::sync::Arc<arbors::Session>,
    close_token: CloseToken,  // Keep for now
    creator_thread: std::thread::ThreadId,  // NEW
}

impl PyArborStore {
    fn check_thread_affinity(&self) -> PyResult<()> {
        check_thread_affinity(self.creator_thread, "ArborStore")
    }
}
```

3. Add `creator_thread` field to Arbor:
```rust
#[pyclass(name = "Arbor", unsendable)]
pub struct Arbor {
    pub inner: RustArbor,
    pub schema: Option<std::sync::Arc<arbors_schema::SchemaRegistry>>,
    pub close_token: Option<CloseToken>,  // Keep for now
    creator_thread: std::thread::ThreadId,  // NEW
}
```

4. Add `creator_thread` field to Tree:
```rust
#[pyclass(name = "Tree", unsendable)]
pub struct Tree {
    arbor: Py<Arbor>,
    root_id: NodeId,
    tree_idx: usize,
    creator_thread: std::thread::ThreadId,  // NEW
}
```

5. Add `creator_thread` field to Node:
```rust
#[pyclass(name = "Node", unsendable)]
pub struct Node {
    arbor: Py<Arbor>,
    node_id: NodeId,
    creator_thread: std::thread::ThreadId,  // NEW
}
```

6. Add `creator_thread` to all iterators:
```rust
pub struct ArborIterator {
    // ... existing fields ...
    creator_thread: std::thread::ThreadId,
}

pub struct DictIterator {
    // ... existing fields ...
    creator_thread: std::thread::ThreadId,
}

pub struct SelectedDictIterator {
    // ... existing fields ...
    creator_thread: std::thread::ThreadId,
}
```

7. Update constructors to capture thread ID and propagate to derived objects

8. Add thread affinity checks to:
   - **PyArborStore methods**: `__getitem__`, `get`, `list`, `refresh`, `close`, `write`, `put`, `delete`, `__contains__`
   - **Arbor methods**: `__iter__`, `materialize`, `len_py`, `__getitem__`, `filter`, `to_dicts`, `to_arrow`, `sort`, `shuffle`, etc.
   - **Tree methods**: all methods that access the arbor
   - **Node methods**: all methods that access the arbor
   - **Iterator `__next__` methods**: `ArborIterator`, `DictIterator`, `SelectedDictIterator`

**Checklist:**
- [ ] Create shared `check_thread_affinity()` helper function
- [ ] Add `creator_thread` field to PyArborStore
- [ ] Add `creator_thread` field to Arbor
- [ ] Add `creator_thread` field to Tree
- [ ] Add `creator_thread` field to Node
- [ ] Add `creator_thread` field to ArborIterator, DictIterator, SelectedDictIterator
- [ ] Add `#[pyclass(unsendable)]` to Arbor, Tree, Node, and all iterators
- [ ] Update all constructors to capture and propagate thread ID
- [ ] Add thread affinity check to all PyArborStore public methods
- [ ] Add thread affinity check to all Arbor methods
- [ ] Add thread affinity check to all Tree methods
- [ ] Add thread affinity check to all Node methods
- [ ] Add thread affinity check to iterator `__next__` methods
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v`

**Gate B Impact:** Addition only - must pass

---

### Sub-Step 10.2: Add Thread Confinement Test

**Goal:** Add Python test verifying thread confinement behavior.

**Files:**
- NEW: `python/tests/test_thread_confinement.py`

**Test Code:**

```python
"""Test thread confinement for Python bindings.

PyArborStore and related objects are thread-confined to prevent
surprising behavior when the GIL is released during operations.
"""
import threading
import pytest
import tempfile
import arbors


def test_arborbase_rejects_cross_thread_access():
    """ArborStore operations from different thread raise RuntimeError."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        errors = []

        def use_from_other_thread():
            try:
                db.list()  # Should raise
            except RuntimeError as e:
                errors.append(e)

        t = threading.Thread(target=use_from_other_thread)
        t.start()
        t.join()

        assert len(errors) == 1
        assert "thread-confined" in str(errors[0]).lower()


def test_arborbase_works_from_same_thread():
    """ArborStore operations from same thread work normally."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        # These should all work
        assert db.list() == []
        assert "nonexistent" not in db


def test_arbor_operations_work_from_same_thread():
    """Arbor operations from creating thread work normally."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        # Create and store test data
        arbor = arbors.read_jsonl(b'{"x": 1}\n{"x": 2}')
        db.put("test", arbor)

        # Access and iterate - should work
        retrieved = db["test"]
        assert len(retrieved) == 2

        for tree in retrieved:
            assert tree is not None


def test_refresh_from_same_thread():
    """Refresh from creating thread works."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)
        db.refresh()  # Should not raise


def test_close_from_same_thread():
    """Close from creating thread works."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)
        db.close()  # Should not raise
```

**Checklist:**
- [ ] Create `python/tests/test_thread_confinement.py`
- [ ] Add tests for cross-thread rejection
- [ ] Add tests for same-thread success
- [ ] Verify: `.venv/bin/pytest python/tests/test_thread_confinement.py -v`

**Gate B Impact:** Tests only

---

### Sub-Step 10.3: Replace CloseToken with Closed Flag

**Goal:** Replace CloseToken struct with a simple closed flag on PyArborStore. Remove close_token from Arbor entirely.

**Files:**
- MODIFY: `python/src/lib.rs`

**Changes:**

1. Update PyArborStore struct:
```rust
#[pyclass(name = "ArborStore", unsendable)]
pub struct PyArborStore {
    session: std::sync::Arc<arbors::Session>,
    // close_token: CloseToken,  // REMOVE
    closed: std::sync::atomic::AtomicBool,  // NEW
    creator_thread: std::thread::ThreadId,
}

impl PyArborStore {
    fn check_not_closed(&self) -> PyResult<()> {
        if self.closed.load(std::sync::atomic::Ordering::Acquire) {
            Err(PyRuntimeError::new_err("ArborStore has been closed"))
        } else {
            Ok(())
        }
    }
}
```

2. Update close() method:
```rust
fn close(&self) {
    // Only set the closed flag - does NOT invalidate derived arbors
    let _ = self.check_thread_affinity();  // Still check affinity
    self.closed.store(true, std::sync::atomic::Ordering::Release);
}
```

3. Update Arbor struct - remove close_token:
```rust
#[pyclass(name = "Arbor")]
pub struct Arbor {
    pub inner: RustArbor,
    pub schema: Option<std::sync::Arc<arbors_schema::SchemaRegistry>>,
    // close_token: Option<CloseToken>,  // REMOVE - arbors are always valid
}
```

4. Remove `check_closed()` from Arbor:
```rust
impl Arbor {
    // DELETE:
    // fn check_closed(&self) -> PyResult<()> { ... }
}
```

5. Remove ALL `self.check_closed()?;` calls from Arbor methods (21+ locations)

6. Remove CloseToken from iterators:
```rust
pub struct ArborIterator {
    arbor: Py<Arbor>,
    index: usize,
    // close_token: Option<CloseToken>,  // REMOVE
    batch_cache: Option<StoredBatchCache>,
}
```

7. Remove `close_token.check()?;` from iterator `__next__` methods

8. Update `__getitem__` in PyArborStore to not propagate CloseToken:
```rust
fn __getitem__(&self, py: Python<'_>, name: &str) -> PyResult<Py<Arbor>> {
    self.check_thread_affinity()?;
    self.check_not_closed()?;

    let scope = self.session.read().map_err(arborbase_error_to_py_err)?;
    let meta = scope.get_meta(name).map_err(arborbase_error_to_py_err)?
        .ok_or_else(|| PyKeyError::new_err(name.to_string()))?;

    Ok(Py::new(py, Arbor {
        inner: RustArbor::from_scope(scope, name.to_string(), meta),
        schema: None,
        // NO close_token propagation
    })?)
}
```

9. Delete CloseToken struct entirely (lines 1606-1636)

**Checklist:**
- [ ] Replace `close_token: CloseToken` with `closed: AtomicBool` in PyArborStore
- [ ] Update `close()` to only set closed flag
- [ ] Add `check_not_closed()` method to PyArborStore
- [ ] Remove `close_token` field from Arbor struct
- [ ] Delete `check_closed()` method from Arbor
- [ ] Remove ALL `check_closed()` calls from Arbor methods (21+ locations)
- [ ] Remove `close_token` from ArborIterator, DictIterator, SelectedDictIterator
- [ ] Remove CloseToken checks from iterator `__next__` methods
- [ ] Update `__getitem__` to not propagate CloseToken
- [ ] Delete CloseToken struct definition
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v`

**Gate B Impact:** Semantics change - existing arbors now work after close(). Tests may need updates.

---

### Sub-Step 10.4: Add Close Semantics Test

**Goal:** Add test verifying new close() semantics.

**Files:**
- MODIFY: `python/tests/test_arbor_base.py` (add to existing TestContextManager or create new section)

**Test Code:**

```python
def test_close_does_not_invalidate_existing_arbors():
    """Existing arbors continue working after db.close()."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        # Create and store test data
        arbor = arbors.read_jsonl(b'{"x": 1}\n{"x": 2}\n{"x": 3}')
        db.put("test", arbor)

        # Get a handle BEFORE close
        existing = db["test"]

        # Close the database
        db.close()

        # Existing arbor still works (MVCC semantics)
        assert len(existing) == 3
        for tree in existing:
            assert tree is not None

        # New operations fail
        with pytest.raises(RuntimeError, match="closed"):
            db["test"]

        with pytest.raises(RuntimeError, match="closed"):
            db.list()

        with pytest.raises(RuntimeError, match="closed"):
            db.refresh()


def test_close_prevents_new_write_transactions():
    """Cannot start write transaction after close."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)
        db.close()

        with pytest.raises(RuntimeError, match="closed"):
            db.write()


def test_context_manager_escaped_arbor():
    """Arbor created inside context manager works after exit."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"

        # Create arbor inside context, let it escape
        with arbors.open(db_path) as db:
            arbor = arbors.read_jsonl(b'{"x": 1}\n{"x": 2}\n{"x": 3}')
            with db.write() as tx:
                tx.put("test", arbor)
                tx.commit()
            db.refresh()
            escaped = db["test"]

        # Context exited, db.close() was called
        # But escaped arbor should still work (MVCC)
        assert len(escaped) == 3
        count = 0
        for tree in escaped:
            count += 1
            assert tree is not None
        assert count == 3


def test_close_is_idempotent():
    """Multiple close() calls are fine."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)
        db.close()
        db.close()  # Should not raise
        db.close()  # Should not raise
```

**Checklist:**
- [ ] Add `test_close_does_not_invalidate_existing_arbors`
- [ ] Add `test_close_prevents_new_write_transactions`
- [ ] Add `test_context_manager_escaped_arbor`
- [ ] Add `test_close_is_idempotent`
- [ ] Verify: `.venv/bin/pytest python/tests/test_arbor_base.py -v -k close`

**Gate B Impact:** Tests only

---

### Sub-Step 10.5: Implement Write Scope with Commit-Required Semantics

**Goal:** Unify write API to require explicit commit. Both `db.write()` and `db.begin_write()` will use the same commit-required semantics.

**Design Decision:** One API, one rule. We change the existing `PyWriteTxn` (returned by `begin_write()`) to require explicit commit, and add `db.write()` as an alias that returns the same type. This is a **breaking change** but ensures consistent behavior.

**Files:**
- MODIFY: `python/src/lib.rs`

**Changes:**

1. Update existing PyWriteTxn to require explicit commit (rename to PyWriteScope for clarity):
```rust
/// Write scope with explicit commit requirement.
///
/// The write scope MUST have commit() called before exiting.
/// If __exit__ is called without commit(), it raises RuntimeError
/// and rolls back the transaction.
#[pyclass(name = "WriteScope")]
pub struct PyWriteScope {
    /// The underlying write transaction (None after commit/rollback).
    inner: Option<arbors_base::OwnedWriteTxn>,
    /// Whether commit() was called.
    committed: bool,
    /// Thread that created this scope.
    creator_thread: std::thread::ThreadId,
}

#[pymethods]
impl PyWriteScope {
    fn check_thread_affinity(&self) -> PyResult<()> {
        if std::thread::current().id() != self.creator_thread {
            Err(PyRuntimeError::new_err(
                "WriteScope is thread-confined; use from the creating thread"
            ))
        } else {
            Ok(())
        }
    }

    /// Store an arbor in the database.
    fn put(&mut self, name: &str, arbor: &Arbor) -> PyResult<()> {
        self.check_thread_affinity()?;
        let txn = self.inner.as_mut()
            .ok_or_else(|| PyRuntimeError::new_err("WriteScope already consumed"))?;

        // Materialize the arbor if needed
        let materialized = arbor.inner.materialize()
            .map_err(|e| PyRuntimeError::new_err(format!("Materialize failed: {}", e)))?;

        txn.put(name, &materialized, None)
            .map_err(arborbase_error_to_py_err)?;
        Ok(())
    }

    /// Delete an arbor from the database.
    fn delete(&mut self, name: &str) -> PyResult<bool> {
        self.check_thread_affinity()?;
        let txn = self.inner.as_mut()
            .ok_or_else(|| PyRuntimeError::new_err("WriteScope already consumed"))?;

        txn.delete(name).map_err(arborbase_error_to_py_err)
    }

    /// Commit the transaction.
    ///
    /// This MUST be called before exiting the context manager.
    fn commit(&mut self) -> PyResult<()> {
        self.check_thread_affinity()?;
        let txn = self.inner.take()
            .ok_or_else(|| PyRuntimeError::new_err("WriteScope already consumed"))?;

        txn.commit().map_err(arborbase_error_to_py_err)?;
        self.committed = true;
        Ok(())
    }

    /// Explicitly rollback the transaction.
    fn rollback(&mut self) -> PyResult<()> {
        self.check_thread_affinity()?;
        if let Some(txn) = self.inner.take() {
            txn.abort();
        }
        Ok(())
    }

    fn __enter__(slf: Py<Self>) -> Py<Self> {
        slf
    }

    fn __exit__(
        &mut self,
        exc_type: Option<&PyAny>,
        _exc_val: Option<&PyAny>,
        _exc_tb: Option<&PyAny>,
    ) -> PyResult<bool> {
        // If there was an exception, rollback and propagate
        if exc_type.is_some() {
            if let Some(txn) = self.inner.take() {
                txn.abort();
            }
            return Ok(false); // Propagate the exception
        }

        // If commit() was not called, this is an error
        if !self.committed {
            if let Some(txn) = self.inner.take() {
                txn.abort();
            }
            return Err(PyRuntimeError::new_err(
                "WriteScope exited without commit() (transaction rolled back)"
            ));
        }

        Ok(false)
    }
}
```

2. Add `write()` method, delete `begin_write()` entirely:
```rust
/// Begin a write transaction (context manager with commit-required).
///
/// Usage:
///     with db.write() as tx:
///         tx.put("name", arbor)
///         tx.commit()  # REQUIRED
fn write(&self) -> PyResult<PyWriteScope> {
    self.check_thread_affinity()?;
    self.check_not_closed()?;

    let txn = self.session.base().begin_write_owned()
        .map_err(arborbase_error_to_py_err)?;

    Ok(PyWriteScope {
        inner: Some(txn),
        committed: false,
        creator_thread: std::thread::current().id(),
    })
}

// DELETE begin_write() entirely - no legacy shims needed
```

3. Update `put()` to accept any Arbor and materialize in Rust:
```rust
/// Store an arbor in the database.
///
/// Accepts any Arbor (InMemory, Stored, Filtered, sorted, etc.)
/// and materializes it in Rust before storing.
fn put(&mut self, name: &str, arbor: &Arbor) -> PyResult<()> {
    self.check_thread_affinity()?;
    let txn = self.inner.as_mut()
        .ok_or_else(|| PyRuntimeError::new_err("WriteScope already consumed"))?;

    // Materialize the arbor in Rust (thin-layer: Python doesn't care about backing)
    let materialized = arbor.inner.materialize()
        .map_err(|e| PyRuntimeError::new_err(format!("Materialize failed: {}", e)))?;

    txn.put(name, &materialized, None)
        .map_err(arborbase_error_to_py_err)?;
    Ok(())
}
```

**Checklist:**
- [ ] Delete `PyWriteTxn` and `begin_write()` entirely
- [ ] Create `PyWriteScope` with commit-required `__exit__`
- [ ] Update `put()` to call `arbor.inner.materialize()` instead of `get_inmemory()`
- [ ] Add `write()` method to PyArborStore
- [ ] Add thread affinity checks to PyWriteScope methods
- [ ] Update existing tests to use `db.write()` with explicit `commit()`
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v`

**Gate B Impact:** Tests using old `begin_write()` will fail to compile. Update tests in this sub-step.

---

### Sub-Step 10.6: Add Write Scope Commit-Required Test

**Goal:** Add test verifying write scope requires explicit commit.

**Files:**
- NEW: `python/tests/test_write_scope.py`

**Test Code:**

```python
"""Test write scope with commit-required semantics.

WriteScope enforces explicit commit() to prevent accidental data loss.
"""
import pytest
import tempfile
import arbors


def test_write_scope_raises_on_missing_commit():
    """WriteScope without commit() raises on exit."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        arbor = arbors.read_jsonl(b'{"x": 1}')

        with pytest.raises(RuntimeError, match="commit"):
            with db.write() as tx:
                tx.put("data", arbor)
                # NO commit() - should raise


def test_write_scope_with_commit_succeeds():
    """WriteScope with commit() succeeds."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        arbor = arbors.read_jsonl(b'{"x": 1}')

        with db.write() as tx:
            tx.put("data", arbor)
            tx.commit()  # Required

        # Verify data was written
        db.refresh()
        assert "data" in db
        assert len(db["data"]) == 1


def test_write_scope_rollback_on_exception():
    """WriteScope rolls back on exception without raising additional error."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        arbor = arbors.read_jsonl(b'{"x": 1}')

        with pytest.raises(ValueError, match="test error"):
            with db.write() as tx:
                tx.put("data", arbor)
                raise ValueError("test error")  # Exception before commit

        # Data should NOT be written
        db.refresh()
        assert "data" not in db


def test_write_scope_explicit_rollback():
    """WriteScope can be explicitly rolled back."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        arbor = arbors.read_jsonl(b'{"x": 1}')

        with db.write() as tx:
            tx.put("data", arbor)
            tx.rollback()  # Explicit rollback
            tx.commit()  # Commit after rollback is a no-op or error

        # Data should NOT be written
        db.refresh()
        assert "data" not in db


def test_write_scope_delete():
    """WriteScope can delete arbors."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        # First, create some data
        arbor = arbors.read_jsonl(b'{"x": 1}')
        db.put("data", arbor)
        assert "data" in db

        # Now delete it
        with db.write() as tx:
            tx.delete("data")
            tx.commit()

        db.refresh()
        assert "data" not in db


def test_write_scope_thread_confined():
    """WriteScope operations from different thread raise."""
    import threading

    with tempfile.TemporaryDirectory() as tmp:
        db_path = f"{tmp}/test.arbors"
        db = arbors.open(db_path)

        errors = []
        write_scope = None

        def enter_and_try_use():
            nonlocal write_scope
            try:
                # Can't even use tx from different thread
                if write_scope:
                    write_scope.commit()  # Should raise
            except RuntimeError as e:
                errors.append(e)

        with db.write() as tx:
            write_scope = tx
            t = threading.Thread(target=enter_and_try_use)
            t.start()
            t.join()
            tx.commit()  # Commit from creating thread works

        # Should have thread confinement error (or tx was already committed)
        # The important thing is no crash
```

**Checklist:**
- [ ] Create `python/tests/test_write_scope.py`
- [ ] Add `test_write_scope_raises_on_missing_commit`
- [ ] Add `test_write_scope_with_commit_succeeds`
- [ ] Add `test_write_scope_rollback_on_exception`
- [ ] Add `test_write_scope_explicit_rollback`
- [ ] Add `test_write_scope_delete`
- [ ] Add `test_write_scope_thread_confined`
- [ ] Verify: `.venv/bin/pytest python/tests/test_write_scope.py -v`

**Gate B Impact:** Tests only

---

### Sub-Step 10.7: Add Read Scope Context Manager (Optional)

**Goal:** Add optional explicit read scope for advanced users.

**Files:**
- MODIFY: `python/src/lib.rs`

**Changes:**

1. Create PyReadScope struct:
```rust
/// Explicit read scope for advanced snapshot control.
///
/// Most users should use db["name"] which uses the implicit scope.
/// Use db.read() when you need explicit snapshot control.
#[pyclass(name = "ReadScope")]
pub struct PyReadScope {
    scope: std::sync::Arc<arbors_base::ReadScope>,
    creator_thread: std::thread::ThreadId,
}

#[pymethods]
impl PyReadScope {
    fn check_thread_affinity(&self) -> PyResult<()> {
        if std::thread::current().id() != self.creator_thread {
            Err(PyRuntimeError::new_err(
                "ReadScope is thread-confined; use from the creating thread"
            ))
        } else {
            Ok(())
        }
    }

    /// Get an arbor from this read scope.
    fn __getitem__(&self, py: Python<'_>, name: &str) -> PyResult<Py<Arbor>> {
        self.check_thread_affinity()?;

        let meta = self.scope.get_meta(name)
            .map_err(arborbase_error_to_py_err)?
            .ok_or_else(|| PyKeyError::new_err(name.to_string()))?;

        Py::new(py, Arbor {
            inner: RustArbor::from_scope(Arc::clone(&self.scope), name.to_string(), meta),
            schema: None,
        })
    }

    /// List arbor names in this scope.
    fn list(&self) -> PyResult<Vec<String>> {
        self.check_thread_affinity()?;
        self.scope.list().map_err(arborbase_error_to_py_err)
    }

    /// Check if an arbor exists in this scope.
    fn __contains__(&self, name: &str) -> PyResult<bool> {
        self.check_thread_affinity()?;
        self.scope.contains(name).map_err(arborbase_error_to_py_err)
    }

    fn __enter__(slf: Py<Self>) -> Py<Self> {
        slf
    }

    fn __exit__(
        &mut self,
        _exc_type: Option<&PyAny>,
        _exc_val: Option<&PyAny>,
        _exc_tb: Option<&PyAny>,
    ) -> PyResult<bool> {
        // Read scope has no special cleanup
        Ok(false)
    }
}
```

2. Add `read()` method to PyArborStore:
```rust
/// Get an explicit read scope (fresh snapshot).
///
/// Most users should use db["name"] which uses the cached implicit scope.
/// Use db.read() when you need a fresh snapshot without affecting the cache.
///
/// Usage:
///     with db.read() as scope:
///         arbor = scope["name"]
fn read(&self) -> PyResult<PyReadScope> {
    self.check_thread_affinity()?;
    self.check_not_closed()?;

    let scope = self.session.read_fresh()
        .map_err(arborbase_error_to_py_err)?;

    Ok(PyReadScope {
        scope,
        creator_thread: std::thread::current().id(),
    })
}
```

**Checklist:**
- [ ] Create `PyReadScope` struct
- [ ] Implement `__getitem__`, `list`, `__contains__`
- [ ] Implement `__enter__` and `__exit__`
- [ ] Add `read()` method to PyArborStore
- [ ] Add thread affinity checks
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v`

**Gate B Impact:** Addition only

---

### Sub-Step 10.8: Generalize PlanBasedIter for Owned/Borrowed Scope

**Goal:** Generalize `PlanBasedIter` to support both borrowed and owned scope, eliminating Python-side batch caching without code duplication.

**Rationale:** The current Python `ArborIterator` implements `StoredBatchCache` - batch caching logic that belongs in Rust. Rather than copying `PlanBasedIter` logic into a separate `OwnedPlanBasedIter`, we generalize `PlanBasedIter<S>` where `S: Borrow<ArborScope>`.

**Files:**
- MODIFY: `crates/arbors/src/handle.rs`

**Changes:**

1. Generalize `PlanBasedIter` to be generic over scope storage:
```rust
use std::borrow::Borrow;

/// Plan-based iterator supporting both borrowed and owned scope.
///
/// Generic over `S` which can be:
/// - `&'a ArborScope` for borrowing (returned by `iter()`)
/// - `ArborScope` for owning (returned by `iter_owned()`)
///
/// The scope clone is cheap (Arc-backed), so owned iteration has minimal overhead.
pub struct PlanBasedIter<S> {
    /// The scope (borrowed or owned).
    scope: S,
    /// The index set to iterate (computed from plan execution).
    indices: IndexSet,
    /// Current position in the index set.
    position: usize,
    /// Budget for bounded buffering.
    budget: StreamingBudget,
    /// For Permuted indices: buffer of trees loaded from current batch.
    buffer: BTreeMap<usize, OwnedTree>,
    /// For batch-grouped access: current batch being processed.
    current_batch: Option<(usize, Arc<InMemoryArbor>)>,
    /// Trees per batch.
    trees_per_batch: usize,
    /// Total trees in the index set.
    total: usize,
    /// Root source info for tree access.
    root_info: RootSourceInfo,
    /// Precomputed inverse of restore_order.
    inv_restore: Vec<usize>,
    /// Deferred error to yield on first next() call.
    deferred_error: Option<PipelineError>,
}

impl<S: Borrow<ArborScope>> Iterator for PlanBasedIter<S> {
    type Item = Result<OwnedTree, PipelineError>;

    fn next(&mut self) -> Option<Self::Item> {
        // Use self.scope.borrow() to get &ArborScope
        let scope: &ArborScope = self.scope.borrow();

        // ... rest of implementation unchanged, just use `scope` instead of `self.scope`
    }
}
```

2. Update helper methods to use `Borrow`:
```rust
impl<S: Borrow<ArborScope>> PlanBasedIter<S> {
    fn load_single_tree(&mut self, global_idx: usize) -> Result<OwnedTree, PipelineError> {
        let scope: &ArborScope = self.scope.borrow();
        // ... use scope
    }

    fn next_permuted(&mut self) -> Option<Result<OwnedTree, PipelineError>> {
        let scope: &ArborScope = self.scope.borrow();
        // ... use scope
    }
}
```

3. Update `iter()` to return borrowing iterator:
```rust
impl Arbor {
    /// Iterate over trees in logical order.
    ///
    /// Returns a borrowing iterator tied to `&self`.
    pub fn iter(&self) -> PlanBasedIter<&ArborScope> {
        // ... existing implementation, just change return type
    }
}
```

4. Add `iter_owned()` for FFI/Python usage:
```rust
impl Arbor {
    /// Create an owned iterator (for FFI/Python usage).
    ///
    /// Unlike `iter()` which returns a borrowing iterator, this returns
    /// an iterator that owns its scope (cloned, cheap - Arc-backed).
    /// Can be held across FFI calls without lifetime issues.
    pub fn iter_owned(&self) -> PlanBasedIter<ArborScope> {
        // Clone scope (cheap - Arc-backed)
        let scope = self.scope.clone();

        // Execute plan to get indices
        let txn = scope.as_scope().map(|s| s.txn());
        let optimized = optimize_logical_plan(&self.plan);

        match execute_logical_plan(&optimized, txn) {
            Ok(result) => {
                let indices = result
                    .as_indices()
                    .cloned()
                    .unwrap_or(IndexSet::Range { start: 0, end: 0 });

                match self.get_root_info_and_batch_size() {
                    Ok((root_info, trees_per_batch)) => {
                        let total = indices.len();
                        let budget = if self.plan.requires_permutation() {
                            StreamingBudget::with_trees_per_batch(total)
                        } else {
                            StreamingBudget::with_trees_per_batch(trees_per_batch)
                        };

                        PlanBasedIter::new_owned(scope, indices, budget, root_info, trees_per_batch)
                    }
                    Err(e) => PlanBasedIter::error(e),
                }
            }
            Err(e) => PlanBasedIter::error(e),
        }
    }
}
```

5. Add type aliases for clarity:
```rust
/// Borrowing iterator (tied to Arbor lifetime).
pub type ArborIter<'a> = PlanBasedIter<&'a ArborScope>;

/// Owning iterator (for FFI, can outlive Arbor).
pub type OwnedArborIter = PlanBasedIter<ArborScope>;
```

**Checklist:**
- [ ] Add `use std::borrow::Borrow;` import
- [ ] Change `PlanBasedIter<'a>` to `PlanBasedIter<S>` where `S: Borrow<ArborScope>`
- [ ] Update `scope` field from `&'a ArborScope` to `S`
- [ ] Update all methods to use `self.scope.borrow()` to get `&ArborScope`
- [ ] Update `iter()` return type to `PlanBasedIter<&ArborScope>`
- [ ] Add `iter_owned()` method returning `PlanBasedIter<ArborScope>`
- [ ] Add constructors: `new()` for borrowed, `new_owned()` for owned
- [ ] Add type aliases `ArborIter<'a>` and `OwnedArborIter`
- [ ] Add tests comparing `iter()` and `iter_owned()` produce same results
- [ ] Verify: `cargo nextest run -p arbors`

**Gate B Impact:** Addition only - existing `iter()` behavior unchanged, just return type changes from `PlanBasedIter<'_>` to `PlanBasedIter<&ArborScope>`

---

### Sub-Step 10.9: Update Python ArborIterator to Use Rust Iterator

**Goal:** Replace Python-side `StoredBatchCache` with delegation to Rust's `OwnedArborIter`.

**Files:**
- MODIFY: `python/src/lib.rs`

**Changes:**

1. Delete `StoredBatchCache` struct entirely (lines 3617-3630)

2. Update `ArborIterator` to wrap Rust iterator:
```rust
/// Iterator over trees in an Arbor.
///
/// Delegates to Rust's `OwnedArborIter` for all iteration logic.
/// Python is a thin wrapper - no batch caching here.
#[pyclass(name = "ArborIterator")]
pub struct ArborIterator {
    /// The Rust iterator (owns its state, handles all batch caching).
    inner: arbors::OwnedArborIter,  // = PlanBasedIter<ArborScope>
    /// Reference to the source arbor (for schema in Tree creation).
    arbor: Py<Arbor>,
    /// Thread that created this iterator.
    creator_thread: std::thread::ThreadId,
}

#[pymethods]
impl ArborIterator {
    fn __iter__(slf: PyRef<'_, Self>) -> PyRef<'_, Self> {
        slf
    }

    fn __next__(mut slf: PyRefMut<'_, Self>, py: Python<'_>) -> PyResult<Option<Tree>> {
        // Thread confinement check
        check_thread_affinity(slf.creator_thread, "ArborIterator")?;

        // Delegate to Rust iterator - ALL iteration logic is in Rust
        match slf.inner.next() {
            Some(Ok(owned_tree)) => {
                // Convert OwnedTree to Python Tree
                let arbor_slice = owned_tree.into_arbor();
                let root_id = arbor_slice
                    .root(0)
                    .ok_or_else(|| ArborsError::new_err("OwnedTree has no root"))?;

                let (schema, creator_thread) = {
                    let arbor_ref = slf.arbor.borrow(py);
                    (arbor_ref.schema.clone(), arbor_ref.creator_thread)
                };

                let slice_arbor = Py::new(
                    py,
                    Arbor {
                        inner: RustArbor::from_inmemory(arbor_slice),
                        schema,
                        creator_thread,
                    },
                )?;

                Ok(Some(Tree {
                    arbor: slice_arbor,
                    root_id,
                    tree_idx: 0,
                }))
            }
            Some(Err(e)) => Err(pipeline_error_to_py_err(e)),
            None => Ok(None),
        }
    }
}
```

3. Update `Arbor.__iter__()` to create the new iterator:
```rust
fn __iter__(slf: Py<Self>, py: Python<'_>) -> PyResult<ArborIterator> {
    let arbor_ref = slf.borrow(py);

    // Thread confinement check
    arbor_ref.check_thread_affinity()?;

    // Create owned Rust iterator - Rust handles ALL iteration logic
    let inner = arbor_ref.inner.iter_owned();

    Ok(ArborIterator {
        inner,
        arbor: slf.clone(),
        creator_thread: arbor_ref.creator_thread,
    })
}
```

4. Update `DictIterator` to be fully Rust-driven:
```rust
/// Iterator that yields dicts from an Arbor.
///
/// - Iteration order: Rust (`OwnedArborIter`) - THIS IS THE FIX
/// - Tree→dict conversion: Python (structural traversal, no ordering decisions)
///
/// The key constraint: Python never decides *which* tree comes next.
#[pyclass(name = "DictIterator", unsendable)]
pub struct DictIterator {
    /// The Rust iterator (owns its state, handles all batch caching).
    inner: arbors::OwnedArborIter,
    /// Thread that created this iterator.
    creator_thread: std::thread::ThreadId,
}

#[pymethods]
impl DictIterator {
    fn __iter__(slf: PyRef<'_, Self>) -> PyRef<'_, Self> {
        slf
    }

    fn __next__(mut slf: PyRefMut<'_, Self>, py: Python<'_>) -> PyResult<Option<PyObject>> {
        check_thread_affinity(slf.creator_thread, "DictIterator")?;

        // Iteration order from RUST - Python never decides which tree is next
        match slf.inner.next() {
            Some(Ok(owned_tree)) => {
                let arbor = owned_tree.into_arbor();
                let root_id = arbor.root(0)
                    .ok_or_else(|| ArborsError::new_err("Tree has no root"))?;

                // Tree→dict is structural traversal (no ordering decisions)
                // This can stay in Python - it's just converting values
                let dict = tree_to_dict(py, &arbor, root_id)?;
                Ok(Some(dict.into()))
            }
            Some(Err(e)) => Err(pipeline_error_to_py_err(e)),
            None => Ok(None),
        }
    }
}
```

5. Update `SelectedDictIterator` to be fully Rust-driven:
```rust
/// Iterator that yields projected dicts from an Arbor.
///
/// - Iteration order: Rust (`OwnedArborIter`)
/// - Projection: Rust (`Expr::eval()`)
/// - Dict construction: Python (just boxing Rust values)
#[pyclass(name = "SelectedDictIterator", unsendable)]
pub struct SelectedDictIterator {
    /// The Rust iterator (owns its state, handles all batch caching).
    inner: arbors::OwnedArborIter,
    /// Projection expressions (evaluated in Rust).
    exprs: Vec<(String, arbors_expr::Expr)>,  // (name, expr) pairs
    /// Thread that created this iterator.
    creator_thread: std::thread::ThreadId,
}

#[pymethods]
impl SelectedDictIterator {
    fn __next__(mut slf: PyRefMut<'_, Self>, py: Python<'_>) -> PyResult<Option<PyObject>> {
        check_thread_affinity(slf.creator_thread, "SelectedDictIterator")?;

        // Iteration order from RUST
        match slf.inner.next() {
            Some(Ok(owned_tree)) => {
                let arbor = owned_tree.into_arbor();
                let root = arbor.root(0)
                    .ok_or_else(|| ArborsError::new_err("Tree has no root"))?;

                // Projection runs in RUST via Expr::eval()
                let dict = PyDict::new(py);
                for (name, expr) in &slf.exprs {
                    let value = expr.eval(&arbor, root)  // RUST - no Python logic
                        .map_err(|e| ArborsError::new_err(e.to_string()))?;
                    dict.set_item(name, value_to_py(py, &value))?;  // Python: just boxing
                }
                Ok(Some(dict.into()))
            }
            Some(Err(e)) => Err(pipeline_error_to_py_err(e)),
            None => Ok(None),
        }
    }
}
```

**Checklist:**
- [ ] Delete `StoredBatchCache` struct entirely
- [ ] Update `ArborIterator` to wrap `OwnedArborIter` (= `PlanBasedIter<ArborScope>`)
- [ ] Add `creator_thread` field to `ArborIterator`
- [ ] Add thread confinement check to `ArborIterator.__next__`
- [ ] Simplify `ArborIterator.__next__` to pure delegation
- [ ] Update `DictIterator` to wrap `OwnedArborIter` (fully Rust-driven iteration)
- [ ] Add `creator_thread` field to `DictIterator`
- [ ] Add thread confinement check to `DictIterator.__next__`
- [ ] Update `SelectedDictIterator` to wrap `OwnedArborIter` (fully Rust-driven iteration)
- [ ] Add `creator_thread` field to `SelectedDictIterator`
- [ ] Add thread confinement check to `SelectedDictIterator.__next__`
- [ ] Remove ALL batch caching logic from Python (no `StoredBatchCache` anywhere)
- [ ] Verify sorted/shuffled iteration produces correct order (correctness fix!)
- [ ] Add test for sorted `to_dicts()` / `iterate_dicts()` order
- [ ] Verify: `make python && .venv/bin/pytest python/tests -v`

**Gate B Impact:** Implementation change - iteration order now correct for sorted/shuffled arbors

---

### Sub-Step 10.10: Verify All Gates

**Goal:** Ensure all tests pass.

**Commands:**
```bash
cargo test -p arbors --test invariants   # Gate A
cargo nextest run                         # Rust Gate B
make python && .venv/bin/pytest python/tests -v  # Python Gate B
```

**Checklist:**
- [ ] Gate A: `cargo test -p arbors --test invariants` passes
- [ ] Rust Gate B: `cargo nextest run` passes
- [ ] Python Gate B: `.venv/bin/pytest python/tests -v` passes
- [ ] Run Python tests 3x to verify no flakiness
- [ ] Commit with message: "Step 10: Python thin layer - remove CloseToken, add thread confinement, Rust-side iteration"

---

## Summary Table

| Sub-Step | Description | Risk | Gate B |
|----------|-------------|------|--------|
| 10.1 | Thread confinement: PyArborStore, Arbor, Tree, Node, iterators | Low | Unchanged |
| 10.2 | Add thread confinement test | Low | Tests only |
| 10.3 | Replace CloseToken with closed flag | **Medium** | Semantics change |
| 10.4 | Add close semantics test | Low | Tests only |
| 10.5 | Delete `begin_write()`, add `write()` | **Medium** | Update tests to new API |
| 10.6 | Add write scope commit-required test | Low | Tests only |
| 10.7 | Add read scope context manager (optional) | Low | Addition only |
| 10.8 | Generalize `PlanBasedIter<S>` for owned/borrowed | Medium | Addition only |
| 10.9 | All iterators delegate to Rust (ArborIterator, DictIterator, SelectedDictIterator) | **Medium** | Correctness fix |
| 10.10 | Verify all gates | Low | Must pass |

---

## Atomic Pairs

These changes must land together:

1. **10.3 + 10.4**: CloseToken removal and semantics test
2. **10.5 + 10.6**: Write scope and commit-required test
3. **10.8 + 10.9**: Rust owned iterator and Python delegation

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing close() semantics | **Medium** | Test coverage; document behavior change |
| Thread affinity breaking async code | Low | Clear error messages; document constraint |
| Deleting `begin_write()` API | Low | Zero external users; update internal tests in 10.5 |
| Existing tests depend on CloseToken | Medium | Update tests as needed in 10.3 |
| Generic iterator behavior mismatch | **Medium** | Test `iter()` vs `iter_owned()` produce same results |
| Python iteration now plan-based | Low | This is a correctness FIX for sorted/shuffled |

---

## Files Modified/Created

### Modified
| File | Changes |
|------|---------|
| `crates/arbors/src/handle.rs` | Generalize `PlanBasedIter<S>` for owned/borrowed, add `iter_owned()`, add type aliases |
| `python/src/lib.rs` | Remove CloseToken, remove StoredBatchCache, delete `begin_write()`/`PyWriteTxn`, add shared `check_thread_affinity()` helper, add `creator_thread` to PyArborStore/Arbor/iterators, add `write()`/`read()` methods, delegate iteration to `OwnedArborIter` |

### Created
| File | Purpose |
|------|---------|
| `python/tests/test_thread_confinement.py` | Thread affinity tests for PyArborStore, Arbor, iterators |
| `python/tests/test_write_scope.py` | Commit-required tests for `write()` |

---

## What Gets Deferred

Nothing. All major work items are addressed in this step:
- CloseToken removal
- Thread confinement (all types: PyArborStore, Arbor, Tree, Node, iterators)
- Rust-side iteration (ArborIterator, DictIterator, SelectedDictIterator)
- Write API cleanup

---

## Exit Criteria

### CloseToken Removal
- [ ] CloseToken struct is deleted
- [ ] `close_token` field removed from Arbor and iterators
- [ ] All `check_closed()` calls removed from Arbor methods
- [ ] PyArborStore has `closed: AtomicBool` flag
- [ ] Existing arbors work after `db.close()` (MVCC semantics)
- [ ] `close()` is idempotent (multiple calls are fine)

### Thread Confinement
- [ ] Thread confinement enforced with shared helper function
- [ ] `creator_thread` field on PyArborStore, Arbor, Tree, Node, and all iterators
- [ ] Thread checks in PyArborStore methods, Arbor methods, Tree methods, Node methods, iterator `__next__`
- [ ] `#[pyclass(unsendable)]` on Arbor, Tree, Node, and all iterator classes

### Write API
- [ ] `begin_write()` and `PyWriteTxn` deleted entirely
- [ ] `write()` context manager requires explicit `commit()`
- [ ] `put()` accepts any Arbor and materializes in Rust
- [ ] Existing tests updated to use `db.write()` with `commit()`

### Read API
- [ ] ReadScope context manager available (optional, not required)
- [ ] `with arbors.open(...) as db:` calls `close()` on exit

### Rust-Side Iteration (Thin Layer)
- [ ] **StoredBatchCache deleted from Python entirely**
- [ ] **`PlanBasedIter<S>` generalized to support owned/borrowed scope**
- [ ] **`iter_owned()` returns `PlanBasedIter<ArborScope>`**
- [ ] **Python ArborIterator wraps `OwnedArborIter` - pure delegation**
- [ ] **Python DictIterator wraps `OwnedArborIter` - fully Rust-driven**
- [ ] **Python SelectedDictIterator wraps `OwnedArborIter` - fully Rust-driven**
- [ ] **Sorted/shuffled iteration produces correct order in Python (all iterator types)**
- [ ] Test coverage for sorted `to_dicts()` and `iterate_dicts()` order

### Tests
- [ ] All Python tests pass
- [ ] Thread confinement tests pass
- [ ] Write scope commit-required tests pass
- [ ] Close semantics tests pass
