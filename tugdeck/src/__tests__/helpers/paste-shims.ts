/**
 * paste-shims — minimum-fidelity globals for exercising paste cascade
 * branches in tests.
 *
 * The paste handler in `use-text-input-responder.tsx` has a three-way
 * reader cascade:
 *
 *   1. Native bridge (`window.webkit.messageHandlers.clipboardRead`)
 *   2. `document.execCommand("paste")` + synchronous paste-event capture
 *   3. `navigator.clipboard.readText()` fallback
 *
 * Two of the three branches can be exercised in happy-dom with small,
 * focused stubs of the relevant globals. The third — execCommand
 * success — requires a synthetic `ClipboardEvent` with a populated
 * `DataTransfer` dispatched synchronously when `execCommand("paste")`
 * is called. happy-dom doesn't implement `ClipboardEvent` faithfully
 * enough to make that test maintainable, and a full polyfill would
 * grow into a happy-dom clone. That branch is verified manually in
 * real browsers and documented in the paste-handler's module
 * docstring; this file is deliberately scoped to the two testable
 * branches.
 *
 * Each shim pair is `install…` / `uninstall…`. Tests should call the
 * installer in a `try` block and the uninstaller in `finally`, so a
 * test failure doesn't leak stubbed globals into the next test.
 *
 * **Do not grow these shims into a happy-dom replacement.** They
 * simulate exactly the one observable property each cascade branch
 * depends on — nothing more. If a new branch needs testing, add a
 * new focused shim pair rather than expanding an existing one.
 */

// -----------------------------------------------------------------------
// Native bridge shim
// -----------------------------------------------------------------------
//
// `hasNativeClipboardBridge()` returns true iff
// `window.webkit.messageHandlers.clipboardRead.postMessage` is a
// function. `readClipboardViaNative()` calls that postMessage with a
// `{ requestId }` payload and awaits a callback on
// `window.__tugNativeClipboardCallback({ requestId, text, html })`.
// The native Swift side responds via `evaluateJavaScript` in
// production; for tests, we simulate the response synchronously on
// the next microtask so the read promise settles quickly.
//
// The shim installs:
//   - `globalThis.webkit.messageHandlers.clipboardRead.postMessage`
//     that schedules a microtask to call
//     `globalThis.__tugNativeClipboardCallback` with the configured
//     text (and empty html).
//
// The shim preserves any pre-existing value of `globalThis.webkit`
// so tests that run sequentially don't leak state across each other.

interface SavedGlobals {
  webkit: unknown;
}

let savedGlobalsForNative: SavedGlobals | null = null;

export interface FakeNativeBridgeOptions {
  /**
   * Text the fake Swift side should "return" from NSPasteboard.
   * Delivered via `__tugNativeClipboardCallback` on the next
   * microtask after `postMessage` is invoked.
   */
  returnText: string;
}

export function installFakeNativeClipboardBridge(
  options: FakeNativeBridgeOptions,
): void {
  if (savedGlobalsForNative !== null) {
    throw new Error(
      "installFakeNativeClipboardBridge: shim already installed — " +
        "uninstall the previous one before installing a new one",
    );
  }
  const g = globalThis as unknown as Record<string, unknown>;
  savedGlobalsForNative = { webkit: g.webkit };

  // Build the fake webkit.messageHandlers.clipboardRead surface.
  const clipboardRead = {
    postMessage(msg: unknown) {
      if (
        typeof msg !== "object" ||
        msg === null ||
        typeof (msg as { requestId?: unknown }).requestId !== "string"
      ) {
        return;
      }
      const requestId = (msg as { requestId: string }).requestId;
      // Deliver the callback on the next microtask, matching the
      // real Swift → evaluateJavaScript path which is async but
      // fast. Tests `await Promise.resolve()` a couple of times
      // after dispatching the continuation to let this fire.
      queueMicrotask(() => {
        const cb = (globalThis as unknown as {
          __tugNativeClipboardCallback?: (data: {
            requestId: string;
            text: string;
            html: string;
          }) => void;
        }).__tugNativeClipboardCallback;
        cb?.({ requestId, text: options.returnText, html: "" });
      });
    },
  };

  g.webkit = { messageHandlers: { clipboardRead } };
}

export function uninstallFakeNativeClipboardBridge(): void {
  if (savedGlobalsForNative === null) return;
  const g = globalThis as unknown as Record<string, unknown>;
  if (savedGlobalsForNative.webkit === undefined) {
    delete g.webkit;
  } else {
    g.webkit = savedGlobalsForNative.webkit;
  }
  savedGlobalsForNative = null;
}

// -----------------------------------------------------------------------
// Clipboard API shim
// -----------------------------------------------------------------------
//
// The Clipboard API fallback branch runs when (a) the native bridge
// is absent, (b) `document.execCommand("paste")` does not fire a
// synchronous paste event. happy-dom's built-in `document.execCommand`
// does not fire a paste event, so (b) is already satisfied by the
// default environment — no shim needed for execCommand.
//
// This shim installs `navigator.clipboard.readText` to return a
// pre-configured string. `uninstallFakeClipboardReadText` restores
// whatever was there before.

interface SavedClipboard {
  clipboard: unknown;
  hadClipboard: boolean;
}

let savedClipboardForRead: SavedClipboard | null = null;

export function installFakeClipboardReadText(text: string): void {
  if (savedClipboardForRead !== null) {
    throw new Error(
      "installFakeClipboardReadText: shim already installed — " +
        "uninstall the previous one before installing a new one",
    );
  }
  const nav = globalThis.navigator as unknown as {
    clipboard?: { readText?: () => Promise<string> };
  };
  savedClipboardForRead = {
    clipboard: nav.clipboard,
    hadClipboard: Object.prototype.hasOwnProperty.call(nav, "clipboard"),
  };
  // Install a minimal clipboard object. Overwrite any existing one
  // for the test's duration.
  Object.defineProperty(nav, "clipboard", {
    configurable: true,
    writable: true,
    value: {
      readText: () => Promise.resolve(text),
    },
  });
}

export function uninstallFakeClipboardReadText(): void {
  if (savedClipboardForRead === null) return;
  const nav = globalThis.navigator as unknown as Record<string, unknown>;
  if (!savedClipboardForRead.hadClipboard) {
    delete nav.clipboard;
  } else {
    Object.defineProperty(nav, "clipboard", {
      configurable: true,
      writable: true,
      value: savedClipboardForRead.clipboard,
    });
  }
  savedClipboardForRead = null;
}
