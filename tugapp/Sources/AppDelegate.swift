import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: MainWindow!
    private var processManager = ProcessManager()
    private var devModeEnabled = false
    private var sourceTreePath: String?
    private var awaitingDevModeResult: Bool = false
    private var lastAuthURL: String?
    private var lastTugcastPort: Int = 55255
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
            self.lastTugcastPort = port
            // If dev mode is enabled and source tree is set, send dev_mode and gate loadURL
            let devEnabled = self.devModeEnabled
            let sourceTree = self.sourceTreePath
            if devEnabled, let path = sourceTree {
                // Spawn Vite dev server now that we know the actual tugcast port.
                // The duplication guard inside spawnViteDevServer prevents re-spawning on restarts.
                self.processManager.spawnViteDevServer(sourceTree: path, tugcastPort: port, vitePort: self.vitePort)
                // Wait for Vite to be listening before sending dev_mode, so the URL
                // rewrite in onDevModeResult loads a ready server instead of a white window.
                self.processManager.waitForViteReady(port: self.vitePort) { [weak self] ready in
                    guard let self = self else { return }
                    if !ready {
                        NSLog("AppDelegate: vite dev server did not become ready in 10s")
                    }
                    self.processManager.sendDevMode(enabled: true, sourceTree: path, vitePort: self.vitePort)
                    self.awaitingDevModeResult = true
                }
                // Do NOT call loadURL -- wait for dev_mode_result
            } else {
                // No dev mode or no source tree -- load immediately from tugcast
                self.window.loadURL(url)
            }
        }

        processManager.onDevModeResult = { [weak self] success in
            guard let self = self else { return }
            if self.awaitingDevModeResult {
                // Gate lifted -- load the page
                if let url = self.lastAuthURL {
                    // When dev mode is enabled (regardless of success), load from the Vite dev
                    // server (port 5173) so the browser gets HMR support. On failure the embedded
                    // assets are still served via Vite's proxy fallback; a full page load from
                    // tugcast would bypass HMR entirely.
                    let urlToLoad: String
                    if success {
                        // Rewrite the tugcast port to the Vite dev server port
                        let needle = ":\(self.lastTugcastPort)"
                        urlToLoad = url.replacingOccurrences(of: needle, with: ":\(self.vitePort)", options: [], range: url.range(of: needle))
                    } else {
                        // Dev mode failed -- load directly from tugcast (embedded assets)
                        urlToLoad = url
                    }
                    self.window.loadURL(urlToLoad)
                }
                self.awaitingDevModeResult = false
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
        // Send runtime control message
        if enabled, let path = sourceTreePath {
            processManager.sendDevMode(enabled: true, sourceTree: path, vitePort: vitePort)
        } else if !enabled {
            processManager.sendDevMode(enabled: false, sourceTree: nil)
        }
        // If enabling without source tree, skip sendDevMode silently per D08
        completion(enabled)
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
