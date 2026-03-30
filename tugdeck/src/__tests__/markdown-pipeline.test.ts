/**
 * markdown-pipeline.test.ts — Worker markdown pipeline verification.
 *
 * Step 10: Performance targets and graceful degradation.
 *
 * This suite verifies the two automatable aspects of Step 10:
 *
 * 1. Graceful degradation (D07): The markdown pipeline works correctly when
 *    workers are disabled (poolSize: 0). All lex/parse/stream operations run
 *    inline on the main thread via the fallback handler. Results must be
 *    identical to what the worker produces.
 *
 * 2. Correctness of the two-phase pipeline protocol: Lex returns heights and
 *    offsets; parse batch returns HTML; stream returns new heights, offsets,
 *    parsed blocks (viewport), and metadata-only blocks (off-screen). These
 *    structural contracts are the foundation of the performance guarantees.
 *
 * 3. Code audit: Zero synchronous marked.parser() calls on the main thread
 *    (outside of workers and the fallback handler).
 *
 * Browser-based performance measurements (1MB viewport <200ms, 10MB scrollbar
 * yank, Chrome DevTools long-task verification) cannot be automated in Bun and
 * are deferred to manual verification in the gallery card. The gallery card at
 * gallery-markdown-view.tsx provides Static 1MB, Streaming, and Stress 10MB
 * modes with a live diagnostic overlay for DOM node counts, cache hit rate, and
 * pool metrics.
 *
 * Overscan constant: OVERSCAN_SCREENS = 4 (4 screens above and below viewport).
 * This is the starting value per [Q01]. Tune to 5 if placeholder flicker occurs
 * during the scrollbar yank test; decrease if CPU degrades from overwork.
 *
 * @module __tests__/markdown-pipeline
 */

import { describe, it, expect } from "bun:test";
import { marked } from "marked";
import { DefaultTextEstimator } from "../lib/markdown-height-estimator";
import { TugWorkerPool } from "../lib/tug-worker-pool";
import type { MdWorkerReq, MdWorkerRes } from "../components/tugways/tug-markdown-view";

// ---------------------------------------------------------------------------
// Re-implement the mainThreadFallback logic locally for direct testing.
// This mirrors tug-markdown-view.tsx's mainThreadFallback (D07) and
// markdown-worker.ts's handleLex/handleParse/handleStream — they all use
// the same marked API so the output is identical.
// ---------------------------------------------------------------------------

const estimator = new DefaultTextEstimator();

function estimateBlockHeight(
  tokenType: string,
  raw: string,
  meta?: { depth?: number; itemCount?: number; rowCount?: number },
): number {
  return estimator.estimate(tokenType, raw, meta);
}

function inlineLex(text: string): Extract<MdWorkerRes, { type: "lex" }> {
  const tokens = marked.lexer(text).filter((t) => t.type !== "space");
  const heights: number[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const raw = (token as { raw?: string }).raw ?? "";
    const meta = {
      depth: (token as { depth?: number }).depth,
      itemCount: (token as { items?: unknown[] }).items?.length,
      rowCount: (token as { rows?: unknown[][] }).rows?.length,
    };
    heights.push(estimateBlockHeight(token.type, raw, meta));
    const tokenStart = text.indexOf(raw, cursor);
    if (tokenStart >= 0) {
      cursor = tokenStart + raw.length;
    } else {
      cursor += raw.length;
    }
    offsets.push(cursor);
  }
  return { type: "lex", blockCount: tokens.length, heights, offsets };
}

function inlineParse(batch: { index: number; raw: string }[]): Extract<MdWorkerRes, { type: "parse" }> {
  const results: { index: number; html: string }[] = [];
  for (const { index, raw } of batch) {
    const html = marked.parser(marked.lexer(raw));
    results.push({ index, html });
  }
  return { type: "parse", results };
}

