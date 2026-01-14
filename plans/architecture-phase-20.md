# Phase 20: Immutable Arbor Semantics Plan

## Summary

Formalize "Arbors are immutable" semantics at the **handle level** (`Arbor` in Rust/Python). Make `select()`/`add_field()` lazy with mode parameter. Derive schema for transforms. Expose `ArborBuilder` to Python.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Immutability scope | Handle only (`Arbor`); `InMemoryArbor`/`Tree` retain COW mutation |
| select/add_field behavior | Lazy by default with `mode` parameter (like `filter()`) |
| Schema for transforms | **Derive schema** from input schema + expressions |
| ArborBuilder `add_dict` | Use `ExprResult` conversion (NOT JSON round-trip) |
| txn.commit() return | Fresh `Snapshot` with `.arbor(name)` to get immutable views |
| commit() + session cache | Does **NOT** update session cache; document explicitly |

---

## Step 1: Documentation Updates

### 1.1 CLAUDE.md - Add "Immutable Semantics" Section

Add after "Key Concepts":

## Immutable Semantics

**`Arbor` handles are immutable** - all query operations return new Arbors:

- `filter()`, `select()`, `head()`, `sort_by()`, etc. return NEW Arbors
- The original Arbor is never modified
- Multiple handles can share underlying data safely (via Arc)

**Note:** This applies to the `Arbor` handle API. Internal types like `InMemoryArbor`
have COW (copy-on-write) mutation capabilities for advanced use cases.

**Idiomatic patterns:**

```python
# Pipeline style
result = (
    db["users"]
    .filter(path("active") == True)
    .sort_by(path("created_at"))
    .head(100)
)

# Named intermediates (all distinct arbors)
all_users = db["users"]
active_users = all_users.filter(path("active") == True)
recent_active = active_users.head(100)
```

**For writes, use transaction context:**

```python
with db.transaction() as txn:
    txn.put("users", new_arbor)
    snapshot = txn.commit()  # Returns fresh Snapshot

users = snapshot.arbor("users")  # Immutable view
```

**Note:** `commit()` returns a fresh `Snapshot` but does NOT update the session's
cached snapshot. Use `db.refresh()` if you want `db["name"]` to see new data.

### 1.2 Rust Module Docs

**File:** `crates/arbors/src/handle.rs`

Add module-level doc explaining:
- Handle-level immutability (not storage-level)
- `Arc` sharing model
- MVCC snapshot isolation for scoped arbors
- COW mutation exists internally but not exposed through handle API

### 1.3 Python Docstrings

**File:** `python/src/lib.rs` - `Arbor` class

Add explicit immutability statement with examples.

---

## Step 2: Lazy select/add_field with Mode Parameter

Make `select()`, `add_field()`, and `add_fields()` lazy by default, with mode parameter for eager materialization.

### 2.1 Rust API Changes

**File:** `crates/arbors/src/handle.rs`

Current signatures:
```rust
pub fn select(&self, exprs: &[Expr]) -> Result<InMemoryArbor, PipelineError>
pub fn add_field(&self, name: &str, expr: &Expr) -> Result<InMemoryArbor, PipelineError>
pub fn add_fields(&self, fields: &[(&str, &Expr)]) -> Result<InMemoryArbor, PipelineError>
```

New signatures (following `filter()` pattern):
```rust
pub fn select(&self, exprs: &[Expr], mode: SelectMode) -> Result<Self, PipelineError>
pub fn add_field(&self, name: &str, expr: &Expr, mode: SelectMode) -> Result<Self, PipelineError>
pub fn add_fields(&self, fields: &[(&str, &Expr)], mode: SelectMode) -> Result<Self, PipelineError>
```

Where `SelectMode` is:
```rust
pub enum SelectMode {
    Lazy,   // Build plan node, materialize on iteration (default)
    Eager,  // Execute and materialize immediately
}
```

### 2.2 Implementation Strategy

**Lazy mode:**
```rust
// Build plan node without executing (like filter() does)
// NO validation/execution at call time - errors defer to iteration
let new_plan = self.plan.select(exprs.to_vec());
Ok(self.with_plan(new_plan))
```

**Eager mode:**
```rust
// Current behavior: execute + materialize immediately
let select_plan = self.plan.select(exprs.to_vec());
let txn = self.binding.as_scope().map(|scope| scope.txn());
let result = execute_query_plan(&select_plan, txn)?;
let arbor = materialize_result(&select_plan, txn, &result)?;
Ok(Self::from_inmemory(Arc::try_unwrap(arbor).unwrap_or_else(|arc| (*arc).clone())))
```

### 2.3 Lazy Error Timing

