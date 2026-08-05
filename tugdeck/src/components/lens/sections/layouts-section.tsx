/**
 * layouts-section.tsx — the Lens **Layouts** section: the deck's layout picker.
 *
 * Every layout decision the deck has is made here, on two axes. **Lens
 * Position** says which side the Lens holds; **Cards** says how the cards are
 * arranged in what is left. Both write the deck's `imposition` record — one
 * field each — so "where is the Lens" is a layout question answered beside the
 * other layout questions rather than in an app-wide preference somewhere else.
 *
 * The Cards axis has no *off*. One-up is the quietest arrangement rather than
 * the absence of one — a single anchor, which a card occupies only by being put
 * there — so the deck always stands under an imposition and every row's slot
 * picker is live from the first frame.
 *
 * Both groups are the same control at the same scale: a named option is a
 * picture of the result ({@link LayoutMiniature}) with its name beside it, two
 * to a row — the gallery card's `P4 · Two-column rows` shape. Each option is a
 * framed tile rather than a dotted row (`TugRadioGroup emphasis="tile"`): the
 * picture is already the answer, so a dot beside it would be a second mark for
 * the same fact. The pictures read the *live* Lens side, so choosing Lens Left
 * flips all of them at once: a tile is a scale drawing of this deck, not an
 * abstract N-up.
 *
 * Choosing a layout is the only thing that happens here; putting a card into
 * one of the kind's numbered slots happens on the rows (see
 * `lens/slot-picker.tsx`).
 *
 * Laws: [L02] the imposition record enters React through `useSyncExternalStore`
 * on the deck store; [L03] the section's content declaration is a
 * `useLayoutEffect`; [L06] the miniatures are pure props → CSS; [L11] both
 * controls emit `selectValue` through the responder chain, which this section
 * turns into `set-imposition-lens` / `set-imposition` dispatches; [L19]/[L20]
 * both controls are `TugRadioGroup`s and both captions are `TugLabel`s,
 * composed rather than hand-rolled.
 *
 * @module components/lens/sections/layouts-section
 */

import "./layouts-section.css";

import React, { useLayoutEffect, useSyncExternalStore } from "react";
import { Columns3 } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { setSectionContent } from "@/components/lens/lens-section-content";
import { LayoutMiniature } from "@/components/lens/layout-miniature";
import { dispatchCommand } from "@/command-dispatch";
import { getDeckStore } from "@/lib/deck-store-registry";
import {
  IMPOSITION_KINDS,
  isImpositionKind,
  isLensSide,
  DEFAULT_IMPOSITION_KIND,
  DEFAULT_LENS_SIDE,
  type DeckImposition,
  type ImpositionKind,
  type LensSide,
} from "@/lib/layout-imposer";
import { TugLabel } from "@/components/tugways/tug-label";
import {
  TugRadioGroup,
  TugRadioItem,
} from "@/components/tugways/tug-radio-group";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

/** This section's kind — its key in the section registry and section order. */
const SECTION_KIND = "layouts";

/** Stable `event.sender` per group, so the section's one `selectValue` handler
 *  can tell the two axes apart. */
const SIDE_SENDER_ID = "lens-layouts-side";
const KIND_SENDER_ID = "lens-layouts-kind";

/** Ids of the two captions, so each group can point `aria-labelledby` at its
 *  own `TugLabel`. */
const SIDE_CAPTION_ID = "lens-layouts-side-caption";
const KIND_CAPTION_ID = "lens-layouts-kind-caption";

/** The two groups' focus orders. Distinct, and declared rather than defaulted,
 *  because they are two stops: sharing an order would give them one focus key
 *  ([Q12]) between them, and the engine resolves a key to exactly one stop — so
 *  the other would be unreachable by any addressed placement. Being separately
 *  ordered is also what makes them separate rows of the Lens's arrow plane,
 *  which derives its rows from the orders registered in each section's group,
 *  so a vertical arrow steps from one group to the other. */
const LAYOUTS_SIDE_FOCUS_ORDER = 0;
const LAYOUTS_KIND_FOCUS_ORDER = 1;

/** User-facing label for each kind. */
const KIND_LABELS: Record<ImpositionKind, string> = {
  "one-up": "One Up",
  "two-up": "Two Up",
  "three-up": "Three Up",
  "four-up": "Four Up",
  "five-up": "Five Up",
  "six-up": "Six Up",
};

/** The two sides, in the order the control offers them. */
const SIDES: readonly LensSide[] = ["left", "right"];

const SIDE_LABELS: Record<LensSide, string> = {
  left: "Left",
  right: "Right",
};

