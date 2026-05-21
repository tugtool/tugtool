// Session lifecycle management via direct claude CLI spawning

import { PermissionManager } from "./permissions.ts";
import { writeLine, writeLineAndExit } from "./ipc.ts";
import {
  sendControlRequest,
  sendControlResponse,
  formatPermissionAllow,
  formatPermissionDeny,
  formatQuestionAnswer,
  generateRequestId,
} from "./control.ts";
import type {
  UserMessage,
  ToolApproval,
  QuestionAnswer,
  PermissionModeMessage,
  OutboundMessage,
  ThinkingText,
  CompactBoundary,
  ApiRetry,
  ControlRequestForward,
  ControlRequestCancel,
  ReplayComplete,
  SystemMetadata,
  CostUpdate,
  StreamingUsage,
  Attachment,
} from "./types.ts";
import { join, dirname, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { Database } from "bun:sqlite";
import { logSessionLifecycle } from "./session-lifecycle-log.ts";
import {
  type ReplayInput,
  type ReplayTelemetry,
  translateJsonlSession,
} from "./replay.ts";
import { ContextBreakdownEmitter } from "./context-breakdown.ts";

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// Image attachment validation constants (per PN-12)
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // ~5MB decoded

// ---------------------------------------------------------------------------
// Replay constants and helpers
// ---------------------------------------------------------------------------

/**
 * Hard-budget timeout for the per-session replay window. If the JSONL
 * iterator hasn't finished by this point, the replay aborts with
 * `replay_complete { error: { kind: "replay_timeout" } }` and live
 * forwarding resumes. Matches the wall-clock budget called out in
 * `roadmap/tugplan-tide-transcript-resume.md` (D10).
 */
export const REPLAY_HARD_TIMEOUT_MS = 10_000;

/**
 * Soft cap on the number of raw lines captured from claude's stdout
 * during the replay window. claude on `--resume` with no new user
 * input is essentially silent (a `system:init` plus occasional
 * keep-alives). Anything beyond this is pathological — the bound
 * exists so a runaway claude can't exhaust the OS pipe buffer or
 * tugcode's heap during a slow replay. On overflow, further bytes are
 * still consumed (so claude stays unblocked) but discarded; a single
 * `tide::replay::live_buffer_overflow` warn line marks the event.
 */
export const REPLAY_LIVE_BUFFER_MAX = 1024;

/**
 * Default location of claude's per-session JSONL archive. Each
 * project gets its own subdirectory under this root, named by the
 * encoded form of the absolute project directory (see
 * {@link encodeProjectDir}). Tests inject an override via
 * {@link SessionManager}'s `claudeProjectsRoot` option so they read
 * fixtures from a tmp path instead.
 */
export const DEFAULT_CLAUDE_PROJECTS_ROOT =
  `${process.env.HOME ?? ""}/.claude/projects`;

/**
 * Encode an absolute project directory the way claude names its
 * per-project subdirectory under `~/.claude/projects/`. The encoding
 * is a simple `'/' → '-'` replacement run over the absolute path —
 * the leading `-` arises because the absolute path begins with `/`.
 *
 * Examples (verified against `~/.claude/projects/` on dev machines):
 *
 *   `/Users/foo`               → `-Users-foo`
 *   `/private/tmp/py-calc`     → `-private-tmp-py-calc`
 *   `/Users/foo/src/tugtool`   → `-Users-foo-src-tugtool`
 *
 * Exported for unit tests.
 */
export function encodeProjectDir(absDir: string): string {
  return absDir.replace(/\//g, "-");
}

/**
 * Resolve the on-disk JSONL path for a given resume target.
 *
 *   `<claudeProjectsRoot>/<encodeProjectDir(projectDir)>/<id>.jsonl`
 */
export function jsonlPathFor(
  claudeProjectsRoot: string,
  projectDir: string,
  claudeSessionId: string,
): string {
  return join(
    claudeProjectsRoot,
    encodeProjectDir(projectDir),
    `${claudeSessionId}.jsonl`,
  );
}

/**
 * Default on-disk location of the tugcast SessionLedger database.
 * Mirrors the Rust-side `SessionLedger::default_path()` resolution so
 * tugcast (writer) and tugcode (reader) hit the same file:
 *
 *   - macOS: `~/Library/Application Support/Tug/sessions.db`
 *   - Linux: `$XDG_DATA_HOME/tugcast/sessions.db` (falling back to
 *     `~/.local/share/tugcast/sessions.db`)
 *
 * Tests inject a different path via the `sessionsDbPath` constructor
 * option so they don't read the real user's database.
 */
export function defaultSessionsDbPath(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Tug", "sessions.db");
  }
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(home, ".local", "share");
  return join(base, "tugcast", "sessions.db");
}

/**
 * Result of attempting to read a JSONL file from disk. A discriminated
 * union so the resume-spawn flow can pass the outcome straight to
 * {@link translateJsonlSession} without losing the error category.
 */
export type JsonlReadResult =
  | { kind: "ok"; jsonl: string }
  | { kind: "missing"; message: string }
  | { kind: "unreadable"; message: string };

/**
 * One row of the `turns` submission journal read by tugcode through
 * the cross-process bun:sqlite handle. Mirrors the Rust `JournalRow`
 * shape (mid-turn-replay [Step 5.2](roadmap/tugplan-tide-mid-turn-replay.md#step-5-2)).
 * Tugcode never writes to this table; tugcast's `dispatch_one`
 * intercept owns inserts ([Step 4.3](roadmap/tugplan-tide-mid-turn-replay.md#step-4-3))
 * and the merger's `apply_outbound_turn_intercept` owns FIFO deletes
 * ([Step 5.3](roadmap/tugplan-tide-mid-turn-replay.md#step-5-3)).
 */
interface JournalRow {
  journal_id: string;
  session_id: string;
  user_text: string;
  user_attachments: Buffer | Uint8Array;
  created_at: number;
}

/**
 * Build a multiset (text → count) of user-message texts seen in the
 * JSONL bytes. Used by [`runReplay`]'s pending-row injection
 * (mid-turn-replay [Step 5.6](roadmap/tugplan-tide-mid-turn-replay.md#step-5-6))
 * to decide which journal rows still need a synthetic
 * `user_message_replay` emit (i.e., the rows whose `user_text` does
 * NOT appear as a `user_message` line in JSONL — claude has not yet
 * acknowledged those submissions).
 *
 * Multi-occurrence handling: if claude has written N user_messages
 * with the same text, the count is N; the journal-pass decrements
 * the count once per matched row and emits a synthetic only when
 * the count is exhausted. This handles duplicate-text submissions
 * better than a Set membership check at no extra parse cost.
 *
 * Tool-result entries (also `type: "user"` in JSONL but with
 * `tool_result` content blocks) are skipped — they're not user
 * submissions. Malformed JSON lines are skipped silently (matches
 * the translator's permissiveness).
 */
export function extractUserMessageTextCounts(jsonl: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rawLine of jsonl.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const entry = parsed as { type?: unknown; message?: unknown };
    if (entry.type !== "user") continue;
    const message = entry.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    const textParts: string[] = [];
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") {
        textParts.push(b.text);
      }
    }
    if (textParts.length === 0) continue;
    const text = textParts.join("");
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return counts;
}

/**
 * Default JSONL reader. Uses `Bun.file(path)` and treats `ENOENT` as
 * `missing`, every other error as `unreadable`. Replaceable from
 * tests via {@link SessionManager}'s `jsonlReader` option.
 */
export async function defaultJsonlReader(
  path: string,
): Promise<JsonlReadResult> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return { kind: "missing", message: `JSONL not found at ${path}` };
    }
    const jsonl = await file.text();
    return { kind: "ok", jsonl };
  } catch (err) {
    return {
      kind: "unreadable",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function logReplay(event: string, fields: Record<string, unknown>): void {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    parts.push(`${k}=${formatReplayValue(v)}`);
  }
  console.log(`[tide::replay::${event}] ${parts.join(" ")}`);
}

function formatReplayValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") {
    if (v.length === 0 || /[\s"']/.test(v)) return JSON.stringify(v);
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Exported pure functions for testability
// ---------------------------------------------------------------------------

/**
 * Build the content blocks array for a user message.
 * Converts text and attachments into the claude API content block format.
 * Validates image types and sizes per PN-12 (#pn-image-limits).
 * Exported for unit testing.
 */
export function buildContentBlocks(
  text: string,
  attachments: Array<Attachment>
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];

  // Text always comes first.
  if (text.length > 0) {
    blocks.push({ type: "text", text });
  }

  for (const att of attachments) {
    if (att.media_type.startsWith("image/")) {
      // Validate media_type per PN-12.
      if (!ALLOWED_IMAGE_TYPES.has(att.media_type)) {
        throw new Error(
          `Unsupported image type: ${att.media_type}. Supported: image/png, image/jpeg, image/gif, image/webp`
        );
      }
      // Validate decoded size (~5MB limit). Base64 encodes 3 bytes as 4 chars.
      const sizeBytes = Math.ceil((att.content.length * 3) / 4);
      if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
        throw new Error(
          `Image exceeds ~5MB limit: ${att.filename} (${Math.round(sizeBytes / 1024 / 1024)}MB)`
        );
      }
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: att.media_type,
          data: att.content,
        },
      });
    } else {
      // Text attachment.
      blocks.push({ type: "text", text: att.content });
    }
  }

  // Ensure at least one block (fallback for empty text + no attachments).
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: "" });
  }

  return blocks;
}

/**
 * Configuration for building claude CLI spawn arguments.
 */
export interface ClaudeSpawnConfig {
  pluginDir: string;
  /** When omitted, the claude CLI uses its own configured default model. */
  model?: string;
  permissionMode: string;
  sessionId: string | null;
  continue?: boolean;
  forkSession?: boolean;
  sessionIdOverride?: string;
}

/**
 * Build the CLI argument array for spawning the claude process.
 * Exported for unit tests.
 */
export function buildClaudeArgs(config: ClaudeSpawnConfig): string[] {
  // Validate session flag combinations per D10.
  const sessionFlagCount = [
    !!config.sessionId,
    !!config.continue,
    !!config.sessionIdOverride,
  ].filter(Boolean).length;
  if (sessionFlagCount > 1) {
    throw new Error("Only one of sessionId, continue, or sessionIdOverride may be set");
  }

  if (config.forkSession && !config.sessionId && !config.continue) {
    throw new Error("forkSession requires either sessionId or continue to be set");
  }

  const args: string[] = [
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--permission-prompt-tool", "stdio",
    "--include-partial-messages",
    "--replay-user-messages",
    "--plugin-dir", config.pluginDir,
    "--permission-mode", config.permissionMode,
  ];

  if (config.model) {
    args.push("--model", config.model);
  }

  if (config.sessionId) {
    args.push("--resume", config.sessionId);
  }

  if (config.continue) {
    args.push("--continue");
  }

  if (config.forkSession) {
    args.push("--fork-session");
  }

  if (config.sessionIdOverride) {
    args.push("--session-id", config.sessionIdOverride);
  }

  return args;
}

/**
 * Context passed to mapStreamEvent and routeTopLevelEvent for IPC message construction.
 */
export interface EventMappingContext {
  msgId: string;
  seq: number;
  rev: number;
}

/**
 * Result of mapping a single stream-json (inner) event to IPC outbound messages.
 *
 * `messageId` carries claude's `message.id` whenever the stream event reveals
 * it (today: `message_start` only; future event types may also expose it).
 * `dispatchEventToTurn` slides `ActiveTurn.currentMessageId` to this value so
 * subsequent events whose claude shape doesn't carry an id directly
 * (`content_block_delta`, `content_block_start`) emit under the right key.
 * Absent on events that don't reveal the id.
 *
 * `messageStartUsage` / `messageDeltaUsage` carry the raw token-bearing
 * `usage` object whenever a `message_start` / `message_delta` revealed
 * one. `dispatchEventToTurn` latches them onto `ActiveTurn` so the
 * terminal `result` event can emit `cost_update.usage` from the turn's
 * LAST tool-loop iteration — never `result.usage`, which is the
 * per-turn SUM across every iteration. Absent on every other event.
 */
export interface EventMappingResult {
  messages: OutboundMessage[];
  newRev: number;
  partialText: string;
  gotResult: boolean;
  messageId?: string;
  messageStartUsage?: Record<string, unknown>;
  messageDeltaUsage?: Record<string, unknown>;
}

/**
 * Result metadata from a result event, stored for CostUpdate emission.
 */
export interface ResultMetadata {
  subtype: string;
  is_error?: boolean;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
  permission_denials?: unknown[];
  is_api_error?: boolean;
  resultValue?: string;
}

/**
 * Result of routing a single top-level stdout message to IPC outbound messages.
 * Per D03 (#d03-event-routing) two-tier routing architecture.
 */
export interface TopLevelRoutingResult {
  messages: OutboundMessage[];
  gotResult: boolean;
  sessionId?: string;
  streamEvent?: Record<string, unknown>;
  controlRequest?: Record<string, unknown>;
  cancelledRequestId?: string;
  parentToolUseId?: string;
  resultMetadata?: ResultMetadata;
  systemMetadata?: Record<string, unknown>;
  /**
   * Claude's `message.id` for the turn, when revealed by this top-level
   * event (today: the `assistant` snapshot only). Belt-and-suspenders to the
   * `mapStreamEvent` `message_start` path: whichever lands first slides
   * `ActiveTurn.currentMessageId` to it. Absent on events that don't reveal
   * the id.
   */
  messageId?: string;
}

/**
 * Route a single top-level stdout message to IPC outbound messages.
 * Handles all 8+ top-level message types per D03.
 * Exported for unit testing.
 *
 * `lastIterationUsage` is the `usage` of the turn's LAST tool-loop
 * iteration — the most recent `message_delta` (or `message_start`
 * fallback) `ActiveTurn` latched while draining the turn. The `result`
 * branch emits it as `cost_update.usage`. `result.usage` (on the event
 * itself) is deliberately NOT used for the wire `usage`: it is the
 * per-turn SUM across every API call, so a K-tool-call turn would
 * over-report context by ~K×. `result.usage` still flows into
 * `resultMetadata.usage` untouched. Omitted (pure-function callers
 * with no turn) → `cost_update.usage` is `{}`.
 */
