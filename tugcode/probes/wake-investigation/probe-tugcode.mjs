#!/usr/bin/env bun
// Probe tugcode end-to-end: spawn the actual tugcode binary, send a
// ScheduleWakeup user_message via stdin, and watch tugcode's stdout
// for the wake_started IPC frame.
//
// This validates the FULL chain claude -> tugcode -> tugdeck wire,
// not just the raw claude wire (which `probe-harness.mjs` covers).
//
// Usage: bun probe-tugcode.mjs [hold_sec]

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const HOLD_SEC = Number(process.argv[2] ?? 130);
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const BASE = `capture-tugcode-${TIMESTAMP}`;

const SESSION_ID = crypto.randomUUID();
const PROJECT_DIR = "/private/tmp/wake-investigation";
const TUGCODE_BIN = "/Users/kocienda/Mounts/u/src/tugtool/tugrust/target/debug/tugcode";

console.error(`[probe] tugcode binary: ${TUGCODE_BIN}`);
console.error(`[probe] session=${SESSION_ID} hold=${HOLD_SEC}s`);

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.CLAUDE_CODE_OAUTH_TOKEN;

const proc = spawn(
  TUGCODE_BIN,
  [
    "--dir", PROJECT_DIR,
    "--session-id", SESSION_ID,
    "--session-mode", "new",
  ],
  { cwd: PROJECT_DIR, env, stdio: ["pipe", "pipe", "pipe"] },
);

const stdoutLines = [];
const stderrLines = [];
proc.stdout.on("data", (chunk) => {
  const t = new Date().toISOString();
  for (const line of chunk.toString().split("\n")) {
    if (line.length > 0) stdoutLines.push(`${t}\t${line}`);
  }
});
proc.stderr.on("data", (chunk) => {
  const t = new Date().toISOString();
  for (const line of chunk.toString().split("\n")) {
    if (line.length > 0) stderrLines.push(`${t}\t${line}`);
  }
});

let exited = false;
proc.on("exit", (code, signal) => {
  exited = true;
  console.error(`[probe] tugcode exited code=${code} signal=${signal}`);
});

const outDir = "/Users/kocienda/Mounts/u/src/tugtool/tugcode/probes/wake-investigation";
const flush = () => {
  writeFileSync(`${outDir}/${BASE}.stdout`, stdoutLines.join("\n") + "\n");
  writeFileSync(`${outDir}/${BASE}.stderr`, stderrLines.join("\n") + "\n");
};
setInterval(flush, 10_000);
process.on("SIGINT", () => { flush(); try { proc.kill("SIGTERM"); } catch {} process.exit(0); });

// Wait for tugcode to spin up, then send protocol_init + user_message.
await new Promise((r) => setTimeout(r, 1500));

proc.stdin.write(JSON.stringify({ type: "protocol_init", version: 1 }) + "\n");

await new Promise((r) => setTimeout(r, 500));

const userMsg = {
  type: "user_message",
  text: "Use ScheduleWakeup to wake yourself in 60 seconds with reason 'PROBE_SW_1'. When the wake fires, reply with exactly the literal text \"SW fired\" and nothing else.",
  attachments: [],
};
proc.stdin.write(JSON.stringify(userMsg) + "\n");
console.error("[probe] sent user_message");

const start = Date.now();
const tick = setInterval(() => {
  const elapsed = Math.floor((Date.now() - start) / 1000);
  console.error(`[probe] elapsed=${elapsed}s stdout=${stdoutLines.length} stderr=${stderrLines.length}`);
}, 20_000);

await new Promise((r) => setTimeout(r, HOLD_SEC * 1000));
clearInterval(tick);

if (!exited) {
  console.error("[probe] holding done — killing tugcode");
  proc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 2000));
  if (!exited) proc.kill("SIGKILL");
}

flush();
console.error(`[probe] done -> ${BASE}.stdout / .stderr`);
