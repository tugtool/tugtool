/**
 * Wire-shape drift test for the Cohort B re-init pattern (plan
 * [D05]).
 *
 * The detector at `handleClaudeLine` assumes a specific sequence of
 * stream-json events bracket a harness-fired wake (ScheduleWakeup,
 * CronCreate). This test pins the sequence against captured stdout
 * fixtures so a future Claude Code release that alters the wire
 * surfaces a loud test failure instead of silently breaking Cohort B
 * in production.
 *
 * Captures committed under
 * `tugcode/probes/wake-investigation/capture-{sw-60,cron-1m}-*.stdout`,
 * reproducible via `probe-harness.mjs`.
 *
 * The invariants we pin:
 *   1. Exactly ONE `system/init` at session spawn (before any user
 *      input — the FIRST init for the subprocess).
 *   2. The first turn closes with a `result/success` event.
 *   3. Between that `result/success` and the wake's stream events, a
 *      SECOND `system/init` arrives — the wake bracket signal.
 *   4. NO `system/task_notification` precedes the wake (it would
 *      route through the Cohort A path, not Cohort B).
 *   5. The wake's turn produces its own `result/success` to close
 *      the bracket.
 *
 * A future capture that breaks (1)-(5) means the harness's wire
 * shape changed; the detector heuristic at `handleClaudeLine` needs
 * to be revisited before the new fixtures are accepted.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface StdoutEvent {
  type: string;
  subtype?: string;
  event?: Record<string, unknown>;
}

interface ParsedLine {
  timestamp: string;
  event: StdoutEvent;
}

function loadCapture(prefix: string): ParsedLine[] {
  const dir = new URL(
    "../../probes/wake-investigation/",
    import.meta.url,
  ).pathname;
  const files = readdirSync(dir).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".stdout"),
  );
  if (files.length === 0) {
    throw new Error(`no capture file under ${dir} for prefix ${prefix}`);
  }
  // Pick the lexicographically last one (newest timestamp slug).
  files.sort();
  const path = join(dir, files[files.length - 1]);
  const raw = readFileSync(path, "utf8");
  const parsed: ParsedLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.length) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const ts = line.slice(0, tab);
    const json = line.slice(tab + 1);
    try {
      const event = JSON.parse(json) as StdoutEvent;
      parsed.push({ timestamp: ts, event });
    } catch {
      // Non-JSON line in capture — skip (stderr-style noise occasionally interleaves).
    }
  }
  return parsed;
}

function isSystemInit(p: ParsedLine): boolean {
  return p.event.type === "system" && p.event.subtype === "init";
}

function isResultSuccess(p: ParsedLine): boolean {
  return p.event.type === "result" && p.event.subtype === "success";
}

function isStreamMessageStart(p: ParsedLine): boolean {
  return (
    p.event.type === "stream_event" &&
    (p.event.event as { type?: string })?.type === "message_start"
  );
}

function isTaskNotification(p: ParsedLine): boolean {
  return p.event.type === "system" && p.event.subtype === "task_notification";
}

describe("Cohort B re-init wire-shape drift — ScheduleWakeup capture", () => {
  const lines = loadCapture("capture-sw-60-");

  test("invariant 1: there are exactly TWO system/init events — spawn + wake fire", () => {
    const inits = lines.filter(isSystemInit);
    expect(inits).toHaveLength(2);
  });

  test("invariant 2: the first turn closes with a result/success before the wake fires", () => {
    const inits = lines.filter(isSystemInit);
    const firstInitIdx = lines.indexOf(inits[0]);
    const secondInitIdx = lines.indexOf(inits[1]);
    const between = lines.slice(firstInitIdx + 1, secondInitIdx);
    const firstResult = between.find(isResultSuccess);
    expect(firstResult).toBeDefined();
  });

  test("invariant 3: the second system/init is followed by the wake's message_start (the wake bracket signal)", () => {
    const inits = lines.filter(isSystemInit);
    const secondInitIdx = lines.indexOf(inits[1]);
    const after = lines.slice(secondInitIdx + 1);
    const nextMessageStart = after.find(isStreamMessageStart);
    expect(nextMessageStart).toBeDefined();
  });

  test("invariant 4: no system/task_notification precedes the wake (rules out Cohort A misclassification)", () => {
    const inits = lines.filter(isSystemInit);
    const secondInitIdx = lines.indexOf(inits[1]);
    const before = lines.slice(0, secondInitIdx);
    const stray = before.find(isTaskNotification);
    expect(stray).toBeUndefined();
  });

  test("invariant 5: the wake turn closes with its own result/success", () => {
    const inits = lines.filter(isSystemInit);
    const secondInitIdx = lines.indexOf(inits[1]);
    const after = lines.slice(secondInitIdx + 1);
    const wakeResult = after.find(isResultSuccess);
    expect(wakeResult).toBeDefined();
  });
});

describe("Cohort B re-init wire-shape drift — CronCreate one-shot capture", () => {
  const lines = loadCapture("capture-cron-1m-");

  test("invariant 1: there are exactly TWO system/init events — spawn + wake fire", () => {
    const inits = lines.filter(isSystemInit);
    expect(inits).toHaveLength(2);
  });

  test("invariant 2: the first turn closes with a result/success before the wake fires", () => {
    const inits = lines.filter(isSystemInit);
    const firstInitIdx = lines.indexOf(inits[0]);
    const secondInitIdx = lines.indexOf(inits[1]);
    const between = lines.slice(firstInitIdx + 1, secondInitIdx);
    const firstResult = between.find(isResultSuccess);
    expect(firstResult).toBeDefined();
  });

  test("invariant 3: the second system/init is followed by the wake's message_start", () => {
    const inits = lines.filter(isSystemInit);
    const secondInitIdx = lines.indexOf(inits[1]);
    const after = lines.slice(secondInitIdx + 1);
    const nextMessageStart = after.find(isStreamMessageStart);
    expect(nextMessageStart).toBeDefined();
  });

  test("invariant 4: no system/task_notification precedes the wake", () => {
    const inits = lines.filter(isSystemInit);
    const secondInitIdx = lines.indexOf(inits[1]);
    const before = lines.slice(0, secondInitIdx);
    const stray = before.find(isTaskNotification);
    expect(stray).toBeUndefined();
  });

  test("invariant 5: the wake turn closes with its own result/success", () => {
    const inits = lines.filter(isSystemInit);
    const secondInitIdx = lines.indexOf(inits[1]);
    const after = lines.slice(secondInitIdx + 1);
    const wakeResult = after.find(isResultSuccess);
    expect(wakeResult).toBeDefined();
  });
});
