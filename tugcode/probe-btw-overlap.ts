#!/usr/bin/env bun
/**
 * Raw /btw overlap probe — bypasses tugcode entirely.
 *
 * Spawns claude directly with the same stream-json flags tugcode
 * uses, starts a long pure-text turn, then sends `/btw <question>`
 * mid-stream. Shows whether /btw is processed without interrupting
 * the main turn, and *when* its answer lands relative to the main
 * turn's `result` — the question the D.5 queue policy turns on.
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");

const which = Bun.spawnSync({ cmd: ["which", "claude"] });
const claudePath = new TextDecoder().decode(which.stdout).trim();

const args = [
  claudePath,
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--permission-prompt-tool", "stdio",
  "--include-partial-messages",
  "--permission-mode", "acceptEdits",
  "--no-session-persistence",
];

console.log("=== Raw /btw overlap probe ===\n");

const proc = spawn({
  cmd: args,
  cwd: PROJECT_DIR,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

(async () => {
  const dec = new TextDecoder();
  for await (const chunk of proc.stderr) {
    for (const line of dec.decode(chunk, { stream: true }).split("\n").filter(Boolean)) {
      console.log(`  [stderr] ${line}`);
    }
  }
})();

function send(text: string) {
  const json =
    JSON.stringify({
      type: "user",
      session_id: "",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    }) + "\n";
  console.log(`\n>>> SEND: ${text}\n`);
  proc.stdin.write(json);
  proc.stdin.flush();
}

const startTime = Date.now();
let initialized = false;
let btwSent = false;
let textDeltas = 0;
let resultCount = 0;

// claude in `--input-format stream-json` mode stays silent (no
// `system:init`) until it receives its first stdin message — so the
// opening turn is sent on a timer, not gated on `system:init`.
setTimeout(() => {
  if (!initialized) {
    initialized = true;
    send("Write a detailed 400-word essay about the deep ocean. Be thorough and vivid.");
  }
}, 1500);

setTimeout(() => {
  console.log("\n[timeout — 120s]");
  proc.kill();
  process.exit(1);
}, 120_000);

const dec = new TextDecoder();
let buffer = "";

for await (const chunk of proc.stdout) {
  buffer += dec.decode(chunk, { stream: true });
  let nl = buffer.indexOf("\n");
  while (nl >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line.length > 0) {
      const t = ((Date.now() - startTime) / 1000).toFixed(1);
      try {
        const msg = JSON.parse(line);
        const type = msg.type || "unknown";
        const subtype = msg.subtype || "";
        if (type === "system" && subtype === "init") {
          console.log(`<<< [${t}s] system:init (session=${(msg.session_id || "").slice(0, 12)})`);
        } else if (type === "stream_event") {
          const delta = msg.event?.delta;
          if (delta?.type === "text_delta") {
            textDeltas++;
            const snip = (delta.text || "").slice(0, 44).replace(/\n/g, "⏎");
            console.log(`<<< [${t}s] text_delta #${textDeltas} (${(delta.text || "").length}c) "${snip}"`);
            if (textDeltas === 4 && !btwSent) {
              btwSent = true;
              console.log("\n--- main turn streaming; sending /btw mid-stream ---");
              send("/btw What is 2 + 2? Answer in one word.");
            }
          } else if (delta?.type === "thinking_delta") {
            console.log(`<<< [${t}s] thinking_delta`);
          } else {
            console.log(`<<< [${t}s] stream:${delta?.type || msg.event?.type || "?"}`);
          }
        } else if (type === "assistant") {
          const blocks = msg.message?.content || [];
          const kinds = blocks.map((b: { type?: string }) => b.type).join(",");
          console.log(`<<< [${t}s] assistant snapshot [${kinds}]`);
        } else if (type === "user") {
          console.log(`<<< [${t}s] user (echo): ${JSON.stringify(msg).slice(0, 160)}`);
        } else if (type === "result") {
          resultCount++;
          console.log(`<<< [${t}s] result #${resultCount}: subtype=${subtype}`);
          console.log(`    ${JSON.stringify(msg).slice(0, 320)}`);
          if (resultCount >= 2) {
            console.log("\n--- two results seen ---");
            proc.kill();
            process.exit(0);
          }
        } else {
          console.log(`<<< [${t}s] ${type}${subtype ? ":" + subtype : ""}: ${JSON.stringify(msg).slice(0, 180)}`);
        }
      } catch {
        console.log(`<<< [${t}s] RAW: ${line.slice(0, 180)}`);
      }
    }
    nl = buffer.indexOf("\n");
  }
}
