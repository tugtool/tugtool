/**
 * `renderLineSegments` — merge Shiki syntax tokens with word-level
 * diff ranges into a flat list of decorated segments.
 *
 * The function walks the line text once, tracking the active syntax
 * style and the active word-level class. It emits a new segment
 * whenever either changes. Segments that fall inside both a syntax
 * token and a word-level range carry both decorations (the React
 * renderer applies the `style` and `className` to the same `<span>`).
 * Segments outside any token still get emitted with empty decoration
 * so the original text is preserved verbatim.
 *
 * The function is pure (no React, no DOM). The DiffBlock React
 * component wraps the output in `<span>` elements at render time.
 *
 * Complexity is `O(syntaxTokens.length + wordRanges.length)` per
 * line — bounded and predictable.
 *
 * @module lib/diff/render-line
 */

import type { SyntaxToken } from "./syntax-tokens-from-shiki";
import type { WordDiffSegment } from "./parse-unified-diff";

/**
 * One contiguous range within a line that carries a word-level
 * highlight class. Derived from a `WordDiffSegment[]` plus a side
 * (`"remove"` or `"add"`) via `wordRangesForSide`.
 */
export interface WordRange {
  /** Start offset in the line text (inclusive). */
  start: number;
  /** End offset in the line text (exclusive). */
  end: number;
  /**
   * The class name to apply. We hard-code the two valid values so
   * mistakes surface at the call site, not at render time.
   */
  className: "tugx-diff-word-add" | "tugx-diff-word-remove";
}

/**
 * One merged segment. `style` is the Shiki inline-style string (may
 * be empty); `className` is the word-level overlay class (may be
 * `null`). The renderer emits a `<span>` per segment.
 */
export interface RenderedSegment {
  text: string;
  style: string;
  className: string | null;
}

/**
 * Project a `WordDiffSegment[]` into a list of `WordRange`s for one
 * side of a paired remove/add. The "remove" side keeps `delete`
 * segments (with their before-text ranges); the "add" side keeps
 * `insert` segments (with their after-text ranges). `equal` segments
 * are not included — they're the unchanged background that needs no
 * highlight.
 */
export function wordRangesForSide(
  segments: readonly WordDiffSegment[],
  side: "remove" | "add",
): WordRange[] {
  const ranges: WordRange[] = [];
  for (const seg of segments) {
    if (side === "remove" && seg.tag === "delete") {
      ranges.push({
        start: seg.beforeStart,
        end: seg.beforeEnd,
        className: "tugx-diff-word-remove",
      });
    } else if (side === "add" && seg.tag === "insert") {
      ranges.push({
        start: seg.afterStart,
        end: seg.afterEnd,
        className: "tugx-diff-word-add",
      });
    }
  }
  return ranges;
}

/**
 * Walk `text` once, emitting segments at every (syntax-style,
 * word-class) boundary.
 *
 * Both inputs may be `null` / empty:
 *  - No syntax tokens, no word ranges → one plain segment for the
 *    whole line.
 *  - Syntax only → one segment per syntax token, no word class.
 *  - Word ranges only → segments split at range boundaries; style
 *    empty.
 *  - Both → segments split at the union of all boundaries; each
 *    segment carries both decorations where applicable.
 *
 * Tokens and ranges are assumed to be sorted by `start` and
 * non-overlapping within their own list (Shiki's output is naturally
 * non-overlapping; word-range derivation also preserves this).
 * Behavior with overlapping inputs within a list is undefined.
 */
export function renderLineSegments(
  text: string,
  syntaxTokens: readonly SyntaxToken[] | null,
  wordRanges: readonly WordRange[] | null,
): RenderedSegment[] {
  if (text.length === 0) return [];

  const tokens = syntaxTokens ?? [];
  const ranges = wordRanges ?? [];

  // Build the union of boundary positions. Set dedupes; a final sort
  // gives us the walk order. Always include 0 and text.length so the
  // walk covers the entire line even when both inputs are empty.
  const boundaries = new Set<number>();
  boundaries.add(0);
  boundaries.add(text.length);
  for (const t of tokens) {
    boundaries.add(clamp(t.start, 0, text.length));
    boundaries.add(clamp(t.end, 0, text.length));
  }
  for (const r of ranges) {
    boundaries.add(clamp(r.start, 0, text.length));
    boundaries.add(clamp(r.end, 0, text.length));
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  const result: RenderedSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start >= end) continue;
    const slice = text.slice(start, end);
    if (slice.length === 0) continue;
    const tok = findContainingToken(tokens, start, end);
    const range = findContainingRange(ranges, start, end);
    result.push({
      text: slice,
      style: tok?.style ?? "",
      className: range?.className ?? null,
    });
  }
  return result;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function findContainingToken(
  tokens: readonly SyntaxToken[],
  start: number,
  end: number,
): SyntaxToken | undefined {
  for (const t of tokens) {
    if (t.start <= start && end <= t.end) return t;
  }
  return undefined;
}

function findContainingRange(
  ranges: readonly WordRange[],
  start: number,
  end: number,
): WordRange | undefined {
  for (const r of ranges) {
    if (r.start <= start && end <= r.end) return r;
  }
  return undefined;
}
