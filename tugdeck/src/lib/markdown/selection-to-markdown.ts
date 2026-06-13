/**
 * `selection-to-markdown.ts` — the pure, DOM-free arithmetic behind
 * transcript COPY's markdown reconstruction.
 *
 * Copying a selection in an assistant row must yield honest, paste-able
 * markdown — not `Selection.toString()` plain text. An assistant row is
 * a heterogeneous *sequence* of top-level blocks (markdown prose, tool
 * calls, thinking), so reconstruction walks the selection across that
 * sequence and stitches per-block markdown. The DOM half (resolving a
 * live `Range` to the touched blocks + their source spans) lives in
 * `range-to-blocks.ts`; this module holds the two pieces that are pure
 * functions over data and therefore unit-testable without a DOM:
 *
 *  1. {@link sliceBlockRange} — given the source character spans of the
 *     markdown blocks a selection touched *within one message*, return
 *     the source slice covering them. Block-level attribution ([Q02]):
 *     a touched block contributes its whole `[startChar, endChar)`
 *     range, so the slice always re-parses to the same block structure
 *     (the round-trip invariant).
 *
 *  2. {@link stitchSelectionMarkdown} — join the touched tool sections
 *     and prose chunks into one document, mirroring
 *     `turnEntryToMarkdown`'s section model (tool sections first, then a
 *     single `## Response`-delimited prose body, the heading present
 *     only when tools also appear). Mirroring that model is what makes a
 *     whole-row selection reproduce the full-row COPY output exactly.
 *
 * Laws: [L07] the COPY handler samples live values inside the user
 * gesture; this module is the pure transform it calls — no state, no
 * DOM, no `Date`/`Math.random`.
 *
 * @module lib/markdown/selection-to-markdown
 */

/** A markdown block's source character range — `[start, end)`, JS string indices. */
export interface SourceSpan {
  /** Inclusive start char offset in the message's source text. */
  readonly start: number;
  /** Exclusive end char offset in the message's source text. */
  readonly end: number;
}

/**
 * Slice a message's source markdown for the contiguous run of blocks a
 * selection touched within that message. Block-level ([Q02]): the slice
 * spans from the earliest touched block's `start` to the latest's
 * `end`, so partial in-block selections widen to whole-block boundaries
 * and the result re-parses to the same blocks.
 *
 * Returns `""` for no spans or a degenerate range. Does not trim — the
 * stitch step trims the assembled prose so the spacing matches
 * `turnEntryToMarkdown`.
 */
export function sliceBlockRange(
  source: string,
  spans: ReadonlyArray<SourceSpan>,
): string {
  if (spans.length === 0) return "";
  let lo = Infinity;
  let hi = -Infinity;
  for (const span of spans) {
    if (span.start < lo) lo = span.start;
    if (span.end > hi) hi = span.end;
  }
  if (!(lo < hi)) return "";
  // Clamp defensively — a stale offset must never throw or read past
  // the source.
  const start = Math.max(0, Math.min(lo, source.length));
  const end = Math.max(start, Math.min(hi, source.length));
  return source.slice(start, end);
}

/**
 * Stitch the touched blocks of a selection into one markdown document,
 * mirroring `turnEntryToMarkdown`: tool sections first (in document
 * order), then the prose chunks joined into a single body, prefixed
 * with a `## Response` heading only when tool sections are also
 * present. A whole-row selection therefore reproduces the full-row COPY
 * output exactly, and a partial selection produces the same structure
 * scoped to what was touched.
 *
 * `toolSections` and `proseChunks` are already-serialized markdown
 * fragments in document order; empty fragments are dropped.
 */
export function stitchSelectionMarkdown(
  toolSections: ReadonlyArray<string>,
  proseChunks: ReadonlyArray<string>,
): string {
  const sections: string[] = toolSections.filter((s) => s.length > 0);
  const prose = proseChunks.join("\n\n").trim();
  if (prose.length > 0) {
    sections.push(sections.length > 0 ? `## Response\n\n${prose}` : prose);
  }
  return sections.join("\n\n");
}
