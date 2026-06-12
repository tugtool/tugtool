#!/usr/bin/env node
// Probe: background-job lifecycle frames on the current claude.
//
// Spawns claude exactly as tugcode does (stream-json in + out) and walks
// six phases, capturing every raw stdout line:
//
//   P1  bg Bash, clean completion, idle wait
//       (task_started → turn result → task_notification → wake turn)
//   P2  bg Bash that exits non-zero (failure-side terminal frames)
//   P3  bg Bash stopped via a control_request {subtype:"stop_task"}
//       — the tugcode/tugdeck stop path; answers whether a confirmation
//       frame fires for it
//   P4  bg Bash stopped via the TaskStop *tool* (claude-initiated stop)
//   P5  FOREGROUND Agent — does task_started fire for a non-background
//       subagent, and what field discriminates?
//   P6  bg Agent (launch echo + lifecycle frames for the agent kind)
//
// Usage: bun probe-jobs-lifecycle.mjs [output.jsonl]
// Raw capture is written to the output path on completion (and on
// SIGINT), one stdout line per line, unmodified.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outPath = process.argv[2] || "/tmp/jobs-probe/raw.jsonl";
const cwd = "/tmp/jobs-probe-cwd";
mkdirSync(cwd, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });

const args = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--replay-user-messages",
  "--permission-mode", "bypassPermissions",
];

const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "inherit"], cwd });

const lines = [];
const parsed = [];
let waiters = [];

function onEvent(ev) {
  parsed.push(ev);
  waiters = waiters.filter((w) => {
    if (w.pred(ev)) {
      clearTimeout(w.timer);
      w.resolve(ev);
      return false;
    }
    return true;
  });
}

let buf = "";
proc.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.trim().length === 0) continue;
    lines.push(line);
    try {
      const ev = JSON.parse(line);
      const tag = ev.subtype ? `${ev.type}/${ev.subtype}` : ev.type;
      const extra = ev.task_id ? ` task_id=${ev.task_id}` : "";
      console.error(`[probe<] ${tag}${extra}`);
      onEvent(ev);
    } catch {
      console.error(`[probe<] (unparsed) ${line.slice(0, 80)}`);
    }
  }
});

/**
 * Resolve with the first event matching `pred` at or after `fromIdx`
 * (scanning history first, then waiting), or null on timeout.
 */
function expect(pred, ms, label, fromIdx) {
  for (let i = fromIdx; i < parsed.length; i++) {
    if (pred(parsed[i])) return Promise.resolve(parsed[i]);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`[probe] TIMEOUT waiting for ${label}`);
      waiters = waiters.filter((w) => w.timer !== timer);
      resolve(null);
    }, ms);
    waiters.push({ pred, resolve, timer });
  });
}

function send(text) {
  console.error(`[probe>] user: ${text.slice(0, 70)}…`);
  proc.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n",
  );
}

