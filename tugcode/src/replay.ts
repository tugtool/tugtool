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
//   add_user_message                 Synthetic; carries the turn's
//                                    user text + attachments. Reducer's
//                                    `handleAddUserMessage` mints a
//                                    `pendingTurn` whose
//                                    `initialMessages` is
//                                    `[user_message]`. No `msg_id` on
//                                    the wire — the substrate's
//                                    correlation key is `turnKey`
//                                    ([D14]).
//   tool_use     [, tool_use_n]      In insertion order.
//   tool_result  [, tool_result_n]   Interleaved by tool_use_id.
//   thinking_text (optional)         `is_partial: false`.
//   assistant_text                   `is_partial: false` (terminal
//                                    text only — replay doesn't
//                                    stream per-token deltas).
//   turn_complete                    `result: "success"`. Emitted when
//                                    an assistant entry's `stop_reason`
//                                    is a clean terminal — `end_turn`,
//                                    `stop_sequence`, `max_tokens`, or
//                                    `refusal`. The trailing in-flight
//                                    assistant entry of an unfinished
//                                    cycle (`tool_use` / `pause_turn` /
//                                    no stop_reason) emits its content
//                                    frames per-entry but no terminal —
//                                    the live drain continuing
//                                    post-replay produces the eventual
//                                    `turn_complete` when claude's
//                                    `result` lands.

import type {
  AddUserMessage,
  AssistantText,
  ContentBlock,
  ContentBlockStart,
  OutboundMessage,
  ReplayComplete,
  ReplayStarted,
  SystemMetadata,
  ThinkingText,
  ToolResult,
  ToolUse,
  ToolUseStructured,
  TurnComplete,
  WakeStarted,
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
 * One content block inside a JSONL `message.content` array. Fields are
 * optional and loosely typed — Claude's per-session JSONL is an
 * internal persistence format whose shape evolves across releases.
 *
 * Content-block `type` values seen across surveyed JSONLs:
 *   - `text`        — assistant or user text
 *   - `tool_use`    — assistant tool invocation
 *   - `tool_result` — user-side tool response, keyed by tool_use_id
 *   - `thinking`    — extended-thinking content
 *   - `image`       — base64-encoded image attachment in user submission
 */
export interface JsonlContentBlock {
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
}

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
 */
export interface JsonlEntry {
  type?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    stop_reason?: string | null;
    /**
     * Message content. Usually an array of {@link JsonlContentBlock}s,
     * but Claude Code persists a plain-text message — a `user`
     * submission with no attachments, or (defensively) an `assistant`
     * message — as a bare STRING. {@link contentBlocks} normalises
     * both shapes before the per-entry content walk.
     */
    content?: string | ReadonlyArray<JsonlContentBlock>;
  };
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  /**
   * Set by Claude Code on the `user` JSONL entry carrying a `/compact`
   * continuation summary ("This session is being continued from a
   * previous conversation…"). The translator skips these — the summary
   * is CLI-internal continuation context, not a transcript-visible
   * user submission (Claude Code's own UI hides it behind a "Compacted"
   * marker too). See {@link isNonSubmissionUserString}.
   */
  isCompactSummary?: boolean;
  /**
   * Set by Claude Code on `user` JSONL entries it injects as SDK-side
   * bookkeeping rather than transcript submissions. Surveyed shapes
   * across the live JSONL corpus:
   *   - image-attachment coordinate hints
   *     (`[Image: original WxH, displayed at WxH. Multiply coordinates …]`)
   *     and source-path notes (`[Image: source: /…]`) the SDK appends
   *     after every image submission so the AI can map clicks back
   *     to the original;
   *   - skill body / `/loop` content the SDK loads when a slash command
   *     is invoked ("Base directory for this skill: …");
   *   - any other SDK-injected pseudo-user entry the runtime persists
   *     for context continuity.
   *
   * None of these are transcript-visible submissions — Claude Code's own
   * UI never shows them. Each surfaces as an extra `add_user_message`
   * opener if the translator processes it, which closes the prior real
   * turn as `interrupted` (bogus phantom row) AND injects a meta-text
   * pseudo-prompt cell. The translator skips them unconditionally
   * regardless of content shape.
   */
  isMeta?: boolean;
  /**
   * The active permission mode at submit time (`"acceptEdits"`,
   * `"default"`, etc.). Claude Code stamps this on every *real* user
   * submission as it leaves the CLI's input layer. Crucially, it is
   * NOT stamped on the SDK's auto-injected `"[Request interrupted by
   * user …]"` marker (the marker comes out of the SDK's own internal
   * flow, not the user-input path), so the field's absence is a
   * structural disambiguator between real follow-on user submissions
   * and the SDK marker. See {@link isInterruptMarkerEntry}.
   */
  permissionMode?: string;
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
 * Per-session context for the JSONL → frame translator. Carries the
 * minimum state required for [D13]'s per-entry direct emission
 * discipline: a global sequence counter, a turn-commit count, the
 * load-bearing msg_id of any currently open turn, and a synthesized-id
 * counter. No cross-entry buffering of user submissions, no paired
 * "cycle" gate — each entry maps to its own IPC events.
 *
 * **The open-turn tracker.** `openTurnMsgId` is the canonical record
 * of "which turn is currently open on the wire." It carries:
 *
 *   - a synthesized opener id (`u-<n>` for user-text openers,
 *     `w-<n>` for wake openers) when no content event has emitted
 *     yet — the turn exists only as `pendingTurn` in the reducer;
 *   - claude's real `msg_id` once the first content event of the
 *     turn emits — {@link noteContentMsgId} swaps the synthesized
 *     opener id for the real id, so the orphan-synthesis path and the
 *     reducer's `activeMsgId` (which ALSO sets to the real id on
 *     first content per [D14]) stay in lockstep.
 *
 * Cleared on every terminal `turn_complete` emit; checked at every
 * new-opener boundary AND at EOF — non-null then triggers a
 * `turn_complete{result: "interrupted"}` carrying `openTurnMsgId`.
 *
 * **Wake-replay regression guarantee.** Wake openers and user openers
 * share the same tracker; the orphan-synthesis path doesn't care which
 * kind of opener it's closing. The class of bug that produced the
 * wake-replay regression (a new opener kind requiring a third mode
 * added to cycle pairing) cannot recur — adding a new opener kind is
 * a one-line addition (mint a new prefix), not a structural change.
 *
 * See `roadmap/tugplan-tide-session-wake.md` [D13] (replay direct
 * emission), [D14] (activeMsgId tracking), and `#spec-translate-context`
 * for the normative state-rules table.
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
   * Tracks the load-bearing `msg_id` of the currently open turn.
   * See the interface docstring above for the full lifecycle; see
   * {@link noteContentMsgId} for the content-emit update rule and
   * {@link emitOrphanIfOpen} for the orphan-synthesis path.
   */
  openTurnMsgId: string | null;
  /**
   * Counter for synthesized opener ids. Bumped every time a new
   * synthesized id is minted (`u-<n>` for user-text openers,
   * `w-<n>` for wake openers — see {@link mintOpenerId}). Monotonic
   * within a translator session. Reaches the wire only via the
   * orphan-synthesis `turn_complete` frame and ONLY in the no-content
   * interrupt case ([D13]'s wire-appearance rule).
   */
  orphanCounter: number;
  /**
   * Per-`msg_id` running count of content blocks emitted so far.
   *
   * Claude Code occasionally persists ONE assistant message across
   * multiple JSONL entries that share a `message.id` (e.g. a thinking
   * block in one entry and a text block in a follow-on entry — see
   * session ecc343d8). Each entry's `content[]` array starts at index
   * 0 in the JSONL, but the LIVE wire delivers those same blocks with
   * consecutive `index` values (0, 1, …) across the message. The
   * reducer's `${msg_id}:${block_index}` minting is idempotent, so if
   * the translator naively re-uses the per-entry local index 0 for
   * the continuation entry's first block, that mint collides with the
   * prior thinking mint and the second-block frame (text) lands on
   * the wrong-kind Message — losing its content on render.
   *
   * This map preserves the wire's per-msg_id block-index discipline:
   * the per-entry translator reads the current count for `msg_id`,
   * emits `content_block_start` with `block_index = count + i`, then
   * stores `count + entry.content.length` back. Cleared on every
   * terminal `turn_complete` emit (paired with `openTurnMsgId`'s
   * clear) since per-msg_id state is meaningless across turns.
   */
  blockCountByMsgId: Map<string, number>;
  /** Telemetry sink. */
  telemetry: ReplayTelemetry;
}

