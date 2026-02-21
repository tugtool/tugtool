import Cocoa
import WebKit

/// Protocol for bridge callbacks from WebKit to AppDelegate
protocol BridgeDelegate: AnyObject {
    func bridgeChooseSourceTree(completion: @escaping (String?) -> Void)
    func bridgeSetDevMode(enabled: Bool, completion: @escaping (Bool) -> Void)
    func bridgeGetSettings(completion: @escaping (Bool, Bool, String?) -> Void)
    func bridgeFrontendReady()
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

        self.contentView = webView
    }

    /// Load URL in webview
    func loadURL(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        let request = URLRequest(url: url)
        webView.load(request)
    }

    /// Reload the current page
    func reload() {
        webView.reload()
    }

    /// Open web inspector
    func openWebInspector() {
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        // Web inspector opens via context menu or Develop menu if enabled
    }

    /// Clean up WKScriptMessageHandler registrations to break retain cycle
    func cleanupBridge() {
        guard !bridgeCleaned else { return }
        contentController.removeScriptMessageHandler(forName: "chooseSourceTree")
        contentController.removeScriptMessageHandler(forName: "setDevMode")
        contentController.removeScriptMessageHandler(forName: "getSettings")
        contentController.removeScriptMessageHandler(forName: "frontendReady")
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

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Navigation completed
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("Navigation failed: %@", error.localizedDescription)
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
                    self.webView.evaluateJavaScript("window.__tugBridge?.onSourceTreeSelected?.('\(escaped)')")
                } else {
                    self.webView.evaluateJavaScript("window.__tugBridge?.onSourceTreeCancelled?.()")
                }
            }
        case "setDevMode":
            guard let body = message.body as? [String: Any],
                  let enabled = body["enabled"] as? Bool else { return }
            bridgeDelegate?.bridgeSetDevMode(enabled: enabled) { [weak self] confirmed in
                guard let self = self else { return }
                self.webView.evaluateJavaScript("window.__tugBridge?.onDevModeChanged?.(\(confirmed))")
            }
        case "getSettings":
            bridgeDelegate?.bridgeGetSettings { [weak self] devMode, runtimeDevMode, sourceTree in
                guard let self = self else { return }
                let stValue: String
                if let st = sourceTree {
                    stValue = "'\(self.escapeForJS(st))'"
                } else {
                    stValue = "null"
                }
                self.webView.evaluateJavaScript("window.__tugBridge?.onSettingsLoaded?.({devMode: \(devMode), runtimeDevMode: \(runtimeDevMode), sourceTree: \(stValue)})")
            }
        case "frontendReady":
            bridgeDelegate?.bridgeFrontendReady()
        default:
            NSLog("MainWindow: unknown script message: %@", message.name)
        }
    }
}
