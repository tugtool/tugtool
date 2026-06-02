import Cocoa
import WebKit

/// Protocol for bridge callbacks from WebKit to AppDelegate
protocol BridgeDelegate: AnyObject {
    func bridgeChooseSourceTree(completion: @escaping (String?) -> Void)
    func bridgeChoosePath(kind: String, initialPath: String?, completion: @escaping (String?) -> Void)
    func bridgeSetDevMode(enabled: Bool, completion: @escaping (Bool) -> Void)
    func bridgeGetSettings(completion: @escaping (Bool, String?) -> Void)
    func bridgeFrontendReady()
    func bridgeDevModeError(message: String)
    func bridgeSetTheme(color: String)
    func bridgeDevBadge(backend: Bool, app: Bool)
    func bridgeIsDevMode() -> Bool
    func bridgePageDidLoad()
    func bridgeHmrUpdate()
}

/// Pass-through container so the dev-info overlay does not block clicks
/// to the WebView underneath.
private final class DevInfoOverlayView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// WaveProgressView — Swift port of tugdeck's TugProgressWave glyph (the
/// three-bar "wave" that TugProgressIndicator renders in its `wave` variant).
///
/// Three vertical bars pulse in a staggered cycle. The rest pose is
/// short-long-short (outer bars at 0.5, middle bar at 1.0); each bar scales
/// toward the inverse pose at its pulse peak, producing the wave silhouette.
/// Geometry and motion mirror
/// `tugdeck/src/components/tugways/internal/tug-progress-wave.{tsx,css}`
/// exactly, parameterized by `size` (bar height in pt) so the call site can
/// pick any scale.
///
/// The web glyph runs as a WAAPI animation whose effect easing (`ease-in-out`)
/// is applied to the cycle progress, then the per-bar keyframes are
/// interpolated linearly. That exact curve is baked here into a densely
/// sampled `CAKeyframeAnimation`, so Core Animation reproduces the same motion
/// (GPU-driven, no display-link bookkeeping).
private final class WaveProgressView: NSView {
    // Mirror of the TSX module constants.
    private static let barCount = 3
    private static let barWidthRatio: CGFloat = 0.15
    private static let gapToWidthRatio: CGFloat = 0.8
    private static let sideBarRatio = 0.5            // outer bars' rest scale
    private static let shrinkTo = 0.5                // middle bar's peak scale
    private static let cycleSeconds: CFTimeInterval = 0.96
    private static let pulseWindowRatio = 600.0 / 960.0
    private static let pulseStaggerRatio = 180.0 / 960.0
    private static let sampleCount = 120

    private let size: CGFloat
    private let barColor: NSColor
    private var barLayers: [CALayer] = []

