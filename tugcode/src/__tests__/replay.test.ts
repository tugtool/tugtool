// tugcode/src/__tests__/replay.test.ts
//
// Unit tests for the JSONL → CODE_OUTPUT translator. Tests assert
// the translator's `OutboundMessage[]` output shape directly — no
// reducer is imported in tugcode/. Cross-package wire behavior is
// exercised separately by integration tests on the tugdeck side.
//
// Fixture JSONLs are built inline as multi-line strings (one entry
// per line; trailing newline optional). The shapes mirror real
// `~/.claude/projects/<dir>/<id>.jsonl` payloads observed during the
// shape survey, with names and ids anonymized.

import { describe, expect, test } from "bun:test";

import {
  type JsonlEntry,
  type ReplayInput,
  type ReplayTelemetry,
  type TranslateContext,
  makeTranslateContext,
  translateJsonlEntry,
  translateJsonlSession,
} from "../replay.ts";
import type {
  AssistantText,
  OutboundMessage,
  ReplayComplete,
  ReplayStarted,
  ThinkingText,
  ToolResult,
  ToolUse,
  TurnComplete,
  UserMessageReplay,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface CapturingTelemetry extends ReplayTelemetry {
  readonly unknownShapes: Array<{
    kind: "top_level" | "content_block";
    type: string;
  }>;
  readonly malformed: Array<{ reason: string; preview: string }>;
}

function makeCapturingTelemetry(): CapturingTelemetry {
  const unknownShapes: Array<{
    kind: "top_level" | "content_block";
    type: string;
  }> = [];
  const malformed: Array<{ reason: string; preview: string }> = [];
  return {
    unknownShapes,
    malformed,
    unknownShape(detail) {
      unknownShapes.push(detail);
    },
    malformedLine(detail) {
      malformed.push(detail);
    },
  };
}

async function collectSession(
  input: ReplayInput,
  opts?: { telemetry?: ReplayTelemetry; disableYield?: boolean },
): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const msg of translateJsonlSession(input, {
    telemetry: opts?.telemetry,
    // Default tests to disabled-yield for deterministic synchronous
    // collection; the batching test re-enables and inspects timing.
    disableYield: opts?.disableYield ?? true,
  })) {
    out.push(msg);
  }
  return out;
}

/** Build a JSONL string from a sequence of JsonlEntry-shaped values.
 * Trailing newline is included so callers don't need to worry about
 * the EOF-no-newline edge case (the translator handles both, but
 * fixtures are easier to read with a uniform trailing \n). */
