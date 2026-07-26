/**
 * layouts-section.tsx — the Lens **Layouts** section: the deck's layout picker.
 *
 * Every layout decision the deck has is made here, on two axes. The side
 * control says which side the Lens holds; the kind rows say how the cards are
 * arranged in what is left. Both write the deck's `imposition` record — one
 * field each — so "where is the Lens" is a layout question answered beside the
 * other layout questions rather than in an app-wide preference somewhere else.
 *
 * Every option is a picture of the result ({@link LayoutMiniature}) rather than
 * a label for it. The pictures read the *live* Lens side, so choosing Lens Left
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
 * the controls are `TugChoiceGroup` and `TugRadioGroup`, composed rather than
 * hand-rolled.
 *
 * @module components/lens/sections/layouts-section
 */

import "./layouts-section.css";

import React, { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { Columns3 } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { setSectionContent } from "@/components/lens/lens-section-content";
import { LayoutMiniature } from "@/components/lens/layout-miniature";
import { dispatchAction } from "@/action-dispatch";
import { getDeckStore } from "@/lib/deck-store-registry";
import {
  IMPOSITION_KINDS,
  isImpositionKind,
  isLensSide,
  DEFAULT_LENS_SIDE,
  type DeckImposition,
  type ImpositionKind,
  type LensSide,
} from "@/lib/layout-imposer";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

/** This section's kind — its key in the section registry and section order. */
const SECTION_KIND = "layouts";

/** The choice value standing for "no imposition". */
const OFF_VALUE = "off";

/** Stable `event.sender` per group, so the section's one `selectValue` handler
 *  can tell the two axes apart. */
const SIDE_SENDER_ID = "lens-layouts-side";
const KIND_SENDER_ID = "lens-layouts-kind";

/** User-facing label for each kind. */
const KIND_LABELS: Record<ImpositionKind, string> = {
  "two-up": "Two Up",
  "three-up": "Three Up",
  "four-up": "Four Up",
};

/** The two sides, in the order the control offers them. */
const SIDES: readonly LensSide[] = ["left", "right"];

const SIDE_LABELS: Record<LensSide, string> = {
  left: "Lens on left",
  right: "Lens on right",
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

/** Live collapsed summary: the active kind's label, or "Off". The side is not
 *  summarized — the band has room for one fact and the arrangement is it. */
function LayoutsCollapsedSummary(): React.ReactElement {
  const { kind } = useImposition();
  return <>{kind === undefined ? "Off" : KIND_LABELS[kind]}</>;
}

function LayoutsSectionBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const { kind, lens } = useImposition();

  // Each side segment draws the deck with the Lens on that side and no cards:
  // the question is only which edge, so the chain would be noise in it.
  const sideItems: TugChoiceItem[] = useMemo(
    () =>
      SIDES.map((side): TugChoiceItem => ({
        value: side,
        "aria-label": SIDE_LABELS[side],
        icon: <LayoutMiniature kind={null} lens={side} selected={side === lens} />,
      })),
    [lens],
  );

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
          if (isLensSide(value)) dispatchAction({ action: "set-imposition-lens", side: value });
          return;
        }
        if (event.sender === KIND_SENDER_ID) {
          dispatchAction({
            action: "set-imposition",
            kind: isImpositionKind(value) ? value : null,
          });
        }
      },
    },
  });

  // The picker is always present and always focusable, so the section is
  // always a navigable stop for the Cmd-L seed and the Tab walk.
  useLayoutEffect(() => {
    setSectionContent(host.focusGroup, { navigable: true, populated: true });
    return () =>
      setSectionContent(host.focusGroup, { navigable: false, populated: false });
  }, [host.focusGroup]);

  return (
    <ResponderScope>
      <div
        className="layouts-section"
        data-testid="lens-layouts-section"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <TugChoiceGroup
          items={sideItems}
          value={lens}
          senderId={SIDE_SENDER_ID}
          focusGroup={host.focusGroup}
          size="sm"
          emphasis="ghost"
          sidePadding="xs"
          aria-label="Lens side"
          data-testid="lens-layouts-side"
        />

        <TugRadioGroup
          value={kind ?? OFF_VALUE}
          senderId={KIND_SENDER_ID}
          focusGroup={host.focusGroup}
          size="sm"
          className="layouts-section-kinds"
          aria-label="Layout"
          data-testid="lens-layouts-kind"
        >
          <TugRadioItem value={OFF_VALUE}>
            <span className="layouts-section-option">
              <LayoutMiniature kind={null} lens={lens} selected={kind === undefined} />
              <span className="layouts-section-option-label">Off</span>
            </span>
          </TugRadioItem>
          {IMPOSITION_KINDS.map((k) => (
            <TugRadioItem key={k} value={k}>
              <span className="layouts-section-option">
                <LayoutMiniature kind={k} lens={lens} selected={k === kind} />
                <span className="layouts-section-option-label">{KIND_LABELS[k]}</span>
              </span>
            </TugRadioItem>
          ))}
        </TugRadioGroup>
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
