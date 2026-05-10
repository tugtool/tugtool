/**
 * Parse Shiki's per-line HTML output into a flat array of
 * `[start, end)` token ranges with their inline-style strings.
 *
 * Shiki emits each line as a `<span class="line">` containing one or
 * more `<span style="color:...; font-style:...">…</span>` token
 * spans. For the diff renderer we want those tokens as character
 * ranges over the *original* line text, so we can merge them with
 * word-level diff ranges in `render-line.ts` without losing either
 * decoration.
 *
 * This module ships only the parser. `<DiffBlock>` invokes Shiki's
 * `codeToHtml` itself (reusing the shared singleton from
 * `code-block-utils.ts`) and feeds the per-line HTML in. Keeping the
 * parser separate keeps it pure and easy to test.
 *
 * Shape note: Shiki uses inline `style="..."` rather than CSS classes.
 * Decorations on each token are therefore inline-style strings; the
 * renderer applies them via the React `style` attribute. The
 * word-level overlay continues to use CSS classes — both decorations
 * compose naturally on the same `<span>`.
 *
 * @module lib/diff/syntax-tokens-from-shiki
 */

export interface SyntaxToken {
  /** Start offset in the original line text (inclusive). */
  start: number;
  /** End offset in the original line text (exclusive). */
  end: number;
  /**
   * Inline CSS string (e.g. `color:#79B8FF` or
   * `color:#79B8FF;font-style:italic`). Empty string when Shiki has
   * no style for the token (rare, but safe to treat as "no
   * decoration"). The renderer can pass this directly to React's
   * `style` prop.
   */
  style: string;
}

const SPAN_TOKEN_RE =
  /<span\s+(?:[^>]*?\s+)?style="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g;

/**
 * Parse one line of Shiki HTML into character-range tokens.
 *
 * The input may be either:
 *  - the full `<span class="line">…</span>` element (with or without
 *    surrounding whitespace), or
 *  - just the inner contents (a sequence of `<span style="…">…</span>`
 *    spans).
 *
 * Both forms work because the regex skips spans without a `style=`
 * attribute (e.g. the wrapping `<span class="line">`).
 *
 * Returns tokens in document order. Offsets are computed from the
 * cumulative token-content length and therefore index into the
 * *decoded* original text. HTML entities (`&lt;`, `&gt;`, `&amp;`,
 * `&quot;`, `&#39;`) are decoded so offsets match the source line.
 *
 * Shiki's normal output never nests styled spans, so this regex-based
 * parser is sufficient. If a future Shiki version starts emitting
 * nested spans for, say, ligature decorations, this parser will
 * misattribute the inner content — call sites should treat empty
 * results as "fall back to plain text" in that case (acceptable
 * graceful degradation per Thread C's design).
 */
export function parseShikiLineHtml(lineHtml: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let offset = 0;
  // Reset because we're sharing a single regex literal.
  SPAN_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPAN_TOKEN_RE.exec(lineHtml)) !== null) {
    const style = match[1];
    const encodedText = match[2];
    const text = decodeHtmlEntities(encodedText);
    if (text.length === 0) continue;
    const start = offset;
    const end = offset + text.length;
    tokens.push({ start, end, style });
    offset = end;
  }
  return tokens;
}

/**
 * Decode the small set of HTML entities Shiki emits. Avoids pulling
 * in a full HTML parser; the entity set is fixed and small.
 */
export function decodeHtmlEntities(s: string): string {
  // Order matters: `&amp;` must be last so we don't double-decode.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
