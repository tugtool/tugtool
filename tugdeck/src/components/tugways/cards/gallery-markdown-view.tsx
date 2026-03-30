/**
 * GalleryMarkdownView -- TugMarkdownView visual and performance verification card.
 *
 * Demonstrates TugMarkdownView in two modes:
 *   1. Static: large markdown string (1MB+) with smooth scrolling verification
 *   2. Streaming: simulated assistant_text deltas via PropertyStore + auto-scroll
 *
 * Also includes a 10MB stress test for DOM node count verification.
 *
 * The diagnostic overlay shows:
 *   - DOM node count in the scroll container
 *   - Current window range [startIndex, endIndex)
 *   - Total block count
 *   - Streaming progress
 *
 * Design decisions:
 *   [D03] Lib + component split — data structures live in lib/, component in tugways/
 *   Spec S04 — PropertyStore schema for streaming path
 *
 * Laws compliance:
 *   [L02] Streaming text buffer uses PropertyStore + useSyncExternalStore
 *
 * @module components/tugways/cards/gallery-markdown-view
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PropertyStore } from "@/components/tugways/property-store";
import { TugMarkdownView } from "@/components/tugways/tug-markdown-view";
import type { MarkdownDiagnostics } from "@/components/tugways/tug-markdown-view";
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

  const unitLen = UNIT.length;
  const repeats = Math.ceil(targetBytes / unitLen);
  let result = `# Virtualized Markdown Rendering Engine\n\n`;
  result += `Generated: ${new Date().toISOString()} | Target: ${(targetBytes / 1024 / 1024).toFixed(1)}MB\n\n`;
  for (let i = 0; i < repeats; i++) {
    result += UNIT.replace("## Section Heading", `## Section ${i + 1}`);
  }
  return result;
}

// Pre-generate content at module scope so it is not regenerated on re-render.
// 1MB static content for the default demo
const STATIC_1MB_CONTENT = generateMarkdown(1024 * 1024);

// Streaming simulation: chunks of ~200 characters of realistic prose
const STREAMING_CHUNKS: string[] = (() => {
  const prose = `# Streaming Demo

This content is streamed incrementally to simulate a live Claude response. Each chunk arrives at a realistic rate, exercising the incremental tail lexing path and auto-scroll behavior.

## Architecture Overview

The streaming rendering path uses PropertyStore with useSyncExternalStore [L02] to deliver strict React compliance. On each text update, the component re-lexes only from the start of the last stable block boundary — not the full accumulated text. This bounds the re-lex work to O(k) where k is the number of recently changed blocks.

### Key Properties

- **Incremental lexing**: Re-lex only from the last stable boundary
- **Dirty tracking**: Mark blocks dirty when content changes
- **Auto-scroll**: RAF-based scroll write [L05] on each update
- **Finalization pass**: Re-lex full tail on turn_complete [R02]

\`\`\`typescript
// On each text update, re-lex from last stable boundary:
const tailText = newText.slice(relexFromOffset);
const tailTokens = marked.lexer(tailText).filter(t => t.type !== "space");

// Reconcile tail tokens against existing blocks:
for (let ti = 0; ti < tailTokens.length; ti++) {
  const blockIndex = relexFromIndex + ti;
  if (blockIndex < oldCount) {
    // Update existing block if content changed
    engine.tokens[blockIndex] = tailTokens[ti];
  } else {
    // Append new block
    engine.tokens.push(tailTokens[ti]);
    engine.heightIndex.appendBlock(estimateBlockHeight(tailTokens[ti]));
  }
}
\`\`\`

## Performance Characteristics

The BlockHeightIndex binary search completes in under 1ms for 100K blocks because Float64Array layout is cache-friendly. The prefix sum recomputation is lazy: the watermark tracks the lowest dirty index, so setHeight() at index i costs O(n - i) — only recomputes from the dirty point forward, not from the beginning.

The RenderedBlockWindow keeps DOM node count bounded regardless of content size. With 2-screen overscan at a viewport height of 600px, the maximum DOM node count is approximately 5 × (600 / estimatedBlockHeight) blocks. For typical paragraph height of ~48px, that is about 5 × 12 = 60 DOM nodes — well within the <500 target.

### Scrollbar Accuracy

Before blocks are measured, the scrollbar accuracy depends on the quality of height estimates. With hardcoded constants (LINE_HEIGHT = 24px, paragraph padding = 8px), a paragraph of 80 characters estimates at 32px. After ResizeObserver measurement, the actual height is used. The 5% scrollbar accuracy target means a 10MB document's total estimated height should be within 5% of the true height.

## Conclusion

The virtualized rendering engine delivers bounded DOM node count, smooth scrolling at 60fps, and both static and streaming rendering paths. Phase 3B will add content-type-specific rendering: Shiki syntax highlighting for code blocks, thinking block display, and tool use visualization.

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
  });
  const [workerDiagnostics, setWorkerDiagnostics] = useState<MarkdownDiagnostics | null>(null);

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

  // Update worker diagnostics from onDiagnostics callback
  const handleDiagnostics = useCallback((metrics: MarkdownDiagnostics) => {
    setWorkerDiagnostics(metrics);
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

  // Determine content for static modes
  const staticContent = mode === "static-1mb"
    ? STATIC_1MB_CONTENT
    : mode === "stress-10mb"
    ? undefined // generated lazily below
    : undefined;

  const stress10mbContent = useRef<string | null>(null);
  if (mode === "stress-10mb" && !stress10mbContent.current) {
    stress10mbContent.current = generateMarkdown(10 * 1024 * 1024);
  }

  const resolvedContent = mode === "static-1mb"
    ? STATIC_1MB_CONTENT
    : mode === "stress-10mb"
    ? (stress10mbContent.current ?? "")
    : undefined;

  return (
    <div className="cg-content" data-testid="gallery-markdown-view" style={{ padding: 0, gap: 0, overflow: "hidden", height: "100%" }}>
      {/* ---- Mode selector and controls ---- */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--tug7-element-global-border-normal-default-rest)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span className="cg-section-title" style={{ margin: 0 }}>Mode:</span>
        <TugPushButton
          emphasis={mode === "static-1mb" ? "filled" : "outlined"}
          role="action"
          size="sm"
          onClick={() => { stopStreaming(); setMode("static-1mb"); setWorkerDiagnostics(null); }}
        >
          Static 1MB
        </TugPushButton>
        <TugPushButton
          emphasis={mode === "streaming" ? "filled" : "outlined"}
          role="action"
          size="sm"
          onClick={() => { setMode("streaming"); resetStreaming(); setWorkerDiagnostics(null); }}
        >
          Streaming
        </TugPushButton>
        <TugPushButton
          emphasis={mode === "stress-10mb" ? "filled" : "outlined"}
          role="action"
          size="sm"
          onClick={() => { stopStreaming(); setMode("stress-10mb"); setWorkerDiagnostics(null); }}
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
          {workerDiagnostics !== null && (
            <>
              <span>Pool: <strong>{workerDiagnostics.poolSize}</strong></span>
              <span>In-flight: <strong>{workerDiagnostics.inFlightTasks}</strong></span>
              <span>Cache: <strong>{workerDiagnostics.cacheSize}</strong></span>
              <span>Hit rate: <strong>{(workerDiagnostics.cacheHitRate * 100).toFixed(0)}%</strong></span>
            </>
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
            content={resolvedContent}
            onBlockMeasured={handleBlockMeasured}
            onDiagnostics={handleDiagnostics}
            className="gallery-md-view"
          />
        )}
        {mode === "streaming" && (
          <TugMarkdownView
            streamingStore={streamingStore}
            streamingPath="text"
            isStreaming={isStreaming}
            onBlockMeasured={handleBlockMeasured}
            onDiagnostics={handleDiagnostics}
            className="gallery-md-view"
          />
        )}
      </div>
    </div>
  );
}
