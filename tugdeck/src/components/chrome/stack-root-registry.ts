/**
 * Stack root registry — maps a stack id to the stack's root
 * `HTMLDivElement` (the `<div class="tugcard">` rendered by Tugcard).
 * Used as a bridge so card content rendered via portal at the deck level
 * can re-provide `TugcardPortalContext` pointing at its host stack's root.
 *
 * Without this bridge, card content (e.g., tide's project picker) that
 * relies on portaling sheets or tooltips into the stack root loses access
 * to that element when `CardContentHost` moves out of Tugcard's React
 * tree (Step 11.6.1a Piece 1.iii).
 *
 * Parallel to `card-content-registry` which tracks the inner content div.
 *
 * @module components/chrome/stack-root-registry
 */

type Listener = () => void;

const roots = new Map<string, HTMLDivElement>();
const listenersByStackId = new Map<string, Set<Listener>>();

function notify(stackId: string): void {
  const set = listenersByStackId.get(stackId);
  if (!set) return;
  for (const cb of set) cb();
}

export function register(stackId: string, el: HTMLDivElement): void {
  const prev = roots.get(stackId);
  if (prev === el) return;
  roots.set(stackId, el);
  notify(stackId);
}

export function unregister(stackId: string): void {
  if (!roots.has(stackId)) return;
  roots.delete(stackId);
  notify(stackId);
}

export function getElement(stackId: string): HTMLDivElement | null {
  return roots.get(stackId) ?? null;
}

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

export function _resetForTests(): void {
  roots.clear();
  listenersByStackId.clear();
}