**Critical:** In lazy mode, errors must defer to iteration/materialization:
- No eager validation at call time
- Expression normalization OK if it doesn't fail
- Tests must verify: "errors happen on iteration, not at call time"

### 2.4 Python API Changes

**File:** `python/src/lib.rs`

Update Python bindings to:
1. Accept `mode: str = "lazy"` parameter (or `"eager"`)
2. Return `Arbor` in all cases (not `InMemoryArbor`)
3. Map Python mode string to Rust `SelectMode` enum

```python
def select(self, exprs: List[Expr], mode: str = "lazy") -> Arbor:
    """Select fields from each tree.

    Args:
        exprs: Expressions to select
        mode: "lazy" (default) or "eager"

    Returns:
        New Arbor with selected fields
    """
```

### 2.5 Tests

- Update existing tests that expect `InMemoryArbor` return type
- Add tests for lazy vs eager mode behavior
- Add tests verifying lazy mode defers execution until iteration
- Test error timing: lazy errors on iteration, eager errors immediately

---

## Step 3: Schema Derivation for Transforms (MVP)

Derive output schema from input schema + transform expressions, instead of dropping schema.
**MVP scope**: Only derive when we can prove it; fall back to schemaless otherwise.

### 3.1 Problem

**File:** `crates/arbors-planner/src/physical.rs` (lines 340-365)

Current code hardcodes schemaless:
```rust
let mut builder = ArborBuilder::new_schemaless();  // Schema dropped!
```

This disables schema-dependent optimizer wins (`has_root_field()`, pushdown checks).

### 3.2 Core Rule: Only Derive When You Can Prove It

Return `None` (fall back to schemaless) if ANY of these are true:
- Input schema is `None`
- Input root is not `StorageType::Struct`
- Any output field name cannot be determined statically (no alias, duplicates)
- Any output type is not confidently known

### 3.3 MVP: select() Derivation

**Supported cases (derive):**

| Case | Pattern | Derivation |
|------|---------|------------|
| **S1** | `path("field")` (root field, no wildcards) with alias | Copy input field's `StorageType` |
| **S2** | `path("field").alias("renamed")` | Same as S1, renamed |
| **S3** | `lit(<scalar>)` where scalar is null/bool/int64/float64/string | Scalar type |

**Fall back (return `None`):**

- Wildcard paths: `path("a[*].b")`
- Nested field access: `path("user.name")`
- Object construction: `object([...])`
- Conditionals/coalesce/case/when
- String functions, aggregation, explode
- Any expression where output type would be `Unknown`

### 3.4 MVP: add_fields() Derivation

**Requirements:**
- Input root is `Struct`
- Each `(name, expr)` has literal string name
- Each expr matches S1, S2, or S3

**Implementation:**
1. Start with input root struct fields
2. For each added field:
   - S1/S2: assign input field's type
   - S3: assign literal's type
   - Overwrite if exists, append if new
3. Build new `SchemaRegistry` with new root struct

**Fall back:** If any field expression is outside supported set.

### 3.5 New Module

**File:** `crates/arbors-planner/src/schema_derivation.rs` (new)

```rust
/// Derive output schema for select operation (MVP: pattern matching, not full inference).
pub fn derive_schema_for_select(
    source_schema: Option<&SchemaRegistry>,
    names: &[String],  // Output field names (from TransformSpec)
    exprs: &[Expr],
) -> Option<SchemaRegistry>  // Note: Option, not Result - fallback is OK

/// Derive output schema for add_fields operation.
pub fn derive_schema_for_add_fields(
    source_schema: Option<&SchemaRegistry>,
    names: &[String],  // Field names to add/overwrite
    exprs: &[Expr],
) -> Option<SchemaRegistry>

/// Check if expr is a simple root field passthrough.
fn is_root_field_passthrough(expr: &Expr) -> Option<&str>

/// Check if expr is a scalar literal.
fn is_scalar_literal(expr: &Expr) -> Option<StorageType>

/// Helper to create builder with derived schema (used in both projection sites).
pub fn builder_for_transform(
    source_schema: Option<&SchemaRegistry>,
    transform: &TransformSpec,
) -> ArborBuilder
```

**Implementation note:** Pattern matcher over `Expr`, NOT general schema-aware inference.

**TransformSpec naming:** Accept auto-assigned names (e.g., `"column_1"`), but reject duplicates.

### 3.6 Update physical.rs - Exact Hook Locations

**Three call sites** with `ArborBuilder::new_schemaless()`:

| Site | Location | Action |
|------|----------|--------|
| `materialize_projection()` | line 2680-2686 | Update (projection helper) |
| `materialize_result()` Aggregated | line 2721-2727 | **Skip for MVP** |
| `materialize_result()` Projection | line 2771-2777 | Update (main projection path) |

