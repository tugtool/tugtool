/**
 * layout-imposer.ts — the geometry of layout imposition.
 *
 * In printing, *imposition* is the arrangement of pages onto the press sheet so
 * that each one lands at its correct position. The imposer does the same for
 * deck panes: an **imposition** (one-up through six-up) defines numbered
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
 * the deck moves it. **Numbering always runs left to right** — slot 1 is the
 * leftmost position on the deck, whatever side the Lens holds and whether or
 * not it is open. A number that means "left" on one deck and "right" on another
 * is a number you have to think about before you can use it.
 *
 * Slot 0 hugs the band's left edge; the last slot hugs its right. In between
 * the anchors space evenly. One rule says all of it — for a pane of width `w`
 * in slot `k` of an `N`-slot imposition, measured from the band's left edge:
 *
 * ```
 *   offset = k / (N - 1) × max(0, band - w)
 * ```
 *
 * `band - w` is the pane's **travel**: how far it can slide before its right
 * edge leaves the band. At slot 0 it has travelled none of it and sits on the
 * band's left edge; at slot `N-1` it has travelled all of it and its right edge
 * lands exactly on the band's right edge. That is what makes "the card in the
 * last slot is the one at the far end" true by construction rather than by
 * arithmetic that happens to work out.
 *
 * **One-up is the one exception.** A single anchor has no ends to space against
 * the edges — the rule reads `0 / 0` — so its slot takes half the travel and
 * the card stands centered in the band. See {@link travelFraction}.
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
 * The Lens is imposed too, by {@link imposeSidebarStyle}, but it is the strip's
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
 * ## The space allocator
 *
 * The placement rule takes the band as given, so whatever the band's width
 * leaves over shows up as slack between the cards: a deck a little too wide
 * spreads them apart, a deck a little too narrow overlaps them. Nothing inside
 * the rule can absorb that — card widths belong to the panes, and an offset is a
 * pure function of the band.
 *
 * One number can. The pinned sidebar rails are the band's other ends, so their
 * total width and the band's are the same quantity read from opposite sides.
 * The **space allocator** ({@link allocateSidebarWidths}) stands every rail at
 * ONE shared width — as wide as a slim content card, as narrow as
 * {@link LENS_FLEX_SHRINK_FRACTION} under the width the user chose — picking
 * the value that puts every seam in the chain on one imposition gap: a
 * closed-form least-squares fit, since each seam is linear in the band.
 *
 * **Two moments, and one licence.** The deck re-solves when the user clicks in
 * the Layouts section, and when the canvas comes to rest at a new size. Those
 * are the two gestures that ask the deck to arrange itself; everything else —
 * slotting a card, dragging one out, closing one — leaves the Lens alone, since
 * the user was moving a card and did not ask for their rail to be resized. And
 * at either moment the Lens moves only if standing at the new width actually
 * tiles the chain. A resize that closes no gap is the deck taking the user's
 * width for nothing.
 *
 * Pure module: no DOM, store, or React runtime imports — the same discipline as
 * `snap.ts`. (`React.CSSProperties` below is a type-only import.)
 *
 * @module lib/layout-imposer
 */

import type React from "react";


/** The active N-up rule. */
export type ImpositionKind =
  | "one-up"
  | "two-up"
  | "three-up"
  | "four-up"
  | "five-up"
  | "six-up";

/** Which side of the deck a sidebar card holds. */
export type SidebarSide = "left" | "right";

/**
 * The deck-wide content width, as one of three named presets. Absent reads as
 * `"comfy"`, which is the width content cards have always opened at — so a blob
 * written before the presets existed migrates to exactly its own behavior.
 */
export type ContentWidth = "slim" | "comfy" | "wide";

/** One sidebar card's standing in the deck: which edge it holds, and whether it
 *  is standing at that pin. */
export interface SidebarEntry {
  /** The side this card holds; the arrangement is numbered away from it. */
  side: SidebarSide;
  /**
   * Whether the card is standing at its pin. Absent reads as pinned.
   *
   * Dragging the card by its title bar sets this false: it becomes an ordinary
   * free pane, and the arrangement then spans the whole canvas exactly as it
   * does when the card is closed. Choosing anything in the Layouts section puts
   * it back — that is the gesture that means "this card belongs on this side".
   *
   * The side survives the float, so re-pinning returns the card to the edge it
   * came from rather than to a default.
   */
  pinned?: boolean;
}

/** How a side's sidebar cards stand against one another. */
export type RailMode = "stack" | "split";

/**
 * How one side's rail is arranged: stacked front-to-back (the default, and what
 * a rail has always been) or divided vertically so every member is visible at
 * once.
 *
 * Split is a property of the SIDE, not of a pair of cards: all of a side's
 * visible members participate, and there are no sub-groups. Two or three cards
 * do not need a tree, and a tree is where this surface's complexity would go.
 *
 * `order` and `shares` outlive the members they name. A card closing is an
 * internal operation and must not destroy the arrangement the user chose
 * ([L23]), so nothing here is ever cleaned up: close a split member and the
 * remaining one takes the full run, reopen it and the split re-applies at the
 * order and heights it had.
 */
export interface RailArrangement {
  /** Absent reads as `"stack"` — today's behavior, on an unchanged blob. */
  mode?: RailMode;
  /**
   * The members' vertical order, top to bottom, by componentId. Absent means
   * registration order — see {@link effectiveRailOrder}, which also tolerates
   * ids named here that are not currently standing.
   */
  order?: string[];
  /**
   * Each member's height weight, keyed by componentId; an unnamed member weighs
   * 1, so an absent record is an equal division.
   *
   * Weights rather than positions: membership churns, and a positional array
   * would hand a departing card's height to whoever inherits its index.
   */
  shares?: Record<string, number>;
}

/**
 * The deck's layout imposition: the N-up rule the chain of content cards is
 * packed under, the width those cards open at, where each sidebar card stands,
 * and how each side's rail is arranged.
 *
 * The axes are independent. `kind` absent means no card is imposed — the deck
 * is free — while the sidebars still hold their sides, because a sidebar has a
 * side whether or not anything is arranged against it.
 */
