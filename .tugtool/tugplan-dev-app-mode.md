## Phase 1.0: Dev Mode + App Mode {#phase-dev-app-mode}

**Purpose:** Implement a five-phase strategy that transforms tugtool from a terminal-only developer tool into a Mac application with seamless dev mode toggling, live reload, dock controls, and distribution. Phase 1 (Dev Serve) eliminates cargo rebuilds for frontend changes; Phase 2 (Live Reload) adds automatic browser refresh; Phase 3 (Dock Controls) extends WebSocket protocol for restart/reset; Phase 4 (Mac App) delivers a native AppKit shell; Phase 5 (Distribution) handles signing, notarization, and nightly builds.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | dev-app-mode |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-19 (rev 3: final hardening) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Every frontend change to tugdeck currently requires a full `cargo build -p tugcast` because tugcast serves embedded assets via rust-embed. This means even trivial CSS tweaks trigger a Rust compilation cycle. The roadmap at `roadmap/dev-app-mode-roadmap.md` describes a five-phase strategy to solve this: dev mode serving from disk, live reload, WebSocket-based server controls, a native Mac application shell, and distribution tooling.

The mono-repo at `/u/src/tugtool` contains the Rust workspace (`tugcode/`), the TypeScript frontend (`tugdeck/`), the Claude Code plugin (`tugplug/`), and the protocol bridge (`tugtalk/`). The tugtool launcher binary already resolves the tugcast sibling path and manages the child process lifecycle. This plan builds incrementally on that foundation.

#### Strategy {#strategy}

- Phase 1 (Dev Serve): Add `--dev <path>` to tugcast to serve assets from disk via `tower_http::services::ServeDir`, and add `--dev` to the tugtool launcher to auto-detect the source tree, spawn `bun dev`, spawn `tugcast --dev`, and open the browser
- Phase 2 (Live Reload): Watch the dev path with `notify`, add an SSE endpoint `GET /dev/reload`, and inject a reload script into `index.html` at serve time when `--dev` is active
- Phase 3 (Dock Controls): Extend the tugcast-core WebSocket protocol with `Control` feed ID and restart/reset message types; wire tugdeck dock menu to send these commands
- Phase 4 (Mac App): Create a minimal `tugapp/` directory with an xcodeproj, AppKit-based `WKWebView` shell (~300 lines Swift in 3 files), `ProcessManager` for tugcast lifecycle, and a Developer menu with dev mode toggle
- Phase 5 (Distribution): Code signing with Developer ID, notarization, DMG via `hdiutil`, and nightly CI with different icon/bundle ID (`dev.tugtool.nightly`)
- Each phase ships independently and delivers incremental value
- The existing `claude --plugin-dir tugplug` workflow remains unaffected throughout

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool developers working on tugdeck frontend (immediate beneficiaries of dev mode)
2. End users who want a double-click Mac application experience
3. CI/CD pipeline for automated nightly builds

#### Success Criteria (Measurable) {#success-criteria}

