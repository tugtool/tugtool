/**
 * session-tag-store.test.ts — set/get/clear + no-op-when-unchanged coverage for
 * the per-session tag cache (a faithful clone of the name store's contract).
 */

import { describe, expect, test } from "bun:test";
import { sessionTagStore } from "../session-tag-store";

describe("sessionTagStore", () => {
  test("get is null before any set; set then get round-trips (trimmed)", () => {
    expect(sessionTagStore.getTag("s-get")).toBe(null);
    sessionTagStore.setTag("s-get", "  azure-heron  ");
    expect(sessionTagStore.getTag("s-get")).toBe("azure-heron");
  });

  test("a blank tag clears the entry", () => {
    sessionTagStore.setTag("s-clear", "coral-otter");
    expect(sessionTagStore.getTag("s-clear")).toBe("coral-otter");
    sessionTagStore.setTag("s-clear", "   ");
    expect(sessionTagStore.getTag("s-clear")).toBe(null);
  });

  test("seedTag writes a real value but a blank never clobbers a good tag", () => {
    sessionTagStore.setTag("s-seed", "stout-finch");
    // A row read before the tag landed pushes null — must NOT wipe the tag.
    sessionTagStore.seedTag("s-seed", null);
    sessionTagStore.seedTag("s-seed", "   ");
    expect(sessionTagStore.getTag("s-seed")).toBe("stout-finch");
    // A different real value still overwrites (server suffixed a collision).
    sessionTagStore.seedTag("s-seed", "stout-finch-2");
    expect(sessionTagStore.getTag("s-seed")).toBe("stout-finch-2");
    // seedTag also populates a previously-empty entry.
    expect(sessionTagStore.getTag("s-seed-fresh")).toBe(null);
    sessionTagStore.seedTag("s-seed-fresh", "azure-heron");
    expect(sessionTagStore.getTag("s-seed-fresh")).toBe("azure-heron");
  });

  test("an unchanged set does not notify subscribers", () => {
    let notifications = 0;
    const unsubscribe = sessionTagStore.subscribe(() => {
      notifications++;
    });
    sessionTagStore.setTag("s-noop", "azure-heron"); // change → 1 notify
    sessionTagStore.setTag("s-noop", "azure-heron"); // unchanged → no notify
    expect(notifications).toBe(1);
    unsubscribe();
  });
});