/**
 * Subset of {@link WakeStarted.wake_trigger} the replay translator
 * extracts from the JSONL envelope. `tool_use_id` / `output_file` /
 * `status` aren't persisted on the user-entry envelope, so they
 * default to the live "Cohort A" Monitor shape ([Q01]) — empty
 * strings + `"completed"` (the cohort the envelope represents on
 * Claude's JSONL).
 */
export interface ReplayWakeTrigger {
  taskId: string;
  summary: string;
}

export function makeTranslateContext(
  telemetry: ReplayTelemetry = DEFAULT_TELEMETRY,
): TranslateContext {
  return {
    globalSeq: 0,
    turnsCommitted: 0,
    openTurnMsgId: null,
    orphanCounter: 0,
    blockCountByMsgId: new Map(),
    telemetry,
  };
}

// ---------------------------------------------------------------------------
// Open-turn tracker primitives ([D13])
// ---------------------------------------------------------------------------

/**
 * Note that a content frame for the given `msg_id` is being emitted.
 * Idempotent (no-op if `openTurnMsgId === msgId`); otherwise swaps
 * `openTurnMsgId` to `msgId` — which flips a synthesized opener id
 * (`u-<n>` / `w-<n>`) to claude's real `msg_id` on the FIRST content
 * event of a turn, per [D13]'s wire-truth update rule.
 *
 * Empty-id calls are a no-op: only real ids are load-bearing on the
 * orphan-synthesis path; a content-block-start event with no `msg_id`
 * doesn't tell us anything new about which turn is open.
 *
 * Called from every emit site in {@link handleAssistantEntry} that
 * carries an `msg_id` (content_block_start, assistant_text,
 * thinking_text, tool_use). With this rule, the orphan-synthesis
 * `turn_complete` always carries an id the reducer can match — claude's
 * real `msg_id` when content has arrived (reducer's normal-commit
 * path), the synthesized opener id when it hasn't (reducer's
 * no-content fallback per `#spec-reducer-state` rule 2).
 */
function noteContentMsgId(ctx: TranslateContext, msgId: string): void {
  if (msgId.length === 0) return;
  if (ctx.openTurnMsgId === msgId) return;
  ctx.openTurnMsgId = msgId;
}

/**
 * Mint a synthesized opener id and bump the counter. Returns
 * `${prefix}-${n}` where `prefix` is `u` (user-text opener) or `w`
 * (wake opener). The minted id is translator-internal in the
 * steady-state path — opener frames (`add_user_message`,
 * `wake_started`) carry no `msg_id` on the wire ([D15]). The id
 * reaches the wire only on the orphan-synthesis `turn_complete` AND
 * only when no content event arrived to swap it via
 * {@link noteContentMsgId}.
 */
function mintOpenerId(ctx: TranslateContext, prefix: "u" | "w"): string {
  const id = `${prefix}-${ctx.orphanCounter}`;
  ctx.orphanCounter += 1;
  return id;
}

/**
 * Emit `turn_complete{msg_id: openTurnMsgId, result: "interrupted"}`
 * when a turn is open at an orphan-synthesis trigger point — a new
 * opener arriving (closing the prior turn) or EOF on a cold resume.
 * Clears `openTurnMsgId` and bumps `turnsCommitted` (the orphan IS
 * committed to the transcript).
 *
 * The committed turn's substrate shape depends on whether content
 * arrived. With content (`openTurnMsgId` holds claude's real
 * `msg_id`, having been swapped via {@link noteContentMsgId}), the
 * reducer's `handleTurnComplete` matches on `activeMsgId` and commits
 * scratch normally — the partial content lands in the TurnEntry.
 * Without content (`openTurnMsgId` is still the synthesized opener
 * id; `activeMsgId === null`), the reducer's no-content fallback
 * (`#spec-reducer-state` rule 2) commits `pendingTurn` as an
 * interrupted-before-response turn — `[user_message]` for `u-<n>`
 * openers, `[]` for `w-<n>` openers.
 *
 * Idempotent on no open turn — returns `[]` if `openTurnMsgId` is
 * null, so callers can invoke unconditionally before any new opener.
 */
