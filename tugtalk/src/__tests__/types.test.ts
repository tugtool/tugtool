import { describe, test, expect } from "bun:test";
import {
  isInboundMessage,
  isProtocolInit,
  isUserMessage,
  isToolApproval,
  isQuestionAnswer,
  isInterrupt,
  isPermissionMode,
  isModelChange,
  isSessionCommand,
} from "../types.ts";
import type {
  AssistantText,
  ToolUse,
  ThinkingText,
  CompactBoundary,
  ControlRequestForward,
  SystemMetadata,
  CostUpdate,
} from "../types.ts";

describe("types.ts type guards", () => {
  test("isInboundMessage discriminates valid messages", () => {
    expect(isInboundMessage({ type: "protocol_init", version: 1 })).toBe(true);
    expect(isInboundMessage({ type: "user_message", text: "hi", attachments: [] })).toBe(true);
    expect(isInboundMessage({ type: "invalid_type" })).toBe(false);
    expect(isInboundMessage(null)).toBe(false);
    expect(isInboundMessage(undefined)).toBe(false);
    expect(isInboundMessage("string")).toBe(false);
    // New message types added in Step 4
    expect(isInboundMessage({ type: "model_change", model: "claude-haiku-3-5" })).toBe(true);
    expect(isInboundMessage({ type: "session_command", command: "fork" })).toBe(true);
  });

  test("isProtocolInit discriminates protocol_init", () => {
    const msg = { type: "protocol_init" as const, version: 1 };
    expect(isProtocolInit(msg)).toBe(true);
    expect(isUserMessage(msg)).toBe(false);
  });

  test("isUserMessage discriminates user_message", () => {
    const msg = { type: "user_message" as const, text: "hello", attachments: [] };
    expect(isUserMessage(msg)).toBe(true);
    expect(isProtocolInit(msg)).toBe(false);
  });

  test("isToolApproval discriminates tool_approval", () => {
    const msg = { type: "tool_approval" as const, request_id: "123", decision: "allow" as const };
    expect(isToolApproval(msg)).toBe(true);
    expect(isUserMessage(msg)).toBe(false);
  });

  test("isQuestionAnswer discriminates question_answer", () => {
    const msg = { type: "question_answer" as const, request_id: "123", answers: {} };
    expect(isQuestionAnswer(msg)).toBe(true);
    expect(isToolApproval(msg)).toBe(false);
  });

  test("isInterrupt discriminates interrupt", () => {
    const msg = { type: "interrupt" as const };
    expect(isInterrupt(msg)).toBe(true);
    expect(isProtocolInit(msg)).toBe(false);
  });

  test("isPermissionMode discriminates permission_mode", () => {
    const msg = { type: "permission_mode" as const, mode: "default" as const };
    expect(isPermissionMode(msg)).toBe(true);
    expect(isInterrupt(msg)).toBe(false);
  });

  test("isModelChange discriminates model_change", () => {
    const msg = { type: "model_change" as const, model: "claude-haiku-3-5" };
    expect(isModelChange(msg)).toBe(true);
    expect(isSessionCommand(msg)).toBe(false);
    expect(isPermissionMode(msg)).toBe(false);
  });

  test("isSessionCommand discriminates session_command with all variants", () => {
    const fork = { type: "session_command" as const, command: "fork" as const };
    const cont = { type: "session_command" as const, command: "continue" as const };
    const newSess = { type: "session_command" as const, command: "new" as const };
    expect(isSessionCommand(fork)).toBe(true);
    expect(isSessionCommand(cont)).toBe(true);
    expect(isSessionCommand(newSess)).toBe(true);
    expect(isModelChange(fork)).toBe(false);
  });

  test("PermissionModeMessage accepts dontAsk mode", () => {
    const msg = { type: "permission_mode" as const, mode: "dontAsk" as const };
    expect(isPermissionMode(msg)).toBe(true);
    expect(isInboundMessage(msg)).toBe(true);
  });

  test("PermissionModeMessage accepts delegate mode", () => {
    const msg = { type: "permission_mode" as const, mode: "delegate" as const };
    expect(isPermissionMode(msg)).toBe(true);
    expect(isInboundMessage(msg)).toBe(true);
  });

  test("ToolApproval with updatedInput optional field is recognized", () => {
    const msgWithUpdated = {
      type: "tool_approval" as const,
      request_id: "req-upd-1",
      decision: "allow" as const,
      updatedInput: { path: "/override.ts" },
    };
    expect(isToolApproval(msgWithUpdated)).toBe(true);
    expect(isInboundMessage(msgWithUpdated)).toBe(true);
  });

  test("ToolApproval with message optional field is recognized", () => {
    const msgWithMessage = {
      type: "tool_approval" as const,
      request_id: "req-msg-1",
      decision: "deny" as const,
      message: "Not allowed because of policy",
    };
    expect(isToolApproval(msgWithMessage)).toBe(true);
    expect(isInboundMessage(msgWithMessage)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Outbound message type shape tests
// ---------------------------------------------------------------------------

describe("outbound message types", () => {
  test("AssistantText has ipc_version field", () => {
    const msg: AssistantText = {
      type: "assistant_text",
      msg_id: "m1",
      seq: 0,
      rev: 0,
      text: "hello",
      is_partial: false,
      status: "complete",
      ipc_version: 2,
    };
    expect(msg.ipc_version).toBe(2);
    expect(msg.type).toBe("assistant_text");
  });

  test("ToolUse has ipc_version field", () => {
    const msg: ToolUse = {
      type: "tool_use",
      msg_id: "m2",
      seq: 1,
      tool_name: "Read",
      tool_use_id: "tu-1",
      input: { path: "/a.ts" },
      ipc_version: 2,
    };
    expect(msg.ipc_version).toBe(2);
    expect(msg.type).toBe("tool_use");
  });

  test("ThinkingText has ipc_version field", () => {
    const msg: ThinkingText = {
      type: "thinking_text",
      msg_id: "m3",
      seq: 0,
      text: "thinking...",
      is_partial: true,
      status: "partial",
      ipc_version: 2,
    };
    expect(msg.ipc_version).toBe(2);
    expect(msg.type).toBe("thinking_text");
  });

  test("CompactBoundary has ipc_version field", () => {
    const msg: CompactBoundary = {
      type: "compact_boundary",
      ipc_version: 2,
    };
    expect(msg.ipc_version).toBe(2);
    expect(msg.type).toBe("compact_boundary");
  });

  test("ControlRequestForward has is_question field", () => {
    const msg: ControlRequestForward = {
      type: "control_request_forward",
      request_id: "req-1",
      tool_name: "Write",
      input: { path: "/foo.ts" },
      is_question: false,
      ipc_version: 2,
    };
    expect(msg.is_question).toBe(false);
    expect(msg.ipc_version).toBe(2);
  });

  test("SystemMetadata has cwd field", () => {
    const msg: SystemMetadata = {
      type: "system_metadata",
      session_id: "sess-1",
      cwd: "/my/project",
      tools: [],
      model: "claude-opus-4-6",
      permissionMode: "acceptEdits",
      slash_commands: [],
      plugins: [],
      agents: [],
      skills: [],
      version: "2.1.38",
      ipc_version: 2,
    };
    expect(msg.cwd).toBe("/my/project");
    expect(msg.ipc_version).toBe(2);
  });

  test("CostUpdate has duration_api_ms field", () => {
    const msg: CostUpdate = {
      type: "cost_update",
      total_cost_usd: 0.01,
      num_turns: 1,
      duration_ms: 1000,
      duration_api_ms: 800,
      usage: {},
      modelUsage: {},
      ipc_version: 2,
    };
    expect(msg.duration_api_ms).toBe(800);
    expect(msg.ipc_version).toBe(2);
  });
});
