## Phase 17: API and Usability Enhancements

### 17.1 Unified ArborView Trait

**Purpose:** Reduce cognitive overhead by unifying `ArborView` and `IndexedArbor` under a common `ArborView` trait, with concrete types `TableView` and `IndexedView`.

**Status:** In progress

**Scope:**
1. Define `ArborView` trait with common methods
2. Rename current `ArborView` struct to `TableView`
3. Rename current `IndexedArbor` struct to `IndexedView`
4. Implement `ArborView` trait for both types
5. Update all call sites and documentation

**Non-goals (explicitly out of scope):**
- Adding new view types (future work)
- Changing the semantics of either view type
- Python bindings updates (separate step)

**Dependencies / prerequisites:**
- None

---

### 17.1.0 Design Decisions

#### Trait Name: ArborView (DECIDED)

**Decision:** The common trait is named `ArborView`, conveying that implementations are views over an Arbor.

**Rationale:**
- "View" clearly communicates the non-owning, derived nature
- Consistent with database/dataframe terminology
- The current `ArborView` struct name becomes available for the trait

**Implications:**
- Current `ArborView` struct must be renamed before trait is defined
- All existing `ArborView` usages must be updated

#### Struct Names: TableView and IndexedView (DECIDED)

**Decision:**
- Current `ArborView` becomes `TableView` (row/column table-like access)
- Current `IndexedArbor` becomes `IndexedView` (keyed lookup access)

**Rationale:**
- Parallel naming convention (`*View`)
- `TableView` emphasizes the row-oriented table semantics
- `IndexedView` emphasizes the indexed/keyed access pattern
- Both names are concise and descriptive

**Implications:**
- Public API breaking change (requires migration)
- Re-exports can ease transition

---

### 17.1.1 Specification

#### 17.1.1.1 Inputs and Outputs (Data Model)

**Inputs:**
- Existing `ArborView` in `arbors-storage::view`
- Existing `IndexedArbor` in `arbors-query::index_by`

**Outputs:**
- `ArborView` trait in `arbors-storage`
- `TableView` struct (renamed from `ArborView`)
- `IndexedView` struct (renamed from `IndexedArbor`)

**Key invariants:**
- Both view types provide access to underlying `Arbor` without ownership
- Trait methods have consistent semantics across implementations

#### 17.1.1.2 Terminology and Naming

- **ArborView**: Trait for any view over an Arbor
- **TableView**: A row-oriented view over columnar JSON (arrays as columns)
- **IndexedView**: A keyed lookup view for O(1) tree access by key

#### 17.1.1.3 Public API Surface

**Rust:**
```rust
// In arbors-storage::view

/// A view over an Arbor providing derived access patterns.
pub trait ArborView {
    /// Get a reference to the underlying Arbor.
    fn arbor(&self) -> &Arbor;

    /// Number of primary items in this view.
    /// - TableView: number of rows
    /// - IndexedView: number of keys at this level
    fn len(&self) -> usize;

    /// Returns true if the view contains no items.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// A row-oriented view over columnar JSON.
///
/// Given an object whose fields are arrays, provides table-like
/// access where each row is the i-th element from each array.
pub struct TableView<'a> { /* ... */ }

impl<'a> ArborView for TableView<'a> { /* ... */ }
```

```rust
// In arbors-query::index_by

/// A keyed lookup view for O(1) tree access.
///
/// Built via `index_by()`, maps key expressions to tree indices.
pub struct IndexedView { /* ... */ }

impl ArborView for IndexedView { /* ... */ }
```

#### 17.1.1.4 Internal Architecture

- **Trait location**: `arbors-storage::view` (lower in dependency graph)
- **TableView location**: `arbors-storage::view` (same file, renamed)
- **IndexedView location**: `arbors-query::index_by` (same file, renamed)
- **Re-exports**: `arbors` crate re-exports trait and both types

---

### 17.1.2 Definitive Symbol Inventory

#### 17.1.2.1 New crates (if any)

None.

#### 17.1.2.2 New files (if any)

None.

#### 17.1.2.3 Symbols to add / modify

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ArborView` | trait | `arbors-storage::view` | New trait |
| `TableView` | struct | `arbors-storage::view` | Renamed from `ArborView` |
| `TableViewBuilder` | struct | `arbors-storage::view` | Renamed from `ArborViewBuilder` |
| `IndexedView` | struct | `arbors-query::index_by` | Renamed from `IndexedArbor` |
| `IndexedViewEntry` | enum | `arbors-query::index_by` | Renamed from `IndexedArborEntry` |

---

### 17.1.3 Test Plan

#### 17.1.3.1 Unit tests

- [ ] `test_table_view_implements_arbor_view` — TableView implements trait correctly
- [ ] `test_indexed_view_implements_arbor_view` — IndexedView implements trait correctly
- [ ] `test_arbor_view_len_consistency` — len() matches expected for both types

#### 17.1.3.2 Integration tests

- [ ] Existing tests pass after rename (verify no behavioral changes)

---

### 17.1.4 Documentation Plan

- [ ] Update doc comments for renamed types
- [ ] Add trait-level documentation explaining the view concept
- [ ] Update ARCHITECTURE.md if it references old names

---

### 17.1.5 Execution Steps

#### Step 0: Rename ArborView to TableView in arbors-storage

**Commit:** `refactor(storage): rename ArborView to TableView`

**References:**
- Decision: Struct Names (17.1.0) — `TableView` for row-oriented table access
- Symbol Inventory (17.1.2.3) — `TableView`, `TableViewBuilder` renames
- Specification (17.1.1.4) — TableView location in `arbors-storage::view`

**Tasks:**
- [x] Rename `ArborView` struct to `TableView`
- [x] Rename `ArborViewBuilder` to `TableViewBuilder`
- [x] Rename `ArborViewOptions` to `TableViewOptions`
- [x] Rename `ArborViewSchema` to `TableViewSchema`
- [x] Rename `ArborViewSchemaField` to `TableViewSchemaField`
- [x] Update `Arbor::arbor_view()` method to `Arbor::table_view()`
- [x] Update all internal usages in `arbors-storage`
- [x] Update re-exports in `arbors` crate `src/lib.rs`

**Unit Tests (update existing tests to use new names):**
- [x] `test_validation_mode_default` — ValidationMode::Strict is default
- [x] `test_table_view_options_default` — TableViewOptions defaults correct
- [x] `test_table_view_on_empty_arbor` — error on empty arbor
- [x] `test_table_view_invalid_node_id` — error on invalid NodeId
- [x] `test_table_view_builder_method_chaining` — builder pattern works
- [x] `test_table_view_builder_ragged_mode` — ragged mode setting
- [x] `test_table_view_builder_columns_all_arrays` — column selection
- [x] `test_table_view_convenience_method` — `Arbor::table_view()` returns builder

**Checkpoint:** `cargo test -p arbors-storage` ✓ (248 tests passed)

---

#### Step 1: Rename IndexedArbor to IndexedView in arbors-query

**Commit:** `refactor(query): rename IndexedArbor to IndexedView`

**References:**
- Decision: Struct Names (17.1.0) — `IndexedView` for keyed lookup access
- Symbol Inventory (17.1.2.3) — `IndexedView`, `IndexedViewEntry` renames
- Specification (17.1.1.4) — IndexedView location in `arbors-query::index_by`

**Tasks:**
- [x] Rename `IndexedArbor` struct to `IndexedView`
- [x] Rename `IndexedArborEntry` enum to `IndexedViewEntry`
- [x] Update `index_by()` return type and documentation
- [x] Update all internal usages in `arbors-query`
- [x] Update re-exports in `arbors` crate `src/lib.rs` (no re-exports to update)

**Unit Tests (update existing tests to use new names):**
- [x] `test_index_by_basic` — basic indexing works with IndexedView
- [x] `test_index_by_string_key` — string key lookup
- [x] `test_index_by_int_key` — integer key lookup
- [x] `test_index_by_missing_key` — missing key returns None
- [x] `test_index_by_len` — len() returns correct count
- [x] `test_index_by_duplicates_error` — error policy works
- [x] `test_index_by_duplicates_first` — first policy works
- [x] `test_index_by_duplicates_last` — last policy works
- [x] `test_index_by_duplicates_collect` — collect policy returns IndexedViewEntry::Trees
- [x] `test_index_by_null_key_drop` — null key drop policy
- [x] `test_index_by_null_key_error` — null key error policy
- [x] `test_index_by_keys` — keys() iteration
- [x] `test_index_by_values` — values() iteration
- [x] `test_index_by_items` — items() iteration
- [x] `test_index_by_contains` — contains() check
- [x] `test_index_by_empty_arbor` — empty arbor handling
- [x] `test_index_by_two_keys_nested` — multi-key returns IndexedViewEntry::Nested
- [x] `test_index_by_depth` — depth() returns correct level

**Checkpoint:** `cargo test -p arbors-query` ✓ (476 tests passed)

---

#### Step 2: Define ArborView trait and implement for TableView

**Commit:** `feat(storage): add ArborView trait`

**References:**
- Decision: Trait Name (17.1.0) — `ArborView` as common trait name
- Specification (17.1.1.3) — trait signature with `arbor()`, `len()`, `is_empty()`
- Specification (17.1.1.4) — trait location in `arbors-storage::view`
- Key Invariants (17.1.1.1) — views provide access without ownership

**Tasks:**
- [x] Define `ArborView` trait in `arbors-storage::view`
- [x] Add `fn arbor(&self) -> &Arbor` method
- [x] Add `fn len(&self) -> usize` method
- [x] Add `fn is_empty(&self) -> bool` method with default impl
- [x] Implement `ArborView` for `TableView<'a>`
- [x] Add `ArborView` trait to public exports in `arbors-storage::lib.rs`
- [x] Add `ArborView` to re-exports in `arbors` crate

**Unit Tests:**
- [x] `test_table_view_arbor_view_arbor` — `arbor()` returns reference to underlying Arbor
- [x] `test_table_view_arbor_view_len` — `len()` matches `row_count()`
- [x] `test_table_view_arbor_view_len_empty` — `len()` returns 0 for empty view
- [x] `test_table_view_arbor_view_len_filtered` — `len()` respects row_indices after filter
- [x] `test_table_view_arbor_view_is_empty_true` — `is_empty()` true when no rows
- [x] `test_table_view_arbor_view_is_empty_false` — `is_empty()` false when has rows
- [x] `test_table_view_arbor_view_trait_object` — can be used as `&dyn ArborView`

**Checkpoint:** `cargo test -p arbors-storage` ✓ (255 tests passed)

---

#### Step 3: Implement ArborView for IndexedView

**Commit:** `feat(query): implement ArborView for IndexedView`

**References:**
- Specification (17.1.1.3) — `IndexedView` implements `ArborView`
- Specification (17.1.1.4) — IndexedView in `arbors-query`, imports trait from `arbors-storage`
- Key Invariants (17.1.1.1) — consistent semantics across implementations

**Tasks:**
- [x] Import `ArborView` trait from `arbors-storage`
- [x] Implement `ArborView` for `IndexedView`
- [x] `arbor()` returns `&self.arbor`
- [x] `len()` delegates to existing `IndexedView::len()`
- [x] Verify `is_empty()` default impl works correctly

**Unit Tests:**
- [x] `test_indexed_view_arbor_view_arbor` — `arbor()` returns reference to underlying Arbor
- [x] `test_indexed_view_arbor_view_len` — `len()` matches key count at top level
- [x] `test_indexed_view_arbor_view_len_empty` — `len()` returns 0 for empty index
- [x] `test_indexed_view_arbor_view_len_nested` — `len()` returns key count at each level
- [x] `test_indexed_view_arbor_view_is_empty_true` — `is_empty()` true when no keys
- [x] `test_indexed_view_arbor_view_is_empty_false` — `is_empty()` false when has keys
- [x] `test_indexed_view_arbor_view_trait_object` — can be used as `&dyn ArborView`
- [x] `test_arbor_view_polymorphic_len` — both types work through trait reference

**Checkpoint:** `cargo test -p arbors-query` ✓ (484 tests passed)

---

#### Step 4: Update downstream code and documentation

**Commit:** `docs: update references to renamed view types`

**References:**
- Documentation Plan (17.1.4) — update doc comments, ARCHITECTURE.md
- Terminology (17.1.1.2) — ensure consistent use of new terms

**Tasks:**
- [x] Update Python bindings class names if exposed (`IndexedArbor` → `IndexedView`)
- [x] Update Python stub files (`.pyi`) with new names
- [x] Update `docs/ARCHITECTURE.md` references to old names
- [x] Update `docs/API.md` if it references old names
- [x] Search codebase for any remaining `ArborView` struct references (should be trait only)
- [x] Search codebase for any remaining `IndexedArbor` references
- [x] Update any example code in doc comments

**Unit Tests:**
- [x] Python tests pass with new class names (2169 passed)

**Checkpoint:** `make test` ✓

---

### 17.1.6 Deliverables and Checkpoints

**Deliverable:** Unified `ArborView` trait with `TableView` and `IndexedView` implementations, reducing cognitive overhead for developers.

