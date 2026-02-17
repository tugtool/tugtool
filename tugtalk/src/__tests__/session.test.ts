import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SessionManager, buildClaudeArgs, mapStreamEvent } from "../session.ts";
import type { EventMappingContext } from "../session.ts";
import { join } from "node:path";
import { rm, exists } from "node:fs/promises";
import type { ToolApproval, QuestionAnswer } from "../types.ts";

describe("session.ts", () => {
  const testDir = "/tmp/tugtalk-test-" + Date.now();

  beforeEach(async () => {
    // Clean test directory
    if (await exists(testDir)) {
      await rm(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up
    if (await exists(testDir)) {
      await rm(testDir, { recursive: true });
    }
  });

  test("SessionManager constructor does not throw", () => {
    expect(() => new SessionManager(testDir)).not.toThrow();
  });

  test("sessionId persistence", async () => {
    // Testing file I/O only -- no claude CLI spawning needed
    const sessionFilePath = join(testDir, ".tugtool", ".session");

    // Manually write a session ID
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(testDir, ".tugtool"), { recursive: true });
    await Bun.write(sessionFilePath, "test-session-123");

    // Verify it can be read
    const content = await Bun.file(sessionFilePath).text();
    expect(content).toBe("test-session-123");
  });

  test("handleToolApproval resolves pending promise", () => {
    const manager = new SessionManager(testDir);

    // Simulate adding a pending approval
    const pendingApprovals = (manager as any).pendingApprovals;
    const requestId = "test-req-123";

    let resolvedValue: string | null = null;
    const promise = new Promise<"allow" | "deny">((resolve) => {
      pendingApprovals.set(requestId, { resolve, reject: () => {} });
    });

    promise.then((val) => {
      resolvedValue = val;
    });

    // Handle approval
    const approvalMsg: ToolApproval = {
      type: "tool_approval",
      request_id: requestId,
      decision: "allow",
    };

    manager.handleToolApproval(approvalMsg);

    // Verify promise was resolved
    return promise.then(() => {
      expect(resolvedValue).toBe("allow");
      expect(pendingApprovals.has(requestId)).toBe(false);
    });
  });

  test("handleQuestionAnswer resolves pending promise", () => {
    const manager = new SessionManager(testDir);

    const pendingQuestions = (manager as any).pendingQuestions;
    const requestId = "test-quest-456";

    let resolvedValue: Record<string, string> | null = null;
    const promise = new Promise<Record<string, string>>((resolve) => {
      pendingQuestions.set(requestId, { resolve, reject: () => {} });
    });

    promise.then((val) => {
      resolvedValue = val;
    });

    // Handle answer
    const answerMsg: QuestionAnswer = {
      type: "question_answer",
      request_id: requestId,
      answers: { q1: "answer1", q2: "answer2" },
    };

    manager.handleQuestionAnswer(answerMsg);

    // Verify promise was resolved
    return promise.then(() => {
      expect(resolvedValue).toEqual({ q1: "answer1", q2: "answer2" });
      expect(pendingQuestions.has(requestId)).toBe(false);
    });
  });

  test("handleInterrupt when no active process", () => {
    const manager = new SessionManager(testDir);

    // Should not throw -- no claudeProcess means it logs and returns
    expect(() => manager.handleInterrupt()).not.toThrow();
  });

  test("permission mode handling", () => {
    const manager = new SessionManager(testDir);

    // Should not throw
    expect(() =>
      manager.handlePermissionMode({ type: "permission_mode", mode: "default" })
    ).not.toThrow();

    expect(() =>
      manager.handlePermissionMode({ type: "permission_mode", mode: "plan" })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildClaudeArgs tests
// ---------------------------------------------------------------------------

describe("buildClaudeArgs", () => {
  test("new session includes all required flags and -p", () => {
    const args = buildClaudeArgs({
      pluginDir: "/repo/root",
      model: "claude-opus-4-6",
      permissionMode: "acceptEdits",
      sessionId: null,
    });

    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--input-format");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--replay-user-messages");
    expect(args).toContain("--plugin-dir");
    expect(args).toContain("/repo/root");
    expect(args).toContain("--model");
    expect(args).toContain("claude-opus-4-6");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("acceptEdits");
    expect(args).toContain("-p");
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--session-id");
  });

  test("resumed session includes --resume --session-id, not -p", () => {
    const args = buildClaudeArgs({
      pluginDir: "/repo/root",
      model: "claude-opus-4-6",
      permissionMode: "acceptEdits",
      sessionId: "sess-abc-123",
    });

    expect(args).toContain("--resume");
    expect(args).toContain("--session-id");
    expect(args).toContain("sess-abc-123");
    expect(args).not.toContain("-p");
  });

  test("--plugin-dir value matches provided pluginDir", () => {
    const args = buildClaudeArgs({
      pluginDir: "/custom/plugin/path",
      model: "claude-opus-4-6",
      permissionMode: "default",
      sessionId: null,
    });

    const pluginDirIndex = args.indexOf("--plugin-dir");
    expect(pluginDirIndex).toBeGreaterThan(-1);
    expect(args[pluginDirIndex + 1]).toBe("/custom/plugin/path");
  });

  test("--permission-mode value matches provided mode for all modes", () => {
    for (const mode of ["default", "acceptEdits", "bypassPermissions", "plan"]) {
      const args = buildClaudeArgs({
        pluginDir: "/repo",
        model: "claude-opus-4-6",
        permissionMode: mode,
        sessionId: null,
      });

      const modeIndex = args.indexOf("--permission-mode");
      expect(modeIndex).toBeGreaterThan(-1);
      expect(args[modeIndex + 1]).toBe(mode);
    }
  });

  test("--output-format and --input-format are both stream-json", () => {
    const args = buildClaudeArgs({
      pluginDir: "/repo",
      model: "claude-opus-4-6",
      permissionMode: "acceptEdits",
      sessionId: null,
    });

    const outputFmtIdx = args.indexOf("--output-format");
    expect(outputFmtIdx).toBeGreaterThan(-1);
    expect(args[outputFmtIdx + 1]).toBe("stream-json");

    const inputFmtIdx = args.indexOf("--input-format");
    expect(inputFmtIdx).toBeGreaterThan(-1);
    expect(args[inputFmtIdx + 1]).toBe("stream-json");
  });

  test("--session-id value matches provided sessionId", () => {
    const args = buildClaudeArgs({
      pluginDir: "/repo",
      model: "claude-opus-4-6",
      permissionMode: "acceptEdits",
      sessionId: "my-session-id-xyz",
    });

    const sessionIdIdx = args.indexOf("--session-id");
    expect(sessionIdIdx).toBeGreaterThan(-1);
    expect(args[sessionIdIdx + 1]).toBe("my-session-id-xyz");
  });
});

// ---------------------------------------------------------------------------
// mapStreamEvent tests
// ---------------------------------------------------------------------------

describe("mapStreamEvent", () => {
  const baseCtx: EventMappingContext = { msgId: "msg-1", seq: 0, rev: 0 };

  test("content_block_delta maps to assistant_text with is_partial: true", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello " },
    };
    const result = mapStreamEvent(event, baseCtx, "");

    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0];
    expect(msg.type).toBe("assistant_text");
    expect((msg as any).is_partial).toBe(true);
    expect((msg as any).text).toBe("Hello ");
    expect((msg as any).status).toBe("partial");
    expect(result.partialText).toBe("Hello ");
    expect(result.newRev).toBe(1);
    expect(result.gotResult).toBe(false);
  });

  test("content_block_delta accumulates partial text correctly", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "world" },
    };
    const result = mapStreamEvent(event, { ...baseCtx, rev: 3 }, "Hello ");

    expect(result.partialText).toBe("Hello world");
    expect(result.newRev).toBe(4);
    expect((result.messages[0] as any).rev).toBe(3);
  });

  test("content_block_delta with non-text delta produces no messages", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: "{" },
    };
    const result = mapStreamEvent(event, baseCtx, "");

    expect(result.messages).toHaveLength(0);
    expect(result.gotResult).toBe(false);
  });

  test("assistant event maps to assistant_text with is_partial: false", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Full response here" },
        ],
      },
    };
    const result = mapStreamEvent(event, baseCtx, "");

    const textMsgs = result.messages.filter((m) => m.type === "assistant_text");
    expect(textMsgs.length).toBeGreaterThanOrEqual(1);
    expect((textMsgs[0] as any).is_partial).toBe(false);
    expect((textMsgs[0] as any).text).toBe("Full response here");
    expect((textMsgs[0] as any).status).toBe("complete");
    expect(result.gotResult).toBe(false);
  });

  test("assistant event with multiple text blocks concatenates them", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Part one. " },
          { type: "text", text: "Part two." },
        ],
      },
    };
    const result = mapStreamEvent(event, baseCtx, "");

    const textMsgs = result.messages.filter((m) => m.type === "assistant_text");
    expect(textMsgs.length).toBe(1);
    expect((textMsgs[0] as any).text).toBe("Part one. Part two.");
  });

  test("assistant event with tool_use blocks emits tool_use IPC messages", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me read that file." },
          { type: "tool_use", name: "Read", id: "tu-1", input: { path: "/a.ts" } },
        ],
      },
    };
    const result = mapStreamEvent(event, baseCtx, "");

    const toolMsgs = result.messages.filter((m) => m.type === "tool_use");
    expect(toolMsgs.length).toBe(1);
    expect((toolMsgs[0] as any).tool_name).toBe("Read");
    expect((toolMsgs[0] as any).tool_use_id).toBe("tu-1");
    expect((toolMsgs[0] as any).input).toEqual({ path: "/a.ts" });
  });

  test("result event with success subtype maps to turn_complete with result: success", () => {
    const event = {
      type: "result",
      subtype: "success",
      result: "",
    };
    const result = mapStreamEvent(event, baseCtx, "");

    const turnMsgs = result.messages.filter((m) => m.type === "turn_complete");
    expect(turnMsgs.length).toBe(1);
    expect((turnMsgs[0] as any).result).toBe("success");
    expect(result.gotResult).toBe(true);
  });

  test("result event with error subtype maps to turn_complete with result: error", () => {
    const event = {
      type: "result",
      subtype: "error",
    };
    const result = mapStreamEvent(event, baseCtx, "");

    const turnMsgs = result.messages.filter((m) => m.type === "turn_complete");
    expect(turnMsgs.length).toBe(1);
    expect((turnMsgs[0] as any).result).toBe("error");
    expect(result.gotResult).toBe(true);
  });

  test("result event with result text emits assistant_text before turn_complete", () => {
    const event = {
      type: "result",
      subtype: "success",
      result: "Slash command output text",
    };
    const result = mapStreamEvent(event, baseCtx, "");

    expect(result.messages.length).toBe(2);
    expect(result.messages[0].type).toBe("assistant_text");
    expect((result.messages[0] as any).text).toBe("Slash command output text");
    expect((result.messages[0] as any).is_partial).toBe(false);
    expect(result.messages[1].type).toBe("turn_complete");
    expect(result.gotResult).toBe(true);
  });

  test("tool_use event maps to tool_use IPC message", () => {
    const event = {
      type: "tool_use",
      name: "Read",
      id: "tool-xyz-123",
      input: { file: "test.ts" },
    };
    const result = mapStreamEvent(event, baseCtx, "");

    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0];
    expect(msg.type).toBe("tool_use");
    expect((msg as any).tool_name).toBe("Read");
    expect((msg as any).tool_use_id).toBe("tool-xyz-123");
    expect((msg as any).input).toEqual({ file: "test.ts" });
    expect(result.gotResult).toBe(false);
  });

  test("tool_result event maps to tool_result IPC message", () => {
    const event = {
      type: "tool_result",
      tool_use_id: "tu-abc",
      output: "file contents here",
      is_error: false,
    };
    const result = mapStreamEvent(event, baseCtx, "");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].type).toBe("tool_result");
    expect((result.messages[0] as any).tool_use_id).toBe("tu-abc");
    expect((result.messages[0] as any).output).toBe("file contents here");
    expect((result.messages[0] as any).is_error).toBe(false);
  });

  test("tool_progress event maps to tool_result IPC message", () => {
    const event = {
      type: "tool_progress",
      tool_use_id: "tu-progress",
      output: "progress output",
      is_error: false,
    };
    const result = mapStreamEvent(event, baseCtx, "");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].type).toBe("tool_result");
    expect((result.messages[0] as any).tool_use_id).toBe("tu-progress");
  });

  test("session_id is captured and returned from event", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hi" },
      session_id: "captured-session-id-abc",
    };
    const result = mapStreamEvent(event, baseCtx, "");

    expect(result.sessionId).toBe("captured-session-id-abc");
  });

  test("session_id captured from result event", () => {
    const event = {
      type: "result",
      subtype: "success",
      result: "",
      session_id: "result-session-id",
    };
    const result = mapStreamEvent(event, baseCtx, "");

    expect(result.sessionId).toBe("result-session-id");
  });

  test("known internal events produce no messages", () => {
    const internalEvents = [
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_start", message: {} },
      { type: "message_delta", delta: {} },
      { type: "message_stop" },
    ];

    for (const event of internalEvents) {
      const result = mapStreamEvent(event, baseCtx, "");
      expect(result.messages).toHaveLength(0);
      expect(result.gotResult).toBe(false);
    }
  });

  test("msg_id and seq from context are preserved in output messages", () => {
    const ctx: EventMappingContext = { msgId: "test-msg-id-99", seq: 42, rev: 7 };
    const event = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "test" },
    };
    const result = mapStreamEvent(event, ctx, "");

    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as any).msg_id).toBe("test-msg-id-99");
    expect((result.messages[0] as any).seq).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Interrupt and process exit behavior tests
