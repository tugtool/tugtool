/**
 * Background-jobs ledger — wire narrowing for the `task_started` /
 * `task_updated` IPC frames and the pure helpers behind the Z2 `JOBS`
 * cell.
 *
 * **Terminology guard.** Two unrelated "task" vocabularies cross this
 * store. The `TaskCreate` / `TaskUpdate` *tool calls* are the todo
 * list behind the TASKS cell ([D100], `select-task-list.ts`). The
 * `system/task_started` / `system/task_updated` *frames* handled here
 * are the background-job lifecycle (`Bash` / `Agent` with
 * `run_in_background: true`) behind the JOBS cell. Deck-side names use
 * the job vocabulary throughout; only wire-frame spellings keep
 * claude's `task_*` prefix.
 *
 * Wire shapes are pinned by the captured fixtures at
 * `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`
 * `v2.1.173-jobs-spike/` — notably: `task_started` fires for
 * foreground subagents too, with no backgrounded discriminant on the
 * frame, so consumers gate on the launching tool call via `toolUseId`
 * ({@link isJobLaunch}: backgrounded, or a `Monitor` watcher). A
 * monitor's only `task_notification` is terminal (mid-life events
 * wake claude via task-id-less re-inits), and its terminal statuses
 * agree with `task_updated`.
 *
 * @module lib/code-session-store/select-jobs
 */

import type { TaskStartedEvent, TaskUpdatedEvent } from "./events";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/**
 * Lifecycle of one background job. Wire mapping: `task_updated`'s
 * `"killed"` and `task_notification`'s `"stopped"` both read
 * {@link JobStatus} `"stopped"`; `"completed"` / `"failed"` map
 * directly.
 */
export type JobStatus = "running" | "completed" | "failed" | "stopped";

/** Statuses that mean the job is no longer running. */
export function isTerminalJobStatus(status: JobStatus): boolean {
  return status !== "running";
}

/**
 * One background job in the session-lifetime ledger. `jobId` is
 * claude's `task_id` (`backgroundTaskId` / `agentId` in the launch
 * echoes). `source` is a forward-compat discriminant — only
 * `"claude"` ships; the shape stays open for a possible tugexec
 * future without consumers ever switching on it.
 */
export interface JobItem {
  jobId: string;
  source: "claude";
  kind: "bash" | "agent" | "monitor" | "unknown";
  toolUseId: string;
  description: string;
  outputFile?: string;
  status: JobStatus;
  startedAtMs: number;
  endedAtMs: number | null;
}

const EMPTY_JOBS: readonly JobItem[] = Object.freeze([]);

/**
 * Reference-stable empty ledger — the reducer's initial value and the
 * result of clearing every row, so "no jobs" consumers can compare
 * with `Object.is`.
 */
export const EMPTY_JOBS_LEDGER: readonly JobItem[] = EMPTY_JOBS;

// ---------------------------------------------------------------------------
// Wire narrowing (pure)
// ---------------------------------------------------------------------------

/**
 * Narrow a decoded `task_started` CODE_OUTPUT frame into the camelCase
 * {@link TaskStartedEvent}. Defensive: returns `undefined` when the
 * required `task_id` / `tool_use_id` strings are missing, so a drifted
 * frame is dropped rather than dispatched malformed.
 */
export function narrowTaskStartedFrame(
  frame: Record<string, unknown>,
): TaskStartedEvent | undefined {
  if (frame.type !== "task_started") return undefined;
  const taskId = frame.task_id;
  const toolUseId = frame.tool_use_id;
  if (typeof taskId !== "string" || taskId.length === 0) return undefined;
  if (typeof toolUseId !== "string" || toolUseId.length === 0) return undefined;
  const subagentType = frame.subagent_type;
  return {
    type: "task_started",
    taskId,
    toolUseId,
    description: typeof frame.description === "string" ? frame.description : "",
    taskType: typeof frame.task_type === "string" ? frame.task_type : "",
    ...(typeof subagentType === "string" ? { subagentType } : {}),
    ...(typeof frame.tug_session_id === "string"
      ? { tug_session_id: frame.tug_session_id }
      : {}),
  };
}

