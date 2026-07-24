/**
 * session-tag.test.ts — pure-logic coverage for mnemonic-tag minting.
 *
 * Row filtering lives with the list that does it — see
 * `session-picker-data-source.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { mintTag } from "../session-tag";
import { TAG_ADJECTIVES, TAG_NOUNS } from "../session-tag-lexicon";

/** Deterministic rng returning each value in `values` in turn (then repeating). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** rng fraction that floors to lexicon index `i` in a pool of length `len`. */
const frac = (i: number, len: number): number => (i + 0.5) / len;

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

