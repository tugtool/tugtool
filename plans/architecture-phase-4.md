# Arbors Architecture Plan: Phase 4: Native Schema System and Extended Types

This document outlines the Phase 4: Native Schema System and Extended Types plan for Arbors.

## Phase 4: Native Schema System and Extended Types

**Goal:** Move from JSON Schema as foundation to a native Arbors schema system. JSON Schema becomes an import format.

*Design principle: Keep it simple like JSON. No complex DSL project.*

---

## Critical Architecture Decision: Schema Layering

Before diving into implementation details, we must establish a fundamental architectural invariant:

```
┌─────────────────────────────────────────────────────────────────┐
│                    ArborsSchema (Semantic)                     │
│  Rich types: Date, DateTime, Duration, Binary, etc.             │
│  User-facing contract, schema evolution, compatibility          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼  (one-way conversion)
┌─────────────────────────────────────────────────────────────────┐
│                 StorageType + NodeType (Physical)               │
│  Optimized for parsing, memory layout, cache-friendly access    │
│  Extended in Phase 4 to support new physical types              │
└─────────────────────────────────────────────────────────────────┘
```

**Key Invariant:** `ArborsSchema → StorageType` conversion is one-way and lossy in the reverse direction. `StorageType → ArborsSchema` is partial: you cannot reconstruct full semantic meaning (e.g., Date vs Int32) from storage alone.

This mirrors:
- Arrow Schema vs Array layout
- PostgreSQL catalog vs row storage
- Parquet schema vs physical encoding

---

### 4.0 NodeType and StorageType Extensions (PREREQUISITE)

**Goal:** Extend the physical storage layer to support temporal and binary types. This is prerequisite work that enables everything else in Phase 4.

#### 4.0.1 Extended NodeType Enum

The current `NodeType` must be extended to support new physical types:

```rust
/// Extended NodeType with temporal and binary support
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeType {
    // === Existing Types ===
    Null = 0,
    Bool = 1,
    Int64 = 2,
    Float64 = 3,
    String = 4,
    Array = 5,
    Object = 6,

    // === Phase 4: Temporal Types ===
    /// Date stored as i32 days since Unix epoch (Arrow Date32)
    Date = 7,
    /// DateTime stored as i64 microseconds since Unix epoch (Arrow Timestamp)
    DateTime = 8,
    /// Duration stored as i64 microseconds (Arrow Duration)
    Duration = 9,

    // === Phase 4: Extended Types ===
    /// Binary data stored as byte array (Arrow Binary)
    Binary = 10,
}
```

**Node Storage Impact:**
- `type_flags` byte already uses only 3 bits for type; we have room for 8 types (0-7)
- Extending to 4 bits (0-15) requires adjusting bit layout OR using `data0`/`data1` encoding
- **Recommendation:** Use 4 bits for type in `type_flags`, leaving 4 bits for flags

#### 4.0.2 Extended StorageType Enum

```rust
pub enum StorageType {
    // === Existing Primitives ===
    Null,
    Bool,
    Int64,
    Float64,
    String { intern: bool },

    // === Phase 4: Temporal Types ===
    /// Calendar date (i32 days since epoch)
    Date32,
    /// Timestamp in microseconds (i64 micros since epoch, UTC)
    TimestampMicros,
    /// Duration in microseconds (i64)
    DurationMicros,

    // === Phase 4: Extended Types ===
    /// Raw binary data
    Binary,

    // === Existing Containers ===
    Array { items: SchemaId },
    Tuple {
        prefix_items: Vec<SchemaId>,
        additional_items: Option<SchemaId>,
    },
    Object {
        properties: Vec<ObjectProperty>,
        additional_properties: Option<SchemaId>,
    },

    // === Special ===
    Any,
}
```

#### 4.0.3 Extended PrimitivePools

Arbor requires new Arrow-backed pools for temporal types:

```rust
pub struct PrimitivePools {
    // === Existing Pools ===
    pub bools: BooleanBuilder,
    pub int64s: Int64Builder,
    pub float64s: Float64Builder,
    pub strings: StringBuilder,

    // === Phase 4: Temporal Pools ===
    /// Date values as days since epoch
    pub dates: Date32Builder,         // Arrow Date32Array
    /// DateTime values as microseconds since epoch
    pub datetimes: TimestampMicrosecondBuilder,  // Arrow TimestampArray
    /// Duration values as microseconds
    pub durations: DurationMicrosecondBuilder,   // Arrow DurationArray

    // === Phase 4: Extended Pools ===
    /// Binary data
    pub binaries: BinaryBuilder,      // Arrow BinaryArray
}
```

#### 4.0.4 Type Mapping Table: ArborsType → StorageType

This explicit mapping defines how semantic types are physically stored:

| ArborsType | StorageType | NodeType | Storage Format | Notes |
|-------------|-------------|----------|----------------|-------|
| `Null` | `Null` | `Null` | N/A | No data stored |
| `Bool` | `Bool` | `Bool` | Arrow BooleanArray | |
| `Int64` | `Int64` | `Int64` | Arrow Int64Array | |
| `Float64` | `Float64` | `Float64` | Arrow Float64Array | |
| `String` | `String { intern: false }` | `String` | Arrow StringArray | |
| `Date` | `Date32` | `Date` | i32 days since epoch | Arrow Date32 compatible |
| `DateTime` | `TimestampMicros` | `DateTime` | i64 micros since epoch | Arrow Timestamp compatible |
| `Duration` | `DurationMicros` | `Duration` | i64 microseconds | Arrow Duration compatible |
| `Binary` | `Binary` | `Binary` | Arrow BinaryArray | |
| `Array { items }` | `Array { items }` | `Array` | Contiguous children | |
| `Object { fields }` | `Object { properties }` | `Object` | Sorted by InternId | |
| `Any` | `Any` | (inferred) | Per-value | Runtime type detection |

**Reverse Mapping (Partial, Lossy):**

| StorageType | ArborsType | Information Lost |
|-------------|-------------|------------------|
| `Date32` | `Date` | None |
| `TimestampMicros` | `DateTime` | None |
| `DurationMicros` | `Duration` | None |
| `Int64` | `Int64` | Application semantics (e.g., an ID that looks like a timestamp) |
| `String` | `String` | Could be temporal string that wasn't schema-typed |

**Note:** Arbors never stores dates as Int64 — they are always Date32. Only DateTime uses an i64 physical representation (TimestampMicros).

#### 4.0.5 Implementation Tasks

- [x] Extend `NodeType` enum with `Date`, `DateTime`, `Duration`, `Binary` variants
- [x] Adjust `type_flags` bit layout to support 16 types (4 bits)
- [x] Extend `StorageType` enum with `Date32`, `TimestampMicros`, `DurationMicros`, `Binary`
- [x] Add `Date32Builder`, `TimestampMicrosecondBuilder`, `DurationMicrosecondBuilder`, `BinaryBuilder` to `PrimitivePools`
- [x] Implement pool accessors: `get_date()`, `get_datetime()`, `get_duration()`, `get_binary()`
- [x] Update `fill_*` methods in parser to handle new types (placeholder errors for Phase 4B)
- [x] Unit tests for all new pool types
- [x] Verify 16-byte node size is maintained (compile-time assertion passes)

---

### 4.1 Native Schema Types

Design a Rust-native schema representation, simpler and more expressive than StorageSchema.

#### 4.1.1 Core Type Enum

```rust
/// Arbors's native type system
///
/// This enum represents all types that Arbors can store and process.
/// Types are divided into categories: primitives, temporal, extended, containers, and special.
///
/// IMPORTANT: ArborsType is the semantic layer. It converts to StorageType for physical storage.
/// This conversion is one-way; StorageType → ArborsType is partial and lossy.
#[non_exhaustive]
pub enum ArborsType {
    // === Primitives ===
    Null,
    Bool,
    Int64,      // Default integer type
    Float64,    // Default float type (IEEE 754 double)
    String,

    // === Temporal ===
    Date,       // Calendar date (year, month, day), stored as i32 days since epoch
    DateTime,   // Instant in time, stored as i64 microseconds since epoch (UTC)
    Duration,   // ISO 8601 time-only duration, stored as i64 microseconds

    // === Extended ===
    Binary,     // Raw bytes (base64 encoded in JSON serialization)

    // === Containers ===
    Array { items: Box<ArborsType> },
    Object { fields: Vec<Field> },

    // === Special ===
    Any,        // Untyped, inferred at parse time
}

// NOTE: ArborsType does NOT expose Tuples as a separate variant.
// StorageType::Tuple is an internal optimization for JSON Schema `prefixItems`.
// When converting StorageType::Tuple → ArborsType:
//   - If all prefix items have the same type → Array { items: that_type }
//   - Otherwise → Array { items: Any } (heterogeneous tuple treated as Any array)
// This simplifies the user-facing API while preserving StorageType's efficiency.

/// Field definition for Object types
pub struct Field {
    /// Field name (interned in practice)
    pub name: String,
    /// Field type
    pub dtype: ArborsType,
    /// Can this field be JSON null?
    pub nullable: bool,
    /// Must this field be present? (missing vs null distinction)
    pub required: bool,
}
```

