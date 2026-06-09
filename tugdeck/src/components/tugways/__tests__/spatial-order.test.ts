/**
 * spatial-order — pure-logic tests for the spatial arrow-navigation resolver.
 *
 * Data-in / data-out over `resolveSpatial`: (order, node, direction, cursorIndex) →
 * resolution. No DOM, no manager. These pin the model the navigator graduates onto the
 * per-card `FocusContext`: navigator-over-key-views with a selection group as ONE ring
 * node whose internal axis delegates to its cursor, and the group boundary a seam.
 *
 * The fixture is the motivating PermissionDialog reduced to its skeleton: a `[Deny,
 * Allow]` button row (a closed horizontal ring) and a two-option scope group reached by
 * a seam below `Allow`. The reported bug — Left from `Allow` lands on `Deny` — is the
 * first assertion.
 */

import { describe, expect, test } from "bun:test";

import {
  arrowDirection,
  oppositeDirection,
  resolveSpatial,
  rowGridOrder,
  type SpatialOrder,
} from "../spatial-order";

// The PermissionDialog skeleton. The scope group is a single ring node ("Scope") whose
// two options are CURSOR positions, not ring nodes — the headline-question model.
const dialog: SpatialOrder = {
  rings: [{ axis: "horizontal", nodes: ["Deny", "Allow"], closed: true }],
  groups: [{ node: "Scope", length: 2 }],
  seams: [
    { from: "Allow", direction: "down", to: "Scope" },
    { from: "Scope", direction: "up", to: "Allow" },
  ],
  overrides: [{ from: "Deny", direction: "down", to: "Scope" }],
};

describe("resolveSpatial — the reported case", () => {
  test("Left from Allow lands on Deny (the motivating bug)", () => {
    expect(resolveSpatial(dialog, "Allow", "left")).toEqual({
      kind: "ring",
      target: "Deny",
    });
  });
});

describe("resolveSpatial — closed-ring never-beep + reversibility", () => {
  test("a closed ring always yields a next node at both edges", () => {
    // Right from the last node wraps to the first; Left from the first wraps to the last.
    expect(resolveSpatial(dialog, "Allow", "right")).toEqual({ kind: "ring", target: "Deny" });
    expect(resolveSpatial(dialog, "Deny", "left")).toEqual({ kind: "ring", target: "Allow" });
    // Never `none` for a node that sits on a closed ring along the arrow's axis.
    for (const node of ["Deny", "Allow"]) {
      for (const dir of ["left", "right"] as const) {
        expect(resolveSpatial(dialog, node, dir).kind).toBe("ring");
      }
    }
  });

  test("the button ring reverses — Left then Right returns", () => {
    const left = resolveSpatial(dialog, "Allow", "left");
    expect(left).toEqual({ kind: "ring", target: "Deny" });
    if (left.kind !== "ring") throw new Error("unreachable");
    expect(resolveSpatial(dialog, left.target, oppositeDirection("left"))).toEqual({
      kind: "ring",
      target: "Allow",
    });
  });
});

describe("resolveSpatial — group cursor delegation (the headline model)", () => {
  test("any in-bounds arrow moves the 1D cursor (both axes rove)", () => {
    // down / right → next; up / left → previous — matching the group's existing
    // both-axes roving (the cursor is 1D, not axis-locked).
    expect(resolveSpatial(dialog, "Scope", "down", 0)).toEqual({ kind: "cursor", delta: 1 });
    expect(resolveSpatial(dialog, "Scope", "right", 0)).toEqual({ kind: "cursor", delta: 1 });
    expect(resolveSpatial(dialog, "Scope", "up", 1)).toEqual({ kind: "cursor", delta: -1 });
    expect(resolveSpatial(dialog, "Scope", "left", 1)).toEqual({ kind: "cursor", delta: -1 });
  });

  test("an arrow off the group edge crosses the seam to the next key view", () => {
    // Cursor at the top option, Up → off the start → leave via the seam to Allow.
    expect(resolveSpatial(dialog, "Scope", "up", 0)).toEqual({ kind: "ring", target: "Allow" });
  });

  test("entering the group and stepping back up to Allow round-trips", () => {
    // Allow --down--> Scope (lands on its current selection), then --up at top--> Allow.
    expect(resolveSpatial(dialog, "Allow", "down")).toEqual({ kind: "ring", target: "Scope" });
    expect(resolveSpatial(dialog, "Scope", "up", 0)).toEqual({ kind: "ring", target: "Allow" });
  });

  test("an off-the-edge arrow with no seam is a dead arrow (warn, never a beep)", () => {
    // Cursor at the bottom option: Down (and Right) run off the end with no seam, and
    // Scope is on no ring → none. The navigator clamps the group cursor and warns at
    // dev time; it never beeps.
    expect(resolveSpatial(dialog, "Scope", "down", 1)).toEqual({ kind: "none" });
    expect(resolveSpatial(dialog, "Scope", "right", 1)).toEqual({ kind: "none" });
    // Off the start with no left/seam declared (only Up is seamed) → none.
    expect(resolveSpatial(dialog, "Scope", "left", 0)).toEqual({ kind: "none" });
  });
});

