/**
 * Step 9 — `SessionManager.handleSchedulingToolUse` / `handleCronCreateResult`
 * intercepts for ScheduleWakeup / CronCreate / CronDelete.
 *
 * Each test exercises the private method directly (cast through `any`) so
 * the assertion stays a pure-logic shape contract: the dispatch site in
 * `dispatchEventToTurn` calls `handleSchedulingToolUse` once per
 * `tool_use` IPC frame produced by `routeTopLevelEvent`, and these tests
 * pin the parsing / scheduling / mapping logic that runs there.
 *
 * The empirical input shapes are anchored against
 * `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/`
 * captures `test-schedulewakeup-streamio-raw.jsonl` and
 * `test-croncreate-streamio-raw.jsonl`. The drift test in
 * `wake-scheduler-tool-input-drift.test.ts` (Step 11) keeps these
 * structures pinned against the SDK's actual tool schemas.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "../session.ts";
import type { ToolUse, ToolUseStructured } from "../types.ts";

const SESSION_ID = "session-intercept";

function makeManager(): { manager: SessionManager; cleanup: () => void } {
  const projectDir = mkdtempSync(join(tmpdir(), "wake-intercept-"));
  const manager = new SessionManager(projectDir, SESSION_ID, "new", undefined, {
    sessionsDbPath: null,
  });
  return {
    manager,
    cleanup: () => {
      void manager.shutdown();
      rmSync(projectDir, { recursive: true, force: true });
    },
  };
}

function toolUse(name: string, toolUseId: string, input: object): ToolUse {
  return {
    type: "tool_use",
    msg_id: "msg-test",
    seq: 0,
    tool_name: name,
    tool_use_id: toolUseId,
    input,
    ipc_version: 2,
  };
}

function toolUseStructured(
  toolUseId: string,
  structured: Record<string, unknown>,
): ToolUseStructured {
  return {
    type: "tool_use_structured",
    tool_use_id: toolUseId,
    tool_name: "",
    structured_result: structured,
    ipc_version: 2,
  };
}

describe("handleSchedulingToolUse — ScheduleWakeup", () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => {
    ctx = makeManager();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  test("valid input registers a delay-kind shadow job under tool_use_id", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("ScheduleWakeup", "toolu_sw_1", {
        delaySeconds: 60,
        prompt: "wake me up",
      }),
    );
    expect(scheduler.isScheduled("toolu_sw_1")).toBe(true);
    expect(scheduler.nextRunAt("toolu_sw_1")).not.toBeNull();
  });

  test("missing delaySeconds skips scheduling and does NOT throw", () => {
    const scheduler = (ctx.manager as any).scheduler;
    expect(() =>
      (ctx.manager as any).handleSchedulingToolUse(
        toolUse("ScheduleWakeup", "toolu_sw_bad", { prompt: "no delay" }),
      ),
    ).not.toThrow();
    expect(scheduler.isScheduled("toolu_sw_bad")).toBe(false);
  });

  test("missing prompt skips scheduling", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("ScheduleWakeup", "toolu_sw_noprompt", { delaySeconds: 60 }),
    );
    expect(scheduler.isScheduled("toolu_sw_noprompt")).toBe(false);
  });
});

describe("handleSchedulingToolUse — CronCreate", () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => {
    ctx = makeManager();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  test("valid input registers a cron-kind shadow job and remembers tool_use_id", () => {
    const scheduler = (ctx.manager as any).scheduler;
    const pending = (ctx.manager as any).pendingCronCreateToolUseIds as Set<string>;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("CronCreate", "toolu_cc_1", {
        cron: "* * * * *",
        prompt: "minutely",
        recurring: true,
      }),
    );
    expect(scheduler.isScheduled("toolu_cc_1")).toBe(true);
    expect(pending.has("toolu_cc_1")).toBe(true);
  });

  test("recurring:false also registers, scheduler treats as one-shot", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("CronCreate", "toolu_cc_oneshot", {
        cron: "53 19 24 5 *",
        prompt: "fire once",
        recurring: false,
      }),
    );
    expect(scheduler.isScheduled("toolu_cc_oneshot")).toBe(true);
  });

  test("missing cron skips scheduling", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("CronCreate", "toolu_cc_bad", {
        prompt: "no cron",
        recurring: true,
      }),
    );
    expect(scheduler.isScheduled("toolu_cc_bad")).toBe(false);
  });

  test("non-boolean recurring skips scheduling (input shape sanity)", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("CronCreate", "toolu_cc_str", {
        cron: "* * * * *",
        prompt: "p",
        recurring: "yes",
      }),
    );
    expect(scheduler.isScheduled("toolu_cc_str")).toBe(false);
  });
});

describe("handleCronCreateResult — id mapping", () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => {
    ctx = makeManager();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  test("pinned end-to-end: CronCreate → tool_result with id → CronDelete cancels the right shadow", () => {
    const scheduler = (ctx.manager as any).scheduler;
    const map = (ctx.manager as any).cronIdToToolUseId as Map<string, string>;

    // 1. Claude calls CronCreate.
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("CronCreate", "toolu_full_1", {
        cron: "* * * * *",
        prompt: "every minute",
        recurring: true,
      }),
    );
    expect(scheduler.isScheduled("toolu_full_1")).toBe(true);

    // 2. Claude's tool_result for that tool_use_id arrives with the cron id.
    (ctx.manager as any).handleCronCreateResult(
      toolUseStructured("toolu_full_1", {
        id: "3ea6c934",
        humanSchedule: "* * * * *",
        recurring: true,
        durable: false,
      }),
    );
    expect(map.get("3ea6c934")).toBe("toolu_full_1");

    // 3. Later, claude calls CronDelete with the cron id — shadow is cancelled.
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("CronDelete", "toolu_del_1", { id: "3ea6c934" }),
    );
    expect(scheduler.isScheduled("toolu_full_1")).toBe(false);
    expect(map.has("3ea6c934")).toBe(false);
  });

  test("tool_result for a tool_use_id we never shadowed is a silent no-op", () => {
    const map = (ctx.manager as any).cronIdToToolUseId as Map<string, string>;
    (ctx.manager as any).handleCronCreateResult(
      toolUseStructured("toolu_orphan", { id: "abc123" }),
    );
    expect(map.size).toBe(0);
  });

  test("tool_result missing id is dropped (no map entry, no throw)", () => {
    const scheduler = (ctx.manager as any).scheduler;
    const map = (ctx.manager as any).cronIdToToolUseId as Map<string, string>;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("CronCreate", "toolu_noid", {
        cron: "* * * * *",
        prompt: "p",
        recurring: false,
      }),
    );
    expect(scheduler.isScheduled("toolu_noid")).toBe(true);

    (ctx.manager as any).handleCronCreateResult(
      toolUseStructured("toolu_noid", { humanSchedule: "* * * * *" }),
    );
    expect(map.size).toBe(0);
    // Shadow job is still active — id was never bound, so a future
    // CronDelete from the user is the only thing that would cancel it.
    expect(scheduler.isScheduled("toolu_noid")).toBe(true);
  });
});

describe("handleSchedulingToolUse — CronDelete with no mapping", () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => {
    ctx = makeManager();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  test("CronDelete for an unknown id is a silent no-op", () => {
    expect(() =>
      (ctx.manager as any).handleSchedulingToolUse(
        toolUse("CronDelete", "toolu_del_orphan", { id: "never-existed" }),
      ),
    ).not.toThrow();
  });

  test("CronDelete with non-string id skips silently", () => {
    expect(() =>
      (ctx.manager as any).handleSchedulingToolUse(
        toolUse("CronDelete", "toolu_del_typo", { id: 42 }),
      ),
    ).not.toThrow();
  });
});

describe("handleSchedulingToolUse — non-scheduling tools", () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => {
    ctx = makeManager();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  test("Bash tool_use bypasses the intercept entirely (no scheduler call)", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("Bash", "toolu_bash", { command: "echo hi" }),
    );
    expect(scheduler.isScheduled("toolu_bash")).toBe(false);
  });

  test("Read tool_use bypasses the intercept entirely", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("Read", "toolu_read", { file_path: "/tmp/x" }),
    );
    expect(scheduler.isScheduled("toolu_read")).toBe(false);
  });

  test("Monitor (a Cohort A tool, not a scheduler tool) is also a no-op here", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("Monitor", "toolu_mon", { command: "tail" }),
    );
    expect(scheduler.isScheduled("toolu_mon")).toBe(false);
  });
});

describe("handleSchedulingToolUse — empty input (content_block_start path)", () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => {
    ctx = makeManager();
  });
  afterEach(() => {
    ctx.cleanup();
  });

  test("CronCreate with empty input ({}) is dropped — the content_block_start always carries input:{}", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("CronCreate", "toolu_empty", {}),
    );
    expect(scheduler.isScheduled("toolu_empty")).toBe(false);
  });

  test("ScheduleWakeup with empty input is dropped", () => {
    const scheduler = (ctx.manager as any).scheduler;
    (ctx.manager as any).handleSchedulingToolUse(
      toolUse("ScheduleWakeup", "toolu_sw_empty", {}),
    );
    expect(scheduler.isScheduled("toolu_sw_empty")).toBe(false);
  });
});
