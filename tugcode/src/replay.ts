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
//   turn_complete                    `result: "success"`. Emitted only
//                                    when an assistant entry's
//                                    `stop_reason === "end_turn"`. The
//                                    trailing in-flight assistant entry
//                                    of an unfinished cycle emits its
//                                    content frames per-entry but no
//                                    terminal — the live drain
//                                    continuing post-replay produces
//                                    the eventual `turn_complete` when
//                                    claude's `result` lands.

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
  ToolUseStructured,
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
  /**
   * Structured tool result, sibling to `message.content`. Claude Code
   * persists this as the camelCase `toolUseResult` field on `user`
   * entries that carry a `tool_result` block (the wire-side analog is
   * the snake_case `tool_use_result` field on stream-json events; see
   * `session.ts:670` for the live path). Shape is tool-specific —
   * Read carries `{type: "text", file: {filePath, content, ...}}`,
   * Edit carries `{toolName, filePath, structuredPatch, ...}`, etc.
   * The translator forwards this payload verbatim as the
   * `structured_result` field of a `tool_use_structured` IPC message
   * so the reducer/wrappers see the same shape on replay as on live.
   */
  toolUseResult?: Record<string, unknown>;
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
 * Per-cycle context for the JSONL → frame translator.
 *
 * "Cycle" = one user submission + claude's response (one or more
 * assistant entries, ending with `stop_reason === "end_turn"`).
 *
 * Each `assistant` JSONL entry emits its content frames immediately,
 * keyed on its own `message.id` — multi-message claude cycles produce
 * multiple separately-keyed assistant streams on the wire. The cycle's
 * `user_message_replay` fires once, on the FIRST assistant entry,
 * keyed on claude's first `message.id`. The terminal `turn_complete`
 * fires only on the `end_turn` entry.
 *
 * `pendingUserText` and `pendingUserAttachments` hold the cycle's
 * user submission until the first assistant entry consumes them.
 * `cycleOpen` tracks whether `user_message_replay` has fired yet so
 * subsequent assistant entries within the same cycle skip re-emitting
 * it. `turnsCommitted` advances once per `end_turn` (the count
 * surfaced via `replay_complete.count`).
 *
 * A cycle that survives end-of-file (no terminal `end_turn` ever
 * arrived — the JSONL was truncated mid-stream, e.g. by a reload while
 * claude is still responding) needs no special EOF flush: each
 * assistant entry has already emitted its content per-entry. The
 * absence of `turn_complete` keeps the reducer's `pendingUserMessage`
 * and per-msg-id scratch populated until the live drain produces the
 * eventual `turn_complete` when claude's `result` lands.
 */
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
   * entry with text content arrives, held until the FIRST `assistant`
   * entry of the cycle emits the `user_message_replay` (and clears
   * this slot). `null` between cycles or before the cycle's user
   * entry has been read.
   */
  pendingUserText: string | null;
  /** Pending user-submission image attachments. */
  pendingUserAttachments: Attachment[];
  /**
   * True between the cycle's first `assistant` entry (which emits
   * `user_message_replay`) and its terminal `end_turn` (which emits
   * `turn_complete` and resets the flag). Used to suppress repeated
   * `user_message_replay` emits across multi-message claude turns:
   * the user submission appears once on the wire, even though the
   * claude side can produce multiple assistant entries with distinct
   * `message.id`s within one cycle.
   */
  cycleOpen: boolean;
  /**
   * `message.id` of the currently-open cycle's most-recent `assistant`
   * entry, or `null` when no cycle is open. Tracked so that — when the
   * JSONL ends with a cycle still open and the caller asked for a
   * dangling-terminal synthesis (`synthesizeDanglingTerminal`) — the
   * EOF-time synthetic `turn_complete` can key on the same id the
   * cycle's content frames carried. Reset to `null` by the terminal
   * `turn_complete` emit alongside `cycleOpen`.
   */
  cycleMsgId: string | null;
  /**
   * Counter for synthetic msg_ids assigned to orphan-interrupted
   * submissions (user entries with no following assistant cycle).
   * Bumped each time `handleUserEntry` flushes a prior `pendingUserText`
   * as an interrupted TurnEntry. The id format is `orphan-<n>` so it
   * cannot collide with claude's `msg_<base62>` ids.
   */
  orphanCounter: number;
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
    cycleOpen: false,
    cycleMsgId: null,
    orphanCounter: 0,
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
 * Per-call options for {@link translateJsonlEntry}.
 *
 * Threaded by the session-level loop when peek-ahead detects shape
 * variants the per-entry translator can't see on its own.
 */
