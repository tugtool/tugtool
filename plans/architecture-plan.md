# Arbors Architecture Plan

This document outlines the phased implementation roadmap for Arbors, a schema-driven, in-memory computation engine for JSON and hierarchical data.

## Project Identity

**Arbors is a JSON/JSONL compute engine that accepts JSON Schema to describe data.**

It is NOT a JSON Schema implementation that happens to store data. This distinction matters: we optimize for the common case (nullable primitives, objects with optional fields, arrays of homogeneous objects) and defer edge cases.

**Vision:** An experienced developer who works with JSON daily should look at Arbors and say, "This is what I've been waiting for!"

---

## Current State

**Completed (Phases 1-11):**
- Phase 1: End-to-End Pipeline
- Phase 2: Build Hygiene (warnings-as-errors)
- Phase 3: Integration Test Suite (real-world fixtures)
- Phase 4: Native Schema System (ArborsType, temporal types)
- Phase 5: Python Bindings v0
- Phase 6: Columnar Node Storage (sonic-rs, 27-63% faster parsing)
- Phase 7: Arrow Integration (to_arrow, to_polars, to_pandas)
- Phase 8+9: Expression System & Query Engine (60+ Expr variants)
- Phase 10: Lazy Evaluation and Parallelism (1.6x speedup)
- Phase 11: Python Bindings v1 (1067 tests, 4x faster than json stdlib)

**Current Stats:**
- 178 Rust tests, 1067 Python tests
- JSONL parsing: 608 MB/s (4x json stdlib, 2x orjson)
- Full expression system with filter/select/with_column/agg
- Lazy evaluation with query optimization

**Next:** Phase 12 (to be defined)

---

## Phase 2: Build Hygiene ✓

**Goal:** Clean build with warnings-as-errors. Establish discipline early.

### 2.1 Fix Current Warnings
- [x] Remove unused `schemas_mut()` in `arbors-schema`
- [x] Remove unused imports in `arbors-cli`

### 2.2 Enable Warnings-as-Errors (Always ON)
- [x] Add workspace-level lint configuration in `Cargo.toml`:
  ```toml
  [workspace.lints.rust]
  warnings = "deny"

  [workspace.lints.clippy]
  all = { level = "deny", priority = -1 }
  ```
- [x] Add `[lints] workspace = true` to each crate's `Cargo.toml`
- [x] Verify `cargo build` and `cargo clippy` pass with no warnings
- [x] Update Makefile `lint` target to fail on warnings

### 2.3 Success Criteria
- [x] `cargo build` produces zero warnings
- [x] `cargo clippy` produces zero warnings
- [x] CI would fail on any new warning

---

## Phase 3: Integration Test Suite ✓

**Goal:** Establish proper test infrastructure with real-world data fixtures.

### 3.1 Test Directory Structure
- [x] Create workspace-level `tests/` directory for cross-crate integration tests
- [x] Create `testdata/` directory for JSON/JSONL fixtures
- [x] Organize fixtures by category:
  ```
  testdata/
    schemas/           # JSON Schema files
    json/              # Single JSON documents
    jsonl/             # Multi-document JSONL files
    expected/          # Expected outputs for round-trip tests
  ```

### 3.2 Fixture Files
- [x] Real-world JSON samples: package.json, GitHub events, API responses
- [x] Edge case JSONL files: empty lines, unicode, deeply nested
- [x] Schema files for each fixture

### 3.3 Integration Tests
- [x] Parse all fixtures and verify Arbor construction (11 tests)
- [x] Schema inference tests with comparison to manual schemas (8 tests)
- [x] Round-trip tests: JSON → Arbor → JSON (12 tests)
- [ ] Performance regression tests (optional baseline)

### 3.4 Success Criteria
- [x] `cargo test` runs all integration tests (211 total tests)
- [x] New contributors can add fixtures without modifying Rust code
- [x] Clear documentation on test organization

### Bug Fixed During Phase 3
- **Binary search by InternId**: Object children were sorted alphabetically by
  string name, but `get_field_by_id` performed binary search by InternId. Fixed
  by sorting children by InternId in `fill_object` and `fill_any_object`.

### 3.5 Real-World Examples

**Goal:** Exercise Arbors with realistic, diverse JSON structures from public APIs and datasets.

