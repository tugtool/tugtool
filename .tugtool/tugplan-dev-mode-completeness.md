<!-- tugplan-skeleton v2 -->

## Dev Mode Completeness Fixes {#dev-mode-completeness}

**Purpose:** Address the six issues raised in the dev mode completeness audit: theme-aware window background, workspace Cargo file watching, reset-as-relaunch, overflow clipping fix, Developer menu parity with badges, and dev mode toggle lifecycle verification.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | dev-mode-completeness |
| Last updated | 2026-02-28 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The dev mode completeness audit (`roadmap/dev-mode-completeness-audit.md`) identified six issues with the developer mode system. Three are high severity (flash-fix color mismatch, reset not relaunching, overflow clipping the dev mode toggle), two are medium severity (workspace Cargo files not watched, Developer menu missing Relaunch item and dirty badges), and one requires manual verification after the overflow fix. All six must be resolved before dev mode can be considered complete.

The existing codebase has solid foundations: the three-watcher architecture in `dev.rs`, the `ProcessManager` shutdown handling in Swift, the WKScriptMessageHandler bridge pattern in `MainWindow.swift`, and the theme system in `use-theme.ts` and `tokens.css`. Each fix builds on these existing patterns rather than introducing new architecture.

#### Strategy {#strategy}

- Fix Issue 4 (CSS overflow) first as it is a one-line change that unblocks Issue 6 verification.
- Fix Issue 2 (widen Rust watcher) next as it is a self-contained Rust change with existing test patterns.
- Fix Issue 3 (reset-as-relaunch) which requires a coordinated Swift change to ProcessManager.
- Fix Issue 1 (theme-aware window background) which requires a new WKScriptMessageHandler bridge and UserDefaults key.
- Fix Issue 5 (Developer menu Relaunch + badges) which requires another WKScriptMessageHandler and menu state management.
- Verify Issue 6 (dev mode on/off lifecycle) manually after all code changes are complete.
- Each step is independently committable with its own checkpoint.

#### Success Criteria (Measurable) {#success-criteria}

- Window background color matches active theme's `--tl-bg` value at startup for all three themes (visual inspection)
- Editing `tugcode/Cargo.toml` or `tugcode/Cargo.lock` triggers a "restart available" dev notification (`cargo nextest run` passes watcher tests)
- Reset action performs a full app relaunch (tugrelaunch), not just a backend restart (manual test: localStorage is cleared AND WKWebView is fresh)
- Developer Mode toggle in Settings card is visible and scrollable when card is small (`overflow-y: auto` in CSS)
- Developer menu contains Relaunch App item with keyboard shortcut; dirty items show diamond badge when stale
- Dev mode toggle off stops watchers and hides Developer card; toggle on restarts them (manual verification)
- `cargo nextest run` and `bun test` pass with zero failures after all changes

#### Scope {#scope}

1. Theme-aware window background via UserDefaults bridge (Issue 1)
2. Widen Rust source watcher to `tugcode/` with `/target/` exclusion and `Cargo.lock` matching (Issue 2)
3. Reset action uses relaunch path in ProcessManager.swift (Issue 3)
4. CSS overflow fix for `.card-frame-content` (Issue 4)
5. Developer menu: add Relaunch App item + diamond badge for dirty state (Issue 5)
6. Manual verification of dev mode on/off lifecycle (Issue 6)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Redesigning the watcher architecture (three-watcher model is retained)
- Adding new themes or changing existing theme color values
- Modifying the tugrelaunch binary or its build/spawn logic
- Changing exit codes in Rust (exit code 43 is retained for reset)

#### Dependencies / Prerequisites {#dependencies}

- Existing WKScriptMessageHandler bridge pattern in `MainWindow.swift` (used for `chooseSourceTree`, `setDevMode`, `getSettings`, `frontendReady`)
- `ProcessManager.swift` shutdown reason handling at lines 262-290
- `dev.rs` watcher infrastructure with `has_rust_extension()` filter and `dev_rust_source_watcher()`
- Theme system: `use-theme.ts` hook, `tokens.css` theme definitions, `td-theme-change` CustomEvent

#### Constraints {#constraints}

- macOS-only: all Swift changes target the Tug macOS app
- `cargo build` enforces `-D warnings` (no dead code, unused imports, etc.)
- WKScriptMessageHandler names must be registered in `MainWindow.init()` and cleaned up in `cleanupBridge()`

#### Assumptions {#assumptions}

