import { describe, expect, test } from "bun:test";

import {
  IMPOSITION_GAP_BOTTOM_PX,
  IMPOSITION_GAP_PX,
  IMPOSITION_KINDS,
  clampSlot,
  allocateSidebarWidths,
  solveSidebarWidths,
  sidebarStackOrder,
  LENS_FLEX_SHRINK_FRACTION,
  imposeRect,
  imposeStyle,
  imposeSidebarStyle,
  isImpositionKind,
  resolveContentWidthPx,
  resolvePlacement,
  resolveSpan,
  CONTENT_WIDTH_SLIM_PX,
  CONTENT_WIDTH_COMFY_PX,
  CONTENT_WIDTH_WIDE_PX,
  CONTENT_WIDTH_PRESETS,
  slotCount,
  travelFraction,
  type DeckImposition,
  type ImposerSpan,
  type ImposedPlacement,
  type ImpositionKind,
} from "@/lib/layout-imposer";

const GAP = IMPOSITION_GAP_PX;

/** The allocator's one-rail reading: a single right-side rail, answered as a
 *  plain width. Every number the allocator describes assert is the number the
 *  single-Lens solve produced before the rails generalized — this wrapper is
 *  what makes them a regression guard rather than a rewrite. The ceiling
 *  defaults to slim (675) — the one the deck passes, whatever Card Width is
 *  set, because a sidebar is a reading surface. */
function allocateOneRail(input: {
  canvasWidth: number;
  kind: ImpositionKind;
  occupied: readonly { slot: number; width: number }[];
  preferredWidth: number;
  minWidth: number;
  maxRailWidth?: number;
}): number | null {
  const widths = allocateSidebarWidths({
    canvasWidth: input.canvasWidth,
    kind: input.kind,
    occupied: input.occupied,
    rails: {
      right: { preferredWidth: input.preferredWidth, minWidth: input.minWidth },
    },
    maxRailWidth: input.maxRailWidth ?? CONTENT_WIDTH_SLIM_PX,
  });
  return widths?.right ?? null;
}

