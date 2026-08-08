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
 * The section draws the deck **once**: the plan at the top is a scale picture
 * of the deck as it stands ({@link LayoutMiniature}), captioned with the
 * current answers. Every control under it is a compact segmented group
 * (`TugChoiceGroup`) that writes the plan. The picture-per-option idiom this
 * replaced spent a full deck drawing on every option and asked the eye to
 * diff them; here the options are words and numerals, and the *plan* is where
 * an option shows what it would do — resting a pointer on a segment, or
 * standing the movement cursor on it, swaps the plan for that option's
 * arrangement, drawn tentative (tinted blocks) rather than committed (filled).
 *
 * The previews are pre-rendered: React renders one hidden plan layer per
 * offerable option from the same store read as the committed layer, and the
 * hover/cursor handlers only toggle DOM attributes to choose which layer
 * shows. A preview is ephemeral appearance, so no React state is involved in
 * showing one ([L06]); the layers themselves are semantic data — drawings of
 * the store's candidate arrangements — and re-render when the store moves.
 *
 * Laws: [L02] the imposition record enters React through `useSyncExternalStore`
 * on the deck store; [L03] the section's content declaration is a
 * `useLayoutEffect`; [L06] preview visibility is DOM attributes toggled in
 * event handlers and a `MutationObserver`, never React state; [L11] every
 * control emits `selectValue` through the responder chain, which this section
 * turns into `set-imposition` / `set-content-width` / `set-sidebar-side`
 * dispatches; [L19] every control is a `TugChoiceGroup` and every caption a
 * `TugLabel`, composed rather than hand-rolled; [L30] the section never touches
 * the deck store — it goes through the command funnel like any other door.
 *
 * @module components/lens/sections/layouts-section
 */

import "./layouts-section.css";

import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
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
  slotCount,
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
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
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
 *  plane, so a vertical arrow steps from one group to the next. The sidebar
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

/** How many sidebar cards stand on each side. `override` places one card on a
 *  stated side regardless of the imposition — the rails a side preview draws. */
