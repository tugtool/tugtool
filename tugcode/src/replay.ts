// tugcode/src/replay.ts
//
// JSONL → CODE_OUTPUT translator for tide transcript resume.
//
// Reads claude's per-session JSONL archive
// (`~/.claude/projects/<encoded-project-dir>/<claude_session_id>.jsonl`)
// and translates each entry into the OutboundMessage shapes the live
// wire produces, so tugdeck's reducer can commit replayed turns into
// `transcript` with the same machinery it uses for live turns. The
// surface is bracketed by `replay_started` / `replay_complete` so the
// reducer's `replaying` phase has a clean entry and exit point.
//
// Pure module — no filesystem I/O at translate time. The session-
// level iterator accepts a fully-loaded JSONL string (or a sentinel
// signaling "missing file" / "unreadable file") and produces the
// stream of OutboundMessages. The resume-spawn flow opens the JSONL
// by path, captures any read error, and feeds the iterator. Keeping
// translation pure makes the per-entry and per-session paths
// trivially unit-testable.
//
// Per-turn output ordering:
//
//   user_message_replay              Synthetic; carries the turn's
//                                    msg_id + user text + attachments.
//                                    Reducer mirrors to
//                                    `pendingUserMessage`.
//   tool_use     [, tool_use_n]      In insertion order.
//   tool_result  [, tool_result_n]   Interleaved by tool_use_id.
//   thinking_text (optional)         `is_partial: false`.
//   assistant_text                   `is_partial: false` (terminal
//                                    text only — replay doesn't
//                                    stream per-token deltas).
//   turn_complete                    `result: "success"` for committed
//                                    turns. The trailing in-flight turn
//                                    (no `end_turn` in JSONL) emits its
//                                    content frames but NO terminal —
//                                    see [`flushInflightTurnContent`] /
//                                    Step 5.5 of the mid-turn-replay
//                                    plan.

import type {
  AssistantText,
  Attachment,
  OutboundMessage,
  ReplayComplete,
  ReplayStarted,
  SystemMetadata,
  ThinkingText,
  ToolResult,
  ToolUse,
  TurnComplete,
  UserMessageReplay,
} from "./types.ts";

/**
 * IPC version stamped onto every emitted OutboundMessage. Held local
 * to this module rather than imported from a shared constant because
 * the live IPC version is also a literal `2` everywhere; a future
 * version bump that affects both live and replay would update both
 * sites in one edit.
 */
const IPC_VERSION = 2;

/**
 * Default batch size for the session-level async iterator. After
 * yielding this many OutboundMessages, the iterator awaits a yielded
 * `setImmediate` so the IPC pipe stays responsive during replay of
 * very large JSONLs (the largest observed session JSONLs run to tens
 * of thousands of lines).
 */
const DEFAULT_BATCH_SIZE = 16;

/**
 * Permissive shape for a single JSONL line, covering the variants
 * observed across surveyed JSONL files. Fields are optional and
 * loosely typed because Claude's per-session JSONL is an internal
 * persistence format whose shape evolves across releases. The
 * translator handles the surveyed cases explicitly and dispatches
 * unknown shapes to the `tide::replay::unknown_shape`
 * skip-with-telemetry path.
 *
 * Top-level `type` values seen across surveyed JSONLs:
 *   - `user`                    — user submission (text, image, or
 *                                  tool_result content)
 *   - `assistant`               — assistant turn or tool-use intermediate
 *   - `attachment`              — Claude bookkeeping (tool listings,
 *                                  skill listings, file references) —
 *                                  not transcript-visible
 *   - `queue-operation`         — Claude's internal scheduling marker
 *   - `last-prompt`             — bookmark for `--continue`
 *   - `file-history-snapshot`   — Claude's file-tracking metadata
 *   - `ai-title`                — auto-generated session title
 *   - `system`                  — `system_init`-style bookkeeping
 *   - `permission-mode`         — UI-visible at the chrome layer
 *
 * Content-block `type` values inside `message.content[]`:
 *   - `text`        — assistant or user text
 *   - `tool_use`    — assistant tool invocation
 *   - `tool_result` — user-side tool response, keyed by tool_use_id
 *   - `thinking`    — extended-thinking content
 *   - `image`       — base64-encoded image attachment in user submission
 */
