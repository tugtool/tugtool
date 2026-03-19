## Phase 1.0: Control Socket IPC {#phase-control-socket}

**Purpose:** Replace the fragile stdout-parsing and exit-code IPC between the Mac app (ProcessManager), the tugtool CLI launcher, and tugcast with a bidirectional Unix domain socket control channel, eliminating the restart race condition and enabling structured parent-child communication.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | control-socket |
| Tracking issue/PR | TBD |
| Last updated | 2025-02-21 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Mac app and tugcast currently communicate through two fragile channels. First, tugcast prints the auth URL to stdout before the HTTP server binds its port; ProcessManager reads it via a pipe regex. On restart, the WebView navigates before the server is listening, causing connection-refused errors and a stale-session reconnection loop. Second, exit codes 42/43 signal restart/reset intent, but carry no structured data and arrive only after the process is dead.

The tugtool CLI launcher (`tugcode/crates/tugtool/src/main.rs`) has the same problem. It spawns tugcast with `stdout: Stdio::piped()`, reads lines through a `BufReader`, and uses `AUTH_URL_REGEX` (a static regex matching `tugcast: <url>`) in `extract_auth_url()` to capture the auth URL. Its `supervisor_loop()` also interprets exit codes 42/43 for restart/reset. After tugcast stops printing the auth URL to stdout, the tugtool CLI will hang forever in `extract_auth_url()` waiting for a line that never comes.

Additionally, the Mac app sends commands to tugcast via HTTP POST to `/api/tell`, which requires port discovery from the auth URL, a running HTTP server, and routes through the full TCP/HTTP stack for local IPC. The `devPath` property is stored once at launch and becomes stale if the user toggles dev mode.

#### Strategy {#strategy}

- Parent (Mac app or tugtool CLI) listens on a Unix domain socket before spawning the child (tugcast)
- Child connects to the UDS on startup via a new `--control-socket` CLI flag
- Child sends `ready` message only after `TcpListener::bind` succeeds, structurally eliminating the race condition
- Child sends `shutdown` message with structured reason before exiting, replacing exit code interpretation
- Parent sends `tell` and `shutdown` messages over UDS, replacing HTTP `/api/tell` for local commands
- Protocol is newline-delimited JSON for debuggability
- Remove stdout parsing, exit code 42/43 interpretation, and stale `devPath` property
- Update both consumers of stdout parsing: Mac app (ProcessManager.swift) and tugtool CLI (main.rs)

#### Stakeholders / Primary Customers {#stakeholders}

1. Mac app users who experience the restart race condition (stale session, connection refused)
2. tugtool CLI users who launch tugcast from the command line
3. Developers working on tugcast/tugapp IPC

#### Success Criteria (Measurable) {#success-criteria}

- Server restart via menu action loads the new auth URL without connection-refused errors, verified by 10 consecutive restart cycles with zero failures
- No stdout parsing code remains in ProcessManager.swift
- No stdout parsing code remains in tugtool CLI (`AUTH_URL_REGEX`, `extract_auth_url` removed)
- No exit code 42/43 interpretation remains in ProcessManager.swift, TugConfig.swift, or tugtool CLI
- `tugcast --control-socket /tmp/test.sock` connects to a listening UDS and sends `ready` after bind
- `tugtool` creates a UDS listener, passes `--control-socket` to tugcast, and receives the `ready` message
- Toggling dev mode off and restarting launches tugcast without `--dev` flag

#### Scope {#scope}

1. New `--control-socket` CLI flag for tugcast
2. Extract `TcpListener::bind` from `run_server` into `main.rs` for pre-serve readiness signaling
3. Extract shared `dispatch_action()` function to unify action handling across HTTP, WebSocket, and UDS ingress paths
4. New `control.rs` module in tugcast for UDS client
5. New `ControlSocketListener` in ProcessManager.swift for UDS server
6. Replace `onAuthURL` with `onReady` callback wiring in AppDelegate
7. Remove stdout parsing and exit code interpretation from Mac app and tugtool CLI
8. Replace `tell()` HTTP calls with `sendControl()` UDS messages
9. Migrate Settings card "Restart Now" from HTTP `fetch("/api/tell")` to WebSocket `sendControlFrame("restart")`
10. Fix stale `devPath` bug by reading UserDefaults directly in `startProcess()`
11. Update tugtool CLI to use UDS for readiness signaling instead of stdout parsing

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the WebSocket protocol or auth model (except Settings card restart button migration from HTTP to WebSocket control frame)
- Removing the HTTP `/api/tell` endpoint (kept for `tugcode tell` CLI and external tools)
- Health monitoring, structured logging, or hot configuration over UDS (future work)
- Supporting multiple simultaneous tugcast instances

#### Dependencies / Prerequisites {#dependencies}

- Existing `tokio::net::UnixStream` and `tokio::net::UnixListener` support in tokio (already a dependency)
- Foundation networking in Swift for UDS server (built-in)

#### Constraints {#constraints}

- macOS only (Unix domain sockets are POSIX)
- Socket path must be under `$TMPDIR` to respect sandboxing
- Protocol must be debuggable with `socat` for development
- Build must pass with `-D warnings` (project policy)
- ProcessManager currently hardcodes port 7890 for socket path generation; this is a known limitation until the port becomes configurable in the Mac app (see [Q01])

#### Assumptions {#assumptions}

