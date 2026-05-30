import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: MainWindow!
    private var processManager = ProcessManager()
    private var devModeEnabled = false
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
    private var developerMenu: NSMenuItem!
    private var aboutMenuItem: NSMenuItem?
    private var settingsMenuItem: NSMenuItem?

    #if DEBUG
    /// In-app test harness bridge, active only when
    /// `TUGAPP_TEST_SOCKET` env var is set. DEBUG-only.
    private var testHarnessBridge: TestHarnessBridge?
    #endif

    // File menu state
    private var closeMenuItem: NSMenuItem!

    // View menu state
    private var viewMenu: NSMenu!
    private var cachedCardList: [[String: Any]] = []

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

            guard let path = self.sourceTreePath else {
                // No source tree -- sendDevMode needs the source tree; show error alert
                let alert = NSAlert()
                alert.messageText = "Source Tree Required"
                alert.informativeText = "Tug requires a source tree to serve the frontend.\nGo to Developer > Source Tree... to set one."
                alert.alertStyle = .warning
                alert.runModal()
                return
            }

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
                self.processManager.sendDevMode(
                    enabled: self.devModeEnabled,
                    sourceTree: path,
                    vitePort: self.vitePort
                )
                return
            }
            self.initialLoadComplete = true

            if self.devModeEnabled {
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
                self.processManager.sendDevMode(enabled: false, sourceTree: path, vitePort: self.vitePort)
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
                self.processManager.stop()
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
        // `dev-mode-enabled` and `source-tree-path` fall back to
        // build-time values so a fresh dev instance lights up with
        // the Developer menu visible and its source tree wired, and
        // a fresh prod instance defaults to non-dev with the user-
        // picker flow available.
        //
        // `readTugbank` returns Optional<String>, so we can tell the
        // difference between "key absent" (use the build-profile
        // default) and "key explicitly false" (honor the user's
        // preference).
        let devModeRaw = ProcessManager.readTugbank(
            domain: TugConfig.domain, key: TugConfig.keyDevModeEnabled
        )
        if let raw = devModeRaw {
            devModeEnabled = raw.caseInsensitiveCompare("true") == .orderedSame
        } else {
            // No explicit preference yet — default from the build
            // profile baked into Info.plist by Step 1's
            // capture-build-info.sh. Debug bundles ship with dev
            // mode ON; release bundles ship with it OFF.
            devModeEnabled = BuildInfo.profile == "debug"
        }

        sourceTreePath = ProcessManager.readTugbank(
            domain: TugConfig.domain, key: TugConfig.keySourceTreePath
        )
        if sourceTreePath == nil, let buildTimePath = BuildInfo.sourceTree {
            sourceTreePath = buildTimePath
        }

        // In-app harness path: force production mode regardless of the
        // tugbank setting. The harness loads from tugcast's pre-built
        // `dist/` (served via ServeDir) instead of spawning Vite — saves
        // ~700ms on cold launch by skipping the Vite subprocess + the
        // first-request TS-on-demand transform. Test-only; manual
        // launches still honor whatever the user has set in tugbank.
        if ProcessInfo.processInfo.environment["TUGAPP_APP_TEST"] == "1" {
            devModeEnabled = false
        }
    }

    private func savePreferences() {
        ProcessManager.writeTugbank(domain: TugConfig.domain, key: TugConfig.keyDevModeEnabled, value: devModeEnabled ? "true" : "false")
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

    private func buildMenuBar() {
        let mainMenu = NSMenu()

        // Tug (App) Menu - position 0
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        let aboutItem = NSMenuItem(title: "About Tug", action: #selector(showAbout(_:)), keyEquivalent: "")
        aboutItem.isEnabled = false
        self.aboutMenuItem = aboutItem
        appMenu.addItem(aboutItem)
        appMenu.addItem(NSMenuItem.separator())
        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(showSettings(_:)), keyEquivalent: ",")
        settingsItem.isEnabled = false
        self.settingsMenuItem = settingsItem
        appMenu.addItem(settingsItem)
        appMenu.addItem(NSMenuItem.separator())

        // Theme submenu — populated dynamically via NSMenuDelegate
        let themeMenuItem = NSMenuItem(title: "Theme", action: nil, keyEquivalent: "")
        let dynamicThemeMenu = NSMenu(title: "Theme")
        dynamicThemeMenu.delegate = self
        themeMenuItem.submenu = dynamicThemeMenu
        self.themeMenu = dynamicThemeMenu
        appMenu.addItem(themeMenuItem)
        appMenu.addItem(NSMenuItem.separator())

        // Services submenu
        let servicesMenuItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu(title: "Services")
        servicesMenuItem.submenu = servicesMenu
        appMenu.addItem(servicesMenuItem)
        NSApp.servicesMenu = servicesMenu

        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Hide Tug", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h", modifierMask: [.command, .option]))
        appMenu.addItem(NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Tug", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        // File Menu - position 1
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu

        // New submenu (per roadmap/tide-to-dev-rename.md [D03] [D04]).
        // Two items always available; two more on debug builds only,
        // gated at compile time on BuildInfo.profile so release
        // bundles literally never expose the gallery + hello-world
        // creation surfaces.
        let newMenuItem = NSMenuItem(title: "New", action: nil, keyEquivalent: "")
        let newMenu = NSMenu(title: "New")
        newMenuItem.submenu = newMenu
        fileMenu.addItem(newMenuItem)
        newMenu.addItem(NSMenuItem(title: "New Dev Card", action: #selector(newDevCard(_:)), keyEquivalent: "n"))
        newMenu.addItem(NSMenuItem(title: "New Git Card", action: #selector(newGitCard(_:)), keyEquivalent: ""))
        if BuildInfo.profile == "debug" {
            newMenu.addItem(NSMenuItem.separator())
            newMenu.addItem(NSMenuItem(title: "New Component Gallery Card", action: #selector(newComponentGalleryCard(_:)), keyEquivalent: "n", modifierMask: [.command, .option]))
            newMenu.addItem(NSMenuItem(title: "New Hello World Card", action: #selector(newHelloWorldCard(_:)), keyEquivalent: "n", modifierMask: [.command, .option, .shift]))
        }

        fileMenu.addItem(NSMenuItem.separator())

        // Close Card / Close Pane: routes through the web view's responder
        // chain rather than NSWindow.performClose. The custom selector sends a
        // Control frame that action-dispatch.ts turns into a `close` chain
        // dispatch, which lands on TugPane's registered handler. Without the
        // round-trip, AppKit would swallow ⌘W at the menubar and the WKWebView
        // would never see the keystroke.
        //
        // Title is dynamic (updated by updateCardList on every frontend push):
        //   multi-card pane  → "Close Card" (closes the active card)
        //   single-card pane → "Close Pane" (removes the last card / pane)
        // matching the macOS Safari / Finder convention. The initial title
        // is "Close Pane" — before the first card list arrives, any pending
        // ⌘W best describes the default single-card pane state.
        closeMenuItem = NSMenuItem(title: "Close Pane", action: #selector(closeActiveCard(_:)), keyEquivalent: "w")
        fileMenu.addItem(closeMenuItem)

        // Edit Menu - position 2
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z", modifierMask: [.command, .shift]))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Delete", action: #selector(NSText.delete(_:)), keyEquivalent: ""))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenu.addItem(NSMenuItem.separator())

        // Find submenu
        let findMenuItem = NSMenuItem(title: "Find", action: nil, keyEquivalent: "")
        let findMenu = NSMenu(title: "Find")
        findMenuItem.submenu = findMenu
        let findItem = NSMenuItem(title: "Find...", action: #selector(NSTextView.performFindPanelAction(_:)), keyEquivalent: "f")
        findItem.tag = 1
        findMenu.addItem(findItem)
        let findNextItem = NSMenuItem(title: "Find Next", action: #selector(NSTextView.performFindPanelAction(_:)), keyEquivalent: "g")
        findNextItem.tag = 2
        findMenu.addItem(findNextItem)
        let findPreviousItem = NSMenuItem(title: "Find Previous", action: #selector(NSTextView.performFindPanelAction(_:)), keyEquivalent: "g", modifierMask: [.command, .shift])
        findPreviousItem.tag = 3
        findMenu.addItem(findPreviousItem)
        let useSelectionItem = NSMenuItem(title: "Use Selection for Find", action: #selector(NSTextView.performFindPanelAction(_:)), keyEquivalent: "e")
        useSelectionItem.tag = 7
        findMenu.addItem(useSelectionItem)
        editMenu.addItem(findMenuItem)

        // View Menu - position 3
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let vMenu = NSMenu(title: "View")
        vMenu.delegate = self
        viewMenuItem.submenu = vMenu
        self.viewMenu = vMenu
        vMenu.addItem(NSMenuItem(title: "Cascade", action: #selector(cascadeCards(_:)), keyEquivalent: "c", modifierMask: [.control, .option]))
        vMenu.addItem(NSMenuItem(title: "Tile", action: #selector(tileCards(_:)), keyEquivalent: "t", modifierMask: [.control, .option]))
        // Card list and dev-mode items are populated dynamically in menuNeedsUpdate.

        // Developer Menu - position 4
        developerMenu = NSMenuItem()
        mainMenu.addItem(developerMenu)
        let devMenu = NSMenu(title: "Developer")
        developerMenu.submenu = devMenu
        let reloadItem = NSMenuItem(title: "Reload", action: #selector(reload(_:)), keyEquivalent: "r")
        reloadItem.target = self
        devMenu.addItem(reloadItem)
        devMenu.addItem(NSMenuItem.separator())
        devMenu.addItem(NSMenuItem(title: "Show JavaScript Console", action: #selector(showJavaScriptConsole(_:)), keyEquivalent: "c", modifierMask: [.command, .option]))
        devMenu.addItem(NSMenuItem(title: "Show Dev Panel", action: #selector(showDevPanel(_:)), keyEquivalent: "/", modifierMask: [.command, .option]))
        devMenu.addItem(NSMenuItem(title: "Add Card to Active Pane", action: #selector(addCardToActivePane(_:)), keyEquivalent: ""))
        devMenu.addItem(NSMenuItem.separator())
        devMenu.addItem(NSMenuItem(title: "Source Tree...", action: #selector(sourceTree(_:)), keyEquivalent: ""))
        developerMenu.isHidden = !devModeEnabled

        // Window Menu - position 4
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""))
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f", modifierMask: [.command, .control]))
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(NSMenuItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: ""))
        NSApp.windowsMenu = windowMenu

        // Help Menu - position 5
        let helpMenuItem = NSMenuItem()
        mainMenu.addItem(helpMenuItem)
        let helpMenu = NSMenu(title: "Help")
        helpMenuItem.submenu = helpMenu
        helpMenu.addItem(NSMenuItem(title: "Project Home", action: #selector(openProjectHome(_:)), keyEquivalent: ""))
        helpMenu.addItem(NSMenuItem(title: "GitHub", action: #selector(openGitHub(_:)), keyEquivalent: ""))
        NSApp.helpMenu = helpMenu

        NSApp.mainMenu = mainMenu
    }

    // MARK: - Actions

    @objc func showSettings(_ sender: Any?) {
        sendControl("show-card", params: ["component": "settings"])
    }

    @objc func showAbout(_ sender: Any?) {
        sendControl("show-card", params: ["component": "about"])
    }

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

    private func updateDeveloperMenuVisibility() {
        developerMenu.isHidden = !devModeEnabled
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

    /// Update the bottom-left dev-info overlay. Hidden when dev mode is off.
    private func updateDevInfoOverlay() {
        guard devModeEnabled else {
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

    /// Update the cached card list from the frontend (called by MainWindow on cardList message).
    func updateCardList(_ list: [[String: Any]]) {
        cachedCardList = list

        // File ▸ Close Card / Close Pane — dynamic label based on the
        // focused pane's card count. Multi-card: ⌘W closes the active card
        // (pane stays). Single-card: ⌘W closes the pane. Matches
        // macOS Safari / Finder behavior.
        let focusedPane = list.first { ($0["focused"] as? Bool) == true }
        let cardCount = focusedPane?["cardCount"] as? Int ?? 0
        closeMenuItem?.title = cardCount > 1 ? "Close Card" : "Close Pane"
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
            // Re-send dev_mode if already enabled (per D12)
            if self.devModeEnabled {
                self.processManager.sendDevMode(enabled: true, sourceTree: url.path, vitePort: self.vitePort)
            }
            completion(url.path)
        }
    }

    func bridgeChoosePath(kind: String, initialPath: String?, completion: @escaping (String?) -> Void) {
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

    func bridgeSetDevMode(enabled: Bool, completion: @escaping (Bool) -> Void) {
        self.devModeEnabled = enabled
        self.updateDeveloperMenuVisibility()
        self.updateDevInfoOverlay()
        self.savePreferences()

        // If enabling without source tree, show error and bail out
        if enabled, sourceTreePath == nil {
            let alert = NSAlert()
            alert.messageText = "Source Tree Required"
            alert.informativeText = "Dev mode requires a source tree.\nGo to Developer > Source Tree... to set one."
            alert.alertStyle = .warning
            alert.runModal()
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
        completion(devModeEnabled, sourceTreePath)
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

    func bridgeIsDevMode() -> Bool {
        return devModeEnabled
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
        guard menu === themeMenu else { return }
        menu.removeAllItems()

        // Read active theme from tugbank if not yet known.
        if activeThemeName == nil {
            activeThemeName =
                ProcessManager.readTugbank(domain: "dev.tugtool.app", key: "theme")
                ?? baseThemeName
        }

        // Read theme names directly from shipped CSS files on disk.
        // sourceTreePath is the tugtool repo root; override themes are at
        // tugdeck/styles/themes/*.css, and base theme is always "brio".
        var themeNames = Set<String>([baseThemeName])
        if let root = sourceTreePath {
            let themesDir = (root as NSString).appendingPathComponent("tugdeck/styles/themes")
            if let files = try? FileManager.default.contentsOfDirectory(atPath: themesDir) {
                let discovered = files
                    .filter { $0.hasSuffix(".css") }
                    .map { ($0 as NSString).deletingPathExtension }
                for name in discovered {
                    themeNames.insert(name)
                }
            }
        }

        // Sort: base theme first, then alphabetical
        let sortedThemeNames = themeNames.sorted { a, b in
            if a.lowercased() == baseThemeName { return true }
            if b.lowercased() == baseThemeName { return false }
            return a.localizedCaseInsensitiveCompare(b) == .orderedAscending
        }

        for name in sortedThemeNames {
            let item = NSMenuItem(title: name.capitalized, action: #selector(selectTheme(_:)), keyEquivalent: "")
            item.representedObject = name
            item.state = (name == activeThemeName) ? .on : .off
            menu.addItem(item)
        }

        // If no themes found, show a placeholder
        if menu.items.isEmpty {
            let placeholder = NSMenuItem(title: "No themes found", action: nil, keyEquivalent: "")
            placeholder.isEnabled = false
            menu.addItem(placeholder)
        }

        // Separator + Next Theme
        menu.addItem(NSMenuItem.separator())
        let nextItem = NSMenuItem(title: "Next Theme", action: #selector(nextTheme(_:)), keyEquivalent: "t", modifierMask: [.command, .option])
        menu.addItem(nextItem)
    }

    /// Rebuild the View menu with arrangement commands, zoom commands,
    /// card list, and dev-mode items.
    private func rebuildViewMenu(_ menu: NSMenu) {
        menu.removeAllItems()

        // Arrangement commands
        menu.addItem(NSMenuItem(title: "Cascade", action: #selector(cascadeCards(_:)), keyEquivalent: "c", modifierMask: [.control, .option]))
        menu.addItem(NSMenuItem(title: "Tile", action: #selector(tileCards(_:)), keyEquivalent: "t", modifierMask: [.control, .option]))

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
        let actualSizeItem = NSMenuItem(title: "Actual Size", action: #selector(actualSize(_:)), keyEquivalent: "0")
        actualSizeItem.isEnabled = abs(zoom - MainWindow.defaultPageZoom) > epsilon
        menu.addItem(actualSizeItem)
        let zoomInItem = NSMenuItem(title: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "+")
        zoomInItem.isEnabled = zoom < MainWindow.maxPageZoom - epsilon
        menu.addItem(zoomInItem)
        // ⌘= alias for Zoom In — visible item displays ⌘+, this hidden
        // sibling accepts ⌘= (no-shift) for ergonomic parity with
        // Safari. `allowsKeyEquivalentWhenHidden` keeps the shortcut
        // live even though the item is suppressed from the visible
        // menu. Both fire the same action.
        let zoomInAliasItem = NSMenuItem(title: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "=")
        zoomInAliasItem.isEnabled = zoomInItem.isEnabled
        zoomInAliasItem.isHidden = true
        zoomInAliasItem.allowsKeyEquivalentWhenHidden = true
        menu.addItem(zoomInAliasItem)
        let zoomOutItem = NSMenuItem(title: "Zoom Out", action: #selector(zoomOut(_:)), keyEquivalent: "-")
        zoomOutItem.isEnabled = zoom > MainWindow.minPageZoom + epsilon
        menu.addItem(zoomOutItem)

        // Card list section (from cached card list pushed by the frontend)
        if !cachedCardList.isEmpty {
            menu.addItem(NSMenuItem.separator())
            for entry in cachedCardList {
                guard let paneId = entry["id"] as? String,
                      let title = entry["title"] as? String else { continue }
                let focused = entry["focused"] as? Bool ?? false
                let item = NSMenuItem(title: title, action: #selector(focusPaneFromMenu(_:)), keyEquivalent: "")
                item.representedObject = paneId
                item.state = focused ? .on : .off
                menu.addItem(item)
            }
        }

    }
}

// Helper extension for menu items with modifier masks
extension NSMenuItem {
    convenience init(title: String, action: Selector?, keyEquivalent: String, modifierMask: NSEvent.ModifierFlags) {
        self.init(title: title, action: action, keyEquivalent: keyEquivalent)
        self.keyEquivalentModifierMask = modifierMask
    }
}
