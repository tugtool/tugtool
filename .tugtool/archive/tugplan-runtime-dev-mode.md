## Phase 1.0: Runtime Dev Mode {#phase-runtime-dev-mode}

**Purpose:** Replace the static `--dev` CLI flag with a runtime dev_mode control message over the UDS control socket, enabling dev mode to be toggled at runtime without restarting tugcast.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | runtime-dev-mode |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-21 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Dev mode currently requires the `--dev <source_tree>` CLI flag at process launch. Toggling dev mode in the UI saves a preference but does not take effect until tugcast restarts. The Mac app shows a Developer menu and "Reload Frontend" button that appear to work, but file-watching hot reload is silently absent because the running process was never told about dev mode. The `--dev` flag must go; dev mode must be a runtime switch.

#### Strategy {#strategy}

- Add a `DevMode` variant to `ControlMessage` in `control.rs` as a first-class control message (not a tell action).
- Replace the static `Option<Arc<DevState>>` with `Arc<ArcSwap<Option<DevState>>>` (SharedDevState) for lock-free runtime swapping.
- Create `DevRuntime` struct in `dev.rs` that owns the `RecommendedWatcher` (drop to stop, create to start).
- Unify asset serving into a single fallback handler that checks shared dev state per-request.
- Use `spawn_blocking` for `load_manifest` since it does blocking filesystem I/O.
- Keep `--dev` as a deprecated, ignored flag during intermediate steps so the Mac app never crashes against an incompatible tugcast binary. Remove the flag only after the Mac app stops sending it.
- Update Mac app to send `dev_mode` control message after ready and on toggle instead of passing `--dev` flag. At startup when dev mode is enabled, gate `loadURL` on `dev_mode_result` so the first page render always uses dev assets. For mid-session toggles, broadcast `reload_frontend` to refresh already-loaded pages.
- Provide a full error feedback path: tugcast sends `dev_mode_result` over UDS, Mac app forwards errors to the frontend via the bridge, and the settings UI reverts the toggle and shows an error message.

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers using the Mac app who toggle dev mode from the UI
2. tugcast server operators who use the control socket protocol

#### Success Criteria (Measurable) {#success-criteria}

- `tugcast --help` no longer shows a `--dev` flag (after final step)
- Sending `{"type":"dev_mode","enabled":true,"source_tree":"/path"}` over UDS activates dev asset serving and file watching within the same process lifetime
- Sending `{"type":"dev_mode","enabled":false}` deactivates dev mode, stops the file watcher, and reverts to embedded asset serving
- Toggling dev mode in the Mac app UI takes effect immediately without process restart
- If dev mode enable fails, the settings UI reverts the toggle and shows the error message
- All existing integration tests pass with updated signatures; new tests cover enable/disable round-trips and edge cases

#### Scope {#scope}

All paths below are relative to the repo root (`tugcode/crates/tugcast/` for Rust, `tugapp/Sources/` for Swift).

1. `tugcode/crates/tugcast/src/control.rs` -- Add `DevMode` variant to `ControlMessage`, handle in recv loop, send response via mpsc channel
2. `tugcode/crates/tugcast/src/dev.rs` -- Add `DevRuntime` struct, `enable_dev_mode`/`disable_dev_mode` functions, `SharedDevState` type alias
3. `tugcode/crates/tugcast/src/server.rs` -- Unified asset handler using `SharedDevState`, update `build_app`/`run_server` signatures
4. `tugcode/crates/tugcast/src/main.rs` -- Replace static dev setup with `SharedDevState`, deprecate then remove `--dev` handling, add mpsc response channel, move `ControlWriter` into draining task after `send_ready`
5. `tugcode/crates/tugcast/src/cli.rs` -- Deprecate `--dev` (hidden + ignored), then remove entirely
6. `tugcode/crates/tugcast/src/integration_tests.rs` -- Update `build_app` calls, add dev mode toggle tests
7. `tugcode/crates/tugcast/Cargo.toml` -- Add `arc-swap` dependency (workspace Cargo.toml is at `tugcode/Cargo.toml`)
8. `tugapp/Sources/ProcessManager.swift` -- Remove `--dev` arg, add `sendDevMode` method, forward `dev_mode_result` errors to AppDelegate
9. `tugapp/Sources/AppDelegate.swift` -- Send control message on toggle and on ready (gate loadURL on dev_mode_result when dev enabled), remove `runtimeDevMode`, handle source tree changes while enabled, forward errors to frontend
10. `tugapp/Sources/MainWindow.swift` -- Simplify `BridgeDelegate` protocol (remove `runtimeDevMode`), add `bridgeDevModeError` callback for error feedback
11. `tugdeck/src/cards/settings-card.ts` -- Remove `runtimeDevMode`, remove restart prompt, add error display on `onDevModeError`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Adding dev mode to the HTTP API (control socket only)
- Changing the manifest format (`tugdeck/assets.toml`)
- Changing `bun build --watch` lifecycle (still managed by Mac app separately)

#### Dependencies / Prerequisites {#dependencies}

- Control socket IPC is already implemented and working (tugplan-control-socket, merged)
- `arc-swap` crate available on crates.io

#### Constraints {#constraints}

- `load_manifest` does blocking I/O; must use `spawn_blocking` in async context
- Warnings are errors (`-D warnings` enforced); no dead code allowed
- File watcher uses `notify` crate's `RecommendedWatcher` which must be dropped to stop
- Mac app may pass `--dev` during intermediate steps; tugcast must accept it without error until the Mac app stops sending it
- `ControlWriter` is owned by `main()` for `send_ready`/`send_shutdown`; after `send_ready`, it moves into a draining task. The recv loop writes `dev_mode_result` responses via an `mpsc::Sender<String>` channel; `send_shutdown` is also routed through the same channel

#### Assumptions {#assumptions}

