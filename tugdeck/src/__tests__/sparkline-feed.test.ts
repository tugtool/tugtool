/**
 * Sparkline feed — pins that the throughput meter (the PULSE strip's
 * sparkline source) ticks on the activity it historically ignored:
 * foreground tool results and `streaming_usage` frames. Drives REAL
 * CODE_OUTPUT frames through the store and reads the public meter, so a
 * regression in `recordThroughput`'s wiring surfaces here.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FeedId } from "@/protocol";

const TUG = "tug-sparkline";

function makeStore(): { store: CodeSessionStore; conn: TestFrameChannel } {
  const conn = new TestFrameChannel();
  const store = new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: TUG,
    sessionMode: "new",
  });
  return { store, conn };
}

function emit(conn: TestFrameChannel, evt: Record<string, unknown>): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, { ...evt, tug_session_id: TUG });
}

/** Sum of the meter window — nonzero iff some activity was recorded. */
function meterSum(store: CodeSessionStore): number {
  return store.throughputMeter
    .series(Date.now())
    .reduce((a, b) => a + b, 0);
}

describe("sparkline feed", () => {
  it("a FOREGROUND tool_result moves the meter (was subagent-only before)", () => {
    const { store, conn } = makeStore();
    expect(meterSum(store)).toBe(0);
    // No parent_tool_use_id → foreground.
    emit(conn, {
      type: "tool_result",
      tool_use_id: "toolu_fg",
      output: "x".repeat(400),
    });
    expect(meterSum(store)).toBeGreaterThan(0);
  });

  it("a streaming_usage frame ticks the meter even with no streamed text", () => {
    const { store, conn } = makeStore();
    expect(meterSum(store)).toBe(0);
    emit(conn, {
      type: "streaming_usage",
      msg_id: "m1",
      usage: { output_tokens: 12, input_tokens: 2000 },
    });
    expect(meterSum(store)).toBeGreaterThan(0);
  });

  it("a SUBAGENT tool_result still feeds the meter (unchanged path)", () => {
    const { store, conn } = makeStore();
    emit(conn, {
      type: "tool_result",
      tool_use_id: "toolu_sub",
      parent_tool_use_id: "toolu_agent",
      output: "y".repeat(400),
    });
    expect(meterSum(store)).toBeGreaterThan(0);
  });
});
