/**
 * Card content registry — maps `cardId` to the `HTMLDivElement` that holds
 * that card's content area. Portals in `card-portal.tsx` look up their host
 * card's content element through this registry and re-root whenever a card's
 * content element mounts, unmounts, or re-registers (e.g., on HMR).
 *
 * Lifecycle:
 *   - `Tugcard` calls `register(cardId, el)` in a useLayoutEffect after its
 *     `contentRef` is attached.
 *   - `Tugcard` calls `unregister(cardId)` in the cleanup.
 *   - `CardPortal` calls `subscribe(cardId, cb)` to be notified when the
 *     target element changes, and `getElement(cardId)` to read the current
 *     value.
 *
 * Module-level state (not React state). This is appearance-zone infrastructure
 * that lives outside the React render tree (L22): React components opt in via
 * `useSyncExternalStore` on the registry.
 *
 * @module components/chrome/card-content-registry
 */

type Listener = () => void;

const elements = new Map<string, HTMLDivElement>();
const listenersByCardId = new Map<string, Set<Listener>>();

function notify(cardId: string): void {
  const set = listenersByCardId.get(cardId);
  if (!set) return;
  for (const cb of set) cb();
}

/**
 * Register (or replace) the content element for `cardId`. Idempotent: calling
 * twice with the same element is a no-op; calling with a different element
 * replaces the previous registration and notifies subscribers.
 */
export function register(cardId: string, el: HTMLDivElement): void {
  const prev = elements.get(cardId);
  if (prev === el) return;
  elements.set(cardId, el);
  notify(cardId);
}

/**
 * Remove the registration for `cardId` and notify subscribers. No-op if the
 * cardId was not registered.
 */
export function unregister(cardId: string): void {
  if (!elements.has(cardId)) return;
  elements.delete(cardId);
  notify(cardId);
}

/** Return the current content element for `cardId`, or `null` if none. */
export function getElement(cardId: string): HTMLDivElement | null {
  return elements.get(cardId) ?? null;
}

/**
 * Subscribe to element changes for `cardId`. Returns an unsubscribe function.
 * The callback fires when `register` or `unregister` is called for the same
 * cardId — it does not fire on initial subscription.
 */
export function subscribe(cardId: string, callback: Listener): () => void {
  let set = listenersByCardId.get(cardId);
  if (!set) {
    set = new Set();
    listenersByCardId.set(cardId, set);
  }
  set.add(callback);
  return () => {
    const current = listenersByCardId.get(cardId);
    if (!current) return;
    current.delete(callback);
    if (current.size === 0) listenersByCardId.delete(cardId);
  };
}

/**
 * Test-only: clear all registrations and listeners. Tests that construct
 * multiple DeckCanvas instances can reset between runs without leaking state.
 */
export function _resetForTests(): void {
  elements.clear();
  listenersByCardId.clear();
}
