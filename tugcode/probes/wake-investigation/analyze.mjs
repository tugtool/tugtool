#!/usr/bin/env bun
// Analyze a probe capture: summarize every stream-json event tugcode would
// see on claude's stdout, with special attention to the window around the
// harness's scheduled-task fire.
//
// Usage: bun analyze.mjs <BASE>
// where <BASE> is the prefix (e.g. capture-sw-60-2026-05-25T14-25-36-113Z).

import { readFileSync } from "node:fs";

const BASE = process.argv[2];
if (!BASE) {
  console.error("usage: analyze.mjs <capture-base>");
  process.exit(2);
}

const dir = "/Users/kocienda/Mounts/u/src/tugtool/tugcode/probes/wake-investigation";
const stdoutPath = `${dir}/${BASE}.stdout`;
const jsonlPath = `${dir}/${BASE}.jsonl`;

const stdoutRaw = readFileSync(stdoutPath, "utf8");
let jsonlRaw = "";
try {
  jsonlRaw = readFileSync(jsonlPath, "utf8");
} catch {
  // jsonl may not be copied yet (mid-run).
}

const stdoutEvents = [];
for (const line of stdoutRaw.split("\n")) {
  if (!line) continue;
  const tab = line.indexOf("\t");
  if (tab < 0) continue;
  const t = line.slice(0, tab);
  const raw = line.slice(tab + 1);
  try {
    const ev = JSON.parse(raw);
    stdoutEvents.push({ t, ev });
  } catch {
    stdoutEvents.push({ t, raw });
  }
}

const jsonlEvents = [];
if (jsonlRaw) {
  for (const line of jsonlRaw.split("\n")) {
    if (!line) continue;
    try {
      jsonlEvents.push(JSON.parse(line));
    } catch {}
  }
}

console.log(`=== ${BASE} ===`);
console.log(
  `stdout events: ${stdoutEvents.length} | jsonl events: ${jsonlEvents.length}`,
);

// Find the harness fire timestamp in the JSONL (queue-operation enqueue
// with isMeta on the dequeued user_message).
const harnessFire = jsonlEvents.find(
  (d) => d.type === "user" && d.isMeta === true,
);
if (harnessFire) {
  console.log(
    `\nHARNESS FIRE (JSONL): timestamp=${harnessFire.timestamp} content=${JSON.stringify(harnessFire.message?.content)?.slice(0, 80)}`,
  );
} else {
  console.log(`\nHARNESS FIRE: not found in JSONL`);
}

// Distill stdout events: type, subtype, and a one-line summary.
console.log(`\n=== STDOUT EVENTS (tugcode's view) ===`);
for (const { t, ev, raw } of stdoutEvents) {
  if (raw !== undefined) {
    console.log(`${t.slice(11)} (non-JSON): ${raw.slice(0, 80)}`);
    continue;
  }
  const type = ev.type ?? "?";
  const subtype = ev.subtype ?? "";
  let detail = "";
  if (type === "stream_event") {
    const innerType = ev.event?.type ?? "";
    const blockType = ev.event?.content_block?.type ?? "";
    const deltaType = ev.event?.delta?.type ?? "";
    detail = `event_type=${innerType}` +
      (blockType ? ` block=${blockType}` : "") +
      (deltaType ? ` delta=${deltaType}` : "");
  } else if (type === "assistant") {
    const id = ev.message?.id ?? "";
    const content = ev.message?.content ?? [];
    const blocks = content
      .map((b) => {
        if (b.type === "text") return `text:"${(b.text ?? "").slice(0, 40)}"`;
        if (b.type === "tool_use") return `tool_use:${b.name}`;
        if (b.type === "thinking") return "thinking";
        return b.type;
      })
      .join(" | ");
    detail = `mid=${id.slice(-12)} ${blocks}`;
  } else if (type === "user") {
    const isMeta = ev.isMeta ?? false;
    const origin = ev.origin?.kind ?? "";
    const isSynthetic = ev.isSynthetic ?? false;
    const isReplay = ev.isReplay ?? false;
    const content = ev.message?.content;
    let summary = "";
    if (typeof content === "string") summary = `text="${content.slice(0, 50)}"`;
    else if (Array.isArray(content)) {
      summary = content
        .map((b) => (b.type === "text" ? `text:"${(b.text ?? "").slice(0, 30)}"` : b.type))
        .join(" | ");
    }
    detail = `isMeta=${isMeta} isSyn=${isSynthetic} isReplay=${isReplay} origin=${origin} ${summary}`;
  } else if (type === "result") {
    detail = `sub=${subtype} cost=${ev.total_cost_usd}`;
  } else if (type === "system") {
    detail = `sub=${subtype}`;
  } else {
    detail = JSON.stringify(ev).slice(0, 100);
  }
  console.log(`${t.slice(11)} ${type}${subtype ? `/${subtype}` : ""}: ${detail}`);
}
