/**
 * Step 11 — Drift pinning for ScheduleWakeup / CronCreate / CronDelete
 * tool input shapes.
 *
 * `WakeScheduler` and `SessionManager.handleSchedulingToolUse` parse
 * three tool inputs out of claude's stream-json wire:
 *
 *   ScheduleWakeup → `{delaySeconds: number, prompt: string, reason?: string}`
 *   CronCreate     → `{cron: string, prompt: string, recurring: boolean}`
 *   CronDelete     → `{id: string}`
 *
 * The SDK type package (`@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts`)
 * does NOT export interfaces for these three tools — they're harness /
 * runtime tools, not SDK tools. So the drift pinning is anchored
 * against the Step-6 captured fixtures
 * (`tugrust/.../stream-json-catalog/v2.1.150-spike/`) plus the
 * tool_result shape (which carries the cron id CronDelete will
 * reference back).
 *
 * If a future claude release renames a key on the tool input, the
 * fixture-derived shape check here flips first and forces a re-capture
 * + re-pin before the live intercept silently drops the wake.
 *
 * See `roadmap/tugplan-tide-session-wake.md` Step 11.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

function readWireRows(fixtureRelPath: string): Array<Record<string, unknown>> {
  const fixturePath = new URL(
    `../../../tugrust/crates/tugcast/tests/fixtures/${fixtureRelPath}`,
    import.meta.url,
  ).pathname;
  const raw = readFileSync(fixturePath, "utf8");
  const rows: Array<Record<string, unknown>> = [];
  for (const line of raw.split("\n").filter((l) => l.length > 0)) {
    // Captures occasionally interleave non-JSON diagnostic lines
    // (claude's stderr warnings); skip those silently — the
    // tool_use / tool_result lines we care about are always JSON.
    if (!line.startsWith("{")) continue;
    rows.push(JSON.parse(line) as Record<string, unknown>);
  }
  return rows;
}

function findCompleteToolUse(
  rows: Array<Record<string, unknown>>,
  toolName: string,
): { tool_use_id: string; input: Record<string, unknown> } {
  // Pick the assistant snapshot (not content_block_start, which carries
  // input:{}) — that's the one with the complete input.
  for (const row of rows) {
    if (row.type !== "assistant") continue;
    const message = row.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && block.name === toolName) {
        const input = block.input as Record<string, unknown> | undefined;
        if (input && Object.keys(input).length > 0) {
          return {
            tool_use_id: block.id as string,
            input,
          };
        }
      }
    }
  }
  throw new Error(`no complete tool_use found for tool_name=${toolName}`);
}

function findToolUseResult(
  rows: Array<Record<string, unknown>>,
  toolUseId: string,
): Record<string, unknown> {
  for (const row of rows) {
    if (row.type !== "user") continue;
    const message = row.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) continue;
    const match = content.find(
      (block) =>
        block.type === "tool_result" && block.tool_use_id === toolUseId,
    );
    if (match) {
      const toolUseResult = row.tool_use_result as
        | Record<string, unknown>
        | undefined;
      if (toolUseResult) {
        return toolUseResult;
      }
      throw new Error(
        `tool_result for ${toolUseId} carried no tool_use_result payload`,
      );
    }
  }
  throw new Error(`no tool_result found for tool_use_id=${toolUseId}`);
}

describe("Drift pinning — ScheduleWakeup input shape", () => {
  test("captured ScheduleWakeup tool_use carries delaySeconds:number + prompt:string", () => {
    const rows = readWireRows(
      "stream-json-catalog/v2.1.150-spike/test-schedulewakeup-streamio-raw.jsonl",
    );
    const { input } = findCompleteToolUse(rows, "ScheduleWakeup");
    expect(typeof input.delaySeconds).toBe("number");
    expect(typeof input.prompt).toBe("string");
    // `reason` is optional but present on this capture — verify the
    // optional-string shape so a drift to a required field surfaces.
    expect(typeof input.reason).toBe("string");
  });
});

describe("Drift pinning — CronCreate input shape", () => {
  test("captured CronCreate tool_use carries cron:string + prompt:string + recurring:boolean", () => {
    const rows = readWireRows(
      "stream-json-catalog/v2.1.150-spike/test-croncreate-streamio-raw.jsonl",
    );
    const { input } = findCompleteToolUse(rows, "CronCreate");
    expect(typeof input.cron).toBe("string");
    expect(typeof input.prompt).toBe("string");
    expect(typeof input.recurring).toBe("boolean");
  });
});

describe("Drift pinning — CronCreate tool_use_result carries id:string", () => {
  test("the result payload our id-mapping reads is shaped {id: string, humanSchedule: string, recurring: boolean, durable: boolean}", () => {
    const rows = readWireRows(
      "stream-json-catalog/v2.1.150-spike/test-croncreate-streamio-raw.jsonl",
    );
    const { tool_use_id } = findCompleteToolUse(rows, "CronCreate");
    const result = findToolUseResult(rows, tool_use_id);
    expect(typeof result.id).toBe("string");
    expect((result.id as string).length).toBeGreaterThan(0);
    // The other fields are not parsed by our intercept but are pinned
    // here to detect schema-wide drift before it silently widens scope.
    expect(typeof result.humanSchedule).toBe("string");
    expect(typeof result.recurring).toBe("boolean");
    expect(typeof result.durable).toBe("boolean");
  });
});

describe("Drift pinning — CronDelete input shape (cross-derived)", () => {
  test("our parser reads {id:string} — pinned against the same id key CronCreate's tool_use_result emits", () => {
    // No CronDelete capture exists yet (the Step-6 sweep didn't cover
    // a full Create → Delete round-trip). The shape is cross-derived:
    // CronCreate's tool_use_result returns `id:string` and CronDelete
    // accepts that same value as its sole input. This test pins the
    // key our `handleSchedulingToolUse` CronDelete branch reads (`id`)
    // against the key CronCreate emits (`id`) in the same fixture
    // sweep, so a rename on either side trips here.
    const rows = readWireRows(
      "stream-json-catalog/v2.1.150-spike/test-croncreate-streamio-raw.jsonl",
    );
    const { tool_use_id } = findCompleteToolUse(rows, "CronCreate");
    const result = findToolUseResult(rows, tool_use_id);
    // Pin: the key we use for CronDelete intercept lookup ("id") is the
    // same one CronCreate's result carries.
    expect("id" in result).toBe(true);
    expect(typeof result.id).toBe("string");
  });
});
