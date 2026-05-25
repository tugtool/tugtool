// mapStreamEvent — block_index forwarding + content_block_start emission.
//
// Pins the wire-truth contract from [D07]: every text/thinking delta
// carries the `block_index` of the block it belongs to, and every wire
// content_block_start surfaces as a `content_block_start` IPC frame
// with the right kind / index / (for tool_use) tool_use_id + tool_name.
// The reducer's per-Message substrate mints on `(msg_id, block_index)`,
// so any regression here would silently break the multi-block / multi-
// msgId concatenation guarantees.

import { describe, expect, test } from "bun:test";
import { mapStreamEvent } from "../session.ts";

const baseCtx = { msgId: "msg_x", seq: 0, rev: 0 };

describe("mapStreamEvent — block_index + content_block_start", () => {
  test("content_block_start for a text block emits ContentBlockStart with kind=text + correct index", () => {
    const result = mapStreamEvent(
      {
        type: "content_block_start",
        index: 3,
        content_block: { type: "text", text: "" },
      },
      baseCtx,
      "",
    );
    const cbs = result.messages.find((m: any) => m.type === "content_block_start") as any;
    expect(cbs).toBeDefined();
    expect(cbs.kind).toBe("text");
    expect(cbs.block_index).toBe(3);
    expect(cbs.msg_id).toBe("msg_x");
  });

  test("content_block_start for a thinking block emits ContentBlockStart with kind=thinking", () => {
    const result = mapStreamEvent(
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      baseCtx,
      "",
    );
    const cbs = result.messages.find((m: any) => m.type === "content_block_start") as any;
    expect(cbs).toBeDefined();
    expect(cbs.kind).toBe("thinking");
    expect(cbs.block_index).toBe(0);
  });

  test("content_block_start for a tool_use block emits ContentBlockStart with tool_use_id + tool_name", () => {
    const result = mapStreamEvent(
      {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "tu_abc", name: "Bash", input: {} },
      },
      baseCtx,
      "",
    );
    const cbs = result.messages.find((m: any) => m.type === "content_block_start") as any;
    expect(cbs).toBeDefined();
    expect(cbs.kind).toBe("tool_use");
    expect(cbs.block_index).toBe(2);
    expect(cbs.tool_use_id).toBe("tu_abc");
    expect(cbs.tool_name).toBe("Bash");
  });

  test("text_delta carries block_index from the wire event", () => {
    const result = mapStreamEvent(
      {
        type: "content_block_delta",
        index: 5,
        delta: { type: "text_delta", text: "hi" },
      },
      baseCtx,
      "",
    );
    const text = result.messages.find((m: any) => m.type === "assistant_text") as any;
    expect(text).toBeDefined();
    expect(text.block_index).toBe(5);
    expect(text.text).toBe("hi");
    expect(text.is_partial).toBe(true);
  });

  test("thinking_delta carries block_index from the wire event", () => {
    const result = mapStreamEvent(
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "thinking_delta", thinking: "considering..." },
      },
      baseCtx,
      "",
    );
    const text = result.messages.find((m: any) => m.type === "thinking_text") as any;
    expect(text).toBeDefined();
    expect(text.block_index).toBe(1);
    expect(text.text).toBe("considering...");
  });

  test("text deltas under the SAME (msg_id, block_index) share that pair (reducer will append)", () => {
    // Two consecutive deltas under the same block both carry the same
    // block_index — the reducer's append-or-mutate rule keys on that.
    const r1 = mapStreamEvent(
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
      baseCtx,
      "",
    );
    const r2 = mapStreamEvent(
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: ", world" },
      },
      baseCtx,
      "Hello",
    );
    const t1 = r1.messages.find((m: any) => m.type === "assistant_text") as any;
    const t2 = r2.messages.find((m: any) => m.type === "assistant_text") as any;
    expect(t1.block_index).toBe(0);
    expect(t2.block_index).toBe(0);
  });

  test("text deltas under DIFFERENT block_indices announce a new block to the reducer", () => {
    // Across the boundary (block 0 → block 1), block_index changes —
    // the reducer mints a fresh Message at the new pair.
    const r1 = mapStreamEvent(
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "first block" },
      },
      baseCtx,
      "",
    );
    const r2 = mapStreamEvent(
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "second block" },
      },
      baseCtx,
      "first block",
    );
    expect((r1.messages.find((m: any) => m.type === "assistant_text") as any).block_index).toBe(0);
    expect((r2.messages.find((m: any) => m.type === "assistant_text") as any).block_index).toBe(1);
  });
});
