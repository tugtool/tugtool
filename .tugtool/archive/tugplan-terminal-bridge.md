## Phase 1.0: Terminal Bridge {#phase-terminal-bridge}

**Purpose:** Deliver the tugcast binary and tugdeck frontend that attach to a tmux session and render it in the browser via xterm.js -- one tugfeed (terminal), one tugcard (terminal). End-to-end proof of the "no drift" architecture.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2025-02-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Claude Code runs as an interactive TUI in a terminal. There is currently no way to "front" a locally-running Claude Code session with a richer interface. tugcast and tugdeck solve this: tugcast is a Rust backend that attaches to a tmux session via PTY and serves the terminal stream over WebSocket; tugdeck is a vanilla TypeScript frontend that renders it with xterm.js. Because tmux is the single source of truth, there is structurally no drift between the real terminal and the web view.

Phase 1 proves the architecture end-to-end with the terminal feed only. Filesystem, git, and stats feeds are deferred to Phase 2 and Phase 3.

#### Strategy {#strategy}

- Build bottom-up: shared types (tugcast-core) first, then server infrastructure, then PTY bridge, then frontend
- The binary frame protocol is implemented once in tugcast-core (Rust) and mirrored in protocol.ts (TypeScript) -- no generated code, but the format is trivial (1-byte feed ID + 4-byte length + payload)
- Auth is implemented early because the WebSocket upgrade path depends on it
- The PTY bridge is the core complexity; it gets its own dedicated step with the BOOTSTRAP/LIVE state machine
- Frontend build is driven by build.rs invoking esbuild, so `cargo build` produces a single self-contained binary
- Integration testing validates the full path: keystroke -> WebSocket -> PTY -> tmux -> PTY -> WebSocket -> xterm.js

#### Stakeholders / Primary Customers {#stakeholders}

1. Claude Code users who want a browser-based view of their terminal session
2. Tugtool developers building toward the multi-feed dashboard (Phase 2+)

#### Success Criteria (Measurable) {#success-criteria}

> From roadmap section 15 -- Phase 1 Acceptance Criteria.

- Keystroke latency: < 10ms end-to-end (key press to PTY write)
- Output latency: < 10ms (PTY read to xterm.js render)
- Reconnect: visible screen state restored within 500ms via capture-pane
- Zero input loss under normal single-client operation
- Escape key arrives identically to native terminal (`\x1b`, no reinterpretation)
- Auth: single-use token exchange, cookie-based session, origin check
- Works with tmux 3.x on macOS and Linux

#### Scope {#scope}

1. `tugcast-core` library crate: Frame type, FeedId enum, StreamFeed/SnapshotFeed traits
2. `tugcast` binary crate: axum server, cookie auth, terminal tugfeed, embedded tugdeck assets
3. `tugdeck` frontend: connection.ts, protocol.ts, deck.ts (single-card layout), cards/terminal-card.ts
4. WebSocket binary frame protocol with feed IDs 0x00 (terminal output), 0x01 (terminal input), 0x02 (terminal resize), 0xFF (heartbeat)
5. Single-use auth token exchange with HttpOnly session cookie and origin check
6. PTY bridge: spawn `tmux attach-session`, async read/write, BOOTSTRAP/LIVE state machine, capture-pane reconnect
7. build.rs integration: esbuild invoked at compile time, assets embedded via rust-embed

#### Non-goals (Explicitly out of scope) {#non-goals}

- Filesystem tugfeed (feed 0x10) -- Phase 2
- Git tugfeed (feed 0x20) -- Phase 2
- Stats tugfeed (feed 0x30) -- Phase 3
- Multi-card CSS Grid layout with resizable panels -- Phase 2
- Stats collectors (process info, token usage, build status) -- Phase 3
- WebGL renderer addon for xterm.js -- Phase 3
- Reconnection UI ("Disconnected" banner, auto-retry) -- Phase 3
- Layout persistence in localStorage -- Phase 3
- Observe-only mode -- Phase 3
- Multiple tmux pane support -- future
- Windows platform support -- not planned

#### Dependencies / Prerequisites {#dependencies}

- tmux 3.x installed on the host system
- Node.js and npm/npx available at build time (for esbuild)
- Rust 1.85+ with the existing cargo workspace
- The roadmap document at `roadmap/component-roadmap.md` as the authoritative design reference

#### Constraints {#constraints}

- macOS and Linux only (no Windows) per AD-6
- Binds exclusively to 127.0.0.1 -- no remote access path per section 8.1
- Single binary output -- tugdeck assets embedded via rust-embed per section 11
- Warnings are errors (`-D warnings` via `.cargo/config.toml`)
- No cross-dependency between tugcast and tugtool crates per AD-5

#### Assumptions {#assumptions}

- The user has tmux 3.x installed and accessible on PATH
- Node.js is available at build time for esbuild (not needed at runtime)
- `pty-process` 0.5.x provides native tokio AsyncRead/AsyncWrite as documented
- The existing cargo workspace at the repo root can be extended with new member crates
- A single WebSocket connection per browser tab is sufficient for Phase 1

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| pty-process crate lacks needed features | high | low | Fall back to portable-pty 0.9.x | If async read/write does not work as expected |
| esbuild in build.rs slows cargo builds | low | medium | Cache build output, skip if unchanged | If incremental builds exceed 2s |
| tmux capture-pane output format varies across versions | medium | low | Pin to tmux 3.x, test on both macOS and Linux | If reconnect snapshot is garbled |