/** @see allocateOneRail */
function solveOneRail(input: {
  canvasWidth: number;
  kind: ImpositionKind;
  occupied: readonly { slot: number; width: number }[];
  preferredWidth: number;
  minWidth: number;
}): number | null {
  return solveSidebarWidths({
    canvasWidth: input.canvasWidth,
    kind: input.kind,
    occupied: input.occupied,
    rails: {
      right: { preferredWidth: input.preferredWidth, minWidth: input.minWidth },
    },
    maxRailWidth: CONTENT_WIDTH_SLIM_PX,
  });
}

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
    expect(resolveSpan(canvas, [])).toEqual(FULL);
  });

  test("a left-side Lens insets the span's origin by its width plus a gap", () => {
    expect(resolveSpan(canvas, [{ side: "left", width: 260 }])).toEqual(LENS_LEFT);
  });

  test("a right-side Lens insets the span's width only", () => {
    expect(resolveSpan(canvas, [{ side: "right", width: 260 }])).toEqual(LENS_RIGHT);
  });

  test("rails on both sides inset the band from both", () => {
    expect(
      resolveSpan(canvas, [
        { side: "left", width: 260 },
        { side: "right", width: 300 },
      ]),
    ).toEqual({ x: 265, width: 1000 - 265 - 305, height: 800 });
  });

  // The gap count is not a constant: it is one gap per STANDING rail. This is
  // the identity the allocator's band solve reads off rather than writing its
  // own, so a closed rail can never leave a phantom gap in the arithmetic.
  test("each standing rail contributes exactly one gap", () => {
    const bandOf = (rails: Parameters<typeof resolveSpan>[1]): number =>
      resolveSpan(canvas, rails).width - GAP * 2;
    expect(bandOf([])).toBe(1000 - GAP * 2);
    expect(bandOf([{ side: "right", width: 260 }])).toBe(1000 - 260 - GAP * 3);
    expect(
      bandOf([
        { side: "left", width: 260 },
        { side: "right", width: 300 },
      ]),
    ).toBe(1000 - 560 - GAP * 4);
  });

  test("same-side cards share one rail, so a side is passed once", () => {
    // Two cards stacked on the right stand in ONE rail at one width — the
    // caller folds them, and passing the side twice would inset the band twice
    // for a picture with one edge in it.
    const stacked = resolveSpan(canvas, [{ side: "right", width: 300 }]);
    expect(stacked.width).toBe(1000 - 305);
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
    expect(imposeStyle(at(1, 2), 300)).toEqual({
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
    const style = imposeStyle(at(0, 3), 400);
    expect(style.left).toBe("calc(0% + var(--tug-imposer-inset-left, 0px) + 5px + 0px)");
    expect(style.left).not.toContain("max(");
  });

  // The pin's SHAPE is the same on every deck and in every slot — only the
  // inset terms and the fraction differ. That is what a Lens flip has to
  // interpolate; a pin that turned around and measured from `100%` would be
  // swapping a percentage for a bare length, which has nothing to cross.
  test("every pin has the same shape: `left`, from the left inset", () => {
    for (const slot of [0, 1, 2]) {
      const style = imposeStyle(at(slot, 3), 400);
      expect(style.transform).toBeUndefined();
      expect(style.right).toBeUndefined();
      expect(String(style.left)).toStartWith(
        "calc(0% + var(--tug-imposer-inset-left, 0px) + 5px + ",
      );
    }
  });

  test("the width is always the pane's own, verbatim", () => {
    expect(imposeStyle(at(0, 2), 987).width).toBe("987px");
  });

  // A size-locked card (About) is placed, not sized. `bottom` has to go:
  // leaving it beside a fixed `height` would over-constrain the box and the
  // browser would drop one of the three, which is exactly the stretch the
  // pin exists to prevent.
  test("a pinned height replaces the run rather than riding inside it", () => {
    const style = imposeStyle(at(0, 3), 800, { height: 360 });
    expect(style.height).toBe("360px");
    expect(style.bottom).toBeUndefined();
    expect(style.top).toBe("calc(5px + max(0px, (100% - 5px - 32px - 360px) / 2))");
  });

  // The whole point of the slot/frame split: the travel is computed from the
  // SLOT's 800, not the card's 320, so the card lands where an ordinary card
  // would — and then steps half the difference in to sit in the middle of it.
  test("a pinned width takes an ordinary card's slot and centres in it", () => {
    const style = imposeStyle(at(0, 3), 800, { width: 320, height: 360 });
    expect(style.width).toBe("320px");
    // Slot 0 has no travel, so the centring term is the whole offset.
    expect(style.left).toBe(
      "calc(0% + var(--tug-imposer-inset-left, 0px) + 5px + 0px + 240px)",
    );
  });

  test("the travel a pinned card gets is its slot's, not its own", () => {
    // The last slot of a three-up: the card must end up exactly where an 800
    // card would, plus the 240 that centres it in that 800.
    const pinned = imposeStyle(at(2, 3), 800, { width: 320, height: 360 });
    const ordinary = imposeStyle(at(2, 3), 800);
    expect(pinned.left).toBe(`${String(ordinary.left).slice(0, -1)} + 240px)`);
  });

  test("a card wider than its slot pins at the near edge, never negative", () => {
    const style = imposeStyle(at(0, 2), 300, { width: 900 });
    expect(style.width).toBe("900px");
    // The centring term is clamped to 0, not the -300 the raw halving gives.
    expect(style.left).toEndWith("+ 0px + 0px)");
  });

  test("a pinned rect centres on both axes, and clamps at the near edges", () => {
    // FULL is 1000 × 800: a run of 800 - 5 - 32 = 763, so a 363-tall card
    // leaves 400 of slack and takes 200 of it above. A 320 card in an 800
    // slot takes 240 of the 480 to its left.
    const centred = imposeRect(at(0, 3), 800, FULL, { width: 320, height: 363 });
    expect(centred.size).toEqual({ width: 320, height: 363 });
    expect(centred.position).toEqual({ x: GAP + 240, y: GAP + 200 });
    // Larger than the slot on either axis: no negative offset, so it starts at
    // the near edge rather than hanging off the canvas.
    const overhang = imposeRect(at(0, 3), 320, FULL, {
      width: 900,
      height: 2000,
    });
    expect(overhang.position).toEqual({ x: GAP, y: GAP });
  });

  test("a pinned card's slot is still an ordinary slot", () => {
    // The slot itself has not moved: the pinned card's centre sits on the
    // centre of the box an ordinary card of the slot's width would occupy.
    const slot = imposeRect(at(1, 3), 800, FULL);
    const pinned = imposeRect(at(1, 3), 800, FULL, { width: 320, height: 360 });
    expect(pinned.position.x + pinned.size.width / 2).toBe(
      slot.position.x + slot.size.width / 2,
    );
    expect(pinned.position.y + pinned.size.height / 2).toBe(
      slot.position.y + slot.size.height / 2,
    );
  });
});

