/**
 * session-phase-visual — unit tests for the pure mapping from a
 * CodeSession's (phase × transportState × interruptInFlight) triple
 * onto the {@link TugProgressIndicator} phase / phaseLabels /
 * phaseVisual API.
 *
 * Pins the precedence chain (offline > restoring > interrupt > phase),
 * every phase branch, and the human-readable label resolution.
 */

import { describe, expect, test } from "bun:test";

import {
  TIDE_SESSION_PHASE_LABELS,
  tideSessionPhaseKey,
  tideSessionPhaseVisual,
  type TideSessionPhaseInput,
} from "../session-phase-visual";

function input(
  overrides: Partial<TideSessionPhaseInput>,
): TideSessionPhaseInput {
  return {
    phase: "idle",
    transportState: "online",
    interruptInFlight: false,
    ...overrides,
  };
}

describe("tideSessionPhaseKey — transport precedence", () => {
  test("offline transport overrides every phase", () => {
    for (const phase of [
      "idle",
      "streaming",
      "tool_work",
      "errored",
    ] as const) {
      expect(tideSessionPhaseKey(input({ phase, transportState: "offline" }))).toBe(
        "offline",
      );
    }
  });

  test("offline transport overrides interrupt-in-flight", () => {
    expect(
      tideSessionPhaseKey(
        input({
          phase: "streaming",
          transportState: "offline",
          interruptInFlight: true,
        }),
      ),
    ).toBe("offline");
  });

  test("restoring transport overrides every phase", () => {
    for (const phase of ["idle", "streaming", "errored"] as const) {
      expect(
        tideSessionPhaseKey(input({ phase, transportState: "restoring" })),
      ).toBe("restoring");
    }
  });

  test("restoring transport overrides interrupt-in-flight", () => {
    expect(
      tideSessionPhaseKey(
        input({
          phase: "streaming",
          transportState: "restoring",
          interruptInFlight: true,
        }),
      ),
    ).toBe("restoring");
  });
});

describe("tideSessionPhaseKey — interrupt precedence", () => {
  test("interrupt-in-flight on an online wire reads 'interrupting'", () => {
    expect(
      tideSessionPhaseKey(input({ phase: "streaming", interruptInFlight: true })),
    ).toBe("interrupting");
  });

  test("interrupt-in-flight wins over `errored` phase", () => {
    expect(
      tideSessionPhaseKey(input({ phase: "errored", interruptInFlight: true })),
    ).toBe("interrupting");
  });
});

describe("tideSessionPhaseKey — phase fallback", () => {
  test.each([
    "idle",
    "submitting",
    "awaiting_first_token",
    "streaming",
    "tool_work",
    "awaiting_approval",
    "replaying",
    "waking",
    "errored",
  ] as const)("phase %s falls through to itself", (phase) => {
    expect(tideSessionPhaseKey(input({ phase }))).toBe(phase);
  });
});

describe("tideSessionPhaseVisual — role/state mapping", () => {
  test("offline → danger/aborted", () => {
    expect(tideSessionPhaseVisual("offline")).toEqual({
      role: "danger",
      state: "aborted",
    });
  });

  test("errored → danger/aborted", () => {
    expect(tideSessionPhaseVisual("errored")).toEqual({
      role: "danger",
      state: "aborted",
    });
  });

  test.each([
    "restoring",
    "interrupting",
    "awaiting_approval",
  ] as const)("%s → caution/running", (key) => {
    expect(tideSessionPhaseVisual(key)).toEqual({
      role: "caution",
      state: "running",
    });
  });

  test.each([
    "submitting",
    "awaiting_first_token",
    "streaming",
    "tool_work",
    "replaying",
    "waking",
  ] as const)("active phase %s → success/running", (key) => {
    expect(tideSessionPhaseVisual(key)).toEqual({
      role: "success",
      state: "running",
    });
  });

  test("idle → inherit/stopped", () => {
    expect(tideSessionPhaseVisual("idle")).toEqual({
      role: "inherit",
      state: "stopped",
    });
  });

  test("unknown phase falls through to idle defaults", () => {
    expect(tideSessionPhaseVisual("nonsense")).toEqual({
      role: "inherit",
      state: "stopped",
    });
  });
});

describe("TIDE_SESSION_PHASE_LABELS — human-readable labels", () => {
  test.each([
    ["idle", "Idle"],
    ["submitting", "Sending"],
    ["awaiting_first_token", "Waiting"],
    ["streaming", "Streaming"],
    ["tool_work", "Working"],
    ["awaiting_approval", "Awaiting"],
    ["replaying", "Replaying"],
    ["waking", "Streaming"],
    ["errored", "Error"],
    ["offline", "Disconnected"],
    ["restoring", "Reconnecting"],
    ["interrupting", "Interrupting"],
  ] as const)("key %s resolves to %s", (key, expected) => {
    expect(TIDE_SESSION_PHASE_LABELS[key]).toBe(expected);
  });
});