export function routeTopLevelEvent(
  event: Record<string, unknown>,
  ctx: EventMappingContext,
  lastIterationUsage?: Record<string, unknown> | null
): TopLevelRoutingResult {
  const messages: OutboundMessage[] = [];
  let gotResult = false;
  let sessionId: string | undefined;
  let streamEvent: Record<string, unknown> | undefined;
  let controlRequest: Record<string, unknown> | undefined;
  let cancelledRequestId: string | undefined;
  let parentToolUseId: string | undefined;
  let resultMetadata: ResultMetadata | undefined;
  let systemMetadata: Record<string, unknown> | undefined;
  let messageId: string | undefined;

  // parent_tool_use_id is present on all 5 message types per PN-8.
  const rawParentId = event.parent_tool_use_id;
  if (typeof rawParentId === "string" && rawParentId.length > 0) {
    parentToolUseId = rawParentId;
  }

  const eventType = event.type as string | undefined;

  switch (eventType) {
    case "system": {
      const subtype = event.subtype as string | undefined;
      if (subtype === "init") {
        const sid = event.session_id as string | undefined;
        if (sid) {
          sessionId = sid;
        }
        systemMetadata = {
          tools: event.tools,
          model: event.model,
          permissionMode: event.permissionMode,
          cwd: event.cwd,
          slash_commands: event.slash_commands,
          plugins: event.plugins,
          agents: event.agents,
          skills: event.skills,
          mcp_servers: event.mcp_servers,
          claude_code_version: event.claude_code_version,
          output_style: event.output_style,
          fast_mode_state: event.fast_mode_state,
          apiKeySource: event.apiKeySource,
        };
        // Emit SystemMetadata IPC so the frontend can populate settings and help panels.
        const sysMsg: SystemMetadata = {
          type: "system_metadata",
          session_id: sid || "",
          cwd: (event.cwd as string) || "",
          tools: (event.tools as unknown[]) || [],
          model: (event.model as string) || "",
          permissionMode: (event.permissionMode as string) || "",
          slash_commands: (event.slash_commands as unknown[]) || [],
          plugins: (event.plugins as unknown[]) || [],
          agents: (event.agents as unknown[]) || [],
          skills: (event.skills as unknown[]) || [],
          mcp_servers: (event.mcp_servers as unknown[]) || [],
          version: (event.claude_code_version as string) || "",
          output_style: (event.output_style as string) || "",
          fast_mode_state: (event.fast_mode_state as string) || "",
          apiKeySource: (event.apiKeySource as string) || "",
          ipc_version: 2,
        };
        messages.push(sysMsg);
      } else if (subtype === "compact_boundary") {
        const marker: CompactBoundary = { type: "compact_boundary", ipc_version: 2 };
        messages.push(marker);
      } else if (subtype === "api_retry") {
        messages.push({
          type: "api_retry",
          attempt: (event.attempt as number) || 0,
          max_retries: (event.max_retries as number) || 10,
          retry_delay_ms: (event.retry_delay_ms as number) || 0,
          error_status: (event.error_status as number | null) ?? null,
          error: (event.error as string) || "unknown",
          ipc_version: 2,
        });
      }
      break;
    }

    case "assistant": {
      // The assistant top-level event is a complete snapshot of the message.
      // For normal API responses, text was already delivered via stream_event
      // as partial assistant_text messages — we skip re-emitting to avoid
      // duplicates. Tool use blocks are still emitted since they may not
      // arrive via streaming.
      //
      // EXCEPTION: Synthetic messages (model: "<synthetic>") are produced by
      // built-in slash commands like /cost, /compact. These have no streaming
      // events — the assistant message is the only source of text. Emit it.
      const message = event.message as Record<string, unknown> | undefined;
      const rawId = message?.id;
      if (typeof rawId === "string" && rawId.length > 0) {
        messageId = rawId;
      }
      // Use claude's id for any messages built here when present, so the
      // first emit (synthetic text or tool_use within this snapshot)
      // already carries the same id the wire / reducer will use.
      // dispatchEventToTurn slides `turn.currentMessageId` to this id
      // after this function returns; the messages built below already
      // carry it via this local.
      const effectiveMsgId = messageId ?? ctx.msgId;
      const model = (message?.model as string) || "";
      const isSynthetic = model === "<synthetic>";
      const content = (message?.content as Array<Record<string, unknown>>) || [];

      for (const block of content) {
        if (block.type === "text" && isSynthetic) {
          const text = (block.text as string) || "";
          if (text.length > 0) {
            messages.push({
              type: "assistant_text",
              msg_id: effectiveMsgId,
              seq: ctx.seq,
              rev: ctx.rev,
              text,
              is_partial: false,
              status: "complete",
              ipc_version: 2,
            });
          }
        } else if (block.type === "tool_use") {
          messages.push({
            type: "tool_use",
            msg_id: effectiveMsgId,
            seq: ctx.seq,
            tool_name: (block.name as string) || "",
            tool_use_id: (block.id as string) || "",
            input: (block.input as object) || {},
            ipc_version: 2,
          });
        }
      }
      break;
    }

    case "user": {
      const message = event.message as Record<string, unknown> | undefined;
      const rawContent = message?.content;

      // Slash commands return content as a plain string (not an array).
      // Per §13c: {"type":"user","isReplay":true,"message":{"role":"user",
      //   "content":"<local-command-stdout>...</local-command-stdout>"}}
      if (event.isReplay === true && typeof rawContent === "string") {
        const stdoutMatch = rawContent.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
        if (stdoutMatch) {
          messages.push({
            type: "assistant_text",
            msg_id: ctx.msgId,
            seq: ctx.seq,
            rev: ctx.rev,
            text: stdoutMatch[1],
            is_partial: false,
            status: "complete",
            ipc_version: 2,
          });
        }
        const stderrMatch = rawContent.match(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/);
        if (stderrMatch) {
          messages.push({
            type: "error",
            message: stderrMatch[1],
            recoverable: true,
            ipc_version: 2,
          });
        }
        break;
      }

      const content = (rawContent as Array<Record<string, unknown>>) || [];

      let firstToolUseId: string | undefined;

      for (const block of content) {
        if (block.type === "tool_result") {
          const blockContent = block.content;
          let output = "";
          if (typeof blockContent === "string") {
            // Per PN-3: strip <tool_use_error> tags when is_error is true.
            if (block.is_error === true && blockContent.includes("<tool_use_error>")) {
              output = blockContent
                .replace(/<tool_use_error>/g, "")
                .replace(/<\/tool_use_error>/g, "")
                .trim();
            } else {
              output = blockContent;
            }
          } else if (Array.isArray(blockContent)) {
            output = (blockContent as Array<Record<string, unknown>>)
              .filter((b) => b.type === "text")
              .map((b) => b.text as string)
              .join("");
          }
          const toolUseId = (block.tool_use_id as string) || "";
          if (!firstToolUseId) {
            firstToolUseId = toolUseId;
          }
          messages.push({
            type: "tool_result",
            tool_use_id: toolUseId,
            output,
            is_error: block.is_error === true,
            ipc_version: 2,
          });
        }
      }

      // Check outer event for tool_use_result (structured result) per PN-4.
      const toolUseResult = event.tool_use_result as Record<string, unknown> | undefined;
      if (toolUseResult && firstToolUseId) {
        messages.push({
          type: "tool_use_structured",
          tool_use_id: firstToolUseId,
          tool_name: (toolUseResult.toolName as string) || "",
          structured_result: toolUseResult,
          ipc_version: 2,
        });
      }

      // Handle isReplay + slash command output in tool_result blocks (array content).
      if (event.isReplay === true) {
        for (const block of content) {
          if (block.type === "tool_result") {
            const blockContent = block.content;
            if (typeof blockContent === "string") {
              const stdoutMatch = blockContent.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
              if (stdoutMatch) {
                messages.push({
                  type: "assistant_text",
                  msg_id: ctx.msgId,
                  seq: ctx.seq,
                  rev: ctx.rev,
                  text: stdoutMatch[1],
                  is_partial: false,
                  status: "complete",
                  ipc_version: 2,
                });
              }
              const stderrMatch = blockContent.match(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/);
              if (stderrMatch) {
                messages.push({
                  type: "error",
                  message: stderrMatch[1],
                  recoverable: true,
                  ipc_version: 2,
                });
              }
            }
          }
        }
      }
      break;
    }

    case "result": {
      gotResult = true;
      const subtype = (event.subtype as string) || "error";
      const resultText = event.result as string | undefined;

      let isApiError = false;
      if (subtype === "success" && typeof resultText === "string" && resultText.startsWith("API Error:")) {
        isApiError = true;
      }

      resultMetadata = {
        subtype,
        is_error: event.is_error === true,
        total_cost_usd: event.total_cost_usd as number | undefined,
        num_turns: event.num_turns as number | undefined,
        duration_ms: event.duration_ms as number | undefined,
        duration_api_ms: event.duration_api_ms as number | undefined,
        usage: event.usage as Record<string, unknown> | undefined,
        modelUsage: event.modelUsage as Record<string, unknown> | undefined,
        permission_denials: event.permission_denials as unknown[] | undefined,
        is_api_error: isApiError || undefined,
      };

      // Emit CostUpdate from result event. The final assistant_text and
      // turn_complete are emitted by handleUserMessage with fresh seq values
      // so they pass through the frontend ordering buffer's dedup logic.
      //
      // `usage` carries the turn's LAST tool-loop iteration's usage
      // (`lastIterationUsage`), NOT `result.usage`. `result.usage` is a
      // SUM across every API call of the turn — a context-window snapshot
      // it is not. The last iteration's `input + cache_read +
      // cache_creation + output` IS the resident context after the turn.
      const costMsg: CostUpdate = {
        type: "cost_update",
        total_cost_usd: (event.total_cost_usd as number) || 0,
        num_turns: (event.num_turns as number) || 0,
        duration_ms: (event.duration_ms as number) || 0,
        duration_api_ms: (event.duration_api_ms as number) || 0,
        usage: lastIterationUsage ?? {},
        modelUsage: (event.modelUsage as Record<string, unknown>) || {},
        ipc_version: 2,
      };
      messages.push(costMsg);

      // Store result value for handleUserMessage to emit turn_complete.
      resultMetadata.resultValue = subtype === "success" ? "success" : "error";
      break;
    }

    case "stream_event": {
      streamEvent = event.event as Record<string, unknown> | undefined;
      break;
    }

    case "control_request": {
      controlRequest = event;
      break;
    }

    case "control_response": {
      console.log(`Received control_response: ${JSON.stringify(event)}`);
      break;
    }

    case "keep_alive": {
      break;
    }

    case "control_cancel_request": {
      const cancelId = event.request_id as string | undefined;
      if (cancelId) {
        cancelledRequestId = cancelId;
        const cancelMsg: ControlRequestCancel = {
          type: "control_request_cancel",
          request_id: cancelId,
          ipc_version: 2,
        };
        messages.push(cancelMsg);
      } else {
        console.log(`Received control_cancel_request with no request_id: ${JSON.stringify(event)}`);
      }
      break;
    }

    default: {
      console.log(`Unhandled top-level event type=${eventType ?? "unknown"}`);
      break;
    }
  }

  return {
    messages,
    gotResult,
    sessionId,
    streamEvent,
    controlRequest,
    cancelledRequestId,
    parentToolUseId,
    resultMetadata,
    systemMetadata,
    messageId,
  };
}

/** The four token-count keys a claude `usage` object carries. */
const USAGE_TOKEN_KEYS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
] as const;

/**
 * Build a `streaming_usage` IPC frame from a raw claude `usage` object,
 * or `null` when there is nothing worth emitting: an empty `msg_id`
 * (claude has not revealed the message id yet) or a `usage` carrying
 * none of the four token fields (a lifecycle-only payload, an empty
 * `{}`, a malformed object). The gate keeps the high-frequency wire
 * quiet rather than emitting an all-zero frame.
 *
 * The whole `usage` object is forwarded raw — same as `cost_update`
 * does with `result.usage` — so the client reads whichever fields it
 * needs without tugcode taking a position on the shape.
 */
function streamingUsageFrame(
  msgId: string,
  usage: unknown,
): StreamingUsage | null {
  if (msgId.length === 0) return null;
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  if (!USAGE_TOKEN_KEYS.some((k) => typeof u[k] === "number")) return null;
  return { type: "streaming_usage", msg_id: msgId, usage: u, ipc_version: 2 };
}

/**
 * Map a single stream-json inner event (from stream_event wrapper) to IPC messages.
 * Exported for unit testing.
 */
export function mapStreamEvent(
  event: Record<string, unknown>,
  ctx: EventMappingContext,
  accumulatedPartialText: string
): EventMappingResult {
  const messages: OutboundMessage[] = [];
  let newRev = ctx.rev;
  let partialText = accumulatedPartialText;
  let gotResult = false;
  let messageId: string | undefined;
  let messageStartUsage: Record<string, unknown> | undefined;
  let messageDeltaUsage: Record<string, unknown> | undefined;

  const eventType = event.type as string | undefined;

  if (eventType === "message_start") {
    // claude reveals its message.id in the message_start frame BEFORE any
    // emit-bearing event for the message (content_block_start / _delta
    // land after). Surface it so dispatchEventToTurn can slide
    // ActiveTurn.currentMessageId to claude's id before any wire emit
    // for this message. Multi-message claude turns (text → tool_use →
    // tool_result → second text) trigger another `message_start` with a
    // fresh id; the slide simply overwrites — no rejection, no warning.
    const message = event.message as Record<string, unknown> | undefined;
    const rawId = message?.id;
    if (typeof rawId === "string" && rawId.length > 0) {
      messageId = rawId;
    }
    // Surface the message's opening `usage` snapshot so the client's
    // live token cells update the moment a message begins (the
    // input + cache figures are known here; `output` is a small
    // partial that the terminal `message_delta` finalizes).
    const startUsage = streamingUsageFrame(
      typeof rawId === "string" ? rawId : "",
      message?.usage,
    );
    if (startUsage) {
      messages.push(startUsage);
      // Latch the raw `usage` so the turn can fall back to the last
      // `message_start` when it produced no `message_delta` at all.
      messageStartUsage = startUsage.usage;
    }
  } else if (eventType === "message_delta") {
    // The terminal per-message frame: carries the message's final,
    // authoritative four-token `usage`. `ctx.msgId` is the current
    // message id, slid by this message's earlier `message_start`.
    const deltaUsage = streamingUsageFrame(ctx.msgId, event.usage);
    if (deltaUsage) {
      messages.push(deltaUsage);
      // Latch the raw `usage`: the most recent `message_delta` of the
      // turn is the last tool-loop iteration, and `dispatchEventToTurn`
      // emits it as `cost_update.usage` at the terminal `result`.
      messageDeltaUsage = deltaUsage.usage;
    }
  } else if (eventType === "content_block_start") {
    const contentBlock = event.content_block as Record<string, unknown> | undefined;
    if (contentBlock?.type === "tool_use") {
      messages.push({
        type: "tool_use",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        tool_name: (contentBlock.name as string) || "",
        tool_use_id: (contentBlock.id as string) || "",
        input: {},
        ipc_version: 2,
      });
    }
  } else if (eventType === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      partialText += delta.text;
      // LOAD-BEARING INVARIANT: the wire emit carries the delta only
      // (`text: delta.text`), not the cumulative `partialText`. Mid-turn
      // replay's "snapshot then resume" pattern depends on this:
      //
      //   1. emitInflightTurnFromActiveTurn writes one consolidated
      //      `assistant_text { text: turn.partialText, is_partial: false }`
      //      inside the bracket — the reducer REPLACES its scratch
      //      with that text.
      //   2. After replay_complete, live deltas resume here. The reducer
      //      APPENDS each `is_partial: true` delta to scratch from that
      //      baseline.
      //
      // If this branch ever switched to emitting cumulative text, the
      // first post-bracket delta would re-include the snapshot's text,
      // and the reducer's append would double-count. The mid-turn
      // integration test would catch the regression.
      messages.push({
        type: "assistant_text",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        rev: newRev++,
        text: delta.text,
        is_partial: true,
        status: "partial",
        ipc_version: 2,
      });
    } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
      // Per §14: thinking_delta has delta.thinking (NOT delta.text).
      const thinkingMsg: ThinkingText = {
        type: "thinking_text",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        text: delta.thinking,
        is_partial: true,
        status: "partial",
        ipc_version: 2,
      };
      messages.push(thinkingMsg);
    }
  } else if (eventType === "tool_use") {
    messages.push({
      type: "tool_use",
      msg_id: ctx.msgId,
      seq: ctx.seq,
      tool_name: event.name as string,
      tool_use_id: event.id as string,
      input: (event.input as object) || {},
      ipc_version: 2,
    });
  } else if (eventType === "tool_result" || eventType === "tool_progress") {
    messages.push({
      type: "tool_result",
      tool_use_id: (event.tool_use_id as string) || "",
      output: (event.output as string) || "",
      is_error: event.is_error === true,
      ipc_version: 2,
    });
  }

  return {
    messages,
    newRev,
    partialText,
    gotResult,
    messageId,
    messageStartUsage,
    messageDeltaUsage,
  };
}

