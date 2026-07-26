import { describe, expect, test } from "bun:test";

import {
  IMPOSITION_GAP_BOTTOM_PX,
  IMPOSITION_GAP_PX,
  IMPOSITION_KINDS,
  clampSlot,
  imposeRect,
  imposeStyle,
  imposeLensStyle,
  isImpositionKind,
  packFromForRail,
  resolvePlacement,
  resolveSpan,
  slotCount,
  travelFraction,
  type ImposerSpan,
  type ImposedPlacement,
} from "@/lib/layout-imposer";

const GAP = IMPOSITION_GAP_PX;

/** A 1000×800 canvas with no rail — the simplest span to hand-compute against. */
const FULL: ImposerSpan = { x: 0, width: 1000, height: 800 };
/** The same canvas with a 260px Lens holding the left. The inset is the
 *  Lens's width plus one gap, because the Lens is itself imposed a gap off
 *  the canvas edge. */
const LENS_LEFT: ImposerSpan = { x: 265, width: 735, height: 800 };
/** The same canvas with a 260px Lens holding the right. */
const LENS_RIGHT: ImposerSpan = { x: 0, width: 735, height: 800 };

/** Terse placement literal for the geometry cases. */
const at = (
  slot: number,
  packFrom: "left" | "right",
  count: number,
): ImposedPlacement => ({ slot, packFrom, count });

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

