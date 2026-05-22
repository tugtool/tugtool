/**
 * `mermaidTransformer` — promotes ` ```mermaid ` fenced-code blocks
 * to a `tug-mermaid` opaque body kind so the post-render
 * `enhance-mermaid` walker can typeset them via lazy-loaded Mermaid.
 *
 * Per [D10] the diagram engine loads on first encounter; per [R04]
 * each render is wrapped in an error boundary at the call site so a
 * malformed diagram cannot crash the parent block. The transformer
 * is pure: it rewrites the block's `html` to a placeholder
 * containing the raw diagram source as `textContent` — no
 * data-attribute encoding, no HTML-entity round-tripping. The
 * post-`innerHTML` walker (`enhance-mermaid.ts`) finds these
 * placeholders and calls into Mermaid.
 *
 * **Streaming-aware.** While the parent text is still streaming
 * (`isComplete: false`), the block stays a plain code fence so a
 * half-typed diagram doesn't render as a broken parse on every
 * delta ([D07], Spec S04). Promotion happens once the source has
 * reached completion.
 *
 * **Source extraction.** pulldown-cmark emits
 * `<pre><code class="language-mermaid">…</code></pre>` where `…` is
 * the HTML-escaped fence body. The transformer pulls that body out
 * via a regex, decodes the small set of entities pulldown-cmark
 * emits for code (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`), and
 * emits it as `textContent` on the placeholder. Setting
 * `el.innerHTML = block.html` parses the new structure cleanly; the
 * mermaid walker reads back via `el.textContent` which round-trips
 * losslessly.
 *
 * Population history: stubbed in #step-3 as a no-op pass-through;
 * populated in #step-23 alongside the MermaidBlock body kind, the
 * lazy Mermaid loader, and the enhance-mermaid pass.
 */

import type { BlockTransformer } from "./index";

/**
 * Match the opening `<pre><code class="language-XXX">` produced by
 * pulldown-cmark for a fenced code block. Captures the lang tag.
 */
const FENCE_OPEN_RE = /^<pre><code\s+class="language-([^"]+)"\s*>/i;
/** Match the closing tag pair. */
const FENCE_CLOSE_RE = /<\/code><\/pre>\s*$/;

/**
 * Decode the canonical entity set pulldown-cmark emits inside a code
 * fence body. Identical shape to the math transformer's decoder.
 * Exported for unit tests.
 */
export function decodeMermaidEntities(escaped: string): string {
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
 * Mermaid has no widely-used alias the assistant emits in practice,
 * so the set is intentionally narrow.
 */
const MERMAID_LANGS = new Set(["mermaid"]);

/**
 * Extract the diagram source out of a sanitized
 * `<pre><code class="language-X">…</code></pre>` block. Returns
 * `null` if `html` does not match that exact shape (e.g. the block
 * isn't a fenced code block, or its `class` attribute was stripped).
 *
 * Exported for unit tests; production code goes through
 * {@link mermaidTransformer}.
 */
export function extractMermaidSource(html: string): {
  lang: string;
  source: string;
} | null {
  const openMatch = html.match(FENCE_OPEN_RE);
  if (!openMatch) return null;
  if (!FENCE_CLOSE_RE.test(html)) return null;
  const lang = openMatch[1].toLowerCase();
  if (!MERMAID_LANGS.has(lang)) return null;
  const inner = html
    .slice(openMatch[0].length)
    .replace(FENCE_CLOSE_RE, "");
  // pulldown-cmark always emits a trailing newline before `</code>`;
  // strip it so the rendered diagram doesn't carry a phantom empty
  // line that some Mermaid parsers treat as a syntax error.
  const trimmed = inner.endsWith("\n") ? inner.slice(0, -1) : inner;
  return { lang, source: decodeMermaidEntities(trimmed) };
}

/**
 * Build the placeholder HTML the mermaid walker consumes. The raw
 * diagram source lives as `textContent` (re-escaped for the
 * innerHTML round-trip) so the engine can read it back via
 * `el.textContent` without any entity tracking on the consumer side.
 * The placeholder also serves as the fallback surface — until
 * Mermaid loads or in the error path, the raw source is what the
 * reader sees.
 *
 * Exported for unit tests.
 */
export function buildMermaidPlaceholderHtml(source: string): string {
  return `<div class="tugx-mermaid" data-tugx-mermaid-pending="true">${escapeForTextContent(source)}</div>`;
}

export const mermaidTransformer: BlockTransformer = {
  name: "mermaid",
  transform(block, ctx) {
    if (block.type !== "code") return [block];
    const extracted = extractMermaidSource(block.html);
    if (extracted === null) return [block];
    // Streaming-aware: only promote once the source has reached
    // completion. Half-streamed diagrams would otherwise render as a
    // Mermaid parse error every frame and the user would see a
    // flickering "Syntax error in graph" surface.
    if (!ctx.isComplete) return [block];
    return [
      {
        ...block,
        type: "tug-mermaid",
        html: buildMermaidPlaceholderHtml(extracted.source),
      },
    ];
  },
};
