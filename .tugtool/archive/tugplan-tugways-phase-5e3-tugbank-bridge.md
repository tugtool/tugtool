## Tugways Phase 5e3: Tugcast HTTP Bridge for Tugbank {#phase-5e3-tugbank-bridge}

**Purpose:** Wire the tugbank-core library into the tugcast HTTP server so the frontend can read and write typed defaults via four REST endpoints, completing the backend persistence layer before Phase 5e4 migrates the frontend.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 5e1 and 5e2 delivered `tugbank-core` (a SQLite-backed typed defaults store) and the `tugbank` CLI. The tugcast HTTP server currently persists deck settings via a flat JSON file (`settings.rs`). Phase 5e3 bridges tugbank-core into tugcast so the frontend can access typed, domain-separated defaults over HTTP. This is a pure backend change — the frontend continues using the legacy `/api/settings` endpoint until Phase 5e4 migrates it.

#### Strategy {#strategy}

- Add `tugbank-core` as a dependency of the `tugcast` crate and open the database at startup.
- Introduce a `--bank-path` CLI flag with `~/.tugbank.db` as the default path.
- Create a new `defaults.rs` module in tugcast containing all four HTTP handler functions.
- Use `Arc<DefaultsStore>` shared via axum `Extension`, matching the existing `SettingsState` pattern.
- Wrap all blocking `tugbank-core` calls in `tokio::task::spawn_blocking` since rusqlite is synchronous.
- Use a tagged-object JSON wire format (`{"kind":"string","value":"dark"}`) for PUT request bodies and all value responses.
- Add integration tests following the existing `build_settings_test_app` pattern.

#### Success Criteria (Measurable) {#success-criteria}

- `GET /api/defaults/<domain>` returns 200 with a JSON object mapping all keys to tagged values (verified by integration test)
- `GET /api/defaults/<domain>/<key>` returns 200 with the tagged value, or 404 when the key does not exist (verified by integration test)
- `PUT /api/defaults/<domain>/<key>` with a tagged-object body writes the value and returns 200 (verified by integration test)
- `DELETE /api/defaults/<domain>/<key>` removes the key and returns 200, or returns 404 when the key does not exist (verified by integration test)
- All four endpoints reject non-loopback connections with 403 (verified by integration test)
- `cargo nextest run` passes with zero warnings in the tugcast crate

#### Scope {#scope}

1. Add `tugbank-core` dependency to `tugcast/Cargo.toml`
2. Add `--bank-path` CLI flag to `tugcast/src/cli.rs`
3. Create `tugcast/src/defaults.rs` with handler functions and `DefaultsState` type
4. Wire routes and `DefaultsState` Extension into `tugcast/src/server.rs`
5. Open `DefaultsStore` in `tugcast/src/main.rs` at startup
6. Add integration tests to `tugcast/src/integration_tests.rs`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Frontend changes (Phase 5e4)
- Migration of existing `/api/settings` data to tugbank (Phase 5e4)
- Removing or modifying the legacy `/api/settings` endpoint
- CAS (compare-and-swap) HTTP endpoints — Phase 5e3 exposes simple get/set/delete only

#### Dependencies / Prerequisites {#dependencies}

- `tugbank-core` crate is complete and passing tests (Phase 5e1)
- `tugbank` CLI crate is complete (Phase 5e2)
- `tugcast` builds and passes tests on current main

#### Constraints {#constraints}

- All endpoints must enforce loopback-only access (non-loopback returns 403), matching `/api/settings` and `/api/tell`
- `tugbank-core` uses synchronous rusqlite; all handler calls must be wrapped in `tokio::task::spawn_blocking`
- Warnings are errors (`-D warnings` in `.cargo/config.toml`)

#### Assumptions {#assumptions}

- The `DefaultsStore` is opened once at startup and shared via `Arc<DefaultsStore>` across all handlers
- The four endpoints are mounted at `/api/defaults/:domain` and `/api/defaults/:domain/:key`
- The `GET /api/defaults/<domain>` endpoint returns a JSON object mapping all keys to their tagged values
- `GET /api/defaults/<domain>/<key>` returns 404 when the key does not exist — this is handler-level logic based on `DomainHandle::get()` returning `None`, not a tugbank-core error variant. `DELETE` similarly returns 404 based on `DomainHandle::remove()` returning `false`. This 404 behavior is consistent with the tugbank CLI's exit code 2 for missing keys.
- Phase 5e3 does not touch `settings.rs` or `settings-api.ts`
- Integration tests follow the `build_settings_test_app` helper pattern

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