export interface DeckImposition {
  /** The N-up rule, or absent when nothing is imposed. */
  kind?: ImpositionKind;
  /** The deck-wide content width; absent reads as {@link DEFAULT_CONTENT_WIDTH}. */
  contentWidth?: ContentWidth;
  /**
   * Where each sidebar card stands, keyed by its registered `componentId`.
   *
   * A card absent from the map has never been placed and takes
   * {@link DEFAULT_SIDEBAR_SIDE} when it first opens. The map is keyed by
   * componentId rather than by card id because a sidebar card is a singleton:
   * its side is a property of the card *type*, and survives the pane being
   * closed and reopened.
   */
  sidebars: Record<string, SidebarEntry>;
  /**
   * How each side's rail is arranged. Absent — for a side or for the record —
   * reads as a stack, which is what every rail was before splitting existed and
   * what every rail still is until the user says otherwise.
   *
   * Keyed by side rather than folded into {@link SidebarEntry} because the
   * arrangement belongs to the rail: two cards sharing a side cannot disagree
   * about whether they are stacked.
   */
  rails?: { left?: RailArrangement; right?: RailArrangement };
}

/** Where a sidebar card stands when nothing has ever said otherwise. */
export const DEFAULT_SIDEBAR_SIDE: SidebarSide = "right";

/** The width content cards open at when the deck has never said otherwise. */
export const DEFAULT_CONTENT_WIDTH: ContentWidth = "comfy";

/**
 * The side `componentId` holds, or the default when it has never been placed.
 *
 * Total by construction, including on an imposition carrying no `sidebars` map
 * at all: the record arrives from JSON blobs and from seeded test decks as well
 * as from the store, and an unplaced sidebar and an absent map mean the same
 * thing — nobody has said where this card goes.
 */
export function sidebarSide(
  imposition: DeckImposition,
  componentId: string,
): SidebarSide {
  return imposition.sidebars?.[componentId]?.side ?? DEFAULT_SIDEBAR_SIDE;
}

/** Whether `componentId` stands at its pin. Absent reads as pinned — a sidebar
 *  that has never been dragged has never left its side. */
export function isSidebarPinned(
  imposition: DeckImposition,
  componentId: string,
): boolean {
  return imposition.sidebars?.[componentId]?.pinned !== false;
}

/** The imposition with `componentId` standing on `side`, at its pin. */
export function withSidebarSide(
  imposition: DeckImposition,
  componentId: string,
  side: SidebarSide,
): DeckImposition {
  return {
    ...imposition,
    sidebars: { ...imposition.sidebars, [componentId]: { side, pinned: true } },
  };
}

/** The imposition with `componentId` pinned or unpinned, keeping its side. */
export function withSidebarPinned(
  imposition: DeckImposition,
  componentId: string,
  pinned: boolean,
): DeckImposition {
  const side = sidebarSide(imposition, componentId);
  return {
    ...imposition,
    sidebars: { ...imposition.sidebars, [componentId]: { side, pinned } },
  };
}

/**
 * The sidebar componentIds standing on `side`, in the vertical order they hold
 * there: the side's stored `order` filtered to the ids actually standing, then
 * any standing id the stored order does not name, in the order given.
 *
 * **CALLER CONTRACT: `componentIds` must arrive in REGISTRATION order.** This
 * module is pure and cannot reach the card registry, so the fallback order is
 * whatever the caller hands in — and the obvious list to reach for is the wrong
 * one. `findSidebarPanes` walks `state.panes`, the array `activateCard`
 * reorders, so handing that in makes a split rail's default vertical order
 * follow the last raise: click the lower card and the two would trade places.
 * The caller sorts into registration order first ([R06]).
 *
 * Tolerating ids the rail no longer holds is what lets an arrangement survive
 * membership churn: close a split member and its position is still recorded, so
 * reopening it puts it back where it was rather than at the end.
 *
 * A stack's members have a vertical order too — they simply all draw the same
 * rect, so it is invisible there. One function serves both modes: the rail's
 * member enumeration and the badge's picker rows read the same list whether the
 * side is stacked or split, which is also what makes the settle signature's
 * rail term blind to z-order.
 */
export function effectiveRailOrder(
  imposition: DeckImposition,
  side: SidebarSide,
  componentIds: readonly string[],
): readonly string[] {
  const present = componentIds.filter(
    (id) => sidebarSide(imposition, id) === side,
  );
  const stored = imposition.rails?.[side]?.order;
  if (stored === undefined) return present;
  const standing = new Set(present);
  const named = stored.filter((id) => standing.has(id));
  const claimed = new Set(named);
  return [...named, ...present.filter((id) => !claimed.has(id))];
}

/** The arrangement `side` stands under; absent reads as a stack. */
export function railModeOf(
  imposition: DeckImposition,
  side: SidebarSide,
): RailMode {
  return imposition.rails?.[side]?.mode === "split" ? "split" : "stack";
}

/** Narrow an unknown (a parsed blob field, an action payload) to a rail mode. */
export function isRailMode(value: unknown): value is RailMode {
  return value === "stack" || value === "split";
}

/** The side's arrangement with one field replaced, the others untouched. */
function withRailField(
  imposition: DeckImposition,
  side: SidebarSide,
  patch: Partial<RailArrangement>,
): DeckImposition {
  const current = imposition.rails?.[side] ?? {};
  return {
    ...imposition,
    rails: { ...imposition.rails, [side]: { ...current, ...patch } },
  };
}

/** The imposition with `side` stacked or split, keeping its order and shares —
 *  a re-split lands on the arrangement the user last chose, not on a default. */
export function withRailMode(
  imposition: DeckImposition,
  side: SidebarSide,
  mode: RailMode,
): DeckImposition {
  return withRailField(imposition, side, { mode });
}

/** The imposition with `side`'s members in `order`, top to bottom. */
export function withRailOrder(
  imposition: DeckImposition,
  side: SidebarSide,
  order: readonly string[],
): DeckImposition {
  return withRailField(imposition, side, { order: [...order] });
}

/** The imposition with `side`'s height weights replaced. */
export function withRailShares(
  imposition: DeckImposition,
  side: SidebarSide,
  shares: Record<string, number>,
): DeckImposition {
  return withRailField(imposition, side, { shares: { ...shares } });
}

/** The imposition with `side`'s height weights removed — an equal division,
 *  keeping the side's mode and order. */
export function withoutRailShares(
  imposition: DeckImposition,
  side: SidebarSide,
): DeckImposition {
  const current = imposition.rails?.[side];
  if (current?.shares === undefined) return imposition;
  const { shares: _dropped, ...rest } = current;
  return { ...imposition, rails: { ...imposition.rails, [side]: rest } };
}

