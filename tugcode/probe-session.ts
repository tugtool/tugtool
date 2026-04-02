#!/usr/bin/env bun
/**
 * Transport probe for session commands.
 * Tests: new session, message in new session.
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");

console.log("=== Session Command Probe ===\n");

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
  console.log(`>>> ${(msg as any).type || JSON.stringify(msg)}`);
  proc.stdin.write(json);
}

let phase = 0; // 0=handshake, 1=send new session, 2=send message in new session
let startTime = Date.now();

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

        if (type === "assistant_text" && msg.is_partial) {
          const len = (msg.text || "").length;
          console.log(`<<< [${elapsed}s] ${type} [partial, len=${len}]`);
        } else if (type === "system_metadata") {
          console.log(`<<< [${elapsed}s] ${type} (model=${msg.model}, session=${msg.session_id?.slice(0, 8)})`);
        } else if (type === "cost_update") {
          console.log(`<<< [${elapsed}s] ${type}: $${msg.total_cost_usd?.toFixed(4)} (${msg.num_turns} turns)`);
        } else if (type === "assistant_text" && !msg.is_partial) {
          console.log(`<<< [${elapsed}s] ${type} [COMPLETE, len=${(msg.text || "").length}]`);
          console.log(`    "${(msg.text || "").slice(0, 200)}"`);
        } else {
          console.log(`<<< [${elapsed}s] ${type}: ${JSON.stringify(msg)}`);
        }

        // After first session_init, send "new" session command
        if (type === "session_init" && phase === 0) {
          phase = 1;
          console.log("\n--- Sending session_command: new ---");
          send({ type: "session_command", command: "new" });
        } else if (type === "session_init" && phase === 1) {
          // After the second session_init (new session), send a message
          phase = 2;
          const sid = msg.session_id || "?";
          console.log(`\n--- New session ready (${sid}). Sending message. ---`);
          send({ type: "user_message", text: "What session is this? Reply in one sentence.", attachments: [] });
        }

        if (type === "turn_complete" && phase === 2) {
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
