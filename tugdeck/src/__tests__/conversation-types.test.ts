import { describe, test, expect } from "bun:test";
import {
  parseConversationEvent,
  isConversationEvent,
  type AssistantText,
  type ToolUse,
  type ToolResult,
  type TurnComplete,
  type ErrorEvent,
} from "../cards/conversation/types.ts";
import { encodeCodeInput, decodeFrame, FeedId } from "../protocol.ts";

describe("conversation types", () => {
  test("parseConversationEvent parses assistant_text", () => {
    const json = JSON.stringify({
      type: "assistant_text",
      msg_id: "msg-123",
      seq: 0,
      rev: 0,
      text: "Hello world",
      is_partial: false,
      status: "complete",
    });
    const payload = new TextEncoder().encode(json);
    const result = parseConversationEvent(payload);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("assistant_text");
    const typed = result as AssistantText;
    expect(typed.msg_id).toBe("msg-123");
    expect(typed.seq).toBe(0);
    expect(typed.text).toBe("Hello world");
  });

  test("parseConversationEvent parses tool_use", () => {
    const json = JSON.stringify({
      type: "tool_use",
      msg_id: "msg-456",
      seq: 1,
      tool_name: "Read",
      tool_use_id: "tool-1",
      input: { file: "test.txt" },
    });
    const payload = new TextEncoder().encode(json);
    const result = parseConversationEvent(payload);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_use");
    const typed = result as ToolUse;
    expect(typed.tool_name).toBe("Read");
    expect(typed.tool_use_id).toBe("tool-1");
  });

  test("parseConversationEvent parses tool_result", () => {
    const json = JSON.stringify({
      type: "tool_result",
      tool_use_id: "tool-1",
      output: "file contents",
      is_error: false,
    });
    const payload = new TextEncoder().encode(json);
    const result = parseConversationEvent(payload);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("tool_result");
    const typed = result as ToolResult;
    expect(typed.output).toBe("file contents");
    expect(typed.is_error).toBe(false);
  });

  test("parseConversationEvent parses turn_complete", () => {
    const json = JSON.stringify({
      type: "turn_complete",
      msg_id: "msg-789",
      seq: 2,
      result: "success",
    });
    const payload = new TextEncoder().encode(json);
    const result = parseConversationEvent(payload);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("turn_complete");
    const typed = result as TurnComplete;
    expect(typed.result).toBe("success");
  });

  test("parseConversationEvent parses error", () => {
    const json = JSON.stringify({
      type: "error",
      message: "Something went wrong",
      recoverable: true,
    });
    const payload = new TextEncoder().encode(json);
    const result = parseConversationEvent(payload);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("error");
    const typed = result as ErrorEvent;
    expect(typed.message).toBe("Something went wrong");
    expect(typed.recoverable).toBe(true);
  });

  test("parseConversationEvent returns null for invalid JSON", () => {
    const payload = new TextEncoder().encode("not json");
    const result = parseConversationEvent(payload);
    expect(result).toBeNull();
  });

  test("parseConversationEvent returns null for unknown type", () => {
    const json = JSON.stringify({ type: "unknown_type", data: "test" });
    const payload = new TextEncoder().encode(json);
    const result = parseConversationEvent(payload);
    expect(result).toBeNull();
  });

  test("isConversationEvent validates valid events", () => {
    expect(isConversationEvent({ type: "assistant_text", msg_id: "1", seq: 0, rev: 0, text: "", is_partial: false, status: "complete" })).toBe(true);
    expect(isConversationEvent({ type: "error", message: "test", recoverable: true })).toBe(true);
  });

  test("isConversationEvent rejects invalid objects", () => {
    expect(isConversationEvent(null)).toBe(false);
    expect(isConversationEvent(undefined)).toBe(false);
    expect(isConversationEvent("string")).toBe(false);
    expect(isConversationEvent({ type: "invalid" })).toBe(false);
  });

  test("encodeCodeInput produces correct binary frame", () => {
    const msg = { type: "user_message", text: "Hello", attachments: [] };
    const encoded = encodeCodeInput(msg);

    // Decode and verify
    const frame = decodeFrame(encoded);
    expect(frame.feedId).toBe(FeedId.CODE_INPUT);

    const decoded = JSON.parse(new TextDecoder().decode(frame.payload));
    expect(decoded.type).toBe("user_message");
    expect(decoded.text).toBe("Hello");
  });
});
