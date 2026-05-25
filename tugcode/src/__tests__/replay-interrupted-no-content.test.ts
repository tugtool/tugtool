// Orphan-synthesis contract: NO-content interrupt case ([D13] +
// `#spec-reducer-state` rule 2).
//
// When transport loss hits BEFORE any assistant content arrives, the
// translator's EOF orphan synthesis emits
// `turn_complete{msg_id: <synthesized opener id>, result: "interrupted"}`.
// `openTurnMsgId` still holds the synthesized id minted by
// `mintOpenerId` (the opener emitted the wake_started /
// add_user_message; no content event swapped it via
// `noteContentMsgId`).
//
// The reducer's `handleTurnComplete` no-content fallback
// (`#spec-reducer-state` rule 2) handles this case: `activeMsgId ===
// null && pendingTurn !== null` → commit `pendingTurn` as
// interrupted-before-response. The synthesized id flows through but
// is not matched against `scratch` (the lookup goes through
// `pendingTurn.turnKey` instead).
//
// Substrate shape:
//   - user-side opener (`u-<n>`): committed TurnEntry has
//     `messages: [user_message]`
//   - wake-side opener (`w-<n>`): committed TurnEntry has
//     `messages: []` (the wake discriminator — no user_message)
//
// This test pins translator-side behavior only. The reducer-side
// fallback is pinned by `tugdeck/.../reducer.no-content-fallback.test.ts`.

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type {
  AddUserMessage,
  AssistantText,
  OutboundMessage,
  TurnComplete,
  WakeStarted,
} from "../types.ts";

async function collectSession(jsonl: string): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-noc" },
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
  "<task-id>tk-noc</task-id>",
  "<summary>Monitor event: never armed</summary>",
  "</task-notification>",
].join("\n");

const userTaskNotificationEntry = (envelope: string): string =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: envelope },
  });

const assistantEndTurnEntry = (msgId: string, text: string): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      id: msgId,
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
    },
  });

describe("translateJsonlSession — orphan synthesis with NO content ([D13])", () => {
  test("user opener only (no assistant) + EOF: orphan turn_complete carries synthesized u-N id", async () => {
    // The canonical no-content interrupt shape: user submitted, no
    // assistant response arrived, EOF. Under [D13]'s tracker:
    // openTurnMsgId is `u-0` (set by mintOpenerId); no content event
    // ever fired noteContentMsgId. EOF emitOrphanIfOpen carries
    // the synthesized id on the turn_complete.
    const jsonl = userTextEntry("did anyone hear me");

    const out = await collectSession(jsonl);

    // Exactly one add_user_message (the opener) + one turn_complete
    // (the EOF orphan).
    const addUserMessages = out.filter(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(addUserMessages).toHaveLength(1);
    expect(addUserMessages[0].text).toBe("did anyone hear me");

    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    // Synthesized opener id (NOT claude's real msg_id — no content
    // arrived, so noteContentMsgId never fired).
    expect(turnCompletes[0].msg_id).toMatch(/^u-/);
    expect(turnCompletes[0].result).toBe("interrupted");

    // No assistant content frames on the wire.
    const assistantContent = out.filter(
      (m): m is AssistantText => m.type === "assistant_text",
    );
    expect(assistantContent).toHaveLength(0);
  });

  test("wake opener only (no assistant) + EOF: orphan turn_complete carries synthesized w-N id", async () => {
    // Same shape for wake brackets: the envelope fires wake_started
    // (mints `w-0`), no assistant entry follows, EOF orphan synth
    // carries `w-0` on the turn_complete.
    //
    // The wake discriminator is preserved on the reducer side: the
    // committed TurnEntry has `messages: []` (no user_message — the
    // wake's pendingTurn.initialMessages is empty per [D07]).
    const jsonl = userTaskNotificationEntry(TASK_NOTIFICATION_ENVELOPE);

    const out = await collectSession(jsonl);

    // wake_started fired; no add_user_message (the wake discriminator).
    const wakeStarteds = out.filter(
      (m): m is WakeStarted => m.type === "wake_started",
    );
    expect(wakeStarteds).toHaveLength(1);
    const addUserMessages = out.filter(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(addUserMessages).toHaveLength(0);

    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    // Synthesized wake-opener id (`w-N`), not a real claude msg_id
    // and not a user-opener `u-N`.
    expect(turnCompletes[0].msg_id).toMatch(/^w-/);
    expect(turnCompletes[0].result).toBe("interrupted");
  });

  test("user-then-user (no assistant between): each gets its own no-content orphan", async () => {
    // Two consecutive user submissions with no assistant entries
    // between them or after: structural orphans. The translator emits
    // the second's add_user_message preceded by an orphan synth for
    // the first; then EOF orphan synth fires for the second. Both
    // orphans key on synthesized `u-N` ids.
    const jsonl = [
      userTextEntry("first"),
      userTextEntry("second"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const addUserMessages = out.filter(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(addUserMessages).toHaveLength(2);
    expect(addUserMessages[0].text).toBe("first");
    expect(addUserMessages[1].text).toBe("second");

    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(2);
    // Both synthesized opener ids — neither matches any real claude
    // msg_id pattern. `u-0` for the first orphan, `u-1` for the EOF
    // orphan of the second turn.
    expect(turnCompletes[0].msg_id).toMatch(/^u-/);
    expect(turnCompletes[1].msg_id).toMatch(/^u-/);
    expect(turnCompletes[0].msg_id).not.toBe(turnCompletes[1].msg_id);
    expect(turnCompletes.every((tc) => tc.result === "interrupted")).toBe(
      true,
    );
  });

  test("user opener with attachments only + EOF: orphan synth fires, attachments preserved on opener", async () => {
    // Edge case: a user submission with only image attachments (no
    // text) followed by no assistant. The opener still fires (it has
    // attachments), and the EOF orphan synth carries `u-0`.
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "iVBORw0KGgo=",
            },
          },
        ],
      },
    });

    const out = await collectSession(jsonl);

    const addUserMessages = out.filter(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(addUserMessages).toHaveLength(1);
    expect(addUserMessages[0].text).toBe("");
    expect(addUserMessages[0].attachments).toHaveLength(1);
    expect(addUserMessages[0].attachments[0].media_type).toBe("image/png");

    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    expect(turnCompletes[0].msg_id).toMatch(/^u-/);
    expect(turnCompletes[0].result).toBe("interrupted");
  });

  test("clean turn followed by no-content trailing user: clean turn commits, trailing orphan synthesizes", async () => {
    // Mixed shape: a normal user-then-assistant cycle commits cleanly,
    // then a trailing user submission with no response orphans at
    // EOF. The two should not interfere.
    const jsonl = [
      userTextEntry("good question"),
      assistantEndTurnEntry("msg_clean", "good answer"),
      userTextEntry("follow-up nobody saw"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(2);

    // First commits cleanly with claude's real id.
    expect(turnCompletes[0].msg_id).toBe("msg_clean");
    expect(turnCompletes[0].result).toBe("success");

    // Second is the EOF orphan with synthesized id.
    expect(turnCompletes[1].msg_id).toMatch(/^u-/);
    expect(turnCompletes[1].result).toBe("interrupted");

    const addUserMessages = out.filter(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(addUserMessages).toHaveLength(2);
    expect(addUserMessages[0].text).toBe("good question");
    expect(addUserMessages[1].text).toBe("follow-up nobody saw");
  });
});
