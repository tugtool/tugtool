/**
 * resize-episode arithmetic — the math that keeps a scroller's content still
 * while its card changes width.
 *
 * Pure functions over plain readings. The DOM half of the module (event
 * dispatch, claim-vs-fallback selection, the ResizeObserver watch, the safety
 * net) is real-app behavior and is proven in the app-test that drives actual
 * width gestures, not here — there is no DOM substrate under `bun test`.
 */

import { describe, expect, test } from "bun:test";

import {
  chooseAnchor,
  isAtBottom,
  maxScrollTop,
  resolveAnchoredScrollTop,
  type GenericAnchor,
  type ScrollReading,
} from "../lib/resize-episode";

const reading = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight = 500,
): ScrollReading => ({ scrollTop, scrollHeight, clientHeight });

describe("bottom detection", () => {
  test("exact bottom and within a pixel of it both count", () => {
    expect(isAtBottom(reading(500, 1000))).toBe(true);
    expect(isAtBottom(reading(499.5, 1000))).toBe(true);
    expect(isAtBottom(reading(400, 1000))).toBe(false);
  });

  test("content shorter than the viewport is always at the bottom", () => {
    expect(isAtBottom(reading(0, 200))).toBe(true);
    expect(maxScrollTop(reading(0, 200))).toBe(0);
  });
});

describe("choosing an anchor", () => {
  test("resting at the top holds the top", () => {
    expect(chooseAnchor(reading(0, 5000), { elementDelta: -20 })).toEqual({
      kind: "top",
    });
  });

  test("resting at the bottom holds the bottom", () => {
    expect(chooseAnchor(reading(500, 1000), { elementDelta: -20 })).toEqual({
      kind: "bottom",
    });
  });

  test("mid-content holds the measured element delta", () => {
    expect(chooseAnchor(reading(1200, 5000), { elementDelta: -18 })).toEqual({
      kind: "element",
      delta: -18,
    });
  });

  test("mid-content with no anchor element holds still", () => {
    // NOT `top`. "We could not find your place" answered by jumping to the
    // beginning of the document is strictly worse than the drift this module
    // exists to prevent — so the no-anchor case names itself and writes
    // nothing.
    expect(chooseAnchor(reading(1200, 5000), {})).toEqual({ kind: "keep" });
    expect(
      resolveAnchoredScrollTop({ kind: "keep" }, reading(1200, 5000)),
    ).toBeNull();
  });

  test("fraction mode wins over position", () => {
    expect(
      chooseAnchor(reading(1125, 5000), { fractionMode: true }),
    ).toEqual({ kind: "fraction", fraction: 0.25 });
  });

  test("fraction of an unscrollable reading is zero, not NaN", () => {
    expect(chooseAnchor(reading(0, 200), { fractionMode: true })).toEqual({
      kind: "fraction",
      fraction: 0,
    });
  });
});

describe("resolving an element anchor after a reflow", () => {
  test("content re-wrapping above the viewport moves the anchor back under it", () => {
    // Captured with the anchor row 18px above the viewport top. The card
    // narrowed, rows above re-wrapped taller, and the row is now 260px above:
    // scroll down by the difference to put it back where it was.
    const anchor: GenericAnchor = { kind: "element", delta: -18 };
    const next = resolveAnchoredScrollTop(anchor, reading(1200, 8000), -260);
    expect(next).toBe(1200 + (-260 - -18));
    expect(next).toBe(958);
  });

  test("content re-wrapping shorter pulls the anchor the other way", () => {
    const anchor: GenericAnchor = { kind: "element", delta: -18 };
    // The card widened; rows above re-wrapped shorter and the anchor slid down.
    expect(resolveAnchoredScrollTop(anchor, reading(1200, 4000), 90)).toBe(
      1200 + (90 - -18),
    );
  });

  test("an anchor that has not moved writes nothing", () => {
    const anchor: GenericAnchor = { kind: "element", delta: -18 };
    expect(resolveAnchoredScrollTop(anchor, reading(1200, 8000), -18)).toBeNull();
  });

  test("a vanished anchor element writes nothing", () => {
    const anchor: GenericAnchor = { kind: "element", delta: -18 };
    expect(
      resolveAnchoredScrollTop(anchor, reading(1200, 8000), undefined),
    ).toBeNull();
  });

  test("the correction is clamped to the scrollable range", () => {
    const anchor: GenericAnchor = { kind: "element", delta: -18 };
    // A correction that would scroll past the end lands at the end, not beyond.
    expect(resolveAnchoredScrollTop(anchor, reading(1200, 1600), 9_000)).toBe(
      maxScrollTop(reading(1200, 1600)),
    );
    // And one that would scroll above the start lands at the start.
    expect(resolveAnchoredScrollTop(anchor, reading(100, 8000), -9_000)).toBe(0);
  });

  test("an implausible correction is a teleport, not a reflow — ignored", () => {
    const anchor: GenericAnchor = { kind: "element", delta: 0 };
    expect(
      resolveAnchoredScrollTop(anchor, reading(1200, 10_000_000), 500_000),
    ).toBeNull();
  });
});

describe("resolving the edge anchors", () => {
  test("a bottom anchor re-pins to the new bottom after the content grows", () => {
    const anchor: GenericAnchor = { kind: "bottom" };
    expect(resolveAnchoredScrollTop(anchor, reading(500, 3000))).toBe(2500);
  });

  test("a bottom anchor already at the bottom writes nothing", () => {
    const anchor: GenericAnchor = { kind: "bottom" };
    expect(resolveAnchoredScrollTop(anchor, reading(2500, 3000))).toBeNull();
  });

  test("a top anchor pulls a drifted scroller back to zero", () => {
    const anchor: GenericAnchor = { kind: "top" };
    expect(resolveAnchoredScrollTop(anchor, reading(40, 3000))).toBe(0);
    expect(resolveAnchoredScrollTop(anchor, reading(0, 3000))).toBeNull();
  });
});

describe("fraction anchors round-trip", () => {
  test("the same fraction lands at the same relative place after content scales", () => {
    const before = reading(1125, 5000);
    const anchor = chooseAnchor(before, { fractionMode: true });
    // The image re-fit to a narrower card: half the content height.
    const after = reading(1125, 2500);
    const next = resolveAnchoredScrollTop(anchor, after);
    expect(next).not.toBeNull();
    expect(next! / maxScrollTop(after)).toBeCloseTo(0.25, 10);
  });

  test("a fraction anchor cannot resolve past the end", () => {
    const anchor: GenericAnchor = { kind: "fraction", fraction: 1 };
    expect(resolveAnchoredScrollTop(anchor, reading(0, 900))).toBe(400);
  });
});
