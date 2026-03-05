import { describe, test, expect } from "bun:test";
import {
  type Rect,
  type SnapResult,
  type GuidePosition,
  type SharedEdge,
  type CardSet,
  type EdgeValidator,
  type Point,
  SNAP_THRESHOLD_PX,
  SNAP_VISIBILITY_THRESHOLD,
  computeSnap,
  computeResizeSnap,
  computeEdgeVisibility,
  findSharedEdges,
  computeSets,
  cardToRect,
  computeSetHullPolygon,
} from "../snap";
import type { CardState } from "../layout-tree";

// ---- cardToRect ----

describe("cardToRect", () => {
  test("converts CardState to Rect correctly", () => {
    const card: CardState = {
      id: "p1",
      position: { x: 10, y: 20 },
      size: { width: 200, height: 300 },
      tabs: [],
      activeTabId: "",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const rect = cardToRect(card);
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(20);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(300);
  });
});

// ---- SNAP_THRESHOLD_PX ----

describe("SNAP_THRESHOLD_PX", () => {
  test("is 8", () => {
    expect(SNAP_THRESHOLD_PX).toBe(8);
  });
});

// ---- computeSnap ----

describe("computeSnap", () => {
  // Acceptance criterion (a): moving card right edge within 8px of stationary left edge snaps to it.
  // Moving: x=200, width=200 → right edge at 400.
  // Stationary: x=405, width=200 → left edge at 405.
  // Distance = 5, within threshold. Snap x so right=405 → new x = 405 - 200 = 205.
  // Use y positions far apart so y does not snap (moving.bottom=300, stationary.top=500, dist=200).
  test("snaps x when moving right edge is within 8px of stationary left edge", () => {
    const moving: Rect = { x: 200, y: 0, width: 200, height: 300 };
    const stationary: Rect = { x: 405, y: 500, width: 200, height: 300 };

    const result = computeSnap(moving, [stationary]);

    expect(result.x).toBe(205); // 200 + (405 - 400) = 205
    expect(result.y).toBeNull();
    expect(result.guides.length).toBeGreaterThan(0);
    const xGuide = result.guides.find((g) => g.axis === "x");
    expect(xGuide).toBeDefined();
    expect(xGuide!.position).toBe(405);
  });

  // Acceptance criterion (b): beyond 8px → no snap.
  test("does not snap when moving card is beyond 8px", () => {
    const moving: Rect = { x: 200, y: 0, width: 200, height: 300 };
    // Nearest x edge: stationary.left = 420, moving.right = 400, distance = 20 > 8.
    // Nearest y edge: stationary.top = 500, moving.bottom = 300, distance = 200 > 8.
    const stationary: Rect = { x: 420, y: 500, width: 200, height: 300 };

    const result = computeSnap(moving, [stationary]);

    expect(result.x).toBeNull();
    expect(result.y).toBeNull();
    expect(result.guides).toEqual([]);
  });

  // Acceptance criterion (c): snap x and y independently when both within threshold.
  test("snaps x and y independently when both axes are within threshold", () => {
    // Moving rect at (100, 100), 200x200.
    // edges: left=100, right=300, top=100, bottom=300
    // Stationary rect: x=305 → left edge at 305 (dist from right = 5, within threshold)
    //                  y=94 → top edge at 94 (dist from top = 6, within threshold)
    const moving: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const stationary: Rect = { x: 305, y: 94, width: 200, height: 200 };

    const result = computeSnap(moving, [stationary]);

    // x: moving.right (300) vs stationary.left (305) → delta = 5 → new x = 105
    expect(result.x).toBe(105);
    // y: moving.top (100) vs stationary.top (94) → delta = -6 → new y = 94
    expect(result.y).toBe(94);

    const xGuide = result.guides.find((g) => g.axis === "x");
    const yGuide = result.guides.find((g) => g.axis === "y");
    expect(xGuide).toBeDefined();
    expect(yGuide).toBeDefined();
  });

  test("returns no snap when others array is empty", () => {
    const moving: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const result = computeSnap(moving, []);
    expect(result.x).toBeNull();
    expect(result.y).toBeNull();
    expect(result.guides).toEqual([]);
  });

  test("snaps to closest match when multiple candidates are within threshold", () => {
    const moving: Rect = { x: 200, y: 0, width: 200, height: 100 };
    // moving.right = 400
    // stationary A: left at 403 (dist=3)
    // stationary B: left at 407 (dist=7)
    const stationaryA: Rect = { x: 403, y: 0, width: 100, height: 100 };
    const stationaryB: Rect = { x: 407, y: 0, width: 100, height: 100 };

    const result = computeSnap(moving, [stationaryA, stationaryB]);

    // Should snap to 403 (dist=3 < dist=7)
    expect(result.x).toBe(203); // 200 + (403 - 400) = 203
  });

  // borderWidth overlap: adjacent edges should overlap by bw, not gap by bw.
  test("movingRight→otherLeft with borderWidth overlaps cards by bw (no gap)", () => {
    // Moving: x=200, width=200 → right edge at 400.
    // Stationary: x=402, width=200 → left edge at 402. dist=2 ≤ 8.
    // borderWidth=1: the snap should produce right=402, i.e. new x = 402-200+1 = 203
    // (overlap by 1px so borders collapse into a single visual line).
    const moving: Rect = { x: 200, y: 0, width: 200, height: 100 };
    const stationary: Rect = { x: 402, y: 0, width: 200, height: 100 };

    const result = computeSnap(moving, [stationary], undefined, 1);

    // delta = otherLeft - movingRight + bw = 402 - 400 + 1 = 3 → new x = 203
    expect(result.x).toBe(203);
  });

  test("movingLeft→otherRight with borderWidth overlaps cards by bw (no gap)", () => {
    // Moving: x=198, width=200 → left edge at 198.
    // Stationary: x=0, width=200 → right edge at 200. dist=2 ≤ 8.
    // borderWidth=1: snap produces left=200-1=199 → delta = 200-198-1=1 → new x=199
    const moving: Rect = { x: 198, y: 0, width: 200, height: 100 };
    const stationary: Rect = { x: 0, y: 0, width: 200, height: 100 };

    const result = computeSnap(moving, [stationary], undefined, 1);

    // delta = otherRight - movingLeft - bw = 200 - 198 - 1 = 1 → new x = 199
    expect(result.x).toBe(199);
  });

  test("movingBottom→otherTop with borderWidth overlaps cards by bw (no gap)", () => {
    // Moving: y=100, height=200 → bottom edge at 300.
    // Stationary: y=302 → top edge at 302. dist=2 ≤ 8.
    // borderWidth=1: delta = otherTop - movingBottom + bw = 302 - 300 + 1 = 3 → new y=103
    const moving: Rect = { x: 0, y: 100, width: 100, height: 200 };
    const stationary: Rect = { x: 0, y: 302, width: 100, height: 200 };

    const result = computeSnap(moving, [stationary], undefined, 1);

    expect(result.y).toBe(103);
  });

  test("movingTop→otherBottom with borderWidth overlaps cards by bw (no gap)", () => {
    // Moving: y=298, height=200 → top edge at 298.
    // Stationary: y=0, height=300 → bottom edge at 300. dist=2 ≤ 8.
    // borderWidth=1: delta = otherBottom - movingTop - bw = 300 - 298 - 1 = 1 → new y=299
    const moving: Rect = { x: 0, y: 298, width: 100, height: 200 };
    const stationary: Rect = { x: 0, y: 0, width: 100, height: 300 };

    const result = computeSnap(moving, [stationary], undefined, 1);

    expect(result.y).toBe(299);
  });
});

// ---- computeResizeSnap ----

describe("computeResizeSnap", () => {
  // Acceptance criterion (d): right edge at 398, other card left at 400 → snaps right to 400.
  test("snaps right edge to another card left edge within threshold", () => {
    const resizingEdges = { right: 398 };
    const other: Rect = { x: 400, y: 0, width: 200, height: 300 };

    const result = computeResizeSnap(resizingEdges, [other]);

    expect(result.right).toBe(400);
    expect(result.top).toBeUndefined();
    expect(result.left).toBeUndefined();
    expect(result.bottom).toBeUndefined();
    const xGuide = result.guides.find((g) => g.axis === "x");
    expect(xGuide).toBeDefined();
    expect(xGuide!.position).toBe(400);
  });

  test("does not snap right edge when beyond threshold", () => {
    const resizingEdges = { right: 380 };
    const other: Rect = { x: 400, y: 0, width: 200, height: 300 };

    const result = computeResizeSnap(resizingEdges, [other]);

    expect(result.right).toBeUndefined();
    expect(result.guides).toEqual([]);
  });

  test("snaps multiple edges independently", () => {
    // Resizing top and right simultaneously
    const resizingEdges = { top: 102, right: 398 };
    const other: Rect = { x: 400, y: 100, width: 200, height: 300 };

    const result = computeResizeSnap(resizingEdges, [other]);

    // top: 102 vs other.top 100 → dist=2 → snap to 100
    expect(result.top).toBe(100);
    // right: 398 vs other.left 400 → dist=2 → snap to 400
    expect(result.right).toBe(400);
  });

  test("snaps left edge to other card right edge", () => {
    const resizingEdges = { left: 203 };
    const other: Rect = { x: 0, y: 0, width: 200, height: 300 };
    // other.right = 200, dist from 203 = 3

    const result = computeResizeSnap(resizingEdges, [other]);

    expect(result.left).toBe(200);
  });

  test("returns empty when no edges provided", () => {
    const other: Rect = { x: 400, y: 0, width: 200, height: 300 };
    const result = computeResizeSnap({}, [other]);
    expect(result.left).toBeUndefined();
    expect(result.right).toBeUndefined();
    expect(result.top).toBeUndefined();
    expect(result.bottom).toBeUndefined();
    expect(result.guides).toEqual([]);
  });

  // borderWidth tests for resize snap (adjacent-edge overlap)
  test("resizing right toward other left with borderWidth overlaps by bw", () => {
    // Right edge at 398, other left at 400 (dist=2 ≤ 8), borderWidth=1
    // Adjacent-edge: rightSnapped = otherLeft + bw = 400 + 1 = 401
    const resizingEdges = { right: 398 };
    const other: Rect = { x: 400, y: 0, width: 200, height: 300 };

    const result = computeResizeSnap(resizingEdges, [other], 1);

    expect(result.right).toBe(401);
    // Guide should be at the other card's left edge (400), not the offset value
    const xGuide = result.guides.find((g) => g.axis === "x");
    expect(xGuide).toBeDefined();
    expect(xGuide!.position).toBe(400);
  });

  test("resizing right toward other right (same-edge) with borderWidth has no offset", () => {
    // Right edge at 398, other right at 400 (dist=2 ≤ 8), borderWidth=1
    // Same-edge: rightSnapped = otherRight = 400 (no offset)
    const resizingEdges = { right: 398 };
    const other: Rect = { x: 200, y: 0, width: 200, height: 300 };
    // other.right = 200+200 = 400

    const result = computeResizeSnap(resizingEdges, [other], 1);

    expect(result.right).toBe(400);
  });

  test("resizing left toward other right (adjacent-edge) with borderWidth overlaps by bw", () => {
    // Left edge at 202, other right at 200 (dist=2 ≤ 8), borderWidth=1
    // Adjacent-edge: leftSnapped = otherRight - bw = 200 - 1 = 199
    const resizingEdges = { left: 202 };
    const other: Rect = { x: 0, y: 0, width: 200, height: 300 };
    // other.right = 200

    const result = computeResizeSnap(resizingEdges, [other], 1);

    expect(result.left).toBe(199);
    const xGuide = result.guides.find((g) => g.axis === "x");
    expect(xGuide).toBeDefined();
    expect(xGuide!.position).toBe(200);
  });

  test("resizing bottom toward other top (adjacent-edge) with borderWidth overlaps by bw", () => {
    // Bottom edge at 398, other top at 400 (dist=2 ≤ 8), borderWidth=1
    // Adjacent-edge: bottomSnapped = otherTop + bw = 400 + 1 = 401
    const resizingEdges = { bottom: 398 };
    const other: Rect = { x: 0, y: 400, width: 200, height: 200 };

    const result = computeResizeSnap(resizingEdges, [other], 1);

    expect(result.bottom).toBe(401);
    const yGuide = result.guides.find((g) => g.axis === "y");
    expect(yGuide).toBeDefined();
    expect(yGuide!.position).toBe(400);
  });

  test("resizing top toward other bottom (adjacent-edge) with borderWidth overlaps by bw", () => {
    // Top edge at 202, other bottom at 200 (dist=2 ≤ 8), borderWidth=1
    // Adjacent-edge: topSnapped = otherBottom - bw = 200 - 1 = 199
    const resizingEdges = { top: 202 };
    const other: Rect = { x: 0, y: 0, width: 200, height: 200 };
    // other.bottom = 200

    const result = computeResizeSnap(resizingEdges, [other], 1);

    expect(result.top).toBe(199);
    const yGuide = result.guides.find((g) => g.axis === "y");
    expect(yGuide).toBeDefined();
    expect(yGuide!.position).toBe(200);
  });

  test("borderWidth=0 is identical to no borderWidth (backward compat)", () => {
    const resizingEdges = { right: 398 };
    const other: Rect = { x: 400, y: 0, width: 200, height: 300 };

    const withZero = computeResizeSnap(resizingEdges, [other], 0);
    const withoutBW = computeResizeSnap(resizingEdges, [other]);

    expect(withZero.right).toBe(withoutBW.right);
    expect(withZero.right).toBe(400);
  });
});

// ---- findSharedEdges ----

describe("findSharedEdges", () => {
  // Acceptance criterion (e): A at (0,0,200,300), B at (200,50,200,300) → vertical shared edge.
  // A.right = 200, B.left = 200 → exact alignment (dist=0). Overlap: max(0,50)=50..min(300,350)=300.
  test("detects vertical shared edge when A.right == B.left with overlap", () => {
    const cards = [
      { id: "a", rect: { x: 0, y: 0, width: 200, height: 300 } },
      { id: "b", rect: { x: 200, y: 50, width: 200, height: 300 } },
    ];

    const edges = findSharedEdges(cards);

    // Should find at least one vertical edge between A and B
    const vertEdge = edges.find(
      (e) => e.axis === "vertical" && e.cardAId === "a" && e.cardBId === "b"
    );
    expect(vertEdge).toBeDefined();
    expect(vertEdge!.overlapStart).toBe(50);
    expect(vertEdge!.overlapEnd).toBe(300);
    expect(vertEdge!.boundaryPosition).toBe(200); // (200+200)/2
  });

  // Acceptance criterion (f): A at (0,0,200,300), B at (50,300,200,300) → horizontal shared edge.
  // A.bottom = 300, B.top = 300 → exact alignment. Overlap: max(0,50)=50..min(200,250)=200.
  test("detects horizontal shared edge when A.bottom == B.top with overlap", () => {
    const cards = [
      { id: "a", rect: { x: 0, y: 0, width: 200, height: 300 } },
      { id: "b", rect: { x: 50, y: 300, width: 200, height: 300 } },
    ];

    const edges = findSharedEdges(cards);

    const horizEdge = edges.find(
      (e) => e.axis === "horizontal" && e.cardAId === "a" && e.cardBId === "b"
    );
    expect(horizEdge).toBeDefined();
    expect(horizEdge!.overlapStart).toBe(50);
    expect(horizEdge!.overlapEnd).toBe(200);
    expect(horizEdge!.boundaryPosition).toBe(300); // (300+300)/2
  });

  // Acceptance criterion (g): A at (0,0,200,200), B at (200,300,200,200) → edges align (A.right=200=B.left)
  // but no vertical overlap → empty.
  test("returns empty when edges align but cards have no perpendicular overlap", () => {
    const cards = [
      { id: "a", rect: { x: 0, y: 0, width: 200, height: 200 } },
      { id: "b", rect: { x: 200, y: 300, width: 200, height: 200 } },
    ];
    // A: top=0, bottom=200; B: top=300, bottom=500
    // Overlap: max(0,300)=300..min(200,500)=200 → 300 >= 200 → no overlap

    const edges = findSharedEdges(cards);

    const vertEdge = edges.find((e) => e.axis === "vertical");
    expect(vertEdge).toBeUndefined();
    expect(edges.length).toBe(0);
  });

  // Acceptance criterion (h): A at (0,0,200,300), B at (205,50,200,300) → gap of 5px (within 8px) → detected.
  test("detects vertical shared edge within 8px gap tolerance", () => {
    const cards = [
      { id: "a", rect: { x: 0, y: 0, width: 200, height: 300 } },
      { id: "b", rect: { x: 205, y: 50, width: 200, height: 300 } },
    ];
    // A.right = 200, B.left = 205 → dist=5 <= 8

    const edges = findSharedEdges(cards);

    const vertEdge = edges.find(
      (e) => e.axis === "vertical" && e.cardAId === "a" && e.cardBId === "b"
    );
    expect(vertEdge).toBeDefined();
    expect(vertEdge!.overlapStart).toBe(50);
    expect(vertEdge!.overlapEnd).toBe(300);
    expect(vertEdge!.boundaryPosition).toBe(202.5); // (200+205)/2
  });

  test("returns empty for two cards with no edge proximity", () => {
    const cards = [
      { id: "a", rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "b", rect: { x: 500, y: 500, width: 100, height: 100 } },
    ];

    const edges = findSharedEdges(cards);
    expect(edges.length).toBe(0);
  });

  test("returns empty for single card", () => {
    const cards = [{ id: "a", rect: { x: 0, y: 0, width: 200, height: 200 } }];
    const edges = findSharedEdges(cards);
    expect(edges.length).toBe(0);
  });

  test("returns empty for zero cards", () => {
    const edges = findSharedEdges([]);
    expect(edges.length).toBe(0);
  });
});

// ---- computeSets ----

describe("computeSets", () => {
  // Acceptance criterion (i): two cards sharing an edge → one set with both IDs.
  test("groups two cards sharing an edge into one set", () => {
    const cardIds = ["a", "b"];
    const sharedEdge: SharedEdge = {
      cardAId: "a",
      cardBId: "b",
      axis: "vertical",
      overlapStart: 0,
      overlapEnd: 100,
      boundaryPosition: 200,
    };

    const sets = computeSets(cardIds, [sharedEdge]);

    expect(sets.length).toBe(1);
    expect(sets[0].cardIds.sort()).toEqual(["a", "b"]);
  });

  // Acceptance criterion (j): two groups of 2 cards, not connected → two separate sets.
  test("returns separate sets for disconnected groups", () => {
    const cardIds = ["a", "b", "c", "d"];
    const sharedEdges: SharedEdge[] = [
      {
        cardAId: "a",
        cardBId: "b",
        axis: "vertical",
        overlapStart: 0,
        overlapEnd: 100,
        boundaryPosition: 200,
      },
      {
        cardAId: "c",
        cardBId: "d",
        axis: "horizontal",
        overlapStart: 0,
        overlapEnd: 100,
        boundaryPosition: 300,
      },
    ];

    const sets = computeSets(cardIds, sharedEdges);

    expect(sets.length).toBe(2);
    const allIds = sets.flatMap((s) => s.cardIds).sort();
    expect(allIds).toEqual(["a", "b", "c", "d"]);
  });

  // Acceptance criterion (k): no shared edges → empty array.
  test("returns empty array for cards with no shared edges", () => {
    const cardIds = ["a", "b", "c"];
    const sets = computeSets(cardIds, []);
    expect(sets).toEqual([]);
  });

  test("handles three cards all connected in a chain", () => {
    const cardIds = ["a", "b", "c"];
    const sharedEdges: SharedEdge[] = [
      {
        cardAId: "a",
        cardBId: "b",
        axis: "vertical",
        overlapStart: 0,
        overlapEnd: 100,
        boundaryPosition: 200,
      },
      {
        cardAId: "b",
        cardBId: "c",
        axis: "vertical",
        overlapStart: 0,
        overlapEnd: 100,
        boundaryPosition: 400,
      },
    ];

    const sets = computeSets(cardIds, sharedEdges);

    expect(sets.length).toBe(1);
    expect(sets[0].cardIds.sort()).toEqual(["a", "b", "c"]);
  });

  test("singletons do not appear in output", () => {
    // "c" has no shared edges
    const cardIds = ["a", "b", "c"];
    const sharedEdges: SharedEdge[] = [
      {
        cardAId: "a",
        cardBId: "b",
        axis: "vertical",
        overlapStart: 0,
        overlapEnd: 100,
        boundaryPosition: 200,
      },
    ];

    const sets = computeSets(cardIds, sharedEdges);

    expect(sets.length).toBe(1);
    expect(sets[0].cardIds.sort()).toEqual(["a", "b"]);
    // "c" is not in any set
    const allIds = sets.flatMap((s) => s.cardIds);
    expect(allIds.includes("c")).toBe(false);
  });

  test("handles empty cardIds", () => {
    const sets = computeSets([], []);
    expect(sets).toEqual([]);
  });
});

// ---- SNAP_VISIBILITY_THRESHOLD ----

describe("SNAP_VISIBILITY_THRESHOLD", () => {
  test("is 0.3 (permissive edge visibility)", () => {
    expect(SNAP_VISIBILITY_THRESHOLD).toBe(0.3);
  });
});

// ---- computeEdgeVisibility ----

describe("computeEdgeVisibility", () => {
  test("returns 1.0 when no occluders", () => {
    const visibility = computeEdgeVisibility(200, 0, 300, true, []);
    expect(visibility).toBe(1.0);
  });

  test("returns 1.0 when occluder does not straddle the edge", () => {
    // Vertical edge at x=200, range y=[0,300]
    // Occluder at x=250..450 — entirely to the right, doesn't straddle x=200
    const occluder: Rect = { x: 250, y: 0, width: 200, height: 300 };
    const visibility = computeEdgeVisibility(200, 0, 300, true, [occluder]);
    expect(visibility).toBe(1.0);
  });

  test("returns 0.0 when occluder fully covers the edge range", () => {
    // Vertical edge at x=200, range y=[0,300]
    // Occluder at x=100..400 (straddles x=200), y=0..300 (full coverage)
    const occluder: Rect = { x: 100, y: 0, width: 300, height: 300 };
    const visibility = computeEdgeVisibility(200, 0, 300, true, [occluder]);
    expect(visibility).toBe(0.0);
  });

  test("returns partial visibility when occluder covers half the range", () => {
    // Vertical edge at x=200, range y=[0,300]
    // Occluder at x=100..400, y=0..150 (covers top half)
    const occluder: Rect = { x: 100, y: 0, width: 300, height: 150 };
    const visibility = computeEdgeVisibility(200, 0, 300, true, [occluder]);
    expect(visibility).toBeCloseTo(0.5, 5);
  });

  test("merges overlapping occluder ranges", () => {
    // Vertical edge at x=200, range y=[0,300]
    // Occluder A: y=0..200, Occluder B: y=100..300 — merged covers 0..300
    const occA: Rect = { x: 100, y: 0, width: 200, height: 200 };
    const occB: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const visibility = computeEdgeVisibility(200, 0, 300, true, [occA, occB]);
    expect(visibility).toBe(0.0);
  });

  test("works for horizontal edges", () => {
    // Horizontal edge at y=200, range x=[0,400]
    // Occluder at y=100..300 (straddles y=200), x=0..200 (covers left half)
    const occluder: Rect = { x: 0, y: 100, width: 200, height: 200 };
    const visibility = computeEdgeVisibility(200, 0, 400, false, [occluder]);
    expect(visibility).toBeCloseTo(0.5, 5);
  });

  test("returns 0 for zero-length range", () => {
    const visibility = computeEdgeVisibility(200, 100, 100, true, []);
    expect(visibility).toBe(0);
  });
});

// ---- computeSetHullPolygon ----

// Helper: compute twice the signed area using the shoelace formula.
// In screen coords (y-down): negative = clockwise, positive = counterclockwise.
// The spec requires clockwise ordering, so we check area < 0.
function signedArea(pts: Point[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += (b.x - a.x) * (b.y + a.y);
  }
  return area; // negative = clockwise in screen/canvas coords (y-down)
}

function isClockwise(pts: Point[]): boolean {
  return signedArea(pts) < 0;
}

describe("computeSetHullPolygon", () => {
  // Empty input → empty array [D06]
  test("returns empty array for empty input", () => {
    const result = computeSetHullPolygon([]);
    expect(result).toEqual([]);
  });

  // Single zero-area rect → empty array [D06]
  test("returns empty array for single zero-area rect (zero width)", () => {
    const result = computeSetHullPolygon([{ x: 0, y: 0, width: 0, height: 100 }]);
    expect(result).toEqual([]);
  });

  test("returns empty array for single zero-area rect (zero height)", () => {
    const result = computeSetHullPolygon([{ x: 0, y: 0, width: 100, height: 0 }]);
    expect(result).toEqual([]);
  });

  // Single rectangle → 4 corners [Spec S02 worked example]
  test("returns 4-vertex polygon for a single rectangle", () => {
    const rect: Rect = { x: 10, y: 20, width: 100, height: 50 };
    const result = computeSetHullPolygon([rect]);
    expect(result.length).toBe(4);
    // All corners should be present (in some order)
    const expected = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ];
    for (const exp of expected) {
      expect(result.some((p) => p.x === exp.x && p.y === exp.y)).toBe(true);
    }
    // Clockwise winding (positive signed area in screen/y-down coords)
    expect(isClockwise(result)).toBe(true);
  });

  // Two rectangles side by side (horizontal) → 4 corners of bounding box
  test("returns 4-vertex polygon for two horizontally adjacent rectangles", () => {
    // Rect A: (0,0,100,50), Rect B: (100,0,100,50) — exactly touching
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 100, y: 0, width: 100, height: 50 },
    ];
    const result = computeSetHullPolygon(rects);
    expect(result.length).toBe(4);
    // Should be the merged bounding box: (0,0) to (200,50)
    const expected = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 50 },
      { x: 0, y: 50 },
    ];
    for (const exp of expected) {
      expect(result.some((p) => p.x === exp.x && p.y === exp.y)).toBe(true);
    }
    expect(isClockwise(result)).toBe(true);
  });

  // Two rectangles stacked (vertical) → 4 corners of combined bounding box
  test("returns 4-vertex polygon for two vertically stacked rectangles", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 0, y: 50, width: 100, height: 50 },
    ];
    const result = computeSetHullPolygon(rects);
    expect(result.length).toBe(4);
    const expected = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    for (const exp of expected) {
      expect(result.some((p) => p.x === exp.x && p.y === exp.y)).toBe(true);
    }
    expect(isClockwise(result)).toBe(true);
  });

  // L-shape: 3 rectangles forming an L → 6 vertices
  // Layout: two rects forming a 2×1 horizontal strip on top, one rect below-left
  //   [A][B]
  //   [C]
  // A: (0,0,100,100), B: (100,0,100,100), C: (0,100,100,100)
  test("returns 6-vertex polygon for L-shape (3 rectangles)", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },   // A: top-left
      { x: 100, y: 0, width: 100, height: 100 },  // B: top-right
      { x: 0, y: 100, width: 100, height: 100 },  // C: bottom-left
    ];
    const result = computeSetHullPolygon(rects);
    expect(result.length).toBe(6);
    // Must include the concave corner at (100, 100) and (100, 200) is NOT there
    // The concave inner corner is at (100, 100)
    const hasInnerCorner = result.some((p) => p.x === 100 && p.y === 100);
    expect(hasInnerCorner).toBe(true);
    expect(isClockwise(result)).toBe(true);
  });

  // T-shape: 3 rects with one centered on top of two side by side → 8 vertices
  // Layout:
  //    [B]
  //  [A][C]
  // A: (0,100,100,100), B: (100,0,100,100), C: (200,100,100,100)  — T upside down
  // Actually let's do a proper T: one on top spanning full width...
  // Simpler T: top rect spans 2 cells wide, two rects below on the sides
  // [A A]     top: (0,0,200,100)
  // [B][C]    bottom-left: (0,100,100,100), bottom-right: (100,100,100,100)
  // That's just 3 stacked → 4 vertices. We need a T where one arm sticks out.
  // True T-shape:
  //   [B]          B: (50,0,100,100)   — top stem
  //  [A][C]        A: (0,100,100,100), C: (100,100,100,100)  — horizontal bar
  // This gives 8 vertices
  test("returns 8-vertex polygon for T-shape (3 rectangles)", () => {
    const rects: Rect[] = [
      { x: 0, y: 100, width: 100, height: 100 },   // A: bottom-left
      { x: 50, y: 0, width: 100, height: 100 },    // B: top center (stem of T)
      { x: 100, y: 100, width: 100, height: 100 }, // C: bottom-right
    ];
    const result = computeSetHullPolygon(rects);
    expect(result.length).toBe(8);
    expect(isClockwise(result)).toBe(true);
  });

  // Staircase: 3 rects in a diagonal staircase pattern
  // [A]
  //   [B]
  //     [C]
  // A: (0,0,100,100), B: (100,100,100,100), C: (200,200,100,100)
  test("returns polygon tracing the staircase outline for staircase shape", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 100, y: 100, width: 100, height: 100 },
      { x: 200, y: 200, width: 100, height: 100 },
    ];
    const result = computeSetHullPolygon(rects);
    // Staircase with 3 steps has 12 vertices (4 corners per rect minus 2 shared corners × 3...
    // actually 4*3=12 minus collinear reductions; with no collinear vertices it's 12)
    expect(result.length).toBeGreaterThan(6);
    expect(isClockwise(result)).toBe(true);
    // All rect corners should appear in the polygon
    const allCorners = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 200, y: 100 }, { x: 200, y: 200 },
      { x: 300, y: 200 }, { x: 300, y: 300 },
      { x: 200, y: 300 }, { x: 100, y: 200 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    for (const c of allCorners) {
      expect(result.some((p) => p.x === c.x && p.y === c.y)).toBe(true);
    }
  });

  // Overlapping rectangles → merged correctly, hull of union
  test("handles overlapping rectangles by merging them", () => {
    // Two overlapping rects → hull should be bounding box (or close to it)
    const rects: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 },
    ];
    const result = computeSetHullPolygon(rects);
    // The union is an L-shape (neither axis-aligned merge)
    // It should have more than 4 corners since it's not a simple rectangle
    expect(result.length).toBeGreaterThan(0);
    expect(isClockwise(result)).toBe(true);
    // The bounding box corners must be present
    expect(result.some((p) => p.x === 0 && p.y === 0)).toBe(true);
    expect(result.some((p) => p.x === 150 && p.y === 150)).toBe(true);
  });
});