// ---------------------------------------------------------------------------
// ActiveTurn — per-turn mutable state owned by handleUserMessage and
// dispatched-into by the stdout drain task (Step R1e).
// ---------------------------------------------------------------------------

/**
 * Per-turn state for a `handleUserMessage` invocation.
 *
 * Pre-R1e: these were local variables inside `handleUserMessage`'s
 * line-pulling `while (true)` loop. Post-R1e the loop is gone — the
 * stdout drain task reads claude's stdout continuously and dispatches
 * events into an `ActiveTurn` registered by `handleUserMessage`. The
 * turn's `completion` promise resolves when the drain sees
 * `turn_complete` (or claude's stdout closes). `handleUserMessage`
 * awaits that promise rather than pulling lines itself.
 *
 * Pure data + a Promise handle. No I/O. The drain mutates `rev`,
 * `partialText`, `gotResult`, `interrupted` as it processes lines;
 * `handleInterrupt` mutates `interrupted` directly when the user
 * cancels a turn in flight. Single-threaded JS event loop guarantees
 * mutation safety without locks.
 */
class ActiveTurn {
  /**
   * Sliding pointer to the most recent claude `message.id` seen on this
   * turn's stream. Updated on every `message_start` (via
   * `mapStreamEvent.messageId`) and on every top-level `assistant`
   * snapshot (via `routeTopLevelEvent.messageId`). Used by
   * `dispatchEventToTurn` to populate `msg_id` on frames whose claude
   * stream event doesn't carry one directly (`content_block_delta`,
   * `content_block_start`). `null` before claude's first id-bearing
   * event — degenerate-state emit sites
   * (`signalEofToActiveTurn`, `emitInflightTurnFromActiveTurn`)
   * treat null as "nothing claude-keyable to emit yet."
   *
   * Multi-message claude turns (text → tool_use → tool_result → second
   * text) overwrite this pointer on the second `message_start`. Each
   * `message.id` is its own thing on the wire; the reducer renders them
   * as separate panels keyed by id.
   */
  currentMessageId: string | null = null;
  /** Outbound `seq` for the user-message half of this turn. */
  readonly seq: number;
  /**
   * The user's prompt text, captured by `handleUserMessage` from the
   * inbound `UserMessage`. Source-of-truth for the in-flight turn's
   * `user_message_replay` payload during `runReplay`.
   */
  readonly userText: string;
  /**
   * Attachments captured by `handleUserMessage` from the inbound
   * `UserMessage`. Threaded through to the synthesized
   * `user_message_replay` so attachment-bearing turns reconstruct
   * faithfully on mid-turn replay. Empty array when the user submitted
   * plain text.
   */
  readonly userAttachments: ReadonlyArray<Attachment>;
  /** Streaming-text revision counter, bumped per stream-event delta. */
  rev: number = 0;
  /** Accumulated streaming text; emitted as a final `assistant_text` on `gotResult`. */
  partialText: string = "";
  /** True once the drain has seen claude's terminal `result` event for this turn. */
  gotResult: boolean = false;
  /**
   * The `usage` of the turn's most recent `message_delta` — the latest
   * tool-loop iteration. `dispatchEventToTurn` emits this as
   * `cost_update.usage` at the terminal `result` event. `null` until
   * the first `message_delta` lands. A fresh `ActiveTurn` per
   * `handleUserMessage` IS the per-turn reset.
   */
  lastMessageDeltaUsage: Record<string, unknown> | null = null;
  /**
   * The `usage` of the turn's most recent `message_start`. The
   * `cost_update.usage` fallback for a degenerate turn that produced no
   * `message_delta` at all (an interrupt before the first iteration's
   * terminal frame). `null` until the first `message_start` lands.
   */
  lastMessageStartUsage: Record<string, unknown> | null = null;
  /** True if `handleInterrupt` was invoked while this turn was active. */
  interrupted: boolean = false;
  /**
   * Set by `runReplay` when it adopts this turn for in-flight emission
   * (mid-turn replay design). While true, the per-turn `writeLine`
   * sites in `dispatchEventToTurn` and `signalEofToActiveTurn` skip
   * emission but continue to mutate state (`partialText` accumulates,
   * `gotResult`/`interrupted` latch, `finish()` still runs). Cleared
   * by `runReplay`'s `finally` after `replay_complete` is on the wire.
   *
   * Gated emit sites — five in dispatchEventToTurn, two in
   * signalEofToActiveTurn:
   *   1. dispatch: routeResult.messages forwarding
   *   2. dispatch: streamResult.messages forwarding (live deltas)
   *   3. dispatch: control_request_forward
   *   4. dispatch: final complete `assistant_text` on gotResult
   *   5. dispatch: `turn_complete` on gotResult
   *   6. EOF: `turn_cancelled` on interrupted
   *   7. EOF: `error` on unexpected stream end
   */
  suppressEmit: boolean = false;
  /** Resolves when the turn ends (either via `gotResult` or stdout EOF). */
  readonly completion: Promise<void>;
  private resolveCompletion: (() => void) | null;

  constructor(
    seq: number,
    userText: string,
    userAttachments: ReadonlyArray<Attachment>,
  ) {
    this.seq = seq;
    this.userText = userText;
    this.userAttachments = userAttachments;
    let resolve: () => void = () => {};
    this.completion = new Promise<void>((r) => {
      resolve = r;
    });
    this.resolveCompletion = resolve;
  }

  /**
   * Resolve {@link completion}. Idempotent — subsequent calls are
   * no-ops, so the EOF and `gotResult` paths can both call it without
   * coordinating.
   */
  finish(): void {
    if (this.resolveCompletion !== null) {
      this.resolveCompletion();
      this.resolveCompletion = null;
    }
  }
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

// The main spawn pipes stderr so it can be pattern-matched for failure
// classification; fork / continue inherit stderr because no
// classification is needed for those paths. Both share stdin/stdout
// "pipe", so the field accepts either stderr mode.
type ClaudeSubprocess =
  | Bun.Subprocess<"pipe", "pipe", "pipe">
  | Bun.Subprocess<"pipe", "pipe", "inherit">;

/**
 * Manages claude CLI process lifecycle, message identity, and streaming.
 * Spawns claude with --output-format stream-json --input-format stream-json
 * per D01/D02.
 */
export class SessionManager {
  private claudeProcess: ClaudeSubprocess | null = null;
  /**
   * Background task draining claude's stdout (Step R1e). Started by
   * {@link spawnClaudeAndWatch} (and the session-command handlers
   * after their respawn) and runs until claude's stdout EOFs. The
   * drain owns the only `getReader()` on `claudeProcess.stdout`;
   * nothing else may read claude's stdout directly. `null` between
   * spawn lifecycles.
   */
  private stdoutDrainTask: Promise<void> | null = null;
  /**
   * The currently-in-flight turn. Opened either by
   * {@link handleUserMessage} (the idle case — no turn running) or by
   * the stdout drain (a buffered follow-on turn — see
   * {@link handleClaudeLine}); closed by the drain when claude's
   * `result` lands or its stdout EOFs. The stdout drain dispatches
   * every parsed claude event into this field's value; when it's
   * `null`, events route through {@link handleInterTurnEvent} unless a
   * turn input is pending. Single-threaded JS guarantees the drain and
   * `handleUserMessage` see a consistent view without locks.
   */
  private activeTurn: ActiveTurn | null = null;
  /**
   * FIFO of user messages written to claude's stdin while a turn was
   * already in flight — submitted but not yet bracketed by an
   * `ActiveTurn`. claude buffers a mid-turn `user_message` and runs it
   * as a separate follow-on turn with its own `result`; the stdout
   * drain opens an `ActiveTurn` for that turn and claims the head of
   * this FIFO as the turn's user-message payload. Empty in the common,
   * non-overlapping case (one turn fully completes before the next
   * `handleUserMessage`), so the drain-open path in
   * {@link handleClaudeLine} is dormant in normal operation.
   *
   * Exception: when claude *merges* a mid-turn message into the
   * running turn — it does this at an agent-loop iteration boundary;
   * see `probe-tool-overlap.ts` — no follow-on turn is produced and
   * the merged message's entry is left stale here. tugcode cannot
   * distinguish merge from buffer at submit time (claude emits no
   * signal for it), so a stale entry mislabels at most one later
   * turn's replay-synthetic `user_message_replay` text; the wire
   * `turn_complete` bracketing is unaffected. Threading the user's
   * merge-vs-queue intent down from tugdeck is a follow-on concern.
   */
  private pendingTurnInputs: Array<{
    text: string;
    attachments: ReadonlyArray<Attachment>;
  }> = [];
  /**
   * True once the stdout drain has observed EOF on claude's stdout.
   * Read by {@link handleUserMessage} as a fast-path check before
   * installing an `ActiveTurn` — if claude's stdout has already
   * closed, no events will dispatch into the turn and the await on
   * its completion would block forever. The handler emits the
   * canonical end-of-stream error frame and returns instead. Reset
   * by {@link startStdoutDrain} when a fresh claude is spawned.
   */
  private claudeStdoutEofObserved: boolean = false;
  private permissionManager = new PermissionManager();
  /**
   * Optional `/context`-style breakdown emitter. Injected by main.ts
   * after reading the user's Claude Code settings; null in tests and
   * any caller that doesn't supply one. When present, the dispatcher
   * invokes its lifecycle methods on `system:init`, `result`
   * (cost_update), and `system:compact_boundary` events, and on every
   * inbound user message (for calibration anchor data).
   */
  private contextBreakdownEmitter: ContextBreakdownEmitter | null = null;
  private seq: number = 0;
  // Legacy pending maps kept for reference; control flow is now via control_response writes.
  private pendingApprovals = new Map<string, PendingRequest<"allow" | "deny">>();
  private pendingQuestions = new Map<string, PendingRequest<Record<string, string>>>();
  // Stores raw control_requests by request_id for correlation with IPC messages.
  private pendingControlRequests = new Map<string, Record<string, unknown>>();
  private projectDir: string;
  /**
   * The one identifier for this session. Generated by tugdeck (for a
   * fresh spawn) or picked from the tugbank `sessions` record (for a
   * resume), passed to tugcast on `spawn_session`, and forwarded to
   * tugcode via `--session-id`. Claude uses it as its own session id
   * (`claude --session-id <id>` for fresh, `claude --resume <id>` for
   * resume), and tugcode keys the sessions record by it.
   */
  private sessionId: string;
  /**
   * `"new"` spawns claude with `--session-id <id>` (claiming the id);
   * `"resume"` spawns claude with `--resume <id>` (loading an existing
   * conversation). Both modes share the same `initialize()` path; the
   * only mode-specific thing is the claude flag, plus a background
   * watcher that surfaces resume failures via `resume_failed` IPC.
   */
  private sessionMode: "new" | "resume";
  /**
   * The persisted claude session id, threaded in from tugcast via
   * `--resume-session <id>`. Set when tugcast's tugbank record carries
   * a `claude_session_id` for this card; `null` for fresh spawns and
   * for resume spawns whose claude id was never captured (pre-
   * `session_init` crash, or an older tugbank record).
   *
   * In resume mode, this id wins over `sessionId` for the claude
   * `--resume <id>` invocation: when claude has rotated its internal id
   * (e.g., after a fork) the JSONL on disk is keyed by the claude id,
   * not the tug id. The fallback to `sessionId` covers un-forked
   * sessions whose tug and claude ids happen to match.
   */
  private resumeSessionId: string | null;
  /**
   * Set true the first time `handleUserMessage` successfully writes a
   * user message to claude's stdin. After that, claude has been seen
   * alive end-to-end and any subsequent exit is a runtime crash, not
   * an init failure. The early-exit watcher gates its IPC emission on
   * this flag — without it, indefinite watching would mis-classify
   * mid-conversation crashes as init failures.
   */
  private claudeReceivedInput: boolean = false;
  /**
   * Set true when shutdown has begun (signal handler, stdin EOF,
   * killAndCleanup). The early-exit watcher reads this before emitting
   * to avoid surfacing a phantom resume_failed for a claude exit that
   * was caused by us killing it.
   */
  private isShuttingDown: boolean = false;
  /**
   * Definitive failure classification harvested from claude's stderr
   * stream by `startStderrReader`. Overrides the watcher's mode-based
   * heuristic so a `--session-id` collision in fresh mode and a stale
   * `--resume` id are always classified by their actual cause:
   *   `"resume_failed"` ← stderr contained "No conversation found"
   *   `"collision"`     ← stderr contained "is already in use"
   *   `null`            ← nothing recognizable; fall back to mode default
   */
  private claudeStderrClassification:
    | "resume_failed"
    | "collision"
    | null = null;
  /**
   * `true` while `runReplay` is iterating the JSONL bracket. Read by
   * `installEarlyExitWatcher` so a claude crash *during* replay is
   * surfaced through `runReplay`'s own crash branch (which emits
   * `replay_complete { claude_exited_during_replay }` first, then a
   * lifecycle `resume_failed`). Without this flag the watcher would
   * race the replay path and emit `resume_failed` while the card was
   * still in `replaying` phase.
   */
  private replayActive: boolean = false;
  /** Configurable JSONL archive root; defaults to ~/.claude/projects. */
  private claudeProjectsRoot: string;
  /** Configurable JSONL reader; default uses `Bun.file`. */
  private jsonlReader: (path: string) => Promise<JsonlReadResult>;
  /** Hard-timeout override (test hook). */
  private replayTimeoutMs: number;
  /** Live-buffer overflow threshold (test hook). */
  private replayLiveBufferMax: number;
  /** Replay telemetry sink forwarded into `translateJsonlSession`. */
  private replayTelemetry: ReplayTelemetry | undefined;
  /**
   * Read-only handle on tugcast's `sessions.db`. Opened once at
   * construction (so each `runReplay` call reuses one prepared statement
   * cache) and held for the lifetime of the manager. `null` when the
   * file doesn't exist yet (fresh install with no tugcast writes), when
   * the open fails for any reason, or when a test explicitly skips it
   * via the `sessionsDbPath: null` option. Production tugcast keeps the
   * file in WAL mode; cross-process WAL visibility is verified by
   * `sessions-db-cross-process.test.ts` and gates the rest of Step 4.6.
   */
  private sessionsDb: Database | null = null;
  /** Resolved path of `sessionsDb` for diagnostics; `null` if no DB. */
  private sessionsDbPath: string | null = null;
  /**
   * Promise that resolves once {@link spawnClaudeAndWatch} has
   * finished its synchronous setup (claude process handle assigned,
   * watchers installed). {@link handleUserMessage} awaits this before
   * any claude stdin write so a user submit that lands during the
   * cold-boot replay window — between `prepareSession()` and the
   * background `spawnClaudeAndWatch()` — blocks until claude is
   * ready, rather than throwing "Session not initialized".
   *
   * `null` until {@link prepareSession} or {@link spawnClaudeAndWatch}
   * sets it. New-mode `initialize()` resolves it eagerly inside the
   * spawn step (no preceding gate); resume-mode flows establish the
   * gate in `prepareSession()` and resolve it in
   * `spawnClaudeAndWatch()`.
   */
  private claudeReadyPromise: Promise<void> | null = null;
  private claudeReadyResolve: (() => void) | null = null;

