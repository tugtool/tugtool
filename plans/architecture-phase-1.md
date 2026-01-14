# Arbors Architecture Plan: Phase 1 Implementation

This document outlines the Phase 1: End-to-End Pipeline plan for Arbors.

## Phase 1: End-to-End Pipeline

**Goal:** Parse JSON/JSONL into a queryable Arbor, guided by a storage-relevant subset of JSON Schema. Demonstrate the core thesis: schema-driven columnar storage with fast traversal.

**Non-goal:** Full JSON Schema 2020-12 compliance. We support what affects storage layout.

---

### 1.1 JSON Schema Subset (What We Support)

The following JSON Schema features map directly to storage decisions:

| Feature | Storage Impact |
|---------|---------------|
| `type` (primitive) | Determines primitive pool |
| `type: ["T", "null"]` | Sets `nullable: true` on schema |
| `properties` | Object field layout, sorted by key |
| `required` | Distinguishes missing vs present |
| `additionalProperties` | Open vs closed object |
| `items` | Homogeneous array element type |
| `prefixItems` | Tuple array with positional types |
| `enum` (all strings) | Enables string interning |
| `enum` (non-string) | No storage impact; validation via `jsonschema` crate |
| `const` | Single-value enum |
| `$ref: "#/$defs/Name"` | Schema reuse, recursion support (only `#/$defs/...` format) |
| `$defs` | Local schema definitions |
| `true` (boolean schema) | Matches anything → `StorageType::Any` |
| `false` (boolean schema) | Matches nothing → parse error |

**Explicitly Deferred (Phase 2+):**

| Feature | Reason |
|---------|--------|
| `oneOf`, `anyOf` | Complex union discrimination; most real data is nullable primitives |
| `allOf` | Schema merging is complex; rarely needed for storage layout |
| `if`/`then`/`else` | Conditional schemas; validation concern, not storage |
| `not` | Pure validation, no storage impact |
| `patternProperties` | Regex matching at runtime; defer to validation layer |
| `unevaluatedProperties/Items` | Complex applicator; defer |
| `$anchor`, `$dynamicAnchor` | Advanced ref features; local `$ref` sufficient for v1 |
| `$ref` to JSON Pointer | Only `#/$defs/Name` supported; `#/properties/foo/items` deferred |
| Remote `$ref` | No URL fetching; schemas must be self-contained |
| `dependentRequired`, `dependentSchemas` | Conditional validation |

**Validation Strategy:** Use the `jsonschema` crate for full JSON Schema validation. Our `StorageSchema` focuses on storage layout; validation is a separate concern.

---

### 1.2 StorageSchema Design

#### 1.2.1 Core Types

```rust
/// Unique identifier for a schema within a registry
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct SchemaId(u32);

impl SchemaId {
    pub const ROOT: SchemaId = SchemaId(0);
    pub const ANY: SchemaId = SchemaId(u32::MAX);
}

/// Interned property name (shares namespace with data key interning)
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct PropertyId(pub InternId);

/// The compiled schema registry
pub struct SchemaRegistry {
    /// All compiled schemas, indexed by SchemaId
    schemas: Vec<StorageSchema>,

    /// Property name interner (shared with Arbor's key interner)
    properties: StringInterner,
}

/// A compiled schema node
#[derive(Clone, Debug)]
pub struct StorageSchema {
    /// The storage type
    pub storage: StorageType,

    /// Can this value be JSON null?
    pub nullable: bool,

    /// JSON Pointer to this schema's location (always starts with "#")
    /// Examples: "#", "#/properties/name", "#/$defs/Address"
    /// Used for error messages and debugging
    pub source_path: String,
}

/// How data is stored
#[derive(Clone, Debug)]
pub enum StorageType {
    // Primitives
    Null,
    Bool,
    Int64,
    Float64,
    String { intern: bool },

    // Containers
    Array { items: SchemaId },
    Tuple {
        prefix_items: Vec<SchemaId>,
        /// Schema for items beyond prefix; None = no additional items allowed
        additional_items: Option<SchemaId>,
    },
    Object {
        /// Sorted by property name for binary search
        properties: Vec<ObjectProperty>,
        /// Schema for unknown properties; None = closed object
        additional_properties: Option<SchemaId>,
    },

    // Fallback: parse using raw value shape, not columnar-optimized
    Any,

    // Boolean schema "false": reject all values at parse time
    Reject,

    // Internal: placeholder during $ref resolution (never in final registry)
    #[doc(hidden)]
    UnresolvedRef,
}

impl StorageType {
    /// Human-readable type name for error messages
    pub fn expected_name(&self) -> &'static str {
        match self {
            StorageType::Null => "null",
            StorageType::Bool => "boolean",
            StorageType::Int64 => "integer",
            StorageType::Float64 => "number",
            StorageType::String { .. } => "string",
            StorageType::Array { .. } => "array",
            StorageType::Tuple { .. } => "array (tuple)",
            StorageType::Object { .. } => "object",
            StorageType::Any => "any",
            StorageType::Reject => "nothing (schema false)",
            StorageType::UnresolvedRef => "unresolved",
        }
    }
}

/// A property in an object schema
#[derive(Clone, Debug)]
pub struct ObjectProperty {
    /// Interned property name
    pub name_id: PropertyId,
    /// Original property name (for error messages)
    pub name: String,
    /// Schema for this property's value
    pub schema: SchemaId,
    /// Is this property required?
    pub required: bool,
}
```

#### 1.2.2 Design Decisions

**No `StorageType::Ref`:** All `$ref` references are resolved during compilation. The schema graph uses `SchemaId` for recursion, not a separate `Ref` variant. This keeps consumption simple.

**Interned property names:** `ObjectProperty` uses `PropertyId` (which wraps `InternId`) so property lookup in the schema uses the same ID space as data lookup in the Arbor. This enables O(1) property matching during parsing.

**Sorted properties:** Properties are sorted by name during compilation. Object children in the Arbor are stored in the same order, enabling binary search by key.

**Nullable as separate flag:** Instead of a union type, `nullable: true` is a flag. Storage doesn't change—we use Arrow's validity bitmap. This handles 99% of real-world "optional" fields.

**`StorageType::Any` semantics:** When a schema position uses `Any` (e.g., `additionalProperties: true` or no structural keywords), parsing proceeds without schema guidance:
- Recursively parse using the raw value's shape
- Infer `NodeType` from the JSON value type
- Objects still use sorted keys and DFS order (Arbor invariants apply)
- Not columnar-optimized—values use generic pools
- Future optimization: rewrite `Any` regions using inferred schema

