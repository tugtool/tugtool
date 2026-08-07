/**
 * layouts-section.tsx — the Lens **Layouts** section: the deck's layout picker.
 *
 * Every layout decision the deck has is made here, on three axes. **Cards** says
 * how the cards are arranged; **Card Width** says how wide they read; **Sidebar
 * positions** says which edge each sidebar card holds. All three write the
 * deck's `imposition` record — so "where is the Lens" and "how wide is a
 * Session card" are layout questions answered beside the other layout questions
 * rather than in an app-wide preference somewhere else.
 *
 * The sidebar controls are **registry-driven**: one Left/Right group per card
 * that registered `layoutRole: "sidebar"`, in registration order. A third
 * sidebar card appears here by registering, with nothing to add in this file.
 *
 * The Cards axis has no *off*. One-up is the quietest arrangement rather than
 * the absence of one — a single anchor, which a card occupies only by being put
 * there — so the deck always stands under an imposition and every row's slot
 * picker is live from the first frame.
 *
 * Every group is the same control at the same scale: a named option is a
 * picture of the result ({@link LayoutMiniature}) with its name beside it, two
 * to a row — the gallery card's `P4 · Two-column rows` shape. Each option is a
 * framed tile rather than a dotted row (`TugRadioGroup emphasis="tile"`): the
 * picture is already the answer, so a dot beside it would be a second mark for
 * the same fact. The pictures read the *live* rails, so moving the Lens left
 * flips all of them at once: a tile is a scale drawing of this deck, not an
 * abstract N-up.
 *
 * Choosing a layout is the only thing that happens here; putting a card into
 * one of the kind's numbered slots happens on the rows (see
 * `lens/slot-picker.tsx`).
 *
 * Laws: [L02] the imposition record enters React through `useSyncExternalStore`
 * on the deck store; [L03] the section's content declaration is a
 * `useLayoutEffect`; [L06] the miniatures are pure props → CSS; [L11] every
 * control emits `selectValue` through the responder chain, which this section
 * turns into `set-imposition` / `set-content-width` / `set-sidebar-side`
 * dispatches; [L19] every control is a `TugRadioGroup` and every caption a
 * `TugLabel`, composed rather than hand-rolled; [L30] the section never touches
 * the deck store — it goes through the command funnel like any other door.
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
import type { MiniatureRails } from "@/components/lens/layout-miniature";
import { dispatchCommand } from "@/command-dispatch";
import { getAllRegistrations } from "@/card-registry";
import { getDeckStore } from "@/lib/deck-store-registry";
import {
  CONTENT_WIDTH_LABELS,
  CONTENT_WIDTH_PRESETS,
  IMPOSITION_KINDS,
  isContentWidth,
  isImpositionKind,
  isSidebarSide,
  sidebarSide,
  DEFAULT_CONTENT_WIDTH,
  DEFAULT_IMPOSITION_KIND,
  DEFAULT_SIDEBAR_SIDE,
  type ContentWidth,
  type DeckImposition,
  type ImpositionKind,
  type SidebarSide,
} from "@/lib/layout-imposer";
import { LENS_CARD_ID } from "@/lib/lens-card-id";
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
 *  can tell the axes apart. A sidebar group's sender carries the componentId it
 *  moves, which is how one handler serves however many sidebar cards register. */
const KIND_SENDER_ID = "lens-layouts-kind";
const WIDTH_SENDER_ID = "lens-layouts-width";
const SIDE_SENDER_PREFIX = "lens-layouts-side:";

/** Ids of the captions, so each group can point `aria-labelledby` at its own
 *  `TugLabel`. */
const KIND_CAPTION_ID = "lens-layouts-kind-caption";
const WIDTH_CAPTION_ID = "lens-layouts-width-caption";
const SIDE_CAPTION_ID_PREFIX = "lens-layouts-side-caption-";

/** The groups' focus orders. Distinct, and declared rather than defaulted,
 *  because they are separate stops: sharing an order would give two groups one
 *  focus key ([Q12]) between them, and the engine resolves a key to exactly one
 *  stop — so the other would be unreachable by any addressed placement. Being
 *  separately ordered is also what makes them separate rows of the Lens's arrow
 *  plane, which derives its rows from the orders registered in each section's
 *  group, so a vertical arrow steps from one group to the next. The sidebar
 *  groups take the orders after these, one each, in registration order. */
const LAYOUTS_KIND_FOCUS_ORDER = 0;
const LAYOUTS_WIDTH_FOCUS_ORDER = 1;
const LAYOUTS_FIRST_SIDEBAR_FOCUS_ORDER = 2;

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
const SIDES: readonly SidebarSide[] = ["left", "right"];

const SIDE_LABELS: Record<SidebarSide, string> = {
  left: "Left",
  right: "Right",
};

/** A sidebar card the deck can place, as this section needs it. */
interface SidebarEntry {
  componentId: string;
  /** The card's own name — the caption for its position control. */
  title: string;
}

/**
 * Every card registered as a sidebar, in registration order.
 *
 * The registry is fixed by the time any Lens section renders (registration is a
 * boot step), so this is a plain read rather than store-observed state — there
 * is no moment at which a card registers behind a rendered Layouts section.
 */