function makeJsonl(entries: JsonlEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/** A minimal `assistant` entry constructor for fixture brevity. */
function assistantEntry(opts: {
  msgId: string;
  stopReason: "end_turn" | "tool_use" | null;
  content: NonNullable<JsonlEntry["message"]>["content"];
}): JsonlEntry {
  return {
    type: "assistant",
    message: {
      id: opts.msgId,
      role: "assistant",
      model: "claude-opus-4-6",
      stop_reason: opts.stopReason,
      content: opts.content,
    },
  };
}

/** A minimal `user` entry constructor. */
function userEntry(
  content: NonNullable<JsonlEntry["message"]>["content"],
): JsonlEntry {
  return {
    type: "user",
    message: {
      role: "user",
      content,
    },
  };
}

// Type guards for assertion ergonomics
function isUserMessageReplay(m: OutboundMessage): m is UserMessageReplay {
  return m.type === "user_message_replay";
}
function isAssistantText(m: OutboundMessage): m is AssistantText {
  return m.type === "assistant_text";
}
function isThinkingText(m: OutboundMessage): m is ThinkingText {
  return m.type === "thinking_text";
}
function isToolUse(m: OutboundMessage): m is ToolUse {
  return m.type === "tool_use";
}
function isToolResult(m: OutboundMessage): m is ToolResult {
  return m.type === "tool_result";
}
function isTurnComplete(m: OutboundMessage): m is TurnComplete {
  return m.type === "turn_complete";
}
function isReplayStarted(m: OutboundMessage): m is ReplayStarted {
  return m.type === "replay_started";
}
function isReplayComplete(m: OutboundMessage): m is ReplayComplete {
  return m.type === "replay_complete";
}

// ---------------------------------------------------------------------------
// translateJsonlSession — happy paths
// ---------------------------------------------------------------------------

describe("translateJsonlSession — happy path", () => {
  test("two simple text-only turns produce the documented sequence", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "first user prompt" }]),
      assistantEntry({
        msgId: "msg_aaa",
        stopReason: "end_turn",
        content: [{ type: "text", text: "first assistant reply" }],
      }),
      userEntry([{ type: "text", text: "second user prompt" }]),
      assistantEntry({
        msgId: "msg_bbb",
        stopReason: "end_turn",
        content: [{ type: "text", text: "second assistant reply" }],
      }),
    ]);

    const out = await collectSession({ kind: "ok", jsonl });

    // Brackets first/last; nothing odd in between.
    expect(out.at(0)?.type).toBe("replay_started");
    expect(out.at(-1)?.type).toBe("replay_complete");

    // system_metadata synthesized once at the top of replay (between
    // replay_started and the first turn) so SessionMetadataStore picks
    // up the model name. Two turns × {user_message_replay,
    // assistant_text, turn_complete} = 6 inner messages + 2 brackets +
    // 1 system_metadata = 9 total.
    expect(out.length).toBe(9);
    expect(out[1]?.type).toBe("system_metadata");

    // Turn 1
    const um1 = out[2];
    expect(isUserMessageReplay(um1)).toBe(true);
    if (!isUserMessageReplay(um1)) throw new Error("type-guard");
    expect(um1.text).toBe("first user prompt");
    expect(um1.msg_id).toBe("msg_aaa");
    expect(um1.attachments).toEqual([]);

    const at1 = out[3];
    expect(isAssistantText(at1)).toBe(true);
    if (!isAssistantText(at1)) throw new Error("type-guard");
    expect(at1.text).toBe("first assistant reply");
    expect(at1.msg_id).toBe("msg_aaa");
    expect(at1.is_partial).toBe(false);

    const tc1 = out[4];
    expect(isTurnComplete(tc1)).toBe(true);
    if (!isTurnComplete(tc1)) throw new Error("type-guard");
    expect(tc1.msg_id).toBe("msg_aaa");
    expect(tc1.result).toBe("success");

    // Turn 2
    const um2 = out[5];
    expect(isUserMessageReplay(um2)).toBe(true);
    if (!isUserMessageReplay(um2)) throw new Error("type-guard");
    expect(um2.msg_id).toBe("msg_bbb");
    expect(um2.text).toBe("second user prompt");

    const at2 = out[6];
    expect(isAssistantText(at2)).toBe(true);
    if (!isAssistantText(at2)) throw new Error("type-guard");
    expect(at2.msg_id).toBe("msg_bbb");
    expect(at2.text).toBe("second assistant reply");

    const tc2 = out[7];
    expect(isTurnComplete(tc2)).toBe(true);
    if (!isTurnComplete(tc2)) throw new Error("type-guard");
    expect(tc2.msg_id).toBe("msg_bbb");
    expect(tc2.result).toBe("success");

    // replay_complete carries count=2, no error.
    const rc = out.at(-1);
    expect(isReplayComplete(rc as OutboundMessage)).toBe(true);
    if (!isReplayComplete(rc as OutboundMessage)) throw new Error("type-guard");
    expect((rc as ReplayComplete).count).toBe(2);
    expect((rc as ReplayComplete).error).toBeUndefined();
  });

  test("seq numbers monotonically increase across emitted shapes", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u1" }]),
      assistantEntry({
        msgId: "m1",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a1" }],
      }),
      userEntry([{ type: "text", text: "u2" }]),
      assistantEntry({
        msgId: "m2",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a2" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const seqs: number[] = [];
    for (const m of out) {
      if (
        m.type === "assistant_text" ||
        m.type === "tool_use" ||
        m.type === "thinking_text" ||
        m.type === "turn_complete"
      ) {
        seqs.push(m.seq);
      }
    }
    expect(seqs.length).toBe(4);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });
});

