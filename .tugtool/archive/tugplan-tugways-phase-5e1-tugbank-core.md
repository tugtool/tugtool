<!-- tugplan-skeleton v2 -->

## Tugways Phase 5e1: Tugbank-Core Library Crate {#phase-5e1-tugbank-core}

**Purpose:** Build a standalone SQLite-backed typed defaults store library crate (`tugbank-core`) with domain separation, CAS concurrency, 10 MB blob enforcement, and full test coverage -- providing the persistence foundation for phases 5e2 through 5f.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5e1-tugbank-core |
| Last updated | 2026-03-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugways design system needs durable, typed, domain-separated persistence for user preferences, card layout, tab state, and future state-heavy features. The current flat-file settings backend (`settings-api.ts` backed by a flat JSON file) cannot support granular per-key writes, typed values, or concurrent access. Tugbank is a SQLite-backed defaults store modeled after Apple's `UserDefaults`, and `tugbank-core` is its foundational library crate.

Phase 5e1 is the first of four sub-phases (5e1-5e4) that incrementally deliver the tugbank system. This phase produces a pure Rust library with no async dependencies, no CLI, and no HTTP integration -- just the core storage engine that all downstream phases depend on.

#### Strategy {#strategy}

- Build a standalone library crate at `tugcode/crates/tugbank-core/` with no dependencies on other internal crates
- Use `rusqlite` (already a workspace dependency with `bundled` feature) for SQLite access
- Wrap the `Connection` in `std::sync::Mutex` for `Send+Sync`, enabling safe sharing across threads
- Implement the three-table schema (meta, domains, entries) from the tugbank proposal with WAL mode and busy_timeout=5000ms
- Deliver CAS concurrency via generation counters on the domains table, with `set_if_generation` and transactional `update` methods
- Enforce the 10 MB blob size limit at the API boundary before any SQLite call
- Write comprehensive unit and integration tests covering value roundtrip, CAS conflict detection, blob enforcement, and multi-thread writer contention

#### Success Criteria (Measurable) {#success-criteria}

- All seven `Value` variants (Null, Bool, I64, F64, String, Bytes, Json) round-trip correctly through SQLite typed columns (verified by unit tests)
- CAS conflict detection works: concurrent writers with stale generations receive `Conflict` errors (verified by contention test)
- Blob size enforcement rejects `Value::Bytes` payloads exceeding 10 MB with `ValueTooLarge` error (verified by unit test)
- `cargo nextest run -p tugbank-core` passes with zero failures and zero warnings
- `DefaultsStore` is `Send + Sync` (verified by compile-time assertion)

#### Scope {#scope}

1. New library crate `tugbank-core` with Cargo.toml and workspace membership
2. SQLite schema bootstrap (meta, domains, entries tables) with WAL mode and pragmas
3. `Value` enum with seven variants and SQL column mapping
4. `DefaultsStore` struct: open/create database, schema versioning, domain listing
5. `DomainHandle` struct: get/set/remove, read_all, keys, generation, set_if_generation, update with DomainTxn
6. `DomainTxn` struct: write-only transaction surface (set, remove)
7. Error enum with all variant types from the proposal
8. Unit tests for value encoding, domain CRUD, CAS, blob limits
9. Integration test for multi-thread writer contention

#### Non-goals (Explicitly out of scope) {#non-goals}

- CLI binary (phase 5e2)
- HTTP bridge endpoints or async integration (phase 5e3)
- Settings migration from flat file (phase 5e4)
- Watch/notify API for value changes
- iCloud/sync/replication
- Rich query language beyond key-value access

#### Dependencies / Prerequisites {#dependencies}

- `rusqlite` workspace dependency with `bundled` feature (already present in `tugcode/Cargo.toml`)
- `serde` and `serde_json` workspace dependencies (already present)
- `thiserror` workspace dependency (already present)
- `tempfile` workspace dependency for tests (already present)

#### Constraints {#constraints}

- Pure synchronous library -- no async runtime dependency
- Warnings are errors (`-D warnings` enforced by `.cargo/config.toml`)
- Must be `Send + Sync` via `Mutex<Connection>` wrapping
- `synchronous = NORMAL` pragma for faster writes (acceptable for user preferences)

#### Assumptions {#assumptions}

- The crate lives at `tugcode/crates/tugbank-core/` and is added to workspace members
- No new workspace-level Cargo.toml additions beyond adding tugbank-core to members and the internal path dependency
- Schema versioning uses the meta table with key `schema_version` set to `1` on bootstrap, with migration logic on open
- WAL mode and busy_timeout=5000ms are applied unconditionally on every database open
- The multi-thread contention test uses `std::thread` with separate `rusqlite` connections to the same file, not a separate helper binary

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors on all headings and artifacts that are referenced by execution steps. See the skeleton for full anchor and reference rules.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions remain. All four clarifying questions were resolved via user answers:

- Send model: `Mutex<Connection>` (see [D01])
- Sync pragma: `NORMAL` (see [D02])
- DomainTxn API: write-only set/remove (see [D03])
- Contention test: multi-thread with std::thread (see [D06])

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| SQLite busy contention under heavy writes | med | low | busy_timeout=5000ms; CAS retry pattern documented | If phase 5e3 integration shows timeout errors under normal load |
| Schema migration breaks existing databases | high | low | Schema version check on open; migrations are additive and transactional | If schema_version > 1 is needed in a future phase |

**Risk R01: SQLite Busy Contention** {#r01-busy-contention}

- **Risk:** Under heavy concurrent writes, SQLite's single-writer model may cause `SQLITE_BUSY` even with WAL mode and busy_timeout.
- **Mitigation:**
  - WAL mode allows concurrent readers with a single writer
  - busy_timeout=5000ms gives the writer lock time to release
  - CAS model means callers already handle conflict/retry
- **Residual risk:** True high-frequency multi-process writes may still hit timeouts; acceptable for a preferences store.

**Risk R02: Schema Migration Correctness** {#r02-schema-migration}

- **Risk:** Future schema changes could corrupt existing databases if migration logic has bugs.
- **Mitigation:**
  - Migrations run inside a transaction (rollback on failure)
  - Schema version is checked on every open
  - v1 is the only version in this phase; migration path is tested but exercised only in future phases
- **Residual risk:** Migration logic is only fully exercised when v2 is introduced.

---

### Design Decisions {#design-decisions}

#### [D01] DefaultsStore uses Mutex\<Connection\> for Send+Sync (DECIDED) {#d01-mutex-connection}

**Decision:** Wrap the `rusqlite::Connection` in `std::sync::Mutex`, making `DefaultsStore` `Send + Sync`. Callers acquire the lock, do synchronous SQLite work, and release.

**Rationale:**
- Simple and correct -- no need for connection pooling for a preferences store
- `Mutex` makes `DefaultsStore` `Send + Sync` without requiring `rusqlite` feature flags
- The `Mutex` is internal; callers see a `&self` API

**Implications:**
- All `DomainHandle` methods take `&self` and lock the mutex internally
- No parallel SQLite operations within a single `DefaultsStore` instance (acceptable for this use case)
- Phase 5e3 async integration wraps calls in `spawn_blocking`

#### [D02] Synchronous pragma set to NORMAL (DECIDED) {#d02-sync-normal}

**Decision:** Use `PRAGMA synchronous = NORMAL` for faster writes. Data loss occurs only on OS crash (not SQLite crash), which is acceptable for user preferences.

**Rationale:**
- Faster than FULL (fewer fsync calls)
- Risk is data loss only on power failure or OS crash, not on application crash
- User preferences are not mission-critical data

**Implications:**
- Set unconditionally on every database open alongside WAL mode and busy_timeout

#### [D03] DomainTxn is write-only with set and remove (DECIDED) {#d03-txn-write-only}

**Decision:** `DomainTxn` exposes only `set()` and `remove()` methods. Callers read current values via `DomainHandle` before calling `update()`.

**Rationale:**
- Keeps the transaction surface minimal
- Reads before the transaction are consistent because the `update()` method holds the mutex and uses `BEGIN IMMEDIATE` with CAS
- Simpler implementation and API

**Implications:**
- `DomainTxn` accumulates mutations in a `Vec` and applies them inside the SQL transaction
- No read methods on `DomainTxn`

#### [D04] Value enum has seven variants with typed SQL columns (DECIDED) {#d04-value-enum}

**Decision:** The `Value` enum includes Null, Bool, I64, F64, String, Bytes, and Json variants. Values are stored using typed SQL columns (value_kind discriminator + value_i64, value_f64, value_text, value_blob columns).

**Rationale:**
- Typed columns preserve type fidelity without custom binary encoding
- JSON variant handles arrays/objects as a v1 compromise
- Matches the tugbank proposal exactly

**Implications:**
- Each value kind maps to exactly one SQL column; others are NULL
- value_kind integer discriminator: 0=Null, 1=Bool, 2=I64, 3=F64, 4=String, 5=Bytes, 6=Json

#### [D05] 10 MB blob limit enforced at API boundary (DECIDED) {#d05-blob-limit}

**Decision:** `Value::Bytes` payloads exceeding 10 MB (10,485,760 bytes) are rejected with `Error::ValueTooLarge` before any SQLite call. The limit applies only to `Bytes`, not to other value types.

**Rationale:**
- Keeps the database file reasonable
- Enforcing at the API level is simpler and faster than a SQLite trigger
- 10 MB accommodates use cases like avatar icons

**Implications:**
- Checked in `DomainHandle::set()`, `DomainHandle::set_if_generation()`, and inside `DomainTxn::set()`
- Other value types (String, Json) are not size-limited in v1

#### [D06] Contention test uses multi-thread, not multi-process (DECIDED) {#d06-contention-test}

**Decision:** The writer contention integration test uses `std::thread` to spawn two threads, each opening the same database file with separate `rusqlite` connections. This tests concurrent writer behavior and busy_timeout without requiring a helper binary.

**Rationale:**
- Simpler implementation -- no helper binary to build and invoke
- SQLite treats separate connections from different threads the same as separate processes for locking purposes
- Tests the actual contention scenario (busy_timeout, CAS conflict)

**Implications:**
- Test creates a temp file, spawns two threads, each with its own `DefaultsStore::open()` call
- Threads perform concurrent writes and verify CAS semantics

---

### Specification {#specification}

#### Public API Surface {#public-api}

**Spec S01: DefaultsStore API** {#s01-defaults-store}

```rust
pub struct DefaultsStore {
    conn: Mutex<Connection>,
}

impl DefaultsStore {
    /// Open or create a tugbank database at the given path.
    /// Sets WAL mode, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON.
    /// Bootstraps schema if missing; runs migrations if schema_version is older.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, Error>;

    /// Get a handle to a specific domain. The domain row is created lazily on first write.
    pub fn domain(&self, name: &str) -> Result<DomainHandle<'_>, Error>;

    /// List all domain names in the database.
    pub fn list_domains(&self) -> Result<Vec<String>, Error>;
}
```

**Spec S02: DomainHandle API** {#s02-domain-handle}

```rust
pub struct DomainHandle<'a> {
    store: &'a DefaultsStore,
    domain: String,
}

impl<'a> DomainHandle<'a> {
    /// Read a single key. Returns None if the key does not exist.
    pub fn get(&self, key: &str) -> Result<Option<Value>, Error>;

    /// List all keys in this domain.
    pub fn keys(&self) -> Result<Vec<String>, Error>;

    /// Read all key-value pairs in this domain.
    pub fn read_all(&self) -> Result<BTreeMap<String, Value>, Error>;

    /// Set a key to a value. Creates the domain if it does not exist.
    /// Increments the domain generation. Enforces blob size limit.
    pub fn set(&self, key: &str, value: Value) -> Result<(), Error>;

    /// Remove a key. Returns true if the key existed and was deleted.
    /// If no entry existed (or the domain has never been written to),
    /// returns false without creating the domain row or bumping generation.
    /// Generation is only incremented when a row is actually deleted.
    pub fn remove(&self, key: &str) -> Result<bool, Error>;

    /// Get the current generation counter for this domain.
    /// Returns 0 if the domain has no rows yet (no writes have occurred).
    pub fn generation(&self) -> Result<u64, Error>;

    /// Set a key only if the domain generation matches expected_generation.
    /// Returns SetOutcome::Written or SetOutcome::Conflict.
    pub fn set_if_generation(
        &self, key: &str, value: Value, expected_generation: u64,
    ) -> Result<SetOutcome, Error>;

    /// Atomic multi-key update. The closure receives a write-only DomainTxn.
    /// Uses BEGIN IMMEDIATE for writer serialization. Includes a defense-in-depth
    /// CAS check on generation. If the closure returns Err, the transaction is
    /// rolled back automatically and the error is propagated.
    pub fn update<F>(&self, f: F) -> Result<u64, Error>
    where
        F: FnOnce(&mut DomainTxn) -> Result<(), Error>;
}
```

**Spec S03: DomainTxn API** {#s03-domain-txn}

```rust
pub struct DomainTxn {
    mutations: Vec<Mutation>,
}

impl DomainTxn {
    /// Queue a set operation. Enforces blob size limit.
    pub fn set(&mut self, key: &str, value: Value) -> Result<(), Error>;

    /// Queue a remove operation.
    pub fn remove(&mut self, key: &str);
}
```

**Spec S04: Value Enum** {#s04-value-enum}

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    I64(i64),
    F64(f64),
    String(String),
    Bytes(Vec<u8>),
    Json(serde_json::Value),
}
```

**Spec S05: SetOutcome Enum** {#s05-set-outcome}

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetOutcome {
    Written,
    Conflict { current_generation: u64 },
}
```

**Spec S06: Error Enum** {#s06-error-enum}

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid domain name: {0}")]
    InvalidDomain(String),

    #[error("invalid key: {0}")]
    InvalidKey(String),

    #[error("generation conflict")]
    Conflict,

    #[error("value too large: {size} bytes exceeds 10 MB limit")]
    ValueTooLarge { size: usize },

    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("json error: {0}")]
    Serde(#[from] serde_json::Error),
}
```

Note: The tugbank proposal (section 11) also lists `TypeMismatch`, `NotFound`, and `Busy` variants. These are omitted from `tugbank-core` because: `TypeMismatch` is not applicable (the typed-column encoding handles all variants without caller-specified type expectations); `NotFound` is represented by `Option<Value>` return types (get returns `None`, not an error); `Busy` surfaces as `Error::Sqlite(rusqlite::Error)` wrapping `SQLITE_BUSY`, which is sufficient for the library layer. The CLI (phase 5e2) may introduce these as CLI-specific exit codes without adding library-level variants.

#### Inputs and Outputs {#inputs-outputs}

**Table T01: Value Kind to SQL Column Mapping** {#t01-value-kind-mapping}

| value_kind | Variant | SQL Column | Encoding |
|-----------|---------|------------|----------|
| 0 | Null | (none) | All payload columns NULL |
| 1 | Bool | value_i64 | 0 = false, 1 = true |
| 2 | I64 | value_i64 | Direct integer |
| 3 | F64 | value_f64 | Direct real |
| 4 | String | value_text | Direct text |
| 5 | Bytes | value_blob | Direct blob |
| 6 | Json | value_text | JSON-serialized text |

#### Internal Architecture {#internal-architecture}

**Spec S07: Schema Bootstrap SQL** {#s07-schema-sql}

The database is initialized with these statements on first open (when no `schema_version` key exists in the meta table):

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domains (
    name        TEXT PRIMARY KEY,
    generation  INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    domain       TEXT NOT NULL,
    key          TEXT NOT NULL,
    value_kind   INTEGER NOT NULL,
    value_i64    INTEGER,
    value_f64    REAL,
    value_text   TEXT,
    value_blob   BLOB,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (domain, key),
    FOREIGN KEY (domain) REFERENCES domains(name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entries_domain ON entries(domain);

INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
```

**Spec S08: Write Transaction Flow** {#s08-write-flow}

The `update()` method follows this flow:

1. Acquire the `Mutex<Connection>` lock
2. `BEGIN IMMEDIATE` (reserves writer lock early via `rusqlite::Transaction`)
3. `INSERT INTO domains ... ON CONFLICT DO NOTHING` (ensure domain exists)
4. Read current `generation` from `domains`
5. Call the user's closure with a `DomainTxn`, accumulating mutations
   - If closure returns `Err`, the `rusqlite::Transaction` is dropped without commit, triggering automatic rollback. Propagate the error to the caller.
6. For each mutation, execute `INSERT ... ON CONFLICT(domain,key) DO UPDATE ...`
   - If any mutation fails, the `rusqlite::Transaction` is dropped without commit, triggering automatic rollback. Propagate the SQLite error.
7. CAS bump (defense-in-depth): `UPDATE domains SET generation = generation + 1, updated_at = ? WHERE name = ? AND generation = ?`
8. If affected rows != 1, the transaction is dropped (automatic rollback), return `Error::Conflict`
9. `transaction.commit()`
10. Return the new generation

**Rollback strategy:** Use `rusqlite::Connection::transaction_with_behavior(TransactionBehavior::Immediate)` which returns a `Transaction` that automatically rolls back on drop if `commit()` was not called. This ensures all error paths (closure error, mutation error, CAS failure) roll back without explicit `ROLLBACK` statements.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugbank-core` | SQLite-backed typed defaults store library |

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugbank-core/Cargo.toml` | Crate manifest with rusqlite, serde, serde_json, thiserror dependencies |
| `tugcode/crates/tugbank-core/src/lib.rs` | Crate root: re-exports, module declarations |
| `tugcode/crates/tugbank-core/src/error.rs` | Error enum definition |
| `tugcode/crates/tugbank-core/src/value.rs` | Value enum and SQL column encoding/decoding |
| `tugcode/crates/tugbank-core/src/schema.rs` | Schema bootstrap and migration logic |
| `tugcode/crates/tugbank-core/src/store.rs` | DefaultsStore struct and impl |
| `tugcode/crates/tugbank-core/src/domain.rs` | DomainHandle, DomainTxn, SetOutcome structs and impls |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Value` | enum | `value.rs` | 7 variants: Null, Bool, I64, F64, String, Bytes, Json |
| `Error` | enum | `error.rs` | InvalidDomain, InvalidKey, Conflict, ValueTooLarge, Sqlite, Serde |
| `DefaultsStore` | struct | `store.rs` | Holds `Mutex<Connection>`, provides open/domain/list_domains |
| `DomainHandle` | struct | `domain.rs` | Borrows DefaultsStore, scoped to a domain name |
| `DomainTxn` | struct | `domain.rs` | Write-only transaction buffer: set/remove |
| `SetOutcome` | enum | `domain.rs` | Written or Conflict { current_generation } |
| `Mutation` | enum | `domain.rs` | Internal: Set { key, value } or Remove { key } |
| `bootstrap_schema` | fn | `schema.rs` | Creates tables and inserts schema_version=1 |
| `migrate_schema` | fn | `schema.rs` | Reads current version, applies migrations |
| `MAX_BLOB_SIZE` | const | `value.rs` | 10_485_760 (10 MB) |
| `encode_value` | fn | `value.rs` | Value -> (value_kind, i64, f64, text, blob) tuple |
| `decode_value` | fn | `value.rs` | SQL row -> Value |

---

### Documentation Plan {#documentation-plan}

- [ ] Rustdoc on all public types and methods in tugbank-core
- [ ] Module-level doc comments explaining the crate's purpose and usage pattern

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test Value encoding/decoding, blob limit enforcement, error construction | Core logic in value.rs and error.rs |
| **Integration** | Test DefaultsStore + DomainHandle end-to-end: open, set, get, CAS, transactions | store.rs and domain.rs working together |
| **Concurrency** | Test multi-thread writer contention with separate connections | Validates busy_timeout and CAS under contention |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Create tugbank-core crate scaffold {#step-1}

**Commit:** `feat(tugbank-core): scaffold new library crate with workspace membership`

**References:** [D01] Mutex Connection, [D02] Sync Normal, (#scope, #new-crates, #new-files)

**Artifacts:**
- `tugcode/crates/tugbank-core/Cargo.toml` -- crate manifest
- `tugcode/crates/tugbank-core/src/lib.rs` -- crate root with module declarations
- `tugcode/crates/tugbank-core/src/error.rs` -- empty error module
- `tugcode/crates/tugbank-core/src/value.rs` -- empty value module
- `tugcode/crates/tugbank-core/src/schema.rs` -- empty schema module
- `tugcode/crates/tugbank-core/src/store.rs` -- empty store module
- `tugcode/crates/tugbank-core/src/domain.rs` -- empty domain module
- Updated `tugcode/Cargo.toml` -- add `tugbank-core` to workspace members

**Tasks:**
- [ ] Create `tugcode/crates/tugbank-core/Cargo.toml` with `[package]` section using workspace inheritance (`version.workspace = true`, `edition.workspace = true`, `license.workspace = true`, `rust-version.workspace = true`) consistent with the tugtool-core pattern; `[dependencies]`: `rusqlite.workspace = true`, `serde.workspace = true`, `serde_json.workspace = true`, `thiserror.workspace = true`; `[dev-dependencies]`: `tempfile.workspace = true`; `[lib]` section with `name = "tugbank_core"`
- [ ] Create `src/lib.rs` with `mod error; mod value; mod schema; mod store; mod domain;` and public re-exports
- [ ] Create stub files for each module (empty or with placeholder types)
- [ ] Add `"crates/tugbank-core"` to the `members` list in `tugcode/Cargo.toml`

**Tests:**
- [ ] T1: `cargo build -p tugbank-core` compiles without errors or warnings

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugbank-core`

---

#### Step 2: Implement Error and Value types {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugbank-core): implement Error enum and Value enum with SQL encoding`

**References:** [D04] Value Enum, [D05] Blob Limit, Spec S04, Spec S05, Spec S06, Table T01, (#public-api, #inputs-outputs)

**Artifacts:**
- `tugcode/crates/tugbank-core/src/error.rs` -- complete Error enum
- `tugcode/crates/tugbank-core/src/value.rs` -- complete Value enum, MAX_BLOB_SIZE, encode_value, decode_value

**Tasks:**
- [ ] Implement `Error` enum with all variants: InvalidDomain, InvalidKey, Conflict, ValueTooLarge { size }, Sqlite(rusqlite::Error), Serde(serde_json::Error)
- [ ] Implement `Value` enum with Null, Bool, I64, F64, String, Bytes, Json variants; derive Debug, Clone, PartialEq
- [ ] Define `MAX_BLOB_SIZE: usize = 10_485_760`
- [ ] Implement `encode_value(value: &Value) -> (i32, Option<i64>, Option<f64>, Option<String>, Option<Vec<u8>>)` following Table T01 mapping
- [ ] Implement `decode_value(kind: i32, i64_val: Option<i64>, f64_val: Option<f64>, text_val: Option<String>, blob_val: Option<Vec<u8>>) -> Result<Value, Error>` for reverse mapping
- [ ] Implement `SetOutcome` enum with `Written` and `Conflict { current_generation: u64 }` variants
- [ ] Add a `check_blob_size(value: &Value) -> Result<(), Error>` helper that returns `ValueTooLarge` if `Bytes` exceeds MAX_BLOB_SIZE

**Tests:**
- [ ] T2: Value::Bool(true) round-trips through encode/decode
- [ ] T3: Value::I64(i64::MAX) round-trips correctly
- [ ] T4: Value::F64(std::f64::consts::PI) round-trips correctly
- [ ] T5: Value::String with empty string and Unicode round-trips correctly
- [ ] T6: Value::Bytes with 0 bytes and 1 MB payload round-trips correctly
- [ ] T7: Value::Json with nested object round-trips correctly
- [ ] T8: Value::Null round-trips correctly
- [ ] T9: check_blob_size rejects Bytes > 10 MB with ValueTooLarge
- [ ] T10: check_blob_size accepts Bytes exactly at 10 MB
- [ ] T11: check_blob_size ignores non-Bytes variants (e.g., large String passes)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank-core`

---

#### Step 3: Implement schema bootstrap and migration {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugbank-core): implement schema bootstrap and versioned migration`

**References:** [D02] Sync Normal, Spec S07, (#internal-architecture, #assumptions)

**Artifacts:**
- `tugcode/crates/tugbank-core/src/schema.rs` -- complete schema bootstrap and migration logic

**Tasks:**
- [ ] Implement `bootstrap_schema(conn: &Connection) -> Result<(), Error>` that creates all three tables (meta, domains, entries), the index, and inserts `schema_version = '1'` into meta
- [ ] Implement `migrate_schema(conn: &Connection) -> Result<(), Error>` that reads `schema_version` from meta, calls bootstrap if missing, and runs versioned migrations if version is older than current
- [ ] Implement `apply_pragmas(conn: &Connection) -> Result<(), Error>` that sets `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`
- [ ] The migration function runs inside a transaction so failures roll back cleanly

**Tests:**
- [ ] T12: bootstrap_schema creates all tables on a fresh in-memory database
- [ ] T13: bootstrap_schema is idempotent (calling twice does not error)
- [ ] T14: migrate_schema detects missing schema_version and bootstraps
- [ ] T15: apply_pragmas sets WAL mode (verify with `PRAGMA journal_mode` query)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank-core`

---

#### Step 4: Implement DefaultsStore {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugbank-core): implement DefaultsStore with open, domain, and list_domains`

**References:** [D01] Mutex Connection, Spec S01, (#public-api, #constraints)

**Artifacts:**
- `tugcode/crates/tugbank-core/src/store.rs` -- complete DefaultsStore implementation

**Tasks:**
- [ ] Implement `DefaultsStore` struct with `conn: Mutex<Connection>` field
- [ ] Implement `DefaultsStore::open(path: impl AsRef<Path>) -> Result<Self, Error>` that opens the SQLite connection, applies pragmas, runs migration, and wraps in Mutex
- [ ] Implement `DefaultsStore::domain(&self, name: &str) -> Result<DomainHandle<'_>, Error>` that validates the domain name and returns a handle
- [ ] Implement `DefaultsStore::list_domains(&self) -> Result<Vec<String>, Error>` that queries the domains table
- [ ] Add a compile-time `Send + Sync` assertion: `const _: () = { fn _assert_send_sync<T: Send + Sync>() {} fn _check() { _assert_send_sync::<DefaultsStore>(); } };`
- [ ] Domain name validation: reject empty strings with `Error::InvalidDomain` (no maximum length constraint -- SQLite TEXT handles arbitrary lengths and domain names are short reverse-URL strings in practice)

**Tests:**
- [ ] T16: DefaultsStore::open creates a new database file at the given path
- [ ] T17: DefaultsStore::open on an existing database succeeds without re-bootstrapping
- [ ] T18: list_domains returns empty vec for a fresh database
- [ ] T19: domain() returns a DomainHandle for a valid name
- [ ] T20: domain() with an empty string returns InvalidDomain error
- [ ] T21: DefaultsStore is Send + Sync (compile-time check)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank-core`

---

#### Step 5: Implement DomainHandle read and write operations {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugbank-core): implement DomainHandle get, set, remove, keys, read_all`

**References:** [D03] Txn Write-Only, [D04] Value Enum, [D05] Blob Limit, Spec S02, Table T01, Spec S08, (#public-api, #inputs-outputs)

**Artifacts:**
- `tugcode/crates/tugbank-core/src/domain.rs` -- DomainHandle basic operations

**Tasks:**
- [ ] Implement `DomainHandle::get(&self, key: &str) -> Result<Option<Value>, Error>` that queries the entries table by domain+key and decodes the value
- [ ] Implement `DomainHandle::set(&self, key: &str, value: Value) -> Result<(), Error>` that enforces blob size limit, ensures domain exists (INSERT ON CONFLICT DO NOTHING), upserts the entry, and increments domain generation
- [ ] Implement `DomainHandle::remove(&self, key: &str) -> Result<bool, Error>` that deletes the entry and returns whether it existed; only increments generation if a row was actually deleted (affected rows > 0); does not create the domain row if no entry was found
- [ ] Implement `DomainHandle::keys(&self) -> Result<Vec<String>, Error>` that lists all keys in the domain
- [ ] Implement `DomainHandle::read_all(&self) -> Result<BTreeMap<String, Value>, Error>` that reads all entries for the domain
- [ ] All write operations use `BEGIN IMMEDIATE` for the write lock and increment the domain generation
- [ ] Key validation: reject empty strings with `Error::InvalidKey` in `get()`, `set()`, `remove()`, and `set_if_generation()`

**Tests:**
- [ ] T22: set then get returns the same value for each Value variant
- [ ] T23: get on a nonexistent key returns None
- [ ] T24: set overwrites an existing key with a new value
- [ ] T25: remove returns true for existing key, false for nonexistent
- [ ] T26: keys returns all keys in sorted order
- [ ] T27: read_all returns all key-value pairs
- [ ] T28: set rejects Bytes > 10 MB with ValueTooLarge
- [ ] T29: set with different domains does not cross-contaminate
- [ ] T30: remove a key then get returns None
- [ ] T30a: remove on a domain that has never been written to returns false and does not create the domain row (list_domains still excludes it)
- [ ] T30b: set with an empty key returns InvalidKey error
- [ ] T30c: get with an empty key returns InvalidKey error

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank-core`

---

#### Step 6: Implement CAS concurrency and DomainTxn {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugbank-core): implement CAS generation, set_if_generation, and update with DomainTxn`

**References:** [D03] Txn Write-Only, [D05] Blob Limit, Spec S02, Spec S03, Spec S05, Spec S08, (#public-api, #internal-architecture)

**Artifacts:**
- `tugcode/crates/tugbank-core/src/domain.rs` -- DomainHandle CAS methods and DomainTxn

**Tasks:**
- [ ] Implement `DomainHandle::generation(&self) -> Result<u64, Error>` that reads the current generation from the domains table; returns 0 if the domain row does not yet exist (SELECT returns no rows)
- [ ] Implement `DomainHandle::set_if_generation(&self, key: &str, value: Value, expected_generation: u64) -> Result<SetOutcome, Error>` following Spec S08 flow: BEGIN IMMEDIATE, check generation, upsert entry, CAS bump, return Written or Conflict
- [ ] Implement `DomainTxn` struct with `mutations: Vec<Mutation>` field
- [ ] Implement `DomainTxn::set(&mut self, key: &str, value: Value) -> Result<(), Error>` that validates blob size and pushes a Set mutation
- [ ] Implement `DomainTxn::remove(&mut self, key: &str)` that pushes a Remove mutation
- [ ] Implement internal `Mutation` enum: `Set { key: String, value: Value }` and `Remove { key: String }`
- [ ] Implement `DomainHandle::update<F>(&self, f: F) -> Result<u64, Error>` that: acquires mutex, BEGIN IMMEDIATE, ensures domain exists, reads generation, creates DomainTxn, calls closure, applies mutations, CAS bumps generation, commits, returns new generation. Note: the CAS check inside update() is defense-in-depth -- `BEGIN IMMEDIATE` serializes writers so the generation cannot change mid-transaction, but the check guards against future refactors that might alter the transaction strategy
- [ ] If the CAS bump affects 0 rows in update(), rollback and return Error::Conflict (defense-in-depth; not reachable under current BEGIN IMMEDIATE design)

**Tests:**
- [ ] T31: generation returns 0 for a domain with no prior writes (domain row does not exist)
- [ ] T32: after one set(), generation is 1
- [ ] T33: generation increments by 1 after each subsequent set/remove call
- [ ] T34: set_if_generation returns Written when generation matches
- [ ] T35: set_if_generation returns Conflict when generation is stale
- [ ] T36: update with multiple set/remove operations applies atomically
- [ ] T37: update returns the new generation on success
- [ ] T38: DomainTxn::set enforces blob size limit inside transactions

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank-core`

---

#### Step 7: Multi-thread writer contention integration test {#step-7}

**Depends on:** #step-6

**Commit:** `test(tugbank-core): add multi-thread writer contention integration test`

**References:** [D06] Contention Test, Risk R01, (#success-criteria)

**Artifacts:**
- New integration test in `tugcode/crates/tugbank-core/tests/contention.rs`

**Tasks:**
- [ ] Create `tests/contention.rs` integration test file
- [ ] Test scenario: create a temp database file, spawn two threads, each opens its own `DefaultsStore` to the same file
- [ ] Each thread writes 50 values to the same domain using `set()`, with unique keys per thread
- [ ] Verify that all writes succeed (busy_timeout handles brief contention)
- [ ] After both threads join, open a fresh connection and verify all 100 keys are present
- [ ] Test CAS contention: use `std::sync::Barrier(2)` so both threads read generation() and then wait at the barrier before either calls set_if_generation -- this ensures both threads hold the same stale generation value before racing to write; exactly one succeeds and one gets Conflict
- [ ] Verify the Conflict thread can re-read generation and retry successfully

**Tests:**
- [ ] T39: concurrent set() from two threads to same domain completes without errors
- [ ] T40: all keys from both threads are present after completion
- [ ] T41: set_if_generation contention: two threads both read generation via generation(), synchronize at a `std::sync::Barrier(2)`, then both attempt set_if_generation with the stale value -- exactly one gets Written and the other gets Conflict
- [ ] T42: CAS retry after Conflict succeeds: the Conflict thread re-reads generation and retries set_if_generation successfully

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank-core`

---

#### Step 8: Final Validation and Cleanup {#step-8}

**Depends on:** #step-7

**Commit:** `chore(tugbank-core): final cleanup, rustdoc, and formatting`

**References:** [D01] Mutex Connection, (#success-criteria, #documentation-plan, #constraints)

**Artifacts:**
- Rustdoc on all public types and methods
- `cargo fmt` applied

**Tasks:**
- [ ] Add rustdoc comments to all public types: DefaultsStore, DomainHandle, DomainTxn, Value, SetOutcome, Error
- [ ] Add module-level doc comments to lib.rs explaining crate purpose and usage
- [ ] Run `cargo fmt --all` from the tugcode directory
- [ ] Run `cargo clippy -p tugbank-core` and fix any warnings
- [ ] Verify all success criteria are met

**Tests:**
- [ ] T43: Full test suite passes: `cargo nextest run -p tugbank-core`
- [ ] T44: No warnings: `cargo build -p tugbank-core` succeeds (warnings are errors)

**Checkpoint:**
- [ ] `cd tugcode && cargo fmt --all && cargo build -p tugbank-core && cargo nextest run -p tugbank-core`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A fully tested `tugbank-core` library crate providing a SQLite-backed typed defaults store with domain separation, CAS concurrency, and 10 MB blob enforcement, ready to be consumed by the tugbank CLI (phase 5e2) and tugcast integration (phase 5e3).

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugbank-core` crate compiles with zero warnings (`cargo build -p tugbank-core`)
- [ ] All unit and integration tests pass (`cargo nextest run -p tugbank-core`)
- [ ] All seven Value variants round-trip through SQLite correctly
- [ ] CAS conflict detection works under multi-thread contention (via set_if_generation)
- [ ] Blob size enforcement rejects payloads > 10 MB
- [ ] DefaultsStore is Send + Sync (compile-time verified)
- [ ] All public types have rustdoc comments

**Acceptance tests:**
- [ ] T43: Full test suite green
- [ ] T44: Zero warnings build
- [ ] T39-T42: Contention tests pass

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5e2: tugbank CLI binary crate
- [ ] Phase 5e3: tugcast HTTP bridge integration
- [ ] Phase 5e4: settings migration from flat file
- [ ] Watch/notify API for value change subscriptions
- [ ] Domain deletion via DefaultsStore (currently only entry-level operations)

| Checkpoint | Verification |
|------------|--------------|
| Crate compiles | `cd tugcode && cargo build -p tugbank-core` |
| Tests pass | `cd tugcode && cargo nextest run -p tugbank-core` |
| No warnings | Build succeeds with `-D warnings` |
| Formatted | `cd tugcode && cargo fmt --all --check` |