// ---------------------------------------------------------------------------

/**
 * Build a mock subprocess suitable for injection into SessionManager.
 *
 * stdoutLines: JSON-serialisable objects to emit as newline-delimited JSON on
 *              stdout.  The stream closes after all lines are written.
 *
 * Returns { mockProcess, capturedOutput } where capturedOutput accumulates
 * every JSON line written by writeLine() during handleUserMessage().
 *
 * Implementation notes:
 *   - claudeProcess.stdin is mocked with a no-op WritableStream so the
 *     TextEncoder write in handleUserMessage() does not throw.
 *   - claudeProcess.kill is a no-op spy so handleInterrupt() does not throw.
 *   - stdoutReader is injected directly onto the manager after construction;
 *     claudeProcess.stdout is never read by SessionManager once the reader is
 *     already populated (initialize() sets stdoutReader; we bypass initialize()
 *     by injecting both claudeProcess and stdoutReader directly).
 *   - writeLine() in ipc.ts writes to Bun.stdout.  We intercept the IPC
 *     output by replacing writeLine with a spy via the module boundary — but
 *     since writeLine is imported directly into session.ts we cannot easily
 *     monkey-patch it from here.  Instead, we read what handleUserMessage()
 *     does by observing the IPC messages through a secondary channel: we
 *     replace Bun.write to capture writes to Bun.stdout.  This is the
 *     simplest approach that stays within the existing architecture.
 */
