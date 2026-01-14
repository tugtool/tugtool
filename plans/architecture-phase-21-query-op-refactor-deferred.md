## Operation Centralization Refactor

### Current Pain Points

Adding a new operation currently requires changes in **5-6 different locations**:

| Location | What's Added | Lines of Code |
|----------|--------------|---------------|
| `arbors-planner/src/query_plan.rs` | Enum variant + 6 match arms | ~40-60 |
| `arbors-planner/src/physical.rs` | Execution match arm | ~30-50 |
| `arbors/src/handle.rs` | Handle method | ~15-30 |
| `arbors/src/lazy.rs` | ArborQuery builder method | ~10-15 |
| `python/src/lib.rs` | Python binding with boilerplate | ~25-40 |
| Tests (various) | Integration tests | ~30-50 |

Each location has:
- Different conventions
- Duplicate documentation
- Error handling patterns that must be replicated
- No clear "recipe" to follow

### Proposed Solution: Modular Op Organization + Helper Patterns

Rather than complex macros (which have debugging/IDE issues), we'll:

1. **Organize ops by category** - Group related operations in modules
2. **Create helper patterns** - Reduce Python binding boilerplate
3. **Document a clear recipe** - Checklist for adding new ops
4. **Standardize patterns** - Consistent structure across all ops

### Step 1: Create Op Category Modules (Rust)

**New directory structure:**

```
crates/arbors/src/
├── handle.rs           # Core Arbor struct + common methods
├── ops/                # NEW: Operation implementations
│   ├── mod.rs          # Re-exports
│   ├── view.rs         # filter, head, tail, take, sample, shuffle
│   ├── transform.rs    # select, add_field, add_fields
│   ├── aggregate.rs    # aggregate, group_by, index_by, unique_by
│   ├── mutation.rs     # NEW: append, concat, remove, set, insert, extend
│   └── sort.rs         # sort_by
```

**Pattern: Each op file contains the handle method implementations:**

```rust
// crates/arbors/src/ops/view.rs
use super::*;

impl Arbor {
    /// Filter trees matching a predicate.
    ///
    /// Returns a new Arbor representing a filtered view.
    pub fn filter(&self, predicate: &Expr, mode: FilterMode) -> Result<Self, PipelineError> {
        // implementation
    }

    /// Get the first N trees as a new arbor view.
    pub fn head(&self, n: usize) -> Result<Self, PipelineError> {
        // implementation
    }

    // ... etc
}
```

**Benefits:**
- Related ops are co-located
- Each file is focused and readable
- Easy to find where to add new ops of a given category
- `handle.rs` stays clean (core struct, constructors, common utilities)

### Step 2: Create Python Binding Helpers

**File:** `python/src/arbor_ops.rs` (new)

Create helper macros/functions to reduce Python binding boilerplate:

```rust
/// Helper to wrap Rust Arbor method calls with standard error handling
macro_rules! arbor_method {
    ($self:expr, $py:expr, $method:ident $(, $arg:expr)*) => {{
        $self.check_thread_affinity()?;
        let result = $self.inner.$method($($arg),*)
            .map_err(pipeline_error_to_py_err)?;
        Py::new($py, Arbor {
            inner: result,
            schema: None,  // TODO: derive schema if possible
            creator_thread: std::thread::current().id(),
        })
    }};
}

// Usage in #[pymethods]:
fn head(&self, py: Python<'_>, n: usize) -> PyResult<Py<Arbor>> {
    arbor_method!(self, py, head, n)
}
```

**Organize Python ops by category:**

```
python/src/
├── lib.rs              # Main entry, type definitions
├── arbor.rs            # Core Arbor class structure
├── arbor_ops/          # NEW: Method implementations
│   ├── mod.rs
│   ├── view.rs         # filter, head, tail, etc.
│   ├── transform.rs    # select, add_field, etc.
│   ├── mutation.rs     # NEW: append, concat, remove, etc.
│   └── aggregate.rs    # aggregate, group_by, etc.
```

### Step 3: Standardize QueryPlan Pattern

**For mutation ops, add a new category in QueryPlan:**

```rust
// In query_plan.rs

// ========================================================================
// Mutation transforms (materialize to new InMemoryArbor)
// ========================================================================

/// Append trees from another source.
Append {
    /// The base arbor.
    source: Arc<QueryPlan>,
    /// Trees to append (wrapped in a plan).
    addition: Arc<QueryPlan>,
},

/// Concatenate two arbors.
Concat {
    /// First arbor.
    left: Arc<QueryPlan>,
    /// Second arbor.
    right: Arc<QueryPlan>,
},

/// Remove trees at specified indices.
Remove {
    /// The source plan.
    source: Arc<QueryPlan>,
    /// Indices to remove (must be sorted, unique).
    indices: Vec<usize>,
},

/// Set (replace) tree at index.
Set {
    /// The source plan.
    source: Arc<QueryPlan>,
    /// Index to replace.
    index: usize,
    /// Replacement tree (wrapped in a plan).
    tree: Arc<QueryPlan>,
},

/// Insert tree at index, shifting subsequent trees.
Insert {
    /// The source plan.
    source: Arc<QueryPlan>,
    /// Index to insert at.
    index: usize,
    /// Tree to insert (wrapped in a plan).
    tree: Arc<QueryPlan>,
},
```

### Step 4: Document the Op Addition Recipe

**Create:** `docs/ADDING_OPERATIONS.md`

```markdown
# Adding a New Arbor Operation

This guide walks through adding a new operation to Arbors.

## Quick Checklist

- [ ] 1. Add QueryPlan variant (`crates/arbors-planner/src/query_plan.rs`)
- [ ] 2. Add plan builder method (`impl QueryPlan`)
- [ ] 3. Add physical execution (`crates/arbors-planner/src/physical.rs`)
- [ ] 4. Add Arbor handle method (`crates/arbors/src/ops/<category>.rs`)
- [ ] 5. Add Python binding (`python/src/arbor_ops/<category>.rs`)
- [ ] 6. Add tests (Rust integration + Python)
- [ ] 7. Update documentation

## Step-by-Step Details

### 1. QueryPlan Variant

Location: `crates/arbors-planner/src/query_plan.rs`

Add your variant to the appropriate category section:
- **View transforms**: Operations that filter/limit trees without changing content
- **Projection transforms**: Operations that transform tree content
- **Mutation transforms**: Operations that add/remove/replace trees

[... detailed instructions for each step ...]
```

