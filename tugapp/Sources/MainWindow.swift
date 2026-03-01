import Cocoa
import WebKit

/// Protocol for bridge callbacks from WebKit to AppDelegate
protocol BridgeDelegate: AnyObject {
    func bridgeChooseSourceTree(completion: @escaping (String?) -> Void)
    func bridgeSetDevMode(enabled: Bool, completion: @escaping (Bool) -> Void)
    func bridgeGetSettings(completion: @escaping (Bool, String?) -> Void)
    func bridgeFrontendReady()
    func bridgePageDidLoad()
    func bridgeDevModeError(message: String)
    func bridgeSetTheme(color: String)
    func bridgeDevBadge(backend: Bool, app: Bool)
}

/// Main window containing the WKWebView for tugdeck dashboard
class MainWindow: NSWindow, WKNavigationDelegate {
    private var webView: WKWebView!
    private var contentController: WKUserContentController!
    weak var bridgeDelegate: BridgeDelegate?
    private var bridgeCleaned = false

    override init(contentRect: NSRect, styleMask style: NSWindow.StyleMask, backing backingStoreType: NSWindow.BackingStoreType, defer flag: Bool) {
        super.init(contentRect: contentRect, styleMask: style, backing: backingStoreType, defer: flag)

        self.title = "Tug"
        self.setFrameAutosaveName("MainWindow")

        // Configure WKUserContentController for script message handlers
        contentController = WKUserContentController()
        contentController.add(self, name: "chooseSourceTree")
        contentController.add(self, name: "setDevMode")
        contentController.add(self, name: "getSettings")
        contentController.add(self, name: "frontendReady")
        contentController.add(self, name: "setTheme")
        contentController.add(self, name: "devBadge")

        // Configure WKWebView
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.userContentController = contentController

        // Allow localhost access
        if #available(macOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        // Flash fix: suppress WKWebView's default white background so it does not flash
        // before the page finishes rendering. The webView starts hidden and is revealed
        // once didFinishNavigation fires, eliminating the startup FOUC.
        // drawsBackground = false is the supported KVC way to make WKWebView transparent.
        webView.setValue(false, forKey: "drawsBackground")
        webView.isHidden = true

        self.contentView = webView

        // Set window background so there is no color mismatch while the
        // webView is hidden during startup.
        let savedHex = UserDefaults.standard.string(forKey: TugConfig.keyWindowBackground) ?? MainWindow.defaultBackgroundHex
        updateBackgroundColor(savedHex)
    }

    /// Load URL in webview
    func loadURL(_ urlString: String) {
        NSLog("MainWindow: loadURL called with %@", urlString)
        guard let url = URL(string: urlString) else { return }
        let request = URLRequest(url: url)
        webView.load(request)
    }

    /// Reload the current page
    func reload() {
        webView.reload()
    }

    /// Evaluate JavaScript in the current page context.
    func evaluateJavaScript(_ script: String, completionHandler: ((Any?, Error?) -> Void)? = nil) {
        webView.evaluateJavaScript(script, completionHandler: completionHandler)
    }

    /// Open web inspector
    func openWebInspector() {
        guard let inspector = webView.value(forKey: "_inspector") as? NSObject else { return }
        inspector.perform(NSSelectorFromString("show"))
    }

    /// Brio canvas color — used as fallback when no saved value exists.
    static let defaultBackgroundHex = "#1c1e22"

    /// Update the window background color from a CSS hex string (e.g. "#1c1e22").
    func updateBackgroundColor(_ hex: String) {
        self.backgroundColor = NSColor(hexString: hex) ?? NSColor(hexString: MainWindow.defaultBackgroundHex)!
    }

    /// Clean up WKScriptMessageHandler registrations to break retain cycle
    func cleanupBridge() {
        guard !bridgeCleaned else { return }
        contentController.removeScriptMessageHandler(forName: "chooseSourceTree")
        contentController.removeScriptMessageHandler(forName: "setDevMode")
        contentController.removeScriptMessageHandler(forName: "getSettings")
        contentController.removeScriptMessageHandler(forName: "frontendReady")
        contentController.removeScriptMessageHandler(forName: "setTheme")
        contentController.removeScriptMessageHandler(forName: "devBadge")
        bridgeCleaned = true
    }

    deinit {
        cleanupBridge()
    }

