## Phase 1.0: Full Hot Reload for Dev Mode {#phase-hot-reload}

**Purpose:** Enable full hot reload across all three source languages (CSS, TypeScript, Rust) so that editing any source file produces a live-reloaded result in the running tugdeck dashboard, whether launched via the Mac app (`just app`) or the CLI (`just dev`).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-22 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Dev mode hot reload currently works for CSS and (partially) TypeScript when using the Mac app path. The CLI path (`just dev`) is broken because `tugtool/src/main.rs` still carries a dead `--dev` CLI flag that it passes to tugcast, which rejects it. Rust changes have no reload mechanism at all -- developers must manually `cargo build` and restart tugcast.

The control socket protocol already supports `dev_mode` messages with `source_tree` paths (confirmed in `tugcast/src/control.rs`). The `--dev` flag was already removed from tugcast's CLI (`test_dev_flag_rejected` confirms this). The remaining `--dev` references in tugtool are stale bugs that must be fixed.

#### Strategy {#strategy}

- Phase 1 (Step 0-1): Remove the dead `--dev` flag from tugtool and fix the CLI path to use the control socket protocol for dev mode activation. Send `dev_mode` after every successful `ready` (not just first spawn), so dev mode survives restarts. This unblocks CSS + TypeScript hot reload from the CLI.
- Phase 2 (Step 2): Add a binary mtime watcher inside tugcast (`dev.rs`) as a separate `spawn_binary_watcher()` function called from `enable_dev_mode()`. The watcher monitors `<source_tree>/tugcode/target/debug/tugcast` (NOT `current_exe()`), so it works correctly whether tugcast runs from the app bundle or from the cargo target directory. When the binary changes, send exit code 44 via `shutdown_tx`.
- Phase 3 (Step 3): Update `ProcessManager.swift` to handle the `binary_updated` shutdown reason by copying the new tugcast binary into the app bundle before respawning.
- Phase 4 (Step 4): Update tugtool's supervisor loop to handle `binary_updated` as a restart reason (same as `restart`). After respawn, tugtool re-sends `dev_mode` (per Step 1), which re-enables the binary watcher pointing at the correct path.
- Phase 5 (Step 5): Simplify `just dev` in the Justfile, add `just dev-watch` recipe with `cargo-watch` for fully hands-free Rust workflow.
- Validate end-to-end: Mac app and CLI both support CSS, TypeScript, and Rust hot reload.

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers working on tugtool using the Mac app (`just app`) -- primary workflow
2. Developers using the CLI path (`just dev`) -- secondary workflow

#### Success Criteria (Measurable) {#success-criteria}

- `just dev` launches tugtool, activates dev mode via control socket, spawns bun, and CSS + TypeScript hot reload works (manual verification)
- Editing a `.rs` file and running `cargo build` causes tugcast to detect the binary change and self-restart within 5 seconds
- The Mac app (`just app`) copies the new binary into the bundle and respawns tugcast when `binary_updated` shutdown is received
- Dev mode is re-established after every restart (not lost on first restart)
- `just dev-watch` provides hands-free Rust workflow via `cargo-watch`
- All existing tests pass; new tests cover binary watcher logic and `binary_updated` shutdown handling

#### Scope {#scope}

1. Remove `--dev` flag from tugtool CLI and `spawn_tugcast()` function
2. Send `dev_mode` control message from tugtool after every `wait_for_ready()`, not just first spawn
3. Wait for `dev_mode_result` acknowledgment before proceeding
4. Add `spawn_binary_watcher()` in `tugcast/src/dev.rs` with injectable binary path
5. Handle `binary_updated` shutdown reason in `ProcessManager.swift`
6. Handle `binary_updated` shutdown reason in tugtool supervisor loop
7. Update Justfile for simplified `just dev` and `just dev-watch` with `cargo-watch`

#### Non-goals (Explicitly out of scope) {#non-goals}

- HMR (Hot Module Replacement) -- all reloads remain full page reloads via `location.reload()`
- Incremental Rust compilation optimizations -- `cargo build` already does incremental compilation
- Multi-binary watching -- only `tugcast` needs restart; `tugcode` and `tugtool` are CLI tools; `tugtalk` is spawned on-demand
- CSS injection or partial JS replacement -- no state preservation

#### Dependencies / Prerequisites {#dependencies}

- Control socket protocol already supports `dev_mode` messages (confirmed in `control.rs`)
- `notify` crate already in tugcast's dependency tree (used by file watcher in `dev.rs`)
- Supervisor loops in both tugtool and ProcessManager.swift already handle restart/shutdown reasons
- `DevState` already stores `source_tree: PathBuf` -- the binary watcher derives the watch path from this

#### Constraints {#constraints}

