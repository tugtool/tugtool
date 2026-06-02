/**
 * Reducer tests for `handleUnknownEvent` — the display-only forward-compat
 * path.
 *
 * An `unknown_event` frame is tugcode's catch-all: claude streamed a
 * top-level event type this build doesn't translate. The reducer folds it
 * into `unknownEvent` (stamping `at`) with no phase change. A later
 * unknown type overwrites the prior one. Unlike `apiRetry`, it is NOT
 * cleared at the turn boundary — a forward-compat notice outlives a turn.
 *
 * The wire→event normalization (snake_case → camelCase) lives in the
 * impure store wrapper, not the reducer, so these events arrive already
 * in the reducer's camelCase shape.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

function fresh(): CodeSessionState {
  return createInitialState(FIXTURE_IDS.TUG_SESSION_ID, "test", "new");
}

function applyAll(
  state: CodeSessionState,
  events: ReadonlyArray<CodeSessionEvent>,
): CodeSessionState {
  let current = state;
  for (const ev of events) {
    current = reduce(current, ev).state;
  }
  return current;
}

function unknownEvent(
  overrides: Partial<{ originalType: string; payloadHexPreview: string }> = {},
): CodeSessionEvent {
  return {
    type: "unknown_event",
    originalType: "future_telemetry",
    payloadHexPreview: "7b7d",
    ...overrides,
  } as CodeSessionEvent;
}

describe("reducer — handleUnknownEvent", () => {
  it("stores the notice on unknownEvent with no phase change", () => {
    const before = fresh();
    const after = reduce(before, unknownEvent()).state;
    expect(after.unknownEvent?.originalType).toBe("future_telemetry");
    expect(after.unknownEvent?.payloadHexPreview).toBe("7b7d");
    expect(typeof after.unknownEvent?.at).toBe("number");
    expect(after.phase).toBe(before.phase);
  });

  it("a later unknown type replaces the prior notice", () => {
    const after = applyAll(fresh(), [
      unknownEvent({ originalType: "thing_a" }),
      unknownEvent({ originalType: "thing_b", payloadHexPreview: "ab" }),
    ]);
    expect(after.unknownEvent?.originalType).toBe("thing_b");
    expect(after.unknownEvent?.payloadHexPreview).toBe("ab");
  });

  it("survives a turn boundary (not per-turn telemetry)", () => {
    const after = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], content: [{ type: "text" as const, text: "hi" }], turnKey: "k1" } as CodeSessionEvent,
      { type: "assistant_text", msg_id: "m1", block_index: 0, text: "ok", is_partial: false } as CodeSessionEvent,
      unknownEvent(),
      { type: "turn_complete", msg_id: "m1", result: "success" } as CodeSessionEvent,
    ]);
    expect(after.unknownEvent?.originalType).toBe("future_telemetry");
  });
});
