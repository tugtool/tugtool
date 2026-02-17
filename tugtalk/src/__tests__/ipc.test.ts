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

  test("validateMessage accepts model_change", () => {
    const result = validateMessage('{"type":"model_change","model":"claude-haiku-3-5"}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe("model_change");
  });

  test("validateMessage accepts session_command fork", () => {
    const result = validateMessage('{"type":"session_command","command":"fork"}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe("session_command");
  });

  test("validateMessage accepts session_command continue", () => {
    const result = validateMessage('{"type":"session_command","command":"continue"}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe("session_command");
  });

  test("validateMessage accepts session_command new", () => {
    const result = validateMessage('{"type":"session_command","command":"new"}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe("session_command");
  });

  test("validateMessage rejects unknown types (regression)", () => {
    // Different unknown type value to complement the existing "unknown_type" test
    const result = validateMessage('{"type":"totally_unknown_message_type"}');
    expect(result).toBeNull();
  });
});
