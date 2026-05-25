/**
 * Pure-logic reducer tests for the wake bracket — `handleWakeStarted`,
 * `handleTurnComplete`'s `waking → idle` commit branch, the loosened
 * `handleTextDelta` guard, interrupt during wake ([Q03]), the nested-
 * wake idempotency case, and the drop-case regressions that pin the
 * additive-guard contract at [D03].
 *
 * Bypasses the class wrapper — exercises `reduce(state, event)`
 * directly. The store-wrapper turnKey minting and the wire-frame
 * decoding are covered separately in
 * `code-session-store.wake.test.ts` and the fixture-replay test;
 * here we drive the reducer with already-decoded events carrying a
 * deterministic `turnKey` so assertions stay stable.
 *
 * See `roadmap/tugplan-tide-session-wake.md` Step 5 for the test
 * matrix and [D01]/[D03]/[Q03] for the rationale behind each case.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type {
  CodeSessionEvent,
  WakeStartedEvent,
} from "@/lib/code-session-store/events";
import type {
  AppendTranscriptEffect,
  Effect,
} from "@/lib/code-session-store/effects";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

const WAKE_TURN_KEY = "wake-test-turn-key";

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

function effectsOfKind<K extends Effect["kind"]>(
  effects: ReadonlyArray<Effect>,
  kind: K,
): Array<Extract<Effect, { kind: K }>> {
  return effects.filter((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
}

/**
 * Build a `wake_started` event with the wire-shape (snake_case)
 * `wake_trigger` payload. The reducer translates this to camelCase
 * `wakeTrigger` on `CodeSessionState`; tests assert on the
 * translated camelCase form.
 *
 * The `turnKey` field is what `frameToEvent` mints in the store
 * wrapper (covered by a sibling test); here we supply a stable value
 * so the test assertions are deterministic.
 */
function wakeStartedEvent(
  overrides: Partial<WakeStartedEvent["wake_trigger"]> = {},
  turnKey: string = WAKE_TURN_KEY,
): WakeStartedEvent {
  return {
    type: "wake_started",
    session_id: FIXTURE_IDS.CLAUDE_SESSION_ID,
    wake_trigger: {
      task_id: FIXTURE_IDS.TASK_ID,
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      status: "stopped",
      summary: "kernel lines in /var/log/system.log",
      output_file: "",
      ...overrides,
    },
    turnKey,
  };
}

// ---------------------------------------------------------------------------
// handleWakeStarted
// ---------------------------------------------------------------------------

describe("reduce — wake_started: idle → waking", () => {
  it("transitions idle → waking with translated camelCase wakeTrigger", () => {
    const { state, effects } = reduce(fresh(), wakeStartedEvent());

    expect(state.phase).toBe("waking");
    expect(state.wakeTrigger).toEqual({
      taskId: FIXTURE_IDS.TASK_ID,
      toolUseId: FIXTURE_IDS.TOOL_USE_ID,
      status: "stopped",
      summary: "kernel lines in /var/log/system.log",
      outputFile: "",
    });
    expect(effects.length).toBe(0);
  });

  it("sets pendingUserMessage to an empty-text marker carrying the event's turnKey", () => {
    const { state } = reduce(fresh(), wakeStartedEvent());

    expect(state.pendingUserMessage).not.toBeNull();
    expect(state.pendingUserMessage?.text).toBe("");
    expect(state.pendingUserMessage?.atoms).toEqual([]);
    expect(state.pendingUserMessage?.turnKey).toBe(WAKE_TURN_KEY);
  });

  it("clears per-turn telemetry via resetPerTurnTelemetry (spot-check firstAssistantDeltaAt, lastStreamEventAt, interruptInFlight)", () => {
    const seeded: CodeSessionState = {
      ...fresh(),
      firstAssistantDeltaAt: 999,
      lastStreamEventAt: 888,
      maxStreamGapMs: 250,
      interruptInFlight: true,
      awaitingApprovalAccumulatedMs: 4_000,
    };
    const { state } = reduce(seeded, wakeStartedEvent());

    expect(state.firstAssistantDeltaAt).toBeNull();
    expect(state.lastStreamEventAt).toBeNull();
    expect(state.maxStreamGapMs).toBe(0);
    expect(state.interruptInFlight).toBe(false);
    expect(state.awaitingApprovalAccumulatedMs).toBe(0);
  });

  it("snapshots costAtSubmit from lastCost so the wake's cost-delta has a baseline", () => {
    const seeded: CodeSessionState = {
      ...fresh(),
      lastCost: {
        totalCostUsd: 0.12,
        numTurns: 3,
        durationMs: 5_000,
        durationApiMs: 4_500,
        usage: null,
        modelUsage: null,
      },
    };
    const { state } = reduce(seeded, wakeStartedEvent());

    expect(state.costAtSubmit?.totalCostUsd).toBe(0.12);
  });

  it("preserves pendingDraftRestore — a wake must not clobber the user's in-progress draft", () => {
    const seeded: CodeSessionState = {
      ...fresh(),
      pendingDraftRestore: { text: "user was typing this", atoms: [] },
    };
    const { state } = reduce(seeded, wakeStartedEvent());

    expect(state.pendingDraftRestore).toEqual({
      text: "user was typing this",
      atoms: [],
    });
  });

  it("drops wake_started from non-idle phases other than waking (defensive)", () => {
    for (const phase of [
      "submitting",
      "awaiting_first_token",
      "streaming",
      "tool_work",
      "awaiting_approval",
      "replaying",
      "errored",
    ] as const) {
      const seeded: CodeSessionState = { ...fresh(), phase };
      const { state, effects } = reduce(seeded, wakeStartedEvent());
      expect(state).toBe(seeded);
      expect(effects.length).toBe(0);
    }
  });
});

