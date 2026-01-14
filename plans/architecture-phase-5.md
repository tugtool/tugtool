# Arbors Architecture Plan: Phase 5: Python Bindings (v0)

This document outlines the Phase 5: Python Bindings (v0) plan for Arbors.

## Phase 5: Python Bindings (v0)

**Goal:** Early Python API to iterate on design with real usage feedback.

*Moved earlier in roadmap to enable API iteration.*

*Design principle: The API should feel Pythonic, not like wrapped Rust. Users should never feel they're fighting the type system.*

---

## Critical Design Decision: API Philosophy

Before implementing, we must establish the API design philosophy:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Python User Experience                       │
│  arbor = arbors.parse_json(data)                              │
│  for tree in arbor:                                            │
│      name = tree["user"]["name"].value                          │
│      print(name)                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼  (PyO3 bridge)
┌─────────────────────────────────────────────────────────────────┐
│                       Rust Implementation                        │
│  Arbor, Node, NodeId, ArborsSchema, etc.                      │
│  High-performance core with zero-copy where possible            │
└─────────────────────────────────────────────────────────────────┘
```

**Key Invariant:** Python users work with high-level abstractions (`Arbor`, `Node`). They should never need to manage `NodeId` manually unless they want to.

This mirrors:
- DataFrame libraries: DataFrame/Series hide internal column references
- pandas: Index/loc abstracted behind `[]` operators
- NumPy: Array views feel like native Python sequences

---

## Critical Design Decision: Node Lifetime Invariant

**The Lifetime Problem:** Python can store `Node` objects after the `Arbor` is garbage collected:

```python
tree = arbor[0]
del arbor
tree['name']  # Could segfault without proper lifetime management!
```

**The Solution:** Every `PyNode` owns a strong reference (`Py<PyArbor>`) to its parent arbor:

```rust
#[pyclass]
pub struct PyNode {
    arbor: Py<PyArbor>,  // Strong reference ensures Arbor outlives Node
    node_id: NodeId,
}
```

**Invariants:**
1. A `PyNode` owns a `Py<PyArbor>`, ensuring the Arbor lives at least as long as any Node.
2. A Arbor holds no references to Nodes.
3. This allows safe, cheap node copies.

All Node operations must acquire an immutable borrow:

```rust
fn value(&self, py: Python<'_>) -> PyResult<PyObject> {
    let arbor_ref = self.arbor.borrow(py);
    arbor_ref.get_node(self.node_id)
    // ...
}
```

This is the same pattern used by Polars, Arrow, and other high-performance Python bindings.

---

## Critical Design Decision: Type Inference Rules

**The Problem:** Should `parse_json(data)` (with no schema) automatically detect temporal patterns in strings?

**The Decision:** NO. Basic inference only, temporal types require explicit schema.

**Rationale:**
1. Implicit temporal detection leads to brittle behavior ("2024-01-15" might be a product ID, not a date)
2. Users who want temporal parsing should be explicit
3. Consistent with Polars' approach

**Inference Behavior (schema=None):**
| JSON Token | Arbors Type |
|------------|--------------|
| `null` | NULL |
| `true`/`false` | BOOL |
| `123` (integer) | INT64 |
| `123.45` (decimal) | FLOAT64 |
| `"string"` | STRING (never DATE/DATETIME) |
| `[...]` | ARRAY |
| `{...}` | OBJECT |

**To get temporal types, users must:**
```python
# Option 1: Provide explicit schema
schema = ArborsSchema.object([
    Field.required_field("created", ArborsType.DATETIME),
])
arbor = arbors.parse_json(data, schema=schema)

# Option 2: Use infer_schema() with temporal detection
schema = arbors.infer_schema(data, infer_temporal=True)
arbor = arbors.parse_json(data, schema=schema)
```

**Key Invariant:** Temporal inference only happens when building a schema via `infer_schema()`. The parsing functions (`parse_json`, `parse_jsonl`) never perform temporal inference on their own — they either use the provided schema or do basic JSON-token inference.

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `pyo3` | 0.23 | Rust-Python bindings |
| `maturin` | >=1.7 | Build tool |
| `pytest` | >=7.0 | Testing |
| `mypy` | >=1.0 | Type checking (dev) |

---

## References

- [PyO3 User Guide](https://pyo3.rs/)
- [Maturin Documentation](https://www.maturin.rs/)
- [Polars Python API](https://docs.pola.rs/api/python/) - API design inspiration
- [PEP 561 - Type Stubs](https://peps.python.org/pep-0561/)
- Phase 4 plan: `architecture-phase-4.md`

---

### 5.0 Project Setup (PREREQUISITE)

**Goal:** Establish proper Python project structure with maturin, pytest, and type stubs.

#### 5.0.1 Package Structure

The Python package should follow standard conventions:

```
python/
├── Cargo.toml              # Rust crate for PyO3 bindings
├── pyproject.toml          # Python packaging (maturin)
├── src/
│   └── lib.rs              # Main PyO3 module definition
├── arbors/                # Python package directory
│   ├── __init__.py         # Re-exports from native module
│   ├── py.typed            # PEP 561 marker for type checking
│   └── _arbors.pyi        # Type stubs for IDE support
└── tests/
    ├── conftest.py         # pytest fixtures
    ├── test_parsing.py     # Parsing tests
    ├── test_arbor.py      # Arbor API tests
    ├── test_node.py        # Node API tests
    └── test_schema.py      # Schema tests
```

#### 5.0.2 Module Naming

The package name should be `arbors` (not `arbors-python`):

```python
import arbors

arbor = arbors.parse_json('{"name": "Alice"}')
```

**Current pyproject.toml issue:** Package name is `arbors-python`, module name is `arbors_python`. This should be unified to `arbors`.

#### 5.0.3 Dependencies Update

Update `python/Cargo.toml`:

```toml
[package]
name = "arbors"
version.workspace = true
edition.workspace = true

[lib]
name = "_arbors"  # Native module name (prefixed with _)
crate-type = ["cdylib"]

[dependencies]
arbors.workspace = true
pyo3 = { version = "0.23", features = ["extension-module"] }
```

Update `python/pyproject.toml`:

```toml
[project]
name = "arbors"
version = "0.1.0"
description = "High-performance JSON processing - like Polars for JSON"
requires-python = ">=3.9"
classifiers = [
    "Programming Language :: Rust",
    "Programming Language :: Python :: Implementation :: CPython",
    "Programming Language :: Python :: 3.9",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Python :: 3.13",
    "License :: OSI Approved :: MIT License",
    "Development Status :: 3 - Alpha",
]

[tool.maturin]
features = ["pyo3/extension-module"]
module-name = "arbors._arbors"
python-source = "."
```

#### 5.0.4 Python Package Init

Create `python/arbors/__init__.py`:

```python
"""Arbors: High-performance JSON processing."""

from arbors._arbors import (
    Arbor,
    Node,
    ArborsSchema,
    ArborsType,
    parse_json,
    parse_jsonl,
    infer_schema,
)

__version__ = "0.1.0"
__all__ = [
    "Arbor",
    "Node",
    "ArborsSchema",
    "ArborsType",
    "parse_json",
    "parse_jsonl",
    "infer_schema",
]
```

#### 5.0.5 Implementation Tasks

- [x] Rename package from `arbors-python` to `arbors`
- [x] Create `python/arbors/` directory structure
- [x] Create `python/arbors/__init__.py` with re-exports
- [x] Create `python/arbors/py.typed` marker file
- [x] Update `python/Cargo.toml` with correct lib name
- [x] Update `python/pyproject.toml` with module-name and python-source
- [x] Create `python/tests/conftest.py` with pytest fixtures
- [x] Verify `maturin develop` works
- [x] Verify `import arbors` works in Python

---

### 5.1 Core Type Bindings

**Goal:** Expose fundamental Rust types to Python with proper memory management.

#### 5.1.1 NodeType Enum

Expose the node type enumeration:

```python
class NodeType:
    """Type of a node in the Arbor."""
    NULL: NodeType
    BOOL: NodeType
    INT64: NodeType
    FLOAT64: NodeType
    STRING: NodeType
    ARRAY: NodeType
    OBJECT: NodeType
    DATE: NodeType
    DATETIME: NodeType
    DURATION: NodeType
    BINARY: NodeType

    @property
    def name(self) -> str:
        """Human-readable type name."""
        ...

    def is_container(self) -> bool:
        """True if this type can have children (Array or Object)."""
        ...

    def is_primitive(self) -> bool:
        """True if this type is a leaf (no children)."""
        ...

    def is_temporal(self) -> bool:
        """True if this type represents time (Date, DateTime, Duration)."""
        ...
