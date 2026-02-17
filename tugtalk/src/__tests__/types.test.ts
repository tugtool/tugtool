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
});
