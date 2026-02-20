import Cocoa

/// Settings window controller that manages the app's preferences UI.
/// Shows a non-resizable window with developer mode toggle and source tree selection.
class SettingsWindowController: NSWindowController {
    // MARK: - UI Properties

    private var devModeCheckbox: NSButton!
    private var sourceTreeLabel: NSTextField!
    private var sourceTreeField: NSTextField!
    private var chooseButton: NSButton!

    // MARK: - Callbacks

    /// Called when dev mode checkbox state changes
    var onDevModeChanged: ((Bool) -> Void)?

    /// Called when source tree path is selected
    var onSourceTreeChanged: ((String?) -> Void)?

    // MARK: - Initialization

    override init(window: NSWindow?) {
        super.init(window: window)
    }

    convenience init() {
        // Create non-resizable window
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 450, height: 200),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Settings"
        window.setFrameAutosaveName("SettingsWindow")

        self.init(window: window)
        setupUI()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    // MARK: - UI Setup

    private func setupUI() {
        guard let window = window else { return }

        let contentView = NSView()
        window.contentView = contentView

        // General section label
        let generalLabel = NSTextField(labelWithString: "General")
        generalLabel.font = .boldSystemFont(ofSize: 13)
        generalLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(generalLabel)

        // Dev mode checkbox
        devModeCheckbox = NSButton(checkboxWithTitle: "Enable Developer Mode", target: self, action: #selector(devModeToggled(_:)))
        devModeCheckbox.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(devModeCheckbox)

        // Source Tree section label
        sourceTreeLabel = NSTextField(labelWithString: "Source Tree")
        sourceTreeLabel.font = .boldSystemFont(ofSize: 13)
        sourceTreeLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(sourceTreeLabel)

        // Source Tree path field
        sourceTreeField = NSTextField(labelWithString: "")
        sourceTreeField.lineBreakMode = .byTruncatingMiddle
        sourceTreeField.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(sourceTreeField)

        // Choose button
        chooseButton = NSButton(title: "Choose...", target: self, action: #selector(chooseTapped(_:)))
        chooseButton.translatesAutoresizingMaskIntoConstraints = false
        chooseButton.bezelStyle = .rounded
        contentView.addSubview(chooseButton)

        // Layout constraints
        NSLayoutConstraint.activate([
            // General label
            generalLabel.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            generalLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),

            // Dev mode checkbox
            devModeCheckbox.topAnchor.constraint(equalTo: generalLabel.bottomAnchor, constant: 8),
            devModeCheckbox.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),

            // Source Tree label
            sourceTreeLabel.topAnchor.constraint(equalTo: devModeCheckbox.bottomAnchor, constant: 16),
            sourceTreeLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),

            // Source Tree field and button
            sourceTreeField.topAnchor.constraint(equalTo: sourceTreeLabel.bottomAnchor, constant: 8),
            sourceTreeField.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            sourceTreeField.trailingAnchor.constraint(equalTo: chooseButton.leadingAnchor, constant: -8),

            chooseButton.firstBaselineAnchor.constraint(equalTo: sourceTreeField.firstBaselineAnchor),
            chooseButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),

            // Bottom constraint
            contentView.bottomAnchor.constraint(equalTo: sourceTreeField.bottomAnchor, constant: 20),
        ])

        // Set initial visibility based on current dev mode state
        updateSourceTreeVisibility()
    }

    // MARK: - Window Lifecycle

    override func showWindow(_ sender: Any?) {
        // Refresh UI state from UserDefaults
        let devModeEnabled = UserDefaults.standard.bool(forKey: TugConfig.keyDevModeEnabled)
        devModeCheckbox.state = devModeEnabled ? .on : .off

        if let path = UserDefaults.standard.string(forKey: TugConfig.keySourceTreePath) {
            sourceTreeField.stringValue = path
        } else {
            sourceTreeField.stringValue = "Not set"
        }

        updateSourceTreeVisibility()

        super.showWindow(sender)
    }

    // MARK: - Actions

    @objc private func devModeToggled(_ sender: NSButton) {
        let enabled = sender.state == .on

        // Save to UserDefaults
        UserDefaults.standard.set(enabled, forKey: TugConfig.keyDevModeEnabled)

        // Update UI visibility
        updateSourceTreeVisibility()

        // Notify callback
        onDevModeChanged?(enabled)

        // Auto-open picker if enabled and no source tree set
        if enabled && UserDefaults.standard.string(forKey: TugConfig.keySourceTreePath) == nil {
            chooseTapped(sender)
        }
    }

    @objc private func chooseTapped(_ sender: Any) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Choose the tugtool mono-repo root directory"

        panel.beginSheetModal(for: window!) { response in
            guard response == .OK, let url = panel.url else { return }

            // Validate source tree
            if !TugConfig.isValidSourceTree(url) {
                let markers = TugConfig.sourceTreeMarkers.joined(separator: "\n  ")
                let alert = NSAlert()
                alert.messageText = "Invalid Source Tree"
                alert.informativeText = "The selected directory is not a tugtool repo.\nExpected to find:\n  \(markers)"
                alert.alertStyle = .warning
                alert.runModal()
                return
            }

            // Save to UserDefaults
            UserDefaults.standard.set(url.path, forKey: TugConfig.keySourceTreePath)

            // Update UI
            self.sourceTreeField.stringValue = url.path

            // Notify callback
            self.onSourceTreeChanged?(url.path)
        }
    }

    // MARK: - Helpers

    private func updateSourceTreeVisibility() {
        let visible = devModeCheckbox.state == .on
        sourceTreeLabel.isHidden = !visible
        sourceTreeField.isHidden = !visible
        chooseButton.isHidden = !visible
    }
}
