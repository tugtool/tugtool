/**
 * dev-load-control-bar-state — pure state-machine tests for the Z0 load
 * control bar ([recency P09], #step-5-5).
 */

import { describe, expect, test } from "bun:test";

import {
  controlBarModal,
  controlBarVisible,
  deriveControlBarState,
  reduceLingering,
  type ControlBarInputs,
} from "../dev-load-control-bar-state";

const base: ControlBarInputs = {
  loadActive: false,
  loadKind: null,
  hasOlder: false,
  earlierCount: 0,
  atTop: false,
  lingering: false,
};

describe("deriveControlBarState", () => {
  test("a load in flight → loading (modal), regardless of scroll", () => {
    const restore = deriveControlBarState({
      ...base,
      loadActive: true,
      loadKind: "restore",
      hasOlder: true,
      atTop: false,
    });
    expect(restore).toEqual({ kind: "loading", loadKind: "restore" });
    expect(controlBarModal(restore)).toBe(true);
    expect(controlBarVisible(restore)).toBe(true);

    const previous = deriveControlBarState({
      ...base,
      loadActive: true,
      loadKind: "previous",
    });
    expect(previous).toEqual({ kind: "loading", loadKind: "previous" });
  });

  test("older messages + at top → prompt (non-modal)", () => {
    const s = deriveControlBarState({
      ...base,
      hasOlder: true,
      earlierCount: 69,
      atTop: true,
    });
    expect(s).toEqual({ kind: "prompt", earlierCount: 69, lingering: false });
    expect(controlBarModal(s)).toBe(false);
    expect(controlBarVisible(s)).toBe(true);
  });

  test("older messages + lingering → prompt even when not at top", () => {
    const s = deriveControlBarState({
      ...base,
      hasOlder: true,
      earlierCount: 19,
      atTop: false,
      lingering: true,
    });
    expect(s).toEqual({ kind: "prompt", earlierCount: 19, lingering: true });
  });

  test("older messages but not at top and not lingering → hidden", () => {
    expect(
      deriveControlBarState({ ...base, hasOlder: true, atTop: false }),
    ).toEqual({ kind: "hidden" });
  });

  test("no older messages, not loading → hidden", () => {
    expect(
      deriveControlBarState({ ...base, hasOlder: false, atTop: true }),
    ).toEqual({ kind: "hidden" });
    expect(controlBarVisible({ kind: "hidden" })).toBe(false);
  });

  test("loading takes precedence over hasOlder/atTop", () => {
    const s = deriveControlBarState({
      ...base,
      loadActive: true,
      loadKind: "previous",
      hasOlder: true,
      atTop: true,
    });
    expect(s.kind).toBe("loading");
  });
});

describe("reduceLingering", () => {
  test("a completed load-previous starts lingering", () => {
    expect(reduceLingering(false, { type: "load-previous-complete" })).toBe(true);
  });

  test("scroll-to-bottom and submit clear lingering", () => {
    expect(reduceLingering(true, { type: "scrolled-to-bottom" })).toBe(false);
    expect(reduceLingering(true, { type: "submit" })).toBe(false);
  });

  test("clears are idempotent from a cleared state", () => {
    expect(reduceLingering(false, { type: "scrolled-to-bottom" })).toBe(false);
  });
});