describe("imposeSidebarStyle", () => {
  /** A side's width expression: its own rail property, with the React-known
   *  width as the fallback. Same shape on both sides, different property —
   *  two rails standing at once need two numbers. */
  const widthOf = (side: "left" | "right", px = 420): string =>
    `var(--tug-sidebar-width-${side}, ${px}px)`;
  const pinOf = (side: "left" | "right", px = 420): string =>
    `calc(var(--tugx-lens-rail) * (100% - ${widthOf(side, px)} - 5px)` +
    " + (1 - var(--tugx-lens-rail)) * 5px)";

  test("pins the Lens to its side, a gap in on three edges and deeper below", () => {
    expect(imposeSidebarStyle("left", 420) as Record<string, unknown>).toEqual({
      width: widthOf("left"),
      height: "auto",
      top: "5px",
      "--tugx-lens-rail": 0,
      left: pinOf("left"),
      bottom: "32px",
    });
    expect(imposeSidebarStyle("right", 420) as Record<string, unknown>).toEqual({
      width: widthOf("right"),
      height: "auto",
      top: "5px",
      "--tugx-lens-rail": 1,
      left: pinOf("right"),
      bottom: "32px",
    });
  });

  test("both sides pin with `left`, so the flip is one property's value", () => {
    for (const side of ["left", "right"] as const) {
      const style = imposeSidebarStyle(side, 420);
      expect(style.right).toBeUndefined();
      expect(typeof style.left).toBe("string");
    }
  });

  // The side is carried by an animatable number, and `left` is ONE expression
  // that reads it, identical on both sides. Emitting the two anchors as two
  // values of `left` instead gives a bare length against a percentage, which
  // has nothing to interpolate, so the flip cuts.
  test("the flip changes only the rail number, never the pin's shape", () => {
    const left = imposeSidebarStyle("left", 420);
    const right = imposeSidebarStyle("right", 420);
    // Same expression, differing only in which side's width property it reads.
    expect(String(left.left).replace("-left,", "-right,")).toBe(
      String(right.left),
    );
    expect(String(left.left)).toContain("var(--tugx-lens-rail)");
    expect(
      (left as Record<string, unknown>)["--tugx-lens-rail"],
    ).toBe(0);
    expect(
      (right as Record<string, unknown>)["--tugx-lens-rail"],
    ).toBe(1);
  });

  // The width a drag rewrites is a property, and the pin is written over the
  // SAME expression: on the right rail the pin is `100% - width - gap`, so a
  // width that moved without the pin moving would move the pinned edge — the
  // one edge the Lens holds. One property feeding both makes that impossible.
  test("the width is a property the pin reads, over the pane's own as fallback", () => {
    const style = imposeSidebarStyle("left", 987);
    expect(style.width).toBe(widthOf("left", 987));
    expect(String(style.left)).toContain(widthOf("left", 987));
  });

  test("the fallback is the pane's own width, so an unwritten property changes nothing", () => {
    for (const w of [260, 420, 987]) {
      expect(imposeSidebarStyle("right", w).width).toBe(
        widthOf("right", w),
      );
    }
  });

  test("each side reads its own width property, so two rails cannot share one", () => {
    expect(imposeSidebarStyle("left", 420).width).toBe(widthOf("left"));
    expect(imposeSidebarStyle("right", 420).width).toBe(widthOf("right"));
  });
});