describe("translateJsonlSession — tool calls", () => {
  test("single Bash tool call emits user_message + tool_use + tool_result + assistant_text + turn_complete", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "list the files" }]),
      assistantEntry({
        msgId: "msg_intermediate",
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_01",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      }),
      userEntry([
        {
          type: "tool_result",
          tool_use_id: "toolu_01",
          is_error: false,
          content: "file1\nfile2\n",
        },
      ]),
      assistantEntry({
        msgId: "msg_terminal",
        stopReason: "end_turn",
        content: [{ type: "text", text: "Two files here." }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    expect(out.at(0)?.type).toBe("replay_started");
    // Inner sequence: system_metadata (synthesized once at top of
    // replay), user_message_replay, tool_use, tool_result,
    // assistant_text, turn_complete (6).
    const inner = out.slice(1, -1);
    expect(inner.map((m) => m.type)).toEqual([
      "system_metadata",
      "user_message_replay",
      "tool_use",
      "tool_result",
      "assistant_text",
      "turn_complete",
    ]);

    // tool_use payload sanity.
    const tu = inner[2] as ToolUse;
    expect(tu.tool_use_id).toBe("toolu_01");
    expect(tu.tool_name).toBe("Bash");
    expect(tu.input).toEqual({ command: "ls" });
    // The msg_id used across all events is the *terminal* assistant
    // entry's id, not the intermediate's. Replay normalizes this so
    // the reducer's scratch[msg_id] / activeMsgId flow lines up.
    expect(tu.msg_id).toBe("msg_terminal");

    // tool_result payload sanity.
    const tr = inner[3] as ToolResult;
    expect(tr.tool_use_id).toBe("toolu_01");
    expect(tr.output).toBe("file1\nfile2\n");
    expect(tr.is_error).toBe(false);

    // turn_complete msg_id matches.
    const tc = inner[5] as TurnComplete;
    expect(tc.msg_id).toBe("msg_terminal");
    expect(tc.result).toBe("success");
  });

  test("concurrent tool calls preserve insertion order", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "do A and B" }]),
      assistantEntry({
        msgId: "msg_int",
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_A",
            name: "Bash",
            input: { command: "A" },
          },
          {
            type: "tool_use",
            id: "toolu_B",
            name: "Bash",
            input: { command: "B" },
          },
        ],
      }),
      userEntry([
        {
          type: "tool_result",
          tool_use_id: "toolu_A",
          is_error: false,
          content: "A done",
        },
        {
          type: "tool_result",
          tool_use_id: "toolu_B",
          is_error: false,
          content: "B done",
        },
      ]),
      assistantEntry({
        msgId: "msg_t",
        stopReason: "end_turn",
        content: [{ type: "text", text: "Both done." }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    const toolUses = out.filter(isToolUse);
    const toolResults = out.filter(isToolResult);
    expect(toolUses.map((t) => t.tool_use_id)).toEqual(["toolu_A", "toolu_B"]);
    expect(toolResults.map((t) => t.tool_use_id)).toEqual([
      "toolu_A",
      "toolu_B",
    ]);

    // Emission order: tool_use_A, tool_result_A, tool_use_B,
    // tool_result_B (per-pair interleaving, insertion order).
    const inner = out
      .slice(1, -1)
      .filter((m) => m.type === "tool_use" || m.type === "tool_result")
      .map((m) => `${m.type}:${m.type === "tool_use" ? m.tool_use_id : m.tool_use_id}`);
    expect(inner).toEqual([
      "tool_use:toolu_A",
      "tool_result:toolu_A",
      "tool_use:toolu_B",
      "tool_result:toolu_B",
    ]);
  });

  test("tool_result with structured array content concatenates text blocks", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "search" }]),
      assistantEntry({
        msgId: "m_int",
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "Grep",
            input: { pattern: "foo" },
          },
        ],
      }),
      userEntry([
        {
          type: "tool_result",
          tool_use_id: "tu_1",
          is_error: false,
          // Structured tool_result — Claude sometimes returns this
          // shape for tools that produce richer responses.
          content: [
            { type: "text", text: "match 1\n" },
            { type: "text", text: "match 2\n" },
          ],
        },
      ]),
      assistantEntry({
        msgId: "m_t",
        stopReason: "end_turn",
        content: [{ type: "text", text: "Found 2." }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const tr = out.find(isToolResult);
    expect(tr).toBeDefined();
    expect(tr!.output).toBe("match 1\nmatch 2\n");
  });

  test("tool_result with non-string non-text-array content falls back to JSON", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "exec" }]),
      assistantEntry({
        msgId: "m_int",
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu_x",
            name: "Custom",
            input: {},
          },
        ],
      }),
      userEntry([
        {
          type: "tool_result",
          tool_use_id: "tu_x",
          is_error: false,
          content: { custom: "shape", n: 42 },
        },
      ]),
      assistantEntry({
        msgId: "m_t",
        stopReason: "end_turn",
        content: [{ type: "text", text: "done." }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const tr = out.find(isToolResult);
    expect(tr).toBeDefined();
    expect(tr!.output).toBe('{"custom":"shape","n":42}');
  });
});

