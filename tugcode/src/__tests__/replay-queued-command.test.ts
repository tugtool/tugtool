// A steered mid-turn message ([P07]/Step 6) persists in claude's JSONL
// ONLY as a `queued_command` attachment — there is no `type: "user"` row
// for it. Replay must translate it into a mid-turn `add_user_message` so a
// reopened session reconstructs the steered user row (the reducer's reload
// fork appends it to the in-flight turn). Without this, reload drops it and
// the steered rows vanish (regression seen in session 3ac9f413).

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type { OutboundMessage } from "../types.ts";

const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// One turn: opener → tool_use → tool_result → STEERED message (mid-bracket)
// → assistant continuation → end_turn. The queued_command sits after the
// tool_result, exactly where claude merged it.
const JSONL = [
  JSON.stringify({
    type: "user",
    sessionId: SESSION,
    message: { role: "user", content: [{ type: "text", text: "run the agent" }] },
  }),
  JSON.stringify({
    type: "assistant",
    sessionId: SESSION,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "Agent", input: {} }],
      stop_reason: "tool_use",
    },
  }),
  JSON.stringify({
    type: "user",
    sessionId: SESSION,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }],
    },
  }),
  JSON.stringify({
    type: "attachment",
    sessionId: SESSION,
    uuid: "qc-1",
    timestamp: "2026-06-19T14:02:18.463Z",
    attachment: {
      type: "queued_command",
      prompt: [{ type: "text", text: "what's 3+3" }],
      commandMode: "prompt",
    },
  }),
  JSON.stringify({
    type: "assistant",
    sessionId: SESSION,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "3 + 3 = 6" }],
      stop_reason: "end_turn",
    },
  }),
].join("\n");

async function translate(jsonl: string): Promise<{
  out: OutboundMessage[];
  unknown: Array<{ kind: string; type: string }>;
}> {
  const out: OutboundMessage[] = [];
  const unknown: Array<{ kind: string; type: string }> = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: SESSION },
    {
      disableYield: true,
      telemetry: {
        unknownShape(detail) {
          unknown.push(detail);
        },
        malformedLine() {},
      },
    },
  )) {
    out.push(m);
  }
  return { out, unknown };
}

function userTexts(out: OutboundMessage[]): string[] {
  return out
    .filter((m) => m.type === "add_user_message")
    .map((m) =>
      ((m as { content?: Array<{ type?: string; text?: string }> }).content ?? [])
        .map((b) => (b.type === "text" ? b.text ?? "" : ""))
        .join(""),
    );
}

describe("queued_command replay (steered mid-turn message)", () => {
  test("emits a mid-turn add_user_message for the steered message; one turn", async () => {
    const { out, unknown } = await translate(JSONL);
    expect(unknown).toEqual([]);
    // Opener + the steered message, in stream order. The steered one is NOT
    // a new turn opener — there is a single turn_complete for the bracket.
    expect(userTexts(out)).toEqual(["run the agent", "what's 3+3"]);
    expect(out.filter((m) => m.type === "turn_complete").length).toBe(1);
  });

  test("non-prompt commandMode (e.g. a queued slash command) is skipped", async () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        sessionId: SESSION,
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
      JSON.stringify({
        type: "attachment",
        sessionId: SESSION,
        attachment: {
          type: "queued_command",
          prompt: [{ type: "text", text: "/compact" }],
          commandMode: "command",
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: SESSION,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
        },
      }),
    ].join("\n");
    const { out, unknown } = await translate(jsonl);
    expect(unknown).toEqual([]);
    expect(userTexts(out)).toEqual(["hi"]); // the /compact queued command is skipped
  });
});
