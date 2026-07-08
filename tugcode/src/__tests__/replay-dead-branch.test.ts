// Chain-aware replay — dead-branch exclusion.
//
// Claude's session JSONL is an append-only `parentUuid` tree. History
// edits abandon entries rather than removing them: the REPL's
// pre-response Escape leaves the aborted prompt as an orphan, and a
// conversation rewind (`/rewind`, `--resume-session-at`) strands
// everything after the branch point as a dead branch. Claude resumes by
// walking the chain from the newest leaf, so dead entries never re-enter
// its context — but a flat replay scan repaints them as phantom turns.
// `computeDeadEntryIndices` computes the same live set claude uses;
// `translateJsonlSession` nulls the dead entries before translation.

import { describe, expect, test } from "bun:test";

import {
  computeDeadEntryIndices,
  translateJsonlSession,
} from "../replay.ts";
import type { JsonlEntry } from "../replay.ts";
import type { OutboundMessage } from "../types.ts";

async function collectSession(jsonl: string): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-dead-branch" },
    { disableYield: true },
  )) {
    out.push(m);
  }
  return out;
}

function userMessages(out: OutboundMessage[]): string[] {
  return out
    .filter((m) => m.type === "add_user_message")
    .map((m) =>
      (m as { content: Array<{ type: string; text?: string }> }).content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join(""),
    );
}

const user = (uuid: string, parent: string | null, text: string): JsonlEntry =>
  ({
    type: "user",
    uuid,
    parentUuid: parent,
    permissionMode: "auto",
    message: { role: "user", content: [{ type: "text", text }] },
  }) as JsonlEntry;

const assistant = (
  uuid: string,
  parent: string | null,
  msgId: string,
  text: string,
): JsonlEntry =>
  ({
    type: "assistant",
    uuid,
    parentUuid: parent,
    message: {
      id: msgId,
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
    },
  }) as JsonlEntry;

const compactBoundary = (uuid: string): JsonlEntry =>
  ({ type: "system", subtype: "compact_boundary", uuid, parentUuid: null }) as JsonlEntry;

const compactSummary = (uuid: string, parent: string): JsonlEntry =>
  ({
    type: "user",
    uuid,
    parentUuid: parent,
    isCompactSummary: true,
    message: { role: "user", content: "This session is being continued…" },
  }) as JsonlEntry;

const toJsonl = (entries: ReadonlyArray<JsonlEntry>): string =>
  entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

describe("computeDeadEntryIndices", () => {
  test("a linear chain has no dead entries", () => {
    const entries = [
      user("u1", null, "ALPHA?"),
      assistant("a1", "u1", "m1", "ALPHA"),
      user("u2", "a1", "BRAVO?"),
      assistant("a2", "u2", "m2", "BRAVO"),
    ];
    expect(computeDeadEntryIndices(entries).size).toBe(0);
  });

  test("a rewind branch strands the abandoned turn", () => {
    // BRAVO was rewound away: CHARLIE parents to ALPHA's assistant.
    const entries = [
      user("u1", null, "ALPHA?"),
      assistant("a1", "u1", "m1", "ALPHA"),
      user("u2", "a1", "BRAVO?"),
      assistant("a2", "u2", "m2", "BRAVO"),
      user("u3", "a1", "CHARLIE?"),
      assistant("a3", "u3", "m3", "CHARLIE"),
    ];
    expect([...computeDeadEntryIndices(entries)].sort()).toEqual([2, 3]);
  });

  test("a null-parent orphan root is NOT dead (indistinguishable from a restart segment)", () => {
    // A REPL-escape orphan and a session-restart root are structurally
    // identical (a null-parent user submission mid-file), so the
    // analyzer must not kill either — restart segments are live
    // history. The orphan keeps flat parity; only live-parented branch
    // points (a rewind's shape) die.
    const entries = [
      user("u1", null, "fat-fingered"),
      user("u2", null, "the real message"),
      assistant("a2", "u2", "m2", "answer"),
    ];
    expect(computeDeadEntryIndices(entries).size).toBe(0);
  });

  test("the live walk bridges a /compact break — pre-compaction history stays live", () => {
    const entries = [
      user("u1", null, "ALPHA?"),
      assistant("a1", "u1", "m1", "ALPHA"),
      compactBoundary("cb1"),
      compactSummary("cs1", "cb1"),
      user("u2", "cs1", "BRAVO?"),
      assistant("a2", "u2", "m2", "BRAVO"),
    ];
    expect(computeDeadEntryIndices(entries).size).toBe(0);
  });

  test("a dead branch in a pre-compaction segment is still excluded", () => {
    const entries = [
      user("u1", null, "ALPHA?"),
      assistant("a1", "u1", "m1", "ALPHA"),
      user("u2", "a1", "abandoned"),
      assistant("a2", "u2", "m2", "abandoned answer"),
      user("u3", "a1", "BRAVO?"),
      assistant("a3", "u3", "m3", "BRAVO"),
      compactBoundary("cb1"),
      compactSummary("cs1", "cb1"),
      user("u4", "cs1", "CHARLIE?"),
      assistant("a4", "u4", "m4", "CHARLIE"),
    ];
    expect([...computeDeadEntryIndices(entries)].sort()).toEqual([2, 3]);
  });

  test("sidechain entries are exempt even when off the main chain", () => {
    const entries = [
      user("u1", null, "ALPHA?"),
      { ...user("sc1", null, "sidechain prompt"), isSidechain: true } as JsonlEntry,
      {
        ...assistant("sc2", "sc1", "mS", "sidechain answer"),
        isSidechain: true,
      } as JsonlEntry,
      assistant("a1", "u1", "m1", "ALPHA"),
    ];
    expect(computeDeadEntryIndices(entries).size).toBe(0);
  });

  test("entries without uuid (bookkeeping) are never dead", () => {
    const entries = [
      user("u1", null, "ALPHA?"),
      { type: "last-prompt" } as JsonlEntry,
      { type: "queue-operation" } as JsonlEntry,
      assistant("a1", "u1", "m1", "ALPHA"),
    ];
    expect(computeDeadEntryIndices(entries).size).toBe(0);
  });
});

describe("translateJsonlSession dead-branch exclusion", () => {
  test("a rewound-away turn does not replay; live turns do", async () => {
    const out = await collectSession(
      toJsonl([
        user("u1", null, "ALPHA?"),
        assistant("a1", "u1", "m1", "ALPHA"),
        user("u2", "a1", "BRAVO?"),
        assistant("a2", "u2", "m2", "BRAVO"),
        user("u3", "a1", "CHARLIE?"),
        assistant("a3", "u3", "m3", "CHARLIE"),
      ]),
    );
    expect(userMessages(out)).toEqual(["ALPHA?", "CHARLIE?"]);
  });

  test("a session-restart segment (null-parent root mid-file) replays in full", async () => {
    const out = await collectSession(
      toJsonl([
        user("u1", null, "first launch"),
        assistant("a1", "u1", "m1", "answer one"),
        user("u2", null, "after restart"),
        assistant("a2", "u2", "m2", "answer two"),
      ]),
    );
    expect(userMessages(out)).toEqual(["first launch", "after restart"]);
  });

  test("uuid-less fixtures (legacy shape) replay unchanged", async () => {
    // Entries with no uuid never participate in the chain walk — the
    // interrupted-orphan never-drop shape is preserved.
    const out = await collectSession(
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "hello" }] },
        }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "what time is it?" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            id: "mX",
            role: "assistant",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "It's 6 PM" }],
          },
        }),
      ].join("\n") + "\n",
    );
    expect(userMessages(out)).toEqual(["hello", "what time is it?"]);
  });
});
