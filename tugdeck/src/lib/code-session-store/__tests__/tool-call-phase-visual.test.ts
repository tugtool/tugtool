/**
 * tool-call-phase-visual — unit tests for the pure mapping from a tool
 * call's (status × awaiting × interrupted) triple onto the
 * {@link TugProgressIndicator} phase / phaseVisual API.
 *
 * Pins `deriveToolCallPhase`'s precedence chain, every
 * `toolCallPhaseVisual` branch, and the label resolution.
 */

import { describe, expect, test } from "bun:test";

import type {
  TugProgressIndicatorRole,
  TugProgressIndicatorState,
} from "@/components/tugways/tug-progress-indicator";
import {
  TOOL_CALL_PHASE_LABELS,
  deriveToolCallPhase,
  toolCallPhaseVisual,
  type ToolCallPhase,
  type ToolCallPhaseInput,
} from "../tool-call-phase-visual";

function input(overrides: Partial<ToolCallPhaseInput>): ToolCallPhaseInput {
  return {
    status: "pending",
    awaiting: false,
    interrupted: false,
    ...overrides,
  };
}

describe("deriveToolCallPhase — precedence", () => {
  test("error status wins over everything", () => {
    expect(
      deriveToolCallPhase(
        input({ status: "error", awaiting: true, interrupted: true }),
      ),
    ).toBe("error");
  });

  test("interrupted wins over awaiting and over a done status", () => {
    expect(
      deriveToolCallPhase(
        input({ status: "done", interrupted: true, awaiting: true }),
      ),
    ).toBe("interrupted");
  });

  test("awaiting wins over a plain pending in_flight", () => {
    expect(deriveToolCallPhase(input({ status: "pending", awaiting: true }))).toBe(
      "awaiting",
    );
  });

  test("pending with no awaiting/interrupt is in_flight", () => {
    expect(deriveToolCallPhase(input({ status: "pending" }))).toBe("in_flight");
  });

  test("done with no interrupt is success", () => {
    expect(deriveToolCallPhase(input({ status: "done" }))).toBe("success");
  });

  test("optional fields default to false (undefined treated as not-set)", () => {
    expect(deriveToolCallPhase({ status: "pending" })).toBe("in_flight");
    expect(deriveToolCallPhase({ status: "done" })).toBe("success");
    expect(deriveToolCallPhase({ status: "error" })).toBe("error");
  });
});

describe("toolCallPhaseVisual — every branch", () => {
  const cases: ReadonlyArray<
    [ToolCallPhase, TugProgressIndicatorRole, TugProgressIndicatorState]
  > = [
    ["in_flight", "action", "running"],
    ["awaiting", "caution", "running"],
    ["success", "success", "completed"],
    ["error", "danger", "aborted"],
    ["interrupted", "danger", "aborted"],
    ["idle", "inherit", "stopped"],
  ];

  for (const [phase, role, state] of cases) {
    test(`${phase} → role ${role}, state ${state}`, () => {
      expect(toolCallPhaseVisual(phase)).toEqual({ role, state });
    });
  }

  test("unknown phase falls back to the quiet idle pose", () => {
    expect(toolCallPhaseVisual("bogus")).toEqual({
      role: "inherit",
      state: "stopped",
    });
  });
});

describe("TOOL_CALL_PHASE_LABELS", () => {
  test("error and interrupted carry distinct labels despite a shared visual", () => {
    expect(toolCallPhaseVisual("error")).toEqual(toolCallPhaseVisual("interrupted"));
    expect(TOOL_CALL_PHASE_LABELS.error).not.toBe(
      TOOL_CALL_PHASE_LABELS.interrupted,
    );
  });

  test("every phase has a label", () => {
    for (const phase of [
      "idle",
      "in_flight",
      "awaiting",
      "success",
      "error",
      "interrupted",
    ] as const) {
      expect(TOOL_CALL_PHASE_LABELS[phase].length).toBeGreaterThan(0);
    }
  });
});
