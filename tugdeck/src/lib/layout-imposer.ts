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
 * ## Where a slot is
 *
 * A slot is an **anchor at a fixed fraction of the band**, and nothing else in
 * the deck moves it. Numbering runs from the edge farthest from the Lens toward
 * the Lens: a right-docked Lens numbers left-to-right, a left-docked Lens
 * numbers right-to-left, and a closed Lens numbers left-to-right.
 *
 * Slot 0 hugs the far edge; the last slot hugs the Lens. In between the anchors
 * space evenly. One rule says all of it — for a pane of width `w` in slot `k`
 * of an `N`-slot imposition, measured from the packing edge:
 *
 * ```
 *   offset = k / (N - 1) × max(0, band - w)
 * ```
 *
 * `band - w` is the pane's **travel**: how far it can slide before its far edge
 * leaves the band. At slot 0 it has travelled none of it and sits on the far
 * edge; at slot `N-1` it has travelled all of it and its far edge lands exactly
 * on the Lens. That is what makes "the card in the last slot is the one beside
 * the Lens" true by construction rather than by arithmetic that happens to work
 * out.
 *
 * The consequence worth naming: **a pane's position depends on its own width
 * and nothing else's.** Closing, widening, or adding a card leaves every other
 * card exactly where it was — a slot is a place in the arrangement, never a
 * place in a queue. Slack therefore spreads evenly between the cards rather
 * than pooling beside the Lens; an arrangement that stays still is worth more
 * than one whose margins collect in one place.
 *
 * When the cards are wider than their share, the offsets crowd together and the
 * cards **overlap** — an ordinary outcome of a narrow deck. A pane wider than
 * the whole band has no travel at all (`max(0, …)`) and sits on the far edge in
 * every slot.
 *
 * The Lens is imposed too, by {@link imposeLensStyle}, but it is the strip's
 * fixed end rather than a link in the chain: it holds its pin and its width
 * while the cards absorb the crowding.
 *
 * ## Where the numbers come from
 *
 * The width is the pane's own ([L09] — panes own their geometry); the band is
 * the container, which only CSS knows. So the offset is written as a `calc()`
 * over `100%` and the browser resolves it during its own reflow — no
 * measurement, and no resize observation anywhere on the deck. Widen the window
 * and the crowding eases off on its own.
 *
 * Every horizontal pin is emitted as `left`, including the ones measured from
 * the right edge (as `100% - …`). A frame that is always positioned by the same
 * property can *transition* between two arrangements; one that switches from
 * `right` to `left` can only cut.
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
  /** The side the Lens holds; the arrangement is numbered away from it. */
  lens: LensSide;
  /**
   * Whether the Lens is standing at its pin. Absent reads as pinned.
   *
   * Dragging the Lens by its title bar sets this false: it becomes an ordinary
   * free pane, and the arrangement then spans the whole canvas exactly as it
   * does when the Lens is closed. Choosing anything in the Layouts section puts
   * it back — that is the gesture that means "the Lens belongs on this side".
   *
   * The side survives the float, so re-pinning returns the Lens to the edge it
   * came from rather than to a default.
   */
  lensPinned?: boolean;
}

/** Whether the Lens stands at its pin. An absent flag reads as pinned — a Lens
 *  that has never been dragged has never left its side. */
