/**
 * Window root registry — maps a window id to that window's root
 * `HTMLDivElement` (the `<div class="tugcard">` rendered by `TugWindow`).
 * Used as a bridge so card content rendered via portal at the deck level
 * can re-provide `TugWindowPortalContext` pointing at its host window's root.
 *
 * Without this bridge, card content (e.g., tide's project picker) that
 * relies on portaling sheets or tooltips into the window root loses access
 * to that element when `CardContentHost` moves out of the window's React
 * tree (Step 11.6.1a Piece 1.iii).
 *
 * Parallel to `window-content-registry` which tracks the inner content div.
 *
 * @module components/chrome/window-root-registry
 */

type Listener = () => void;

const roots = new Map<string, HTMLDivElement>();
const listenersByWindowId = new Map<string, Set<Listener>>();

function notify(windowId: string): void {
  const set = listenersByWindowId.get(windowId);
  if (!set) return;
  for (const cb of set) cb();
}

export function register(windowId: string, el: HTMLDivElement): void {
  const prev = roots.get(windowId);
  if (prev === el) return;
  roots.set(windowId, el);
  notify(windowId);
}

export function unregister(windowId: string): void {
  if (!roots.has(windowId)) return;
  roots.delete(windowId);
  notify(windowId);
}

export function getElement(windowId: string): HTMLDivElement | null {
  return roots.get(windowId) ?? null;
}

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

export function _resetForTests(): void {
  roots.clear();
  listenersByWindowId.clear();
}
