/**
 * tug-native-clipboard — native clipboard bridge for Tug.app (WKWebView).
 *
 * ## Why this exists
 *
 * Safari's JavaScript Clipboard API (`navigator.clipboard.readText` / `.read`)
 * triggers a floating "Paste" permission popup on every invocation, and in
 * Safari 16.4+ `document.execCommand("paste")` on contentEditable elements
 * triggers the same popup. There is no JavaScript-only path to read the
 * system clipboard from a WKWebView-hosted web page without the popup.
 *
 * The only way to supply clipboard data to JavaScript without the popup in
 * this context is to delegate to the native side: read `NSPasteboard.general`
 * from Swift and pass the contents back via `evaluateJavaScript`. Tug.app
 * (macOS host, `tugapp/Sources/MainWindow.swift`) exposes a
 * `WKScriptMessageHandler` named `clipboardRead` that does exactly this.
 * This module wraps the asynchronous message roundtrip in a Promise.
 *
 * ## Protocol
 *
 * 1. JS calls `readClipboardViaNative()`.
 * 2. This module generates a unique `requestId`, stores the promise's
 *    `resolve` in a pending-callbacks map keyed by that id, and posts
 *    `{ requestId }` to the Swift handler.
 * 3. Swift reads `NSPasteboard.general.string(forType: .string)` and
 *    `.html`, JSON-encodes them, and calls
 *    `window.__tugNativeClipboardCallback({ requestId, text, html })`.
 * 4. This module's callback looks up the resolver by `requestId`, deletes
 *    the entry, and resolves with `{ text, html }`.
 *
 * A safety timeout (1 second) guards against the Swift side never calling
 * back — the continuation would otherwise hang forever. On timeout the
 * promise resolves with empty strings.
 *
 * ## When to use
 *
 * In paste handlers that need clipboard access from a non-native gesture
 * (e.g. our custom context menu's Paste item). Check
 * `hasNativeClipboardBridge()` before calling: when the bridge is absent
 * (browser-only development, tests, standalone previews), fall back to the
 * JS Clipboard API. The native bridge is strictly a production-in-Tug.app
 * optimization — the JS fallback still works elsewhere, just with the
 * Safari popup if the user is on Safari.
 */

/** Shape of the clipboard payload returned by the native bridge. */
export interface NativeClipboardReadResult {
  /** Plain text contents of NSPasteboard (.string type). Empty string if none. */
  text: string;
  /** HTML contents of NSPasteboard (.html type). Empty string if none. */
  html: string;
}

interface ClipboardBridgeMessageHandlers {
  clipboardRead?: { postMessage: (v: unknown) => void };
}

interface ClipboardWebkit {
  messageHandlers?: ClipboardBridgeMessageHandlers;
}

/** Map of pending requestId → resolver. */
const pendingCallbacks = new Map<string, (result: NativeClipboardReadResult) => void>();

let callbackInstalled = false;

/**
 * Install the JS callback that Swift invokes via evaluateJavaScript.
 * Idempotent — safe to call multiple times.
 */
function installCallback(): void {
  if (callbackInstalled) return;
  callbackInstalled = true;
  (globalThis as Record<string, unknown>).__tugNativeClipboardCallback = (
    data: { requestId: string; text: string; html: string },
  ) => {
    if (!data || typeof data.requestId !== "string") return;
    const resolver = pendingCallbacks.get(data.requestId);
    if (resolver) {
      pendingCallbacks.delete(data.requestId);
      resolver({
        text: typeof data.text === "string" ? data.text : "",
        html: typeof data.html === "string" ? data.html : "",
      });
    }
  };
}

/**
 * True if the native clipboard bridge is available — i.e. the page is
 * running inside Tug.app's WKWebView and the Swift side has registered
 * the `clipboardRead` message handler. False in a normal browser.
 *
 * Callers should branch on this: prefer the native bridge when it's
 * present (no Safari permission popup), fall back to the JS Clipboard
 * API when it's absent (normal browser development).
 */
export function hasNativeClipboardBridge(): boolean {
  const webkit = (globalThis as unknown as { webkit?: ClipboardWebkit }).webkit;
  return typeof webkit?.messageHandlers?.clipboardRead?.postMessage === "function";
}

/** How long to wait for the Swift callback before giving up. */
const NATIVE_CLIPBOARD_TIMEOUT_MS = 1000;

/**
 * Read the system clipboard via the native NSPasteboard bridge.
 *
 * Returns a Promise that resolves with `{ text, html }` once the Swift
 * side has called back. If the bridge is not installed, resolves
 * immediately with empty strings — callers should check
 * `hasNativeClipboardBridge()` first and take the JS fallback path when
 * it returns false.
 *
 * If the Swift side fails to respond within `NATIVE_CLIPBOARD_TIMEOUT_MS`,
 * resolves with empty strings so dependent continuations don't hang
 * forever.
 */
export function readClipboardViaNative(): Promise<NativeClipboardReadResult> {
  const webkit = (globalThis as unknown as { webkit?: ClipboardWebkit }).webkit;
  const handler = webkit?.messageHandlers?.clipboardRead;
  if (!handler || typeof handler.postMessage !== "function") {
    return Promise.resolve({ text: "", html: "" });
  }
  installCallback();
  const requestId = `tug-clip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<NativeClipboardReadResult>((resolve) => {
    // Single settlement path: the first of {Swift callback, timeout} wins.
    // `settled` guards against the race where both paths fire.
    let settled = false;
    const settle = (result: NativeClipboardReadResult) => {
      if (settled) return;
      settled = true;
      pendingCallbacks.delete(requestId);
      clearTimeout(timeoutHandle);
      resolve(result);
    };
    pendingCallbacks.set(requestId, settle);
    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        console.warn(
          `tug-native-clipboard: Swift callback timed out after ${NATIVE_CLIPBOARD_TIMEOUT_MS}ms`,
        );
        settle({ text: "", html: "" });
      }
    }, NATIVE_CLIPBOARD_TIMEOUT_MS);
    handler.postMessage({ requestId });
  });
}