function emitOrphanIfOpen(ctx: TranslateContext): OutboundMessage[] {
  if (ctx.openTurnMsgId === null) return [];
  const msgId = ctx.openTurnMsgId;
  const turnComplete: TurnComplete = {
    type: "turn_complete",
    msg_id: msgId,
    seq: ctx.globalSeq++,
    result: "interrupted",
    ipc_version: IPC_VERSION,
  };
  ctx.openTurnMsgId = null;
  ctx.turnsCommitted += 1;
  return [turnComplete];
}

// ---------------------------------------------------------------------------
// `<task-notification>` envelope recognizer
// ---------------------------------------------------------------------------

/**
 * Match Claude Code's `<task-notification>` envelope — the synthetic
 * `user` JSONL entry the runtime injects when a between-turn Monitor /
 * Bash-runbg / Task-runbg notification (Cohort A wake source per
 * `roadmap/tugplan-tide-session-wake.md` [Q01]) closes a wait. The
 * envelope shape, from a captured Monitor wake:
 *
 *     <task-notification>
 *     <task-id>b08a41726</task-id>
 *     <summary>Monitor event: "tail system.log for 'kernel'"</summary>
 *     <event>[Monitor timed out — re-arm if needed.]</event>
 *     </task-notification>
 *
 * Live tugcode never sees this envelope on the wire — the SDK lifts
 * the same event as `system/task_notification` and tugcode brackets
 * the wake via `buildWakeStartedMessage`. The JSONL persists the
 * envelope text instead, so the replay translator recognizes it and
 * synthesizes the equivalent IPC `wake_started` frame.
 *
 * Match is anchored at start (after leading whitespace) — defensive
 * against a runaway prose user entry that just happens to contain
 * the literal `<task-notification>` somewhere in its body. Returns
 * `null` for any non-envelope content.
 */
const TASK_NOTIFICATION_OPEN_RE = /^\s*<task-notification>/;
const TASK_ID_RE = /<task-id>([^<]*)<\/task-id>/;
const TASK_SUMMARY_RE = /<summary>([^<]*)<\/summary>/;

