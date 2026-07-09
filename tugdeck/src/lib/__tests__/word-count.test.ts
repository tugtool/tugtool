/**
 * word-count.test.ts — proves `wordCountDelta` (incremental, O(change))
 * agrees with `countWords` (brute force) across thousands of random real
 * CM6 edits, plus targeted boundary cases.
 */

import { describe, test, expect } from "bun:test";
import { EditorState, type ChangeSpec } from "@codemirror/state";
import { countWords, wordCountDelta } from "../word-count";

/** Deterministic LCG so a failure is reproducible from the seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Apply `changes` to `doc`, returning the new doc string and the delta. */
function applyAndDelta(
  doc: string,
  changes: ChangeSpec,
): { next: string; delta: number } {
  const state = EditorState.create({ doc });
  const tr = state.update({ changes });
  const delta = wordCountDelta(tr.changes, tr.startState.doc, tr.state.doc);
  return { next: tr.state.doc.toString(), delta };
}

/** Characters an edit may insert — a realistic non-space / space mix. */
const ALPHABET = "aZ .\n\t,";

describe("wordCountDelta", () => {
  test("single random edits stay exact over a long run", () => {
    const rand = rng(0x1234);
    let doc = "the quick brown fox\njumps over the lazy dog";
    let running = countWords(doc);

    for (let step = 0; step < 4000; step++) {
      const len = doc.length;
      const from = Math.floor(rand() * (len + 1));
      let changes: ChangeSpec;
      if (rand() < 0.5 || len === 0) {
        // Insert 1–4 chars.
        const n = 1 + Math.floor(rand() * 4);
        let insert = "";
        for (let i = 0; i < n; i++) {
          insert += ALPHABET[Math.floor(rand() * ALPHABET.length)];
        }
        changes = { from, to: from, insert };
      } else {
        // Delete 1–4 chars.
        const to = Math.min(len, from + 1 + Math.floor(rand() * 4));
        changes = { from, to };
      }

      const { next, delta } = applyAndDelta(doc, changes);
      running += delta;
      expect(running).toBe(countWords(next));
      doc = next;
    }
  });

  test("multi-change transactions (disjoint ranges) stay exact", () => {
    const rand = rng(0xbeef);
    let doc = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    let running = countWords(doc);

    for (let step = 0; step < 2000; step++) {
      const len = doc.length;
      if (len < 8) {
        doc = "alpha beta gamma delta epsilon";
        running = countWords(doc);
        continue;
      }
      // Two disjoint, sorted changes in one transaction.
      const a = Math.floor(rand() * (len / 2));
      const b = Math.floor(len / 2) + Math.floor(rand() * (len / 2));
      const changes: ChangeSpec = [
        { from: a, to: Math.min(a + 1, Math.floor(len / 2)), insert: rand() < 0.5 ? "X " : "" },
        { from: b, to: Math.min(b + 1, len), insert: rand() < 0.5 ? " Y" : "" },
      ];
      const { next, delta } = applyAndDelta(doc, changes);
      running += delta;
      expect(running).toBe(countWords(next));
      doc = next;
    }
  });

  test("boundary cases", () => {
    const cases: Array<{ doc: string; changes: ChangeSpec }> = [
      // Split a word by inserting a space in the middle.
      { doc: "foobar", changes: { from: 3, to: 3, insert: " " } },
      // Merge two words by deleting the space between.
      { doc: "foo bar", changes: { from: 3, to: 4 } },
      // Insert at the very start / end.
      { doc: "word", changes: { from: 0, to: 0, insert: "new " } },
      { doc: "word", changes: { from: 4, to: 4, insert: " tail" } },
      // Whitespace-only edits.
      { doc: "a   b", changes: { from: 1, to: 4 } },
      { doc: "ab", changes: { from: 1, to: 1, insert: "\n\t " } },
      // Empty doc → insert; full delete → empty.
      { doc: "", changes: { from: 0, to: 0, insert: "hello world" } },
      { doc: "hello world", changes: { from: 0, to: 11 } },
      // Newlines count like any whitespace.
      { doc: "a\nb\nc", changes: { from: 1, to: 2, insert: " " } },
    ];
    for (const { doc, changes } of cases) {
      const { next, delta } = applyAndDelta(doc, changes);
      expect(countWords(doc) + delta).toBe(countWords(next));
    }
  });
});