    /// Escape a string for safe embedding in JavaScript
    private func escapeForJS(_ str: String) -> String {
        str.replacingOccurrences(of: "\\", with: "\\\\")
           .replacingOccurrences(of: "'", with: "\\'")
           .replacingOccurrences(of: "\n", with: "\\n")
    }

    /// Send dev mode error to frontend
    func bridgeDevModeError(message: String) {
        let escaped = escapeForJS(message)
        webView.evaluateJavaScript("window.__tugBridge?.onDevModeError?.('\(escaped)')") { _, error in
            if let error = error {
                NSLog("MainWindow: evaluateJavaScript failed for bridgeDevModeError: %@", error.localizedDescription)
            }
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        NSLog("MainWindow: didFinish navigation at %@", Date() as CVarArg)
        // Flash fix: reveal the webView now that the page has finished loading.
        // Keeping it hidden until this point eliminates the startup FOUC.
        webView.isHidden = false
        // Notify delegate so it can sync localStorage with UserDefaults.
        bridgeDelegate?.bridgePageDidLoad()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("Navigation failed: %@", error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("Navigation failed (provisional): %@", error.localizedDescription)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Allow all navigation for auth flow
        decisionHandler(.allow)
    }
}

// MARK: - WKScriptMessageHandler

extension MainWindow: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "chooseSourceTree":
            bridgeDelegate?.bridgeChooseSourceTree { [weak self] path in
                guard let self = self else { return }
                if let path = path {
                    let escaped = self.escapeForJS(path)
                    self.webView.evaluateJavaScript("window.__tugBridge?.onSourceTreeSelected?.('\(escaped)')") { _, error in
                        if let error = error {
                            NSLog("MainWindow: evaluateJavaScript failed for chooseSourceTree (selected): %@", error.localizedDescription)
                        }
                    }
                } else {
                    self.webView.evaluateJavaScript("window.__tugBridge?.onSourceTreeCancelled?.()") { _, error in
                        if let error = error {
                            NSLog("MainWindow: evaluateJavaScript failed for chooseSourceTree (cancelled): %@", error.localizedDescription)
                        }
                    }
                }
            }
        case "setDevMode":
            guard let body = message.body as? [String: Any],
                  let enabled = body["enabled"] as? Bool else { return }
            bridgeDelegate?.bridgeSetDevMode(enabled: enabled) { [weak self] confirmed in
                guard let self = self else { return }
                self.webView.evaluateJavaScript("window.__tugBridge?.onDevModeChanged?.(\(confirmed))") { _, error in
                    if let error = error {
                        NSLog("MainWindow: evaluateJavaScript failed for setDevMode: %@", error.localizedDescription)
                    }
                }
            }
        case "getSettings":
            bridgeDelegate?.bridgeGetSettings { [weak self] devMode, sourceTree in
                guard let self = self else { return }
                let stValue: String
                if let st = sourceTree {
                    stValue = "'\(self.escapeForJS(st))'"
                } else {
                    stValue = "null"
                }
                self.webView.evaluateJavaScript("window.__tugBridge?.onSettingsLoaded?.({devMode: \(devMode), sourceTree: \(stValue)})") { _, error in
                    if let error = error {
                        NSLog("MainWindow: evaluateJavaScript failed for getSettings: %@", error.localizedDescription)
                    }
                }
            }
        case "frontendReady":
            bridgeDelegate?.bridgeFrontendReady()
        case "setTheme":
            guard let body = message.body as? [String: Any],
                  let color = body["color"] as? String else { return }
            bridgeDelegate?.bridgeSetTheme(color: color)
        case "devBadge":
            guard let body = message.body as? [String: Any] else { return }
            let backend = body["backend"] as? Bool ?? false
            let app = body["app"] as? Bool ?? false
            bridgeDelegate?.bridgeDevBadge(backend: backend, app: app)
        default:
            NSLog("MainWindow: unknown script message: %@", message.name)
        }
    }
}

// MARK: - NSColor hex parsing

private extension NSColor {
    /// Create an NSColor from a CSS hex string (e.g. "#1c1e22" or "1c1e22").
    convenience init?(hexString hex: String) {
        var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("#") {
            cleaned.removeFirst()
        }
        guard cleaned.count == 6 else { return nil }
        var rgb: UInt64 = 0
        guard Scanner(string: cleaned).scanHexInt64(&rgb) else { return nil }
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
            green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
            blue: CGFloat(rgb & 0xFF) / 255.0,
            alpha: 1.0
        )
    }
}
