#!/usr/bin/env node
// Fake claude child for tugpulse stdio tests — speaks just enough
// stream-json: reads user-message lines on stdin, answers each with an
// immediate result frame. Deterministic replies:
//
//   - priming messages (they instruct "Reply with exactly: PASS") and
//     any digest mentioning "routine" → "PASS"
//   - everything else → "echo:<the digest's BEAT header>"
//
// No init frame timing games, no thinking, no tools — the daemon's
// driver only consumes `result` frames by sequence.

import { createInterface } from "node:readline";

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

out({ type: "system", subtype: "init", model: "fake-claude" });

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (line.trim().length === 0) return;
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  if (ev.type !== "user") return;
  const text = (ev.message?.content ?? [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  let reply;
  if (text.includes("Reply with exactly: PASS") || text.includes("routine")) {
    reply = "PASS";
  } else {
    const beatHeader = text.split("\n")[0] ?? "BEAT ?";
    reply = `echo:${beatHeader}`;
  }
  out({ type: "result", subtype: "success", result: reply });
});

rl.on("close", () => process.exit(0));
