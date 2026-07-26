import { describe, expect, test } from "bun:test";

import {
  IMPOSITION_KINDS,
  clampSlot,
  imposeRect,
  imposeStyle,
  isImpositionKind,
  resolveSpan,
  slotCount,
  slotFraction,
  type ImposerSpan,
  type ImpositionKind,
} from "@/lib/layout-imposer";

/** A 1000×800 canvas with no rail — the simplest span to hand-compute against. */
const FULL: ImposerSpan = { x: 0, width: 1000, height: 800 };
/** The same canvas with a 260px Lens docked left. */
const LEFT_RAIL: ImposerSpan = { x: 260, width: 740, height: 800 };
/** The same canvas with a 260px Lens docked right. */
const RIGHT_RAIL: ImposerSpan = { x: 0, width: 740, height: 800 };

describe("kinds", () => {
  test("slotCount matches the name", () => {
    expect(slotCount("two-up")).toBe(2);
    expect(slotCount("three-up")).toBe(3);
    expect(slotCount("four-up")).toBe(4);
  });

  test("IMPOSITION_KINDS ascends by slot count", () => {
    expect(IMPOSITION_KINDS.map(slotCount)).toEqual([2, 3, 4]);
  });

  test("isImpositionKind narrows only the three kinds", () => {
    for (const kind of IMPOSITION_KINDS) expect(isImpositionKind(kind)).toBe(true);
    for (const bogus of ["five-up", "", "TWO-UP", null, undefined, 2, {}]) {
      expect(isImpositionKind(bogus)).toBe(false);
    }
  });
});

