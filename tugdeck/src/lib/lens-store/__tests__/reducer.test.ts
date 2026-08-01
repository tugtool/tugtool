/**
 * Pure-logic tests for the Lens store reducer. Covers width clamp,
 * section-order replace, collapsed membership toggles, and
 * hydrate — including the "no-op events return same state reference"
 * contract required by `useSyncExternalStore` for quiescent subscribers.
 */

import { describe, it, expect } from "bun:test";

import {
  createInitialState,
  EMPTY_CARDS_ROW_ORDER,
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

describe("LensStore reducer — set_cards_row_order", () => {
  it("replaces one group's order", () => {
    const next = reduce(fresh(), {
      type: "set_cards_row_order",
      group: "files",
      order: ["a", "b"],
    });
    expect(next.cardsRowOrder.files).toEqual(["a", "b"]);
  });

  it("leaves the other groups' lists at the SAME reference", () => {
    const before = fresh();
    const next = reduce(before, {
      type: "set_cards_row_order",
      group: "files",
      order: ["a"],
    });
    expect(next.cardsRowOrder.sessions).toBe(before.cardsRowOrder.sessions);
    expect(next.cardsRowOrder.tools).toBe(before.cardsRowOrder.tools);
  });

  it("an equal order is a no-op (same-ref)", () => {
    const a = reduce(fresh(), {
      type: "set_cards_row_order",
      group: "sessions",
      order: ["s1", "s2"],
    });
    expect(
      reduce(a, {
        type: "set_cards_row_order",
        group: "sessions",
        order: ["s1", "s2"],
      }),
    ).toBe(a);
  });

  it("copies the incoming order so a later mutation cannot reach state", () => {
    const incoming = ["a", "b"];
    const next = reduce(fresh(), {
      type: "set_cards_row_order",
      group: "tools",
      order: incoming,
    });
    incoming.push("c");
    expect(next.cardsRowOrder.tools).toEqual(["a", "b"]);
  });
});

describe("LensStore reducer — set_cards_group_collapsed", () => {
  it("collapsing adds the group", () => {
    const next = reduce(fresh(), {
      type: "set_cards_group_collapsed",
      group: "tools",
      collapsed: true,
    });
    expect(next.collapsedCardGroups).toEqual(["tools"]);
  });

  it("expanding removes it", () => {
    const collapsed = reduce(fresh(), {
      type: "set_cards_group_collapsed",
      group: "tools",
      collapsed: true,
    });
    const next = reduce(collapsed, {
      type: "set_cards_group_collapsed",
      group: "tools",
      collapsed: false,
    });
    expect(next.collapsedCardGroups).toEqual([]);
  });

  it("idempotent collapse is a no-op (same-ref)", () => {
    const a = reduce(fresh(), {
      type: "set_cards_group_collapsed",
      group: "files",
      collapsed: true,
    });
    expect(
      reduce(a, {
        type: "set_cards_group_collapsed",
        group: "files",
        collapsed: true,
      }),
    ).toBe(a);
  });

  it("group collapse and section collapse are separate lists", () => {
    const next = reduce(fresh(), {
      type: "set_cards_group_collapsed",
      group: "files",
      collapsed: true,
    });
    expect(next.collapsedSections).toEqual([]);
  });
});

describe("LensStore reducer — hydrate", () => {
  it("missing fields keep the existing in-state value (same-ref)", () => {
    const seeded: LensState = {
      widthPx: 500,
      sectionOrder: ["log"],
      cardsRowOrder: EMPTY_CARDS_ROW_ORDER,
      cardsGroupOrder: [],
      collapsedCardGroups: [],
      collapsedSections: ["log"],
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
      cardsRowOrder: EMPTY_CARDS_ROW_ORDER,
      cardsGroupOrder: [],
      collapsedCardGroups: [],
      collapsedSections: [],
    };
    const next = reduce(seeded, {
      type: "hydrate",
      widthPx: 420,
      sectionOrder: ["log", "telemetry"],
      collapsedSections: [],
    });
    expect(next).toBe(seeded);
  });
});

describe("LensStore reducer — toSnapshot", () => {
  it("reflects all state fields", () => {
    const s: LensState = {
      widthPx: 500,
      sectionOrder: ["log", "telemetry"],
      cardsRowOrder: EMPTY_CARDS_ROW_ORDER,
      cardsGroupOrder: [],
      collapsedCardGroups: [],
      collapsedSections: ["log"],
    };
    const snap = toSnapshot(s);
    expect(snap.widthPx).toBe(500);
    expect(snap.sectionOrder).toEqual(["log", "telemetry"]);
    expect(snap.collapsedSections).toEqual(["log"]);
  });
});