describe("gaps", () => {
  test("the horizontal gap is the one the drag snap holds", () => {
    expect(IMPOSITION_GAP_PX).toBe(5);
  });

  test("the bottom gap is deeper, and clears the dev-info strip", () => {
    // The strip sits 8px above the canvas bottom and stands about 19px tall.
    // The bottom gap has to clear that and still leave an ordinary gap of air.
    expect(IMPOSITION_GAP_BOTTOM_PX).toBeGreaterThanOrEqual(8 + 19 + GAP);
    expect(IMPOSITION_GAP_BOTTOM_PX).toBeGreaterThan(IMPOSITION_GAP_PX);
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

describe("packFromForRail", () => {
  test("the chain runs away from the rail", () => {
    expect(packFromForRail("right")).toBe("left");
    expect(packFromForRail("left")).toBe("right");
  });

  test("a closed Lens packs left", () => {
    expect(packFromForRail(null)).toBe("left");
  });
});

describe("resolveSpan", () => {
  const canvas = { width: 1000, height: 800 };

  test("no rail spans the whole canvas", () => {
    expect(resolveSpan(canvas, null)).toEqual(FULL);
  });

  test("a left-side Lens insets the span's origin by its width plus a gap", () => {
    expect(resolveSpan(canvas, { side: "left", width: 260 })).toEqual(LENS_LEFT);
  });

  test("a right-side Lens insets the span's width only", () => {
    expect(resolveSpan(canvas, { side: "right", width: 260 })).toEqual(LENS_RIGHT);
  });
});

describe("resolvePlacement", () => {
  test("the count is the kind's, whatever the deck holds", () => {
    expect(resolvePlacement("two-up", 0, "right").count).toBe(2);
    expect(resolvePlacement("three-up", 0, "right").count).toBe(3);
    expect(resolvePlacement("four-up", 0, "right").count).toBe(4);
  });

  test("the numbering runs away from the Lens", () => {
    expect(resolvePlacement("three-up", 1, "right").packFrom).toBe("left");
    expect(resolvePlacement("three-up", 1, "left").packFrom).toBe("right");
    expect(resolvePlacement("three-up", 1, null).packFrom).toBe("left");
  });

  test("an out-of-range slot clamps to the kind", () => {
    expect(resolvePlacement("two-up", 9, "right").slot).toBe(1);
    expect(resolvePlacement("two-up", -4, "right").slot).toBe(0);
    expect(resolvePlacement("four-up", 2.9, "right").slot).toBe(2);
  });
});

describe("travelFraction", () => {
  test("slot 0 has travelled none of the band", () => {
    expect(travelFraction(at(0, "left", 2))).toBe(0);
    expect(travelFraction(at(0, "left", 4))).toBe(0);
  });

  test("the last slot has travelled all of it — that is why it meets the Lens", () => {
    expect(travelFraction(at(1, "left", 2))).toBe(1);
    expect(travelFraction(at(3, "left", 4))).toBe(1);
  });

  test("the slots in between space evenly", () => {
    expect(travelFraction(at(1, "left", 3))).toBeCloseTo(0.5, 9);
    expect(travelFraction(at(1, "left", 4))).toBeCloseTo(1 / 3, 9);
    expect(travelFraction(at(2, "left", 4))).toBeCloseTo(2 / 3, 9);
  });
});

describe("imposeRect", () => {
  test("slot 0 sits a gap in from the span's near edge", () => {
    expect(imposeRect(at(0, "left", 2), 400, FULL).position.x).toBe(GAP);
    expect(imposeRect(at(0, "left", 4), 400, FULL).position.x).toBe(GAP);
  });

  test("the last slot's far edge lands a gap short of the band's", () => {
    for (const [count, width] of [[2, 400], [3, 300], [4, 220]] as const) {
      const r = imposeRect(at(count - 1, "left", count), width, FULL);
      expect(r.position.x + r.size.width).toBe(FULL.width - GAP);
    }
  });

  test("a slot's place depends on the pane's own width and nothing else", () => {
    // The placement carries no reading of the deck at all — there is no input
    // here for a sibling opening, closing, or resizing to arrive through. This
    // is the property the whole model rests on: a slot is a place in the
    // arrangement, never a place in a queue.
    const slotOne = at(1, "left", 2);
    expect(imposeRect(slotOne, 400, FULL).position.x).toBe(
      imposeRect(resolvePlacement("two-up", 1, "right"), 400, FULL).position.x,
    );
    // Two-up, 990 of band, a 400 card: 590 of travel.
    expect(imposeRect(slotOne, 400, FULL).position.x).toBe(GAP + 590);
  });

  test("slots with room space evenly across the band", () => {
    const xs = [0, 1, 2].map(
      (k) => imposeRect(at(k, "left", 3), 300, FULL).position.x,
    );
    expect(xs).toEqual([5, 350, 695]);
    // Equal air between neighbours, rather than pooled at one end.
    expect(xs[1] - (xs[0] + 300)).toBe(xs[2] - (xs[1] + 300));
  });

  test("a crowded band overlaps instead of running past it", () => {
    // Three 500s in a 990 band: 510 too many, shared over two intervals.
    const rects = [0, 1, 2].map((k) => imposeRect(at(k, "left", 3), 500, FULL));
    expect(rects.map((r) => r.position.x)).toEqual([5, 250, 495]);
    const overlaps = [0, 1].map(
      (i) => rects[i].position.x + rects[i].size.width - rects[i + 1].position.x,
    );
    expect(overlaps).toEqual([255, 255]);
    for (const r of rects) expect(r.size.width).toBe(500);
    const last = rects[2];
    expect(last.position.x + last.size.width).toBe(FULL.width - GAP);
  });

  test("four-up shares the crowding three ways", () => {
    const rects = [0, 1, 2, 3].map((k) => imposeRect(at(k, "left", 4), 500, FULL));
    const overlaps = [0, 1, 2].map(
      (i) => rects[i].position.x + rects[i].size.width - rects[i + 1].position.x,
    );
    // 990 of band, a 500 card: 490 of travel over three intervals.
    for (const o of overlaps) expect(o).toBeCloseTo(500 - 490 / 3, 9);
    const last = rects[3];
    expect(last.position.x + last.size.width).toBeCloseTo(FULL.width - GAP, 9);
  });

  test("an overlapping arrangement never reaches under the Lens", () => {
    const last = imposeRect(at(2, "left", 3), 500, LENS_RIGHT);
    const lensNearEdge = LENS_RIGHT.x + LENS_RIGHT.width;
    expect(last.position.x + last.size.width).toBe(lensNearEdge - GAP);
  });

  test("a left-side Lens numbers from the right, and slot 0 hugs the far edge", () => {
    const a = imposeRect(at(0, "right", 2), 300, LENS_LEFT);
    const b = imposeRect(at(1, "right", 2), 300, LENS_LEFT);
    // Slot 0 sits on the canvas's right edge, a gap in.
    expect(a.position.x + a.size.width).toBe(995);
    // Slot 1 — the last — meets the Lens.
    expect(b.position.x).toBe(LENS_LEFT.x + GAP);
  });

  test("a right-docked Lens leaves slot 0 exactly where a closed one does", () => {
    expect(imposeRect(at(0, "left", 2), 300, LENS_RIGHT).position.x).toBe(
      imposeRect(at(0, "left", 2), 300, FULL).position.x,
    );
  });

  test("a card wider than the band has no travel, so every slot is the far edge", () => {
    for (const k of [0, 1]) {
      const rect = imposeRect(at(k, "left", 2), 1400, FULL);
      expect(rect.position.x).toBe(GAP);
      expect(rect.size.width).toBe(1400);
    }
  });

  test("the run is the span height less the top gap and the deeper bottom", () => {
    const rect = imposeRect(at(0, "left", 2), 321, LENS_LEFT);
    expect(rect.position.y).toBe(IMPOSITION_GAP_PX);
    expect(rect.size.height).toBe(
      LENS_LEFT.height - IMPOSITION_GAP_PX - IMPOSITION_GAP_BOTTOM_PX,
    );
  });

  test("width is a pass-through for every span", () => {
    for (const span of [FULL, LENS_LEFT, LENS_RIGHT]) {
      for (const w of [1, 120, 640, 4000]) {
        expect(imposeRect(at(0, "left", 2), w, span).size.width).toBe(w);
      }
    }
  });
});

describe("imposeStyle", () => {
  const BAND =
    "(100% - var(--tug-imposer-inset-left, 0px)" +
    " - var(--tug-imposer-inset-right, 0px) - 5px * 2)";

  test("a left-numbered pane pins its left edge against the left inset", () => {
    expect(imposeStyle(at(1, "left", 2), 300, false)).toEqual({
      width: "300px",
      height: "auto",
      top: "5px",
      bottom: "32px",
      left:
        "calc(var(--tug-imposer-inset-left, 0px) + 5px + " +
        `1 * max(0px, ${BAND} - 300px))`,
    });
  });

  test("a right-numbered pane still pins with `left`, measured from 100%", () => {
    const style = imposeStyle(at(1, "right", 2), 400, false);
    expect(style.right).toBeUndefined();
    expect(style.left).toBe(
      "calc(100% - var(--tug-imposer-inset-right, 0px) - 5px - 400px - " +
        `1 * max(0px, ${BAND} - 400px))`,
    );
  });

  test("slot 0 has travelled nothing, so it carries no max() at all", () => {
    const style = imposeStyle(at(0, "left", 3), 400, false);
    expect(style.left).toBe("calc(var(--tug-imposer-inset-left, 0px) + 5px + 0px)");
    expect(style.left).not.toContain("max(");
  });

  test("every pane pins with `left` alone — never `right`, never a transform", () => {
    // One property carries the whole horizontal position on both sides, which
    // is what lets a frame TRANSITION between two arrangements instead of
    // cutting between them.
    for (const packFrom of ["left", "right"] as const) {
      for (const slot of [0, 1]) {
        const style = imposeStyle(at(slot, packFrom, 2), 300, false);
        expect(style.transform).toBeUndefined();
        expect(style.right).toBeUndefined();
        expect(typeof style.left).toBe("string");
      }
    }
  });

  test("collapsed releases the bottom pin and nothing else", () => {
    const collapsed = imposeStyle(at(0, "left", 2), 640, true);
    expect(collapsed).toEqual({
      width: "640px",
      height: "auto",
      top: "5px",
      left: "calc(var(--tug-imposer-inset-left, 0px) + 5px + 0px)",
    });
    expect(collapsed.bottom).toBeUndefined();
  });

  test("the width is always the pane's own, verbatim", () => {
    expect(imposeStyle(at(0, "left", 2), 987, false).width).toBe("987px");
  });
});

describe("imposeLensStyle", () => {
  test("pins the Lens to its side, a gap in on three edges and deeper below", () => {
    expect(imposeLensStyle("left", 420, false)).toEqual({
      width: "420px",
      height: "auto",
      top: "5px",
      left: "5px",
      bottom: "32px",
    });
    expect(imposeLensStyle("right", 420, false)).toEqual({
      width: "420px",
      height: "auto",
      top: "5px",
      left: "calc(100% - 420px - 5px)",
      bottom: "32px",
    });
  });

  test("both sides pin with `left`, so the flip is one property's value", () => {
    for (const side of ["left", "right"] as const) {
      const style = imposeLensStyle(side, 420, false);
      expect(style.right).toBeUndefined();
      expect(typeof style.left).toBe("string");
    }
  });

  test("a collapsed Lens keeps its side and top pins and releases the bottom", () => {
    const collapsed = imposeLensStyle("right", 420, true);
    expect(collapsed.top).toBe("5px");
    expect(collapsed.left).toBe("calc(100% - 420px - 5px)");
    expect(collapsed.bottom).toBeUndefined();
  });

  test("the width is the pane's own, verbatim", () => {
    expect(imposeLensStyle("left", 987, false).width).toBe("987px");
  });
});

describe("the arrangement clears the Lens by exactly one gap", () => {
  // The derivation the pinned-Lens geometry rests on: with the Lens on the
  // right at width W, its near edge sits at `canvasW - GAP - W`, and the last
  // slot's card must land one gap short of that.
  const CANVAS = { width: 1000, height: 800 };

  for (const W of [260, 420, 500]) {
    test(`a ${W}px right-side Lens leaves the last slot one gap off it`, () => {
      const span = resolveSpan(CANVAS, { side: "right", width: W });
      const rect = imposeRect(at(1, "left", 2), 240, span);
      expect(rect.position.x + rect.size.width).toBe(CANVAS.width - GAP - W - GAP);
      expect(imposeRect(at(0, "left", 2), 240, span).position.x).toBe(GAP);
    });

    test(`a ${W}px left-side Lens leaves the last slot one gap off it`, () => {
      const span = resolveSpan(CANVAS, { side: "left", width: W });
      const rect = imposeRect(at(1, "right", 2), 240, span);
      expect(rect.position.x).toBe(GAP + W + GAP);
      expect(
        imposeRect(at(0, "right", 2), 240, span).position.x + 240,
      ).toBe(CANVAS.width - GAP);
    });
  }
});

describe("the CSS and numeric forms agree", () => {
  // The style's calc is what the browser evaluates. This reproduces it by hand
  // — including the `max()` that pins an over-wide pane to the far edge — and
  // checks it lands where `imposeRect` says it should.
  function evaluatePin(
    placement: ImposedPlacement,
    paneWidth: number,
    span: ImposerSpan,
    canvasWidth: number,
  ): number {
    const insetLeft = span.x;
    const insetRight = canvasWidth - span.x - span.width;
    const band = canvasWidth - insetLeft - insetRight - GAP * 2;
    const offset = travelFraction(placement) * Math.max(0, band - paneWidth);
    if (placement.packFrom === "left") return insetLeft + GAP + offset;
    return canvasWidth - insetRight - GAP - paneWidth - offset;
  }

  const CASES: Array<[ImposerSpan, number, "left" | "right" | null]> = [
    [FULL, 1000, null],
    [LENS_RIGHT, 1000, "right"],
    [LENS_LEFT, 1000, "left"],
  ];

  for (const [name, widths] of [
    ["an arrangement with room", [300, 220, 260]],
    ["a crowded arrangement", [500, 500, 500]],
  ] as const) {
    test(`${name} matches imposeRect everywhere`, () => {
      for (const [span, canvasWidth, lensSide] of CASES) {
        widths.forEach((width, slot) => {
          const placement = resolvePlacement("three-up", slot, lensSide);
          expect(evaluatePin(placement, width, span, canvasWidth)).toBeCloseTo(
            imposeRect(placement, width, span).position.x,
            9,
          );
        });
      }
    });
  }
});
