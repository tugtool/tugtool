#!/usr/bin/env bun
/**
 * Test model_change message and session resume.
 * Changes model to sonnet, sends a message, observes system_metadata for model field.
 */

import { spawn } from "bun";

const PROJECT_DIR = "/Users/kocienda/Mounts/u/src/tugtool";

console.log("=== Model Change Probe ===\n");

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
  console.log(`>>> ${(msg as any).type}: ${(msg as any).model || (msg as any).text || ""}`);
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

        if (type === "system_metadata") {
          console.log(`<<< [${elapsed}s] system_metadata (model=${msg.model})`);
        } else if (type === "assistant_text") {
          const len = (msg.text || "").length;
          if (!msg.is_partial) {
            console.log(`<<< [${elapsed}s] assistant_text [COMPLETE, len=${len}]`);
            console.log(`    "${(msg.text || "").slice(0, 200)}"`);
          } else {
            console.log(`<<< [${elapsed}s] assistant_text [partial, len=${len}]`);
          }
        } else if (type === "cost_update") {
          console.log(`<<< [${elapsed}s] cost_update: $${msg.total_cost_usd?.toFixed(4)}`);
        } else if (type === "turn_complete") {
          console.log(`<<< [${elapsed}s] turn_complete (result=${msg.result})`);

          if (phase === 0) {
            // After first turn, change model to sonnet
            phase = 1;
            console.log("\n--- Changing model to claude-sonnet-4-6 ---");
            send({ type: "model_change", model: "claude-sonnet-4-6" });
            console.log("--- Sending message with new model ---");
            send({ type: "user_message", text: "What model are you? Reply in one sentence.", attachments: [] });
            console.log("");
          } else {
            console.log("\n--- Done ---");
            // Change back to opus before exiting
            send({ type: "model_change", model: "claude-opus-4-6" });
            proc.kill();
            process.exit(0);
          }
        } else if (type === "session_init") {
          console.log(`<<< [${elapsed}s] session_init (session=${msg.session_id?.slice(0, 8)}...)`);
          if (phase === 0) {
            console.log("\n--- Sending first message (should be opus) ---");
            send({ type: "user_message", text: "What model are you? Reply in one sentence.", attachments: [] });
          }
        } else {
          console.log(`<<< [${elapsed}s] ${type}`);
        }
      } catch {
        console.log(`<<< RAW: ${line}`);
      }
    }

    lineEnd = buffer.indexOf("\n");
  }
}
