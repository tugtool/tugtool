#if DEBUG
import Foundation
import WebKit

// MARK: - TestHarnessConnection
//
// Per-connection NDJSON handler for the in-app test harness. Reads one
// JSON request per line, dispatches by `method`, writes one response
// per line. Single-client model — the listener only ever hands us one
// connection at a time.
//
// Dispatch table (Spec [#s01-rpc-protocol]):
//   - `version` — respond `{ id, ok: true, value: "1.0.0" }`
//   - `evalJS` — forward to `WKWebView.evaluateJavaScript`; hard
//     server-side timeout (default 5000ms). Script throws serialize
//     to `{ ok: false, error: { name: "EvalError", message, stack? } }`.
//   - `waitForCondition` — server-side poll loop calling
//     `evaluateJavaScript` at `pollMs ?? 16` intervals until truthy
//     or `timeoutMs ?? 2000` elapsed.
//
// `webView` is injected by the bridge at construction time; we call
// `evaluateJavaScript` on the main thread (WebKit contract).

final class TestHarnessConnection {
    /// Surface version reported by the `version` RPC. Must match
    /// `SURFACE_VERSION` in `tugdeck/src/test-surface.ts`.
    ///
    /// `1.1.0` (Step 2, 2026-04-24): adds native-gesture and
    /// keyboard verbs to the dispatch table (`nativeClick`,
    /// `nativeDoubleClick`, `nativeRightClick`, `nativeDrag`,
    /// `nativeMouseDown`, `nativeMouseUp`, `nativeKey`, `nativeType`,
    /// `holdModifier`). Existing `version` / `evalJS` /
    /// `waitForCondition` verbs unchanged. Major version still `1`,
    /// so harnesses built against `1.0.0` continue to handshake
    /// cleanly against `1.1.0` (minor version is additive).
    static let surfaceVersion = "1.1.0"

    private let fileHandle: FileHandle
    private var buffer = Data()
    private weak var webView: WKWebView?

    var onDisconnect: (() -> Void)?

