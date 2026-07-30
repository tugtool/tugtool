/**
 * Unit tests for `compactionProgressStore` — the lean state machine behind the
 * `/compact` progress sheet and closing bulletin ([P07]). Native compaction is
 * opaque, so a run is just in-flight or settled: `{ outcome }` with a failure
 * reason — no phase ladder, no numeric progress. Runs are keyed by card, so any
 * number of cards can be compacting at once.
 */

import { describe, it, expect, beforeEach } from "bun:test";

import {
  compactionProgressStore,
  isCompactingCard,
} from "@/lib/compaction-progress-store";

beforeEach(() => {
  for (const cardId of compactionProgressStore.getSnapshot().keys()) {
    compactionProgressStore.clear(cardId);
  }
});

describe("compactionProgressStore", () => {
  it("is idle before a run", () => {
    expect(compactionProgressStore.getSnapshot().size).toBe(0);
    expect(compactionProgressStore.getFor("A")).toBeNull();
  });

  it("begins in flight for its card, no outcome", () => {
    compactionProgressStore.begin("A");
    expect(compactionProgressStore.getFor("A")).toEqual({
      outcome: null,
      failureReason: null,
    });
    expect(isCompactingCard(compactionProgressStore.getSnapshot(), "A")).toBe(
      true,
    );
  });

  it("succeed settles the outcome", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed("A");
    expect(compactionProgressStore.getFor("A")?.outcome).toBe("succeeded");
    expect(isCompactingCard(compactionProgressStore.getSnapshot(), "A")).toBe(
      false,
    );
  });

  it("cancel and fail carry their outcome (fail keeps the reason)", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.cancel("A");
    expect(compactionProgressStore.getFor("A")?.outcome).toBe("canceled");

    compactionProgressStore.clear("A");
    compactionProgressStore.begin("A");
    compactionProgressStore.fail("A", "boom");
    const s = compactionProgressStore.getFor("A");
    expect(s?.outcome).toBe("failed");
    expect(s?.failureReason).toBe("boom");
  });

  it("a second terminal call is a no-op (first outcome wins)", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed("A");
    compactionProgressStore.cancel("A");
    expect(compactionProgressStore.getFor("A")?.outcome).toBe("succeeded");
  });

  it("clear resets that card to idle", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed("A");
    compactionProgressStore.clear("A");
    expect(compactionProgressStore.getFor("A")).toBeNull();
  });

  it("holds concurrent runs independently — one settling leaves the other alone", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.begin("B");
    expect(compactionProgressStore.getFor("A")?.outcome).toBeNull();
    expect(compactionProgressStore.getFor("B")?.outcome).toBeNull();

    // A finishes first and clears itself: B is still in flight, sheet up.
    compactionProgressStore.succeed("A");
    compactionProgressStore.clear("A");
    expect(compactionProgressStore.getFor("A")).toBeNull();
    expect(isCompactingCard(compactionProgressStore.getSnapshot(), "B")).toBe(
      true,
    );

    // B settles on its own terms, with its own outcome.
    compactionProgressStore.fail("B", "boom");
    expect(compactionProgressStore.getFor("B")?.failureReason).toBe("boom");
  });

  it("settling an unknown card is a no-op", () => {
    compactionProgressStore.succeed("A");
    compactionProgressStore.clear("A");
    expect(compactionProgressStore.getSnapshot().size).toBe(0);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let n = 0;
    const unsub = compactionProgressStore.subscribe(() => {
      n += 1;
    });
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed("A");
    expect(n).toBe(2);
    unsub();
    compactionProgressStore.clear("A");
    expect(n).toBe(2);
  });

  it("keeps stable snapshot references between notifications", () => {
    compactionProgressStore.begin("A");
    expect(compactionProgressStore.getSnapshot()).toBe(
      compactionProgressStore.getSnapshot(),
    );
    expect(compactionProgressStore.getFor("A")).toBe(
      compactionProgressStore.getFor("A"),
    );

    // Another card's run must not churn this card's snapshot identity —
    // a changed reference would re-render every card's sheet.
    const a = compactionProgressStore.getFor("A");
    compactionProgressStore.begin("B");
    expect(compactionProgressStore.getFor("A")).toBe(a);
  });
});
