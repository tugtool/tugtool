/**
 * layout-imposer.ts — the geometry of layout imposition.
 *
 * In printing, *imposition* is the arrangement of pages onto the press sheet so
 * that each one lands at its correct position. The imposer does the same for
 * deck panes: an **imposition** (two-up / three-up / four-up) defines numbered
 * **slots**, and a pane assigned to a slot is placed at that slot's position in
 * a chain of cards running across the canvas.
 *
 * A slot is a position anchor, **not a rect**. Nothing here computes, clamps, or
 * suggests a width — the pane's own width is an input that passes straight
 * through to the output. When the assigned panes are wider than the canvas,
 * they run off the far edge — an ordinary outcome, not an error.
 *
 * ## Packing
 *
 * The chain starts at the edge **farthest from the Lens** and runs toward it:
 * a right-docked Lens packs the cards left, a left-docked Lens packs them
 * right, and a closed Lens packs left. An empty slot occupies nothing — slot
 * numbers order the chain, they do not reserve space in it.
 *
 * One rule sets the whole strip: the **step** between one card's near edge and
 * the next one's.
 *
 * ```
 *   step = min(gap, (band - totalCardWidth) / (cards - 1))
 * ```
 *
 * When the cards fit, the step is exactly one **imposition gap** — the same gap
 * an Option-drag snaps to — and every leftover pixel collects in one place,
 * between the last card and the Lens. Slack pooled in one wide margin reads as
 * deliberate; the same slack split into equal wedges between cards reads as
 * drift.
 *
 * When they do not fit, the step goes negative and the cards **overlap**, by
 * equal amounts, exactly enough that the last card's far edge lands on the
 * band's far edge. Cards overlapping is an ordinary outcome of a narrow deck.
 * Cards sliding under the Lens is not — the band ends where the Lens begins,
 * and the strip always ends with it.
 *
 * The Lens is imposed too, by {@link imposeLensStyle}, but it is the strip's
 * fixed end rather than a link in the chain: it holds its pin and its width
 * while the cards absorb the crowding.
 *
 * ## Where the numbers come from
 *
 * The widths are the deck's own ([L09] — panes own their geometry); the band is
 * the container, which only CSS knows. So the step is written as a CSS `min()`
 * over `100%` and the offsets as `calc()` over it, and the browser resolves the
 * arrangement during its own reflow — no measurement, and no resize
 * observation anywhere on the deck. Widen the window and the overlap eases off
 * on its own.
 *
 * Pure module: no DOM, store, or React runtime imports — the same discipline as
 * `snap.ts`. (`React.CSSProperties` below is a type-only import.)
 *
 * @module lib/layout-imposer
 */

import type React from "react";

/** The active N-up rule. */
export type ImpositionKind = "two-up" | "three-up" | "four-up";

/** Which side of the deck the Lens holds. */
export type LensSide = "left" | "right";

/**
 * The deck's layout imposition: the N-up rule the chain of cards is packed
 * under, and the side the Lens holds.
 *
 * The two axes are independent. `kind` absent means no card is imposed — the
 * deck is free — while `lens` still says which end of the strip the Lens is,
 * because the Lens has a side whether or not anything is arranged against it.
 */
export interface DeckImposition {
  /** The N-up rule, or absent when nothing is imposed. */
  kind?: ImpositionKind;
  /** The side the Lens holds; the chain packs away from it. */
  lens: LensSide;
}

/** The side the Lens opens on when nothing has ever said otherwise. */
export const DEFAULT_LENS_SIDE: LensSide = "right";

/** Narrow an unknown (a parsed blob field, an action payload) to a side. */
export function isLensSide(value: unknown): value is LensSide {
  return value === "left" || value === "right";
}

/** Every imposition kind, in ascending slot count — the Lens picker's order. */
export const IMPOSITION_KINDS: readonly ImpositionKind[] = [
  "two-up",
  "three-up",
  "four-up",
];

