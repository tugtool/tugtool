// Session lifecycle management via direct claude CLI spawning

import { PermissionManager } from "./permissions.ts";
import { writeLine } from "./ipc.ts";
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
  SystemMetadata,
  CostUpdate,
  Attachment,
} from "./types.ts";
import { join, dirname, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { logSessionLifecycle } from "./session-lifecycle-log.ts";

// ---------------------------------------------------------------------------
// Pre-flight: expected claude session jsonl path
// ---------------------------------------------------------------------------

/**
 * Expected on-disk path of claude's session jsonl for `(projectDir,
 * sessionId)`. claude writes sessions to
 * `~/.claude/projects/<encoded-cwd>/<id>.jsonl` where the encoding
 * replaces every `/` in the absolute cwd with `-` (e.g. `/u/src/tugtool`
 * → `-u-src-tugtool`).
 *
 * Pure helper so unit tests can assert the encoding without touching
 * the filesystem. Exported for tests.
 *
 * tugcode stats this path before invoking `claude --resume <id>` so
 * a missing jsonl fails the resume in a millisecond instead of
 * waiting ~5s for claude to give up. Defense in depth — the
 * supervisor's `session_live_elsewhere` check catches the
 * concurrent-binding case; this catches the deleted-jsonl case.
 */
export function expectedSessionJsonlPath(projectDir: string, sessionId: string): string {
  // Honor `CLAUDE_CONFIG_DIR` so users with a non-default claude
  // config don't false-positive the pre-flight as missing.
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const encoded = projectDir.replace(/\//g, "-");
  return join(configDir, "projects", encoded, `${sessionId}.jsonl`);
}

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

/**
 * Thrown by `SessionManager.initialize()` when a `--resume` attempt
 * fails. The `resume_failed` IPC line was already emitted to stdout
 * before the throw, so the bridge has the frame in flight; main.ts
 * catches this sentinel, logs, and exits cleanly without writing an
 * additional `error` IPC line.
 */
export class ResumeFailedError extends Error {
  constructor(public readonly staleSessionId: string, public readonly reason: string) {
    super(`resume failed for ${staleSessionId}: ${reason}`);
    this.name = "ResumeFailedError";
  }
}

// ---------------------------------------------------------------------------
// Image attachment validation constants (per PN-12)
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // ~5MB decoded

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
 * Exported for unit testing per Step 1 strategy.
 * Per Spec S01 (#s01-spawn-args).
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
 * Per Table T01 (#t01-event-mapping).
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
   * `"new"` (default) spawns a fresh claude session; `"resume"` passes
   * `--resume <sessionId>` to claude. Resume failure falls back to a
   * fresh spawn after emitting a `resume_failed` IPC frame — see
   * `initialize()`.
   */
  private sessionMode: "new" | "resume";
  /**
   * Captured by `attemptResumeSpawn` on failure so `initialize()` can
   * thread the reason into `ResumeFailedError`. Cleared when not in
   * use; reset on every fresh `attemptResumeSpawn` call.
   */
  private lastResumeFailureReason: string | null = null;

  /**
   * Filesystem check used by the resume pre-flight to decide whether
   * the expected claude session jsonl exists. Tests override via
   * `setExistsSyncForTest` so they can exercise the spawn path
   * without a real file on disk and the missing-file path without
   * touching the filesystem at all.
   */
  private _existsSync: (path: string) => boolean = (p) => {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  };

  /**
   * Test seam — install a deterministic file-existence check so
   * resume pre-flight tests don't depend on the actual filesystem.
   * @internal
   */
  setExistsSyncForTest(fn: (path: string) => boolean): void {
    this._existsSync = fn;
  }

  constructor(
    projectDir: string,
    sessionId: string,
    sessionMode: "new" | "resume" = "new",
  ) {
    if (!sessionId) {
      throw new Error("SessionManager: sessionId is required");
    }
    this.projectDir = projectDir;
    this.sessionId = sessionId;
    this.sessionMode = sessionMode;
  }

  private nextSeq(): number {
    return this.seq++;
  }

  private newMsgId(): string {
    return crypto.randomUUID();
  }

  /**
   * Spawn the claude CLI process with stream-json flags per Spec S01.
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
      stderr: "inherit",
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
   * Initialize session.
   *
   * - `sessionMode === "new"`: spawn claude with
   *   `--session-id <this.sessionId>` so the tugdeck-generated UUID
   *   becomes claude's own session id. On `system:init` the record is
   *   upserted into `dev.tugtool.tide / sessions` with `{projectDir,
   *   createdAt}`.
   * - `sessionMode === "resume"`: spawn claude with
   *   `--resume <this.sessionId>`. If the spawn fails (claude exits
   *   before we see `system:init`, e.g. because the session JSONL is
   *   missing or rejected), emit a `resume_failed` IPC frame and
   *   throw `ResumeFailedError`. The bridge promotes the subsequent
   *   stdout EOF from `Crashed` to `ResumeFailed` (no retry) and
   *   surfaces the failure to the card; the user picks a different
   *   option in the picker. Silently rebranding the session under a
   *   new claude id is what produced an earlier divergence bug class
   *   — we now surface the failure instead.
   */
  async initialize(): Promise<void> {
    const inputSessionId = this.sessionId;
    const inputMode = this.sessionMode;
    logSessionLifecycle("tugcode.init.start", {
      session_id: inputSessionId,
      session_mode: inputMode,
    });

    if (this.sessionMode === "resume") {
      console.log(`Attempting to resume claude session ${this.sessionId}`);
      const ok = await this.attemptResumeSpawn(this.sessionId);
      if (ok) {
        logSessionLifecycle("tugcode.init.end", {
          session_mode: inputMode,
          session_id_in: inputSessionId,
          session_id_out: this.sessionId,
          fallback_taken: false,
        });
        return;
      }
      // attemptResumeSpawn has emitted `resume_failed` (the bridge will
      // forward it as a CODE_OUTPUT frame), removed the stale sessions
      // record, and reset internal state. Throw so main.ts exits cleanly
      // without minting a new uuid. The bridge's `RelayOutcome::ResumeFailed`
      // path takes over from here.
      const reason =
        this.lastResumeFailureReason ??
        "resume failed";
      logSessionLifecycle("tugcode.init.end", {
        session_mode: inputMode,
        session_id_in: inputSessionId,
        session_id_out: inputSessionId,
        fallback_taken: false,
        resume_failed: true,
        reason,
      });
      throw new ResumeFailedError(inputSessionId, reason);
    }

    console.log(`Spawning fresh claude session (--session-id ${this.sessionId})`);

    this.claudeProcess = this.spawnClaude(this.sessionId, "session-id");
    this.stdoutReader = (this.claudeProcess.stdout as ReadableStream<Uint8Array>).getReader();
    this.stdoutBuffer = "";

    writeLine({
      type: "session_init",
      session_id: this.sessionId,
      ipc_version: 2,
    });
    logSessionLifecycle("tugcode.init.end", {
      session_mode: inputMode,
      session_id_in: inputSessionId,
      session_id_out: this.sessionId,
      fallback_taken: false,
    });
  }

  /**
   * Attempt to spawn claude with `--resume <resumeId>` and wait for the
   * `system:init` event within a 10s window. Returns `true` on success
   * (internal state set up, `session_init` IPC emitted); `false` on
   * failure (stale-id fallback executed: `resume_failed` emitted, the
   * sessions record removed, internal state reset to null).
   *
   * Claude's failure signal on a bad `--resume` id is the process
   * exiting quickly (usually within a second) with a non-zero status.
   * We detect failure two ways:
   *   - `claudeProcess.exited` resolves before `system:init` arrives.
   *   - No `system:init` appears within `RESUME_INIT_TIMEOUT_MS`.
   * Either case triggers the fallback.
   */
  private async attemptResumeSpawn(resumeId: string): Promise<boolean> {
    this.lastResumeFailureReason = null;

    // Pre-flight: if the expected session jsonl is missing, fail the
    // resume immediately rather than spending ~5s waiting for claude
    // to exit. The bridge's terminal `ResumeFailed` outcome takes over
    // from here. Tests install a stub file-existence check via
    // `setExistsSyncForTest`; production reads the real filesystem.
    const jsonlPath = expectedSessionJsonlPath(this.projectDir, resumeId);
    if (!this._existsSync(jsonlPath)) {
      const reason = "missing_jsonl";
      this.lastResumeFailureReason = reason;
      console.log(
        `Pre-flight: claude session jsonl missing at ${jsonlPath}; failing resume`,
      );
      logSessionLifecycle("tugcode.resume_failed", {
        stale_session_id: resumeId,
        reason,
        jsonl_path: jsonlPath,
      });
      writeLine({
        type: "resume_failed",
        reason,
        stale_session_id: resumeId,
        ipc_version: 2,
      });
      return false;
    }

    const RESUME_INIT_TIMEOUT_MS = 10_000;

    const child = this.spawnClaude(resumeId, "resume");
    this.claudeProcess = child;
    this.stdoutReader = (child.stdout as ReadableStream<Uint8Array>).getReader();
    this.stdoutBuffer = "";

    // Race three outcomes: `system:init` arrives → success; child exits
    // → failure; timeout → failure.
    const initPromise: Promise<
      "init" | "exit" | "timeout"
    > = (async () => {
      const start = Date.now();
      while (Date.now() - start < RESUME_INIT_TIMEOUT_MS) {
        const line = await this.readNextLine();
        if (line === null) return "exit";
        try {
          const event = JSON.parse(line);
          if (event.type === "system" && event.subtype === "init") {
            const sid = event.session_id || resumeId;
            writeLine({ type: "session_init", session_id: sid, ipc_version: 2 });
            return "init";
          }
        } catch {
          // Ignore non-JSON lines during the handshake window.
        }
      }
      return "timeout";
    })();

    const exitPromise: Promise<"exit"> = child.exited.then(() => "exit" as const);
    const timeoutPromise: Promise<"timeout"> = new Promise((r) =>
      setTimeout(() => r("timeout"), RESUME_INIT_TIMEOUT_MS),
    );

    const outcome = await Promise.race([
      initPromise,
      exitPromise,
      timeoutPromise,
    ]);

    if (outcome === "init") {
      return true;
    }

    // Failure path: emit `resume_failed` so tugcast removes the stale
    // sessions record and routes the notice to the card. Then kill the
    // child if it is still around and reset internal state.
    const reason =
      outcome === "exit"
        ? "claude exited before session init (likely stale --resume id)"
        : "timed out waiting for session init on --resume";
    this.lastResumeFailureReason = reason;
    console.log(`Resume attempt for ${resumeId} failed: ${reason}`);
    logSessionLifecycle("tugcode.resume_failed", {
      stale_session_id: resumeId,
      reason,
    });
    writeLine({
      type: "resume_failed",
      reason,
      stale_session_id: resumeId,
      ipc_version: 2,
    });

    try {
      child.kill();
    } catch {
      // Process may already be gone.
    }
    this.claudeProcess = null;
    this.stdoutReader = null;
    this.stdoutBuffer = "";

    return false;
  }

  /**
   * Handle user_message: convert attachments to content blocks, write to stdin,
   * and process events with two-tier routing.
   */
  async handleUserMessage(msg: UserMessage): Promise<void> {
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
