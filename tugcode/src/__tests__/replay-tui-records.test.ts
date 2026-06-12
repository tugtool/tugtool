// Terminal-app transcripts carry bookkeeping records Tug-born sessions
// never write (`mode`, `permission-mode`, `file-history-snapshot`,
// `ai-title`). All of them must translate as silent skips — zero
// unknown_shape telemetry — so resuming a terminal-created session
// replays cleanly.

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type { OutboundMessage } from "../types.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";

const TUI_SHAPED_JSONL = [
  JSON.stringify({ type: "mode", mode: "normal", sessionId: SESSION }),
  JSON.stringify({
    type: "permission-mode",
    permissionMode: "default",
    sessionId: SESSION,
  }),
  JSON.stringify({
    type: "file-history-snapshot",
    messageId: "m1",
    snapshot: { messageId: "m1", trackedFileBackups: {} },
  }),
  JSON.stringify({
    type: "user",
    sessionId: SESSION,
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  }),
  JSON.stringify({
    type: "assistant",
    sessionId: SESSION,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
    },
  }),
  JSON.stringify({ type: "ai-title", aiTitle: "Greeting", sessionId: SESSION }),
].join("\n");

describe("TUI-shaped transcript replay", () => {
  test("bookkeeping records skip silently — zero unknown_shape", async () => {
    const unknown: Array<{ kind: string; type: string }> = [];
    const out: OutboundMessage[] = [];
    for await (const m of translateJsonlSession(
      { kind: "ok", jsonl: TUI_SHAPED_JSONL, claudeSessionId: SESSION },
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
    expect(unknown).toEqual([]);
    const kinds = out.map((m) => m.type);
    expect(kinds).toContain("add_user_message");
    expect(kinds).toContain("assistant_text");
  });
});