#### 4.1.2 Type Conversion Implementation

```rust
impl ArborsType {
    /// Convert to physical storage type (one-way, always succeeds)
    pub fn to_storage_type(&self) -> StorageType {
        match self {
            ArborsType::Null => StorageType::Null,
            ArborsType::Bool => StorageType::Bool,
            ArborsType::Int64 => StorageType::Int64,
            ArborsType::Float64 => StorageType::Float64,
            ArborsType::String => StorageType::String { intern: false },
            ArborsType::Date => StorageType::Date32,
            ArborsType::DateTime => StorageType::TimestampMicros,
            ArborsType::Duration => StorageType::DurationMicros,
            ArborsType::Binary => StorageType::Binary,
            ArborsType::Array { items } => {
                // Recursive conversion handled by schema registry
                StorageType::Array { items: /* schema_id */ }
            }
            ArborsType::Object { fields } => {
                // Fields converted to ObjectProperty
                StorageType::Object { properties: /* ... */ }
            }
            ArborsType::Any => StorageType::Any,
        }
    }

    /// Attempt to infer ArborsType from StorageType (partial, lossy)
    ///
    /// Returns None for storage types that could map to multiple semantic types.
    pub fn from_storage_type(storage: &StorageType) -> Option<Self> {
        match storage {
            StorageType::Null => Some(ArborsType::Null),
            StorageType::Bool => Some(ArborsType::Bool),
            StorageType::Int64 => Some(ArborsType::Int64),
            StorageType::Float64 => Some(ArborsType::Float64),
            StorageType::String { .. } => Some(ArborsType::String),
            StorageType::Date32 => Some(ArborsType::Date),
            StorageType::TimestampMicros => Some(ArborsType::DateTime),
            StorageType::DurationMicros => Some(ArborsType::Duration),
            StorageType::Binary => Some(ArborsType::Binary),
            StorageType::Any => Some(ArborsType::Any),
            // Containers require context
            StorageType::Array { .. } => None,
            StorageType::Object { .. } => None,
            StorageType::Tuple { .. } => None,
        }
    }
}
```

#### 4.1.3 Future Type Support (Not Implemented in Phase 4)

The following types are **planned for future phases** but must be accounted for in the design now. The `ArborsType` enum uses `#[non_exhaustive]` to allow future additions without breaking changes.

**Sized Integer Types (Future):**
```rust
// Future additions - placeholder comments for design consideration
Int8,       // 8-bit signed integer (-128 to 127)
Int16,      // 16-bit signed integer
Int32,      // 32-bit signed integer
UInt8,      // 8-bit unsigned integer (0 to 255)
UInt16,     // 16-bit unsigned integer
UInt32,     // 32-bit unsigned integer
UInt64,     // 64-bit unsigned integer
```

**Sized Float Types (Future):**
```rust
Float32,    // IEEE 754 single precision
Decimal,    // Arbitrary precision decimal (for financial data)
```

**Range Types (Future):**
```rust
// Range types for numeric and temporal data
IntRange { min: i64, max: i64 },              // Integer range [min, max]
FloatRange { min: f64, max: f64 },            // Float range [min, max]
DateRange { start: Date, end: Date },         // Date range
DateTimeRange { start: DateTime, end: DateTime },
```

**Geospatial Types (Future):**
```rust
// Geographic coordinates
GeoPoint { lat: f64, lon: f64 },              // WGS84 latitude/longitude
// Future: GeoPolygon, GeoLineString for GeoJSON support
```

#### 4.1.4 Type String Constants

Following the pattern from `flowmessage.py`, define string constants for type names used in serialization:

```rust
/// Type string constants for serialization
pub mod type_str {
    // Current types
    pub const NULL: &str = "null";
    pub const BOOL: &str = "bool";
    pub const INT64: &str = "int64";
    pub const FLOAT64: &str = "float64";
    pub const STRING: &str = "string";
    pub const DATE: &str = "date";
    pub const DATETIME: &str = "datetime";
    pub const DURATION: &str = "duration";
    pub const BINARY: &str = "binary";
    pub const ARRAY: &str = "array";
    pub const OBJECT: &str = "object";
    pub const ANY: &str = "any";

    // Future type strings (reserved, not yet implemented)
    pub const INT8: &str = "int8";
    pub const INT16: &str = "int16";
    pub const INT32: &str = "int32";
    pub const UINT8: &str = "uint8";
    pub const UINT16: &str = "uint16";
    pub const UINT32: &str = "uint32";
    pub const UINT64: &str = "uint64";
    pub const FLOAT32: &str = "float32";
    pub const DECIMAL: &str = "decimal";
    pub const GEO_POINT: &str = "geopoint";
}
```

#### 4.1.5 Implementation Tasks

- [x] Define `ArborsType` enum with `#[non_exhaustive]`
- [x] Define `Field` struct
- [x] Implement `Display` for `ArborsType` (human-readable type names)
- [x] Implement `ArborsType::from_str()` for parsing type strings
- [x] Define `type_str` module with constants
- [x] Implement `ArborsType::to_storage_type()` (one-way)
- [x] Implement `ArborsType::from_storage_type()` (partial, lossy)
- [x] Unit tests for type conversions
- [x] Unit tests for type string round-trip

---

### 4.2 Temporal Type Support

**Goal:** Support ISO 8601 temporal types with a design that allows future format expansion.

#### 4.2.1 Date Type

**Semantics:**
- Calendar date without time component
- No timezone information (dates are inherently timezone-agnostic)
- Valid range: approximately ±5.8 million years from epoch

**Storage:**
- Stored as `i32` representing days since Unix epoch (1970-01-01)
- Aligns with Arrow's `Date32` type

**Parsing (ISO 8601):**
- Primary format: `YYYY-MM-DD` (e.g., `2024-12-07`)
- Phase 4 supported formats:
  ```rust
  const DATE_FORMATS: &[&str] = &[
      "%Y-%m-%d",      // ISO 8601: 2023-01-01 (PRIMARY)
      "%Y/%m/%d",      // Slash: 2023/01/01
      "%Y%m%d",        // Compact: 20230101
  ];
  ```

**Explicitly NOT supported in Phase 4 (return error):**
- `%d-%m-%Y` (European: 01-01-2023) — ambiguous with US format
- `%m/%d/%Y` (US: 01/01/2023) — ambiguous with European format
- `%d/%m/%Y` (European slash) — ambiguous

**Rationale:** Ambiguous formats lead to data corruption. Users must normalize to ISO 8601 or slash-year-first formats.

**API:**
```rust
impl Date {
    pub fn from_iso(s: &str) -> Result<Self, TemporalError>;
    pub fn from_days_since_epoch(days: i32) -> Self;
    pub fn to_iso(&self) -> String;  // Always returns YYYY-MM-DD
    pub fn days_since_epoch(&self) -> i32;
    pub fn year(&self) -> i32;
    pub fn month(&self) -> u32;
    pub fn day(&self) -> u32;
}

#[derive(Debug, Clone)]
pub enum TemporalError {
    InvalidFormat { input: String, expected: &'static str },
    OutOfRange { input: String, reason: String },
    AmbiguousFormat { input: String, hint: String },
}
```

#### 4.2.2 DateTime Type

**Semantics:**
- Instant in time, always stored as UTC internally
- Microsecond precision (sufficient for most use cases)
- Timezone-aware parsing, UTC-normalized storage
- **Default behavior:** If no timezone specified, assume UTC

