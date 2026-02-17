import { describe, test, expect } from "bun:test";
import { SessionManager, buildClaudeArgs, routeTopLevelEvent, mapStreamEvent } from "../session.ts";
import type { EventMappingContext } from "../session.ts";

// ---------------------------------------------------------------------------
// Helpers (needed for stdin spy test and future Steps 1-4)
// ---------------------------------------------------------------------------

/**
 * Build a mock subprocess suitable for injection into SessionManager.
 *
 * stdoutLines: JSON-serialisable objects to emit as newline-delimited JSON on
 *              stdout.  The stream closes after all lines are written.
 *
 * Returns { mockProcess, mockReader, mockStdin } where mockStdin can be used
 * to spy on stdin writes.
 */
function makeMockSubprocess(stdoutLines: unknown[]): {
  mockProcess: Record<string, unknown>;
  mockReader: ReadableStreamDefaultReader<Uint8Array>;
  mockStdin: Record<string, unknown>;
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

  // Mock FileSink for stdin (Bun.spawn returns a FileSink, not a WritableStream)
  const mockStdin: Record<string, unknown> = {
    write(_data: unknown) {},
    flush() {},
    end() {},
  };

  const mockProcess: Record<string, unknown> = {
    stdin: mockStdin,
    stdout: stream, // not used by SessionManager once reader is injected
    kill: (_signal: string) => {},
  };

  return { mockProcess, mockReader, mockStdin };
}

/**
 * Inject a mock subprocess into a SessionManager instance, bypassing
 * initialize().  Sets both claudeProcess and stdoutReader directly so
 * handleUserMessage() can run against controlled stdout content.
 *
 * Returns mockStdin so callers can spy on write calls.
 */
