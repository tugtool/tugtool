The following audit consolidates all items marked as "missing", "deferred", "todo", "reserved", "future", or "not implemented" across the Arbors architecture plans (Phases 1-11).

### Arbors Unimplemented Work Audit

#### Phase 1: End-to-End Pipeline
* **Explicitly Deferred Schema Features:**
    * `oneOf`, `anyOf`, `allOf` (Schema composition)
    * `if`/`then`/`else` (Conditional schemas)
    * `not` (Negation)
    * `patternProperties` (Regex properties)
    * `unevaluatedProperties`, `unevaluatedItems`
    * `$anchor`, `$dynamicAnchor` (Advanced refs)
    * `$ref` to JSON Pointer beyond `#/$defs/Name` (e.g., `#/properties/foo/items`)
    * Remote `$ref` (URL fetching)
    * `dependentRequired`, `dependentSchemas`
* **Benchmarks:**
    * Parse 100MB JSONL (compare to raw simd-json)
    * Field lookup on deep objects
    * Iterate all values at path across 1M rows

#### Phase 3: Integration Test Suite
* **Missing Tests:**
    * Performance regression tests (baseline)

#### Phase 4: Native Schema System and Extended Types
* **Future Type Support (Reserved, Not Implemented):**
    * **Sized Integers:** `Int8`, `Int16`, `Int32`, `UInt8`, `UInt16`, `UInt32`, `UInt64`
    * **Sized Floats:** `Float32`, `Decimal` (Arbitrary precision)
    * **Range Types:** `IntRange`, `FloatRange`, `DateRange`, `DateTimeRange`
    * **Geospatial Types:** `GeoPoint` (lat/lon), `GeoPolygon`, `GeoLineString`
* **Serialization:**
    * `arbor_to_msgpack()` (MessagePack serialization) - Stub reserved
* **Schema-Aware Queries (Deferred):**
    * Schema-assisted optimizations (skip null checks, typed comparisons)
    * Explicit type casting (`cast_field`, `query_typed`)
* **Date/Time Semantics:**
    * Nanosecond precision for `Duration` (currently microseconds)
    * Precise calendar arithmetic for `Year`/`Month` units in `DateAdd` (currently approximate)
* **Integration Tests:**
    * Large file handling tests

#### Phase 5: Python Bindings (v0)
* **Node Access:**
    * Temporal value properties on `PyNode`: `date_value`, `datetime_value`, `duration_value` (currently returns ISO string)
* **Performance/Safety:**
    * Zero-copy string views (Phase 6+)
    * Unit tests for deep JSON trees (verify no recursion limit errors)
* **Type Stubs:**
    * Verify IDE autocompletion (VS Code, PyCharm)

#### Phase 6: Columnar Node Storage
* **SIMD Optimization (Deferred):**
    * Explicit SIMD type scanning (`std::simd` or `wide` crate)
    * `find_nodes_by_type(NodeType)` implementation
    * Benchmarks for explicit SIMD vs auto-vectorization
* **JSON Parsing:**
    * Streaming parser architecture (eliminate intermediate DOM)
    * Parallel JSONL parsing with Rayon (requires `Arbor::merge()`)
* **Benchmarks:**
    * Memory usage profiling

#### Phase 7: Arrow Integration
* **Missing/Future Extensions:**
    * Type coercion for compatible mixed types (int+float, string+null, etc.)
    * Direct PyArrow JSON reader comparison
    * Arrow → Arbor import (Phase 8+)
    * Parquet import (Phase 8+)
    * Streaming export (for very large arbors)
    * IPC (Arrow Flight)
    * Flatten option (dot notation columns)
    * Complex union types

#### Phase 8+9: Expression System & Query Engine
* **Path Expressions:**
    * Parse filter expressions in paths like `items[?@.active]` (Deferred from Phase 8.1.5)
    * Support `Box<Expr>` in `PathSegment::Filter`
* **Optimization:**
    * Logical Plan optimization pass (Constant folding, CSE, Pushdown hints) - Phase 10+ feature
* **Evaluation:**
    * Vectorized evaluation using Arrow arrays (currently materializes `ExprResult`)
* **String Operations:**
    * `Substring`, `Replace`, `Split`, `Join`, `RegexMatch`, `RegexExtract`, `RegexReplace` variants
    * Python `.str` accessor extensions for above
* **List Operations:**
    * `ListGet`, `ListSlice`, `ListContains`, `ListUnique`, `ListSort`, `ListReverse`, `ListConcat` variants
    * Python `.list` accessor extensions
* **Struct Operations:**
    * `StructField`, `StructRename`, `StructWith`, `StructWithout` variants
    * Python `.struct` accessor extensions
* **Conditional Expressions:**
    * `Case` variant (SQL CASE WHEN)
    * `NullIf` variant
    * `CaseBuilder` and chaining support in Python
* **Type Introspection:**
    * Type-checking predicates (`IsBool`, `IsInt`, etc.)
    * Evaluation and Python bindings for type predicates

#### Phase 10: Lazy Evaluation and Parallelism
* **Parallel Execution (Deferred features):**
    * **PerTreeArray Parallelism:** Parallelizing array element operations within a single tree
    * **Parallel Aggregation:** Map-reduce strategy for `agg()` (currently sequential fallback)
    * **Parallel WithColumn:** Requires exposing helper functions in `arbors_query` (currently sequential fallback)
    * **Parallel Sort:** Requires sort implementation first
* **Query Optimization (Deferred):**
    * **Projection Pruning:** Remove unused columns from Select
    * **Select Fusion:** Combine adjacent Select operations
    * **Cost-based optimization**
    * **Statistics-based decisions**
* **Operations Not Implemented:**
    * `Sort` operation (currently returns "not implemented" error)
* **Memory Optimization:**
    * Streaming builder for parallel `select`/`with_column` (currently accumulates results)
* **Lazy Tree API:**
    * `Tree.lazy()` (deferred to Phase 11)

#### Future / Post-Phase 11 Considerations
* **Extended JSON Schema Support:** `oneOf`, `anyOf`, `patternProperties`
* **Object Key Ordering:** Configurable order (schema vs lexical vs frequency)
* **Schema Lint Mode:** Warnings for unsupported patterns
* **Persistence:** Memory-mapped files, lazy loading
* **Streaming Parse:** Handle files larger than memory
* **Joins:** `join` operations in Query Engine