**Integration Tests:**
- [x] `test_table_view_full_workflow` — build TableView, iterate rows, access cells, filter, sort
- [x] `test_indexed_view_full_workflow` — build IndexedView via index_by, lookup keys, iterate
- [x] `test_arbor_view_trait_polymorphism` — function accepting `&dyn ArborView` works with both types
- [x] `test_table_view_with_index_by` — create TableView, then index_by on same Arbor
- [x] `test_nested_indexed_view_arbor_access` — nested IndexedView levels all return same Arbor
- [x] `test_table_view_filtered_len_via_trait` — filtered TableView reports correct len via trait
- [x] `test_indexed_view_collect_mode_len` — collect mode IndexedView reports correct key count
- [x] `test_both_views_same_arbor` — TableView and IndexedView on same Arbor, verify arbor() equality
- [x] `test_arbor_view_generic_function` — generic `fn process<V: ArborView>(v: &V)` works with both

| Checkpoint | Verification |
|------------|--------------|
| All renames complete | `cargo build --all` compiles without old names |
| Trait implemented | Both `TableView` and `IndexedView` implement `ArborView` |
| Unit tests pass | `cargo test -p arbors-storage -p arbors-query` |
| Integration tests pass | `cargo test -p arbors` (acceptance tests) |
| Python bindings work | `make python-test` (if names exposed to Python) |
| Full suite passes | `make test` |
| No behavioral changes | All pre-existing tests pass (only names changed) |

**Commit after all checkpoints pass.**

---

## Phase 17.2: Making Schemas Great

**Purpose:** Transform schemas from a utilitarian internal mechanism into a first-class, ergonomic experience across both Rust and Python, providing excellent pretty-printing, standalone inference, unified validation options, navigation APIs, and a foundation for rich numeric types and surface forms.

**Status:** Not started

**Scope:**
1. Excellent human-first pretty-printing of schemas
2. Schema inference as a standalone, productized operation
3. Unified load/validation options model (validate vs. no-validate vs. coerce)
4. Schema navigation and introspection APIs
5. Foundation for tuples as first-class DataType
6. Foundation for rich numeric types (scaled, modular, packed)
7. Foundation for surface forms (presentation annotations)
8. Schema+data envelope format for round-tripping

**Non-goals (explicitly out of scope):**
- Full implementation of new data types (separate phases)
- Breaking changes to existing JSON Schema import
- Python-only features (Rust-first, then Python bindings)
- Automatic schema evolution/migration

**Dependencies / prerequisites:**
- Phase 17.1 complete (ArborView trait unification)

---

### 17.2.0 Design Decisions

#### Schema Pretty-Printing: Human-First, Multi-View (DECIDED)

**Decision:** Add `Schema::to_pretty()` / `Schema::fmt_pretty(opts)` that produces human-readable, tree-structured output distinct from JSON. Support multiple views: summary, full, and diff-friendly.

**Rationale:**
- `to_json_pretty()` is machine-readable but not optimal for human review
- Users need to quickly understand schema structure at a glance
- Diff-friendly output enables meaningful version control
- Tree-structured display shows nesting clearly

**Implications:**
- New `PrettyPrintOptions` struct with view mode, indent, max_depth
- Display trait implementation should remain JSON-ish for debugging
- Human-readable output uses type syntax like `array<string>`, `object{...}`

#### Schema Inference API: Standalone with Diagnostics (DECIDED)

**Decision:** Expose schema inference as standalone functions that return `InferredSchema` containing both the schema and diagnostics (widening events, null rates, type confidence).

**Rationale:**
- Currently inference is coupled to IO operations
- Diagnostics are crucial when adding rich types (detect patterns)
- Users need to understand what the inferencer observed

**Implications:**
- New `InferredSchema` struct with schema + diagnostics
- Separate from `SchemaRegistry` (which is compiled form)
- Python exposure via `arbors.infer_schema(data)`

#### Unified Load Options: Single Options Model (DECIDED)

**Decision:** Create `LoadOptions` that unifies validation mode, policy, coercion, and error handling for use in both IO and validation contexts.

**Rationale:**
- Currently `ValidationOptions` exists but isn't integrated with IO
- Users want "load with schema but don't fail fast" option
- Coercion and surface form parsing need consistent handling

**Implications:**
- `LoadOptions` extends/replaces `ValidationOptions` for IO
- IO functions accept optional `LoadOptions`
- `on_error: FailFast | Collect(max)` for unified error handling

#### Schema Navigation: Path-Based Lookup (DECIDED)

**Decision:** Add path-based schema navigation using familiar dot notation: `schema.type_at("player.stats[0].era")`, `schema.project([...])`, `schema.diff(&other)`.

**Rationale:**
- Common need when debugging schema mismatches
- Enables schema evolution checks
- Foundation for constraint propagation in surface forms
- Dot notation is universally familiar (Python, JavaScript, jq)

**Implications:**
- JSONPath-style dot notation: `field.nested[0].value`
- Leading `$` optional (root implied)
- Array indices use `[n]` syntax
- Returns `Option<&DataType>` or rich result with path info
- Diff returns structured changes, not just bool

#### Field Naming: No Dots Allowed (DECIDED)

**Decision:** Field names must not contain dots (`.`). This is enforced during schema creation and schema-guided data loading. Schemaless loading relaxes this rule.

**Rationale:**
- Enables unambiguous dot notation for path navigation
- Dots in field names are a code smell anyway
- Simplifies parsing and avoids escaping complexity
- If you name a field `"stats.era"`, you get what you deserve

**Implications:**
- Schema validation rejects fields containing `.`
- Data loading with schema rejects keys containing `.`
- Schemaless loading does NOT enforce this (no schema means no dot navigation anyway)
- Clear error message: "field name 'foo.bar' contains '.'; use 'foo_bar' or 'fooBar'"

#### Tuples: Heterogeneous Fixed-Length Arrays (DECIDED)

**Decision:** Expose `DataType::Tuple { items: Vec<DataType> }` as a first-class semantic type for heterogeneous fixed-length arrays.

**Rationale:**
- JSON Schema `prefixItems` is common
- Enables fixed-length heterogeneous arrays (like `(name, age, active)`)
- Natural fit for structured records without field names
- Pretty-printing should show `tuple[string, int64, bool]`

**Semantics:**
- Each position has its own type
- Order matters; positions are accessed by index
- Small cardinality only (≤12 elements, matching Rust tuple trait impls)
- Use cases: coordinates `(x, y)`, RGB `(r, g, b)`, key-value pairs

**Rust representation:**
```rust
pub enum DataType {
    // ...
    Tuple { items: Vec<DataType> },  // (T0, T1, T2, ...)
}
```

**Python representation:**
```python
# Type annotation
tuple[str, int, bool]

# Runtime
("Alice", 30, True)
```

**Implications:**
- Add `DataType::Tuple` variant
- Inference heuristics detect fixed-length heterogeneous patterns
- Map to `StorageType::Tuple` (struct-of-arrays for each position)
- Navigation: `type_at("record[0]")` returns first element type
- JSON serialization: `{"type": "tuple", "items": [{"type": "string"}, ...]}`

---

#### ArrayN: Homogeneous Fixed-Length Arrays (DECIDED)

**Decision:** Add `DataType::ArrayN { element: Box<DataType>, size: usize }` as a first-class type for fixed-size homogeneous arrays, optimized for SIMD operations.

**Rationale:**
- Embeddings (768-dim, 1536-dim) are ubiquitous in ML
- Rust tuples don't scale beyond ~12 elements
- Const-generic arrays `[f64; 768]` are the correct Rust representation
- SIMD-friendly: contiguous, aligned, predictable layout
- Arrow has `FixedSizeList` for exactly this use case

**Semantics:**
- All elements have the same type
- Size is fixed at schema definition time
- Optimized for numeric types (f32, f64, i32, i64)
- Large sizes supported (768, 1536, 3072 common for embeddings)
- Use cases: embeddings, feature vectors, audio samples, pixel data

**Rust representation:**
```rust
pub enum DataType {
    // ...
    ArrayN {
        element: Box<DataType>,  // Usually Float32 or Float64
        size: usize,             // e.g., 768
    },
}

// Maps to const-generic array in generated code / storage
type Embedding = [f64; 768];
```

**Python representation:**
```python
# Schema definition
DataType.array_n(DataType.float64(), 768)

# Runtime representation options:
# 1. NumPy array (preferred for performance)
import numpy as np
embedding: np.ndarray  # shape (768,), dtype=float64

# 2. Python list (fallback)
embedding: list[float]  # len() == 768
```

**Storage strategy:**
- Uses Arrow `FixedSizeList` for columnar storage
- Contiguous memory layout enables SIMD operations
- Bulk operations (dot product, cosine similarity) can use `std::simd` or `packed_simd`
- Pass by reference for large arrays (6KB+ for 768 × f64)

**Pretty-print syntax:**
```
float64[768]    # Compact form (preferred)
```

**Implications:**
- Add `DataType::ArrayN` variant
- Map to Arrow `FixedSizeList` in storage
- Inference: detect arrays where all elements same type AND all arrays same length
- Navigation: `type_at("embedding[0]")` returns element type (any index, since homogeneous)
- JSON serialization: `{"type": "array_n", "element": {"type": "float64"}, "size": 768}`
- Python uses NumPy when available for zero-copy interop
- Future: SIMD-accelerated operations (dot, cosine, norm)

---

#### Tuple vs ArrayN: When to Use Which

| Aspect | Tuple | ArrayN |
|--------|-------|--------|
| **Element types** | Heterogeneous (different) | Homogeneous (same) |
| **Typical size** | 2-12 elements | 10-10000+ elements |
| **Use case** | Structured records | Numeric vectors |
| **Examples** | `(x, y)`, `(name, age)` | embeddings, audio |
| **SIMD friendly** | No | Yes |
| **Rust maps to** | `(T0, T1, ...)` | `[T; N]` |
| **Python maps to** | `tuple[T0, T1, ...]` | `np.ndarray` |
| **Arrow type** | Struct (internally) | FixedSizeList |
| **Pretty syntax** | `tuple[int64, string]` | `float64[768]` |

**Inference heuristics:**
- If all arrays have same length AND all elements same type → `ArrayN`
- If all arrays have same length AND elements have different types → `Tuple`
- If arrays have varying lengths → `Array<T>` (existing variable-length type)

#### Rich Numeric Types: Logical Layer (DECIDED)

**Decision:** Rich numeric types (scaled, modular, packed) are "logical types" with parameters, not new storage primitives. They compose with base types (int64, float64).

**Rationale:**
- Keeps core storage types simple
- Parameters (scale, modulus, bits) are type-level, not storage-level
- Validation/formatting is semantic, not physical

**Implications:**
- `DataType::Logical { name: String, params: Value, base: Box<DataType> }` or dedicated variants
- Integrate with existing `LogicalType` infrastructure in `arbors-schema`
- Surface forms attach to logical types

#### Surface Forms: Schema Annotations (DECIDED)

**Decision:** Surface forms are schema annotations (not new types) that specify presentation and parsing semantics: `{ style: "batting_avg", decimals: 3 }`.

**Rationale:**
- Formatting is presentation, not storage
- Same underlying float64 can have multiple presentations
- Parsing hints help infer intended semantics

**Implications:**
- Annotations attached to fields/types in schema
- Used during serialization/display
- Optional during parsing (can infer)

#### Schema-Data Envelope: Versioned Format (DECIDED)

**Decision:** Define a standard envelope format: `{ "version": 1, "schema": {...}, "data": ... }` for self-describing payloads.

**Rationale:**
- Easy archiving and sharing
- Robust round-trips without separate schema management
- Foundation for streaming with embedded schema

**Implications:**
- New `read_enveloped()` / `write_enveloped()` functions
- Schema serialization already exists (`to_json_pretty()`)
- Version field for forward compatibility

#### Canonical Schema Representation (DECIDED)

**Decision:** Native `Schema`/`DataType` is the user-facing API. `SchemaRegistry` is the compiled internal form that users never touch directly.

**Rationale:**
- Users should work with semantic types, not internal representations
- Analogous to SQL (user writes SQL) → query plan (internal)
- Keeps user-facing API stable even if internals change

**Implications:**
- Users create, inspect, serialize, pretty-print `Schema`
- `Schema::compile() -> Result<SchemaRegistry>` is the bridge
- When passing `Schema` to `read_json()`, compilation happens implicitly
- Python `Schema` wraps native `Schema`, not `SchemaRegistry`

#### LoadOptions Semantics (DECIDED)

**Decision:** `OnError::Collect` skips invalid trees and returns valid trees plus error report. Coercion happens during parsing.

**Rationale:**
- "Partially loaded with placeholders" is confusing and breaks invariants
- Skip-invalid-trees is clean and matches `arbors-validate` Strict mode
- Coercion during parsing means storage types are correct immediately

**Implications:**
- `LoadValidation::Off` — no schema checking, fastest path
- `LoadValidation::Absolute` — fail on first error (current behavior)
- `LoadValidation::Strict` — collect errors, skip invalid trees, return valid + report
- `LoadValidation::Lax` — coerce when possible, skip only un-coercible
- Output type: `(Arbor, Vec<LoadError>)` or `LoadResult` struct
- Full `Strict`/`Lax` implementation is complex; start with `Off`/`Absolute`

#### Envelope Schema Payload (DECIDED)

**Decision:** The envelope embeds native schema JSON (what `Schema::to_json_pretty()` produces), not JSON Schema or serialized `SchemaRegistry`.

**Rationale:**
- Native schema is the user-facing representation
- Users can inspect and edit it
- JSON Schema is an import format, not the native format
- Serialized `SchemaRegistry` is internal/unstable

**Implications:**
- Envelope format: `{ "version": 1, "schema": <native>, "data": [...] }`
- Need `Schema::from_json()` for reading envelopes
- Pipeline: `from_json()` → `Schema` → `compile()` → `SchemaRegistry`