let reqN = 0;
function sendStopTask(taskId) {
  console.error(`[probe>] control_request stop_task task_id=${taskId}`);
  proc.stdin.write(
    JSON.stringify({
      type: "control_request",
      request_id: `probe_req_${++reqN}`,
      request: { subtype: "stop_task", task_id: taskId },
    }) + "\n",
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isResult = (ev) => ev.type === "result";
const isTaskStarted = (ev) => ev.type === "system" && ev.subtype === "task_started";
const isTaskNotification = (ev) =>
  ev.type === "system" && ev.subtype === "task_notification";

function finish(code) {
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.error(`[probe] wrote ${lines.length} lines to ${outPath}`);
  try {
    proc.kill("SIGTERM");
  } catch {}
  process.exit(code);
}
process.on("SIGINT", () => finish(130));

const NO_POLL =
  "After the tool returns, end your turn immediately with the single word: launched. " +
  "Do not poll, do not read the output file, do not call any other tools.";

async function main() {
  let mark = 0;
  await expect((ev) => ev.type === "system" && ev.subtype === "init", 30000, "init", mark);

  // P1 — clean bg Bash + idle wait → notification + wake.
  console.error("[probe] === P1 bg bash clean completion ===");
  mark = parsed.length;
  send(
    "Use the Bash tool exactly once with run_in_background set to true and the command " +
      "`sleep 6 && echo JOBS_P1_OK`. " + NO_POLL,
  );
  await expect(isTaskStarted, 90000, "P1 task_started", mark);
  await expect(isResult, 90000, "P1 turn result", mark);
  const p1NotifyIdx = parsed.length;
  await expect(isTaskNotification, 40000, "P1 task_notification", p1NotifyIdx);
  await expect(isResult, 90000, "P1 wake result", p1NotifyIdx);
  await sleep(2000);

  // P2 — failing bg Bash.
  console.error("[probe] === P2 bg bash failure ===");
  mark = parsed.length;
  send(
    "Use the Bash tool exactly once with run_in_background set to true and the command " +
      "`sleep 3; ls /nonexistent_jobs_probe_dir_xyz; exit 7`. " + NO_POLL,
  );
  await expect(isTaskStarted, 90000, "P2 task_started", mark);
  await expect(isResult, 90000, "P2 turn result", mark);
  const p2NotifyIdx = parsed.length;
  await expect(isTaskNotification, 40000, "P2 task_notification", p2NotifyIdx);
  await expect(isResult, 90000, "P2 wake result", p2NotifyIdx);
  await sleep(2000);

  // P3 — long bg Bash, stopped via control_request stop_task.
  console.error("[probe] === P3 control-request stop_task ===");
  mark = parsed.length;
  send(
    "Use the Bash tool exactly once with run_in_background set to true and the command " +
      "`sleep 90 && echo JOBS_P3_NEVER`. " + NO_POLL,
  );
  const p3Started = await expect(isTaskStarted, 90000, "P3 task_started", mark);
  await expect(isResult, 90000, "P3 turn result", mark);
  await sleep(1500);
  if (p3Started) {
    sendStopTask(p3Started.task_id);
    // Collect whatever fires: control_response / task_updated / notification.
    await sleep(15000);
  }

  // P4 — long bg Bash, stopped via the TaskStop tool.
  console.error("[probe] === P4 TaskStop tool ===");
  mark = parsed.length;
  send(
    "Use the Bash tool exactly once with run_in_background set to true and the command " +
      "`sleep 90 && echo JOBS_P4_NEVER`. " + NO_POLL,
  );
  const p4Started = await expect(isTaskStarted, 90000, "P4 task_started", mark);
  await expect(isResult, 90000, "P4 turn result", mark);
  await sleep(1000);
  send(
    `Use the TaskStop tool exactly once to stop the background task with task_id ` +
      `${p4Started ? p4Started.task_id : "unknown"}. ` +
      "Then end your turn with the single word: stopped.",
  );
  await expect(isResult, 90000, "P4 stop-turn result", parsed.length);
  await sleep(8000);

  // P5 — FOREGROUND Agent: does task_started fire at all?
  console.error("[probe] === P5 foreground Agent ===");
  mark = parsed.length;
  send(
    'Use the Agent tool exactly once with subagent_type "general-purpose" and the prompt ' +
      '"Reply with exactly: JOBS_P5_FG and nothing else. Use no tools." ' +
      "Do NOT set run_in_background. After it returns, end your turn with the single word: done.",
  );
  await expect(isResult, 180000, "P5 result", mark);
  await sleep(2000);

  // P6 — background Agent.
  console.error("[probe] === P6 background Agent ===");
  mark = parsed.length;
  send(
    'Use the Agent tool exactly once with subagent_type "general-purpose", run_in_background ' +
      'set to true, and the prompt "Run the bash command `sleep 5 && echo JOBS_P6_BG` exactly ' +
      'once, then reply with its stdout and nothing else." ' + NO_POLL,
  );
  await expect(isTaskStarted, 90000, "P6 task_started", mark);
  await expect(isResult, 120000, "P6 turn result", mark);
  const p6NotifyIdx = parsed.length;
  await expect(isTaskNotification, 90000, "P6 task_notification", p6NotifyIdx);
  await expect(isResult, 120000, "P6 wake result", p6NotifyIdx);
  await sleep(2000);

  console.error("[probe] all phases complete");
  proc.stdin.end();
  await sleep(3000);
  finish(0);
}

main().catch((err) => {
  console.error("[probe] fatal:", err);
  finish(1);
});
