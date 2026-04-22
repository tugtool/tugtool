/**
 * use-card-dirty-state.ts — host-side hook that owns a card's
 * dirty-bit + debounced auto-save pipeline, plus the scroll and
 * `selectionchange` listeners that feed it.
 *
 * Returns a stable `markDirty` callback the harness hands to
 * `CardDirtyContext`. Card content calls `markDirty()` on every
 * semantic edit (via `useCardDirty`). The hook additionally listens for
 * scroll and within-card `selectionchange` events on the host pane's
 * content element and calls `markDirty()` itself — user-visible state
 * that is not routed through the content component still becomes part of
 * the debounced save.
 *
 * The save callback is supplied as a ref so the debounced timer reads
 * the latest save closure at fire time [L07]. The harness writes
 * `saveRef.current` fresh every render so no stale captures can survive
 * a re-render.
 *
 * The scroll listener uses `{ passive: true }` since the handler never
 * calls `preventDefault`. The `selectionchange` listener is registered
 * on `document` (the only surface that dispatches `selectionchange` for
 * the current cross-browser API) and filters by
 * `contentEl.contains(anchorNode)` so only within-card selection
 * changes mark the card dirty.
 *
 * [L06] (debounce timer is a ref, not React state),
 * [L07] (saveRef read at fire time),
 * [L23] (the debounced save is the mechanism that preserves scroll
 * and selection across re-mount).
 *
 * @module components/tugways/hooks/use-card-dirty-state
 */

import { useCallback, useEffect, useRef } from "react";

const AUTO_SAVE_DEBOUNCE_MS = 1000;

export interface UseCardDirtyStateArgs {
  hostContentEl: HTMLDivElement | null;
  saveRef: React.RefObject<() => void>;
}

export function useCardDirtyState(args: UseCardDirtyStateArgs): () => void {
  const { hostContentEl, saveRef } = args;

  const autoSaveTimerRef = useRef<number | null>(null);

  const markDirty = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      saveRef.current();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, [saveRef]);

  useEffect(() => {
    const contentEl = hostContentEl;
    if (!contentEl) return;

    const handleScroll = () => markDirty();
    contentEl.addEventListener("scroll", handleScroll, { passive: true });

    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode;
      if (anchor && contentEl.contains(anchor)) {
        markDirty();
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      contentEl.removeEventListener("scroll", handleScroll);
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [hostContentEl, markDirty]);

  return markDirty;
}