export interface JsonlEntry {
  type?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    stop_reason?: string | null;
    content?: ReadonlyArray<{
      type?: string;
      text?: string;
      thinking?: string;
      // tool_use blocks
      id?: string;
      name?: string;
      input?: unknown;
      // tool_result blocks
      tool_use_id?: string;
      is_error?: boolean;
      content?: unknown;
      // image blocks
      source?: { type?: string; media_type?: string; data?: string };
    }>;
  };
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Telemetry — structured warn lines emitted on shape oddities
// ---------------------------------------------------------------------------

/**
 * Telemetry sink. Tests inject a capturing implementation; production
 * uses the default that forwards to `console.error`. The shape
 * matches the structured-log convention the tugcast supervisor uses
 * (`target=`, `event=`, `key=value` pairs).
 */
export interface ReplayTelemetry {
  /** Surveyed shape inventory drift signal — the JSONL carried a
   * top-level type or content-block type the translator doesn't
   * recognize. Skipped silently; entry-level data is lost. */
  unknownShape(detail: { kind: "top_level" | "content_block"; type: string }): void;
  /** A JSONL line failed `JSON.parse`. Skipped; surrounding turns
   * still commit. Translator emits the warn so an operator can
   * grep for `tide::replay::malformed` in production. */
  malformedLine(detail: { reason: string; preview: string }): void;
}

const NOOP_TELEMETRY: ReplayTelemetry = {
  unknownShape() {},
  malformedLine() {},
};

const DEFAULT_TELEMETRY: ReplayTelemetry = {
  unknownShape(detail) {
    console.error(
      `[tide::replay::unknown_shape] kind=${detail.kind} type=${detail.type}`,
    );
  },
  malformedLine(detail) {
    console.error(
      `[tide::replay::malformed] reason=${detail.reason} preview=${JSON.stringify(detail.preview)}`,
    );
  },
};

// ---------------------------------------------------------------------------
// TranslateContext — per-translation state
// ---------------------------------------------------------------------------

/**
 * Per-turn buffer that accumulates content across the JSONL entries
 * comprising a single user → assistant turn:
 *
 *   - The user submission's text + image attachments (captured on the
 *     `user` entry that opens the turn; held until the terminal
 *     `assistant` entry surfaces a `message.id` so the user-message
 *     and the turn share a single canonical msg_id).
 *   - Tool-use invocations from intermediate `assistant` entries
 *     (stop_reason=tool_use) and the responses from the corresponding
 *     `user` entries with tool_result content.
 *   - Accumulated `thinking` and assistant `text` content.
 *
 * A turn ends when an `assistant` entry with `stop_reason: "end_turn"`
 * lands. The buffer is flushed as a fixed-order sequence of
 * OutboundMessages — including a terminal `turn_complete{success}` —
 * and reset for the next turn.
 *
 * A buffer that survives end-of-file (no terminal `end_turn` ever
 * arrived — the JSONL was truncated mid-turn, e.g. by a reload during
 * streaming) is flushed via [`flushInflightTurnContent`]: content frames
 * surface so the user sees the in-flight portion of the turn, but **no
 * terminal `turn_complete` is emitted**. The reducer holds the partial
 * content in `pendingUserMessage` / `scratch[msgId]` until the live
 * drain produces the eventual `turn_complete` from claude's continuing
 * stream. See Step 5.5 of the mid-turn-replay plan; this is the
 * structural fix for the 2026-05-05 reload-mid-stream bug.
 */
interface PerTurnBuffer {
  /** The terminal assistant entry's `message.id`. Bound when the
   * end_turn (or the only available — at EOF — assistant) entry
   * arrives. Until then the buffer is open and the msg_id slot is
   * filled with the most recently observed assistant `message.id`
   * so an orphan-turn flush has a coherent id to attach to. */
  msgId: string;
  /** Accumulated text from the terminal `assistant` entry's `text`
   * blocks. Replay is per-turn (not per-token) so this is never a
   * partial — `is_partial: false` is hard-coded on emission. */
  assistantText: string;
  /** Accumulated `thinking` content. */
  thinkingText: string;
  /** Tool-use invocations seen so far, in insertion order. The
   * matching tool_result responses are stored alongside; emission
   * pairs them at flush time. */
  toolCalls: Array<{
    toolUseId: string;
    toolName: string;
    input: unknown;
    /** The tool_result, populated when the corresponding `user`
     * entry's tool_result block lands. `null` until then. */
    result: { output: string; is_error: boolean } | null;
  }>;
}

