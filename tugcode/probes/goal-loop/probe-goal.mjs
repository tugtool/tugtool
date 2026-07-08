#!/usr/bin/env bun
// /goal lifecycle probe: drive claude directly over stream-json with the
// same argument vector tugcode's buildClaudeArgs produces, and capture the
// raw wire for a full goal lifecycle:
//
//   1. set a goal engineered to need >= 2 turns (the evaluator must force
//      at least one continuation turn),
//   2. `/goal` bare (status) after achievement,
//   3. set a second long-running goal, then `/goal clear` while active.
//
// What this answers (plan [Q01], roadmap/slash-command-plan.md):
//   - How does an evaluator-forced continuation turn begin on the wire —
//     a re-init (`system/init`), a bare new message cycle with no `user`
//     event, or something else?
//   - Where does the evaluator's reason appear?
//   - What do `/goal` status and `/goal clear` emit?
//
// Output: capture-goal-<timestamp>.{stdout,stderr,meta.json} in this dir.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECT_DIR = "/private/tmp/goal-probe";
const SESSION_ID = crypto.randomUUID();
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = new URL(".", import.meta.url).pathname;

mkdirSync(PROJECT_DIR, { recursive: true });

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.CLAUDE_CODE_OAUTH_TOKEN;

// Mirror tugcode's buildClaudeArgs vector (tugcode/src/session.ts), minus
// --permission-prompt-tool stdio (no one is answering control requests
// here) and minus --plugin-dir (irrelevant to the goal machinery).
const args = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--replay-user-messages",
  "--permission-mode", "bypassPermissions",
  "--session-id", SESSION_ID,
];

console.error(`[probe] session=${SESSION_ID}`);
console.error(`[probe] spawning: claude ${args.join(" ")}`);

const stdoutLines = [];
const stderrLines = [];
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
  console.error(`[probe] claude exited code=${code} signal=${signal}`);
});

function sendUser(text) {
  proc.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n",
  );
  console.error(`[probe] sent: ${text.slice(0, 80)}`);
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// Give claude time to boot.
await sleep(3);

// Phase A: a goal that cannot be met in one turn — the evaluator judges
// from the conversation, and "two separate assistant turns" is false
// until a continuation turn has actually run.
sendUser(
  "/goal the file TURNS.txt in the current directory contains at least 2 lines, " +
    "AND you have appended exactly one line per assistant turn since this goal was set " +
    "(echo turn-N >> TURNS.txt) — never two lines in the same turn. Prove with cat TURNS.txt.",
);
await sleep(100);

// Phase B: bare status after achievement.
sendUser("/goal");
await sleep(20);

// Phase C: a long-running goal, cleared while active.
sendUser(
  "/goal TURNS2.txt contains at least 9 lines, appending exactly one line per assistant turn",
);
await sleep(35);
sendUser("/goal clear");
await sleep(20);

if (!exited) {
  console.error("[probe] closing stdin");
  proc.stdin.end();
  await sleep(8);
}
if (!exited) {
  console.error("[probe] killing claude");
  proc.kill("SIGTERM");
  await sleep(3);
  if (!exited) proc.kill("SIGKILL");
}

const base = `capture-goal-${TS}`;
writeFileSync(join(OUT_DIR, `${base}.stdout`), stdoutLines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, `${base}.stderr`), stderrLines.join("\n") + "\n");

// Summarize the shapes that matter for [Q01].
const count = (pred) => stdoutLines.filter(pred).length;
const meta = {
  sessionId: SESSION_ID,
  capture: base,
  stdoutLines: stdoutLines.length,
  systemInit: count((l) => l.includes('"type":"system"') && l.includes('"subtype":"init"')),
  results: count((l) => l.includes('"type":"result"')),
  userEvents: count((l) => l.includes('"type":"user"')),
  hookEvents: count((l) => l.toLowerCase().includes("hook")),
  goalMentions: count((l) => l.toLowerCase().includes("goal")),
  localCommandStdout: count((l) => l.includes("local-command-stdout")),
  jsonlPath: join(
    homedir(),
    ".claude",
    "projects",
    PROJECT_DIR.replaceAll("/", "-"),
    `${SESSION_ID}.jsonl`,
  ),
};
meta.jsonlExists = existsSync(meta.jsonlPath);
writeFileSync(join(OUT_DIR, `${base}.meta.json`), JSON.stringify(meta, null, 2));
console.error(`[probe] wrote ${base}.{stdout,stderr,meta.json}`);
console.error(JSON.stringify(meta, null, 2));
