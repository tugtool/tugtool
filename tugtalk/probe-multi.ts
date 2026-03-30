#!/usr/bin/env bun
/**
 * Multi-test transport probe. Runs a sequence of tests with labeled output.
 * Tests: tool approval, multiple tools, error cases.
 *
 * Usage: bun run tugtalk/probe-multi.ts <test-name>
 * Tests: approval, multi-tool, error, long-stream
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");
const testName = Bun.argv[2] || "approval";

const tests: Record<string, { message: string; description: string }> = {
  "approval": {
    message: "Run this bash command: echo 'hello from bash'",
    description: "Trigger a Bash tool call (may require approval depending on permission mode)",
  },
  "multi-tool": {
    message: "Read the first line of CLAUDE.md and the first line of package.json in tugdeck/. Tell me both.",
    description: "Multiple tool calls in one turn",
  },
  "error": {
    message: "Read the file /nonexistent/path/that/does/not/exist.txt",
    description: "Tool call that will fail",
  },
  "long-stream": {
    message: "Write exactly 300 words about the history of the internet. Count carefully.",
    description: "Longer streaming to measure event frequency",
  },
};

const test = tests[testName];
if (!test) {
  console.log(`Unknown test: ${testName}. Available: ${Object.keys(tests).join(", ")}`);
  process.exit(1);
}

console.log(`=== Probe: ${testName} ===`);
console.log(`${test.description}\n`);

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
  console.log(`>>> ${JSON.stringify(msg)}`);
  proc.stdin.write(json);
}

let messageSent = false;
let partialCount = 0;
let toolUseCount = 0;
let startTime = 0;

setTimeout(() => { console.log("\n[timeout]"); proc.kill(); process.exit(1); }, 120_000);

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
          const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "?";
          console.log(`<<< ${type} #${partialCount} [partial=${msg.is_partial}, status=${msg.status}, len=${len}] (${elapsed}s)`);
        } else if (type === "thinking_text") {
          const preview = (msg.text || "").slice(0, 100);
          console.log(`<<< ${type} [partial=${msg.is_partial}] "${preview}${msg.text?.length > 100 ? "..." : ""}"`);
        } else if (type === "system_metadata") {
          console.log(`<<< ${type} (omitted)`);
        } else if (type === "cost_update") {
          console.log(`<<< ${type}: $${msg.total_cost_usd?.toFixed(4)} (${msg.num_turns} turns)`);
        } else if (type === "tool_use") {
          toolUseCount++;
          const inputKeys = Object.keys(msg.input || {});
          console.log(`<<< ${type} #${toolUseCount}: ${msg.tool_name} [id=${msg.tool_use_id?.slice(-8)}] input_keys=[${inputKeys.join(",")}]`);
        } else if (type === "tool_result") {
          const preview = (msg.output || "").slice(0, 200);
          console.log(`<<< ${type} [id=${msg.tool_use_id?.slice(-8)}, error=${msg.is_error}]: "${preview}${msg.output?.length > 200 ? "..." : ""}"`);
        } else if (type === "tool_use_structured") {
          const resultType = msg.structured_result?.type || "unknown";
          console.log(`<<< ${type} [id=${msg.tool_use_id?.slice(-8)}]: result_type=${resultType}, keys=${JSON.stringify(Object.keys(msg.structured_result || {}))}`);
        } else if (type === "permission_request") {
          console.log(`<<< ${type}: ${JSON.stringify(msg)}`);
          // Auto-approve for testing
          console.log(">>> AUTO-APPROVING");
          send({ type: "tool_approval", request_id: msg.request_id, decision: "allow" });
        } else {
          console.log(`<<< ${type}: ${JSON.stringify(msg)}`);
        }

        if (type === "session_init" && !messageSent) {
          messageSent = true;
          startTime = Date.now();
          console.log(`\n--- Sending: "${test.message}" ---\n`);
          send({ type: "user_message", text: test.message, attachments: [] });
        }

        if (type === "turn_complete" || type === "turn_cancelled") {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`\n--- Done (${elapsed}s, ${partialCount} text events, ${toolUseCount} tool calls) ---`);
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