describe("reduce — wake_started: nested wake idempotency", () => {
  it("a second wake_started while already waking is a no-op when wakeTrigger is already set", () => {
    const r1 = reduce(fresh(), wakeStartedEvent());
    const r2 = reduce(r1.state, wakeStartedEvent({ summary: "different summary" }));

    expect(r2.state).toBe(r1.state);
    expect(r2.effects.length).toBe(0);
  });

  it("a nested wake refreshes wakeTrigger only when the prior was null and the new payload arrives", () => {
    const r1 = reduce(fresh(), wakeStartedEvent());
    // Synthetic: clear wakeTrigger as if some terminal-error path had
    // cleared it without leaving waking phase (not reachable today,
    // but the refresh contract is on the reducer; this pins it).
    const cleared: CodeSessionState = { ...r1.state, wakeTrigger: null };
    const r2 = reduce(cleared, wakeStartedEvent({ summary: "refreshed" }));

    expect(r2.state.wakeTrigger?.summary).toBe("refreshed");
  });
});

// ---------------------------------------------------------------------------
// handleTextDelta — guard loosening + bracket marker
// ---------------------------------------------------------------------------

describe("reduce — assistant_text during waking", () => {
  it("accepts assistant_text during waking and sets activeMsgId from the first event", () => {
    const seeded = reduce(fresh(), wakeStartedEvent()).state;
    const { state, effects } = reduce(seeded, {
      type: "assistant_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "looking at system.log",
      is_partial: true,
    });

    // Phase stays waking — the bracket pair owns phase entry/exit
    // (mirrors the replaying pattern).
    expect(state.phase).toBe("waking");
    expect(state.activeMsgId).toBe(FIXTURE_IDS.MSG_ID);
    expect(state.scratch.get(FIXTURE_IDS.MSG_ID)?.assistant).toBe(
      "looking at system.log",
    );
    expect(effectsOfKind(effects, "write-inflight")[0]?.channel).toBe(
      "assistant",
    );
  });

  it("activeMsgId binding prevents handleTurnComplete's idle/null early-return from firing", () => {
    // Without the activeMsgId binding, a wake's terminal turn_complete
    // would hit `activeMsgId === null && phase === "idle"` early-return
    // and silently drop. This test pins that the first text event
    // sets activeMsgId so the guard doesn't fire.
    const path = applyAll(fresh(), [
      wakeStartedEvent(),
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "wake content",
        is_partial: false,
      },
    ]);
    expect(path.state.activeMsgId).toBe(FIXTURE_IDS.MSG_ID);

    // Now drive turn_complete — should NOT early-return.
    const r = reduce(path.state, {
      type: "turn_complete",
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "success",
    });
    expect(r.state.phase).toBe("idle");
    expect(effectsOfKind(r.effects, "append-transcript").length).toBe(1);
  });

  it("captures firstAssistantDeltaAt for the wake's TTFT (live event arrival, not replay)", () => {
    const seeded = reduce(fresh(), wakeStartedEvent()).state;
    expect(seeded.firstAssistantDeltaAt).toBeNull();

    const { state } = reduce(seeded, {
      type: "assistant_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "first delta",
      is_partial: true,
    });

    expect(state.firstAssistantDeltaAt).not.toBeNull();
  });
});