export interface TranslateContext {
  /**
   * Wire-message sequence counter — used for `seq` fields on shapes
   * that carry one (`assistant_text`, `tool_use`, `thinking_text`,
   * `turn_complete`). Bumped on every emission. Live wire's seq
   * counter restarts at 0 per session; replay does the same.
   */
  globalSeq: number;
  /** Number of turns committed via `turn_complete` so far. */
  turnsCommitted: number;
  /**
   * Pending user submission's text — captured when a `user` JSONL
   * entry with text content arrives, held until the next `assistant`
   * entry binds it to a turn msg_id. `null` between turns or before
   * the first user entry.
   */
  pendingUserText: string | null;
  /** Pending user-submission image attachments. */
  pendingUserAttachments: Attachment[];
  /** The active turn buffer, or `null` between turns. */
  buffer: PerTurnBuffer | null;
  /** Telemetry sink. */
  telemetry: ReplayTelemetry;
}

export function makeTranslateContext(
  telemetry: ReplayTelemetry = DEFAULT_TELEMETRY,
): TranslateContext {
  return {
    globalSeq: 0,
    turnsCommitted: 0,
    pendingUserText: null,
    pendingUserAttachments: [],
    buffer: null,
    telemetry,
  };
}

// ---------------------------------------------------------------------------
// Per-entry translator
// ---------------------------------------------------------------------------

/**
 * Top-level entry types whose surveyed semantics is "skip silently".
 * These either represent Claude bookkeeping (`attachment` references,
 * scheduling markers, file-history snapshots, auto-generated titles)
 * or surface state that's already represented elsewhere on the live
 * wire (`system` mirrors `session_init` / `system_metadata`,
 * `permission-mode` rides the chrome layer).
 */
const SKIPPED_TOP_LEVEL_TYPES: ReadonlySet<string> = new Set([
  "attachment",
  "queue-operation",
  "last-prompt",
  "file-history-snapshot",
  "ai-title",
  "system",
  "permission-mode",
]);

/**
 * Translate one JSONL entry into 0..N outbound messages, mutating
 * `ctx`'s per-turn buffer as a side effect. Pure with respect to
 * external state; the only mutation is on the passed `ctx`.
 *
 * Invariants:
 *   - A `user` entry with `text` content captures into
 *     `ctx.pendingUserText`; emits nothing yet.
 *   - A `user` entry with `tool_result` content fills the matching
 *     buffer slot keyed on `tool_use_id`; emits nothing yet.
 *   - An `assistant` entry with `stop_reason: "tool_use"` or `null`
 *     accumulates content into the buffer; emits nothing yet.
 *   - An `assistant` entry with `stop_reason: "end_turn"` is the
 *     turn boundary; flushes the buffer as the fixed-order sequence
 *     `[user_message_replay, ...tool_use_then_result, thinking_text?,
 *     assistant_text?, turn_complete(success)]` and resets ctx.
 *   - A `SKIPPED_TOP_LEVEL_TYPES` entry returns `[]` immediately.
 *   - Anything else falls into the `unknown_shape` skip path.
 */
export function translateJsonlEntry(
  entry: JsonlEntry,
  ctx: TranslateContext,
): OutboundMessage[] {
  const topType = typeof entry.type === "string" ? entry.type : "";
  if (SKIPPED_TOP_LEVEL_TYPES.has(topType)) {
    return [];
  }

  if (topType === "user") {
    handleUserEntry(entry, ctx);
    return [];
  }

  if (topType === "assistant") {
    return handleAssistantEntry(entry, ctx);
  }

  ctx.telemetry.unknownShape({ kind: "top_level", type: topType || "<missing>" });
  return [];
}