describe("clampSlot", () => {
  test("clamps above the last slot", () => {
    expect(clampSlot("two-up", 3)).toBe(1);
    expect(clampSlot("three-up", 7)).toBe(2);
    expect(clampSlot("four-up", 4)).toBe(3);
  });

  test("clamps below zero", () => {
    expect(clampSlot("three-up", -1)).toBe(0);
    expect(clampSlot("three-up", -1000)).toBe(0);
  });

  test("floors fractional slots and rejects non-finite ones", () => {
    expect(clampSlot("four-up", 2.9)).toBe(2);
    expect(clampSlot("four-up", Number.NaN)).toBe(0);
    expect(clampSlot("four-up", Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("leaves in-range slots alone", () => {
    expect(clampSlot("four-up", 0)).toBe(0);
    expect(clampSlot("four-up", 2)).toBe(2);
  });
});

describe("slotFraction", () => {
  test("endpoints are 0 and 1 for every kind", () => {
    for (const kind of IMPOSITION_KINDS) {
      expect(slotFraction(kind, 0)).toBe(0);
      expect(slotFraction(kind, slotCount(kind) - 1)).toBe(1);
    }
  });

  test("three-up's middle is the span center", () => {
    expect(slotFraction("three-up", 1)).toBe(0.5);
  });

  test("four-up's middles are thirds", () => {
    expect(slotFraction("four-up", 1)).toBeCloseTo(1 / 3, 12);
    expect(slotFraction("four-up", 2)).toBeCloseTo(2 / 3, 12);
  });

  test("out-of-range input clamps before the division", () => {
    expect(slotFraction("two-up", 9)).toBe(1);
  });
});

describe("resolveSpan", () => {
  const canvas = { width: 1000, height: 800 };

  test("no rail spans the whole canvas", () => {
    expect(resolveSpan(canvas, null)).toEqual(FULL);
  });

  test("a left-docked rail insets the span's origin", () => {
    expect(resolveSpan(canvas, { side: "left", width: 260 })).toEqual(LEFT_RAIL);
  });

  test("a right-docked rail insets the span's width only", () => {
    expect(resolveSpan(canvas, { side: "right", width: 260 })).toEqual(RIGHT_RAIL);
  });
});

describe("imposeRect", () => {
  test("two-up pins the edges of the span", () => {
    expect(imposeRect("two-up", 0, 400, FULL).position.x).toBe(0);
    expect(imposeRect("two-up", 1, 400, FULL).position.x).toBe(600);
  });

  test("three-up centers its middle on the span center", () => {
    expect(imposeRect("three-up", 0, 300, FULL).position.x).toBe(0);
    expect(imposeRect("three-up", 1, 300, FULL).position.x).toBe(350);
    expect(imposeRect("three-up", 2, 300, FULL).position.x).toBe(700);
  });

  test("four-up centers its middles on the span thirds", () => {
    // Span 0..900 (width 900 divides evenly by 3), pane width 300.
    const span: ImposerSpan = { x: 0, width: 900, height: 800 };
    expect(imposeRect("four-up", 0, 300, span).position.x).toBe(0);
    expect(imposeRect("four-up", 1, 300, span).position.x).toBe(150); // 300 - 150
    expect(imposeRect("four-up", 2, 300, span).position.x).toBe(450); // 600 - 150
    expect(imposeRect("four-up", 3, 300, span).position.x).toBe(600);
  });

  test("a left-docked rail shifts every slot right by the rail width", () => {
    const bare = imposeRect("three-up", 1, 300, FULL).position.x;
    const railed = imposeRect("three-up", 1, 300, LEFT_RAIL).position.x;
    // Span center moves from 500 to 260 + 370 = 630.
    expect(bare).toBe(350);
    expect(railed).toBe(480);
    expect(imposeRect("three-up", 0, 300, LEFT_RAIL).position.x).toBe(260);
    expect(imposeRect("three-up", 2, 300, LEFT_RAIL).position.x).toBe(700);
  });

  test("a right-docked rail keeps the first slot at zero and pulls the last in", () => {
    expect(imposeRect("three-up", 0, 300, RIGHT_RAIL).position.x).toBe(0);
    expect(imposeRect("three-up", 2, 300, RIGHT_RAIL).position.x).toBe(440);
  });

  test("every slotted rect is full span height, top-aligned", () => {
    for (const kind of IMPOSITION_KINDS) {
      for (let k = 0; k < slotCount(kind); k += 1) {
        const rect = imposeRect(kind, k, 321, LEFT_RAIL);
        expect(rect.position.y).toBe(0);
        expect(rect.size.height).toBe(LEFT_RAIL.height);
      }
    }
  });

  test("width is a pass-through for every kind, slot, and span", () => {
    const widths = [1, 120, 640, 4000];
    for (const kind of IMPOSITION_KINDS) {
      for (let k = 0; k < slotCount(kind); k += 1) {
        for (const span of [FULL, LEFT_RAIL, RIGHT_RAIL]) {
          for (const w of widths) {
            expect(imposeRect(kind, k, w, span).size.width).toBe(w);
          }
        }
      }
    }
  });

  test("panes wider than the span overlap instead of being clamped", () => {
    // Three 500px panes across a 1000px span: 1500px of card in 1000px of room.
    const first = imposeRect("three-up", 0, 500, FULL);
    const middle = imposeRect("three-up", 1, 500, FULL);
    const lastOne = imposeRect("three-up", 2, 500, FULL);
    expect(first.position.x).toBe(0);
    expect(middle.position.x).toBe(250);
    expect(lastOne.position.x).toBe(500);
    // Anchors hold exactly; the middles overlap their neighbours.
    expect(first.position.x + 500).toBeGreaterThan(middle.position.x);
    expect(middle.position.x + 500).toBeGreaterThan(lastOne.position.x);
    expect(lastOne.position.x + 500).toBe(FULL.width);
  });

  test("a pane wider than the whole span overhangs rather than shrinking", () => {
    const rect = imposeRect("two-up", 1, 1400, FULL);
    expect(rect.position.x).toBe(-400);
    expect(rect.size.width).toBe(1400);
  });

  test("out-of-range slots clamp to the last slot", () => {
    expect(imposeRect("two-up", 5, 400, FULL)).toEqual(
      imposeRect("two-up", 1, 400, FULL),
    );
  });
});

describe("imposeStyle", () => {
  test("the first slot pins its left edge to the left inset", () => {
    expect(imposeStyle("three-up", 0, 640, false)).toEqual({
      width: "640px",
      height: "auto",
      top: 0,
      bottom: 0,
      left: "var(--tug-imposer-inset-left, 0px)",
    });
  });

  test("the last slot pins its right edge to the right inset", () => {
    expect(imposeStyle("three-up", 2, 640, false)).toEqual({
      width: "640px",
      height: "auto",
      top: 0,
      bottom: 0,
      right: "var(--tug-imposer-inset-right, 0px)",
    });
  });

  test("a middle slot pins its center with a translate", () => {
    expect(imposeStyle("three-up", 1, 640, false)).toEqual({
      width: "640px",
      height: "auto",
      top: 0,
      bottom: 0,
      left:
        "calc(var(--tug-imposer-inset-left, 0px) + " +
        "(100% - var(--tug-imposer-inset-left, 0px) - var(--tug-imposer-inset-right, 0px)) * 1 / 2)",
      transform: "translateX(-50%)",
    });
  });

  test("four-up's middles carry their own fractions", () => {
    const one = imposeStyle("four-up", 1, 400, false);
    const two = imposeStyle("four-up", 2, 400, false);
    expect(one.left).toContain("* 1 / 3");
    expect(two.left).toContain("* 2 / 3");
    expect(one.transform).toBe("translateX(-50%)");
    expect(two.transform).toBe("translateX(-50%)");
  });

  test("collapsed releases the bottom pin and nothing else", () => {
    const collapsed = imposeStyle("three-up", 1, 640, true);
    expect(collapsed).toEqual({
      width: "640px",
      height: "auto",
      top: 0,
      left:
        "calc(var(--tug-imposer-inset-left, 0px) + " +
        "(100% - var(--tug-imposer-inset-left, 0px) - var(--tug-imposer-inset-right, 0px)) * 1 / 2)",
      transform: "translateX(-50%)",
    });
    expect(collapsed.bottom).toBeUndefined();
  });

  test("edge slots never carry a transform", () => {
    for (const kind of IMPOSITION_KINDS) {
      expect(imposeStyle(kind, 0, 400, false).transform).toBeUndefined();
      expect(
        imposeStyle(kind, slotCount(kind) - 1, 400, false).transform,
      ).toBeUndefined();
    }
  });

  test("two-up has no middle slot, so neither of its slots translates", () => {
    expect(imposeStyle("two-up", 0, 400, false).left).toBe(
      "var(--tug-imposer-inset-left, 0px)",
    );
    expect(imposeStyle("two-up", 1, 400, false).right).toBe(
      "var(--tug-imposer-inset-right, 0px)",
    );
  });

  test("the width is always the pane's own, verbatim", () => {
    for (const kind of IMPOSITION_KINDS) {
      for (let k = 0; k < slotCount(kind); k += 1) {
        expect(imposeStyle(kind, k, 987, false).width).toBe("987px");
      }
    }
  });

  test("only one horizontal pin is ever set", () => {
    for (const kind of IMPOSITION_KINDS) {
      for (let k = 0; k < slotCount(kind); k += 1) {
        const style = imposeStyle(kind, k, 400, false);
        const pins = [style.left, style.right].filter(
          (value) => value !== undefined,
        );
        expect(pins).toHaveLength(1);
      }
    }
  });
});

describe("the CSS and numeric forms agree", () => {
  // The style's calc is what the browser evaluates; this reproduces it by hand
  // against a known span and checks it lands where `imposeRect` says it should.
  function evaluateLeft(
    kind: ImpositionKind,
    slot: number,
    paneWidth: number,
    span: ImposerSpan,
    canvasWidth: number,
  ): number {
    const insetLeft = span.x;
    const insetRight = canvasWidth - span.x - span.width;
    const last = slotCount(kind) - 1;
    if (slot === 0) return insetLeft;
    if (slot === last) return canvasWidth - insetRight - paneWidth;
    const center =
      insetLeft + (canvasWidth - insetLeft - insetRight) * (slot / last);
    return center - paneWidth / 2;
  }

  test("every kind × slot × span matches imposeRect", () => {
    const cases: Array<[ImposerSpan, number]> = [
      [FULL, 1000],
      [LEFT_RAIL, 1000],
      [RIGHT_RAIL, 1000],
    ];
    for (const kind of IMPOSITION_KINDS) {
      for (let k = 0; k < slotCount(kind); k += 1) {
        for (const [span, canvasWidth] of cases) {
          expect(evaluateLeft(kind, k, 300, span, canvasWidth)).toBeCloseTo(
            imposeRect(kind, k, 300, span).position.x,
            9,
          );
        }
      }
    }
  });
});
