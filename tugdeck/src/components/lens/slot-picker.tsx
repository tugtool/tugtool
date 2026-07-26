/**
 * slot-picker.tsx — the numbered slot buttons on a Lens list row.
 *
 * One small button per slot in the deck's active imposition, rendered 1-based;
 * clicking one dispatches `assign-slot` to put that row's card there. The
 * button for the slot the card's pane currently holds is filled. Nothing
 * renders at all when no imposition is active — the picker is the arrangement's
 * affordance, not a permanent row fixture.
 *
 * Clicking a number always assigns *and* raises, even when another pane already
 * holds that slot: a slot is a vertical stack, and the Lens list is the
 * switching surface. There is no toggle-off; a pane leaves its slot by being
 * dragged out or by the imposition being turned off.
 *
 * Laws: [L02] the imposition and the host pane's slot enter React through
 * `useSyncExternalStore` on the deck store; [L11] each button is a control that
 * emits an action.
 *
 * @module components/lens/slot-picker
 */

import "./slot-picker.css";

import React, { useSyncExternalStore } from "react";

import { dispatchAction } from "@/action-dispatch";
import { getDeckStore } from "@/lib/deck-store-registry";
import { slotCount } from "@/lib/layout-imposer";
import { TugIconButton } from "@/components/tugways/tug-icon-button";

/**
 * The numbered cluster for the row that represents `cardId`. Renders `null`
 * when the deck has no active imposition.
 */
export function SlotPicker({ cardId }: { cardId: string }): React.ReactElement | null {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? (() => () => {}),
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );

  const imposition = deck?.imposition;
  if (imposition === undefined) return null;

  const host = deck?.panes.find((pane) => pane.cardIds.includes(cardId));
  // A card hosted in the anchored rail is not the imposer's to place — the rail
  // already derives its geometry from its anchor edge. Lens rows never
  // represent the rail today; the guard keeps the picker honest if one ever
  // does.
  const disabled = host === undefined || host.anchor !== undefined;
  const held = host?.slot;

  return (
    <span className="slot-picker" data-testid="lens-slot-picker">
      {Array.from({ length: slotCount(imposition) }, (_, slot) => (
        <TugIconButton
          key={slot}
          className="slot-picker-button"
          icon={slot + 1}
          size="2xs"
          emphasis={held === slot ? "filled" : "ghost"}
          disabled={disabled}
          aria-label={`Put at position ${slot + 1}`}
          title={`Position ${slot + 1}`}
          onClick={(e) => {
            // Assigning is not a row activation — stop it reaching the cell.
            e?.stopPropagation();
            dispatchAction({ action: "assign-slot", cardId, slot });
          }}
        />
      ))}
    </span>
  );
}
