// Orphan-synthesis contract: WITH-content interrupt case ([D13]'s
// `noteContentMsgId` rule).
//
// When transport loss hits mid-turn AFTER some assistant content has
// arrived, the translator's EOF orphan synthesis must emit
// `turn_complete{msg_id: <claude's real msg_id>, result: "interrupted"}`
// — NOT the synthesized opener id (`u-<n>` or `w-<n>`) the opener
// originally minted. The `noteContentMsgId` helper enforces this:
// every msg_id-bearing content emit (`content_block_start`,
// `assistant_text`, `thinking_text`, `tool_use`) swaps `openTurnMsgId`
// from the synthesized opener id to claude's real `msg_id` on the
// FIRST content event of the turn.
//
// Without this rule, the orphan turn_complete would carry the
// synthesized opener id while the reducer's `activeMsgId` carries
// claude's real id (set by the first content event per [D14]) —
// `handleTurnComplete`'s match would fail, and the partial content
// would land in a pendingTurn that never commits. This was the
// hole the Step 5.5 / 5.6 review flagged as fixup [A].

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type {
  AssistantText,
  OutboundMessage,
  ThinkingText,
  TurnComplete,
  WakeStarted,
} from "../types.ts";

async function collectSession(jsonl: string): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-int" },
    { disableYield: true, synthesizeDanglingTerminal: true },
  )) {
    out.push(m);
  }
  return out;
}

const userTextEntry = (text: string): string =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  });

const TASK_NOTIFICATION_ENVELOPE = [
  "<task-notification>",
  "<task-id>tk-int</task-id>",
  "<summary>scheduled fire</summary>",
  "</task-notification>",
].join("\n");

const userTaskNotificationEntry = (envelope: string): string =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: envelope },
  });

/** Assistant entry with content but NO `stop_reason` (truncated
 *  mid-stream — no terminal arrived). */
const assistantPartialEntry = (msgId: string, text: string): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      id: msgId,
      stop_reason: null,
      content: [{ type: "text", text }],
    },
  });

