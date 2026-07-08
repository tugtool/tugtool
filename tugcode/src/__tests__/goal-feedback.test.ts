/**
 * `/goal` evaluator-feedback translation.
 *
 * While a goal is active, claude's Stop-hook evaluator injects synthetic
 * `user` events (`isSynthetic: true`, text
 * `Stop hook feedback:\n[<condition>]: <reason>`) into the SAME result
 * cycle — a goal run is one long turn, not a wake bracket. These tests pin
 * (a) the feedback-text parser, (b) the `goal_feedback` frame emission,
 * and (c) the exclusions: a synthetic event must not latch the rewind
 * prompt anchor, and must emit no user-visible content.
 *
 * Event shapes are verbatim from the goal-lifecycle capture in
 * `tugcode/probes/goal-loop/` (claude 2.1.204).
 */

import { describe, test, expect } from "bun:test";

import { routeTopLevelEvent, parseGoalFeedbackText } from "../session.ts";

const CTX = { msgId: "m1", seq: 1, rev: 0 };

/** Verbatim from capture-goal-2026-07-08T14-58-18-964Z (condensed reason). */
const CAPTURED_FEEDBACK_TEXT =
  "Stop hook feedback:\n[the file TURNS.txt in the current directory contains at least 2 lines, AND you have appended exactly one line per assistant turn since this goal was set (echo turn-N >> TURNS.txt) — never two lines in the same turn. Prove with cat TURNS.txt.]: The file currently contains only 1 line (`turn-1`), but the condition requires at least 2 lines.";

function syntheticFeedbackEvent(text: string): Record<string, unknown> {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    session_id: "s1",
    uuid: "38d00773-9dba-4fea-8203-e1f5942e0443",
    isSynthetic: true,
  };
}

describe("parseGoalFeedbackText", () => {
  test("parses the captured feedback shape into condition + reason", () => {
    const parsed = parseGoalFeedbackText([
      { type: "text", text: CAPTURED_FEEDBACK_TEXT },
    ]);
    expect(parsed).not.toBeNull();
    expect(parsed!.condition.startsWith("the file TURNS.txt")).toBe(true);
    expect(parsed!.condition.endsWith("Prove with cat TURNS.txt.")).toBe(true);
    expect(parsed!.reason.startsWith("The file currently contains only 1 line")).toBe(true);
  });

  test("a condition containing `]: ` stays whole (greedy condition match)", () => {
    const parsed = parseGoalFeedbackText(
      "Stop hook feedback:\n[check [x]: y holds]: not yet",
    );
    expect(parsed).toEqual({ condition: "check [x]: y holds", reason: "not yet" });
  });

  test("non-feedback content returns null", () => {
    expect(parseGoalFeedbackText("hello")).toBeNull();
    expect(parseGoalFeedbackText([{ type: "text", text: "tool output" }])).toBeNull();
    expect(parseGoalFeedbackText(undefined)).toBeNull();
  });
});

describe("routeTopLevelEvent — synthetic user events", () => {
  test("captured feedback event emits exactly one goal_feedback frame", () => {
    const result = routeTopLevelEvent(
      syntheticFeedbackEvent(CAPTURED_FEEDBACK_TEXT),
      CTX,
    );
    expect(result.messages.length).toBe(1);
    const frame = result.messages[0] as Record<string, unknown>;
    expect(frame.type).toBe("goal_feedback");
    expect((frame.condition as string).startsWith("the file TURNS.txt")).toBe(true);
    expect((frame.reason as string).length).toBeGreaterThan(0);
  });

  test("a synthetic event never latches the rewind prompt anchor", () => {
    // A real submission echo (non-synthetic, non-tool_result content)
    // surfaces its uuid as the rewind anchor; the synthetic feedback event
    // carries the same shape and would corrupt the anchor mid-goal-run.
    const result = routeTopLevelEvent(
      syntheticFeedbackEvent(CAPTURED_FEEDBACK_TEXT),
      CTX,
    ) as unknown as Record<string, unknown>;
    expect(result.promptUuid).toBeUndefined();
  });

  test("a synthetic event that is not goal feedback emits nothing", () => {
    const result = routeTopLevelEvent(
      syntheticFeedbackEvent("some future harness injection"),
      CTX,
    );
    expect(result.messages.length).toBe(0);
  });

  test("a real submission echo still latches the prompt anchor", () => {
    const result = routeTopLevelEvent(
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
        uuid: "real-echo-uuid",
      },
      CTX,
    ) as unknown as Record<string, unknown>;
    expect(result.promptUuid).toBe("real-echo-uuid");
  });
});
