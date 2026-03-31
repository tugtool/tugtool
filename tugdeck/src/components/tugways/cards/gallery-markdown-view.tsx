/**
 * GalleryMarkdownView -- TugMarkdownView visual and performance verification card.
 *
 * Demonstrates TugMarkdownView in three modes:
 *   1. Static 1MB: large markdown string with smooth scrolling verification
 *   2. Streaming: simulated assistant_text deltas via PropertyStore + auto-scroll
 *   3. Stress 10MB: DOM node count verification (<500 nodes)
 *
 * The diagnostic overlay shows:
 *   - DOM node count in the scroll container
 *   - Total block count
 *   - WASM lex time (ms) and parse time (ms) from the onTiming callback
 *   - Streaming progress
 *
 * Laws compliance:
 *   [L22] Streaming text buffer uses PropertyStore observed directly in TugMarkdownView
 *
 * @module components/tugways/cards/gallery-markdown-view
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PropertyStore } from "@/components/tugways/property-store";
import { TugMarkdownView } from "@/components/tugways/tug-markdown-view";
import type { TugMarkdownTimingMetrics } from "@/components/tugways/tug-markdown-view";
import { TugPushButton } from "@/components/tugways/tug-push-button";

// ---------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------

/**
 * Generates a realistic markdown document of approximately the requested byte size.
 * Repeats a pattern of headings, paragraphs, code blocks, and lists.
 */
function generateMarkdown(targetBytes: number): string {
  const UNIT = `## Section Heading

This is a paragraph of realistic prose content. It discusses the implementation details of a virtualized rendering engine. The engine uses a BlockHeightIndex data structure backed by a Float64Array prefix sum to achieve O(log n) scroll offset lookups. This paragraph is roughly 300 characters long including spaces and punctuation, which is typical for real conversation content.

Another paragraph follows immediately. It continues the discussion of the sliding window algorithm. The RenderedBlockWindow maintains a contiguous range of blocks with DOM nodes, diffing the viewport on each scroll event to add entering blocks and remove exiting blocks. Overscan of two screens prevents flicker during fast scrolling.

### Code Example

\`\`\`typescript
class BlockHeightIndex {
  private heights: Float64Array;
  private prefixSum: Float64Array;
  private watermark: number;
  private _count: number;

  constructor(initialCapacity = 1024) {
    this.heights = new Float64Array(initialCapacity);
    this.prefixSum = new Float64Array(initialCapacity + 1);
    this.watermark = 0;
    this._count = 0;
  }

  appendBlock(estimatedHeight: number): number {
    const index = this._count;
    this.heights[index] = estimatedHeight;
    this._count++;
    if (index < this.watermark) this.watermark = index;
    return index;
  }
}
\`\`\`

### List of Features

- Virtualized rendering: only viewport-visible blocks are in the DOM
- Float64Array prefix sum for O(log n) offset lookups
- Lazy recomputation from the dirty watermark forward
- Binary search for scroll offset to block index mapping
- Overscan of 2 screens above and below the viewport
- ResizeObserver-based height measurement and refinement
- Streaming path: incremental tail lexing, auto-scroll to tail
- Finalization pass on turn_complete for streaming consistency

> **Note:** The height estimation uses hardcoded constants per block type. A paragraph is estimated as lineCount × LINE_HEIGHT, where LINE_HEIGHT is 24px. Headings use per-level constants. Code blocks add a header height plus lineCount × CODE_LINE_HEIGHT.

---

`;

  // Use array + join instead of += to avoid O(n²) string concatenation [Bug 3 fix].
  const parts: string[] = [
    '# Virtualized Markdown Rendering Engine\n\n',
    `Generated: ${new Date().toISOString()} | Target: ${(targetBytes / 1024 / 1024).toFixed(1)}MB\n\n`,
  ];
  const repeats = Math.ceil(targetBytes / UNIT.length);
  for (let i = 0; i < repeats; i++) {
    parts.push(UNIT.replace("## Section Heading", `## Section ${i + 1}`));
  }
  return parts.join('');
}

// Pre-generate content at module scope so it is not regenerated on re-render.
// 1MB static content for the default demo
const STATIC_1MB_CONTENT = generateMarkdown(1024 * 1024);

