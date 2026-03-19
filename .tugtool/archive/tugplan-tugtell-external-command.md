## Phase 6.0: Tugtell External Command Interface {#phase-tugtell}

**Purpose:** Add an HTTP control endpoint (`POST /api/tell`) to tugcast so external processes can trigger UI actions in tugdeck. Make Control frames (0xC0) bidirectional, build an action dispatcher in tugdeck, implement About and Settings as full TugCards, wire Mac app menus through HTTP POST, and add a `tugcode tell` CLI subcommand. Build a WKScriptMessageHandler bridge in MainWindow.swift for native picker and dev-mode toggling from tugdeck.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-20 (rev 6) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tug.app's About box and Settings window are native macOS panels (`NSApp.orderFrontStandardAboutPanel`, `SettingsWindow.swift`). They should be tugcards inside tugdeck -- consistent with everything else in the UI. But there is no mechanism for the Mac app's menu bar to tell tugdeck "show the About card." The current menu actions (Reload Frontend, Restart Server, Reset Everything) work through process-level hacks: the Mac app kills tugcast and respawns it, or reloads the WebView. The dock's settings menu already does it better -- it sends Control frames (0xC0) over the WebSocket to tugcast, which handles restart/reset/reload cleanly. But the Mac app's native menus cannot use that path because they live outside the WebView.

The deeper problem: there is no general mechanism for external software to trigger UI actions inside tugdeck. The Mac app's menu bar is just the first example. Scripts, CLI tools, other applications -- anything that wants to say "hey tugdeck, show this card" or "navigate to that panel" -- has no way in.

Additionally, dev mode and source tree selection are owned by the Mac app (ProcessManager stores `devPath`, AppDelegate stores `devModeEnabled`/`sourceTreePath` in UserDefaults). Tugcast only signals restart/reset via exit codes. There is no mechanism for the web UI to change these Mac-app-owned settings. This plan builds a WKScriptMessageHandler bridge so the Settings tugcard can control dev mode and source tree selection through native macOS APIs.

#### Strategy {#strategy}

- Layer the work bottom-up: HTTP endpoint first, then bidirectional Control frames, then action dispatcher, then card implementations, then WKScriptMessageHandler bridge, then Mac app and CLI wiring.
- Reuse the existing 0xC0 Control feed -- no new protocol, no new binary, no new IPC mechanism. The Control feed just needs to work in both directions and have an HTTP front door.
- Classify actions as server-only (restart), hybrid (reset, reload_frontend), or client-only (everything else). Server-only actions are handled locally by tugcast. Hybrid actions broadcast to clients AND perform server-side handling. Client-only actions are broadcast to all WebSocket clients.
- Build About and Settings as full TugCard implementations with CardMeta, using the same patterns as existing cards (ConversationCard, TerminalCard, etc.).
- Use a WKScriptMessageHandler bridge (built from scratch in MainWindow.swift) for operations that must touch the Mac app's native state: source tree picker (NSOpenPanel + UserDefaults) and dev mode toggle (UserDefaults + ProcessManager restart). This bridge is the only path for tugdeck to reach Mac-app-owned state.
- Wire Mac app menu items to use HTTP POST to tugcast's `/api/tell` endpoint instead of direct process manipulation.
- Add `tugcode tell` CLI subcommand as a thin wrapper around HTTP POST for scripting and debugging.

#### Stakeholders / Primary Customers {#stakeholders}

1. Tug.app users who expect About and Settings to be consistent with the card-based UI
2. Developers who want to trigger tugdeck actions from scripts, CLI, or external tools
3. The Mac app menu bar, which needs a clean path to tugdeck actions without process-level hacks

#### Success Criteria (Measurable) {#success-criteria}

- `curl -X POST http://127.0.0.1:7890/api/tell -d '{"action":"show-card","component":"about"}'` returns 200 and opens the About card in tugdeck (verified by manual test)
- Mac app "About Tug" and "Settings..." menu items open the corresponding tugcards (no native NSWindow or standard about panel)
- `tugcode tell show-card -p component=about` succeeds when tugcast is running (exit code 0, JSON response with `"status":"ok"`)
- Existing Control frame actions (restart, reset, reload_frontend) continue to work unchanged from both the dock menu and the Mac app Developer menu
- `SettingsWindow.swift` is deleted; no native Settings window exists
- Settings card displays theme selector, dev mode toggle (functional -- toggles Mac app dev mode and restarts tugcast), and source tree path with native NSOpenPanel picker
- `/api/tell` actively rejects connections from non-loopback addresses (not just implicit binding)
- Dev mode toggle from Settings card: toggling checkbox changes `UserDefaults.devModeEnabled`, restarts tugcast with/without `--dev` flag, updates Developer menu visibility

#### Scope {#scope}

1. HTTP `POST /api/tell` endpoint in tugcast
2. Bidirectional Control frame broadcast (tugcast to WebSocket clients)
3. Action dispatcher in tugdeck (`action-dispatch.ts`)
4. About TugCard (`about-card.ts`)
5. Settings TugCard (`settings-card.ts`)
6. WKScriptMessageHandler bridge in MainWindow.swift (chooseSourceTree, setDevMode, getSettings)
7. Mac app menu rewiring via `tell()` helper
8. Dock integration (About menu item uses action dispatch instead of JS alert)
9. `tugcode tell` CLI subcommand
10. Deletion of `SettingsWindow.swift` and native About panel

#### Non-goals (Explicitly out of scope) {#non-goals}

- Action namespacing (e.g., `card.show`, `server.restart`) -- flat namespace is sufficient for current action count
- Making the dock icon buttons use the action dispatch system -- they already work via `DeckManager.addNewCard()` directly
- General-purpose reverse channel from tugcast to Mac app -- the WKScriptMessageHandler bridge handles the specific needs (dev mode, source tree); a generic channel is a future concern

#### Dependencies / Prerequisites {#dependencies}

- Existing Control frame infrastructure (0xC0 feed ID, `controlFrame()` helper, `sendControlFrame()`)
- Existing card system (TugCard interface, CardMeta, card factories, DeckManager)
- tugcast HTTP server (axum routes, `build_app()` in server.rs)
- Mac app process lifecycle (ProcessManager, AppDelegate, auth URL extraction)
- WKWebView JavaScript execution via `evaluateJavaScript()` (built into WebKit)

#### Constraints {#constraints}

- `/api/tell` must be localhost-only (127.0.0.1 binding) AND actively reject connections from non-loopback addresses
- Warnings are errors in the Rust crate (`-D warnings` in cargo config)
- No new dependencies in tugcast unless strictly necessary -- axum already provides JSON extraction
- TugCard interface is frozen -- About and Settings cards must conform to the existing interface
- Source tree picker must use native NSOpenPanel for macOS UX consistency
- Dev mode and source tree are Mac-app-owned state (UserDefaults + ProcessManager) -- tugcast cannot change them directly

#### Assumptions {#assumptions}

- Control frames will use the same 0xC0 feed ID and JSON payload format already established in `protocol.ts`
- The action dispatcher will use a simple `Map<string, handler>` registry
- Settings and theme preferences will continue to use `localStorage` on the client side
- The `show-card` action targets the topmost card (highest z-index, most recently focused) when multiple cards of the same component type exist
- Breaking changes to `SettingsWindow.swift` are acceptable since it will be deleted entirely
- The dock's existing About alert will be replaced by the About card
- `localStorage.clear()` clears ALL localStorage (complete clear, not selective)
- MainWindow.swift currently has NO WKUserContentController, NO WKScriptMessageHandler, NO messageHandlers plumbing -- this is built from scratch

#### Open Questions {#open-questions}

1. **Reset broadcast timing**: The hybrid `reset` action broadcasts to clients, then exits after a brief delay. The delay duration (~100ms) is a best guess. If clients do not reliably receive the frame before disconnection, a longer delay or an acknowledgment pattern may be needed.

#### Risks {#risks}

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| FeedRouter::new() signature change breaks downstream code beyond integration_tests.rs | Low | Medium | Exhaustive search for all call sites; the constructor is only called in main.rs and integration_tests.rs |
| `tell()` fire-and-forget from Mac app silently fails if tugcast is not yet ready | Medium | Low | Acceptable UX -- menu items are only visible when the app is running, and tugcast starts before the WebView loads |
| `localStorage.clear()` via hybrid reset races with server exit | Medium | Low | 100ms delay before exit; if insufficient, increase delay or add client acknowledgment |
| Dev-mode SSE reload and client-side `location.reload()` double-fire in dev mode | Medium | Low | Use a `reloadPending` flag in the `reload_frontend` handler: set flag, call `location.reload()`, skip if flag already set. The SSE `reload.js` also calls `location.reload()` so the flag prevents the second call. |
| WKScriptMessageHandler callback delivers result after Settings card is destroyed | Low | Medium | Guard callback with null check on the Settings card's container element before updating DOM |
| Mac app port extraction fails if auth URL format changes | Low | High | Port extraction is a simple regex on a URL we control; add unit test for the extraction logic |

---

### 6.0.0 Design Decisions {#design-decisions}

#### [D01] HTTP POST /api/tell as the single external entry point (DECIDED) {#d01-http-tell-endpoint}

**Decision:** All external-to-tugdeck commands flow through a single HTTP endpoint `POST /api/tell` on tugcast, which classifies actions and either handles them server-side or broadcasts them as 0xC0 Control frames to WebSocket clients. The endpoint actively rejects connections from non-loopback addresses.

**Rationale:**
- Reuses existing infrastructure (axum HTTP server, WebSocket broadcast, Control frame protocol)
- Any process that can make an HTTP request to localhost gets tugdeck control for free
- Single entry point means single place to add logging, rate limiting, or auth later
- Active remote rejection prevents accidental exposure if binding ever changes

**Implications:**
- tugcast gains a new axum route and JSON request handler
- Router needs a broadcast channel for sending Control frames to clients (currently only receives)
- Mac app needs the server port to construct the URL (already available from auth URL)
- The handler must check `ConnectInfo<SocketAddr>` and reject non-loopback sources with 403 using `addr.ip().is_loopback()` (covers both IPv4 `127.0.0.1` and IPv6 `::1`)
- Custom JSON rejection handler needed to override axum's default framework-generated error for malformed JSON (see D01-ERR below)