export interface TranslateJsonlEntryOptions {
  /**
   * When true, the per-entry translator skips emitting `turn_complete`
   * for an `assistant` entry whose `stop_reason === "end_turn"`,
   * leaving `ctx.cycleOpen` true so a following same-msg_id entry's
   * content frames land in the same cycle.
   *
   * The session-level loop sets this when the immediately-following
   * non-skipped JSONL entry is another `assistant` entry sharing the
   * current entry's `message.id`. Claude Code's SDK occasionally
   * persists a single assistant message across multiple JSONL records
   * (one snapshot when the thinking block was complete, another when
   * the text block was complete), with both records carrying
   * `stop_reason: "end_turn"`. Without suppression the leading entry
   * would emit a terminal `turn_complete` and reset `cycleOpen`,
   * causing the trailing entry to open a phantom second cycle whose
   * `user_message_replay` carries empty text and whose duplicate
   * `turn_complete` is dedupe-dropped by the reducer — leaving
   * `pendingUserMessage` populated and the post-replay phase stuck in
   * `streaming` (canInterrupt=true) once `replay_complete` lands.
   */
  suppressTurnComplete?: boolean;
}

/**
 * Translate one JSONL entry into 0..N outbound messages. Pure with
 * respect to external state; the only mutation is on the passed `ctx`.
 *
 * Invariants:
 *   - A `user` entry with `text` content captures into
 *     `ctx.pendingUserText`; emits nothing yet (the cycle's user
 *     side appears on the wire once the first `assistant` entry of
 *     the cycle binds it to claude's `message.id`).
 *   - A `user` entry with `tool_result` blocks emits one
 *     `tool_result` outbound per block immediately. The reducer
 *     pairs them with the prior `tool_use` by `tool_use_id`; no
 *     translator-side buffering is needed.
 *   - An `assistant` entry emits its content frames immediately,
 *     keyed on its own `message.id`. Multi-message claude cycles
 *     (text → tool_use → tool_result → second text) produce two
 *     separately-keyed assistant streams on the wire — one per
 *     `message.id`. That matches the live shape (one id per claude
 *     message; no canonicalization).
 *   - An `assistant` entry with `stop_reason: "end_turn"` additionally
 *     emits a terminal `turn_complete` and increments
 *     `ctx.turnsCommitted` (which feeds `replay_complete.count`),
 *     UNLESS `options.suppressTurnComplete` is true (set by the
 *     session-level loop when peek-ahead detects a same-msg_id
 *     continuation entry; see {@link TranslateJsonlEntryOptions}).
 *   - The cycle's `user_message_replay` fires on the FIRST `assistant`
 *     entry of the cycle (when `pendingUserText` is consumed). Each
 *     subsequent `assistant` entry within the same cycle skips
 *     re-emitting it.
 *   - A `SKIPPED_TOP_LEVEL_TYPES` entry returns `[]` immediately.
 *   - Anything else falls into the `unknown_shape` skip path.
 */
export function translateJsonlEntry(
  entry: JsonlEntry,
  ctx: TranslateContext,
  options?: TranslateJsonlEntryOptions,
): OutboundMessage[] {
  const topType = typeof entry.type === "string" ? entry.type : "";
  if (SKIPPED_TOP_LEVEL_TYPES.has(topType)) {
    return [];
  }

  if (topType === "user") {
    return handleUserEntry(entry, ctx);
  }

  if (topType === "assistant") {
    return handleAssistantEntry(entry, ctx, options);
  }

  ctx.telemetry.unknownShape({ kind: "top_level", type: topType || "<missing>" });
  return [];
}

/**
 * Sentinel string claude writes as a synthetic `user` JSONL entry when
 * the prior turn was interrupted. Surveyed in `roadmap/archive/
 * tugtalk-protocol.txt` §2b: "control_request interrupt sends on
 * stdin, CLI acknowledges, injects '[Request interrupted by user]',
 * emits a proper `result` event." Also lands in JSONL after a Cmd-Q
 * mid-stream when claude is resumed and detects an unfinished turn.
 *
 * The translator treats this string as a SENTINEL: its presence
 * triggers a flush of any pending orphan submission, but the marker
 * itself is NOT emitted as a user-visible frame on the wire. Without
 * this special-case, the marker text concatenates onto the prior or
 * following user submission's text on replay (the 2026-05-06
 * "hello[Request interrupted by user]what time is it?" symptom).
 */
