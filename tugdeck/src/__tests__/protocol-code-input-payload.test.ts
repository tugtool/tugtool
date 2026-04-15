/**
 * Round-trip coverage for `encodeCodeInputPayload` / `decodeCodeInputPayload`
 * — the payload-only helpers added for the `CodeSessionStore` wire path
 * (T3.4.a Step 1). `encodeCodeInput` stays the canonical fully-framed
 * encoder for callers that already use it.
 */

import { describe, it, expect } from "bun:test";

import {
  encodeCodeInputPayload,
  decodeCodeInputPayload,
  type InboundMessage,
} from "@/protocol";

const TUG_SESSION_ID = "tug00000-0000-4000-8000-000000000001";

function roundTrip(msg: InboundMessage): InboundMessage & { tug_session_id: string } {
  return decodeCodeInputPayload(encodeCodeInputPayload(msg, TUG_SESSION_ID));
}

describe("encodeCodeInputPayload / decodeCodeInputPayload", () => {
  it("round-trips a user_message frame", () => {
    const msg: InboundMessage = {
      type: "user_message",
      text: "hello, claude",
      attachments: [],
    };
    expect(roundTrip(msg)).toEqual({
      ...msg,
      tug_session_id: TUG_SESSION_ID,
    });
  });

  it("round-trips an interrupt frame", () => {
    const msg: InboundMessage = { type: "interrupt" };
    expect(roundTrip(msg)).toEqual({
      ...msg,
      tug_session_id: TUG_SESSION_ID,
    });
  });

  it("round-trips a tool_approval frame with optional fields", () => {
    const msg: InboundMessage = {
      type: "tool_approval",
      request_id: "req00000-0000-4000-8000-000000000001",
      decision: "allow",
      updatedInput: { command: "ls -la" },
      message: "looks safe",
    };
    expect(roundTrip(msg)).toEqual({
      ...msg,
      tug_session_id: TUG_SESSION_ID,
    });
  });

  it("round-trips a question_answer frame", () => {
    const msg: InboundMessage = {
      type: "question_answer",
      request_id: "req00000-0000-4000-8000-000000000002",
      answers: { pick: "a", confidence: 0.9 },
    };
    expect(roundTrip(msg)).toEqual({
      ...msg,
      tug_session_id: TUG_SESSION_ID,
    });
  });

  it("emits tug_session_id as the first JSON field for router parse order", () => {
    const msg: InboundMessage = {
      type: "user_message",
      text: "x",
      attachments: [],
    };
    const bytes = encodeCodeInputPayload(msg, TUG_SESSION_ID);
    const json = new TextDecoder().decode(bytes);
    // The router parses `tug_session_id` before consulting the supervisor
    // ledger; keeping it first makes the wire shape grep-friendly.
    expect(json.indexOf("tug_session_id")).toBe(2);
  });
});