describe("translateJsonlSession — orphan synthesis with content arrival ([D13])", () => {
  test("user opener + partial assistant content + EOF: orphan turn_complete carries claude's real msg_id", async () => {
    // The canonical with-content interrupt shape. The user submits;
    // claude starts streaming; transport dies. The translator emits
    // the user opener, the partial content frames (which swap
    // openTurnMsgId to claude's real id via noteContentMsgId), and
    // the EOF orphan turn_complete keyed on the real id — NOT the
    // synthesized `u-N` opener id.
    const jsonl = [
      userTextEntry("tell me a story"),
      assistantPartialEntry("msg_partial", "Once upon a"),
    ].join("\n");

    const out = await collectSession(jsonl);

    // Exactly one turn_complete — the EOF orphan synthesis.
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);

    // The orphan turn_complete carries claude's REAL msg_id, not
    // the synthesized `u-N` opener id. This is the [D13]
    // noteContentMsgId rule in action.
    expect(turnCompletes[0].msg_id).toBe("msg_partial");
    expect(turnCompletes[0].msg_id).not.toMatch(/^u-/);
    expect(turnCompletes[0].result).toBe("interrupted");

    // The partial content arrived on the wire keyed by the real
    // msg_id — when this stream is fed to the reducer, the partial
    // text lands in scratch and commits via the normal
    // `handleTurnComplete` match (activeMsgId === msg_partial).
    const partialText = out.find(
      (m): m is AssistantText =>
        m.type === "assistant_text" && m.msg_id === "msg_partial",
    );
    expect(partialText).toBeDefined();
    expect(partialText?.text).toBe("Once upon a");
  });

  test("wake opener + partial assistant content + EOF: orphan turn_complete carries the real msg_id", async () => {
    // Same rule for wake brackets: even though the opener is
    // wake_started (synthesized id is `w-N`), the first content
    // event swaps openTurnMsgId to claude's real id. The EOF orphan
    // turn_complete carries the real id.
    const jsonl = [
      userTaskNotificationEntry(TASK_NOTIFICATION_ENVELOPE),
      assistantPartialEntry("msg_wake_partial", "kernel pattern matched, checking"),
    ].join("\n");

    const out = await collectSession(jsonl);

    // wake_started fired from the envelope.
    const wakeStarteds = out.filter(
      (m): m is WakeStarted => m.type === "wake_started",
    );
    expect(wakeStarteds).toHaveLength(1);

    // Orphan turn_complete carries the real msg_id (not `w-N`).
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    expect(turnCompletes[0].msg_id).toBe("msg_wake_partial");
    expect(turnCompletes[0].msg_id).not.toMatch(/^w-/);
    expect(turnCompletes[0].result).toBe("interrupted");
  });

  test("mid-session interrupt: new opener arrives mid-turn — orphan keyed on real msg_id, NOT synthesized", async () => {
    // The user submits; claude starts streaming; user interrupts and
    // submits a new prompt. The translator must emit an orphan
    // turn_complete for the first turn (keyed on claude's real id —
    // content arrived) BEFORE emitting the second turn's
    // add_user_message.
    const jsonl = [
      userTextEntry("first request"),
      assistantPartialEntry("msg_first", "thinking..."),
      userTextEntry("never mind, different question"),
    ].join("\n");

    const out = await collectSession(jsonl);

    // Three turn_completes total: the first turn's orphan (mid-session,
    // before the new opener), and the second turn's orphan (at EOF —
    // no assistant response).
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(2);

    // First turn_complete: keyed on claude's real msg_id (content
    // arrived for that turn).
    expect(turnCompletes[0].msg_id).toBe("msg_first");
    expect(turnCompletes[0].result).toBe("interrupted");

    // Second turn_complete: EOF orphan for the trailing user
    // submission (no content arrived — synthesized opener id).
    expect(turnCompletes[1].msg_id).toMatch(/^u-/);
    expect(turnCompletes[1].result).toBe("interrupted");

    // Ordering: the mid-session orphan turn_complete lands BEFORE
    // the second add_user_message. Without this, the new opener
    // would race the prior turn's pending content into the
    // reducer's substrate.
    const firstTc = out.findIndex(
      (m) => m.type === "turn_complete" && (m as TurnComplete).msg_id === "msg_first",
    );
    const secondOpener = out
      .map((m, i) => (m.type === "add_user_message" ? i : -1))
      .filter((i) => i >= 0)[1];
    expect(firstTc).toBeGreaterThanOrEqual(0);
    expect(secondOpener).toBeGreaterThan(firstTc);
  });

  test("thinking-only content (no text yet): openTurnMsgId still swaps to real msg_id", async () => {
    // The thinking block fires noteContentMsgId too — text isn't
    // the only content kind that establishes the turn's real msg_id.
    // A turn interrupted during thinking-only still has its orphan
    // turn_complete keyed on the real id.
    const jsonl = [
      userTextEntry("hard problem"),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_thinking",
          stop_reason: null,
          content: [{ type: "thinking", thinking: "let me consider..." }],
        },
      }),
    ].join("\n");

    const out = await collectSession(jsonl);

    // The thinking text reached the wire.
    const thinkings = out.filter(
      (m): m is ThinkingText => m.type === "thinking_text",
    );
    expect(thinkings).toHaveLength(1);
    expect(thinkings[0].msg_id).toBe("msg_thinking");

    // EOF orphan keyed on the real msg_id, NOT `u-N`.
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    expect(turnCompletes[0].msg_id).toBe("msg_thinking");
    expect(turnCompletes[0].result).toBe("interrupted");
  });

  test("noteContentMsgId is idempotent: multi-block content still ends with one real-id orphan", async () => {
    // The helper is no-op on subsequent calls with the same msg_id —
    // even though every block triggers it, openTurnMsgId only swaps
    // once. The orphan turn_complete still carries the real id (set
    // by the first block) regardless of how many blocks followed.
    const jsonl = [
      userTextEntry("multi-block"),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_multi",
          stop_reason: null,
          content: [
            { type: "thinking", thinking: "step 1" },
            { type: "text", text: "first text" },
            {
              type: "tool_use",
              id: "tu_1",
              name: "Bash",
              input: { cmd: "ls" },
            },
          ],
        },
      }),
    ].join("\n");

    const out = await collectSession(jsonl);

    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    expect(turnCompletes[0].msg_id).toBe("msg_multi");
    expect(turnCompletes[0].result).toBe("interrupted");
  });
});
