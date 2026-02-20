## Phase 1.0: Standard Mac Menus, Settings Window, and About Box {#phase-mac-menus-settings}

**Purpose:** Bring Tug.app's menu bar to Mac-standard completeness with six menus (Tug, File, Edit, Developer, Window, Help), a dedicated Settings window that breaks the developer-mode catch-22, and a proper About box with copyright.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|-------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-19 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tug.app currently has three menus: a minimal app menu with only Quit, an Edit menu with four items (Cut/Copy/Paste/Select All), and a Developer menu that is hidden when dev mode is off. Standard keyboard shortcuts like Cmd+W (close window), Cmd+M (minimize), Cmd+H (hide), Cmd+Z (undo), and Cmd+, (settings) do nothing. There is no File menu, no Window menu, no Help menu, no Settings window, and no About box. The Developer menu's "Enable Dev Mode" toggle is inaccessible when dev mode is off, creating a catch-22 where the only way to enable dev mode is via the `defaults` command line tool.

This makes the app feel unfinished and violates Mac user expectations. Every Mac user relies on muscle memory for standard menu commands, and the missing items break that contract.

#### Strategy {#strategy}

- Rewrite `buildMenuBar()` in AppDelegate.swift to construct all six menus with correct selectors, key equivalents, and system menu registrations (servicesMenu, windowsMenu, helpMenu).
- Create a new SettingsWindow.swift with an NSWindowController subclass providing a Developer Mode checkbox and Source Tree picker, opened via Cmd+, or the Tug menu.
- Move the dev mode toggle from the Developer menu into the Settings window, breaking the catch-22.
- Add NSHumanReadableCopyright to Info.plist and wire the About box to `NSApp.orderFrontStandardAboutPanel`.
- Wire the Developer menu to show/hide based on the Settings toggle, positioned between Edit and Window.
- Add Undo/Redo and a Find submenu to Edit, which WKWebView handles automatically through the responder chain.
- Add Help menu items that open URLs in the default browser.

#### Stakeholders / Primary Customers {#stakeholders}

1. Tug.app end users who expect standard Mac menu behavior
2. Developers using dev mode who need accessible settings

#### Success Criteria (Measurable) {#success-criteria}

- All six menus (Tug, File, Edit, Developer, Window, Help) are present in the menu bar when the app launches (visual inspection)
- Cmd+W closes the window, Cmd+M minimizes, Cmd+H hides, Cmd+Z triggers undo in WKWebView (keyboard test)
- Cmd+, opens the Settings window; toggling Developer Mode on/off shows/hides the Developer menu (functional test)
- About Tug shows app icon, name, version, and "Copyright © 2026 Ken Kocienda" (visual inspection)
- The app builds cleanly with `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` and no warnings

#### Scope {#scope}

1. Full menu bar with six menus based on the spec in `roadmap/mac-app-standard-menus.md` (Note: the Help menu intentionally diverges from the roadmap spec, which proposed a single "Tug Help" item. Based on user input, the Help menu instead contains two URL items -- "Project Home" and "GitHub" -- providing more direct value than a placeholder help item.)
2. New SettingsWindow.swift with Developer Mode toggle and Source Tree picker
3. Info.plist NSHumanReadableCopyright addition for About box
4. Removal of dev mode toggle from Developer menu
5. Help menu with Project Home and GitHub URL items

#### Non-goals (Explicitly out of scope) {#non-goals}

- Touch Bar support (discontinued on new Macs)
- Toolbar or tab bar (single WKWebView app)
- Dock menu (follow-on)
- Apple Help Book integration (Help menu items open URLs instead)
- Multiple settings panes or toolbar pane-switcher in Settings
- Credits.rtf for About panel (follow-on)

#### Dependencies / Prerequisites {#dependencies}

- Existing AppDelegate.swift menu-building code (will be rewritten)
- Existing TugConfig.swift with UserDefaults keys and source tree validation
- macOS 13.0 (Ventura) deployment target

