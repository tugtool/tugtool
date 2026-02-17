import { describe, test, expect } from "bun:test";
import { SessionManager, buildClaudeArgs } from "../session.ts";
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