describe("a shared rail is a stack, not a split", () => {
  test("every member takes the same pins — the whole run, each", () => {
    // The pins are the ones a lone rail has always had, and a second card on
    // the side does not change them. This is the whole geometry of the change
    // from the split design: same pin, same width, same run, and z-order
    // decides which of the two you are looking at.
    for (const side of ["left", "right"] as const) {
      const style = imposeSidebarStyle(side, 420);
      expect(style.top).toBe("5px");
      expect(style.bottom).toBe("32px");
    }
  });

  test("two members on one side are geometrically identical", () => {
    // A stack of two is two frames the browser cannot tell apart except by
    // z-order — which is exactly what makes the title bar's stack badge the
    // only way to reach the one behind.
    const first = imposeSidebarStyle("right", 420);
    const second = imposeSidebarStyle("right", 420);
    expect(first).toEqual(second);
  });

  test("the style carries no vertical term a stack could vary", () => {
    // A regression guard with a shape rather than a number: if a future change
    // reintroduces per-member vertical math, these stop being bare lengths.
    const style = imposeSidebarStyle("right", 420);
    expect(style.top).not.toContain("calc");
    expect(style.bottom).not.toContain("calc");
  });
});

describe("sidebarStackOrder", () => {
  const imposition = (
    sidebars: DeckImposition["sidebars"],
  ): DeckImposition => ({ sidebars });

  test("returns the side's members in registration order", () => {
    // There is no vertical order to record any more: the members stand
    // front-to-back, so the only order this reports is the one the caller
    // handed it, filtered to the side.
    const state = imposition({
      lens: { side: "right" },
      jots: { side: "right" },
    });
    expect(sidebarStackOrder(state, "right", ["lens", "jots"])).toEqual([
      "lens",
      "jots",
    ]);
    expect(sidebarStackOrder(state, "right", ["jots", "lens"])).toEqual([
      "jots",
      "lens",
    ]);
    expect(sidebarStackOrder(state, "left", ["lens", "jots"])).toEqual([]);
  });

  test("a card on the other side is not in this side's stack", () => {
    const state = imposition({
      lens: { side: "left" },
      jots: { side: "right" },
    });
    expect(sidebarStackOrder(state, "left", ["lens", "jots"])).toEqual(["lens"]);
    expect(sidebarStackOrder(state, "right", ["lens", "jots"])).toEqual(["jots"]);
  });

  test("cards default to the right, so an empty map stacks them there", () => {
    const state = imposition({});
    expect(sidebarStackOrder(state, "right", ["lens", "jots"])).toEqual([
      "lens",
      "jots",
    ]);
    expect(sidebarStackOrder(state, "left", ["lens", "jots"])).toEqual([]);
  });
});