describe("translateJsonlSession — thinking + image + degenerate", () => {
  test("thinking content lands before terminal assistant_text", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "think hard" }]),
      assistantEntry({
        msgId: "m_int",
        stopReason: "tool_use",
        content: [{ type: "thinking", thinking: "let me consider..." }],
      }),
      assistantEntry({
        msgId: "m_t",
        stopReason: "end_turn",
        content: [{ type: "text", text: "I considered." }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    // Inner sequence: system_metadata (synthesized once at top of
    // replay), user_message_replay, thinking_text, assistant_text,
    // turn_complete.
    const inner = out.slice(1, -1);
    expect(inner.map((m) => m.type)).toEqual([
      "system_metadata",
      "user_message_replay",
      "thinking_text",
      "assistant_text",
      "turn_complete",
    ]);
    const thinking = inner[2] as ThinkingText;
    expect(thinking.text).toBe("let me consider...");
    expect(thinking.is_partial).toBe(false);
    expect(thinking.msg_id).toBe("m_t");
  });

  test("image attachment in user submission is carried through", async () => {
    const jsonl = makeJsonl([
      userEntry([
        { type: "text", text: "what is in this image?" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAA",
          },
        },
      ]),
      assistantEntry({
        msgId: "m_t",
        stopReason: "end_turn",
        content: [{ type: "text", text: "It's a screenshot." }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const um = out.find(isUserMessageReplay)!;
    expect(um.text).toBe("what is in this image?");
    expect(um.attachments.length).toBe(1);
    expect(um.attachments[0]).toEqual({
      filename: "",
      content: "iVBORw0KGgoAAAANSUhEUgAA",
      media_type: "image/png",
    });
  });

  test("turn with no preceding user entry emits user_message_replay with empty text", async () => {
    // Edge case: a JSONL that opens with an assistant entry — this
    // happens after `--continue` flows where the user's prompt was
    // recorded in a prior session file.
    const jsonl = makeJsonl([
      assistantEntry({
        msgId: "m_t",
        stopReason: "end_turn",
        content: [{ type: "text", text: "continued reply" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const um = out.find(isUserMessageReplay)!;
    expect(um.text).toBe("");
    expect(um.attachments).toEqual([]);
  });

  test("empty JSONL emits replay_started → replay_complete with count=0", async () => {
    const out = await collectSession({ kind: "ok", jsonl: "" });
    expect(out.length).toBe(2);
    expect(out[0].type).toBe("replay_started");
    expect(out[1].type).toBe("replay_complete");
    expect((out[1] as ReplayComplete).count).toBe(0);
    expect((out[1] as ReplayComplete).error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// translateJsonlSession — synthesized system_metadata
// ---------------------------------------------------------------------------

describe("translateJsonlSession — synthesized system_metadata", () => {
  test("model from the first assistant entry produces a single system_metadata at top of replay", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u1" }]),
      assistantEntry({
        msgId: "m1",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a1" }],
      }),
      userEntry([{ type: "text", text: "u2" }]),
      assistantEntry({
        msgId: "m2",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a2" }],
      }),
    ]);
    const out = await collectSession({
      kind: "ok",
      jsonl,
      claudeSessionId: "sess-fixture-1",
    });
    const sysMetas = out.filter((m) => m.type === "system_metadata");
    expect(sysMetas.length).toBe(1);
    const sm = sysMetas[0] as { model: string; session_id: string };
    expect(sm.model).toBe("claude-opus-4-6");
    expect(sm.session_id).toBe("sess-fixture-1");
    // Position: between replay_started and the first user_message_replay.
    const startIdx = out.findIndex((m) => m.type === "replay_started");
    const sysIdx = out.findIndex((m) => m.type === "system_metadata");
    const firstUmIdx = out.findIndex((m) => m.type === "user_message_replay");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(sysIdx).toBe(startIdx + 1);
    expect(firstUmIdx).toBe(sysIdx + 1);
  });

  test("claudeSessionId omitted defaults the synthesized session_id to empty string", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "m",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const sm = out.find((m) => m.type === "system_metadata") as
      | { session_id: string }
      | undefined;
    expect(sm).toBeDefined();
    expect(sm!.session_id).toBe("");
  });

  test("JSONL with no model on any assistant emits no system_metadata", async () => {
    // Unusual but possible if the JSONL is from a fixture or a future
    // Claude version that omits the model field. Replay still works;
    // the renderer falls back to the 'Code' default identifier.
    const jsonlEntries: JsonlEntry[] = [
      userEntry([{ type: "text", text: "u" }]),
      {
        type: "assistant",
        message: {
          id: "m",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "a" }],
          // model omitted on purpose
        },
      },
    ];
    const out = await collectSession({
      kind: "ok",
      jsonl: makeJsonl(jsonlEntries),
    });
    expect(out.find((m) => m.type === "system_metadata")).toBeUndefined();
    // Turn still commits.
    expect(out.find((m) => m.type === "turn_complete")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// translateJsonlSession — skipped / unknown / orphan / malformed
// ---------------------------------------------------------------------------

describe("translateJsonlSession — skipped top-level types", () => {
  test("attachment / queue-operation / last-prompt / file-history-snapshot / ai-title / system / permission-mode all skip silently", async () => {
    const skipped: JsonlEntry[] = [
      { type: "attachment" },
      { type: "queue-operation" },
      { type: "last-prompt" },
      { type: "file-history-snapshot" },
      { type: "ai-title" },
      { type: "system" },
      { type: "permission-mode" },
    ];
    // Surrounded by a real turn so we can assert "the turn still
    // commits regardless of the skipped entries before/between/after".
    const jsonl = makeJsonl([
      ...skipped,
      userEntry([{ type: "text", text: "u" }]),
      ...skipped,
      assistantEntry({
        msgId: "m1",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a" }],
      }),
      ...skipped,
    ]);
    const tel = makeCapturingTelemetry();
    const out = await collectSession(
      { kind: "ok", jsonl },
      { telemetry: tel },
    );
    // Inner sequence is just one turn — all skipped entries produced
    // zero outbound messages. system_metadata is synthesized once at
    // the top of replay (from the assistant entry's `message.model`)
    // so the renderer's identifier and badge populate from the start.
    const inner = out.slice(1, -1);
    expect(inner.map((m) => m.type)).toEqual([
      "system_metadata",
      "user_message_replay",
      "assistant_text",
      "turn_complete",
    ]);
    // Skipped entries are SILENT — no telemetry fires for them.
    expect(tel.unknownShapes.length).toBe(0);
    expect(tel.malformed.length).toBe(0);
  });
});

describe("translateJsonlSession — unknown shapes", () => {
  test("unknown top-level type fires unknown_shape telemetry and emits nothing", async () => {
    const jsonl = makeJsonl([
      { type: "frobnicate-future-2026" }, // not in the surveyed set
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "m1",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a" }],
      }),
    ]);
    const tel = makeCapturingTelemetry();
    const out = await collectSession(
      { kind: "ok", jsonl },
      { telemetry: tel },
    );
    expect(tel.unknownShapes).toEqual([
      { kind: "top_level", type: "frobnicate-future-2026" },
    ]);
    // The surrounding turn still committed; system_metadata is
    // synthesized once at the top of replay.
    const inner = out.slice(1, -1);
    expect(inner.map((m) => m.type)).toEqual([
      "system_metadata",
      "user_message_replay",
      "assistant_text",
      "turn_complete",
    ]);
  });

  test("unknown content_block type fires unknown_shape telemetry and skips block", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "m1",
        stopReason: "end_turn",
        content: [
          { type: "future_block_2030", text: "ignored" } as NonNullable<
            NonNullable<JsonlEntry["message"]>["content"]
          >[number],
          { type: "text", text: "real reply" },
        ],
      }),
    ]);
    const tel = makeCapturingTelemetry();
    const out = await collectSession(
      { kind: "ok", jsonl },
      { telemetry: tel },
    );
    expect(tel.unknownShapes).toEqual([
      { kind: "content_block", type: "future_block_2030" },
    ]);
    const at = out.find(isAssistantText)!;
    expect(at.text).toBe("real reply");
  });
});

describe("translateJsonlSession — orphan turn at EOF", () => {
  test("JSONL ending with assistant.stop_reason=tool_use synthesizes turn_complete(error)", async () => {
    // Reload-mid-stream case: the user sent a message, the assistant
    // started a tool_use, but the JSONL ends before the terminal
    // end_turn could be written. The translator synthesizes an
    // interrupted turn so the user-visible portion (the prompt + any
    // captured assistant content) still appears in the transcript.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "go" }]),
      assistantEntry({
        msgId: "m_orphan",
        stopReason: "tool_use",
        content: [
          { type: "thinking", thinking: "starting..." },
          {
            type: "tool_use",
            id: "tu_orphan",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      }),
      // No matching user(tool_result), no terminal assistant.
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    expect(out.at(0)?.type).toBe("replay_started");
    expect(out.at(-1)?.type).toBe("replay_complete");

    const inner = out.slice(1, -1);
    expect(inner.map((m) => m.type)).toEqual([
      "system_metadata",
      "user_message_replay",
      "tool_use",
      "thinking_text",
      "turn_complete",
    ]);
    const tc = inner[4] as TurnComplete;
    expect(tc.result).toBe("error");
    expect(tc.msg_id).toBe("m_orphan");
    // count is bumped on every flush — orphan included.
    expect((out.at(-1) as ReplayComplete).count).toBe(1);
  });

  test("JSONL ending with bare user submission (no answering assistant) commits no turn", async () => {
    // The buffer is opened by the *assistant* entry, not by `user`.
    // A user submission with no assistant entry following has no
    // buffered content to flush — the user's text stays in
    // `pendingUserText` and is dropped at end-of-iterator. (Live
    // wire treats an unanswered submission identically: it never
    // commits a TurnEntry until claude responds.)
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "abandoned prompt" }]),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    // Just brackets; no inner messages.
    expect(out.length).toBe(2);
    expect((out.at(-1) as ReplayComplete).count).toBe(0);
  });
});

describe("translateJsonlSession — malformed lines", () => {
  test("a single malformed line is skipped; surrounding turns still commit", async () => {
    const jsonl =
      JSON.stringify(userEntry([{ type: "text", text: "u1" }])) +
      "\n" +
      JSON.stringify(
        assistantEntry({
          msgId: "m1",
          stopReason: "end_turn",
          content: [{ type: "text", text: "a1" }],
        }),
      ) +
      "\n" +
      "{this-is-not-json[" +
      "\n" +
      JSON.stringify(userEntry([{ type: "text", text: "u2" }])) +
      "\n" +
      JSON.stringify(
        assistantEntry({
          msgId: "m2",
          stopReason: "end_turn",
          content: [{ type: "text", text: "a2" }],
        }),
      ) +
      "\n";

    const tel = makeCapturingTelemetry();
    const out = await collectSession(
      { kind: "ok", jsonl },
      { telemetry: tel },
    );
    expect(tel.malformed.length).toBe(1);
    expect(tel.malformed[0].preview).toContain("this-is-not-json");

    // Both turns still committed.
    const turns = out.filter(isTurnComplete);
    expect(turns.length).toBe(2);
    expect(turns.map((t) => t.msg_id)).toEqual(["m1", "m2"]);

    // replay_complete carries jsonl_malformed + count=2.
    const rc = out.at(-1) as ReplayComplete;
    expect(rc.count).toBe(2);
    expect(rc.error?.kind).toBe("jsonl_malformed");
  });

  test("a JSONL of nothing but malformed lines yields zero turns + jsonl_malformed", async () => {
    const jsonl = "garbage1\ngarbage2\n";
    const tel = makeCapturingTelemetry();
    const out = await collectSession(
      { kind: "ok", jsonl },
      { telemetry: tel },
    );
    expect(tel.malformed.length).toBe(2);
    expect(out.length).toBe(2); // brackets only
    const rc = out.at(-1) as ReplayComplete;
    expect(rc.count).toBe(0);
    expect(rc.error?.kind).toBe("jsonl_malformed");
  });
});

// ---------------------------------------------------------------------------
// translateJsonlSession — error inputs (missing / unreadable)
// ---------------------------------------------------------------------------

describe("translateJsonlSession — error inputs", () => {
  test("kind=missing yields replay_started → replay_complete{jsonl_missing} with no inner messages", async () => {
    const out = await collectSession({
      kind: "missing",
      message: "no JSONL at /path/x",
    });
    expect(out.length).toBe(2);
    expect(isReplayStarted(out[0])).toBe(true);
    const rc = out[1] as ReplayComplete;
    expect(rc.count).toBe(0);
    expect(rc.error?.kind).toBe("jsonl_missing");
    expect(rc.error?.message).toBe("no JSONL at /path/x");
  });

  test("kind=unreadable yields replay_started → replay_complete{jsonl_unreadable}", async () => {
    const out = await collectSession({
      kind: "unreadable",
      message: "permission denied",
    });
    expect(out.length).toBe(2);
    const rc = out[1] as ReplayComplete;
    expect(rc.error?.kind).toBe("jsonl_unreadable");
    expect(rc.error?.message).toBe("permission denied");
  });
});

// ---------------------------------------------------------------------------
// translateJsonlSession — batched yield behavior (yield batching)
// ---------------------------------------------------------------------------

describe("translateJsonlSession — batched yields", () => {
  test("yieldBetweenBatches=true releases the event loop between batches", async () => {
    // Two simple turns — produces 2 brackets + 2*3 = 8 OutboundMessages.
    // With batchSize=2 we should see at least one event-loop yield
    // mid-stream. We pin this by interleaving a microtask and
    // observing it fires before iteration completes.
    const turns: JsonlEntry[] = [];
    for (let i = 0; i < 4; i++) {
      turns.push(userEntry([{ type: "text", text: `u${i}` }]));
      turns.push(
        assistantEntry({
          msgId: `m${i}`,
          stopReason: "end_turn",
          content: [{ type: "text", text: `a${i}` }],
        }),
      );
    }
    const jsonl = makeJsonl(turns);

    let microtaskFiredMidStream = false;
    let iterCount = 0;
    setTimeout(() => {
      microtaskFiredMidStream = iterCount > 0 && iterCount < 8;
    }, 0);

    for await (const _msg of translateJsonlSession(
      { kind: "ok", jsonl },
      { batchSize: 2, disableYield: false },
    )) {
      iterCount += 1;
    }

    // We saw all 15 messages (replay_started + system_metadata +
    // 4 * 3 inner + replay_complete = 15).
    expect(iterCount).toBe(15);
    // The setTimeout we scheduled fired before iteration completed —
    // proving the iterator yielded the loop at least once.
    expect(microtaskFiredMidStream).toBe(true);
  });

  test("disableYield=true keeps iteration synchronous (no setTimeout fires mid-stream)", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "m1",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a" }],
      }),
    ]);
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    const out: OutboundMessage[] = [];
    for await (const msg of translateJsonlSession(
      { kind: "ok", jsonl },
      { disableYield: true },
    )) {
      out.push(msg);
    }
    // The setTimeout has not fired yet — synchronous iteration
    // completed without giving the event loop a chance to run other
    // tasks. (This is an indirect proof; if it ever flakes, look for
    // the microtask point.)
    expect(timerFired).toBe(false);
    expect(out.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// translateJsonlEntry — direct unit tests (no async iterator wrapper)
// ---------------------------------------------------------------------------

describe("translateJsonlEntry — direct unit tests", () => {
  test("user entry alone returns [] and stashes pendingUserText", () => {
    const ctx = makeTranslateContext();
    const out = translateJsonlEntry(
      userEntry([{ type: "text", text: "hello" }]),
      ctx,
    );
    expect(out).toEqual([]);
    expect(ctx.pendingUserText).toBe("hello");
    expect(ctx.buffer).toBeNull();
  });

  test("assistant entry with stop_reason=tool_use returns [] and opens a buffer", () => {
    const ctx = makeTranslateContext();
    translateJsonlEntry(
      userEntry([{ type: "text", text: "hello" }]),
      ctx,
    );
    const out = translateJsonlEntry(
      assistantEntry({
        msgId: "msg_1",
        stopReason: "tool_use",
        content: [
          { type: "tool_use", id: "tu_1", name: "Bash", input: {} },
        ],
      }),
      ctx,
    );
    expect(out).toEqual([]);
    expect(ctx.buffer).not.toBeNull();
    expect(ctx.buffer!.msgId).toBe("msg_1");
    expect(ctx.buffer!.toolCalls.length).toBe(1);
  });

  test("terminal assistant entry flushes the buffer and resets ctx", () => {
    const ctx = makeTranslateContext();
    translateJsonlEntry(
      userEntry([{ type: "text", text: "hello" }]),
      ctx,
    );
    const out = translateJsonlEntry(
      assistantEntry({
        msgId: "msg_term",
        stopReason: "end_turn",
        content: [{ type: "text", text: "hi" }],
      }),
      ctx,
    );
    // 3 messages: user_message_replay, assistant_text, turn_complete.
    expect(out.length).toBe(3);
    // ctx is reset.
    expect(ctx.buffer).toBeNull();
    expect(ctx.pendingUserText).toBeNull();
    expect(ctx.pendingUserAttachments).toEqual([]);
    expect(ctx.turnsCommitted).toBe(1);
  });

  test("unknown top-level type returns [] and fires telemetry", () => {
    const tel = makeCapturingTelemetry();
    const ctx = makeTranslateContext(tel);
    const out = translateJsonlEntry({ type: "made-up" }, ctx);
    expect(out).toEqual([]);
    expect(tel.unknownShapes).toEqual([
      { kind: "top_level", type: "made-up" },
    ]);
  });

  test("entry with missing type fires unknown_shape with a recognizable marker", () => {
    const tel = makeCapturingTelemetry();
    const ctx = makeTranslateContext(tel);
    translateJsonlEntry({}, ctx);
    expect(tel.unknownShapes.length).toBe(1);
    expect(tel.unknownShapes[0].kind).toBe("top_level");
    expect(tel.unknownShapes[0].type).toBe("<missing>");
  });

  test("ipc_version is stamped on every emitted message", () => {
    const ctx: TranslateContext = makeTranslateContext();
    translateJsonlEntry(
      userEntry([{ type: "text", text: "u" }]),
      ctx,
    );
    const out = translateJsonlEntry(
      assistantEntry({
        msgId: "m",
        stopReason: "end_turn",
        content: [
          { type: "thinking", thinking: "..." },
          { type: "text", text: "ok" },
        ],
      }),
      ctx,
    );
    for (const msg of out) {
      // All shapes carry ipc_version: 2.
      expect((msg as { ipc_version?: number }).ipc_version).toBe(2);
    }
  });
});
