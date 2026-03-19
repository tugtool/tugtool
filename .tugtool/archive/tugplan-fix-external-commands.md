## Phase 1.0: Fix External Command System and Dev Mode Toggle {#phase-fix-external-commands}

**Purpose:** Fix bugs in the existing external command system and dev mode toggle: eliminate the server restart on toggle, fix the `closePanelByComponent` type mismatch that breaks show-card toggling, remove dead workaround code, gate menu items on server readiness, and harden the bridge error paths.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | fix/external-commands-devmode |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-20 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The dev mode toggle, tell dispatch chain, and card show/close actions all have bugs that shipped in the initial implementation. Toggling dev mode in the Settings card triggers an immediate `processManager.stop()` / `processManager.start()` in `bridgeSetDevMode` (AppDelegate.swift:331-339), which kills the WebSocket connection and destroys WebView state. A fragile `td-reopen-settings` localStorage hack was added to work around this (settings-card.ts:189, main.ts:70-78), along with a 3-second rollback timer that races against the page reload (settings-card.ts:180-184).

Separately, `closePanelByComponent` in deck-manager.ts (line 1041) passes `activeTab.id` (a string) to `removeCard()` which expects a `TugCard` instance. This type mismatch means the show-card toggle action (close an already-visible card) silently fails, and the close-card action is broken.

The Mac app menu items "About Tug" and "Settings..." use the `tell()` HTTP dispatch chain, which is fire-and-forget and silently drops actions when the server is unavailable (during startup, restart windows, or stale port).

#### Strategy {#strategy}

- **Phase 1 (Immediate):** Fix the core bugs: remove restart from bridgeSetDevMode, replace optimistic UI with confirmed UI (disable-wait-ack), remove td-reopen-settings hack, fix closePanelByComponent type mismatch, gate menu items on server readiness, verify bridgeGetSettings flow. Add automated regression tests.
- **Phase 2 (Follow-Up):** Apply the deferred-restart pattern to source tree changes, audit evaluateJavaScript error paths.
- Fix the most impactful bugs first: the restart-on-toggle and closePanelByComponent break core UX.
- All changes modify existing files. No new files are created.
- Swift changes are in the `tugapp` directory; TypeScript changes are in the `tugdeck` directory.

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers using the Tug Mac app who toggle dev mode or use Mac menu items.
2. Users of the show-card/close-card toggle actions from the Dock or keyboard shortcuts.

#### Success Criteria (Measurable) {#success-criteria}

- Toggling dev mode saves the preference without restarting the server (verify: no WebSocket disconnect/reconnect after toggle).
- Dev mode toggle uses confirmed UI: checkbox is disabled during bridge round-trip, confirmed on ack, reverted with error on timeout.
- A "Restart Now" prompt appears after toggling dev mode; clicking it sends `{action: "restart"}` via `fetch('/api/tell')`, triggering exit code 42 and supervisor restart. Button has a 5-second fail-safe re-enable.
- The restart prompt persists if the Settings card is closed and reopened without restarting (tracked via runtime dev mode state, not preference).
- `grep -r "td-reopen-settings" tugdeck/src/` returns zero results.
- Clicking a Dock icon for an already-visible card closes it (show-card toggle works).
- The close-card action dispatched from action-dispatch.ts actually closes the card.
- Mac menu items "About Tug" and "Settings..." are disabled until the frontend signals readiness via `frontendReady` bridge message (fired from `connection.onOpen` after WebSocket connects). After ready, they reliably show their cards.
- `tell()` logs warnings on failure (nil port, HTTP error) rather than silently dropping actions.
- Automated regression tests exist for closePanelByComponent toggle-off and show-card/close-card dispatch.

#### Scope {#scope}

1. Fix `bridgeSetDevMode` in AppDelegate.swift: remove processManager restart.
2. Fix Settings card: replace optimistic UI with confirmed UI (disable-wait-ack), add restart prompt with "Restart Now" button.
3. Remove `td-reopen-settings` hack from settings-card.ts and main.ts.
4. Fix `closePanelByComponent` type mismatch in deck-manager.ts.
5. Gate menu items on server readiness: disable until frontend signals WebSocket connected via bridge (`frontendReady`), add error handling to tell().
6. Verify bridgeGetSettings/onSettingsLoaded flow.
7. Add automated regression tests for closePanelByComponent and show-card/close-card dispatch.
8. (Follow-Up) Deferred restart for source tree changes in AppDelegate.swift.
9. (Follow-Up) Audit evaluateJavaScript error paths in MainWindow.swift.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Redesigning the WebSocket protocol or control frame format.
- Adding new Mac menu items.
- Changing ProcessManager's supervisor loop exit code handling.
- Modifying the Rust tugcast server (tell_handler, router) unless a specific broadcast bug is found.
- Queuing and replaying tell() calls (roadmap/follow-on, not this phase).

#### Dependencies / Prerequisites {#dependencies}

- The `restart` action is already handled by the tell endpoint: tugcast's `tell_handler` sends exit code 42 via `shutdown_tx`, ProcessManager's supervisor loop calls `restart()`, which re-launches with current UserDefaults.
- The `action-dispatch.ts` set-dev-mode handler already calls `webkit.messageHandlers.setDevMode.postMessage`.
- The `/api/tell` endpoint and Control frame broadcast infrastructure already exist.

#### Constraints {#constraints}