#### LoadOptions Crate Location (REVISED)

**Decision:** Validation types (`ValidationPolicy`, `ValidationOptions`, coercion functions) stay in `arbors-validate`. The `arbors-io` crate depends on `arbors-validate`.

**Rationale (REVISED after investigation):**
- The original concern about a dependency cycle was incorrect
- `arbors-validate`'s use of `arbors-io` is ONLY in `#[cfg(test)]` modules
- Moving `arbors-io` to `[dev-dependencies]` in `arbors-validate` breaks the apparent cycle
- This allows `arbors-io` to properly depend on `arbors-validate`
- **No code duplication needed** — all types already exist in `arbors-validate`

**Existing infrastructure in `arbors-validate`:**
- `ValidationPolicy` enum (Absolute, Strict, Lax) — just add `Off` variant
- `ValidationOptions` struct with full builder pattern
- `ValidationError`, `ValidationErrorKind`, `ValidationWarning`
- `TreeValidationResult`, `CollectionValidationResult`
- All coercion functions in `coerce.rs`

**Implications:**
- Move `arbors-io` from `[dependencies]` to `[dev-dependencies]` in `arbors-validate/Cargo.toml`
- Add `arbors-validate` to `arbors-io/Cargo.toml` `[dependencies]`
- Add `ValidationPolicy::Off` variant for "no schema checking" mode
- `arbors-io` imports validation types from `arbors-validate`

#### Python Schema Refactor: Lazy Compilation (DECIDED)

**Decision:** Python `Schema` wraps native `Schema` with lazy compilation on first use, cached thereafter.

**Rationale:**
- Today Python `Schema` wraps compiled `SchemaRegistry`
- Changing to wrap native `Schema` (per Canonical Schema decision) requires care
- Without caching, every IO call would recompile the schema
- Lazy compilation + caching gives best of both worlds

**Implications:**
- Python `Schema` holds `Arc<Schema>` (native) + `OnceCell<SchemaRegistry>` (compiled)
- First call to `read_json(schema=s)` triggers compilation
- Subsequent calls reuse cached compiled form
- Existing APIs like `Schema.root`, `Schema.get_field` continue to work
- May need migration shims for APIs that exposed `SchemaRegistry` internals

---

#### ArrayN Scope: Schema-First, Storage-Later (DECIDED)

**Decision:** Phase 17.2 implements `ArrayN` at the schema level only. Storage/Arrow mapping is deferred.

**Rationale:**
- The priority is schema specification and API ergonomics
- Storage optimization (Arrow `FixedSizeList`, SIMD) is substantial multi-crate work
- Schema representation can be complete without storage being optimal
- Don't block API work on storage complexity

**Phase 17.2 Scope:**
- `DataType::ArrayN` variant with `element` and `size`
- JSON serialization: `{"type": "array_n", "element": {...}, "size": 768}`
- Pretty-printing: `float64[768]`
- Navigation: `type_at("embedding[0]")` returns element type
- Inference: detect same-length same-type arrays

**Deferred to Phase 17.x (Storage):**
- Arrow `FixedSizeList` mapping
- Compile to optimized `StorageType`
- SIMD-accelerated operations (dot, cosine, norm)
- NumPy zero-copy interop

**Implications:**
- In Phase 17.2, `ArrayN` compiles to regular `Array` storage (functional but not optimal)
- Future phase adds storage optimization without API changes
- Users get the schema ergonomics now, performance later

---

#### Coercion: During Parse, Like Polars (DECIDED)

**Decision:** Coercion happens during parsing, not after. Values go directly into correctly-typed storage. Failed coercions become null.

**Rationale (the Polars way):**
```python
# Polars: strict=False means "cast if possible, null if not"
df = pl.read_csv(file, schema=schema, strict=False)
```
- Schema is known upfront when parsing
- When type mismatch detected, try to coerce immediately
- Success: store coerced value in correct typed pool
- Failure: store null in correct typed pool
- No mutation, no rebuild, no post-processing
- **Simple, fast, correct.**

**How it works:**
```
Parser encounters value "123" for field schema says is int64:
  Absolute: error (string ≠ int64)
  Strict:   error, skip tree, collect error
  Lax:      try parse "123" as int64 → 123 → store in int64 pool ✓

Parser encounters value "abc" for field schema says is int64:
  Lax:      try parse "abc" as int64 → fail → store null in int64 pool
```

**Implementation:**
- Move coercion primitives to `arbors-core::coerce` (simple functions: `try_coerce_to_int64(&str) -> Option<i64>`)
- Parser calls coercion when Lax + type mismatch
- No dependency issues: `arbors-io` depends on `arbors-core` (already does)
- No post-parse pass needed

**Coercion primitives (in `arbors-core::coerce`):**
```rust
// See "Coercion Primitives: Epoch-Based" decision for full list
pub fn try_string_to_i64(s: &str) -> Option<i64>;
pub fn try_string_to_f64(s: &str) -> Option<f64>;
pub fn try_string_to_bool(s: &str) -> Option<bool>;
pub fn try_string_to_date_days(s: &str) -> Option<i32>;       // epoch days
pub fn try_string_to_datetime_micros(s: &str) -> Option<i64>; // epoch micros
pub fn try_i64_to_f64(i: i64) -> Option<f64>;  // always succeeds
pub fn try_f64_to_i64(f: f64) -> Option<i64>;  // only if no fractional part
```

**Implications:**
- `LoadValidation::Lax` is clean and performant
- Values in correct typed pools from the start
- Failed coercions → null (with optional warning/diagnostic)
- No "mutation" or "rebuild" complexity
- Polars does it. Arbors can too.

---

#### Path Syntax: Bracket Escaping for Special Characters (DECIDED)

**Decision:** Field names containing `.`, `[`, or `]` must be accessed using bracket notation with quotes: `a["field.with.dots"]`.

**Rationale:**
- Dot-ban prevents `.` in schema-guided field names, but schemaless allows it
- Bracket notation is universal (JavaScript, Python, jq)
- Provides escape hatch without complex escaping rules

**When bracket escaping is needed:**
- Schemaless data with dotted field names (e.g., imported JSON with `"stats.2024"`)
- Field names containing `[` or `]` (always need escaping)
- Future relaxation of the dot rule (if ever)
- Programmatic path construction from untrusted field names

**Path Syntax Rules:**
```
path        = segment ("." segment)*
segment     = identifier | bracket
identifier  = [a-zA-Z_][a-zA-Z0-9_]*   # Simple field name
bracket     = "[" (index | quoted) "]"
index       = [0-9]+                    # Array/tuple index
quoted      = '"' [^"]* '"'             # Quoted field name (allows any chars)
            | "'" [^']* "'"             # Single quotes also work
```

**Examples:**
```
player.stats.hr           # Simple dot notation
player["stats.2024"].hr   # Field name contains dot
data["field[0]"].value    # Field name contains brackets
items[0].name             # Array index
tuple[1]                  # Tuple index
```

**Implications:**
- `type_at()` parser must handle quoted segments
- Error messages should suggest bracket notation for invalid paths
- Documentation should show escaping examples

---

#### Tuple Size: Soft Guideline, Not Hard Limit (DECIDED)

**Decision:** Tuples with >12 elements are allowed but discouraged. No hard validation error.

**Rationale:**
- The ≤12 guideline comes from Rust tuple trait impls, but Arbors doesn't generate Rust tuples
- Users may have legitimate uses for longer heterogeneous sequences
- Hard limits create surprising UX; soft guidelines + documentation are better

**Implications:**
- `DataType::Tuple` accepts any number of items
- Documentation recommends ≤12 for best ergonomics
- Consider `ArrayN` if all elements have the same type
- Inference may use size as a heuristic (≤12 → Tuple, >12 and homogeneous → ArrayN)

---

#### Schema Compilation: Single Infrastructure (DECIDED)

**Decision:** `Schema::compile()` builds `SchemaRegistry` directly from `DataType`, reusing existing type mappings. No bifurcation with JSON Schema compilation.

**Rationale:**
- Phase 4 established: JSON Schema → `SchemaCompiler` → `SchemaRegistry` → Native Schema
- The reverse path uses the same type mappings: Native `DataType` → `StorageType` → `SchemaRegistry`
- `DataType::to_storage_type()` already exists
- Single compilation infrastructure, two entry points

**Implementation:**
```rust
impl Schema {
    /// Compile native schema to internal form for IO operations.
    pub fn compile(&self) -> Result<SchemaRegistry> {
        // Walk DataType tree, build StorageSchema entries, return registry
        // Uses existing DataType::to_storage_type() for type mapping
    }
}
```

**Implications:**
- No new compiler module needed
- Reuses existing `StorageType` infrastructure
- JSON Schema import: JSON → `SchemaCompiler` → `SchemaRegistry` → `Schema` (optional)
- Native schema: `Schema` → `compile()` → `SchemaRegistry`

---

#### Lax Null Semantics: Coercion Failures Become Null Regardless of Nullable (DECIDED)

**Decision:** In `LoadValidation::Lax`, coercion failures become null values regardless of the schema's `nullable` setting. These are reported as warnings.

**Rationale:**
- Polars `strict=False` does exactly this—failed casts become null, no exception
- The purpose of Lax is "load what you can, don't fail"
- Enforcing `nullable` during Lax contradicts the intent
- Users who want strict nullability should use `Strict` mode

**How it works:**
```
Schema says: field "age" is int64, nullable=false

Lax mode:
  Value "abc" → try coerce to int64 → fail → store null + warning
  Null input  → store null + warning

Strict mode:
  Value "abc" → type error → skip tree
  Null input  → UnexpectedNull error → skip tree

Absolute mode:
  Value "abc" → type error → abort load
  Null input  → UnexpectedNull error → abort load
```

**Warning/Error reporting:**
- `LoadValidation::Lax` + coercion failure → add to warnings (not errors)
- `LoadValidation::Lax` + unexpected null → add to warnings (not errors)
- `OnError::Collect` accumulates warnings up to max
- `OnError::FailFast` never reached for Lax warnings

**Implications:**
- Lax-loaded arbors may have nulls where schema says non-nullable
- Downstream code must handle this (nullability is advisory in Lax)
- Clear documentation: "Lax mode prioritizes loading over schema conformance"
- Consider: `LoadResult.warnings` vs `LoadResult.errors` distinction

---

#### Coercion Primitives: Epoch-Based, No Chrono Dependency (DECIDED)

**Decision:** Coercion primitives return Arbors' internal representations (epoch-based integers), not `chrono` types. This keeps `arbors-core` minimal.

**Rationale:**
- `arbors-core` currently depends only on `thiserror` + `serde`
- Adding `chrono` to core increases dependency surface
- Arrow stores temporals as epoch offsets (days, micros) anyway
- Coercion should produce the final storage representation directly

**Coercion primitives (revised, in `arbors-core::coerce`):**
```rust
// String → primitive coercions
pub fn try_string_to_i64(s: &str) -> Option<i64>;
pub fn try_string_to_f64(s: &str) -> Option<f64>;
pub fn try_string_to_bool(s: &str) -> Option<bool>;

// String → temporal coercions (epoch-based)
pub fn try_string_to_date_days(s: &str) -> Option<i32>;       // days since 1970-01-01
pub fn try_string_to_datetime_micros(s: &str) -> Option<i64>; // microseconds since epoch
pub fn try_string_to_duration_micros(s: &str) -> Option<i64>; // microseconds

// String → binary coercion
pub fn try_string_to_binary(s: &str) -> Option<Vec<u8>>;      // base64 decode

// Numeric coercions
pub fn try_i64_to_f64(i: i64) -> Option<f64>;  // always succeeds (may lose precision)
pub fn try_f64_to_i64(f: f64) -> Option<i64>;  // only if no fractional part
```

**Accepted date/datetime formats:**
- ISO 8601: `2024-01-15`, `2024-01-15T10:30:00Z`
- With timezone: `2024-01-15T10:30:00+05:00`
- Flexible separators: `2024/01/15` also accepted

**Implementation:**
- Use `time` crate (lighter than `chrono`) or pure parsing for formats
- Or: implement minimal ISO 8601 parser in-crate (no external dependency)
- Parse to date/datetime, convert to epoch offset, return offset

**Implications:**
- `arbors-core` stays minimal (no `chrono` dependency)
- Coerced temporals are immediately in storage-ready form
- Aligns with Arrow's epoch-based temporal storage
- Future: share parsing logic with `arbors-io` JSON parser

---

#### LoadResult Types: Core Types, IO Producer (DECIDED)

**Decision:** `LoadResult`, `LoadError`, `LoadWarning`, and their `Kind` enums live in `arbors-core`. The `arbors-io` parser produces them.

**Rationale:**
- Types in `arbors-core` avoids dependency issues (IO can depend on core, not vice versa)
- Consistent with `LoadOptions` placement decision
- Types are cross-cutting; could be used by future non-IO validation paths

**Location:**
```
arbors-core::load_options  → LoadOptions, LoadValidation, OnError
arbors-core::load_result   → LoadResult, LoadError, LoadWarning, LoadErrorKind, LoadWarningKind
arbors-io                  → produces LoadResult from parsing
```

**Implications:**
- Single location for all load-related types
- Re-export from `arbors` crate for ergonomics

---

#### Error/Warning Budget: Unified Limit (DECIDED)

**Decision:** `max_errors` limits the total count of errors + warnings combined. No separate `max_warnings` limit.

