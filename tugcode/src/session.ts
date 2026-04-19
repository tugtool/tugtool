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
  SystemMetadata,
  CostUpdate,
  Attachment,
} from "./types.ts";
import { join, dirname, resolve } from "node:path";
import { logSessionLifecycle } from "./session-lifecycle-log.ts";

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
   * `"new"` spawns claude with `--session-id <id>` (claiming the id);
   * `"resume"` spawns claude with `--resume <id>` (loading an existing
   * conversation). Both modes share the same `initialize()` path; the
   * only mode-specific thing is the claude flag, plus a background
   * watcher that surfaces resume failures via `resume_failed` IPC.
   */
  private sessionMode: "new" | "resume";
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
   * Initialize session — single codepath for fresh and resume.
   *
   * Both modes spawn claude with stream-json IPC; the only mode-specific
   * thing is the claude flag (`--session-id` vs `--resume`). Empirically
   * verified: claude in stream-json mode does NOT emit `system:init`
   * until it receives input, regardless of mode. Waiting for one would
   * deadlock — both modes would hang for the full timeout. Instead we
   * synthesize the `session_init` IPC line immediately (we already know
   * the session id; it's the same one we just spawned claude with) and
   * install a background watcher that surfaces fast claude failures:
   *
   *   - resume with stale id: claude exits in ~1s with stderr
   *     `No conversation found with session ID: <id>`.
   *   - fresh with id collision: claude exits in ~135ms with stderr
   *     `Session ID <id> is already in use`.
   *
   * The watcher catches those signatures and emits `resume_failed`
   * (resume) or `error` (fresh). The bridge then promotes the
   * subsequent stdout EOF to a terminal outcome and surfaces it to
   * the card. Past the watcher window claude is alive and waiting
   * for input — the happy path.
   */
  async initialize(): Promise<void> {
    const inputSessionId = this.sessionId;
    const inputMode = this.sessionMode;
    logSessionLifecycle("tugcode.init.start", {
      session_id: inputSessionId,
      session_mode: inputMode,
    });

    const claudeFlag = this.sessionMode === "resume" ? "resume" : "session-id";
    this.claudeProcess = this.spawnClaude(this.sessionId, claudeFlag);
    this.stdoutReader = (this.claudeProcess.stdout as ReadableStream<Uint8Array>).getReader();
    this.stdoutBuffer = "";

    this.startStderrReader();
    this.installEarlyExitWatcher();

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
    // Claude has now received input from us, so it has been seen alive
    // end-to-end. The early-exit watcher uses this flag to gate its
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