function injectMockSubprocess(
  manager: SessionManager,
  stdoutLines: unknown[]
): Record<string, unknown> {
  const { mockProcess, mockReader, mockStdin } = makeMockSubprocess(stdoutLines);
  (manager as any).claudeProcess = mockProcess;
  (manager as any).stdoutReader = mockReader;
  (manager as any).stdoutBuffer = "";
  (manager as any).currentMsgId = "mock-msg-id";
  return mockStdin;
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

// ---------------------------------------------------------------------------
// buildClaudeArgs tests
// ---------------------------------------------------------------------------

// Reusable default config
const defaultConfig = {
  pluginDir: "/repo",
  model: "claude-opus-4-6",
  permissionMode: "acceptEdits",
  sessionId: null,
};

describe("buildClaudeArgs", () => {
  test("default config does NOT include -p", () => {
    const args = buildClaudeArgs(defaultConfig);
    expect(args).not.toContain("-p");
  });

  test("includes --permission-prompt-tool stdio", () => {
    const args = buildClaudeArgs(defaultConfig);
    const idx = args.indexOf("--permission-prompt-tool");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("stdio");
  });

  test("includes --replay-user-messages", () => {
    const args = buildClaudeArgs(defaultConfig);
    expect(args).toContain("--replay-user-messages");
  });

  test("with sessionId includes --resume", () => {
    const args = buildClaudeArgs({ ...defaultConfig, sessionId: "abc" });
    const idx = args.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("abc");
  });

  test("with continue: true includes --continue", () => {
    const args = buildClaudeArgs({ ...defaultConfig, continue: true });
    expect(args).toContain("--continue");
  });

  test("with forkSession: true and sessionId includes --fork-session", () => {
    const args = buildClaudeArgs({ ...defaultConfig, sessionId: "sess-1", forkSession: true });
    expect(args).toContain("--fork-session");
  });

  test("with sessionIdOverride includes --session-id", () => {
    const args = buildClaudeArgs({ ...defaultConfig, sessionIdOverride: "override-id-xyz" });
    const idx = args.indexOf("--session-id");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("override-id-xyz");
  });

  test("throws if both sessionId and continue are set", () => {
    expect(() =>
      buildClaudeArgs({ ...defaultConfig, sessionId: "sess-abc", continue: true })
    ).toThrow("Only one of sessionId, continue, or sessionIdOverride may be set");
  });

  test("throws if both sessionId and sessionIdOverride are set", () => {
    expect(() =>
      buildClaudeArgs({ ...defaultConfig, sessionId: "sess-abc", sessionIdOverride: "override-xyz" })
    ).toThrow("Only one of sessionId, continue, or sessionIdOverride may be set");
  });

  test("throws if forkSession without sessionId or continue", () => {
    expect(() =>
      buildClaudeArgs({ ...defaultConfig, forkSession: true })
    ).toThrow("forkSession requires either sessionId or continue to be set");
  });

  test("forkSession with continue does not throw", () => {
    expect(() =>
      buildClaudeArgs({ ...defaultConfig, continue: true, forkSession: true })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// stdin message format tests
// ---------------------------------------------------------------------------

describe("stdin message format", () => {
  test("stdin write produces correct user envelope", async () => {
    const manager = new SessionManager("/tmp/tugtalk-stdin-test-" + Date.now());

    // Inject mock with a result event so handleUserMessage terminates cleanly
    const mockStdin = injectMockSubprocess(manager, [
      { type: "result", subtype: "success", result: "" },
    ]);

    // Spy on mockStdin.write to capture what gets written
    const writtenData: string[] = [];
    mockStdin.write = (data: unknown) => {
      writtenData.push(String(data));
    };

    const userMsg = { type: "user_message" as const, text: "hello world", attachments: [] };
    await captureIpcOutput(() => manager.handleUserMessage(userMsg));

    // Should have captured at least one write
    expect(writtenData.length).toBeGreaterThan(0);

    // Parse the first write (the user message envelope)
    const rawJson = writtenData[0].replace(/\n$/, "");
    const parsed = JSON.parse(rawJson);

    expect(parsed.type).toBe("user");
    expect(parsed.session_id).toBe("");
    expect(parsed.parent_tool_use_id).toBeNull();
    expect(parsed.message).toBeDefined();
    expect(parsed.message.role).toBe("user");
    expect(Array.isArray(parsed.message.content)).toBe(true);
    expect(parsed.message.content.length).toBe(1);
    expect(parsed.message.content[0].type).toBe("text");
    expect(parsed.message.content[0].text).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// routeTopLevelEvent tests (Step 1)
// ---------------------------------------------------------------------------

const baseCtx: EventMappingContext = { msgId: "msg-1", seq: 0, rev: 0 };

describe("routeTopLevelEvent", () => {
  test("system/init captures session_id and metadata", () => {
    const event = {
      type: "system",
      subtype: "init",
      session_id: "sess-123",
      tools: ["Read", "Write"],
      model: "claude-opus-4-6",
      cwd: "/test",
    };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.sessionId).toBe("sess-123");
    expect(result.systemMetadata).toBeDefined();
    expect((result.systemMetadata as any).tools).toEqual(["Read", "Write"]);
    expect((result.systemMetadata as any).model).toBe("claude-opus-4-6");
    expect((result.systemMetadata as any).cwd).toBe("/test");
    expect(result.gotResult).toBe(false);
    expect(result.messages).toHaveLength(0);
  });

  test("system/compact_boundary emits marker", () => {
    const event = { type: "system", subtype: "compact_boundary" };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as any).type).toBe("compact_boundary");
    expect(result.gotResult).toBe(false);
  });

  test("assistant text content emits complete assistant_text", () => {
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.type).toBe("assistant_text");
    expect(msg.is_partial).toBe(false);
    expect(msg.text).toBe("Hello world");
    expect(msg.status).toBe("complete");
    expect(result.gotResult).toBe(false);
  });

  test("assistant tool_use blocks emits tool_use", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", id: "tu-1", input: { path: "/a.ts" } },
        ],
      },
    };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.type).toBe("tool_use");
    expect(msg.tool_name).toBe("Read");
    expect(msg.tool_use_id).toBe("tu-1");
    expect(msg.input).toEqual({ path: "/a.ts" });
  });

  test("assistant thinking blocks emits thinking_text", () => {
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "thinking", text: "Let me think..." }],
      },
    };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.type).toBe("thinking_text");
    expect(msg.text).toBe("Let me think...");
    expect(msg.is_partial).toBe(false);
  });

  test("result/success emits turn_complete with result: success", () => {
    const event = { type: "result", subtype: "success", result: "" };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.gotResult).toBe(true);
    const tc = result.messages.find((m: any) => m.type === "turn_complete") as any;
    expect(tc).toBeDefined();
    expect(tc.result).toBe("success");
  });

  test("result/error_during_execution emits error turn_complete", () => {
    const event = { type: "result", subtype: "error_during_execution", result: "" };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.gotResult).toBe(true);
    const tc = result.messages.find((m: any) => m.type === "turn_complete") as any;
    expect(tc).toBeDefined();
    expect(tc.result).toBe("error");
  });

  test("result/error_max_turns stores correct subtype in resultMetadata", () => {
    const event = { type: "result", subtype: "error_max_turns", result: "" };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.gotResult).toBe(true);
    expect(result.resultMetadata).toBeDefined();
    expect(result.resultMetadata!.subtype).toBe("error_max_turns");
    const tc = result.messages.find((m: any) => m.type === "turn_complete") as any;
    expect(tc.result).toBe("error");
  });

  test("result/error_max_budget_usd stores correct subtype in resultMetadata", () => {
    const event = { type: "result", subtype: "error_max_budget_usd", result: "" };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.resultMetadata!.subtype).toBe("error_max_budget_usd");
    const tc = result.messages.find((m: any) => m.type === "turn_complete") as any;
    expect(tc.result).toBe("error");
  });

  test("result/error_max_structured_output_retries stores correct subtype", () => {
    const event = { type: "result", subtype: "error_max_structured_output_retries", result: "" };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.resultMetadata!.subtype).toBe("error_max_structured_output_retries");
    const tc = result.messages.find((m: any) => m.type === "turn_complete") as any;
    expect(tc.result).toBe("error");
  });

  test("result/success with API Error text detects API error per PN-2", () => {
    const event = {
      type: "result",
      subtype: "success",
      result: "API Error: 400 {\"error\":{\"message\":\"Bad request\"}}",
    };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.gotResult).toBe(true);
    expect(result.resultMetadata).toBeDefined();
    expect(result.resultMetadata!.is_api_error).toBe(true);
  });

  test("stream_event returns unwrapped inner event", () => {
    const innerEvent = { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } };
    const event = { type: "stream_event", event: innerEvent };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.streamEvent).toBeDefined();
    expect(result.streamEvent).toEqual(innerEvent);
    expect(result.messages).toHaveLength(0);
    expect(result.gotResult).toBe(false);
  });

  test("user/tool_result emits tool_result per block", () => {
    const event = {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu-1", content: "file text", is_error: false },
        ],
      },
    };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.type).toBe("tool_result");
    expect(msg.tool_use_id).toBe("tu-1");
    expect(msg.output).toBe("file text");
    expect(msg.is_error).toBe(false);
  });

  test("control_request returns it for handling", () => {
    const event = {
      type: "control_request",
      request_id: "req-1",
      request: { subtype: "can_use_tool" },
    };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.controlRequest).toBeDefined();
    expect(result.controlRequest).toBe(event);
    expect(result.messages).toHaveLength(0);
    expect(result.gotResult).toBe(false);
  });

  test("keep_alive produces nothing", () => {
    const event = { type: "keep_alive" };
    const result = routeTopLevelEvent(event, baseCtx);
    expect(result.messages).toHaveLength(0);
    expect(result.gotResult).toBe(false);
    expect(result.sessionId).toBeUndefined();
    expect(result.streamEvent).toBeUndefined();
    expect(result.controlRequest).toBeUndefined();
  });

  test("preserves parent_tool_use_id from all 5 message types", () => {
    const parentId = "parent-123";

    const systemEvent = { type: "system", subtype: "init", session_id: "s1", parent_tool_use_id: parentId };
    const assistantEvent = { type: "assistant", message: { content: [] }, parent_tool_use_id: parentId };
    const userEvent = { type: "user", message: { content: [] }, parent_tool_use_id: parentId };
    const resultEvent = { type: "result", subtype: "success", result: "", parent_tool_use_id: parentId };
    const streamEvent = { type: "stream_event", event: {}, parent_tool_use_id: parentId };

    for (const event of [systemEvent, assistantEvent, userEvent, resultEvent, streamEvent]) {
      const result = routeTopLevelEvent(event, baseCtx);
      expect(result.parentToolUseId).toBe(parentId);
    }
  });
});

