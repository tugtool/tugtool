import Cocoa
import WebKit

/// Protocol for bridge callbacks from WebKit to AppDelegate
protocol BridgeDelegate: AnyObject {
    func bridgeChooseSourceTree(completion: @escaping (String?) -> Void)
    func bridgeSetDevMode(enabled: Bool, completion: @escaping (Bool) -> Void)
    func bridgeGetSettings(completion: @escaping (Bool, String?) -> Void)
    func bridgeFrontendReady()
    func bridgeDevModeError(message: String)
    func bridgeSetTheme(color: String)
    func bridgeDevBadge(backend: Bool, app: Bool)
    func bridgeIsDevMode() -> Bool
}

/// Main window containing the WKWebView for tugdeck dashboard
class MainWindow: NSWindow, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var containerView: NSView!
    private var spinnerView: NSView?
    private var contentController: WKUserContentController!
    weak var bridgeDelegate: BridgeDelegate?
    private var bridgeCleaned = false

    override init(contentRect: NSRect, styleMask style: NSWindow.StyleMask, backing backingStoreType: NSWindow.BackingStoreType, defer flag: Bool) {
        super.init(contentRect: contentRect, styleMask: style, backing: backingStoreType, defer: flag)

        self.title = "Tug"
        self.setFrameAutosaveName("MainWindow")

        // Configure WKUserContentController for script message handlers
        contentController = WKUserContentController()
        contentController.add(self, name: "sourceTree")
        contentController.add(self, name: "setDevMode")
        contentController.add(self, name: "getSettings")
        contentController.add(self, name: "frontendReady")
        contentController.add(self, name: "setTheme")
        contentController.add(self, name: "devBadge")
        contentController.add(self, name: "clipboardRead")
        contentController.add(self, name: "cardList")

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
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        // Suppress WKWebView's default white background. The webView starts
        // hidden and is revealed by frontendReady after JS applies the theme.
        webView.setValue(false, forKey: "drawsBackground")
        webView.isHidden = true

        // Container view holds both the WebView and any snapshot overlays.
        // The snapshot overlay is a sibling of the WebView (not a child) so
        // it is unaffected by WKWebView's compositing during navigation.
        containerView = NSView(frame: contentRect)
        containerView.autoresizingMask = [.width, .height]
        containerView.addSubview(webView)
        webView.frame = containerView.bounds
        webView.autoresizingMask = [.width, .height]

        // Startup splash: app icon + indeterminate spinner, visible until
        // frontendReady fires. Sits behind the WebView in the container.
        let splashView = NSView(frame: contentRect)
        splashView.autoresizingMask = [.width, .height]

        let iconSize: CGFloat = 128
        let iconView = NSImageView(frame: NSRect(x: 0, y: 0, width: iconSize, height: iconSize))
        // Request the icon at the exact display size so AppKit picks the
        // best representation (128pt icon on 1x, 256px rep on 2x Retina).
        let icon = NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)
        icon.size = NSSize(width: iconSize, height: iconSize)
        iconView.image = icon
        iconView.imageScaling = .scaleNone
        iconView.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]

        let spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.sizeToFit()
        spinner.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]

        // Determine light/dark appearance from the startup background color
        // so the spinner renders with the correct vibrancy.
        let bgHex = MainWindow.resolveStartupBackgroundHex()
        let bgColor = NSColor(hexString: bgHex) ?? NSColor.black
        var brightness: CGFloat = 0
        bgColor.usingColorSpace(.sRGB)?.getHue(nil, saturation: nil, brightness: &brightness, alpha: nil)
        splashView.appearance = NSAppearance(named: brightness < 0.5 ? .darkAqua : .aqua)

        // Layout: icon and spinner stacked vertically, centered.
        let gap: CGFloat = 20
        let stackHeight = iconSize + gap + spinner.frame.height
        let topY = (contentRect.height - stackHeight) / 2
        iconView.frame.origin.x = (contentRect.width - iconSize) / 2
        iconView.frame.origin.y = topY + gap + spinner.frame.height
        spinner.frame.origin.x = (contentRect.width - spinner.frame.width) / 2
        spinner.frame.origin.y = topY

        spinner.startAnimation(nil)
        splashView.addSubview(iconView)
        splashView.addSubview(spinner)
        containerView.addSubview(splashView, positioned: .below, relativeTo: webView)
        self.spinnerView = splashView

        self.contentView = containerView
        // Background color is set by AppDelegate after init, not here.
    }

    /// Load URL in webview
    func loadURL(_ urlString: String) {
        NSLog("MainWindow: loadURL called with %@", urlString)
        guard let url = URL(string: urlString) else { return }
        let request = URLRequest(url: url)
        webView.load(request)
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

    /// Brio canvas color — final fallback when no other source is available.
    /// Must match --tugx-host-canvas-color in tugdeck/styles/themes/brio.css.
    static let defaultBackgroundHex = "#16181a"

    /// Resolve the startup background color from the active theme's CSS file.
    /// Reads the theme name and source tree path from tugbank, then parses
    /// --tugx-host-canvas-color directly from the theme's CSS on disk.
    /// Falls back to the tugbank-cached value, then to brio's hardcoded color.
    static func resolveStartupBackgroundHex() -> String {
        // 1. Try to derive from the theme's CSS file on disk
        if let theme = ProcessManager.readTugbank(domain: TugConfig.domain, key: "theme"),
           let sourceTree = ProcessManager.readTugbank(domain: TugConfig.domain, key: TugConfig.keySourceTreePath) {
            let cssPath = (sourceTree as NSString)
                .appendingPathComponent("tugdeck/styles/themes/\(theme).css")
            if let css = try? String(contentsOfFile: cssPath, encoding: .utf8),
               let color = parseHostCanvasColor(css) {
                return color
            }
        }
        // 2. Fall back to cached value from last bridge call
        if let cached = ProcessManager.readTugbank(domain: TugConfig.domain, key: TugConfig.keyWindowBackground) {
            return cached
        }
        // 3. Final fallback
        return defaultBackgroundHex
    }

    /// Parse --tugx-host-canvas-color from a CSS string. Returns the #rrggbb value or nil.
    /// Same logic as parseHostCanvasColor in tugdeck/vite.config.ts.
    private static func parseHostCanvasColor(_ css: String) -> String? {
        // Strip block comments
        let withoutComments = css.replacingOccurrences(
            of: "/\\*[\\s\\S]*?\\*/",
            with: " ",
            options: .regularExpression
        )
        // Match --tugx-host-canvas-color: #rrggbb;
        let pattern = "--tugx-host-canvas-color\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: withoutComments, range: NSRange(withoutComments.startIndex..., in: withoutComments)),
              let colorRange = Range(match.range(at: 1), in: withoutComments) else {
            return nil
        }
        return String(withoutComments[colorRange]).lowercased()
    }

    /// Update the window background color from a CSS hex string (e.g. "#1c1e22").
    func updateBackgroundColor(_ hex: String) {
        self.backgroundColor = NSColor(hexString: hex) ?? NSColor(hexString: MainWindow.defaultBackgroundHex)!
    }

    /// Capture the current WebView content as a static snapshot and overlay it,
    /// so the user sees a frozen frame during shutdown instead of disconnect
    /// banners, theme flashes, or blank screens. The WebView stays alive
    /// underneath for __tugdeckSaveState to execute.
    func freezeForShutdown(completion: @escaping () -> Void) {
        webView.takeSnapshot(with: nil) { [weak self] image, error in
            guard let self = self else {
                completion()
                return
            }
            if let image = image {
                let overlay = NSImageView(frame: self.webView.bounds)
                overlay.image = image
                overlay.imageScaling = .scaleNone
                overlay.autoresizingMask = [.width, .height]
                self.webView.addSubview(overlay)
            } else {
                // Snapshot failed — fall back to hiding the WebView.
                self.webView.isHidden = true
            }
            completion()
        }
    }

    /// Tag used to identify the reload snapshot overlay.
    private static let reloadSnapshotTag = 9999

    /// Capture the current WebView content as a snapshot overlay so the user
    /// sees a frozen frame while the page reloads. The overlay is added to
    /// the container view (sibling of the WebView, not a child) so WKWebView's
    /// compositing during navigation cannot cause it to flicker. Removed by
    /// thawAfterReload() when frontendReady fires.
    func freezeForReload(completion: @escaping () -> Void) {
        // Snapshot the entire window contents so the capture includes
        // everything visible — web content, native scrollbars, all of it.
        guard let contentView = self.contentView,
              let bitmapRep = contentView.bitmapImageRepForCachingDisplay(in: contentView.bounds) else {
            completion()
            return
        }
        contentView.cacheDisplay(in: contentView.bounds, to: bitmapRep)
        let image = NSImage(size: contentView.bounds.size)
        image.addRepresentation(bitmapRep)

        let overlay = NSImageView(frame: containerView.bounds)
        overlay.image = image
        overlay.imageScaling = .scaleNone
        overlay.autoresizingMask = [.width, .height]
        overlay.tag = MainWindow.reloadSnapshotTag
        containerView.addSubview(overlay)
        completion()
    }

    /// Remove the reload snapshot overlay with a brief crossfade so the
    /// freshly-loaded content appears smoothly.
    func thawAfterReload() {
        guard let overlay = containerView.viewWithTag(MainWindow.reloadSnapshotTag) else { return }
        overlay.wantsLayer = true
        let anim = CABasicAnimation(keyPath: "opacity")
        anim.fromValue = 1
        anim.toValue = 0
        anim.duration = 0.15
        anim.timingFunction = CAMediaTimingFunction(name: .easeOut)
        anim.isRemovedOnCompletion = false
        anim.fillMode = .forwards
        overlay.layer?.add(anim, forKey: "thawFade")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            overlay.removeFromSuperview()
        }
    }

    /// Clean up WKScriptMessageHandler registrations to break retain cycle
    func cleanupBridge() {
        guard !bridgeCleaned else { return }
        contentController.removeScriptMessageHandler(forName: "sourceTree")
        contentController.removeScriptMessageHandler(forName: "setDevMode")
        contentController.removeScriptMessageHandler(forName: "getSettings")
        contentController.removeScriptMessageHandler(forName: "frontendReady")
        contentController.removeScriptMessageHandler(forName: "setTheme")
        contentController.removeScriptMessageHandler(forName: "devBadge")
        contentController.removeScriptMessageHandler(forName: "clipboardRead")
        contentController.removeScriptMessageHandler(forName: "cardList")
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
        // WebView is NOT revealed here — we wait for frontendReady so the theme
        // and all visual state is applied before the user sees anything.
    }

    /// Reveal the WebView. Called from frontendReady bridge message, which fires
    /// after JS has applied the theme, sent the canvas color, and constructed the
    /// DeckManager. This eliminates the flash of unstyled/default-themed content
    /// that would occur if we revealed on didFinishNavigation.
    func revealWebView() {
        NSLog("MainWindow: revealWebView called (isHidden=%d)", webView.isHidden ? 1 : 0)

        // If a reload snapshot overlay is present, hold it for 0.5s so the
        // WebView content is fully composited before the crossfade begins.
        if containerView.viewWithTag(MainWindow.reloadSnapshotTag) != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                self.thawAfterReload()
            }
            return
        }

        guard webView.isHidden else { return }
        webView.wantsLayer = true
        webView.layer?.opacity = 0
        webView.isHidden = false

        let anim = CABasicAnimation(keyPath: "opacity")
        anim.fromValue = 0
        anim.toValue = 1
        anim.duration = 0.2
        anim.timingFunction = CAMediaTimingFunction(name: .easeIn)
        anim.isRemovedOnCompletion = false
        anim.fillMode = .forwards
        webView.layer?.add(anim, forKey: "revealFade")
        webView.layer?.opacity = 1

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.makeFirstResponder(self.webView)
            // Remove the startup spinner after the WebView is fully revealed.
            self.spinnerView?.removeFromSuperview()
            self.spinnerView = nil
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("Navigation failed: %@", error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("Navigation failed (provisional): %@", error.localizedDescription)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Intercept reload navigation: freeze the display as a snapshot overlay,
        // save state via JS bridge BEFORE the page tears down, then reload.
        // The snapshot keeps cards visible during teardown/rebuild. It is removed
        // by revealWebView() when frontendReady fires after the reload completes.
        if navigationAction.navigationType == .reload {
            decisionHandler(.cancel)
            freezeForReload { [weak self] in
                self?.webView.evaluateJavaScript("window.__tugdeckSaveState?.()") { [weak self] _, _ in
                    if let url = self?.webView.url {
                        self?.webView.load(URLRequest(url: url))
                    }
                }
            }
            return
        }
        decisionHandler(.allow)
    }

    // MARK: - WKUIDelegate

    /// Handle <input type="file"> — without this, file inputs are silently ignored in WKWebView.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.begin { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    /// Handle blob URL downloads (e.g. Export JSON) — without this, <a download> navigates instead of downloading.
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let response = navigationResponse.response as? HTTPURLResponse,
           let contentDisposition = response.value(forHTTPHeaderField: "Content-Disposition"),
           contentDisposition.contains("attachment") {
            decisionHandler(.download)
            return
        }
        // For blob: URLs triggered by <a download>, WKWebView reports them as non-main-frame
        // navigations with a blob scheme. Convert these to downloads.
        if navigationResponse.response.url?.scheme == "blob" {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }
}