/**
 * Narrow a decoded `task_updated` CODE_OUTPUT frame into the camelCase
 * {@link TaskUpdatedEvent}. tugcode has already flattened claude's
 * `patch` object onto the frame (`status` / `end_time`). Defensive on
 * the required `task_id` / `status` strings.
 */
export function narrowTaskUpdatedFrame(
  frame: Record<string, unknown>,
): TaskUpdatedEvent | undefined {
  if (frame.type !== "task_updated") return undefined;
  const taskId = frame.task_id;
  const status = frame.status;
  if (typeof taskId !== "string" || taskId.length === 0) return undefined;
  if (typeof status !== "string" || status.length === 0) return undefined;
  return {
    type: "task_updated",
    taskId,
    status,
    ...(typeof frame.end_time === "number" ? { endTime: frame.end_time } : {}),
    ...(typeof frame.tug_session_id === "string"
      ? { tug_session_id: frame.tug_session_id }
      : {}),
  };
}

/**
 * Map a wire status string (`task_updated.status` /
 * `wake_started.wake_trigger.status`) onto a terminal {@link JobStatus}.
 * Returns `undefined` for unknown vocabulary — an unrecognized status
 * is dropped rather than guessed, so future non-terminal additions
 * can't wrongly finish a running row (Risk R01's defensive posture).
 */
export function terminalJobStatusFromWire(
  status: string,
): Exclude<JobStatus, "running"> | undefined {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "killed":
    case "stopped":
      return "stopped";
    default:
      return undefined;
  }
}

/** Map a `task_started.task_type` onto the job's kind. */
export function jobKindFromTaskType(taskType: string): JobItem["kind"] {
  if (taskType === "local_bash") return "bash";
  if (taskType === "local_agent") return "agent";
  return "unknown";
}

/**
 * The ledger's insert gate, shared by the `task_started` and
 * launch-echo insert paths: a tool call launches a trackable job when
 * it is explicitly backgrounded OR it is a `Monitor` — a watcher is
 * background activity by nature (no flag involved). The gate is
 * meaning-based ("is this background work?") rather than
 * mechanism-based ("is the flag set?"); foreground subagents and
 * async-subagent-internal tasks still fail it, the former by the flag,
 * the latter because their launching calls never appear in the deck's
 * stream.
 */
export function isJobLaunch(
  toolName: string,
  input: Record<string, unknown> | null,
): boolean {
  return input?.run_in_background === true || toolName === "Monitor";
}

/**
 * Kind for a launch, from the launching tool's name first. The frame's
 * `task_type` cannot discriminate monitors — a watcher's script reports
 * `"local_bash"` (captured in `test-monitor-lifecycle-raw.jsonl`) — so
 * the tool name is the only honest source; `task_type` remains the
 * fallback for bash/agent.
 */
export function jobKindForLaunch(
  toolName: string,
  taskType: string,
): JobItem["kind"] {
  if (toolName === "Monitor") return "monitor";
  return jobKindFromTaskType(taskType);
}

// ---------------------------------------------------------------------------
// Launch-echo parsing (pure)
// ---------------------------------------------------------------------------

/** Parsed identity of a background launch from its `tool_result`. */
export interface BackgroundLaunchEcho {
  jobId: string;
  kind: JobItem["kind"];
  outputFile?: string;
}

