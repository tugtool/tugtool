// Never-drop chain — link 8: in-flight turn snapshot delivery.
//
// Scenario: user submits a turn, claude is mid-stream (some deltas have
// arrived, no `result` yet), HMR fires (frontend reload). A new client
// connects to tugcast and dispatches `request_replay`, which calls
// tugcode's `runReplay()`. The bridge process is still alive; the
// in-flight `ActiveTurn` is intact with `currentMessageId` set and
// `partialText` accumulated.
//
// The CODE_OUTPUT broadcast doesn't backfill new subscribers
// (`LagPolicy::Replay` only triggers on lag overflow, not on initial
// subscribe), and the JSONL only contains COMMITTED turns (claude's
// in-flight assistant message hasn't been written yet). The Step 5.6
// pending-row synthetic delivers only the user-side echo.
//
// THE ONLY PATH that delivers claude's already-streamed pre-HMR content
// to the new client is `runReplay`'s in-flight snapshot — emitted via
// `emitInflightTurnFromActiveTurn` inside the bracket. Without it, the
// new client sees `pendingUserMessage` set but no scratch text;
// post-bracket `is_partial: true` deltas append to nothing; the user
// sees the tail of the response, not the head.
//
// These tests pin the snapshot's emission shape: that it fires when
// `activeTurn` is in flight, that it's keyed on
// `turn.currentMessageId` (claude's `message.id`), and that the
// snapshot's `is_partial: false` baseline matches `turn.partialText`.

import { describe, expect, test } from "bun:test";

import {
  ActiveTurn,
  type JsonlReadResult,
  SessionManager,
} from "../session.ts";
import type {
  AssistantText,
  ControlRequestForward,
  OutboundMessage,
  ReplayComplete,
  ReplayStarted,
  StreamingUsage,
  ToolUse,
  TurnCancelled,
  TurnComplete,
  AddUserMessage,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function captureStdout(
  fn: () => Promise<void>,
): Promise<{ emitted: OutboundMessage[] }> {
  const captured: OutboundMessage[] = [];
  const originalWrite = Bun.write;
  const decoder = new TextDecoder();
  (Bun as unknown as { write: typeof Bun.write }).write = ((
    dest: unknown,
    data: unknown,
  ) => {
    if (dest === Bun.stdout) {
      let text = "";
      if (typeof data === "string") text = data;
      else if (data instanceof Uint8Array) text = decoder.decode(data);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          try {
            captured.push(JSON.parse(trimmed) as OutboundMessage);
          } catch {
            // ignore
          }
        }
      }
    }
    return Promise.resolve(
      data instanceof Uint8Array
        ? data.length
        : typeof data === "string"
          ? data.length
          : 0,
    );
  }) as typeof Bun.write;
  try {
    await fn();
  } finally {
    (Bun as unknown as { write: typeof Bun.write }).write = originalWrite;
  }
  return { emitted: captured };
}

function makeManager(opts: {
  jsonl: string;
  sessionId?: string;
}): SessionManager {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const projectDir = "/tmp/hmr-mid-stream-test-" + Date.now();
  const jsonlReader = async (): Promise<JsonlReadResult> => ({
    kind: "ok",
    jsonl: opts.jsonl,
  });
  return new SessionManager(projectDir, sessionId, "resume", undefined, {
    jsonlReader,
    replayTimeoutMs: 5_000,
  });
}

