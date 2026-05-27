// Replay-path wake-bracket contract pins ([D13] + [D07] wake
// discriminator).
//
// The JSONL persists a Cohort A wake bracket (Monitor / Bash-runbg /
// Task-runbg notification firing between turns) as a synthetic `user`
// entry containing a `<task-notification>` envelope, followed by the
// assistant's response. Live tugcode never sees this envelope —
// claude's stream-json wire lifts the event as
// `system/task_notification` and tugcode brackets the wake via
// `buildWakeStartedMessage`. The replay translator MUST recognize the
// envelope and synthesize the equivalent `wake_started` IPC frame
// instead of emitting it as an `add_user_message`.
//
// Without this discrimination, the envelope text would land on the
// wire as a user message and the substrate's wake discriminator —
// "wake turns have NO `user_message` Message at the head of
// `messages`" per [D07] — would be violated. The user would see a
// phantom XML envelope rendered as a "You" row on transcript
// rehydration. This was the regression that motivated Step 5.5 / 5.6.

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type {
  AddUserMessage,
  OutboundMessage,
  TurnComplete,
  WakeStarted,
} from "../types.ts";

async function collectSession(jsonl: string): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-wake" },
    { disableYield: true, synthesizeDanglingTerminal: true },
  )) {
    out.push(m);
  }
  return out;
}

const TASK_NOTIFICATION_ENVELOPE = [
  "<task-notification>",
  "<task-id>b08a41726</task-id>",
  "<summary>Monitor event: tail system.log for &quot;kernel&quot;</summary>",
  "<event>[Monitor timed out — re-arm if needed.]</event>",
  "</task-notification>",
].join("\n");

const userTaskNotificationEntry = (envelope: string): string =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: envelope },
  });

const userTextEntry = (text: string): string =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
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

describe("translateJsonlSession — wake-bracket replay synthesis [D13] [D07]", () => {
  test("a <task-notification> user entry emits wake_started, NOT add_user_message", async () => {
    // The most basic wake-replay contract: the envelope drives a
    // wake_started, and NO add_user_message fires for that envelope.
    // The substrate's wake discriminator depends on this: a committed
    // wake TurnEntry must have `messages[0]?.kind !== "user_message"`
    // ([D07]).
    const jsonl = [
      userTaskNotificationEntry(TASK_NOTIFICATION_ENVELOPE),
      assistantEndTurnEntry("msg_wake_resp", "kernel matched"),
    ].join("\n");

    const out = await collectSession(jsonl);

    // Exactly one wake_started for the envelope.
    const wakeStarteds = out.filter(
      (m): m is WakeStarted => m.type === "wake_started",
    );
    expect(wakeStarteds).toHaveLength(1);
    expect(wakeStarteds[0].wake_trigger.task_id).toBe("b08a41726");
    expect(wakeStarteds[0].wake_trigger.summary).toBe(
      "Monitor event: tail system.log for &quot;kernel&quot;",
    );
    expect(wakeStarteds[0].wake_trigger.status).toBe("completed");

    // No add_user_message for the envelope (the wake discriminator).
    const addUserMessages = out.filter(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(addUserMessages).toHaveLength(0);

    // The assistant response commits cleanly under claude's real id.
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    expect(turnCompletes[0].msg_id).toBe("msg_wake_resp");
    expect(turnCompletes[0].result).toBe("success");
  });

  test("wake bracket ordering: wake_started lands BEFORE the assistant's content frames", async () => {
    // The wake_started is the opener for the bracket; content_block_start
    // / assistant_text / turn_complete all land inside it. Under [D13]'s
    // per-entry direct emission, the envelope's wake_started fires from
    // the user entry, BEFORE the assistant entry's emit pass.
    const jsonl = [
      userTaskNotificationEntry(TASK_NOTIFICATION_ENVELOPE),
      assistantEndTurnEntry("msg_wake_resp", "kernel matched"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const wakeIdx = out.findIndex((m) => m.type === "wake_started");
    const firstContentIdx = out.findIndex(
      (m) =>
        m.type === "content_block_start" ||
        m.type === "assistant_text" ||
        m.type === "thinking_text" ||
        m.type === "tool_use",
    );
    const turnCompleteIdx = out.findIndex((m) => m.type === "turn_complete");

    expect(wakeIdx).toBeGreaterThanOrEqual(0);
    expect(firstContentIdx).toBeGreaterThan(wakeIdx);
    expect(turnCompleteIdx).toBeGreaterThan(firstContentIdx);
  });

  test("mixed session: user-text turn followed by wake bracket — each gets the right opener", async () => {
    // A common shape: a normal user turn, then later (mid-session) a
    // Monitor wake fires. Both turns must commit cleanly with the
    // right opener kind. The wake bracket's substrate shape (no
    // user_message Message) must NOT contaminate the prior turn's
    // substrate (which DOES have a user_message Message).
    const jsonl = [
      userTextEntry("set up the monitor"),
      assistantEndTurnEntry("msg_setup", "monitor armed"),
      userTaskNotificationEntry(TASK_NOTIFICATION_ENVELOPE),
      assistantEndTurnEntry("msg_wake", "kernel matched"),
    ].join("\n");

    const out = await collectSession(jsonl);

    // One add_user_message (the first turn's user submission) + one
    // wake_started (the wake bracket). No add_user_message for the
    // envelope.
    const addUserMessages = out.filter(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(addUserMessages).toHaveLength(1);
    expect((addUserMessages[0].content[0] as { type: string; text: string }).text).toBe("set up the monitor");

    const wakeStarteds = out.filter(
      (m): m is WakeStarted => m.type === "wake_started",
    );
    expect(wakeStarteds).toHaveLength(1);

    // Two turn_completes — both success. The first's msg_id matches
    // the first assistant entry; the second matches the wake's
    // assistant entry.
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(2);
    expect(turnCompletes[0].msg_id).toBe("msg_setup");
    expect(turnCompletes[0].result).toBe("success");
    expect(turnCompletes[1].msg_id).toBe("msg_wake");
    expect(turnCompletes[1].result).toBe("success");
  });

  test("envelope with malformed inner XML still emits wake_started with best-effort fields", async () => {
    // Defensive: the envelope's `<task-id>` / `<summary>` extractors
    // are best-effort regexes — a malformed inner shape yields empty
    // strings for those fields but still emits wake_started (because
    // the `<task-notification>` open tag matched). This preserves the
    // wake discriminator (no add_user_message for the entry) even
    // when claude's persisted shape drifts.
    const malformedEnvelope =
      "<task-notification>this is not the inner XML you expected</task-notification>";
    const jsonl = [
      userTaskNotificationEntry(malformedEnvelope),
      assistantEndTurnEntry("msg_resp", "ok"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const wakeStarteds = out.filter(
      (m): m is WakeStarted => m.type === "wake_started",
    );
    expect(wakeStarteds).toHaveLength(1);
    expect(wakeStarteds[0].wake_trigger.task_id).toBe("");
    expect(wakeStarteds[0].wake_trigger.summary).toBe("");
    expect(
      out.filter((m) => m.type === "add_user_message"),
    ).toHaveLength(0);
  });
});