// ---------------------------------------------------------------------------
// mapStreamEvent (updated) tests (Step 1)
// ---------------------------------------------------------------------------

describe("mapStreamEvent (updated)", () => {
  test("content_block_start/tool_use extracts tool name per PN-16", () => {
    const event = {
      type: "content_block_start",
      content_block: { type: "tool_use", name: "Read", id: "tu-1" },
    };
    const result = mapStreamEvent(event, baseCtx, "");
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.type).toBe("tool_use");
    expect(msg.tool_name).toBe("Read");
    expect(msg.tool_use_id).toBe("tu-1");
    expect(msg.input).toEqual({});
  });

  test("content_block_start with non-tool_use type produces no messages", () => {
    const event = {
      type: "content_block_start",
      content_block: { type: "text", text: "" },
    };
    const result = mapStreamEvent(event, baseCtx, "");
    expect(result.messages).toHaveLength(0);
  });

  test("thinking_delta emits thinking_text with is_partial: true", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "thinking_delta", text: "thinking..." },
    };
    const result = mapStreamEvent(event, baseCtx, "");
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.type).toBe("thinking_text");
    expect(msg.text).toBe("thinking...");
    expect(msg.is_partial).toBe(true);
    expect(msg.status).toBe("partial");
  });

  test("content_block_delta/text_delta still works correctly", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hello" },
    };
    const result = mapStreamEvent(event, baseCtx, "prior ");
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.type).toBe("assistant_text");
    expect(msg.text).toBe("hello");
    expect(msg.is_partial).toBe(true);
    expect(result.partialText).toBe("prior hello");
  });

  test("mapStreamEvent result no longer has sessionId field", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "x" },
      session_id: "should-not-capture",
    };
    const result = mapStreamEvent(event, baseCtx, "");
    // sessionId should not be present on EventMappingResult
    expect("sessionId" in result).toBe(false);
  });
});
