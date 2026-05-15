/**
 * Reducer unit tests — exercise `reduce(state, event)` directly
 * without a class, connection, or PropertyStore. These pin the pure
 * state-machine logic at the level where regressions are cheapest to
 * reason about.
 *
 * The class integration tests (round-trip / deltas / tools / ...)
 * cover the same paths end-to-end through `TestFrameChannel`; this
 * file exists because the plan's "Reducer split for testability"
 * section explicitly advocates a unit tier that bypasses the wrapper.
 */

import { describe, it, expect } from "bun:test";

import {
  reduce,
  createInitialState,
  type CodeSessionState,
} from "@/lib/code-session-store/reducer";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";
import type {
  Effect,
  AppendTranscriptEffect,
} from "@/lib/code-session-store/effects";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import type { ToolCallState } from "@/lib/code-session-store/types";

function fresh(): CodeSessionState {
  return createInitialState(FIXTURE_IDS.TUG_SESSION_ID, "test", "new");
}

/**
 * `fresh()` augmented with a synthetic in-flight `pendingUserMessage`.
 * Tests that exercise the in-turn handlers (text deltas, tool_use,
 * tool_result) need the state to look like the reducer has run
 * `handleSend` first — production code never reaches these handlers
 * without an in-flight turn, and the streaming-write effects need
 * `pendingUserMessage.turnKey` to construct the per-turn PropertyStore
 * path. Provides a deterministic `turnKey` so test assertions on the
 * path can be exact.
 */