**`StorageType::UnresolvedRef`:** Internal placeholder used during `$ref` resolution. Never appears in a finalized `SchemaRegistry`. If found post-compilation, indicates a bug.

**Schema order vs input order:** Object children in Arbor are stored in schema-defined sorted order, NOT input order. This enables binary search but means JSON round-trips may reorder keys. This is intentional and documented.

#### 1.2.3 Implementation Tasks

- [x] Define `SchemaId`, `PropertyId`, `SchemaRegistry`, `StorageSchema`, `StorageType`, `ObjectProperty`
- [x] Implement `SchemaRegistry::new()` and `SchemaRegistry::get(id: SchemaId) -> &StorageSchema`
- [x] Implement `SchemaRegistry::intern_property(name: &str) -> PropertyId`
- [x] Implement `SchemaRegistry::property_name(id: PropertyId) -> &str`

---

### 1.3 JSON Schema Compiler

Compile JSON Schema to `SchemaRegistry`. We compile the storage-relevant subset and ignore validation-only keywords.

#### 1.3.1 Compilation Pipeline

```
JSON Schema (serde_json::Value)
    ↓
┌─────────────────────────────────────┐
│  1. Collect $defs                   │
│     - Build map of local schemas    │
│     - No remote resolution          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  2. Compile Root Schema             │
│     - Recursive descent             │
│     - Resolve $ref to SchemaId      │
│     - Detect cycles → forward ref   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  3. Optimize                        │
│     - Sort object properties        │
│     - Detect enum → intern strings  │
└─────────────────────────────────────┘
    ↓
SchemaRegistry
```

#### 1.3.2 Compiler Implementation

