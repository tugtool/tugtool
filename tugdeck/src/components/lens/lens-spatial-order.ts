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
 * The Lens is a stack of ROWS, top to bottom, and each section contributes:
 *
 *   1. its **band row** — the band itself, then its filter field, its own
 *      controls, and its fold cue, in the order they are read left to right;
 *   2. its **body rows** — one per stop the body puts in the walk (usually the
 *      one list; the Layouts section stacks two radio groups, so it declares
 *      two). A collapsed section, or one holding nothing navigable, contributes
 *      none.
 *
 * From that, `rowGridOrder` gives the whole plane: horizontal arrows run along
 * a band (a closed ring, so they never dead-end), vertical arrows move between
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
 * Pure data-in / data-out, so it is unit-testable with no DOM.
 *
 * @module components/lens/lens-spatial-order
 */

import { rowGridOrder } from "@/components/tugways/spatial-order";
import type { SpatialOrder, SpatialSeam } from "@/components/tugways/spatial-order";

import {
  LENS_BAND_ACTION_FOCUS_ORDER,
  LENS_BAND_FILTER_FOCUS_ORDER,
  LENS_BAND_FOCUS_ORDER,
  LENS_BAND_FOLD_FOCUS_ORDER,
} from "./lens-section-registry";

/** What one section contributes to the plane, as the Lens renders it *now*. */
export interface LensSectionSpatialShape {
  /** The section's focus group — `sectionFocusGroup(kind)`. */
  group: string;
  /** The band is carrying a live filter field. */
  filter: boolean;
  /** The band is carrying the section's own controls. */
  actions: boolean;
  /**
   * The focus orders this section's body puts in the walk, top to bottom.
   * Empty while the section is collapsed or holds nothing navigable — which is
   * what makes Down on a folded band land on the next section rather than on a
   * stop that is not there.
   */
  body: readonly number[];
}

/** A focusable's stable spatial node key ([Q12]) — the same `group:order` the
 *  engine stamps and a surface seeds with. */
function nodeKey(group: string, order: number): string {
  return `${group}:${order}`;
}

/**
 * The Lens's declared arrow plane, built from the sections as currently
 * rendered. Recompute whenever a section folds, gains or loses content, or the
 * stack is reordered — the plane describes what is on screen, not what could be.
 */
export function lensSpatialOrder(
  sections: readonly LensSectionSpatialShape[],
): SpatialOrder {
  const rows: string[][] = [];
  const bodySeams: SpatialSeam[] = [];

  for (const section of sections) {
    const band = nodeKey(section.group, LENS_BAND_FOCUS_ORDER);
    const bandRow = [band];
    if (section.filter) {
      bandRow.push(nodeKey(section.group, LENS_BAND_FILTER_FOCUS_ORDER));
    }
    if (section.actions) {
      bandRow.push(nodeKey(section.group, LENS_BAND_ACTION_FOCUS_ORDER));
    }
    bandRow.push(nodeKey(section.group, LENS_BAND_FOLD_FOCUS_ORDER));
    rows.push(bandRow);

    for (const order of section.body) {
      const node = nodeKey(section.group, order);
      rows.push([node]);
      bodySeams.push({ from: node, direction: "left", to: band });
    }
  }

  const grid = rowGridOrder(rows);
  return {
    rings: grid.rings,
    seams: [...(grid.seams ?? []), ...bodySeams],
  };
}
