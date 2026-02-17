import { describe, test, expect, beforeEach } from "bun:test";
import { MessageOrderingBuffer } from "../cards/conversation/ordering.ts";
import type { ConversationEvent, AssistantText } from "../cards/conversation/types.ts";

describe("MessageOrderingBuffer", () => {
  let delivered: ConversationEvent[];
  let resyncCalled: boolean;
  let buffer: MessageOrderingBuffer;

  beforeEach(() => {
    delivered = [];
    resyncCalled = false;
    buffer = new MessageOrderingBuffer(
      (event) => delivered.push(event),
      () => { resyncCalled = true; }
    );
  });

  function createAssistantText(seq: number, msgId: string = "msg-1"): AssistantText {
    return {
      type: "assistant_text",
      msg_id: msgId,
      seq,
      rev: 0,
      text: `Message ${seq}`,
      is_partial: false,
      status: "complete",
    };
  }

  test("in-order delivery", () => {
    buffer.push(createAssistantText(0));
    buffer.push(createAssistantText(1));
    buffer.push(createAssistantText(2));

    expect(delivered.length).toBe(3);
    expect((delivered[0] as AssistantText).seq).toBe(0);
    expect((delivered[1] as AssistantText).seq).toBe(1);
    expect((delivered[2] as AssistantText).seq).toBe(2);
  });

  test("out-of-order delivery", () => {
    buffer.push(createAssistantText(1)); // Buffered
    expect(delivered.length).toBe(0);

    buffer.push(createAssistantText(0)); // Triggers flush
    expect(delivered.length).toBe(2);
    expect((delivered[0] as AssistantText).seq).toBe(0);
    expect((delivered[1] as AssistantText).seq).toBe(1);
  });

  test("deduplication by msg_id:seq", () => {
    buffer.push(createAssistantText(0, "msg-1"));
    buffer.push(createAssistantText(0, "msg-1")); // Duplicate

    expect(delivered.length).toBe(1);
  });

  test("partial updates are not deduplicated", () => {
    const partial1: AssistantText = {
      type: "assistant_text",
      msg_id: "msg-1",
      seq: 0,
      rev: 0,
      text: "Hello",
      is_partial: true,
      status: "partial",
    };

    const partial2: AssistantText = {
      type: "assistant_text",
      msg_id: "msg-1",
      seq: 0,
      rev: 1,
      text: "Hello world",
      is_partial: true,
      status: "partial",
    };

    buffer.push(partial1);
    buffer.push(partial2);

    expect(delivered.length).toBe(2);
    expect((delivered[0] as AssistantText).rev).toBe(0);
    expect((delivered[1] as AssistantText).rev).toBe(1);
  });

  test("pass-through for non-sequenced events", () => {
    const protocolAck: ConversationEvent = {
      type: "protocol_ack",
      version: 1,
      session_id: "sess-123",
    };

    buffer.push(protocolAck);
    expect(delivered.length).toBe(1);
    expect(delivered[0].type).toBe("protocol_ack");
  });

  test("gap timeout triggers resync", async () => {
    buffer.push(createAssistantText(0));
    buffer.push(createAssistantText(2)); // Gap at seq 1

    expect(delivered.length).toBe(1); // Only seq 0 delivered
    expect(resyncCalled).toBe(false);

    // Wait for gap timeout (5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 5100));

    expect(delivered.length).toBe(2); // seq 2 delivered after timeout
    expect((delivered[1] as AssistantText).seq).toBe(2);
    expect(resyncCalled).toBe(true);
  }, 10000); // 10 second test timeout

  test("stale messages (seq < expected) are dropped", () => {
    buffer.push(createAssistantText(0));
    buffer.push(createAssistantText(1));
    buffer.push(createAssistantText(0)); // Stale

    expect(delivered.length).toBe(2);
  });

  test("reset clears state", () => {
    buffer.push(createAssistantText(0));
    buffer.push(createAssistantText(2)); // Buffered

    buffer.reset();

    // After reset, seq 0 should be next expected again
    buffer.push(createAssistantText(0));
    expect(delivered.length).toBe(2); // 1 from before reset, 1 after
  });

  test("multiple out-of-order messages flush correctly", () => {
    buffer.push(createAssistantText(3));
    buffer.push(createAssistantText(1));
    buffer.push(createAssistantText(2));
    buffer.push(createAssistantText(0)); // Triggers cascade flush

    expect(delivered.length).toBe(4);
    expect((delivered[0] as AssistantText).seq).toBe(0);
    expect((delivered[1] as AssistantText).seq).toBe(1);
    expect((delivered[2] as AssistantText).seq).toBe(2);
    expect((delivered[3] as AssistantText).seq).toBe(3);
  });
});
