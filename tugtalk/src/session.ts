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
  ControlRequestForward,
  ControlRequestCancel,
  SystemMetadata,
  CostUpdate,
  Attachment,
} from "./types.ts";
import { mkdir, exists } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

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
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
  permission_denials?: unknown[];
  is_api_error?: boolean;
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
          claude_code_version: event.claude_code_version,
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
          version: (event.claude_code_version as string) || "",
          ipc_version: 2,
        };
        messages.push(sysMsg);
      } else if (subtype === "compact_boundary") {
        const marker: CompactBoundary = { type: "compact_boundary", ipc_version: 2 };
        messages.push(marker);
      }
      break;
    }

    case "assistant": {
      const message = event.message as Record<string, unknown> | undefined;
      const content = (message?.content as Array<Record<string, unknown>>) || [];

      for (const block of content) {
        if (block.type === "text") {
          messages.push({
            type: "assistant_text",
            msg_id: ctx.msgId,
            seq: ctx.seq,
            rev: ctx.rev,
            text: (block.text as string) || "",
            is_partial: false,
            status: "complete",
            ipc_version: 2,
          });
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
        } else if (block.type === "thinking") {
          const thinkingMsg: ThinkingText = {
            type: "thinking_text",
            msg_id: ctx.msgId,
            seq: ctx.seq,
            text: (block.text as string) || "",
            is_partial: false,
            status: "complete",
            ipc_version: 2,
          };
          messages.push(thinkingMsg);
        }
      }
      break;
    }

    case "user": {
      const message = event.message as Record<string, unknown> | undefined;
      const content = (message?.content as Array<Record<string, unknown>>) || [];

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

      // Handle isReplay + slash command output per PN-13.
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
        total_cost_usd: event.total_cost_usd as number | undefined,
        num_turns: event.num_turns as number | undefined,
        duration_ms: event.duration_ms as number | undefined,
        duration_api_ms: event.duration_api_ms as number | undefined,
        usage: event.usage as Record<string, unknown> | undefined,
        modelUsage: event.modelUsage as Record<string, unknown> | undefined,
        permission_denials: event.permission_denials as unknown[] | undefined,
        is_api_error: isApiError || undefined,
      };

      if (typeof resultText === "string" && resultText.length > 0) {
        messages.push({
          type: "assistant_text",
          msg_id: ctx.msgId,
          seq: ctx.seq,
          rev: ctx.rev,
          text: resultText,
          is_partial: false,
          status: "complete",
          ipc_version: 2,
        });
      }

      // Emit CostUpdate BEFORE turn_complete so cost data arrives first per PN-19.
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

      const resultValue = subtype === "success" ? "success" : "error";
      messages.push({
        type: "turn_complete",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        result: resultValue,
        ipc_version: 2,
      });
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
    } else if (delta?.type === "thinking_delta" && typeof delta.text === "string") {
      const thinkingMsg: ThinkingText = {
        type: "thinking_text",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        text: delta.text,
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
  private sessionIdPersisted: boolean = false;
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  private nextSeq(): number {
    return this.seq++;
  }

  private newMsgId(): string {
    return crypto.randomUUID();
  }

  /**
   * Spawn the claude CLI process with stream-json flags per Spec S01.
   */
  private spawnClaude(sessionId: string | null): ReturnType<typeof Bun.spawn> {
    const claudePath = Bun.which("claude");
    if (!claudePath) {
      throw new Error("claude CLI not found on PATH");
    }

    const args = buildClaudeArgs({
      pluginDir: this.getTugtoolRoot(),
      model: "claude-opus-4-6",
      permissionMode: this.permissionManager.getMode(),
      sessionId,
    });

    console.log(`Spawning claude with args: ${args.join(" ")}`);

    return Bun.spawn([claudePath, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      cwd: this.projectDir,
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
   * Initialize session: try to resume from persisted ID, fall back to create new.
   */
  async initialize(): Promise<void> {
    const existingId = await this.readSessionId();

    if (existingId) {
      console.log(`Attempting to resume session: ${existingId}`);
    } else {
      console.log("No existing session, creating new");
    }

    this.claudeProcess = this.spawnClaude(existingId);
    this.stdoutReader = (this.claudeProcess.stdout as ReadableStream<Uint8Array>).getReader();
    this.stdoutBuffer = "";

    const initId = existingId || "pending";
    writeLine({
      type: "session_init",
      session_id: initId,
      ipc_version: 2,
    });

    if (existingId) {
      await this.persistSessionId(existingId);
      this.sessionIdPersisted = true;
    }
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

        // Persist session_id from system/init per D04.
        if (routeResult.sessionId && !this.sessionIdPersisted) {
          this.sessionIdPersisted = true;
          this.persistSessionId(routeResult.sessionId).catch((err: unknown) =>
            console.error("Failed to persist session ID:", err)
          );
        }

        // Emit IPC messages from router.
        for (const ipcMsg of routeResult.messages) {
          writeLine(ipcMsg);
        }

        // Tier 2: delegate stream_event inner payload to mapStreamEvent().
        if (routeResult.streamEvent) {
          const streamResult = mapStreamEvent(routeResult.streamEvent, ctx, partialText);
          for (const ipcMsg of streamResult.messages) {
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
   * Handle permission_mode: update permission manager.
   */
  handlePermissionMode(msg: PermissionModeMessage): void {
    console.log(`Setting permission mode: ${msg.mode}`);
    this.permissionManager.setMode(msg.mode);
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
      pluginDir: this.getTugtoolRoot(),
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
    this.sessionIdPersisted = false;

    writeLine({ type: "session_init", session_id: "pending-fork", ipc_version: 2 });
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
      pluginDir: this.getTugtoolRoot(),
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
    this.sessionIdPersisted = false;

    writeLine({ type: "session_init", session_id: "pending-continue", ipc_version: 2 });
  }

  /**
   * Start a fresh session with no prior history.
   * Kills current process and respawns without --resume.
   */
  async handleNewSession(): Promise<void> {
    await this.killAndCleanup();

    this.claudeProcess = this.spawnClaude(null);
    this.stdoutReader = (this.claudeProcess.stdout as ReadableStream<Uint8Array>).getReader();
    this.stdoutBuffer = "";
    this.sessionIdPersisted = false;

    writeLine({ type: "session_init", session_id: "pending", ipc_version: 2 });
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
   * Persist session ID to .tugtool/.session file.
   */
  private async persistSessionId(id: string): Promise<void> {
    const tugtoolDir = join(this.projectDir, ".tugtool");
    if (!(await exists(tugtoolDir))) {
      await mkdir(tugtoolDir, { recursive: true });
    }
    const sessionFile = join(tugtoolDir, ".session");
    await Bun.write(sessionFile, id);
    console.log(`Persisted session ID to ${sessionFile}`);
  }

  /**
   * Read session ID from .tugtool/.session file.
   */
  private async readSessionId(): Promise<string | null> {
    const sessionFile = join(this.projectDir, ".tugtool", ".session");
    if (await exists(sessionFile)) {
      const content = await Bun.file(sessionFile).text();
      return content.trim();
    }
    return null;
  }

  /**
   * Resolve the tugtool repo root from the binary location.
   */
  private getTugtoolRoot(): string {
    const execPath = process.execPath;
    if (execPath.includes("/target/")) {
      const root = resolve(dirname(execPath), "../..");
      console.log(`Tugtool root (from binary): ${root}`);
      return root;
    }
    const scriptPath = process.argv[1];
    if (scriptPath) {
      const root = resolve(dirname(scriptPath), "../..");
      console.log(`Tugtool root (from script): ${root}`);
      return root;
    }
    console.log(`Tugtool root (fallback to projectDir): ${this.projectDir}`);
    return this.projectDir;
  }
}
