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
}

/**
 * Build the CLI argument array for spawning the claude process.
 * Exported for unit testing per Step 1 strategy.
 * Per Spec S01 (#s01-spawn-args).
 */
export function buildClaudeArgs(config: ClaudeSpawnConfig): string[] {
  const args: string[] = [
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--replay-user-messages",
    "--plugin-dir", config.pluginDir,
    "--model", config.model,
    "--permission-mode", config.permissionMode,
  ];

  if (config.sessionId) {
    args.push("--resume", config.sessionId);
  }

  return args;
}

/**
 * Context passed to mapStreamEvent for IPC message construction.
 */
export interface EventMappingContext {
  msgId: string;
  seq: number;
  rev: number;
}

/**
 * Result of mapping a single stream-json event to IPC outbound messages.
 */
export interface EventMappingResult {
  messages: OutboundMessage[];
  newRev: number;
  partialText: string;
  gotResult: boolean;
  sessionId?: string;
}

/**
 * Map a single stream-json event to zero or more IPC outbound messages.
 * Exported for unit testing per Step 1 strategy.
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
  let sessionId: string | undefined;

  const eventType = event.type as string | undefined;

  // Capture session_id from any event that has it
  const eventSessionId = event.session_id as string | undefined;
  if (eventSessionId) {
    sessionId = eventSessionId;
  }

  if (eventType === "content_block_delta") {
    // Streaming text delta per Table T01
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
    }
  } else if (eventType === "assistant") {
    // Complete assistant message per Table T01
    const message = event.message as Record<string, unknown> | undefined;
    const content = (message?.content as Array<Record<string, unknown>>) || [];
    const text = content
      .filter((block) => block.type === "text")
      .map((block) => block.text as string)
      .join("");

    messages.push({
      type: "assistant_text",
      msg_id: ctx.msgId,
      seq: ctx.seq,
      rev: newRev,
      text,
      is_partial: false,
      status: "complete",
    });

    // Extract tool uses from message content
    const toolBlocks = content.filter((block) => block.type === "tool_use");
    for (const tool of toolBlocks) {
      messages.push({
        type: "tool_use",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        tool_name: tool.name as string,
        tool_use_id: tool.id as string,
        input: tool.input as object,
      });
    }
  } else if (eventType === "tool_use") {
    // Direct tool_use event per Table T01
    messages.push({
      type: "tool_use",
      msg_id: ctx.msgId,
      seq: ctx.seq,
      tool_name: event.name as string,
      tool_use_id: event.id as string,
      input: (event.input as object) || {},
    });
  } else if (eventType === "tool_result" || eventType === "tool_progress") {
    // Tool result/progress per Table T01
    messages.push({
      type: "tool_result",
      tool_use_id: (event.tool_use_id as string) || "",
      output: (event.output as string) || "",
      is_error: event.is_error === true,
    });
  } else if (eventType === "result") {
    // Turn complete per Table T01
    const resultText = event.result as string | undefined;
    if (typeof resultText === "string" && resultText.length > 0) {
      messages.push({
        type: "assistant_text",
        msg_id: ctx.msgId,
        seq: ctx.seq,
        rev: newRev++,
        text: resultText,
        is_partial: false,
        status: "complete",
      });
    }

    const result = event.subtype === "success" ? "success" : "error";
    messages.push({
      type: "turn_complete",
      msg_id: ctx.msgId,
      seq: ctx.seq,
      result,
    });
    gotResult = true;
  }
  // Other event types (content_block_start, content_block_stop, message_start,
  // message_delta, message_stop) are internal tracking events -- no IPC message emitted.

  return { messages, newRev, partialText, gotResult, sessionId };
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
    // The real session ID will be captured from stream events during first message.
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
   * Handle user_message: write to claude stdin, read and map stream-json events to IPC.
   * Uses mapStreamEvent() for event-to-IPC mapping per Table T01.
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

    // Write user message as stream-json input per Table T02
    const userInput = JSON.stringify({ type: "user_message", text: msg.text }) + "\n";
    const stdin = this.claudeProcess.stdin;
    stdin.write(userInput);
    stdin.flush();

    // Read and process stream-json events until result event
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

        const result = mapStreamEvent(event, ctx, partialText);

        // Persist session_id if captured for the first time
        if (result.sessionId && !this.sessionIdPersisted) {
          this.sessionIdPersisted = true;
          this.persistSessionId(result.sessionId).catch((err: unknown) =>
            console.error("Failed to persist session ID:", err)
          );
        }

        // Emit all mapped IPC messages
        for (const ipcMsg of result.messages) {
          writeLine(ipcMsg);
        }

        // Update state from mapping result
        this.currentRev = result.newRev;
        partialText = result.partialText;
        gotResult = result.gotResult;

        if (gotResult) {
          break;
        }

        // Log unhandled event types (no messages produced and not a known internal type)
        if (result.messages.length === 0) {
          const eventType = event.type as string | undefined;
          const knownInternalTypes = new Set([
            "content_block_start", "content_block_stop",
            "message_start", "message_delta", "message_stop",
            // replay events from --replay-user-messages
            "user",
          ]);
          if (eventType && !knownInternalTypes.has(eventType)) {
            console.log(`Unhandled stream-json event type=${eventType} subtype=${(event.subtype as string | undefined) ?? "none"}`);
          }
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
