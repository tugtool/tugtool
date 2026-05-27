import Cocoa
import WebKit

/// `WKWebView` subclass that snoops the OS drag dispatch and publishes
/// the current `NSPasteboard` contents to JavaScript via
/// `TugDragDestination`. WebKit's own drag handling continues to run via
/// `super` — drops still arrive at the JS layer's `drop` event with a
/// fully-populated `DataTransfer.files`, exactly as if we hadn't
/// subclassed at all.
///
/// ## Why subclass instead of putting a parent view
///
/// macOS drag dispatch hit-tests for the topmost drag-aware view under
/// the cursor. `WKWebView` registers itself for file URL drag types
/// internally so the JS layer can receive `dragover` / `drop`. Putting
/// another `NSView` on top to act as a drag destination would either
/// block WebKit from receiving the drop or require forwarding drag
/// events back down to the WebView — both fragile. Subclassing the
/// WebView and overriding the drag destination methods lets us observe
/// every event without altering the dispatch semantics.
///
/// ## Why a subclass instead of an Objective-C category swizzle
///
/// `WKWebView` is a publicly-subclassable class; the drag destination
/// methods are public AppKit overrides. Subclassing is the supported
/// extension point. Swizzling would also work but adds runtime fragility
/// and obscures the call site.
final class TugWebView: WKWebView {
    /// Lazy because `init(frame:configuration:)` is the public WKWebView
    /// designated initializer and we want to keep the override surface
    /// minimal. The destination is constructed on first drag event,
    /// which is fine — it's a thin object that only holds a weak ref
    /// back to `self`.
    private lazy var dragDestination: TugDragDestination = {
        TugDragDestination(webView: self)
    }()

    // MARK: - NSDraggingDestination overrides

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        // Push the pasteboard snapshot to JS *before* calling super,
        // so the assignment is queued ahead of WebKit's synthesized
        // dragenter event on the JS thread. See `TugDragDestination`
        // for the timing rationale.
        dragDestination.observeDragUpdate(sender: sender)
        return super.draggingEntered(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        // The pasteboard contents typically don't change during a single
        // drag, but updating on every dragover is cheap and makes the
        // bridge robust to drag-source quirks (some apps repackage the
        // pasteboard during the drag).
        dragDestination.observeDragUpdate(sender: sender)
        return super.draggingUpdated(sender)
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        dragDestination.observeDragEnded()
        super.draggingExited(sender)
    }

    override func concludeDragOperation(_ sender: NSDraggingInfo?) {
        // The drop has been delivered to WebKit (which fires the JS
        // `drop` event via super). Clear the snapshot so the next drag
        // starts fresh without a stale entry from this drag.
        dragDestination.observeDragEnded()
        super.concludeDragOperation(sender)
    }
}
