/**
 * lens-spatial-order.test.ts — the Lens's arrow plane, resolved.
 *
 * The builder is pure and so is the resolver, so the two compose into a
 * readable statement of what each arrow does from each stop — which is the
 * whole claim the feature makes, and the one a DOM test can only sample.
 */

import { describe, expect, test } from "bun:test";

import { resolveSpatial } from "@/components/tugways/spatial-order";
import type { SpatialDirection } from "@/components/tugways/spatial-order";
import {
  lensSpatialOrder,
  type LensSectionSpatialShape,
} from "../lens-spatial-order";

const CARDS = "lens-section-cards";
const SNIPPETS = "lens-section-snippets";

const BAND = -2;
const FILTER = -1;
const ACTION = -0.75;
const FOLD = -0.5;

function key(group: string, order: number): string {
  return `${group}:${order}`;
}

/** Two sections, both expanded and filterable, the second also contributing a
 *  header control — the everyday Lens. */
function twoSections(): LensSectionSpatialShape[] {
  return [
    { group: CARDS, filter: true, actions: false, body: [0] },
    { group: SNIPPETS, filter: true, actions: true, body: [0] },
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
      key(SNIPPETS, BAND),
    );
  });

  test("Up off the top of a body returns to its own band", () => {
    expect(arrow(twoSections(), key(SNIPPETS, 0), "up")).toBe(key(SNIPPETS, BAND));
  });

  test("Up on a band reaches the previous section's body", () => {
    expect(arrow(twoSections(), key(SNIPPETS, BAND), "up")).toBe(key(CARDS, 0));
  });

  test("the column closes into a ring — Down off the last body wraps to the top", () => {
    expect(arrow(twoSections(), key(SNIPPETS, 0), "down")).toBe(key(CARDS, BAND));
  });
});

describe("lensSpatialOrder — horizontal arrows run along a band", () => {
  test("Right walks the band in the order it reads", () => {
    const shapes = twoSections();
    expect(arrow(shapes, key(SNIPPETS, BAND), "right")).toBe(key(SNIPPETS, FILTER));
    expect(arrow(shapes, key(SNIPPETS, FILTER), "right")).toBe(key(SNIPPETS, ACTION));
    expect(arrow(shapes, key(SNIPPETS, ACTION), "right")).toBe(key(SNIPPETS, FOLD));
  });

  test("Left retraces it, and the band's ends wrap rather than dead-end", () => {
    const shapes = twoSections();
    expect(arrow(shapes, key(SNIPPETS, FOLD), "left")).toBe(key(SNIPPETS, ACTION));
    expect(arrow(shapes, key(SNIPPETS, BAND), "left")).toBe(key(SNIPPETS, FOLD));
    expect(arrow(shapes, key(SNIPPETS, FOLD), "right")).toBe(key(SNIPPETS, BAND));
  });

  test("a band declares only the controls it is carrying", () => {
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
  test("a collapsed section contributes only its band, so Down skips its body", () => {
    const shapes: LensSectionSpatialShape[] = [
      { group: CARDS, filter: false, actions: false, body: [] },
      { group: SNIPPETS, filter: true, actions: true, body: [0] },
    ];
    expect(arrow(shapes, key(CARDS, BAND), "down")).toBe(key(SNIPPETS, BAND));
    expect(arrow(shapes, key(CARDS, FOLD), "down")).toBe(key(SNIPPETS, BAND));
    // And back: Up on the next band reaches the folded band, not a body that
    // is not rendered.
    expect(arrow(shapes, key(SNIPPETS, BAND), "up")).toBe(key(CARDS, BAND));
  });

  test("a body that stacks two controls is two rows, and the second is reachable", () => {
    const shapes: LensSectionSpatialShape[] = [
      { group: CARDS, filter: true, actions: false, body: [0] },
      { group: SNIPPETS, filter: false, actions: false, body: [0, 1] },
    ];
    expect(arrow(shapes, key(SNIPPETS, BAND), "down")).toBe(key(SNIPPETS, 0));
    expect(arrow(shapes, key(SNIPPETS, 0), "down")).toBe(key(SNIPPETS, 1));
    expect(arrow(shapes, key(SNIPPETS, 1), "up")).toBe(key(SNIPPETS, 0));
    // Each body row's Left goes to the section's band, not to the row above it.
    expect(arrow(shapes, key(SNIPPETS, 1), "left")).toBe(key(SNIPPETS, BAND));
  });

  test("one section alone still names both directions on its band", () => {
    const shapes: LensSectionSpatialShape[] = [
      { group: CARDS, filter: true, actions: false, body: [0] },
    ];
    expect(arrow(shapes, key(CARDS, BAND), "down")).toBe(key(CARDS, 0));
    expect(arrow(shapes, key(CARDS, 0), "down")).toBe(key(CARDS, BAND));
  });
});