**Hook the two projection loops** (leave Aggregated schemaless for MVP):

```rust
// Inside: for transform in transforms.iter() { ... }

// Use helper to avoid duplicating logic at both sites
let mut builder = builder_for_transform(current_arbor.schema(), transform);
```

Where `builder_for_transform` encapsulates:
1. Get input schema (cheap - just `Option<&SchemaRegistry>`)
2. Derive based on `transform.mode` (Select vs AddFields)
3. Return `ArborBuilder::new(schema)` or `ArborBuilder::new_schemaless()`

### 3.7 Near-Zero Overhead Strategy

Derivation is O(#transforms) per materialization, not per tree:

- `current_arbor.schema()` is cheap (borrowed reference)
- Derive once per transform iteration
- Next iteration uses `current_arbor.schema()` which reflects derived schema

**Optional optimization** (not MVP): carry `current_schema: Option<SchemaRegistry>` alongside `current_arbor` to avoid re-reading from arbor each iteration.

### 3.8 Tests That Prove Optimizer Wins

| Test | Purpose |
|------|---------|
| **T1** | select passthrough preserves root-field existence |
| **T2** | add_fields literal adds known field |
| **T3** | fallback triggers on wildcard (schema is `None`) |

Example T1:
```rust
// Input: schemaful arbor with "id": int64
let ar2 = ar.select(&[path("id").alias("i")], SelectMode::Lazy)?;
// Materialize to get InMemoryArbor, then check schema
let materialized = ar2.materialize()?;
// Assert: derived schema has root field "i" of type int64
assert!(materialized.has_root_field("i"));
```

### 3.9 What This Buys

- `has_root_field()` checks succeed for passthrough fields
- Type-driven validation/pushdown proceeds for known types
- Optimizer doesn't degrade to "assume nothing" mode

---

## Step 4: Expose ArborBuilder to Python

### 4.1 Rust ArborBuilder Location

**File:** `crates/arbors-io/src/builder.rs`

Existing API:
- `ArborBuilder::new()` or `ArborBuilder::with_schema(registry)`
- `add_json(&[u8])` - add single JSON document
- `add_jsonl(&[u8])` - add JSONL (multiple documents)
- `finish() -> InMemoryArbor`

### 4.2 Python Binding

**File:** `python/src/lib.rs`

Add new class:

```python
class ArborBuilder:
    """Build an Arbor tree-by-tree.

    Example:
        builder = ArborBuilder()
        builder.add_json('{"name": "Alice"}')
        builder.add_json('{"name": "Bob"}')
        arbor = builder.build()
    """

    def __init__(self, schema: Optional[Schema] = None):
        """Create a new builder."""

    def add_json(self, json_str: str) -> None:
        """Add a JSON document as a tree."""

    def add_dict(self, obj: dict) -> None:
        """Add a Python dict/list as a tree.

        Uses ExprResult conversion (no JSON serialization).
        """

    def build(self) -> Arbor:
        """Build the final immutable Arbor."""
```

### 4.3 Implementation: add_dict via ExprResult

**NOT** JSON round-trip. Use existing `pyany_to_expr_result`:

```rust
fn add_dict(&mut self, py: Python<'_>, obj: &PyAny) -> PyResult<()> {
    let expr_result = pyany_to_expr_result(py, obj)?;
    self.inner.add_expr_result(&expr_result)?;
    Ok(())
}
```

This avoids:
- Double work (serialize then parse)
- Semantic drift (MISSING sentinel, float edge cases)

### 4.4 MISSING Sentinel Handling

**Decision: Option A (simple)**

Python `MISSING` becomes JSON null (field present with null value).

**Rationale:**
- `ArborBuilder::add_expr_result` materializes `ExprResult::Missing` as null
- Schemaless mode can't omit a field that was explicitly named
- This matches current behavior; no special handling needed

**Document explicitly:**
```python
# MISSING in dicts becomes null
builder.add_dict({"name": "Alice", "age": MISSING})
# Result: {"name": "Alice", "age": null}
```

### 4.5 Tests

**File:** `python/tests/test_builder.py` (new)

- Build from JSON strings
- Build from Python dicts (verify no JSON round-trip issues)
- Empty builder → empty Arbor
- Schema validation (if schema provided)
- MISSING sentinel handling in dicts

---

## Step 5: Transaction commit() Returns Snapshot

Make writes feel immutable by having `commit()` return a fresh Snapshot.

### 5.1 Current Behavior

**File:** `crates/arbors/src/scope.rs`

```rust
pub struct Transaction<'a> {
    txn: WriteTxn<'a>,  // Only has write transaction
}

pub fn commit(self) -> Result<(), ArborStoreError>
```

### 5.2 Problem: Missing Arc<ArborStore>

`Transaction` currently only holds `WriteTxn<'a>`. To create a `Snapshot` after commit, it needs `Arc<ArborStore>`.

### 5.3 Solution: Store base in Transaction

```rust
pub struct Transaction<'a> {
    txn: WriteTxn<'a>,
    base: Arc<ArborStore>,  // NEW: needed for Snapshot creation
}

impl<'a> Transaction<'a> {
    pub fn new(txn: WriteTxn<'a>, base: Arc<ArborStore>) -> Self {
        Self { txn, base }
    }

    pub fn commit(self) -> Result<Arc<Snapshot>, ArborStoreError> {
        self.txn.commit()?;
        Snapshot::new(self.base)
    }
}
```

### 5.4 Update Session::transaction()

**File:** `crates/arbors/src/session.rs`

```rust
pub fn transaction(&self) -> Result<Transaction<'_>, ArborStoreError> {
    let txn = self.base.begin_write()?;
    Ok(Transaction::new(txn, Arc::clone(&self.base)))  // Pass base
}
```

### 5.5 Session Cache Behavior

**Important:** `commit()` does NOT update session's cached snapshot.

- `db["name"]` / `Session::arbor()` still uses old cached snapshot
- Must call `db.refresh()` to update cache
- Document this explicitly

Rationale: Preserves "stable snapshot until refresh" property.

### 5.6 Python API

**File:** `python/src/lib.rs`

```python
# Transaction.commit() returns Snapshot
def commit(self) -> Snapshot:
    """Commit the transaction.

    Returns:
        Fresh Snapshot with committed data.

    Note:
        Does NOT update the session's cached snapshot.
        Use db.refresh() if you want db["name"] to see new data.
    """
```

### 5.7 Idiomatic Pattern

```python
# Functional feel: writes produce new immutable views
with db.transaction() as txn:
    txn.put("users", updated_users)
    txn.put("orders", new_orders)
    snapshot = txn.commit()

# All access is through immutable Arbor handles
users = snapshot.arbor("users")
orders = snapshot.arbor("orders")

# Old handles from before commit still work (MVCC)
# db["users"] still sees pre-commit data until db.refresh()
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `CLAUDE.md` | Add "Immutable Semantics" section |
| `crates/arbors/src/handle.rs` | Module docs, lazy select/add_field/add_fields |
| `crates/arbors/src/scope.rs` | Transaction holds `Arc<ArborStore>`, commit() returns `Arc<Snapshot>` |
| `crates/arbors/src/session.rs` | Pass base to Transaction |
| `crates/arbors/src/lib.rs` | Export `SelectMode` enum |
| `crates/arbors-planner/src/schema_derivation.rs` | NEW: schema derivation module |
| `crates/arbors-planner/src/physical.rs` | Use derived schema in materialization |
| `crates/arbors-planner/src/lib.rs` | Export schema_derivation |
| `python/src/lib.rs` | Docstrings, mode parameter, ArborBuilder, commit() return |
| `python/tests/test_builder.py` | NEW: ArborBuilder tests |
| Existing tests | Update for new return types and signatures |

---

## Implementation Order

| Order | Step | Description |
|-------|------|-------------|
| 1 | **Step 3** | Schema derivation module (foundation for other steps) |
| 2 | **Step 2.1** | Rust: Add `SelectMode` enum, update signatures |
| 3 | **Step 2.2** | Rust: Implement lazy mode (build plan node, return `Arbor`) |
| 4 | **Step 2.2** | Rust: Implement eager mode (current behavior, wrapped in `Arbor`) |
| 5 | **Step 2.3** | Rust: Verify lazy error timing (errors defer to iteration) |
| 6 | **Step 5.3** | Rust: Update `Transaction` to hold `Arc<ArborStore>` |
| 7 | **Step 5.3** | Rust: Update `commit()` to return `Arc<Snapshot>` |
| 8 | **Step 2.4** | Python: Update bindings for mode parameter, `Arbor` return |
| 9 | **Step 5.6** | Python: Update `Transaction.commit()` to return `Snapshot` |
| 10 | **Step 4** | Python: Add `ArborBuilder` class with ExprResult-based `add_dict` |
| 11 | **Step 1** | Documentation updates (CLAUDE.md, module docs, docstrings) |
| 12 | All | Tests - update existing, add new (per step)

---

## Non-Goals

- No `is_view` property
- No changes to `InMemoryArbor`/`Tree` COW semantics
- No runtime "freeze" checks
- commit() does NOT update session cache (by design)
