// tugcode-owned shadow scheduler for ScheduleWakeup / CronCreate (Cohort B).
//
// Background — Cohort B from the Step-6 empirical sweep
// (`roadmap/tugplan-tide-session-wake.md` [Q01]): the harness facilities
// `ScheduleWakeup` and `CronCreate` register their fire intent inside
// claude's in-process scheduler but DO NOT emit a `system/task_notification`
// when the time arrives in stream-json spawn mode (the mode tugcode uses).
// Stream-json sessions therefore receive zero wire signal when a wake's
// time hits, and the upstream PPF-01 manifests as "tool was called, nothing
// ever happens." See `tugrust/.../v2.1.150-spike/test-schedulewakeup-streamio-raw.jsonl`
// and `test-croncreate-streamio-raw.jsonl` for the captured non-fires.
//
// `WakeScheduler` closes the gap by running a shadow schedule on tugcode's
// side. When tugcode observes a `ScheduleWakeup` / `CronCreate` tool_use on
// the stream-json wire (Step 9 intercept), the call additionally registers
// a job here. When the job's time hits, this class fires the same bracket
// pair tugcode emits for a real harness wake:
//   1. a `wake_started` IPC frame (forwarded to tugdeck via `emitFrame`),
//   2. a stream-json `user` message to claude's stdin (via `writeStdin`)
//      carrying the prompt the user originally supplied.
// Claude responds in its next turn; the reducer's `waking → idle` bracket
// closes that turn. End-to-end, the reducer cannot tell whether the wake
// originated from the harness or from this shadow path.
//
// Lifetime: session-scoped. `SessionManager` constructs one per session
// and calls `dispose()` from its shutdown path. `dispose()` halts every
// pending croner Cron and clears the job map — the scheduler dies with
// the session (no orphan jobs survive a session teardown), mirroring
// claude's native in-process scheduler.

import { Cron } from "croner";

import type { WakeStarted } from "./types.ts";

/**
 * Construction-time injectable side effects. Captured by the scheduler at
 * construction and invoked from each job's fire callback.
 *
 * - `emitFrame` is the function `SessionManager` uses to send an IPC frame
 *   to tugdeck (in production: `writeLine` over stdout).
 * - `writeStdin` writes a single line of bytes to claude's stdin. Callers
 *   must NOT append a trailing newline — the scheduler appends it.
 */
export interface WakeSchedulerOptions {
  sessionId: string;
  emitFrame: (frame: WakeStarted) => void;
  writeStdin: (line: string) => void;
}

/**
 * Discriminated job spec passed to {@link WakeScheduler.schedule}.
 *
 * `kind: "delay"` mirrors `ScheduleWakeup` — fire once `delaySeconds` from
 * now. `kind: "cron"` mirrors `CronCreate` — fire on the supplied cron
 * pattern; `recurring:false` runs exactly once (the wake's `summary`
 * defaults to `reason ?? "scheduled wake"`).
 */
export type ScheduleSpec =
  | {
      kind: "delay";
      taskId: string;
      delaySeconds: number;
      prompt: string;
      reason?: string;
    }
  | {
      kind: "cron";
      taskId: string;
      cron: string;
      prompt: string;
      recurring: boolean;
      reason?: string;
    };

interface JobEntry {
  cron: Cron;
  prompt: string;
  reason?: string;
  recurring: boolean;
  scheduledAt: number;
  kind: "delay" | "cron";
}

/**
 * Shadow scheduler housing the croner-backed jobs that close the Cohort B
 * gap. See module header for the empirical rationale and
 * `roadmap/tugplan-tide-session-wake.md` [D05] for the design.
 */
export class WakeScheduler {
  private readonly sessionId: string;
  private readonly emitFrame: (frame: WakeStarted) => void;
  private readonly writeStdin: (line: string) => void;
  private readonly jobs = new Map<string, JobEntry>();
  private disposed = false;

  constructor(options: WakeSchedulerOptions) {
    this.sessionId = options.sessionId;
    this.emitFrame = options.emitFrame;
    this.writeStdin = options.writeStdin;
  }

  /**
   * Register a shadow wake job under `spec.taskId`. Replaces any existing
   * job with the same id (the previous cron is stopped first, mirroring
   * what a fresh `ScheduleWakeup` for the same `tool_use_id` would mean).
   *
   * For `kind: "delay"` jobs the target is `Date(now + delaySeconds*1000)`
   * — croner schedules a single fire at that exact moment. For
   * `kind: "cron"` jobs the supplied cron expression is handed verbatim;
   * `recurring:false` is enforced via `maxRuns:1` so croner stops the job
   * after its first fire.
   *
   * No-op after `dispose()`; a disposed scheduler discards new schedule
   * calls (and logs once). See [D05].
   */
  schedule(spec: ScheduleSpec): void {
    if (this.disposed) {
      console.log(
        `[tide::wake-scheduler] schedule after dispose ignored ` +
          `task_id=${spec.taskId}`,
      );
      return;
    }

    const existing = this.jobs.get(spec.taskId);
    if (existing) {
      existing.cron.stop();
    }

    const fire = (): void => this.handleFire(spec.taskId);

    let cron: Cron;
    if (spec.kind === "delay") {
      const fireAt = new Date(Date.now() + spec.delaySeconds * 1000);
      cron = new Cron(fireAt, { maxRuns: 1 }, fire);
    } else {
      cron = new Cron(
        spec.cron,
        { maxRuns: spec.recurring ? Infinity : 1 },
        fire,
      );
    }

    this.jobs.set(spec.taskId, {
      cron,
      prompt: spec.prompt,
      reason: spec.reason,
      recurring: spec.kind === "cron" ? spec.recurring : false,
      scheduledAt: Date.now(),
      kind: spec.kind,
    });

    if (spec.kind === "delay") {
      console.log(
        `[tide::wake-scheduler] scheduled kind=delay ` +
          `task_id=${spec.taskId} delay_seconds=${spec.delaySeconds}`,
      );
    } else {
      console.log(
        `[tide::wake-scheduler] scheduled kind=cron ` +
          `task_id=${spec.taskId} cron=${spec.cron} recurring=${spec.recurring}`,
      );
    }
  }

