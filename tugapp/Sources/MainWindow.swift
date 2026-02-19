import Cocoa
import WebKit

/// Main window containing the WKWebView for tugdeck dashboard
class MainWindow: NSWindow, WKNavigationDelegate {
    private var webView: WKWebView!

    override init(contentRect: NSRect, styleMask style: NSWindow.StyleMask, backing backingStoreType: NSWindow.BackingStoreType, defer flag: Bool) {
        super.init(contentRect: contentRect, styleMask: style, backing: backingStoreType, defer: flag)

        self.title = "Tug"
        self.setFrameAutosaveName("MainWindow")

        // Configure WKWebView
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

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
