/**
 * Scheduled-work derivation — narrowing for the `ScheduleWakeup` /
 * `CronCreate` / `CronDelete` *tool calls* and the pure helpers that
 * fold them into the background-jobs ledger as `"scheduled"` rows
 * (`select-jobs.ts`, the Z2 `JOBS` cell).
 *
 * These tools are harness-owned: claude's built-in scheduler fires a
 * `ScheduleWakeup` / `CronCreate` timer between turns by re-emitting
 * `system/init`, and that fired wake carries **no `task_id`** to
 * correlate it back to the scheduling call. So a scheduled row is born
 * from the *tool call* (captured at `handleToolResult`, like the
 * background-job launch echo) and reconciled by **time**: a one-shot
 * wakeup carries a `firesAtMs` target; the id-less wake flips the
 * earliest elapsed scheduled row ({@link flipEarliestElapsedScheduled});
 * and a never-fired row is eventually reaped
 * ({@link reapElapsedScheduled}).
 *
 * Wire shapes are pinned by the captured tool-call fixtures at
 * `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`
 * `v2.1.150-spike/` — `ScheduleWakeup` input `{delaySeconds, reason,
 * prompt}` with a plain-string result (no id), and `CronCreate` input
 * `{cron, prompt, recurring}` whose result echoes the cron id
 * (`"Scheduled one-shot task <id> (<cron>). …"`).
 *
 * @module lib/code-session-store/select-scheduled-work
 */

import type { JobItem } from "./select-jobs";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * A wakeup that flips more than this past its `firesAtMs` target reads
 * "fired late" — derived at render from `endedAtMs - firesAtMs`, never
 * stored. Sized above ordinary harness jitter so an on-time fire never
 * trips the badge.
 */
export const STALE_THRESHOLD_MS = 120_000;

/**
 * A scheduled row whose `firesAtMs` is more than this past `now` with
 * no fire is reaped to `stopped` ("never fired"), bounding accumulation
 * and reclaiming a mis-targeted row. Comfortably larger than
 * {@link STALE_THRESHOLD_MS} so the "fired late" window always has room
 * before a never-fired row is given up — matched to the harness's
 * worst-case recurring jitter.
 */
export const REAP_GRACE_MS = 1_800_000;

// ---------------------------------------------------------------------------
// Tool-input narrowing (pure)
// ---------------------------------------------------------------------------

/** Narrowed `tool_use.input` for a `ScheduleWakeup` call. */
export interface ScheduleWakeupInput {
  delaySeconds: number;
  reason?: string;
  prompt?: string;
}

/** Narrowed `tool_use.input` for a `CronCreate` call. */
export interface CronCreateInput {
  cron: string;
  prompt?: string;
  recurring?: boolean;
}

