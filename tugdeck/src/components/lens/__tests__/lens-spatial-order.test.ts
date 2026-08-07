/**
 * lens-spatial-order.test.ts — the Lens's arrow plane, resolved.
 *
 * The builder is pure and so is the resolver, so the two compose into a
 * readable statement of what each arrow does from each stop — which is the
 * whole claim the feature makes, and the one a DOM test can only sample.
 *
 * The inputs here are the shape the ENGINE hands the builder: a section's group
 * and the focus orders registered in it. That is the drift gate as much as the
 * behavior gate — the last block below is the one that says a control nobody
 * told the plane about is on it anyway, purely by having registered.
 */

import { describe, expect, test } from "bun:test";

import { resolveSpatial } from "@/components/tugways/spatial-order";
import type { SpatialDirection } from "@/components/tugways/spatial-order";
import {
  lensSpatialOrder,
  type LensSectionSpatialShape,
} from "../lens-spatial-order";

const CARDS = "lens-section-cards";
const LAYOUTS = "lens-section-layouts";

const BAND = -2;
const FILTER = -1;
const ACTION = -0.75;
const FOLD = -0.5;

function key(group: string, order: number): string {
  return `${group}:${order}`;
}

/** Two sections, both expanded and filterable, the second also carrying a
 *  header control — the everyday Lens, as its registrations describe it. */
function twoSections(): LensSectionSpatialShape[] {
  return [
    { group: CARDS, orders: [BAND, FILTER, FOLD, 0] },
    { group: LAYOUTS, orders: [BAND, FILTER, ACTION, FOLD, 0] },
  ];
}

/**
 * Where an arrow goes from `node`, as a node key — or the resolution kind when
 * it does not move the ring (`cursor` while a group ropes it internally,
 * `none` when nothing claims it and the liveliness net takes over).
 *
 * `cursor` names a live group at `node`: its length and the position the cursor
 * is sitting at. The builder declares no groups — the navigator injects the
 * ringed node's own handle at resolve time ([P22]) — so a test that wants to
 * see the cursor interact with the plane has to inject it the same way, which
 * is what this does.
 */
function arrow(
  shapes: readonly LensSectionSpatialShape[],
  node: string,
  direction: SpatialDirection,
  cursor: { at: number; length: number; columns?: number } | null = null,
): string {
  const built = lensSpatialOrder(shapes);
  const order =
    cursor === null
      ? built
      : {
          ...built,
          groups: [{ node, length: cursor.length, columns: cursor.columns ?? 1 }],
        };
  const resolved = resolveSpatial(order, node, direction, cursor?.at ?? null);
  return resolved.kind === "ring" ? resolved.target : resolved.kind;
}

describe("lensSpatialOrder — vertical arrows move down the column", () => {
  test("Down on a band lands on that section's own body, not on its controls", () => {
    // The bug this whole plane exists to fix: under the linear net, Down on a
    // band stepped RIGHT into the filter field beside it.
    expect(arrow(twoSections(), key(CARDS, BAND), "down")).toBe(key(CARDS, 0));
  });

  test("every stop on a band drops into the same body", () => {
    const shapes = twoSections();
    for (const order of [BAND, FILTER, FOLD]) {
      expect(arrow(shapes, key(CARDS, order), "down")).toBe(key(CARDS, 0));
    }
  });

  test("Down off the end of a body crosses into the next section's band", () => {
    // The body is a group node, so an interior step is the cursor's and only
    // the edge falls through to the seam. A three-row list, mid-list…
    const shapes = twoSections();
    const list = { length: 3 };
    expect(arrow(shapes, key(CARDS, 0), "down", { at: 1, ...list })).toBe("cursor");
    // …and at its last row.
    expect(arrow(shapes, key(CARDS, 0), "down", { at: 2, ...list })).toBe(
      key(LAYOUTS, BAND),
    );
  });

  test("Up off the top of a body returns to its own band", () => {
    expect(arrow(twoSections(), key(LAYOUTS, 0), "up")).toBe(key(LAYOUTS, BAND));
  });

  test("Up on a band reaches the previous section's body", () => {
    expect(arrow(twoSections(), key(LAYOUTS, BAND), "up")).toBe(key(CARDS, 0));
  });

  test("the column closes into a ring — Down off the last body wraps to the top", () => {
    expect(arrow(twoSections(), key(LAYOUTS, 0), "down")).toBe(key(CARDS, BAND));
  });
});

