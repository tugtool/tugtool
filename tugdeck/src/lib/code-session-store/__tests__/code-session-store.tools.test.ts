/**
 * Step 5 — tool call lifecycle. Exercises:
 *
 *  - test-05-tool-use-read: single logical tool call; reducer flips to
 *    `tool_work` on the first `tool_use` partial and back to
 *    `streaming` once the matching `tool_result` arrives; committed
 *    TurnEntry captures the Read call.
 *  - test-07-multiple-tool-calls: two concurrent logical ids
 *    simultaneously resident in `inflight.tools`; phase stays
 *    `tool_work` until BOTH resolve; committed TurnEntry preserves
 *    insertion order.
 *  - Insertion order property pinned directly on the committed
 *    transcript (covers [Q02]).
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import {
  MockTugConnection,
} from "@/lib/code-session-store/testing/mock-feed-store";
import {
  FIXTURE_IDS,
  loadGoldenProbe,
} from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";
import type { ToolCallState } from "@/lib/code-session-store/types";

function constructStore(conn: MockTugConnection): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
  });
}

function readInflightTools(store: CodeSessionStore): ToolCallState[] {
  const raw = store.streamingDocument.get("inflight.tools") as string;
  return JSON.parse(raw) as ToolCallState[];
}

describe("CodeSessionStore — tool lifecycle on test-05 (Step 5)", () => {
  it("flips to tool_work on the first tool_use and back to streaming on tool_result", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-05-tool-use-read");
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    const phases: string[] = [];
    store.subscribe(() => {
      const p = store.getSnapshot().phase;
      if (phases[phases.length - 1] !== p) phases.push(p);
    });

    store.send("read a file", []);

    // Dispatch events up to and including the first tool_use (idx 2
    // in test-05: session_init, system_metadata, tool_use input={}).
    for (let i = 0; i <= 2; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    expect(store.getSnapshot().phase).toBe("tool_work");

    const openingTools = readInflightTools(store);
    expect(openingTools.length).toBe(1);
    expect(openingTools[0].toolName).toBe("Read");
    expect(openingTools[0].status).toBe("pending");
    expect(openingTools[0].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID);

    // Dispatch events 3 (tool_use full) and 4 (tool_result) —
    // tool_result fires the all-done predicate and returns to streaming.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[3]);
    expect(store.getSnapshot().phase).toBe("tool_work");

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[4]);
    expect(store.getSnapshot().phase).toBe("streaming");

    const resolvedTools = readInflightTools(store);
    expect(resolvedTools.length).toBe(1);
    expect(resolvedTools[0].status).toBe("done");
    expect(resolvedTools[0].result).toBeDefined();

    // Continue through structured result + assistant text + turn_complete.
    for (let i = 5; i < probe.events.length; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(1);

    const turn = snap.transcript[0];
    expect(turn.toolCalls.length).toBe(1);
    expect(turn.toolCalls[0].toolName).toBe("Read");
    expect(turn.toolCalls[0].status).toBe("done");
    expect(turn.toolCalls[0].structuredResult).not.toBeNull();

    // inflight.tools cleared on turn_complete.
    expect(store.streamingDocument.get("inflight.tools")).toBe("[]");

    // Phase sequence for a tool-first turn skips awaiting_first_token;
    // submitting goes straight to tool_work when the first Claude-side
    // event is a tool_use.
    expect(phases).toEqual(["submitting", "tool_work", "streaming", "idle"]);
  });
});

describe("CodeSessionStore — concurrent tool calls on test-07 (Step 5)", () => {
  it("keeps two distinct tool_use_ids in inflight.tools simultaneously and only returns to streaming when both resolve", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-07-multiple-tool-calls");
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("read multiple files", []);

    // Event layout (0-indexed):
    //   0: session_init
    //   1: system_metadata
    //   2: tool_use input={}   — opens A (pending)
    //   3: tool_use input=full — A continuation
    //   4: tool_use input={}   — opens B (pending), A complete-input still resident
    //   5: tool_result         — resolves A (FIFO)
    //   6: tool_use_structured — binds A's structured_result
    //   7: tool_use input=full — B continuation
    //   8: tool_result         — resolves B
    //   9: tool_use_structured — binds B's structured_result
    //  10-14: assistant_text + cost + turn_complete

    // Dispatch through event 4. Both A and B should be present in
    // inflight.tools; A with full input, B with empty input.
    for (let i = 0; i <= 4; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    const bothOpen = readInflightTools(store);
    expect(bothOpen.length).toBe(2);
    expect(bothOpen[0].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID_N(1));
    expect(bothOpen[1].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID_N(2));
    expect(bothOpen[0].status).toBe("pending");
    expect(bothOpen[1].status).toBe("pending");
    expect(store.getSnapshot().phase).toBe("tool_work");

    // Event 5: tool_result resolves A. B is still pending, so we stay
    // in tool_work.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[5]);
    expect(store.getSnapshot().phase).toBe("tool_work");
    const afterA = readInflightTools(store);
    expect(afterA[0].status).toBe("done");
    expect(afterA[1].status).toBe("pending");

    // Events 6 (structured A) and 7 (B full input) do not change phase.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[6]);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[7]);
    expect(store.getSnapshot().phase).toBe("tool_work");

    // Event 8: tool_result resolves B. Every entry is now terminal →
    // the all-done predicate flips phase to streaming.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[8]);
    expect(store.getSnapshot().phase).toBe("streaming");
    const afterB = readInflightTools(store);
    expect(afterB[0].status).toBe("done");
    expect(afterB[1].status).toBe("done");

    // Drain the rest of the probe.
    for (let i = 9; i < probe.events.length; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(1);

    const turn = snap.transcript[0];
    expect(turn.toolCalls.length).toBe(2);
    // Insertion order [Q02]: A before B.
    expect(turn.toolCalls[0].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID_N(1));
    expect(turn.toolCalls[1].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID_N(2));
    expect(turn.toolCalls[0].status).toBe("done");
    expect(turn.toolCalls[1].status).toBe("done");
  });

  it("drops a stray tool_result for an unknown tool_use_id without mutating state", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("do stuff", []);

    const msgId = FIXTURE_IDS.MSG_ID;
    const tug = FIXTURE_IDS.TUG_SESSION_ID;

    // Open a known tool call.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "tool_use",
      tug_session_id: tug,
      msg_id: msgId,
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      tool_name: "Read",
      input: {},
      seq: 0,
    });
    expect(store.getSnapshot().phase).toBe("tool_work");

    // Stray result — tool_use_id never seen before. The reducer should
    // warn and leave state alone.
    const beforeStray = readInflightTools(store);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "tool_result",
      tug_session_id: tug,
      tool_use_id: "tool0000-0000-4000-8000-ffffffffffff",
      is_error: false,
      output: "ghost",
    });
    const afterStray = readInflightTools(store);

    expect(afterStray).toEqual(beforeStray);
    expect(store.getSnapshot().phase).toBe("tool_work");
    expect(afterStray[0].status).toBe("pending");
  });
});