```

#### 5.1.2 ArborsType Enum

Expose the semantic type system:

```python
class ArborsType:
    """Arbors's native type system for schema definitions."""
    NULL: ArborsType
    BOOL: ArborsType
    INT64: ArborsType
    FLOAT64: ArborsType
    STRING: ArborsType
    DATE: ArborsType
    DATETIME: ArborsType
    DURATION: ArborsType
    BINARY: ArborsType
    ANY: ArborsType

    @staticmethod
    def array(items: ArborsType) -> ArborsType:
        """Create an array type with the given item type."""
        ...

    @staticmethod
    def object(fields: list[tuple[str, ArborsType]]) -> ArborsType:
        """Create an object type with the given fields."""
        ...

    @property
    def name(self) -> str:
        """Type name string (e.g., 'int64', 'datetime')."""
        ...
```

#### 5.1.3 Field Class

Expose field definitions for schemas:

```python
class Field:
    """Field definition for object schemas."""

    def __init__(
        self,
        name: str,
        dtype: ArborsType,
        *,
        nullable: bool = False,
        required: bool = True,
    ) -> None: ...

    @property
    def name(self) -> str: ...

    @property
    def dtype(self) -> ArborsType: ...

    @property
    def nullable(self) -> bool: ...

    @property
    def required(self) -> bool: ...

    @staticmethod
    def required_field(name: str, dtype: ArborsType) -> Field:
        """Create a required, non-nullable field."""
        ...

    @staticmethod
    def optional_field(name: str, dtype: ArborsType) -> Field:
        """Create an optional, nullable field."""
        ...
```

#### 5.1.4 Implementation Tasks

- [x] Implement `PyNodeType` enum with PyO3 `#[pyclass]`
- [x] Add `NodeType` class methods: `name`, `is_container`, `is_primitive`, `is_temporal`
- [x] Implement `PyArborsType` enum with variant constructors
- [x] Add `ArborsType.array()` and `ArborsType.object()` static methods
- [x] Implement `PyField` class with constructor and properties
- [x] Add `Field.required_field()` and `Field.optional_field()` static methods
- [x] Unit tests for type enums in Python

---

### 5.2 ArborsSchema Bindings

**Goal:** Expose schema construction and manipulation.

#### 5.2.1 ArborsSchema Class

```python
class ArborsSchema:
    """Schema definition for typed JSON parsing."""

    def __init__(self, root: ArborsType) -> None:
        """Create a schema with the given root type."""
        ...

    @staticmethod
    def object(fields: list[Field]) -> ArborsSchema:
        """Create an object schema with the given fields."""
        ...

    @staticmethod
    def array(item_type: ArborsType) -> ArborsSchema:
        """Create an array schema with the given item type."""
        ...

    @staticmethod
    def any() -> ArborsSchema:
        """Create a schema that accepts any type."""
        ...

    @staticmethod
    def from_json_schema(schema: dict | str) -> ArborsSchema:
        """Import a schema from JSON Schema format.

        This method delegates to the Rust JSON Schema importer, which:
        1. Parses the JSON Schema (if string)
        2. Converts JSON Schema types to ArborsType
        3. Returns an ArborsSchema object

        The conversion path is:
            JSON Schema (dict/str)
                → Rust json_schema_importer
                → ArborsSchema

        Args:
            schema: JSON Schema as dict or JSON string

        Returns:
            ArborsSchema compiled from the JSON Schema

        Raises:
            SchemaError: If the JSON Schema uses unsupported features
        """
        ...

    @property
    def root(self) -> ArborsType:
        """The root type of this schema."""
        ...

    @property
    def name(self) -> str | None:
        """Optional schema name."""
        ...

    def with_name(self, name: str) -> ArborsSchema:
        """Return a copy with the given name."""
        ...

    def validate(self) -> None:
        """Validate the schema is well-formed.

        Raises:
            ValueError: If the schema has duplicate fields or other issues
        """
        ...

    def get_field(self, name: str) -> Field | None:
        """Get a field by name (for object schemas)."""
        ...

    def num_fields(self) -> int:
        """Number of fields (for object schemas, 0 otherwise)."""
        ...

    def to_json(self) -> str:
        """Serialize schema to JSON string."""
        ...
```

#### 5.2.2 Implementation Tasks

- [x] Implement `PyArborsSchema` class with PyO3
- [x] Add constructor `__init__(root: ArborsType)`
- [x] Add static methods: `object()`, `array()`, `any()`
- [x] Implement `from_json_schema()` accepting dict or str
- [x] Add properties: `root`, `name`
- [x] Add methods: `with_name()`, `validate()`, `get_field()`, `num_fields()`, `to_json()`
- [x] Unit tests for schema construction
- [x] Unit tests for JSON Schema import

---

### 5.3 Arbor Bindings

**Goal:** Expose the Arbor container with Pythonic iteration.

#### 5.3.1 Arbor Class

```python
class Arbor:
    """Collection of parsed JSON trees.

    A Arbor is the primary container for parsed JSON/JSONL data. Each row in
    a JSONL file becomes a tree in the arbor.

    Arbors are iterable and support indexing:

    ```python
    arbor = arbors.parse_jsonl(data)

    # Iteration
    for tree in arbor:
        print(tree["name"].value)

    # Indexing
    first_tree = arbor[0]
    last_tree = arbor[-1]

    # Length
    num_trees = len(arbor)
    ```
    """

    def __len__(self) -> int:
        """Number of trees (rows) in the arbor."""
        ...

    def __getitem__(self, index: int) -> Node:
        """Get root node of tree at index.

        Supports negative indexing: arbor[-1] returns the last tree.

        Raises:
            IndexError: If index is out of bounds
        """
        ...

    def __iter__(self) -> Iterator[Node]:
        """Iterate over root nodes of all trees."""
        ...

    @property
    def num_trees(self) -> int:
        """Number of trees in the arbor (alias for len())."""
        ...

    @property
    def num_rows(self) -> int:
        """Number of rows in the arbor (alias for len())."""
        ...

    @property
    def num_nodes(self) -> int:
        """Total number of nodes across all trees."""
        ...

    def root(self, index: int) -> Node | None:
        """Get root node of tree at index, or None if out of bounds."""
        ...

    def to_json(self) -> str:
        """Serialize to JSON string.

        If the arbor has one tree, returns a JSON value.
        If the arbor has multiple trees, returns a JSON array.
        """
        ...

    def to_json_pretty(self) -> str:
        """Serialize to pretty-printed JSON string."""
        ...

    def to_typed_json(self) -> str:
        """Serialize to typed JSON format with type annotations."""
        ...

    # === Schema Access ===

    @property
    def schema(self) -> ArborsSchema | None:
        """The schema used to parse this arbor, or None if schema-less.

        Enables introspection of the arbor's type structure:

        ```python
        arbor = arbors.parse_json(data, schema=schema)
        if arbor.schema:
            print(arbor.schema.to_json())
            field = arbor.schema.get_field("name")
        ```
        """
        ...

    # === Path Navigation ===

    def get_path(self, path: str) -> Node | None:
        """Navigate to a node using path syntax starting from a tree root.

        Path syntax:
        - "0.user.name" - Tree index, then nested field access
        - "0.items[2]" - Tree index, field, then array index
        - "[0].email" - Bracket syntax for tree index

        This is a convenience for:
        ```python
        arbor[0]["user"]["name"]  # equivalent to arbor.get_path("0.user.name")
        ```

        Returns:
            Node at path, or None if path doesn't exist
        """
        ...
```

#### 5.3.2 Implementation Tasks

