#!/usr/bin/env bun
/**
 * Fresh session probe — no --resume, fresh session.
 * Tests if new skills are visible and if slash commands produce output.
 */

import { spawn } from "bun";

const PROJECT_DIR = "/Users/kocienda/Mounts/u/src/tugtool";
const message = Bun.argv[2] || "/tugplug:ping";

console.log(`=== Fresh Session Probe ===`);
console.log(`Message: "${message}"\n`);

const claudePath = Bun.which("claude");
if (!claudePath) { console.log("claude not found"); process.exit(1); }

// Fresh session — no --resume, add --replay-user-messages
const args = [
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--permission-prompt-tool", "stdio",
  "--include-partial-messages",
  "--replay-user-messages",
  "--plugin-dir", PROJECT_DIR + "/tugplug",
  "--model", "claude-sonnet-4-6",  // Use sonnet for speed
  "--permission-mode", "acceptEdits",
];

console.log(`Claude: ${claudePath}`);
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

setTimeout(() => { console.log("\n[timeout]"); proc.kill(); process.exit(1); }, 90_000);

// Send message immediately — don't wait for init
// Interactive mode may require first user message to trigger init
const earlyInput = JSON.stringify({
  type: "user",
  session_id: "",
  message: { role: "user", content: [{ type: "text", text: message }] },
  parent_tool_use_id: null,
}) + "\n";
console.log(`>>> Sending immediately (before init): ${message}\n`);
proc.stdin.write(earlyInput);
proc.stdin.flush();
messageSent = true;

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

        if (type === "system" && subtype === "init") {
          // Show skills list from init
          const skills = msg.skills || msg.slash_commands || [];
          console.log(`[${elapsed}s] #${lineCount} system:init (session=${(msg.session_id || "").slice(0, 12)}, skills=${JSON.stringify(skills).slice(0, 200)})`);

          if (!messageSent) {
            messageSent = true;
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
        } else if (type === "result") {
          console.log(`[${elapsed}s] #${lineCount} RESULT: ${JSON.stringify(msg).slice(0, 400)}`);
          console.log(`\n--- ${lineCount} lines, done ---`);
          proc.kill();
          process.exit(0);
        } else if (type === "stream_event") {
          const delta = msg.event?.delta;
          if (delta?.type === "text_delta") {
            console.log(`[${elapsed}s] #${lineCount} TEXT: "${(delta.text || "").slice(0, 100)}"`);
          } else if (delta?.type === "thinking_delta") {
            console.log(`[${elapsed}s] #${lineCount} THINKING: "${(delta.thinking || "").slice(0, 80)}"`);
          } else {
            console.log(`[${elapsed}s] #${lineCount} stream:${delta?.type || msg.event?.type || "?"}`);
          }
        } else if (type === "assistant") {
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                console.log(`[${elapsed}s] #${lineCount} ASSISTANT_TEXT: "${(block.text || "").slice(0, 150)}"`);
              } else if (block.type === "tool_use") {
                console.log(`[${elapsed}s] #${lineCount} ASSISTANT_TOOL: ${block.name} id=${(block.id || "").slice(-8)}`);
              }
            }
          } else {
            console.log(`[${elapsed}s] #${lineCount} assistant: ${JSON.stringify(msg).slice(0, 200)}`);
          }
        } else if (type === "user") {
          const content = msg.message?.content;
          const isReplay = msg.isReplay;
          const preview = typeof content === "string" ? content.slice(0, 200) : JSON.stringify(content).slice(0, 200);
          console.log(`[${elapsed}s] #${lineCount} USER [isReplay=${isReplay}]: ${preview}`);
        } else if (type === "control_request") {
          console.log(`[${elapsed}s] #${lineCount} CONTROL_REQ: ${JSON.stringify(msg).slice(0, 300)}`);
        } else {
          console.log(`[${elapsed}s] #${lineCount} ${type}${subtype ? `:${subtype}` : ""}: ${JSON.stringify(msg).slice(0, 200)}`);
        }
      } catch {
        console.log(`[${elapsed}s] #${lineCount} RAW: ${line.slice(0, 200)}`);
      }
    }

    lineEnd = buffer.indexOf("\n");
  }
}