```rust
pub struct SchemaCompiler {
    /// The registry being built
    registry: SchemaRegistry,

    /// $defs from the root schema
    defs: HashMap<String, serde_json::Value>,

    /// Map from $ref path to SchemaId (for cycle detection)
    ref_to_id: HashMap<String, SchemaId>,

    /// Stack of refs being resolved (cycle detection)
    resolution_stack: Vec<String>,
}

/// Unsupported JSON Schema keywords that we detect and reject
const UNSUPPORTED_KEYWORDS: &[&str] = &[
    "oneOf", "anyOf", "allOf",           // Composition
    "if", "then", "else",                // Conditional
    "not",                               // Negation
    "patternProperties",                 // Regex properties
    "unevaluatedProperties", "unevaluatedItems",  // Unevaluated
    "$anchor", "$dynamicAnchor", "$dynamicRef",   // Advanced refs
    "dependentRequired", "dependentSchemas",      // Dependent
];

impl SchemaCompiler {
    pub fn compile(schema: &serde_json::Value) -> Result<SchemaRegistry> {
        let mut compiler = SchemaCompiler::new();

        // Phase 0: reject unsupported keywords early
        compiler.check_unsupported_keywords(schema)?;

        // Phase 1: collect $defs
        compiler.collect_defs(schema)?;

        // Phase 2: compile root
        let root_id = compiler.compile_schema(schema, "#".to_string())?;
        assert_eq!(root_id, SchemaId::ROOT);

        // Phase 3: verify no unresolved refs remain
        compiler.verify_resolved()?;

        Ok(compiler.registry)
    }

    fn check_unsupported_keywords(&self, schema: &Value) -> Result<()> {
        self.check_unsupported_recursive(schema, "#".to_string())
    }

    fn check_unsupported_recursive(&self, schema: &Value, path: String) -> Result<()> {
        let obj = match schema.as_object() {
            Some(o) => o,
            None => return Ok(()), // Boolean schema or non-object
        };

        for keyword in UNSUPPORTED_KEYWORDS {
            if obj.contains_key(*keyword) {
                return Err(ArborsError::UnsupportedKeyword {
                    keyword: keyword.to_string(),
                    path,
                });
            }
        }

        // Recurse into subschemas
        if let Some(props) = obj.get("properties").and_then(|v| v.as_object()) {
            for (name, subschema) in props {
                self.check_unsupported_recursive(subschema, format!("{}/properties/{}", path, name))?;
            }
        }
        if let Some(items) = obj.get("items") {
            self.check_unsupported_recursive(items, format!("{}/items", path))?;
        }
        if let Some(prefix) = obj.get("prefixItems").and_then(|v| v.as_array()) {
            for (i, subschema) in prefix.iter().enumerate() {
                self.check_unsupported_recursive(subschema, format!("{}/prefixItems/{}", path, i))?;
            }
        }
        if let Some(additional) = obj.get("additionalProperties") {
            if !additional.is_boolean() {
                self.check_unsupported_recursive(additional, format!("{}/additionalProperties", path))?;
            }
        }
        if let Some(defs) = obj.get("$defs").and_then(|v| v.as_object()) {
            for (name, subschema) in defs {
                self.check_unsupported_recursive(subschema, format!("{}/$defs/{}", path, name))?;
            }
        }

        Ok(())
    }

    fn verify_resolved(&self) -> Result<()> {
        for (i, schema) in self.registry.schemas.iter().enumerate() {
            if matches!(schema.storage, StorageType::UnresolvedRef) {
                return Err(ArborsError::InvalidSchema(
                    format!("unresolved $ref at schema index {}", i)
                ));
            }
        }
        Ok(())
    }

    fn compile_schema(&mut self, schema: &Value, path: String) -> Result<SchemaId> {
        // Handle boolean schemas
        if let Some(b) = schema.as_bool() {
            return Ok(if b {
                SchemaId::ANY
            } else {
                // false schema = nothing matches; any value → parse error
                self.add_schema(StorageSchema {
                    storage: StorageType::Reject,
                    nullable: false,
                    source_path: path,
                })
            });
        }

        // Handle $ref
        if let Some(ref_path) = schema.get("$ref").and_then(|v| v.as_str()) {
            return self.resolve_ref(ref_path, &path);
        }

        // Determine type
        let storage = self.compile_type(schema, &path)?;
        let nullable = self.is_nullable(schema);

        Ok(self.add_schema(StorageSchema { storage, nullable, source_path: path }))
    }

    fn compile_type(&mut self, schema: &Value, path: &str) -> Result<StorageType> {
        // Check explicit type
        let type_val = schema.get("type");

        // Check for enum/const (affects storage: string interning)
        if let Some(storage) = self.try_compile_enum(schema, path)? {
            return Ok(storage);
        }

        match type_val {
            Some(Value::String(t)) => self.compile_single_type(t, schema, path),
            Some(Value::Array(types)) => {
                // ["string", "null"] → String with nullable: true
                // ["string", "integer"] → not supported in v1, error
                self.compile_type_array(types, schema, path)
            }
            None => {
                // Infer from keywords
                if schema.get("properties").is_some() || schema.get("additionalProperties").is_some() {
                    self.compile_object(schema, path)
                } else if schema.get("items").is_some() || schema.get("prefixItems").is_some() {
                    self.compile_array(schema, path)
                } else {
                    Ok(StorageType::Any)
                }
            }
        }
    }

    fn compile_single_type(&mut self, type_name: &str, schema: &Value, path: &str) -> Result<StorageType> {
        match type_name {
            "null" => Ok(StorageType::Null),
            "boolean" => Ok(StorageType::Bool),
            "integer" => Ok(StorageType::Int64),
            "number" => Ok(StorageType::Float64),
            "string" => Ok(StorageType::String { intern: false }),
            "array" => self.compile_array(schema, path),
            "object" => self.compile_object(schema, path),
            _ => Err(ArborsError::InvalidSchema(format!("unknown type: {}", type_name))),
        }
    }

    fn compile_type_array(&mut self, types: &[Value], schema: &Value, path: &str) -> Result<StorageType> {
        let type_strs: Vec<&str> = types.iter()
            .filter_map(|v| v.as_str())
            .collect();

        // Check for nullable pattern: ["T", "null"] or ["null", "T"]
        if type_strs.len() == 2 && type_strs.contains(&"null") {
            let non_null = type_strs.iter().find(|&&t| t != "null").unwrap();
            // Return the non-null type; nullable flag is set by is_nullable()
            return self.compile_single_type(non_null, schema, path);
        }

        // Multi-type unions not supported in v1
        Err(ArborsError::InvalidSchema(format!(
            "multi-type unions not supported in v1; use separate schemas or nullable: {:?}",
            type_strs
        )))
    }

    fn compile_object(&mut self, schema: &Value, path: &str) -> Result<StorageType> {
        let mut properties = Vec::new();

        // Get required set
        let required_set: HashSet<&str> = schema.get("required")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();

        // Compile properties
        if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
            for (name, subschema) in props {
                let prop_path = format!("{}/properties/{}", path, name);
                let schema_id = self.compile_schema(subschema, prop_path)?;
                let name_id = self.registry.intern_property(name);

                properties.push(ObjectProperty {
                    name_id,
                    name: name.clone(),
                    schema: schema_id,
                    required: required_set.contains(name.as_str()),
                });
            }
        }

        // Sort by property name for binary search
        properties.sort_by(|a, b| a.name.cmp(&b.name));

        // additionalProperties
        let additional_properties = match schema.get("additionalProperties") {
            Some(Value::Bool(false)) => None,
            Some(Value::Bool(true)) | None => Some(SchemaId::ANY),
            Some(subschema) => {
                let prop_path = format!("{}/additionalProperties", path);
                Some(self.compile_schema(subschema, prop_path)?)
            }
        };

        Ok(StorageType::Object { properties, additional_properties })
    }

    fn compile_array(&mut self, schema: &Value, path: &str) -> Result<StorageType> {
        let prefix_items = schema.get("prefixItems")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter().enumerate().map(|(i, subschema)| {
                    let item_path = format!("{}/prefixItems/{}", path, i);
                    self.compile_schema(subschema, item_path)
                }).collect::<Result<Vec<_>>>()
            })
            .transpose()?;

        let items = schema.get("items")
            .map(|subschema| {
                let item_path = format!("{}/items", path);
                self.compile_schema(subschema, item_path)
            })
            .transpose()?;

        match (prefix_items, items) {
            (None, None) => Ok(StorageType::Array { items: SchemaId::ANY }),
            (None, Some(item_schema)) => Ok(StorageType::Array { items: item_schema }),
            (Some(prefix), additional) => Ok(StorageType::Tuple {
                prefix_items: prefix,
                additional_items: additional,
            }),
        }
    }

    fn try_compile_enum(&mut self, schema: &Value, _path: &str) -> Result<Option<StorageType>> {
        let values = if let Some(c) = schema.get("const") {
            vec![c]
        } else if let Some(e) = schema.get("enum").and_then(|v| v.as_array()) {
            e.iter().collect()
        } else {
            return Ok(None);
        };

        // Check if all values are strings
        if values.iter().all(|v| v.is_string()) {
            return Ok(Some(StorageType::String { intern: true }));
        }

        // Mixed enum types: determine storage from first non-null
        // The actual enum validation is done by jsonschema crate
        Ok(None) // Fall through to type-based compilation
    }

    fn is_nullable(&self, schema: &Value) -> bool {
        if let Some(Value::Array(types)) = schema.get("type") {
            return types.iter().any(|v| v.as_str() == Some("null"));
        }
        false
    }

    fn resolve_ref(&mut self, ref_path: &str, _current_path: &str) -> Result<SchemaId> {
        // Already compiled? Return existing ID.
        if let Some(&id) = self.ref_to_id.get(ref_path) {
            return Ok(id);
        }

        // Check for cycle (we're currently resolving this ref)
        if self.resolution_stack.contains(&ref_path.to_string()) {
            // Cycle detected: allocate placeholder, it will be filled when we unwind
            let id = self.allocate_placeholder(ref_path);
            return Ok(id);
        }

        // Resolve the reference to actual schema JSON
        let target_schema = self.resolve_ref_path(ref_path)?.clone();

        // Allocate a placeholder with UnresolvedRef BEFORE compiling
        // This ensures the SchemaId is stable for recursive references
        let id = self.allocate_placeholder(ref_path);

        // Compile with cycle tracking
        self.resolution_stack.push(ref_path.to_string());
        let storage = self.compile_type(&target_schema, ref_path)?;
        let nullable = self.is_nullable(&target_schema);
        self.resolution_stack.pop();

        // Replace the placeholder with the actual compiled schema
        self.registry.schemas[id.0 as usize] = StorageSchema {
            storage,
            nullable,
            source_path: ref_path.to_string(),
        };

        Ok(id)
    }

    fn allocate_placeholder(&mut self, ref_path: &str) -> SchemaId {
        // Check if already allocated
        if let Some(&id) = self.ref_to_id.get(ref_path) {
            return id;
        }

        // Allocate new slot with UnresolvedRef placeholder
        let id = SchemaId(self.registry.schemas.len() as u32);
        self.registry.schemas.push(StorageSchema {
            storage: StorageType::UnresolvedRef,
            nullable: false,
            source_path: ref_path.to_string(),
        });
        self.ref_to_id.insert(ref_path.to_string(), id);
        id
    }

    fn resolve_ref_path(&self, ref_path: &str) -> Result<&serde_json::Value> {
        // Only support local refs: #/$defs/Name or #/path/to/schema
        if !ref_path.starts_with('#') {
            return Err(ArborsError::InvalidSchema(
                format!("remote $ref not supported: {}", ref_path)
            ));
        }

        if ref_path.starts_with("#/$defs/") {
            let name = &ref_path[8..];
            return self.defs.get(name)
                .ok_or_else(|| ArborsError::InvalidSchema(
                    format!("$ref not found: {}", ref_path)
                ));
        }

        Err(ArborsError::InvalidSchema(
            format!("unsupported $ref format: {}", ref_path)
        ))
    }
}
```

