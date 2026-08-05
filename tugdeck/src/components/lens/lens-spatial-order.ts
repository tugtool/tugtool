/**
 * lens-spatial-order.ts — the Lens's arrow plane ([P22] / [P23]).
 *
 * The Lens used to declare no spatial order and ride the liveliness net alone.
 * The net is a *linear* walk — Down and Right both advance, Up and Left both
 * retreat — so every arrow in the Lens meant "next stop" or "previous stop",
 * and a Down on a section band stepped RIGHT into that band's filter field
 * instead of dropping into the rows underneath it. The net is the floor, not the
 * design: `focus-language.md` says a declared order is where better-than-linear
 * movement is authored, and a rail whose bands carry a row of controls over a
 * column of rows is exactly the shape the net cannot express.
 *
 * ## The plane
 *
 * The Lens is a stack of ROWS, top to bottom, and each section contributes:
 *
 *   1. its **band row** — the band itself, then its filter field, its own
 *      controls, and its fold cue, in the order they are read left to right;
 *   2. its **body rows** — one per stop the body puts in the walk (usually the
 *      one list; the Layouts section stacks two radio groups, so it has two).
 *      A collapsed section, or one holding nothing navigable, contributes none.
 *
 * `rowGridOrder` turns that into the whole plane: horizontal arrows run along a
 * band (a closed ring, so they never dead-end), vertical arrows move between
 * rows and enter each at its leading member. So Down on a band lands on the
 * first row of its own list; Down off the last row of that list crosses into the
 * NEXT section's band; Up retraces both. The section's rows are the section's
 * body — and now the arrow that points at them is the one that reaches them.
 *
 * One edge is declared by hand: **Left off a body stop returns to its own
 * band**. It is a seam rather than an override because seams are consulted
 * AFTER a group's own cursor ([P22] resolution order), and that is exactly the
 * distinction that matters here — a vertical-axis list declines horizontal
 * arrows and so takes the seam, while a horizontal radio group claims them for
 * its cursor and never sees it. One declaration, correct for both.
 *
 * ## Where the rows come from — and why nothing declares them
 *
 * The rows are **derived from what is actually registered**: the caller reads
 * each section's live focus orders off the engine (`focusOrdersInGroup`) and
 * hands them here, and the split is the sign of the order —
 *
 *     order  <  0  →  the band row, in ascending order (left to right)
 *     order  >= 0  →  one body row each, in ascending order (top to bottom)
 *
 * — which is not a new rule but the one `lens-section-registry.ts` already
 * encodes in its constants: the band's stops are the negative orders precisely
 * so they sort ahead of the body's `0`.
 *
 * This is deliberately not a table an author maintains. A hand-kept list of
 * which controls are on which row is a drift seam with a **silent** failure: a
 * stop left out of it is simply off the plane, the liveliness net catches its
 * arrows, and the section quietly reverts to linear movement with nothing to
 * see. Deriving from the registry closes that by construction — a control
 * authored into a section's focus group is on the plane the moment it
 * registers, in the position its own order puts it.
 *
 * The one thing an author must still get right is the thing they must get right
 * anyway: **a distinct order per stop within a section's group.** Two stops
 * sharing one order share one focus key ([Q12]), which the engine resolves to
 * one of them — so the other is unreachable by any addressed placement, plane or
 * no plane.
 *
 * The known edge: a body whose stops sit SIDE BY SIDE would be read as a column
 * here and get vertical arrows where it wants horizontal ones. No section does
 * that today (a body is a list, or a stack of controls); the section that wants
 * to will have to say so, and this is where it would say it.
 *
 * Pure data-in / data-out, so it is unit-testable with no DOM.
 *
 * @module components/lens/lens-spatial-order
 */

import { rowGridOrder } from "@/components/tugways/spatial-order";
import type { SpatialOrder, SpatialSeam } from "@/components/tugways/spatial-order";

/** One section's live membership, as the Lens renders it *now*. */
export interface LensSectionSpatialShape {
  /** The section's focus group — `sectionFocusGroup(kind)`. */
  group: string;
  /**
   * Every focus order registered in that group, ascending — straight from
   * `FocusContext.focusOrdersInGroup`. Negative orders are the band's row;
   * non-negative orders are the body's rows, one each.
   */
  orders: readonly number[];
}

/** A focusable's stable spatial node key ([Q12]) — the same `group:order` the
 *  engine stamps and a surface seeds with. */
function nodeKey(group: string, order: number): string {
  return `${group}:${order}`;
}

/**
 * The Lens's declared arrow plane, built from the sections as currently
 * rendered. Recompute whenever the stack's membership changes — a fold, a
 * section gaining or losing content, a reorder — because the plane describes
 * what is on screen, not what could be.
 *
 * A section with no registered stops at all contributes nothing, so a band that
 * has not mounted yet never becomes a row the arrows can land on.
 */
export function lensSpatialOrder(
  sections: readonly LensSectionSpatialShape[],
): SpatialOrder {
  const rows: string[][] = [];
  const bodySeams: SpatialSeam[] = [];

  for (const section of sections) {
    const ascending = [...section.orders].sort((a, b) => a - b);
    const band = ascending.filter((order) => order < 0);
    const body = ascending.filter((order) => order >= 0);

    if (band.length > 0) {
      rows.push(band.map((order) => nodeKey(section.group, order)));
    }
    // The band's leading stop is the band itself, and it is what a body's Left
    // returns to. A section with no band row (nothing negative registered) has
    // nowhere to send it, so the seam is simply not declared and Left falls to
    // the net — never to a node that is not there.
    const bandHead = band.length > 0 ? nodeKey(section.group, band[0]) : null;

    for (const order of body) {
      const node = nodeKey(section.group, order);
      rows.push([node]);
      if (bandHead !== null) {
        bodySeams.push({ from: node, direction: "left", to: bandHead });
      }
    }
  }

  const grid = rowGridOrder(rows);
  return {
    rings: grid.rings,
    seams: [...(grid.seams ?? []), ...bodySeams],
  };
}