- macOS only (primary platform for Mac app)
- Binary watcher uses polling (2-second interval) rather than filesystem events to avoid cross-platform complexity for a single file
- 500ms stabilization delay after mtime change before triggering shutdown (prevents triggering on partially-written binaries)
- Warnings are errors (`-D warnings`) -- all code must compile warning-free

#### Assumptions {#assumptions}

- The `--dev` flag was already removed from tugcast CLI (`test_dev_flag_rejected` confirms); references in tugtool are stale bugs
- Both dev mode entry points (Mac app and CLI) will share the same binary watcher code inside tugcast
- `tugtool` already has `detect_source_tree()` and `resolve_tugcast_path()` functions that work correctly
- The binary watcher watches `<source_tree>/tugcode/target/debug/tugcast`, not `current_exe()`, so it works regardless of where tugcast is running from

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Race between binary watcher and normal shutdown | med | low | Binary watcher sends via shutdown_tx which is gated by shutdown_rx.recv(); first sender wins, second is dropped | Observe double-restart or missed restart in logs |
| cargo build writes binary multiple times triggering multiple restarts | med | med | 500ms stabilization delay after mtime change; watcher re-checks mtime before firing | Observe rapid restart cycles during cargo build |
| 500ms stabilization insufficient for large builds | low | low | 500ms is conservative for incremental builds (~100ms write); full rebuilds are rare in dev | If restarts fire on partial binaries, increase to 1000ms |
| Dev mode lost after restart | high | med | Send dev_mode after every ready, not just first spawn | Observe tugcast running without dev mode after restart |