#### 1.3.3 Implementation Tasks

- [x] Implement `SchemaCompiler::new()` and `compile()`
- [x] Implement `check_unsupported_keywords()` for early rejection
- [x] Implement `collect_defs()` for $defs extraction
- [x] Implement `compile_schema()` recursive descent
- [x] Implement `compile_type()`, `compile_single_type()`, `compile_type_array()`
- [x] Implement `compile_object()` with property sorting
- [x] Implement `compile_array()` with items/prefixItems
- [x] Implement `try_compile_enum()` for string interning detection
- [x] Implement `resolve_ref()` with placeholder allocation
- [x] Implement `allocate_placeholder()` using `UnresolvedRef`
- [x] Implement `verify_resolved()` post-compilation check
- [x] Implement `is_nullable()` for type array detection

---

### 1.4 Missing vs Null Semantics

JSON Schema distinguishes:
- **Missing field:** Key not present in object
- **Null value:** Key present with value `null`

Arrow collapses both to "null" via validity bitmaps. Arbors must be explicit.

#### 1.4.1 Design Decision

**Rule:** Missing required field → parse error. Missing optional field → no node created.

```rust
/// When parsing an object, for each schema property:
fn handle_object_property(
    value: Option<&Value>,  // None if key missing
    prop: &ObjectProperty,
) -> Result<Option<NodeId>> {
    match (value, prop.required) {
        // Required field missing → error
        (None, true) => Err(ArborsError::MissingRequiredField(prop.name.clone())),

        // Optional field missing → no node
        (None, false) => Ok(None),

        // Field present with null → Null node (if nullable) or error
        (Some(Value::Null), _) => {
            let schema = registry.get(prop.schema);
            if schema.nullable {
                Ok(Some(create_null_node()))
            } else {
                Err(ArborsError::UnexpectedNull(prop.name.clone()))
            }
        }

        // Field present with value → parse recursively
        (Some(v), _) => Ok(Some(parse_value(v, prop.schema)?)),
    }
}
```

**Implications for Arbor:**
- Object children only include present fields
- `arbor.get_field(obj_id, "missing_optional")` returns `None`
- `arbor.is_null(node_id)` returns true only for explicit null nodes

#### 1.4.2 Implementation Tasks

- [x] Document missing vs null semantics in API
- [x] Add error types (`MissingRequiredField`, `UnexpectedNull`) with dual-path diagnostics
- [x] Add `NodeType::Null` handling in Arbor accessors (`is_null()` method)

---

### 1.5 JSON Parsing with simd-json

Parse JSON/JSONL into Arbor using simd-json, guided by the compiled schema.

#### 1.5.1 Parser Design

```rust
pub struct ArborBuilder {
    /// The schema guiding parsing
    schema: SchemaRegistry,

    /// Nodes being built (will be transferred to Arbor)
    nodes: Vec<Node>,

    /// Root node IDs (one per tree/document)
    roots: Vec<NodeId>,

    /// String interner (for object keys and interned strings)
    interner: StringInterner,

    /// Primitive value pools
    pools: PrimitivePools,
}

impl ArborBuilder {
    /// Create a builder with a compiled schema
    pub fn new(schema: SchemaRegistry) -> Self;

    /// Create a builder that infers schema from data
    pub fn new_infer() -> Self;

    /// Parse a single JSON document, add to arbor
    pub fn add_json(&mut self, json: &mut [u8]) -> Result<NodeId>;

    /// Parse JSONL (newline-delimited JSON), add all to arbor
    pub fn add_jsonl(&mut self, jsonl: &mut [u8]) -> Result<Vec<NodeId>>;

    /// Finish building, return the Arbor
    pub fn finish(self) -> Arbor;
}
```

#### 1.5.2 DFS Node Allocation

Nodes are allocated in depth-first order to ensure contiguous children:

```
Input: {"a": [1, 2], "b": 3}

Parse order (DFS):
  1. Start object (reserve slot 0)
  2. Enter "a" array (reserve slot 1)
  3. Parse 1 → slot 2
  4. Parse 2 → slot 3
  5. Complete array: children_start=2, children_count=2
  6. Parse "b": 3 → slot 4
  7. Complete object: children_start=1, children_count=2

Result:
  Node 0: Object, children_start=1, children_count=2
  Node 1: Array (key="a"), children_start=2, children_count=2
  Node 2: Int64, value=1
  Node 3: Int64, value=2
  Node 4: Int64 (key="b"), value=3
```

**Strategy:** Single-pass with deferred container completion.

