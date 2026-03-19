<!-- tugplan-skeleton v2 -->

## Shared Settings Across Dev/Production Modes {#shared-settings}

**Purpose:** Eliminate layout and theme loss when switching between dev mode (port 55155) and production mode (port 55255) by persisting deck settings through tugcast's API rather than origin-scoped localStorage.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | shared-settings |
| Last updated | 2026-03-01 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Card layout and theme settings are lost when switching between dev mode and production mode because localStorage is scoped by origin (protocol + host + port). Dev mode loads from `http://127.0.0.1:55155` (Vite) and production loads from `http://127.0.0.1:55255` (tugcast). These are different origins with completely separate localStorage stores.

The Swift app's `syncLocalStorageOnPageLoad()` approach attempted to bridge this gap via UserDefaults, but it fires after page JavaScript has already executed -- by the time the injection runs, DeckManager has already initialized with the default layout from empty localStorage. A previous `WKUserScript` at `.atDocumentStart` attempt also failed for undiagnosed reasons.

#### Strategy {#strategy}

- Add `GET /api/settings` and `POST /api/settings` endpoints to tugcast that persist deck layout and theme to `.tugtool/deck-settings.json`
- Make frontend initialization async: fetch settings from the API before constructing DeckManager, retrying with exponential backoff until tugcast responds
- Apply theme to `document.body` before React renders so `readCurrentTheme()` picks it up from the DOM
- On layout/theme save, POST settings to the API (fire-and-forget, piggybacking on existing debounce)
- Remove broken Swift sync code (`syncLocalStorageOnPageLoad`, `bridgePageDidLoad`, layout/theme UserDefaults keys) since the API replaces it entirely
- Use atomic file writes (write to temp file, then rename) to prevent corruption

#### Success Criteria (Measurable) {#success-criteria}

- `GET /api/settings` returns `200 OK` with valid JSON when `.tugtool/deck-settings.json` exists (verify with `curl http://127.0.0.1:55255/api/settings`)
- `POST /api/settings` with a JSON body writes to `.tugtool/deck-settings.json` and returns `200 OK` (verify with `curl -X POST`)
- `GET /api/settings` returns `200 OK` with `{}` when no `source_tree` is configured (graceful degradation)
- `POST /api/settings` returns `200 OK` and silently discards when no `source_tree` is configured
- Layout saved in production mode appears when loading in dev mode, and vice versa (manual test: rearrange cards in one mode, switch to the other, verify same layout)
- Theme set in one mode persists when loading in the other mode (manual test: change theme, switch modes, verify)
- Frontend retries settings fetch with exponential backoff (~100ms initial, ~2s cap) until tugcast responds -- no localStorage fallback
- `syncLocalStorageOnPageLoad()`, `bridgePageDidLoad()`, `keyTugdeckLayout`, and `keyTugdeckTheme` are removed from Swift code
- `cargo nextest run` passes for tugcast crate
- TypeScript builds without errors (`npx tsc --noEmit` in tugdeck)

#### Scope {#scope}

1. New `settings.rs` module in tugcast with `DeckSettings` struct, load/save functions, and GET/POST handlers
2. Route registration in `build_app` for `/api/settings`
3. Frontend async initialization in `main.tsx` with retry loop
4. DeckManager constructor change to accept optional pre-fetched layout
5. Save-path changes in `deck-manager.ts` and `use-theme.ts` to POST settings to API
6. Swift cleanup: remove broken sync code and unused UserDefaults keys

#### Non-goals (Explicitly out of scope) {#non-goals}

- Per-user or per-session settings -- single settings file per source tree
- Authentication or authorization for settings endpoints beyond loopback IP check
- Migration of existing localStorage data to the settings file
- Settings UI changes or new settings beyond layout and theme
- Versioning or schema migration for the settings file format

#### Dependencies / Prerequisites {#dependencies}

- tugcast already receives `source_tree` (as `watch_dir`) in `build_app` via `server.rs`
- Vite proxy for `/api` to tugcast on port 55255 is already configured in `vite.config.ts`
- `serde_json` and `tokio::fs` are already available in tugcast's dependency tree
- `.tugtool/` directory convention is established for tugtool metadata

#### Constraints {#constraints}

- Loopback-only access for settings endpoints (consistent with `/api/tell`)
- Atomic file writes to prevent corruption from interrupted writes
- No localStorage fallback on settings fetch -- falling back would reproduce the origin-scoping bug
- Warnings are errors in tugcast (`-D warnings` via `.cargo/config.toml`)

#### Assumptions {#assumptions}

