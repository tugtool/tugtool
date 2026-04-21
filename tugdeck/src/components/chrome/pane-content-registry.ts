/**
 * Pane content registry — maps each pane id to the `HTMLDivElement` that
 * holds that pane's content area (the inner `.tug-pane-content` div). Portals
 * in `card-portal.tsx` look up their host pane's content element through this
 * registry and re-root whenever a pane's content element mounts, unmounts,
 * or re-registers (e.g., on HMR).
 *
 * The key is the pane id (`TugPaneState.id`); the element registered here is
 * the pane's content `<div>` (the node inside which every card's content lands).
 *
 * Lifecycle:
 *   - `TugPane` calls `register(paneId, el)` in a useLayoutEffect after its
 *     `contentRef` is attached.
 *   - `TugPane` calls `unregister(paneId)` in the cleanup.
 *   - `CardPortal` calls `subscribe(paneId, cb)` to be notified when the
 *     target element changes, and `getElement(paneId)` to read the current
 *     value.
 *
 * Module-level state (not React state). This is appearance-zone infrastructure
 * that lives outside the React render tree (L22): React components opt in via
 * `useSyncExternalStore` on the registry.
 *
 * @module components/chrome/pane-content-registry
 */

type Listener = () => void;

const elements = new Map<string, HTMLDivElement>();
const listenersByPaneId = new Map<string, Set<Listener>>();

function notify(paneId: string): void {
  const set = listenersByPaneId.get(paneId);
  if (!set) return;
  for (const cb of set) cb();
}

/**
 * Register (or replace) the content element for `paneId`. Idempotent: calling
 * twice with the same element is a no-op; calling with a different element
 * replaces the previous registration and notifies subscribers.
 */
export function register(paneId: string, el: HTMLDivElement): void {
  const prev = elements.get(paneId);
  if (prev === el) return;
  elements.set(paneId, el);
  notify(paneId);
}

/**
 * Remove the registration for `paneId` and notify subscribers. No-op if the
 * pane id was not registered.
 */
export function unregister(paneId: string): void {
  if (!elements.has(paneId)) return;
  elements.delete(paneId);
  notify(paneId);
}

/** Return the current content element for `paneId`, or `null` if none. */
export function getElement(paneId: string): HTMLDivElement | null {
  return elements.get(paneId) ?? null;
}

/**
 * Subscribe to element changes for `paneId`. Returns an unsubscribe function.
 * The callback fires when `register` or `unregister` is called for the same
 * pane id — it does not fire on initial subscription.
 */
export function subscribe(paneId: string, callback: Listener): () => void {
  let set = listenersByPaneId.get(paneId);
  if (!set) {
    set = new Set();
    listenersByPaneId.set(paneId, set);
  }
  set.add(callback);
  return () => {
    const current = listenersByPaneId.get(paneId);
    if (!current) return;
    current.delete(callback);
    if (current.size === 0) listenersByPaneId.delete(paneId);
  };
}

/**
 * Test-only: clear all registrations and listeners. Tests that construct
 * multiple DeckCanvas instances can reset between runs without leaking state.
 */
export function _resetForTests(): void {
  elements.clear();
  listenersByPaneId.clear();
}
