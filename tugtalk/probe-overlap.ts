#!/usr/bin/env bun
/**
 * Test: what happens when we send a user_message while a turn is in progress?
 * Sends a long prompt, waits for streaming to start, then sends another message.
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");

console.log("=== Overlap Probe (message during turn) ===\n");

const proc = spawn({
  cmd: ["bun", "run", "tugtalk/src/main.ts", "--dir", PROJECT_DIR],
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
  console.log(`>>> ${(msg as any).type}: ${(msg as any).text || (msg as any).command || ""}`);
  proc.stdin.write(json);
}

let messageSent = false;
let secondSent = false;
let partialCount = 0;
let turnCompleteCount = 0;
const startTime = Date.now();

setTimeout(() => { console.log("\n[timeout]"); proc.kill(); process.exit(1); }, 90_000);

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
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (type === "assistant_text") {
          partialCount++;
          const len = (msg.text || "").length;
          console.log(`<<< [${elapsed}s] ${type} #${partialCount} [partial=${msg.is_partial}, len=${len}]`);

          // After 2 partials from first response, send a second message
          if (partialCount === 2 && !secondSent) {
            secondSent = true;
            console.log(`\n--- SENDING SECOND MESSAGE MID-STREAM ---`);
            send({ type: "user_message", text: "Stop. Just say 'INTERRUPTED'.", attachments: [] });
            console.log("");
          }
        } else if (type === "system_metadata") {
          console.log(`<<< [${elapsed}s] system_metadata`);
        } else if (type === "cost_update") {
          console.log(`<<< [${elapsed}s] cost_update: $${msg.total_cost_usd?.toFixed(4)}`);
        } else if (type === "turn_complete") {
          turnCompleteCount++;
          console.log(`<<< [${elapsed}s] turn_complete #${turnCompleteCount} (result=${msg.result})`);
          if (turnCompleteCount >= 2) {
            console.log("\n--- Both turns complete ---");
            proc.kill();
            process.exit(0);
          }
        } else if (type === "thinking_text") {
          console.log(`<<< [${elapsed}s] thinking_text [partial=${msg.is_partial}]`);
        } else {
          console.log(`<<< [${elapsed}s] ${type}: ${JSON.stringify(msg).slice(0, 200)}`);
        }

        if (type === "session_init" && !messageSent) {
          messageSent = true;
          console.log("\n--- Sending first (long) message ---");
          send({ type: "user_message", text: "Write 200 words about the ocean.", attachments: [] });
          console.log("");
        }
      } catch {
        console.log(`<<< RAW: ${line}`);
      }
    }

    lineEnd = buffer.indexOf("\n");
  }
}
