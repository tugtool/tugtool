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

describe("resolveTag — the callsign is addressable ([P12])", () => {
  test("a known callsign resolves to its session, exactly", () => {
    sessionTagStore.setTag("r-1", "stocky-pixie");
    expect(sessionTagStore.resolveTag("stocky-pixie")).toBe("r-1");
    // Surrounding whitespace is the composer's, not the user's.
    expect(sessionTagStore.resolveTag("  stocky-pixie  ")).toBe("r-1");
  });

  test("a near miss is a miss — a callsign is a name, not a query", () => {
    sessionTagStore.setTag("r-2", "syrupy-beam");
    expect(sessionTagStore.resolveTag("syrupy-bea")).toBeNull();
    expect(sessionTagStore.resolveTag("syrupy")).toBeNull();
    expect(sessionTagStore.resolveTag("beam")).toBeNull();
    expect(sessionTagStore.resolveTag("nobody-home")).toBeNull();
  });

  test("a lineage callsign matches as itself and never as its root", () => {
    sessionTagStore.setTag("r-root", "petit-thaw");
    sessionTagStore.setTag("r-fork", "petit-thaw-A1");
    expect(sessionTagStore.resolveTag("petit-thaw-A1")).toBe("r-fork");
    expect(sessionTagStore.resolveTag("petit-thaw")).toBe("r-root");
  });

  test("a rerolled callsign stops resolving — the reason the index is maintained", () => {
    // The ledger rerolls a collided mint, so the callsign shown "from the drop"
    // legitimately changes once. The old one names nothing after that, and
    // resolving it would resume a session by a name it no longer wears.
    sessionTagStore.setTag("r-3", "optimistic-tag");
    expect(sessionTagStore.resolveTag("optimistic-tag")).toBe("r-3");
    sessionTagStore.setTag("r-3", "rerolled-tag");
    expect(sessionTagStore.resolveTag("optimistic-tag")).toBeNull();
    expect(sessionTagStore.resolveTag("rerolled-tag")).toBe("r-3");
  });

  test("clearing a session's tag withdraws it from the index too", () => {
    sessionTagStore.setTag("r-4", "gone-soon");
    sessionTagStore.setTag("r-4", null);
    expect(sessionTagStore.resolveTag("gone-soon")).toBeNull();
  });
});
