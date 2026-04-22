/**
 * pane-focus-controller.ts — sole authority for the `data-focused` DOM
 * attribute on every `.tug-pane[data-pane-id]` element within the deck
 * root.
 *
 * Commit 0 establishes the DOM-authority contract:
 *
 *   - Reads: the store's `activePaneId` (snapshot-reactive via
 *     `useSyncExternalStore`) and the deck root ref.
 *   - Writes: `data-focused="true"` on the active pane's frame,
 *     `data-focused="false"` on every other pane's frame. Writes
 *     happen in `useLayoutEffect` post-commit so newly-mounted panes
 *     (added via a store change) receive their attribute before
 *     paint — no flicker.
 *
 * React no longer renders `data-focused` from a prop. `TugPane`'s
 * former `isFocused` prop is gone. React's reconciler therefore
 * never considers or clobbers this attribute; the controller is the
 * sole writer for its lifetime.
 *
 * Commit 1 extends this hook with a document-level capture-phase
 * `pointerdown` listener that classifies clicks and drives pane
 * activation / canvas deselect. That addition does not change the
 * attribute-authority contract established here.
 *
 * CSS contract: rules keyed on `[data-focused="true"]` match the
 * focused pane. Rules that used to match `[data-focused="false"]`
 * are rewritten to match `:not([data-focused="true"])` so the
 * absent-attribute window between pane DOM insertion and the first
 * controller apply is treated as unfocused by default.
 *
 * Tuglaws:
 *   - **L06** — pane focus is appearance state (only consumer is
 *     CSS); lives in the DOM, not React.
 *   - **L10** — controller owns exactly one responsibility: pane
 *     focus authority.
 *   - **L22** — store observer drives direct DOM mutation. We use
 *     `useSyncExternalStore` purely for reactivity (tied to the
 *     React commit cycle that also reconciles the pane DOM nodes
 *     themselves); the attribute value never enters React's virtual
 *     DOM, so no round-trip through React state.
 *
 * @module components/chrome/pane-focus-controller
 */

import { useLayoutEffect, useSyncExternalStore } from "react";

import { useDeckManager } from "@/deck-manager-context";

export function usePaneFocusController(
  deckRootRef: React.RefObject<HTMLDivElement | null>,
): void {
  const store = useDeckManager();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const activePaneId = snapshot.activePaneId ?? null;

  useLayoutEffect(() => {
    const root = deckRootRef.current;
    if (!root) return;
    const panes = root.querySelectorAll<HTMLElement>(
      ".tug-pane[data-pane-id]",
    );
    for (const pane of panes) {
      pane.dataset.focused =
        pane.dataset.paneId === activePaneId ? "true" : "false";
    }
  }, [activePaneId, snapshot, deckRootRef]);
}