- Swift changes (tugapp) and TypeScript changes (tugdeck) are in separate directories; coordinate testing across both.
- The WKScriptMessageHandler bridge is synchronous on the JS side but async on the Swift side.
- `bun build` bundles but does NOT type-check TypeScript. Type regressions (like the removeCard mismatch) are invisible to the bundler. Use `bun test` for runtime verification.
- The canonical Mac app build command is: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build`.

#### Assumptions {#assumptions}

- With the restart removed from bridgeSetDevMode, the `onDevModeChanged` bridge callback fires effectively instantly (<1ms same-process round-trip).
- The "Restart Now" button sends `{action: "restart"}` via `fetch('/api/tell')`, which the tell handler routes to `shutdown_tx.send(42)`. ProcessManager's supervisor loop restarts tugcast with the new dev mode preference from UserDefaults.
- Bridge error handling can use optional chaining and NSLog without throwing exceptions.
- Menu items are built during `applicationDidFinishLaunching` (line 43) before `onAuthURL` fires (line 46-52), so they must start disabled.
- "Reliably show cards" means: after the frontend sends the `frontendReady` bridge signal (fired from `connection.onOpen`, which requires auth URL received AND WebSocket connected). Before that signal, menu items are disabled.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Remove processManager restart from bridgeSetDevMode (DECIDED) {#d01-remove-restart}

**Decision:** In `bridgeSetDevMode(enabled:completion:)` (AppDelegate.swift:331-339), remove the `self.processManager.stop()` and `self.processManager.start(devMode:sourceTree:)` calls. Keep only: save preference, update menu visibility, call completion.

**Rationale:**
- The restart destroys the WebSocket and WebView state, requiring the td-reopen-settings workaround.
- UserDefaults persist across restarts, so the preference is applied on next explicit restart.
- The user should choose when to restart, not have it forced.

**Implications:**
- `onDevModeChanged` callback fires immediately with the confirmed state.
- A restart prompt is needed so the user knows a restart is required (see D03).

---

#### [D02] Confirmed UI for dev mode toggle (DECIDED) {#d02-confirmed-ui}

**Decision:** Replace the current optimistic-update-with-rollback UI with confirmed UI. When the user clicks the dev mode checkbox:

1. Disable the checkbox immediately (prevent double-click).
2. Send the `set-dev-mode` control frame.
3. Start a 3-second confirmation timeout.
4. On bridge ack (`onDevModeChanged`): enable checkbox, set confirmed state, show restart prompt if state changed from initial, clear timeout.
5. On timeout (no ack): revert checkbox to pre-toggle state, enable it, show error "Dev mode toggle requires the Tug app."

**Rationale:**
- Optimistic UI is unreliable. The user sees a state that may not be confirmed.
- Confirmed UI disables the control during the round-trip, making the pending state visible.
- With D01 removing the restart, the bridge round-trip is <1ms, so the disabled state is imperceptible in practice. But the timeout is still needed as a safety net when the bridge is unavailable (e.g., running in a browser without the Mac app).

**Implications:**
- Keep `devModeConfirmTimer` field (renamed from `devModeRollbackTimer`).
- Remove `previousDevModeState` field. Instead, capture the pre-toggle state locally in `handleDevModeToggle`.
- Remove the `td-reopen-settings` localStorage write.
- `handleDevModeToggle` disables checkbox, captures pre-toggle state, starts timer, sends frame.
- `onDevModeChanged` enables checkbox, clears timer, updates state, shows restart prompt.

---

#### [D03] Add "Restart Now" prompt after dev mode toggle (DECIDED) {#d03-restart-prompt}

**Decision:** After toggling dev mode and receiving the `onDevModeChanged` confirmation, show an inline notification in the Settings card: "Dev mode changed. Restart to apply." with a "Restart Now" button. The button calls `fetch('/api/tell', ...)` with `{action: "restart"}` to go through the tell endpoint, which handles restart directly via `shutdown_tx.send(42)`.

**Rationale:**
- With D01 removing the automatic restart, the user needs an explicit way to apply the change.
- Both `sendControlFrame("restart")` and `fetch('/api/tell')` trigger server shutdown — router.rs handles incoming WebSocket Control frames with `"restart"` action via `shutdown_tx.send(42)`, and tell_handler handles the same action via HTTP POST. We use `fetch('/api/tell')` because it opens a fresh TCP connection independent of the WebSocket's bidirectional state. If the WebSocket is under backpressure or in a degraded state, the HTTP path still reaches the server.
- TugConnection handles reconnection automatically with exponential backoff.

**UX specification:**
- The prompt is a div with class `settings-restart-prompt` placed below the dev mode toggle within the Developer Mode section.
- Contains a text span and a button. Uses existing `settings-dev-note` styling for the text, and `settings-choose-btn` styling for the button (consistent with the source tree "Choose..." button).
- Visible when current dev mode state differs from the initial state loaded from bridge. Hidden when they match. Visibility is updated **only** on bridge ack (`onDevModeChanged`) and initial load (`onSettingsLoaded`), not on toggle click, to maintain strict confirmed UI semantics.
- When "Restart Now" is clicked, the button text changes to "Restarting..." and the button is disabled. A 5-second fail-safe timer starts. Normal path: server restarts, WebSocket drops, and the reconnection banner handles the rest. Fail-safe: if WebSocket hasn't disconnected after 5 seconds (frame dropped, server unreachable), button re-enables with original text and a dev note shows "Restart failed. Try again or restart the app."

**Runtime vs preference state:** The prompt visibility compares checkbox state against `initialDevMode`, which must represent the server's **runtime** dev mode (what mode the process launched with), NOT the saved preference. After D01, these diverge: the preference updates immediately on toggle, but the runtime state only changes on restart. If `initialDevMode` were set from the preference, the prompt would incorrectly disappear when the Settings card is closed and reopened after a toggle (because `getSettings` returns the already-updated preference). Step 6 fixes `bridgeGetSettings` to return both `devMode` (preference) and `runtimeDevMode` (what the process launched with), and sets `initialDevMode` from `runtimeDevMode`.

**Implications:**
- New `restartPromptEl` and `restartBtn` fields on SettingsCard.
- Track `initialDevMode` from the runtime dev mode state returned by getSettings. Show prompt when checkbox differs from runtime; hide when they match.
- After server restarts, `onAuthURL` fires and updates `runtimeDevMode` to match the new preference. The Settings card (if re-opened) queries getSettings, gets matching values, and the prompt disappears.

---

#### [D04] Remove td-reopen-settings hack (DECIDED) {#d04-remove-reopen-hack}

**Decision:** Remove `localStorage.setItem("td-reopen-settings", "1")` from `handleDevModeToggle` (settings-card.ts:189). Remove the `connection.onOpen(...)` block from main.ts (lines 70-78) that checks for and removes this key.

**Rationale:**
- The hack exists solely to compensate for the restart destroying WebView state.
- With D01, no restart occurs, so the Settings card stays open and the hack is dead code.

**Implications:**
- The td-reopen-settings `connection.onOpen` callback registration in main.ts is removed. Step 5 replaces it with a new `connection.onOpen` callback that sends the `frontendReady` bridge signal.
- Cleaner startup path.

---

#### [D05] Fix closePanelByComponent type mismatch (DECIDED) {#d05-fix-close-panel}

**Decision:** In `closePanelByComponent` (deck-manager.ts:1038-1042), change line 1041 from `this.removeCard(activeTab.id)` to look up the card from `this.cardRegistry.get(activeTab.id)` and pass the TugCard instance to `removeCard()`.

**Rationale:**
- `removeCard(card: TugCard)` expects a TugCard, not a string. Passing a string causes the method to silently fail (it iterates feedIds on the string, finds no tab, does nothing).
- Other callers (`onClose` at line 467-469, `handleTabClose` at line 863-865) already do the cardRegistry lookup correctly.
- This bug breaks the show-card toggle (close an already-topmost card) and the close-card action.

**Implications:**
- Show-card action toggles correctly: clicking a Dock icon for the topmost card closes it.
- Close-card action dispatched from action-dispatch.ts works.
- Must add automated regression test (see D09).

---

#### [D06] Gate menu items on frontend-ready signal and harden tell() (DECIDED) {#d06-gate-menus}

**Decision:** Disable Mac menu items that depend on tell() until the frontend signals full readiness. Add error handling to tell() so failures are observable.

Specifically:

1. **Disable menu items at build time.** In `buildMenuBar()`, create the "About Tug" and "Settings..." menu items with `isEnabled = false`. Store references to them.
2. **Enable on frontend-ready signal (not auth URL).** When the WebSocket connects, tugdeck's `connection.onOpen` callback in main.ts sends `webkit.messageHandlers.frontendReady.postMessage({})`. MainWindow.swift routes this to `bridgeFrontendReady()` in AppDelegate, which enables the menu items. This ensures the full dispatch chain is operational: server is listening (auth URL received), WebView has loaded, and WebSocket is connected.
3. **Add completion handler to tell().** Instead of pure fire-and-forget, use the URLSession data task completion handler to log errors:
   ```swift
   URLSession.shared.dataTask(with: request) { _, response, error in
       if let error = error {
           NSLog("AppDelegate: tell(%@) failed: %@", action, error.localizedDescription)
       } else if let http = response as? HTTPURLResponse, http.statusCode != 200 {
           NSLog("AppDelegate: tell(%@) returned status %d", action, http.statusCode)
       }
   }.resume()
   ```
4. **Log nil serverPort.** In the `guard let port = serverPort else { ... }` path, add `NSLog("AppDelegate: tell() skipped, serverPort is nil (action: %@)", action)`.

**Rationale:**
- Menu items are built (line 43) before `onAuthURL` fires (line 46-52). During that window, clicking a menu item silently drops the action.
- Enabling on auth URL alone is insufficient: the WebSocket may not be connected yet, so tell() can reach the server but the broadcast has no subscribers. The frontend-ready signal confirms the full dispatch chain is operational.
- Disabling menu items makes the "not ready" state visible to the user (greyed out).
- Logging HTTP errors makes failures observable in Console.app without disrupting UX.
- Fire-and-forget is still the behavior (no retry, no queue), but failures are no longer silent.

**Implications:**
- New fields: `aboutMenuItem: NSMenuItem?`, `settingsMenuItem: NSMenuItem?`.
- New `bridgeFrontendReady()` method in AppDelegate enables menu items.
- New `frontendReady` handler in MainWindow.swift's WKScriptMessageHandler.
- New `connection.onOpen` callback in main.ts sends frontendReady signal.
- `BridgeDelegate` protocol gains `bridgeFrontendReady()`.
- On reconnect after restart, frontendReady fires again, re-enabling menu items (harmless if already enabled).
- During restart windows (server killed + restarting), menu items remain enabled but tell() may fail. The HTTP error is logged. This is acceptable because restart windows are brief (<2s) and user-initiated.

---

#### [D07] Deferred restart for source tree changes -- Follow-Up (DECIDED) {#d07-deferred-source-tree}

**Decision:** In the Follow-Up phase, apply the same save-then-prompt pattern to `chooseSourceTree()` (AppDelegate.swift:264-267) and `bridgeChooseSourceTree()` (AppDelegate.swift:323-326). Remove the `if devModeEnabled { processManager.stop(); processManager.start(...) }` blocks.

**Rationale:**
- Same class of bug as D01: immediate restart destroys WebView state.
- Consistency with the dev mode toggle behavior.

**Implications:**
- Settings card restart prompt reused for source tree changes.
- Prompt text generalized: "Settings changed. Restart to apply."

---

#### [D08] Audit evaluateJavaScript error paths -- Follow-Up (DECIDED) {#d08-audit-bridge-errors}

**Decision:** In the Follow-Up phase, add completion-handler error logging to all `evaluateJavaScript` calls in MainWindow.swift (lines 113, 115, 123, 134). Log failures with NSLog but do not throw.

**Rationale:**
- If the WebView is navigating, loading, or crashed, evaluateJavaScript may fail silently.
- Logging aids debugging without disrupting the UX.

**Implications:**
- Switch to the `evaluateJavaScript(_:completionHandler:)` variant.
- Log error with the message handler name for context.

---

#### [D09] Automated regression tests (DECIDED) {#d09-regression-tests}

**Decision:** Add automated tests (using `bun test`) that exercise:

1. **closePanelByComponent toggle-off path:** Create a DeckManager with a card, verify closePanelByComponent actually removes the card (not silently failing with the string/TugCard mismatch).
2. **show-card / close-card dispatch behavior:** Register the show-card and close-card action handlers, dispatch actions, verify cards are created/focused/closed.
3. **Test isolation via reset hook:** Add a `_resetForTest()` export to `action-dispatch.ts` that clears both the `handlers` map and the `reloadPending` flag. Tests call this in `beforeEach` to prevent cross-test pollution from the module-global registry.

**Rationale:**
- The closePanelByComponent type mismatch was invisible to `bun build` because it doesn't type-check. Only a runtime test catches this class of bug.
- The show-card toggle (close topmost) is a critical UX path that was silently broken. A regression test prevents this from recurring.
- The module-global `handlers` map and `reloadPending` flag in action-dispatch.ts persist across tests. Without a reset hook, tests leak registrations and state, causing order-dependent failures.

**Implications:**
- Tests go in `tugdeck/src/__tests__/` or similar, using bun's test runner.
- May require mocking TugConnection and the WebSocket to test in isolation.
- `_resetForTest()` is prefixed with underscore to signal internal/test-only usage. Production code (main.ts, action-dispatch.ts init path, card implementations) must never import or call it — it exists solely for test `beforeEach` isolation.
- Run via `bun test` in the tugdeck directory.

---

### 1.0.1 Tell Dispatch Chain Trace {#tell-chain-trace}

The full dispatch chain for a Mac menu item (e.g., "Settings...") to show a card:

1. **AppDelegate.swift** `showSettings(_:)` calls `tell("show-card", params: ["component": "settings"])`.
2. **AppDelegate.swift** `tell()` (lines 277-291): guards on `serverPort` being non-nil, builds JSON `{"action":"show-card","component":"settings"}`, POSTs to `http://127.0.0.1:{serverPort}/api/tell`. Completion handler logs errors.
3. **server.rs** `tell_handler` (lines 70-161): action `show-card` falls through to default case, calls `router.client_action_tx.send(frame)` -- broadcasts the Control frame to all WebSocket subscribers.
4. **router.rs** `handle_client` (line 272-288): `client_action_rx.recv()` picks up the frame, sends it as a binary WebSocket message to the client.
5. **connection.ts** `ws.onmessage`: decodes the binary frame, dispatches to callbacks registered for `FeedId.CONTROL`.
6. **action-dispatch.ts** `initActionDispatch` (line 59): registered a callback for `FeedId.CONTROL` that parses the JSON and calls `dispatchAction`.
7. **action-dispatch.ts** `dispatchAction` (line 34): looks up `show-card` handler (line 72), calls `deckManager.addNewCard("settings")` or `deckManager.focusPanel()` or `deckManager.closePanelByComponent()`.