```rust
struct ParseContext {
    /// Stack of containers being parsed
    container_stack: Vec<ContainerState>,
    /// Current data path (JSON Pointer into input data)
    /// Used for error messages: "/users/0/address/city"
    data_path: Vec<PathSegment>,
}

enum PathSegment {
    Field(String),   // Object key: "address"
    Index(usize),    // Array index: 0
}

impl ParseContext {
    fn push_field(&mut self, field: &str) {
        self.data_path.push(PathSegment::Field(field.to_string()));
    }

    fn push_index(&mut self, index: usize) {
        self.data_path.push(PathSegment::Index(index));
    }

    fn pop_path(&mut self) {
        self.data_path.pop();
    }

    fn data_path_string(&self) -> String {
        // Produces: "/users/0/address/city"
        let mut s = String::new();
        for seg in &self.data_path {
            match seg {
                PathSegment::Field(f) => { s.push('/'); s.push_str(f); }
                PathSegment::Index(i) => { s.push('/'); s.push_str(&i.to_string()); }
            }
        }
        if s.is_empty() { "/" .to_string() } else { s }
    }
}

struct ContainerState {
    /// NodeId of this container
    node_id: NodeId,
    /// First child's NodeId (set when first child added)
    children_start: Option<NodeId>,
    /// Count of children
    children_count: u32,
}

impl ArborBuilder {
    fn parse_value(&mut self, value: &Value, schema_id: SchemaId, ctx: &mut ParseContext) -> Result<NodeId> {
        let schema = self.schema.get(schema_id);

        match (value, &schema.storage) {
            // Type mismatch → error (not ETL, schema is authoritative)
            (Value::String(_), StorageType::Int64) => {
                Err(ArborsError::TypeMismatch {
                    expected: "integer",
                    got: "string",
                    path: schema.source_path.clone(),
                })
            }

            // Null handling
            (Value::Null, _) if schema.nullable => {
                Ok(self.add_null_node())
            }
            (Value::Null, _) => {
                Err(ArborsError::UnexpectedNull(schema.source_path.clone()))
            }

            // Primitives
            (Value::Bool(b), StorageType::Bool) => {
                let pool_idx = self.pools.add_bool(*b);
                Ok(self.add_primitive_node(NodeType::Bool, pool_idx))
            }
            (Value::Number(n), StorageType::Int64) => {
                let i = n.as_i64().ok_or_else(|| ArborsError::TypeMismatch {
                    expected: "integer",
                    got: "float",
                    path: schema.source_path.clone(),
                })?;
                let pool_idx = self.pools.add_i64(i);
                Ok(self.add_primitive_node(NodeType::Int64, pool_idx))
            }
            (Value::Number(n), StorageType::Float64) => {
                let f = n.as_f64().unwrap_or(f64::NAN);
                let pool_idx = self.pools.add_f64(f);
                Ok(self.add_primitive_node(NodeType::Float64, pool_idx))
            }
            (Value::String(s), StorageType::String { intern }) => {
                if *intern {
                    let intern_id = self.interner.intern(s);
                    Ok(self.add_interned_string_node(intern_id))
                } else {
                    let pool_idx = self.pools.add_string(s);
                    Ok(self.add_primitive_node(NodeType::String, pool_idx))
                }
            }

            // Containers
            (Value::Array(arr), StorageType::Array { items }) => {
                self.parse_array(arr, *items, ctx)
            }
            (Value::Array(arr), StorageType::Tuple { prefix_items, additional_items }) => {
                self.parse_tuple(arr, prefix_items, *additional_items, ctx)
            }
            (Value::Object(obj), StorageType::Object { properties, additional_properties }) => {
                self.parse_object(obj, properties, *additional_properties, ctx)
            }

            // Any type
            (_, StorageType::Any) => {
                self.parse_any(value, ctx)
            }

            // Boolean schema "false": reject everything
            (_, StorageType::Reject) => {
                Err(ArborsError::SchemaReject {
                    schema_path: schema.source_path.clone(),
                    data_path: ctx.data_path_string(),
                })
            }

            // Mismatch
            _ => Err(ArborsError::TypeMismatch {
                expected: schema.storage.expected_name(),
                got: value_type_name(value),
                schema_path: schema.source_path.clone(),
                data_path: ctx.data_path_string(),
            }),
        }
    }

    fn parse_object(
        &mut self,
        obj: &serde_json::Map<String, Value>,
        properties: &[ObjectProperty],
        additional_properties: Option<SchemaId>,
        ctx: &mut ParseContext,
    ) -> Result<NodeId> {
        // Reserve node for object
        let obj_node_id = self.reserve_node();
        ctx.container_stack.push(ContainerState::new(obj_node_id));

        // Collect and sort input keys to match property order
        let mut input_keys: Vec<&String> = obj.keys().collect();
        input_keys.sort();

        // Process properties in schema order (already sorted)
        for prop in properties {
            match obj.get(&prop.name) {
                Some(value) => {
                    let child_id = self.parse_value(value, prop.schema, ctx)?;
                    self.set_key_id(child_id, prop.name_id);
                    ctx.container_stack.last_mut().unwrap().add_child(child_id);
                }
                None if prop.required => {
                    return Err(ArborsError::MissingRequiredField(prop.name.clone()));
                }
                None => {
                    // Optional field missing: no node created
                }
            }
        }

        // Process additional properties (unknown keys)
        if let Some(additional_schema) = additional_properties {
            for key in obj.keys() {
                if properties.iter().any(|p| &p.name == key) {
                    continue; // Already processed
                }
                let value = &obj[key];
                let child_id = self.parse_value(value, additional_schema, ctx)?;
                let key_id = self.interner.intern(key);
                self.set_key_id(child_id, PropertyId(key_id));
                ctx.container_stack.last_mut().unwrap().add_child(child_id);
            }
        } else {
            // Closed object: unknown keys are errors
            for key in obj.keys() {
                if !properties.iter().any(|p| &p.name == key) {
                    return Err(ArborsError::UnknownProperty(key.clone()));
                }
            }
        }

        // Complete the object node
        let state = ctx.container_stack.pop().unwrap();
        self.complete_container(obj_node_id, NodeType::Object, state);

        Ok(obj_node_id)
    }

    fn parse_array(
        &mut self,
        arr: &[Value],
        items_schema: SchemaId,
        ctx: &mut ParseContext,
    ) -> Result<NodeId> {
        let arr_node_id = self.reserve_node();
        ctx.container_stack.push(ContainerState::new(arr_node_id));

        for item in arr {
            let child_id = self.parse_value(item, items_schema, ctx)?;
            ctx.container_stack.last_mut().unwrap().add_child(child_id);
        }

        let state = ctx.container_stack.pop().unwrap();
        self.complete_container(arr_node_id, NodeType::Array, state);

        Ok(arr_node_id)
    }

    fn parse_tuple(
        &mut self,
        arr: &[Value],
        prefix_items: &[SchemaId],
        additional_items: Option<SchemaId>,
        ctx: &mut ParseContext,
    ) -> Result<NodeId> {
        let arr_node_id = self.reserve_node();
        ctx.container_stack.push(ContainerState::new(arr_node_id));

        for (i, item) in arr.iter().enumerate() {
            let item_schema = if i < prefix_items.len() {
                // Within prefix: use positional schema
                prefix_items[i]
            } else {
                // Beyond prefix: use additional_items or error
                match additional_items {
                    Some(schema) => schema,
                    None => {
                        return Err(ArborsError::TupleOverflow {
                            expected: prefix_items.len(),
                            got: arr.len(),
                            path: format!("tuple at index {}", i),
                        });
                    }
                }
            };

            let child_id = self.parse_value(item, item_schema, ctx)?;
            ctx.container_stack.last_mut().unwrap().add_child(child_id);
        }

        // Note: tuples with fewer items than prefix are allowed
        // (missing items at end are simply not present)

        let state = ctx.container_stack.pop().unwrap();
        self.complete_container(arr_node_id, NodeType::Array, state);

        Ok(arr_node_id)
    }

    fn parse_any(&mut self, value: &Value, ctx: &mut ParseContext) -> Result<NodeId> {
        // Parse without schema guidance, inferring NodeType from value
        // IMPORTANT: Still enforce Arbor invariants (DFS order, sorted keys)
        match value {
            Value::Null => Ok(self.add_null_node()),
            Value::Bool(b) => {
                let pool_idx = self.pools.add_bool(*b);
                Ok(self.add_primitive_node(NodeType::Bool, pool_idx))
            }
            Value::Number(n) => {
                // Prefer integer if representable, else float
                if let Some(i) = n.as_i64() {
                    let pool_idx = self.pools.add_i64(i);
                    Ok(self.add_primitive_node(NodeType::Int64, pool_idx))
                } else {
                    let pool_idx = self.pools.add_f64(n.as_f64().unwrap_or(f64::NAN));
                    Ok(self.add_primitive_node(NodeType::Float64, pool_idx))
                }
            }
            Value::String(s) => {
                // No interning for Any (not schema-guided)
                let pool_idx = self.pools.add_string(s);
                Ok(self.add_primitive_node(NodeType::String, pool_idx))
            }
            Value::Array(arr) => {
                let arr_node_id = self.reserve_node();
                ctx.container_stack.push(ContainerState::new(arr_node_id));

                for item in arr {
                    let child_id = self.parse_any(item, ctx)?;
                    ctx.container_stack.last_mut().unwrap().add_child(child_id);
                }

                let state = ctx.container_stack.pop().unwrap();
                self.complete_container(arr_node_id, NodeType::Array, state);
                Ok(arr_node_id)
            }
            Value::Object(obj) => {
                let obj_node_id = self.reserve_node();
                ctx.container_stack.push(ContainerState::new(obj_node_id));

                // IMPORTANT: Sort keys for Arbor invariant
                let mut keys: Vec<&String> = obj.keys().collect();
                keys.sort();

                for key in keys {
                    let value = &obj[key];
                    let child_id = self.parse_any(value, ctx)?;
                    let key_id = self.interner.intern(key);
                    self.set_key_id(child_id, PropertyId(key_id));
                    ctx.container_stack.last_mut().unwrap().add_child(child_id);
                }

                let state = ctx.container_stack.pop().unwrap();
                self.complete_container(obj_node_id, NodeType::Object, state);
                Ok(obj_node_id)
            }
        }
    }
}
```

