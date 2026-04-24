#if DEBUG
import AppKit
import CoreGraphics
import Foundation
import WebKit

// MARK: - NativeEventHandlers
//
// Phase A native-gesture + keyboard handler set. Every verb in this
// file posts trusted Quartz events via `CGEvent.post(tap: .cgSessionEventTap)`
// ([D02]) using a per-instance `CGEventSource(stateID: .combinedSessionState)`
// ([Q05]). Gestures run on the main thread; callers (the dispatch
// table in `TestHarnessConnection`) bounce through `DispatchQueue.main.async`.
//
// ## Why this shape
//
// - Single `CGEventSource` per handler instance: the source's state
//   table tracks modifier-key state across events posted through it.
//   Reusing one source across the events of a `holdModifier` scope
//   is what makes the modifier flags register coherently on inner
//   events. Per [Q05] and the Apple docs for `CGEventCreateKeyboardEvent`.
// - `NSApp.activate(ignoringOtherApps: true)` at gesture start:
//   CGEvent mouse events route via windowserver based on which
//   window is at the target screen coord AND is frontmost in
//   z-order. `open -n -W` (the [D13] launcher) leaves Tug.app
//   active-but-not-frontmost in some contexts; activating here
//   makes click delivery deterministic.
// - `viewportPoint` (CSS, Y-down) in / `CGPoint` screen-CG out via
//   `CoordMapping.viewportToScreen`: callers never pass screen coords
//   directly. Out-of-bounds → `NativeEventError.coordinateOutOfBounds`
//   → `CoordinateOutOfBoundsError` at the RPC boundary.
// - Endpoint-only drag per the 2026-04-24 user call ("endpoints
//   should be enough; carefully written plans can get us what we
//   need"). No interpolated move trail.

// MARK: - Constants

/// Pinned inter-click interval for `nativeDoubleClick`. Deliberately
/// shorter than macOS's default double-click threshold (which is
/// user-configurable via `NSEvent.doubleClickInterval`, defaulting
/// to ~500ms) so WebKit never interprets the two clicks as slow
/// single-clicks. 80ms is within WebKit's default-click-accumulation
/// window on all tested macOS versions.
let NATIVE_DOUBLE_CLICK_INTERVAL_MS: Int = 80

// MARK: - Enums

enum MouseButton: String {
    case left
    case right

    var downType: CGEventType {
        switch self {
        case .left: return .leftMouseDown
        case .right: return .rightMouseDown
        }
    }

    var upType: CGEventType {
        switch self {
        case .left: return .leftMouseUp
        case .right: return .rightMouseUp
        }
    }

    var draggedType: CGEventType {
        switch self {
        case .left: return .leftMouseDragged
        case .right: return .rightMouseDragged
        }
    }

    var cgButton: CGMouseButton {
        switch self {
        case .left: return .left
        case .right: return .right
        }
    }
}

enum ModifierKey: String {
    case cmd
    case shift
    case alt
    case ctrl

    /// Mac `kVK_*` virtual keycode for the modifier's physical key.
    /// Values from `<Carbon/HIToolbox/Events.h>`:
    /// `kVK_Command=0x37`, `kVK_Shift=0x38`, `kVK_Option=0x3A`,
    /// `kVK_Control=0x3B`.
    var keyCode: CGKeyCode {
        switch self {
        case .cmd: return 0x37
        case .shift: return 0x38
        case .alt: return 0x3A
        case .ctrl: return 0x3B
        }
    }
}

// MARK: - Errors

enum NativeEventError: Error, CustomStringConvertible {
    case coordinateOutOfBounds(CGPoint)
    case unknownKey(String)
    case asciiOnly(String)
    case eventCreationFailed(String)
    case webViewUnavailable
    case protocolError(String)

    var description: String {
        switch self {
        case .coordinateOutOfBounds(let p):
            return "viewport coordinate (\(p.x), \(p.y)) is outside the WKWebView's visible frame"
        case .unknownKey(let name):
            return "unknown key name: \"\(name)\" (no entry in VirtualKeyMap)"
        case .asciiOnly(let excerpt):
            return "nativeType accepts US-ASCII only; first non-ASCII code unit: \"\(excerpt)\""
        case .eventCreationFailed(let what):
            return "CGEvent constructor returned nil for \(what)"
        case .webViewUnavailable:
            return "WKWebView unavailable (the harness connection has been torn down)"
        case .protocolError(let message):
            return "protocol error: \(message)"
        }
    }

