#!/usr/bin/env bun
/**
 * Transport probe — tests interrupt behavior.
 * Sends a prompt that will produce a long response, then interrupts mid-stream.
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");

console.log("=== Interrupt Probe ===\n");

const proc = spawn({
  cmd: ["bun", "run", "tugtalk/src/main.ts", "--dir", PROJECT_DIR],
  cwd: PROJECT_DIR,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

// Drain stderr
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

let handshakeDone = false;
let messageSent = false;
let interruptSent = false;
let partialCount = 0;

setTimeout(() => { console.log("\n[timeout]"); proc.kill(); process.exit(1); }, 60_000);

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

        if (type === "assistant_text") {
          partialCount++;
          const len = (msg.text || "").length;
          console.log(`<<< ${type} #${partialCount} [partial=${msg.is_partial}, status=${msg.status}, len=${len}]`);

          // After 3 partials, send interrupt
          if (partialCount === 3 && !interruptSent) {
            interruptSent = true;
            console.log("\n--- Sending INTERRUPT ---");
            send({ type: "interrupt" });
            console.log("");
          }
        } else if (type === "system_metadata") {
          console.log(`<<< ${type} (omitted for brevity)`);
        } else if (type === "cost_update") {
          console.log(`<<< ${type}: $${msg.total_cost_usd?.toFixed(4)} (${msg.num_turns} turns)`);
        } else {
          console.log(`<<< ${type}: ${JSON.stringify(msg)}`);
        }

        if (type === "session_init" && !messageSent) {
          messageSent = true;
          console.log("\n--- Sending long prompt ---");
          send({
            type: "user_message",
            text: "Write a detailed 500-word essay about the history of computing, from Babbage to modern AI.",
            attachments: [],
          });
          console.log("");
        }

        if (type === "turn_complete" || type === "turn_cancelled") {
          console.log("\n--- Done ---");
          proc.kill();
          process.exit(0);
        }
      } catch {
        console.log(`<<< RAW: ${line}`);
      }
    }

    lineEnd = buffer.indexOf("\n");
  }
}
