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
  type JsonlReadResult,
  SessionManager,
} from "../session.ts";
import type {
  AssistantText,
  OutboundMessage,
  ReplayComplete,
  ReplayStarted,
  TurnCancelled,
  TurnComplete,
  UserMessageReplay,
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
  },
): { turn: { suppressEmit: boolean; currentMessageId: string | null } } {
  // Construct an ActiveTurn-shaped object directly. The constructor
  // is private to the production module and its only meaningful state
  // for `runReplay`'s snapshot path is what we set here. The
  // `finish()` method is the only behavioral coupling — `runReplay`
  // doesn't call it on the in-flight path, so a no-op is fine.
  const turn = {
    currentMessageId: opts.currentMessageId,
    seq: 0,
    userText: opts.userText,
    userAttachments: [],
    rev: opts.rev ?? 0,
    partialText: opts.partialText,
    gotResult: opts.gotResult ?? false,
    interrupted: opts.interrupted ?? false,
    suppressEmit: false,
    completion: Promise.resolve(),
    finish: () => {},
  };
  (manager as unknown as { activeTurn: typeof turn }).activeTurn = turn;
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

    // The snapshot's user_message_replay echoes the ACTUAL user
    // submission (from `turn.userText`), keyed on claude's
    // `currentMessageId`.
    const userReplays = emitted.filter(
      (m): m is UserMessageReplay => m.type === "user_message_replay",
    );
    const inflightUserReplay = userReplays.find(
      (m) => m.text === "in-flight user text",
    );
    expect(inflightUserReplay).toBeDefined();
    expect(inflightUserReplay?.msg_id).toBe("msg_inflight_claude_id");

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
        m.type === "user_message_replay" &&
        (m as UserMessageReplay).text === "in-flight user text",
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

  test("inflight ActiveTurn with empty partialText: snapshot still emits user_message_replay", async () => {
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
      (m): m is UserMessageReplay =>
        m.type === "user_message_replay" &&
        (m as UserMessageReplay).text === "submitted but no claude reply yet",
    );
    expect(inflightUserReplay).toBeDefined();
    expect(inflightUserReplay?.msg_id).toBe("msg_empty_partial");

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
      (m): m is UserMessageReplay =>
        m.type === "user_message_replay" &&
        (m as UserMessageReplay).text === "claude hasn't even started yet",
    );
    expect(inflightUserReplay).toBeDefined();
    expect(inflightUserReplay?.msg_id).toBe("");
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

    // No user_message_replay (no synthetic, no JSONL) and no
    // assistant_text — the snapshot path was never adopted.
    const types = emitted.map((m) => m.type);
    expect(types).not.toContain("user_message_replay");
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
    expect(types).not.toContain("user_message_replay");
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
    expect(types).not.toContain("user_message_replay");
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

    // Committed turn 1 frames present, keyed on msg_committed_first.
    const committedUmr = emitted.find(
      (m): m is UserMessageReplay =>
        m.type === "user_message_replay" &&
        (m as UserMessageReplay).text === "hello",
    );
    expect(committedUmr).toBeDefined();
    expect(committedUmr?.msg_id).toBe("msg_committed_first");

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

    // In-flight turn 2 snapshot frames present, keyed on
    // msg_inflight_second.
    const inflightUmr = emitted.find(
      (m): m is UserMessageReplay =>
        m.type === "user_message_replay" &&
        (m as UserMessageReplay).text === "follow-up question",
    );
    expect(inflightUmr).toBeDefined();
    expect(inflightUmr?.msg_id).toBe("msg_inflight_second");

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
        m.type === "user_message_replay" &&
        (m as UserMessageReplay).text === "follow-up question",
    );
    const idxComplete = emitted.findIndex(
      (m) => m.type === "replay_complete",
    );
    expect(idxCommittedTc).toBeGreaterThanOrEqual(0);
    expect(idxInflightUmr).toBeGreaterThan(idxCommittedTc);
    expect(idxComplete).toBeGreaterThan(idxInflightUmr);
  });
});