/** Narrowed `tool_use.input` for a `CronDelete` call. */
export interface CronDeleteInput {
  cronId: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Narrow a `ScheduleWakeup` call's `tool_use.input`. Defensive:
 * returns `undefined` when `delaySeconds` is not a finite number, so a
 * drifted shape is dropped rather than scheduling a row at a garbage
 * time.
 */
export function narrowScheduleWakeupInput(
  value: unknown,
): ScheduleWakeupInput | undefined {
  const v = asRecord(value);
  if (v === undefined) return undefined;
  if (typeof v.delaySeconds !== "number" || !Number.isFinite(v.delaySeconds)) {
    return undefined;
  }
  return {
    delaySeconds: v.delaySeconds,
    reason: optString(v.reason),
    prompt: optString(v.prompt),
  };
}

/**
 * Narrow a `CronCreate` call's `tool_use.input`. Defensive: requires a
 * non-empty `cron` expression.
 */
export function narrowCronCreateInput(
  value: unknown,
): CronCreateInput | undefined {
  const v = asRecord(value);
  if (v === undefined) return undefined;
  if (typeof v.cron !== "string" || v.cron.length === 0) return undefined;
  return {
    cron: v.cron,
    prompt: optString(v.prompt),
    ...(typeof v.recurring === "boolean" ? { recurring: v.recurring } : {}),
  };
}

/**
 * Narrow a `CronDelete` call's `tool_use.input`. The exact field name
 * is unpinned (no captured fixture), so accept the plausible spellings
 * for the cron id and take the first that is a non-empty string.
 */
export function narrowCronDeleteInput(
  value: unknown,
): CronDeleteInput | undefined {
  const v = asRecord(value);
  if (v === undefined) return undefined;
  const cronId =
    optString(v.cronId) ??
    optString(v.cron_id) ??
    optString(v.id) ??
    optString(v.taskId) ??
    optString(v.task_id);
  if (cronId === undefined || cronId.length === 0) return undefined;
  return { cronId };
}

/**
 * Extract the cron id from a `CronCreate` `tool_result` echo. The
 * harness phrasing is fixed: `"Scheduled one-shot task <id> (<cron>).
 * …"` / `"Scheduled recurring task <id> (<cron>). …"`. Returns
 * `undefined` when the pattern doesn't match — the caller then falls
 * back to the call's `tool_use_id` so the row still appears (CronDelete
 * matching then degrades to the soft-message-by-expression path).
 */
export function parseCronCreateResultId(result: unknown): string | undefined {
  const text = typeof result === "string" ? result : undefined;
  if (text === undefined) return undefined;
  const match = /Scheduled (?:one-shot|recurring) task (\S+)/.exec(text);
  return match === null ? undefined : match[1];
}

/**
 * Narrowed `tool_use.input` for a `RemoteTrigger` call — the claude.ai
 * remote-routine API. Mirrors the block wrapper's `{ action, trigger_id,
 * body }` shape locally so the store layer never imports a component.
 */
export interface RemoteTriggerToolInput {
  action?: string;
  triggerId?: string;
  body?: Record<string, unknown>;
}

/**
 * Narrow a `RemoteTrigger` call's `tool_use.input`. Defensive: returns
 * `undefined` only for a non-object; a missing/mistyped `action` is left
 * `undefined` (the reducer then treats it as a no-op action).
 */
export function narrowRemoteTriggerToolInput(
  value: unknown,
): RemoteTriggerToolInput | undefined {
  const v = asRecord(value);
  if (v === undefined) return undefined;
  const bodyRaw = v.body;
  const body =
    bodyRaw !== null && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : undefined;
  return {
    action: optString(v.action),
    triggerId: optString(v.trigger_id),
    body,
  };
}

/**
 * Extract the routine id from a `RemoteTrigger` `create`/`update`
 * result. The result is API JSON, optionally followed by an appended
 * summary line — so try whole-string JSON first, then fall back to a
 * field scan that tolerates the trailing summary. `undefined` when no
 * id surfaces (the caller falls back to the call's `trigger_id` /
 * `tool_use_id`). See [Q01] — field names are unpinned.
 */
export function parseRemoteTriggerCreateId(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  try {
    const rec = asRecord(JSON.parse(result));
    const id =
      rec === undefined
        ? undefined
        : optString(rec.id) ?? optString(rec.trigger_id);
    if (id !== undefined && id.length > 0) return id;
  } catch {
    // Not clean JSON (a trailing summary line) — fall through to the scan.
  }
  const match = /"(?:id|trigger_id)"\s*:\s*"([^"]+)"/.exec(result);
  return match === null ? undefined : match[1];
}

// ---------------------------------------------------------------------------
// Row construction (pure)
// ---------------------------------------------------------------------------

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const v of values) {
    if (v !== undefined && v.length > 0) return v;
  }
  return "";
}

/**
 * Build a `"scheduled"` wakeup row from a `ScheduleWakeup` call. The
 * row is keyed by its own `tool_use_id` (the result carries no id), and
 * `firesAtMs` is stamped from the completion clock plus the requested
 * delay. `reason` is the human label; the verbose `prompt` is the
 * fallback.
 */
export function scheduledRowFromWakeup(
  toolUseId: string,
  input: ScheduleWakeupInput,
  nowMs: number,
): JobItem {
  return {
    jobId: toolUseId,
    source: "claude",
    kind: "wakeup",
    toolUseId,
    description: firstNonEmpty(input.reason, input.prompt, "Scheduled wakeup"),
    status: "scheduled",
    startedAtMs: nowMs,
    endedAtMs: null,
    firesAtMs: nowMs + input.delaySeconds * 1_000,
  };
}