/**
 * How much of the run a member is worth: its stored weight, or 1.
 *
 * A weight that is not a positive finite number reads as 1 rather than as an
 * error. These arrive from a JSON blob and from gesture arithmetic, and a rail
 * that refuses to lay itself out because one number is `NaN` is worse than a
 * rail that divides evenly.
 */
function railWeightOf(
  shares: Readonly<Record<string, number>> | undefined,
  componentId: string,
): number {
  const weight = shares?.[componentId];
  return typeof weight === "number" && Number.isFinite(weight) && weight > 0
    ? weight
    : 1;
}

/** The narrowest a seam segment may be, as a fraction of the run. Keeps the
 *  fractions strictly increasing and every derived weight positive. */
const RAIL_SEAM_EPSILON = 1e-6;

/**
 * Where the seams fall in a rail of `order`, as cumulative fractions of the
 * vertical run: N members give N−1 strictly increasing values in (0, 1), and
 * `fractions[j]` is where the gap between member `j` and member `j+1` sits.
 *
 * Renormalized over the members actually in `order`, so a rail that lost a
 * member divides what it has rather than leaving a hole where that member was.
 * Computed, never stored — the record holds weights ([P02]), and a fraction is
 * what those weights mean for the members standing right now.
 */
export function railSeamFractions(
  order: readonly string[],
  shares: Readonly<Record<string, number>> | undefined,
): readonly number[] {
  if (order.length < 2) return [];
  const weights = order.map((id) => railWeightOf(shares, id));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const fractions: number[] = [];
  let running = 0;
  for (let i = 0; i < weights.length - 1; i += 1) {
    running += weights[i];
    const fraction = running / total;
    const floor = (i + 1) * RAIL_SEAM_EPSILON;
    const ceiling = 1 - (weights.length - 1 - i) * RAIL_SEAM_EPSILON;
    fractions.push(Math.min(Math.max(fraction, floor), ceiling));
  }
  return fractions;
}

/**
 * The inverse of {@link railSeamFractions}: the weights a set of seam fractions
 * means.
 *
 * Segment lengths *are* the weights, so every member the drag did not touch
 * keeps its ratio to every other untouched member by construction — which is
 * the [P02] property, and the reason a seam drag commits through a named pure
 * function rather than through arithmetic inlined in a pointer handler.
 *
 * Scaled to average 1 per member, so an equal division round-trips to the
 * all-ones record that an absent `shares` already means.
 */
export function railSharesFromFractions(
  order: readonly string[],
  fractions: readonly number[],
): Record<string, number> {
  const shares: Record<string, number> = {};
  if (order.length === 0) return shares;
  if (order.length === 1) return { [order[0]]: 1 };
  // Sanitized on the way in: a non-finite or out-of-order fraction would give a
  // zero-or-negative segment, and a weight of zero is not a height.
  const bounded: number[] = [];
  for (let i = 0; i < order.length - 1; i += 1) {
    const raw = fractions[i];
    const floor = (bounded[i - 1] ?? 0) + RAIL_SEAM_EPSILON;
    const ceiling = 1 - (order.length - 1 - i) * RAIL_SEAM_EPSILON;
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : floor;
    bounded.push(Math.min(Math.max(value, floor), ceiling));
  }
  const scale = order.length;
  let previous = 0;
  for (let i = 0; i < order.length; i += 1) {
    const upper = i === order.length - 1 ? 1 : bounded[i];
    shares[order[i]] = (upper - previous) * scale;
    previous = upper;
  }
  return shares;
}

/**
 * The custom property carrying seam `index` on `side`, as a plain number in
 * (0, 1) — the fraction of the run the seam sits at.
 *
 * Deliberately unregistered, the same discipline {@link sidebarWidthProperty}
 * holds: every expression reading one supplies the equal-division fraction as
 * its `var()` fallback, so a frame that renders before the properties land
 * still tiles the rail.
 */
export function railSeamProperty(side: SidebarSide, index: number): string {
  return `--tug-rail-${side}-seam-${index}`;
}

/** One split member's place in its rail: which side, which position, and how
 *  many members it divides the run with. */
export interface RailMemberPlacement {
  side: SidebarSide;
  index: number;
  count: number;
}

/** Narrow an unknown (a parsed blob field, an action payload) to a side. */
export function isSidebarSide(value: unknown): value is SidebarSide {
  return value === "left" || value === "right";
}

/** Narrow an unknown (a parsed blob field, an action payload) to a width. */
export function isContentWidth(value: unknown): value is ContentWidth {
  return value === "slim" || value === "comfy" || value === "wide";
}

/** Every imposition kind, in ascending slot count — the Lens picker's order. */
export const IMPOSITION_KINDS: readonly ImpositionKind[] = [
  "one-up",
  "two-up",
  "three-up",
  "four-up",
  "five-up",
  "six-up",
];

/**
 * The arrangement a deck stands under when nothing has said otherwise — the
 * factory default on a fresh install, and the fallback an absent or unreadable
 * blob kind restores under. An imposition is always active; there is no off.
 */
export const DEFAULT_IMPOSITION_KIND: ImpositionKind = "three-up";

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

/* ---------------------------------------------------------------------------
 * Content width presets
 * ---------------------------------------------------------------------------*/

/**
 * What each {@link ContentWidth} is, in pixels.
 *
 * **Slim (675)** is the narrow reading width the Session card's chrome was put
 * on a diet to reach; **comfy (800)** is what every content card shipped at
 * before the presets existed, which is why a record with no `contentWidth`
 * reads as comfy; **wide (1230)** is comfy scaled by that same ratio again,
 * for a card holding code and prose at once.
 *
 * A width is applied by a *command*, through `movePane` — the imposer still
 * passes width through untouched, so [D121]'s "a slot is a position anchor,
 * not a rect" is unaffected. Each is one named constant, so retuning `wide`
 * (the one the brief marks as taste) stays a one-line change.
 */
export const CONTENT_WIDTH_SLIM_PX = 675;
export const CONTENT_WIDTH_COMFY_PX = 800;
export const CONTENT_WIDTH_WIDE_PX = 1230;

/** The widths in the order every picker offers them: narrow to wide. */
export const CONTENT_WIDTH_PRESETS: readonly ContentWidth[] = [
  "slim",
  "comfy",
  "wide",
];

