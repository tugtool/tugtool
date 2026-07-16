/**
 * session-tag.test.ts — pure-logic coverage for mnemonic-tag minting and the
 * `/resume` filter predicate.
 */

import { describe, expect, test } from "bun:test";
import type { SessionRow } from "@/protocol";
import { mintTag, matchesTagQuery } from "../session-tag";
import { TAG_ADJECTIVES, TAG_NOUNS } from "../session-tag-lexicon";

/** Deterministic rng returning each value in `values` in turn (then repeating). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** rng fraction that floors to lexicon index `i` in a pool of length `len`. */
const frac = (i: number, len: number): number => (i + 0.5) / len;

function row(over: Partial<SessionRow>): SessionRow {
  return {
    session_id: "s1",
    workspace_key: "ws",
    project_dir: "/p",
    created_at: 0,
    last_used_at: 0,
    turn_count: 0,
    last_user_prompt: null,
    state: "closed",
    card_id: null,
    name: null,
    name_user_set: false,
    tag: null,
    origin: "tug",
    terminal_live: null,
    ...over,
  };
}

describe("mintTag", () => {
  test("mints a grammar-valid adjective-noun tag", () => {
    for (let i = 0; i < 50; i++) {
      expect(mintTag(new Set())).toMatch(/^[a-z]{4,6}-[a-z]{4,5}$/);
    }
  });

  test("re-rolls away from a known tag", () => {
    const A = TAG_ADJECTIVES.length;
    const N = TAG_NOUNS.length;
    const first = `${TAG_ADJECTIVES[0]}-${TAG_NOUNS[0]}`;
    const second = `${TAG_ADJECTIVES[1]}-${TAG_NOUNS[0]}`;
    // First roll lands on `first` (in `known`) → re-roll → `second`.
    const rng = seqRng([frac(0, A), frac(0, N), frac(1, A), frac(0, N)]);
    expect(mintTag(new Set([first]), rng)).toBe(second);
  });

  test("returns the last candidate when every re-roll collides", () => {
    const A = TAG_ADJECTIVES.length;
    const N = TAG_NOUNS.length;
    const only = `${TAG_ADJECTIVES[0]}-${TAG_NOUNS[0]}`;
    // rng always yields index 0 → every candidate is `only`; the cap is hit and
    // the colliding candidate is returned for the ledger to suffix.
    const rng = seqRng([frac(0, A), frac(0, N)]);
    expect(mintTag(new Set([only]), rng)).toBe(only);
  });
});

describe("matchesTagQuery", () => {
  test("empty / whitespace query matches every row", () => {
    expect(matchesTagQuery(row({}), "")).toBe(true);
    expect(matchesTagQuery(row({}), "   ")).toBe(true);
  });

  test("matches tag, name, and prompt substrings case-insensitively", () => {
    const r = row({
      tag: "azure-heron",
      name: "My Refactor",
      last_user_prompt: "fix the parser bug",
    });
    expect(matchesTagQuery(r, "HERON")).toBe(true);
    expect(matchesTagQuery(r, "refactor")).toBe(true);
    expect(matchesTagQuery(r, "parser")).toBe(true);
  });

  test("rejects a non-match and tolerates null fields", () => {
    const r = row({ tag: "azure-heron", name: null, last_user_prompt: null });
    expect(matchesTagQuery(r, "coral")).toBe(false);
  });
});