function handleUserEntry(entry: JsonlEntry, ctx: TranslateContext): void {
  const content = entry.message?.content ?? [];
  // A user entry can carry `text` blocks (a fresh user submission)
  // or `tool_result` blocks (a response to a prior tool_use). The two
  // cases never mix in surveyed JSONLs — but the translator treats
  // them independently so a future hybrid wouldn't break it.
  const textParts: string[] = [];
  const attachments: Attachment[] = [];

  for (const block of content) {
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType === "text") {
      if (typeof block.text === "string") {
        textParts.push(block.text);
      }
      continue;
    }
    if (blockType === "tool_result") {
      // Pair with the buffered tool_use. If the buffer is closed (no
      // matching tool_use) we drop silently — a stray tool_result
      // without its initiating tool_use is a malformed JSONL signal,
      // not user-visible content.
      const toolUseId =
        typeof block.tool_use_id === "string" ? block.tool_use_id : "";
      const isError = block.is_error === true;
      const output = coerceToolResultContent(block.content);
      if (ctx.buffer && toolUseId.length > 0) {
        const slot = ctx.buffer.toolCalls.find(
          (t) => t.toolUseId === toolUseId,
        );
        if (slot) {
          slot.result = { output, is_error: isError };
        }
      }
      continue;
    }
    if (blockType === "image") {
      const source = block.source ?? {};
      const mediaType =
        typeof source.media_type === "string" ? source.media_type : "image/png";
      const data = typeof source.data === "string" ? source.data : "";
      attachments.push({
        filename: "",
        content: data,
        media_type: mediaType,
      });
      continue;
    }
    if (blockType.length === 0) {
      // Empty block type — `user` entries with no content (sometimes
      // a bare `{role: "user", content: []}` shows up in JSONLs) are
      // benign no-ops. Don't fire telemetry for them.
      continue;
    }
    ctx.telemetry.unknownShape({ kind: "content_block", type: blockType });
  }

  if (textParts.length > 0 || attachments.length > 0) {
    // Capture as the pending user submission. Multiple text blocks
    // in one user entry concatenate (matches how live `user_message`
    // arrives as a single text payload).
    if (textParts.length > 0) {
      ctx.pendingUserText =
        (ctx.pendingUserText ?? "") + textParts.join("");
    }
    if (attachments.length > 0) {
      ctx.pendingUserAttachments = ctx.pendingUserAttachments.concat(
        attachments,
      );
    }
  }
}

/**
 * Coerce a `tool_result.content` field — which may be a string or a
 * structured array of content blocks — into a plain string suitable
 * for `ToolResult.output`. The live `ToolResult` outbound shape
 * carries a single string; replay flattens structured tool_result
 * content via JSON.stringify rather than synthesizing a richer
 * shape, since the tugdeck side already accepts string output.
 */
function coerceToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  if (Array.isArray(content)) {
    // Structured tool_result content: array of `{type: "text", text: "..."}`
    // blocks (or other shapes). Concatenate text blocks; fall back to
    // JSON for anything else.
    const parts: string[] = [];
    let allText = true;
    for (const item of content) {
      if (
        item !== null &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string"
      ) {
        parts.push((item as { text: string }).text);
      } else {
        allText = false;
        break;
      }
    }
    if (allText) {
      return parts.join("");
    }
  }
  try {
    return JSON.stringify(content);
  } catch {
    return "";
  }
}

