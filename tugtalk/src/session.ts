// Session lifecycle management and SDK integration

import { createSDKAdapter, type AdapterSession } from "./sdk-adapter.ts";
import { PermissionManager } from "./permissions.ts";
import { writeLine } from "./ipc.ts";
import type {
  UserMessage,
  ToolApproval,
  QuestionAnswer,
  PermissionModeMessage,
} from "./types.ts";
import { mkdir, exists } from "node:fs/promises";
import { join } from "node:path";

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

/**
 * Manages SDK session lifecycle, message identity, and streaming.
 */
export class SessionManager {
  private adapter = createSDKAdapter();
  private session: AdapterSession | null = null;
  private permissionManager = new PermissionManager();
  private seq: number = 0;
  private pendingApprovals = new Map<string, PendingRequest<"allow" | "deny">>();
  private pendingQuestions = new Map<string, PendingRequest<Record<string, string>>>();
  private abortController: AbortController | null = null;
  private projectDir: string;
  private currentMsgId: string | null = null;
  private currentRev: number = 0;

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
   * Initialize session: try to resume from persisted ID, fall back to create new.
   */
  async initialize(): Promise<void> {
    const existingId = await this.readSessionId();

    try {
      if (existingId) {
        console.log(`Attempting to resume session: ${existingId}`);
        this.session = await this.adapter.resumeSession(existingId, {
          model: "claude-opus-4-6",
          cwd: this.projectDir,
          permissionMode: this.permissionManager.getMode(),
          canUseTool: this.createCanUseToolCallback(),
          onStderr: (data: string) => console.error("[sdk stderr]", data),
        });
        console.log(`Resumed session: ${this.session.sessionId}`);
      } else {
        throw new Error("No existing session");
      }
    } catch (err) {
      console.log(`Resume failed, creating new session: ${err}`);
      this.session = await this.adapter.createSession({
        model: "claude-opus-4-6",
        cwd: this.projectDir,
        permissionMode: this.permissionManager.getMode(),
        canUseTool: this.createCanUseToolCallback(),
        onStderr: (data: string) => console.error("[sdk stderr]", data),
      });
      console.log(`Created new session: ${this.session.sessionId}`);
    }

    // Persist session ID
    await this.persistSessionId(this.session.sessionId);

    // Emit session_init
    writeLine({
      type: "session_init",
      session_id: this.session.sessionId,
    });
  }

  /**
   * Handle user_message: send to SDK, stream responses.
   */
  async handleUserMessage(msg: UserMessage): Promise<void> {
    if (!this.session) {
      throw new Error("Session not initialized");
    }

    // Create abort controller for this turn
    this.abortController = new AbortController();

    // Assign message ID and reset revision counter
    this.currentMsgId = this.newMsgId();
    this.currentRev = 0;
    const seq = this.nextSeq();

    try {
      // Send message to SDK
      await this.session.send(msg.text);

      // Stream responses
      for await (const event of this.session.stream()) {
        // Handle different SDK message types
        if (this.isTextDelta(event)) {
          // Streaming text update
          writeLine({
            type: "assistant_text",
            msg_id: this.currentMsgId,
            seq,
            rev: this.currentRev++,
            text: this.extractTextDelta(event),
            is_partial: true,
            status: "partial",
          });
        } else if (this.isCompleteMessage(event)) {
          // Final message
          writeLine({
            type: "assistant_text",
            msg_id: this.currentMsgId,
            seq,
            rev: this.currentRev,
            text: this.extractCompleteText(event),
            is_partial: false,
            status: "complete",
          });

          // Extract tool uses
          const toolUses = this.extractToolUses(event);
          for (const tool of toolUses) {
            writeLine({
              type: "tool_use",
              msg_id: this.currentMsgId,
              seq,
              tool_name: tool.name,
              tool_use_id: tool.id,
              input: tool.input,
            });
          }
        } else if (this.isToolResult(event)) {
          writeLine({
            type: "tool_result",
            tool_use_id: this.extractToolResultId(event),
            output: this.extractToolResultOutput(event),
            is_error: this.isToolResultError(event),
          });
        } else if (this.isTurnComplete(event)) {
          writeLine({
            type: "turn_complete",
            msg_id: this.currentMsgId,
            seq,
            result: "success",
          });
          break;
        }
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        // Turn was cancelled
        writeLine({
          type: "turn_cancelled",
          msg_id: this.currentMsgId!,
          seq,
          partial_result: "User interrupted",
        });
      } else {
        // Actual error
        writeLine({
          type: "error",
          message: `Turn failed: ${err}`,
          recoverable: true,
        });
      }
    } finally {
      this.abortController = null;
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
   * Handle interrupt: abort current turn.
   */
  handleInterrupt(): void {
    if (this.abortController) {
      console.log("Interrupting current turn");
      this.abortController.abort();
    } else {
      console.log("No active turn to interrupt");
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
   * Create canUseTool callback for SDK.
   */
  private createCanUseToolCallback() {
    return this.permissionManager.createCanUseToolCallback(
      (toolName: string, input: unknown) => {
        const requestId = crypto.randomUUID();
        writeLine({
          type: "tool_approval_request",
          request_id: requestId,
          tool_name: toolName,
          input: input as object,
        });
        return requestId;
      },
      (requestId: string) => {
        return new Promise<"allow" | "deny">((resolve, reject) => {
          this.pendingApprovals.set(requestId, { resolve, reject });
        });
      }
    );
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

  // SDK message type guards and extractors (simplified stubs for Step 1)
  // Real implementation will need to map actual SDK types from @anthropic-ai/claude-agent-sdk

  private isTextDelta(event: unknown): boolean {
    const e = event as any;
    return e?.type === "stream_event" && e?.event?.type === "content_block_delta";
  }

  private extractTextDelta(event: unknown): string {
    const e = event as any;
    return e?.event?.delta?.text || "";
  }

  private isCompleteMessage(event: unknown): boolean {
    const e = event as any;
    return e?.type === "assistant";
  }

  private extractCompleteText(event: unknown): string {
    const e = event as any;
    return e?.content?.[0]?.text || "";
  }

  private extractToolUses(event: unknown): Array<{ name: string; id: string; input: object }> {
    const e = event as any;
    const toolBlocks = (e?.content || []).filter((block: any) => block.type === "tool_use");
    return toolBlocks.map((block: any) => ({
      name: block.name,
      id: block.id,
      input: block.input,
    }));
  }

  private isToolResult(event: unknown): boolean {
    const e = event as any;
    return e?.type === "tool_progress";
  }

  private extractToolResultId(event: unknown): string {
    const e = event as any;
    return e?.tool_use_id || "";
  }

  private extractToolResultOutput(event: unknown): string {
    const e = event as any;
    return e?.output || "";
  }

  private isToolResultError(event: unknown): boolean {
    const e = event as any;
    return e?.is_error === true;
  }

  private isTurnComplete(event: unknown): boolean {
    const e = event as any;
    return e?.type === "result";
  }
}