function makeMockSubprocess(stdoutLines: unknown[]): {
  mockProcess: Record<string, unknown>;
  mockReader: ReadableStreamDefaultReader<Uint8Array>;
} {
  // Build a single Uint8Array of all newline-terminated JSON lines
  const encoder = new TextEncoder();
  const allBytes = stdoutLines
    .map((obj) => encoder.encode(JSON.stringify(obj) + "\n"))
    .reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc, 0);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array(0));

  // Construct a ReadableStream that yields allBytes in one chunk then closes
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (allBytes.length > 0) {
        controller.enqueue(allBytes);
      }
      controller.close();
    },
  });

  const mockReader = stream.getReader();

  // No-op WritableStream for stdin
  const noopWritable = new WritableStream<Uint8Array>({
    write() {},
  });

  const mockProcess: Record<string, unknown> = {
    stdin: noopWritable,
    stdout: stream, // not used by SessionManager once reader is injected
    kill: (_signal: string) => {},
  };

  return { mockProcess, mockReader };
}

/**
 * Inject a mock subprocess into a SessionManager instance, bypassing
 * initialize().  Sets both claudeProcess and stdoutReader directly so
 * handleUserMessage() can run against controlled stdout content.
 */
function injectMockSubprocess(
  manager: SessionManager,
  stdoutLines: unknown[]
): void {
  const { mockProcess, mockReader } = makeMockSubprocess(stdoutLines);
  (manager as any).claudeProcess = mockProcess;
  (manager as any).stdoutReader = mockReader;
  (manager as any).stdoutBuffer = "";
  (manager as any).currentMsgId = "mock-msg-id";
}