- [x] Implement `PyArbor` class wrapping `Arbor`
- [x] Implement `__len__` returning `num_trees()`
- [x] Implement `__getitem__` with negative index support
- [x] Implement `__iter__` yielding `PyNode` for each root
- [x] Add properties: `num_trees`, `num_rows`, `num_nodes`
- [x] Add `schema` property returning `Optional[PyArborsSchema]`
- [x] Add `root(index)` method returning `Optional[PyNode]`
- [x] Add `get_path(path)` method for path-based navigation
- [x] Add serialization methods: `to_json()`, `to_json_pretty()` (see 5.11)
- [x] Unit tests for iteration
- [x] Unit tests for indexing (positive and negative)
- [x] Unit tests for `get_path()` navigation

---

### 5.4 Node Bindings

**Goal:** Expose Node with intuitive value access and navigation.

#### 5.4.1 Node Class

```python
class Node:
    """A node in the Arbor representing a JSON value.

    Nodes provide access to JSON values and their children. For objects,
    field access uses dictionary-style indexing:

    ```python
    # Access object fields
    name = node["name"].value
    email = node["user"]["email"].value

    # Access array elements
    first_item = node[0]
    last_item = node[-1]

    # Check type
    if node.type == NodeType.OBJECT:
        for key in node.keys():
            print(key, node[key].value)
    ```
    """

    @property
    def type(self) -> NodeType:
        """The type of this node."""
        ...

    @property
    def type_name(self) -> str:
        """Human-readable type name string."""
        ...

    @property
    def value(self) -> bool | int | float | str | bytes | None:
        """The primitive value of this node.

        Returns:
            - None for Null nodes
            - bool for Bool nodes
            - int for Int64 nodes
            - float for Float64 nodes
            - str for String, Date, DateTime, Duration nodes (ISO 8601 format)
            - bytes for Binary nodes
            - None for container nodes (Array, Object) - use children instead

        For temporal types, returns ISO 8601 string representation.
        Use `date_value`, `datetime_value`, `duration_value` for typed access.
        """
        ...

    @property
    def date_value(self) -> datetime.date | None:
        """Get date value as Python date object (Date nodes only)."""
        ...

    @property
    def datetime_value(self) -> datetime.datetime | None:
        """Get datetime value as Python datetime object (DateTime nodes only)."""
        ...

    @property
    def duration_value(self) -> datetime.timedelta | None:
        """Get duration value as Python timedelta object (Duration nodes only)."""
        ...

    def is_null(self) -> bool:
        """True if this node is an explicit JSON null."""
        ...

    def is_container(self) -> bool:
        """True if this node is an Array or Object."""
        ...

    # === Typed Value Accessors ===

    def as_bool(self) -> bool:
        """Get value as bool, raising TypeError if not a Bool node."""
        ...

    def as_int(self) -> int:
        """Get value as int, raising TypeError if not an Int64 node."""
        ...

    def as_float(self) -> float:
        """Get value as float, raising TypeError if not a Float64 node."""
        ...

    def as_str(self) -> str:
        """Get value as str, raising TypeError if not a String node."""
        ...

    def as_bytes(self) -> bytes:
        """Get value as bytes, raising TypeError if not a Binary node."""
        ...

    # === Container Access ===

    def __len__(self) -> int:
        """Number of children (0 for primitives)."""
        ...

    def __getitem__(self, key: str | int) -> Node:
        """Get child by field name (objects) or index (arrays).

        Args:
            key: Field name (str) for objects, or index (int) for arrays

        Returns:
            Child node

        Raises:
            KeyError: If field name not found (objects)
            IndexError: If index out of bounds (arrays)
            TypeError: If key type doesn't match node type

        Note:
            Integer indexing is only supported for arrays, not objects.
            This matches Python dict behavior. Use `list(node.keys())[i]`
            if you need positional key access on objects.
        """
        ...

    def __contains__(self, key: str) -> bool:
        """Check if object contains field (objects only)."""
        ...

    def __iter__(self) -> Iterator[Node]:
        """Iterate over children.

        For arrays: yields each element in order.
        For objects: yields each field value in sorted key order.
        For primitives: empty iterator.
        """
        ...

    def get(self, key: str, default: Node | None = None) -> Node | None:
        """Get field by name, returning default if not found."""
        ...

    def keys(self) -> Iterator[str]:
        """Iterate over field keys (objects only)."""
        ...

    def values(self) -> Iterator[Node]:
        """Iterate over field values (objects) or elements (arrays)."""
        ...

    def items(self) -> Iterator[tuple[str, Node]]:
        """Iterate over (key, value) pairs (objects only)."""
        ...

    # === Navigation ===

    @property
    def parent(self) -> Node | None:
        """Parent node, or None if this is a root.

        Note: Parent lookup is O(1) due to stored parent IDs in the Arbor.
        However, this property is primarily intended for debugging and
        tree traversal, not tight loops.
        """
        ...

    @property
    def key(self) -> str | None:
        """Field name if this is an object child, None otherwise."""
        ...

    def get_path(self, path: str) -> Node | None:
        """Navigate to a nested node using dot notation.

        Path syntax:
        - "foo" - Get field "foo" from object
        - "foo.bar.baz" - Nested field access
        - "items.0" - Array index access (numeric segment)
        - "users.0.name" - Combined access

        Path navigation supports numeric segments for array indexing.

        Returns:
            Node at path, or None if any path component is missing or
            mismatched (e.g., accessing a field on an array, or index
            on an object).

        Note:
            Unlike `Arbor.path()`, this method starts navigation from
            the current node. The first path segment is interpreted as a
            field name or array index, not a tree index.

            Example:
                arbor.path("0.user.name")  # tree 0, then user.name
                node.path("user.name")     # from this node, user.name
        """
        ...

    # === Conversion ===

    def to_python(self, *, deep: bool = True) -> Any:
        """Convert subtree to Python objects (dict, list, etc.).

        Args:
            deep: If True (default), recursively convert entire subtree.
                  If False, convert one level only (children become Node objects).

        Returns:
            - dict for objects (keys → values or Node objects)
            - list for arrays (elements or Node objects)
            - Primitive Python values for primitives

        Example:
            # deep=True (default): full recursive conversion
            node.to_python()  # {"user": {"name": "Alice", "age": 30}}

            # deep=False: one level, children remain as Node
            node.to_python(deep=False)  # {"user": <Node(OBJECT)>}

        Note: Implementation uses an explicit stack to avoid Python
        recursion limit errors for deeply nested JSON trees.
        """
        ...

    def as_dict(self) -> dict[str, Any]:
        """Convert object node to Python dict (shallow, one level).

        Convenience wrapper for `to_python(deep=False)` on object nodes.
        Child values are converted to their Python primitives, but nested
        containers remain as Node objects.

        Raises:
            TypeError: If not an Object node
        """
        ...

    def as_list(self) -> list[Any]:
        """Convert array node to Python list (shallow, one level).

        Convenience wrapper for `to_python(deep=False)` on array nodes.
        Child values are converted to their Python primitives, but nested
        containers remain as Node objects.

        Raises:
            TypeError: If not an Array node
        """
        ...

    def to_json(self) -> str:
        """Serialize this node's subtree to JSON."""
        ...

    def __repr__(self) -> str:
        """Debug representation showing type and value preview.

        Examples:
            Node(type=STRING, value="Alice")
            Node(type=OBJECT, keys=["name", "age", ...])
            Node(type=ARRAY, len=5)
            Node(type=DATE, value="2024-01-15")
            Node(type=INT64, value=42)
        """
        ...
```

#### 5.4.2 Design Notes

**Node Lifetime:** Nodes hold a `Py<PyArbor>` strong reference. This ensures the Arbor lives at least as long as any Node. See "Critical Design Decision: Node Lifetime Invariant" above.

**String Copying:** Accessing `.value` on STRING, BINARY, DATE, DATETIME, DURATION nodes performs Python-side copying. The data is copied from Rust into Python strings/bytes. Zero-copy string views are explicitly deferred to Phase 6+.

**Type Coercion:** The `value` property returns the most natural Python type. Temporal types return ISO 8601 strings by default; use `date_value`, `datetime_value`, `duration_value` for typed access.