- The three theme names (`brio`, `bluenote`, `harmony`) are stable and exhaustive for this phase.
- UserDefaults is available at app startup before `applicationDidFinishLaunching` creates the window.
- The `td-theme-change` CustomEvent fires reliably when themes change in both React and vanilla code paths.
- Existing test patterns in `dev.rs` (e.g., `test_rust_source_watcher_detects_rs_change`) are sufficient templates for new watcher tests.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| FSEvents `/target/` exclusion misses edge cases | low | low | String-based path check is straightforward; test with build artifacts | Spurious restart notifications during `cargo build` |
| Theme bridge race condition at startup | med | low | UserDefaults read is synchronous and happens before window creation | Theme flash visible on app launch |
| Diamond badge state goes stale | low | med | Badge state driven by same `dev_notification` events that drive the card | Menu shows stale badge after action taken |

**Risk R01: FSEvents target exclusion** {#r01-target-exclusion}

- **Risk:** Widening the watch path from `tugcode/crates/` to `tugcode/` may cause the Rust source watcher to fire on `/target/` build artifacts if the exclusion filter has gaps.
- **Mitigation:** Add a path-contains check for `/target/` in the event handler's filter function. Add a dedicated test that creates a file under a `target/` directory and verifies no notification fires.
- **Residual risk:** Unusual path layouts could bypass the string check, but standard Cargo project structure is well-defined.

**Risk R02: Theme bridge startup timing** {#r02-theme-startup-timing}

- **Risk:** If UserDefaults has no stored theme yet (first launch), the window background will use a default. If the frontend later applies a different theme, there will be a brief mismatch.
- **Mitigation:** Default to Brio's `--tl-bg` color (`#1c1e22`) when no UserDefaults key exists, matching the CSS default theme. The frontend also defaults to Brio.
- **Residual risk:** None for first launch. For theme changes, the runtime bridge update eliminates any gap.

---

### Design Decisions {#design-decisions}

#### [D01] Theme persistence via UserDefaults key "TugTheme" (DECIDED) {#d01-theme-userdefaults}

**Decision:** Add a `TugTheme` UserDefaults key that the frontend writes via a new `setTheme` WKScriptMessageHandler. Swift reads this key at startup to set the initial window background color.

**Rationale:**
- UserDefaults is synchronous and available before window creation, eliminating the flash.
- Matches the existing preference pattern used for `DevModeEnabled` and `SourceTreePath`.
- The frontend already persists theme to localStorage (`td-theme` key); adding a UserDefaults sync is a small addition.

**Implications:**
- A new `setTheme` message handler must be registered in `MainWindow.init()` and cleaned up in `cleanupBridge()`.
- `TugConfig.swift` gets a new `keyTheme` constant.
- `MainWindow` needs a `updateBackgroundForTheme(_:)` method that maps theme names to NSColor values.
- The `use-theme.ts` `setTheme` function (or a listener on `td-theme-change`) must post to the bridge.

#### [D02] Widen Rust watcher path with target exclusion (DECIDED) {#d02-widen-rust-watcher}

**Decision:** Change the Rust source watcher's watch path from `source_tree.join("tugcode/crates")` to `source_tree.join("tugcode")`, update `has_rust_extension()` to also match `Cargo.lock`, and add a path exclusion for any path containing `/target/` in the event filter.

**Rationale:**
- Workspace-root `Cargo.toml` and `Cargo.lock` affect compilation and should trigger restart notifications.
- Watching `tugcode/` recursively is simpler than adding multiple watch roots.
- The `/target/` exclusion prevents false positives from build artifacts.

**Implications:**
- `has_rust_extension()` renamed or extended to also match `Cargo.lock` filenames.
- A new `is_target_path()` helper or inline check added to the event filter in the debounce task.
- Existing tests extended with cases for `Cargo.lock` match and `/target/` exclusion.

#### [D03] Reset uses relaunch path in Swift only (DECIDED) {#d03-reset-relaunch-swift}

**Decision:** Keep exit code 43 in Rust for reset. Update `ProcessManager.swift` to handle shutdown reason `"reset"` identically to `"relaunch"` -- stop Vite, let tugrelaunch handle the full restart, set `restartDecision` to `.doNotRestart`.

**Rationale:**
- Preserves the semantic distinction between reset (exit 43) and restart (exit 42) in the Rust layer.
- The Swift ProcessManager already has the relaunch handling logic; reset just needs to follow the same path.
- Avoids changing the Rust shutdown protocol which other parts of the system depend on.

**Implications:**
- In `ProcessManager.swift`, the `"reset"` case in the shutdown handler moves from the `"restart"` branch to the `"relaunch"` branch.
- The Developer card reset button label changes from "Clear localStorage and restart" to "Clear localStorage and relaunch".

#### [D04] CSS overflow-y auto for card-frame-content (DECIDED) {#d04-overflow-auto}

**Decision:** Change `.card-frame-content` from `overflow: hidden` to `overflow-y: auto` so the Developer Mode toggle in the Settings card is accessible when the card is too small to show all sections.

**Rationale:**
- Single-line CSS fix that solves the clipping problem without layout changes.
- `overflow-y: auto` only shows a scrollbar when content exceeds the container, preserving the current appearance for cards that fit.

**Implications:**
- All card frame content areas become scrollable when their content overflows, not just the Settings card.

#### [D05] Developer menu Relaunch item and diamond badges via WKScriptMessageHandler (DECIDED) {#d05-menu-relaunch-badges}

**Decision:** Add a "Relaunch App" menu item to the Developer menu between "Restart Server" and "Reset Everything". Add a new `devBadge` WKScriptMessageHandler so the frontend posts badge state `{backend: Bool, app: Bool}` to Swift. AppDelegate updates menu titles by prepending/removing diamond character U+25C6 when rows become stale.

**Rationale:**
- The Developer menu should mirror all actions available in the Developer card.
- Diamond badge provides at-a-glance feedback without opening the Developer card.
- WKScriptMessageHandler is the established bridge pattern; adding `devBadge` follows the same pattern as `setDevMode` and `chooseSourceTree`.

**Implications:**
- `MainWindow.swift` registers `devBadge` message handler and adds to `BridgeDelegate` protocol.
- `AppDelegate.swift` stores references to the Restart Server and Relaunch App menu items for title updates.
- Frontend listens for `td-dev-notification` events and posts badge state via `webkit.messageHandlers.devBadge`.
- Keyboard shortcut for Relaunch App: Cmd+Option+Shift+R.
- Known limitation: badge state is only posted while the Developer card is mounted. If the card is closed, badge updates stop until it remounts. This is acceptable because the Developer card is the primary dev mode UI and is typically open during development. A future follow-on could move badge posting to a higher-level listener (e.g., `action-dispatch.ts`).

#### [D06] Issue 6 is verification only (DECIDED) {#d06-verification-only}

**Decision:** Issue 6 (dev mode on/off lifecycle) requires no code changes. It is a manual verification step with a checklist, performed after Issue 4 is fixed so the toggle is visible.

**Rationale:**
- The code paths for enable/disable dev mode are already implemented and tested.
- The only gap is manual end-to-end verification that the toggle works correctly in the running app.

**Implications:**
- A verification checklist is included in the final execution step.

---

### Specification {#specification}

#### Theme-to-Color Mapping {#theme-color-mapping}

**Table T01: Theme background colors** {#t01-theme-colors}

| Theme Name | UserDefaults Value | Window Background Hex | NSColor (sRGB) |
|------------|-------------------|-----------------------|----------------|
| Brio (default) | `"brio"` | `#1c1e22` | `NSColor(sRGBRed: 0.11, green: 0.118, blue: 0.133, alpha: 1.0)` |
| Bluenote | `"bluenote"` | `#2a3136` | `NSColor(sRGBRed: 0.165, green: 0.192, blue: 0.212, alpha: 1.0)` |
| Harmony | `"harmony"` | `#b0ab9f` | `NSColor(sRGBRed: 0.69, green: 0.67, blue: 0.624, alpha: 1.0)` |

Note: Harmony uses `--td-canvas` (`#b0ab9f`) not `--tl-bg` (`#3f474c`). The canvas token is what `body` uses for its background, and it differs from `--tl-bg` in the Harmony theme. The window background must match `--td-canvas`.

#### Theme Bridge Protocol {#theme-bridge-protocol}

**Spec S01: setTheme message handler** {#s01-set-theme-handler}

The frontend posts the theme name to Swift via:
```javascript
window.webkit?.messageHandlers?.setTheme?.postMessage({ theme: "brio" | "bluenote" | "harmony" })
```

Swift receives the message, writes the theme name to `UserDefaults.standard` under key `"TugTheme"`, and updates the window background color to match Table T01.

#### Badge Bridge Protocol {#badge-bridge-protocol}

**Spec S02: devBadge message handler** {#s02-dev-badge-handler}

The frontend posts badge state to Swift via:
```javascript
window.webkit?.messageHandlers?.devBadge?.postMessage({ backend: true, app: false })
```

Swift receives the message and updates Developer menu item titles:
- If `backend` is true: prepend "◆ " to "Restart Server" title
- If `backend` is false: remove "◆ " prefix from "Restart Server" title
- If `app` is true: prepend "◆ " to "Relaunch App" title
- If `app` is false: remove "◆ " prefix from "Relaunch App" title

#### Rust Watcher File Filter {#rust-watcher-filter}

**Spec S03: Updated has_rust_extension filter** {#s03-rust-extension-filter}

The `has_rust_extension()` function in `dev.rs` matches events where any path:
- Has extension `.rs`, OR
- Has filename `Cargo.toml`, OR
- Has filename `Cargo.lock`

Additionally, paths containing `/target/` are excluded before the extension check. This prevents build artifact changes from triggering restart notifications.

#### Developer Menu Layout {#developer-menu-layout}

**Spec S04: Updated Developer menu items** {#s04-developer-menu}

| Position | Title | Action | Key Equivalent | Modifier Mask |
|----------|-------|--------|---------------|---------------|
| 1 | Reload Frontend | `reloadFrontend(_:)` | `r` | `.command` |
| 2 | Restart Server | `restartServer(_:)` | `r` | `.command, .shift` |
| 3 | Relaunch App | `relaunchApp(_:)` | `r` | `.command, .option, .shift` |
| 4 | Reset Everything | `resetEverything(_:)` | `r` | `.command, .option` |
| 5 | (separator) | | | |
| 6 | Open Web Inspector | `openWebInspector(_:)` | (none) | |
| 7 | (separator) | | | |
| 8 | Source Tree: /path | (disabled) | | |
| 9 | Choose Source Tree... | `chooseSourceTree(_:)` | (none) | |

#### Reset Shutdown Handling {#reset-shutdown-handling}

**Spec S05: ProcessManager reset handling** {#s05-reset-handling}

In `ProcessManager.swift`, the shutdown handler's `"reset"` case changes from:
```swift
case "restart", "reset":
    // restart path
    restartDecision = .restart
```
to:
```swift
case "restart":
    restartDecision = .restart
case "reset":
    // same as relaunch: stop Vite, let tugrelaunch handle restart
    // (stop Vite, set doNotRestart)
```

The `"reset"` case follows the same logic as `"relaunch"`: stop Vite dev server, set `restartDecision = .doNotRestart`.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes are to existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugConfig.keyTheme` | static let | `tugapp/Sources/TugConfig.swift` | `"TugTheme"` UserDefaults key |
| `MainWindow.updateBackgroundForTheme(_:)` | method | `tugapp/Sources/MainWindow.swift` | Maps theme name to NSColor, sets `self.backgroundColor` |
| `BridgeDelegate.bridgeSetTheme(theme:)` | protocol method | `tugapp/Sources/MainWindow.swift` | Bridge callback for theme changes |
| `BridgeDelegate.bridgeDevBadge(backend:app:)` | protocol method | `tugapp/Sources/MainWindow.swift` | Bridge callback for badge state |
| `AppDelegate.restartMenuItem` | property | `tugapp/Sources/AppDelegate.swift` | Reference to Restart Server menu item for badge updates |
| `AppDelegate.relaunchMenuItem` | property | `tugapp/Sources/AppDelegate.swift` | Reference to Relaunch App menu item for badge updates |
| `AppDelegate.relaunchApp(_:)` | @objc method | `tugapp/Sources/AppDelegate.swift` | Action for Relaunch App menu item |
| `has_rust_extension()` | fn (modified) | `tugcode/crates/tugcast/src/dev.rs` | Add `Cargo.lock` match |
| `is_target_path()` | fn (new) | `tugcode/crates/tugcast/src/dev.rs` | Check if event paths contain `/target/` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `has_rust_extension()` with `Cargo.lock`, test `is_target_path()` exclusion | Rust filter logic |
| **Integration** | Test `dev_rust_source_watcher` with widened path and `/target/` exclusion | Watcher behavior end-to-end |
| **Manual** | Visual verification of theme background, menu badges, dev mode toggle lifecycle | macOS app behavior |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Fix card-frame-content overflow (Issue 4) {#step-1}

**Commit:** `fix(tugdeck): change card-frame-content overflow to auto so dev mode toggle is visible`

**References:** [D04] CSS overflow-y auto, (#context, #strategy)

**Artifacts:**
- Modified `tugdeck/styles/cards-chrome.css`

**Tasks:**
- [ ] In `tugdeck/styles/cards-chrome.css`, change `.card-frame-content` from `overflow: hidden` to `overflow-y: auto`

**Tests:**
- [ ] Visually confirm the Settings card shows all three sections (Theme, Source Tree, Developer Mode) when the card is resized small enough that they would previously be clipped

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] Settings card Developer Mode toggle is visible in the running app

---

#### Step 2: Widen Rust source watcher and add target exclusion (Issue 2) {#step-2}

**Depends on:** #step-1

<!-- Step 2 has no code dependency on Step 1; the dependency is for commit sequencing only. -->

**Commit:** `fix(tugcast): widen Rust watcher to tugcode/, match Cargo.lock, exclude /target/ paths`

**References:** [D02] Widen Rust watcher, Spec S03, Risk R01, (#rust-watcher-filter)

**Artifacts:**
- Modified `tugcode/crates/tugcast/src/dev.rs`
- Modified `tugdeck/src/components/cards/developer-card.tsx` (`categorizeFile()`)

**Tasks:**
- [ ] In `enable_dev_mode()`, change `source_tree.join("tugcode/crates")` to `source_tree.join("tugcode")` for the rust source watcher path
- [ ] Update `has_rust_extension()` to also match filename `Cargo.lock`
- [ ] Update the doc comment on `has_rust_extension()` to mention `Cargo.lock` matching
- [ ] Add an `is_target_path()` helper function that returns `true` if any path in the event contains `/target/` as a path component
- [ ] In the `dev_rust_source_watcher` debounce task, update the Phase 1 filter to reject events where `is_target_path()` returns true: `has_rust_extension(&event) && !is_target_path(&event)`
- [ ] Update the doc comment on `dev_rust_source_watcher` to reflect the wider watch path and exclusion
- [ ] In `developer-card.tsx`, update `categorizeFile()` to also match `Cargo.lock` as a backend file: change the tugcode condition from `path.endsWith(".rs") || path.endsWith("Cargo.toml")` to `path.endsWith(".rs") || path.endsWith("Cargo.toml") || path.endsWith("Cargo.lock")`, so git-status categorization stays consistent with the filesystem watcher

**Tests:**
- [ ] Add test `test_has_rust_extension_cargo_lock` that verifies `has_rust_extension()` returns true for a path named `Cargo.lock`
- [ ] Add test `test_is_target_path_true` that verifies `is_target_path()` returns true for paths containing `/target/`
- [ ] Add test `test_is_target_path_false` that verifies `is_target_path()` returns false for paths not containing `/target/`
- [ ] Add integration test `test_rust_source_watcher_ignores_target_dir` that creates a file under a `target/` subdirectory and verifies no notification fires within a timeout
- [ ] Update `categorizeFile` tests in `developer-card.test.tsx` to verify `"tugcode/Cargo.lock"` returns `"backend"`

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run` passes with all new and existing watcher tests green
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugdeck && bun test` passes (categorizeFile tests green)

---

#### Step 3: Reset uses relaunch path (Issue 3) {#step-3}

**Depends on:** #step-1

**Commit:** `fix(tugapp): treat reset shutdown as relaunch so localStorage clear gets a fresh WebView`

**References:** [D03] Reset relaunch Swift, Spec S05, (#reset-shutdown-handling)

**Artifacts:**
- Modified `tugapp/Sources/ProcessManager.swift`
- Modified `tugdeck/src/components/cards/developer-card.tsx` (reset button label)

**Tasks:**
- [ ] In `ProcessManager.swift`, split the `"restart", "reset"` case. Keep `"restart"` with its current `.restart` logic. Add a separate `"reset"` case that follows the `"relaunch"` pattern: log the reason, stop Vite dev server if running, set `restartDecision = .doNotRestart`
- [ ] In `developer-card.tsx`, update the reset button label from "Clear localStorage and restart" to "Clear localStorage and relaunch" (search for the existing label text)

**Tests:**
- [ ] Manual test: trigger reset from the Developer card, verify the full app relaunches (not just the backend), and localStorage is cleared

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] Xcode builds with no warnings
- [ ] Manual verification: reset triggers full app relaunch

---

#### Step 4: Theme-aware window background (Issue 1) {#step-4}

**Depends on:** #step-1

**Commit:** `feat(tugapp): theme-aware window background via UserDefaults bridge`

**References:** [D01] Theme UserDefaults, Table T01, Spec S01, Risk R02, (#theme-color-mapping, #theme-bridge-protocol)

**Tasks:**
- [ ] Complete substeps 4.1, 4.2, and 4.3 below

**Tests:**
- [ ] See substep-level tests below

**Checkpoint:**
- [ ] See substep-level checkpoints and Step 4 Summary aggregate checkpoint below

##### Step 4.1: Add TugTheme UserDefaults key and window background method {#step-4-1}

**Commit:** `feat(tugapp): read TugTheme from UserDefaults to set theme-aware window background at startup`

**References:** [D01] Theme UserDefaults, Table T01, Spec S01, Risk R02, (#theme-color-mapping)

**Artifacts:**
- Modified `tugapp/Sources/TugConfig.swift`
- Modified `tugapp/Sources/MainWindow.swift`
- Modified `tugapp/Sources/AppDelegate.swift`

**Tasks:**
- [ ] In `TugConfig.swift`, add `static let keyTheme = "TugTheme"`
- [ ] In `MainWindow.swift`, add a method `updateBackgroundForTheme(_ theme: String)` that maps theme name to NSColor per Table T01 and sets `self.backgroundColor`. Default to Brio's color for unknown values.
- [ ] In `MainWindow.init()`, after the current `self.backgroundColor` line, read the theme from UserDefaults (`UserDefaults.standard.string(forKey: TugConfig.keyTheme)`) and call `updateBackgroundForTheme(_:)` to replace the hardcoded color

**Tests:**
- [ ] Manual test: set UserDefaults `TugTheme` to `"bluenote"` via `defaults write`, launch app, verify window background matches Bluenote's `#2a3136`

**Checkpoint:**
- [ ] Xcode builds with no warnings
- [ ] Window background matches theme at startup

---

##### Step 4.2: Add setTheme bridge handler for runtime updates {#step-4-2}

**Depends on:** #step-4-1

**Commit:** `feat(tugapp): add setTheme WKScriptMessageHandler so frontend syncs theme to UserDefaults`

**References:** [D01] Theme UserDefaults, Spec S01, (#theme-bridge-protocol)

**Artifacts:**
- Modified `tugapp/Sources/MainWindow.swift`
- Modified `tugapp/Sources/AppDelegate.swift`

**Tasks:**
- [ ] In `MainWindow.init()`, register `setTheme` message handler: `contentController.add(self, name: "setTheme")`
- [ ] In `MainWindow.cleanupBridge()`, add `contentController.removeScriptMessageHandler(forName: "setTheme")`
- [ ] Add `bridgeSetTheme(theme:)` to the `BridgeDelegate` protocol
- [ ] In the `WKScriptMessageHandler` switch, add a `"setTheme"` case that extracts the theme string from `message.body` and calls `bridgeDelegate?.bridgeSetTheme(theme:)`
- [ ] In `AppDelegate`, implement `bridgeSetTheme(theme:)`: write theme to UserDefaults via `UserDefaults.standard.set(theme, forKey: TugConfig.keyTheme)`, and call `window.updateBackgroundForTheme(theme)`

**Tests:**
- [ ] Manual test: change theme in Settings card, verify window background updates immediately and persists across app restart

**Checkpoint:**
- [ ] Xcode builds with no warnings
- [ ] Theme change from Settings card updates window background in real time

---

##### Step 4.3: Wire frontend theme changes to the bridge {#step-4-3}

**Depends on:** #step-4-2

**Commit:** `feat(tugdeck): post theme name to setTheme bridge handler on theme change`

**References:** [D01] Theme UserDefaults, Spec S01, (#theme-bridge-protocol)

**Artifacts:**
- Modified `tugdeck/src/hooks/use-theme.ts`

**Tasks:**
- [ ] In `use-theme.ts`, in the `setTheme` function, after persisting to localStorage, add a call to post the theme to the Swift bridge: `window.webkit?.messageHandlers?.setTheme?.postMessage({ theme: newTheme })`
- [ ] Also wire the initial theme on mount: in the `useEffect` that syncs with external changes, post the current theme to the bridge on first render so UserDefaults is updated even if the user never changes themes (covers the case where localStorage has a theme but UserDefaults does not)

**Tests:**
- [ ] `cd tugdeck && bun test` passes (existing theme tests should not break; bridge call is optional chaining)
- [ ] Manual test: full round-trip — change theme, quit app, relaunch, verify window background matches chosen theme

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] Full round-trip theme persistence works

---

#### Step 4 Summary {#step-4-summary}

**Depends on:** #step-4

**Commit:** `N/A (summary — no separate commit)`

**References:** [D01] Theme UserDefaults, Table T01, Spec S01, (#theme-color-mapping, #theme-bridge-protocol)

After completing Steps 4.1-4.3, you will have:
- A `TugTheme` UserDefaults key read at startup to set the correct window background color
- A `setTheme` WKScriptMessageHandler that updates both UserDefaults and the live window background
- Frontend `use-theme.ts` posting theme changes to the bridge

**Tasks:**
- [ ] Verify all substep artifacts are committed

**Tests:**
- [ ] All substep tests passing

**Checkpoint:**
- [ ] Window background matches active theme for all three themes (Brio, Bluenote, Harmony) at startup and after theme change

---

#### Step 5: Developer menu Relaunch item and dirty badges (Issue 5) {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugapp): Developer menu Relaunch item and diamond dirty badges`

**References:** [D05] Menu relaunch and badges, Spec S02, Spec S04, (#developer-menu-layout, #badge-bridge-protocol)

**Tasks:**
- [ ] Complete substeps 5.1, 5.2, and 5.3 below

**Tests:**
- [ ] See substep-level tests below

**Checkpoint:**
- [ ] See substep-level checkpoints and Step 5 Summary aggregate checkpoint below

##### Step 5.1: Add Relaunch App menu item {#step-5-1}

**Commit:** `feat(tugapp): add Relaunch App item to Developer menu with Cmd+Option+Shift+R shortcut`

**References:** [D05] Menu relaunch and badges, Spec S04, (#developer-menu-layout)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift`

**Tasks:**
- [ ] Add a `relaunchApp(_:)` @objc action method that calls `sendControl("relaunch")`
- [ ] In `buildMenuBar()`, add a "Relaunch App" menu item after "Restart Server" and before "Reset Everything" with key equivalent `"r"` and modifier mask `[.command, .option, .shift]`
- [ ] Store references to the Restart Server and Relaunch App menu items as properties (`restartMenuItem`, `relaunchMenuItem`) for later badge updates

**Tests:**
- [ ] Manual test: Developer menu shows Relaunch App with correct shortcut; clicking it triggers app relaunch

**Checkpoint:**
- [ ] Xcode builds with no warnings
- [ ] Relaunch App menu item is functional

---

##### Step 5.2: Add devBadge bridge handler for dirty state {#step-5-2}

**Depends on:** #step-5-1

**Commit:** `feat(tugapp): add devBadge WKScriptMessageHandler for diamond badge on dirty menu items`

**References:** [D05] Menu relaunch and badges, Spec S02, (#badge-bridge-protocol)

**Artifacts:**
- Modified `tugapp/Sources/MainWindow.swift`
- Modified `tugapp/Sources/AppDelegate.swift`

**Tasks:**
- [ ] In `MainWindow.init()`, register `devBadge` message handler
- [ ] In `MainWindow.cleanupBridge()`, add cleanup for `devBadge`
- [ ] Add `bridgeDevBadge(backend:app:)` to the `BridgeDelegate` protocol
- [ ] In the `WKScriptMessageHandler` switch, add a `"devBadge"` case that extracts `backend` and `app` booleans and calls the delegate
- [ ] In `AppDelegate`, implement `bridgeDevBadge(backend:app:)`: update `restartMenuItem.title` and `relaunchMenuItem.title` by prepending/removing "◆ " based on the boolean values

**Tests:**
- [ ] Manual test: edit a `.rs` file, verify Restart Server menu item shows "◆ Restart Server"; after restart, diamond disappears

**Checkpoint:**
- [ ] Xcode builds with no warnings
- [ ] Badge appears and disappears correctly on menu items

---

##### Step 5.3: Wire frontend badge state to the bridge {#step-5-3}

**Depends on:** #step-5-2

**Commit:** `feat(tugdeck): post dev badge state to devBadge bridge handler on notification changes`

**References:** [D05] Menu relaunch and badges, Spec S02, (#badge-bridge-protocol)

**Artifacts:**
- Modified `tugdeck/src/components/cards/developer-card.tsx`

**Tasks:**
- [ ] In `developer-card.tsx`, add an effect that watches the stale state of backend and app rows. When the stale state changes, post badge state to the bridge: `window.webkit?.messageHandlers?.devBadge?.postMessage({ backend: backendStale, app: appStale })`
- [ ] Also post initial badge state (both false) on mount and when dev notification state resets after an action

**Tests:**
- [ ] `cd tugdeck && bun test` passes (bridge call uses optional chaining, safe in test environment)
- [ ] Manual test: edit Swift file, verify "◆ Relaunch App" appears in menu; trigger relaunch, verify diamond clears

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] Full round-trip badge behavior works

---

#### Step 5 Summary {#step-5-summary}

**Depends on:** #step-5

**Commit:** `N/A (summary — no separate commit)`

**References:** [D05] Menu relaunch and badges, Spec S02, Spec S04, (#developer-menu-layout, #badge-bridge-protocol)

After completing Steps 5.1-5.3, you will have:
- A "Relaunch App" menu item with Cmd+Option+Shift+R shortcut
- Diamond badge on Restart Server and Relaunch App menu items when their respective categories are stale
- Frontend posting badge state to Swift via `devBadge` bridge handler

**Tasks:**
- [ ] Verify all substep artifacts are committed

**Tests:**
- [ ] All substep tests passing

**Checkpoint:**
- [ ] Developer menu matches Spec S04 layout
- [ ] Diamond badges appear/disappear correctly for both backend and app categories

---

#### Step 6: Verify dev mode on/off lifecycle (Issue 6) {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `docs: verify dev mode on/off lifecycle (Issue 6) — no code changes`

**References:** [D06] Verification only, (#success-criteria)

**Artifacts:**
- No code changes; this step is manual verification only

**Tasks:**
- [ ] With dev mode enabled and all watchers running, open Settings card and toggle dev mode OFF
- [ ] Verify: Developer card disappears, Developer menu hides, file watchers stop (no notifications when editing files)
- [ ] Toggle dev mode back ON
- [ ] Verify: Developer card reappears, Developer menu shows, file watchers restart (editing a `.rs` file triggers restart notification)
- [ ] Verify: all three watcher categories work after re-enable (frontend via HMR, backend via restart notification, app via relaunch notification)

**Tests:**
- [ ] No automated tests; manual verification only

**Checkpoint:**
- [ ] Dev mode off: Developer card hidden, menu hidden, no watcher notifications
- [ ] Dev mode on: Developer card visible, menu visible, all watchers functional
- [ ] `cd tugcode && cargo nextest run` passes (full regression)
- [ ] `cd tugdeck && bun test` passes (full regression)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All six dev mode completeness audit issues resolved, with theme-aware startup, widened watcher coverage, correct reset behavior, accessible dev mode toggle, complete Developer menu, and verified lifecycle.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Window background matches active theme at startup and on theme change (all 3 themes verified)
- [ ] `tugcode/Cargo.toml` and `tugcode/Cargo.lock` edits trigger restart notification
- [ ] Reset performs full app relaunch (fresh WKWebView + fresh backend)
- [ ] Developer Mode toggle is visible and functional in Settings card
- [ ] Developer menu has Relaunch App item; dirty items show diamond badge
- [ ] Dev mode off stops watchers/hides UI; on restarts watchers/shows UI
- [ ] `cargo nextest run` passes with zero failures
- [ ] `bun test` passes with zero failures

**Acceptance tests:**
- [ ] `cd tugcode && cargo nextest run` — all Rust tests pass
- [ ] `cd tugdeck && bun test` — all frontend tests pass
- [ ] Manual: theme round-trip (change theme, restart, verify background)
- [ ] Manual: reset triggers relaunch (not just restart)
- [ ] Manual: dev mode toggle on/off lifecycle works end-to-end

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Automated UI tests for theme background matching (currently manual)
- [ ] Consider adding more themes and updating the theme-to-color mapping
- [ ] Investigate whether the compiled binary watcher should also cover workspace-level changes
- [ ] Move badge posting to a higher-level listener so badges update even when Developer card is unmounted

| Checkpoint | Verification |
|------------|--------------|
| CSS overflow fix | Settings card shows all 3 sections when resized small |
| Rust watcher widened | `cargo nextest run` passes, `Cargo.lock` change triggers notification |
| Reset as relaunch | Manual: reset relaunches the full app |
| Theme-aware background | Manual: background matches theme at startup and on change |
| Menu Relaunch + badges | Manual: Relaunch item present, diamond appears on stale |
| Lifecycle verification | Manual: toggle off/on works correctly |
