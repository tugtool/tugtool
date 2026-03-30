<!-- tugplan-skeleton v2 -->

## Tugbank In-Process Clients: Phase 1 — Rust TugbankClient + DEFAULTS Feed {#tugbank-in-process-clients}

**Purpose:** Ship a Rust `TugbankClient` in `tugbank-core` that wraps `DefaultsStore` with an in-memory cache and `PRAGMA data_version` polling, then integrate it into tugcast with a new DEFAULTS WebSocket feed so tugdeck receives real-time domain snapshots without HTTP polling.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugbank-in-process-clients |
| Last updated | 2026-03-30 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Every tugbank access today — except tugcast's direct `DefaultsStore` usage — spawns a process or makes an HTTP round-trip. Reading a single boolean like `no-auth` means forking a process, loading the Rust binary, opening SQLite, querying one row, formatting the output, and parsing it back. This is the dominant access pattern, and it is too expensive.

The roadmap (`roadmap/tugbank-in-process-clients.md`) defines a five-phase migration to give every client in-process, in-memory access to tugbank data. This plan covers Phase 1 (Rust `TugbankClient` in `tugbank-core`) and Phase 2's DEFAULTS feed (new WebSocket feed ID `0x50` in tugcast-core/tugcast). The FFI crate, Swift client, TypeScript client, and tugtalk migration are future phases.

#### Strategy {#strategy}

- Build the `TugbankClient` in `tugbank-core` as a new module that wraps `DefaultsStore` with domain snapshots and `PRAGMA data_version` polling on a dedicated `std::thread`.
- Use a channel-based design: the polling thread sends change notifications to tokio tasks via `std::sync::mpsc`, keeping sync SQLite work off the async runtime.
- Add `FeedId::Defaults = 0x50` to `tugcast-core` protocol, with `from_byte` and `as_byte` support.
- Build a defaults feed in tugcast that uses `TugbankClient` to detect changes and push full domain snapshots to all WebSocket clients via the existing `watch::Sender<Frame>` pattern.
- Send a sentinel DEFAULTS frame (`{"sentinel":"sync-complete"}`) after initial domain snapshots so clients know when bootstrap is done.
- Migrate tugcast's HTTP handlers from `Arc<DefaultsStore>` to `Arc<TugbankClient>`, with `TugbankClient` exposing the underlying store for handler compatibility.
- Keep the tugbank CLI unchanged — it continues using `DefaultsStore` directly.

#### Success Criteria (Measurable) {#success-criteria}

- `TugbankClient::get()` returns cached values without hitting SQLite after initial load (`cargo nextest run` verifies via assertion on call count or timing)
- External writes detected within one poll cycle: a write on a second `DefaultsStore` connection triggers a cache refresh in `TugbankClient` (integration test with two connections)
- `FeedId::from_byte(0x50)` returns `Some(FeedId::Defaults)` and round-trips correctly (unit test)
- tugcast pushes DEFAULTS frames on WebSocket connect and on domain change (integration test or manual verification)
- All existing tugcast HTTP endpoints (`/api/defaults/...`) continue to work unchanged after migration to `TugbankClient` (`cargo nextest run` — existing tests pass)

#### Scope {#scope}

1. New `TugbankClient` type in `tugbank-core` with in-memory domain snapshots, `PRAGMA data_version` polling, and domain change callbacks
2. New `FeedId::Defaults = 0x50` variant in `tugcast-core/protocol.rs`
3. New defaults feed module in tugcast that pushes domain snapshots via WebSocket
4. Sentinel frame (`{"sentinel":"sync-complete"}`) after initial snapshot batch
5. Migration of tugcast HTTP handlers from `Arc<DefaultsStore>` to `Arc<TugbankClient>`

#### Non-goals (Explicitly out of scope) {#non-goals}

- `tugbank-ffi` crate (Phase 2 — future plan)
- Swift `TugbankClient` in tugapp (Phase 4 — future plan)
- TypeScript `TugbankClient` in tugdeck (Phase 3 — future plan, but this plan delivers the WebSocket feed tugdeck will consume)
- tugtalk migration (Phase 5 — future plan)
- tugbank CLI changes (no change needed — short-lived process)
- File-system watching as a supplement to `PRAGMA data_version` polling

#### Dependencies / Prerequisites {#dependencies}

