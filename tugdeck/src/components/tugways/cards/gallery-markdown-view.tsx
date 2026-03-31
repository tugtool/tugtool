/**
 * GalleryMarkdownView -- TugMarkdownView visual and performance verification card.
 *
 * Mounts a single TugMarkdownView with an imperative ref handle. A size selector
 * (50KB | 1MB | 10MB) and four action buttons drive content:
 *
 *   Size selector  -- three toggle buttons (50KB | 1MB | 10MB) that set the target
 *                     size for Stream and Static actions. Default: 50KB.
 *   Stream         -- visible when NOT streaming. Generates chunks for the selected
 *                     size and streams them incrementally via PropertyStore.
 *   Stop           -- visible WHILE streaming. Stops the stream; content stays.
 *   Static         -- always visible. Dumps the selected size instantly via setRegion().
 *   Clear          -- always visible. Stops streaming, resets store, calls clear().
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
import type { TugMarkdownViewHandle, TugMarkdownTimingMetrics } from "@/components/tugways/tug-markdown-view";
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

// Pre-generate static content at module scope so it is not regenerated on re-render.
const STATIC_50KB_CONTENT = generateMarkdown(50 * 1024);
const STATIC_1MB_CONTENT = generateMarkdown(1024 * 1024);

// ---------------------------------------------------------------------------
// Dynamic chunk generation
// ---------------------------------------------------------------------------

/**
 * Generates streaming chunks for the given target byte size.
 * Splits at word boundaries into ~200-char pieces.
 */
