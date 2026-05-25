#!/usr/bin/env bun
// Definitive probe: does the harness fire ScheduleWakeup / CronCreate timers
// in stream-json mode, and what does it emit on claude's stdout?
//
// Spawns claude with the EXACT same args tugcode uses (see buildClaudeArgs
// in tugcode/src/session.ts), sends a single user_message, then holds the
// subprocess for HOLD_SEC seconds and captures every byte of stdout+stderr.
//
// Usage:
//   bun probe-harness.mjs <kind> [hold_sec]
//
// Where <kind> is one of:
//   sw-60      ScheduleWakeup with delaySeconds:60
//   cron-1m    CronCreate one-shot at ~1 minute from now
//   cron-recur CronCreate recurring '* * * * *' (every minute)
//
// Output: writes capture-<kind>-<timestamp>.{stdout,stderr,jsonl,meta}.
//
// What we're looking for in stdout:
//   - Does claude emit `system/task_notification` for ScheduleWakeup/Cron fires?
//     (Step-6 said no; this probe re-verifies with a longer hold)
//   - Does claude emit a stream-json `user` event echoing the synthetic
//     queue-operation enqueue?
//   - Are there other event types we missed (queue_operation, tick,
//     idle_notification)?
//
// The JSONL is read AFTER the probe to compare what claude persisted
// (its full internal view) against what it emitted on stdout (tugcode's view).
// Any divergence is what tugcode is missing.

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECT_DIR = "/private/tmp/wake-investigation";
const PLUGIN_DIR = "/Users/kocienda/Mounts/u/src/tugtool/tugplug";
const KIND = process.argv[2];
const HOLD_SEC = Number(process.argv[3] ?? 240);

if (!KIND) {
  console.error("usage: probe-harness.mjs <sw-60|cron-1m|cron-recur> [hold_sec]");
  process.exit(2);
}

const PROMPTS = {
  "sw-60":
    "Use ScheduleWakeup with delaySeconds:60 and reason:'PROBE_SW'. The wake's prompt should ask you to reply with exactly 'PROBE_SW fired' and nothing else.",
  "cron-1m":
    "Use CronCreate with recurring:false to schedule a one-shot job for about 90 seconds from now (use a cron expression that matches the next minute boundary after that). The prompt should ask you to reply with exactly 'PROBE_CRON1 fired' and nothing else.",
  "cron-recur":
    "Use CronCreate with cron '* * * * *' and recurring:true. The prompt should ask you to reply with exactly 'PROBE_CRONR fired' and nothing else.",
};
const prompt = PROMPTS[KIND];
if (!prompt) {
  console.error(`unknown kind: ${KIND}`);
  process.exit(2);
}

// Pick a session id so we can find the JSONL after.
const SESSION_ID = crypto.randomUUID();
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const BASE = `capture-${KIND}-${TIMESTAMP}`;

// Match tugcode's buildClaudeArgs() EXACTLY (see tugcode/src/session.ts:402).
const args = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--permission-prompt-tool", "stdio",
  "--include-partial-messages",
  "--replay-user-messages",
  "--plugin-dir", PLUGIN_DIR,
  "--permission-mode", "bypassPermissions",
  "--append-system-prompt", "test",
  "--session-id", SESSION_ID,
];

console.error(`[probe] kind=${KIND} session=${SESSION_ID} hold=${HOLD_SEC}s`);
console.error(`[probe] spawning: claude ${args.join(" ")}`);

// Scrub auth env so claude uses ~/.claude.json subscription auth.
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.CLAUDE_CODE_OAUTH_TOKEN;

const proc = spawn("claude", args, {
  cwd: PROJECT_DIR,
  env,
  stdio: ["pipe", "pipe", "pipe"],
});

// Buffer all stdout + stderr.
const stdoutChunks = [];
const stderrChunks = [];
const stdoutWithTimestamps = [];
const stderrWithTimestamps = [];

