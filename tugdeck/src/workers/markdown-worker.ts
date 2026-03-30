/**
 * markdown-worker.ts — Web worker for the two-phase markdown pipeline.
 *
 * Handles three message types via a discriminated union:
 *   - 'lex':    Tokenize full text, compute heights and cumulative end offsets.
 *   - 'parse':  Re-lex and parse a batch of { index, raw } entries to HTML.
 *   - 'stream': Incremental tail-lex for streaming content updates.
 *
 * This file is a separate Vite entry point. All imports MUST use relative paths —
 * the @/ alias does not resolve in worker builds.
 *
 * DOMPurify is NOT imported here: it requires the DOM. Sanitization runs on the
 * main thread at render time only (W10).
 *
 * Cancel messages are ignored: parse batches are ~20ms so mid-batch cancellation
 * saves negligible work. The pool handles rejection on the main thread side.
 */

import { marked, type Token, type Tokens } from "marked";
import { DefaultTextEstimator } from "../lib/markdown-height-estimator";
import { serializeError } from "../lib/tug-worker-pool";

// ---------------------------------------------------------------------------
// Message types (mirrors MdWorkerReq / MdWorkerRes in tug-markdown-view.tsx)
// ---------------------------------------------------------------------------

type MdWorkerReq =
  | { type: "lex"; text: string }
  | { type: "parse"; batch: { index: number; raw: string }[] }
  | { type: "stream"; tailText: string; relexFromOffset: number; viewportHint?: { startIndex: number; endIndex: number } };

type MdWorkerRes =
  | { type: "lex"; blockCount: number; heights: number[]; offsets: number[] }
  | { type: "parse"; results: { index: number; html: string }[] }
  | { type: "stream"; newHeights: number[]; newOffsets: number[]; parsedBlocks: { index: number; html: string }[]; metadataOnly: { index: number; height: number }[] };

// ---------------------------------------------------------------------------
// Shared estimator instance
// ---------------------------------------------------------------------------

const estimator = new DefaultTextEstimator();

// ---------------------------------------------------------------------------
// Token metadata extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract structured metadata from a token for more accurate height estimation.
 * Returns undefined for tokens with no relevant metadata.
 */
