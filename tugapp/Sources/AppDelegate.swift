import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: MainWindow!
    private var processManager = ProcessManager()
    private var devModeEnabled = false
    private var sourceTreePath: String?
    private var lastAuthURL: String?
    private var vitePort: Int = TugConfig.defaultVitePort
    private var developerMenu: NSMenuItem!
    private var sourceTreeMenuItem: NSMenuItem?
    private var aboutMenuItem: NSMenuItem?
    private var settingsMenuItem: NSMenuItem?
    private var restartMenuItem: NSMenuItem?
    private var relaunchMenuItem: NSMenuItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Check tmux availability
        if !ProcessManager.checkTmux() {
            let alert = NSAlert()
            alert.messageText = "tmux Required"
            alert.informativeText = "tmux is required but was not found in PATH.\nInstall it with: brew install tmux"
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        // Load preferences
        loadPreferences()

        // Create main window
        let contentRect = NSRect(x: 100, y: 100, width: 1200, height: 800)
        window = MainWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // Wire bridge delegate
        window.bridgeDelegate = self

        // Build menu bar
        buildMenuBar()

        // Setup process manager
        processManager.onReady = { [weak self] url, port in
            guard let self = self else { return }
            self.lastAuthURL = url

            guard let path = self.sourceTreePath else {
                // No source tree -- sendDevMode needs the source tree; show error alert
                let alert = NSAlert()
                alert.messageText = "Source Tree Required"
                alert.informativeText = "Tug requires a source tree to serve the frontend.\nGo to Developer > Choose Source Tree... to set one."
                alert.alertStyle = .warning
                alert.runModal()
                return
            }

            // Extract the auth token from the ready URL so both paths can construct their load URL.
            let token = url.components(separatedBy: "token=").dropFirst().first?.components(separatedBy: "&").first ?? ""

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
    }

    func applicationWillTerminate(_ notification: Notification) {
        window.cleanupBridge()
        processManager.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return false
    }

    // MARK: - Preferences

    private func loadPreferences() {
        devModeEnabled = UserDefaults.standard.bool(forKey: TugConfig.keyDevModeEnabled)
        sourceTreePath = UserDefaults.standard.string(forKey: TugConfig.keySourceTreePath)
    }

    private func savePreferences() {
        UserDefaults.standard.set(devModeEnabled, forKey: TugConfig.keyDevModeEnabled)
        if let path = sourceTreePath {
            UserDefaults.standard.set(path, forKey: TugConfig.keySourceTreePath)
        }
    }

    // MARK: - localStorage sync

    /// Called after every page load. Syncs `tugdeck-layout` and `td-theme` between
    /// the page's localStorage and UserDefaults so that settings survive origin switches
    /// (dev port 55155 vs. production port 55255).
    ///
    /// Strategy: localStorage wins when it has data (user interaction on this origin).
    /// UserDefaults wins when localStorage is empty (fresh origin that hasn't seen the
    /// keys yet). After reconciliation both stores hold the same values.
    private func syncLocalStorageOnPageLoad() {
        // Read both keys from localStorage in a single JS call. Returns a JSON object
        // with nullable string fields so we can distinguish missing vs. empty values.
        let readScript = """
            (function() {
                return JSON.stringify({
                    layout: localStorage.getItem('tugdeck-layout'),
                    theme: localStorage.getItem('td-theme')
                });
            })()
            """
        window.evaluateJavaScript(readScript) { [weak self] result, error in
            guard let self = self else { return }
            if let error = error {
                NSLog("AppDelegate: syncLocalStorageOnPageLoad read failed: %@", error.localizedDescription)
                return
            }
            guard let jsonStr = result as? String,
                  let data = jsonStr.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                return
            }

            let lsLayout = obj["layout"] as? String  // nil means key absent
            let lsTheme  = obj["theme"]  as? String

            let udLayout = UserDefaults.standard.string(forKey: TugConfig.keyTugdeckLayout)
            let udTheme  = UserDefaults.standard.string(forKey: TugConfig.keyTugdeckTheme)

            // Determine the winning value for each key:
            // localStorage value wins when present; fall back to UserDefaults otherwise.
            let finalLayout = lsLayout ?? udLayout
            let finalTheme  = lsTheme  ?? udTheme

            // Persist winners back to UserDefaults so the next origin load can read them.
            if let v = finalLayout { UserDefaults.standard.set(v, forKey: TugConfig.keyTugdeckLayout) }
            if let v = finalTheme  { UserDefaults.standard.set(v, forKey: TugConfig.keyTugdeckTheme) }

            // If either key was absent in localStorage but present in UserDefaults,
            // inject the saved value into this origin's localStorage now.
            let needsLayoutInject = lsLayout == nil && udLayout != nil
            let needsThemeInject  = lsTheme  == nil && udTheme  != nil

            guard needsLayoutInject || needsThemeInject else { return }

            // Build the injection script. We base64-encode the payload to avoid
            // quote and backslash issues with arbitrary settings content.
            var payload: [String: String] = [:]
            if needsLayoutInject, let v = udLayout { payload["layout"] = v }
            if needsThemeInject,  let v = udTheme  { payload["theme"]  = v }

            guard let payloadData = try? JSONSerialization.data(withJSONObject: payload) else { return }

            let b64 = payloadData.base64EncodedString()
            let writeScript = """
                (function() {
                    try {
                        var d = JSON.parse(atob('\(b64)'));
                        if (d.layout != null) localStorage.setItem('tugdeck-layout', d.layout);
                        if (d.theme  != null) localStorage.setItem('td-theme',       d.theme);
                    } catch(e) {
                        console.warn('Tug: localStorage sync inject failed:', e);
                    }
                })();
                """
            self.window.evaluateJavaScript(writeScript) { _, writeError in
                if let writeError = writeError {
                    NSLog("AppDelegate: syncLocalStorageOnPageLoad write failed: %@", writeError.localizedDescription)
                } else {
                    NSLog("AppDelegate: injected localStorage from UserDefaults (layout=%@, theme=%@)",
                          needsLayoutInject ? "yes" : "no",
                          needsThemeInject  ? "yes" : "no")
                }
            }
        }
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
        fileMenu.addItem(NSMenuItem(title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))

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

        // Developer Menu - position 3
        developerMenu = NSMenuItem()
        mainMenu.addItem(developerMenu)
        let devMenu = NSMenu(title: "Developer")
        developerMenu.submenu = devMenu
        devMenu.addItem(NSMenuItem(title: "Reload Frontend", action: #selector(reloadFrontend(_:)), keyEquivalent: "r"))
        let restartItem = NSMenuItem(title: "Restart Server", action: #selector(restartServer(_:)), keyEquivalent: "r", modifierMask: [.command, .shift])
        devMenu.addItem(restartItem)
        restartMenuItem = restartItem
        let relaunchItem = NSMenuItem(title: "Relaunch App", action: #selector(relaunchApp(_:)), keyEquivalent: "r", modifierMask: [.command, .option, .shift])
        devMenu.addItem(relaunchItem)
        relaunchMenuItem = relaunchItem
        devMenu.addItem(NSMenuItem(title: "Reset Everything", action: #selector(resetEverything(_:)), keyEquivalent: "r", modifierMask: [.command, .option]))
        devMenu.addItem(NSMenuItem.separator())
        devMenu.addItem(NSMenuItem(title: "Open Web Inspector", action: #selector(openWebInspector(_:)), keyEquivalent: ""))
        devMenu.addItem(NSMenuItem.separator())

        // Source tree display item
        if let path = sourceTreePath {
            let sourceTreeItem = NSMenuItem(title: "Source Tree: \(path)", action: nil, keyEquivalent: "")
            sourceTreeItem.isEnabled = false
            devMenu.addItem(sourceTreeItem)
            sourceTreeMenuItem = sourceTreeItem
        }
        devMenu.addItem(NSMenuItem(title: "Choose Source Tree...", action: #selector(chooseSourceTree(_:)), keyEquivalent: ""))
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

    @objc private func reloadFrontend(_ sender: Any) {
        sendControl("reload_frontend")
    }

    @objc private func restartServer(_ sender: Any) {
        sendControl("restart")
    }

    @objc private func relaunchApp(_ sender: Any) {
        sendControl("relaunch")
    }

    @objc private func resetEverything(_ sender: Any) {
        sendControl("reset")
    }

    @objc private func openWebInspector(_ sender: Any) {
        window.openWebInspector()
    }

    @objc private func chooseSourceTree(_ sender: Any) {
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

            // Update Developer menu source tree display
            sourceTreeMenuItem?.title = "Source Tree: \(url.path)"
        }
    }

    private func updateDeveloperMenuVisibility() {
        developerMenu.isHidden = !devModeEnabled
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
            // Update Developer menu source tree display
            self.sourceTreeMenuItem?.title = "Source Tree: \(url.path)"
            // Re-send dev_mode if already enabled (per D12)
            if self.devModeEnabled {
                self.processManager.sendDevMode(enabled: true, sourceTree: url.path, vitePort: self.vitePort)
            }
            completion(url.path)
        }
    }

    func bridgeSetDevMode(enabled: Bool, completion: @escaping (Bool) -> Void) {
        self.devModeEnabled = enabled
        self.updateDeveloperMenuVisibility()
        self.savePreferences()

        // If enabling without source tree, show error and bail out
        if enabled, sourceTreePath == nil {
            let alert = NSAlert()
            alert.messageText = "Source Tree Required"
            alert.informativeText = "Dev mode requires a source tree.\nGo to Developer > Choose Source Tree... to set one."
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
        }
    }

    func bridgePageDidLoad() {
        syncLocalStorageOnPageLoad()
    }

    func bridgeDevModeError(message: String) {
        window.bridgeDevModeError(message: message)
    }

    func bridgeSetTheme(color: String) {
        UserDefaults.standard.set(color, forKey: TugConfig.keyWindowBackground)
        window.updateBackgroundColor(color)
    }

    func bridgeDevBadge(backend: Bool, app: Bool) {
        let diamond = "◆ "
        if let item = restartMenuItem {
            if backend {
                if !item.title.hasPrefix(diamond) {
                    item.title = diamond + item.title
                }
            } else {
                if item.title.hasPrefix(diamond) {
                    item.title = String(item.title.dropFirst(diamond.count))
                }
            }
        }
        if let item = relaunchMenuItem {
            if app {
                if !item.title.hasPrefix(diamond) {
                    item.title = diamond + item.title
                }
            } else {
                if item.title.hasPrefix(diamond) {
                    item.title = String(item.title.dropFirst(diamond.count))
                }
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