/**
 * The **imposition gap**: the space an imposed pane keeps from the canvas
 * edges, from the Lens rail, and from the pane in the neighbouring slot.
 *
 * This is the same gap the Option-drag snap holds between two card edges —
 * `tug-pane.tsx` imports it for `computeSnap` / `computeResizeSnap` rather than
 * declaring its own. A pane placed by the imposer and a pane snapped by hand
 * therefore land on the same rhythm.
 */
export const IMPOSITION_GAP_PX = 5;

/**
 * The **bottom** imposition gap, which is deliberately deeper than the other
 * three. A heavier bottom margin than top is as old as the printed page, and
 * an arrangement that reaches the same distance from every edge reads as
 * sinking; the extra depth is what makes it sit.
 *
 * It also has to do a job. The host draws a dev-info strip in the canvas's
 * bottom-left corner — the branch, revision, and build stamps — 8px above the
 * canvas bottom and about 19px tall. A pane imposed to the ordinary gap runs
 * straight through it. This depth clears the strip and leaves one ordinary gap
 * of air above it, so nothing imposed ever collides with the stamps.
 */
export const IMPOSITION_GAP_BOTTOM_PX = 32;

/** The gaps as CSS lengths, for the calc expressions below. */
const GAP = `${IMPOSITION_GAP_PX}px`;
const GAP_BOTTOM = `${IMPOSITION_GAP_BOTTOM_PX}px`;

/** The CSS custom properties carrying the rail insets (see `deck-canvas.tsx`).
 *  These carry the Lens rail only; the gap is added on top of them here, so the
 *  numeric twin below and the CSS agree by construction. */
const INSET_LEFT = "var(--tug-imposer-inset-left, 0px)";
const INSET_RIGHT = "var(--tug-imposer-inset-right, 0px)";

/** Narrow an unknown (a parsed blob field, an action payload) to a kind. */
export function isImpositionKind(value: unknown): value is ImpositionKind {
  return (
    typeof value === "string" &&
    (IMPOSITION_KINDS as readonly string[]).includes(value)
  );
}

/** How many slots the kind defines: 2, 3, or 4. */
export function slotCount(kind: ImpositionKind): number {
  switch (kind) {
    case "two-up":
      return 2;
    case "three-up":
      return 3;
    case "four-up":
      return 4;
  }
}

/**
 * Bring any number into the kind's slot range: floored to an integer and
 * clamped to `[0, N-1]`. A non-finite input reads as slot 0. This is what makes
 * a kind change safe — shrinking from four-up to two-up pulls slots 2 and 3 in
 * to slot 1 rather than dropping those panes out of the arrangement.
 */
export function clampSlot(kind: ImpositionKind, slot: number): number {
  if (!Number.isFinite(slot)) return 0;
  const last = slotCount(kind) - 1;
  return Math.max(0, Math.min(last, Math.floor(slot)));
}

/* ---------------------------------------------------------------------------
 * Packing
 * ---------------------------------------------------------------------------*/

/** Which edge the chain of cards starts from. */
export type PackFrom = "left" | "right";

/** The chain runs away from the Lens, so the rail's side picks the edge. */
export function packFromForRail(railSide: "left" | "right" | null): PackFrom {
  return railSide === "left" ? "right" : "left";
}

/** One pane's place in the chain — everything a frame needs to position itself.
 *
 *  The offset is deliberately not resolved here: it depends on the step, and
 *  the step depends on the band's width, which only the browser knows. What is
 *  resolved is everything the deck *does* know, and {@link imposeStyle} hands
 *  the rest to CSS. */
export interface ImposedPlacement {
  /** The pane's slot, already clamped to the kind. */
  slot: number;
  /** Which edge the chain starts from. */
  packFrom: PackFrom;
  /** How many cards are in the chain. */
  count: number;
  /** This card's position in the chain, counted from the packing edge. */
  index: number;
  /** Total width of every card in the chain. */
  sumWidths: number;
  /** Total width of the cards between this one and the packing edge. */
  widthBefore: number;
}

/**
 * The step between successive cards, given the band the chain has to fit in.
 * One imposition gap when there is room; negative — an overlap — when there is
 * not, sized so the strip ends exactly on the band's far edge.
 */