/**
 * Extract the job identity from a background launch's `tool_result`
 * payload. Two echo families exist (v2.1.173-jobs-spike capture):
 *
 *  - Bash: a plain string — `"Command running in background with ID:
 *    <id>. Output is being written to: <path>. …"`.
 *  - Agent: an array of text blocks whose first lines read `"Async
 *    agent launched successfully.\nagentId: <id> (…)"` with a later
 *    `"output_file: <path>"` line.
 *  - Monitor: `"Monitor started (task <id>, timeout <n>ms)."` or
 *    `"Monitor started (task <id>, persistent — runs until TaskStop or
 *    session end)."` — no output file.
 *
 * Returns `undefined` when neither pattern matches — callers fall
 * back to the `task_started` insert path, so a drifted echo degrades
 * to "job appears when its frame lands" rather than breaking.
 */
export function parseBackgroundLaunchResult(
  result: unknown,
): BackgroundLaunchEcho | undefined {
  const text = launchEchoText(result);
  if (text === undefined) return undefined;
  // `(\S+?)\.(?=\s|$)` — the value runs to the sentence's final period
  // (lookahead, not consumed-first-dot), so a path like
  // `…/tasks/<id>.output.` keeps its `.output` extension.
  const bash = /Command running in background with ID: (\S+?)\.(?=\s|$)(?:\s+Output is being written to: (\S+?)\.(?=\s|$))?/.exec(
    text,
  );
  if (bash !== null) {
    return {
      jobId: bash[1],
      kind: "bash",
      ...(bash[2] !== undefined ? { outputFile: bash[2] } : {}),
    };
  }
  const monitor = /Monitor started \(task (\S+?)[,)]/.exec(text);
  if (monitor !== null) {
    return { jobId: monitor[1], kind: "monitor" };
  }
  const agent = /agentId: (\S+) /.exec(text);
  if (agent !== null && text.includes("Async agent launched successfully")) {
    const outFile = /output_file: (\S+)/.exec(text);
    return {
      jobId: agent[1],
      kind: "agent",
      ...(outFile !== null ? { outputFile: outFile[1] } : {}),
    };
  }
  return undefined;
}

/** Collapse a `tool_result` content payload to searchable text. */
function launchEchoText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    const parts: string[] = [];
    for (const block of result) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        parts.push((block as Record<string, unknown>).text as string);
      }
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Ledger updates (pure)
// ---------------------------------------------------------------------------

/**
 * Insert-or-enrich a job keyed by `jobId`. A fresh id appends a
 * `running` row (insertion order is display order). An existing id
 * keeps its row — only absent `description` / `outputFile` fields are
 * filled in — so the `task_started` and launch-echo insert paths
 * compose idempotently in either arrival order.
 */
export function insertJob(
  jobs: readonly JobItem[],
  item: JobItem,
): readonly JobItem[] {
  const idx = jobs.findIndex((j) => j.jobId === item.jobId);
  if (idx === -1) return [...jobs, item];
  const existing = jobs[idx];
  const enriched: JobItem = {
    ...existing,
    description:
      existing.description.length > 0 ? existing.description : item.description,
    ...(existing.outputFile === undefined && item.outputFile !== undefined
      ? { outputFile: item.outputFile }
      : {}),
    ...(existing.kind === "unknown" && item.kind !== "unknown"
      ? { kind: item.kind }
      : {}),
  };
  if (
    enriched.description === existing.description &&
    enriched.outputFile === existing.outputFile &&
    enriched.kind === existing.kind
  ) {
    return jobs;
  }
  const next = jobs.slice();
  next[idx] = enriched;
  return next;
}

/**
 * Flip one `running` row to a terminal status. Unknown ids and
 * already-terminal rows are left untouched (first terminal flip wins
 * — the wire can deliver the same outcome via `task_updated`, the
 * wake trigger, and a `TaskStop` fold, in any order). Returns the
 * input array unchanged (same reference) when nothing flips.
 */
export function applyJobFlip(
  jobs: readonly JobItem[],
  jobId: string,
  status: Exclude<JobStatus, "running">,
  endedAtMs: number,
): readonly JobItem[] {
  const idx = jobs.findIndex((j) => j.jobId === jobId);
  if (idx === -1) return jobs;
  if (jobs[idx].status !== "running") return jobs;
  const next = jobs.slice();
  next[idx] = { ...jobs[idx], status, endedAtMs };
  return next;
}