function generateChunks(targetBytes: number): string[] {
  const text = generateMarkdown(targetBytes);
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const end = Math.min(pos + 200, text.length);
    let boundary = end;
    while (boundary < text.length && text[boundary] !== ' ' && text[boundary] !== '\n') {
      boundary++;
    }
    chunks.push(text.slice(pos, boundary));
    pos = boundary;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Size selector type
// ---------------------------------------------------------------------------

type SizeKey = '50kb' | '1mb' | '10mb';

function sizeToBytes(size: SizeKey): number {
  switch (size) {
    case '50kb': return 50 * 1024;
    case '1mb': return 1024 * 1024;
    case '10mb': return 10 * 1024 * 1024;
  }
}

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
 * A single TugMarkdownView is always mounted. A size selector (50KB | 1MB | 10MB)
 * controls the content size for Stream and Static actions.
 */
export function GalleryMarkdownView() {
  const [selectedSize, setSelectedSize] = useState<SizeKey>('50kb');
  const [isStreaming, setIsStreaming] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticInfo>({
    domNodeCount: 0,
    windowStart: 0,
    windowEnd: 0,
    totalBlocks: 0,
    streamProgress: "idle",
    lexMs: null,
    parseMs: null,
  });

  // Imperative ref to TugMarkdownView
  const markdownRef = useRef<TugMarkdownViewHandle>(null);

  // Streaming store
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
  const streamChunksRef = useRef<string[]>([]);

  // Scroll container ref for diagnostic DOM count
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 10MB content — generated lazily on first use
  const static10MbContentRef = useRef<string | null>(null);

  // Diagnostic polling
  useEffect(() => {
    const pollDiagnostics = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
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

  // Stop streaming helper (does not clear content)
  const stopStreamingOnly = useCallback(() => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // ---- Action: Stream ----
  const handleStream = useCallback(() => {
    if (streamIntervalRef.current) return;

    // Generate fresh chunks for the selected size
    const chunks = generateChunks(sizeToBytes(selectedSize));
    streamChunksRef.current = chunks;
    streamChunkIndexRef.current = 0;
    streamAccumulatedRef.current = "";
    streamingStore.set("text", "", "gallery");
    setIsStreaming(true);
    setDiagnostics((prev) => ({
      ...prev,
      streamProgress: "streaming...",
      totalBlocks: 0,
      lexMs: null,
      parseMs: null,
    }));

    streamIntervalRef.current = setInterval(() => {
      const currentChunks = streamChunksRef.current;
      const idx = streamChunkIndexRef.current;
      if (idx >= currentChunks.length) {
        clearInterval(streamIntervalRef.current!);
        streamIntervalRef.current = null;
        setIsStreaming(false);
        setDiagnostics((prev) => ({
          ...prev,
          streamProgress: `complete (${currentChunks.length} chunks)`,
        }));
        return;
      }
      streamAccumulatedRef.current += currentChunks[idx];
      streamingStore.set("text", streamAccumulatedRef.current, "transport");
      streamChunkIndexRef.current++;
      setDiagnostics((prev) => ({
        ...prev,
        streamProgress: `chunk ${idx + 1}/${currentChunks.length}`,
      }));
    }, 40); // ~25 chunks/s, realistic delta rate
  }, [selectedSize, streamingStore]);

  // ---- Action: Stop ----
  const handleStop = useCallback(() => {
    stopStreamingOnly();
  }, [stopStreamingOnly]);

  // ---- Action: Static ----
  const handleStatic = useCallback(() => {
    const targetBytes = sizeToBytes(selectedSize);
    let content: string;
    if (selectedSize === '50kb') {
      content = STATIC_50KB_CONTENT;
    } else if (selectedSize === '1mb') {
      content = STATIC_1MB_CONTENT;
    } else {
      // 10MB: generate lazily, reuse on subsequent clicks
      if (!static10MbContentRef.current) {
        static10MbContentRef.current = generateMarkdown(targetBytes);
      }
      content = static10MbContentRef.current;
    }
    markdownRef.current?.setRegion('static-' + Date.now(), content);
  }, [selectedSize]);

  // ---- Action: Clear ----
  const handleClear = useCallback(() => {
    stopStreamingOnly();
    streamAccumulatedRef.current = "";
    streamChunkIndexRef.current = 0;
    streamingStore.set("text", "", "gallery");
    markdownRef.current?.clear();
    setDiagnostics((prev) => ({
      ...prev,
      streamProgress: "idle",
      totalBlocks: 0,
      lexMs: null,
      parseMs: null,
    }));
  }, [stopStreamingOnly, streamingStore]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
      }
    };
  }, []);

  return (
    <div className="cg-content" data-testid="gallery-markdown-view" style={{ padding: 0, gap: 0, overflow: "hidden", height: "100%" }}>
      {/* ---- Controls and diagnostics ---- */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--tug7-element-global-border-normal-default-rest)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>

        {/* Size selector: 50KB | 1MB | 10MB */}
        <div style={{ display: "flex", gap: 4 }}>
          <TugPushButton
            emphasis={selectedSize === '50kb' ? 'filled' : 'outlined'}
            role="action"
            size="sm"
            onClick={() => setSelectedSize('50kb')}
          >
            50KB
          </TugPushButton>
          <TugPushButton
            emphasis={selectedSize === '1mb' ? 'filled' : 'outlined'}
            role="action"
            size="sm"
            onClick={() => setSelectedSize('1mb')}
          >
            1MB
          </TugPushButton>
          <TugPushButton
            emphasis={selectedSize === '10mb' ? 'filled' : 'outlined'}
            role="action"
            size="sm"
            onClick={() => setSelectedSize('10mb')}
          >
            10MB
          </TugPushButton>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: "var(--tug7-element-global-border-normal-default-rest)", flexShrink: 0 }} />

        {/* Stream/Stop — fixed-width wrapper to prevent layout jump */}
        <div style={{ minWidth: 80 }}>
          {!isStreaming ? (
            <TugPushButton emphasis="outlined" role="accent" size="sm" onClick={handleStream}>
              Stream
            </TugPushButton>
          ) : (
            <TugPushButton emphasis="outlined" role="danger" size="sm" onClick={handleStop}>
              Stop
            </TugPushButton>
          )}
        </div>

        <TugPushButton emphasis="outlined" role="action" size="sm" onClick={handleStatic}>
          Static
        </TugPushButton>

        <TugPushButton emphasis="outlined" role="action" size="sm" onClick={handleClear}>
          Clear
        </TugPushButton>

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
          <span>Progress: <strong>{diagnostics.streamProgress}</strong></span>
        </div>
      </div>

      {/* ---- Single always-mounted TugMarkdownView ---- */}
      <div ref={scrollContainerRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <TugMarkdownView
          ref={markdownRef}
          streamingStore={streamingStore}
          streamingPath="text"
          onBlockMeasured={handleBlockMeasured}
          onTiming={handleTiming}
          className="gallery-md-view"
        />
      </div>
    </div>
  );
}