export function chainStep(placement: ImposedPlacement, bandWidth: number): number {
  if (placement.count < 2) return 0;
  return Math.min(
    IMPOSITION_GAP_PX,
    (bandWidth - placement.sumWidths) / (placement.count - 1),
  );
}

/** The subset of a pane the imposer needs in order to lay out the chain. */
export interface ImposerPane {
  id: string;
  /** Absent for a free or anchored pane. */
  slot?: number;
  /** The pane's own width — a pass-through, never a computed value. */
  width: number;
}

/**
 * Width to reserve for each slot: the widest pane holding it, or 0 when the
 * slot is empty. Taking the widest rather than the topmost keeps the chain
 * still when the user switches which card in a shared slot is on top.
 */
function slotWidths(
  kind: ImpositionKind,
  panes: readonly ImposerPane[],
): number[] {
  const widths = new Array<number>(slotCount(kind)).fill(0);
  for (const pane of panes) {
    if (pane.slot === undefined) continue;
    const k = clampSlot(kind, pane.slot);
    if (pane.width > widths[k]) widths[k] = pane.width;
  }
  return widths;
}

/**
 * Resolve every slotted pane's place in the chain, keyed by pane id. Panes with
 * no slot are absent from the result — they are free, and own their geometry
 * outright.
 *
 * Only *occupied* slots take a place in the chain, so a hole in the slot
 * numbering closes up rather than reserving space nobody asked for.
 */
export function resolvePlacements(
  kind: ImpositionKind,
  panes: readonly ImposerPane[],
  railSide: "left" | "right" | null,
): Map<string, ImposedPlacement> {
  const packFrom = packFromForRail(railSide);
  const widths = slotWidths(kind, panes);
  const last = slotCount(kind) - 1;

  // Walk the slots from the packing edge inward, numbering the occupied ones
  // and accumulating the width ahead of each. Packing right means walking the
  // slot numbers backward.
  const order = packFrom === "left" ? 1 : -1;
  const first = packFrom === "left" ? 0 : last;
  const indexBySlot = new Array<number>(widths.length).fill(0);
  const beforeBySlot = new Array<number>(widths.length).fill(0);
  let count = 0;
  let running = 0;
  for (let n = 0; n <= last; n += 1) {
    const k = first + order * n;
    indexBySlot[k] = count;
    beforeBySlot[k] = running;
    if (widths[k] > 0) {
      count += 1;
      running += widths[k];
    }
  }
  const sumWidths = running;

  const placements = new Map<string, ImposedPlacement>();
  for (const pane of panes) {
    if (pane.slot === undefined) continue;
    const k = clampSlot(kind, pane.slot);
    placements.set(pane.id, {
      slot: k,
      packFrom,
      count,
      index: indexBySlot[k],
      sumWidths,
      widthBefore: beforeBySlot[k],
    });
  }
  return placements;
}

/* ---------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------------*/

/** The band the chain is laid across: the canvas minus the Lens's inset on the
 *  side it holds. Imposed panes are never under the Lens.
 *
 *  The span is the *raw* band — the chain's own imposition gap is not folded in
 *  here, so this stays a plain description of the canvas and the Lens. Both
 *  {@link imposeRect} and {@link imposeStyle} inset it by that gap themselves. */
export interface ImposerSpan {
  x: number;
  width: number;
  height: number;
}

/**
 * Resolve the span from the canvas box and the open Lens, if any. A closed Lens
 * means `lens === null` and the span is the whole canvas.
 *
 * The Lens is itself imposed — it stands one gap off the canvas edge — so its
 * near edge sits `width + gap` in, and that is the inset the band takes. The
 * chain's own gap then lands its far card exactly one gap off the Lens. This is
 * the numeric twin of the `--tug-imposer-inset-*` custom properties
 * `deck-canvas.tsx` writes; both add the same gap, so they agree by
 * construction.
 */
export function resolveSpan(
  canvas: { width: number; height: number },
  lens: { side: LensSide; width: number } | null,
): ImposerSpan {
  if (lens === null) {
    return { x: 0, width: canvas.width, height: canvas.height };
  }
  const inset = lens.width + IMPOSITION_GAP_PX;
  return {
    x: lens.side === "left" ? inset : 0,
    width: canvas.width - inset,
    height: canvas.height,
  };
}