    init(size: CGFloat, color: NSColor) {
        self.size = size
        self.barColor = color
        super.init(frame: NSRect(origin: .zero, size: WaveProgressView.intrinsicSize(for: size)))
        wantsLayer = true
        buildBars()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var intrinsicContentSize: NSSize { WaveProgressView.intrinsicSize(for: size) }

    private static func intrinsicSize(for size: CGFloat) -> NSSize {
        let barWidth = size * barWidthRatio
        let gap = barWidth * gapToWidthRatio
        let totalWidth = CGFloat(barCount) * barWidth + CGFloat(barCount - 1) * gap
        return NSSize(width: totalWidth, height: size)
    }

    // MARK: Geometry

    private func buildBars() {
        let barWidth = size * Self.barWidthRatio
        // CSS uses a fixed 1px radius at the canonical 16px size; scale it so
        // the corner softness reads the same at any size (capped at half-width).
        let radius = min(barWidth / 2, size / 16.0)
        let cg = barColor.cgColor
        for i in 0..<Self.barCount {
            let bar = CALayer()
            bar.backgroundColor = cg
            bar.cornerRadius = radius
            bar.bounds = CGRect(x: 0, y: 0, width: barWidth, height: size)
            bar.anchorPoint = CGPoint(x: 0.5, y: 0.5)
            // Seed the rest pose so the silhouette is correct before the
            // animation's first frame and after it is removed.
            bar.setValue(Self.barScales(i).rest, forKeyPath: "transform.scale.y")
            layer?.addSublayer(bar)
            barLayers.append(bar)
        }
        needsLayout = true
    }

    override func layout() {
        super.layout()
        let barWidth = size * Self.barWidthRatio
        let gap = barWidth * Self.gapToWidthRatio
        let totalWidth = CGFloat(Self.barCount) * barWidth + CGFloat(Self.barCount - 1) * gap
        let startX = (bounds.width - totalWidth) / 2
        let centerY = bounds.height / 2
        for (i, bar) in barLayers.enumerated() {
            let centerX = startX + CGFloat(i) * (barWidth + gap) + barWidth / 2
            bar.position = CGPoint(x: centerX, y: centerY)
        }
    }

    // MARK: Motion

    func startAnimating() {
        let n = Self.sampleCount
        for (i, bar) in barLayers.enumerated() {
            var values: [CGFloat] = []
            var keyTimes: [NSNumber] = []
            values.reserveCapacity(n)
            keyTimes.reserveCapacity(n)
            for k in 0..<n {
                let p = Double(k) / Double(n - 1)
                // WAAPI applies the effect easing to cycle progress first, then
                // interpolates the keyframes linearly at that transformed time.
                values.append(CGFloat(Self.waveValue(i, Self.easeInOut(p))))
                keyTimes.append(NSNumber(value: p))
            }
            let anim = CAKeyframeAnimation(keyPath: "transform.scale.y")
            anim.values = values
            anim.keyTimes = keyTimes
            anim.calculationMode = .linear
            anim.duration = Self.cycleSeconds
            anim.repeatCount = .infinity
            anim.isRemovedOnCompletion = false
            bar.add(anim, forKey: "wave")
        }
    }

    func stopAnimating() {
        for bar in barLayers { bar.removeAnimation(forKey: "wave") }
    }

    // MARK: Wave math (faithful to tug-progress-wave.tsx)

    /// Per-bar (rest, peak) scaleY pair. The middle bar sits tall and dips at
    /// the peak; the outer bars sit short and grow — the inverse motion is the
    /// wave.
    private static func barScales(_ index: Int) -> (rest: Double, peak: Double) {
        if index == 1 { return (1.0, shrinkTo) }
        return (sideBarRatio, 1.0)
    }

    /// scaleY for bar `index` at transformed (eased) cycle progress `q`.
    private static func waveValue(_ index: Int, _ q: Double) -> Double {
        let offset = Double(index) * pulseStaggerRatio
        let start = clamp01(offset)
        let mid = clamp01(offset + pulseWindowRatio / 2)
        let end = clamp01(offset + pulseWindowRatio)
        let s = barScales(index)
        if q <= start { return s.rest }
        if q < mid { return lerp(s.rest, s.peak, (q - start) / (mid - start)) }
        if q < end { return lerp(s.peak, s.rest, (q - mid) / (end - mid)) }
        return s.rest
    }

    private static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

    private static func clamp01(_ n: Double) -> Double { min(1, max(0, n)) }

    /// CSS `ease-in-out` == cubic-bezier(0.42, 0, 0.58, 1). Returns y for the
    /// given x via Newton-Raphson on the curve's x(t).
    private static func easeInOut(_ x: Double) -> Double {
        if x <= 0 { return 0 }
        if x >= 1 { return 1 }
        let x1 = 0.42, y1 = 0.0, x2 = 0.58, y2 = 1.0
        let cx = 3 * x1, bx = 3 * (x2 - x1) - 3 * x1, ax = 1 - 3 * x2 + 3 * x1
        let cy = 3 * y1, by = 3 * (y2 - y1) - 3 * y1, ay = 1 - 3 * y2 + 3 * y1
        func curveX(_ t: Double) -> Double { ((ax * t + bx) * t + cx) * t }
        func curveY(_ t: Double) -> Double { ((ay * t + by) * t + cy) * t }
        func dCurveX(_ t: Double) -> Double { (3 * ax * t + 2 * bx) * t + cx }
        var t = x
        for _ in 0..<8 {
            let err = curveX(t) - x
            if abs(err) < 1e-6 { break }
            let d = dCurveX(t)
            if abs(d) < 1e-6 { break }
            t -= err / d
        }
        return curveY(t)
    }
}

/// Main window containing the WKWebView for tugdeck dashboard
class MainWindow: NSWindow, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var containerView: NSView!
    private var spinnerView: NSView?
    private var contentController: WKUserContentController!
    private var devInfoOverlay: DevInfoOverlayView?
    private var devInfoLabel: NSTextField?
    weak var bridgeDelegate: BridgeDelegate?
    private var bridgeCleaned = false

