#!/usr/bin/env bun
// side_question control-request probe ([Q01]/[Q02]).
//
// The user-text `/btw ...` path is refused headless (see
// ../goal-loop/FINDINGS.md, [Q03]). This probe knocks on the OTHER door: a
// `control_request { subtype: "side_question", question }` written to
// Claude's stdin — the same inbound control-request channel that services
// `initialize`/`interrupt`/`set_model`. The question is whether Claude
// answers it over stream-json, both idle and mid-turn.
//
// Flow:
//   1. seed a session with a memorable fact (normal user turn)
//   2. IDLE: after the turn settles, send a side_question control-request,
//      capture the control_response
//   3. MID-TURN: start a long streaming turn, and WHILE it streams send a
//      second side_question control-request; capture whether a
//      control_response arrives before the turn's `result`, and whether the
//      turn's own output stays complete/uninterrupted
//   4. inspect the session JSONL: neither side question should enter history
//
// Output: capture-btw-control-<timestamp>.{stdout,stderr,meta.json}.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECT_DIR = "/private/tmp/btw-control-probe";
const SESSION_ID = crypto.randomUUID();
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = new URL(".", import.meta.url).pathname;

mkdirSync(PROJECT_DIR, { recursive: true });

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.CLAUDE_CODE_OAUTH_TOKEN;

const args = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--replay-user-messages",
  "--permission-mode", "bypassPermissions",
  "--session-id", SESSION_ID,
];

const stdoutLines = [];
const stderrLines = [];
console.error(`[btw-control] session=${SESSION_ID}`);
const proc = spawn("claude", args, { cwd: PROJECT_DIR, env, stdio: ["pipe", "pipe", "pipe"] });
proc.stdout.on("data", (c) => {
  const t = new Date().toISOString();
  for (const l of c.toString().split("\n")) {
    if (!l) continue;
    stdoutLines.push(`${t}\t${l}`);
    if (l.includes('"control_response"')) console.error(`[btw-control] <-- control_response: ${l.slice(0, 200)}`);
  }
});
proc.stderr.on("data", (c) => {
  const t = new Date().toISOString();
  for (const l of c.toString().split("\n")) if (l) stderrLines.push(`${t}\t${l}`);
});
let exited = false;
proc.on("exit", (code, signal) => {
  exited = true;
  console.error(`[btw-control] claude exited code=${code} signal=${signal}`);
});

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
function sendUser(text) {
  proc.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n",
  );
  console.error(`[btw-control] --> user: ${text.slice(0, 70)}`);
}
function sendSideQuestion(requestId, question) {
  proc.stdin.write(
    JSON.stringify({
      type: "control_request",
      request_id: requestId,
      request: { subtype: "side_question", question },
    }) + "\n",
  );
  console.error(`[btw-control] --> control_request ${requestId}: side_question "${question.slice(0, 60)}"`);
}

await sleep(3);

// (1) Seed a fact only this conversation knows.
sendUser("Remember this for later: the magic word is XYLOPHONE-42. Just acknowledge briefly.");
await sleep(15);

// (2) IDLE side question about the seeded fact.
sendSideQuestion("btw-idle-1", "What is the magic word I told you earlier? Answer with just the word.");
await sleep(20);

// (3) MID-TURN: kick off a genuinely long streaming turn (a verbose essay
// streams for many seconds), then fire a side question ~6s in — WHILE it is
// still streaming — so the overlap is real, not an accidental idle.
sendUser("Write a detailed, thorough essay of at least 800 words about the history of the printing press, in flowing prose. Take your time and be comprehensive.");
await sleep(6); // the essay is still streaming at this point
const midturnSentAt = new Date().toISOString();
sendSideQuestion("btw-midturn-1", "While you write that essay: what was the magic word again? Just the word.");
await sleep(60); // let both the side answer and the full essay settle

if (!exited) {
  proc.stdin.end();
  await sleep(8);
}
if (!exited) {
  proc.kill("SIGTERM");
  await sleep(3);
  if (!exited) proc.kill("SIGKILL");
}

const base = `capture-btw-control-${TS}`;
writeFileSync(join(OUT_DIR, `${base}.stdout`), stdoutLines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, `${base}.stderr`), stderrLines.join("\n") + "\n");

const jsonlPath = join(
  homedir(),
  ".claude",
  "projects",
  PROJECT_DIR.replaceAll("/", "-"),
  `${SESSION_ID}.jsonl`,
);
const jsonl = existsSync(jsonlPath) ? readFileSync(jsonlPath, "utf-8") : "";

// Extract the raw JSON of each control_response for the record.
const controlResponses = stdoutLines
  .map((l) => l.slice(l.indexOf("\t") + 1))
  .filter((l) => l.includes('"control_response"'));

const count = (s) => stdoutLines.filter((l) => l.includes(s)).length;

// Genuine mid-turn overlap: did the mid-turn control_response arrive BEFORE
// the essay turn's `result` frame? Find the index of the mid-turn
// control_response and the LAST result before it.
const midturnRespIdx = stdoutLines.findIndex((l) => l.includes('"request_id":"btw-midturn-1"'));
const resultIdxsBeforeMidturn = stdoutLines
  .map((l, i) => (l.includes('"type":"result"') ? i : -1))
  .filter((i) => i >= 0 && i < midturnRespIdx);
// If the mid-turn response landed while only ONE result (the seed turn) had
// been emitted, it arrived before the essay turn settled → true concurrency.
const midturnResponseBeforeEssayResult = midturnRespIdx >= 0 && resultIdxsBeforeMidturn.length <= 1;

const meta = {
  cli: "2.1.204",
  sessionId: SESSION_ID,
  capture: base,
  stdoutLines: stdoutLines.length,
  results: count('"type":"result"'),
  systemInit: count('"subtype":"init"'),
  controlResponses: controlResponses.length,
  controlResponseSamples: controlResponses,
  midturnSentAt,
  midturnResponseBeforeEssayResult,
  xylophoneOnWire: count("XYLOPHONE-42"),
  jsonlExists: existsSync(jsonlPath),
  // side questions must NOT enter history: the idle/mid-turn questions and
  // their answers should be absent from the JSONL.
  jsonlMentionsSideQuestionText: jsonl.includes("magic word again") || jsonl.includes("magic word I told you"),
  jsonlLen: jsonl.length,
};
writeFileSync(join(OUT_DIR, `${base}.meta.json`), JSON.stringify(meta, null, 2));
console.error(JSON.stringify({ ...meta, controlResponseSamples: `${controlResponses.length} captured` }, null, 2));