function handleAssistantEntry(
  entry: JsonlEntry,
  ctx: TranslateContext,
): OutboundMessage[] {
  const content = entry.message?.content ?? [];
  const stopReason = entry.message?.stop_reason ?? null;
  const entryMsgId =
    typeof entry.message?.id === "string" ? entry.message.id : "";

  // Open or reuse the turn buffer. The msgId slot tracks the most
  // recent assistant entry's `message.id` so an orphan-turn flush at
  // EOF has a coherent id even if the terminal end_turn never
  // arrived. The terminal entry overrides this slot below.
  if (ctx.buffer === null) {
    ctx.buffer = {
      msgId: entryMsgId,
      assistantText: "",
      thinkingText: "",
      toolCalls: [],
    };
  } else if (entryMsgId.length > 0) {
    ctx.buffer.msgId = entryMsgId;
  }

  // Accumulate content into the buffer.
  for (const block of content) {
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType === "text") {
      if (typeof block.text === "string") {
        ctx.buffer.assistantText += block.text;
      }
      continue;
    }
    if (blockType === "thinking") {
      if (typeof block.thinking === "string") {
        ctx.buffer.thinkingText += block.thinking;
      } else if (typeof block.text === "string") {
        // Tolerate a handful of older JSONL shapes that put the
        // thinking text in the `text` field on a `thinking` block.
        ctx.buffer.thinkingText += block.text;
      }
      continue;
    }
    if (blockType === "tool_use") {
      const toolUseId = typeof block.id === "string" ? block.id : "";
      const toolName = typeof block.name === "string" ? block.name : "";
      const input = block.input ?? {};
      // Skip tool_use blocks with no id — they can't be paired with
      // a tool_result and are useless to the reducer.
      if (toolUseId.length > 0) {
        ctx.buffer.toolCalls.push({
          toolUseId,
          toolName,
          input,
          result: null,
        });
      }
      continue;
    }
    if (blockType === "image") {
      // Assistants don't normally produce image content blocks; skip
      // with an unknown_shape signal so a future shape change is
      // observable.
      ctx.telemetry.unknownShape({
        kind: "content_block",
        type: "image (in assistant entry)",
      });
      continue;
    }
    if (blockType.length === 0) {
      continue;
    }
    ctx.telemetry.unknownShape({ kind: "content_block", type: blockType });
  }

  // Intermediate assistant entry: keep accumulating, emit nothing.
  if (stopReason !== "end_turn") {
    return [];
  }

  // Terminal entry: flush the turn.
  return flushTurn(ctx);
}

/**
 * Emit the per-turn buffer's content frames in fixed order, without a
 * terminal `turn_complete`. Shared between [`flushTurn`] (which appends
 * the terminal afterward) and [`flushInflightTurnContent`] (which does
 * not). Resets the per-turn buffer state on the way out so the next
 * `assistant` entry opens a fresh buffer; does NOT bump
 * `ctx.turnsCommitted` — that's the caller's call (only the committed
 * path counts toward `replay_complete.count`).
 *
 * Returns `[]` if the buffer is unset (defensive — neither caller
 * should hit this).
 */
function emitTurnContentFrames(ctx: TranslateContext): OutboundMessage[] {
  const buffer = ctx.buffer;
  if (buffer === null) {
    return [];
  }
  const msgId = buffer.msgId;
  const out: OutboundMessage[] = [];

  // 1. user_message_replay — emit even with empty text so the reducer
  // sees a stable "this turn happened, here's the user side"
  // signal. Empty text covers degenerate-but-real cases like a
  // turn that opens with a `--continue` flag and no preceding user
  // entry in the JSONL.
  const userText = ctx.pendingUserText ?? "";
  const userAttachments = ctx.pendingUserAttachments;
  const userMessage: UserMessageReplay = {
    type: "user_message_replay",
    msg_id: msgId,
    text: userText,
    attachments: userAttachments,
    ipc_version: IPC_VERSION,
  };
  out.push(userMessage);

  // 2. tool_use [+ tool_result] pairs in insertion order.
  for (const tc of buffer.toolCalls) {
    const toolUse: ToolUse = {
      type: "tool_use",
      msg_id: msgId,
      seq: ctx.globalSeq++,
      tool_name: tc.toolName,
      tool_use_id: tc.toolUseId,
      input: typeof tc.input === "object" && tc.input !== null
        ? tc.input as object
        : {},
      ipc_version: IPC_VERSION,
    };
    out.push(toolUse);
    if (tc.result !== null) {
      const toolResult: ToolResult = {
        type: "tool_result",
        tool_use_id: tc.toolUseId,
        output: tc.result.output,
        is_error: tc.result.is_error,
        ipc_version: IPC_VERSION,
      };
      out.push(toolResult);
    }
  }

  // 3. thinking_text (optional).
  if (buffer.thinkingText.length > 0) {
    const thinking: ThinkingText = {
      type: "thinking_text",
      msg_id: msgId,
      seq: ctx.globalSeq++,
      text: buffer.thinkingText,
      is_partial: false,
      status: "complete",
      ipc_version: IPC_VERSION,
    };
    out.push(thinking);
  }

  // 4. assistant_text (terminal text only — replay is per-turn, not
  //    per-token).
  if (buffer.assistantText.length > 0) {
    const assistant: AssistantText = {
      type: "assistant_text",
      msg_id: msgId,
      seq: ctx.globalSeq++,
      rev: 0,
      text: buffer.assistantText,
      is_partial: false,
      status: "complete",
      ipc_version: IPC_VERSION,
    };
    out.push(assistant);
  }

  // Reset the per-turn buffer state for the next turn (or for the
  // EOF-orphan path, which also wants the reset before the iterator
  // returns).
  ctx.buffer = null;
  ctx.pendingUserText = null;
  ctx.pendingUserAttachments = [];

  return out;
}

