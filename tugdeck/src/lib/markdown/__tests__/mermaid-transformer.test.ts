/**
 * `mermaidTransformer` — populated behaviour (Step 23).
 *
 * The stub-shape contract is exercised in `block-transformers.test.ts`'s
 * "stub transformers" suite: every transformer passes its argument
 * through unchanged when the input does not match its predicate. This
 * file pins the *populated* behaviour:
 *
 *  - ` ```mermaid ` fences promote to a `tug-mermaid` placeholder.
 *  - Other fenced-code blocks pass through unchanged (including
 *    language tags like `ts` and unlabeled fences).
 *  - Non-code blocks pass through unchanged.
 *  - HTML entities the parser emits inside a fence body (`&amp;`,
 *    `&lt;`, `&gt;`, `&quot;`, `&#39;`) are decoded back to their
 *    literal characters so Mermaid sees the original diagram source.
 *  - Streaming-aware: `isComplete: false` defers the promotion so a
 *    half-streamed diagram renders as a plain code fence.
 *  - The trailing newline pulldown-cmark always emits before
 *    `</code>` is trimmed from the captured source.
 *
 * Pure-logic: no DOM, no jsdom, no WASM init required because the
 * transformer is exercised directly on synthetic block records.
 */

import { describe, expect, test } from "bun:test";

import {
  buildMermaidPlaceholderHtml,
  decodeMermaidEntities,
  extractMermaidSource,
  mermaidTransformer,
} from "../block-transformers/mermaid";
import type { SanitizedMarkdownBlock } from "../parse-markdown-to-sanitized-blocks";

function codeBlock(
  langClass: string,
  inner: string,
): SanitizedMarkdownBlock {
  return {
    html: `<pre><code class="language-${langClass}">${inner}</code></pre>\n`,
    type: "code",
    startChar: 0,
    endChar: inner.length,
    depth: 0,
    itemCount: 0,
    rowCount: 0,
    contentHash: 0n,
  };
}

describe("decodeMermaidEntities", () => {
  test("decodes the entity set pulldown-cmark emits", () => {
    const escaped = "a &amp; b &lt; c &gt; d &quot; e &#39; f";
    expect(decodeMermaidEntities(escaped)).toBe(`a & b < c > d " e ' f`);
  });

  test("decodes `&amp;` last so already-escaped entities round-trip", () => {
    expect(decodeMermaidEntities("&amp;lt;")).toBe("&lt;");
  });
});

describe("extractMermaidSource", () => {
  test("extracts source from a ```mermaid fence", () => {
    const out = extractMermaidSource(
      `<pre><code class="language-mermaid">flowchart LR\n  a --&gt; b\n</code></pre>\n`,
    );
    expect(out?.lang).toBe("mermaid");
    expect(out?.source).toBe("flowchart LR\n  a --> b");
  });

  test("language match is case-insensitive", () => {
    const out = extractMermaidSource(
      `<pre><code class="language-Mermaid">graph TD\n</code></pre>\n`,
    );
    expect(out?.lang).toBe("mermaid");
  });

  test("returns null for non-mermaid fences", () => {
    expect(extractMermaidSource(`<pre><code class="language-math">x</code></pre>\n`))
      .toBeNull();
    expect(extractMermaidSource(`<pre><code class="language-ts">x</code></pre>\n`))
      .toBeNull();
  });

  test("returns null for fences without a language class", () => {
    expect(extractMermaidSource(`<pre><code>x</code></pre>\n`)).toBeNull();
  });

  test("returns null for non-pre/code shapes", () => {
    expect(extractMermaidSource(`<p>flowchart LR</p>`)).toBeNull();
  });

  test("strips the trailing newline pulldown-cmark emits", () => {
    const out = extractMermaidSource(
      `<pre><code class="language-mermaid">graph TD\nA --&gt; B\n</code></pre>\n`,
    );
    expect(out?.source).toBe("graph TD\nA --> B");
  });
});

describe("buildMermaidPlaceholderHtml", () => {
  test("emits a placeholder with the pending flag", () => {
    const html = buildMermaidPlaceholderHtml("flowchart LR");
    expect(html).toContain(`class="tugx-mermaid"`);
    expect(html).toContain(`data-tugx-mermaid-pending="true"`);
    expect(html).toContain("flowchart LR");
  });

  test("escapes `&` and `<` so innerHTML round-trips losslessly", () => {
    // `>` is not escaped — it's not a structural char inside text
    // content, so the browser parses it as a literal regardless.
    const html = buildMermaidPlaceholderHtml("A --> B & <C>");
    expect(html).toContain("A --> B &amp; &lt;C>");
  });
});

describe("mermaidTransformer.transform", () => {
  test("promotes a mermaid fence to tug-mermaid", () => {
    const block = codeBlock("mermaid", "flowchart LR\n");
    const out = mermaidTransformer.transform(block, { isComplete: true, index: 0 });
    expect(out.length).toBe(1);
    expect(out[0].type).toBe("tug-mermaid");
    expect(out[0].html).toContain(`data-tugx-mermaid-pending="true"`);
    expect(out[0].html).toContain("flowchart LR");
  });

  test("passes a non-mermaid fenced code block through unchanged", () => {
    const block = codeBlock("ts", "const x = 1;\n");
    const out = mermaidTransformer.transform(block, { isComplete: true, index: 0 });
    expect(out.length).toBe(1);
    expect(out[0]).toBe(block);
  });

  test("passes a math fence through unchanged (math transformer's territory)", () => {
    const block = codeBlock("math", "E=mc^2\n");
    const out = mermaidTransformer.transform(block, { isComplete: true, index: 0 });
    expect(out[0]).toBe(block);
    expect(out[0].type).toBe("code");
  });

  test("passes a fenced code block with no language through unchanged", () => {
    const block: SanitizedMarkdownBlock = {
      ...codeBlock("ts", "x\n"),
      html: `<pre><code>x\n</code></pre>\n`,
    };
    const out = mermaidTransformer.transform(block, { isComplete: true, index: 0 });
    expect(out[0]).toBe(block);
  });

  test("passes a non-code block through unchanged", () => {
    const block: SanitizedMarkdownBlock = {
      html: "<p>not a fence</p>",
      type: "paragraph",
      startChar: 0,
      endChar: 12,
      depth: 0,
      itemCount: 0,
      rowCount: 0,
      contentHash: 0n,
    };
    const out = mermaidTransformer.transform(block, { isComplete: true, index: 0 });
    expect(out[0]).toBe(block);
  });

  test("defers promotion while streaming (isComplete: false)", () => {
    const block = codeBlock("mermaid", "flowchart LR\n");
    const out = mermaidTransformer.transform(block, { isComplete: false, index: 0 });
    expect(out.length).toBe(1);
    expect(out[0]).toBe(block);
    expect(out[0].type).toBe("code");
  });

  test("decodes HTML entities embedded in the source", () => {
    // The fence body comes in HTML-escaped (`&gt;`, `&amp;`, etc.);
    // the transformer decodes those to literals so Mermaid sees the
    // original DSL. The placeholder's innerHTML re-escapes `&` and
    // `<` (but not `>`, which is not a structural char inside text
    // content) so the textContent round-trip is lossless.
    const block = codeBlock("mermaid", "A --&gt; B &amp; C\n");
    const out = mermaidTransformer.transform(block, { isComplete: true, index: 0 });
    expect(out[0].html).toContain("A --> B &amp; C");
  });
});