const INTERRUPT_MARKER_TEXT = "[Request interrupted by user]";

/**
 * Flush any pending orphan user submission as a committed-interrupted
 * turn pair on the wire: `user_message_replay` + `turn_complete{result:
 * "interrupted"}` keyed on a synthetic `orphan-<n>` id. Resets
 * `pendingUserText` / `pendingUserAttachments` and bumps both
 * `turnsCommitted` (the orphan IS committed; it shows in the
 * transcript) and `orphanCounter` (so subsequent orphans get unique
 * ids). Returns the emitted frames; caller appends to its own output.
 *
 * Idempotent on empty pending state — returns `[]` when there's
 * nothing to flush, so callers can call unconditionally before
 * stashing a new submission.
 */
function flushPendingOrphan(ctx: TranslateContext): OutboundMessage[] {
  if (ctx.pendingUserText === null && ctx.pendingUserAttachments.length === 0) {
    return [];
  }
  const orphanMsgId = `orphan-${ctx.orphanCounter}`;
  ctx.orphanCounter += 1;

  const out: OutboundMessage[] = [];
  const userMessage: UserMessageReplay = {
    type: "user_message_replay",
    msg_id: orphanMsgId,
    text: ctx.pendingUserText ?? "",
    attachments: ctx.pendingUserAttachments,
    ipc_version: IPC_VERSION,
  };
  out.push(userMessage);

  const turnComplete: TurnComplete = {
    type: "turn_complete",
    msg_id: orphanMsgId,
    seq: ctx.globalSeq++,
    // Non-"success" result tells the reducer to commit the TurnEntry
    // with `result: "interrupted"` (see reducer.ts handleTurnComplete:
    // `result: isSuccess ? "success" : "interrupted"`).
    result: "interrupted",
    ipc_version: IPC_VERSION,
  };
  out.push(turnComplete);

  ctx.turnsCommitted += 1;
  ctx.pendingUserText = null;
  ctx.pendingUserAttachments = [];
  return out;
}