function sidebarEntries(): SidebarEntry[] {
  const entries: SidebarEntry[] = [];
  for (const [componentId, registration] of getAllRegistrations()) {
    if (registration.layoutRole !== "sidebar") continue;
    entries.push({
      componentId,
      title: registration.defaultMeta.title || componentId,
    });
  }
  return entries;
}

/** How many sidebar cards stand on each side, for the miniatures. */
function railsOf(
  imposition: DeckImposition,
  sidebars: readonly SidebarEntry[],
): MiniatureRails {
  const rails: MiniatureRails = {};
  for (const entry of sidebars) {
    const side = sidebarSide(imposition, entry.componentId);
    rails[side] = (rails[side] ?? 0) + 1;
  }
  return rails;
}

/** The deck's imposition record — every axis — straight from the store ([L02]). */
function useImposition(): DeckImposition {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? (() => () => {}),
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  return (
    deck?.imposition ?? {
      sidebars: { [LENS_CARD_ID]: { side: DEFAULT_SIDEBAR_SIDE } },
    }
  );
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
  const imposition = useImposition();
  const kind = imposition.kind;
  const contentWidth = imposition.contentWidth ?? DEFAULT_CONTENT_WIDTH;
  const sidebars = sidebarEntries();
  const rails = railsOf(imposition, sidebars);

  // Every control reports selection by dispatching `selectValue` up the
  // responder chain ([L11]) — there are no change callbacks — so the section
  // hosts one responder and routes by sender.
  const { ResponderScope, responderRef } = useResponder({
    id: "lens-layouts-section",
    actions: {
      [TUG_ACTIONS.SELECT_VALUE]: (event: ActionEvent) => {
        const value = event.value;
        if (typeof value !== "string") return;
        const sender = event.sender;
        if (typeof sender === "string" && sender.startsWith(SIDE_SENDER_PREFIX)) {
          if (isSidebarSide(value)) {
            dispatchCommand(TUG_ACTIONS.SET_SIDEBAR_SIDE, {
              componentId: sender.slice(SIDE_SENDER_PREFIX.length),
              side: value,
            });
          }
          return;
        }
        if (sender === WIDTH_SENDER_ID) {
          if (isContentWidth(value)) {
            dispatchCommand(TUG_ACTIONS.SET_CONTENT_WIDTH, { preset: value });
          }
          return;
        }
        if (sender === KIND_SENDER_ID && isImpositionKind(value)) {
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
                    rails={rails}
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

        {/* How wide content reads on this deck. Each option draws the live
            arrangement with its cards at that width, so the three tiles differ
            in exactly the thing the question is about. */}
        <div className="layouts-section-axis">
          <TugLabel
            id={WIDTH_CAPTION_ID}
            size="md"
            emphasis="proposal"
            className="layouts-section-caption"
          >
            Card Width
          </TugLabel>
          <TugRadioGroup
            value={contentWidth}
            senderId={WIDTH_SENDER_ID}
            focusGroup={host.focusGroup}
            focusOrder={LAYOUTS_WIDTH_FOCUS_ORDER}
            size="sm"
            emphasis="tile"
            columns={2}
            aria-labelledby={WIDTH_CAPTION_ID}
            className="layouts-section-group"
            data-testid="lens-layouts-width"
          >
            {CONTENT_WIDTH_PRESETS.map((preset) => (
              <TugRadioItem key={preset} value={preset}>
                <span className="layouts-section-option">
                  <LayoutMiniature
                    kind={kind ?? DEFAULT_IMPOSITION_KIND}
                    rails={rails}
                    width={preset}
                    selected={preset === contentWidth}
                  />
                  <span className="layouts-section-option-label">
                    {CONTENT_WIDTH_LABELS[preset]}
                  </span>
                </span>
              </TugRadioItem>
            ))}
          </TugRadioGroup>
        </div>

        {/* Which edge each sidebar card holds — one group per registered
            sidebar. Each option draws the deck with that card on that side and
            no cards in the band: the question is only which edge, so the chain
            would be noise in it. */}
        {sidebars.map((entry, index) => {
          const side = sidebarSide(imposition, entry.componentId);
          const captionId = `${SIDE_CAPTION_ID_PREFIX}${entry.componentId}`;
          return (
            <div className="layouts-section-axis" key={entry.componentId}>
              <TugLabel
                id={captionId}
                size="md"
                emphasis="proposal"
                className="layouts-section-caption"
              >
                {entry.title} Position
              </TugLabel>
              <TugRadioGroup
                value={side}
                senderId={`${SIDE_SENDER_PREFIX}${entry.componentId}`}
                focusGroup={host.focusGroup}
                focusOrder={LAYOUTS_FIRST_SIDEBAR_FOCUS_ORDER + index}
                size="sm"
                emphasis="tile"
                columns={2}
                aria-labelledby={captionId}
                className="layouts-section-group"
                data-testid={`lens-layouts-side-${entry.componentId}`}
              >
                {SIDES.map((option) => (
                  <TugRadioItem key={option} value={option}>
                    <span className="layouts-section-option">
                      <LayoutMiniature
                        kind={null}
                        rails={{ [option]: 1 }}
                        cards={false}
                        selected={option === side}
                      />
                      <span className="layouts-section-option-label">
                        {SIDE_LABELS[option]}
                      </span>
                    </span>
                  </TugRadioItem>
                ))}
              </TugRadioGroup>
            </div>
          );
        })}
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
