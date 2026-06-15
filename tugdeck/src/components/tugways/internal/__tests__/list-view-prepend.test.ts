/**
 * list-view-prepend — pure-helper tests for front-insert detection and
 * the scroll-position-hold math.
 */

import { describe, expect, test } from "bun:test";

import {
  detectPrepend,
  prependScrollAdjustment,
} from "../list-view-prepend";

describe("detectPrepend", () => {
  test("recognizes a front-insert (first id changed, count grew)", () => {
    expect(detectPrepend("turnK-user", 6, "olderK-user", 12)).toEqual({
      added: 6,
    });
  });

  test("an append (first id unchanged) is not a prepend", () => {
    expect(detectPrepend("turnK-user", 6, "turnK-user", 8)).toBeNull();
  });

  test("no prior first id (empty before) is not a prepend", () => {
    expect(detectPrepend(null, 0, "turnK-user", 4)).toBeNull();
  });

  test("count did not grow → not a prepend (defensive)", () => {
    expect(detectPrepend("a", 6, "b", 6)).toBeNull();
    expect(detectPrepend("a", 6, "b", 3)).toBeNull();
  });

  test("emptied list (firstId now null) is not a prepend", () => {
    expect(detectPrepend("a", 6, null, 0)).toBeNull();
  });
});

describe("prependScrollAdjustment", () => {
  test("adds the scrollHeight delta to scrollTop so content holds", () => {
    // 6 older rows added 1200px above; viewport was at 800.
    expect(prependScrollAdjustment(2000, 3200, 800)).toBe(2000);
  });

  test("holds at the very top after a prepend", () => {
    // Was at top (0); 500px inserted above → must move to 500 to keep
    // the same content under the viewport.
    expect(prependScrollAdjustment(1000, 1500, 0)).toBe(500);
  });

  test("clamps to zero (never negative)", () => {
    expect(prependScrollAdjustment(1500, 1000, 100)).toBe(0);
  });

  test("no growth → scrollTop unchanged", () => {
    expect(prependScrollAdjustment(2000, 2000, 640)).toBe(640);
  });
});