function railsOf(
  imposition: DeckImposition,
  sidebars: readonly SidebarEntry[],
  override?: { componentId: string; side: SidebarSide },
): MiniatureRails {
  const rails: MiniatureRails = {};
  for (const entry of sidebars) {
    const side =
      override !== undefined && override.componentId === entry.componentId
        ? override.side
        : sidebarSide(imposition, entry.componentId);
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

/** One plan layer: a drawing and the caption naming it. */
interface PlanLayer {
  /** `axis:value` — the id a hovered/cursored segment resolves to. */
  previewId: string;
  caption: string;
  kind: ImpositionKind;
  rails: MiniatureRails;
  width: ContentWidth;
}

/**
 * The preview id a segment stands for, or `null` when the element is not a
 * previewable segment. The already-active segment resolves to `null` on
 * purpose: hovering the current answer shows the committed plan, not a
 * tentative copy of it.
 */
function previewIdOf(el: Element | null): string | null {
  const segment = el?.closest("[data-choice-value]") ?? null;
  if (segment === null) return null;
  if (segment.getAttribute("data-state") === "active") return null;
  const row = segment.closest("[data-preview-axis]");
  if (row === null) return null;
  return `${row.getAttribute("data-preview-axis")}:${segment.getAttribute(
    "data-choice-value",
  )}`;
}

function LayoutsSectionBody({
  host,
}: {
  host: LensSectionHost;
}): React.ReactElement {
  const imposition = useImposition();
  const kind = imposition.kind ?? DEFAULT_IMPOSITION_KIND;
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

  // ---- The plan's preview switch ([L06]) ----
  //
  // Which layer shows is DOM attributes on the plan, toggled here: the layer
  // whose id matches gets `data-plan-active`, and the plan carries
  // `data-previewing` whenever one does (which is what hides the committed
  // layer). No React state — a preview is visible-only and lives exactly as
  // long as the pointer or cursor that asked for it.
  const planRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);

  const setPreview = useCallback((id: string | null) => {
    const plan = planRef.current;
    if (plan === null) return;
    let matched = false;
    for (const layer of plan.querySelectorAll("[data-plan-preview-id]")) {
      const on = id !== null && layer.getAttribute("data-plan-preview-id") === id;
      layer.toggleAttribute("data-plan-active", on);
      matched = matched || on;
    }
    plan.toggleAttribute("data-previewing", matched);
  }, []);

  // The keyboard cursor previews the same way the pointer does: the engine
  // marks the ringed group `data-key-view-kbd` and the cursor segment
  // `data-key-cursor`, so an observer on those attributes resolves the
  // cursored segment to its preview id whenever either moves. Deferred
  // commit ([P24]) then reads: arrows audition arrangements in the plan,
  // Space makes one real.
  useLayoutEffect(() => {
    const rows = rowsRef.current;
    if (rows === null) return;
    const recompute = () => {
      const segment = rows.querySelector(
        "[data-key-view-kbd] [data-key-cursor][data-choice-value]",
      );
      setPreview(previewIdOf(segment));
    };
    const observer = new MutationObserver(recompute);
    observer.observe(rows, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-key-cursor", "data-key-view-kbd"],
    });
    return () => observer.disconnect();
  }, [setPreview]);

  // ---- The layers: the committed plan and every offerable answer ----

  const committedCaption = `${KIND_LABELS[kind]} · ${CONTENT_WIDTH_LABELS[contentWidth]}`;

  const layers: PlanLayer[] = [
    ...IMPOSITION_KINDS.map((k) => ({
      previewId: `kind:${k}`,
      caption: `${KIND_LABELS[k]} · ${CONTENT_WIDTH_LABELS[contentWidth]}`,
      kind: k,
      rails,
      width: contentWidth,
    })),
    ...CONTENT_WIDTH_PRESETS.map((preset) => ({
      previewId: `width:${preset}`,
      caption: `${KIND_LABELS[kind]} · ${CONTENT_WIDTH_LABELS[preset]}`,
      kind,
      rails,
      width: preset,
    })),
    ...sidebars.flatMap((entry) =>
      SIDES.map((side) => ({
        previewId: `side:${entry.componentId}:${side}`,
        caption: `${entry.title} ${SIDE_LABELS[side]}`,
        kind,
        rails: railsOf(imposition, sidebars, {
          componentId: entry.componentId,
          side,
        }),
        width: contentWidth,
      })),
    ),
  ];

  // ---- The rows: one compact segmented group per axis ----

  const kindItems: TugChoiceItem[] = IMPOSITION_KINDS.map((k) => ({
    value: k,
    label: String(slotCount(k)),
    "aria-label": KIND_LABELS[k],
    tooltip: KIND_LABELS[k],
  }));

  const widthItems: TugChoiceItem[] = CONTENT_WIDTH_PRESETS.map((preset) => ({
    value: preset,
    label: CONTENT_WIDTH_LABELS[preset],
  }));

  const sideItems: TugChoiceItem[] = SIDES.map((side) => ({
    value: side,
    label: SIDE_LABELS[side],
  }));

  return (
    <ResponderScope>
      <div
        className="layouts-section"
        data-testid="lens-layouts-section"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <div
          className="layouts-plan"
          data-testid="lens-layouts-plan"
          ref={planRef}
          aria-hidden="true"
        >
          <div className="layouts-plan-layer" data-plan-layer="committed">
            <LayoutMiniature
              kind={kind}
              rails={rails}
              width={contentWidth}
              selected
            />
            <span className="layouts-plan-caption">{committedCaption}</span>
          </div>
          {layers.map((layer) => (
            <div
              className="layouts-plan-layer"
              data-plan-preview-id={layer.previewId}
              key={layer.previewId}
            >
              <LayoutMiniature
                kind={layer.kind}
                rails={layer.rails}
                width={layer.width}
              />
              <span className="layouts-plan-caption">{layer.caption}</span>
            </div>
          ))}
        </div>

        <div
          className="layouts-section-rows"
          ref={rowsRef}
          onPointerOver={(event) =>
            setPreview(previewIdOf(event.target as Element))
          }
          onPointerLeave={() => setPreview(null)}
          onClick={() => setPreview(null)}
        >
          <div className="layouts-section-row" data-preview-axis="kind">
            <TugLabel
              id={KIND_CAPTION_ID}
              size="md"
              emphasis="proposal"
              className="layouts-section-caption"
            >
              Cards
            </TugLabel>
            <TugChoiceGroup
              items={kindItems}
              value={kind}
              senderId={KIND_SENDER_ID}
              size="xs"
              sidePadding="xs"
              reselect
              focusGroup={host.focusGroup}
              focusOrder={LAYOUTS_KIND_FOCUS_ORDER}
              aria-labelledby={KIND_CAPTION_ID}
              data-testid="lens-layouts-kind"
            />
          </div>

          <div className="layouts-section-row" data-preview-axis="width">
            <TugLabel
              id={WIDTH_CAPTION_ID}
              size="md"
              emphasis="proposal"
              className="layouts-section-caption"
            >
              Card Width
            </TugLabel>
            <TugChoiceGroup
              items={widthItems}
              value={contentWidth}
              senderId={WIDTH_SENDER_ID}
              size="xs"
              sidePadding="xs"
              reselect
              focusGroup={host.focusGroup}
              focusOrder={LAYOUTS_WIDTH_FOCUS_ORDER}
              aria-labelledby={WIDTH_CAPTION_ID}
              data-testid="lens-layouts-width"
            />
          </div>

          {sidebars.map((entry, index) => {
            const side = sidebarSide(imposition, entry.componentId);
            const captionId = `${SIDE_CAPTION_ID_PREFIX}${entry.componentId}`;
            return (
              <div
                className="layouts-section-row"
                data-preview-axis={`side:${entry.componentId}`}
                key={entry.componentId}
              >
                <TugLabel
                  id={captionId}
                  size="md"
                  emphasis="proposal"
                  className="layouts-section-caption"
                >
                  {entry.title}
                </TugLabel>
                <TugChoiceGroup
                  items={sideItems}
                  value={side}
                  senderId={`${SIDE_SENDER_PREFIX}${entry.componentId}`}
                  size="xs"
                  sidePadding="xs"
                  reselect
                  focusGroup={host.focusGroup}
                  focusOrder={LAYOUTS_FIRST_SIDEBAR_FOCUS_ORDER + index}
                  aria-labelledby={captionId}
                  data-testid={`lens-layouts-side-${entry.componentId}`}
                />
              </div>
            );
          })}
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
