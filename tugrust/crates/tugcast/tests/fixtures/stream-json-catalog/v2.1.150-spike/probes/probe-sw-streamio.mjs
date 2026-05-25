#!/usr/bin/env node
// Probe: spawn claude exactly as tugcode does (stream-json in + out)
// and observe what fires when ScheduleWakeup's timer elapses.
//
// If the harness re-invoke works in stream-json mode, we'll see either:
//   - a synthetic user-message on stdout, or
//   - a system event we haven't seen yet, or
//   - nothing (the wake is silently lost in this mode).

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--replay-user-messages",
  "--permission-mode", "bypassPermissions",
];

const proc = spawn("claude", args, {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: "/tmp/tide-cohort-sweep",
});

const captureLines = [];
let buf = "";
proc.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.trim().length > 0) {
      captureLines.push(line);
      // Print compact summary for live-watching.
      try {
        const ev = JSON.parse(line);
        const tag = ev.subtype ? `${ev.type}/${ev.subtype}` : ev.type;
        const extra =
          ev.task_id ? ` task_id=${ev.task_id}` :
          ev.message?.content ? ` content=${typeof ev.message.content === "string" ? ev.message.content.slice(0, 60) : "<array>"}` :
          "";
        console.error(`[stream-json] ${tag}${extra}`);
      } catch {
        console.error(`[stream-json] (unparsed) ${line.slice(0, 80)}`);
      }
    }
  }
});

proc.on("exit", (code) => {
  writeFileSync(
    "/tmp/tide-cohort-sweep/capture-sw-streamio.jsonl",
    captureLines.join("\n") + "\n",
  );
  console.error(`[probe] claude exited code=${code} lines=${captureLines.length}`);
  process.exit(code ?? 0);
});

// Send the ScheduleWakeup prompt as a stream-json user_message frame.
// Same shape tugcode writes via writeLine().
const prompt = {
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "text",
        text: "Use ScheduleWakeup to wake yourself in 60 seconds with reason 'PROBE_SW'. When the wake fires, immediately reply with the literal text 'PROBE_SW fired'.",
      },
    ],
  },
};
proc.stdin.write(JSON.stringify(prompt) + "\n");

// Don't close stdin — that would make claude treat input as EOF and exit.
// Hold the subprocess open for 90 seconds (well past the 60s wake) and
// then kill it. The harness re-invoke (if it happens) should land
// within that window.
setTimeout(() => {
  console.error("[probe] 90s elapsed — killing claude subprocess");
  proc.kill("SIGTERM");
}, 90_000);