**Performance: Node Objects Are Lightweight Wrappers:**
- `PyNode` is just `(Py<PyArbor>, NodeId)` — 16-24 bytes
- Creating Node objects in tight loops is cheap
- All lookup logic (field access, array indexing) stays in Rust
- Do NOT materialize Python collections for lookups

**Performance: Iterators Are Generators:**
- `keys()`, `values()`, and `items()` yield on-demand
- They do NOT materialize a list on every call
- This is critical for large objects

**Recursion Safety:** `to_python()` must be implemented iteratively using an explicit stack to avoid Python recursion limit errors for deeply nested JSON trees (1000+ levels).

#### 5.4.3 Implementation Tasks

- [x] Implement `PyNode` class holding `(Py<PyArbor>, NodeId)`
- [x] Implement `type` property returning `PyNodeType`
- [x] Implement `type_name` property
- [x] Implement `value` property with type dispatch
- [ ] Implement temporal value properties: `date_value`, `datetime_value`, `duration_value`
- [x] Implement typed accessors: `as_bool()`, `as_int()`, `as_float()`, `as_str()`, `as_bytes()`
- [x] Implement `is_null()`, `is_container()`
- [x] Implement `__len__` returning child count
- [x] Implement `__getitem__` for both str and int keys
- [x] Implement `__contains__` for membership testing
- [x] Implement `__iter__` yielding child nodes
- [x] Implement `get(key, default)` for safe access
- [x] Implement `keys()`, `values()`, `items()` as generators (yield on-demand)
- [x] Implement `parent` property
- [x] Implement `key` property
- [x] Implement `get_path(path)` method
- [x] Implement `to_python(deep=True)` with iterative (non-recursive) conversion
- [x] Implement `as_dict()` and `as_list()` shallow converters
- [x] Implement `to_json()` serialization (see 5.11)
- [x] Implement `__repr__` with type and value preview (see examples in docstring)
- [x] Unit tests for all accessor methods
- [x] Unit tests for iteration patterns
- [x] Unit tests for path navigation
- [ ] Unit tests for deep JSON trees (verify no recursion limit errors)

---

### 5.5 Parsing Functions

**Goal:** Expose high-level parsing functions.

#### 5.5.1 Function Signatures

```python
def parse_json(
    data: str | bytes,
    schema: ArborsSchema | dict | None = None,
) -> Arbor:
    """Parse JSON string into a Arbor.

    Args:
        data: JSON string or bytes
        schema: Optional schema for type-aware parsing. Can be:
            - ArborsSchema object (used directly)
            - dict (interpreted as JSON Schema, compiled via Rust importer)
            - None (uses basic type inference from JSON tokens)

    Returns:
        Arbor containing one tree

    Raises:
        ValueError: If JSON is malformed
        TypeError: If data doesn't match schema

    Note on inference (schema=None):
        When no schema is provided, types are inferred from JSON token types:
        - JSON strings → STRING (not DATE/DATETIME unless schema says so)
        - JSON numbers → INT64 or FLOAT64 based on presence of decimal point
        - JSON booleans → BOOL
        - JSON null → NULL
        - JSON arrays → ARRAY
        - JSON objects → OBJECT

        Temporal types (DATE, DATETIME, DURATION) are NOT inferred automatically.
        To parse temporal strings, provide a schema or use infer_schema() first.
    """
    ...


def parse_jsonl(
    data: str | bytes,
    schema: ArborsSchema | dict | None = None,
) -> Arbor:
    """Parse JSONL (newline-delimited JSON) into a Arbor.

    Args:
        data: JSONL string or bytes (one JSON value per line)
        schema: Optional schema for type-aware parsing

    Returns:
        Arbor containing one tree per line

    Raises:
        ValueError: If any line is malformed
        TypeError: If data doesn't match schema
    """
    ...


def infer_schema(
    samples: list[str] | str,
    *,
    infer_temporal: bool = True,
) -> ArborsSchema:
    """Infer schema from sample JSON data.

    Args:
        samples: JSON string(s) to infer schema from.
            Can be a single JSON string or list of JSON strings.
        infer_temporal: If True, detect date/datetime/duration patterns

    Returns:
        Inferred ArborsSchema

    Example:
        >>> schema = arbors.infer_schema('{"name": "Alice", "age": 30}')
        >>> schema.get_field("name").dtype
        ArborsType.STRING
        >>> schema.get_field("age").dtype
        ArborsType.INT64
    """
    ...
```

#### 5.5.2 Schema Parameter Handling

The `schema` parameter accepts multiple types for convenience:

```python
# No schema - infer types
arbor = arbors.parse_json(data)

# ArborsSchema object
schema = ArborsSchema.object([
    Field.required_field("name", ArborsType.STRING),
    Field.required_field("created", ArborsType.DATETIME),
])
arbor = arbors.parse_json(data, schema=schema)

# JSON Schema dict
json_schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "created": {"type": "string", "format": "date-time"},
    }
}
arbor = arbors.parse_json(data, schema=json_schema)
```

#### 5.5.3 Implementation Tasks

- [x] Implement `parse_json()` function
- [x] Implement `parse_jsonl()` function
- [x] Add schema parameter handling (ArborsSchema, dict, None)
- [x] Convert Python str/bytes to Rust appropriately
- [x] Implement `infer_schema()` function
- [x] Add proper error translation (Rust Result → Python exceptions)
- [x] Unit tests for basic parsing
- [x] Unit tests for schema-guided parsing
- [x] Unit tests for JSONL parsing
- [x] Unit tests for schema inference

---

### 5.6 Error Handling

**Goal:** Translate Rust errors to appropriate Python exceptions.

#### 5.6.1 Exception Hierarchy

```python
class ArborsError(Exception):
    """Base exception for all arbors errors."""
    pass


class ParseError(ArborsError):
    """Error parsing JSON data."""
    pass


class SchemaError(ArborsError):
    """Error in schema definition or compilation."""
    pass


class TypeMismatchError(ArborsError):
    """Data doesn't match expected schema type."""

    @property
    def expected(self) -> str:
        """Expected type name."""
        ...

    @property
    def got(self) -> str:
        """Actual type name."""
        ...

    @property
    def path(self) -> str:
        """Path to the mismatched value."""
        ...
```

#### 5.6.2 Error Mapping

| Rust Error | Python Exception |
|------------|------------------|
| `ArborsError::ParseError` | `ParseError` |
| `ArborsError::InvalidSchema` | `SchemaError` |
| `ArborsError::TypeMismatch` | `TypeMismatchError` |
| `ArborsError::MissingRequiredField` | `TypeMismatchError` |
| `ArborsError::InvalidNodeId` | `IndexError` |

#### 5.6.3 Implementation Tasks

- [x] Define `ArborsError` base exception class
- [x] Define `ParseError`, `SchemaError`, `TypeMismatchError` subclasses
- [x] Implement error conversion in PyO3 (`impl From<ArborsError> for PyErr`)
- [x] Add exception classes to module exports
- [x] Unit tests for error handling

---

### 5.7 Type Stubs

**Goal:** Provide type annotations for IDE support and static analysis.

#### 5.7.1 Stub File Structure

Create `python/arbors/_arbors.pyi`:

```python
"""Type stubs for arbors native module."""

from __future__ import annotations
from typing import Iterator, Any
import datetime

class NodeType:
    NULL: NodeType
    BOOL: NodeType
    INT64: NodeType
    FLOAT64: NodeType
    STRING: NodeType
    ARRAY: NodeType
    OBJECT: NodeType
    DATE: NodeType
    DATETIME: NodeType
    DURATION: NodeType
    BINARY: NodeType

    @property
    def name(self) -> str: ...
    def is_container(self) -> bool: ...
    def is_primitive(self) -> bool: ...
    def is_temporal(self) -> bool: ...

# ... (complete stubs for all classes)
```

#### 5.7.2 Implementation Tasks

- [x] Create `python/arbors/_arbors.pyi` with complete type stubs
- [x] Create `python/arbors/py.typed` marker file
- [x] Verify mypy/pyright can type-check code using arbors
- [ ] Verify IDE autocompletion works (VS Code, PyCharm)

---

### 5.8 Testing Infrastructure

**Goal:** Comprehensive pytest test suite.

#### 5.8.1 Test Structure

