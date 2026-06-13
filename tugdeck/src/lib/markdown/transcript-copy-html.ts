/**
 * `transcript-copy-html.ts` — render reconstructed copy markdown to
 * sanitized HTML for the clipboard's `text/html` flavor ([P05]/[Q04]).
 *
 * The copy path writes two clipboard flavors: `text/plain` carries the
 * reconstructed markdown (what `serialize-selection.ts` produced), and
 * `text/html` carries that **same markdown re-rendered** through the
 * transcript's own parse→sanitize pipeline. Re-rendering the slice
 * (rather than cloning the live selected DOM) keeps the HTML portable
 * and byte-for-byte consistent with the markdown — no theme classes, no
 * KaTeX/Shiki app-specific markup, no duplicated MathML ([Q04]).
 *
 * `parseMarkdownToSanitizedBlocks` is synchronous (WASM lex + DOMPurify),
 * so this runs inside the copy gesture without breaking transient
 * activation. Copy is rare, so the extra parse pass is acceptable.
 *
 * @module lib/markdown/transcript-copy-html
 */

import { parseMarkdownToSanitizedBlocks } from "./parse-markdown-to-sanitized-blocks";

/**
 * Re-render reconstructed copy markdown to a sanitized HTML string by
 * joining the per-block sanitized HTML. Returns the empty string for
 * empty input.
 */
export function transcriptMarkdownToHtml(markdown: string): string {
  if (markdown === "") return "";
  const blocks = parseMarkdownToSanitizedBlocks(markdown);
  return blocks.map((b) => b.html).join("\n");
}