All anchors use kebab-case, are explicit, and follow the prefix conventions defined in the skeleton.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| spawn_blocking overhead | low | low | SQLite ops are fast (<1ms); overhead is negligible | If profiling shows >5ms per handler call |
| Database locked under concurrent requests | med | low | WAL mode + 5s busy timeout already configured in tugbank-core | If integration tests show SQLITE_BUSY errors |

**Risk R01: spawn_blocking overhead** {#r01-spawn-blocking}

- **Risk:** `tokio::task::spawn_blocking` adds thread-pool scheduling overhead to every handler call.
- **Mitigation:** SQLite operations in tugbank-core are sub-millisecond for typical payloads. The spawn_blocking overhead (~microseconds) is negligible compared to HTTP round-trip latency.
- **Residual risk:** Very high-frequency writes could saturate the blocking thread pool, but this is not a realistic scenario for defaults storage.

---

### Design Decisions {#design-decisions}

#### [D01] DefaultsStore shared via Arc + Extension (DECIDED) {#d01-arc-extension}

**Decision:** Wrap `DefaultsStore` in `Arc<DefaultsStore>` and share it with handlers via an axum `Extension` layer, consistent with how `SettingsState` is shared today.

**Rationale:**
- `DefaultsStore` is already `Send + Sync` (internal `Mutex<Connection>`)
- The Extension pattern is established in `server.rs` for `SettingsState`
- No need for a wrapper struct — `Arc<DefaultsStore>` is sufficient since there is no write lock needed (tugbank-core handles its own locking internally)

**Implications:**
- Handlers extract `Extension(Arc<DefaultsStore>)` directly
- The `build_app` function signature gains a `bank_path: Option<PathBuf>` parameter to open the store

#### [D02] CLI flag + default for bank path (DECIDED) {#d02-bank-path-flag}

**Decision:** Hard-code `~/.tugbank.db` as the default database path and add a `--bank-path` CLI flag to `tugcast`'s `cli.rs` for override.

**Rationale:**
- Matches the default path used by the `tugbank` CLI (Phase 5e2)
- CLI flag enables testing and development with alternate database files
- `dirs::home_dir()` provides cross-platform home directory resolution

**Implications:**
- `cli.rs` gains a new `--bank-path` optional field
- `main.rs` resolves the default at startup if no flag is provided
- Tests use `tempfile::NamedTempFile` for isolated database files

#### [D03] Tagged-object wire format for typed values (DECIDED) {#d03-tagged-object}

**Decision:** Use `{"kind":"<type>","value":<payload>}` as the JSON wire format for all value representations, both in PUT request bodies and GET responses.

**Rationale:**
- Explicit type tag is unambiguous for all Value variants
- Bytes values use base64 encoding in the `value` field
- JSON values embed the JSON payload directly in the `value` field
- Null is represented as `{"kind":"null"}` (no `value` field)

**Implications:**
- A `TaggedValue` serde struct is defined in `defaults.rs` for serialization/deserialization
- The `kind` field uses lowercase strings: `"null"`, `"bool"`, `"i64"`, `"f64"`, `"string"`, `"bytes"`, `"json"`
- Base64 encoding/decoding is needed for `Bytes` values (standard base64 from the `base64` crate, or manual implementation)

#### [D04] spawn_blocking for all handler calls (DECIDED) {#d04-spawn-blocking}

**Decision:** Wrap each tugbank-core call in `tokio::task::spawn_blocking` to avoid blocking the Tokio runtime.

**Rationale:**
- `rusqlite::Connection` operations are synchronous and hold a mutex lock
- Standard Tokio pattern for blocking I/O
- Keeps the async runtime responsive for WebSocket and other concurrent operations

**Implications:**
- Each handler clones the `Arc<DefaultsStore>` into the blocking closure
- Error mapping converts `tugbank_core::Error` to appropriate HTTP status codes

#### [D05] Error mapping from tugbank-core to HTTP status codes (DECIDED) {#d05-error-mapping}

**Decision:** Map tugbank-core errors to HTTP status codes as follows:

| tugbank-core Error | HTTP Status | Response body |
|-------------------|-------------|---------------|
| `InvalidDomain` | 400 Bad Request | `{"status":"error","message":"invalid domain"}` |
| `InvalidKey` | 400 Bad Request | `{"status":"error","message":"invalid key"}` |
| `ValueTooLarge` | 413 Payload Too Large | `{"status":"error","message":"value too large"}` |
| `Serde` (JSON parse) | 400 Bad Request | `{"status":"error","message":"invalid JSON"}` |
| `Sqlite` / other | 500 Internal Server Error | `{"status":"error","message":"internal error"}` |
| Key not found (GET single key) | 404 Not Found | `{"status":"error","message":"not found"}` |
| Key not found (DELETE) | 404 Not Found | `{"status":"error","message":"not found"}` |

**Rationale:**
- Consistent with the error response format used by `/api/settings` and `/api/tell`
- 404 for missing keys matches the tugbank CLI's exit code 2 behavior

**Implications:**
- A helper function `bank_error_to_response` converts `tugbank_core::Error` into `(StatusCode, Json)` tuples

---

### Specification {#specification}

#### Endpoint Specifications {#endpoint-specs}

**Spec S01: GET /api/defaults/:domain** {#s01-get-domain}

Returns all key-value pairs in the specified domain.

- **Method:** GET
- **Path:** `/api/defaults/:domain`
- **Auth:** Loopback-only (403 for non-loopback)
- **Success (200):** JSON object mapping keys to tagged values. Empty domain returns `{}`.

```json
{
  "theme": {"kind": "string", "value": "dark"},
  "font-size": {"kind": "i64", "value": 14}
}
```

- **Error (400):** Invalid domain name (empty string)
- **Error (403):** Non-loopback connection
- **Error (500):** Internal SQLite error

**Spec S02: GET /api/defaults/:domain/:key** {#s02-get-key}

Returns the value for a single key in the specified domain.

- **Method:** GET
- **Path:** `/api/defaults/:domain/:key`
- **Auth:** Loopback-only (403 for non-loopback)
- **Success (200):** Tagged value object.

```json
{"kind": "string", "value": "dark"}
```

- **Error (400):** Invalid domain or key (empty string)
- **Error (403):** Non-loopback connection
- **Error (404):** Key does not exist in domain
- **Error (500):** Internal SQLite error

**Spec S03: PUT /api/defaults/:domain/:key** {#s03-put-key}

Sets a key to a typed value in the specified domain.

- **Method:** PUT
- **Path:** `/api/defaults/:domain/:key`
- **Auth:** Loopback-only (403 for non-loopback)
- **Request body:** Tagged value object.

```json
{"kind": "string", "value": "dark"}
```

- **Success (200):** `{"status": "ok"}`
- **Error (400):** Invalid domain, key, or malformed JSON body
- **Error (403):** Non-loopback connection
- **Error (413):** Value::Bytes payload exceeds 10 MB limit
- **Error (500):** Internal SQLite error

**Spec S04: DELETE /api/defaults/:domain/:key** {#s04-delete-key}

Removes a key from the specified domain.

- **Method:** DELETE
- **Path:** `/api/defaults/:domain/:key`
- **Auth:** Loopback-only (403 for non-loopback)
- **Success (200):** `{"status": "ok"}`
- **Error (400):** Invalid domain or key
- **Error (403):** Non-loopback connection
- **Error (404):** Key does not exist in domain
- **Error (500):** Internal SQLite error

#### Tagged Value Wire Format {#tagged-value-format}

**Table T01: Tagged value kind strings** {#t01-kind-strings}

| Value variant | `kind` string | `value` field type | Example |
|--------------|---------------|-------------------|---------|
| `Null` | `"null"` | absent | `{"kind":"null"}` |
| `Bool` | `"bool"` | boolean | `{"kind":"bool","value":true}` |
| `I64` | `"i64"` | number (integer) | `{"kind":"i64","value":42}` |
| `F64` | `"f64"` | number (float) | `{"kind":"f64","value":3.14}` |
| `String` | `"string"` | string | `{"kind":"string","value":"dark"}` |
| `Bytes` | `"bytes"` | string (base64) | `{"kind":"bytes","value":"AQID"}` |
| `Json` | `"json"` | any JSON value | `{"kind":"json","value":{"a":1}}` |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

None. This phase adds `tugbank-core` as a dependency of the existing `tugcast` crate.

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugcast/src/defaults.rs` | HTTP handlers for `/api/defaults` endpoints, `TaggedValue` serde type, error-to-response mapping |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TaggedValue` | struct | `defaults.rs` | Serde struct with `kind: String` and `value: Option<serde_json::Value>` |
| `value_to_tagged` | fn | `defaults.rs` | Convert `tugbank_core::Value` to `TaggedValue` |
| `tagged_to_value` | fn | `defaults.rs` | Convert `TaggedValue` to `tugbank_core::Value` |
| `get_domain` | async fn | `defaults.rs` | Handler for `GET /api/defaults/:domain` |
| `get_key` | async fn | `defaults.rs` | Handler for `GET /api/defaults/:domain/:key` |
| `put_key` | async fn | `defaults.rs` | Handler for `PUT /api/defaults/:domain/:key` |
| `delete_key` | async fn | `defaults.rs` | Handler for `DELETE /api/defaults/:domain/:key` |
| `bank_error_to_response` | fn | `defaults.rs` | Map `tugbank_core::Error` to HTTP response |
| `--bank-path` | CLI flag | `cli.rs` | Optional override for database path |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `TaggedValue` serialization/deserialization round-trips, value conversion functions | `defaults.rs` module tests |
| **Integration** | Test HTTP endpoints end-to-end via `build_settings_test_app` pattern | `integration_tests.rs` |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.**

#### Step 1: Add tugbank-core dependency and CLI flag {#step-1}

**Commit:** `feat(tugcast): add tugbank-core dependency and --bank-path CLI flag`

**References:** [D02] CLI flag + default for bank path, (#context, #strategy, #dependencies)

**Artifacts:**
- Modified `tugcode/crates/tugcast/Cargo.toml` — add `tugbank-core = { path = "../tugbank-core" }` to `[dependencies]`
- Modified `tugcode/crates/tugcast/src/cli.rs` — add `--bank-path` optional flag
- Add `base64` dependency to `tugcast/Cargo.toml` for bytes encoding (check if workspace already has it, otherwise add to workspace `Cargo.toml`)

**Tasks:**
- [ ] Add `tugbank-core = { path = "../tugbank-core" }` to `[dependencies]` in `tugcast/Cargo.toml`
- [ ] Add `base64` crate dependency for bytes-to-base64 conversion (used by the tagged-object wire format)
- [ ] Add `--bank-path` optional CLI flag to `Cli` struct in `cli.rs`: `pub bank_path: Option<PathBuf>` with `#[arg(long)]`
- [ ] Add unit test for `--bank-path` flag parsing (present and absent cases)
- [ ] Add unit test verifying `--bank-path` appears in `--help` output

**Tests:**
- [ ] T01: `Cli::try_parse_from(["tugcast"])` has `bank_path: None`
- [ ] T02: `Cli::try_parse_from(["tugcast", "--bank-path", "/tmp/test.db"])` has `bank_path: Some("/tmp/test.db")`
- [ ] T03: `--help` output contains `--bank-path`

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` — builds without warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast --lib 2>&1 | tail -5` — all CLI tests pass

---

#### Step 2: Create defaults.rs with TaggedValue and conversion functions {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): add TaggedValue wire format and value conversion functions`

**References:** [D03] Tagged-object wire format, Table T01, (#tagged-value-format)

**Artifacts:**
- New file `tugcode/crates/tugcast/src/defaults.rs`
- `TaggedValue` struct with serde derive
- `value_to_tagged` and `tagged_to_value` conversion functions

**Tasks:**
- [ ] Create `defaults.rs` with module doc comment
- [ ] Define `TaggedValue` struct: `kind: String`, `value: Option<serde_json::Value>`, with `Serialize` and `Deserialize` derives
- [ ] Implement `value_to_tagged(value: &tugbank_core::Value) -> TaggedValue` — convert each Value variant to its tagged representation per Table T01. Use base64 standard encoding for `Bytes`.
- [ ] Implement `tagged_to_value(tagged: &TaggedValue) -> Result<tugbank_core::Value, String>` — parse the tagged object back into a Value. Validate `kind` string and decode base64 for `Bytes`.
- [ ] Add `mod defaults;` to `main.rs`
- [ ] Write unit tests for round-trip conversion of all seven Value variants

**Tests:**
- [ ] T04: `value_to_tagged(Value::Null)` produces `{"kind":"null"}` (no value field)
- [ ] T05: `value_to_tagged(Value::Bool(true))` produces `{"kind":"bool","value":true}`
- [ ] T06: `value_to_tagged(Value::I64(42))` produces `{"kind":"i64","value":42}`
- [ ] T07: `value_to_tagged(Value::F64(3.14))` produces `{"kind":"f64","value":3.14}`
- [ ] T08: `value_to_tagged(Value::String("dark".into()))` produces `{"kind":"string","value":"dark"}`
- [ ] T09: `value_to_tagged(Value::Bytes(vec![1,2,3]))` produces `{"kind":"bytes","value":"AQID"}`
- [ ] T10: `value_to_tagged(Value::Json(json!({"a":1})))` produces `{"kind":"json","value":{"a":1}}`
- [ ] T11: Round-trip: `tagged_to_value(value_to_tagged(v))` equals `v` for each variant
- [ ] T12: `tagged_to_value` with unknown kind string returns error

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` — builds without warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast --lib 2>&1 | tail -5` — all TaggedValue tests pass

---

#### Step 3: Implement HTTP handler functions {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugcast): implement defaults HTTP handler functions`

**References:** [D01] Arc + Extension, [D04] spawn_blocking, [D05] Error mapping, Spec S01, Spec S02, Spec S03, Spec S04, (#endpoint-specs)

**Artifacts:**
- Extended `tugcode/crates/tugcast/src/defaults.rs` — four handler functions plus `bank_error_to_response`

**Tasks:**
- [ ] Implement `bank_error_to_response(err: tugbank_core::Error) -> Response` mapping per [D05]
- [ ] Implement `get_domain` handler: extract `ConnectInfo` for loopback check, extract `Extension(Arc<DefaultsStore>)`, extract path param `:domain`, call `store.domain(d).read_all()` inside `spawn_blocking`, convert each value via `value_to_tagged`, return JSON object
- [ ] Implement `get_key` handler: same loopback check, extract `:domain` and `:key`, call `store.domain(d).get(k)` inside `spawn_blocking`, return tagged value or 404
- [ ] Implement `put_key` handler: same loopback check, parse body as `TaggedValue`, call `tagged_to_value` — if this returns `Err(String)`, return 400 Bad Request with `{"status":"error","message":"<detail>"}` (this is separate from `bank_error_to_response` which handles `tugbank_core::Error`). On success, call `store.domain(d).set(k, v)` inside `spawn_blocking`, return `{"status":"ok"}`
- [ ] Implement `delete_key` handler: same loopback check, call `store.domain(d).remove(k)` inside `spawn_blocking`, return `{"status":"ok"}` or 404 if key did not exist
- [ ] All handlers use `pub(crate)` visibility (consistent with `settings.rs` handlers)
- [ ] Add unit tests for `bank_error_to_response` mapping

**Tests:**
- [ ] T13: `bank_error_to_response(Error::InvalidDomain(_))` returns 400
- [ ] T14: `bank_error_to_response(Error::InvalidKey(_))` returns 400
- [ ] T15: `bank_error_to_response(Error::ValueTooLarge{..})` returns 413
- [ ] T16: `bank_error_to_response(Error::Sqlite(_))` returns 500

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` — builds without warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast --lib 2>&1 | tail -5` — all handler unit tests pass

---

#### Step 4: Wire routes and DefaultsStore into server.rs and main.rs {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugcast): wire defaults routes and DefaultsStore into server startup`

**References:** [D01] Arc + Extension, [D02] CLI flag + default for bank path, (#scope, #strategy)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/server.rs` — add defaults routes and Extension layer
- Modified `tugcode/crates/tugcast/src/main.rs` — open DefaultsStore at startup

**Tasks:**
- [ ] In `server.rs` `build_app`: add `bank_path: Option<PathBuf>` parameter. When `Some`, open `DefaultsStore::open(path)`, wrap in `Arc`, add as `Extension` and register the defaults routes. When `None` (tests that do not exercise defaults), do not register the defaults routes or Extension — this avoids a missing-Extension panic since no defaults routes are reachable.
- [ ] Add routes: `.route("/api/defaults/:domain", get(defaults::get_domain))` and `.route("/api/defaults/:domain/:key", get(defaults::get_key).put(defaults::put_key).delete(defaults::delete_key))`
- [ ] In `main.rs`: resolve bank path from CLI flag or default (`dirs::home_dir().join(".tugbank.db")` or `PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".tugbank.db")`). Pass to `build_app`.
- [ ] Update `run_server` signature if needed to pass bank path through
- [ ] Update all existing `build_app` call sites (main.rs, integration_tests.rs) for the new parameter
- [ ] Verify the legacy `/api/settings` routes remain fully operational and unchanged

**Tests:**
- [ ] T17: Existing settings integration tests still pass (regression check)

**Checkpoint:**
- [ ] `cd tugcode && cargo build 2>&1 | head -5` — builds without warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast 2>&1 | tail -5` — all existing tests pass

---

#### Step 5: Add integration tests for defaults endpoints {#step-5}

**Depends on:** #step-4

**Commit:** `test(tugcast): add integration tests for /api/defaults endpoints`

**References:** Spec S01, Spec S02, Spec S03, Spec S04, [D03] Tagged-object wire format, [D05] Error mapping, Table T01, (#endpoint-specs, #success-criteria)

**Artifacts:**
- Extended `tugcode/crates/tugcast/src/integration_tests.rs` — new test helper and tests for defaults endpoints

**Tasks:**
- [ ] Create `build_defaults_test_app()` helper that creates a temp database via `NamedTempFile`, opens a `DefaultsStore`, and builds the app with the bank path set. Use `MockConnectInfo` with loopback address.
- [ ] Write integration test: GET domain that has never been written to — verify 200 with `{}`
- [ ] Write integration test: PUT a string value, then GET the single key — verify round-trip
- [ ] Write integration test: PUT multiple values to a domain, then GET domain — verify all keys returned with correct tagged values
- [ ] Write integration test: GET non-existent key — verify 404 response
- [ ] Write integration test: DELETE existing key — verify 200 and subsequent GET returns 404
- [ ] Write integration test: DELETE non-existent key — verify 404
- [ ] Write integration test: PUT with invalid JSON body — verify 400
- [ ] Write integration test: PUT with unknown kind string — verify 400
- [ ] Write integration test: Non-loopback connection to GET — verify 403
- [ ] Write integration test: All seven Value variants round-trip through PUT then GET (null, bool, i64, f64, string, bytes, json)

**Tests:**
- [ ] T18: GET domain that has never been written to — 200 with `{}`
- [ ] T19: PUT string then GET key — 200 with `{"kind":"string","value":"dark"}`
- [ ] T20: PUT multiple keys then GET domain — 200 with all keys in response
- [ ] T21: GET non-existent key — 404
- [ ] T22: DELETE existing key — 200, then GET returns 404
- [ ] T23: DELETE non-existent key — 404
- [ ] T24: PUT invalid JSON — 400
- [ ] T25: PUT unknown kind — 400
- [ ] T26: GET from non-loopback — 403
- [ ] T27: All seven Value variants round-trip through PUT/GET

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast 2>&1 | tail -10` — all tests pass including new defaults tests
- [ ] `cd tugcode && cargo fmt --all --check` — formatting is clean

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** Spec S01, Spec S02, Spec S03, Spec S04, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all defaults endpoints work end-to-end through integration tests
- [ ] Verify legacy `/api/settings` endpoints remain functional
- [ ] Verify `--bank-path` CLI flag is documented in `--help` output
- [ ] Run full test suite to confirm no regressions

**Tests:**
- [ ] T28: Full cargo nextest run for tugcast crate — all tests pass
- [ ] T29: Full cargo nextest run for tugbank-core crate — all tests pass (no regressions)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run 2>&1 | tail -10` — full workspace passes
- [ ] `cd tugcode && cargo fmt --all --check` — formatting clean
- [ ] `cd tugcode && cargo build 2>&1 | head -5` — zero warnings

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tugcast exposes tugbank via four HTTP REST endpoints (`GET/PUT/DELETE` on `/api/defaults/<domain>` and `/api/defaults/<domain>/<key>`), enabling the frontend to read and write typed defaults without touching the legacy settings system.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All four endpoints return correct status codes and response bodies per Specs S01-S04 (verified by integration tests)
- [ ] Non-loopback connections are rejected with 403 on all four endpoints (verified by integration test)
- [ ] The legacy `/api/settings` endpoint is unchanged and all its existing tests pass
- [ ] `cargo nextest run` passes with zero warnings across the full workspace
- [ ] `cargo fmt --all --check` passes

**Acceptance tests:**
- [ ] T18-T27: Defaults endpoint integration tests all pass
- [ ] T28-T29: Full workspace test suite passes with no regressions

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5e4: Migrate frontend from `/api/settings` to `/api/defaults` endpoints
- [ ] Phase 5e4: Add migration logic to convert flat settings file to tugbank domains
- [ ] CAS HTTP endpoints for optimistic concurrency (future phase if needed)

| Checkpoint | Verification |
|------------|--------------|
| Dependency wired | `cargo build -p tugcast` succeeds |
| CLI flag works | `--help` shows `--bank-path` |
| Handlers compile | `cargo build -p tugcast` with defaults.rs |
| Routes registered | Integration tests hit endpoints successfully |
| Full suite green | `cargo nextest run` — zero failures, zero warnings |
