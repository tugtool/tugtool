/**
 * text-card-options-sheet.tsx — the Text card's editor options, as a
 * pane-modal sheet.
 *
 * These controls used to hang off a gear button in the card's own top strip,
 * anchored as a `TugPopover`. The strip is gone — the card says its name in
 * the pane's masthead now, and its verbs are rows in the pane's `…` menu. A
 * flat menu row can invoke a command but it cannot anchor a popover, so the
 * options surface becomes a sheet: the card already presents its save,
 * conflict, and revert decisions that way, and this joins that family.
 *
 * `TextCardControls` is unchanged and still shared with the Settings card's
 * Text Card tab, so the two surfaces stay identical. The controls are
 * card-local: this sheet reads and writes through `useTextCardSettings` for
 * the card it was opened on, so a change takes effect in that card only.
 *
 * Laws: [L02] settings enter through `useTextCardSettings`'s
 * `useSyncExternalStore` subscription, so a change repaints the open sheet;
 * [L19]/[use-tug-components] composes `TugSheet`'s presenter and the real
 * shared controls rather than restating either.
 *
 * @module components/tugways/cards/text-card-options-sheet
 */

import React from "react";

import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import { useTextCardSettings } from "@/lib/use-text-card-settings";
import { TextCardControls } from "./text-card-controls";

type ShowSheet = (options: ShowSheetOptions) => Promise<string | undefined>;

/**
 * The sheet's body. A component rather than inline markup because it holds a
 * live subscription: the sheet's `content` render function runs once, so a
 * setting changed inside the sheet has to repaint from the store rather than
 * from a value captured at present time.
 */
function TextCardOptionsSheetBody({ cardId }: { cardId: string }): React.ReactElement {
  const { settings, setSetting } = useTextCardSettings(cardId);
  return (
    <div
      className="text-card-options"
      data-slot="text-card-options"
      data-testid="text-card-options"
    >
      <TextCardControls settings={settings} onChange={setSetting} />
    </div>
  );
}

/** Present the editor options for `cardId`. Resolves when the sheet closes. */
export function presentTextCardOptionsSheet(
  showSheet: ShowSheet,
  cardId: string,
): Promise<string | undefined> {
  return showSheet({
    title: "Text Card Settings",
    displayWidth: "md",
    content: () => <TextCardOptionsSheetBody cardId={cardId} />,
  });
}
