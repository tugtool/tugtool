/**
 * lens-filter-store.test.ts — the band↔body seam for a Lens section's filter
 * query. Pure module-store logic: no React, no DOM.
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
  _clearLensFiltersForTest,
  getFilterQuery,
  getFilterVersion,
  setFilterQuery,
  subscribeFilterQuery,
} from "../lens-filter-store";

afterEach(() => {
  _clearLensFiltersForTest();
});

describe("lens-filter-store", () => {
  test("an unset section reads as no filter", () => {
    expect(getFilterQuery("snippets")).toBe("");
  });

  test("set / get round-trips per section kind", () => {
    setFilterQuery("snippets", "tug");
    setFilterQuery("text-files", "css");
    expect(getFilterQuery("snippets")).toBe("tug");
    expect(getFilterQuery("text-files")).toBe("css");
    expect(getFilterQuery("sessions")).toBe("");
  });

  test("the version bumps on a real change and holds on a no-op", () => {
    const before = getFilterVersion();
    setFilterQuery("snippets", "tug");
    const afterSet = getFilterVersion();
    expect(afterSet).toBeGreaterThan(before);
    setFilterQuery("snippets", "tug");
    expect(getFilterVersion()).toBe(afterSet);
  });

  test("subscribers fire on change and stop after unsubscribe", () => {
    let notifications = 0;
    const unsubscribe = subscribeFilterQuery(() => {
      notifications += 1;
    });
    setFilterQuery("sessions", "lens");
    expect(notifications).toBe(1);
    setFilterQuery("sessions", "lens");
    expect(notifications).toBe(1);
    setFilterQuery("sessions", "");
    expect(notifications).toBe(2);
    unsubscribe();
    setFilterQuery("sessions", "again");
    expect(notifications).toBe(2);
  });

  test("the query survives a collapse — no subscribers, value retained", () => {
    const unsubscribe = subscribeFilterQuery(() => {});
    setFilterQuery("snippets", "incipit");
    // A collapse unmounts the band (and the body): every subscriber goes away.
    unsubscribe();
    expect(getFilterQuery("snippets")).toBe("incipit");
  });
});
