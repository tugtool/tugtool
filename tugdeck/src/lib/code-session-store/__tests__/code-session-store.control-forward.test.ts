/**
 * Step 6 — control request forward lifecycle. Exercises:
 *
 *  - Synthetic permission-allow dispatch: v2.1.105 has no fixture that
 *    captures a user-gated allow flow (test-08 is a tool-error probe,
 *    test-09 is bash-auto-approved). We hand-build the
 *    `control_request_forward` event, verify the store flips to
 *    `awaiting_approval`, call `respondApproval`, and assert both the
 *    outbound `tool_approval` frame and phase restoration.
 *  - `v2.1.105/test-11-permission-deny-roundtrip.jsonl` replay: the
 *    real deny flow, round-tripped through the store with an injected
 *    `respondApproval(..., { decision: "deny" })` at the control forward
 *    arrival point. Verifies the full downstream turn still commits
 *    correctly with the Read tool marked as error.
 *  - Synthetic `AskUserQuestion` dispatch: `test-35-askuserquestion-flow`
 *    is empty/skipped in the v2.1.105 manifest, so a hand-built
 *    `control_request_forward { is_question: true }` drives the
 *    question path and asserts the outbound `question_answer` frame.
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

function constructStore(conn: MockTugConnection): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
  });
}

/**
 * Dispatch a synthetic `assistant_text` partial so the store reaches
 * `streaming`. Used by the synthetic-only tests to establish a
 * pre-forward phase the reducer can restore to.
 */
function drainToStreaming(
  conn: MockTugConnection,
  store: CodeSessionStore,
  msgId: string,
): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: "a",
    is_partial: true,
    rev: 0,
    seq: 0,
  });
  // submitting → awaiting_first_token
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: "b",
    is_partial: true,
    rev: 1,
    seq: 0,
  });
  // awaiting_first_token → streaming
  expect(store.getSnapshot().phase).toBe("streaming");
}

describe("CodeSessionStore — synthetic permission-allow (Step 6)", () => {
  it("flips to awaiting_approval on control_request_forward and restores on respondApproval", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("ls the cwd", []);
    drainToStreaming(conn, store, FIXTURE_IDS.MSG_ID);

    // Synthetic forward: Bash tool is being asked to run `ls`.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "control_request_forward",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      request_id: FIXTURE_IDS.REQUEST_ID,
      is_question: false,
      tool_name: "Bash",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      input: { command: "ls" },
    });

    let snap = store.getSnapshot();
    expect(snap.phase).toBe("awaiting_approval");
    expect(snap.pendingApproval).not.toBeNull();
    expect(snap.pendingApproval?.request_id).toBe(FIXTURE_IDS.REQUEST_ID);
    expect(snap.pendingApproval?.is_question).toBe(false);
    expect(snap.pendingApproval?.tool_name).toBe("Bash");
    expect(snap.pendingQuestion).toBeNull();

    const framesBefore = conn.recordedFrames.length;
    store.respondApproval(FIXTURE_IDS.REQUEST_ID, { decision: "allow" });

    snap = store.getSnapshot();
    expect(snap.phase).toBe("streaming");
    expect(snap.pendingApproval).toBeNull();

    // Exactly one new frame: the tool_approval.
    expect(conn.recordedFrames.length).toBe(framesBefore + 1);
    const approval = conn.recordedFrames[framesBefore];
    expect(approval.feedId).toBe(FeedId.CODE_INPUT);
    expect(approval.decoded).toEqual({
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      type: "tool_approval",
      request_id: FIXTURE_IDS.REQUEST_ID,
      decision: "allow",
    });
  });

  it("drops respondApproval when no pending approval is set", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hello", []);
    const framesBefore = conn.recordedFrames.length;
    store.respondApproval(FIXTURE_IDS.REQUEST_ID, { decision: "allow" });
    expect(conn.recordedFrames.length).toBe(framesBefore);
    expect(store.getSnapshot().phase).toBe("submitting");
  });
});

