/**
 * word-count.ts — word counting for the Text card status bar.
 *
 * A "word" is a maximal run of non-whitespace, so the word count equals
 * the number of *word-start* positions: an index `i` whose character is
 * non-whitespace and whose predecessor is whitespace (or the document
 * start). Counting starts, not runs, is what makes an incremental update
 * exact and local.
 *
 * `countWords` is the O(n) full count — used once when a document opens.
 * `wordCountDelta` maintains it in **O(total change size)** per edit: a
 * CM6 change to range `[from, to)` can only flip the word-start status
 * of positions in `[from, to + 1)` (a position's status depends on its
 * own char and its predecessor's), and content outside the changed
 * ranges is byte-identical between the old and new documents, so its
 * word-starts cancel. Summing `newWindowStarts − oldWindowStarts` over
 * the changed ranges is therefore the exact delta — no full re-scan,
 * even on a multi-megabyte file.
 *
 * No React, no DOM — pure functions over CM6 `Text` / `ChangeDesc`, so
 * the algorithm is unit-tested against the brute-force oracle.
 *
 * @module lib/word-count
 */

import type { ChangeDesc, Text } from "@codemirror/state";

/** Full word count of `text` — O(n). Used at open and as the oracle. */
export function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches === null ? 0 : matches.length;
}

/** Whether the character at `s[idx]` is whitespace (out-of-range = yes). */
function isWhitespaceAt(s: string, idx: number): boolean {
  const c = s[idx];
  return c === undefined || /\s/.test(c);
}

/**
 * Count word-start positions in `doc` over `[start, end)`. Reads one
 * extra leading character so a position's predecessor is available;
 * O(end − start).
 */
function wordStartsIn(doc: Text, start: number, end: number): number {
  if (start >= end) return 0;
  const from = Math.max(0, start - 1);
  const s = doc.sliceString(from, end);
  let count = 0;
  for (let i = start; i < end; i++) {
    // A word start: non-whitespace here, whitespace (or doc start) before.
    if (isWhitespaceAt(s, i - from)) continue;
    if (i === 0 || isWhitespaceAt(s, i - 1 - from)) count += 1;
  }
  return count;
}

/**
 * The change in word count produced by `changes` (from `oldDoc` to
 * `newDoc`). Add it to a running count. O(total change size): each
 * changed range only re-scans its own `[from, to + 1)` window in each
 * document.
 */
export function wordCountDelta(
  changes: ChangeDesc,
  oldDoc: Text,
  newDoc: Text,
): number {
  let delta = 0;
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    delta -= wordStartsIn(oldDoc, fromA, Math.min(toA + 1, oldDoc.length));
    delta += wordStartsIn(newDoc, fromB, Math.min(toB + 1, newDoc.length));
  });
  return delta;
}
