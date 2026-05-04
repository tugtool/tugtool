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
  Attachment,
} from "./types.ts";
import { join, dirname, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { logSessionLifecycle } from "./session-lifecycle-log.ts";
import {
  type ReplayInput,
  type ReplayTelemetry,
  translateJsonlSession,
} from "./replay.ts";

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
 * Result of attempting to read a JSONL file from disk. A discriminated
 * union so the resume-spawn flow can pass the outcome straight to
 * {@link translateJsonlSession} without losing the error category.
 */
export type JsonlReadResult =
  | { kind: "ok"; jsonl: string }
  | { kind: "missing"; message: string }
  | { kind: "unreadable"; message: string };

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
  model: string;
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
    "--model", config.model,
    "--permission-mode", config.permissionMode,
  ];

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
 */
export interface EventMappingResult {
  messages: OutboundMessage[];
  newRev: number;
  partialText: string;
  gotResult: boolean;
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
}

/**
 * Route a single top-level stdout message to IPC outbound messages.
 * Handles all 8+ top-level message types per D03.
 * Exported for unit testing.
 */
export function routeTopLevelEvent(
  event: Record<string, unknown>,
  ctx: EventMappingContext
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
      const model = (message?.model as string) || "";
      const isSynthetic = model === "<synthetic>";
      const content = (message?.content as Array<Record<string, unknown>>) || [];

      for (const block of content) {
        if (block.type === "text" && isSynthetic) {
          const text = (block.text as string) || "";
          if (text.length > 0) {
            messages.push({
              type: "assistant_text",
              msg_id: ctx.msgId,
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
            msg_id: ctx.msgId,
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
      const costMsg: CostUpdate = {
        type: "cost_update",
        total_cost_usd: (event.total_cost_usd as number) || 0,
        num_turns: (event.num_turns as number) || 0,
        duration_ms: (event.duration_ms as number) || 0,
        duration_api_ms: (event.duration_api_ms as number) || 0,
        usage: (event.usage as Record<string, unknown>) || {},
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
  };
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

  const eventType = event.type as string | undefined;

  if (eventType === "content_block_start") {
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

  return { messages, newRev, partialText, gotResult };
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/**
 * Manages claude CLI process lifecycle, message identity, and streaming.
 * Spawns claude with --output-format stream-json --input-format stream-json
 * per D01/D02.
 */
export class SessionManager {
  private claudeProcess: ReturnType<typeof Bun.spawn> | null = null;
  private stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private stdoutBuffer: string = "";
  private interrupted: boolean = false;
  private permissionManager = new PermissionManager();
  private seq: number = 0;
  // Legacy pending maps kept for reference; control flow is now via control_response writes.
  private pendingApprovals = new Map<string, PendingRequest<"allow" | "deny">>();
  private pendingQuestions = new Map<string, PendingRequest<Record<string, string>>>();
  // Stores raw control_requests by request_id for correlation with IPC messages.
  private pendingControlRequests = new Map<string, Record<string, unknown>>();
  private currentMsgId: string | null = null;
  private currentRev: number = 0;
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
  }

  private nextSeq(): number {
    return this.seq++;
  }

  private newMsgId(): string {
    return crypto.randomUUID();
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
  ): ReturnType<typeof Bun.spawn> {
    const claudePath = Bun.which("claude");
    if (!claudePath) {
      throw new Error("claude CLI not found on PATH");
    }

    const args = buildClaudeArgs({
      pluginDir: this.getPluginDir(),
      model: "claude-opus-4-6",
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
      this.stdoutReader = null;
      this.stdoutBuffer = "";
    }
  }

  /**
   * Read the next complete line from the claude process stdout.
   * Returns null when stream ends.
   */
  private async readNextLine(): Promise<string | null> {
    if (!this.stdoutReader) {
      return null;
    }

    while (true) {
      const lineEnd = this.stdoutBuffer.indexOf("\n");
      if (lineEnd >= 0) {
        const line = this.stdoutBuffer.slice(0, lineEnd).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1);
        if (line.length > 0) {
          return line;
        }
        continue;
      }

      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await this.stdoutReader.read();
      } catch {
        return null;
      }

      if (result.done) {
        const remaining = this.stdoutBuffer.trim();
        this.stdoutBuffer = "";
        return remaining.length > 0 ? remaining : null;
      }

      this.stdoutBuffer += new TextDecoder().decode(result.value, { stream: true });
    }
  }

  /**
   * Wait for the claude process to emit system:init on stdout.
   * Reads lines until the init event arrives, emits session_init with
   * the real session ID, and persists it. Times out after 30 seconds.
   * Any non-init lines read during the wait are buffered back so
   * handleUserMessage can process them (e.g., replay events).
   */
  private async waitForSessionReady(): Promise<void> {
    const timeout = 30_000;
    const start = Date.now();
    const bufferedLines: string[] = [];

    while (Date.now() - start < timeout) {
      const line = await this.readNextLine();
      if (line === null) {
        // Process died during startup
        writeLine({ type: "error", message: "Claude process died during session startup", recoverable: true, ipc_version: 2 });
        return;
      }

      try {
        const event = JSON.parse(line);
        if (event.type === "system" && event.subtype === "init") {
          const sessionId = event.session_id || "unknown";
          writeLine({ type: "session_init", session_id: sessionId, ipc_version: 2 });

          // Push any buffered lines back into stdoutBuffer so
          // handleUserMessage will process them.
          if (bufferedLines.length > 0) {
            this.stdoutBuffer = bufferedLines.join("\n") + "\n" + this.stdoutBuffer;
          }
          return;
        }
      } catch {
        // Non-JSON line — skip
      }

      // Buffer non-init lines for later processing
      bufferedLines.push(line);
    }

    writeLine({ type: "error", message: "Timed out waiting for claude session init", recoverable: true, ipc_version: 2 });
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
   * The cold-boot resume flow (Step R0d) is:
   *
   *   1. `prepareSession()` — emit the init synchronously so tugcast
   *      sees the session as live and broadcasts `spawn_session_ok`;
   *      tugdeck constructs services and the user sees the card open.
   *   2. `await runReplay()` — read the JSONL and stream replay
   *      events. claude is not yet spawned; replay reads only the
   *      filesystem. Finishes in ~50ms instead of the 5–10s the
   *      pre-R0d order took (which awaited claude's binary load
   *      first).
   *   3. `void spawnClaudeAndWatch()` — spawn claude in the
   *      background. The returned Promise resolves once the spawn
   *      handle is wired up; `handleUserMessage` awaits it.
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
    this.stdoutReader = (
      this.claudeProcess.stdout as ReadableStream<Uint8Array>
    ).getReader();
    this.stdoutBuffer = "";

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
   * Resume mode (cold-boot, Step R0d): `main.ts` does NOT call
   * `initialize()`; it calls `prepareSession()` →
   * `await runReplay()` → `void spawnClaudeAndWatch()` so the
   * 5–10s claude spawn runs in the background after the populated
   * transcript is already on the user's screen. `initialize()`
   * remains for non-cold-boot callers (and tests that don't care to
   * exercise the cold-boot order); for resume mode it composes
   * `prepareSession()` + `await spawnClaudeAndWatch()` to keep the
   * wire bytes bytes-identical.
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
   * `replay_complete`. Runs only in resume mode; called once per
   * session, after `initialize()` has synthesized the `session_init`
   * IPC line and before the main IPC loop dispatches the first
   * `user_message`.
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
   * other side and live forwarding takes over when handleUserMessage
   * runs.
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
   * a documented threshold for any future continuous-drain refactor;
   * it is not load-bearing in this code path.
   */
  async runReplay(): Promise<void> {
    if (this.sessionMode !== "resume") return;
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
    const input: typeof rawInput = rawInput.kind === "ok"
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

    const iter = translateJsonlSession(input, {
      telemetry: this.replayTelemetry,
    });

    let count = 0;
    let lastProgressPosted = 0;
    const progressBatch = 16;
    let aborted:
      | { kind: "timeout" }
      | { kind: "exit"; code: number | null }
      | null = null;

    try {
      while (true) {
        const nextPromise = iter
          .next()
          .then((r) => ({ kind: "next" as const, value: r }));
        const racers: Array<
          Promise<
            | { kind: "next"; value: IteratorResult<OutboundMessage> }
            | { kind: "timeout" }
            | { kind: "exit"; code: number | null }
          >
        > = [nextPromise, timeoutPromise];
        if (exitPromise !== null) racers.push(exitPromise);
        const winner = await Promise.race(racers);

        if (winner.kind === "next") {
          if (winner.value.done) break;
          const msg = winner.value.value;
          writeLine(msg);
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
            // The iterator emitted its terminal bracket itself; mirror
            // the count it reported so the lifecycle log line matches
            // the wire.
            if (typeof msg.count === "number") count = msg.count;
            break;
          }
        } else {
          aborted = winner;
          break;
        }
      }
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      this.replayActive = false;
      // Best-effort iterator cleanup; abandoned-iterator semantics
      // are well-defined in JS but explicit `.return()` releases any
      // pending awaits inside the generator.
      try {
        await iter.return?.(undefined);
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
   * Handle user_message: convert attachments to content blocks, write to stdin,
   * and process events with two-tier routing.
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

    this.currentMsgId = this.newMsgId();
    this.currentRev = 0;
    const seq = this.nextSeq();
    this.interrupted = false;

    let partialText = "";
    let gotResult = false;

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
    // runtime crash (handled by the stream-end branch below), not a
    // resume_failed.
    this.claudeReceivedInput = true;

    try {
      while (true) {
        const line = await this.readNextLine();

        if (line === null) {
          if (this.interrupted) {
            writeLine({
              type: "turn_cancelled",
              msg_id: this.currentMsgId!,
              seq,
              partial_result: partialText || "User interrupted",
              ipc_version: 2,
            });
          } else if (!gotResult) {
            writeLine({
              type: "error",
              message: "Claude process stream ended unexpectedly",
              recoverable: true,
              ipc_version: 2,
            });
          }
          break;
        }

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          console.log(`Skipping non-JSON line: ${line}`);
          continue;
        }

        const ctx: EventMappingContext = {
          msgId: this.currentMsgId!,
          seq,
          rev: this.currentRev,
        };

        // Tier 1: route the top-level message type.
        const routeResult = routeTopLevelEvent(event, ctx);

        // Emit IPC messages from router, stamping parent_tool_use_id per §15.
        for (const ipcMsg of routeResult.messages) {
          if (routeResult.parentToolUseId) {
            (ipcMsg as Record<string, unknown>).parent_tool_use_id = routeResult.parentToolUseId;
          }
          writeLine(ipcMsg);
        }

        // Tier 2: delegate stream_event inner payload to mapStreamEvent().
        if (routeResult.streamEvent) {
          const streamResult = mapStreamEvent(routeResult.streamEvent, ctx, partialText);
          for (const ipcMsg of streamResult.messages) {
            if (routeResult.parentToolUseId) {
              (ipcMsg as Record<string, unknown>).parent_tool_use_id = routeResult.parentToolUseId;
            }
            writeLine(ipcMsg);
          }
          this.currentRev = streamResult.newRev;
          partialText = streamResult.partialText;
        }

        // Handle control_request: emit ControlRequestForward and store for correlation.
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
              permission_suggestions: request.permission_suggestions as unknown[] | undefined,
              blocked_path: request.blocked_path as string | undefined,
              tool_use_id: request.tool_use_id as string | undefined,
              is_question: isQuestion,
              ipc_version: 2,
            };
            writeLine(forward);
          } else {
            console.log(`Unhandled control_request subtype=${subtype ?? "unknown"}`);
          }
        }

        // Handle control_cancel_request: clean up pending entry.
        if (routeResult.cancelledRequestId) {
          this.pendingControlRequests.delete(routeResult.cancelledRequestId);
        }

        gotResult = routeResult.gotResult;
        if (gotResult) {
          // Emit final complete assistant_text only if there was streamed text.
          // Slash commands (local commands) deliver output via the user/isReplay
          // handler, not via streaming — partialText stays empty for those.
          if (partialText.length > 0) {
            const completeSeq = this.nextSeq();
            writeLine({
              type: "assistant_text",
              msg_id: this.currentMsgId!,
              seq: completeSeq,
              rev: 0,
              text: partialText,
              is_partial: false,
              status: "complete",
              ipc_version: 2,
            });
          }

          const turnSeq = this.nextSeq();
          const resultValue = routeResult.resultMetadata?.resultValue as string || "success";
          writeLine({
            type: "turn_complete",
            msg_id: this.currentMsgId!,
            seq: turnSeq,
            result: resultValue,
            ipc_version: 2,
          });
          break;
        }
      }
    } catch (err) {
      writeLine({
        type: "error",
        message: `Turn failed: ${err}`,
        recoverable: true,
        ipc_version: 2,
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
   */
  handleInterrupt(): void {
    if (!this.claudeProcess) {
      console.log("No active claude process to interrupt");
      return;
    }

    console.log("Interrupting current turn via control_request interrupt");
    this.interrupted = true;
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
      model: "claude-opus-4-6",
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
    this.stdoutReader = (this.claudeProcess.stdout as ReadableStream<Uint8Array>).getReader();
    this.stdoutBuffer = "";

    await this.waitForSessionReady();
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
      model: "claude-opus-4-6",
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
    this.stdoutReader = (this.claudeProcess.stdout as ReadableStream<Uint8Array>).getReader();
    this.stdoutBuffer = "";

    await this.waitForSessionReady();
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
    this.stdoutReader = (this.claudeProcess.stdout as ReadableStream<Uint8Array>).getReader();
    this.stdoutBuffer = "";

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
   * Called by main.ts SIGTERM handler.
   */
  async shutdown(): Promise<void> {
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