function freshInflight(
  phase: CodeSessionState["phase"] = "submitting",
  turnKey: string = "test-turn-key",
): CodeSessionState {
  return {
    ...fresh(),
    phase,
    pendingUserMessage: {
      text: "",
      atoms: [],
      submitAt: 0,
      turnKey,
    },
  };
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

function toolEntry(
  toolUseId: string,
  toolName: string,
  status: ToolCallState["status"],
  input: unknown = {},
): ToolCallState {
  return {
    toolUseId,
    toolName,
    input,
    status,
    result: null,
    structuredResult: null,
  };
}

// ---------------------------------------------------------------------------
// handleSend
// ---------------------------------------------------------------------------

describe("reduce — send", () => {
  it("idle → submitting with a user_message SendFrame effect", () => {
    const { state, effects } = reduce(fresh(), {
      type: "send",
      text: "hello",
      atoms: [],
    });

    expect(state.phase).toBe("submitting");
    expect(state.pendingUserMessage?.text).toBe("hello");

    const frames = effectsOfKind(effects, "send-frame");
    expect(frames.length).toBe(1);
    expect(frames[0].msg).toEqual({
      type: "user_message",
      text: "hello",
      attachments: [],
    });
  });

  it("errored → submitting and leaves lastError populated (cleared by next turn_complete success)", () => {
    const prior: CodeSessionState = {
      ...fresh(),
      phase: "errored",
      lastError: {
        cause: "session_state_errored",
        message: "crash",
        at: 1234,
      },
    };
    const { state, effects } = reduce(prior, {
      type: "send",
      text: "retry",
      atoms: [],
    });

    expect(state.phase).toBe("submitting");
    expect(state.lastError).not.toBeNull();
    expect(effectsOfKind(effects, "send-frame").length).toBe(1);
  });

  it("enqueues send while in a non-idle/non-errored phase (Step 7)", () => {
    const prior: CodeSessionState = { ...fresh(), phase: "streaming" };
    const { state, effects } = reduce(prior, {
      type: "send",
      text: "mid",
      atoms: [],
    });

    expect(state.phase).toBe("streaming");
    expect(state.queuedSends.length).toBe(1);
    expect(state.queuedSends[0].text).toBe("mid");
    expect(effects.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleSessionInit
// ---------------------------------------------------------------------------

describe("reduce — session_init", () => {
  it("returns the same state reference (no mutation; tugdeck operates on tugSessionId only)", () => {
    const seeded = fresh();
    const { state, effects } = reduce(seeded, {
      type: "session_init",
      session_id: FIXTURE_IDS.CLAUDE_SESSION_ID,
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    });
    expect(state).toBe(seeded);
    expect(effects.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleTextDelta via assistant_text and thinking_text
// ---------------------------------------------------------------------------

describe("reduce — assistant_text delta accumulation", () => {
  it("submitting → awaiting_first_token on the first partial, accumulates on subsequent", () => {
    const s0: CodeSessionState = freshInflight("submitting");

    const r1 = reduce(s0, {
      type: "assistant_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "alpha",
      is_partial: true,
    });
    expect(r1.state.phase).toBe("awaiting_first_token");
    expect(r1.state.activeMsgId).toBe(FIXTURE_IDS.MSG_ID);
    const w1 = effectsOfKind(r1.effects, "write-inflight");
    expect(w1[0]?.channel).toBe("assistant");
    expect(w1[0]?.value).toBe("alpha");

    const r2 = reduce(r1.state, {
      type: "assistant_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "beta",
      is_partial: true,
    });
    expect(r2.state.phase).toBe("streaming");
    const w2 = effectsOfKind(r2.effects, "write-inflight");
    expect(w2[0]?.value).toBe("alphabeta");
  });

  it("replaces scratch with authoritative text on is_partial:false", () => {
    const s0: CodeSessionState = freshInflight("streaming");
    const seeded = new Map(s0.scratch);
    seeded.set(FIXTURE_IDS.MSG_ID, { assistant: "junk", thinking: "" });
    const s1: CodeSessionState = {
      ...s0,
      scratch: seeded,
      activeMsgId: FIXTURE_IDS.MSG_ID,
    };

    const { state, effects } = reduce(s1, {
      type: "assistant_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "FINAL",
      is_partial: false,
    });

    expect(state.phase).toBe("streaming");
    expect(state.scratch.get(FIXTURE_IDS.MSG_ID)?.assistant).toBe("FINAL");
    expect(effectsOfKind(effects, "write-inflight")[0]?.value).toBe("FINAL");
  });

  it("drops assistant_text outside of an active turn", () => {
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
});

describe("reduce — thinking_text delta accumulation", () => {
  it("uses the thinking field of scratch and inflight.thinking path", () => {
    const s0: CodeSessionState = freshInflight("submitting");
    const r1 = reduce(s0, {
      type: "thinking_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "hmm",
      is_partial: true,
    });
    const r2 = reduce(r1.state, {
      type: "thinking_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: " ok",
      is_partial: true,
    });
    expect(r2.state.phase).toBe("streaming");
    expect(r2.state.scratch.get(FIXTURE_IDS.MSG_ID)?.thinking).toBe("hmm ok");
    expect(r2.state.scratch.get(FIXTURE_IDS.MSG_ID)?.assistant).toBe("");
    expect(effectsOfKind(r2.effects, "write-inflight")[0]?.channel).toBe(
      "thinking",
    );
  });
});

// ---------------------------------------------------------------------------
// handleToolUse / handleToolResult / handleToolUseStructured
// ---------------------------------------------------------------------------

describe("reduce — tool_use", () => {
  it("submitting → tool_work on first tool_use; skips awaiting_first_token for tool-first turns", () => {
    const s0: CodeSessionState = freshInflight("submitting");
    const { state, effects } = reduce(s0, {
      type: "tool_use",
      msg_id: FIXTURE_IDS.MSG_ID,
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      tool_name: "Read",
      input: {},
    });
    expect(state.phase).toBe("tool_work");
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)).toEqual(
      toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "pending"),
    );

    const inflight = effectsOfKind(effects, "write-inflight");
    expect(inflight[0]?.channel).toBe("tools");
    const parsed = JSON.parse(inflight[0]?.value ?? "[]");
    expect(parsed.length).toBe(1);
    expect(parsed[0].toolName).toBe("Read");
  });

  it("continuation with non-empty input overwrites existing input", () => {
    const openMap = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID, toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "pending", {})],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "tool_work",
      toolCallMap: openMap,
    };
    const { state } = reduce(s0, {
      type: "tool_use",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      tool_name: "Read",
      input: { file_path: "/x" },
    });
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.input).toEqual({
      file_path: "/x",
    });
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.status).toBe(
      "pending",
    );
  });

  it("continuation with empty input leaves a previously-filled payload alone", () => {
    const filled = new Map<string, ToolCallState>([
      [
        FIXTURE_IDS.TOOL_USE_ID,
        toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "pending", {
          file_path: "/x",
        }),
      ],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "tool_work",
      toolCallMap: filled,
    };
    const { state } = reduce(s0, {
      type: "tool_use",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      tool_name: "Read",
      input: {},
    });
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.input).toEqual({
      file_path: "/x",
    });
  });

  it("opens a second logical call in tool_work with a distinct tool_use_id", () => {
    const s0: CodeSessionState = { ...fresh(), phase: "tool_work" };
    const r1 = reduce(s0, {
      type: "tool_use",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(1),
      tool_name: "Read",
      input: {},
    });
    const r2 = reduce(r1.state, {
      type: "tool_use",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(2),
      tool_name: "Bash",
      input: {},
    });
    expect(r2.state.toolCallMap.size).toBe(2);
    expect(r2.state.phase).toBe("tool_work");
    // Insertion order preserved.
    const ordered = Array.from(r2.state.toolCallMap.values());
    expect(ordered[0].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID_N(1));
    expect(ordered[1].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID_N(2));
  });

  it("records parent_tool_use_id on a subagent's tool call ([#step-17-5])", () => {
    const s0: CodeSessionState = { ...fresh(), phase: "tool_work" };
    const { state } = reduce(s0, {
      type: "tool_use",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(2),
      tool_name: "Grep",
      input: { pattern: "x" },
      parent_tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(1),
    });
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID_N(2))?.parentToolUseId).toBe(
      FIXTURE_IDS.TOOL_USE_ID_N(1),
    );
  });

  it("leaves parentToolUseId undefined for a top-level tool call", () => {
    const s0: CodeSessionState = { ...fresh(), phase: "tool_work" };
    const { state } = reduce(s0, {
      type: "tool_use",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      tool_name: "Read",
      input: {},
    });
    expect(
      state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.parentToolUseId,
    ).toBeUndefined();
  });

  it("parentToolUseId is sticky — a continuation without it keeps the link", () => {
    const s0: CodeSessionState = { ...fresh(), phase: "tool_work" };
    // First event opens the call and carries the parent link.
    const r1 = reduce(s0, {
      type: "tool_use",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(2),
      tool_name: "Grep",
      input: {},
      parent_tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(1),
    });
    // The filled-in continuation omits parent_tool_use_id — the link
    // must survive (a call's parent never changes).
    const r2 = reduce(r1.state, {
      type: "tool_use",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(2),
      tool_name: "Grep",
      input: { pattern: "x" },
    });
    expect(
      r2.state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID_N(2))?.parentToolUseId,
    ).toBe(FIXTURE_IDS.TOOL_USE_ID_N(1));
  });
});

describe("reduce — tool_result", () => {
  it("tool_work with only one entry → streaming once the result lands", () => {
    const map = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID, toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "pending")],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "tool_work",
      toolCallMap: map,
    };
    const { state } = reduce(s0, {
      type: "tool_result",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      is_error: false,
      output: "hello",
    });
    expect(state.phase).toBe("streaming");
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.status).toBe("done");
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.result).toBe("hello");
  });

  it("stays in tool_work when a parallel entry is still pending (all-done predicate)", () => {
    const map = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID_N(1), toolEntry(FIXTURE_IDS.TOOL_USE_ID_N(1), "Read", "pending")],
      [FIXTURE_IDS.TOOL_USE_ID_N(2), toolEntry(FIXTURE_IDS.TOOL_USE_ID_N(2), "Bash", "pending")],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "tool_work",
      toolCallMap: map,
    };
    const { state } = reduce(s0, {
      type: "tool_result",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(1),
      is_error: false,
      output: "ok",
    });
    expect(state.phase).toBe("tool_work");
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID_N(1))?.status).toBe(
      "done",
    );
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID_N(2))?.status).toBe(
      "pending",
    );
  });

  it("marks status: error when is_error is true", () => {
    const map = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID, toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Bash", "pending")],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "tool_work",
      toolCallMap: map,
    };
    const { state } = reduce(s0, {
      type: "tool_result",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      is_error: true,
      output: "command not found",
    });
    expect(state.phase).toBe("streaming"); // error is terminal
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.status).toBe("error");
  });

  it("drops a stray result for an unknown tool_use_id", () => {
    const s0: CodeSessionState = { ...fresh(), phase: "tool_work" };
    const { state, effects } = reduce(s0, {
      type: "tool_result",
      tool_use_id: "ghost",
      is_error: false,
    });
    expect(state).toBe(s0);
    expect(effects.length).toBe(0);
  });

  it("drops tool_result outside of tool_work (post-audit fixup #2)", () => {
    const map = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID, toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "pending")],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "streaming",
      toolCallMap: map,
    };
    const { state, effects } = reduce(s0, {
      type: "tool_result",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      is_error: false,
    });
    expect(state).toBe(s0);
    expect(effects.length).toBe(0);
  });
});