function installInflightTurn(
  manager: SessionManager,
  opts: {
    currentMessageId: string | null;
    userText: string;
    partialText: string;
    rev?: number;
    gotResult?: boolean;
    interrupted?: boolean;
    lastMessageDeltaUsage?: Record<string, unknown> | null;
    lastMessageStartUsage?: Record<string, unknown> | null;
  },
): { turn: ActiveTurn } {
  // Construct a real ActiveTurn — the snapshot path reads messageBlocks
  // (the per-block tracking added by [D07]'s Mid-turn replay design),
  // so we populate that with the supplied partialText as a single
  // text block. Tests that need richer block sequences (multi-block,
  // thinking, tool_use) can mutate `turn.messageBlocks` directly
  // after the call.
  const turn = new ActiveTurn(0, opts.userText, []);
  turn.currentMessageId = opts.currentMessageId;
  turn.rev = opts.rev ?? 0;
  turn.partialText = opts.partialText;
  turn.gotResult = opts.gotResult ?? false;
  turn.interrupted = opts.interrupted ?? false;
  turn.lastMessageDeltaUsage = opts.lastMessageDeltaUsage ?? null;
  turn.lastMessageStartUsage = opts.lastMessageStartUsage ?? null;
  if (opts.currentMessageId !== null && opts.partialText.length > 0) {
    turn.messageBlocks.set(opts.currentMessageId, [
      { index: 0, kind: "text", text: opts.partialText },
    ]);
  }
  (manager as unknown as { activeTurn: ActiveTurn }).activeTurn = turn;
  return { turn };
}

function makeJsonlForOneCommittedTurn(opts: {
  userText: string;
  msgId: string;
  responseText: string;
}): string {
  const userEntry = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: opts.userText }] },
  });
  const assistantEntry = JSON.stringify({
    type: "assistant",
    message: {
      id: opts.msgId,
      stop_reason: "end_turn",
      content: [{ type: "text", text: opts.responseText }],
    },
  });
  return userEntry + "\n" + assistantEntry + "\n";
}

// ---------------------------------------------------------------------------
// Tests — never-drop link 8: in-flight snapshot delivery
// ---------------------------------------------------------------------------

