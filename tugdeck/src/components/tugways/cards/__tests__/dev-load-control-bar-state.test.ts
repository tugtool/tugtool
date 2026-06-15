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

const base: ControlBarInputs = {
  loadingDisplay: false,
  hasOlder: false,
  earlierCount: 0,
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

  test("older messages + summoned prompt → prompt", () => {
    const s = deriveControlBarState({
      ...base,
      hasOlder: true,
      earlierCount: 162,
      promptShown: true,
    });
    expect(s).toEqual({ kind: "prompt", earlierCount: 162 });
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
