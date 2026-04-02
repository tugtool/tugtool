#!/usr/bin/env bun
/**
 * Test /compact to observe compact_boundary events.
 * Also tests session_command: "fork".
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");
const test = Bun.argv[2] || "compact"; // "compact" or "fork"

console.log(`=== ${test === "fork" ? "Fork" : "Compact"} Probe ===\n`);

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
  console.log(`>>> ${(msg as any).type}: ${(msg as any).text?.slice(0, 60) || (msg as any).command || ""}`);
  proc.stdin.write(json);
}

let phase = 0;
const startTime = Date.now();

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
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Show ALL events — we want to catch system/compact_boundary
        if (type === "assistant_text" && msg.is_partial) {
          // skip partials
        } else if (type === "system_metadata") {
          console.log(`<<< [${elapsed}s] system_metadata (model=${msg.model})`);
        } else {
          console.log(`<<< [${elapsed}s] ${type}: ${JSON.stringify(msg).slice(0, 300)}`);
        }

        if (type === "session_init" && phase === 0) {
          phase = 1;
          if (test === "compact") {
            // Send a few messages to build context, then compact
            console.log("\n--- Building context then compacting ---");
            send({ type: "user_message", text: "Say 'one'.", attachments: [] });
          } else {
            console.log("\n--- Sending session_command: fork ---");
            send({ type: "session_command", command: "fork" });
            phase = 3;
          }
        }

        if (type === "turn_complete" && phase === 1) {
          phase = 2;
          console.log("\n--- Sending /compact ---");
          send({ type: "user_message", text: "/compact", attachments: [] });
        }

        if (type === "turn_complete" && phase === 2) {
          console.log("\n--- Done ---");
          proc.kill();
          process.exit(0);
        }

        if (type === "session_init" && phase === 3) {
          phase = 4;
          console.log("\n--- Fork session_init received, sending message ---");
          send({ type: "user_message", text: "What session is this? One sentence.", attachments: [] });
        }

        if (type === "turn_complete" && phase === 4) {
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
