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
import { join, dirname, resolve } from "node:path";

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
  private sessionIdPersisted: boolean = false;

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
    const claudePath = Bun.which("claude");
    if (!claudePath) {
      throw new Error("claude CLI not found on PATH");
    }
    console.log(`Using claude CLI at: ${claudePath}`);
    const sessionOpts = {
      model: "claude-opus-4-6",
      cwd: this.projectDir,
      permissionMode: this.permissionManager.getMode(),
      canUseTool: this.createCanUseToolCallback(),
      onStderr: (data: string) => console.error("[sdk stderr]", data),
      pathToClaudeCodeExecutable: claudePath,
      plugins: [{ type: "local" as const, path: this.getTugtoolRoot() }],
    };

    try {
      if (existingId) {
        console.log(`Attempting to resume session: ${existingId}`);
        this.session = await this.adapter.resumeSession(existingId, sessionOpts);
        console.log(`Resumed session: ${existingId}`);
      } else {
        throw new Error("No existing session");
      }
    } catch (err) {
      console.log(`Resume failed, creating new session: ${err}`);
      this.session = await this.adapter.createSession(sessionOpts);
      console.log("Created new session (ID available after first message)");
    }

    // Emit session_init — sessionId may be empty for new sessions until
    // the first streamed message arrives (SDK populates it lazily).
    // We'll persist the real ID once we see it in handleUserMessage.
    const initId = this.session.sessionId || "pending";
    writeLine({
      type: "session_init",
      session_id: initId,
    });
    if (initId !== "pending") {
      await this.persistSessionId(initId);
    }
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
        const e = event as any;

        // Capture session_id from any message (SDK populates lazily)
        if (e?.session_id && !this.sessionIdPersisted) {
          this.sessionIdPersisted = true;
          this.persistSessionId(e.session_id).catch((err: unknown) =>
            console.error("Failed to persist session ID:", err)
          );
        }

        if (e?.type === "stream_event") {
          // Streaming text delta (requires includePartialMessages: true)
          const delta = e?.event?.delta;
          if (delta?.type === "text_delta" && delta?.text) {
            writeLine({
              type: "assistant_text",
              msg_id: this.currentMsgId,
              seq,
              rev: this.currentRev++,
              text: delta.text,
              is_partial: true,
              status: "partial",
            });
          }
        } else if (e?.type === "assistant") {
          // Complete assistant message — text is at e.message.content
          const content = e?.message?.content || [];
          const text = content
            .filter((block: any) => block.type === "text")
            .map((block: any) => block.text)
            .join("");

          writeLine({
            type: "assistant_text",
            msg_id: this.currentMsgId,
            seq,
            rev: this.currentRev,
            text,
            is_partial: false,
            status: "complete",
          });

          // Extract tool uses from the same message content
          const toolBlocks = content.filter((block: any) => block.type === "tool_use");
          for (const tool of toolBlocks) {
            writeLine({
              type: "tool_use",
              msg_id: this.currentMsgId,
              seq,
              tool_name: tool.name,
              tool_use_id: tool.id,
              input: tool.input,
            });
          }
        } else if (e?.type === "tool_progress") {
          writeLine({
            type: "tool_result",
            tool_use_id: e?.tool_use_id || "",
            output: e?.output || "",
            is_error: e?.is_error === true,
          });
        } else if (e?.type === "result") {
          // Emit result text if present (e.g. slash command output)
          const resultText = e?.result;
          if (typeof resultText === "string" && resultText.length > 0) {
            writeLine({
              type: "assistant_text",
              msg_id: this.currentMsgId,
              seq,
              rev: this.currentRev++,
              text: resultText,
              is_partial: false,
              status: "complete",
            });
          }

          const result = e?.subtype === "success" ? "success" : "error";
          writeLine({
            type: "turn_complete",
            msg_id: this.currentMsgId,
            seq,
            result,
          });
          break;
        } else {
          console.log(`Unhandled event type=${e?.type} subtype=${e?.subtype ?? "none"}`);
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

  /**
   * Resolve the tugtool repo root from the binary location.
   * Compiled binary: <repo>/target/{profile}/tugtalk → repo is 3 levels up.
   * Bun run: script is at <repo>/tugtalk/src/main.ts → repo is 3 levels up from script.
   */
  private getTugtoolRoot(): string {
    const execPath = process.execPath;
    if (execPath.includes("/target/")) {
      // Compiled binary at <repo>/target/{profile}/tugtalk
      const root = resolve(dirname(execPath), "../..");
      console.log(`Tugtool root (from binary): ${root}`);
      return root;
    }
    // Running via bun run — script path is in argv[1]: <repo>/tugtalk/src/main.ts
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