#### Constraints {#constraints}

- AppKit only, no SwiftUI -- the entire app uses programmatic AppKit
- Deployment target macOS 13.0 -- no APIs newer than Ventura unless availability-checked
- Bundle ID `dev.tugtool.app` must remain unchanged

#### Assumptions {#assumptions}

- The "Delete" item in the Edit menu uses the standard `NSText.delete(_:)` selector with no key equivalent
- SettingsWindow.swift will be created as a new file in `tugapp/Sources/`
- The Settings window will be non-resizable with a fixed width of ~450pt and auto-height based on content
- The Source Tree path field will be implemented as a read-only NSTextField, not an editable text field
- The Developer menu will be inserted at index 3 in the main menu (after Tug, File, Edit) when visible
- Toggling Developer Mode on/off will continue to trigger a tugcast restart as it does today
- The Services submenu will be created as an empty NSMenu and assigned to `NSApp.servicesMenu`, letting the system populate it
- WKWebView will handle Undo/Redo and Find actions automatically through the responder chain without custom handler code
- The "Choose Source Tree..." button in Settings will reuse the existing validation logic from `TugConfig.isValidSourceTree()`
- When dev mode is enabled in Settings and no source tree exists, the folder picker will open immediately

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| WKWebView Find panel routing | med | med | Test early in Step 2; fall back to custom handler if needed | Find submenu items have no effect in WKWebView |
| Auto Layout complexity in SettingsWindow | low | med | Keep layout simple with vertical stack; reference working patterns | Layout breaks on different content sizes or locales |
| Manual pbxproj editing introduces build errors | high | med | Use structured edit matching existing file patterns; verify build immediately | Xcode fails to open project or build fails after edit |

