import { describe, test, expect } from "bun:test";
import {
  CONTROL_ACTION_CLOSE_SESSION,
  CONTROL_ACTION_RESET_SESSION,
  CONTROL_ACTION_SPAWN_SESSION,
  FEED_ID_SESSION_STATE,
  FeedId,
  FrameFlags,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  controlFrame,
  decodeFrame,
  encodeCloseSession,
  encodeCodeInput,
  encodeFrame,
  encodeResetSession,
  encodeSpawnSession,
  isControlFrame,
} from "../protocol";

describe("controlFrame", () => {
  test("restart produces correct feedId and payload", () => {
    const frame = controlFrame("restart");
    expect(frame.feedId).toBe(0xc0);
    const payload = JSON.parse(new TextDecoder().decode(frame.payload));
    expect(payload).toEqual({ action: "restart" });
  });

  test("reset produces correct feedId and payload", () => {
    const frame = controlFrame("reset");
    expect(frame.feedId).toBe(0xc0);
    const payload = JSON.parse(new TextDecoder().decode(frame.payload));
    expect(payload).toEqual({ action: "reset" });
  });

  test("round-trip restart through encode/decode", () => {
    const original = controlFrame("restart");
    const encoded = encodeFrame(original);
    const decoded = decodeFrame(encoded);
    expect(decoded.feedId).toBe(original.feedId);
    expect(decoded.flags).toBe(FrameFlags.DATA);
    expect(new TextDecoder().decode(decoded.payload)).toBe(
      new TextDecoder().decode(original.payload)
    );
  });
});

describe("wire format v1", () => {
  test("header size is 6 bytes", () => {
    expect(HEADER_SIZE).toBe(6);
  });

  test("max payload is 16 MB", () => {
    expect(MAX_PAYLOAD_SIZE).toBe(16 * 1024 * 1024);
  });

  test("golden: terminal output 'hello'", () => {
    const frame = {
      feedId: FeedId.TERMINAL_OUTPUT as (typeof FeedId)[keyof typeof FeedId],
      flags: FrameFlags.DATA,
      payload: new TextEncoder().encode("hello"),
    };
    const encoded = encodeFrame(frame);
    const bytes = new Uint8Array(encoded);
    // [0x00] FeedId  [0x00] flags  [0x00,0x00,0x00,0x05] length  "hello"
    expect(bytes).toEqual(
      new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f])
    );
  });

  test("golden: heartbeat empty", () => {
    const frame = {
      feedId: FeedId.HEARTBEAT as (typeof FeedId)[keyof typeof FeedId],
      flags: FrameFlags.DATA,
      payload: new Uint8Array(0),
    };
    const encoded = encodeFrame(frame);
    const bytes = new Uint8Array(encoded);
    // [0xFF] FeedId  [0x00] flags  [0x00,0x00,0x00,0x00] length
    expect(bytes).toEqual(new Uint8Array([0xff, 0x00, 0x00, 0x00, 0x00, 0x00]));
  });

  test("flags byte: data vs control", () => {
    expect(isControlFrame(FrameFlags.DATA)).toBe(false);
    expect(isControlFrame(FrameFlags.CONTROL)).toBe(true);
    // Unknown bits ignored for kind determination
    expect(isControlFrame(0xfe)).toBe(false); // bit 0 = 0
    expect(isControlFrame(0xff)).toBe(true);  // bit 0 = 1
  });

  test("decode preserves flags", () => {
    const frame = {
      feedId: FeedId.CODE_OUTPUT as (typeof FeedId)[keyof typeof FeedId],
      flags: FrameFlags.CONTROL,
      payload: new TextEncoder().encode('{"type":"lag_recovery"}'),
    };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded.feedId).toBe(FeedId.CODE_OUTPUT);
    expect(decoded.flags).toBe(FrameFlags.CONTROL);
    expect(isControlFrame(decoded.flags)).toBe(true);
  });

  test("unknown FeedId round-trips", () => {
    const frame = {
      feedId: 0x99 as (typeof FeedId)[keyof typeof FeedId],
      flags: FrameFlags.DATA,
      payload: new TextEncoder().encode("opaque"),
    };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded.feedId).toBe(0x99 as typeof decoded.feedId);
    expect(new TextDecoder().decode(decoded.payload)).toBe("opaque");
  });
});

describe("session protocol constants", () => {
  test("FEED_ID_SESSION_STATE is 0x52", () => {
    expect(FEED_ID_SESSION_STATE).toBe(0x52);
    expect(FeedId.SESSION_STATE).toBe(0x52);
  });

  test("CONTROL_ACTION_* names match supervisor expectations", () => {
    expect(CONTROL_ACTION_SPAWN_SESSION).toBe("spawn_session");
    expect(CONTROL_ACTION_CLOSE_SESSION).toBe("close_session");
    expect(CONTROL_ACTION_RESET_SESSION).toBe("reset_session");
  });
});

describe("encodeCodeInput", () => {
  test("injects tug_session_id as the first field of the JSON payload", () => {
    // Plan: the supervisor's dispatcher parses `tug_session_id` from the
    // CODE_INPUT payload to route the frame to the right per-session
    // worker. The field must be present on every CODE_INPUT emission —
    // tugcast's router hard-rejects missing-session payloads per Step 7
    // (`missing_tug_session_id` CONTROL error).
    const buffer = encodeCodeInput(
      { type: "user_text", text: "hi" },
      "abc-123",
    );
    const frame = decodeFrame(buffer);
    expect(frame.feedId).toBe(FeedId.CODE_INPUT);
    const jsonStr = new TextDecoder().decode(frame.payload);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.tug_session_id).toBe("abc-123");
    expect(parsed.type).toBe("user_text");
    expect(parsed.text).toBe("hi");

    // The spec says tug_session_id is the FIRST field of the payload.
    // Walk the stringified JSON to assert ordering (serde on the Rust
    // side doesn't care about order but some test-side assertions and
    // log inspections are friendlier when ordering is stable).
    const firstKeyMatch = /^\{"([^"]+)"/.exec(jsonStr);
    expect(firstKeyMatch).not.toBeNull();
    expect(firstKeyMatch![1]).toBe("tug_session_id");
  });
});

describe("session CONTROL frame builders", () => {
  function parsePayload(frame: { feedId: number; payload: Uint8Array }) {
    return JSON.parse(new TextDecoder().decode(frame.payload));
  }

  test("encodeSpawnSession produces a CONTROL frame with card_id and tug_session_id", () => {
    const frame = encodeSpawnSession("card-1", "sess-1");
    expect(frame.feedId).toBe(FeedId.CONTROL);
    expect(frame.flags).toBe(FrameFlags.DATA);
    const payload = parsePayload(frame);
    expect(payload).toEqual({
      action: "spawn_session",
      card_id: "card-1",
      tug_session_id: "sess-1",
    });
  });

  test("encodeCloseSession produces a CONTROL frame with card_id and tug_session_id", () => {
    const frame = encodeCloseSession("card-1", "sess-1");
    expect(frame.feedId).toBe(FeedId.CONTROL);
    const payload = parsePayload(frame);
    expect(payload).toEqual({
      action: "close_session",
      card_id: "card-1",
      tug_session_id: "sess-1",
    });
  });

  test("encodeResetSession produces a CONTROL frame with card_id and tug_session_id", () => {
    const frame = encodeResetSession("card-1", "sess-1");
    expect(frame.feedId).toBe(FeedId.CONTROL);
    const payload = parsePayload(frame);
    expect(payload).toEqual({
      action: "reset_session",
      card_id: "card-1",
      tug_session_id: "sess-1",
    });
  });
});