#### 1.5.3 simd-json Integration

simd-json requires mutable input and provides a tape-based API for maximum performance:

```rust
impl ArborBuilder {
    pub fn add_json(&mut self, json: &mut [u8]) -> Result<NodeId> {
        // Use simd-json's borrowed value API (simpler than tape for first impl)
        let value: simd_json::BorrowedValue = simd_json::to_borrowed_value(json)
            .map_err(|e| ArborsError::ParseError(e.to_string()))?;

        let mut ctx = ParseContext::new();
        let root_schema = SchemaId::ROOT;
        let root_id = self.parse_borrowed_value(&value, root_schema, &mut ctx)?;
        self.roots.push(root_id);

        Ok(root_id)
    }

    pub fn add_jsonl(&mut self, jsonl: &mut [u8]) -> Result<Vec<NodeId>> {
        let mut roots = Vec::new();

        // Split by newlines, parse each
        for line in jsonl.split_mut(|&b| b == b'\n') {
            if line.is_empty() || line.iter().all(|&b| b.is_ascii_whitespace()) {
                continue;
            }
            let root_id = self.add_json(line)?;
            roots.push(root_id);
        }

        Ok(roots)
    }
}
```

#### 1.5.4 Implementation Tasks

- [x] Implement `ArborBuilder::new()` and `new_infer()`
- [x] Implement `add_json()` with simd-json borrowed value API
- [x] Implement `add_jsonl()` with line splitting
- [x] Implement `ParseContext` with data path tracking
- [x] Implement `parse_value()` dispatcher with path push/pop
- [x] Implement `parse_object()` with property matching and ordering
- [x] Implement required field validation (missing required → `MissingRequiredField` error)
- [x] Implement `parse_array()` and `parse_tuple()` with index tracking
- [x] Implement `parse_any()` for untyped values
- [x] Implement container completion (set children_start, children_count)
- [x] Implement `finish()` to create Arbor
- [x] Add error types with dual-path diagnostics (completed in Phase 1.4):
  ```rust
  pub enum ArborsError {
      TypeMismatch {
          expected: &'static str,
          got: &'static str,
          schema_path: String,  // JSON Pointer in schema: "#/properties/age"
          data_path: String,    // JSON Pointer in data: "/users/0/age"
      },
      MissingRequiredField {
          field: String,
          schema_path: String,
          data_path: String,
      },
      UnexpectedNull {
          schema_path: String,
          data_path: String,
      },
      UnknownProperty {
          property: String,
          schema_path: String,
          data_path: String,
      },
      TupleOverflow {
          expected: usize,
          got: usize,
          schema_path: String,
          data_path: String,
      },
      UnsupportedKeyword {
          keyword: String,
          schema_path: String,
      },
      SchemaReject {
          schema_path: String,  // Location of boolean "false" schema
          data_path: String,    // Location in data that was rejected
      },
      ParseError(String),
      InvalidSchema(String),
  }
  ```

---

### 1.6 Arbor Operations

Basic API for traversing and querying a Arbor.

#### 1.6.1 Core API