/** The deck's imposition record — both axes — straight from the store ([L02]). */
function useImposition(): DeckImposition {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? (() => () => {}),
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  return deck?.imposition ?? { lens: DEFAULT_LENS_SIDE };
}

/** Live collapsed summary: the active kind's label. The side is not summarized
 *  — the band has room for one fact and the arrangement is it. */
function LayoutsCollapsedSummary(): React.ReactElement {
  const { kind } = useImposition();
  return <>{KIND_LABELS[kind ?? DEFAULT_IMPOSITION_KIND]}</>;
}

function LayoutsSectionBody({
  host,
}: {
  host: LensSectionHost;
}): React.ReactElement {
  const { kind, lens } = useImposition();

  // Both controls report selection by dispatching `selectValue` up the
  // responder chain ([L11]) — there are no change callbacks — so the section
  // hosts one responder and routes by sender.
  const { ResponderScope, responderRef } = useResponder({
    id: "lens-layouts-section",
    actions: {
      [TUG_ACTIONS.SELECT_VALUE]: (event: ActionEvent) => {
        const value = event.value;
        if (typeof value !== "string") return;
        if (event.sender === SIDE_SENDER_ID) {
          if (isLensSide(value))
            dispatchCommand("set-imposition-lens", { side: value });
          return;
        }
        if (event.sender === KIND_SENDER_ID && isImpositionKind(value)) {
          dispatchCommand("set-imposition", { kind: value });
        }
      },
    },
  });

  // The picker is always present and always focusable, so the section is
  // always a navigable stop for the Cmd-L seed and the Tab walk.
  useLayoutEffect(() => {
    setSectionContent(host.focusGroup, { navigable: true, populated: true });
    return () =>
      setSectionContent(host.focusGroup, {
        navigable: false,
        populated: false,
      });
  }, [host.focusGroup]);

  return (
    <ResponderScope>
      <div
        className="layouts-section"
        data-testid="lens-layouts-section"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* Which edge the Lens holds. Each option draws the deck with the Lens
            on that side and no cards — the question is only which edge, so the
            chain would be noise in it. */}
        <div className="layouts-section-axis">
          <TugLabel
            id={SIDE_CAPTION_ID}
            size="md"
            emphasis="proposal"
            className="layouts-section-caption"
          >
            Lens Position
          </TugLabel>
          <TugRadioGroup
            value={lens}
            senderId={SIDE_SENDER_ID}
            focusGroup={host.focusGroup}
            focusOrder={LAYOUTS_SIDE_FOCUS_ORDER}
            size="sm"
            emphasis="tile"
            columns={2}
            aria-labelledby={SIDE_CAPTION_ID}
            className="layouts-section-group"
            data-testid="lens-layouts-side"
          >
            {SIDES.map((side) => (
              <TugRadioItem key={side} value={side}>
                <span className="layouts-section-option">
                  <LayoutMiniature
                    kind={null}
                    lens={side}
                    cards={false}
                    selected={side === lens}
                  />
                  <span className="layouts-section-option-label">
                    {SIDE_LABELS[side]}
                  </span>
                </span>
              </TugRadioItem>
            ))}
          </TugRadioGroup>
        </div>

        <div className="layouts-section-axis">
          <TugLabel
            id={KIND_CAPTION_ID}
            size="md"
            emphasis="proposal"
            className="layouts-section-caption"
          >
            Cards
          </TugLabel>
          <TugRadioGroup
            value={kind ?? DEFAULT_IMPOSITION_KIND}
            senderId={KIND_SENDER_ID}
            focusGroup={host.focusGroup}
            focusOrder={LAYOUTS_KIND_FOCUS_ORDER}
            size="sm"
            emphasis="tile"
            columns={2}
            aria-labelledby={KIND_CAPTION_ID}
            className="layouts-section-group"
            data-testid="lens-layouts-kind"
          >
            {IMPOSITION_KINDS.map((k) => (
              <TugRadioItem key={k} value={k}>
                <span className="layouts-section-option">
                  <LayoutMiniature
                    kind={k}
                    lens={lens}
                    selected={k === (kind ?? DEFAULT_IMPOSITION_KIND)}
                  />
                  <span className="layouts-section-option-label">
                    {KIND_LABELS[k]}
                  </span>
                </span>
              </TugRadioItem>
            ))}
          </TugRadioGroup>
        </div>
      </div>
    </ResponderScope>
  );
}

/** Register the Layouts section. Called once at boot from `main.tsx`. */
export function registerLayoutsSection(): void {
  registerLensSection({
    kind: SECTION_KIND,
    title: "Layouts",
    glyph: <Columns3 size={14} />,
    collapsedSummary: () => <LayoutsCollapsedSummary />,
    body: (host) => <LayoutsSectionBody host={host} />,
  });
}
