import { describe, test, expect } from "bun:test";
import { spawn } from "bun";
import { join } from "path";
import { isInboundMessage, isModelChange, isSessionCommand } from "../types.ts";

describe("main.ts protocol handshake", () => {
  test("protocol_init receives protocol_ack with session_id", async () => {
    // Spawn the main.ts process
    const mainPath = join(import.meta.dir, "..", "main.ts");
    const proc = spawn(["bun", "run", mainPath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send protocol_init message
    const protocolInit = JSON.stringify({ type: "protocol_init", version: 1 }) + "\n";
    proc.stdin.write(protocolInit);
    proc.stdin.end();

    // Read response
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        if (output.includes("\n")) break; // Got a complete line
      }
    } finally {
      reader.releaseLock();
      proc.kill();
    }

    // Parse the response
    const lines = output.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const response = JSON.parse(lines[0]);
    expect(response.type).toBe("protocol_ack");
    expect(response.version).toBe(1);
    expect(response.session_id).toBeDefined();
    expect(typeof response.session_id).toBe("string");
    expect(response.session_id.length).toBeGreaterThan(0);
  });

  test("protocol_init with wrong version receives error", async () => {
    const mainPath = join(import.meta.dir, "..", "main.ts");
    const proc = spawn(["bun", "run", mainPath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send protocol_init with wrong version
    const protocolInit = JSON.stringify({ type: "protocol_init", version: 99 }) + "\n";
    proc.stdin.write(protocolInit);
    proc.stdin.end();

    // Read response
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        if (output.includes("\n")) break;
      }
    } finally {
      reader.releaseLock();
      proc.kill();
    }

    // Parse the response
    const lines = output.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const response = JSON.parse(lines[0]);
    expect(response.type).toBe("error");
    expect(response.message).toContain("Unsupported protocol version");
    expect(response.recoverable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type guard routing tests for new inbound message types
// (Unit-style tests; integration tests for model_change/session_command require
//  an initialized SessionManager which calls the claude CLI. These type guard
//  tests provide coverage for the routing chain per the architect strategy.)
// ---------------------------------------------------------------------------

describe("main.ts inbound message type guard routing", () => {
  test("model_change is accepted by isInboundMessage", () => {
    const msg = { type: "model_change", model: "claude-haiku-3-5" };
    expect(isInboundMessage(msg)).toBe(true);
  });

  test("model_change is dispatched by isModelChange", () => {
    const msg = { type: "model_change" as const, model: "claude-haiku-3-5" };
    expect(isModelChange(msg)).toBe(true);
  });

  test("model_change is not dispatched as session_command", () => {
    const msg = { type: "model_change" as const, model: "claude-opus-4-6" };
    expect(isSessionCommand(msg as any)).toBe(false);
  });

  test("session_command is accepted by isInboundMessage", () => {
    const msg = { type: "session_command", command: "fork" };
    expect(isInboundMessage(msg)).toBe(true);
  });

  test("session_command is dispatched by isSessionCommand", () => {
    const msg = { type: "session_command" as const, command: "fork" as const };
    expect(isSessionCommand(msg)).toBe(true);
  });

  test("session_command is not dispatched as model_change", () => {
    const msg = { type: "session_command" as const, command: "new" as const };
    expect(isModelChange(msg as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// --resume-session argv parsing
// ---------------------------------------------------------------------------

/**
 * Spawn main.ts with the given argv and capture its first stderr line
 * that starts with `Starting tugcode (`. main.ts logs argv state there
 * before claude is even consulted, so this is a tugcode-only assertion
 * that doesn't depend on a real claude binary being on PATH.
 */
async function readStartupLine(args: string[]): Promise<string> {
  const mainPath = join(import.meta.dir, "..", "main.ts");
  const proc = spawn(["bun", "run", mainPath, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let line: string | null = null;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const newlineIdx = buf.indexOf("\n");
      if (newlineIdx >= 0) {
        line = buf.slice(0, newlineIdx);
        break;
      }
    }
  } finally {
    reader.releaseLock();
    proc.stdin.end();
    proc.kill();
  }
  return line ?? "";
}

describe("main.ts --resume-session argv", () => {
  test("--resume-session <id> appears in startup log when provided", async () => {
    const line = await readStartupLine([
      "--dir",
      "/tmp/resume-argv",
      "--session-id",
      "tug-uuid-1",
      "--session-mode",
      "resume",
      "--resume-session",
      "claude-resume-id-99",
    ]);
    expect(line).toContain("Starting tugcode");
    expect(line).toContain("resumeSessionId: claude-resume-id-99");
    expect(line).toContain("sessionId: tug-uuid-1");
    expect(line).toContain("sessionMode: resume");
  });

  test("--resume-session is omitted from startup log when not provided", async () => {
    const line = await readStartupLine([
      "--dir",
      "/tmp/resume-argv",
      "--session-id",
      "tug-uuid-2",
      "--session-mode",
      "new",
    ]);
    expect(line).toContain("Starting tugcode");
    // Logs the resumeSessionId field only when set; absence is silent.
    expect(line).not.toContain("resumeSessionId:");
  });
});