```rust
impl Arbor {
    // --- Construction ---

    /// Number of root trees (JSONL rows)
    pub fn num_trees(&self) -> usize;

    /// Get root node of tree at index
    pub fn root(&self, index: usize) -> Option<NodeId>;

    /// Iterate all root nodes
    pub fn roots(&self) -> impl Iterator<Item = NodeId>;

    // --- Node Access ---

    /// Get node by ID
    pub fn get_node(&self, id: NodeId) -> Option<&Node>;

    /// Get node type
    pub fn node_type(&self, id: NodeId) -> NodeType;

    /// Get parent node (None for roots)
    pub fn parent(&self, id: NodeId) -> Option<NodeId>;

    // --- Children ---

    /// Number of children (0 for primitives)
    pub fn child_count(&self, id: NodeId) -> u32;

    /// Get child by index (O(1) for arrays and objects)
    pub fn child_at(&self, id: NodeId, index: usize) -> Option<NodeId>;

    /// Iterate children
    pub fn children(&self, id: NodeId) -> impl Iterator<Item = NodeId>;

    // --- Object Field Access ---

    /// Get field by name (O(log n) binary search)
    pub fn get_field(&self, object_id: NodeId, key: &str) -> Option<NodeId>;

    /// Get field by interned key ID (O(log n) binary search)
    pub fn get_field_by_id(&self, object_id: NodeId, key_id: InternId) -> Option<NodeId>;

    /// Iterate field keys
    pub fn field_keys(&self, object_id: NodeId) -> impl Iterator<Item = &str>;

    // --- Value Extraction ---

    /// Check if node is null
    pub fn is_null(&self, id: NodeId) -> bool;

    /// Get boolean value
    pub fn get_bool(&self, id: NodeId) -> Option<bool>;

    /// Get i64 value
    pub fn get_i64(&self, id: NodeId) -> Option<i64>;

    /// Get f64 value
    pub fn get_f64(&self, id: NodeId) -> Option<f64>;

    /// Get string value
    pub fn get_string(&self, id: NodeId) -> Option<&str>;

    /// Get interned string value
    pub fn get_interned_string(&self, id: NodeId) -> Option<&str>;

    // --- Key Access ---

    /// Get key name (for object children)
    pub fn key(&self, id: NodeId) -> Option<&str>;

    /// Get key ID (for object children)
    pub fn key_id(&self, id: NodeId) -> Option<InternId>;
}
```

#### 1.6.2 Field Lookup Implementation

Object children are stored sorted by key. Binary search finds fields:

```rust
impl Arbor {
    pub fn get_field(&self, object_id: NodeId, key: &str) -> Option<NodeId> {
        // Intern the key (returns None if not in interner)
        let key_id = self.interner.get(key)?;
        self.get_field_by_id(object_id, key_id)
    }

    pub fn get_field_by_id(&self, object_id: NodeId, key_id: InternId) -> Option<NodeId> {
        let node = self.get_node(object_id)?;
        if node.node_type() != NodeType::Object {
            return None;
        }

        let start = node.children_start();
        let count = node.children_count();

        // Binary search children by key_id
        let children: Vec<NodeId> = (start..start + count)
            .map(|i| NodeId(i))
            .collect();

        children.binary_search_by(|&child_id| {
            let child = self.get_node(child_id).unwrap();
            child.key_id().cmp(&key_id)
        })
        .ok()
        .map(|idx| children[idx])
    }
}
```

#### 1.6.3 Implementation Tasks

- [x] Implement `Arbor` struct with nodes, roots, interner, pools
- [x] Implement `num_trees()`, `root()`, `roots()`
- [x] Implement `get_node()`, `node_type()`, `parent()`
- [x] Implement `child_count()`, `child_at()`, `children()`
- [x] Implement `get_field()` with binary search (returns `None` for missing fields)
- [x] Implement `get_field_by_id()` for pre-interned keys (returns `None` for missing fields)
- [x] Implement `field_keys()`
- [x] Implement `is_null()`, `get_bool()`, `get_i64()`, `get_f64()`, `get_string()`
- [x] Implement `get_interned_string()` for enum values
- [x] Implement `key()`, `key_id()`

**Note:** The parser uses a reserve-then-fill allocation strategy to ensure contiguous children for all containers, including nested containers. When parsing a container, all direct child node slots are reserved first, then each child is filled (which may recursively reserve grandchildren). This ensures `child_at()` works correctly for all cases, including deeply nested arrays and objects.

---

### 1.7 Simple Path Queries

Minimal query API for common access patterns:

```rust
impl Arbor {
    /// Access nested field: "foo.bar.baz" → get_field(get_field(root, "foo"), "bar")...
    pub fn get_path(&self, root: NodeId, path: &str) -> Option<NodeId> {
        let mut current = root;
        for segment in path.split('.') {
            // Check for array index: "items[0]"
            if let Some((field, idx)) = parse_array_access(segment) {
                current = self.get_field(current, field)?;
                current = self.child_at(current, idx)?;
            } else {
                current = self.get_field(current, segment)?;
            }
        }
        Some(current)
    }

    /// Get all values at path across all trees
    pub fn query_path(&self, path: &str) -> Vec<NodeId> {
        self.roots()
            .filter_map(|root| self.get_path(root, path))
            .collect()
    }
}

fn parse_array_access(segment: &str) -> Option<(&str, usize)> {
    // "items[0]" → Some(("items", 0))
    let bracket = segment.find('[')?;
    let field = &segment[..bracket];
    let idx_str = segment[bracket + 1..].strip_suffix(']')?;
    let idx = idx_str.parse().ok()?;
    Some((field, idx))
}
```

#### 1.7.1 Implementation Tasks

- [x] Implement `get_path()` with dot notation
- [x] Implement array index syntax `field[0]`
- [x] Implement `query_path()` for multi-tree queries

---

### 1.8 Schema Inference (Minimal)

Basic schema inference for when no schema is provided:

```rust
impl SchemaRegistry {
    /// Infer schema from a sample of JSON values
    pub fn infer(samples: &[&Value]) -> Self {
        let mut compiler = InferenceCompiler::new();

        for sample in samples {
            compiler.observe(sample);
        }

        compiler.finish()
    }
}

struct InferenceCompiler {
    /// Observed types at each path
    observations: HashMap<String, TypeObservation>,
}

struct TypeObservation {
    /// Types seen at this path
    types_seen: HashSet<&'static str>,
    /// For objects: observed properties with (observation, times_present)
    properties: HashMap<String, (TypeObservation, usize)>,
    /// For arrays: observed item types
    items: Option<Box<TypeObservation>>,
    /// Number of times this path was observed (for required detection)
    count: usize,
}

impl InferenceCompiler {
    fn observe(&mut self, value: &Value) {
        self.observe_at_path(value, "#".to_string());
    }

    fn observe_at_path(&mut self, value: &Value, path: String) {
        let obs = self.observations.entry(path.clone()).or_default();
        obs.count += 1;

        match value {
            Value::Null => { obs.types_seen.insert("null"); }
            Value::Bool(_) => { obs.types_seen.insert("boolean"); }
            Value::Number(n) => {
                if n.is_i64() { obs.types_seen.insert("integer"); }
                else { obs.types_seen.insert("number"); }
            }
            Value::String(_) => { obs.types_seen.insert("string"); }
            Value::Array(arr) => {
                obs.types_seen.insert("array");
                for (i, item) in arr.iter().enumerate() {
                    self.observe_at_path(item, format!("{}[*]", path));
                }
            }
            Value::Object(obj) => {
                obs.types_seen.insert("object");
                for (key, val) in obj {
                    self.observe_at_path(val, format!("{}.{}", path, key));
                }
            }
        }
    }

    fn finish(self) -> SchemaRegistry {
        // Build schema from observations using these rules:
        //
        // Type resolution:
        // - If only one type seen: use that type
        // - If integer + number seen: use Float64 (numeric promotion)
        // - If type + null seen: set nullable = true, use non-null type
        // - If multiple incompatible types: use Any (rare, indicates bad data)
        //
        // Required detection (per object path):
        // - Property is required if: property.times_present == parent_object.count
        // - Property is optional if: property.times_present < parent_object.count
        //
        // Example:
        //   3 objects observed at "#/items[*]"
        //   "name" present 3 times → required
        //   "email" present 2 times → optional
        //   "age" present 1 time → optional
        //
        todo!()
    }
}
```