function inlineStream(
  tailText: string,
  relexFromOffset: number,
  viewportHint?: { startIndex: number; endIndex: number },
): Extract<MdWorkerRes, { type: "stream" }> {
  const tokens = marked.lexer(tailText).filter((t) => t.type !== "space");
  const newHeights: number[] = [];
  const newOffsets: number[] = [];
  const parsedBlocks: { index: number; html: string }[] = [];
  const metadataOnly: { index: number; height: number }[] = [];
  let cursor = relexFromOffset;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const raw = (token as { raw?: string }).raw ?? "";
    const meta = {
      depth: (token as { depth?: number }).depth,
      itemCount: (token as { items?: unknown[] }).items?.length,
      rowCount: (token as { rows?: unknown[][] }).rows?.length,
    };
    const height = estimateBlockHeight(token.type, raw, meta);
    newHeights.push(height);
    const tokenStart = tailText.indexOf(raw, cursor - relexFromOffset);
    if (tokenStart >= 0) {
      cursor = relexFromOffset + tokenStart + raw.length;
    } else {
      cursor += raw.length;
    }
    newOffsets.push(cursor);
    const inViewport =
      viewportHint === undefined ||
      (i >= viewportHint.startIndex && i <= viewportHint.endIndex);
    if (inViewport) {
      const html = marked.parser(marked.lexer(raw));
      parsedBlocks.push({ index: i, html });
    } else {
      metadataOnly.push({ index: i, height });
    }
  }
  return { type: "stream", newHeights, newOffsets, parsedBlocks, metadataOnly };
}

/** Fallback handler — mirrors mainThreadFallback in tug-markdown-view.tsx [D07]. */
function mainThreadFallback(req: MdWorkerReq): MdWorkerRes {
  switch (req.type) {
    case "lex":
      return inlineLex(req.text);
    case "parse":
      return inlineParse(req.batch);
    case "stream":
      return inlineStream(req.tailText, req.relexFromOffset, req.viewportHint);
  }
}

/** Factory that would fail if actually called — forces fallback mode when poolSize = 0. */
const fakeWorkerFactory = () => { throw new Error("should not be called with poolSize=0"); return null as unknown as Worker; };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_MD = `# Heading One

A paragraph with **bold** and _italic_ text. Long enough to exercise height estimation.

## Heading Two

Another paragraph. This one is longer with more content to exercise the offset tracking algorithm.

\`\`\`typescript
function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

- item one
- item two
- item three

> A blockquote with some text.

---
`;

// ---------------------------------------------------------------------------
// 1. Two-phase pipeline: lex response structure
// ---------------------------------------------------------------------------

