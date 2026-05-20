/**
 * Reducer tests for `handleStreamingUsage` — the live intra-turn token
 * telemetry path (J.2).
 *
 * `streaming_usage` frames carry one assistant message's `usage`
 * snapshot keyed by `msg_id`. The reducer keeps a per-message map
 * (`liveTurnUsage.byMessage`), merges a message's frames with the
 * per-field MAX (every field is monotonic across a message — the
 * opening `message_start` to the terminal `message_delta`), and the
 * turn rollup is the SUM across messages.
 *
 * Pins:
 *   - a frame creates / updates the per-message entry,
 *   - per-field max within a message (no double-count),
 *   - accumulation across a multi-message tool-loop turn — and that
 *     the per-message usages SUM to the turn total (real wire data),
 *   - reset at `handleSend`, supersede at `handleTurnComplete`,
 *   - a frame with no `msg_id` is inert.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import { rollupLiveTurnUsage } from "@/lib/code-session-store/end-state";
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
  it("a first frame creates the per-message liveTurnUsage entry", () => {
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], turnKey: "k1" },
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_creation_input_tokens: 7327,
        cache_read_input_tokens: 13148,
        output_tokens: 2,
      }),
    ]);
    expect(state.liveTurnUsage).not.toBeNull();
    expect(state.liveTurnUsage?.byMessage["msg_a"]).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      cacheCreationInputTokens: 7327,
      cacheReadInputTokens: 13148,
    });
  });

  it("merges a message's frames with the per-field max (message_start → message_delta)", () => {
    // message_start reports output=64 (a partial); the terminal
    // message_delta finalizes output=80. input / cache are constant.
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], turnKey: "k1" },
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_creation_input_tokens: 7340,
        cache_read_input_tokens: 13148,
        output_tokens: 64,
      }),
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_creation_input_tokens: 7340,
        cache_read_input_tokens: 13148,
        output_tokens: 80,
      }),
    ]);
    // The message keeps one entry; output advanced 64 → 80.
    expect(Object.keys(state.liveTurnUsage?.byMessage ?? {})).toEqual(["msg_a"]);
    expect(state.liveTurnUsage?.byMessage["msg_a"].outputTokens).toBe(80);
  });

  it("accumulates across a multi-message tool-loop turn — per-message usages sum to the turn total", () => {
    // Real captured wire data: a two-iteration tool-loop turn. Each
    // assistant message emits message_start + terminal message_delta.
    // The per-message message_delta usages sum to the turn's
    // result.usage (input 4, cache_creation 7439, cache_read 33636,
    // output 92) — the additivity J.2 depends on.
    const state = applyAll(fresh(), [
      { type: "send", text: "run echo", atoms: [], turnKey: "k1" },
      // Message A — message_start then message_delta.
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_creation_input_tokens: 7340,
        cache_read_input_tokens: 13148,
        output_tokens: 64,
      }),
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_creation_input_tokens: 7340,
        cache_read_input_tokens: 13148,
        output_tokens: 80,
      }),
      // Message B — message_start then message_delta.
      streamingUsage("msg_b", {
        input_tokens: 1,
        cache_creation_input_tokens: 99,
        cache_read_input_tokens: 20488,
        output_tokens: 1,
      }),
      streamingUsage("msg_b", {
        input_tokens: 1,
        cache_creation_input_tokens: 99,
        cache_read_input_tokens: 20488,
        output_tokens: 12,
      }),
    ]);
    expect(state.liveTurnUsage).not.toBeNull();
    const rollup = rollupLiveTurnUsage(state.liveTurnUsage!);
    expect(rollup.inputTokens).toBe(4);
    expect(rollup.cacheCreationInputTokens).toBe(7439);
    expect(rollup.cacheReadInputTokens).toBe(33636);
    expect(rollup.outputTokens).toBe(92);
    // The rollup carries no dollar cost — that lands at cost_update.
    expect(rollup.totalCostUsd).toBe(0);
  });

  it("resets liveTurnUsage to null at handleSend (new turn starts clean)", () => {
    // Accumulate, complete the turn, then start a fresh turn.
    const afterTurn = applyAll(fresh(), [
      { type: "send", text: "first", atoms: [], turnKey: "k1" },
      streamingUsage("msg_a", { input_tokens: 3, output_tokens: 80 }),
      { type: "assistant_text", msg_id: "msg_a", text: "ok", is_partial: false },
      { type: "turn_complete", msg_id: "msg_a", result: "success" },
    ]);
    // Superseded at turn-complete.
    expect(afterTurn.liveTurnUsage).toBeNull();
    // A new turn's first frame builds from scratch.
    const nextTurn = applyAll(afterTurn, [
      { type: "send", text: "second", atoms: [], turnKey: "k2" },
    ]);
    expect(nextTurn.liveTurnUsage).toBeNull();
  });

  it("supersedes liveTurnUsage at handleTurnComplete — the committed cost_update is authoritative", () => {
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], turnKey: "k1" },
      streamingUsage("msg_a", {
        input_tokens: 3,
        cache_read_input_tokens: 13148,
        output_tokens: 80,
      }),
      { type: "assistant_text", msg_id: "msg_a", text: "ok", is_partial: false },
    ]);
    // Mid-turn: liveTurnUsage is populated.
    expect(state.liveTurnUsage).not.toBeNull();
    const completed = reduce(state, {
      type: "turn_complete",
      msg_id: "msg_a",
      result: "success",
    } as CodeSessionEvent).state;
    expect(completed.liveTurnUsage).toBeNull();
  });

  it("drops a frame with no msg_id — there is no key to accumulate under", () => {
    const state = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], turnKey: "k1" },
      { type: "streaming_usage", usage: { output_tokens: 50 } } as CodeSessionEvent,
    ]);
    expect(state.liveTurnUsage).toBeNull();
  });
});
