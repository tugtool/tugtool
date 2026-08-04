/**
 * keymap-arrow-history — which meaning a vertical arrow carries in the text
 * editor. Pure policy over modifiers plus caret position; no EditorView, no DOM.
 *
 * The behavior this pins is the one the split exists for: a plain arrow is a
 * caret key at every position, so walking the caret to the top of a draft can
 * never overshoot into a history recall.
 */

import { describe, expect, test } from "bun:test";

import { resolveArrowHistory } from "../keymap";

describe("resolveArrowHistory — plain arrows are caret keys", () => {
  test("a plain arrow never recalls history, at a boundary or away from one", () => {
    for (const atBoundary of [true, false]) {
      expect(
        resolveArrowHistory({ altKey: false, metaKey: false, atBoundary }),
      ).toBe("caret");
    }
  });
});

describe("resolveArrowHistory — Cmd keeps its editing function", () => {
  test("away from the edge, Cmd falls through to cursorDocStart / cursorDocEnd", () => {
    expect(
      resolveArrowHistory({ altKey: false, metaKey: true, atBoundary: false }),
    ).toBe("caret");
  });

  test("at the edge it is already a no-op, so it means history", () => {
    expect(
      resolveArrowHistory({ altKey: false, metaKey: true, atBoundary: true }),
    ).toBe("history");
  });
});

describe("resolveArrowHistory — Opt walks history from anywhere", () => {
  test("position-independent, with or without the boundary", () => {
    for (const atBoundary of [true, false]) {
      expect(
        resolveArrowHistory({ altKey: true, metaKey: false, atBoundary }),
      ).toBe("history");
    }
  });

  test("Opt wins when both modifiers are held — it is the unconditional walk", () => {
    expect(
      resolveArrowHistory({ altKey: true, metaKey: true, atBoundary: false }),
    ).toBe("history");
  });
});