**Storage:**
- Stored as `i64` representing microseconds since Unix epoch
- Aligns with Arrow's `Timestamp(Microsecond, Some("UTC"))`

**Parsing:**
```rust
const DATETIME_FORMATS: &[&str] = &[
    // ISO 8601 with timezone (preferred)
    "%Y-%m-%dT%H:%M:%S%.fZ",           // 2023-01-01T12:30:45.123456Z
    "%Y-%m-%dT%H:%M:%SZ",              // 2023-01-01T12:30:45Z
    "%Y-%m-%dT%H:%M:%S%:z",            // 2023-01-01T12:30:45+00:00
    "%Y-%m-%dT%H:%M:%S%.f%:z",         // 2023-01-01T12:30:45.123+00:00

    // Without timezone (assumes UTC)
    "%Y-%m-%dT%H:%M:%S%.f",            // 2023-01-01T12:30:45.123456
    "%Y-%m-%dT%H:%M:%S",               // 2023-01-01T12:30:45
    "%Y-%m-%d %H:%M:%S",               // 2023-01-01 12:30:45
    "%Y-%m-%d %H:%M",                  // 2023-01-01 12:30
];
```

**API:**
```rust
impl DateTime {
    pub fn from_iso(s: &str) -> Result<Self, TemporalError>;
    pub fn from_micros_since_epoch(micros: i64) -> Self;
    pub fn to_iso(&self) -> String;         // Returns with Z suffix
    pub fn to_rfc3339(&self) -> String;     // RFC 3339 format
    pub fn micros_since_epoch(&self) -> i64;
    pub fn to_date(&self) -> Date;          // Extract date component
}
```

#### 4.2.3 Duration Type

**Semantics:**
- Represents a length of time, not a point in time
- **Phase 4 supports only time-only durations** (hours, minutes, seconds, microseconds)
- Negative durations are valid
- Future: nanosecond precision for Arrow compatibility

**Storage:**
- Stored as `i64` representing microseconds
- Aligns with Arrow's `Duration(Microsecond)`

**Supported in Phase 4:**
- `PT[n]H[n]M[n]S` format only (time-only)
- Examples: `PT1H30M`, `PT90S`, `PT2H30M15.5S`, `PT0.5S`

**Explicitly NOT supported (returns explicit error):**
```rust
// Calendar durations are NOT supported in Phase 4
// These return TemporalError::UnsupportedDuration

"P1D"           // Days
"P1W"           // Weeks
"P1M"           // Months
"P1Y"           // Years
"P3Y6M4D"       // Combined calendar
"P1DT12H"       // Calendar + time
```

**Error Handling:**
```rust
impl Duration {
    pub fn from_iso(s: &str) -> Result<Self, TemporalError>;
}

// TemporalError extended:
pub enum TemporalError {
    // ... existing variants ...
    UnsupportedDuration {
        input: String,
        reason: &'static str,
    },
}

// Example error:
// TemporalError::UnsupportedDuration {
//     input: "P1D".to_string(),
//     reason: "Calendar durations (days, weeks, months, years) not yet supported. Use time-only format: PT[n]H[n]M[n]S",
// }
```

**API:**
```rust
impl Duration {
    pub fn from_iso(s: &str) -> Result<Self, TemporalError>;
    pub fn from_micros(micros: i64) -> Self;
    pub fn to_iso(&self) -> String;  // Always returns PT... format
    pub fn total_micros(&self) -> i64;
    pub fn hours(&self) -> i64;
    pub fn minutes(&self) -> i64;  // Minutes component (0-59)
    pub fn seconds(&self) -> i64;  // Seconds component (0-59)
    pub fn is_negative(&self) -> bool;
}
```

#### 4.2.4 Implementation Tasks

- [x] Define `Date` struct with `i32` storage
- [x] Define `DateTime` struct with `i64` storage
- [x] Define `Duration` struct with `i64` storage
- [x] Define `TemporalError` enum with all error variants
- [x] Implement `Date::from_iso()` with supported formats only
- [x] Implement `DateTime::from_iso()` with timezone handling (default UTC)
- [x] Implement `Duration::from_iso()` with explicit errors for calendar durations
- [x] Implement `Display` for all temporal types (ISO 8601 output)
- [x] Add Arrow pool types for temporal values (see 4.0)
- [x] Unit tests for ISO 8601 parsing (comprehensive)
- [x] Unit tests for explicit error cases (calendar durations, ambiguous dates)
- [x] Unit tests for edge cases (leap years, timezone offsets)

---

### 4.3 Schema-Driven Parsing

**Goal:** Define how ArborsSchema directs the parser to convert JSON strings into typed values.

#### 4.3.1 Critical Behavioral Change

**IMPORTANT:** When an ArborsSchema is provided, the JSON parser will convert JSON string values into typed values based on the schema.

```
Without Schema:
  JSON: {"created": "2024-01-15T10:30:00Z"}
  Arbor Node: String("2024-01-15T10:30:00Z")

With Schema (field "created" typed as DateTime):
  JSON: {"created": "2024-01-15T10:30:00Z"}
  Arbor Node: DateTime(1705316200000000)  ← microseconds since epoch
```

This is a significant behavioral change from schema-less parsing.

#### 4.3.2 Parsing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         JSON Input                              │
│  {"name": "Alice", "created": "2024-01-15T10:30:00Z"}           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ArborsSchema (optional)                      │
│  {"name": String, "created": DateTime}                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Schema → StorageType                         │
│  Compile ArborsSchema to StorageSchema (SchemaRegistry)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  simd-json Parser + ArborBuilder               │
│  - For "name": store as String node                             │
│  - For "created": parse string → DateTime, store as DateTime    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Arbor                                   │
│  Node[0]: Object (2 children)                                    │
│  Node[1]: String("Alice") @ pool_index=0                        │
│  Node[2]: DateTime(1705316200000000) @ pool_index=0             │
└─────────────────────────────────────────────────────────────────┘
```

#### 4.3.3 Parser Extension for Typed Values

```rust
impl ArborBuilder {
    /// Fill a typed value based on schema
    ///
    /// IMPORTANT: For temporal and binary types, we require string input.
    /// Non-string values cause explicit TypeMismatch errors — no silent fallback.
    fn fill_typed_value(
        &mut self,
        value: &simd_json::Value,
        expected_type: &StorageType,
        schema_path: &str,
        data_path: &str,
    ) -> Result<NodeId, ArborsError> {
        // Temporal and Binary types MUST be strings — no fallback
        match expected_type {
            StorageType::Date32
            | StorageType::TimestampMicros
            | StorageType::DurationMicros
            | StorageType::Binary => {
                match value {
                    Value::String(s) => {
                        match expected_type {
                            StorageType::Date32 => {
                                let date = Date::from_iso(s)?;
                                self.add_date(date)
                            }
                            StorageType::TimestampMicros => {
                                let dt = DateTime::from_iso(s)?;
                                self.add_datetime(dt)
                            }
                            StorageType::DurationMicros => {
                                let dur = Duration::from_iso(s)?;
                                self.add_duration(dur)
                            }
                            StorageType::Binary => {
                                let bytes = base64::decode(s)?;
                                self.add_binary(&bytes)
                            }
                            _ => unreachable!(),
                        }
                    }
                    _ => Err(ArborsError::TypeMismatch {
                        expected: expected_type.type_name(),
                        got: value.json_type_name(),
                        schema_path: schema_path.to_string(),
                        data_path: data_path.to_string(),
                        hint: "Temporal and binary types require JSON string values".into(),
                    }),
                }
            }
            // Other types: fall through to normal handling
            _ => self.fill_value(value),
        }
    }
}

