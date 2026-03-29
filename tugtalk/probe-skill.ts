#!/usr/bin/env bun
/**
 * Transport probe for skill invocation and permission handling.
 *
 * Usage:
 *   bun run tugtalk/probe-skill.ts "/cost"
 *   bun run tugtalk/probe-skill.ts "/status"
 *   bun run tugtalk/probe-skill.ts "/compact"
 *   bun run tugtalk/probe-skill.ts "any message"
 *
 * Handles control_request_forward (permission prompts) by auto-allowing.
 * Handles question events by printing and auto-answering with defaults.
 */

import { spawn } from "bun";

const PROJECT_DIR = "/Users/kocienda/Mounts/u/src/tugtool";
const message = Bun.argv[2] || "/status";
// Auto-deny permission requests if --deny flag passed
const autoDeny = Bun.argv.includes("--deny");

console.log(`=== Skill/Permission Probe ===`);
console.log(`Message: "${message}"`);
console.log(`Permission mode: ${autoDeny ? "auto-DENY" : "auto-ALLOW"}\n`);

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
  console.log(`>>> ${msg.type || JSON.stringify(msg)}`);
  proc.stdin.write(json);
}

let messageSent = false;
let partialCount = 0;
let startTime = 0;
let eventLog: string[] = [];

function logEvent(summary: string) {
  const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "0.0";
  const line = `[${elapsed}s] ${summary}`;
  eventLog.push(line);
  console.log(`<<< ${line}`);
}

setTimeout(() => {
  console.log("\n[timeout — 90s]");
  console.log("\n=== Event Summary ===");
  eventLog.forEach(l => console.log(`  ${l}`));
  proc.kill();
  process.exit(1);
}, 90_000);

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

        switch (type) {
          case "protocol_ack":
            logEvent(`protocol_ack (version=${msg.version}, ipc=${msg.ipc_version})`);
            break;

          case "session_init":
            logEvent(`session_init (session=${msg.session_id?.slice(0, 8)}...)`);
            if (!messageSent) {
              messageSent = true;
              startTime = Date.now();
              console.log(`\n--- Sending: "${message}" ---\n`);
              send({ type: "user_message", text: message, attachments: [] });
            }
            break;

          case "system_metadata":
            logEvent(`system_metadata (model=${msg.model}, tools=${msg.tools?.length}, slash_cmds=${msg.slash_commands?.length}, skills=${msg.skills?.length})`);
            break;

          case "thinking_text": {
            const preview = (msg.text || "").slice(0, 80);
            logEvent(`thinking_text [partial=${msg.is_partial}] "${preview}${msg.text?.length > 80 ? "..." : ""}"`);
            break;
          }

          case "assistant_text": {
            partialCount++;
            const len = (msg.text || "").length;
            if (msg.is_partial) {
              const preview = (msg.text || "").slice(0, 100);
              logEvent(`assistant_text #${partialCount} [partial, len=${len}] "${preview}${len > 100 ? "..." : ""}"`);
            } else {
              logEvent(`assistant_text #${partialCount} [COMPLETE, len=${len}]`);
              // Print the full final text
              console.log(`    FULL TEXT: "${(msg.text || "").slice(0, 500)}${(msg.text || "").length > 500 ? "..." : ""}"`);
            }
            break;
          }

          case "tool_use": {
            const inputKeys = Object.keys(msg.input || {});
            logEvent(`tool_use: ${msg.tool_name} [id=...${msg.tool_use_id?.slice(-8)}] input_keys=[${inputKeys.join(",")}]`);
            break;
          }

          case "tool_result": {
            const preview = (msg.output || "").slice(0, 150);
            logEvent(`tool_result [id=...${msg.tool_use_id?.slice(-8)}, error=${msg.is_error}] "${preview}${(msg.output || "").length > 150 ? "..." : ""}"`);
            break;
          }

          case "tool_use_structured": {
            const rtype = msg.structured_result?.type || "unknown";
            logEvent(`tool_use_structured [id=...${msg.tool_use_id?.slice(-8)}] type=${rtype}`);
            break;
          }

          case "control_request_forward": {
            logEvent(`PERMISSION REQUEST: tool=${msg.tool_name}, reason="${msg.decision_reason}", is_question=${msg.is_question}`);
            console.log(`    Full event: ${JSON.stringify(msg, null, 2)}`);
            const decision = autoDeny ? "deny" : "allow";
            console.log(`    >>> Auto-${decision.toUpperCase()}ING (request_id=${msg.request_id?.slice(0, 12)}...)`);
            // Respond using tool_approval format (tugtalk InboundMessage type)
            if (autoDeny) {
              send({
                type: "tool_approval",
                request_id: msg.request_id,
                decision: "deny",
                message: "Denied by probe script",
              });
            } else {
              send({
                type: "tool_approval",
                request_id: msg.request_id,
                decision: "allow",
                updatedInput: msg.input,
              });
            }
            break;
          }

          case "question": {
            logEvent(`QUESTION: request_id=${msg.request_id}`);
            console.log(`    Full event: ${JSON.stringify(msg, null, 2)}`);
            // Auto-answer with first option or empty
            if (msg.questions && msg.questions.length > 0) {
              const answers: Record<string, string> = {};
              for (const q of msg.questions) {
                const defaultAnswer = q.options?.[0]?.label || q.default || "yes";
                answers[q.id || q.question] = defaultAnswer;
                console.log(`    >>> Auto-answering "${q.question?.slice(0, 60)}" with "${defaultAnswer}"`);
              }
              send({ type: "question_answer", request_id: msg.request_id, answers });
            }
            break;
          }

          case "cost_update":
            logEvent(`cost_update: $${msg.total_cost_usd?.toFixed(4)} (${msg.num_turns} turns)`);
            break;

          case "turn_complete":
            logEvent(`turn_complete (result=${msg.result}, msg_id=${msg.msg_id?.slice(0, 8)}...)`);
            console.log("\n=== Event Summary ===");
            eventLog.forEach(l => console.log(`  ${l}`));
            console.log(`\nTotal: ${partialCount} text events`);
            proc.kill();
            process.exit(0);
            break;

          case "turn_cancelled":
            logEvent(`turn_cancelled: ${JSON.stringify(msg)}`);
            proc.kill();
            process.exit(0);
            break;

          default:
            logEvent(`${type}: ${JSON.stringify(msg)}`);
        }
      } catch {
        console.log(`<<< RAW: ${line}`);
      }
    }

    lineEnd = buffer.indexOf("\n");
  }
}
