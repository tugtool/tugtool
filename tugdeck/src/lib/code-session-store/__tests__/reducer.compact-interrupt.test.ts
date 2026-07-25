/**
 * Reducer tests for interrupting a `/compact` turn.
 *
 * A compaction turn streams no answer-channel content for its whole run — by
 * design, and for minutes on a full context — so it satisfies every CASE A
 * precondition (no `assistant_text` delta, no `tool_use`) while being the least
 * pull-back-able turn there is. Taking CASE A there drops the in-flight scratch
 * and sends `interrupt{retract:true}`, which truncates the session JSONL at the
 * prompt record claude is about to append a `compact_boundary` after. The
 * result was a compaction that completed on disk and existed nowhere in the
 * card until a reload replayed it.
 *
 * Pins:
 *   - a `/compact` interrupt takes CASE B: plain `interrupt`, turn preserved,
 *     `interruptInFlight` set, no draft stranded back in the composer,
 *   - the same for the command-ATOM shape (the `/compact` chip),
 *   - a compaction that finishes despite the interrupt still gets its divider,
 *     because the turn was never pulled down,
 *   - an ordinary turn that merely mentions `/compact` mid-sentence keeps its
 *     CASE A pull-down.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import type { Effect } from "@/lib/code-session-store/effects";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

function fresh(): CodeSessionState {
  return createInitialState(FIXTURE_IDS.TUG_SESSION_ID, "test", "new");
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

function sentFrames(effects: Effect[]): unknown[] {
  return effects
    .filter((e) => e.kind === "send-frame")
    .map((e) => (e as { kind: "send-frame"; msg: unknown }).msg);
}

/** The `/compact` the Z2 menu dispatches: plain text, no atoms. */
function sendCompactText(args = ""): CodeSessionEvent {
  const text = args === "" ? "/compact" : `/compact ${args}`;
  return {
    type: "send",
    text,
    atoms: [],
    content: [{ type: "text" as const, text }],
    turnKey: "k1",
  } as CodeSessionEvent;
}

/** The `/compact` the composer's command completion mints: a leading chip. */
function sendCompactAtom(): CodeSessionEvent {
  return {
    type: "send",
    text: "￼ prepare to continue",
    atoms: [
      { kind: "atom", type: "command", label: "/compact", value: "compact" },
    ],
    content: [
      { type: "text" as const, text: "/compact prepare to continue" },
    ],
    turnKey: "k1",
  } as CodeSessionEvent;
}

describe("reducer — interrupting a compaction", () => {
  it("takes CASE B: plain interrupt, turn preserved, no draft stranded", () => {
    const { state: submitted } = applyAll(fresh(), [sendCompactText("focus")]);
    // Precondition: this really is the shape CASE A would otherwise claim.
    expect(submitted.firstAssistantDeltaAt).toBeNull();
    expect(submitted.firstToolUseAt).toBeNull();

    const { state: after, effects } = applyAll(submitted, [
      { type: "interrupt_action" },
    ]);

    // Plain interrupt — no `retract`, so no truncation of a JSONL claude may
    // still be appending the boundary to.
    expect(sentFrames(effects)).toEqual([{ type: "interrupt" }]);
    // The turn stays open for the far end to resolve.
    expect(after.pendingTurn).not.toBeNull();
    expect(after.scratch.get("k1")).toBeDefined();
    expect(after.interruptInFlight).toBe(true);
    expect(after.phase).not.toBe("idle");
    // `/compact` never belongs back in the composer.
    expect(after.pendingDraftRestore).toBeNull();
    // No CASE A echo suppression — the wire's `turn_complete` is wanted here.
    expect(after.pendingCaseAEchoes).toBe(0);
  });

  it("recognizes the command-atom shape too", () => {
    const { state: submitted } = applyAll(fresh(), [sendCompactAtom()]);
    const { state: after, effects } = applyAll(submitted, [
      { type: "interrupt_action" },
    ]);
    expect(sentFrames(effects)).toEqual([{ type: "interrupt" }]);
    expect(after.pendingTurn).not.toBeNull();
    expect(after.interruptInFlight).toBe(true);
  });

  it("still records the divider when the compaction finishes anyway", () => {
    const { state: interrupted } = applyAll(fresh(), [
      sendCompactText(),
      { type: "interrupt_action" },
    ]);
    // Claude Code did not abort: the boundary lands on the still-open turn.
    const { state: after } = applyAll(interrupted, [
      { type: "compact_boundary", trigger: "manual", preTokens: 170141 },
    ] as ReadonlyArray<CodeSessionEvent>);

    const messages = after.scratch.get("k1")?.messages ?? [];
    const note = messages.find(
      (m) => m.kind === "system_note" && m.source === "compact",
    );
    expect(note).toBeDefined();
    expect(note?.kind === "system_note" ? note.text : "").toContain(
      "Session compacted",
    );
  });

  it("leaves an ordinary turn's CASE A pull-down alone", () => {
    const text = "why did the /compact run so long?";
    const { state: submitted } = applyAll(fresh(), [
      {
        type: "send",
        text,
        atoms: [],
        content: [{ type: "text" as const, text }],
        turnKey: "k1",
      } as CodeSessionEvent,
    ]);
    const { state: after, effects } = applyAll(submitted, [
      { type: "interrupt_action" },
    ]);
    expect(sentFrames(effects)).toEqual([{ type: "interrupt", retract: true }]);
    expect(after.phase).toBe("idle");
    expect(after.pendingDraftRestore?.text).toBe(text);
  });
});
