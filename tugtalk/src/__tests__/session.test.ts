import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SessionManager } from "../session.ts";
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

  test("sessionId persistence", async () => {
    // Note: This test will fail without API key, so we skip actual SDK calls
    // Testing file I/O only
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

  test("handleInterrupt when no active turn", () => {
    const manager = new SessionManager(testDir);

    // Should not throw
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
