// tugcode/src/__tests__/replay-time-slice.test.ts
//
// Pins the translate loop's time-slice yield: the loop yields the
// event loop only after `timeSliceMs` of continuous work (measured
// through the injectable clock), never on a count. A fast run pays
// zero yields; a slow run yields and still produces byte-identical
// output to a synchronous (`disableYield`) run.

import { describe, expect, test } from "bun:test";

import {
  translateJsonlSession,
  REPLAY_TIME_SLICE_MS,
  type ReplayInput,
} from "../replay.ts";
import type { OutboundMessage } from "../types.ts";

function fixtureJsonl(turns: number): string {
  const lines: string[] = [];
  for (let n = 1; n <= turns; n++) {
    lines.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: `prompt ${n}` }] },
      }),
    );
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          id: `msg_${n}`,
          role: "assistant",
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: `reply ${n}` }],
        },
      }),
    );
  }
  return lines.join("\n") + "\n";
}

async function drain(
  input: ReplayInput,
  opts: Parameters<typeof translateJsonlSession>[1],
): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const msg of translateJsonlSession(input, opts)) {
    out.push(msg);
  }
  return out;
}

describe("translate time-slice yield", () => {
  test("default slice is 8ms", () => {
    expect(REPLAY_TIME_SLICE_MS).toBe(8);
  });

  test("a fast run never yields (clock never advances)", async () => {
    let yields = 0;
    await drain(
      { kind: "ok", jsonl: fixtureJsonl(50) },
      { now: () => 0, onYield: () => (yields += 1) },
    );
    expect(yields).toBe(0);
  });

  test("a slow run yields on slice expiry — but less than once per message", async () => {
    // Clock advances 3ms per reading: the 8ms budget expires every
    // third per-message check, then the slice resets. The exact count
    // depends on the per-entry message inventory, so the assertion is
    // structural: yields happen, and strictly fewer than one per
    // message (the slice batches work; it is not per-count pacing).
    let t = 0;
    let yields = 0;
    const messages = await drain(
      { kind: "ok", jsonl: fixtureJsonl(10) },
      { now: () => (t += 3), onYield: () => (yields += 1) },
    );
    expect(yields).toBeGreaterThan(0);
    expect(yields).toBeLessThan(messages.length / 2);
  });

  test("timeSliceMs 0 yields after every per-message check", async () => {
    let yields = 0;
    const messages = await drain(
      { kind: "ok", jsonl: fixtureJsonl(5) },
      { timeSliceMs: 0, onYield: () => (yields += 1) },
    );
    // Every message that flows through the per-entry loop yields; the
    // bracket pair + synthesized system_metadata don't hit the check.
    expect(yields).toBe(messages.length - 3);
  });

  test("disableYield short-circuits even under a slow clock", async () => {
    let t = 0;
    let yields = 0;
    await drain(
      { kind: "ok", jsonl: fixtureJsonl(20) },
      {
        now: () => (t += 100),
        onYield: () => (yields += 1),
        disableYield: true,
      },
    );
    expect(yields).toBe(0);
  });

  test("slow-clock output is byte-identical to a synchronous run", async () => {
    const jsonl = fixtureJsonl(25);
    let t = 0;
    const sliced = await drain(
      { kind: "ok", jsonl },
      { now: () => (t += 5) },
    );
    const sync = await drain({ kind: "ok", jsonl }, { disableYield: true });
    expect(sliced).toEqual(sync);
  });
});