  constructor(
    projectDir: string,
    sessionId: string,
    sessionMode: "new" | "resume" = "new",
    resumeSessionId?: string,
    options?: {
      claudeProjectsRoot?: string;
      jsonlReader?: (path: string) => Promise<JsonlReadResult>;
      replayTimeoutMs?: number;
      replayLiveBufferMax?: number;
      replayTelemetry?: ReplayTelemetry;
      /**
       * Override for the sessions.db path. Tests pass a tempfile so
       * they don't read the real user's database. Pass `null` to
       * explicitly skip opening any DB (cold-boot fallback paths
       * exercise this). Omit / undefined → use {@link defaultSessionsDbPath}.
       */
      sessionsDbPath?: string | null;
      /**
       * Pre-constructed context_breakdown emitter. main.ts builds it
       * once at startup (after reading settings.json) and threads it
       * here so the emitter knows the session id and the user's
       * autocompact preference. `null` / undefined → no
       * `context_breakdown` frames are produced; the popover hits its
       * 20.4.7.C fallback view. Tests omit it for backwards-compat.
       */
      contextBreakdownEmitter?: ContextBreakdownEmitter | null;
    },
  ) {
    if (!sessionId) {
      throw new Error("SessionManager: sessionId is required");
    }
    this.projectDir = projectDir;
    this.sessionId = sessionId;
    this.sessionMode = sessionMode;
    // Coerce `undefined` / empty string to `null` so the fallback
    // logic in `initialize()` has a single test (`!= null`) rather
    // than two (`!== undefined && !== ""`).
    this.resumeSessionId =
      typeof resumeSessionId === "string" && resumeSessionId.length > 0
        ? resumeSessionId
        : null;
    this.claudeProjectsRoot =
      options?.claudeProjectsRoot ?? DEFAULT_CLAUDE_PROJECTS_ROOT;
    this.jsonlReader = options?.jsonlReader ?? defaultJsonlReader;
    this.replayTimeoutMs = options?.replayTimeoutMs ?? REPLAY_HARD_TIMEOUT_MS;
    this.replayLiveBufferMax =
      options?.replayLiveBufferMax ?? REPLAY_LIVE_BUFFER_MAX;
    this.replayTelemetry = options?.replayTelemetry;
    this.contextBreakdownEmitter = options?.contextBreakdownEmitter ?? null;
    this.openSessionsDb(options?.sessionsDbPath);
  }

