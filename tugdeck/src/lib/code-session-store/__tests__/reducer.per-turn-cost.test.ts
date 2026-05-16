/**
 * Reducer tests for the per-turn cost delta — `handleSend` snapshots
 * `lastCost` into `costAtSubmit`; `handleTurnComplete` computes the
 * `after - before` delta via `extractTurnCost` and freezes it onto the
 * committed `TurnEntry.cost`.
 *
 * Per Investigation A, `cost_update.usage` is cumulative-per-session
 * on the live wire. The helper still tolerates per-turn payloads
 * (the alternate hypothesis): for the FIRST turn of a session,
 * `costAtSubmit === null` and the delta degenerates to `after`.
 *
 * Pins:
 *   - cumulative shape: per-turn delta is `after - before`,
 *   - per-turn shape (first-of-session): delta degenerates to `after`,
 *   - no cost_update for a turn → committed cost is all zeros,
 *   - cost snapshot is taken at submit time, not at completion.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import type {
  AppendTranscriptEffect,
  Effect,
} from "@/lib/code-session-store/effects";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

function fresh(): CodeSessionState {
  return createInitialState(FIXTURE_IDS.TUG_SESSION_ID, "test", "new");
}

function appended(effects: ReadonlyArray<Effect>) {
  return effects.filter(
    (e): e is AppendTranscriptEffect => e.kind === "append-transcript",
  );
}

function applyAll(
  state: CodeSessionState,
  events: ReadonlyArray<CodeSessionEvent>,
): { state: CodeSessionState; effects: Effect[] } {
  let current = state;
  const collected: Effect[] = [];
  for (const ev of events) {
    const r = reduce(current, ev);
    current = r.state;
    collected.push(...r.effects);
  }
  return { state: current, effects: collected };
}

describe("reducer — per-turn cost delta", () => {
  it("first-of-session turn: costAtSubmit is null and the delta degenerates to `after`", () => {
    const events: CodeSessionEvent[] = [
      { type: "send", text: "hi", atoms: [], turnKey: "k1" },
      {
        type: "assistant_text",
        msg_id: "m1",
        text: "ok",
        is_partial: false,
      },
      {
        type: "cost_update",
        total_cost_usd: 0.045,
        num_turns: 1,
        usage: {
          input_tokens: 3,
          output_tokens: 10,
          cache_creation_input_tokens: 6180,
          cache_read_input_tokens: 12507,
        },
        modelUsage: null,
      },
      { type: "turn_complete", msg_id: "m1", result: "success" },
    ];
    const { effects } = applyAll(fresh(), events);
    const entry = appended(effects)[0].entry;
    expect(entry.cost.inputTokens).toBe(3);
    expect(entry.cost.outputTokens).toBe(10);
    expect(entry.cost.cacheCreationInputTokens).toBe(6180);
    expect(entry.cost.cacheReadInputTokens).toBe(12507);
    expect(entry.cost.totalCostUsd).toBeCloseTo(0.045);
  });

  it("cumulative cost_update.usage: second turn reports the per-turn delta", () => {
    // Turn 1: tokens=(3, 10, 6180, 12507), cost=0.045 → entry.cost == this delta.
    const r1 = applyAll(fresh(), [
      { type: "send", text: "first", atoms: [], turnKey: "k1" },
      {
        type: "assistant_text",
        msg_id: "m1",
        text: "ok",
        is_partial: false,
      },
      {
        type: "cost_update",
        total_cost_usd: 0.045,
        num_turns: 1,
        usage: {
          input_tokens: 3,
          output_tokens: 10,
          cache_creation_input_tokens: 6180,
          cache_read_input_tokens: 12507,
        },
        modelUsage: null,
      },
      { type: "turn_complete", msg_id: "m1", result: "success" },
    ]);
    // Turn 2: cumulative grows. tokens=(4, 180, 6349, 31204), cost=0.060.
    const r2 = applyAll(r1.state, [
      { type: "send", text: "second", atoms: [], turnKey: "k2" },
      {
        type: "assistant_text",
        msg_id: "m2",
        text: "done",
        is_partial: false,
      },
      {
        type: "cost_update",
        total_cost_usd: 0.06,
        num_turns: 2,
        usage: {
          input_tokens: 4,
          output_tokens: 180,
          cache_creation_input_tokens: 6349,
          cache_read_input_tokens: 31204,
        },
        modelUsage: null,
      },
      { type: "turn_complete", msg_id: "m2", result: "success" },
    ]);
    const entry2 = appended(r2.effects)[0].entry;
    expect(entry2.cost.inputTokens).toBe(4 - 3);
    expect(entry2.cost.outputTokens).toBe(180 - 10);
    expect(entry2.cost.cacheCreationInputTokens).toBe(6349 - 6180);
    expect(entry2.cost.cacheReadInputTokens).toBe(31204 - 12507);
    expect(entry2.cost.totalCostUsd).toBeCloseTo(0.06 - 0.045);
  });

  it("a turn with NO cost_update commits with cost = all zeros", () => {
    const { effects } = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], turnKey: "k1" },
      {
        type: "assistant_text",
        msg_id: "m1",
        text: "ok",
        is_partial: false,
      },
      { type: "turn_complete", msg_id: "m1", result: "success" },
    ]);
    const entry = appended(effects)[0].entry;
    expect(entry.cost.inputTokens).toBe(0);
    expect(entry.cost.outputTokens).toBe(0);
    expect(entry.cost.cacheCreationInputTokens).toBe(0);
    expect(entry.cost.cacheReadInputTokens).toBe(0);
    expect(entry.cost.totalCostUsd).toBe(0);
  });

  it("costAtSubmit is snapshotted at handleSend, not at completion", () => {
    // Seed a lastCost from a prior turn.
    const seeded = applyAll(fresh(), [
      { type: "send", text: "first", atoms: [], turnKey: "k1" },
      {
        type: "assistant_text",
        msg_id: "m1",
        text: "ok",
        is_partial: false,
      },
      {
        type: "cost_update",
        total_cost_usd: 0.045,
        num_turns: 1,
        usage: {
          input_tokens: 3,
          output_tokens: 10,
          cache_creation_input_tokens: 6180,
          cache_read_input_tokens: 12507,
        },
        modelUsage: null,
      },
      { type: "turn_complete", msg_id: "m1", result: "success" },
    ]).state;

    // New send. costAtSubmit should equal the seeded lastCost.
    const afterSend = applyAll(seeded, [
      { type: "send", text: "next", atoms: [], turnKey: "k2" },
    ]).state;
    expect(afterSend.costAtSubmit).not.toBeNull();
    expect(afterSend.costAtSubmit?.totalCostUsd).toBeCloseTo(0.045);
  });
});