- The control socket uses newline-delimited JSON as specified in the design doc
- The HTTP `/api/tell` endpoint stays functional for external tools (CLI, curl, scripts)
- ProcessManager deletes stale socket files before creating the listener
- The WebSocket protocol, auth model, and frontend code remain unchanged
- Control messages feed into the same action classification logic as HTTP `tell_handler`
- `--control-socket` is always passed by the Mac app and tugtool CLI; standalone tugcast runs without it
- Swift `ControlSocketListener` uses Foundation networking (FileHandle or NWListener) for the UDS server
- Error handling logs failures but allows graceful degradation where possible

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Mac app socket path port hardcoding (OPEN) {#q01-port-hardcoding}

**Question:** ProcessManager generates the socket path using port 7890 hardcoded. If the port becomes configurable in the Mac app, how should the socket path be derived?

**Why it matters:** If a user runs multiple instances on different ports or the default port changes, the socket path won't match.

**Options (if known):**
- Read port from a config/preference (not currently stored)
- Accept port as a parameter to `ProcessManager.start()`
- Derive port from tugcast's `--port` flag value

**Plan to resolve:** DEFERRED -- the Mac app currently always uses port 7890, and this is sufficient for the initial implementation. Revisit when port configurability is added to the Mac app.

**Resolution:** DEFERRED (port is always 7890 today; revisit when Mac app port becomes configurable)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| tugtool CLI hangs after stdout removal | high | high (certain without Step 3) | Step 3 updates tugtool CLI before Step 4 removes stdout | Build or test failure in tugtool crate |
| Stale socket file prevents listener creation | medium | medium | Parent deletes stale socket before bind | App launch failure after crash |
| Stale/late UDS messages from dying child | medium | low | PID field in messages + exactly-one-connection policy | Wrong auth URL loaded after restart |
| Action dispatch drift across HTTP/WS/UDS | high | high (certain without [D10]) | Single `dispatch_action()` function used by all three paths | Divergent restart/reset behavior |
| Shutdown message lost before process exit | medium | low | Parent treats EOF-without-shutdown as crash, restarts with backoff per [D11] | Process exits but parent doesn't restart |
| UDS connection timeout on slow startup | low | low | Log error and exit; parent sees process exit without ready | Repeated startup failures |

**Risk R01: tugtool CLI stdout dependency** {#r01-tugtool-stdout}

- **Risk:** The tugtool CLI binary (`tugcode/crates/tugtool/src/main.rs`) uses `AUTH_URL_REGEX` and `extract_auth_url()` to read the auth URL from tugcast's stdout. After Step 4 removes stdout printing from tugcast, the tugtool CLI will hang forever in `extract_auth_url()` waiting for a line that never arrives.
- **Mitigation:** Step 3 updates the tugtool CLI to use UDS for readiness signaling. Step 4 (remove stdout) depends on Step 3 completing first, ensuring both consumers are migrated before the producer is removed.
- **Residual risk:** None -- the dependency ordering ensures the tugtool CLI is updated before stdout is removed.

**Risk R02: Action dispatch drift** {#r02-dispatch-drift}

- **Risk:** The restart/reset/reload_frontend action classification is currently duplicated in `server.rs:tell_handler` (lines 122-151) and `router.rs:handle_client` (lines 311-337). Adding a third copy in `control.rs` makes drift near-certain — one path changes, others don't, leading to inconsistent shutdown behavior.
- **Mitigation:** [D10] requires extracting a single `dispatch_action()` function in Step 2. All three ingress paths call it. No duplicated match blocks.
- **Residual risk:** None — single source of truth for action semantics.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Parent listens, child connects (DECIDED) {#d01-parent-listens}

**Decision:** The Mac app (and tugtool CLI) create the UDS listener before spawning tugcast. The child connects to the socket path passed via `--control-socket`.

**Rationale:**
- Parent is always ready to accept before child exists -- no polling, no race
- Listener persists across child restarts; new child connects to same socket
- Standard pattern for parent-managed child processes

**Implications:**
- ProcessManager must create and own the `ControlSocketListener`
- tugtool CLI must create and own a `tokio::net::UnixListener`
- Listener lifecycle is tied to the parent process, not individual child starts
- Child startup fails fatally if it cannot connect to the socket

#### [D02] Newline-delimited JSON protocol (DECIDED) {#d02-ndjson-protocol}

**Decision:** The UDS protocol uses newline-delimited JSON (one JSON object per `\n`-terminated line).

**Rationale:**
- Debuggable with `socat` and standard Unix tools
- Message rate is very low (handful per server lifetime); efficiency is irrelevant
- JSON parsing already available in both Rust (serde_json) and Swift (JSONSerialization)

**Implications:**
- Messages must not contain embedded newlines in values
- Each side needs a line-buffered reader
- No framing bytes needed beyond `\n`

#### [D03] Ready message sent after TcpListener::bind (DECIDED) {#d03-ready-after-bind}

**Decision:** The `ready` message is sent only after `TcpListener::bind` succeeds and the HTTP server is prepared to accept connections.

**Rationale:**
- Structurally eliminates the restart race condition
- The auth URL is only delivered when the server can actually serve it
- No timing assumptions or artificial delays

**Implications:**
- `run_server` must be split: bind happens in `main.rs`, listener is passed to `axum::serve`
- The `ready` message includes both `auth_url` and `port`
- The `info!(port, ...)` log line moves from `run_server` to `main.rs` (since `run_server` no longer knows the port)
- The unused `_auth: SharedAuthState` parameter on `run_server` can be removed as part of the signature cleanup

#### [D04] Socket path uses port-based pattern (DECIDED) {#d04-socket-path}

**Decision:** Socket path is `$TMPDIR/tugcast-ctl-{port}.sock`, deterministic and scoped to the user.

**Rationale:**
- Predictable path avoids coordination between parent and child
- Port-based naming supports future multi-instance scenarios
- `$TMPDIR` is per-user on macOS, avoids permission issues

**Implications:**
- Parent must delete stale socket files before creating listener
- Path is generated by the parent (ProcessManager or tugtool CLI) and passed to tugcast via CLI flag
- ProcessManager currently hardcodes port 7890 for path generation (see [Q01])

#### [D05] Remove stdout parsing entirely (DECIDED) {#d05-remove-stdout}

**Decision:** Remove all stdout-based IPC from both consumers. Tugcast no longer prints the auth URL to stdout at all — not for machine parsing, not for humans. When `--control-socket` is not provided, tugcast runs without any readiness signaling (standalone/development mode). Auth URL appears only in tracing logs (`info!`).

**Note:** The roadmap document (`roadmap/tugcast-control-socket.md`) contains an outdated "Backward compatibility" section that says tugcast falls back to stdout printing when `--control-socket` is absent. **This tugplan is canonical.** The roadmap text will be updated to match.

**Rationale:**
- Stdout parsing was the root cause of the restart race condition
- Having two IPC paths (stdout + UDS) creates confusion about which is authoritative
- No human use case for printing the auth URL to stdout — tracing logs serve that purpose

**Implications:**
- `println!("\ntugcast: {}\n", auth_url)` is removed from tugcast's `main.rs`
- The `info!("Auth URL: {}", auth_url)` tracing line stays for log visibility
- The `authURLPattern` regex and pipe `readabilityHandler` are removed from ProcessManager
- The `AUTH_URL_REGEX`, `extract_auth_url()`, and `Stdio::piped()` stdout reading are removed from the tugtool CLI
- Standalone tugcast (without Mac app) shows auth URL only in tracing logs

#### [D06] Replace tell() with sendControl() over UDS (DECIDED) {#d06-replace-tell}

**Decision:** AppDelegate sends commands to tugcast via UDS messages instead of HTTP POST to `/api/tell`.

**Rationale:**
- No HTTP overhead for local IPC
- No port discovery needed (socket path is known at process start)
- Works during startup and shutdown (before/after HTTP server)
- No auth needed (parent-child trust is implicit)

**Implications:**
- `tell()` method and `serverPort` property removed from AppDelegate
- All menu actions route through `sendControl()` via ProcessManager
- HTTP `/api/tell` endpoint stays for external consumers

#### [D07] Remove exit code 42/43 interpretation (DECIDED) {#d07-remove-exit-codes}

**Decision:** ProcessManager and the tugtool CLI no longer interpret exit codes 42 (restart) and 43 (reset). The `shutdown` UDS message carries the structured reason.

**Rationale:**
- Exit codes are unidirectional, carry one byte, arrive only after process death
- The `shutdown` message provides structured reason before the process exits
- The supervisor loop becomes simpler: any exit triggers "process exited" handling

**Implications:**
- `TugConfig.exitRestart` and `TugConfig.exitReset` constants removed
- Supervisor loop in ProcessManager's `startProcess()` simplified
- Supervisor loop in tugtool CLI's `supervisor_loop()` simplified: exit codes 42/43 match arm removed, restart driven by UDS `shutdown` message with `reason: "restart"`
- tugcast `tell_handler` still sends exit codes for now (cleanup in future), but parents ignore them

#### [D08] Fix stale devPath by reading UserDefaults directly (DECIDED) {#d08-fix-devpath}

**Decision:** `startProcess()` reads `UserDefaults` directly for `devModeEnabled` and `sourceTreePath` every time it is called, instead of using stored `devPath` property.

**Rationale:**
- The stored `devPath` becomes stale if the user toggles dev mode between restarts
- Preferences are the source of truth; reading them at process start time is correct
- Eliminates a class of bugs where ProcessManager state diverges from user settings

**Implications:**
- `devPath` stored property removed from ProcessManager
- `start(devMode:sourceTree:)` signature simplified or removed
- `startProcess()` becomes self-contained for argument construction

#### [D09] tugtool CLI uses UDS for readiness signaling (DECIDED) {#d09-tugtool-uds}

**Decision:** The tugtool CLI launcher creates a UDS listener (using `tokio::net::UnixListener`), passes `--control-socket` to tugcast, and waits for the `ready` message instead of parsing stdout.

**Rationale:**
- The tugtool CLI has the same stdout-parsing fragility as ProcessManager
- After stdout printing is removed from tugcast, the tugtool CLI would hang forever in `extract_auth_url()`
- The UDS pattern is already implemented for tugcast (Step 2); the tugtool CLI reuses the same protocol
- The tugtool CLI also interprets exit codes 42/43 in its `supervisor_loop()`, which should be replaced by UDS `shutdown` messages

**Implications:**
- `AUTH_URL_REGEX` static, `extract_auth_url()` function, and `Stdio::piped()` stdout capture removed from tugtool CLI
- `spawn_tugcast()` updated to pass `--control-socket` flag and stop piping stdout
- `supervisor_loop()` updated to listen for UDS `ready` and `shutdown` messages instead of parsing stdout and interpreting exit codes 42/43
- tugtool CLI needs `tokio::net::UnixListener` for the server side (already available via tokio)
- Socket path generated the same way: `$TMPDIR/tugcast-ctl-{port}.sock`

#### [D10] Unified action dispatch function (DECIDED) {#d10-unified-dispatch}

**Decision:** Extract a single shared `dispatch_action()` function that all three ingress paths (HTTP `tell_handler`, WebSocket control frame handler, UDS `run_recv_loop`) call. No duplicated action classification logic.

**Rationale:**
- Today the same `restart/reset/reload_frontend/other` match block is duplicated in `server.rs:tell_handler` (lines 122-151) and `router.rs:handle_client` (lines 311-337). Adding a third copy in `control.rs` creates unacceptable drift risk — one path changes, others don't.
- A single function is the obvious fix. All three paths parse a JSON action and need the same classification and channel sends.

**Implications:**
- New function `dispatch_action(action: &str, raw_payload: &[u8], shutdown_tx, client_action_tx, reload_tx)` in a shared module (e.g., `actions.rs` or added to `server.rs`)
- `tell_handler` calls `dispatch_action` instead of inline match
- `router.rs` WebSocket control frame handler calls `dispatch_action` instead of inline match
- `control.rs` `run_recv_loop` calls `dispatch_action`
- The function takes cloned channel senders as parameters
- Return type indicates whether the action was handled (for logging)
- UDS `tell` envelopes are normalized before dispatch: `dispatch_action` receives the same `(action, raw_payload)` shape regardless of ingress path (HTTP body, WebSocket control frame, or UDS `tell` message), ensuring clients always get canonical control payload

#### [D11] Termination contract (DECIDED) {#d11-termination-contract}

**Decision:** Define explicit ordering and fallback policies for process shutdown and parent restart behavior.

**Shutdown ordering in tugcast:**
1. Action handler decides to shut down (e.g., `dispatch_action("restart", ...)`)
2. Send `{"type":"shutdown","reason":"restart","pid":...}` over UDS
3. Call `cancel.cancel()` to stop background tasks
4. Call `process::exit(exit_code)`

If the UDS write fails (parent disconnected), tugcast still exits. The `shutdown` message is best-effort.

**Single-event restart rule:** Each child generation (identified by PID) produces exactly one restart decision. The parent tracks a per-generation `restartDecision` enum: `pending | restart | restartWithBackoff | doNotRestart`. The first signal that arrives (UDS `shutdown`, UDS EOF, or process exit) sets the decision; all subsequent signals for the same PID are no-ops. This prevents double-triggering from overlapping signals (e.g., `shutdown` message arrives, then EOF fires, then process exit fires — only the first one counts).

**Parent restart policy:**

| Signal received | Parent behavior |
|----------------|-----------------|
| UDS `shutdown` with `reason:"restart"` or `reason:"reset"` | Set decision = `restart` (immediate, no backoff) |
| UDS `shutdown` with `reason:"error"` | Set decision = `doNotRestart`; log error |
| UDS EOF without prior `shutdown` | Set decision = `restartWithBackoff` (capped exponential: 1s → 2s → 4s → ... → 30s max) |
| UDS EOF + process still running | Log warning (unexpected state, possible bug); close connection, wait for process exit, then apply `restartWithBackoff` |
| Process exited but no decision set yet | Set decision = `restartWithBackoff` (shutdown message lost or never sent) |
| Any signal after decision is already set | No-op; log and discard |

**Backoff reset:** Backoff resets to zero after a successful `ready` message (the child started and is healthy).

**Parent-initiated graceful shutdown sequence:**

When the parent wants to stop the child (e.g., app termination, `ProcessManager.stop()`):
1. Send `{"type":"shutdown"}` over UDS
2. Wait up to 5 seconds for process exit
3. If still running after timeout: send `SIGTERM`
4. Wait up to 2 seconds for exit
5. If still running: send `SIGKILL`

This ensures the parent-to-child `shutdown` message (already defined in the protocol spec Table T02) is actually used in the lifecycle, giving tugcast a chance to clean up before signal escalation.

**Rationale:**
- Exit codes are gone; the parent needs a clear contract for when to restart
- Single-event rule prevents duplicate restarts from overlapping signals (shutdown + EOF + process exit can all fire for one child death)
- Unexpected deaths (segfault, OOM) don't send `shutdown`; the parent must detect and handle them
- Capped backoff prevents tight restart loops on persistent crashes
- Backoff reset on `ready` distinguishes "child crashes during startup" from "child ran fine then crashed later"
- "EOF + process still running" is unlikely but not impossible (e.g., implementation bugs, socket layer issues); treating it as impossible hides real failures
- Graceful shutdown via UDS before SIGTERM gives tugcast a chance to flush state and send its own `shutdown` message

**Implications:**
- ProcessManager and tugtool CLI supervisor loops implement the single-event state machine: track `restartDecision` per child PID, set on first signal, ignore subsequent signals for same PID
- ProcessManager `stop()` and tugtool CLI shutdown use the graceful shutdown sequence (UDS message → SIGTERM → SIGKILL)
- No exit code interpretation anywhere

#### [D12] Settings card uses WebSocket control frame for restart (DECIDED) {#d12-settings-restart}

**Decision:** The Settings card "Restart Now" button sends `connection.sendControlFrame("restart")` instead of `fetch("/api/tell", ...)`. The HTTP `/api/tell` endpoint is kept for `tugcode tell` CLI and external tools only.

**Rationale:**
- The Settings card already has a live WebSocket connection. Using HTTP for a one-shot command to the same server is unnecessary indirection.
- The WebSocket path already handles "restart" control frames in `router.rs` — the infrastructure exists.
- Removes the Settings card's dependency on knowing the HTTP port and having valid HTTP routing.
- `/api/tell` is kept because `tugcode tell` (the CLI command at `tugcode/crates/tugcode/src/commands/tell.rs`) and external scripts/tools need an HTTP interface. They are not inside a WebSocket connection.

**Implications:**
- `settings-card.ts`: replace `fetch("/api/tell", ...)` with `this.connection.sendControlFrame("restart")`
- One-line change in the restart button click handler
- HTTP `/api/tell` endpoint and `tugcode tell` CLI remain unchanged

---

### 1.0.1 UDS Protocol Specification {#protocol-spec}

**Spec S01: Control Socket Protocol** {#s01-control-protocol}

The control socket carries newline-delimited JSON messages. Each message is a single JSON object terminated by `\n`. Messages are exchanged between parent (Mac app or tugtool CLI) and child (tugcast) over a Unix domain socket stream connection.

#### Child-to-Parent Messages {#child-to-parent}

**Table T01: Child-to-Parent Messages** {#t01-child-messages}

| Type | Fields | When Sent |
|------|--------|-----------|
| `ready` | `type`, `auth_url`, `port`, `pid` | After `TcpListener::bind` succeeds and server is operational |
| `shutdown` | `type`, `reason`, `pid`, `message` (optional) | Before process exit |

Ready message example:
```json
{"type":"ready","auth_url":"http://127.0.0.1:7890/auth?token=abc...","port":7890,"pid":12345}
```

Shutdown message examples:
```json
{"type":"shutdown","reason":"restart","pid":12345}
{"type":"shutdown","reason":"reset","pid":12345}
{"type":"shutdown","reason":"error","pid":12345,"message":"failed to bind port"}
```

The `pid` field allows the parent to correlate messages with the child process it spawned, preventing misattribution if a late message arrives from a dying child after a new child has already connected.

#### Connection Semantics {#connection-semantics}

**Exactly one active connection.** The parent's UDS listener accepts connections, but only the most recent connection is active. When a new child connects (on restart), the parent closes the previous connection immediately. The parent validates incoming `ready`/`shutdown` messages against the PID of the child it most recently spawned. Messages from unknown PIDs are logged and discarded.

#### Parent-to-Child Messages {#parent-to-child}

**Table T02: Parent-to-Child Messages** {#t02-parent-messages}

| Type | Fields | When Sent |
|------|--------|-----------|
| `tell` | `type`, `action`, plus action-specific fields | When parent sends a command |
| `shutdown` | `type` | When parent requests graceful shutdown |

Tell message examples:
```json
{"type":"tell","action":"show-card","component":"about"}
{"type":"tell","action":"restart"}
{"type":"tell","action":"reload_frontend"}
```

Shutdown message:
```json
{"type":"shutdown"}
```

#### Action Classification (Unchanged) {#action-classification}

**Table T03: Action Classification** {#t03-action-classification}

| Action | Type | Behavior |
|--------|------|----------|
| `restart` | server-only | Send `shutdown` response over UDS, exit |
| `reset` | hybrid | Broadcast 0xC0 to WebSocket clients, send `shutdown` over UDS, exit |
| `reload_frontend` | hybrid | Broadcast 0xC0 to WebSocket clients, fire `reload_tx` |
| Everything else | client-only | Broadcast 0xC0 to WebSocket clients |

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugcast/src/control.rs` | UDS client: connect, send ready/shutdown, receive and dispatch tell messages |
| `tugcode/crates/tugcast/src/actions.rs` | Shared action dispatch function used by HTTP, WebSocket, and UDS ingress |
| `tugapp/Sources/ControlSocket.swift` | UDS server: listener, connection handling, message parsing |

#### 1.0.2.2 Symbols to add / modify {#symbols}

**Table T04: New Rust Symbols (tugcast)** {#t04-rust-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `dispatch_action` | async fn | `tugcast/src/actions.rs` | Shared action classification and dispatch; called by HTTP, WebSocket, and UDS handlers |
| `ControlSocket` | struct | `tugcast/src/control.rs` | Holds `UnixStream`, provides send/recv methods |
| `ControlSocket::connect(path)` | async fn | `tugcast/src/control.rs` | Connect to parent UDS listener |
| `ControlSocket::send_ready(auth_url, port, pid)` | async fn | `tugcast/src/control.rs` | Send `ready` message (with pid) after bind |
| `ControlSocket::send_shutdown(reason, pid)` | async fn | `tugcast/src/control.rs` | Send `shutdown` message (with pid) before exit |
| `ControlSocket::run_recv_loop(...)` | async fn | `tugcast/src/control.rs` | Background task: read UDS messages, dispatch via `dispatch_action` |
| `ControlMessage` | enum | `tugcast/src/control.rs` | Parsed UDS message types (Tell, Shutdown) |
| `Cli::control_socket` | field (Option&lt;PathBuf&gt;) | `tugcast/src/cli.rs` | `--control-socket` flag |
| `run_server` | fn (modified) | `tugcast/src/server.rs` | Accept pre-bound `TcpListener` instead of `port`; remove unused `_auth` param |

**Table T07: Modified/New Rust Symbols (tugtool CLI)** {#t07-tugtool-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `create_control_listener(port)` | fn (new) | `tugtool/src/main.rs` | Create UDS listener at `$TMPDIR/tugcast-ctl-{port}.sock` |
| `wait_for_ready(listener)` | async fn (new) | `tugtool/src/main.rs` | Accept connection, read lines until `ready` message, return auth URL |
| `spawn_tugcast` | fn (modified) | `tugtool/src/main.rs` | Add `--control-socket` arg, change stdout from `Stdio::piped()` to `Stdio::inherit()` |
| `supervisor_loop` | async fn (modified) | `tugtool/src/main.rs` | Replace stdout parsing + exit code 42/43 with UDS ready/shutdown handling |

**Table T05: New Swift Symbols** {#t05-swift-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ControlSocketListener` | class | `ControlSocket.swift` | UDS server: create, listen, accept connections |
| `ControlSocketConnection` | class | `ControlSocket.swift` | Single UDS connection: read/write messages |
| `ControlMessage` | struct | `ControlSocket.swift` | Parsed message with `type` and payload fields |
| `ProcessManager.controlListener` | property | `ProcessManager.swift` | Persistent UDS listener |
| `ProcessManager.controlConnection` | property | `ProcessManager.swift` | Current child connection |
| `ProcessManager.controlSocketPath` | property | `ProcessManager.swift` | Socket file path |
| `ProcessManager.onReady` | callback | `ProcessManager.swift` | Replaces `onAuthURL` |
| `ProcessManager.sendControl(_:params:)` | method | `ProcessManager.swift` | Send tell message to child |
| `ProcessManager.restartDecision` | property | `ProcessManager.swift` | Per-generation state machine: `pending \| restart \| restartWithBackoff \| doNotRestart` |

**Table T06: Symbols to Remove** {#t06-remove-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ProcessManager.authURLPattern` | property | `ProcessManager.swift` | Stdout regex parsing |
| `ProcessManager.devPath` | property | `ProcessManager.swift` | Stale dev mode path |
| `ProcessManager.onAuthURL` | callback | `ProcessManager.swift` | Replaced by `onReady` |
| `AppDelegate.serverPort` | property | `AppDelegate.swift` | No longer needed for HTTP tell |
| `AppDelegate.tell(_:params:)` | method | `AppDelegate.swift` | Replaced by `sendControl` |
| `TugConfig.exitRestart` | constant | `TugConfig.swift` | Exit code 42 |
| `TugConfig.exitReset` | constant | `TugConfig.swift` | Exit code 43 |
| `AUTH_URL_REGEX` | static | `tugtool/src/main.rs` | Stdout regex for auth URL extraction |
| `extract_auth_url()` | async fn | `tugtool/src/main.rs` | Reads stdout lines until regex matches |
| `test_auth_url_regex_matches_standard_url` | test fn | `tugtool/src/main.rs` | Tests AUTH_URL_REGEX; removed with it |
| `test_auth_url_regex_captures_full_url` | test fn | `tugtool/src/main.rs` | Tests AUTH_URL_REGEX; removed with it |
| `test_auth_url_regex_does_not_match_log_lines` | test fn | `tugtool/src/main.rs` | Tests AUTH_URL_REGEX; removed with it |
| `test_auth_url_regex_various_ports` | test fn | `tugtool/src/main.rs` | Tests AUTH_URL_REGEX; removed with it |
| `regex` | dependency | `tugtool/Cargo.toml` | No remaining consumers after AUTH_URL_REGEX removal |
| `fetch("/api/tell", ...)` | call | `settings-card.ts` | Replaced by `connection.sendControlFrame("restart")` |
| inline action match in `tell_handler` | code block | `server.rs` (lines 122-151) | Replaced by `dispatch_action()` call |
| inline action match in `handle_client` | code block | `router.rs` (lines 311-337) | Replaced by `dispatch_action()` call |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test CLI parsing, message serialization, action classification | New `--control-socket` flag, control message encode/decode |
| **Integration** | Test UDS connect/send/recv round-trip, server bind-then-ready flow | End-to-end control socket lifecycle |
| **Manual** | Verify restart race condition fix, dev mode toggle persistence | Mac app restart cycles, Settings card interaction, tugtool CLI launch |

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Add --control-socket CLI flag to tugcast {#step-0}

**Commit:** `feat(tugcast): add --control-socket CLI flag`

**References:** [D01] Parent listens child connects, [D04] Socket path uses port-based pattern, Table T04, (#symbols)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/cli.rs` with new `control_socket` field
- New unit tests for `--control-socket` flag parsing

**Tasks:**
- [ ] Add `control_socket: Option<PathBuf>` field to `Cli` struct with `#[arg(long)]`
- [ ] Add doc comment: "Unix domain socket path for parent IPC"
- [ ] Add unit tests: flag absent (None), flag present (Some), combined with other flags

**Tests:**
- [ ] Unit test: `test_control_socket_flag_none` -- default is None
- [ ] Unit test: `test_control_socket_flag_some` -- parses path correctly
- [ ] Unit test: `test_control_socket_with_other_flags` -- works alongside --port, --session, --dev

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast --test-threads=1` passes
- [ ] `cd tugcode && cargo build -p tugcast` with no warnings

**Rollback:** Revert the single commit to `cli.rs`.

**Commit after all checkpoints pass.**

---

#### Step 1: Extract TcpListener::bind into main.rs {#step-1}

**Depends on:** #step-0

**Commit:** `refactor(tugcast): extract TcpListener::bind to main.rs for readiness signaling`

**References:** [D03] Ready message sent after TcpListener bind, (#protocol-spec, #symbols)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/server.rs`: `run_server` accepts `TcpListener` parameter
- Modified `tugcode/crates/tugcast/src/main.rs`: binds listener, passes to `run_server`

**Tasks:**
- [ ] Change `run_server` signature: replace `port: u16` with `listener: TcpListener`
- [ ] Remove the unused `_auth: SharedAuthState` parameter from `run_server` (it is currently unused, prefixed with `_`)
- [ ] Remove `TcpListener::bind` and the `info!(port = port, "tugcast server listening")` log line from `run_server`; it receives an already-bound listener
- [ ] In `main.rs`, bind `TcpListener` before calling `run_server`, between feed setup and `tokio::select!`:
  ```rust
  let listener = TcpListener::bind(format!("127.0.0.1:{}", cli.port)).await;
  ```
- [ ] Add the port-bound log line in `main.rs` after successful bind: `info!(port = cli.port, "tugcast server listening")`
- [ ] Handle bind failure in `main.rs` with `eprintln!` and `process::exit(1)` (replaces the error propagation that was inside `run_server`)
- [ ] Update the `run_server` call site in `main.rs` to pass `listener` instead of `cli.port`, and remove the `auth.clone()` argument
- [ ] Update the `server_future` error message in `tokio::select!` since bind errors are now handled before `select!`

**Tests:**
- [ ] Integration test: existing tests still pass (server starts, binds port)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast --test-threads=1` passes
- [ ] `cd tugcode && cargo build -p tugcast` with no warnings
- [ ] Manual: `cargo run -p tugcast` starts and serves on port 7890

**Rollback:** Revert commit; `run_server` goes back to accepting `port: u16`.

**Commit after all checkpoints pass.**

---

#### Step 2: Extract shared action dispatch and implement control.rs {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast): unified action dispatch + UDS control socket client`

**References:** [D01] Parent listens child connects, [D02] Newline-delimited JSON protocol, [D03] Ready message sent after TcpListener bind, [D10] Unified action dispatch function, [D11] Termination contract, Spec S01, Tables T01-T03, (#child-to-parent, #parent-to-child, #action-classification, #symbols)

**Artifacts:**
- New `tugcode/crates/tugcast/src/actions.rs`: shared `dispatch_action()` function
- New `tugcode/crates/tugcast/src/control.rs`: UDS client
- Modified `tugcode/crates/tugcast/src/server.rs`: `tell_handler` calls `dispatch_action()`
- Modified `tugcode/crates/tugcast/src/router.rs`: WebSocket control frame handler calls `dispatch_action()`
- Modified `tugcode/crates/tugcast/src/main.rs`: add `mod actions`, `mod control`, connect on startup, send ready after bind, send shutdown before exit, spawn recv loop

**Tasks:**

*Part A: Unified action dispatch (prerequisite for control.rs)*
- [ ] Create `actions.rs` with `dispatch_action()`:
  ```rust
  pub async fn dispatch_action(
      action: &str,
      raw_payload: &[u8],
      shutdown_tx: &mpsc::Sender<u8>,
      client_action_tx: &broadcast::Sender<Frame>,
      reload_tx: &Option<broadcast::Sender<()>>,
  ) { ... }
  ```
- [ ] Move the action classification match block from `tell_handler` into `dispatch_action()`:
  - `"restart"`: send 42 via `shutdown_tx`
  - `"reset"`: broadcast 0xC0 frame via `client_action_tx`, 100ms delay, send 43 via `shutdown_tx`
  - `"reload_frontend"`: broadcast 0xC0 frame via `client_action_tx`, fire `reload_tx`
  - all other actions: broadcast 0xC0 frame via `client_action_tx`
- [ ] Update `tell_handler` in `server.rs` to call `dispatch_action()` instead of inline match
- [ ] Update WebSocket control frame handler in `router.rs` (lines 307-337) to call `dispatch_action()` instead of inline match
- [ ] Add `mod actions;` to `main.rs`
- [ ] Verify existing integration tests still pass (they test tell_handler behavior)

*Part B: UDS control socket client*
- [ ] Create `control.rs` with `ControlSocket` struct wrapping `tokio::net::UnixStream`
- [ ] Implement `ControlSocket::connect(path: &Path) -> Result<Self>` using `UnixStream::connect`
- [ ] Implement `send_ready(auth_url: &str, port: u16, pid: u32)` -- serialize and write `{"type":"ready",...}\n` with pid
- [ ] Implement `send_shutdown(reason: &str, pid: u32)` -- serialize and write `{"type":"shutdown",...}\n` with pid
- [ ] Implement `run_recv_loop` as an async function that reads lines from the socket, parses JSON, and dispatches via `dispatch_action()`:
  - `tell` messages: extract `action` and `raw_payload`, call `dispatch_action()`
  - `shutdown` message: send exit code 0 via `shutdown_tx`
- [ ] Define `ControlMessage` enum: `Tell { action, payload }`, `Shutdown`
- [ ] **Channel wiring in `main.rs`:** Clone `shutdown_tx`, `client_action_tx`, and `reload_tx` **before** passing them into `FeedRouter::new()`. The clones are passed to `run_recv_loop`; the originals go to `FeedRouter`. This is necessary because `FeedRouter::new` takes ownership of these senders:
  ```rust
  // Clone senders for control socket recv loop BEFORE constructing FeedRouter
  let ctl_shutdown_tx = shutdown_tx.clone();
  let ctl_client_action_tx = client_action_tx.clone();
  let ctl_reload_tx = reload_tx.clone();
  // ... construct FeedRouter with originals ...
  // ... spawn run_recv_loop with clones ...
  ```
- [ ] In `main.rs`: if `cli.control_socket` is Some, connect to UDS before feed setup
- [ ] In `main.rs`: after `TcpListener::bind`, if control socket is connected, send `ready` with `std::process::id()` as pid
- [ ] In `main.rs`: spawn `run_recv_loop` as a background task with the cloned channel senders
- [ ] In `main.rs`: before `process::exit`, if control socket is connected, send `shutdown` with reason derived from exit code and pid. **Ordering per [D11]:** send shutdown message → cancel.cancel() → process::exit(). The UDS write is best-effort; if it fails (parent disconnected), tugcast still exits.
- [ ] Add `mod control;` to `main.rs`

**Tests:**
- [ ] Unit test: `dispatch_action` with action "restart" sends 42 via shutdown_tx
- [ ] Unit test: `dispatch_action` with unknown action broadcasts via client_action_tx
- [ ] Unit test: `ControlMessage` serialization/deserialization
- [ ] Unit test: `ready` message format includes pid
- [ ] Unit test: `shutdown` message format includes pid
- [ ] Integration test: connect to a test UDS listener, send ready, verify receipt
- [ ] Integration test: existing tell_handler tests still pass (behavior unchanged, just refactored)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast --test-threads=1` passes
- [ ] `cd tugcode && cargo build -p tugcast` with no warnings
- [ ] Manual: run tugcast with `--control-socket /tmp/test.sock` against a `socat` listener, verify `ready` JSON appears with pid field

**Rollback:** Remove `actions.rs`, `control.rs`, revert `server.rs`, `router.rs`, and `main.rs` changes.

**Commit after all checkpoints pass.**

---

#### Step 3: Update tugtool CLI to use UDS for readiness signaling {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugtool): replace stdout parsing with UDS control socket`

**References:** [D01] Parent listens child connects, [D02] Newline-delimited JSON protocol, [D05] Remove stdout parsing entirely, [D07] Remove exit code 42/43 interpretation, [D09] tugtool CLI uses UDS for readiness signaling, Spec S01, Tables T01-T02, T07, Risk R01, (#protocol-spec, #child-to-parent, #parent-to-child, #symbols)

**Artifacts:**
- Modified `tugcode/crates/tugtool/src/main.rs`: UDS listener replaces stdout parsing, supervisor loop uses UDS messages

**Tasks:**
- [ ] Add `create_control_listener(port: u16) -> Result<(UnixListener, PathBuf)>`: generate socket path `$TMPDIR/tugcast-ctl-{port}.sock`, delete stale file if exists, bind `tokio::net::UnixListener`, return listener and path
- [ ] Add `wait_for_ready(listener: &UnixListener) -> Result<(String, UnixStream)>`: accept one connection, read lines with `BufReader`, parse JSON until `{"type":"ready",...}` arrives, return both the `auth_url` AND the connection handle. Apply a timeout (e.g., 30 seconds). **Critical:** the connection must stay alive after `ready` — the supervisor loop continues reading from it to receive `shutdown` messages. `wait_for_ready` returns the connection so the caller can keep reading.
- [ ] Modify `spawn_tugcast()`: add `control_socket_path: &Path` parameter, append `--control-socket <path>` to tugcast args, change `stdout` from `Stdio::piped()` to `Stdio::inherit()` (tugcast no longer writes IPC data to stdout)
- [ ] Modify `supervisor_loop()`:
  - Create UDS listener once at loop start via `create_control_listener(cli.port)`
  - On each spawn: call `spawn_tugcast` with the socket path
  - Replace `extract_auth_url(stdout)` with `wait_for_ready(&listener)` on first spawn (and on respawns)
  - After `wait_for_ready` returns, continue reading from the same connection for `shutdown` messages (the connection is long-lived for the child's lifetime)
  - Implement single-event restart state machine per [D11]: track `restartDecision` per child PID (`pending | restart | restartWithBackoff | doNotRestart`), set on first signal, ignore subsequent signals for same PID
  - Apply restart policy per [D11] — first signal wins:
    - `shutdown` with `reason:"restart"` or `reason:"reset"`: set `restart` (immediate, no backoff)
    - `shutdown` with `reason:"error"`: set `doNotRestart`, log error
    - UDS EOF without prior `shutdown` (unexpected death): set `restartWithBackoff` (capped exponential: 1s → 2s → 4s → ... → 30s max)
    - Process exit with no prior signal: set `restartWithBackoff`
    - Reset backoff to zero after a successful `ready` message
  - Validate `pid` field in messages against the PID of the spawned child
  - On CLI shutdown (e.g., Ctrl-C): send `{"type":"shutdown"}` over UDS before killing child, with SIGTERM/SIGKILL fallback per [D11] graceful shutdown sequence
- [ ] Remove `AUTH_URL_REGEX` static
- [ ] Remove `extract_auth_url()` function
- [ ] Remove the four `AUTH_URL_REGEX` test functions: `test_auth_url_regex_matches_standard_url`, `test_auth_url_regex_captures_full_url`, `test_auth_url_regex_does_not_match_log_lines`, `test_auth_url_regex_various_ports`
- [ ] Remove the `regex` dependency from `tugcode/crates/tugtool/Cargo.toml` (no remaining consumers after `AUTH_URL_REGEX` removal)
- [ ] Remove the `regex` import and `LazyLock` import (if no longer needed after removing `AUTH_URL_REGEX`)
- [ ] Clean up unused imports: `AsyncBufReadExt` may still be needed for `wait_for_ready`, but `BufReader` usage changes from `ChildStdout` to `UnixStream`

**Tests:**
- [ ] Unit test: verify `AUTH_URL_REGEX` and `extract_auth_url` no longer exist (compile test -- code should not reference them)
- [ ] Unit test: existing CLI parsing tests still pass
- [ ] Integration test: `create_control_listener` creates socket, `wait_for_ready` receives mock `ready` message

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes
- [ ] `cd tugcode && cargo build -p tugtool` with no warnings
- [ ] `grep -r "AUTH_URL_REGEX\|extract_auth_url\|exit.*42\|exit.*43" tugcode/crates/tugtool/src/main.rs` returns no matches
- [ ] Manual: `cargo run -p tugtool` launches tugcast, receives ready via UDS, opens browser

**Rollback:** Revert tugtool CLI main.rs changes.

**Commit after all checkpoints pass.**

---

#### Step 4: Remove stdout printing from tugcast {#step-4}

**Depends on:** #step-3

**Commit:** `fix(tugcast): remove stdout auth URL printing`

**References:** [D05] Remove stdout parsing entirely, Risk R01, (#context)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/main.rs`: remove `println!` and `stdout().flush()`

**Tasks:**
- [ ] Remove `println!("\ntugcast: {}\n", auth_url)` from `main.rs`
- [ ] Remove `use std::io::Write;` and `std::io::stdout().flush().ok();` from `main.rs`
- [ ] Keep `info!("Auth URL: {}", auth_url)` tracing line for log visibility

**Tests:**
- [ ] Existing tests still pass
- [ ] Verify tugtool CLI still works (it now uses UDS, not stdout)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugcast --test-threads=1` passes
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes
- [ ] `cd tugcode && cargo build` with no warnings (all crates)

**Rollback:** Revert commit; restore println.

**Commit after all checkpoints pass.**

---

#### Step 5: Implement ControlSocketListener in ProcessManager.swift {#step-5}

**Depends on:** #step-2

**Commit:** `feat(tugapp): implement UDS control socket listener`

**References:** [D01] Parent listens child connects, [D02] Newline-delimited JSON protocol, [D04] Socket path uses port-based pattern, [Q01] Port hardcoding, Spec S01, Tables T01-T02, T05, (#child-to-parent, #parent-to-child, #new-files, #symbols)

**Artifacts:**
- New `tugapp/Sources/ControlSocket.swift` with `ControlSocketListener`, `ControlSocketConnection`, and `ControlMessage`
- Modified `tugapp/Sources/ProcessManager.swift`: add control socket properties, create listener in `start()`, handle messages

**Tasks:**
- [ ] Create `ControlSocket.swift` with:
  - `ControlMessage` struct: `type` string, raw `[String: Any]` dictionary for payload
  - `ControlSocketListener` class: create UDS at path, listen for connections, accept handler callback
  - `ControlSocketConnection` class: read lines from connection, parse JSON, fire `onMessage` callback; write messages
- [ ] `ControlSocketListener.init(path:)`: delete stale socket file, create and bind Unix socket, start listening
- [ ] `ControlSocketConnection`: use `FileHandle` for reading/writing, line-buffer incoming data
- [ ] Add to `ProcessManager`:
  - `controlListener: ControlSocketListener?` property
  - `controlConnection: ControlSocketConnection?` property
  - `controlSocketPath: String` computed from `NSTemporaryDirectory() + "tugcast-ctl-7890.sock"` -- **Note:** port 7890 is hardcoded because the Mac app currently always uses this port. This is a known limitation tracked by [Q01]. When the Mac app gains port configurability, this path generation should read the port from configuration.
  - `onReady: ((String) -> Void)?` callback (replaces `onAuthURL`)
  - `sendControl(_:params:)` method: write JSON message to `controlConnection`
- [ ] In `start()`: create `controlListener` if nil, set up `onConnection` handler that:
  - Closes any previous `controlConnection` immediately (exactly-one-connection policy per [D11])
  - Stores the new connection and wires `onMessage`
- [ ] Add `restartDecision` per-generation state: enum `pending | restart | restartWithBackoff | doNotRestart`, reset to `pending` on each child spawn. First signal sets the decision; subsequent signals for the same PID are logged and ignored (single-event restart rule per [D11]).
- [ ] In `handleControlMessage(_:)`: validate `pid` field against spawned child's PID, then dispatch on `type`:
  - `"ready"`: extract `auth_url`, reset backoff delay to zero, call `onReady` on main queue
  - `"shutdown"`: if `restartDecision` is still `pending`, set it based on reason per [D11]:
    - `reason:"restart"` or `reason:"reset"`: set `restartDecision = .restart`
    - `reason:"error"`: set `restartDecision = .doNotRestart`, log error
- [ ] On UDS connection EOF (child died without sending `shutdown`): if `restartDecision` is still `pending`, set `restartDecision = .restartWithBackoff` (unexpected death per [D11])
- [ ] On process exit: apply the `restartDecision` that was set by whichever signal arrived first. If still `pending` (no UDS signal at all), set `restartWithBackoff`.
- [ ] In `stop()`: implement graceful shutdown sequence per [D11]: send `{"type":"shutdown"}` over UDS, wait up to 5s for process exit, SIGTERM if still running, wait 2s, SIGKILL if still running
- [ ] In `startProcess()`: add `--control-socket` and `controlSocketPath` to process arguments
- [ ] Store the spawned child's PID (`proc.processIdentifier`) for message validation

**Tests:**
- [ ] Manual: build and run Mac app, verify tugcast connects to UDS and sends `ready`

**Checkpoint:**
- [ ] Xcode build succeeds with no errors
- [ ] Manual: Mac app launches, tugcast connects, `ready` message received, auth URL loaded in WebView

**Rollback:** Remove `ControlSocket.swift`, revert ProcessManager changes.

**Commit after all checkpoints pass.**

---

#### Step 6: Wire onReady in AppDelegate and remove onAuthURL {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugapp): wire onReady callback, replace onAuthURL`

**References:** [D03] Ready message sent after TcpListener bind, [D06] Replace tell with sendControl, Table T06, (#stakeholders, #success-criteria)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift`: use `onReady` instead of `onAuthURL`, remove `serverPort` extraction from URL
- Modified `tugapp/Sources/ProcessManager.swift`: remove `onAuthURL`, expose `onReady`

**Tasks:**
- [ ] In AppDelegate `applicationDidFinishLaunching`: change `processManager.onAuthURL = { ... }` to `processManager.onReady = { ... }`
- [ ] In the callback: keep `self?.window.loadURL(url)` and `self?.runtimeDevMode = ...`
- [ ] Remove `serverPort` extraction from auth URL (no longer needed)
- [ ] Remove `self.serverPort` property declaration
- [ ] In ProcessManager: remove `onAuthURL` property, ensure `onReady` is the public callback

**Tests:**
- [ ] Manual: restart server from Developer menu, verify WebView loads new auth URL only after server is ready

**Checkpoint:**
- [ ] Xcode build succeeds
- [ ] Manual: 5 consecutive restart cycles via Developer > Restart Server, all succeed without connection-refused

**Rollback:** Revert AppDelegate and ProcessManager changes.

**Commit after all checkpoints pass.**

---

#### Step 7: Remove stdout parsing from ProcessManager {#step-7}

**Depends on:** #step-6

**Commit:** `fix(tugapp): remove stdout pipe parsing and auth URL regex`

**References:** [D05] Remove stdout parsing entirely, Table T06, (#context, #symbols)

**Artifacts:**
- Modified `tugapp/Sources/ProcessManager.swift`: remove `authURLPattern`, `pipe.readabilityHandler`, stdout pipe setup

**Tasks:**
- [ ] Remove `authURLPattern` regex property
- [ ] Remove `let pipe = Pipe()` and `proc.standardOutput = pipe` from `startProcess()`
- [ ] Remove the entire `pipe.fileHandleForReading.readabilityHandler` block
- [ ] Set `proc.standardOutput = FileHandle.standardOutput` (pass through for debugging) or leave default

**Tests:**
- [ ] Manual: verify Mac app still receives auth URL via UDS `ready` message

**Checkpoint:**
- [ ] Xcode build succeeds
- [ ] Manual: launch app, verify auth URL loads correctly via UDS path

**Rollback:** Revert ProcessManager changes.

**Commit after all checkpoints pass.**

---

#### Step 8: Replace tell() with sendControl() and migrate Settings card restart {#step-8}

**Depends on:** #step-6

**Commit:** `refactor: replace HTTP tell() with UDS sendControl(); migrate Settings card restart to WebSocket`

**References:** [D06] Replace tell with sendControl, [D12] Settings card uses WebSocket control frame, Table T06, (#symbols)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift`: all menu actions use `sendControl` instead of `tell`
- Modified `tugdeck/src/cards/settings-card.ts`: restart button uses WebSocket control frame instead of HTTP fetch

**Tasks:**

*Part A: AppDelegate migration (Mac app → UDS)*
- [ ] Add `sendControl` private method in AppDelegate that calls `processManager.sendControl(_:params:)`
- [ ] Replace all `tell(...)` calls with `sendControl(...)`:
  - `showSettings`: `sendControl("show-card", params: ["component": "settings"])`
  - `showAbout`: `sendControl("show-card", params: ["component": "about"])`
  - `reloadFrontend`: `sendControl("reload_frontend")`
  - `restartServer`: `sendControl("restart")`
  - `resetEverything`: `sendControl("reset")`
- [ ] Remove the `tell(_:params:)` method entirely
- [ ] Remove `serverPort` property if not already removed in Step 6

*Part B: Settings card migration (frontend → WebSocket control frame)*
- [ ] In `settings-card.ts`, replace the restart button click handler's `fetch("/api/tell", ...)` with `this.connection.sendControlFrame("restart")`. This is a one-line change:
  ```typescript
  // Before:
  fetch("/api/tell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restart" }),
  }).catch((err) => console.error("restart fetch failed:", err));

  // After:
  this.connection.sendControlFrame("restart");
  ```
- [ ] Remove the `.catch()` error handler (WebSocket send is fire-and-forget; errors show in connection close)

**Tests:**
- [ ] Manual: verify all Developer menu actions work (Reload Frontend, Restart Server, Reset Everything)
- [ ] Manual: verify Settings and About menu items work
- [ ] Manual: verify Settings card "Restart Now" button triggers server restart via WebSocket

**Checkpoint:**
- [ ] Xcode build succeeds
- [ ] Manual: all menu actions function correctly
- [ ] Manual: Settings card restart works without HTTP fetch

**Rollback:** Revert AppDelegate and settings-card.ts changes, restore `tell()` method and `fetch`.

**Commit after all checkpoints pass.**

---

#### Step 9: Remove exit code interpretation and fix devPath {#step-9}

**Depends on:** #step-6, #step-7

**Commit:** `fix(tugapp): remove exit code 42/43 handling, fix stale devPath`

**References:** [D07] Remove exit code 42/43 interpretation, [D08] Fix stale devPath by reading UserDefaults directly, Table T06, (#context, #symbols)

**Artifacts:**
- Modified `tugapp/Sources/ProcessManager.swift`: simplified supervisor loop, no stored `devPath`
- Modified `tugapp/Sources/TugConfig.swift`: remove `exitRestart` and `exitReset` constants

**Tasks:**
- [ ] In `ProcessManager.startProcess()` supervisor loop: replace the `switch exitCode` block with simple "process exited" logging; restart logic is now driven by the `restartDecision` state machine (already implemented in Step 5). **Note:** Step 5 introduces the state machine and `handleControlMessage`; this step only removes the old exit code switch and devPath — do not re-introduce pre-state-machine restart logic.
- [ ] Remove `devPath` stored property
- [ ] Modify `start(devMode:sourceTree:)`: only store `sourceTree` (if still needed), remove `devPath` assignment
- [ ] In `startProcess()`: read `UserDefaults.standard.bool(forKey: TugConfig.keyDevModeEnabled)` and `UserDefaults.standard.string(forKey: TugConfig.keySourceTreePath)` directly
- [ ] Build args based on fresh preferences: add `--dev` only if devModeEnabled AND sourceTreePath is set
- [ ] In `TugConfig.swift`: remove `exitRestart` (42) and `exitReset` (43) constants

**Tests:**
- [ ] Manual: toggle dev mode off in Settings, restart, verify tugcast launches without `--dev`
- [ ] Manual: toggle dev mode on, restart, verify tugcast launches with `--dev`

**Checkpoint:**
- [ ] Xcode build succeeds
- [ ] Manual: dev mode toggle + restart works correctly in both directions
- [ ] `grep -r "exitRestart\|exitReset\|exit.*42\|exit.*43" tugapp/Sources/` returns no matches

**Rollback:** Revert ProcessManager and TugConfig changes.

**Commit after all checkpoints pass.**

---

#### Step 10: End-to-end validation and cleanup {#step-10}

**Depends on:** #step-4, #step-8, #step-9

**Commit:** `chore: control socket end-to-end validation`

**References:** [D01] Parent listens child connects, [D03] Ready message sent after TcpListener bind, [D05] Remove stdout parsing entirely, [D06] Replace tell with sendControl, [D07] Remove exit code 42/43 interpretation, [D08] Fix stale devPath, [D09] tugtool CLI uses UDS, [D10] Unified action dispatch, [D11] Termination contract, [D12] Settings card WebSocket restart, (#success-criteria, #exit-criteria)

**Artifacts:**
- No new code; validation and cleanup of any loose ends

**Tasks:**

*Grep verification (no dead code):*
- [ ] Verify `grep -r "println.*tugcast" tugcode/crates/tugcast/src/main.rs` returns no matches
- [ ] Verify `grep -r "AUTH_URL_REGEX\|extract_auth_url" tugcode/crates/tugtool/src/main.rs` returns no matches
- [ ] Verify `grep -r "authURLPattern\|onAuthURL\|exitRestart\|exitReset\|devPath" tugapp/Sources/` returns no matches
- [ ] Verify `grep -r "serverPort" tugapp/Sources/AppDelegate.swift` returns no matches (except comments)
- [ ] Verify `grep -r "tell(" tugapp/Sources/AppDelegate.swift` returns no matches (the method is gone)
- [ ] Verify `grep -r 'fetch.*api/tell' tugdeck/src/` returns no matches (Settings card migrated to WebSocket)

*Action dispatch unity verification:*
- [ ] Verify action classification match blocks are gone from `server.rs:tell_handler` and `router.rs:handle_client` — both call `dispatch_action()`
- [ ] Verify `grep -c "dispatch_action" tugcode/crates/tugcast/src/{server,router,control,actions}.rs` shows exactly 1 definition (actions.rs) and 3 call sites (server.rs, router.rs, control.rs)

*Restart cycle and crash recovery:*
- [ ] Run 10 consecutive restart cycles via Developer > Restart Server; verify zero failures
- [ ] Kill tugcast with `kill -9` (simulating crash); verify Mac app restarts it with backoff
- [ ] Verify backoff resets after successful ready message

*Functional verification:*
- [ ] Test standalone tugcast (without `--control-socket`): verify it starts and serves, logs auth URL via tracing
- [ ] Test `tugtool` CLI: verify it creates UDS, spawns tugcast with `--control-socket`, receives ready, opens browser
- [ ] Test Settings card "Restart Now" button: verify it triggers restart via WebSocket control frame (no HTTP fetch)
- [ ] Verify HTTP `/api/tell` still works for external tools: `curl -X POST http://127.0.0.1:7890/api/tell -d '{"action":"show-card","component":"about"}'`
- [ ] Verify `tugcode tell show-card component=about` still works via HTTP

**Tests:**
- [ ] Integration: 10 restart cycles pass
- [ ] Manual: all menu actions, Settings card actions, and curl commands work
- [ ] Manual: tugtool CLI launch + browser open works

**Checkpoint:**
- [ ] All success criteria from (#success-criteria) verified
- [ ] `cd tugcode && cargo nextest run -p tugcast --test-threads=1` passes
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes
- [ ] Xcode build succeeds with no warnings

**Rollback:** N/A (validation only; fix any issues found in targeted commits).

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tugcast, the Mac app, and the tugtool CLI communicate via a Unix domain socket control channel, eliminating the restart race condition and all stdout-based IPC.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] 10 consecutive server restarts via menu action complete without connection-refused errors
- [ ] No stdout parsing code in ProcessManager.swift (`authURLPattern`, `readabilityHandler`)
- [ ] No stdout parsing code in tugtool CLI (`AUTH_URL_REGEX`, `extract_auth_url`)
- [ ] No exit code 42/43 interpretation in ProcessManager.swift, TugConfig.swift, or tugtool CLI
- [ ] Single `dispatch_action()` function used by HTTP tell_handler, WebSocket control handler, and UDS recv loop — no duplicated action match blocks
- [ ] `tugcast --control-socket /tmp/test.sock` sends `ready` JSON (with pid) after bind when connected to a listener
- [ ] `tugtool` creates UDS listener, passes `--control-socket` to tugcast, receives `ready`, opens browser
- [ ] Dev mode toggle + restart launches tugcast with correct flags (no stale devPath)
- [ ] HTTP `/api/tell` endpoint still functional for `tugcode tell` CLI and external tools
- [ ] All menu actions (About, Settings, Reload, Restart, Reset) work via UDS
- [ ] Settings card "Restart Now" uses WebSocket control frame (no HTTP fetch)
- [ ] Crash recovery: `kill -9` of tugcast causes Mac app to restart it with backoff

**Acceptance tests:**
- [ ] Integration: tugcast CLI parses `--control-socket` flag
- [ ] Integration: `run_server` accepts pre-bound `TcpListener`
- [ ] Integration: `dispatch_action` correctly classifies restart/reset/reload/other actions
- [ ] Integration: tugtool CLI creates UDS, receives ready message
- [ ] Manual: end-to-end restart cycle test (10 iterations)
- [ ] Manual: crash recovery with backoff (kill -9, verify restart)
- [ ] Manual: dev mode toggle persistence across restarts
- [ ] Manual: tugtool CLI launch and browser open
- [ ] Manual: Settings card restart via WebSocket (no HTTP)
- [ ] Integration: single-event restart rule — send `shutdown` then EOF then process exit for same PID, verify only one restart decision is applied

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add optional `instance_id` nonce to ready/shutdown messages for stronger stale-message filtering (PID reuse is theoretically possible over long runtimes)
- [ ] Health monitoring over UDS (periodic heartbeat)
- [ ] Structured logging over UDS (replace stderr forwarding)
- [ ] Hot configuration over UDS (dev mode toggle without restart)
- [ ] Multiple tugcast instance support (already prepared by port-based socket path)
- [ ] Process metrics over UDS (memory, connections, uptime)
- [ ] Make Mac app port configurable (resolves [Q01] port hardcoding)

| Checkpoint | Verification |
|------------|--------------|
| CLI flag accepted | `cargo nextest run -p tugcast` |
| Bind extracted | `cargo build -p tugcast` + manual start |
| Action dispatch unified | `cargo nextest run -p tugcast` + grep for single definition |
| UDS client works | `socat` test + unit tests |
| tugtool CLI updated | `cargo nextest run -p tugtool` + manual launch |
| UDS server works (Mac app) | Mac app launches, receives ready |
| Restart race fixed | 10 restart cycles, zero failures |
| Settings card migrated | grep for `fetch.*api/tell` in tugdeck returns empty |
| Crash recovery works | `kill -9` tugcast, verify restart with backoff |
| Cleanup complete | grep for removed symbols returns empty |

**Commit after all checkpoints pass.**