    // MARK: - Page zoom (View > Actual Size / Zoom In / Zoom Out)
    //
    // The View menu's zoom commands drive `webView.pageZoom` directly —
    // the same machinery Safari's View > Zoom uses. Setting `pageZoom`
    // scales the entire page uniformly (layout, text, images, SVG) so
    // the web frontend doesn't need a parallel scaling system. The
    // user's chosen zoom persists to `UserDefaults` and is reapplied on
    // launch in `init`. Bounds and step match the menu's expectations:
    // 50%–200% in 10% increments.
    private static let pageZoomDefaultsKey = "WebViewPageZoom"
    static let minPageZoom: CGFloat = 0.5
    static let maxPageZoom: CGFloat = 2.0
    static let pageZoomStep: CGFloat = 0.1
    static let defaultPageZoom: CGFloat = 1.0

    /// Minimum content size the user can resize the window down to.
    /// Dev + the canvas need this much room to lay out without
    /// clipping the prompt area or stat row.
    static let minWindowSize = NSSize(width: 1200, height: 1000)

    /// Fraction of the main screen's visible frame that the default
    /// (first-launch) window occupies, and the cap applied to a
    /// restored frame at every subsequent launch. Visible frame
    /// excludes the menu bar and dock so 80% remains breathable.
    static let defaultScreenFraction: CGFloat = 0.8

    override init(contentRect: NSRect, styleMask style: NSWindow.StyleMask, backing backingStoreType: NSWindow.BackingStoreType, defer flag: Bool) {
        super.init(contentRect: contentRect, styleMask: style, backing: backingStoreType, defer: flag)

        self.title = "Tug"
        self.minSize = MainWindow.minWindowSize

        // Restore the window frame saved by AppKit under
        // `NSWindow Frame MainWindow` in NSUserDefaults, then apply
        // a fit-to-screen pass.
        //
        // - First launch (no saved frame): size to 80% of the main
        //   screen's visible frame (floored at `minWindowSize`) and
        //   center.
        // - Subsequent launches: restore, then clamp to 80% of the
        //   current main screen — covers the "moved from 27\" monitor
        //   back to laptop" case where the saved frame exceeds the
        //   new display.
        //
        // setFrameAutosaveName then registers automatic save-on-
        // move/resize.
        let autosaveName: NSWindow.FrameAutosaveName = "MainWindow"
        let restored = self.setFrameUsingName(autosaveName)
        MainWindow.applyScreenFitConstraints(to: self, restored: restored)
        self.setFrameAutosaveName(autosaveName)

        // Configure WKUserContentController for script message handlers
        contentController = WKUserContentController()
        contentController.add(self, name: "sourceTree")
        contentController.add(self, name: "choosePath")
        contentController.add(self, name: "setDevMode")
        contentController.add(self, name: "getSettings")
        contentController.add(self, name: "frontendReady")
        contentController.add(self, name: "setTheme")
        contentController.add(self, name: "devBadge")
        contentController.add(self, name: "clipboardRead")
        contentController.add(self, name: "cardList")
        contentController.add(self, name: "hmrUpdate")
        contentController.add(self, name: "openPath")
        contentController.add(self, name: "exportSession")

        // Configure WKWebView
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.userContentController = contentController

        // Allow localhost access
        if #available(macOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        #if DEBUG
        // Test harness: when TUGAPP_TEST_SOCKET is set, inject
        // `window.__tugTestMode = true` at atDocumentStart so
        // tugdeck's main.tsx sees the flag before its first script
        // tag executes. See Spec [#s05-wkuserscript-injection].
        if TestHarnessBridge.envSocketPath() != nil {
            TestHarnessUserScript.install(into: config)
        }
        #endif

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

        // Restore the user's last page-zoom selection from UserDefaults.
        // `object(forKey:)` returns nil for an unset key (first launch);
        // we leave `webView.pageZoom` at its default 1.0 in that case.
        // A persisted value outside the bounds (e.g. from a future range
        // change) is clamped, not discarded — the next zoom action
        // re-writes the clamped value back to defaults.
        if let saved = UserDefaults.standard.object(forKey: MainWindow.pageZoomDefaultsKey) as? Double {
            let clamped = max(MainWindow.minPageZoom, min(MainWindow.maxPageZoom, CGFloat(saved)))
            webView.pageZoom = clamped
        }

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
        // Uses Auto Layout so the stack stays centered regardless of the
        // window size restored from setFrameAutosaveName.
        let splashView = NSView(frame: containerView.bounds)
        splashView.autoresizingMask = [.width, .height]

        let iconSize: CGFloat = 128
        let iconView = NSImageView()
        iconView.translatesAutoresizingMaskIntoConstraints = false
        let icon = NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)
        icon.size = NSSize(width: iconSize, height: iconSize)
        iconView.image = icon
        iconView.imageScaling = .scaleNone