/**
 * Capture IPC output written to Bun.stdout during an async operation.
 * writeLine() in ipc.ts calls Bun.write(Bun.stdout, json + "\n").
 * We intercept by temporarily replacing Bun.write.
 */
async function captureIpcOutput(fn: () => Promise<void>): Promise<unknown[]> {
  const captured: unknown[] = [];
  const originalWrite = Bun.write;
  const decoder = new TextDecoder();

  // Bun.write is typed as an overloaded function; cast to any for mocking
  (Bun as any).write = (dest: unknown, data: unknown) => {
    if (dest === Bun.stdout && typeof data === "string") {
      for (const line of data.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          try {
            captured.push(JSON.parse(trimmed));
          } catch {
            // ignore non-JSON lines
          }
        }
      }
    } else if (dest === Bun.stdout && data instanceof Uint8Array) {
      const text = decoder.decode(data);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          try {
            captured.push(JSON.parse(trimmed));
          } catch {
            // ignore non-JSON lines
          }
        }
      }
    }
    // Always return a resolved promise (Bun.write returns Promise<number>)
    return Promise.resolve(data instanceof Uint8Array ? data.length : (data as string).length);
  };

  try {
    await fn();
  } finally {
    (Bun as any).write = originalWrite;
  }

  return captured;
}

