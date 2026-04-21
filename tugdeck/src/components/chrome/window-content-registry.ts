/**
 * Window content registry — maps each window id to the `HTMLDivElement` that
 * holds that window's content area (the inner `.tugcard-content` div). Portals
 * in `card-portal.tsx` look up their host window's content element through this
 * registry and re-root whenever a window's content element mounts, unmounts,
 * or re-registers (e.g., on HMR).
 *
 * The key is the window id (the stack frame / `TugWindowState.id`); the
 * element registered here is the window's content `<div>` (the node inside
 * which every card's content lands).
 *
 * Lifecycle:
 *   - `Tugcard` calls `register(windowId, el)` in a useLayoutEffect after its
 *     `contentRef` is attached.
 *   - `Tugcard` calls `unregister(windowId)` in the cleanup.
 *   - `CardPortal` calls `subscribe(windowId, cb)` to be notified when the
 *     target element changes, and `getElement(windowId)` to read the current
 *     value.
 *
 * Module-level state (not React state). This is appearance-zone infrastructure
 * that lives outside the React render tree (L22): React components opt in via
 * `useSyncExternalStore` on the registry.
 *
 * @module components/chrome/window-content-registry
 */

type Listener = () => void;

const elements = new Map<string, HTMLDivElement>();
const listenersByWindowId = new Map<string, Set<Listener>>();

function notify(windowId: string): void {
  const set = listenersByWindowId.get(windowId);
  if (!set) return;
  for (const cb of set) cb();
}

/**
 * Register (or replace) the content element for `windowId`. Idempotent: calling
 * twice with the same element is a no-op; calling with a different element
 * replaces the previous registration and notifies subscribers.
 */
export function register(windowId: string, el: HTMLDivElement): void {
  const prev = elements.get(windowId);
  if (prev === el) return;
  elements.set(windowId, el);
  notify(windowId);
}

/**
 * Remove the registration for `windowId` and notify subscribers. No-op if the
 * windowId was not registered.
 */
export function unregister(windowId: string): void {
  if (!elements.has(windowId)) return;
  elements.delete(windowId);
  notify(windowId);
}

/** Return the current content element for `windowId`, or `null` if none. */
export function getElement(windowId: string): HTMLDivElement | null {
  return elements.get(windowId) ?? null;
}

/**
 * Subscribe to element changes for `windowId`. Returns an unsubscribe function.
 * The callback fires when `register` or `unregister` is called for the same
 * windowId — it does not fire on initial subscription.
 */
export function subscribe(windowId: string, callback: Listener): () => void {
  let set = listenersByWindowId.get(windowId);
  if (!set) {
    set = new Set();
    listenersByWindowId.set(windowId, set);
  }
  set.add(callback);
  return () => {
    const current = listenersByWindowId.get(windowId);
    if (!current) return;
    current.delete(callback);
    if (current.size === 0) listenersByWindowId.delete(windowId);
  };
}

/**
 * Test-only: clear all registrations and listeners. Tests that construct
 * multiple DeckCanvas instances can reset between runs without leaking state.
 */
export function _resetForTests(): void {
  elements.clear();
  listenersByWindowId.clear();
}