/**
 * Flush the current per-turn buffer as the fixed-order
 * `[user_message_replay, tool_use/tool_result..., thinking_text?,
 * assistant_text?, turn_complete{success}]` sequence and reset ctx for
 * the next turn. Called from [`translateJsonlEntry`] when an `assistant`
 * entry's `stop_reason` is `"end_turn"` — that's the JSONL signal that
 * the turn closed normally. Increments `ctx.turnsCommitted` so the
 * `replay_complete.count` reflects the committed turn.
 *
 * Returns `[]` if the buffer is unset (defensive — flushTurn should
 * never be called on a null buffer).
 */
function flushTurn(ctx: TranslateContext): OutboundMessage[] {
  const buffer = ctx.buffer;
  if (buffer === null) {
    return [];
  }
  const msgId = buffer.msgId;
  const out = emitTurnContentFrames(ctx);

  // 5. turn_complete{success}.
  const turnComplete: TurnComplete = {
    type: "turn_complete",
    msg_id: msgId,
    seq: ctx.globalSeq++,
    result: "success",
    ipc_version: IPC_VERSION,
  };
  out.push(turnComplete);

  ctx.turnsCommitted += 1;
  return out;
}

/**
 * Flush the trailing in-flight turn's content at end-of-JSONL **without
 * a terminal `turn_complete`**. The original mid-turn-replay bug
 * (2026-05-05): the pre-Step-4 translator synthesized
 * `turn_complete{result: "interrupted"}` here, which caused the reducer
 * to commit a partial TurnEntry for a turn that was actually still
 * streaming — and then dedupe (via `committedMsgIds`) the live
 * `turn_complete` that finished the turn for real. The user saw an
 * "interrupted" turn that wasn't actually interrupted, and the
 * streaming response never landed.
 *
 * The fix: emit the content frames so the user sees the in-flight
 * portion of the turn (user_message_replay + thinking + assistant_text +
 * tool_use/tool_result), but DO NOT emit a terminal event. The
 * reducer's `pendingUserMessage` and `scratch[msgId]` slots stay
 * populated; the live drain continuing post-replay produces the
 * eventual `turn_complete` naturally when claude actually finishes.
 *
 * If claude never finishes (claude crashed before reload, network
 * dropped, etc.), the reducer leaves the TurnEntry uncommitted. The
 * user sees the partial content and the absence of a "completed"
 * indicator. Acknowledged residual gap (b) in the [Never-drop chain
 * audit](roadmap/tugplan-tide-mid-turn-replay.md#step-5-never-drop) —
 * client-side watchdog mitigation is deferred behavior, not a never-
 * drop chain failure.
 *
 * Does NOT increment `ctx.turnsCommitted` — the in-flight turn is not
 * counted toward `replay_complete.count` because no terminal frame
 * fired. See [DM08] / [Step 5.5](roadmap/tugplan-tide-mid-turn-replay.md#step-5-5).
 */
function flushInflightTurnContent(ctx: TranslateContext): OutboundMessage[] {
  return emitTurnContentFrames(ctx);
}

// ---------------------------------------------------------------------------
// Session-level async iterator
// ---------------------------------------------------------------------------