/// TypeMismatch error (added to ArborsError enum)
#[derive(Debug, Clone)]
pub struct TypeMismatchInfo {
    pub expected: &'static str,
    pub got: String,
    pub schema_path: String,
    pub data_path: String,
    pub hint: String,
}
```

#### 4.3.4 Implementation Tasks

- [x] Extend `ArborBuilder::fill_typed_value()` for Date, DateTime, Duration, Binary
- [x] Add `ArborBuilder::add_date()`, `add_datetime()`, `add_duration()`, `add_binary()`
- [x] Update `parse_json_with_schema()` to use typed filling
- [x] Update `parse_jsonl_with_schema()` similarly
- [x] Error handling for type mismatch (string that doesn't parse as Date)
- [x] Unit tests for schema-driven type conversion
- [x] Integration tests with real-world temporal data

**Phase 4.3 Complete:** Schema-driven parsing implemented. 405 tests pass, clippy clean.

---

### 4.4 Schema Importers

**Goal:** Support importing schemas from multiple formats into `ArborsSchema`.

#### 4.4.1 JSON Schema Importer

Continue using existing `StorageSchema` compilation as foundation, then convert:

```rust
impl ArborsSchema {
    /// Import from JSON Schema
    ///
    /// Compiles a JSON Schema into Arbors's native schema format.
    /// Uses the same subset of JSON Schema supported by StorageSchema.
    pub fn from_json_schema(schema: &serde_json::Value) -> Result<Self> {
        // 1. Compile to StorageSchema (existing code)
        let registry = SchemaCompiler::compile(schema)?;
        let root_id = registry.root_id();
        // 2. Convert to ArborsSchema
        Self::from_storage_schema(&registry, root_id)
    }

    /// Convert from StorageSchema (internal)
    ///
    /// Takes both the registry (contains all type definitions) and the root schema ID.
    fn from_storage_schema(registry: &SchemaRegistry, root_id: SchemaId) -> Result<Self> {
        // Convert StorageType variants to ArborsType
        // Temporal format hints are recognized (see table below)
        // ...
    }
}
```

**JSON Schema Format Hints → ArborsType Mapping:**

| JSON Schema | ArborsType | Notes |
|-------------|-------------|-------|
| `{ "type": "string", "format": "date" }` | `Date` | ISO 8601 date |
| `{ "type": "string", "format": "date-time" }` | `DateTime` | ISO 8601 datetime |
| `{ "type": "string", "format": "duration" }` | `Duration` | ISO 8601 duration (PT only) |
| `{ "type": "string", "format": "byte" }` | `Binary` | Base64-encoded binary |
| `{ "type": "string" }` (no format) | `String` | Plain string |
| `{ "type": "string", "format": "uri" }` | `String` | Unknown formats → String |
| `{ "type": "string", "format": "email" }` | `String` | Unknown formats → String |

**Note:** Only the four recognized format values (`date`, `date-time`, `duration`, `byte`) trigger temporal/binary type mapping. All other format values are ignored and the field is treated as `String`.

#### 4.4.2 CSV Schema Importer with Smart Sampling

Infer schema from CSV headers and sample data, using smart sampling strategies inspired by `sampler.py`:

```rust
/// Options for CSV schema inference
pub struct CsvInferOptions {
    /// Sampling strategy for large files
    pub sampling: SamplingStrategy,
    /// Patterns to treat as null/missing
    pub null_patterns: NullPatterns,
    /// Whether to try parsing date/time strings
    pub infer_temporal: bool,
    /// Whether to infer numeric types
    pub infer_numbers: bool,
}

/// Sampling strategy for inference
pub enum SamplingStrategy {
    /// Use first N rows (fastest, may miss patterns)
    FirstN(usize),
    /// Random sample with seed for reproducibility
    Random { size: usize, seed: Option<u64> },
    /// Reservoir sampling (memory-efficient for streaming)
    Reservoir { size: usize },
}

impl Default for CsvInferOptions {
    fn default() -> Self {
        Self {
            // Default: 250 rows, matching sampler.py "inference" purpose
            sampling: SamplingStrategy::Random { size: 250, seed: Some(42) },
            null_patterns: NullPatterns::csv(),
            infer_temporal: true,
            infer_numbers: true,
        }
    }
}

impl CsvInferOptions {
    /// Quick inference for previews (50 rows)
    pub fn preview() -> Self {
        Self {
            sampling: SamplingStrategy::FirstN(50),
            ..Default::default()
        }
    }

    /// Thorough inference for analysis (1000 rows)
    pub fn analysis() -> Self {
        Self {
            sampling: SamplingStrategy::Random { size: 1000, seed: Some(42) },
            ..Default::default()
        }
    }
}
```

#### 4.4.3 Mixed-Type Column Handling

Real-world CSVs often have mixed types in a single column:

```rust
/// Result of type inference for a column
pub enum InferredType {
    /// All values parse as this type
    Uniform(ArborsType),
    /// Mixed types detected - percentage breakdown
    Mixed {
        /// Most common parseable type
        dominant: ArborsType,
        /// Percentage of values that parse as dominant type
        confidence: f64,
        /// Fallback type (usually String)
        fallback: ArborsType,
    },
    /// All values are null patterns
    AllNull,
}

/// Confidence threshold for accepting a type
const TYPE_CONFIDENCE_THRESHOLD: f64 = 0.95;

impl TypeInference {
    /// Low-level: check if ALL values parse as a single type
    /// Used internally by infer_column().
    pub fn infer(values: &[&str], options: &InferOptions) -> Result<ArborsType> {
        // ... existing implementation (returns ArborsType)
    }

    /// High-level: infer type for a CSV column with confidence tracking
    ///
    /// This wraps `infer()` and tracks per-type parse success rates.
    /// If confidence >= 95%, returns Uniform(dominant_type).
    /// Otherwise returns Mixed with confidence breakdown.
    pub fn infer_column(
        values: &[&str],
        options: &InferOptions,
    ) -> InferredType {
        let non_null: Vec<&str> = values
            .iter()
            .filter(|v| !options.is_null_pattern(v))
            .copied()
            .collect();

        if non_null.is_empty() {
            return InferredType::AllNull;
        }

        // Count how many values parse as each type
        let mut int_count = 0;
        let mut float_count = 0;
        let mut bool_count = 0;
        let mut date_count = 0;
        let mut datetime_count = 0;
        let mut duration_count = 0;

        for v in &non_null {
            if Self::is_integer(v) { int_count += 1; }
            if Self::is_float(v) { float_count += 1; }
            if Self::is_boolean(v) { bool_count += 1; }
            if Self::is_date(v) { date_count += 1; }
            if Self::is_datetime(v) { datetime_count += 1; }
            if Self::is_duration(v) { duration_count += 1; }
        }

        let total = non_null.len() as f64;

        // Check types in inference order, with confidence
        let candidates = [
            (int_count, ArborsType::Int64),
            (float_count, ArborsType::Float64),
            (bool_count, ArborsType::Bool),
            (duration_count, ArborsType::Duration),
            (date_count, ArborsType::Date),
            (datetime_count, ArborsType::DateTime),
        ];

        for (count, dtype) in candidates {
            let confidence = count as f64 / total;
            if confidence >= TYPE_CONFIDENCE_THRESHOLD {
                return InferredType::Uniform(dtype);
            }
            if confidence > 0.5 {
                // Dominant but not confident enough
                return InferredType::Mixed {
                    dominant: dtype,
                    confidence,
                    fallback: ArborsType::String,
                };
            }
        }

        // Default: treat as String
        InferredType::Uniform(ArborsType::String)
    }
}
```

#### 4.4.4 CSV Temporal Format Handling

For CSVs, we support additional common formats beyond strict ISO 8601:

```rust
/// Date formats accepted during CSV inference (in priority order)
const CSV_DATE_FORMATS: &[&str] = &[
    "%Y-%m-%d",      // ISO 8601: 2023-01-01 (PREFERRED)
    "%Y/%m/%d",      // Slash: 2023/01/01
    "%Y%m%d",        // Compact: 20230101
    // Partial dates (infer as Date, not String)
    // "%Y-%m",      // Month only: 2023-01 (DEFERRED - needs design)
];

