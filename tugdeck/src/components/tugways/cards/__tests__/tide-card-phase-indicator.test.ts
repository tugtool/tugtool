/**
 * Pure-logic tests for the Z4 prompt-entry-footer phase indicator —
 * `resolvePhaseIndicatorView` (the lifecycle-state → text projection)
 * and `currentToolNameFromCalls` (the running-tool pick).
 *
 * `resolvePhaseIndicatorView` is the executable form of the lifecycle
 * matrix's Z4 column: one case per `TideLifecycleState`, asserting the
 * three in-flight states carry their indicator line and every other
 * state resolves to the empty Z4 cell (`text: null`). The component's
 * rendered DOM + the always-mounted footer slot are the Step 20.5.D.5.C
 * end-to-end matrix test's job, per the no-fake-DOM rule.
 */

import { describe, it, expect } from "bun:test";

import {
  currentToolNameFromCalls,
  resolvePhaseIndicatorView,
} from "@/components/tugways/cards/tide-card-phase-indicator";
import type { ToolCallState } from "@/lib/code-session-store";
import type { TideLifecycleState } from "@/lib/code-session-store/lifecycle-state";

/** Minimal `ToolCallState` literal — only `toolName` / `status` matter here. */
function toolCall(
  toolName: string,
  status: ToolCallState["status"],
): ToolCallState {
  return {
    toolUseId: `id-${toolName}`,
    toolName,
    input: null,
    status,
    result: null,
    structuredResult: null,
    toolWallMs: null,
  };
}

describe("resolvePhaseIndicatorView — Z4 state → text", () => {
  it("awaiting_first_token — the awaiting line", () => {
    expect(resolvePhaseIndicatorView("awaiting_first_token", null)).toEqual({
      text: "Awaiting first token",
    });
  });

  it("streaming — the thinking line", () => {
    expect(resolvePhaseIndicatorView("streaming", null)).toEqual({
      text: "Claude is thinking",
    });
  });

  it("tool_work — interpolates the running tool name", () => {
    expect(resolvePhaseIndicatorView("tool_work", "Read")).toEqual({
      text: "Running Read",
    });
  });

  it("tool_work — falls back to a generic label with no tool name", () => {
    // A `tool_work` phase whose calls have all resolved between the
    // `tool_use` and the next agent-loop step: the phase is still the
    // signal, so Z4 stays populated rather than blanking.
    expect(resolvePhaseIndicatorView("tool_work", null)).toEqual({
      text: "Running a tool",
    });
  });

  it("every non-in-flight state resolves to the empty Z4 cell", () => {
    const empty: ReadonlyArray<TideLifecycleState> = [
      "idle",
      "submitting",
      "awaiting_user",
      "interrupting",
      "replaying",
      "errored",
      "complete",
    ];
    for (const state of empty) {
      expect(resolvePhaseIndicatorView(state, null)).toEqual({ text: null });
    }
  });

  it("a tool name does not leak into non-tool states", () => {
    // `toolName` is consulted only for `tool_work`; passing one for any
    // other state must not change the projection.
    expect(resolvePhaseIndicatorView("streaming", "Bash")).toEqual({
      text: "Claude is thinking",
    });
    expect(resolvePhaseIndicatorView("idle", "Bash")).toEqual({ text: null });
  });
});

describe("currentToolNameFromCalls — the running-tool pick", () => {
  it("empty list — null", () => {
    expect(currentToolNameFromCalls([])).toBeNull();
  });

  it("all calls resolved — null", () => {
    expect(
      currentToolNameFromCalls([toolCall("Read", "done"), toolCall("Glob", "error")]),
    ).toBeNull();
  });

  it("one pending call — its name", () => {
    expect(
      currentToolNameFromCalls([toolCall("Read", "done"), toolCall("Bash", "pending")]),
    ).toBe("Bash");
  });

  it("pending call before a resolved one — still found", () => {
    expect(
      currentToolNameFromCalls([toolCall("Bash", "pending"), toolCall("Read", "done")]),
    ).toBe("Bash");
  });

  it("multiple pending — the most recently started (last) wins", () => {
    // Parallel tool calls: the matrix's Z4 line is singular, so the
    // freshest pending entry is the one shown.
    expect(
      currentToolNameFromCalls([
        toolCall("Read", "pending"),
        toolCall("Grep", "pending"),
      ]),
    ).toBe("Grep");
  });
});