- The settings path is derived from `source_tree` in `build_app` by joining `.tugtool/deck-settings.json`
- The retry loop in `fetchSettingsWithRetry` uses exponential backoff starting at ~100ms, capped at ~2s, with no maximum retry count
- DeckManager constructor changes to accept optional pre-fetched layout: `new DeckManager(container, connection, initialLayout?)`
- Container `clientWidth`/`clientHeight` is available because the container is in the DOM before the async IIFE fires
- `bridgePageDidLoad()` protocol method and its implementation are both removed from `MainWindow.swift` and `AppDelegate.swift`
- `keyTugdeckLayout` and `keyTugdeckTheme` constants removed from `TugConfig.swift`
- Settings module at `tugcode/crates/tugcast/src/settings.rs` following existing one-module-per-concern pattern
- POST body Content-Type is `application/json`

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per the skeleton contract. All anchors are kebab-case, all decisions use `[DNN]` format, all steps use step-N anchor style.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Settings fetch delays startup | med | low | Sub-ms local loopback latency; retry with backoff | If users report visible delay on page load |
| File corruption on crash during write | med | low | Atomic write (temp file + rename) | If corrupted settings files are reported |
| Frontend blocks forever if tugcast never starts | high | low | No cap on retries by design: nothing else works without tugcast either | If a use case emerges where frontend should load without tugcast |
| Concurrent POST race condition | med | med | tokio::sync::Mutex serializes read-modify-write in post_settings | If Mutex contention causes latency (unlikely for single-user local app) |

