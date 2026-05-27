/**
 * Reducer tests for the transport-downtime clock — the cumulative ms
 * with the transport disconnected during the in-flight turn, plus the
 * `transport_lost` terminal path that commits a TurnEntry when the
 * wire dies mid-turn.
 *
 * Wires INTO existing `handleTransportClose` / `handleTransportOpen` /
 * `handleTransportSettled` per [QT03 resolved] — no new wire format.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

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

function appendedEntries(effects: ReadonlyArray<Effect>) {
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

let now = 0;
let originalDateNow: () => number;
beforeEach(() => {
  now = 2_000_000_000;
  originalDateNow = Date.now;
  Date.now = () => now;
});
afterEach(() => {
  Date.now = originalDateNow;
});

function advance(ms: number): void {
  now += ms;
}

describe("reducer — transport downtime", () => {
  it("a turn with one disconnect/reconnect cycle accumulates the gap and increments reconnectCount", () => {
    // Submit + open the turn.
    const { state: s1 } = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], content: [{ type: "text" as const, text: "hi" }], turnKey: "k1" },
      {
        type: "assistant_text",
        msg_id: "m1",
      block_index: 0,
      text: "thinking",
        is_partial: true,
      },
    ]);
    advance(30);
    // Wire drops mid-stream → transport close lands.
    const { state: s2 } = applyAll(s1, [{ type: "transport_close" }]);
    // Mid-turn close commits a transport_lost TurnEntry; the user
    // recovers via re-send. So the same in-flight turn DOES NOT
    // resume — instead we test that the close handler kept downtime
    // bookkeeping correct for a subsequent recovery.
    expect(s2.transportNonOnlineSince).toBe(now);
    expect(s2.phase).toBe("errored");

    advance(500);
    const { state: s3 } = applyAll(s2, [{ type: "transport_open" }]);
    expect(s3.transportState).toBe("restoring");
    // Still non-online during the restoring window — timer stays open.
    expect(s3.transportNonOnlineSince).toBe(s2.transportNonOnlineSince);

    advance(250);
    const { state: s4 } = applyAll(s3, [{ type: "transport_settled" }]);
    expect(s4.transportState).toBe("online");
    expect(s4.transportNonOnlineSince).toBeNull();
    expect(s4.transportDowntimeAccumulatedMs).toBe(750);
    expect(s4.transportReconnectCount).toBe(1);
  });

  it("a turn that ends while the transport is down commits with turnEndReason transport_lost", () => {
    const { state: s1 } = applyAll(fresh(), [
      { type: "send", text: "hi", atoms: [], content: [{ type: "text" as const, text: "hi" }], turnKey: "k1" },
      {
        type: "assistant_text",
        msg_id: "m1",
      block_index: 0,
      text: "partial",
        is_partial: true,
      },
    ]);
    advance(40);
    const { state: s2, effects } = applyAll(s1, [
      { type: "transport_close" },
    ]);
    expect(s2.phase).toBe("errored");
    expect(s2.transportState).toBe("offline");
    // The in-flight turn was committed with reason: transport_lost.
    const appended = appendedEntries(effects);
    expect(appended.length).toBe(1);
    expect(appended[0].entry.turnEndReason).toBe("transport_lost");
    expect(appended[0].entry.msgId).toBe("m1");
    // The transcript entry no longer has an inflight pair to back it.
    expect(s2.pendingTurn).toBeNull();
  });

  it("two disconnect/reconnect cycles across an idle session accumulate the sum", () => {
    // Idle close → open → settled twice.
    const { state: s1 } = applyAll(fresh(), [{ type: "transport_close" }]);
    expect(s1.transportNonOnlineSince).toBe(now);
    advance(200);
    const { state: s2 } = applyAll(s1, [{ type: "transport_open" }]);
    advance(100);
    const { state: s3 } = applyAll(s2, [{ type: "transport_settled" }]);
    expect(s3.transportReconnectCount).toBe(1);
    expect(s3.transportDowntimeAccumulatedMs).toBe(300);

    advance(50);
    const { state: s4 } = applyAll(s3, [{ type: "transport_close" }]);
    advance(150);
    const { state: s5 } = applyAll(s4, [{ type: "transport_open" }]);
    advance(50);
    const { state: s6 } = applyAll(s5, [{ type: "transport_settled" }]);
    expect(s6.transportReconnectCount).toBe(2);
    expect(s6.transportDowntimeAccumulatedMs).toBe(500);
  });

  it("idempotent close on already-offline state is a no-op (returns same ref)", () => {
    const { state: s1 } = applyAll(fresh(), [{ type: "transport_close" }]);
    const { state: s2 } = applyAll(s1, [{ type: "transport_close" }]);
    expect(s2).toBe(s1);
  });
});
