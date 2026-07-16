/**
 * sessions-entry-collapse-store.test.ts — the per-entry Sessions collapse
 * reducer ([P05]): open-once default, seen-set-wide collapseAll, per-id
 * toggle re-open. Pure logic over a fresh instance — no DOM, no React.
 *
 * @module lib/sessions-entry-collapse-store.test
 */

import { describe, expect, it } from "bun:test";
import { SessionsEntryCollapseStore } from "./sessions-entry-collapse-store";

describe("SessionsEntryCollapseStore", () => {
  it("reads an absent id as open (open-once default)", () => {
    const store = new SessionsEntryCollapseStore();
    expect(store.isCollapsed("a")).toBe(false);
  });

  it("collapseAll collapses the whole seen set", () => {
    const store = new SessionsEntryCollapseStore();
    store.markSeen(["a", "b", "c"]);
    store.collapseAll();
    expect(store.isCollapsed("a")).toBe(true);
    expect(store.isCollapsed("b")).toBe(true);
    expect(store.isCollapsed("c")).toBe(true);
  });

  it("a later toggle(id, false) re-opens one collapsed entry", () => {
    const store = new SessionsEntryCollapseStore();
    store.markSeen(["a", "b"]);
    store.collapseAll();
    store.toggle("a", false);
    expect(store.isCollapsed("a")).toBe(false);
    expect(store.isCollapsed("b")).toBe(true);
  });

  it("collapseAll reaches a seen id that is not currently on screen", () => {
    const store = new SessionsEntryCollapseStore();
    // Seen across two snapshots; only `b` is on screen at collapse time, but
    // `a` was seen earlier and must come back collapsed rather than pop open.
    store.markSeen(["a"]);
    store.markSeen(["b"]);
    store.collapseAll();
    expect(store.isCollapsed("a")).toBe(true);
    expect(store.isCollapsed("b")).toBe(true);
  });

  it("expandAll opens everything", () => {
    const store = new SessionsEntryCollapseStore();
    store.markSeen(["a", "b"]);
    store.collapseAll();
    store.expandAll();
    expect(store.isCollapsed("a")).toBe(false);
    expect(store.isCollapsed("b")).toBe(false);
  });

  it("notifies subscribers on a real change and replaces the snapshot identity", () => {
    const store = new SessionsEntryCollapseStore();
    let notifications = 0;
    const unsub = store.subscribe(() => {
      notifications += 1;
    });
    const before = store.getSnapshot();
    store.toggle("a", true);
    expect(notifications).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().has("a")).toBe(true);

    // A redundant toggle to the same state is a no-op — no notify.
    store.toggle("a", true);
    expect(notifications).toBe(1);
    unsub();
  });
});
