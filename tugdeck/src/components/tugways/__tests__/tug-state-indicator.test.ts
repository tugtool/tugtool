/**
 * `TugStateIndicator` -- unit tests for `indicatorVisualFor`, the
 * pure helper that maps `phase × transportState × interruptInFlight`
 * onto the indicator's tone + animated flag.
 *
 * Pure-logic tests pin the precedence chain (offline > restoring >
 * interrupt > phase-driven) and every phase branch. The component's
 * render path (TugTooltip wrapping, TugAnimator pulse chain) is
 * exercised downstream via HMR + the gallery card.
 */

import { describe, expect, test } from "bun:test";

import { indicatorVisualFor } from "../tug-state-indicator";
import type { TugStateIndicatorState } from "../tug-state-indicator";

function state(
  overrides: Partial<TugStateIndicatorState>,
): TugStateIndicatorState {
  return {
    phase: "idle",
    transportState: "online",
    interruptInFlight: false,
    ...overrides,
  };
}

describe("indicatorVisualFor — transport precedence", () => {
  test("offline transport overrides every phase to danger/static", () => {
    for (const phase of [
      "idle",
      "streaming",
      "tool_work",
      "errored",
    ] as const) {
      const v = indicatorVisualFor(state({ phase, transportState: "offline" }));
      expect(v.tone).toBe("danger");
      expect(v.animated).toBe(false);
      expect(v.label).toBe("offline");
    }
  });

  test("offline transport overrides interrupt-in-flight", () => {
    const v = indicatorVisualFor(
      state({
        phase: "streaming",
        transportState: "offline",
        interruptInFlight: true,
      }),
    );
    expect(v.tone).toBe("danger");
    expect(v.animated).toBe(false);
  });

  test("restoring transport overrides every phase to caution/animated", () => {
    for (const phase of [
      "idle",
      "streaming",
      "errored",
    ] as const) {
      const v = indicatorVisualFor(
        state({ phase, transportState: "restoring" }),
      );
      expect(v.tone).toBe("caution");
      expect(v.animated).toBe(true);
      expect(v.label).toBe("restoring");
    }
  });

  test("restoring transport overrides interrupt-in-flight", () => {
    const v = indicatorVisualFor(
      state({
        phase: "streaming",
        transportState: "restoring",
        interruptInFlight: true,
      }),
    );
    expect(v.tone).toBe("caution");
    expect(v.animated).toBe(true);
    expect(v.label).toBe("restoring");
  });
});

describe("indicatorVisualFor — interrupt precedence", () => {
  test("interrupt-in-flight on an online wire reads caution/animated, labelled 'interrupting'", () => {
    const v = indicatorVisualFor(
      state({ phase: "streaming", interruptInFlight: true }),
    );
    expect(v.tone).toBe("caution");
    expect(v.animated).toBe(true);
    expect(v.label).toBe("interrupting");
  });

  test("interrupt-in-flight wins over `errored` phase", () => {
    const v = indicatorVisualFor(
      state({ phase: "errored", interruptInFlight: true }),
    );
    expect(v.tone).toBe("caution");
    expect(v.animated).toBe(true);
    expect(v.label).toBe("interrupting");
  });
});

describe("indicatorVisualFor — phase mapping", () => {
  test.each([
    "submitting",
    "awaiting_first_token",
    "streaming",
    "tool_work",
    "replaying",
  ] as const)("active phase %s reads success/animated", (phase) => {
    const v = indicatorVisualFor(state({ phase }));
    expect(v.tone).toBe("success");
    expect(v.animated).toBe(true);
    expect(v.label).toBe(phase);
  });

  test("awaiting_approval reads caution/animated", () => {
    const v = indicatorVisualFor(state({ phase: "awaiting_approval" }));
    expect(v.tone).toBe("caution");
    expect(v.animated).toBe(true);
    expect(v.label).toBe("awaiting_approval");
  });

  test("errored reads danger/static", () => {
    const v = indicatorVisualFor(state({ phase: "errored" }));
    expect(v.tone).toBe("danger");
    expect(v.animated).toBe(false);
    expect(v.label).toBe("errored");
  });

  test("idle reads default/static", () => {
    const v = indicatorVisualFor(state({ phase: "idle" }));
    expect(v.tone).toBe("default");
    expect(v.animated).toBe(false);
    expect(v.label).toBe("idle");
  });
});