describe("interrupt and process exit", () => {
  test("handleInterrupt sets interrupted flag and calls kill with SIGINT", () => {
    const manager = new SessionManager("/tmp/test-interrupt-" + Date.now());

    // Mock a claudeProcess with a kill spy
    let killCalled = false;
    let killSignal: string | null = null;
    (manager as any).claudeProcess = {
      kill: (signal: string) => {
        killCalled = true;
        killSignal = signal;
      },
    };

    manager.handleInterrupt();

    expect((manager as any).interrupted).toBe(true);
    expect(killCalled).toBe(true);
    expect(killSignal).toBe("SIGINT");
  });

  test("handleInterrupt with no process does not set interrupted flag", () => {
    const manager = new SessionManager("/tmp/test-interrupt-noproc-" + Date.now());

    expect((manager as any).claudeProcess).toBeNull();
    expect(() => manager.handleInterrupt()).not.toThrow();
    // interrupted flag should remain false when no process exists
    expect((manager as any).interrupted).toBe(false);
  });

  test("mapStreamEvent turn_complete marks gotResult true to break event loop", () => {
    // Verifies that the result event sets gotResult, which signals handleUserMessage
    // to break out of the reading loop. This is the mechanism by which a clean
    // end-of-turn is detected vs an interrupted/crashed stream.
    const ctx: EventMappingContext = { msgId: "msg-loop", seq: 0, rev: 0 };
    const event = { type: "result", subtype: "success", result: "" };
    const result = mapStreamEvent(event, ctx, "");
    expect(result.gotResult).toBe(true);
  });

  test("non-result events do not set gotResult (loop continues)", () => {
    const ctx: EventMappingContext = { msgId: "msg-loop", seq: 0, rev: 0 };
    const events = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
      { type: "assistant", message: { content: [] } },
      { type: "tool_use", name: "Read", id: "t1", input: {} },
      { type: "message_start" },
    ];

    for (const event of events) {
      const result = mapStreamEvent(event, ctx, "");
      expect(result.gotResult).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // handleUserMessage loop tests (issues 1, 2, 3 from reviewer)
  // -------------------------------------------------------------------------

  test("interrupt with interrupted=true and no result event produces turn_cancelled", async () => {
    // Issue 1: stream closes without a result event while interrupted===true
    // Expected: handleUserMessage emits turn_cancelled
    //
    // handleUserMessage resets this.interrupted=false at entry. To simulate a
    // concurrent handleInterrupt() call we override the private readNextLine
    // method so that when it returns null (stream end), it has already set the
    // interrupted flag — exactly as would happen when handleInterrupt() fires
    // during async reading.
    const manager = new SessionManager("/tmp/test-loop-cancel-" + Date.now());
    injectMockSubprocess(manager, []);

    // Override readNextLine: first call returns a partial delta line,
    // second call sets interrupted=true (simulating handleInterrupt()) and
    // then returns null (stream end).
    let readCallCount = 0;
    const partialLine = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "partial" },
    });
    (manager as any).readNextLine = async () => {
      readCallCount++;
      if (readCallCount === 1) return partialLine;
      // Simulate handleInterrupt() firing between reads
      (manager as any).interrupted = true;
      return null;
    };

    const userMsg = { type: "user_message" as const, text: "hello", attachments: [] };
    const ipcMessages = await captureIpcOutput(() => manager.handleUserMessage(userMsg));

    const cancelled = ipcMessages.filter((m: any) => m.type === "turn_cancelled");
    expect(cancelled.length).toBe(1);
    expect((cancelled[0] as any).partial_result).toBe("partial");
  });

  test("unexpected process exit with interrupted=false produces error IPC message", async () => {
    // Issue 2: stream closes without a result event and interrupted===false
    // Expected: handleUserMessage emits error with recoverable: true
    const manager = new SessionManager("/tmp/test-loop-crash-" + Date.now());

    // Inject a mock that emits one delta then closes (no result event)
    injectMockSubprocess(manager, [
      { type: "content_block_delta", delta: { type: "text_delta", text: "partial before crash" } },
    ]);

    // interrupted remains false (default) -- simulates unexpected process crash

    const userMsg = { type: "user_message" as const, text: "hello", attachments: [] };
    const ipcMessages = await captureIpcOutput(() => manager.handleUserMessage(userMsg));

    const errors = ipcMessages.filter((m: any) => m.type === "error");
    expect(errors.length).toBe(1);
    expect((errors[0] as any).recoverable).toBe(true);
    expect((errors[0] as any).message).toContain("unexpectedly");
  });

  test("full IPC round-trip with mocked claude process (integration)", async () => {
    // Issue 3: integration test exercising the full handleUserMessage loop
    // with a mock subprocess that emits a realistic sequence of stream-json
    // events (partial deltas, assistant message, result) then closes.
    const manager = new SessionManager("/tmp/test-loop-roundtrip-" + Date.now());

    const streamEvents = [
      // Partial streaming deltas
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
      // Complete assistant message
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
        session_id: "mock-session-abc",
      },
      // Turn complete
      { type: "result", subtype: "success", result: "" },
    ];

    injectMockSubprocess(manager, streamEvents);

    const userMsg = { type: "user_message" as const, text: "say hello", attachments: [] };
    const ipcMessages = await captureIpcOutput(() => manager.handleUserMessage(userMsg));

    // Should have: 2 partial assistant_text, 1 complete assistant_text, 1 turn_complete
    const partials = ipcMessages.filter(
      (m: any) => m.type === "assistant_text" && m.is_partial === true
    );
    const completes = ipcMessages.filter(
      (m: any) => m.type === "assistant_text" && m.is_partial === false
    );
    const turnCompletes = ipcMessages.filter((m: any) => m.type === "turn_complete");
    const errors = ipcMessages.filter((m: any) => m.type === "error");

    expect(errors.length).toBe(0);
    expect(partials.length).toBe(2);
    expect((partials[0] as any).text).toBe("Hello ");
    expect((partials[1] as any).text).toBe("world");
    expect(completes.length).toBeGreaterThanOrEqual(1);
    expect((completes[0] as any).text).toBe("Hello world");
    expect(turnCompletes.length).toBe(1);
    expect((turnCompletes[0] as any).result).toBe("success");
  });
});
