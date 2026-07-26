import { describe, expect, test } from "bun:test";

import {
  IMPOSITION_GAP_BOTTOM_PX,
  IMPOSITION_GAP_PX,
  IMPOSITION_KINDS,
  chainStep,
  clampSlot,
  imposeRect,
  imposeStyle,
  imposeLensStyle,
  isImpositionKind,
  packFromForRail,
  resolvePlacements,
  resolveSpan,
  slotCount,
  type ImposerPane,
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

/** Terse pane literal for the packing cases. */
const pane = (id: string, slot: number | undefined, width: number): ImposerPane =>
  slot === undefined ? { id, width } : { id, slot, width };

/** The placement `resolvePlacements` gives `id`, or a failure if there is none. */
function placementFor(
  map: Map<string, ImposedPlacement>,
  id: string,
): ImposedPlacement {
  const found = map.get(id);
  if (found === undefined) throw new Error(`no placement for "${id}"`);
  return found;
}

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

describe("resolvePlacements", () => {
  const CHAIN = [pane("a", 0, 400), pane("b", 1, 300), pane("c", 2, 250)];

  test("the chain numbers the occupied slots from the packing edge", () => {
    const map = resolvePlacements("three-up", CHAIN, "right");
    expect(placementFor(map, "a").index).toBe(0);
    expect(placementFor(map, "b").index).toBe(1);
    expect(placementFor(map, "c").index).toBe(2);
    for (const id of ["a", "b", "c"]) {
      expect(placementFor(map, id).count).toBe(3);
      expect(placementFor(map, id).sumWidths).toBe(950);
      expect(placementFor(map, id).packFrom).toBe("left");
    }
  });

  test("each card carries the width of everything ahead of it", () => {
    const map = resolvePlacements("three-up", CHAIN, "right");
    expect(placementFor(map, "a").widthBefore).toBe(0);
    expect(placementFor(map, "b").widthBefore).toBe(400);
    expect(placementFor(map, "c").widthBefore).toBe(700);
  });

  test("an empty slot occupies nothing, so the chain closes up", () => {
    // Slot 1 is empty: slot 2's card takes the place slot 1's would have.
    const map = resolvePlacements(
      "three-up",
      [pane("a", 0, 400), pane("c", 2, 250)],
      "right",
    );
    expect(placementFor(map, "c").index).toBe(1);
    expect(placementFor(map, "c").widthBefore).toBe(400);
    expect(placementFor(map, "c").count).toBe(2);
  });

  test("a left-docked rail reverses the chain", () => {
    const map = resolvePlacements("three-up", CHAIN, "left");
    // Packing right: slot 2 is nearest the packing edge, so it leads.
    expect(placementFor(map, "c")).toEqual({
      slot: 2,
      packFrom: "right",
      count: 3,
      index: 0,
      sumWidths: 950,
      widthBefore: 0,
    });
    expect(placementFor(map, "b").index).toBe(1);
    expect(placementFor(map, "b").widthBefore).toBe(250);
    expect(placementFor(map, "a").index).toBe(2);
    expect(placementFor(map, "a").widthBefore).toBe(550);
  });

  test("a shared slot reserves its widest pane, so the chain does not jump", () => {
    // Both cards hold slot 0; the one behind is wider. Slot 1 clears the wider.
    const map = resolvePlacements(
      "two-up",
      [pane("wide", 0, 600), pane("narrow", 0, 300), pane("next", 1, 200)],
      "right",
    );
    expect(placementFor(map, "wide").widthBefore).toBe(0);
    expect(placementFor(map, "narrow").widthBefore).toBe(0);
    expect(placementFor(map, "next").widthBefore).toBe(600);
    expect(placementFor(map, "next").sumWidths).toBe(800);
  });

  test("free panes get no placement at all", () => {
    const map = resolvePlacements(
      "two-up",
      [pane("a", 0, 400), pane("free", undefined, 400)],
      "right",
    );
    expect(map.has("a")).toBe(true);
    expect(map.has("free")).toBe(false);
    expect(placementFor(map, "a").sumWidths).toBe(400);
  });

  test("an out-of-range slot clamps before it joins the chain", () => {
    const map = resolvePlacements(
      "two-up",
      [pane("a", 0, 400), pane("b", 9, 300)],
      "right",
    );
    expect(placementFor(map, "b").slot).toBe(1);
    expect(placementFor(map, "b").index).toBe(1);
  });

  test("two cards clamped onto one slot share its place", () => {
    const map = resolvePlacements(
      "two-up",
      [pane("a", 3, 400), pane("b", 9, 400)],
      "right",
    );
    expect(placementFor(map, "a")).toEqual(placementFor(map, "b"));
  });
});

describe("chainStep", () => {
  const step = (count: number, sumWidths: number, band: number): number =>
    chainStep(
      { slot: 0, packFrom: "left", count, index: 0, sumWidths, widthBefore: 0 },
      band,
    );

  test("a chain with room steps by exactly one gap", () => {
    expect(step(3, 950, 990)).toBe(GAP);
  });

  test("a lone card has no step at all", () => {
    expect(step(1, 400, 990)).toBe(0);
  });

  test("a chain with no room steps backward — the cards overlap", () => {
    // Three 500s in a 990 band: 510 too many, shared over two steps.
    expect(step(3, 1500, 990)).toBe(-255);
  });

  test("the step eases back to a gap as the band grows", () => {
    expect(step(2, 900, 900)).toBe(0);
    expect(step(2, 900, 903)).toBe(3);
    expect(step(2, 900, 905)).toBe(GAP);
    expect(step(2, 900, 2000)).toBe(GAP);
  });
});

describe("imposeRect", () => {
  /** The chain of `widths`, in slot order, packed away from `railSide`. */
  function chain(
    widths: readonly number[],
    railSide: "left" | "right" | null,
  ): Map<string, ImposedPlacement> {
    const kind = widths.length > 3 ? "four-up" : widths.length > 2 ? "three-up" : "two-up";
    return resolvePlacements(
      kind,
      widths.map((w, i) => pane(`p${i}`, i, w)),
      railSide,
    );
  }

  test("the chain starts a gap in from the span's near edge", () => {
    const map = chain([400, 300], "right");
    expect(imposeRect(placementFor(map, "p0"), 400, FULL).position.x).toBe(5);
  });

  test("cards with room stand exactly one gap apart", () => {
    const map = chain([400, 300], "right");
    const a = imposeRect(placementFor(map, "p0"), 400, FULL);
    const b = imposeRect(placementFor(map, "p1"), 300, FULL);
    expect(b.position.x - (a.position.x + a.size.width)).toBe(GAP);
  });

  test("all the slack pools between the last card and the Lens", () => {
    const map = chain([260, 180], "right");
    const b = imposeRect(placementFor(map, "p1"), 180, LENS_RIGHT);
    const bandFarEdge = LENS_RIGHT.x + LENS_RIGHT.width;
    const slack = bandFarEdge - (b.position.x + b.size.width);
    // Span 735, chain 260 + 5 + 180 = 445, one gap in from the left.
    expect(slack).toBe(735 - GAP - 445);
    expect(slack).toBeGreaterThan(GAP);
  });

  test("a chain with no room overlaps instead of running past the band", () => {
    // Three 500s in a 1000 span: 1510 of card in 990 of band.
    const map = chain([500, 500, 500], "right");
    const rects = [0, 1, 2].map((i) =>
      imposeRect(placementFor(map, `p${i}`), 500, FULL),
    );
    expect(rects.map((r) => r.position.x)).toEqual([5, 250, 495]);
    // Every overlap is the same size…
    const overlaps = [0, 1].map(
      (i) => rects[i].position.x + rects[i].size.width - rects[i + 1].position.x,
    );
    expect(overlaps).toEqual([255, 255]);
    // …no width was touched…
    for (const r of rects) expect(r.size.width).toBe(500);
    // …and the strip ends exactly on the band's far edge, never past it.
    const lastRect = rects[2];
    expect(lastRect.position.x + lastRect.size.width).toBe(FULL.width - GAP);
  });

  test("an overlapping chain never reaches under the rail", () => {
    const map = chain([500, 500, 500], "right");
    const lastRect = imposeRect(placementFor(map, "p2"), 500, LENS_RIGHT);
    const railInnerEdge = LENS_RIGHT.x + LENS_RIGHT.width;
    expect(lastRect.position.x + lastRect.size.width).toBe(railInnerEdge - GAP);
  });

  test("four-up overlaps the same way, sharing the crowding three ways", () => {
    const map = chain([500, 500, 500, 500], "right");
    const rects = [0, 1, 2, 3].map((i) =>
      imposeRect(placementFor(map, `p${i}`), 500, FULL),
    );
    const overlaps = [0, 1, 2].map(
      (i) => rects[i].position.x + rects[i].size.width - rects[i + 1].position.x,
    );
    // 2000 of card in a 990 band: 1010 over, shared across three steps.
    for (const o of overlaps) expect(o).toBeCloseTo(1010 / 3, 9);
    const lastRect = rects[3];
    expect(lastRect.position.x + lastRect.size.width).toBeCloseTo(
      FULL.width - GAP,
      9,
    );
  });

  test("a left-side Lens collects the slack on its own side", () => {
    // Packing right: slot 1 leads at the span's right edge, slot 0 chains back
    // toward the Lens, and whatever is left over sits between them and it.
    const map = chain([300, 300], "left");
    const a = imposeRect(placementFor(map, "p0"), 300, LENS_LEFT);
    const b = imposeRect(placementFor(map, "p1"), 300, LENS_LEFT);
    expect(b.position.x + b.size.width).toBe(995);
    expect(b.position.x - (a.position.x + a.size.width)).toBe(GAP);
    expect(a.position.x - LENS_LEFT.x).toBe(735 - GAP - 300 - GAP - 300);
  });

  test("a right-docked rail leaves the left-packed chain where it was", () => {
    // Packing runs away from the rail, so a rail on the right never moves the
    // chain — it only shrinks the slack that pools beside it.
    const map = chain([300, 300], "right");
    expect(imposeRect(placementFor(map, "p0"), 300, LENS_RIGHT).position.x).toBe(
      imposeRect(placementFor(map, "p0"), 300, FULL).position.x,
    );
  });

  test("a lone card wider than the band overhangs — there is nothing to overlap", () => {
    const map = chain([1400], "right");
    const rect = imposeRect(placementFor(map, "p0"), 1400, FULL);
    expect(rect.position.x).toBe(5);
    expect(rect.size.width).toBe(1400);
  });

  test("the run is the span height less the top gap and the deeper bottom", () => {
    const map = chain([321], "right");
    const rect = imposeRect(placementFor(map, "p0"), 321, LENS_LEFT);
    expect(rect.position.y).toBe(IMPOSITION_GAP_PX);
    expect(rect.size.height).toBe(
      LENS_LEFT.height - IMPOSITION_GAP_PX - IMPOSITION_GAP_BOTTOM_PX,
    );
  });

  test("width is a pass-through for every span", () => {
    for (const span of [FULL, LENS_LEFT, LENS_RIGHT]) {
      for (const w of [1, 120, 640, 4000]) {
        const map = chain([w], "right");
        expect(imposeRect(placementFor(map, "p0"), w, span).size.width).toBe(w);
      }
    }
  });
});

describe("imposeStyle", () => {
  const BAND =
    "(100% - var(--tug-imposer-inset-left, 0px)" +
    " - var(--tug-imposer-inset-right, 0px) - 5px * 2)";

  test("a left-packed pane pins its left edge against the left inset", () => {
    expect(
      imposeStyle(
        {
          slot: 1,
          packFrom: "left",
          count: 2,
          index: 1,
          sumWidths: 700,
          widthBefore: 400,
        },
        300,
        false,
      ),
    ).toEqual({
      width: "300px",
      height: "auto",
      top: "5px",
      bottom: "32px",
      left:
        "calc(var(--tug-imposer-inset-left, 0px) + 5px + 400px + 1 * " +
        `min(5px, ${BAND} / 1 - 700px))`,
    });
  });

  test("a right-packed pane pins its right edge against the right inset", () => {
    const style = imposeStyle(
      {
        slot: 0,
        packFrom: "right",
        count: 2,
        index: 1,
        sumWidths: 700,
        widthBefore: 300,
      },
      400,
      false,
    );
    expect(style.left).toBeUndefined();
    expect(style.right).toContain("var(--tug-imposer-inset-right, 0px) + 5px + 300px");
    expect(style.right).toContain("min(5px,");
  });

  test("the head of the chain needs no step term at all", () => {
    const style = imposeStyle(
      {
        slot: 0,
        packFrom: "left",
        count: 3,
        index: 0,
        sumWidths: 900,
        widthBefore: 0,
      },
      400,
      false,
    );
    expect(style.left).toBe("calc(var(--tug-imposer-inset-left, 0px) + 5px + 0px)");
  });

  test("a lone card carries no step, so no min() either", () => {
    const style = imposeStyle(
      {
        slot: 0,
        packFrom: "left",
        count: 1,
        index: 0,
        sumWidths: 400,
        widthBefore: 0,
      },
      400,
      false,
    );
    expect(style.left).not.toContain("min(");
  });

  test("no pane ever carries a transform or two horizontal pins", () => {
    for (const packFrom of ["left", "right"] as const) {
      const style = imposeStyle(
        { slot: 0, packFrom, count: 2, index: 1, sumWidths: 700, widthBefore: 400 },
        300,
        false,
      );
      expect(style.transform).toBeUndefined();
      expect(
        [style.left, style.right].filter((v) => v !== undefined),
      ).toHaveLength(1);
    }
  });

  test("collapsed releases the bottom pin and nothing else", () => {
    const collapsed = imposeStyle(
      { slot: 0, packFrom: "left", count: 1, index: 0, sumWidths: 640, widthBefore: 0 },
      640,
      true,
    );
    expect(collapsed).toEqual({
      width: "640px",
      height: "auto",
      top: "5px",
      left: "calc(var(--tug-imposer-inset-left, 0px) + 5px + 0px)",
    });
    expect(collapsed.bottom).toBeUndefined();
  });

  test("the width is always the pane's own, verbatim", () => {
    expect(
      imposeStyle(
        { slot: 0, packFrom: "left", count: 1, index: 0, sumWidths: 987, widthBefore: 0 },
        987,
        false,
      ).width,
    ).toBe("987px");
  });
});

describe("imposeLensStyle", () => {
  test("pins the Lens to its side, a gap in on three edges and deeper below", () => {
    expect(imposeLensStyle("right", 420, false)).toEqual({
      width: "420px",
      height: "auto",
      top: "5px",
      right: "5px",
      bottom: "32px",
    });
    expect(imposeLensStyle("left", 420, false)).toEqual({
      width: "420px",
      height: "auto",
      top: "5px",
      left: "5px",
      bottom: "32px",
    });
  });

  test("a collapsed Lens keeps its side and top pins and releases the bottom", () => {
    const collapsed = imposeLensStyle("right", 420, true);
    expect(collapsed.top).toBe("5px");
    expect(collapsed.right).toBe("5px");
    expect(collapsed.bottom).toBeUndefined();
  });

  test("the width is the pane's own, verbatim", () => {
    expect(imposeLensStyle("left", 987, false).width).toBe("987px");
  });
});

describe("the chain clears the Lens by exactly one gap", () => {
  // The derivation the pinned-Lens geometry rests on: with the Lens on the
  // right at width W, its near edge sits at `canvasW - GAP - W`, and the
  // chain's far card must land one gap short of that.
  const CANVAS = { width: 1000, height: 800 };

  for (const W of [260, 420, 500]) {
    test(`a ${W}px right-side Lens leaves the chain ending one gap off it`, () => {
      const span = resolveSpan(CANVAS, { side: "right", width: W });
      // One card wide enough to fill the band: its far edge is the chain's.
      const map = resolvePlacements("two-up", [pane("a", 0, 100)], "right");
      const rect = imposeRect(placementFor(map, "a"), span.width - GAP * 2, span);
      const chainFarEdge = rect.position.x + rect.size.width;
      const lensNearEdge = CANVAS.width - GAP - W;
      expect(chainFarEdge).toBe(lensNearEdge - GAP);
      expect(rect.position.x).toBe(GAP);
    });

    test(`a ${W}px left-side Lens leaves the chain starting one gap off it`, () => {
      const span = resolveSpan(CANVAS, { side: "left", width: W });
      const map = resolvePlacements("two-up", [pane("a", 0, 100)], "left");
      const rect = imposeRect(placementFor(map, "a"), span.width - GAP * 2, span);
      const lensFarEdge = GAP + W;
      expect(rect.position.x).toBe(lensFarEdge + GAP);
      expect(rect.position.x + rect.size.width).toBe(CANVAS.width - GAP);
    });
  }
});

describe("the CSS and numeric forms agree", () => {
  // The style's calc is what the browser evaluates. This reproduces it by hand
  // — including the `min()` that decides gap-or-overlap — and checks it lands
  // where `imposeRect` says it should.
  function evaluatePin(
    placement: ImposedPlacement,
    paneWidth: number,
    span: ImposerSpan,
    canvasWidth: number,
  ): number {
    const insetLeft = span.x;
    const insetRight = canvasWidth - span.x - span.width;
    const band = canvasWidth - insetLeft - insetRight - GAP * 2;
    const step =
      placement.count < 2
        ? 0
        : Math.min(GAP, band / (placement.count - 1) -
            placement.sumWidths / (placement.count - 1));
    const pin = GAP + placement.widthBefore + placement.index * step;
    if (placement.packFrom === "left") return insetLeft + pin;
    // A `right` pin measures from the canvas's right edge to the pane's right
    // edge, so the frame's left edge is that far in, less its own width.
    return canvasWidth - (insetRight + pin) - paneWidth;
  }

  const CASES: Array<[ImposerSpan, number, "left" | "right" | null]> = [
    [FULL, 1000, null],
    [LENS_RIGHT, 1000, "right"],
    [LENS_LEFT, 1000, "left"],
  ];

  test("a chain with room matches imposeRect everywhere", () => {
    const panes = [pane("a", 0, 300), pane("b", 1, 220), pane("c", 2, 260)];
    for (const [span, canvasWidth, railSide] of CASES) {
      const chain = resolvePlacements("three-up", panes, railSide);
      for (const p of panes) {
        const placement = placementFor(chain, p.id);
        expect(evaluatePin(placement, p.width, span, canvasWidth)).toBeCloseTo(
          imposeRect(placement, p.width, span).position.x,
          9,
        );
      }
    }
  });

  test("an overlapping chain matches imposeRect everywhere", () => {
    const panes = [pane("a", 0, 500), pane("b", 1, 500), pane("c", 2, 500)];
    for (const [span, canvasWidth, railSide] of CASES) {
      const chain = resolvePlacements("three-up", panes, railSide);
      for (const p of panes) {
        const placement = placementFor(chain, p.id);
        expect(evaluatePin(placement, p.width, span, canvasWidth)).toBeCloseTo(
          imposeRect(placement, p.width, span).position.x,
          9,
        );
      }
    }
  });
});