/** The numeric form of an imposed pane's frame, in canvas coordinates. */
export interface ImposedRect {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * The numeric twin of {@link imposeStyle} — the rect an imposed pane occupies,
 * for tests, snap math, and the freeze that runs when the imposition is turned
 * off. `paneWidth` passes through untouched; no clamping and no minimum, so an
 * overhanging result is returned as computed.
 */
export function imposeRect(
  placement: ImposedPlacement,
  paneWidth: number,
  span: ImposerSpan,
): ImposedRect {
  const bandWidth = span.width - IMPOSITION_GAP_PX * 2;
  const offset =
    placement.widthBefore + placement.index * chainStep(placement, bandWidth);
  const x =
    placement.packFrom === "left"
      ? span.x + IMPOSITION_GAP_PX + offset
      : span.x + span.width - IMPOSITION_GAP_PX - offset - paneWidth;
  return {
    position: { x, y: IMPOSITION_GAP_PX },
    size: {
      width: paneWidth,
      height: span.height - IMPOSITION_GAP_PX - IMPOSITION_GAP_BOTTOM_PX,
    },
  };
}

/**
 * The CSS form: inline frame styles that pin the pane to its place in the
 * chain. One horizontal pin, measured from the packing edge: the rail inset,
 * the gap, the width of the cards ahead of this one, and this one's share of
 * the step.
 *
 * The step is a `min()` over the live band, so the browser is the one that
 * decides whether the strip has room to breathe or has to overlap — and it
 * re-decides on every reflow. That is the whole of the deck's response to a
 * window or display resize.
 *
 * The vertical run is the top gap down to the deeper bottom gap. A collapsed
 * pane keeps its horizontal pin and its top pin but releases the bottom one, so
 * the window-shade bar sits a gap below the canvas top at its place in the
 * chain.
 */
export function imposeStyle(
  placement: ImposedPlacement,
  paneWidth: number,
  collapsed: boolean,
): React.CSSProperties {
  const style: React.CSSProperties = {
    width: `${paneWidth}px`,
    height: "auto",
    top: GAP,
  };
  if (!collapsed) style.bottom = GAP_BOTTOM;

  const inset = placement.packFrom === "left" ? INSET_LEFT : INSET_RIGHT;
  // `min(gap, (band - totalCardWidth) / (cards - 1))` — see the module note.
  const band = `(100% - ${INSET_LEFT} - ${INSET_RIGHT} - ${GAP} * 2)`;
  const step =
    placement.count < 2
      ? "0px"
      : `min(${GAP}, ${band} / ${placement.count - 1} - ${
          placement.sumWidths / (placement.count - 1)
        }px)`;
  const pin =
    `calc(${inset} + ${GAP} + ${placement.widthBefore}px` +
    (placement.index > 0 ? ` + ${placement.index} * ${step}` : "") +
    `)`;
  if (placement.packFrom === "left") {
    style.left = pin;
  } else {
    style.right = pin;
  }
  return style;
}

/**
 * The Lens's frame: pinned to the side it holds, one gap in on three edges and
 * the deeper gap at the bottom, at the width the pane carries.
 *
 * The Lens is imposed but it is not a link in the chain. A chain link takes a
 * step, and a step can go negative — cards overlap when the deck is crowded.
 * The Lens must never be overlapped, so it holds the strip's far end at a fixed
 * pin and the cards share what is left of the band ({@link resolveSpan}).
 *
 * A collapsed Lens keeps its side and top pins and releases the bottom one, so
 * the window-shade bar sits a gap below the canvas top — the same treatment
 * {@link imposeStyle} gives a collapsed chain link.
 */
export function imposeLensStyle(
  side: LensSide,
  paneWidth: number,
  collapsed: boolean,
): React.CSSProperties {
  const style: React.CSSProperties = {
    width: `${paneWidth}px`,
    height: "auto",
    top: GAP,
    [side]: GAP,
  };
  if (!collapsed) style.bottom = GAP_BOTTOM;
  return style;
}
