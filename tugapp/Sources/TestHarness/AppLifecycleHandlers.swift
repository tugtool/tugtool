#if DEBUG
import AppKit
import Foundation

// MARK: - AppLifecycleHandlers
//
// DEBUG-only handlers for the four `simulateApp*` RPC verbs added in
// the harness extensions plan ([D07] / Spec [#s01-hardware-rpc] /
// Step 4). Each verb invokes the matching `NSApp` primitive on the
// main thread, then waits up to a bounded timeout for the
// corresponding `NSApplication.did...Notification` to fire on the
// real `AppDelegate`. Returns void on success, throws
// `AppLifecycleError.timeout(...)` on miss.
//
// ## Why notifications, not delegate-callback hooks
//
// `NSApp.deactivate()` etc. drive the app's regular activation
// state machine; the AppDelegate's `applicationDid...Active(_:)`
// methods (see `AppDelegate.swift`) fire as a consequence. We
// observe via `NotificationCenter` because:
//
// 1. `NSApplication.did...Notification` posts on the same path
//    that triggers the delegate methods — observing one is
//    equivalent to observing the other for fidelity purposes.
// 2. Adding a synthesizing-callback path on AppDelegate would
//    require wiring a closure-slot that production code never
//    needs; the notification observer keeps the test surface
//    self-contained.
//
// ## Threading
//
// `NSApp.deactivate()` / `.activate()` / `.hide()` / `.unhide()` are
// main-thread-only (Cocoa contract). Callers (the dispatch table
// in `TestHarnessConnection`) bounce through
// `DispatchQueue.global(qos: .userInitiated).async` so the WebKit
// run loop on main keeps draining; the helper here marshals the
// trigger and observer-install onto main via `DispatchQueue.main.sync`
// before parking on a `DispatchSemaphore` to wait for the
// notification.

// MARK: - Errors

enum AppLifecycleError: Error, CustomStringConvertible {
    case timeout(event: String, timeoutMs: Int)
    case unknownVerb(String)

    var description: String {
        switch self {
        case .timeout(let event, let timeoutMs):
            return "NSApplication \(event) notification did not fire within \(timeoutMs)ms"
        case .unknownVerb(let name):
            return "unknown app-lifecycle verb: \"\(name)\""
        }
    }

    /// The error `name` reported over the RPC wire. Matched client-
    /// side in `tests/in-app/_harness/rpc.ts`'s `translateError`.
    var wireName: String {
        switch self {
        case .timeout: return "AppLifecycleTimeoutError"
        case .unknownVerb: return "ProtocolError"
        }
    }
}

// MARK: - Handler

enum AppLifecycleHandlers {

    /// Default bound for delegate-callback wait. The plan's
    /// [#step-4] artifact pins this at 1000ms — enough for any
    /// real activation transition to drain through the run loop,
    /// short enough that a stuck call doesn't hang the test runner.
    /// Callers can override per-call via `verbObj["timeoutMs"]`.
    static let defaultTimeoutMs: Int = 1000

