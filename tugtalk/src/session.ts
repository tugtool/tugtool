// Session lifecycle management via direct claude CLI spawning

import { PermissionManager } from "./permissions.ts";
import { writeLine } from "./ipc.ts";
import type {
  UserMessage,
  ToolApproval,
  QuestionAnswer,
  PermissionModeMessage,
  OutboundMessage,
} from "./types.ts";
import { mkdir, exists } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// Exported pure functions for testability
// ---------------------------------------------------------------------------

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
  // Only one of sessionId, continue, or sessionIdOverride may be set.
  const sessionFlagCount = [
    !!config.sessionId,
    !!config.continue,
    !!config.sessionIdOverride,
  ].filter(Boolean).length;
  if (sessionFlagCount > 1) {
    throw new Error("Only one of sessionId, continue, or sessionIdOverride may be set");
  }

  // forkSession requires a base session to fork from (sessionId or continue).
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
 * Note: sessionId was removed -- session capture now happens in routeTopLevelEvent
 * via the top-level system/init event.
 */
export interface EventMappingResult {
  messages: OutboundMessage[];
  newRev: number;
  partialText: string;
  gotResult: boolean;
}

/**
 * Result metadata from a result event, stored for CostUpdate emission (Step 3).
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
  // If set, the caller should delegate to mapStreamEvent() for inner processing.
  streamEvent?: Record<string, unknown>;
  // If set, the caller should handle the permission/question control flow.
  controlRequest?: Record<string, unknown>;
  // Preserved from all 5 message types per PN-8 (#pn-parent-tool-use-id-scope).
  parentToolUseId?: string;
  // Cost/usage metadata from result events, emitted as CostUpdate in Step 3.
  resultMetadata?: ResultMetadata;
  // Raw system init metadata for SystemMetadata emission in Step 3.
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
        // Capture session_id from system/init per D04 (#d04-session-id-capture).
        const sid = event.session_id as string | undefined;
        if (sid) {
          sessionId = sid;
        }
        // Store raw system metadata for SystemMetadata emission in Step 3.
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
      } else if (subtype === "compact_boundary") {
        // Emit compact boundary marker. CompactBoundary type defined in Step 2.1.
        messages.push({ type: "compact_boundary" } as unknown as OutboundMessage);
      }
      break;
    }

    case "assistant": {
      // Complete assistant turn message per D03.
      const message = event.message as Record<string, unknown> | undefined;
      const content = (message?.content as Array<Record<string, unknown>>) || [];

      for (const block of content) {
        if (block.type === "text") {
          // Complete assistant text block.
          messages.push({
            type: "assistant_text",
            msg_id: ctx.msgId,
            seq: ctx.seq,
            rev: ctx.rev,
            text: (block.text as string) || "",
            is_partial: false,
            status: "complete",
          });
        } else if (block.type === "tool_use") {
          // Tool use block within assistant message.
          messages.push({
            type: "tool_use",
            msg_id: ctx.msgId,
            seq: ctx.seq,
            tool_name: (block.name as string) || "",
            tool_use_id: (block.id as string) || "",
            input: (block.input as object) || {},
          });
        } else if (block.type === "thinking") {
          // Extended thinking block per D12 (#d12-extended-thinking).
          // ThinkingText type defined in Step 2.1; cast for now.
          messages.push({
            type: "thinking_text",
            msg_id: ctx.msgId,
            seq: ctx.seq,
            text: (block.text as string) || "",
            is_partial: false,
            status: "complete",
          } as unknown as OutboundMessage);
        }
      }
      break;
    }

    case "user": {
      // Top-level user message; contains tool_result blocks from resolved tool calls.
      const message = event.message as Record<string, unknown> | undefined;
      const content = (message?.content as Array<Record<string, unknown>>) || [];

      for (const block of content) {
        if (block.type === "tool_result") {
          // Basic tool_result routing. Structured/slash extraction deferred to Step 2.3.
          const blockContent = block.content;
          let output = "";
          if (typeof blockContent === "string") {
            output = blockContent;
          } else if (Array.isArray(blockContent)) {
            // Content may be an array of content blocks; extract text blocks.
            output = (blockContent as Array<Record<string, unknown>>)
              .filter((b) => b.type === "text")
              .map((b) => b.text as string)
              .join("");
          }
          messages.push({
            type: "tool_result",
            tool_use_id: (block.tool_use_id as string) || "",
            output,
            is_error: block.is_error === true,
          });
        }
      }
      break;
    }

    case "result": {
      // Turn complete per D03. Extract subtype and cost metadata.
      gotResult = true;
      const subtype = (event.subtype as string) || "error";
      const resultText = event.result as string | undefined;

      // Detect API errors per PN-2 (#pn-api-error-subtype).
      let isApiError = false;
      if (subtype === "success" && typeof resultText === "string" && resultText.startsWith("API Error:")) {
        isApiError = true;
      }

      // Store cost/usage metadata for CostUpdate emission in Step 3.
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

      // If result has text content, emit assistant_text before turn_complete.
      if (typeof resultText === "string" && resultText.length > 0) {
        messages.push({
          type: "assistant_text",
          msg_id: ctx.msgId,
          seq: ctx.seq,
          rev: ctx.rev,
          text: resultText,
          is_partial: false,
          status: "complete",
        });
      }

      // Map subtype to "success" or "error" for backward compatibility.
      // Detailed subtype stored in resultMetadata.
      const resultValue = subtype === "success" ? "success" : "error";
      messages.push({
        type: "turn_complete",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        result: resultValue,
      });
      break;
    }

    case "stream_event": {
      // Unwrap the inner event for mapStreamEvent() delegation per D03.
      streamEvent = event.event as Record<string, unknown> | undefined;
      break;
    }

    case "control_request": {
      // Return for event loop handling (full flow in Step 2).
      controlRequest = event;
      break;
    }

    case "control_response": {
      // Acknowledgment of our outbound control request; no IPC emission needed.
      console.log(`Received control_response: ${JSON.stringify(event)}`);
      break;
    }

    case "keep_alive": {
      // Heartbeat; produce nothing.
      break;
    }

    case "control_cancel_request": {
      // Log the cancellation (actual dialog cancellation handled in Step 2).
      console.log(`Received control_cancel_request: ${JSON.stringify(event)}`);
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
    parentToolUseId,
    resultMetadata,
    systemMetadata,
  };
}

/**
 * Map a single stream-json inner event (from stream_event wrapper) to IPC messages.
 * Exported for unit testing per Step 1 strategy.
 * Per Table T01 (#t01-event-mapping).
 *
 * Note: session_id capture and assistant/result handling have been removed --
 * they are now handled by routeTopLevelEvent() at the top level.
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
    // Extract tool name from content_block_start/tool_use per PN-16 (#pn-block-start-tool-name).
    const contentBlock = event.content_block as Record<string, unknown> | undefined;
    if (contentBlock?.type === "tool_use") {
      messages.push({
        type: "tool_use",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        tool_name: (contentBlock.name as string) || "",
        tool_use_id: (contentBlock.id as string) || "",
        input: {},
      });
    }
  } else if (eventType === "content_block_delta") {
    // Streaming text/thinking delta per Table T01.
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
      });
    } else if (delta?.type === "thinking_delta" && typeof delta.text === "string") {
      // Extended thinking delta per D12 (#d12-extended-thinking).
      // ThinkingText type defined in Step 2.1; cast for now.
      messages.push({
        type: "thinking_text",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        text: delta.text,
        is_partial: true,
        status: "partial",
      } as unknown as OutboundMessage);
    }
  } else if (eventType === "tool_use") {
    // Direct tool_use event per Table T01.
    messages.push({
      type: "tool_use",
      msg_id: ctx.msgId,
      seq: ctx.seq,
      tool_name: event.name as string,
      tool_use_id: event.id as string,
      input: (event.input as object) || {},
    });
  } else if (eventType === "tool_result" || eventType === "tool_progress") {
    // Tool result/progress per Table T01.
    messages.push({
      type: "tool_result",
      tool_use_id: (event.tool_use_id as string) || "",
      output: (event.output as string) || "",
      is_error: event.is_error === true,
    });
  }
  // content_block_stop, message_start, message_delta, message_stop, user (replay)
  // are internal tracking events -- no IPC message emitted.

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
  private pendingApprovals = new Map<string, PendingRequest<"allow" | "deny">>();
  private pendingQuestions = new Map<string, PendingRequest<Record<string, string>>>();
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
   * Uses buildClaudeArgs() for argument construction.
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
   * Read the next complete line from the claude process stdout.
   * Returns null when stream ends.
   */
  private async readNextLine(): Promise<string | null> {
    if (!this.stdoutReader) {
      return null;
    }

    while (true) {
      // Check if we have a complete line in the buffer
      const lineEnd = this.stdoutBuffer.indexOf("\n");
      if (lineEnd >= 0) {
        const line = this.stdoutBuffer.slice(0, lineEnd).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1);
        if (line.length > 0) {
          return line;
        }
        // Empty line, continue reading
        continue;
      }

      // Read more data from the stream
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await this.stdoutReader.read();
      } catch {
        // Stream error - treat as end of stream
        return null;
      }

      if (result.done) {
        // Stream ended - return any remaining buffered content
        const remaining = this.stdoutBuffer.trim();
        this.stdoutBuffer = "";
        return remaining.length > 0 ? remaining : null;
      }

      this.stdoutBuffer += new TextDecoder().decode(result.value, { stream: true });
    }
  }

  /**
   * Initialize session: try to resume from persisted ID, fall back to create new.
   * Per D01/D02/D05.
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

    // Emit session_init with existing ID or "pending" for new sessions.
    // The real session ID will be captured from the system/init event during first message.
    const initId = existingId || "pending";
    writeLine({
      type: "session_init",
      session_id: initId,
    });

    if (existingId) {
      await this.persistSessionId(existingId);
      this.sessionIdPersisted = true;
    }
  }

  /**
   * Handle user_message: write to claude stdin, read and route top-level events,
   * delegate stream_event payloads to mapStreamEvent().
   * Two-tier routing per D03 (#d03-event-routing).
   */
  async handleUserMessage(msg: UserMessage): Promise<void> {
    if (!this.claudeProcess) {
      throw new Error("Session not initialized");
    }

    // Assign message ID and reset revision counter
    this.currentMsgId = this.newMsgId();
    this.currentRev = 0;
    const seq = this.nextSeq();
    this.interrupted = false;

    let partialText = "";
    let gotResult = false;

    // Write user message as stream-json input per Table T02 / D02 protocol reference.
    // Format: {type: "user", session_id: "", message: {role: "user", content: [...]}, parent_tool_use_id: null}
    const userInput = JSON.stringify({
      type: "user",
      session_id: "",
      message: {
        role: "user",
        content: [{ type: "text", text: msg.text }],
      },
      parent_tool_use_id: null,
    }) + "\n";
    const stdin = this.claudeProcess.stdin;
    stdin.write(userInput);
    stdin.flush();

    // Read and process stream-json events until result event.
    // Two-tier routing: routeTopLevelEvent() first, then mapStreamEvent() for stream_events.
    try {
      while (true) {
        const line = await this.readNextLine();

        if (line === null) {
          // Stream ended
          if (this.interrupted) {
            writeLine({
              type: "turn_cancelled",
              msg_id: this.currentMsgId!,
              seq,
              partial_result: partialText || "User interrupted",
            });
          } else if (!gotResult) {
            writeLine({
              type: "error",
              message: "Claude process stream ended unexpectedly",
              recoverable: true,
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

        // Persist session_id if captured from system/init event per D04.
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

        // Tier 2: if router returned a stream_event, delegate to mapStreamEvent().
        if (routeResult.streamEvent) {
          const streamResult = mapStreamEvent(routeResult.streamEvent, ctx, partialText);
          for (const ipcMsg of streamResult.messages) {
            writeLine(ipcMsg);
          }
          this.currentRev = streamResult.newRev;
          partialText = streamResult.partialText;
          // stream_events do not set gotResult; only top-level result events do.
        }

        // Log pending control_request (full handling in Step 2).
        if (routeResult.controlRequest) {
          console.log(`Received control_request (handling deferred to Step 2): ${JSON.stringify(routeResult.controlRequest)}`);
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
      });
    }
  }

  /**
   * Handle tool_approval: resolve pending approval promise.
   */
  handleToolApproval(msg: ToolApproval): void {
    const pending = this.pendingApprovals.get(msg.request_id);
    if (pending) {
      pending.resolve(msg.decision);
      this.pendingApprovals.delete(msg.request_id);
    } else {
      console.error(`No pending approval for request_id: ${msg.request_id}`);
    }
  }

  /**
   * Handle question_answer: resolve pending question promise.
   */
  handleQuestionAnswer(msg: QuestionAnswer): void {
    const pending = this.pendingQuestions.get(msg.request_id);
    if (pending) {
      pending.resolve(msg.answers);
      this.pendingQuestions.delete(msg.request_id);
    } else {
      console.error(`No pending question for request_id: ${msg.request_id}`);
    }
  }

  /**
   * Handle interrupt: send SIGINT to claude process per D09.
   */
  handleInterrupt(): void {
    if (this.claudeProcess) {
      console.log("Interrupting current turn via SIGINT");
      this.interrupted = true;
      this.claudeProcess.kill("SIGINT");
    } else {
      console.log("No active claude process to interrupt");
    }
  }

  /**
   * Handle permission_mode: update permission manager.
   */
  handlePermissionMode(msg: PermissionModeMessage): void {
    console.log(`Setting permission mode: ${msg.mode}`);
    this.permissionManager.setMode(msg.mode);
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
   * Compiled binary: <repo>/target/{profile}/tugtalk -> repo is 3 levels up.
   * Bun run: script is at <repo>/tugtalk/src/main.ts -> repo is 3 levels up from script.
   */
  private getTugtoolRoot(): string {
    const execPath = process.execPath;
    if (execPath.includes("/target/")) {
      // Compiled binary at <repo>/target/{profile}/tugtalk
      const root = resolve(dirname(execPath), "../..");
      console.log(`Tugtool root (from binary): ${root}`);
      return root;
    }
    // Running via bun run -- script path is in argv[1]: <repo>/tugtalk/src/main.ts
    const scriptPath = process.argv[1];
    if (scriptPath) {
      const root = resolve(dirname(scriptPath), "../..");
      console.log(`Tugtool root (from script): ${root}`);
      return root;
    }
    // Fallback to projectDir
    console.log(`Tugtool root (fallback to projectDir): ${this.projectDir}`);
    return this.projectDir;
  }
}
