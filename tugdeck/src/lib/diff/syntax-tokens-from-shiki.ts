/**
 * Convert Shiki's themed-token output into flat `[start, end)` token
 * ranges with inline-style strings.
 *
 * For the diff renderer we want each line's tokens as character ranges
 * over the original line text, so we can merge them with word-level
 * diff ranges in `render-line.ts` without losing either decoration.
 * `<DiffBlock>` invokes Shiki's `codeToTokens` itself (reusing the
 * shared singleton from `lib/code-block-utils.ts`) on whole
 * reconstructed hunk sides — multi-line input, so grammar state flows
 * across lines (a block-comment interior stays a comment; a CSS
 * declaration inside its rule braces stays a property) — and feeds
 * each returned line in here. Keeping the conversion separate keeps it
 * pure and easy to test.
 *
 * Shape note: with the `tug-syntax-variables` theme, token colors are
 * `var(--syntax-token-*)` references; the renderer applies them via
 * the React `style` attribute. The word-level overlay continues to use
 * CSS classes — both decorations compose naturally on the same
 * `<span>`.
 *
 * @module lib/diff/syntax-tokens-from-shiki
 */

export interface SyntaxToken {
  /** Start offset in the original line text (inclusive). */
  start: number;
  /** End offset in the original line text (exclusive). */
  end: number;
  /**
   * Inline CSS string (e.g. `color:var(--syntax-token-keyword)` or
   * `color:var(--syntax-token-comment);font-style:italic` with the
   * CSS-variables theme; literal hex colors with a fixed theme).
   * Empty string when Shiki has no style for the token (rare, but
   * safe to treat as "no decoration"). The renderer can pass this
   * directly to React's `style` prop.
   */
  style: string;
}

/**
 * Structural subset of Shiki's `ThemedToken` that the conversion
 * needs. Declared locally so this module (and its tests) don't depend
 * on Shiki's types.
 */
export interface ThemedTokenLike {
  /** The token's text content. */
  content: string;
  /** Resolved foreground color (a `var(--syntax-…)` string with the
   * CSS-variables theme). */
  color?: string;
  /** Shiki font-style bitmask: 1 = italic, 2 = bold, 4 = underline. */
  fontStyle?: number;
}

/**
 * Convert one line of Shiki themed tokens into character-range tokens.
 *
 * Offsets are cumulative over the token contents, so they index into
 * the original source line. Tokens whose color equals `foreground`
 * (the theme's base text color) and carry no font style are emitted
 * with an empty style string, letting the renderer skip the wrapping
 * `<span>` for plain text runs.
 */
export function tokensFromThemedLine(
  line: readonly ThemedTokenLike[],
  foreground?: string,
): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let offset = 0;
  for (const themed of line) {
    const text = themed.content;
    if (text.length === 0) continue;
    const start = offset;
    const end = offset + text.length;
    offset = end;

    const parts: string[] = [];
    if (themed.color !== undefined && themed.color !== foreground) {
      parts.push(`color:${themed.color}`);
    }
    const fontStyle = themed.fontStyle ?? 0;
    if ((fontStyle & 1) !== 0) parts.push("font-style:italic");
    if ((fontStyle & 2) !== 0) parts.push("font-weight:bold");
    if ((fontStyle & 4) !== 0) parts.push("text-decoration:underline");

    tokens.push({ start, end, style: parts.join(";") });
  }
  return tokens;
}
