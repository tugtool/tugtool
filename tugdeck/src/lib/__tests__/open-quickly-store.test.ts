import { afterEach, describe, expect, it } from "bun:test";

import {
  closeOpenQuickly,
  getOpenQuicklyOpen,
  openOpenQuickly,
  subscribeOpenQuickly,
} from "@/lib/open-quickly-store";

afterEach(() => closeOpenQuickly());

describe("open-quickly-store", () => {
  it("starts closed", () => {
    expect(getOpenQuicklyOpen()).toBe(false);
  });

  it("opens and closes, notifying subscribers on each transition", () => {
    let ticks = 0;
    const unsub = subscribeOpenQuickly(() => ticks++);

    openOpenQuickly();
    expect(getOpenQuicklyOpen()).toBe(true);
    expect(ticks).toBe(1);

    // Re-opening while open is a no-op (no extra notify).
    openOpenQuickly();
    expect(ticks).toBe(1);

    closeOpenQuickly();
    expect(getOpenQuicklyOpen()).toBe(false);
    expect(ticks).toBe(2);

    // Re-closing while closed is a no-op.
    closeOpenQuickly();
    expect(ticks).toBe(2);

    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    let ticks = 0;
    const unsub = subscribeOpenQuickly(() => ticks++);
    unsub();
    openOpenQuickly();
    expect(ticks).toBe(0);
  });
});