**Risk R01: PTY Crate Compatibility** {#r01-pty-compat}

- **Risk:** `pty-process` 0.5.x may not support all needed PTY operations (resize, signal forwarding) on both platforms.
- **Mitigation:** Verify PTY resize ioctl and tmux resize-pane work in Step 4 before building the full feed router. Fall back to `portable-pty` if needed.
- **Residual risk:** Any PTY crate may have platform-specific edge cases on less common Linux distributions.

**Risk R02: Build Integration Complexity** {#r02-build-integration}

- **Risk:** Invoking esbuild from build.rs adds Node as a build-time dependency and may complicate CI.
- **Mitigation:** build.rs checks for Node/npx availability and provides clear error messages. The esbuild step is fast (<100ms) and well-isolated.
- **Residual risk:** CI environments must have Node installed.

---

### 1.0.0 Design Decisions {#design-decisions}

> These decisions are drawn from the roadmap (sections 2, 5, 8, 13) and user answers. Each records what was decided, not alternatives.

#### [D01] Same workspace, separate binary, no cross-dependency (DECIDED) {#d01-workspace-layout}

**Decision:** tugcast and tugcast-core live in `crates/` alongside tugtool crates. No cross-dependency between tugcast and tugtool. Independent version numbers and release cadence.

**Rationale:**
- Per AD-5 in the roadmap: shared workspace configuration and CI, but separate binaries with separate concerns
- User confirmed: "Add to existing workspace"

**Implications:**
- Workspace Cargo.toml gains two new members: `crates/tugcast`, `crates/tugcast-core`
- tugcast depends on tugcast-core but NOT on tugtool-core or tugtool
- tugcast-core has its own version number starting at 0.1.0

#### [D02] build.rs invokes esbuild for tugdeck (DECIDED) {#d02-build-rs-esbuild}

**Decision:** The tugcast crate's build.rs invokes esbuild to bundle tugdeck TypeScript into a single JS file. `cargo build` is the only command needed.

**Rationale:**
- User confirmed: "build.rs invokes esbuild -- seamless single cargo build command"
- Resolves open question 2 from roadmap section 14
- esbuild is fast (<100ms), so build impact is minimal

**Implications:**
- Node.js and npx must be available at build time
- build.rs sets `OUT_DIR` for the bundled JS and HTML
- rust-embed points at the build output directory

#### [D03] Default tmux session name is 'cc0' (DECIDED) {#d03-session-name}

**Decision:** The default tmux session name is `cc0`. If no `--session` flag is given, tugcast creates or attaches to `cc0`. The session is created if it does not exist, launching `claude` inside.

**Rationale:**
- User confirmed: "Default 'cc0' -- fixed default per roadmap examples"
- Matches roadmap section 9.1 startup sequence examples

**Implications:**
- CLI has `--session <name>` flag that overrides the default
- If `--session` is given and the session exists, tugcast attaches to it
- If `--session` is given and it does not exist, tugcast creates it

#### [D04] Include tracing from the start (DECIDED) {#d04-tracing}

**Decision:** Use the `tracing` crate for structured logging from the first step.

**Rationale:**
- User confirmed: "Yes, include tracing crate from the start for structured logging"
- Roadmap section 10 lists tracing 0.1.x as a key dependency

**Implications:**
- tracing and tracing-subscriber added as workspace dependencies
- All server components emit structured spans and events
- Controlled via RUST_LOG environment variable

#### [D05] Binary WebSocket frame format per roadmap section 6 (DECIDED) {#d05-frame-format}

**Decision:** All WebSocket messages use the binary frame format defined in roadmap section 6.1: 1-byte FeedId + 4-byte big-endian length + variable payload.

**Rationale:**
- Minimal header overhead (5 bytes) for high-throughput terminal data
- Binary format avoids base64 encoding overhead for raw terminal bytes

**Implications:**
- Frame serialization/deserialization implemented in tugcast-core (Rust) and protocol.ts (TypeScript)
- Feed IDs for Phase 1: 0x00 (terminal output), 0x01 (terminal input), 0x02 (terminal resize), 0xFF (heartbeat)
- Feed IDs 0x10, 0x20, 0x30, 0xFE reserved for future phases

#### [D06] Single-use token auth with HttpOnly cookie per roadmap section 8 (DECIDED) {#d06-auth-model}

**Decision:** One-time 32-byte random token exchanged at `GET /auth?token=<T>` for an HttpOnly, SameSite=Strict session cookie. Token invalidated after first use. All subsequent auth via cookie only.

**Rationale:**
- Per AD-3 in the roadmap: minimizes token persistence, prevents replay
- Origin check on WebSocket upgrade prevents cross-origin hijacking

**Implications:**
- Token generated with `rand` crate (cryptographically random)
- Cookie has configurable TTL (default 24 hours)
- WebSocket upgrade handler checks `Origin` header against `http://127.0.0.1:<port>` and `http://localhost:<port>`

#### [D07] PTY bridge with BOOTSTRAP/LIVE state machine per AD-1 (DECIDED) {#d07-pty-state-machine}

**Decision:** Each WebSocket client has a per-client state machine: BOOTSTRAP -> LIVE. On connect/reconnect, tugcast runs `tmux capture-pane -t <session> -p -e` for the snapshot, buffers live PTY output during BOOTSTRAP, flushes buffer after snapshot delivery, then transitions to LIVE.

**Rationale:**
- Per AD-1 in the roadmap: prevents duplicate or out-of-order rendering during active output
- Target: screen restored within 500ms

**Implications:**
- Broadcast channel capacity 4096 messages for terminal stream
- Slow clients that fall behind receive `Lagged` and re-enter BOOTSTRAP
- `tmux capture-pane -p -e` preserves ANSI escapes for correct xterm.js rendering

#### [D08] Native tmux input multiplexing per AD-2 (DECIDED) {#d08-tmux-multiplexing}

**Decision:** All keyboard input from tugdeck passes through to the PTY as raw bytes. tmux handles input multiplexing natively. No custom arbitration, no writer-lease, no locking.

**Rationale:**
- Per AD-2 and AD-7 in the roadmap: tmux natively supports multiple clients sending input simultaneously
- tugdeck is a terminal emulator, not a sandbox -- all keys including Ctrl-C, Ctrl-D, Escape pass through

**Implications:**
- Terminal input frames (0x01) are written directly to PTY AsyncWrite
- Resize frames (0x02) trigger both PTY ioctl and `tmux resize-pane`

#### [D09] Bind to 127.0.0.1 only (DECIDED) {#d09-localhost-bind}

**Decision:** tugcast binds exclusively to 127.0.0.1. No configuration option for 0.0.0.0.

**Rationale:**
- Per section 8.1 of the roadmap: local-first security, no remote access path
- Remote access, if needed, goes through an external tunnel (SSH, Tailscale)

**Implications:**
- axum server binds to `127.0.0.1:<port>` only
- Port default TBD (roadmap example uses 7890)

---

### 1.0.1 WebSocket Protocol Specification {#ws-protocol}

> Extracted from roadmap section 6.

#### Frame Format {#frame-format}

```
+----------+----------+-----------------+
| FeedId   | Length   | Payload         |
| (1 byte) | (4 bytes)| (variable)      |
|          | big-end. |                 |
+----------+----------+-----------------+
```

**Table T01: Phase 1 Feed IDs** {#t01-feed-ids}

| ID | TugFeed | Direction | Payload |
|----|---------|-----------|---------|
| `0x00` | Terminal output | tugcast -> tugdeck | Raw bytes (ANSI) |
| `0x01` | Terminal input | tugdeck -> tugcast | Raw bytes (keystrokes) |
| `0x02` | Terminal resize | tugdeck -> tugcast | JSON `{"cols": N, "rows": N}` |
| `0xFF` | Heartbeat | Bidirectional | Empty (keepalive) |

#### Protocol Invariants {#protocol-invariants}

- Terminal output frames (0x00) are sent immediately, no accumulation. Latency target: <5ms from PTY read to WebSocket send.
- Heartbeat: both sides send every 15 seconds. Connection torn down if no heartbeat received within 45 seconds.
- Within a feed, frames are ordered. Across feeds, no ordering guarantee.
- All keyboard input including Ctrl-C, Ctrl-D, Escape forwarded as raw bytes.

---

### 1.0.2 Terminal Feed State Machine {#terminal-state-machine}

> Extracted from roadmap sections 5.2 and AD-1.

**Spec S01: Per-Client State Machine** {#s01-client-state-machine}

```
    connect / reconnect / Lagged
            |
            v
      +-----------+
      | BOOTSTRAP |  -- tugcast runs `tmux capture-pane -t <session> -p -e`
      |           |  -- live PTY output buffered for this client
      +-----------+
            |
      snapshot sent + buffer flushed
            |
            v
      +-----------+
      |   LIVE    |  -- frames forwarded directly from broadcast channel
      +-----------+
            |
      broadcast Lagged (client fell behind 4096-message buffer)
            |
            v
      (back to BOOTSTRAP)
```

- BOOTSTRAP: snapshot is captured and sent first, then buffered live output is flushed
- LIVE: frames flow directly from the broadcast channel
- Lagged: client transitions back to BOOTSTRAP for a capture-pane resync
- Target: screen restored within 500ms on reconnect

---

### 1.0.3 Repo Layout (Phase 1) {#repo-layout}

> Derived from roadmap section 4.1, scoped to Phase 1 only.

**Spec S02: Phase 1 File Structure** {#s02-file-structure}

```
tugtool/
+-- crates/
|   +-- tugcast/                  # Binary crate
|   |   +-- Cargo.toml
|   |   +-- build.rs              # Invokes esbuild to bundle tugdeck
|   |   +-- src/
|   |       +-- main.rs           # Entry point: parse args, boot server
|   |       +-- cli.rs            # clap argument definitions
|   |       +-- server.rs         # axum server setup, static asset serving
|   |       +-- router.rs         # Feed router: multiplex/demux WebSocket frames
|   |       +-- auth.rs           # Token generation, cookie validation, origin check
|   |       +-- feeds/
|   |           +-- mod.rs        # Feed registry, startup orchestration
|   |           +-- terminal.rs   # Terminal tugfeed: PTY <-> tmux bridge
|   |
|   +-- tugcast-core/             # Library crate
|       +-- Cargo.toml
|       +-- src/
|           +-- lib.rs            # Public exports
|           +-- protocol.rs       # Frame format, feed IDs, serialization
|           +-- feed.rs           # StreamFeed + SnapshotFeed trait definitions
|
+-- tugdeck/                      # Frontend (TypeScript)
|   +-- package.json
|   +-- tsconfig.json
|   +-- index.html                # Single-page shell
|   +-- src/
|       +-- main.ts               # Entry: WebSocket connect, card orchestration
|       +-- connection.ts         # WebSocket lifecycle, auth
|       +-- protocol.ts           # Frame parse/serialize (mirrors tugcast-core)
|       +-- deck.ts               # Layout manager (single-card for Phase 1)
|       +-- cards/
|           +-- card.ts           # Base TugCard interface
|           +-- terminal-card.ts  # xterm.js terminal card
|
+-- Cargo.toml                    # Workspace root (extended with new members)
```

---

### 1.0.4 Symbol Inventory {#symbol-inventory}

#### 1.0.4.1 New crates {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugcast-core` | Shared types: Frame, FeedId, StreamFeed/SnapshotFeed traits |
| `tugcast` | Binary: axum server, auth, terminal feed, feed router |

#### 1.0.4.2 New files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugcast-core/src/lib.rs` | Public exports for tugcast-core |
| `crates/tugcast-core/src/protocol.rs` | Frame struct, FeedId enum, serialization/deserialization |
| `crates/tugcast-core/src/feed.rs` | StreamFeed and SnapshotFeed trait definitions |
| `crates/tugcast/src/main.rs` | Entry point: CLI parsing, server boot, PTY spawn |
| `crates/tugcast/src/cli.rs` | clap definitions: --session, --port, --dir, --open |
| `crates/tugcast/src/server.rs` | axum router: static assets, /auth endpoint, /ws upgrade |
| `crates/tugcast/src/router.rs` | Feed router: per-client state machine, frame multiplex/demux |
| `crates/tugcast/src/auth.rs` | Token generation, cookie set/validate, origin check |
| `crates/tugcast/src/feeds/mod.rs` | Feed registry and startup orchestration |
| `crates/tugcast/src/feeds/terminal.rs` | Terminal feed: PTY spawn, async read/write, tmux integration |
| `crates/tugcast/build.rs` | Invokes esbuild to bundle tugdeck, sets OUT_DIR |
| `tugdeck/package.json` | Node dependencies (xterm.js, esbuild) |
| `tugdeck/tsconfig.json` | TypeScript configuration |
| `tugdeck/index.html` | Single-page HTML shell |
| `tugdeck/src/main.ts` | Entry point: connect WebSocket, mount terminal card |
| `tugdeck/src/connection.ts` | WebSocket lifecycle, reconnect, cookie auth |
| `tugdeck/src/protocol.ts` | Frame parse/serialize mirroring tugcast-core |
| `tugdeck/src/deck.ts` | Layout manager: single-card (terminal fills viewport) |
| `tugdeck/src/cards/card.ts` | TugCard interface definition |
| `tugdeck/src/cards/terminal-card.ts` | xterm.js terminal card implementation |

#### 1.0.4.3 Symbols to add {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FeedId` | enum | `tugcast-core/src/protocol.rs` | TerminalOutput=0x00, TerminalInput=0x01, TerminalResize=0x02, Heartbeat=0xFF |
| `Frame` | struct | `tugcast-core/src/protocol.rs` | { feed_id: FeedId, payload: Vec<u8> } |
| `Frame::encode` | fn | `tugcast-core/src/protocol.rs` | Serialize to wire format (1+4+payload bytes) |
| `Frame::decode` | fn | `tugcast-core/src/protocol.rs` | Deserialize from wire bytes |
| `StreamFeed` | trait | `tugcast-core/src/feed.rs` | feed_id(), name(), run(tx, cancel) |
| `SnapshotFeed` | trait | `tugcast-core/src/feed.rs` | feed_id(), name(), run(tx, cancel) |
| `TerminalFeed` | struct | `tugcast/src/feeds/terminal.rs` | Implements StreamFeed; PTY bridge |
| `ClientState` | enum | `tugcast/src/router.rs` | Bootstrap, Live |
| `FeedRouter` | struct | `tugcast/src/router.rs` | Manages per-client state and frame dispatch |
| `AuthState` | struct | `tugcast/src/auth.rs` | Holds token, session map, cookie config |
| `TugCard` | interface | `tugdeck/src/cards/card.ts` | feedIds, mount, onFrame, onResize, destroy |
| `TerminalCard` | class | `tugdeck/src/cards/terminal-card.ts` | Implements TugCard with xterm.js |
| `TugConnection` | class | `tugdeck/src/connection.ts` | WebSocket lifecycle and frame dispatch |
| `encodeFrame` | fn | `tugdeck/src/protocol.ts` | Serialize Frame to binary |
| `decodeFrame` | fn | `tugdeck/src/protocol.ts` | Deserialize Frame from binary |

---

### 1.0.5 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test Frame encode/decode, FeedId mapping, auth token generation | Protocol types, auth logic |
| **Integration** | Test PTY spawn + tmux attach, WebSocket round-trip, full server boot | End-to-end paths |
| **Golden / Contract** | Verify wire frame format matches spec exactly | Protocol compliance |

#### Test Dependencies {#test-dependencies}

- Integration tests require tmux installed and available
- PTY tests require a Unix-like environment (macOS or Linux)
- WebSocket tests use tokio test runtime

---

### 1.0.6 Execution Steps {#execution-steps}

> Each step produces a compilable, testable increment. Steps build bottom-up from shared types to full integration.

#### Step 0: Scaffold crates and workspace {#step-0}

**Commit:** `feat(tugcast): scaffold tugcast-core and tugcast crates`

**References:** [D01] Workspace layout, [D04] Tracing, Spec S02, (#repo-layout, #new-crates, #new-files, #strategy)

**Artifacts:**
- `crates/tugcast-core/Cargo.toml` with dependencies: serde, tokio, async-trait, tokio-util
- `crates/tugcast-core/src/lib.rs` with placeholder exports
- `crates/tugcast/Cargo.toml` with dependencies: axum, tokio, pty-process, clap, rand, tower-http, rust-embed, tracing, tracing-subscriber, tugcast-core
- `crates/tugcast/src/main.rs` with minimal `fn main()`
- `crates/tugcast/src/cli.rs` with clap definitions for --session, --port, --dir, --open
- Updated workspace `Cargo.toml` to include new members
- tracing and tracing-subscriber added to workspace dependencies

**Tasks:**
- [ ] Create `crates/tugcast-core/` directory with Cargo.toml and src/lib.rs
- [ ] Create `crates/tugcast/` directory with Cargo.toml and src/main.rs, src/cli.rs
- [ ] Set `version = "0.1.0"` in both new Cargo.toml files (do NOT use `version.workspace = true` -- tugcast has independent versioning per [D01])
- [ ] Add `"crates/tugcast"` and `"crates/tugcast-core"` to workspace members in root Cargo.toml
- [ ] Add new workspace dependencies: tokio, axum, async-trait, pty-process, rand, tower-http, rust-embed, tracing, tracing-subscriber, tokio-util
- [ ] Implement clap CLI definitions in cli.rs: --session (default "cc0"), --port (default 7890), --dir (default "."), --open (flag)
- [ ] Wire up tracing-subscriber in main.rs with RUST_LOG support

**Tests:**
- [ ] Unit test: `cargo build -p tugcast-core` compiles with no warnings
- [ ] Unit test: `cargo build -p tugcast` compiles with no warnings
- [ ] Unit test: CLI parsing tests for default values and overrides

**Checkpoint:**
- [ ] `cargo build --workspace` succeeds with no warnings
- [ ] `cargo nextest run` passes (existing tugtool tests unaffected)
- [ ] `cargo run -p tugcast -- --help` prints usage

**Rollback:**
- Revert commit, remove crate directories, restore original Cargo.toml

**Commit after all checkpoints pass.**

---

#### Step 1: Implement tugcast-core protocol types {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugcast-core): implement Frame, FeedId, and wire protocol`

**References:** [D05] Frame format, Table T01, Spec S01, (#frame-format, #protocol-invariants, #ws-protocol, #symbols)

**Artifacts:**
- `crates/tugcast-core/src/protocol.rs` -- FeedId enum, Frame struct, encode/decode methods
- `crates/tugcast-core/src/lib.rs` -- updated public exports

**Tasks:**
- [ ] Define `FeedId` enum with variants: TerminalOutput(0x00), TerminalInput(0x01), TerminalResize(0x02), Heartbeat(0xFF)
- [ ] Implement `FeedId::from_byte(u8) -> Option<FeedId>` and `FeedId::as_byte(&self) -> u8`
- [ ] Define `Frame` struct: `{ feed_id: FeedId, payload: Vec<u8> }`
- [ ] Implement `Frame::encode(&self) -> Vec<u8>`: 1-byte feed_id + 4-byte big-endian length + payload
- [ ] Implement `Frame::decode(bytes: &[u8]) -> Result<(Frame, usize), ProtocolError>`: parse from wire bytes, return frame and bytes consumed
- [ ] Define `ProtocolError` enum for decode failures (incomplete, invalid feed ID, payload too large)
- [ ] Set maximum payload size constant (e.g., 1MB) to prevent memory exhaustion

**Tests:**
- [ ] Unit test: round-trip encode/decode for each FeedId variant
- [ ] Unit test: decode with empty payload
- [ ] Unit test: decode with maximum payload size
- [ ] Unit test: decode with invalid feed ID returns error
- [ ] Unit test: decode with truncated header returns incomplete error
- [ ] Golden test: verify exact wire bytes for known frames match section 6.1 format

**Checkpoint:**
- [ ] `cargo build -p tugcast-core` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast-core` -- all protocol tests pass

**Rollback:**
- Revert commit, remove protocol.rs

**Commit after all checkpoints pass.**

---

#### Step 2: Implement feed traits {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcast-core): define StreamFeed and SnapshotFeed traits`

**References:** [D07] PTY state machine, (#terminal-state-machine, #symbols)

**Artifacts:**
- `crates/tugcast-core/src/feed.rs` -- StreamFeed and SnapshotFeed trait definitions
- `crates/tugcast-core/src/lib.rs` -- updated exports

**Tasks:**
- [ ] Define `StreamFeed` trait with methods: `feed_id() -> FeedId`, `name() -> &str`, `async run(tx: broadcast::Sender<Frame>, cancel: CancellationToken)`
- [ ] Define `SnapshotFeed` trait with methods: `feed_id() -> FeedId`, `name() -> &str`, `async run(tx: watch::Sender<Frame>, cancel: CancellationToken)`
- [ ] Use `#[async_trait]` for async trait methods (note: native `async fn` in traits is stable in edition 2024, but `async_trait` is required here for dyn-compatibility / object safety -- the feed router needs `Box<dyn StreamFeed>` and `Box<dyn SnapshotFeed>`, which is not possible with native async trait methods)
- [ ] Re-export Frame, FeedId, StreamFeed, SnapshotFeed from lib.rs

**Tests:**
- [ ] Unit test: compile-time verification that traits are object-safe (create `Box<dyn StreamFeed>` and `Box<dyn SnapshotFeed>`)

**Checkpoint:**
- [ ] `cargo build -p tugcast-core` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast-core` -- all tests pass

**Rollback:**
- Revert commit, remove feed.rs

**Commit after all checkpoints pass.**

---

#### Step 3: Implement auth module {#step-3}

**Depends on:** #step-0

**Commit:** `feat(tugcast): implement single-use token auth with cookie session`

**References:** [D06] Auth model, [D09] Localhost bind, (#design-decisions, #protocol-invariants)

**Artifacts:**
- `crates/tugcast/src/auth.rs` -- token generation, validation, cookie management, origin check

**Tasks:**
- [ ] Generate 32-byte cryptographically random token using `rand` crate, hex-encode to 64-character string
- [ ] Implement `AuthState` struct holding: pending token (Option), active sessions (HashMap of session_id -> expiry), cookie TTL config
- [ ] Implement `GET /auth?token=<T>` handler: validate token, generate session ID, set `HttpOnly; SameSite=Strict; Path=/` cookie, invalidate token (set to None), respond with 302 redirect to `/`
- [ ] Implement session validation middleware: extract session cookie, check against active sessions, reject expired sessions
- [ ] Implement origin check function: validate `Origin` header is `http://127.0.0.1:<port>` or `http://localhost:<port>`
- [ ] Use `Arc<Mutex<AuthState>>` for shared mutable state (single-threaded access pattern, minimal contention)

**Tests:**
- [ ] Unit test: token generation produces 64-character hex string
- [ ] Unit test: token validation succeeds on first use, fails on second use
- [ ] Unit test: cookie is set with correct attributes (HttpOnly, SameSite, Path)
- [ ] Unit test: origin check accepts valid origins, rejects invalid origins
- [ ] Unit test: expired sessions are rejected

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all auth tests pass

**Rollback:**
- Revert commit, remove auth.rs

**Commit after all checkpoints pass.**

---

#### Step 4: Implement terminal feed (PTY bridge) {#step-4}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tugcast): implement terminal tugfeed with PTY-tmux bridge`

**References:** [D07] PTY state machine, [D08] Tmux multiplexing, Spec S01, Risk R01, (#terminal-state-machine, #strategy)

**Artifacts:**
- `crates/tugcast/src/feeds/mod.rs` -- feed registry module
- `crates/tugcast/src/feeds/terminal.rs` -- TerminalFeed struct implementing StreamFeed

**Tasks:**
- [ ] Implement tmux session management: check if session exists (`tmux has-session -t <name>`), create if not (`tmux new-session -d -s <name> -- claude`), verify tmux version >= 3.0
- [ ] Spawn PTY running `tmux attach-session -t <name>` using `pty-process`
- [ ] Implement async read loop: read PTY output in chunks, wrap in Frame(FeedId::TerminalOutput, data), send on broadcast::Sender
- [ ] Implement async write receiver: receive Frame(FeedId::TerminalInput) from mpsc channel, write payload to PTY AsyncWrite
- [ ] Implement resize handler: on Frame(FeedId::TerminalResize), parse JSON `{"cols": N, "rows": N}`, call PTY resize ioctl, run `tmux resize-pane -t <session> -x <cols> -y <rows>`
- [ ] Implement `capture_pane(session: &str) -> Vec<u8>`: run `tmux capture-pane -t <session> -p -e` and return output bytes
- [ ] Implement StreamFeed trait: feed_id returns TerminalOutput, run() starts the read/write loops with CancellationToken
- [ ] Use tracing spans for PTY read/write operations

**Tests:**
- [ ] Integration test: spawn PTY with `tmux attach-session`, verify output bytes are received (requires tmux)
- [ ] Integration test: write bytes to PTY input, verify they arrive at tmux session
- [ ] Integration test: send resize event, verify PTY dimensions change
- [ ] Unit test: capture_pane returns non-empty output for an active session
- [ ] Unit test: verify FeedId mapping for terminal feed

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all terminal feed tests pass (tmux must be installed)
- [ ] Manual test: run terminal feed in isolation, verify bytes flow from tmux to broadcast channel

**Rollback:**
- Revert commit, remove feeds/ directory

**Commit after all checkpoints pass.**

---

#### Step 5: Implement feed router and WebSocket handler {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `feat(tugcast): implement feed router with per-client BOOTSTRAP/LIVE state machine`

**References:** [D05] Frame format, [D07] PTY state machine, [D08] Tmux multiplexing, Spec S01, Table T01, (#terminal-state-machine, #protocol-invariants, #ws-protocol)

**Artifacts:**
- `crates/tugcast/src/router.rs` -- FeedRouter struct, per-client state machine, WebSocket frame dispatch

**Tasks:**
- [ ] Define `ClientState` enum: Bootstrap { buffer: Vec<Frame> }, Live
- [ ] Implement `FeedRouter` struct holding: broadcast::Sender<Frame> for terminal stream, mpsc::Sender<Frame> for terminal input, reference to TerminalFeed for capture_pane
- [ ] Implement per-client WebSocket handler:
  - On connect: enter Bootstrap state, call capture_pane(), send snapshot as Frame(TerminalOutput), flush buffered frames, transition to Live
  - In Live state: forward frames from broadcast receiver to WebSocket
  - On Lagged: transition back to Bootstrap, repeat snapshot
- [ ] Implement inbound frame handler: read binary WebSocket messages, decode Frame, dispatch:
  - TerminalInput (0x01): forward to terminal feed mpsc channel
  - TerminalResize (0x02): forward to terminal feed resize handler
  - Heartbeat (0xFF): update last-seen timestamp
- [ ] Implement heartbeat: send heartbeat frame every 15 seconds, tear down connection if no heartbeat received within 45 seconds
- [ ] Validate Origin header on WebSocket upgrade using auth module's origin check

**Tests:**
- [ ] Integration test: connect WebSocket, verify BOOTSTRAP snapshot is received first
- [ ] Integration test: send input frame, verify it reaches terminal feed's mpsc channel
- [ ] Integration test: verify heartbeat frames are sent at correct interval
- [ ] Unit test: ClientState transitions (Bootstrap -> Live, Live -> Bootstrap on Lagged)

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all router tests pass

**Rollback:**
- Revert commit, remove router.rs

**Commit after all checkpoints pass.**

---

#### Step 6: Implement axum server and static asset serving {#step-6}

**Depends on:** #step-5, #step-7

**Commit:** `feat(tugcast): implement axum server with static assets and WebSocket upgrade`

**References:** [D02] build.rs esbuild, [D06] Auth model, [D09] Localhost bind, Spec S02, (#repo-layout, #strategy)

**Artifacts:**
- `crates/tugcast/src/server.rs` -- axum server setup, routes, static asset handler
- `crates/tugcast/src/main.rs` -- updated to wire everything together

**Tasks:**
- [ ] Set up axum Router with routes:
  - `GET /` -- serve index.html from embedded assets
  - `GET /auth?token=<T>` -- auth token exchange (from auth module)
  - `GET /ws` -- WebSocket upgrade (validates cookie, hands off to router)
  - `GET /*path` -- serve static assets (JS, CSS) from embedded directory
- [ ] Use `rust-embed` to embed tugdeck build output directory
- [ ] Implement static asset handler with correct Content-Type headers
- [ ] Wire up auth middleware for /ws route
- [ ] Bind to `127.0.0.1:<port>` using tokio::net::TcpListener
- [ ] Print startup message with auth URL: `tugcast: http://127.0.0.1:<port>/auth?token=<T>`
- [ ] Optionally open browser with `open` (macOS) or `xdg-open` (Linux) if --open flag is set
- [ ] Wire main.rs: parse CLI, init tracing, create tmux session, start terminal feed, start server

**Tests:**
- [ ] Integration test: boot server, GET / returns HTML
- [ ] Integration test: GET /auth with valid token sets cookie and redirects
- [ ] Integration test: GET /ws without cookie returns 401/403
- [ ] Integration test: GET /ws with valid cookie upgrades to WebSocket

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` -- all server tests pass
- [ ] Manual test: `cargo run -p tugcast` boots, prints URL, serves HTML at /

**Rollback:**
- Revert commit, restore previous main.rs

**Commit after all checkpoints pass.**

---

#### Step 7: Scaffold tugdeck frontend and build integration {#step-7}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): scaffold TypeScript project with esbuild and build.rs integration`

**References:** [D02] build.rs esbuild, Spec S02, Risk R02, (#repo-layout, #new-files)

**Artifacts:**
- `tugdeck/package.json` -- project definition with xterm.js and esbuild dependencies
- `tugdeck/tsconfig.json` -- TypeScript configuration
- `tugdeck/index.html` -- single-page HTML shell
- `tugdeck/src/main.ts` -- placeholder entry point
- `crates/tugcast/build.rs` -- invokes esbuild to bundle tugdeck, copies index.html to output

**Tasks:**
- [ ] Create `tugdeck/package.json` with dependencies: @xterm/xterm, @xterm/addon-fit, @xterm/addon-web-links, and devDependency: esbuild
- [ ] Create `tugdeck/tsconfig.json` with strict mode, ES2020 target, module bundler resolution
- [ ] Create `tugdeck/index.html` with minimal HTML shell: viewport meta, link to app.css (xterm.js CSS), script tag for app.js
- [ ] Create `tugdeck/src/main.ts` with placeholder: `console.log("tugdeck loaded")`
- [ ] Implement `crates/tugcast/build.rs`:
  - Run `npm install` in tugdeck/ (if node_modules missing)
  - Run `npx esbuild tugdeck/src/main.ts --bundle --outfile=<OUT_DIR>/tugdeck/app.js --minify --target=es2020`
  - Copy `tugdeck/index.html` to `<OUT_DIR>/tugdeck/index.html`
  - Copy xterm.js CSS to `<OUT_DIR>/tugdeck/app.css`
  - Set `cargo:rerun-if-changed` for tugdeck/src/ and tugdeck/index.html
**Tests:**
- [ ] Unit test: `cargo build -p tugcast` succeeds (verifies build.rs runs esbuild)
- [ ] Unit test: build output directory contains index.html, app.js, and app.css

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] Build output contains bundled tugdeck assets
- [ ] `npm install` in tugdeck/ succeeds
- [ ] `npx esbuild` in tugdeck/ succeeds independently

**Rollback:**
- Revert commit, remove tugdeck/ directory and build.rs

**Commit after all checkpoints pass.**

---

#### Step 8: Implement tugdeck protocol and connection {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): implement WebSocket protocol and connection management`

**References:** [D05] Frame format, [D06] Auth model, Table T01, (#frame-format, #protocol-invariants, #ws-protocol)

**Artifacts:**
- `tugdeck/src/protocol.ts` -- Frame type, encodeFrame, decodeFrame mirroring tugcast-core
- `tugdeck/src/connection.ts` -- TugConnection class: WebSocket lifecycle, frame dispatch

**Tasks:**
- [ ] Implement `protocol.ts`:
  - Define FeedId constants: TERMINAL_OUTPUT=0x00, TERMINAL_INPUT=0x01, TERMINAL_RESIZE=0x02, HEARTBEAT=0xFF
  - Define Frame interface: { feedId: number, payload: Uint8Array }
  - Implement `encodeFrame(frame: Frame): ArrayBuffer` -- 1-byte feed ID + 4-byte big-endian length + payload
  - Implement `decodeFrame(data: ArrayBuffer): Frame` -- parse binary WebSocket message
- [ ] Implement `connection.ts`:
  - `TugConnection` class with constructor taking WebSocket URL
  - Connect to `ws://<host>/ws` (cookie is sent automatically by browser)
  - Register `onmessage` handler: decode binary frame, dispatch to registered callbacks by feed ID
  - Implement `send(feedId: number, payload: Uint8Array)`: encode and send frame
  - Implement `onFrame(feedId: number, callback: (payload: Uint8Array) => void)`: register per-feed callback
  - Implement heartbeat: send HEARTBEAT every 15 seconds
  - Handle WebSocket close/error events with logging

**Tests:**
- [ ] Unit test: encodeFrame/decodeFrame round-trip for each feed ID
- [ ] Unit test: encodeFrame produces correct wire bytes for known inputs
- [ ] Unit test: decodeFrame handles empty payload

**Checkpoint:**
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds with no errors
- [ ] `cargo build -p tugcast` succeeds (build.rs bundles updated tugdeck)

**Rollback:**
- Revert commit, restore placeholder main.ts

**Commit after all checkpoints pass.**

---

#### Step 9: Implement tugdeck terminal card and deck layout {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tugdeck): implement terminal card with xterm.js and single-card deck layout`

**References:** [D07] PTY state machine, [D08] Tmux multiplexing, Table T01, (#terminal-state-machine, #symbols)

**Artifacts:**
- `tugdeck/src/cards/card.ts` -- TugCard interface definition
- `tugdeck/src/cards/terminal-card.ts` -- TerminalCard class with xterm.js
- `tugdeck/src/deck.ts` -- DeckManager: single-card layout, frame dispatch
- `tugdeck/src/main.ts` -- updated to wire connection, deck, and terminal card

**Tasks:**
- [ ] Implement `cards/card.ts`:
  - Define TugCard interface: feedIds, mount(container), onFrame(feedId, payload), onResize(width, height), destroy()
- [ ] Implement `cards/terminal-card.ts`:
  - TerminalCard implements TugCard
  - feedIds: [0x00] (subscribes to terminal output)
  - mount(): create xterm.js Terminal instance with FitAddon and WebLinksAddon
  - onFrame(0x00, payload): call terminal.write(payload)
  - Register terminal.onData(data => connection.send(0x01, encode(data))) for keystrokes
  - Register terminal.onResize(({cols, rows}) => connection.send(0x02, encode({cols, rows}))) for resize
  - onResize(): call fitAddon.fit() to resize terminal to container
  - destroy(): dispose terminal instance
- [ ] Implement `deck.ts`:
  - DeckManager class: creates a single full-viewport container
  - Registers TugCard instances
  - Dispatches incoming frames to cards by feed ID
  - Handles window resize events, propagating to cards
- [ ] Update `main.ts`:
  - Create TugConnection
  - Create DeckManager
  - Create TerminalCard, register with deck
  - Mount deck to document body
- [ ] Update `index.html` with correct asset references and basic styling for full-viewport terminal

**Tests:**
- [ ] Unit test: TugCard interface is correctly implemented by TerminalCard (TypeScript compilation check)
- [ ] Unit test: DeckManager dispatches frames to correct card

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings (build.rs bundles complete tugdeck)
- [ ] `npx esbuild tugdeck/src/main.ts --bundle` succeeds with no errors

**Rollback:**
- Revert commit, restore previous tugdeck files

**Commit after all checkpoints pass.**

---

#### Step 10: End-to-end integration and acceptance {#step-10}

**Depends on:** #step-6, #step-9

**Commit:** `feat(tugcast): end-to-end integration tests and acceptance criteria verification`

**References:** [D03] Session name, [D07] PTY state machine, [D08] Tmux multiplexing, [D09] Localhost bind, (#success-criteria, #protocol-invariants, #terminal-state-machine)

**Artifacts:**
- Integration test suite in `crates/tugcast/tests/` or as part of existing test infrastructure
- Updated README or inline documentation for running tugcast

**Tasks:**
- [ ] Implement end-to-end test: boot tugcast with a test tmux session, open WebSocket connection, verify terminal output arrives
- [ ] Implement input test: send keystroke frame via WebSocket, verify it appears in tmux session output
- [ ] Implement reconnect test: disconnect WebSocket, reconnect, verify capture-pane snapshot is received
- [ ] Implement auth test: verify token exchange flow end-to-end (GET /auth -> cookie -> WebSocket upgrade)
- [ ] Implement origin check test: verify WebSocket upgrade is rejected with wrong Origin header
- [ ] Verify acceptance criteria from roadmap section 15:
  - Keystroke latency: < 10ms (measure time from WebSocket send to PTY write)
  - Output latency: < 10ms (measure time from PTY read to WebSocket send)
  - Reconnect: visible screen state restored within 500ms
  - Zero input loss under normal operation
  - Escape key: verify `\x1b` arrives as-is
  - Auth: single-use token, cookie session, origin check all verified
  - tmux 3.x: verify `tmux -V` check
- [ ] Implement graceful shutdown test: send SIGINT, verify WebSocket close frames are sent and PTY is dropped (tmux session survives)
- [ ] Add documentation comments to all public types and functions

**Tests:**
- [ ] Integration test: full WebSocket round-trip (output arrives, input accepted)
- [ ] Integration test: reconnect bootstrap (capture-pane snapshot received)
- [ ] Integration test: auth flow end-to-end
- [ ] Integration test: origin check rejection
- [ ] Integration test: graceful shutdown (tmux session survives)

**Checkpoint:**
- [ ] `cargo build --workspace` succeeds with no warnings
- [ ] `cargo nextest run` -- all tests pass (workspace-wide)
- [ ] `cargo clippy --workspace -- -D warnings` passes
- [ ] Manual test: launch `cargo run -p tugcast`, open auth URL in browser, see tmux terminal in xterm.js, type commands, verify output appears
- [ ] Manual test: refresh browser page, verify terminal state is restored (BOOTSTRAP)
- [ ] Manual test: close tugcast (Ctrl-C), verify tmux session `cc0` still exists

**Rollback:**
- Revert commit

**Commit after all checkpoints pass.**

---

### 1.0.7 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A working tugcast binary that attaches to a tmux session and renders it in tugdeck via xterm.js -- one tugfeed (terminal), one tugcard (terminal). Single binary with embedded frontend assets. End-to-end proof of the "no drift" architecture.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build -p tugcast` produces a single binary with embedded tugdeck assets
- [ ] Running `tugcast` creates/attaches to tmux session `cc0` and prints auth URL
- [ ] Opening the auth URL in a browser shows a full-viewport xterm.js terminal mirroring the tmux session
- [ ] Keystrokes in the browser terminal arrive at Claude Code in the tmux session
- [ ] Output from Claude Code appears in the browser terminal in real-time
- [ ] Refreshing the browser restores terminal state via capture-pane (BOOTSTRAP)
- [ ] Closing tugcast (Ctrl-C) leaves the tmux session alive
- [ ] `cargo clippy --workspace -- -D warnings` passes with zero warnings
- [ ] All acceptance criteria from roadmap section 15 are met

**Acceptance tests:**
- [ ] Integration test: full round-trip keystroke -> PTY -> tmux -> PTY -> WebSocket -> xterm.js
- [ ] Integration test: reconnect bootstrap with capture-pane snapshot
- [ ] Integration test: auth token exchange and cookie session
- [ ] Integration test: origin check rejects cross-origin WebSocket upgrade

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 2: Filesystem tugfeed (0x10) and Git tugfeed (0x20) with multi-card CSS Grid layout
- [ ] Phase 3: Stats tugfeed (0x30), reconnection UI, layout persistence, WebGL renderer
- [ ] Multiple tmux pane support (multiple terminal tugfeeds)
- [ ] Observe-only mode for tugdeck

| Checkpoint | Verification |
|------------|--------------|
| Crates compile | `cargo build --workspace` with no warnings |
| All tests pass | `cargo nextest run` |
| Clippy clean | `cargo clippy --workspace -- -D warnings` |
| Manual smoke test | Launch tugcast, open browser, type in terminal, see output |

**Commit after all checkpoints pass.**
