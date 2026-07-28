/**
 * session-load-control-bar-state — pure state-machine tests for the Z0 load
 * control bar ([recency P09]).
 */

import { describe, expect, test } from "bun:test";

import {
  countClaudeTurns,
  deriveControlBarState,
  deriveLoadStatus,
} from "../session-load-control-bar-state";
import { restoreBarValueMax } from "../session-load-control-bar";

describe("restoreBarValueMax — turns committed of turns requested", () => {
  test("streaming: fills toward the requested window, clamped", () => {
    // Mid-load: 7 of 25 turns committed so far.
    expect(restoreBarValueMax(7, 25, true)).toEqual({ value: 7, max: 25 });
    // A burst can't overshoot the requested max.
    expect(restoreBarValueMax(30, 25, true)).toEqual({ value: 25, max: 25 });
  });

  test("landed: settles to the turns actually committed (short session)", () => {
    // A 3-turn session requested 25 → settles to "3 of 3", not "25 of 25".
    expect(restoreBarValueMax(3, 25, false)).toEqual({ value: 3, max: 3 });
  });

  test("landed: a full window reports the requested count", () => {
    expect(restoreBarValueMax(25, 25, false)).toEqual({ value: 25, max: 25 });
  });

  test("landed: never below 1 (an empty load still shows a unit bar)", () => {
    expect(restoreBarValueMax(0, 25, false)).toEqual({ value: 1, max: 1 });
  });
});

describe("deriveControlBarState", () => {
  test("loadingDisplay → loading", () => {
    expect(deriveControlBarState({ loadingDisplay: true })).toEqual({
      kind: "loading",
    });
  });

  test("not loading → metadata (the resting content)", () => {
    expect(deriveControlBarState({ loadingDisplay: false })).toEqual({
      kind: "metadata",
    });
  });
});

describe("deriveLoadStatus — metadata row turns math", () => {
  test("windowed slice with older turns remaining", () => {
    // 3 displayed of a 40-turn session; oldest loaded turn is index 37.
    expect(
      deriveLoadStatus({
        claudeTurnsDisplayed: 3,
        firstLoadedTurnIndex: 37,
        totalTurns: 40,
        step: 25,
      }),
    ).toEqual({ displayed: 3, total: 40, hasOlder: true, loadStep: 25 });
  });

  test("load step clamps to the older count when fewer than the page", () => {
    expect(
      deriveLoadStatus({
        claudeTurnsDisplayed: 35,
        firstLoadedTurnIndex: 5,
        totalTurns: 40,
        step: 25,
      }),
    ).toEqual({ displayed: 35, total: 40, hasOlder: true, loadStep: 5 });
  });

  test("full (non-windowed) load: displayed == total, all loaded", () => {
    // No window: firstLoadedTurnIndex / totalTurns null → derive from length.
    expect(
      deriveLoadStatus({
        claudeTurnsDisplayed: 12,
        firstLoadedTurnIndex: null,
        totalTurns: null,
        step: 25,
      }),
    ).toEqual({ displayed: 12, total: 12, hasOlder: false, loadStep: 0 });
  });

  test("windowed but whole session fits: all loaded", () => {
    expect(
      deriveLoadStatus({
        claudeTurnsDisplayed: 40,
        firstLoadedTurnIndex: 0,
        totalTurns: 40,
        step: 25,
      }),
    ).toEqual({ displayed: 40, total: 40, hasOlder: false, loadStep: 0 });
  });
});

describe("countClaudeTurns — shell rows are not conversation turns", () => {
  test("shell-origin rows are excluded; every other origin counts", () => {
    const transcript = [
      { origin: "user" },
      { origin: "shell" },
      { origin: "assistant" },
      { origin: "shell" },
      { origin: "wake" },
      {},
    ];
    expect(countClaudeTurns(transcript)).toBe(4);
  });

  test("a shell-heavy session reads X of Y honestly", () => {
    // The shape that read "83 of 68": 68 Claude turns interleaved with 15
    // shell rows, against an engine count of 68.
    const transcript = [
      ...Array.from({ length: 68 }, () => ({ origin: "user" })),
      ...Array.from({ length: 15 }, () => ({ origin: "shell" })),
    ];
    expect(
      deriveLoadStatus({
        claudeTurnsDisplayed: countClaudeTurns(transcript),
        firstLoadedTurnIndex: 0,
        totalTurns: 68,
        step: 25,
      }),
    ).toEqual({ displayed: 68, total: 68, hasOlder: false, loadStep: 0 });
  });
});