// Streaming simulation: chunks of ~200 characters of realistic prose
const STREAMING_CHUNKS: string[] = (() => {
  const prose = `# Streaming Demo

This content is streamed incrementally to simulate a live Claude response. Each chunk arrives at a realistic rate, exercising the streaming rendering path and auto-scroll behavior.

## Architecture Overview

The streaming rendering path observes the PropertyStore directly via a useLayoutEffect subscription [L22]. On each text update, the component re-lexes the full accumulated text using pulldown-cmark compiled to WASM, reconciles the resulting block list against the previous one, and writes DOM changes directly — no React round-trip.

### Key Properties

- **Direct store observation**: PropertyStore observer fires synchronously, DOM updates in the same call [L22]
- **Full re-lex per update**: lex_blocks() on the full text each delta (~0.1ms for typical streaming chunks)
- **Block reconciliation**: changed blocks update innerHTML; new blocks append to the height index
- **Auto-scroll**: direct scrollTop write on each update [L06]

\`\`\`typescript
// On each store update, re-lex the full accumulated text:
const packed = lex_blocks(text);
const newBlocks = decodeBlocks(packed);

// Reconcile against previous block list:
for (let i = 0; i < Math.min(oldCount, newCount); i++) {
  if (newStarts[i] !== engine.blockStarts[i] || newEnds[i] !== engine.blockEnds[i]) {
    const html = parse_to_html(text.slice(newStarts[i], newEnds[i]));
    engine.htmlCache.set(i, html);
    engine.blockNodes.get(i)?.setAttribute('innerHTML', sanitize(html));
  }
}
// Append new blocks
for (let i = oldCount; i < newCount; i++) {
  engine.heightIndex.appendBlock(estimateBlockHeight(newBlocks[i]));
  engine.htmlCache.set(i, parse_to_html(text.slice(newStarts[i], newEnds[i])));
}
\`\`\`

## Performance Characteristics

The BlockHeightIndex binary search completes in under 1ms for 100K blocks because Float64Array layout is cache-friendly. The prefix sum recomputation is lazy: the watermark tracks the lowest dirty index, so setHeight() at index i costs O(n - i) — only recomputes from the dirty point forward, not from the beginning.

The RenderedBlockWindow keeps DOM node count bounded regardless of content size. With 2-screen overscan at a viewport height of 600px, the maximum DOM node count is approximately 5 × (600 / estimatedBlockHeight) blocks. For typical paragraph height of ~48px, that is about 5 × 12 = 60 DOM nodes — well within the <500 target.

### Scrollbar Accuracy

Before blocks are measured, the scrollbar accuracy depends on the quality of height estimates. With hardcoded constants (LINE_HEIGHT = 24px, paragraph padding = 8px), a paragraph of 80 characters estimates at 32px. After ResizeObserver measurement, the actual height is used. The 5% scrollbar accuracy target means a 10MB document's total estimated height should be within 5% of the true height.

## Conclusion

The virtualized rendering engine delivers bounded DOM node count, smooth scrolling at 60fps, and both static and streaming rendering paths. Lexing and parsing use pulldown-cmark compiled to WASM (tugmark-wasm). Scroll handling is pure DOM window management — zero WASM calls during scroll.

`;
  // Split into ~200-char chunks at word boundaries
  const chunks: string[] = [];
  let pos = 0;
  while (pos < prose.length) {
    const end = Math.min(pos + 200, prose.length);
    // Find the next space after `end` to avoid splitting mid-word
    let boundary = end;
    while (boundary < prose.length && prose[boundary] !== " " && prose[boundary] !== "\n") {
      boundary++;
    }
    chunks.push(prose.slice(pos, boundary));
    pos = boundary;
  }
  return chunks;
})();

// ---------------------------------------------------------------------------
// Diagnostic overlay hook
// ---------------------------------------------------------------------------

interface DiagnosticInfo {
  domNodeCount: number;
  windowStart: number;
  windowEnd: number;
  totalBlocks: number;
  streamProgress: string;
  lexMs: number | null;
  parseMs: number | null;
}

// ---------------------------------------------------------------------------
// GalleryMarkdownView
// ---------------------------------------------------------------------------