- Phase 1: `tugtool --dev` spawns `bun dev` + `tugcast --dev`, and editing a `.ts` file in tugdeck produces the updated output in the browser after a manual refresh, with zero cargo rebuilds (`cargo build` invocation count = 0 for frontend-only changes)
- Phase 2: Saving a `.ts` or `.css` file in tugdeck causes the browser to reload automatically within 2 seconds without manual intervention
- Phase 3: Sending a restart command from the tugdeck dock menu causes tugcast to restart and reconnect within 5 seconds
- Phase 4: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` succeeds, and the resulting `.app` launches, displays the tugdeck dashboard via WKWebView, and the Developer menu toggles dev mode
- Phase 5: `tugcode/scripts/build-app.sh` produces a signed, notarized DMG that passes `spctl --assess`

#### Scope {#scope}

1. `tugcast --dev <path>` flag with `ServeDir` fallback in `build_app`
2. `tugtool --dev` orchestration: source tree detection, `bun dev` spawning, `tugcast --dev` spawning, browser open, signal handling for both child processes
3. `notify`-based file watcher on dev path with SSE endpoint and reload script injection
4. New `FeedId::Control` (0xC0) in tugcast-core protocol with restart/reset message types
5. Tugdeck TypeScript client-side logic for sending control messages and handling SSE reload events
6. `tugapp/` directory with xcodeproj, 3 Swift source files, assets, entitlements
7. `tugcode/scripts/build-app.sh` for signing, notarization, DMG creation
8. Nightly CI configuration with alternate icon and bundle ID

#### Non-goals (Explicitly out of scope) {#non-goals}

- Hot module replacement (HMR) for TypeScript -- we use full page reload via SSE, not Vite-style HMR
- Automatic Rust backend hot-reload -- Rust changes still require explicit `cargo build` and manual or menu-driven restart
- iOS or iPad support
- App Store distribution (direct download DMG only)
- Homebrew formula changes (existing `scripts/release.sh` continues to work unchanged)

#### Dependencies / Prerequisites {#dependencies}

- `tower-http` crate with `features = ["fs"]` must be re-added to workspace dependencies (was previously removed as dead code)
- `notify` crate already available in workspace (used by filesystem feed)
- `bun` must be installed for dev mode (runtime dependency, not build dependency)
- Xcode command line tools for Phase 4/5
- Apple Developer ID Application certificate for Phase 5 code signing

#### Constraints {#constraints}

- Warnings are errors: `-D warnings` enforced via `tugcode/.cargo/config.toml`
- Mac app targets macOS 13.0+ (Ventura) as minimum deployment target
- AppKit only, no SwiftUI (per user requirement)
- All new FeedId values must not conflict with existing allocations (0x00-0x02, 0x10, 0x20, 0x30-0x33, 0x40-0x41, 0xFF)
- `index.html` has CSP `script-src 'self'` — no inline scripts allowed; all injected scripts must be served as separate files from the same origin
- `tmux` is a runtime dependency for both dev mode and app mode; the app must check for it at startup and show a clear error if missing
- Existing `tugcode/scripts/release.sh` (not root `scripts/`) handles Rust/Homebrew releases; new `tugcode/scripts/build-app.sh` handles Mac app builds

#### Assumptions {#assumptions}

- `tower-http` dependency will be added to `workspace.dependencies` in the root `Cargo.toml` with `features = ["fs"]`
- Phase 1 is the immediate priority and can be implemented independently of later phases
- The `notify` crate is already available and working (used by filesystem feed)
- Auto-run of `bun install` when `node_modules/` is missing will be blocking with a progress indicator
- Toggling dev mode off will restart tugcast immediately (without `--dev` flag)
- Nightly builds will have an orange/amber icon variant and `dev.tugtool.nightly` bundle ID
- Code signing will use standard Apple Developer ID Application certificate
- DMG creation will use standard `hdiutil create` with UDZO compression
- The xcodeproj will target macOS 13.0+ (Ventura) as minimum deployment target

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Binary watch auto-restart vs manual restart (OPEN) {#q01-binary-watch}

**Question:** Should the Mac app automatically restart tugcast when it detects the debug binary has changed (from a `cargo build` in another terminal), or require manual restart via the Developer menu?

**Why it matters:** Auto-restart could cause disruption if a build is partial or the binary is being written when the watcher fires. Manual restart is safer but slower.

**Options (if known):**
- Auto-restart with a brief debounce (1-2 seconds after mtime change)
- Show a subtle "Server outdated -- restart?" indicator and let the user click
- Default to manual, configurable via UserDefaults preference

**Plan to resolve:** Implement manual restart first (Phase 3). Revisit auto-restart as a follow-on after user experience with manual flow.

**Resolution:** DEFERRED (implement manual restart in Phase 3, revisit auto-restart as Phase 4 polish)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `ServeDir` serves stale files if bun dev crashes | med | low | Error handling detects bun crash, shows warning | bun dev crash reports in practice |
| Port conflicts when multiple instances run | med | med | Detect port-in-use, offer to kill stale process | User reports of port 7890 conflicts |
| WKWebView security restrictions block localhost | high | low | Disable ATS for both `localhost` and `127.0.0.1` via `NSAppTransportSecurity` / `NSExceptionDomains` in Info.plist (two separate exception domain entries, each with `NSExceptionAllowsInsecureHTTPLoads = YES`); set `WKWebViewConfiguration.limitsNavigationsToAppBoundDomains = false`; verify cookie/origin behavior on a clean machine with both hostnames | Testing on first macOS 13 build |
| Notarization failures delay distribution | med | med | Test signing/notarization early in Phase 5 | First CI nightly attempt |

**Risk R01: ServeDir race with bun rebuilds** {#r01-servedir-race}

- **Risk:** A browser request arrives while bun is mid-write to `dist/app.js`, serving a partial file
- **Mitigation:** bun writes to a temp file and atomically renames; ServeDir serves whatever is on disk; the live reload SSE event fires after bun finishes, so the reload happens after the write completes
- **Residual risk:** On extremely slow filesystems, a narrow race window remains; a manual refresh resolves it

**Risk R02: Two child process management complexity** {#r02-two-children}

- **Risk:** Managing two child processes (bun dev + tugcast) in the tugtool launcher increases signal handling complexity
- **Mitigation:** Use a process group (PGID) so a single SIGTERM to the group kills both; alternatively, kill each child explicitly in sequence
- **Residual risk:** Zombie processes if tugtool is SIGKILL'd without graceful shutdown

**Risk R03: Step 3/4 shared plumbing boundary** {#r03-step-boundary}

- **Risk:** Steps 3 and 4 both modify `router.rs` and `main.rs` (Step 3 adds shutdown channel + Control handler; Step 4 wires SSE broadcast sender into the same shared state). Overlapping plumbing changes risk temporary compilation drift if the shared state struct shape changes between steps
- **Mitigation:** Step 3 defines the `AppState` struct with `shutdown_tx` and an `Option<broadcast::Sender>` field (set to `None`). Step 4 only fills that `Option` — no struct shape changes needed. This clean boundary means Step 3 compiles and tests independently
- **Residual risk:** Low — the `Option` field is a minor dead-code warning candidate; suppress with `#[allow(dead_code)]` and a `// wired in Step 4` comment

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] ServeDir fallback for dev mode (DECIDED) {#d01-servedir-fallback}

**Decision:** When `--dev <path>` is provided, `build_app` in `server.rs` uses `tower_http::services::ServeDir` as the fallback service instead of the `serve_asset` function that serves from rust-embed.

**Rationale:**
- `ServeDir` handles content-type detection, range requests, and caching headers automatically
- It reads from disk on every request, so changes from `bun dev` are picked up without any restart
- The existing `serve_asset` function with rust-embed remains the default for production/app mode

**Implications:**
- `tower-http` with `fs` feature must be added to workspace dependencies and to `tugcast/Cargo.toml`
- `build_app` signature changes to accept `Option<PathBuf>` for the dev path
- `run_server` signature changes to pass through the dev path
- The `content_type_for` helper and `Assets` struct remain for production mode
- **Important API distinction:** `ServeDir` is a tower `Service`, not an axum handler, so the dev mode branch must use `.fallback_service(ServeDir::new(path))` while the production branch continues to use `.fallback(serve_asset)`. Using `.fallback()` with `ServeDir` will not compile
- Existing integration tests in `integration_tests.rs` call `build_app(feed_router)` -- they must be updated to pass `None` for the new `dev_path` parameter to avoid a build-breaking arity mismatch
- **Dev path target:** The `--dev <path>` argument points at `tugdeck/dist/`, which must be assembled as a flat directory mirroring the production embed layout (`app.js`, `index.html`, CSS files, fonts — all at the same level). The `index.html` and CSS files reference assets at root-relative paths (`app.js`, `tokens.css`, etc.), so a flat structure is mandatory. See D02 for how the dev assembly script handles this

#### [D02] tugtool --dev flag with source tree auto-detection (DECIDED) {#d02-tugtool-dev-flag}

**Decision:** Add `--dev` flag to the tugtool launcher. When set, it auto-detects the mono-repo root by walking up from `cwd` looking for `tugdeck/`, assembles the dev dist directory, spawns `bun dev` as a child process in the `tugdeck/` directory, spawns `tugcast --dev <tugdeck/dist>`, and opens the browser. An optional `--source-tree <path>` flag overrides the auto-detection. The launcher runs as a **supervisor loop** that restarts tugcast on special exit codes.

**Rationale:**
- One command (`tugtool --dev`) replaces the multi-step manual workflow
- Auto-detection works for developers who run from within the repo
- Explicit `--source-tree` handles edge cases (running from outside the repo)
- Supervisor loop is required because the `restart` and `reset` control actions (D04) cause tugcast to exit — the parent must detect this and respawn

**Dev asset assembly:** The `dev` script in `package.json` runs two parallel watchers: (1) a `dev:assets` script that performs an initial copy of `index.html`, CSS files (`tokens.css`, `cards.css`, `cards-chrome.css`, `dock.css`), xterm CSS (`node_modules/@xterm/xterm/css/xterm.css` as `app.css`), and fonts to `tugdeck/dist/`, then watches these source files and re-copies on change; and (2) `bun build --watch` to rebuild `app.js` into `dist/`. Both run continuously so that CSS/HTML edits land in `dist/` and trigger a live reload just like TS edits. The `dev:assets` watcher is a small bun script (`tugdeck/scripts/watch-assets.ts`) using `fs.watch` on the source HTML, CSS, and font files. This mirrors the flat directory layout that `build.rs` creates for production embedding.

**Supervisor exit code contract:**
- Exit code **42**: restart requested — supervisor restarts tugcast immediately (same flags)
- Exit code **43**: reset requested — supervisor clears caches, then restarts tugcast
- Any other exit code: real exit — supervisor shuts down bun dev and exits with same code
- This contract applies identically to the Mac app's `ProcessManager` (D05)

**Implications:**
- tugtool Cli struct gets two new fields: `dev: bool` and `source_tree: Option<PathBuf>`
- tugtool must manage two child processes (bun dev + tugcast) with coordinated shutdown
- `spawn_tugcast` needs to pass `--dev <path>` when dev mode is active
- When `node_modules/` is missing, tugtool runs `bun install` before `bun dev`
- `wait_for_shutdown` in tugtool's `main.rs` must be replaced with a supervisor loop that checks exit codes rather than exiting immediately
- Modified `tugdeck/package.json` to add `dev:assets` script for flat dist assembly

#### [D03] SSE-based live reload (DECIDED) {#d03-sse-reload}

**Decision:** In dev mode, tugcast watches `tugdeck/dist/` with `notify`, exposes an SSE endpoint at `GET /dev/reload`, serves a static `/dev/reload.js` script, and injects a `<script src="/dev/reload.js">` tag into the `index.html` response.

**Rationale:**
- SSE is simpler than WebSocket for a one-directional "reload now" signal
- The same pattern is used by Vite, esbuild serve, and other dev tools
- Injection at serve time means no build-time changes to tugdeck are needed
- The SSE endpoint only exists when `--dev` is active; zero overhead in production

**CSP compliance:** The existing `index.html` has a Content-Security-Policy meta tag with `script-src 'self'` which **blocks inline scripts**. The reload mechanism must not use inline JS. Instead, tugcast serves a static file at `/dev/reload.js` containing `new EventSource("/dev/reload").onmessage = () => location.reload();` and injects `<script src="/dev/reload.js"></script>` into the index.html response. This satisfies CSP because the script is loaded from the same origin (`'self'`).

**File watching target:** The watcher monitors `tugdeck/dist/` (the assembled dev directory, not the source tree). **Extension filter:** only changes to `.html`, `.css`, and `.js` files trigger a reload event; font files and other assets are ignored to reduce noise. Debounce at 300ms to coalesce rapid writes (e.g., when `dev:assets` copies multiple CSS files in quick succession). This means the SSE reload fires after `bun dev` finishes writing `app.js`, or after a CSS re-copy completes.

**Implications:**
- A new `dev.rs` module in tugcast handles the SSE endpoint, `/dev/reload.js` serving, and file watcher
- `build_app` adds `/dev/reload` and `/dev/reload.js` routes only when `dev_path` is `Some`
- The `index.html` injection appends `<script src="/dev/reload.js"></script>` before `</body>` (not inline JS)
- `axum::response::sse` module used for SSE streaming
- `/dev/reload` and `/dev/reload.js` are unauthenticated, localhost-only, dev-mode-only endpoints

#### [D04] Control feed ID in WebSocket protocol (DECIDED) {#d04-control-feed}

**Decision:** Add `FeedId::Control = 0xC0` to the tugcast-core protocol. Control frames carry JSON payloads with an `action` field: `"restart"`, `"reset"`, or `"reload_frontend"`. These are sent from tugdeck to tugcast.

**Rationale:**
- Using the existing binary frame protocol avoids introducing a separate control channel
- `0xC0` (decimal 192) fits within u8 range (0-255) and is compatible with the `#[repr(u8)]` attribute on the `FeedId` enum
- `0xC0` is in the unused range (existing feeds use 0x00-0x02, 0x10, 0x20, 0x30-0x33, 0x40-0x41, 0xFF) and is semantically distinct from data feeds
- JSON payload allows future extension with additional control actions

**Implications:**
- `FeedId` enum in `tugcast-core/src/protocol.rs` gets a new variant
- `from_byte` and `as_byte` implementations updated
- Router's client message handler adds a `FeedId::Control` match arm
- Tugdeck TypeScript client adds methods to send control frames

#### [D05] AppKit WKWebView shell (DECIDED) {#d05-appkit-shell}

**Decision:** The Mac app is built with AppKit (not SwiftUI), using `WKWebView` to display the tugdeck dashboard served by tugcast on `127.0.0.1:7890`. Three Swift files: `AppDelegate.swift` (lifecycle, Developer menu), `MainWindow.swift` (WKWebView setup), `ProcessManager.swift` (spawn/monitor tugcast).

**Rationale:**
- AppKit provides full control over menus, window management, and process lifecycle
- WKWebView is a thin shell; the real UI is tugdeck's web frontend
- ~300 lines of Swift keeps the app minimal and maintainable
- `ProcessManager` encapsulates child process spawn/kill/restart logic

**Implications:**
- New `tugapp/` directory at repo root with xcodeproj and Swift sources
- App bundles tugcast, tugcode, and tugtalk binaries in `Contents/MacOS/`
- Developer menu is hidden by default, shown when dev mode is enabled
- Source tree path stored in `UserDefaults` with folder picker on first use

#### [D06] Distribution via signed DMG with nightly variant (DECIDED) {#d06-distribution}

**Decision:** Distribution uses a signed, notarized DMG created by `tugcode/scripts/build-app.sh`. Nightly builds use bundle ID `dev.tugtool.nightly` with an orange/amber icon variant, allowing side-by-side installation with the stable release (`dev.tugtool.app`).

**Rationale:**
- DMG is the standard macOS distribution format for direct downloads
- Separate bundle IDs allow both stable and nightly to be installed simultaneously (Safari Technology Preview model)
- `hdiutil create` with UDZO compression is reliable and scriptable
- Notarization prevents Gatekeeper warnings

**Implications:**
- `tugcode/scripts/build-app.sh` performs: `cargo build --release`, `bun build`, assemble `.app`, `codesign`, `xcrun notarytool submit`, `hdiutil create`
- CI needs Apple Developer ID credentials (certificate + notarization password)
- Two icon variants in `Assets.xcassets` (standard + nightly/orange)
- CI determines which bundle ID and icon to use based on build type

---

### 1.0.1 Architecture Overview {#architecture-overview}

**Diagram Diag01: Dev Mode + App Mode Architecture** {#diag01-architecture}

```
tugtool --dev                          Tug.app
    |                                      |
    v                                      v
[source tree auto-detect]           [ProcessManager.swift]
    |                                      |
    +-- spawn bun dev (tugdeck/)     +-- spawn tugcast [--dev]
    |                                |     |
    +-- spawn tugcast --dev <path>   +-- WKWebView -> 127.0.0.1:7890
    |                                |
    +-- open browser                 +-- Developer Menu
                                          |
                                          +-- Enable Dev Mode (toggle)
                                          +-- Reload Frontend (Cmd+R)
                                          +-- Restart Server (Cmd+Shift+R)
                                          +-- Reset Everything (Cmd+Opt+R)

tugcast server.rs build_app(router, dev_path):
    dev_path is Some?
        YES -> .fallback_service(ServeDir::new(path))  [tower Service]
               + /dev/reload SSE endpoint
               + index.html script injection
        NO  -> .fallback(serve_asset)  [axum handler, rust-embed]
```

---

### 1.0.2 Error Handling Scenarios {#error-scenarios}

**Table T01: Dev Mode Error Scenarios** {#t01-error-scenarios}

| Scenario | Detection | User-Facing Message | Recovery |
|----------|-----------|---------------------|----------|
| Source tree missing/moved | `!path.exists()` | "Source tree not found at /old/path. Choose a new location?" | Folder picker |
| `tugdeck/` not in source tree | `!path.join("tugdeck").exists()` | "No tugdeck/ directory found in {path}. Is this the right source tree?" | Folder picker |
| `bun` not installed | `which bun` fails | "bun is required for Dev Mode but was not found in PATH. Install it from https://bun.sh" | Dev mode stays off |
| `bun dev` crashes | Child process exit code != 0 | "Frontend watcher exited unexpectedly. Restart it?" | Restart/Dismiss buttons |
| Port 7890 in use | `TcpListener::bind` fails | "Port 7890 is already in use. Another instance of tugcast may be running." | Kill stale process or pick different port |
| `node_modules/` missing | `!path.join("tugdeck/node_modules").exists()` | "Installing dependencies..." | Auto-run `bun install`, blocking with indicator |
| `tmux` not installed | `which tmux` fails | "tmux is required but was not found in PATH. Install it with: brew install tmux" | App/launcher stays off until resolved |

---

### 1.0.3 Protocol Extension {#protocol-extension}

**Spec S01: Control Frame Protocol** {#s01-control-frame}

The Control feed uses `FeedId::Control = 0xC0` with JSON payloads:

```json
{"action": "restart"}
{"action": "reset"}
{"action": "reload_frontend"}
```

Direction: tugdeck -> tugcast (client to server only).

**Behavior per action:**

| Action | Server Response | Exit Code | Side Effects |
|--------|----------------|-----------|--------------|
| `restart` | Send exit code 42 on shutdown channel; main performs orderly shutdown then exits 42 | 42 | Parent supervisor detects code 42, restarts tugcast with same flags |
| `reset` | Send exit code 43 on shutdown channel; main performs orderly shutdown then exits 43 | 43 | Parent supervisor detects code 43, clears caches, restarts tugcast; client clears localStorage before sending |
| `reload_frontend` | Send SSE reload event (dev mode only) | N/A (no exit) | Triggers page reload for all connected clients. **Stub/no-op** until Step 4 wires the SSE broadcast sender. Always no-op in production mode (no `--dev`) |

**Shutdown channel pattern:** Control handlers never call `std::process::exit` directly. Instead, `main()` creates a `tokio::sync::mpsc::channel<u8>(1)` (the "shutdown channel") and passes the `Sender` to the router via shared state. When a restart/reset action arrives, the handler sends the exit code on this channel. `main()` holds the `Receiver` and `select!`s on it alongside the server future. On receiving an exit code, `main()` performs orderly shutdown: close WebSocket connections, flush logs, release PTY handles, drop the `notify` watcher, then calls `std::process::exit(code)`. This ensures async destructors run and no resources leak.

**Exit code contract** (shared by tugtool supervisor and Mac app ProcessManager):
- **42** = restart requested — respawn tugcast immediately with same arguments
- **43** = reset requested — clear caches/state, then respawn tugcast
- **Any other code** = real exit — propagate to parent, stop supervisor loop

---

### 1.0.4 Symbol Inventory {#symbol-inventory}

#### 1.0.4.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/scripts/watch-assets.ts` | Continuous dev asset watcher: copies HTML/CSS/fonts to dist/ on change |
| `tugdeck/scripts/dev.ts` | Dev entry point: spawns both watch-assets and bun build --watch via Bun.spawn |
| `tugcode/crates/tugcast/src/dev.rs` | Dev mode: SSE reload endpoint, file watcher, index.html injection |
| `tugapp/Sources/AppDelegate.swift` | App lifecycle, Developer menu, dev mode toggle |
| `tugapp/Sources/MainWindow.swift` | WKWebView setup and configuration |
| `tugapp/Sources/ProcessManager.swift` | Spawn/monitor/restart tugcast child process |
| `tugapp/Tug.xcodeproj/` | Xcode project for building the Mac app |
| `tugapp/Tug.entitlements` | Hardened runtime entitlements (allow unsigned exec) |
| `tugapp/Info.plist` | App bundle metadata |
| `tugapp/Assets.xcassets/` | App icons (standard + nightly variant) |
| `tugcode/scripts/build-app.sh` | Build, sign, notarize, create DMG |

#### 1.0.4.2 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FeedId::Control` | enum variant | `tugcast-core/src/protocol.rs` | `= 0xC0` |
| `build_app` | fn (modify) | `tugcast/src/server.rs` | Add `dev_path: Option<PathBuf>` parameter |
| `run_server` | fn (modify) | `tugcast/src/server.rs` | Add `dev_path: Option<PathBuf>` parameter |
| `Cli::dev` | field | `tugcast/src/cli.rs` | `Option<PathBuf>` -- `--dev <path>` flag |
| `Cli::dev` | field | `tugtool/src/main.rs` | `bool` -- `--dev` flag |
| `Cli::source_tree` | field | `tugtool/src/main.rs` | `Option<PathBuf>` -- `--source-tree <path>` |
| `dev_reload_handler` | fn (`pub(crate)`) | `tugcast/src/dev.rs` | SSE endpoint handler for `/dev/reload` |
| `dev_file_watcher` | fn (`pub(crate)`) | `tugcast/src/dev.rs` | `notify`-based watcher, sends to SSE broadcast, returns `Sender` |
| `inject_reload_script` | fn (private) | `tugcast/src/dev.rs` | Append `<script src="/dev/reload.js">` before `</body>` (not inline — CSP) |
| `serve_dev_index` | fn (`pub(crate)`) | `tugcast/src/dev.rs` | Serve index.html with injected reload script tag |
| `serve_dev_reload_js` | fn (`pub(crate)`) | `tugcast/src/dev.rs` | Serve static `/dev/reload.js` file (CSP-safe reload client) |
| `AppState` | struct | `tugcast/src/main.rs` | Shared state: `shutdown_tx: mpsc::Sender<u8>`, `reload_tx: Option<broadcast::Sender<()>>` — passed to router as `Extension` |
| `detect_source_tree` | fn | `tugtool/src/main.rs` | Walk up from cwd looking for `tugdeck/` |
| `spawn_bun_dev` | fn | `tugtool/src/main.rs` | Spawn `bun dev` as child process |
| `shutdown_children` | fn | `tugtool/src/main.rs` | Graceful shutdown of multiple child processes |
| `controlFrame` | fn | `tugdeck/src/protocol.ts` | Factory: creates Control frame with JSON action payload |
| `sendControlFrame` | method | `tugdeck/src/connection.ts` | Wrapper on `TugConnection.send` for control actions |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Add tower-http dependency and tugcast --dev flag {#step-0}

**Commit:** `feat(tugcast): add --dev flag and tower-http ServeDir for dev mode asset serving`

**References:** [D01] ServeDir fallback for dev mode, (#d01-servedir-fallback, #architecture-overview, #symbol-inventory)

**Artifacts:**
- Modified `tugcode/Cargo.toml` (workspace dependency)
- Modified `tugcode/crates/tugcast/Cargo.toml` (crate dependency)
- Modified `tugcode/crates/tugcast/src/cli.rs` (new `--dev` flag)
- Modified `tugcode/crates/tugcast/src/server.rs` (`build_app` with `ServeDir` fallback)
- Modified `tugcode/crates/tugcast/src/main.rs` (pass dev_path through)
- Modified `tugcode/crates/tugcast/src/integration_tests.rs` (update `build_test_app` to pass `None` for new `dev_path` parameter)

**Tasks:**
- [ ] Add `tower-http = { version = "0.6", features = ["fs"] }` to `[workspace.dependencies]` in `tugcode/Cargo.toml`
- [ ] Add `tower-http = { workspace = true }` to `[dependencies]` in `tugcode/crates/tugcast/Cargo.toml`
- [ ] Add `dev: Option<PathBuf>` field with `#[arg(long)]` to `Cli` struct in `tugcast/src/cli.rs`
- [ ] Modify `build_app` in `server.rs` to accept `dev_path: Option<PathBuf>` and use `.fallback_service(ServeDir::new(path))` when `dev_path` is `Some`, keeping `.fallback(serve_asset)` otherwise. Note: `ServeDir` is a tower `Service`, not a handler, so use `fallback_service` (not `fallback`) for the dev mode branch
- [ ] Modify `run_server` to accept and pass through `dev_path: Option<PathBuf>`
- [ ] Update `main.rs` to pass `cli.dev` to `run_server`
- [ ] Add `use tower_http::services::ServeDir;` import in `server.rs`
- [ ] Update `build_test_app` helper in `integration_tests.rs` (line 37) to pass `None` as the `dev_path` argument: `build_app(feed_router, None)` -- this is required because the existing tests call `build_app(feed_router)` with the old single-argument arity, and the build will fail without this fix

**Tests:**
- [ ] Unit test: `test_cli_dev_flag_none` -- default CLI has no `--dev`
- [ ] Unit test: `test_cli_dev_flag_some` -- `--dev /tmp/dist` parses correctly
- [ ] Integration test: `test_build_app_dev_mode` -- `build_app` with `Some(path)` returns a Router that serves files from disk
- [ ] Integration test: `test_build_app_production_mode` -- `build_app` with `None` returns a Router that serves embedded assets

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes all tests
- [ ] `tugcast --dev /tmp/test-dir` starts and serves files from `/tmp/test-dir`

**Rollback:**
- Revert `tower-http` additions from both Cargo.toml files
- Revert `cli.rs`, `server.rs`, `main.rs` changes

**Commit after all checkpoints pass.**

---

#### Step 1: tugtool --dev launcher orchestration {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugtool): add --dev mode with source tree detection, bun dev spawning, and dual child process management`

**References:** [D02] tugtool --dev flag with source tree auto-detection, Table T01, (#d02-tugtool-dev-flag, #error-scenarios, #architecture-overview)

**Artifacts:**
- Modified `tugcode/crates/tugtool/src/main.rs` (new flags, source tree detection, bun dev spawning, supervisor loop, multi-child shutdown)
- New `tugdeck/scripts/watch-assets.ts` (continuous asset watcher/copier for dev mode)
- Modified `tugdeck/package.json` (add `dev:assets` watcher script, update `dev` to run both watchers in parallel)

**Tasks:**
- [ ] Add `dev: bool` field with `#[arg(long)]` to tugtool `Cli` struct
- [ ] Add `source_tree: Option<PathBuf>` field with `#[arg(long)]` to tugtool `Cli` struct
- [ ] Implement `detect_source_tree()` function: walk up from cwd checking for `tugdeck/` directory; return `PathBuf` of the mono-repo root or error
- [ ] Create `tugdeck/scripts/watch-assets.ts`: a bun script that (a) performs an initial copy of `index.html`, CSS files (`tokens.css`, `cards.css`, `cards-chrome.css`, `dock.css`), xterm CSS (`node_modules/@xterm/xterm/css/xterm.css` → `dist/app.css`), and fonts to `dist/`, then (b) watches these source files with `fs.watch` and re-copies on change. If `fs.watch` fails or is unavailable, fall back to a 1-second polling loop (`fs.stat` mtime comparison) and log a warning. This runs continuously alongside `bun build --watch` so that CSS/HTML edits land in `dist/` and trigger live reload
- [ ] Add `"dev:assets"` script to `tugdeck/package.json` that runs `bun run scripts/watch-assets.ts`. Add a `"dev"` script that spawns both watchers from a single bun entry point (e.g., a small `scripts/dev.ts` that calls `Bun.spawn` for each, avoiding shell `&` for portability)
- [ ] Implement `spawn_bun_dev(source_tree: &Path)` function: check for `node_modules/`, run `bun install` if missing (blocking with progress output), then spawn `bun run dev` in `tugdeck/` with stdout/stderr inherited
- [ ] Modify `spawn_tugcast` to accept optional dev path and pass `--dev <path>` when present (the path should be `<source_tree>/tugdeck/dist`)
- [ ] Replace `wait_for_shutdown` with a **supervisor loop**: when tugcast exits with code 42 (restart), respawn it with same flags; when it exits with code 43 (reset), clear caches and respawn; on any other exit code, shut down bun dev and exit. This replaces the current one-shot `std::process::exit(code)` pattern
- [ ] Implement `shutdown_children()` that sends SIGTERM to both child processes (bun dev and tugcast) and waits with timeout, falling back to SIGKILL
- [ ] Handle error scenarios from Table T01: source tree not found, tugdeck/ missing, bun not installed, tmux not installed, node_modules/ missing

**Tests:**
- [ ] Unit test: `test_cli_dev_flag` -- `--dev` flag parses as boolean
- [ ] Unit test: `test_cli_source_tree_flag` -- `--source-tree /path` parses correctly
- [ ] Unit test: `test_detect_source_tree_validation` -- verify the function checks for `tugdeck/` directory existence

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugtool` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugtool` passes all tests
- [ ] From within the mono-repo: `tugtool --dev` auto-detects source tree, spawns bun dev, spawns tugcast with --dev, opens browser; Ctrl+C kills both

**Rollback:**
- Revert changes to `tugtool/src/main.rs`

**Commit after all checkpoints pass.**

---

#### Step 2: Live reload SSE endpoint and script injection {#step-2}

**Depends on:** #step-0

**Commit:** `feat(tugcast): add live reload via SSE endpoint and index.html script injection in dev mode`

**References:** [D03] SSE-based live reload, (#d03-sse-reload, #architecture-overview, #symbol-inventory)

**Artifacts:**
- New `tugcode/crates/tugcast/src/dev.rs` (SSE handler, file watcher, injection logic)
- Modified `tugcode/crates/tugcast/src/main.rs` (register `dev` module, start watcher)
- Modified `tugcode/crates/tugcast/src/server.rs` (add SSE route and custom index handler in dev mode)

**Tasks:**
- [ ] Create `tugcode/crates/tugcast/src/dev.rs` module. All handler functions (`dev_reload_handler`, `serve_dev_reload_js`, `serve_dev_index`) and the `ReloadBroadcast` type must be `pub(crate)` so that `server.rs` can reference them via `crate::dev::dev_reload_handler` etc.
- [ ] Implement `pub(crate) async fn dev_reload_handler` as an SSE endpoint using `axum::response::sse::Sse` that holds connection open and sends `data: reload\n\n` when notified
- [ ] Implement `pub(crate) async fn serve_dev_reload_js` that serves the static string `new EventSource("/dev/reload").onmessage = () => location.reload();` with content-type `application/javascript`. This is a separate file (not inline) to satisfy the CSP `script-src 'self'` policy in `index.html`
- [ ] Implement `pub(crate) fn dev_file_watcher` using `notify::RecommendedWatcher` to watch the dev dist path (`tugdeck/dist/`). **Extension filter:** only fire reload for `.html`, `.css`, and `.js` file changes; ignore font files and other assets to reduce noise. Debounce at 300ms to coalesce rapid writes (e.g., when the asset watcher copies multiple CSS files). On qualifying change events, broadcast to all connected SSE clients via a `tokio::sync::broadcast` channel. Return the broadcast `Sender` so it can be shared with the router for `reload_frontend` control actions (see Step 3)
- [ ] Implement `inject_reload_script` (private to dev.rs) that reads `index.html` from disk and appends `<script src="/dev/reload.js"></script>` before `</body>` (NOT inline JS — CSP blocks inline scripts)
- [ ] Implement `pub(crate) async fn serve_dev_index` route handler that serves the modified index.html (with injection) while all other files are served by `ServeDir`
- [ ] In `build_app`, when `dev_path` is `Some`: add `.route("/dev/reload", get(crate::dev::dev_reload_handler))`, `.route("/dev/reload.js", get(crate::dev::serve_dev_reload_js))`, and `.route("/", get(crate::dev::serve_dev_index))` before the `.fallback_service(ServeDir::new(path))` fallback
- [ ] Register `mod dev;` in `main.rs`
- [ ] Start the file watcher task in `main()` when dev mode is active, passing the broadcast sender

**Tests:**
- [ ] Unit test: `test_inject_reload_script` -- verify `<script src="/dev/reload.js"></script>` tag is correctly inserted before `</body>`
- [ ] Unit test: `test_inject_reload_script_no_body_tag` -- verify graceful handling when `</body>` is missing (append at end)
- [ ] Unit test: `test_serve_dev_reload_js` -- verify `/dev/reload.js` returns correct JS content and content-type `application/javascript`
- [ ] Integration test: `test_dev_reload_sse_endpoint` -- verify SSE endpoint returns correct content type and event format

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes all tests
- [ ] Manual: `tugcast --dev <tugdeck/dist>`, open browser, verify `<script>` tag is present in page source; save a file in the dev path and observe SSE event triggers browser reload

**Rollback:**
- Delete `tugcode/crates/tugcast/src/dev.rs`
- Revert changes to `server.rs` and `main.rs`

**Commit after all checkpoints pass.**

---

#### Step 3: Control feed protocol extension {#step-3}

**Depends on:** #step-0

**Commit:** `feat(tugcast-core): add Control feed ID (0xC0) with restart/reset/reload message types`

**References:** [D04] Control feed ID in WebSocket protocol, Spec S01, (#d04-control-feed, #s01-control-frame, #protocol-extension)

**Artifacts:**
- Modified `tugcode/crates/tugcast-core/src/protocol.rs` (new `FeedId::Control` variant)
- Modified `tugcode/crates/tugcast-core/src/lib.rs` (re-export if needed)
- Modified `tugcode/crates/tugcast/src/router.rs` (handle `FeedId::Control` in client message match)
- Modified `tugcode/crates/tugcast/src/main.rs` (create shutdown channel, `select!` on receiver + server future, orderly shutdown on exit code)

**Tasks:**
- [ ] Add `Control = 0xC0` variant to `FeedId` enum in `tugcast-core/src/protocol.rs`
- [ ] Update `FeedId::from_byte` to handle `0xC0 => Some(FeedId::Control)`
- [ ] Update existing `from_byte` and `as_byte` tests to include `Control` variant
- [ ] Add round-trip test for Control frames with JSON payloads
- [ ] In `tugcast/src/router.rs`, add `FeedId::Control` match arm in the client message handler that deserializes the JSON payload and dispatches based on `action` field
- [ ] Create a shutdown channel: `tokio::sync::mpsc::channel::<u8>(1)`. Define an `AppState` struct holding `shutdown_tx: mpsc::Sender<u8>` and `reload_tx: Option<broadcast::Sender<()>>` (set to `None` in this step — wired by Step 4; mark with `#[allow(dead_code)]` and `// wired in Step 4` to avoid warnings). Pass `AppState` to `build_app` as an `Extension`. The `Receiver` is held by `main()`, which `select!`s on it alongside the server future. This ensures control handlers never call `std::process::exit` directly — `main()` owns the exit path and performs orderly cleanup (close WebSockets, flush logs, release PTY handles, drop watcher) before exiting
- [ ] For `"restart"` action: log the restart request and send **exit code 42** on the shutdown channel. `main()` receives it, performs orderly shutdown, then calls `std::process::exit(42)`. The parent supervisor detects code 42 and respawns tugcast with the same flags
- [ ] For `"reset"` action: log the reset request and send **exit code 43** on the shutdown channel. Same orderly shutdown path. The parent supervisor detects code 43, clears caches, and respawns tugcast
- [ ] For `"reload_frontend"` action: implement as a **stub that logs and does nothing** in this step. The actual SSE broadcast channel is created in Step 2's `dev_file_watcher`, but the router does not have access to it until Step 4 wires the `ReloadBroadcast` sender into the `FeedRouter` (or an equivalent shared state). Add a `// TODO: wire SSE reload broadcast in Step 4` comment. In production mode (no `--dev`), this action is always a no-op

**Tests:**
- [ ] Unit test: `test_feedid_control_from_byte` -- `FeedId::from_byte(0xC0) == Some(FeedId::Control)`
- [ ] Unit test: `test_feedid_control_as_byte` -- `FeedId::Control.as_byte() == 0xC0`
- [ ] Unit test: `test_round_trip_control_restart` -- round-trip encode/decode of a control frame with restart payload
- [ ] Unit test: `test_round_trip_control_reset` -- round-trip encode/decode of a control frame with reset payload
- [ ] Golden test: `test_golden_control_restart` -- verify exact wire bytes for a control restart frame

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugcast-core` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast-core` passes all tests
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes all tests (router handles new feed ID)

**Rollback:**
- Revert `FeedId` changes in `protocol.rs`
- Revert router changes

**Commit after all checkpoints pass.**

---

#### Step 4: Tugdeck client-side dev mode support {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat(tugdeck,tugcast): add control frame sending, SSE reload wiring, and dock menu controls`

**References:** [D03] SSE-based live reload, [D04] Control feed ID in WebSocket protocol, Spec S01, (#d03-sse-reload, #d04-control-feed, #s01-control-frame)

**Artifacts:**
- Modified `tugdeck/src/protocol.ts` (add `CONTROL` FeedId, `controlFrame` factory)
- Modified `tugdeck/src/connection.ts` (add `sendControlFrame` method to `TugConnection`)
- Modified `tugdeck/src/dock.ts` (add restart/reset/reload menu items)
- Modified `tugdeck/src/deck-manager.ts` (add `sendControlFrame` delegate method)
- Modified `tugcode/crates/tugcast/src/router.rs` (wire SSE reload broadcast sender into `FeedRouter`, replace `reload_frontend` stub with real dispatch)
- Modified `tugcode/crates/tugcast/src/main.rs` (plumb reload broadcast sender from dev watcher to `FeedRouter` constructor)

**Tasks:**
- [ ] Add `CONTROL: 0xc0` to the `FeedId` constant object in `tugdeck/src/protocol.ts` and update the `FeedIdValue` type accordingly
- [ ] Add `controlFrame(action: string)` factory function in `protocol.ts` that creates a `Frame` with `feedId: FeedId.CONTROL` and a JSON-encoded payload `{"action": "<action>"}`
- [ ] Add `sendControlFrame(action: string)` method to `TugConnection` class in `connection.ts` that calls `this.send(FeedId.CONTROL, ...)` with the JSON-encoded action payload. Note: `TugConnection` already has a `send(feedId, payload)` method (line 238) so this is a thin wrapper
- [ ] Wire control actions into the Dock settings menu. The `Dock` class (in `dock.ts`) currently has no reference to `TugConnection` — it only knows about `DeckManager`. Add `sendControlFrame` as a method on `DeckManager` that delegates to its `TugConnection` instance (`DeckManager` already holds `private connection: TugConnection` at line 78), and call it from `Dock`. Add menu items for "Restart Server", "Reset Everything", and "Reload Frontend" to the Dock settings dropdown. These controls are shown in all contexts (terminal dev mode and Mac app) since both benefit from restart/reset
- [ ] For the "Reset Everything" action: clear `localStorage` on the client side *before* sending the reset control frame, since the server will exit and the WebSocket will close
- [ ] The SSE reload connection is handled by the injected `/dev/reload.js` script (no TypeScript changes needed for reload reception); verify the script works correctly with the SSE endpoint
- **Note on test churn:** Protocol and dock changes will ripple across existing tests and fixtures beyond those listed below. Expect updates to `protocol.ts` type tests, `connection.ts` mock setup, `dock.test.ts` fixtures, and potentially `deck-manager.test.ts`. The test count below covers new functionality; fixture updates for existing tests are also required
- [ ] Wire the `reload_frontend` action in the router: update `FeedRouter` (or add shared state) to optionally hold the SSE reload broadcast sender from Step 2's `dev_file_watcher`. When a `reload_frontend` control frame arrives, send on the broadcast channel if present (no-op if not in dev mode)

**Tests:**
- [ ] Unit test: `controlFrame("restart")` produces a Frame with `feedId === 0xC0` and payload that JSON-parses to `{"action":"restart"}`
- [ ] Unit test: `controlFrame("reset")` produces correct feedId and payload
- [ ] Unit test: round-trip `encodeFrame(controlFrame("restart"))` through `decodeFrame` yields the original feedId and payload
- [ ] Manual test: Open tugdeck in browser with dev mode active, trigger restart from dock menu, verify tugcast restarts and WebSocket reconnects
- [ ] Manual test: Trigger reset, verify localStorage is cleared and page reloads

**Checkpoint:**
- [ ] `cd tugdeck && bun build` succeeds
- [ ] `cd tugdeck && bun test` passes (if tests exist)
- [ ] `cd tugcode && cargo build -p tugcast` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugcast` passes all tests (including router handling of reload_frontend with wired broadcast sender)
- [ ] Manual: dock menu restart/reset/reload actions work end-to-end

**Rollback:**
- Revert TypeScript changes in tugdeck (`protocol.ts`, `connection.ts`, `dock.ts`, `deck-manager.ts`)
- Revert Rust changes in `tugcast/src/router.rs` and `tugcast/src/main.rs`

**Commit after all checkpoints pass.**

---

#### Step 5: Mac app shell (tugapp/) {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugapp): add minimal AppKit Mac app with WKWebView, ProcessManager, and Developer menu`

**References:** [D05] AppKit WKWebView shell, Table T01, (#d05-appkit-shell, #error-scenarios, #architecture-overview, #diag01-architecture)

**Artifacts:**
- New `tugapp/` directory at repo root
- `tugapp/Tug.xcodeproj/` (Xcode project)
- `tugapp/Sources/AppDelegate.swift` (~100 lines)
- `tugapp/Sources/MainWindow.swift` (~80 lines)
- `tugapp/Sources/ProcessManager.swift` (~120 lines)
- `tugapp/Assets.xcassets/` (app icons, accent color)
- `tugapp/Tug.entitlements` (hardened runtime)
- `tugapp/Info.plist`

**Tasks:**
- [ ] Create `tugapp/` directory structure
- [ ] Create `Tug.xcodeproj` with build settings: deployment target macOS 13.0, Swift language version 5.9, hardened runtime enabled
- [ ] Implement `AppDelegate.swift`: `NSApplicationDelegate`, create main window, build menu bar with Developer menu (hidden by default), handle dev mode toggle, store source tree path in `UserDefaults`
- [ ] Implement `MainWindow.swift`: `NSWindow` subclass with `WKWebView`. Configure `WKWebViewConfiguration` for localhost access; add `NSAppTransportSecurity` exception domains for both `localhost` and `127.0.0.1` in Info.plist (two entries, each with `NSExceptionAllowsInsecureHTTPLoads = YES`) to allow plain HTTP. Verify on a clean machine. Handle navigation delegate for auth flow (cookie-based token exchange)
- [ ] Implement `ProcessManager.swift`: resolve tugcast binary path (sibling in `.app/Contents/MacOS/`), spawn tugcast as `Process`, implement **supervisor loop** matching D02's exit code contract (code 42 = restart, code 43 = reset, other = real exit), handle `--dev` flag when dev mode is toggled. Also check for `tmux` availability at startup and surface a clear alert if missing
- [ ] Implement Developer menu items: Enable Dev Mode (checkbox), Reload Frontend (Cmd+R), Restart Server (Cmd+Shift+R), Reset Everything (Cmd+Opt+R), Open Web Inspector, Source Tree display, Choose Source Tree... (folder picker)
- [ ] Implement source tree validation: check for `tugdeck/src/main.ts` and `tugdeck/package.json`
- [ ] Implement error handling from Table T01 for Mac app context (alerts with recovery actions)
- [ ] Create `Tug.entitlements` with `com.apple.security.cs.allow-unsigned-executable-memory` for WKWebView
- [ ] Create `Info.plist` with bundle ID `dev.tugtool.app`, version from workspace

**Tests:**
- [ ] Build test: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` succeeds
- [ ] Manual test: Launch app, verify WKWebView loads tugcast dashboard
- [ ] Manual test: Toggle dev mode, verify tugcast restarts with --dev flag
- [ ] Manual test: Verify folder picker appears on first dev mode enable

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` succeeds
- [ ] App launches and displays tugdeck dashboard
- [ ] Developer menu appears and all items function correctly

**Rollback:**
- Delete `tugapp/` directory

**Commit after all checkpoints pass.**

---

#### Step 6: Distribution scripts and CI {#step-6}

**Depends on:** #step-5

**Commit:** `feat(scripts): add build-app.sh for signing, notarization, and DMG creation; add nightly CI config`

**References:** [D06] Distribution via signed DMG with nightly variant, (#d06-distribution, #architecture-overview)

**Artifacts:**
- New `tugcode/scripts/build-app.sh`
- CI configuration for nightly builds
- Nightly icon variant in `tugapp/Assets.xcassets/`

**Tasks:**
- [ ] Create `tugcode/scripts/build-app.sh` that performs: `cargo build --release` for tugcast/tugcode/tugtalk, `bun build` for tugdeck, assemble `.app` bundle (copy binaries to `Contents/MacOS/`, copy tugplug to `Contents/Resources/`), `codesign --deep --force --verify --verbose --sign "Developer ID Application"`, `xcrun notarytool submit` + `xcrun stapler staple`, `hdiutil create -format UDZO`
- [ ] Add nightly icon variant (orange/amber) to `tugapp/Assets.xcassets/AppIcon.appiconset/`
- [ ] Add `--nightly` flag to `build-app.sh` that switches bundle ID to `dev.tugtool.nightly` and uses nightly icon
- [ ] Create CI workflow (GitHub Actions) for nightly builds: checkout, install Rust, install bun, run `tugcode/scripts/build-app.sh --nightly`, upload artifact to GitHub Releases with `nightly` tag
- [ ] Add environment variables/secrets for: Apple Developer ID certificate (base64), certificate password, Apple ID for notarization, team-specific app password

**Tests:**
- [ ] `tugcode/scripts/build-app.sh --help` prints usage
- [ ] `tugcode/scripts/build-app.sh` builds and produces a DMG (local test without signing if no certificate)
- [ ] `spctl --assess --type execute Tug.app` passes (when signed)

**Checkpoint:**
- [ ] `tugcode/scripts/build-app.sh` produces `Tug.dmg` containing `Tug.app`
- [ ] App inside DMG launches and works
- [ ] (When signed) `spctl --assess` passes
- [ ] (When CI configured) Nightly workflow completes and uploads artifact

**Rollback:**
- Delete `tugcode/scripts/build-app.sh`
- Revert CI configuration

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A five-phase dev mode and app mode system: `tugcast --dev` serves from disk, `tugtool --dev` orchestrates the full dev workflow, live reload via SSE, WebSocket control protocol for restart/reset, a native Mac app shell with Developer menu, and distribution via signed DMG with nightly builds.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugcast --dev <path>` serves assets from disk via `ServeDir` (`cargo build -p tugcast` succeeds, manual verification)
- [ ] `tugtool --dev` auto-detects source tree, spawns both bun dev and tugcast --dev, opens browser, handles Ctrl+C cleanly
- [ ] Saving a file in tugdeck causes automatic browser reload within 2 seconds
- [ ] `FeedId::Control` (0xC0) is in tugcast-core with restart/reset/reload_frontend actions, all tests pass
- [ ] Tugdeck dock menu sends control frames and they are handled correctly by tugcast
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` produces a working `.app`
- [ ] Developer menu toggles dev mode, shows/hides correctly, folder picker works
- [ ] `tugcode/scripts/build-app.sh` produces a DMG; when signed, passes `spctl --assess`

**Acceptance tests:**
- [ ] Integration test: `cargo nextest run -p tugcast` (all tests including dev mode tests)
- [ ] Integration test: `cargo nextest run -p tugcast-core` (protocol tests including Control)
- [ ] Integration test: `cargo nextest run -p tugtool` (launcher tests including --dev flag)
- [ ] Build test: `xcodebuild` succeeds for Tug
- [ ] Manual end-to-end: `tugtool --dev` full workflow (edit file -> auto reload -> dock restart)

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Dev Serve** {#m01-dev-serve}
- [ ] `tugcast --dev <path>` serves from disk, `tugtool --dev` orchestrates full workflow (Steps 0-1)

**Milestone M02: Live Reload** {#m02-live-reload}
- [ ] SSE endpoint, file watcher, and script injection deliver automatic reload on save (Step 2)

**Milestone M03: Dock Controls** {#m03-dock-controls}
- [ ] Control protocol extension and tugdeck UI wiring complete (Steps 3-4)

**Milestone M04: Mac App** {#m04-mac-app}
- [ ] Native AppKit shell with ProcessManager and Developer menu functional (Step 5)

**Milestone M05: Distribution** {#m05-distribution}
- [ ] Signed, notarized DMG with nightly CI variant (Step 6)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Auto-restart tugcast when debug binary changes (binary watching -- see Q01)
- [ ] Homebrew cask formula for Tug.dmg distribution
- [ ] Touch Bar / menu bar status item showing tugcast health
- [ ] Sparkle-based auto-update framework for stable releases
- [ ] Cross-platform Electron/Tauri shell for Linux/Windows

| Checkpoint | Verification |
|------------|--------------|
| Dev serve works | `tugcast --dev /tmp/test && curl localhost:7890` serves files from disk |
| Live reload works | Save file -> browser reloads automatically |
| Control protocol works | `cargo nextest run -p tugcast-core` -- all Control feed tests pass |
| Mac app builds | `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` exits 0 |
| DMG builds | `tugcode/scripts/build-app.sh` produces Tug.dmg |

**Commit after all checkpoints pass.**