describe("runReplay — in-flight turn snapshot (never-drop chain link 8)", () => {
  test("inflight ActiveTurn with partialText: snapshot lands inside the replay bracket", async () => {
    const manager = makeManager({
      jsonl: makeJsonlForOneCommittedTurn({
        userText: "first turn",
        msgId: "msg_committed",
        responseText: "first response",
      }),
    });

    // Simulate the HMR-mid-stream state: user submitted "in-flight
    // user text" 2 seconds ago, claude has streamed "partial assistant
    // response so far" but no `result` yet.
    installInflightTurn(manager, {
      currentMessageId: "msg_inflight_claude_id",
      userText: "in-flight user text",
      partialText: "partial assistant response so far",
      rev: 12,
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    // Bracket envelope must be present.
    const started = emitted.find(
      (m): m is ReplayStarted => m.type === "replay_started",
    );
    const complete = emitted.find(
      (m): m is ReplayComplete => m.type === "replay_complete",
    );
    expect(started).toBeDefined();
    expect(complete).toBeDefined();

    // The snapshot's add_user_message echoes the ACTUAL user
    // submission (from `turn.userText`). No msg_id on the frame per
    // [D15]; the assistant content frames below carry claude's real
    // msg_id, which the reducer's `activeMsgId` will adopt at the
    // first content event per [D14].
    const userReplays = emitted.filter(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    const inflightUserReplay = userReplays.find(
      (m) => m.text === "in-flight user text",
    );
    expect(inflightUserReplay).toBeDefined();

    // The snapshot's assistant_text carries the accumulated
    // partialText with `is_partial: false` so the reducer REPLACES
    // its scratch.
    const inflightAssistantText = emitted.find(
      (m): m is AssistantText =>
        m.type === "assistant_text" &&
        (m as AssistantText).msg_id === "msg_inflight_claude_id",
    );
    expect(inflightAssistantText).toBeDefined();
    expect(inflightAssistantText?.text).toBe(
      "partial assistant response so far",
    );
    expect(inflightAssistantText?.is_partial).toBe(false);

    // Order: snapshot frames must land BEFORE replay_complete.
    const idxSnapshot = emitted.findIndex(
      (m) =>
        m.type === "add_user_message" &&
        (m as AddUserMessage).text === "in-flight user text",
    );
    const idxComplete = emitted.findIndex(
      (m) => m.type === "replay_complete",
    );
    expect(idxSnapshot).toBeGreaterThanOrEqual(0);
    expect(idxComplete).toBeGreaterThanOrEqual(0);
    expect(idxSnapshot).toBeLessThan(idxComplete);

    // No terminal for a still-live turn.
    const inflightTerminal = emitted.find(
      (m) =>
        (m.type === "turn_complete" || m.type === "turn_cancelled") &&
        (m as TurnComplete | TurnCancelled).msg_id ===
          "msg_inflight_claude_id",
    );
    expect(inflightTerminal).toBeUndefined();
  });

  test("inflight ActiveTurn with empty partialText: snapshot still emits add_user_message", async () => {
    // Edge case: HMR fires before claude has streamed any content
    // (just message_start, before content_block_delta). The user
    // submission is still recoverable from `turn.userText`; the
    // assistant_text snapshot is omitted (length-0 text).
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: "msg_empty_partial",
      userText: "submitted but no claude reply yet",
      partialText: "",
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    const inflightUserReplay = emitted.find(
      (m): m is AddUserMessage =>
        m.type === "add_user_message" &&
        (m as AddUserMessage).text === "submitted but no claude reply yet",
    );
    expect(inflightUserReplay).toBeDefined();
    // No `msg_id` on `add_user_message` per [D15] — identification
    // is by text content above.

    // No assistant_text for empty partialText.
    const inflightAssistantText = emitted.find(
      (m) =>
        m.type === "assistant_text" &&
        (m as AssistantText).msg_id === "msg_empty_partial",
    );
    expect(inflightAssistantText).toBeUndefined();
  });

  test("inflight ActiveTurn with currentMessageId=null: snapshot uses empty msg_id", async () => {
    // Even more degenerate: HMR fires BEFORE claude's `message_start`
    // ever arrives. We have a user submission (forwarded to claude's
    // stdin) but claude hasn't responded with any id-bearing event.
    // The snapshot keys on empty string — degenerate but the
    // reducer's pendingUserMessage is free-floating and the eventual
    // live `turn_complete` (carrying claude's actual id) will
    // commit it.
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: null,
      userText: "claude hasn't even started yet",
      partialText: "",
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    const inflightUserReplay = emitted.find(
      (m): m is AddUserMessage =>
        m.type === "add_user_message" &&
        (m as AddUserMessage).text === "claude hasn't even started yet",
    );
    expect(inflightUserReplay).toBeDefined();
    // No `msg_id` on `add_user_message` per [D15] — even in the
    // degenerate case (claude's first content event never landed),
    // the frame carries no opener id. The reducer's `activeMsgId`
    // stays `null` until first content arrives, and the no-content
    // fallback in `handleTurnComplete` (#spec-reducer-state rule 2)
    // commits `pendingTurn` if the turn is interrupted before then.
  });

  test("activeTurn already finished pre-bracket (gotResult=true at runReplay entry): NOT adopted as inflight, no snapshot", async () => {
    // If the turn finished BEFORE runReplay started, its terminal
    // was already on the wire normally. The runReplay inflight
    // check skips it (`!gotResult` guard). No snapshot emits.
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: "msg_done_before_bracket",
      userText: "ask",
      partialText: "complete answer",
      gotResult: true,
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    // No add_user_message (no synthetic, no JSONL) and no
    // assistant_text — the snapshot path was never adopted.
    const types = emitted.map((m) => m.type);
    expect(types).not.toContain("add_user_message");
    expect(types).not.toContain("assistant_text");
    expect(types).not.toContain("turn_complete");
  });

  test("activeTurn already cancelled pre-bracket (interrupted=true at runReplay entry): NOT adopted as inflight, no snapshot", async () => {
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: "msg_interrupted_before_bracket",
      userText: "ask",
      partialText: "I was sayi",
      interrupted: true,
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    const types = emitted.map((m) => m.type);
    expect(types).not.toContain("add_user_message");
    expect(types).not.toContain("assistant_text");
    expect(types).not.toContain("turn_cancelled");
  });

  test("no activeTurn (idle session): no snapshot emitted; bracket is empty + replay_complete", async () => {
    const manager = makeManager({ jsonl: "" });
    // Don't install an activeTurn — manager.activeTurn stays null.

    const { emitted } = await captureStdout(() => manager.runReplay());

    // Only the bracket envelope (no synthetic, no JSONL turns).
    const types = emitted.map((m) => m.type);
    expect(types).toContain("replay_started");
    expect(types).toContain("replay_complete");
    expect(types).not.toContain("add_user_message");
    expect(types).not.toContain("assistant_text");
  });

  test("inflight with committed JSONL turn before it: bracket has BOTH the committed turn AND the in-flight snapshot", async () => {
    // The realistic HMR-mid-stream scenario: one prior turn is
    // committed in JSONL ("hello" → "hi there"), the user has
    // submitted a SECOND turn that's mid-stream when HMR fires. The
    // bracket must deliver both: the JSONL pass for the committed
    // turn, then the in-flight snapshot for the second.
    const manager = makeManager({
      jsonl: makeJsonlForOneCommittedTurn({
        userText: "hello",
        msgId: "msg_committed_first",
        responseText: "hi there",
      }),
    });
    installInflightTurn(manager, {
      currentMessageId: "msg_inflight_second",
      userText: "follow-up question",
      partialText: "claude's mid-stream answer so far",
      rev: 7,
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    // Committed turn 1 frames present — identified by user text;
    // the matching assistant_text and turn_complete carry claude's
    // real msg_id ("msg_committed_first").
    const committedUmr = emitted.find(
      (m): m is AddUserMessage =>
        m.type === "add_user_message" &&
        (m as AddUserMessage).text === "hello",
    );
    expect(committedUmr).toBeDefined();

    const committedAt = emitted.find(
      (m): m is AssistantText =>
        m.type === "assistant_text" &&
        (m as AssistantText).msg_id === "msg_committed_first",
    );
    expect(committedAt).toBeDefined();
    expect(committedAt?.text).toBe("hi there");

    const committedTc = emitted.find(
      (m): m is TurnComplete =>
        m.type === "turn_complete" &&
        (m as TurnComplete).msg_id === "msg_committed_first",
    );
    expect(committedTc).toBeDefined();

    // In-flight turn 2 snapshot — identified by user text. The
    // assistant_text frames below carry claude's real msg_id
    // ("msg_inflight_second"); `add_user_message` carries none per
    // [D15].
    const inflightUmr = emitted.find(
      (m): m is AddUserMessage =>
        m.type === "add_user_message" &&
        (m as AddUserMessage).text === "follow-up question",
    );
    expect(inflightUmr).toBeDefined();

    const inflightAt = emitted.find(
      (m): m is AssistantText =>
        m.type === "assistant_text" &&
        (m as AssistantText).msg_id === "msg_inflight_second",
    );
    expect(inflightAt).toBeDefined();
    expect(inflightAt?.text).toBe("claude's mid-stream answer so far");
    expect(inflightAt?.is_partial).toBe(false);

    // No turn_complete for the in-flight (still live).
    const inflightTc = emitted.find(
      (m) =>
        m.type === "turn_complete" &&
        (m as TurnComplete).msg_id === "msg_inflight_second",
    );
    expect(inflightTc).toBeUndefined();

    // Order: committed turn frames precede the in-flight snapshot,
    // which precedes replay_complete.
    const idxCommittedTc = emitted.findIndex(
      (m) =>
        m.type === "turn_complete" &&
        (m as TurnComplete).msg_id === "msg_committed_first",
    );
    const idxInflightUmr = emitted.findIndex(
      (m) =>
        m.type === "add_user_message" &&
        (m as AddUserMessage).text === "follow-up question",
    );
    const idxComplete = emitted.findIndex(
      (m) => m.type === "replay_complete",
    );
    expect(idxCommittedTc).toBeGreaterThanOrEqual(0);
    expect(idxInflightUmr).toBeGreaterThan(idxCommittedTc);
    expect(idxComplete).toBeGreaterThan(idxInflightUmr);
  });

  test("inflight ActiveTurn with a pending AskUserQuestion: snapshot re-emits the control_request_forward", async () => {
    // Scenario: claude is mid-stream and has issued an `AskUserQuestion`
    // tool call; the SDK has forwarded a `can_use_tool` control_request
    // to tugcode, which stored it in `pendingControlRequests` and
    // forwarded a `control_request_forward` to tugdeck. The dialog is
    // open; the user hasn't answered. tugdeck reloads (Developer >
    // Reload). The control channel is out-of-band — there's no JSONL
    // record of the gating event. Without re-emit, the dialog has
    // nothing to render against and the pending state is lost.
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: "msg_with_pending_question",
      userText: "ask me some questions",
      partialText: "I will need to ask you a few questions.",
      rev: 3,
    });

    // Populate the pending map exactly as the live `can_use_tool`
    // dispatch would have (line 2819 in session.ts).
    const pendingControlRequest = {
      type: "control_request",
      request_id: "req-question-survive-reload",
      request: {
        subtype: "can_use_tool",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Which approach?",
              options: [{ label: "A" }, { label: "B" }],
            },
          ],
        },
        tool_use_id: "tu_pending_1",
      },
    };
    (
      manager as unknown as {
        pendingControlRequests: Map<string, Record<string, unknown>>;
      }
    ).pendingControlRequests.set(
      "req-question-survive-reload",
      pendingControlRequest,
    );

    const { emitted } = await captureStdout(() => manager.runReplay());

    // The snapshot re-emits both a synthetic `tool_use` (so the
    // reducer's `toolCallMap` has the pending tool block to attach
    // the dialog to and the eventual tool_result to) and the
    // `control_request_forward` carrying the same request_id so the
    // round-trip from the rehydrated dialog correlates back to the
    // same claude-side control request.
    const toolUse = emitted.find(
      (m): m is ToolUse =>
        m.type === "tool_use" &&
        (m as ToolUse).tool_use_id === "tu_pending_1",
    );
    expect(toolUse).toBeDefined();
    expect(toolUse?.tool_name).toBe("AskUserQuestion");
    expect(toolUse?.msg_id).toBe("msg_with_pending_question");

    const forward = emitted.find(
      (m): m is ControlRequestForward => m.type === "control_request_forward",
    );
    expect(forward).toBeDefined();
    expect(forward?.request_id).toBe("req-question-survive-reload");
    expect(forward?.tool_name).toBe("AskUserQuestion");
    expect(forward?.is_question).toBe(true);
    expect(forward?.tool_use_id).toBe("tu_pending_1");

    // Order: assistant_text snapshot first (so the reducer has the
    // text scratch), then `tool_use` (so `toolCallMap` populates),
    // then `control_request_forward` (which references the tool by
    // id), then `replay_complete`.
    const idxAt = emitted.findIndex(
      (m) =>
        m.type === "assistant_text" &&
        (m as AssistantText).msg_id === "msg_with_pending_question",
    );
    const idxToolUse = emitted.findIndex(
      (m) =>
        m.type === "tool_use" &&
        (m as ToolUse).tool_use_id === "tu_pending_1",
    );
    const idxForward = emitted.findIndex(
      (m) => m.type === "control_request_forward",
    );
    const idxComplete = emitted.findIndex(
      (m) => m.type === "replay_complete",
    );
    expect(idxAt).toBeGreaterThanOrEqual(0);
    expect(idxToolUse).toBeGreaterThan(idxAt);
    expect(idxForward).toBeGreaterThan(idxToolUse);
    expect(idxComplete).toBeGreaterThan(idxForward);
  });

  test("pending non-can_use_tool control_request is NOT re-emitted on inflight snapshot", async () => {
    // Defensive: other control_request subtypes (set_permission_mode,
    // set_model, interrupt, stop_task) aren't can_use_tool dialogs;
    // they should not be replayed as control_request_forward.
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: "msg_misc",
      userText: "ask",
      partialText: "ok",
    });

    (
      manager as unknown as {
        pendingControlRequests: Map<string, Record<string, unknown>>;
      }
    ).pendingControlRequests.set("req-misc", {
      type: "control_request",
      request_id: "req-misc",
      request: { subtype: "set_model", model: "claude-opus" },
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    expect(emitted.find((m) => m.type === "control_request_forward")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // streaming_usage on the in-flight snapshot — token telemetry survives
  // reload. The reducer's `liveTurnUsage` is what the status bar's TOKENS
  // / CONTEXT cells read mid-turn; the snapshot re-emits the latest
  // observed usage so those cells climb back to where they were before
  // the reload bracket fired.
  // -------------------------------------------------------------------------

  test("inflight ActiveTurn with lastMessageDeltaUsage: snapshot emits streaming_usage", async () => {
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: "msg_with_delta_usage",
      userText: "ask",
      partialText: "thinking",
      lastMessageDeltaUsage: {
        input_tokens: 1,
        output_tokens: 200,
        cache_read_input_tokens: 18029,
        cache_creation_input_tokens: 7081,
      },
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    const usage = emitted.find(
      (m): m is StreamingUsage => m.type === "streaming_usage",
    );
    expect(usage).toBeDefined();
    expect(usage?.msg_id).toBe("msg_with_delta_usage");
    expect(usage?.usage).toEqual({
      input_tokens: 1,
      output_tokens: 200,
      cache_read_input_tokens: 18029,
      cache_creation_input_tokens: 7081,
    });
  });

  test("inflight ActiveTurn with only lastMessageStartUsage: snapshot uses it as fallback", async () => {
    // A degenerate turn that crossed `message_start` but not a
    // `message_delta` — the start usage is the only signal we have.
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: "msg_start_only",
      userText: "ask",
      partialText: "",
      lastMessageStartUsage: {
        input_tokens: 4,
        output_tokens: 1,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
      },
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    const usage = emitted.find(
      (m): m is StreamingUsage => m.type === "streaming_usage",
    );
    expect(usage).toBeDefined();
    expect(usage?.msg_id).toBe("msg_start_only");
    expect(usage?.usage).toEqual({
      input_tokens: 4,
      output_tokens: 1,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
    });
  });

  test("inflight ActiveTurn with no usage observed yet: snapshot omits streaming_usage", async () => {
    // The bracket fired before any `message_start` revealed a usage
    // tuple. `streamingUsageFrame` returns null; the snapshot must
    // not emit an all-zero frame.
    const manager = makeManager({ jsonl: "" });
    installInflightTurn(manager, {
      currentMessageId: "msg_no_usage",
      userText: "ask",
      partialText: "early",
      // both usage fields default to null
    });

    const { emitted } = await captureStdout(() => manager.runReplay());

    expect(emitted.find((m) => m.type === "streaming_usage")).toBeUndefined();
  });

  // (deleted: "snapshot wire order" — pure ordering pin. Under [D07]'s
  // Mid-turn replay snapshot (Option 4: replay-the-stream) the reducer
  // processes events independently of inter-frame order; the ordering
  // here was a brittle implementation detail. The CONTRACTS this test
  // hinted at — that streaming_usage, tool_use, and
  // control_request_forward all emit when their respective state is
  // populated — are pinned by the dedicated tests above.)
});