describe("lensSpatialOrder — horizontal arrows run along a band", () => {
  test("Right walks the band in the order it reads", () => {
    const shapes = twoSections();
    expect(arrow(shapes, key(LAYOUTS, BAND), "right")).toBe(key(LAYOUTS, FILTER));
    expect(arrow(shapes, key(LAYOUTS, FILTER), "right")).toBe(key(LAYOUTS, ACTION));
    expect(arrow(shapes, key(LAYOUTS, ACTION), "right")).toBe(key(LAYOUTS, FOLD));
  });

  test("Left retraces it, and the band's ends wrap rather than dead-end", () => {
    const shapes = twoSections();
    expect(arrow(shapes, key(LAYOUTS, FOLD), "left")).toBe(key(LAYOUTS, ACTION));
    expect(arrow(shapes, key(LAYOUTS, BAND), "left")).toBe(key(LAYOUTS, FOLD));
    expect(arrow(shapes, key(LAYOUTS, FOLD), "right")).toBe(key(LAYOUTS, BAND));
  });

  test("a band holds only the controls that registered on it", () => {
    // Cards has no header controls, so Right off its filter is the fold cue.
    expect(arrow(twoSections(), key(CARDS, FILTER), "right")).toBe(key(CARDS, FOLD));
  });

  test("Left off a body stop returns to its band — as a SEAM, so a cursor wins first", () => {
    const shapes = twoSections();
    // With no cursor claim (a vertical-axis list declines horizontal arrows,
    // and the navigator withholds the index) the seam fires.
    expect(arrow(shapes, key(CARDS, 0), "left")).toBe(key(CARDS, BAND));
    // With a cursor claim (a horizontal group — the Layouts tiles) the group's
    // own step is resolved first and the seam is never consulted.
    expect(
      arrow(shapes, key(CARDS, 0), "left", { at: 1, length: 4, columns: 2 }),
    ).toBe("cursor");
  });
});

describe("lensSpatialOrder — the plane describes what is on screen", () => {
  test("a collapsed section registers only its band, so Down skips its body", () => {
    // Collapsed: no body, no filter field — the band and its fold cue are all
    // that is left, which is what the engine reports.
    const shapes: LensSectionSpatialShape[] = [
      { group: CARDS, orders: [BAND, FOLD] },
      { group: LAYOUTS, orders: [BAND, FILTER, ACTION, FOLD, 0] },
    ];
    expect(arrow(shapes, key(CARDS, BAND), "down")).toBe(key(LAYOUTS, BAND));
    expect(arrow(shapes, key(CARDS, FOLD), "down")).toBe(key(LAYOUTS, BAND));
    // And back: Up on the next band reaches the folded band, not a body that
    // is not rendered.
    expect(arrow(shapes, key(LAYOUTS, BAND), "up")).toBe(key(CARDS, BAND));
  });

  test("one section alone still names both directions on its band", () => {
    const shapes: LensSectionSpatialShape[] = [
      { group: CARDS, orders: [BAND, FILTER, FOLD, 0] },
    ];
    expect(arrow(shapes, key(CARDS, BAND), "down")).toBe(key(CARDS, 0));
    expect(arrow(shapes, key(CARDS, 0), "down")).toBe(key(CARDS, BAND));
  });

  test("a section that has registered nothing contributes no row", () => {
    // One folded section and one that has not mounted: a single row between
    // them, so there is no vertical move to declare and both arrows resolve to
    // nothing — which hands them to the liveliness net rather than to a node
    // that is not there. The plane never invents a destination.
    const shapes: LensSectionSpatialShape[] = [
      { group: CARDS, orders: [BAND, FOLD] },
      { group: LAYOUTS, orders: [] },
    ];
    expect(arrow(shapes, key(CARDS, BAND), "down")).toBe("none");
    expect(arrow(shapes, key(LAYOUTS, BAND), "down")).toBe("none");
    // The one row it does have is still a row: Right runs it.
    expect(arrow(shapes, key(CARDS, BAND), "right")).toBe(key(CARDS, FOLD));
  });
});

