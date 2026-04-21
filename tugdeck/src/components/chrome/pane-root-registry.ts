/**
 * Pane root registry — maps a pane id to that pane's root
 * `HTMLDivElement` (the `<div class="tugcard">` rendered by `TugWindow`).
 * Used as a bridge so card content rendered via portal at the deck level
 * can re-provide `TugPanePortalContext` pointing at its host pane's root.
 *
 * Without this bridge, card content (e.g., tide's project picker) that
 * relies on portaling sheets or tooltips into the window root loses access
 * to that element when `CardHost` moves out of the pane's React
 * tree (Step 11.6.1a Piece 1.iii).
 *
 * Parallel to `pane-content-registry` which tracks the inner content div.
 *
 * @module components/chrome/pane-root-registry
 */

type Listener = () => void;

const roots = new Map<string, HTMLDivElement>();
const listenersByPaneId = new Map<string, Set<Listener>>();

function notify(paneId: string): void {
  const set = listenersByPaneId.get(paneId);
  if (!set) return;
  for (const cb of set) cb();
}

export function register(paneId: string, el: HTMLDivElement): void {
  const prev = roots.get(paneId);
  if (prev === el) return;
  roots.set(paneId, el);
  notify(paneId);
}

export function unregister(paneId: string): void {
  if (!roots.has(paneId)) return;
  roots.delete(paneId);
  notify(paneId);
}

export function getElement(paneId: string): HTMLDivElement | null {
  return roots.get(paneId) ?? null;
}

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

export function _resetForTests(): void {
  roots.clear();
  listenersByPaneId.clear();
}