    /// The error `name` reported over the RPC wire. Matched client-
    /// side in `tests/in-app/_harness/rpc.ts`'s `translateError`.
    var wireName: String {
        switch self {
        case .coordinateOutOfBounds: return "CoordinateOutOfBoundsError"
        case .unknownKey: return "UnknownKeyError"
        case .asciiOnly: return "NativeTypeAsciiOnlyError"
        case .eventCreationFailed: return "NativeEventError"
        case .webViewUnavailable: return "AppCrashedError"
        case .protocolError: return "ProtocolError"
        }
    }
}

// MARK: - Handler

final class NativeEventHandlers {

    // Weak so teardown of the connection doesn't keep the WKWebView
    // alive; handlers are short-lived anyway (one per request) so the
    // window of use is tiny.
    private weak var webView: WKWebView?
    private let source: CGEventSource?

    init(webView: WKWebView) {
        self.webView = webView
        // [Q05] — login-session source. Tracks modifier state across
        // all events posted through it; auto-stamps flags on events
        // that follow a held-modifier keyDown.
        self.source = CGEventSource(stateID: .combinedSessionState)
    }

    // MARK: - Click

    /// Post a click at `viewportPoint` via the chosen variant. A
    /// `clickCount > 1` sets `.mouseEventClickState` on both the down
    /// and up events — lets WebKit recognize the event as part of a
    /// multi-click sequence without requiring the caller to post
    /// multiple pairs (Step 3 uses `nativeDoubleClick` for that).
    ///
    /// `mouseDownDelayMs` sleeps the main thread between the down
    /// and up events; `mouseUpDelayMs` sleeps after the up. Both
    /// default to 20ms — enough for WebKit to process the events
    /// in order without racing the test's next RPC.
    func nativeClick(
        viewportPoint: CGPoint,
        button: MouseButton = .left,
        clickCount: Int = 1,
        mouseDownDelayMs: Int = 20,
        mouseUpDelayMs: Int = 20,
    ) throws {
        activateSelf()
        let screenPoint = try resolveScreenPoint(viewportPoint)

        guard let down = CGEvent(
            mouseEventSource: source,
            mouseType: button.downType,
            mouseCursorPosition: screenPoint,
            mouseButton: button.cgButton,
        ) else {
            throw NativeEventError.eventCreationFailed("mouseDown")
        }
        guard let up = CGEvent(
            mouseEventSource: source,
            mouseType: button.upType,
            mouseCursorPosition: screenPoint,
            mouseButton: button.cgButton,
        ) else {
            throw NativeEventError.eventCreationFailed("mouseUp")
        }
        if clickCount > 1 {
            down.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
            up.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
        }

        down.post(tap: .cgSessionEventTap)
        sleepMs(mouseDownDelayMs)
        up.post(tap: .cgSessionEventTap)
        sleepMs(mouseUpDelayMs)
    }

    /// Convenience: two click pairs separated by the pinned interval,
    /// with `clickState` progressing 1 → 2 (WebKit's accumulator).
    func nativeDoubleClick(
        viewportPoint: CGPoint,
        button: MouseButton = .left,
    ) throws {
        try nativeClick(
            viewportPoint: viewportPoint,
            button: button,
            clickCount: 1,
            mouseDownDelayMs: 20,
            mouseUpDelayMs: 0,
        )
        sleepMs(NATIVE_DOUBLE_CLICK_INTERVAL_MS)
        try nativeClick(
            viewportPoint: viewportPoint,
            button: button,
            clickCount: 2,
            mouseDownDelayMs: 20,
            mouseUpDelayMs: 20,
        )
    }

    /// Convenience: right-button click for context-menu paths.
    func nativeRightClick(viewportPoint: CGPoint) throws {
        try nativeClick(
            viewportPoint: viewportPoint,
            button: .right,
            clickCount: 1,
            mouseDownDelayMs: 20,
            mouseUpDelayMs: 20,
        )
    }

    // MARK: - Drag (endpoint-only)

