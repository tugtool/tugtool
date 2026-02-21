import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: MainWindow!
    private var processManager = ProcessManager()
    private var devModeEnabled = false
    private var runtimeDevMode: Bool = false
    private var sourceTreePath: String?
    private var developerMenu: NSMenuItem!
    private var sourceTreeMenuItem: NSMenuItem?
    private var serverPort: Int?

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

        // Initialize runtime dev mode to match preference at launch
        runtimeDevMode = devModeEnabled

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
        processManager.onAuthURL = { [weak self] url in
            self?.window.loadURL(url)
            // Extract port from auth URL
            if let urlObj = URL(string: url), let port = urlObj.port {
                self?.serverPort = port
            }
            // Update runtime dev mode on every process (re)start
            self?.runtimeDevMode = self?.devModeEnabled ?? false
        }

        // Start tugcast
        processManager.start(devMode: devModeEnabled, sourceTree: sourceTreePath)
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
        appMenu.addItem(NSMenuItem(title: "About Tug", action: #selector(showAbout(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Settings...", action: #selector(showSettings(_:)), keyEquivalent: ","))
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
        devMenu.addItem(NSMenuItem(title: "Restart Server", action: #selector(restartServer(_:)), keyEquivalent: "r", modifierMask: [.command, .shift]))
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
        tell("show-card", params: ["component": "settings"])
    }

    @objc func showAbout(_ sender: Any?) {
        tell("show-card", params: ["component": "about"])
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
        tell("reload_frontend")
    }

    @objc private func restartServer(_ sender: Any) {
        tell("restart")
    }

    @objc private func resetEverything(_ sender: Any) {
        tell("reset")
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

            // Restart if dev mode is enabled
            if devModeEnabled {
                processManager.stop()
                processManager.start(devMode: true, sourceTree: url.path)
            }
        }
    }

    private func updateDeveloperMenuVisibility() {
        developerMenu.isHidden = !devModeEnabled
    }

    // MARK: - HTTP tell() helper

    private func tell(_ action: String, params: [String: Any] = [:]) {
        guard let port = serverPort else { return }
        var body: [String: Any] = ["action": action]
        for (key, value) in params {
            body[key] = value
        }
        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else { return }
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/tell") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = jsonData
        // Fire-and-forget
        URLSession.shared.dataTask(with: request).resume()
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
            // Restart if dev mode is enabled
            if self.devModeEnabled {
                self.processManager.stop()
                self.processManager.start(devMode: true, sourceTree: url.path)
            }
            completion(url.path)
        }
    }

    func bridgeSetDevMode(enabled: Bool, completion: @escaping (Bool) -> Void) {
        self.devModeEnabled = enabled
        self.updateDeveloperMenuVisibility()
        self.savePreferences()
        completion(enabled)
    }

    func bridgeGetSettings(completion: @escaping (Bool, Bool, String?) -> Void) {
        completion(devModeEnabled, runtimeDevMode, sourceTreePath)
    }
}

// Helper extension for menu items with modifier masks
extension NSMenuItem {
    convenience init(title: String, action: Selector?, keyEquivalent: String, modifierMask: NSEvent.ModifierFlags) {
        self.init(title: title, action: action, keyEquivalent: keyEquivalent)
        self.keyEquivalentModifierMask = modifierMask
    }
}
