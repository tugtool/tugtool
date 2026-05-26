/**
 * Reducer tests for `handleStreamingUsage` — the live intra-turn token
 * telemetry path.
 *
 * A `streaming_usage` frame carries one tool-loop iteration's `usage`
 * snapshot. `observedInput` grows monotonically across a turn's API
 * calls, so the LATEST frame is always the current context window —
 * the reducer stores the frame's `usage` as `liveTurnUsage`, replacing
 * (never merging or summing) the prior frame. An earlier revision kept
 * a per-message map and summed it; that inherited the `result.usage`
 * over-count bug and is gone.
 *
 * Pins:
 *   - a frame stores the decoded `usage` as `liveTurnUsage`,
 *   - a later frame replaces the prior one (latest wins, even smaller),
 *   - `sessionInitTokens` is captured once from the first frame's
 *     `observedInput` and never overwritten,
 *   - reset at `handleSend`, superseded at `handleTurnComplete`,
 *   - `sessionInitTokens` is session-level — NOT reset at a turn
 *     boundary,
 *   - a frame with no `msg_id` is inert.
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

/** A `streaming_usage` wire event carrying a raw snake_case `usage`. */
function streamingUsage(
  msgId: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
): CodeSessionEvent {
  return { type: "streaming_usage", msg_id: msgId, usage } as CodeSessionEvent;
}

describe("reducer — handleStreamingUsage", () => {
  it("stores the frame's decoded usage as liveTurnUsage", () => {
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], wireText: "hi", attachments: [], turnKey: "k1" },
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_creation_input_tokens: 7327,
        cache_read_input_tokens: 13148,
        output_tokens: 2,
      }),
    ]);
    expect(state.liveTurnUsage).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      cacheCreationInputTokens: 7327,
      cacheReadInputTokens: 13148,
    });
  });

  it("a later frame replaces the prior one — latest wins, no merge", () => {
    // The terminal `message_delta` of a message finalizes `output`;
    // a later message's frame carries the grown window. The cell
    // shows the most recent frame, never an accumulation.
    const state = applyAll(fresh(), [
      { type: "send", text: "run echo", atoms: [], wireText: "run echo", attachments: [], turnKey: "k1" },
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_creation_input_tokens: 7340,
        cache_read_input_tokens: 13148,
        output_tokens: 64,
      }),
      streamingUsage("msg_b", {
        input_tokens: 4,
        cache_creation_input_tokens: 99,
        cache_read_input_tokens: 20488,
        output_tokens: 12,
      }),
    ]);
    // liveTurnUsage is msg_b's frame verbatim — not the sum of the two.
    expect(state.liveTurnUsage).toEqual({
      inputTokens: 4,
      outputTokens: 12,
      cacheCreationInputTokens: 99,
      cacheReadInputTokens: 20488,
    });
  });

  it("captures sessionInitTokens from the first frame's observedInput", () => {
    // observedInput = input + cache_read + cache_creation =
    // 3 + 13148 + 7327 = 20478. output is excluded — it is the
    // model's response, not its resident input.
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], wireText: "hi", attachments: [], turnKey: "k1" },
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_creation_input_tokens: 7327,
        cache_read_input_tokens: 13148,
        output_tokens: 999,
      }),
    ]);
    expect(state.sessionInitTokens).toBe(20478);
  });

  it("never overwrites a captured sessionInitTokens", () => {
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], wireText: "hi", attachments: [], turnKey: "k1" },
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_read_input_tokens: 18572,
        output_tokens: 10,
      }),
      // A later, larger iteration must not move window(0).
      streamingUsage("msg_a", {
        input_tokens: 4,
        cache_read_input_tokens: 40000,
        output_tokens: 200,
      }),
    ]);
    expect(state.sessionInitTokens).toBe(18575);
  });

  it("resets liveTurnUsage at handleSend but keeps sessionInitTokens", () => {
    const afterTurn = applyAll(fresh(), [
      { type: "send", text: "first", atoms: [], wireText: "first", attachments: [], turnKey: "k1" },
      streamingUsage("msg_a", { input_tokens: 3, cache_read_input_tokens: 18572, output_tokens: 80 }),
      { type: "assistant_text", msg_id: "msg_a",
      block_index: 0,
      text: "ok", is_partial: false },
      { type: "turn_complete", msg_id: "msg_a", result: "success" },
    ]);
    // Superseded at turn-complete.
    expect(afterTurn.liveTurnUsage).toBeNull();
    // sessionInitTokens survives the turn boundary — it is session-level.
    expect(afterTurn.sessionInitTokens).toBe(18575);
    // A new turn's `handleSend` clears the live frame, not sessionInit.
    const nextTurn = applyAll(afterTurn, [
      { type: "send", text: "second", atoms: [], wireText: "second", attachments: [], turnKey: "k2" },
    ]);
    expect(nextTurn.liveTurnUsage).toBeNull();
    expect(nextTurn.sessionInitTokens).toBe(18575);
  });

  it("supersedes liveTurnUsage at handleTurnComplete", () => {
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], wireText: "hi", attachments: [], turnKey: "k1" },
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_read_input_tokens: 13148,
        output_tokens: 80,
      }),
      { type: "assistant_text", msg_id: "msg_a",
      block_index: 0,
      text: "ok", is_partial: false },
    ]);
    expect(state.liveTurnUsage).not.toBeNull();
    const completed = reduce(state, {
      type: "turn_complete",
      msg_id: "msg_a",
      result: "success",
    } as CodeSessionEvent).state;
    expect(completed.liveTurnUsage).toBeNull();
  });

  it("drops a frame with no msg_id — a malformed frame", () => {
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], wireText: "hi", attachments: [], turnKey: "k1" },
      { type: "streaming_usage", usage: { output_tokens: 50 } } as CodeSessionEvent,
    ]);
    expect(state.liveTurnUsage).toBeNull();
    expect(state.sessionInitTokens).toBeNull();
  });

  it("phase-tolerant during replay bracket — the inflight snapshot's streaming_usage lands in liveTurnUsage", () => {
    // Mirrors the wire shape tugcode's `emitInflightTurnFromActiveTurn`
    // produces: a `streaming_usage` frame inside the replay bracket,
    // re-emitting the latest observed in-flight `usage` so the status
    // bar's TOKENS / CONTEXT cells climb back to where they were
    // before the reload. The handler's phase contract is "tolerant" —
    // it must update `liveTurnUsage` whatever the prevailing phase is
    // (submitting / replaying / streaming / tool_work / …). Pinning
    // the contract here so a future regression that adds a phase
    // guard would surface.
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], wireText: "hi", attachments: [], turnKey: "k1" },
      { type: "replay_started" } as CodeSessionEvent,
      streamingUsage("msg_inflight", {
        input_tokens: 1,
        output_tokens: 200,
        cache_read_input_tokens: 18029,
        cache_creation_input_tokens: 7081,
      }),
    ]);
    // Phase is "submitting" or "replaying" depending on the reducer's
    // post-send handling of `replay_started`; the streaming_usage
    // contract holds regardless.
    expect(state.phase).not.toBe("idle");
    expect(state.liveTurnUsage).toEqual({
      inputTokens: 1,
      outputTokens: 200,
      cacheCreationInputTokens: 7081,
      cacheReadInputTokens: 18029,
    });
    // sessionInitTokens is captured from the first token-bearing
    // frame's observedInput regardless of phase.
    expect(state.sessionInitTokens).toBe(1 + 18029 + 7081);
  });
});