/// DateTime formats accepted during CSV inference
const CSV_DATETIME_FORMATS: &[&str] = &[
    // Full precision
    "%Y-%m-%dT%H:%M:%S%.fZ",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    // Reduced precision (missing seconds)
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M",
];
```

**Ambiguous Format Handling:**
- If a column has values like "01/02/2023", we cannot determine US vs European format
- Return `InferredType::Mixed` with `fallback: ArborsType::String`
- Log warning: "Ambiguous date format detected, storing as String"

#### 4.4.5 Implementation Tasks

- [x] Implement `ArborsSchema::from_json_schema()`
- [x] Implement `ArborsSchema::from_storage_schema()` (internal conversion)
- [x] Define `CsvInferOptions` struct with sampling strategies
- [x] Implement `SamplingStrategy` enum and reservoir sampling
- [x] Implement `ArborsSchema::from_csv_sample()` with smart sampling
- [x] Implement `InferredType` enum for mixed-type handling
- [x] Add CSV temporal format detection
- [x] Handle ambiguous date formats gracefully (returns String for ambiguous)
- [x] Reserve stub for schema import from other formats (documented in comments)
- [x] Unit tests for JSON Schema import
- [x] Unit tests for CSV schema inference with various patterns
- [x] Integration tests with real CSV data (batters, MTA ridership, countries)

**Phase 4.4 Status:** Schema importers complete. 310 tests pass, clippy clean.

---

### 4.5 Improved Type Inference

**Goal:** Implement robust type inference following the proven patterns from `flowinfer.py`.

#### 4.5.1 Inference Order (Critical!)

Type inference must try types in the correct order to avoid false positives:

```rust
/// Type inference engine
pub struct TypeInference;

impl TypeInference {
    /// Infer the best ArborsType for a collection of string values.
    ///
    /// Order is critical to avoid false positives:
    /// 1. Integer (before boolean - "0"/"1" are numbers, not bools)
    /// 2. Float (if integer fails)
    /// 3. Boolean (explicit: "true"/"false"/"yes"/"no")
    /// 4. Duration (ISO 8601 `P...` prefix)
    /// 5. Date (date-only patterns)
    /// 6. DateTime (datetime patterns)
    /// 7. String (fallback)
    pub fn infer(values: &[&str], options: &InferOptions) -> Result<ArborsType> {
        // Filter out null values
        let non_null: Vec<&str> = values
            .iter()
            .filter(|v| !options.is_null_pattern(v))
            .copied()
            .collect();

        // If all values are null, default to String (nullable)
        if non_null.is_empty() {
            return Ok(ArborsType::String);
        }

        // Try inference in order
        if Self::all_integer(&non_null) {
            return Ok(ArborsType::Int64);
        }

        if Self::all_float(&non_null) {
            return Ok(ArborsType::Float64);
        }

        if Self::all_boolean(&non_null) {
            return Ok(ArborsType::Bool);
        }

        if options.infer_temporal {
            if Self::all_duration(&non_null) {
                return Ok(ArborsType::Duration);
            }

            if Self::all_date(&non_null) {
                return Ok(ArborsType::Date);
            }

            if Self::all_datetime(&non_null) {
                return Ok(ArborsType::DateTime);
            }
        }

        // Fallback to String
        Ok(ArborsType::String)
    }
}
```

#### 4.5.2 Boolean Value Patterns

**Critical:** Do NOT include "0" and "1" as boolean values - they should be integers!

```rust
impl TypeInference {
    /// Boolean true patterns (lowercase comparison)
    const TRUE_PATTERNS: &'static [&'static str] = &[
        "true", "t", "yes", "y", "on", "enabled"
    ];

    /// Boolean false patterns (lowercase comparison)
    const FALSE_PATTERNS: &'static [&'static str] = &[
        "false", "f", "no", "n", "off", "disabled"
    ];

    fn all_boolean(values: &[&str]) -> bool {
        values.iter().all(|v| {
            let lower = v.to_lowercase();
            let trimmed = lower.trim();
            if trimmed.is_empty() {
                return true; // Empty strings are nullable
            }
            Self::TRUE_PATTERNS.contains(&trimmed) ||
            Self::FALSE_PATTERNS.contains(&trimmed)
        })
    }
}
```

#### 4.5.3 Null Value Patterns

Different source formats have different null conventions:

```rust
/// Null pattern configurations by source format
pub struct NullPatterns {
    patterns: Vec<String>,
}

impl NullPatterns {
    /// CSV null patterns (comprehensive)
    ///
    /// NOTE: Includes "-" as a null pattern, which is common in many datasets.
    /// Use `csv_strict()` if you need "-" to be treated as a literal value
    /// (e.g., metrics datasets where -1 or "-" are meaningful sentinel values).
    pub fn csv() -> Self {
        Self {
            patterns: vec![
                "".into(), "null".into(), "NULL".into(),
                "None".into(), "NONE".into(), "none".into(),
                "n/a".into(), "N/A".into(), "na".into(), "NA".into(),
                "#N/A".into(), "#NA".into(),  // Excel patterns
                "-".into(),                    // Common placeholder
            ],
        }
    }

    /// CSV null patterns without "-" (for datasets where "-" is meaningful)
    pub fn csv_strict() -> Self {
        Self {
            patterns: vec![
                "".into(), "null".into(), "NULL".into(),
                "None".into(), "NONE".into(), "none".into(),
                "n/a".into(), "N/A".into(), "na".into(), "NA".into(),
                "#N/A".into(), "#NA".into(),
            ],
        }
    }

    /// JSON null patterns (minimal)
    pub fn json() -> Self {
        Self {
            patterns: vec!["".into(), "null".into()],
        }
    }

    /// Custom null patterns
    pub fn custom(patterns: Vec<String>) -> Self {
        Self { patterns }
    }

    pub fn is_null(&self, value: &str) -> bool {
        let trimmed = value.trim();
        self.patterns.iter().any(|p| {
            p.eq_ignore_ascii_case(trimmed)
        })
    }
}
```

#### 4.5.4 Implementation Tasks

- [x] Define `TypeInference` struct
- [x] Implement `infer()` with correct order: Int → Float → Bool → Duration → Date → DateTime → String
- [x] Define boolean patterns (without "0"/"1")
- [x] Define `NullPatterns` struct with csv(), csv_strict(), json(), custom() constructors
- [x] Implement `is_integer()`, `is_float()`, `is_boolean()` helpers
- [x] Implement `is_duration()`, `is_date()`, `is_datetime()` helpers
- [x] Implement `all_*` collection helpers for uniform type checking
- [x] Define `InferOptions` struct
- [x] Unit tests for integer inference (including edge cases like "0", "1", "-42")
- [x] Unit tests for boolean inference (confirm "0", "1" are NOT boolean)
- [x] Unit tests for temporal inference
- [x] Unit tests for null pattern handling
- [x] Integration tests with real-world CSV data (batters, MTA ridership, countries)

**Phase 4.5 Status:** Type inference complete. Implemented as part of Phase 4.4.

---

### 4.6 Native Schema Design

**Goal:** Define how Arbors schemas are represented, composed, and used.

#### 4.6.1 ArborsSchema Structure

```rust
/// Arbors's native schema representation
///
/// A schema describes the expected structure of data in a Arbor.
/// Schemas can be:
/// - Explicitly provided (loaded from file, imported from JSON Schema)
/// - Inferred from sample data
/// - Evolved as more data is observed
pub struct ArborsSchema {
    /// Schema format version (for forward compatibility)
    pub version: u32,

    /// Optional schema name/identifier
    pub name: Option<String>,

    /// Optional description
    pub description: Option<String>,

    /// The root type of this schema
    pub root: ArborsType,

    /// Named type definitions (for reuse within schema)
    pub definitions: HashMap<String, ArborsType>,
}
```

#### 4.6.2 Schema Construction API

```rust
impl ArborsSchema {
    /// Create a schema for a single type
    pub fn new(root: ArborsType) -> Self {
        Self {
            version: 1,
            name: None,
            description: None,
            root,
            definitions: HashMap::new(),
        }
    }

    /// Create a schema for an object with fields
    pub fn object(fields: Vec<Field>) -> Self {
        Self::new(ArborsType::Object { fields })
    }

    /// Create a schema for an array of items
    pub fn array(item_type: ArborsType) -> Self {
        Self::new(ArborsType::Array { items: Box::new(item_type) })
    }

    /// Builder: add a named type definition
    pub fn with_definition(mut self, name: impl Into<String>, dtype: ArborsType) -> Self {
        self.definitions.insert(name.into(), dtype);
        self
    }

    /// Builder: set schema name
    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }
}
```

#### 4.6.3 Field Builder API

```rust
impl Field {
    /// Create a required, non-nullable field
    pub fn required(name: impl Into<String>, dtype: ArborsType) -> Self {
        Self {
            name: name.into(),
            dtype,
            nullable: false,
            required: true,
        }
    }

    /// Create an optional (not required), nullable field
    pub fn optional(name: impl Into<String>, dtype: ArborsType) -> Self {
        Self {
            name: name.into(),
            dtype,
            nullable: true,
            required: false,
        }
    }

