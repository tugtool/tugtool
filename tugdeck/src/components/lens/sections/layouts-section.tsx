/**
 * layouts-section.tsx — the Lens **Layouts** section: the imposition picker.
 *
 * One `TugRadioGroup` choosing the deck's active imposition — Off, Two Up,
 * Three Up, Four Up. Choosing a kind is the only thing that happens here;
 * assigning a card to one of the kind's numbered slots happens on the Sessions
 * and Text Files rows (see `lens/slot-picker.tsx`).
 *
 * Each option wears a small diagram of the arrangement it names, drawn inline
 * so it inherits the theme's currentColor and needs no image asset.
 *
 * Laws: [L02] the active kind enters React through `useSyncExternalStore` on
 * the deck store; [L03] the section's content declaration is a
 * `useLayoutEffect`; [L11] the radio group emits a `selectValue` action through
 * the responder chain, which this section turns into a `set-imposition`
 * dispatch.
 *
 * @module components/lens/sections/layouts-section
 */

import "./layouts-section.css";

import React, { useLayoutEffect, useSyncExternalStore } from "react";
import { Columns3 } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { setSectionContent } from "@/components/lens/lens-section-content";
import { dispatchAction } from "@/action-dispatch";
import { getDeckStore } from "@/lib/deck-store-registry";
import {
  IMPOSITION_KINDS,
  isImpositionKind,
  slotCount,
  type ImpositionKind,
} from "@/lib/layout-imposer";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

/** This section's kind — its key in the section registry and section order. */
const SECTION_KIND = "layouts";

/** The radio value standing for "no imposition". */
const OFF_VALUE = "off";

/** Stable `event.sender` for the kind group, so the section's `selectValue`
 *  handler can tell it apart from any future group in this body. */
const KIND_SENDER_ID = "lens-layouts-kind";

/** User-facing label for each kind. */
const KIND_LABELS: Record<ImpositionKind, string> = {
  "two-up": "Two Up",
  "three-up": "Three Up",
  "four-up": "Four Up",
};

/** The active imposition, straight from the deck store ([L02]). */
function useImposition(): ImpositionKind | undefined {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? (() => () => {}),
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  return deck?.imposition;
}

/**
 * The arrangement diagram on an option's label: `count` columns across a frame,
 * or one wide block for Off. Drawn in `currentColor` so it takes the row's
 * text color, including the selected and disabled states.
 */
function KindDiagram({ count }: { count: number }): React.ReactElement {
  const WIDTH = 34;
  const HEIGHT = 14;
  const GAP = 2;
  const columnWidth = (WIDTH - GAP * (count - 1)) / count;
  return (
    <svg
      className="layouts-diagram"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: count }, (_, i) => (
        <rect
          key={i}
          x={i * (columnWidth + GAP)}
          y={0}
          width={columnWidth}
          height={HEIGHT}
          rx={1.5}
        />
      ))}
    </svg>
  );
}

/** Live collapsed summary: the active kind's label, or "Off". */
function LayoutsCollapsedSummary(): React.ReactElement {
  const imposition = useImposition();
  return <>{imposition === undefined ? "Off" : KIND_LABELS[imposition]}</>;
}

function LayoutsSectionBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const imposition = useImposition();

  // The radio group reports selection by dispatching `selectValue` up the
  // responder chain ([L11]) — there is no change callback — so the section
  // hosts a responder to catch it and turn it into the deck action.
  const { ResponderScope, responderRef } = useResponder({
    id: "lens-layouts-section",
    actions: {
      [TUG_ACTIONS.SELECT_VALUE]: (event: ActionEvent) => {
        if (event.sender !== KIND_SENDER_ID) return;
        const value = event.value;
        if (typeof value !== "string") return;
        dispatchAction({
          action: "set-imposition",
          kind: isImpositionKind(value) ? value : null,
        });
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
        <TugRadioGroup
          value={imposition ?? OFF_VALUE}
          senderId={KIND_SENDER_ID}
          focusGroup={host.focusGroup}
          size="sm"
          aria-label="Layout"
        >
          <TugRadioItem value={OFF_VALUE}>
            <span className="layouts-option">
              <KindDiagram count={1} />
              <span className="layouts-option-label">Off</span>
            </span>
          </TugRadioItem>
          {IMPOSITION_KINDS.map((kind) => (
            <TugRadioItem key={kind} value={kind}>
              <span className="layouts-option">
                <KindDiagram count={slotCount(kind)} />
                <span className="layouts-option-label">{KIND_LABELS[kind]}</span>
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