describe("resolveSpatial — override precedence (the escape hatch)", () => {
  test("a per-node override wins over rings and seams", () => {
    // Deny sits on no vertical ring and has no down-seam; the override supplies Down.
    expect(resolveSpatial(dialog, "Deny", "down")).toEqual({ kind: "ring", target: "Scope" });
  });

  test("without the override the same arrow is a dead arrow", () => {
    const noOverride: SpatialOrder = { ...dialog, overrides: [] };
    expect(resolveSpatial(noOverride, "Deny", "down")).toEqual({ kind: "none" });
  });
});

describe("resolveSpatial — open-ring edge", () => {
  test("an open ring at its edge with no seam is a dead arrow", () => {
    const open: SpatialOrder = {
      rings: [{ axis: "horizontal", nodes: ["A", "B"], closed: false }],
    };
    expect(resolveSpatial(open, "A", "right")).toEqual({ kind: "ring", target: "B" });
    expect(resolveSpatial(open, "B", "right")).toEqual({ kind: "none" });
    expect(resolveSpatial(open, "A", "left")).toEqual({ kind: "none" });
  });
});

describe("rowGridOrder — stacked control rows", () => {
  test("a closed horizontal ring per multi-node row; none for a lone node", () => {
    const order = rowGridOrder([["Cancel", "Submit"], ["Options"]]);
    expect(order.rings).toEqual([
      { axis: "horizontal", nodes: ["Cancel", "Submit"], closed: true },
    ]);
    // Left / Right swap within the button row, wrapping.
    expect(resolveSpatial(order, "Cancel", "right")).toEqual({
      kind: "ring",
      target: "Submit",
    });
    expect(resolveSpatial(order, "Submit", "right")).toEqual({
      kind: "ring",
      target: "Cancel",
    });
  });

  test("a vertical seam cycle: every member drops to the next row, loops at the edge", () => {
    const order = rowGridOrder([
      ["Cancel", "Submit"],
      ["Back", "Next"],
      ["Options"],
    ]);
    // Down from a top-row member enters the next row at its first member.
    expect(resolveSpatial(order, "Cancel", "down")).toEqual({
      kind: "ring",
      target: "Back",
    });
    expect(resolveSpatial(order, "Submit", "down")).toEqual({
      kind: "ring",
      target: "Back",
    });
    // Down from the nav row enters the options row.
    expect(resolveSpatial(order, "Next", "down")).toEqual({
      kind: "ring",
      target: "Options",
    });
    // The bottom row loops back to the top (after its cursor edge, for a group).
    expect(resolveSpatial(order, "Options", "down")).toEqual({
      kind: "ring",
      target: "Cancel",
    });
    // Up reverses, and the top row loops to the bottom.
    expect(resolveSpatial(order, "Options", "up")).toEqual({
      kind: "ring",
      target: "Back",
    });
    expect(resolveSpatial(order, "Cancel", "up")).toEqual({
      kind: "ring",
      target: "Options",
    });
  });

  test("empty rows drop out so a fixed-shape grid tracks dynamic membership", () => {
    // Single-question state: no wizard-nav row, Submit not yet enabled.
    const order = rowGridOrder([["Cancel"], [], ["Options"]]);
    expect(order.rings).toEqual([]); // both present rows are single-node
    expect(resolveSpatial(order, "Cancel", "down")).toEqual({
      kind: "ring",
      target: "Options",
    });
    expect(resolveSpatial(order, "Options", "up")).toEqual({
      kind: "ring",
      target: "Cancel",
    });
  });

  test("a single present row yields no seams (liveliness backstops its edges)", () => {
    const order = rowGridOrder([["Dismiss"], [], []]);
    expect(order.rings).toEqual([]);
    expect(order.seams).toEqual([]);
    // No declared move — the navigator's linear fallback consumes the arrow.
    expect(resolveSpatial(order, "Dismiss", "down")).toEqual({ kind: "none" });
  });
});

describe("arrowDirection / oppositeDirection", () => {
  test("maps the four arrow keys and rejects others", () => {
    expect(arrowDirection("ArrowUp")).toBe("up");
    expect(arrowDirection("ArrowDown")).toBe("down");
    expect(arrowDirection("ArrowLeft")).toBe("left");
    expect(arrowDirection("ArrowRight")).toBe("right");
    expect(arrowDirection("Enter")).toBeNull();
    expect(arrowDirection(" ")).toBeNull();
  });

  test("opposite is an involution", () => {
    for (const dir of ["up", "down", "left", "right"] as const) {
      expect(oppositeDirection(oppositeDirection(dir))).toBe(dir);
    }
  });
});
