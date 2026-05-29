/**
 * native-directory-picker.ts — request/response client for the macOS host's
 * directory picker (`NSOpenPanel`), used by the `/permissions` Workspace tab's
 * "Browse…" button.
 *
 * The Tug.app host exposes a `chooseDirectory` `WKScriptMessageHandler`. We
 * post `{ id, initialPath }`; the host opens an open-panel and calls back
 * `window.__tugBridge.onDirectoryChosen(id, path | null)` (`null` on cancel).
 * Each call carries a unique id so concurrent pickers don't cross wires.
 *
 * Graceful degradation: outside the host (dev browser, or before the app is
 * rebuilt with the handler) {@link isDirectoryPickerAvailable} is `false` and
 * {@link pickDirectory} resolves `null`, so callers can hide the affordance.
 *
 * @module lib/native-directory-picker
 */

/** The host→web bridge object; only the directory callback concerns us here. */
interface TugBridge {
  onDirectoryChosen?: (id: string, path: string | null) => void;
}

interface WebkitHandles {
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (value: unknown) => void } | undefined>;
  };
  __tugBridge?: TugBridge;
}

/** Resolvers awaiting a native callback, keyed by request id. */
const pending = new Map<string, (path: string | null) => void>();

/** Monotonic request-id counter (no Date/random — resume-safe and unique enough). */
let nextId = 0;

/** The `chooseDirectory` message handler, or `undefined` outside the host. */
function directoryHandler(): { postMessage: (value: unknown) => void } | undefined {
  const w = globalThis as unknown as WebkitHandles;
  return w.webkit?.messageHandlers?.chooseDirectory ?? undefined;
}

/** Install the `onDirectoryChosen` callback once, preserving any sibling bridge keys. */
function ensureBridge(): void {
  const w = globalThis as unknown as WebkitHandles;
  const bridge = (w.__tugBridge ??= {});
  if (bridge.onDirectoryChosen === undefined) {
    bridge.onDirectoryChosen = (id, path) => {
      const resolve = pending.get(id);
      if (resolve !== undefined) {
        pending.delete(id);
        resolve(path);
      }
    };
  }
}

/** Whether the native directory picker is reachable (running inside Tug.app). */
export function isDirectoryPickerAvailable(): boolean {
  return directoryHandler() !== undefined;
}

/**
 * Open the host's directory picker, resolving the chosen absolute path, or
 * `null` on cancel / when the picker is unavailable. `initialPath` hints the
 * panel's starting directory.
 */
export function pickDirectory(initialPath?: string): Promise<string | null> {
  const handler = directoryHandler();
  if (handler === undefined) return Promise.resolve(null);
  ensureBridge();
  const id = `dir-${(nextId += 1)}`;
  return new Promise<string | null>((resolve) => {
    pending.set(id, resolve);
    handler.postMessage({ id, initialPath: initialPath ?? null });
  });
}