/**
 * GalleryMarkdownView -- TugMarkdownView visual and performance verification card.
 *
 * Provides three demo modes:
 * - Static 1MB: standard static content demo
 * - Streaming: simulated assistant_text deltas at 40ms intervals
 * - Stress 10MB: stress test for DOM node count verification
 */
export function GalleryMarkdownView() {
  type DemoMode = "static-1mb" | "streaming" | "stress-10mb";
  const [mode, setMode] = useState<DemoMode>("static-1mb");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamDone, setStreamDone] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticInfo>({
    domNodeCount: 0,
    windowStart: 0,
    windowEnd: 0,
    totalBlocks: 0,
    streamProgress: "idle",
    lexMs: null,
    parseMs: null,
  });

  // Streaming store — Spec S04
  const streamingStoreRef = useRef<PropertyStore | null>(null);
  if (!streamingStoreRef.current) {
    streamingStoreRef.current = new PropertyStore({
      schema: [{ path: "text", type: "string", label: "Streaming text" }],
      initialValues: { text: "" },
    });
  }
  const streamingStore = streamingStoreRef.current;

  // Streaming simulation refs
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamChunkIndexRef = useRef(0);
  const streamAccumulatedRef = useRef("");

  // Scroll container ref for diagnostic DOM count
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Diagnostic polling
  useEffect(() => {
    const pollDiagnostics = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
      // Count .tugx-md-block elements inside the scroll container
      const blockNodes = container.querySelectorAll(".tugx-md-block");
      setDiagnostics((prev) => ({
        ...prev,
        domNodeCount: blockNodes.length,
      }));
    };

    const intervalId = setInterval(pollDiagnostics, 500);
    return () => clearInterval(intervalId);
  }, []);

  // Update diagnostic from onBlockMeasured callback
  const handleBlockMeasured = useCallback((_index: number, _height: number) => {
    // Increment block count in diagnostics
    setDiagnostics((prev) => ({
      ...prev,
      totalBlocks: Math.max(prev.totalBlocks, _index + 1),
    }));
  }, []);

  // Update timing diagnostics from onTiming callback
  const handleTiming = useCallback((metrics: TugMarkdownTimingMetrics) => {
    setDiagnostics((prev) => ({
      ...prev,
      lexMs: metrics.lexMs,
      parseMs: metrics.parseMs,
      totalBlocks: metrics.blockCount > 0 ? metrics.blockCount : prev.totalBlocks,
    }));
  }, []);

  // Start streaming simulation
  const startStreaming = useCallback(() => {
    if (streamIntervalRef.current) return;
    streamChunkIndexRef.current = 0;
    streamAccumulatedRef.current = "";
    streamingStore.set("text", "", "gallery");
    setIsStreaming(true);
    setStreamDone(false);
    setDiagnostics((prev) => ({
      ...prev,
      streamProgress: "streaming...",
      totalBlocks: 0,
      lexMs: null,
      parseMs: null,
    }));

    streamIntervalRef.current = setInterval(() => {
      const idx = streamChunkIndexRef.current;
      if (idx >= STREAMING_CHUNKS.length) {
        // Done
        clearInterval(streamIntervalRef.current!);
        streamIntervalRef.current = null;
        setIsStreaming(false);
        setStreamDone(true);
        setDiagnostics((prev) => ({
          ...prev,
          streamProgress: `complete (${STREAMING_CHUNKS.length} chunks)`,
        }));
        return;
      }
      streamAccumulatedRef.current += STREAMING_CHUNKS[idx];
      streamingStore.set("text", streamAccumulatedRef.current, "transport");
      streamChunkIndexRef.current++;
      setDiagnostics((prev) => ({
        ...prev,
        streamProgress: `chunk ${idx + 1}/${STREAMING_CHUNKS.length}`,
      }));
    }, 40); // ~25 chunks/s, realistic delta rate
  }, [streamingStore]);

  const stopStreaming = useCallback(() => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const resetStreaming = useCallback(() => {
    stopStreaming();
    streamAccumulatedRef.current = "";
    streamChunkIndexRef.current = 0;
    streamingStore.set("text", "", "gallery");
    setStreamDone(false);
    setDiagnostics((prev) => ({
      ...prev,
      streamProgress: "idle",
      totalBlocks: 0,
      lexMs: null,
      parseMs: null,
    }));
  }, [stopStreaming, streamingStore]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
      }
    };
  }, []);

  // NOTE: Static content wiring removed in Phase 3A.5 Step 2.
  // The content prop no longer exists; TugMarkdownView is now imperative only.
  // Step 3 will wire the gallery card via the ref handle (setRegion).

  return (
    <div className="cg-content" data-testid="gallery-markdown-view" style={{ padding: 0, gap: 0, overflow: "hidden", height: "100%" }}>
      {/* ---- Mode selector and controls ---- */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--tug7-element-global-border-normal-default-rest)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span className="cg-section-title" style={{ margin: 0 }}>Mode:</span>
        <TugPushButton
          emphasis={mode === "static-1mb" ? "filled" : "outlined"}
          role="action"
          size="sm"
          onClick={() => { stopStreaming(); setMode("static-1mb"); }}
        >
          Static 1MB
        </TugPushButton>
        <TugPushButton
          emphasis={mode === "streaming" ? "filled" : "outlined"}
          role="action"
          size="sm"
          onClick={() => { setMode("streaming"); resetStreaming(); }}
        >
          Streaming
        </TugPushButton>
        <TugPushButton
          emphasis={mode === "stress-10mb" ? "filled" : "outlined"}
          role="action"
          size="sm"
          onClick={() => { stopStreaming(); setMode("stress-10mb"); }}
        >
          Stress 10MB
        </TugPushButton>

        {mode === "streaming" && (
          <>
            <div style={{ width: 1, height: 20, background: "var(--tug7-element-global-border-normal-default-rest)" }} />
            {!isStreaming && !streamDone && (
              <TugPushButton emphasis="filled" role="accent" size="sm" onClick={startStreaming}>
                Start Stream
              </TugPushButton>
            )}
            {isStreaming && (
              <TugPushButton emphasis="outlined" role="danger" size="sm" onClick={stopStreaming}>
                Stop
              </TugPushButton>
            )}
            {streamDone && (
              <TugPushButton emphasis="outlined" role="action" size="sm" onClick={resetStreaming}>
                Reset
              </TugPushButton>
            )}
          </>
        )}

        {/* Diagnostic overlay */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center", fontSize: 11, fontFamily: "var(--tugx-md-mono-font, ui-monospace, monospace)", color: "var(--tug7-element-global-text-normal-muted-rest)" }}>
          <span>DOM nodes: <strong>{diagnostics.domNodeCount}</strong></span>
          <span>Blocks: <strong>{diagnostics.totalBlocks}</strong></span>
          {diagnostics.lexMs !== null && (
            <span>Lex: <strong>{diagnostics.lexMs.toFixed(1)}ms</strong></span>
          )}
          {diagnostics.parseMs !== null && (
            <span>Parse: <strong>{diagnostics.parseMs.toFixed(1)}ms</strong></span>
          )}
          {mode === "streaming" && (
            <span>Progress: <strong>{diagnostics.streamProgress}</strong></span>
          )}
          {mode === "stress-10mb" && (
            <span style={{ color: diagnostics.domNodeCount > 500 ? "var(--tug7-element-global-fill-normal-danger-rest, red)" : "inherit" }}>
              {diagnostics.domNodeCount <= 500 ? "PASS" : "FAIL"} (&lt;500 nodes)
            </span>
          )}
        </div>
      </div>

      {/* ---- Markdown view ---- */}
      <div ref={scrollContainerRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {(mode === "static-1mb" || mode === "stress-10mb") && (
          <TugMarkdownView
            onBlockMeasured={handleBlockMeasured}
            onTiming={handleTiming}
            className="gallery-md-view"
          />
        )}
        {mode === "streaming" && (
          <TugMarkdownView
            streamingStore={streamingStore}
            streamingPath="text"
            isStreaming={isStreaming}
            onBlockMeasured={handleBlockMeasured}
            onTiming={handleTiming}
            className="gallery-md-view"
          />
        )}
      </div>
    </div>
  );
}
