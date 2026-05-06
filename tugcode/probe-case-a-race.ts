#!/usr/bin/env bun
/**
 * Probe: CASE A interrupt + immediate re-submit. Verifies wire FIFO
 * ordering — does the aborted cycle's `turn_complete(error)` arrive
 * before any content from the re-submitted turn?
 *
 * Sequence sent on stdin:
 *   user_message #1 → interrupt → user_message #2
 *
 * Expected (FIFO holds):
 *   <stdout: stuff for #1, ending in turn_complete(error) msg_id="">
 *   <stdout: stuff for #2, content frames + final turn_complete(success)>
 *
 * Counter-evidence: any frame for #2 (e.g. assistant_text) before
 * the turn_complete(error) for #1.
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");

console.log("=== CASE A + re-submit Race Probe ===\n");

const proc = spawn({
  cmd: ["bun", "run", "tugcode/src/main.ts", "--dir", PROJECT_DIR],
  cwd: PROJECT_DIR,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

(async () => {
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr) {
    for (const line of decoder.decode(chunk, { stream: true }).split("\n").filter(Boolean)) {
      console.log(`  [log] ${line}`);
    }
  }
})();

function send(msg: object) {
  const json = JSON.stringify(msg) + "\n";
  console.log(`>>> ${JSON.stringify(msg)}`);
  proc.stdin.write(json);
}

let messageSent = false;
let firstTurnCompleteSeen = false;

// Track ordering: every wire frame after the first user_message goes
// here so we can inspect the sequence at exit.
const wireFrames: Array<{ type: string; preview: string }> = [];

setTimeout(() => {
  console.log("\n[120s timeout]");
  console.log(`\nTotal wire frames captured: ${wireFrames.length}`);
  for (let i = 0; i < wireFrames.length; i++) {
    console.log(`  ${i}: ${wireFrames[i].type}: ${wireFrames[i].preview}`);
  }
  proc.kill();
  process.exit(1);
}, 120_000);

send({ type: "protocol_init", version: 1 });

const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of proc.stdout) {
  buffer += decoder.decode(chunk, { stream: true });

  let lineEnd = buffer.indexOf("\n");
  while (lineEnd >= 0) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);

    if (line.length > 0) {
      try {
        const msg = JSON.parse(line);
        const type = msg.type || "unknown";

        // Compact preview of non-bulky frames.
        let preview = "";
        if (type === "assistant_text") {
          preview = `msg_id=${msg.msg_id} partial=${msg.is_partial} len=${(msg.text || "").length}`;
        } else if (type === "thinking_text") {
          preview = `msg_id=${msg.msg_id} partial=${msg.is_partial} len=${(msg.text || "").length}`;
        } else if (type === "turn_complete") {
          preview = `msg_id="${msg.msg_id}" result=${msg.result} seq=${msg.seq}`;
        } else if (type === "cost_update") {
          preview = `cost=$${msg.total_cost_usd?.toFixed(4)} turns=${msg.num_turns}`;
        } else if (type === "system_metadata") {
          preview = `(omitted)`;
        } else {
          preview = JSON.stringify(msg).slice(0, 120);
        }

        if (messageSent) {
          wireFrames.push({ type, preview });
          console.log(`<<< [${wireFrames.length - 1}] ${type}: ${preview}`);
        } else {
          console.log(`<<< ${type}: ${preview}`);
        }

        if (type === "session_init" && !messageSent) {
          messageSent = true;
          console.log("\n--- Sending user_message #1 + interrupt + user_message #2 ---");
          send({
            type: "user_message",
            text: "Write a detailed 500-word essay about the history of computing.",
            attachments: [],
          });
          send({ type: "interrupt" });
          send({
            type: "user_message",
            text: "Just say the word HELLO.",
            attachments: [],
          });
          console.log("");
        }

        if (type === "turn_complete") {
          if (!firstTurnCompleteSeen) {
            firstTurnCompleteSeen = true;
            console.log(`\n--- First turn_complete: msg_id="${msg.msg_id}" result=${msg.result} ---`);
            // Don't kill yet; wait for the second turn's terminal too.
          } else {
            console.log(`\n--- Second turn_complete: msg_id="${msg.msg_id}" result=${msg.result} ---`);
            console.log(`\n=== Ordering summary ===`);
            for (let i = 0; i < wireFrames.length; i++) {
              console.log(`  ${i}: ${wireFrames[i].type}: ${wireFrames[i].preview}`);
            }
            proc.kill();
            process.exit(0);
          }
        }
      } catch {
        console.log(`<<< RAW: ${line}`);
      }
    }

    lineEnd = buffer.indexOf("\n");
  }
}
