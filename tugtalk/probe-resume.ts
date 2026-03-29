#!/usr/bin/env bun
/**
 * Test session_command: "continue" — resume the most recent session.
 * First starts a NEW session, sends a message with a unique marker,
 * then issues session_command: "continue" and asks about the marker.
 */

import { spawn } from "bun";

const PROJECT_DIR = "/Users/kocienda/Mounts/u/src/tugtool";
const MARKER = `PROBE_MARKER_${Date.now()}`;

console.log("=== Session Resume Probe ===");
console.log(`Marker: ${MARKER}\n`);

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
  console.log(`>>> ${(msg as any).type}: ${(msg as any).text?.slice(0, 60) || (msg as any).command || ""}`);
  proc.stdin.write(json);
}

let phase = 0;
// 0: handshake
// 1: send marker message
// 2: wait for turn_complete on marker
// 3: send session_command: continue
// 4: wait for new session_init
// 5: ask about marker
// 6: wait for response

let sessionIds: string[] = [];
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

        if (type === "session_init") {
          const sid = msg.session_id || "pending";
          sessionIds.push(sid);
          console.log(`<<< [${elapsed}s] session_init #${sessionIds.length} (session=${sid.slice(0, 12)}...)`);

          if (phase === 0 && sid !== "pending") {
            phase = 1;
            console.log(`\n--- Phase 1: Send marker message ---`);
            send({ type: "user_message", text: `Remember this marker: ${MARKER}. Just say OK.`, attachments: [] });
          }

          if (phase === 4 && sid !== "pending") {
            phase = 5;
            console.log(`\n--- Phase 5: Ask about marker in continued session ---`);
            send({ type: "user_message", text: `What was the marker I told you to remember? Just repeat it.`, attachments: [] });
          }
        } else if (type === "system_metadata") {
          console.log(`<<< [${elapsed}s] system_metadata (model=${msg.model}, session=${msg.session_id?.slice(0, 8)})`);
        } else if (type === "assistant_text" && !msg.is_partial) {
          console.log(`<<< [${elapsed}s] assistant_text [COMPLETE, len=${(msg.text || "").length}]`);
          console.log(`    "${(msg.text || "").slice(0, 300)}"`);
        } else if (type === "assistant_text") {
          // skip partials for brevity
        } else if (type === "cost_update") {
          console.log(`<<< [${elapsed}s] cost_update: $${msg.total_cost_usd?.toFixed(4)}`);
        } else if (type === "error") {
          console.log(`<<< [${elapsed}s] ERROR: ${msg.message} (recoverable=${msg.recoverable})`);
        } else if (type === "turn_complete") {
          console.log(`<<< [${elapsed}s] turn_complete (result=${msg.result})`);

          if (phase === 1) {
            phase = 3;
            console.log(`\n--- Phase 3: Send session_command: continue ---`);
            send({ type: "session_command", command: "continue" });
            phase = 4;
          }

          if (phase === 5 || phase === 6) {
            console.log(`\n--- Done ---`);
            console.log(`Sessions seen: ${sessionIds.map(s => s.slice(0, 12)).join(", ")}`);
            proc.kill();
            process.exit(0);
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
