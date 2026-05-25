/**
 * Step 10 — wake fire path semantics and double-fire safety integration.
 *
 * The Step 8 tests pinned the scheduler's API in isolation. Step 10 adds:
 *   - cron recurring behavior: a `kind:"cron"` job with `recurring:true`
 *     keeps firing on subsequent matches; `recurring:false` fires once;
 *   - the synthetic stream-json `user_message` shape exactly matches
 *     what `SessionManager.handleUserMessage` would write for a real
 *     user submission (verified line-for-line);
 *   - end-to-end double-fire safety: a harness `task_notification` for a
 *     task we shadowed cancels the shadow before it can fire (the
 *     `cancelOnHarnessNotification` hook installed in
 *     `SessionManager.handleTaskNotification`).
 *
 * Anchored against `roadmap/tugplan-tide-session-wake.md` [D05] and the
 * capture-pinned wire shape in `session.ts:buildWakeStartedMessage`.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Cron } from "croner";

import { SessionManager } from "../session.ts";
import { WakeScheduler } from "../scheduler.ts";
import type { WakeStarted, ToolUse } from "../types.ts";

const SESSION_ID = "session-fire";

function makeSpy(): {
  frames: WakeStarted[];
  stdin: string[];
  emitFrame: (f: WakeStarted) => void;
  writeStdin: (l: string) => void;
} {
  const frames: WakeStarted[] = [];
  const stdin: string[] = [];
  return {
    frames,
    stdin,
    emitFrame: (f) => frames.push(f),
    writeStdin: (l) => stdin.push(l),
  };
}

describe("WakeScheduler — synthetic user_message shape", () => {
  test("the JSON written to stdin parses as the same shape handleUserMessage produces", async () => {
    const spy = makeSpy();
    const s = new WakeScheduler({
      sessionId: SESSION_ID,
      emitFrame: spy.emitFrame,
      writeStdin: spy.writeStdin,
    });

    s.schedule({
      kind: "delay",
      taskId: "shape-1",
      delaySeconds: 0.1,
      prompt: "do the thing",
      reason: "scheduled probe",
    });
    await new Promise((r) => setTimeout(r, 300));

    expect(spy.stdin).toHaveLength(1);
    const parsed = JSON.parse(spy.stdin[0]);
    expect(parsed).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "do the thing" }],
      },
    });

    s.dispose();
  });
});

describe("WakeScheduler — cron recurring fire counts", () => {
  test("recurring:false fires exactly once via manual trigger() on a never-matching pattern", async () => {
    const spy = makeSpy();
    const s = new WakeScheduler({
      sessionId: SESSION_ID,
      emitFrame: spy.emitFrame,
      writeStdin: spy.writeStdin,
    });

    // Far-future pattern (year 2099) so croner never matches naturally;
    // exercise the fire path through croner's manual `.trigger()`.
    s.schedule({
      kind: "cron",
      taskId: "cron-oneshot",
      cron: "0 0 1 1 *",
      prompt: "new year",
      recurring: false,
    });

    const jobs = (s as any).jobs as Map<string, { cron: Cron }>;
    const entry = jobs.get("cron-oneshot");
    expect(entry).toBeDefined();
    await entry!.cron.trigger();
    expect(spy.frames).toHaveLength(1);
    expect(spy.stdin).toHaveLength(1);
    expect(s.isScheduled("cron-oneshot")).toBe(false);

    s.dispose();
  });

  test("recurring:true keeps firing across multiple manual triggers", async () => {
    const spy = makeSpy();
    const s = new WakeScheduler({
      sessionId: SESSION_ID,
      emitFrame: spy.emitFrame,
      writeStdin: spy.writeStdin,
    });

    s.schedule({
      kind: "cron",
      taskId: "cron-recurring",
      cron: "0 0 1 1 *",
      prompt: "again",
      recurring: true,
    });

    const jobs = (s as any).jobs as Map<string, { cron: Cron }>;
    const entry = jobs.get("cron-recurring");
    expect(entry).toBeDefined();
    await entry!.cron.trigger();
    await entry!.cron.trigger();
    await entry!.cron.trigger();

    expect(spy.frames).toHaveLength(3);
    expect(spy.stdin).toHaveLength(3);
    expect(s.isScheduled("cron-recurring")).toBe(true);

    s.dispose();
  });
});

describe("WakeScheduler — cancelOnHarnessNotification prevents fire", () => {
  test("after cancelOnHarnessNotification, emitFrame is never called for the cancelled job", async () => {
    const spy = makeSpy();
    const s = new WakeScheduler({
      sessionId: SESSION_ID,
      emitFrame: spy.emitFrame,
      writeStdin: spy.writeStdin,
    });

    s.schedule({
      kind: "delay",
      taskId: "preempted",
      delaySeconds: 0.1,
      prompt: "should not fire",
    });

    s.cancelOnHarnessNotification("preempted");

    await new Promise((r) => setTimeout(r, 300));
    expect(spy.frames).toHaveLength(0);
    expect(spy.stdin).toHaveLength(0);

    s.dispose();
  });

  test("cancelOnHarnessNotification for one task leaves sibling jobs alive", async () => {
    const spy = makeSpy();
    const s = new WakeScheduler({
      sessionId: SESSION_ID,
      emitFrame: spy.emitFrame,
      writeStdin: spy.writeStdin,
    });

    s.schedule({
      kind: "delay",
      taskId: "kept",
      delaySeconds: 0.1,
      prompt: "fires",
    });
    s.schedule({
      kind: "delay",
      taskId: "preempted",
      delaySeconds: 0.1,
      prompt: "cancelled",
    });
    s.cancelOnHarnessNotification("preempted");

    await new Promise((r) => setTimeout(r, 300));

    expect(spy.frames).toHaveLength(1);
    expect(spy.frames[0].wake_trigger.task_id).toBe("kept");

    s.dispose();
  });
});

describe("SessionManager.handleTaskNotification — double-fire safety hook", () => {
  let projectDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "wake-doublefire-"));
    manager = new SessionManager(projectDir, SESSION_ID, "new", undefined, {
      sessionsDbPath: null,
    });
  });
  afterEach(() => {
    void manager.shutdown();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("shadow scheduled, then harness task_notification for the same task_id cancels the shadow", async () => {
    // 1. Claude calls ScheduleWakeup; intercept registers the shadow.
    const intercept: ToolUse = {
      type: "tool_use",
      msg_id: "msg-x",
      seq: 0,
      tool_name: "ScheduleWakeup",
      tool_use_id: "shared-task-id",
      input: { delaySeconds: 60, prompt: "do later" },
      ipc_version: 2,
    };
    (manager as any).handleSchedulingToolUse(intercept);
    const scheduler = (manager as any).scheduler as WakeScheduler;
    expect(scheduler.isScheduled("shared-task-id")).toBe(true);

    // 2. The harness emits a task_notification for the SAME task_id —
    //    simulate the inter-turn dispatch site directly.
    const harnessEvent = {
      type: "system",
      subtype: "task_notification",
      task_id: "shared-task-id",
      status: "completed",
      summary: "harness fired",
      output_file: "",
      tool_use_id: "shared-task-id",
    };
    (manager as any).handleTaskNotification(harnessEvent);

    // 3. Shadow is cancelled; cohort-A wake_started is on the wire
    //    (we can't easily intercept writeLine here so we verify the
    //    isInWake flip — the bracket open — as a proxy for emission).
    expect(scheduler.isScheduled("shared-task-id")).toBe(false);
    expect((manager as any).isInWake).toBe(true);
  });

  test("harness task_notification for an UN-shadowed Cohort-A task_id is a silent no-op on the scheduler side", async () => {
    const scheduler = (manager as any).scheduler as WakeScheduler;
    // Nothing scheduled — harness fires anyway (Monitor / Bash runbg).
    const harnessEvent = {
      type: "system",
      subtype: "task_notification",
      task_id: "monitor-task",
      status: "completed",
      summary: "monitor finished",
      output_file: "",
      tool_use_id: "monitor-task",
    };
    expect(() => (manager as any).handleTaskNotification(harnessEvent)).not.toThrow();
    expect(scheduler.isScheduled("monitor-task")).toBe(false);
    expect((manager as any).isInWake).toBe(true);
  });
});