        // Determine light/dark appearance from the startup background color
        // so the wave renders with a fill that reads against the splash.
        let bgHex = MainWindow.resolveStartupBackgroundHex()
        let bgColor = NSColor(hexString: bgHex) ?? NSColor.black
        var brightness: CGFloat = 0
        bgColor.usingColorSpace(.sRGB)?.getHue(nil, saturation: nil, brightness: &brightness, alpha: nil)
        splashView.appearance = NSAppearance(named: brightness < 0.5 ? .darkAqua : .aqua)

        // Swift port of tugdeck's TugProgressWave (the in-app `wave` glyph),
        // scaled up for the launch interstitial in place of the stock spinner.
        let waveSize: CGFloat = 32
        let waveColor: NSColor = brightness < 0.5
            ? NSColor.white.withAlphaComponent(0.85)
            : NSColor.black.withAlphaComponent(0.85)
        let wave = WaveProgressView(size: waveSize, color: waveColor)
        wave.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [iconView, wave])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 20
        splashView.addSubview(stack)

        NSLayoutConstraint.activate([
            iconView.widthAnchor.constraint(equalToConstant: iconSize),
            iconView.heightAnchor.constraint(equalToConstant: iconSize),
            wave.widthAnchor.constraint(equalToConstant: wave.intrinsicContentSize.width),
            wave.heightAnchor.constraint(equalToConstant: waveSize),
            stack.centerXAnchor.constraint(equalTo: splashView.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: splashView.centerYAnchor),
        ])

        wave.startAnimating()
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

    // MARK: - Page zoom API

    /// Current zoom factor (1.0 == actual size).
    var currentPageZoom: CGFloat {
        return webView.pageZoom
    }

    /// Set page zoom to an exact value, clamped to [minPageZoom, maxPageZoom],
    /// and persist to UserDefaults so the choice survives across launches.
    func setPageZoom(_ zoom: CGFloat) {
        let clamped = max(MainWindow.minPageZoom, min(MainWindow.maxPageZoom, zoom))
        webView.pageZoom = clamped
        UserDefaults.standard.set(Double(clamped), forKey: MainWindow.pageZoomDefaultsKey)
    }

    /// Reset to 100%.
    func actualSize() {
        setPageZoom(MainWindow.defaultPageZoom)
    }

    /// Step up by one increment, capped at `maxPageZoom`.
    func zoomIn() {
        setPageZoom(currentPageZoom + MainWindow.pageZoomStep)
    }

    /// Step down by one increment, floored at `minPageZoom`.
    func zoomOut() {
        setPageZoom(currentPageZoom - MainWindow.pageZoomStep)
    }


    #if DEBUG
    /// Test-harness accessor: hand the live WKWebView to
    /// `TestHarnessBridge` so it can forward `evalJS` /
    /// `waitForCondition` RPCs. DEBUG-only.
    func testHarnessWebView() -> WKWebView {
        return webView
    }
    #endif

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

    /// Show or hide a small dev-info overlay in the bottom-left corner of
    /// the canvas. Pass an empty string to hide. Lazily constructs the
    /// overlay on first use.
    func setDevInfo(text: String) {
        if text.isEmpty {
            devInfoOverlay?.isHidden = true
            return
        }
        if devInfoOverlay == nil {
            let overlay = DevInfoOverlayView()
            overlay.translatesAutoresizingMaskIntoConstraints = false
            overlay.wantsLayer = true
            overlay.layer?.backgroundColor = NSColor(white: 0, alpha: 0.55).cgColor
            overlay.layer?.cornerRadius = 3

            let label = NSTextField(labelWithString: "")
            label.translatesAutoresizingMaskIntoConstraints = false
            label.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
            label.textColor = NSColor.white
            label.isBordered = false
            label.drawsBackground = false
            label.isEditable = false
            label.isSelectable = false
            overlay.addSubview(label)

            containerView.addSubview(overlay)
            NSLayoutConstraint.activate([
                label.topAnchor.constraint(equalTo: overlay.topAnchor, constant: 3),
                label.bottomAnchor.constraint(equalTo: overlay.bottomAnchor, constant: -3),
                label.leadingAnchor.constraint(equalTo: overlay.leadingAnchor, constant: 6),
                label.trailingAnchor.constraint(equalTo: overlay.trailingAnchor, constant: -6),
                overlay.leadingAnchor.constraint(equalTo: webView.leadingAnchor, constant: 8),
                overlay.bottomAnchor.constraint(equalTo: webView.bottomAnchor, constant: -8),
            ])
            devInfoOverlay = overlay
            devInfoLabel = label
        }
        devInfoLabel?.stringValue = text
        devInfoOverlay?.isHidden = false
    }

    /// Capture the current WebView content as a static snapshot and overlay it,
    /// so the user sees a frozen frame during shutdown instead of disconnect
    /// banners, theme flashes, or blank screens. The WebView stays alive
    /// underneath for `window.tugdeck.saveState()` to execute.
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
        contentController.removeScriptMessageHandler(forName: "choosePath")
        contentController.removeScriptMessageHandler(forName: "setDevMode")
        contentController.removeScriptMessageHandler(forName: "getSettings")
        contentController.removeScriptMessageHandler(forName: "frontendReady")
        contentController.removeScriptMessageHandler(forName: "setTheme")
        contentController.removeScriptMessageHandler(forName: "devBadge")
        contentController.removeScriptMessageHandler(forName: "clipboardRead")
        contentController.removeScriptMessageHandler(forName: "cardList")
        contentController.removeScriptMessageHandler(forName: "hmrUpdate")
        contentController.removeScriptMessageHandler(forName: "openPath")
        contentController.removeScriptMessageHandler(forName: "exportSession")
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

    /// Present the `/export` save panel ([#step-13c]) as a sheet on this
    /// window. The accessory File Format popup selects which content
    /// (markdown / JSON Lines) is written; the popup index — not the typed
    /// extension — is authoritative at write time. Calls back
    /// `onExportDone(id, "saved" | "canceled")`.
    private func presentExportPanel(requestId: String, baseName: String,
                                    markdown: String, jsonl: String) {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.title = "Export Session"
        panel.nameFieldLabel = "Export As:"
        panel.nameFieldStringValue = "\(baseName).md"

        let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 200, height: 25))
        popup.addItems(withTitles: ["Markdown", "JSON Lines"])
        popup.target = self
        popup.action = #selector(exportFormatChanged(_:))

        let label = NSTextField(labelWithString: "Format:")
        let stack = NSStackView(views: [label, popup])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.edgeInsets = NSEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        panel.accessoryView = stack

        panel.beginSheetModal(for: self) { [weak self] response in
            guard let self = self else { return }
            var result = "canceled"
            if response == .OK, let url = panel.url {
                let content = popup.indexOfSelectedItem == 0 ? markdown : jsonl
                do {
                    try content.write(to: url, atomically: true, encoding: .utf8)
                    result = "saved"
                } catch {
                    NSLog("MainWindow: export write failed: %@", error.localizedDescription)
                }
            }
            let idArg = self.escapeForJS(requestId)
            self.webView.evaluateJavaScript(
                "window.__tugBridge?.onExportDone?.('\(idArg)', '\(result)')"
            ) { _, error in
                if let error = error {
                    NSLog("MainWindow: evaluateJavaScript failed for exportSession: %@", error.localizedDescription)
                }
            }
        }
    }

    /// File Format popup changed — swap the save panel's filename extension to
    /// match (cosmetic; the popup index drives the written content at OK time).
    @objc private func exportFormatChanged(_ sender: NSPopUpButton) {
        guard let panel = sender.window as? NSSavePanel else { return }
        let ext = sender.indexOfSelectedItem == 0 ? "md" : "jsonl"
        let base = (panel.nameFieldStringValue as NSString).deletingPathExtension
        panel.nameFieldStringValue = "\(base).\(ext)"
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
        bridgeDelegate?.bridgePageDidLoad()
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
                self?.webView.evaluateJavaScript("window.tugdeck?.saveState?.()") { [weak self] _, _ in
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

    // MARK: - Screen-fit sizing

    /// Apply the dev/prod canvas sizing policy: first launch sizes
    /// to 80% of the main screen's visible frame and centers; every
    /// subsequent launch caps the restored frame to 80% of the
    /// current main screen so a "saved on big monitor, opened on
    /// laptop" frame is brought back on-screen.
    ///
    /// The target size is floored at `minWindowSize` so even tiny
    /// displays don't shrink the window below the usable minimum.
    static func applyScreenFitConstraints(to window: NSWindow, restored: Bool) {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else {
            if !restored {
                window.center()
            }
            return
        }
        let visible = screen.visibleFrame
        let targetW = max(visible.width * defaultScreenFraction, minWindowSize.width)
        let targetH = max(visible.height * defaultScreenFraction, minWindowSize.height)

        if restored {
            var frame = window.frame
            let clampedW = min(frame.size.width, targetW)
            let clampedH = min(frame.size.height, targetH)
            if clampedW != frame.size.width || clampedH != frame.size.height {
                frame.size = NSSize(width: clampedW, height: clampedH)
                window.setFrame(frame, display: false)
            }
        } else {
            var frame = window.frame
            frame.size = NSSize(width: targetW, height: targetH)
            window.setFrame(frame, display: false)
            window.center()
        }
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
        case "choosePath":
            // TugFileChooser "Browse…" picker. The web layer sends a request
            // id, an optional starting path, and a `kind` ("directory"|"file");
            // we open an NSOpenPanel and call back
            // window.__tugBridge.onPathChosen(id, path|null). The id lets
            // concurrent pickers resolve independently.
            guard let body = message.body as? [String: Any],
                  let requestId = body["id"] as? String else { return }
            let initialPath = body["initialPath"] as? String
            let kind = (body["kind"] as? String) ?? "directory"
            bridgeDelegate?.bridgeChoosePath(kind: kind, initialPath: initialPath) { [weak self] path in
                guard let self = self else { return }
                let idArg = self.escapeForJS(requestId)
                let pathArg: String
                if let path = path {
                    pathArg = "'\(self.escapeForJS(path))'"
                } else {
                    pathArg = "null"
                }
                self.webView.evaluateJavaScript("window.__tugBridge?.onPathChosen?.('\(idArg)', \(pathArg))") { _, error in
                    if let error = error {
                        NSLog("MainWindow: evaluateJavaScript failed for choosePath: %@", error.localizedDescription)
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
        case "openPath":
            // `/memory` ([#step-12a]) — hand a memory path to the OS. The web
            // layer sends a `~`-relative or absolute path plus a `kind`; we
            // expand the tilde (the web layer has no home dir) and route via
            // NSWorkspace. `kind == "file"`: open in the default editor,
            // CREATING it (with parent dirs) if absent — matching Claude
            // Code's "open memory" behavior so a not-yet-written CLAUDE.md
            // still opens to edit. `kind == "folder"`: open in Finder if it
            // exists, else reveal its parent (never auto-create a folder — a
            // wrong path must not mint an empty directory). No content
            // write-back; editing happens in the OS app.
            guard let body = message.body as? [String: Any],
                  let rawPath = body["path"] as? String, !rawPath.isEmpty else { return }
            let kind = (body["kind"] as? String) ?? "file"
            let expanded = (rawPath as NSString).expandingTildeInPath
            let url = URL(fileURLWithPath: expanded)
            let fm = FileManager.default
            if kind == "folder" {
                // Open the folder in Finder. If the exact path doesn't exist
                // (e.g. the auto-memory folder before claude has reported its
                // resolved cwd, so the encoding is still best-effort), walk up
                // to the deepest existing ancestor and open that — a useful
                // landing spot rather than a dead click. Never auto-create.
                var dir = url
                while !fm.fileExists(atPath: dir.path) && dir.pathComponents.count > 1 {
                    dir = dir.deletingLastPathComponent()
                }
                NSWorkspace.shared.open(dir)
            } else {
                if !fm.fileExists(atPath: expanded) {
                    try? fm.createDirectory(at: url.deletingLastPathComponent(),
                                            withIntermediateDirectories: true)
                    fm.createFile(atPath: expanded, contents: nil)
                }
                NSWorkspace.shared.open(url)
            }
        case "exportSession":
            // `/export` ([#step-13c]) — save the session transcript to a
            // user-chosen file. The web layer builds BOTH renderings
            // (markdown + JSON Lines) and sends them with a default base
            // name; the host runs an NSSavePanel whose File Format popup
            // chooses which content is written. Sibling of `openPath` (the
            // host owns the panel + file write; the content is the web
            // layer's). Calls back `onExportDone(id, "saved" | "canceled")`.
            guard let body = message.body as? [String: Any],
                  let requestId = body["id"] as? String else { return }
            let baseName = (body["baseName"] as? String) ?? "tug-session"
            let markdown = (body["markdown"] as? String) ?? ""
            let jsonl = (body["jsonl"] as? String) ?? ""
            presentExportPanel(requestId: requestId, baseName: baseName,
                               markdown: markdown, jsonl: jsonl)
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
        case "hmrUpdate":
            bridgeDelegate?.bridgeHmrUpdate()
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
