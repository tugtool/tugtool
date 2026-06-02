/**
 * Unit tests for `compactionProgressStore` — the state machine behind the
 * `/compact` progress sheet and closing bulletin.
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

  it("begins at summarizing, value 0, no outcome", () => {
    compactionProgressStore.begin("A");
    expect(compactionProgressStore.getSnapshot()).toEqual({
      cardId: "A",
      phase: "summarizing",
      value: 0,
      outcome: null,
      failureReason: null,
    });
  });

  it("ticks phase + value while running", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.setProgress("summarizing", 0.4);
    expect(compactionProgressStore.getSnapshot()?.value).toBe(0.4);
    compactionProgressStore.setProgress("respawning", 0.95);
    expect(compactionProgressStore.getSnapshot()?.phase).toBe("respawning");
  });

  it("succeed settles outcome and pins value to 1", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.succeed();
    const s = compactionProgressStore.getSnapshot();
    expect(s?.outcome).toBe("succeeded");
    expect(s?.value).toBe(1);
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

  it("setProgress is ignored after settling (late tick can't reopen)", () => {
    compactionProgressStore.begin("A");
    compactionProgressStore.cancel();
    compactionProgressStore.setProgress("summarizing", 0.2);
    const s = compactionProgressStore.getSnapshot();
    expect(s?.outcome).toBe("canceled");
    expect(s?.value).toBe(1);
  });

  it("setProgress is a no-op when idle", () => {
    compactionProgressStore.setProgress("summarizing", 0.5);
    expect(compactionProgressStore.getSnapshot()).toBeNull();
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
    compactionProgressStore.setProgress("summarizing", 0.3);
    expect(n).toBe(2);
    unsub();
    compactionProgressStore.succeed();
    expect(n).toBe(2);
  });

  it("keeps a stable snapshot reference between notifications", () => {
    compactionProgressStore.begin("A");
    const a = compactionProgressStore.getSnapshot();
    const b = compactionProgressStore.getSnapshot();
    expect(a).toBe(b);
  });
});