/**
 * Build a `"scheduled"` cron row from a `CronCreate` call. The `jobId`
 * is the cron id parsed from the result echo (so a later `CronDelete`
 * can match it), falling back to the `tool_use_id` when the echo
 * carries no id. `firesAtMs` is `null` — the next-occurrence countdown
 * for recurring crons is deferred; the row reads by its
 * `scheduleLabel` (the cron expression).
 */
export function scheduledRowFromCron(
  toolUseId: string,
  input: CronCreateInput,
  result: unknown,
  nowMs: number,
): JobItem {
  return {
    jobId: parseCronCreateResultId(result) ?? toolUseId,
    source: "claude",
    kind: "cron",
    toolUseId,
    description: firstNonEmpty(input.prompt, input.cron),
    status: "scheduled",
    startedAtMs: nowMs,
    endedAtMs: null,
    firesAtMs: null,
    scheduleLabel: input.cron,
  };
}

function remoteBodyString(
  input: RemoteTriggerToolInput,
  key: string,
): string | undefined {
  return input.body === undefined ? undefined : optString(input.body[key]);
}

/**
 * Derive a routine's display labels from its `body` — the schedule
 * string (`schedule`/`cron`/`when`) and the human description
 * (`prompt`/`name`). Each is omitted when the body carries nothing for
 * it, so an `update` fold re-labels only what actually changed rather
 * than clobbering with a default.
 */
export function remoteTriggerLabels(input: RemoteTriggerToolInput): {
  description?: string;
  scheduleLabel?: string;
} {
  const scheduleLabel = firstNonEmpty(
    remoteBodyString(input, "schedule"),
    remoteBodyString(input, "cron"),
    remoteBodyString(input, "when"),
  );
  const description = firstNonEmpty(
    remoteBodyString(input, "prompt"),
    remoteBodyString(input, "name"),
  );
  return {
    ...(scheduleLabel.length > 0 ? { scheduleLabel } : {}),
    ...(description.length > 0 ? { description } : {}),
  };
}

/**
 * Build a `"remote"` scheduled row from a `RemoteTrigger` `create`
 * call. Keyed by the routine id (parsed from the result echo, else the
 * call's `trigger_id`, else its `tool_use_id`). `firesAtMs` is `null`
 * — a claude.ai routine fires externally and is unobservable locally,
 * so it reads by its `scheduleLabel` (the routine's schedule) and is
 * never time-reaped or flipped by a local wake ([P06]).
 */
export function scheduledRowFromRemoteTrigger(
  toolUseId: string,
  input: RemoteTriggerToolInput,
  result: unknown,
  nowMs: number,
): JobItem {
  const labels = remoteTriggerLabels(input);
  const scheduleLabel =
    firstNonEmpty(labels.scheduleLabel, input.triggerId) || "claude.ai routine";
  return {
    jobId:
      parseRemoteTriggerCreateId(result) ?? input.triggerId ?? toolUseId,
    source: "claude",
    kind: "remote",
    toolUseId,
    description: firstNonEmpty(labels.description, scheduleLabel),
    status: "scheduled",
    startedAtMs: nowMs,
    endedAtMs: null,
    firesAtMs: null,
    scheduleLabel,
  };
}

// ---------------------------------------------------------------------------
// Time-driven reconciliation (pure)
// ---------------------------------------------------------------------------

/**
 * Flip the earliest elapsed scheduled row to `completed` — the id-less
 * wake fold. A fired `ScheduleWakeup`/`CronCreate` wake carries no
 * `task_id`, so the earliest scheduled row whose `firesAtMs <= now`
 * (one-shot wakeup) is taken; failing that, the earliest scheduled cron
 * (which has no `firesAtMs`). Returns the input array unchanged (same
 * reference) when nothing flips, so a no-op composes cleanly with the
 * reducer's reference-stability checks.
 */
