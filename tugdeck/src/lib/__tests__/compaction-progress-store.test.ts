/**
 * Unit tests for `compactionProgressStore` — the lean state machine behind the
 * `/compact` progress sheet and closing bulletin ([P07]). Native compaction is
 * opaque, so the run is just in-flight or settled: `{ cardId, outcome }` with a
 * failure reason — no phase ladder, no numeric progress.
 */

import { describe, it, expect, beforeEach } from "bun:test";

import { compactionProgressStore } from "@/lib/compaction-progress-store";

beforeEach(() => {
  compactionProgressStore.clear();
});

describe("compactionProgressStore", () => {
  it("is idle (null) before a run", () => {
    expect(compactionProgressStore.getSnapshot()).toBeNull();
  });

  it("begins in flight for its card, no outcome", () => {
    compactionProgressStore.begin("A");
    expect(compactionProgressStore.getSnapshot()).toEqual({
      cardId: "A",
      outcome: null,
      failureReason: null,
    });
  });

  it("succeed settles the outcome", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed();
    expect(compactionProgressStore.getSnapshot()?.outcome).toBe("succeeded");
  });

  it("cancel and fail carry their outcome (fail keeps the reason)", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.cancel();
    expect(compactionProgressStore.getSnapshot()?.outcome).toBe("canceled");

    compactionProgressStore.clear();
    compactionProgressStore.begin("A");
    compactionProgressStore.fail("boom");
    const s = compactionProgressStore.getSnapshot();
    expect(s?.outcome).toBe("failed");
    expect(s?.failureReason).toBe("boom");
  });

  it("a second terminal call is a no-op (first outcome wins)", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed();
    compactionProgressStore.cancel();
    expect(compactionProgressStore.getSnapshot()?.outcome).toBe("succeeded");
  });

  it("clear resets to idle", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed();
    compactionProgressStore.clear();
    expect(compactionProgressStore.getSnapshot()).toBeNull();
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let n = 0;
    const unsub = compactionProgressStore.subscribe(() => {
      n += 1;
    });
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed();
    expect(n).toBe(2);
    unsub();
    compactionProgressStore.clear();
    expect(n).toBe(2);
  });

  it("keeps a stable snapshot reference between notifications", () => {
    compactionProgressStore.begin("A");
    const a = compactionProgressStore.getSnapshot();
    const b = compactionProgressStore.getSnapshot();
    expect(a).toBe(b);
  });
});
