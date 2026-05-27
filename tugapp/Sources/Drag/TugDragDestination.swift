import Cocoa
import WebKit

/// Bridges native macOS drag events on the WKWebView into the JavaScript
/// world by exposing the current `NSPasteboard` contents on the JS-side
/// global `window.__tugActiveDrag`.
///
/// The drop extension in tugdeck (`tug-text-editor/drop-extension.ts`)
/// reads from `window.__tugActiveDrag` during `dragenter` / `dragover` to
/// drive the three-state `setDropActive` (accept / reject) ring. When the
/// snapshot is present, the JS side classifies the files via the existing
/// `classifySourceMime` / `isTextMimeType` logic and shows the red reject
/// ring + OS no-drop cursor for unsupported drops — *before* the user
/// releases. When the snapshot is absent (browser-only dev path, or pre-
/// `evaluateJavaScript`-completion race), the JS side falls back to the
/// pre-3.5.7 "always accept" behavior.
///
/// ## Timing
///
/// `WKWebView.evaluateJavaScript` is asynchronous: it queues a task on
/// the WebContent runloop. The OS dispatches drag events through the
/// WebView synchronously (the AppKit drag protocol calls
/// `draggingEntered:` on the destination view directly), so we run
/// *before* WebKit synthesizes the JS dragenter event. We post the
/// snapshot assignment to the JS engine first, then call `super` to let
/// WebKit dispatch the dragenter event. Both land on the same JS thread;
/// queue ordering means the assignment is processed first. The first
/// dragover after a fresh drag may still race ahead of the assignment
/// (the assignment is enqueued, not executed inline), but every
/// subsequent dragover frame sees the snapshot — sufficient for the UX
/// goal of getting a cursor-level reject ring during sustained drags.
///
/// This async-with-eventually-consistent design is what Q05 in the
/// tide-atoms plan resolves: the dev-panel timing pass at 3.5.7.d
/// confirms the race window is at most one frame, and the
/// `dragHasSupportedItem` fallback in JS keeps the first-frame
/// behavior identical to the pre-3.5.7 always-accept default.
///
/// ## Lifecycle
///
/// One `TugDragDestination` per `WKWebView`, owned by the WebView
/// subclass (`TugWebView`). Holds a weak reference to the WebView so a
/// destruction race during shutdown doesn't keep the WebView alive
/// past `MainWindow.cleanupBridge()`.
final class TugDragDestination {
    private weak var webView: WKWebView?

    init(webView: WKWebView) {
        self.webView = webView
    }

    /// Observe a `draggingEntered:` or `draggingUpdated:` event:
    /// snapshot the pasteboard, encode to JSON, and push to JS by
    /// assigning `window.__tugActiveDrag`.
    ///
    /// When the pasteboard holds no file URLs (a text-only drag, a
    /// keyboard-driven drag, etc.), clears the global instead — the
    /// JS side will fall through to the legacy `types.includes("Files")`
    /// path which never matches a non-file drag.
    func observeDragUpdate(sender: NSDraggingInfo) {
        guard let snapshot = PasteboardSnapshot.capture(from: sender.draggingPasteboard) else {
            clearActiveDrag()
            return
        }
        guard let json = snapshot.jsonString() else {
            // Encoding failed (essentially unreachable for a Codable
            // value-type struct, but defensive). Fall through to the
            // clear path so the JS side doesn't act on stale data.
            clearActiveDrag()
            return
        }
        evaluate("window.__tugActiveDrag = \(json);")
    }

    /// Observe a `draggingExited:` or `concludeDragOperation:` event:
    /// clear `window.__tugActiveDrag`. Subsequent drags start fresh —
    /// no stale snapshot from a previous drag pollutes the next one's
    /// first dragover frame.
    func observeDragEnded() {
        clearActiveDrag()
    }

    // MARK: - Private

    private func clearActiveDrag() {
        evaluate("window.__tugActiveDrag = null;")
    }

    private func evaluate(_ script: String) {
        webView?.evaluateJavaScript(script) { _, error in
            if let error = error {
                NSLog("TugDragDestination: evaluateJavaScript failed: %@", error.localizedDescription)
            }
        }
    }
}