describe("lensSpatialOrder — new controls join the plane by registering", () => {
  // The drift gate. Nothing in the Lens declares which controls are on which
  // row; the rows are derived from the orders the engine reports, split at
  // zero — negative is the band, non-negative is the body. So the question
  // these answer is: does a control nobody told the plane about work anyway?

  test("a second band control lands in the band's row, in its own place", () => {
    const shapes: LensSectionSpatialShape[] = [
      // A new control at -0.9, authored between the filter and the existing one.
      { group: CARDS, orders: [BAND, FILTER, -0.9, ACTION, FOLD, 0] },
    ];
    expect(arrow(shapes, key(CARDS, FILTER), "right")).toBe(key(CARDS, -0.9));
    expect(arrow(shapes, key(CARDS, -0.9), "right")).toBe(key(CARDS, ACTION));
    expect(arrow(shapes, key(CARDS, -0.9), "left")).toBe(key(CARDS, FILTER));
    // …and it drops into the body like every other stop on the band.
    expect(arrow(shapes, key(CARDS, -0.9), "down")).toBe(key(CARDS, 0));
  });

  test("a second body control becomes a second row, reachable by Down", () => {
    // The Layouts section's shape: two stacked radio groups.
    const shapes: LensSectionSpatialShape[] = [
      { group: CARDS, orders: [BAND, FILTER, FOLD, 0] },
      { group: LAYOUTS, orders: [BAND, FOLD, 0, 1] },
    ];
    expect(arrow(shapes, key(LAYOUTS, BAND), "down")).toBe(key(LAYOUTS, 0));
    expect(arrow(shapes, key(LAYOUTS, 0), "down")).toBe(key(LAYOUTS, 1));
    expect(arrow(shapes, key(LAYOUTS, 1), "up")).toBe(key(LAYOUTS, 0));
    // Each body row's Left goes to the section's band, not to the row above it.
    expect(arrow(shapes, key(LAYOUTS, 1), "left")).toBe(key(LAYOUTS, BAND));
    // And the last body row is what the next section's Up reaches — a new
    // control at the bottom of a body does not get skipped on the way back.
    expect(arrow(shapes, key(CARDS, BAND), "up")).toBe(key(LAYOUTS, 1));
  });

  test("a whole new section joins the column with no edit anywhere", () => {
    const shapes: LensSectionSpatialShape[] = [
      { group: CARDS, orders: [BAND, FILTER, FOLD, 0] },
      { group: "lens-section-brand-new", orders: [BAND, FOLD, 0] },
      { group: LAYOUTS, orders: [BAND, FOLD, 0] },
    ];
    expect(arrow(shapes, key(CARDS, 0), "down")).toBe(
      key("lens-section-brand-new", BAND),
    );
    expect(arrow(shapes, key("lens-section-brand-new", BAND), "down")).toBe(
      key("lens-section-brand-new", 0),
    );
    expect(arrow(shapes, key("lens-section-brand-new", 0), "down")).toBe(
      key(LAYOUTS, BAND),
    );
  });

  test("orders arrive in whatever sequence, and the rows still read left to right", () => {
    // `focusOrdersInGroup` sorts, but the builder does not depend on that —
    // an unsorted list must not silently produce a scrambled band.
    const scrambled: LensSectionSpatialShape[] = [
      { group: CARDS, orders: [0, FOLD, BAND, ACTION, FILTER] },
    ];
    expect(arrow(scrambled, key(CARDS, BAND), "right")).toBe(key(CARDS, FILTER));
    expect(arrow(scrambled, key(CARDS, FILTER), "right")).toBe(key(CARDS, ACTION));
    expect(arrow(scrambled, key(CARDS, BAND), "down")).toBe(key(CARDS, 0));
  });
});