    /// Builder: set nullable
    pub fn nullable(mut self, nullable: bool) -> Self {
        self.nullable = nullable;
        self
    }

    /// Builder: set required
    pub fn required_field(mut self, required: bool) -> Self {
        self.required = required;
        self
    }
}
```

#### 4.6.4 Schema Validation

```rust
impl ArborsSchema {
    /// Validate that a schema is well-formed
    pub fn validate(&self) -> Result<(), SchemaError> {
        self.validate_type(&self.root)?;

        for (name, dtype) in &self.definitions {
            self.validate_type(dtype)?;
        }

        Ok(())
    }

    fn validate_type(&self, dtype: &ArborsType) -> Result<(), SchemaError> {
        match dtype {
            ArborsType::Object { fields } => {
                // Check for duplicate field names
                let mut seen = HashSet::new();
                for field in fields {
                    if !seen.insert(&field.name) {
                        return Err(SchemaError::DuplicateField(field.name.clone()));
                    }
                    self.validate_type(&field.dtype)?;
                }
            }
            ArborsType::Array { items } => {
                self.validate_type(items)?;
            }
            _ => {}
        }
        Ok(())
    }
}
```

#### 4.6.5 Schema Comparison and Evolution

```rust
impl ArborsSchema {
    /// Check if data written with `self` can be read by `other`
    ///
    /// Usage: `writer_schema.is_compatible_with(&reader_schema)`
    /// Returns true if a reader using `other` can safely read data written with `self`.
    pub fn is_compatible_with(&self, other: &ArborsSchema) -> bool {
        self.root.is_compatible_with(&other.root)
    }
}

impl ArborsType {
    /// Check type compatibility for schema evolution
    ///
    /// `self` is the writer type, `other` is the reader type.
    /// Returns true if data written as `self` can be read as `other`.
    ///
    /// Rules:
    /// - Same types are compatible
    /// - Int64 → Float64 (widening) is compatible
    /// - Any is compatible with everything
    /// - Arrays are compatible if items are compatible
    /// - Objects: reader can have subset of writer's fields
    fn is_compatible_with(&self, other: &ArborsType) -> bool {
        match (self, other) {
            // Same types
            (ArborsType::Null, ArborsType::Null) => true,
            (ArborsType::Bool, ArborsType::Bool) => true,
            (ArborsType::Int64, ArborsType::Int64) => true,
            (ArborsType::Float64, ArborsType::Float64) => true,
            (ArborsType::String, ArborsType::String) => true,
            (ArborsType::Date, ArborsType::Date) => true,
            (ArborsType::DateTime, ArborsType::DateTime) => true,
            (ArborsType::Duration, ArborsType::Duration) => true,
            (ArborsType::Binary, ArborsType::Binary) => true,

            // Widening: writer Int64 can be read as Float64
            (ArborsType::Int64, ArborsType::Float64) => true,

            // Any is universal supertype
            (_, ArborsType::Any) => true,
            (ArborsType::Any, _) => true,

            // Arrays: items must be compatible
            (ArborsType::Array { items: a }, ArborsType::Array { items: b }) => {
                a.is_compatible_with(b)
            }

            // Objects: reader (other/b) can have subset of writer's (self/a) fields
            (ArborsType::Object { fields: writer_fields }, ArborsType::Object { fields: reader_fields }) => {
                // All fields the reader expects must exist and be compatible in writer
                reader_fields.iter().all(|reader_field| {
                    writer_fields.iter().any(|writer_field| {
                        reader_field.name == writer_field.name &&
                        writer_field.dtype.is_compatible_with(&reader_field.dtype)
                    })
                })
            }

            _ => false,
        }
    }
}
```

#### 4.6.6 Implementation Tasks

- [x] Define `ArborsSchema` struct
- [x] Implement `ArborsSchema::new()`, `object()`, `array()`, `any()` constructors
- [x] Implement `Field::required()`, `optional()` constructors
- [x] Implement builder pattern methods (`with_definition`, `with_name`, `with_description`)
- [x] Implement `ArborsSchema::validate()` and `validate_type()`
- [x] Implement `ArborsType::is_compatible_with()` and `ArborsSchema::is_compatible_with()`
- [x] Implement `ArborsSchema::get_field()` and `num_fields()` helpers
- [x] Unit tests for schema construction
- [x] Unit tests for schema validation
- [x] Unit tests for compatibility checking

**Phase 4.6 Status:** Native schema design complete. Implemented as part of Phase 4.4.

---

### 4.7 Typed Serialization Format

**Goal:** Design a clean, readable serialization format that preserves type information for round-trip fidelity.

#### 4.7.1 Design Principles

1. **No leading underscores** - Keys should be clean and readable
2. **Minimal type annotations** - Only annotate when necessary
3. **Human-readable** - Should be understandable without documentation
4. **Schema-first** - Schema describes the structure, data follows it
5. **Deterministic** - Output is canonical for testing and comparison

#### 4.7.2 Object Field Ordering

**Serialization uses canonical ordering:**

```rust
impl ArborsSchema {
    /// Serialize with canonical field ordering
    ///
    /// Fields are ordered alphabetically by name in JSON output.
    /// This ensures deterministic output for testing and comparison.
    pub fn to_json_canonical(&self) -> Result<String>;
}

impl Arbor {
    /// Serialize with canonical ordering
    ///
    /// Object fields in output are ordered by:
    /// 1. Schema field order (if schema provided)
    /// 2. Alphabetical by key name (if no schema)
    pub fn to_json_canonical(&self, schema: Option<&ArborsSchema>) -> Result<String>;
}
```

#### 4.7.3 Key Constants

Following `flowmessage.py` pattern with clean keys:

```rust
/// Serialization key constants
pub mod dict_key {
    // Schema keys
    pub const VERSION: &str = "version";
    pub const SCHEMA: &str = "schema";
    pub const DATA: &str = "data";

    // Type keys (used in schema and typed values)
    pub const TYPE: &str = "type";
    pub const VALUE: &str = "value";
    pub const ITEMS: &str = "items";
    pub const FIELDS: &str = "fields";

    // Field keys
    pub const NAME: &str = "name";
    pub const NULLABLE: &str = "nullable";
    pub const REQUIRED: &str = "required";

    // Metadata
    pub const TITLE: &str = "title";
    pub const DESCRIPTION: &str = "description";

    // Short keys for typed values (compact format)
    pub const T: &str = "t";  // type
    pub const V: &str = "v";  // value
    pub const I: &str = "i";  // items type
}
```

#### 4.7.4 Temporal Value Serialization

**All temporal types serialize to ISO 8601 strings:**

| Type | Serialization Format | Example |
|------|---------------------|---------|
| `Date` | `YYYY-MM-DD` | `"2024-01-15"` |
| `DateTime` | RFC 3339 with Z | `"2024-01-15T10:30:00.000000Z"` |
| `Duration` | ISO 8601 PT format | `"PT1H30M"` |
| `Binary` | Base64 standard | `"SGVsbG8gV29ybGQ="` |

```rust
impl Date {
    pub fn to_json_value(&self) -> serde_json::Value {
        serde_json::Value::String(self.to_iso())  // "2024-01-15"
    }
}

impl DateTime {
    pub fn to_json_value(&self) -> serde_json::Value {
        serde_json::Value::String(self.to_rfc3339())  // "2024-01-15T10:30:00.000000Z"
    }
}