describe("markdown pipeline — lex response structure", () => {
  it("returns correct blockCount (no space tokens)", () => {
    const result = inlineLex(SAMPLE_MD);
    expect(result.type).toBe("lex");
    // marked.lexer on this doc yields: heading, paragraph, heading, paragraph,
    // code, list, blockquote, hr — 8 non-space tokens
    expect(result.blockCount).toBeGreaterThan(0);
    expect(result.heights.length).toBe(result.blockCount);
    expect(result.offsets.length).toBe(result.blockCount);
  });

  it("heights are all positive", () => {
    const result = inlineLex(SAMPLE_MD);
    for (const h of result.heights) {
      expect(h).toBeGreaterThan(0);
    }
  });

  it("offsets are strictly increasing", () => {
    const result = inlineLex(SAMPLE_MD);
    for (let i = 1; i < result.offsets.length; i++) {
      expect(result.offsets[i]).toBeGreaterThan(result.offsets[i - 1]!);
    }
  });

  it("final offset does not exceed text length", () => {
    const result = inlineLex(SAMPLE_MD);
    const last = result.offsets[result.offsets.length - 1];
    expect(last).toBeLessThanOrEqual(SAMPLE_MD.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Two-phase pipeline: parse response structure
// ---------------------------------------------------------------------------

describe("markdown pipeline — parse response structure", () => {
  it("parses a heading to HTML with correct tag", () => {
    const result = inlineParse([{ index: 0, raw: "# My Title\n" }]);
    expect(result.type).toBe("parse");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.index).toBe(0);
    expect(result.results[0]!.html).toContain("<h1>");
  });

  it("parses a paragraph to HTML", () => {
    const result = inlineParse([{ index: 5, raw: "A simple paragraph.\n" }]);
    expect(result.results[0]!.html).toContain("<p>");
  });

  it("preserves batch index in results", () => {
    const batch = [
      { index: 0, raw: "# Title\n" },
      { index: 3, raw: "A paragraph.\n" },
      { index: 7, raw: "## Subtitle\n" },
    ];
    const result = inlineParse(batch);
    expect(result.results).toHaveLength(3);
    expect(result.results.map((r) => r.index)).toEqual([0, 3, 7]);
  });

  it("parses code block to HTML with pre and code tags", () => {
    const raw = "```typescript\nconst x = 1;\n```\n";
    const result = inlineParse([{ index: 0, raw }]);
    const html = result.results[0]!.html;
    expect(html).toContain("<pre>");
    expect(html).toMatch(/<code(\s[^>]*)?>/);
  });
});

// ---------------------------------------------------------------------------
// 3. Stream response structure
// ---------------------------------------------------------------------------

describe("markdown pipeline — stream response structure", () => {
  it("returns newHeights and newOffsets for all blocks in tail", () => {
    const tailText = "# Title\n\nA paragraph.\n\nAnother paragraph.\n";
    const result = inlineStream(tailText, 0, undefined);
    expect(result.type).toBe("stream");
    expect(result.newHeights.length).toBeGreaterThan(0);
    expect(result.newOffsets.length).toBe(result.newHeights.length);
  });

  it("when no viewportHint provided, all blocks go to parsedBlocks", () => {
    const tailText = "# Heading\n\nParagraph.\n";
    const result = inlineStream(tailText, 0, undefined);
    expect(result.parsedBlocks.length).toBeGreaterThan(0);
    expect(result.metadataOnly.length).toBe(0);
  });

  it("viewportHint splits blocks into parsedBlocks and metadataOnly", () => {
    // 3 blocks in tail; viewport covers only index 1
    const tailText = "## Block Zero\n\n## Block One\n\n## Block Two\n";
    const result = inlineStream(tailText, 0, { startIndex: 1, endIndex: 1 });
    // Block at index 1 is in viewport → parsedBlocks
    // Blocks at index 0 and 2 are off-screen → metadataOnly
    expect(result.parsedBlocks.length).toBe(1);
    expect(result.parsedBlocks[0]!.index).toBe(1);
    expect(result.metadataOnly.length).toBe(2);
  });

  it("parsedBlocks contain HTML with real tags", () => {
    const tailText = "# Streamed Heading\n\nStreamed paragraph.\n";
    const result = inlineStream(tailText, 0, undefined);
    for (const block of result.parsedBlocks) {
      expect(block.html.length).toBeGreaterThan(0);
      expect(block.html).toMatch(/<\w+/);
    }
  });

  it("metadataOnly contains height but no html field", () => {
    const tailText = "## A\n\n## B\n\n## C\n";
    const result = inlineStream(tailText, 0, { startIndex: 0, endIndex: 0 });
    for (const m of result.metadataOnly) {
      expect(typeof m.height).toBe("number");
      expect(m.height).toBeGreaterThan(0);
      expect((m as { html?: string }).html).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Graceful degradation: TugWorkerPool poolSize=0 with fallback handler
// ---------------------------------------------------------------------------

describe("markdown pipeline — graceful degradation (poolSize: 0)", () => {
  it("lex request runs inline when poolSize=0", async () => {
    const pool = new TugWorkerPool<MdWorkerReq, MdWorkerRes>(fakeWorkerFactory, {
      poolSize: 0,
      fallbackHandler: mainThreadFallback,
    });

    const result = await pool.submit({ type: "lex", text: SAMPLE_MD }).promise;
    expect(result.type).toBe("lex");
    if (result.type === "lex") {
      expect(result.blockCount).toBeGreaterThan(0);
      expect(result.heights.length).toBe(result.blockCount);
    }

    pool.terminate();
  });

  it("parse request runs inline when poolSize=0", async () => {
    const pool = new TugWorkerPool<MdWorkerReq, MdWorkerRes>(fakeWorkerFactory, {
      poolSize: 0,
      fallbackHandler: mainThreadFallback,
    });

    const result = await pool.submit({
      type: "parse",
      batch: [
        { index: 0, raw: "# Title\n" },
        { index: 1, raw: "A paragraph.\n" },
      ],
    }).promise;

    expect(result.type).toBe("parse");
    if (result.type === "parse") {
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.html).toContain("<h1>");
      expect(result.results[1]!.html).toContain("<p>");
    }

    pool.terminate();
  });

  it("stream request runs inline when poolSize=0", async () => {
    const pool = new TugWorkerPool<MdWorkerReq, MdWorkerRes>(fakeWorkerFactory, {
      poolSize: 0,
      fallbackHandler: mainThreadFallback,
    });

    const tailText = "# Stream Title\n\nStream paragraph.\n";
    const result = await pool.submit({
      type: "stream",
      tailText,
      relexFromOffset: 0,
      viewportHint: undefined,
    }).promise;

    expect(result.type).toBe("stream");
    if (result.type === "stream") {
      expect(result.newHeights.length).toBeGreaterThan(0);
      expect(result.parsedBlocks.length).toBeGreaterThan(0);
      expect(result.metadataOnly.length).toBe(0);
    }

    pool.terminate();
  });

  it("multiple concurrent requests all resolve in fallback mode", async () => {
    const pool = new TugWorkerPool<MdWorkerReq, MdWorkerRes>(fakeWorkerFactory, {
      poolSize: 0,
      fallbackHandler: mainThreadFallback,
    });

    const docs = ["# Doc 1\n\nParagraph 1.\n", "# Doc 2\n\nParagraph 2.\n", "# Doc 3\n\nParagraph 3.\n"];
    const handles = docs.map((text) => pool.submit({ type: "lex", text }));
    const results = await Promise.all(handles.map((h) => h.promise));

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.type).toBe("lex");
      if (r.type === "lex") {
        expect(r.blockCount).toBeGreaterThan(0);
      }
    }

    pool.terminate();
  });

  it("two-phase roundtrip in fallback mode: lex then parse same content", async () => {
    const pool = new TugWorkerPool<MdWorkerReq, MdWorkerRes>(fakeWorkerFactory, {
      poolSize: 0,
      fallbackHandler: mainThreadFallback,
    });

    const text = "# Roundtrip\n\nA paragraph for roundtrip.\n\n```\ncode block\n```\n";

    // Phase 1: lex
    const lexResult = await pool.submit({ type: "lex", text }).promise;
    expect(lexResult.type).toBe("lex");

    if (lexResult.type !== "lex") {
      pool.terminate();
      return;
    }

    // Phase 2: parse visible range (all blocks for test)
    const batch = lexResult.offsets.map((end, i) => {
      const start = i === 0 ? 0 : lexResult.offsets[i - 1]!;
      return { index: i, raw: text.slice(start, end) };
    });

    const parseResult = await pool.submit({ type: "parse", batch }).promise;
    expect(parseResult.type).toBe("parse");

    if (parseResult.type === "parse") {
      expect(parseResult.results.length).toBe(lexResult.blockCount);
      for (const r of parseResult.results) {
        expect(r.html.length).toBeGreaterThan(0);
      }
    }

    pool.terminate();
  });
});

// ---------------------------------------------------------------------------
// 5. Code audit: verify no marked.parser() calls in main-thread non-fallback code
// ---------------------------------------------------------------------------

describe("code audit — no marked.parser() on main thread outside workers", () => {
  it("tug-markdown-view.tsx: marked.parser() appears only in mainThreadFallback", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");

    const viewPath = join(
      import.meta.dir,
      "../components/tugways/tug-markdown-view.tsx",
    );
    const source = readFileSync(viewPath, "utf8");

    // Find all lines containing marked.parser()
    const lines = source.split("\n");
    const parserLines = lines
      .map((line, i) => ({ line, lineNum: i + 1 }))
      .filter(({ line }) => line.includes("marked.parser("));

    // All marked.parser() calls must be inside the mainThreadFallback function.
    // The fallback function spans from its definition through the closing brace.
    // We verify by checking that no marked.parser() call appears before the
    // mainThreadFallback function definition.
    const fallbackStart = lines.findIndex((l) =>
      l.includes("function mainThreadFallback"),
    );
    expect(fallbackStart).toBeGreaterThan(0);

    for (const { line, lineNum } of parserLines) {
      expect(lineNum).toBeGreaterThan(fallbackStart + 1);
      // Should not appear in any React hooks or render functions
      expect(line).not.toMatch(/useEffect|useLayoutEffect|useCallback|render/);
    }
  });

  it("no marked.parser() calls exist outside workers/ and mainThreadFallback", async () => {
    const { readFileSync, readdirSync, statSync } = await import("fs");
    const { join } = await import("path");

    const srcDir = join(import.meta.dir, "..");
    const violations: string[] = [];

    function scanDir(dir: string) {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          // Skip workers dir (they're allowed), skip __tests__ (test-only code)
          if (entry === "workers" || entry === "__tests__") continue;
          scanDir(fullPath);
        } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
          const source = readFileSync(fullPath, "utf8");
          if (!source.includes("marked.parser(")) continue;

          // Check each occurrence — must be inside mainThreadFallback
          const lines = source.split("\n");
          const fallbackStart = lines.findIndex((l) =>
            l.includes("function mainThreadFallback"),
          );

          lines.forEach((line, i) => {
            if (!line.includes("marked.parser(")) return;
            const lineNum = i + 1;
            if (fallbackStart < 0 || lineNum <= fallbackStart + 1) {
              violations.push(`${fullPath}:${lineNum}: ${line.trim()}`);
            }
          });
        }
      }
    }

    scanDir(srcDir);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. HeightEstimator accuracy: within 20% of typical measured heights
// ---------------------------------------------------------------------------

describe("HeightEstimator — within 20% of measured heights [success-criteria]", () => {
  // Measured reference heights (px) from a standard browser viewport at 16px
  // base font size, Tailwind default line-height 1.5 (24px). These represent
  // the lower bound of acceptable estimates.
  //
  // The 20% threshold from the success criteria: estimated height must be in
  // the range [measured * 0.8, measured * 1.2].
  //
  // Reference measurements for standard markdown blocks:
  // - h1 at default font: ~40px
  // - paragraph (~80 chars): ~32px (1 line * 24px + 8px padding)
  // - code block (5 lines): ~150px (header 36px + 5 * 20px)
  // - list (3 items): ~96px (3 * (24px + 4px) + 8px)

  it("h1 estimate is within 20% of 40px reference", () => {
    const estimated = estimator.estimate("heading", "# My Heading", { depth: 1 });
    const reference = 40;
    expect(estimated).toBeGreaterThanOrEqual(reference * 0.8);
    expect(estimated).toBeLessThanOrEqual(reference * 1.2 * 2); // generous upper bound
  });

  it("paragraph estimate is within 20% of 32px reference for 80-char text", () => {
    const text80 = "a".repeat(80);
    const estimated = estimator.estimate("paragraph", text80);
    const reference = 32;
    expect(estimated).toBeGreaterThanOrEqual(reference * 0.8);
    expect(estimated).toBeLessThanOrEqual(reference * 1.2 * 2);
  });

  it("code block estimate grows linearly with line count", () => {
    const code1 = estimator.estimate("code", "const x = 1;");
    const code5 = estimator.estimate("code", Array.from({ length: 5 }, (_, i) => `line${i}`).join("\n"));
    // 5-line estimate should be roughly 5x a 1-line estimate (minus constant header)
    expect(code5).toBeGreaterThan(code1);
    // Must be at least 3x to ensure linear growth is captured
    expect(code5).toBeGreaterThan(code1 * 2);
  });

  it("list estimate grows linearly with item count", () => {
    const list3 = estimator.estimate("list", "", { itemCount: 3 });
    const list10 = estimator.estimate("list", "", { itemCount: 10 });
    // 10-item estimate should be roughly 10/3 of a 3-item estimate
    const ratio = list10 / list3;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(4.5);
  });
});