```
python/tests/
├── conftest.py           # Shared fixtures
├── test_parsing.py       # parse_json, parse_jsonl tests
├── test_arbor.py        # Arbor iteration, indexing
├── test_node.py          # Node access, navigation
├── test_schema.py        # Schema construction, import
├── test_types.py         # NodeType, ArborsType enums
├── test_errors.py        # Exception handling
└── test_integration.py   # End-to-end workflows
```

#### 5.8.2 Fixtures

```python
# conftest.py
import pytest
import arbors

@pytest.fixture
def simple_object():
    """Simple JSON object."""
    return '{"name": "Alice", "age": 30}'

@pytest.fixture
def nested_object():
    """Nested JSON object."""
    return '{"user": {"name": "Alice", "email": "alice@example.com"}}'

@pytest.fixture
def array_data():
    """JSON array."""
    return '[1, 2, 3, 4, 5]'

@pytest.fixture
def jsonl_data():
    """JSONL with multiple rows."""
    return '{"id": 1, "name": "Alice"}\n{"id": 2, "name": "Bob"}'

@pytest.fixture
def temporal_data():
    """JSON with temporal fields."""
    return '{"date": "2024-01-15", "datetime": "2024-01-15T10:30:00Z"}'

@pytest.fixture
def testdata_dir():
    """Path to workspace testdata directory."""
    return Path(__file__).parent.parent.parent / "testdata"
```

#### 5.8.3 Implementation Tasks

- [x] Create `python/tests/conftest.py` with fixtures
- [x] Create `python/tests/test_parsing.py`
- [x] Create `python/tests/test_arbor.py`
- [x] Create `python/tests/test_node.py`
- [x] Create `python/tests/test_schema.py`
- [x] Create `python/tests/test_types.py`
- [x] Create `python/tests/test_errors.py`
- [x] Create `python/tests/test_integration.py`
- [x] Add pytest to dev dependencies
- [x] Add pytest configuration to `pyproject.toml`
- [x] Verify `pytest` runs all tests

---

### 5.9 Documentation

**Goal:** Clear docstrings and usage examples.

#### 5.9.1 Docstring Standards

All public APIs should have:
- One-line summary
- Extended description (if needed)
- Args section with types
- Returns section
- Raises section (if applicable)
- Example code

#### 5.9.2 Implementation Tasks

- [x] Add docstrings to all PyO3 classes and functions
- [x] Ensure docstrings render correctly in `help()`
- [x] Add usage examples to module docstring
- [x] Create `python/README.md` with quick start

---

### 5.10 Build and Distribution

**Goal:** Easy installation via pip.

#### 5.10.1 Build Verification

```bash
# Development build
cd python
maturin develop

# Verify import
python -c "import arbors; print(arbors.__version__)"

# Run tests
pytest
```

#### 5.10.2 Makefile Integration

Update root `Makefile`:

```makefile
python:
	cd python && maturin develop

python-test:
	cd python && pytest

python-release:
	cd python && maturin build --release
```

#### 5.10.3 Implementation Tasks

- [x] Update Makefile with `python`, `python-test`, `python-release` targets
- [x] Verify `make python` works
- [x] Verify `make python-test` runs pytest
- [x] Document build steps in README

---

### 5.11 JSON Serialization

**Goal:** Add JSON serialization to Arbor and Node.

#### 5.11.1 Arbor Serialization

```python
arbor.to_json()         # Compact JSON string
arbor.to_json_pretty()  # Pretty-printed with indentation
```

For single-tree arbors, returns the JSON value. For multi-tree arbors (JSONL), returns a JSON array.

#### 5.11.2 Node Serialization

```python
node.to_json()  # Serialize this node's subtree to compact JSON
```

#### 5.11.3 Implementation Tasks

- [x] Implement `Arbor.to_json()`
- [x] Implement `Arbor.to_json_pretty()`
- [x] Implement `Node.to_json()`
- [x] Unit tests for serialization
- [x] Update type stubs

---

### 5.12 Naming & API Ergonomics Audit

**Goal:** Align Arbors's Rust + Python naming with modern data-engineering ergonomics (inspired by Polars) and greatly simplify developer experience through clearer type names, improved import patterns, and consistent conceptual layering.

---

#### 5.12.1 Design Principles

1. **Short, expressive names** — Like Polars' `DataFrame`, not `PolarsDataFrame`
2. **Hierarchical conceptual model:**
   ```
   Arbor (collection of trees)
     └── Tree (a single JSON document)
           └── Node (a value)
   ```
3. **Python must "feel like Polars":**
   - Module-level `read_*` functions
   - Short alias `import arbors as aq`
   - Symbolic type constants (not enums)
4. **Rust API mirrors these concepts directly**

---

#### 5.12.2 Core Renaming Summary

**Data Structures:**

| Old Name | New Name | Rationale |
|----------|----------|-----------|
| `Arbor` | `Arbor` | Distinctive, brand-aligned |
| (conceptual) | `Tree` (PyClass) | Real type, document root wrapper |
| `Node` | `Node` | Unchanged |
| `ArborsSchema` | `Schema` | Shorter, Polars-like |
| `ArborsType` | Removed | Replaced by symbolic constants |
| `ArborsArrayType` | Removed | Folded into `aq.Array()` |
| `ArborsObjectType` | Removed | Folded into `aq.Struct()` |
| `NodeType` | `NodeType` (Rust internal) | **Not exposed to Python** |

**Error Types:**

| Old | New |
|-----|-----|
| `ArborsError` | `Error` (re-exported as `aq.Error`) |
| `ParseError` | `ParseError` |
| `SchemaError` | `SchemaError` |
| `TypeMismatchError` | `TypeMismatchError` |

**Functions:**

| Old | New |
|-----|-----|
| `parse_json` | `read_json` |
| `parse_jsonl` | `read_jsonl` (+ alias `read_ndjson`) |
| `arbor_to_json` | `Arbor.to_json()` method |
| `Field.required_field` | `Field.required` |
| `Field.optional_field` | `Field.optional` |

---

#### 5.12.3 Symbolic Type Constants (Polars-style)

**Decision:** Follow modern Polars — use module-level type constants, not enum members.

```python
# Primitive types
aq.String
aq.Int64
aq.Float64
aq.Bool
aq.Date
aq.DateTime
aq.Duration
aq.Binary
aq.Null

# Composite types (factory functions)
aq.Array(aq.String)              # Array of strings
aq.Struct(name=aq.String, ...)   # Structured record with named fields
```

**Key points:**
- No `DataType` enum exposed to Python
- Rust keeps `enum DataType` internally
- Python sees ergonomic symbolic constants at module level
- `aq.Array()` and `aq.Struct()` are factory functions returning `DataType` objects
- `aq.Struct()` produces a **DataType**, not a Schema (see Schema construction below)

**Naming note:** We use `Struct` (not `Object`) to align with:
- Polars: `pl.Struct`
- Arrow: `StructArray`, `StructType`
- Data engineering convention: "struct" = structured record

JSON "object" is retained in documentation where referring to JSON semantics, but the type constant is `Struct`.

**Null semantics:** `aq.Null` means "the value can only be null" — this is a type, not optionality. Optionality is handled at the `Field` level via `Field.optional()`.

**Field ordering:** `Struct()` preserves the order of fields as provided in Python source. Field order in Struct types is respected during serialization (to Schema or JSON). Within a Tree/Node, JSON object key order is sorted lexicographically (Arbors invariant). Schema declarations do not reorder fields. These are different concepts: schema field order reflects declaration order; storage key order reflects efficient lookup.

**Rust equivalent:**

```rust
pub mod dt {
    pub const STRING: DataType = DataType::String;
    pub const INT64: DataType = DataType::Int64;
    // ...
    pub fn array(inner: DataType) -> DataType { DataType::List(Box::new(inner)) }
    pub fn struct_(fields: Vec<Field>) -> DataType { DataType::Struct(fields) }
}
```

---

#### 5.12.4 Tree as a Real Type

**Decision:** `Tree` is a distinct `PyClass` wrapping a root `NodeId` + reference to `Arbor`.

**Rust representation:**