**Rationale:**
- Simpler API: one knob, not two
- Users care about "how much noise can I tolerate", not the classification
- Prevents pathological cases where warnings explode even with small error limit
- Polars doesn't separate these either

**Behavior:**
```rust
OnError::Collect { max: Some(100) }
// Stops collecting after 100 total issues (errors + warnings combined)
// If max reached, sets LoadResult.truncated = true
```

**Implications:**
- Add `LoadResult.truncated: bool` to signal limit was hit
- Documentation: "max_errors limits total issues (errors + warnings)"

---

#### Lax Null Representation: Typed Pool Null (DECIDED)

**Decision:** Lax-coercion-failure nulls are stored as **typed pool nulls**, not `NodeType::Null` nodes.

**Rationale:**
- The field has a schema type (e.g., int64); the null should live in that typed pool
- Consistent with "values go directly into correctly-typed storage"
- `NodeType::Null` is for JSON `null` values; coercion failure is different semantically
- Downstream code expecting int64 gets null in int64 pool, not a type mismatch

**How it works:**
```
Schema: field "age" is int64
Data:   {"age": "abc"}
Lax:    store null in int64 pool (pool.append_null()), node points to that slot
```

**Implications:**
- Parser uses `pool.append_null()` for coercion failures
- Node's `data0`/`data1` point to the null slot in the typed pool
- Consistent with how Arrow handles nulls in typed columns

---

#### Missing Required Field in Lax: Warning + Null (DECIDED)

**Decision:** In `LoadValidation::Lax`, a missing required field becomes a **warning** and the field is filled with null.

**Rationale:**
- Lax philosophy: "load what you can, don't fail"
- A missing field is a data quality issue, not a structural impossibility
- User can examine warnings to see which records had missing required fields
- Consistent with "nulls regardless of nullable" decision

**Behavior by mode:**
```
Schema: field "age" is int64, required=true
Data:   {"name": "Alice"}  (missing "age")

Lax:      store null for "age", add warning (MissingRequired)
Strict:   error, skip tree
Absolute: error, abort load
```

**Implications:**
- Add `LoadWarningKind::MissingRequired`
- Lax-loaded arbors may have nulls for required fields
- Documentation: "In Lax mode, required fields may be null if missing from source"

---

#### Path Grammar: No Quote Escaping (DECIDED)

**Decision:** Quoted path segments do not support escape sequences. Field names containing quotes cannot be accessed via path syntax.

**Rationale:**
- Keeps grammar simple and parser trivial
- Field names with quotes are extremely rare (and arguably a data smell)
- Programmatic access (non-path) is always available for edge cases
- Adding escaping later is backward-compatible if needed

**Grammar (unchanged, clarified):**
```
quoted = '"' [^"]* '"'    # No escapes: everything between quotes is literal
       | "'" [^']* "'"    # Except the quote character itself
```

**Examples:**
```
a["field.name"]     ✓ works
a['field[0]']       ✓ works
a["field\"name"]    ✗ not supported (use programmatic access)
```

**Error handling:**
- Unbalanced quotes → parse error with helpful message
- If user needs a field with quotes, document: "Use Schema::field_by_name() directly"

---

### 17.2.1 Specification

#### 17.2.1.1 Inputs and Outputs (Data Model)

**Inputs:**
- `Schema` / `DataType` for pretty-printing
- JSON/JSONL bytes for inference
- Path strings (dot notation) for navigation
- `LoadOptions` for unified loading

**Outputs:**
- Pretty-printed strings (multiple formats)
- `InferredSchema` with diagnostics
- Type lookups, projections, diffs
- Validation reports

**Key invariants:**
- Pretty-print output is deterministic and stable
- Inference diagnostics never throw; they report
- Path navigation returns `None` for invalid paths, not errors
- Load options compose: stricter options can be relaxed

#### 17.2.1.2 Terminology and Naming

- **Pretty-print**: Human-first, tree-structured schema rendering
- **InferredSchema**: Schema + inference diagnostics
- **LoadOptions**: Unified configuration for parsing with schema
- **Surface form**: Presentation/parsing annotation on a type
- **Logical type**: Semantic type layered over a base storage type
- **Envelope**: Self-describing format with schema + data

#### 17.2.1.3 Supported Features (Exhaustive)

- **Pretty-print views**:
  - Summary: 1-3 lines, type overview
  - Full: Complete tree with all fields
  - Diff-friendly: One field per line, canonical ordering

- **Inference diagnostics**:
  - Type widening events (e.g., int → float)
  - Null rate per field
  - Type confidence score
  - Sample count observed

- **Load options**:
  - `validation`: Off | Strict | Lax | Absolute
  - `coerce_types`: bool
  - `allow_extra_fields`: bool
  - `on_error`: FailFast | Collect(max)
  - `unknown_logical_types`: Error | Warn | Ignore

- **Schema navigation**:
  - `type_at(path)`: Get type at path
  - `field_at(path)`: Get field definition at path
  - `project(paths)`: Create sub-schema
  - `diff(other)`: Structural diff
  - `is_compatible_with(other)`: Evolution check
  - `fingerprint()`: Content hash

- **Explicitly not supported**:
  - Schema migration/transformation
  - Custom user-defined types
  - Type inference from queries

#### 17.2.1.4 Modes / Policies

| Mode/Policy | Applies to | Behavior | Result |
|------------|------------|----------|--------|
| `PrettyView::Summary` | Pretty-print | Show type overview only | Short string |
| `PrettyView::Full` | Pretty-print | Show complete structure | Full tree |
| `PrettyView::DiffFriendly` | Pretty-print | One item per line | Diff-optimized |
| `LoadValidation::Off` | Loading | No type checking | Fast load |
| `LoadValidation::Strict` | Loading | Type check, collect errors | Report + filtered data |
| `LoadValidation::Lax` | Loading | Coerce when possible | Converted data |

#### 17.2.1.5 Semantics (Normative Rules)

- **Pretty-print ordering**: Fields sorted alphabetically, definitions sorted alphabetically
- **Path syntax**: Dot notation with bracket array access: `player.stats[0].era`
- **Field name constraint**: No dots (`.`) allowed in field names (schema-guided only; schemaless relaxed)
- **Inference widening**: int64 → float64 when mixed, any type → nullable when null seen
- **Coercion priority**: String → temporal → number → bool (try most specific first)
- **Null vs missing**: `null` in data is distinct from absent field; schema tracks both
- **Array index semantics in type_at**:
  - `array<T>` (variable-length): any `[n]` returns element type `T`
  - `T[N]` (ArrayN): any `[n]` returns element type `T` (all same)
  - `tuple[T0, T1, ...]`: `[n]` selects nth item type (each different)
- **Fingerprint determinism**: Fingerprint is computed from canonical native JSON with sorted fields

#### 17.2.1.6 Error and Warning Model

**Inference diagnostics (not errors):**
- `widened_at`: Path where type was widened
- `null_rate`: Fraction of nulls observed
- `confidence`: 0.0-1.0 type confidence

**Load errors:**
- `path`: Dot notation path to error location
- `expected`: Expected type string
- `actual`: Actual value description
- `context`: Schema path

**Load warnings (Lax mode):**
- `path`: Location
- `action`: What was done (coerced, dropped, defaulted)
- `details`: Human-readable explanation

#### 17.2.1.7 Public API Surface

**Rust:**
```rust
// Pretty-printing
pub enum PrettyView { Summary, Full, DiffFriendly }
pub struct PrettyOptions {
    pub view: PrettyView,
    pub indent: usize,
    pub max_depth: Option<usize>,
    pub show_nullable: bool,
    pub show_required: bool,
}
impl Schema {
    pub fn to_pretty(&self) -> String;
    pub fn to_pretty_with(&self, opts: &PrettyOptions) -> String;
}
impl DataType {
    pub fn to_pretty(&self) -> String;
    pub fn to_pretty_with(&self, opts: &PrettyOptions) -> String;
}

// Inference
pub struct InferenceDiagnostics {
    pub sample_count: usize,
    pub widening_events: Vec<WideningEvent>,
    pub null_rates: HashMap<String, f64>,
    pub confidence: HashMap<String, f64>,
}
pub struct InferredSchema {
    pub schema: Schema,
    pub diagnostics: InferenceDiagnostics,
}
pub fn infer_schema(data: &[u8]) -> Result<InferredSchema>;
pub fn infer_schema_from_values(values: &[&Value]) -> Result<InferredSchema>;

// Load options
pub enum LoadValidation { Off, Absolute, Strict, Lax }
pub enum OnError { FailFast, Collect { max: Option<usize> } }
pub struct LoadOptions {
    pub validation: LoadValidation,
    pub coerce_types: bool,
    pub allow_extra_fields: bool,
    pub on_error: OnError,
    pub unknown_logical_types: UnknownLogicalTypePolicy,
}

// Navigation
impl Schema {
    pub fn type_at(&self, path: &str) -> Option<&DataType>;
    pub fn field_at(&self, path: &str) -> Option<&Field>;
    pub fn project(&self, paths: &[&str]) -> Result<Schema>;
    pub fn diff(&self, other: &Schema) -> SchemaDiff;
    pub fn fingerprint(&self) -> SchemaFingerprint;
}

// Envelope
pub fn read_enveloped(data: &[u8]) -> Result<(Arbor, Schema)>;
pub fn write_enveloped(arbor: &Arbor, schema: &Schema) -> Result<Vec<u8>>;
```

**Python:**
```python
# Pretty-printing
class PrettyView(Enum):
    SUMMARY = "summary"
    FULL = "full"
    DIFF_FRIENDLY = "diff_friendly"

class Schema:
    def to_pretty(self, view: PrettyView = PrettyView.FULL) -> str: ...
    def __str__(self) -> str: ...  # Uses SUMMARY
    def __repr__(self) -> str: ...  # Uses FULL

# Inference
@dataclass
class InferenceDiagnostics:
    sample_count: int
    widening_events: list[dict]
    null_rates: dict[str, float]
    confidence: dict[str, float]

@dataclass
class InferredSchema:
    schema: Schema
    diagnostics: InferenceDiagnostics

def infer_schema(data: bytes | str | list) -> InferredSchema: ...

# Load options
class LoadValidation(Enum):
    OFF = "off"
    ABSOLUTE = "absolute"
    STRICT = "strict"
    LAX = "lax"

@dataclass
class LoadOptions:
    validation: LoadValidation = LoadValidation.ABSOLUTE
    coerce_types: bool = False
    allow_extra_fields: bool = True
    max_errors: int | None = None

def read_json(data: bytes, schema: Schema = None, options: LoadOptions = None) -> Arbor: ...

# Navigation
class Schema:
    def type_at(self, path: str) -> DataType | None: ...
    def field_at(self, path: str) -> Field | None: ...
    def project(self, paths: list[str]) -> Schema: ...
    def diff(self, other: Schema) -> SchemaDiff: ...
    def fingerprint(self) -> str: ...
```

#### 17.2.1.8 Internal Architecture

- **Single source of truth**: `Schema` and `DataType` in `arbors-schema::native_types`
- **Pretty-printing pipeline**:
  1. Walk `DataType` tree
  2. Apply `PrettyOptions` for formatting decisions
  3. Build string with proper indentation
- **Inference pipeline**:
  1. Observe samples → `InferenceCompiler`
  2. Build `Schema` from observations
  3. Collect diagnostics during observation
  4. Return `InferredSchema`
- **Where code lives**:
  - `arbors-schema::pretty` — pretty-printing
  - `arbors-schema::inference` — enhanced inference (extends existing)
  - `arbors-schema::navigation` — path-based operations
  - `arbors-core::load_options` — unified load options
  - `arbors-io::envelope` — envelope format

---

### 17.2.1.9 Complete API Reference

This section provides the definitive API reference with concrete examples for both Rust and Python.

---

#### Rust API

##### Schema Creation and Serialization

```rust
use arbors_schema::{Schema, DataType, Field};

// Create schema programmatically
let schema = Schema::new(DataType::Object {
    fields: vec![
        Field::new("name", DataType::String),
        Field::new("age", DataType::Int64).nullable(),
        Field::new("scores", DataType::Array(Box::new(DataType::Float64))),
    ],
});

// Serialize to JSON (for saving)
let json: String = schema.to_json();
let json_pretty: String = schema.to_json_pretty();

// Deserialize from JSON (for loading)
let schema: Schema = Schema::from_json(&json)?;

// Compile to internal form (for parsing)
let registry: SchemaRegistry = schema.compile()?;
```

##### Schema Pretty-Printing

```rust
use arbors_schema::{Schema, PrettyView, PrettyOptions};

let schema: Schema = /* ... */;

// Default pretty-print (Full view)
println!("{}", schema.to_pretty());
// Output:
// object {
//   name: string
//   age: int64?
//   scores: array<float64>
// }

// Summary view (compact)
let opts = PrettyOptions::new().view(PrettyView::Summary);
println!("{}", schema.to_pretty_with(&opts));
// Output: object { name, age?, scores }

// Full view with depth limit
let opts = PrettyOptions::new()
    .view(PrettyView::Full)
    .max_depth(2);
println!("{}", schema.to_pretty_with(&opts));

// Diff-friendly view (one field per line, stable ordering)
let opts = PrettyOptions::new().view(PrettyView::DiffFriendly);
println!("{}", schema.to_pretty_with(&opts));
// Output:
// object
//   age: int64?
//   name: string
//   scores: array<float64>
```

##### Schema Inference

