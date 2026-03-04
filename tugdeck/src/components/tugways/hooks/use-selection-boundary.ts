/**
 * useSelectionBoundary -- Register a card content area as a SelectionGuard boundary.
 *
 * Part of the Phase 5a selection model (tugplan-tugways-phase-5a-selection-model.md).
 *
 * Card authors never call this hook directly -- it is called internally by Tugcard
 * (Step 5) to register its content area div with the SelectionGuard singleton.
 *
 * ## How it fits
 *
 * SelectionGuard ([D02]) is a module-level singleton that clips selection at
 * runtime when a drag or keyboard extension escapes a card's boundary. It needs
 * to know which `HTMLElement` corresponds to each card's content area so it can:
 *   - Start tracking when `pointerdown` lands inside the element ([D03])
 *   - Clamp selection focus to the element's bounding rect during drag
 *   - Clip keyboard-driven selection extension via `selectionchange` ([D04])
 *   - Scope `saveSelection` / `restoreSelection` per card (Phase 5b)
 *
 * This hook is an appearance-zone hook: it produces no React state, no
 * re-renders, and registers/unregisters purely as a side effect.
 *
 * ## Design Decisions
 *
 * - [D02] SelectionGuard module-level singleton — imported directly, no context
 * - Spec S02 hook signature: `(cardId: string, contentRef: React.RefObject<HTMLElement | null>)`
 *
 * @module hooks/use-selection-boundary
 */

import { useLayoutEffect } from "react";
import { selectionGuard } from "../selection-guard";

/**
 * Register a card content area as a selection boundary with SelectionGuard.
 *
 * Calls `selectionGuard.registerBoundary(cardId, element)` when the ref
 * attaches, and `selectionGuard.unregisterBoundary(cardId)` on cleanup
 * (component unmount or cardId change).
 *
 * Safe against null refs: if `contentRef.current` is null when the effect
 * runs, the hook is a no-op for that render cycle.
 *
 * The `cardId` is included in the dependency array so re-registration fires
 * automatically if the card's id changes (uncommon but possible).
 *
 * @param cardId     - The card's unique identifier
 * @param contentRef - React ref to the card's content area div
 */
export function useSelectionBoundary(
  cardId: string,
  contentRef: React.RefObject<HTMLElement | null>
): void {
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    selectionGuard.registerBoundary(cardId, el);
    return () => {
      selectionGuard.unregisterBoundary(cardId);
    };
    // contentRef is intentionally excluded: React ref objects are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);
}
