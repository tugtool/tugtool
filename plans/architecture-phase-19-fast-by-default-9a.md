# Phase 9a Implementation Plan: Session Unification + CloseToken

## Goal
Delete Python `SessionState`, make Python `ArborStore` hold `Arc<arbors::Session>`, and enforce close semantics via `CloseToken`.

## Key Behavior Change
**Current**: After `base.close()`, derived Stored arbors can still work with cached data.
**After 9a**: After `base.close()`, ALL access to derived arbors errors immediately (via CloseToken).

---

## Files to Modify

| File | Changes |
|------|---------|
| `python/src/lib.rs` | Main implementation - all changes below |

---

## Implementation Steps

### Step 1: Add CloseToken struct (after line ~1605)

```rust
/// Token shared between ArborStore and derived Arbors to enforce close semantics.
/// When ArborStore.close() is called, ALL derived arbors become invalid.
#[derive(Clone)]
pub struct CloseToken(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl CloseToken {
    fn new() -> Self {
        Self(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)))
    }

    fn close(&self) {
        self.0.store(true, std::sync::atomic::Ordering::Release);
    }

    fn is_closed(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::Acquire)
    }

    fn check(&self) -> PyResult<()> {
        if self.is_closed() {
            Err(PyRuntimeError::new_err("ArborStore has been closed"))
        } else {
            Ok(())
        }
    }
}
```

### Step 2: Delete SessionState (lines 1608-1679)

Remove the entire `SessionState` struct and its impl block.

### Step 3: Update ArborBacking::Stored (lines 1752-1759)

Change `session: Arc<SessionState>` to `session: Arc<arbors::Session>`:

```rust
Stored {
    /// Reference to the shared Rust session.
    session: std::sync::Arc<arbors::Session>,
    /// Name of the arbor in the database.
    name: String,
    /// Metadata for the stored arbor.
    meta: arbors_base::ArborMeta,
},
```

### Step 4: Add close_token to Arbor struct (line ~1776)

```rust
#[pyclass(name = "Arbor")]
pub struct Arbor {
    backing: ArborBacking,
    schema: Option<Py<Schema>>,
    /// Close token from ArborStore (None for InMemory arbors not from base).
    close_token: Option<CloseToken>,
}
```

### Step 5: Add helper method to Arbor

```rust
impl Arbor {
    /// Check if the arbor's close token indicates closure.
    fn check_closed(&self) -> PyResult<()> {
        if let Some(token) = &self.close_token {
            token.check()
        } else {
            Ok(())
        }
    }
}
```

### Step 6: Update PyArborStore struct (line ~14467)

```rust
#[pyclass(name = "ArborStore")]
pub struct PyArborStore {
    /// Shared Rust session for lazy access.
    session: std::sync::Arc<arbors::Session>,
    /// Close token shared with derived arbors.
    close_token: CloseToken,
}
```

### Step 7: Update PyArborStore::open() (line ~14497)

```rust
#[staticmethod]
#[pyo3(signature = (path, options=None))]
fn open(path: &str, options: Option<&PyArborStoreOptions>) -> PyResult<Self> {
    let opts = match options {
        Some(py_opts) => {
            let rust_opts = py_opts.to_rust();
            rust_opts.validate().map_err(arborbase_error_to_py_err)?;
            rust_opts
        }
        None => arbors_base::ArborStoreOptions::default(),
    };
    let session = arbors::Session::open_with_options(path, opts)
        .map_err(arborbase_error_to_py_err)?;
    Ok(PyArborStore {
        session: std::sync::Arc::new(session),
        close_token: CloseToken::new(),
    })
}
```

### Step 8: Update PyArborStore::__getitem__() (line ~14777)

```rust
fn __getitem__(&self, py: Python<'_>, name: &str) -> PyResult<Py<Arbor>> {
    self.close_token.check()?;

    // Get metadata using session.arbor() pattern
    let meta = self.session
        .with_snapshot(|txn| {
            if let Some(batched) = txn.get_batched(name)? {
                Ok(batched.meta().clone())
            } else {
                Err(arbors_base::ArborStoreError::NotFound(name.to_string()))
            }
        })
        .map_err(|e| {
            if matches!(e, arbors_base::ArborStoreError::NotFound(_)) {
                PyKeyError::new_err(name.to_string())
            } else {
                arborbase_error_to_py_err(e)
            }
        })?;

    let py_arbor = Arbor {
        backing: ArborBacking::Stored {
            session: self.session.clone(),
            name: name.to_string(),
            meta,
        },
        schema: None,
        close_token: Some(self.close_token.clone()),
    };

    Py::new(py, py_arbor)
}
```

### Step 9: Update PyArborStore methods that use session

Update these methods to use `self.session` (Arc<arbors::Session>) instead of `self.session.base`:

