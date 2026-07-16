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