    /// Post an endpoint-only drag: `mouseDown` at `from`, one
    /// `mouseDragged` event at `to`, `mouseUp` at `to`. No
    /// interpolation — per the 2026-04-24 user call, endpoint
    /// semantics are enough for every Phase C scenario.
    ///
    /// Both `from` and `to` must lie inside the WKWebView's
    /// viewport; either being out-of-bounds fails fast with
    /// `coordinateOutOfBounds` before any events are posted.
    func nativeDrag(
        from: CGPoint,
        to: CGPoint,
        button: MouseButton = .left,
        mouseDownDelayMs: Int = 20,
        mouseUpDelayMs: Int = 20,
    ) throws {
        activateSelf()
        let fromScreen = try resolveScreenPoint(from)
        let toScreen = try resolveScreenPoint(to)

        guard let down = CGEvent(
            mouseEventSource: source,
            mouseType: button.downType,
            mouseCursorPosition: fromScreen,
            mouseButton: button.cgButton,
        ) else {
            throw NativeEventError.eventCreationFailed("drag mouseDown")
        }
        guard let dragged = CGEvent(
            mouseEventSource: source,
            mouseType: button.draggedType,
            mouseCursorPosition: toScreen,
            mouseButton: button.cgButton,
        ) else {
            throw NativeEventError.eventCreationFailed("drag mouseDragged")
        }
        guard let up = CGEvent(
            mouseEventSource: source,
            mouseType: button.upType,
            mouseCursorPosition: toScreen,
            mouseButton: button.cgButton,
        ) else {
            throw NativeEventError.eventCreationFailed("drag mouseUp")
        }

        down.post(tap: .cgSessionEventTap)
        sleepMs(mouseDownDelayMs)
        dragged.post(tap: .cgSessionEventTap)
        up.post(tap: .cgSessionEventTap)
        sleepMs(mouseUpDelayMs)
    }

    // MARK: - Mouse primitives