    init(fd: Int32) {
        self.fileHandle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    /// Attach a WKWebView for `evalJS` / `waitForCondition` dispatch.
    /// Called by `TestHarnessBridge` after the MainWindow is up.
    func attach(webView: WKWebView) {
        self.webView = webView
        startReading()
    }

    /// Start reading NDJSON from the client. Called once the webView
    /// is attached so we never try to dispatch before there's anything
    /// to evaluate against.
    private func startReading() {
        fileHandle.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                // EOF
                DispatchQueue.main.async { self?.onDisconnect?() }
                handle.readabilityHandler = nil
                return
            }
            self?.processData(data)
        }
    }

    private func processData(_ data: Data) {
        buffer.append(data)
        while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let lineData = buffer[buffer.startIndex..<newlineIndex]
            buffer = Data(buffer[(newlineIndex + 1)...])
            dispatchLine(Data(lineData))
        }
    }

    private func dispatchLine(_ line: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
            // Malformed line — cannot extract an id; log and drop.
            NSLog("tughost.test-harness.malformed-request")
            return
        }
        guard let id = obj["id"] as? Int,
              let method = obj["method"] as? String else {
            NSLog("tughost.test-harness.missing-id-or-method")
            return
        }

        switch method {
        case "version":
            respond(id: id, ok: true, payload: ["value": Self.surfaceVersion])
        case "evalJS":
            guard let script = obj["script"] as? String else {
                respondError(id: id, name: "ProtocolError", message: "evalJS: missing 'script'")
                return
            }
            let timeoutMs = (obj["timeoutMs"] as? Int) ?? 5000
            dispatchEvalJS(id: id, script: script, timeoutMs: timeoutMs)
        case "waitForCondition":
            guard let script = obj["script"] as? String else {
                respondError(id: id, name: "ProtocolError", message: "waitForCondition: missing 'script'")
                return
            }
            let timeoutMs = (obj["timeoutMs"] as? Int) ?? 2000
            let pollMs = (obj["pollMs"] as? Int) ?? 16
            dispatchWaitForCondition(id: id, script: script, timeoutMs: timeoutMs, pollMs: pollMs)
        case "nativeClick",
             "nativeDoubleClick",
             "nativeRightClick",
             "nativeDrag",
             "nativeMouseDown",
             "nativeMouseUp",
             "nativeKey",
             "nativeType",
             "holdModifier":
            dispatchNativeVerb(id: id, verbObj: obj)
        default:
            respondError(id: id, name: "NotImplemented", message: "Unknown method: \(method)")
        }
    }

    // MARK: - Native verbs (Spec [#s01-hardware-rpc], Step 2)

    /// Top-level dispatch for the native-event verb family. Builds a
    /// `NativeEventHandlers` instance, runs the verb on the main
    /// thread, and writes a single response based on the outcome.
    ///
    /// Every native verb bounces through `DispatchQueue.main.async`
    /// — the verbs touch `NSApp.activate`, `CGEvent.post`, and the
    /// shared `webView` reference, all of which require the main
    /// thread (Cocoa contract). The Bun-side `waitForCondition`
    /// that follows most verb calls also runs against the same
    /// main-thread `evaluateJavaScript` path, so queuing in order
    /// keeps event delivery and JS polling naturally sequenced.
    private func dispatchNativeVerb(id: Int, verbObj: [String: Any]) {
        guard let webView = webView else {
            respondError(id: id, name: "AppCrashedError", message: "WKWebView unavailable")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let handlers = NativeEventHandlers(webView: webView)
            do {
                try self.executeNativeVerb(verbObj, handlers: handlers)
                self.respond(id: id, ok: true, payload: ["value": NSNull()])
            } catch let error as NativeEventError {
                self.respondError(id: id, name: error.wireName, message: error.description)
            } catch {
                self.respondError(
                    id: id,
                    name: "NativeEventError",
                    message: "\(error)",
                )
            }
        }
    }

    /// Execute a single native verb given its wire-form JSON and a
    /// pre-built `NativeEventHandlers`. Throws `NativeEventError`
    /// for typed failures; callers (top-level dispatch OR
    /// `holdModifier`'s inner-verb loop) translate to RPC responses.
    ///
    /// Two callers:
    ///   1. `dispatchNativeVerb` — top-level; writes a response.
    ///   2. `executeHoldModifier` — inner; re-throws so the parent's
    ///      response reflects any inner failure, with the modifier-
    ///      release `defer` still running to avoid stuck modifiers.
    fileprivate func executeNativeVerb(
        _ verbObj: [String: Any],
        handlers: NativeEventHandlers,
    ) throws {
        guard let method = verbObj["method"] as? String else {
            throw NativeEventError.protocolError("missing 'method' in inner verb")
        }

        switch method {
        case "nativeClick":
            let vp = try Self.parsePoint(verbObj["viewportPoint"], field: "viewportPoint")
            let button = try Self.parseButton(verbObj["button"])
            let clickCount = (verbObj["clickCount"] as? Int) ?? 1
            let downDelay = (verbObj["mouseDownDelayMs"] as? Int) ?? 20
            let upDelay = (verbObj["mouseUpDelayMs"] as? Int) ?? 20
            try handlers.nativeClick(
                viewportPoint: vp,
                button: button,
                clickCount: clickCount,
                mouseDownDelayMs: downDelay,
                mouseUpDelayMs: upDelay,
            )

        case "nativeDoubleClick":
            let vp = try Self.parsePoint(verbObj["viewportPoint"], field: "viewportPoint")
            let button = try Self.parseButton(verbObj["button"])
            try handlers.nativeDoubleClick(viewportPoint: vp, button: button)

        case "nativeRightClick":
            let vp = try Self.parsePoint(verbObj["viewportPoint"], field: "viewportPoint")
            try handlers.nativeRightClick(viewportPoint: vp)

        case "nativeDrag":
            let from = try Self.parsePoint(verbObj["from"], field: "from")
            let to = try Self.parsePoint(verbObj["to"], field: "to")
            let button = try Self.parseButton(verbObj["button"])
            let downDelay = (verbObj["mouseDownDelayMs"] as? Int) ?? 20
            let upDelay = (verbObj["mouseUpDelayMs"] as? Int) ?? 20
            try handlers.nativeDrag(
                from: from,
                to: to,
                button: button,
                mouseDownDelayMs: downDelay,
                mouseUpDelayMs: upDelay,
            )

        case "nativeMouseDown":
            let vp = try Self.parsePoint(verbObj["viewportPoint"], field: "viewportPoint")
            let button = try Self.parseButton(verbObj["button"])
            try handlers.nativeMouseDown(viewportPoint: vp, button: button)

        case "nativeMouseUp":
            let vp = try Self.parsePoint(verbObj["viewportPoint"], field: "viewportPoint")
            let button = try Self.parseButton(verbObj["button"])
            try handlers.nativeMouseUp(viewportPoint: vp, button: button)

        case "nativeKey":
            guard let key = verbObj["key"] as? String else {
                throw NativeEventError.protocolError("nativeKey: missing 'key'")
            }
            let modifiers = try Self.parseModifiers(verbObj["modifiers"])
            try handlers.nativeKey(key: key, modifiers: modifiers)

        case "nativeType":
            guard let text = verbObj["text"] as? String else {
                throw NativeEventError.protocolError("nativeType: missing 'text'")
            }
            try handlers.nativeType(text: text)

        case "holdModifier":
            try executeHoldModifier(verbObj: verbObj, handlers: handlers)

        default:
            throw NativeEventError.protocolError(
                "unsupported inner verb method: \"\(method)\"",
            )
        }
    }

    /// Press the requested modifiers, dispatch each inner verb in
    /// order via `executeNativeVerb` (recursive), release modifiers
    /// in reverse order. Inner-verb failures propagate up; the
    /// modifier release still runs via `defer` inside
    /// `handlers.holdModifier`, so a failed inner leaves no modifier
    /// held.
    ///
    /// Recursion depth is bounded in practice (inner `holdModifier`
    /// scopes are unusual for test harnesses), but we don't enforce
    /// a depth limit — a test that hits infinite recursion crashes
    /// with a stack overflow and the test author notices.
    private func executeHoldModifier(
        verbObj: [String: Any],
        handlers: NativeEventHandlers,
    ) throws {
        let modifiers = try Self.parseModifiers(verbObj["modifiers"])
        guard let innerVerbs = verbObj["innerVerbs"] as? [[String: Any]] else {
            throw NativeEventError.protocolError(
                "holdModifier: missing 'innerVerbs' (expected array of verb objects)",
            )
        }
        try handlers.holdModifier(modifiers: modifiers) { [self] in
            for inner in innerVerbs {
                try self.executeNativeVerb(inner, handlers: handlers)
            }
        }
    }

    // MARK: - Native verb arg parsers

    /// Parse a `{ x, y }` point from a wire dict. Accepts both
    /// `NSNumber`-backed JSON numbers and Swift `Double`s — both
    /// shapes survive `JSONSerialization` depending on magnitude
    /// and fractional part.
    private static func parsePoint(_ raw: Any?, field: String) throws -> CGPoint {
        guard let dict = raw as? [String: Any] else {
            throw NativeEventError.protocolError(
                "missing or malformed '\(field)' (expected {x, y} object)",
            )
        }
        let xNum = (dict["x"] as? NSNumber)?.doubleValue ?? (dict["x"] as? Double)
        let yNum = (dict["y"] as? NSNumber)?.doubleValue ?? (dict["y"] as? Double)
        guard let x = xNum, let y = yNum else {
            throw NativeEventError.protocolError(
                "'\(field)' missing x/y numeric fields",
            )
        }
        return CGPoint(x: x, y: y)
    }

    /// Parse a `"left"` / `"right"` button string. Missing field
    /// defaults to `.left` so bare click/drag calls don't need to
    /// specify it.
    private static func parseButton(_ raw: Any?) throws -> MouseButton {
        guard let str = raw as? String else {
            return .left
        }
        guard let button = MouseButton(rawValue: str) else {
            throw NativeEventError.protocolError(
                "invalid button \"\(str)\" (expected \"left\" or \"right\")",
            )
        }
        return button
    }

    /// Parse an array of modifier names into `[ModifierKey]`. Missing
    /// field defaults to an empty array.
    private static func parseModifiers(_ raw: Any?) throws -> [ModifierKey] {
        guard let arr = raw as? [String] else {
            if raw == nil {
                return []
            }
            throw NativeEventError.protocolError(
                "'modifiers' must be an array of strings (cmd/shift/alt/ctrl)",
            )
        }
        return try arr.map { name in
            guard let mod = ModifierKey(rawValue: name) else {
                throw NativeEventError.protocolError(
                    "invalid modifier \"\(name)\" (expected one of: cmd, shift, alt, ctrl)",
                )
            }
            return mod
        }
    }

    // MARK: - evalJS

    private func dispatchEvalJS(id: Int, script: String, timeoutMs: Int) {
        guard let webView = webView else {
            respondError(id: id, name: "AppCrashedError", message: "WKWebView unavailable")
            return
        }
        let completionState = EvalCompletionState()
        DispatchQueue.main.async {
            webView.evaluateJavaScript(script) { [weak self] result, error in
                guard let self = self else { return }
                guard completionState.markCompleted() else {
                    return // Timer already fired; drop the belated completion.
                }
                if let error = error as NSError? {
                    // `localizedDescription` is always the generic
                    // "A JavaScript exception occurred"; the useful
                    // details live in the WKJavaScriptException* keys.
                    let jsMessage = error.userInfo["WKJavaScriptExceptionMessage"] as? String
                    let line = error.userInfo["WKJavaScriptExceptionLineNumber"] as? Int
                    let column = error.userInfo["WKJavaScriptExceptionColumnNumber"] as? Int
                    let detailed: String
                    if let jsMessage = jsMessage {
                        if let line = line, let column = column {
                            detailed = "\(jsMessage) (line \(line), col \(column))"
                        } else {
                            detailed = jsMessage
                        }
                    } else {
                        detailed = error.localizedDescription
                    }
                    self.respondError(
                        id: id,
                        name: "EvalError",
                        message: detailed,
                        stack: error.userInfo["WKJavaScriptExceptionStackTrace"] as? String
                    )
                    return
                }
                self.respondWithSerialized(id: id, jsValue: result)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) { [weak self] in
            guard let self = self else { return }
            guard completionState.markTimedOut() else { return }
            self.respondError(
                id: id,
                name: "TimeoutError",
                message: "evalJS exceeded \(timeoutMs)ms"
            )
        }
    }

    // MARK: - waitForCondition

    private func dispatchWaitForCondition(id: Int, script: String, timeoutMs: Int, pollMs: Int) {
        guard let webView = webView else {
            respondError(id: id, name: "AppCrashedError", message: "WKWebView unavailable")
            return
        }
        let pollState = PollState()
        let deadline = DispatchTime.now() + .milliseconds(timeoutMs)

        func poll() {
            guard !pollState.isCompleted else { return }
            if DispatchTime.now() >= deadline {
                guard pollState.markCompleted() else { return }
                respondError(
                    id: id,
                    name: "TimeoutError",
                    message: "waitForCondition exceeded \(timeoutMs)ms"
                )
                return
            }
            DispatchQueue.main.async {
                webView.evaluateJavaScript(script) { [weak self] result, error in
                    guard let self = self else { return }
                    if pollState.isCompleted { return }
                    if let error = error as NSError? {
                        guard pollState.markCompleted() else { return }
                        self.respondError(
                            id: id,
                            name: "EvalError",
                            message: error.localizedDescription
                        )
                        return
                    }
                    if Self.isTruthy(result) {
                        guard pollState.markCompleted() else { return }
                        self.respondWithSerialized(id: id, jsValue: result)
                        return
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(pollMs)) {
                        poll()
                    }
                }
            }
        }
        poll()
    }

    /// JS truthiness for the values `evaluateJavaScript` returns.
    /// Returns `false` for nil, `NSNull`, `false`, `0`, `""`.
    static func isTruthy(_ value: Any?) -> Bool {
        guard let v = value else { return false }
        if v is NSNull { return false }
        if let b = v as? Bool { return b }
        if let n = v as? NSNumber {
            // NSNumber may carry a boolean; treat 0 and false as falsy.
            if CFNumberGetType(n) == .charType { return n.boolValue }
            return n.doubleValue != 0
        }
        if let s = v as? String { return !s.isEmpty }
        return true
    }

    // MARK: - Response writers

    private func respond(id: Int, ok: Bool, payload: [String: Any]) {
        var obj: [String: Any] = ["id": id, "ok": ok]
        for (k, v) in payload { obj[k] = v }
        guard let jsonData = try? JSONSerialization.data(withJSONObject: obj),
              var payloadStr = String(data: jsonData, encoding: .utf8) else {
            NSLog("tughost.test-harness.response-serialize-failed id=%d", id)
            return
        }
        payloadStr.append("\n")
        if let data = payloadStr.data(using: .utf8) {
            fileHandle.write(data)
        }
    }

    private func respondError(id: Int, name: String, message: String, stack: String? = nil) {
        var error: [String: Any] = ["name": name, "message": message]
        if let stack = stack { error["stack"] = stack }
        respond(id: id, ok: false, payload: ["error": error])
    }

    /// Serialize a JS return value into the `{ ok: true, value }`
    /// shape. Non-serializable values become `SerializationError`.
    private func respondWithSerialized(id: Int, jsValue: Any?) {
        let normalized: Any = jsValue ?? NSNull()
        // JSONSerialization accepts only arrays or dictionaries at the
        // top level; wrap into a dictionary so we can extract the
        // encoded scalar safely.
        let wrapper: [String: Any] = ["value": normalized]
        if !JSONSerialization.isValidJSONObject(wrapper) {
            respondError(
                id: id,
                name: "SerializationError",
                message: "evalJS return value is not JSON-serializable"
            )
            return
        }
        respond(id: id, ok: true, payload: ["value": normalized])
    }

    func close() {
        fileHandle.readabilityHandler = nil
        fileHandle.closeFile()
    }
}

// MARK: - Completion-state guards
//
// Both `evalJS` and `waitForCondition` have a race between a timer
// (fires timeout) and a completion handler (fires value/error). We
// need exactly one winner; the loser drops silently.

private final class EvalCompletionState {
    private var completed = false
    private let lock = NSLock()

    /// Returns true if we won the race to report completion.
    func markCompleted() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if completed { return false }
        completed = true
        return true
    }

    func markTimedOut() -> Bool { markCompleted() }
}

private final class PollState {
    private var completed = false
    private let lock = NSLock()

    var isCompleted: Bool {
        lock.lock()
        defer { lock.unlock() }
        return completed
    }

    func markCompleted() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if completed { return false }
        completed = true
        return true
    }
}
#endif