```rust
use arbors_schema::{infer_schema, InferredSchema};

// Infer from JSONL bytes
let data = br#"{"name": "Alice", "age": 30}
{"name": "Bob", "age": null}
{"name": "Carol", "age": 25}"#;

let inferred: InferredSchema = infer_schema(data)?;

// Access the schema
let schema: &Schema = &inferred.schema;
println!("{}", schema.to_pretty());

// Access diagnostics
println!("Samples observed: {}", inferred.diagnostics.sample_count);
println!("Null rate for 'age': {:.1}%",
    inferred.diagnostics.null_rates.get("age").unwrap_or(&0.0) * 100.0);

// Check for widening events
for event in &inferred.diagnostics.widening_events {
    println!("Type widened at '{}': {} -> {}",
        event.path, event.from_type, event.to_type);
}

// Round-trip: save schema, load later
let json = inferred.schema.to_json_pretty();
std::fs::write("schema.json", &json)?;

// Later...
let json = std::fs::read_to_string("schema.json")?;
let schema = Schema::from_json(&json)?;
let arbor = arbors_io::read_json(new_data, Some(&schema.compile()?))?;
```

##### Schema Navigation

```rust
use arbors_schema::Schema;

let schema: Schema = /* player schema */;

// Get type at a path
let hr_type: Option<&DataType> = schema.type_at("career_batting.HR");
assert_eq!(hr_type, Some(&DataType::Int64));

// Array indexing (homogeneous array)
let first_score: Option<&DataType> = schema.type_at("scores[0]");
assert_eq!(first_score, Some(&DataType::Float64));

// Tuple indexing (heterogeneous)
let schema_with_tuple: Schema = /* has tuple[string, int64, bool] */;
let second_item: Option<&DataType> = schema_with_tuple.type_at("record[1]");
assert_eq!(second_item, Some(&DataType::Int64));

// Get field with metadata
let field: Option<&Field> = schema.field_at("age");
if let Some(f) = field {
    println!("nullable: {}, required: {}", f.nullable, f.required);
}

// Invalid path returns None
assert!(schema.type_at("nonexistent.path").is_none());

// Project to sub-schema
let sub_schema: Schema = schema.project(&["name", "career_batting.HR"])?;

// Compare schemas
let diff: SchemaDiff = old_schema.diff(&new_schema);
if diff.is_empty() {
    println!("Schemas are identical");
} else {
    for added in &diff.fields_added {
        println!("+ {}: {}", added.path, added.data_type.to_pretty());
    }
    for removed in &diff.fields_removed {
        println!("- {}", removed.path);
    }
    for changed in &diff.types_changed {
        println!("~ {}: {} -> {}",
            changed.path,
            changed.old_type.to_pretty(),
            changed.new_type.to_pretty());
    }
}

// Content-based fingerprint
let fp: SchemaFingerprint = schema.fingerprint();
println!("Schema fingerprint: {}", fp);  // e.g., "sha256:a1b2c3..."
assert_eq!(schema.fingerprint(), schema.fingerprint()); // stable
```

##### Load Options

```rust
use arbors_core::{LoadOptions, LoadValidation, OnError};
use arbors_io::read_json_with_options;

// Default: fail on first error
let opts = LoadOptions::default();
assert_eq!(opts.validation, LoadValidation::Absolute);

// No validation (fastest)
let opts = LoadOptions::new().validation(LoadValidation::Off);
let arbor = read_json_with_options(data, None, &opts)?;

// Collect errors, skip invalid trees
let opts = LoadOptions::new()
    .validation(LoadValidation::Strict)
    .on_error(OnError::Collect { max: Some(100) });

let result: LoadResult = read_json_with_options(data, Some(&schema), &opts)?;
println!("Loaded {} trees", result.arbor.num_trees());
println!("Skipped {} invalid trees", result.errors.len());
for err in &result.errors {
    println!("  Tree {}: {} at '{}'", err.tree_index, err.message, err.path);
}

// Lax mode: coerce types when possible, store null on failure
let opts = LoadOptions::new()
    .validation(LoadValidation::Lax)
    .on_error(OnError::Collect { max: Some(1000) });

let result: LoadResult = read_json_with_options(data, Some(&schema), &opts)?;
// "123" -> 123 when schema expects int64
// "abc" -> null (with warning) when schema expects int64

println!("Loaded {} trees", result.arbor.num_trees());
println!("Errors (tree skipped): {}", result.errors.len());
println!("Warnings (coercion issues): {}", result.warnings.len());

for warn in &result.warnings {
    // Lax mode: coercion failures and unexpected nulls become warnings
    println!("  Tree {}: {} at '{}'", warn.tree_index, warn.message, warn.path);
}
```

##### LoadResult Structure

```rust
/// Result of loading data with validation enabled.
/// Lives in arbors-core::load_result, produced by arbors-io.
pub struct LoadResult {
    /// Successfully loaded arbor
    pub arbor: Arbor,

    /// Errors (trees that were skipped in Strict mode)
    /// Empty in Absolute mode (first error aborts)
    /// Empty in Lax mode (failures become warnings, not errors)
    pub errors: Vec<LoadError>,

    /// Warnings (coercion failures, unexpected nulls, missing required in Lax mode)
    /// Empty in Strict and Absolute modes
    pub warnings: Vec<LoadWarning>,

    /// True if max_errors limit was reached (some issues not collected)
    pub truncated: bool,
}

pub struct LoadError {
    pub tree_index: usize,
    pub path: String,
    pub message: String,
    pub kind: LoadErrorKind,
}

pub struct LoadWarning {
    pub tree_index: usize,
    pub path: String,
    pub message: String,
    pub kind: LoadWarningKind,
}

pub enum LoadWarningKind {
    CoercionFailed,     // "abc" couldn't become int64
    UnexpectedNull,     // null in non-nullable field (Lax allows it)
    MissingRequired,    // required field missing (Lax fills with null)
}
```

##### Tuples (Heterogeneous)

```rust
use arbors_schema::{DataType, Schema, Field};

// Create a tuple type (heterogeneous, ≤12 elements)
let coordinate = DataType::Tuple {
    items: vec![DataType::Float64, DataType::Float64],
};

let person_record = DataType::Tuple {
    items: vec![DataType::String, DataType::Int64, DataType::Bool],
};

// In a schema
let schema = Schema::new(DataType::Object {
    fields: vec![
        Field::new("location", coordinate),
        Field::new("record", person_record),
    ],
});

// Pretty-print shows tuple syntax
println!("{}", schema.to_pretty());
// Output:
// object {
//   location: tuple[float64, float64]
//   record: tuple[string, int64, bool]
// }

// Navigation into tuples — each index has its own type
let x_type = schema.type_at("location[0]");
assert_eq!(x_type, Some(&DataType::Float64));

let name_type = schema.type_at("record[0]");
assert_eq!(name_type, Some(&DataType::String));

let age_type = schema.type_at("record[1]");
assert_eq!(age_type, Some(&DataType::Int64));
```

##### ArrayN (Homogeneous, SIMD-friendly)

```rust
use arbors_schema::{DataType, Schema, Field};

// Create an ArrayN (homogeneous, any size)
let embedding = DataType::ArrayN {
    element: Box::new(DataType::Float64),
    size: 768,
};

let rgb_color = DataType::ArrayN {
    element: Box::new(DataType::Int32),
    size: 3,
};

// In a schema
let schema = Schema::new(DataType::Object {
    fields: vec![
        Field::new("embedding", embedding),
        Field::new("color", rgb_color),
    ],
});

// Pretty-print shows compact syntax
println!("{}", schema.to_pretty());
// Output:
// object {
//   color: int32[3]
//   embedding: float64[768]
// }

// Navigation — any index returns the element type (all same)
let elem_type = schema.type_at("embedding[0]");
assert_eq!(elem_type, Some(&DataType::Float64));

let elem_type_500 = schema.type_at("embedding[500]");
assert_eq!(elem_type_500, Some(&DataType::Float64));  // Same type

// Storage maps to Arrow FixedSizeList (SIMD-friendly)
// Runtime: [f64; 768] in Rust, contiguous memory
```

##### Envelope Format

```rust
use arbors_io::{read_enveloped, write_enveloped};
use arbors_schema::Schema;

// Write arbor with embedded schema
let bytes: Vec<u8> = write_enveloped(&arbor, &schema)?;

// Envelope structure:
// {
//   "version": 1,
//   "schema": { ... native schema JSON ... },
//   "data": [ ... JSONL trees ... ]
// }

// Read back (schema extracted automatically)
let (arbor, schema): (Arbor, Schema) = read_enveloped(&bytes)?;

// Use the extracted schema for further validation
let registry = schema.compile()?;
```

---

#### Python API

##### Schema Creation and Serialization

```python
import arbors
from arbors import Schema, DataType, Field

# Create schema programmatically
schema = Schema(DataType.object({
    "name": DataType.string(),
    "age": DataType.int64().nullable(),
    "scores": DataType.array(DataType.float64()),
}))

# Serialize to JSON (for saving)
json_str: str = schema.to_json()
json_pretty: str = schema.to_json_pretty()

# Save to file
with open("schema.json", "w") as f:
    f.write(schema.to_json_pretty())

# Load from file
with open("schema.json") as f:
    schema = Schema.from_json(f.read())

# Use schema for parsing
arbor = arbors.read_json(data, schema=schema)
```

##### Schema Pretty-Printing

```python
from arbors import Schema, PrettyView

schema: Schema = ...

# Default pretty-print (Full view)
print(schema.to_pretty())
# Output:
# object {
#   name: string
#   age: int64?
#   scores: array<float64>
# }

# Summary view (compact)
print(schema.to_pretty(PrettyView.SUMMARY))
# Output: object { name, age?, scores }

# Diff-friendly view
print(schema.to_pretty(PrettyView.DIFF_FRIENDLY))

# __str__ uses Summary (for quick display)
print(str(schema))  # object { name, age?, scores }

# __repr__ uses Full (for debugging)
print(repr(schema))  # Full pretty output
```

##### Schema Inference

```python
import arbors
from arbors import InferredSchema

# Infer from JSONL bytes
data = b'''{"name": "Alice", "age": 30}
{"name": "Bob", "age": null}
{"name": "Carol", "age": 25}'''

inferred: InferredSchema = arbors.infer_schema(data)

# Access the schema
schema = inferred.schema
print(schema.to_pretty())

# Access diagnostics
print(f"Samples observed: {inferred.diagnostics.sample_count}")
print(f"Null rate for 'age': {inferred.diagnostics.null_rates.get('age', 0):.1%}")

# Check for widening events
for event in inferred.diagnostics.widening_events:
    print(f"Type widened at '{event['path']}': {event['from']} -> {event['to']}")

# Also works with string data
inferred = arbors.infer_schema('{"x": 1}\n{"x": 2}')

# Or list of dicts
inferred = arbors.infer_schema([{"x": 1}, {"x": 2}])
```

##### Round-Trip Workflow

```python
import arbors
from arbors import Schema

# Day 1: Infer schema from sample data and save
sample_data = b'{"id": 1, "name": "Alice"}\n{"id": 2, "name": "Bob"}'
inferred = arbors.infer_schema(sample_data)

with open("my_schema.json", "w") as f:
    f.write(inferred.schema.to_json_pretty())

print("Schema saved!")
print(inferred.schema.to_pretty())

# Day 2: Load schema and use for new data
with open("my_schema.json") as f:
    schema = Schema.from_json(f.read())

new_data = b'{"id": 3, "name": "Carol"}\n{"id": 4, "name": "Dan"}'
arbor = arbors.read_json(new_data, schema=schema)

print(f"Loaded {len(arbor)} records with validated schema")
```

##### Schema Navigation

```python
from arbors import Schema, DataType

schema: Schema = ...  # player schema

# Get type at a path
hr_type = schema.type_at("career_batting.HR")
assert hr_type == DataType.int64()

# Array indexing
first_score = schema.type_at("scores[0]")
assert first_score == DataType.float64()

# Tuple indexing
record_type = schema.type_at("record[1]")  # second element of tuple

# Get field with metadata
field = schema.field_at("age")
if field:
    print(f"nullable: {field.nullable}, required: {field.required}")

# Invalid path returns None
assert schema.type_at("nonexistent.path") is None

# Project to sub-schema
sub_schema = schema.project(["name", "career_batting.HR"])

# Compare schemas
diff = old_schema.diff(new_schema)
if not diff:
    print("Schemas are identical")
else:
    for added in diff.fields_added:
        print(f"+ {added.path}: {added.data_type}")
    for removed in diff.fields_removed:
        print(f"- {removed.path}")
    for changed in diff.types_changed:
        print(f"~ {changed.path}: {changed.old_type} -> {changed.new_type}")

# Content-based fingerprint
fp = schema.fingerprint()
print(f"Schema fingerprint: {fp}")
```

##### Load Options