- The `DevRuntime` struct holds `RecommendedWatcher` which stops when dropped
- `ArcSwap` will be added to workspace `Cargo.toml` at `tugcode/Cargo.toml` `[workspace.dependencies]`
- The control message recv loop is already async and can spawn blocking tasks
- Existing dev mode tests will be updated to work with the new runtime approach
- The Mac app will handle the async nature of dev mode enable (no blocking UI)
- File watcher will use the same `client_action_tx` channel as before for reload signals
- The design doc's code examples are representative but may need minor adjustments during implementation

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Dev mode is a first-class control message, not a tell action (DECIDED) {#d01-dev-mode-control-message}

**Decision:** Add a `DevMode` variant to the `ControlMessage` enum rather than routing dev mode through the existing `Tell` action dispatch.

**Rationale:**
- Dev mode changes server configuration (shared state, router behavior, file watcher lifecycle), not client state
- Tell actions are designed for client-bound broadcast; dev mode is server-internal configuration
- A first-class variant enables typed fields (`enabled: bool`, `source_tree: Option<String>`) instead of untyped JSON

**Implications:**
- `ControlMessage` enum in `control.rs` gains a new `DevMode` variant
- The recv loop in `ControlReader::run_recv_loop` must handle this variant directly
- The message format is `{"type":"dev_mode","enabled":true,"source_tree":"/path"}`

---

#### [D02] Use ArcSwap for lock-free shared dev state (DECIDED) {#d02-arcswap-shared-state}

**Decision:** Replace `Option<Arc<DevState>>` with `Arc<ArcSwap<Option<DevState>>>` (aliased as `SharedDevState`) for lock-free runtime swapping of dev state.

**Rationale:**
- `ArcSwap` provides zero-contention reads via `load()`, critical for per-request asset serving on the hot path
- No mutex or RwLock needed; reads never block even during a swap
- The `store()` method atomically replaces the inner value, making enable/disable transitions safe

**Implications:**
- `arc-swap` crate added as a dependency
- `build_app` takes `SharedDevState` instead of `Option<Arc<DevState>>`
- Asset handler calls `dev_state.load()` on every request to check current state
- Type alias: `pub type SharedDevState = Arc<ArcSwap<Option<DevState>>>;`

---

#### [D03] DevRuntime struct owns the file watcher (DECIDED) {#d03-dev-runtime-struct}

**Decision:** Create a `DevRuntime` struct that holds `RecommendedWatcher`. Dropping `DevRuntime` stops the watcher. Hold `Option<DevRuntime>` in the control recv loop alongside the shared state.

**Rationale:**
- `RecommendedWatcher` stops watching when dropped; RAII semantics are the natural fit
- Encapsulating the watcher in a struct makes enable/disable symmetrical: create `DevRuntime` to start, drop to stop
- Keeping `Option<DevRuntime>` local to the control recv loop avoids sharing mutable state across tasks

**Implications:**
- `dev.rs` gains `DevRuntime` struct with a `_watcher: RecommendedWatcher` field
- `enable_dev_mode` returns `Result<DevRuntime, String>` (creates watcher, populates shared state)
- `disable_dev_mode` takes ownership of `DevRuntime` (drops it) and swaps shared state to `None`

---

#### [D04] Unified asset handler checks shared state per-request (DECIDED) {#d04-unified-asset-handler}

**Decision:** Replace the conditional router construction (if/else on `dev_state` in `build_app`) with a single fallback handler that checks `SharedDevState` on every request.

**Rationale:**
- With runtime toggling, the router cannot be rebuilt; the same router must handle both modes
- Checking `ArcSwap::load()` per request is effectively free (atomic pointer load)
- One route handler, one fallback, no conditional router construction

**Implications:**
- `build_app` always installs the same fallback handler
- The fallback handler loads `SharedDevState`, and if `Some`, serves from disk; if `None`, serves from embedded assets
- `serve_dev_index` and `serve_dev_asset` functions change signature to accept `&DevState` reference instead of `Extension<Arc<DevState>>`

---

#### [D05] Use spawn_blocking for load_manifest (DECIDED) {#d05-spawn-blocking-manifest}

**Decision:** Call `load_manifest` via `tokio::task::spawn_blocking` since it performs blocking filesystem I/O (reads `assets.toml`, stats paths for validation).

**Rationale:**
- The control message handler runs in the async recv loop; blocking I/O would stall the control socket
- `spawn_blocking` moves the work to a thread pool designed for blocking operations
- The result is awaited and used to populate shared state

**Implications:**
- `enable_dev_mode` is an `async fn` that calls `spawn_blocking` internally
- Error from `load_manifest` is propagated back and sent as an error response over the control socket

---

#### [D06] Error feedback reaches the settings UI (DECIDED) {#d06-error-feedback-path}

**Decision:** When dev mode enable fails, the error propagates from tugcast through the Mac app bridge to the frontend settings UI, which reverts the checkbox and shows the error message.

**Rationale:**
- User answers specify: "Send error response over control socket to Mac app so it can show user feedback"
- If the error only reaches ProcessManager logs, the settings UI toggle appears "enabled" while dev mode is actually off -- a silent failure

**Implications:**
- tugcast sends `{"type":"dev_mode_result","success":false,"error":"..."}` over UDS
- `ProcessManager.handleControlMessage` parses `dev_mode_result`: on error, calls `onDevModeError?(errorMessage)` callback
- `AppDelegate` implements `onDevModeError` and calls a new bridge method `bridgeDevModeError(message:)` to notify the frontend
- `MainWindow.swift` gains `bridgeDevModeError` in the `BridgeDelegate` protocol; the handler calls `window.__tugBridge?.onDevModeError?('message')`
- `settings-card.ts` registers `onDevModeError` callback: reverts `devModeCheckbox.checked` to false, calls `showDevNote(message)` to display the error

---

#### [D07] Debounce completes but reload is gated on dev state (DECIDED) {#d07-debounce-gating}

**Decision:** When dev mode is disabled while a debounce is pending, let the debounce timer complete but check dev state before sending the reload signal. If disabled, do not send.

**Rationale:**
- User answers specify: "Let pending debounce complete, but check dev state before sending reload -- if disabled, don't send"
- Cancelling a debounce mid-flight adds complexity with no practical benefit (100ms window)
- Checking shared state before sending is trivial and race-free with ArcSwap

**Implications:**
- The debounce task in `dev_file_watcher` receives a clone of `SharedDevState`
- Before sending the reload frame, it calls `dev_state.load()` and only sends if `Some`
- When dev mode is disabled, the watcher is dropped (no new events), and any in-flight debounce self-gates

---

#### [D08] Missing source tree: skip dev_mode message silently (DECIDED) {#d08-missing-source-tree}

**Decision:** If the Mac app has dev mode enabled but no source tree path configured, do not send the `dev_mode` control message. Skip silently, matching current behavior.

**Rationale:**
- User answers specify: "Don't send dev_mode message -- skip silently, same as current behavior"
- Current code only passes `--dev` when both `devEnabled` and `freshSourceTree` are present
- Sending `dev_mode` without a path would be an error anyway

**Implications:**
- Swift code guards on `sourceTreePath != nil` before sending dev_mode message
- No error UI shown for missing source tree (user must configure it via Developer menu)

---

#### [D09] Simple mpsc channel for dev_mode responses (DECIDED) {#d09-dev-mode-response-channel}

**Decision:** Give `run_recv_loop` a simple `mpsc::Sender<String>` (`response_tx`) for sending dev_mode_result JSON strings. In `main()`, after calling `send_ready` on the writer, move `ControlWriter` into a small draining task that (a) receives JSON strings from the channel and writes each to the socket, and (b) on channel close, sends the shutdown message and exits. The `send_ready` call in `main()` is unchanged. The `send_shutdown` logic moves into the draining task's cleanup path.

**Rationale:**
- The recv loop needs to write `dev_mode_result` responses, but `ControlWriter` is owned by `main()`. Rather than wrapping it in `Arc<Mutex<>>` (over-engineering for one new message type), we move it into a single owner task after `send_ready` completes.
- `send_ready` is called before the draining task spawns, so it uses `ControlWriter` directly with no changes.
- `send_shutdown` is handled by the draining task when the channel closes: `main()` sends a shutdown JSON string through `response_tx`, then drops the sender, causing the task to write the shutdown message and exit.
- No `Arc<Mutex<>>`, no `write_raw` method, no changes to `ControlWriter` struct. The draining task uses `send_ready`-style inline writes (write_all + newline + flush).

**Implications:**
- `run_recv_loop` gains a `response_tx: mpsc::Sender<String>` parameter
- In `main()`, after `send_ready`: create `mpsc::channel::<String>(4)`, move `ControlWriter` into a spawned draining task that loops on `rx.recv()` writing each string as a line to the socket
- `main()` holds `response_tx` (the sender). Before the `select!` loop, clone it for the recv loop. After the `select!` loop exits, `main()` sends the shutdown JSON through `response_tx` and drops it, which triggers the draining task to write shutdown and exit
- No `ControlWriter::write_raw` method needed; the draining task writes bytes directly: `writer.write_all(msg.as_bytes())`, `writer.write_all(b"\n")`, `writer.flush()`
- If the draining task exits early (UDS disconnect), channel sends are silently ignored

**Draining task lifecycle invariant:** The draining task exits when all `response_tx` senders are dropped, causing `rx.recv()` to return `None`. There are exactly two clones of `response_tx`: (1) the original held by `main()`, dropped after sending the shutdown message when the `select!` loop exits; (2) the clone held by the recv loop task, dropped when the recv loop exits on EOF or read error. After both senders drop, the draining task's `recv()` returns `None` and the task exits cleanly. `process::exit()` in `main()` is the backstop that terminates all tasks regardless.

---

#### [D10] Keep --dev as deprecated ignored flag during transition (DECIDED) {#d10-deprecated-dev-flag}

**Decision:** During intermediate steps, keep `--dev` in the `Cli` struct as a hidden, ignored field. The Mac app may still pass `--dev` until Step 4 updates it. Removing `--dev` from `cli.rs` happens in Step 5 (final step), after the Mac app stops sending it.

**Rationale:**
- The Mac app reads `devModeEnabled` and `freshSourceTree` from UserDefaults and passes `--dev` to the tugcast args array at startup. If `--dev` is removed from Clap before the Mac app is updated, Clap rejects the unknown flag and tugcast crashes.
- Keeping `--dev` as `#[arg(long, hide = true)]` with no consumers means the Mac app can safely pass it without error, and `tugcast --help` does not advertise it.

**Implications:**
- Step 1 marks `--dev` as `#[arg(long, hide = true)]` and removes all code that reads `cli.dev` from `main.rs`
- Steps 1-3 compile and run even if the Mac app passes `--dev`
- Step 4 removes `--dev` from the Mac app's args array
- Step 5 removes the deprecated `dev` field from `Cli` entirely

---

#### [D11] Gate initial page load on dev_mode_result; auto-reload for mid-session toggle (DECIDED) {#d11-gated-load-and-auto-reload}

**Decision:** Two complementary mechanisms ensure the frontend always sees the correct assets:

1. **Startup gating:** When `devModeEnabled` is true at startup, the Mac app sends `dev_mode` after `ready` but defers `loadURL` until it receives `dev_mode_result` with `success: true`. This guarantees the first page load uses dev assets. If `dev_mode_result` returns an error, fall back to `loadURL` immediately (embedded assets). If `devModeEnabled` is false, `loadURL` is called immediately on `ready` (unchanged).

2. **Mid-session reload:** After `enable_dev_mode` succeeds, broadcast a `reload_frontend` Control frame to all connected clients. This handles the case where dev mode is toggled on while a page is already loaded.

**Rationale:**
- Auto-reload alone is insufficient at startup: the `reload_frontend` broadcast can arrive before the WebSocket is connected (the page hasn't loaded yet, so there's no WebSocket client to receive it). The reload is lost and the first render stays on embedded assets.
- Gating `loadURL` on `dev_mode_result` eliminates the startup race entirely. The page is never loaded until dev assets are active, so no reload is needed.
- Mid-session toggles still need auto-reload because a page is already loaded and rendering with embedded assets.

**Implications:**
- In `AppDelegate.processManager.onReady`: if `devModeEnabled`, send `dev_mode` and set a flag (`awaitingDevModeResult = true`); do NOT call `loadURL`. If not `devModeEnabled`, call `loadURL` immediately.
- In `AppDelegate.processManager.onDevModeResult`: if `awaitingDevModeResult` is true, call `loadURL` regardless of success/failure (success means dev assets; failure means embedded assets -- either way the page should load), then clear the flag. If not awaiting, this is a mid-session toggle response -- no action needed (the auto-reload handles it).
- In the `DevMode` handler within `run_recv_loop`, after `enable_dev_mode` returns `Ok`, broadcast `{"action":"reload_frontend"}` via `client_action_tx` (for mid-session toggles)
- On disable, no automatic reload is needed (embedded assets are always available; the page continues to work)

---

#### [D12] Re-send dev_mode on source tree change (DECIDED) {#d12-resend-on-source-tree-change}

**Decision:** When the user changes the source tree directory via `bridgeChooseSourceTree` while dev mode is already enabled, immediately send a new `dev_mode` enable message with the updated path.

**Rationale:**
- If dev mode is enabled and the user picks a different source tree, the runtime still points at the old tree. File watching, manifest, and asset serving are all stale.
- Sending `dev_mode` with `enabled: true` and the new path triggers the existing "enable when already enabled" behavior: teardown old watcher, load new manifest, start new watcher (per Spec S01 rules).

**Implications:**
- In `AppDelegate.bridgeChooseSourceTree`, after updating `sourceTreePath` and saving preferences, check if `devModeEnabled` is true; if so, call `processManager.sendDevMode(enabled: true, sourceTree: newPath)`
- No tugcast-side changes needed; the recv loop already handles re-enable by dropping the old `DevRuntime` and creating a new one

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Control Message Protocol {#control-message-protocol}

**Spec S01: dev_mode Control Message** {#s01-dev-mode-message}

Enable dev mode:
```json
{"type":"dev_mode","enabled":true,"source_tree":"/path/to/tugtool"}
```

Disable dev mode:
```json
{"type":"dev_mode","enabled":false}
```

Response (success):
```json
{"type":"dev_mode_result","success":true}
```

Response (error):
```json
{"type":"dev_mode_result","success":false,"error":"failed to load asset manifest: ..."}
```

Rules:
- `source_tree` is required when `enabled` is true; ignored when false
- The response is sent over the same UDS connection via the `response_tx: mpsc::Sender<String>` channel
- Enable when already enabled: teardown old watcher, reload manifest, start new watcher (allows source tree path change per [D12])
- Disable when already disabled: no-op, send success response
- On successful enable, broadcast `reload_frontend` to all connected WebSocket clients (per [D11]; at startup this may have no recipients since the page hasn't loaded yet -- the Mac app gates `loadURL` on `dev_mode_result` to handle the startup case)

---

#### 1.0.1.2 SharedDevState Type {#shared-dev-state-type}

**Spec S02: SharedDevState Definition** {#s02-shared-dev-state}

```rust
use arc_swap::ArcSwap;
use std::sync::Arc;

pub type SharedDevState = Arc<ArcSwap<Option<DevState>>>;
```

- Created once in `main()` with `Arc::new(ArcSwap::from_pointee(None))`
- Passed to `build_app`, `run_server`, and `ControlReader::run_recv_loop`
- Read path: `dev_state.load()` returns `arc_swap::Guard<Arc<Option<DevState>>>` (deref to `Option<DevState>`)
- Write path: `dev_state.store(Arc::new(Some(state)))` or `dev_state.store(Arc::new(None))`

---

#### 1.0.1.3 DevRuntime Struct {#dev-runtime-struct}

**Spec S03: DevRuntime Definition** {#s03-dev-runtime}

```rust
pub(crate) struct DevRuntime {
    _watcher: RecommendedWatcher,
}
```

- Held as `Option<DevRuntime>` in the control recv loop
- Created by `enable_dev_mode`, dropped by `disable_dev_mode`
- Dropping `DevRuntime` drops `RecommendedWatcher`, which stops file watching

---

#### 1.0.1.4 Enable/Disable Functions {#enable-disable-functions}

**Spec S04: enable_dev_mode Function** {#s04-enable-dev-mode}

```rust
pub(crate) async fn enable_dev_mode(
    source_tree: PathBuf,
    shared_state: &SharedDevState,
    client_action_tx: broadcast::Sender<Frame>,
) -> Result<DevRuntime, String>
```

Steps:
1. Call `load_manifest` via `spawn_blocking`
2. Call `validate_manifest` (logs warnings)
3. Derive watch directories via `watch_dirs_from_manifest`
4. Create file watcher via `dev_file_watcher` (passing `shared_state` clone for debounce gating per [D07])
5. Store loaded `DevState` into `shared_state` via `store(Arc::new(Some(state)))`
6. Return `DevRuntime` wrapping the watcher

Note: The `reload_frontend` broadcast (per [D11]) is done by the caller (recv loop handler) after `enable_dev_mode` returns `Ok`, not inside this function. At startup, this broadcast may have no WebSocket recipients; the Mac app handles the startup case by gating `loadURL` on `dev_mode_result`.

**Spec S05: disable_dev_mode Function** {#s05-disable-dev-mode}

```rust
pub(crate) fn disable_dev_mode(
    runtime: DevRuntime,
    shared_state: &SharedDevState,
)
```

Steps:
1. Store `None` into `shared_state` via `store(Arc::new(None))`
2. Drop `runtime` (implicit; moves in, goes out of scope)

---

#### 1.0.1.5 Dev Mode Response Channel {#dev-mode-response-channel}

**Spec S06: Control Writer Draining Task** {#s06-control-writer-drain}

After `send_ready` completes, `main()` moves `ControlWriter` into a draining task. Add a `pub(crate) fn into_inner(self) -> BufWriter<OwnedWriteHalf>` method to `ControlWriter` to extract the inner writer for the task:

```rust
// In main(), after send_ready:
let (response_tx, mut response_rx) = mpsc::channel::<String>(4);
let mut raw_writer = control_writer.into_inner();

tokio::spawn(async move {
    while let Some(msg) = response_rx.recv().await {
        let _ = raw_writer.write_all(msg.as_bytes()).await;
        let _ = raw_writer.write_all(b"\n").await;
        let _ = raw_writer.flush().await;
    }
    // Channel closed -- task exits
});
```

- `main()` calls `send_ready` on `ControlWriter` before creating the channel (unchanged)
- `main()` creates `mpsc::channel::<String>(4)` and spawns the draining task, moving `ControlWriter` into it
- `run_recv_loop` receives a clone of `response_tx` for sending `dev_mode_result` JSON strings
- After the `select!` loop exits, `main()` serializes the shutdown JSON and sends it through `response_tx`, then drops the sender: `let _ = response_tx.send(shutdown_json).await; drop(response_tx);`
- The draining task writes the shutdown message, then `recv()` returns `None` and the task exits
- Helper function `make_dev_mode_result(success: bool, error: Option<&str>) -> String` serializes the response JSON
- Helper function `make_shutdown_message(reason: &str, pid: u32) -> String` serializes the shutdown JSON (same format as existing `send_shutdown`, just as a standalone serializer)
- No changes to `ControlWriter` struct; no `write_raw` method; no `Arc<Mutex<>>`

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New crates (if any) {#new-crates}

| Crate | Purpose |
|-------|---------|
| `arc-swap` | Lock-free atomic pointer swap for `SharedDevState` |

#### 1.0.2.2 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SharedDevState` | type alias | `tugcode/crates/tugcast/src/dev.rs` | `Arc<ArcSwap<Option<DevState>>>` |
| `DevRuntime` | struct | `tugcode/crates/tugcast/src/dev.rs` | Holds `RecommendedWatcher` |
| `enable_dev_mode` | async fn | `tugcode/crates/tugcast/src/dev.rs` | Creates DevRuntime, populates shared state |
| `disable_dev_mode` | fn | `tugcode/crates/tugcast/src/dev.rs` | Drops DevRuntime, clears shared state |
| `ControlMessage::DevMode` | enum variant | `tugcode/crates/tugcast/src/control.rs` | `{ enabled: bool, source_tree: Option<String> }` |
| `ControlWriter::into_inner` | method | `tugcode/crates/tugcast/src/control.rs` | Extracts inner `BufWriter<OwnedWriteHalf>` for draining task |
| `make_dev_mode_result` | fn | `tugcode/crates/tugcast/src/control.rs` | Serializes dev_mode_result JSON to `String` |
| `make_shutdown_message` | fn | `tugcode/crates/tugcast/src/control.rs` | Serializes shutdown JSON to `String` (standalone serializer) |
| `ControlReader::run_recv_loop` | method (modified) | `tugcode/crates/tugcast/src/control.rs` | Gains `SharedDevState`, `mpsc::Sender<String>`, handles `DevMode` |
| `build_app` | fn (modified) | `tugcode/crates/tugcast/src/server.rs` | Takes `SharedDevState` instead of `Option<Arc<DevState>>` |
| `run_server` | fn (modified) | `tugcode/crates/tugcast/src/server.rs` | Takes `SharedDevState` instead of `Option<Arc<DevState>>` |
| `serve_asset` | fn (modified) | `tugcode/crates/tugcast/src/server.rs` | Unified fallback checking shared state |
| `Cli::dev` | field (deprecated then removed) | `tugcode/crates/tugcast/src/cli.rs` | Hidden/ignored, then deleted |
| `ProcessManager.sendDevMode` | method | `tugapp/Sources/ProcessManager.swift` | Sends dev_mode control message |
| `ProcessManager.onDevModeResult` | callback | `tugapp/Sources/ProcessManager.swift` | Receives success bool, used to gate initial loadURL |
| `ProcessManager.onDevModeError` | callback | `tugapp/Sources/ProcessManager.swift` | Forwards error message to AppDelegate for UI feedback |
| `AppDelegate.awaitingDevModeResult` | property | `tugapp/Sources/AppDelegate.swift` | Bool flag gating initial loadURL on dev_mode_result |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `ControlMessage::DevMode` deserialization, `SharedDevState` creation, `enable_dev_mode`/`disable_dev_mode` | Core logic, error paths |
| **Integration** | Test full control message flow: send dev_mode, verify asset serving changes, verify watcher starts/stops | End-to-end dev mode toggle |

#### Edge Cases (must be covered) {#edge-cases}

| Edge Case | Expected Behavior | Test Step |
|-----------|-------------------|-----------|
| Rapid toggle spam (enable/disable/enable quickly) | Each operation completes in order; final state matches last command | Step 3 |
| Enable-while-already-enabled with path change | Old watcher dropped, new manifest loaded, new watcher started | Step 2, Step 3 |
| Disable during pending debounce | Debounce completes but reload is suppressed (per [D07]) | Step 2 |
| Invalid source tree path recovery | `enable_dev_mode` returns `Err`, shared state remains `None`, error response sent | Step 2, Step 3 |
| UDS disconnect during dev mode operation | Responses silently dropped, dev mode state still consistent | Step 3 |

---

### 1.0.4 Execution Steps {#execution-steps}

> **Sequencing invariants:**
> 1. Each step must compile independently (`cargo build` with no warnings).
> 2. Steps that change function signatures must also update all call sites within the same step.
> 3. The Mac app must be able to pass `--dev` without error at every intermediate step until Step 4 removes it from the Mac app's args.

#### Step 0: Add arc-swap dependency and SharedDevState type {#step-0}

**Commit:** `feat(tugcast): add arc-swap dependency and SharedDevState type alias`

**References:** [D02] ArcSwap shared state, Spec S02, (#shared-dev-state-type, #new-crates)

**Artifacts:**
- `tugcode/Cargo.toml` -- add `arc-swap` to `[workspace.dependencies]`
- `tugcode/crates/tugcast/Cargo.toml` -- add `arc-swap = { workspace = true }` to `[dependencies]`
- `tugcode/crates/tugcast/src/dev.rs` -- `SharedDevState` type alias, `DevRuntime` struct, `new_shared_dev_state` helper

**Tasks:**
- [ ] Add `arc-swap = "1"` to workspace `Cargo.toml` at `tugcode/Cargo.toml` under `[workspace.dependencies]`
- [ ] Add `arc-swap = { workspace = true }` to `tugcode/crates/tugcast/Cargo.toml` under `[dependencies]`
- [ ] Add `use arc_swap::ArcSwap;` to `tugcode/crates/tugcast/src/dev.rs`
- [ ] Define `pub(crate) type SharedDevState = Arc<ArcSwap<Option<DevState>>>;` in `dev.rs`
- [ ] Define `pub(crate) struct DevRuntime { _watcher: RecommendedWatcher }` in `dev.rs`
- [ ] Add `pub(crate) fn new_shared_dev_state() -> SharedDevState` helper that returns `Arc::new(ArcSwap::from_pointee(None))`

**Tests:**
- [ ] Unit test: `new_shared_dev_state()` returns a `SharedDevState` where `load()` is `None`
- [ ] Unit test: `store(Arc::new(Some(state)))` followed by `load()` returns `Some`

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Rollback:**
- Revert `arc-swap` additions from both Cargo.toml files, remove new types from `dev.rs`

**Commit after all checkpoints pass.**

---

#### Step 1: Deprecate --dev flag, replace static dev setup with SharedDevState, unify asset serving {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugcast): deprecate --dev CLI flag, wire SharedDevState through server`

**References:** [D02] ArcSwap shared state, [D04] Unified asset handler, [D10] Deprecated --dev flag, Spec S02, (#scope, #context, #shared-dev-state-type, #d04-unified-asset-handler, #d10-deprecated-dev-flag)

**Artifacts:**
- `tugcode/crates/tugcast/src/cli.rs` -- `dev` field marked `#[arg(long, hide = true)]` (hidden, still accepted but ignored)
- `tugcode/crates/tugcast/src/main.rs` -- Dev setup block removed, `SharedDevState` created and passed to `run_server`; `cli.dev` is no longer read
- `tugcode/crates/tugcast/src/server.rs` -- `build_app` and `run_server` signatures updated to take `SharedDevState`
- `tugcode/crates/tugcast/src/dev.rs` -- `serve_dev_asset` and `serve_dev_index` signatures updated to take `&DevState` instead of `Extension<Arc<DevState>>`; unit tests updated for new signatures
- `tugcode/crates/tugcast/src/integration_tests.rs` -- All `build_app` calls updated to pass `SharedDevState`

> This step is intentionally large because it changes function signatures across multiple files. Splitting it would leave intermediate states where call sites pass the old type to functions expecting the new type, causing build failures. All call sites (main.rs, integration_tests.rs, dev.rs unit tests) must be updated atomically.
>
> **Key: --dev is NOT removed from cli.rs.** It is marked `#[arg(long, hide = true)]` so the Mac app can still pass it without error (per [D10]). The field remains in the struct but main.rs stops reading it.

**Tasks:**
- [ ] Mark the `dev` field in `Cli` struct with `#[arg(long, hide = true)]` (keeps it accepted by Clap but hidden from `--help`)
- [ ] Remove `test_cli_dev_flag_none` and `test_cli_dev_flag_some` from `cli.rs` tests (these tested the active `--dev` flag; it is now deprecated)
- [ ] Update `test_control_socket_with_other_flags` to remove `--dev` and its value from the args array (keep the test -- it still validates `--port`, `--session`, and `--control-socket` together)
- [ ] In `main.rs`, remove the entire `let (dev_state, _watcher) = if let Some(ref dev_path) = cli.dev { ... }` block (lines 143-173). This removes the only call site for `dev_file_watcher` in production code. The `cli.dev` field is still parsed by Clap but never read.
- [ ] Add `#[allow(dead_code)] // Called by enable_dev_mode, added in next step` annotation to the `dev_file_watcher` function in `dev.rs`. Without this, the `-D warnings` policy causes a build failure because `dev_file_watcher` has zero callers after the dev setup block is removed (unlike `load_manifest`/`validate_manifest`/`watch_dirs_from_manifest` which have test callers).
- [ ] In `main.rs`, create `SharedDevState` via `let shared_dev_state = dev::new_shared_dev_state();` and pass it to `server::run_server`
- [ ] Change `build_app` signature in `server.rs`: `fn build_app(router: FeedRouter, dev_state: SharedDevState) -> Router`
- [ ] Change `run_server` signature in `server.rs`: `async fn run_server(listener: TcpListener, router: FeedRouter, dev_state: SharedDevState)`
- [ ] Write a unified fallback handler in `build_app` that loads `SharedDevState` via `dev_state.load()`: if `Some`, delegates to `serve_dev_asset` / `serve_dev_index`; if `None`, serves from embedded `Assets`
- [ ] Remove the `if let Some(state) ... else` branching in current `build_app`; always install the unified fallback and unified `/` + `/index.html` route handlers
- [ ] Update `serve_dev_asset` signature to `async fn serve_dev_asset(uri: Uri, dev_state: &DevState) -> Response` (remove `Extension<Arc<DevState>>` parameter)
- [ ] Update `serve_dev_index` signature to `async fn serve_dev_index(dev_state: &DevState) -> Response` (remove `Extension<Arc<DevState>>` parameter)
- [ ] Update all 9 unit tests in `dev.rs` that call `serve_dev_asset(uri, Extension(Arc::new(state)))` to use the new `serve_dev_asset(uri, &state)` signature; update `serve_dev_index` call sites similarly
- [ ] Update `build_test_app` in `integration_tests.rs` to call `build_app(feed_router, dev::new_shared_dev_state())`
- [ ] Update `test_build_app_dev_mode` and all manifest-based serving tests in `integration_tests.rs` to populate `SharedDevState` by calling `shared_state.store(Arc::new(Some(dev_state)))` instead of passing `Some(Arc::new(dev_state))` to `build_app`

**Tests:**
- [ ] Unit test: `Cli::try_parse_from(["tugcast", "--dev", "/tmp"])` succeeds (flag is still accepted, just hidden)
- [ ] Unit test: `tugcast --help` output does NOT contain `--dev`
- [ ] Integration test: `build_app` with empty `SharedDevState` serves embedded assets (production mode)
- [ ] Integration test: `build_app` with populated `SharedDevState` serves from disk (dev mode)
- [ ] Integration test: asset serving switches from embedded to disk when shared state is populated mid-test
- [ ] All existing dev.rs unit tests pass with updated `serve_dev_asset`/`serve_dev_index` signatures
- [ ] All existing integration tests pass with updated `build_app` signatures

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `cd tugcode && cargo run -- --dev /tmp` does NOT crash (flag accepted, silently ignored)
- [ ] `cd tugcode && cargo run -- --help` does not show `--dev`

**Rollback:**
- Restore `dev` field visibility in `Cli`, restore dev setup block in `main.rs`, revert all signature changes

**Commit after all checkpoints pass.**

---

#### Step 2: Add enable_dev_mode, disable_dev_mode, and debounce gating {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): add enable_dev_mode and disable_dev_mode functions`

**References:** [D03] DevRuntime struct, [D05] spawn_blocking, [D07] debounce gating, Spec S03, Spec S04, Spec S05, (#dev-runtime-struct, #enable-disable-functions)

**Artifacts:**
- `tugcode/crates/tugcast/src/dev.rs` -- `enable_dev_mode` async fn, `disable_dev_mode` fn, updated `dev_file_watcher` with debounce gating

**Tasks:**
- [ ] Implement `enable_dev_mode` async fn per Spec S04: `spawn_blocking` for `load_manifest`, `validate_manifest`, derive watch dirs, create watcher, store state
- [ ] Implement `disable_dev_mode` fn per Spec S05: store `None`, drop runtime
- [ ] Remove the `#[allow(dead_code)]` annotation from `dev_file_watcher` that was added in Step 1 (it now has a caller: `enable_dev_mode`)
- [ ] Add `SharedDevState` parameter to `dev_file_watcher`: `fn dev_file_watcher(watch_dirs: &[PathBuf], client_action_tx: broadcast::Sender<Frame>, shared_state: SharedDevState)`. This is safe because `dev_file_watcher` has no call sites remaining in `main.rs` (the old static dev setup block was removed in Step 1); it is now called only from `enable_dev_mode` within the same file
- [ ] In the debounce task inside `dev_file_watcher`, before sending the reload frame, check `shared_state.load().is_some()` and skip the send if dev mode has been disabled (per [D07])

**Tests:**
- [ ] Unit test: `enable_dev_mode` with valid manifest returns `Ok(DevRuntime)` and shared state becomes `Some`
- [ ] Unit test: `enable_dev_mode` with invalid path returns `Err` and shared state remains `None`
- [ ] Unit test: `disable_dev_mode` clears shared state to `None`
- [ ] Unit test: enable-while-already-enabled with different path: call `disable_dev_mode` then `enable_dev_mode` with new path; shared state reflects new manifest
- [ ] Unit test: `disable_dev_mode` during pending debounce: after disable, debounce fires but reload is suppressed (shared state is `None`)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes

**Rollback:**
- Revert new functions and `dev_file_watcher` signature change in `dev.rs`

**Commit after all checkpoints pass.**

---

#### Step 3: Add DevMode control message, response channel, and wire into recv loop {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugcast): add dev_mode control message with recv loop handling and auto-reload`

**References:** [D01] Dev mode control message, [D06] Error feedback path, [D09] Dev mode response channel, [D11] Gated load and auto-reload, Spec S01, Spec S06, (#control-message-protocol, #dev-mode-response-channel, #d09-dev-mode-response-channel, #d11-gated-load-and-auto-reload)

**Artifacts:**
- `tugcode/crates/tugcast/src/control.rs` -- `DevMode` variant, `make_dev_mode_result` helper, `make_shutdown_message` helper, updated recv loop
- `tugcode/crates/tugcast/src/main.rs` -- Create mpsc channel, move `ControlWriter` into draining task after `send_ready`, pass `response_tx` to recv loop, send shutdown via channel

**Tasks:**
- [ ] Add `DevMode { enabled: bool, source_tree: Option<String> }` variant to `ControlMessage` enum in `control.rs`
- [ ] Add `pub(crate) fn into_inner(self) -> BufWriter<OwnedWriteHalf>` method to `ControlWriter` that returns `self.writer` (used by draining task in `main.rs`)
- [ ] Add helper function `make_dev_mode_result(success: bool, error: Option<&str>) -> String` for response serialization (returns JSON string)
- [ ] Add helper function `make_shutdown_message(reason: &str, pid: u32) -> String` for shutdown serialization (same format as existing `send_shutdown`, as a standalone serializer)
- [ ] Update `ControlReader::run_recv_loop` signature to accept `SharedDevState`, `broadcast::Sender<Frame>` (already passed), and `response_tx: mpsc::Sender<String>`
- [ ] Handle `ControlMessage::DevMode` in recv loop: hold `Option<DevRuntime>` as local state; on `enabled: true` with existing runtime, first call `disable_dev_mode` to teardown old watcher, then call `enable_dev_mode`; on success, send success result via `response_tx.send(make_dev_mode_result(true, None))` AND broadcast `reload_frontend` Control frame via `client_action_tx` (per [D11]); on error, send error result via `response_tx`; on `enabled: false`, call `disable_dev_mode` if runtime exists, send success result
- [ ] In `main.rs`, keep `send_ready` call on `ControlWriter` exactly as it is today (no changes to ready path)
- [ ] In `main.rs`, after `send_ready`, create `mpsc::channel::<String>(4)` and move `ControlWriter` into a spawned draining task that loops on `rx.recv()`, writing each string as a newline-terminated line to the socket and flushing
- [ ] In `main.rs`, pass `SharedDevState` and `response_tx` clone to `reader.run_recv_loop()`
- [ ] In `main.rs`, replace the direct `send_shutdown` call at exit with: serialize shutdown JSON via `make_shutdown_message(reason, pid)`, send through `response_tx`, then drop the sender. The draining task writes the shutdown message and exits when the channel closes

**Tests:**
- [ ] Unit test: `ControlMessage::DevMode` deserializes correctly with `enabled: true` and `source_tree`
- [ ] Unit test: `ControlMessage::DevMode` deserializes correctly with `enabled: false`
- [ ] Unit test: `make_dev_mode_result(true, None)` produces correct JSON string `{"type":"dev_mode_result","success":true}`
- [ ] Unit test: `make_dev_mode_result(false, Some("error msg"))` produces correct JSON string with error field
- [ ] Unit test: `make_shutdown_message("restart", 12345)` produces correct JSON string matching existing `send_shutdown` format
- [ ] Integration test: send `dev_mode` enable message over UDS, verify shared state changes to `Some` and `reload_frontend` broadcast received
- [ ] Integration test: send `dev_mode` disable message over UDS, verify shared state changes to `None`
- [ ] Integration test: send `dev_mode` enable with invalid path, verify error response received and shared state remains `None`
- [ ] Integration test: rapid toggle -- send enable, disable, enable quickly; verify final state matches last command
- [ ] Integration test: UDS disconnect during operation -- drop connection, verify dev mode state is still consistent

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `cd tugcode && cargo run -- --dev /tmp` does NOT crash (deprecated flag still accepted)

**Rollback:**
- Revert `ControlMessage` changes, revert `main.rs` draining task and channel changes, restore direct `send_shutdown` call

**Commit after all checkpoints pass.**

---

#### Step 4: Update Mac app and frontend for runtime dev mode {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugapp): send dev_mode control message, remove --dev flag, add error feedback`

**References:** [D01] Dev mode control message, [D06] Error feedback path, [D08] Missing source tree, [D11] Gated load and auto-reload, [D12] Re-send on source tree change, Spec S01, (#control-message-protocol, #d08-missing-source-tree, #d06-error-feedback-path, #d11-gated-load-and-auto-reload, #d12-resend-on-source-tree-change)

**Artifacts:**
- `tugapp/Sources/ProcessManager.swift` -- `sendDevMode` method, `--dev` removed from args, `dev_mode_result` handling with `onDevModeResult`/`onDevModeError` callbacks
- `tugapp/Sources/AppDelegate.swift` -- Send dev_mode on ready (gate loadURL on dev_mode_result when dev enabled), send on toggle, remove `runtimeDevMode`, forward errors to frontend, re-send on source tree change
- `tugapp/Sources/MainWindow.swift` -- Simplify `BridgeDelegate` protocol (remove `runtimeDevMode`), add `bridgeDevModeError` for error feedback
- `tugdeck/src/cards/settings-card.ts` -- Remove `runtimeDevMode`, remove restart prompt, add `onDevModeError` handler

> **runtimeDevMode removal cascade:** The `runtimeDevMode` property flows through a chain: `AppDelegate.runtimeDevMode` -> `bridgeGetSettings(completion: (Bool, Bool, String?))` -> `MainWindow.swift` `onSettingsLoaded` JS callback -> `settings-card.ts` `onSettingsLoaded` handler. The second `Bool` in the callback is `runtimeDevMode`, used by `settings-card.ts` to decide when to show a "restart required" prompt. With runtime dev mode, restart is never needed, so the entire chain simplifies: `bridgeGetSettings` drops its second `Bool` parameter, and the restart prompt UI is removed.

**Tasks:**

*ProcessManager.swift:*
- [ ] Add `sendDevMode(enabled: Bool, sourceTree: String?)` method to `ProcessManager` that sends `{"type":"dev_mode","enabled":true,"source_tree":"..."}` or `{"type":"dev_mode","enabled":false}` via `controlConnection.send()`
- [ ] Remove `--dev` arg construction from `startProcess()` (remove the `if devEnabled, let devPath = freshSourceTree { args += ["--dev", devPath] }` block)
- [ ] Add `var onDevModeError: ((String) -> Void)?` callback property to `ProcessManager`
- [ ] Add `var onDevModeResult: ((Bool) -> Void)?` callback property to `ProcessManager` (receives `success` bool, used by AppDelegate to gate initial `loadURL` per [D11])
- [ ] Handle `dev_mode_result` message type in `handleControlMessage`: call `onDevModeResult?(success)` always; additionally, if `success` is false, call `onDevModeError?(errorMessage)`

*AppDelegate.swift:*
- [ ] Add `var awaitingDevModeResult: Bool = false` property to `AppDelegate` (tracks whether initial `loadURL` is gated on `dev_mode_result`)
- [ ] Update `processManager.onReady`: if `devModeEnabled` and `sourceTreePath` is set, call `processManager.sendDevMode(enabled: true, sourceTree: path)` and set `awaitingDevModeResult = true` -- do NOT call `loadURL`. If not `devModeEnabled` (or no source tree per [D08]), call `loadURL` immediately (unchanged behavior)
- [ ] Wire `processManager.onDevModeResult`: if `awaitingDevModeResult` is true, call `loadURL` (regardless of success/failure -- success means dev assets, failure means embedded assets, either way the page should load), then set `awaitingDevModeResult = false`
- [ ] Update `bridgeSetDevMode` to send control message immediately on toggle: if enabling with source tree, send `sendDevMode(enabled: true, sourceTree: path)`; if disabling, send `sendDevMode(enabled: false, sourceTree: nil)`
- [ ] Wire `processManager.onDevModeError` to call `window.bridgeDevModeError(message:)` which evaluates JS `window.__tugBridge?.onDevModeError?('escaped message')` (canonical path: ProcessManager callback -> AppDelegate -> MainWindow JS bridge)
- [ ] Remove `runtimeDevMode` property (no longer needed; dev mode changes are instant)
- [ ] Remove `runtimeDevMode` update from `processManager.onReady` closure (line 54)
- [ ] Simplify `bridgeGetSettings` implementation: change `completion(devModeEnabled, runtimeDevMode, sourceTreePath)` to `completion(devModeEnabled, sourceTreePath)`
- [ ] In `bridgeChooseSourceTree`, after updating `sourceTreePath` and saving preferences: if `devModeEnabled` is true, immediately call `processManager.sendDevMode(enabled: true, sourceTree: newPath)` to re-activate with the new path (per [D12])

*MainWindow.swift:*
- [ ] Simplify `BridgeDelegate` protocol (line 8): change `bridgeGetSettings(completion: @escaping (Bool, Bool, String?) -> Void)` to `bridgeGetSettings(completion: @escaping (Bool, String?) -> Void)`
- [ ] Add `bridgeDevModeError(message: String)` to `BridgeDelegate` protocol
- [ ] Update `getSettings` handler (lines 141-153): change callback to `{ devMode, sourceTree in ... }`; remove `runtimeDevMode` from JS call; change JS object to `{devMode: \(devMode), sourceTree: \(stValue)}`
- [ ] Implement `bridgeDevModeError(message:)` in `MainWindow.swift`: evaluate JS `window.__tugBridge?.onDevModeError?('\(escaped)')` on the webView (canonical path: AppDelegate calls `window.bridgeDevModeError(message:)`, MainWindow evaluates the JS)

*settings-card.ts:*
- [ ] Update `onSettingsLoaded` type (line 253): change to `{ devMode: boolean; sourceTree: string | null }`
- [ ] Register `bridge.onDevModeError` callback: revert `devModeCheckbox.checked` to false, re-enable checkbox, call `showDevNote(message)` to display the error
- [ ] Remove `initialDevMode` property (line 24)
- [ ] Remove `initialSourceTree` and `currentSourceTree` properties (lines 25-26)
- [ ] Remove `restartPromptEl` and `restartBtn` properties and their DOM construction (lines 28-29, 126-151)
- [ ] Remove `restartFailsafeTimer` property and its cleanup logic (lines 30, 140-147, 329-332)
- [ ] Remove `updateRestartPrompt()` method (lines 237-244) and all calls to it (lines 264, 278, 287)
- [ ] Remove `closeUnsubscribe` property and the `onClose` subscription (lines 31, 298-303, 327-328)
- [ ] In `onSettingsLoaded` handler (line 258), remove `this.initialDevMode = data.runtimeDevMode`
- [ ] In `destroy()`, remove cleanup of `initialSourceTree`, `currentSourceTree`, `restartPromptEl`, `restartBtn` references; add cleanup of `onDevModeError` bridge callback

**Tests:**
- [ ] Manual test: toggle dev mode in Mac app UI, verify asset serving changes without restart
- [ ] Manual test: launch Mac app with dev mode enabled, verify dev assets served on first render (loadURL gated on dev_mode_result per [D11])
- [ ] Manual test: launch Mac app with dev mode enabled but invalid source tree, verify page loads with embedded assets after dev_mode_result error
- [ ] Manual test: open Settings card, verify no restart prompt appears after toggling dev mode
- [ ] Manual test: enable dev mode with invalid source tree -- verify checkbox reverts and error message appears in Settings card
- [ ] Manual test: change source tree while dev mode is enabled -- verify new assets are served
- [ ] Manual test: verify Settings card loads correctly and shows dev mode checkbox state

**Checkpoint:**
- [ ] Mac app builds successfully (`xcodebuild` or Xcode build) -- confirms BridgeDelegate protocol, MainWindow, and AppDelegate changes are consistent
- [ ] `cd tugdeck && bun build src/main.ts --outfile=dist/app.js` succeeds -- confirms settings-card.ts compiles
- [ ] Cold launch with dev mode enabled -- first page render shows dev assets (no flash of embedded assets)
- [ ] Cold launch with dev mode enabled but invalid source tree -- page loads with embedded assets after dev_mode_result error
- [ ] Toggle dev mode in running app -- dev assets served immediately, no restart prompt shown
- [ ] Disable dev mode -- embedded assets served immediately
- [ ] Enable with bad path -- checkbox reverts, error shown in Settings card
- [ ] `cd tugcode && cargo run -- --dev /tmp` does NOT crash (deprecated flag still accepted, needed until Step 5)

**Rollback:**
- Restore `--dev` in `ProcessManager.startProcess()`, revert `AppDelegate`, `MainWindow`, and `settings-card.ts` changes

**Commit after all checkpoints pass.**

---

#### Step 5: Remove deprecated --dev CLI flag {#step-5}

**Depends on:** #step-4

**Commit:** `chore(tugcast): remove deprecated --dev CLI flag`

**References:** [D10] Deprecated --dev flag, (#d10-deprecated-dev-flag)

**Artifacts:**
- `tugcode/crates/tugcast/src/cli.rs` -- `dev` field removed from `Cli` struct entirely

> This is a small, clean step. The Mac app no longer sends `--dev` (removed in Step 4), so the flag can be safely deleted from Clap. This is the only step where `--dev` actually disappears from the binary.

**Tasks:**
- [ ] Remove the `pub dev: Option<PathBuf>` field (with `#[arg(long, hide = true)]`) from `Cli` struct in `cli.rs`
- [ ] Add test `test_dev_flag_rejected` in `cli.rs`: `Cli::try_parse_from(["tugcast", "--dev", "/tmp"])` returns error (flag no longer recognized)

**Tests:**
- [ ] Unit test: `Cli::try_parse_from(["tugcast", "--dev", "/tmp"])` returns an error
- [ ] All existing tests pass

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] `cd tugcode && cargo run -- --help` does not show `--dev`
- [ ] `cd tugcode && cargo run -- --dev /tmp` exits with error (flag no longer recognized)

**Rollback:**
- Restore `dev` field with `#[arg(long, hide = true)]` in `Cli`

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Runtime dev mode toggle via UDS control message, replacing the static `--dev` CLI flag entirely.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `--dev` flag is removed from tugcast CLI (`tugcast --help` confirms)
- [ ] `dev_mode` control message enables/disables dev asset serving at runtime
- [ ] File watcher starts on enable, stops on disable
- [ ] Mac app sends `dev_mode` on ready and on toggle without restarting tugcast
- [ ] At startup with dev mode enabled, first page render uses dev assets (loadURL gated on dev_mode_result)
- [ ] Mid-session enable triggers auto-reload so already-loaded pages pick up dev assets
- [ ] Error responses propagate from tugcast through Mac app to settings UI
- [ ] Source tree changes while enabled trigger re-enable with new path
- [ ] All tugcast tests pass (`cargo nextest run`)
- [ ] Mac app builds and functions correctly

**Acceptance tests:**
- [ ] Integration test: dev_mode enable/disable round-trip over UDS
- [ ] Integration test: unified fallback handler serves embedded when state is None, disk when Some
- [ ] Integration test: auto-reload broadcast after successful enable
- [ ] Integration test: rapid toggle spam resolves to correct final state
- [ ] Unit test: ControlMessage::DevMode deserialization
- [ ] Unit test: SharedDevState load/store semantics

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add dev mode status to `/api/status` HTTP endpoint
- [ ] Explore persistent dev mode preference in tugcast config file
- [ ] Consider dev mode indicator in tugdeck frontend UI

| Checkpoint | Verification |
|------------|--------------|
| arc-swap compiles | `cargo build` |
| deprecated --dev still accepted | `cargo run -- --dev /tmp` (Steps 1-4) |
| unified fallback works | integration test |
| dev_mode message + auto-reload | integration test |
| error feedback reaches UI | manual test |
| source tree change re-enables | manual test |
| --dev flag removed | `tugcast --help` (Step 5) |
| Mac app sends control message | manual test |

**Commit after all checkpoints pass.**
