#!/usr/bin/env bun
// /loop + resume probe: four phases over raw stream-json on the current CLI,
// driven with tugcode's buildClaudeArgs vector (see probe-goal.mjs).
//
//   A. loop-self      — self-paced `/loop <prompt>`: which tool paces it
//                       (ScheduleWakeup expected), and how a wake fire
//                       appears on the wire.
//   B. loop-interval  — `/loop 1m <prompt>`: CronCreate expected.
//   C. resume-sw      — the [Q02] retest: schedule a ScheduleWakeup, kill
//                       before it fires, respawn with --resume, does the
//                       harness scheduler ever fire it? (2026-05-25 on
//                       2.1.150: metadata restored, fire never happened.)
//   D. resume-goal    — set a long-running goal, kill mid-run, respawn
//                       with --resume: does the Stop-hook evaluator re-arm?
//
// Output: capture-loop-<phase>-<timestamp>.{stdout,stderr} + one meta.json.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PROJECT_DIR = "/private/tmp/goal-probe";
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = new URL(".", import.meta.url).pathname;

mkdirSync(PROJECT_DIR, { recursive: true });

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.CLAUDE_CODE_OAUTH_TOKEN;

const baseArgs = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--replay-user-messages",
  "--permission-mode", "bypassPermissions",
];

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function runPhase({ phase, args, sends, holdSec }) {
  const base = `capture-loop-${phase}-${TS}`;
  const stdoutLines = [];
  const stderrLines = [];
  console.error(`[${phase}] spawning: claude ${args.join(" ")}`);
  const proc = spawn("claude", args, {
    cwd: PROJECT_DIR,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stdout.on("data", (c) => {
    const t = new Date().toISOString();
    for (const l of c.toString().split("\n")) if (l) stdoutLines.push(`${t}\t${l}`);
  });
  proc.stderr.on("data", (c) => {
    const t = new Date().toISOString();
    for (const l of c.toString().split("\n")) if (l) stderrLines.push(`${t}\t${l}`);
  });
  let exited = false;
  proc.on("exit", (code, signal) => {
    exited = true;
    console.error(`[${phase}] claude exited code=${code} signal=${signal}`);
  });

  await sleep(3);
  for (const { text, waitSec } of sends) {
    proc.stdin.write(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text }] },
      }) + "\n",
    );
    console.error(`[${phase}] sent: ${text.slice(0, 70)}`);
    await sleep(waitSec);
  }
  if (holdSec) {
    const tick = setInterval(
      () => console.error(`[${phase}] holding… stdout=${stdoutLines.length}`),
      30_000,
    );
    await sleep(holdSec);
    clearInterval(tick);
  }
  if (!exited) {
    proc.kill("SIGTERM");
    await sleep(3);
    if (!exited) proc.kill("SIGKILL");
  }
  writeFileSync(join(OUT_DIR, `${base}.stdout`), stdoutLines.join("\n") + "\n");
  writeFileSync(join(OUT_DIR, `${base}.stderr`), stderrLines.join("\n") + "\n");
  console.error(`[${phase}] wrote ${base}.{stdout,stderr} (${stdoutLines.length} lines)`);
  return { base, stdoutLines };
}

const count = (lines, s) => lines.filter((l) => l.includes(s)).length;

// --- Phase A: self-paced loop -------------------------------------------
const S1 = crypto.randomUUID();
const A = await runPhase({
  phase: "self",
  args: [...baseArgs, "--session-id", S1],
  sends: [
    {
      text: "/loop append one line to TICKS.txt (echo tick >> TICKS.txt), then stop after the file has 2 lines",
      waitSec: 30,
    },
  ],
  holdSec: 160,
});

// --- Phase B: interval loop ---------------------------------------------
const S2 = crypto.randomUUID();
const B = await runPhase({
  phase: "interval",
  args: [...baseArgs, "--session-id", S2],
  sends: [
    {
      text: "/loop 1m append one line to TICKS2.txt (echo tick >> TICKS2.txt), then stop after the file has 2 lines",
      waitSec: 30,
    },
  ],
  holdSec: 160,
});

