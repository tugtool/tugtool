/**
 * `CardPicker` — pick which card the active inspector reads.
 *
 * Composed from `TugPopupMenu` + `TugButton` (the same pattern the
 * gallery uses for callback-style menus — see `gallery-popup-button.tsx`).
 * Enumerates cards via `deckManager.subscribe` + `useSyncExternalStore`
 * ([L02]).
 *
 * Empty state — no cards open: the trigger is disabled and shows
 * "No cards open." The inspector below handles the
 * "no card selected but cards exist" case with its own empty row.
 *
 * @module components/tug-dev-panel/card-picker
 */

import React, { useCallback, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDeckManager } from "@/deck-manager-context";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import type { TugPopupMenuItem } from "@/components/tugways/internal/tug-popup-menu";

/**
 * Sentinel id meaning "clear the selection." Distinct from any real
 * card id (which are workspace-key derived).
 */
const CLEAR_SELECTION_ID = "__tugdevpanel_clear__";

export interface CardPickerProps {
  selectedCardId: string | null;
  onSelect: (cardId: string | null) => void;
  className?: string;
}

export const CardPicker: React.FC<CardPickerProps> = ({
  selectedCardId,
  onSelect,
  className,
}) => {
  const deck = useDeckManager();
  const cards = useSyncExternalStore(
    deck.subscribe,
    () => deck.getSnapshot().cards,
  );

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id === CLEAR_SELECTION_ID ? null : id);
    },
    [onSelect],
  );

  // Trigger label — reads the selected card's title when known, falls
  // back to a placeholder when nothing is selected.
  const selectedCard = selectedCardId
    ? cards.find((c) => c.id === selectedCardId) ?? null
    : null;
  const triggerLabel = selectedCard
    ? `${selectedCard.title || selectedCard.componentId} · ${selectedCard.id.slice(0, 8)}`
    : "— select a card —";

  // Menu items — one per card, plus a "Clear selection" entry when a
  // card is currently selected (so the user can return to the empty
  // state without closing the panel).
  const items: TugPopupMenuItem[] = cards.map((card) => ({
    id: card.id,
    label: `${card.title || card.componentId} · ${card.id.slice(0, 8)}`,
  }));
  if (selectedCardId !== null) {
    items.unshift({
      id: CLEAR_SELECTION_ID,
      label: "Clear selection",
    });
  }

  const empty = cards.length === 0;

  return (
    <div className={cn("tug-devpanel-cardpicker", className)}>
      <TugLabel size="3xs" color="muted" className="tug-devpanel-cardpicker-label">
        Card
      </TugLabel>
      {empty ? (
        <TugButton
          emphasis="outlined"
          role="option"
          size="xs"
          disabled
          trailingIcon={<ChevronDown size={10} />}
          className="tug-devpanel-cardpicker-trigger"
        >
          No cards open
        </TugButton>
      ) : (
        <TugPopupMenu
          trigger={
            <TugButton
              emphasis="outlined"
              role="option"
              size="xs"
              trailingIcon={<ChevronDown size={10} />}
              className="tug-devpanel-cardpicker-trigger"
              aria-label="Select inspected card"
            >
              {triggerLabel}
            </TugButton>
          }
          items={items}
          onSelect={handleSelect}
        />
      )}
    </div>
  );
};
CardPicker.displayName = "CardPicker";
