#if DEBUG
import WebKit

// MARK: - TestHarnessUserScript
//
// Installs a `WKUserScript` at `atDocumentStart` that sets
// `window.__tugTestMode = true` before any tugdeck JS runs. Also
// enables Web Inspector for in-app debugging during test runs.
//
// Matched with tugdeck's `main.tsx` which reads
// `window.__tugTestMode` at module top level and passes
// `testMode: true` to `DeckManager`. See Spec [#s05-wkuserscript-injection]
// and [D04] (boot timing).
//
// This is a separate module from `MainWindow.swift` so MainWindow
// only carries a single `#if DEBUG` call site; all the user-script
// code lives here and ships zero bytes to release.

enum TestHarnessUserScript {
    /// Install the `__tugTestMode` injection and enable Web Inspector
    /// on the given config. Must be called before the WebView loads
    /// its first URL.
    ///
    /// When `TUGAPP_PERSIST_IN_TEST_MODE=1` is set on the launched
    /// app's environment, also injects `__tugPersistInTestMode = true`.
    /// That flag is the cold-boot harness's escape hatch on
    /// `deck-manager`'s `put*Guarded` test-mode bypass: writes still
    /// go through to tugbank when both flags are true. The bypass
    /// itself stays in place for ordinary in-app tests so the
    /// developer's real `~/.tugbank.db` is never touched. See
    /// selection plan Step 25C.2 Layer 3.
    static func install(into config: WKWebViewConfiguration) {
        var source = "window.__tugTestMode = true;"
        if ProcessInfo.processInfo.environment["TUGAPP_PERSIST_IN_TEST_MODE"] == "1" {
            source += "\nwindow.__tugPersistInTestMode = true;"
        }
        let script = WKUserScript(
            source: source,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(script)

        // Web Inspector is already enabled unconditionally in MainWindow
        // today; we set it again here as a belt-and-suspenders for the
        // test-mode path in case the default ever changes.
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    }
}
#endif
