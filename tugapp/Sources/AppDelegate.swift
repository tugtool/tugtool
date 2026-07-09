import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    private var window: MainWindow!
    private var processManager = ProcessManager()

    /// Maker mode — the user-facing gate on the app-maker tooling: the
    /// Maker menu, the dev-info overlay, and (outside the app-test
    /// harness) dev serving via Vite. Persisted in tugbank as
    /// `maker-mode-enabled`; the tugcast wire keeps its `dev_mode`
    /// verbs — see the boundary note at the `sendDevMode` feed sites.
    private var makerModeEnabled = false

    /// True when the app-test harness drives this launch. The harness
    /// pins production *serving* (tugcast's prebuilt `dist/`, no Vite —
    /// ~700ms faster cold launch) without overriding the user-visible
    /// maker-mode preference, so seeded-tugbank tests can exercise the
    /// Maker menu gate.
    private let isAppTestHarness = ProcessInfo.processInfo.environment["TUGAPP_APP_TEST"] == "1"

    /// The dev-*serving* switch: maker mode, except the app-test
    /// harness always serves production. Feeds Vite spawning and the
    /// tugcast `dev_mode` wire verb (which keeps its name — it really
    /// is about serving).
    private var devServingEnabled: Bool { makerModeEnabled && !isAppTestHarness }

    private var sourceTreePath: String?
    private var lastAuthURL: String?
    private var vitePort: Int = InstanceConfig.vitePort
    private var initialLoadComplete = false
    private let appLaunchTime = Date()
    private var lastLoadTime = Date()

    /// Tracks whether `bridgeFrontendReady` has fired at least once.
    ///
    /// `bridgeFrontendReady` fires every time tugdeck dispatches its
    /// `signalReady()`, which fires on every `connectionDidOpen` —
    /// initial app boot AND every reconnect. To distinguish the two,
    /// keep a flag: the first frontendReady is mount; every
    /// subsequent one is a reconnect.
    ///
    /// Used to gate the post-reconnect lifecycle replay — re-fire
    /// the current OS app-lifecycle state through the
    /// `app-lifecycle` control frame so the tugdeck-side
    /// `AppLifecycle` singleton converges on truth after frames
    /// dropped during the outage. Not wanted on the initial mount:
    /// the OS hasn't told tugdeck anything yet that needs replaying,
    /// and the first paint is driven by `revealWebView` in
    /// `MainWindow.bridgeFrontendReady`.
    private var frontendHasLoadedOnce = false
    private var makerMenu: NSMenuItem!
    private var aboutMenuItem: NSMenuItem?
    private var settingsMenuItem: NSMenuItem?

    #if DEBUG
    /// In-app test harness bridge, active only when
    /// `TUGAPP_TEST_SOCKET` env var is set. DEBUG-only.
    private var testHarnessBridge: TestHarnessBridge?
    #endif

    // File menu state
    private var closeMenuItem: NSMenuItem!
    private var closeAllCardTabsMenuItem: NSMenuItem!
    /// Save As… — its ⇧⌘S key equivalent is toggled per frontmost card.
    private var fileSaveAsMenuItem: NSMenuItem!

    // View menu state
    private var viewMenu: NSMenu!

    // Window menu state. The pane-list slice is managed in place between
    // `windowPaneListAnchor` and the following separator — the menu
    // assigned to NSApp.windowsMenu is never wholesale-rebuilt, so
    // AppKit's automatic window entries survive every open.
    private var windowMenu: NSMenu!
    private var windowPaneListAnchor: NSMenuItem?

    /// Cached menu-relevant frontend state, replaced wholesale on every
    /// `menuState` push from tugdeck. All pull-based menu validation
    /// (`validateMenuItem(_:)`) and dynamic menu building read from here.
    private var menuState = MenuState.empty

    // Theme menu state
    private var themeMenu: NSMenu!
    private var activeThemeName: String?

    /// The name of the base theme — must match BASE_THEME_NAME in tugdeck/src/theme-constants.ts.
    private let baseThemeName = "brio"

    func applicationDidFinishLaunching(_ notification: Notification) {
        let t0 = CFAbsoluteTimeGetCurrent()
        func lap(_ label: String) {
            let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
            NSLog("LAUNCH [%6.1fms] %@", ms, label)
        }

        lap("start")

        // Tug has no native window tabbing — cards and panes are Tug's own
        // navigation model, not NSWindow tabs. Disabling automatic tabbing
        // keeps AppKit from injecting the Show Previous/Next Tab, Move Tab
        // to New Window, and Merge All Windows items into the Window menu.
        NSWindow.allowsAutomaticWindowTabbing = false

        // Per-instance tugbank DB at `InstanceConfig.tugbankDbPath`.
        // TUGBANK_PATH still takes precedence as a harness override so
        // app-tests can point at a temp DB without rebuilding.
        let dbPath: String
        if let envPath = ProcessInfo.processInfo.environment["TUGBANK_PATH"],
           !envPath.isEmpty {
            dbPath = envPath
        } else {
            dbPath = InstanceConfig.tugbankDbPath.path
        }
        // Ensure the parent directory exists. On first launch of a new
        // identity the per-instance data dir doesn't yet exist; sqlite3
        // open would otherwise fail with ENOENT.
        try? FileManager.default.createDirectory(
            at: URL(fileURLWithPath: dbPath).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        TugbankClient.configure(path: dbPath)
        lap("TugbankClient.configure")

        // Placeholder rect — `MainWindow.init` overrides this
        // immediately (restored autosave frame, else 80% of the main
        // screen's visible frame, clamped to `minWindowSize`).
        let initialRect = NSRect(x: 0, y: 0, width: 1, height: 1)
        window = MainWindow(
            contentRect: initialRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        lap("MainWindow init")

        let bgHex = MainWindow.resolveStartupBackgroundHex()
        lap("resolveStartupBackgroundHex → \(bgHex)")

        window.updateBackgroundColor(bgHex)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        lap("window visible")

        window.bridgeDelegate = self
        loadPreferences()
        lap("loadPreferences")

        refreshInitialProjectPathHint()
        lap("refreshInitialProjectPathHint")

        updateDevInfoOverlay()

        #if DEBUG
        // In-app test harness: if TUGAPP_TEST_SOCKET is set, start
        // the Unix-socket listener and hand it the live WKWebView.
        // All gated by `#if DEBUG`; zero bytes ship to release.
        if let socketPath = TestHarnessBridge.envSocketPath() {
            let bridge = TestHarnessBridge(socketPath: socketPath)
            bridge.start()
            bridge.attach(webView: window.testHarnessWebView())
            self.testHarnessBridge = bridge
            lap("testHarnessBridge started")
        }
        #endif

        buildMenuBar()
        lap("buildMenuBar")

        ProcessManager.resolveShellPATH()
        lap("resolveShellPATH")

        if !ProcessManager.checkTmux() {
            let alert = NSAlert()
            alert.messageText = "tmux Required"
            alert.informativeText = "tmux is required but was not found in PATH.\nInstall it with: brew install tmux"
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        // Setup process manager
        processManager.onReady = { [weak self] url, port in
            guard let self = self else { return }
            lap("onReady (tugcast port=\(port))")
            self.lastAuthURL = url

            // Extract the auth token from the ready URL so both paths can construct their load URL.
            let token = url.components(separatedBy: "token=").dropFirst().first?.components(separatedBy: "&").first ?? ""

            if self.initialLoadComplete {
                // Tugcast restarted — silently re-authenticate without a full page reload.
                // The fetch sets the new session cookie; the WebSocket reconnection loop
                // in connection.ts will pick it up on its next attempt.
                //
                // Lifecycle replay is NOT triggered here. At this point
                // the tugdeck WebSocket is still down; tugcast's
                // broadcast channel (`dispatch_action` in `actions.rs`)
                // silently drops frames sent to a feed with no
                // subscribers. The replay is scheduled in
                // `bridgeFrontendReady` instead (gated on a
                // `frontendHasLoadedOnce` flag), which fires after
                // tugdeck's `signalReady()` runs on every
                // `connectionDidOpen` — the post-reconnect frontendReady
                // is the first moment a subscribed client exists.
                NSLog("AppDelegate: tugcast restarted, re-authenticating silently (no page reload)")
                self.window.evaluateJavaScript(
                    "fetch('/auth?token=\(token)',{credentials:'include'}).then(function(){window.tugdeck?.reconnect?.()}).catch(function(){})"
                )
                // Maker mode is the user-facing name; the tugcast wire
                // verb stays `dev_mode` — it genuinely is the
                // dev-*serving* switch (Vite, watchers, allowlist).
                self.processManager.sendDevMode(
                    enabled: self.devServingEnabled,
                    sourceTree: self.sourceTreePath,
                    vitePort: self.vitePort
                )
                return
            }
            self.initialLoadComplete = true

            if self.devServingEnabled {
                // Maker mode serves the frontend from the tugtool source via
                // Vite, so it genuinely needs a source tree. Maker mode is a
                // dev-only feature, hidden in distributed builds.
                guard let path = self.sourceTreePath else {
                    let alert = NSAlert()
                    alert.messageText = "Source Tree Required for Maker Mode"
                    alert.informativeText = "Maker mode serves the frontend from the tugtool source.\nGo to Maker > Source Tree… to set one, or turn Maker mode off."
                    alert.alertStyle = .warning
                    alert.runModal()
                    return
                }
                // Dev mode: spawn Vite (HMR), wait for it, then load from the Vite port.
                // The duplication guard inside spawnViteServer prevents re-spawning on tugcast restarts.
                self.processManager.spawnViteServer(sourceTree: path, tugcastPort: port, vitePort: self.vitePort, devMode: true)
                self.processManager.waitForViteReady(port: self.vitePort) { [weak self] ready in
                    guard let self = self else { return }
                    if !ready {
                        NSLog("AppDelegate: vite server did not become ready in 10s")
                    }
                    let viteURL = "http://127.0.0.1:\(self.vitePort)/auth?token=\(token)"
                    self.window.loadURL(viteURL)
                    // Notify tugcast to activate file watchers and set origin allowlist.
                    self.processManager.sendDevMode(enabled: true, sourceTree: path, vitePort: self.vitePort)
                }
            } else {
                // Production mode: load directly from tugcast. No Vite process is spawned.
                // tugcast serves pre-built dist/ files via ServeDir on port 55255.
                let tugcastURL = "http://127.0.0.1:\(port)/auth?token=\(token)"
                self.window.loadURL(tugcastURL)
                // Notify tugcast to update file watchers and clear dev_port from origin allowlist.
                self.processManager.sendDevMode(enabled: false, sourceTree: self.sourceTreePath, vitePort: self.vitePort)
            }
        }

        processManager.onDevModeError = { [weak self] message in
            guard let self = self else { return }
            self.window.bridgeDevModeError(message: message)
        }

        // Start tugcast
        processManager.start(sourceTree: sourceTreePath)
        lap("processManager.start returned")
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Freeze the WebView with a snapshot overlay so the user never sees
        // teardown artifacts (disconnect banners, theme flashes, blank screens).
        // The snapshot covers the WebView while save + cleanup run underneath.
        window.freezeForShutdown { [weak self] in
            guard let self = self else { return }

            // Tell the WebView to save all card states (scroll, selection, content)
            // to tugbank before we tear down. WKWebView does not fire visibilitychange
            // or beforeunload on app quit, so this is the only save trigger on exit.
            NSLog("AppDelegate: applicationShouldTerminate — calling window.tugdeck.saveState")
            self.window.evaluateJavaScript("window.tugdeck?.saveState?.()") { result, error in
                if let error = error {
                    NSLog("AppDelegate: tugdeck.saveState error: %@", error.localizedDescription)
                } else {
                    NSLog("AppDelegate: tugdeck.saveState completed successfully")
                }
                // JS used synchronous XHR, so all writes to tugbank are confirmed
                // by the time this completion handler runs. Safe to tear down.
                self.window.cleanupBridge()
                self.processManager.shutdown()
                #if DEBUG
                self.testHarnessBridge?.close()
                self.testHarnessBridge = nil
                #endif
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    // MARK: - App lifecycle (NSApplicationDelegate)
    //
    // All eight notifications route through a single `app-lifecycle`
    // control frame. The tugdeck-side `AppLifecycle` singleton
    // dispatches to every registered observer (selection-guard dim /
    // restore, deck.saveAndFlush on resign, the cascade layer added
    // in Step 7, etc.). Uniform shape: `params: ["event": "<name>"]`.

    func applicationWillBecomeActive(_ notification: Notification) {
        NSLog("AppDelegate: applicationWillBecomeActive")
        processManager.sendControl("app-lifecycle", params: ["event": "willBecomeActive"])
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        NSLog("AppDelegate: applicationDidBecomeActive")
        processManager.sendControl("app-lifecycle", params: ["event": "didBecomeActive"])
    }

    func applicationWillResignActive(_ notification: Notification) {
        NSLog("AppDelegate: applicationWillResignActive")
        processManager.sendControl("app-lifecycle", params: ["event": "willResignActive"])
    }

    func applicationDidResignActive(_ notification: Notification) {
        NSLog("AppDelegate: applicationDidResignActive")
        processManager.sendControl("app-lifecycle", params: ["event": "didResignActive"])
    }

    func applicationWillHide(_ notification: Notification) {
        NSLog("AppDelegate: applicationWillHide")
        processManager.sendControl("app-lifecycle", params: ["event": "willHide"])
    }

    func applicationDidHide(_ notification: Notification) {
        NSLog("AppDelegate: applicationDidHide")
        processManager.sendControl("app-lifecycle", params: ["event": "didHide"])
    }

    func applicationWillUnhide(_ notification: Notification) {
        NSLog("AppDelegate: applicationWillUnhide")
        processManager.sendControl("app-lifecycle", params: ["event": "willUnhide"])
    }

    func applicationDidUnhide(_ notification: Notification) {
        NSLog("AppDelegate: applicationDidUnhide")
        processManager.sendControl("app-lifecycle", params: ["event": "didUnhide"])
    }

    /// Re-fire the current OS-level app-lifecycle state through the
    /// `app-lifecycle` control frame.
    ///
    /// Called from `processManager.onReady`'s tugcast-restart branch.
    /// While tugcast was dead, every `applicationDidBecomeActive` /
    /// `applicationDidResignActive` / `applicationDidHide` /
    /// `applicationDidUnhide` notification fired into a `sendControl`
    /// call that hit the `guard let connection = controlConnection`
    /// early-return (because `handleDisconnect` cleared the ref to
    /// avoid the broken-pipe crash). The tugdeck-side `AppLifecycle`
    /// singleton therefore holds whatever state was last successfully
    /// delivered before the outage, which can disagree with the OS's
    /// current state if the user Cmd-Tabbed during the outage.
    ///
    /// This method dispatches the matching `did*` frames for the
    /// CURRENT OS state — not the history. The tugdeck-side observers
    /// (selection-guard, focus-cascade, deck.saveAndFlush) are
    /// idempotent under repeated `did*` events: each one is a
    /// state-derivation that re-runs cleanly. Don't replay `will*`
    /// frames — those mark transitions, not steady states, and
    /// have no meaning in a replay context.
    ///
    /// `replayed: true` rides on each frame so the tugdeck-side log
    /// can distinguish a replay from a literal OS notification — the
    /// observer behavior is the same; the discriminator is for
    /// diagnostics.
    private func replayLifecycleState() {
        let active = NSApp.isActive
        let hidden = NSApp.isHidden
        NSLog(
            "AppDelegate: replayLifecycleState (active=%d hidden=%d)",
            active ? 1 : 0,
            hidden ? 1 : 0
        )
        // Active/resign: send whichever matches NSApp.isActive.
        let activeEvent = active ? "didBecomeActive" : "didResignActive"
        processManager.sendControl(
            "app-lifecycle",
            params: ["event": activeEvent, "replayed": true]
        )
        // Hide/unhide: an app that's been Cmd-H'd is also `isHidden`
        // and conventionally not `isActive`. Sending both is correct:
        // the two axes are orthogonal in AppKit and the tugdeck-side
        // observers ignore the dimensions they don't care about.
        let hiddenEvent = hidden ? "didHide" : "didUnhide"
        processManager.sendControl(
            "app-lifecycle",
            params: ["event": hiddenEvent, "replayed": true]
        )
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return false
    }

    // MARK: - Preferences

    private func loadPreferences() {
        // Per-instance tugbank starts empty on a fresh identity. Both
        // `maker-mode-enabled` and `source-tree-path` fall back to
        // build-time values so a fresh dev instance lights up with
        // the Maker menu visible and its source tree wired, and
        // a fresh prod instance defaults to non-maker with the user-
        // picker flow available.
        //
        // `readTugbank` returns Optional<String>, so we can tell the
        // difference between "key absent" (use the build-profile
        // default) and "key explicitly false" (honor the user's
        // preference).
        let makerModeRaw = ProcessManager.readTugbank(
            domain: TugConfig.domain, key: TugConfig.keyMakerModeEnabled
        )
        if let raw = makerModeRaw {
            makerModeEnabled = raw.caseInsensitiveCompare("true") == .orderedSame
        } else {
            // No explicit preference yet — default from the build
            // profile baked into Info.plist by capture-build-info.sh:
            // debug bundles ship with maker mode ON; release bundles
            // ship with it OFF. The app-test harness reads an absent
            // key as deterministically OFF instead, so menu-structure
            // assertions don't depend on the build profile; a seeded
            // tugbank value above is honored as-is under the harness.
            makerModeEnabled = isAppTestHarness ? false : (BuildInfo.profile == "debug")
        }

        sourceTreePath = ProcessManager.readTugbank(
            domain: TugConfig.domain, key: TugConfig.keySourceTreePath
        )
        if sourceTreePath == nil, let buildTimePath = BuildInfo.sourceTree {
            sourceTreePath = buildTimePath
        }
    }

    private func savePreferences() {
        ProcessManager.writeTugbank(domain: TugConfig.domain, key: TugConfig.keyMakerModeEnabled, value: makerModeEnabled ? "true" : "false")
        if let path = sourceTreePath {
            ProcessManager.writeTugbank(domain: TugConfig.domain, key: TugConfig.keySourceTreePath, value: path)
        }
    }

    /// Refresh the Dev picker's "initial project path" hint so a first-
    /// time user (no Recent Project Paths yet) has a sensible default
    /// they can hit Open on without typing. Debug builds point at the
    /// repo source tree; release builds point at `$HOME`. Written every
    /// launch — it's a derived hint, not user preference.
    private func refreshInitialProjectPathHint() {
        let value: String
        if BuildInfo.profile == "debug", let tree = sourceTreePath {
            value = tree
        } else {
            value = NSHomeDirectory()
        }
        ProcessManager.writeTugbank(
            domain: TugConfig.domain,
            key: TugConfig.keyInitialProjectPath,
            value: value
        )
    }

    // MARK: - Menu Bar

    /// The running variant's display name — "Tug", "Tug-debug",
    /// "Tug-apptest", "Tug-worktree", etc. Read from the bundle, the
    /// same source AppKit uses for the app-menu title (so "About …",
    /// "Hide …", and "Quit …" match the title exactly). The name keys
    /// are stamped per-variant at build time by assign-bundle-id.sh;
    /// never hardcoded here. Falls back to the process name if both
    /// bundle keys are somehow absent.
    private var appDisplayName: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? ProcessInfo.processInfo.processName
    }

    private func buildMenuBar() {
        let mainMenu = NSMenu()
        let appName = appDisplayName

        // Tug (App) Menu - position 0
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        let aboutItem = NSMenuItem(title: "About \(appName)", action: #selector(showAbout(_:)), keyEquivalent: "")
        aboutItem.isEnabled = false
        aboutItem.identifier = NSUserInterfaceItemIdentifier("app.about")
        self.aboutMenuItem = aboutItem
        appMenu.addItem(aboutItem)
        appMenu.addItem(NSMenuItem.separator())
        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(showSettings(_:)), keyEquivalent: ",")
        settingsItem.isEnabled = false
        settingsItem.identifier = NSUserInterfaceItemIdentifier("app.settings")
        self.settingsMenuItem = settingsItem
        appMenu.addItem(settingsItem)
        // Log Out… — app-level account action, right below Settings. Sends the
        // app-level `logout` control frame (not a per-card command), so it works
        // even with no card open; tugdeck's TugLogout runs the confirm → logout
        // flow. Enabled always (validateMenuItem default); a no-op when already
        // logged out (TugLogout guards on the auth state).
        let logoutItem = NSMenuItem(title: "Log Out...", action: #selector(logOut(_:)), keyEquivalent: "")
        logoutItem.identifier = NSUserInterfaceItemIdentifier("app.logout")
        appMenu.addItem(logoutItem)
        appMenu.addItem(NSMenuItem.separator())

        // Services submenu
        let servicesMenuItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        servicesMenuItem.identifier = NSUserInterfaceItemIdentifier("app.services")
        let servicesMenu = NSMenu(title: "Services")
        servicesMenuItem.submenu = servicesMenu
        appMenu.addItem(servicesMenuItem)
        NSApp.servicesMenu = servicesMenu

        appMenu.addItem(NSMenuItem.separator())
        let hideItem = NSMenuItem(title: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hideItem.identifier = NSUserInterfaceItemIdentifier("app.hide")
        appMenu.addItem(hideItem)
        let hideOthersItem = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h", modifierMask: [.command, .option])
        hideOthersItem.identifier = NSUserInterfaceItemIdentifier("app.hideOthers")
        appMenu.addItem(hideOthersItem)
        let showAllItem = NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        showAllItem.identifier = NSUserInterfaceItemIdentifier("app.showAll")
        appMenu.addItem(showAllItem)
        appMenu.addItem(NSMenuItem.separator())
        let quitItem = NSMenuItem(title: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quitItem.identifier = NSUserInterfaceItemIdentifier("app.quit")
        appMenu.addItem(quitItem)

        // File Menu - position 1
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu

        // Card creation, flattened — two production card types don't need
        // a submenu. The debug-only gallery / hello-world / active-pane
        // creators live in the app-maker menu, gated at compile time on
        // BuildInfo.profile.
        fileMenu.addItem(NSMenuItem(title: "New Dev Card", action: #selector(newDevCard(_:)), keyEquivalent: "n").identified("file.newDevCard"))
        fileMenu.addItem(NSMenuItem(title: "New Git Card", action: #selector(newGitCard(_:)), keyEquivalent: "n", modifierMask: [.command, .shift]).identified("file.newGitCard"))
        // New Text File (⌥⌘N): a new untitled manual buffer — no file
        // exists until the first Save.
        fileMenu.addItem(NSMenuItem(title: "New Text File", action: #selector(newTextFile(_:)), keyEquivalent: "n", modifierMask: [.command, .option]).identified("file.newTextFile"))

        // Open File… (⌘O): NSOpenPanel → `open-file` Control frame. The
        // web layer reuses an existing File card bound to the chosen
        // path or opens a new one (action-dispatch.ts `open-file`).
        fileMenu.addItem(NSMenuItem(title: "Open File…", action: #selector(openFileInEditor(_:)), keyEquivalent: "o").identified("file.openFile"))

        fileMenu.addItem(NSMenuItem.separator())

        // Close Card (⌘W): routes through the web view's responder chain
        // rather than NSWindow.performClose. The custom selector sends a
        // Control frame that action-dispatch.ts turns into a `close` chain
        // dispatch, which lands on TugPane's registered handler. Without the
        // round-trip, AppKit would swallow ⌘W at the menubar and the WKWebView
        // would never see the keystroke. The web layer decides whether ⌘W
        // closes the active card or the whole pane (single-card case); the
        // label stays "Close Card" regardless.
        closeMenuItem = NSMenuItem(title: "Close Card", action: #selector(closeActiveCard(_:)), keyEquivalent: "w")
        // Stable identifier for native-menu introspection (test harness
        // `menuItemState` / `menuSnapshot`).
        closeMenuItem.identifier = NSUserInterfaceItemIdentifier("file.closeCard")
        fileMenu.addItem(closeMenuItem)

        // Close All Card Tabs (⌥⌘W): closes every tab in the focused pane via
        // the same `close-all` responder-chain round-trip `close` uses. Enabled
        // only when the focused pane holds more than one card — see
        // validateMenuItem(_:). The web layer pops the "Close N Tabs?"
        // confirm when any hosted card opts into confirmClose.
        closeAllCardTabsMenuItem = NSMenuItem(title: "Close All Card Tabs", action: #selector(closeAllCardTabs(_:)), keyEquivalent: "w", modifierMask: [.command, .option])
        closeAllCardTabsMenuItem.identifier = NSUserInterfaceItemIdentifier("file.closeAllCardTabs")
        fileMenu.addItem(closeAllCardTabsMenuItem)

        fileMenu.addItem(NSMenuItem.separator())

        // Save (⌘S): flush the focused editor's pending edits to disk
        // now. Under the File card's live autosave there is no dirty
        // state — this is "write immediately + checkpoint", routed as a
        // `save` Control frame → responder-chain SAVE dispatch. AppKit
        // swallows ⌘S at the menubar, so the menu item must carry the
        // chord; the web keybinding-map entry covers browser-only dev.
        fileMenu.addItem(NSMenuItem(title: "Save", action: #selector(saveActiveEditor(_:)), keyEquivalent: "s").identified("file.save"))
        // Save As… (⇧⌘S) — the key equivalent is assigned DYNAMICALLY in
        // updateMenuState only while a File card is frontmost; a
        // static ⇧⌘S would eat the Dev card's Shell-route chord.
        fileSaveAsMenuItem = NSMenuItem(title: "Save As…", action: #selector(saveAsActiveEditor(_:)), keyEquivalent: "").identified("file.saveAs")
        fileMenu.addItem(fileSaveAsMenuItem)
        // Save a Copy… (⌥⇧⌘S) and the revert/reload verbs collide with
        // nothing, so they stay statically bound.
        fileMenu.addItem(NSMenuItem(title: "Save a Copy…", action: #selector(saveACopyActiveEditor(_:)), keyEquivalent: "s", modifierMask: [.command, .option, .shift]).identified("file.saveACopy"))
        fileMenu.addItem(NSMenuItem.separator())
        fileMenu.addItem(NSMenuItem(title: "Revert to Saved", action: #selector(revertActiveEditor(_:)), keyEquivalent: "").identified("file.revertToSaved"))
        fileMenu.addItem(NSMenuItem(title: "Reload from Disk", action: #selector(reloadActiveEditor(_:)), keyEquivalent: "").identified("file.reloadFromDisk"))

        fileMenu.addItem(NSMenuItem.separator())

        // Export Transcript… — the dev card's `/export` surface, reached
        // through the generic run-card-command round-trip. Dev-card-gated
        // in validateMenuItem(_:).
        let exportItem = NSMenuItem(title: "Export Transcript…", action: #selector(runCardCommand(_:)), keyEquivalent: "").identified("file.exportTranscript")
        exportItem.representedObject = "export"
        fileMenu.addItem(exportItem)

        // Edit Menu - position 2
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        // Undo / Redo target performUndo/performRedo wrappers, NOT the
        // bare `undo:` selectors AppKit would auto-validate against an
        // NSUndoManager — the web view's undoManager is per-web-view and
        // knows nothing about card activation, so unconditional
        // auto-validation kept showing a deactivated card's undo state.
        // Validation and execution are two-path, discriminated by
        // MenuState.edit.nativeUndoToken (see validateMenuItem and the
        // wrappers): chain caps + control-frame round-trip for the CM6
        // editors (card-scoped history depth + "Undo Typing" nouns), and
        // the web view's NSUndoManager — live canUndo + native selector —
        // for browser-native text controls, scoped by the token-change
        // clear. A chord on a DISABLED item is eaten at the menu bar with
        // a beep (it does NOT fall through to the web view), which is why
        // the native path must light the item rather than stay dark.
        editMenu.addItem(NSMenuItem(title: "Undo", action: #selector(performUndo(_:)), keyEquivalent: "z").identified("edit.undo"))
        editMenu.addItem(NSMenuItem(title: "Redo", action: #selector(performRedo(_:)), keyEquivalent: "z", modifierMask: [.command, .shift]).identified("edit.redo"))
        editMenu.addItem(NSMenuItem.separator())
        // The remaining edit actions target AppDelegate wrappers
        // (performCopy / …) rather than the bare NSText selectors so that
        // `validateMenuItem(_:)` is consulted — the wrappers resolve to
        // this delegate, the native selectors would resolve to the
        // WKWebView and be validated by WebKit, which over-enables Copy /
        // Select All because a web page is always "selectable" regardless
        // of our focus state. Each wrapper re-dispatches its native AppKit
        // selector to the first responder synchronously (`NSApp.sendAction`),
        // so the system pasteboard and the in-gesture clipboard path are
        // preserved untouched — enablement is the only thing we take over,
        // pulled from MenuState.edit (the web responder chain's caps).
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(performCut(_:)), keyEquivalent: "x").identified("edit.cut"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(performCopy(_:)), keyEquivalent: "c").identified("edit.copy"))
        // Copy as Plain Text — a chain-action round-trip (NOT the native
        // NSText.copy selector). The web responder chain strips Markdown
        // from the selection and writes the plain text to the clipboard;
        // enablement reuses the copy gate (MenuState.edit.copy) since both
        // need a selection.
        editMenu.addItem(NSMenuItem(title: "Copy as Plain Text", action: #selector(performCopyAsPlainText(_:)), keyEquivalent: "c", modifierMask: [.command, .shift]).identified("edit.copyAsPlainText"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(performPaste(_:)), keyEquivalent: "v").identified("edit.paste"))
        // Paste variants — chain-action round-trips (NOT the native
        // NSText.paste selector). The web responder chain reads the
        // clipboard via the native bridge, rewrites it (blockquote wrap /
        // Markdown strip), and inserts; enablement reuses the paste gate
        // (MenuState.edit.paste) since both need an editable surface.
        editMenu.addItem(NSMenuItem(title: "Paste as Quote", action: #selector(performPasteAsQuote(_:)), keyEquivalent: "v", modifierMask: [.command, .option]).identified("edit.pasteAsQuote"))
        editMenu.addItem(NSMenuItem(title: "Paste as Plain Text", action: #selector(performPasteAsPlainText(_:)), keyEquivalent: "v", modifierMask: [.command, .shift]).identified("edit.pasteAsPlainText"))
        editMenu.addItem(NSMenuItem(title: "Delete", action: #selector(performDelete(_:)), keyEquivalent: "").identified("edit.delete"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(performSelectAll(_:)), keyEquivalent: "a").identified("edit.selectAll"))
        editMenu.addItem(NSMenuItem.separator())

        // Copy Last Response — the dev card's `/copy` surface. Gated on a
        // dev card being frontmost AND its transcript holding an
        // assistant message (validateMenuItem).
        let copyLastItem = NSMenuItem(title: "Copy Last Response", action: #selector(runCardCommand(_:)), keyEquivalent: "").identified("edit.copyLastResponse")
        copyLastItem.representedObject = "copy"
        editMenu.addItem(copyLastItem)
        editMenu.addItem(NSMenuItem.separator())

        // Find submenu — chain-action round-trips. The previous
        // NSTextView.performFindPanelAction items never reached WKWebView
        // content (dead UI); these dispatch the web responder chain's
        // find / find-next / find-previous, handled by the focused card's
        // find session. Enablement is gated on MenuState.edit (the
        // responder chain's find capability): disabled until a
        // find-capable surface is focused, so the items aren't live
        // shortcuts to a no-op while no card implements find.
        let findMenuItem = NSMenuItem(title: "Find", action: nil, keyEquivalent: "")
        let findMenu = NSMenu(title: "Find")
        findMenuItem.submenu = findMenu
        findMenu.addItem(NSMenuItem(title: "Find...", action: #selector(performFind(_:)), keyEquivalent: "f").identified("edit.find"))
        findMenu.addItem(NSMenuItem(title: "Find Next", action: #selector(performFindNext(_:)), keyEquivalent: "g").identified("edit.findNext"))
        findMenu.addItem(NSMenuItem(title: "Find Previous", action: #selector(performFindPrevious(_:)), keyEquivalent: "g", modifierMask: [.command, .shift]).identified("edit.findPrevious"))
        editMenu.addItem(findMenuItem)

        // Session Menu - position 3. The dev card's command surfaces,
        // first-class in the menu bar. The menu is always present and its
        // items validate to disabled without a frontmost dev card
        // (stable bars with disabled items beat vanishing menus for
        // discoverability); most items are run-card-command round-trips
        // into the card's slash-command surface map.
        let sessionMenuItem = NSMenuItem()
        mainMenu.addItem(sessionMenuItem)
        let sessionMenu = NSMenu(title: "Session")
        sessionMenuItem.submenu = sessionMenu

        sessionMenu.addItem(NSMenuItem(title: "Focus Prompt", action: #selector(focusPrompt(_:)), keyEquivalent: "k").identified("session.focusPrompt"))
        // Stop has no key equivalent by design: Escape already routes
        // interrupt through the chain with dismiss-first priority
        // (popover > drag-cancel > interrupt); this item is the
        // discoverable, always-means-interrupt face of that path,
        // gated on canInterrupt.
        sessionMenu.addItem(NSMenuItem(title: "Stop", action: #selector(stopSession(_:)), keyEquivalent: "").identified("session.stop"))
        sessionMenu.addItem(NSMenuItem.separator())

        func sessionCommandItem(_ title: String, _ command: String, _ id: String) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: #selector(runCardCommand(_:)), keyEquivalent: "").identified(id)
            item.representedObject = command
            return item
        }
        sessionMenu.addItem(sessionCommandItem("Clear Session", "clear", "session.new"))
        sessionMenu.addItem(sessionCommandItem("Resume Session…", "resume", "session.resume"))
        sessionMenu.addItem(sessionCommandItem("Rename Session…", "rename", "session.rename"))
        sessionMenu.addItem(NSMenuItem.separator())

        // Permission Mode — a native radio submenu over the four
        // cycle-reachable modes (bypassPermissions is deliberately not
        // menu-reachable, matching the chip's Shift-Tab cycle). Titles
        // are hardcoded for label parity with formatPermissionMode; the
        // mode string rides representedObject. Checkmarks refresh in
        // validateMenuItem from MenuState.dev.permissionMode.
        let permissionModeItem = NSMenuItem(title: "Permission Mode", action: nil, keyEquivalent: "").identified("session.permissionMode")
        let permissionModeMenu = NSMenu(title: "Permission Mode")
        permissionModeItem.submenu = permissionModeMenu
        for (title, mode) in [("Default", "default"), ("Accept Edits", "acceptEdits"), ("Plan", "plan"), ("Auto", "auto")] {
            let item = NSMenuItem(title: title, action: #selector(setPermissionModeFromMenu(_:)), keyEquivalent: "").identified("session.permissionMode.\(mode)")
            item.representedObject = mode
            permissionModeMenu.addItem(item)
        }
        permissionModeMenu.addItem(NSMenuItem.separator())
        permissionModeMenu.addItem(NSMenuItem(title: "Cycle Permission Mode", action: #selector(cyclePermissionModeFromMenu(_:)), keyEquivalent: "p", modifierMask: [.command, .shift]).identified("session.permissionMode.cycle"))
        sessionMenu.addItem(permissionModeItem)

        sessionMenu.addItem(sessionCommandItem("Model…", "model", "session.model"))
        sessionMenu.addItem(sessionCommandItem("Reasoning Effort…", "effort", "session.effort"))
        sessionMenu.addItem(sessionCommandItem("Permission Rules…", "permissions", "session.permissionRules"))
        sessionMenu.addItem(NSMenuItem.separator())
        sessionMenu.addItem(sessionCommandItem("Rewind…", "rewind", "session.rewind"))
        sessionMenu.addItem(sessionCommandItem("Compact Conversation", "compact", "session.compact"))
        sessionMenu.addItem(NSMenuItem.separator())
        sessionMenu.addItem(sessionCommandItem("Add Working Directory…", "add-dir", "session.addDir"))
        sessionMenu.addItem(sessionCommandItem("Show Code Changes", "diff", "session.diff"))
        sessionMenu.addItem(sessionCommandItem("Show Context", "context", "session.context"))
        sessionMenu.addItem(NSMenuItem.separator())
        sessionMenu.addItem(sessionCommandItem("Skills", "skills", "session.skills"))
        sessionMenu.addItem(sessionCommandItem("Agents", "agents", "session.agents"))
        sessionMenu.addItem(sessionCommandItem("Hooks", "hooks", "session.hooks"))
        sessionMenu.addItem(sessionCommandItem("Memory", "memory", "session.memory"))

        // View Menu - position 4.
        // Appearance and page zoom; rebuilt on every open in
        // menuNeedsUpdate (theme submenu + zoom enablement).
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let vMenu = NSMenu(title: "View")
        vMenu.delegate = self
        viewMenuItem.submenu = vMenu
        self.viewMenu = vMenu

        // Theme submenu — populated dynamically via NSMenuDelegate. The
        // NSMenu instance persists across View-menu rebuilds; each rebuild
        // wraps it in a fresh parent item.
        let dynamicThemeMenu = NSMenu(title: "Theme")
        dynamicThemeMenu.delegate = self
        self.themeMenu = dynamicThemeMenu

        // Window Menu - position 5. Static items are built once here and
        // never touched by the delegate; only the dynamic `window.pane.*`
        // slice (between paneListAnchor and the following separator) churns
        // in menuNeedsUpdate. NSApp.windowsMenu keeps AppKit's automatic
        // window entries at the menu tail — never removeAllItems() here.
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let wMenu = NSMenu(title: "Window")
        wMenu.delegate = self
        windowMenuItem.submenu = wMenu
        self.windowMenu = wMenu
        wMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m").identified("window.minimize"))
        wMenu.addItem(NSMenuItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "").identified("window.zoom"))
        wMenu.addItem(NSMenuItem.separator())
        wMenu.addItem(NSMenuItem(title: "Cascade", action: #selector(cascadeCards(_:)), keyEquivalent: "c", modifierMask: [.control, .option]).identified("window.cascade"))
        wMenu.addItem(NSMenuItem(title: "Tile", action: #selector(tileCards(_:)), keyEquivalent: "t", modifierMask: [.control, .option]).identified("window.tile"))
        wMenu.addItem(NSMenuItem.separator())
        // Card / pane navigation — chain round-trips for the chords AppKit
        // now swallows at the menu bar (⇧⌘[ / ⇧⌘] / ⌃`).
        wMenu.addItem(NSMenuItem(title: "Previous Card", action: #selector(previousCard(_:)), keyEquivalent: "[", modifierMask: [.command, .shift]).identified("window.previousCard"))
        wMenu.addItem(NSMenuItem(title: "Next Card", action: #selector(nextCard(_:)), keyEquivalent: "]", modifierMask: [.command, .shift]).identified("window.nextCard"))
        wMenu.addItem(NSMenuItem(title: "Cycle Panes", action: #selector(cyclePanes(_:)), keyEquivalent: "`", modifierMask: [.control]).identified("window.cyclePanes"))
        // Anchor separator for the dynamic pane-list slice: pane items are
        // inserted directly after it (and removed by identifier prefix) on
        // every menu open. macOS hides the redundant separator pair when
        // the slice is empty.
        let paneAnchor = NSMenuItem.separator()
        self.windowPaneListAnchor = paneAnchor
        wMenu.addItem(paneAnchor)
        wMenu.addItem(NSMenuItem.separator())
        wMenu.addItem(NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f", modifierMask: [.command, .control]).identified("window.enterFullScreen"))
        wMenu.addItem(NSMenuItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "").identified("window.bringAllToFront"))
        NSApp.windowsMenu = wMenu

        // Maker Menu - position 6. Tooling for makers *of* the app —
        // "dev" stays free to mean the Dev card's domain. Hidden (not
        // disabled) behind the maker-mode gate: a *mode*, not a focus
        // state, so hide-on-gate is the right shape here.
        makerMenu = NSMenuItem()
        mainMenu.addItem(makerMenu)
        let mMenu = NSMenu(title: "Maker")
        makerMenu.submenu = mMenu
        let reloadItem = NSMenuItem(title: "Reload", action: #selector(reload(_:)), keyEquivalent: "r").identified("maker.reload")
        reloadItem.target = self
        mMenu.addItem(reloadItem)
        mMenu.addItem(NSMenuItem.separator())
        mMenu.addItem(NSMenuItem(title: "Show JavaScript Console", action: #selector(showJavaScriptConsole(_:)), keyEquivalent: "c", modifierMask: [.command, .option]).identified("maker.jsConsole"))
        mMenu.addItem(NSMenuItem(title: "Show Dev Panel", action: #selector(showDevPanel(_:)), keyEquivalent: "/", modifierMask: [.command, .option]).identified("maker.devPanel"))
        if BuildInfo.profile == "debug" {
            // Debug-only card creators, relocated from the flattened
            // File ▸ New submenu. Compile-time gated so release bundles
            // never expose the gallery + hello-world creation surfaces.
            mMenu.addItem(NSMenuItem.separator())
            mMenu.addItem(NSMenuItem(title: "New Component Gallery Card", action: #selector(newComponentGalleryCard(_:)), keyEquivalent: "n", modifierMask: [.command, .option]).identified("maker.galleryCard"))
            mMenu.addItem(NSMenuItem(title: "New Hello World Card", action: #selector(newHelloWorldCard(_:)), keyEquivalent: "n", modifierMask: [.command, .option, .shift]).identified("maker.helloCard"))
            // New Card in Active Pane (⌘T): the tab-creation chord.
            // Validated against deck state (needs a pane to add to).
            mMenu.addItem(NSMenuItem(title: "New Card in Active Pane", action: #selector(addCardToActivePane(_:)), keyEquivalent: "t").identified("maker.newCardInPane"))
        }
        mMenu.addItem(NSMenuItem.separator())
        mMenu.addItem(NSMenuItem(title: "Source Tree...", action: #selector(sourceTree(_:)), keyEquivalent: "").identified("maker.sourceTree"))
        makerMenu.isHidden = !makerModeEnabled

        // Help Menu - position 7
        let helpMenuItem = NSMenuItem()
        mainMenu.addItem(helpMenuItem)
        let helpMenu = NSMenu(title: "Help")
        helpMenuItem.submenu = helpMenu
        // Keyboard Shortcuts & Commands — the dev card's `/help` sheet via
        // run-card-command. Dev-card-gated in validateMenuItem(_:).
        let shortcutsItem = NSMenuItem(title: "Keyboard Shortcuts & Commands", action: #selector(runCardCommand(_:)), keyEquivalent: "").identified("help.shortcuts")
        shortcutsItem.representedObject = "help"
        helpMenu.addItem(shortcutsItem)
        helpMenu.addItem(NSMenuItem.separator())
        helpMenu.addItem(NSMenuItem(title: "Project Home", action: #selector(openProjectHome(_:)), keyEquivalent: "").identified("help.projectHome"))
        helpMenu.addItem(NSMenuItem(title: "GitHub", action: #selector(openGitHub(_:)), keyEquivalent: "").identified("help.github"))
        NSApp.helpMenu = helpMenu

        NSApp.mainMenu = mainMenu
    }

    // MARK: - Actions

    @objc func showSettings(_ sender: Any?) {
        sendControl("show-card", params: ["component": "settings"])
    }

    @objc func logOut(_ sender: Any?) {
        sendControl("logout")
    }

    @objc func showAbout(_ sender: Any?) {
        // The About card reads its identity from this payload (parked in
        // tugdeck's appInfoStore) — version/build/copyright from
        // Info.plist, the rest from BuildInfo, plus the running
        // bundle's app icon as a data URL (so debug/nightly builds show
        // their own icon). All constant for the process lifetime.
        let info = Bundle.main.infoDictionary ?? [:]
        sendControl("show-card", params: [
            "component": "about",
            // The variant's display name (e.g. "Tug-debug"), the same
            // dynamic source the menu bar and app-menu items use — never
            // hardcoded. The About card's wordmark and title bar read it.
            "name": appDisplayName,
            "version": info["CFBundleShortVersionString"] as? String ?? "",
            "build": info["CFBundleVersion"] as? String ?? "",
            "commit": BuildInfo.commit,
            "branch": BuildInfo.branch,
            "profile": BuildInfo.profile,
            "copyright": info["NSHumanReadableCopyright"] as? String ?? "",
            "icon": Self.appIconDataURL,
        ])
    }

    /// The running app's icon rendered to a 256px PNG data URL for the
    /// About card. Computed once — the icon never changes within a
    /// process lifetime. Empty string when no icon can be rendered
    /// (the card falls back to its placeholder glyph).
    private static let appIconDataURL: String = {
        guard let icon = NSApp.applicationIconImage else { return "" }
        var rect = NSRect(x: 0, y: 0, width: 256, height: 256)
        guard let cg = icon.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
            return ""
        }
        let rep = NSBitmapImageRep(cgImage: cg)
        guard let png = rep.representation(using: .png, properties: [:]) else { return "" }
        return "data:image/png;base64," + png.base64EncodedString()
    }()

    @objc private func selectTheme(_ sender: NSMenuItem) {
        let name = sender.representedObject as? String ?? sender.title
        activeThemeName = name
        sendControl("set-theme", params: ["theme": name])
    }

    @objc func openProjectHome(_ sender: Any?) {
        if let url = URL(string: "https://tugtool.dev") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func openGitHub(_ sender: Any?) {
        if let url = URL(string: "https://github.com/tugtool/tugtool") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func reload(_ sender: Any) {
        sendControl("reload")
    }

    @objc private func showJavaScriptConsole(_ sender: Any) {
        window.openWebInspector()
    }

    /// Toggle the TugDevPanel — persistent dev inspector surface in
    /// tugdeck. Routes through the standard `sendControl` channel so
    /// tugdeck's action-dispatch picks it up the same way other
    /// menu-driven RPCs do.
    @objc private func showDevPanel(_ sender: Any) {
        sendControl("show-dev-panel-toggle")
    }

    @objc private func cascadeCards(_ sender: Any?) {
        sendControl("arrange-cards", params: ["mode": "cascade"])
    }

    @objc private func tileCards(_ sender: Any?) {
        sendControl("arrange-cards", params: ["mode": "tile"])
    }

    @objc private func actualSize(_ sender: Any?) {
        window.actualSize()
    }

    @objc private func zoomIn(_ sender: Any?) {
        window.zoomIn()
    }

    @objc private func zoomOut(_ sender: Any?) {
        window.zoomOut()
    }

    @objc private func focusPaneFromMenu(_ sender: NSMenuItem) {
        guard let paneId = sender.representedObject as? String else { return }
        sendControl("focus-pane", params: ["paneId": paneId])
    }

    @objc private func newComponentGalleryCard(_ sender: Any?) {
        sendControl("show-component-gallery")
    }

    @objc private func newHelloWorldCard(_ sender: Any) {
        sendControl("show-card", params: ["component": "hello"])
    }

    @objc private func newGitCard(_ sender: Any) {
        sendControl("show-card", params: ["component": "git"])
    }

    @objc private func newDevCard(_ sender: Any) {
        sendControl("show-card", params: ["component": "dev"])
    }

    @objc private func openFileInEditor(_ sender: Any) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.sendControl("open-file", params: ["path": url.path])
        }
    }

    @objc private func saveActiveEditor(_ sender: Any) {
        // Bare chain-action name "save" (Both-category identity action,
        // same convention as "close").
        sendControl("save")
    }

    @objc private func saveAsActiveEditor(_ sender: Any) {
        sendControl("save-as")
    }

    @objc private func saveACopyActiveEditor(_ sender: Any) {
        sendControl("save-a-copy")
    }

    @objc private func revertActiveEditor(_ sender: Any) {
        sendControl("revert-to-saved")
    }

    @objc private func reloadActiveEditor(_ sender: Any) {
        sendControl("reload-from-disk")
    }

    @objc private func newTextFile(_ sender: Any) {
        sendControl("new-text-file")
    }

    @objc private func nextTheme(_ sender: Any) {
        sendControl("next-theme")
    }

    @objc private func addCardToActivePane(_ sender: Any) {
        sendControl("add-card-to-active-pane")
    }

    @objc private func closeActiveCard(_ sender: Any) {
        // Wire format is the bare chain-action name "close" (a Both-
        // category identity action — see tugdeck/src/action-dispatch.ts
        // and tuglaws/action-naming.md). The Swift method name stays
        // as `closeActiveCard` because it still describes what the
        // method does: close the active card via the responder chain.
        // In a multi-card pane the chain's handler removes the active
        // card from the pane; in a single-card pane it removes the last
        // card (pane goes away). Either way, "close the active card" is the right
        // mental model at the dispatch site.
        sendControl("close")
    }

    @objc private func closeAllCardTabs(_ sender: Any) {
        // Wire format is the bare chain-action name "close-all". The web
        // layer's responder chain walks it to the focused pane, which
        // closes every hosted tab — popping the "Close N Tabs?" confirm
        // first when any of its cards opts into confirmClose. Enablement
        // is gated in validateMenuItem(_:): only a multi-card focused pane
        // makes this command meaningful.
        sendControl("close-all")
    }

    /// One selector for every menu item whose action is a dev-card local
    /// slash command: the command name rides `representedObject`, and the
    /// frame re-enters the card's slash-command surface map key-card-scoped
    /// in tugdeck — byte-identical to typing the command. Items send no
    /// args (bare `rename` opens the seeded one-field sheet, etc.).
    @objc private func runCardCommand(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        sendControl("run-card-command", params: ["name": name])
    }

    // Session menu actions.

    @objc private func focusPrompt(_ sender: Any?) {
        sendControl("focus-prompt")
    }

    @objc private func stopSession(_ sender: Any?) {
        sendControl("interrupt-session")
    }

    @objc private func setPermissionModeFromMenu(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        sendControl("set-permission-mode", params: ["mode": mode])
    }

    @objc private func cyclePermissionModeFromMenu(_ sender: Any?) {
        sendControl("cycle-permission-mode")
    }

    // Edit ▸ Undo / Redo — two execution paths, matching the two
    // validation sources (see validateMenuItem):
    //   - Native text control focused: drive the web view's NSUndoManager
    //     through the native selector — the only route to a browser-native
    //     input's undo stack. Card-safety comes from the token-change
    //     clear in updateMenuState, not from avoiding the manager.
    //   - Otherwise: chain round-trip to the focused editor's own history
    //     (CM6). Undo isn't gesture-sensitive the way the clipboard is,
    //     so the async control-frame round-trip is fine.
    @objc private func performUndo(_ sender: Any?) {
        if menuState.edit.nativeUndoToken != 0 {
            NSApp.sendAction(Selector(("undo:")), to: nil, from: sender)
        } else {
            sendControl("undo")
        }
    }

    @objc private func performRedo(_ sender: Any?) {
        if menuState.edit.nativeUndoToken != 0 {
            NSApp.sendAction(Selector(("redo:")), to: nil, from: sender)
        } else {
            sendControl("redo")
        }
    }

    // Edit ▸ clipboard actions — thin AppDelegate wrappers that re-dispatch
    // the native AppKit selector to the first responder. Routing through
    // these (instead of binding the menu item directly to the native
    // selector) puts validation under `validateMenuItem(_:)` / MenuState
    // while leaving the action itself byte-identical to what AppKit would
    // have done: a synchronous responder-chain send that the WKWebView
    // services natively (system pasteboard, in-gesture clipboard).
    @objc private func performCut(_ sender: Any?) {
        NSApp.sendAction(#selector(NSText.cut(_:)), to: nil, from: sender)
    }

    @objc private func performCopy(_ sender: Any?) {
        NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: sender)
    }

    @objc private func performPaste(_ sender: Any?) {
        NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: sender)
    }

    // Edit ▸ Copy as Plain Text — a chain-action round-trip. Unlike Copy,
    // this does NOT re-dispatch NSText.copy: the Markdown-strip transform
    // lives in the web responder chain, which writes the plain text to the
    // clipboard. An unhandled dispatch is a silent no-op (no selection).
    @objc private func performCopyAsPlainText(_ sender: Any?) {
        sendControl("copy-as-plain-text")
    }

    @objc private func performDelete(_ sender: Any?) {
        NSApp.sendAction(#selector(NSText.delete(_:)), to: nil, from: sender)
    }

    @objc private func performSelectAll(_ sender: Any?) {
        NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: sender)
    }

    // Edit ▸ Paste as Quote / Paste as Plain Text — chain-action
    // round-trips. Unlike Cut/Copy/Paste, these do NOT re-dispatch a
    // native NSText selector: the transform (blockquote wrap / Markdown
    // strip) lives in the web responder chain, which reads the clipboard
    // via the native bridge before inserting. An unhandled dispatch is a
    // silent no-op (no editable surface focused).
    @objc private func performPasteAsQuote(_ sender: Any?) {
        sendControl("paste-as-quote")
    }

    @objc private func performPasteAsPlainText(_ sender: Any?) {
        sendControl("paste-as-plain-text")
    }

    // Edit ▸ Find — chain-action round-trips (the web responder chain's
    // find session owns the semantics; an unhandled dispatch is a no-op).
    @objc private func performFind(_ sender: Any?) {
        sendControl("find")
    }

    @objc private func performFindNext(_ sender: Any?) {
        sendControl("find-next")
    }

    @objc private func performFindPrevious(_ sender: Any?) {
        sendControl("find-previous")
    }

    // Window ▸ card / pane navigation — chain-action round-trips for the
    // chords the menu bar now swallows.
    @objc private func previousCard(_ sender: Any?) {
        sendControl("previous-tab")
    }

    @objc private func nextCard(_ sender: Any?) {
        sendControl("next-tab")
    }

    @objc private func cyclePanes(_ sender: Any?) {
        sendControl("cycle-card")
    }

    @objc private func sourceTree(_ sender: Any) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Choose the tugtool mono-repo root directory"

        if panel.runModal() == .OK, let url = panel.url {
            if !TugConfig.isValidSourceTree(url) {
                let markers = TugConfig.sourceTreeMarkers.joined(separator: "\n  ")
                let alert = NSAlert()
                alert.messageText = "Invalid Source Tree"
                alert.informativeText = "The selected directory is not a tugtool repo.\nExpected to find:\n  \(markers)"
                alert.alertStyle = .warning
                alert.runModal()
                return
            }

            sourceTreePath = url.path
            savePreferences()
            updateDevInfoOverlay()
        }
    }

    private func updateMakerMenuVisibility() {
        makerMenu.isHidden = !makerModeEnabled
    }

    /// Read the short git revision of the source tree. Returns nil when the
    /// path is missing, not a git repo, or git is unavailable on PATH.
    private func gitShortRev(at path: String) -> String? {
        return runGit(at: path, args: ["rev-parse", "--short", "HEAD"])
    }

    /// Read the current git branch of the source tree. Returns nil when the
    /// path is missing, not a git repo, detached HEAD, or git is unavailable.
    private func gitBranch(at path: String) -> String? {
        guard let value = runGit(at: path, args: ["rev-parse", "--abbrev-ref", "HEAD"]) else {
            return nil
        }
        return value == "HEAD" ? nil : value
    }

    private func runGit(at path: String, args: [String]) -> String? {
        guard let gitPath = ProcessManager.which("git") else { return nil }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: gitPath)
        proc.arguments = ["-C", path] + args
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = Pipe()
        do {
            try proc.run()
            proc.waitUntilExit()
            guard proc.terminationStatus == 0 else { return nil }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let value = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return value.isEmpty ? nil : value
        } catch {
            return nil
        }
    }

    /// Update the bottom-left dev-info overlay. Hidden when maker mode is off.
    private func updateDevInfoOverlay() {
        guard makerModeEnabled else {
            window.setDevInfo(text: "")
            return
        }
        let branch: String
        let rev: String
        if let path = sourceTreePath {
            branch = gitBranch(at: path) ?? "unknown"
            rev = gitShortRev(at: path) ?? "unknown"
        } else {
            branch = "unknown"
            rev = "unknown"
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        let buildStamp = formatter.string(from: appLaunchTime)
        let loadStamp = formatter.string(from: lastLoadTime)
        window.setDevInfo(text: "\(branch) · \(rev) · build \(buildStamp) · load \(loadStamp)")
    }

    /// Replace the cached menu state from the frontend (called by
    /// MainWindow on every `menuState` message).
    func updateMenuState(_ payload: [String: Any]) {
        let previousToken = menuState.edit.nativeUndoToken
        menuState = MenuState(payload: payload)

        // Native-control undo scoping: the web view's NSUndoManager is
        // per-web-view, so its contents must never outlive focus in one
        // native text control. The frontend changes `nativeUndoToken`
        // whenever the focused native control changes (and zeroes it on
        // blur); clearing here on every change confines the native undo
        // stack to the control the user is in right now.
        if menuState.edit.nativeUndoToken != previousToken {
            window.editingUndoManager()?.removeAllActions()
        }

        // Dynamic ⇧⌘S for Save As…: assign the chord ONLY while a
        // File card is frontmost; clear it otherwise so ⇧⌘S falls through
        // to the web view's Shell-route chord. Set here — outside AppKit's
        // key-equivalent scan — not in validateMenuItem.
        if let saveAs = fileSaveAsMenuItem {
            if menuState.file != nil {
                saveAs.keyEquivalent = "s"
                saveAs.keyEquivalentModifierMask = [.command, .shift]
            } else {
                saveAs.keyEquivalent = ""
                saveAs.keyEquivalentModifierMask = []
            }
        }
    }

    /// Card count of the focused pane (0 when nothing is focused). Drives
    /// Close-All-Cards and card-navigation enablement.
    private var focusedPaneCardCount: Int {
        menuState.focusedPane?.cardCount ?? 0
    }

    /// Whether the focused pane's active card is closable (false when
    /// nothing is focused). Drives Close-Card / Close-Pane enablement.
    private var focusedPaneActiveCardClosable: Bool {
        menuState.focusedPane?.closable ?? false
    }

    /// Whether the focused pane's active card is a dev card — the
    /// card-type gate for the dev-card command surfaces (Session items,
    /// Copy Last Response, Export Transcript, Help shortcuts).
    private var devCardFrontmost: Bool {
        menuState.activeCard?.component == "dev"
    }

    /// Auto-enable hook (`autoenablesItems` is on by default). Consulted
    /// for menu items whose nil-target action resolves to this delegate.
    /// All enablement is pull-based from the cached MenuState, keyed on
    /// the item's stable identifier (identity never rides the title).
    /// Tiers: deck state (close / new-in-pane / card navigation), edit
    /// capability (Cut / Copy / Paste / Delete / Select All / Undo / Redo
    /// and the Find items, from the focused responder's edit block — undo
    /// and redo carry the focused editor's history depth), card type
    /// (dev-card command surfaces), and session state (transcript facts
    /// from the dev block). Anything without a predicate here stays
    /// enabled.
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard let id = menuItem.identifier?.rawValue else { return true }

        // Session menu: every item needs a frontmost dev card (card-type
        // tier); below that, Focus Prompt works on any dev card, Stop
        // needs an interruptible turn, Rewind needs a bound session with
        // committed turns, and everything else needs a bound session.
        if id.hasPrefix("session.") {
            // Permission-mode radio checkmarks refresh here, during the
            // validation sweep — AppKit validates every item when its
            // menu opens (and the harness snapshot runs the same path),
            // so state-setting inside validateMenuItem is the single
            // mechanism; no menuNeedsUpdate rebuild is involved.
            if id.hasPrefix("session.permissionMode."),
               let mode = menuItem.representedObject as? String {
                menuItem.state = (mode == menuState.dev?.permissionMode) ? .on : .off
            }
            guard devCardFrontmost else { return false }
            switch id {
            case "session.focusPrompt":
                return true
            case "session.stop":
                return menuState.dev?.canInterrupt ?? false
            case "session.rewind":
                return (menuState.dev?.sessionBound ?? false) && (menuState.dev?.hasTurns ?? false)
            default:
                return menuState.dev?.sessionBound ?? false
            }
        }

        switch id {
        // File-card save verbs. Gated on the File menu block,
        // which rides the payload only while a File card is frontmost.
        // Automatic-mode Save must stay enabled whenever writable so its
        // ⌘S never validates disabled — a disabled matching chord beeps
        // and never reaches the web view.
        case "file.save":
            guard let file = menuState.file else { return false }
            return !file.readOnly && !file.conflict
                && (file.mode == "automatic" || file.dirty || file.untitled)
        case "file.saveAs", "file.saveACopy":
            return menuState.file != nil
        case "file.revertToSaved":
            guard let file = menuState.file else { return false }
            return file.dirty && file.hasPath
        case "file.reloadFromDisk":
            guard let file = menuState.file else { return false }
            return file.hasPath
        // Deck-state tier.
        case "file.closeCard":
            return focusedPaneActiveCardClosable
        case "file.closeAllCardTabs":
            return focusedPaneCardCount > 1
        case "maker.newCardInPane":
            return !menuState.panes.isEmpty
        // Card / pane navigation. Normally gated on having somewhere to go
        // (a multi-card pane, or ≥2 panes). The corner case: when the deck is
        // deselected (a click on the empty canvas — `selectionActive` false)
        // but a pane exists, all three stay active and re-activate a card, so
        // the user can recover focus by keyboard or menu. Once a card is
        // active again they fall back to the normal gate.
        case "window.previousCard", "window.nextCard":
            return focusedPaneCardCount > 1
                || (!menuState.selectionActive && !menuState.panes.isEmpty)
        case "window.cyclePanes":
            return menuState.panes.count >= 2
                || (!menuState.selectionActive && !menuState.panes.isEmpty)
        // Edit / Find tier — first-responder edit capabilities, mirrored
        // from the web responder chain (MenuState.edit). Disabled when no
        // focused surface handles the action; Find stays disabled until a
        // find-capable surface is focused (no surface implements it yet).
        //
        // Undo / Redo: titles AND enablement set here, during the
        // validation sweep (the sanctioned AppKit pattern, same as the
        // permission-mode checkmarks; identity never rides the title).
        // Two sources, discriminated by nativeUndoToken:
        //   - Native text control focused (token != 0): the web view's
        //     NSUndoManager is the live truth — canUndo/canRedo and its
        //     own localized menu titles ("Undo Typing"). The stack is
        //     cleared on every token change (updateMenuState), so what it
        //     reports is always scoped to the focused control.
        //   - Otherwise: the chain caps (focused editor's history depth)
        //     plus the editor-published noun ("Typing", "Paste", …).
        case "edit.undo":
            if menuState.edit.nativeUndoToken != 0,
               let um = window.editingUndoManager() {
                menuItem.title = um.canUndo ? um.undoMenuItemTitle : "Undo"
                return um.canUndo
            }
            menuItem.title = menuState.edit.undoLabel.isEmpty
                ? "Undo" : "Undo \(menuState.edit.undoLabel)"
            return menuState.edit.undo
        case "edit.redo":
            if menuState.edit.nativeUndoToken != 0,
               let um = window.editingUndoManager() {
                menuItem.title = um.canRedo ? um.redoMenuItemTitle : "Redo"
                return um.canRedo
            }
            menuItem.title = menuState.edit.redoLabel.isEmpty
                ? "Redo" : "Redo \(menuState.edit.redoLabel)"
            return menuState.edit.redo
        case "edit.cut":
            return menuState.edit.cut
        case "edit.copy":
            return menuState.edit.copy
        // Copy as Plain Text shares the copy gate — both need a selection.
        case "edit.copyAsPlainText":
            return menuState.edit.copy
        case "edit.paste":
            return menuState.edit.paste
        // Paste variants share the paste gate — both need an editable
        // surface and nothing else.
        case "edit.pasteAsQuote", "edit.pasteAsPlainText":
            return menuState.edit.paste
        case "edit.delete":
            return menuState.edit.delete
        case "edit.selectAll":
            return menuState.edit.selectAll
        case "edit.find":
            return menuState.edit.find
        case "edit.findNext":
            return menuState.edit.findNext
        case "edit.findPrevious":
            return menuState.edit.findPrevious
        // Card-type tier.
        case "file.exportTranscript", "help.shortcuts":
            return devCardFrontmost
        // Card-type + session-state tiers.
        case "edit.copyLastResponse":
            return devCardFrontmost && (menuState.dev?.hasAssistantMessage ?? false)
        default:
            return true
        }
    }

    // MARK: - UDS control commands

    private func sendControl(_ action: String, params: [String: Any] = [:]) {
        processManager.sendControl(action, params: params)
    }
}

// MARK: - BridgeDelegate

extension AppDelegate: BridgeDelegate {
    func bridgeChooseSourceTree(completion: @escaping (String?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Choose the tugtool mono-repo root directory"
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else {
                completion(nil)
                return
            }
            if !TugConfig.isValidSourceTree(url) {
                let markers = TugConfig.sourceTreeMarkers.joined(separator: "\n  ")
                let alert = NSAlert()
                alert.messageText = "Invalid Source Tree"
                alert.informativeText = "The selected directory is not a tugtool repo.\nExpected to find:\n  \(markers)"
                alert.alertStyle = .warning
                alert.runModal()
                completion(nil)
                return
            }
            self.sourceTreePath = url.path
            self.savePreferences()
            self.updateDevInfoOverlay()
            // Re-send dev_mode if serving is already enabled (per D12)
            if self.devServingEnabled {
                self.processManager.sendDevMode(enabled: true, sourceTree: url.path, vitePort: self.vitePort)
            }
            completion(url.path)
        }
    }

    func bridgeChoosePath(kind: String, initialPath: String?, completion: @escaping (String?) -> Void) {
        // `save` kind: an NSSavePanel choosing a NEW file path (the File
        // card's Move To… / Save As…). The panel returns the path only —
        // the web layer performs the write through its own fs surface.
        if kind == "save" {
            let panel = NSSavePanel()
            panel.message = "Choose where to save the file"
            panel.prompt = "Save"
            if let initialPath = initialPath, !initialPath.isEmpty {
                let resolved = (initialPath as NSString).expandingTildeInPath
                var isDir: ObjCBool = false
                if FileManager.default.fileExists(atPath: resolved, isDirectory: &isDir), isDir.boolValue {
                    panel.directoryURL = URL(fileURLWithPath: resolved)
                } else {
                    panel.nameFieldStringValue = (resolved as NSString).lastPathComponent
                    panel.directoryURL = URL(fileURLWithPath: resolved).deletingLastPathComponent()
                }
            } else if let sourceTree = ProcessManager.readTugbank(
                domain: TugConfig.domain, key: TugConfig.keySourceTreePath
            ), !sourceTree.isEmpty {
                // No hint (an untitled buffer): default to the project root,
                // not the OS default (Desktop).
                panel.directoryURL = URL(fileURLWithPath: sourceTree)
            }
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let url = panel.url else {
                    completion(nil)
                    return
                }
                completion(url.path)
            }
            return
        }
        let wantFile = kind == "file"
        let panel = NSOpenPanel()
        panel.canChooseFiles = wantFile
        // Directories are always navigable; in directory mode they're also the
        // selectable result. In file mode the user descends dirs to pick a file.
        panel.canChooseDirectories = !wantFile
        panel.allowsMultipleSelection = false
        panel.message = wantFile ? "Choose a file" : "Choose a directory"
        panel.prompt = "Choose"
        if let initialPath = initialPath, !initialPath.isEmpty {
            var isDir: ObjCBool = false
            let resolved = (initialPath as NSString).expandingTildeInPath
            if FileManager.default.fileExists(atPath: resolved, isDirectory: &isDir), isDir.boolValue {
                panel.directoryURL = URL(fileURLWithPath: resolved)
            }
        }
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else {
                completion(nil)
                return
            }
            completion(url.path)
        }
    }

    func bridgeSetMakerMode(enabled: Bool, completion: @escaping (Bool) -> Void) {
        self.makerModeEnabled = enabled
        self.updateMakerMenuVisibility()
        self.updateDevInfoOverlay()
        self.savePreferences()

        // If enabling without source tree, show error and bail out
        if enabled, sourceTreePath == nil {
            let alert = NSAlert()
            alert.messageText = "Source Tree Required"
            alert.informativeText = "Maker mode requires a source tree.\nGo to Maker > Source Tree... to set one."
            alert.alertStyle = .warning
            alert.runModal()
            completion(enabled)
            return
        }

        // The serving flip below (Vite spawn/teardown + page reload) is
        // pinned to production under the app-test harness; the preference
        // and menu visibility still flipped above, which is what
        // harness-driven Maker-gate tests exercise.
        guard !isAppTestHarness else {
            completion(enabled)
            return
        }

        // Kill any running Vite process synchronously on a background thread before branching.
        // waitUntilExit() blocks, so this must not run on the main thread.
        // This runs regardless of the new mode so a stale Vite is always cleaned up first.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            // Step 1: kill existing Vite (blocks until exit)
            self.processManager.killViteServer()

            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }

                let currentPort = self.processManager.currentTugcastPort

                if enabled {
                    // Dev mode ON: spawn Vite (HMR), wait for it, then load from the Vite port.
                    guard let path = self.sourceTreePath else {
                        self.processManager.sendDevMode(enabled: true, sourceTree: nil, vitePort: self.vitePort)
                        completion(enabled)
                        return
                    }

                    self.processManager.spawnViteServer(
                        sourceTree: path,
                        tugcastPort: currentPort,
                        vitePort: self.vitePort,
                        devMode: true
                    )

                    self.processManager.waitForViteReady(port: self.vitePort) { [weak self] ready in
                        guard let self = self else { return }
                        if !ready {
                            NSLog("AppDelegate: vite server did not become ready after dev mode toggle")
                        }
                        // Auth is already established; load the root from the Vite port.
                        self.window.loadURL("http://127.0.0.1:\(self.vitePort)/")
                        // Notify tugcast to activate file watchers and add Vite port to allowlist.
                        self.processManager.sendDevMode(enabled: true, sourceTree: path, vitePort: self.vitePort)
                        completion(enabled)
                    }
                } else {
                    // Production mode OFF: load directly from tugcast. No Vite process is running.
                    // tugcast serves pre-built dist/ files via ServeDir on port 55255.
                    self.window.loadURL("http://127.0.0.1:\(currentPort)/")
                    // Notify tugcast to deactivate file watchers and clear dev_port from allowlist.
                    self.processManager.sendDevMode(enabled: false, sourceTree: self.sourceTreePath, vitePort: self.vitePort)
                    completion(enabled)
                }
            }
        }
    }

    func bridgeGetSettings(completion: @escaping (Bool, String?) -> Void) {
        completion(makerModeEnabled, sourceTreePath)
    }

    func bridgeFrontendReady() {
        DispatchQueue.main.async {
            self.aboutMenuItem?.isEnabled = true
            self.settingsMenuItem?.isEnabled = true

            // First frontendReady is the initial mount — no replay
            // needed (the OS hasn't told tugdeck anything that needs
            // re-asserting yet) and the WebView is already painted by
            // `revealWebView` upstream.
            if !self.frontendHasLoadedOnce {
                self.frontendHasLoadedOnce = true
                return
            }

            // Subsequent frontendReady fires are post-reconnect
            // resyncs: tugcast went away, came back, tugdeck's
            // WebSocket re-handshook, and `signalReady()` fired
            // again. By this moment the WebSocket is open and
            // tugdeck is subscribed to CONTROL — so control frames
            // sent here actually reach the renderer (unlike
            // frames sent from `processManager.onReady`, which
            // would be dispatched into a tugcast broadcast with
            // no live subscribers and silently dropped).
            //
            // Replay the current OS-level app-lifecycle state.
            // Lifecycle frames sent during the outage hit the
            // cleared `controlConnection` early-return and were
            // dropped, so the tugdeck-side `AppLifecycle`
            // singleton holds whatever it last saw before the
            // close — possibly out of sync with the OS.
            // Replay re-asserts current truth.
            self.replayLifecycleState()
        }
    }

    func bridgeDevModeError(message: String) {
        window.bridgeDevModeError(message: message)
    }

    func bridgeSetTheme(color: String) {
        ProcessManager.writeTugbank(domain: TugConfig.domain, key: TugConfig.keyWindowBackground, value: color)
        window.updateBackgroundColor(color)
    }

    func bridgeDevBadge(backend: Bool, app: Bool) {
        // Restart Server and Relaunch App items removed; badge logic is a no-op.
        _ = backend
        _ = app
    }

    func bridgeIsMakerMode() -> Bool {
        return makerModeEnabled
    }

    func bridgePageDidLoad() {
        lastLoadTime = Date()
        updateDevInfoOverlay()
    }

    func bridgeHmrUpdate() {
        lastLoadTime = Date()
        updateDevInfoOverlay()
    }
}

// MARK: - NSMenuDelegate (dynamic View + Theme menus)

extension AppDelegate: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        if menu === viewMenu {
            rebuildViewMenu(menu)
            return
        }
        if menu === windowMenu {
            rebuildWindowPaneList(menu)
            return
        }
        guard menu === themeMenu else { return }
        menu.removeAllItems()

        // Read the active theme from tugbank on every menu open. tugbank
        // is the single source of truth, and the web layer changes the
        // theme on its own (keyboard Next Theme, etc.) without routing
        // through `selectTheme` — so a cached value would leave the
        // checkmark stale. Re-reading keeps it correct regardless of how
        // the theme was last changed.
        activeThemeName =
            ProcessManager.readTugbank(domain: TugConfig.domain, key: "theme")
            ?? baseThemeName

        // Read theme names directly from shipped CSS files on disk, plus each
        // theme's mode from its header comment. sourceTreePath is the tugtool
        // repo root; themes are at tugdeck/styles/themes/*.css, base is "brio".
        // The header's first line carries "— dark theme" / "— light theme",
        // so the menu can group them without a separate manifest.
        var themeNames = Set<String>([baseThemeName])
        var darkThemes = Set<String>()
        if let root = sourceTreePath {
            let themesDir = (root as NSString).appendingPathComponent("tugdeck/styles/themes")
            if let files = try? FileManager.default.contentsOfDirectory(atPath: themesDir) {
                for file in files where file.hasSuffix(".css") {
                    let name = (file as NSString).deletingPathExtension
                    themeNames.insert(name)
                    let path = (themesDir as NSString).appendingPathComponent(file)
                    // Light themes are the exception; default to dark when the
                    // header is unreadable or unmarked.
                    let header = (try? String(contentsOfFile: path, encoding: .utf8))?.prefix(200) ?? ""
                    if !header.localizedCaseInsensitiveContains("light theme") {
                        darkThemes.insert(name)
                    }
                }
            }
        }

        // Group: dark themes first, then light themes. Within each group the
        // base theme sorts first, then alphabetical.
        func sortGroup(_ names: [String]) -> [String] {
            names.sorted { a, b in
                if a.lowercased() == baseThemeName { return true }
                if b.lowercased() == baseThemeName { return false }
                return a.localizedCaseInsensitiveCompare(b) == .orderedAscending
            }
        }
        let dark = sortGroup(themeNames.filter { darkThemes.contains($0) })
        let light = sortGroup(themeNames.filter { !darkThemes.contains($0) })

        func addThemeItem(_ name: String) {
            let item = NSMenuItem(title: name.capitalized, action: #selector(selectTheme(_:)), keyEquivalent: "").identified("view.theme.\(name)")
            item.representedObject = name
            item.state = (name == activeThemeName) ? .on : .off
            menu.addItem(item)
        }
        for name in dark { addThemeItem(name) }
        if !dark.isEmpty && !light.isEmpty {
            menu.addItem(NSMenuItem.separator())
        }
        for name in light { addThemeItem(name) }

        // If no themes found, show a placeholder
        if menu.items.isEmpty {
            let placeholder = NSMenuItem(title: "No themes found", action: nil, keyEquivalent: "")
            placeholder.isEnabled = false
            menu.addItem(placeholder)
        }

        // Separator + Next Theme
        menu.addItem(NSMenuItem.separator())
        let nextItem = NSMenuItem(title: "Next Theme", action: #selector(nextTheme(_:)), keyEquivalent: "t", modifierMask: [.command, .option]).identified("view.nextTheme")
        menu.addItem(nextItem)
    }

    /// Rebuild the View menu: the theme submenu and page-zoom commands.
    /// Zoom enablement is computed here at build time (the pull-validation
    /// exception) because it reads live `webView.pageZoom`, not MenuState.
    private func rebuildViewMenu(_ menu: NSMenu) {
        menu.removeAllItems()

        // Theme submenu — the persistent themeMenu NSMenu (its own
        // NSMenuDelegate repopulates it on open), wrapped in a fresh
        // parent item per rebuild.
        let themeMenuItem = NSMenuItem(title: "Theme", action: nil, keyEquivalent: "").identified("view.theme")
        themeMenuItem.submenu = themeMenu
        menu.addItem(themeMenuItem)

        // Zoom commands — Safari-style. Drive `webView.pageZoom` so the
        // entire page scales uniformly. `Actual Size` (⌘0) returns to
        // 100%; `Zoom In` (⌘+) / `Zoom Out` (⌘-) step in 10%
        // increments bounded at 50%–200%. The hidden ⌘= alias mirrors
        // Safari's ergonomic shortcut so users don't have to hold
        // Shift to zoom in.
        menu.addItem(NSMenuItem.separator())
        let zoom = window.currentPageZoom
        // Floating-point tolerance — stepping by 0.1 accumulates IEEE
        // rounding error (0.6000000000000001 etc.), so menu-enablement
        // comparisons use a small epsilon to avoid spurious disables
        // right at the bounds.
        let epsilon: CGFloat = 0.005
        let actualSizeItem = NSMenuItem(title: "Actual Size", action: #selector(actualSize(_:)), keyEquivalent: "0").identified("view.actualSize")
        actualSizeItem.isEnabled = abs(zoom - MainWindow.defaultPageZoom) > epsilon
        menu.addItem(actualSizeItem)
        let zoomInItem = NSMenuItem(title: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "+").identified("view.zoomIn")
        zoomInItem.isEnabled = zoom < MainWindow.maxPageZoom - epsilon
        menu.addItem(zoomInItem)
        // ⌘= alias for Zoom In — visible item displays ⌘+, this hidden
        // sibling accepts ⌘= (no-shift) for ergonomic parity with
        // Safari. `allowsKeyEquivalentWhenHidden` keeps the shortcut
        // live even though the item is suppressed from the visible
        // menu. Both fire the same action.
        let zoomInAliasItem = NSMenuItem(title: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "=").identified("view.zoomInAlias")
        zoomInAliasItem.isEnabled = zoomInItem.isEnabled
        zoomInAliasItem.isHidden = true
        zoomInAliasItem.allowsKeyEquivalentWhenHidden = true
        menu.addItem(zoomInAliasItem)
        let zoomOutItem = NSMenuItem(title: "Zoom Out", action: #selector(zoomOut(_:)), keyEquivalent: "-").identified("view.zoomOut")
        zoomOutItem.isEnabled = zoom > MainWindow.minPageZoom + epsilon
        menu.addItem(zoomOutItem)
    }

    /// Refresh the Window menu's dynamic pane-list slice in place: remove
    /// exactly the `window.pane.*` items, then re-insert the current panes
    /// (checkmark on the focused one) directly after the anchor separator.
    /// Sectioned management — never a wholesale rebuild — because this menu
    /// is NSApp.windowsMenu and AppKit owns auto-added window entries in it.
    private func rebuildWindowPaneList(_ menu: NSMenu) {
        for item in menu.items where item.identifier?.rawValue.hasPrefix("window.pane.") == true {
            menu.removeItem(item)
        }
        guard let anchor = windowPaneListAnchor, !menuState.panes.isEmpty else { return }
        var index = menu.index(of: anchor) + 1
        for (n, pane) in menuState.panes.enumerated() {
            // Positional identifiers: the harness addresses slots, not pane
            // ids (which are session-random).
            let item = NSMenuItem(title: pane.title, action: #selector(focusPaneFromMenu(_:)), keyEquivalent: "").identified("window.pane.\(n)")
            item.representedObject = pane.id
            item.state = pane.focused ? .on : .off
            menu.insertItem(item, at: index)
            index += 1
        }
    }
}

// Helper extension for menu items with modifier masks
extension NSMenuItem {
    convenience init(title: String, action: Selector?, keyEquivalent: String, modifierMask: NSEvent.ModifierFlags) {
        self.init(title: title, action: action, keyEquivalent: keyEquivalent)
        self.keyEquivalentModifierMask = modifierMask
    }

    /// Tag the item with its stable, namespaced introspection identifier.
    /// The test harness (`menuSnapshot` / `menuItemState`) addresses items
    /// by identifier, and `validateMenuItem(_:)` switches on it — identity
    /// never rides the (flippable, localizable) title. Returns self so
    /// build sites can tag inline.
    @discardableResult
    func identified(_ id: String) -> NSMenuItem {
        identifier = NSUserInterfaceItemIdentifier(id)
        return self
    }
}

// MARK: - MenuState

/// Menu-relevant frontend state, pushed by tugdeck's host-menu-state
/// aggregator on every menu-relevant change. Wire contract with
/// `tugdeck/src/lib/host-menu-state.ts` — keep both sides in sync.
///
/// Decoding is defensive throughout: a missing or mistyped field reads
/// as its inert value (empty list, nil block, false flag), so menu
/// validation degrades to "disabled" rather than crashing on a
/// malformed payload. Before the first push arrives (app boot,
/// pre-frontendReady) the cache is `.empty` and every state-gated item
/// validates disabled — the correct cold-start posture.
struct MenuState {
    /// One pane entry, z-order topmost first.
    struct Pane {
        let id: String
        let title: String
        let focused: Bool
        let cardCount: Int
        let closable: Bool
    }

    /// The focused pane's active card; nil when the deck has no panes.
    struct ActiveCard {
        let component: String
        let closable: Bool
    }

    /// Dev-card session state; nil unless the active card is a dev card.
    struct Dev {
        let cardId: String
        let sessionBound: Bool
        let canInterrupt: Bool
        let permissionMode: String
        let hasAssistantMessage: Bool
        let hasTurns: Bool
    }

    /// File-card state; nil unless the active card is a File card. Gates
    /// the classic File menu (Save / Save As… / Save a Copy… / Revert /
    /// Reload) and drives the dynamic ⇧⌘S assignment.
    struct File {
        let cardId: String
        /// "manual" | "automatic" — automatic Save is always live.
        let mode: String
        let dirty: Bool
        let untitled: Bool
        let readOnly: Bool
        let hasPath: Bool
        let conflict: Bool
    }

    /// Edit-menu capabilities of the current first responder, projected
    /// from the web responder chain's `validateAction` (the suite's
    /// single source of truth for whether the focused surface handles an
    /// edit action). Each flag gates one Edit-menu item; all false when
    /// nothing focused handles edits (e.g. only the Settings card up).
    ///
    /// Undo / Redo ride this block — NOT AppKit's automatic NSUndoManager
    /// validation — because the web view's undoManager is per-web-view: it
    /// accumulates the whole view's edit history and knows nothing about
    /// card activation, so a deactivated card's undo state would keep
    /// showing in the menu. The chain is card-scoped by construction;
    /// editors report their own history depth through `validateAction`,
    /// plus a menu-title noun (`undoLabel` / `redoLabel` → "Undo Typing").
    ///
    /// Native text controls take a third path: when `nativeUndoToken` is
    /// non-zero (a browser-native input/textarea is focused) the delegate
    /// validates Undo/Redo LIVE from the web view's NSUndoManager and
    /// executes the native selectors. The token changes per focused
    /// control; the delegate clears the stack on every change
    /// (`updateMenuState`), which is what keeps the per-web-view native
    /// stack card-safe.
    struct Edit {
        let cut: Bool
        let copy: Bool
        let paste: Bool
        let delete: Bool
        let selectAll: Bool
        let undo: Bool
        let redo: Bool
        let undoLabel: String
        let redoLabel: String
        let nativeUndoToken: Int
        let find: Bool
        let findNext: Bool
        let findPrevious: Bool

        /// Nothing focused handles any edit action.
        static let disabled = Edit(
            cut: false, copy: false, paste: false, delete: false,
            selectAll: false, undo: false, redo: false,
            undoLabel: "", redoLabel: "", nativeUndoToken: 0,
            find: false, findNext: false, findPrevious: false
        )
    }

    var panes: [Pane] = []
    var activeCard: ActiveCard?
    var dev: Dev?
    var file: File?
    var edit: Edit = .disabled
    /// Whether a card is selected. `false` when the deck is deselected (a
    /// click on the empty canvas cleared the active card) — the card / pane
    /// navigation commands stay active in that state so the user can
    /// re-activate a card.
    var selectionActive: Bool = false

    static let empty = MenuState()

    /// The focused pane's entry (nil when nothing is focused).
    var focusedPane: Pane? {
        panes.first { $0.focused }
    }

    init() {}

    init(payload: [String: Any]) {
        selectionActive = payload["selectionActive"] as? Bool ?? false
        if let rawPanes = payload["panes"] as? [[String: Any]] {
            panes = rawPanes.compactMap { entry in
                guard let id = entry["id"] as? String else { return nil }
                return Pane(
                    id: id,
                    title: entry["title"] as? String ?? "Untitled",
                    focused: entry["focused"] as? Bool ?? false,
                    cardCount: entry["cardCount"] as? Int ?? 0,
                    closable: entry["closable"] as? Bool ?? false
                )
            }
        }
        if let rawActive = payload["activeCard"] as? [String: Any],
           let component = rawActive["component"] as? String {
            activeCard = ActiveCard(
                component: component,
                closable: rawActive["closable"] as? Bool ?? false
            )
        }
        if let rawDev = payload["dev"] as? [String: Any],
           let cardId = rawDev["cardId"] as? String {
            dev = Dev(
                cardId: cardId,
                sessionBound: rawDev["sessionBound"] as? Bool ?? false,
                canInterrupt: rawDev["canInterrupt"] as? Bool ?? false,
                permissionMode: rawDev["permissionMode"] as? String ?? "default",
                hasAssistantMessage: rawDev["hasAssistantMessage"] as? Bool ?? false,
                hasTurns: rawDev["hasTurns"] as? Bool ?? false
            )
        }
        if let rawFile = payload["file"] as? [String: Any],
           let cardId = rawFile["cardId"] as? String {
            file = File(
                cardId: cardId,
                mode: rawFile["mode"] as? String ?? "automatic",
                dirty: rawFile["dirty"] as? Bool ?? false,
                untitled: rawFile["untitled"] as? Bool ?? false,
                readOnly: rawFile["readOnly"] as? Bool ?? false,
                hasPath: rawFile["hasPath"] as? Bool ?? false,
                conflict: rawFile["conflict"] as? Bool ?? false
            )
        }
        if let rawEdit = payload["edit"] as? [String: Any] {
            edit = Edit(
                cut: rawEdit["cut"] as? Bool ?? false,
                copy: rawEdit["copy"] as? Bool ?? false,
                paste: rawEdit["paste"] as? Bool ?? false,
                delete: rawEdit["delete"] as? Bool ?? false,
                selectAll: rawEdit["selectAll"] as? Bool ?? false,
                undo: rawEdit["undo"] as? Bool ?? false,
                redo: rawEdit["redo"] as? Bool ?? false,
                undoLabel: rawEdit["undoLabel"] as? String ?? "",
                redoLabel: rawEdit["redoLabel"] as? String ?? "",
                nativeUndoToken: rawEdit["nativeUndoToken"] as? Int ?? 0,
                find: rawEdit["find"] as? Bool ?? false,
                findNext: rawEdit["findNext"] as? Bool ?? false,
                findPrevious: rawEdit["findPrevious"] as? Bool ?? false
            )
        }
    }
}
