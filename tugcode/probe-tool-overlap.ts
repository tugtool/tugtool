#!/usr/bin/env bun
/**
 * Raw tool-turn overlap probe — bypasses tugcode entirely.
 *
 * Spawns claude directly, starts a turn that does several tool calls
 * (file reads, one at a time), then injects a plain user message
 * mid-tool-work — after the 2nd tool_use begins. Tests whether claude
 * consumes a buffered stdin message at an agent-loop *iteration*
 * boundary (between tool calls), or strictly after the turn's
 * `result`. The answer settles the D.5 queue-flush policy.
 *
 * `--permission-mode bypassPermissions` so read tool calls never
 * stall on an approval round-trip.
 */

import { spawn } from "bun";
import { resolve } from "path";

const PROJECT_DIR = resolve(import.meta.dir, "..");

const which = Bun.spawnSync({ cmd: ["which", "claude"] });
const claudePath = new TextDecoder().decode(which.stdout).trim();

const args = [
  claudePath,
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--permission-mode", "bypassPermissions",
  "--no-session-persistence",
];

console.log("=== Raw tool-turn overlap probe ===\n");

const proc = spawn({
  cmd: args,
  cwd: PROJECT_DIR,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

(async () => {
  const dec = new TextDecoder();
  for await (const chunk of proc.stderr) {
    for (const line of dec.decode(chunk, { stream: true }).split("\n").filter(Boolean)) {
      console.log(`  [stderr] ${line}`);
    }
  }
})();

function send(text: string) {
  const json =
    JSON.stringify({
      type: "user",
      session_id: "",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    }) + "\n";
  console.log(`\n>>> SEND: ${text}\n`);
  proc.stdin.write(json);
  proc.stdin.flush();
}

const startTime = Date.now();
let opened = false;
let injected = false;
let toolUses = 0;
let resultCount = 0;

setTimeout(() => {
  if (!opened) {
    opened = true;
    send(
      "Read these four files, one at a time, and give a one-line summary of each: " +
        "./CLAUDE.md, ./tugcode/package.json, ./tugdeck/package.json, ./tugrust/Cargo.toml. " +
        "Read them one by one, not in parallel.",
    );
  }
}, 1500);

setTimeout(() => {
  console.log("\n[timeout — 150s]");
  proc.kill();
  process.exit(1);
}, 150_000);

const dec = new TextDecoder();
let buffer = "";

for await (const chunk of proc.stdout) {
  buffer += dec.decode(chunk, { stream: true });
  let nl = buffer.indexOf("\n");
  while (nl >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line.length > 0) {
      const t = ((Date.now() - startTime) / 1000).toFixed(1);
      try {
        const msg = JSON.parse(line);
        const type = msg.type || "unknown";
        const subtype = msg.subtype || "";
        if (type === "system" && subtype === "init") {
          console.log(`<<< [${t}s] system:init`);
        } else if (type === "stream_event") {
          const ev = msg.event || {};
          const delta = ev.delta;
          if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
            toolUses++;
            console.log(`<<< [${t}s] tool_use START #${toolUses}: ${ev.content_block?.name}`);
            if (toolUses === 2 && !injected) {
              injected = true;
              console.log("\n--- 2nd tool call begun; injecting plain message mid-tool-work ---");
              send("ALSO, as a completely separate question: what is 2 plus 2?");
            }
          } else if (delta?.type === "text_delta") {
            const snip = (delta.text || "").slice(0, 50).replace(/\n/g, "⏎");
            console.log(`<<< [${t}s] text_delta (${(delta.text || "").length}c) "${snip}"`);
          } else if (delta?.type === "thinking_delta") {
            console.log(`<<< [${t}s] thinking_delta`);
          } else if (ev.type === "message_start" || ev.type === "message_stop") {
            console.log(`<<< [${t}s] stream:${ev.type}`);
          }
        } else if (type === "assistant") {
          const blocks = msg.message?.content || [];
          const kinds = blocks
            .map((b: { type?: string; name?: string }) => (b.type === "tool_use" ? `tool_use:${b.name}` : b.type))
            .join(",");
          console.log(`<<< [${t}s] assistant snapshot [${kinds}]`);
        } else if (type === "user") {
          const blocks = msg.message?.content || [];
          const kinds = blocks.map((b: { type?: string }) => b.type).join(",");
          console.log(`<<< [${t}s] user msg [${kinds}]`);
        } else if (type === "result") {
          resultCount++;
          console.log(`<<< [${t}s] result #${resultCount}: subtype=${subtype}, num_turns=${msg.num_turns}`);
          console.log(`    result text: ${JSON.stringify(msg.result || "").slice(0, 260)}`);
          if (resultCount >= 2) {
            console.log("\n--- two results seen ---");
            proc.kill();
            process.exit(0);
          }
        } else {
          console.log(`<<< [${t}s] ${type}${subtype ? ":" + subtype : ""}: ${JSON.stringify(msg).slice(0, 160)}`);
        }
      } catch {
        console.log(`<<< [${t}s] RAW: ${line.slice(0, 160)}`);
      }
    }
    nl = buffer.indexOf("\n");
  }
}