```python
import arbors
from arbors import LoadOptions, LoadValidation

# Default: fail on first error
arbor = arbors.read_json(data, schema=schema)

# No validation (fastest)
opts = LoadOptions(validation=LoadValidation.OFF)
arbor = arbors.read_json(data, options=opts)

# Collect errors, skip invalid trees
opts = LoadOptions(
    validation=LoadValidation.STRICT,
    max_errors=100,
)
result = arbors.read_json(data, schema=schema, options=opts)
print(f"Loaded {len(result.arbor)} trees")
print(f"Skipped {len(result.errors)} invalid trees")
for err in result.errors:
    print(f"  Tree {err.tree_index}: {err.message} at '{err.path}'")

# Lax mode: coerce types when possible, store null on failure
opts = LoadOptions(
    validation=LoadValidation.LAX,
    max_errors=1000,  # also limits warnings
)
result = arbors.read_json(data, schema=schema, options=opts)
# "123" -> 123 when schema expects int64
# "abc" -> null (with warning) when schema expects int64

print(f"Loaded {len(result.arbor)} trees")
print(f"Errors: {len(result.errors)}")  # Empty in Lax mode (no tree skipping)
print(f"Warnings: {len(result.warnings)}")  # Coercion failures

for warn in result.warnings:
    # Lax mode: coercion failures and unexpected nulls become warnings
    print(f"  Tree {warn.tree_index}: {warn.message} at '{warn.path}'")
```

##### Tuples (Heterogeneous)

```python
from arbors import Schema, DataType

# Create tuple types (heterogeneous, ≤12 elements)
coordinate = DataType.tuple([DataType.float64(), DataType.float64()])
person_record = DataType.tuple([DataType.string(), DataType.int64(), DataType.bool()])

# In a schema
schema = Schema(DataType.object({
    "location": coordinate,
    "record": person_record,
}))

# Pretty-print shows tuple syntax
print(schema.to_pretty())
# Output:
# object {
#   location: tuple[float64, float64]
#   record: tuple[string, int64, bool]
# }

# Navigation into tuples — each index has its own type
x_type = schema.type_at("location[0]")
assert x_type == DataType.float64()

name_type = schema.type_at("record[0]")
assert name_type == DataType.string()

age_type = schema.type_at("record[1]")
assert age_type == DataType.int64()

# Runtime values are Python tuples
data = {"location": (1.5, 2.5), "record": ("Alice", 30, True)}
```

##### ArrayN (Homogeneous, NumPy-friendly)

```python
from arbors import Schema, DataType
import numpy as np

# Create ArrayN types (homogeneous, any size)
embedding = DataType.array_n(DataType.float64(), 768)
rgb_color = DataType.array_n(DataType.int32(), 3)

# In a schema
schema = Schema(DataType.object({
    "embedding": embedding,
    "color": rgb_color,
}))

# Pretty-print shows compact syntax
print(schema.to_pretty())
# Output:
# object {
#   color: int32[3]
#   embedding: float64[768]
# }

# Navigation — any index returns the element type
elem_type = schema.type_at("embedding[0]")
assert elem_type == DataType.float64()

elem_type_500 = schema.type_at("embedding[500]")
assert elem_type_500 == DataType.float64()  # Same type

# Runtime values: NumPy arrays (preferred) or lists
data = {
    "embedding": np.random.randn(768),  # NumPy for performance
    "color": [255, 128, 0],             # List also works
}

# Zero-copy interop with NumPy
arbor = arbors.read_json(json_data, schema=schema)
embedding_array = arbor[0]["embedding"].to_numpy()  # Returns np.ndarray, shape (768,)

# SIMD-friendly operations
dot_product = np.dot(embedding_array, other_embedding)
cosine_sim = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
```

##### Envelope Format

```python
import arbors
from arbors import Schema

# Write arbor with embedded schema
bytes_data = arbors.write_enveloped(arbor, schema)

# Read back (schema extracted automatically)
arbor, schema = arbors.read_enveloped(bytes_data)

# Use the extracted schema
print(schema.to_pretty())
```

---

#### API Summary Table

| Feature | Rust | Python |
|---------|------|--------|
| **Pretty-print** | `schema.to_pretty()` | `schema.to_pretty()` |
| **Pretty with options** | `schema.to_pretty_with(&opts)` | `schema.to_pretty(view)` |
| **Infer schema** | `infer_schema(data)?` | `arbors.infer_schema(data)` |
| **Schema to JSON** | `schema.to_json()` | `schema.to_json()` |
| **Schema from JSON** | `Schema::from_json(&json)?` | `Schema.from_json(json)` |
| **Type at path** | `schema.type_at("a.b[0]")` | `schema.type_at("a.b[0]")` |
| **Field at path** | `schema.field_at("a.b")` | `schema.field_at("a.b")` |
| **Project** | `schema.project(&["a", "b"])?` | `schema.project(["a", "b"])` |
| **Diff** | `old.diff(&new)` | `old.diff(new)` |
| **Fingerprint** | `schema.fingerprint()` | `schema.fingerprint()` |
| **Load with options** | `read_json_with_options(...)` | `read_json(..., options=opts)` |
| **Write envelope** | `write_enveloped(&arbor, &schema)?` | `arbors.write_enveloped(arbor, schema)` |
| **Read envelope** | `read_enveloped(data)?` | `arbors.read_enveloped(data)` |

#### Type Summary Table

| Type | Rust | Python | Use Case |
|------|------|--------|----------|
| **Tuple** | `DataType::Tuple { items }` | `DataType.tuple([...])` | Heterogeneous, ≤12 elements |
| **ArrayN** | `DataType::ArrayN { element, size }` | `DataType.array_n(elem, n)` | Embeddings, SIMD vectors |
| **Array** | `DataType::Array(Box<T>)` | `DataType.array(T)` | Variable-length homogeneous |
| **Object** | `DataType::Object { fields }` | `DataType.object({...})` | Named fields |

| Type | Pretty Syntax | JSON Schema | Arrow Mapping | Runtime (Python) |
|------|---------------|-------------|---------------|------------------|
| **Tuple** | `tuple[string, int64]` | `prefixItems` | Struct | `tuple` |
| **ArrayN** | `float64[768]` | `items` + `minItems`/`maxItems` | FixedSizeList | `np.ndarray` |
| **Array** | `array<string>` | `items` | List | `list` |

---

### 17.2.2 Definitive Symbol Inventory

#### 17.2.2.1 New crates (if any)

None. All work extends existing crates.

#### 17.2.2.2 New files (if any)

| File | Purpose |
|------|---------|
| `crates/arbors-schema/src/pretty.rs` | Schema pretty-printing |
| `crates/arbors-schema/src/navigation.rs` | Path-based schema operations |
| `crates/arbors-io/src/envelope.rs` | Schema+data envelope read/write functions |

> **Note:** Load options, result types, and coercion primitives already exist in `arbors-validate`.
> No new files needed in `arbors-core`. See Step 6 revision notes.

#### 17.2.2.3 Symbols to add / modify

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `PrettyView` | enum | `arbors-schema::pretty` | Summary, Full, DiffFriendly |
| `PrettyOptions` | struct | `arbors-schema::pretty` | Pretty-print configuration |
| `Schema::to_pretty` | method | `arbors-schema::native_types` | Human-readable output |
| `Schema::to_pretty_with` | method | `arbors-schema::native_types` | With options |
| `DataType::to_pretty` | method | `arbors-schema::native_types` | Type pretty-print |
| `InferenceDiagnostics` | struct | `arbors-schema::inference` | Inference metadata |
| `WideningEvent` | struct | `arbors-schema::inference` | Type widening record |
| `InferredSchema` | struct | `arbors-schema::inference` | Schema + diagnostics |
| `infer_schema` | fn | `arbors-schema` | Standalone inference |
| `infer_schema_from_values` | fn | `arbors-schema` | From JSON values |
| `ValidationPolicy::Off` | variant | `arbors-validate::options` | NEW: No schema checking mode |
| `ValidationPolicy` | enum | `arbors-validate::options` | EXISTING: Off, Absolute, Strict, Lax |
| `ValidationOptions` | struct | `arbors-validate::options` | EXISTING: Unified load config |
| `coerce_string_to_int` | fn | `arbors-validate::coerce` | EXISTING: Coerce string to i64 |
| `coerce_string_to_float` | fn | `arbors-validate::coerce` | EXISTING: Coerce string to f64 |
| `coerce_string_to_date` | fn | `arbors-validate::coerce` | EXISTING: Coerce string to date |
| `coerce_string_to_datetime` | fn | `arbors-validate::coerce` | EXISTING: Coerce string to datetime |
| `coerce_string_to_duration` | fn | `arbors-validate::coerce` | EXISTING: Coerce string to duration |
| `coerce_string_to_binary` | fn | `arbors-validate::coerce` | EXISTING: Coerce base64 to binary |
| `coerce_int_to_float` | fn | `arbors-validate::coerce` | EXISTING: Coerce int to float |
| `read_json_with_options` | fn | `arbors-io` | NEW: Parse with ValidationOptions |
| `read_jsonl_with_options` | fn | `arbors-io` | NEW: Parse JSONL with ValidationOptions |
| `Schema::type_at` | method | `arbors-schema::navigation` | Path lookup |
| `Schema::field_at` | method | `arbors-schema::navigation` | Field lookup |
| `Schema::project` | method | `arbors-schema::navigation` | Sub-schema creation |
| `Schema::diff` | method | `arbors-schema::navigation` | Schema comparison |
| `SchemaDiff` | struct | `arbors-schema::navigation` | Diff result |
| `SchemaFingerprint` | struct | `arbors-schema::navigation` | Content hash |
| `Schema::fingerprint` | method | `arbors-schema::navigation` | Compute hash |
| `DataType::Tuple` | variant | `arbors-schema::native_types` | Heterogeneous fixed-length |
| `DataType::ArrayN` | variant | `arbors-schema::native_types` | Homogeneous fixed-length (SIMD) |
| `Schema::compile` | method | `arbors-schema::native_types` | Compile to SchemaRegistry |
| `Schema::from_json` | method | `arbors-schema::serialization` | Deserialize native schema |
| `read_enveloped` | fn | `arbors-io` | Read schema+data |
| `write_enveloped` | fn | `arbors-io` | Write schema+data |
| `CollectionValidationResult` | struct | `arbors-validate::result` | EXISTING: Arbor + errors + warnings |
| `TreeValidationResult` | struct | `arbors-validate::result` | EXISTING: Single tree result |
| `ValidationError` | struct | `arbors-validate::error` | EXISTING: Error with paths |
| `ValidationErrorKind` | enum | `arbors-validate::error` | EXISTING: TypeMismatch, etc. |
| `ValidationWarning` | struct | `arbors-validate::error` | EXISTING: Warning (Lax mode) |

---

### 17.2.3 Test Plan

#### 17.2.3.1 Unit tests

**Pretty-printing:**
- [x] `test_pretty_primitive_types` — int64, string, etc. render correctly
- [x] `test_pretty_array_type` — `array<string>` format
- [x] `test_pretty_object_type` — nested field display
- [x] `test_pretty_summary_view` — concise overview
- [x] `test_pretty_full_view` — complete tree
- [x] `test_pretty_diff_friendly_view` — one item per line
- [x] `test_pretty_max_depth` — truncation at depth limit
- [x] `test_pretty_nullable_markers` — `?` for nullable
- [x] `test_pretty_deterministic` — same input = same output

**Inference:**
- [ ] `test_infer_schema_basic` — simple object inference
- [ ] `test_infer_schema_diagnostics` — diagnostics populated
- [ ] `test_infer_widening_int_to_float` — widening captured
- [ ] `test_infer_null_rates` — null percentage computed
- [ ] `test_infer_confidence_scores` — confidence varies with samples

**ValidationOptions (in arbors-validate — most already exist):**
- [x] `test_validation_options_default` — sensible defaults (EXISTING)
- [x] `test_validation_options_strict` — strict mode (EXISTING)
- [x] `test_validation_options_lax` — lax mode (EXISTING)
- [x] `test_validation_options_builder_max_errors` — max errors (EXISTING)
- [ ] `test_validation_options_off` — no validation fast path (NEW)

**Coercion primitives (in arbors-validate — all already exist):**
- [x] `test_coerce_string_to_int_*` — comprehensive int coercion tests (EXISTING)
- [x] `test_coerce_string_to_float_*` — comprehensive float coercion tests (EXISTING)
- [x] `test_coerce_int_to_float_*` — int→float widening tests (EXISTING)
- [x] `test_coerce_string_to_date_*` — ISO date parsing tests (EXISTING)
- [x] `test_coerce_string_to_datetime_*` — ISO datetime parsing tests (EXISTING)
- [x] `test_coerce_string_to_duration_*` — ISO duration parsing tests (EXISTING)
- [x] `test_coerce_string_to_binary_*` — base64 decode tests (EXISTING)

**Lax null semantics (in arbors-io — parser integration):**
- [ ] `test_lax_coercion_failure_becomes_null` — "abc" in int64 field → null
- [ ] `test_lax_null_ignores_nullable_false` — null stored despite nullable=false
- [ ] `test_lax_coercion_failure_warning` — warning added, not error
- [ ] `test_strict_null_respects_nullable` — null in non-nullable → error
- [ ] `test_absolute_null_respects_nullable` — null in non-nullable → abort

**Navigation:**
- [x] `test_type_at_simple_path` — `"field"` works
- [x] `test_type_at_nested_path` — `"a.b.c"` works
- [x] `test_type_at_array_index` — `"items[0]"` works
- [x] `test_type_at_invalid_path` — returns None
- [x] `test_field_at_with_metadata` — gets nullable/required
- [x] `test_project_subset` — sub-schema created
- [x] `test_diff_identical` — empty diff for same schema
- [x] `test_diff_field_added` — detects additions
- [x] `test_diff_field_removed` — detects removals
- [x] `test_diff_type_changed` — detects type changes
- [x] `test_fingerprint_stable` — same schema = same hash
- [x] `test_fingerprint_different` — different schema = different hash