/**
 * Discriminated input shape for `translateJsonlSession`. The
 * resume-spawn flow produces one of these by attempting to read the
 * JSONL file; the translator threads the outcome into the
 * `replay_started` / `replay_complete` bracket pair without needing
 * any filesystem awareness itself.
 */
export type ReplayInput =
  | {
      kind: "ok";
      jsonl: string;
      /**
       * Claude's per-session id (matches the JSONL filename). Threaded
       * through so the synthesized `system_metadata` IPC emitted at the
       * top of replay can carry the right `session_id`. Optional —
       * tests that don't care about the synthesized frame can omit it
       * and the field defaults to "" downstream.
       */
      claudeSessionId?: string;
    }
  | { kind: "missing"; message?: string }
  | { kind: "unreadable"; message: string };

export interface TranslateSessionOptions {
  /** Number of OutboundMessages to yield before awaiting a yielded
   * `setImmediate`. Default: {@link DEFAULT_BATCH_SIZE} (16). */
  batchSize?: number;
  /** Telemetry sink. Default: stderr-forwarding. Tests inject a
   * capturing sink. */
  telemetry?: ReplayTelemetry;
  /** Disable the inter-batch yield. Tests set this to keep
   * synchronous; production never sets it. */
  disableYield?: boolean;
}

/**
 * Result returned by `translateJsonlSession`'s AsyncGenerator (the
 * value reachable via `.next()` when `done: true`, also typed as the
 * generator's `TReturn` parameter).
 *
 * `count` mirrors the per-wire `replay_complete.count` and counts
 * `turn_complete` events emitted by the translator. A trailing
 * in-flight turn that the translator orphan-synthesizes counts toward
 * this total.
 *
 * Step 4 mid-turn-replay: `runReplay` is now ledger-driven and uses
 * `translateJsonlSession` only as the cold-boot fallback when the
 * ledger has no rows for the session. The Step-3-era
 * `liveInflightMsgId` / `skippedTrailingTurn` surface that coordinated
 * trailing-turn skipping with `emitInflightTurnFromActiveTurn` is gone
 * — the ledger row keyed by `tug_turn_id` is the single coordination
 * point now, and `extractTurnContent` is the per-row content lookup
 * runReplay performs against the JSONL.
 */
export interface TranslateSessionResult {
  count: number;
}

/**
 * Translate a complete JSONL replay session into a stream of
 * OutboundMessages bracketed by `replay_started` /
 * `replay_complete`.
 *
 * The bracket pair is *always* emitted, regardless of whether the
 * JSONL is missing, unreadable, malformed, or empty — the reducer's
 * `replaying` phase is gated on the bracket events, so omitting one
 * would leave the card stuck. On the error branches the
 * `replay_complete` carries an `error` payload identifying the
 * failure mode; tugdeck surfaces this via `lastReplayResult`.
 *
 * Yields are batched so a very long JSONL doesn't hold the IPC pipe
 * for seconds. The caller awaits the iterator one OutboundMessage at
 * a time; the inter-batch `setImmediate` yields the event loop so
 * the IPC writer can drain.
 */