- `tugbank-core` crate with `DefaultsStore`, `DomainHandle`, `Value`, and `read_all` API (exists)
- `tugcast-core` crate with `FeedId` enum and frame protocol (exists)
- tugcast's `watch::Sender<Frame>` / `snapshot_watches` pattern for feed delivery (exists)
- tugcast's `Extension<Arc<DefaultsStore>>` in HTTP handlers (exists, will be migrated)

#### Constraints {#constraints}

- `TugbankClient` must be `Send + Sync` (required for `Arc` sharing across tokio tasks and threads)
- Polling thread must be a dedicated `std::thread`, not a tokio task, because `DefaultsStore` uses `Mutex<Connection>` (sync blocking)
- SQLite `PRAGMA data_version` is the sole change-detection mechanism — no file watching
- Poll interval: 500ms (matches roadmap spec)
- DEFAULTS payload format must be JSON: `{"domain":"...","generation":N,"entries":{...}}` where entries use the existing tagged-value wire format from `tugcast/src/defaults.rs`

#### Assumptions {#assumptions}

- `PRAGMA data_version` reliably detects external writes in WAL mode (documented SQLite behavior)
- Domain count is small enough that polling all domain generations on each `data_version` change is cheap (current usage: ~4 domains)
- The existing `watch::Sender<Frame>` pattern supports adding new feeds without protocol-breaking changes
- `TugbankClient` holds its own `DefaultsStore` internally and exposes get/set methods that callers use instead of the raw `DefaultsStore` API
- The tugbank CLI binary is explicitly out of scope — no changes needed

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Callback threading model for tugcast integration (OPEN) {#q01-callback-threading}

**Question:** When `TugbankClient`'s polling thread detects a change, how does it notify the tugcast async runtime to push frames?

**Why it matters:** The polling thread is a `std::thread` running sync code. It cannot directly call `watch::Sender::send()` (which requires the value to be available) without coordination.

**Options (if known):**
- The polling thread calls change callbacks synchronously; tugcast registers a callback that sends on a `std::sync::mpsc::Sender`, and a tokio task receives on the corresponding `Receiver` via `tokio::task::spawn_blocking` or a bridge.
- `TugbankClient` provides an async `changes()` stream that wraps the internal channel.

**Plan to resolve:** Resolve during implementation of Step 3. The dedicated `std::thread` with channel pattern (per user answer) is the chosen direction — callbacks fire on the polling thread, and the tugcast integration uses a channel to bridge to tokio.

**Resolution:** DECIDED — Dedicated `std::thread` with `std::sync::mpsc` channel to notify tokio tasks (see [D01]).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `PRAGMA data_version` misses writes in edge cases | med | low | Integration tests with concurrent writers; SQLite docs confirm reliability in WAL mode | If any test shows missed writes |
| Polling thread blocks on `Mutex<Connection>` during long writes | low | low | Poll interval is 500ms; `busy_timeout=5000` handles contention; polling pragma is fast | If polling latency exceeds 1s consistently |

**Risk R01: Polling thread contention with HTTP handlers** {#r01-poll-contention}

- **Risk:** The polling thread and HTTP handler `spawn_blocking` tasks both acquire `DefaultsStore`'s internal `Mutex<Connection>`. Under high write load, the polling thread could delay HTTP responses.
- **Mitigation:** `PRAGMA data_version` is a single pragma call with no disk I/O — it executes in microseconds. The mutex is held for the duration of that call only. Even if contention occurs, `busy_timeout=5000` prevents failures.
- **Residual risk:** Under extreme concurrent load, polling latency could increase from 500ms to ~505ms. Acceptable for UI reactivity.

---

### Design Decisions {#design-decisions}

#### [D01] Dedicated std::thread with channel for polling (DECIDED) {#d01-polling-thread}

**Decision:** `TugbankClient` runs `PRAGMA data_version` polling on a dedicated `std::thread`, using `std::sync::mpsc` to send change notifications to consumers (e.g., tokio tasks in tugcast).

**Rationale:**
- `DefaultsStore` uses `Mutex<Connection>` — blocking mutex acquisition is inappropriate on the tokio runtime
- A dedicated thread cleanly separates sync SQLite work from async runtime concerns
- `std::sync::mpsc` is the simplest bridge between sync and async worlds

**Implications:**
- `TugbankClient::new()` spawns a background thread that runs until the client is dropped
- `Drop` implementation must signal the thread to stop (e.g., via an `AtomicBool` or by dropping the sender)
- Consumers register callbacks that fire on the polling thread, or receive change events via channel

#### [D02] TugbankClient wraps DefaultsStore internally (DECIDED) {#d02-client-wraps-store}

**Decision:** `TugbankClient` owns a `DefaultsStore` instance internally and exposes `get`, `set`, `read_domain`, and `data_version` methods. Callers use `TugbankClient` instead of `DefaultsStore` directly.

**Rationale:**
- Encapsulation ensures the cache is always consistent with the database
- Prevents callers from bypassing the cache and writing directly to the store
- tugcast's HTTP handlers can call `client.store()` to get a reference when they need raw `DefaultsStore` access during migration

**Implications:**
- `TugbankClient` constructors accept a path (like `DefaultsStore::open`) or an existing `DefaultsStore`
- HTTP handlers in `tugcast/src/defaults.rs` change from `Extension<Arc<DefaultsStore>>` to `Extension<Arc<TugbankClient>>`
- `TugbankClient` re-exports `DefaultsStore` methods it wraps, adding cache management

#### [D03] DEFAULTS feed ID is 0x50 (DECIDED) {#d03-defaults-feed-id}

**Decision:** The DEFAULTS feed uses `FeedId::Defaults = 0x50` in the `tugcast-core` protocol.

**Rationale:**
- `0x50` is unused in the current FeedId enum (existing range: 0x00-0x02, 0x10, 0x20, 0x30-0x33, 0x40-0x41, 0xC0, 0xFF)
- Fits the pattern of allocating feed IDs in the 0x00-0xBF range for data feeds

**Implications:**
- Add `Defaults = 0x50` variant to `FeedId` enum in `tugcast-core/protocol.rs`
- Add `0x50 => Some(FeedId::Defaults)` to `from_byte` match
- TypeScript `protocol.ts` in tugdeck must add `DEFAULTS: 0x50` (done in a future plan's Phase 3, but the Rust side ships now)

#### [D04] Sentinel frame signals sync-complete (DECIDED) {#d04-sentinel-frame}

**Decision:** After pushing initial domain snapshots on WebSocket connect, tugcast sends a DEFAULTS frame with payload `{"sentinel":"sync-complete"}` to signal that the initial batch is complete.

**Rationale:**
- Clients (future tugdeck `TugbankClient`) need to know when the initial snapshot batch is done so `await client.ready()` can resolve
- Using the same feed ID (`0x50`) avoids adding another feed ID just for signaling
- The `"sentinel"` key is unambiguous — regular domain snapshot frames have a `"domain"` key

**Implications:**
- Clients must check for the `"sentinel"` key to distinguish sync-complete frames from domain snapshot frames
- The sentinel is sent once per WebSocket connection, after all initial domain snapshots

#### [D05] Domain snapshot payload uses existing tagged-value wire format (DECIDED) {#d05-snapshot-payload}

**Decision:** DEFAULTS frame payloads use JSON with the same tagged-value format already used by the HTTP API: `{"domain":"...","generation":N,"entries":{"key":{"kind":"...","value":...},...}}`.

**Rationale:**
- Reuses the existing `value_to_tagged` / `tagged_to_value` functions from `tugcast/src/defaults.rs`
- tugdeck already understands this format from its HTTP-based `settings-api.ts`
- No new serialization format to define or maintain

**Implications:**
- The `entries` object maps keys to tagged-value objects, not raw values
- The DEFAULTS feed module in tugcast must import and use `value_to_tagged` from `defaults.rs`

---

### Specification {#specification}

#### TugbankClient Public API {#tugbank-client-api}

**Spec S01: TugbankClient constructor and lifecycle** {#s01-client-lifecycle}

```rust
impl TugbankClient {
    /// Open a new client with polling. Spawns a background polling thread.
    pub fn open(path: impl AsRef<Path>, poll_interval: Duration) -> Result<Self, Error>;

    /// Create from an existing DefaultsStore. Spawns a background polling thread.
    pub fn from_store(store: DefaultsStore, poll_interval: Duration) -> Self;

    /// Access the underlying DefaultsStore (for HTTP handler compatibility).
    pub fn store(&self) -> &DefaultsStore;

    /// Stop the polling thread. Called automatically on Drop.
    pub fn shutdown(&self);
}
```

**Spec S02: TugbankClient read/write API** {#s02-client-read-write}

```rust
impl TugbankClient {
    /// Read a cached value. Loads the domain on first access.
    pub fn get(&self, domain: &str, key: &str) -> Result<Option<Value>, Error>;

    /// Write a value. Updates DB and local cache atomically.
    pub fn set(&self, domain: &str, key: &str, value: Value) -> Result<(), Error>;

    /// Read all entries for a domain (from cache after first load).
    pub fn read_domain(&self, domain: &str) -> Result<BTreeMap<String, Value>, Error>;

    /// Get the current PRAGMA data_version.
    pub fn data_version(&self) -> Result<u64, Error>;

    /// Register a callback for domain changes. Returns a handle to unregister.
    pub fn on_domain_changed<F>(&self, callback: F) -> CallbackHandle
    where
        F: Fn(&str, &BTreeMap<String, Value>) + Send + 'static;
}
```

**Spec S03: DEFAULTS frame payload format** {#s03-defaults-payload}

Domain snapshot frame:
```json
{
  "domain": "dev.tugtool.deck.layout",
  "generation": 42,
  "entries": {
    "layout": {"kind": "json", "value": {"tabs": [...]}},
    "other-key": {"kind": "string", "value": "hello"}
  }
}
```

Sentinel frame:
```json
{
  "sentinel": "sync-complete"
}
```

**Table T01: FeedId assignments** {#t01-feed-id-assignments}

| Feed ID | Name | Direction | Purpose |
|---------|------|-----------|---------|
| `0x50` | Defaults | tugcast -> tugdeck | Domain snapshot push |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

No new crates in this phase. All work is in existing crates.

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugbank-core/src/client.rs` | `TugbankClient` implementation |
| `tugcode/crates/tugcast/src/feeds/defaults.rs` | DEFAULTS feed: polling + WebSocket push |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugbankClient` | struct | `tugbank-core/src/client.rs` | In-memory cached client wrapping `DefaultsStore` |
| `CallbackHandle` | struct | `tugbank-core/src/client.rs` | Returned by `on_domain_changed`, unregisters on drop |
| `DomainSnapshot` | type alias | `tugbank-core/src/client.rs` | `BTreeMap<String, Value>` |
| `FeedId::Defaults` | enum variant | `tugcast-core/src/protocol.rs` | `= 0x50` |
| `defaults_feed` | fn | `tugcast/src/feeds/defaults.rs` | Spawns polling + push task, returns `watch::Receiver<Frame>` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `TugbankClient` cache behavior, `FeedId` round-trip | Core logic, edge cases |
| **Integration** | Test cross-connection change detection, DEFAULTS feed push | End-to-end flows |
| **Golden / Contract** | Verify `FeedId::Defaults` wire encoding | Protocol stability |

---

### Execution Steps {#execution-steps}

#### Step 1: Add FeedId::Defaults to tugcast-core protocol {#step-1}

**Commit:** `feat(tugcast-core): add FeedId::Defaults (0x50) for tugbank domain snapshots`

**References:** [D03] DEFAULTS feed ID is 0x50, Table T01, (#t01-feed-id-assignments, #d03-defaults-feed-id)

**Artifacts:**
- Modified `tugcode/crates/tugcast-core/src/protocol.rs` — new `Defaults = 0x50` variant

**Tasks:**
- [ ] Add `Defaults = 0x50` variant to `FeedId` enum in `protocol.rs`
- [ ] Add `0x50 => Some(FeedId::Defaults)` to `from_byte` match arm
- [ ] Add round-trip test for `FeedId::Defaults`
- [ ] Add golden wire-format test for a DEFAULTS frame

**Tests:**
- [ ] `test_feedid_defaults_from_byte`: `FeedId::from_byte(0x50) == Some(FeedId::Defaults)`
- [ ] `test_feedid_defaults_as_byte`: `FeedId::Defaults.as_byte() == 0x50`
- [ ] `test_round_trip_defaults`: encode/decode round-trip with sample payload

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo nextest run -p tugcast-core`

---

#### Step 2: Implement TugbankClient in tugbank-core {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugbank-core): add TugbankClient with in-memory cache and data_version polling`

**References:** [D01] Dedicated std::thread with channel for polling, [D02] TugbankClient wraps DefaultsStore internally, Spec S01, Spec S02, (#s01-client-lifecycle, #s02-client-read-write, #d01-polling-thread, #d02-client-wraps-store)

**Artifacts:**
- New file `tugcode/crates/tugbank-core/src/client.rs`
- Modified `tugcode/crates/tugbank-core/src/lib.rs` — add `mod client` and re-exports

**Tasks:**
- [ ] Create `client.rs` with `TugbankClient` struct holding: `DefaultsStore`, `Arc<Mutex<HashMap<String, DomainSnapshot>>>` for cache, `Arc<AtomicBool>` for shutdown signal, `JoinHandle<()>` for polling thread
- [ ] Implement `TugbankClient::open(path, poll_interval)` — opens `DefaultsStore`, spawns polling thread
- [ ] Implement `TugbankClient::from_store(store, poll_interval)` — wraps existing store
- [ ] Implement `store(&self) -> &DefaultsStore` for raw access
- [ ] Implement `get(domain, key)` — loads domain into cache on first access, then reads from cache
- [ ] Implement `set(domain, key, value)` — writes to DB via `DefaultsStore`, updates cache
- [ ] Implement `read_domain(domain)` — returns cached snapshot, loading on first access
- [ ] Implement `data_version(&self)` — calls `PRAGMA data_version` on the connection
- [ ] Implement `on_domain_changed(callback)` — registers callback, returns `CallbackHandle`
- [ ] Implement polling thread: loop on `poll_interval`, check `PRAGMA data_version`, on change reload affected domain generations and snapshots, fire callbacks
- [ ] Implement `Drop` for `TugbankClient` — sets shutdown flag, joins polling thread
- [ ] Add `mod client` to `lib.rs`, re-export `TugbankClient` and `CallbackHandle`
- [ ] Ensure `TugbankClient` is `Send + Sync` (compile-time assertion)

**Tests:**
- [ ] `test_get_caches_value`: after `set` + `get`, a second `get` returns the cached value without DB access
- [ ] `test_set_updates_cache`: `set` followed by `get` returns the new value immediately (no poll needed)
- [ ] `test_external_write_detected`: open two `DefaultsStore` connections to the same file; write via the second; assert `TugbankClient` (wrapping the first) detects the change within 2x poll interval
- [ ] `test_callback_fires_on_external_change`: register `on_domain_changed` callback; write via external connection; assert callback fires
- [ ] `test_shutdown_stops_polling`: after `shutdown()`, the polling thread exits cleanly

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo nextest run -p tugbank-core`

---

#### Step 3: Add DEFAULTS feed to tugcast {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugcast): add DEFAULTS feed for real-time tugbank domain snapshots`

**References:** [D03] DEFAULTS feed ID is 0x50, [D04] Sentinel frame signals sync-complete, [D05] Domain snapshot payload uses existing tagged-value wire format, Spec S03, (#s03-defaults-payload, #d04-sentinel-frame, #d05-snapshot-payload, #strategy)

**Artifacts:**
- New file `tugcode/crates/tugcast/src/feeds/defaults.rs`
- Modified `tugcode/crates/tugcast/src/feeds/mod.rs` — add `pub mod defaults`

**Tasks:**
- [ ] Create `feeds/defaults.rs` with `defaults_feed` function that:
  - Accepts `Arc<TugbankClient>` and returns `watch::Receiver<Frame>`
  - Creates a `watch::Sender<Frame>` for the initial snapshot
  - Registers an `on_domain_changed` callback on `TugbankClient` that serializes the changed domain snapshot to JSON (using `value_to_tagged` from `defaults.rs`) and sends it as a DEFAULTS frame via a broadcast or watch channel
- [ ] Implement initial snapshot logic: on WebSocket connect, push a DEFAULTS frame for every populated domain, then send the sentinel frame `{"sentinel":"sync-complete"}`
- [ ] Wire the defaults feed into tugcast's `main.rs`: create `TugbankClient`, call `defaults_feed`, add the returned `watch::Receiver<Frame>` to `snapshot_watches`
- [ ] Add `pub mod defaults` to `feeds/mod.rs`
- [ ] Make `value_to_tagged` function in `tugcast/src/defaults.rs` `pub(crate)` if not already (it is currently `pub(crate)`)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo nextest run -p tugcast`

---

#### Step 4: Migrate tugcast HTTP handlers to TugbankClient {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(tugcast): migrate HTTP defaults handlers from DefaultsStore to TugbankClient`

**References:** [D02] TugbankClient wraps DefaultsStore internally, (#d02-client-wraps-store, #context)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/defaults.rs` — change `Extension<Arc<DefaultsStore>>` to `Extension<Arc<TugbankClient>>`
- Modified `tugcode/crates/tugcast/src/server.rs` — change `Arc<DefaultsStore>` to `Arc<TugbankClient>` in extension layer

**Tasks:**
- [ ] In `defaults.rs`, change all four handler signatures from `Extension<Arc<DefaultsStore>>` to `Extension<Arc<TugbankClient>>`
- [ ] In each handler, replace `store.domain(&domain)?` with `client.store().domain(&domain)?` (delegate to underlying store)
- [ ] In `server.rs`, change the `bank_store` type from `Option<Arc<DefaultsStore>>` to `Option<Arc<TugbankClient>>` and update the extension layer accordingly
- [ ] In `main.rs`, pass the `Arc<TugbankClient>` created in Step 3 to the server's extension layer instead of creating a separate `DefaultsStore`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo build`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo nextest run -p tugcast`

---

#### Step 5: Add DEFAULTS feed ID to tugdeck protocol.ts {#step-5}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add DEFAULTS feed ID (0x50) to protocol constants`

**References:** [D03] DEFAULTS feed ID is 0x50, Table T01, (#t01-feed-id-assignments)

**Artifacts:**
- Modified `tugdeck/src/protocol.ts` — add `DEFAULTS: 0x50` to `FeedId` const

**Tasks:**
- [ ] Add `DEFAULTS: 0x50,` to the `FeedId` const object in `protocol.ts` (between `CODE_INPUT` and `CONTROL`)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && npx tsc --noEmit`

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Dedicated std::thread with channel for polling, [D02] TugbankClient wraps DefaultsStore internally, [D03] DEFAULTS feed ID is 0x50, [D04] Sentinel frame signals sync-complete, (#success-criteria)

**Tasks:**
- [ ] Verify all existing tugcast tests pass (HTTP handlers still work via `TugbankClient`)
- [ ] Verify tugbank-core tests pass (new `TugbankClient` tests + existing `DefaultsStore` tests)
- [ ] Verify tugcast-core tests pass (new `FeedId::Defaults` tests + existing protocol tests)
- [ ] Verify tugdeck TypeScript compiles with new `DEFAULTS` feed ID

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugcode && cargo nextest run`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && npx tsc --noEmit`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A production-ready `TugbankClient` in `tugbank-core` with in-memory caching and change detection, integrated into tugcast with a DEFAULTS WebSocket feed that pushes real-time domain snapshots to connected clients.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `TugbankClient` is `Send + Sync` and passes all unit and integration tests (`cargo nextest run -p tugbank-core`)
- [ ] `FeedId::Defaults` (0x50) exists in both Rust (`tugcast-core`) and TypeScript (`tugdeck/protocol.ts`)
- [ ] tugcast starts with `TugbankClient` instead of raw `DefaultsStore` — all existing HTTP handler tests pass
- [ ] DEFAULTS feed pushes initial snapshots + sentinel on WebSocket connect
- [ ] External writes to `~/.tugbank.db` trigger DEFAULTS frame pushes within the poll interval

**Acceptance tests:**
- [ ] `cargo nextest run` passes for all workspace crates
- [ ] `cd tugdeck && npx tsc --noEmit` passes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 2: `tugbank-ffi` crate with `extern "C"` functions for Swift
- [ ] Phase 3: TypeScript `TugbankClient` in tugdeck consuming DEFAULTS feed
- [ ] Phase 4: Swift `TugbankClient` in tugapp over `tugbank-ffi`
- [ ] Phase 5: tugtalk migration from `Bun.spawnSync` to `bun:sqlite`

| Checkpoint | Verification |
|------------|--------------|
| TugbankClient caches reads | `cargo nextest run -p tugbank-core -- test_get_caches_value` |
| External change detection | `cargo nextest run -p tugbank-core -- test_external_write_detected` |
| FeedId::Defaults protocol | `cargo nextest run -p tugcast-core -- test_feedid_defaults` |
| HTTP handlers work with TugbankClient | `cargo nextest run -p tugcast` |
| Full workspace builds | `cd tugcode && cargo build` |