  /**
   * Try to open the sessions.db file read-only. Failure (file missing,
   * permission error, malformed) is logged but non-fatal: `runReplay`
   * falls back to JSONL-driven cold-boot when `sessionsDb === null`.
   * This preserves D08 equivalence for fresh installs / pre-migration
   * sessions and survives the case where tugcast hasn't yet been run.
   */
  private openSessionsDb(override: string | null | undefined): void {
    if (override === null) {
      // Explicit opt-out (test path that wants the no-DB cold-boot
      // fallback exercised).
      return;
    }
    const path = override ?? defaultSessionsDbPath();
    try {
      this.sessionsDb = new Database(path, { readonly: true });
      this.sessionsDbPath = path;
    } catch (err) {
      // File missing / unreadable: leave sessionsDb null. runReplay
      // checks `this.sessionsDb !== null` before any read.
      this.sessionsDb = null;
      this.sessionsDbPath = null;
      logReplay("sessions_db_unavailable", {
        session_id: this.sessionId,
        path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Close the sessions.db handle. The existing public `shutdown()`
   * already covers the claude-subprocess teardown; this private
   * helper wraps the read-only DB close so production teardown and
   * tests can call it without re-entering the subprocess kill path.
   */
  private closeSessionsDb(): void {
    if (this.sessionsDb !== null) {
      try {
        this.sessionsDb.close();
      } catch {
        // Already closed or never fully opened — no-op.
      }
      this.sessionsDb = null;
    }
  }

  private nextSeq(): number {
    return this.seq++;
  }

  /**
   * Spawn the claude CLI process with stream-json flags.
   *
   * `mode` picks between `--session-id <id>` (for a fresh spawn that
   * claims a tugdeck-generated UUID as claude's own session id) and
   * `--resume <id>` (for a resume of an existing conversation). `null`
   * lets claude generate its own session id — used by the fork/new
   * session handlers below.
   */
  private spawnClaude(
    id: string | null,
    mode: "session-id" | "resume",
  ): ClaudeSubprocess {
    const claudePath = Bun.which("claude");
    if (!claudePath) {
      throw new Error("claude CLI not found on PATH");
    }

    const args = buildClaudeArgs({
      pluginDir: this.getPluginDir(),
      permissionMode: this.permissionManager.getMode(),
      sessionId: mode === "resume" ? id : null,
      sessionIdOverride: mode === "session-id" && id !== null ? id : undefined,
    });

    console.log(`Spawning claude with args: ${args.join(" ")}`);
    logSessionLifecycle("tugcode.claude_spawn", {
      session_id: this.sessionId,
      mode,
      cwd: this.projectDir,
      args: args.join(" "),
    });

    // Scrub Anthropic auth env vars so the claude CLI authenticates via
    // `~/.claude.json` (the user's Max/Pro subscription) rather than
    // per-token API billing. Bun.spawn inherits the parent process
    // environment by default when `env` is omitted, so we must pass an
    // explicit env with these keys removed.
    //
    // Keep this list in sync with `AUTH_ENV_VARS` in
    // `tugrust/crates/tugcast/tests/common/catalog.rs` and the
    // `env_remove` calls in `tugrust/crates/tugcast/src/feeds/agent_bridge.rs`.
    const {
      ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN,
      CLAUDE_CODE_OAUTH_TOKEN,
      ...scrubbedEnv
    } = process.env as Record<string, string | undefined>;
    void ANTHROPIC_API_KEY;
    void ANTHROPIC_AUTH_TOKEN;
    void CLAUDE_CODE_OAUTH_TOKEN;

    return Bun.spawn([claudePath, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      // Pipe stderr (rather than inherit) so we can pattern-match
      // claude's diagnostic strings ("No conversation found", "already
      // in use") for definitive early-exit classification. The reader
      // forwards every line verbatim to process.stderr so tugcast's
      // tugcode_stderr capture continues to see exactly what claude
      // emitted — no observable behavior change for operators.
      stderr: "pipe",
      cwd: this.projectDir,
      env: scrubbedEnv,
    });
  }

  /**
   * Kill and clean up the current claude process gracefully.
   * Closes stdin (EOF) to signal the process to finish, waits up to 5s,
   * then force-kills if still running.
   */
  private async killAndCleanup(): Promise<void> {
    // Mark shutdown so the early-exit watcher ignores the exit code
    // from our kill rather than surfacing a phantom resume_failed.
    this.isShuttingDown = true;
    if (this.claudeProcess) {
      try {
        // Close stdin to signal EOF (graceful shutdown).
        this.claudeProcess.stdin.end();
        // Wait for process to exit or timeout after 5s.
        await Promise.race([
          this.claudeProcess.exited,
          new Promise<void>((res) => setTimeout(res, 5000)),
        ]);
      } catch {
        // Process may already be gone.
      }
      try {
        this.claudeProcess.kill();
      } catch {
        // Ignore if already terminated.
      }
      this.claudeProcess = null;
      // The drain task observes EOF on the closed stdout stream and
      // exits its loop; we don't need to cancel it explicitly. Reset
      // the handle so a subsequent respawn can start a fresh drain
      // without cross-contamination.
      this.stdoutDrainTask = null;
    }
  }

  /**
   * Pick the claude session id this session will spawn / resume
   * against. For new mode it's the tug session id. For resume mode
   * the persisted claude id wins (the two diverge after a fork; for
   * un-forked sessions they're equal, so the fallback to `sessionId`
   * is safe and preserves legacy behavior for older tugbank records).
   */
  private resolveClaudeId(): string {
    return this.sessionMode === "resume"
      ? (this.resumeSessionId ?? this.sessionId)
      : this.sessionId;
  }

  /**
   * Emit the synthesized `session_init` IPC line.
   *
   * The synthesized init carries the same id we'll spawn claude with
   * (`claudeId`), not always `this.sessionId`. For fresh spawns the
   * two are equal. For resume spawns whose claude id has diverged
   * from the tug id (forked session, or a resume of a session whose
   * claude id was already different), the distinction matters:
   * tugcast's `relay_session_io` atomic-promote block reads this id
   * and persists it as `LedgerEntry::claude_session_id`, so emitting
   * the wrong id here would briefly corrupt the on-disk record until
   * the real `system:init` from claude's stream-json arrives on the
   * first user message and overwrites it.
   */
  private writeSyntheticSessionInit(claudeId: string): void {
    writeLine({
      type: "session_init",
      session_id: claudeId,
      ipc_version: 2,
    });
  }

  /**
   * Resume-only: emit the synthetic `session_init` and arm the
   * `claudeReadyPromise` gate, all *before* claude has been spawned.
   * The cold-boot resume flow (Step R0d / R4) is:
   *
   *   1. `prepareSession()` — emit the init synchronously so tugcast
   *      sees the session as live and broadcasts `spawn_session_ok`;
   *      tugdeck constructs services and dispatches `request_replay`
   *      (Step R1c). The user sees the card open.
   *   2. `void spawnClaudeAndWatch()` — spawn claude in the
   *      background. The returned Promise resolves once the spawn
   *      handle is wired up; `handleUserMessage` awaits it. The
   *      stdout drain (Step R1e) starts here.
   *
   * The replay step is no longer in this list. Step R4 (Phase A-R4)
   * removed the direct `runReplay()` invocation from cold-boot:
   * replay is request-driven only, triggered by the `request_replay`
   * inbound verb. The supervisor queues the verb during the Spawning
   * window and drains it into tugcode's stdin during the same
   * critical section that promotes Spawning→Live, so replay arrives
   * at the same wire timing as the pre-collapse startup-replay path.
   *
   * Wire-semantic note. Pre-R0d, `spawn_session_ok` reaching tugdeck
   * meant "claude is alive on the other side". Post-R0d, it means
   * "tugcode has accepted ownership of this id, and claude is being
   * spawned in the background." The wire bytes are identical; only
   * the timing relative to the claude spawn changes. Future code
   * must not silently rely on `spawn_session_ok` as a "claude alive"
   * signal — use the `claudeReadyPromise` gate instead.
   *
   * Throws on `sessionMode === "new"`. New-mode spawns retain the
   * historical eager path through `initialize()`.
   */
  prepareSession(): void {
    if (this.sessionMode !== "resume") {
      throw new Error(
        "SessionManager.prepareSession(): resume-mode only; " +
          "new-mode callers should call initialize() directly.",
      );
    }
    const claudeId = this.resolveClaudeId();

    // Establish the readiness gate. handleUserMessage awaits it;
    // spawnClaudeAndWatch resolves it. Order:
    // prepareSession → runReplay → spawnClaudeAndWatch — and any
    // user_message that lands during replay is gated until claude
    // is ready instead of throwing "Session not initialized".
    this.claudeReadyPromise = new Promise<void>((resolve) => {
      this.claudeReadyResolve = resolve;
    });

    logSessionLifecycle("tugcode.prepare_session", {
      session_id: this.sessionId,
      claude_session_id: claudeId,
      session_mode: "resume",
    });

    this.writeSyntheticSessionInit(claudeId);
  }

  /**
   * Spawn claude with `--session-id` (new mode) or `--resume` (resume
   * mode), wire up the stdout reader, and install the stderr reader
   * + early-exit watcher. Resolves the `claudeReadyPromise` so any
   * subsequent `handleUserMessage` may proceed.
   *
   * Used by both modes. New mode calls this from `initialize()`
   * (eager). Resume mode (Step R0d) calls it directly from `main.ts`
   * after `runReplay()` so claude's 5–10s binary load happens in the
   * background while the user is already looking at the populated
   * transcript.
   *
   * Failure-detection posture (post-R1d):
   *
   * The early-exit watcher (`installEarlyExitWatcher`) catches the
   * common cases — claude exits during init for any reason (stale
   * `--resume` id, `--session-id` collision, missing binary, immediate
   * crash) — by pattern-matching claude's stderr and surfacing
   * `resume_failed`. That is the only observable "claude failed"
   * signal tugcode has at startup.
   *
   * R0d originally introduced a 30s spawn-watchdog timer on top of
   * the watcher to catch a "claude is hung silently — running but
   * unresponsive" failure mode. That timer was removed in
   * [Step R1d](roadmap/tugplan-tide-transcript-resume.md#step-r1d):
   * the proxy it used (`claudeReceivedInput`) only flips on user
   * input, so its actual semantic was "user idle for 30s," not
   * "claude is hung." Smoke B exposed this — Developer>Reload doesn't
   * trigger a `user_message`, the timer fired regardless of claude's
   * health, and a healthy claude got killed at the 30-second mark.
   *
   * The trade-off the removal accepts: a genuinely-hung claude
   * (running but never emits, never exits) leaves the user with a
   * populated transcript that doesn't react to the first submit.
   * That failure mode is rare; the user's recourse is to close the
   * card and reopen. The false-positive on user idle was the larger
   * cost. Empirically (kept from the pre-R0d notes): claude in
   * stream-json mode does NOT emit `system:init` until it receives
   * input, regardless of mode — so absence-of-stdout is
   * indistinguishable from absence-of-input, and there is no
   * observable signal we could plumb that would distinguish "hung"
   * from "idle" without sending a probe.
   */
  spawnClaudeAndWatch(): Promise<void> {
    const claudeFlag = this.sessionMode === "resume" ? "resume" : "session-id";
    const claudeId = this.resolveClaudeId();

    this.claudeProcess = this.spawnClaude(claudeId, claudeFlag);
    this.startStdoutDrain(this.claudeProcess);
    this.startStderrReader();
    this.installEarlyExitWatcher();

    logSessionLifecycle("tugcode.spawn_claude_async", {
      session_id: this.sessionId,
      session_mode: this.sessionMode,
      claude_session_id: claudeId,
    });

    // Resolve (or freshly satisfy) the readiness gate. If
    // `prepareSession()` set it up, callers awaiting on it can now
    // proceed. Otherwise we install an already-resolved promise so
    // `handleUserMessage`'s `await` is a clean no-op for the
    // new-mode `initialize()` path.
    if (this.claudeReadyResolve !== null) {
      this.claudeReadyResolve();
      this.claudeReadyResolve = null;
    } else {
      this.claudeReadyPromise = Promise.resolve();
    }

    return this.claudeReadyPromise!;
  }

  /**
   * Initialize session — single entry point for new mode and the
   * legacy (eager) resume path.
   *
   * Resume mode (cold-boot, Step R0d / R4): `main.ts` does NOT call
   * `initialize()`; it calls `prepareSession()` →
   * `void spawnClaudeAndWatch()` so the claude spawn runs in the
   * background while tugdeck dispatches the `request_replay` verb
   * (Step R1c) that — queued during Spawning, drained on
   * Spawning→Live (Step R4) — drives the actual replay. `initialize()`
   * remains for non-cold-boot callers (and tests that don't care to
   * exercise the cold-boot order); for resume mode it composes
   * `prepareSession()` + `await spawnClaudeAndWatch()`. It does NOT
   * invoke `runReplay()` itself; replay is request-driven only
   * post-R4.
   *
   * New mode: spawns claude eagerly via `spawnClaudeAndWatch()`,
   * then emits the synthetic `session_init`. Same wire shape as
   * pre-R0d.
   *
   * The empirical "claude doesn't emit system:init until input
   * arrives" fact, plus the early-exit watcher's stderr pattern-
   * matching, is documented on `spawnClaudeAndWatch`.
   */
  async initialize(): Promise<void> {
    const inputSessionId = this.sessionId;
    const inputMode = this.sessionMode;
    logSessionLifecycle("tugcode.init.start", {
      session_id: inputSessionId,
      session_mode: inputMode,
      resume_session_id: this.resumeSessionId ?? "",
    });

    if (this.sessionMode === "resume") {
      // Legacy / non-cold-boot order: synthesize the init, then spawn
      // claude eagerly. Bytes-identical to the pre-R0d wire shape;
      // tests that prime via `initialize()` continue to see the same
      // observable outcome.
      this.prepareSession();
      await this.spawnClaudeAndWatch();
    } else {
      // New mode: spawn first, then synthesize the init. Order
      // matches the pre-R0d code; the only refactor here is the
      // helper extraction.
      await this.spawnClaudeAndWatch();
      this.writeSyntheticSessionInit(this.resolveClaudeId());
      // Emit the `context_breakdown` immediately — claude stays silent
      // (no `system:init`) until the first input, so the static
      // estimate is computed from disk so the Context surface is
      // populated the moment the session opens.
      this.emitInitialContextBreakdown();
    }

    const claudeId = this.resolveClaudeId();
    logSessionLifecycle("tugcode.init.end", {
      session_mode: inputMode,
      session_id_in: inputSessionId,
      session_id_out: claudeId,
      fallback_taken: false,
    });
  }

  /**
   * Read claude's stderr line-by-line, forward each line verbatim to
   * `process.stderr` (preserving the existing tugcast::tugcode_stderr
   * capture), and pattern-match the first line carrying a known
   * failure signature into `claudeStderrClassification`. Returns
   * immediately if stderr is not available; runs as a detached task
   * for the lifetime of the claude subprocess.
   */
  private startStderrReader(): void {
    const stderr = this.claudeProcess?.stderr;
    if (!stderr) return;
    const stream = stderr as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    void (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) {
            if (buffer.length > 0) process.stderr.write(buffer);
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          let lineEnd = buffer.indexOf("\n");
          while (lineEnd >= 0) {
            const line = buffer.slice(0, lineEnd);
            buffer = buffer.slice(lineEnd + 1);
            // Forward verbatim so tugcast::tugcode_stderr keeps seeing
            // exactly what claude wrote — operator visibility unchanged.
            process.stderr.write(line + "\n");
            // First-match-wins classification. Subsequent lines from
            // the same stderr stream don't override; the failure cause
            // is whatever claude reported first.
            if (this.claudeStderrClassification === null) {
              if (line.includes("No conversation found with session ID")) {
                this.claudeStderrClassification = "resume_failed";
              } else if (line.includes("is already in use")) {
                this.claudeStderrClassification = "collision";
              }
            }
            lineEnd = buffer.indexOf("\n");
          }
        }
      } catch (err) {
        process.stderr.write(`[tugcode] stderr reader error: ${err}\n`);
      }
    })();
  }

  /**
   * Watch claude's exit indefinitely. The watcher only emits IPC if
   * claude exits AND none of these guards apply:
   *
   *   - `isShuttingDown`: we initiated the kill (signal, stdin EOF,
   *     close); a phantom resume_failed for a user-driven close would
   *     reach the bridge after the card is already gone.
   *   - `claudeReceivedInput`: claude has been seen alive end-to-end
   *     (it accepted at least one user message). A subsequent exit
   *     is a runtime crash, not an init failure — the existing
   *     handleUserMessage stream-end path classifies it.
   *
   * When emitting, the failure mode is taken from
   * `claudeStderrClassification` (definitive, harvested from stderr
   * by `startStderrReader`) and falls back to the session mode only
   * when stderr carried nothing recognizable.
   */
  private installEarlyExitWatcher(): void {
    if (!this.claudeProcess) return;
    const child = this.claudeProcess;
    const sessionId = this.sessionId;
    const sessionMode = this.sessionMode;

    void child.exited.then(async (code) => {
      if (this.isShuttingDown) return;
      if (this.claudeReceivedInput) return;
      if (this.replayActive) {
        // `runReplay` watches `child.exited` itself: it surfaces the
        // crash via `replay_complete { claude_exited_during_replay }`
        // first, then emits the lifecycle `resume_failed`. Letting the
        // watcher run in parallel would race that ordering and leave
        // the card stuck in `replaying` phase.
        return;
      }

      // Definitive classification wins; mode is the fallback.
      const classification = this.claudeStderrClassification;
      const isResumeFailure =
        classification === "resume_failed" ||
        (classification === null && sessionMode === "resume");
      const isCollision = classification === "collision";

      if (isResumeFailure) {
        const reason =
          classification === "resume_failed"
            ? `claude reported "No conversation found" (stale --resume id)`
            : `claude exited with code ${code} during resume init (likely stale id)`;
        logSessionLifecycle("tugcode.resume_failed", {
          stale_session_id: sessionId,
          reason,
          exit_code: code,
          classification: classification ?? "mode_default",
        });
        await writeLineAndExit(
          {
            type: "resume_failed",
            reason,
            stale_session_id: sessionId,
            ipc_version: 2,
          },
          0,
        );
      } else {
        const reason = isCollision
          ? `claude reported session id "${sessionId}" is already in use`
          : `claude exited with code ${code} during fresh init`;
        await writeLineAndExit(
          {
            type: "error",
            message: reason,
            recoverable: false,
            ipc_version: 2,
          },
          0,
        );
      }
    });
  }

  /**
   * Read the JSONL archive for the resumed session and stream its
   * translated events to IPC stdout, bracketed by `replay_started` /
   * `replay_complete`. Runs only in resume mode.
   *
   * **Trigger** (post-Step R4 / Phase A-R4): `request_replay` inbound
   * verb only. The verb is dispatched by tugdeck's
   * `cardServicesStore` whenever fresh services are constructed for
   * a resume binding (cold boot, HMR, Developer > Reload), forwarded
   * by tugcast's supervisor through tugcode's stdin via the existing
   * CODE_INPUT path, and dispatched to this method by tugcode's IPC
   * loop (`main.ts` `isRequestReplay` branch). The supervisor queues
   * the verb during the Spawning window and drains it on
   * Spawning→Live promotion, so cold-boot replay arrives at the same
   * wire timing as the pre-collapse startup-replay path.
   *
   * The legacy direct invocation from `main.ts` and `initialize()`
   * was removed in [Step R4](roadmap/tugplan-tide-transcript-resume.md#step-r4)
   * to eliminate dual replay-trigger paths. The `replayActive`
   * re-entrancy guard remains as defense-in-depth: a future caller
   * that reintroduces overlap is dropped at the entry rather than
   * producing interleaved replay output on IPC stdout.
   *
   * Concurrency model. The replay iterator is awaited sequentially
   * with a race against:
   *   - a hard-budget timer (`replayTimeoutMs`, default 10s),
   *   - claude's exit (`claudeProcess.exited`).
   *
   * On natural completion the iterator emits its own
   * `replay_complete` (success, or `jsonl_malformed` when individual
   * lines failed to parse). We just write each yielded
   * `OutboundMessage` in turn.
   *
   * On timeout we abandon the iterator, emit our own
   * `replay_complete { replay_timeout }`, and return. The JSONL was
   * readable but didn't finish in time; claude is still alive on the
   * other side and live forwarding takes over via the stdout drain
   * (Step R1e) once handleUserMessage runs.
   *
   * On a claude crash *during* replay we emit
   * `replay_complete { jsonl_unreadable: claude_exited_during_replay }`
   * so the card transitions out of `replaying` cleanly, then surface
   * the subprocess loss through the existing `resume_failed` path and
   * exit.
   *
   * Live-buffer note. While replay runs, claude's stdout sits in the
   * OS pipe (~64 KB on Linux/macOS). claude on `--resume` with no
   * user input is essentially silent — a `system:init` plus
   * occasional keep-alives — so the pipe is well within bounds. The
   * hard timeout is the ultimate guard against a pathologically
   * chatty claude. {@link REPLAY_LIVE_BUFFER_MAX} stays available as
   * a documented threshold; it is not load-bearing post-R1e.
   */
  async runReplay(): Promise<void> {
    // Pre-Step-5 the early-return `if (this.sessionMode !== "resume") return;`
    // gated runReplay by the original spawn mode. That assumption (mode=new
    // ⇒ no JSONL to replay) holds at the moment of spawn but rots once the
    // session has had wire activity. After the first turn lands, any
    // request_replay against the same session — sent from tugdeck on
    // `Developer > Reload` / HMR / card remount — needs the JSONL pass to
    // rehydrate the freshly-mounted CodeSessionStore. The mid-turn-replay
    // [Step 5](roadmap/tugplan-tide-mid-turn-replay.md#step-5) close-out
    // smoke surfaced this: open new card, type "hello", get response,
    // Developer > Reload → empty window because both tugdeck's
    // `binding.sessionMode === "resume"` gate (also dropped) and this
    // early-return swallowed the rebind's request_replay. Dropping both
    // gates makes runReplay always-on; for a truly fresh new session whose
    // JSONL doesn't exist yet, the translator emits
    // `replay_started → replay_complete{kind: "jsonl_missing"}` and the
    // reducer flashes through `replaying` to `idle`. Harmless.

    // Re-entrancy guard for the request_replay verb (Phase A-R1 /
    // [D12]). Cold-boot replay and request-driven replay share this
    // method. If a request lands while a replay is already in flight,
    // drop it: the in-flight bracket's events satisfy the request, and
    // overlapping output would interleave on IPC stdout, producing
    // out-of-order frames that violate L23 (user-visible state
    // preservation) at tugdeck.
    if (this.replayActive) {
      logReplay("request_dropped", {
        session_id: this.sessionId,
        reason: "replay_in_flight",
      });
      return;
    }
    // Step R0d cold-boot order calls runReplay before claude has been
    // spawned — `claudeProcess` is null and the JSONL is read straight
    // from disk. The Phase A-R1 request_replay path runs against an
    // already-live claude. Whether `claudeProcess` exists determines
    // only whether we race the JSONL iterator against `child.exited`;
    // both flows still use the hard-budget timer.
    const claudeSessionId = this.resumeSessionId ?? this.sessionId;

    // Mark replay active *before* the first await so a claude crash
    // during the JSONL read can't slip past the early-exit watcher
    // and emit a stray `resume_failed` while we're still mid-replay.
    // The crash branch below picks up `child.exited` via the loop's
    // race promise and surfaces it through the canonical
    // `replay_complete { claude_exited_during_replay }` then
    // `resume_failed` order.
    this.replayActive = true;

    // Resolve symlinks on `projectDir` so the encoded form matches
    // the encoding claude itself uses when writing the per-session
    // JSONL. Claude canonicalizes its cwd internally (getcwd()
    // returns the resolved path), so its on-disk directory is named
    // after the canonical absolute path. Without this resolve step,
    // a project the user reaches via symlink (e.g.
    // `/u/src/tugtool` → `/Users/<u>/Mounts/u/src/tugtool`)
    // produces an `encodeProjectDir(...)` form that has no directory
    // under `~/.claude/projects/`, and `runReplay` fires
    // `replay_complete{jsonl_missing}` for what's actually a
    // populated session — the cold-boot Smoke C failure mode
    // surfaced in [Step R0b]. The fallback to the raw path is safe:
    // if the directory doesn't exist (test fixtures, edge cases),
    // `jsonlReader` reports `kind: "missing"` downstream, which is
    // the same behavior the raw form already produces.
    let canonicalProjectDir = this.projectDir;
    try {
      canonicalProjectDir = await realpath(this.projectDir);
    } catch {
      // Path doesn't resolve (test fixture, deleted dir, etc.).
      // Keep the raw form; downstream reader reports missing.
    }
    if (canonicalProjectDir !== this.projectDir) {
      logReplay("path_canonicalized", {
        session_id: this.sessionId,
        raw: this.projectDir,
        canonical: canonicalProjectDir,
      });
    }
    const jsonlPath = jsonlPathFor(
      this.claudeProjectsRoot,
      canonicalProjectDir,
      claudeSessionId,
    );

    logReplay("started", {
      session_id: this.sessionId,
      claude_session_id: claudeSessionId,
      jsonl_path: jsonlPath,
    });

    const startedAt = Date.now();
    const rawInput = await this.jsonlReader(jsonlPath);
    // Thread the claude session id into the replay input so the
    // synthesized `system_metadata` IPC at the top of replay carries
    // the right session_id field. Only the `ok` variant carries
    // payload; missing/unreadable variants pass through unchanged.
    const input: ReplayInput = rawInput.kind === "ok"
      ? { ...rawInput, claudeSessionId }
      : rawInput;

    // Exit race only applies when claude is alive. In Step R0d's
    // cold-boot order, claude hasn't been spawned yet — there's
    // nothing to crash. In the future request_replay path (Phase
    // A-R1), claude IS alive and a crash mid-replay must surface as
    // `replay_complete{claude_exited_during_replay}` followed by
    // `resume_failed`. Skipping this branch when there's no process
    // keeps `Promise.race` total without inventing a never-resolving
    // exit promise.
    const child = this.claudeProcess;
    const exitPromise: Promise<{ kind: "exit"; code: number | null }> | null =
      child !== null
        ? child.exited.then((code) => ({
            kind: "exit" as const,
            code: typeof code === "number" ? code : null,
          }))
        : null;

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
      timeoutHandle = setTimeout(
        () => resolve({ kind: "timeout" }),
        this.replayTimeoutMs,
      );
    });

    // Snapshot the active turn at entry. Only adopt it as in-flight
    // when the drain hasn't yet observed its terminal event — a
    // turn that already latched gotResult/interrupted is "done" from
    // tugcode's perspective and the translator's path handles it
    // (or the orphan synthesis does, when ids don't match).
    //
    // Setting suppressEmit BEFORE the first translator yield is
    // load-bearing: live deltas dispatched by the drain in parallel
    // would otherwise interleave with replay events on the wire.
    // The window stays open through the buffered replay_complete
    // emission below; the finally clears it.
    const inflight = (
      this.activeTurn !== null &&
      !this.activeTurn.gotResult &&
      !this.activeTurn.interrupted
    ) ? this.activeTurn : null;
    if (inflight !== null) {
      inflight.suppressEmit = true;
    }

    // JSONL-driven replay (the only path post-Step-5.4). The
    // translator emits `replay_started` → committed-turn frames →
    // `replay_complete`, raced against the exit + timeout promises.
    // The trailing in-flight turn's predicate is the
    // [Step 5.5](roadmap/tugplan-tide-mid-turn-replay.md#step-5-5)
    // territory; this substep restores the pre-Step-4 translator-driven
    // shape unchanged. The journal-driven pending-row injection lands
    // in [Step 5.6](roadmap/tugplan-tide-mid-turn-replay.md#step-5-6),
    // wrapping this path with a pre-pass over `sessions.db`.
    let count = 0;
    let lastProgressPosted = 0;
    const progressBatch = 16;
    let aborted:
      | { kind: "timeout" }
      | { kind: "exit"; code: number | null }
      | null = null;
    // The translator yields `replay_complete` BEFORE returning. Buffer
    // the bracket-close so we can write it last after the loop, in case
    // a future caller (Step 5.6's pending-row injection) wants to add
    // post-iteration work between the last committed-turn frame and the
    // bracket-closing event.
    let bufferedReplayComplete: OutboundMessage | null = null;
    // Step 5.6: pending-row synthetics inject between replay_started
    // and the next translator emit, ONCE per replay. Tracked via this
    // flag so the loop body fires the injection on the first
    // `replay_started` it forwards and skips it on every subsequent
    // event.
    let pendingRowSyntheticsInjected = false;

