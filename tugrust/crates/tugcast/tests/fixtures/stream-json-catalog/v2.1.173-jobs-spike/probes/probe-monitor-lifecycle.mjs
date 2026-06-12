#!/usr/bin/env node
// Probe: Monitor lifecycle frames on the current claude — the watcher
// companion to probe-jobs-lifecycle.mjs (same driver pattern).
//
// Phases:
//   M1  monitor whose script emits TWO events then exits naturally —
//       pins the per-event notification shape (does an event flip
//       anything while the watcher still runs?) and the natural-exit
//       terminal status
//   M2  short-timeout monitor (script outlives timeout_ms) — pins the
//       timeout terminal status
//   M3  persistent monitor stopped via a control_request
//       {subtype:"stop_task"} — pins the kill confirmation for the
//       tugcode/tugdeck stop path on a watcher
//
// Usage: bun probe-monitor-lifecycle.mjs [output.jsonl]

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outPath = process.argv[2] || "/tmp/monitor-probe/raw.jsonl";
const cwd = "/tmp/monitor-probe-cwd";
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
const isTaskUpdated = (ev) => ev.type === "system" && ev.subtype === "task_updated";
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

const ARM_ONLY =
  "After the Monitor tool returns, end your turn immediately with the single word: " +
  "armed. Do not poll, do not call any other tools. When a monitor event wakes you " +
  "later, reply with the single word: noted, and nothing else — no tools.";

async function main() {
  let mark = 0;
  await expect((ev) => ev.type === "system" && ev.subtype === "init", 30000, "init", mark);

  // M1 — two events, then natural exit.
  console.error("[probe] === M1 two events then natural exit ===");
  mark = parsed.length;
  send(
    "Use the Monitor tool exactly once with command " +
      "`echo MON_EVT_1; sleep 8; echo MON_EVT_2; sleep 5`, description " +
      '"Two-event natural-exit probe", timeout_ms 60000, persistent false. ' +
      ARM_ONLY,
  );
  await expect(isTaskStarted, 90000, "M1 task_started", mark);
  await expect(isResult, 90000, "M1 arm-turn result", mark);
  // Event 1 → notification → wake turn.
  let cursor = parsed.length;
  await expect(isTaskNotification, 40000, "M1 event-1 notification", cursor);
  await expect(isResult, 90000, "M1 event-1 wake result", cursor);
  // Event 2.
  cursor = parsed.length;
  await expect(isTaskNotification, 40000, "M1 event-2 notification", cursor);
  await expect(isResult, 90000, "M1 event-2 wake result", cursor);
  // Natural exit → terminal frames (+ possible final notification/wake).
  cursor = parsed.length;
  await expect(isTaskUpdated, 40000, "M1 terminal task_updated", cursor);
  await sleep(8000);

  // M2 — timeout kill.
  console.error("[probe] === M2 timeout ===");
  mark = parsed.length;
  send(
    "Use the Monitor tool exactly once with command `sleep 120`, description " +
      '"Timeout probe", timeout_ms 6000, persistent false. ' + ARM_ONLY,
  );
  await expect(isTaskStarted, 90000, "M2 task_started", mark);
  await expect(isResult, 90000, "M2 arm-turn result", mark);
  cursor = parsed.length;
  await expect(isTaskUpdated, 30000, "M2 timeout task_updated", cursor);
  await sleep(8000);

  // M3 — persistent watcher, control-request stop.
  console.error("[probe] === M3 persistent + stop_task ===");
  mark = parsed.length;
  send(
    "Use the Monitor tool exactly once with command " +
      "`while true; do sleep 10; done`, description " +
      '"Persistent watcher probe", timeout_ms 60000, persistent true. ' + ARM_ONLY,
  );
  const m3Started = await expect(isTaskStarted, 90000, "M3 task_started", mark);
  await expect(isResult, 90000, "M3 arm-turn result", mark);
  await sleep(1500);
  if (m3Started) {
    sendStopTask(m3Started.task_id);
    cursor = parsed.length;
    await expect(isTaskUpdated, 20000, "M3 kill task_updated", cursor);
    await sleep(8000);
  }

  console.error("[probe] all phases complete");
  proc.stdin.end();
  await sleep(3000);
  finish(0);
}

main().catch((err) => {
  console.error("[probe] fatal:", err);
  finish(1);
});
