#!/usr/bin/env bun
// Projects a slice of a real Claude session JSONL down to the chain
// topology `computeDeadEntryIndices` reads, so a multi-MB session can be
// committed as a fixture.
//
// The projection keeps every field the walk consults — `uuid`,
// `parentUuid`, `type`, `subtype`, `isSidechain`, `isCompactSummary`,
// `isMeta`, and the shape of `message.content` (block `type`s, or a
// clipped string) — in real file order, with real uuids. Everything else
// (tool payloads, prose, cwd/version bookkeeping) is dropped.
//
// Usage:
//   bun run project-session.ts <source.jsonl> <startIndex> <count> > out.jsonl
//
// `chain-topology.jsonl` was produced from session
// 8b8d7bf1-5d25-4b2d-95de-ee1ccba71d42 with start 3870, count 1211 — the
// span covering that session's second compaction and its verbatim
// re-append block.

export {};

const CONTENT_CLIP = 120;

interface SourceEntry {
  type?: unknown;
  uuid?: unknown;
  parentUuid?: unknown;
  subtype?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  isCompactSummary?: unknown;
  timestamp?: unknown;
  message?: { role?: unknown; content?: unknown };
}

function projectContent(content: unknown): unknown {
  if (typeof content === "string") return content.slice(0, CONTENT_CLIP);
  if (Array.isArray(content)) {
    return content.map((block) => ({
      type: (block as { type?: unknown } | null)?.type,
    }));
  }
  return content;
}

function project(entry: SourceEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { type: entry.type };
  if (typeof entry.uuid === "string") out.uuid = entry.uuid;
  if (entry.parentUuid !== undefined) out.parentUuid = entry.parentUuid;
  if (entry.subtype !== undefined) out.subtype = entry.subtype;
  if (entry.isSidechain === true) out.isSidechain = true;
  if (entry.isMeta === true) out.isMeta = true;
  if (entry.isCompactSummary === true) out.isCompactSummary = true;
  if (entry.timestamp !== undefined) out.timestamp = entry.timestamp;
  if (entry.message !== undefined && entry.message !== null) {
    out.message = {
      role: entry.message.role,
      content: projectContent(entry.message.content),
    };
  }
  return out;
}

const [sourcePath, startArg, countArg] = process.argv.slice(2);
if (sourcePath === undefined) {
  console.error("usage: project-session.ts <source.jsonl> [startIndex] [count]");
  process.exit(2);
}

const lines = (await Bun.file(sourcePath).text())
  .split("\n")
  .filter((line) => line.trim().length > 0);

const start = startArg === undefined ? 0 : Number(startArg);
const count = countArg === undefined ? lines.length - start : Number(countArg);

const projected = lines
  .slice(start, start + count)
  .map((line) => JSON.stringify(project(JSON.parse(line) as SourceEntry)));

process.stdout.write(projected.join("\n") + "\n");
