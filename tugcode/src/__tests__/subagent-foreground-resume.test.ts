/**
 * subagent-foreground-resume.test.ts — FOREGROUND-agent children restore
 * on resume.
 *
 * A foreground (synchronous) `Agent` streams its child tool calls live,
 * but the main JSONL persists only the `Agent` `tool_use` and its final
 * `tool_result` / `toolUseResult` — the children live only in the
 * out-of-band `subagents/` transcript, exactly like a background
 * agent's (verified on claude 2.1.198). The splice therefore covers
 * every parent with a transcript, not just async launches; before that
 * a `Maker ▸ Reload` silently lost every foreground child block the
 * live stream had shown.
 *
 * Fixture: `fixtures/subagent-foreground/` — a trimmed slice of a real
 * captured session (a foreground `Explore` run): the real `main.jsonl`
 * (with its completed, content-bearing `toolUseResult` echo), a trimmed
 * real `agent-<agentId>.jsonl` (2 tool calls + the final answer), and
 * the verbatim `.meta.json`. Real content, real code paths.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { OutboundMessage } from "../types.ts";
import { readSubagentTranscripts } from "../session.ts";
import { translateJsonlSession, type SubagentTranscript } from "../replay.ts";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "subagent-foreground");

/** The launching `Agent` `tool_use.id` recorded in the real `.meta.json`. */
const PARENT_TOOL_USE_ID = "toolu_01F6aw6zgkaBtEk4KhLMECuj";

async function replayFrames(
  jsonl: string,
  subagents: SubagentTranscript[],
): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "150fbf15", subagents },
    { disableYield: true },
  )) {
    out.push(m);
  }
  return out;
}

describe("foreground-agent resume splice", () => {
  test("splices the children mid-turn and keeps the REAL structured result", async () => {
    const jsonl = await Bun.file(join(FIXTURE_DIR, "main.jsonl")).text();
    const subagents = await readSubagentTranscripts(FIXTURE_DIR);
    expect(subagents).toHaveLength(1);
    expect(subagents[0].meta.toolUseId).toBe(PARENT_TOOL_USE_ID);

    const frames = await replayFrames(jsonl, subagents);

    // Children are spliced, parent-stamped, and INSIDE the turn bracket
    // (after the parent tool_use, before turn_complete) so the reducer
    // attaches them to the committed turn.
    const parentIdx = frames.findIndex(
      (f) => f.type === "tool_use" && f.tool_use_id === PARENT_TOOL_USE_ID,
    );
    const turnCompleteIdx = frames.findIndex((f) => f.type === "turn_complete");
    expect(parentIdx).toBeGreaterThan(-1);
    const children = frames.filter(
      (f) =>
        f.type === "tool_use" &&
        (f as { parent_tool_use_id?: string }).parent_tool_use_id ===
          PARENT_TOOL_USE_ID,
    );
    expect(children.length).toBeGreaterThanOrEqual(2);
    for (const child of children) {
      const idx = frames.indexOf(child);
      expect(idx).toBeGreaterThan(parentIdx);
      expect(idx).toBeLessThan(turnCompleteIdx);
    }

    // The parent's structured result: the REAL completed payload from
    // the main JSONL must be the LAST writer (last-write-wins in the
    // reducer), so the foreground agent's genuine content + stats
    // survive the splice's composed frame.
    const structured = frames.filter(
      (f) =>
        f.type === "tool_use_structured" &&
        f.tool_use_id === PARENT_TOOL_USE_ID,
    );
    expect(structured.length).toBeGreaterThanOrEqual(1);
    const last = structured[structured.length - 1] as {
      structured_result: Record<string, unknown>;
    };
    // The real echo carries the full result fields the composed shape
    // never fabricates (toolStats / usage / resolvedModel).
    expect(last.structured_result.toolStats).toBeDefined();
    expect(last.structured_result.status).toBe("completed");
  });

  test("windowed-out parents still splice nothing (no orphan children)", async () => {
    // Sanity guard: with no subagents supplied, the same replay yields
    // zero parent-stamped children — the splice keys strictly off the
    // transcripts map.
    const jsonl = await Bun.file(join(FIXTURE_DIR, "main.jsonl")).text();
    const frames = await replayFrames(jsonl, []);
    expect(
      frames.some(
        (f) =>
          f.type === "tool_use" &&
          (f as { parent_tool_use_id?: string }).parent_tool_use_id ===
            PARENT_TOOL_USE_ID,
      ),
    ).toBe(false);
  });
});