```rust
#[pyclass]
pub struct PyTree {
    arbor: Py<PyArbor>,
    root_id: NodeId,
}
```

**Python API:**

```python
class Tree:
    """A single JSON document in an Arbor."""

    @property
    def root(self) -> Node:
        """The root node of this tree."""
        ...

    @property
    def schema(self) -> Schema | None:
        """Schema for this tree (delegates to Arbor)."""
        ...

    def __getitem__(self, key: str) -> Node:
        """Access root's children by field name: tree["name"].

        Only string keys are supported. Use arbor[i] to select trees by index.

        Raises:
            TypeError: If key is not a string, or if root is not an object
            KeyError: If field name not found
        """
        ...

    def __contains__(self, key: str) -> bool:
        """Check if root contains field (objects only)."""
        ...

    def __iter__(self) -> Iterator[Node]:
        """Iterate over root's children.

        Behavior depends on root type:
        - object root: iterates over values (not keys)
        - array root: iterates over elements
        - primitive root: raises TypeError

        Raises:
            TypeError: If root is a primitive (cannot iterate)
        """
        ...

    def __len__(self) -> int:
        """Number of children in root.

        Returns:
            - number of fields if root is an object
            - number of elements if root is an array

        Raises:
            TypeError: If root is a primitive
        """
        ...

    def keys(self) -> Iterator[str]:
        """Iterate over field keys (objects only).

        Raises:
            TypeError: If root is not an object
        """
        ...

    def values(self) -> Iterator[Node]:
        """Iterate over field values (objects only).

        For arrays, use iteration directly: `for x in tree`

        Raises:
            TypeError: If root is not an object
        """
        ...

    def items(self) -> Iterator[tuple[str, Node]]:
        """Iterate over (key, value) pairs (objects only).

        Raises:
            TypeError: If root is not an object
        """
        ...

    def path(self, path: str) -> Node | None:
        """Navigate using dot notation: tree.path("user.address.city").

        Path navigation supports numeric segments for array indexing:
        tree.path("items.0.name") accesses items[0]["name"].

        Returns None if any path component is missing or mismatched
        (e.g., accessing a field on an array, or index on an object).
        """
        ...

    def to_json(self) -> str:
        """Serialize to JSON string."""
        ...

    def to_python(self, *, deep: bool = True) -> Any:
        """Convert to Python dict/list."""
        ...

    def as_dict(self) -> dict[str, Any]:
        """Convert object tree to Python dict (shallow).

        Raises:
            TypeError: If root is not an object
        """
        ...

    def to_dict(self) -> dict[str, Any]:
        """Alias for as_dict() — matches common Python convention.

        Raises:
            TypeError: If root is not an object
        """
        ...

    def __repr__(self) -> str:
        """Rich repr showing root type, keys/length, and node count."""
        ...
```

**Naming consistency:**
- `Arbor` = top-level container of N trees (the whole dataset)
- `Tree` = one document root (equivalent to a JSON document)
- `Node` = any value in the tree (primitives, arrays, objects)

**Rules:**
- `arbor[i]` always returns a `Tree`, never a `Node` directly
- `tree["key"]` only accepts string keys (raises `TypeError` for int)
- `tree["key"]` raises `TypeError` if root is not an object (e.g., for `aq.read_json("42")`)

**Tree iteration semantics:**

| Root type | `for x in tree:` | `tree.keys()` | `tree.values()` | `tree.items()` |
|-----------|------------------|---------------|-----------------|----------------|
| object | iterate values | ✓ keys | ✓ values | ✓ (key, value) |
| array | iterate elements | TypeError | TypeError | TypeError |
| primitive | TypeError | TypeError | TypeError | TypeError |

This aligns with Python conventions: `.keys()`, `.values()`, `.items()` are dict-like methods. Arrays use direct iteration.

---

#### 5.12.5 Complete Python API

```python
import arbors as aq

# === Module Import Alias ===
# Standard: import arbors as aq

# === Reading Data (module-level functions) ===
arbor = aq.read_json('{"name": "Alice"}')      # Parse JSON string
arbor = aq.read_json(Path("data.json"))        # Read from file
arbor = aq.read_jsonl(jsonl_string)            # Parse JSONL string
arbor = aq.read_jsonl(Path("data.jsonl"))      # Read from file
arbor = aq.read_ndjson(data)                   # Alias for read_jsonl

# === Class Methods (alternative entry points) ===
arbor = aq.Arbor.from_json(data)
arbor = aq.Arbor.from_jsonl(data)

# === Arbor Class ===
len(arbor)                                     # Number of trees
arbor.num_trees                                # Explicit property
arbor.num_nodes                                # Total nodes across all trees

for tree in arbor:                             # Iterate trees
    print(tree["name"].value)

tree = arbor[0]                                # Returns Tree (not Node!)
tree = arbor[-1]                               # Negative indexing

arbor.to_json()                                # Compact JSON
arbor.to_json_pretty()                         # Pretty-printed

# === Tree Class ===
tree.root                                      # Node (the root node)
tree.schema                                    # Schema | None
tree["name"]                                   # Node (root's child) — string keys only!
tree.path("user.address.city")                 # Node | None
tree.keys()                                    # Iterator[str]
tree.values()                                  # Iterator[Node]
tree.items()                                   # Iterator[tuple[str, Node]]
tree.to_json()
tree.to_python()
tree.as_dict()                                 # Shallow dict conversion
tree.to_dict()                                 # Alias for as_dict()

# === Node Class ===
node.type_name                                 # str: "string", "int64", "array", etc.
node.value                                     # Primitive value
node["key"]                                    # Child by key (objects)
node[0]                                        # Child by index (arrays)
node.path("nested.field")                      # Navigate from this node
node.as_int()                                  # Typed accessor
node.as_str()
node.as_dict()
node.as_list()
node.to_python()
node.to_json()
node.parent                                    # Node | None

# === Schema Construction ===
# Option 1: Field list (explicit)
schema = aq.Schema.object([
    aq.Field("name", aq.String),
    aq.Field("age", aq.Int64),
])

# Option 2: Keyword builder (ergonomic) — equivalent to Option 1
schema = aq.Schema(
    name=aq.String,
    age=aq.Int64,
    tags=aq.Array(aq.String),
)

# Option 3: From JSON Schema
schema = aq.Schema.from_json_schema(json_schema_dict)

# Option 4: Infer from data
schema = aq.infer_schema(samples)

# Note: Schema.object([...]) and Schema(**kwargs) are equivalent convenience
# constructors for creating object schemas.

# === Type Constants (module-level) ===
aq.String
aq.Int64
aq.Float64
aq.Bool
aq.Date
aq.DateTime
aq.Duration
aq.Binary
aq.Null
aq.Array(aq.String)                            # Array type (returns DataType)
aq.Struct(name=aq.String, age=aq.Int64)        # Struct type (returns DataType)

# Note: aq.Struct() produces a DataType, not a Schema.
# Use aq.Schema() or aq.Schema.object() to create a Schema.

# === Exceptions ===
aq.Error                                       # Base exception
aq.ParseError
aq.SchemaError
aq.TypeMismatchError
```

---

#### 5.12.6 Rust API Updates

**Core types:**

```rust
pub struct Arbor { ... }      // formerly Arbor
pub struct Tree { ... }       // new: document wrapper
pub struct Node { ... }
pub struct Schema { ... }     // formerly ArborsSchema
pub enum Error { ... }        // formerly ArborsError

pub type Result<T> = std::result::Result<T, Error>;
```

**Functions:**

```rust
// Module-level
pub fn read_json(data: &str) -> Result<Arbor>;
pub fn read_jsonl(data: &str) -> Result<Arbor>;
pub fn read_json_with_schema(data: &str, schema: &Schema) -> Result<Arbor>;

// Type constants module
pub mod dt {
    pub const STRING: DataType = DataType::String;
    pub const INT64: DataType = DataType::Int64;
    pub const FLOAT64: DataType = DataType::Float64;
    pub const BOOL: DataType = DataType::Bool;
    pub const DATE: DataType = DataType::Date;
    pub const DATETIME: DataType = DataType::DateTime;
    pub const DURATION: DataType = DataType::Duration;
    pub const BINARY: DataType = DataType::Binary;
    pub const NULL: DataType = DataType::Null;

    pub fn array(inner: DataType) -> DataType;
    pub fn struct_(fields: Vec<Field>) -> DataType;  // Note: struct_ to avoid keyword
}
```

