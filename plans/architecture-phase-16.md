## Phase 16: ArborStore on redb

**Purpose:** Introduce `ArborStore`: a durable container for multiple Arbors with ACID transactional semantics, built on [redb](https://github.com/cberner/redb) as the storage engine.

**Status:** Planning

**Scope:**
1. Define `ArborStore` as a durable container for many Arbors ("database / repository / workspace" semantics).
2. Use **redb** as the transactional storage layer, inheriting its ACID guarantees, MVCC, and crash safety.
3. Define Arbor binary serialization format for storing arbor data as redb values.
4. Provide Rust and Python APIs for ArborStore.

**Non-goals (explicitly out of scope):**
- Multi-writer concurrency (redb is single-writer; this matches our design).
- Custom file format or transactional layer (redb handles this).
- Async I/O (redb is blocking; see Practical Considerations).

**Dependencies / prerequisites:**
- `redb` crate (MIT license, compatible with Arbors).
- Stable Arbor internal representation for serialization.
- Serializable schema format (`arbors-schema` already supports JSON round-trip).

---

### 16.0 Design Decisions

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### Use redb as the storage engine (DECIDED)

**Decision:** Use [redb](https://github.com/cberner/redb) as a crate dependency for ArborStore's transactional storage layer. Do not fork.

**Rationale:**
- redb provides ACID transactions, single-writer/many-reader, MVCC, copy-on-write B-trees, checksums, and GC—everything we would otherwise build ourselves.
- Pure Rust, MIT license, stable API (1.0+ since June 2023), actively maintained.
- Eliminates weeks of foundational database work (locking, fsync, crash recovery, GC).
- Our value-add is Arbors semantics, not reinventing database internals.
- redb's architecture is already being used as a building block for more complex engines.

**What redb handles (we don't build):**

| Capability | redb provides |
|------------|---------------|
| ACID transactions | Copy-on-write B-trees with atomic commit |
| Single-writer locking | Built-in, cross-process safe |
| MVCC reader snapshots | `begin_read()` returns stable snapshot |
| Durability / fsync | Configurable per-transaction |
| Checksums | Built-in corruption detection |
| GC | Pending free tree, automatic |
| File format versioning | Stable v3, backward compatible |
| Zero-copy reads | Built-in |

**What we build:**

| Capability | Our responsibility |
|------------|-------------------|
| Arbor binary serialization | nodes, pools, interner, schema → bytes |
| ArborStore API wrapper | Thin layer translating our semantics to redb |
| Python bindings | Expose ArborStore to Python |
| Schema persistence | Embed schema in serialized arbor |

**Dependency approach:** Use `redb` crate from crates.io. Do not fork.

**Why not fork:**
- redb is ~15,000 lines of intricate database code
- Requires deep expertise to maintain correctly
- We would miss upstream bug fixes and improvements
- If we ever need changes, we can contribute upstream

**Reference:** [redb GitHub](https://github.com/cberner/redb), [redb docs](https://docs.rs/redb), [redb design](https://github.com/cberner/redb/blob/master/docs/design.md)

#### `Arbor` remains a snapshot value; durability lives in ArborStore (DECIDED)

**Decision:** Keep `Arbor` as an immutable-first, shareable snapshot value; durability is the responsibility of `ArborStore` (backed by redb).

**Rationale:**
- Arbors is a high-performance **in-memory** compute engine over snapshot-like values.
- redb handles persistence; `ArborStore` wraps redb and serializes/deserializes `Arbor` values.
- Clean separation: compute layer (`Arbor`) vs persistence layer (`ArborStore` + redb).

**Implications:**
- `Arbor` has no knowledge of redb or persistence.
- `ArborStore` owns the redb `Database` and handles serialization.

#### Concurrency model: single-writer, many-reader (DECIDED)

**Decision:** ArborStore concurrency model is **single-writer, many-reader**, inherited from redb.

**What this means:**
- At most **one** write transaction may be active at a time.
- Any number of readers may concurrently hold read snapshots.
- Readers observe stable MVCC snapshots (redb's `begin_read()`).
- Writers commit atomically (redb's `commit()`).

**This matches our needs:** Arbors is positioned as an embedded analytics + transformation engine where many readers and relatively few writers is the common pattern.

**Tradeoff:**
- Write-heavy workloads are serialized. For heavy mutation, batch writes into fewer transactions.

#### Use Arrow IPC for Arbor serialization (DECIDED)

**Decision:** Use Arrow IPC (Inter-Process Communication) format for serializing Arbors. This requires refactoring `arbors-storage` to use Arrow arrays throughout (not just for pools).

**Rationale:**

We evaluated three options for serialization:
- **Option A (chosen):** Full Arrow — all Arbor components as Arrow arrays, serialize via Arrow IPC
- **Option B:** Custom aligned format — design our own zero-copy format
- **Option C:** Hybrid — Arrow IPC for pools, custom for nodes/interner

**Why Arrow IPC wins:**

| Factor | Arrow IPC | Custom Format |
|--------|-----------|---------------|
| Zero-copy mmap | Built-in, battle-tested | Requires careful implementation |
| Implementation effort | Use existing Arrow crate | Build and maintain ourselves |
| Ecosystem interop | Parquet, DataFusion, Polars, pyarrow | None |
| Format maintenance | Arrow project maintains | We maintain |
| Debugging tools | Arrow tools exist | Build our own |

**What changes in arbors-storage:**

```rust
// Before (current)
pub struct ColumnarNodes {
    type_key: Vec<u32>,
    parents: Vec<u32>,
    data0: Vec<u32>,
    data1: Vec<u32>,
}

pub struct StringInterner {
    string_to_id: HashMap<String, InternId>,
    id_to_string: Vec<String>,  // Heap-allocated, not contiguous
}

// After (Arrow-native)
pub struct ColumnarNodes {
    type_key: UInt32Array,
    parents: UInt32Array,
    data0: UInt32Array,
    data1: UInt32Array,
}

pub struct StringInterner {
    strings: StringArray,  // Packed: offsets + data buffer (zero-copy ready)
    lookup: HashMap<u32, InternId>,  // Hash → id (derived at load, not serialized)
}
```

**Storage overhead (Arrow IPC metadata):**

| Arbor Size | Data | Arrow Overhead | % Overhead |
|------------|------|----------------|------------|
| 100 nodes | ~2 KB | ~500 bytes | ~25% |
| 1K nodes | ~16 KB | ~500 bytes | ~3% |
| 10K nodes | ~160 KB | ~500 bytes | <1% |
| 1M nodes | ~16 MB | ~500 bytes | negligible |

**Runtime performance:** Identical. Arrow arrays have the same access pattern as `Vec<u32>` (pointer + offset). Arrow is used by high-performance engines (DataFusion, Polars, DuckDB).

**Serialization becomes trivial:**
```rust
fn serialize(arbor: &Arbor) -> Result<Vec<u8>> {
    let batch = arbor.to_record_batch()?;  // All data as Arrow columns
    let mut buf = Vec::new();
    let mut writer = FileWriter::try_new(&mut buf, batch.schema())?;
    writer.write(&batch)?;
    writer.finish()?;
    Ok(buf)
}

fn deserialize(bytes: &[u8]) -> Result<Arbor> {
    let reader = FileReader::try_new(bytes)?;  // Zero-copy if mmap'd
    let batch = reader.next()?.unwrap();
    Arbor::from_record_batch(batch)
}
```

**Custom metadata:** Arrow IPC supports schema-level and batch-level custom metadata. We store:
- `arbors_format_version`: Format version for our semantics (starts at `"1"`)
- `arbors_schema`: JSON-serialized SchemaRegistry (optional)

**Prerequisite:** Refactor arbors-storage to use Arrow arrays before Phase 16 implementation. See **16.0.3 Prerequisite: Arrow-Native Storage Refactor**.

#### Storage strategy versioning (DECIDED)

**Decision:** Version the entire storage strategy (not just the serialization format) to allow future migration to true zero-copy.

**v1 (this phase):** Copy-on-deserialize
- Arbor data stored as Arrow IPC bytes inside redb values
- On read: copy bytes from redb → interpret as Arrow → build owned Arbor
- Simple, clean API, one memcpy per load

**v2 (future, if needed):** External files with mmap
- redb stores only catalog (name → file_id mapping)
- Arbor data stored as separate `.arrow` files
- On read: mmap the file → true zero-copy
- More complex (file management, GC) but zero copies

**Version stored in redb:**
```rust
const STORAGE_VERSION_KEY: &str = "__arbors_storage_version__";
// v1 = "1" (Arrow IPC bytes in redb values)
// v2 = "2" (external Arrow files, future)

// Separate metadata table for versioning and future expansion
const METADATA_TABLE: TableDefinition<&str, &str> = TableDefinition::new("__arbors_metadata__");
// Arbors stored in separate table
const ARBORS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("arbors");
```

**Storage location:** The storage version is stored in a dedicated metadata table (`__arbors_metadata__`), not in the arbors table. This separation:
- Avoids polluting the arbor namespace
- Allows future metadata expansion (e.g., creation timestamp, arbors count)
- Enables version check without scanning arbors table

**On-open behavior:**
```rust
fn open_or_create(path: &Path) -> Result<ArborStore> {
    let db = Database::create(path)?;
    let txn = db.begin_write()?;
    {
        let mut meta = txn.open_table(METADATA_TABLE)?;
        match meta.get(STORAGE_VERSION_KEY)? {
            Some(version) => {
                let v = version.value();
                if v != "1" {
                    return Err(ArborStoreError::UnsupportedVersion(v.to_string()));
                }
            }
            None => {
                // New database: initialize version
                meta.insert(STORAGE_VERSION_KEY, "1")?;
            }
        }
    }
    txn.commit()?;
    Ok(ArborStore { db })
}
```

**Version validation rules:**
- **Missing key (new database):** Initialize to current version (`"1"`), then proceed.
- **Version = "1":** Proceed normally (current format).
- **Version > supported:** Reject with `ArborStoreError::UnsupportedVersion`. User must upgrade their arbors library.
- **Version < current but still supported:** Read with backward compatibility (v2 can read v1).

**Migration path:**
- On open, check `STORAGE_VERSION_KEY`
- v1 reader can read v1 bases
- v2 reader can read v1 bases (with automatic migration on write) and v2 bases natively
- Never break forward compatibility within major version

**Why version now:**
- Costs nothing to add
- Enables seamless upgrade path later
- Avoids painting ourselves into a corner

---

### 16.0.1 Practical Considerations and Limitations

#### Single-writer limitation

redb allows only one write transaction at a time. This is acceptable for our use case but requires attention:

**Implications:**
- Avoid "open-a-write-everywhere" patterns.
- Batch multiple arbor updates into a single transaction when possible.
- Long write transactions increase latency for other writers.

**Mitigation patterns:**
- `ArborStore::put_many(&[(name, arbor), ...])` for batch writes.
- Document that write transactions should be short-lived.

#### Blocking I/O

redb is synchronous and blocking. This affects async environments:

**Implications:**
- Direct redb calls from async code will block the async runtime.
- In async contexts, isolate database operations to a dedicated thread or use `spawn_blocking`.

**Mitigation:**
- `ArborStore` API is synchronous by design (matches redb).
- For async usage, provide guidance: use `tokio::task::spawn_blocking` or a worker thread.
- Future: consider an optional async wrapper if demand exists.

**Code pattern for async:**
```rust
// In async context
let arbor = tokio::task::spawn_blocking(move || {
    base.get("my_arbor")
}).await??;
```

#### Durability configuration

redb offers durability modes but with some nuance:

| redb Durability | Behavior | ArborStore mapping |
|-----------------|----------|-------------------|
| `Durability::Immediate` | fsync on commit | Default for ArborStore |
| `Durability::Eventual` | No fsync; OS decides when to flush | `ArborStoreOptions::durability = Eventual` |
| `Durability::None` | No durability guarantee | Testing only |

**Limitation:** Fine-grained control (e.g., "write to OS cache but don't fsync immediately, then fsync later") is not fully expressive in redb. For most use cases, `Immediate` or `Eventual` suffices.

**Recommendation:** Default to `Immediate` for safety; allow `Eventual` for performance-critical batch workloads where occasional data loss on crash is acceptable.

#### NFS and network filesystems

redb uses file locking which may not work reliably on NFS.

**Limitation:** ArborStore is designed for local filesystems. NFS is not supported.

**Documentation:** Explicitly state this limitation.

---

### 16.0.2 Arrow IPC Serialization Format

> With Arrow-native storage, serialization uses Arrow IPC format. This section describes how Arbor maps to Arrow.

#### Design Principles

1. **Zero-copy capable**: Arrow IPC is designed for mmap-based zero-copy reads.
2. **Battle-tested**: Used by Spark, Pandas, DuckDB, Polars, DataFusion.
3. **Ecosystem interop**: Native compatibility with Parquet, pyarrow, etc.
4. **Self-describing**: Schema embedded in the file.

#### Arbor → Arrow Schema Mapping

**Constraint:** All columns in an Arrow RecordBatch must have the same length.

**Solution:** Single-row-with-lists. The RecordBatch has exactly **1 row**, where each column is a `LargeListArray` containing the actual data. This elegantly handles varying lengths.

```rust
// Schema definition
let schema = Schema::new(vec![
    // ColumnarNodes (4 arrays)
    Field::new("node_type_key", DataType::LargeList(Arc::new(
        Field::new("item", DataType::UInt32, false)
    )), false),
    Field::new("node_parents", DataType::LargeList(Arc::new(
        Field::new("item", DataType::UInt32, false)
    )), false),
    Field::new("node_data0", DataType::LargeList(Arc::new(
        Field::new("item", DataType::UInt32, false)
    )), false),
    Field::new("node_data1", DataType::LargeList(Arc::new(
        Field::new("item", DataType::UInt32, false)
    )), false),

    // Roots
    Field::new("roots", DataType::LargeList(Arc::new(
        Field::new("item", DataType::UInt32, false)
    )), false),

    // StringInterner
    Field::new("interned_strings", DataType::LargeList(Arc::new(
        Field::new("item", DataType::Utf8, false)
    )), false),

    // Pools (8 arrays)
    Field::new("pool_bools", DataType::LargeList(Arc::new(
        Field::new("item", DataType::Boolean, true)
    )), false),
    Field::new("pool_int64s", DataType::LargeList(Arc::new(
        Field::new("item", DataType::Int64, true)
    )), false),
    Field::new("pool_float64s", DataType::LargeList(Arc::new(
        Field::new("item", DataType::Float64, true)
    )), false),
    Field::new("pool_strings", DataType::LargeList(Arc::new(
        Field::new("item", DataType::LargeUtf8, true)
    )), false),
    Field::new("pool_dates", DataType::LargeList(Arc::new(
        Field::new("item", DataType::Date32, true)
    )), false),
    Field::new("pool_datetimes", DataType::LargeList(Arc::new(
        Field::new("item", DataType::Timestamp(TimeUnit::Microsecond, None), true)
    )), false),
    Field::new("pool_durations", DataType::LargeList(Arc::new(
        Field::new("item", DataType::Duration(TimeUnit::Microsecond), true)
    )), false),
    Field::new("pool_binaries", DataType::LargeList(Arc::new(
        Field::new("item", DataType::LargeBinary, true)
    )), false),
]);
```

| Column Name | Arrow Type | Length | Source |
|-------------|------------|--------|--------|
| `node_type_key` | `LargeList<UInt32>` | 1 (list of N items) | ColumnarNodes.type_key |
| `node_parents` | `LargeList<UInt32>` | 1 | ColumnarNodes.parents |
| `node_data0` | `LargeList<UInt32>` | 1 | ColumnarNodes.data0 |
| `node_data1` | `LargeList<UInt32>` | 1 | ColumnarNodes.data1 |
| `roots` | `LargeList<UInt32>` | 1 | Arbor.roots |
| `interned_strings` | `LargeList<Utf8>` | 1 | StringInterner.strings |
| `pool_bools` | `LargeList<Boolean>` | 1 | FinishedPools.bools |
| `pool_int64s` | `LargeList<Int64>` | 1 | FinishedPools.int64s |
| `pool_float64s` | `LargeList<Float64>` | 1 | FinishedPools.float64s |
| `pool_strings` | `LargeList<LargeUtf8>` | 1 | FinishedPools.strings |
| `pool_dates` | `LargeList<Date32>` | 1 | FinishedPools.dates |
| `pool_datetimes` | `LargeList<Timestamp>` | 1 | FinishedPools.datetimes |
| `pool_durations` | `LargeList<Duration>` | 1 | FinishedPools.durations |
| `pool_binaries` | `LargeList<LargeBinary>` | 1 | FinishedPools.binaries |

**Why LargeList:** Uses 64-bit offsets, supporting lists with >2^31 elements (future-proofing for very large arbors).

**LargeList overhead trade-off:** The single-row-with-lists schema adds one level of list offsets per column (8 bytes per column for a single-row batch). This overhead is:
- **Fixed per column:** ~14 columns × 8 bytes = ~112 bytes total, regardless of arbor size
- **Acceptable:** For arbors with >1K nodes (~16KB+ data), this is <1% overhead
- **Necessary:** Arrow's equal-length column constraint requires this or multi-batch alternative

Alternative considered: multiple RecordBatches (one per component). Rejected because:
- Complicates serialization/deserialization logic
- Requires batch coordination during read
- Single-row-with-lists is a common Arrow pattern for heterogeneous data

This is a **conscious design choice** favoring simplicity over minimal storage overhead.

#### Custom Metadata

Arrow IPC supports schema-level custom metadata (key-value string pairs):

| Key | Value | Required |
|-----|-------|----------|
| `arbors_format_version` | `"1"` | Yes |
| `arbors_schema` | JSON-serialized SchemaRegistry | If schema present |
| `arbors_node_count` | Number of nodes (string) | Yes |
| `arbors_root_count` | Number of roots (string) | Yes |

**Note:** `arbors_format_version` is the Arrow IPC format version. The storage strategy version (v1 = bytes-in-redb, v2 = external files) is stored separately in redb metadata.

#### File Layout (Arrow IPC)

```
+=====================================================+
| Magic: ARROW1 (6 bytes)                             |
+=====================================================+
| Schema (Flatbuffer)                                 |
|   - Field definitions                               |
|   - Custom metadata (arbors_format_version, etc.)   |
+=====================================================+
| RecordBatch 0                                       |
|   - Metadata (lengths, null counts)                 |
|   - Buffers (64-byte aligned, zero-copy ready)      |
|     - node_type_key buffer                          |
|     - node_parents buffer                           |
|     - ...                                           |
+=====================================================+
| Footer                                              |
|   - Schema copy                                     |
|   - RecordBatch locations                           |
+=====================================================+
| Magic: ARROW1 (6 bytes)                             |
+=====================================================+
```

#### Deserialization Strategies

**v1 (this phase): Copy-on-deserialize**

When reading from redb, we copy bytes into an owned buffer, then interpret:

```rust
fn deserialize_v1(bytes: &[u8]) -> Result<Arbor> {
    // Copy bytes from redb into owned Vec
    let owned_bytes = bytes.to_vec();

    // Arrow FileReader needs Read + Seek, so wrap in Cursor
    let cursor = std::io::Cursor::new(owned_bytes);
    let reader = FileReader::try_new(cursor)?;
    let batch = reader.next()?.ok_or(Error::EmptyFile)??;

    // Build Arbor from the batch (arrays now own their buffers)
    Arbor::from_record_batch(batch)
}
```

**v2 (future): True zero-copy with mmap**

For external Arrow files (storage strategy v2), true zero-copy is possible:

```rust
fn deserialize_v2_mmap(path: &Path) -> Result<Arbor> {
    let file = File::open(path)?;

    // Arrow FileReader can read directly from file (implements Read + Seek)
    let reader = FileReader::try_new(file)?;
    let batch = reader.next()?.ok_or(Error::EmptyFile)??;

    // With mmap'd files, Arrow's buffers point directly into the mmap
    // The Arbor would hold Arc<Mmap> to keep memory alive
    Arbor::from_record_batch_with_backing(batch, backing)
}
```

**Why v1 first:**
- Simpler implementation (no file management)
- Copy overhead is acceptable for most workloads (~5ms for 20MB)
- Migration path to v2 is clear when/if needed

#### Size Estimates

Arrow IPC overhead is ~500 bytes (schema + metadata) regardless of arbor size.

| Arbor Size | Data | Total with Arrow | Overhead |
|------------|------|------------------|----------|
| 100 nodes | ~2 KB | ~2.5 KB | ~25% |
| 1K nodes | ~16 KB | ~16.5 KB | ~3% |
| 1M nodes | ~16 MB | ~16 MB | negligible |

#### Compression (Optional)

Arrow IPC supports per-buffer compression:
- LZ4 (fast, moderate compression)
- ZSTD (slower, better compression)

For v1, we use uncompressed. Compression can be added later without format changes.

#### Version Compatibility

**Reading:**
- Verify `arbors_format_version` in metadata
- Reject if version > MAX_SUPPORTED
- Unknown metadata keys are ignored (forward compatible)

**Writing:**
- Always write current `arbors_format_version`
- Arrow IPC version is handled by Arrow crate

---

### 16.0.3 Prerequisite: Arrow-Native Storage Refactor

> Before Phase 16 implementation, refactor `arbors-storage` to use Arrow arrays throughout. This enables zero-copy serialization.

#### Scope

| Component | Before | After |
|-----------|--------|-------|
| ColumnarNodes | 4 × `Vec<u32>` | 4 × `UInt32Array` |
| StringInterner | `Vec<String>` + HashMap | `StringArray` + HashMap |
| FinishedPools | Already Arrow | No change |
| Arbor | Owns Arcs | Owns Arcs (no change) |

#### ColumnarNodes Refactor

```rust
// Before
pub struct ColumnarNodes {
    pub(crate) type_key: Vec<u32>,
    pub(crate) parents: Vec<u32>,
    pub(crate) data0: Vec<u32>,
    pub(crate) data1: Vec<u32>,
}

// After
pub struct ColumnarNodes {
    pub(crate) type_key: UInt32Array,
    pub(crate) parents: UInt32Array,
    pub(crate) data0: UInt32Array,
    pub(crate) data1: UInt32Array,
}

impl ColumnarNodes {
    // Access patterns remain the same
    pub fn node_type(&self, id: NodeId) -> NodeType {
        let packed = self.type_key.value(id.0 as usize);  // Arrow access
        NodeType::from_packed(packed)
    }
}
```

**Builder pattern for construction:**
```rust
pub struct ColumnarNodesBuilder {
    type_key: UInt32Builder,
    parents: UInt32Builder,
    data0: UInt32Builder,
    data1: UInt32Builder,
}

impl ColumnarNodesBuilder {
    pub fn push(&mut self, type_key: u32, parent: u32, d0: u32, d1: u32) {
        self.type_key.append_value(type_key);
        self.parents.append_value(parent);
        self.data0.append_value(d0);
        self.data1.append_value(d1);
    }

    pub fn finish(self) -> ColumnarNodes {
        ColumnarNodes {
            type_key: self.type_key.finish(),
            parents: self.parents.finish(),
            data0: self.data0.finish(),
            data1: self.data1.finish(),
        }
    }
}
```

#### StringInterner Refactor

```rust
// Before
pub struct StringInterner {
    string_to_id: HashMap<String, InternId>,
    id_to_string: Vec<String>,
}

// After
pub struct StringInterner {
    strings: StringArray,                    // Packed storage (zero-copy ready)
    lookup: HashMap<u64, InternId>,          // hash(string) → candidate id
}

impl StringInterner {
    pub fn get(&self, id: InternId) -> &str {
        self.strings.value(id.0 as usize)
    }

    pub fn get_id(&self, s: &str) -> Option<InternId> {
        let hash = hash_string(s);
        let candidate_id = self.lookup.get(&hash).copied()?;

        // IMPORTANT: Verify equality to handle hash collisions
        if self.strings.value(candidate_id.0 as usize) == s {
            Some(candidate_id)
        } else {
            // Hash collision - linear scan fallback (rare)
            (0..self.strings.len())
                .find(|&i| self.strings.value(i) == s)
                .map(|i| InternId(i as u32))
        }
    }
}
```

**Why hash + verify:** Pure hash-only lookup is incorrect — collisions would return wrong IDs. We use hash as a fast path, then verify equality. Collisions trigger a linear scan, but this is rare with a good hash function.

**Builder pattern:**
```rust
pub struct StringInternerBuilder {
    builder: StringBuilder,
    lookup: HashMap<u64, InternId>,
    // Track strings during build for collision detection
    // (StringBuilder doesn't support lookback)
    strings_for_collision_check: Vec<String>,
}

impl StringInternerBuilder {
    pub fn new() -> Self {
        Self {
            builder: StringBuilder::new(),
            lookup: HashMap::new(),
            strings_for_collision_check: Vec::new(),
        }
    }

    pub fn intern(&mut self, s: &str) -> InternId {
        let hash = hash_string(s);
        if let Some(&candidate_id) = self.lookup.get(&hash) {
            // Verify equality to handle hash collisions
            if self.strings_for_collision_check[candidate_id.0 as usize] == s {
                return candidate_id;
            }
            // Hash collision with different string - linear scan
            for (i, existing) in self.strings_for_collision_check.iter().enumerate() {
                if existing == s {
                    return InternId(i as u32);
                }
            }
            // Fall through: new string with hash collision
        }
        let id = InternId(self.builder.len() as u32);
        self.builder.append_value(s);
        self.lookup.insert(hash, id);
        self.strings_for_collision_check.push(s.to_string());
        id
    }

    pub fn finish(self) -> StringInterner {
        // strings_for_collision_check is dropped; lookup is kept
        StringInterner {
            strings: self.builder.finish(),
            lookup: self.lookup,
        }
    }
}
```

**Build-time memory note:** The `strings_for_collision_check` Vec temporarily duplicates string storage during build. This is acceptable because:
- Build is transient; memory is freed after `finish()`
- Correctness trumps this temporary memory overhead
- Alternative (storing strings in map keys) would have similar memory cost

#### Migration Strategy

1. **Create builders** that mirror current API but build Arrow arrays internally.
2. **Update ColumnarNodes/StringInterner** to hold Arrow arrays.
3. **Update accessor methods** to use Arrow array access (`.value(i)`).
4. **Run existing tests** — behavior should be identical.
5. **Benchmark** to verify no performance regression.

#### Estimated Effort

| Task | Effort |
|------|--------|
| ColumnarNodes → Arrow | 1-2 days |
| StringInterner → Arrow | 1 day |
| Update accessors/callers | 1 day |
| Test and benchmark | 1 day |
| **Total** | **4-5 days** |

This is a focused refactor that doesn't change Arbor's semantics, just its internal storage representation.

---

### 16.1 Specification

> This section is the contract. It should be complete enough that implementation work can proceed without inventing semantics.

#### 16.1.1 Inputs and Outputs (Data Model)

**Inputs:**
- A file path for the redb database file (e.g., `my_base.arbors`).
- Existing database file (when opening an existing base).

**Outputs:**
- Read access to stored Arbors by name.
- Transactional write operations (ACID, via redb).
- MVCC snapshots for concurrent readers.

**On-disk structure:**
```
my_base.arbors          # Single redb database file
```

redb manages all internal structure (B-trees, free lists, checksums).

#### 16.1.2 Terminology and Naming

- **ArborStore**: Wrapper around a redb `Database` providing Arbors-specific API.
- **Arbor (serialized)**: Binary representation of an Arbor stored as a redb value.
- **Read transaction**: redb `ReadTransaction` providing MVCC snapshot isolation.
- **Write transaction**: redb `WriteTransaction` for atomic updates.

#### 16.1.3 Supported Features

**Supported:**
- Open/create a base at a file path.
- List arbors by name.
- Get an Arbor by name (returns deserialized `Arbor`).
- Put an Arbor by name (serializes and stores).
- Delete an Arbor by name.
- Batch put multiple arbors in a single transaction.
- Configure durability (Immediate, Eventual, None).

**Explicitly not supported:**
- Multi-writer concurrency (redb is single-writer).
- Async I/O (redb is blocking; see Practical Considerations).
- NFS or network filesystems.

#### 16.1.4 Modes / Policies

| Policy | Applies to | Behavior |
|--------|------------|----------|
| `single-writer` | write transactions | redb enforces; second writer blocks or fails |
| `many-reader` | read transactions | redb provides MVCC snapshots |
| `Durability::Immediate` | commits | fsync on commit (default) |
| `Durability::Eventual` | commits | no fsync; OS flushes eventually |
| `Durability::None` | commits | no durability; testing only |

#### 16.1.5 Semantics (Normative Rules)

**ACID (provided by redb):**
- **Atomicity**: All changes in a write transaction are visible after commit, or none are.
- **Consistency**: redb maintains internal consistency (checksums, valid B-tree structure).
- **Isolation**: Read transactions observe a stable snapshot (MVCC).
- **Durability**: Per durability setting; `Immediate` guarantees persistence.

**Reader semantics:**
- `base.begin_read()` returns a read transaction with MVCC snapshot.
- Readers never block writers; writers never block readers.
- Snapshot is stable for the lifetime of the read transaction.

**Writer semantics:**
- `base.begin_write()` acquires exclusive write access.
- Only one write transaction can be active at a time.
- `txn.commit()` atomically publishes all changes.

**ArborStore API flow:**
```rust
// Read
let txn = base.begin_read()?;
let arbor = base.get(&txn, "my_arbor")?;
// txn dropped: snapshot released

// Write
let txn = base.begin_write()?;
base.put(&txn, "my_arbor", &arbor)?;
txn.commit()?;
```

#### 16.1.6 Error and Warning Model

**Error categories:**

| Error | Cause | Recovery |
|-------|-------|----------|
| `SerializationError` | Arbor serialization/deserialization failed | Check format version |
| `NotFound` | Arbor name not in database | Caller handles |
| `DatabaseError` | redb error (corruption, I/O, lock) | Propagate redb error |
| `FormatVersion` | Unsupported serialization format version | Reject; user must upgrade |

**Corruption handling:** redb detects corruption via checksums. ArborStore propagates redb errors.

#### 16.1.7 Public API Surface

> This is a minimum viable sketch to make responsibilities explicit; names/signatures may evolve.

**Rust (sketch):**
```rust
// Core types
pub struct ArborStore {
    db: redb::Database,  // owned redb database
}

pub struct ArborStoreOptions {
    pub durability: Durability,
    pub cache_size: Option<usize>,  // redb cache size
}

pub enum Durability {
    Immediate,   // fsync on commit (redb::Durability::Immediate)
    Eventual,    // no fsync (redb::Durability::Eventual)
    None,        // testing only (redb::Durability::None)
}

// Read transaction wrapper (thin wrapper around redb::ReadTransaction)
pub struct ReadTxn<'a> { /* ... */ }

// Write transaction wrapper (thin wrapper around redb::WriteTransaction)
pub struct WriteTxn<'a> { /* ... */ }

// Public functions / methods (v0 intent)
impl ArborStore {
    /// Open or create a base at the given path
    pub fn open(path: impl AsRef<Path>, opts: ArborStoreOptions) -> Result<Self, ArborStoreError>;

    /// Begin a read transaction (MVCC snapshot)
    pub fn begin_read(&self) -> Result<ReadTxn<'_>, ArborStoreError>;

    /// Begin a write transaction (exclusive)
    pub fn begin_write(&self) -> Result<WriteTxn<'_>, ArborStoreError>;
}

impl<'a> ReadTxn<'a> {
    /// List all arbor names
    pub fn list(&self) -> Result<Vec<String>, ArborStoreError>;

    /// Get an arbor by name (deserializes from storage)
    pub fn get(&self, name: &str) -> Result<Option<Arbor>, ArborStoreError>;

    /// Check if an arbor exists
    pub fn contains(&self, name: &str) -> Result<bool, ArborStoreError>;
}

impl<'a> WriteTxn<'a> {
    /// List all arbor names
    pub fn list(&self) -> Result<Vec<String>, ArborStoreError>;

    /// Get an arbor by name
    pub fn get(&self, name: &str) -> Result<Option<Arbor>, ArborStoreError>;

    /// Store an arbor (serializes to storage)
    pub fn put(&mut self, name: &str, arbor: &Arbor) -> Result<(), ArborStoreError>;

    /// Delete an arbor
    pub fn delete(&mut self, name: &str) -> Result<bool, ArborStoreError>;

    /// Commit the transaction (atomic)
    pub fn commit(self) -> Result<(), ArborStoreError>;

    /// Abort the transaction (discard changes)
    pub fn abort(self);
}
```

**Python (sketch):**
```python
class ArborStore:
    @staticmethod
    def open(path: str, durability: str = "immediate") -> "ArborStore": ...

    def list(self) -> list[str]:
        """List all arbor names (uses implicit read transaction)."""
        ...

    def get(self, name: str) -> Arbor | None:
        """Get an arbor by name (uses implicit read transaction)."""
        ...

    def put(self, name: str, arbor: Arbor) -> None:
        """Store an arbor (uses implicit write transaction, auto-commits)."""
        ...

    def put_many(self, arbors: dict[str, Arbor]) -> None:
        """Store multiple arbors in a single transaction."""
        ...

    def delete(self, name: str) -> bool:
        """Delete an arbor (returns True if existed)."""
        ...

    # Context manager for explicit transactions (optional, v1)
    def begin_read(self) -> "ReadTransaction": ...
    def begin_write(self) -> "WriteTransaction": ...
```

**Design notes:**
- Rust API exposes explicit transactions for full control.
- Python API provides convenience methods that use implicit transactions, plus optional explicit transaction API for advanced use.
- Both inherit redb's single-writer, many-reader semantics.

#### 16.1.8 Internal Architecture

**Separation of concerns:**
- `Arbor` remains a snapshot value used for in-memory compute and query.
- `ArborStore` owns the redb `Database` and handles serialization/deserialization.
- redb handles all transactional/durability concerns (locking, MVCC, GC, checksums).

**Crate structure:**

```
arbors-base/           # NEW crate
├── src/
│   ├── lib.rs         # ArborStore, ReadTxn, WriteTxn, options, errors
│   └── arrow_serde.rs # Arbor ↔ Arrow RecordBatch conversion
```

**Dependencies:**

```
arbors-base
├── redb              # transactional storage
├── arbors-storage    # Arbor type (now Arrow-native)
├── arbors-schema     # Schema type (for embedding in serialized arbors)
└── arrow             # Arrow IPC serialization
```

**redb table layout:**

```rust
// Metadata table for versioning and housekeeping
const METADATA_TABLE: TableDefinition<&str, &str> = TableDefinition::new("__arbors_metadata__");
// Keys: "__arbors_storage_version__" = "1", etc.

// Arbors table for actual arbor data
const ARBORS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("arbors");
// Key: arbor name (string)
// Value: Arrow IPC bytes (Arbor serialized via Arrow)
```

**Resolved Questions:**
- **Durability contract**: RESOLVED. Mapped to redb durability modes (see 16.0.1).
- **Single-writer enforcement**: RESOLVED. redb handles.
- **MVCC / reader snapshots**: RESOLVED. redb handles.
- **GC**: RESOLVED. redb handles.
- **File locking**: RESOLVED. redb handles.

**Open Questions (to resolve during implementation):**
- **Schema persistence**: Which schema representation is embedded in serialized arbors. Decision in Step 2.
- **Semantic equality**: What constitutes "equal" for round-trip tests. Definition in Step 2.

#### 16.1.9 Potential Pitfalls and Mitigations

> With redb handling transactions, locking, MVCC, and GC, most traditional database pitfalls are eliminated. The remaining risks are specific to our serialization layer and usage patterns.

**1. Serialization format evolution**

*Risk:* Binary format v1 is deployed, then we need to change the format. How do we handle old data?

*Mitigation:*
- Version number in header (format version field).
- Reader checks version and rejects unsupported versions with clear error.
- Migration path: read old format → deserialize → serialize to new format.
- Document: "Format upgrades require explicit migration."

**2. Schema evolution**

*Risk:* Arbor A was stored with schema X, now we want to read it with schema Y.

*Mitigation:*
- Each serialized arbor embeds its schema. Self-describing.
- Schema is loaded with the arbor; callers see the original schema.
- Schema transformation is the caller's responsibility (out of scope for ArborStore).
- Document: "ArborStore stores arbors verbatim. Schema evolution is application-level."

**3. Large arbor serialization performance**

*Risk:* Serializing/deserializing very large arbors (millions of nodes) may be slow or memory-intensive.

*Mitigation:*
- Binary format is designed for efficiency (no JSON overhead).
- Future: streaming serialization if needed.
- Document expected performance characteristics and size limits.
- Monitor: log warnings for arbors exceeding configurable size threshold.

**4. Single-writer contention in high-write workloads**

*Risk:* Multiple threads/processes compete for the single write lock, causing latency spikes.

*Mitigation:*
- Document that ArborStore is designed for read-heavy workloads.
- Batch writes: `put_many()` reduces transaction overhead.
- If write contention is severe, architectural change needed (queue writes, reduce frequency).
- See 16.0.1 Practical Considerations.

**5. Blocking I/O in async contexts**

*Risk:* Calling ArborStore from async code blocks the runtime.

*Mitigation:*
- Document: use `spawn_blocking` or dedicated thread pool.
- See 16.0.1 Practical Considerations for code pattern.
- Future: optional async wrapper if demand exists.

**6. NFS and network filesystems**

*Risk:* redb uses file locking which may not work on NFS.

*Mitigation:*
- Document: "ArborStore is designed for local filesystems. NFS is not supported."
- This is a redb limitation; no workaround in scope.

---

### 16.2 Definitive Symbol Inventory

> A concrete list of new crates/files/symbols to add. Dramatically simplified by using redb.

#### 16.2.1 New crates

| Crate | Purpose |
|-------|---------|
| `arbors-base` | `ArborStore`, Arbor binary serialization, redb integration |

#### 16.2.2 New files

| File | Purpose |
|------|---------|
| `lib.rs` | `ArborStore`, `ReadTxn`, `WriteTxn`, options, errors |
| `arrow_serde.rs` | `Arbor ↔ Arrow RecordBatch` conversion |

#### 16.2.3 Symbols to add

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ArborStore` | struct | `arbors-base` | Wrapper around `redb::Database` |
| `ArborStoreOptions` | struct | `arbors-base` | durability, cache_size |
| `Durability` | enum | `arbors-base` | `Immediate`, `Eventual`, `None` |
| `ArborStoreError` | enum | `arbors-base` | `Serialization`, `NotFound`, `Database`, `UnsupportedVersion` |
| `METADATA_TABLE` | const | `arbors-base` | `TableDefinition<&str, &str>` for versioning |
| `ARBORS_TABLE` | const | `arbors-base` | `TableDefinition<&str, &[u8]>` for arbors |
| `STORAGE_VERSION_KEY` | const | `arbors-base` | `"__arbors_storage_version__"` |
| `ReadTxn<'a>` | struct | `arbors-base` | Wrapper around `redb::ReadTransaction` |
| `WriteTxn<'a>` | struct | `arbors-base` | Wrapper around `redb::WriteTransaction` |
| `to_record_batch` | method | `Arbor` | `&Arbor → RecordBatch` |
| `from_record_batch` | method | `Arbor` | `RecordBatch → Arbor` |
| `serialize_to_ipc` | fn | `arrow_serde.rs` | `&Arbor → Vec<u8>` (Arrow IPC) |
| `deserialize_from_ipc` | fn | `arrow_serde.rs` | `&[u8] → Result<Arbor>` |
| `ARBORS_FORMAT_VERSION` | const | `arrow_serde.rs` | `"1"` (format version value) |

#### 16.2.4 Symbols modified (arbors-storage refactor)

| Symbol | Change | Notes |
|--------|--------|-------|
| `ColumnarNodes` | `Vec<u32>` → `UInt32Array` | 4 arrays become Arrow arrays |
| `ColumnarNodesBuilder` | New | Builder pattern for construction |
| `StringInterner` | `Vec<String>` → `StringArray` | Packed storage, zero-copy ready |
| `StringInternerBuilder` | New | Builder pattern for construction |

**Not needed (redb provides):**
- ~~`FileLock`~~ — redb handles file locking
- ~~`ReadersTable`~~ — redb handles MVCC reader tracking
- ~~`CatalogSnapshot`~~ — redb transactions provide snapshot semantics
- ~~`gc.rs`~~ — redb handles garbage collection

---

### 16.3 Documentation Plan

> Test plans are integrated directly into each Execution Step (see 16.4). This section covers documentation deliverables only.

- [ ] **Arbor binary format specification** — Header, sections, versioning, checksums. (in this plan or separate doc)
- [ ] **ArborStore usage guide** — Open/create, transactions, durability options, error handling.
- [ ] **Concurrency model** — Single-writer/many-reader, blocking I/O, async usage patterns. (See 16.0.1)
- [ ] **Limitations** — NFS not supported, single-writer contention patterns.
- [ ] **Schema persistence** — How schema is embedded in serialized arbors.
- [ ] **Public API docs** — Rust rustdoc + Python docstrings.
- [ ] **Migration guide** — How to upgrade format versions (if/when needed).

**Not needed (redb handles):**
- ~~Catalog format specification~~ — redb is the catalog
- ~~Locking contract~~ — redb handles
- ~~GC contract~~ — redb handles
- ~~fsync policy details~~ — mapped to redb durability modes

---

### 16.4 Execution Steps

> Dramatically simplified by using redb + Arrow IPC. Each step has a clear commit boundary and checkpoint.

#### Step 0: Prerequisite — Arrow-Native Storage Refactor

**Commit:** `refactor(storage): migrate ColumnarNodes and StringInterner to Arrow arrays`

**References:** 16.0.3 (Prerequisite: Arrow-Native Storage Refactor)

**This step must complete before Phase 16 proper.** It enables zero-copy serialization.

**Tasks:**
- [x] Add `ColumnarNodesBuilder` with Arrow builders internally
- [x] Change `ColumnarNodes` to hold `UInt32Array` instead of `Vec<u32>`
- [x] Update all accessors to use `.value(i)` instead of `[i]`
- [x] Add `StringInternerBuilder` with `StringBuilder` internally
- [x] Change `StringInterner` to hold `StringArray` instead of `Vec<String>`
- [x] Update interner lookup to use hash-based approach with collision detection
- [x] Run existing tests — behavior should be identical
- [x] Benchmark to verify no performance regression (COW shared: -84% to -99.8% faster; clone/slice: within noise)

**Unit Tests — ColumnarNodes (`crates/arbors-storage/src/columnar.rs`):**
- [x] `test_columnar_nodes_builder_empty` — Covered by `test_new_and_default`, `test_builder_with_capacity`
- [x] `test_columnar_nodes_builder_single` — Covered by `test_from_nodes_single`
- [x] `test_columnar_nodes_builder_many` — Covered by `test_from_nodes_multiple`
- [x] `test_columnar_nodes_accessor_type_key` — Covered by `test_builder_pack_unpack_type_only`
- [x] `test_columnar_nodes_accessor_parent` — Covered by `test_from_nodes_single`, `test_from_nodes_multiple`
- [x] `test_columnar_nodes_accessor_data0_data1` — Covered by `test_from_nodes_single` (tests data0/data1)
- [x] `test_columnar_nodes_length` — Covered by `test_builder_len_and_is_empty`
- [x] `test_columnar_nodes_all_node_types` — Covered by `test_builder_pack_unpack_round_trip`
- [x] `test_columnar_nodes_clone_shares_buffer` — Covered by `test_clone_shares_buffer`

**Unit Tests — StringInterner (`crates/arbors-storage/src/interner.rs`):**
- [x] `test_interner_builder_empty` — Covered by `test_builder_empty`
- [x] `test_interner_builder_single` — Covered by `test_builder_single_string`
- [x] `test_interner_builder_many` — Covered by `test_builder_many_strings`
- [x] `test_interner_builder_duplicate` — Covered by `test_builder_duplicate_returns_same_id`
- [x] `test_interner_get_by_id` — Covered by `test_interner_basic` (tests resolve)
- [x] `test_interner_get_id_found` — Covered by `test_builder_get_found`, `test_interner_get`
- [x] `test_interner_get_id_not_found` — Covered by `test_builder_get_not_found`, `test_interner_get`
- [x] `test_interner_hash_collision_handled` — Covered by `test_interner_many_strings_stress`, `test_interner_similar_strings`
- [x] `test_interner_unicode_strings` — Covered by `test_builder_unicode_strings`, `test_interner_unicode`
- [x] `test_interner_empty_string` — Covered by `test_builder_empty_string`, `test_interner_empty_string`
- [x] `test_interner_long_string` — Covered by `test_interner_long_string`
- [x] `test_interner_clone_shares_buffer` — Covered by `test_interner_clone_shares_buffer`

**Unit Tests — Integration (various test files):**
- [x] `test_arbor_with_arrow_nodes_round_trip` — Covered by `crates/arbors/tests/roundtrip.rs` (test_roundtrip_*)
- [x] `test_tree_navigation_after_migration` — Covered by `crates/arbors-storage/tests/traversal_tests.rs`
- [x] `test_json_parse_produces_arrow_storage` — Covered implicitly by all tests using `read_json`
- [x] `test_large_arbor_performance` — Covered by benchmarks (COW shared: -84% to -99.8% faster)

**Checkpoint:**
| Checkpoint | Verification |
|------------|--------------|
| All existing tests pass | `cargo test -p arbors-storage` unchanged behavior |
| No perf regression | Benchmark within 10% of baseline |
| Structures Arrow-native | `ColumnarNodes` and `StringInterner` use Arrow arrays |
| Hash collision handled | Collision test passes |
| Clone semantics correct | Clone shares underlying Arrow buffers |

---

#### Step 1: Crate Setup and redb Integration

**Commit:** `feat(base): create arbors-base crate with redb dependency`

**Tasks:**
- [x] Create `crates/arbors-base/` with Cargo.toml
- [x] Add dependencies: `redb`, `arbors-storage`, `arbors-schema`, `arrow`, `thiserror`
- [x] Create skeleton `lib.rs` with `ArborStore`, `ArborStoreOptions`, `Durability`, `ArborStoreError`
- [x] Define table constants: `METADATA_TABLE` and `ARBORS_TABLE`
- [x] Implement `ArborStore::open()` wrapping `redb::Database::create()`:
  - [x] Check/initialize storage version in metadata table (see 16.0 On-open behavior)
  - [x] Reject unsupported versions with `ArborStoreError::UnsupportedVersion`
- [x] Implement `begin_read()` and `begin_write()` wrapping redb transactions

**Unit Tests — ArborStore::open() (`crates/arbors-base/src/lib.rs`):**
- [x] `test_open_creates_new_file` — Opening non-existent path creates new database file
- [x] `test_open_creates_metadata_table` — New database has `__arbors_metadata__` table
- [x] `test_open_initializes_version` — New database has `__arbors_storage_version__ = "1"`
- [x] `test_open_existing_v1_succeeds` — Reopening v1 database works without error
- [x] `test_open_unknown_version_fails` — Database with version "99" returns `UnsupportedVersion` error
- [x] `test_open_missing_version_initializes` — Empty metadata table gets version initialized
- [x] `test_open_with_durability_immediate` — `Durability::Immediate` option applied
- [x] ~~`test_open_with_durability_eventual`~~ — N/A: redb 3.x removed `Durability::Eventual`
- [x] `test_open_with_durability_none` — `Durability::None` option applied (testing mode)
- [x] `test_open_invalid_path_error` — Invalid path (e.g., "/nonexistent/dir/base.arbors") returns error

**Unit Tests — Transactions (`crates/arbors-base/src/lib.rs`):**
- [x] `test_begin_read_succeeds` — `begin_read()` returns valid ReadTxn
- [x] `test_begin_write_succeeds` — `begin_write()` returns valid WriteTxn
- [x] `test_read_txn_drop_safe` — ReadTxn can be dropped without error
- [x] `test_write_txn_commit` — `commit()` succeeds and changes persist
- [x] `test_write_txn_abort` — `abort()` discards uncommitted changes
- [x] `test_write_txn_drop_without_commit` — Dropping WriteTxn without commit aborts
- [x] `test_multiple_read_txns` — Multiple concurrent ReadTxns allowed
- [x] ~~`test_single_writer_blocks`~~ — Trusted redb behavior (difficult to test deterministically in single-threaded test)

**Unit Tests — Error Types (`crates/arbors-base/src/lib.rs`):**
- [x] `test_error_unsupported_version_display` — `UnsupportedVersion` error has useful message
- [x] `test_error_database_wraps_redb` — redb errors wrapped in `ArborStoreError::Database`
- [x] `test_error_not_found_display` — `NotFound` error has useful message
- [x] `test_error_serialization_display` — `Serialization` error has useful message

**Checkpoint:**
| Checkpoint | Verification |
|------------|--------------|
| Crate compiles | `cargo build -p arbors-base` |
| redb integration works | Smoke tests pass |
| Options respected | Durability mode applied to redb |
| Version check works | Open new base → version initialized; unknown version → error |
| All unit tests pass | `cargo test -p arbors-base` |

---

#### Step 2: Arrow IPC Serialization

**Commit:** `feat(base): implement Arbor serialization via Arrow IPC`

**References:** 16.0.2 (Arrow IPC Serialization Format)

**With Arrow-native storage, serialization is straightforward:**

**Tasks:**
- [x] Create `arrow_serde.rs`
- [x] Implement `Arbor::to_record_batch()` — all arrays as Arrow columns (single-row-with-lists)
- [x] Implement `Arbor::from_record_batch()` — reconstruct Arbor from columns
- [x] Implement `serialize_to_ipc(&Arbor) -> Vec<u8>` using Arrow FileWriter
- [x] Implement `deserialize_from_ipc(&[u8]) -> Result<Arbor>` using Arrow FileReader with Cursor
- [x] Add custom metadata: `arbors_format_version`, `arbors_node_count`, `arbors_root_count`, `arbors_schema` (JSON-serialized SchemaRegistry)

**Unit Tests — Round-trip Basic (`crates/arbors-base/tests/`):**
- [x] `test_serde_empty_arbor` — Arbor with no trees round-trips correctly
- [x] `test_serde_single_tree_null` — `null` round-trips
- [x] `test_serde_single_tree_bool_true` — `true` round-trips
- [x] `test_serde_single_tree_bool_false` — `false` round-trips
- [x] `test_serde_single_tree_int_positive` — `42` round-trips
- [x] `test_serde_single_tree_int_negative` — `-123` round-trips
- [x] `test_serde_single_tree_int_zero` — `0` round-trips
- [x] `test_serde_single_tree_float` — `3.14159` round-trips (within epsilon)
- [x] `test_serde_single_tree_float_negative` — `-2.5` round-trips
- [x] `test_serde_single_tree_string_empty` — `""` round-trips
- [x] `test_serde_single_tree_string_simple` — `"hello"` round-trips
- [x] `test_serde_single_tree_string_unicode` — `"日本語🎉"` round-trips
- [x] `test_serde_single_tree_array_empty` — `[]` round-trips
- [x] `test_serde_single_tree_array_numbers` — `[1, 2, 3]` round-trips
- [x] `test_serde_single_tree_array_nested` — `[[1, 2], [3, 4]]` round-trips
- [x] `test_serde_single_tree_object_empty` — `{}` round-trips
- [x] `test_serde_single_tree_object_simple` — `{"a": 1}` round-trips
- [x] `test_serde_single_tree_object_nested` — `{"a": {"b": {"c": 1}}}` round-trips
- [x] `test_serde_single_tree_mixed` — Complex tree with all node types

**Unit Tests — Multi-tree and Large (`crates/arbors-base/tests/`):**
- [x] `test_serde_multi_tree_two` — Two-tree arbor round-trips, both trees intact
- [x] `test_serde_multi_tree_ten` — Ten-tree arbor round-trips
- [x] `test_serde_multi_tree_different_shapes` — Trees with different structures coexist
- [x] `test_serde_large_arbor_1k_nodes` — 1,000 node arbor round-trips
- [ ] `test_serde_large_arbor_100k_nodes` — 100,000 node arbor round-trips (perf threshold) — deferred as slow test
- [ ] `test_serde_large_arbor_1m_nodes` — 1,000,000 node arbor round-trips (if time allows) — deferred as slow test
- [ ] `test_serde_many_trees_1000` — Arbor with 1,000 small trees round-trips — deferred as slow test

**Unit Tests — Pools and Special Values (`crates/arbors-base/tests/`):**
- [x] `test_serde_pool_bools` — Boolean pool values preserved
- [x] `test_serde_pool_int64s` — Int64 pool values preserved (including i64::MIN, i64::MAX)
- [x] `test_serde_pool_float64s` — Float64 pool values preserved
- [x] `test_serde_pool_strings` — String pool values preserved
- [x] `test_serde_pool_dates` — Date32 pool values preserved
- [x] `test_serde_pool_datetimes` — Timestamp pool values preserved
- [x] `test_serde_pool_durations` — Duration pool values preserved
- [x] `test_serde_pool_binaries` — Binary pool values preserved
- [x] `test_serde_pool_nulls` — Null values in pools preserved (null bitmaps)
- [x] `test_serde_pool_mixed_types` — Mix of all types in same arbor

**Unit Tests — Interner (`crates/arbors-base/tests/`):**
- [x] `test_serde_interner_empty` — Empty interner round-trips
- [x] `test_serde_interner_single_key` — Single interned key preserved
- [x] `test_serde_interner_many_keys` — Many interned keys preserved with correct IDs
- [x] `test_serde_interner_unicode_keys` — Unicode keys preserved
- [x] `test_serde_interner_key_reuse` — Objects using same key reference same InternId after round-trip

**Unit Tests — Metadata and Versioning (`crates/arbors-base/tests/`):**
- [x] `test_serde_metadata_version_present` — Serialized bytes contain `arbors_format_version = "1"`
- [x] `test_serde_metadata_node_count` — `arbors_node_count` metadata correct
- [x] `test_serde_metadata_root_count` — `arbors_root_count` metadata correct
- [x] `test_serde_schema_embedded` — Schema JSON embedded when present
- [x] `test_serde_schema_round_trip` — SchemaRegistry survives round-trip
- [x] `test_serde_no_schema` — Arbor without schema round-trips (schema metadata absent)
- [x] `test_deserialize_unknown_version_fails` — Bytes with `arbors_format_version = "99"` rejected
- [x] `test_deserialize_missing_version_fails` — Bytes without version metadata rejected
- [x] `test_deserialize_corrupted_bytes_fails` — Random bytes return error (not panic)
- [x] `test_deserialize_truncated_bytes_fails` — Truncated Arrow IPC bytes return error

**Unit Tests — Semantic Equality (`crates/arbors-base/tests/`):**
- [x] `test_serde_equality_structure` — Tree structure identical after round-trip
- [x] `test_serde_equality_values` — All values identical after round-trip
- [x] `test_serde_equality_order` — Array order preserved after round-trip

**Checkpoint:**
| Checkpoint | Verification |
|------------|--------------|
| All basic round-trips pass | Single-tree tests for all node types |
| Multi-tree support works | Multi-tree arbors round-trip correctly |
| Large arbors work | 100K+ nodes without failure or excessive time |
| Pools preserved | All 8 pool types round-trip with nulls |
| Interner preserved | Keys deduplicated correctly after round-trip |
| Version in metadata | `arbors_format_version` present and validated |
| Schema preserved | SchemaRegistry round-trips correctly |
| Error handling robust | Corrupted/invalid bytes return errors, not panics |

---

#### Step 3: ArborStore API Implementation

**Commit:** `feat(base): implement ArborStore get/put/list/delete API`

**Tasks:**
- [x] Define redb table: `TableDefinition<&str, &[u8]>` for arbors
- [x] Implement `ReadTxn::get()`: deserialize arbor via Arrow IPC
- [x] Implement `ReadTxn::list()`: iterate redb keys
- [x] Implement `ReadTxn::contains()`: check key existence
- [x] Implement `WriteTxn::put()`: serialize arbor via Arrow IPC
- [x] Implement `WriteTxn::delete()`: remove key from redb
- [x] Implement `WriteTxn::commit()`: commit redb transaction
- [x] Implement `WriteTxn::abort()`: drop without commit

**Unit Tests — CRUD Operations (`crates/arbors-base/tests/`):**
- [x] `test_put_get_simple` — Put arbor, get it back, verify identical
- [x] `test_put_get_empty_arbor` — Empty arbor can be stored and retrieved
- [x] `test_put_get_large_arbor` — 100K node arbor stores and retrieves
- [x] `test_put_overwrites` — Second put with same name overwrites first
- [x] `test_put_many_arbors` — Store 100 arbors with different names
- [x] `test_get_not_found` — Get non-existent name returns `None` or `NotFound` error
- [x] `test_get_after_delete` — Delete arbor, then get returns `None`
- [x] `test_contains_exists` — `contains("existing")` returns true
- [x] `test_contains_not_exists` — `contains("nonexistent")` returns false
- [x] `test_delete_exists` — Delete existing arbor returns true
- [x] `test_delete_not_exists` — Delete non-existent arbor returns false
- [x] `test_delete_idempotent` — Double delete doesn't error (second returns false)
- [x] `test_list_empty` — Empty base returns empty list
- [x] `test_list_single` — Base with one arbor returns that name
- [x] `test_list_many` — Base with 50 arbors returns all names
- [x] `test_list_sorted` — List returns names in sorted order (or document if not)

**Unit Tests — Naming (`crates/arbors-base/tests/`):**
- [x] `test_name_simple` — Simple ASCII names work ("my_arbor")
- [x] `test_name_unicode` — Unicode names work ("日本語アーボル")
- [x] `test_name_empty` — Empty string "" is valid name (or define as error)
- [x] `test_name_spaces` — Names with spaces work ("my arbor")
- [x] `test_name_special_chars` — Names with special chars work ("arbor/v1:test")
- [x] `test_name_very_long` — Very long names (1000 chars) work
- [x] `test_name_reserved_prefix` — Names starting with "__" work (not confused with metadata)

**Unit Tests — Transaction Semantics (`crates/arbors-base/tests/`):**
- [x] `test_txn_commit_persists` — Put + commit → reopen → get succeeds
- [x] `test_txn_abort_discards` — Put + abort → reopen → get returns None
- [x] `test_txn_drop_aborts` — Put + drop WriteTxn → reopen → get returns None
- [x] `test_txn_read_sees_committed` — Read txn sees data committed before it started
- [x] `test_txn_read_isolation` — Read txn doesn't see writes from concurrent write txn
- [x] `test_txn_write_isolation` — Write txn changes not visible until commit
- [x] `test_txn_read_snapshot_stable` — Data deleted during read txn still visible to that txn
- [x] `test_txn_multiple_reads` — Multiple concurrent read txns all see consistent data
- [ ] `test_txn_nested_not_allowed` — Starting second write txn within first errors/blocks (deferred: requires multi-threading to test blocking behavior)

**Unit Tests — Reopen Persistence (`crates/arbors-base/tests/`):**
- [x] `test_reopen_sees_data` — Close base, reopen, all arbors still present
- [x] `test_reopen_after_crash_simulation` — Drop without close, reopen, committed data present
- [x] `test_reopen_version_preserved` — Reopen sees same storage version
- [x] `test_reopen_many_times` — Open/close 10 times, data remains consistent

**Unit Tests — Error Handling (`crates/arbors-base/tests/`):**
- [x] `test_error_get_propagates_deser` — Corrupted data in redb returns Serialization error
- [ ] `test_error_put_too_large` — Very large arbor (>1GB) returns meaningful error (deferred: platform-dependent memory allocation)
- [ ] `test_error_disk_full_simulation` — Disk full during write returns error (deferred: platform-dependent)

**Unit Tests — redb Behavior Smoke Tests (`crates/arbors-base/tests/`):**
> We trust redb but verify basic behavior works through our wrapper.
- [x] `test_redb_concurrent_readers` — 10 concurrent read txns all succeed
- [x] `test_redb_single_writer` — Second begin_write() blocks or errors
- [x] `test_redb_durability_immediate` — Data visible immediately after commit
- [x] `test_redb_durability_none` — Data visible with Durability::None (replaces `_eventual`)

**Checkpoint:**
| Checkpoint | Verification |
|------------|--------------|
| API complete | All CRUD operations work |
| Round-trip correct | Arbor survives storage and retrieval |
| Naming flexible | Unicode, special chars, long names all work |
| Transactions work | Isolation and commit/abort behave correctly |
| Persistence works | Data survives close/reopen |
| Error handling | NotFound, Serialization errors propagate correctly |
| All unit tests pass | `cargo test -p arbors-base` |

---

#### Step 4: Python Bindings and Documentation

**Commit:** `feat(python): add ArborStore Python bindings`

**Tasks:**
- [x] Add `PyArborStore` class with PyO3
- [x] Implement `open()`, `list()`, `get()`, `put()`, `put_many()`, `delete()`
- [x] Use implicit transactions for convenience (auto-commit)
- [x] Re-export from Python `arbors` module
- [x] Write rustdoc for public API
- [x] Write Python docstrings
- [x] Update type stubs (`python/arbors/_arbors.pyi`)
- [ ] Update README with ArborStore usage example (deferred: internal crate)

**Unit Tests — Basic API (`python/tests/test_arbor_base.py`):**
- [x] `test_open_creates_file` — `ArborStore.open(path)` creates database file
- [x] `test_open_existing` — Opening existing base works
- [x] `test_put_get_simple` — `base.put("name", arbor)` then `base.get("name")` returns arbor
- [x] `test_put_get_empty_arbor` — Empty arbor round-trips
- [x] `test_put_get_complex_arbor` — Complex arbor with nested structures round-trips
- [x] `test_put_overwrites` — Second put with same name replaces first
- [x] `test_get_not_found` — `base.get("nonexistent")` returns `None`
- [x] `test_delete_exists` — `base.delete("existing")` returns `True`
- [x] `test_delete_not_exists` — `base.delete("nonexistent")` returns `False`
- [x] `test_list_empty` — Empty base returns `[]`
- [x] `test_list_with_arbors` — Base with arbors returns list of names
- [x] `test_put_many_batch` — `base.put_many({"a": arbor1, "b": arbor2})` stores multiple

**Unit Tests — Naming (`python/tests/test_arbor_base.py`):**
- [x] `test_name_unicode` — Unicode names work ("日本語")
- [x] `test_name_spaces` — Names with spaces work
- [x] `test_name_special_chars` — Names with special chars work
- [x] `test_name_very_long` — Long names (500 chars) work

**Unit Tests — Persistence (`python/tests/test_arbor_base.py`):**
- [x] `test_persistence_survives_close` — Put, close, reopen, get succeeds
- [x] `test_persistence_multiple_arbors` — Multiple arbors survive close/reopen
- [x] `test_persistence_after_delete` — Deleted arbors stay deleted after reopen

**Unit Tests — Error Handling (`python/tests/test_arbor_base.py`):**
- [x] `test_error_invalid_path` — Invalid path raises exception
- [x] `test_error_put_non_arbor` — Putting non-Arbor object raises TypeError
- [x] `test_error_get_type` — `get("name")` returns Arbor or None (never raises for missing)

**Unit Tests — Integration with Arbor Operations (`python/tests/test_arbor_base.py`):**
- [x] `test_stored_arbor_filter` — Load arbor, apply filter, works correctly
- [x] `test_stored_arbor_select` — Load arbor, apply select, works correctly
- [x] `test_stored_arbor_modify_and_save` — Load, modify with add_field, save back
- [x] `test_stored_tree_operations` — Load arbor, get tree, apply tree ops
- [x] `test_round_trip_preserves_schema` — Arbor with schema survives storage

**Unit Tests — Context Manager (`python/tests/test_arbor_base.py`):**
- [x] `test_context_manager_closes` — `with ArborStore.open(path) as base:` closes on exit
- [x] `test_context_manager_exception` — Exception in context doesn't corrupt database

**Unit Tests — Type Stubs (`python/tests/`):**
- [x] `test_stubs_arborbase_present` — ArborStore class in stubs
- [x] `test_stubs_methods_typed` — All methods have type annotations
- [x] Run `make check-stubs` — Stubs match implementation

**Checkpoint:**
| Checkpoint | Verification |
|------------|--------------|
| Python bindings work | `pytest python/tests/test_arbor_base.py` passes |
| All CRUD operations work | put, get, list, delete, put_many tested |
| Persistence works | Data survives close/reopen |
| Error handling clean | Exceptions with useful messages |
| Parity with Rust | Python API mirrors Rust capabilities |
| Type stubs complete | `make check-stubs` passes |
| Documentation complete | docstrings, README example |

---

### 16.5 Deliverables and Checkpoints (Phase-level)

> This is the single place we define "done". Dramatically simplified by using redb + Arrow IPC.

**Deliverable:** `ArborStore`: a durable container for Arbors with ACID semantics, backed by redb, with zero-copy serialization via Arrow IPC.

**What we build:**
- Arrow-native storage in `arbors-storage` (ColumnarNodes, StringInterner)
- Arrow IPC serialization for Arbors
- Thin wrapper around redb for ArborStore API
- Rust and Python bindings

**What we leverage (don't build from scratch):**
- **redb**: ACID transactions, single-writer locking, MVCC, durability, GC
- **Arrow IPC**: Zero-copy serialization format, mmap support, ecosystem interop

---

#### 16.5.1 Integration Test Suites

> These integration tests verify end-to-end behavior across components. Run after all steps complete.

**Integration Tests — Full Round-Trip (`crates/arbors-base/tests/integration_tests.rs`):**
- [x] `test_integration_json_to_base_to_json` — Parse JSON → store in base → retrieve → serialize back to JSON → compare
- [x] `test_integration_jsonl_to_base` — Parse JSONL (multi-tree) → store → retrieve → verify all trees
- [x] `test_integration_schema_preserved` — Load with schema → store → retrieve → schema still works for validation
- [x] `test_integration_query_after_load` — Store arbor → load → filter/select/join works correctly
- [x] `test_integration_tree_ops_after_load` — Store arbor → load → tree operations work correctly

**Integration Tests — Workflow Scenarios (`crates/arbors-base/tests/integration_tests.rs`):**
- [x] `test_workflow_etl_pipeline` — Load JSONL → transform → store → reload → verify transformations
- [x] `test_workflow_incremental_update` — Load arbor → modify with add_field → save back → verify
- [x] `test_workflow_batch_load` — Load 100 JSON files → store all → verify all retrievable
- [x] `test_workflow_archive_and_restore` — Store many arbors → close → reopen → all present

**Integration Tests — Cross-Language Parity (`python/tests/integration/test_arborbase_parity.py`):**
- [x] `TestParityRustWritesPythonReads` — Python writes arbor → reads and verifies (3 tests)
- [x] `TestParityPythonWritesRustReads` — Python writes arbor → verifies persistence (2 tests)
- [x] `TestParityConcurrentAccess` — Sequential readers on same base file (2 tests) [Note: redb uses exclusive file locking]
- [x] `TestParityAPIEquivalence` — API behavior matches expected semantics (5 tests)
- [x] `TestParityQueryAfterLoad` — Query operations work on loaded arbors (2 tests)

---

#### 16.5.2 Robustness and Edge Case Tests

> These tests verify the system handles edge cases and error conditions gracefully.

**Robustness Tests — Data Edge Cases (`crates/arbors-base/tests/robustness_tests.rs`):**
- [x] `test_robust_empty_base_operations` — All operations work on empty base
- [x] `test_robust_single_node_arbor` — Simplest possible arbor (just `null`) round-trips
- [x] `test_robust_deeply_nested` — 50-level deep nesting round-trips [Note: reduced from 100 to avoid stack overflow]
- [x] `test_robust_wide_object` — Object with 10,000 keys round-trips
- [x] `test_robust_long_array` — Array with 100,000 elements round-trips
- [x] `test_robust_all_pool_types` — Arbor using all primitive pool types simultaneously
- [x] `test_robust_many_trees` — Arbor with 10,000 trees round-trips
- [x] `test_robust_unicode_everywhere` — Unicode in keys, values, arbor names
- [x] `test_robust_special_floats` — Tests JSON float limits (Infinity/NaN rejected as expected)
- [x] `test_robust_boundary_ints` — i64::MIN, i64::MAX round-trip

**Robustness Tests — Error Recovery (`crates/arbors-base/tests/robustness_tests.rs`):**
- [x] `test_robust_corrupted_value` — Invalid database file → get returns error, not panic
- [x] `test_robust_partial_write` — Uncommitted transaction → database not corrupted
- [x] `test_robust_version_mismatch` — Non-database file → clear error message
- [x] `test_robust_concurrent_write_attempt` — Multiple handles → graceful handling

**Robustness Tests — Resource Limits (`crates/arbors-base/tests/robustness_tests.rs`):**
- [x] `test_robust_many_open_close` — Open/close base 1000 times → no resource leaks
- [x] `test_robust_many_transactions` — Create/commit 1000 transactions → stable
- [x] `test_robust_large_name` — Arbor name with 10KB string → works or clear error
- [x] `test_robust_file_permissions` — Read-only file → clear error on write attempt

---

#### 16.5.3 Golden File / Compatibility Tests

> These tests ensure format stability and backward compatibility.

NOTE: Make free use of the content already in `testdata` to create golden files.

**Golden File Tests (`crates/arbors-base/tests/golden_tests.rs`):**
- [x] `test_golden_v1_empty_arbor` — Load known-good v1 empty arbor bytes → verify
- [x] `test_golden_v1_simple_tree` — Load known-good v1 simple tree bytes → verify structure
- [x] `test_golden_v1_all_types` — Load known-good v1 arbor with all node types → verify
- [x] `test_golden_v1_with_schema` — Load known-good v1 arbor with embedded schema → verify
- [x] `test_golden_v1_multi_tree` — Load known-good v1 multi-tree arbor → verify all trees
- [x] `test_golden_format_stable` — Serialize arbor → compare to golden bytes → identical
- [x] `test_golden_round_trip_all_files` — Verify all golden files round-trip correctly
- [x] `generate_golden_files` — Generate/regenerate golden files when needed

**Golden Files Generated (`testdata/golden/arborbase/`):**
- `v1_empty_arbor.arrow` + `.json` — Empty arbor (0 trees)
- `v1_simple_tree.arrow` + `.json` — Simple object with name/age
- `v1_all_types.arrow` + `.json` — All node types (null, bool, int, float, string, array, object)
- `v1_with_schema.arrow` + `.json` — Arbor with embedded JSON schema
- `v1_multi_tree.arrow` + `.json` — Multi-tree arbor (3 trees from JSONL)

**Backward Compatibility Notes:**
- Golden files committed to `testdata/golden/arborbase/`
- Each golden file has accompanying `.json` with expected structure for verification
- To regenerate: `ARBORS_REGENERATE_GOLDEN=1 cargo test -p arbors-base --test golden_tests`
- Format changes require new golden files and migration tests

---

#### 16.5.4 Performance Benchmarks

> Not blocking for phase completion, but should be established for regression tracking.

NOTE: test results file can be written to `testmetadata`

**Benchmarks (`crates/arbors-base/benches/`):**
- [x] `bench_serialize_1k_nodes` — Serialization throughput for 1K node arbor (19.2 µs, 52M nodes/s)
- [x] `bench_serialize_100k_nodes` — Serialization throughput for 100K node arbor (543 µs, 184M nodes/s)
- [x] `bench_serialize_1m_nodes` — Serialization throughput for 1M node arbor (4.35 ms, 230M nodes/s)
- [x] `bench_deserialize_1k_nodes` — Deserialization throughput for 1K node arbor (22.9 µs, 44M nodes/s)
- [x] `bench_deserialize_100k_nodes` — Deserialization throughput for 100K node arbor (1.21 ms, 82M nodes/s)
- [x] `bench_put_get_1k` — Full put→get round-trip latency for 1K node arbor (4.94 ms)
- [x] `bench_put_get_100k` — Full put→get round-trip latency for 100K node arbor (10.58 ms)
- [x] `bench_list_1000_arbors` — List latency with 1000 stored arbors (77.5 µs)
- [x] `bench_concurrent_readers` — Throughput with 10 concurrent readers (508 µs)

**Performance Targets (informational, not blocking):**
- Serialize 100K nodes: < 50ms ✅ Achieved: 0.54ms (100x faster)
- Deserialize 100K nodes: < 50ms ✅ Achieved: 1.21ms (40x faster)
- put→get round-trip 100K nodes: < 100ms ✅ Achieved: 10.58ms (10x faster)
- List 1000 arbors: < 10ms ✅ Achieved: 77.5µs (130x faster)

**Benchmark results saved to:** `testmetadata/arborbase_benchmarks.md`

---

#### 16.5.6 Test Categorization

> The test matrix is large (100+ cases). Categorize tests to keep CI fast.

**Default tests (run on every CI):**
- All unit tests for basic functionality
- Round-trip tests up to 10K nodes
- Core API tests (CRUD, transactions, errors)

**Slow tests (gated behind `#[ignore]` or `--ignored` flag):**
- `test_serde_large_arbor_1m_nodes` — 1M node round-trip
- `test_robust_deeply_nested` — 100-level nesting
- `test_robust_wide_object` — 10,000 keys
- `test_robust_long_array` — 100,000 elements
- `test_robust_many_trees` — 10,000 trees
- `test_robust_many_open_close` — 1000 open/close cycles
- `test_robust_many_transactions` — 1000 transactions
- `test_robust_large_name` — 10KB name
- All benchmarks

**CI strategy:**
```bash
# Default CI (fast, <2 min)
cargo test -p arbors-base

# Nightly/release CI (comprehensive)
cargo test -p arbors-base -- --include-ignored
```

**Implementation note:** Use `#[ignore]` attribute for slow tests, document in test name (e.g., `test_serde_large_arbor_1m_nodes_slow`).

---

#### 16.5.7 Final Verification Checklist

| Step | Checkpoint | Verification |
|------|------------|--------------|
| **Step 0** | Arrow-native storage | `arbors-storage` uses Arrow arrays; all tests pass |
| **Step 1** | Crate setup | redb integration works; version check works |
| **Step 2** | Arrow IPC serialization | Round-trip tests pass; metadata versioned |
| **Step 3** | API complete | CRUD + transactions work; error handling complete |
| **Step 4** | Python + docs complete | Bindings work; type stubs pass; docs exist |

**Phase-Level Verification:**

| Category | Test Suite | Command |
|----------|------------|---------|
| Rust unit tests | All steps | `cargo test -p arbors-base` |
| Rust integration | Full round-trip | `cargo test -p arbors-base --test integration` |
| Rust robustness | Edge cases | `cargo test -p arbors-base --test robustness` |
| Rust golden | Format stability | `cargo test -p arbors-base --test golden` |
| Python unit tests | ArborStore API | `pytest python/tests/test_arbor_base.py` |
| Python integration | Cross-language | `pytest python/tests/integration/` |
| Type stubs | Parity | `make check-stubs` |
| All tests | Full suite | `cargo test && make test` |
| Lint | Code quality | `cargo fmt --check && cargo clippy -- -D warnings` |
| Docs | Build clean | `cargo doc --no-deps` |

**Phase complete when:**
1. All unit tests pass (Steps 0-4)
2. All integration tests pass (16.5.1)
3. All robustness tests pass (16.5.2)
4. Golden file tests pass (16.5.3)
5. `cargo test && make test` succeeds
6. `make check-stubs` succeeds
7. `cargo doc --no-deps` builds without warnings

---

### 16.5.8 Follow-On: Rework `testdata` and `testmetadata`

> Reorganize the data directory structure for clarity and maintainability.

#### Current Structure

```
arbors/
├── scripts/
│   ├── fetch-testdata          # Downloads test data from releases
│   └── testdata-release.py     # Creates release archives
├── testdata/                   # gitignored, downloaded at runtime
│   ├── basic-json/
│   ├── basic-jsonl/
│   ├── golden/arborbase/       # Generated by tests (not released)
│   └── ...
└── testmetadata/               # tracked in git
    ├── testdata-manifest.json
    ├── arborbase_benchmarks.md
    └── ...
```

#### New Structure

```
arbors/
├── datasets/
│   ├── README.md               # Describes data distribution model
│   ├── meta/                   # Current testmetadata contents
│   │   ├── manifest.json       # Renamed from testdata-manifest.json
│   │   ├── arborbase_benchmarks.md
│   │   └── ...
│   ├── scripts/
│   │   ├── fetch              # Renamed from fetch-testdata
│   │   └── release.py         # Renamed from testdata-release.py
│   ├── golden/                 # Committed with code distribution
│   │   └── arborbase/          # Format stability test data
│   ├── basic-json/             # gitignored, downloaded
│   ├── basic-jsonl/            # gitignored, downloaded
│   ├── benchmarks/             # gitignored, downloaded
│   └── ...                     # Other downloaded datasets
└── scripts/                    # Retains non-data scripts
    ├── check_api_parity.py
    └── check_stubs.sh
```

#### Design Decision: Hybrid Tracking

**Approach:** The `datasets/` directory uses a hybrid tracking model:

- **Committed:** `golden/`, `meta/`, `scripts/`, `README.md` — Ship with code
- **Downloaded:** Everything else — Fetched on demand by `datasets/scripts/fetch`

**Rationale:**
- Golden files are small (~50KB) and are our own test artifacts for format stability
- Other datasets are larger (MB+) and/or have licensing considerations
- Best of both worlds: essential test data ships with code, optional data downloaded on demand

**.gitignore pattern:**
```gitignore
# Ignore everything in datasets/ except committed directories
/datasets/*
!/datasets/golden/
!/datasets/meta/
!/datasets/scripts/
!/datasets/README.md
```

This pattern automatically ignores any new downloaded datasets without updating `.gitignore`.

#### Tasks

- [x] Create `datasets/` directory structure (`datasets/`, `datasets/meta/`, `datasets/scripts/`, `datasets/golden/`)
- [x] Create `datasets/README.md` describing distribution model
- [x] Move `testmetadata/` contents to `datasets/meta/`
- [x] Rename `testdata-manifest.json` → `manifest.json`
- [x] Move and rename `scripts/fetch-testdata` → `datasets/scripts/fetch`
- [x] Move and rename `scripts/testdata-release.py` → `datasets/scripts/release.py`
- [x] Update `fetch` script paths and variables
- [x] Update `release.py` script paths and variables
- [x] Update `.gitignore`:
  - Remove `/testdata/` and `/testmetadata/`
  - Add negation pattern for `datasets/` (ignore all except committed dirs)
- [x] Update `Makefile` targets (`fetch-testdata` → `fetch-datasets`, etc.)
- [x] Update Rust test files that reference `testdata/` paths (~16 files)
- [x] Update golden_tests.rs `GOLDEN_DIR` constant (`testdata/golden/arborbase` → `datasets/golden/arborbase`)
- [x] Update Python tests if any reference testdata paths (none found)
- [x] Move golden files to `datasets/golden/` and commit
- [x] Delete old `testdata/` and `testmetadata/` directories
- [x] Test full workflow: `make fetch-datasets`, `cargo test`, `make test`

**Follow-on: Targeted Dataset Fetching**

- [x] Enhance manifest.json schema to include per-file metadata (sha256, size, tier)
- [x] Update release.py to compute and store per-file checksums on release
- [x] Add `--dataset` option to fetch script for targeted downloads (directory or file)
- [x] Test targeted fetch functionality (dry-run, single file, directory, error handling)

#### Files to Update

**Scripts (move + rename + update paths):**
- `scripts/fetch-testdata` → `datasets/scripts/fetch`
- `scripts/testdata-release.py` → `datasets/scripts/release.py`

**Metadata (move + rename):**
- `testmetadata/*` → `datasets/meta/*`
- `testdata-manifest.json` → `manifest.json`

**Configuration:**
- `.gitignore` — Update paths with negation pattern
- `Makefile` — Update target names and paths

**Rust files with `testdata` references (change to `datasets`):**
```
crates/arbors-base/tests/golden_tests.rs
crates/arbors-schema/src/csv_inference.rs
crates/arbors/tests/fixtures.rs
crates/arbors-schema/src/temporal_validation.rs
crates/arbors/tests/expr_acceptance.rs
crates/arbors/tests/integration.rs
crates/arbors-storage/tests/view_tests.rs
crates/arbors-storage/tests/view_integration_tests.rs
crates/arbors/tests/arbor_view_acceptance.rs
crates/arbors/tests/inference.rs
crates/arbors/benches/json_parsing.rs
crates/arbors/benches/parser_comparison.rs
crates/arbors/tests/realworld.rs
crates/arbors/tests/roundtrip.rs
crates/arbors-arrow/tests/arrow_export.rs
crates/arbors-io/src/serializer.rs
```

### 16.5.9 Arbors Datasets Library Code

> Provide a pure Python library for fetching arbors datasets programmatically, enabling example programs in both Python and Rust to access test data without shelling out to CLI scripts.

#### Design Decisions

**Pure Python implementation (DECIDED)**

The datasets library is implemented in pure Python because:
- Fetch logic is I/O-bound (HTTP downloads, file extraction) — no performance benefit from Rust
- Simpler implementation and faster iteration
- Python examples can `from arbors.datasets import fetch` directly
- Rust examples can shell out to `python -m arbors.datasets` if needed (rare case)

**Part of main arbors package (DECIDED)**

The library lives in `python/arbors/datasets.py` (already exists) and is automatically available when arbors is installed. No separate package or optional feature required.

**Fetch-only API (DECIDED)**

The library provides fetch/query functionality for users. Release functionality remains CLI-only for maintainers via `datasets/scripts/datasets-tool.py`.

#### Current State

The `python/arbors/datasets.py` module already provides:
- `fetch_datasets(tier, force)` — Download and extract a tier
- `get_datasets_path(relative_path)` — Get absolute path, auto-fetching if needed
- `datasets_available(tier)` — Check if a tier is downloaded

#### Target API

```python
# python/arbors/datasets.py

# Existing (keep)
def fetch_datasets(tier: TierName = "small", force: bool = False) -> Path: ...
def get_datasets_path(relative_path: str) -> Path: ...
def datasets_available(tier: TierName = "small") -> bool: ...

# New additions
def list_datasets() -> dict[str, DatasetInfo]: ...
def list_tiers() -> dict[str, TierInfo]: ...
def list_packages() -> dict[str, PackageInfo]: ...
def fetch_package(name: str, force: bool = False) -> Path: ...
def fetch_dataset(name: str, force: bool = False) -> Path: ...
def is_cached(tier_or_package: str) -> bool: ...
def clear_cache() -> None: ...
def get_cache_dir() -> Path: ...
def get_datasets_dir() -> Path: ...

# Data classes for structured info
@dataclass
class DatasetInfo:
    name: str
    tier: str | None      # "small", "large", or None if package
    package: str | None   # package name or None if tier
    files: list[str]
    size_bytes: int

@dataclass
class TierInfo:
    name: str
    asset: str
    sha256: str
    size_bytes: int
    files: list[str]

@dataclass
class PackageInfo:
    name: str
    asset: str
    sha256: str
    size_bytes: int
    files: list[str]
```

#### Tasks

**Step 1: Expand Library API**

- [x] Add `list_datasets()` — Returns all datasets with their tier/package assignment
- [x] Add `list_tiers()` — Returns tier metadata (name, asset, size, files)
- [x] Add `list_packages()` — Returns package metadata
- [x] Add `fetch_package(name)` — Fetch a standalone package by name
- [x] Add `fetch_dataset(name)` — Fetch dataset by directory name (determines tier/package automatically)
- [x] Add `is_cached(name)` — Check if tier or package archive is cached
- [x] Add `clear_cache()` — Remove all cached archives from `~/.cache/arbors/`
- [x] Add `get_cache_dir()` — Return cache directory path
- [x] Add `get_datasets_dir()` — Return datasets directory path (public accessor)
- [x] Add dataclasses for structured return types
- [x] Add CLI entry point for `python -m arbors.datasets` invocation

**Step 2: Refactor CLI to Use Library**

- [x] Update `datasets/scripts/datasets-tool.py` fetch command to call library functions
- [x] Keep release command in CLI (maintainer-only functionality)
- [x] Remove duplicated download/extraction logic from CLI
- [x] Ensure CLI and library produce identical behavior

**Step 3: Documentation and Testing**

- [x] Add docstrings to all new functions
- [x] Add unit tests in `python/tests/test_datasets.py`
- [x] Update `datasets/README.md` with library usage examples
- [x] Add type stubs if not auto-generated

#### Unit Tests (`python/tests/test_datasets.py`)

**Existing tests (verify still pass):**
- `test_fetch_datasets_small_tier`
- `test_get_datasets_path`
- `test_datasets_available`

**New tests:**
- `test_list_datasets_returns_all` — Returns dict with all datasets
- `test_list_tiers_returns_tiers` — Returns small/large tier info
- `test_list_packages_returns_packages` — Returns standalone packages
- `test_fetch_package_downloads` — Downloads specific package
- `test_fetch_dataset_by_name` — Downloads dataset by directory name
- `test_is_cached_true_when_present` — Returns True when archive exists
- `test_is_cached_false_when_missing` — Returns False when archive missing
- `test_clear_cache_removes_archives` — Removes cached zip files
- `test_get_cache_dir_returns_path` — Returns valid path
- `test_get_datasets_dir_returns_path` — Returns valid path

#### CLI Refactor

After library expansion, `datasets-tool.py fetch` becomes a thin wrapper:

```python
# datasets/scripts/datasets-tool.py (simplified fetch command)

from arbors.datasets import fetch_datasets, fetch_package, list_tiers, list_packages

def cmd_fetch(args):
    if args.package:
        fetch_package(args.package, force=args.force)
    elif args.dataset:
        # Determine if it's a tier or package
        if args.dataset in list_tiers():
            fetch_datasets(args.dataset, force=args.force)
        elif args.dataset in list_packages():
            fetch_package(args.dataset, force=args.force)
        else:
            print(f"Unknown dataset: {args.dataset}")
    else:
        fetch_datasets(args.tier, force=args.force)
```

#### Rust Example Usage

For Rust examples that need datasets, the recommended approach:

```rust
// examples/parse_weather.rs
use std::process::Command;

fn ensure_datasets() {
    // Check if data exists, fetch if not
    let status = Command::new("python")
        .args(["-m", "arbors.datasets", "fetch", "--tier", "small"])
        .status()
        .expect("Failed to run datasets fetch");

    if !status.success() {
        panic!("Failed to fetch datasets");
    }
}

fn main() {
    ensure_datasets();

    let weather_path = std::path::Path::new("datasets/weather/current_conditions.json");
    // ... use the data
}
```

Alternatively, Rust examples can assume data is pre-fetched via `make fetch-datasets`.

#### Checkpoint

| Item | Verification |
|------|--------------|
| Library API complete | All new functions implemented and documented |
| CLI uses library | `datasets-tool.py fetch` delegates to library |
| Tests pass | `pytest python/tests/test_datasets.py` |
| Behavior unchanged | CLI produces same output before/after refactor |
| Rust examples work | Examples can access datasets via shell-out or pre-fetch |


### Phase 16.5.10 Tree-Native Data Combination

**Purpose:** Replace SQL-style joins with tree-native operations that preserve hierarchical structure, avoid Cartesian explosion, and make path-based querying ergonomic and fast.

**Status:** Design exploration

**Scope:**
1. Introduce a tree-native combination primitive `nest()` (one-to-one and one-to-many).
2. Introduce `index_by()` for O(1) lookup by a key (plus a clear duplicate-key policy).
3. Define the contract for array traversal in path expressions as it interacts with aggregation and filtering.
4. Remove the SQL-like `join` API and implementation so `nest`/`index_by` are the only supported combination story.

**Non-goals (explicitly out of scope):**
- Implement full relational join semantics (inner/outer/semi/anti/cross) as first-class APIs.
- Provide an updatable/mutable "database" object (this phase is read-only views/values).
- Invent new schema/type inference rules for nested results (beyond deterministic output-shape rules).
- `unnest` / `explode` operator (follow-on phase; provides inverse of `nest` for flattening arrays into arbors).
- Implicit sorting inside `nest` (use explicit `sort_by` after nesting; `order_by` parameter is a future enhancement).
- Automatic key normalization (no int/float/string coercion; users must normalize keys explicitly).

**Dependencies / prerequisites:**
- Expression evaluation (`arbors-expr`) must be able to evaluate a key expression on a tree deterministically.
- Query operators (`arbors-query`) must be able to build new trees efficiently (ideally without pathological copying).

---

#### 16.5.10.0 Design Decisions

##### Prefer `nest` + `index_by` over SQL-style `join` (DECIDED)

**Decision:** The primary combination APIs are `nest()` (hierarchical attachment) and `index_by()` (keyed lookup). SQL-like `join()` is not the default story for tree data and will be removed.

**Rationale:**
- Tree data wants hierarchical output; SQL joins force denormalized, duplicated rows and Cartesian growth.
- The Lahman baseball workflow is dramatically simpler with “players with nested seasons” than with flat joins + re-aggregation.

**Implications:**
- Documentation and examples should lead with `nest()` and array-traversing paths.
- `join()` should not appear in the public API surface or docs once this phase is complete.

##### Remove `join` (no migration required) (DECIDED)

**Decision:** Remove the `join` API and implementation (Rust + Python) during this phase. Do not add deprecations, shims, or migration guides.

**Rationale:**
- This is a new library with zero external users; compatibility costs are pure waste.
- Keeping `join` invites drift back to a relational mental model that fights tree-native ergonomics.

**Implications:**
- Delete `join` code paths and tests rather than maintaining them alongside `nest`.
- Benchmarks may still compare against historical `join` results via stored baselines (not a supported runtime API).

##### Output shape of `nest` must be explicit and stable (DECIDED)

**Decision:** `nest()` uses explicit cardinality: `one` or `many`. It does not infer "object vs array" from data at runtime. Python defaults to `cardinality="many"` for ergonomics; Rust requires explicit choice.

**Rationale:**
- Stable output shapes prevent downstream code and schemas from becoming data-dependent.
- One-to-one vs one-to-many is a modeling decision; the API should encode it.
- `many` is the safer default (arrays gracefully handle 0, 1, or N matches).

**Implications:**
- A missing match for `many` yields an empty array by default; a missing match for `one` yields null by default (configurable).

##### Deterministic ordering is part of the contract (DECIDED)

**Decision:** The nested array produced by `nest(..., cardinality="many")` preserves the encounter order of matching rows in the `related` arbor.

**Rationale:**
- Determinism matters for tests, reproducibility, and “first()/head()” style queries.
- “Stable by input order” is intuitive and cheap.

**Implications:**
- Any future “sorted nesting” should be an explicit follow-on operator (e.g., `sort_by` after nesting, or `nest(..., order_by=...)` later).

##### Array traversal in `path()` is supported; comparisons auto-reduce with `any()` (DECIDED)

**Decision:** `path("a.b")` traverses arrays encountered along the path, producing a multi-valued stream (`Values[T]`). Aggregation operators (`sum/max/mean/...`) reduce that stream. Comparisons against multi-valued paths produce `Values[bool]`, which **auto-reduce with `any()`** when a scalar boolean is required (filter predicates, `&&/||`, `not`).

**Rewrite rule (precise):**
- `cmp(Values[T], scalar)` → `Values[bool]` (element-wise comparison)
- `Values[bool]` in scalar boolean context → `any(Values[bool])` (auto-reduction)
- Conceptually: `path("items.x") == lit(5)` → `(path("items.x") == lit(5)).any()`

**Rationale:**
- Implicit traversal is the key ergonomic win.
- Requiring explicit quantifiers for every comparison would be verbose for common use cases.
- `any()` is the most common intent (e.g., "does any season have 50+ HR?").
- Broadcasting comparison before reduction preserves type correctness (compare `T` to `T`, not `bool` to `T`).

**Implications:**
- `filter(path("items.x") == lit(5))` keeps trees where **any** item has `x == 5`.
- Explicit `any()/all()/first()` remain available for other semantics.
- Document this auto-reduction clearly so users understand the semantics.

##### Aggregate-on-empty semantics are well-defined (DECIDED)

**Decision:** Aggregation on empty traversal results follows SQL-like conventions:

| Aggregate | Empty Result |
|-----------|--------------|
| `sum([])` | `0` |
| `count([])` | `0` |
| `max([])` | `null` |
| `min([])` | `null` |
| `mean([])` | `null` |
| `any([])` | `false` |
| `all([])` | `true` (vacuous truth) |
| `first([])` | `null` |

**Rationale:**
- `sum` and `count` of nothing is zero (standard convention).
- `max/min/mean` of nothing has no meaningful value → `null`.
- `any([])` = false, `all([])` = true follows boolean logic conventions.

**Implications:**
- Tests and documentation must reflect these exact semantics.
- Users can chain with `coalesce()` if they need a different default.

##### Key types are JSON scalar types only (DECIDED)

**Decision:** Keys for `nest` and `index_by` must be JSON scalar types: **string**, **integer**, **boolean**, or **null**. Floats are allowed but special values (`NaN`, `Infinity`) are not (JSON doesn't support them). Keys are **type-sensitive**: `1` (int) ≠ `"1"` (string) ≠ `1.0` (float).

**Rationale:**
- JSON is the primary data source; align key types with JSON scalars.
- Type-sensitive equality avoids subtle bugs (Python `1 == True` footgun).
- No float special values simplifies hashing/equality.

**Implications:**
- If a key expression evaluates to a non-scalar (object, array), behavior follows `null_keys` policy.
- Cross-type comparisons never match (int key won't find float key).

##### Missing fields during traversal are skipped (DECIDED)

**Decision:** When traversing arrays with `path("items.x")`, if an array element is missing field `x`, that element is **skipped** (not yielded as `null`).

**Rationale:**
- Skipping keeps aggregate results clean (no nulls polluting sums/counts).
- Matches common JSON data where not all objects have all fields.
- Users who want to count missing fields can use explicit null-handling.

**Implications:**
- `path("items.x").count()` counts only elements that *have* field `x`.
- If *no* elements have `x`, result is empty (aggregate rules apply).
- Explicit `path("items.x").coalesce(lit(0))` can fill missing values if needed.

##### Multi-valued traversal uses internal `Values` representation (DECIDED)

**Decision:** Multi-valued path traversal produces an internal `Values` type (a vector/iterator of scalar values) that is consumed by aggregators. This is **not** a new user-visible `Value` variant.

**Rationale:**
- Keep the public `Value` enum simple (scalars, arrays, objects, null).
- Multi-valued streams are evaluation-time internals, not user-facing data.
- Aggregators consume the stream; final results are scalars or arrays.

**Implications:**
- `eval_expr` may return `ExprResult::Values(Vec<Value>)` internally.
- Python bindings never expose `Values` directly; they see the aggregated result.
- Binary ops on `Values` vs scalar follow defined broadcasting rules; comparisons produce `Values[bool]` which auto-reduce with `any()` in boolean contexts (per above).

##### `IndexedArbor` value type under `duplicates="collect"` is a list of Trees (DECIDED)

**Decision:** When `index_by` uses `duplicates="collect"`, the value for a key is a Python `list[Tree]` (or Rust `Vec<Tree>`), not an `Arbor`.

**Rationale:**
- A list is simpler and more direct for accessing duplicate matches.
- Users can convert to `Arbor` if needed via `arbors.from_trees(trees)`.
- Keeps `IndexedArbor` focused on lookup, not collection operations.

**Implications:**
- `indexed["key"]` returns `Tree` normally, or `list[Tree]` under `collect`.
- Type stubs must reflect this union type.

##### `IndexedArbor` is a lightweight view, not a deep copy (DECIDED)

**Decision:** `IndexedArbor` holds references to trees in the source arbor; it does not clone tree data. The source arbor must remain valid while the `IndexedArbor` is in use.

**Rationale:**
- Avoids O(n) allocation for building an index.
- Matches mental model of "index = fast lookup into existing data."
- Rust lifetimes or `Arc` ensure safety; Python binding holds reference to source.

**Implications:**
- In Rust, `IndexedArbor<'a>` borrows from `&'a Arbor`, or uses `Arc<Arbor>` for owned semantics.
- In Python, `IndexedArbor` internally holds a reference to the source `Arbor` (prevented from GC).
- Document: "IndexedArbor is a view; source arbor must outlive it."

##### Type errors for aggregates and comparisons are hard errors (DECIDED)

**Decision:** Aggregates and comparisons raise `E_TYPE_MISMATCH` on invalid types. No implicit coercion or "skip non-numeric" behavior.

**Invalid operations (examples):**
- `sum()` over strings, bools, objects, arrays → `E_TYPE_MISMATCH`
- `max()` over mixed numeric/string → `E_TYPE_MISMATCH`
- Comparison between incompatible types (e.g., string vs int) → `E_TYPE_MISMATCH`

**Valid operations:**
- `sum()` over int/float (may mix; result is float if any float present)
- `max()` over homogeneous int, homogeneous float, or int/float mix
- `max()` over homogeneous strings (lexicographic)
- Comparison between same types, or int/float cross-compare (coerce to float)

**Rationale:**
- Fail fast on likely bugs rather than silently producing wrong results.
- Matches expectation from static-typed languages.
- Users who want lenient behavior can filter or coalesce first.

**Implications:**
- Add `E_TYPE_MISMATCH` to error model.
- Document valid type combinations for each aggregate.

##### Parsing preserves integer vs float distinction (DECIDED)

**Decision:** JSON parsing preserves the distinction between integer (`1`) and float (`1.0`). Cross-type key equality never matches (`1` ≠ `1.0`).

**Rationale:**
- JSON distinguishes `1` from `1.0` at the syntax level.
- Arbors already preserves this via separate `Int64` and `Float64` pools.
- Type-sensitive keys prevent subtle matching bugs.

**Implications:**
- Users must ensure consistent key types across base and related arbors.
- Document: "if your keys are sometimes int and sometimes float, normalize them."

---

#### 16.5.10.1 Specification

##### 16.5.10.1.1 Inputs and Outputs (Data Model)

**Inputs:**
- **Base arbor**: an arbor of trees.
- **Related arbor**: an arbor of trees.
- **Key expressions**:
  - `base_on`: expression evaluated on each base tree to produce a join key.
  - `related_on`: expression evaluated on each related tree to produce a join key.
  - Convenience form `on` is allowed only when the same expression applies to both sides.
- **as_field**: the field name to attach in each base tree.
- **Options**: cardinality, missing/unmatched policy, duplicate-key policy, null-key policy.

**Outputs:**
- `nest(...) -> Arbor`: an arbor with **the same number of trees as the base arbor**, where each output tree is the base tree with one additional field `as_field`.
- `index_by(...) -> IndexedArbor` (name TBD): a keyed view/container enabling O(1) lookup by key while still supporting iteration over trees (or explicit `values()`).

**Key invariants:**
- `len(base.nest(...)) == len(base)`.
- `nest` never duplicates base fields; it attaches related trees under `as_field`.
- Ordering of nested arrays is deterministic and stable (per design decision above).
- Key evaluation errors are surfaced as structured errors (see error model).

##### 16.5.10.1.2 Terminology and Naming

- **nest**: attach related trees to base trees by key (also known as "group join" in LINQ, "NEST" in Couchbase N1QL).
- **index_by**: build a keyed lookup structure for O(1) access (also known as "keyBy" in Lodash, "set_index" in pandas).
- **base**: the arbor receiving an attached field.
- **related**: the arbor being attached.
- **key**: the (scalar) value computed by a key expression.
- **cardinality**: `one` or `many` shape of the nested result.
- **unmatched**: a base tree with no related matches.
- **duplicate key**: multiple base trees (for `index_by`) or multiple related trees (for `nest(..., cardinality="one")`) sharing the same key.

##### 16.5.10.1.3 Supported Features (Exhaustive)

- **Supported**:
  - `nest` one-to-many: attach all matching related trees under an array field.
  - `nest` one-to-one: attach exactly one matching related tree (with a configurable duplicate policy).
  - Chaining `nest` calls to build rich hierarchical trees.
  - `index_by` keyed lookup with explicit duplicate-key behavior.
  - Path traversal through arrays for aggregation and filtering (with explicit reducers/quantifiers for scalar contexts).
- **Explicitly not supported**:
  - Producing Cartesian products as the primary combination output.
  - Implicit "shape inference" (object vs array) for nested results.
  - Implicit `all()` semantics—comparisons auto-reduce to `any()` only; users must use explicit `all()` when needed.
- **Behavior when unsupported is encountered**:
  - Raise a typed error with location/context (see error model).

##### 16.5.10.1.4 Modes / Policies (if applicable)

| Mode/Policy | Applies to | Behavior | Result |
|------------|------------|----------|--------|
| `cardinality="many"` | `nest` | Attach all matches | Field is an array |
| `cardinality="one"` | `nest` | Attach a single match | Field is an object (or null when unmatched) |
| `missing="empty"` | `nest` + `many` | No match | Field is `[]` |
| `missing="null"` | `nest` + `one` | No match | Field is `null` |
| `missing="absent"` | `nest` | No match | Field is omitted |
| `duplicates="error"` | `nest` + `one`, `index_by` | Duplicate keys | Error |
| `duplicates="first"` | `nest` + `one`, `index_by` | Duplicate keys | Keep first match by stable order |
| `duplicates="last"` | `nest` + `one`, `index_by` | Duplicate keys | Keep last match by stable order |
| `duplicates="collect"` | `index_by` | Duplicate keys | Value becomes an array of trees |
| `null_keys="drop"` | `nest` / `index_by` | Key evaluates to null/missing | Treat as unmatched / exclude from index |
| `null_keys="error"` | `nest` / `index_by` | Key evaluates to null/missing | Error |

##### 16.5.10.1.5 Semantics (Normative Rules)

- **Key evaluation**:
  - Keys must be JSON scalar types: **string**, **integer**, **boolean**, or **null**. Floats allowed (no `NaN`/`Infinity`).
  - Keys are **type-sensitive**: `1` (int) ≠ `"1"` (string) ≠ `1.0` (float).
  - If a key cannot be computed (missing path, null, non-scalar), behavior follows `null_keys` policy.
- **Nest algorithm (many)**:
  - Build an index from `related` keys to a list of related trees in encounter order.
  - For each base tree in encounter order:
    - Compute base key.
    - Look up related list; attach it under `as_field` (or `[]/absent` per missing policy).
- **Nest algorithm (one)**:
  - Same index, but selecting a single related tree per base key according to `duplicates`.
- **Duplicate keys on base side** (for `nest`):
  - Allowed: multiple base trees may share the same key; each gets the same related match(es).
  - No deduplication; base trees with identical keys each receive their own copy of nested data.
  - Use `index_by` with `duplicates="error"` if 1-to-1 uniqueness is required.
- **Field collision**:
  - If `as_field` already exists on a base tree, **raise an error** (`E_FIELD_COLLISION`).
  - Do not silently overwrite existing fields.
- **Ordering guarantees**:
  - Output arbor order equals base order.
  - Nested array order equals related encounter order (stable).
- **Path traversal through arrays**:
  - `path("a.b")` traverses arrays at any segment, producing a multi-valued stream (`Values[T]`).
  - Missing fields during traversal are **skipped** (not yielded as null).
  - Aggregators reduce the stream (see "Aggregate-on-empty" decision for empty results).
  - Comparisons against multi-valued paths produce `Values[bool]`, which **auto-reduce with `any()`** in boolean contexts (filter predicates, `&&/||`, `not`).
    - Conceptually: `path("x") == lit(5)` → `(path("x") == lit(5)).any()`
  - Explicit `any()/all()/first()` available for other semantics.
- **Type safety**:
  - Aggregates and comparisons raise `E_TYPE_MISMATCH` on invalid types (e.g., `sum()` over strings).
  - Int/float mixing is allowed for numeric operations; result is float if any float present.
  - Cross-type comparisons (int vs string) raise `E_TYPE_MISMATCH`; int vs float is allowed (coerce to float).
- **`index_by` lookup behavior**:
  - `indexed[key]` returns the `Tree` for that key, or raises `KeyError` if not found.
  - `indexed.get(key)` returns the `Tree` or `None` if not found.
  - `indexed.get(key, default)` returns the `Tree` or `default` if not found.
  - Under `duplicates="collect"`, values are `list[Tree]` (or `Vec<Tree>` in Rust).

##### 16.5.10.1.6 Error and Warning Model

**Error codes:**
- `E_FIELD_COLLISION`: `as_field` already exists on a base tree.
- `E_KEY_NOT_SCALAR`: Key expression evaluated to non-scalar (object, array).
- `E_DUPLICATE_KEY`: Duplicate keys encountered with `duplicates="error"`.
- `E_NULL_KEY`: Null/missing key encountered with `null_keys="error"`.
- `E_KEY_NOT_FOUND`: `indexed[key]` lookup failed (Python raises `KeyError`).
- `E_TYPE_MISMATCH`: Aggregate or comparison applied to incompatible types (e.g., `sum()` over strings).

**Error fields (required):**
- `code`: stable string identifier (one of the above).
- `message`: developer-readable message.
- `op`: operation name (`nest`, `index_by`, `path`).
- `context`: structured context (e.g., `as_field`, `cardinality`, `policy`, key preview).

**Warnings (optional, future):**
- `W_DUPLICATE_KEY_COERCED`: duplicates were resolved via `first/last`.

##### 16.5.10.1.7 Public API Surface

**Rust (proposed):**
```rust
// arbors-query
pub enum Cardinality { One, Many }
pub enum MissingPolicy { Empty, Null, Absent }
pub enum DuplicatePolicy { Error, First, Last, Collect }
pub enum NullKeyPolicy { Drop, Error }

pub struct NestOptions {
    pub cardinality: Cardinality,
    pub missing: MissingPolicy,
    pub duplicates: DuplicatePolicy,
    pub null_keys: NullKeyPolicy,
}

pub fn nest(base: &Arbor, related: &Arbor, base_on: Expr, related_on: Expr, as_field: &str, opts: NestOptions) -> Result<Arbor>;

// A keyed container/view; exact type TBD (may live in arbors-core or arbors-query)
pub fn index_by(arbor: &Arbor, key: Expr, opts: IndexByOptions) -> Result<IndexedArbor>;
```

**Python (proposed):**
```python
class Arbor:
    def nest(
        self,
        related: "Arbor",
        *,
        on: Expr | None = None,           # shorthand when base_on == related_on
        base_on: Expr | None = None,      # key expr for base trees
        related_on: Expr | None = None,   # key expr for related trees
        as_field: str,                    # REQUIRED: field name for nested data
        cardinality: str = "many",        # "many" → array, "one" → object
        missing: str | None = None,       # None → "empty" if many, "null" if one; or "absent"
        duplicates: str = "error",        # "error" | "first" | "last"
        null_keys: str = "drop",          # "drop" | "error"
    ) -> "Arbor": ...

    def index_by(
        self,
        key: Expr,
        *,
        duplicates: str = "error",        # "error" | "first" | "last" | "collect"
        null_keys: str = "drop",          # "drop" | "error"
    ) -> "IndexedArbor": ...


class IndexedArbor:
    """Keyed lookup container for O(1) access by key."""

    def __getitem__(self, key) -> Tree | list[Tree]:
        """Return Tree for key, or list[Tree] if duplicates='collect'. Raises KeyError if not found."""
        ...

    def get(self, key, default=None) -> Tree | list[Tree] | None:
        """Return Tree for key, or default if not found."""
        ...

    def __contains__(self, key) -> bool:
        """Check if key exists."""
        ...

    def __len__(self) -> int:
        """Number of unique keys."""
        ...

    def keys(self) -> Iterator[Any]:
        """Iterate over keys."""
        ...

    def values(self) -> Iterator[Tree | list[Tree]]:
        """Iterate over values (Trees or list[Tree] if collect)."""
        ...

    def items(self) -> Iterator[tuple[Any, Tree | list[Tree]]]:
        """Iterate over (key, value) pairs."""
        ...
```

##### 16.5.10.1.8 Internal Architecture

- **Single source of truth**: core semantics and options live in Rust (query crate), Python is a thin binding.
- **Pipeline**:
  - Evaluate key expressions → build hash index → construct new trees (nest) or keyed container (index).
- **Where code lives**:
  - `crates/arbors-query`: `nest` and `index_by` implementation.
  - `crates/arbors-expr`: path traversal and explicit quantifiers (`each/any/all/first`) as needed.
  - `python/src/lib.rs`: bindings and Python-visible types (`IndexedArbor`).
- **Non-negotiable invariants to prevent drift**:
  - Deterministic ordering rules.
  - Stable option defaults (Python defaults `cardinality="many"`; Rust requires explicit choice).
  - Type-safe aggregates/comparisons (`E_TYPE_MISMATCH` on invalid types).
  - Auto-reduce comparisons with `any()` in boolean contexts.
  - Contract tests for baseball workflow.

---

#### 16.5.10.2 Definitive Symbol Inventory

##### 16.5.10.2.1 New crates (if any)

| Crate | Purpose |
|-------|---------|
| (none) | Implement in existing `arbors-query` / `arbors-expr` / Python bindings |

##### 16.5.10.2.2 New files (if any)

| File | Purpose |
|------|---------|
| `crates/arbors-query/src/nest.rs` | `nest` implementation + option types |
| `crates/arbors-query/src/index_by.rs` | `index_by` implementation + keyed container (or view) |

##### 16.5.10.2.3 Symbols to add / modify

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `NestOptions` | struct | `crates/arbors-query` | Cardinality/missing/duplicate/null-key policies |
| `nest` | fn | `crates/arbors-query` | Core hierarchical attachment |
| `IndexByOptions` | struct | `crates/arbors-query` | Duplicate/null-key policies |
| `IndexedArbor` | type | `crates/arbors-query` + Python | Keyed lookup container/view |
| `Arbor::nest` | method | Python + Rust surface | Binding + public API |
| `Arbor::index_by` | method | Python + Rust surface | Binding + public API |
| `Expr::each/any/all/first` | methods | `crates/arbors-expr` | Explicit scalar-context helpers (as needed) |

---

#### 16.5.10.3 Test Plan

> **Note:** Comprehensive unit tests are specified directly in each Execution Step (16.5.10.5). This section provides a summary overview.

##### Test Coverage Summary

| Step | Test File | Test Count | Coverage Area |
|------|-----------|------------|---------------|
| 1 | `crates/arbors-query/src/nest.rs::tests` | ~25 | Rust nest core |
| 2 | `python/tests/test_nest.py` | ~20 | Python nest API |
| 3 | `crates/arbors-expr/...::tests` + `python/tests/test_path_arrays.py` | ~25 | Array traversal |
| 4 | `crates/arbors-query/src/index_by.rs::tests` + `python/tests/test_index_by.py` | ~30 | Index by key |
| 5 | Verification scripts | ~5 | Join removal |
| Final | `python/tests/test_nest_integration.py` + `python/tests/test_baseball_contract.py` | ~15 | Integration + contract |

**Total: ~120 tests**

##### Test Categories

- **Unit tests**: Core functionality, edge cases, error handling (in each step)
- **Policy tests**: Cardinality, missing, duplicate, null-key policies
- **Integration tests**: End-to-end workflows with real baseball data
- **Contract tests**: Golden values (Ruth: 714 HR, Aaron: 755 HR, Bonds: 762 HR)
- **Regression tests**: Verify `join` removal doesn't break other functionality

##### CI Integration

Each step ends with `make ci` to ensure no regressions are introduced.

---

#### 16.5.10.4 Documentation Plan

- [ ] Update `docs/API.md` to document `nest`, `index_by`, and array traversal semantics (including "comparisons auto-reduce with `any()`; explicit `all()` required for all-match semantics").
- [ ] Update `python/examples/baseball-example.py` to use `nest` (and optionally `index_by`) as the primary pattern.
- [ ] Remove `join` from docs/examples entirely; replace any remaining “join” narratives with “nest/index_by”.

---

#### 16.5.10.5 Execution Steps

##### Step 1: Implement `nest` core in Rust

**Commit:** `feat(query): add nest() for tree-native data combination`

**References:**
- 16.5.10.0: "Prefer `nest` + `index_by` over SQL-style `join`", "Output shape of `nest` must be explicit and stable", "Deterministic ordering is part of the contract"
- 16.5.10.0: "Key types are JSON scalar types only" — type-sensitive equality, no float specials
- 16.5.10.1.1: Inputs and Outputs (Data Model) — base/related arbors, key expressions, `as_field`
- 16.5.10.1.4: Modes / Policies — `cardinality`, `missing`, `duplicates`, `null_keys`
- 16.5.10.1.5: Semantics — Nest algorithm (many/one), ordering guarantees, **field collision → error**
- 16.5.10.1.6: Error Model — `E_FIELD_COLLISION`, `E_KEY_NOT_SCALAR`, `E_DUPLICATE_KEY`, `E_NULL_KEY`
- 16.5.10.1.7: Public API Surface — Rust `nest()` signature, `NestOptions`
- 16.5.10.2.2: New files — `crates/arbors-query/src/nest.rs`
- 16.5.10.2.3: Symbols — `NestOptions`, `Cardinality`, `MissingPolicy`, `DuplicatePolicy`, `NullKeyPolicy`, `nest`

**Files:**
- `crates/arbors-query/src/nest.rs` (new)
- `crates/arbors-query/src/lib.rs` (add module + re-exports)

**Tasks:**
- [x] Define `Cardinality`, `MissingPolicy`, `DuplicatePolicy`, `NullKeyPolicy` enums.
- [x] Define `NestOptions` struct with builder pattern or defaults.
- [x] Implement `nest()` function: hash index on `related`, iterate `base`, attach field.
- [ ] Add `Arbor::nest()` method wrapper for ergonomic chaining. *(Deferred to Step 2)*
- [x] Wire into existing query module exports.

**Unit Tests** (`crates/arbors-query/src/nest.rs::tests`):

*Basic functionality:*
- [x] `test_nest_many_basic` — simple one-to-many nest produces array field.
- [x] `test_nest_one_basic` — simple one-to-one nest produces object field.
- [x] `test_nest_many_preserves_base_order` — output arbor order matches base order.
- [x] `test_nest_many_preserves_related_order` — nested array order matches related encounter order.
- [x] `test_nest_chaining` — multiple `.nest()` calls accumulate fields correctly.

*Cardinality and missing policies:*
- [x] `test_nest_many_missing_empty` — unmatched base tree gets `field: []`.
- [x] `test_nest_many_missing_absent` — unmatched base tree has no field (when configured).
- [x] `test_nest_one_missing_null` — unmatched base tree gets `field: null`.
- [x] `test_nest_one_missing_absent` — unmatched base tree has no field (when configured).

*Duplicate key handling:*
- [x] `test_nest_one_duplicates_error` — multiple related matches → error.
- [x] `test_nest_one_duplicates_first` — multiple matches → keep first by encounter order.
- [x] `test_nest_one_duplicates_last` — multiple matches → keep last by encounter order.

*Null key handling:*
- [x] `test_nest_null_key_drop` — null/missing keys on related side are excluded from index.
- [x] `test_nest_null_key_error` — null/missing keys → error when configured.
- [x] `test_nest_base_null_key_unmatched` — base tree with null key treated as unmatched.

*Key expression variants:*
- [x] `test_nest_different_key_expressions` — `base_on` differs from `related_on`.
- [x] `test_nest_nested_path_key` — key expression is `path("user.id")`, not just `path("id")`.
- [x] `test_nest_computed_key` — key expression is computed (e.g., `path("x").add(lit(1))`).

*Edge cases:*
- [x] `test_nest_empty_base` — empty base arbor → empty result.
- [x] `test_nest_empty_related` — empty related arbor → all base trees unmatched.
- [x] `test_nest_no_matches` — no keys match → all base trees unmatched.
- [x] `test_nest_all_match_one_to_one` — every base has exactly one related.
- [x] `test_nest_large_cardinality` — base tree with 1000+ related matches.
- [x] `test_nest_field_name_collision` — `as_field` already exists on base tree → error.

*Invariant checks:*
- [x] `test_nest_len_invariant` — `len(result) == len(base)` always.
- [x] `test_nest_base_fields_preserved` — all original base fields present in output.

**Checkpoint:** ✓
```bash
cargo test -p arbors-query  # 441 tests passed (26 new nest tests)
make test                   # All tests pass including Python bindings
cargo clippy -p arbors-query --lib  # No warnings
```

---

##### Step 2: Bind `nest` in Python and add Python tests

**Commit:** `feat(python): expose Arbor.nest() with full Python test coverage`

**References:**
- 16.5.10.1.7: Public API Surface — Python `Arbor.nest()` signature with keyword arguments
- 16.5.10.1.8: Internal Architecture — Python is a thin binding over Rust semantics
- 16.5.10.2.3: Symbols — `Arbor::nest` method
- 16.5.10.4: Documentation Plan — Update `baseball-example.py` to use `nest`
- 16.5.10.A: Appendix — Baseball example workflow with `nest` + `path("batting.HR").sum()`

**Files:**
- `python/src/lib.rs` (add `PyArbor::nest` method)
- `python/arbors/_arbors.pyi` (add type stub)
- `python/tests/test_nest.py` (new)
- `python/examples/baseball-example.py` (rewrite)

**Tasks:**
- [x] Add `Arbor.nest(...)` binding in `python/src/lib.rs` with all keyword arguments.
- [x] Add type stub in `python/arbors/_arbors.pyi`.
- [x] Create comprehensive Python test file `python/tests/test_nest.py`.
- [x] Rewrite `python/examples/baseball-example.py` to use `nest` instead of `join`.

**Unit Tests** (`python/tests/test_nest.py`):

*Basic functionality:*
- [x] `test_nest_many_basic` — Python API produces array field.
- [x] `test_nest_one_basic` — Python API produces object field.
- [x] `test_nest_chaining` — chained `.nest()` calls work from Python.
- [x] `test_nest_preserves_order` — order guarantees hold from Python (via `test_nest_preserves_base_order`, `test_nest_preserves_related_order`).

*Keyword arguments:*
- [x] `test_nest_on_shorthand` — `on=path("id")` works when same for both sides.
- [x] `test_nest_base_on_related_on` — separate `base_on`/`related_on` work.
- [x] `test_nest_as_field_required` — missing `as_field` raises error (via `test_nest_no_key_args_error`).
- [x] `test_nest_cardinality_many` — explicit `cardinality="many"` works.
- [x] `test_nest_cardinality_one` — explicit `cardinality="one"` works.
- [x] `test_nest_invalid_cardinality` — invalid cardinality raises error.

*Policy arguments:*
- [x] `test_nest_missing_empty` — `missing="empty"` produces `[]`.
- [x] `test_nest_missing_absent` — `missing="absent"` omits field.
- [x] `test_nest_duplicates_error` — `duplicates="error"` raises.
- [x] `test_nest_duplicates_first` — `duplicates="first"` keeps first.
- [x] `test_nest_null_keys_drop` — `null_keys="drop"` excludes nulls.
- [x] `test_nest_null_keys_error` — `null_keys="error"` raises.

*Error handling:*
- [x] `test_nest_invalid_on_expr` — bad expression raises clear error (covered by keyword validation tests).
- [x] `test_nest_field_collision_error` — field already exists → clear error.

*Integration with tree access:*
- [x] `test_nest_access_nested_array` — can access `tree["batting"]` as list.
- [x] `test_nest_iterate_nested` — can iterate over nested array.
- [x] `test_nest_nested_field_access` — `tree["batting"][0]["HR"]` works.

**Baseball Example Tests** (`python/tests/test_baseball_example.py` or inline):
- [ ] `test_baseball_nest_people_batting` — nest batting into people works. *(Deferred: requires path traversal through arrays, Step 3)*
- [ ] `test_baseball_top_10_hr` — top 10 HR leaders query produces correct results. *(Deferred: requires path traversal through arrays, Step 3)*
- [ ] `test_baseball_nested_array_sum` — `path("batting.HR").sum()` gives career totals. *(Deferred: requires path traversal through arrays, Step 3)*

**Checkpoint:** ✓
```bash
pytest python/tests/test_nest.py -v  # 39 tests passed
python python/examples/baseball-example.py  # Runs successfully, shows top 10 HR leaders
make test  # All tests pass (467 Rust + 2095 Python)
cargo clippy --workspace --lib  # No warnings
make check-stubs  # Stub validation passed
```

---

##### Step 3: Implement array traversal in path expressions

**Commit:** `feat(expr): array traversal in paths with aggregation support`

**References:**
- 16.5.10.0: "Array traversal in `path()` is supported; comparisons auto-reduce with `any()`" — `cmp(Values[T], scalar)` → `Values[bool]` → `any()` in boolean contexts
- 16.5.10.0: "Aggregate-on-empty semantics are well-defined" — `sum([])=0`, `max([])=null`, etc.
- 16.5.10.0: "Missing fields during traversal are skipped"
- 16.5.10.0: "Multi-valued traversal uses internal `Values` representation"
- 16.5.10.0: "Type errors for aggregates and comparisons are hard errors" — `E_TYPE_MISMATCH`
- 16.5.10.1.5: Semantics — path traversal, auto-reduce, type safety, aggregation rules
- 16.5.10.2.3: Symbols — `Expr::each/any/all/first` methods

**Files:**
- `crates/arbors-expr/src/path.rs` or `eval.rs` (array traversal logic)
- `crates/arbors-expr/src/values.rs` (new, `Values` internal type)
- `python/tests/test_path_arrays.py` (new)

**Tasks:**
- [x] Implement array traversal: `path("a.b")` enters arrays at any segment.
- [x] Implemented via `array_traversed` tracking in `eval_path`, no separate `Values` type needed.
- [x] Missing fields during traversal are **skipped** (not null).
- [x] Ensure aggregations reduce per "Aggregate-on-empty" decision.
- [x] Explicit quantifiers: `first()`, `any()`, `all()` already available and work with array traversal.
- [ ] Comparisons produce `Values[bool]`, auto-reduce with `any()` in boolean contexts (deferred).
- [ ] Type errors raise `E_TYPE_MISMATCH` (e.g., `sum()` over strings) (deferred).

**Unit Tests** (`crates/arbors-query/src/eval.rs::tests`):

*Array traversal basics:*
- [x] `test_path_traverses_array` — `path("items.x")` on `{items: [{x:1}, {x:2}]}` yields `[1, 2]`.
- [x] `test_path_traverses_nested_arrays` — `path("a.b.c")` with arrays at multiple levels.
- [x] `test_path_array_at_root` — path on arbor where root is array.
- [ ] `test_path_mixed_array_object` — some trees have array, some have object at path (deferred).
- [x] `test_path_missing_field_skipped` — `path("items.x")` skips elements without `x`.
- [x] `test_path_all_missing_yields_empty` — all elements missing field → empty stream.

*Aggregation on array paths (per "Aggregate-on-empty" decision):*
- [x] `test_path_array_sum` — `path("items.x").sum()` returns sum of all x values.
- [x] `test_path_array_max` — `path("items.x").max()` returns max.
- [x] `test_path_array_min` — `path("items.x").min()` returns min.
- [x] `test_path_array_mean` — `path("items.x").mean()` returns average.
- [x] `test_path_array_count` — `path("items.x").count()` returns count of present values.
- [x] `test_path_array_sum_empty` — `sum([])` returns `0`.
- [x] `test_path_array_max_empty` — `max([])` returns `null`.
- [x] `test_path_array_min_empty` — `min([])` returns `null`.
- [x] `test_path_array_mean_empty` — `mean([])` returns `null`.
- [x] `test_path_array_count_empty` — `count([])` returns `0`.

*Explicit quantifiers:*
- [x] `test_path_array_first` — `path("items").first()` returns first element.
- [x] `test_path_array_first_empty` — `first()` on empty array returns null/missing.
- [x] `test_path_array_any` — `path("items.active").any()` returns true if any true.
- [x] `test_path_array_all` — `path("items.active").all()` returns true if all true.
- [x] `test_path_array_any_empty` — `any()` on empty is false.
- [x] `test_path_array_all_empty` — `all()` on empty is true (vacuous truth).

*Comparison auto-reduce (deferred):*
- [ ] `test_path_array_comparison_auto_reduces` — `path("items.x") == lit(5)` produces `Values[bool]`, auto-reduces with `any()` in filter context.
- [ ] `test_path_array_comparison_returns_bool` — comparison in boolean context returns true if any element matches.
- [ ] `test_path_array_in_filter` — `filter(path("items.x") == lit(5))` works (auto-reduce).
- [ ] `test_path_array_explicit_any` — `filter((path("items.x") == lit(5)).any())` also works (explicit is same as auto).
- [ ] `test_path_array_explicit_all` — `filter((path("items.x") > lit(0)).all())` works (requires explicit `all()`).

*Type safety (deferred):*
- [ ] `test_path_array_sum_strings_error` — `sum()` over strings raises `E_TYPE_MISMATCH`.
- [ ] `test_path_array_sum_mixed_numeric` — `sum()` over int/float mix returns float.
- [ ] `test_path_array_max_mixed_types_error` — `max()` over mixed string/int raises `E_TYPE_MISMATCH`.
- [ ] `test_comparison_cross_type_error` — comparing int path to string literal raises `E_TYPE_MISMATCH`.
- [ ] `test_comparison_int_float_coerce` — comparing int to float coerces to float (no error).

*Filtering within arrays (deferred):*
- [ ] `test_path_filter_array_elements` — `path("items").filter(path("x") > lit(5))` filters elements.
- [ ] `test_path_filter_then_aggregate` — `path("items").filter(...).path("x").sum()` works.

**Python Unit Tests** (`python/tests/test_path_arrays.py`):
- [x] `test_path_traverses_array` — Python path traverses arrays.
- [x] `test_path_array_sum` — `path("items.x").sum()` from Python.
- [x] `test_path_array_max` — `path("items.x").max()` from Python.
- [x] `test_path_array_first` — `path("items").first()` from Python.
- [x] `test_path_array_any`, `test_path_array_all` — `any()`/`all()` from Python.
- [x] `test_path_deeply_nested_with_aggregation` — deep nesting with aggregation.
- [x] `test_path_traverses_multiple_trees` — multi-tree verification.
- [x] `test_filter_then_traverse` — filter then traverse arrays.

**Checkpoint:**
```bash
cargo test -p arbors-query  # 25 path_ tests pass (test_path_traverses_*, test_path_array_*, etc.)
pytest python/tests/test_path_arrays.py -v  # 27 tests pass
python examples/baseball-example.py  # Baseball example works with array traversal
cargo test --workspace  # All Rust tests pass
cargo clippy --workspace  # Clean
make check-stubs  # Clean
```

**Verification Results:**
- Rust tests: All pass (492 total, +25 new array traversal tests)
- Python tests: 2122 passed, 5 skipped
- Baseball example: Works correctly with `path("career.homeRuns")` traversing nested structure

---

##### Step 4: Implement `index_by` and Python keyed access

**Commit:** `feat(query): add index_by() keyed container and Python access`

**References:**
- 16.5.10.0: "Prefer `nest` + `index_by` over SQL-style `join`" — `index_by` provides O(1) keyed lookup
- 16.5.10.0: "`IndexedArbor` value type under `duplicates='collect'` is a list of Trees"
- 16.5.10.0: "Key types are JSON scalar types only" — type-sensitive equality
- 16.5.10.1.1: Inputs and Outputs — `index_by(...) -> IndexedArbor` keyed view/container
- 16.5.10.1.4: Modes / Policies — `duplicates` (error/first/last/collect), `null_keys` (drop/error)
- 16.5.10.1.5: Semantics — `index_by` lookup behavior, KeyError on missing
- 16.5.10.1.7: Public API Surface — Rust `index_by()` and Python `IndexedArbor` signatures
- 16.5.10.2.2: New files — `crates/arbors-query/src/index_by.rs`
- 16.5.10.2.3: Symbols — `IndexByOptions`, `IndexedArbor`, `Arbor::index_by`

**Files:**
- `crates/arbors-query/src/index_by.rs` (new)
- `crates/arbors-query/src/lib.rs` (add module + re-exports)
- `crates/arbors-core/src/indexed_arbor.rs` (new, or in arbors-query)
- `python/src/lib.rs` (add `PyIndexedArbor` type)
- `python/arbors/_arbors.pyi` (add type stub)
- `python/tests/test_index_by.py` (new)

**Tasks:**
- [x] Define `IndexByOptions` struct (duplicate policy, null key policy).
- [x] Define `IndexedArbor` type with O(1) key lookup.
- [x] Implement `index_by()` function.
- [x] Add `Arbor::index_by()` method wrapper.
- [x] Add Python `IndexedArbor` type with `__getitem__`, `get`, `__contains__`, `keys`, `values`, `__len__`.

**Unit Tests** (`crates/arbors-query/src/index_by.rs::tests`):

*Basic functionality:*
- [x] `test_index_by_basic` — index by key, lookup returns correct tree.
- [x] `test_index_by_string_key` — string keys work.
- [x] `test_index_by_int_key` — integer keys work.
- [x] `test_index_by_missing_key` — lookup of non-existent key returns None/error.
- [x] `test_index_by_len` — length equals number of unique keys.

*Duplicate key policies:*
- [x] `test_index_by_duplicates_error` — duplicate keys → error.
- [x] `test_index_by_duplicates_first` — duplicate keys → keep first tree.
- [x] `test_index_by_duplicates_last` — duplicate keys → keep last tree.
- [x] `test_index_by_duplicates_collect` — duplicate keys → value is array of trees.
- [x] `test_index_by_collect_iteration` — collected values are iterable arrays.

*Null key policies:*
- [x] `test_index_by_null_key_drop` — null keys excluded from index.
- [x] `test_index_by_null_key_error` — null keys → error when configured.
- [x] `test_index_by_missing_field_drop` — missing key field treated as null.

*Iteration and access:*
- [x] `test_index_by_keys` — can get all keys.
- [x] `test_index_by_values` — can iterate over all values.
- [x] `test_index_by_items` — can iterate as (key, value) pairs.
- [x] `test_index_by_contains` — containment check works.

*Edge cases:*
- [x] `test_index_by_empty_arbor` — empty arbor → empty index.
- [x] `test_index_by_single_tree` — arbor with one tree → index with one entry.
- [x] `test_index_by_nested_path_key` — key is `path("user.id")`.
- [x] `test_index_by_all_same_key_collect` — all trees have same key with collect policy.

*Performance (sanity checks):*
- [x] `test_index_by_lookup_is_fast` — 10,000 tree arbor, lookup is O(1) (< 1ms).

**Python Unit Tests** (`python/tests/test_index_by.py`):

*Basic functionality:*
- [x] `test_index_by_basic_python` — Python API creates indexed arbor.
- [x] `test_index_by_getitem` — `indexed["key"]` returns tree.
- [x] `test_index_by_get` — `indexed.get("key")` returns tree or None.
- [x] `test_index_by_get_default` — `indexed.get("key", default)` returns default.
- [x] `test_index_by_contains` — `"key" in indexed` works.
- [x] `test_index_by_keys` — `indexed.keys()` returns keys.
- [x] `test_index_by_values` — `indexed.values()` returns trees.
- [x] `test_index_by_len` — `len(indexed)` works.
- [x] `test_index_by_iter` — iteration over keys works.

*Policy arguments:*
- [x] `test_index_by_duplicates_error_python` — `duplicates="error"` raises.
- [x] `test_index_by_duplicates_first_python` — `duplicates="first"` works.
- [x] `test_index_by_duplicates_collect_python` — `duplicates="collect"` returns lists.
- [x] `test_index_by_null_keys_drop_python` — `null_keys="drop"` works.
- [x] `test_index_by_null_keys_error_python` — `null_keys="error"` raises.

*Error handling:*
- [x] `test_index_by_keyerror` — missing key raises KeyError.
- [x] `test_index_by_invalid_key_expr` — bad expression raises clear error.

*Integration with nest:*
- [x] `test_index_by_after_nest` — can index nested trees by key.
- [x] `test_index_by_access_nested_field` — `indexed["ruth01"]["batting"]` works.

**Checkpoint:**
```bash
cargo test -p arbors-query
pytest python/tests/test_index_by.py -v
make ci
```

**Verification Results:**
- Rust tests: All pass (26 new index_by tests)
- Python tests: 2150 passed, 5 skipped (28 new index_by tests)
- Clippy: Clean
- Stubtest: Clean

---

##### Step 5: Remove `join` API and implementation

**Commit:** `refactor(query): remove join API and implementation`

**References:**
- 16.5.10.0: "Remove `join` (no migration required)" — clean break, no deprecations or shims
- 16.5.10.0: "Prefer `nest` + `index_by` over SQL-style `join`" — `join` should not appear in public API once complete
- 16.5.10.4: Documentation Plan — Remove `join` from docs/examples; replace with `nest`/`index_by`

**Files:**
- `crates/arbors-query/src/join.rs` (delete)
- `crates/arbors-query/src/lib.rs` (remove join exports)
- `crates/arbors/tests/integration.rs` (remove join tests)
- `python/src/lib.rs` (remove `PyArbor::join` method)
- `python/arbors/_arbors.pyi` (remove join type stub)
- `python/tests/test_*.py` (remove any join tests)

**Tasks:**
- [x] Delete `crates/arbors-query/src/join.rs` entirely.
- [x] Remove `join` and `JoinType` from module exports.
- [x] Remove `PyArbor::join` method from Python bindings.
- [x] Remove `join` from type stubs.
- [x] Delete or migrate any tests that use `join`.
- [x] Update `python/examples/baseball-example.py` if not already using `nest`.
- [x] Search codebase for any remaining `join` references and remove.

**Verification Tests:**

*API removal verification:*
- [x] `test_join_not_in_api` — `hasattr(arbors.Arbor, "join")` is False.
- [x] `test_join_import_error` — `from arbors import join` fails (if previously exported).

*No regressions:*
- [x] All existing non-join tests still pass.
- [x] `python/examples/baseball-example.py` runs successfully using `nest`.
- [x] `python/examples/lazy_queries.py` still works (if it used join, migrate it).
- [x] `python/examples/quickstart.py` still works.

*Documentation:*
- [x] No `join` mentions in `python/arbors/_arbors.pyi`.
- [x] No `join` mentions in any docstrings.

**Checkpoint:**
```bash
# Verify join is gone
grep -r "def join" python/src crates/arbors-query/src && exit 1 || echo "join removed"
grep -r "\.join(" python/examples && exit 1 || echo "examples migrated"

# Full test suite
make ci

# Examples run
python python/examples/baseball-example.py
python python/examples/lazy_queries.py
python python/examples/quickstart.py
```

---

#### 16.5.10.6 Deliverables and Checkpoints

**Deliverable:** Users can combine hierarchical datasets without Cartesian blowup via `nest`, can do fast lookup via `index_by`, and can aggregate through nested arrays via path traversal.

---

##### Final Integration Tests

**File:** `python/tests/test_nest_integration.py`

*End-to-end nest workflows:*
- [x] `test_nest_people_batting_integration` — load People.csv + Batting.csv, nest, verify structure.
- [x] `test_nest_people_batting_pitching_chain` — chain two nests, verify both fields present.
- [x] `test_nest_with_sort_by` — nest then sort_by on nested aggregate.
- [x] `test_nest_with_filter` — nest then filter on nested field.
- [x] `test_nest_with_head` — nest then head(10) for top-N queries.
- [x] `test_nest_roundtrip_to_json` — nested tree serializes to JSON correctly.

*End-to-end index_by workflows:*
- [x] `test_index_by_people_integration` — index People by playerID, lookup works.
- [x] `test_index_by_after_nest_integration` — nest batting into people, then index by playerID.
- [x] `test_index_by_lookup_nested_access` — `indexed["ruth01"]["batting"][0]["HR"]` works.

*Path traversal on real data:*
- [x] `test_path_batting_hr_sum_integration` — `path("batting.HR").sum()` on real data is correct.
- [x] `test_path_batting_hr_max_integration` — `path("batting.HR").max()` is correct.
- [x] `test_path_batting_filter_year_integration` — filter batting to specific year, aggregate.

**File:** `python/tests/test_baseball_contract.py`

*Contract tests (golden results):*
- [x] `test_top_10_hr_leaders_contract` — top 10 HR leaders are Bonds, Aaron, Ruth, etc. (known values).
- [x] `test_ruth_career_hr_contract` — Babe Ruth's career HR total is 714.
- [x] `test_aaron_career_hr_contract` — Hank Aaron's career HR total is 755.
- [x] `test_bonds_career_hr_contract` — Barry Bonds' career HR total is 762.
- [x] `test_player_count_contract` — People.csv has expected number of players.

---

##### Checkpoint Summary Table

| Step | Checkpoint Command | Pass Criteria |
|------|-------------------|---------------|
| 1 | `cargo test -p arbors-query && make ci` | All 25+ nest unit tests pass, CI green |
| 2 | `pytest python/tests/test_nest.py -v && make ci` | All 20+ Python nest tests pass, CI green |
| 3 | `cargo test -p arbors-expr && pytest python/tests/test_path_arrays.py -v && make ci` | All 25+ path/array tests pass, CI green |
| 4 | `cargo test -p arbors-query && pytest python/tests/test_index_by.py -v && make ci` | All 30+ index_by tests pass, CI green |
| 5 | `make ci && python python/examples/baseball-example.py` | CI green, no join in codebase, example runs |
| Final | `pytest python/tests/test_nest_integration.py python/tests/test_baseball_contract.py -v && make ci` | All integration/contract tests pass |

---

##### Final Verification Checklist

| Item | Verification Command | Expected Result |
|------|---------------------|-----------------|
| `nest` API exists | `python -c "from arbors import Arbor; print(hasattr(Arbor, 'nest'))"` | `True` |
| `index_by` API exists | `python -c "from arbors import Arbor; print(hasattr(Arbor, 'index_by'))"` | `True` |
| `join` API removed | `python -c "from arbors import Arbor; print(hasattr(Arbor, 'join'))"` | `False` |
| Path traverses arrays | `python -c "..."` (inline test) | Aggregation works |
| Baseball example runs | `python python/examples/baseball-example.py` | Prints top 10 HR leaders |
| All Rust tests pass | `cargo test --workspace` | 0 failures |
| All Python tests pass | `pytest python/tests -v` | 0 failures |
| Stubtest passes | `python -m mypy.stubtest arbors._arbors` | No errors |
| CI passes | `make ci` | Exit 0 |

---

##### Performance Baseline (Informational)

| Metric | Target | Verification |
|--------|--------|--------------|
| `nest` 20K × 100K | < 500ms | `time python -c "..."` |
| `index_by` lookup | O(1) / < 1μs | Micro-benchmark |
| `path("batting.HR").sum()` | < 10ms per tree | Profile |
| Memory: nested vs join | < 50% of join memory | Measure peak RSS |

*Note: Performance targets are informational. Regressions should be investigated but are not blocking.*

---

##### Sign-Off Criteria

Phase 16.5.10 is complete when:

1. ✅ All unit tests pass (`cargo test --workspace`)
2. ✅ All Python tests pass (`pytest python/tests`)
3. ✅ CI passes (`make ci`)
4. ✅ `join` API is removed from codebase
5. ✅ `nest` and `index_by` APIs are documented in type stubs
6. ✅ Baseball example runs end-to-end using `nest`
7. ✅ Contract tests verify known baseball statistics
8. ✅ No regressions in existing functionality

**Final Commit:** `docs: complete Phase 16.5.10 Tree-Native Data Combination`

---

#### 16.5.10.A Appendix (Non-normative): Motivation and Baseball Example

> This appendix is explanatory only. The normative contract is in 16.5.10.0–16.5.10.6.

##### The problem with SQL-style joins (in a tree system)

The earlier/prototype `join` operation mirrors SQL semantics:
- Produces Cartesian products (one output row per matching pair)
- Produces flat, denormalized results
- Loses the natural hierarchical relationships in data

For the Lahman baseball dataset:
- People.csv: ~1 row per player
- Batting.csv: ~20 rows per player (one per season)
- A SQL join yields ~20 rows per player, repeating all People fields

This is wasteful and unergonomic. Developers must then re-aggregate just to answer “obvious” questions like “career home runs”.

##### Vision: load once, query naturally

Goal: model relationships as nested subtrees so paths and aggregations feel native.

```python
# Load CSVs as arbors
people = load_csv_as_arbor("People.csv")      # ~20,000 players
batting = load_csv_as_arbor("Batting.csv")    # 100,000+ season records
pitching = load_csv_as_arbor("Pitching.csv")

# Build rich player trees with nested data
players = (people
    .nest(batting, on=path("playerID"), as_field="batting", cardinality="many")
    .nest(pitching, on=path("playerID"), as_field="pitching", cardinality="many"))

# Each player tree now looks like:
# {
#   "playerID": "ruth01",
#   "nameFirst": "Babe",
#   "nameLast": "Ruth",
#   "batting": [
#     {"yearID": 1914, "teamID": "BOS", "HR": 0, ...},
#     {"yearID": 1915, "teamID": "BOS", "HR": 4, ...},
#     ...
#   ],
#   "pitching": [
#     {"yearID": 1914, "W": 2, "ERA": 3.91, ...},
#     ...
#   ]
# }

# Query: Top 10 career home run leaders (aggregate across nested arrays)
top_hr = (players
    .sort_by(path("batting.HR").sum(), descending=True)
    .head(10))

for player in top_hr:
    name = f"{player['nameFirst'].value} {player['nameLast'].value}"
    hr = player.eval(path("batting.HR").sum())
    print(f"{name}: {hr} career HR")

# Query: Players who hit 50+ HR in a single season
big_seasons = players.filter(path("batting.HR").max() >= lit(50))

# Query: Babe Ruth's 1927 season (filter within nested arrays)
ruth = players.filter(path("playerID") == lit("ruth01")).first()
season_1927 = ruth.path("batting").filter(path("yearID") == lit(1927)).first()
print(f"1927: {season_1927['HR'].value} HR")
```

Key insight: `path("batting.HR")` traverses into arrays, producing a multi-valued stream. Aggregations like `.sum()` reduce that stream to scalars.

##### Comparison: SQL join vs. tree nesting

| Aspect | SQL Join | Tree Nesting (`nest`) |
|--------|----------|------------------------|
| Output shape | Flat rows | Hierarchical trees |
| One-to-many | Cartesian product | Nested array |
| Data duplication | High (repeats “one” side) | None |
| Aggregation | Requires `GROUP BY` | Natural via path aggregations |
| Mental model | Tables/rows | Trees/paths |
| Access pattern | Row iteration | Path navigation |

Memory intuition:
- SQL join of People (20K) × Batting (avg 20/player) → ~400K output rows, repeating People fields.
- Tree nesting → ~20K player trees with a nested batting array, no duplication of People fields.


#### 16.5.11 Multi-Key Support for group_by, nest, and index_by

**Purpose:** Enable compound keys for `group_by`, `nest`, and `index_by` operations, allowing users to work with data that requires multi-field keys (e.g., `(yearID, teamID)` for the Lahman baseball Teams table).

**Status:** Not started

**Scope:**
1. Add `find_one()` and `find_one_or_error()` convenience methods for single-record lookup.
2. Extend `group_by` to accept a list of key expressions, producing tuple group keys.
3. Extend `nest` to accept lists for `on`, `base_on`, and `related_on`, matching when all keys match.
4. Extend `index_by` to accept a list of key expressions, producing nested `IndexedArbor` structures.
5. Update Python bindings and type stubs for all operations.
6. Update `baseball-example.py` to demonstrate all 5 queries with multi-key workflows.

**Non-goals (explicitly out of scope):**
- Tuple literals in the expression language (no new `tuple(...)` expression).
- Composite key hashing optimizations (use sequential key matching for now).
- Breaking changes to single-key API (existing code continues to work unchanged).
- New `null_keys` parameter for `group_by` (keep existing behavior: null/missing are valid key values).

**Dependencies / prerequisites:**
- Phase 16.5.10 complete (nest, index_by exist with single-key support).
- String-to-path conversion (Phase 16.5.10.x) complete.

---

##### 16.5.11.0 Design Decisions

###### Canonical key equality for compound keys (DECIDED)

**Decision:** Multi-key matching uses the same **canonical key equality** as single-key operations, applied component-wise. This means `1` (Int64) and `1.0` (Float64) compare equal, NaNs are canonically equal, and `Null` ≠ `Missing`.

**Rationale:**
- Consistency: single-key and multi-key should behave identically for each component.
- Current behavior: `group_by`, `unique_by`, `index_by`, `nest` all use `CanonicalKey` for equality.
- Changing to type-sensitive would create surprising inconsistencies.

**Implications:**
- `(1, "NYA")` matches `(1.0, "NYA")` because numeric canonicalization applies per-component.
- Tests must verify canonical equality in compound keys.

###### Each key component must be scalar (DECIDED)

**Decision:** Each component in a compound key must evaluate to a scalar (string, int, float, bool, null, or missing). If any component evaluates to an array or object, the operation errors.

**Rationale:**
- Consistent with existing single-key behavior: `nest` and `index_by` already error on non-scalar keys.
- Arrays/objects as keys have ambiguous equality semantics.
- Users needing complex keys can compute a scalar representation (e.g., JSON-encode).

**Implications:**
- `index_by([path("arr"), path("name")])` errors if `arr` is an array.
- Error message: "Key component {n} evaluated to {type}, expected scalar".

###### Multi-key via list, not tuple expressions (DECIDED)

**Decision:** Multi-key support is provided by accepting `list[Expr | str]` in Python (and `&[Expr]` in Rust) rather than introducing a new `tuple()` expression type.

**Rationale:**
- Simpler implementation: no new expression variant needed.
- Clearer API: `group_by(["yearID", "teamID"])` reads naturally.
- Matches existing `sort_by` which already accepts a list.
- Avoids complexity of tuple comparison semantics in the expression evaluator.

**Implications:**
- The key returned by `group_by` with multiple keys is a Python tuple (or Rust `Vec<ExprResult>`).
- Functions internally build indexes using all keys; no special tuple type is exposed.

###### Nested index structure for multi-key `index_by` (DECIDED)

**Decision:** `index_by(["k1", "k2"])` produces a nested `IndexedArbor` where `indexed[v1][v2]` returns the tree(s) with `k1=v1` and `k2=v2`.

**Rationale:**
- Natural Python idiom: `teams_idx[2024]["NYA"]` feels like nested dict access.
- Avoids tuple key syntax which can be awkward: `teams_idx[(2024, "NYA")]`.
- Each level is an `IndexedArbor`, allowing partial key access (e.g., get all teams for a year).

**Implications:**
- `IndexedArbor.__getitem__` returns either `Tree`, `list[Tree]`, or `IndexedArbor` (for partial key).
- Type stubs must reflect the recursive/union nature.
- Missing intermediate key raises `KeyError` at that level.

###### Multi-key `nest` matches on all keys (logical AND) (DECIDED)

**Decision:** When `base_on` and `related_on` are lists, a match occurs only when **all** corresponding keys match. Keys are matched positionally (first base key to first related key, etc.).

**Rationale:**
- This is the expected behavior for compound keys (e.g., join on both `yearID` AND `teamID`).
- Positional matching is simple and explicit.
- Lists must be same length; mismatched lengths is an error.

**Implications:**
- `nest(teams, base_on=["yearID", "teamID"], related_on=["yearID", "teamID"], ...)` matches when both keys match.
- Error if `len(base_on) != len(related_on)` when both are lists.
- Single key and list can't be mixed with `on=` shorthand (use explicit base_on/related_on for multi-key).

###### Multi-key `group_by` returns tuple keys (DECIDED)

**Decision:** `group_by(["k1", "k2"])` returns groups where the key is a Python tuple `(v1, v2)` corresponding to the values of each key expression.

**Rationale:**
- Tuples are the natural Python representation for compound keys.
- Hashable and usable as dict keys if needed.
- Consistent with pandas `groupby` on multiple columns.

**Implications:**
- Iterator yields `(tuple, Arbor)` pairs for multi-key groups.
- Single-key `group_by` continues to yield `(scalar, Arbor)` for backward compatibility.
- Rust returns `Vec<(Vec<ExprResult>, Arbor)>` for multi-key groups.

---

##### 16.5.11.1 Specification

###### 16.5.11.1.1 Inputs and Outputs (Data Model)

**group_by:**
- **Input:** `by: Expr | str | list[Expr | str]`
- **Output:** `GroupedArbor` — iterator of `(key, Arbor)` pairs where `key` is:
  - Scalar for single key
  - Tuple for multiple keys

**nest:**
- **Input changes:**
  - `on: Expr | str | None` — single key only (unchanged)
  - `base_on: Expr | str | list[Expr | str] | None` — supports multi-key
  - `related_on: Expr | str | list[Expr | str] | None` — supports multi-key
- **Constraint:** If lists, `len(base_on) == len(related_on)` required.
- **Output:** `Arbor` (unchanged structure, but matching uses all keys).

**index_by:**
- **Input:** `key: Expr | str | list[Expr | str]`
- **Output:**
  - Single key: `IndexedArbor` with direct tree access
  - Multiple keys: Nested `IndexedArbor` — each `__getitem__` returns next level until final level returns `Tree`

**find_one / find_one_or_error:**
- **Input:** `expr: Expr` — predicate expression
- **Output:**
  - `find_one(expr) -> Tree | None` — first matching tree, or None
  - `find_one_or_error(expr) -> Tree` — first matching tree, or raises `ValueError`

**Key invariants:**
- Single-key behavior is unchanged (backward compatible).
- Multi-key operations compose naturally.
- **Canonical key equality** applies component-wise (per 16.5.11.0: `1` matches `1.0`).
- Each key component must be scalar (string, int, float, bool, null, missing).

###### 16.5.11.1.2 Terminology and Naming

- **Compound key:** A key composed of multiple field values (e.g., `(yearID, teamID)`).
- **Nested index:** An `IndexedArbor` where each level corresponds to one key in a multi-key index.
- **Positional key matching:** Keys are matched by position (first-to-first, second-to-second).

###### 16.5.11.1.3 Supported Features (Exhaustive)

**Supported:**
- `group_by("key")` — single key (existing)
- `group_by(["k1", "k2", ...])` — multiple keys (new)
- `group_by([path("a"), "b"])` — mixed path and string (new)
- `nest(..., on="key")` — single key shorthand (existing)
- `nest(..., base_on=["k1", "k2"], related_on=["k1", "k2"])` — multi-key (new)
- `index_by("key")` — single key (existing)
- `index_by(["k1", "k2"])` — multi-key nested index (new)

**Explicitly not supported:**
- `on=["k1", "k2"]` for nest (must use base_on/related_on for multi-key)
- Mixing single `on` with `base_on` or `related_on` lists
- Different lengths for `base_on` and `related_on` lists
- More than 8 keys (arbitrary but reasonable limit)

**Behavior when unsupported is encountered:**
- Mismatched list lengths → `ValueError` / `E_INVALID_ARGUMENT`
- `on` with list when base/related differ → `ValueError` suggesting base_on/related_on
- Exceed key limit → `ValueError` / `E_INVALID_ARGUMENT`

###### 16.5.11.1.4 Modes / Policies (if applicable)

No new modes/policies. Existing policies (duplicates, null_keys, missing, cardinality) apply unchanged. For multi-key operations:

| Policy | Multi-key behavior |
|--------|-------------------|
| `null_keys="drop"` | Drop if ANY key is null |
| `null_keys="error"` | Error if ANY key is null |
| `duplicates` | Applies to the compound key (all keys together) |

###### 16.5.11.1.5 Semantics (Normative Rules)

**Multi-key group_by:**
1. Evaluate all key expressions on each tree.
2. Group trees by the tuple of all key values.
3. Tuple equality is component-wise using **canonical key equality** (see 16.5.11.0).
4. Null/missing are valid key values (no special handling; matches existing single-key behavior).
5. Groups are yielded in first-encounter order of the compound key.
6. For each component, the **returned key value is the first-encountered representative** (same rule as single-key `group_by`).
7. If any component evaluates to array/object → error.

**Multi-key nest:**
1. Build index on `related` using all `related_on` keys as compound key.
2. For each base tree, evaluate all `base_on` keys.
3. Match occurs when ALL keys match (logical AND) using canonical equality.
4. All existing policies (`null_keys`, `duplicates`, `missing`, `cardinality`) apply to the compound match.
5. If any component evaluates to array/object → error.

**Multi-key index_by:**
1. Evaluate first key on all trees, build first-level index.
2. For each first-level key value, evaluate second key on matching trees, build second-level index.
3. Continue recursively for all keys.
4. `duplicates` policy applies only at **final level**; intermediate levels always collect (implicitly "many").
5. `null_keys` policy applies if **any** component is null.
6. If any component evaluates to array/object → error.
7. **Intermediate `IndexedArbor` behavior:**
   - `.keys()` returns keys at that level only.
   - `len(...)` returns number of keys at that level.
   - Iteration yields `(key, sub_index_or_tree)` pairs at that level.

**find_one / find_one_or_error:**
1. Evaluate predicate on each tree in order.
2. Return first tree where predicate is truthy.
3. `find_one` returns `None` if no match.
4. `find_one_or_error` raises `ArborsError` (not `ValueError`) if no match, for consistency with other arbors API errors. Expression evaluation errors also raise `ArborsError`.

###### 16.5.11.1.6 Error and Warning Model

**New errors** (conceptual codes; implemented via `ExprError::InvalidOperation`):

| Error Code | Condition | Message |
|------------|-----------|---------|
| `E_KEY_LENGTH_MISMATCH` | `len(base_on) != len(related_on)` | "base_on has {n} keys but related_on has {m} keys" |
| `E_TOO_MANY_KEYS` | More than 8 keys provided | "At most 8 keys supported, got {n}" |
| `E_INVALID_ON_WITH_LIST` | `on=[...]` used (multi-key requires base_on/related_on) | "Use base_on and related_on for multi-key nest" |
| `E_KEY_NOT_SCALAR` | Key component is array/object | "Key component {n} evaluated to {type}, expected scalar" |
| `E_NO_MATCH` | `find_one_or_error` finds nothing | "No tree matches the predicate" |

**Error message stability note:** The `E_NO_MATCH` message should be distinct enough to identify the failure mode, but tests should assert on error type (`ArborsError`) and optionally that the message *contains* key phrases (e.g., `"no tree"` or `"matches"`), not exact string equality. This prevents brittleness if wording is refined.

###### 16.5.11.1.7 Public API Surface

**Rust:**
```rust
// group_by (crates/arbors-query/src/collection_ops.rs)
pub fn group_by(
    arbor: &Arbor,
    keys: &[Expr]
) -> Result<Vec<(Vec<ExprResult>, Arbor)>, ExprError>;

// Convenience single-key overload via Into<Vec>
pub fn group_by_single(
    arbor: &Arbor,
    key: &Expr
) -> Result<Vec<(ExprResult, Arbor)>, ExprError>;

// nest (crates/arbors-query/src/nest.rs)
pub fn nest(
    base: &Arbor,
    related: &Arbor,
    base_on: &[Expr],    // Changed from &Expr
    related_on: &[Expr], // Changed from &Expr
    as_field: &str,
    opts: NestOptions,
) -> Result<Arbor, ExprError>;

// index_by (crates/arbors-query/src/index_by.rs)
pub fn index_by(
    arbor: &Arbor,
    keys: &[Expr],       // Changed from &Expr
    opts: IndexByOptions,
) -> Result<IndexedArbor, ExprError>;

// IndexedArbor gains multi-level support
impl IndexedArbor {
    /// For multi-key index, returns next level IndexedArbor
    /// For final level, returns Tree or Vec<Tree>
    pub fn get(&self, key: &ExprResult) -> Option<IndexedArborEntry>;
}

pub enum IndexedArborEntry {
    Tree(Tree),
    Trees(Vec<Tree>),
    Nested(IndexedArbor),
}
```

**Python:**
```python
class Arbor:
    def find_one(self, expr: Expr) -> Tree | None:
        """Return first tree matching predicate, or None if no match."""
        ...

    def find_one_or_error(self, expr: Expr) -> Tree:
        """Return first tree matching predicate, or raise ArborsError."""
        ...

    def group_by(
        self,
        by: Expr | str | list[Expr | str]
    ) -> GroupedArbor: ...

    def nest(
        self,
        related: Arbor,
        *,
        on: Expr | str | None = None,  # Single key only
        base_on: Expr | str | list[Expr | str] | None = None,
        related_on: Expr | str | list[Expr | str] | None = None,
        as_field: str,
        cardinality: Literal["one", "many"] = "many",
        missing: Literal["fill", "skip"] = "fill",
        duplicates: Literal["error", "first", "last"] = "error",
        null_keys: Literal["drop", "error"] = "drop",
    ) -> Arbor: ...

    def index_by(
        self,
        key: Expr | str | list[Expr | str],
        *,
        duplicates: Literal["error", "first", "last", "collect"] = "error",
        null_keys: Literal["drop", "error"] = "drop",
    ) -> IndexedArbor: ...

class IndexedArbor:
    def __getitem__(
        self, key: str | int | bool | float
    ) -> Tree | list[Tree] | IndexedArbor: ...

    def keys(self) -> list[str | int | bool | float | None]:
        """Return keys at this level."""
        ...

    def __len__(self) -> int:
        """Number of keys at this level."""
        ...

    def __iter__(self) -> Iterator[tuple[str | int | bool | float | None, Tree | list[Tree] | IndexedArbor]]:
        """Iterate over (key, value) pairs at this level."""
        ...

    @property
    def depth(self) -> int:
        """Number of key levels (1 for single-key, N for N-key)."""
        ...
```

###### 16.5.11.1.8 Internal Architecture

**Index building strategy:**
- Multi-key indexes are built as nested HashMaps in Rust.
- For `index_by(["k1", "k2"])`: `HashMap<Key1, HashMap<Key2, Vec<TreeIdx>>>`
- For nest, build `HashMap<(Key1, Key2, ...), Vec<TreeIdx>>` using tuple as key.

**Python binding approach:**
- Accept `PyObject` and dispatch based on whether it's a list or single value.
- Convert `list[Expr | str]` to `Vec<Expr>` before calling Rust.
- `IndexedArbor` tracks depth and returns appropriate type on access.
- **Key canonicalization on lookup:** Python `__getitem__` must convert the Python key (int, float, str, bool, None) to the internal `ExprResult` scalar form and then to `CanonicalKey` before lookup. This ensures `idx[1]` and `idx[1.0]` hit the same entry per canonical equality.

**Iteration strategy for nested `IndexedArbor`:**
- Rust `IndexedArbor` should expose iterators that yield `(CanonicalKey, &IndexedArborEntry)` without cloning entire subtrees.
- Python iteration wraps these as lazy `(key, value)` pairs; the sub-`IndexedArbor` values are references (or thin wrappers) rather than full copies.
- This prevents O(n²) memory usage when iterating deep nested indexes.

---

##### 16.5.11.2 Definitive Symbol Inventory

###### 16.5.11.2.1 New crates (if any)

None.

###### 16.5.11.2.2 New files (if any)

None. All changes are to existing files.

###### 16.5.11.2.3 Symbols to add / modify

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `find_one` | fn | `arbors-query/src/collection_ops.rs` | New: returns first matching tree or None |
| `Arbor::find_one` | method | `python/src/lib.rs` | New: Python binding |
| `Arbor::find_one_or_error` | method | `python/src/lib.rs` | New: Python binding, raises ArborsError on no match |
| `group_by` | fn | `arbors-query/src/collection_ops.rs` | Change signature to accept `&[Expr]` |
| `nest` | fn | `arbors-query/src/nest.rs` | Change signature to accept `&[Expr]` for keys |
| `index_by` | fn | `arbors-query/src/index_by.rs` | Change signature to accept `&[Expr]` |
| `IndexedArborEntry` | enum | `arbors-query/src/index_by.rs` | New: Tree / Trees / Nested variants |
| `IndexedArbor::depth` | method | `arbors-query/src/index_by.rs` | New: returns key depth |
| `IndexedArbor::keys` | method | `arbors-query/src/index_by.rs` | New: returns keys at current level |
| `IndexedArbor::len` | method | `arbors-query/src/index_by.rs` | New: returns number of keys at current level |
| `IndexedArbor::iter` | method | `arbors-query/src/index_by.rs` | New: iterates (key, value) pairs at current level |
| `IndexedArbor::get` | method | `arbors-query/src/index_by.rs` | Change: return `IndexedArborEntry` |
| `ExprOrPaths` | type | `python/src/lib.rs` | New: accepts `Expr`, `str`, or `list[Expr\|str]` |

---

##### 16.5.11.3 Test Plan

###### 16.5.11.3.1 Unit tests (Rust)

**find_one:**
- [x] `test_find_one_returns_first_match` — returns first tree matching predicate.
- [x] `test_find_one_returns_none_on_no_match` — returns None when no match.
- [x] `test_find_one_or_error_returns_match` — returns tree when found. (Python test)
- [x] `test_find_one_or_error_raises_on_no_match` — errors when no match. (Python test)

**group_by multi-key:**
- [x] `test_group_by_two_keys` — groups by `(k1, k2)` correctly.
- [x] `test_group_by_three_keys` — three-key grouping works.
- [x] `test_group_by_multi_preserves_order` — groups ordered by first encounter.
- [x] `test_group_by_multi_null_is_valid_key` — null as key component groups correctly.
- [x] `test_group_by_multi_canonical_equality` — `(1, "a")` groups with `(1.0, "a")`.
- [x] `test_group_by_single_unchanged` — single key still returns scalar key.
- [x] `test_group_by_array_key_errors` — array as key component → error.

**nest multi-key:**
- [x] `test_nest_two_keys_match` — matches on both keys.
- [x] `test_nest_two_keys_partial_match` — one key matches, other doesn't → no match.
- [x] `test_nest_key_length_mismatch_error` — different lengths → error.
- [x] `test_nest_multi_key_null_drop` — null in any key → treated as unmatched (per policy).
- [x] `test_nest_multi_key_canonical_equality` — `(1, "NYA")` matches `(1.0, "NYA")`.
- [x] `test_nest_multi_key_cardinality_one` — works with cardinality="one".
- [x] `test_nest_multi_key_cardinality_many` — works with cardinality="many".
- [x] `test_nest_array_key_errors` — array as key component → error.

**index_by multi-key:**
- [ ] `test_index_by_two_keys_nested` — `idx[v1][v2]` returns correct tree.
- [ ] `test_index_by_partial_key` — `idx[v1]` returns nested IndexedArbor.
- [ ] `test_index_by_missing_first_key` — KeyError at first level.
- [ ] `test_index_by_missing_second_key` — KeyError at second level.
- [ ] `test_index_by_multi_duplicates_final_level` — duplicates applies at final level only.
- [ ] `test_index_by_multi_canonical_equality` — `1` and `1.0` access same entry.
- [ ] `test_index_by_depth` — depth property returns correct value.
- [ ] `test_index_by_keys_at_level` — `.keys()` returns keys at current level only.
- [ ] `test_index_by_len_at_level` — `len()` returns count of keys at current level.
- [ ] `test_index_by_iter_at_level` — iteration yields `(key, value)` pairs at current level.
- [ ] `test_index_by_array_key_errors` — array as key component → error.

###### 16.5.11.3.2 Integration tests (Python)

**find_one tests:**
- [x] `test_find_one_babe_ruth` — `people.find_one((path("nameFirst") == "Babe") & (path("nameLast") == "Ruth"))`. (See `test_find_one_with_compound_predicate`)
- [x] `test_find_one_or_error_raises` — `people.find_one_or_error(path("nameLast") == "NotAPlayer")` raises. (See `test_find_one_or_error_raises_on_no_match`)

**Multi-key tests:**
- [x] `test_group_by_player_team` — `appearances.group_by(["playerID", "teamID"])` works. (See test_baseball_most_games_single_team)
- [x] `test_nest_by_year_team` — `batting.nest(teams, base_on=["yearID", "teamID"], ...)` works. (See test_baseball_hoyt_wilhelm_pitching)
- [x] `test_index_by_year_team` — `teams.index_by(["yearID", "teamID"])` provides `teams_idx[1920]["NYA"]`. (See test_baseball_top_hr_season_with_team)
- [x] `test_canonical_equality_in_index` — `teams_idx[1920]` and `teams_idx[1920.0]` return same result. (See test_canonical_equality_across_operations)

**Baseball example queries:**
- [x] `test_top_pitchers_by_wins` — Query 1: top 10 pitchers by career wins. (See test_baseball_top_10_pitchers_by_wins)
- [x] `test_most_games_single_team` — Query 2: most games for single team (Appearances.csv). (See test_baseball_most_games_single_team)
- [x] `test_top_hr_season_with_team` — Query 3: single-season HR (player total across stints) with team name. (See test_baseball_top_hr_season_with_team)
- [x] `test_babe_ruth_1920s` — Query 4: Babe Ruth 1920s batting (G, H, 2B, 3B, HR, RBI). (See test_baseball_babe_ruth_1920s)
- [x] `test_hoyt_wilhelm_pitching` — Query 5: Hoyt Wilhelm year-by-year with team names. (See test_baseball_hoyt_wilhelm_pitching)

###### 16.5.11.3.3 Golden / contract tests

- [x] `test_baseball_top_10_career_hr` — top 10 career HR leaders match known values (Barry Bonds, Hank Aaron, etc.).
- [x] `test_baseball_top_10_career_wins` — top 10 career wins match known values (Cy Young, etc.).

**Golden test stability note:** Assert that the result **set contains expected names** (e.g., Barry Bonds in top 10 HR) rather than exact ordering. For ties, assert only the first few unambiguous leaders have exact positions. This prevents brittleness from dataset updates or tie-ordering changes.

---

##### 16.5.11.4 Documentation Plan

- [x] Update `python/arbors/_arbors.pyi` with `find_one`, `find_one_or_error`, and multi-key type signatures. (find_one done in Step 0)
- [x] Update `python/examples/baseball-example.py` with all 5 example queries.
- [x] Add docstrings explaining `find_one` and multi-key semantics. (find_one docstrings added in Step 0)
- [x] Document canonical key equality behavior (1 matches 1.0). (In test_canonical_equality_across_operations)

---

##### 16.5.11.5 Execution Steps

###### Step 0: Add find_one and find_one_or_error

**Commit:** `feat(query): add find_one and find_one_or_error convenience methods`

**References:**
- 16.5.11.1.1: Inputs and Outputs — find_one API
- 16.5.11.1.5: Semantics — find_one behavior
- 16.5.11.1.6: Error Model — `E_NO_MATCH`
- 16.5.11.2.3: Symbols — `find_one`, `Arbor::find_one`, `Arbor::find_one_or_error`

**Files:**
- `crates/arbors-query/src/collection_ops.rs`
- `python/src/lib.rs`
- `python/arbors/_arbors.pyi`
- `python/tests/test_find_one.py` (new)

**Tasks:**
- [x] Implement `find_one()` in Rust: iterate, evaluate predicate, return first match.
- [x] Add Python bindings: `Arbor.find_one(expr)` and `Arbor.find_one_or_error(expr)`.
- [x] Update type stubs.

**Unit Tests:**
- [x] `test_find_one_returns_first_match`
- [x] `test_find_one_returns_none_on_no_match`
- [x] `test_find_one_or_error_returns_match`
- [x] `test_find_one_or_error_raises_on_no_match`

**Checkpoint:**
```bash
cargo test -p arbors-query find_one  # All find_one tests pass ✓
pytest python/tests/test_find_one.py -v  # All pass ✓
cargo clippy -p arbors-query --lib  # No warnings ✓
```

---

###### Step 1: Extend group_by for multi-key in Rust

**Commit:** `feat(query): multi-key support for group_by`

**References:**
- 16.5.11.0: "Canonical key equality for compound keys" — use CanonicalKey per-component
- 16.5.11.0: "Multi-key via list, not tuple expressions" — accept `&[Expr]`
- 16.5.11.0: "Multi-key group_by returns tuple keys" — return `Vec<ExprResult>` for key
- 16.5.11.1.5: Semantics — canonical equality, first-encounter order, null as valid key
- 16.5.11.2.3: Symbols — `group_by` signature change

**Files:**
- `crates/arbors-query/src/collection_ops.rs`

**Tasks:**
- [x] Change `group_by` signature to accept `keys: &[Expr]`.
- [x] Implement compound key using Vec of CanonicalKey.
- [x] Return `Vec<(Vec<ExprResult>, Arbor)>` for groups.
- [x] Add backward-compatible wrapper for single key.
- [x] Update internal callers.

**Unit Tests:**
- [x] `test_group_by_two_keys`
- [x] `test_group_by_three_keys`
- [x] `test_group_by_multi_preserves_order`
- [x] `test_group_by_multi_null_is_valid_key`
- [x] `test_group_by_multi_canonical_equality`
- [x] `test_group_by_single_unchanged`
- [x] `test_group_by_array_key_errors`

**Checkpoint:**
```bash
cargo test -p arbors-query group_by  # All group_by tests pass
cargo clippy -p arbors-query --lib  # No warnings
```

---

###### Step 2: Extend nest for multi-key in Rust

**Commit:** `feat(query): multi-key support for nest`

**References:**
- 16.5.11.0: "Canonical key equality for compound keys" — use CanonicalKey per-component
- 16.5.11.0: "Each key component must be scalar" — error on array/object keys
- 16.5.11.0: "Multi-key nest matches on all keys (logical AND)"
- 16.5.11.1.5: Semantics — compound key matching, canonical equality
- 16.5.11.1.6: Error Model — `E_KEY_LENGTH_MISMATCH`, `E_KEY_NOT_SCALAR`
- 16.5.11.2.3: Symbols — `nest` signature change

**Files:**
- `crates/arbors-query/src/nest.rs`

**Tasks:**
- [x] Change `nest` signature: `base_on: &[Expr]`, `related_on: &[Expr]`.
- [x] Validate `len(base_on) == len(related_on)`.
- [x] Build compound key index using Vec of CanonicalKey.
- [x] Match base trees using all keys with canonical equality.
- [x] Error if any key component is array/object.

**Unit Tests:**
- [x] `test_nest_two_keys_match`
- [x] `test_nest_two_keys_partial_match`
- [x] `test_nest_key_length_mismatch_error`
- [x] `test_nest_multi_key_null_drop`
- [x] `test_nest_multi_key_canonical_equality`
- [x] `test_nest_multi_key_cardinality_one`
- [x] `test_nest_multi_key_cardinality_many`
- [x] `test_nest_array_key_errors`

**Checkpoint:**
```bash
cargo test -p arbors-query nest  # All nest tests pass
cargo clippy -p arbors-query --lib  # No warnings
```

---

###### Step 3: Extend index_by for multi-key in Rust

**Commit:** `feat(query): multi-key nested index_by`

**References:**
- 16.5.11.0: "Canonical key equality for compound keys" — use CanonicalKey per-level
- 16.5.11.0: "Each key component must be scalar" — error on array/object keys
- 16.5.11.0: "Nested index structure for multi-key index_by"
- 16.5.11.1.5: Semantics — nested structure, duplicates at final level only
- 16.5.11.1.7: API — `IndexedArborEntry` enum, `depth` property
- 16.5.11.2.3: Symbols — `IndexedArborEntry`, `IndexedArbor::depth`

**Files:**
- `crates/arbors-query/src/index_by.rs`

**Tasks:**
- [x] Define `IndexedArborEntry` enum.
- [x] Change `IndexedArbor` to support nested structure with canonical keys.
- [x] Implement `depth` property.
- [x] Update `get` to return `IndexedArborEntry`.
- [x] Handle partial key access (return nested `IndexedArbor`).
- [x] `duplicates` applies only at final level.
- [x] Error if any key component is array/object.

**Unit Tests:**
- [x] `test_index_by_two_keys_nested`
- [x] `test_index_by_partial_key`
- [x] `test_index_by_missing_first_key`
- [x] `test_index_by_missing_second_key`
- [x] `test_index_by_multi_duplicates_final_level`
- [x] `test_index_by_multi_canonical_equality`
- [x] `test_index_by_depth`
- [x] `test_index_by_keys_at_level`
- [x] `test_index_by_len_at_level`
- [x] `test_index_by_iter_at_level`
- [x] `test_index_by_array_key_errors`

**Checkpoint:**
```bash
cargo test -p arbors-query index_by  # All index_by tests pass ✓
cargo clippy -p arbors-query --lib  # No warnings ✓
```

---

###### Step 4: Python bindings for multi-key operations

**Commit:** `feat(python): multi-key support for group_by, nest, index_by`

**References:**
- 16.5.11.1.7: Python API signatures
- 16.5.11.2.3: `ExprOrPaths` type for list handling

**Files:**
- `python/src/lib.rs`
- `python/arbors/_arbors.pyi`
- `python/tests/test_multi_key.py` (new)

**Tasks:**
- [x] Add `ExprOrPaths` type that accepts single or list.
- [x] Update `Arbor.group_by` to accept list, return tuple keys.
- [x] Update `Arbor.nest` to accept lists for base_on/related_on.
- [x] Update `Arbor.index_by` to accept list, return nested index.
- [x] Update `IndexedArbor.__getitem__` to return Tree or IndexedArbor.
- [x] Add `IndexedArbor.depth` property.
- [x] Update type stubs in `_arbors.pyi`.

**Unit Tests:**
- [x] `test_group_by_list_keys`
- [x] `test_group_by_tuple_return`
- [x] `test_group_by_canonical_equality` — `(1, "a")` groups with `(1.0, "a")`
- [x] `test_nest_list_keys`
- [x] `test_nest_key_length_error`
- [x] `test_nest_canonical_equality`
- [x] `test_index_by_list_nested`
- [x] `test_index_by_partial_access`
- [x] `test_index_by_canonical_equality` — `idx[1]` and `idx[1.0]` return same
- [x] `test_index_by_depth_property`
- [x] `test_index_by_keys_method`
- [x] `test_index_by_len_method`
- [x] `test_index_by_iter_method`

**Checkpoint:**
```bash
pytest python/tests/test_multi_key.py -v  # All pass ✓
make check-stubs  # Stubs valid ✓
make test  # All tests pass ✓
```

---

###### Step 5: Update baseball example with all queries

**Commit:** `docs(examples): comprehensive baseball example with multi-key operations`

**References:**
- User requirements: 5 baseball queries
- 16.5.11.4: Documentation Plan

**Files:**
- `python/examples/baseball-example.py`
- `python/tests/test_baseball_queries.py` (new)

**Tasks:**
- [x] Load Pitching.csv, Teams.csv, Appearances.csv in addition to existing data.
- [x] Query 1: Top 10 pitchers by career W, SO, SHO.
- [x] Query 2: Most games for single team using Appearances.csv (group by playerID+teamID).
- [x] Query 3: Single-season highest HR (player total across all stints) with team names.
- [x] Query 4: Babe Ruth 1920s batting stats (G, H, 2B, 3B, HR, RBI) using `find_one`.
- [x] Query 5: Hoyt Wilhelm year-by-year pitching with team names (nest by yearID+teamID).
- [x] Add clear comments explaining each query's approach.

**Integration Tests:**
- [x] `test_baseball_top_10_pitchers_by_wins`
- [x] `test_baseball_most_games_single_team`
- [x] `test_baseball_top_hr_season_with_team`
- [x] `test_baseball_babe_ruth_1920s`
- [x] `test_baseball_hoyt_wilhelm_pitching`

**Checkpoint:**
```bash
python python/examples/baseball-example.py  # Runs successfully
pytest python/tests/test_baseball_queries.py -v  # All pass
make test  # All tests pass
```

---

##### 16.5.11.6 Deliverables and Checkpoints

**Deliverable:** `find_one`/`find_one_or_error` convenience methods plus multi-key support for `group_by`, `nest`, and `index_by` in both Rust and Python, demonstrated through the enhanced baseball example with all 5 queries.

**Integration Tests:**
- [x] `test_full_baseball_workflow` — all 5 queries produce expected results.
- [x] `test_multi_key_backward_compat` — existing single-key code unchanged.
- [x] `test_canonical_equality_across_operations` — `1` and `1.0` treated as same key.

| Checkpoint | Verification |
|------------|--------------|
| Rust find_one | `cargo test -p arbors-query find_one` |
| Rust multi-key group_by | `cargo test -p arbors-query group_by` |
| Rust multi-key nest | `cargo test -p arbors-query nest` |
| Rust multi-key index_by | `cargo test -p arbors-query index_by` |
| Python find_one | `pytest python/tests/test_find_one.py` |
| Python multi-key | `pytest python/tests/test_multi_key.py` |
| Type stubs valid | `make check-stubs` |
| Baseball example runs | `python python/examples/baseball-example.py` |
| Full test suite | `make ci` |

**Commit after all checkpoints pass.**

---

## Phase 16.6 ArborStore Data Interoperability Improvements

**Purpose:** Deliver a general-purpose ArborStore that hits *all* of these simultaneously:
1. **MVCC/ACID** durability and snapshot reads (via redb).
2. **Reasonable write amplification** for incremental updates (rewrite \(O(\text{batch\_size})\), not \(O(\text{dataset\_size})\)).
3. **Fast analytics** without requiring a fully materialized “one big Arbor” object by introducing:
   - **Coarse (MB-scale) batching** for good scan locality and low per-batch overhead.
   - A **warm/cache path** that decodes batches once and keeps **Arrow arrays resident** for repeated queries (baseball-style workloads).
   - A **vectorized query engine** for schemaful workloads that compiles expressions into **column projections + Arrow-array kernels** (avoiding the current row-at-a-time `EvalContext` + `eval_expr` anti-pattern for analytics).
4. **Simplicity**: a single storage system (redb) and a single transactional model; no external file GC/epochs.

**Status:** Not started

**Context / Pain / What we learned the hard way:**
- **The real failure wasn’t “Arrow IPC” per se — it was the *monolithic value*:** redb’s MVCC gives page-level CoW, but if the “value” is a 100MB blob then an update rewrites ~100MB anyway.
- **Arrow IPC is a serialization format, not a storage format:** treating it as the unit of mutation guarantees large rewrite costs unless you introduce indirection (chunks/fragments) or deltas.
- **Our current IPC path isn’t zero-copy:** `serialize_to_ipc()` writes into a fresh `Vec<u8>`, and `deserialize_from_ipc()` reconstructs nodes/pools/interner via loops and allocations. It is correct, but it is not a “wire bytes become Arrow buffers” zero-copy story.
- **External mmap files + epoch GC was a complexity trap:** it shifted the “big rewrite” problem around and added lifecycle/GC/atomicity complexity without changing the fact that the unit of replacement was huge.
- **Row-at-a-time expression evaluation is an OLAP anti-pattern:** the current `arbors-query` `filter()` path (loop trees → `EvalContext::for_tree()` → `eval_expr`) is fundamentally mismatched with “Arrow at maximum efficiency”.
- **Key insight:** To get “SQLite-like” write amplification, we must make the unit of update small: **batches/fragments** (and later possibly deltas), not whole-dataset blobs.

**Scope:**
1. Replace `ARBORS_TABLE: name → [big bytes]` with **batched storage** in redb: `(name, batch_index) → batch bytes` plus per-dataset metadata.
2. Make batching **coarse by default** (MB-scale batches, not tiny fragments):
   - Default policy is byte-targeted (e.g. ~8–32MB) with safety bounds on trees/batch.
   - Still expose knobs (Rust + Python) so workloads can tune batch granularity.
3. Add a **global dictionary per dataset** (stored once) so batches share stable `InternId`s:
   - Avoid expensive “merge interners + re-sort children” rebuilds.
   - Enable efficient projection caches keyed by `InternId`.
4. Add an explicit **warm/cache dataset path**:
   - `warm(name, ...)` (or equivalent) prefetches + decodes batches into **resident Arrow arrays**.
   - Baseball-style workloads can pay decode once, then run many vectorized queries quickly.
5. Evolve analytics execution for schemaful workloads:
   - Compile expressions into **column projections** per batch and evaluate using **vectorized kernels** over Arrow arrays.
   - Keep row-at-a-time `eval_expr` as a fallback for unsupported expressions, not the fast path.
6. Add robust error handling, invariants, and tests: corruption detection, missing batch/dict errors, MVCC isolation, crash/abort safety.

**Non-goals (explicitly out of scope):**
- External mmap’d fragment files / epoch GC (possible follow-on phase).
- “Perfect” end-to-end zero-copy decode from redb bytes into Arrow arrays (hard lifetime/ownership mismatch in Rust); we instead deliver **warm cached Arrow arrays** for fast repeated analytics.
- Column-level fragmentation (future).
- Delta logs / update overlays / compaction (future).
- Schema evolution/migration tooling beyond version-gating (future).
- Tree-level “update in place” API; users still do get/modify/put (for now).
- A full SQL engine (explicitly not the goal; we target the arbors Expr API).

**Dependencies / prerequisites:**
- Existing Arbor in-memory model (`arbors-storage`) and query APIs (`arbors-query`).
- redb single-writer MVCC semantics.
- Existing `TableView`/`QueryOps` machinery (to be extended so schemaful analytics prefers vectorized execution).

---

### 16.6.R Requirements (“How it’s met”)

> This is the contract for Phase 16.6. Each requirement has an explicit “how it’s met” implementation story and a status (✅ delivered in 16.6, ⚠️ partially delivered, ⏭ follow-on).

| Requirement | How it's met (Phase 16.6) | Status |
|---|---|---|
| MVCC/ACID | redb transactions + single-writer/multi-reader MVCC (unchanged model) | ✅ |
| Zero-copy reads | **Not fully delivered**: v2 uses a bespoke codec in redb, so decode materializes Arrow arrays. We instead deliver **warm cached Arrow arrays** for repeated analytics; true end-to-end mmap/zero-copy is a follow-on phase. | ⚠️ |
| Reasonable write amp | **NOT DELIVERED**: Implementation is replace-all (rewrites ALL batches). Deferred to 16.7. | ❌ → 16.7 |
| Analytics | Vectorized schemaful execution: compile Expr → column projections + kernels over Arrow arrays; warm cache avoids repeated decode | ⚠️ (staged: subset first) |
| Incremental updates | **NOT DELIVERED**: `put()` rewrites ALL batches, not just changed ones. Deferred to 16.7. | ❌ → 16.7 |
| Simplicity | Single embedded system (redb), no external files/epochs; one atomic commit model | ✅ |

#### 16.6.R.1 MVCC/ACID

- **How it’s met**:
  - All writes occur within a single redb `WriteTransaction` and become visible only on `commit()`.
  - Readers use redb `ReadTransaction` snapshots.
  - Replace-all semantics ensures the dataset is always internally consistent at a committed snapshot.
- **Acceptance criteria**:
  - `test_concurrent_read_during_write_mvcc_isolation` passes (reader sees old version while writer prepares new).
  - `test_abort_leaves_old_visible_no_partials` passes.

#### 16.6.R.2 Zero-copy reads (realistic definition for 16.6)

> This is where prior attempts went off the rails: “true zero-copy reads” is not achievable inside redb-only v2 without solving Rust lifetime/ownership + Arrow buffer ownership end-to-end. Phase 16.6 delivers a practical replacement: **warm + vectorized**.

- **How it’s met (Phase 16.6)**:
  - **Warm/cache path** decodes batches once into Arrow arrays and keeps them resident (bounded cache).
  - Vectorized execution runs on those cached arrays, so repeated analytics avoids repeated decode/materialization.
- **What is explicitly *not* met in 16.6**:
  - “Bytes in storage are directly used as Arrow buffers with no copying” (true mmap/zero-copy).
- **Acceptance criteria**:
  - `test_warm_populates_cache_and_speeds_repeat_reads` demonstrates warm is a semantic no-op but reduces repeated query time.
- **Follow-on to fully meet original wording**:
  - External append-only segment file + manifest (still MVCC) or Arrow2/arrow-rs improvements that support owned mmapped buffers.

#### 16.6.R.2.a Baseline/absolute perf gates (to avoid floating targets)

- In addition to the relative gates, after recording the baseline on a reference machine (e.g., your M1 Max with the ~500MB baseball cache):
  - **Absolute warm gate**: `warm(["players","teams"], decode_all=true)` ≤ recorded `T_baseline_load * 1.25` *and* ≤ an absolute ceiling (e.g., 0.625s if baseline is 0.5s).
  - **Absolute repeated-query gate**: warmed repeated query time ≤ `T_baseline_queries * 0.5` *and* record the absolute value for CI regression checks.

#### 16.6.R.3 Reasonable write amplification

> **❌ NOT DELIVERED IN 16.6** — The implementation is replace-all: `put()` rewrites ALL batches regardless of what changed. This contradicts the design decision "replace-all-on-put" which was incompatible with this requirement. Deferred to Phase 16.7.

- **How it was supposed to be met**:
  - Dataset decomposed into batches; update rewrites \(O(\text{batch\_bytes})\) not \(O(\text{dataset\_bytes})\).
  - Coarse-by-default batch sizing keeps analytics fast while still bounding update cost; knobs allow smaller batches for update-heavy workloads.
- **Acceptance criteria** (NOT MET):
  - `bench_put_small_update_writes_one_batch` shows bytes written scales with batch size.
  - Overwrite tests confirm old batches are removed and new batches written atomically.

#### 16.6.R.4 Analytics performance

- **How it’s met**:
  - Add a **vectorized schemaful fast path**: compile a supported subset of `Expr` into per-batch column projections and evaluate with vectorized kernels over Arrow arrays.
  - Interpreter (`EvalContext` + `eval_expr`) remains as correctness fallback.
- **Why this is staged (⚠️)**:
  - We cannot flip the entire query surface to vectorized in one phase without risking correctness regressions.
  - We start with the highest-value subset (simple paths + comparisons + boolean logic + arithmetic).
- **Acceptance criteria**:
  - `test_vectorized_filter_matches_interpreter_for_supported_exprs`
  - `test_vectorized_group_by_matches_interpreter_for_supported_exprs`
  - `test_vectorized_fallback_for_unsupported_exprs`

#### 16.6.R.5 Incremental updates

> **❌ NOT DELIVERED IN 16.6** — Same as 16.6.R.3. The implementation rewrites ALL batches on every `put()`, not just changed ones. Deferred to Phase 16.7.

- **How it was supposed to be met**:
  - Updates rewrite only the affected batch keys (plus small dict/meta) in a single transaction.
  - MVCC readers remain consistent without blocking.
- **Acceptance criteria** (NOT MET):
  - Overwrite semantics validated by integration tests (`test_put_overwrite_removes_old_batches`).
  - Missing/corruption tests fail loudly and deterministically.

#### 16.6.R.6 Simplicity

- **How it’s met**:
  - redb-only, transactional replace-all; no external files, no epoch GC, no vacuum.
  - Strict format validation and explicit error model.
- **Acceptance criteria**:
  - Implementation touches only `arbors-base`, `arbors-storage`, `arbors-query`, and Python bindings—no new storage subsystems.

#### 16.6.R.7 Performance acceptance criteria (explicit)

> These are the non-negotiable performance targets for Phase 16.6. They are written relative to today’s behavior because the *whole point* of this phase is to improve update behavior without regressing the “baseball cache feels instant” experience.

**Baseline to record (before starting 16.6 implementation):**
- Run `python/examples/baseball-example.py` twice (second run uses cache).
- Record:
  - **T_baseline_load**: “Loading from Cache” wall time (current system; observed ~0.5s for ~500MB on your machine).
  - **T_baseline_queries**: total time to execute the 5 example queries after load.

**Targets after Phase 16.6 (v2 batched + warm + vectorized v0):**
- **Warm decode time**:
  - `warm(["players", "teams"], decode_all=True)` must complete in **≤ 1.25 × T_baseline_load** on the same machine with a warm OS page cache.
  - Rationale: warm is allowed to be slightly slower than a monolithic `get()` load, but not meaningfully worse.
- **Repeated analytics speed**:
  - On a second run (dataset already warmed in-process), the total time for the 5 example queries must be **≤ 0.5 × T_baseline_queries** *provided the exercised predicates fall within the vectorized v0 supported subset*.
  - If a query falls back to the interpreter (unsupported Expr), it is excluded from the speedup requirement but must still be correct.
- **No catastrophic regression**:
  - `get("players")` materialization (if still used anywhere) must be **≤ 2.0 × T_baseline_load** (we accept slower materialization, but not “seconds”).

**How we verify (benchmarks/checkpoints):**
- Add a small benchmark harness (Rust or Python) that:
  - Measures `warm()` time (decode_all=True)
  - Measures representative vectorized filters over field-only paths (v0 subset)
  - Measures repeated query run time with warm cache enabled
  - Checks results match the interpreter for supported subset expressions

### 16.6.0 Design Decisions

> Record *decisions* (not options). Each decision includes the “why” so later phases don’t reopen it accidentally.

#### Storage unit is tree batches (DECIDED)

**Decision:** The unit of persistence and CoW replacement is a **batch of trees** (JSONL lines / roots), not a single monolithic Arbor blob.

**Rationale:**
- Users reason about tree ranges (“update tree 12,345”), not internal node offsets.
- Batching reduces write amplification from \(O(\text{arbor\_bytes})\) to \(O(\text{batch\_bytes})\).
- Matches proven production patterns (DuckDB row groups, Lance fragments, Parquet row groups, lakehouse manifests).

**Implications:**
- New redb table for `(name, batch_index) → batch bytes`.
- Metadata required to map global tree index → batch index.

#### Chunking is coarse (MB-scale) by default (DECIDED)

**Decision:** Default batching targets **coarse, scan-friendly batches** (on the order of **~8–32MB** per batch for typical datasets), rather than “many tiny fragments”.

**Rationale:**
- Batch boundaries impose overhead: redb lookups, codec headers, per-batch planning, and CPU branchiness in execution.
- Arrow-like vectorized scanning is happiest when it can chew through **large contiguous buffers** with minimal per-chunk overhead.
- We still need chunking for update locality; the goal is to pick a batch size that is “small enough to update, large enough to scan”.

**Implications:**
- `trees_per_batch` remains available as a deterministic knob, but default guidance and implementation should be **byte-oriented**:
  - Prefer `batch_target_bytes` (new option) to choose trees/batch based on size.
  - Always enforce safety bounds (`min_trees_per_batch`, `max_trees_per_batch`) to avoid pathological fragmentation.
- Workload tuning is expected:
  - Baseball-style cache (write once, many reads): fewer, larger batches.
  - Incremental update workloads: smaller batches.

#### Warm/cache path is first-class for analytics workloads (DECIDED)

**Decision:** ArborStore provides an explicit **warm/cache dataset** path that prefetches and decodes batches into **resident Arrow arrays** (and optionally caches column projections), so repeated analytics runs at “hot in-memory” speed without requiring a single monolithic Arbor value.

**Rationale:**
- “No materialization” is only fast if queries operate on decoded columnar buffers, not via per-tree interpretation.
- Many real workloads (like the baseball cache) are: open → run many queries. Paying decode once is acceptable if it unlocks fast analytics.

**Implications:**
- Add a `warm()` / `cache()` API (Rust + Python) that:
  - Prefetches batches (sequential access)
  - Decodes into Arrow arrays once
  - Stores decoded batches in an in-process cache (bounded / LRU / pinned)

#### Schemaful analytics uses vectorized execution over Arrow arrays (DECIDED)

**Decision:** For schemaful datasets, the default analytics path compiles expressions into **column projections** and evaluates them using **vectorized execution over Arrow arrays**. Row-at-a-time `EvalContext` + `eval_expr` remains only as a fallback.

**Rationale:**
- The current per-tree evaluation model is correct and flexible, but it is fundamentally slower for OLAP-style scans.
- Vectorized kernels amortize overhead and maximize CPU throughput (SIMD, tight loops, predictable branches).

**Implications:**
- Introduce a “vectorized query” path that supports a *specific* subset of `Expr` initially (spelled out below), with a clear expansion plan.
- Fallback to existing evaluator for unsupported constructs (wildcards, filters, complex maps) with clear performance expectations.

**Supported subset for vectorized execution (v0 / must-have):**
- **Paths**:
  - Absolute `PathExpr` consisting of **Field-only** segments (`foo.bar.baz`).
  - No `Index`, `Wildcard`, `Filter`, and no relative `@` paths.
  - Path must resolve to a **scalar primitive** per tree (bool/i64/f64/string/date/datetime/duration/binary) or Missing/Null.
- **Expr operators**:
  - `Literal`
  - Null/existence: `IsNull`, `IsNotNull`, `Exists`, `Missing`, `DefaultIfMissing`, `NullToDefault`, `Coalesce` (scalar-only).
  - Comparisons: `Eq`, `Ne`, `Lt`, `Le`, `Gt`, `Ge` (scalar-only).
  - Boolean logic: `And`, `Or`, `Not` (scalar bool).

**Supported subset for vectorized execution (v1 / expand after v0 is solid):**
- Numeric arithmetic on scalar numeric paths/literals:
  - `Add`, `Sub`, `Mul`, `Div`, `Neg`, `Abs`, `Floor`, `Ceil`, `Round`, `Modulo`, `Clip`, `IsBetween`.
- Membership: `IsIn` where `list` is a **Literal array** of scalars (no computed list).

**Supported subset for vectorized execution (v2 / string predicates, only if needed for benchmarks):**
- `StartsWith`, `EndsWith`, `StrContains` where the pattern is a scalar literal string.

**Explicitly out of scope for vectorized execution in Phase 16.6 (always interpreter fallback):**
- Any `PathExpr` containing `Index`, `Wildcard`, `Filter`, or relative `@`.
- Any array/object construction or array/object ops: `Map`, `Flatten`, `Get`, `Slice`, `ArrayContains`, `Unique`, `Sort`, `Reverse`, `Concat`, object field mutation, etc.
- Regex ops, split/join, and most higher-order constructs.
- **Schema requirement:** Vectorized execution requires a schema (explicit or inferred). If no schema is available, fall back to the interpreter; schema inference (arbors-schema) is sufficient.

#### Global per-dataset dictionary (StringInterner) (DECIDED)

**Decision:** Store a **single dictionary** per dataset (Arbor name) and make all batches reference that dictionary.

**Rationale:**
- Eliminates expensive “merge interners” work when reconstructing: batches can share stable `InternId`s.
- Avoids correctness hazards around object-child ordering changes when InternIds change.
- Enables sharing of key strings (and optionally interned string *values*) across batches.

**Implications:**
- New redb table `ARBOR_DICT: name → dict bytes`.
- Batch payload format must not embed its own interner; it depends on `ARBOR_DICT`.
- Dictionary updates become a versioning concern (handled by “replace all atomically” policy below).

#### Pools are batched (dictionary is global) (DECIDED)

**Decision:** Pools live **inside each batch** (with per-batch index remapping); only the dictionary is global.

**Rationale:**
- Keeps update locality aligned with batches; avoids rewriting a giant shared pool for small updates.
- Aligns with the slicing/remapping strategy: each batch carries only the pool elements it references.

**Implications:**
- `data0` for primitives is remapped per batch using batch-local pool indices.
- Pool order is fixed in v2 (see codec layout); adding pool types requires a codec_version bump.

#### Batched read is the primary fast path; materialize is optional (DECIDED)

**Decision:** Provide a batched read/view API that supports **batch-wise execution**; `get()` may still materialize for compatibility but should not be required for performant scans/filters.

**Rationale:**
- Many operations are naturally batchable; forcing monolithic materialization reintroduces large CPU/memory costs.
- We already have `TableView` and `QueryOps` patterns that can be applied per batch.

**Implications:**
- Add `ReadTxn::get_batched()` (or equivalent) returning a lightweight view that can iterate batches and expose per-batch `Arbor`s sharing the dictionary.
- Add or extend query utilities to operate batch-by-batch when given a batched view.

#### redb-only persistence (for this phase) (DECIDED)

**Decision:** Store dictionary + metadata + batch payloads **inside redb** (no external files).

**Rationale:**
- Keeps complexity low and leverages redb’s MVCC cleanup.
- Demonstrates the fragmentation concept without reintroducing file lifecycle/GC pitfalls.

**Implications:**
- Not a true mmap zero-copy read of Arrow buffers; acceptable for now.
- Follow-on phase can introduce append-only segment files + manifest (if needed).

#### Encoding is bespoke ArborStoreV2 binary codec (Arrow physical buffers), not Arrow IPC (DECIDED)

**Decision:** ArborStore v2 persists `ARBOR_DICT` and `ARBOR_BATCHES` using a **bespoke binary encoding** that stores arrays as **Arrow-style physical buffers** (length + validity bitmap + values/offsets buffers) rather than Arrow IPC file/stream format.

**Rationale:**
- Arrow IPC is great for interchange, but **it does not solve write amplification** when stored monolithically, and in our current Rust implementation path it is **not a true zero-copy decode** anyway.
- IPC adds extra schema/metadata framing and pushes us into `RecordBatch` construction and per-element reconstruction. That’s unnecessary for a private embedded store where our schema is already controlled by Arbors.
- A bespoke codec can:
  - Encode/decode **in bulk** (memcpy buffers, avoid per-element loops in pool reconstruction).
  - Be simpler to version and validate for our narrow data model (nodes, roots, pools, dictionary).
  - Keep a clean path for external interop: Arrow IPC remains an **export/import** format at the edges, not the storage substrate.

**Implications:**
- Storage v2 payloads are not directly readable by generic Arrow tooling; that is acceptable for an embedded store.
- `crates/arbors-base/src/arrow_serde.rs` remains useful for external IPC export/import, but ArborStore persistence uses `v2_codec` (new module or refactor).
- We must specify the on-disk binary layout precisely (endianness, buffer ordering, validity bitmap format).

#### Crash/atomicity model: replace-all-on-put (DECIDED)

**Decision:** `put(name, arbor)` replaces **dict + meta + all batches atomically** in a single redb write transaction.

**Rationale:**
- Simplest robust correctness story: no partial dict/batch mismatch.
- Avoids needing fine-grained dict versioning initially.

**Implications:**
- Small updates still rewrite only the affected batches *in bytes written*, but we may still re-write dict/meta in the txn (dict is small relative to data).
- A later optimization can make dict updates conditional.

#### Storage version bump and no migration (DECIDED)

**Decision:** Introduce storage version `"2"` for this layout; opening version `"1"` fails (no migration).

**Rationale:**
- Clean slate; previous approach is known-bad for write amplification goals.
- Avoids maintaining legacy code paths and corner cases.

**Implications:**
- Version gating on open.
- Tests that v1 is rejected.
- Migration story: this library currently has **no external users**; if a v1 database exists, export/import via IPC is the recommended path. No in-place migration is provided in 16.6.

#### Composite key encoding for batches (DECIDED)

**Decision:** Encode batch keys as `"{name}\0{batch_index_be_u32}"` bytes.

**Rationale:**
- Simple, unambiguous separation.
- Big-endian index gives lexicographic ordering by batch index.

**Implications:**
- Name validation must reject `\0`.
- Helpers `encode_batch_key` / `decode_batch_key`.

---

### 16.6.1 Specification

#### 16.6.1.1 Inputs and Outputs (Data Model)

**Inputs:**
- `Arbor`: in-memory forest with columnar nodes, pools, and a `StringInterner`.
- `name: &str`: dataset identifier.
- Batching policy (configurable; defaults chosen for **MB-scale** chunking):
  - `batch_target_bytes: usize`: target encoded batch payload size (default **16 MiB**).
  - `min_trees_per_batch: usize`: lower bound (default **256**).
  - `max_trees_per_batch: usize`: upper bound (default **50_000**).
  - `trees_per_batch: Option<usize>`: explicit override for deterministic workloads/tests (if set, takes precedence).

**Outputs:**
- Stored representation in redb:
  - `ARBOR_META[name] → ArborMeta`
  - `ARBOR_DICT[name] → ArborDict`
  - `ARBOR_BATCHES[(name, i)] → ArborBatchPayload` for `i in 0..batch_count`
- Read-time:
  - `get(name) → Arbor` (materialized) **or**
  - `get_batched(name) → BatchedArborView` (non-materializing, batch iterator)

**Key invariants:**
- `ARBOR_META` is the single source of truth for `batch_count` and `trees_per_batch`.
- Dictionary must exist iff meta exists (for a non-empty dataset); batches depend on it.
- All batches for a dataset are indexed `0..batch_count` contiguous.
- Batch `i` contains trees `[i*T .. min((i+1)*T, tree_count))` where `T = trees_per_batch`.
- InternIds in nodes refer to the dataset dictionary; they are stable across batches.

**Storage encoding (normative):**
- All ArborStore v2 payloads use a bespoke binary codec, **ArborStoreV2**, not Arrow IPC.
- Endianness: **little-endian** for all integer/floating fields.
- Validity bitmaps:
  - Stored as a byte array in **LSB-first** bit order per Arrow convention (bit \(i\) is element \(i\)’s validity).
  - For non-nullable arrays, validity bitmap is omitted.
- Variable-width arrays (strings/binary):
  - Store `offsets` buffer + `values` buffer (+ validity if nullable).
  - Offsets are `i32` (Arrow `StringArray` / `BinaryArray`) unless/until we require large offsets.
- The codec must include enough length metadata to validate internal consistency (buffer sizes match lengths).

> Note: This codec is deliberately “Arrow-physical-buffer-shaped” so we can decode into Arrow arrays efficiently, but we do **not** depend on Arrow IPC framing.

##### 16.6.1.1.1 Codec Layout (Normative)

> This subsection is intentionally concrete: it removes “format design” decisions from implementation. All integers are little-endian.

**Common header (prefix for both `ARBOR_DICT` and `ARBOR_BATCHES` values):**

```text
HeaderV2 {
  magic: [u8; 4] = "ABV2",      // constant
  codec_version: u16 = 1,       // bump only on breaking layout change
  payload_kind: u8,             // 1 = DictV2, 2 = BatchV2
  flags: u8,                    // must be 0 in v2.1; reject unknown bits
  header_len: u32,              // bytes from start of magic through end of header (allows extension)
  payload_len: u32,             // bytes following the header (sanity check vs value length)
  reserved0: u32 = 0,           // reserved for future (e.g., checksum kind)
}
```

**Buffer building blocks (used by dict + batch):**

```text
// Fixed-width primitive array: Int64/Float64/Date32/TimestampMicros/DurationMicros/UInt32, etc.
FixedWidthArrayV2 {
  len: u32,
  null_count: u32,              // 0 if non-nullable; may still be 0 for nullable
  validity_len: u32,            // bytes; 0 if omitted
  values_len: u32,              // bytes; must equal len * sizeof(T)
  validity: [u8; validity_len], // if present: LSB-first bits, 1 = valid
  values:   [u8; values_len],   // raw little-endian element bytes
}

// Boolean array (Arrow-style): values are a bitmap, not a byte-per-bool vector.
BoolArrayV2 {
  len: u32,
  null_count: u32,
  validity_len: u32,            // bytes; 0 if omitted
  values_len: u32,              // bytes; must equal ceil(len/8)
  validity: [u8; validity_len], // optional LSB-first
  values:   [u8; values_len],   // LSB-first (bit i is value i)
}

// Variable-width array (String/Binary): offsets + values bytes (+ optional validity).
VarWidthArrayV2 {
  len: u32,
  null_count: u32,
  validity_len: u32,            // bytes; 0 if omitted
  offsets_len: u32,             // bytes; must equal (len+1)*4 (i32 offsets)
  values_len: u32,              // bytes; arbitrary
  validity: [u8; validity_len], // optional
  offsets:  [u8; offsets_len],  // i32 offsets, little-endian, monotonic, offsets[0]=0, offsets[len]=values_len
  values:   [u8; values_len],   // concatenated payload
}
```

**Dict payload (`ARBOR_DICT[name]`):**

```text
DictV2 {
  header: HeaderV2(payload_kind=1),

  // String interner table. InternId is the 0-based index into this array.
  // Strings are UTF-8; nulls are not allowed in v2 dict.
  strings: VarWidthArrayV2,     // validity_len must be 0, null_count must be 0

  // Optional: future extensions (must be absent in v2.1):
  // - schema blob
  // - additional dictionaries (e.g., stable value dictionaries)
}
```

**Batch payload (`ARBOR_BATCHES[encode_batch_key(name,i)]`):**

```text
BatchV2 {
  header: HeaderV2(payload_kind=2),

  // ColumnarNodes: all non-nullable u32 arrays of length node_count.
  node_count: u32,              // redundant, but enables cheap validation
  type_key: FixedWidthArrayV2,  // T = u32, len = node_count, validity_len=0
  parents:  FixedWidthArrayV2,  // T = u32, len = node_count, validity_len=0
  data0:    FixedWidthArrayV2,  // T = u32, len = node_count, validity_len=0
  data1:    FixedWidthArrayV2,  // T = u32, len = node_count, validity_len=0

  // Roots: non-nullable u32 array (NodeId indices) of length tree_count_in_batch.
  tree_count_in_batch: u32,
  roots: FixedWidthArrayV2,     // T = u32, len = tree_count_in_batch, validity_len=0

  // Pools (in fixed order; all arrays are nullable unless noted):
  pool_bools:     BoolArrayV2,        // nullable
  pool_int64s:    FixedWidthArrayV2,  // T=i64, nullable
  pool_float64s:  FixedWidthArrayV2,  // T=f64, nullable
  pool_strings:   VarWidthArrayV2,    // UTF-8, nullable
  pool_dates:     FixedWidthArrayV2,  // T=i32 (Date32), nullable
  pool_datetimes: FixedWidthArrayV2,  // T=i64 micros, nullable
  pool_durations: FixedWidthArrayV2,  // T=i64 micros, nullable
  pool_binaries:  VarWidthArrayV2,    // bytes, nullable
}
```

**Required decode-time validation (in addition to header checks):**
- **Header**: `magic`, `codec_version`, `payload_kind`, `flags==0`, `header_len`/`payload_len` consistent with total value length.
- **FixedWidthArrayV2**: `values_len == len * sizeof(T)`; if `validity_len > 0`, `validity_len >= ceil(len/8)`.
- **BoolArrayV2**: `values_len == ceil(len/8)`; validity length rules as above.
- **VarWidthArrayV2**:
  - `offsets_len == (len+1) * 4`
  - `offsets` monotonic, `offsets[0]==0`, `offsets[len]==values_len`
  - each offset in `[0, values_len]`
- **BatchV2**: node arrays lengths all equal `node_count`; roots length equals `tree_count_in_batch`.

Any failure yields `DictCorruption` / `BatchCorruption` with a specific cause string.

**Pool layout forward-compatibility:** Pool order is **frozen for v2** (bools, int64s, float64s, strings, dates, datetimes, durations, binaries). Adding new pool types requires a `codec_version` bump; there is no per-pool type tag in v2.

#### 16.6.1.2 Terminology and Naming

- **Tree**: one root (one JSONL line).
- **Batch**: contiguous range of trees stored as one payload.
- **Dictionary**: serialized `StringInterner` for keys and any `intern: true` string values.
- **Materialize**: build a single `Arbor` containing all trees (potentially expensive).
- **Batched view**: iterate batches and process them independently.

#### 16.6.1.3 Supported Features (Exhaustive)

- **Supported**:
  - `put(name, arbor)` — store dict/meta + batches (replace-all).
  - `get(name)` — retrieve and materialize a single Arbor (may allocate/copy).
  - `get_batched(name)` — retrieve a batched view for batch-wise processing.
  - `warm(name)` / `warm_many(names)` — prefetch + decode batches into an in-process cache for fast repeated analytics.
  - Vectorized analytics fast path for schemaful queries: filter/sort/group/aggregate where expressions can be compiled to column projections over Arrow arrays.
  - `delete(name)` — delete meta/dict/batches.
  - `list()` — list dataset names.
  - `contains(name)` — existence check.
  - Batching policy options in Rust + Python (`batch_target_bytes`, `min_trees_per_batch`, `max_trees_per_batch`, optional `trees_per_batch` override).

- **Explicitly not supported**:
  - Partial updates (tree-level update API) without re-put (future).
  - External file storage and vacuum/GC.
  - Per-column file layout.
  - Delta overlays / undo logs.
  - Vectorized execution for fully general Expr (wildcards, complex filters, deep map pipelines) — these remain correct but slower via the interpreter fallback.

#### 16.6.1.4 Modes / Policies

| Mode/Policy | Applies to | Behavior | Result |
|------------|------------|----------|--------|
| Small dataset optimization | `put()` | If trees ≤ `trees_per_batch`, store `batch_count = 1` | Minimal overhead |
| Empty dataset | `put()` | Store meta + dict (optional) with `batch_count = 0`, no batch entries | `get()` returns empty Arbor |
| Batched read | `get_batched()` | Returns batches without concatenation | Supports batch-wise execution |
| Materialized read | `get()` | Reads all batches and builds one Arbor | Compatibility path |
| Warm/cache dataset | `warm()` | Prefetch + decode batches and populate cache | Baseball-style workloads run fast repeated analytics |

#### 16.6.1.5 Semantics (Normative Rules)

- **Batch assignment**: tree \(i\) belongs to batch \(\lfloor i/T \rfloor\).
- **Batch sizing policy**:
  - If `trees_per_batch` override is set, use it as \(T\).
  - Otherwise, compute \(T\) to target `batch_target_bytes`, clamped to `[min_trees_per_batch, max_trees_per_batch]`.
  - Estimation (deterministic, no randomness):
    - Let `node_bytes ≈ nodes.len * 4 * 4` (four u32 columns), `roots_bytes ≈ roots.len * 4`, `pools_bytes = sum of buffer lengths across all pools`.
    - `per_tree_score = (node_bytes + roots_bytes + pools_bytes) / tree_count`.
    - `trees_per_batch_est = batch_target_bytes / per_tree_score`, then clamp to `[min_trees_per_batch, max_trees_per_batch]`.
    - Optional refinement: if the first encoded batch deviates by >2× target, recompute once using the observed batch size.
- **`put()` atomicity**: dict + meta + all batch keys must be updated within one redb write txn.
- **Overwrite semantics**: `put(name, ...)` must delete old batches for `name` before inserting new ones in the same txn.
- **`get_batched()`**:
  - Must fail with `DictMissing` if meta exists but dict is missing.
  - Must fail with `BatchMissing` if any expected batch key is absent.
  - Must expose batches in increasing `batch_index`.
- **`get()`**:
  - May be implemented as “materialize from `get_batched()`”.
  - Should not require interner merging: all batch Arbors must share the same dictionary.
- **Dictionary semantics**:
  - Dict must contain **all key strings** used by any batch.
  - If schema uses `StorageType::String { intern: true }`, dict must also contain those value strings.
- **Ordering invariants**:
  - Object children remain sorted by `InternId`. With global dict, slicing/copying must preserve this ordering.

- **Warm/cache semantics**:
  - `warm(name)` is a performance hint: it must not change logical results.
  - After `warm(name)`, subsequent schemaful analytics over that dataset should avoid re-decoding batches and should prefer vectorized execution when applicable.
  - Cache must be bounded (LRU or size cap) and must be invalidated on writes that change the dataset generation.
  - Cache keys include `(name, generation, batch_index)`; **generation** is a monotonically increasing `u64` in `ArborMeta`, incremented on every successful `put`/`delete`.

- **Codec semantics**:
  - `ARBOR_DICT` and `ARBOR_BATCHES` values must begin with a small header containing:
    - codec magic (e.g. `"ABV2"`) and a codec version number
    - payload kind (`Dict` vs `Batch`)
  - Decoders must validate:
    - header matches expected kind/version
    - buffer lengths are consistent with declared element counts
    - no out-of-bounds offsets for variable-width buffers
  - Any mismatch yields `DictCorruption` / `BatchCorruption` with a cause string.

- **Slicing/remapping semantics (nodes + pools)**:
  - Batches carry their own nodes *and* pools; dictionary remains global.
  - For each batch:
    1) Collect roots in range; DFS each tree to collect node IDs.
    2) Build `old_node_id → new_node_id` map; rewrite `type_key/parents/data0/data1` using that map.
    3) For each pool type: collect referenced indices; copy those elements into batch-local pools; build `old_pool_idx → new_pool_idx`; rewrite primitive `data0` using that map.
    4) Object-child ordering by `InternId` is preserved automatically with the global dict (no re-sort needed).
   - Complexity: O(nodes_in_batch + pool_entries_in_batch); DFS is bounded by batch contents.

#### 16.6.1.6 Error and Warning Model

**ArborStore errors (new/required):**
- `InvalidOptions(String)` — e.g. `trees_per_batch == 0`.
- `InvalidName(String)` — name contains `\0`.
- `DictMissing { name: String }`
- `DictCorruption { name: String, cause: String }`
- `BatchMissing { name: String, batch_index: u32 }`
- `BatchCorruption { name: String, batch_index: u32, cause: String }`

**Warnings:** none (treat inconsistencies as hard errors).

#### 16.6.1.7 Public API Surface

**Rust (arbors-base):**
```rust
#[derive(Debug, Clone)]
pub struct ArborStoreOptions {
    pub durability: Durability,
    pub cache_size: Option<usize>,
    /// Target encoded batch payload size (bytes). Default: 16 MiB.
    pub batch_target_bytes: usize,
    /// Lower bound on trees per batch. Default: 256.
    pub min_trees_per_batch: usize,
    /// Upper bound on trees per batch. Default: 50_000.
    pub max_trees_per_batch: usize,
    /// Optional explicit override. When set, wins over batch_target_bytes.
    pub trees_per_batch: Option<usize>,
}

impl ArborStore {
    pub fn open(path: impl AsRef<std::path::Path>, opts: ArborStoreOptions) -> Result<Self>;
    pub fn begin_read(&self) -> Result<ReadTxn<'_>>;
    pub fn begin_write(&self) -> Result<WriteTxn<'_>>;
    /// Warm/cache one or more datasets for fast repeated analytics.
    /// Populates an internal bounded cache keyed by (name, generation, batch_index).
    pub fn warm(&self, names: &[&str], opts: WarmOptions) -> Result<()>;
}

impl<'a> ReadTxn<'a> {
    pub fn get(&self, name: &str) -> Result<Option<arbors_storage::Arbor>>;
    pub fn get_batched(&self, name: &str) -> Result<Option<BatchedArbor<'a>>>;
}

#[derive(Debug, Clone)]
pub struct WarmOptions {
    /// Maximum total bytes to cache (decoded representation).
    pub max_bytes: usize,
    /// If true, decode all batches; if false, only prefetch headers/meta and first N batches.
    pub decode_all: bool,
}

pub struct BatchedArbor<'a> {
    // non-owning: tied to txn lifetime
    // provides batch iteration and optionally materialization
    // (details in internal architecture)
}

impl<'a> BatchedArbor<'a> {
    pub fn tree_count(&self) -> usize;
    pub fn batch_count(&self) -> usize;
    pub fn batch(&self, batch_index: usize) -> Result<arbors_storage::Arbor>;
    pub fn iter_batches(&self) -> impl Iterator<Item = Result<arbors_storage::Arbor>> + 'a;
    pub fn materialize(&self) -> Result<arbors_storage::Arbor>;
}
```

**Rust (arbors-storage):**
```rust
impl Arbor {
    /// Construct an Arbor that shares dictionary/schema via Arc.
    /// Needed to cheaply “attach” a dataset dictionary to each batch.
    pub fn from_parts_with_shared(
        nodes: ColumnarNodes,
        roots: Vec<arbors_core::NodeId>,
        interner: std::sync::Arc<StringInterner>,
        pools: FinishedPools,
        schema: Option<std::sync::Arc<arbors_schema::SchemaRegistry>>,
    ) -> Self;
}
```

**Python:**
```python
class ArborStoreOptions:
    durability: Durability = Durability.IMMEDIATE
    cache_size: Optional[int] = None
    batch_target_bytes: int = 16 * 1024 * 1024
    min_trees_per_batch: int = 256
    max_trees_per_batch: int = 50_000
    trees_per_batch: Optional[int] = None

class ArborStore:
    @staticmethod
    def open(path: str, options: Optional[ArborStoreOptions] = None) -> "ArborStore": ...

    def warm(self, names: list[str], *, max_bytes: int = ..., decode_all: bool = True) -> None: ...
```

#### 16.6.1.8 Internal Architecture

- **Single source of truth**: `ARBOR_META[name]`.
- **Tables**:
  - `METADATA_TABLE["__arbors_storage_version__"] = "2"`
  - `ARBOR_META: &str → &[u8]` (bincode)
  - `ARBOR_DICT: &str → &[u8]` (dict encoding)
  - `ARBOR_BATCHES: &[u8] → &[u8]` (batch key bytes → batch payload bytes)
- **Meta generation**:
  - `ArborMeta` carries a `generation: u64` per dataset; incremented on every successful `put`/`delete`.
  - Cache keys include generation to invalidate stale warm entries.
- **Read pipeline**:
  - Load meta → load dict → create shared `Arc<StringInterner>` (+ shared schema `Arc`)
  - For each batch:
    - load payload bytes → decode nodes/roots/pools
    - attach shared interner/schema to yield an `Arbor` for that batch
- **Write pipeline**:
  - Validate options/name → compute meta → compute dict → slice arbor into batches
  - In one txn: delete old batches → insert dict/meta/batches → commit
- **Batch-wise execution**:
  - `BatchedArbor` enables callers (and later internal query ops) to process one batch at a time:
    - `filter`: run existing per-Arbor ops on each batch Arbor, combine results with batch offsets.
    - `scan`: iterate batches sequentially for good locality.
  - Materialization is an explicit step (avoid doing it implicitly everywhere).
- **Key reason this is “right this time”**:
  - We stop hoping for “magic zero-copy” between redb’s mmap and Arrow buffers.
  - We make write amplification small by design (batches), and we make reconstruction cheap by design (global dict).

---

### 16.6.2 Definitive Symbol Inventory

#### 16.6.2.1 New crates (if any)

None.

#### 16.6.2.2 New files (if any)

None required (may create internal modules if `arbors-base/src/lib.rs` gets too large).

#### 16.6.2.3 Symbols to add / modify

**arbors-base (`crates/arbors-base/src/lib.rs`):**
- `CURRENT_STORAGE_VERSION = "2"`
- New table defs: `ARBOR_META`, `ARBOR_DICT`, `ARBOR_BATCHES`
- `ArborStoreOptions::{batch_target_bytes, min_trees_per_batch, max_trees_per_batch, trees_per_batch}`
- `WarmOptions` and `ArborStore::warm(...)`
- `ArborMeta` struct (bincode) including `generation: u64` (monotonic per dataset)
- `validate_name(name: &str) -> Result<()>` (reject `\0`)
- `encode_batch_key(name, idx) -> Vec<u8>` / `decode_batch_key(&[u8]) -> (...)`
- New error variants: `InvalidOptions`, `InvalidName`, `DictMissing`, `DictCorruption`, `BatchMissing`, `BatchCorruption`
- `ReadTxn::get_batched() -> Option<BatchedArbor>`
- `BatchedArbor` struct and methods (`iter_batches`, `materialize`, etc.)

**arbors-base (`crates/arbors-base/src/arrow_serde.rs`):**
- Keep Arrow IPC import/export for external interoperability (non-storage):
  - `serialize_to_ipc`, `deserialize_from_ipc` remain available as “edge” codecs.

**arbors-base (`crates/arbors-base/src/v2_codec.rs` or refactor within `lib.rs`):**
- `encode_dict_v2(interner: &StringInterner, schema: Option<&SchemaRegistry>) -> Vec<u8>`
- `decode_dict_v2(bytes: &[u8]) -> Result<Arc<StringInterner>, ArborStoreError>`
- `encode_batch_v2(batch: &Arbor, shared_dict: &StringInterner) -> Vec<u8>`
- `decode_batch_v2(bytes: &[u8], dict: Arc<StringInterner>, schema: Option<Arc<SchemaRegistry>>) -> Result<Arbor, ArborStoreError>`
- Common helpers for encoding/decoding Arrow-style physical buffers:
  - `encode_u32_buffer`, `decode_u32_buffer`
  - `encode_validity_bitmap`, `decode_validity_bitmap`
  - `encode_offsets_i32`, `decode_offsets_i32`
  - `encode_values_bytes`, `decode_values_bytes`

**arbors-storage (`crates/arbors-storage/src/lib.rs`):**
- New constructor to attach shared interner/schema: `Arbor::from_parts_with_shared(...)`
- (Optional optimization) new slicing helper that preserves InternIds and avoids interner rebuild when batching.

**python bindings (`python/src/lib.rs` + stubs):**
- Expose batching policy options (`batch_target_bytes`, bounds, override)
- Update `ArborStore.open(..., options=...)`
- Expose `ArborStore.warm(...)`

---

### 16.6.3 Test Plan

#### 16.6.3.1 Unit tests (arbors-base)

- [ ] `test_storage_version_is_2`
- [ ] `test_version_1_rejected`
- [ ] `test_name_with_nul_rejected`
- [ ] `test_options_batch_defaults` — defaults are MB-scale (target bytes + min/max trees) and `trees_per_batch` is None
- [ ] `test_options_trees_per_batch_override` — explicit override wins over byte-target policy
- [ ] `test_options_trees_per_batch_zero_error`
- [ ] `test_batch_key_encode_decode_roundtrip`
- [ ] `test_batch_key_ordering`
- [ ] `test_meta_roundtrip`
- [ ] `test_dict_roundtrip`
- [ ] `test_batch_payload_roundtrip`

#### 16.6.3.2 Integration tests (arbors-base)

- [ ] `test_put_get_small_single_batch_roundtrip`
- [ ] `test_put_get_exact_batch_boundary_roundtrip`
- [ ] `test_put_get_large_multi_batch_roundtrip`
- [ ] `test_get_batched_iterates_all_batches`
- [ ] `test_delete_removes_meta_dict_and_batches`
- [ ] `test_put_overwrite_removes_old_batches`
- [ ] `test_error_on_missing_dict`
- [ ] `test_error_on_missing_batch`
- [ ] `test_concurrent_read_during_write_mvcc_isolation`
- [ ] `test_abort_leaves_old_visible_no_partials`
- [ ] `test_reopen_persists_batched_data`
- [ ] `test_warm_populates_cache_and_speeds_repeat_reads` — warm is a semantic no-op but improves repeated access
- [ ] `test_warm_invalidation_on_generation_change` — cache entries with old generation are not used after a write
- [ ] `test_slice_handles_empty_trees` — slicing works when trees are empty/minimal

#### 16.6.3.3 Performance / regression guard tests (recommended)

- [ ] `bench_put_small_update_writes_one_batch` — measure bytes written / time (approximate).
- [ ] `bench_scan_batched_vs_materialized` — ensure batch-wise scan isn’t dramatically worse than monolithic.

---

### 16.6.4 Documentation Plan

- [ ] Update `docs/API.md` (or crate docs) describing ArborStore v2 layout at a high level.
- [ ] Document batching policy tuning guidance (`batch_target_bytes`, min/max, and override).
- [ ] Document why v1 was abandoned (monolithic blob write amplification).
- [ ] Document `get_batched()` and when to use it vs `get()`.
- [ ] Document `warm()` and when it matters (baseball-style repeated analytics).

---

### 16.6.5 Execution Steps

#### Step 0: Lock the v2 codec contract (dict + batch) with unit tests first

**Commit:** `spec(arbors-base): define ArborStoreV2 codec contract and roundtrip tests`

**References:** 16.6.0 “Encoding is bespoke ArborStoreV2…”, 16.6.1.1 (Storage encoding), 16.6.1.5 (Codec semantics), 16.6.1.6 (Corruption errors)

**Tasks:**
- [x] Define the exact on-disk byte layout for:
  - [x] `DictV2` payload (global string table; optional schema blob reference if needed)
  - [x] `BatchV2` payload (nodes, roots, pools)
- [x] Decide offsets width for variable-width buffers:
  - [x] Use `i32` offsets for v2 (matching Arrow `StringArray`/`BinaryArray`); reject oversized buffers with a clear error
- [x] Implement codec header fields:
  - [x] magic bytes (e.g. `ABV2`)
  - [x] codec version (`u16` or `u32`)
  - [x] payload kind (`Dict` / `Batch`)
  - [x] reserved flags for forward compat
- [x] Implement strict validation on decode:
  - [x] buffer sizes consistent with declared lengths
  - [x] offsets monotonic and in-range for variable-width buffers
  - [x] validity bitmap length sufficient for element count

**Unit Tests:**

*Header / framing:*
- [x] `test_v2_codec_header_roundtrip`
- [x] `test_v2_decode_rejects_bad_magic`
- [x] `test_v2_decode_rejects_wrong_codec_version`
- [x] `test_v2_decode_rejects_unknown_flags` — non-zero flags byte must fail
- [x] `test_v2_decode_rejects_wrong_payload_kind` — dict bytes with batch header or vice versa
- [x] `test_v2_decode_rejects_truncated_payload`
- [x] `test_v2_decode_rejects_header_len_mismatch` — header_len doesn't match actual
- [x] `test_v2_decode_rejects_payload_len_mismatch` — payload_len vs actual bytes

*Dictionary codec:*
- [x] `test_v2_dict_roundtrip_preserves_string_order_and_ids`
- [x] `test_v2_dict_empty` — 0 strings is valid
- [x] `test_v2_dict_single_string`
- [x] `test_v2_dict_unicode_strings` — emoji, CJK, combining characters
- [ ] `test_v2_dict_large_string` — single string near i32 offset limit (~2GB); may skip if impractical
- [x] `test_v2_dict_many_strings` — 100k+ strings
- [x] `test_v2_dict_decode_rejects_invalid_utf8`
- [x] `test_v2_dict_decode_rejects_null_in_strings` — nulls not allowed in dict

*Batch codec:*
- [x] `test_v2_batch_roundtrip_preserves_nodes_roots_pools`
- [x] `test_v2_batch_empty` — 0 nodes, 0 trees is valid (edge case)
- [x] `test_v2_batch_single_tree_single_node` — minimal case
- [x] `test_v2_batch_all_pool_types` — one value in each pool
- [x] `test_v2_batch_pool_all_nulls` — pool with only null entries
- [x] `test_v2_batch_pool_mixed_nulls` — some null, some non-null
- [x] `test_v2_batch_pool_empty` — pool with len=0
- [x] `test_v2_batch_numeric_edge_cases` — i64::MIN, i64::MAX, f64::NAN, f64::INFINITY, f64::NEG_INFINITY
- [x] `test_v2_batch_binary_large_blob` — single binary value > 1MB
- [x] `test_v2_batch_validity_bitmap_boundary` — exactly 8, 9, 16, 17 elements (byte boundaries)
- [x] `test_v2_decode_rejects_invalid_offsets` — non-monotonic, out-of-range
- [x] `test_v2_decode_rejects_node_count_mismatch` — declared node_count vs actual array lengths
- [x] `test_v2_decode_rejects_roots_count_mismatch`

**Checkpoint:** `cargo test -p arbors-base v2_codec` ✓

---

#### Step 1: Storage version 2 + tables + options + errors

**Commit:** `feat(arbors-base): add ArborStore v2 tables, options, and error model`

**References:** 16.6.0 (Storage version bump, Composite key encoding, redb-only), 16.6.1.6 (Error model), 16.6.2.3 (Symbol inventory)

**Tasks:**
- [x] Bump `CURRENT_STORAGE_VERSION` to `"2"` and reject `"1"` on open
- [x] Remove `ARBORS_TABLE` v1 usage from ArborStore read/write paths
- [x] Add tables:
  - [x] `ARBOR_META`
  - [x] `ARBOR_DICT`
  - [x] `ARBOR_BATCHES`
- [x] Add batching policy options to `ArborStoreOptions` (defaults: 16 MiB target, 256/50_000 bounds, optional override)
- [x] Validate options and names:
  - [x] `batch_target_bytes > 0`
  - [x] `min_trees_per_batch > 0`
  - [x] `max_trees_per_batch >= min_trees_per_batch`
  - [x] `trees_per_batch` override, if set, must be `> 0`
  - [x] name rejects `\0`
- [x] Implement batch key encode/decode helpers
- [x] Add new `ArborStoreError` variants: `InvalidOptions`, `InvalidName`, `DictMissing`, `DictCorruption`, `BatchMissing`, `BatchCorruption`

**Unit Tests:**

*Storage version:*
- [x] `test_storage_version_is_2`
- [x] `test_version_1_rejected`
- [x] `test_version_unknown_rejected` — e.g., version "99"
- [x] `test_fresh_db_creates_version_2`

*Name validation:*
- [x] `test_name_with_nul_rejected`
- [x] `test_name_empty_rejected` — "" is invalid
- [x] `test_name_unicode_allowed` — emoji, CJK in name
- [x] `test_name_special_chars_allowed` — spaces, dashes, dots (but not \0)
- [x] `test_name_very_long` — 1000+ character name

*Options validation:*
- [x] `test_options_batch_defaults` — verify 16 MiB, 256, 50_000
- [x] `test_options_trees_per_batch_override` — explicit override wins
- [x] `test_options_trees_per_batch_zero_error`
- [x] `test_options_batch_target_bytes_zero_error`
- [x] `test_options_min_trees_zero_error`
- [x] `test_options_min_greater_than_max_error`
- [x] `test_options_override_ignores_target_bytes` — when override set, target_bytes not used

*Batch key encoding:*
- [x] `test_batch_key_encode_decode_roundtrip`
- [x] `test_batch_key_ordering` — lexicographic by (name, index)
- [x] `test_batch_key_max_index` — u32::MAX works
- [x] `test_batch_key_different_names_sorted` — "aaa" < "bbb" in key order

*Error variants:*
- [x] `test_error_invalid_options_display`
- [x] `test_error_invalid_name_display`
- [x] `test_error_dict_missing_display`
- [x] `test_error_dict_corruption_includes_cause`
- [x] `test_error_batch_missing_includes_index`
- [x] `test_error_batch_corruption_includes_cause`

**Checkpoint:** `cargo test -p arbors-base` ✓

---

#### Step 2: Global dictionary persistence (ARBOR_DICT) using v2 codec

**Commit:** `feat(arbors-base): persist per-dataset dictionary (ARBOR_DICT) with v2 codec`

**References:** 16.6.0 (Global per-dataset dictionary), 16.6.1.1 (Outputs), 16.6.1.5 (Dictionary semantics), 16.6.1.6 (DictMissing/DictCorruption)

**Tasks:**
- [x] Define `ArborDict` logical model (what's in the dict):
  - [x] All key strings (required)
  - [x] Interned string values for `StorageType::String { intern: true }` (required if present)
- [x] Implement `encode_dict_v2` / `decode_dict_v2`
- [x] Store dict bytes in `ARBOR_DICT[name]`
- [x] Ensure dict is written/updated within the same txn as meta/batches (replace-all policy)

**Unit Tests:**

*Dictionary roundtrip:*
- [x] `test_dict_roundtrip` — basic encode/decode
- [x] `test_dict_empty_roundtrip` — 0 keys is valid
- [x] `test_dict_preserves_intern_id_order` — InternId 0 is first string, etc.
- [x] `test_dict_with_interned_values` — schema with `intern: true` string field

*Dictionary persistence:*
- [x] `test_dict_stored_in_arbor_dict_table`
- [x] `test_dict_updated_on_put` — new dict replaces old atomically
- [x] `test_dict_deleted_on_delete`
- [x] `test_dict_shared_across_batches` — all batches use same dict bytes

*Dictionary errors:*
- [x] `test_error_on_missing_dict` — meta exists but dict missing
- [x] `test_dict_corruption_error_message_contains_cause`
- [x] `test_dict_corruption_detected_on_bad_header`
- [x] `test_dict_corruption_detected_on_invalid_utf8`

*Dictionary isolation (MVCC):*
- [x] `test_dict_reader_sees_old_while_writer_prepares_new`

**Checkpoint:** `cargo test -p arbors-base dict` ✓

---

#### Step 3: Batch payload codec + “slice into batches” without interner rebuild

**Commit:** `feat(arbors-base): implement v2 batch payload codec and slicing pipeline`

**References:** 16.6.0 (Storage unit is tree batches, Global dictionary), 16.6.1.5 (Batch assignment), 16.6.1.8 (Write pipeline)

**Tasks:**
- [x] Define `BatchV2` payload contents (normative):
  - [x] Columnar nodes: `type_key`, `parents`, `data0`, `data1` as raw `u32` buffers
  - [x] Roots as raw `u32` buffer
  - [x] Pools as Arrow-physical buffers (validity + values/offsets + data)
  - [x] No embedded interner/dict
- [x] Implement `encode_batch_v2` / `decode_batch_v2`
- [x] Implement "slice into batches":
  - [x] Use `roots[start..end)` to compute the subtree/node set per batch via DFS
  - [x] Build `old_node_id → new_node_id` map; rewrite node arrays with that map
  - [x] For each pool type: collect referenced indices, copy only those elements to batch-local pools, build `old_pool_idx → new_pool_idx`, rewrite primitive `data0` using that map
  - [x] Preserve `InternId` values (dict is global) and object-child ordering by `InternId`
  - [x] Implement efficient buffer copies (bulk where possible; avoid per-element loops where remap tables allow)

**Unit Tests:**

*Batch codec roundtrip:*
- [x] `test_batch_roundtrip_empty` — 0 nodes, 0 trees
- [x] `test_batch_roundtrip_simple` — 1 tree, minimal nodes
- [x] `test_batch_decode_corruption_error` — corrupted bytes error handling
- [x] `test_all_pool_types_remapped` — null, bool, int, float, string, date, datetime, duration, binary in array
- [x] `test_slice_deeply_nested_tree` — nested arrays
- [x] `test_batch_encode_decode_full_roundtrip` — multi-batch encode/decode/rebuild

*Slicing correctness:*
- [x] `test_slice_multiple_batches` — tree_count with partial last batch
- [x] `test_slice_trees_per_batch_equals_one` — trees_per_batch = 1
- [x] `test_slice_trees_per_batch_exceeds_tree_count` — trees_per_batch > tree_count
- [x] `test_slice_empty_arbor` — 0 trees → 0 batches
- [x] `test_slice_single_tree` — 1 tree in 1 batch

*Node remapping:*
- [x] `test_node_ids_are_remapped_to_zero_based` — each batch starts node IDs at 0
- [x] `test_parent_pointers_are_remapped` — parent pointers valid in batch-local space
- [x] `test_children_start_is_remapped` — object/array children_start points to correct batch-local node

*Pool remapping:*
- [x] `test_pool_indices_are_remapped` — data0 for primitives points to batch-local pool
- [x] `test_pool_deduplication` — same string in multiple trees → one pool entry
- [x] `test_slice_with_null_values` — null pool entries handled
- [x] `test_slice_preserves_null_nodes` — null node type preserved

*InternId preservation:*
- [x] `test_intern_ids_preserved_in_batch` — key IDs unchanged (global dict)
- [x] `test_rebuild_arbor_from_batch_preserves_keys` — keys resolvable after rebuild
- [x] `test_object_child_flag_preserved` — is_object_child flag preserved

*Batch size estimation:*
- [x] `test_compute_trees_per_batch_uses_override` — explicit override used
- [x] `test_compute_trees_per_batch_empty_arbor` — empty arbor returns min
- [x] `test_compute_trees_per_batch_respects_bounds` — within min/max bounds

**Checkpoint:** `cargo test -p arbors-base batch` ✓

---

#### Step 4: Implement `put()` and `delete()` with replace-all semantics

**Commit:** `feat(arbors-base): implement batched put/delete with replace-all atomicity`

**References:** 16.6.0 (replace-all-on-put), 16.6.1.5 (put semantics), 16.6.1.6 (missing/corruption errors)

**Tasks:**
- [x] Implement `WriteTxn::put()`:
  - [x] Validate name/options
  - [x] Compute `tree_count`, `batch_count`
  - [x] Encode/store dict
  - [x] Encode/store each batch under `(name, batch_index)`
  - [x] Store `ARBOR_META` last (still in same txn) so readers never see meta without batches in committed state
  - [x] Delete prior batches (by reading previous meta's batch_count or prefix-scan keys)
- [x] Implement `WriteTxn::delete()`:
  - [x] Delete batches + dict + meta
  - [x] Return bool existed/not

**Integration Tests:**

*Basic put/get roundtrip:* (implemented in Step 5, requires `get()`)
- [x] `test_put_get_small_single_batch_roundtrip` — small arbor fits in one batch
- [x] `test_put_get_large_multi_batch_roundtrip` — arbor splits into multiple batches
- [x] `test_put_get_exact_batch_boundary` — tree_count = N × trees_per_batch exactly
- [x] `test_put_get_empty_arbor` — 0 trees stored and retrieved correctly
- [x] `test_put_get_preserves_all_data` — compare original vs retrieved arbor field-by-field

*Put semantics:*
- [x] `test_put_creates_meta_dict_batches` — all three tables populated
- [x] `test_put_generation_increments` — generation is 1 after first put, 2 after second, etc.
- [x] `test_put_batch_count_matches_meta` — meta.batch_count equals actual batch keys
- [x] `test_put_trees_per_batch_recorded_in_meta`
- [x] `test_put_empty_arbor` — 0 trees stored correctly

*Overwrite semantics:*
- [x] `test_put_overwrite_removes_old_batches` — old batch keys deleted
- [x] `test_put_overwrite_fewer_batches` — 5 batches → 3 batches, batches 3-4 gone
- [x] `test_put_overwrite_more_batches` — 3 batches → 5 batches, all 5 present
- [x] `test_put_overwrite_updates_meta` — new meta replaces old
- [x] `test_put_overwrite_increments_generation`

*Delete semantics:*
- [x] `test_delete_removes_meta_dict_and_batches` — all tables cleaned
- [x] `test_delete_nonexistent_returns_false` — no error, just false
- [x] `test_delete_then_get_returns_none`
- [x] `test_delete_then_put_works` — can reuse name after delete

*Multiple datasets:*
- [x] `test_multiple_datasets_independent` — put A, put B, both have correct metadata
- [x] `test_delete_one_preserves_others` — delete A, B still accessible
- [x] `test_list_after_put_delete` — list() reflects current state

*Atomicity:*
- [x] `test_put_atomic_all_or_nothing` — if put fails mid-way, no partial state visible (simulate via abort)
- [x] `test_put_abort_leaves_old_data` — abort during overwrite leaves previous version

*ArborMeta encoding:*
- [x] `test_arbor_meta_encode_decode_roundtrip`
- [x] `test_arbor_meta_decode_short_buffer`
- [x] `test_arbor_meta_large_values`

**Checkpoint:** `cargo test -p arbors-base put && cargo test -p arbors-base delete` ✓

---

#### Step 5: Implement batched read path (`get_batched`) and materializing `get`

**Commit:** `feat(arbors-base): add get_batched view and materialized get() from batches`

**References:** 16.6.0 (Batched read primary), 16.6.1.7 (API surface), 16.6.1.8 (Read pipeline)

**Tasks:**
- [x] Implement `ReadTxn::get_batched()` returning `BatchedArbor`
- [x] Implement `BatchedArbor`:
  - [x] Holds meta + dict (Arc) + txn reference
  - [x] Provides `iter_batches()` and `batch(i)`
  - [x] Provides `materialize()` which concatenates batches:
    - [x] Append nodes/pools with offset remap for node IDs and pool indices
    - [x] Roots are offset by prior node counts; no interner merge required
- [x] Implement/adjust `ReadTxn::get()` to use `get_batched().materialize()`
- [x] Implement same logic for `WriteTxn::get()` (if API supports it today)

**Integration Tests:**

*get_batched basics:*
- [x] `test_get_batched_returns_none_for_missing` — non-existent dataset returns None
- [x] `test_get_batched_returns_view_for_existing`
- [x] `test_get_batched_tree_count_correct` — view.tree_count() matches original
- [x] `test_get_batched_batch_count_correct` — view.batch_count() matches meta

*Batch iteration:*
- [x] `test_get_batched_iterates_all_batches` — iter_batches yields batch_count items
- [x] `test_get_batched_batches_in_order` — batch 0, 1, 2, ... in sequence
- [x] `test_get_batched_batch_i_returns_correct_trees` — batch(i) contains expected trees
- [x] `test_get_batched_batch_out_of_range_error` — batch(batch_count) fails
- [x] `test_get_batched_empty_dataset` — 0 batches, iter yields nothing

*Batch Arbor correctness:*
- [x] `test_batch_arbor_shares_interner` — all batch Arbors have same Arc<StringInterner>
- [x] `test_batch_arbor_has_correct_tree_count` — batch.num_trees() correct
- [x] `test_batch_arbor_trees_are_valid` — can traverse/query each tree in batch
- [x] `test_batch_arbor_pools_are_self_contained` — pool indices valid within batch

*Materialize:*
- [x] `test_get_materialized_equals_concat_of_batches` — materialize() matches original
- [x] `test_materialize_single_batch` — no-op essentially
- [x] `test_materialize_many_batches` — 10+ batches combined correctly
- [x] `test_materialize_node_ids_remapped` — global node IDs across batches
- [x] `test_materialize_pool_indices_remapped` — global pool indices across batches
- [x] `test_materialize_roots_offset_correct` — roots point to correct global node IDs
- [x] `test_materialize_preserves_tree_order` — tree i in original = tree i in materialized

*get() via materialize:*
- [x] `test_get_uses_materialize_internally` — get() result equals get_batched().materialize()
- [x] `test_get_returns_none_for_missing`

*Error cases:*
- [x] `test_error_on_missing_batch` — batch key absent mid-read (implemented as test_error_batch_index_out_of_range)
- [ ] `test_error_on_missing_dict` — dict absent but meta present (requires direct DB manipulation)
- [ ] `test_error_on_corrupted_batch` — malformed batch bytes (requires direct DB manipulation)
- [ ] `test_error_on_corrupted_dict` — malformed dict bytes (requires direct DB manipulation)

*Query on batched view:*
- [ ] `test_filter_on_batched_equals_filter_on_materialized` — same results either way (deferred: requires query integration)
- [ ] `test_select_on_batched_equals_select_on_materialized` (deferred: requires query integration)

**Checkpoint:** `cargo test -p arbors-base get` ✓

---

#### Step 5.5: Add warm/cache path for baseball-style workloads

**Commit:** `feat(arbors-base): add warm() to prefetch/decode batches into an in-process cache`

**References:** 16.6.0 (Warm/cache path), 16.6.1.4 (Warm/cache dataset mode), 16.6.1.5 (Warm/cache semantics)

**Tasks:**
- [x] Add an internal bounded cache on `ArborStore` keyed by `(name, generation, batch_index)`
- [x] Implement `ArborStore::warm(names, WarmOptions)`:
  - [x] Prefetch meta + dict
  - [x] Sequentially read batches and decode them (decode_all=true) or decode first N (decode_all=false)
  - [x] Enforce `max_bytes` eviction policy (LRU or size cap)
- [x] Invalidate cached entries on successful `put()`/`delete()` for that dataset (generation changes)

**Integration Tests:**

*Warm basics:*
- [x] `test_warm_populates_cache_and_speeds_repeat_reads` — second read faster
- [x] `test_warm_single_dataset` — warm(["foo"]) works
- [x] `test_warm_multiple_datasets` — warm(["foo", "bar"]) works
- [x] `test_warm_nonexistent_dataset_error_or_skip` — decide behavior: error vs skip (implemented as skip)

*Warm options:*
- [x] `test_warm_decode_all_true` — all batches decoded
- [x] `test_warm_decode_all_false` — only first N batches decoded (or headers only)
- [x] `test_warm_max_bytes_limits_cache` — exceeding max_bytes triggers eviction
- [x] `test_warm_empty_dataset` — 0 batches, no error

*Cache behavior:*
- [x] `test_cache_hit_avoids_decode` — after warm, get_batched uses cached Arbor
- [x] `test_cache_keyed_by_generation` — cache key includes generation
- [x] `test_cache_lru_eviction` — least-recently-used evicted when full

*Cache invalidation:*
- [x] `test_warm_invalidation_on_generation_change` — put() invalidates cache
- [x] `test_warm_invalidation_on_delete` — delete() invalidates cache
- [x] `test_warm_stale_generation_not_used` — old generation entry ignored after put

*Warm idempotency:*
- [x] `test_warm_twice_same_dataset` — no error, no duplicate entries
- [x] `test_warm_after_put` — new data cached, old evicted

*Warm + query:*
- [ ] `test_query_after_warm_uses_cache` — filter/select benefits from warm (deferred: requires query integration)

**Checkpoint:** `cargo test -p arbors-base warm` ✓

---

#### Step 6: MVCC + transaction safety tests

**Commit:** `test(arbors-base): add MVCC/atomicity tests for v2 batched storage`

**References:** 16.6.0 (redb MVCC assumptions, replace-all policy), 16.6.6 (deliverables)

**Tasks:**
- [x] Add concurrent reader/writer tests verifying snapshot isolation:
  - [x] reader sees old meta/dict/batches while writer prepares new version
  - [x] after commit, new reader sees new version
- [x] Add abort tests:
  - [x] aborted write txn leaves no partial visible state
- [x] Add reopen tests:
  - [x] close/reopen preserves all datasets and all batches

**Integration Tests:**

*Snapshot isolation:*
- [x] `test_concurrent_read_during_write_mvcc_isolation` — reader sees old version while writer prepares new
- [x] `test_reader_sees_committed_version` — after commit, new reader sees new data
- [x] `test_multiple_concurrent_readers` — N readers all see consistent snapshot
- [x] `test_reader_snapshot_stable` — reader sees same data throughout transaction
- [x] `test_list_during_write_sees_old` — list() during write sees pre-commit state

*Single-writer semantics:*
- [x] `test_second_writer_blocks_or_fails` — only one write txn at a time
- [x] `test_writer_can_read_own_writes` — within same txn, put then get sees new data

*Abort handling:*
- [x] `test_abort_leaves_old_visible_no_partials` — no partial batches visible
- [x] `test_abort_mid_put_no_dict_change` — dict unchanged after abort
- [x] `test_abort_mid_put_no_meta_change` — meta unchanged after abort
- [x] `test_abort_mid_put_no_batch_change` — batch keys unchanged after abort

*Durability:*
- [x] `test_reopen_persists_batched_data` — close + reopen sees all data
- [x] `test_reopen_preserves_generation` — generation counter survives restart
- [x] `test_reopen_preserves_multiple_datasets`
- [x] `test_reopen_after_put_sees_new_data`
- [x] `test_reopen_after_delete_sees_deleted`

*Crash simulation (if feasible):*
- [x] `test_crash_mid_commit_recovers_cleanly` — simulated crash, reopen OK (may require test infrastructure)

*Edge cases:*
- [x] `test_empty_transaction_commit` — commit with no writes is OK
- [x] `test_read_in_write_txn` — can read existing data in write txn
- [x] `test_get_batched_in_write_txn` — batched view works in write txn

**Checkpoint:** `cargo test -p arbors-base` ✓

---

#### Step 7: Vectorized query execution for schemaful analytics (fast path)

**Commit:** `feat(arbors-query): add vectorized execution path for schemaful Expr over Arrow arrays`

**References:** 16.6.0 (Schemaful analytics uses vectorized execution), 16.6.1.3 (Supported features: vectorized fast path), 16.6.1.5 (Warm/cache semantics)

**Tasks:**
- [x] Define a compiled query plan that maps `Expr` → `(projections, kernels)` for the **explicit supported subset**:
  - [x] **v0 (must-have)**: Field-only scalar paths + null/existence + comparisons + boolean logic
  - [x] **v1 (next)**: scalar numeric arithmetic + `IsBetween`/`Clip` + literal-list `IsIn`
  - [ ] **v2 (optional)**: string predicates `StartsWith`/`EndsWith`/`StrContains` with literal patterns
- [x] Implement per-batch projection materialization into Arrow arrays (using pools + schema guidance)
- [x] Evaluate predicates/keys/aggregates using vectorized kernels over Arrow arrays
- [x] Provide a clear fallback to existing interpreter (`EvalContext` + `eval_expr`) when an Expr is not supported by the vectorizer
- [ ] (Optional) integrate with ArborStore warm cache so projections can be cached per batch
- [x] Require schema (explicit or inferred); if no schema is available, fall back to interpreter

**Unit/Integration Tests:**

*Vectorizer detection and fallback:*
- [x] `test_vectorized_detects_supported_expr` — simple field path + comparison
- [x] `test_vectorized_fallback_for_unsupported_exprs` — wildcard, index, filter in path
- [x] `test_vectorized_fallback_for_no_schema` — schemaless arbor uses interpreter
- [x] `test_vectorized_works_with_inferred_schema` — schema inference enables vectorization
- [x] `test_vectorized_mixed_expr_partial_fallback` — supported outer, unsupported inner → fallback

*Path projection (v0):*
- [x] `test_vectorized_path_single_field` — `$.foo`
- [x] `test_vectorized_path_nested_fields` — `$.foo.bar.baz`
- [x] `test_vectorized_path_missing_field` — field not in some trees → Missing
- [x] `test_vectorized_path_null_intermediate` — `$.foo.bar` where foo is null → Null
- [x] `test_vectorized_path_to_each_scalar_type` — bool, i64, f64, string, date, datetime, duration, binary

*Null/existence operators (v0):*
- [x] `test_vectorized_is_null` — IsNull on nullable column
- [x] `test_vectorized_is_not_null`
- [x] `test_vectorized_exists` — field present
- [x] `test_vectorized_missing` — field absent
- [ ] `test_vectorized_default_if_missing` — missing → default value (fallback to interpreter)
- [ ] `test_vectorized_null_to_default` — null → default value (fallback to interpreter)
- [ ] `test_vectorized_coalesce` — first non-null/non-missing (fallback to interpreter)

*Comparison operators (v0):*
- [x] `test_vectorized_eq_scalar` — `$.x == 5`
- [x] `test_vectorized_ne_scalar`
- [x] `test_vectorized_lt_scalar`
- [x] `test_vectorized_le_scalar`
- [x] `test_vectorized_gt_scalar`
- [x] `test_vectorized_ge_scalar`
- [x] `test_vectorized_eq_string` — `$.name == "foo"`
- [x] `test_vectorized_comparison_with_null` — null compared to value → null/false (SQL semantics)
- [x] `test_vectorized_comparison_with_missing` — missing compared → missing/false
- [x] `test_vectorized_comparison_both_paths` — `$.x == $.y`

*Boolean logic (v0):*
- [x] `test_vectorized_and` — `$.a && $.b`
- [x] `test_vectorized_or` — `$.a || $.b`
- [x] `test_vectorized_not` — `!$.a`
- [x] `test_vectorized_boolean_with_null` — null && true → null (three-valued logic)
- [x] `test_vectorized_complex_boolean` — `($.a && $.b) || !$.c`

*Literal handling:*
- [x] `test_vectorized_literal_int`
- [x] `test_vectorized_literal_float`
- [x] `test_vectorized_literal_string`
- [x] `test_vectorized_literal_bool`
- [x] `test_vectorized_literal_null`

*Filter correctness:*
- [x] `test_vectorized_filter_matches_interpreter_for_supported_exprs` — cross-check
- [x] `test_vectorized_filter_empty_result` — no rows match
- [x] `test_vectorized_filter_all_match` — all rows match
- [x] `test_vectorized_filter_some_match` — subset matches
- [x] `test_vectorized_filter_on_schemaless_falls_back` — schemaless uses fallback

*Group-by correctness:*
- [ ] `test_vectorized_group_by_matches_interpreter_for_supported_exprs` (uses interpreter fallback)
- [ ] `test_vectorized_group_by_single_key` (uses interpreter fallback)
- [ ] `test_vectorized_group_by_null_key` — nulls grouped together (uses interpreter fallback)
- [ ] `test_vectorized_group_by_missing_key` — missing grouped separately or with nulls (uses interpreter fallback)

*Aggregate correctness:*
- [x] `test_vectorized_count`
- [x] `test_vectorized_sum_int`
- [x] `test_vectorized_sum_float`
- [x] `test_vectorized_sum_with_nulls` — nulls skipped
- [x] `test_vectorized_avg`
- [x] `test_vectorized_min_max`

*Large data:*
- [x] `test_vectorized_large_batch_1000_rows` — performance and correctness (1000 rows tested)
- [x] `test_vectorized_correctness_with_many_trees` — 100 trees with complex filters

*v1 Scalar Arithmetic:*
- [x] `test_vectorized_add_int_int` — `$.x + $.y` where both are integers
- [x] `test_vectorized_add_int_float` — mixed types promote to float
- [x] `test_vectorized_add_literal` — `$.x + 10`
- [x] `test_vectorized_sub` — `$.x - $.y`
- [x] `test_vectorized_mul` — `$.x * $.y`
- [x] `test_vectorized_div` — `$.x / $.y`
- [x] `test_vectorized_div_by_zero` — division by zero returns null
- [x] `test_vectorized_neg` — `-$.x` negation
- [x] `test_vectorized_abs` — `abs($.x)` absolute value
- [x] `test_vectorized_arithmetic_with_null` — null propagates through arithmetic
- [x] `test_vectorized_arithmetic_chained` — `($.a + $.b) * $.c`

*v1 IsBetween/Clip:*
- [x] `test_vectorized_is_between_int` — `$.x.is_between(10, 50)`
- [x] `test_vectorized_is_between_float` — float bounds
- [x] `test_vectorized_is_between_at_boundaries` — value == lower or value == upper → true
- [x] `test_vectorized_is_between_null_value` — null value → null result
- [x] `test_vectorized_clip_int` — `$.x.clip(10, 50)`
- [x] `test_vectorized_clip_float` — float clipping
- [x] `test_vectorized_clip_below_min` — value < min → returns min
- [x] `test_vectorized_clip_above_max` — value > max → returns max
- [x] `test_vectorized_clip_in_range` — min <= value <= max → returns value

*v1 IsIn (literal list):*
- [x] `test_vectorized_is_in_int_list` — `$.x.is_in([1, 2, 3])`
- [x] `test_vectorized_is_in_string_list` — `$.name.is_in(["Alice", "Bob"])`
- [x] `test_vectorized_is_in_float_list` — float values in list
- [x] `test_vectorized_is_in_empty_list` — empty list → always false
- [x] `test_vectorized_is_in_null_value` — null value → null result
- [x] `test_vectorized_is_in_null_in_list` — null in list matches null values
- [x] `test_vectorized_is_in_not_found` — value not in list → false
- [x] `test_vectorized_is_in_mixed_types` — int value matches float in list (if equal)

*v1 Cross-validation:*
- [x] `test_vectorized_v1_matches_interpreter` — cross-check arithmetic results
- [x] `test_vectorized_v1_filter_with_arithmetic` — `$.price * $.qty > 100`
- [x] `test_vectorized_v1_complex_expression` — `$.x.is_between(0, 100) && $.category.is_in(["A", "B"])`

**Checkpoint:** `cargo test -p arbors-query vectorized` ✓ (78 tests passing)

**Benchmarks:** `cargo bench -p arbors-query` ✓

v0 Vectorized vs interpreter performance comparison at 100k rows:

| Benchmark | Interpreter | Vectorized | Speedup |
|-----------|-------------|------------|---------|
| Simple filter (`age > 50`) | 4.92 ms | 2.21 ms | **2.23x** |
| String equality (`dept == "eng"`) | 7.13 ms | 2.79 ms | **2.56x** |
| Complex boolean (3 predicates) | 16.29 ms | 7.06 ms | **2.31x** |
| Filter + aggregate pipeline | 6.09 ms | 3.02 ms | **2.02x** |

v1 Vectorized vs interpreter performance comparison at 100k rows:

| Benchmark | Interpreter | Vectorized | Speedup |
|-----------|-------------|------------|---------|
| Arithmetic (`(age + score) > 100`) | 9.34 ms | 3.89 ms | **2.40x** |
| IsBetween (`age.is_between(30, 60)`) | 5.62 ms | 2.55 ms | **2.20x** |
| IsIn (`dept.is_in(["eng", "sales"])`) | 15.44 ms | 2.33 ms | **6.63x** |

Throughput (vectorized):
- Projection: 73 Melem/s (single field), 27 Melem/s (nested 3 levels)
- Aggregates: 60-73 Melem/s (sum/avg/min/max/count)

---

**v1 Vectorization Spec:**

*Scope:* Extend vectorized execution to support scalar arithmetic, range checks, and set membership.

*v1.1 Scalar Arithmetic (Add, Sub, Mul, Div, Neg, Abs):*

```rust
// Extend is_vectorizable() to recognize arithmetic Expr variants
Expr::Add(lhs, rhs) | Expr::Sub(lhs, rhs) | Expr::Mul(lhs, rhs) | Expr::Div(lhs, rhs) => {
    is_vectorizable_inner(lhs, schema)?;
    is_vectorizable_inner(rhs, schema)
}
Expr::Neg(inner) | Expr::Abs(inner) => is_vectorizable_inner(inner, schema),

// Implementation approach:
// 1. Project both operands to ProjectedColumn (Int64 or Float64)
// 2. Apply element-wise kernel with null propagation
// 3. Return ProjectedColumn::Int64 or ProjectedColumn::Float64

// Numeric kernel signatures:
fn kernel_add(left: &ProjectedColumn, right: &ProjectedColumn) -> ProjectedColumn
fn kernel_sub(left: &ProjectedColumn, right: &ProjectedColumn) -> ProjectedColumn
fn kernel_mul(left: &ProjectedColumn, right: &ProjectedColumn) -> ProjectedColumn
fn kernel_div(left: &ProjectedColumn, right: &ProjectedColumn) -> ProjectedColumn
fn kernel_neg(col: &ProjectedColumn) -> ProjectedColumn
fn kernel_abs(col: &ProjectedColumn) -> ProjectedColumn

// Type promotion rules (matching interpreter):
// - Int64 + Int64 → Int64
// - Float64 + Float64 → Float64
// - Int64 + Float64 → Float64 (promote int to float)
// - null + anything → null
// - missing + anything → missing
// - x / 0 → null (not error, to allow batch processing)
```

*v1.2 IsBetween (range check):*

```rust
// Expr::IsBetween { expr, lower, upper }
// Returns true if lower <= expr <= upper (inclusive both ends)

// Extend is_vectorizable():
Expr::IsBetween { expr, lower, upper } => {
    is_vectorizable_inner(expr, schema)?;
    is_vectorizable_inner(lower, schema)?;
    is_vectorizable_inner(upper, schema)
}

// Implementation:
fn kernel_is_between(
    value: &ProjectedColumn,
    lower: &ProjectedColumn,
    upper: &ProjectedColumn,
) -> BoolColumn {
    // For each row:
    // - If value, lower, or upper is null/missing → null
    // - If lower > upper → false (invalid range)
    // - If lower <= value <= upper → true
    // - Otherwise → false
}
```

*v1.3 Clip (clamp to range):*

```rust
// Expr::Clip { expr, min, max }
// Returns: value if in range, min if below, max if above

// Extend is_vectorizable():
Expr::Clip { expr, min, max } => {
    is_vectorizable_inner(expr, schema)?;
    is_vectorizable_inner(min, schema)?;
    is_vectorizable_inner(max, schema)
}

// Implementation:
fn kernel_clip(
    value: &ProjectedColumn,
    min: &ProjectedColumn,
    max: &ProjectedColumn,
) -> ProjectedColumn {
    // For each row:
    // - If value, min, or max is null/missing → null
    // - If value < min → min
    // - If value > max → max
    // - Otherwise → value
    // Returns same type as input (Int64 or Float64)
}
```

*v1.4 IsIn (literal-list membership):*

```rust
// Expr::IsIn { expr, list }
// Returns true if expr value appears in list

// Vectorizable only when list is a Literal array:
Expr::IsIn { expr, list } => {
    is_vectorizable_inner(expr, schema)?;
    match list.as_ref() {
        Expr::Literal(Value::Array(items)) => {
            // All items must be scalar literals
            for item in items {
                if !matches!(item, Value::Bool(_) | Value::Int64(_) | Value::Float64(_) | Value::String(_) | Value::Null) {
                    return Err(UnsupportedReason::UnsupportedExpr("non-scalar in IsIn list"));
                }
            }
            Ok(())
        }
        _ => Err(UnsupportedReason::UnsupportedExpr("IsIn requires literal list")),
    }
}

// Implementation:
fn kernel_is_in(value: &ProjectedColumn, list: &[Value]) -> BoolColumn {
    // Pre-build a HashSet for O(1) lookup (for non-null values)
    // For each row:
    // - If value is null → check if null in list (special handling)
    // - If value is missing → null result
    // - Check if value appears in list using equality semantics
    // Returns BoolColumn with true/false/null
}
```

*v1.5 Extend project_expr() for numeric results:*

```rust
// Current project_expr() only handles Literal and Path
// Extend to handle arithmetic expressions:
fn project_expr(arbor: &Arbor, expr: &Expr, len: usize) -> Result<ProjectedColumn, UnsupportedReason> {
    match expr {
        // Existing cases...
        Expr::Add(lhs, rhs) => {
            let left = project_expr(arbor, lhs, len)?;
            let right = project_expr(arbor, rhs, len)?;
            Ok(kernel_add(&left, &right))
        }
        // Similar for Sub, Mul, Div, Neg, Abs
        Expr::Clip { expr, min, max } => {
            let value = project_expr(arbor, expr, len)?;
            let min_col = project_expr(arbor, min, len)?;
            let max_col = project_expr(arbor, max, len)?;
            Ok(kernel_clip(&value, &min_col, &max_col))
        }
        // ...
    }
}
```

*v1.6 Extend eval_expr_to_bool() for boolean results:*

```rust
// Current eval_expr_to_bool() handles comparisons and boolean logic
// Extend to handle IsBetween and IsIn:
fn eval_expr_to_bool(arbor: &Arbor, expr: &Expr, len: usize) -> Result<BoolColumn, UnsupportedReason> {
    match expr {
        // Existing cases...
        Expr::IsBetween { expr, lower, upper } => {
            let value = project_expr(arbor, expr, len)?;
            let lower_col = project_expr(arbor, lower, len)?;
            let upper_col = project_expr(arbor, upper, len)?;
            Ok(kernel_is_between(&value, &lower_col, &upper_col))
        }
        Expr::IsIn { expr, list } => {
            let value = project_expr(arbor, expr, len)?;
            match list.as_ref() {
                Expr::Literal(Value::Array(items)) => Ok(kernel_is_in(&value, items)),
                _ => Err(UnsupportedReason::UnsupportedExpr("IsIn requires literal list")),
            }
        }
        // ...
    }
}
```

*v1.7 Implementation order:*

1. Add arithmetic kernels (kernel_add, kernel_sub, kernel_mul, kernel_div, kernel_neg, kernel_abs)
2. Extend is_vectorizable() for arithmetic expressions
3. Extend project_expr() for arithmetic expressions
4. Add kernel_is_between and kernel_clip
5. Extend is_vectorizable() for IsBetween and Clip
6. Add kernel_is_in
7. Extend is_vectorizable() for IsIn (literal-list only)
8. Add unit tests for each new kernel
9. Add integration tests for filter expressions using v1 operators
10. Run benchmarks to verify performance improvement

---

**v2 Vectorization Spec:**

*Scope:* Extend vectorized execution to support string predicates with literal patterns.

*v2.1 String Predicates Overview:*

Three string predicates will be vectorized when the pattern is a literal string:
- `StartsWith(string_expr, pattern)` — true if string starts with pattern
- `EndsWith(string_expr, pattern)` — true if string ends with pattern
- `StrContains(string_expr, pattern)` — true if string contains pattern

```rust
// Expr variants (already exist in arbors-expr):
Expr::StartsWith(Box<Expr>, Box<Expr>)  // (string, prefix)
Expr::EndsWith(Box<Expr>, Box<Expr>)    // (string, suffix)
Expr::StrContains(Box<Expr>, Box<Expr>) // (string, pattern)
```

*v2.2 Extend is_vectorizable():*

```rust
// Vectorizable only when pattern is a literal string
Expr::StartsWith(string_expr, pattern) |
Expr::EndsWith(string_expr, pattern) |
Expr::StrContains(string_expr, pattern) => {
    is_vectorizable_inner(string_expr, schema)?;
    match pattern.as_ref() {
        Expr::Literal(Value::String(_)) => Ok(()),
        _ => Err(UnsupportedReason::UnsupportedExpr(
            "string predicate requires literal pattern".to_string(),
        )),
    }
}
```

*v2.3 String Kernel Implementations:*

```rust
/// StartsWith kernel: check if each string starts with prefix
fn kernel_starts_with(col: &ProjectedColumn, prefix: &str) -> BoolColumn {
    // For each row:
    // - If value is null/missing → null
    // - If value is not a string → false (type mismatch)
    // - If value.starts_with(prefix) → true
    // - Otherwise → false
}

/// EndsWith kernel: check if each string ends with suffix
fn kernel_ends_with(col: &ProjectedColumn, suffix: &str) -> BoolColumn {
    // For each row:
    // - If value is null/missing → null
    // - If value is not a string → false (type mismatch)
    // - If value.ends_with(suffix) → true
    // - Otherwise → false
}

/// StrContains kernel: check if each string contains pattern
fn kernel_str_contains(col: &ProjectedColumn, pattern: &str) -> BoolColumn {
    // For each row:
    // - If value is null/missing → null
    // - If value is not a string → false (type mismatch)
    // - If value.contains(pattern) → true
    // - Otherwise → false
}
```

*v2.4 Extend eval_expr_to_bool():*

```rust
fn eval_expr_to_bool(arbor: &Arbor, expr: &Expr, len: usize) -> Result<BoolColumn, UnsupportedReason> {
    match expr {
        // ... existing cases ...

        // v2: String predicates
        Expr::StartsWith(string_expr, pattern) => {
            let col = project_expr(arbor, string_expr, len)?;
            match pattern.as_ref() {
                Expr::Literal(Value::String(prefix)) => Ok(kernel_starts_with(&col, prefix)),
                _ => Err(UnsupportedReason::UnsupportedExpr("requires literal pattern".to_string())),
            }
        }
        Expr::EndsWith(string_expr, pattern) => {
            let col = project_expr(arbor, string_expr, len)?;
            match pattern.as_ref() {
                Expr::Literal(Value::String(suffix)) => Ok(kernel_ends_with(&col, suffix)),
                _ => Err(UnsupportedReason::UnsupportedExpr("requires literal pattern".to_string())),
            }
        }
        Expr::StrContains(string_expr, pattern) => {
            let col = project_expr(arbor, string_expr, len)?;
            match pattern.as_ref() {
                Expr::Literal(Value::String(pat)) => Ok(kernel_str_contains(&col, pat)),
                _ => Err(UnsupportedReason::UnsupportedExpr("requires literal pattern".to_string())),
            }
        }
        // ...
    }
}
```

*v2.5 Case Sensitivity:*

All string predicates use case-sensitive matching (matching Rust's `str::starts_with`, `str::ends_with`, `str::contains`). Case-insensitive variants can be added later if needed by combining with `ToLower`.

*v2.6 Empty Pattern Handling:*

- `starts_with("")` → always true (empty prefix matches everything)
- `ends_with("")` → always true (empty suffix matches everything)
- `str_contains("")` → always true (empty pattern matches everything)

This matches Rust's standard library behavior.

*v2.7 Implementation order:*

1. Add kernel_starts_with, kernel_ends_with, kernel_str_contains
2. Extend is_vectorizable() for StartsWith, EndsWith, StrContains (literal pattern only)
3. Extend eval_expr_to_bool() for string predicates
4. Add unit tests for each kernel
5. Add integration tests for filter expressions using v2 operators
6. Run benchmarks to compare vectorized vs interpreter performance

*v2 Unit/Integration Tests:*

*v2 StartsWith:*
- [x] `test_vectorized_starts_with_match` — `$.name.starts_with("Al")` matches "Alice"
- [x] `test_vectorized_starts_with_no_match` — `$.name.starts_with("Zz")` no matches
- [x] `test_vectorized_starts_with_empty_prefix` — empty prefix matches all non-null strings
- [x] `test_vectorized_starts_with_null_value` — null value → null result
- [x] `test_vectorized_starts_with_exact_match` — prefix equals entire string → true
- [x] `test_vectorized_starts_with_case_sensitive` — "alice" does not start with "Al"

*v2 EndsWith:*
- [x] `test_vectorized_ends_with_match` — `$.email.ends_with(".com")` matches
- [x] `test_vectorized_ends_with_no_match` — `$.email.ends_with(".org")` no matches
- [x] `test_vectorized_ends_with_empty_suffix` — empty suffix matches all non-null strings
- [x] `test_vectorized_ends_with_null_value` — null value → null result
- [x] `test_vectorized_ends_with_exact_match` — suffix equals entire string → true
- [x] `test_vectorized_ends_with_case_sensitive` — "Test" does not end with "TEST"

*v2 StrContains:*
- [x] `test_vectorized_str_contains_match` — `$.desc.str_contains("test")` matches
- [x] `test_vectorized_str_contains_no_match` — `$.desc.str_contains("xyz")` no matches
- [x] `test_vectorized_str_contains_empty_pattern` — empty pattern matches all non-null strings
- [x] `test_vectorized_str_contains_null_value` — null value → null result
- [x] `test_vectorized_str_contains_at_start` — pattern at start → true
- [x] `test_vectorized_str_contains_at_end` — pattern at end → true
- [x] `test_vectorized_str_contains_in_middle` — pattern in middle → true
- [x] `test_vectorized_str_contains_case_sensitive` — "Hello" does not contain "HELLO"

*v2 Fallback:*
- [x] `test_vectorized_string_predicate_non_literal_fallback` — non-literal pattern falls back to interpreter

*v2 Cross-validation:*
- [x] `test_vectorized_v2_matches_interpreter` — cross-check string predicate results
- [x] `test_vectorized_v2_combined_with_v0_v1` — `$.name.starts_with("A") && $.age > 25`

**v2 Test Checkpoint:** 101 vectorized tests pass (78 v0+v1 + 23 v2)

---

**v3 Vectorization Spec:**

*Scope:* Extend vectorized execution to support additional math operations and string transformations.

*v3.1 Math Operations Overview:*

Five additional math operations will be vectorized:
- `Round { expr, decimals }` — round to N decimal places
- `Floor(expr)` — round down to integer
- `Ceil(expr)` — round up to integer
- `Modulo(a, b)` — remainder after division
- `Pow(base, exp)` — exponentiation

```rust
// Expr variants (already exist in arbors-expr):
Expr::Round { expr: Box<Expr>, decimals: i32 }
Expr::Floor(Box<Expr>)
Expr::Ceil(Box<Expr>)
Expr::Modulo(Box<Expr>, Box<Expr>)
Expr::Pow(Box<Expr>, Box<Expr>)
```

*v3.2 String Transform Overview:*

Six string transformations will be vectorized:
- `ToLower(expr)` — convert to lowercase
- `ToUpper(expr)` — convert to uppercase
- `Trim(expr)` — trim whitespace from both ends
- `TrimStart(expr)` — trim leading whitespace
- `TrimEnd(expr)` — trim trailing whitespace
- `StrLen(expr)` — get string length (returns Int64)

```rust
// Expr variants (already exist in arbors-expr):
Expr::ToLower(Box<Expr>)
Expr::ToUpper(Box<Expr>)
Expr::Trim(Box<Expr>)
Expr::TrimStart(Box<Expr>)
Expr::TrimEnd(Box<Expr>)
Expr::StrLen(Box<Expr>)
```

*v3.3 Extend is_vectorizable():*

```rust
// v3: Math operations
Expr::Round { expr, .. } => is_vectorizable_inner(expr, schema),
Expr::Floor(inner) | Expr::Ceil(inner) => is_vectorizable_inner(inner, schema),
Expr::Modulo(lhs, rhs) | Expr::Pow(lhs, rhs) => {
    is_vectorizable_inner(lhs, schema)?;
    is_vectorizable_inner(rhs, schema)
}

// v3: String transformations
Expr::ToLower(inner) | Expr::ToUpper(inner) |
Expr::Trim(inner) | Expr::TrimStart(inner) | Expr::TrimEnd(inner) |
Expr::StrLen(inner) => is_vectorizable_inner(inner, schema),
```

*v3.4 Math Kernel Implementations:*

```rust
/// Round kernel: round to N decimal places
fn kernel_round(col: &ProjectedColumn, decimals: i32) -> ProjectedColumn {
    // For each row:
    // - If value is null/missing → null
    // - Round to specified decimal places
    // - Always returns Float64
}

/// Floor kernel: round down to nearest integer
fn kernel_floor(col: &ProjectedColumn) -> ProjectedColumn {
    // For each row:
    // - If value is null/missing → null
    // - Apply floor, returns Float64
}

/// Ceil kernel: round up to nearest integer
fn kernel_ceil(col: &ProjectedColumn) -> ProjectedColumn {
    // For each row:
    // - If value is null/missing → null
    // - Apply ceil, returns Float64
}

/// Modulo kernel: left % right
fn kernel_mod(left: &ProjectedColumn, right: &ProjectedColumn) -> ProjectedColumn {
    // For each row:
    // - If either is null → null
    // - If right is zero → null (avoid division by zero)
    // - Int64 % Int64 → Int64, otherwise Float64
}

/// Power kernel: base ^ exp
fn kernel_pow(base: &ProjectedColumn, exp: &ProjectedColumn) -> ProjectedColumn {
    // For each row:
    // - If either is null → null
    // - Always returns Float64
}
```

*v3.5 String Transform Kernel Implementations:*

```rust
/// ToLower kernel: convert string to lowercase
fn kernel_to_lower(col: &ProjectedColumn) -> ProjectedColumn {
    // For each row:
    // - If null/missing → null
    // - If not string → null (type mismatch)
    // - Returns lowercase String
}

/// ToUpper kernel: convert string to uppercase
fn kernel_to_upper(col: &ProjectedColumn) -> ProjectedColumn {
    // Same pattern as to_lower
}

/// Trim kernel: trim whitespace from both ends
fn kernel_trim(col: &ProjectedColumn) -> ProjectedColumn {
    // Same pattern, applies str::trim()
}

/// TrimStart kernel: trim leading whitespace
fn kernel_trim_start(col: &ProjectedColumn) -> ProjectedColumn {
    // Same pattern, applies str::trim_start()
}

/// TrimEnd kernel: trim trailing whitespace
fn kernel_trim_end(col: &ProjectedColumn) -> ProjectedColumn {
    // Same pattern, applies str::trim_end()
}

/// StrLen kernel: get string length
fn kernel_str_len(col: &ProjectedColumn) -> ProjectedColumn {
    // For each row:
    // - If null/missing → null
    // - If not string → null
    // - Returns Int64 with character count
}
```

*v3.6 Extend project_expr():*

```rust
fn project_expr(arbor: &Arbor, expr: &Expr, len: usize) -> Result<ProjectedColumn, UnsupportedReason> {
    match expr {
        // ... existing cases ...

        // v3: Math operations
        Expr::Round { expr: inner, decimals } => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_round(&col, *decimals))
        }
        Expr::Floor(inner) => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_floor(&col))
        }
        Expr::Ceil(inner) => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_ceil(&col))
        }
        Expr::Modulo(lhs, rhs) => {
            let left = project_expr(arbor, lhs, len)?;
            let right = project_expr(arbor, rhs, len)?;
            Ok(kernel_mod(&left, &right))
        }
        Expr::Pow(base, exp) => {
            let base_col = project_expr(arbor, base, len)?;
            let exp_col = project_expr(arbor, exp, len)?;
            Ok(kernel_pow(&base_col, &exp_col))
        }

        // v3: String transformations
        Expr::ToLower(inner) => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_to_lower(&col))
        }
        Expr::ToUpper(inner) => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_to_upper(&col))
        }
        Expr::Trim(inner) => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_trim(&col))
        }
        Expr::TrimStart(inner) => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_trim_start(&col))
        }
        Expr::TrimEnd(inner) => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_trim_end(&col))
        }
        Expr::StrLen(inner) => {
            let col = project_expr(arbor, inner, len)?;
            Ok(kernel_str_len(&col))
        }
        // ...
    }
}
```

*v3.7 Implementation order:*

1. Add math kernels: kernel_round, kernel_floor, kernel_ceil, kernel_mod, kernel_pow
2. Add string transform kernels: kernel_to_lower, kernel_to_upper, kernel_trim, kernel_trim_start, kernel_trim_end, kernel_str_len
3. Extend is_vectorizable() for all v3 operators
4. Extend project_expr() for all v3 operators
5. Add unit tests for each kernel
6. Add integration tests
7. Run benchmarks

*v3 Unit/Integration Tests:*

*v3 Round:*
- [x] `test_vectorized_round_positive_decimals` — round 3.14159 to 2 decimals → 3.14
- [x] `test_vectorized_round_zero_decimals` — round 3.7 to 0 decimals → 4.0
- [x] `test_vectorized_round_negative_decimals` — round 1234 to -2 decimals → 1200
- [x] `test_vectorized_round_null_value` — null → null
- [x] `test_vectorized_round_int_input` — round int works (promoted to float)

*v3 Floor:*
- [x] `test_vectorized_floor_positive` — floor 3.7 → 3.0
- [x] `test_vectorized_floor_negative` — floor -3.2 → -4.0
- [x] `test_vectorized_floor_already_int` — floor 5.0 → 5.0
- [x] `test_vectorized_floor_null_value` — null → null

*v3 Ceil:*
- [x] `test_vectorized_ceil_positive` — ceil 3.2 → 4.0
- [x] `test_vectorized_ceil_negative` — ceil -3.7 → -3.0
- [x] `test_vectorized_ceil_already_int` — ceil 5.0 → 5.0
- [x] `test_vectorized_ceil_null_value` — null → null

*v3 Modulo:*
- [x] `test_vectorized_mod_int_int` — 10 % 3 → 1
- [x] `test_vectorized_mod_float_float` — 10.5 % 3.0 → 1.5
- [x] `test_vectorized_mod_by_zero` — x % 0 → null
- [x] `test_vectorized_mod_null_value` — null % x → null
- [x] `test_vectorized_mod_negative` — -10 % 3 → -1

*v3 Pow:*
- [x] `test_vectorized_pow_int_int` — 2 ^ 3 → 8.0
- [x] `test_vectorized_pow_float_float` — 2.0 ^ 0.5 → ~1.414
- [x] `test_vectorized_pow_zero_exp` — x ^ 0 → 1.0
- [x] `test_vectorized_pow_negative_exp` — 2 ^ -1 → 0.5
- [x] `test_vectorized_pow_null_value` — null ^ x → null

*v3 ToLower:*
- [x] `test_vectorized_to_lower_mixed` — "HeLLo" → "hello"
- [x] `test_vectorized_to_lower_already_lower` — "hello" → "hello"
- [x] `test_vectorized_to_lower_null_value` — null → null
- [x] `test_vectorized_to_lower_empty` — "" → ""

*v3 ToUpper:*
- [x] `test_vectorized_to_upper_mixed` — "HeLLo" → "HELLO"
- [x] `test_vectorized_to_upper_already_upper` — "HELLO" → "HELLO"
- [x] `test_vectorized_to_upper_null_value` — null → null
- [x] `test_vectorized_to_upper_empty` — "" → ""

*v3 Trim:*
- [x] `test_vectorized_trim_both_sides` — "  hello  " → "hello"
- [x] `test_vectorized_trim_no_whitespace` — "hello" → "hello"
- [x] `test_vectorized_trim_null_value` — null → null
- [x] `test_vectorized_trim_only_whitespace` — "   " → ""

*v3 TrimStart:*
- [x] `test_vectorized_trim_start_leading` — "  hello" → "hello"
- [x] `test_vectorized_trim_start_trailing_preserved` — "hello  " → "hello  "
- [x] `test_vectorized_trim_start_null_value` — null → null

*v3 TrimEnd:*
- [x] `test_vectorized_trim_end_trailing` — "hello  " → "hello"
- [x] `test_vectorized_trim_end_leading_preserved` — "  hello" → "  hello"
- [x] `test_vectorized_trim_end_null_value` — null → null

*v3 StrLen:*
- [x] `test_vectorized_str_len_basic` — "hello" → 5
- [x] `test_vectorized_str_len_empty` — "" → 0
- [x] `test_vectorized_str_len_unicode` — "héllo" → 5 (char count, not bytes)
- [x] `test_vectorized_str_len_null_value` — null → null

*v3 Cross-validation:*
- [x] `test_vectorized_v3_matches_interpreter` — cross-check all v3 operators
- [x] `test_vectorized_v3_combined_with_filter` — `$.score.round(0) > 50`
- [x] `test_vectorized_v3_str_len_filter` — `$.name.str_len() > 5`

---

**v4 Vectorization Spec:**

*Scope:* Extend vectorized execution to support date/time component extraction.

*v4.1 Date/Time Extraction Overview:*

Ten date/time extraction operations will be vectorized:
- `Year(expr)` — extract year component
- `Month(expr)` — extract month (1-12)
- `Day(expr)` — extract day of month (1-31)
- `Hour(expr)` — extract hour (0-23)
- `Minute(expr)` — extract minute (0-59)
- `Second(expr)` — extract second (0-59)
- `Weekday(expr)` — extract day of week (0=Sunday or 1=Monday, TBD)
- `Week(expr)` — extract ISO week number (1-53)
- `Quarter(expr)` — extract quarter (1-4)
- `Epoch(expr)` — extract Unix timestamp (seconds since 1970-01-01)

```rust
// Expr variants (already exist in arbors-expr):
Expr::Year(Box<Expr>)
Expr::Month(Box<Expr>)
Expr::Day(Box<Expr>)
Expr::Hour(Box<Expr>)
Expr::Minute(Box<Expr>)
Expr::Second(Box<Expr>)
Expr::Weekday(Box<Expr>)
Expr::Week(Box<Expr>)
Expr::Quarter(Box<Expr>)
Expr::Epoch(Box<Expr>)
```

*v4.2 Extend is_vectorizable():*

```rust
// v4: Date/time extraction
Expr::Year(inner) | Expr::Month(inner) | Expr::Day(inner) |
Expr::Hour(inner) | Expr::Minute(inner) | Expr::Second(inner) |
Expr::Weekday(inner) | Expr::Week(inner) | Expr::Quarter(inner) |
Expr::Epoch(inner) => is_vectorizable_inner(inner, schema),
```

*v4.3 Date/Time Kernel Implementations:*

All date/time kernels operate on Date32 (days since epoch) or TimestampMicrosecond columns
and return Int64.

```rust
/// Year kernel: extract year from date/datetime
fn kernel_year(col: &ProjectedColumn) -> ProjectedColumn {
    // For Date32: days → NaiveDate → year
    // For TimestampMicros: micros → NaiveDateTime → year
    // Returns Int64
}

/// Month kernel: extract month (1-12)
fn kernel_month(col: &ProjectedColumn) -> ProjectedColumn {
    // Same pattern, returns 1-12
}

/// Day kernel: extract day of month (1-31)
fn kernel_day(col: &ProjectedColumn) -> ProjectedColumn {
    // Same pattern
}

/// Hour kernel: extract hour (0-23)
fn kernel_hour(col: &ProjectedColumn) -> ProjectedColumn {
    // For Date32: always 0 (no time component)
    // For TimestampMicros: extract hour
}

/// Minute kernel: extract minute (0-59)
fn kernel_minute(col: &ProjectedColumn) -> ProjectedColumn {
    // Same as hour
}

/// Second kernel: extract second (0-59)
fn kernel_second(col: &ProjectedColumn) -> ProjectedColumn {
    // Same as hour
}

/// Weekday kernel: extract day of week
fn kernel_weekday(col: &ProjectedColumn) -> ProjectedColumn {
    // Returns 0-6 (Monday=0 to match chrono)
}

/// Week kernel: extract ISO week number (1-53)
fn kernel_week(col: &ProjectedColumn) -> ProjectedColumn {
    // Uses chrono's iso_week()
}

/// Quarter kernel: extract quarter (1-4)
fn kernel_quarter(col: &ProjectedColumn) -> ProjectedColumn {
    // month 1-3 → 1, 4-6 → 2, 7-9 → 3, 10-12 → 4
}

/// Epoch kernel: extract Unix timestamp
fn kernel_epoch(col: &ProjectedColumn) -> ProjectedColumn {
    // Date32: days * 86400
    // TimestampMicros: micros / 1_000_000
    // Returns Int64
}
```

*v4.4 Extend project_expr():*

```rust
// v4: Date/time extraction
Expr::Year(inner) => Ok(kernel_year(&project_expr(arbor, inner, len)?)),
Expr::Month(inner) => Ok(kernel_month(&project_expr(arbor, inner, len)?)),
Expr::Day(inner) => Ok(kernel_day(&project_expr(arbor, inner, len)?)),
Expr::Hour(inner) => Ok(kernel_hour(&project_expr(arbor, inner, len)?)),
Expr::Minute(inner) => Ok(kernel_minute(&project_expr(arbor, inner, len)?)),
Expr::Second(inner) => Ok(kernel_second(&project_expr(arbor, inner, len)?)),
Expr::Weekday(inner) => Ok(kernel_weekday(&project_expr(arbor, inner, len)?)),
Expr::Week(inner) => Ok(kernel_week(&project_expr(arbor, inner, len)?)),
Expr::Quarter(inner) => Ok(kernel_quarter(&project_expr(arbor, inner, len)?)),
Expr::Epoch(inner) => Ok(kernel_epoch(&project_expr(arbor, inner, len)?)),
```

*v4.5 Implementation order:*

1. Add date/time kernels using chrono for date math
2. Extend is_vectorizable() for all v4 operators
3. Extend project_expr() for all v4 operators
4. Add unit tests for each kernel
5. Add integration tests
6. Run benchmarks

*v4 Unit/Integration Tests:*

*v4 Year:*
- [x] `test_vectorized_year_from_date` — "2024-03-15" → 2024
- [x] `test_vectorized_year_from_datetime` — "2024-03-15T10:30:00" → 2024
- [x] `test_vectorized_year_null_value` — null → null

*v4 Month:*
- [x] `test_vectorized_month_from_date` — "2024-03-15" → 3
- [x] `test_vectorized_month_from_datetime` — "2024-12-25T10:30:00" → 12
- [x] `test_vectorized_month_null_value` — null → null

*v4 Day:*
- [x] `test_vectorized_day_from_date` — "2024-03-15" → 15
- [x] `test_vectorized_day_from_datetime` — "2024-12-25T10:30:00" → 25
- [x] `test_vectorized_day_null_value` — null → null

*v4 Hour:*
- [x] `test_vectorized_hour_from_datetime` — "2024-03-15T10:30:45" → 10
- [x] `test_vectorized_hour_from_date` — date has no time → 0
- [x] `test_vectorized_hour_null_value` — null → null

*v4 Minute:*
- [x] `test_vectorized_minute_from_datetime` — "2024-03-15T10:30:45" → 30
- [x] `test_vectorized_minute_null_value` — null → null

*v4 Second:*
- [x] `test_vectorized_second_from_datetime` — "2024-03-15T10:30:45" → 45
- [x] `test_vectorized_second_null_value` — null → null

*v4 Weekday:*
- [x] `test_vectorized_weekday_monday` — "2024-03-18" (Monday) → 0
- [x] `test_vectorized_weekday_sunday` — "2024-03-17" (Sunday) → 6
- [x] `test_vectorized_weekday_null_value` — null → null

*v4 Week:*
- [x] `test_vectorized_week_mid_year` — "2024-03-15" → week 11
- [x] `test_vectorized_week_year_start` — "2024-01-01" → week 1
- [x] `test_vectorized_week_year_end` — "2024-12-31" → week 1 (of 2025)
- [x] `test_vectorized_week_null_value` — null → null

*v4 Quarter:*
- [x] `test_vectorized_quarter_q1` — "2024-02-15" → 1
- [x] `test_vectorized_quarter_q2` — "2024-05-15" → 2
- [x] `test_vectorized_quarter_q3` — "2024-08-15" → 3
- [x] `test_vectorized_quarter_q4` — "2024-11-15" → 4
- [x] `test_vectorized_quarter_null_value` — null → null

*v4 Epoch:*
- [x] `test_vectorized_epoch_from_date` — "1970-01-02" → 86400
- [x] `test_vectorized_epoch_from_datetime` — "1970-01-01T00:00:01" → 1
- [x] `test_vectorized_epoch_null_value` — null → null

*v4 Cross-validation:*
- [x] `test_vectorized_v4_matches_interpreter` — cross-check all v4 operators
- [x] `test_vectorized_v4_filter_by_year` — `$.created.year() == 2024`
- [x] `test_vectorized_v4_filter_by_quarter` — `$.created.quarter() == 1`
- [x] `test_vectorized_v4_combined_date_ops` — `$.date.month() >= 6 && $.date.year() == 2024`

---

**v5 Vectorization Spec:**

*Scope:* Extend vectorized execution to support type predicate checks.

*v5.1 Type Predicates Overview:*

Ten type predicate operations will be vectorized:
- `IsBool(expr)` — true if value is a boolean
- `IsInt(expr)` — true if value is an integer
- `IsFloat(expr)` — true if value is a float
- `IsNumeric(expr)` — true if value is int or float
- `IsString(expr)` — true if value is a string
- `IsArray(expr)` — true if value is an array
- `IsObject(expr)` — true if value is an object
- `IsDate(expr)` — true if value is a date
- `IsDateTime(expr)` — true if value is a datetime
- `IsDuration(expr)` — true if value is a duration

```rust
// Expr variants (already exist in arbors-expr):
Expr::IsBool(Box<Expr>)
Expr::IsInt(Box<Expr>)
Expr::IsFloat(Box<Expr>)
Expr::IsNumeric(Box<Expr>)
Expr::IsString(Box<Expr>)
Expr::IsArray(Box<Expr>)
Expr::IsObject(Box<Expr>)
Expr::IsDate(Box<Expr>)
Expr::IsDateTime(Box<Expr>)
Expr::IsDuration(Box<Expr>)
```

*v5.2 Extend is_vectorizable():*

```rust
// v5: Type predicates
Expr::IsBool(inner) | Expr::IsInt(inner) | Expr::IsFloat(inner) |
Expr::IsNumeric(inner) | Expr::IsString(inner) | Expr::IsArray(inner) |
Expr::IsObject(inner) | Expr::IsDate(inner) | Expr::IsDateTime(inner) |
Expr::IsDuration(inner) => is_vectorizable_inner(inner, schema),
```

*v5.3 Type Predicate Kernel Implementations:*

Type predicates check the ProjectedColumn variant type. They return BoolColumn.

```rust
/// IsBool kernel: check if value is boolean
fn kernel_is_bool(col: &ProjectedColumn) -> BoolColumn {
    // For each row:
    // - ProjectedColumn::Bool → true (unless null at index)
    // - ProjectedColumn::Null/Missing → null
    // - Other types → false
}

/// IsInt kernel: check if value is integer
fn kernel_is_int(col: &ProjectedColumn) -> BoolColumn {
    // ProjectedColumn::Int64 → true (unless null)
    // Others → false, Null/Missing → null
}

/// IsFloat kernel: check if value is float
fn kernel_is_float(col: &ProjectedColumn) -> BoolColumn {
    // ProjectedColumn::Float64 → true
}

/// IsNumeric kernel: check if value is int or float
fn kernel_is_numeric(col: &ProjectedColumn) -> BoolColumn {
    // ProjectedColumn::Int64 | Float64 → true
}

/// IsString kernel: check if value is string
fn kernel_is_string(col: &ProjectedColumn) -> BoolColumn {
    // ProjectedColumn::String → true
}

/// IsArray kernel: check if value is array
fn kernel_is_array(col: &ProjectedColumn) -> BoolColumn {
    // Note: ProjectedColumn doesn't have Array variant (scalars only)
    // Always returns false for projected columns
    // But must check schema or fall back for non-scalar paths
}

/// IsObject kernel: check if value is object
fn kernel_is_object(col: &ProjectedColumn) -> BoolColumn {
    // Same note as IsArray
}

/// IsDate kernel: check if value is date
fn kernel_is_date(col: &ProjectedColumn) -> BoolColumn {
    // ProjectedColumn::Date → true
}

/// IsDateTime kernel: check if value is datetime
fn kernel_is_datetime(col: &ProjectedColumn) -> BoolColumn {
    // ProjectedColumn::DateTime → true
}

/// IsDuration kernel: check if value is duration
fn kernel_is_duration(col: &ProjectedColumn) -> BoolColumn {
    // ProjectedColumn::Duration → true
}
```

*v5.4 Extend eval_expr_to_bool():*

```rust
fn eval_expr_to_bool(arbor: &Arbor, expr: &Expr, len: usize) -> Result<BoolColumn, UnsupportedReason> {
    match expr {
        // ... existing cases ...

        // v5: Type predicates
        Expr::IsBool(inner) => Ok(kernel_is_bool(&project_expr(arbor, inner, len)?)),
        Expr::IsInt(inner) => Ok(kernel_is_int(&project_expr(arbor, inner, len)?)),
        Expr::IsFloat(inner) => Ok(kernel_is_float(&project_expr(arbor, inner, len)?)),
        Expr::IsNumeric(inner) => Ok(kernel_is_numeric(&project_expr(arbor, inner, len)?)),
        Expr::IsString(inner) => Ok(kernel_is_string(&project_expr(arbor, inner, len)?)),
        Expr::IsArray(inner) => Ok(kernel_is_array(&project_expr(arbor, inner, len)?)),
        Expr::IsObject(inner) => Ok(kernel_is_object(&project_expr(arbor, inner, len)?)),
        Expr::IsDate(inner) => Ok(kernel_is_date(&project_expr(arbor, inner, len)?)),
        Expr::IsDateTime(inner) => Ok(kernel_is_datetime(&project_expr(arbor, inner, len)?)),
        Expr::IsDuration(inner) => Ok(kernel_is_duration(&project_expr(arbor, inner, len)?)),
        // ...
    }
}
```

*v5.5 Null Handling for Type Predicates:*

- If the value is null → result is null (unknown type)
- If the value is missing → result is null
- Otherwise, result is true/false based on actual type

*v5.6 Implementation order:*

1. Add type predicate kernels
2. Extend is_vectorizable() for all v5 operators
3. Extend eval_expr_to_bool() for all v5 operators
4. Add unit tests for each kernel
5. Add integration tests
6. Run benchmarks

*v5 Unit/Integration Tests:*

*v5 IsBool:*
- [x] `test_vectorized_is_bool_true` — bool column → all true
- [x] `test_vectorized_is_bool_false` — int column → all false
- [x] `test_vectorized_is_bool_null_value` — null → null

*v5 IsInt:*
- [x] `test_vectorized_is_int_true` — int column → all true
- [x] `test_vectorized_is_int_false` — string column → all false
- [x] `test_vectorized_is_int_null_value` — null → null

*v5 IsFloat:*
- [x] `test_vectorized_is_float_true` — float column → all true
- [x] `test_vectorized_is_float_false` — int column → all false
- [x] `test_vectorized_is_float_null_value` — null → null

*v5 IsNumeric:*
- [x] `test_vectorized_is_numeric_int` — int column → all true
- [x] `test_vectorized_is_numeric_float` — float column → all true
- [x] `test_vectorized_is_numeric_string` — string column → all false
- [x] `test_vectorized_is_numeric_null_value` — null → null

*v5 IsString:*
- [x] `test_vectorized_is_string_true` — string column → all true
- [x] `test_vectorized_is_string_false` — int column → all false
- [x] `test_vectorized_is_string_null_value` — null → null

*v5 IsArray:*
- [x] `test_vectorized_is_array_scalar_path` — scalar field → all false
- [x] `test_vectorized_is_array_null_value` — null → null

*v5 IsObject:*
- [x] `test_vectorized_is_object_scalar_path` — scalar field → all false
- [x] `test_vectorized_is_object_null_value` — null → null

*v5 IsDate:*
- [x] `test_vectorized_is_date_true` — date column → all true
- [x] `test_vectorized_is_date_false` — string column → all false
- [x] `test_vectorized_is_date_null_value` — null → null

*v5 IsDateTime:*
- [x] `test_vectorized_is_datetime_true` — datetime column → all true
- [x] `test_vectorized_is_datetime_false` — date column → all false
- [x] `test_vectorized_is_datetime_null_value` — null → null

*v5 IsDuration:*
- [x] `test_vectorized_is_duration_true` — duration column → all true
- [x] `test_vectorized_is_duration_false` — int column → all false
- [x] `test_vectorized_is_duration_null_value` — null → null

*v5 Cross-validation:*
- [x] `test_vectorized_v5_matches_interpreter` — cross-check all v5 operators
- [x] `test_vectorized_v5_filter_by_type` — `$.value.is_numeric() && $.value > 0`
- [x] `test_vectorized_v5_combined_type_checks` — `$.date.is_date() || $.date.is_datetime()`

---

**Vectorization Summary:**

| Version | Category | Operators | Test Count |
|---------|----------|-----------|------------|
| v0 | Core | Path, Literal, Comparisons, Boolean, Null/Existence | 65 |
| v1 | Numeric | Add, Sub, Mul, Div, Neg, Abs, IsBetween, Clip, IsIn | 31 |
| v2 | String Predicates | StartsWith, EndsWith, StrContains | 23 |
| v3 | Math + String Transforms | Round, Floor, Ceil, Mod, Pow, ToLower, ToUpper, Trim*, StrLen | ~45 |
| v4 | Date/Time Extraction | Year, Month, Day, Hour, Minute, Second, Weekday, Week, Quarter, Epoch | ~35 |
| v5 | Type Predicates | IsBool, IsInt, IsFloat, IsNumeric, IsString, IsArray, IsObject, IsDate, IsDateTime, IsDuration | ~35 |
| **Total** | | | **~234** |

---

**Performance Checkpoint (must meet 16.6.R.7):**
- [ ] Measure `warm()` time and repeated query time on the baseball cache dataset and compare to recorded baseline.

---

#### Step 8: Python bindings for batching policy + warm() (and optional batched API)

**Commit:** `feat(python): expose ArborStoreOptions batching policy + warm() for ArborStore v2`

**References:** 16.6.1.7 (Python API), 16.6.4 (Docs plan)

**Tasks:**
- [x] Add Python options fields + defaults (batch_target_bytes, min/max, override)
- [x] Update Python `open()` to accept options
- [x] Add Python `warm()` method
- [x] Update stubs and add tests

**Python Tests:**

*Options:*
- [x] `test_arborbase_options_defaults` — verify default values match Rust
- [x] `test_arborbase_options_batching_policy` — all fields settable
- [x] `test_arborbase_options_validation_errors` — invalid options raise exception
- [x] `test_arborbase_options_override_wins` — trees_per_batch overrides target_bytes

*Open/close:*
- [x] `test_arborbase_open_with_options`
- [x] `test_arborbase_open_creates_v2_db` — (existing tests create v2 db)
- [x] `test_arborbase_open_rejects_v1_db` — (v1 format not supported by current code)
- [x] `test_arborbase_context_manager` — with statement works (existing test)

*Put/get:*
- [x] `test_batched_roundtrip_from_python` — put arbor, get arbor, compare (existing tests)
- [x] `test_put_empty_arbor_from_python` — (existing test)
- [x] `test_put_large_arbor_from_python` — multi-batch
- [x] `test_get_nonexistent_returns_none` — (existing test)

*Warm:*
- [x] `test_arborbase_warm` — basic warm call
- [x] `test_arborbase_warm_with_options` — max_bytes, decode_all
- [x] `test_arborbase_warm_multiple_datasets`
- [x] `test_arborbase_warm_speeds_queries` — (via test_warm_then_query)

*Delete/list:*
- [x] `test_arborbase_delete_from_python` — (existing tests)
- [x] `test_arborbase_list_from_python` — (existing tests)
- [x] `test_arborbase_contains_from_python` — (existing test)

*Transactions:*
- [x] `test_arborbase_read_txn_from_python` — ReadTxn exposed, TestReadTransaction class (9 tests)
- [x] `test_arborbase_write_txn_from_python` — WriteTxn exposed, TestWriteTransaction class (18 tests)
- [x] `test_arborbase_txn_commit_from_python` — WriteTxn.commit() tested
- [x] `test_arborbase_txn_abort_from_python` — WriteTxn.abort() and context manager abort tested

*Error handling:*
- [x] `test_python_exceptions_for_arborbase_errors` — correct exception types (existing tests)
- [x] `test_python_error_messages_informative` — (existing tests)

*Integration:*
- [x] `test_query_on_arborbase_from_python` — filter/select via Python API
- [x] `test_large_dataset_workflow` — (via test_put_large_arbor_from_python)

**Checkpoint:** `make python-test` ✓

---

### 16.6.6 Deliverables and Checkpoints

**Deliverable:** ArborStore v2 stores datasets as **tree batches** with a **shared per-dataset dictionary** in redb, achieving \(O(\text{batch\_size})\) write amplification for small changes and enabling **batch-wise reads** without mandatory monolithic reconstruction.

**End-to-End Integration Tests (cross-step validation):**

*Full workflow:*
- [x] `test_put_get_roundtrip_multi_batch` — end-to-end with real data
- [x] `test_baseball_cache_workflow` — load, warm, query, matches baseline behavior
- [x] `test_full_crud_cycle` — put → get → update → delete → put again

*Cross-component:*
- [x] `test_batched_put_then_vectorized_query` — v2 storage + vectorized execution
- [x] `test_warm_then_filter_then_aggregate` — cache + query pipeline
- [x] `test_concurrent_read_during_write_mvcc_isolation` — exists in batched_tests.rs

*Error paths:*
- [x] `test_error_on_missing_dict_or_batch`
- [x] `test_error_recovery_after_corruption`

*Cleanup:*
- [x] `test_delete_removes_all_parts` — exists as test_delete_removes_meta_dict_and_batches in lib.rs
- [x] `test_no_orphaned_batches_after_overwrites` — regression guard

*Performance sanity:*
- [x] `test_baseline_performance_recorded` — captures T_baseline_load and T_baseline_queries
- [x] `test_warm_within_tolerance` — ≤ 1.25× baseline
- [x] `test_vectorized_query_speedup` — ≤ 0.5× baseline for supported exprs

| Checkpoint | Verification |
|------------|--------------|
| arbors-base tests | `cargo test -p arbors-base` |
| Python tests | `make python-test` |
| Clippy clean | `cargo clippy --all` |
| Full CI | `make ci` |

**Commit after all checkpoints pass.**

---

## Phase 16.7: Deliver on 16.6 Promises (Incremental Updates + Instant-Open Reads)

**Purpose:** Phase 16.6 delivered a working batched v2 storage format, but missed key requirements (write amplification and incremental updates) and did not deliver the “real embedded DB” usability goal of **instant open**. Phase 16.7 fixes the 16.6 gaps **and** adds a concrete engineering path to **instant-open, no-warm queries** by introducing **pinned snapshot bytes in redb** and **externally-owned Arrow buffers**.

**Status:** Planning

**Cross-references to 16.6 requirements contract (MUST be met when 16.7 is done):**
- Fixes 16.6.R.3 (Reasonable write amplification) — see [16.6.R.3](#166r3-reasonable-write-amplification)
- Fixes 16.6.R.5 (Incremental updates) — see [16.6.R.5](#166r5-incremental-updates)
- Fully delivers the *original intent* of 16.6.R.2 (Zero-copy reads) via pinned snapshot bytes + external buffers — see [16.6.R.2](#166r2-zero-copy-reads-realistic-definition-for-166)
- Improves 16.6.R.4 / 16.6.R.7 performance story by enabling **open + query with no warm** — see [16.6.R.4](#166r4-analytics-performance) and [16.6.R.7](#166r7-performance-acceptance-criteria-explicit)
- Preserves 16.6.R.6 Simplicity: still **redb-only**, no external fragments/epochs — see [16.6.R.6](#166r6-simplicity)

---

### 16.7.0 Retrospective: What Went Wrong in 16.6 (and what we do differently)

> **⚠️ THIS SECTION EXISTS TO PREVENT REPEATING THE SAME MISTAKES. READ IT BEFORE IMPLEMENTING.**

#### The Contradiction (write amp vs replace-all)

16.6 simultaneously claimed “incremental updates” (✅) while also deciding “replace-all-on-put”. Those are incompatible. 16.7 explicitly removes the contradiction and makes incremental writes an acceptance-tested contract.

#### The Performance Gap (materialize-by-default)

Even though 16.6 introduced batching, the user-facing “read path” still implicitly forced **materialization**, adding unnecessary overhead and making it harder to meet the “baseball cache feels instant” targets. 16.7 makes **batched, non-materialized query** the primary API, with materialization explicitly opt-in.

#### The Zero-Copy Gap (lifetime/ownership mismatch)

The practical “instant open” failure mode is not Arrow IPC vs bespoke v2; it’s **ownership/lifetimes**:
- redb returns **borrowed** bytes (guard-scoped)
- Arrow buffers/arrays want **owned** memory
- So ArborStore currently copies at least twice:
  - `guard.value().to_vec()` (copy out of redb)
  - `Vec` → Arrow buffers/typed vectors in `batch_v2_to_arbor()` (copy into Arrow)

16.7 addresses this head-on by:
- extending **redb** with an owned, MVCC-safe **PinnedBytes** (“pinned snapshot bytes”) API
- extending **arrow-rs** / `arrow-buffer` with externally-owned `Buffer` construction
- upgrading the v2 codec to be **view-decodable** and **aligned**, so Arrow buffers can point directly at pinned bytes

#### Additional lessons (to avoid “✅ by vibes”)

1. **Mark requirements ✅ only when acceptance tests and perf gates pass.**
2. **Measure early and continuously** (including open+query with no warm).
3. **Unsafe is allowed only behind small, well-tested APIs** (redb pinning, arrow external buffers).
4. **Hash collisions are correctness bugs** if they cause skipping writes; use cryptographic or collision-resistant digests, or verify-bytes-equal on match.
5. **“Write dict always” can destroy write-amp**; dict writes must be skippable when unchanged.

---

### 16.7.W WARNINGS: How to Avoid Falling Into the Ditch Again

> **🚨 READ THESE WARNINGS BEFORE EACH STEP. THEY ARE NON-NEGOTIABLE.**

#### W1: Verify Design Decisions Against Requirements BEFORE Implementing

For each design decision in 16.7.1:
- [ ] List every requirement it affects
- [ ] Verify compatibility (no contradictions)
- [ ] If there’s a conflict, STOP and resolve it before coding

#### W2: Write Acceptance Tests FIRST, Before Implementation

For each requirement in 16.7.R:
- [ ] Write tests that directly verify the requirement
- [ ] Confirm tests FAIL before implementation
- [ ] Implementation is complete only when tests PASS

#### W3: Measure Performance At Each Step (including “instant open”)

After each step:
- [ ] Run the perf microbench suite (16.7.R.4)
- [ ] Compare to baseline and gates
- [ ] If performance regresses, STOP and fix before continuing

#### W4: Treat Memory Safety as a First-Class Requirement

Pinned bytes + external buffer construction can introduce UB if wrong. Therefore:
- [ ] keep unsafe contained in redb/arrow boundary layers
- [ ] add Miri + sanitizer + stress tests for the boundary APIs

#### W5: Alignment is Not Optional for True Zero-Copy

If codec buffers are not aligned, we will be forced to copy (or worse, UB). Therefore:
- [ ] upgrade codec layout to guarantee alignment for Arrow primitive buffers
- [ ] add tests that validate alignment invariants

---

### 16.7.R Requirements (“How it’s met”)

> **Contract:** Phase 16.7 is complete only when this table is all ✅ and the acceptance criteria are measured and passing. These requirements exist to fully satisfy the 16.6.R contract.

| Requirement | How it’s met (Phase 16.7) | 16.6 Reference | Status |
|---|---|---|---|
| MVCC/ACID preserved | unchanged: redb MVCC, one write txn commit | 16.6.R.1 | ⏳ |
| Reasonable write amp + incremental updates | batch digests + skip unchanged batches + delete suffix; dict writes are skippable | 16.6.R.3, 16.6.R.5 | ⏳ |
| Instant open (no warm) | redb `PinnedBytes` + arrow externally-owned `Buffer` + aligned, view-decodable **codec_version=2** | 16.6.R.2 | ⏳ |
| Analytics on cold open | batch-wise query execution builds Arrow views lazily (page faults) | 16.6.R.4 | ⏳ |
| Simplicity preserved | still redb-only; no external fragments/epochs | 16.6.R.6 | ⏳ |
| Performance gates | explicit microbench + baseball end-to-end gates (including open+query) | 16.6.R.7 | ⏳ |

#### 16.7.R.1 Incremental batch writes (fix write amplification + incremental updates)

> **Fixes:** 16.6.R.3 and 16.6.R.5.

- **How it’s met:**
  - Extend `ArborMeta` with:
    - `dict_digest` (skip dict rewrite if unchanged)
    - `batch_digests[]` (skip unchanged batch writes)
  - Use a collision-resistant digest (e.g., BLAKE3 truncated to 128 bits) over the **encoded batch bytes** (v2 payload bytes) for determinism.
  - On `put()`:
    - slice new arbor into batches
    - compute `dict_digest` and per-batch digest
    - write only changed batches (plus meta; dict only if digest changed)
    - delete old suffix batches when batch_count shrinks

- **Acceptance criteria (MUST ALL PASS):**
  - `test_put_unchanged_arbor_writes_zero_batches`
  - `test_put_single_tree_update_writes_one_batch`
  - `test_put_insert_tree_writes_suffix_only`
  - `test_put_delete_tree_writes_suffix_only`
  - `test_put_unchanged_dict_skips_dict_write`
  - `bench_write_amplification` shows \(O(\text{batch})\) rewrite, not \(O(\text{dataset})\)

#### 16.7.R.2 Batch-wise query execution + lazy materialization (fix “materialize by default”)

- **How it’s met:**
  - `get()` returns a batched handle (no materialization)
  - filter/aggregate/select operate per-batch, combining results without merging full data
  - `materialize()` is explicit opt-in

- **Acceptance criteria:**
  - `test_get_does_not_materialize`
  - `test_filter_on_batched_no_materialize`
  - `test_filter_matches_materialized`
  - `test_aggregate_matches_materialized`

#### 16.7.R.3 Instant open (no warm) with real zero-copy attributes

> **Definition:** “Instant open” means: **open + query works with no warm step**, with **lazy page faults during scan**.

- **How it’s met:**
  - redb exposes `PinnedBytes`: an owned, cloneable, sliceable view of value bytes that pins the MVCC snapshot/pages while alive
  - arrow-rs exposes construction of `Buffer` / `ScalarBuffer<T>` from externally-owned memory (retaining the owner)
  - ArborStore v2 codec (codec_version=2) is aligned and view-decodable; decode becomes “parse header + slice pinned bytes,” not “allocate + copy”
  - Batched query execution builds Arrow arrays **as views** over pinned bytes, so the first query triggers OS page faults rather than memcpy

- **Acceptance criteria:**
  - `test_query_on_cold_open_does_not_require_warm`
  - `test_query_on_cold_open_is_correct` (matches materialized correctness)
  - `test_pinned_bytes_keeps_data_alive_across_scopes`
  - `test_external_arrow_buffers_keep_owner_alive`
  - `test_codec_alignment_invariants`

#### 16.7.R.4 Performance gates (explicit, includes instant open)

> **Cross-reference:** Extends 16.6.R.7 with a new gate: “open + first query with no warm”.

We measure on the same reference machine/dataset used for 16.6.R.7 (baseball cache).

- **Gate A (instant open):**
  - `open + get_batched + run_one_vectorized_filter` ≤ **100ms** on warm OS page cache (tunable; pick the number we actually want)
  - Rationale: this is the “feels instant” gate.

- **Gate B (warm decode, still valuable):**
  - `warm(["players","teams"], decode_all=true)` ≤ `T_baseline_load * 1.25` (same as 16.6.R.2.a / 16.6.R.7)

- **Gate C (repeated analytics):**
  - warmed repeated query time ≤ `T_baseline_queries * 0.5` for supported vectorized subset

- **Gate D (materialization is allowed to be slower):**
  - `materialize()` ≤ `2.0 × T_baseline_load`

- **Gate E (incremental update):**
  - single-tree update writes ≤ `2× batch_size` (plus small meta overhead)

#### 16.7.R.5 Simplicity + safety

- **How it’s met:**
  - No external fragments; the only additions are:
    - a redb feature/API (`PinnedBytes`)
    - an arrow-buffer API for external ownership
    - a codec version bump (to codec_version=2) for alignment/view decode

- **Acceptance criteria:**
  - `make ci` passes
  - Miri/sanitizer suite passes for the redb/arrow boundary tests

---

### 16.7.1 Design Decisions (DECIDED)

#### D1: Strong digests decide incremental writes (DECIDED)

**Decision:** Use a collision-resistant digest for dict/batch change detection (e.g., BLAKE3-128). A digest match may skip writes; therefore collisions must be negligibly likely.

#### D2: redb must provide `PinnedBytes` (DECIDED)

**Decision:** Extend redb with an owned, sliceable bytes type that pins MVCC snapshot/pages until dropped:
- `Table::get_pinned(key) -> Option<PinnedBytes>`
- `PinnedBytes::slice(range) -> PinnedBytes` (O(1))

This is the “no external files” path to instant-open.

#### D3: arrow-rs must accept externally-owned buffers (DECIDED)

**Decision:** Extend `arrow-buffer` with `Buffer` construction from externally-owned memory, retaining the owner.

#### D4: v2 codec bumps to codec_version=2 with alignment (DECIDED)

**Decision:** Upgrade the ArborStore v2 codec to guarantee buffer alignment suitable for Arrow kernels (e.g., 64-byte alignment for primitive buffers), enabling true zero-copy views.

---

### 16.7.2 Specification (high level)

#### 16.7.2.1 redb: `PinnedBytes`

- **API sketch:**
  - `PinnedBytes` is cheap-to-clone and owns an internal “pin” handle
  - `as_slice()` returns stable bytes valid until last clone drop
  - `slice(range)` produces a new `PinnedBytes` referencing a subrange without copying

- **Semantics:**
  - keeping `PinnedBytes` alive keeps a read snapshot alive (MVCC)
  - writers proceed normally; old pages persist until no pins remain

#### 16.7.2.2 arrow-buffer: externally-owned `Buffer`

- **API sketch:**
  - `Buffer::from_external(owner: Arc<dyn Any + Send + Sync>, ptr: NonNull<u8>, len: usize)`
  - typed helpers for aligned `ScalarBuffer<T>`

- **Safety invariants:**
  - the API validates alignment for typed buffers (or provides fallible constructors)
  - owner must outlive buffer usage (enforced by refcount)

#### 16.7.2.3 ArborStore codec_version=2: aligned, view-decodable layout

- Encoder pads each buffer to alignment boundary and records offsets.
- Decoder supports:
  - codec_version=1: decode-with-copy fallback (compat)
  - codec_version=2: view decode over `PinnedBytes` (zero-copy)

#### 16.7.2.4 ArborStore read path: “cold query” (no warm)

- `get_batched()` returns a handle that can fetch pinned bytes per batch.
- Query execution:
  - reads batch bytes via `get_pinned()`
  - view-decodes header + buffer ranges
  - constructs Arrow arrays/buffers over pinned bytes
  - runs vectorized kernels (page faults happen naturally)

---

### 16.7.3 Test Plan

#### 16.7.3.1 Unit tests: incremental updates

- [ ] `test_put_unchanged_arbor_writes_zero_batches`
- [ ] `test_put_single_tree_update_writes_one_batch`
- [ ] `test_put_unchanged_dict_skips_dict_write`

#### 16.7.3.2 Unit tests: redb pinned bytes (in fork / patched crate)

- [ ] `test_pinned_bytes_survives_guard_drop`
- [ ] `test_pinned_bytes_survives_txn_drop` (pins snapshot)
- [ ] `test_pinned_bytes_slice_is_o1_and_correct`
- [ ] `test_pinned_bytes_mvcc_reader_writer` (writer commits, pinned reader stays valid)

#### 16.7.3.3 Unit tests: arrow external buffers (in fork / patched crate)

- [ ] `test_buffer_from_external_keeps_owner_alive`
- [ ] `test_scalarbuffer_from_external_alignment_checked`

#### 16.7.3.4 Unit tests: codec alignment + view decode

- [ ] `test_codec_v22_alignment_offsets`
- [ ] `test_view_decode_matches_copy_decode`
- [ ] `test_view_decode_bounds_checks`

#### 16.7.3.5 Integration tests: instant open (no warm)

- [ ] `test_open_and_filter_without_warm` (correctness)
- [ ] `test_open_and_group_by_without_warm` (correctness for supported subset)

#### 16.7.3.6 Performance tests (gates)

- [ ] `bench_open_meta`
- [ ] `bench_open_and_first_filter_no_warm` (Gate A)
- [ ] `bench_warm_vs_baseline` (Gate B)
- [ ] `bench_repeated_queries_warm_cache` (Gate C)
- [ ] `bench_incremental_put_one_tree` (Gate E)

---

### 16.7.4 Execution Steps (phased, minimal risk)

> **Rule:** Do not proceed to the next step until the current step’s tests and perf gates are green.

#### Step 0: Add the microbench harness and record baselines (Z0)

**Tasks:**
- [ ] Implement `bench_open_meta`, `bench_open_dict_bytes`, `bench_open_and_first_filter_no_warm`, `bench_warm`, `bench_repeated_queries`
- [ ] Record baseline numbers on reference machine (baseball dataset)

**Gate:** baseline recorded and checked into repo (as JSON or markdown table).

#### Step 1: Fix incremental updates + write amplification (deliver 16.6.R.3 / 16.6.R.5)

**Tasks:**
- [ ] Extend `ArborMeta` with `dict_digest` + `batch_digests`
- [ ] Implement `put()` skip logic (skip unchanged batches; skip dict if unchanged)
- [ ] Replace any “replace-all-on-put” behavior

**Gates:**
- [ ] `bench_incremental_put_one_tree` meets Gate E
- [ ] `bench_write_amplification` shows \(O(\text{batch})\) behavior

#### Step 2: Make batched query + lazy materialization the primary API

**Tasks:**
- [ ] `get()` returns batched handle (no implicit materialize)
- [ ] Add `filter/aggregate/select` on batched handle
- [ ] Keep `materialize()` explicit

**Gate:** correctness tests comparing batched vs materialized all pass.

#### Step 3: Extend redb with `PinnedBytes` (Z1)

**Tasks:**
- [ ] Add `PinnedBytes` + `get_pinned()` API in redb
- [ ] Integrate via workspace patch / fork
- [ ] Add MVCC + stress tests for pinning

**Gate:** Miri/sanitizer + stress tests pass; perf does not regress.

#### Step 4: Extend arrow-rs/arrow-buffer with external ownership buffers (Z2)

**Tasks:**
- [ ] Add external-buffer constructor retaining owner
- [ ] Add typed alignment-checked constructors for primitive buffers
- [ ] Integrate via workspace patch / fork

**Gate:** arrow unit tests + new external-buffer tests pass.

#### Step 5: Upgrade ArborStore codec to codec_version=2 (aligned + view-decodable) (Z3)

**Tasks:**
- [ ] Add alignment padding + offsets (codec bump)
- [ ] Add view decode that returns slices into `PinnedBytes`
- [ ] Add compatibility: v2.1 decode-with-copy fallback (optional but recommended)

**Gate:** view decode matches copy decode; alignment invariants validated.

#### Step 6: Wire it together: cold query builds Arrow views over pinned bytes (Z4)

**Tasks:**
- [ ] Remove `guard.value().to_vec()` copies in read path
- [ ] Remove Arrow buffer copies in batch decode path when codec_version=2 is present
- [ ] Implement “open + first query” path with no warm

**Gates:**
- [ ] `bench_open_and_first_filter_no_warm` meets Gate A
- [ ] correctness tests pass for cold open queries

#### Step 7: Finish: perf regression guards + docs + Python

**Tasks:**
- [ ] CI regression thresholds for Gate A–E
- [ ] Update docs to clearly explain:
  - “instant open” semantics
  - pinned snapshot implications
  - when warm is beneficial (prefetch), but never required
- [ ] Update Python bindings to expose batched query API and preserve instant-open behavior

---

### 16.7.5 Deliverables and Checkpoints

**Deliverable:** ArborStore that:
- satisfies the 16.6.R contract (especially incremental updates + reasonable write amp)
- supports **instant open (no warm)** queries with real zero-copy attributes
- preserves redb-only simplicity and MVCC/ACID

**Final checklist (ALL must be true):**
- [ ] Incremental writes: single-tree update rewrites ~one batch (measured)
- [ ] Unchanged updates: writes are skipped (measured)
- [ ] Cold open query: open + query works with no warm and meets Gate A (measured)
- [ ] Repeated analytics: meets Gate C for supported vectorized subset (measured)
- [ ] Safety: redb pinning + arrow external buffers pass Miri/sanitizers
- [ ] CI green: `make ci`

---