    const iter = translateJsonlSession(input, {
      telemetry: this.replayTelemetry,
      // A cycle left open at end-of-JSONL has no live `ActiveTurn` to
      // continue it on a cold resume (`inflight === null`) — ask the
      // translator to synthesize its terminal `turn_complete` so the
      // dangling turn commits instead of stranding an in-flight row
      // ([replay-1]). When `inflight !== null` this IS a live turn
      // still streaming (reload-mid-stream); leave it for the live
      // drain + `emitInflightTurnFromActiveTurn` as before.
      synthesizeDanglingTerminal: inflight === null,
    });

    try {
      while (true) {
        const nextPromise = iter
          .next()
          .then((r) => ({ kind: "next" as const, value: r }));
        const racers: Array<
          Promise<
            | { kind: "next"; value: IteratorResult<OutboundMessage, { count: number }> }
            | { kind: "timeout" }
            | { kind: "exit"; code: number | null }
          >
        > = [nextPromise, timeoutPromise];
        if (exitPromise !== null) racers.push(exitPromise);
        const winner = await Promise.race(racers);

        if (winner.kind === "next") {
          if (winner.value.done) {
            // Generator returned. The cold-boot path doesn't read
            // the return value — count tracking happens via the
            // streamed `replay_complete` message.
            break;
          }
          const msg = winner.value.value;
          if (msg.type === "turn_complete") {
            count++;
            if (count - lastProgressPosted >= progressBatch) {
              logReplay("progress", {
                session_id: this.sessionId,
                count,
              });
              lastProgressPosted = count;
            }
          }
          if (msg.type === "replay_complete") {
            // Buffer it; the bracket-close emits last after any
            // post-iteration synthetics (Step 5.6 injects before the
            // first translator yield, so by `replay_complete` the
            // synthetics have already landed).
            if (typeof msg.count === "number") count = msg.count;
            bufferedReplayComplete = msg;
            continue;
          }
          writeLine(msg);
          // Step 5.6 — pending-row replay. The translator's first
          // emit is `replay_started`; we inject synthetic
          // `user_message_replay` frames for journal rows whose
          // `user_text` is not in JSONL right after the bracket
          // opens. The synthetics land in `phase: replaying` (the
          // reducer's handleUserMessageReplay phase guard) so the
          // user's pending submissions render before the JSONL pass
          // emits anything else. See `injectPendingRowSynthetics` for
          // the design notes.
          if (msg.type === "replay_started" && !pendingRowSyntheticsInjected) {
            pendingRowSyntheticsInjected = true;
            this.injectPendingRowSynthetics(input);
          }
        } else {
          aborted = winner;
          break;
        }
      }

      // After the JSONL pass and before the bracket-close: emit the
      // in-flight turn's snapshot from `ActiveTurn` state. This is the
      // only path that delivers claude's pre-HMR streaming content
      // (`turn.partialText` + tool state) to a freshly-connected
      // client. The CODE_OUTPUT broadcast doesn't backfill new
      // subscribers (LagPolicy::Replay only triggers on lag overflow,
      // not on initial subscription); the JSONL only contains
      // committed turns; the Step 5.6 synthetic delivers the
      // user-side echo only. Without this snapshot, the new client
      // sees a `pendingUserMessage` with no scratch — post-bracket
      // deltas land into a fresh empty scratch and the user sees
      // only the tail of the response, missing the head.
      //
      // The snapshot keys on `turn.currentMessageId` (claude's most
      // recent `message.id` for the turn). It writes one consolidated
      // `assistant_text { is_partial: false }` that the reducer
      // REPLACES into its scratch; subsequent live deltas (post-
      // suppression) carry `is_partial: true` and append from that
      // baseline. If the turn's terminal already latched while
      // suppressed (`gotResult` / `interrupted`), the snapshot also
      // synthesizes the corresponding `turn_complete` /
      // `turn_cancelled` so the bracket delivers a complete
      // TurnEntry.
      if (inflight !== null) {
        this.emitInflightTurnFromActiveTurn(inflight);
      }

      // After clean iterator completion (no abort): emit the buffered
      // replay_complete to close the bracket.
      if (aborted === null && bufferedReplayComplete !== null) {
        writeLine(bufferedReplayComplete);
      }
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      this.replayActive = false;
      // Clear suppressEmit AFTER replay_complete is on the wire so
      // post-suppression live deltas land outside the bracket and
      // observe the reducer's idle/streaming phase, not replaying.
      if (inflight !== null) {
        inflight.suppressEmit = false;
      }
      try {
        await iter.return?.({ count: 0 });
      } catch {
        // generator already finished or threw — nothing to clean up.
      }
    }

    const elapsedMs = Date.now() - startedAt;

    if (aborted?.kind === "timeout") {
      const complete: ReplayComplete = {
        type: "replay_complete",
        count,
        error: {
          kind: "replay_timeout",
          message: `replay exceeded ${this.replayTimeoutMs}ms budget`,
        },
        ipc_version: 2,
      };
      writeLine(complete);
      logReplay("error", {
        session_id: this.sessionId,
        kind: "replay_timeout",
        count,
        elapsed_ms: elapsedMs,
      });
      return;
    }

    if (aborted?.kind === "exit") {
      const complete: ReplayComplete = {
        type: "replay_complete",
        count,
        error: {
          kind: "jsonl_unreadable",
          message: "claude_exited_during_replay",
        },
        ipc_version: 2,
      };
      writeLine(complete);
      logReplay("error", {
        session_id: this.sessionId,
        kind: "claude_exited_during_replay",
        count,
        exit_code: aborted.code,
      });
      // Surface the subprocess loss through the existing lifecycle
      // path so the card unbinds with the canonical resume-failure
      // shape. `claudeStderrClassification` may already be set if
      // claude wrote a recognizable diagnostic before exiting.
      const classification = this.claudeStderrClassification;
      const reason =
        classification === "resume_failed"
          ? `claude reported "No conversation found" (stale --resume id)`
          : `claude exited with code ${aborted.code} during replay`;
      logSessionLifecycle("tugcode.resume_failed", {
        stale_session_id: this.sessionId,
        reason,
        exit_code: aborted.code,
        classification: classification ?? "replay_crash",
      });
      await writeLineAndExit(
        {
          type: "resume_failed",
          reason,
          stale_session_id: this.sessionId,
          ipc_version: 2,
        },
        0,
      );
      return;
    }

    logReplay("complete", {
      session_id: this.sessionId,
      count,
      elapsed_ms: elapsedMs,
    });
  }