**Tuple type:**
- [x] `test_tuple_type_creation` — `DataType::Tuple` works
- [x] `test_tuple_type_pretty` — `tuple[int64, string]` format
- [x] `test_tuple_to_storage` — maps to StorageType::Tuple
- [x] `test_tuple_from_storage` — returns None (containers require registry)
- [x] `test_tuple_compatibility` — various compatibility tests

**Envelope:**
- [ ] `test_envelope_roundtrip` — write then read
- [ ] `test_envelope_version` — version field present
- [ ] `test_envelope_schema_preserved` — schema intact
- [ ] `test_envelope_data_preserved` — data intact

#### 17.2.3.2 Integration tests

- [ ] `test_pretty_print_complex_schema` — real-world schema renders well
- [ ] `test_infer_then_validate` — infer schema, validate data
- [ ] `test_load_with_options` — end-to-end load with options
- [ ] `test_navigation_on_inferred` — navigate inferred schema
- [ ] `test_envelope_with_validation` — read envelope, validate

#### 17.2.3.3 Golden / contract tests

- [ ] `test_pretty_output_golden` — golden file for pretty output format
- [ ] `test_envelope_format_golden` — golden file for envelope JSON structure
- [ ] `test_diff_output_golden` — golden file for diff format

---

### 17.2.4 Documentation Plan

- [ ] Update `docs/API.md` with schema pretty-printing examples
- [ ] Add inference diagnostics documentation
- [ ] Document LoadOptions and validation modes
- [ ] Add schema navigation cookbook
- [ ] Create envelope format specification
- [ ] Update Python docstrings for new methods

---

### 17.2.5 Execution Steps

> **Ordering rationale:** Steps 1-5 work entirely in the native `Schema` world and don't require touching parser internals. Step 6 (LoadOptions) is where the real complexity lives—it touches the parser and can be done incrementally (Off/Absolute first, Strict/Lax later). Python bindings are interleaved throughout, with final polish in Step 7.

#### Step 1: Schema Pretty-Printing

**Commit:** `feat(schema): add human-first pretty-printing for Schema and DataType`

**References:**
- Decision: Schema Pretty-Printing (17.2.0)
- Specification: Public API Surface (17.2.1.7)
- Symbol Inventory: PrettyView, PrettyOptions (17.2.2.3)

**Tasks:**
- [x] Create `crates/arbors-schema/src/pretty.rs`
- [x] Implement `PrettyView` enum
- [x] Implement `PrettyOptions` struct with builder pattern
- [x] Implement `DataType::to_pretty()` and `to_pretty_with()`
- [x] Implement `Schema::to_pretty()` and `to_pretty_with()`
- [x] Handle all DataType variants including arrays and objects
- [x] Add stable field ordering (alphabetical)
- [x] Export from `arbors-schema::lib.rs`
- [x] Add re-exports to `arbors` crate

**Unit Tests:**
- [x] `test_pretty_primitive_types`
- [x] `test_pretty_array_type`
- [x] `test_pretty_object_type`
- [x] `test_pretty_summary_view`
- [x] `test_pretty_full_view`
- [x] `test_pretty_diff_friendly_view`
- [x] `test_pretty_deterministic`
- [x] Additional tests: `test_pretty_nested_array`, `test_pretty_max_depth`, `test_pretty_max_depth_zero`, `test_pretty_nullable_markers`, `test_pretty_hide_nullable`, `test_pretty_custom_indent`, `test_pretty_complex_schema`, `test_pretty_object_empty`, `test_pretty_full_nested_object`, `test_schema_to_pretty`, `test_schema_to_pretty_with`, `test_schema_primitive_root`, `test_schema_array_root`, `test_pretty_options_default`, `test_pretty_options_builder`, `test_pretty_view_default`

**Checkpoint:** `cargo test -p arbors-schema pretty` ✓ (25 tests passed)

---

#### Step 2: Tuple and ArrayN as First-Class DataTypes

**Commit:** `feat(schema): add DataType::Tuple and DataType::ArrayN`

**References:**
- Decision: Tuples: Heterogeneous Fixed-Length Arrays (17.2.0)
- Decision: ArrayN: Homogeneous Fixed-Length Arrays (17.2.0)
- Decision: Tuple vs ArrayN comparison (17.2.0)
- Specification: DataType variants (17.2.2.3)

**Tasks — Tuple (heterogeneous, ≤12 elements):**
- [x] Add `DataType::Tuple { items: Vec<DataType> }` variant
- [x] Update `DataType::to_storage_type()` for Tuple
- [x] Update `DataType::from_storage_type()` for Tuple (returns None, requires registry)
- [x] Add `type_str::TUPLE = "tuple"`
- [x] Update `FromStr` implementation for "tuple"
- [x] Update `Display` to show `tuple[int64, string, ...]`
- [x] Update `to_pretty()` for tuples (from Step 1)
- [x] Update JSON serialization: `{"type": "tuple", "items": [...]}`
- [x] Document tuple size guideline (≤12 recommended, no hard limit) — in docstrings

**Tasks — ArrayN (homogeneous, schema-level only in 17.2):**
- [x] Add `DataType::ArrayN { element: Box<DataType>, size: usize }` variant
- [x] Update `DataType::to_storage_type()` for ArrayN → regular Array (deferred: FixedSizeList)
- [x] Add `type_str::ARRAY_N = "array_n"`
- [x] Update `FromStr` implementation for "array_n"
- [x] Update `Display` to show `float64[768]`
- [x] Update `to_pretty()` to show `float64[768]`
- [x] Update JSON serialization: `{"type": "array_n", "element": {...}, "size": 768}`
- [ ] Validate element type is primitive (no nested objects) — deferred with storage optimization

> **Note:** Storage optimization (Arrow FixedSizeList, SIMD) deferred to Phase 17.x per ArrayN Scope decision.

**Tasks — Shared:**
- [x] Update compatibility checks for both types
- [ ] Update navigation: `type_at("field[n]")` semantics differ (tuple: nth type, array_n: element type) — deferred to Step 3

**Unit Tests — Tuple:**
- [x] `test_tuple_type_creation` — `test_tuple_type_name`, `test_tuple_is_container`
- [x] `test_tuple_type_display` — `test_tuple_display`
- [x] `test_tuple_type_pretty` — `test_pretty_tuple_type`, `test_pretty_tuple_heterogeneous`, etc.
- [x] `test_tuple_to_storage` — `test_tuple_to_storage_type`
- [x] `test_tuple_from_storage` — from_storage_type returns None for containers
- [x] `test_tuple_json_roundtrip` — `test_tuple_roundtrip`, `test_tuple_in_schema`
- [x] `test_tuple_compatibility` — `test_tuple_compatible_with_same_structure`, `test_tuple_compatible_with_widening`, `test_tuple_incompatible_different_length`, `test_tuple_incompatible_different_types`
- [ ] `test_tuple_navigation_by_index` — `type_at("[0]")` returns first element type — deferred to Step 3
- [x] `test_tuple_large` — tuples with >12 elements work (no hard limit, just tests)

**Unit Tests — ArrayN:**
- [x] `test_array_n_creation` — `test_array_n_type_name`, `test_array_n_is_container`
- [x] `test_array_n_display` — `test_array_n_display` shows `float64[768]`
- [x] `test_array_n_pretty` — `test_pretty_array_n_type`, `test_pretty_array_n_small`, etc.
- [x] `test_array_n_to_storage` — `test_array_n_to_storage_type` — maps to regular Array (FixedSizeList deferred)
- [x] `test_array_n_json_roundtrip` — `test_array_n_roundtrip`, `test_array_n_in_schema`
- [x] `test_array_n_large` — 768 sizes tested
- [ ] `test_array_n_navigation` — any index returns element type — deferred to Step 3
- [x] `test_array_n_element_types` — tests use float64 and int64 elements

**Checkpoint:** `cargo test -p arbors-schema` ✓ (587 tests passed)

---

#### Step 3: Schema Navigation

**Commit:** `feat(schema): add path-based schema navigation`

**References:**
- Decision: Schema Navigation (17.2.0)
- Decision: Field Naming: No Dots Allowed (17.2.0)
- Decision: Path Syntax: Bracket Escaping (17.2.0)
- Specification: type_at, field_at, project, diff (17.2.1.7)
- Symbol Inventory: navigation module (17.2.2.2)

**Tasks:**
- [x] Create `crates/arbors-schema/src/navigation.rs`
- [x] Implement path parser supporting:
  - Dot notation: `a.b.c`
  - Array/tuple indices: `items[0]`
  - Quoted field names: `a["field.with.dots"]` or `a['field[0]']`
- [x] Add field name validation: reject names containing `.` (schema-guided only)
- [x] Update `Schema::validate()` to check field names — `validate_field_names()` added
- [x] Implement `Schema::type_at(path)` → `Option<&DataType>`
- [x] Implement `Schema::field_at(path)` → `Option<&Field>`
- [x] Implement `SchemaDiff` struct
- [x] Implement `Schema::diff(&other)` → `SchemaDiff`
- [x] Implement `SchemaFingerprint` struct
- [x] Implement `Schema::fingerprint()` → `SchemaFingerprint`
- [x] Implement `Schema::project(paths)` → `Result<Schema>`
- [x] Export from `arbors-schema`

**Unit Tests:**
- [x] `test_field_name_rejects_dots` — `"foo.bar"` rejected with clear error
- [x] `test_field_name_allows_underscores` — `"foo_bar"` accepted
- [x] `test_type_at_simple_path` — `"field"` works
- [x] `test_type_at_nested_path` — `"a.b.c"` works
- [x] `test_type_at_array_index` — `"items[0]"` works
- [x] `test_type_at_quoted_field` — `a["field.with.dots"]` works
- [x] `test_type_at_quoted_brackets` — `a["field[0]"]` works (field name contains brackets) — `test_parse_quoted_single`
- [x] `test_type_at_single_quotes` — `a['field']` works — `test_parse_quoted_single`
- [x] `test_type_at_invalid_path` — returns None
- [x] `test_field_at_with_metadata` — gets nullable/required
- [x] `test_diff_identical` — empty diff for same schema
- [x] `test_diff_field_added` — detects additions
- [x] `test_diff_field_removed` — detects removals
- [x] `test_diff_type_changed` — detects type changes
- [x] `test_fingerprint_stable` — same schema = same hash
- [x] `test_fingerprint_different` — different schema = different hash — `test_fingerprint_different_schemas`

**Checkpoint:** `cargo test -p arbors-schema navigation` ✓

---

#### Step 4: Inference Diagnostics

**Commit:** `feat(schema): add inference diagnostics and InferredSchema`

**References:**
- Decision: Schema Inference API (17.2.0)
- Decision: Canonical Schema Representation (17.2.0)
- Specification: InferenceDiagnostics, WideningEvent (17.2.2.3)
- Test Plan: Inference tests (17.2.3.1)

**Tasks:**
- [x] Add `InferenceDiagnostics` struct to `inference.rs`
- [x] Add `WideningEvent` struct with path (dot notation)
- [x] Add `InferredSchema` struct combining native `Schema` + diagnostics
- [x] Modify `InferenceCompiler` to track diagnostics
- [x] Track widening events when types are promoted
- [x] Compute null rates per path
- [x] Compute confidence scores
- [x] Add `infer_schema_with_diagnostics()` standalone function
- [x] Return native `Schema` (not `SchemaRegistry`)
- [x] Verify inferred `Schema` works with `to_json_pretty()` / `from_json()` round-trip
- [x] Export new types from `arbors-schema`

**Unit Tests:**
- [x] `test_infer_schema_basic`
- [x] `test_infer_schema_diagnostics`
- [x] `test_infer_widening_int_to_float`
- [x] `test_infer_null_rates`
- [x] `test_infer_confidence_scores`
- [x] `test_infer_save_load_roundtrip` — infer → to_json → from_json → verify

**Checkpoint:** `cargo test -p arbors-schema infer` ✓ (61 tests passed)

---

#### Step 5: Schema+Data Envelope Format

**Commit:** `feat(io): add schema+data envelope format`

**References:**
- Decision: Schema-Data Envelope (17.2.0)
- Decision: Envelope Schema Payload (17.2.0)
- Decision: Canonical Schema Representation (17.2.0)
- Specification: read_enveloped, write_enveloped (17.2.1.7)

> **Note:** The envelope format is fundamentally an IO concern, so `read_enveloped`/`write_enveloped` live in `arbors-io`. The envelope struct definition could optionally live in `arbors-schema` for reuse, but the functions belong in IO.

**Tasks:**
- [x] Implement `Schema::compile() -> Result<SchemaRegistry>` (bridge to compiled form)
- [x] Ensure `Schema::from_json()` works for native schema format
- [x] Create `crates/arbors-io/src/envelope.rs`
- [x] Define envelope JSON structure: `{ version, schema, data }`
- [x] Implement `write_enveloped(arbor, schema) -> Vec<u8>`
- [x] Implement `read_enveloped(data) -> Result<(Arbor, Schema)>`
- [x] Add version compatibility check
- [x] Export from `arbors-io`

**Unit Tests:**
- [x] `test_envelope_roundtrip_simple_object` — single object round-trip
- [x] `test_envelope_roundtrip_multiple_trees` — JSONL round-trip
- [x] `test_envelope_roundtrip_empty_arbor` — empty arbor round-trip
- [x] `test_envelope_roundtrip_nested_object` — nested object round-trip
- [x] `test_envelope_roundtrip_array` — array field round-trip
- [x] `test_envelope_version_check` — unsupported version error
- [x] `test_envelope_missing_version` — missing version error
- [x] `test_envelope_missing_schema` — missing schema error
- [x] `test_envelope_missing_data` — missing data error
- [x] `test_envelope_invalid_json` — invalid JSON error

