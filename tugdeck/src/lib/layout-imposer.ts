/**
 * layout-imposer.ts — the geometry of layout imposition.
 *
 * In printing, *imposition* is the arrangement of pages onto the press sheet so
 * that each one lands at its correct position. The imposer does the same for
 * deck panes: an **imposition** (two-up / three-up / four-up) defines numbered
 * **slots** across the canvas, and a pane assigned to a slot is pinned to that
 * slot's horizontal anchor and stretched to full canvas height.
 *
 * A slot is a position anchor, **not a rect**. Nothing here computes, clamps, or
 * suggests a width — the pane's own width is an input that passes straight
 * through to the output. When the assigned panes are wider than the span, they
 * overlap — an ordinary outcome, not an error.
 *
 * Pure module: no DOM, store, or React runtime imports — the same discipline as
 * `snap.ts`. (`React.CSSProperties` below is a type-only import.)
 *
 * @module lib/layout-imposer
 */

import type React from "react";

/** The active N-up rule. */
export type ImpositionKind = "two-up" | "three-up" | "four-up";

/** Every imposition kind, in ascending slot count — the Lens picker's order. */
export const IMPOSITION_KINDS: readonly ImpositionKind[] = [
  "two-up",
  "three-up",
  "four-up",
];

/** The CSS custom properties carrying the span insets (see `deck-canvas.tsx`). */
const INSET_LEFT = "var(--tug-imposer-inset-left, 0px)";
const INSET_RIGHT = "var(--tug-imposer-inset-right, 0px)";

/** The span's width in CSS terms: the container minus both insets. */
const SPAN_WIDTH = `(100% - ${INSET_LEFT} - ${INSET_RIGHT})`;

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

/** The slot's position across the span: `k / (N - 1)`, so 0 at the left edge
 *  and 1 at the right. Three-up's middle is 0.5; four-up's are 1/3 and 2/3. */
export function slotFraction(kind: ImpositionKind, slot: number): number {
  const k = clampSlot(kind, slot);
  return k / (slotCount(kind) - 1);
}

/** The band slots are laid across: the canvas minus the Lens rail's inset on
 *  the side it is docked to. Slotted positions are never under the rail. */
export interface ImposerSpan {
  x: number;
  width: number;
  height: number;
}

/**
 * Resolve the span from the canvas box and the anchored rail, if any. A closed
 * Lens (no anchored pane) means `rail === null` and the span is the whole
 * canvas.
 */
export function resolveSpan(
  canvas: { width: number; height: number },
  rail: { side: "left" | "right"; width: number } | null,
): ImposerSpan {
  if (rail === null) {
    return { x: 0, width: canvas.width, height: canvas.height };
  }
  const width = canvas.width - rail.width;
  return {
    x: rail.side === "left" ? rail.width : 0,
    width,
    height: canvas.height,
  };
}

/** The numeric form of a slotted pane's frame, in canvas coordinates. */
export interface ImposedRect {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * The numeric twin of {@link imposeStyle} — the rect a slotted pane occupies,
 * for tests, snap math, and the freeze that runs when the imposition is turned
 * off. `paneWidth` passes through untouched; no clamping and no minimum, so an
 * overhanging or overlapping result is returned as computed.
 */
export function imposeRect(
  kind: ImpositionKind,
  slot: number,
  paneWidth: number,
  span: ImposerSpan,
): ImposedRect {
  const k = clampSlot(kind, slot);
  const last = slotCount(kind) - 1;
  let x: number;
  if (k === 0) {
    x = span.x;
  } else if (k === last) {
    x = span.x + span.width - paneWidth;
  } else {
    x = span.x + span.width * slotFraction(kind, k) - paneWidth / 2;
  }
  return {
    position: { x, y: 0 },
    size: { width: paneWidth, height: span.height },
  };
}

/**
 * The CSS form: inline frame styles that pin the pane to its slot. Expressed in
 * terms of the span inset custom properties so the browser reflows slotted
 * panes on a window resize or a rail drag with no JavaScript at all.
 *
 * The first slot pins its left edge, the last pins its right edge, and a middle
 * slot pins its horizontal center via `translateX(-50%)` — which keeps it
 * centered as the user widens the card, with no recomputation.
 *
 * A collapsed pane keeps its horizontal pin and its top pin but releases the
 * bottom one, so the window-shade bar sits at the canvas top at its slot's x.
 */
export function imposeStyle(
  kind: ImpositionKind,
  slot: number,
  paneWidth: number,
  collapsed: boolean,
): React.CSSProperties {
  const k = clampSlot(kind, slot);
  const last = slotCount(kind) - 1;

  const style: React.CSSProperties = {
    width: `${paneWidth}px`,
    height: "auto",
    top: 0,
  };
  if (!collapsed) style.bottom = 0;

  if (k === 0) {
    style.left = INSET_LEFT;
  } else if (k === last) {
    style.right = INSET_RIGHT;
  } else {
    style.left = `calc(${INSET_LEFT} + ${SPAN_WIDTH} * ${k} / ${last})`;
    style.transform = "translateX(-50%)";
  }
  return style;
}