    /// Individual mouse-down half. Only needed for niche scenarios
    /// (hover-while-modifier-held, modal-dismiss patterns) where
    /// `holdModifier` + click is not enough. Tests should prefer
    /// `nativeClick` / `nativeDrag`.
    func nativeMouseDown(
        viewportPoint: CGPoint,
        button: MouseButton = .left,
    ) throws {
        activateSelf()
        let screenPoint = try resolveScreenPoint(viewportPoint)
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: button.downType,
            mouseCursorPosition: screenPoint,
            mouseButton: button.cgButton,
        ) else {
            throw NativeEventError.eventCreationFailed("mouseDown")
        }
        event.post(tap: .cgSessionEventTap)
    }

    /// Individual mouse-up half. See `nativeMouseDown` caveats.
    func nativeMouseUp(
        viewportPoint: CGPoint,
        button: MouseButton = .left,
    ) throws {
        activateSelf()
        let screenPoint = try resolveScreenPoint(viewportPoint)
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: button.upType,
            mouseCursorPosition: screenPoint,
            mouseButton: button.cgButton,
        ) else {
            throw NativeEventError.eventCreationFailed("mouseUp")
        }
        event.post(tap: .cgSessionEventTap)
    }

    // MARK: - Keyboard

    /// Post a single keystroke with optional modifiers. `key` is an
    /// entry in `VirtualKeyMap` (ASCII char or named key like
    /// `"ArrowLeft"`). Modifiers are posted via `holdModifier`, so
    /// the single `CGEventSource` instance tracks their state during
    /// the keystroke.
    ///
    /// If the key itself requires Shift (e.g. `"A"`, `"!"`) AND
    /// Shift is not already in `modifiers`, we press it transparently
    /// around the keystroke. Call sites that want explicit control
    /// over Shift can pass `.shift` in `modifiers`.
    func nativeKey(key: String, modifiers: [ModifierKey] = []) throws {
        activateSelf()
        guard let mapping = VirtualKeyMap.lookup(key) else {
            throw NativeEventError.unknownKey(key)
        }
        // Inner closure does not throw (postKeyEvent returns void),
        // so the `rethrows` on `holdModifier` doesn't fire — no `try`
        // on this call.
        holdModifier(modifiers: modifiers) { [self] in
            let shiftOverride = mapping.needsShift && !modifiers.contains(.shift)
            if shiftOverride {
                postKeyEvent(keyCode: ModifierKey.shift.keyCode, keyDown: true)
            }
            postKeyEvent(keyCode: mapping.keyCode, keyDown: true)
            postKeyEvent(keyCode: mapping.keyCode, keyDown: false)
            if shiftOverride {
                postKeyEvent(keyCode: ModifierKey.shift.keyCode, keyDown: false)
            }
        }
    }

    /// Type an ASCII string via a sequence of keystrokes. Non-ASCII
    /// input is rejected up-front (before any events are posted) so
    /// the caller sees a typed error instead of a partial typing.
    func nativeType(text: String) throws {
        activateSelf()
        // Reject non-ASCII before posting anything. Inspect the
        // first offending scalar so the error message is actionable.
        for scalar in text.unicodeScalars {
            if !scalar.isASCII {
                let excerpt = String(scalar)
                throw NativeEventError.asciiOnly(excerpt)
            }
        }
        // Each grapheme-cluster is a single printable character here
        // (we already rejected non-ASCII), so iterating `text` (not
        // `text.unicodeScalars`) is safe. Named keys like "Enter"
        // cannot be expressed as single chars; callers use
        // `nativeKey("Enter")` for those.
        for char in text {
            let name = String(char)
            guard let mapping = VirtualKeyMap.lookup(name) else {
                throw NativeEventError.unknownKey(name)
            }
            if mapping.needsShift {
                postKeyEvent(keyCode: ModifierKey.shift.keyCode, keyDown: true)
            }
            postKeyEvent(keyCode: mapping.keyCode, keyDown: true)
            postKeyEvent(keyCode: mapping.keyCode, keyDown: false)
            if mapping.needsShift {
                postKeyEvent(keyCode: ModifierKey.shift.keyCode, keyDown: false)
            }
        }
    }

    /// Press the given modifiers in order, run `inner`, release them
    /// in reverse order. `defer` ensures modifiers are released even
    /// if `inner` throws — no danger of a stuck modifier bleeding
    /// into the next test. Uses the same `CGEventSource` for press
    /// and release so the source's modifier state stays coherent.
    func holdModifier(
        modifiers: [ModifierKey],
        inner: () throws -> Void,
    ) rethrows {
        if !modifiers.isEmpty {
            activateSelf()
        }
        for mod in modifiers {
            postKeyEvent(keyCode: mod.keyCode, keyDown: true)
        }
        defer {
            for mod in modifiers.reversed() {
                postKeyEvent(keyCode: mod.keyCode, keyDown: false)
            }
        }
        try inner()
    }

    // MARK: - Helpers

    /// Raise Tug.app to frontmost. CGEvent mouse events route via
    /// windowserver → frontmost window at the target screen coord,
    /// so Tug.app must be on top for clicks to land on its WKWebView.
    private func activateSelf() {
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Resolve a viewport (CSS) coord to screen CG, or throw
    /// `coordinateOutOfBounds`.
    private func resolveScreenPoint(_ viewport: CGPoint) throws -> CGPoint {
        guard let webView = self.webView else {
            throw NativeEventError.webViewUnavailable
        }
        guard let screenPoint = CoordMapping.viewportToScreen(viewport, in: webView) else {
            throw NativeEventError.coordinateOutOfBounds(viewport)
        }
        return screenPoint
    }

    /// Post a plain keyDown or keyUp for `keyCode` via the handler's
    /// shared `CGEventSource`. Per [Q05], NO manual `.flags` setter
    /// and NO `type = .flagsChanged` override — the source's state
    /// table auto-stamps flags on events posted after a modifier
    /// keyDown.
    private func postKeyEvent(keyCode: CGKeyCode, keyDown: Bool) {
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: keyCode,
            keyDown: keyDown,
        ) else {
            // Non-fatal: log and continue. The caller's inner verb
            // may still succeed if this event was ancillary (e.g. a
            // Shift release that failed to build).
            NSLog("tughost.native.postKeyEvent.failed keyCode=0x%02X keyDown=%@",
                  keyCode, keyDown ? "true" : "false")
            return
        }
        event.post(tap: .cgSessionEventTap)
    }

    /// Sleep the main thread. Used between event posts to give WebKit
    /// time to dispatch the prior event before the next one arrives.
    /// No-op for `ms <= 0`.
    private func sleepMs(_ ms: Int) {
        guard ms > 0 else { return }
        Thread.sleep(forTimeInterval: Double(ms) / 1000.0)
    }
}
#endif