// MARK: - WKScriptMessageHandler

extension MainWindow: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "sourceTree":
            bridgeDelegate?.bridgeChooseSourceTree { [weak self] path in
                guard let self = self else { return }
                if let path = path {
                    let escaped = self.escapeForJS(path)
                    self.webView.evaluateJavaScript("window.__tugBridge?.onSourceTreeSelected?.('\(escaped)')") { _, error in
                        if let error = error {
                            NSLog("MainWindow: evaluateJavaScript failed for sourceTree (selected): %@", error.localizedDescription)
                        }
                    }
                } else {
                    self.webView.evaluateJavaScript("window.__tugBridge?.onSourceTreeCancelled?.()") { _, error in
                        if let error = error {
                            NSLog("MainWindow: evaluateJavaScript failed for sourceTree (cancelled): %@", error.localizedDescription)
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
            revealWebView()
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
        case "clipboardRead":
            // Native clipboard bridge. Read NSPasteboard directly and call
            // back to JavaScript with the contents. This exists because
            // Safari's JavaScript Clipboard API (navigator.clipboard.readText /
            // .read) triggers a floating "Paste" permission popup on every
            // invocation, and in Safari 16.4+ document.execCommand("paste")
            // on contentEditable triggers the same popup. Reading via
            // NSPasteboard on the native side is the only way to supply
            // clipboard data to JavaScript without the popup.
            //
            // JS-side contract: post {requestId} and wait for a callback
            // on window.__tugNativeClipboardCallback(data) where data is
            // {requestId, text, html}. See tug-native-clipboard.ts.
            guard let body = message.body as? [String: Any],
                  let requestId = body["requestId"] as? String else { return }
            let pasteboard = NSPasteboard.general
            let text = pasteboard.string(forType: .string) ?? ""
            let html = pasteboard.string(forType: .html) ?? ""
            // Use JSON to pass arbitrary clipboard contents through the
            // evaluateJavaScript string safely — the text may contain
            // quotes, backslashes, control chars, and line separators
            // that would otherwise break a manually-escaped JS literal.
            let payload: [String: Any] = [
                "requestId": requestId,
                "text": text,
                "html": html
            ]
            guard let jsonData = try? JSONSerialization.data(withJSONObject: payload, options: []),
                  let jsonString = String(data: jsonData, encoding: .utf8) else {
                NSLog("MainWindow: JSON serialization failed for clipboardRead")
                return
            }
            // JSON-serialize the JSON once more to produce a valid JS
            // string literal (handles \u2028 / \u2029 which JSON allows
            // but JS does not in source text).
            guard let quotedJsonData = try? JSONSerialization.data(withJSONObject: jsonString, options: [.fragmentsAllowed]),
                  let quotedJsonString = String(data: quotedJsonData, encoding: .utf8) else {
                NSLog("MainWindow: JSON quoting failed for clipboardRead")
                return
            }
            let script = "window.__tugNativeClipboardCallback?.(JSON.parse(\(quotedJsonString)))"
            self.webView.evaluateJavaScript(script) { _, error in
                if let error = error {
                    NSLog("MainWindow: evaluateJavaScript failed for clipboardRead: %@", error.localizedDescription)
                }
            }
        case "cardList":
            // Card list pushed from the frontend on every deck state change.
            // Cache it on AppDelegate for the View menu's dynamic card list.
            if let list = message.body as? [[String: Any]],
               let appDelegate = NSApp.delegate as? AppDelegate {
                appDelegate.updateCardList(list)
            }
        default:
            NSLog("MainWindow: unknown script message: %@", message.name)
        }
    }
}

// MARK: - WKDownloadDelegate

extension MainWindow: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.begin { result in
            completionHandler(result == .OK ? panel.url : nil)
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
