# Arbors Architecture Plan: Phase 7 - Arrow Integration

**Goal:** Enable data exchange with Arrow-based ecosystem.

---

## Current State Analysis

### What We Have

**Arrow Already Used Internally:**
- `FinishedPools` uses Arrow arrays for primitive storage (BooleanArray, Int64Array, Float64Array, StringArray, Date32Array, TimestampMicrosecondArray, DurationMicrosecondArray, BinaryArray)
- Null bitmaps handled natively by Arrow
- Temporal types already use Arrow-native representations

**ColumnarNodes (Not Arrow-backed):**
- Four `Vec<u32>` columns: `type_key`, `parents`, `data0`, `data1`
- This is internal structural metadata (parent-child relationships, node types)
- Will remain as-is — does not appear in exported Arrow tables
- Only user data (field values) is exported; tree navigation metadata stays internal

**Current Export Methods:**
- `to_json()` / `to_json_pretty()` — JSON string output
- `to_python()` — Recursive conversion to Python dict/list
- No Arrow/DataFrame export

### Key Insight

The primitive pools are already Arrow arrays. The challenge is:
1. **Schema discovery** — What columns exist across all trees?
2. **Building** — Construct Arrow arrays from tree traversal
3. **Nesting** — Represent nested JSON as Arrow StructArray/ListArray

---

## Design Decisions (Confirmed)

### D1: Primary Use Case — Homogeneous JSONL ✓

Arbors's sweet spot is row-oriented homogeneous JSONL:
- API logs, analytics pipelines, real-world datasets
- All benchmark data follows this pattern
- Assume all trees have the same top-level schema
- Error or warn on schema mismatch

### D2: Nested Structure Handling — Arrow Native Types ✓

Arrow was designed for nested arrays and structs:
- Nested objects → `StructArray`
- Arrays → `ListArray`
- Preserves full JSON structure
- Maps cleanly to Arrow-based tools
- Future-proofs query engine work

Flattening (dot paths) can be a Phase 7.5 feature if needed.

### D3: Python Dependencies — PyArrow Only ✓

- Only require `pyarrow` as dependency
- Return native `pyarrow.Table` from `to_arrow()`
- Users can convert to other tools themselves via Arrow
- Keeps wheels lightweight

### D4: Rust Dependencies — Arrow Only ✓

- Return `RecordBatch` from Rust API
- Other tools consume Arrow output, not a core dependency

### D5: Direction — Export Only ✓

- Phase 7: Arbor → Arrow (export)
- Phase 8+: Arrow → Arbor (import, after query engine)

### D6: Parquet Support — Python Convenience Wrapper ✓

Once Arrow export exists, Parquet is nearly free via PyArrow:

```python
# Users can already do this:
import pyarrow.parquet as pq
pq.write_table(arbor.to_arrow(), "out.parquet")

# We provide convenience wrapper:
arbor.to_parquet("out.parquet")
```

- No Rust-native Parquet I/O in Phase 7
- Parquet import belongs in Phase 8+ (after query engine)

---

## Type Mapping

| Arbors Type | Arrow Type | Notes |
|--------------|------------|-------|
| Null | Null | Explicit null values |
| Bool | Boolean | |
| Int64 | Int64 | |
| Float64 | Float64 | |
| String | Utf8 | |
| Date | Date32 | Days since Unix epoch |
| DateTime | Timestamp(Microsecond, UTC) | |
| Duration | Duration(Microsecond) | |
| Binary | Binary | |
| Array | List<T> | Homogeneous item type |
| Object | Struct | Field names from keys |

**Large Type Variants:** Arrow has `LargeUtf8`, `LargeBinary`, and `LargeList` for data exceeding 2^31 elements/bytes. Use standard (non-large) types unless limits are hit. This keeps compatibility high with downstream consumers.

---

## Implementation Plan

### 7.1 Schema Discovery ✓

Analyze arbor to determine Arrow schema from tree structure.

**Tasks:**
- [x] Create `ArrowSchema` builder that walks tree structure
- [x] Sample first tree (or configurable N trees) to discover fields
- [x] Build Arrow `Schema` with appropriate field types
- [x] Handle nullable fields (fields missing in some trees)
- [x] Detect type conflicts and report clear errors

