/**
 * WakeScheduler — Cohort B shadow scheduler tests.
 *
 * Pinned against `roadmap/tugplan-tide-session-wake.md` [D05]:
 *   - the scheduler maps `ScheduleWakeup` / `CronCreate` tool registrations
 *     onto croner jobs whose fire callback emits the same `wake_started`
 *     bracket tugcode emits for a real harness wake, plus a stream-json
 *     `user` line written to claude's stdin;
 *   - `cancel` and `cancelOnHarnessNotification` halt a pending job;
 *   - `dispose` halts every job and the scheduler becomes inert.
 *
 * The wake bracket payload shape mirrors `buildWakeStartedMessage`'s
 * Cohort A shape; the reducer cannot tell which path produced the
 * frame. See `tugcode/src/session.ts:buildWakeStartedMessage` and
 * `tugcode/src/scheduler.ts:WakeScheduler#handleFire`.
 */

import { describe, test, expect } from "bun:test";

import { WakeScheduler } from "../scheduler.ts";
import type { WakeStarted } from "../types.ts";

interface FrameSpy {
  frames: WakeStarted[];
  stdin: string[];
}

function makeSpy(): {
  spy: FrameSpy;
  emitFrame: (f: WakeStarted) => void;
  writeStdin: (l: string) => void;
} {
  const spy: FrameSpy = { frames: [], stdin: [] };
  return {
    spy,
    emitFrame: (f) => {
      spy.frames.push(f);
    },
    writeStdin: (l) => {
      spy.stdin.push(l);
    },
  };
}

const SESSION_ID = "session-test";

describe("WakeScheduler — schedule()", () => {
  test("kind:'delay' registers a job whose nextRun is delaySeconds in the future", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    const before = Date.now();
    s.schedule({
      kind: "delay",
      taskId: "task-1",
      delaySeconds: 60,
      prompt: "wake me",
    });

    const nextRun = s.nextRunAt("task-1");
    expect(nextRun).not.toBeNull();
    const target = before + 60_000;
    expect(nextRun!.getTime()).toBeGreaterThanOrEqual(target - 50);
    expect(nextRun!.getTime()).toBeLessThanOrEqual(target + 1000);

    expect(s.isScheduled("task-1")).toBe(true);

    s.dispose();
  });

  test("kind:'cron' with recurring:false caps at maxRuns:1", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.schedule({
      kind: "cron",
      taskId: "task-cron",
      cron: "* * * * *",
      prompt: "every minute",
      recurring: false,
    });

    expect(s.isScheduled("task-cron")).toBe(true);
    expect(s.nextRunAt("task-cron")).not.toBeNull();

    s.dispose();
  });

  test("kind:'cron' with recurring:true schedules without maxRuns cap", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.schedule({
      kind: "cron",
      taskId: "task-cron-r",
      cron: "* * * * *",
      prompt: "every minute forever",
      recurring: true,
    });

    expect(s.isScheduled("task-cron-r")).toBe(true);

    s.dispose();
  });

  test("schedule of an existing taskId replaces the prior cron", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.schedule({
      kind: "delay",
      taskId: "dup",
      delaySeconds: 60,
      prompt: "first",
    });
    const firstRun = s.nextRunAt("dup");

    s.schedule({
      kind: "delay",
      taskId: "dup",
      delaySeconds: 120,
      prompt: "second",
    });
    const secondRun = s.nextRunAt("dup");

    expect(secondRun!.getTime()).toBeGreaterThan(firstRun!.getTime());

    s.dispose();
  });
});

describe("WakeScheduler — cancel()", () => {
  test("returns true and stops the job for a known taskId", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.schedule({
      kind: "delay",
      taskId: "to-cancel",
      delaySeconds: 60,
      prompt: "nope",
    });

    const ok = s.cancel("to-cancel");
    expect(ok).toBe(true);
    expect(s.isScheduled("to-cancel")).toBe(false);
    expect(s.nextRunAt("to-cancel")).toBeNull();
  });

  test("returns false for an unknown taskId", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    expect(s.cancel("never-existed")).toBe(false);

    s.dispose();
  });
});

