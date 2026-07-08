#!/usr/bin/env bun
// /btw headless probe ([Q03]): what does /btw do over raw stream-json?
//
// In the TUI, /btw is an ephemeral side question — answered from the
// conversation with no tools, rendered in an overlay, never entering
// history. Headless behavior is undocumented, and the 2.1.204 catalog
// (capabilities/2.1.204/system-metadata.jsonl) does NOT list `btw` in
// slash_commands.
//
// Flow: seed a session with a memorable fact, then send `/btw <question
// about that fact>`, capture everything, and afterwards inspect the
// session JSONL for contamination (did the exchange enter history?).
//
// Output: capture-btw-<timestamp>.{stdout,stderr,meta.json}.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECT_DIR = "/private/tmp/btw-probe";
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
console.error(`[btw] session=${SESSION_ID}`);
const proc = spawn("claude", args, { cwd: PROJECT_DIR, env, stdio: ["pipe", "pipe", "pipe"] });
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
  console.error(`[btw] claude exited code=${code} signal=${signal}`);
});

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
function sendUser(text) {
  proc.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n",
  );
  console.error(`[btw] sent: ${text.slice(0, 70)}`);
}

await sleep(3);
// Seed context: a fact only this conversation knows.
sendUser("Remember this for later: the magic word is XYLOPHONE-42. Just acknowledge briefly.");
await sleep(15);
// The side question.
sendUser("/btw what is the magic word I told you earlier?");
await sleep(25);
// A normal turn afterwards, to see whether the /btw exchange leaked into context.
sendUser("What was the last thing I asked you before this message? Quote it exactly.");
await sleep(20);

if (!exited) {
  proc.stdin.end();
  await sleep(8);
}
if (!exited) {
  proc.kill("SIGTERM");
  await sleep(3);
  if (!exited) proc.kill("SIGKILL");
}

const base = `capture-btw-${TS}`;
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
const count = (s) => stdoutLines.filter((l) => l.includes(s)).length;
const meta = {
  cli: "2.1.204",
  sessionId: SESSION_ID,
  capture: base,
  stdoutLines: stdoutLines.length,
  results: count('"type":"result"'),
  systemInit: count('"subtype":"init"'),
  btwEnvelope: count("<command-name>/btw"),
  unknownCommand: count("Unknown"),
  xylophoneOnWire: count("XYLOPHONE-42"),
  jsonlExists: existsSync(jsonlPath),
  jsonlMentionsBtw: jsonl.includes("/btw"),
  jsonlMentionsXylophoneAnswer: (jsonl.match(/XYLOPHONE-42/g) ?? []).length,
};
writeFileSync(join(OUT_DIR, `${base}.meta.json`), JSON.stringify(meta, null, 2));
console.error(JSON.stringify(meta, null, 2));
