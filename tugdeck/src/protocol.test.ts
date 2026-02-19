import { describe, test, expect } from "bun:test";
import { FeedId, controlFrame, encodeFrame, decodeFrame } from "./protocol";

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
    expect(new TextDecoder().decode(decoded.payload)).toBe(
      new TextDecoder().decode(original.payload)
    );
  });
});
