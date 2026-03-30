#!/usr/bin/env bun
/**
 * Test image attachment via user_message.
 * Sends a tiny 1x1 PNG pixel and asks Claude to describe it.
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");

// Minimal 1x1 red PNG, base64-encoded
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

console.log("=== Image Attachment Probe ===\n");

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
  console.log(`>>> ${(msg as any).type}`);
  proc.stdin.write(json);
}

let messageSent = false;
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

        if (type === "assistant_text" && !msg.is_partial) {
          console.log(`<<< [${elapsed}s] assistant_text [COMPLETE, len=${(msg.text || "").length}]`);
          console.log(`    "${(msg.text || "").slice(0, 300)}"`);
        } else if (type === "assistant_text") {
          console.log(`<<< [${elapsed}s] assistant_text [partial, len=${(msg.text || "").length}]`);
        } else if (type === "system_metadata") {
          console.log(`<<< [${elapsed}s] system_metadata`);
        } else if (type === "cost_update") {
          console.log(`<<< [${elapsed}s] cost_update: $${msg.total_cost_usd?.toFixed(4)}`);
        } else if (type === "error") {
          console.log(`<<< [${elapsed}s] ERROR: ${msg.message}`);
        } else {
          console.log(`<<< [${elapsed}s] ${type}: ${JSON.stringify(msg).slice(0, 200)}`);
        }

        if (type === "session_init" && !messageSent) {
          messageSent = true;
          console.log("\n--- Sending message with image attachment ---");
          send({
            type: "user_message",
            text: "I'm attaching a tiny image. What can you see? Describe it briefly.",
            attachments: [
              {
                filename: "test-pixel.png",
                content: TINY_PNG_B64,
                media_type: "image/png",
              },
            ],
          });
          console.log("");
        }

        if (type === "turn_complete") {
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