impl Duration {
    pub fn to_json_value(&self) -> serde_json::Value {
        serde_json::Value::String(self.to_iso())  // "PT1H30M"
    }
}
```

#### 4.7.5 Schema Serialization Format

```json
{
  "version": 1,
  "schema": {
    "type": "object",
    "fields": [
      {"name": "id", "type": "int64", "required": true},
      {"name": "name", "type": "string", "required": true},
      {"name": "email", "type": "string", "nullable": true},
      {"name": "created", "type": "datetime", "required": true},
      {"name": "tags", "type": {"type": "array", "items": "string"}}
    ]
  }
}
```

#### 4.7.6 Data Serialization Options

**Option A: Schema-guided plain JSON (preferred for most cases)**

When schema is known, data is plain JSON with temporal values as ISO strings:

```json
{
  "version": 1,
  "schema": { /* see above */ },
  "data": [
    {
      "id": 1,
      "name": "Alice",
      "email": "alice@example.com",
      "created": "2024-01-15T10:30:00.000000Z",
      "tags": ["admin", "active"]
    }
  ]
}
```

**Option B: Self-describing typed values (for schema-less transport)**

When type preservation is critical without separate schema:

```json
{
  "version": 1,
  "data": {
    "id": {"t": "int64", "v": 1},
    "name": {"t": "string", "v": "Alice"},
    "created": {"t": "datetime", "v": "2024-01-15T10:30:00.000000Z"},
    "tags": {"t": "array", "i": "string", "v": ["admin", "active"]}
  }
}
```

**Optimization: Homogeneous array type elision**

For arrays where all elements have the same type, suppress per-element annotations:

```json
// Instead of:
{"t": "array", "v": [{"t": "int64", "v": 1}, {"t": "int64", "v": 2}]}

// Use:
{"t": "array", "i": "int64", "v": [1, 2]}
```

#### 4.7.7 Serialization API

```rust
/// Serialization format options
pub enum SerializationFormat {
    /// Plain JSON (lossy for temporal types without schema)
    PlainJson,
    /// JSON with inline type annotations
    TypedJson,
    /// MessagePack binary (efficient, type-preserving) - FUTURE
    MessagePack,
}

impl Arbor {
    /// Serialize to JSON with schema
    pub fn to_json(&self, schema: &ArborsSchema) -> Result<String> {
        // Serialize with schema context for type-aware output
        // Temporal values become ISO strings
    }

    /// Serialize to typed JSON (self-describing)
    pub fn to_typed_json(&self) -> Result<String> {
        // Include type annotations inline
    }

    /// Serialize to JSON with canonical ordering (for testing)
    pub fn to_json_canonical(&self, schema: Option<&ArborsSchema>) -> Result<String>;
}

impl ArborsSchema {
    /// Serialize schema to JSON
    pub fn to_json(&self) -> Result<String>;

    /// Deserialize schema from JSON
    pub fn from_json(json: &str) -> Result<Self>;
}
```

#### 4.7.8 Implementation Tasks

- [x] Define `dict_key` module with serialization constants
- [x] Implement canonical field ordering for objects
- [x] Implement `ArborsSchema::to_json()` and `from_json()`
- [x] Implement `arbor_to_json()` (schema-guided plain JSON) - in arbors-io
- [x] Implement `arbor_to_typed_json()` (self-describing format) - in arbors-io
- [x] Implement homogeneous array optimization
- [ ] Reserve stub for `arbor_to_msgpack()` (future, deferred)
- [x] Unit tests for schema round-trip (JSON → Schema → JSON)
- [x] Unit tests for data serialization with temporal types
- [x] Unit tests for canonical ordering
- [x] Integration tests with real-world data

**Phase 4.7 Status:** COMPLETE. Schema serialization and Arbor data serialization implemented. Functions in `arbors-io`: `arbor_to_json`, `arbor_to_json_pretty`, `arbor_to_typed_json`, `arbor_to_typed_json_pretty`.

---

### 4.8 Future: Schema-Aware Queries (Deferred)

**Note:** The following capabilities are NOT implemented in Phase 4, but the architecture must not preclude them.

#### 4.8.1 Schema-Assisted Optimizations

Future phases may use schema information to:
- Skip null checks when field is non-nullable
- Use typed comparison for temporal fields
- Enable predicate pushdown for typed columns

#### 4.8.2 Casting Rules

Future phases may support explicit type casting:
```rust
// Future API (not Phase 4)
arbor.cast_field("timestamp", ArborsType::DateTime)?;
arbor.query_typed("created > '2024-01-01'", schema)?;
```

**Phase 4 constraint:** Design types and storage to support these extensions.

---

### 4.9 Success Criteria

Phase 4 is complete when:

1. **Physical layer extended:**
   - [x] `NodeType` has Date, DateTime, Duration, Binary variants
   - [x] `StorageType` has Date32, TimestampMicros, DurationMicros, Binary variants
   - [x] `PrimitivePools` has Arrow builders for all new types
   - [x] 16-byte node size maintained

2. **Native type system works:**
   - [x] `ArborsType` enum covers: Null, Bool, Int64, Float64, String, Date, DateTime, Duration, Binary, Array, Object, Any
   - [x] Type string constants defined for all types
   - [x] `ArborsType::to_storage_type()` works (one-way)
   - [x] `ArborsType::from_storage_type()` works (partial)

3. **Temporal types parse correctly:**
   - [x] `Date::from_iso()` parses ISO 8601 dates (non-ambiguous formats only)
   - [x] `DateTime::from_iso()` parses ISO 8601 datetimes with timezone handling
   - [x] `Duration::from_iso()` parses time-only durations (PT format)
   - [x] Calendar durations (P1D, P1M) return explicit error
   - [x] All temporal types serialize to ISO 8601 format

4. **Schema-driven parsing works:**
   - [x] JSON strings convert to typed values when schema specifies Date/DateTime/Duration
   - [x] Type mismatch errors are clear and actionable
   - [x] Binary fields decode from base64

5. **Schema importers work:**
   - [x] `ArborsSchema::from_json_schema()` converts JSON Schema to native
   - [x] `ArborsSchema::from_csv_sample()` infers schema from CSV with smart sampling
   - [x] CSV inference correctly identifies: Int64, Float64, Bool, Date, DateTime, Duration, String
   - [x] Mixed-type columns handled gracefully with InferredType enum

6. **Type inference is correct:**
   - [x] Integers before booleans ("0", "1" → Int64, not Bool)
   - [x] Floats when integers fail ("3.14" → Float64)
   - [x] Booleans only for explicit patterns ("true", "false", "yes", "no")
   - [x] Duration, Date, DateTime when temporal patterns detected
   - [x] String as fallback
   - [x] Ambiguous/mixed formats → String fallback

7. **Schema API is usable:**
   - [x] `ArborsSchema::object()`, `array()`, `any()` constructors work
   - [x] `Field::required()`, `optional()` constructors work
   - [x] Schema validation catches duplicate fields
   - [x] Compatibility checking works for schema evolution

8. **Serialization preserves types:**
   - [x] Schema round-trip: JSON → ArborsSchema → JSON preserves structure
   - [x] Data round-trip: Arbor → JSON → Arbor preserves values
   - [x] Typed JSON includes type annotations when needed
   - [x] Temporal values serialize as ISO 8601 strings
   - [x] Output is canonical (deterministic ordering)

9. **Test coverage:**
   - [x] Unit tests for all type operations
   - [x] Unit tests for inference with real-world patterns
   - [x] Unit tests for explicit error cases
   - [x] Integration tests with testdata/ fixtures
   - [x] All tests pass, clippy clean

---

## Suggested Implementation Staging

Phase 4 is coherent but substantial. For manageable delivery, consider implementing in sub-phases:

### 4A: Physical Layer + Core Types
**Goal:** Store Date/DateTime/Duration/Binary in Arbor by hand

- [x] Extend `NodeType` with temporal/binary variants (Phase 4.0 complete)
- [x] Extend `StorageType` with Date32, TimestampMicros, DurationMicros, Binary (Phase 4.0 complete)
- [x] Extend `PrimitivePools` with Arrow builders (Phase 4.0 complete)
- [x] Implement `Date`, `DateTime`, `Duration` structs with ISO 8601 parsing (Phase 4.2 complete)
- [x] Implement `ArborsType` enum and `Field` struct (Phase 4.1 complete)
- [x] Implement `ArborsType::to_storage_type()` (one-way conversion) (Phase 4.1 complete)

**Validation:** Can manually create Arbor with temporal nodes; pools work correctly.
**Phase 4.0 Status:** Physical storage layer complete (NodeType, StorageType, PrimitivePools). 240 tests pass.
**Phase 4.1 Status:** Native schema types complete (ArborsType, Field, type_str). 271 tests pass.
**Phase 4.2 Status:** Temporal types complete (Date, DateTime, Duration, TemporalError). 320 tests pass.
**Phase 4A Complete:** Comprehensive validation tests added (temporal_validation.rs). 377 tests pass, clippy clean.

### 4B: Schema-Driven Parsing - COMPLETE
**Goal:** JSON+schema → typed Arbor round-trips

- [x] Implement `ArborsSchema` struct with construction API
- [x] Implement `fill_typed_value()` in ArborBuilder (handles Date32, TimestampMicros, DurationMicros, Binary)
- [x] Update parsing to handle typed values with schema guidance
- [x] Implement `TypeMismatch` error handling

**Validation:** Parse JSON with ArborsSchema; temporal strings become typed nodes.
**Status:** Complete. Schema-driven parsing implemented in `builder.rs:380-511`. Tests pass.

### 4C: Schema Importers + Type Inference - COMPLETE
**Goal:** CSV and JSON Schema inputs create ArborsSchemas

- [x] Implement `ArborsSchema::from_json_schema()` with format hint mapping
- [x] Implement `TypeInference` with correct inference order
- [x] Implement `ArborsSchema::from_csv_sample()` with smart sampling
- [x] Implement `InferredType` for mixed-type columns

**Validation:** Infer schemas from CSV; import from JSON Schema; all feed into 4B.
**Status:** Complete. See `importer.rs`, `type_inference.rs`, `csv_inference.rs`. Tests pass.

### 4D: Serialization + Canonicalization - PARTIAL
**Goal:** schema+data → JSON/typed JSON round-trips

- [x] Implement `ArborsSchema::to_json()` and `from_json()`
- [x] Implement canonical field ordering
- [x] Implement `arbor_to_json()` (schema-guided) - in arbors-io
- [x] Implement `arbor_to_typed_json()` (self-describing) - in arbors-io

**Validation:** Full round-trip: JSON → Arbor → JSON preserves types and ordering.
**Status:** COMPLETE. All serialization implemented in arbors-io/serializer.rs.

---

## Clarifying Questions (Answered)

1. **Timezone handling for DateTime:** Should we default to UTC when no timezone is specified, or require explicit timezone in input? (Current proposal: default to UTC)
**Answer**: default to UTC

2. **Duration precision:** Should Duration support only microseconds, or also nanoseconds for future Arrow compatibility? (Current proposal: microseconds, matching DateTime)
**Answer**: Duration support only microseconds for now. Add a note about future possible expansion to nanoseconds for future Arrow compatibility.

3. **Schema evolution:** How strict should compatibility checking be? Should we allow:
   - Adding new optional fields? (Proposed: yes)
   - Removing required fields? (Proposed: no)
   - Changing types within compatible sets (Int64 → Float64)? (Proposed: yes for widening)
**Answer**: yes. confirmed as proposed.

4. **Binary type encoding:** Should Binary use base64 or base64url in JSON? (Proposed: standard base64)
**Answer**: standard base64

5. **CSV inference sample size:** What's a reasonable default sample size for type inference? (Proposed: 100 rows, configurable)
**Answer**: Smart sampling with 250 rows default for inference, 50 for preview, 1000 for analysis.

---

## Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `chrono` | 0.4 | DateTime handling, ISO 8601 parsing |
| `iso8601` | 0.6 | ISO 8601 duration parsing |
| `base64` | 0.22 | Binary encoding for JSON |
| `rmp-serde` | 1.3 | MessagePack serialization (future) |

---

## References

- [ISO 8601 Date/Time format](https://en.wikipedia.org/wiki/ISO_8601)
- [Arrow Date/Time types](https://arrow.apache.org/docs/format/Columnar.html#date-time-temporal-types)
- Phase 1 plan: `architecture-phase-1.md`

---

## 4.10 Remaining Work: Arbor Data Serialization

**Goal:** Complete the data serialization pipeline so Arbor data can round-trip through JSON.

### 4.10.1 Arbor::to_json() - Schema-Guided Plain JSON

Serialize Arbor data to plain JSON using schema context for type-aware output. Temporal values become ISO 8601 strings.

```rust
impl Arbor {
    /// Serialize to JSON with schema guidance
    ///
    /// Uses the schema to determine how to serialize each value:
    /// - Date → "YYYY-MM-DD"
    /// - DateTime → "YYYY-MM-DDTHH:MM:SS.ffffffZ"
    /// - Duration → "PT1H30M"
    /// - Binary → base64 encoded string
    /// - Other types → native JSON representation
    pub fn to_json(&self, schema: &ArborsSchema) -> Result<String>;