/** Pixels per width. */
export const CONTENT_WIDTH_PX: Readonly<Record<ContentWidth, number>> = {
  slim: CONTENT_WIDTH_SLIM_PX,
  comfy: CONTENT_WIDTH_COMFY_PX,
  wide: CONTENT_WIDTH_WIDE_PX,
};

/** How each width is named in the UI — one spelling, every surface. */
export const CONTENT_WIDTH_LABELS: Readonly<Record<ContentWidth, string>> = {
  slim: "Slim",
  comfy: "Comfy",
  wide: "Wide",
};

/**
 * The width a pane actually lands on when `preset` is applied to it: the
 * preset's pixels, held between the pane's own minimum and maximum.
 *
 * Neither bound is decoration. `movePane` does not clamp — it writes the rect it
 * is handed — so a preset resolved outside the stack's policy would be stored at
 * one width and painted at another until the next resize. The floor matters
 * because a stack's `sizePolicy.min.width` can be wider than a preset (Settings'
 * 720 beats slim's 675); the ceiling matters because a card can be size-locked
 * (About is 320 wide, min and max both), and the deck-wide default reaches every
 * content pane, including those.
 *
 * A card whose bounds beat the preset still gets the *stamp*: the user picked
 * that row, and the width they got is as close to it as the card allows. Pure so
 * both appliers — the per-pane popup and the deck-wide default — resolve
 * identically, and so the arithmetic is testable without a deck.
 */
export function resolveContentWidthPx(
  preset: ContentWidth,
  minWidth: number,
  maxWidth?: number,
): number {
  const width = Math.max(CONTENT_WIDTH_PX[preset], minWidth);
  return maxWidth === undefined ? width : Math.min(width, Math.max(maxWidth, minWidth));
}

/**
 * How long the deck takes to settle into a new arrangement, in milliseconds.
 *
 * Changing the imposition moves every derived frame at once, and they cross to
 * their new places rather than cutting — by a measured FLIP tween started in
 * `deck-canvas.tsx`. That module writes this number onto the frames' container
 * as `--tugx-imposer-settle-duration` and reads the resolved value back when
 * timing the settle, so the tween and the window that frames it are one number
 * and an override on the container tunes both.
 */
export const IMPOSITION_SETTLE_MS = 300;

/**
 * Which side the pinned Lens holds, as a number: 0 is the left edge, 1 the
 * right. Registered as a `<number>` custom property in `tug-pane.css` so the
 * expression that reads it can compute with it — see {@link imposeSidebarStyle}.
 */
export const LENS_RAIL_PROPERTY = "--tugx-lens-rail";

/**
 * A side's live rail width, as a CSS length on the frames' containing block
 * (`deck-canvas.tsx` writes it).
 *
 * The width is the one number a rail edge drag changes, and it is an input to
 * three expressions at once: the sidebar's own pin on a right-side deck (`100%
 * - width - gap`), the band the chain is imposed across, and the frame's own
 * `width`. Carried as a property rather than baked into each of them, the drag
 * writes it once and the browser re-resolves all three in the same reflow — so
 * the pinned edge holds and the cards re-impose live, with no measurement and
 * no per-frame JavaScript ([L06]).
 *
 * One property per SIDE, not per card: same-side sidebar cards share a rail, so
 * they share a width, and a stacked pair reading one property cannot drift
 * apart mid-drag.
 *
 * Deliberately unregistered: every expression reading it supplies the
 * React-known width as the `var()` fallback, so a frame that renders before the
 * property is written lands on exactly the geometry it would have had. A
 * registered property has an initial value instead of an absence, and the
 * fallback would never be reached.
 */
export function sidebarWidthProperty(side: SidebarSide): string {
  return side === "left"
    ? "--tug-sidebar-width-left"
    : "--tug-sidebar-width-right";
}

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

