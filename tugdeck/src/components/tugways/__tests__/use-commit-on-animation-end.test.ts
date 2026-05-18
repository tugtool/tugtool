/**
 * `useCommitOnAnimationEnd` -- unit tests for the deferred-commit
 * decision logic.
 *
 * Tests target the two pure decision helpers (`decideOnTargetChange`
 * and `decideOnAnimationEnd`) exported from the hook module. These
 * helpers are the implementation; the hook is a thin glue layer that
 * reads `getAnimations` / mounts listeners / writes through refs.
 * Pure-logic tests here pin the decision contract without spinning
 * up a real DOM -- per the project preference for narrow, fast tests
 * that exercise logic rather than rendering.
 *
 * Coverage:
 *
 *  - `decideOnTargetChange`:
 *    - target === applied is a no-op.
 *    - target !== applied with no running animation commits now
 *      (the "static default" and "reduced motion" cases collapse
 *      into the same branch).
 *    - target !== applied with a running animation defers.
 *  - `decideOnAnimationEnd`:
 *    - pending === applied ignores the event (no commit queued).
 *    - pending !== applied with no filter commits.
 *    - pending !== applied with a matching filter commits.
 *    - pending !== applied with a non-matching filter ignores.
 */

import { describe, expect, test } from "bun:test";

import {
  decideOnTargetChange,
  decideOnAnimationEnd,
} from "../hooks/use-commit-on-animation-end";

describe("decideOnTargetChange", () => {
  test("no-op when target matches applied", () => {
    expect(
      decideOnTargetChange({
        target: "tone-success",
        applied: "tone-success",
        hasRunningAnimation: true,
      }),
    ).toBe("no-op");
  });

  test("no-op even when no animation is running and classes match", () => {
    expect(
      decideOnTargetChange({
        target: "tone-default",
        applied: "tone-default",
        hasRunningAnimation: false,
      }),
    ).toBe("no-op");
  });

  test("commit-now when nothing is animating (static default)", () => {
    // The static-default state: the previous applied class has no
    // animation attached. Nothing to defer to -- swap immediately.
    expect(
      decideOnTargetChange({
        target: "tone-success",
        applied: "tone-default",
        hasRunningAnimation: false,
      }),
    ).toBe("commit-now");
  });

  test("commit-now under reduced motion (collapses to the same branch)", () => {
    // Reduced motion forces `animation-duration: 0s` on every
    // element. `getAnimations({ subtree: true })` returns no running
    // animations even when the applied class would normally pulse.
    // The pure-logic check is identical to the static-default case.
    expect(
      decideOnTargetChange({
        target: "tone-default",
        applied: "tone-success",
        hasRunningAnimation: false,
      }),
    ).toBe("commit-now");
  });

  test("defer when an animation is running on the commit element", () => {
    expect(
      decideOnTargetChange({
        target: "tone-default",
        applied: "tone-success",
        hasRunningAnimation: true,
      }),
    ).toBe("defer");
  });

  test("defer when swapping between two animated tones", () => {
    expect(
      decideOnTargetChange({
        target: "tone-caution",
        applied: "tone-success",
        hasRunningAnimation: true,
      }),
    ).toBe("defer");
  });
});

describe("decideOnAnimationEnd", () => {
  test("ignore when no deferred commit is queued (pending === applied)", () => {
    expect(
      decideOnAnimationEnd({
        pending: "tone-success",
        applied: "tone-success",
        eventAnimationName: "tide-telemetry-indicator-pulse",
        filterAnimationName: undefined,
      }),
    ).toBe("ignore");
  });

  test("commit when pending differs and no filter is configured", () => {
    expect(
      decideOnAnimationEnd({
        pending: "tone-default",
        applied: "tone-success",
        eventAnimationName: "tide-telemetry-indicator-pulse",
        filterAnimationName: undefined,
      }),
    ).toBe("commit");
  });

  test("commit when pending differs and the filter matches the event", () => {
    expect(
      decideOnAnimationEnd({
        pending: "tone-default",
        applied: "tone-success",
        eventAnimationName: "tug-thinking-bar-3",
        filterAnimationName: "tug-thinking-bar-3",
      }),
    ).toBe("commit");
  });

  test("ignore when the filter is configured and the event does not match", () => {
    // Multi-bar composition: the listener catches `animationend` for
    // every bar in the stagger. Only the gating bar (here, bar 3)
    // commits; the others are dropped.
    expect(
      decideOnAnimationEnd({
        pending: "tone-default",
        applied: "tone-success",
        eventAnimationName: "tug-thinking-bar-1",
        filterAnimationName: "tug-thinking-bar-3",
      }),
    ).toBe("ignore");
  });

  test("ignore when filter is configured and the event animationName is the empty string", () => {
    // Defensive: some events report animationName as "" when an
    // animation is cancelled mid-iteration. With a filter set, those
    // events should never commit.
    expect(
      decideOnAnimationEnd({
        pending: "tone-default",
        applied: "tone-success",
        eventAnimationName: "",
        filterAnimationName: "tug-thinking-bar-3",
      }),
    ).toBe("ignore");
  });

  test("commit when filter is undefined and animationName is empty", () => {
    // Without a filter, any animationend (including cancellation
    // events with empty names) drives the commit.
    expect(
      decideOnAnimationEnd({
        pending: "tone-default",
        applied: "tone-success",
        eventAnimationName: "",
        filterAnimationName: undefined,
      }),
    ).toBe("commit");
  });
});
