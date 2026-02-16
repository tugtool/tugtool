import { describe, test, expect } from "bun:test";
import {
  isInboundMessage,
  isProtocolInit,
  isUserMessage,
  isToolApproval,
  isQuestionAnswer,
  isInterrupt,
  isPermissionMode,
} from "../types.ts";

describe("types.ts type guards", () => {
  test("isInboundMessage discriminates valid messages", () => {
    expect(isInboundMessage({ type: "protocol_init", version: 1 })).toBe(true);
    expect(isInboundMessage({ type: "user_message", text: "hi", attachments: [] })).toBe(true);
    expect(isInboundMessage({ type: "invalid_type" })).toBe(false);
    expect(isInboundMessage(null)).toBe(false);
    expect(isInboundMessage(undefined)).toBe(false);
    expect(isInboundMessage("string")).toBe(false);
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
});