export function isLensPinned(imposition: DeckImposition): boolean {
  return imposition.lensPinned !== false;
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

/**
 * How long the deck takes to settle into a new arrangement, in milliseconds.
 *
 * Changing the imposition moves every derived frame at once, and they cross to
 * their new places rather than cutting — see the `data-imposer-settling` rule
 * in `tug-pane.css`. `deck-canvas.tsx` writes this number onto the frames'
 * container as `--tugx-imposer-settle-duration` and reads the resolved value
 * back when timing the settle, so the transition and the timer that ends it
 * are one number and an override on the container tunes both.
 */
export const IMPOSITION_SETTLE_MS = 500;

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

/** One pane's place in the arrangement — everything a frame needs to position
 *  itself, and no more.
 *
 *  There is nothing here about the deck's other panes, because a slot's anchor
 *  does not depend on them. That is the whole of what makes the arrangement
 *  hold still: a placement is a pure function of the kind and the pane's own
 *  slot, so no pane can be resolved only from a vantage point that sees them
 *  all.
 *
 *  The offset is deliberately not resolved here: it depends on the band's
 *  width, which only the browser knows. {@link imposeStyle} hands that to CSS. */
export interface ImposedPlacement {
  /** The pane's slot, already clamped to the kind. */
  slot: number;
  /** Which edge slot 0 sits on, and which way the numbering runs. */
  packFrom: PackFrom;
  /** How many slots the kind defines. */
  count: number;
}

/**
 * Resolve one pane's place from its slot and the deck's arrangement. `slot`
 * is clamped to the kind, so shrinking four-up to two-up pulls the outer slots
 * in rather than dropping their panes out of the arrangement.
 */
export function resolvePlacement(
  kind: ImpositionKind,
  slot: number,
  lensSide: LensSide | null,
): ImposedPlacement {
  return {
    slot: clampSlot(kind, slot),
    packFrom: packFromForRail(lensSide),
    count: slotCount(kind),
  };
}

/**
 * A slot's share of the band's travel: `slot / (slots - 1)`, in `[0, 1]`. Slot
 * 0 gives 0 (hug the far edge) and the last slot gives 1 (hug the Lens).
 */
export function travelFraction(placement: ImposedPlacement): number {
  if (placement.count < 2) return 0;
  return placement.slot / (placement.count - 1);
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
  const travel = Math.max(0, bandWidth - paneWidth);
  const offset = travelFraction(placement) * travel;
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
 * The CSS form: inline frame styles that pin the pane to its slot's anchor. One
 * horizontal pin, measured from the packing edge: the Lens inset, the gap, and
 * this slot's share of the pane's travel across the band.
 *
 * The travel is a `max()` over the live band, so the browser is the one that
 * decides how much room the arrangement has — and it re-decides on every
 * reflow. That is the whole of the deck's response to a window or display
 * resize.
 *
 * The pin is emitted as `left` either way. A right-measured anchor becomes
 * `100% - inset - gap - width - offset`, which describes the same place while
 * keeping every imposed frame on one property — the requirement for animating
 * between two arrangements rather than cutting between them.
 *
 * The vertical run is the top gap down to the deeper bottom gap. A collapsed
 * pane keeps its horizontal pin and its top pin but releases the bottom one, so
 * the window-shade bar sits a gap below the canvas top at its slot's anchor.
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

  const band = `(100% - ${INSET_LEFT} - ${INSET_RIGHT} - ${GAP} * 2)`;
  const fraction = travelFraction(placement);
  // `k / (N - 1) × max(0, band - width)` — see the module note.
  const offset =
    fraction === 0 ? "0px" : `${fraction} * max(0px, ${band} - ${paneWidth}px)`;
  style.left =
    placement.packFrom === "left"
      ? `calc(${INSET_LEFT} + ${GAP} + ${offset})`
      : `calc(100% - ${INSET_RIGHT} - ${GAP} - ${paneWidth}px - ${offset})`;
  return style;
}

/**
 * The Lens's frame: pinned to the side it holds, one gap in on three edges and
 * the deeper gap at the bottom, at the width the pane carries.
 *
 * The Lens is imposed but it is not a link in the chain. A chain link travels
 * across the band and can end up overlapped when the deck is crowded. The Lens
 * must never be overlapped, so it holds the strip's far end at a fixed pin and
 * the cards share what is left of the band ({@link resolveSpan}).
 *
 * Like {@link imposeStyle}, the pin is emitted as `left` on both sides — a
 * right-held Lens as `100% - width - gap` — so flipping the side is a change of
 * one property's value and can therefore be animated.
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
    left: side === "left" ? GAP : `calc(100% - ${paneWidth}px - ${GAP})`,
  };
  if (!collapsed) style.bottom = GAP_BOTTOM;
  return style;
}
