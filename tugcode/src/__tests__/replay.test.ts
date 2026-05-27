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
  type JsonlContentBlock,
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
  AddUserMessage,
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

/** A minimal `user` entry constructor.
 *
 * The optional second argument carries the entry-level `toolUseResult`
 * field — Claude Code's camelCase persistence shape for structured
 * tool results (matches the wire-side snake_case `tool_use_result`
 * the live bridge forwards). Used by tests that exercise the replay
 * path's `tool_use_structured` emit.
 */
function userEntry(
  content: NonNullable<JsonlEntry["message"]>["content"],
  toolUseResult?: Record<string, unknown>,
): JsonlEntry {
  return {
    type: "user",
    message: {
      role: "user",
      content,
    },
    ...(toolUseResult !== undefined ? { toolUseResult } : {}),
  };
}

// Type guards for assertion ergonomics
function isAddUserMessage(m: OutboundMessage): m is AddUserMessage {
  return m.type === "add_user_message";
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
  // (deleted: "two simple text-only turns produce the documented sequence"
  // — shape pin. The contract "each turn commits text under its msg_id" is
  // covered by the multi-msgId-cycle test below; the rest was wire-position
  // assertion that broke at every substrate refactor.)

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
  // (deleted: "single Bash tool call emits ... in documented sequence"
  // — shape pin on emit order. Tool-call lifecycle correctness — that
  // tool_use carries claude's msg_id and tool_result pairs by
  // tool_use_id — is covered at the reducer level by tugdeck's
  // toolCallIndex tests and end-to-end by the live spawn drift tests.)

  test("Read tool: entry-level toolUseResult emits a paired tool_use_structured", async () => {
    // The live bridge forwards stream-json's outer `tool_use_result`
    // field as a `tool_use_structured` IPC frame (session.ts:670-680);
    // replay reads the same payload from the JSONL's camelCase
    // `toolUseResult` field and must emit the same frame, otherwise
    // resumed Read tool calls land in the reducer with
    // structuredResult: null and the wrapper has no clean file.content
    // to render.
    const readToolUseResult = {
      type: "text",
      file: {
        filePath: "/abs/CLAUDE.md",
        content: "# Title\n\nbody",
        numLines: 3,
        startLine: 1,
        totalLines: 55,
      },
    };
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "read CLAUDE.md" }]),
      assistantEntry({
        msgId: "msg_int",
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_read_1",
            name: "Read",
            input: { file_path: "/abs/CLAUDE.md" },
          },
        ],
      }),
      userEntry(
        [
          {
            type: "tool_result",
            tool_use_id: "toolu_read_1",
            is_error: false,
            content: "1\t# Title\n2\t\n3\tbody",
          },
        ],
        readToolUseResult,
      ),
      assistantEntry({
        msgId: "msg_t",
        stopReason: "end_turn",
        content: [{ type: "text", text: "Read it." }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    // tool_use_structured emits right after tool_result, both keyed on
    // the same tool_use_id; the structured_result payload is the
    // toolUseResult field forwarded verbatim.
    const types = out.map((m) => m.type);
    const trIdx = types.indexOf("tool_result");
    const tusIdx = types.indexOf("tool_use_structured");
    expect(trIdx).toBeGreaterThan(0);
    expect(tusIdx).toBe(trIdx + 1);

    const tus = out[tusIdx] as {
      type: "tool_use_structured";
      tool_use_id: string;
      tool_name: string;
      structured_result: Record<string, unknown>;
    };
    expect(tus.tool_use_id).toBe("toolu_read_1");
    // Read's toolUseResult shape has no `toolName` field — Claude Code
    // stores `{type: "text", file: {...}}`. The live bridge maps this
    // to `tool_name: ""` (session.ts:676 `(toolUseResult.toolName as
    // string) || ""`); replay mirrors that.
    expect(tus.tool_name).toBe("");
    expect(tus.structured_result).toEqual(readToolUseResult);
  });

  test("toolUseResult without any tool_result block emits no structured frame", () => {
    // Defense: the structured emit only fires when there's a
    // tool_result to pair the tool_use_id with. A user entry that
    // somehow carries toolUseResult but no tool_result block is
    // malformed — emit nothing rather than a dangling structured
    // frame whose tool_use_id is empty.
    const ctx = makeTranslateContext();
    const out = translateJsonlEntry(
      userEntry(
        [{ type: "text", text: "stray" }],
        { type: "text", file: { content: "x" } },
      ),
      ctx,
    );
    expect(out.find((m) => m.type === "tool_use_structured")).toBeUndefined();
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

    // Emission order under per-message flushing: all tool_uses from
    // the assistant entry emit together (when that line is processed),
    // then all tool_results from the user entry emit together (when
    // its line is processed). The reducer pairs them by tool_use_id;
    // adjacency on the wire isn't required.
    const inner = out
      .slice(1, -1)
      .filter((m) => m.type === "tool_use" || m.type === "tool_result")
      .map((m) => `${m.type}:${m.type === "tool_use" ? m.tool_use_id : m.tool_use_id}`);
    expect(inner).toEqual([
      "tool_use:toolu_A",
      "tool_use:toolu_B",
      "tool_result:toolu_A",
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
  test("thinking content keyed to its own msg_id (not the terminal entry's)", async () => {
    // Contract: thinking text belongs to the intermediate entry's
    // msg_id, not the terminal entry's. The reducer's per-Message
    // substrate ([D07]) keys text by (msg_id, block_index); this test
    // pins that the translator preserves that keying across entries.
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

    const thinkings = out.filter((m): m is ThinkingText => m.type === "thinking_text");
    expect(thinkings).toHaveLength(1);
    expect(thinkings[0].text).toBe("let me consider...");
    expect(thinkings[0].msg_id).toBe("m_int");

    const assistants = out.filter(isAssistantText);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].text).toBe("I considered.");
    expect(assistants[0].msg_id).toBe("m_t");
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
    const um = out.find(isAddUserMessage)!;
    // Post-Step-5c: replay emits interleaved content blocks verbatim
    // from JSONL. Text block + image block; image source carries the
    // base64 + media_type but no filename (the wire shape doesn't
    // carry filenames).
    expect(um.content).toEqual([
      { type: "text", text: "what is in this image?" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAA",
        },
      },
    ]);
  });

  test("turn with no preceding user entry emits add_user_message with empty content", async () => {
    // Edge case: a JSONL that opens with an assistant entry — this
    // happens after `--continue` flows where the user's prompt was
    // recorded in a prior session file. The orphan-assistant
    // synthesizer in `handleAssistantEntry` emits a synth opener
    // with `content: []` so the reducer's `pendingTurn` is seeded;
    // tugdeck's `synthesizeUserMessageFromBlocks` produces
    // `(text: "", atoms: [])` from the empty content array.
    const jsonl = makeJsonl([
      assistantEntry({
        msgId: "m_t",
        stopReason: "end_turn",
        content: [{ type: "text", text: "continued reply" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const um = out.find(isAddUserMessage)!;
    expect(um.content).toEqual([]);
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
// Same-msg_id continuation: claude's SDK occasionally persists a single
// assistant message across multiple JSONL records (one snapshot when the
// thinking block was complete, another when the text block was complete),
// each carrying the same `message.id` and `stop_reason: "end_turn"`. The
// session-level peek-ahead should fold these into one cycle: one
// `add_user_message`, the union of content frames keyed on the shared
// msg_id, and exactly one terminal `turn_complete`.
// ---------------------------------------------------------------------------

describe("translateJsonlSession — same-msg_id continuation", () => {
  test("two assistant entries sharing a msg_id collapse into one cycle (thinking then text)", async () => {
    // Mirrors the ae7360c session JSONL: thinking-only entry followed
    // by a text-only entry, both with the same msg_id and end_turn.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "How many entities listed?" }]),
      assistantEntry({
        msgId: "msg_split",
        stopReason: "end_turn",
        content: [
          { type: "thinking", thinking: "Let me think about that." },
        ],
      }),
      assistantEntry({
        msgId: "msg_split",
        stopReason: "end_turn",
        content: [
          { type: "text", text: "I need more context to answer." },
        ],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    // Contract: the run collapses to ONE cycle even though the JSONL
    // has two entries sharing a msg_id. Specifically:
    //  - exactly one add_user_message (no phantom second)
    //  - exactly one turn_complete (no duplicate)
    //  - both entries' content reaches the output (thinking + text)
    //  - the assistant-side frames are keyed to the shared msg_id
    //    ("msg_split"); add_user_message carries no msg_id per [D15]
    const userReplays = out.filter(isAddUserMessage);
    expect(userReplays).toHaveLength(1);
    expect(((userReplays[0].content[0] ?? {}) as { text?: string }).text ?? "").toBe("How many entities listed?");

    const turnCompletes = out.filter(isTurnComplete);
    expect(turnCompletes).toHaveLength(1);
    expect(turnCompletes[0].msg_id).toBe("msg_split");

    // Entry 1's thinking + entry 2's text both reach the output.
    const thinkings = out.filter((m): m is ThinkingText => m.type === "thinking_text");
    expect(thinkings.some((t) => t.text === "Let me think about that.")).toBe(true);
    const assistants = out.filter(isAssistantText);
    expect(assistants.some((a) => a.text === "I need more context to answer.")).toBe(true);

    // replay_complete carries count=1 — one committed cycle, not two.
    const rc = out.at(-1) as ReplayComplete;
    expect(rc.count).toBe(1);
  });

  test("three-way same-msg_id run also collapses (defensive against multi-snapshot writes)", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "msg_run",
        stopReason: "end_turn",
        content: [{ type: "thinking", thinking: "first" }],
      }),
      assistantEntry({
        msgId: "msg_run",
        stopReason: "end_turn",
        content: [{ type: "thinking", thinking: "second" }],
      }),
      assistantEntry({
        msgId: "msg_run",
        stopReason: "end_turn",
        content: [{ type: "text", text: "final" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const tc = out.filter(isTurnComplete);
    expect(tc.length).toBe(1);
    expect(tc[0].msg_id).toBe("msg_run");
    expect((out.at(-1) as ReplayComplete).count).toBe(1);
  });

  test("skipped entries between same-msg_id entries are transparent (run still collapses)", async () => {
    // Claude bookkeeping (attachment, queue-operation, ai-title, etc.)
    // can interleave with assistant entries. The peek must skip over
    // those when deciding whether the run continues.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "msg_thru",
        stopReason: "end_turn",
        content: [{ type: "thinking", thinking: "t" }],
      }),
      // Claude bookkeeping that the per-entry translator skips silently.
      { type: "queue-operation" } as JsonlEntry,
      { type: "ai-title" } as JsonlEntry,
      assistantEntry({
        msgId: "msg_thru",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const tc = out.filter(isTurnComplete);
    expect(tc.length).toBe(1);
    expect(tc[0].msg_id).toBe("msg_thru");
  });

  test("different msg_ids in adjacent assistant entries are NOT collapsed (regression guard)", async () => {
    // Multi-message claude cycles use distinct msg_ids per entry. The
    // peek-ahead must only fold runs that actually share a msg_id —
    // distinct ids are independent cycles and must each emit their own
    // turn_complete.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u1" }]),
      assistantEntry({
        msgId: "msg_one",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a1" }],
      }),
      userEntry([{ type: "text", text: "u2" }]),
      assistantEntry({
        msgId: "msg_two",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a2" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const tc = out.filter(isTurnComplete);
    expect(tc.length).toBe(2);
    expect(tc.map((t) => t.msg_id)).toEqual(["msg_one", "msg_two"]);
    expect((out.at(-1) as ReplayComplete).count).toBe(2);
  });

  test("same-msg_id continuation: per-entry blocks get consecutive block_index values (session ecc343d8 regression)", async () => {
    // Session ecc343d8 captured a thinking-only entry followed by a
    // text-only entry, both sharing msg_id. Both entries' content[]
    // arrays start at index 0 — but the wire delivered those blocks
    // with consecutive indices (0, 1). The reducer's
    // `${msg_id}:${block_index}` mint is idempotent, so naively re-
    // using local index 0 for the second entry's first block collides
    // with the first entry's thinking mint and the text frame paints
    // onto the wrong-kind Message, losing its content on render.
    //
    // The translator must offset the continuation entry's block_index
    // by the count of blocks emitted for this msg_id so far. This
    // pin asserts:
    //  - content_block_start frames emit consecutive (0, 1) indices
    //    across the two entries
    //  - thinking_text and assistant_text frames carry matching
    //    block_index values so they paint into their respective Messages
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "hello" }]),
      assistantEntry({
        msgId: "msg_split",
        stopReason: "end_turn",
        content: [{ type: "thinking", thinking: "thinking content" }],
      }),
      assistantEntry({
        msgId: "msg_split",
        stopReason: "end_turn",
        content: [{ type: "text", text: "Hello! reply text" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    type CbsLike = {
      type: "content_block_start";
      msg_id: string;
      block_index: number;
      kind: "text" | "thinking" | "tool_use";
    };
    const blockStarts = out.filter(
      (m): m is OutboundMessage & CbsLike => m.type === "content_block_start",
    );
    expect(blockStarts).toHaveLength(2);
    expect(blockStarts[0]).toMatchObject({
      msg_id: "msg_split",
      block_index: 0,
      kind: "thinking",
    });
    expect(blockStarts[1]).toMatchObject({
      msg_id: "msg_split",
      block_index: 1,
      kind: "text",
    });

    const thinking = out.find(isThinkingText)!;
    const assistant = out.find(isAssistantText)!;
    expect(thinking.msg_id).toBe("msg_split");
    expect(thinking.block_index).toBe(0);
    expect(assistant.msg_id).toBe("msg_split");
    expect(assistant.block_index).toBe(1);
    expect(assistant.text).toBe("Hello! reply text");
  });

  test("same-msg_id three-way: each continuation entry's block_index continues the sequence", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "msg_run",
        stopReason: "end_turn",
        content: [{ type: "thinking", thinking: "first" }],
      }),
      assistantEntry({
        msgId: "msg_run",
        stopReason: "end_turn",
        content: [{ type: "thinking", thinking: "second" }],
      }),
      assistantEntry({
        msgId: "msg_run",
        stopReason: "end_turn",
        content: [{ type: "text", text: "final" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const blockStarts = out.filter(
      (m) => m.type === "content_block_start",
    ) as Array<OutboundMessage & { block_index: number; msg_id: string }>;
    expect(blockStarts.map((b) => b.block_index)).toEqual([0, 1, 2]);
    expect(blockStarts.every((b) => b.msg_id === "msg_run")).toBe(true);
  });

  test("per-entry multi-block plus continuation: indices stay monotonic", async () => {
    // An entry with two local blocks (thinking, text), followed by a
    // continuation entry with one more block (text). Expected
    // block_index sequence: 0, 1, 2.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "msg_multi",
        stopReason: "end_turn",
        content: [
          { type: "thinking", thinking: "t" },
          { type: "text", text: "a" },
        ],
      }),
      assistantEntry({
        msgId: "msg_multi",
        stopReason: "end_turn",
        content: [{ type: "text", text: "b" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const blockStarts = out.filter(
      (m) => m.type === "content_block_start",
    ) as Array<OutboundMessage & { block_index: number }>;
    expect(blockStarts.map((b) => b.block_index)).toEqual([0, 1, 2]);
  });

  test("distinct msg_ids each start their block_index at 0 (independent counters)", async () => {
    // Two unrelated turns. Each msg_id's per-msg_id block counter
    // resets at the prior turn_complete, so msg_two starts at 0
    // again — not at 1 from the cross-turn carryover bug.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u1" }]),
      assistantEntry({
        msgId: "msg_one",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a1" }],
      }),
      userEntry([{ type: "text", text: "u2" }]),
      assistantEntry({
        msgId: "msg_two",
        stopReason: "end_turn",
        content: [{ type: "text", text: "a2" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    const blockStarts = out.filter(
      (m) => m.type === "content_block_start",
    ) as Array<OutboundMessage & { block_index: number; msg_id: string }>;
    expect(blockStarts).toHaveLength(2);
    expect(blockStarts[0]).toMatchObject({ msg_id: "msg_one", block_index: 0 });
    expect(blockStarts[1]).toMatchObject({ msg_id: "msg_two", block_index: 0 });
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
    // Position: emitted at the FIRST assistant entry (which carries
    // the model field) and BEFORE that entry's content_block_start
    // events. Under [D13]'s per-entry direct emission, the first
    // `add_user_message` fires from its user entry BEFORE the first
    // assistant entry — so system_metadata lands after the first
    // add_user_message but before any assistant content. This is
    // soon enough to populate tugdeck's SessionMetadataStore before
    // the assistant rows render.
    const startIdx = out.findIndex((m) => m.type === "replay_started");
    const sysIdx = out.findIndex((m) => m.type === "system_metadata");
    const firstAssistantContentIdx = out.findIndex(
      (m) =>
        m.type === "content_block_start" ||
        m.type === "assistant_text" ||
        m.type === "thinking_text" ||
        m.type === "tool_use",
    );
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(sysIdx).toBeGreaterThan(startIdx);
    expect(firstAssistantContentIdx).toBeGreaterThan(sysIdx);
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
    // Contract: skipped entries produce zero outbound messages and
    // fire zero unknown_shape telemetry. The surrounding real turn
    // still commits one add_user_message + one turn_complete.
    expect(out.filter(isAddUserMessage)).toHaveLength(1);
    expect(out.filter(isTurnComplete)).toHaveLength(1);
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
    // Contract: unknown top-level type fires telemetry but emits
    // nothing; the surrounding real turn still commits cleanly.
    expect(tel.unknownShapes).toEqual([
      { kind: "top_level", type: "frobnicate-future-2026" },
    ]);
    expect(out.filter(isAddUserMessage)).toHaveLength(1);
    expect(out.filter(isTurnComplete)).toHaveLength(1);
  });

  test("unknown content_block type fires unknown_shape telemetry and skips block", async () => {
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "u" }]),
      assistantEntry({
        msgId: "m1",
        stopReason: "end_turn",
        content: [
          { type: "future_block_2030", text: "ignored" } as JsonlContentBlock,
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

describe("translateJsonlSession — in-flight trailing turn at EOF", () => {
  // Step 5.5 of the mid-turn-replay plan: the trailing in-flight turn
  // emits its content frames (so the user sees the in-flight portion of
  // the turn) but **no terminal `turn_complete`** (so the reducer
  // doesn't commit a partial TurnEntry that would dedupe the live
  // turn_complete claude emits when the turn actually finishes).

  test("JSONL ending with assistant.stop_reason=tool_use emits content frames; NO terminal", async () => {
    // Reload-mid-stream case: the user sent a message, the assistant
    // started a tool_use, but the JSONL ends before the terminal
    // end_turn could be written. The translator emits the user-visible
    // content (prompt + thinking + tool_use) but withholds the terminal
    // event so live continuation can land the eventual turn_complete.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "go" }]),
      assistantEntry({
        msgId: "m_inflight",
        stopReason: "tool_use",
        content: [
          { type: "thinking", thinking: "starting..." },
          {
            type: "tool_use",
            id: "tu_inflight",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      }),
      // No matching user(tool_result), no terminal assistant.
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    // Contract: in-flight trailing turn emits content but NO
    // turn_complete (so live continuation can land the eventual
    // turn_complete without a duplicate dedup).
    expect(out.at(0)?.type).toBe("replay_started");
    expect(out.at(-1)?.type).toBe("replay_complete");
    const types = out.slice(1, -1).map((m) => m.type);
    expect(types).not.toContain("turn_complete");

    // Content frames are present and keyed to the in-flight turn's
    // msg_id ("m_inflight"). The add_user_message carries no msg_id
    // per [D15]; identification is by text content.
    const userReplay = out.find(isAddUserMessage)!;
    expect(((userReplay.content[0] ?? {}) as { text?: string }).text).toBe("go");
    const toolUse = out.find((m): m is ToolUse => m.type === "tool_use")!;
    expect(toolUse.msg_id).toBe("m_inflight");
    expect(toolUse.tool_use_id).toBe("tu_inflight");

    // count does NOT include the in-flight turn.
    expect((out.at(-1) as ReplayComplete).count).toBe(0);
  });

  test("JSONL ending with assistant.stop_reason=null (text-only mid-stream) emits content frames; NO terminal", async () => {
    // Streaming-text case: claude is mid-text-generation when the
    // reload happens. Some text accumulated in the JSONL; no end_turn.
    // Translator emits the partial text; reducer renders it as
    // awaiting-response.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "hi" }]),
      assistantEntry({
        msgId: "m_partial",
        stopReason: null,
        content: [{ type: "text", text: "Hello, " }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    // Contract: text-only in-flight trailing turn emits its text but
    // NO turn_complete; count stays at 0.
    const types = out.slice(1, -1).map((m) => m.type);
    expect(types).not.toContain("turn_complete");

    const at = out.find(isAssistantText)!;
    expect(at.text).toBe("Hello, ");
    expect(at.msg_id).toBe("m_partial");
    expect((out.at(-1) as ReplayComplete).count).toBe(0);
  });

  test("Cold-boot of a permanently-interrupted session: no terminal, reducer holds partial content", async () => {
    // Documented trade-off: if the trailing turn was interrupted in a
    // *previous* session (claude crashed / was killed before reload),
    // the new predicate emits no terminal. The reducer leaves the
    // TurnEntry uncommitted; the user sees the partial content and the
    // absence of a "completed" indicator. A submission or a reload
    // produces no phantom interrupted state — both are correct
    // behaviors. The acknowledged residual gap (b) in the never-drop
    // chain audit lives here; mitigation (client-side watchdog) is a
    // deferred follow-on, not a chain failure.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "tell me a story" }]),
      assistantEntry({
        msgId: "m_dead",
        stopReason: null,
        content: [{ type: "text", text: "Once upon" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    const types = out.slice(1, -1).map((m) => m.type);
    expect(types).not.toContain("turn_complete");
    // count stays 0 — the in-flight turn is never counted as committed.
    expect((out.at(-1) as ReplayComplete).count).toBe(0);
  });

  test("JSONL ending with bare user submission (no answering assistant) emits add_user_message but commits no turn", async () => {
    // Under [D13]'s per-entry direct emission, the user entry's
    // `add_user_message` lands on the wire immediately — it is no
    // longer deferred to the first assistant entry. With
    // `synthesizeDanglingTerminal: false` (the default), the open
    // turn at EOF gets NO orphan `turn_complete`: the live drain
    // (or a subsequent live submission) is responsible for closing
    // it. The substrate end-state: a `pendingTurn` in the reducer,
    // no committed TurnEntry — same as the live wire's treatment of
    // an unanswered submission.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "abandoned prompt" }]),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });
    // Brackets + the user opener (no terminal).
    expect(out.length).toBe(3);
    expect(out[0].type).toBe("replay_started");
    expect(out[1].type).toBe("add_user_message");
    expect(((out[1] as AddUserMessage).content[0] as { text?: string } | undefined)?.text ?? "").toBe("abandoned prompt");
    expect(out[2].type).toBe("replay_complete");
    // count stays 0 — no turn_complete fired.
    expect((out.at(-1) as ReplayComplete).count).toBe(0);
  });

  test("Committed trailing turn (end_turn present) still emits a normal turn_complete{success}", async () => {
    // Belt-and-suspenders: the predicate change only affects the
    // no-`end_turn` branch. A trailing turn that DID close cleanly
    // still gets the standard committed-turn shape.
    const jsonl = makeJsonl([
      userEntry([{ type: "text", text: "ping" }]),
      assistantEntry({
        msgId: "m_final",
        stopReason: "end_turn",
        content: [{ type: "text", text: "pong" }],
      }),
    ]);
    const out = await collectSession({ kind: "ok", jsonl });

    const inner = out.slice(1, -1);
    const tc = inner.find((m) => m.type === "turn_complete") as TurnComplete;
    expect(tc).toBeDefined();
    expect(tc.result).toBe("success");
    expect(tc.msg_id).toBe("m_final");
    expect((out.at(-1) as ReplayComplete).count).toBe(1);
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
  // (deleted: "yieldBetweenBatches=true releases the event loop between
  // batches" — pinned iterCount to the exact emit count. The yield
  // mechanism is covered indirectly by other yield-aware tests; the
  // exact count was shape-pin tax under any substrate change.)

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
  test("user entry with text emits add_user_message immediately and opens a turn", () => {
    // Per [D13]'s per-entry direct emission discipline, the user
    // entry IS the opener frame — no cross-entry buffering. The
    // open-turn tracker (`openTurnMsgId`) holds a synthesized opener
    // id (`u-<n>`) until the first content event of the turn flips it
    // to claude's real msg_id (per `noteContentMsgId`).
    const ctx = makeTranslateContext();
    const out = translateJsonlEntry(
      userEntry([{ type: "text", text: "hello" }]),
      ctx,
    );
    const addUserMessage = out.find(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(addUserMessage).toBeDefined();
    expect(((addUserMessage?.content[0] ?? {}) as { text?: string }).text).toBe("hello");
    // openTurnMsgId is now set to a synthesized opener id ("u-0").
    expect(ctx.openTurnMsgId).toBe("u-0");
  });

  test("terminal assistant entry closes the open turn and increments turnsCommitted", () => {
    // Contract: a user→assistant pair commits one turn. The user
    // entry emits the opener; the assistant entry's content flips
    // `openTurnMsgId` to claude's real id (per `noteContentMsgId`);
    // the terminal `turn_complete` carries that real id and clears
    // the tracker.
    const ctx = makeTranslateContext();
    const userOut = translateJsonlEntry(
      userEntry([{ type: "text", text: "hello" }]),
      ctx,
    );
    const assistantOut = translateJsonlEntry(
      assistantEntry({
        msgId: "msg_term",
        stopReason: "end_turn",
        content: [{ type: "text", text: "hi" }],
      }),
      ctx,
    );
    // Opener fired from the user entry; carries no msg_id per [D15].
    const userReplay = userOut.find(
      (m): m is AddUserMessage => m.type === "add_user_message",
    );
    expect(userReplay).toBeDefined();
    expect(((userReplay?.content[0] ?? {}) as { text?: string }).text).toBe("hello");
    // Terminal turn_complete from the assistant entry; keyed on
    // claude's real msg_id.
    const turnComplete = assistantOut.find(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnComplete?.msg_id).toBe("msg_term");
    // Open-turn tracker cleared; turnsCommitted ticked.
    expect(ctx.openTurnMsgId).toBeNull();
    expect(ctx.turnsCommitted).toBe(1);
  });

  test("multi-message cycle: each assistant entry emits under its own msg_id; opener fires exactly once", () => {
    // Contract: in a multi-message cycle (first entry has tool_use,
    // second is end_turn under a different msg_id), every emitted
    // frame is keyed to its own entry's msg_id — NEVER to the
    // terminal entry's id. The tugdeck reducer's per-Message
    // substrate ([D07]) keys text/tool by (msg_id, block_index); this
    // contract is what makes that keying work end-to-end.
    //
    // Under [D13], the opener (`add_user_message`) fires from the
    // user entry — NOT from any assistant entry. Subsequent assistant
    // entries within the same cycle never carry it.
    const ctx = makeTranslateContext();
    const userOut = translateJsonlEntry(
      userEntry([{ type: "text", text: "do tools" }]),
      ctx,
    );
    expect(userOut.some((m) => m.type === "add_user_message")).toBe(true);

    const firstOut = translateJsonlEntry(
      assistantEntry({
        msgId: "msg_first",
        stopReason: "tool_use",
        content: [
          { type: "text", text: "thinking..." },
          { type: "tool_use", id: "tu_1", name: "Bash", input: { cmd: "ls" } },
        ],
      }),
      ctx,
    );
    // The assistant entry MUST NOT re-emit the opener.
    expect(firstOut.some((m) => m.type === "add_user_message")).toBe(false);
    // Every msg_id-bearing frame from the first entry is keyed to msg_first.
    for (const m of firstOut) {
      const id = (m as { msg_id?: string }).msg_id;
      if (id !== undefined) expect(id).toBe("msg_first");
    }

    // Tool_result emits from the user entry (mid-turn — does not
    // touch openTurnMsgId); keyed by tool_use_id.
    const trOut = translateJsonlEntry(
      userEntry([
        { type: "tool_result", tool_use_id: "tu_1", content: "ls output" },
      ]),
      ctx,
    );
    const toolResult = trOut.find(
      (m): m is ToolResult => m.type === "tool_result",
    );
    expect(toolResult?.tool_use_id).toBe("tu_1");
    // openTurnMsgId is claude's real msg_id from the first assistant
    // entry's content (the noteContentMsgId rule). A mid-turn
    // tool_result-only user entry does not change it.
    expect(ctx.openTurnMsgId).toBe("msg_first");

    // Second assistant entry's content keys to msg_second (NOT msg_first).
    // No re-emission of add_user_message.
    const secondOut = translateJsonlEntry(
      assistantEntry({
        msgId: "msg_second",
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
      }),
      ctx,
    );
    expect(secondOut.some((m) => m.type === "add_user_message")).toBe(false);
    for (const m of secondOut) {
      const id = (m as { msg_id?: string }).msg_id;
      if (id !== undefined) expect(id).toBe("msg_second");
    }
    const tc = secondOut.find(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(tc?.msg_id).toBe("msg_second");

    expect(ctx.turnsCommitted).toBe(1);
    expect(ctx.openTurnMsgId).toBeNull();
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
