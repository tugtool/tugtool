/**
 * `mathTransformer` — promotes ` ```math `, ` ```latex `, and ` ```tex `
 * fenced-code blocks to a `tug-math-display` opaque body kind so the
 * post-render math walker can typeset them via lazy-loaded KaTeX.
 *
 * Per [D08] KaTeX is the engine; per [D10] it loads on first encounter.
 * The transformer is pure: it rewrites the block's `html` to a
 * placeholder containing the raw LaTeX source as `textContent` — no
 * data-attribute encoding, no HTML-entity round-tripping. The
 * post-`innerHTML` math-walker (`enhance-math.ts`) finds these
 * placeholders and calls into KaTeX.
 *
 * **Streaming-aware.** While the parent text is still streaming
 * (`isComplete: false`), the block stays a plain code fence so a
 * half-typed expression doesn't render as a broken parse. Promotion
 * happens once the source has reached completion ([D07], Spec S04).
 *
 * **Source extraction.** pulldown-cmark emits `<pre><code class="language-X">…</code></pre>`
 * where `…` is the HTML-escaped fence body. The transformer pulls
 * that body out via a regex, decodes the small set of entities
 * pulldown-cmark emits for code (`&amp;`, `&lt;`, `&gt;`,
 * `&quot;`, `&#39;`), and emits it as textContent on the
 * placeholder. Setting `el.innerHTML = block.html` parses the new
 * structure cleanly; the math walker reads back via
 * `el.textContent` which round-trips losslessly.
 *
 * Population history: stubbed in #step-3 as a no-op pass-through;
 * populated in #step-22 alongside the KaTeXBlock body kind, the
 * lazy KaTeX loader, and the inline-math walker.
 */

import type { BlockTransformer } from "./index";

/**
 * Match the opening `<pre><code class="language-XXX">` produced by
 * pulldown-cmark for a fenced code block. Captures the lang tag.
 */
const FENCE_OPEN_RE =
  /^<pre><code\s+class="language-([^"]+)"\s*>/i;
/** Match the closing tag pair. */
const FENCE_CLOSE_RE = /<\/code><\/pre>\s*$/;

/**
 * Decode the canonical entity set pulldown-cmark emits inside a code
 * fence body. Code-block bodies are not Markdown-parsed, so only
 * `&amp;`, `&lt;`, `&gt;`, `&quot;`, and `&#39;` ever appear; numeric
 * references beyond `&#39;` are not produced by the parser. Order
 * matters: decode `&amp;` last so we don't double-decode a `&amp;lt;`
 * sequence into `<`.
 */
export function decodeFencedEntities(escaped: string): string {
  return escaped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** HTML-escape for content that will live as `textContent` inside an
 *  element. We re-encode `&` and `<` so the placeholder's `innerHTML`
 *  string survives the parser without injecting unintended structure. */
function escapeForTextContent(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/**
 * Languages this transformer promotes. Matched case-insensitively.
 * `math` is the canonical fence; `latex` and `tex` are accepted
 * aliases the assistant occasionally emits.
 */
const MATH_LANGS = new Set(["math", "latex", "tex"]);

/**
 * Extract the LaTeX source out of a sanitized
 * `<pre><code class="language-X">…</code></pre>` block. Returns
 * `null` if `html` does not match that exact shape (e.g. the block
 * isn't a fenced code block, or its `class` attribute was stripped).
 *
 * Exported for unit tests; production code goes through
 * {@link mathTransformer}.
 */
export function extractMathSource(html: string): {
  lang: string;
  source: string;
} | null {
  const openMatch = html.match(FENCE_OPEN_RE);
  if (!openMatch) return null;
  if (!FENCE_CLOSE_RE.test(html)) return null;
  const lang = openMatch[1].toLowerCase();
  if (!MATH_LANGS.has(lang)) return null;
  const inner = html
    .slice(openMatch[0].length)
    .replace(FENCE_CLOSE_RE, "");
  // pulldown-cmark always emits a trailing newline before `</code>`;
  // strip it so the rendered math doesn't carry a phantom empty line.
  const trimmed = inner.endsWith("\n") ? inner.slice(0, -1) : inner;
  return { lang, source: decodeFencedEntities(trimmed) };
}

/**
 * Build the placeholder HTML the math walker consumes. The raw LaTeX
 * source lives as `textContent` (re-escaped for the innerHTML
 * round-trip) so KaTeX can read it back via `el.textContent` without
 * any entity tracking on the consumer side. The placeholder also
 * serves as the fallback surface — until KaTeX loads or in the error
 * path, the raw source is what the reader sees.
 *
 * Exported for unit tests.
 */
export function buildMathPlaceholderHtml(source: string): string {
  return `<div class="tugx-katex tugx-katex--display" data-tugx-math="display" data-tugx-math-pending="true">${escapeForTextContent(source)}</div>`;
}

export const mathTransformer: BlockTransformer = {
  name: "math",
  transform(block, ctx) {
    if (block.type !== "code") return [block];
    const extracted = extractMathSource(block.html);
    if (extracted === null) return [block];
    // Streaming-aware: only promote once the source has reached
    // completion. Half-streamed LaTeX would otherwise render as a
    // KaTeX parse error every frame.
    if (!ctx.isComplete) return [block];
    return [
      {
        ...block,
        type: "tug-math-display",
        html: buildMathPlaceholderHtml(extracted.source),
      },
    ];
  },
};
