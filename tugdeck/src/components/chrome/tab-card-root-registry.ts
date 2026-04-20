/**
 * Tab card root registry — maps `cardId` to the card's root `HTMLDivElement`
 * (the `<div class="tugcard">` rendered by Tugcard). Used as a bridge so
 * that tab content rendered via portal at the deck level can re-provide
 * `TugcardPortalContext` pointing at its host card's root element.
 *
 * Without this bridge, tab content (e.g., tide's project picker) that
 * relies on portaling sheets or tooltips into the card root loses access
 * to that element when TabContentHost moves out of Tugcard's React tree
 * (Step 11.6.1a Piece 1.iii).
 *
 * Parallel to `card-content-registry` which tracks the inner content div.
 *
 * @module components/chrome/tab-card-root-registry
 */

type Listener = () => void;

const roots = new Map<string, HTMLDivElement>();
const listenersByCardId = new Map<string, Set<Listener>>();

function notify(cardId: string): void {
  const set = listenersByCardId.get(cardId);
  if (!set) return;
  for (const cb of set) cb();
}

export function register(cardId: string, el: HTMLDivElement): void {
  const prev = roots.get(cardId);
  if (prev === el) return;
  roots.set(cardId, el);
  notify(cardId);
}

export function unregister(cardId: string): void {
  if (!roots.has(cardId)) return;
  roots.delete(cardId);
  notify(cardId);
}

export function getElement(cardId: string): HTMLDivElement | null {
  return roots.get(cardId) ?? null;
}

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

export function _resetForTests(): void {
  roots.clear();
  listenersByCardId.clear();
}
