// Dead-branch detection, asserted as invariants rather than counts.
//
// The compaction re-append fix collapsed several sessions' dead sets to
// zero. So would an over-correction that stopped detecting rewinds
// altogether — both failure directions move the count the same way, so a
// count can't tell a rescue from a lobotomy. What separates them is what
// the dead set IS: the descendant closure of off-chain user submissions
// whose resolved parent is live, and nothing else.
//
// `validateDeadEntryInvariants` states that. This file runs it over the
// committed fixture (always) and over every real session in the local
// corpus (skipped when the corpus is absent, as on CI).

import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { computeDeadEntryIndices } from "../replay.ts";
import type { JsonlEntry } from "../replay.ts";
import {
  computeDeadEntryIndicesLastWins,
  validateDeadEntryInvariants,
} from "./dead-branch-walks.ts";

const FIXTURE = new URL(
  "./fixtures/compact-reappend/chain-topology.jsonl",
  import.meta.url,
).pathname;

/**
 * The local session corpus. Mirrors the skip pattern of
 * `turn_engine.rs`'s `reference_corpus_dir` — these sessions live
 * outside the repo, so the sweep is a local-only instrument.
 */
const CORPUS_DIR = join(
  homedir(),
  ".claude/projects/-Users-kocienda-Mounts-u-src-tugtool",
);

function corpusSessions(): string[] {
  try {
    if (!statSync(CORPUS_DIR).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(CORPUS_DIR, name));
}

function parseSession(text: string): JsonlEntry[] {
  const out: JsonlEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as JsonlEntry);
    } catch {
      // Malformed tail line — the replay path nulls these too.
    }
  }
  return out;
}

const fixtureEntries = parseSession(await Bun.file(FIXTURE).text());

describe("dead-set invariants on the compaction re-append fixture", () => {
  const entries = fixtureEntries;

  test("the shipped walk's dead set satisfies every invariant", () => {
    const dead = computeDeadEntryIndices(entries);
    const report = validateDeadEntryInvariants(entries, dead);
    expect(report.violations).toEqual([]);
    expect(report.deadRoots).toEqual([]);
    expect(report.deadCount).toBe(0);
    // Off-chain is not dead. 44 of the fixture's 1001 chain entries sit
    // off the strict ancestor chain — hook attachments, tool_result
    // records whose sibling carried the chain forward — and stay
    // visible. Having no dead roots is what makes them benign.
    expect(report.chainCount - report.liveCount).toBe(44);
  });

  test("the invariants reject the pre-fix walk's dead set", () => {
    // The validator has to be able to fail. The last-wins walk's dead
    // set contains entries that do not descend from any live-parented
    // off-chain submission under occurrence-aware resolution.
    const regressed = computeDeadEntryIndicesLastWins(entries);
    const report = validateDeadEntryInvariants(entries, regressed);
    expect(report.violations.length).toBeGreaterThan(0);
  });
});

const sessions = corpusSessions();

describe.if(sessions.length > 0)("dead-set invariants over the local corpus", () => {
  test(
    "every session's dead set satisfies every invariant",
    async () => {
      const violations: string[] = [];
      let nonEmptyDead = 0;
      const nonEmptyNames: string[] = [];
      let scanned = 0;

      for (const path of sessions) {
        const entries = parseSession(await Bun.file(path).text());
        if (entries.length === 0) continue;
        scanned++;
        const dead = computeDeadEntryIndices(entries);
        const report = validateDeadEntryInvariants(entries, dead);
        for (const v of report.violations) {
          violations.push(`${path.split("/").pop()}: ${v}`);
        }
        if (dead.size > 0) {
          nonEmptyDead++;
          nonEmptyNames.push(`${path.split("/").pop()} (${dead.size})`);
        }
      }

      console.log(
        `[dead-invariants] scanned ${scanned} sessions; ` +
          `${nonEmptyDead} with a non-empty dead set: ${nonEmptyNames.join(", ")}`,
      );

      expect(violations.slice(0, 10)).toEqual([]);
      expect(scanned).toBeGreaterThan(0);
      // Dead-branch detection must not go silent. Session ids stay out
      // of the assertion — they are private and churn — so the floor is
      // "at least one real rewind is still detected", with the exact
      // count logged above for a human to compare against the corpus.
      expect(nonEmptyDead).toBeGreaterThan(0);
    },
    600_000,
  );
});
