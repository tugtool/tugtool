import { describe, expect, test } from "bun:test";

import {
  IMPOSITION_GAP_BOTTOM_PX,
  IMPOSITION_GAP_PX,
  IMPOSITION_KINDS,
  clampSlot,
  allocateLensWidth,
  solveLensWidth,
  LENS_FLEX_GROW_FRACTION,
  LENS_FLEX_SHRINK_FRACTION,
  imposeRect,
  imposeStyle,
  imposeLensStyle,
  isImpositionKind,
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
const at = (slot: number, count: number): ImposedPlacement => ({ slot, count });

describe("kinds", () => {
  test("slotCount matches the name", () => {
    expect(slotCount("one-up")).toBe(1);
    expect(slotCount("two-up")).toBe(2);
    expect(slotCount("three-up")).toBe(3);
    expect(slotCount("four-up")).toBe(4);
    expect(slotCount("five-up")).toBe(5);
    expect(slotCount("six-up")).toBe(6);
  });

  test("IMPOSITION_KINDS ascends by slot count", () => {
    expect(IMPOSITION_KINDS.map(slotCount)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("isImpositionKind narrows only the kinds offered", () => {
    for (const kind of IMPOSITION_KINDS) expect(isImpositionKind(kind)).toBe(true);
    for (const bogus of ["seven-up", "", "TWO-UP", null, undefined, 2, {}]) {
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
    expect(clampSlot("six-up", 9)).toBe(5);
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
    expect(resolvePlacement("two-up", 0).count).toBe(2);
    expect(resolvePlacement("three-up", 0).count).toBe(3);
    expect(resolvePlacement("four-up", 0).count).toBe(4);
  });

  test("a placement is the slot and the count, and nothing about the Lens", () => {
    expect(resolvePlacement("three-up", 1)).toEqual({ slot: 1, count: 3 });
  });

  test("an out-of-range slot clamps to the kind", () => {
    expect(resolvePlacement("two-up", 9).slot).toBe(1);
    expect(resolvePlacement("two-up", -4).slot).toBe(0);
    expect(resolvePlacement("four-up", 2.9).slot).toBe(2);
  });
});

describe("travelFraction", () => {
  test("slot 0 has travelled none of the band", () => {
    expect(travelFraction(at(0, 2))).toBe(0);
    expect(travelFraction(at(0, 4))).toBe(0);
  });

  test("the last slot has travelled all of it — that is why it meets the Lens", () => {
    expect(travelFraction(at(1, 2))).toBe(1);
    expect(travelFraction(at(3, 4))).toBe(1);
  });

  test("one-up's single slot takes half the travel — the card centers", () => {
    expect(travelFraction(at(0, 1))).toBe(0.5);
    expect(resolvePlacement("one-up", 3)).toEqual({ slot: 0, count: 1 });
  });

  test("the slots in between space evenly", () => {
    expect(travelFraction(at(1, 3))).toBeCloseTo(0.5, 9);
    expect(travelFraction(at(1, 4))).toBeCloseTo(1 / 3, 9);
    expect(travelFraction(at(2, 4))).toBeCloseTo(2 / 3, 9);
  });
});

describe("imposeRect", () => {
  test("slot 0 sits a gap in from the span's near edge", () => {
    expect(imposeRect(at(0, 2), 400, FULL).position.x).toBe(GAP);
    expect(imposeRect(at(0, 4), 400, FULL).position.x).toBe(GAP);
  });

  test("the last slot's far edge lands a gap short of the band's", () => {
    for (const [count, width] of [[2, 400], [3, 300], [4, 220]] as const) {
      const r = imposeRect(at(count - 1, count), width, FULL);
      expect(r.position.x + r.size.width).toBe(FULL.width - GAP);
    }
  });

  test("a slot's place depends on the pane's own width and nothing else", () => {
    // The placement carries no reading of the deck at all — there is no input
    // here for a sibling opening, closing, or resizing to arrive through. This
    // is the property the whole model rests on: a slot is a place in the
    // arrangement, never a place in a queue.
    const slotOne = at(1, 2);
    expect(imposeRect(slotOne, 400, FULL).position.x).toBe(
      imposeRect(resolvePlacement("two-up", 1), 400, FULL).position.x,
    );
    // Two-up, 990 of band, a 400 card: 590 of travel.
    expect(imposeRect(slotOne, 400, FULL).position.x).toBe(GAP + 590);
  });

  test("one-up centers the card, with the slack split evenly", () => {
    // 990 of band, a 400 card: 590 of travel, half of it on each side.
    const r = imposeRect(resolvePlacement("one-up", 0), 400, FULL);
    expect(r.position.x).toBe(GAP + 295);
    expect(r.position.x - GAP).toBe(FULL.width - GAP - (r.position.x + r.size.width));
  });

  test("slots with room space evenly across the band", () => {
    const xs = [0, 1, 2].map(
      (k) => imposeRect(at(k, 3), 300, FULL).position.x,
    );
    expect(xs).toEqual([5, 350, 695]);
    // Equal air between neighbours, rather than pooled at one end.
    expect(xs[1] - (xs[0] + 300)).toBe(xs[2] - (xs[1] + 300));
  });

  test("a crowded band overlaps instead of running past it", () => {
    // Three 500s in a 990 band: 510 too many, shared over two intervals.
    const rects = [0, 1, 2].map((k) => imposeRect(at(k, 3), 500, FULL));
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
    const rects = [0, 1, 2, 3].map((k) => imposeRect(at(k, 4), 500, FULL));
    const overlaps = [0, 1, 2].map(
      (i) => rects[i].position.x + rects[i].size.width - rects[i + 1].position.x,
    );
    // 990 of band, a 500 card: 490 of travel over three intervals.
    for (const o of overlaps) expect(o).toBeCloseTo(500 - 490 / 3, 9);
    const last = rects[3];
    expect(last.position.x + last.size.width).toBeCloseTo(FULL.width - GAP, 9);
  });

  // A kind is a slot COUNT and nothing else — one rule places all of them — so
  // an arrangement added to the picker needs no geometry of its own. This runs
  // over whatever the imposer currently offers, so the day a seven-up appears
  // it is held to the same two ends.
  test("every kind's chain runs the band end to end", () => {
    for (const kind of IMPOSITION_KINDS) {
      const n = slotCount(kind);
      // One-up is the documented exception: its single anchor has no ends to
      // space against, so it takes half the travel and stands centered.
      if (n === 1) continue;
      const width = (FULL.width - GAP * 2) / n;
      const rects = Array.from({ length: n }, (_, k) =>
        imposeRect(resolvePlacement(kind, k), width, FULL),
      );
      expect(rects[0].position.x).toBe(GAP);
      const last = rects[n - 1];
      expect(last.position.x + last.size.width).toBeCloseTo(FULL.width - GAP, 9);
    }
  });

  test("an overlapping arrangement never reaches under the Lens", () => {
    const last = imposeRect(at(2, 3), 500, LENS_RIGHT);
    const lensNearEdge = LENS_RIGHT.x + LENS_RIGHT.width;
    expect(last.position.x + last.size.width).toBe(lensNearEdge - GAP);
  });

  test("a left-side Lens numbers left to right too — slot 0 is beside it", () => {
    const a = imposeRect(at(0, 2), 300, LENS_LEFT);
    const b = imposeRect(at(1, 2), 300, LENS_LEFT);
    // Slot 1 is the leftmost position on this deck, which is the one against
    // the Lens. The Lens's side moves the band, never the numbering.
    expect(a.position.x).toBe(LENS_LEFT.x + GAP);
    // The last slot's right edge lands a gap short of the canvas's right.
    expect(b.position.x + b.size.width).toBe(995);
  });

  test("a right-docked Lens leaves slot 0 exactly where a closed one does", () => {
    expect(imposeRect(at(0, 2), 300, LENS_RIGHT).position.x).toBe(
      imposeRect(at(0, 2), 300, FULL).position.x,
    );
  });

  test("a card wider than the band has no travel, so every slot is the far edge", () => {
    for (const k of [0, 1]) {
      const rect = imposeRect(at(k, 2), 1400, FULL);
      expect(rect.position.x).toBe(GAP);
      expect(rect.size.width).toBe(1400);
    }
  });

  test("the run is the span height less the top gap and the deeper bottom", () => {
    const rect = imposeRect(at(0, 2), 321, LENS_LEFT);
    expect(rect.position.y).toBe(IMPOSITION_GAP_PX);
    expect(rect.size.height).toBe(
      LENS_LEFT.height - IMPOSITION_GAP_PX - IMPOSITION_GAP_BOTTOM_PX,
    );
  });

  test("width is a pass-through for every span", () => {
    for (const span of [FULL, LENS_LEFT, LENS_RIGHT]) {
      for (const w of [1, 120, 640, 4000]) {
        expect(imposeRect(at(0, 2), w, span).size.width).toBe(w);
      }
    }
  });
});

describe("imposeStyle", () => {
  const BAND =
    "(100% - var(--tug-imposer-inset-left, 0px)" +
    " - var(--tug-imposer-inset-right, 0px) - 5px * 2)";

  test("a left-numbered pane pins its left edge against the left inset", () => {
    expect(imposeStyle(at(1, 2), 300, false)).toEqual({
      width: "300px",
      height: "auto",
      top: "5px",
      bottom: "32px",
      left:
        "calc(0% + var(--tug-imposer-inset-left, 0px) + 5px + " +
        `1 * max(0px, ${BAND} - 300px))`,
    });
  });

  test("slot 0 has travelled nothing, so it carries no max() at all", () => {
    const style = imposeStyle(at(0, 3), 400, false);
    expect(style.left).toBe("calc(0% + var(--tug-imposer-inset-left, 0px) + 5px + 0px)");
    expect(style.left).not.toContain("max(");
  });

  // The pin's SHAPE is the same on every deck and in every slot — only the
  // inset terms and the fraction differ. That is what a Lens flip has to
  // interpolate; a pin that turned around and measured from `100%` would be
  // swapping a percentage for a bare length, which has nothing to cross.
  test("every pin has the same shape: `left`, from the left inset", () => {
    for (const slot of [0, 1, 2]) {
      const style = imposeStyle(at(slot, 3), 400, false);
      expect(style.transform).toBeUndefined();
      expect(style.right).toBeUndefined();
      expect(String(style.left)).toStartWith(
        "calc(0% + var(--tug-imposer-inset-left, 0px) + 5px + ",
      );
    }
  });

  test("collapsed releases the bottom pin and nothing else", () => {
    const collapsed = imposeStyle(at(0, 2), 640, true);
    expect(collapsed).toEqual({
      width: "640px",
      height: "auto",
      top: "5px",
      left: "calc(0% + var(--tug-imposer-inset-left, 0px) + 5px + 0px)",
    });
    expect(collapsed.bottom).toBeUndefined();
  });

  test("the width is always the pane's own, verbatim", () => {
    expect(imposeStyle(at(0, 2), 987, false).width).toBe("987px");
  });
});

describe("imposeLensStyle", () => {
  const WIDTH = "var(--tug-lens-width, 420px)";
  const PIN =
    `calc(var(--tugx-lens-rail) * (100% - ${WIDTH} - 5px)` +
    " + (1 - var(--tugx-lens-rail)) * 5px)";

  test("pins the Lens to its side, a gap in on three edges and deeper below", () => {
    expect(imposeLensStyle("left", 420, false) as Record<string, unknown>).toEqual({
      width: WIDTH,
      height: "auto",
      top: "5px",
      "--tugx-lens-rail": 0,
      left: PIN,
      bottom: "32px",
    });
    expect(imposeLensStyle("right", 420, false) as Record<string, unknown>).toEqual({
      width: WIDTH,
      height: "auto",
      top: "5px",
      "--tugx-lens-rail": 1,
      left: PIN,
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

  // The side is carried by an animatable number, and `left` is ONE expression
  // that reads it, identical on both sides. Emitting the two anchors as two
  // values of `left` instead gives a bare length against a percentage, which
  // has nothing to interpolate, so the flip cuts.
  test("the flip changes only the rail number, never the pin's shape", () => {
    const left = imposeLensStyle("left", 420, false);
    const right = imposeLensStyle("right", 420, false);
    expect(left.left).toBe(right.left);
    expect(String(left.left)).toContain("var(--tugx-lens-rail)");
    expect(
      (left as Record<string, unknown>)["--tugx-lens-rail"],
    ).toBe(0);
    expect(
      (right as Record<string, unknown>)["--tugx-lens-rail"],
    ).toBe(1);
  });

  test("a collapsed Lens keeps its side and top pins and releases the bottom", () => {
    const collapsed = imposeLensStyle("right", 420, true);
    expect(collapsed.top).toBe("5px");
    expect(collapsed.left).toBe(PIN);
    expect(collapsed.bottom).toBeUndefined();
  });

  // The width a drag rewrites is a property, and the pin is written over the
  // SAME expression: on the right rail the pin is `100% - width - gap`, so a
  // width that moved without the pin moving would move the pinned edge — the
  // one edge the Lens holds. One property feeding both makes that impossible.
  test("the width is a property the pin reads, over the pane's own as fallback", () => {
    const style = imposeLensStyle("left", 987, false);
    expect(style.width).toBe("var(--tug-lens-width, 987px)");
    expect(String(style.left)).toContain("var(--tug-lens-width, 987px)");
  });

  test("the fallback is the pane's own width, so an unwritten property changes nothing", () => {
    for (const w of [260, 420, 987]) {
      expect(imposeLensStyle("right", w, false).width).toBe(
        `var(--tug-lens-width, ${w}px)`,
      );
    }
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
      const rect = imposeRect(at(1, 2), 240, span);
      expect(rect.position.x + rect.size.width).toBe(CANVAS.width - GAP - W - GAP);
      expect(imposeRect(at(0, 2), 240, span).position.x).toBe(GAP);
    });

    test(`a ${W}px left-side Lens leaves slot 1 one gap off it`, () => {
      const span = resolveSpan(CANVAS, { side: "left", width: W });
      // Slot 1 is the leftmost position, so on this deck it is the one against
      // the Lens; the last slot runs to the canvas's right edge.
      expect(imposeRect(at(0, 2), 240, span).position.x).toBe(GAP + W + GAP);
      const last = imposeRect(at(1, 2), 240, span);
      expect(last.position.x + last.size.width).toBe(CANVAS.width - GAP);
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
    return insetLeft + GAP + offset;
  }

  const CASES: Array<[ImposerSpan, number]> = [
    [FULL, 1000],
    [LENS_RIGHT, 1000],
    [LENS_LEFT, 1000],
  ];

  for (const [name, widths] of [
    ["an arrangement with room", [300, 220, 260]],
    ["a crowded arrangement", [500, 500, 500]],
  ] as const) {
    test(`${name} matches imposeRect everywhere`, () => {
      for (const [span, canvasWidth] of CASES) {
        widths.forEach((width, slot) => {
          const placement = resolvePlacement("three-up", slot);
          expect(evaluatePin(placement, width, span, canvasWidth)).toBeCloseTo(
            imposeRect(placement, width, span).position.x,
            9,
          );
        });
      }
    });
  }
});

describe("the space allocator", () => {
  /** The motivating shape: five-up with cards in slots 1, 3 and 5, all the
   *  same width. Three cards and two gaps want a band of exactly 2410. */
  const FIVE_UP_THIRDS = [
    { slot: 0, width: 800 },
    { slot: 2, width: 800 },
    { slot: 4, width: 800 },
  ];
  /** The band that tiles the shape above exactly, and the Lens width that
   *  produces it on a canvas of width W: `W - 3·gap - band`. */
  const EXACT_BAND = 3 * 800 + 2 * GAP;
  const lensFor = (canvasWidth: number): number =>
    canvasWidth - GAP * 3 - EXACT_BAND;

  /** Every seam in the chain, measured through `imposeRect` at a given Lens
   *  width — the geometry the allocator's answer actually produces. */
  function seamsAt(
    canvasWidth: number,
    lensWidth: number,
    occupied: readonly { slot: number; width: number }[],
    kind: "five-up",
  ): number[] {
    const span = resolveSpan(
      { width: canvasWidth, height: 800 },
      { side: "right", width: lensWidth },
    );
    const rects = occupied.map((o) =>
      imposeRect(resolvePlacement(kind, o.slot), o.width, span),
    );
    const seams: number[] = [];
    for (let i = 0; i < rects.length - 1; i += 1) {
      seams.push(
        rects[i + 1].position.x - (rects[i].position.x + rects[i].size.width),
      );
    }
    return seams;
  }

  test("the exact-tiling case lands every seam on the gap", () => {
    const canvasWidth = 2845;
    const width = allocateLensWidth({
      canvasWidth,
      kind: "five-up",
      occupied: FIVE_UP_THIRDS,
      preferredWidth: 400,
      minWidth: 320,
    });
    expect(width).toBe(lensFor(canvasWidth));
    for (const seam of seamsAt(canvasWidth, width ?? 0, FIVE_UP_THIRDS, "five-up")) {
      expect(seam).toBeCloseTo(GAP, 9);
    }
  });

  test("gaps grow the Lens and overlaps shrink it", () => {
    const preferredWidth = 420;
    // A deck 20px wider than the exact fit spreads the cards: the Lens takes
    // the surplus.
    const roomy = 2865;
    expect(seamsAt(roomy, preferredWidth, FIVE_UP_THIRDS, "five-up")[0]).toBeGreaterThan(GAP);
    const grown = allocateLensWidth({
      canvasWidth: roomy,
      kind: "five-up",
      occupied: FIVE_UP_THIRDS,
      preferredWidth,
      minWidth: 320,
    });
    expect(grown).toBe(440);
    expect(grown).toBeGreaterThan(preferredWidth);

    // And 20px narrower overlaps them: the Lens gives the difference back.
    const crowded = 2825;
    expect(seamsAt(crowded, preferredWidth, FIVE_UP_THIRDS, "five-up")[0]).toBeLessThan(GAP);
    const shrunk = allocateLensWidth({
      canvasWidth: crowded,
      kind: "five-up",
      occupied: FIVE_UP_THIRDS,
      preferredWidth,
      minWidth: 320,
    });
    expect(shrunk).toBe(400);
    expect(shrunk).toBeLessThan(preferredWidth);
  });

  test("irregular occupancy is solved, then refused", () => {
    // Slots 1, 2 and 5 of five-up: fractions 0, 1/4, 1 with uniform 800s.
    // No band tiles that at all, so the least-squares fit does not remove the
    // error, it spreads it — B* = Σa(gap − c)/Σa² = 1305 / 0.625 = 2088.
    const canvasWidth = 2523;
    const input = {
      canvasWidth,
      kind: "five-up" as const,
      occupied: [
        { slot: 0, width: 800 },
        { slot: 1, width: 800 },
        { slot: 4, width: 800 },
      ],
      preferredWidth: 400,
      minWidth: 320,
    };

    // The geometry still answers: this is the best band there is.
    expect(solveLensWidth(input)).toBe(canvasWidth - GAP * 3 - 2088);

    // And standing there the cards overlap by 478 at one seam and stand 166
    // apart at the other — the best band there is, is not a tiled one. The
    // Lens's width buys nothing here, so it is not spent.
    expect(allocateLensWidth(input)).toBeNull();
  });

  test("the allowance is asymmetric: a third up, a fifth down", () => {
    // The band that tiles the fixture is fixed, so the canvas width is what
    // decides how far the Lens has to move. The Lens may travel further to
    // grow than to shrink — growing spends slack the deck had lying between
    // the cards, shrinking takes room from a surface holding content.
    const preferredWidth = 420;
    const up = Math.round(preferredWidth * LENS_FLEX_GROW_FRACTION);
    const down = Math.round(preferredWidth * LENS_FLEX_SHRINK_FRACTION);
    expect(up).toBeGreaterThan(down);

    const canvasFor = (lensWidth: number): number =>
      lensWidth + GAP * 3 + EXACT_BAND;
    const solve = (canvasWidth: number): number | null =>
      allocateLensWidth({
        canvasWidth,
        kind: "five-up",
        occupied: FIVE_UP_THIRDS,
        preferredWidth,
        minWidth: 320,
      });

    // At each end, taken whole.
    expect(solve(canvasFor(preferredWidth + up))).toBe(preferredWidth + up);
    expect(solve(canvasFor(preferredWidth - down))).toBe(preferredWidth - down);

    // Just past either end the clamped width still lands the chain even, so
    // the move is made as far as the allowance goes — and NEVER further. The
    // fixture's slots are a half-stride apart, so a Lens off by `d` leaves
    // seams off by `d / 2`: four pixels over still tiles.
    for (const over of [1, 4]) {
      expect(solve(canvasFor(preferredWidth + up + over))).toBe(
        preferredWidth + up,
      );
      expect(solve(canvasFor(preferredWidth - down - over))).toBe(
        preferredWidth - down,
      );
    }

    // Far enough past that the clamp leaves the seams visibly ragged, moving
    // the Lens would buy nothing, so it does not move.
    expect(solve(canvasFor(preferredWidth + up + 5))).toBeNull();
    expect(solve(canvasFor(preferredWidth - down - 5))).toBeNull();
  });

  test("a solve too far out of range leaves the Lens alone", () => {
    // The exact fit here wants a Lens of 1575 — nowhere near ±20% of 420, and
    // the width the allowance permits leaves the seams as ragged as they were.
    // The Lens is the user's; there is nothing to be gained by moving it.
    expect(
      allocateLensWidth({
        canvasWidth: 4000,
        kind: "five-up",
        occupied: FIVE_UP_THIRDS,
        preferredWidth: 420,
        minWidth: 320,
      }),
    ).toBeNull();
  });

  test("the floor clips the low end of the range", () => {
    // 20% below 340 is 272, but the Lens may not go under 320 — so a solve of
    // 310 is out of range even though it is within the flex fraction. The floor
    // is the nearest the Lens may stand, and standing there still leaves the
    // seams 5px off, so it does not move at all.
    expect(
      allocateLensWidth({
        canvasWidth: 2735,
        kind: "five-up",
        occupied: FIVE_UP_THIRDS,
        preferredWidth: 340,
        minWidth: 320,
      }),
    ).toBeNull();
    // 330 clears the floor and is taken.
    expect(
      allocateLensWidth({
        canvasWidth: 2755,
        kind: "five-up",
        occupied: FIVE_UP_THIRDS,
        preferredWidth: 340,
        minWidth: 320,
      }),
    ).toBe(330);
  });

  test("duplicate slots fold to the widest pane standing there", () => {
    const canvasWidth = 2845;
    const stacked = allocateLensWidth({
      canvasWidth,
      kind: "five-up",
      occupied: [
        { slot: 0, width: 800 },
        { slot: 0, width: 640 },
        { slot: 2, width: 800 },
        { slot: 4, width: 800 },
      ],
      preferredWidth: 400,
      minWidth: 320,
    });
    expect(stacked).toBe(lensFor(canvasWidth));
  });

  test("the order of the occupied list does not matter", () => {
    const canvasWidth = 2845;
    const shuffled = allocateLensWidth({
      canvasWidth,
      kind: "five-up",
      occupied: [FIVE_UP_THIRDS[2], FIVE_UP_THIRDS[0], FIVE_UP_THIRDS[1]],
      preferredWidth: 400,
      minWidth: 320,
    });
    expect(shuffled).toBe(lensFor(canvasWidth));
  });

  test("no seam to solve for means the Lens does not move", () => {
    const base = {
      canvasWidth: 2845,
      kind: "five-up" as const,
      preferredWidth: 400,
      minWidth: 320,
    };
    // One card, no cards, and one-up (whose every slot clamps to the same
    // anchor) all leave the chain without a pair of neighbours.
    expect(allocateLensWidth({ ...base, occupied: [{ slot: 0, width: 800 }] })).toBeNull();
    expect(allocateLensWidth({ ...base, occupied: [] })).toBeNull();
    expect(
      allocateLensWidth({
        ...base,
        kind: "one-up",
        occupied: FIVE_UP_THIRDS,
      }),
    ).toBeNull();
  });

  test("a non-finite input leaves the Lens alone", () => {
    const base = {
      canvasWidth: 2845,
      kind: "five-up" as const,
      occupied: FIVE_UP_THIRDS,
      preferredWidth: 400,
      minWidth: 320,
    };
    expect(allocateLensWidth({ ...base, canvasWidth: Number.NaN })).toBeNull();
    expect(allocateLensWidth({ ...base, minWidth: Number.NaN })).toBeNull();
    expect(
      allocateLensWidth({
        ...base,
        occupied: [{ slot: 0, width: Number.NaN }, { slot: 2, width: 800 }],
      }),
    ).toBeNull();
  });
});