export async function* translateJsonlSession(
  input: ReplayInput,
  opts: TranslateSessionOptions = {},
): AsyncGenerator<OutboundMessage, TranslateSessionResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const telemetry = opts.telemetry ?? DEFAULT_TELEMETRY;
  const yieldBetweenBatches = opts.disableYield !== true;

  const started: ReplayStarted = {
    type: "replay_started",
    ipc_version: IPC_VERSION,
  };
  yield started;

  // Error branches: replay_started → replay_complete{error} with no
  // turns between. This is the contract the reducer relies on for the
  // missing/unreadable/timeout cases.
  if (input.kind === "missing") {
    const complete: ReplayComplete = {
      type: "replay_complete",
      count: 0,
      error: {
        kind: "jsonl_missing",
        message: input.message ?? "JSONL not found",
      },
      ipc_version: IPC_VERSION,
    };
    yield complete;
    return { count: 0 };
  }
  if (input.kind === "unreadable") {
    const complete: ReplayComplete = {
      type: "replay_complete",
      count: 0,
      error: {
        kind: "jsonl_unreadable",
        message: input.message,
      },
      ipc_version: IPC_VERSION,
    };
    yield complete;
    return { count: 0 };
  }

  // OK branch: parse + translate line by line.
  const ctx = makeTranslateContext(telemetry);
  const claudeSessionId = input.claudeSessionId ?? "";
  // Synthesize a `system_metadata` IPC the first time we encounter an
  // `assistant` entry that carries a `message.model`. The JSONL's
  // top-level `system` entries are skipped (they mirror live
  // session_init and aren't surveyed in current Claude Code JSONLs);
  // the model field is duplicated on every assistant message via
  // `message.model`. A single emission at the top of replay populates
  // tugdeck's `SessionMetadataStore` so replayed turns render with
  // the right model identifier and badge from the start, rather than
  // the "Code" placeholder until claude's live session_init lands
  // post-replay.
  let emittedSystemMetadata = false;
  let sawAnyMalformed = false;
  let emittedSinceYield = 0;

  // Split on newlines without losing trailing-no-newline content. The
  // tail (after the final \n) is included if non-empty so the last
  // entry of a JSONL that lacks a trailing newline still parses.
  const lines = input.jsonl.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    let parsed: JsonlEntry;
    try {
      parsed = JSON.parse(line) as JsonlEntry;
    } catch (err) {
      sawAnyMalformed = true;
      telemetry.malformedLine({
        reason: err instanceof Error ? err.message : String(err),
        preview: line.slice(0, 80),
      });
      continue;
    }

    if (
      !emittedSystemMetadata &&
      parsed.type === "assistant" &&
      typeof parsed.message?.model === "string" &&
      parsed.message.model.length > 0
    ) {
      const sysMeta: SystemMetadata = {
        type: "system_metadata",
        session_id: claudeSessionId,
        cwd: "",
        tools: [],
        model: parsed.message.model,
        permissionMode: "",
        slash_commands: [],
        plugins: [],
        agents: [],
        skills: [],
        mcp_servers: [],
        version: "",
        output_style: "",
        fast_mode_state: "",
        apiKeySource: "",
        ipc_version: IPC_VERSION,
      };
      yield sysMeta;
      emittedSystemMetadata = true;
    }

    const messages = translateJsonlEntry(parsed, ctx);
    for (const msg of messages) {
      yield msg;
      emittedSinceYield += 1;
      if (yieldBetweenBatches && emittedSinceYield >= batchSize) {
        emittedSinceYield = 0;
        await yieldToEventLoop();
      }
    }
  }

  // In-flight trailing turn at end-of-JSONL — see
  // [`flushInflightTurnContent`] for the design rationale. The
  // user-visible content of the partial turn surfaces; no terminal
  // event fires; the live drain (or the next reload's translator
  // pass against a fuller JSONL) lands the eventual close. Step 5.5
  // of the mid-turn-replay plan is the structural fix for the
  // 2026-05-05 mid-turn-reload bug.
  if (ctx.buffer !== null) {
    const inflight = flushInflightTurnContent(ctx);
    for (const msg of inflight) {
      yield msg;
    }
  }

  const complete: ReplayComplete = {
    type: "replay_complete",
    count: ctx.turnsCommitted,
    ipc_version: IPC_VERSION,
    ...(sawAnyMalformed
      ? {
          error: {
            kind: "jsonl_malformed" as const,
            message: "one or more JSONL lines failed to parse; surrounding turns committed",
          },
        }
      : {}),
  };
  yield complete;
  return { count: ctx.turnsCommitted };
}

/**
 * Yield control to the event loop for one tick. Equivalent to
 * `setImmediate` in Node, expressed as a Bun-compatible Promise.
 * Tests with `disableYield: true` short-circuit this.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Convenience exports for tests
// ---------------------------------------------------------------------------

/** Exposed for tests that want to inject a capturing telemetry sink. */
export const REPLAY_NOOP_TELEMETRY = NOOP_TELEMETRY;

/** Re-export for test ergonomics — avoids a separate const import. */
export { DEFAULT_BATCH_SIZE as REPLAY_DEFAULT_BATCH_SIZE };
