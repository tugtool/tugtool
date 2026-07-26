/**
 * layouts-section.tsx — the Lens **Layouts** section: the imposition picker.
 *
 * Four segments choosing the deck's active imposition — Off, and one per kind.
 * Each kind's segment *is* its arrangement: a `TugSlotLayout` exemplar of the
 * very slots the Sessions and Text Files rows will offer, so the picker and the
 * rows speak in the same shapes. The chosen kind's exemplar reads filled; the
 * others rest. Off is the one word segment, because no-imposition has no
 * arrangement to draw.
 *
 * Choosing a kind is the only thing that happens here; putting a card into one
 * of the kind's numbered slots happens on the rows (see `lens/slot-picker.tsx`).
 *
 * Laws: [L02] the active kind enters React through `useSyncExternalStore` on
 * the deck store; [L03] the section's content declaration is a
 * `useLayoutEffect`; [L11] the choice group emits a `selectValue` action
 * through the responder chain, which this section turns into a
 * `set-imposition` dispatch.
 *
 * @module components/lens/sections/layouts-section
 */

import "./layouts-section.css";

import React, { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
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
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { TugSlotLayout } from "@/components/tugways/tug-slot-layout";
import type { TugSlotState } from "@/components/tugways/tug-slot";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

/** This section's kind — its key in the section registry and section order. */
const SECTION_KIND = "layouts";

/** The choice value standing for "no imposition". */
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

/** Live collapsed summary: the active kind's label, or "Off". */
function LayoutsCollapsedSummary(): React.ReactElement {
  const imposition = useImposition();
  return <>{imposition === undefined ? "Off" : KIND_LABELS[imposition]}</>;
}

function LayoutsSectionBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const imposition = useImposition();

  // The chosen kind's exemplar is filled, the rest are empty — the arrangement
  // itself carries the selection, so the segment's own indicator can stay quiet
  // (`emphasis="ghost"`).
  const items: TugChoiceItem[] = useMemo(
    () => [
      { value: OFF_VALUE, label: "Off" },
      ...IMPOSITION_KINDS.map((kind): TugChoiceItem => {
        const chosen = kind === imposition;
        const count = slotCount(kind);
        const states: TugSlotState[] = Array.from(
          { length: count },
          (): TugSlotState => (chosen ? "filled" : "rest"),
        );
        return {
          value: kind,
          "aria-label": KIND_LABELS[kind],
          icon: <TugSlotLayout count={count} states={states} size="md" />,
        };
      }),
    ],
    [imposition],
  );

  // The choice group reports selection by dispatching `selectValue` up the
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
        <TugChoiceGroup
          items={items}
          value={imposition ?? OFF_VALUE}
          senderId={KIND_SENDER_ID}
          focusGroup={host.focusGroup}
          size="sm"
          emphasis="ghost"
          sidePadding="xs"
          aria-label="Layout"
        />
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