function handleUserEntry(
  entry: JsonlEntry,
  ctx: TranslateContext,
): OutboundMessage[] {
  const content = entry.message?.content ?? [];
  // A user entry can carry `text` blocks (a fresh user submission)
  // or `tool_result` blocks (a response to a prior tool_use). The two
  // cases never mix in surveyed JSONLs — but the translator treats
  // them independently so a future hybrid wouldn't break it.
  const textParts: string[] = [];
  const attachments: Attachment[] = [];
  const out: OutboundMessage[] = [];
  // First `tool_use_id` seen in a `tool_result` block — used to bind
  // the entry-level `toolUseResult` payload (when present) to its
  // initiating tool_use on the `tool_use_structured` IPC frame.
  // Mirrors `session.ts:657` (`firstToolUseId`) on the live path.
  let firstToolUseId = "";

  for (const block of content) {
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType === "text") {
      if (typeof block.text === "string") {
        textParts.push(block.text);
      }
      continue;
    }
    if (blockType === "tool_result") {
      // Emit the tool_result directly. The reducer pairs it with the
      // prior `tool_use` frame by `tool_use_id`; no translator-side
      // buffering or msg_id keying is needed for tool_result on the
      // wire (the shape carries no msg_id).
      const toolUseId =
        typeof block.tool_use_id === "string" ? block.tool_use_id : "";
      if (toolUseId.length === 0) {
        // Stray tool_result without its initiating tool_use is a
        // malformed JSONL signal; drop silently rather than emit a
        // dangling frame.
        continue;
      }
      if (firstToolUseId.length === 0) firstToolUseId = toolUseId;
      const isError = block.is_error === true;
      const output = coerceToolResultContent(block.content);
      const toolResult: ToolResult = {
        type: "tool_result",
        tool_use_id: toolUseId,
        output,
        is_error: isError,
        ipc_version: IPC_VERSION,
      };
      out.push(toolResult);
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

  // Entry-level `toolUseResult` (camelCase, JSONL persistence shape;
  // wire-side equivalent is the snake_case `tool_use_result` field
  // session.ts forwards as `structured_result`). Emit one
  // `tool_use_structured` frame paired with the first tool_result's
  // tool_use_id. Without this, replayed Read tool calls land in the
  // reducer with `structuredResult: null`, and the Read tool wrapper
  // has no clean `file.content` to render — the body comes up empty.
  // Mirrors `session.ts:670-680` (the live path).
  const toolUseResult = entry.toolUseResult;
  if (toolUseResult !== undefined && firstToolUseId.length > 0) {
    const structured: ToolUseStructured = {
      type: "tool_use_structured",
      tool_use_id: firstToolUseId,
      tool_name:
        typeof toolUseResult.toolName === "string"
          ? toolUseResult.toolName
          : "",
      structured_result: toolUseResult,
      ipc_version: IPC_VERSION,
    };
    out.push(structured);
  }

  // Combine text blocks within this single entry — multi-block within
  // one user entry is the same submission and concatenates.
  const entryText = textParts.join("");

  // Sentinel: claude's "[Request interrupted by user]" marker. Flush
  // any pending orphan as its own committed-interrupted turn, then
  // drop the marker (don't accumulate, don't emit). The marker has no
  // attachments by design.
  if (entryText === INTERRUPT_MARKER_TEXT && attachments.length === 0) {
    out.push(...flushPendingOrphan(ctx));
    return out;
  }

  // Real user submission. If there's already a pending submission
  // (no assistant cycle separated us from a prior user entry),
  // flush the prior as an orphan first — multiple consecutive user
  // entries are structural orphans, never a single concatenated
  // submission.
  if (entryText.length > 0 || attachments.length > 0) {
    if (
      ctx.pendingUserText !== null ||
      ctx.pendingUserAttachments.length > 0
    ) {
      out.push(...flushPendingOrphan(ctx));
    }
    if (entryText.length > 0) {
      ctx.pendingUserText = entryText;
    }
    if (attachments.length > 0) {
      ctx.pendingUserAttachments = attachments;
    }
  }

  return out;
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
  options?: TranslateJsonlEntryOptions,
): OutboundMessage[] {
  const content = entry.message?.content ?? [];
  const stopReason = entry.message?.stop_reason ?? null;
  const entryMsgId =
    typeof entry.message?.id === "string" ? entry.message.id : "";

  const out: OutboundMessage[] = [];

  // user_message_replay fires once per cycle, on the FIRST assistant
  // entry. Use claude's first `message.id` of the cycle as the key so
  // the wire's user side and assistant side agree on an id (per the
  // "one id, claude's id" rule). Subsequent assistant entries in the
  // same cycle skip this — multi-message claude turns produce one
  // user_message_replay, multiple assistant streams.
  if (!ctx.cycleOpen) {
    const userText = ctx.pendingUserText ?? "";
    const userAttachments = ctx.pendingUserAttachments;
    const userMessage: UserMessageReplay = {
      type: "user_message_replay",
      msg_id: entryMsgId,
      text: userText,
      attachments: userAttachments,
      ipc_version: IPC_VERSION,
    };
    out.push(userMessage);
    ctx.pendingUserText = null;
    ctx.pendingUserAttachments = [];
    ctx.cycleOpen = true;
  }

  // Track the open cycle's most-recent assistant id so an EOF-time
  // dangling-terminal synthetic can key on it. Only real ids are
  // recorded — an entry with no `message.id` leaves the prior value.
  if (entryMsgId.length > 0) {
    ctx.cycleMsgId = entryMsgId;
  }

  // Accumulate this entry's content into per-message locals. Each
  // assistant entry is its own keyed unit on the wire; nothing carries
  // across entries.
  let assistantText = "";
  let thinkingText = "";
  const toolUses: Array<{
    toolUseId: string;
    toolName: string;
    input: unknown;
  }> = [];

  for (const block of content) {
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType === "text") {
      if (typeof block.text === "string") {
        assistantText += block.text;
      }
      continue;
    }
    if (blockType === "thinking") {
      if (typeof block.thinking === "string") {
        thinkingText += block.thinking;
      } else if (typeof block.text === "string") {
        // Tolerate a handful of older JSONL shapes that put the
        // thinking text in the `text` field on a `thinking` block.
        thinkingText += block.text;
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
        toolUses.push({ toolUseId, toolName, input });
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

  // Emit this entry's content frames keyed on this entry's
  // `message.id` (claude's id; no canonicalization).
  for (const tu of toolUses) {
    const toolUse: ToolUse = {
      type: "tool_use",
      msg_id: entryMsgId,
      seq: ctx.globalSeq++,
      tool_name: tu.toolName,
      tool_use_id: tu.toolUseId,
      input:
        typeof tu.input === "object" && tu.input !== null
          ? (tu.input as object)
          : {},
      ipc_version: IPC_VERSION,
    };
    out.push(toolUse);
  }

  if (thinkingText.length > 0) {
    const thinking: ThinkingText = {
      type: "thinking_text",
      msg_id: entryMsgId,
      seq: ctx.globalSeq++,
      text: thinkingText,
      is_partial: false,
      status: "complete",
      ipc_version: IPC_VERSION,
    };
    out.push(thinking);
  }

  if (assistantText.length > 0) {
    const assistant: AssistantText = {
      type: "assistant_text",
      msg_id: entryMsgId,
      seq: ctx.globalSeq++,
      rev: 0,
      text: assistantText,
      is_partial: false,
      status: "complete",
      ipc_version: IPC_VERSION,
    };
    out.push(assistant);
  }

  // Cycle terminal: only on `stop_reason === "end_turn"`, AND only
  // when the session-level loop hasn't asked us to defer. Suppression
  // applies when peek-ahead identified a same-msg_id continuation
  // entry — claude's SDK split a single assistant message across two
  // JSONL records (each with `end_turn`), and we want exactly one
  // `turn_complete` to land at the end of the run rather than two
  // (the second of which the reducer would dedupe, stranding pending
  // state). Bumps `turnsCommitted` so `replay_complete.count`
  // reflects committed cycles; closes the cycle so the next user
  // submission starts fresh.
  if (stopReason === "end_turn" && options?.suppressTurnComplete !== true) {
    const turnComplete: TurnComplete = {
      type: "turn_complete",
      msg_id: entryMsgId,
      seq: ctx.globalSeq++,
      result: "success",
      ipc_version: IPC_VERSION,
    };
    out.push(turnComplete);
    ctx.turnsCommitted += 1;
    ctx.cycleOpen = false;
    ctx.cycleMsgId = null;
  }

  return out;
}

// Per-message flushing makes a separate "in-flight trailing turn"
// flush at end-of-JSONL unnecessary: each `assistant` entry emits its
// content frames immediately when its line is processed, regardless of
// `stop_reason`. The trailing entry of an unfinished cycle has already
// emitted; only the cycle-terminal `turn_complete` is absent (because
// `stop_reason` was not `end_turn`). The live drain continuing
// post-replay produces the eventual `turn_complete` naturally when
// claude's `result` lands. The translateJsonlSession loop body no
// longer needs an EOF-time flush.

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
  /**
   * When `true`, a cycle still open at end-of-JSONL (an assistant
   * entry that never reached `end_turn`) gets a synthetic terminal
   * `turn_complete { result: "interrupted" }` before `replay_complete`
   * — so a resumed session whose final turn was abandoned mid-flight
   * commits that turn instead of stranding an in-flight row ([replay-1]).
   *
   * `runReplay` sets this from the absence of a live `ActiveTurn`:
   * `true` on a cold resume (no live turn will continue the JSONL),
   * `false` on reload-mid-stream (a live `ActiveTurn` is still
   * producing the turn and the live drain delivers the real
   * `turn_complete`). Default `false` — the safe choice for any
   * caller that hasn't reasoned about live continuation.
   */
  synthesizeDanglingTerminal?: boolean;
}

/**
 * Result returned by `translateJsonlSession`'s AsyncGenerator (the
 * value reachable via `.next()` when `done: true`, also typed as the
 * generator's `TReturn` parameter).
 *
 * `count` mirrors the per-wire `replay_complete.count` and counts
 * cycles committed via `turn_complete{result: "success"}` (one per
 * `assistant` JSONL entry whose `stop_reason === "end_turn"`) plus
 * orphan-interrupted cycles flushed via `flushPendingOrphan` (one per
 * orphaned user submission with no following assistant cycle). A
 * trailing in-flight cycle (assistant entry without `end_turn`)
 * counts only when {@link TranslateSessionOptions.synthesizeDanglingTerminal}
 * is set — the EOF-time synthetic `turn_complete` then commits it.
 * Without that option the cycle is left open (its content frames are
 * still emitted per-entry) and the live drain produces the eventual
 * `turn_complete` when claude's `result` lands.
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
  const synthesizeDanglingTerminal = opts.synthesizeDanglingTerminal === true;

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
  //
  // Pre-parse every line up-front so the iteration loop can peek
  // ahead one significant entry. The peek is needed to detect the
  // same-msg_id continuation case described in
  // {@link TranslateJsonlEntryOptions.suppressTurnComplete}: when two
  // consecutive `assistant` entries share a `message.id`, the leading
  // entry's `turn_complete` must be deferred so the cycle stays open
  // and the trailing entry's content lands in the same scratch.
  // Telemetry for malformed lines fires at parse time, identical to
  // the prior streaming behavior.
  const lines = input.jsonl.split("\n");
  const parsedEntries: Array<JsonlEntry | null> = lines.map((rawLine) => {
    const line = rawLine.trim();
    if (line.length === 0) {
      return null;
    }
    try {
      return JSON.parse(line) as JsonlEntry;
    } catch (err) {
      sawAnyMalformed = true;
      telemetry.malformedLine({
        reason: err instanceof Error ? err.message : String(err),
        preview: line.slice(0, 80),
      });
      return null;
    }
  });

  // Walk forward from `start` (inclusive) returning the index of the
  // next entry that the per-entry translator would process — i.e.
  // skipping nulls (empty / malformed) and `SKIPPED_TOP_LEVEL_TYPES`
  // entries (claude bookkeeping the translator silently drops).
  // Returns `-1` when no such entry exists.
  const nextSignificantIndex = (start: number): number => {
    for (let j = start; j < parsedEntries.length; j++) {
      const e = parsedEntries[j];
      if (e === null) continue;
      const t = typeof e.type === "string" ? e.type : "";
      if (SKIPPED_TOP_LEVEL_TYPES.has(t)) continue;
      return j;
    }
    return -1;
  };

  for (let i = 0; i < parsedEntries.length; i++) {
    const parsed = parsedEntries[i];
    if (parsed === null) {
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

    // Peek ahead for the same-msg_id continuation case. Only fires
    // for assistant entries with a string `message.id`; the next
    // significant entry must also be an assistant entry sharing that
    // id. A `user` entry, an unknown-shape entry, or EOF in between
    // ends the run and the current entry behaves normally.
    let suppressTurnComplete = false;
    if (
      parsed.type === "assistant" &&
      typeof parsed.message?.id === "string" &&
      parsed.message.id.length > 0
    ) {
      const currentMsgId = parsed.message.id;
      const nextIdx = nextSignificantIndex(i + 1);
      if (nextIdx !== -1) {
        const next = parsedEntries[nextIdx]!;
        if (
          next.type === "assistant" &&
          typeof next.message?.id === "string" &&
          next.message.id === currentMsgId
        ) {
          suppressTurnComplete = true;
        }
      }
    }

    const messages = translateJsonlEntry(parsed, ctx, { suppressTurnComplete });
    for (const msg of messages) {
      yield msg;
      emittedSinceYield += 1;
      if (yieldBetweenBatches && emittedSinceYield >= batchSize) {
        emittedSinceYield = 0;
        await yieldToEventLoop();
      }
    }
  }

  // The trailing in-flight assistant entry (if any) has already
  // emitted its content frames per-entry above; the absence of an
  // `end_turn` stop_reason means no `turn_complete` fired, so the
  // reducer's `pendingUserMessage` + per-msg-id scratch stay open.
  //
  // Two outcomes for that open cycle, decided by the caller via
  // `synthesizeDanglingTerminal`:
  //   - `false` (default — the reload-mid-stream path, where a live
  //     `ActiveTurn` is still producing the turn): leave the cycle
  //     open. `runReplay`'s `emitInflightTurnFromActiveTurn` plus the
  //     post-bracket live drain deliver the eventual `turn_complete`.
  //   - `true` (a cold resume — no live turn continues this JSONL):
  //     no `turn_complete` will ever arrive, so emit a synthetic one
  //     keyed on the open cycle's assistant id. `result: "interrupted"`
  //     commits the dangling turn as a terminal `interrupted`
  //     TurnEntry instead of stranding an in-flight row that animates
  //     its thinking indicator forever ([replay-1]).
  if (ctx.cycleOpen && synthesizeDanglingTerminal) {
    const danglingTerminal: TurnComplete = {
      type: "turn_complete",
      msg_id: ctx.cycleMsgId ?? "",
      seq: ctx.globalSeq++,
      result: "interrupted",
      ipc_version: IPC_VERSION,
    };
    yield danglingTerminal;
    ctx.turnsCommitted += 1;
    ctx.cycleOpen = false;
    ctx.cycleMsgId = null;
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