describe("reduce — drop-case regressions ([D03] additive-guard contract)", () => {
  it("still drops assistant_text outside any active turn or wake (e.g. idle without wake_started)", () => {
    const s0 = fresh();
    const { state, effects } = reduce(s0, {
      type: "assistant_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "ghost",
      is_partial: true,
    });
    expect(state).toBe(s0);
    expect(effects.length).toBe(0);
  });

  it("still drops thinking_text outside any active turn or wake", () => {
    const s0 = fresh();
    const { state, effects } = reduce(s0, {
      type: "thinking_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "ghost",
      is_partial: true,
    });
    expect(state).toBe(s0);
    expect(effects.length).toBe(0);
  });

  it("still drops assistant_text from awaiting_approval (no change to that drop path)", () => {
    const seeded: CodeSessionState = { ...fresh(), phase: "awaiting_approval" };
    const { state, effects } = reduce(seeded, {
      type: "assistant_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "ghost",
      is_partial: true,
    });
    expect(state).toBe(seeded);
    expect(effects.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleTurnComplete — waking → idle commit branch
// ---------------------------------------------------------------------------

describe("reduce — turn_complete during waking", () => {
  it("commits a TurnEntry, transitions to idle, clears wakeTrigger and pendingUserMessage", () => {
    const path = applyAll(fresh(), [
      wakeStartedEvent(),
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "wake-content",
        is_partial: false,
      },
    ]);

    const { state, effects } = reduce(path.state, {
      type: "turn_complete",
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "success",
    });

    expect(state.phase).toBe("idle");
    expect(state.wakeTrigger).toBeNull();
    expect(state.pendingUserMessage).toBeNull();
    expect(state.activeMsgId).toBeNull();

    const appended = effectsOfKind(effects, "append-transcript");
    expect(appended.length).toBe(1);
    const entry = (appended[0] as AppendTranscriptEffect).entry;
    expect(entry.assistant).toBe("wake-content");
    expect(entry.result).toBe("success");
    expect(effectsOfKind(effects, "clear-inflight").length).toBe(1);
  });

  it("committed TurnEntry's userMessage.text is the empty-string wake sentinel (no phantom user bubble)", () => {
    const path = applyAll(fresh(), [
      wakeStartedEvent(),
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "wake-content",
        is_partial: false,
      },
    ]);

    const { effects } = reduce(path.state, {
      type: "turn_complete",
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "success",
    });

    const entry = (effectsOfKind(effects, "append-transcript")[0] as AppendTranscriptEffect)
      .entry;
    // The empty-text userMessage is the wake sentinel — consumers
    // check `text === ""` and skip the user-bubble render. This pins
    // the marker; a future change that injects "wake" or other
    // placeholder text would break it and force a chrome-side rethink.
    expect(entry.userMessage.text).toBe("");
    expect(entry.userMessage.attachments).toEqual([]);
  });

  it("interrupted wake (turn_complete error after CASE B-style interrupt) commits as interrupted and clears wakeTrigger", () => {
    const path = applyAll(fresh(), [
      wakeStartedEvent(),
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "partial wake content",
        is_partial: true,
      },
    ]);
    const interrupted = reduce(path.state, { type: "interrupt_action" }).state;

    const { state, effects } = reduce(interrupted, {
      type: "turn_complete",
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "error",
    });

    expect(state.phase).toBe("idle");
    expect(state.wakeTrigger).toBeNull();
    const entry = (effectsOfKind(effects, "append-transcript")[0] as AppendTranscriptEffect)
      .entry;
    expect(entry.result).toBe("interrupted");
    expect(entry.assistant).toBe("partial wake content");
  });
});

// ---------------------------------------------------------------------------
// handleSend during waking — enqueues, mirrors streaming
// ---------------------------------------------------------------------------

describe("reduce — send during waking", () => {
  it("a user send during waking enqueues into queuedSends (no immediate send-frame, phase stays waking)", () => {
    const seeded = reduce(fresh(), wakeStartedEvent()).state;

    const { state, effects } = reduce(seeded, {
      type: "send",
      text: "user typed during wake",
      atoms: [],
      turnKey: "queued-turn-key",
    });

    expect(state.phase).toBe("waking");
    expect(state.queuedSends.length).toBe(1);
    expect(state.queuedSends[0].text).toBe("user typed during wake");
    expect(state.queuedSends[0].turnKey).toBe("queued-turn-key");
    expect(effectsOfKind(effects, "send-frame").length).toBe(0);
  });

  it("the wake's commit does NOT flush the queued send — the queued send waits for a normal idle turn", () => {
    const path = applyAll(fresh(), [
      wakeStartedEvent(),
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "wake content",
        is_partial: false,
      },
      {
        type: "send",
        text: "queued during wake",
        atoms: [],
        turnKey: "queued-turn-key",
      },
    ]);
    expect(path.state.queuedSends.length).toBe(1);

    const r = reduce(path.state, {
      type: "turn_complete",
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "success",
    });

    // The wake commit transitions to idle but leaves the queued send
    // intact. The next user-driven `send` (or an explicit flush) is
    // what dispatches the queued message; the wake does not surprise
    // the user by auto-dispatching their queued text.
    expect(r.state.phase).toBe("idle");
    expect(r.state.queuedSends.length).toBe(1);
    expect(effectsOfKind(r.effects, "send-frame").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// interrupt during wake ([Q03])
// ---------------------------------------------------------------------------

describe("reduce — interrupt during wake ([Q03])", () => {
  it("CASE A wake pull-down: no content yet → idle, clears wakeTrigger, sends interrupt frame, increments pendingCaseAEchoes, skips draft restore", () => {
    const seeded = reduce(fresh(), wakeStartedEvent()).state;
    expect(seeded.pendingDraftRestore).toBeNull();

    const { state, effects } = reduce(seeded, { type: "interrupt_action" });

    expect(state.phase).toBe("idle");
    expect(state.wakeTrigger).toBeNull();
    expect(state.pendingUserMessage).toBeNull();
    // The empty-text marker is NOT a user submission — it must not
    // land in the draft-restore slot.
    expect(state.pendingDraftRestore).toBeNull();
    expect(state.pendingCaseAEchoes).toBe(1);

    const frames = effectsOfKind(effects, "send-frame");
    expect(frames.length).toBe(1);
    expect(frames[0].msg).toEqual({ type: "interrupt" });
  });

  it("CASE A wake pull-down preserves any prior pendingDraftRestore", () => {
    const seeded: CodeSessionState = {
      ...reduce(fresh(), wakeStartedEvent()).state,
      pendingDraftRestore: { text: "user was typing this", atoms: [] },
    };
    const { state } = reduce(seeded, { type: "interrupt_action" });
    expect(state.pendingDraftRestore).toEqual({
      text: "user was typing this",
      atoms: [],
    });
  });

  it("CASE B wake interrupt: content has landed → interruptInFlight opens, wakeTrigger remains pending bracket-close", () => {
    const path = applyAll(fresh(), [
      wakeStartedEvent(),
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "partial",
        is_partial: true,
      },
    ]);
    const { state, effects } = reduce(path.state, { type: "interrupt_action" });

    expect(state.interruptInFlight).toBe(true);
    expect(state.interruptInFlightSegmentStartedAt).not.toBeNull();
    // wakeTrigger stays set during the round-trip — it is cleared by
    // the new `waking → idle` commit branch when `turn_complete(error)`
    // lands.
    expect(state.wakeTrigger).not.toBeNull();
    expect(state.phase).toBe("waking");

    const frames = effectsOfKind(effects, "send-frame");
    expect(frames.length).toBe(1);
    expect(frames[0].msg).toEqual({ type: "interrupt" });
  });

  it("wire echo for CASE A wake pull-down is suppressed by the pendingCaseAEchoes counter", () => {
    const seeded = reduce(fresh(), wakeStartedEvent()).state;
    const afterInterrupt = reduce(seeded, { type: "interrupt_action" }).state;
    expect(afterInterrupt.pendingCaseAEchoes).toBe(1);

    // The aborted cycle's eventual turn_complete(error) carries an
    // empty msg_id and lands while `activeMsgId === null`. The gate at
    // the top of `handleTurnComplete` suppresses it and decrements the
    // counter.
    const echo = reduce(afterInterrupt, {
      type: "turn_complete",
      msg_id: "",
      result: "error",
    });
    expect(echo.state.pendingCaseAEchoes).toBe(0);
    expect(echo.effects.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Terminal-error paths defensively clear wakeTrigger
// ---------------------------------------------------------------------------

describe("reduce — terminal-error paths clear wakeTrigger", () => {
  it("session_state_errored from waking clears wakeTrigger", () => {
    const seeded = reduce(fresh(), wakeStartedEvent()).state;
    expect(seeded.wakeTrigger).not.toBeNull();

    const { state } = reduce(seeded, {
      type: "session_state_errored",
      detail: "test",
    });
    expect(state.phase).toBe("errored");
    expect(state.wakeTrigger).toBeNull();
  });

  it("wire error from waking clears wakeTrigger", () => {
    const seeded = reduce(fresh(), wakeStartedEvent()).state;
    const { state } = reduce(seeded, { type: "error", message: "boom" });
    expect(state.phase).toBe("errored");
    expect(state.wakeTrigger).toBeNull();
  });

  it("transport_close from waking commits a transport-lost entry and clears wakeTrigger", () => {
    const path = applyAll(fresh(), [
      wakeStartedEvent(),
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "partial",
        is_partial: true,
      },
    ]);
    const { state, effects } = reduce(path.state, { type: "transport_close" });

    expect(state.phase).toBe("errored");
    expect(state.wakeTrigger).toBeNull();
    // Transport-lost commits a TurnEntry so the transcript records
    // what happened.
    expect(effectsOfKind(effects, "append-transcript").length).toBe(1);
  });
});