/** How many slots the kind defines: 1 through 6. */
export function slotCount(kind: ImpositionKind): number {
  switch (kind) {
    case "one-up":
      return 1;
    case "two-up":
      return 2;
    case "three-up":
      return 3;
    case "four-up":
      return 4;
    case "five-up":
      return 5;
    case "six-up":
      return 6;
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
 * Placement
 * ---------------------------------------------------------------------------*/

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
  /** How many slots the kind defines. */
  count: number;
}

/**
 * Resolve one pane's place from its slot and the deck's arrangement. `slot`
 * is clamped to the kind, so shrinking four-up to two-up pulls the outer slots
 * in rather than dropping their panes out of the arrangement.
 *
 * The Lens's side is not an input. It moves the band's edges — which is the
 * insets' job, not the numbering's — and slot 1 is the leftmost position on
 * either deck.
 */
export function resolvePlacement(
  kind: ImpositionKind,
  slot: number,
): ImposedPlacement {
  return { slot: clampSlot(kind, slot), count: slotCount(kind) };
}

/**
 * A slot's share of the band's travel: `slot / (slots - 1)`, in `[0, 1]`. Slot
 * 0 gives 0 (hug the band's left edge) and the last slot gives 1 (hug its
 * right).
 *
 * **One-up is the special case.** With a single anchor there is no chain to
 * number, so the rule that spaces the ends against the edges has nothing to
 * space: `0 / 0`. Its one slot takes HALF the travel instead — the card stands
 * centered in the band, with the slack split evenly on both sides. A lone card
 * shoved against the left edge would read as a two-up arrangement missing its
 * partner; centered, it reads as the one thing on the deck, which is what
 * one-up means.
 */
export function travelFraction(placement: ImposedPlacement): number {
  if (placement.count < 2) return 0.5;
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

/** One side's rail: the width the cards stacked on that side share. A side
 *  with no open, pinned sidebar card has no rail and is absent. */
export interface SidebarRail {
  side: SidebarSide;
  width: number;
}

/**
 * Resolve the span from the canvas box and the rails standing on its edges. No
 * rails means the span is the whole canvas; one or two inset it from that side.
 *
 * A rail is itself imposed — it stands one gap off the canvas edge — so its
 * near edge sits `width + gap` in, and that is the inset the band takes on that
 * side. The chain's own gap then lands its far card exactly one gap off the
 * rail. This is the numeric twin of the `--tug-imposer-inset-*` custom
 * properties `deck-canvas.tsx` writes; both add the same gap per occupied side,
 * so they agree by construction.
 *
 * **This function is the gap count.** A closed rail contributes neither width
 * nor gap, so the band a solve must reproduce is `span.width − 2 × gap` for
 * whatever rails stand — never a constant number of gaps written out by hand.
 * {@link solveSidebarWidths} derives its band identity from here rather than
 * carrying its own arithmetic, which is what keeps the numeric twin and the CSS
 * from parting company as rails come and go.
 */
export function resolveSpan(
  canvas: { width: number; height: number },
  rails: readonly SidebarRail[],
): ImposerSpan {
  let left = 0;
  let right = 0;
  for (const rail of rails) {
    const inset = rail.width + IMPOSITION_GAP_PX;
    if (rail.side === "left") left += inset;
    else right += inset;
  }
  return {
    x: left,
    width: canvas.width - left - right,
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
 *
 * `pinned` mirrors {@link imposeStyle}'s: the slot is computed from
 * `slotWidth` either way, and a pinned card keeps its own size centred inside
 * it rather than filling it.
 */
export function imposeRect(
  placement: ImposedPlacement,
  slotWidth: number,
  span: ImposerSpan,
  pinned?: PinnedFrame,
): ImposedRect {
  const bandWidth = span.width - IMPOSITION_GAP_PX * 2;
  const travel = Math.max(0, bandWidth - slotWidth);
  const offset = travelFraction(placement) * travel;
  const runHeight = span.height - IMPOSITION_GAP_PX - IMPOSITION_GAP_BOTTOM_PX;
  const width = pinned?.width ?? slotWidth;
  const height = pinned?.height ?? runHeight;
  return {
    position: {
      x: span.x + IMPOSITION_GAP_PX + offset + Math.max(0, (slotWidth - width) / 2),
      y: IMPOSITION_GAP_PX + Math.max(0, (runHeight - height) / 2),
    },
    size: { width, height },
  };
}

/**
 * The CSS form: inline frame styles that pin the pane to its slot's anchor. One
 * horizontal pin, always measured from the left: the left inset, the gap, and
 * this slot's share of the pane's travel across the band.
 *
 * The travel is a `max()` over the live band, so the browser is the one that
 * decides how much room the arrangement has — and it re-decides on every
 * reflow. That is the whole of the deck's response to a window or display
 * resize.
 *
 * Because the numbering never turns around, the pin's *shape* is the same on
 * every deck — only the two inset terms change when the Lens crosses. That is
 * what a flip has to interpolate: one expression, same form on both sides. (An
 * arrangement that measured from the right when the Lens was left would be
 * swapping a bare length for a percentage, which is not the same kind of value
 * and cuts instead of crossing.)
 *
 * The vertical run is the top gap down to the deeper bottom gap.
 *
 * `pinned` separates the SLOT from the FRAME. Normally they are the same box:
 * `slotWidth` is the pane's own width, the frame fills the run, and the two
 * words describe one rect. A size-locked card breaks them apart. About is 320
 * × 360 by registration — an about box has exactly one correct size — and it
 * has no larger form to be stretched into, so the imposition PLACES it rather
 * than sizing it: the slot is computed as though an ordinary content card
 * stood there, and About is centred inside it on both axes.
 *
 * Taking the slot from the card's own 320 instead would be the visible bug in
 * the screenshot this was written from: the card hugs the band's left edge in
 * slot 0, because a narrow pane has more travel to give away, and the slot the
 * eye expects — the one every other card in that arrangement occupies — is not
 * where it sits. The slot belongs to the arrangement, not to the card standing
 * in it.
 *
 * Both `max(0px, …)` terms keep a card LARGER than its slot from hanging off:
 * it pins at the near edge rather than taking a negative offset.
 */
export interface PinnedFrame {
  /** The card's own width, centred across `slotWidth`. */
  width?: number;
  /** The card's own height, centred down the vertical run. */
  height?: number;
}

export function imposeStyle(
  placement: ImposedPlacement,
  slotWidth: number,
  pinned?: PinnedFrame,
): React.CSSProperties {
  const frameWidth = pinned?.width ?? slotWidth;
  const style: React.CSSProperties =
    pinned?.height === undefined
      ? {
          width: `${frameWidth}px`,
          height: "auto",
          top: GAP,
          bottom: GAP_BOTTOM,
        }
      : {
          width: `${frameWidth}px`,
          height: `${pinned.height}px`,
          top: `calc(${GAP} + max(0px, (100% - ${GAP} - ${GAP_BOTTOM} - ${pinned.height}px) / 2))`,
        };

  const band = `(100% - ${INSET_LEFT} - ${INSET_RIGHT} - ${GAP} * 2)`;
  const fraction = travelFraction(placement);
  // `k / (N - 1) × max(0, band - width)` — see the module note.
  const offset =
    fraction === 0 ? "0px" : `${fraction} * max(0px, ${band} - ${slotWidth}px)`;
  // The centring term is a plain number, not a percentage: both widths are
  // known here, so it never needs the browser to resolve it.
  const centre =
    frameWidth === slotWidth ? "" : ` + ${Math.max(0, (slotWidth - frameWidth) / 2)}px`;
  style.left = `calc(0% + ${INSET_LEFT} + ${GAP} + ${offset}${centre})`;
  return style;
}

/* ---------------------------------------------------------------------------
 * The space allocator
 * ---------------------------------------------------------------------------*/

/**
 * How far the allocator may shrink a rail under the width the user chose, as a
 * fraction of it.
 *
 * The two directions are deliberately not symmetric, because they are not the
 * same gesture. Growing a rail spends slack the deck had lying between the
 * cards, so its ceiling is generous: a rail may stand as wide as a SLIM
 * content card, carried in as {@link AllocatorInput.maxRailWidth}. Shrinking
 * takes room away from a surface the user sized to hold content, which is
 * felt much sooner, so the low end stays a fifth under the chosen width.
 *
 * {@link RailPolicy.minWidth} clips the low end independently, so a rail is
 * never shrunk under its floor.
 */
export const LENS_FLEX_SHRINK_FRACTION = 0.2;

/**
 * How long the canvas must hold still before a resize counts as settled and the
 * allocator re-tunes (`deck-canvas.tsx`). Lives here so the imposer's tuning
 * surface stays in one module, beside {@link IMPOSITION_SETTLE_MS}.
 */
export const RESIZE_RETUNE_QUIET_MS = 200;

/**
 * How far a seam may sit off {@link IMPOSITION_GAP_PX} and still count as
 * tiled. This is the whole of the allocator's licence: it may take the Lens's
 * width only to buy a chain whose every seam lands inside this.
 *
 * Two pixels, because that is about where a seam stops matching its neighbours
 * to the eye at the sizes the deck runs at. It is a tolerance on the RESULT,
 * never on the input — whether a width is worth taking is a question about the
 * picture it produces, and the picture is what the seams are.
 */
export const ALLOCATOR_RESIDUAL_TOLERANCE_PX = 2;

/**
 * One rail's flex policy: the width the user chose, which sets how far the
 * allocator may shrink it, and the hard floor it may not cross.
 *
 * A rail shared by a stack carries the TIGHTEST floor among its members — a
 * rail is one width, so a floor binding on either card binds the rail.
 */
export interface RailPolicy {
  /** The width the user chose. The allocator may not shrink the rail more
   *  than {@link LENS_FLEX_SHRINK_FRACTION} under it; growth is bounded by
   *  {@link AllocatorInput.maxRailWidth} instead, which every rail shares. */
  preferredWidth: number;
  /** The hard floor this rail may not go below. */
  minWidth: number;
}

/** A width per occupied side — the allocator's answer, and the shape a rail's
 *  policies arrive in. A side with no rail is absent from both. */
export type RailWidths = { left?: number; right?: number };

/** Everything {@link allocateSidebarWidths} reads. All lengths in layout px. */
export interface AllocatorInput {
  /** The canvas (frames' container) client width. */
  canvasWidth: number;
  /** The active kind; its slot count defines the travel fractions. */
  kind: ImpositionKind;
  /**
   * The occupied slots and the width each one renders at — the RENDER width,
   * already raised to the stack's size floor, since that is the width the chain
   * actually paints. Duplicates are folded by taking the widest.
   */
  occupied: readonly { slot: number; width: number }[];
  /** The rails standing on the deck's edges, at most one per side. */
  rails: { left?: RailPolicy; right?: RailPolicy };
  /**
   * The widest any rail may stand, in pixels — the ceiling every rail shares,
   * the way the shrink floor is each rail's own. The deck passes
   * {@link CONTENT_WIDTH_SLIM_PX}: a rail may be as wide as a slim content
   * card and no wider, whatever Card Width the deck is set to — a sidebar is
   * a reading surface, and a comfy- or wide-sized one is absurd on its face.
   */
  maxRailWidth: number;
}

/** The sides carrying a rail, left before right — the order every per-rail sum
 *  in the solve runs in. */
function railSidesOf(rails: AllocatorInput["rails"]): readonly SidebarSide[] {
  const sides: SidebarSide[] = [];
  if (rails.left !== undefined) sides.push("left");
  if (rails.right !== undefined) sides.push("right");
  return sides;
}

/** The widths as rails, for {@link resolveSpan}. */
function railsOf(widths: RailWidths): readonly SidebarRail[] {
  const rails: SidebarRail[] = [];
  if (widths.left !== undefined) rails.push({ side: "left", width: widths.left });
  if (widths.right !== undefined) {
    rails.push({ side: "right", width: widths.right });
  }
  return rails;
}

/**
 * The width each pinned sidebar rail should render at so the imposed chain
 * tiles evenly — one width per occupied side, or `null` when the rails do not
 * move.
 *
 * ## What is being solved
 *
 * A slot is an anchor at a fixed fraction of the band, and a pane's width is its
 * own — so the slack between two adjacent imposed cards is whatever the band's
 * width leaves over. Choose an arrangement on a wide deck and the cards stand
 * apart; narrow the window slightly and the same arrangement overlaps. Neither
 * is wrong, but neither is what the eye wants either, and no number in the
 * placement rule can fix it: card widths belong to the panes ([L09]) and the
 * offsets are pure functions of the band.
 *
 * The rails' width is the one quantity that can absorb the residual, because it
 * *is* the band's other end: `band = canvasWidth − Σ rail − (R + 2) × gap` for
 * `R` standing rails (each stands a gap off its canvas edge, and the chain is
 * inset one gap at each end of what is left). Flexing the rails a little moves
 * every seam at once. The gap count is read off {@link resolveSpan} rather than
 * written down, since a closed rail contributes neither width nor gap.
 *
 * ## The solve
 *
 * With `fⱼ` the travel fraction of the j-th occupied slot and `wⱼ` its render
 * width, the seam between neighbours `j` and `j+1` is linear in the band:
 *
 * ```
 *   seamⱼ(B) = aⱼ·B + cⱼ      aⱼ = fⱼ₊₁ − fⱼ      cⱼ = fⱼwⱼ − fⱼ₊₁wⱼ₊₁ − wⱼ
 * ```
 *
 * so the band that puts every seam as close to one imposition gap as it can is
 * a plain least-squares fit with a closed form — no iteration, no measurement:
 *
 * ```
 *   B* = Σ aⱼ(gap − cⱼ) / Σ aⱼ²        T* = canvasWidth − (R + 2)·gap − B*
 * ```
 *
 * `T*` is the rails' TOTAL. That total is shared out as **one width every rail
 * stands at** — `T* / R` — never as per-rail solves: the sidebars are a uniform
 * class the way content cards are, and an arrangement is not allowed to answer
 * with two rails at two widths. Each rail's shrink floor becomes a bound on
 * the single shared width; the ceiling — the slim content width — is one
 * bound they already share.
 *
 * For the common case — uniform card widths at an even stride, e.g. five-up
 * with slots 1, 3 and 5 — the fit is exact and every seam lands on the gap.
 * Irregular occupancy (slots 1, 2 and 5) has no band that tiles it at all: the
 * fit spreads the error rather than removing it, and the answer is that there
 * is no answer.
 *
 * ## `null` — the rails do not move
 *
 * **A rail's width is the user's**, and it is taken from them for exactly one
 * reason: to close the gaps. So the whole of the decision is one question asked
 * of the RESULT — *standing there, does the chain tile?* — and the three steps
 * are:
 *
 *   1. solve for the total the seams want,
 *   2. share it out as one width, clamped between the tightest shrink floor
 *      and the slim-width ceiling,
 *   3. keep it only if every seam at that width lands within
 *      {@link ALLOCATOR_RESIDUAL_TOLERANCE_PX} of the gap; otherwise `null`.
 *
 * `null` means *leave every rail exactly where it is*. There is no fallback
 * width. Answering with the preferred widths when the solve is unusable reads
 * like a safe default but is a MOVE: it drags a rail the user sized by hand
 * back to a remembered number and closes no gap doing it. The move is all-or-
 * nothing across the rails too — half a gesture is not a picture anyone asked
 * for.
 *
 * Step 3 is asked of every answer, not only clamped ones, because a solve can
 * sit comfortably inside the allowance and still not tile — the least-squares
 * fit always returns its best band, and on an arrangement with no tiling band
 * its best is still ragged. Moving the rails there would spend the user's width
 * on nothing.
 *
 * And it is asked of the picture, never of how far the solve missed by. A hard
 * cap on the NUMBER makes the deck refuse arrangements that tile perfectly well
 * a few pixels past it, and a seam left sitting at 50px because the correction
 * overshot its allowance by 0.7% is not something the user can be told.
 *
 * Total by construction: never throws.
 */
export function allocateSidebarWidths(input: AllocatorInput): RailWidths | null {
  const sides = railSidesOf(input.rails);
  if (sides.length === 0) return null;
  if (!Number.isFinite(input.maxRailWidth) || input.maxRailWidth <= 0) {
    return null;
  }
  const total = solveSidebarWidths(input);
  if (total === null) return null;

  // ONE width, shared. Every rail stands at the same number, so each rail's
  // shrink floor becomes a bound on that one number and the interval the width
  // must land in is the intersection of them all. Clamping the rails
  // independently would satisfy every floor and still break the rule: it hands
  // out unequal widths, which is the per-card solve this rule exists to refuse.
  let low = 0;
  for (const side of sides) {
    const rail = input.rails[side] as RailPolicy;
    const { preferredWidth, minWidth } = rail;
    low = Math.max(
      low,
      minWidth,
      Math.round(preferredWidth * (1 - LENS_FLEX_SHRINK_FRACTION)),
    );
  }

  // A ceiling under the floor means a floor above the slim width — a rail
  // that cannot paint its contents at any width the ceiling permits. The
  // floor wins: it is a width below which the rail cannot paint at all,
  // while the ceiling is only a policy about how wide the deck may stand a
  // rail.
  const high = Math.max(low, Math.round(input.maxRailWidth));
  const wanted = total / sides.length;
  const width = Math.round(Math.min(high, Math.max(low, wanted)));

  const widths: RailWidths = {};
  for (const side of sides) widths[side] = width;
  return worstSeamError(input, widths) <= ALLOCATOR_RESIDUAL_TOLERANCE_PX
    ? widths
    : null;
}

/**
 * The raw closed-form solve — the rails' TOTAL width that would put every seam
 * on one imposition gap, with no flex range applied and nothing said about how
 * the total is shared out — or `null` when there is nothing to solve for (no
 * rail standing, fewer than two occupied slots, a degenerate chain, a
 * non-finite input).
 *
 * Split out from {@link allocateSidebarWidths} so the number the fit actually wants
 * is inspectable on its own. The range check is a policy about how far the deck
 * may move under the user; the solve is the geometry, and the two answer
 * different questions.
 */
export function solveSidebarWidths(input: AllocatorInput): number | null {
  const chain = chainOf(input);
  if (chain === null) return null;
  const railCount = railSidesOf(input.rails).length;
  if (railCount === 0) return null;

  const count = slotCount(input.kind);
  let numerator = 0;
  let denominator = 0;
  for (let j = 0; j < chain.length - 1; j += 1) {
    const near = chain[j];
    const far = chain[j + 1];
    const fNear = travelFraction({ slot: near.slot, count });
    const fFar = travelFraction({ slot: far.slot, count });
    const a = fFar - fNear;
    const c = fNear * near.width - fFar * far.width - near.width;
    numerator += a * (IMPOSITION_GAP_PX - c);
    denominator += a * a;
  }
  if (denominator <= 0) return null;

  // The band identity, read off {@link resolveSpan} rather than written out:
  // `band = span.width − 2 × gap` and `span.width = canvasWidth − Σ(rail + gap)`,
  // so the rails' total is `canvasWidth − (R + 2)·gap − band`. At one rail that
  // is today's `3 × gap`, which is why the constant was safe to write down and
  // is not safe to carry forward — the gap count is a function of how many
  // rails stand, and a closed rail contributes neither width nor gap.
  const band = numerator / denominator;
  const solved = Math.round(
    input.canvasWidth - IMPOSITION_GAP_PX * (railCount + 2) - band,
  );
  return Number.isFinite(solved) ? solved : null;
}

/**
 * The occupied slots as the chain actually reads left to right: duplicates
 * folded to the widest pane standing at that slot, ordered by slot. `null` when
 * there is no chain — fewer than two occupied slots (no seam exists), or an
 * input with a non-finite number anywhere in it.
 */
function chainOf(
  input: AllocatorInput,
): readonly { slot: number; width: number }[] | null {
  const { canvasWidth, kind, occupied, rails } = input;
  if (!Number.isFinite(canvasWidth)) return null;
  for (const side of railSidesOf(rails)) {
    const { preferredWidth, minWidth } = rails[side] as RailPolicy;
    if (!Number.isFinite(preferredWidth) || preferredWidth <= 0) return null;
    if (!Number.isFinite(minWidth)) return null;
  }

  const widest = new Map<number, number>();
  for (const entry of occupied) {
    if (!Number.isFinite(entry.width) || !Number.isFinite(entry.slot)) return null;
    const slot = clampSlot(kind, entry.slot);
    const held = widest.get(slot);
    if (held === undefined || entry.width > held) widest.set(slot, entry.width);
  }
  const chain = [...widest.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, width]) => ({ slot, width }));
  return chain.length < 2 ? null : chain;
}

/**
 * The widest any seam misses {@link IMPOSITION_GAP_PX} by when the rails stand
 * at `widths` — how ragged the chain reads, in pixels, at those widths.
 *
 * Measured from {@link imposeRect}'s actual rule rather than from the linear
 * form the fit is built on. The two agree while every pane still has travel
 * left, and part company exactly when a pane is wider than the band: the real
 * rule clamps its travel at zero and the line does not, so on a crowded deck
 * the linear form describes a picture the browser never paints. Since this is
 * the test that decides whether the Lens is allowed to move at all, it has to
 * be asked of the picture that will actually be on screen.
 */
function worstSeamError(input: AllocatorInput, widths: RailWidths): number {
  const chain = chainOf(input);
  if (chain === null) return 0;
  // The span comes from `resolveSpan`, not from an inline single-rail
  // expression: with rails on both edges the band is inset twice, and a span
  // built for one of them describes a picture the browser never paints — which
  // is the one thing this test may not do.
  const span = resolveSpan(
    { width: input.canvasWidth, height: 0 },
    railsOf(widths),
  );
  const count = slotCount(input.kind);
  let worst = 0;
  for (let j = 0; j < chain.length - 1; j += 1) {
    const near = chain[j];
    const far = chain[j + 1];
    const nearRect = imposeRect({ slot: near.slot, count }, near.width, span);
    const farRect = imposeRect({ slot: far.slot, count }, far.width, span);
    const seam =
      farRect.position.x - (nearRect.position.x + nearRect.size.width);
    worst = Math.max(worst, Math.abs(seam - IMPOSITION_GAP_PX));
  }
  return worst;
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
 * The side is emitted as a **number**, not as a pin, and the pin is one
 * expression that reads it: {@link LENS_RAIL_PROPERTY} is 0 on the left and 1
 * on the right, and `left` mixes the two anchors by it. The rail is a static
 * side selector — it is written at re-imposition and holds until the next one.
 *
 * The two anchors cannot be emitted as two values of `left`, which is what the
 * rail exists to avoid: the left anchor is `5px` and the right one is
 * `100% - width - gap`, and a bare length and a percentage are not the same
 * kind of value, so `left` would have to carry a shape that changes with the
 * side. Nor can the left anchor be dressed as a percentage — a `calc(0% + 5px)`
 * is simplified straight back to `5px` at computed-value time. One expression
 * over a number keeps the frame's resting geometry a single property whichever
 * side it holds.
 *
 * Crossing between the two sides is not this expression's job. The Lens travels
 * by the same measured FLIP tween as every other frame (`deck-canvas.tsx`,
 * `lib/pane-flip.ts`): the new side lands in one layout pass and a transform
 * carries the frame across. Interpolating the rail instead would re-resolve
 * `left` — and re-run layout — on every frame of the crossing.
 *
 * The width is read from {@link sidebarWidthProperty}'s property rather than
 * written as a length, and the pin is written in terms of the same expression.
 * On a right-side deck the pin IS the width (`100% - width - gap`), so a width
 * that changes without the pin changing means the pinned edge is the one that
 * moves — which is precisely backwards: the deck edge is what the sidebar
 * holds, and the dragged edge is the only one a resize may move. One property
 * feeding both makes that true by construction rather than by the drag
 * remembering to update two numbers.
 *
 * **A shared rail is a stack by default; the user may split it.** Two sidebar
 * cards on one side get the *same* geometry — same pin, same width property,
 * same full vertical run — and stand front-to-back, exactly as two panes
 * sharing a slot do; which one you see is the deck's z-order, and the title
 * bar's stack badge is how you reach the one behind. That is the resting state,
 * and it stays the default.
 *
 * Both arrangements have now been lived on, and each was found wanting alone.
 * An automatic vertical split was tried first and was a worse Lens: it spent a
 * rail's height to show two half-cards, which is what the Jots section was
 * already doing inside the Lens, only less space-efficient. The stack that
 * replaced it hides content the user wants visible at once. What both verdicts
 * point at is that the division is a *choice*, so the user makes it per side —
 * {@link RailArrangement} records it, and passing `options.member` here is what
 * a split member's frame asks for. Without `member`, or with a rail of one, the
 * output is byte-identical to the stacked frame it has always been.
 *
 * A split member's vertical pins are the run's fractions in `calc()`, read from
 * the seam properties ({@link railSeamProperty}) rather than resolved here, for
 * the same reason the width is: the browser re-resolves fractions of the run on
 * its own reflow, so a window resize costs no JavaScript ([L06]), and a seam
 * drag is one `setProperty` call.
 */
export function imposeSidebarStyle(
  side: SidebarSide,
  paneWidth: number,
  options: { widthProperty?: string; member?: RailMemberPlacement } = {},
): React.CSSProperties {
  const rail = side === "right" ? 1 : 0;
  const widthProperty = options.widthProperty ?? sidebarWidthProperty(side);
  const width = `var(${widthProperty}, ${paneWidth}px)`;
  const style: Record<string, string | number> = {
    width,
    height: "auto",
    ...railMemberPins(options.member),
    [LENS_RAIL_PROPERTY]: rail,
    left:
      `calc(var(${LENS_RAIL_PROPERTY}) * (100% - ${width} - ${GAP})` +
      ` + (1 - var(${LENS_RAIL_PROPERTY})) * ${GAP})`,
  };
  return style as React.CSSProperties;
}

/** The vertical run a rail's members divide: the frames' container less the
 *  gap it keeps at the top and the deeper one it keeps at the bottom. */
const RAIL_RUN = `(100% - ${GAP} - ${GAP_BOTTOM})`;

/** Half an imposition gap — each seam takes one, half from each neighbour, so
 *  the air between two split members reads as the same rhythm as every other
 *  seam on the deck. */
const RAIL_SEAM_HALF_GAP = `${IMPOSITION_GAP_PX / 2}px`;

/**
 * A member's `top` and `bottom` — the rail's own endpoints for the first and
 * last member, and the seam either side of it for the rest.
 *
 * The endpoints are written as the bare gaps rather than as fractions of the
 * run so the ends of a split rail land on exactly the pins an unsplit one has:
 * a top member and a stacked card share a top edge to the pixel, and the eye
 * reads a split as a division of the card it already knew.
 */
function railMemberPins(
  member: RailMemberPlacement | undefined,
): { top: string; bottom: string } {
  if (member === undefined || member.count < 2) {
    return { top: GAP, bottom: GAP_BOTTOM };
  }
  const { side, index, count } = member;
  const seam = (j: number): string =>
    `var(${railSeamProperty(side, j)}, ${(j + 1) / count})`;
  return {
    top:
      index === 0
        ? GAP
        : `calc(${GAP} + ${seam(index - 1)} * ${RAIL_RUN} + ${RAIL_SEAM_HALF_GAP})`,
    bottom:
      index === count - 1
        ? GAP_BOTTOM
        : `calc(${GAP_BOTTOM} + (1 - ${seam(index)}) * ${RAIL_RUN} + ${RAIL_SEAM_HALF_GAP})`,
  };
}

