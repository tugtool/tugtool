import { describe, test, expect } from "bun:test";
import {
  FeedId,
  FrameFlags,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  controlFrame,
  encodeFrame,
  decodeFrame,
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
    expect(decoded.feedId).toBe(0x99);
    expect(new TextDecoder().decode(decoded.payload)).toBe("opaque");
  });
});