**Checkpoint:** `cargo test -p arbors-io envelope` ✓ (10 tests passed)

---

#### Step 6: Unified Load Options with Polars-Style Coercion

**Commit:** `feat(io): integrate ValidationOptions with during-parse coercion`

**References:**
- Decision: Unified Load Options (17.2.0)
- Decision: LoadOptions Semantics (17.2.0)
- Decision: Coercion: During Parse, Like Polars (17.2.0)
- Decision: Lax Null Semantics (17.2.0)
- Decision: Lax Null Representation: Typed Pool Null (17.2.0)
- Decision: Missing Required Field in Lax: Warning + Null (17.2.0)
- Specification: LoadValidation, OnError, LoadOptions (17.2.1.7)

> **REVISED APPROACH:** Use existing `arbors-validate` infrastructure instead of duplicating
> types in `arbors-core`. The original plan assumed a dependency cycle, but investigation
> revealed that `arbors-validate` only uses `arbors-io` in test modules, so the dependency
> should be a dev-dependency. This allows `arbors-io` to depend on `arbors-validate`.
>
> **Existing infrastructure in `arbors-validate`:**
> - `ValidationPolicy` enum (Absolute, Strict, Lax) — needs `Off` variant
> - `ValidationOptions` struct with full builder pattern
> - `ValidationError`, `ValidationErrorKind`, `ValidationWarning`
> - `TreeValidationResult`, `CollectionValidationResult`
> - All coercion functions in `coerce.rs`:
>   - `coerce_string_to_int`, `coerce_string_to_float`, `coerce_int_to_float`
>   - `coerce_string_to_date`, `coerce_string_to_datetime`, `coerce_string_to_duration`
>   - `coerce_string_to_binary`, `CoercedValue` enum
> - Comprehensive test coverage (already passing)

**Tasks — Dependency Fix:**
- [x] Move `arbors-io` from `[dependencies]` to `[dev-dependencies]` in `arbors-validate/Cargo.toml`
- [x] Add `arbors-validate` to `arbors-io/Cargo.toml` `[dependencies]`
- [x] Verify: `cargo build -p arbors-validate -p arbors-io` succeeds
- [x] Verify: `cargo test -p arbors-validate` still passes (tests use dev-dependency)

**Tasks — Add ValidationPolicy::Off:**
- [x] Add `Off` variant to `ValidationPolicy` enum in `arbors-validate/src/options.rs`
- [x] Add `ValidationOptions::off()` constructor
- [x] Add `is_off()` helper method
- [x] Update `Display` impl for `Off` → "off"
- [x] Update `errors_are_fatal()` to return false for Off
- [x] Update match statements in tree_validator.rs and collection_validator.rs

**Tasks — Parser Integration:**
- [x] Update `arbors-io` to import from `arbors-validate`:
  - `ValidationPolicy`, `ValidationOptions`
  - `ValidationError`, `ValidationWarning`
  - `CollectionValidationResult`, `CollectionValidator`
- [x] Re-export validation types from `arbors-io` for convenience
- [x] Add `read_json_with_options()` function accepting `ValidationOptions`
- [x] Add `read_jsonl_with_options()` function accepting `ValidationOptions`
- [x] Implement `Off`: skip all schema checking (fastest path)
- [x] Implement `Absolute`: use schema-guided parsing, return valid result
- [x] Implement `Strict`: parse schemaless, then validate post-hoc, skip invalid trees
- [x] Implement `Lax`: parse schemaless, then validate post-hoc, convert errors to warnings
- [ ] Wire coercion calls at value storage points in parser (deferred to future work)

> **Note:** During-parse coercion is deferred. Current implementation uses post-parse
> validation for Strict/Lax modes. This provides correct semantics but not optimal
> performance for coercion scenarios. Future work can integrate coercion into the parser.

**Unit Tests — ValidationPolicy::Off:**
- [x] `test_validation_policy_off_display` — displays "off"
- [x] `test_validation_options_off` — `ValidationOptions::off()` works
- [x] `test_validation_options_is_off` — `is_off()` helper works
- [x] `test_validation_options_errors_are_fatal` — Off returns false

**Unit Tests — Parser Integration:**
- [x] `test_read_json_with_options_off` — no schema checking
- [x] `test_read_json_with_options_absolute` — valid parse
- [x] `test_read_json_with_options_strict_valid` — valid data accepted
- [x] `test_read_json_with_options_strict_invalid` — invalid tree rejected, error collected
- [x] `test_read_json_with_options_lax` — invalid data accepted, error → warning
- [x] `test_read_jsonl_with_options_off` — no schema checking for JSONL
- [x] `test_read_jsonl_with_options_strict_mixed` — mixed valid/invalid trees

**Checkpoint:** `cargo test -p arbors-validate -p arbors-io` ✓ (53 + 430 tests passed)

---

#### Step 7: Python Bindings

**Commit:** `feat(python): add schema ergonomics to Python bindings`

**References:**
- Decision: Canonical Schema Representation (17.2.0)
- Decision: Python Schema Refactor: Lazy Compilation (17.2.0)
- Specification: Python API Surface (17.2.1.7)

> **Note:** This step is larger than it looks. Today Python `Schema` wraps compiled `SchemaRegistry`. Changing to wrap native `Schema` requires lazy compilation + caching. Plan for this to be a mini-project with possible compatibility shims.

**Tasks:**
- [ ] **Schema refactor (core work):**
  - [ ] Change Python `Schema` to hold native `Arc<Schema>` + `OnceCell<SchemaRegistry>`
  - [ ] Implement lazy compilation on first IO use
  - [ ] Cache compiled form for reuse
  - [ ] Maintain backward compatibility for `Schema.root`, `Schema.get_field`, etc.
  - [ ] Add migration shims if needed for APIs that exposed `SchemaRegistry` internals
- [ ] **New Python APIs:**
  - [ ] Add `PrettyView` enum to Python
  - [ ] Add `Schema.to_pretty(view)` method
  - [ ] Update `Schema.__str__` to use SUMMARY view
  - [ ] Update `Schema.__repr__` to use FULL view
  - [ ] Add `Schema.compile()` method (returns opaque compiled form for IO)
  - [ ] Add `InferenceDiagnostics` class
  - [ ] Add `InferredSchema` class
  - [ ] Add `arbors.infer_schema()` function
  - [ ] Add `LoadOptions` class
  - [ ] Update `read_json()` to accept `LoadOptions`
  - [ ] Add `Schema.type_at()` method
  - [ ] Add `Schema.field_at()` method
  - [ ] Add `Schema.diff()` method
  - [ ] Add `Schema.fingerprint()` method
- [ ] Update Python stub files (.pyi)

**Unit Tests:**
- [ ] `test_python_infer_schema` — `arbors.infer_schema()` returns InferredSchema
- [ ] `test_python_schema_to_json_roundtrip` — `schema.to_json()` → `Schema.from_json()`
- [ ] `test_python_infer_save_load_use` — infer → save → load → parse (full workflow)
- [ ] `test_python_pretty_print` — `schema.to_pretty()` works
- [ ] `test_python_load_options` — `LoadOptions` accepted by `read_json()`
- [ ] `test_python_schema_navigation` — `type_at()`, `field_at()`, `diff()`
- [ ] `test_python_schema_lazy_compilation` — verify compilation only happens once
- [ ] `test_python_schema_backward_compat` — existing APIs still work

**Checkpoint:** `make python-test` ✓

---

#### Step 7 Addendum: Inference Schema Threading Issue

**Problem Discovered During Implementation:**

The Python Schema refactor (changing from wrapping `SchemaRegistry` to wrapping native `Schema`) exposed a fundamental issue in the inference workflow:

1. **Current Rust inference workflow:**
   - `read_jsonl_infer_schema()` calls `InferenceCompiler::observe()` for ALL sample rows
   - `compiler.finish()` returns `SchemaRegistry` (compiled form)
   - `SchemaRegistry` is attached to the `Arbor`
   - The native `Schema` is never stored—only the compiled form exists

2. **Python binding requirement:**
   - Python `Schema` now wraps native `arbors_schema::Schema` (per Canonical Schema decision)
   - When returning inferred schema to Python, we need native `Schema`, not `SchemaRegistry`

3. **Broken workaround (DO NOT USE):**
   - Re-infer schema by walking only the first tree's node structure
   - This loses critical inference information:
     - Nullable detection (null values in later rows)
     - Field union (fields present in some rows but not others)
     - Type widening (int in row 1, float in row 2)
   - Results in failing tests: `test_type_widening_nullable`, `test_field_union_during_inference`

**Proper Solution: Thread Native Schema Through Inference**

The `InferenceCompiler` already has `finish_with_diagnostics()` which returns `InferredSchema`:

```rust
pub struct InferredSchema {
    pub schema: Schema,  // The native Schema we need!
    pub diagnostics: InferenceDiagnostics,
}
```

**Implementation approach:**

1. **Create new return types for inference functions:**
   ```rust
   // In arbors-io
   pub struct InferenceResult {
       pub arbor: Arbor,
       pub schema: Schema,  // Native schema from all observed rows
       pub diagnostics: InferenceDiagnostics,
   }

   pub fn read_json_infer_schema(json: &[u8]) -> Result<InferenceResult>
   pub fn read_jsonl_infer_schema(jsonl: &[u8], sample_count: Option<usize>) -> Result<InferenceResult>
   ```

2. **Modify inference functions:**
   - Use `compiler.finish_with_diagnostics()` instead of `compiler.finish()`
   - Extract native `Schema` and `InferenceDiagnostics` from `InferredSchema`
   - Compile `Schema` to `SchemaRegistry` for arbor attachment
   - Return `InferenceResult` containing all three: arbor, native schema, diagnostics

3. **Update Python bindings:**
   - `read_json_infer_schema()` extracts `schema` from `InferenceResult`
   - `read_jsonl_infer_schema()` extracts `schema` from `InferenceResult`
   - Remove the broken `infer_json_schema_from_arbor()` function
   - Optionally expose `InferenceDiagnostics` to Python (bonus feature)

**Implementation tasks (to add to Step 7):**
- [x] Create `InferenceResult` struct in `arbors-io`
- [x] Modify `read_json_infer_schema()` to use `finish_with_diagnostics()`
- [x] Modify `read_jsonl_infer_schema()` to use `finish_with_diagnostics()`
- [x] Update Python `read_json_infer_schema()` to use native Schema from result
- [x] Update Python `read_jsonl_infer_schema()` to use native Schema from result
- [x] Remove `infer_json_schema_from_arbor()` helper function
- [x] Verify: `test_type_widening_nullable` passes
- [x] Verify: `test_field_union_during_inference` passes

**Re-export consideration:**
The `InferenceResult` type should be re-exported from the `arbors` crate for user convenience.

---

### 17.2.6 Deliverables and Checkpoints

**Deliverable:** A comprehensive schema ergonomics layer providing human-first pretty-printing, standalone inference with diagnostics, unified load options, navigation APIs, first-class tuples, and envelope format, making schemas a first-class, ergonomic experience in both Rust and Python.

**Integration Tests:**
- [x] `test_pretty_print_complex_schema` — real-world schema renders correctly
- [x] `test_infer_save_load_use` — infer → save to JSON → load → use for parsing (full round-trip)
- [x] `test_infer_then_validate` — complete workflow
- [x] `test_load_with_options` — options respected end-to-end
- [x] `test_navigation_on_inferred` — navigate inferred schema
- [x] `test_envelope_with_validation` — full envelope workflow
- [x] `test_python_schema_workflow` — Python end-to-end

| Checkpoint | Verification |
|------------|--------------|
| Pretty-printing works | `schema.to_pretty()` produces readable output |
| Inference diagnostics available | `InferredSchema.diagnostics` populated |
| Schema round-trip works | `infer` → `to_json` → `from_json` → `compile` → parse succeeds |
| Load options integrated | `read_json_with_options()` accepts `ValidationOptions` |
| Navigation works | `schema.type_at("player.stats[0]")` returns correct type |
| Tuples are first-class | `DataType::Tuple` works end-to-end |
| Envelope format works | Round-trip preserves schema and data |
| Python bindings complete | All new APIs exposed to Python |
| Unit tests pass | `cargo test -p arbors-schema -p arbors-validate` |
| Python tests pass | `make python-test` |
| Full suite passes | `make test` |

**Commit after all checkpoints pass.**

---

### 17.2.7 Future Work (Out of Scope for This Phase)

The following are identified as valuable but deferred to subsequent phases:

1. **Rich Numeric Types Implementation (Phase 17.3)**
   - `DataType::Scaled { base, scale }` — decimal-like fixed-point
   - `DataType::Modular { base, modulus }` — modular arithmetic
   - `DataType::Packed { bits, signed }` — bit-packed integers
   - Integration with validation and coercion

2. **Surface Forms Implementation (Phase 17.4)**
   - `Presentation` annotations on fields
   - Format specifiers (batting_avg, era, currency, percentage)
   - Parse hints for inference
   - Serialization format control

3. **Schema Evolution (Phase 17.5)**
   - `schema.migrate(old, new)` transformation
   - Backward/forward compatibility policies
   - Schema versioning best practices

4. **Streaming Envelope Format (Phase 17.6)**
   - Schema-header + streaming data
   - Framed protocol for large datasets
   - Schema caching for repeated reads
