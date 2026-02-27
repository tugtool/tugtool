<!-- tugplan-skeleton v2 -->

## Dev Mode Port Hardening {#dev-mode-port-hardening}

**Purpose:** Eliminate hardcoded port numbers (5173 for Vite, 55255 for tugcast) scattered across Rust, Swift, and Justfile code by introducing single-source-of-truth constants and runtime port propagation via the existing UDS IPC protocol.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-02-27 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Vite dev server port (5173) is hardcoded as a magic number in 11 places across 6 files in 3 languages (Rust, Swift, Justfile). If Vite's default port ever changes, or if a developer needs to run on a different port, every one of these sites must be found and updated in lockstep -- miss one and you get a silent failure (white window, rejected WebSocket, broken proxy).

The tugcast port (55255) is better structured -- it is discovered at bind time and communicated via the UDS ready message -- but the Swift app hardcodes it in the control socket path, which would break under port rolling. The fix is to make the Vite port work like the tugcast port: a runtime value communicated via IPC, with a single constant as the default.

#### Strategy {#strategy}

- Define `DEFAULT_VITE_DEV_PORT` constants as single sources of truth: one in Rust (`tugcast-core`), one in Swift (`TugConfig.swift`).
- Add a `vite_port` field to the `DevMode` control message so tugcast learns the actual Vite port from its parent process, with `#[serde(default)]` for backward compatibility.
- Parameterize all functions that currently hardcode 5173 to accept a port argument instead.
- Fix the Swift `controlSocketPath` to derive from the actual tugcast port stored at runtime rather than hardcoding 55255.
- Pass `--port` flag to Vite explicitly so the port assignment is deterministic, not a default assumption.
- Use a Justfile variable for the port in the stale process cleanup command.
- Execute changes in dependency order: constants first, then message protocol, then consumers.

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build` succeeds with zero warnings (`-D warnings` enforced) (run `cd tugcode && cargo build`)
- `cargo nextest run` passes all tests (run `cd tugcode && cargo nextest run`)
- `xcodebuild` builds Tug.app successfully (run `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build`)
- `just app` with dev mode enabled: page loads, HMR works, no white window (manual verification)
- Grep for bare `5173` in Rust and Swift source files (excluding comments, tests, and roadmap) returns zero hits
- Grep for bare `55255` in `ProcessManager.swift` socket path returns zero hits

#### Scope {#scope}

1. Add `DEFAULT_VITE_DEV_PORT` constant to `tugcast-core/src/lib.rs`
2. Add `defaultVitePort` constant to `tugapp/Sources/TugConfig.swift`
3. Add `vite_port` field to the `DevMode` control message variant in `tugcast/src/control.rs`
4. Parameterize Rust functions: `wait_for_vite`, `rewrite_auth_url_to_vite_port`, `spawn_vite_dev` in `tugtool/src/main.rs`
5. Parameterize Swift functions: `waitForViteReady`, `spawnViteDevServer`, `sendDevMode` in `ProcessManager.swift`
6. Update Swift `AppDelegate.swift` to store and pass runtime Vite port
7. Fix Swift `controlSocketPath` to use runtime tugcast port
8. Update Justfile to use `VITE_DEV_PORT` variable
9. Update doc comment in `tugcast/src/auth.rs`
10. Update doc comment in `tugcast/src/server.rs`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the tugcast port flow (already correct via runtime discovery)
- Modifying `vite.config.ts` or its `TUGCAST_PORT` environment variable handling
- Removing the `--strictPort` flag from Vite invocations
- Changing test expected values to reference constants (they serve as documentation of exact output)

#### Dependencies / Prerequisites {#dependencies}

- Existing UDS control socket protocol between tugtool/Swift app and tugcast
- `tugcast-core` crate is a dependency of `tugcast` but NOT of `tugtool`; a new dependency line must be added to `tugtool/Cargo.toml` so it can reference `DEFAULT_VITE_DEV_PORT`

#### Constraints {#constraints}

- `cargo build` enforces `-D warnings` via `.cargo/config.toml` -- all warnings are fatal
- The `vite_port` field must be backward compatible: old senders that omit the field must not break new receivers
- The `--port` flag must appear before `--strictPort` in Vite argument lists

#### Assumptions {#assumptions}

- `DEFAULT_VITE_DEV_PORT` constant in `tugcast-core` will be `pub` so both `tugcast` and `tugtool` crates can reference it; `tugtool` requires a new `tugcast-core` dependency in its `Cargo.toml`
- The `vite_port` field in the `DevMode` control message uses `#[serde(default)]` so older senders without the field continue to work
- The `--port` flag is placed before `--strictPort` in the Vite argument list
- The Justfile `VITE_DEV_PORT` variable is defined at the top level and referenced with `{{VITE_DEV_PORT}}` in the `app` recipe's lsof command
- Test expected values remain as string literals -- they are documentation of exact output and do not need to reference constants (per user answer)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Backward compat break in control message | med | low | `#[serde(default)]` on `vite_port` field | Older tugtool or Swift app fails to communicate with newer tugcast |
| Swift socket path regression | high | low | Store `tugcastPort` as a property set from the ready message | `controlSocketPath` computed before ready message arrives |

