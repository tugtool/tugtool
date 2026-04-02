#!/usr/bin/env bun
/**
 * Transparent proxy — spawns claude with the same args tugcode uses,
 * but logs EVERY line of stdout before we'd process it.
 * This shows what Claude Code actually emits for slash commands.
 */

import { spawn } from "bun";
import { resolve } from "path";
import { TugbankClient } from "./src/tugbank-client.ts";

const PROJECT_DIR = resolve(import.meta.dir, "..");
const message = Bun.argv[2] || "/cost";

// Read session ID from tugbank via direct bun:sqlite access.
let sessionId: string | null = null;
try {
  const client = new TugbankClient();
  const value = client.get("dev.tugtool.app", "session-id");
  client.close();
  sessionId = typeof value === "string" && value.length > 0 ? value : null;
  if (sessionId) {
    console.log(`Session ID: ${sessionId}`);
  } else {
    console.log("No session ID in tugbank, using fresh session");
  }
} catch {
  console.log("Failed to read session from tugbank, using fresh session");
}

console.log(`=== Raw Stdin Probe ===`);
console.log(`Message: "${message}"\n`);

const claudePath = Bun.which("claude");
if (!claudePath) { console.log("claude not found"); process.exit(1); }

const args = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--permission-prompt-tool", "stdio",
  "--include-partial-messages",
  "--replay-user-messages",
  "--plugin-dir", PROJECT_DIR,
  "--model", "claude-opus-4-6",
  "--permission-mode", "acceptEdits",
];
if (sessionId) {
  args.push("--resume", sessionId);
}

console.log(`Args: ${args.join(" ")}\n`);

const proc = spawn({
  cmd: [claudePath, ...args],
  cwd: PROJECT_DIR,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

(async () => {
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr) {
    for (const line of decoder.decode(chunk, { stream: true }).split("\n").filter(Boolean)) {
      console.log(`  [stderr] ${line}`);
    }
  }
})();

let messageSent = false;
let lineCount = 0;
const startTime = Date.now();

setTimeout(() => { console.log("\n[timeout]"); proc.kill(); process.exit(1); }, 45_000);

const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of proc.stdout) {
  buffer += decoder.decode(chunk, { stream: true });

  let lineEnd = buffer.indexOf("\n");
  while (lineEnd >= 0) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);

    if (line.length > 0) {
      lineCount++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      try {
        const msg = JSON.parse(line);
        const type = msg.type || "?";
        const subtype = msg.subtype || "";
        console.log(`[${elapsed}s] #${lineCount} ${type}${subtype ? `:${subtype}` : ""} → ${line.slice(0, 250)}`);

        // After system:init, send the slash command
        if (type === "system" && subtype === "init" && !messageSent) {
          messageSent = true;
          const userInput = JSON.stringify({
            type: "user",
            session_id: "",
            message: { role: "user", content: [{ type: "text", text: message }] },
            parent_tool_use_id: null,
          }) + "\n";
          console.log(`\n>>> STDIN: ${userInput.trim()}\n`);
          proc.stdin.write(userInput);
          proc.stdin.flush();
        }

        // Stop after result
        if (type === "result") {
          console.log(`\n--- ${lineCount} lines total ---`);
          proc.kill();
          process.exit(0);
        }
      } catch {
        console.log(`[${elapsed}s] #${lineCount} RAW → ${line.slice(0, 250)}`);
      }
    }

    lineEnd = buffer.indexOf("\n");
  }
}