**Bug at step 7:** The `closePanelByComponent` call (the "toggle off" path) is broken due to D05. This means even if the tell chain works perfectly, the toggle-off case silently fails.

**Readiness window at step 2:** `serverPort` is set in the `onAuthURL` callback (AppDelegate.swift:48-51). Menu items are built before this (line 43). With D06, menu items start disabled and are enabled when the `frontendReady` bridge signal fires (after WebSocket connects), making this window explicit to the user (greyed-out items) rather than a silent failure. This closes the race where auth URL is received but WebSocket hasn't connected yet.

**Restart window at step 2:** During server restart (e.g., after "Restart Now"), the port is known but the server is briefly unavailable. tell() will fire an HTTP request that fails. With D06, the error is logged. This is acceptable: restart windows are brief and user-initiated.

---

### 1.0.2 Existing Symbol Inventory {#symbol-inventory}

All files below already exist. No new files are created (except test files).

#### Files to Modify {#files-to-modify}

| File | Repo Dir | Bug |
|------|----------|-----|
| `Sources/AppDelegate.swift` | tugapp | bridgeSetDevMode restarts processManager; tell() silently fails; menu items not gated on readiness |
| `Sources/MainWindow.swift` | tugapp | Missing frontendReady handler; evaluateJavaScript calls lack error handling (Follow-Up) |
| `src/cards/settings-card.ts` | tugdeck | Optimistic UI races restart; td-reopen-settings hack; no restart prompt |
| `src/main.ts` | tugdeck | td-reopen-settings onOpen callback is dead code; missing frontendReady signal |
| `src/deck-manager.ts` | tugdeck | closePanelByComponent passes string to removeCard(TugCard) |
| `src/action-dispatch.ts` | tugdeck | Module-global handler registry has no reset API for testing |
| `src/connection.ts` | tugdeck | No `onClose` API exposed (needed for restart fail-safe timer clearing) |