**Risk R01: Race between binary watcher shutdown and normal shutdown** {#r01-shutdown-race}

- **Risk:** If a user-initiated shutdown (via SIGINT or control message) races with the binary watcher's exit code 44, both could attempt to send to `shutdown_tx`. Since `shutdown_tx` is an `mpsc::channel(1)`, the second send blocks or is dropped.
- **Mitigation:** The existing `shutdown_rx.recv()` in `main()` takes the first value and proceeds. The binary watcher's `.send(44)` is fire-and-forget (uses `.await` but the task is aborted on disable). No special handling needed -- first sender wins.
- **Residual risk:** If the binary watcher fires simultaneously with a user-initiated restart (code 42), the restart still happens; the only difference is the shutdown reason string, which is cosmetic.

**Risk R02: Multiple binary writes during cargo build** {#r02-multiple-writes}

- **Risk:** `cargo build` may write the binary file multiple times (create, write, rename, or multiple link operations) causing the mtime to change more than once during a single build.
- **Mitigation:** The 500ms stabilization delay ensures the watcher only fires after the binary has been stable for 500ms. After detecting the first mtime change, the watcher sleeps 500ms and re-reads mtime. If it changed again during the sleep (still being written), the watcher can loop and re-wait. This ensures only one restart per build.
- **Residual risk:** Extremely slow builds that take > 2s between write operations could cause false positives, but this is unlikely with incremental compilation.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Dev mode activation via control socket only (DECIDED) {#d01-control-socket-only}

**Decision:** Dev mode is activated exclusively at runtime via the control socket `dev_mode` message. The `--dev` CLI flag on tugtool is removed entirely. Tugtool always attempts to detect the source tree (auto-detect or `--source-tree` override) and sends `dev_mode` if a source tree is found. If auto-detection fails, tugtool logs a warning and runs without dev mode (non-fatal). If `--source-tree` is explicitly provided and invalid, that is fatal.

**Rationale:**
- The `--dev` flag was already removed from tugcast's CLI; the tugtool reference is a stale bug
- The control socket protocol already supports `dev_mode` messages with `source_tree` paths
- Runtime activation is more flexible than compile-time flags
- Always attempting source-tree detection means the developer doesn't need to remember a flag

**Implications:**
- `tugtool/src/main.rs` Cli struct loses its `dev: bool` field
- `spawn_tugcast()` loses its `dev_path` parameter
- `main()` must always attempt source tree detection and send `dev_mode` if found
- Explicit `--source-tree` failures are fatal; auto-detect failures are warnings (non-fatal, run without dev mode)
- Tests referencing `--dev` must be updated

#### [D02] Keep --source-tree flag on tugtool for manual override (DECIDED) {#d02-keep-source-tree}

**Decision:** The `--source-tree` flag remains on tugtool for manual override of auto-detection.

**Rationale:**
- Auto-detection via `detect_source_tree()` works for the common case
- Manual override is useful when running from unusual directory structures
- The flag is harmless and provides flexibility

**Implications:**
- `--source-tree` is used to populate the `source_tree` field in the `dev_mode` control message
- If not provided, `detect_source_tree()` is used
- If `--source-tree` is explicitly provided and the path is invalid, exit with error (fatal)
- If auto-detect fails, log warning and continue without dev mode (non-fatal)

#### [D03] Binary watcher as separate spawn_binary_watcher() function (DECIDED) {#d03-separate-binary-watcher}

**Decision:** The binary mtime watcher is implemented as a separate `spawn_binary_watcher()` function in `dev.rs`, called from `enable_dev_mode()`. It is cleanly separated from the file watcher. The watched path is an injectable parameter, NOT hardcoded to `current_exe()`.

**Rationale:**
- Clean separation of concerns: file watcher watches assets, binary watcher watches the executable
- Different polling intervals (binary: 2s poll, file: event-driven via `notify`)
- Different actions on change (binary: shutdown with `binary_updated`, file: `reload_frontend`)
- Injectable path is essential: in the Mac app, `current_exe()` points to the app bundle, not the cargo build output. The correct target is `<source_tree>/tugcode/target/debug/tugcast`.
- Injectable path makes unit testing possible against temp files

**Implications:**
- `spawn_binary_watcher()` takes `binary_path: PathBuf` as its first parameter, derived from `DevState.source_tree`
- `spawn_binary_watcher()` returns a `JoinHandle` that is stored in `DevRuntime`
- `DevRuntime` gains a new field `_binary_watcher: Option<JoinHandle<()>>`; the construction site `DevRuntime { _watcher: watcher }` must be updated to include this field
- `disable_dev_mode()` must call `.abort()` on the `JoinHandle` -- `drop()` alone does NOT abort a spawned tokio task; explicit `.abort()` is required to cancel the polling loop
- The binary path is `<source_tree>/tugcode/target/debug/tugcast`; if the file doesn't exist at enable time, the watcher polls until it appears (common case: dev mode enabled before first `cargo build`)

#### [D04] Shutdown via exit code 44 for binary_updated (DECIDED) {#d04-binary-updated-reason}

**Decision:** When the binary watcher detects an mtime change, it sends exit code `44` via `shutdown_tx` only. It does NOT write to `response_tx` directly. The existing shutdown path in `tugcast/src/main.rs` maps exit codes to shutdown reasons and sends the single shutdown message over the control socket. A new mapping `44 => "binary_updated"` is added alongside the existing `42 => "restart"` and `43 => "reset"` mappings.

**Rationale:**
- Avoids double-shutdown-message bug: `main()` already sends a shutdown message for every exit code via `response_tx`. If the binary watcher also sent via `response_tx`, two shutdown messages would be written to the control socket
- Follows the established pattern: actions module uses `shutdown_tx.send(42)` for restart and `shutdown_tx.send(43)` for reset; the binary watcher follows the same convention with exit code 44
- Distinguishes binary-changed restarts from other restart reasons, allowing ProcessManager.swift to handle copy-then-restart specifically

**Implications:**
- `tugcast/src/main.rs` gains `44 => "binary_updated"` in the exit code match
- `spawn_binary_watcher()` only needs `shutdown_tx: mpsc::Sender<u8>`, not `response_tx`
- `ProcessManager.swift` must add a `binary_updated` case to its shutdown reason switch
- tugtool supervisor loop must add `binary_updated` to its restart reasons
- The shutdown message includes `pid` for validation as with all other shutdown messages

#### [D05] Polling-based binary watcher with stabilization delay (DECIDED) {#d05-polling-watcher}

**Decision:** The binary watcher uses a 2-second polling interval with a 500ms stabilization delay after detecting an mtime change.

**Rationale:**
- Polling a single file every 2 seconds is negligible overhead
- Simpler than setting up filesystem events for one file
- Stabilization delay prevents triggering on partially-written binaries during `cargo build`
- Cross-platform: works the same on macOS and Linux

**Implications:**
- Worst-case detection latency is ~2.5 seconds (2s poll + 500ms stabilization)
- The watcher runs as a tokio task, not a native thread

#### [D06] ProcessManager copies binary into app bundle on binary_updated (DECIDED) {#d06-processmanager-copy}

**Decision:** When ProcessManager.swift receives a shutdown with `reason: "binary_updated"`, it copies `tugcode/target/debug/tugcast` from the source tree into the app bundle's `Contents/MacOS/` directory before respawning.

**Rationale:**
- The Mac app runs tugcast from the app bundle, not from the cargo target directory
- Without copying, the respawned process would still be the old binary
- The source tree path is already stored in `UserDefaults` (`SourceTreePath`)

**Implications:**
- ProcessManager needs filesystem access to the source tree (already has it via UserDefaults)
- Copy operation is synchronous and fast (single binary file)
- If copy fails, fall back to restart with existing binary and log an error

#### [D07] cargo-watch in separate `just dev-watch` recipe (DECIDED) {#d07-cargo-watch}

**Decision:** `cargo-watch` integration is provided in a separate `just dev-watch` recipe rather than being built into the default `just dev`. Only `tugcast` is rebuilt (not `tugtool`), since only tugcast needs hot restart.

**Rationale:**
- Keeps `just dev` simple and predictable -- it launches tugtool and bun, nothing else
- `just dev-watch` adds `cargo watch -w crates -s "cargo build -p tugcast"` (run from `tugcode/`) for hands-free Rust rebuilds
- Only rebuilding `tugcast` reduces latency compared to rebuilding both `tugcast` and `tugtool`
- Developers who prefer manual `cargo build` or use rust-analyzer's build-on-save use `just dev`
- Developers who want fully hands-free use `just dev-watch`

**Implications:**
- Two Justfile recipes: `dev` (simple) and `dev-watch` (with cargo-watch)
- `cargo-watch` must be installed for `just dev-watch` (`cargo install cargo-watch`)
- `just dev-watch` checks for `cargo-watch` availability before spawning, exits with helpful message if not found

#### [D08] dev_mode re-sent after every restart (DECIDED) {#d08-dev-mode-every-restart}

**Decision:** Tugtool sends the `dev_mode` control message after every successful `ready`, not just on first spawn. This ensures dev mode is re-established after any restart (restart, reset, binary_updated). Bun spawning remains first-spawn-only since bun persists across tugcast restarts.

**Rationale:**
- A restarted tugcast comes up with empty dev state -- it doesn't remember it was in dev mode
- Without re-sending, the first restart would silently drop dev mode (no file watcher, no source-direct serving)
- The binary watcher is created by `enable_dev_mode()`, so re-sending `dev_mode` after restart re-creates the watcher pointing at the correct source tree path

**Implications:**
- `send_dev_mode()` is called inside the supervisor loop after every `wait_for_ready()`, gated on `source_tree.is_some()`
- Bun spawning is gated on `first_spawn` (not every restart)
- The supervisor must wait for `dev_mode_result` response before logging "ready" to avoid "looks started but not in dev mode" states

#### [D09] CLI waits for dev_mode_result acknowledgment (DECIDED) {#d09-dev-mode-ack}

**Decision:** After sending `dev_mode`, tugtool waits for the `dev_mode_result` response on the control socket before proceeding. On success, it logs readiness. On failure, it logs the error but continues running (dev mode is degraded, not fatal).

**Rationale:**
- The Mac app path already gates page load on `dev_mode_result`
- Without waiting, the CLI path can produce "looks started but not in dev mode" states
- Clear logging at startup tells the developer whether dev mode is active

**Implications:**
- After `send_dev_mode()`, read from the control socket reader for a `dev_mode_result` message
- Timeout after 5 seconds (shorter than `wait_for_ready()`'s 30s, since tugcast is already running and dev mode enable should be fast)
- On success: `info!("dev mode enabled")`
- On failure: `warn!("dev mode failed: {}", error)` -- continue running, just without dev features
- If a `shutdown` message arrives before `dev_mode_result`, enter the restart path immediately (tugcast is going down, no point waiting for ack)
- Ignore any other unrecognized message types while waiting (keep reading until `dev_mode_result`, `shutdown`, or timeout)

---

### 1.0.1 Symbol Inventory {#symbol-inventory}

#### 1.0.1.1 Modified files {#modified-files}

| File | Changes |
|------|---------|
| `tugcode/crates/tugtool/src/main.rs` | Remove `--dev` flag, remove `dev_path` param from `spawn_tugcast()`, add `send_dev_mode()` and `wait_for_dev_mode_result()`, send dev_mode after every ready, update `main()` and supervisor loop |
| `tugcode/crates/tugcast/src/dev.rs` | Add `spawn_binary_watcher()` with injectable path, add `_binary_watcher` to `DevRuntime`, update `enable_dev_mode()` and `disable_dev_mode()` |
| `tugcode/crates/tugcast/src/main.rs` | Add `44 => "binary_updated"` exit code mapping in shutdown message block |
| `tugapp/Sources/ProcessManager.swift` | Add `binary_updated` case in `handleControlMessage`, add `copyBinaryFromSourceTree()` |
| `Justfile` | Update `dev` recipe, add `dev-watch` recipe |

#### 1.0.1.2 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Cli.dev` | field (remove) | `tugtool/src/main.rs` | Remove `--dev` bool flag |
| `spawn_tugcast` | fn (modify) | `tugtool/src/main.rs` | Remove `dev_path` parameter |
| `send_dev_mode` | fn (new) | `tugtool/src/main.rs` | Send dev_mode message over control socket write half |
| `wait_for_dev_mode_result` | fn (new) | `tugtool/src/main.rs` | Read dev_mode_result from control socket reader, with timeout |
| `spawn_binary_watcher` | fn (new) | `tugcast/src/dev.rs` | Takes `binary_path: PathBuf`, polls mtime, sends exit code 44 via `shutdown_tx` |
| `DevRuntime._binary_watcher` | field (new) | `tugcast/src/dev.rs` | `Option<tokio::task::JoinHandle<()>>` for the watcher task |
| exit code 44 mapping | match arm (new) | `tugcast/src/main.rs` | `44 => "binary_updated"` in shutdown reason mapping |
| `copyBinaryFromSourceTree` | fn (new) | `ProcessManager.swift` | Copy tugcast binary from source tree to app bundle |

---

### 1.0.2 Execution Steps {#execution-steps}

#### Step 0: Remove --dev flag from tugtool and fix spawn_tugcast {#step-0}

**Commit:** `fix: remove dead --dev flag from tugtool, fix spawn_tugcast to not pass --dev to tugcast`

**References:** [D01] Dev mode activation via control socket only, [D02] Keep --source-tree flag, (#d01-control-socket-only, #d02-keep-source-tree, #context, #modified-files)

**Artifacts:**
- Modified `tugcode/crates/tugtool/src/main.rs`: Cli struct, `spawn_tugcast()`, `main()`, tests

**Tasks:**
- [ ] Remove `dev: bool` field from `Cli` struct
- [ ] Remove the `dev_path: Option<&std::path::Path>` parameter from `spawn_tugcast()`
- [ ] Remove the `if let Some(path) = dev_path { cmd.arg("--dev")... }` block from `spawn_tugcast()`
- [ ] Update `supervisor_loop()` signature to remove `dev_path: Option<PathBuf>` parameter
- [ ] Update `supervisor_loop()` to call `spawn_tugcast()` without `dev_path`
- [ ] Keep `--source-tree` flag and `detect_source_tree()` function unchanged
- [ ] Update `main()` to remove `if cli.dev { ... }` block that computes `dev_path`
- [ ] Update `main()` to always call `supervisor_loop()` without `dev_path`
- [ ] Update `test_cli_dev_flag` test: verify `--dev` is now rejected (like tugcast's `test_dev_flag_rejected`)
- [ ] Remove the `dev = cli.dev` line from the `info!` macro in `main()`
- [ ] Verify `--source-tree` test still passes

**Tests:**
- [ ] Unit test: `test_dev_flag_rejected` -- verify `--dev` is no longer accepted by clap
- [ ] Unit test: `test_cli_source_tree_flag` -- unchanged, verify still passes
- [ ] Unit test: `test_default_values` -- verify no `dev` field

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugtool` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes all tests
- [ ] `tugcode/target/debug/tugtool --dev` exits with an error (unknown flag)

**Rollback:**
- Revert the commit; restore the `--dev` flag and `dev_path` parameter

**Commit after all checkpoints pass.**

---

#### Step 1: Send dev_mode message from tugtool after every ready {#step-1}

**Depends on:** #step-0

**Commit:** `feat: tugtool sends dev_mode after every ready, waits for ack, spawns bun on first spawn`

**References:** [D01] Dev mode activation via control socket only, [D02] Keep --source-tree flag, [D08] dev_mode re-sent after every restart, [D09] CLI waits for dev_mode_result, (#d01-control-socket-only, #d02-keep-source-tree, #d08-dev-mode-every-restart, #d09-dev-mode-ack, #context, #symbols)

**Artifacts:**
- Modified `tugcode/crates/tugtool/src/main.rs`: new `send_dev_mode()` and `wait_for_dev_mode_result()` functions, updated `supervisor_loop()` and `main()` flow

**Tasks:**
- [ ] Add `send_dev_mode(write_half: &mut tokio::net::unix::OwnedWriteHalf, source_tree: &Path)` async function that writes `{"type":"dev_mode","enabled":true,"source_tree":"<path>"}` followed by newline to the passed `write_half`
- [ ] Add `wait_for_dev_mode_result(reader: &mut BufReader<...>)` async function that reads lines from the control socket until it receives a `dev_mode_result` message. Timeout after 5 seconds. Return `Ok(true)` on success, `Ok(false)` on failure (with logged error), `Err` on timeout.
- [ ] In `main()`, always detect source tree: use `--source-tree` if provided (fatal if invalid), else call `detect_source_tree()` (non-fatal if fails, log warning and set `source_tree = None`)
- [ ] Pass the detected source tree into `supervisor_loop()` (add `source_tree: Option<PathBuf>` parameter)
- [ ] In `supervisor_loop()`, after every successful `wait_for_ready()`, if `source_tree.is_some()`, call `send_dev_mode()` then `wait_for_dev_mode_result()`. This is NOT gated on `first_spawn` -- dev mode must be re-established after every restart.
- [ ] Migrate bun spawning from `main()` into `supervisor_loop()`: after `dev_mode` is confirmed, call `spawn_bun_dev()` with the source tree path (if bun is available). Gate on `first_spawn` only -- bun persists across tugcast restarts.
- [ ] Move the tmux availability check from the old `if cli.dev` block to an appropriate location (or remove it if no longer needed since tugcast handles tmux)
- [ ] Open the browser only on `first_spawn` (already the case, just verify)

> **Note:** Between Step 0 and Step 1, dev mode is non-functional from the CLI: the `--dev` flag is removed but the `dev_mode` control message is not yet sent. This is acceptable because `--dev` was already broken (tugcast rejects it), so there is no regression. Step 1 restores dev mode functionality via the correct protocol.

**Tests:**
- [ ] Integration test: verify `send_dev_mode()` writes valid JSON with correct fields
- [ ] Unit test: verify `detect_source_tree()` still works correctly

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugtool` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes all tests
- [ ] Manual: `just dev` launches tugtool, tugcast starts, dev mode is activated via control socket (visible in tugcast logs), bun dev starts, CSS hot reload works
- [ ] Manual: trigger a restart (e.g., via Developer menu "Restart Server"), verify dev mode is re-established after restart (visible in tugcast logs showing dev mode enabled again)

**Rollback:**
- Revert the commit; `send_dev_mode()`, `wait_for_dev_mode_result()`, and bun spawning migration are removed

**Commit after all checkpoints pass.**

---

#### Step 2: Add spawn_binary_watcher() in tugcast dev.rs {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add binary mtime watcher in tugcast dev.rs for self-restart on rebuild`

**References:** [D03] Binary watcher as separate function, [D04] Shutdown via exit code 44, [D05] Polling-based binary watcher, (#d03-separate-binary-watcher, #d04-binary-updated-reason, #d05-polling-watcher, #symbols)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs`: new `spawn_binary_watcher()` function, updated `DevRuntime` struct, updated `enable_dev_mode()` and `disable_dev_mode()`
- Modified `tugcode/crates/tugcast/src/main.rs`: add `44 => "binary_updated"` exit code mapping

**Tasks:**
- [ ] Add `_binary_watcher: Option<tokio::task::JoinHandle<()>>` field to `DevRuntime` struct
- [ ] Update the `DevRuntime` construction site in `enable_dev_mode()` (currently `DevRuntime { _watcher: watcher }`) to include the new `_binary_watcher` field
- [ ] Implement `spawn_binary_watcher(binary_path: PathBuf, shutdown_tx: mpsc::Sender<u8>) -> tokio::task::JoinHandle<()>`:
  - `binary_path` is an injectable parameter -- NOT `current_exe()`. The caller derives it from `DevState.source_tree` as `<source_tree>/tugcode/target/debug/tugcast`
  - If the binary file doesn't exist at start, log `info!("binary watcher: waiting for binary to appear at <path>")` and poll every 2 seconds until it appears. This is the common case when dev mode is enabled before the first `cargo build`.
  - Once the file exists, record initial mtime via `std::fs::metadata().modified()`
  - Poll every 2 seconds using `tokio::time::interval`
  - When mtime changes, sleep 500ms for stabilization, re-check mtime
  - If mtime is still different from the value recorded before stabilization started, send exit code `44` via `shutdown_tx.send(44).await`
  - After sending, update the recorded mtime and continue the loop (the process will shut down, but the watcher doesn't need to know that)
  - Do NOT send anything via `response_tx` -- the shutdown message is constructed by `main()` which maps `44 => "binary_updated"` (see [D04])
  - Log: `info!("binary watcher: tugcast binary changed, initiating restart")`
- [ ] Update `enable_dev_mode()` signature to accept `shutdown_tx: mpsc::Sender<u8>` parameter
- [ ] In `enable_dev_mode()`, derive the binary path as `state.source_tree.join("tugcode/target/debug/tugcast")`
- [ ] Call `spawn_binary_watcher(binary_path, shutdown_tx)` from `enable_dev_mode()` and store the handle in `DevRuntime._binary_watcher`
- [ ] Update `disable_dev_mode()` to explicitly call `.abort()` on the binary watcher `JoinHandle` if present -- `drop()` alone does NOT abort a spawned tokio task; `.abort()` is required
- [ ] Update the `enable_dev_mode()` call site in `control.rs` `run_recv_loop()` to pass `shutdown_tx.clone()`
- [ ] Update all 6 test call sites in `tugcast/src/dev.rs` that call `enable_dev_mode()` to pass the new `shutdown_tx` parameter. Affected tests: `test_enable_dev_mode_valid`, `test_enable_dev_mode_invalid_path`, `test_disable_dev_mode_clears_state`, `test_enable_disable_enable_different_path` (2 calls), `test_debounce_gating_after_disable`. Each test must create a `mpsc::channel::<u8>(1)` and pass the sender.
- [ ] In `tugcast/src/main.rs`, add `44 => "binary_updated"` to the exit code match block alongside `42 => "restart"` and `43 => "reset"`

**Tests:**
- [ ] Unit test: `test_binary_watcher_detects_mtime_change` -- create a temp file, call `spawn_binary_watcher()` with that temp file path and a `shutdown_rx`, modify the file, verify exit code 44 is received on `shutdown_rx`
- [ ] Unit test: `test_binary_watcher_stabilization` -- verify watcher waits 500ms after mtime change before sending exit code
- [ ] Unit test: `test_binary_watcher_no_change` -- verify watcher does not send when mtime is unchanged (run for a few seconds, verify `shutdown_rx` is empty)
- [ ] Unit test: `test_binary_watcher_missing_then_appears` -- start watcher on non-existent path, verify no send while missing, then create the file, modify it, verify exit code 44 fires
- [ ] Verify all 6 existing `enable_dev_mode()` tests compile and pass with updated signatures

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes all tests (including the 6 updated test call sites and 4 new binary watcher tests)
- [ ] Manual: run tugcast with dev mode enabled, run `cargo build -p tugcast`, verify tugcast logs "binary watcher: tugcast binary changed" and sends `binary_updated` shutdown

**Rollback:**
- Revert the commit; remove `spawn_binary_watcher()`, `DevRuntime` field, and exit code 44 mapping

**Commit after all checkpoints pass.**

---

#### Step 3: Handle binary_updated in ProcessManager.swift {#step-3}

**Depends on:** #step-2

**Commit:** `feat: ProcessManager handles binary_updated shutdown by copying new binary into app bundle`

**References:** [D04] Shutdown reason binary_updated, [D06] ProcessManager copies binary, (#d04-binary-updated-reason, #d06-processmanager-copy, #symbols)

**Artifacts:**
- Modified `tugapp/Sources/ProcessManager.swift`: new `binary_updated` case in shutdown handler, new `copyBinaryFromSourceTree()` method

**Tasks:**
- [ ] Add `"binary_updated"` case to the shutdown reason switch in `handleControlMessage()`, alongside `"restart"` and `"reset"`
- [ ] Before setting `restartDecision = .restart`, call `copyBinaryFromSourceTree()`
- [ ] Add a bun duplication guard in `startProcess()`: before spawning `bun build --watch`, check `if bunProcess?.isRunning == true` and skip if already running. This prevents spawning duplicate bun watchers on `binary_updated` restarts (pre-existing bug that becomes much more frequent with auto-restarts)
- [ ] Implement `copyBinaryFromSourceTree()`:
  - Read source tree path from `UserDefaults.standard.string(forKey: TugConfig.keySourceTreePath)`
  - Source: `<sourceTree>/tugcode/target/debug/tugcast`
  - Destination: `Bundle.main.executableURL?.deletingLastPathComponent().appendingPathComponent("tugcast")`
  - Use `FileManager.default.removeItem` + `FileManager.default.copyItem` (replace pattern)
  - On failure, log error and continue (restart with existing binary)
- [ ] Set `restartDecision = .restart` after successful or failed copy (always restart)

**Tests:**
- [ ] Manual: build Mac app with `just app`, then run `cargo build -p tugcast` in the source tree, verify ProcessManager copies new binary and restarts tugcast
- [ ] Verify the app logs show "copying new tugcast binary" and successful restart

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds
- [ ] Manual: edit a `.rs` file, `cargo build`, verify Mac app detects change, copies binary, and restarts tugcast
- [ ] Manual: verify dev mode is re-established after restart (tugcast logs show dev mode enabled)

**Rollback:**
- Revert the commit; remove `binary_updated` case and `copyBinaryFromSourceTree()`

**Commit after all checkpoints pass.**

---

#### Step 4: Handle binary_updated in tugtool supervisor loop {#step-4}

**Depends on:** #step-2

**Commit:** `feat: tugtool supervisor handles binary_updated shutdown as immediate restart`

**References:** [D04] Shutdown reason binary_updated, [D08] dev_mode re-sent after every restart, (#d04-binary-updated-reason, #d08-dev-mode-every-restart, #context)

**Artifacts:**
- Modified `tugcode/crates/tugtool/src/main.rs`: updated shutdown reason match in supervisor loop

**Tasks:**
- [ ] In the supervisor select loop's shutdown message handler, add `"binary_updated"` to the match arm alongside `"restart"` and `"reset"` that sets `decision = RestartDecision::Restart`
- [ ] Change the match arm from `"restart" | "reset"` to `"restart" | "reset" | "binary_updated"`
- [ ] Update the log message to include the reason: already does `info!("tugcast shutdown: reason={}, restarting", reason)`
- [ ] Verify that after restart, the supervisor re-sends `dev_mode` (per Step 1's changes), which re-creates the binary watcher

**Tests:**
- [ ] Unit test: verify that `binary_updated` reason triggers `RestartDecision::Restart` (if a suitable test harness exists, or verify manually)

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugtool` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes all tests
- [ ] Manual: with `just dev` running, `cargo build -p tugcast`, verify tugtool restarts tugcast immediately and dev mode is re-established

**Rollback:**
- Revert the commit; remove `binary_updated` from the match arm

**Commit after all checkpoints pass.**

---

#### Step 5: Update Justfile with dev and dev-watch recipes {#step-5}

**Depends on:** #step-1, #step-4

**Commit:** `feat: simplify just dev, add just dev-watch with cargo-watch for hands-free Rust workflow`

**References:** [D07] cargo-watch integration, (#d07-cargo-watch, #strategy)

**Artifacts:**
- Modified `Justfile`: updated `dev` recipe, new `dev-watch` recipe

**Tasks:**
- [ ] Update `just dev` recipe to simply run tugtool (no `--dev` flag). Tugtool auto-detects source tree and activates dev mode via control socket:
  ```
  dev: build
      tugcode/target/debug/tugtool
  ```
- [ ] Add `just dev-watch` recipe that runs `cargo watch` alongside tugtool for fully hands-free Rust workflow:
  ```
  dev-watch: build
      #!/usr/bin/env bash
      set -euo pipefail
      if ! command -v cargo-watch &>/dev/null; then
          echo "cargo-watch not found. Install with: cargo install cargo-watch"
          exit 1
      fi
      (cd tugcode && cargo watch -w crates -s "cargo build -p tugcast") &
      CARGO_WATCH_PID=$!
      trap "kill $CARGO_WATCH_PID 2>/dev/null" EXIT
      tugcode/target/debug/tugtool
  ```
- [ ] Only rebuild `tugcast` in the `cargo watch` command (not `tugtool`) -- only tugcast needs hot restart

**Tests:**
- [ ] Manual: `just dev` launches tugtool, CSS + TypeScript hot reload works, no cargo-watch involved
- [ ] Manual: `just dev-watch` launches tugtool + cargo-watch, editing a `.rs` file triggers rebuild, tugcast detects binary change and restarts

**Checkpoint:**
- [ ] `just dev` runs without errors
- [ ] `just dev-watch` runs without errors (with cargo-watch installed)
- [ ] CSS hot reload works in both recipes
- [ ] TypeScript hot reload works in both recipes (bun build --watch runs)
- [ ] Rust hot reload works in `just dev-watch` (cargo-watch rebuilds, binary watcher restarts tugcast)
- [ ] Rust hot reload works in `just dev` when developer manually runs `cargo build -p tugcast`

**Rollback:**
- Revert the Justfile changes

**Commit after all checkpoints pass.**

---

### 1.0.3 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Full hot reload for CSS, TypeScript, and Rust source files across both the Mac app and CLI development workflows.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `just dev` launches tugtool, activates dev mode via control socket, spawns bun dev, CSS + TypeScript hot reload works
- [ ] `just dev-watch` adds cargo-watch for hands-free Rust workflow
- [ ] Editing a `.css` file triggers instant reload (< 1s)
- [ ] Editing a `.ts` file triggers reload after bun rebuild (~1-2s)
- [ ] Running `cargo build` (or having cargo-watch run it) triggers tugcast self-restart (~3-5s)
- [ ] Mac app path: ProcessManager copies new tugcast binary into bundle on `binary_updated` shutdown
- [ ] CLI path: tugtool restarts tugcast immediately on `binary_updated` shutdown
- [ ] Dev mode is re-established after every restart (not lost on first restart)
- [ ] All existing tests pass: `cd tugcode && cargo nextest run --workspace`
- [ ] No compiler warnings: `cd tugcode && cargo build --workspace` succeeds under `-D warnings`
- [ ] `tugcode/target/debug/tugtool --dev` is rejected (unknown flag)

**Acceptance tests:**
- [ ] Unit test: `test_dev_flag_rejected` in tugtool confirms `--dev` is gone
- [ ] Unit test: `test_binary_watcher_detects_mtime_change` confirms watcher works with injectable path
- [ ] Unit test: `test_binary_watcher_missing_then_appears` confirms watcher polls until file appears
- [ ] Integration test: end-to-end `just dev` with CSS, TypeScript, and Rust changes
- [ ] Integration test: verify dev mode survives a restart cycle

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] HMR (Hot Module Replacement) for CSS injection without full page reload
- [ ] Partial JS replacement for preserving frontend state across reloads
- [ ] Multi-binary watching (if tugtalk or other binaries need live reload in the future)
- [ ] Automatic `cargo-watch` installation detection and guidance

| Checkpoint | Verification |
|------------|--------------|
| CLI dev path works | `just dev` + edit CSS file + verify reload |
| Binary watcher works | `cargo build -p tugcast` + verify restart |
| Mac app binary copy works | `just app` + `cargo build` + verify copy + restart |
| Dev mode survives restart | trigger restart + verify dev mode re-enabled |
| cargo-watch integration | `just dev-watch` + edit `.rs` file + verify rebuild + restart |

**Commit after all checkpoints pass.**