#### 1.8.1 Implementation Tasks

- [x] Implement `TypeObservation` with per-object property tracking
- [x] Implement `observe()` recursive descent with count tracking
- [x] Implement `finish()` to build schema from observations
- [x] Handle numeric promotion: integer + number → Float64
- [x] Handle nullable detection: type + null → nullable = true
- [x] Detect required vs optional: property.times_present == parent.count → required
- [x] Handle incompatible types: fall back to Any

---

### 1.9 Tests

#### Unit Tests

**Schema Compiler:**
- [x] Compile primitive types (null, bool, integer, number, string)
- [x] Compile object with properties and required
- [x] Compile object with additionalProperties: false
- [x] Compile array with items
- [x] Compile tuple with prefixItems
- [x] Compile tuple with prefixItems + items
- [x] Compile enum (all strings → intern: true)
- [x] Compile const
- [x] Compile nullable type `["string", "null"]`
- [x] Compile $ref to $defs
- [x] Compile recursive schema (e.g., tree node with $ref to self)
- [x] Error on unsupported multi-type union `["string", "integer"]`
- [x] Error on remote $ref
- [x] Error on unsupported keywords (oneOf, anyOf, allOf, etc.)
- [x] Verify no UnresolvedRef in final registry
- [x] Boolean schema `true` compiles to `SchemaId::ANY`
- [x] Boolean schema `false` compiles to `StorageType::Reject`

**Parsing:**
- [x] Parse primitives against schema
- [x] Parse object with all required fields
- [x] Parse object with optional fields missing
- [x] Parse object with additional properties (open)
- [x] Error on object with unknown property (closed)
- [x] Error on type mismatch (schema says integer, data has string)
- [x] Error on missing required field
- [x] Parse null where nullable: true
- [x] Error on null where nullable: false
- [x] Parse array with homogeneous items
- [x] Parse tuple with correct types
- [x] Parse tuple with fewer items than prefix (allowed)
- [x] Parse tuple with additional items beyond prefix (when allowed)
- [x] Error on tuple overflow (more items than prefix, no additional_items)
- [x] Parse Any schema: verify sorted keys, DFS order maintained
- [x] Parse nested Any: objects within arrays within objects
- [x] Error on any value against `StorageType::Reject` (boolean schema false)

**Arbor Operations:**
- [x] Get root by index
- [x] Iterate children of object
- [x] Iterate children of array
- [x] Get field by name (binary search)
- [x] Get field returns None for missing
- [x] Get primitive values (bool, i64, f64, string)
- [x] Get interned string value
- [x] Get path "a.b.c" (Phase 1.7)
- [x] Get path with array index "a[0].b" (Phase 1.7)

**Schema Inference:**
- [x] Infer primitive types correctly
- [x] Infer object with all properties required (present in all samples)
- [x] Infer object with optional properties (present in some samples)
- [x] Numeric promotion: int + float → Float64
- [x] Nullable detection: type + null → nullable
- [x] Infer array item schema from elements

#### Integration Tests

- [x] Parse real-world JSON (GitHub event, package.json, etc.)
- [x] Parse JSONL with multiple documents
- [x] Round-trip: JSON → Arbor → reconstruct JSON
- [x] Schema inference from sample data matches manual schema

#### Benchmarks

- [ ] Parse 100MB JSONL (compare to raw simd-json)
- [ ] Field lookup on deep objects
- [ ] Iterate all values at path across 1M rows

---

### 1.10 Success Criteria

Phase 1 is complete when:

1. **Schema compilation works** for the supported subset:
   - Primitives, objects, arrays, tuples, enum/const, nullable, $ref/$defs
   - Clear error on unsupported features

2. **Parsing works** with schema enforcement:
   - Type mismatches → error
   - Missing required → error
   - Additional properties handled correctly

3. **Arbor is queryable:**
   - Field access by name (binary search)
   - Value extraction for all primitives
   - Path queries work

4. **End-to-end demo:**
   ```rust
   let schema = SchemaCompiler::compile(&schema_json)?;
   let mut builder = ArborBuilder::new(schema);
   builder.add_jsonl(&mut jsonl_bytes)?;
   let arbor = builder.finish();

   for root in arbor.roots() {
       if let Some(name) = arbor.get_path(root, "user.name") {
           println!("{}", arbor.get_string(name).unwrap());
       }
   }
   ```

5. **Performance baseline:**
   - Parse 100MB JSONL in < 2 seconds
   - Field lookup < 500ns for objects with < 50 fields

---

## Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `arrow` | 54 | Primitive arrays, null bitmaps |
| `arrow-array` | 54 | Array builders |
| `arrow-buffer` | 54 | Memory management |
| `simd-json` | 0.17 | Fast JSON parsing |
| `serde_json` | 1.0 | JSON Schema parsing |
| `jsonschema` | 0.26 | Full validation (Phase 2) |
| `hashbrown` | 0.16 | Fast hash map for interner |
| `thiserror` | 2.0 | Error types |
| `regex` | 1.0 | Pattern matching (Phase 2) |

---

## References

- [simd-json documentation](https://docs.rs/simd-json/)
- [arrow-rs documentation](https://docs.rs/arrow/)
- [JSON Schema 2020-12 spec](https://json-schema.org/draft/2020-12)
- Design discussions: `docs/arbors-0.txt`, `docs/arbors-1.txt`
