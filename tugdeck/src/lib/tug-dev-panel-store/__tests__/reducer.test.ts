/**
 * Pure-logic tests for the `TugDevPanelStore` reducer. Covers toggle,
 * tab-select, card-select, hydrate, and card-gone — including the
 * "no-op events return same state reference" contract required by
 * `useSyncExternalStore` for quiescent subscribers.
 */

import { describe, it, expect } from "bun:test";

import {
  createInitialState,
  reduce,
  toSnapshot,
  type TugDevPanelState,
} from "@/lib/tug-dev-panel-store/reducer";

function fresh(): TugDevPanelState {
  return createInitialState();
}

describe("TugDevPanelStore reducer — toggle", () => {
  it("starts closed and flips to open", () => {
    const next = reduce(fresh(), { type: "toggle" });
    expect(next.open).toBe(true);
  });

  it("toggling twice returns to the starting value", () => {
    const a = reduce(fresh(), { type: "toggle" });
    const b = reduce(a, { type: "toggle" });
    expect(b.open).toBe(false);
  });
});

describe("TugDevPanelStore reducer — set_open", () => {
  it("idempotent under the same value (same state reference)", () => {
    const s = fresh();
    expect(reduce(s, { type: "set_open", open: false })).toBe(s);
  });

  it("opens when previously closed", () => {
    const next = reduce(fresh(), { type: "set_open", open: true });
    expect(next.open).toBe(true);
  });
});

describe("TugDevPanelStore reducer — select_tab", () => {
  it("same-tab no-op returns same reference", () => {
    const s = fresh();
    expect(reduce(s, { type: "select_tab", tab: "telemetry" })).toBe(s);
  });
});

describe("TugDevPanelStore reducer — select_card", () => {
  it("sets a card id from null", () => {
    const next = reduce(fresh(), { type: "select_card", cardId: "card-a" });
    expect(next.selectedCardId).toBe("card-a");
  });

  it("clears selection back to null", () => {
    const a = reduce(fresh(), { type: "select_card", cardId: "card-a" });
    const b = reduce(a, { type: "select_card", cardId: null });
    expect(b.selectedCardId).toBeNull();
  });

  it("same id returns same reference", () => {
    const s = reduce(fresh(), { type: "select_card", cardId: "x" });
    expect(reduce(s, { type: "select_card", cardId: "x" })).toBe(s);
  });
});

describe("TugDevPanelStore reducer — hydrate", () => {
  it("missing fields keep the existing in-state value", () => {
    const seeded: TugDevPanelState = {
      open: true,
      activeTab: "telemetry",
      selectedCardId: "card-a",
      widthPx: 500,
    };
    const next = reduce(seeded, { type: "hydrate" });
    expect(next).toBe(seeded);
  });

  it("applies open + selectedCardId", () => {
    const next = reduce(fresh(), {
      type: "hydrate",
      open: true,
      selectedCardId: "card-b",
    });
    expect(next.open).toBe(true);
    expect(next.selectedCardId).toBe("card-b");
  });

  it("invalid activeTab is silently rejected", () => {
    const s = fresh();
    const next = reduce(s, { type: "hydrate", activeTab: "bogus" });
    expect(next.activeTab).toBe("telemetry"); // default kept
  });
});

describe("TugDevPanelStore reducer — card_gone", () => {
  it("clears the selection when the gone card matches", () => {
    const seeded = reduce(fresh(), { type: "select_card", cardId: "card-a" });
    const next = reduce(seeded, { type: "card_gone", cardId: "card-a" });
    expect(next.selectedCardId).toBeNull();
  });

  it("leaves the selection alone when an unrelated card disappears", () => {
    const seeded = reduce(fresh(), { type: "select_card", cardId: "card-a" });
    const next = reduce(seeded, { type: "card_gone", cardId: "card-b" });
    expect(next).toBe(seeded);
  });

  it("idempotent when no card is selected", () => {
    const s = fresh();
    expect(reduce(s, { type: "card_gone", cardId: "card-a" })).toBe(s);
  });
});

describe("TugDevPanelStore reducer — toSnapshot", () => {
  it("reflects all state fields", () => {
    const s: TugDevPanelState = {
      open: true,
      activeTab: "telemetry",
      selectedCardId: "card-a",
      widthPx: 500,
    };
    const snap = toSnapshot(s);
    expect(snap.open).toBe(true);
    expect(snap.activeTab).toBe("telemetry");
    expect(snap.selectedCardId).toBe("card-a");
    expect(snap.widthPx).toBe(500);
  });
});

describe("TugDevPanelStore reducer — set_width", () => {
  it("clamps below the floor up to MIN_DEV_PANEL_WIDTH_PX", () => {
    const next = reduce(createInitialState(), { type: "set_width", widthPx: 100 });
    expect(next.widthPx).toBe(320);
  });
  it("accepts widths above the floor", () => {
    const next = reduce(createInitialState(), { type: "set_width", widthPx: 700 });
    expect(next.widthPx).toBe(700);
  });
  it("same width is a no-op (same-ref)", () => {
    const s = createInitialState();
    expect(reduce(s, { type: "set_width", widthPx: s.widthPx })).toBe(s);
  });
  it("rejects non-finite values (falls back to default)", () => {
    const next = reduce(createInitialState(), { type: "set_width", widthPx: Number.NaN });
    expect(next.widthPx).toBe(420);
  });
});