// --- Phase C: resume-sw ([Q02] retest) ----------------------------------
const S3 = crypto.randomUUID();
const C1 = await runPhase({
  phase: "resume-sw-phase1",
  args: [...baseArgs, "--session-id", S3],
  sends: [
    {
      text: "Use ScheduleWakeup with delaySeconds:60, reason:'PROBE_RESUME', and a prompt asking you to reply with exactly 'RESUMED_SW fired' and nothing else.",
      waitSec: 20,
    },
  ],
  holdSec: 0, // kill before the 60s wake fires
});
await sleep(2);
const C2 = await runPhase({
  phase: "resume-sw-phase2",
  args: [...baseArgs, "--resume", S3],
  sends: [{ text: "Just resuming. What's pending?", waitSec: 10 }],
  holdSec: 150,
});

// --- Phase D: resume-goal ------------------------------------------------
const S4 = crypto.randomUUID();
const D1 = await runPhase({
  phase: "resume-goal-phase1",
  args: [...baseArgs, "--session-id", S4],
  sends: [
    {
      text: "/goal TURNSR.txt contains at least 30 lines, appending exactly one line per assistant turn",
      waitSec: 25,
    },
  ],
  holdSec: 0, // kill mid-run
});
await sleep(2);
const D2 = await runPhase({
  phase: "resume-goal-phase2",
  args: [...baseArgs, "--resume", S4],
  sends: [{ text: "Just resuming. What's pending?", waitSec: 10 }],
  holdSec: 75,
});

// --- Verdicts -------------------------------------------------------------
const meta = {
  cli: "2.1.204",
  sessions: { self: S1, interval: S2, resumeSw: S3, resumeGoal: S4 },
  self: {
    capture: A.base,
    scheduleWakeupCalls: count(A.stdoutLines, '"name":"ScheduleWakeup"'),
    cronCreateCalls: count(A.stdoutLines, '"name":"CronCreate"'),
    taskNotifications: count(A.stdoutLines, "task_notification"),
    systemInit: count(A.stdoutLines, '"subtype":"init"'),
    results: count(A.stdoutLines, '"type":"result"'),
  },
  interval: {
    capture: B.base,
    scheduleWakeupCalls: count(B.stdoutLines, '"name":"ScheduleWakeup"'),
    cronCreateCalls: count(B.stdoutLines, '"name":"CronCreate"'),
    taskNotifications: count(B.stdoutLines, "task_notification"),
    systemInit: count(B.stdoutLines, '"subtype":"init"'),
    results: count(B.stdoutLines, '"type":"result"'),
  },
  resumeSw: {
    phase1: C1.base,
    phase2: C2.base,
    phase1ScheduleWakeup: count(C1.stdoutLines, '"name":"ScheduleWakeup"'),
    phase2TaskNotifications: count(C2.stdoutLines, "task_notification"),
    phase2SystemInit: count(C2.stdoutLines, '"subtype":"init"'),
    phase2ResumedMarker: count(C2.stdoutLines, "RESUMED_SW"),
    verdict:
      count(C2.stdoutLines, "RESUMED_SW") > 0 ||
      count(C2.stdoutLines, "task_notification") > 0
        ? "PASS: scheduled wake fired after --resume"
        : "FAIL: no wake fire observed after --resume",
  },
  resumeGoal: {
    phase1: D1.base,
    phase2: D2.base,
    phase1StopHookFeedback: count(D1.stdoutLines, "Stop hook feedback"),
    phase2StopHookFeedback: count(D2.stdoutLines, "Stop hook feedback"),
    verdict:
      count(D2.stdoutLines, "Stop hook feedback") > 0
        ? "PASS: evaluator re-armed after --resume"
        : "FAIL: no evaluator feedback after --resume",
  },
};
writeFileSync(
  join(OUT_DIR, `capture-loop-meta-${TS}.json`),
  JSON.stringify(meta, null, 2),
);
console.error(JSON.stringify(meta, null, 2));