describe("CodeSessionStore — permission deny on test-11 (Step 6)", () => {
  it("round-trips the deny fixture with respondApproval mid-turn", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-11-permission-deny-roundtrip");
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("read a nonexistent file", []);

    // Event layout (see fixture walkthrough in plan Step 6):
    //  0: session_init
    //  1: system_metadata
    //  2: tool_use input={}           — opens Read (pending)
    //  3: tool_use input={file_path}  — Read continuation
    //  4: control_request_forward     — is_question:false, Read
    //  5: tool_result is_error:true   — denied
    //  6: tool_use_structured
    //  7..9: assistant_text partials
    //  10: cost_update
    //  11: assistant_text complete
    //  12: turn_complete
    for (let i = 0; i <= 4; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    expect(store.getSnapshot().phase).toBe("awaiting_approval");
    const approval = store.getSnapshot().pendingApproval;
    expect(approval?.request_id).toBe(FIXTURE_IDS.REQUEST_ID);
    // decision_reason and permission_suggestions are named optional
    // fields on ControlRequestForward so T3.4.b can read them directly
    // instead of chasing `[key: string]: unknown` casts.
    expect(approval?.decision_reason).toBe(
      "Path is outside allowed working directories",
    );
    expect(Array.isArray(approval?.permission_suggestions)).toBe(true);
    expect(approval?.permission_suggestions?.length).toBeGreaterThan(0);

    const framesBefore = conn.recordedFrames.length;
    store.respondApproval(FIXTURE_IDS.REQUEST_ID, { decision: "deny" });

    expect(conn.recordedFrames.length).toBe(framesBefore + 1);
    const denyFrame = conn.recordedFrames[framesBefore];
    expect(denyFrame.decoded).toEqual({
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      type: "tool_approval",
      request_id: FIXTURE_IDS.REQUEST_ID,
      decision: "deny",
    });
    // prevPhase was tool_work (the turn was in tool_work when the
    // forward landed), so the reducer restores to tool_work.
    expect(store.getSnapshot().phase).toBe("tool_work");
    expect(store.getSnapshot().pendingApproval).toBeNull();

    // Drain the remaining events through turn_complete.
    for (let i = 5; i < probe.events.length; i++) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
    }

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(1);

    const turn = snap.transcript[0];
    expect(turn.toolCalls.length).toBe(1);
    expect(turn.toolCalls[0].toolName).toBe("Read");
    expect(turn.toolCalls[0].status).toBe("error");
    expect(turn.result).toBe("success");
    // cost_update rode the fixture; the f64 placeholder resolves to 0.
    expect(snap.lastCost?.totalCostUsd).toBe(0);
  });
});

describe("CodeSessionStore — synthetic AskUserQuestion (Step 6)", () => {
  it("populates pendingQuestion and emits question_answer on respondQuestion", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("ask me something", []);
    drainToStreaming(conn, store, FIXTURE_IDS.MSG_ID);

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "control_request_forward",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      request_id: FIXTURE_IDS.REQUEST_ID,
      is_question: true,
      question: "pick one",
      options: [
        { key: "a", label: "Option A" },
        { key: "b", label: "Option B" },
      ],
    });

    let snap = store.getSnapshot();
    expect(snap.phase).toBe("awaiting_approval");
    expect(snap.pendingQuestion).not.toBeNull();
    expect(snap.pendingQuestion?.request_id).toBe(FIXTURE_IDS.REQUEST_ID);
    expect(snap.pendingQuestion?.is_question).toBe(true);
    expect(snap.pendingApproval).toBeNull();

    const framesBefore = conn.recordedFrames.length;
    store.respondQuestion(FIXTURE_IDS.REQUEST_ID, { answers: { pick: "a" } });

    snap = store.getSnapshot();
    expect(snap.phase).toBe("streaming");
    expect(snap.pendingQuestion).toBeNull();

    expect(conn.recordedFrames.length).toBe(framesBefore + 1);
    const answerFrame = conn.recordedFrames[framesBefore];
    expect(answerFrame.feedId).toBe(FeedId.CODE_INPUT);
    expect(answerFrame.decoded).toEqual({
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      type: "question_answer",
      request_id: FIXTURE_IDS.REQUEST_ID,
      answers: { pick: "a" },
    });
  });

  it("drops respondQuestion when no pending question is set", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hello", []);
    const framesBefore = conn.recordedFrames.length;
    store.respondQuestion(FIXTURE_IDS.REQUEST_ID, { answers: { pick: "a" } });
    expect(conn.recordedFrames.length).toBe(framesBefore);
  });
});
