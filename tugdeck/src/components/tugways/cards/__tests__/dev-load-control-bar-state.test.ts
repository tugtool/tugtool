/**
 * dev-load-control-bar-state — pure state-machine tests for the Z0 load
 * control bar ([recency P09], #step-5-5).
 */

import { describe, expect, test } from "bun:test";

import {
  controlBarVisible,
  deriveControlBarState,
  type ControlBarInputs,
} from "../dev-load-control-bar-state";
import { restoreBarValueMax } from "../dev-load-control-bar";

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

const base: ControlBarInputs = {
  loadingDisplay: false,
  hasOlder: false,
  earlierTurns: 0,
  promptShown: false,
};

describe("deriveControlBarState", () => {
  test("loadingDisplay → loading, regardless of prompt/older state", () => {
    const s = deriveControlBarState({
      ...base,
      loadingDisplay: true,
      hasOlder: true,
      promptShown: true,
    });
    expect(s).toEqual({ kind: "loading" });
    expect(controlBarVisible(s)).toBe(true);
  });

  test("older turns + summoned prompt → prompt", () => {
    const s = deriveControlBarState({
      ...base,
      hasOlder: true,
      earlierTurns: 162,
      promptShown: true,
    });
    expect(s).toEqual({ kind: "prompt", earlierTurns: 162 });
    expect(controlBarVisible(s)).toBe(true);
  });

  test("older messages but prompt not summoned → hidden", () => {
    expect(
      deriveControlBarState({ ...base, hasOlder: true, promptShown: false }),
    ).toEqual({ kind: "hidden" });
  });

  test("prompt summoned but no older messages → hidden", () => {
    expect(
      deriveControlBarState({ ...base, hasOlder: false, promptShown: true }),
    ).toEqual({ kind: "hidden" });
    expect(controlBarVisible({ kind: "hidden" })).toBe(false);
  });

  test("loadingDisplay takes precedence over a summoned prompt", () => {
    const s = deriveControlBarState({
      ...base,
      loadingDisplay: true,
      hasOlder: true,
      promptShown: true,
    });
    expect(s.kind).toBe("loading");
  });
});