**Risk R01: Backward Compatibility of DevMode Message** {#r01-backward-compat}

- **Risk:** An older version of tugtool or the Swift app sends a `dev_mode` message without the `vite_port` field, causing deserialization failure in a newer tugcast.
- **Mitigation:**
  - Use `#[serde(default)]` on the `vite_port` field so it deserializes as `None` when absent.
  - When `vite_port` is `None`, tugcast falls back to `DEFAULT_VITE_DEV_PORT`.
- **Residual risk:** The fallback port may differ from the actual Vite port if someone changes the default, but this is the same risk as the current hardcoded approach.

**Risk R02: Swift Socket Path Before Ready** {#r02-socket-path-before-ready}

- **Risk:** The `controlSocketPath` computed property is used in `start()` to create the listener before the ready message arrives with the actual port, but we are changing it to use a stored `tugcastPort` property.
- **Mitigation:**
  - Initialize the stored property `tugcastPort` to 55255 (the CLI default) so the socket path is correct before the ready message arrives.
  - Update the property when the ready message provides the actual port.
- **Residual risk:** If the tugcast CLI default port changes, the initial socket path would be wrong until the ready message arrives. This is a narrow window and would only matter if port rolling occurred before the control socket connection.

---

### Design Decisions {#design-decisions}

#### [D01] Single constant per language for Vite dev port (DECIDED) {#d01-single-constant}

**Decision:** Define `DEFAULT_VITE_DEV_PORT` as a `pub const u16 = 5173` in `tugcast-core/src/lib.rs` and `static let defaultVitePort: Int = 5173` in `TugConfig.swift`. All hardcoded 5173 literals in Rust and Swift are replaced with references to these constants.

**Rationale:**
- Eliminates 11 scattered magic numbers across 6 files
- `tugcast-core` is already a dependency of `tugcast`; adding it as a dependency of `tugtool` is lightweight (it contains only types and constants, no runtime cost) and avoids duplicating the constant

**Implications:**
- `tugtool/Cargo.toml` gains a new `tugcast-core` path dependency
- Both `tugcast` and `tugtool` crates import the constant from `tugcast-core`
- Swift code references `TugConfig.defaultVitePort`
- Changing the default port requires editing exactly two files (one Rust, one Swift)

#### [D02] Runtime port via DevMode control message (DECIDED) {#d02-runtime-port-via-ipc}

**Decision:** Add an `Option<u16>` field `vite_port` to the `DevMode` variant of `ControlMessage` with `#[serde(default)]`. The parent process (tugtool or Swift app) sends the actual Vite port in every `dev_mode` enable message. Tugcast uses this value for `set_dev_port()` instead of a hardcoded constant.

**Rationale:**
- Follows the existing pattern established by the tugcast port (runtime discovery via IPC)
- `#[serde(default)]` ensures backward compatibility with older senders

**Implications:**
- `send_dev_mode` in `main.rs` gains a `vite_port` parameter
- `sendDevMode` in `ProcessManager.swift` gains a `vitePort` parameter
- All callers of `sendDevMode` must pass the port

#### [D03] Parameterize all port-consuming functions (DECIDED) {#d03-parameterize-functions}

**Decision:** Functions `wait_for_vite`, `rewrite_auth_url_to_vite_port`, `spawn_vite_dev` (Rust) and `waitForViteReady`, `spawnViteDevServer` (Swift) each gain a port parameter. Callers pass the port from the constant or a runtime value.

**Rationale:**
- Makes functions testable with arbitrary ports
- Eliminates hidden coupling to a specific port number
- The `rewrite_auth_url_to_vite_port` function already takes `tugcast_port` as a parameter -- this extends the same pattern to the Vite port

**Implications:**
- Function signatures change; all call sites must be updated
- Existing tests for `rewrite_auth_url_to_vite_port` continue to work since they already use string literals as expected values (per user answer: test literals remain as documentation)

#### [D04] Swift tugcastPort stored property for socket path (DECIDED) {#d04-swift-tugcast-port-property}

**Decision:** Add `private var tugcastPort: Int = 55255` to `ProcessManager`. Set it when the ready message arrives. Use it in `controlSocketPath` via string interpolation: `"tugcast-ctl-\(tugcastPort).sock"`.

**Rationale:**
- The socket path must use the actual port, not a hardcoded value, to match the Rust side (`format!("tugcast-ctl-{}.sock", port)`)
- Initializing to 55255 (the CLI default) ensures correctness before the ready message arrives

**Implications:**
- `controlSocketPath` becomes dynamic instead of a computed constant
- The `handleControlMessage` method updates `tugcastPort` when processing a `ready` message

#### [D05] AppDelegate stores runtime Vite port (DECIDED) {#d05-appdelegate-stores-vite-port}

**Decision:** Store the Vite port as a property in `AppDelegate` when first assigned (alongside `lastTugcastPort`), and pass it in all subsequent `sendDevMode` calls.

**Rationale:**
- The Vite port is needed for URL rewriting in `onDevModeResult` and for `sendDevMode` calls from `bridgeSetDevMode` and `bridgeChooseSourceTree`
- Storing it alongside `lastTugcastPort` keeps the pattern consistent

**Implications:**
- `AppDelegate` gains a `private var vitePort: Int` property initialized to `TugConfig.defaultVitePort`
- The `onDevModeResult` callback uses this property instead of the literal `:5173`
- All `sendDevMode` calls pass the stored port

#### [D06] Explicit --port flag to Vite (DECIDED) {#d06-explicit-vite-port-flag}

**Decision:** Both `spawn_vite_dev` (Rust) and `spawnViteDevServer` (Swift) pass `--port {N}` to the Vite command line, before `--strictPort`.

**Rationale:**
- Makes the port assignment explicit rather than relying on Vite's internal default
- Combined with `--strictPort`, ensures Vite either binds the exact requested port or fails fast

**Implications:**
- Vite argument lists change from `["--host", "127.0.0.1", "--strictPort"]` to `["--host", "127.0.0.1", "--port", "{N}", "--strictPort"]`

#### [D07] Justfile variable for stale process cleanup (DECIDED) {#d07-justfile-variable}

**Decision:** Define `VITE_DEV_PORT := "5173"` at the top of the Justfile and reference it with `{{VITE_DEV_PORT}}` in the `app` recipe's `lsof` command.

**Rationale:**
- Centralizes the port value for the Justfile
- Makes it easy to override: `just VITE_DEV_PORT=3000 app`

**Implications:**
- The `lsof -ti :5173` line becomes `lsof -ti :{{VITE_DEV_PORT}}`
- The comment referencing port 5173 is updated to reference the variable

---

### Specification {#specification}

#### Control Message Schema Update {#control-message-schema}

**Spec S01: DevMode Control Message** {#s01-devmode-message}

Current schema:
```json
{"type": "dev_mode", "enabled": true, "source_tree": "/path/to/src"}
```

New schema:
```json
{"type": "dev_mode", "enabled": true, "source_tree": "/path/to/src", "vite_port": 5173}
```

The `vite_port` field is optional. When absent, tugcast falls back to `DEFAULT_VITE_DEV_PORT` (5173).

Rust enum representation:
```rust
DevMode {
    enabled: bool,
    #[serde(default)]
    source_tree: Option<String>,
    #[serde(default)]
    vite_port: Option<u16>,
},
```

#### Function Signature Changes {#function-signatures}

**Spec S02: Rust Function Signatures** {#s02-rust-signatures}

| Function | Current Signature | New Signature |
|----------|------------------|---------------|
| `spawn_vite_dev` | `(source_tree: &Path, tugcast_port: u16)` | `(source_tree: &Path, tugcast_port: u16, vite_port: u16)` |
| `wait_for_vite` | `(timeout_secs: u64)` | `(port: u16, timeout_secs: u64)` |
| `rewrite_auth_url_to_vite_port` | `(auth_url: &str, tugcast_port: u16)` | `(auth_url: &str, tugcast_port: u16, vite_port: u16)` |
| `send_dev_mode` | `(write_half, source_tree: &Path)` | `(write_half, source_tree: &Path, vite_port: u16)` |

**Spec S03: Swift Function Signatures** {#s03-swift-signatures}

| Function | Current Signature | New Signature |
|----------|------------------|---------------|
| `spawnViteDevServer` | `(sourceTree: String, tugcastPort: Int)` | `(sourceTree: String, tugcastPort: Int, vitePort: Int)` |
| `waitForViteReady` | `(timeout:, completion:)` | `(port: Int, timeout:, completion:)` |
| `sendDevMode` | `(enabled: Bool, sourceTree: String?)` | `(enabled: Bool, sourceTree: String?, vitePort: Int? = nil)` |

#### Constants {#constants}

**Spec S04: Port Constants** {#s04-port-constants}

| Language | Symbol | Value | Location |
|----------|--------|-------|----------|
| Rust | `DEFAULT_VITE_DEV_PORT` | `5173` | `tugcode/crates/tugcast-core/src/lib.rs` |
| Swift | `TugConfig.defaultVitePort` | `5173` | `tugapp/Sources/TugConfig.swift` |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

None.

#### New files (if any) {#new-files}

None.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DEFAULT_VITE_DEV_PORT` | const | `tugcast-core/src/lib.rs` | `pub const DEFAULT_VITE_DEV_PORT: u16 = 5173;` |
| `ControlMessage::DevMode::vite_port` | field | `tugcast/src/control.rs` | `#[serde(default)] vite_port: Option<u16>` |
| `TugConfig.defaultVitePort` | static let | `tugapp/Sources/TugConfig.swift` | `static let defaultVitePort: Int = 5173` |
| `ProcessManager.tugcastPort` | property | `tugapp/Sources/ProcessManager.swift` | `private var tugcastPort: Int = 55255` |
| `AppDelegate.vitePort` | property | `tugapp/Sources/AppDelegate.swift` | `private var vitePort: Int` initialized to `TugConfig.defaultVitePort` |

---

### Documentation Plan {#documentation-plan}

- [ ] Update doc comment on `auth.rs::set_dev_port` to remove hardcoded `5173` reference
- [ ] Update doc comment on `server.rs::build_app` to replace "port 5173" with generic wording
- [ ] Update doc comments on `spawn_vite_dev`, `wait_for_vite`, `rewrite_auth_url_to_vite_port` to reflect parameterized signatures
- [ ] Update doc comments on `spawnViteDevServer`, `waitForViteReady` in Swift to reflect parameterized signatures
- [ ] Update Justfile comment about stale Vite process cleanup

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify control message deserialization with and without `vite_port` field | `control.rs` tests |
| **Unit** | Verify `rewrite_auth_url_to_vite_port` accepts and uses a `vite_port` parameter | `main.rs` tests |
| **Unit** | Verify `send_dev_mode` includes `vite_port` in the JSON payload | `main.rs` tests |
| **Integration** | Build succeeds with zero warnings | `cargo build` |
| **Integration** | All existing tests pass | `cargo nextest run` |
| **Drift Prevention** | Grep for bare `5173` in source files (excluding comments, tests, roadmap) | Post-implementation verification |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Define Rust Constant and Update Control Message {#step-1}

**Commit:** `feat: add DEFAULT_VITE_DEV_PORT constant and vite_port field to DevMode message`

**References:** [D01] Single constant per language, [D02] Runtime port via IPC, Spec S01, Spec S04, (#control-message-schema, #constants, #r01-backward-compat)

**Artifacts:**
- `tugcode/crates/tugcast-core/src/lib.rs` -- new `DEFAULT_VITE_DEV_PORT` constant
- `tugcode/crates/tugcast/src/control.rs` -- `vite_port` field on `DevMode` variant; handler uses runtime value for `set_dev_port`; updated existing tests
- `tugcode/crates/tugcast/src/auth.rs` -- updated doc comment on `set_dev_port`
- `tugcode/crates/tugcast/src/server.rs` -- updated doc comment on `build_app`

**Tasks:**
- [ ] Add `pub const DEFAULT_VITE_DEV_PORT: u16 = 5173;` to `tugcast-core/src/lib.rs` with doc comment
- [ ] Add `#[serde(default)] vite_port: Option<u16>` field to `ControlMessage::DevMode` in `control.rs`
- [ ] Update the `DevMode` match arm in `run_recv_loop` to destructure `vite_port` and use it: `auth.lock().unwrap().set_dev_port(Some(vite_port.unwrap_or(tugcast_core::DEFAULT_VITE_DEV_PORT)))`
- [ ] Update the doc comment on `set_dev_port` in `auth.rs` to say "Pass the Vite dev server port" instead of "Pass `Some(5173)`"
- [ ] Update doc comment on `build_app` in `server.rs` to replace "port 5173" with "the Vite dev server port" (line 164)
- [ ] Update existing tests `test_control_message_dev_mode_enable_deserialization` and `test_control_message_dev_mode_disable_deserialization` to add `vite_port` to their match patterns (either destructure it explicitly or use `..` to ignore remaining fields), since adding the new field makes the current exhaustive patterns non-exhaustive
- [ ] Add test for `DevMode` deserialization with `vite_port` present
- [ ] Add test for `DevMode` deserialization with `vite_port` absent (backward compat)

**Tests:**
- [ ] `test_control_message_dev_mode_with_vite_port` -- deserialize JSON with `vite_port: 3000`, verify field value
- [ ] `test_control_message_dev_mode_without_vite_port` -- deserialize JSON without `vite_port`, verify `vite_port` is `None`
- [ ] Existing `test_control_message_dev_mode_enable_deserialization` and `test_control_message_dev_mode_disable_deserialization` updated and passing

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast-core -p tugcast` -- zero warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` -- all tests pass

---

#### Step 2: Parameterize Rust Functions in tugtool {#step-2}

**Depends on:** #step-1

**Commit:** `feat: parameterize Vite port in tugtool functions`

**References:** [D01] Single constant per language, [D03] Parameterize all port-consuming functions, [D06] Explicit --port flag to Vite, Spec S02, (#function-signatures, #s02-rust-signatures)

**Artifacts:**
- `tugcode/crates/tugtool/Cargo.toml` -- new `tugcast-core` path dependency
- `tugcode/crates/tugtool/src/main.rs` -- parameterized `spawn_vite_dev`, `wait_for_vite`, `rewrite_auth_url_to_vite_port`, `send_dev_mode`; updated `supervisor_loop` to pass port values

**Tasks:**
- [ ] Add `tugcast-core = { path = "../tugcast-core" }` to `[dependencies]` in `tugcode/crates/tugtool/Cargo.toml`
- [ ] Add `vite_port: u16` parameter to `spawn_vite_dev` and pass `--port` and the port value as Vite arguments before `--strictPort`
- [ ] Change `wait_for_vite` signature to `(port: u16, timeout_secs: u64)` and use `format!("127.0.0.1:{}", port)` for `TcpStream::connect`
- [ ] Add `vite_port: u16` parameter to `rewrite_auth_url_to_vite_port` and replace the hardcoded `":5173"` with `format!(":{}", vite_port)`
- [ ] Add `vite_port: u16` parameter to `send_dev_mode` and include `"vite_port":{vite_port}` in the JSON message
- [ ] In `supervisor_loop`, define `let vite_port = tugcast_core::DEFAULT_VITE_DEV_PORT;` and pass it to all parameterized functions
- [ ] Update the `send_dev_mode` call in the dev mode activation block to pass `vite_port`
- [ ] Update the `rewrite_auth_url_to_vite_port` call to pass `vite_port`
- [ ] Update the `spawn_vite_dev` call to pass `vite_port`
- [ ] Update the `wait_for_vite` call to pass `vite_port`
- [ ] Update the log message `"waiting for port 5173..."` to use the variable: `format!("vite dev server started, waiting for port {}...", vite_port)`
- [ ] Update doc comments on all changed functions

**Tests:**
- [ ] Update `test_rewrite_auth_url_to_vite_port` to pass the `vite_port` parameter (e.g., `rewrite_auth_url_to_vite_port(url, 55255, 5173)`) -- expected values remain as string literals
- [ ] Add test: `rewrite_auth_url_to_vite_port` with non-default Vite port (e.g., 3000) produces the correct URL
- [ ] Update `test_send_dev_mode_writes_valid_json` to pass a `vite_port` parameter and verify the JSON includes the `vite_port` field

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugtool` -- zero warnings
- [ ] `cd tugcode && cargo nextest run -p tugtool` -- all tests pass

---

#### Step 3: Update Swift Code {#step-3}

**Depends on:** #step-1

**Commit:** `feat: update Swift code with port constants and parameterized functions`

**References:** [D01] Single constant per language, [D03] Parameterize all port-consuming functions, [D04] Swift tugcastPort stored property, [D05] AppDelegate stores runtime Vite port, [D06] Explicit --port flag to Vite, Spec S03, Spec S04, (#s03-swift-signatures, #constants)

> This step is large and spans three Swift files. Breaking into substeps: TugConfig constant and ProcessManager changes, then AppDelegate changes.

**Tasks:**
- [ ] See substeps 3.1 and 3.2 below

**Tests:**
- [ ] Swift build succeeds (Xcode has no separate test runner for these changes; correctness verified via build)

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` -- BUILD SUCCEEDED

##### Step 3.1: Add Swift Constant and Fix ProcessManager {#step-3-1}

**Commit:** `feat: add defaultVitePort constant and parameterize ProcessManager`

**References:** [D01] Single constant per language, [D03] Parameterize all port-consuming functions, [D04] Swift tugcastPort stored property, [D06] Explicit --port flag to Vite, Spec S03, Spec S04, (#s03-swift-signatures, #constants, #r02-socket-path-before-ready)

**Artifacts:**
- `tugapp/Sources/TugConfig.swift` -- new `defaultVitePort` constant
- `tugapp/Sources/ProcessManager.swift` -- `tugcastPort` stored property; parameterized `spawnViteDevServer`, `waitForViteReady`, `sendDevMode`; fixed `controlSocketPath`

**Tasks:**
- [ ] Add `static let defaultVitePort: Int = 5173` to `TugConfig` enum with doc comment
- [ ] Add `private var tugcastPort: Int = 55255` stored property to `ProcessManager`
- [ ] Change `controlSocketPath` from hardcoded `"tugcast-ctl-55255.sock"` to `NSTemporaryDirectory() + "tugcast-ctl-\(tugcastPort).sock"`
- [ ] In `handleControlMessage` for the `"ready"` case, add `self.tugcastPort = port` before calling `onReady`
- [ ] Add `vitePort: Int` parameter to `spawnViteDevServer` and insert `"--port", String(vitePort)` before `"--strictPort"` in the arguments array
- [ ] Add `port: Int` parameter to `waitForViteReady` and use `UInt16(port).bigEndian` instead of `UInt16(5173).bigEndian`
- [ ] Add `vitePort: Int? = nil` parameter to `sendDevMode` and include `"vite_port"` key in the message dictionary when non-nil
- [ ] Update doc comments on `spawnViteDevServer` and `waitForViteReady` to reference the port parameter instead of hardcoded 5173

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` -- BUILD SUCCEEDED

---

##### Step 3.2: Update AppDelegate to Use Runtime Port {#step-3-2}

**Depends on:** #step-3-1

**Commit:** `feat: store and propagate runtime Vite port in AppDelegate`

**References:** [D05] AppDelegate stores runtime Vite port, [D02] Runtime port via IPC, (#d05-appdelegate-stores-vite-port, #d02-runtime-port-via-ipc)

**Artifacts:**
- `tugapp/Sources/AppDelegate.swift` -- new `vitePort` property; updated `onReady`, `onDevModeResult`, `bridgeSetDevMode`, `bridgeChooseSourceTree` to use it

**Tasks:**
- [ ] Add `private var vitePort: Int = TugConfig.defaultVitePort` (alongside `lastTugcastPort`)
- [ ] In `onReady` closure, update the `spawnViteDevServer` call to pass `vitePort: self.vitePort`
- [ ] In `onReady` closure, update the `waitForViteReady` call to pass `port: self.vitePort`
- [ ] In `onReady` closure, update the `sendDevMode` call to pass `vitePort: self.vitePort`
- [ ] In `onDevModeResult` closure, replace the hardcoded `":5173"` rewrite with `":\(self.vitePort)"`: `urlToLoad = url.replacingOccurrences(of: needle, with: ":\(self.vitePort)", ...)`
- [ ] In `bridgeSetDevMode`, pass `vitePort: self.vitePort` to `sendDevMode`
- [ ] In `bridgeChooseSourceTree`, pass `vitePort: self.vitePort` to `sendDevMode`

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` -- BUILD SUCCEEDED

---

#### Step 3 Summary {#step-3-summary}

**Depends on:** #step-3-1

**Commit:** `feat: update Swift code with port constants and parameterized functions`

**References:** [D01] Single constant per language, [D04] Swift tugcastPort stored property, [D05] AppDelegate stores runtime Vite port, (#constants)

After completing Steps 3.1--3.2, you will have:
- A single Swift constant (`TugConfig.defaultVitePort`) for the Vite dev server port
- `ProcessManager` with parameterized functions, a stored `tugcastPort` property, and a dynamic `controlSocketPath`
- `AppDelegate` storing and propagating the runtime Vite port through all dev mode calls and URL rewrites

**Tasks:**
- [ ] Verify all Swift files compile together

**Tests:**
- [ ] Swift build succeeds

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` -- BUILD SUCCEEDED

---

#### Step 4: Update Justfile {#step-4}

**Depends on:** #step-1

**Commit:** `chore: use VITE_DEV_PORT variable in Justfile`

**References:** [D07] Justfile variable, (#d07-justfile-variable)

**Artifacts:**
- `Justfile` -- new `VITE_DEV_PORT` variable; updated `app` recipe

**Tasks:**
- [ ] Add `VITE_DEV_PORT := "5173"` near the top of the Justfile (after the `default` recipe)
- [ ] Replace `lsof -ti :5173` with `lsof -ti :{{VITE_DEV_PORT}}`
- [ ] Update the comment from "Kill any stale Vite dev server on port 5173" to "Kill any stale Vite dev server on the configured port"

**Tests:**
- [ ] `just --evaluate VITE_DEV_PORT` outputs `5173`

**Checkpoint:**
- [ ] `just --evaluate VITE_DEV_PORT` outputs `5173`
- [ ] `just --dry-run app` shows the `lsof` command referencing the correct port

---

#### Step 5: Final Verification {#step-5}

**Depends on:** #step-2, #step-3, #step-4

**Commit:** `chore: verify port hardening across all targets`

**References:** [D01] Single constant per language, [D03] Parameterize all port-consuming functions, (#success-criteria)

**Tasks:**
- [ ] Run full Rust build: `cd tugcode && cargo build` -- zero warnings
- [ ] Run full Rust tests: `cd tugcode && cargo nextest run` -- all pass
- [ ] Run Swift build: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` -- BUILD SUCCEEDED
- [ ] Grep for bare `5173` in Rust source files (excluding tests, comments, and roadmap): zero hits in non-test, non-comment code
- [ ] Grep for bare `5173` in Swift source files (excluding TugConfig.swift constant definition): zero hits
- [ ] Grep for bare `55255` in `ProcessManager.swift` socket path line: zero hits
- [ ] (Manual) Run `just app` with dev mode enabled: page loads, HMR works, no white window

**Tests:**
- [ ] All Rust tests pass: `cd tugcode && cargo nextest run`
- [ ] Grep verification for stale port literals

**Checkpoint:**
- [ ] `cd tugcode && cargo build` -- zero warnings
- [ ] `cd tugcode && cargo nextest run` -- all pass
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` -- BUILD SUCCEEDED

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All hardcoded Vite dev server port (5173) and tugcast socket port (55255) references are replaced with constants and runtime values propagated via IPC, eliminating silent failure modes when ports change.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build` succeeds with zero warnings (run `cd tugcode && cargo build`)
- [ ] `cargo nextest run` passes all tests (run `cd tugcode && cargo nextest run`)
- [ ] `xcodebuild` builds Tug.app successfully
- [ ] No bare `5173` in Rust/Swift source outside of constant definitions and test expected values
- [ ] No bare `55255` in Swift socket path code
- [ ] `just app` with dev mode: page loads, HMR works, no white window (manual)

**Acceptance tests:**
- [ ] `test_control_message_dev_mode_with_vite_port` passes
- [ ] `test_control_message_dev_mode_without_vite_port` passes (backward compat)
- [ ] `test_rewrite_auth_url_to_vite_port` passes with parameterized signature
- [ ] `test_send_dev_mode_writes_valid_json` verifies `vite_port` in payload

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Support runtime Vite port override via CLI flag (`--vite-port`) on tugtool
- [ ] Add a settings UI in the Swift app to configure the Vite dev port
- [ ] Unify the Rust and Swift port constants into a single generated source of truth

| Checkpoint | Verification |
|------------|--------------|
| Rust build | `cd tugcode && cargo build` -- zero warnings |
| Rust tests | `cd tugcode && cargo nextest run` -- all pass |
| Swift build | `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` -- BUILD SUCCEEDED |
| End-to-end | `just app` with dev mode enabled -- page loads, HMR works |
