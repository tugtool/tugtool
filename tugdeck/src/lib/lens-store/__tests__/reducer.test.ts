/**
 * Pure-logic tests for the Lens store reducer. Covers width clamp,
 * section-order replace, collapsed membership toggles, and
 * hydrate — including the "no-op events return same state reference"
 * contract required by `useSyncExternalStore` for quiescent subscribers.
 */

import { describe, it, expect } from "bun:test";

import {
  createInitialState,
  reduce,
  toSnapshot,
  type LensState,
} from "@/lib/lens-store/reducer";

function fresh(): LensState {
  return createInitialState();
}

describe("LensStore reducer — set_width", () => {
  it("clamps below the floor up to MIN_LENS_WIDTH_PX", () => {
    const next = reduce(fresh(), { type: "set_width", widthPx: 100 });
    expect(next.widthPx).toBe(320);
  });
  it("accepts widths above the floor", () => {
    const next = reduce(fresh(), { type: "set_width", widthPx: 700 });
    expect(next.widthPx).toBe(700);
  });
  it("same width is a no-op (same-ref)", () => {
    const s = fresh();
    expect(reduce(s, { type: "set_width", widthPx: s.widthPx })).toBe(s);
  });
  it("rejects non-finite values (falls back to default)", () => {
    const next = reduce(fresh(), { type: "set_width", widthPx: Number.NaN });
    expect(next.widthPx).toBe(420);
  });
});

describe("LensStore reducer — set_section_order", () => {
  it("replaces the order", () => {
    const next = reduce(fresh(), {
      type: "set_section_order",
      order: ["telemetry", "log"],
    });
    expect(next.sectionOrder).toEqual(["telemetry", "log"]);
  });
  it("equal order is a no-op (same-ref)", () => {
    const s = reduce(fresh(), {
      type: "set_section_order",
      order: ["log", "telemetry"],
    });
    expect(
      reduce(s, { type: "set_section_order", order: ["log", "telemetry"] }),
    ).toBe(s);
  });
  it("copies the input array (no aliasing)", () => {
    const input = ["log"];
    const next = reduce(fresh(), { type: "set_section_order", order: input });
    input.push("telemetry");
    expect(next.sectionOrder).toEqual(["log"]);
  });
});

describe("LensStore reducer — set_collapsed", () => {
  it("adds and removes collapse membership", () => {
    const a = reduce(fresh(), {
      type: "set_collapsed",
      kind: "telemetry",
      collapsed: true,
    });
    expect(a.collapsedSections).toEqual(["telemetry"]);
    const b = reduce(a, {
      type: "set_collapsed",
      kind: "telemetry",
      collapsed: false,
    });
    expect(b.collapsedSections).toEqual([]);
  });
  it("idempotent collapse is a no-op (same-ref)", () => {
    const a = reduce(fresh(), {
      type: "set_collapsed",
      kind: "telemetry",
      collapsed: true,
    });
    expect(
      reduce(a, { type: "set_collapsed", kind: "telemetry", collapsed: true }),
    ).toBe(a);
  });
});

describe("LensStore reducer — hydrate", () => {
  it("missing fields keep the existing in-state value (same-ref)", () => {
    const seeded: LensState = {
      widthPx: 500,
      sectionOrder: ["log"],
      collapsedSections: ["log"],
      anchorSide: "right",
    };
    expect(reduce(seeded, { type: "hydrate" })).toBe(seeded);
  });
  it("applies width + sectionOrder + collapsedSections", () => {
    const next = reduce(fresh(), {
      type: "hydrate",
      widthPx: 600,
      sectionOrder: ["telemetry", "log"],
      collapsedSections: ["log"],
    });
    expect(next.widthPx).toBe(600);
    expect(next.sectionOrder).toEqual(["telemetry", "log"]);
    expect(next.collapsedSections).toEqual(["log"]);
  });
  it("equal hydrate values do not bump the reference", () => {
    const seeded: LensState = {
      widthPx: 420,
      sectionOrder: ["log", "telemetry"],
      collapsedSections: [],
      anchorSide: "left",
    };
    const next = reduce(seeded, {
      type: "hydrate",
      widthPx: 420,
      sectionOrder: ["log", "telemetry"],
      collapsedSections: [],
      anchorSide: "left",
    });
    expect(next).toBe(seeded);
  });
});

describe("LensStore reducer — toSnapshot", () => {
  it("reflects all state fields", () => {
    const s: LensState = {
      widthPx: 500,
      sectionOrder: ["log", "telemetry"],
      collapsedSections: ["log"],
      anchorSide: "left",
    };
    const snap = toSnapshot(s);
    expect(snap.widthPx).toBe(500);
    expect(snap.sectionOrder).toEqual(["log", "telemetry"]);
    expect(snap.collapsedSections).toEqual(["log"]);
    expect(snap.anchorSide).toBe("left");
  });
});

describe("LensStore reducer — anchorSide", () => {
  it("set_anchor_side updates the side", () => {
    const next = reduce(fresh(), { type: "set_anchor_side", side: "left" });
    expect(next.anchorSide).toBe("left");
  });
  it("setting the same side is a no-op (same-ref)", () => {
    const a = reduce(fresh(), { type: "set_anchor_side", side: "left" });
    expect(reduce(a, { type: "set_anchor_side", side: "left" })).toBe(a);
  });
  it("hydrate applies anchorSide", () => {
    const next = reduce(fresh(), { type: "hydrate", anchorSide: "left" });
    expect(next.anchorSide).toBe("left");
  });
});