**Risk R01: Startup latency from settings fetch** {#r01-startup-latency}

- **Risk:** Making frontend initialization async could add visible delay before the UI renders
- **Mitigation:** The fetch is a local HTTP call to `127.0.0.1:55255` (or proxied through Vite). Round-trip latency is sub-millisecond. Theme is applied to `document.body` before React mounts, so there is no flash.
- **Residual risk:** On very first page load after tugcast starts, the settings endpoint may not be immediately ready, adding one retry cycle (~100ms).

**Risk R02: File corruption** {#r02-file-corruption}

- **Risk:** Interrupted writes to `deck-settings.json` could leave a corrupted file
- **Mitigation:** Atomic writes: write to a temp file in the same directory, then rename. `rename(2)` is atomic on POSIX. On read, invalid JSON falls back to empty defaults.
- **Residual risk:** Temp file could be orphaned if the process is killed between write and rename, but this is cosmetic.

---

### Design Decisions {#design-decisions}

#### [D01] Tugcast API endpoint for settings persistence (DECIDED) {#d01-api-endpoint}

**Decision:** Add `GET /api/settings` and `POST /api/settings` routes to tugcast that persist to `.tugtool/deck-settings.json`. The frontend fetches settings from the API before initializing and POSTs settings on save.

**Rationale:**
- Both dev and production modes proxy `/api` to the same tugcast instance on port 55255, so sharing is automatic
- Eliminates WKWebView timing issues entirely -- no Swift-side sync needed
- Consistent with existing `/api/tell` pattern
- File persistence is simple: `serde_json` and `tokio::fs` already available

**Implications:**
- Frontend initialization becomes async (fetch before render)
- New `settings.rs` module in tugcast
- `source_tree` path must be accessible to settings handlers

#### [D02] Loopback-only access for settings endpoints (DECIDED) {#d02-loopback-only}

**Decision:** Restrict `/api/settings` to loopback IP connections, matching the existing `/api/tell` pattern.

**Rationale:**
- Consistent with existing security model
- Settings contain only layout geometry and theme name -- not sensitive, but no reason to expose externally
- Simpler than adding authentication

**Implications:**
- Both handlers extract `ConnectInfo<SocketAddr>` and reject non-loopback IPs with 403

#### [D03] No localStorage fallback on settings fetch (DECIDED) {#d03-no-fallback}

**Decision:** The frontend retries the settings fetch with exponential backoff until tugcast responds. No fallback to localStorage.

**Rationale:**
- localStorage on a fresh origin gives the default layout -- the exact bug we are fixing
- Nothing else works without tugcast (no WebSocket, no terminal, no API), so waiting is not an additional constraint
- Retrying is the correct behavior: the user cannot interact meaningfully until tugcast is running

**Implications:**
- `fetchSettingsWithRetry` has no maximum retry count
- Exponential backoff: ~100ms initial, ~2s cap
- Frontend shows nothing until settings are fetched (sub-ms in normal case)

#### [D04] Atomic file writes for settings persistence (DECIDED) {#d04-atomic-writes}

**Decision:** Write settings to a temp file in the same directory, then rename to the target path.

**Rationale:**
- `rename(2)` is atomic on POSIX filesystems
- Prevents corruption from interrupted writes or concurrent reads
- Standard pattern for safe file persistence

**Implications:**
- Temp file created in `.tugtool/` directory alongside `deck-settings.json`
- On read failure (invalid JSON or missing file), return empty defaults

#### [D05] Settings state via axum Extension layer with Mutex (DECIDED) {#d05-settings-path}

**Decision:** Store the settings file path and a serialization mutex in a `SettingsState` struct, wrapped in `Arc` and added as an axum `Extension` on the router, derived from `source_tree` in `build_app`.

**Rationale:**
- `source_tree` is already passed to `build_app` as `Option<PathBuf>`
- Using `Extension` avoids modifying the `FeedRouter` struct, which manages unrelated WebSocket/feed state
- The `post_settings` handler performs a read-modify-write (load existing, merge, save). Without serialization, concurrent POSTs could race and lose updates. A `tokio::sync::Mutex` serializes access to the settings file.
- Concurrent POST requests are possible: layout save and theme save can fire independently from the frontend's debounce timer and the theme setter.

**Implications:**
- New `SettingsState { path: Option<PathBuf>, lock: tokio::sync::Mutex<()> }` struct in `settings.rs`, wrapped in `Arc<SettingsState>`
- `build_app` creates the state and adds it as a layer via `Extension(Arc::new(SettingsState { ... }))`
- `post_settings` acquires `lock` before the read-modify-write cycle; `get_settings` does not need the lock (reads are atomic with atomic file writes)
- Handlers extract `Extension<Arc<SettingsState>>` to get the path and lock

#### [D06] Graceful degradation when source_tree is None (DECIDED) {#d06-no-source-tree}

**Decision:** When `source_tree` is `None`, `GET /api/settings` returns `{}` and `POST /api/settings` silently discards the payload, both returning `200 OK`.

**Rationale:**
- In test environments, `source_tree` may not be set
- Returning empty defaults is safe: the frontend will use its default layout
- Silent discard on POST avoids error noise in environments where persistence is irrelevant

**Implications:**
- Handlers check `SettingsState.path` for `None` before file operations
- No error responses for missing source tree -- graceful degradation

#### [D07] DeckManager accepts optional pre-fetched layout (DECIDED) {#d07-prefetched-layout}

**Decision:** DeckManager constructor accepts an optional third parameter `initialLayout` containing pre-fetched layout as a parsed object (from the API JSON response). If provided and valid, it is used instead of reading from localStorage.

**Rationale:**
- Decouples DeckManager from the fetch mechanism
- Constructor remains synchronous; async work happens in `main.tsx`
- localStorage still serves as a local cache for performance

**Implications:**
- Constructor signature changes: `new DeckManager(container, connection, initialLayout?)`
- `loadLayout()` checks `initialLayout` first, then localStorage, then defaults
- **Type bridge:** The existing `deserialize()` function expects a JSON string, but `initialLayout` is already a parsed object from `fetch().json()`. `loadLayout()` must call `JSON.stringify(initialLayout)` before passing to `deserialize()`.
- On successful load from API, the layout is also written to localStorage as a cache

#### [D08] Theme applied to document.body before React renders (DECIDED) {#d08-theme-before-react}

**Decision:** In the async initialization in `main.tsx`, apply the theme class to `document.body` before constructing DeckManager or any React components. This ensures `readCurrentTheme()` reads the correct theme from the DOM.

**Rationale:**
- `useTheme()` hook reads theme from `document.body.classList` via `readCurrentTheme()` on mount
- Theme must be on the body before any React component calls `readCurrentTheme()`
- Applying the class before React renders eliminates any theme flash

**Implications:**
- Theme class is set directly on `document.body` in the async IIFE, before `new DeckManager()`
- No change to `useTheme()` hook's read path -- it already reads from classList

#### [D09] Null-as-delete merge semantics for POST /api/settings (DECIDED) {#d09-null-as-delete}

**Decision:** POST merge logic uses null-as-delete semantics: if a field in the POST body is explicitly `null`, that field is removed from the stored settings. If a field is absent from the POST body, the existing stored value is preserved.

**Rationale:**
- Normal partial updates send `{ layout: {...} }` with theme absent -- theme is preserved (merge).
- Reset needs to clear all settings. With pure merge semantics, `postSettings({})` would be a no-op since both fields are absent. Sending `{ layout: null, theme: null }` explicitly signals deletion.
- This gives precise control: the frontend can clear individual fields without affecting others.

**Implications:**
- `post_settings` handler parses the body as `serde_json::Value`, not directly as `DeckSettings`. It checks each field: if the key is present with value `null`, delete the field from stored settings; if the key is present with a non-null value, overwrite; if the key is absent, preserve existing.
- Frontend `postSettings()` for reset sends `{ layout: null, theme: null }` instead of `{}`.
- `DeckSettings` struct itself is unchanged (fields are `Option<T>`), but merge logic operates on raw JSON values before deserializing.

---

### Specification {#specification}

#### Settings File Format {#settings-format}

**Spec S01: Settings JSON schema** {#s01-settings-schema}

File location: `{source_tree}/.tugtool/deck-settings.json`

```json
{
  "layout": { "version": 5, "cards": [...] },
  "theme": "brio"
}
```

- `layout`: The v5 layout JSON that `deck-manager.ts` already serializes via `serialize()`. Type: `Option<serde_json::Value>` in Rust. May be absent or null.
- `theme`: One of `"brio"`, `"bluenote"`, `"harmony"`. Type: `Option<String>` in Rust. May be absent or null.

When the file is missing or contains invalid JSON, the GET handler returns `{}` (empty object).

#### API Surface {#api-surface}

**Spec S02: GET /api/settings** {#s02-get-settings}

- **Method:** GET
- **Path:** `/api/settings`
- **Auth:** Loopback IP only (403 for non-loopback)
- **Response (200):** JSON object matching Spec S01 schema. Returns `{}` if file is missing, unreadable, or `source_tree` is None.
- **Response (403):** `{"status":"error","message":"forbidden"}` for non-loopback

**Spec S03: POST /api/settings** {#s03-post-settings}

- **Method:** POST
- **Path:** `/api/settings`
- **Auth:** Loopback IP only (403 for non-loopback)
- **Content-Type:** `application/json`
- **Request body:** JSON object matching Spec S01 schema. Merge semantics with null-as-delete per [D09]: fields present with non-null values overwrite existing fields; fields absent from the body preserve existing values; fields explicitly set to `null` delete the field from stored settings (e.g., `{"layout": null}` removes layout but preserves theme; `{"layout": null, "theme": null}` clears all settings)
- **Response (200):** `{"status":"ok"}`
- **Response (400):** `{"status":"error","message":"invalid JSON"}` for unparseable body
- **Response (403):** `{"status":"error","message":"forbidden"}` for non-loopback

#### Rust Types {#rust-types}

**Spec S04: DeckSettings struct** {#s04-deck-settings}

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct DeckSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
}
```

**Spec S05: SettingsState struct** {#s05-settings-state}

```rust
pub(crate) struct SettingsState {
    pub path: Option<PathBuf>,
    pub lock: tokio::sync::Mutex<()>,
}
```

Wrapped in `Arc<SettingsState>` and added as an axum `Extension`. The `lock` serializes read-modify-write operations in `post_settings` to prevent concurrent POST race conditions. `get_settings` does not acquire the lock.

#### Frontend Types {#frontend-types}

**Spec S06: fetchSettingsWithRetry function** {#s06-fetch-settings}

```typescript
interface ServerSettings {
  layout?: object | null;  // v5 layout JSON; null to delete
  theme?: string | null;   // "brio" | "bluenote" | "harmony"; null to delete
}

async function fetchSettingsWithRetry(url: string): Promise<ServerSettings>
```

- Exponential backoff: starts at ~100ms, doubles each retry, caps at ~2s
- No maximum retry count
- Returns parsed JSON on success
- Logs each retry attempt to console.debug
- When calling `postSettings()`, fields set to `null` signal deletion per [D09]. Absent fields are preserved.

#### Data Flow {#data-flow}

**Table T01: Save flow** {#t01-save-flow}

| Phase | Actor | Action |
|-------|-------|--------|
| S1 | User | Drags/resizes a card or changes theme |
| S2 | DeckManager | `scheduleSave()` starts 500ms debounce timer |
| S3 | DeckManager | `saveLayout()` fires after debounce |
| S4 | DeckManager | Writes layout to localStorage (local cache) |
| S5 | DeckManager | Fire-and-forget `POST /api/settings` with `{ layout, theme }` |
| S6 | Vite proxy (dev) or direct (prod) | Routes to tugcast on port 55255 |
| S7 | tugcast | Merges with existing settings, atomic writes to `.tugtool/deck-settings.json` |

**Table T02: Load flow** {#t02-load-flow}

| Phase | Actor | Action |
|-------|-------|--------|
| L1 | Browser | Page loads, `main.tsx` executes |
| L2 | main.tsx | `fetchSettingsWithRetry("/api/settings")` with retry loop |
| L3 | Vite proxy (dev) or direct (prod) | Routes to tugcast on port 55255 |
| L4 | tugcast | Reads `.tugtool/deck-settings.json`, returns JSON |
| L5 | main.tsx | Applies theme to `document.body.classList` |
| L6 | main.tsx | Passes layout to `new DeckManager(container, connection, layout)` |
| L7 | DeckManager | `JSON.stringify`s the pre-fetched layout object, passes to `deserialize()`, writes to localStorage as cache |

#### Swift Cleanup {#swift-cleanup}

**List L01: Swift artifacts to remove** {#l01-swift-removals}

| Artifact | File | Reason |
|----------|------|--------|
| `syncLocalStorageOnPageLoad()` method | `AppDelegate.swift` | Replaced by API-based settings |
| `bridgePageDidLoad()` protocol method | `MainWindow.swift` (BridgeDelegate protocol) | Called `syncLocalStorageOnPageLoad`; no longer needed |
| `bridgePageDidLoad()` implementation | `AppDelegate.swift` | Calls removed `syncLocalStorageOnPageLoad` |
| `bridgePageDidLoad()` call in `didFinishNavigation` | `MainWindow.swift` | Trigger for removed sync |
| `keyTugdeckLayout` constant | `TugConfig.swift` | No longer used by any code |
| `keyTugdeckTheme` constant | `TugConfig.swift` | No longer used by any code |

**List L02: Swift artifacts to keep** {#l02-swift-keeps}

| Artifact | File | Reason |
|----------|------|--------|
| `keyWindowBackground` | `TugConfig.swift` | Used for native NSWindow background color (separate concern) |
| `keyDevModeEnabled` | `TugConfig.swift` | App-level preference, unrelated to deck settings |
| `keySourceTreePath` | `TugConfig.swift` | App-level preference, unrelated to deck settings |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugcast/src/settings.rs` | Settings persistence: `DeckSettings` struct, `SettingsState` struct, `load`/`save` functions, GET/POST handlers |
| `tugdeck/src/settings-api.ts` | `fetchSettingsWithRetry()` and `postSettings()` helper functions |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DeckSettings` | struct | `settings.rs` | Serializable settings with optional `layout` and `theme` fields |
| `SettingsState` | struct | `settings.rs` | Holds `Option<PathBuf>` and `tokio::sync::Mutex<()>` for serialized writes; wrapped in `Arc`, added as axum Extension |
| `load_settings` | async fn | `settings.rs` | Read and parse settings file via `tokio::fs`, return defaults on error |
| `save_settings` | async fn | `settings.rs` | Atomic write via `tokio::fs` (temp file + rename) |
| `get_settings` | async fn | `settings.rs` | Axum handler for `GET /api/settings` |
| `post_settings` | async fn | `settings.rs` | Axum handler for `POST /api/settings` |
| `fetchSettingsWithRetry` | async fn | `settings-api.ts` | Fetch with exponential backoff |
| `postSettings` | fn | `settings-api.ts` | Fire-and-forget POST |
| `DeckManager.constructor` | modified | `deck-manager.ts` | Accepts optional `initialLayout` parameter |
| `DeckManager.loadLayout` | modified | `deck-manager.ts` | Checks `initialLayout` first, then localStorage |
| `DeckManager.readCurrentThemeFromDOM` | new fn | `deck-manager.ts` | Reads theme from `document.body.classList` (inline helper, avoids exporting from `use-theme.ts`) |
| `DeckManager.saveLayout` | modified | `deck-manager.ts` | Also calls `postSettings()` with layout and theme |
| `setTheme` | modified | `use-theme.ts` | Also calls `postSettings()` with current theme |
| `build_app` | modified | `server.rs` | Adds `Arc<SettingsState>` Extension and `/api/settings` routes |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `DeckSettings` serialization, `load_settings`/`save_settings` with temp files | Core persistence logic |
| **Integration** | Test GET/POST handlers via axum test utilities (`tower::ServiceExt`) | API contract verification |
| **Manual** | Switch between dev and production modes, verify layout/theme persist | End-to-end cross-origin verification |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add settings.rs module with DeckSettings struct and file I/O {#step-1}

**Commit:** `feat(tugcast): add settings module with DeckSettings struct and atomic file I/O`

**References:** [D01] Tugcast API endpoint, [D04] Atomic file writes, [D05] Settings state via Extension with Mutex, [D06] Graceful degradation, Spec S01, Spec S04, Spec S05, (#settings-format, #rust-types, #s05-settings-state)

**Artifacts:**
- New file: `tugcode/crates/tugcast/src/settings.rs`
- Modified: `tugcode/crates/tugcast/src/main.rs` (add `mod settings;`)

**Tasks:**
- [ ] Create `settings.rs` with `DeckSettings` struct per Spec S04
- [ ] Create `SettingsState` struct per Spec S05 with `path: Option<PathBuf>` and `lock: tokio::sync::Mutex<()>`
- [ ] Implement `async fn load_settings(path: &Path) -> DeckSettings`: use `tokio::fs::read_to_string` to read file, parse JSON, return `DeckSettings::default()` on any error (missing file, invalid JSON). Must be async since it is called from async axum handlers.
- [ ] Implement `async fn save_settings(path: &Path, settings: &DeckSettings) -> Result<(), io::Error>`: use `tokio::fs::create_dir_all` for parent directory, `tokio::fs::write` to temp file in same directory, `tokio::fs::rename` to target path. Must be async for the same reason.
- [ ] Add `mod settings;` to `main.rs`

**Tests:**
- [ ] Test `DeckSettings` round-trip serialization: serialize then deserialize, verify fields match
- [ ] Test `load_settings` with missing file returns default (empty) settings
- [ ] Test `load_settings` with valid JSON file returns parsed settings
- [ ] Test `load_settings` with invalid JSON returns default settings
- [ ] Test `save_settings` creates file with correct JSON content
- [ ] Test `save_settings` creates parent directory if missing
- [ ] Test `save_settings` overwrites existing file atomically

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast --filter-expr 'test(settings)'`
- [ ] `cd tugcode && cargo build -p tugcast` (no warnings)

---

#### Step 2: Add GET/POST /api/settings handlers and route registration {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): add GET/POST /api/settings endpoints`

**References:** [D01] Tugcast API endpoint, [D02] Loopback-only access, [D05] Settings state via Extension with Mutex, [D06] Graceful degradation, [D09] Null-as-delete merge semantics, Spec S02, Spec S03, Spec S05, (#api-surface, #s05-settings-state)

**Artifacts:**
- Modified: `tugcode/crates/tugcast/src/settings.rs` (add handler functions)
- Modified: `tugcode/crates/tugcast/src/server.rs` (add route and Extension layer)

**Tasks:**
- [ ] Add `get_settings` handler to `settings.rs`: extract `ConnectInfo<SocketAddr>` for loopback check, extract `Extension<Arc<SettingsState>>`, call `load_settings` using `state.path`, return JSON. If `path` is `None`, return `{}`
- [ ] Add `post_settings` handler to `settings.rs`: extract `ConnectInfo<SocketAddr>` for loopback check, extract `Extension<Arc<SettingsState>>`, parse JSON body as `serde_json::Value`. If `path` is `None`, silently discard and return `{"status":"ok"}`. Otherwise, acquire `state.lock.lock().await` to serialize the read-modify-write cycle, then load existing settings, merge with posted fields using null-as-delete semantics (see [D09]), call `save_settings`, release lock, return `{"status":"ok"}`.
- [ ] Modify `build_app` in `server.rs` to add the settings route and Extension layer. The settings handlers do NOT use `State<FeedRouter>` -- they only use `Extension<Arc<SettingsState>>` and `ConnectInfo`. Therefore the `/api/settings` route is added to a separate stateless `Router` that is merged into the main router after `.with_state()`. The concrete code shape is:

```rust
pub(crate) fn build_app(
    router: FeedRouter,
    _dev_state: SharedDevState,
    source_tree: Option<PathBuf>,
) -> Router {
    // Derive settings path before source_tree is consumed by the if-let
    let settings_path = source_tree.as_ref().map(|t| t.join(".tugtool/deck-settings.json"));
    let settings_state = Arc::new(SettingsState {
        path: settings_path,
        lock: tokio::sync::Mutex::new(()),
    });

    let base = Router::new()
        .route("/auth", get(crate::auth::handle_auth))
        .route("/ws", get(crate::router::ws_handler))
        .route("/api/tell", post(tell_handler))
        .with_state(router)
        // Settings route: handlers use Extension, not State<FeedRouter>,
        // so the route is merged after .with_state() as a stateless route.
        .route("/api/settings", get(settings::get_settings).post(settings::post_settings))
        .layer(Extension(settings_state));

    // ... existing ServeDir fallback logic unchanged ...
}
```

Note: `axum::Extension` is used deliberately rather than a second `State` because `State<FeedRouter>` is already in use and axum does not support multiple `State` types without `FromRef`. Extension is the simplest correct approach for injecting a second piece of shared data alongside an existing State.

- [ ] Add necessary imports to `server.rs`: `use axum::Extension;`, `use std::sync::Arc;`, and `use crate::settings::{self, SettingsState};`

**Tests:**

Note: Integration tests use `tower::ServiceExt::oneshot` on the router from `build_app`. Each test must layer `MockConnectInfo(loopback_addr)` onto the test app, following the existing pattern in `test_tell_client_action` (see `integration_tests.rs`): `let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 0); let app = app.layer(MockConnectInfo(addr));`. For settings file persistence, pass `Some(temp_dir.path().to_path_buf())` as `source_tree` to `build_app` where `temp_dir` is a `tempfile::TempDir`. Tests that verify `source_tree = None` behavior pass `None` for the `source_tree` argument.

- [ ] Integration test: GET `/api/settings` with no settings file returns `200` with `{}`
- [ ] Integration test: POST `/api/settings` with valid JSON, then GET returns the posted data
- [ ] Integration test: POST `/api/settings` with partial update preserves existing fields
- [ ] Integration test: POST `/api/settings` with invalid JSON returns `400`
- [ ] Integration test: GET `/api/settings` with `source_tree = None` returns `200` with `{}`
- [ ] Integration test: POST `/api/settings` with `source_tree = None` returns `200` (silently discards)
- [ ] Integration test: POST `{"layout":null,"theme":null}` after storing settings clears all fields (subsequent GET returns `{}`)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast --filter-expr 'test(settings)'`
- [ ] `cd tugcode && cargo build -p tugcast` (no warnings)
- [ ] Manual: start tugcast, `curl http://127.0.0.1:55255/api/settings` returns `{}`
- [ ] Manual: `curl -X POST -H 'Content-Type: application/json' -d '{"theme":"bluenote"}' http://127.0.0.1:55255/api/settings` returns `{"status":"ok"}`
- [ ] Manual: `curl http://127.0.0.1:55255/api/settings` now returns `{"theme":"bluenote"}`

---

#### Step 3: Add frontend settings-api.ts module {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add settings-api module with fetchSettingsWithRetry and postSettings`

**References:** [D03] No localStorage fallback, Spec S06, (#frontend-types, #data-flow)

**Artifacts:**
- New file: `tugdeck/src/settings-api.ts`

**Tasks:**
- [ ] Create `settings-api.ts` with `ServerSettings` interface matching Spec S06
- [ ] Implement `fetchSettingsWithRetry(url: string): Promise<ServerSettings>`: fetch with exponential backoff starting at ~100ms, doubling each retry, capped at ~2s. No maximum retry count. Log each retry to `console.debug`. Return parsed JSON on success.
- [ ] Implement `postSettings(settings: Partial<ServerSettings>): void`: fire-and-forget `fetch("/api/settings", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(settings) })`. Catch and log errors to `console.warn`.

**Tests:**
- [ ] Verify `settings-api.ts` compiles without TypeScript errors

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit` passes

---

#### Step 4: Wire frontend initialization through settings API {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugdeck): async init with settings fetch, update DeckManager and theme save`

**References:** [D07] DeckManager accepts pre-fetched layout, [D08] Theme applied before React, [D03] No localStorage fallback, [D09] Null-as-delete merge semantics, Table T01, Table T02, Spec S06, (#data-flow, #settings-format)

**Artifacts:**
- Modified: `tugdeck/src/main.tsx` (wrap initialization in async IIFE)
- Modified: `tugdeck/src/deck-manager.ts` (accept optional `initialLayout`, POST on save)
- Modified: `tugdeck/src/hooks/use-theme.ts` (POST on theme change)

Note: All tasks in this step must be implemented atomically within the same commit. The DeckManager constructor change (adding `initialLayout?` parameter) and the async IIFE restructuring of `main.tsx` (which passes that parameter) are interdependent -- applying the constructor change without the IIFE restructuring would break the build since existing call sites would not match. Implement all tasks together, then verify TypeScript compiles before committing.

**Tasks:**
- [ ] Modify `DeckManager` constructor to accept optional third parameter `initialLayout?: object`: store it as an instance field
- [ ] Modify `DeckManager.loadLayout()`: if `this.initialLayout` is set, call `JSON.stringify(this.initialLayout)` to convert the parsed object back to a string, then pass the string to the existing `deserialize()` function (which expects a JSON string). If valid, use it (and write to localStorage as cache). Otherwise fall back to localStorage, then default.
- [ ] Add a private `readCurrentThemeFromDOM()` helper to `DeckManager` (or as a module-level function in `deck-manager.ts`) that reads the current theme from `document.body.classList` using the same `td-theme-*` prefix logic as `readCurrentTheme()` in `use-theme.ts`. This avoids exporting the private `readCurrentTheme()` from `use-theme.ts`.
- [ ] Modify `DeckManager.saveLayout()`: after writing to localStorage, call `postSettings({ layout: serializedLayout, theme: this.readCurrentThemeFromDOM() })` to persist both layout and theme to the API (fire-and-forget)
- [ ] Modify `onResetEverything` in BOTH locations: (a) the external dock callbacks set in `main.tsx` (line 217-220) and (b) the fallback default in `DeckManager.buildDockCallbacks()` (deck-manager.ts). In both, before calling `localStorage.clear()` and `sendControlFrame("reset")`, call `postSettings({ layout: null, theme: null })` to clear server-side settings using null-as-delete semantics per [D09]. Sending `{ layout: null, theme: null }` (not `{}`) is required because with merge semantics, an empty object `{}` would preserve all existing fields. Both locations must be updated because `buildDockCallbacks()` returns the fallback if `setDockCallbacks()` has not been called yet, and the main.tsx version is the one used in production.
- [ ] Wrap the initialization in `main.tsx` in an async IIFE: `(async () => { ... })()`. The following items remain at **module scope** (synchronous, before the IIFE): CSS imports, `console.debug` dev-flash log, `TugConnection` creation, `container` element lookup, `wsUrl` derivation. Everything from `new DeckManager(...)` onward (DeckManager construction, card config/factory registration, `addCard` calls, `initActionDispatch`, dock callbacks, `connection.connect()`) moves **inside the async IIFE**, after the settings fetch.
- [ ] Inside the async IIFE, before DeckManager construction: call `fetchSettingsWithRetry("/api/settings")`
- [ ] Inside the async IIFE, before DeckManager construction: if `serverSettings.theme` is set and not `"brio"`, add `td-theme-{theme}` class to `document.body`. If theme is `"brio"`, ensure no `td-theme-*` classes are present.
- [ ] Pass `serverSettings.layout` (or undefined) as third argument to `new DeckManager(container, connection, serverSettings.layout)`
- [ ] In `use-theme.ts` `setTheme()`: after existing localStorage write, call `postSettings({ theme: newTheme })` (fire-and-forget). Import `postSettings` from `settings-api.ts`.

**Tests:**
- [ ] Verify TypeScript compiles without errors
- [ ] Manual: load page with tugcast running, verify settings are fetched (check Network tab)
- [ ] Manual: rearrange cards, verify POST `/api/settings` appears in Network tab after debounce
- [ ] Manual: change theme, verify POST `/api/settings` appears in Network tab
- [ ] Manual: click "Reset Everything" in dock, verify POST `/api/settings` with `{"layout":null,"theme":null}` clears server-side settings (subsequent GET returns `{}`)

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit` passes
- [ ] Manual: settings saved in dev mode persist when loading production mode
- [ ] Manual: settings saved in production mode persist when loading dev mode

---

#### Step 5: Remove broken Swift sync code {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(tugapp): remove broken localStorage sync code replaced by settings API`

**References:** List L01, List L02, (#swift-cleanup)

**Artifacts:**
- Modified: `tugapp/Sources/AppDelegate.swift` (remove `syncLocalStorageOnPageLoad()` and `bridgePageDidLoad()`)
- Modified: `tugapp/Sources/MainWindow.swift` (remove `bridgePageDidLoad()` from protocol and `didFinishNavigation` call)
- Modified: `tugapp/Sources/TugConfig.swift` (remove `keyTugdeckLayout` and `keyTugdeckTheme`)

**Tasks:**
- [ ] Remove `syncLocalStorageOnPageLoad()` method from `AppDelegate.swift`
- [ ] Remove `bridgePageDidLoad()` implementation from `AppDelegate.swift`
- [ ] Remove `bridgePageDidLoad()` from `BridgeDelegate` protocol in `MainWindow.swift`
- [ ] Remove `bridgeDelegate?.bridgePageDidLoad()` call from `didFinishNavigation` in `MainWindow.swift`
- [ ] Remove `keyTugdeckLayout` constant and its doc comment from `TugConfig.swift`
- [ ] Remove `keyTugdeckTheme` constant and its doc comment from `TugConfig.swift`
- [ ] Verify no remaining references to removed symbols (search codebase)

**Tests:**
- [ ] Swift project builds without errors
- [ ] Manual: app launches, loads page, settings still work through API

**Checkpoint:**
- [ ] Swift build succeeds (Xcode or `xcodebuild`)
- [ ] No references to `syncLocalStorageOnPageLoad`, `bridgePageDidLoad`, `keyTugdeckLayout`, or `keyTugdeckTheme` remain in codebase

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Tugcast API endpoint, [D03] No localStorage fallback, (#success-criteria, #data-flow)

**Tasks:**
- [ ] Verify end-to-end flow: save layout in dev mode, load in production mode, confirm same layout
- [ ] Verify end-to-end flow: save theme in production mode, load in dev mode, confirm same theme
- [ ] Verify `.tugtool/deck-settings.json` contains expected JSON after saves
- [ ] Verify no broken Swift bridge functionality (theme color still posts to Swift bridge, window background still works)
- [ ] Verify `onResetEverything` in dock callbacks clears both localStorage and server-side settings (POST `{layout:null,theme:null}` per [D09], then `localStorage.clear()` + control frame)

**Tests:**
- [ ] Manual: save layout in dev mode, switch to production mode, verify same layout renders
- [ ] Manual: change theme in production mode, switch to dev mode, verify same theme active
- [ ] Manual: verify Swift bridge theme color posting still works (window background updates on theme change)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast` (all tests pass)
- [ ] `cd tugdeck && npx tsc --noEmit` (TypeScript clean)
- [ ] Manual: full cross-mode settings persistence verified

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Deck layout and theme settings persist across dev/production mode switches via tugcast API, with broken Swift sync code removed.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `GET /api/settings` returns persisted settings (verify with curl)
- [ ] `POST /api/settings` persists settings atomically (verify with curl + cat file)
- [ ] Layout saved in dev mode appears in production mode (manual test)
- [ ] Theme saved in production mode appears in dev mode (manual test)
- [ ] `syncLocalStorageOnPageLoad` and `bridgePageDidLoad` removed from Swift code (grep confirms)
- [ ] `cargo nextest run -p tugcast` passes
- [ ] `npx tsc --noEmit` passes in tugdeck
- [ ] Swift app builds without errors

**Acceptance tests:**
- [ ] `curl http://127.0.0.1:55255/api/settings` returns valid JSON
- [ ] `curl -X POST -H 'Content-Type: application/json' -d '{"layout":{"version":5,"cards":[]},"theme":"harmony"}' http://127.0.0.1:55255/api/settings` returns `{"status":"ok"}`
- [ ] Subsequent `curl http://127.0.0.1:55255/api/settings` returns `{"layout":{"version":5,"cards":[]},"theme":"harmony"}`
- [ ] `.tugtool/deck-settings.json` contains the posted JSON

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add settings for window position/size persistence
- [ ] Add settings schema versioning if format evolves
- [ ] Consider WebSocket-based settings push for multi-window sync
- [ ] Migrate existing localStorage data to settings file on first load (optional convenience)

| Checkpoint | Verification |
|------------|--------------|
| Rust builds clean | `cd tugcode && cargo build -p tugcast` (no warnings) |
| Rust tests pass | `cd tugcode && cargo nextest run -p tugcast` |
| TypeScript clean | `cd tugdeck && npx tsc --noEmit` |
| Settings API works | `curl http://127.0.0.1:55255/api/settings` returns JSON |
| Cross-mode persistence | Manual: save in dev, load in prod, verify same layout/theme |