function extractMeta(token: Token): { depth?: number; itemCount?: number; rowCount?: number } | undefined {
  switch (token.type) {
    case "heading":
      return { depth: (token as Tokens.Heading).depth };
    case "list":
      return { itemCount: (token as Tokens.List).items.length };
    case "table":
      return { rowCount: (token as Tokens.Table).rows.length };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Lex handler
// ---------------------------------------------------------------------------

/**
 * Phase 1: Tokenize the full document text.
 * Returns blockCount, estimated heights, and cumulative end offsets.
 * Does NOT return raw strings — callers use offsets to slice the original text.
 */
function handleLex(text: string): Extract<MdWorkerRes, { type: "lex" }> {
  const t0 = performance.now();
  const tokens = marked.lexer(text);
  const t1 = performance.now();
  console.log(`[markdown-worker] lexer: ${(t1 - t0).toFixed(0)}ms for ${text.length} chars, ${tokens.length} tokens`);

  const heights: number[] = [];
  const offsets: number[] = [];

  // Walk ALL tokens (including space) to compute cumulative offsets.
  // Space tokens are skipped for heights/offsets output but their raw
  // length still advances the cursor. This avoids the O(n*m) indexOf
  // scan that was causing 15-second lex times on repeated content.
  let cursor = 0;

  for (const token of tokens) {
    cursor += token.raw.length;

    if (token.type === "space") continue;

    const meta = extractMeta(token);
    heights.push(estimator.estimate(token.type, token.raw, meta));
    offsets.push(cursor);
  }

  return { type: "lex", blockCount: heights.length, heights, offsets };
}

// ---------------------------------------------------------------------------
// Parse handler
// ---------------------------------------------------------------------------

/**
 * Phase 2: Re-lex and parse a batch of blocks to HTML.
 * Each entry contains { index, raw } — we re-lex the raw string so the parser
 * gets a fresh TokensList without needing to clone Token objects (W19).
 */
function handleParse(batch: { index: number; raw: string }[]): Extract<MdWorkerRes, { type: "parse" }> {
  const results: { index: number; html: string }[] = [];

  for (const { index, raw } of batch) {
    const tokens = marked.lexer(raw);
    const html = marked.parser(tokens);
    results.push({ index, html });
  }

  return { type: "parse", results };
}

// ---------------------------------------------------------------------------
// Stream handler
// ---------------------------------------------------------------------------

/**
 * Incremental update for streaming content.
 * Re-lexes the tail of the document (from relexFromOffset), estimates heights
 * for all new/changed blocks, and parses only blocks within the viewport hint.
 * Blocks outside the viewport hint get metadata-only entries (height, no HTML).
 */
function handleStream(
  tailText: string,
  relexFromOffset: number,
  viewportHint?: { startIndex: number; endIndex: number },
): Extract<MdWorkerRes, { type: "stream" }> {
  const tokens = marked.lexer(tailText);

  const newHeights: number[] = [];
  const newOffsets: number[] = [];
  const parsedBlocks: { index: number; html: string }[] = [];
  const metadataOnly: { index: number; height: number }[] = [];

  let cursor = relexFromOffset;
  let blockIndex = 0;

  for (const token of tokens) {
    cursor += token.raw.length;

    if (token.type === "space") continue;

    const meta = extractMeta(token);
    const height = estimator.estimate(token.type, token.raw, meta);
    newHeights.push(height);
    newOffsets.push(cursor);

    // Parse blocks within the viewport hint; emit metadata-only for others.
    const inViewport =
      viewportHint === undefined ||
      (blockIndex >= viewportHint.startIndex && blockIndex <= viewportHint.endIndex);

    if (inViewport) {
      const blockTokens = marked.lexer(token.raw);
      const html = marked.parser(blockTokens);
      parsedBlocks.push({ index: blockIndex, html });
    } else {
      metadataOnly.push({ index: blockIndex, height });
    }

    blockIndex++;
  }

  return { type: "stream", newHeights, newOffsets, parsedBlocks, metadataOnly };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent) => {
  const { taskId, type, payload } = e.data as { taskId: number; type: string; payload: MdWorkerReq };

  if (type === "cancel") {
    // Ignore cancel — batches are fast (~20ms), mid-batch cancellation saves negligible work.
    return;
  }

  // type === 'task'
  try {
    switch (payload.type) {
      case "lex": {
        const result = handleLex(payload.text);
        self.postMessage({ taskId, type: "result", payload: result });
        break;
      }
      case "parse": {
        const result = handleParse(payload.batch);
        self.postMessage({ taskId, type: "result", payload: result });
        break;
      }
      case "stream": {
        const result = handleStream(payload.tailText, payload.relexFromOffset, payload.viewportHint);
        self.postMessage({ taskId, type: "result", payload: result });
        break;
      }
      default: {
        // Unknown payload type — send an error so the caller doesn't hang.
        self.postMessage({
          taskId,
          type: "error",
          error: serializeError(new Error(`markdown-worker: unknown payload type: ${(payload as { type: string }).type}`)),
        });
      }
    }
  } catch (err) {
    self.postMessage({ taskId, type: "error", error: serializeError(err) });
  }
};

// Quick benchmark: how fast is marked.lexer in this runtime?
const benchText = "# Heading\n\nParagraph text.\n\n```\ncode\n```\n\n";
const bench1k = benchText.repeat(Math.ceil(1000 / benchText.length)).slice(0, 1000);
const bench10k = benchText.repeat(Math.ceil(10000 / benchText.length)).slice(0, 10000);
const bench100k = benchText.repeat(Math.ceil(100000 / benchText.length)).slice(0, 100000);

const b1 = performance.now(); marked.lexer(bench1k); const b2 = performance.now();
marked.lexer(bench10k); const b3 = performance.now();
marked.lexer(bench100k); const b4 = performance.now();

console.log(`[markdown-worker] benchmark: 1KB=${(b2-b1).toFixed(1)}ms, 10KB=${(b3-b2).toFixed(1)}ms, 100KB=${(b4-b3).toFixed(1)}ms`);

// Send init handshake so TugWorkerPool marks this slot as ready.
console.log("[markdown-worker] initialized, sending init handshake");
self.postMessage({ type: "init" });
