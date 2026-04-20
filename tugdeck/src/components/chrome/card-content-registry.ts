/**
 * Card content registry — maps `stackId` to the `HTMLDivElement` that holds
 * that stack's content area (the inner `.tugcard-content` div). Portals in
 * `card-portal.tsx` look up their host stack's content element through this
 * registry and re-root whenever a stack's content element mounts, unmounts,
 * or re-registers (e.g., on HMR).
 *
 * The file name carries the historical "card-content" vocabulary even though
 * the key is now `stackId` — the element registered here IS the stack's
 * content `<div>` (the node inside which every card's content lands). No
 * functional change; just a naming holdover from the pre-Card/CardStack era.
 *
 * Lifecycle:
 *   - `Tugcard` calls `register(stackId, el)` in a useLayoutEffect after its
 *     `contentRef` is attached.
 *   - `Tugcard` calls `unregister(stackId)` in the cleanup.
 *   - `CardPortal` calls `subscribe(stackId, cb)` to be notified when the
 *     target element changes, and `getElement(stackId)` to read the current
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
const listenersByStackId = new Map<string, Set<Listener>>();

function notify(stackId: string): void {
  const set = listenersByStackId.get(stackId);
  if (!set) return;
  for (const cb of set) cb();
}

/**
 * Register (or replace) the content element for `stackId`. Idempotent: calling
 * twice with the same element is a no-op; calling with a different element
 * replaces the previous registration and notifies subscribers.
 */
export function register(stackId: string, el: HTMLDivElement): void {
  const prev = elements.get(stackId);
  if (prev === el) return;
  elements.set(stackId, el);
  notify(stackId);
}

/**
 * Remove the registration for `stackId` and notify subscribers. No-op if the
 * stackId was not registered.
 */
export function unregister(stackId: string): void {
  if (!elements.has(stackId)) return;
  elements.delete(stackId);
  notify(stackId);
}

/** Return the current content element for `stackId`, or `null` if none. */
export function getElement(stackId: string): HTMLDivElement | null {
  return elements.get(stackId) ?? null;
}

/**
 * Subscribe to element changes for `stackId`. Returns an unsubscribe function.
 * The callback fires when `register` or `unregister` is called for the same
 * stackId — it does not fire on initial subscription.
 */
export function subscribe(stackId: string, callback: Listener): () => void {
  let set = listenersByStackId.get(stackId);
  if (!set) {
    set = new Set();
    listenersByStackId.set(stackId, set);
  }
  set.add(callback);
  return () => {
    const current = listenersByStackId.get(stackId);
    if (!current) return;
    current.delete(callback);
    if (current.size === 0) listenersByStackId.delete(stackId);
  };
}

/**
 * Test-only: clear all registrations and listeners. Tests that construct
 * multiple DeckCanvas instances can reset between runs without leaking state.
 */
export function _resetForTests(): void {
  elements.clear();
  listenersByStackId.clear();
}