export function flipEarliestElapsedScheduled(
  jobs: readonly JobItem[],
  nowMs: number,
  endedAtMs: number,
): readonly JobItem[] {
  let target = -1;
  let targetFiresAt = Infinity;
  let cronFallback = -1;
  for (let i = 0; i < jobs.length; i += 1) {
    const j = jobs[i];
    if (j.status !== "scheduled") continue;
    // A remote (claude.ai) routine fires externally; a local id-less
    // wake must never complete it ([P06]).
    if (j.kind === "remote") continue;
    if (typeof j.firesAtMs === "number") {
      if (j.firesAtMs <= nowMs && j.firesAtMs < targetFiresAt) {
        target = i;
        targetFiresAt = j.firesAtMs;
      }
    } else if (cronFallback === -1) {
      cronFallback = i;
    }
  }
  const idx = target !== -1 ? target : cronFallback;
  if (idx === -1) return jobs;
  const next = jobs.slice();
  next[idx] = { ...jobs[idx], status: "completed", endedAtMs };
  return next;
}

/**
 * Fold scheduled rows whose `firesAtMs` is more than
 * {@link REAP_GRACE_MS} past `now` (and never fired) to `stopped` —
 * the GC for a mis-targeted or never-arriving wake, so a stale
 * scheduled row cannot linger un-clearable. Cron rows (no `firesAtMs`)
 * are never reaped by time. Reference-stable when nothing changes.
 */
export function reapElapsedScheduled(
  jobs: readonly JobItem[],
  nowMs: number,
): readonly JobItem[] {
  const isStale = (j: JobItem): boolean =>
    j.status === "scheduled" &&
    typeof j.firesAtMs === "number" &&
    nowMs - j.firesAtMs > REAP_GRACE_MS;
  if (!jobs.some(isStale)) return jobs;
  return jobs.map((j) =>
    isStale(j) ? { ...j, status: "stopped", endedAtMs: nowMs } : j,
  );
}

/**
 * Stop a `"scheduled"` row by id — the `CronDelete` fold. Distinct
 * from `applyJobFlip` (which guards on `"running"` for the
 * first-terminal-flip-wins background-job semantics): a cron row is
 * `"scheduled"`, so it needs its own gate. Unknown ids and
 * already-terminal rows are no-ops; reference-stable when nothing
 * changes.
 */
export function stopScheduledRow(
  jobs: readonly JobItem[],
  jobId: string,
  endedAtMs: number,
): readonly JobItem[] {
  const idx = jobs.findIndex((j) => j.jobId === jobId);
  if (idx === -1 || jobs[idx].status !== "scheduled") return jobs;
  const next = jobs.slice();
  next[idx] = { ...jobs[idx], status: "stopped", endedAtMs };
  return next;
}

/**
 * Re-label an existing scheduled row by id — the `RemoteTrigger`
 * `update` fold. Updates `description` / `scheduleLabel` in place when
 * either is provided and non-empty; no-op for an unknown id, a
 * non-scheduled row, or when nothing changes. Reference-stable when
 * nothing changes.
 */
export function relabelScheduledRow(
  jobs: readonly JobItem[],
  jobId: string,
  description?: string,
  scheduleLabel?: string,
): readonly JobItem[] {
  const idx = jobs.findIndex((j) => j.jobId === jobId);
  if (idx === -1 || jobs[idx].status !== "scheduled") return jobs;
  const existing = jobs[idx];
  const next: JobItem = {
    ...existing,
    ...(description !== undefined && description.length > 0
      ? { description }
      : {}),
    ...(scheduleLabel !== undefined && scheduleLabel.length > 0
      ? { scheduleLabel }
      : {}),
  };
  if (
    next.description === existing.description &&
    next.scheduleLabel === existing.scheduleLabel
  ) {
    return jobs;
  }
  const out = jobs.slice();
  out[idx] = next;
  return out;
}

/**
 * Did a fired wakeup land late? Derived at render from the row's own
 * timestamps — `true` when the row completed more than
 * {@link STALE_THRESHOLD_MS} past its target. No stored late flag; a
 * row with no `firesAtMs` (cron) or no `endedAtMs` (still scheduled) is
 * never "late".
 */
export function isWakeLate(
  firesAtMs: number | null | undefined,
  endedAtMs: number | null,
): boolean {
  if (typeof firesAtMs !== "number" || endedAtMs === null) return false;
  return endedAtMs - firesAtMs > STALE_THRESHOLD_MS;
}