**D01-ERR: Custom JSON extraction error handling.** {#d01-err-json-extraction}

Axum's built-in `Json<T>` extractor returns framework-generated rejection responses for malformed JSON, not the plan's specified 400 JSON error body. The `tell_handler` must use a custom extractor or wrap `Json<T>` with explicit error mapping to return `{"status": "error", "message": "invalid JSON"}` for parse failures and `{"status": "error", "message": "missing action field"}` when the `action` key is absent. Approach: use `axum::extract::rejection::JsonRejection` with a manual `match` on the extraction result, or accept raw `Bytes` and parse with `serde_json::from_slice` directly.

---

#### [D02] Action classification: server-only, hybrid, client-only (DECIDED) {#d02-action-classification}

**Decision:** Actions are classified as server-only, hybrid, or client-only by a simple string match. Server-only actions (`restart`) are handled locally by tugcast (exit with code 42) and NOT broadcast. Hybrid actions (`reset`, `reload_frontend`) broadcast a 0xC0 frame to WebSocket clients first, THEN perform server-side handling (`reset` exits with code 43 after a brief delay to allow the broadcast to flush; `reload_frontend` fires the dev SSE reload_tx if available). All other actions -- including `set-dev-mode` and `choose-source-tree` -- are client-only and broadcast to ALL WebSocket clients as 0xC0 frames.

**Canonical action semantics:** All mutations flow through the action dispatch system regardless of transport. Two transports exist:
1. **HTTP POST /api/tell** -- used by external callers (CLI, Mac app menu, scripts)
2. **WebSocket Control frame** -- used by internal callers (tugdeck UI, dock menu)

Both transports arrive at the same tugcast broadcast logic and produce the same result: tugcast broadcasts to all WebSocket clients, and the tugdeck action dispatcher routes to the registered handler. The Settings card does NOT call `window.webkit.messageHandlers` directly for mutations. Instead, it sends actions via WebSocket Control frames, and the tugdeck action dispatcher handler for `set-dev-mode` and `choose-source-tree` calls the WKScriptMessageHandler bridge. This ensures that `tugcode tell set-dev-mode -p enabled=true` (HTTP transport) follows the exact same action semantics as the Settings card toggle (WebSocket transport).

**Broadcast semantics: all clients, including sender.** Tugcast broadcasts client-only actions to ALL connected WebSocket clients, including the sender. This is simpler (no per-connection filtering) and correct: the sender (e.g., dock settings menu) may dispatch locally via `dispatchAction()` before the broadcast arrives back, so handlers need idempotency anyway (the `reloadPending` flag already handles this for `reload_frontend`). CLI and Mac app callers are NOT WebSocket clients, so sender-exclusion is irrelevant for them. For the dock-menu case (sender IS a client), the `set-dev-mode` handler is idempotent (calling the bridge twice with the same value is harmless).

**Rationale:**
- `restart` is server-only because there is no client-side cleanup needed -- the WebSocket disconnects and the Mac app respawns tugcast
- `reset` is hybrid because the dock currently calls `localStorage.clear()` before sending the reset control frame. Making `reset` hybrid ensures all entry points (dock menu, Mac app menu, CLI) trigger `localStorage.clear()` via the client-side handler before the server exits.
- `reload_frontend` is hybrid because it must work in production mode (no SSE). In production the WebView reload happens client-side when tugdeck receives the Control frame and calls `location.reload()`. In dev mode the SSE channel provides the additional hot-reload path. To prevent double reload, the client handler sets a `reloadPending` flag before calling `location.reload()`.
- `set-dev-mode` and `choose-source-tree` are client-only passthrough actions. Tugcast broadcasts them without interpreting them. The tugdeck action handler calls the WKScriptMessageHandler bridge if available. Dev mode is Mac-app-owned state (UserDefaults + ProcessManager), but the bridge call is made from the JavaScript action handler, not directly from the UI control.
- `set-dev-mode` is NOT a no-op outside the Mac app. When running in a browser (no WKWebView), the action still arrives via WebSocket, and the tugdeck UI updates the Settings card checkbox accordingly (optimistic update). The bridge call is simply unavailable, so the actual Mac-side state change does not happen. The Settings card shows a note ("dev mode toggle requires the Tug app") if the bridge is absent.
- Client-only actions (show-card, focus-card, close-card) are only meaningful to the UI
- Simple string match avoids complex registration or configuration

**Implications:**
- The existing Control frame handler in `router.rs` (lines 281-308) is extended, not replaced
- New client actions can be added without touching tugcast -- just register a handler in tugdeck
- The `/api/tell` handler shares the same action classification logic as the WebSocket handler
- tugdeck registers `reload_frontend`, `reset`, `set-dev-mode`, and `choose-source-tree` action handlers
- `set-dev-mode` and `choose-source-tree` flow: tell/WebSocket -> tugcast broadcast -> tugdeck action handler -> bridge call (if available)
- Broadcast to ALL clients (including sender) -- no per-connection exclusion filtering

---

#### [D03] Action dispatcher as a Map registry (DECIDED) {#d03-action-dispatcher}

**Decision:** The tugdeck action dispatcher is a `Map<string, ActionHandler>` where handlers are registered at initialization time. `dispatchAction()` looks up the action string and calls the handler.

**Rationale:**
- Simple, debuggable, no dynamic discovery needed
- Cards can register their own handlers at mount time
- Unknown actions are logged and ignored (no crash)

**Implications:**
- New module `action-dispatch.ts` with `registerAction()` and `dispatchAction()` exports
- DeckManager registers a callback for `FeedId.CONTROL` on the connection to feed incoming frames to the dispatcher
- Built-in actions (`show-card`, `focus-card`, `close-card`, `reload_frontend`, `reset`, `set-dev-mode`, `choose-source-tree`) are registered during initialization

---

#### [D04] About and Settings as full TugCard implementations (DECIDED) {#d04-cards-implementation}

**Decision:** About and Settings are implemented as full TugCards with CardMeta, registered with card factories, and managed by DeckManager like any other card.

**Rationale:**
- Consistent with the existing card system -- no special cases
- Cards get closable behavior, focus management, drag/resize, and tab support for free
- CardMeta provides title, icon, and menu items automatically

**Implications:**
- New files: `about-card.ts`, `settings-card.ts` in `tugdeck/src/cards/`
- Card factories registered in `main.ts` for both components
- Both cards have `feedIds: []` (no feed subscriptions -- they render static/local content)
- `titleForComponent()` in `deck-manager.ts` updated with "About" and "Settings" entries
- `DeckManager.KEY_CAPABLE` set is NOT updated -- neither About nor Settings cards accept key status (they do not have terminal-like input that needs focus tracking). Standard form controls in the Settings card use normal DOM focus.
- CardHeader `ICON_MAP` in `card-header.ts` must be extended with `Info` and `Settings` icon entries from Lucide. Without these, both cards would fall back to the generic `Box` icon.

---

#### [D05] Source tree picker and dev mode via WKScriptMessageHandler bridge (DECIDED) {#d05-webkit-bridge}

**Decision:** MainWindow.swift is modified to create a `WKUserContentController`, register `WKScriptMessageHandler` handlers for `chooseSourceTree`, `setDevMode`, and `getSettings`, and provide `evaluateJavaScript` callback paths. This is built FROM SCRATCH -- there is currently no WKUserContentController, no message handler plumbing in MainWindow.swift.

**Rationale:**
- Dev mode and source tree are Mac-app-owned state (UserDefaults + ProcessManager). Tugcast does not know about these values and cannot change them.
- WKScriptMessageHandler is the standard WebKit mechanism for JS-to-native communication in WKWebView.
- NSOpenPanel is the expected macOS UX for folder selection.
- The bridge lives in MainWindow.swift because that is where the WKWebView is created and configured.

**Architecture:**

**Bridge handlers (MainWindow.swift implements WKScriptMessageHandler):**

1. `chooseSourceTree` -- JS calls `window.webkit.messageHandlers.chooseSourceTree.postMessage({})`. Native side presents NSOpenPanel, validates via `TugConfig.isValidSourceTree()`, persists to UserDefaults, restarts tugcast if dev mode is on, calls `webView.evaluateJavaScript("window.__tugBridge.onSourceTreeSelected('ESCAPED_PATH')")`.

2. `setDevMode` -- JS calls `window.webkit.messageHandlers.setDevMode.postMessage({enabled: true/false})`. Native side persists to UserDefaults, updates Developer menu visibility, stops ProcessManager, restarts with new dev mode flag. Calls `webView.evaluateJavaScript("window.__tugBridge.onDevModeChanged(true/false)")` to confirm.

3. `getSettings` -- JS calls `window.webkit.messageHandlers.getSettings.postMessage({})`. Native side reads current dev mode and source tree from UserDefaults. Calls `webView.evaluateJavaScript("window.__tugBridge.onSettingsLoaded({devMode: BOOL, sourceTree: 'ESCAPED_PATH'})")`.

**Callback namespace:** All callbacks live under `window.__tugBridge` to avoid polluting the global namespace. The Settings card registers these callbacks on mount and clears them on destroy.

**Fallback:** When `window.webkit?.messageHandlers` is not available (e.g., development in a standalone browser), the Settings card shows the current values as read-only text with a note that native features require the Tug app.

**Implications:**
- MainWindow.swift gains `WKUserContentController` setup, `WKScriptMessageHandler` conformance, and three message handlers
- MainWindow needs a reference to AppDelegate (or a delegate protocol) for ProcessManager restart and UserDefaults access
- The bridge needs access to `devModeEnabled`, `sourceTreePath`, `processManager`, `updateDeveloperMenuVisibility()` -- these are currently on AppDelegate, so MainWindow.swift will receive a delegate/callback interface
- Path strings passed to `evaluateJavaScript` must be escaped for JavaScript string literals (backslashes, single quotes)
- MainWindow must store the `WKUserContentController` as a property and call `removeScriptMessageHandler(forName:)` for each registered handler (`chooseSourceTree`, `setDevMode`, `getSettings`) on teardown to break the retain cycle created by `contentController.add(self, ...)`
- **Dual-path cleanup:** MainWindow exposes a public `cleanupBridge()` method that performs the handler deregistration. AppDelegate calls `cleanupBridge()` from `applicationWillTerminate(_:)` as the primary cleanup path. MainWindow's `deinit` also calls `cleanupBridge()` as a safety net, but `deinit` is not guaranteed to run in all shutdown paths (forced quit, crash). The method is idempotent -- calling it twice is harmless (second call is a no-op since the handlers are already removed).

---

#### [D06] Mac app tell() helper replaces process-level actions (DECIDED) {#d06-mac-app-tell}

**Decision:** The Mac app's AppDelegate gets a `tell()` helper method that sends HTTP POST requests to `http://127.0.0.1:<port>/api/tell`. Menu items for About, Settings, Restart Server, Reset Everything, and Reload Frontend all use `tell()` instead of direct process manipulation or native panels.

**Rationale:**
- All actions flow through the same path regardless of origin (dock menu, Mac menu, CLI, script)
- Eliminates duplicated logic between Mac app and dock
- The Mac app already knows the server port from the auth URL extraction

**Implications:**
- AppDelegate gains a `tell()` method and a `serverPort` property (extracted from auth URL)
- `showAbout(_:)` changes from `NSApp.orderFrontStandardAboutPanel(nil)` to `tell("show-card", params: ["component": "about"])`
- `showSettings(_:)` changes from showing `SettingsWindowController` to `tell("show-card", params: ["component": "settings"])`
- Developer menu actions (reloadFrontend, restartServer, resetEverything) change from process-level calls to `tell()` calls
- `tell()` is fire-and-forget -- if tugcast is not running, the POST silently fails
- `SettingsWindow.swift` is deleted entirely; `settingsWindowController` property removed

---

#### [D07] tugcode tell CLI subcommand (DECIDED) {#d07-cli-tell}

**Decision:** Add a `tugcode tell` CLI subcommand that accepts an action name and optional key-value parameters, constructs a JSON body, and POSTs to `http://127.0.0.1:<port>/api/tell`. JSON output uses the existing global `--json` flag and `JsonResponse` envelope from `output.rs`, like all other tugcode subcommands.

**Rationale:**
- Useful for scripting and debugging (nicer syntax than raw curl)
- Consistent with tugcode's role as the CLI frontend for the tug ecosystem
- Low implementation cost (HTTP POST with serde_json)
- JsonResponse envelope provides consistency with all other tugcode commands

**Implications:**
- New `Tell` variant in the `Commands` enum in `cli.rs`
- New `tell.rs` command handler in `tugcode/crates/tugcode/src/commands/`
- Default port 7890 (matching tugcast default); overridable with `--port` flag
- Exit code 0 on success, 1 on connection refused or HTTP error
- The `Tell` variant does NOT define its own `--json` flag. It uses the existing global `--json` flag on `Cli` (defined as `#[arg(long, global = true)]`), which is passed to `run_tell()` as the `json_output` parameter. This is how all other subcommands (validate, list, status, doctor, etc.) handle JSON output.
- When global `--json` is set, output uses `JsonResponse<TellData>` envelope with `command: "tell"`, where `TellData` contains the server's response status
- New `TellData` struct in `output.rs`
- **Param type coercion:** The `-p key=value` parser applies automatic type coercion before building the JSON body. Without this, `-p enabled=true` would send `{"enabled": "true"}` (string), which the WKScriptMessageHandler bridge cannot extract as a boolean. Coercion rules (applied in order, first match wins): (1) exact `"true"` / `"false"` (case-sensitive) become JSON booleans; (2) exact `"null"` becomes JSON null; (3) strings parseable by Rust's `str::parse::<i64>()` become JSON integer numbers, BUT reject leading zeros (e.g., `"01"` stays string -- leading zeros are ambiguous); (4) strings parseable by `str::parse::<f64>()` become JSON float numbers, including exponent forms like `"1e5"`, BUT reject values beyond f64 precision (NaN, Infinity) and leading zeros; (5) everything else remains a JSON string. No whitespace trimming is performed -- `" true "` remains a string. Empty string `""` remains a string. This coercion is applied in `run_tell()` before calling `serde_json::json!`.

---

#### [D08] Control frame payload format for client actions (DECIDED) {#d08-control-payload}

**Decision:** Client-bound Control frames use the same JSON payload format as client-to-server frames: `{"action": "<name>", ...params}`. The `action` field is always present; additional fields are action-specific.

**Rationale:**
- Symmetric format (same JSON shape in both directions) simplifies parsing
- No version field needed -- action names provide enough extensibility
- Existing `controlFrame()` helper in `protocol.ts` already produces this format

**Implications:**
- `controlFrame()` in `protocol.ts` should be extended to accept optional params (not just action string)
- The action dispatcher in tugdeck parses the JSON payload and routes on `action`
- tugcast's `/api/tell` handler validates `action` is present before broadcasting

---

#### [D09] Multi-card targeting: topmost card wins (DECIDED) {#d09-multi-card-targeting}

**Decision:** When `show-card`, `focus-card`, or `close-card` targets a component type that has multiple open instances, the action targets the **topmost** card -- defined as the card whose panel has the highest z-index (i.e., the most recently focused panel, which occupies the last position in `deckState.cards` array). This matches macOS window management behavior.

**Rationale:**
- DeckManager already orders panels by z-index (array position = z-order, with last = topmost)
- Users expect "the one I was just looking at" behavior, which is the topmost card
- Consistent with how macOS targets the frontmost window of an application

**Implications:**
- `findPanelByComponent()` iterates `deckState.cards` in reverse order and returns the FIRST match (topmost)
- `closePanelByComponent()` uses the same reverse-iteration logic
- `show-card` toggle: if the topmost card of the component type is already the topmost panel overall (last in array), close it; otherwise, focus it

---

### 6.0.1 Specification {#specification}

#### 6.0.1.1 HTTP /api/tell Endpoint {#tell-endpoint-spec}

**Spec S01: /api/tell Request/Response** {#s01-tell-api}

**Request:**
```
POST /api/tell
Content-Type: application/json

{"action": "<action-name>", ...optional-params}
```

**Success Response (200):**
```json
{"status": "ok"}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{"status": "error", "message": "invalid JSON"}` | Request body is not valid JSON (custom rejection, not axum default) |
| 400 | `{"status": "error", "message": "missing action field"}` | Request body missing `action` |
| 403 | `{"status": "error", "message": "forbidden"}` | Connection from non-loopback address (`!addr.ip().is_loopback()` -- rejects anything other than `127.0.0.1` or `::1`) |
| 405 | Method Not Allowed | Non-POST request |

**Server-only Actions (handled locally, NOT broadcast):**
- `restart` -- tugcast exits with code 42

**Hybrid Actions (broadcast to clients first, THEN handled locally):**
- `reset` -- broadcasts 0xC0 frame to WebSocket clients (so tugdeck can call `localStorage.clear()`), then tugcast exits with code 43 after a brief delay (~100ms) to allow the broadcast to flush
- `reload_frontend` -- broadcasts 0xC0 frame to WebSocket clients (so tugdeck can call `location.reload()` with dedup guard), AND fires dev SSE reload_tx if available

**Client-only Actions (broadcast to all WebSocket clients):**
- `show-card` -- params: `component` (string). Targets topmost card per D09.
- `focus-card` -- params: `component` (string). Targets topmost card per D09.
- `close-card` -- params: `component` (string). Targets topmost card per D09.
- `set-dev-mode` -- params: `enabled` (boolean). Passthrough broadcast; tugdeck action handler calls WKScriptMessageHandler bridge if available, updates UI optimistically regardless.
- `choose-source-tree` -- no params. Passthrough broadcast; tugdeck action handler calls WKScriptMessageHandler bridge if available.
- Any other action -- broadcast as-is

#### 6.0.1.2 Action Dispatch Protocol {#action-dispatch-spec}

**Spec S02: Action Dispatcher** {#s02-action-dispatcher}

The action dispatcher in tugdeck operates as follows:

1. DeckManager registers a callback for `FeedId.CONTROL` (0xC0) on the connection during initialization
2. When a Control frame arrives, the payload is decoded as UTF-8 JSON
3. The `action` field is extracted from the parsed JSON
4. `dispatchAction()` looks up the action in the handler registry
5. If found, the handler is called with the full parsed payload
6. If not found, a warning is logged to console

**Built-in Actions:**

**Table T01: Built-in Actions** {#t01-builtin-actions}

| Action | Params | Behavior |
|--------|--------|----------|
| `show-card` | `component: string` | Find topmost card of this component type (D09). If none exists, create one (via addNewCard). If one exists but is not the topmost panel overall, focus it. If one exists and IS the topmost panel overall, close it (toggle). |
| `focus-card` | `component: string` | Focus topmost existing card of component type (D09), no-op if none exists |
| `close-card` | `component: string` | Close topmost existing card of component type (D09), no-op if none exists |
| `reload_frontend` | (none) | Set a `reloadPending` flag to prevent double-fire from SSE, then call `location.reload()` |
| `reset` | (none) | Call `localStorage.clear()` to clear ALL stored state before the server exits and restarts |
| `set-dev-mode` | `enabled: boolean` | Update Settings card UI optimistically (toggle checkbox). Then call WKScriptMessageHandler bridge: `window.webkit.messageHandlers.setDevMode.postMessage({enabled})` if available. If bridge unavailable, show "dev mode toggle requires the Tug app" note. Bridge callback confirms actual state. |
| `choose-source-tree` | (none) | Call WKScriptMessageHandler bridge: `window.webkit.messageHandlers.chooseSourceTree.postMessage({})` if available. If bridge unavailable, show "source tree picker requires the Tug app" note. Bridge callback updates Settings card display. |

#### 6.0.1.3 About Card Specification {#about-card-spec}

**Spec S03: About Card** {#s03-about-card}

| Property | Value |
|----------|-------|
| Component ID | `"about"` |
| Feed subscriptions | none (`feedIds: []`) |
| CardMeta.title | `"About"` |
| CardMeta.icon | `"Info"` (requires adding `Info` to `ICON_MAP` in `card-header.ts`) |
| CardMeta.closable | `true` |
| CardMeta.menuItems | `[]` |

**Content:**
- App name ("Tug") and logo (reuse TUG_LOGO_SVG from dock)
- Version (read from build metadata or a version constant)
- Copyright notice
- Brief description

#### 6.0.1.4 Settings Card Specification {#settings-card-spec}

**Spec S04: Settings Card** {#s04-settings-card}

| Property | Value |
|----------|-------|
| Component ID | `"settings"` |
| Feed subscriptions | none (`feedIds: []`) |
| CardMeta.title | `"Settings"` |
| CardMeta.icon | `"Settings"` (requires adding `Settings` to `ICON_MAP` in `card-header.ts`) |
| CardMeta.closable | `true` |
| CardMeta.menuItems | `[]` |

**Sections:**

1. **Theme Selector** -- radio group or select for Brio/Bluenote/Harmony. Reads/writes `localStorage("td-theme")` and applies theme class to `document.body`. Same logic currently in `dock.ts`.

2. **Developer Mode Toggle** -- checkbox. On mount, calls `window.webkit.messageHandlers.getSettings.postMessage({})` to read current state from Mac app UserDefaults (bridge direct call is acceptable for read-only initialization; the canonical action dispatch path is for mutations only). On change, sends a `set-dev-mode` Control frame via WebSocket (using `sendControlFrame("set-dev-mode", {enabled: BOOL})`). This goes through tugcast broadcast -> action dispatcher -> bridge call, ensuring the same code path as `tugcode tell set-dev-mode -p enabled=true`. The action handler updates the checkbox optimistically, then the bridge callback `window.__tugBridge.onDevModeChanged(bool)` confirms the actual state. **Optimistic rollback:** If the confirmed state differs from the optimistic update (e.g., the native side rejected the toggle because no source tree is set), the Settings card reverts its checkbox to the confirmed value. If the `onDevModeChanged` callback does not arrive within 3 seconds (bridge unavailable or crashed), the checkbox reverts to its pre-toggle state and a note is shown: "dev mode toggle requires the Tug app." The timeout is managed by a `setTimeout` that is cleared if the callback arrives in time.

3. **Source Tree Path** -- displays current path as read-only text (populated from `getSettings` response). "Choose..." button sends a `choose-source-tree` Control frame via WebSocket. This goes through tugcast broadcast -> action dispatcher -> bridge call. Mac app presents NSOpenPanel, validates via `TugConfig.isValidSourceTree()`, persists to UserDefaults, restarts tugcast if dev mode is on. Confirmation callback `window.__tugBridge.onSourceTreeSelected(path)` updates the displayed path. Falls back to informational "source tree picker requires the Tug app" text when bridge is unavailable.

#### 6.0.1.5 tugcode tell CLI Specification {#cli-tell-spec}

**Spec S05: tugcode tell CLI** {#s05-cli-tell}

**Usage:**
```
tugcode [--json] tell <ACTION> [--port <PORT>] [--param <KEY>=<VALUE>]...
```

**Arguments:**
- `ACTION` -- Required positional argument. The action name (e.g., `show-card`, `restart`).
- `--port <PORT>` -- Optional. tugcast port. Default: `7890`.
- `--param <KEY>=<VALUE>` or `-p <KEY>=<VALUE>` -- Optional, repeatable. Additional parameters added to the JSON body.

Note: JSON output is controlled by the global `--json` flag (on `tugcode`, not on `tell`). This is consistent with all other tugcode subcommands. The `Tell` variant in `Commands` does NOT define its own `--json` argument.

**Param type coercion:** The `-p key=value` parser automatically coerces value types before building the JSON body. Rules are applied in order (first match wins):

1. `"true"` / `"false"` (case-sensitive, exact match) -> JSON boolean
2. `"null"` (exact match) -> JSON null
3. Integer strings (parseable as `i64`, no leading zeros) -> JSON number. E.g., `"42"`, `"-1"`, `"0"` -> number. But `"01"`, `"007"` -> string (leading zeros are ambiguous).
4. Float strings (parseable as `f64`, no leading zeros, finite) -> JSON number. E.g., `"3.14"`, `"1e5"`, `"-0.5"` -> number. But `"NaN"`, `"Infinity"`, `"01.5"` -> string.
5. Everything else -> JSON string. Including: `""` (empty), `" true "` (whitespace-padded, no trimming), `"TRUE"` (wrong case), `"01"` (leading zero).

This ensures `-p enabled=true` produces `{"enabled": true}` (boolean), not `{"enabled": "true"}` (string). Without coercion, the WKScriptMessageHandler bridge would fail to extract boolean values from message bodies.

**Examples:**
```bash
tugcode tell show-card -p component=about
tugcode tell restart
tugcode tell show-card --port 8080 -p component=settings
tugcode --json tell set-dev-mode -p enabled=true
```

**Output (default):**
```
ok
```

**Output (tugcode --json tell ...):**
```json
{"schema_version":"1","command":"tell","status":"ok","data":{"server_status":"ok"},"issues":[]}
```

**Exit codes:**
- 0 -- Success (HTTP 200)
- 1 -- Error (connection refused, HTTP 4xx/5xx, timeout)

#### 6.0.1.6 WKScriptMessageHandler Bridge Specification {#webkit-bridge-spec}

**Spec S06: WebKit Bridge** {#s06-webkit-bridge}

**Handler Registration (MainWindow.swift init):**
```swift
let contentController = WKUserContentController()
contentController.add(self, name: "chooseSourceTree")
contentController.add(self, name: "setDevMode")
contentController.add(self, name: "getSettings")
config.userContentController = contentController
```

**Message Protocol (JS to native):**

| Handler | JS Call | Native Response (via evaluateJavaScript) |
|---------|---------|------------------------------------------|
| `chooseSourceTree` | `window.webkit.messageHandlers.chooseSourceTree.postMessage({})` | `window.__tugBridge.onSourceTreeSelected('escaped-path')` or `window.__tugBridge.onSourceTreeCancelled()` |
| `setDevMode` | `window.webkit.messageHandlers.setDevMode.postMessage({enabled: bool})` | `window.__tugBridge.onDevModeChanged(bool)` |
| `getSettings` | `window.webkit.messageHandlers.getSettings.postMessage({})` | `window.__tugBridge.onSettingsLoaded({devMode: bool, sourceTree: 'escaped-path-or-null'})` |

**JavaScript escaping:** Path strings must escape `\` to `\\` and `'` to `\'` before embedding in `evaluateJavaScript` calls.

---

### 6.0.2 Symbol Inventory {#symbol-inventory}

#### 6.0.2.1 New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/action-dispatch.ts` | Action registry and dispatcher |
| `tugdeck/src/cards/about-card.ts` | About TugCard implementation |
| `tugdeck/src/cards/settings-card.ts` | Settings TugCard implementation |
| `tugcode/crates/tugcode/src/commands/tell.rs` | `tugcode tell` command handler |

#### 6.0.2.2 Modified files {#modified-files}

| File | Changes |
|------|---------|
| `tugcode/crates/tugcast/src/server.rs` | Add `POST /api/tell` route handler with custom JSON error handling and remote address rejection |
| `tugcode/crates/tugcast/src/router.rs` | Add `client_action_tx` broadcast channel for outbound Control frames; extend `handle_client` to forward client-bound frames |
| `tugcode/crates/tugcast/src/main.rs` | Create `client_action_tx` channel and pass to `FeedRouter::new()` |
| `tugcode/crates/tugcast/src/integration_tests.rs` | Update all 8 `FeedRouter::new()` call sites to pass `client_action_tx` parameter |
| `tugdeck/src/protocol.ts` | Extend `controlFrame()` to accept optional params object |
| `tugdeck/src/connection.ts` | Extend `sendControlFrame()` to accept optional params: `sendControlFrame(action: string, params?: Record<string, unknown>)` |
| `tugdeck/src/deck-manager.ts` | Extend `sendControlFrame()` to accept optional params; add `findPanelByComponent()` (reverse iteration per D09), `closePanelByComponent()` helpers; update `titleForComponent()` |
| `tugdeck/src/card-header.ts` | Add `Info` and `Settings` to `ICON_MAP` (import from lucide) |
| `tugdeck/src/dock.ts` | Replace About alert with `dispatchAction({action: "show-card", component: "about"})` |
| `tugdeck/src/main.ts` | Register `about` and `settings` card factories; initialize action dispatch |
| `tugapp/Sources/MainWindow.swift` | Add WKUserContentController, WKScriptMessageHandler conformance, chooseSourceTree/setDevMode/getSettings handlers, BridgeDelegate protocol, JS escaping utility |
| `tugapp/Sources/AppDelegate.swift` | Add `tell()` helper; extract `serverPort`; replace menu actions with `tell()` calls; implement BridgeDelegate; remove `settingsWindowController` |
| `tugcode/crates/tugcode/src/cli.rs` | Add `Tell` variant to `Commands` enum |
| `tugcode/crates/tugcode/src/commands/mod.rs` | Add `tell` module |
| `tugcode/crates/tugcode/src/output.rs` | Add `TellData` struct |
| `tugcode/crates/tugcode/Cargo.toml` | Add `ureq` dependency |

#### 6.0.2.3 Deleted files {#deleted-files}

| File | Reason |
|------|--------|
| `tugapp/Sources/SettingsWindow.swift` | Replaced by Settings TugCard + WKScriptMessageHandler bridge |

#### 6.0.2.4 Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `tell_handler` | async fn | `tugcast/src/server.rs` | Axum handler for POST /api/tell with custom JSON extraction |
| `TellRequest` | struct | `tugcast/src/server.rs` | Deserialized JSON body |
| `TellResponse` | struct | `tugcast/src/server.rs` | JSON response body |
| `client_action_tx` | `broadcast::Sender<Frame>` | `tugcast/src/router.rs` | Channel for client-bound Control frames |
| `registerAction` | fn | `tugdeck/src/action-dispatch.ts` | Register action handler |
| `dispatchAction` | fn | `tugdeck/src/action-dispatch.ts` | Dispatch action to handler |
| `initActionDispatch` | fn | `tugdeck/src/action-dispatch.ts` | Wire up Control feed callback and built-in actions |
| `AboutCard` | class | `tugdeck/src/cards/about-card.ts` | Implements TugCard |
| `SettingsCard` | class | `tugdeck/src/cards/settings-card.ts` | Implements TugCard |
| `controlFrame` | fn (modified) | `tugdeck/src/protocol.ts` | Accept optional params parameter |
| `sendControlFrame` | method (modified) | `tugdeck/src/connection.ts` | Accept optional params: `(action: string, params?: Record<string, unknown>)` |
| `sendControlFrame` | method (modified) | `tugdeck/src/deck-manager.ts` | Accept optional params, pass through to `connection.sendControlFrame()` |
| `BridgeDelegate` | protocol | `tugapp/Sources/MainWindow.swift` | Delegate protocol for AppDelegate callbacks |
| `tell()` | method | `tugapp/Sources/AppDelegate.swift` | HTTP POST helper |
| `serverPort` | property | `tugapp/Sources/AppDelegate.swift` | Extracted from auth URL |
| `Tell` | enum variant | `tugcode/src/cli.rs` | CLI tell subcommand |
| `run_tell` | fn | `tugcode/src/commands/tell.rs` | Execute tell command |
| `coerce_value` | fn | `tugcode/src/commands/tell.rs` | Coerce string param to JSON value (bool/number/null/string) |
| `TellData` | struct | `tugcode/src/output.rs` | JSON envelope data payload for tell |
| `Info` | entry | `tugdeck/src/card-header.ts` ICON_MAP | Lucide Info icon |
| `Settings` | entry | `tugdeck/src/card-header.ts` ICON_MAP | Lucide Settings icon |

---

### 6.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test action dispatch registry, JSON parsing, action classification, param parsing, multi-card targeting | Core dispatch logic |
| **Integration** | Test /api/tell endpoint end-to-end, Control frame round-trip, remote rejection, hybrid timing | Server endpoint, WebSocket broadcast |
| **Manual** | Test Mac app menu items, native picker, visual card rendering, dev mode toggle, bridge callbacks | UI interactions requiring macOS app |

#### Specific Test Requirements {#test-requirements}

| Test | Type | Step | What to verify |
|------|------|------|----------------|
| Hybrid reset timing | Integration | 0 | Broadcast frame arrives at subscribed receiver BEFORE shutdown_tx fires |
| Multi-card topmost targeting | Unit | 1 | `findPanelByComponent` returns last (topmost) match when multiple exist |
| Mac app port extraction | Unit | 4 | Regex correctly extracts port from auth URL format `http://127.0.0.1:PORT/auth?token=TOKEN` |
| Mac app tell() on connection refused | Unit | 4 | `tell()` returns silently (no crash, no alert) when tugcast is down |
| Source-tree bridge callback escaping | Unit | 4 | Paths with backslashes, single quotes, and unicode are safely escaped for evaluateJavaScript |
| Source-tree bridge card-destroyed guard | Unit | 2.2 | Callback is a no-op if Settings card container is null/destroyed |
| Duplicate reload prevention | Unit | 1 | `reload_frontend` handler's `reloadPending` flag prevents second call |
| Remote address rejection | Manual | 0 | POST from non-127.0.0.1 returns 403 (requires real bound server, cannot use Router::oneshot) |
| Custom JSON rejection | Integration | 0 | Malformed JSON body returns `{"status":"error","message":"invalid JSON"}` not axum default |

### 6.0.4 Migration Notes {#migration-notes}

No data migration is required. The only breaking change is the deletion of `SettingsWindow.swift`, which removes the native Settings window. User preferences stored in `UserDefaults` (source tree path, dev mode) are unaffected -- the Settings tugcard reads/writes the SAME UserDefaults keys via the WKScriptMessageHandler bridge. Theme preferences in `localStorage` are unaffected.

---

### 6.0.5 Execution Steps {#execution-steps}

#### Step 0: HTTP /api/tell endpoint and bidirectional Control frames {#step-0}

**Commit:** `feat(tugcast): add POST /api/tell endpoint with bidirectional Control frames`

**References:** [D01] HTTP POST /api/tell as the single external entry point, [D02] Action classification, [D08] Control frame payload format for client actions, Spec S01, (#tell-endpoint-spec, #d01-err-json-extraction, #context, #strategy)

**Artifacts:**
- Modified `tugcast/src/server.rs` with new route and handler
- Modified `tugcast/src/router.rs` with client-bound broadcast channel and new `client_action_tx` parameter in `FeedRouter::new()`
- Modified `tugcast/src/main.rs` to create `client_action_tx` channel and pass to `FeedRouter::new()`
- Modified `tugcast/src/integration_tests.rs` to pass `client_action_tx` to all 8 `FeedRouter::new()` call sites (`build_test_app` helper and 7 direct calls in dev-mode and manifest-serving tests)
- New structs: `TellRequest`, `TellResponse`

**Tasks:**
- [ ] Add `client_action_tx: broadcast::Sender<Frame>` field to `FeedRouter` struct
- [ ] Add `client_action_tx` parameter to `FeedRouter::new()` constructor
- [ ] Create `client_action_tx` broadcast channel in tugcast `main.rs` and pass to `FeedRouter::new()`
- [ ] Update all 8 `FeedRouter::new()` call sites in `integration_tests.rs`: create a `broadcast::channel(BROADCAST_CAPACITY)` for `client_action_tx` in `build_test_app()` helper and in each test that directly constructs a `FeedRouter` (test_build_app_dev_mode, test_dev_reload_sse_endpoint, test_manifest_based_serving_files_entry, test_manifest_based_serving_dirs_entry, test_manifest_based_serving_index_html_injection, test_manifest_based_serving_path_traversal, test_manifest_based_serving_unknown_path_404)
- [ ] Implement `tell_handler` async fn in `server.rs`. Use `axum::extract::ConnectInfo<SocketAddr>` to check the remote address -- reject non-loopback sources with 403 `{"status":"error","message":"forbidden"}` using `addr.ip().is_loopback()` (handles both IPv4 `127.0.0.1` and IPv6 `::1`). Accept raw `Bytes` body, parse with `serde_json::from_slice` directly (NOT axum's `Json<T>` extractor) to produce custom error responses: return 400 `{"status":"error","message":"invalid JSON"}` on parse failure, 400 `{"status":"error","message":"missing action field"}` when `action` key is absent. Classify actions as server-only / hybrid / client-only per D02. Server-only: `restart` sends shutdown_tx(42). Hybrid: `reset` broadcasts via client_action_tx, sleeps ~100ms, then sends shutdown_tx(43). `reload_frontend` broadcasts via client_action_tx AND fires reload_tx if Some. Client-only: broadcast via client_action_tx. The handler accesses channels via `State(router): State<FeedRouter>`.
- [ ] Add `.into_make_service_with_connect_info::<SocketAddr>()` to the `axum::serve` call in `run_server()` to enable `ConnectInfo` extraction
- [ ] Add `POST /api/tell` route to `build_app()` in `server.rs` using `axum::routing::post`
- [ ] In `handle_client()` in `router.rs`, subscribe to `client_action_tx` and forward received frames to the WebSocket client as binary 0xC0 frames
- [ ] Extend the existing WebSocket Control frame handler: when a client sends a Control frame with an unrecognized action, broadcast it via `client_action_tx` to ALL clients including the sender (not just log a warning). Broadcast to all (no sender exclusion) is simpler and correct -- action handlers are idempotent, and the sender may need to receive its own action (e.g., Settings card sends set-dev-mode, action dispatcher needs to call bridge).
- [ ] For the `reload_frontend` WebSocket handler: keep existing SSE reload_tx behavior AND also broadcast via `client_action_tx` so tugdeck can call `location.reload()` in production mode
- [ ] For the `reset` WebSocket handler: broadcast via `client_action_tx` first, then sleep ~100ms, then send shutdown_tx(43)

**Tests:**
- [ ] Unit test: `TellRequest` deserialization (valid JSON with action, missing action, invalid JSON)
- [ ] Unit test: action classification (server-only vs hybrid vs client-only)
- [ ] Integration test: POST /api/tell with server action triggers shutdown_tx
- [ ] Integration test: POST /api/tell with client action broadcasts Control frame
- [ ] Integration test: POST /api/tell with reload_frontend fires both reload_tx and client_action_tx
- [ ] Integration test: POST /api/tell with malformed JSON returns custom 400 error (not axum default)
- [ ] Integration test: hybrid reset timing -- subscribe to client_action_tx, send reset, verify broadcast received BEFORE shutdown_tx fires

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with no warnings
- [ ] `cargo nextest run -p tugcast` passes all new and existing tests (all 8 updated FeedRouter::new() calls compile)
- [ ] Manual test: `curl -X POST http://127.0.0.1:7890/api/tell -H 'Content-Type: application/json' -d '{"action":"test-ping"}'` returns `{"status":"ok"}`
- [ ] Manual test: `curl -X POST http://127.0.0.1:7890/api/tell -d 'not json'` returns `{"status":"error","message":"invalid JSON"}`
- [ ] Manual acceptance test: non-loopback rejection. Bind tugcast to 0.0.0.0 temporarily (or use a machine with a second interface) and verify POST from a non-loopback address returns 403. The check uses `addr.ip().is_loopback()` so both IPv4 and IPv6 loopback are accepted. Note: this cannot be automated with `Router::oneshot()` because `ConnectInfo<SocketAddr>` requires a real bound server with actual socket peer addresses.

**Rollback:**
- Revert changes to `server.rs`, `router.rs`, `main.rs`, and `integration_tests.rs`

**Commit after all checkpoints pass.**

---

#### Step 1: Action dispatcher in tugdeck {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugdeck): add action dispatcher for incoming Control frames`

**References:** [D03] Action dispatcher as a Map registry, [D08] Control frame payload format, [D09] Multi-card targeting, Spec S02, Table T01, (#action-dispatch-spec, #d09-multi-card-targeting, #strategy)

**Artifacts:**
- New file: `tugdeck/src/action-dispatch.ts`
- Modified: `tugdeck/src/protocol.ts` (extend `controlFrame()`)
- Modified: `tugdeck/src/connection.ts` (extend `sendControlFrame()` to accept optional params)
- Modified: `tugdeck/src/deck-manager.ts` (extend `sendControlFrame()`, register Control feed callback, add helpers)
- Modified: `tugdeck/src/card-header.ts` (add `Info` and `Settings` to `ICON_MAP`)
- Modified: `tugdeck/src/main.ts` (initialize action dispatch)

**Tasks:**
- [ ] Create `tugdeck/src/action-dispatch.ts` with `ActionHandler` type, `handlers` Map, `registerAction()`, `dispatchAction()`, and `initActionDispatch(connection, deckManager)` functions
- [ ] In `initActionDispatch()`, register a callback on `connection.onFrame(FeedId.CONTROL, ...)` that decodes the UTF-8 payload as JSON and calls `dispatchAction()`
- [ ] Extend `controlFrame()` in `protocol.ts` to accept an optional `params: Record<string, unknown>` parameter that gets spread into the JSON payload alongside `action`
- [ ] Extend `sendControlFrame()` in `connection.ts` from `sendControlFrame(action: string)` to `sendControlFrame(action: string, params?: Record<string, unknown>)`. Internally calls `controlFrame(action, params)` and sends the resulting frame. The current signature `sendControlFrame(action: string)` calls `controlFrame(action)` which returns a `Frame` object -- the params are now forwarded through the same path.
- [ ] Extend `sendControlFrame()` in `deck-manager.ts` from `sendControlFrame(action: string)` to `sendControlFrame(action: string, params?: Record<string, unknown>)`. Pass through to `this.connection.sendControlFrame(action, params)`.
- [ ] Register built-in `show-card` handler: find topmost card of component type (reverse iteration per D09); if none, call `deckManager.addNewCard(component)`; if exists but is not topmost panel overall (not last in array), focus it; if exists and IS topmost panel overall (last in array), close it (toggle)
- [ ] Register built-in `focus-card` handler: find topmost existing card of component type (D09) and focus it (no-op if none)
- [ ] Register built-in `close-card` handler: find topmost existing card of component type (D09) and close it (no-op if none)
- [ ] Register built-in `reload_frontend` handler: maintain a module-level `reloadPending` boolean flag. If flag is already true, return (skip duplicate). Set flag to true, then call `location.reload()`.
- [ ] Register built-in `reset` handler: calls `localStorage.clear()` (clears ALL stored state)
- [ ] Register built-in `set-dev-mode` handler: update Settings card UI optimistically (if a Settings card is open, toggle its checkbox). Then call WKScriptMessageHandler bridge via `window.webkit?.messageHandlers?.setDevMode?.postMessage({enabled})` if available. If bridge unavailable, the optimistic UI update still happens, and a note is shown in the Settings card. This handler is NOT a no-op outside the Mac app -- the UI still responds to the action.
- [ ] Register built-in `choose-source-tree` handler: call WKScriptMessageHandler bridge via `window.webkit?.messageHandlers?.chooseSourceTree?.postMessage({})` if available. If bridge unavailable, show a note in the Settings card.
- [ ] Add `findPanelByComponent(componentId: string)` method to DeckManager: iterate `deckState.cards` in REVERSE order (topmost first per D09), return the FIRST panel containing a tab with the given componentId, or null
- [ ] Add `closePanelByComponent(componentId: string)` method to DeckManager: find topmost panel (same reverse iteration), close it
- [ ] Update `titleForComponent()` in `deck-manager.ts` to include `"about": "About"` and `"settings": "Settings"`
- [ ] Add `Info` and `Settings` icons to `ICON_MAP` in `card-header.ts`: import `Info` and `Settings` from `lucide`, add entries `Info` and `Settings` to the map object
- [ ] Call `initActionDispatch(connection, deck)` in `main.ts` after DeckManager creation

**Tests:**
- [ ] Unit test: `registerAction` and `dispatchAction` routing
- [ ] Unit test: `controlFrame()` with params produces correct JSON
- [ ] Unit test: unknown action logs warning, does not throw
- [ ] Unit test: `findPanelByComponent` returns topmost (last) match when multiple panels of same component exist
- [ ] Unit test: `reload_frontend` handler `reloadPending` flag prevents second call within same page lifecycle

**Checkpoint:**
- [ ] `bun build tugdeck/src/main.ts` succeeds with no errors
- [ ] Manual test: send a `show-card` Control frame via curl to `/api/tell` and verify tugdeck logs the dispatch

**Rollback:**
- Delete `action-dispatch.ts`; revert changes to `protocol.ts`, `connection.ts`, `deck-manager.ts`, `card-header.ts`, `main.ts`

**Commit after all checkpoints pass.**

---

#### Step 2: About card and Settings card {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add About and Settings cards as TugCards`

**References:** [D04] About and Settings as full TugCard implementations, [D05] Source tree picker and dev mode via WKScriptMessageHandler bridge, Spec S03, Spec S04, (#about-card-spec, #settings-card-spec, #symbols)

> This step is large; broken into substeps with separate commits and checkpoints.

**Tasks:**
- [ ] Implement About card (Step 2.1)
- [ ] Implement Settings card (Step 2.2)

**Tests:**
- [ ] Unit test: both cards implement TugCard correctly

**Checkpoint:**
- [ ] Both cards open via `show-card` action and close via `close-card` action

##### Step 2.1: About card {#step-2-1}

**Commit:** `feat(tugdeck): add About card as TugCard`

**References:** [D04] About and Settings as full TugCard implementations, Spec S03, (#about-card-spec, #symbols)

**Artifacts:**
- New file: `tugdeck/src/cards/about-card.ts`
- Modified: `tugdeck/src/main.ts` (register about card factory)

**Tasks:**
- [ ] Create `AboutCard` class implementing `TugCard` interface with `feedIds: []`, CardMeta (title: "About", icon: "Info", closable: true, menuItems: [])
- [ ] `mount(container)` renders static HTML: app name, logo (TUG_LOGO_SVG), version string, copyright, brief description
- [ ] `onFrame()` is a no-op (no feed subscriptions)
- [ ] `onResize()` is a no-op (static content, CSS handles layout)
- [ ] `destroy()` cleans up container content
- [ ] Register factory in `main.ts`: `deck.registerCardFactory("about", () => new AboutCard())`

**Tests:**
- [ ] Unit test: AboutCard implements TugCard correctly (feedIds empty, meta present, meta.icon is "Info")

**Checkpoint:**
- [ ] `bun build tugdeck/src/main.ts` succeeds
- [ ] Manual test: `curl -X POST http://127.0.0.1:7890/api/tell -d '{"action":"show-card","component":"about"}'` opens About card with Info icon (not Box fallback)

**Rollback:**
- Delete `about-card.ts`; revert `main.ts` factory registration

**Commit after all checkpoints pass.**

---

##### Step 2.2: Settings card {#step-2-2}

**Depends on:** #step-2-1

**Commit:** `feat(tugdeck): add Settings card as TugCard`

**References:** [D04] About and Settings as full TugCard implementations, [D05] Source tree picker and dev mode via WKScriptMessageHandler bridge, Spec S04, Spec S06, (#settings-card-spec, #webkit-bridge-spec, #symbols)

**Artifacts:**
- New file: `tugdeck/src/cards/settings-card.ts`
- Modified: `tugdeck/src/main.ts` (register settings card factory)

**Tasks:**
- [ ] Create `SettingsCard` class implementing `TugCard` interface with `feedIds: []`, CardMeta (title: "Settings", icon: "Settings", closable: true, menuItems: [])
- [ ] **Theme selector section**: radio group or select for Brio/Bluenote/Harmony; read current from `localStorage("td-theme")`; apply via same `applyThemeClass()` logic as dock; save to localStorage; dispatch `td-theme-change` event
- [ ] **Developer mode toggle section**: checkbox. On mount, check if `window.webkit?.messageHandlers?.getSettings` is available. If available, call `postMessage({})` and register `window.__tugBridge.onSettingsLoaded` callback to populate the initial checkbox state from UserDefaults. On change: (1) store current state as `previousState`, (2) update checkbox optimistically, (3) start a 3-second `setTimeout` rollback timer, (4) send `set-dev-mode` Control frame via WebSocket (`sendControlFrame("set-dev-mode", {enabled: BOOL})`). Register `window.__tugBridge.onDevModeChanged(bool)` callback that: clears the rollback timer, checks if confirmed state matches optimistic state, reverts checkbox if they differ (e.g., native side rejected because source tree not set). If the 3-second timer fires without callback, revert checkbox to `previousState` and show note "dev mode toggle requires the Tug app." Guard callback against destroyed card (check container element).
- [ ] **Source tree path section**: display current path as read-only text (populated from `getSettings` response). "Choose..." button sends a `choose-source-tree` Control frame via WebSocket (`sendControlFrame("choose-source-tree")`). This goes through tugcast broadcast -> action dispatcher -> bridge call. Register `window.__tugBridge.onSourceTreeSelected(path)` callback to update display. Register `window.__tugBridge.onSourceTreeCancelled()` callback as no-op. Guard ALL callbacks: check that the Settings card's container element still exists before updating DOM (handles case where card is destroyed while native picker is open). Falls back to informational text "source tree picker requires the Tug app" when bridge is unavailable.
- [ ] `mount(container)` renders the settings form UI and registers `window.__tugBridge` callbacks
- [ ] `onResize()` is a no-op (CSS handles layout)
- [ ] `destroy()` cleans up event listeners, removes `window.__tugBridge` callbacks (set to no-op or delete)
- [ ] Register factory in `main.ts`: `deck.registerCardFactory("settings", () => new SettingsCard())`

**Tests:**
- [ ] Unit test: SettingsCard implements TugCard correctly (feedIds empty, meta present, meta.icon is "Settings")
- [ ] Unit test: theme change writes to localStorage
- [ ] Unit test: bridge callback is a no-op when container is null (destroyed card guard)
- [ ] Unit test: dev mode optimistic rollback -- simulate callback with different state than optimistic, verify checkbox reverts to confirmed value
- [ ] Unit test: dev mode timeout rollback -- simulate no callback within 3 seconds, verify checkbox reverts to previous state

**Checkpoint:**
- [ ] `bun build tugdeck/src/main.ts` succeeds
- [ ] Manual test: `curl -X POST http://127.0.0.1:7890/api/tell -d '{"action":"show-card","component":"settings"}'` opens Settings card with Settings icon (not Box fallback)
- [ ] Manual test: changing theme in Settings card updates tugdeck theme

**Rollback:**
- Delete `settings-card.ts`; revert `main.ts` factory registration

**Commit after all checkpoints pass.**

---

After completing Steps 2.1-2.2, you will have:
- About card displaying app information as a standard TugCard with Info icon
- Settings card with theme selector, dev mode toggle, and source tree path display
- Both cards registered as factories and openable via the action dispatch system

---

#### Step 3: Dock integration {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): update dock About to use action dispatch`

**References:** [D03] Action dispatcher as a Map registry, [D04] About and Settings as full TugCard implementations, Spec S02, (#action-dispatch-spec, #strategy)

**Artifacts:**
- Modified: `tugdeck/src/dock.ts`

**Tasks:**
- [ ] Replace the "About tugdeck" menu item's `window.alert()` call with `dispatchAction({action: "show-card", component: "about"})` (import from `action-dispatch.ts`)
- [ ] Verify theme selection in dock menu still works (it should, since it uses localStorage directly)
- [ ] Verify control actions (Restart Server, Reset Everything, Reload Frontend) still work via `sendControlFrame()`

**Tests:**
- [ ] Manual test: clicking "About tugdeck" in dock settings menu opens the About card (not an alert)

**Checkpoint:**
- [ ] `bun build tugdeck/src/main.ts` succeeds
- [ ] Manual test: dock About menu item opens About card

**Rollback:**
- Revert `dock.ts` changes

**Commit after all checkpoints pass.**

---

#### Step 4: WKScriptMessageHandler bridge, Mac app menu rewiring, and SettingsWindow deletion {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(tugapp): add WebKit bridge, wire menus through /api/tell, delete SettingsWindow`

**References:** [D05] Source tree picker and dev mode via WKScriptMessageHandler bridge, [D06] Mac app tell() helper, Spec S06, (#webkit-bridge-spec, #context, #strategy, #symbols, #deleted-files)

**Artifacts:**
- Modified: `tugapp/Sources/MainWindow.swift` (WKUserContentController, WKScriptMessageHandler, BridgeDelegate protocol)
- Modified: `tugapp/Sources/AppDelegate.swift` (tell() helper, BridgeDelegate implementation, serverPort extraction, menu rewiring)
- Deleted: `tugapp/Sources/SettingsWindow.swift`

**Tasks:**
- [ ] **MainWindow.swift -- WKUserContentController setup:** Create a `WKUserContentController` in `init`. Call `contentController.add(self, name: "chooseSourceTree")`, `contentController.add(self, name: "setDevMode")`, `contentController.add(self, name: "getSettings")`. Set `config.userContentController = contentController`. This is FROM SCRATCH -- there is no existing WKUserContentController.
- [ ] **MainWindow.swift -- BridgeDelegate protocol:** Define a `BridgeDelegate` protocol with methods: `func bridgeChooseSourceTree(completion: @escaping (String?) -> Void)`, `func bridgeSetDevMode(enabled: Bool, completion: @escaping (Bool) -> Void)`, `func bridgeGetSettings(completion: @escaping (Bool, String?) -> Void)`. Add `weak var bridgeDelegate: BridgeDelegate?` property.
- [ ] **MainWindow.swift -- WKScriptMessageHandler conformance:** Add `extension MainWindow: WKScriptMessageHandler` with `func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage)`. Switch on `message.name`:
  - `"chooseSourceTree"`: call `bridgeDelegate?.bridgeChooseSourceTree { path in ... }`, in callback: if path is nil, call `self.webView.evaluateJavaScript("window.__tugBridge?.onSourceTreeCancelled?.()")`, else escape the path for JS and call `self.webView.evaluateJavaScript("window.__tugBridge?.onSourceTreeSelected?.('\(escapedPath)')")`
  - `"setDevMode"`: extract `enabled` bool from `message.body`, call `bridgeDelegate?.bridgeSetDevMode(enabled: enabled) { confirmed in ... }`, in callback call `self.webView.evaluateJavaScript("window.__tugBridge?.onDevModeChanged?.(\(confirmed))")`
  - `"getSettings"`: call `bridgeDelegate?.bridgeGetSettings { devMode, sourceTree in ... }`, in callback: escape sourceTree, call `self.webView.evaluateJavaScript("window.__tugBridge?.onSettingsLoaded?.({devMode: \(devMode), sourceTree: \(sourceTreeJS)})")`
- [ ] **MainWindow.swift -- JS string escaping utility:** Add a private helper `func escapeForJS(_ str: String) -> String` that escapes `\` to `\\` and `'` to `\'` and newlines to `\\n`
- [ ] **MainWindow.swift -- Store contentController as property:** Add `private let contentController: WKUserContentController` as an instance property so it is accessible for cleanup. Add a `private var bridgeCleaned = false` flag to make cleanup idempotent.
- [ ] **MainWindow.swift -- cleanupBridge() method:** Add a public `func cleanupBridge()` method that checks `bridgeCleaned` flag, returns if already cleaned, otherwise calls `contentController.removeScriptMessageHandler(forName: "chooseSourceTree")`, `contentController.removeScriptMessageHandler(forName: "setDevMode")`, `contentController.removeScriptMessageHandler(forName: "getSettings")`, then sets `bridgeCleaned = true`. This is the primary cleanup path, called by AppDelegate from `applicationWillTerminate(_:)`. Note: `removeAllScriptMessageHandlers()` does not exist in the standard WebKit API -- use per-handler `removeScriptMessageHandler(forName:)` instead.
- [ ] **MainWindow.swift -- deinit safety net:** In MainWindow's `deinit`, call `cleanupBridge()`. This is a safety net -- `deinit` is not guaranteed to run in all shutdown paths (forced quit, crash), so the primary cleanup is via the explicit `cleanupBridge()` call from AppDelegate.
- [ ] **AppDelegate.swift -- applicationWillTerminate bridge cleanup:** In `applicationWillTerminate(_:)`, call `window.cleanupBridge()` to deregister script message handlers and break the retain cycle before shutdown.
- [ ] **AppDelegate.swift -- BridgeDelegate implementation:** Conform AppDelegate to `BridgeDelegate`. Implement:
  - `bridgeChooseSourceTree`: present NSOpenPanel (reuse existing `chooseSourceTree` logic), validate with `TugConfig.isValidSourceTree()`, save to UserDefaults, restart ProcessManager if dev mode, return path or nil
  - `bridgeSetDevMode`: save to UserDefaults, update Developer menu visibility, stop ProcessManager, restart with new mode, return confirmed enabled state
  - `bridgeGetSettings`: return current `devModeEnabled` and `sourceTreePath`
- [ ] **AppDelegate.swift -- Wire bridge delegate:** After creating `window` in `applicationDidFinishLaunching`, set `window.bridgeDelegate = self`
- [ ] **AppDelegate.swift -- serverPort extraction:** Add `private var serverPort: Int?` property. In the `onAuthURL` callback, extract the port number from the auth URL string using a regex or URL parsing and store in `serverPort`
- [ ] **AppDelegate.swift -- tell() helper:** Add `private func tell(_ action: String, params: [String: Any] = [:])` method that constructs a JSON body with `action` and params, POSTs to `http://127.0.0.1:\(serverPort)/api/tell`, fire-and-forget. Silently return if `serverPort` is nil.
- [ ] Change `showAbout(_:)` from `NSApp.orderFrontStandardAboutPanel(nil)` to `tell("show-card", params: ["component": "about"])`
- [ ] Change `showSettings(_:)` from `settingsWindowController.showWindow(nil)` to `tell("show-card", params: ["component": "settings"])`
- [ ] Change `reloadFrontend(_:)` from `window.reload()` to `tell("reload_frontend")`
- [ ] Change `restartServer(_:)` from `processManager.restart()` to `tell("restart")`
- [ ] Change `resetEverything(_:)` from `processManager.restart(); window.reload()` to `tell("reset")`
- [ ] Remove the `settingsWindowController` lazy property entirely
- [ ] Delete `tugapp/Sources/SettingsWindow.swift`
- [ ] Update `tugapp/Tug.xcodeproj/project.pbxproj` to remove all 4 SettingsWindow.swift references (PBXBuildFile, PBXFileReference, PBXGroup children, PBXSourcesBuildPhase)

**Tests:**
- [ ] Manual test: Tug app "About Tug" menu item opens About card in tugdeck (not native about panel)
- [ ] Manual test: Tug app "Settings..." menu item opens Settings card in tugdeck
- [ ] Manual test: Developer menu "Reload Frontend" works via tell()
- [ ] Manual test: Developer menu "Restart Server" works via tell()
- [ ] Manual test: Developer menu "Reset Everything" works via tell()
- [ ] Manual test: Settings card "Choose..." button opens native NSOpenPanel, selected path appears in card
- [ ] Manual test: Settings card dev mode toggle changes UserDefaults, restarts tugcast, Developer menu visibility updates
- [ ] Manual test: Settings card getSettings loads current dev mode and source tree on mount
- [ ] Manual test: tell() silently fails when tugcast is not running (no crash, no alert)
- [ ] Unit test (if feasible): `escapeForJS` correctly handles backslashes, single quotes, newlines, and unicode

**Checkpoint:**
- [ ] Tug.app builds successfully (Xcode build succeeds)
- [ ] `SettingsWindow.swift` no longer exists in the source tree
- [ ] All five menu actions work through the tell() path
- [ ] Source tree picker and dev mode toggle work from Settings card via bridge
- [ ] Dev mode toggle restarts tugcast with correct --dev flag

**Rollback:**
- Restore `SettingsWindow.swift` from git; revert MainWindow.swift and AppDelegate changes

**Commit after all checkpoints pass.**

---

#### Step 5: tugcode tell CLI subcommand {#step-5}

**Depends on:** #step-0

**Commit:** `feat(tugcode): add tell CLI subcommand for HTTP POST to /api/tell`

**References:** [D07] tugcode tell CLI subcommand, Spec S05, (#cli-tell-spec, #symbols)

**Artifacts:**
- New file: `tugcode/crates/tugcode/src/commands/tell.rs`
- Modified: `tugcode/crates/tugcode/Cargo.toml` (add `ureq` dependency)
- Modified: `tugcode/crates/tugcode/src/cli.rs` (add Tell variant)
- Modified: `tugcode/crates/tugcode/src/commands/mod.rs` (add tell module)
- Modified: `tugcode/crates/tugcode/src/main.rs` (match Tell command)
- Modified: `tugcode/crates/tugcode/src/output.rs` (add TellData struct)

**Tasks:**
- [ ] Add `ureq` dependency to `tugcode/crates/tugcode/Cargo.toml` (under `[dependencies]`). Use `ureq` (not reqwest) because it is a lightweight blocking HTTP client with no async runtime, matching tugcode's synchronous CLI pattern. Add as `ureq = "3"` (or latest stable).
- [ ] Add `TellData` struct to `output.rs`: `pub struct TellData { pub server_status: String }` with Serialize/Deserialize derives
- [ ] Add `Tell` variant to `Commands` enum in `cli.rs` with `action: String` (positional), `--port` (optional, default 7890), `--param` / `-p` (optional, repeatable, format `KEY=VALUE`). Do NOT add a per-subcommand `--json` flag -- use the existing global `--json` flag on `Cli` (`#[arg(long, global = true)]` at line 27), which is how all other subcommands handle JSON output.
- [ ] Create `tell.rs` with `run_tell(action, port, params, json_output)` function. The `json_output` parameter comes from `cli.json` (the global flag), not from a Tell-specific flag.
- [ ] Implement param type coercion: after splitting each `-p key=value` on the first `=`, apply automatic type coercion to the value string before inserting into the JSON body. Implement as a helper function `coerce_value(s: &str) -> serde_json::Value`. Rules (first match wins): (1) exact `"true"` -> `Bool(true)`, exact `"false"` -> `Bool(false)`; (2) exact `"null"` -> `Null`; (3) if `s` parses as `i64` AND does not have leading zeros (reject if `s.len() > 1 && s.starts_with('0')` or `s.len() > 2 && s.starts_with("-0")`), return `Number(i64)`; (4) if `s` parses as `f64` AND the result is finite AND no leading zeros before decimal point, return `Number(f64)` -- this handles exponent forms like `"1e5"`; (5) everything else -> `String(s)`. No whitespace trimming -- exact match only.
- [ ] Build JSON body: `{"action": "<action>", ...coerced_params}` using `serde_json::json!` macro with the coerced values
- [ ] Use `ureq::post(url).send_json(body)` to POST to `http://127.0.0.1:<port>/api/tell`
- [ ] Default output: print `ok` on success, error message on failure
- [ ] JSON output: wrap in `JsonResponse<TellData>` envelope with `command: "tell"`, matching the existing tugcode JSON output convention from `output.rs`
- [ ] Handle errors: connection refused, timeout (5s), HTTP errors. When `json_output` is true (global `--json` flag), errors go through `JsonResponse::error()`.
- [ ] Wire `Tell` command in `main.rs` match

**Tests:**
- [ ] Unit test: CLI parsing for `tugcode tell show-card -p component=about`
- [ ] Unit test: CLI parsing for `tugcode tell restart` (no params)
- [ ] Unit test: CLI parsing for `tugcode tell show-card --port 8080 -p component=settings`
- [ ] Unit test: param parsing (`KEY=VALUE` split)
- [ ] Unit test: param type coercion -- basic cases: `coerce_value("true")` -> `Bool(true)`, `coerce_value("false")` -> `Bool(false)`, `coerce_value("null")` -> `Null`, `coerce_value("42")` -> `Number(42)`, `coerce_value("-42")` -> `Number(-42)`, `coerce_value("0")` -> `Number(0)`, `coerce_value("3.14")` -> `Number(3.14)`, `coerce_value("1e5")` -> `Number(100000.0)`, `coerce_value("-0.5")` -> `Number(-0.5)`, `coerce_value("hello")` -> `String("hello")`, `coerce_value("TRUE")` -> `String("TRUE")` (case-sensitive)
- [ ] Unit test: param type coercion -- edge cases: `coerce_value("01")` -> `String("01")` (leading zero), `coerce_value("007")` -> `String("007")` (leading zeros), `coerce_value("01.5")` -> `String("01.5")` (leading zero in float), `coerce_value("")` -> `String("")` (empty), `coerce_value(" true ")` -> `String(" true ")` (no trimming), `coerce_value("NaN")` -> `String("NaN")` (non-finite), `coerce_value("Infinity")` -> `String("Infinity")` (non-finite), `coerce_value("-0")` -> `Number(0)` (negative zero parses as valid i64 0)

**Checkpoint:**
- [ ] `cargo build -p tugcode` succeeds with no warnings
- [ ] `cargo nextest run -p tugcode` passes all new and existing tests
- [ ] Manual test: `tugcode tell show-card -p component=about` opens About card in tugdeck
- [ ] Manual test: `tugcode --json tell show-card -p component=about` outputs JsonResponse envelope

**Rollback:**
- Delete `tell.rs`; revert `cli.rs`, `mod.rs`, `main.rs`, `output.rs`, `Cargo.toml` changes

**Commit after all checkpoints pass.**

---

#### Step 6: End-to-end integration and polish {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `test: end-to-end tugtell integration verification`

**References:** [D01] HTTP POST /api/tell, [D02] Action classification, [D03] Action dispatcher, [D05] WebKit bridge, [D06] Mac app tell(), [D07] CLI tell, [D09] Multi-card targeting, Spec S01, Spec S02, Spec S06, Table T01, (#success-criteria, #scope, #test-requirements)

**Artifacts:**
- Potential CSS additions for About and Settings card styling
- Any edge case fixes discovered during integration testing

**Tasks:**
- [ ] Verify all three entry points work end-to-end: Mac app menu, dock menu, and `tugcode tell` CLI all trigger the same actions and produce the same results
- [ ] Verify toggle behavior of `show-card`: first call opens, second call on topmost card closes (D09)
- [ ] Verify multi-card targeting: open two conversation cards, verify `show-card component=conversation` targets the topmost one
- [ ] Verify server actions from all entry points: restart, reset, reload_frontend
- [ ] Verify hybrid reset: `localStorage.clear()` is called before server exits (check by setting a localStorage key, calling reset, and verifying it is gone after restart)
- [ ] Verify Settings card dev mode toggle: toggle on -> tugcast restarts with --dev, Developer menu appears; toggle off -> tugcast restarts without --dev, Developer menu hides
- [ ] Verify Settings card source tree picker: "Choose..." opens NSOpenPanel, selected path saved to UserDefaults, displayed in card
- [ ] Verify Settings card theme change applies immediately and persists across reload
- [ ] Verify About card displays correct information and is visually appropriate (Info icon, not Box fallback)
- [ ] Add CSS styling for About and Settings cards if needed (consistent with retronow style system)
- [ ] Verify edge case: calling `tell()` before tugcast is ready (should silently fail)
- [ ] Verify edge case: multiple rapid `show-card` calls (should not create duplicate cards)
- [ ] Verify reload_frontend dedup: in dev mode, only one reload happens (not two from SSE + broadcast)
- [ ] Verify /api/tell from non-localhost is rejected with 403

**Tests:**
- [ ] Integration test: complete round-trip from HTTP POST through Control frame to action dispatch
- [ ] Manual test: all success criteria from Phase Overview are met

**Checkpoint:**
- [ ] All success criteria verified
- [ ] `cargo build -p tugcast -p tugcode` succeeds with no warnings
- [ ] `cargo nextest run` passes all tests
- [ ] `bun build tugdeck/src/main.ts` succeeds
- [ ] Tug.app builds and all menu items work correctly
- [ ] Settings card dev mode and source tree features are fully functional

**Rollback:**
- Revert any polish commits

**Commit after all checkpoints pass.**

---

### 6.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** External command interface for tugdeck via HTTP, with About and Settings cards (including functional dev mode toggle and native source tree picker), Mac app menu integration, WKScriptMessageHandler bridge, and CLI subcommand.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `POST /api/tell` endpoint returns 200 for valid requests, 403 for non-loopback, custom 400 for bad JSON
- [ ] Action dispatcher in tugdeck correctly routes `show-card`, `focus-card`, `close-card`, `reload_frontend`, `reset`, `set-dev-mode` actions
- [ ] Multi-card targeting works: actions target topmost card (highest z-index)
- [ ] About card renders app information as a standard TugCard with Info icon
- [ ] Settings card provides theme selection, functional dev mode toggle (via WKScriptMessageHandler bridge), and source tree picker (via NSOpenPanel bridge)
- [ ] Mac app menu items (About, Settings, Reload, Restart, Reset) all route through `tell()` to `/api/tell`
- [ ] `SettingsWindow.swift` is deleted; no native Settings window or standard about panel
- [ ] `tugcode tell` CLI works for all actions, with global `--json` envelope support
- [ ] Existing Control frame actions (restart, reset, reload_frontend) continue to work from dock menu
- [ ] WKScriptMessageHandler bridge in MainWindow.swift handles chooseSourceTree, setDevMode, getSettings
- [ ] reload_frontend deduplication prevents double-reload in dev mode

**Acceptance tests:**
- [ ] Integration test: POST /api/tell with show-card action round-trips through tugcast to tugdeck
- [ ] Integration test: tugcode tell CLI succeeds against running tugcast
- [ ] Manual acceptance test: non-loopback POST rejected with 403
- [ ] Manual test: All Mac app menu items trigger correct tugdeck actions
- [ ] Manual test: Settings card dev mode toggle restarts tugcast with correct flags
- [ ] Manual test: Settings card source tree picker opens NSOpenPanel and updates display

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] General-purpose reverse channel from tugcast to Mac app (polling, WebSocket, or other mechanism)
- [ ] Action namespacing if the action count grows unwieldy
- [ ] Auth token for /api/tell if tugcast ever binds to non-loopback
- [ ] Dock icon buttons migrated to action dispatch internally
- [ ] Additional built-in actions: `navigate`, etc.
- [ ] Bidirectional settings sync (tugcast confirming state changes back to UI independently of bridge)

| Checkpoint | Verification |
|------------|--------------|
| HTTP endpoint works | `curl -X POST http://127.0.0.1:7890/api/tell -d '{"action":"show-card","component":"about"}'` returns 200 |
| Remote rejection | Non-loopback POST returns 403 |
| Cards render correctly | Visual inspection: About has Info icon, Settings has Settings icon (not Box) |
| Menu items work | Manual test of all Mac app menu items |
| Dev mode toggle | Settings card toggle changes dev mode, restarts tugcast |
| Source tree picker | Settings card "Choose..." opens NSOpenPanel |
| CLI works | `tugcode tell show-card -p component=about` exits 0 |
| CLI JSON envelope | `tugcode --json tell ...` outputs JsonResponse format |
| No regressions | `cargo nextest run` and `bun build` succeed |

**Commit after all checkpoints pass.**