  /**
   * Pull the submission journal's pending rows for this session via
   * the cross-process bun:sqlite handle. Read-only; the supervisor's
   * `dispatch_one` intercept owns inserts and the merger's
   * `apply_outbound_turn_intercept` owns FIFO deletes — tugcode never
   * writes here. Returns `[]` when the DB handle is unavailable
   * (file missing at construction, opted-out by tests) or the read
   * fails (corruption, schema mismatch); the caller treats either as
   * "no pending rows to surface" so a sqlite hiccup doesn't block
   * the user-visible JSONL replay.
   *
   * Mid-turn-replay [Step 5.6](roadmap/tugplan-tide-mid-turn-replay.md#step-5-6).
   */
  private readPendingTurnsForSession(): JournalRow[] {
    if (this.sessionsDb === null) return [];
    try {
      const stmt = this.sessionsDb.query<JournalRow, [string]>(
        `SELECT journal_id, session_id, user_text, user_attachments, created_at
         FROM turns
         WHERE session_id = ?
         ORDER BY created_at ASC, journal_id ASC`,
      );
      return stmt.all(this.sessionId);
    } catch (err) {
      logReplay("sessions_db_read_error", {
        session_id: this.sessionId,
        reason: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Decode the BLOB-encoded `user_attachments` JSON array into the
   * `Attachment[]` shape the wire `user_message_replay` carries. A
   * malformed BLOB (shouldn't happen under tugcast's writer; pinned
   * defensively) yields an empty array so the synthetic emit's user
   * side still surfaces.
   */
  private decodeUserAttachmentsBlob(blob: Buffer | Uint8Array): Attachment[] {
    try {
      const text = Buffer.from(blob).toString("utf8");
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed as Attachment[];
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Pre-translator pass for the never-drop guarantee
   * (mid-turn-replay [Step 5.6](roadmap/tugplan-tide-mid-turn-replay.md#step-5-6)
   * — the load-bearing implementation of [DM08]).
   *
   * For each pending journal row whose `user_text` does not appear as
   * a `user_message` line in the JSONL, emit a synthetic
   * `user_message_replay` frame. The synthetic carries the journal id
   * as `msg_id` (a TEMPORARY KEY for the reducer's
   * `pendingUserMessage` slot) and the row's user_text + attachments.
   *
   * **Why no terminal event for the synthetic.** The pending row by
   * definition has no claude response yet — there is no scratch
   * content and no claude message id. Emitting a `turn_complete`
   * here would commit an empty assistant TurnEntry. Withholding the
   * terminal leaves `pendingUserMessage` populated; when the live
   * drain produces the response post-replay (claude --resume
   * continues), the first response frame's claude `message.id`
   * becomes `activeMsgId` and the eventual live `turn_complete`
   * commits a proper TurnEntry whose `userMessage` text comes from
   * `pendingUserMessage` — the journal id is a temporary key for the
   * reducer's state during the gap.
   *
   * **Why the synthetic emits BEFORE the JSONL pass.** Per
   * [DM08]'s implications and the plan's "synthetic injection happens
   * inside the `replay_started` / `replay_complete` bracket (between
   * `replay_started` emit and the first translator emit)" — the
   * synthetic emits at the start of the bracket so it arrives in
   * `phase: replaying` (the reducer's
   * [`handleUserMessageReplay`] phase guard) and, when the JSONL is
   * empty (cold-boot of a fresh session whose only state is the
   * pending journal row), the synthetic's `pendingUserMessage`
   * survives until the live drain consumes it.
   *
   * **Acknowledged residual gap (a):** when JSONL has committed
   * turns OR an in-flight trailing turn AND the journal also has
   * unmatched pending rows, the JSONL pass's
   * `user_message_replay` frames overwrite the synthetic's
   * `pendingUserMessage`. Confirmed-acceptable 2026-05-05; the
   * messages remain durably stored, render fully when claude
   * responds (in the common single-pending case), and the merger's
   * FIFO deletion keeps the journal coherent.
   */
  private injectPendingRowSynthetics(input: ReplayInput): void {
    const pendingRows = this.readPendingTurnsForSession();
    if (pendingRows.length === 0) return;

    const jsonl = input.kind === "ok" ? input.jsonl : "";
    const userMessageCounts = extractUserMessageTextCounts(jsonl);

    for (const row of pendingRows) {
      const remaining = userMessageCounts.get(row.user_text) ?? 0;
      if (remaining > 0) {
        // The submission appears in JSONL — claude has acknowledged
        // it; the JSONL pass will emit the corresponding
        // `user_message_replay`. Decrement so a duplicate-text
        // submission later in the journal correctly accounts for
        // multiple JSONL matches.
        userMessageCounts.set(row.user_text, remaining - 1);
        continue;
      }
      const attachments = this.decodeUserAttachmentsBlob(row.user_attachments);
      writeLine({
        type: "user_message_replay",
        msg_id: row.journal_id,
        text: row.user_text,
        attachments,
        ipc_version: 2,
      });
      logReplay("pending_row_synthetic_emit", {
        session_id: this.sessionId,
        journal_id: row.journal_id,
      });
    }
  }

  /**
   * Start a long-lived stdout drain task on the given claude process
   * (Step R1e). The drain reads claude's stdout line-by-line until
   * EOF, parses each line as JSON, and dispatches it via
   * {@link handleClaudeLine}. On EOF, signals the active turn (if
   * any) before exiting.
   *
   * Single-owner invariant: nothing else in this class may call
   * `getReader()` on `claudeProcess.stdout`. The drain is the only
   * reader for claude's stdout for the lifetime of `claudeProcess`.
   */
  private startStdoutDrain(claudeProcess: ClaudeSubprocess): void {
    // Reset the EOF flag — a fresh claude means a fresh stdout
    // stream that hasn't EOF'd yet. Without this reset, a respawn
    // (fork / continue / new) after a prior EOF would leave
    // handleUserMessage on the fast-path "claude is dead" branch
    // forever.
    this.claudeStdoutEofObserved = false;
    const reader = (
      claudeProcess.stdout as ReadableStream<Uint8Array>
    ).getReader();
    this.stdoutDrainTask = this.runStdoutDrain(reader);
  }

  /**
   * Drain loop. Reads claude's stdout one chunk at a time, splits on
   * newlines, dispatches each non-empty line to
   * {@link handleClaudeLine}. Exits cleanly on EOF (claude closed
   * its stdout, e.g., on exit) or on read error.
   *
   * The drain decodes incrementally (TextDecoder with `{stream: true}`)
   * so multi-byte UTF-8 sequences split across chunks are handled
   * correctly. Lines longer than a single chunk are accumulated in
   * `buffer` until a newline is seen.
   */
  private async runStdoutDrain(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          result = await reader.read();
        } catch {
          break;
        }
        if (result.done) {
          const remaining = buffer.trim();
          if (remaining.length > 0) this.handleClaudeLine(remaining);
          buffer = "";
          break;
        }
        buffer += decoder.decode(result.value, { stream: true });
        let lineEnd = buffer.indexOf("\n");
        while (lineEnd >= 0) {
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          if (line.length > 0) this.handleClaudeLine(line);
          lineEnd = buffer.indexOf("\n");
        }
      }
    } finally {
      // EOF: surface to the active turn (if any) so a turn that was
      // mid-stream when claude died doesn't hang `handleUserMessage`'s
      // await on the turn's completion promise.
      this.signalEofToActiveTurn();
    }
  }

  /**
   * Dispatch a parsed claude stdout line. If a turn is currently
   * active (`handleUserMessage` registered an `ActiveTurn`), route
   * the event into it via {@link dispatchEventToTurn}. Otherwise the
   * event is between turns — forward init-shaped events through
   * {@link handleInterTurnEvent} so `session_init` and
   * `system_metadata` arrive at tugcast immediately rather than
   * waiting for a user submit to drain the pipe (the pre-R1e
   * blocker).
   *
   * Bad JSON is logged and skipped (preserves the pre-R1e
   * `handleUserMessage` shape).
   */
  private handleClaudeLine(line: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      console.log(`Skipping non-JSON line: ${line}`);
      return;
    }
    // Open a turn for a buffered follow-on. `handleUserMessage` opens
    // the turn for the idle case; when it instead queued the message
    // (a turn was already running), claude runs it as a separate turn
    // after the current one's `result`. Those events would otherwise
    // arrive with `activeTurn === null` and be dropped as inter-turn —
    // the overlapping-turn routing bug. The drain claims the head of
    // `pendingTurnInputs` as the follow-on turn's user-message payload.
    if (this.activeTurn === null && this.pendingTurnInputs.length > 0) {
      this.openTurnFromPending();
    }
    if (this.activeTurn !== null) {
      const turn = this.activeTurn;
      this.dispatchEventToTurn(turn, event);
      // `result` ends the turn — `dispatchEventToTurn` latched
      // `gotResult` and resolved `turn.completion`. Clear the slot so
      // the next claude event opens a fresh turn instead of
      // dispatching into a finished one. Turn ownership is
      // `result`-bounded and lives here, not in `handleUserMessage`.
      if (turn.gotResult) {
        this.activeTurn = null;
      }
    } else {
      this.handleInterTurnEvent(event);
    }
    // After the canonical dispatch has written its own frames, give
    // the context_breakdown emitter a chance to append its frame for
    // the same event. Order matters: a `cost_update` from the
    // dispatcher is followed by a `context_breakdown` so reducers
    // that join the two by arrival order see them in the expected
    // sequence. The emitter is silent when not initialized or when
    // the event is not a trigger.
    this.maybeEmitContextBreakdown(event);
  }

  /**
   * Open an `ActiveTurn` for the head of {@link pendingTurnInputs} and
   * install it as {@link activeTurn}. Called by the stdout drain when
   * claude's events for a buffered follow-on turn begin to arrive
   * (see {@link handleClaudeLine}). A fresh `seq` is allocated here,
   * at turn-open, so the user-half `seq` orders just before the
   * turn's own frames. No-op when the FIFO is empty.
   */
  private openTurnFromPending(): void {
    const pending = this.pendingTurnInputs.shift();
    if (pending === undefined) return;
    this.activeTurn = new ActiveTurn(
      this.nextSeq(),
      pending.text,
      pending.attachments,
    );
  }

  /**
   * Inspect a parsed claude stdout event and, if it is a trigger,
   * write a corresponding `context_breakdown` frame to the wire.
   * Trigger events (per spike S4):
   *   - `system:init`      → initial frame after static-categories tokenize
   *   - `result`           → recomputed frame after each cost_update
   *   - `system:compact_boundary` → emitter is notified; the next
   *      `result` produces the updated frame via subtraction
   *
   * No-op when the emitter is not injected. Defensive: any
   * unexpected event shape (missing fields, wrong types) leaves the
   * emitter untouched and produces no frame.
   */
  /**
   * Emit the session-open `context_breakdown` frame — the static
   * estimate computed entirely from disk, so the Context surface
   * populates the moment the session opens (before claude's
   * `system:init`, which only lands once the first turn sends input).
   * No-op when the emitter is not injected (tests).
   */
  private emitInitialContextBreakdown(): void {
    const emitter = this.contextBreakdownEmitter;
    if (emitter) writeLine(emitter.onSpawn());
  }

  private maybeEmitContextBreakdown(event: Record<string, unknown>): void {
    const emitter = this.contextBreakdownEmitter;
    if (!emitter) return;
    if (event.type === "system") {
      const subtype = event.subtype;
      if (subtype === "init") {
        // `system:init` reports the built-in tool count — the one
        // input the filesystem can't reveal. Re-emit with it so
        // `system_tools` switches from the flat heuristic to the
        // exact count. A missing/empty `tools` keeps the heuristic.
        if (Array.isArray(event.tools) && event.tools.length > 0) {
          writeLine(emitter.onSessionInit(event.tools.length));
        }
      } else if (subtype === "compact_boundary") {
        emitter.onCompactBoundary();
      }
    } else if (event.type === "result") {
      const modelUsage =
        typeof event.modelUsage === "object" && event.modelUsage !== null
          ? (event.modelUsage as Record<string, unknown>)
          : undefined;
      const frame = emitter.onCostUpdate(modelUsage);
      if (frame) writeLine(frame);
    }
  }

  /**
   * Forward init-shaped events that arrive when no turn is active.
   * Pre-R1e these were stuck in the OS pipe between claude and
   * tugcode until a user submit ran the per-turn reader. Post-R1e
   * the drain forwards them as soon as they arrive — improving
   * tugcast/tugdeck observability without changing the wire shape.
   *
   * Currently handles `system:init` (forwarded as `session_init`)
   * which is the only shape a fresh-mode session-command respawn
   * relies on. Other inter-turn shapes (a hypothetical
   * `system_metadata` between turns) drop here and never reach the
   * wire. As more inter-turn events become real, this is the spot
   * to handle them.
   */
  private handleInterTurnEvent(event: Record<string, unknown>): void {
    if (event.type === "system" && event.subtype === "init") {
      const sessionId = (event.session_id as string) || "unknown";
      writeLine({ type: "session_init", session_id: sessionId, ipc_version: 2 });
    }
    // Other inter-turn event types are currently no-ops. The drain
    // is intentionally permissive here — it must not throw, since
    // unhandled-but-syntactically-valid lines from claude (a future
    // `system_metadata` between turns, etc.) shouldn't kill the
    // drain task.
  }

  /**
   * Per-turn dispatcher. Migrates the body of pre-R1e
   * `handleUserMessage`'s line-pulling loop verbatim, with one
   * substitution: per-turn mutable state lives on `turn` instead of
   * SessionManager fields. The two-tier routing (`routeTopLevelEvent`
   * + `mapStreamEvent`) is unchanged; control_request/cancel
   * handling is unchanged; turn-end emission of the final
   * `assistant_text` + `turn_complete` is unchanged.
   *
   * On `gotResult`, calls `turn.finish()` to resolve the completion
   * promise so `handleUserMessage`'s await returns.
   */
  private dispatchEventToTurn(
    turn: ActiveTurn,
    event: Record<string, unknown>,
  ): void {
    const ctx: EventMappingContext = {
      msgId: turn.currentMessageId ?? "",
      seq: turn.seq,
      rev: turn.rev,
    };

    // Tier 1: route the top-level message type. The turn's last
    // tool-loop iteration's `usage` (latest `message_delta`, else last
    // `message_start`) is handed in so the `result` branch emits it as
    // `cost_update.usage` — not `result.usage`, the per-iteration sum.
    const routeResult = routeTopLevelEvent(
      event,
      ctx,
      turn.lastMessageDeltaUsage ?? turn.lastMessageStartUsage,
    );

    // Slide the per-turn pointer to claude's most recent `message.id`.
    // Top-level `assistant` snapshots carry it directly; nothing rejects,
    // nothing freezes. Multi-message turns simply move the pointer to
    // the new id when the next `message_start` (below) arrives.
    if (routeResult.messageId !== undefined) {
      turn.currentMessageId = routeResult.messageId;
      ctx.msgId = turn.currentMessageId;
    }

    for (const ipcMsg of routeResult.messages) {
      if (routeResult.parentToolUseId) {
        (ipcMsg as unknown as Record<string, unknown>).parent_tool_use_id =
          routeResult.parentToolUseId;
      }
      // Gate site 1/7: suppressEmit holds back live forwarding while
      // runReplay's bracket is on the wire. State mutations
      // (turn.currentMessageId, turn.rev, turn.partialText) continue
      // regardless — the snapshot emission in
      // emitInflightTurnFromActiveTurn reads them.
      if (!turn.suppressEmit) writeLine(ipcMsg);
    }

    // Tier 2: delegate stream_event inner payload to mapStreamEvent().
    if (routeResult.streamEvent) {
      const streamResult = mapStreamEvent(
        routeResult.streamEvent,
        ctx,
        turn.partialText,
      );
      // Slide the pointer when `message_start` reveals a new id. claude
      // emits this before any content-bearing event of the message, so
      // by the time `content_block_delta` lands, ctx.msgId is already
      // claude's. Multi-message turns: a second `message_start` simply
      // moves the pointer to the new id; the prior message's frames are
      // already on the wire under its own id.
      if (streamResult.messageId !== undefined) {
        turn.currentMessageId = streamResult.messageId;
        ctx.msgId = turn.currentMessageId;
      }
      for (const ipcMsg of streamResult.messages) {
        if (routeResult.parentToolUseId) {
          (ipcMsg as unknown as Record<string, unknown>).parent_tool_use_id =
            routeResult.parentToolUseId;
        }
        // Gate site 2/7: live deltas during the suppressed window
        // accumulate into turn.partialText (assigned below) but stay
        // off the wire. After runReplay clears suppressEmit, future
        // deltas writeLine normally. The reducer's "snapshot then
        // resume" pattern (is_partial:false replace from snapshot,
        // then is_partial:true append from live deltas) reconciles
        // the two halves into one TurnEntry.
        if (!turn.suppressEmit) writeLine(ipcMsg);
      }
      turn.rev = streamResult.newRev;
      turn.partialText = streamResult.partialText;
      // Latch this iteration's `usage`. The latest `message_delta` is
      // the turn's last tool-loop iteration; `routeTopLevelEvent` reads
      // the latched value at the terminal `result` to build
      // `cost_update.usage`.
      if (streamResult.messageStartUsage !== undefined) {
        turn.lastMessageStartUsage = streamResult.messageStartUsage;
      }
      if (streamResult.messageDeltaUsage !== undefined) {
        turn.lastMessageDeltaUsage = streamResult.messageDeltaUsage;
      }
    }

    // Handle control_request: emit ControlRequestForward and store for
    // correlation.
    if (routeResult.controlRequest) {
      const cr = routeResult.controlRequest;
      const requestId = cr.request_id as string;
      const request = cr.request as Record<string, unknown> | undefined;
      const subtype = request?.subtype as string | undefined;

      if (subtype === "can_use_tool" && requestId && request) {
        this.pendingControlRequests.set(requestId, cr);

        const toolName = (request.tool_name as string) || "";
        const isQuestion = toolName === "AskUserQuestion";

        const forward: ControlRequestForward = {
          type: "control_request_forward",
          request_id: requestId,
          tool_name: toolName,
          input: (request.input as Record<string, unknown>) || {},
          decision_reason: request.decision_reason as string | undefined,
          permission_suggestions: request.permission_suggestions as
            | unknown[]
            | undefined,
          blocked_path: request.blocked_path as string | undefined,
          tool_use_id: request.tool_use_id as string | undefined,
          is_question: isQuestion,
          ipc_version: 2,
        };
        // Gate site 3/7. The pendingControlRequests entry above is
        // still recorded so a tool_approval response from tugdeck
        // would correlate; the forward itself is held back so the
        // reducer's replaying phase doesn't surface a tool dialog
        // while the bracket is on the wire. In practice runReplay's
        // window is short (tens of ms) and tool approvals are rare
        // mid-window — a request that lands here would deadlock on
        // tugdeck's side until claude retries. Acceptable for v1;
        // see [#roadmap].
        if (!turn.suppressEmit) writeLine(forward);
      } else {
        console.log(`Unhandled control_request subtype=${subtype ?? "unknown"}`);
      }
    }

    // Handle control_cancel_request: clean up pending entry.
    if (routeResult.cancelledRequestId) {
      this.pendingControlRequests.delete(routeResult.cancelledRequestId);
    }

    if (routeResult.gotResult) {
      turn.gotResult = true;
      // Emit final complete assistant_text only if there was streamed
      // text. Slash commands (local commands) deliver output via the
      // user/isReplay handler, not via streaming — partialText stays
      // empty for those.
      if (turn.partialText.length > 0) {
        const completeSeq = this.nextSeq();
        // Gate site 4/7. Skipped emits during the suppressed window
        // are reconstructed by emitInflightTurnFromActiveTurn from
        // turn.partialText + turn.gotResult.
        if (!turn.suppressEmit) {
          writeLine({
            type: "assistant_text",
            msg_id: turn.currentMessageId ?? "",
            seq: completeSeq,
            rev: 0,
            text: turn.partialText,
            is_partial: false,
            status: "complete",
            ipc_version: 2,
          });
        }
      }

      const turnSeq = this.nextSeq();
      const resultValue =
        (routeResult.resultMetadata?.resultValue as string) || "success";
      // Gate site 5/7. The reconstructed terminal event lives in
      // emitInflightTurnFromActiveTurn (turn_complete branch when
      // gotResult).
      if (!turn.suppressEmit) {
        writeLine({
          type: "turn_complete",
          msg_id: turn.currentMessageId ?? "",
          seq: turnSeq,
          result: resultValue,
          ipc_version: 2,
        });
      }
      turn.finish();
    }
  }
  /**
   * Emit the in-flight turn's content from `ActiveTurn` state, inside
   * `runReplay`'s bracket. Called unconditionally by `runReplay` after
   * the JSONL pass finishes and before the buffered `replay_complete`
   * is written, whenever an in-flight `ActiveTurn` was adopted at
   * bracket entry (`activeTurn !== null && !gotResult && !interrupted`).
   *
   * This is the load-bearing delivery path for claude's pre-HMR
   * streaming content (Step 5.11's never-drop chain link 8). The
   * CODE_OUTPUT broadcast does not backfill new subscribers
   * (`LagPolicy::Replay` only triggers on broadcast lag overflow,
   * not on initial subscribe), the JSONL only contains committed
   * turns, and the Step 5.6 pending-row synthetic delivers only the
   * user-side echo. Without this snapshot, the freshly-connected
   * client sees `pendingUserMessage` set but no scratch text, and
   * post-bracket `is_partial: true` deltas append onto an empty
   * baseline — losing the head of claude's response.
   *
   * The reads here (`turn.userText`, `turn.partialText`, etc.) are
   * tugcode's authoritative state — fresher and more complete than
   * JSONL (the JSONL's incomplete-flush window is the E1 race we're
   * routing around). Caller has set `turn.suppressEmit = true` for
   * the duration of the bracket so live deltas land in turn state but
   * stay off the wire; `runReplay` clears it after `replay_complete`.
   *
   * Tool calls inside the in-flight turn are NOT reconstructed here —
   * the drain currently dispatches tool events through writeLine
   * without buffering per-turn tool state, so we have no record to
   * replay. After this bracket clears, post-suppression live emit
   * resumes; any tool events that landed mid-window did update the
   * pendingControlRequests map but their forwards were skipped (gate
   * site 3/7). A tool approval mid-window is rare given the bracket's
   * tens-of-ms window; documented as a known limitation in the
   * roadmap.
   *
   * Terminal-event branch closes the [DM06] crash-during-suppression
   * pitfall: if the drain hit EOF or claude emitted result while
   * `suppressEmit=true`, `signalEofToActiveTurn` / `dispatchEventToTurn`
   * latched `gotResult` / `interrupted` but skipped their writeLine.
   * Without an explicit terminal here, the reducer's
   * `pendingUserMessage` would stay set and the TurnEntry would
   * never commit. The terminal we synthesize here makes the bracket
   * deliver a complete TurnEntry even when the drain dies mid-replay.
   */
  private emitInflightTurnFromActiveTurn(turn: ActiveTurn): void {
    const msgId = turn.currentMessageId ?? "";
    // 1. user_message_replay — synthetic, keyed by claude's most recent
    //    `message.id` for this turn (sliding pointer). When the bracket
    //    fires before claude has revealed any id (`message_start` not
    //    yet seen), msgId is empty — the reducer treats that as a
    //    pre-claude submission marker.
    writeLine({
      type: "user_message_replay",
      msg_id: msgId,
      text: turn.userText,
      attachments: turn.userAttachments.slice(),
      ipc_version: 2,
    });

    // 2. assistant_text — one consolidated emit with `is_partial:false`,
    //    which tells the reducer to REPLACE its scratch (not append).
    //    Subsequent live deltas after the bracket carry `is_partial:true`
    //    and append to this baseline. Allocate a fresh seq via
    //    nextSeq() rather than reusing turn.seq (the user-half's seq);
    //    matches the existing pattern at the gotResult complete-text
    //    site in dispatchEventToTurn.
    if (turn.partialText.length > 0) {
      writeLine({
        type: "assistant_text",
        msg_id: msgId,
        seq: this.nextSeq(),
        rev: turn.rev,
        text: turn.partialText,
        is_partial: false,
        status: "streaming",
        ipc_version: 2,
      });
    }

    // 3. Terminal event — only fires if the turn already finished
    //    while suppressed. Live turns (gotResult=false, interrupted=false)
    //    skip this; the drain's post-suppression dispatch will emit
    //    the real `turn_complete` when claude's `result` lands.
    if (turn.gotResult) {
      writeLine({
        type: "turn_complete",
        msg_id: msgId,
        seq: this.nextSeq(),
        result: "success",
        ipc_version: 2,
      });
    } else if (turn.interrupted) {
      writeLine({
        type: "turn_cancelled",
        msg_id: msgId,
        seq: this.nextSeq(),
        partial_result: turn.partialText.length > 0
          ? turn.partialText
          : "User interrupted",
        ipc_version: 2,
      });
    }
  }

  /**
   * Drain-EOF handler. Called once when claude's stdout closes (EOF
   * or read error). If no turn was active, nothing is emitted — the
   * `early-exit watcher` covers process-exit lifecycle separately.
   * If a turn was active, emit the canonical end-of-stream IPC frame
   * (`turn_cancelled` if the user had interrupted, `error` otherwise)
   * and resolve the turn's completion promise so `handleUserMessage`
   * returns.
   */
  private signalEofToActiveTurn(): void {
    // Latch the flag before any branch — handleUserMessage's
    // fast-path read after this point must see "EOF observed."
    this.claudeStdoutEofObserved = true;
    // claude's stdout is gone: no follow-on turn will ever be
    // bracketed, so drop any still-queued inputs rather than let a
    // respawn's drain claim them for an unrelated turn.
    this.pendingTurnInputs.length = 0;
    const turn = this.activeTurn;
    if (turn === null) {
      logSessionLifecycle("tugcode.claude_stdout_eof", {
        session_id: this.sessionId,
      });
      return;
    }
    // Gate sites 6 & 7. The EOF emit is held back during the
    // suppressed window — a claude crash mid-replay would otherwise
    // race the bracket. emitInflightTurnFromActiveTurn re-synthesizes
    // the right terminal event (turn_complete for gotResult,
    // turn_cancelled for interrupted) from latched state so the
    // bracket delivers a complete TurnEntry even if the drain dies.
    if (turn.interrupted) {
      if (!turn.suppressEmit) {
        writeLine({
          type: "turn_cancelled",
          msg_id: turn.currentMessageId ?? "",
          seq: turn.seq,
          partial_result: turn.partialText || "User interrupted",
          ipc_version: 2,
        });
      }
    } else if (!turn.gotResult) {
      if (!turn.suppressEmit) {
        writeLine({
          type: "error",
          message: "Claude process stream ended unexpectedly",
          recoverable: true,
          ipc_version: 2,
        });
      }
    }
    turn.finish();
    // Turn ownership is drain-bounded: clear the slot now the turn is
    // finished. `handleUserMessage` no longer clears it — it no longer
    // owns the turn lifecycle.
    this.activeTurn = null;
  }

  /**
   * Handle user_message: convert attachments to content blocks and
   * write them to claude's stdin. If no turn is running, open the
   * `ActiveTurn` for it and await its completion; if a turn is
   * already in flight, queue the message in {@link pendingTurnInputs}
   * and return — claude buffers it and the stdout drain opens its
   * follow-on turn. Turn ownership is drain-bounded: one `ActiveTurn`
   * per claude `result`, never one per `handleUserMessage` call.
   */
  async handleUserMessage(msg: UserMessage): Promise<void> {
    // Step R0d cold-boot order may dispatch handleUserMessage before
    // `spawnClaudeAndWatch()` has finished its synchronous setup —
    // i.e., the user typed and submitted while replay was still
    // streaming events. The readiness gate established in
    // `prepareSession()` blocks until the spawn has completed, so the
    // first claude stdin write here is sequenced correctly. After
    // the gate resolves it stays resolved; subsequent submits await
    // it as a no-op.
    if (this.claudeReadyPromise !== null) {
      await this.claudeReadyPromise;
    }

    if (!this.claudeProcess) {
      throw new Error("Session not initialized");
    }

    // Fast-path: the drain already observed claude's stdout
    // closing. Installing an `ActiveTurn` here would block on a
    // completion promise nothing will ever resolve. Emit the
    // canonical end-of-stream error frame and return — same shape
    // pre-R1e's read-loop emitted when its `readNextLine` returned
    // null on the first iteration.
    if (this.claudeStdoutEofObserved) {
      writeLine({
        type: "error",
        message: "Claude process stream ended unexpectedly",
        recoverable: true,
        ipc_version: 2,
      });
      return;
    }

    // Build content blocks from text and attachments per PN-12.
    const contentBlocks = buildContentBlocks(msg.text, msg.attachments || []);

    const userInput = JSON.stringify({
      type: "user",
      session_id: "",
      message: {
        role: "user",
        content: contentBlocks,
      },
      parent_tool_use_id: null,
    }) + "\n";
    const stdin = this.claudeProcess.stdin;
    stdin.write(userInput);
    stdin.flush();
    // Claude has now received input from us, so it has been seen alive
    // end-to-end. The early-exit watcher reads this flag to gate its
    // init-failure classification: any exit from this point on is a
    // runtime crash (handled by the stream-end branch in
    // `signalEofToActiveTurn`), not a resume_failed.
    this.claudeReceivedInput = true;

    // Turn ownership is drain-bounded — one `ActiveTurn` per claude
    // `result`. If no turn is running and nothing is queued ahead of
    // this message, it starts a turn: open the `ActiveTurn` now so an
    // immediate `runReplay` adopts a live turn and the pre-claude
    // submission window brackets exactly as before, then await the
    // drain bracketing it (`result`) or claude's stdout EOFing.
    //
    // If a turn IS already in flight (or messages are queued ahead),
    // claude buffers this message and runs it as a follow-on turn with
    // its own `result`. Queue it; the stdout drain opens its
    // `ActiveTurn` when claude's events for it arrive (see
    // `handleClaudeLine`). Queuing — never installing a second
    // `ActiveTurn` here — is the fix for the overlapping-turn routing
    // bug: a second install would clobber the running turn's slot and
    // strand both turns' events.
    //
    // The turn's `currentMessageId` slot is null until claude reveals
    // its `message.id` on the first stream event. `userText` /
    // `userAttachments` are the source of truth for the in-flight
    // turn's `user_message_replay` payload during a mid-turn
    // `runReplay`.
    if (this.activeTurn === null && this.pendingTurnInputs.length === 0) {
      const turn = new ActiveTurn(
        this.nextSeq(),
        msg.text,
        msg.attachments ?? [],
      );
      this.activeTurn = turn;
      // The drain clears `this.activeTurn` when it brackets the turn;
      // this await only lets callers that sequence on turn completion
      // (the tests, any future awaiting caller) observe it.
      await turn.completion;
    } else {
      this.pendingTurnInputs.push({
        text: msg.text,
        attachments: msg.attachments ?? [],
      });
    }
  }

  /**
   * Handle tool_approval: send control_response to claude stdin per D05/D06.
   * Uses "behavior" not "decision" per PN-1.
   */
  handleToolApproval(msg: ToolApproval): void {
    if (!this.claudeProcess) {
      console.error("handleToolApproval called with no active claude process");
      return;
    }

    const pending = this.pendingControlRequests.get(msg.request_id);
    if (!pending) {
      console.error(`No pending control_request for request_id: ${msg.request_id}`);
      return;
    }

    const stdin = this.claudeProcess.stdin;
    const pendingRequest = pending.request as Record<string, unknown> | undefined;
    const originalInput = (pendingRequest?.input as Record<string, unknown>) || {};

    if (msg.decision === "allow") {
      const response = formatPermissionAllow(msg.request_id, msg.updatedInput || originalInput);
      sendControlResponse(stdin, response);
    } else {
      const response = formatPermissionDeny(msg.request_id, msg.message || "User denied");
      sendControlResponse(stdin, response);
    }

    this.pendingControlRequests.delete(msg.request_id);
  }

  /**
   * Handle question_answer: send control_response with answers per D05.
   */
  handleQuestionAnswer(msg: QuestionAnswer): void {
    if (!this.claudeProcess) {
      console.error("handleQuestionAnswer called with no active claude process");
      return;
    }

    const pending = this.pendingControlRequests.get(msg.request_id);
    if (!pending) {
      console.error(`No pending control_request for request_id: ${msg.request_id}`);
      return;
    }

    const stdin = this.claudeProcess.stdin;
    const pendingRequest = pending.request as Record<string, unknown> | undefined;
    const originalInput = (pendingRequest?.input as Record<string, unknown>) || {};

    const response = formatQuestionAnswer(msg.request_id, originalInput, msg.answers);
    sendControlResponse(stdin, response);

    this.pendingControlRequests.delete(msg.request_id);
  }

  /**
   * Handle interrupt: send interrupt control_request per D07.
   *
   * Marks the active turn (if any) as interrupted so the stdout
   * drain's `signalEofToActiveTurn` path emits `turn_cancelled`
   * rather than `error` if claude tears down before responding.
   * The flag is per-turn (lives on `ActiveTurn`); a stale interrupt
   * arriving when no turn is active is a no-op.
   */
  handleInterrupt(): void {
    if (!this.claudeProcess) {
      console.log("No active claude process to interrupt");
      return;
    }

    console.log("Interrupting current turn via control_request interrupt");
    if (this.activeTurn !== null) {
      this.activeTurn.interrupted = true;
    }
    const stdin = this.claudeProcess.stdin;
    sendControlRequest(stdin, generateRequestId(), { subtype: "interrupt" });
  }

  /**
   * Handle permission_mode: update local permission manager and notify the CLI.
   * Sends a set_permission_mode control_request to the running CLI process so
   * it can apply the new mode without restarting.
   */
  handlePermissionMode(msg: PermissionModeMessage): void {
    console.log(`Setting permission mode: ${msg.mode}`);
    this.permissionManager.setMode(msg.mode);

    // Also notify the CLI process of the mode change.
    if (this.claudeProcess) {
      const stdin = this.claudeProcess.stdin;
      sendControlRequest(stdin, generateRequestId(), {
        subtype: "set_permission_mode",
        mode: msg.mode,
      });
    }
  }

  /**
   * Handle stop_task: send stop_task control_request to claude stdin per §2e.
   */
  handleStopTask(taskId: string): void {
    if (!this.claudeProcess) {
      console.log("No active claude process for stop_task");
      return;
    }
    const stdin = this.claudeProcess.stdin;
    sendControlRequest(stdin, generateRequestId(), { subtype: "stop_task", task_id: taskId });
  }

  /**
   * Handle model change: send set_model control_request to claude stdin.
   */
  handleModelChange(model: string): void {
    if (!this.claudeProcess) {
      console.log("No active claude process for model change");
      return;
    }
    const stdin = this.claudeProcess.stdin;
    sendControlRequest(stdin, generateRequestId(), { subtype: "set_model", model });
  }

  /**
   * Fork the current session: kill current process, respawn with --continue --fork-session.
   * Per D10 (#d10-session-forking).
   */
  async handleSessionFork(): Promise<void> {
    await this.killAndCleanup();

    const claudePath = Bun.which("claude");
    if (!claudePath) throw new Error("claude CLI not found on PATH");

    const args = buildClaudeArgs({
      pluginDir: this.getPluginDir(),
      permissionMode: this.permissionManager.getMode(),
      sessionId: null,
      continue: true,
      forkSession: true,
    });

    this.claudeProcess = Bun.spawn([claudePath, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      cwd: this.projectDir,
    });
    this.startStdoutDrain(this.claudeProcess);
    // Post-R1e: the drain task forwards claude's `system:init` to
    // tugcast as a `session_init` IPC frame as soon as it arrives
    // (see {@link handleInterTurnEvent}). The handler does not
    // synchronously await readiness — `claudeProcess.stdin` buffers
    // any bytes the next `handleUserMessage` writes before claude
    // finishes its handshake, and the drain catches up in the
    // background. Pre-R1e the legacy `waitForSessionReady` await
    // existed because the pull-based reader could not run in the
    // background; that constraint is gone.
  }

  /**
   * Continue in a new session picking up conversation history.
   * Respawns with --continue per D10.
   */
  async handleSessionContinue(): Promise<void> {
    await this.killAndCleanup();

    const claudePath = Bun.which("claude");
    if (!claudePath) throw new Error("claude CLI not found on PATH");

    const args = buildClaudeArgs({
      pluginDir: this.getPluginDir(),
      permissionMode: this.permissionManager.getMode(),
      sessionId: null,
      continue: true,
    });

    this.claudeProcess = Bun.spawn([claudePath, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      cwd: this.projectDir,
    });
    this.startStdoutDrain(this.claudeProcess);
    // See `handleSessionFork` — the drain forwards claude's
    // `system:init` asynchronously; no synchronous await needed.
  }

  /**
   * Start a fresh session with no prior history.
   * Kills current process and respawns without --resume.
   */
  async handleNewSession(): Promise<void> {
    await this.killAndCleanup();

    // Generate a new id for the fresh session and claim it with claude
    // via --session-id so downstream persistence and routing have a
    // stable identifier from spawn time forward.
    this.sessionId = crypto.randomUUID();
    this.claudeProcess = this.spawnClaude(this.sessionId, "session-id");
    this.startStdoutDrain(this.claudeProcess);
    // Synthesize a session_init for tugcast immediately — the
    // claude id is known synchronously here (we minted it above), so
    // no need to wait for claude's own emission.
    writeLine({ type: "session_init", session_id: this.sessionId, ipc_version: 2 });
  }

  /**
   * Dispatch a session command to the appropriate session management method.
   */
  async handleSessionCommand(command: "fork" | "continue" | "new"): Promise<void> {
    switch (command) {
      case "fork":
        return this.handleSessionFork();
      case "continue":
        return this.handleSessionContinue();
      case "new":
        return this.handleNewSession();
    }
  }

  /**
   * Public shutdown: close stdin and kill the process gracefully.
   * Called by main.ts SIGTERM handler. Also closes the read-only
   * sessions.db handle so the file lock is released before any temp
   * teardown the OS / test fixtures may run.
   */
  async shutdown(): Promise<void> {
    this.closeSessionsDb();
    await this.killAndCleanup();
  }

  /**
   * Upsert the record for this session into `dev.tugtool.tide /
   * sessions`. Keyed by the session id (which claude uses as its own
   * session id and tugcast uses for feed routing — a single identifier
   * across the stack). Value shape:
   *
   *   `{ [sessionId]: { projectDir, createdAt } }`
   *
   * `createdAt` is the epoch-ms timestamp the session was first
   * recorded. Resume keeps the existing `createdAt`; the picker sorts
   * by it to show the newest session first for a given project.
   */
  /**
   * Resolve the tugplug plugin directory for --plugin-dir.
   * The plugin lives at `tugplug/` under the project directory (passed via --dir).
   */
  private getPluginDir(): string {
    const pluginDir = join(this.projectDir, "tugplug");
    console.log(`Plugin dir: ${pluginDir}`);
    return pluginDir;
  }
}