#### Weather Data (`testdata/weather/`)
Real weather API responses showcasing different JSON patterns:
- [x] `weather-2-day-hourly.json` - **Columnar format**: Each field is an array of 48 hourly values (temperature, humidity, wind, etc.)
- [x] `weather-location.json` - **Columnar search results**: Autocomplete with parallel arrays for multiple locations
- [x] `weather-recent-history-1-day-rapid.json` - **Row-oriented observations**: Array of observation objects with nested `imperial` measurements
- [x] `weather-tides.json` - **Mixed structure**: Flat metadata fields + nested columnar `tidalForecast` arrays
- [x] `weather-station-finder.json` - **Columnar station data**: Parallel arrays for nearby weather stations

#### CSV Data (`testdata/csv/`)
Tabular data demonstrating CSV-to-JSON conversion patterns:
- [x] `batters-small.csv` - Baseball statistics (Hank Aaron, Willie Mays, Babe Ruth) with nullable fields
- [x] `countries.csv` - World country data with 239 countries, many nullable columns
- [x] `MTA_Daily_Ridership.csv` - NYC transit ridership during COVID (time series with percentages)

#### Earthquake Data (`testdata/earthquake/`)
USGS real-time seismic data in GeoJSON format:
- [x] `usgs-earthquakes-sample.geojson` - GeoJSON FeatureCollection with Point geometries
  - Rich properties: magnitude, place, time, tsunami warnings, alert levels
  - Nested geometry coordinates (longitude, latitude, depth)
  - Metadata object with generation time and count

#### GitHub API Data (`testdata/github/`)
GitHub API responses demonstrating AoS patterns with nested structures:
- [x] `events.json` - **AoS with polymorphic payloads**: Watch, Fork, Push, Issues, PullRequest events
- [x] `issues.json` - **AoS with nested arrays**: Issues with labels, assignees, milestones

#### Financial Data (`testdata/financial/`)
Stock market data demonstrating both SoA and AoS patterns:
- [x] `stock-timeseries.json` - **Keyed SoA**: Date keys mapping to OHLCV objects (Alpha Vantage style)
- [x] `stock-quotes.json` - **AoS with nullables**: Array of stock quotes with nullable dividendYield
- [x] `stock-intraday-columnar.json` - **True SoA**: Parallel arrays for timestamps, open, high, low, close, volume

#### Reddit Data (`testdata/reddit/`)
Reddit API responses with deeply nested recursive structures:
- [x] `subreddit-posts.json` - **Nested Listing structure**: Posts with nested data objects and nullable flairs
- [x] `comments.json` - **Recursive threading**: Comments with nested replies containing more comments

#### News Data (`testdata/basic-jsonl/`)
- [x] `news.jsonl` - **AoS with optional fields**: Articles with entities array, variations, and multiple types

#### Pattern Summary

| Pattern | Example | Description |
|---------|---------|-------------|
| **SoA (Columnar)** | weather-2-day-hourly, stock-intraday-columnar | Parallel arrays for each field |
| **AoS (Row-oriented)** | users.jsonl, news.jsonl, github events | Array of complete objects |
| **Keyed SoA** | stock-timeseries | Object with date/key → value object mapping |
| **Mixed** | weather-tides | Flat metadata + nested columnar forecast |
| **Recursive** | reddit comments | Nested structures that reference themselves |
| **GeoJSON** | earthquake | FeatureCollection with geometry coordinates |

