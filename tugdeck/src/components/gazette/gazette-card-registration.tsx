/**
 * gazette-card-registration.tsx — registers the Gazette card ([L25]).
 *
 * The Gazette is an ordinary registered card hosted by the normal `CardHost`
 * inside a sidebar pane, exactly as Jots and the Lens are: the pane/card
 * machinery (FocusContext, responder scope, title-bar chrome, the [L12]
 * selection boundary `CardHost` registers per card) is what makes focus restore
 * and the rail's own affordances nearly free.
 *
 * INVARIANT: `registerGazetteCard()` MUST run at boot unconditionally and
 * before the deck restores its layout — `filterRegisteredCards` drops panes
 * whose only card's componentId is unregistered at load, so a gated Gazette
 * card would evaporate its rail on every reload.
 *
 * `family: "gazette"` (a family no free pane's `acceptsFamilies` lists) plus
 * `acceptsFamilies: []` makes the card un-mergeable in both directions.
 *
 * @module components/gazette/gazette-card-registration
 */

import React from "react";
import { registerCard } from "@/card-registry";
import { GAZETTE_CARD_ID } from "@/lib/gazette-card-id";
import { GazetteContent } from "./gazette-card";

export { GAZETTE_CARD_ID };

/** The width the Gazette rail opens at before the user has sized it. Wider
 *  than Jots: a post is prose, and prose wants a measure. */
export const DEFAULT_GAZETTE_WIDTH_PX = 460;

/** The narrowest a post's body and its ref chips still read at. */
export const MIN_GAZETTE_WIDTH_PX = 320;

/** Register the Gazette card. `hidden` keeps it out of the type-picker `[+]`
 *  menu — it is reachable through its own toggle, like Jots and the Lens. */
export function registerGazetteCard(): void {
  registerCard({
    componentId: GAZETTE_CARD_ID,
    family: "gazette",
    acceptsFamilies: [],
    contentFactory: (cardId: string) => <GazetteContent cardId={cardId} />,
    defaultMeta: { title: "Gazette", closable: true },
    hidden: true,
    // Pins to a deck edge and insets the imposition band rather than taking a
    // slot inside it.
    layoutRole: "sidebar",
    // Out of the Lens's Cards list, as Jots and the Lens itself are: those rows
    // are the deck's content cards, each carrying a slot picker for an
    // arrangement a rail can never stand in.
    lensGroup: "none",
    sizePolicy: {
      min: { width: MIN_GAZETTE_WIDTH_PX, height: 240 },
      preferred: { width: DEFAULT_GAZETTE_WIDTH_PX, height: 900 },
    },
  });
}