/**
 * Flip every `running` row to `stopped` — the stale-marking rule for
 * a fresh `session_init`: a respawned claude cannot have carried
 * background tasks across, so rows still `running` are dead.
 */
export function markRunningJobsStopped(
  jobs: readonly JobItem[],
  endedAtMs: number,
): readonly JobItem[] {
  if (!jobs.some((j) => j.status === "running")) return jobs;
  return jobs.map((j) =>
    j.status === "running" ? { ...j, status: "stopped", endedAtMs } : j,
  );
}

/**
 * Drop terminal rows; `running` rows always survive (clearing a
 * running job would orphan it from the UI with no way to stop it).
 * An emptied ledger returns the shared frozen empty array.
 */
export function clearTerminalJobs(
  jobs: readonly JobItem[],
): readonly JobItem[] {
  const kept = jobs.filter((j) => j.status === "running");
  if (kept.length === jobs.length) return jobs;
  return kept.length === 0 ? EMPTY_JOBS : kept;
}

// ---------------------------------------------------------------------------
// Display derivation (pure)
// ---------------------------------------------------------------------------

/** Per-status counts plus the `finished/total` cell reading. */
export interface JobCounts {
  total: number;
  /** ALL running rows, watchers included (`watching` is a subset). */
  running: number;
  /** Running rows of kind `"monitor"` — live watchers. */
  watching: number;
  completed: number;
  failed: number;
  stopped: number;
  /** Terminal rows — the cell's numerator. */
  finished: number;
}

export function countJobs(jobs: readonly JobItem[]): JobCounts {
  let running = 0;
  let watching = 0;
  let completed = 0;
  let failed = 0;
  let stopped = 0;
  for (const j of jobs) {
    if (j.status === "running") {
      running += 1;
      if (j.kind === "monitor") watching += 1;
    } else if (j.status === "completed") completed += 1;
    else if (j.status === "failed") failed += 1;
    else stopped += 1;
  }
  return {
    total: jobs.length,
    running,
    watching,
    completed,
    failed,
    stopped,
    finished: completed + failed + stopped,
  };
}

/**
 * The JOBS cell's indicator pose. A pure function of the ledger only
 * — deliberately NO session-phase input: a background job genuinely
 * runs between turns, so an idle session must not demote a running
 * dot (the one semantic divergence from the TASKS cell).
 *
 *  - empty ledger      → `stopped` (quiet placeholder)
 *  - any running       → `running`
 *  - else any failed   → `aborted` (danger; holds until cleared or
 *                        superseded by a new job)
 *  - else              → `completed`
 */
export function jobsCellPose(
  jobs: readonly JobItem[],
): "stopped" | "running" | "completed" | "aborted" {
  if (jobs.length === 0) return "stopped";
  let anyFailed = false;
  for (const j of jobs) {
    if (j.status === "running") return "running";
    if (j.status === "failed") anyFailed = true;
  }
  return anyFailed ? "aborted" : "completed";
}

/**
 * Footer summary with zero-bucket drop — `"1 running, 1 watching,
 * 2 done, 1 failed"` (completed reads "done", stopped reads
 * "stopped"). Live watchers are split out of the running bucket as
 * "watching" so finite work and monitors read distinctly; the cell's
 * `finished/total` and pose treat them identically. An empty ledger
 * reads `"no jobs"`.
 */
export function composeJobsSummary(counts: JobCounts): string {
  const parts: string[] = [];
  const runningJobs = counts.running - counts.watching;
  if (runningJobs > 0) parts.push(`${runningJobs} running`);
  if (counts.watching > 0) parts.push(`${counts.watching} watching`);
  if (counts.completed > 0) parts.push(`${counts.completed} done`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.stopped > 0) parts.push(`${counts.stopped} stopped`);
  return parts.length > 0 ? parts.join(", ") : "no jobs";
}