#### Symbols to Modify {#symbols-to-modify}

| Symbol | Kind | File | Bug / Change |
|--------|------|------|-------------|
| `bridgeSetDevMode(enabled:completion:)` | method | AppDelegate.swift | Remove processManager.stop()/start() |
| `tell(_:params:)` | method | AppDelegate.swift | Add completion handler for error logging, log nil serverPort |
| `buildMenuBar()` | method | AppDelegate.swift | Store refs to About/Settings menu items, start disabled |
| `onAuthURL` closure | closure | AppDelegate.swift | Sets serverPort, loads URL, updates runtimeDevMode (menu enabling moved to bridgeFrontendReady) |
| `aboutMenuItem` | field (new) | AppDelegate.swift | Reference to About Tug menu item for enable/disable |
| `settingsMenuItem` | field (new) | AppDelegate.swift | Reference to Settings menu item for enable/disable |
| `handleDevModeToggle()` | method | settings-card.ts | Confirmed UI: disable checkbox, send frame, start timer |
| `initBridge()` | method | settings-card.ts | onDevModeChanged: enable checkbox, clear timer, show prompt |
| `mount(container:)` | method | settings-card.ts | Add restart prompt DOM elements |
| `destroy()` | method | settings-card.ts | Clean up timer, restartPromptEl |
| `devModeRollbackTimer` | field | settings-card.ts | Rename to `devModeConfirmTimer`, keep as confirmation timeout |
| `previousDevModeState` | field | settings-card.ts | Delete (pre-toggle state captured locally) |
| `initialDevMode` | field (new) | settings-card.ts | Track runtime dev mode state (NOT preference) for restart prompt |
| `runtimeDevMode` | field (new) | AppDelegate.swift | Server's actual running dev mode (set on process start, updated on restart via onAuthURL) |
| `bridgeGetSettings(completion:)` | method | AppDelegate.swift | Add runtimeDevMode to return value: `(Bool, Bool, String?)` |
| `restartPromptEl` | field (new) | settings-card.ts | Restart prompt container element |
| `closePanelByComponent(componentId:)` | method | deck-manager.ts | Look up card from cardRegistry before calling removeCard |
| `onOpen` callback | anonymous fn | main.ts | Delete td-reopen-settings block; add frontendReady signal |
| `bridgeFrontendReady()` | method (new) | AppDelegate.swift | Enable menu items on frontend ready |
| `frontendReady` handler | case (new) | MainWindow.swift | Route frontendReady to delegate |
| `BridgeDelegate` | protocol | MainWindow.swift | Add `bridgeFrontendReady()`; change `bridgeGetSettings` signature to `(Bool, Bool, String?)` |
| `_resetForTest()` | function (new) | action-dispatch.ts | Clear handler registry and reloadPending for test isolation |
| `restartFailsafeTimer` | field (new) | settings-card.ts | Fail-safe timeout for restart button |
| `onClose` | method (new) | connection.ts | Register close callback, returns unsubscribe function `() => void` |
| `closeUnsubscribe` | field (new) | settings-card.ts | Stored unsubscribe from connection.onClose, called in destroy() |
| `closeCallbacks` | field (new) | connection.ts | Array of close callbacks (mirrors openCallbacks) |
| `chooseSourceTree(_:)` | method | AppDelegate.swift | Remove processManager restart (Follow-Up) |
| `bridgeChooseSourceTree(completion:)` | method | AppDelegate.swift | Remove processManager restart (Follow-Up) |
| `userContentController(_:didReceive:)` | method | MainWindow.swift | Add error logging to evaluateJavaScript (Follow-Up) |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Fix bridgeSetDevMode -- remove processManager restart {#step-0}

**Commit:** `fix(tugapp): remove processManager restart from bridgeSetDevMode`

**References:** [D01] Remove processManager restart (#d01-remove-restart), (#tell-chain-trace)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift`

**Tasks:**
- [ ] In `bridgeSetDevMode(enabled:completion:)` (lines 331-339), delete the two lines: `self.processManager.stop()` and `self.processManager.start(devMode: self.devModeEnabled, sourceTree: self.sourceTreePath)`. The method body becomes: `self.devModeEnabled = enabled` / `self.updateDeveloperMenuVisibility()` / `self.savePreferences()` / `completion(enabled)`.
- [ ] Verify that `updateDeveloperMenuVisibility()` (line 271-273) still correctly shows/hides the Developer menu based on `devModeEnabled`.
- [ ] **Add `runtimeDevMode` field** to track the server's actual running dev mode (distinct from the preference after D01):
  - Add field: `private var runtimeDevMode: Bool = false`.
  - In `applicationDidFinishLaunching`, after loading preferences, set `runtimeDevMode = devModeEnabled` (they match at launch).
  - In the `onAuthURL` callback, after setting `serverPort`, set `runtimeDevMode = devModeEnabled`. This updates on every process (re)start since `onAuthURL` fires each time the supervisor launches a new tugcast instance.
  - Update `bridgeGetSettings` to return both preference and runtime state:
    ```swift
    func bridgeGetSettings(completion: @escaping (Bool, Bool, String?) -> Void) {
        // (preferenceDevMode, runtimeDevMode, sourceTreePath)
        completion(devModeEnabled, runtimeDevMode, sourceTreePath)
    }
    ```

**Tests:**
- [ ] Manual test: toggle dev mode in Settings card, verify no WebSocket disconnect (no reconnect banner), Developer menu toggles visibility.

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds with no errors.
- [ ] Manual: toggling dev mode does not restart the server.

**Rollback:**
- Re-add the two processManager lines.

**Commit after all checkpoints pass.**

---

#### Step 1: Fix closePanelByComponent type mismatch {#step-1}

**Depends on:** #step-0

**Commit:** `fix(tugdeck): fix closePanelByComponent passing string to removeCard(TugCard)`

**References:** [D05] Fix closePanelByComponent type mismatch (#d05-fix-close-panel), (#tell-chain-trace)

**Artifacts:**
- Modified `tugdeck/src/deck-manager.ts`

**Tasks:**
- [ ] In `closePanelByComponent` (lines 1038-1042), change the body from:
  ```typescript
  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
  if (activeTab) {
    this.removeCard(activeTab.id);
  }
  ```
  to:
  ```typescript
  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId);
  if (activeTab) {
    const card = this.cardRegistry.get(activeTab.id);
    if (card) {
      this.removeCard(card);
    }
  }
  ```
  This matches the pattern used by the `onClose` callback (lines 467-469) and `handleTabClose` (lines 863-865).

**Tests:**
- [ ] `bun build src/main.ts --outfile=dist/app.js` succeeds without errors.
- [ ] Manual test: click a Dock icon for a card that is already topmost -- the card should close (toggle off). Click again -- the card should reopen.
- [ ] Manual test: dispatch a `close-card` action via the action dispatch system -- the card should close.

**Checkpoint:**
- [ ] `bun build` succeeds (note: does not type-check; runtime behavior verified by manual tests and regression tests in Step 7).
- [ ] Show-card toggle (close topmost) works.
- [ ] Close-card action works.

**Rollback:**
- Revert the closePanelByComponent change.

**Commit after all checkpoints pass.**

---

#### Step 2: Replace optimistic UI with confirmed UI in settings-card.ts {#step-2}

**Depends on:** #step-0

**Commit:** `fix(tugdeck): confirmed UI for dev mode toggle in Settings card`

**References:** [D02] Confirmed UI for dev mode toggle (#d02-confirmed-ui), [D04] Remove td-reopen-settings hack (#d04-remove-reopen-hack)

**Artifacts:**
- Modified `tugdeck/src/cards/settings-card.ts`

**Tasks:**
- [ ] Rename field `devModeRollbackTimer` to `devModeConfirmTimer`.
- [ ] Delete field `previousDevModeState`.
- [ ] Add field `initialDevMode: boolean = false` to track the bridge-confirmed initial state.
- [ ] Rewrite `handleDevModeToggle()`:
  ```typescript
  private handleDevModeToggle(): void {
    if (!this.devModeCheckbox) return;
    const newState = this.devModeCheckbox.checked;
    // Confirmed UI: disable checkbox during bridge round-trip
    this.devModeCheckbox.disabled = true;
    // Capture pre-toggle state for revert on timeout
    const preToggleState = !newState;
    // Confirmation timeout: revert if bridge doesn't respond
    this.devModeConfirmTimer = setTimeout(() => {
      if (!this.container || !this.devModeCheckbox) return;
      this.devModeCheckbox.checked = preToggleState;
      this.devModeCheckbox.disabled = false;
      this.showDevNote("dev mode toggle requires the Tug app");
    }, 3000);
    // Send control frame (do NOT write to localStorage)
    this.connection.sendControlFrame("set-dev-mode", { enabled: newState });
  }
  ```
- [ ] Rewrite `onDevModeChanged` callback in `initBridge()`:
  ```typescript
  bridge.onDevModeChanged = (confirmed: boolean) => {
    if (!this.container) return;
    if (this.devModeConfirmTimer) {
      clearTimeout(this.devModeConfirmTimer);
      this.devModeConfirmTimer = null;
    }
    if (this.devModeCheckbox) {
      this.devModeCheckbox.checked = confirmed;
      this.devModeCheckbox.disabled = false;
    }
    this.hideDevNote();
    this.updateRestartPrompt();
  };
  ```
- [ ] Remove `localStorage.setItem("td-reopen-settings", "1")` (was in handleDevModeToggle).
- [ ] Update `destroy()`: clear `devModeConfirmTimer` (renamed from devModeRollbackTimer), clean up restartPromptEl.

**Tests:**
- [ ] `bun build src/main.ts --outfile=dist/app.js` succeeds without errors.
- [ ] Manual test: toggle dev mode -- checkbox disables briefly, then re-enables with confirmed state. No rollback flicker.
- [ ] Manual test: no `td-reopen-settings` key appears in localStorage after toggle.

**Checkpoint:**
- [ ] `bun build` succeeds.
- [ ] No references to `previousDevModeState` or `td-reopen-settings` in settings-card.ts.

**Rollback:**
- Revert settings-card.ts changes.

**Commit after all checkpoints pass.**

---

#### Step 3: Remove td-reopen-settings from main.ts {#step-3}

**Depends on:** #step-2

**Commit:** `fix(tugdeck): remove td-reopen-settings onOpen callback from main.ts`

**References:** [D04] Remove td-reopen-settings hack (#d04-remove-reopen-hack)

**Artifacts:**
- Modified `tugdeck/src/main.ts`

**Tasks:**
- [ ] Delete the comment on line 70: `// Re-show Settings card after dev mode toggle restart`.
- [ ] Delete the `connection.onOpen(...)` block (lines 71-78) that checks for `td-reopen-settings` in localStorage.

**Tests:**
- [ ] `bun build src/main.ts --outfile=dist/app.js` succeeds without errors.
- [ ] `grep -r "td-reopen-settings" tugdeck/src/` returns no results.

**Checkpoint:**
- [ ] `bun build` succeeds.
- [ ] Zero references to `td-reopen-settings` in the tugdeck codebase.

**Rollback:**
- Revert main.ts changes.

**Commit after all checkpoints pass.**

---

#### Step 4: Add restart prompt to Settings card {#step-4}

**Depends on:** #step-2, #step-5

**Commit:** `feat(tugdeck): add Restart Now prompt to Settings card after dev mode toggle`

**References:** [D03] Add Restart Now prompt (#d03-restart-prompt)

**Artifacts:**
- Modified `tugdeck/src/cards/settings-card.ts`
- Modified `tugdeck/src/connection.ts`
- Modified `tugdeck/styles/cards.css` (if needed for restart prompt styling)

**Tasks:**
- [ ] **Add `onClose` API to connection.ts** (mirrors existing `onOpen` pattern, returns unsubscribe function):
  - Add field: `private closeCallbacks: Array<() => void> = []`
  - Add method that returns an unsubscribe function:
    ```typescript
    onClose(callback: () => void): () => void {
      this.closeCallbacks.push(callback);
      return () => {
        const idx = this.closeCallbacks.indexOf(callback);
        if (idx >= 0) this.closeCallbacks.splice(idx, 1);
      };
    }
    ```
  - In the existing `ws.onclose` handler, iterate and call `closeCallbacks` before the reconnection logic:
    ```typescript
    for (const cb of this.closeCallbacks) {
      try { cb(); } catch (e) { console.error("onClose callback error:", e); }
    }
    ```
- [ ] Add fields: `restartPromptEl: HTMLElement | null = null`, `restartBtn: HTMLElement | null = null`, `restartFailsafeTimer: ReturnType<typeof setTimeout> | null = null`, `closeUnsubscribe: (() => void) | null = null`.
- [ ] In `mount()`, after the dev mode toggle section (after the devNoteEl), create the restart prompt:
  ```typescript
  this.restartPromptEl = document.createElement("div");
  this.restartPromptEl.className = "settings-restart-prompt";
  this.restartPromptEl.style.display = "none";
  const restartText = document.createElement("span");
  restartText.textContent = "Dev mode changed. Restart to apply.";
  this.restartBtn = document.createElement("button");
  this.restartBtn.className = "settings-choose-btn";
  this.restartBtn.textContent = "Restart Now";
  this.restartBtn.addEventListener("click", () => {
    if (this.restartBtn) {
      this.restartBtn.textContent = "Restarting...";
      this.restartBtn.disabled = true;
    }
    fetch("/api/tell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restart" }),
    }).catch((err) => console.error("restart fetch failed:", err));
    // Fail-safe: re-enable if WebSocket doesn't disconnect within 5s
    this.restartFailsafeTimer = setTimeout(() => {
      if (this.restartBtn) {
        this.restartBtn.textContent = "Restart Now";
        this.restartBtn.disabled = false;
      }
      this.showDevNote("Restart failed. Try again or restart the app.");
    }, 5000);
  });
  this.restartPromptEl.appendChild(restartText);
  this.restartPromptEl.appendChild(this.restartBtn);
  devSection.appendChild(this.restartPromptEl);
  ```
- [ ] Add private method `updateRestartPrompt()`: show restartPromptEl if `this.devModeCheckbox?.checked !== this.initialDevMode`; hide otherwise.
- [ ] In `initBridge()` `onSettingsLoaded` callback: after setting checkbox state from `data.devMode` (preference), set `this.initialDevMode = data.runtimeDevMode` (runtime state, NOT preference — see D03 "Runtime vs preference state"). Call `this.updateRestartPrompt()`.
- [ ] In `initBridge()` `onDevModeChanged` callback: call `this.updateRestartPrompt()` (added in Step 2). This is the **only** place the prompt updates after toggle — strict confirmed UI semantics.
- [ ] **Do NOT call `updateRestartPrompt()` from `handleDevModeToggle()`.** The restart prompt must only reflect confirmed state (bridge ack), not the pending click state.
- [ ] Clear `restartFailsafeTimer` on WebSocket disconnect (success signal for restart). Store the unsubscribe function returned by `onClose`:
  ```typescript
  this.closeUnsubscribe = this.connection.onClose(() => {
    if (this.restartFailsafeTimer) {
      clearTimeout(this.restartFailsafeTimer);
      this.restartFailsafeTimer = null;
    }
  });
  ```
  This prevents the false "Restart failed" message when the server restarts successfully but the page hasn't been torn down yet.
- [ ] In `destroy()`: call `this.closeUnsubscribe?.()` to remove the callback, then set `this.closeUnsubscribe = null`. Clear `this.restartFailsafeTimer`, set `this.restartPromptEl = null`, `this.restartBtn = null`.
- [ ] CSS for `.settings-restart-prompt`: flex row, gap 8px, align-items center, margin-top 8px. Reuse existing `settings-dev-note` color/font for the text span. Button uses `settings-choose-btn` class (already styled).

**Tests:**
- [ ] `bun build src/main.ts --outfile=dist/app.js` succeeds without errors.
- [ ] Manual test: toggle dev mode -> restart prompt appears with "Restart Now" button.
- [ ] Manual test: click "Restart Now" -> button says "Restarting..." -> server restarts (exit code 42) -> WebSocket reconnects.
- [ ] Manual test: toggle dev mode back to original state -> prompt disappears.

**Checkpoint:**
- [ ] `bun build` succeeds.
- [ ] Restart prompt appears and disappears correctly.
- [ ] "Restart Now" button triggers server restart.

**Rollback:**
- Revert settings-card.ts changes from this step.

**Commit after all checkpoints pass.**

---

#### Step 5: Gate menu items on frontend-ready signal and harden tell() {#step-5}

**Depends on:** #step-0, #step-1, #step-3

**Commit:** `fix(tugapp,tugdeck): gate menu items on frontend-ready signal, add error logging to tell()`

**References:** [D06] Gate menu items on frontend-ready signal (#d06-gate-menus), (#tell-chain-trace)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift`
- Modified `tugapp/Sources/MainWindow.swift`
- Modified `tugdeck/src/main.ts`

**Tasks:**
- [ ] **AppDelegate.swift — menu item fields and gating:**
  - Add private fields: `private var aboutMenuItem: NSMenuItem?` and `private var settingsMenuItem: NSMenuItem?`.
  - In `buildMenuBar()`, store references to the "About Tug" and "Settings..." menu items. Set `isEnabled = false` on both at creation time:
    ```swift
    let aboutItem = NSMenuItem(title: "About Tug", action: #selector(showAbout(_:)), keyEquivalent: "")
    aboutItem.isEnabled = false
    self.aboutMenuItem = aboutItem
    appMenu.addItem(aboutItem)
    // ...
    let settingsItem = NSMenuItem(title: "Settings...", action: #selector(showSettings(_:)), keyEquivalent: ",")
    settingsItem.isEnabled = false
    self.settingsMenuItem = settingsItem
    appMenu.addItem(settingsItem)
    ```
  - **Do NOT enable menu items in `onAuthURL`.** The `onAuthURL` callback only sets `serverPort` and loads the URL. Menu items stay disabled until frontendReady.
  - Add `bridgeFrontendReady()` method:
    ```swift
    func bridgeFrontendReady() {
        DispatchQueue.main.async {
            self.aboutMenuItem?.isEnabled = true
            self.settingsMenuItem?.isEnabled = true
        }
    }
    ```
- [ ] **AppDelegate.swift — harden tell():**
  - Rewrite `tell()` to log errors instead of pure fire-and-forget:
    ```swift
    private func tell(_ action: String, params: [String: Any] = [:]) {
        guard let port = serverPort else {
            NSLog("AppDelegate: tell() skipped, serverPort is nil (action: %@)", action)
            return
        }
        var body: [String: Any] = ["action": action]
        for (key, value) in params { body[key] = value }
        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else { return }
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/tell") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = jsonData
        URLSession.shared.dataTask(with: request) { _, response, error in
            if let error = error {
                NSLog("AppDelegate: tell(%@) failed: %@", action, error.localizedDescription)
            } else if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                NSLog("AppDelegate: tell(%@) returned status %d", action, http.statusCode)
            }
        }.resume()
    }
    ```
- [ ] **MainWindow.swift — add frontendReady handler and update getSettings for runtimeDevMode:**
  - Add `bridgeFrontendReady()` to the `BridgeDelegate` protocol.
  - Update `BridgeDelegate` protocol: change `bridgeGetSettings` signature from `completion: @escaping (Bool, String?) -> Void` to `completion: @escaping (Bool, Bool, String?) -> Void`.
  - Register the `frontendReady` message handler in the WKUserContentController setup (alongside chooseSourceTree, setDevMode, getSettings).
  - Add `frontendReady` case in `userContentController(_:didReceive:)`:
    ```swift
    case "frontendReady":
        bridgeDelegate?.bridgeFrontendReady()
    ```
  - Update the `"getSettings"` case to destructure both bools and include `runtimeDevMode` in the evaluateJavaScript call:
    ```swift
    case "getSettings":
        bridgeDelegate?.bridgeGetSettings { devMode, runtimeDevMode, sourceTree in
            let sourceTreeJS = sourceTree.map { "'\($0)'" } ?? "null"
            self.webView.evaluateJavaScript(
                "window.__tugBridge?.onSettingsLoaded?.({devMode: \(devMode), runtimeDevMode: \(runtimeDevMode), sourceTree: \(sourceTreeJS)})"
            )
        }
    ```
- [ ] **main.ts — send frontendReady signal on WebSocket open:**
  - Add `connection.onOpen` callback (replaces the removed td-reopen-settings callback from Step 3):
    ```typescript
    connection.onOpen(() => {
      (window as any).webkit?.messageHandlers?.frontendReady?.postMessage({});
    });
    ```
  - This fires on initial connect and on reconnect after restart, re-enabling menu items each time.
- [ ] **End-to-end verification:**
  - Start tugapp via `just app`.
  - Verify "About Tug" and "Settings..." are greyed out during startup.
  - After WebView loads and WebSocket connects, verify both menu items are enabled.
  - Click "Settings..." -> card appears.
  - Click "About Tug" -> card appears.
  - Click "Restart Now" in Settings -> server restarts -> during brief window, clicking a menu item should log an error in Console.app. After reconnect, menu items re-enable via frontendReady.

**Tests:**
- [ ] Manual test: start app -> menu items greyed out initially -> enabled after WebSocket connects -> both show cards.
- [ ] Manual test: immediately click a menu item during startup -> menu item is greyed out and unclickable.
- [ ] Manual test: check Console.app for any tell() error logs during normal operation (should be none).

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds.
- [ ] `bun build src/main.ts --outfile=dist/app.js` succeeds.
- [ ] Both menu items reliably show cards after WebSocket connects.
- [ ] Menu items are disabled during startup.

**Rollback:**
- Revert AppDelegate.swift, MainWindow.swift, and main.ts changes from this step.

**Commit after all checkpoints pass.**

---

#### Step 6: Verify bridgeGetSettings/onSettingsLoaded flow and runtimeDevMode tracking {#step-6}

**Depends on:** #step-0, #step-2, #step-4, #step-5

**Commit:** `test: verify bridgeGetSettings/onSettingsLoaded flow with runtimeDevMode`

**References:** [D03] Add Restart Now prompt (#d03-restart-prompt), [D01] Remove processManager restart (#d01-remove-restart), (#tell-chain-trace)

**Artifacts:**
- No code changes unless issues are found. The runtimeDevMode wiring is already in Steps 0 (AppDelegate field + bridgeGetSettings), 5 (BridgeDelegate protocol + getSettings handler), and 4 (settings-card initialDevMode = data.runtimeDevMode).

**Tasks:**
- [ ] Trace the full flow: `initBridge()` calls `webkit.messageHandlers.getSettings.postMessage({})` → MainWindow.swift `getSettings` case → `bridgeDelegate?.bridgeGetSettings(completion:)` → AppDelegate.swift `bridgeGetSettings` returns `(devModeEnabled, runtimeDevMode, sourceTreePath)` → MainWindow.swift `evaluateJavaScript("window.__tugBridge?.onSettingsLoaded?.({devMode:..., runtimeDevMode:..., sourceTree:...})")` → settings-card.ts `bridge.onSettingsLoaded` callback.
- [ ] **Verify the close-and-reopen scenario (runtimeDevMode tracking):**
  - Toggle dev mode → restart prompt shows (preference != runtime).
  - Close Settings card without restarting.
  - Reopen Settings card → `getSettings` returns `devMode: true, runtimeDevMode: false` → checkbox checked, `initialDevMode = false` → prompt STILL shows.
  - Click Restart Now → server restarts → `onAuthURL` sets `runtimeDevMode = devModeEnabled` → both match.
  - Reopen Settings card → `getSettings` returns `devMode: true, runtimeDevMode: true` → prompt hidden.
- [ ] **Verify initial state:**
  - When dev mode is enabled in UserDefaults AND server is running in dev mode: checkbox checked, no restart prompt.
  - When dev mode is disabled and source tree is nil: checkbox unchecked, no restart prompt.
  - When source tree path is set in UserDefaults: path element shows the path.
- [ ] If any issues are found (callback not firing, incorrect data, prompt misbehavior), fix and include in commit.

**Tests:**
- [ ] Manual test: toggle dev mode, close Settings, reopen → restart prompt still visible.
- [ ] Manual test: toggle dev mode, click Restart Now, reopen Settings → no prompt.
- [ ] Manual test: enable dev mode via `defaults write dev.tugtool.app DevModeEnabled -bool true`, open Settings → checkbox checked, no prompt (runtime matches preference at launch).

**Checkpoint:**
- [ ] Settings card correctly reflects saved preferences on mount.
- [ ] Restart prompt persists across close-and-reopen when restart is pending.

**Rollback:**
- N/A (verification step).

**Commit after all checkpoints pass.**

---

#### Step 7: Automated regression tests for closePanelByComponent and show-card/close-card {#step-7}

**Depends on:** #step-1, #step-3

**Commit:** `test(tugdeck): add regression tests for closePanelByComponent and action dispatch`

**References:** [D05] Fix closePanelByComponent type mismatch (#d05-fix-close-panel), [D09] Automated regression tests (#d09-regression-tests)

**Artifacts:**
- Modified `tugdeck/src/action-dispatch.ts` (add `_resetForTest()` export)
- New test file(s) in `tugdeck/src/` (e.g., `deck-manager.test.ts`, `action-dispatch.test.ts`, or added to existing test files)

**Tasks:**
- [ ] **Add `_resetForTest()` to action-dispatch.ts:**
  - Export a function that clears the module-global `handlers` map and resets `reloadPending` to `false`:
    ```typescript
    export function _resetForTest(): void {
      handlers.clear();
      reloadPending = false;
    }
    ```
  - Prefixed with underscore to signal internal/test-only usage.
- [ ] **closePanelByComponent regression test:**
  - Create a minimal DeckManager test setup (mock connection, mock container).
  - Register a card factory for a test componentId.
  - Call `addNewCard()` to create a card.
  - Verify the card exists via `findPanelByComponent()`.
  - Call `closePanelByComponent()`.
  - Verify the card is removed (findPanelByComponent returns null, cardRegistry no longer contains it).
  - This catches the bug where passing a string to removeCard() silently fails.
- [ ] **show-card dispatch test:**
  - Call `_resetForTest()` in `beforeEach` to prevent cross-test handler leakage.
  - Set up action-dispatch with a mock DeckManager.
  - Dispatch `{action: "show-card", component: "test"}` when no card exists -> verify `addNewCard` was called.
  - Dispatch again when the card is topmost -> verify toggle-off (closePanelByComponent was called).
  - Dispatch when the card exists but is not topmost -> verify focusPanel was called.
- [ ] **close-card dispatch test:**
  - Call `_resetForTest()` in `beforeEach`.
  - Dispatch `{action: "close-card", component: "test"}` when card exists -> verify closePanelByComponent was called.
  - Dispatch when no card exists -> verify no error, no-op.

**Tests:**
- [ ] `bun test` passes all new tests.

**Checkpoint:**
- [ ] All regression tests pass.
- [ ] Tests specifically exercise the closePanelByComponent code path (not just testing the happy path).

**Rollback:**
- Delete test files.

**Commit after all checkpoints pass.**

---

#### Step 8: (Follow-Up) Deferred restart for source tree changes {#step-8}

**Depends on:** #step-4

**Commit:** `fix(tugapp,tugdeck): apply deferred restart to source tree changes`

**References:** [D07] Deferred restart for source tree changes (#d07-deferred-source-tree)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift`
- Modified `tugdeck/src/cards/settings-card.ts`

**Tasks:**
- [ ] In `chooseSourceTree(_:)` (AppDelegate.swift:264-267), remove the `if devModeEnabled { processManager.stop(); processManager.start(devMode: true, sourceTree: url.path) }` block. Keep the preference save and menu update.
- [ ] In `bridgeChooseSourceTree(completion:)` (AppDelegate.swift:323-326), remove the `if self.devModeEnabled { self.processManager.stop(); self.processManager.start(devMode: true, sourceTree: url.path) }` block. Keep the preference save, menu update, and `completion(url.path)`.
- [ ] In settings-card.ts, in the `onSourceTreeSelected` callback, check if dev mode is enabled. If so, show the restart prompt. Generalize the prompt text to "Settings changed. Restart to apply."
- [ ] Track whether source tree has changed (compare against initial value from getSettings) to determine when to show/hide the restart prompt.

**Tests:**
- [ ] Manual test: with dev mode on, change source tree -> restart prompt appears -> click Restart Now -> server restarts with new source tree.
- [ ] Manual test: with dev mode off, change source tree -> no restart prompt (source tree only matters in dev mode).

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds.
- [ ] `bun build src/main.ts --outfile=dist/app.js` succeeds.
- [ ] Deferred restart works for source tree changes.

**Rollback:**
- Revert AppDelegate.swift and settings-card.ts changes for this step.

**Commit after all checkpoints pass.**

---

#### Step 9: (Follow-Up) Audit bridge error paths in MainWindow.swift {#step-9}

**Depends on:** #step-6

**Commit:** `fix(tugapp): add error logging to evaluateJavaScript calls in MainWindow`

**References:** [D08] Audit evaluateJavaScript error paths (#d08-audit-bridge-errors)

**Artifacts:**
- Modified `tugapp/Sources/MainWindow.swift`

**Tasks:**
- [ ] In the `WKScriptMessageHandler` extension (lines 105-139), for each `self.webView.evaluateJavaScript(...)` call (lines 113, 115, 123, 134), switch to the completion-handler variant:
  ```swift
  self.webView.evaluateJavaScript("...") { _, error in
      if let error = error {
          NSLog("MainWindow: evaluateJavaScript failed for %@: %@",
                message.name, error.localizedDescription)
      }
  }
  ```
- [ ] Verify that the optional chaining in the JS expressions (`window.__tugBridge?.onSettingsLoaded?.(...)`) means a missing bridge object evaluates to `undefined` and does not throw a JS exception.
- [ ] Consider the edge case where the WebView has navigated away (e.g., to a blank page or error page): the bridge callbacks won't exist, but optional chaining prevents a JS error. The Swift error callback may fire with a "JavaScript exception" error in this case -- log it and move on.

**Tests:**
- [ ] Manual test: open Settings card, verify no error logs in Console.app during normal operation.
- [ ] Manual test: check Console.app for any evaluateJavaScript warnings during app lifecycle.

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug -configuration Debug build` succeeds.
- [ ] No spurious error logs during normal operation.

**Rollback:**
- Revert MainWindow.swift changes.

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A working dev mode toggle with confirmed UI that saves preferences without restarting, provides a "Restart Now" prompt, has a working show-card toggle (closePanelByComponent fix), gated menu items, hardened tell(), clean codebase with no td-reopen-settings hack, and automated regression tests. Follow-up delivers deferred restart for source tree changes and bridge error logging.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Dev mode toggle does not restart the server (verify: no WebSocket disconnect on toggle).
- [ ] Dev mode toggle uses confirmed UI: checkbox disabled during bridge round-trip.
- [ ] "Restart Now" button sends restart via `fetch('/api/tell')` (verify: exit code 42 in process manager log). Button has 5-second fail-safe re-enable.
- [ ] `grep -r "td-reopen-settings" tugdeck/src/` returns zero results.
- [ ] Show-card toggle works: clicking Dock icon for topmost card closes it (verify: manual test + automated test).
- [ ] Close-card action works (verify: manual test + automated test).
- [ ] Mac menu "About Tug" and "Settings..." are disabled during startup, enabled after frontendReady signal (WebSocket connected), and reliably show their cards.
- [ ] `tell()` logs warnings on failure (nil port, HTTP error).
- [ ] Settings card loads correct saved state on mount (verify: manual test).
- [ ] Restart prompt persists across Settings card close-and-reopen when restart is pending (verify: toggle → close → reopen → prompt still visible).
- [ ] Automated regression tests pass for closePanelByComponent and show-card/close-card dispatch.

**Acceptance tests:**
- [ ] Integration test: toggle dev mode -> checkbox disables -> confirms -> prompt appears -> Restart Now -> server restarts -> reconnect -> new mode active.
- [ ] Integration test: Mac menu Settings -> card appears with correct saved state.
- [ ] Integration test: Dock icon click for topmost card -> card closes -> click again -> card reopens.
- [ ] Automated: `bun test` passes all regression tests.

#### Milestones (Within Phase) {#milestones}

**Milestone M01: Immediate Fixes Complete** {#m01-immediate-fixes}
- [ ] Steps 0-7 completed. All immediate bugs fixed, tell chain hardened, settings flow verified, regression tests passing.

**Milestone M02: Follow-Up Hardening Complete** {#m02-follow-up-hardening}
- [ ] Steps 8-9 completed. Source tree deferred restart and bridge error logging in place.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Startup readiness gate: queue tell() calls until serverPort is available, replay on ready.
- [ ] Evaluate whether the action-dispatch.ts set-dev-mode handler is redundant with the Settings card's direct bridge call.
- [ ] Full TypeScript type-checking in CI (e.g., `tsc --noEmit`) to catch type mismatches at build time.

| Checkpoint | Verification |
|------------|--------------|
| Immediate fixes | Steps 0-7 pass all checkpoints |
| Follow-up hardening | Steps 8-9 pass all checkpoints |
| No regressions | Themes, terminal, conversation, and other cards unaffected |
| Automated tests | `bun test` passes |

**Commit after all checkpoints pass.**
