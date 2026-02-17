import { describe, test, expect } from "bun:test";
import { validateMessage } from "../ipc.ts";

describe("ipc.ts", () => {
  test("validateMessage parses valid JSON", () => {
    const valid = '{"type":"protocol_init","version":1}';
    const result = validateMessage(valid);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("protocol_init");
    expect((result as any).version).toBe(1);
  });

  test("validateMessage rejects malformed JSON", () => {
    const malformed = '{type:"protocol_init",version:1'; // Missing closing brace
    const result = validateMessage(malformed);
    expect(result).toBeNull();
  });

  test("validateMessage rejects invalid message type", () => {
    const invalid = '{"type":"unknown_type","data":"test"}';
    const result = validateMessage(invalid);
    expect(result).toBeNull();
  });

  test("validateMessage accepts all inbound types", () => {
    const protocolInit = '{"type":"protocol_init","version":1}';
    expect(validateMessage(protocolInit)).not.toBeNull();

    const userMessage = '{"type":"user_message","text":"hello","attachments":[]}';
    expect(validateMessage(userMessage)).not.toBeNull();

    const toolApproval = '{"type":"tool_approval","request_id":"123","decision":"allow"}';
    expect(validateMessage(toolApproval)).not.toBeNull();

    const questionAnswer = '{"type":"question_answer","request_id":"123","answers":{}}';
    expect(validateMessage(questionAnswer)).not.toBeNull();

    const interrupt = '{"type":"interrupt"}';
    expect(validateMessage(interrupt)).not.toBeNull();

    const permissionMode = '{"type":"permission_mode","mode":"default"}';
    expect(validateMessage(permissionMode)).not.toBeNull();
  });
});