describe("the arrangement clears the Lens by exactly one gap", () => {
  // The derivation the pinned-Lens geometry rests on: with the Lens on the
  // right at width W, its near edge sits at `canvasW - GAP - W`, and the last
  // slot's card must land one gap short of that.
  const CANVAS = { width: 1000, height: 800 };

  for (const W of [260, 420, 500]) {
    test(`a ${W}px right-side Lens leaves the last slot one gap off it`, () => {
      const span = resolveSpan(CANVAS, [{ side: "right", width: W }]);
      const rect = imposeRect(at(1, 2), 240, span);
      expect(rect.position.x + rect.size.width).toBe(CANVAS.width - GAP - W - GAP);
      expect(imposeRect(at(0, 2), 240, span).position.x).toBe(GAP);
    });

    test(`a ${W}px left-side Lens leaves slot 1 one gap off it`, () => {
      const span = resolveSpan(CANVAS, [{ side: "left", width: W }]);
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
    const span = resolveSpan({ width: canvasWidth, height: 800 }, [
      { side: "right", width: lensWidth },
    ]);
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
    const width = allocateOneRail({
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
    const grown = allocateOneRail({
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
    const shrunk = allocateOneRail({
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
    expect(solveOneRail(input)).toBe(canvasWidth - GAP * 3 - 2088);

    // And standing there the cards overlap by 478 at one seam and stand 166
    // apart at the other — the best band there is, is not a tiled one. The
    // Lens's width buys nothing here, so it is not spent.
    expect(allocateOneRail(input)).toBeNull();
  });

  test("growth is bounded by the slim width, not a fraction", () => {
    // A rail may stand as wide as a slim content card — a fixed ceiling,
    // however far that is from the width the user chose.
    const preferredWidth = 420;
    const maxRailWidth = CONTENT_WIDTH_SLIM_PX;

    const canvasFor = (lensWidth: number): number =>
      lensWidth + GAP * 3 + EXACT_BAND;
    const solve = (canvasWidth: number): number | null =>
      allocateOneRail({
        canvasWidth,
        kind: "five-up",
        occupied: FIVE_UP_THIRDS,
        preferredWidth,
        minWidth: 320,
        maxRailWidth,
      });

    // The whole run up to the ceiling is available, taken whole.
    expect(solve(canvasFor(maxRailWidth))).toBe(maxRailWidth);

    // Just past the ceiling the clamped width still lands the chain even, so
    // the move is made as far as the ceiling — and NEVER further. The
    // fixture's slots are a half-stride apart, so a Lens off by `d` leaves
    // seams off by `d / 2`: four pixels over still tiles.
    for (const over of [1, 4]) {
      expect(solve(canvasFor(maxRailWidth + over))).toBe(maxRailWidth);
    }

    // Far enough past that the clamp leaves the seams visibly ragged, moving
    // the Lens would buy nothing, so it does not move.
    expect(solve(canvasFor(maxRailWidth + 5))).toBeNull();
  });

  test("shrinkage keeps its allowance: a fifth under the chosen width", () => {
    // Shrinking takes room from a surface the user sized to hold content, so
    // the low end stays anchored to their choice rather than to the preset.
    const preferredWidth = 420;
    const down = Math.round(preferredWidth * LENS_FLEX_SHRINK_FRACTION);

    const canvasFor = (lensWidth: number): number =>
      lensWidth + GAP * 3 + EXACT_BAND;
    const solve = (canvasWidth: number): number | null =>
      allocateOneRail({
        canvasWidth,
        kind: "five-up",
        occupied: FIVE_UP_THIRDS,
        preferredWidth,
        minWidth: 320,
      });

    // At the low end, taken whole; just past it the clamp still tiles within
    // tolerance; far enough past, the move buys nothing and is not made.
    expect(solve(canvasFor(preferredWidth - down))).toBe(preferredWidth - down);
    for (const over of [1, 4]) {
      expect(solve(canvasFor(preferredWidth - down - over))).toBe(
        preferredWidth - down,
      );
    }
    expect(solve(canvasFor(preferredWidth - down - 5))).toBeNull();
  });

  test("a solve past the ceiling leaves the Lens alone", () => {
    // The exact fit here wants a Lens of 1575 — far past the slim ceiling —
    // and standing at the ceiling leaves the seams as ragged as they were.
    // The width buys nothing, so it is not spent.
    expect(
      allocateOneRail({
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
      allocateOneRail({
        canvasWidth: 2735,
        kind: "five-up",
        occupied: FIVE_UP_THIRDS,
        preferredWidth: 340,
        minWidth: 320,
      }),
    ).toBeNull();
    // 330 clears the floor and is taken.
    expect(
      allocateOneRail({
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
    const stacked = allocateOneRail({
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
    const shuffled = allocateOneRail({
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
    expect(allocateOneRail({ ...base, occupied: [{ slot: 0, width: 800 }] })).toBeNull();
    expect(allocateOneRail({ ...base, occupied: [] })).toBeNull();
    expect(
      allocateOneRail({
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
    expect(allocateOneRail({ ...base, canvasWidth: Number.NaN })).toBeNull();
    expect(allocateOneRail({ ...base, minWidth: Number.NaN })).toBeNull();
    expect(
      allocateOneRail({
        ...base,
        occupied: [{ slot: 0, width: Number.NaN }, { slot: 2, width: 800 }],
      }),
    ).toBeNull();
  });

  test("with no rail standing there is nothing to allocate", () => {
    expect(
      allocateSidebarWidths({
        canvasWidth: 2845,
        kind: "five-up",
        occupied: FIVE_UP_THIRDS,
        rails: {},
        maxRailWidth: CONTENT_WIDTH_SLIM_PX,
      }),
    ).toBeNull();
  });
});

describe("every standing rail takes one shared width", () => {
  const FIVE_UP_THIRDS = [
    { slot: 0, width: 800 },
    { slot: 2, width: 800 },
    { slot: 4, width: 800 },
  ] as const;
  /** The band the fixture tiles at, exactly — the same one the one-rail
   *  describes are built on. */
  const EXACT_BAND = 3 * 800 + 2 * GAP;

  const solve = (
    canvasWidth: number,
    left: { preferredWidth: number; minWidth: number },
    right: { preferredWidth: number; minWidth: number },
  ) =>
    allocateSidebarWidths({
      canvasWidth,
      kind: "five-up",
      occupied: FIVE_UP_THIRDS,
      rails: { left, right },
      maxRailWidth: CONTENT_WIDTH_SLIM_PX,
    });

  /** The canvas that wants the two rails to total `total`: four gaps now, one
   *  per rail plus one at each end of the band. */
  const canvasFor = (total: number): number => total + GAP * 4 + EXACT_BAND;

  test("the surplus is split evenly, not handed to one rail", () => {
    // Both rails prefer 400 and the deck wants 840 of rail: 420 each.
    const widths = solve(
      canvasFor(840),
      { preferredWidth: 400, minWidth: 320 },
      { preferredWidth: 400, minWidth: 320 },
    );
    expect(widths).toEqual({ left: 420, right: 420 });
  });

  test("unequal chosen widths land on ONE width — rails may not differ", () => {
    // 400 and 500 chosen; a deck wanting 980 of rail stands BOTH at 490. The
    // sidebars are a uniform class: an allocator answer with two rails at two
    // widths is not a picture this deck is allowed to paint.
    const widths = solve(
      canvasFor(980),
      { preferredWidth: 400, minWidth: 320 },
      { preferredWidth: 500, minWidth: 320 },
    );
    expect(widths).toEqual({ left: 490, right: 490 });
  });

  test("a floor binding on one rail binds the width both rails share", () => {
    // The right rail's floor of 480 is a bound on the ONE shared width, so the
    // left rail cannot be taken below it either. A deck wanting 940 of rail —
    // 470 each — is refused outright: standing both rails at the bound 480
    // leaves the seams visibly off, and half a gesture is not made.
    expect(
      solve(
        canvasFor(940),
        { preferredWidth: 400, minWidth: 320 },
        { preferredWidth: 500, minWidth: 480 },
      ),
    ).toBeNull();
    // Wanting 962 — 481 each — clears the floor and both rails stand at 481.
    expect(
      solve(
        canvasFor(962),
        { preferredWidth: 400, minWidth: 320 },
        { preferredWidth: 500, minWidth: 480 },
      ),
    ).toEqual({ left: 481, right: 481 });
  });

  test("growth reaches the slim width, on both rails at once", () => {
    // A deck wanting 1350 of rail stands both at the slim ceiling exactly —
    // each sidebar as wide as a slim content card, the widest a rail goes.
    const widths = solve(
      canvasFor(2 * CONTENT_WIDTH_SLIM_PX),
      { preferredWidth: 400, minWidth: 320 },
      { preferredWidth: 400, minWidth: 320 },
    );
    expect(widths).toEqual({
      left: CONTENT_WIDTH_SLIM_PX,
      right: CONTENT_WIDTH_SLIM_PX,
    });
  });

  test("a residual the rails cannot close moves neither of them", () => {
    // The fit wants more rail than even the content-width ceiling permits, and
    // the clamped widths leave the seams visibly ragged. Half a gesture is not
    // a picture anyone asked for, so nothing moves.
    expect(
      solve(
        canvasFor(2000),
        { preferredWidth: 400, minWidth: 320 },
        { preferredWidth: 400, minWidth: 320 },
      ),
    ).toBeNull();
  });

  test("a left-only rail is solved with the left-only gap count", () => {
    // One rail, so three gaps — not the four a bilateral deck spends.
    const widths = allocateSidebarWidths({
      canvasWidth: 420 + GAP * 3 + EXACT_BAND,
      kind: "five-up",
      occupied: FIVE_UP_THIRDS,
      rails: { left: { preferredWidth: 400, minWidth: 320 } },
      maxRailWidth: CONTENT_WIDTH_SLIM_PX,
    });
    expect(widths).toEqual({ left: 420 });
  });

  test("the seam test is asked of the two-rail picture, not a one-rail one", () => {
    // The answer tiles: measured through `resolveSpan` with BOTH rails, every
    // seam lands on the gap. A test built from a single-rail span would be
    // reading a band one rail too wide and would accept a ragged chain.
    const widths = solve(
      canvasFor(840),
      { preferredWidth: 400, minWidth: 320 },
      { preferredWidth: 400, minWidth: 320 },
    );
    const span = resolveSpan({ width: canvasFor(840), height: 800 }, [
      { side: "left", width: widths?.left ?? 0 },
      { side: "right", width: widths?.right ?? 0 },
    ]);
    const rects = FIVE_UP_THIRDS.map((o) =>
      imposeRect(resolvePlacement("five-up", o.slot), o.width, span),
    );
    for (let i = 0; i < rects.length - 1; i += 1) {
      const seam =
        rects[i + 1].position.x - (rects[i].position.x + rects[i].size.width);
      expect(seam).toBeCloseTo(GAP, 9);
    }
  });
});

describe("content width presets", () => {
  test("the three widths are the values the brief fixed", () => {
    // Pinned as numbers, not as an alias of the constants: `wide` is the one
    // the brief marks adjustable, so a retune should be a deliberate edit here
    // rather than something a refactor can slide past.
    expect(CONTENT_WIDTH_SLIM_PX).toBe(675);
    expect(CONTENT_WIDTH_COMFY_PX).toBe(800);
    expect(CONTENT_WIDTH_WIDE_PX).toBe(1230);
  });

  test("the pickers' order is narrow to wide", () => {
    expect(CONTENT_WIDTH_PRESETS).toEqual(["slim", "comfy", "wide"]);
  });

  test("a preset resolves to its own pixels when the pane's floor is below it", () => {
    expect(resolveContentWidthPx("slim", 320)).toBe(675);
    expect(resolveContentWidthPx("comfy", 675)).toBe(800);
    expect(resolveContentWidthPx("wide", 800)).toBe(1230);
  });

  test("a floor above the preset wins — Settings' 720 beats slim", () => {
    // `movePane` writes the rect it is handed without clamping, so a preset
    // narrower than the pane's own minimum has to be lifted here or the stored
    // geometry and the painted frame would disagree.
    expect(resolveContentWidthPx("slim", 720)).toBe(720);
    // …and only where it actually binds: the same floor is under comfy.
    expect(resolveContentWidthPx("comfy", 720)).toBe(800);
  });

  test("the floor never widens a pane past the preset it was given", () => {
    for (const preset of CONTENT_WIDTH_PRESETS) {
      expect(resolveContentWidthPx(preset, 0)).toBe(
        resolveContentWidthPx(preset, 1),
      );
    }
  });

  test("a ceiling below the preset wins — About is locked at 320", () => {
    // The deck-wide default reaches every content pane, size-locked cards
    // included, so the ceiling has to bind for the same reason the floor does.
    for (const preset of CONTENT_WIDTH_PRESETS) {
      expect(resolveContentWidthPx(preset, 320, 320)).toBe(320);
    }
  });

  test("a ceiling above the preset does not bind", () => {
    expect(resolveContentWidthPx("slim", 480, 1600)).toBe(675);
    expect(resolveContentWidthPx("wide", 480, 1600)).toBe(1230);
  });

  test("an impossible policy resolves to the floor, never below it", () => {
    // A registration whose max is under its min is malformed; the floor is the
    // one bound a pane can never paint below, so it is the one that survives.
    expect(resolveContentWidthPx("slim", 720, 400)).toBe(720);
  });
});