**Risk R01: WKWebView may not route Find panel actions** {#r01-find-panel-routing}

- **Risk:** WKWebView may not respond to `performFindPanelAction:` through the responder chain, since it is not an NSTextView. The Find submenu items could appear in the menu but do nothing when invoked.
- **Mitigation:**
  - Test Find submenu items (Cmd+F, Cmd+G) early in Step 2 after wiring the Edit menu
  - If WKWebView does not respond, investigate `WKWebView.evaluateJavaScript("window.find()")` as an alternative
  - The worst case is non-functional Find items, which is no worse than the current state (no Find at all)
- **Residual risk:** Find behavior may vary across macOS versions

**Risk R02: Manual project.pbxproj editing may corrupt the project** {#r02-pbxproj-corruption}

- **Risk:** Editing `tugapp/Tug.xcodeproj/project.pbxproj` by hand to add SettingsWindow.swift could introduce syntax errors, duplicate UUIDs, or missing references that prevent Xcode from opening the project or building.
- **Mitigation:**
  - Follow the exact pattern of existing file entries (copy/adapt an existing PBXFileReference, PBXBuildFile, and PBXGroup entry)
  - Run `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` immediately after editing to catch errors
  - Keep a backup of the original pbxproj before editing
- **Residual risk:** Future Xcode updates may change pbxproj format expectations

**Risk R03: Auto Layout complexity in SettingsWindow** {#r03-autolayout-complexity}

- **Risk:** Programmatic Auto Layout for the Settings window's conditional visibility (Source Tree section shown/hidden based on dev mode) could produce ambiguous or conflicting constraints.
- **Mitigation:**
  - Keep the layout minimal: vertical stack of controls with fixed leading/trailing margins
  - Use constraint activation/deactivation rather than adding/removing views for the conditional section
  - Test with both dev mode on and off to verify layout correctness
- **Residual risk:** Edge cases with very long source tree paths may require truncation in the path field

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Settings window breaks the dev-mode catch-22 (DECIDED) {#d01-settings-breaks-catch22}

**Decision:** Move the Developer Mode toggle from the Developer menu into a dedicated Settings window accessible via Cmd+, or the Tug > Settings... menu item. The Developer menu becomes a pure set of dev-mode actions (no toggle).

**Rationale:**
- The current design hides the dev mode toggle inside the Developer menu, which is itself hidden when dev mode is off
- Users cannot enable dev mode without resorting to `defaults write` on the command line
- A Settings window is always accessible via Cmd+, regardless of dev mode state

**Implications:**
- New SettingsWindow.swift file is required
- AppDelegate needs a lazy reference to the SettingsWindowController
- Developer menu items no longer include "Enable Dev Mode"
- The AppDelegate must listen for dev mode changes from the Settings window to show/hide the Developer menu

#### [D02] Standard NSApp panel for About box (DECIDED) {#d02-standard-about-panel}

**Decision:** Use `NSApp.orderFrontStandardAboutPanel(options:)` for the About box rather than building a custom window.

**Rationale:**
- The standard About panel automatically displays app icon, name, version, and build from the bundle
- Adding `NSHumanReadableCopyright` to Info.plist provides the copyright line
- Zero custom UI code needed for a fully correct About box

**Implications:**
- Info.plist must include `NSHumanReadableCopyright` key
- No custom About window class is needed

#### [D03] System-managed menus for Services, Window list, and Help search (DECIDED) {#d03-system-managed-menus}

**Decision:** Register menus with `NSApp.servicesMenu`, `NSApp.windowsMenu`, and `NSApp.helpMenu` so the system populates them automatically.

**Rationale:**
- Services submenu is populated by the system based on the current selection and available services
- Window menu automatically shows open windows when registered
- Help menu automatically inserts a search field that searches all menu items

**Implications:**
- Services submenu created as empty NSMenu and assigned to NSApp.servicesMenu
- Window menu assigned to NSApp.windowsMenu after construction
- Help menu assigned to NSApp.helpMenu after construction

#### [D04] Responder chain handles Undo/Redo and Find in WKWebView (DECIDED) {#d04-responder-chain-edit}

**Decision:** Add Undo/Redo and Find submenu items to the Edit menu using standard selectors (`undo:`, `redo:`, `performFindPanelAction:`) and rely on the responder chain to route them to WKWebView.

**Rationale:**
- WKWebView internally handles these editing operations for its text fields
- AppKit's responder chain routes menu actions to the first responder that implements the selector
- No custom handler code is needed in AppDelegate or MainWindow

**Implications:**
- Edit menu items added with standard selectors and key equivalents
- Find submenu items use `performFindPanelAction:` with tags (1 for Find, 2 for Find Next, 3 for Find Previous, 7 for Use Selection for Find)
- No `@objc` action methods needed for these items

#### [D05] Settings window is a singleton with frame autosave (DECIDED) {#d05-settings-singleton}

**Decision:** The Settings window is created as a singleton managed by AppDelegate. Repeated Cmd+, brings the existing window to front rather than creating a new one. The window position is remembered between launches via `setFrameAutosaveName`.

**Rationale:**
- Standard macOS convention -- apps have one Settings window
- Frame autosave is a one-line setup that persists window position in UserDefaults automatically

**Implications:**
- AppDelegate holds a lazy `SettingsWindowController` property
- SettingsWindowController creates the window once and reuses it
- Window uses `setFrameAutosaveName("SettingsWindow")`

#### [D06] Help menu items open URLs in default browser (DECIDED) {#d06-help-opens-urls}

**Decision:** The Help menu contains two items: "Project Home" opening https://tugtool.dev and "GitHub" opening https://github.com/tugtool/tugtool. Both use `NSWorkspace.shared.open()` to launch the default browser.

**Rationale:**
- No in-app help system exists yet
- Opening URLs is the simplest useful behavior
- Users can reach documentation and source code directly

**Implications:**
- Two `@objc` action methods in AppDelegate (or a single method with sender differentiation)
- URLs are hardcoded constants (could move to TugConfig if needed later)

#### [D07] Developer menu positioned between Edit and Window (DECIDED) {#d07-dev-menu-position}

**Decision:** The Developer menu is inserted at index 3 in the main menu (after Tug, File, Edit) when dev mode is enabled. It is hidden (not removed) when dev mode is disabled.

**Rationale:**
- Apple HIG places app-specific menus between Edit and Window
- Hiding rather than removing preserves the menu item reference and avoids rebuilding

**Implications:**
- Developer menu item's `isHidden` property is toggled based on dev mode state
- Menu bar order: Tug (0), File (1), Edit (2), Developer (3, hidden when off), Window (4), Help (5)

#### [D08] chooseSourceTree action stays in AppDelegate as shared method (DECIDED) {#d08-choose-source-tree-shared}

**Decision:** The `chooseSourceTree(_:)` action method remains in AppDelegate. Both the Developer menu's "Choose Source Tree..." item and the Settings window's "Choose..." button call this same method. The Settings window invokes it via its `onSourceTreeChanged` callback or by calling through to the AppDelegate directly.

**Rationale:**
- The method already exists in AppDelegate and works correctly with NSOpenPanel, TugConfig validation, preferences saving, and tugcast restart
- Duplicating the logic in SettingsWindowController would create two copies that must stay in sync
- Both call sites need access to the same AppDelegate state (sourceTreePath, processManager)

**Implications:**
- AppDelegate.chooseSourceTree(_:) is retained and remains `@objc` so it can be wired as a menu action
- SettingsWindowController calls it via its callback property or a delegate pattern
- Developer menu "Choose Source Tree..." item targets AppDelegate directly

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 Menu Bar Layout {#menu-bar-layout}

**Table T01: Complete Menu Bar Structure** {#t01-menu-bar-structure}

| Menu | Position | System Registration | Items |
|------|----------|-------------------|-------|
| Tug (App) | 0 | -- | About Tug, separator, Settings... Cmd+,, separator, Services submenu, separator, Hide Tug Cmd+H, Hide Others Opt+Cmd+H, Show All, separator, Quit Tug Cmd+Q |
| File | 1 | -- | Close Window Cmd+W |
| Edit | 2 | -- | Undo Cmd+Z, Redo Shift+Cmd+Z, separator, Cut Cmd+X, Copy Cmd+C, Paste Cmd+V, Delete, Select All Cmd+A, separator, Find submenu |
| Developer | 3 | -- | Reload Frontend Cmd+R, Restart Server Shift+Cmd+R, Reset Everything Opt+Cmd+R, separator, Open Web Inspector, separator, Source Tree: path (disabled), Choose Source Tree... |
| Window | 4 | NSApp.windowsMenu | Minimize Cmd+M, Zoom, separator, Enter Full Screen Ctrl+Cmd+F, separator, Bring All to Front, separator, [system window list] |
| Help | 5 | NSApp.helpMenu | [system search field], Project Home, GitHub |

#### 1.0.1.2 Find Submenu Tags {#find-submenu-tags}

**Table T02: Find Submenu Configuration** {#t02-find-submenu}

| Item | Selector | Key Equivalent | Tag |
|------|----------|---------------|-----|
| Find... | `performFindPanelAction:` | Cmd+F | 1 |
| Find Next | `performFindPanelAction:` | Cmd+G | 2 |
| Find Previous | `performFindPanelAction:` | Shift+Cmd+G | 3 |
| Use Selection for Find | `performFindPanelAction:` | Cmd+E | 7 |

#### 1.0.1.3 Settings Window Layout {#settings-window-layout}

**Spec S01: Settings Window** {#s01-settings-window}

- Title: "Settings"
- Style: titled, closable, non-resizable
- Width: ~450pt fixed
- Height: auto based on content
- Frame autosave name: "SettingsWindow"
- Singleton: one instance, brought to front on repeated open

Contents:
- "General" section label (bold NSTextField)
- "Enable Developer Mode" checkbox (NSButton with .switch type)
- "Source Tree" section label (bold NSTextField, visible only when dev mode on)
- Read-only NSTextField showing current source tree path (visible only when dev mode on)
- "Choose..." button (NSButton, visible only when dev mode on)
- Standard 20pt margins, 8pt spacing between controls

Behavior:
- Toggling dev mode checkbox immediately saves to UserDefaults, shows/hides Developer menu, shows/hides Source Tree section, and triggers tugcast restart
- If dev mode enabled and no source tree set, folder picker opens automatically
- "Choose..." opens NSOpenPanel with `TugConfig.isValidSourceTree()` validation

#### 1.0.1.4 Info.plist Addition {#info-plist-addition}

**Spec S02: Info.plist Copyright Key** {#s02-info-plist-copyright}

Add to `tugapp/Info.plist`:
```xml
<key>NSHumanReadableCopyright</key>
<string>Copyright © 2026 Ken Kocienda</string>
```

#### 1.0.1.5 Help Menu URLs {#help-menu-urls}

**Table T03: Help Menu URL Targets** {#t03-help-urls}

| Menu Item | URL |
|-----------|-----|
| Project Home | https://tugtool.dev |
| GitHub | https://github.com/tugtool/tugtool |

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 New Files {#new-files}

| File | Purpose |
|------|---------|
| `tugapp/Sources/SettingsWindow.swift` | NSWindowController subclass with dev mode checkbox and source tree picker (~80-100 lines) |

#### 1.0.2.2 Modified Files {#modified-files}

| File | Changes |
|------|---------|
| `tugapp/Sources/AppDelegate.swift` | Rewrite `buildMenuBar()` with all six menus; add lazy `settingsWindowController` property; add `showSettings(_:)`, `showAbout(_:)`, `openProjectHome(_:)`, `openGitHub(_:)` actions; remove `toggleDevMode(_:)` action; add `updateDeveloperMenuVisibility()` method; wire Services/Window/Help menus to NSApp |
| `tugapp/Info.plist` | Add `NSHumanReadableCopyright` key |
| `tugapp/Tug.xcodeproj/project.pbxproj` | Add PBXFileReference, PBXBuildFile, and PBXGroup entries for `SettingsWindow.swift` |

#### 1.0.2.3 Unchanged Files {#unchanged-files}

| File | Reason |
|------|--------|
| `tugapp/Sources/main.swift` | No changes needed |
| `tugapp/Sources/MainWindow.swift` | No changes needed; WKWebView handles Undo/Redo/Find via responder chain |
| `tugapp/Sources/ProcessManager.swift` | No changes needed; Settings window calls existing processManager methods via AppDelegate |
| `tugapp/Sources/TugConfig.swift` | No changes needed; existing keys and validation logic are reused |

#### 1.0.2.4 Symbols to Add / Modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SettingsWindowController` | class | `SettingsWindow.swift` | NSWindowController subclass, singleton |
| `SettingsWindowController.devModeCheckbox` | property | `SettingsWindow.swift` | NSButton with .switch type |
| `SettingsWindowController.sourceTreeField` | property | `SettingsWindow.swift` | Read-only NSTextField |
| `SettingsWindowController.chooseButton` | property | `SettingsWindow.swift` | NSButton for folder picker |
| `SettingsWindowController.sourceTreeLabel` | property | `SettingsWindow.swift` | Section label |
| `SettingsWindowController.onDevModeChanged` | property | `SettingsWindow.swift` | Callback closure `((Bool) -> Void)?` |
| `SettingsWindowController.onSourceTreeChanged` | property | `SettingsWindow.swift` | Callback closure `((String?) -> Void)?` |
| `AppDelegate.settingsWindowController` | property | `AppDelegate.swift` | Lazy SettingsWindowController reference |
| `AppDelegate.showSettings(_:)` | method | `AppDelegate.swift` | Opens Settings window |
| `AppDelegate.showAbout(_:)` | method | `AppDelegate.swift` | Opens standard About panel |
| `AppDelegate.openProjectHome(_:)` | method | `AppDelegate.swift` | Opens https://tugtool.dev |
| `AppDelegate.openGitHub(_:)` | method | `AppDelegate.swift` | Opens https://github.com/tugtool/tugtool |
| `AppDelegate.updateDeveloperMenuVisibility()` | method | `AppDelegate.swift` | Shows/hides Developer menu based on devModeEnabled |
| `AppDelegate.chooseSourceTree(_:)` | method (retained) | `AppDelegate.swift` | Shared action for Developer menu and Settings window per [D08] |
| `AppDelegate.toggleDevMode(_:)` | method (removed) | `AppDelegate.swift` | Replaced by Settings window callback |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Add NSHumanReadableCopyright to Info.plist {#step-0}

**Commit:** `feat(tugapp): add copyright to Info.plist for About panel`

**References:** [D02] Standard NSApp panel for About box, Spec S02, (#info-plist-addition, #s02-info-plist-copyright)

**Artifacts:**
- Modified `tugapp/Info.plist` with `NSHumanReadableCopyright` key

**Tasks:**
- [ ] Add `<key>NSHumanReadableCopyright</key>` and `<string>Copyright © 2026 Ken Kocienda</string>` to `tugapp/Info.plist` inside the top-level `<dict>`

**Tests:**
- [ ] Integration test: verify Info.plist is valid XML after edit (`plutil -lint tugapp/Info.plist`)

**Checkpoint:**
- [ ] `plutil -lint tugapp/Info.plist` passes with no errors
- [ ] `grep NSHumanReadableCopyright tugapp/Info.plist` finds the new key

**Rollback:**
- Revert the Info.plist edit (remove the two added lines)

**Commit after all checkpoints pass.**

---

#### Step 1: Create SettingsWindow.swift {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugapp): add Settings window with dev mode toggle and source tree picker`

**References:** [D01] Settings breaks the dev-mode catch-22, [D05] Settings window singleton with frame autosave, [D08] chooseSourceTree stays in AppDelegate, Spec S01, Risk R02, Risk R03, (#settings-window-layout, #s01-settings-window, #new-files, #symbols, #r02-pbxproj-corruption, #r03-autolayout-complexity)

**Artifacts:**
- New file `tugapp/Sources/SettingsWindow.swift`
- Modified `tugapp/Tug.xcodeproj/project.pbxproj` with PBXFileReference, PBXBuildFile, and PBXGroup entries for the new file

**Tasks:**
- [ ] Create `SettingsWindowController` class extending `NSWindowController`
- [ ] Create a non-resizable NSWindow with title "Settings", fixed ~450pt width, and `setFrameAutosaveName("SettingsWindow")`
- [ ] Add "General" bold label at the top
- [ ] Add "Enable Developer Mode" checkbox (`NSButton` with `.switch` type), wired to `devModeToggled(_:)` action
- [ ] Add "Source Tree" bold label, read-only NSTextField for path display, and "Choose..." button -- all hidden when dev mode is off
- [ ] Lay out controls with Auto Layout: 20pt margins, 8pt vertical spacing
- [ ] Implement `devModeToggled(_:)` that saves to UserDefaults, toggles Source Tree section visibility, calls `onDevModeChanged` callback, and auto-opens folder picker if dev mode enabled and no source tree set
- [ ] Add `onDevModeChanged: ((Bool) -> Void)?` and `onSourceTreeChanged: ((String?) -> Void)?` callback properties (the Settings window delegates source tree selection back to AppDelegate via the callback, per [D08])
- [ ] Add `showWindow(_:)` override to refresh UI state (checkbox, path field, section visibility) from UserDefaults before showing
- [ ] Edit `tugapp/Tug.xcodeproj/project.pbxproj` to add SettingsWindow.swift to the build: add a PBXFileReference entry, a PBXBuildFile entry in the Sources build phase, and an entry in the PBXGroup for the Sources folder -- follow the exact pattern of existing source file entries (e.g., AppDelegate.swift) for UUID format and structure

**Tests:**
- [ ] Integration test: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` succeeds after adding the file
- [ ] Manual test: Settings window opens, checkbox toggles, Source Tree section shows/hides

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` succeeds with no errors
- [ ] SettingsWindow.swift appears in the Tug target's Compile Sources build phase

**Rollback:**
- Delete `tugapp/Sources/SettingsWindow.swift` and remove from build target

**Commit after all checkpoints pass.**

---

#### Step 2: Rewrite AppDelegate menu bar with all six menus {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugapp): complete menu bar with Tug, File, Edit, Developer, Window, Help menus`

**References:** [D01] Settings breaks the dev-mode catch-22, [D02] Standard NSApp panel for About box, [D03] System-managed menus, [D04] Responder chain handles Undo/Redo and Find, [D06] Help opens URLs, [D07] Developer menu positioned between Edit and Window, [D08] chooseSourceTree stays in AppDelegate, Table T01, Table T02, Table T03, Risk R01, (#menu-bar-layout, #t01-menu-bar-structure, #find-submenu-tags, #t02-find-submenu, #help-menu-urls, #t03-help-urls, #modified-files, #symbols, #r01-find-panel-routing)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift` with rewritten `buildMenuBar()` and new action methods

**Tasks:**
- [ ] Add `private lazy var settingsWindowController` property that creates a `SettingsWindowController`, wires `onDevModeChanged` to update `devModeEnabled`, show/hide Developer menu, save preferences, and restart tugcast, and wires `onSourceTreeChanged` to update `sourceTreePath`, save preferences, rebuild Developer menu source tree display, and restart tugcast if dev mode is on
- [ ] Rewrite `buildMenuBar()` to construct all six menus per Table T01:
  - **Tug menu:** About Tug (action: `showAbout:`), separator, Settings... Cmd+, (action: `showSettings:`), separator, Services submenu (empty NSMenu assigned to `NSApp.servicesMenu`), separator, Hide Tug Cmd+H (`hide:`), Hide Others Opt+Cmd+H (`hideOtherApplications:`), Show All (`unhideAllApplications:`), separator, Quit Tug Cmd+Q (`terminate:`)
  - **File menu:** Close Window Cmd+W (`performClose:`)
  - **Edit menu:** Undo Cmd+Z (`undo:`), Redo Shift+Cmd+Z (`redo:`), separator, Cut Cmd+X, Copy Cmd+C, Paste Cmd+V, Delete (`delete:`), Select All Cmd+A, separator, Find submenu per Table T02
  - **Developer menu:** Reload Frontend Cmd+R, Restart Server Shift+Cmd+R, Reset Everything Opt+Cmd+R, separator, Open Web Inspector, separator, Source Tree path (disabled), Choose Source Tree...; `isHidden` set based on `devModeEnabled`
  - **Window menu:** Minimize Cmd+M (`performMiniaturize:`), Zoom (`performZoom:`), separator, Enter Full Screen Ctrl+Cmd+F (`toggleFullScreen:`), separator, Bring All to Front (`arrangeInFront:`); register with `NSApp.windowsMenu`
  - **Help menu:** Project Home (action: `openProjectHome:`), GitHub (action: `openGitHub:`); register with `NSApp.helpMenu`
- [ ] Remove the `toggleDevMode(_:)` method (dev mode toggle now lives in Settings window)
- [ ] Add `@objc func showSettings(_:)` that calls `settingsWindowController.showWindow(nil)`
- [ ] Add `@objc func showAbout(_:)` that calls `NSApp.orderFrontStandardAboutPanel(nil)`
- [ ] Add `@objc func openProjectHome(_:)` that opens `https://tugtool.dev` via `NSWorkspace.shared.open()`
- [ ] Add `@objc func openGitHub(_:)` that opens `https://github.com/tugtool/tugtool` via `NSWorkspace.shared.open()`
- [ ] Add `updateDeveloperMenuVisibility()` method that sets `developerMenu.isHidden = !devModeEnabled`
- [ ] Keep `chooseSourceTree(_:)` in AppDelegate as the shared action method per [D08]; wire both the Developer menu's "Choose Source Tree..." item and the Settings window's "Choose..." button to call it (Settings window invokes it via its `onSourceTreeChanged` callback triggering AppDelegate)

**Tests:**
- [ ] Integration test: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` succeeds
- [ ] Manual test: launch app and verify all six menus appear
- [ ] Manual test: Cmd+W closes window, Cmd+M minimizes, Cmd+H hides
- [ ] Manual test: Cmd+, opens Settings window
- [ ] Manual test: About Tug shows copyright line
- [ ] Manual test: Help > Project Home opens browser to https://tugtool.dev
- [ ] Manual test: Help > GitHub opens browser to https://github.com/tugtool/tugtool
- [ ] Manual test: Toggle dev mode in Settings, Developer menu appears/disappears
- [ ] Manual test: Undo/Redo work in WKWebView text fields
- [ ] Manual test: Find submenu (Cmd+F) activates find in WKWebView

**Checkpoint:**
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` succeeds with no errors
- [ ] App launches with complete six-menu bar
- [ ] All keyboard shortcuts listed in Table T01 function correctly
- [ ] Developer menu is hidden when dev mode is off
- [ ] Developer menu appears when dev mode is toggled on via Settings

**Rollback:**
- Revert AppDelegate.swift to previous version (git checkout)

**Commit after all checkpoints pass.**

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tug.app has a complete, Mac-standard menu bar with six menus, a Settings window for dev mode configuration, and a proper About box with copyright.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All six menus present: Tug, File, Edit, Developer (when dev mode on), Window, Help (visual inspection at launch)
- [ ] Standard keyboard shortcuts work: Cmd+Q, Cmd+W, Cmd+H, Cmd+M, Cmd+Z, Shift+Cmd+Z, Cmd+F, Cmd+G, Cmd+,, Ctrl+Cmd+F (keyboard test)
- [ ] Settings window opens via Cmd+, and Tug > Settings...; dev mode toggle shows/hides Developer menu (functional test)
- [ ] Settings window remembers its position between app launches (close, reopen, verify position)
- [ ] About Tug shows app icon, "Tug", version, build, and "Copyright © 2026 Ken Kocienda" (visual inspection)
- [ ] Services submenu is populated by the system (right-click text, check Services)
- [ ] Window menu shows open windows list (open app, verify window name appears)
- [ ] Help menu has search field and both URL items work (click Project Home, verify browser opens to https://tugtool.dev)
- [ ] `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` completes with no errors
- [ ] No changes to `main.swift`, `MainWindow.swift`, `ProcessManager.swift`, or `TugConfig.swift`

**Acceptance tests:**
- [ ] Integration test: `plutil -lint tugapp/Info.plist` passes
- [ ] Integration test: `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` succeeds with no errors
- [ ] Manual test: full keyboard shortcut walkthrough per Table T01

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Credits.rtf for additional attribution in About panel
- [ ] Dock menu with quick actions
- [ ] Apple Help Book integration for in-app help
- [ ] Multiple settings panes with toolbar pane-switcher
- [ ] Automated UI testing with XCUITest

| Checkpoint | Verification |
|------------|--------------|
| Info.plist valid | `plutil -lint tugapp/Info.plist` |
| Clean build | `xcodebuild -project tugapp/Tug.xcodeproj -scheme Tug build` with no errors |
| All menus present | Visual inspection of menu bar |
| Keyboard shortcuts | Manual walkthrough of all key equivalents |
| Settings window | Cmd+, opens, toggle works, position saved |
| About box | Tug > About Tug shows correct info |

**Commit after all checkpoints pass.**