describe("reduce — tool_use_structured", () => {
  it("populates structuredResult in tool_work without touching status or phase", () => {
    const map = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID, toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "done")],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "tool_work",
      toolCallMap: map,
    };
    const { state } = reduce(s0, {
      type: "tool_use_structured",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      structured_result: { file: { numLines: 3 } },
    });
    expect(state.phase).toBe("tool_work");
    expect(
      state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.structuredResult,
    ).toEqual({ file: { numLines: 3 } });
    expect(state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.status).toBe("done");
  });

  it("also accepts tool_use_structured in the streaming phase (post tool_work → streaming transition)", () => {
    const map = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID, toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "done")],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "streaming",
      toolCallMap: map,
    };
    const { state } = reduce(s0, {
      type: "tool_use_structured",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      structured_result: { ok: true },
    });
    expect(state.phase).toBe("streaming");
    expect(
      state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.structuredResult,
    ).toEqual({ ok: true });
  });

  it("accepts tool_use_structured in the replaying phase (JSONL bracket emits the structured frame)", () => {
    // tugcode's replay.ts emits a `tool_use_structured` from each
    // user-entry `toolUseResult` so resumed Read tool calls land in
    // the reducer with structuredResult populated; the reducer must
    // accept the frame in the `replaying` phase, otherwise the JSONL
    // replay path silently drops it and the Read wrapper renders an
    // empty body.
    const map = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID, toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "done")],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "replaying",
      toolCallMap: map,
    };
    const { state, effects } = reduce(s0, {
      type: "tool_use_structured",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      structured_result: { file: { content: "# Title\nbody" } },
    });
    expect(state.phase).toBe("replaying");
    expect(
      state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.structuredResult,
    ).toEqual({ file: { content: "# Title\nbody" } });
    // Replay suppresses the `inflight.tools` write — the bracket
    // owns transcript-side delivery via `append-transcript`.
    expect(effects.filter((e) => e.kind === "write-inflight")).toEqual([]);
  });

  it("ignores tool_use_structured outside of tool_work / streaming / replaying", () => {
    const map = new Map<string, ToolCallState>([
      [FIXTURE_IDS.TOOL_USE_ID, toolEntry(FIXTURE_IDS.TOOL_USE_ID, "Read", "done")],
    ]);
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "idle",
      toolCallMap: map,
    };
    const { state } = reduce(s0, {
      type: "tool_use_structured",
      tool_use_id: FIXTURE_IDS.TOOL_USE_ID,
      structured_result: { ok: true },
    });
    // Untouched — entry still has its original null structuredResult.
    expect(
      state.toolCallMap.get(FIXTURE_IDS.TOOL_USE_ID)?.structuredResult,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Subagent tool-call nesting ([#step-17-5])
//
// The catalog's only Agent probe (`test-22-subagent-spawn.jsonl`) carries
// an *unscrubbed literal* `parent_tool_use_id` while its `Agent`
// `tool_use_id` is a `{{uuid}}` placeholder — the capture-time scrubber
// missed the field, so the parent↔child correlation is lost in the
// fixture and a replay can't assert the link. This synthetic sequence
// replays the same *shape* through the real reducer with correlated
// ids: an `Agent` call, the subagent's nested `Grep` (tagged with the
// Agent's id), and both results.
// ---------------------------------------------------------------------------

describe("reduce — subagent tool-call nesting ([#step-17-5])", () => {
  it("links a subagent's nested tool call to the spawning Agent across a full sequence", () => {
    const agentId = FIXTURE_IDS.TOOL_USE_ID_N(1);
    const grepId = FIXTURE_IDS.TOOL_USE_ID_N(2);
    const s0: CodeSessionState = { ...fresh(), phase: "submitting" };

    const { state } = applyAll(s0, [
      // Agent opens (empty input), then fills in — a top-level call.
      { type: "tool_use", tool_use_id: agentId, tool_name: "Agent", input: {} },
      {
        type: "tool_use",
        tool_use_id: agentId,
        tool_name: "Agent",
        input: { subagent_type: "Explore" },
      },
      // The subagent's intermediate Grep — tagged with the Agent's id.
      {
        type: "tool_use",
        tool_use_id: grepId,
        tool_name: "Grep",
        input: { pattern: "FeedId" },
        parent_tool_use_id: agentId,
      },
      { type: "tool_result", tool_use_id: grepId, is_error: false, output: "hit" },
      {
        type: "tool_use_structured",
        tool_use_id: agentId,
        structured_result: { agentType: "Explore", status: "completed" },
      },
      { type: "tool_result", tool_use_id: agentId, is_error: false, output: "done" },
    ]);

    // The map stays flat — both calls are entries — but the Grep now
    // carries the parent link and the Agent does not.
    const agent = state.toolCallMap.get(agentId);
    const grep = state.toolCallMap.get(grepId);
    expect(agent?.parentToolUseId).toBeUndefined();
    expect(grep?.parentToolUseId).toBe(agentId);
    // Both calls reached terminal state, so the turn left tool_work.
    expect(agent?.status).toBe("done");
    expect(grep?.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// handleTurnComplete
// ---------------------------------------------------------------------------

describe("reduce — turn_complete", () => {
  it("commits assistant text and toolCalls into a TurnEntry in insertion order", () => {
    const base = fresh();
    const path = applyAll(base, [
      { type: "send", text: "hello", atoms: [] },
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "a",
        is_partial: true,
      },
      {
        type: "assistant_text",
        msg_id: FIXTURE_IDS.MSG_ID,
        text: "b",
        is_partial: true,
      },
      {
        type: "tool_use",
        msg_id: FIXTURE_IDS.MSG_ID,
        tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(1),
        tool_name: "Read",
        input: { file_path: "/x" },
      },
      {
        type: "tool_use",
        msg_id: FIXTURE_IDS.MSG_ID,
        tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(2),
        tool_name: "Bash",
        input: { command: "ls" },
      },
      {
        type: "tool_result",
        tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(1),
        is_error: false,
        output: "R",
      },
      {
        type: "tool_result",
        tool_use_id: FIXTURE_IDS.TOOL_USE_ID_N(2),
        is_error: false,
        output: "B",
      },
    ]);

    const { state, effects } = reduce(path.state, {
      type: "turn_complete",
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "success",
    });

    expect(state.phase).toBe("idle");
    expect(state.toolCallMap.size).toBe(0);

    const appended = effectsOfKind(effects, "append-transcript");
    expect(appended.length).toBe(1);
    const entry = (appended[0] as AppendTranscriptEffect).entry;
    expect(entry.result).toBe("success");
    expect(entry.assistant).toBe("ab");
    expect(entry.userMessage.text).toBe("hello");
    expect(entry.toolCalls.length).toBe(2);
    expect(entry.toolCalls[0].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID_N(1));
    expect(entry.toolCalls[1].toolUseId).toBe(FIXTURE_IDS.TOOL_USE_ID_N(2));
    expect(entry.toolCalls[0].status).toBe("done");
    expect(entry.toolCalls[1].status).toBe("done");

    expect(effectsOfKind(effects, "clear-inflight").length).toBe(1);
  });

  it("drops turn_complete while idle with no active turn", () => {
    const s0 = fresh();
    const { state, effects } = reduce(s0, {
      type: "turn_complete",
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "success",
    });
    expect(state).toBe(s0);
    expect(effects.length).toBe(0);
  });

  it("marks the entry result as interrupted on turn_complete error", () => {
    const base = fresh();
    const r1 = reduce(base, { type: "send", text: "hi", atoms: [] });
    const r2 = reduce(r1.state, {
      type: "assistant_text",
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "partial-content",
      is_partial: true,
    });
    const { state, effects } = reduce(r2.state, {
      type: "turn_complete",
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "error",
    });
    expect(state.phase).toBe("idle");
    const appended = effectsOfKind(effects, "append-transcript");
    expect(appended[0]?.entry.result).toBe("interrupted");
    expect(appended[0]?.entry.assistant).toBe("partial-content");
  });
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

describe("reduce — explicit drops", () => {
  it("drops system_metadata without mutating state", () => {
    const s0 = fresh();
    const { state, effects } = reduce(s0, { type: "system_metadata" });
    expect(state).toBe(s0);
    expect(effects.length).toBe(0);
  });
});

describe("reduce — errored triggers (Step 8)", () => {
  it("routes session_state_errored into phase=errored with cause tag", () => {
    const s0: CodeSessionState = { ...fresh(), phase: "streaming" };
    const { state, effects } = reduce(s0, {
      type: "session_state_errored",
      detail: "crash_budget_exhausted",
    });
    expect(state.phase).toBe("errored");
    expect(state.lastError?.cause).toBe("session_state_errored");
    expect(state.lastError?.message).toBe("crash_budget_exhausted");
    expect(effects.length).toBe(0);
  });

  it("routes transport_close into phase=errored during active turn", () => {
    const s0: CodeSessionState = { ...fresh(), phase: "submitting" };
    const { state, effects } = reduce(s0, { type: "transport_close" });
    expect(state.phase).toBe("errored");
    expect(state.transportState).toBe("offline");
    expect(state.lastError?.cause).toBe("transport_closed");
    expect(effects.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleTransportClose / handleTransportOpen / handleTransportSettled
//
// `transportState` is orthogonal to `phase` ([D01]). The three transport
// events drive a small state machine on `transportState` alone:
//
//   online ─ transport_close ─▶ offline ─ transport_open ─▶ restoring
//      ▲                                                       │
//      └──────────────── transport_settled ◀──────────────────┘
//
// Phase only changes on `transport_close` from non-idle phases (per
// [D06]); the other two events leave `phase` untouched.
// ---------------------------------------------------------------------------

const NON_IDLE_PHASES = [
  "submitting",
  "awaiting_first_token",
  "streaming",
  "tool_work",
  "awaiting_approval",
  "errored",
] as const;

describe("reduce — transport_close ([D06])", () => {
  it("from idle: phase preserved, transportState=offline, lastError unchanged", () => {
    const s0 = fresh();
    const { state, effects } = reduce(s0, { type: "transport_close" });
    expect(state.phase).toBe("idle");
    expect(state.transportState).toBe("offline");
    expect(state.lastError).toBeNull();
    expect(effects.length).toBe(0);
  });

  for (const phase of NON_IDLE_PHASES) {
    it(`from ${phase}: phase=errored, transportState=offline, lastError.cause=transport_closed`, () => {
      const s0: CodeSessionState = { ...fresh(), phase };
      const { state, effects } = reduce(s0, { type: "transport_close" });
      expect(state.phase).toBe("errored");
      expect(state.transportState).toBe("offline");
      expect(state.lastError?.cause).toBe("transport_closed");
      expect(effects.length).toBe(0);
    });
  }

  it("idempotent: a second transport_close while already offline returns the same state ref", () => {
    const s0 = fresh();
    const { state: s1 } = reduce(s0, { type: "transport_close" });
    const { state: s2 } = reduce(s1, { type: "transport_close" });
    expect(s2).toBe(s1);
  });
});

describe("reduce — transport_open ([D08])", () => {
  it("from offline → restoring", () => {
    const s0: CodeSessionState = { ...fresh(), transportState: "offline" };
    const { state, effects } = reduce(s0, { type: "transport_open" });
    expect(state.transportState).toBe("restoring");
    expect(state.phase).toBe(s0.phase);
    expect(effects.length).toBe(0);
  });

  it("from online: no-op, returns the same state reference", () => {
    const s0 = fresh();
    expect(s0.transportState).toBe("online");
    const { state, effects } = reduce(s0, { type: "transport_open" });
    expect(state).toBe(s0);
    expect(effects.length).toBe(0);
  });

  it("preserves an active phase across the open", () => {
    const s0: CodeSessionState = {
      ...fresh(),
      phase: "errored",
      transportState: "offline",
    };
    const { state } = reduce(s0, { type: "transport_open" });
    expect(state.phase).toBe("errored");
    expect(state.transportState).toBe("restoring");
  });
});

describe("reduce — transport_settled ([D04])", () => {
  it("from restoring → online", () => {
    const s0: CodeSessionState = { ...fresh(), transportState: "restoring" };
    const { state } = reduce(s0, { type: "transport_settled" });
    expect(state.transportState).toBe("online");
  });

  it("from offline → online (defensive: settle without a prior open)", () => {
    const s0: CodeSessionState = { ...fresh(), transportState: "offline" };
    const { state } = reduce(s0, { type: "transport_settled" });
    expect(state.transportState).toBe("online");
  });

  it("from online: no-op, returns the same state reference", () => {
    const s0 = fresh();
    const { state, effects } = reduce(s0, { type: "transport_settled" });
    expect(state).toBe(s0);
    expect(effects.length).toBe(0);
  });
});