**Key Functions:**
```rust
/// Discover Arrow schema from arbor structure
pub fn discover_schema(arbor: &Arbor) -> Result<arrow::datatypes::Schema>;

/// Discover schema from a single tree (for homogeneous assumption)
fn schema_from_tree(arbor: &Arbor, root: NodeId) -> Result<arrow::datatypes::Schema>;
```

**Edge Cases:**
- Empty arbor → empty schema
- All-null field → Null type or skip
- Mixed types in same field → error (heterogeneity)

**Future Work (Not Phase 7):** Type coercion for compatible mixed types:
- int + float → float
- string + null → nullable string
- object + null → nullable struct
- list + null → nullable list

Arrow allows this, but Phase 7 errors on mismatch for simplicity.

### 7.2 Arrow Export Core (Rust) ✓

Build RecordBatch from Arbor data.

**Tasks:**
- [x] Create `ArrowExporter` struct
- [x] Implement primitive column building (leverage existing FinishedPools)
- [x] Implement `StructArray` building for nested objects
- [x] Implement `ListArray` building for JSON arrays
- [x] Handle null propagation correctly
- [x] Add `to_record_batch(&self) -> Result<RecordBatch>` convenience function

**Architecture:**
```rust
pub struct ArrowExporter<'a> {
    arbor: &'a Arbor,
    schema: Schema,
}

impl<'a> ArrowExporter<'a> {
    pub fn new(arbor: &'a Arbor) -> Result<Self>;
    pub fn with_schema(arbor: &'a Arbor, schema: Schema) -> Self;
    pub fn schema(&self) -> &Schema;
    pub fn export(&self) -> Result<RecordBatch>;

    // Internal builders
    fn build_column(&self, field: &Field, root_ids: &[NodeId]) -> Result<ArrayRef>;
    fn build_array(&self, data_type: &DataType, nodes: &[Option<NodeId>]) -> Result<ArrayRef>;
    // ... primitive builders for each type
    fn build_struct_array(&self, fields: &Fields, nodes: &[Option<NodeId>]) -> Result<ArrayRef>;
    fn build_list_array(&self, item_field: &Arc<Field>, nodes: &[Option<NodeId>]) -> Result<ArrayRef>;
}
```

**Crate Location:** Added to `arbors-arrow` crate (37 tests passing).

### 7.3 Python Bindings ✓

Expose Arrow export to Python via PyO3.

**Tasks:**
- [x] Add `pyarrow` to Python dependencies
- [x] Implement `Arbor.to_arrow()` returning `pyarrow.Table`
- [x] Use PyO3's arrow interop (via `arrow` crate's `pyarrow` feature with `ToPyArrow` trait)
- [x] Implement `Arbor.to_parquet(path)` convenience wrapper
- [x] Add `Tree.to_arrow()` for single-tree export (returns single-row table)

**Python API:**
```python
import arbors as aq

# Read JSONL
arbor = aq.read_jsonl(data)

# Export to Arrow
table = arbor.to_arrow()  # Returns pyarrow.Table

# Export to Parquet (convenience)
arbor.to_parquet("output.parquet")

# Use with Arrow-based tools (e.g., via pyarrow.Table)

# Single tree export
tree = arbor[0]
single_row_table = tree.to_arrow()
```

**Implementation Notes:**
- Use `arrow::ffi` for zero-copy transfer to Python
- Arrow FFI ensures zero-copy data transfer from Rust → PyArrow (no serialization overhead)
- This makes Arbors → PyArrow → Polars extremely efficient
- PyArrow must be importable at runtime
- `to_parquet()` is pure Python wrapper around `to_arrow()` + `pyarrow.parquet`

### 7.4 Testing ✓

**Unit Tests (Rust):**
- [x] Schema discovery from simple objects
- [x] Schema discovery from nested objects
- [x] Schema discovery from arrays
- [x] Type mapping for each Arbors type
- [x] Null handling in columns
- [x] Error on heterogeneous types