describe("WakeScheduler — cancelOnHarnessNotification()", () => {
  test("cancels a shadow job that matches a harness task_id", () => {
    const { spy, emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.schedule({
      kind: "delay",
      taskId: "harness-match",
      delaySeconds: 60,
      prompt: "should not fire",
    });

    s.cancelOnHarnessNotification("harness-match");

    expect(s.isScheduled("harness-match")).toBe(false);
    expect(spy.frames).toHaveLength(0);
    expect(spy.stdin).toHaveLength(0);
  });

  test("silent no-op for an unknown taskId (the common Cohort-A case)", () => {
    const { spy, emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    expect(() => s.cancelOnHarnessNotification("monitor-job")).not.toThrow();
    expect(spy.frames).toHaveLength(0);

    s.dispose();
  });
});

describe("WakeScheduler — dispose()", () => {
  test("stops every job and clears the map", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.schedule({ kind: "delay", taskId: "a", delaySeconds: 60, prompt: "a" });
    s.schedule({ kind: "delay", taskId: "b", delaySeconds: 60, prompt: "b" });
    s.schedule({
      kind: "cron",
      taskId: "c",
      cron: "* * * * *",
      prompt: "c",
      recurring: true,
    });

    s.dispose();

    expect(s.isScheduled("a")).toBe(false);
    expect(s.isScheduled("b")).toBe(false);
    expect(s.isScheduled("c")).toBe(false);
  });

  test("a second dispose() is idempotent", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.dispose();
    expect(() => s.dispose()).not.toThrow();
  });

  test("schedule() after dispose() is a silent no-op", () => {
    const { emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.dispose();
    s.schedule({
      kind: "delay",
      taskId: "post-dispose",
      delaySeconds: 60,
      prompt: "ghost",
    });

    expect(s.isScheduled("post-dispose")).toBe(false);
  });
});

describe("WakeScheduler — fire callback (integration)", () => {
  test("a 200ms delay job fires emitFrame and writeStdin exactly once with the registered prompt", async () => {
    const { spy, emitFrame, writeStdin } = makeSpy();
    const s = new WakeScheduler({ sessionId: SESSION_ID, emitFrame, writeStdin });

    s.schedule({
      kind: "delay",
      taskId: "fire-1",
      delaySeconds: 0.2,
      prompt: "tail kernel log",
      reason: "scheduled probe",
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(spy.frames).toHaveLength(1);
    const frame = spy.frames[0];
    expect(frame.type).toBe("wake_started");
    expect(frame.session_id).toBe(SESSION_ID);
    expect(frame.wake_trigger.task_id).toBe("fire-1");
    expect(frame.wake_trigger.tool_use_id).toBe("fire-1");
    expect(frame.wake_trigger.status).toBe("completed");
    expect(frame.wake_trigger.summary).toBe("scheduled probe");

    expect(spy.stdin).toHaveLength(1);
    const parsed = JSON.parse(spy.stdin[0]);
    expect(parsed.type).toBe("user");
    expect(parsed.message.role).toBe("user");
    expect(parsed.message.content).toEqual([
      { type: "text", text: "tail kernel log" },
    ]);

    expect(s.isScheduled("fire-1")).toBe(false);

    s.dispose();
  });

  test("fire callback survives an emitFrame throw — writeStdin is still invoked and sibling jobs survive", async () => {
    const spy = { frames: [] as WakeStarted[], stdin: [] as string[] };
    const s = new WakeScheduler({
      sessionId: SESSION_ID,
      emitFrame: () => {
        throw new Error("simulated emit failure");
      },
      writeStdin: (l) => {
        spy.stdin.push(l);
      },
    });

    s.schedule({
      kind: "delay",
      taskId: "throws",
      delaySeconds: 0.2,
      prompt: "still want stdin",
    });
    s.schedule({
      kind: "delay",
      taskId: "sibling",
      delaySeconds: 0.4,
      prompt: "second prompt",
    });

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(spy.stdin.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(spy.stdin[0]).message.content[0].text).toBe(
      "still want stdin",
    );
    const found = spy.stdin.find(
      (line) => JSON.parse(line).message.content[0].text === "second prompt",
    );
    expect(found).toBeDefined();

    s.dispose();
  });
});
