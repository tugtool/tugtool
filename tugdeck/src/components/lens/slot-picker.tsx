/**
 * slot-picker.tsx — the slot layout on a Lens list row.
 *
 * A `TugSlotLayout` in its control form: one numbered slot per slot in the
 * deck's active imposition, and clicking one dispatches `assign-slot` to put
 * that row's card there. Nothing renders at all when no imposition is active —
 * the picker is the arrangement's affordance, not a permanent row fixture.
 *
 * The three looks say where the row's card stands in the arrangement:
 *
 *  - **filled** — the card holds this slot and is the one on top of it.
 *  - **outlined** — the card holds this slot but another card is over it.
 *  - **rest** — the card is not at this position.
 *
 * A card holds at most one slot, so at most one slot in a row is ever lit.
 * Topmost is read off the deck's own stacking order: panes later in
 * `deckState.panes` sit above earlier ones, which is the same ordering
 * `deck-canvas.tsx` turns into z-index.
 *
 * Clicking a number always assigns *and* raises, even when another pane already
 * holds that slot: a slot is a vertical stack, and the Lens list is the
 * switching surface. There is no toggle-off; a pane leaves its slot by being
 * dragged out or by the imposition being turned off.
 *
 * Laws: [L02] the imposition, the host pane's slot, and the stacking order all
 * enter React through `useSyncExternalStore` on the deck store; [L11] each slot
 * is a control that emits an action.
 *
 * @module components/lens/slot-picker
 */

import "./slot-picker.css";

import React, { useSyncExternalStore } from "react";

import { dispatchAction } from "@/action-dispatch";
import { getDeckStore } from "@/lib/deck-store-registry";
import { slotCount } from "@/lib/layout-imposer";
import { TugSlotLayout } from "@/components/tugways/tug-slot-layout";
import type { TugSlotState } from "@/components/tugways/tug-slot";

/**
 * The slot layout for the row that represents `cardId`. Renders `null` when the
 * deck has no active imposition.
 */
export function SlotPicker({ cardId }: { cardId: string }): React.ReactElement | null {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? (() => () => {}),
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );

  const imposition = deck?.imposition;
  if (imposition === undefined || deck === null) return null;

  const count = slotCount(imposition);
  const hostIndex = deck.panes.findIndex((pane) => pane.cardIds.includes(cardId));
  const host = hostIndex >= 0 ? deck.panes[hostIndex] : undefined;
  // A card hosted in the anchored rail is not the imposer's to place — the rail
  // already derives its geometry from its anchor edge. Lens rows never
  // represent the rail today; the guard keeps the picker honest if one ever
  // does.
  const disabled = host === undefined || host.anchor !== undefined;
  const held = host?.slot;

  // Later in the panes array is higher in the stack, so the last pane holding
  // the slot is the one on top of it.
  const topIndexAtHeldSlot =
    held === undefined
      ? -1
      : deck.panes.reduce(
          (top, pane, index) => (pane.slot === held ? index : top),
          -1,
        );

  const states: TugSlotState[] = Array.from({ length: count }, (_, slot) => {
    if (slot !== held) return "rest";
    return hostIndex === topIndexAtHeldSlot ? "filled" : "outlined";
  });

  return (
    <TugSlotLayout
      className="slot-picker"
      data-testid="lens-slot-picker"
      count={count}
      states={states}
      disabled={disabled}
      slotLabel={(slot) => `Put at position ${slot + 1}`}
      onSelectSlot={(slot, event) => {
        // Assigning is not a row activation — stop it reaching the cell.
        event?.stopPropagation();
        dispatchAction({ action: "assign-slot", cardId, slot });
      }}
    />
  );
}