export function extractTaskNotificationWake(
  text: string,
): ReplayWakeTrigger | null {
  if (!TASK_NOTIFICATION_OPEN_RE.test(text)) return null;
  const taskIdMatch = TASK_ID_RE.exec(text);
  const summaryMatch = TASK_SUMMARY_RE.exec(text);
  return {
    taskId: taskIdMatch?.[1] ?? "",
    summary: summaryMatch?.[1] ?? "",
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
 * `assistant` `stop_reason` values that close a cycle cleanly — the
 * turn finished and the terminal `turn_complete { result: "success" }`
 * fires. These are the API's non-continuation stop reasons:
 *
 *   - `end_turn`       claude finished its response normally
 *   - `stop_sequence`  a configured stop sequence was hit
 *   - `max_tokens`     the response hit the output-token ceiling
 *   - `refusal`        claude declined to continue
 *
 * `tool_use` and `pause_turn` are NOT here — the cycle legitimately
 * continues (a tool result or a resumed turn follows). A `null` /
 * absent `stop_reason` is likewise non-terminal (the JSONL was
 * truncated mid-stream). The Step 20.5.B.1 corpus audit found only
 * `end_turn` and `stop_sequence` in practice; `max_tokens` / `refusal`
 * are included because they are valid API terminals a future session
 * could carry. Recognising all four keeps a last turn that ended on a
 * non-`end_turn` terminal from being mislabelled `interrupted` by the
 * `synthesizeDanglingTerminal` synthetic ([replay-1]).
 */
const TERMINAL_STOP_REASONS: ReadonlySet<string> = new Set([
  "end_turn",
  "stop_sequence",
  "max_tokens",
  "refusal",
]);

/**
 * Normalise a JSONL `message.content` field into a block array.
 *
 * Claude Code persists a plain-text message as a bare STRING
 * `message.content`, not the usual `[{ type: "text", … }]` array — a
 * `user` submission with no attachments is the common case (~280 such
 * entries across the surveyed corpus). Iterating that string with the
 * per-entry `for…of` content walk yields its *characters*, each a
 * non-block that falls through, so the text is silently dropped. (The
 * assistant side is block-array in every surveyed JSONL; the string
 * branch covers it defensively.) Wrapping a string as one synthetic
 * `text` block lets both content walks treat it uniformly. A non-string
 * `content` (the array shape, or absent) passes through unchanged.
 */
function contentBlocks(
  rawContent: string | ReadonlyArray<JsonlContentBlock> | undefined,
): ReadonlyArray<JsonlContentBlock> {
  if (typeof rawContent === "string") {
    return [{ type: "text", text: rawContent }];
  }
  return rawContent ?? [];
}

/**
 * Tag prefixes Claude Code wraps slash-command scaffolding in when it
 * persists the interaction as `user` JSONL entries: the `<command-name>`
 * / `<command-message>` / `<command-args>` markers of a slash
 * invocation and the `<local-command-stdout>` / `<local-command-caveat>`
 * output blocks. These are CLI-internal bookkeeping — the expanded
 * skill body that follows a slash command is a separate ordinary
 * `user` entry that replays on its own.
 */
const COMMAND_SCAFFOLDING_PREFIXES: readonly string[] = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-caveat>",
];

/**
 * True when a `user` entry's bare-string `message.content` is NOT a
 * genuine transcript submission, so the translator skips it rather
 * than surfacing it as a turn:
 *
 *   - the `isCompactSummary` continuation block (the "This session is
 *     being continued…" summary a `/compact` injects) — CLI-internal
 *     continuation context, hidden in Claude Code's own UI;
 *   - slash-command scaffolding ({@link COMMAND_SCAFFOLDING_PREFIXES}).
 *
 * Surfacing these would inject junk orphan turns into a resumed
 * transcript (a `/compact` alone persists four-plus consecutive
 * scaffolding strings). A genuine plain-text submission returns
 * `false` and is normalised to a text block by {@link contentBlocks}.
 */
function isNonSubmissionUserString(entry: JsonlEntry, text: string): boolean {
  if (entry.isCompactSummary === true) {
    return true;
  }
  const trimmed = text.trimStart();
  if (
    COMMAND_SCAFFOLDING_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  ) {
    return true;
  }
  // The `<task-notification>` envelope is also non-submission — the
  // runtime injected it to wake claude with the prior tool's result.
  // The replay translator recognizes it separately so it can
  // synthesize a `wake_started` IPC frame ([D07] wake
  // discriminator); both the envelope text AND the add_user_message
  // are suppressed in that path.
  return extractTaskNotificationWake(text) !== null;
}

/**
 * Per-call options for {@link translateJsonlEntry}.
 *
 * Threaded by the session-level loop when peek-ahead detects shape
 * variants the per-entry translator can't see on its own.
 */
export interface TranslateJsonlEntryOptions {
  /**
   * When true, the per-entry translator skips emitting `turn_complete`
   * for an `assistant` entry whose `stop_reason` is a clean terminal
   * ({@link TERMINAL_STOP_REASONS}), leaving the open-turn tracker
   * (`ctx.openTurnMsgId`) unchanged so a following same-msg_id entry's
   * content frames land in the same logical turn.
   *
   * The session-level loop sets this when the immediately-following
   * non-skipped JSONL entry is another `assistant` entry sharing the
   * current entry's `message.id`. Claude Code's SDK occasionally
   * persists a single assistant message across multiple JSONL records
   * (one snapshot when the thinking block was complete, another when
   * the text block was complete), with both records carrying
   * `stop_reason: "end_turn"`. Without suppression the leading entry
   * would emit a terminal `turn_complete` and clear `openTurnMsgId`,
   * causing the trailing entry's content emits to find no open turn
   * (the reducer's `activeMsgId` would then be set by the trailing
   * entry's first content event, and the trailing entry's terminal
   * would dedupe-drop) — fragile, observable as a stale `pendingTurn`
   * after `replay_complete`. Suppression keeps exactly one
   * `turn_complete` at the end of the run.
   */
  suppressTurnComplete?: boolean;
}

/**
 * Translate one JSONL entry into 0..N outbound messages. Pure with
 * respect to external state; the only mutation is on the passed `ctx`.
 *
 * Invariants (per [D13]'s per-entry direct emission discipline):
 *   - A `user` entry with `text` content emits exactly one
 *     `add_user_message{text, attachments}` (text blocks within the
 *     entry concatenate; one entry → one frame). `message.content`
 *     may be a bare string (a plain-text submission persisted without
 *     the block-array wrapper) — {@link contentBlocks} normalises it;
 *     a bare-string entry that is Claude Code scaffolding (slash-
 *     command markers, the `/compact` summary) is skipped outright,
 *     and a `<task-notification>` envelope emits `wake_started`
 *     instead (see {@link extractTaskNotificationWake}).
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
 *   - An `assistant` entry whose `stop_reason` is a clean terminal
 *     ({@link TERMINAL_STOP_REASONS}) additionally emits a terminal
 *     `turn_complete` and increments `ctx.turnsCommitted` (which feeds
 *     `replay_complete.count`), UNLESS `options.suppressTurnComplete`
 *     is true (set by the session-level loop when peek-ahead detects a
 *     same-msg_id continuation entry; see {@link TranslateJsonlEntryOptions}).
 *     A terminal `turn_complete` clears `ctx.openTurnMsgId`.
 *   - The opener (`add_user_message` or `wake_started`) is emitted
 *     by the user entry that mints it — not by the assistant entry
 *     that follows. Under [D13]'s per-entry direct emission discipline,
 *     each entry maps to its own IPC events with no cross-entry
 *     buffering. Multiple consecutive user-text entries each get
 *     their own committed turn (orphan-synthesis closes the prior
 *     before the next opener fires).
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
 * SDK auto-injected "interrupt-marker" sentinel.
 *
 * When a turn is interrupted (Stop button, Cmd-Q resume, or — the
 * symptom this guard addresses — the user denying a pending
 * `control_request_forward`), the SDK writes a synthetic `user` JSONL
 * entry whose `content[0].text` carries one of these phrases:
 *
 *   - `"[Request interrupted by user]"` — plain interrupt.
 *   - `"[Request interrupted by user for tool use]"` — interrupt fired
 *     while a permission/question was pending; the SDK appends
 *     `" for tool use"` so the AI can distinguish the two cases.
 *
 * Surveyed in `roadmap/archive/tugtalk-protocol.txt` §2b ("control_request
 * interrupt sends on stdin, CLI acknowledges, injects
 * `[Request interrupted by user]`, emits a proper `result` event") and
 * verified across the SDK v2.1.x JSONL corpus (31 markers, both forms
 * present; 2026-05-06 + 2026-05-23 incident reports).
 *
 * The marker text *is* the SDK's wire contract here — there is no
 * separate `{ "interrupt_marker": true }` field. We disambiguate against
 * a hypothetical real user submission that happens to type the same
 * string by pairing the text prefix with a structural signal: every
 * real user submission carries a `permissionMode` field (stamped by
 * Claude Code's input layer); the SDK-injected marker does not. Both
 * signals must agree for the entry to be treated as a sentinel — a
 * defense-in-depth check that fails closed (the worst-case is a
 * phantom turn re-appearing, not silent data loss).
 */
const INTERRUPT_MARKER_PREFIX = "[Request interrupted by user";

/**
 * Test whether a `user` JSONL entry is the SDK's interrupt-marker
 * sentinel. Both signals must agree:
 *
 *   1. **Text prefix** — the entry's single text block starts with
 *      `"[Request interrupted by user"` and ends with `"]"`, in one of
 *      the documented forms (exact, or with a space-prefixed
 *      `<suffix>` before the closing bracket).
 *   2. **Structural** — the entry has no `permissionMode` field,
 *      because the SDK does not stamp `permissionMode` on its own
 *      auto-injected markers (only the user-input path does).
 *
 * Both-signals-must-agree means a hypothetical user typing the exact
 * marker text as a chat message still rounds-trip correctly (the
 * `permissionMode` field on their submission flunks the structural
 * check, so the text matches but the entry is NOT swallowed). If the
 * SDK ever drops `permissionMode` from real submissions, this matcher
 * fails *closed* in the safe direction — we miss the marker and the
 * phantom-turn symptom returns, but no real user message gets lost.
 */
function isInterruptMarkerEntry(entry: JsonlEntry, text: string): boolean {
  if (!text.startsWith(INTERRUPT_MARKER_PREFIX)) return false;
  if (!text.endsWith("]")) return false;
  // Exact match for the base form is OK; the suffix form requires a
  // space between the prefix and the content before `"]"`. This
  // distinguishes the marker from a defensive coincidental match like
  // `"[Request interrupted by userX]"`.
  if (text !== `${INTERRUPT_MARKER_PREFIX}]`) {
    const after = text.slice(INTERRUPT_MARKER_PREFIX.length, -1);
    if (!after.startsWith(" ") || after.length <= 1) return false;
  }
  // Structural disambiguator: real user submissions carry
  // `permissionMode`; the SDK-injected marker does not. See the
  // module comment on `INTERRUPT_MARKER_PREFIX` for the wire-corpus
  // evidence.
  return entry.permissionMode === undefined;
}

/**
 * Per-entry translator for `user` JSONL entries. Direct emit, no
 * cross-entry buffering — each entry maps to its own IPC events per
 * [D13]:
 *
 *   - **`<task-notification>` envelope** (bare-string `message.content`
 *     matching {@link extractTaskNotificationWake}): close any open
 *     turn (orphan synthesis), emit `wake_started{wake_trigger}`, set
 *     `openTurnMsgId` to a synthesized `w-<n>`. Live tugcode never
 *     sees this envelope on the wire — the SDK lifts the same event as
 *     `system/task_notification`. The JSONL persists the envelope text
 *     so replay synthesizes the equivalent `wake_started` frame.
 *   - **Scaffolding** (slash-command markers, `/compact` summary):
 *     skip outright. CLI-internal bookkeeping, not transcript
 *     submissions.
 *   - **Text content** (`text` blocks, concatenated within the entry
 *     per [D13]; optional `image` attachments): close any open turn,
 *     emit `add_user_message{text, attachments}`, set `openTurnMsgId`
 *     to a synthesized `u-<n>`. The synthesized id is translator-
 *     internal — `add_user_message` carries no `msg_id` per [D15].
 *   - **`tool_result` blocks**: emit `tool_result` per block (and one
 *     `tool_use_structured` for the entry's first `tool_use_id` when
 *     the entry-level `toolUseResult` is present). These are mid-turn
 *     events inside the currently open turn (claude's tool-use loop);
 *     they do NOT touch `openTurnMsgId`.
 *   - **Interrupt-marker sentinel** ({@link isInterruptMarkerEntry}):
 *     drop. The orphan-synthesis path at the next opener (or EOF)
 *     closes any open turn naturally — the marker itself is a
 *     non-event under [D13]'s model.
 *
 * The opener path closes any prior open turn BEFORE emitting the new
 * opener. Multiple consecutive openers without an assistant terminal
 * in between (the interrupted-mid-submission case) each fire orphan
 * synthesis for the prior, leaving every turn cleanly bracketed on
 * the wire.
 */
function handleUserEntry(
  entry: JsonlEntry,
  ctx: TranslateContext,
): OutboundMessage[] {
  const out: OutboundMessage[] = [];
  const rawContent = entry.message?.content;

  // SDK-injected bookkeeping entry. Image coordinate / source-path
  // hints, skill body loaders, `/loop` content imports — none are
  // user submissions. Surfacing any of them as an `add_user_message`
  // would (a) inject a pseudo-prompt row into the transcript and (b)
  // close the prior real turn as `interrupted` via orphan synthesis.
  // See `JsonlEntry.isMeta` for the surveyed shape inventory.
  if (entry.isMeta === true) return out;

  // Bare-string `message.content` shapes: scaffolding (skip), the
  // `<task-notification>` wake envelope (emit `wake_started`), or a
  // plain-text submission (fall through to the block-walk below).
  if (typeof rawContent === "string") {
    if (entry.isCompactSummary === true) return out;
    const trimmed = rawContent.trimStart();
    if (
      COMMAND_SCAFFOLDING_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
    ) {
      return out;
    }
    const wake = extractTaskNotificationWake(rawContent);
    if (wake !== null) {
      // New opener: close any prior open turn first, then emit
      // wake_started. The synthesized `w-<n>` is translator-internal
      // (`wake_started` carries no `msg_id` on the wire); it reaches
      // the wire only via the orphan-synthesis `turn_complete` AND
      // only when no content event arrives to swap it.
      out.push(...emitOrphanIfOpen(ctx));
      out.push({
        type: "wake_started",
        session_id: "",
        wake_trigger: {
          task_id: wake.taskId,
          tool_use_id: "",
          status: "completed",
          summary: wake.summary,
          output_file: "",
        },
        ipc_version: IPC_VERSION,
      });
      ctx.openTurnMsgId = mintOpenerId(ctx, "w");
      return out;
    }
    // Fall through: plain-text submission. `contentBlocks` wraps it
    // as a single text block for the walk below.
  }

  const content = contentBlocks(rawContent);
  // Submitted content blocks for the `add_user_message` frame —
  // preserves interleaving (text / image / text / image …) verbatim
  // from JSONL, which is Anthropic's canonical storage format. Per
  // [Step 5c](roadmap/tide-atoms.md#step-5c).
  const submittedContent: ContentBlock[] = [];
  const textParts: string[] = [];
  let hasImage = false;
  // First `tool_use_id` seen — used to bind the entry-level
  // `toolUseResult` payload (when present) to its initiating
  // tool_use on the `tool_use_structured` IPC frame. Mirrors
  // `session.ts` `firstToolUseId` on the live path.
  let firstToolUseId = "";
  // Buffer tool_result emissions separately from the opener decision
  // — they bind to the currently open turn (the assistant's prior
  // tool_use), so they emit BEFORE any orphan-synthesis trigger from
  // a new opener within the same entry (defensive against a future
  // hybrid entry shape).
  const toolResultFrames: OutboundMessage[] = [];

  for (const block of content) {
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType === "text") {
      if (typeof block.text === "string") {
        textParts.push(block.text);
        submittedContent.push({ type: "text", text: block.text });
      }
      continue;
    }
    if (blockType === "tool_result") {
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
      toolResultFrames.push(toolResult);
      continue;
    }
    if (blockType === "image") {
      const source = block.source ?? {};
      const mediaType =
        typeof source.media_type === "string" ? source.media_type : "image/png";
      const data = typeof source.data === "string" ? source.data : "";
      submittedContent.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
      hasImage = true;
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
    toolResultFrames.push(structured);
  }

  // Emit tool_result + tool_use_structured frames first — they bind
  // to the currently open turn (the assistant's prior tool_use call),
  // so they MUST land before any orphan-synthesis trigger fires from
  // a new opener within the same entry. In every surveyed JSONL,
  // text and tool_result do NOT mix within a single user entry, but
  // the ordering is defensive against a future hybrid shape.
  out.push(...toolResultFrames);

  // Combine text blocks within this single entry — multi-block within
  // one user entry is the same submission and concatenates per [D13]
  // ("the translator emits one `add_user_message` per user JSONL
  // entry — never more").
  const entryText = textParts.join("");

  // Sentinel: claude's "[Request interrupted by user ...]" marker in
  // any of its known forms (see `isInterruptMarkerEntry`). Drop the
  // marker outright. The orphan-synthesis path at the next opener
  // (or EOF) handles any open-turn closure naturally — under [D13]'s
  // model the marker is a non-event, not the orphan trigger it was
  // under the cycle-pairing apparatus.
  if (isInterruptMarkerEntry(entry, entryText) && !hasImage) {
    return out;
  }

  // No opener content: a tool_result-only entry (mid-turn) or a
  // benign empty user entry. Return whatever tool_result frames we
  // gathered (possibly none); do NOT touch openTurnMsgId.
  if (submittedContent.length === 0) {
    return out;
  }

  // New opener: close any prior open turn first, then emit
  // add_user_message. Multiple consecutive user-text entries with no
  // assistant cycle between them are structural orphans — each gets
  // its own committed turn rather than a concatenated submission.
  // Post-Step-5c: emit the interleaved content blocks verbatim from
  // JSONL; tugdeck's wrapper walks them through
  // `synthesizeUserMessageFromBlocks` to produce the substrate.
  out.push(...emitOrphanIfOpen(ctx));
  out.push({
    type: "add_user_message",
    content: submittedContent,
    ipc_version: IPC_VERSION,
  });
  ctx.openTurnMsgId = mintOpenerId(ctx, "u");
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

/**
 * Per-entry translator for `assistant` JSONL entries. Emits the
 * entry's content blocks (one `content_block_start` + kind-specific
 * terminal per block, in arrival order) and, on a clean terminal
 * `stop_reason`, a `turn_complete` keyed on the entry's `msg_id`.
 *
 * Calls {@link noteContentMsgId} at every msg_id-bearing emit so the
 * open-turn tracker flips from a synthesized opener id to claude's
 * real `msg_id` on the FIRST content event of the turn. The orphan-
 * synthesis path (at next-opener boundary or EOF) reads
 * `openTurnMsgId` to decide the orphan `turn_complete`'s msg_id:
 *
 *   - content arrived → real `msg_id` → reducer matches normally;
 *   - no content → synthesized opener id → reducer's no-content
 *     fallback commits `pendingTurn`.
 *
 * On a clean terminal, clears `openTurnMsgId` (matched commit). The
 * `suppressTurnComplete` option defers the terminal when peek-ahead
 * detects the SDK split a single assistant message across two
 * same-msg_id JSONL records — the trailing record fires the single
 * terminal.
 *
 * The cycle-pairing apparatus (`pendingUserText`, `pendingUserAttachments`,
 * `cycleOpen`, `cycleMsgId`, `pendingWakeFromReplay`) is gone per
 * [D13]; the assistant entry no longer mints any opener — the opener
 * already fired from {@link handleUserEntry}.
 */
function handleAssistantEntry(
  entry: JsonlEntry,
  ctx: TranslateContext,
  options?: TranslateJsonlEntryOptions,
): OutboundMessage[] {
  const content = contentBlocks(entry.message?.content);
  const stopReason = entry.message?.stop_reason ?? null;
  const entryMsgId =
    typeof entry.message?.id === "string" ? entry.message.id : "";

  const out: OutboundMessage[] = [];

  // Orphan-assistant synthesis: an `assistant` entry arriving with no
  // open turn (the JSONL opens with an assistant; the prior turn
  // closed; or a skipped entry like `isCompactSummary` swallowed the
  // user side) needs a `pendingTurn` to commit onto. Emit an empty
  // `add_user_message` to mint one. The empty text is a placeholder
  // for "the user prompt belongs to a prior session" (the `--continue`
  // case) or "the user prompt was CLI-internal" (the `/compact`
  // continuation case); the substrate's `TurnEntry.messages[0]` is
  // then a `user_message` with `text: ""`.
  //
  // This is the one synthesized opener the translator emits beyond
  // the user-entry path. It preserves the OLD model's behavior for
  // these edge cases — without it, the assistant's content frames
  // would arrive at the reducer with no pendingTurn (handleContentBlockStart
  // looks up scratch by pendingTurn.turnKey) and the turn would never
  // commit.
  if (ctx.openTurnMsgId === null) {
    // Empty-content opener — the substrate's `UserMessage` substrate
    // walker (`synthesizeUserMessageFromBlocks`) produces `(text: "",
    // atoms: [])` from a zero-block content array, which is exactly
    // the "no user prompt to render" semantics we want here.
    const synthOpener: AddUserMessage = {
      type: "add_user_message",
      content: [],
      ipc_version: IPC_VERSION,
    };
    out.push(synthOpener);
    ctx.openTurnMsgId = mintOpenerId(ctx, "u");
  }

  // Capture per-block records preserving the JSONL's arrival order.
  // Each block is keyed by its position in `message.content` (the
  // block_index), which mirrors the live wire's
  // `content_block_start.index` numbering. Per [D07], the reducer
  // mints a Message at each `(msg_id, block_index)` and appends
  // terminal text/tool content into the same Message — so the replay
  // path emits one content_block_start + terminal frame per block, in
  // arrival order, to reconstruct the same `messages` sequence the
  // live path would produce.
  //
  // **Per-msg_id block-index offset.** When one `message.id` spans
  // multiple JSONL entries (e.g. thinking-only then text-only — see
  // session ecc343d8 / `TranslateContext.blockCountByMsgId`), each
  // entry's `content[]` array re-starts its local index at 0. The
  // wire delivered those blocks with CONSECUTIVE indices though, and
  // the reducer's idempotent mint keys on `(msg_id, block_index)`. We
  // start this entry's emitted block_index at the running count for
  // this `msg_id` (default 0 for the first entry) and bump it once
  // the per-block emit loop finishes — preserving the wire's
  // consecutive-index discipline across entry boundaries.
  type BlockRecord =
    | { index: number; kind: "text"; text: string }
    | { index: number; kind: "thinking"; text: string }
    | { index: number; kind: "tool_use"; toolUseId: string; toolName: string; input: unknown };
  const blocks: BlockRecord[] = [];
  const baseBlockIndex = entryMsgId.length > 0
    ? ctx.blockCountByMsgId.get(entryMsgId) ?? 0
    : 0;
  let localBlockIndex = 0;

  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType === "text") {
      const text = typeof block.text === "string" ? block.text : "";
      blocks.push({ index: baseBlockIndex + localBlockIndex, kind: "text", text });
      localBlockIndex += 1;
      continue;
    }
    if (blockType === "thinking") {
      // Tolerate a handful of older JSONL shapes that put the thinking
      // text in the `text` field on a `thinking` block.
      const text =
        typeof block.thinking === "string"
          ? block.thinking
          : typeof block.text === "string"
            ? block.text
            : "";
      blocks.push({ index: baseBlockIndex + localBlockIndex, kind: "thinking", text });
      localBlockIndex += 1;
      continue;
    }
    if (blockType === "tool_use") {
      const toolUseId = typeof block.id === "string" ? block.id : "";
      const toolName = typeof block.name === "string" ? block.name : "";
      const input = block.input ?? {};
      // Skip tool_use blocks with no id — they can't be paired with a
      // tool_result and are useless to the reducer.
      if (toolUseId.length > 0) {
        blocks.push({
          index: baseBlockIndex + localBlockIndex,
          kind: "tool_use",
          toolUseId,
          toolName,
          input,
        });
        localBlockIndex += 1;
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

  // Bump the per-msg_id block count by the number of blocks this
  // entry contributed. A trailing same-msg_id continuation entry will
  // start its block_index at this updated count.
  if (entryMsgId.length > 0 && localBlockIndex > 0) {
    ctx.blockCountByMsgId.set(entryMsgId, baseBlockIndex + localBlockIndex);
  }

  // Emit per-block events in arrival order: content_block_start (mints
  // the reducer's Message) followed by the kind-specific terminal
  // frame. All keyed on this entry's `message.id` (claude's id; no
  // canonicalization). At every msg_id-bearing emit, call
  // `noteContentMsgId` so the open-turn tracker flips from the
  // synthesized opener id (`u-<n>` or `w-<n>`) to claude's real
  // `msg_id` on the FIRST content event — see [D13]'s wire-truth
  // update rule.
  for (const block of blocks) {
    // Construct kind-specific content_block_start; the discriminated
    // union narrows tool_use_id / tool_name to required strings only
    // for the tool_use variant.
    const blockStart: ContentBlockStart =
      block.kind === "tool_use"
        ? {
            type: "content_block_start",
            msg_id: entryMsgId,
            block_index: block.index,
            kind: "tool_use",
            tool_use_id: block.toolUseId,
            tool_name: block.toolName,
            ipc_version: IPC_VERSION,
          }
        : {
            type: "content_block_start",
            msg_id: entryMsgId,
            block_index: block.index,
            kind: block.kind,
            ipc_version: IPC_VERSION,
          };
    out.push(blockStart);
    noteContentMsgId(ctx, entryMsgId);

    if (block.kind === "text") {
      if (block.text.length > 0) {
        const assistant: AssistantText = {
          type: "assistant_text",
          msg_id: entryMsgId,
          block_index: block.index,
          seq: ctx.globalSeq++,
          rev: 0,
          text: block.text,
          is_partial: false,
          status: "complete",
          ipc_version: IPC_VERSION,
        };
        out.push(assistant);
        noteContentMsgId(ctx, entryMsgId);
      }
    } else if (block.kind === "thinking") {
      if (block.text.length > 0) {
        const thinking: ThinkingText = {
          type: "thinking_text",
          msg_id: entryMsgId,
          block_index: block.index,
          seq: ctx.globalSeq++,
          text: block.text,
          is_partial: false,
          status: "complete",
          ipc_version: IPC_VERSION,
        };
        out.push(thinking);
        noteContentMsgId(ctx, entryMsgId);
      }
    } else if (block.kind === "tool_use") {
      const toolUse: ToolUse = {
        type: "tool_use",
        msg_id: entryMsgId,
        seq: ctx.globalSeq++,
        tool_name: block.toolName,
        tool_use_id: block.toolUseId,
        input:
          typeof block.input === "object" && block.input !== null
            ? (block.input as object)
            : {},
        ipc_version: IPC_VERSION,
      };
      out.push(toolUse);
      noteContentMsgId(ctx, entryMsgId);
    } else {
      // Exhaustiveness check — a future BlockRecord kind that the
      // upstream parser added but this terminal emitter forgot to
      // handle fails at compile.
      const _exhaustive: never = block;
      throw new Error(`unknown BlockRecord kind: ${JSON.stringify(_exhaustive)}`);
    }
  }

  // Cycle terminal: on a clean terminal `stop_reason`
  // (`TERMINAL_STOP_REASONS` — `end_turn`, `stop_sequence`,
  // `max_tokens`, `refusal`), AND only when the session-level loop
  // hasn't asked us to defer. Suppression applies when peek-ahead
  // identified a same-msg_id continuation entry — claude's SDK split a
  // single assistant message across two JSONL records (each carrying
  // the terminal stop_reason), and we want exactly one `turn_complete`
  // to land at the end of the run rather than two (the second of which
  // the reducer would dedupe, stranding pending state). `tool_use`,
  // `pause_turn`, and a null / absent stop_reason are non-terminal —
  // the cycle legitimately continues. Bumps `turnsCommitted` so
  // `replay_complete.count` reflects committed cycles; clears
  // `openTurnMsgId` so the next opener starts fresh.
  if (
    stopReason !== null &&
    TERMINAL_STOP_REASONS.has(stopReason) &&
    options?.suppressTurnComplete !== true
  ) {
    const turnComplete: TurnComplete = {
      type: "turn_complete",
      msg_id: entryMsgId,
      seq: ctx.globalSeq++,
      result: "success",
      ipc_version: IPC_VERSION,
    };
    out.push(turnComplete);
    ctx.turnsCommitted += 1;
    ctx.openTurnMsgId = null;
    // Per-msg_id block-count tracking is meaningful only within a
    // single turn; clear it at the terminal turn_complete so a future
    // assistant entry that happens to reuse this `msg_id` (e.g. a
    // resume scenario or a defensive replay) starts its block_index
    // discipline from 0 again.
    if (entryMsgId.length > 0) {
      ctx.blockCountByMsgId.delete(entryMsgId);
    }
  }

  return out;
}

// Per-message flushing makes a separate "in-flight trailing turn"
// flush at end-of-JSONL unnecessary: each `assistant` entry emits its
// content frames immediately when its line is processed, regardless of
// `stop_reason`. The trailing entry of an unfinished cycle has already
// emitted; only the cycle-terminal `turn_complete` is absent (because
// `stop_reason` was not a clean terminal). The live drain continuing
// post-replay produces the eventual `turn_complete` naturally when
// claude's `result` lands. The translateJsonlSession loop body no
// longer needs an EOF-time flush for assistant content — but it does
// flush a stranded trailing user-only orphan on a cold resume; see
// `synthesizeDanglingTerminal`.

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
   * When `true`, an open turn at EOF that no live turn will resolve
   * is committed via {@link emitOrphanIfOpen} before `replay_complete`
   * rather than left stranded. Under [D13]'s unified open-turn
   * tracker, both pre-Step-5.6 EOF cases — a dangling assistant cycle
   * ([replay-1]) and a trailing user-only orphan ([W2]) — collapse
   * into the same path: if `ctx.openTurnMsgId !== null` at EOF, emit
   * one `turn_complete{result: "interrupted"}` carrying that id.
   *
   * The id naturally selects the reducer-side commit path:
   *   - dangling cycle (content arrived, no clean terminal): the
   *     `noteContentMsgId` rule swapped `openTurnMsgId` to claude's
   *     real `msg_id`, so the reducer's `handleTurnComplete` matches
   *     on `activeMsgId` and commits the partial content;
   *   - trailing orphan (no content): `openTurnMsgId` is the
   *     synthesized opener id (`u-<n>` / `w-<n>`), and the reducer's
   *     no-content fallback (`#spec-reducer-state` rule 2) commits
   *     `pendingTurn`.
   *
   * `runReplay` sets this from the absence of a live `ActiveTurn`:
   * `true` on a cold resume (no live turn will continue the JSONL),
   * `false` on reload-mid-stream (a live `ActiveTurn` is still
   * producing the turn / carrying the trailing submission, and the
   * live drain delivers the real `turn_complete`). Default `false` —
   * the safe choice for any caller that hasn't reasoned about live
   * continuation.
   */
  synthesizeDanglingTerminal?: boolean;
}

/**
 * Result returned by `translateJsonlSession`'s AsyncGenerator (the
 * value reachable via `.next()` when `done: true`, also typed as the
 * generator's `TReturn` parameter).
 *
 * `count` mirrors the per-wire `replay_complete.count` and counts
 * every turn committed via `turn_complete` — both clean terminals
 * (`{result: "success"}`, one per `assistant` JSONL entry whose
 * `stop_reason` is in {@link TERMINAL_STOP_REASONS}) and orphan
 * synthesizes (`{result: "interrupted"}`, emitted by
 * {@link emitOrphanIfOpen} when a new opener arrives or at EOF).
 *
 * EOF behavior depends on {@link TranslateSessionOptions.synthesizeDanglingTerminal}:
 * `false` leaves an open turn for the live drain (the post-replay
 * `turn_complete` lands when claude's `result` arrives); `true` emits
 * the orphan synthetic so a cold-resumed session commits its final
 * turn instead of stranding an in-flight row.
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

  // EOF orphan synthesis (gated on `synthesizeDanglingTerminal`).
  // Under [D13]'s unified open-turn tracker model, both the
  // "dangling assistant cycle" case (assistant content arrived but no
  // clean terminal `stop_reason`) and the "trailing user-only orphan"
  // case (user submitted and quit before any assistant entry) collapse
  // into one path: if `openTurnMsgId !== null`, emit a single
  // `turn_complete{result: "interrupted"}` carrying that id.
  //
  // The id naturally selects the right reducer path:
  //   - dangling cycle: `noteContentMsgId` already swapped
  //     `openTurnMsgId` to claude's real `msg_id` from the open
  //     assistant entry, so the reducer's normal `handleTurnComplete`
  //     match commits the partial content;
  //   - trailing orphan: `openTurnMsgId` is still the synthesized
  //     opener id (`u-<n>` for user-text, `w-<n>` for wake — the
  //     latter shouldn't reach EOF in practice but the path handles
  //     it symmetrically), and the reducer's no-content fallback
  //     (`#spec-reducer-state` rule 2) commits `pendingTurn`.
  //
  // The two outcomes for an open turn are decided by the caller via
  // `synthesizeDanglingTerminal`:
  //   - `false` (default — reload-mid-stream, where a live
  //     `ActiveTurn` continues the turn): leave the turn open. The
  //     live drain (or `emitInflightTurnFromActiveTurn`) delivers
  //     the eventual `turn_complete`.
  //   - `true` (cold resume — no live continuation): emit the orphan
  //     synthetic so the resumed transcript shows an `interrupted`
  //     TurnEntry instead of stranding an in-flight row that animates
  //     its thinking indicator forever ([replay-1] / [W2]).
  if (synthesizeDanglingTerminal) {
    for (const msg of emitOrphanIfOpen(ctx)) {
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