    /// Serialize to pretty-printed JSON
    pub fn to_json_pretty(&self, schema: &ArborsSchema) -> Result<String>;
}
```

**Output format:**
```json
{
  "id": 1,
  "name": "Alice",
  "created": "2024-01-15T10:30:00.000000Z",
  "tags": ["admin", "active"]
}
```

**Implementation tasks:**
- [x] Implement `arbor_to_json(&Arbor) -> Result<String>` in arbors-io
- [x] Implement `arbor_to_json_pretty(&Arbor) -> Result<String>` in arbors-io
- [x] Handle all node types (Null, Bool, Int64, Float64, String, Date, DateTime, Duration, Binary, Array, Object)
- [x] Use canonical field ordering for objects (alphabetical by key name)
- [x] Unit tests for each type serialization
- [x] Integration tests with round-trip: JSON → Arbor → JSON

### 4.10.2 Arbor::to_typed_json() - Self-Describing Format

Serialize Arbor data with inline type annotations for schema-less transport.

```rust
impl Arbor {
    /// Serialize to typed JSON (self-describing)
    ///
    /// Each value includes type annotation for round-trip fidelity
    /// without requiring external schema.
    pub fn to_typed_json(&self) -> Result<String>;
}
```

**Output format:**
```json
{
  "id": {"t": "int64", "v": 1},
  "name": {"t": "string", "v": "Alice"},
  "created": {"t": "datetime", "v": "2024-01-15T10:30:00.000000Z"},
  "tags": {"t": "array", "i": "string", "v": ["admin", "active"]}
}
```

**Implementation tasks:**
- [x] Implement `arbor_to_typed_json(&Arbor) -> Result<String>` in arbors-io
- [x] Use short keys from `dict_key` module (t, v, i)
- [x] Unit tests for typed JSON output
- [x] Unit tests for parsing typed JSON back to Arbor

### 4.10.3 Homogeneous Array Optimization

For arrays where all elements have the same type, suppress per-element type annotations.

```json
// Instead of:
{"t": "array", "v": [{"t": "int64", "v": 1}, {"t": "int64", "v": 2}]}

// Use:
{"t": "array", "i": "int64", "v": [1, 2]}
```

**Implementation tasks:**
- [x] Detect homogeneous arrays during serialization
- [x] Use `i` (items type) key for homogeneous arrays
- [x] Omit type annotations on array elements when `i` is present
- [x] Unit tests for homogeneous vs heterogeneous arrays

### 4.10.4 Future: MessagePack Serialization

Reserve for future implementation - efficient binary format.

```rust
impl Arbor {
    /// Serialize to MessagePack (future)
    #[cfg(feature = "msgpack")]
    pub fn to_msgpack(&self, schema: &ArborsSchema) -> Result<Vec<u8>>;
}
```

**Status:** Stub reserved, not implemented.

### 4.10.5 Integration Tests

- [x] Round-trip test: JSON with temporal types → Arbor → JSON (values preserved)
- [x] Round-trip test: Typed JSON → Arbor → Typed JSON
- [x] Test with real testdata/ fixtures (api_response, github_event, package.json)
- [ ] Test large file handling (deferred)

---

## Phase 4 Completion Summary

**PHASE 4 COMPLETE**

All sections implemented and tested:

- 4.0: Physical Layer (NodeType, StorageType, PrimitivePools extensions)
- 4.1: Native Schema Types (ArborsType, Field, type_str)
- 4.2: Temporal Types (Date, DateTime, Duration with ISO 8601)
- 4.3: Schema-Driven Parsing (fill_typed_value, TypeMismatch errors)
- 4.4: Schema Importers (from_json_schema, from_csv_sample)
- 4.5: Type Inference (TypeInference, NullPatterns, InferOptions)
- 4.6: Native Schema Design (ArborsSchema, Field, validation, compatibility)
- 4.7: Schema Serialization (to_json, from_json, canonical ordering)
- 4.10: Arbor Data Serialization (arbor_to_json, arbor_to_typed_json, homogeneous array optimization)

**Deferred:**
- Large file handling tests
- MessagePack serialization (reserved for future)

**Test Status:** 581 tests pass, clippy clean.
