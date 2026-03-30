#!/usr/bin/env bun
/**
 * Raw Claude Code probe — bypasses tugtalk entirely.
 * Spawns claude CLI directly with stream-json and sends messages to its stdin.
 * This lets us see EXACTLY what Claude Code emits for slash commands.
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");
const message = Bun.argv[2] || "/cost";

console.log(`=== Raw Claude Code Probe ===`);
console.log(`Message: "${message}"\n`);

// Find claude binary
const which = Bun.spawnSync({ cmd: ["which", "claude"] });
const claudePath = new TextDecoder().decode(which.stdout).trim();
console.log(`Claude binary: ${claudePath}\n`);

// Try two modes: interactive (--input-format stream-json) or print (-p)
const useInteractive = !Bun.argv.includes("--print");

const args = useInteractive
  ? [
      claudePath,
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--permission-prompt-tool", "stdio",
      "--include-partial-messages",
      "--plugin-dir", PROJECT_DIR,
      "--model", "claude-opus-4-6",
      "--permission-mode", "acceptEdits",
      "--no-session-persistence",
    ]
  : [
      claudePath,
      "-p", message,
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--plugin-dir", PROJECT_DIR,
      "--model", "claude-opus-4-6",
      "--permission-mode", "acceptEdits",
    ];

console.log(`Mode: ${useInteractive ? "interactive (stream-json stdin)" : "print (-p)"}\n`);

const proc = spawn({
  cmd: args,
  cwd: PROJECT_DIR,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

// Log stderr
(async () => {
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr) {
    for (const line of decoder.decode(chunk, { stream: true }).split("\n").filter(Boolean)) {
      console.log(`  [stderr] ${line}`);
    }
  }
})();

let initialized = false;
let messageSent = false;
const startTime = Date.now();

setTimeout(() => {
  console.log("\n[timeout — 60s]");
  proc.kill();
  process.exit(1);
}, 60_000);

const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of proc.stdout) {
  buffer += decoder.decode(chunk, { stream: true });

  let lineEnd = buffer.indexOf("\n");
  while (lineEnd >= 0) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);

    if (line.length > 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      try {
        const msg = JSON.parse(line);
        const type = msg.type || "unknown";
        const subtype = msg.subtype || "";

        // Compact display
        if (type === "system" && subtype === "init") {
          console.log(`<<< [${elapsed}s] system:init (session=${(msg.session_id || "").slice(0, 12)})`);
          initialized = true;

          if (!messageSent) {
            messageSent = true;
            // Send the message as a user input
            const userInput = JSON.stringify({
              type: "user",
              session_id: "",
              message: { role: "user", content: [{ type: "text", text: message }] },
              parent_tool_use_id: null,
            }) + "\n";
            console.log(`\n>>> Sending: ${message}\n`);
            proc.stdin.write(userInput);
            proc.stdin.flush();
          }
        } else if (type === "stream_event") {
          const delta = msg.event?.delta;
          if (delta?.type === "text_delta") {
            console.log(`<<< [${elapsed}s] stream:text_delta (${(delta.text || "").length} chars)`);
          } else if (delta?.type === "thinking_delta") {
            console.log(`<<< [${elapsed}s] stream:thinking_delta (${(delta.thinking || "").length} chars)`);
          } else {
            console.log(`<<< [${elapsed}s] stream:${delta?.type || msg.event?.type || "?"}: ${JSON.stringify(msg.event || {}).slice(0, 150)}`);
          }
        } else if (type === "result") {
          console.log(`<<< [${elapsed}s] result: subtype=${subtype}, cost=$${msg.cost_usd?.toFixed(4)}`);
          console.log(`    Full: ${JSON.stringify(msg).slice(0, 300)}`);
          // Done after result
          console.log("\n--- Done ---");
          proc.kill();
          process.exit(0);
        } else {
          console.log(`<<< [${elapsed}s] ${type}${subtype ? `:${subtype}` : ""}: ${JSON.stringify(msg).slice(0, 200)}`);
        }
      } catch {
        console.log(`<<< [${elapsed}s] RAW: ${line.slice(0, 200)}`);
      }
    }

    lineEnd = buffer.indexOf("\n");
  }
}