    /// Top-level dispatch. Reads the optional `timeoutMs` override
    /// from the wire envelope and routes to one of the four
    /// `simulate*` handlers.
    static func dispatch(method: String, verbObj: [String: Any]) throws {
        let timeoutMs = (verbObj["timeoutMs"] as? Int) ?? defaultTimeoutMs
        switch method {
        case "simulateAppResign":
            try waitForLifecycle(
                notification: NSApplication.didResignActiveNotification,
                eventName: "didResignActive",
                timeoutMs: timeoutMs,
                trigger: deactivateSelf,
            )
        case "simulateAppBecomeActive":
            try waitForLifecycle(
                notification: NSApplication.didBecomeActiveNotification,
                eventName: "didBecomeActive",
                timeoutMs: timeoutMs,
                trigger: { NSApp.activate(ignoringOtherApps: true) },
            )
            // `didBecomeActive` fires when Tug's app-level activation
            // commits, but macOS WindowServer's window-z-order update
            // (which routes `CGEvent` mouse posts) is asynchronous
            // and lags the notification by ~50ms on Apple Silicon
            // macOS 14-15. A `nativeClick` posted immediately after
            // this verb returns then races that update and can land
            // on the previously-frontmost window — typically
            // Finder's desktop, foregrounded by `simulateAppResign`'s
            // `deactivateSelf`. The settle gives WindowServer time
            // to make Tug's window topmost at click coordinates.
            Thread.sleep(forTimeInterval: 0.2)
        case "simulateAppHide":
            try waitForLifecycle(
                notification: NSApplication.didHideNotification,
                eventName: "didHide",
                timeoutMs: timeoutMs,
                trigger: { NSApp.hide(nil) },
            )
        case "simulateAppUnhide":
            try waitForLifecycle(
                notification: NSApplication.didUnhideNotification,
                eventName: "didUnhide",
                timeoutMs: timeoutMs,
                trigger: { NSApp.unhide(nil) },
            )
        case "quitGracefully":
            // Don't park on a `willTerminate` semaphore here:
            // `applicationShouldTerminate`'s completion handler in
            // `AppDelegate` calls `testHarnessBridge?.close()` (which
            // closes our `FileHandle`) BEFORE
            // `NSApp.reply(toApplicationShouldTerminate: true)` posts
            // `willTerminate`. A response write after the close would
            // race the fd teardown and risk an
            // `NSFileHandleOperationException`.
            //
            // Schedule the terminate on the next main-loop tick.
            // `dispatch` returns immediately on this background
            // queue; the caller (`dispatchAppLifecycleVerb`) writes
            // the `ok` response to the still-open socket BEFORE
            // `NSApp.terminate(nil)` runs. The test side awaits
            // `subprocess.exited` for the actual confirmation that
            // the OS killed the process.
            //
            // `timeoutMs` from the wire is accepted for forward
            // compatibility but currently unused — the bound that
            // matters is the JS-side `subprocess.exited` race in
            // `App.quitGracefully`.
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        default:
            throw AppLifecycleError.unknownVerb(method)
        }
    }

    /// Cause Tug.app to resign active state. `NSApp.deactivate()`
    /// alone is unreliable on macOS Sonoma+ — when there's no
    /// previous app queued to receive activation, the call is a
    /// silent no-op and `applicationDidResignActive:` never fires.
    /// The robust way to deactivate is to ACTIVATE another app
    /// (which also matches the user-facing scenario of "user clicks
    /// on Finder" that M04 is meant to exercise). Finder is a
    /// system-essential app that's always running, so it's the
    /// reliable target. We still call `NSApp.deactivate()` first
    /// for parity with [D07]'s wire spec — on macOS versions where
    /// it does take effect, the Finder activation is a redundant
    /// nudge that AppKit collapses into a single state change.
    private static func deactivateSelf() {
        NSApp.deactivate()
        if let finder = NSRunningApplication.runningApplications(
            withBundleIdentifier: "com.apple.finder",
        ).first {
            finder.activate(options: [])
        }
    }

    /// Install a one-shot `NotificationCenter` observer for
    /// `notification`, run `trigger` synchronously on main (so the
    /// observer is in place before the trigger can possibly post),
    /// then park on a `DispatchSemaphore` until the notification
    /// fires or `timeoutMs` elapses.
    ///
    /// The observer is removed unconditionally via `defer`-equivalent
    /// cleanup so a timeout doesn't leak observers across calls.
    private static func waitForLifecycle(
        notification: Notification.Name,
        eventName: String,
        timeoutMs: Int,
        trigger: @escaping () -> Void,
    ) throws {
        let semaphore = DispatchSemaphore(value: 0)
        var observer: NSObjectProtocol?

        DispatchQueue.main.sync {
            observer = NotificationCenter.default.addObserver(
                forName: notification,
                object: NSApp,
                queue: .main,
            ) { _ in
                semaphore.signal()
            }
            trigger()
        }

        let result = semaphore.wait(timeout: .now() + .milliseconds(timeoutMs))

        // Remove the observer on the main queue — `NotificationCenter`
        // is documented as thread-safe for `removeObserver`, but
        // matching the install side keeps the contract explicit.
        if let observer = observer {
            DispatchQueue.main.sync {
                NotificationCenter.default.removeObserver(observer)
            }
        }

        if result == .timedOut {
            throw AppLifecycleError.timeout(event: eventName, timeoutMs: timeoutMs)
        }
    }
}
#endif
