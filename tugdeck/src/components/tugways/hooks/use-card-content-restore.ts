/**
 * use-card-content-restore.ts — host-side hook that runs the mount-time
 * content-restore effect for a card.
 *
 * On mount (and when `cardId` / `hostStackId` change), consults
 * `DeckManager.getCardState(cardId)` for a saved `CardStateBag` and
 * rehydrates scroll, selection, and content-payload state.
 *
 * Two branches:
 *
 *   1. **Persistence-aware content.** If `persistenceCallbacksRef` carries
 *      a `restorePendingRef` and the bag has `content`, the hook:
 *        - captures pending scroll / selection into refs;
 *        - hides the host element via `visibility: hidden` while the child
 *          commits (prevents a visible scroll-jump);
 *        - installs an `onContentReady` callback that the child fires
 *          via its own `useLayoutEffect` after commit — the canonical
 *          child-driven ready-callback pattern [L04, D78];
 *        - sets `restorePendingRef.current = true` and calls `onRestore`;
 *        - cleanup resets `restorePendingRef`, pending refs, and
 *          `visibility` to defend against unmount mid-restore.
 *
 *   2. **No persistence callback.** Apply scroll / selection synchronously
 *      against the host element and `selectionGuard`.
 *
 * This hook exists to uphold [L23] across detach, merge, and
 * cross-pane moves: the saved `CardStateBag` is the durable backing of
 * scroll, selection, and content payload. Re-roots never unmount the
 * React tree (`CardPortal` identity) — but a re-mount on cold launch does
 * trigger this hook and re-apply the saved state.
 *
 * [L03, L04, L05, L23, D01, D02, D03, D78, D79]
 *
 * @module components/tugways/hooks/use-card-content-restore
 */

import { useLayoutEffect, useRef } from "react";

import { useDeckManager } from "@/deck-manager-context";
import { selectionGuard } from "@/components/tugways/selection-guard";
import type { SavedSelection } from "@/components/tugways/selection-guard";
import type { CardPersistenceCallbacks } from "@/components/tugways/use-card-persistence";

export interface UseCardContentRestoreArgs {
  cardId: string;
  hostStackId: string;
  hostContentEl: HTMLDivElement | null;
  persistenceCallbacksRef: React.RefObject<CardPersistenceCallbacks | null>;
}

export function useCardContentRestore(args: UseCardContentRestoreArgs): void {
  const { cardId, hostStackId, hostContentEl, persistenceCallbacksRef } = args;
  const store = useDeckManager();

  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const pendingSelectionRef = useRef<SavedSelection | null>(null);

  useLayoutEffect(() => {
    const bag = store.getCardState(cardId);
    if (!bag || (bag.scroll === undefined && bag.selection == null && bag.content === undefined)) return;

    // `hostContentEl` is captured by closure at effect-run time. The effect
    // depends on `[cardId, hostStackId]` only — restore fires once per card
    // identity, not on every host-element swap — so the closure-captured
    // element is the one present at that fire.
    const contentEl = hostContentEl;

    const hasPersistence =
      persistenceCallbacksRef.current !== null &&
      persistenceCallbacksRef.current.restorePendingRef !== undefined &&
      bag.content !== undefined;

    if (hasPersistence) {
      pendingScrollRef.current = bag.scroll ?? null;
      pendingSelectionRef.current = bag.selection ?? null;

      let didHide = false;
      if (contentEl && bag.scroll !== undefined) {
        contentEl.style.visibility = "hidden";
        didHide = true;
      }

      persistenceCallbacksRef.current!.onContentReady = () => {
        if (contentEl && pendingScrollRef.current !== null) {
          contentEl.scrollLeft = pendingScrollRef.current.x;
          contentEl.scrollTop = pendingScrollRef.current.y;
        }
        if (didHide && contentEl) {
          contentEl.style.visibility = "";
        }
        if (pendingSelectionRef.current != null) {
          selectionGuard.restoreSelection(hostStackId, pendingSelectionRef.current);
        }
        pendingScrollRef.current = null;
        pendingSelectionRef.current = null;
      };

      persistenceCallbacksRef.current!.restorePendingRef!.current = true;
      persistenceCallbacksRef.current!.onRestore(bag.content!);

      return () => {
        if (persistenceCallbacksRef.current?.restorePendingRef) {
          persistenceCallbacksRef.current.restorePendingRef.current = false;
        }
        pendingScrollRef.current = null;
        pendingSelectionRef.current = null;
        if (didHide && contentEl) {
          contentEl.style.visibility = "";
        }
      };
    } else {
      if (contentEl && bag.scroll !== undefined) {
        contentEl.scrollLeft = bag.scroll.x;
        contentEl.scrollTop = bag.scroll.y;
      }
      if (bag.selection != null) {
        selectionGuard.restoreSelection(hostStackId, bag.selection);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, hostStackId]);
}