**Usage:**

```rust
use arbors::{Arbor, Tree, Node, Schema, Field, Error, Result, dt};

let arbor = arbors::read_json(data)?;

let schema = Schema::object(vec![
    Field::required("name", dt::STRING),
    Field::optional("age", dt::INT64),
]);

for tree in arbor.trees() {
    let name = tree.root().get("name")?.as_str()?;
}
```

---

#### 5.12.7 Improved repr (Polars-style)

**Arbor repr:**

```python
Arbor(
  num_trees=12,
  num_nodes=483,
  schema=Schema(name=String, age=Int64, ...),
)
```

**Tree repr:**

```python
Tree(
  type="object",
  keys=["name", "age", "address", ...],
  num_nodes=42,
)
```

**Node repr:**

Uses semantic type names (strings), not internal `NodeType` enum variants:

```python
Node(type="string", value="Alice")
Node(type="int64", value=42)
Node(type="date", value="2024-01-15")
Node(type="array", len=128)
Node(type="object", keys=["name", "age", ...])
```

**Rules:**
- Type names are lowercase strings: `"string"`, `"int64"`, `"array"`, `"object"`, etc.
- Arrays: show `len=N`, truncate to first 5 items in detailed view
- Objects: show first 5 keys with `...` if more
- Strings: truncate at 50 chars with `...`
- Internal `NodeType` enum is **not exposed** to Python (Polars pattern: don't expose Arrow physical types)

---

#### 5.12.8 API Debts Removed

- ❌ `ArborsType` — replaced by symbolic constants
- ❌ `ArborsSchema` — now just `Schema`
- ❌ `ArborsError` — now just `Error`
- ❌ `ArborsArrayType` — folded into `aq.Array()`
- ❌ `ArborsObjectType` — folded into `aq.Struct()`
- ❌ `parse_json` / `parse_jsonl` — now `read_json` / `read_jsonl`
- ❌ `NodeType` in Python — internal only, not exported (use `.type_name` string)
- ❌ `get_path()` — renamed to `.path()` for consistency

---

#### 5.12.9 Files Requiring Changes

**Rust crates:**
- `arbors-core/src/lib.rs` — `ArborsError` → `Error`
- `arbors-schema/src/native_types.rs` — `ArborsType` → type constants, `ArborsSchema` → `Schema`
- `arbors-storage/src/lib.rs` — `Arbor` → `Arbor`
- `arbors-io/src/lib.rs` — `parse_*` → `read_*`
- `arbors/src/lib.rs` — Re-exports, `dt` module

**Python:**
- `python/src/lib.rs` — All PyO3 classes, add `Tree`, type constants
- `python/arbors/__init__.py` — New exports
- `python/arbors/_arbors.pyi` — Updated type stubs
- `python/README.md` — New examples
- `python/tests/*.py` — All test files

---

#### 5.12.10 Rust: Error Rename

**Goal:** Rename `ArborsError` → `Error` throughout Rust crates.

**Files:** `crates/arbors-core/src/lib.rs`, all crates using `ArborsError`

- [x] Rename `ArborsError` → `Error` in arbors-core
- [x] Update `pub type Result<T>` to use new `Error`
- [x] Update all imports/uses across crates
- [x] Run `cargo build && cargo test` — must pass

---

#### 5.12.11 Rust: Arbor → Arbor Rename

**Goal:** Rename `Arbor` → `Arbor` throughout Rust crates.

**Files:** `crates/arbors-storage/src/lib.rs`, `arbor.rs` → `arbor.rs`, `crates/arbors-io/src/lib.rs`, `crates/arbors/src/lib.rs`

- [x] Rename `Arbor` struct → `Arbor` in arbors-storage
- [x] Rename file `arbor.rs` → `arbor.rs` (if applicable)
- [x] Update all re-exports in arbors crate
- [x] Update arbors-io to use `Arbor`
- [x] Update all Rust tests
- [x] Run `cargo build && cargo test` — must pass

---

#### 5.12.12 Rust: parse_* → read_* Rename

**Goal:** Rename parsing functions to `read_json`, `read_jsonl`.

**Files:** `crates/arbors-io/src/lib.rs`, `crates/arbors/src/lib.rs`

- [x] Rename `parse_json` → `read_json`
- [x] Rename `parse_jsonl` → `read_jsonl`
- [x] Update re-exports in main arbors crate
- [x] Update all Rust tests
- [x] Run `cargo build && cargo test` — must pass

---

#### 5.12.13 Rust: ArborsSchema → Schema + ArborsType Cleanup

**Goal:** Rename `ArborsSchema` → `Schema`, clean up type naming.

**Files:** `crates/arbors-schema/src/lib.rs`, `native_types.rs`, `storage_schema.rs`, `crates/arbors/src/lib.rs`

- [x] Rename `ArborsSchema` → `Schema` (if this type exists separately)
- [x] Rename `ArborsType` → `DataType` (internal enum)
- [x] Remove `ArborsArrayType` and `ArborsObjectType` (fold into DataType)
- [x] Update all re-exports
- [x] Update all Rust tests
- [x] Run `cargo build && cargo test` — must pass

---

#### 5.12.14 Rust: Add dt Module with Type Constants

**Goal:** Create `dt` module with Polars-style type constants.

**Files:** `crates/arbors-schema/src/dt.rs` (new), `crates/arbors-schema/src/lib.rs`, `crates/arbors/src/lib.rs`

- [x] Create `dt` module with constants: `STRING`, `INT64`, `FLOAT64`, `BOOL`, `DATE`, `DATETIME`, `DURATION`, `BINARY`, `NULL`
- [x] Add `dt::array(inner: DataType) -> DataType` function
- [x] Add `dt::struct_(fields: Vec<Field>) -> DataType` function
- [x] Export `dt` module from main arbors crate
- [x] Add unit tests for `dt` module
- [x] Run `cargo build && cargo test` — must pass

---

#### 5.12.15 Rust: Field Rename

**Goal:** Rename `Field::required_field` → `Field::required`, `Field::optional_field` → `Field::optional`.

**Files:** `crates/arbors-schema/src/` (wherever Field is defined), all usages

**Note:** Rust `Field` already had methods named `required` and `optional`. This phase renamed the Python bindings from `required_field`/`optional_field` to `required`/`optional`. To avoid conflict with the `required` property, the boolean properties were renamed to `is_required` and `is_nullable`.

- [x] Rename `Field::required_field` → `Field::required`
- [x] Rename `Field::optional_field` → `Field::optional`
- [x] Update all usages in tests
- [x] Run `cargo build && cargo test` — must pass

---

#### 5.12.16 Python: Update Names to Match Rust

**Goal:** Update Python bindings to use new Rust names (Arbor → Arbor, parse_* → read_*).

**Note:** This phase was combined with 5.12.17 (updating tests) since it made sense to update everything together. The internal Rust struct was renamed from `Arbor` to `Arbor`, matching the Rust crate rename. All Python-visible names, documentation, type stubs, and tests were updated.

**Files:** `python/src/lib.rs`, `python/arbors/__init__.py`, `python/arbors/_arbors.pyi`

- [x] Rename `PyArbor` → `PyArbor` (class name in Rust) — renamed struct to `Arbor` with `#[pyclass(name = "Arbor")]`
- [x] Update Python class name from `Arbor` to `Arbor`
- [x] Rename `parse_json` → `read_json` in Python module
- [x] Rename `parse_jsonl` → `read_jsonl` in Python module
- [x] Add `read_ndjson` as alias for `read_jsonl`
- [x] Update `__init__.py` exports
- [x] Update type stubs in `_arbors.pyi`
- [x] Run `maturin develop` — must pass
- [x] Run basic import test: `python -c "import arbors; print(arbors.Arbor)"`
- [x] Update all test files (combined from 5.12.17)
- [x] Update README.md documentation
- [x] Run `pytest` — 282 tests pass

---

#### 5.12.17 Python: Update All Tests for New Names

**Goal:** Update all Python tests to use new API names.

**Note:** This phase was combined with 5.12.16. All test updates were done as part of the name change phase.

**Files:** All `python/tests/*.py` files

- [x] Rename `test_arbor.py` → `test_arbor.py`
- [x] Replace all `Arbor` → `Arbor` in tests
- [x] Replace all `parse_json` → `read_json` in tests
- [x] Replace all `parse_jsonl` → `read_jsonl` in tests
- [x] Run `pytest` — 282 tests pass

---

#### 5.12.18 Python: Schema Rename and Field Methods

**Goal:** Rename `ArborsSchema` → `Schema`, update Field methods.

**Files:** `python/src/lib.rs`, `python/arbors/__init__.py`, `python/arbors/_arbors.pyi`, `python/tests/test_schema.py`

- [x] Rename `ArborsSchema` → `Schema` struct in Rust with `#[pyclass(name = "Schema")]`
- [x] Update Python class name from `ArborsSchema` to `Schema`
- [x] Field.required and Field.optional already named correctly (no `_field` suffix)
- [x] Update `__init__.py` exports
- [x] Update type stubs
- [x] Update tests (test_schema.py, test_errors.py, test_integration.py, test_arbor.py)
- [x] Update README.md
- [x] Run `maturin develop` — passed
- [x] Run `pytest` — 282 tests pass

---

#### 5.12.19 Python: Add Type Constants

**Goal:** Add Polars-style type constants (`String`, `Int64`, etc.) to Python module.

**Files:** `python/src/lib.rs`, `python/arbors/__init__.py`, `python/arbors/_arbors.pyi`

- [x] Add `Null`, `Bool`, `Int64`, `Float64`, `String`, `Date`, `DateTime`, `Duration`, `Binary` as module-level constants
- [x] Implemented as ArborsType enum instances (equivalent to ArborsType.STRING, etc.)
- [x] Update `__init__.py` to export type constants
- [x] Update type stubs
- [x] Add `python/tests/test_type_constants.py` with 41 tests
- [x] Run `maturin develop` — passed
- [x] Run `pytest` — 323 tests pass (41 new + 282 existing)

---

#### 5.12.20 Python: Add Array() and Struct() Factory Functions

**Goal:** Add composite type factory functions.

**Files:** `python/src/lib.rs`, `python/arbors/__init__.py`, `python/arbors/_arbors.pyi`

- [x] Add `Array(item_type)` function returning ArborsArrayType
- [x] Add `Struct(**fields)` function returning ArborsObjectType (uses keyword args for clean syntax)
- [x] Update `__init__.py` to export `Array` and `Struct`
- [x] Update type stubs
- [x] Add 20 tests in `test_type_constants.py` (TestArrayFactory, TestStructFactory)
- [x] Run `maturin develop` — passed
- [x] Run `pytest` — 343 tests pass (20 new + 323 existing)

---

#### 5.12.21 Python: Create Tree Class

**Goal:** Add `Tree` as a real PyClass wrapping a root NodeId.

**Files:** `python/src/lib.rs`, `python/arbors/__init__.py`, `python/arbors/_arbors.pyi`

- [x] Create `PyTree` struct: `{ arbor: Py<PyArbor>, root_id: NodeId }`
- [x] Implement `Tree.root` property returning Node
- [x] Implement `Tree.schema` property
- [x] Implement `Tree.__getitem__(key: str)` — string keys only, raises TypeError for int
- [x] Implement `Tree.__contains__(key: str)`
- [x] Implement `Tree.__iter__()` yielding root's children
- [x] Implement `Tree.__len__()` returning root's child count
- [x] Update `Arbor.__getitem__` to return `Tree` instead of `Node`
- [x] Update `Arbor.__iter__` to yield `Tree` instead of `Node`
- [x] Update `__init__.py` to export `Tree`
- [x] Update type stubs
- [x] Run `maturin develop` — passed (tests will be fixed in 5.12.22)

---

#### 5.12.22 Python: Tree Methods and Test Updates

**Goal:** Complete Tree class with all methods, fix tests.

**Files:** `python/src/lib.rs`, `python/tests/test_arbor.py`, `python/tests/test_integration.py`

- [x] Add `Tree.keys()` returning Iterator[str]
- [x] Add `Tree.values()` returning Iterator[Node]
- [x] Add `Tree.items()` returning Iterator[tuple[str, Node]]
- [x] Add `Tree.path(path: str)` method (renamed from get_path)
- [x] Add `Tree.to_json()` method
- [x] Add `Tree.to_python(deep=True)` method
- [x] Add `Tree.as_dict()` method
- [x] Add `Tree.to_dict()` as alias for `as_dict()`
- [x] Update all tests to use `Tree` properly
- [x] Create `python/tests/test_tree.py` with Tree-specific tests
- [x] Run `pytest` — must pass

---

#### 5.12.23 Python: Node Updates

**Goal:** Update Node class (type_name property, path rename).

**Files:** `python/src/lib.rs`, `python/arbors/__init__.py`, `python/arbors/_arbors.pyi`, `python/tests/test_node.py`

**Semantic type names:** `Node.type_name` returns semantic type names: `"string"`, `"int64"`, `"float64"`, `"bool"`, `"date"`, `"datetime"`, `"duration"`, `"binary"`, `"array"`, `"struct"`, `"null"`. It never exposes internal storage types (e.g., no `"Date32"`, `"TimestampMicros"`, `"Object"`).

- [x] Add `Node.type_name` property returning semantic string ("string", "int64", etc.)
- [x] Rename `Node.get_path()` → `Node.path()`
- [x] Remove `NodeType` from Python exports (keep internal)
- [x] Update type stubs
- [x] Update tests
- [x] Run `pytest` — must pass

---

#### 5.12.24 Python: Rich __repr__ for Arbor, Tree, Node

**Goal:** Implement Polars-style rich repr for all main classes.

**Files:** `python/src/lib.rs`, `python/tests/test_repr.py` (new)

- [x] Implement `Arbor.__repr__()` (see 5.12.7 spec)
- [x] Implement `Tree.__repr__()` (see 5.12.7 spec)
- [x] Update `Node.__repr__()` to use semantic type strings (see 5.12.7 spec)
- [x] Create `python/tests/test_repr.py` with repr tests
- [x] Run `pytest` — must pass

---

#### 5.12.25 Python: Schema Keyword Constructor

**Goal:** Add ergonomic keyword-based Schema constructor.

**Files:** `python/src/lib.rs`, `python/arbors/_arbors.pyi`, `python/tests/test_schema.py`

- [x] Add `Schema(**kwargs)` constructor accepting `name=aq.String, age=aq.Int64`
- [x] This should be equivalent to `Schema.object([Field("name", aq.String), ...])`
- [x] Update type stubs
- [x] Add tests for keyword constructor
- [x] Run `pytest` — must pass

---

#### 5.12.26 Documentation Updates

**Goal:** Update all documentation for new API.

**Files:** `python/README.md`, `CLAUDE.md`, docstrings in `python/src/lib.rs`

- [x] Update `python/README.md` with new API examples
- [x] Update `CLAUDE.md` with new naming conventions
- [x] Review and update all PyO3 docstrings
- [x] Verify `help(arbors.Arbor)` shows correct docs
- [x] Verify `help(arbors.Tree)` shows correct docs

---

#### 5.12.27 Final Validation

**Goal:** Full test suite and integration verification.

- [x] Run `cargo build` — must pass
- [x] Run `cargo test` — must pass
- [x] Run `maturin develop` — must pass
- [x] Run `pytest` — all tests must pass
- [x] Run `mypy python/` — type checking must pass (if configured)
- [x] Manual smoke test:
  ```python
  import arbors as aq
  arbor = aq.read_json('{"name": "Alice", "age": 30}')
  tree = arbor[0]
  print(tree["name"].value)
  print(arbor)
  print(tree)
  ```

---

#### 5.12.28 Reserved Names (Future Phases)

Reserve these names for future expression/query API (Phase 8+):

```python
# Future: expression-based queries
arbor.select("user.name")
arbor.filter(aq.col("age") > 18)
aq.col("field")
aq.lit(value)
```

---