  /**
   * Cancel the shadow job registered under `taskId`. Returns `true` when
   * a job was found and stopped, `false` when no such job exists.
   *
   * Permanently halts the underlying croner job; a subsequent
   * {@link schedule} call with the same `taskId` is fine and registers
   * a fresh job.
   */
  cancel(taskId: string): boolean {
    const entry = this.jobs.get(taskId);
    if (!entry) {
      return false;
    }
    entry.cron.stop();
    this.jobs.delete(taskId);
    return true;
  }

  /**
   * Double-fire safety: called from `SessionManager.handleTaskNotification`
   * BEFORE the cohort-A `wake_started` emission so if the harness ever
   * fires for a task we shadowed, the shadow is silently cancelled and
   * the harness path emits the single bracket. Silent no-op for unknown
   * task ids — Cohort-A wakes that we never shadowed (Monitor, Bash
   * runbg, Task runbg) are the common case. See [D05].
   */
  cancelOnHarnessNotification(taskId: string): void {
    const entry = this.jobs.get(taskId);
    if (!entry) {
      return;
    }
    entry.cron.stop();
    this.jobs.delete(taskId);
    console.log(
      `[tide::wake-scheduler] cancelled-on-harness task_id=${taskId}`,
    );
  }

  /**
   * Stop every pending job and clear the map. Idempotent. Called from
   * `SessionManager.dispose()` / `shutdown()` so a session teardown
   * leaves no croner timers running.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of this.jobs.values()) {
      entry.cron.stop();
    }
    this.jobs.size > 0 &&
      console.log(
        `[tide::wake-scheduler] disposed jobs_stopped=${this.jobs.size}`,
      );
    this.jobs.clear();
  }

  /**
   * Test/introspection hook — the Date at which croner will next fire
   * the registered job, or `null` when no such job exists (or the
   * cron has no further runs scheduled).
   */
  nextRunAt(taskId: string): Date | null {
    const entry = this.jobs.get(taskId);
    if (!entry) {
      return null;
    }
    return entry.cron.nextRun();
  }

  /**
   * Test/introspection hook — whether a job is currently registered and
   * not stopped.
   */
  isScheduled(taskId: string): boolean {
    const entry = this.jobs.get(taskId);
    if (!entry) {
      return false;
    }
    return !entry.cron.isStopped();
  }

  /**
   * Fire callback registered with croner. On fire:
   *
   *   1. Emit a `wake_started` IPC frame to tugdeck — the same bracket
   *      shape `SessionManager.handleTaskNotification` produces for a
   *      Cohort A harness wake. `wake_trigger.task_id` and
   *      `wake_trigger.tool_use_id` both carry the original
   *      `tool_use_id` (we registered under it); `status` is
   *      `"completed"` because the timer fired successfully; `summary`
   *      forwards the user-supplied `reason` so Slice 2 chrome can show
   *      what triggered the wake.
   *   2. Write a stream-json `user` message line to claude's stdin
   *      carrying the registered prompt. Shape matches what
   *      `SessionManager.handleUserMessage` would write for a real user
   *      submission — claude treats it as if the user just submitted
   *      and runs a fresh turn.
   *   3. For one-shot jobs (`kind:"delay"` and `kind:"cron"` with
   *      `recurring:false`) remove the entry from the map. Croner has
   *      already stopped the underlying job via `maxRuns:1`; this just
   *      releases the bookkeeping. Recurring crons stay in the map and
   *      croner re-fires on each subsequent match.
   *
   * Both side-effect calls are wrapped in try/catch so a downstream
   * throw (a write error after claude's stdin closes, etc.) doesn't
   * unschedule sibling jobs. The catch logs at info level so an
   * operator can tell why a wake failed to surface.
   */
  private handleFire(taskId: string): void {
    const entry = this.jobs.get(taskId);
    if (!entry) {
      return;
    }

    const frame: WakeStarted = {
      type: "wake_started",
      session_id: this.sessionId,
      wake_trigger: {
        task_id: taskId,
        tool_use_id: taskId,
        status: "completed",
        summary: entry.reason ?? "scheduled wake",
        output_file: "",
      },
      ipc_version: 2,
    };

    try {
      this.emitFrame(frame);
    } catch (err) {
      console.log(
        `[tide::wake-scheduler] emitFrame threw task_id=${taskId} ` +
          `err=${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const userMessage = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: entry.prompt }],
      },
    });

    try {
      this.writeStdin(userMessage);
    } catch (err) {
      console.log(
        `[tide::wake-scheduler] writeStdin threw task_id=${taskId} ` +
          `err=${err instanceof Error ? err.message : String(err)}`,
      );
    }

    console.log(
      `[tide::wake-scheduler] fired kind=${entry.kind} task_id=${taskId} ` +
        `recurring=${entry.recurring}`,
    );

    const isOneShot = entry.kind === "delay" || !entry.recurring;
    if (isOneShot) {
      this.jobs.delete(taskId);
    }
  }
}
