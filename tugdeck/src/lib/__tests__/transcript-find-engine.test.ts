/**
 * transcript-find-engine.test — the Dev card's find engine behind the
 * shared session: debounced index search, active-match identity
 * preservation across re-searches, and wrap-around navigation.
 */

import { describe, expect, test } from "bun:test";
import { TranscriptFindEngine } from "../transcript-find-engine";
import { buildSegments } from "./helpers/segments";

const settle = () => new Promise((r) => setTimeout(r, 130));

describe("TranscriptFindEngine", () => {
  test("searches the index after the debounce and reports matchInfo", async () => {
    const engine = new TranscriptFindEngine();
    engine.setIndex(buildSegments(["alpha beta", "beta gamma beta"]));
    engine.searchDidChange("beta", {
      caseSensitive: false,
      wholeWord: false,
      grep: false,
    });
    await settle();
    expect(engine.matchInfo()).toEqual({
      count: 3,
      activeOrdinal: 0,
      capped: false,
    });
  });

  test("navigation wraps around the match set", async () => {
    const engine = new TranscriptFindEngine();
    engine.setIndex(buildSegments(["x y", "x"]));
    engine.searchDidChange("x", {
      caseSensitive: false,
      wholeWord: false,
      grep: false,
    });
    await settle();
    engine.findNext();
    expect(engine.matchInfo().activeOrdinal).toBe(1);
    engine.findNext();
    expect(engine.matchInfo().activeOrdinal).toBe(0);
    engine.findPrevious();
    expect(engine.matchInfo().activeOrdinal).toBe(1);
  });

  test("a re-search preserves the active match by identity when it survives", async () => {
    const engine = new TranscriptFindEngine();
    engine.setIndex(buildSegments(["needle", "needle here"]));
    engine.searchDidChange("needle", {
      caseSensitive: false,
      wholeWord: false,
      grep: false,
    });
    await settle();
    engine.findNext(); // active = the row-1 needle
    expect(engine.matchInfo().activeOrdinal).toBe(1);
    // The transcript grows a row ABOVE the active match's row order in the
    // index; the surviving match keeps its (row, segment, start) identity.
    engine.setIndex(buildSegments(["needle", "needle here", "no hits"]));
    await settle();
    expect(engine.matchInfo().activeOrdinal).toBe(1);
  });

  test("clearing empties immediately (no debounce)", async () => {
    const engine = new TranscriptFindEngine();
    engine.setIndex(buildSegments(["zzz"]));
    engine.searchDidChange("z", {
      caseSensitive: false,
      wholeWord: false,
      grep: false,
    });
    await settle();
    expect(engine.matchInfo().count).toBe(3);
    engine.clear();
    expect(engine.matchInfo()).toEqual({
      count: 0,
      activeOrdinal: null,
      capped: false,
    });
  });
});