**Data Source References:**
- [USGS Earthquake API](https://earthquake.usgs.gov/fdsnws/event/1/)
- [GitHub Events API](https://docs.github.com/en/rest/activity/events)
- [Alpha Vantage Stock API](https://www.alphavantage.co/)
- [Reddit JSON API](https://www.reddit.com/dev/api/)
- [Awesome JSON Datasets](https://github.com/jdorfman/awesome-json-datasets)

---

## Phase 4: Native Schema System and Extended Types

**Goal:** Move from JSON Schema as foundation to a native Arbors schema system. JSON Schema becomes an import format.

*Design principle: Keep it simple like JSON. No complex DSL project.*

### 4.1 Native Schema Types
- [x] Design a Rust-native schema representation, simpler and more expressive than StorageSchema:

### 4.2 Temporal Type Support
- [x] Date
- [x] DateTime
- [x] Duration

### 4.3 Schema Importers
- [x] Import from JSON Schema
- [x] Import from Polars schema
- [x] Import from CSV

### 4.4 Improved Type Inference
- [x] Proper inference order

### 4.5 Typed Serialization Format
- [x] Plain JSON export (lossy but widely compatible)
- [x] MessagePack export (efficient binary, type-preserving)

### 4.6 Success Criteria
- [x] Native `ArborsType` enum covers all common use cases
- [x] JSON Schema import produces equivalent native schemas
- [x] Temporal types parse ISO 8601 correctly
- [x] Round-trip through typed format preserves all type information

---

## Phase 5: Python Bindings (v0) ✓

**Goal:** Early Python API to iterate on design with real usage feedback.

*Moved earlier in roadmap to enable API iteration.*

*Design principle: The API should feel Pythonic, not like wrapped Rust.*

### 5.1 Core Classes
- [x] `Arbor` — Collection of parsed JSON trees (top-level container)
- [x] `Tree` — Document-level accessor wrapping a root node
- [x] `Node` — Individual JSON value with type and navigation
- [x] `Schema` — Schema definition for typed parsing

### 5.2 Reading Functions
- [x] `read_json(data, schema=None)` → Arbor
- [x] `read_jsonl(data, schema=None)` → Arbor (one tree per line)
- [x] `read_ndjson(data, schema=None)` → alias for read_jsonl
- [x] `infer_schema(data)` → Schema

### 5.3 Type System
- [x] Type constants: `String`, `Int64`, `Float64`, `Bool`, `Date`, `DateTime`, `Duration`, `Binary`, `Null`
- [x] Factory functions: `Array(item_type)`, `Struct(**fields)`
- [x] `ArborsType` enum for programmatic type access
- [x] `Field.required()` and `Field.optional()` for schema building

### 5.4 Schema Construction
- [x] Keyword constructor: `Schema(name=aq.String, age=aq.Int64)`
- [x] Static methods: `Schema.object([...])`, `Schema.array(...)`, `Schema.any()`
- [x] JSON Schema import: `Schema.from_json_schema(dict_or_str)`

### 5.5 Navigation and Access
- [x] `tree["field"]` / `node["field"]` → child by key
- [x] `tree.path("a.b[0].c")` → path navigation
- [x] `node.value` → Python value (int, str, bool, None, etc.)
- [x] `node.type_name` → semantic type string ("string", "int64", "struct", etc.)
- [x] `tree.keys()`, `tree.values()`, `tree.items()` → dict-like iteration
- [x] `tree.to_python(deep=True)` → recursive conversion to Python objects

### 5.6 Exception Hierarchy
- [x] `ArborsError` — base exception
- [x] `ParseError` — JSON parse failures
- [x] `SchemaError` — schema definition errors
- [x] `TypeMismatchError` — data/schema mismatch

### 5.7 Developer Experience
- [x] Rich `__repr__` for Arbor, Tree, Node (multi-line format)
- [x] Type stubs (`_arbors.pyi`) for IDE completion and mypy
- [x] Comprehensive docstrings
- [x] `python/examples/smoke.py` starter script

### 5.8 Success Criteria
- [x] 435 Python tests passing
- [x] 560 Rust tests passing
- [x] mypy type checking passes
- [x] API feels Pythonic, not like wrapped Rust

---

## Phase 6: Columnar Node Storage ✓

**Goal:** Internal optimization for cache-friendly operations. Users should not notice.

*Users work with the API and don't think about columnar storage.*

### 6.1 Benchmarks and Design Validation
- [x] Create standalone micro-benchmarks (AoS vs SoA comparison)
- [x] Validate cache efficiency claims (1.8x speedup for type scanning)
- [x] Validate binary search performance (packed extraction faster for typical objects)
- [x] Document results in `plans/architecture-phase-6.md`

### 6.2 ColumnarNodes Implementation
- [x] Create `ColumnarNodes` struct with packed `type_key` field:
  - Bits 0-23: key_id (24-bit)
  - Bits 24-27: NodeType (4-bit)
  - Bit 28: is_object_child flag
- [x] Four parallel arrays: `type_key`, `parents`, `data0`, `data1`
- [x] Same 16-byte per-node memory footprint as AoS

### 6.3 Arbor Migration
- [x] Replace `Vec<Node>` with `ColumnarNodes` in Arbor
- [x] Update ArborBuilder to convert at finish()
- [x] Maintain identical public API
- [x] All 560 Rust tests pass unchanged
- [x] All 435 Python tests pass unchanged

### 6.4 sonic-rs Parser Migration
- [x] Replace simd-json with sonic-rs as production parser
- [x] Update API from `&mut [u8]` to `&[u8]` (sonic-rs doesn't mutate)
- [x] Update Python bindings
- [x] Retain simd-json in dev-deps for benchmark comparison

### 6.5 Performance Results

**Columnar Storage:**
| Operation | Improvement |
|-----------|-------------|
| Type scanning | **1.8x faster** |
| Full-node access | **2.7x faster** |
| Field lookup | No regression |

**sonic-rs Migration:**
| Benchmark | Improvement |
|-----------|-------------|
| citm_catalog.json (nested) | **57-63% faster** |
| canada.json (numeric) | **51-54% faster** |
| twitter.json (strings) | **6% faster** |
| users_1000.jsonl | **34-36% faster** |
| mixed_large.jsonl | **27% faster** |

### 6.6 Bug Fixes
- [x] Fixed `Node.__bool__` in Python bindings (was returning False for primitives)

### 6.7 Success Criteria
- [x] All existing tests pass unchanged (560 Rust + 435 Python)
- [x] No API changes visible to users
- [x] Measurable improvement in type-filtering operations (1.8x)
- [x] Same memory footprint (16 bytes per node)
- [x] Significant JSON parsing speedup (27-63%)

---

## Phase 7: Arrow Integration ✓

**Goal:** Enable data exchange with Arrow-based ecosystem.

*See `architecture-phase-7.md` for detailed implementation plan.*

### Summary

Arrow arrays were already used internally for primitive storage. Phase 7 added:
- `to_arrow()` export returning PyArrow Table
- Nested objects → StructArray, arrays → ListArray
- `to_polars()` and `to_pandas()` convenience methods
- Parquet export via `to_parquet()`

### Key Results
- [x] Export to Arrow Table with full nested structure preservation
- [x] Type mapping for all Arbors types (temporal, binary, nullable)
- [x] Python integration with PyArrow
- [x] Convenience wrappers for Polars/Pandas/Parquet

---

## Phase 8+9: Expression System & Query Engine ✓

**Goal:** Polars-inspired expression system as foundation for all query operations.

*See `architecture-phase-8+9.md` for detailed implementation plan.*

### Summary

Merged Phase 8 and 9 into a unified expression-first design:
- 60+ `Expr` variants for paths, arithmetic, comparisons, aggregations
- `LogicalPlan` DAG for expression optimization
- Type/shape inference with scalar vs vector cardinality
- Tree-building expressions (`struct_()`, `list_()`)
- Query operations: `filter()`, `select()`, `with_column()`, `agg()`

### Key Design Decisions
- Expressions are first-class citizens, not predicates
- Paths navigate INTO trees; wildcards yield multiple values
- Immutable-first with copy-on-write storage sharing
- Python operator overloading (`path("age") > 21`)

### Key Results
- [x] `Expr` enum with 60+ variants
- [x] Expression evaluator with shape tracking
- [x] Query ops (filter, select, with_column, agg)
- [x] String, datetime, list accessors
- [x] Python bindings with natural syntax

---

## Phase 10: Lazy Evaluation and Parallelism ✓

**Goal:** Build computation graphs and optimize execution. Enable parallel processing.

*See `architecture-phase-10.md` for detailed implementation plan.*

### Summary

Added lazy evaluation layer on top of Phase 8+9 expressions:
- `LazyArbor` wrapping computation graphs
- `QueryPlan` DAG for operation sequences
- Optimizer with predicate pushdown and filter fusion
- Parallel execution via Rayon
- Arc-wrapped storage for COW semantics

### Key Results
- [x] `LazyArbor` with chained operations
- [x] `collect()` materializes optimized plan
- [x] Parallel parsing (1.6x speedup for large JSONL)
- [x] Filter fusion optimization
- [x] Python API mirrors Rust lazy semantics

---

## Phase 11: Python Bindings (v1) ✓

**Goal:** Complete Python API with full feature parity, excellent documentation, and production readiness.

*See `architecture-phase-11.md` for detailed implementation plan.*

### Summary

Phase 11 polished the Python bindings to production quality:
- API parity with automated `make check-parity` enforcement
- Complete documentation with 8 example scripts
- Type stubs validated by `make check-stubs`
- 1067 Python tests with 100% coverage on wrapper code
- Performance optimization achieving 4x faster than json stdlib

### Key Subphases

| Subphase | Description | Status |
|----------|-------------|--------|
| 11.1 | API Audit with manifest-based parity checking | ✓ |
| 11.2 | Documentation (docstrings, examples) | ✓ |
| 11.3 | Example scripts (8 scripts, <1s total) | ✓ |
| 11.4 | Type stubs with stubtest validation | ✓ |
| 11.6 | Performance validation benchmarks | ✓ |
| 11.7 | Test coverage (1067 tests) | ✓ |
| 11.10 | Benchmark comparison vs json/orjson | ✓ |
| 11.11-13 | Parsing optimization (parallel, lazy) | ✓ |
| 11.15-16 | Schema inference, parsing unification | ✓ |
| 11.17 | PyO3 boundary optimization | ✓ |

### Performance Results (Release Build)

| Metric | Value | vs json stdlib |
|--------|-------|----------------|
| JSONL parsing | 608 MB/s | **4.2x faster** |
| bytes throughput | 623 MB/s | 3.9x faster |
| str throughput | 631 MB/s | 3.9x faster |
| vs orjson | 1.9x faster | - |

**Key finding:** Always use `make python-release` for benchmarks. Debug builds are ~10x slower.

### Success Criteria

- [x] Feature parity verified by `make check-parity`
- [x] Type stubs validated by `make check-stubs`
- [x] 8 example scripts executing in CI
- [x] 1067 Python tests passing
- [x] Performance: 4x faster than json stdlib for JSONL

---

## Phase 12: Test Data Redesign

**Goal:** Move checked-in test data in `testdata` to GitHub Releases

- [ ] Move existing `testdata` to GitHub Releases
- [ ] Make `testdata` a git-ignored directory
- [ ] Add tooling and workflow to pull test data from GitHub Releases like huggingface does for its models
- [ ] See attached chat for more information

---

## Phase 13: API Design Focus on Trees

**Goal:** Rework the current API to be and excellent tree-focused offering

- [ ] The `with_column` method smacks of DataFrames
- [ ] Use `polars` API for reference, but turn the focus to trees: https://docs.rs/polars/latest/polars/, https://docs.pola.rs/api/python/stable/reference/index.html
- [ ] Need extensive plan for tree-focused querying, modifying, and computation
- [ ] How do we build an extensible system that is sensitive to: paralellism, COW, lazy evaluation, python bindings

---

## Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `arrow` | 54 | Primitive arrays, null bitmaps |
| `arrow-array` | 54 | Array builders |
| `arrow-buffer` | 54 | Memory management |
| `sonic-rs` | 0.3 | Fast JSON parsing (SIMD-accelerated) |
| `serde_json` | 1.0 | JSON Schema parsing |
| `hashbrown` | 0.16 | Fast hash map for interner |
| `thiserror` | 2.0 | Error types |
| `chrono` | 0.4 | DateTime handling (Phase 4) |
| `rayon` | 1.10 | Parallel iteration (Phase 10) |
| `pyo3` | 0.22 | Python bindings |
| `maturin` | 1.7 | Python build tool |

---

## Future Considerations

Items to revisit after core phases complete:

- **Extended JSON Schema Support**: `oneOf`, `anyOf`, `allOf`, `patternProperties`
- **Object Key Ordering**: Schema-defined order vs lexical vs access frequency
- **Schema Lint Mode**: Warnings for unsupported patterns
- **Streaming Parse**: Handle files larger than memory
- **Persistence**: Memory-mapped files, lazy loading

---

## References

- [simd-json documentation](https://docs.rs/simd-json/)
- [arrow-rs documentation](https://docs.rs/arrow/)
- [JSON Schema 2020-12 spec](https://json-schema.org/draft/2020-12)
- Design discussions: `docs/arbors-0.txt`, `docs/arbors-1.txt`