// ---- computeSnap with EdgeValidator ----

describe("computeSnap with EdgeValidator", () => {
  test("validator can reject a snap candidate", () => {
    const moving: Rect = { x: 200, y: 0, width: 200, height: 300 };
    // Stationary left edge at 405, within threshold of moving right (400)
    const stationary: Rect = { x: 405, y: 0, width: 200, height: 300 };

    // Validator rejects all x-axis snaps
    const validate: EdgeValidator = (axis) => axis !== "x";

    const result = computeSnap(moving, [stationary], validate);
    expect(result.x).toBeNull();
  });

  test("validator allows snap when returning true", () => {
    const moving: Rect = { x: 200, y: 0, width: 200, height: 300 };
    const stationary: Rect = { x: 405, y: 0, width: 200, height: 300 };

    const validate: EdgeValidator = () => true;

    const result = computeSnap(moving, [stationary], validate);
    expect(result.x).toBe(205);
  });

  test("falls back to second-best snap when best is rejected", () => {
    const moving: Rect = { x: 200, y: 0, width: 200, height: 100 };
    // moving.right = 400
    // A: left at 403 (dist=3, closer) — will be rejected
    // B: left at 407 (dist=7, farther) — will be accepted
    const stationaryA: Rect = { x: 403, y: 0, width: 100, height: 100 };
    const stationaryB: Rect = { x: 407, y: 0, width: 100, height: 100 };

    // Reject snaps to target index 0 (A)
    const validate: EdgeValidator = (_axis, _pos, _rect, idx) => idx !== 0;

    const result = computeSnap(moving, [stationaryA, stationaryB], validate);
    expect(result.x).toBe(207); // snapped to B (407 - 200 = 207)
  });

  test("no validator means all snaps accepted (backward compat)", () => {
    const moving: Rect = { x: 200, y: 0, width: 200, height: 300 };
    const stationary: Rect = { x: 405, y: 500, width: 200, height: 300 };

    const result = computeSnap(moving, [stationary]);
    expect(result.x).toBe(205);
  });
});