- `list()`: Use `self.session.base().begin_read()` or `self.session.with_snapshot()`
- `get()`: Similar pattern
- `put()`: Use `self.session.base().begin_write()`
- `put_many()`: Similar
- `delete()`: Similar
- `contains()`: Similar
- `refresh()`: Use `self.session.refresh()`
- `close()`: Call `self.close_token.close()` (NOT `self.session.close()` - Rust Session doesn't have close)
- `__len__()`: Use session.base().begin_read()
- `__repr__()`: Check close_token instead of session.is_closed()
- `is_closed()` property: Return `self.close_token.is_closed()`

### Step 10: Update PyArborStore::__exit__() (line ~14850)

**Behavior change**: Current `__exit__` is a no-op. New behavior calls `close()`.

```rust
#[pyo3(signature = (_exc_type=None, _exc_val=None, _exc_tb=None))]
fn __exit__(
    &self,
    _exc_type: Option<&Bound<'_, PyAny>>,
    _exc_val: Option<&Bound<'_, PyAny>>,
    _exc_tb: Option<&Bound<'_, PyAny>>,
) -> bool {
    self.close_token.close();
    false
}
```

Also update the docstring for `close()` (line ~14830):
```rust
/// Close the ArborStore and invalidate ALL derived arbors.
///
/// After closing:
/// - This ArborStore handle cannot be used for new operations
/// - ALL previously derived Stored/Filtered arbors become invalid
/// - In-progress iterators will fail on next()
///
/// This is "resource manager semantics" - closing the base closes everything.
fn close(&self) {
    self.close_token.close();
}
```

### Step 11: Update validate_not_stale() (line ~1936)

Change `session.with_snapshot()` calls to work with `arbors::Session`:

```rust
fn validate_not_stale(backing: &ArborBacking) -> PyResult<()> {
    match backing {
        ArborBacking::InMemory(_) => Ok(()),
        ArborBacking::Stored { session, name, meta, .. } => {
            let current = session
                .with_snapshot(|txn| txn.get_meta(name))
                .map_err(arborbase_error_to_py_err)?
                .map(|m| m.generation);

            if current != Some(meta.generation) {
                return Err(PyRuntimeError::new_err(format!(
                    "Stored arbor '{}' was updated (expected gen {}, current {:?})",
                    name, meta.generation, current
                )));
            }
            Ok(())
        }
        // ... Filtered case similar
    }
}
```

### Step 12: Update all Arbor methods to check close_token

Add `self.check_closed()?;` at the start of:
- `len_py()` / `__len__`
- `__getitem__`
- `__iter__`
- `filter()`
- `matching_indices()`
- `find_one()` / `find_one_or_error()`
- `head()` / `tail()`
- `pick()`
- `materialize_if_stored()`
- All other public methods that access backing

### Step 13: Propagate close_token in filter/head/tail/etc.

When creating new Arbor from view operations, inherit close_token:

```rust
fn filter(...) -> PyResult<Py<Arbor>> {
    self.check_closed()?;
    // ... compute indices ...
    Py::new(py, Arbor {
        backing: ArborBacking::Filtered { ... },
        schema: self.schema.clone(),
        close_token: self.close_token.clone(),  // Inherit token
    })
}
```

### Step 14: Update all iterators to check close_token

Add close_token field to iterator structs and check on each `__next__`:

```rust
#[pyclass(name = "ArborIterator")]
pub struct ArborIterator {
    arbor: Py<Arbor>,
    index: usize,
    close_token: Option<CloseToken>,  // Add this
}

fn __next__(...) -> PyResult<Option<Tree>> {
    if let Some(token) = &slf.close_token {
        token.check()?;  // Check on EACH next
    }
    // ... rest of iteration
}
```

Update these iterators:
- `ArborIterator` (line 4687)
- `DictIterator` (line 4788)
- `SelectedDictIterator` (line ~4920)

### Step 15: Update all functions using SessionState

Search for all occurrences of `SessionState` and update to use `arbors::Session`:

- `compute_indices_for_backing()` - uses `session.with_snapshot()`
- `materialize_backing()` - uses `session.with_snapshot()`
- `filter_at_indices()` - uses `session.with_snapshot()`
- `dict_from_backing()` - uses `session.with_snapshot()`
- `selected_dict_from_backing()` - uses `session.with_snapshot()`
- All other helpers

---

## Verification

### Compile Check
```bash
cargo build -p arbors-python
```

### Test Suite
```bash
make python-test
```

### Python Tests to Update

**Existing tests that pass** (behavior unchanged):
- `test_close_prevents_further_access` (test_unified_arbor.py:236) - tests `base["name"]` fails after close

**Existing tests that may need update** (behavior change):
- Check if any tests assume derived arbors work after close

**New tests to add** (`python/tests/test_unified_arbor.py`):

```python
def test_close_invalidates_derived_arbors():
    """Access after base.close() errors for previously derived Stored arbor."""
    with tempfile.TemporaryDirectory() as tmp:
        base = ArborStore.open(f"{tmp}/test.arbors")
        base.put("data", arbors.read_jsonl(b'{"x":1}'))
        stored = base["data"]
        _ = len(stored)  # Should work BEFORE close

        base.close()

        # After close, access should fail
        with pytest.raises(RuntimeError, match="closed"):
            _ = len(stored)

def test_context_manager_invalidates_derived_arbors():
    """Context manager exit closes base and invalidates derived arbors."""
    with tempfile.TemporaryDirectory() as tmp:
        with ArborStore.open(f"{tmp}/test.arbors") as base:
            base.put("data", arbors.read_jsonl(b'{"x":1}'))
            stored = base["data"]
            _ = len(stored)  # Should work inside context

        # After context exit (close), access should fail
        with pytest.raises(RuntimeError, match="closed"):
            _ = len(stored)

def test_close_invalidates_iterators():
    """Iterator fails after base.close()."""
    with tempfile.TemporaryDirectory() as tmp:
        base = ArborStore.open(f"{tmp}/test.arbors")
        base.put("data", arbors.read_jsonl(b'{"x":1}\n{"x":2}'))
        stored = base["data"]
        it = iter(stored.pick())
        next(it)  # First item works

        base.close()

        # After close, next should fail
        with pytest.raises(RuntimeError, match="closed"):
            next(it)

def test_close_invalidates_filtered_arbors():
    """Filtered views fail after base.close()."""
    with tempfile.TemporaryDirectory() as tmp:
        base = ArborStore.open(f"{tmp}/test.arbors")
        base.put("data", arbors.read_jsonl(b'{"x":1}\n{"x":2}'))
        stored = base["data"]
        filtered = stored.filter(path("x") > 0)
        _ = len(filtered)  # Works before close

        base.close()

        with pytest.raises(RuntimeError, match="closed"):
            _ = len(filtered)
```

---

### Step 16: Update try_to_rust_arbor / try_to_rust_backing (lines 2316-2390)

After Phase 9a, `ArborBacking::Stored` uses `Arc<arbors::Session>` which matches `RustArborBacking::Stored`. These functions can now handle Stored backings:

```rust
fn try_to_rust_arbor(backing: &ArborBacking) -> Option<RustArbor> {
    match backing {
        ArborBacking::InMemory(arbor) => {
            Some(RustArbor::from_inmemory(arbor.clone()))
        }
        ArborBacking::Stored { session, name, meta } => {
            // NOW WORKS: Both use Arc<arbors::Session>
            Some(RustArbor::from_stored(session.clone(), name.clone(), meta.clone()))
        }
        // Filtered case unchanged...
    }
}
```

**Note**: Full delegation (making these the primary path) is Phase 9b work. In Phase 9a, these helpers should work for Stored but existing code paths remain.

### Step 17: Update Rust unit tests (lines 15073-15324)

The SessionState tests must be updated to test CloseToken + Session:

**Delete tests** (SessionState-specific):
- `test_session_state_creation` (line 15077)
- `test_session_state_ensure_snapshot` (line 15088)
- `test_session_state_with_snapshot` (line 15103)
- `test_session_state_closed_prevents_access` (line 15115)
- `test_session_state_arc_sharing` (line 15132)

**Update tests** (replace SessionState with Session):
- `test_arbor_backing_stored_variant` (line 15168)
- `test_stored_backing_tree_count` (line 15209)
- All other tests using `Arc<SessionState>` → `Arc<arbors::Session>`

**Add new tests**:
- `test_close_token_creation`
- `test_close_token_close`
- `test_close_token_check`
- `test_close_token_shared_state`

---

## Additional Notes

### Functions with "SessionState vs Session" Comments

These functions currently return `None` for Stored because of type mismatch. After Phase 9a they can handle Stored:
- `try_to_rust_arbor()` (line 2316)
- `try_to_rust_backing()` (line 2358)
- `from_rust_backing()` (line 2395)

### Order of Changes

Recommended order to minimize compile errors:
1. Add CloseToken (no existing code uses it yet)
2. Add close_token field to Arbor (with default None)
3. Update ArborBacking::Stored to use Arc<arbors::Session>
4. Update PyArborStore to use Arc<arbors::Session> + CloseToken
5. Delete SessionState
6. Update all session.* calls to use new types
7. Add close_token checks throughout
8. Update tests

---

## Success Criteria

1. `SessionState` is deleted; PyArborStore uses `Arc<arbors::Session>`
2. `close_token` propagates from base to all derived arbors
3. `close()` / `__exit__()` flips token
4. All derived arbor access fails after close
5. All existing tests pass
6. New close semantics tests pass
7. `try_to_rust_arbor()` can now handle Stored backings (enables Phase 9b)