**Integration Tests (Rust):**
- [x] Export testdata fixtures to RecordBatch
- [x] Verify column counts and types
- [x] Round-trip: JSON → Arbor → Arrow → verify values

**Python Tests:**
- [x] `to_arrow()` returns valid PyArrow Table
- [x] Column names match JSON keys
- [x] Nested structs accessible via PyArrow
- [x] List columns work correctly
- [x] `to_parquet()` creates valid Parquet file
- [x] Parquet round-trip via PyArrow
- [x] Integration with Polars: `pl.from_arrow(arbor.to_arrow())`

**Performance Tests:**
- [x] Benchmark: 100K row JSONL → Arrow (target: < 1 second)
- [x] Memory usage during export
- [ ] Compare with direct PyArrow JSON reader

### 7.5 Documentation ✓

- [x] Update `docs/ARCHITECTURE.md` with Arrow export section
- [x] Add Python usage examples to README or examples/
- [x] Document type mapping table
- [x] Add docstrings to all new Python methods (type stubs updated)

---

## Dependencies

**Rust (already in workspace):**
- `arrow` = "54"
- `arrow-array` = "54"
- `arrow-buffer` = "54"
- `arrow-schema` = "54"

**Rust (may need to add):**
- `arrow-cast` = "54" (for type coercion if needed)

**Python (pyproject.toml):**
```toml
[project]
dependencies = [
    "pyarrow >= 14.0",
]
```

**PyO3 Arrow Interop:**
- Option A: Use `arrow::ffi` module for C Data Interface
- Option B: Use `pyo3-arrow` crate (if mature enough)
- Evaluate both; prefer `arrow::ffi` if sufficient

---

## Success Criteria

1. **`arbor.to_arrow()`** returns PyArrow Table in Python
2. **`arbor.to_parquet(path)`** writes valid Parquet file
3. **Type fidelity** — All Arbors types map correctly to Arrow
4. **Nested structures** work: `pl.from_arrow(arbor.to_arrow())` succeeds
5. **Performance** — Export 100K rows in < 1 second
6. **All tests pass** — 560+ Rust tests, 435+ Python tests, new Arrow tests

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Heterogeneous trees cause schema conflicts | Error on mismatch with clear message |
| Large nested structures blow up memory | Document limits; consider streaming later |
| PyArrow version compatibility | Pin minimum version (14.0); test in CI |
| PyO3 ↔ Arrow FFI complexity | Use established patterns from arrow-rs |
| Complex union types | Defer to Phase 8+ (not common in JSONL) |

---

## Implementation Order

1. **7.1 Schema Discovery** — Foundation for everything else
2. **7.2 Primitive Export** — Leverage existing FinishedPools
3. **7.2 Nested Export** — StructArray and ListArray
4. **7.3 Python Bindings** — `to_arrow()` with FFI
5. **7.3 Parquet Wrapper** — Simple Python convenience
6. **7.4 Testing** — Comprehensive coverage
7. **7.5 Documentation** — Update docs

---

## Future Extensions (Not Phase 7)

| Feature | Phase | Notes |
|---------|-------|-------|
| Arrow → Arbor import | 8+ | After query engine |
| Parquet read | 8+ | Via Arrow import |
| Streaming export | 8+ | For very large arbors |
| IPC (Arrow Flight) | 9+ | Network streaming |
| `to_pandas()` | 7.5 | Trivial via PyArrow |
| Flatten option | 7.5 | Dot notation columns |

---

## Appendix: PyO3 Arrow FFI Pattern

Example pattern for returning Arrow arrays to Python:

```rust
use arrow::ffi_stream::ArrowArrayStreamReader;
use pyo3::prelude::*;

#[pyfunction]
fn to_arrow(py: Python, arbor: &PyArbor) -> PyResult<PyObject> {
    // Build RecordBatch in Rust
    let batch = arbor.inner.to_record_batch()?;

    // Convert to PyArrow via FFI
    // (Exact API depends on pyo3-arrow or manual FFI)
    let pyarrow = py.import("pyarrow")?;
    // ... FFI bridge code ...
}
```

This will be refined during implementation based on available tooling.
