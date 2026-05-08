/**
 * Pane frame registry — maps a pane id to that pane's outer frame
 * `HTMLDivElement` (the `<div class="tug-pane">` rendered by `TugPane`).
 * Used as a bridge so card content rendered via portal at the deck level
 * can re-provide `TugPaneFrameContext` pointing at its host pane's
 * frame.
 *
 * Without this bridge, pane-modal surfaces inside card content (e.g.
 * `TugSheet`) lose access to the frame element they need as their
 * portal target when `CardHost` moves out of the pane's React tree.
 * Pane-modal surfaces would then fall back to portaling into
 * `document.body` and lose the per-pane stacking story [D19, D20].
 *
 * Parallel to `pane-root-registry` which tracks the inner chrome div
 * (`.tug-pane-chrome`). Same wire shape, different element.
 *
 * @module components/chrome/pane-frame-registry
 */

type Listener = () => void;

const frames = new Map<string, HTMLDivElement>();
const listenersByPaneId = new Map<string, Set<Listener>>();

function notify(paneId: string): void {
  const set = listenersByPaneId.get(paneId);
  if (!set) return;
  for (const cb of set) cb();
}

export function register(paneId: string, el: HTMLDivElement): void {
  const prev = frames.get(paneId);
  if (prev === el) return;
  frames.set(paneId, el);
  notify(paneId);
}

export function unregister(paneId: string): void {
  if (!frames.has(paneId)) return;
  frames.delete(paneId);
  notify(paneId);
}

export function getElement(paneId: string): HTMLDivElement | null {
  return frames.get(paneId) ?? null;
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
  frames.clear();
  listenersByPaneId.clear();
}