proc.stdout.on("data", (chunk) => {
  const t = new Date().toISOString();
  stdoutChunks.push(chunk);
  const lines = chunk.toString().split("\n");
  for (const line of lines) {
    if (line.length > 0) stdoutWithTimestamps.push(`${t}\t${line}`);
  }
});
proc.stderr.on("data", (chunk) => {
  const t = new Date().toISOString();
  stderrChunks.push(chunk);
  const lines = chunk.toString().split("\n");
  for (const line of lines) {
    if (line.length > 0) stderrWithTimestamps.push(`${t}\t${line}`);
  }
});

let exited = false;
proc.on("exit", (code, signal) => {
  exited = true;
  console.error(`[probe] claude exited code=${code} signal=${signal}`);
});

// Periodic incremental flush so an early SIGINT preserves captures.
const outDirEarly = "/Users/kocienda/Mounts/u/src/tugtool/tugcode/probes/wake-investigation";
const flushNow = () => {
  writeFileSync(`${outDirEarly}/${BASE}.stdout`, stdoutWithTimestamps.join("\n") + "\n");
  writeFileSync(`${outDirEarly}/${BASE}.stderr`, stderrWithTimestamps.join("\n") + "\n");
};
const flushTick = setInterval(flushNow, 10_000);
process.on("SIGINT", () => {
  console.error("[probe] SIGINT — flushing and exiting");
  flushNow();
  clearInterval(flushTick);
  try { proc.kill("SIGTERM"); } catch {}
  process.exit(0);
});

// Wait a bit for claude to start, then write the user_message.
await new Promise((r) => setTimeout(r, 500));
const userMsg = {
  type: "user",
  message: { role: "user", content: [{ type: "text", text: prompt }] },
};
proc.stdin.write(JSON.stringify(userMsg) + "\n");
console.error(`[probe] sent prompt: ${prompt.slice(0, 80)}...`);

// Hold the subprocess for HOLD_SEC.
const startMs = Date.now();
const tick = setInterval(() => {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  console.error(`[probe] elapsed=${elapsed}s stdout=${stdoutWithTimestamps.length} lines`);
}, 30_000);

await new Promise((r) => setTimeout(r, HOLD_SEC * 1000));
clearInterval(tick);

// Kill the subprocess.
if (!exited) {
  console.error("[probe] HOLD elapsed — killing claude");
  proc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 2000));
  if (!exited) proc.kill("SIGKILL");
}

// Write captures.
const outDir = "/Users/kocienda/Mounts/u/src/tugtool/tugcode/probes/wake-investigation";
writeFileSync(`${outDir}/${BASE}.stdout`, stdoutWithTimestamps.join("\n") + "\n");
writeFileSync(`${outDir}/${BASE}.stderr`, stderrWithTimestamps.join("\n") + "\n");

// Find and copy claude's persisted JSONL.
const projectsRoot = join(
  homedir(),
  ".claude",
  "projects",
  "-private-tmp-wake-investigation",
);
const jsonlPath = join(projectsRoot, `${SESSION_ID}.jsonl`);
if (existsSync(jsonlPath)) {
  const jsonl = readFileSync(jsonlPath, "utf8");
  writeFileSync(`${outDir}/${BASE}.jsonl`, jsonl);
  console.error(`[probe] copied claude JSONL ${jsonlPath} -> ${BASE}.jsonl`);
} else {
  console.error(`[probe] NO JSONL at ${jsonlPath}`);
}

writeFileSync(
  `${outDir}/${BASE}.meta`,
  JSON.stringify(
    {
      kind: KIND,
      sessionId: SESSION_ID,
      heldSec: HOLD_SEC,
      prompt,
      args,
      stdoutLines: stdoutWithTimestamps.length,
      stderrLines: stderrWithTimestamps.length,
    },
    null,
    2,
  ),
);

console.error(`[probe] done: ${BASE}.{stdout,stderr,jsonl,meta}`);
