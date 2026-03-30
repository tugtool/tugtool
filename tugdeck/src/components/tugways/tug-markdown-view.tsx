/**
 * TugMarkdownView — virtualized markdown rendering component.
 *
 * Renders multi-MB markdown content at 60fps by composing BlockHeightIndex
 * and RenderedBlockWindow into a React component. Only the blocks visible in
 * the viewport (plus overscan) are present in the DOM at any time.
 *
 * Laws compliance:
 * - [L02] External state enters React through useSyncExternalStore only.
 *   Streaming text buffer uses PropertyStore + useSyncExternalStore.
 * - [L05] RAF is used ONLY for the scroll position write during auto-scroll.
 *   Never used to commit React state.
 * - [L06] Appearance changes via CSS and DOM, never React state. Spacer heights
 *   and block visibility are managed by direct DOM writes, not React state.
 * - [L19] Component authoring guide: module docstring, exported props interface,
 *   data-slot="markdown-view", file pair (tsx + css).
 *
 * Design decisions:
 * - [D03] HTML cache replaces pre-rendering (Map<number, string>, never evicted)
 * - [D04] DOMPurify at render time only
 * - [D05] Hardcoded height constants — Phase 3B refines with theme measurement
 *
 * @module components/tugways/tug-markdown-view
 */

import "./tug-markdown-view.css";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import DOMPurifyModule from "dompurify";
import { cn } from "@/lib/utils";
import { BlockHeightIndex } from "@/lib/block-height-index";
import { RenderedBlockWindow } from "@/lib/rendered-block-window";
import type { PropertyStore } from "@/components/tugways/property-store";
import { lex_blocks, parse_to_html } from "../../../crates/tugmark-wasm/pkg/tugmark_wasm.js";

// ---------------------------------------------------------------------------
// DOMPurify initialization (mirrors lib/markdown.ts strategy)
// ---------------------------------------------------------------------------

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "em", "del", "sup", "sub",
    "a", "code", "pre",
    "ul", "ol", "li",
    "blockquote",
    "table", "thead", "tbody", "tr", "th", "td",
    "img",
  ],
  ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "id"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style", "link", "meta", "base", "svg", "math"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
};

let _dompurify: ReturnType<typeof DOMPurifyModule> | null = null;

function getDOMPurify(): ReturnType<typeof DOMPurifyModule> {
  if (_dompurify && _dompurify.isSupported) return _dompurify;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win: any = typeof window !== "undefined" ? window : (global as any).window;
  _dompurify = DOMPurifyModule(win);
  return _dompurify;
}

// ---------------------------------------------------------------------------
// Block decoding helpers — translate packed Uint32Array from lex_blocks() [D05]
// ---------------------------------------------------------------------------

const STRIDE = 4;
const BLOCK_TYPES = ['?','heading','paragraph','code','blockquote','list','table','hr','html','other'];

interface BlockMeta {
  type: string;
  start: number;
  end: number;
  depth: number;
  itemCount: number;
  rowCount: number;
}

function decodeBlocks(buf: Uint32Array): BlockMeta[] {
  const count = buf.length / STRIDE;
  const blocks: BlockMeta[] = new Array(count);
  for (let i = 0, j = 0; i < buf.length; i += STRIDE, j++) {
    const w0 = buf[i];
    blocks[j] = {
      type: BLOCK_TYPES[w0 & 0xFF] ?? 'other',
      start: buf[i + 1],
      end: buf[i + 2],
      depth: (w0 >> 8) & 0xFF,
      itemCount: buf[i + 3] & 0xFFFF,
      rowCount: (buf[i + 3] >> 16) & 0xFFFF,
    };
  }
  return blocks;
}

const LINE_HEIGHT = 24;
const CODE_LINE_HEIGHT = 20;
const CODE_HEADER_HEIGHT = 36;
const HR_HEIGHT = 33;

function estimateBlockHeight(block: BlockMeta): number {
  const rawLen = block.end - block.start;
  switch (block.type) {
    case 'heading': return [0, 56, 48, 40, 36, 32, 28][block.depth] ?? LINE_HEIGHT * 2;
    case 'code': {
      const lineCount = Math.max(1, Math.round(rawLen / 40));
      return CODE_HEADER_HEIGHT + lineCount * CODE_LINE_HEIGHT;
    }
    case 'hr': return HR_HEIGHT;
    case 'list': return Math.max(1, block.itemCount) * LINE_HEIGHT * 1.5;
    case 'table': return (Math.max(1, block.rowCount) + 1) * LINE_HEIGHT * 1.5;
    case 'blockquote': return Math.max(1, Math.ceil(rawLen / 70)) * LINE_HEIGHT;
    default: return Math.max(1, Math.ceil(rawLen / 80)) * LINE_HEIGHT;
  }
}

// ---------------------------------------------------------------------------
// Overscan constant [Q01 — start at 4 screens, tune based on gallery card test]
// ---------------------------------------------------------------------------

/**
 * Number of screens above and below the viewport to keep parsed and in the
 * HTML cache. Shallow overscan causes placeholder flicker during fast scrolling;
 * deep overscan wastes work. Starts at 4 per plan [Q01].
 */
const OVERSCAN_SCREENS = 4;

// ---------------------------------------------------------------------------
// TugMarkdownViewProps
// ---------------------------------------------------------------------------

export interface TugMarkdownViewProps {
  /** Full markdown content for static rendering. Mutually exclusive with streaming mode. */
  content?: string;
  /** PropertyStore for streaming text. When set, component enters streaming mode. */
  streamingStore?: PropertyStore;
  /** PropertyStore path key for the streaming text value. Default: "text". */
  streamingPath?: string;
  /** Whether the stream is active (enables auto-scroll to tail). */
  isStreaming?: boolean;
  /** Callback when a block enters the viewport and is measured. */
  onBlockMeasured?: (index: number, measuredHeight: number) => void;
  /** CSS class for the scroll container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Internal state shape (non-React, lives in refs)
// ---------------------------------------------------------------------------

interface MarkdownEngineState {
  /**
   * The source text for static content. Main thread slices raws using offsets
   * from Phase 1 lex response (D08).
   */
  contentText: string;
  /**
   * Start character offsets per block from lex_blocks() response.
   * blockStarts[i] = character position where block i begins.
   */
  blockStarts: number[];
  /**
   * End character offsets per block from lex_blocks() response.
   * blockEnds[i] = character position where block i ends.
   * To extract block i's raw: contentText.slice(blockStarts[i], blockEnds[i])
   */
  blockEnds: number[];
  /**
   * The accumulated streaming text. Grows as deltas arrive.
   */
  accumulatedText: string;
  /** The BlockHeightIndex driving the virtual layout. */
  heightIndex: BlockHeightIndex;
  /** The sliding window manager. */
  blockWindow: RenderedBlockWindow;
  /** Map from block index to the rendered DOM node. */
  blockNodes: Map<number, HTMLElement>;
  /**
   * HTML cache: block index → unsanitized HTML string.
   * DOMPurify runs at render time in addBlockNode() [D04].
   * Never evicted (content is append-only) [D03].
   */
  htmlCache: Map<number, string>;
  /** Cache hit counter for diagnostics. */
  cacheHits: number;
  /** Cache miss counter for diagnostics. */
  cacheMisses: number;
  /** Pending scroll top for RAF coalescing [D02]. */
  pendingScrollTop: number | null;
  /** RAF handle for scroll coalescing [D02]. */
  scrollRafHandle: number | null;
  /** RAF handle for auto-scroll during streaming [L05]. */
  rafHandle: number | null;
  /** Total block count from last lex response. */
  blockCount: number;
}

const DEFAULT_VIEWPORT_HEIGHT = 600;

// ---------------------------------------------------------------------------
// TugMarkdownView component
// ---------------------------------------------------------------------------

/**
 * TugMarkdownView — virtualized markdown rendering component.
 *
 * Renders large markdown content with bounded DOM node count by keeping only
 * the visible viewport (plus overscan) in the DOM.
 *
 * @example
 * // Static rendering:
 * <TugMarkdownView content={largeMarkdownString} />
 *
 * // Streaming rendering:
 * <TugMarkdownView
 *   streamingStore={store}
 *   streamingPath="text"
 *   isStreaming={true}
 * />
 */
export function TugMarkdownView({
  content,
  streamingStore,
  streamingPath = "text",
  isStreaming = false,
  onBlockMeasured,
  className,
}: TugMarkdownViewProps) {
  // ---- DOM refs ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const blockContainerRef = useRef<HTMLDivElement>(null);

  // ---- ResizeObserver for measuring rendered blocks ----
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // ---- Engine state (mutable, lives outside React state per L06) ----
  const engineRef = useRef<MarkdownEngineState | null>(null);

  /** Initialize or get the engine state. */
  function getEngine(): MarkdownEngineState {
    if (!engineRef.current) {
      const heightIndex = new BlockHeightIndex(1024);
      const blockWindow = new RenderedBlockWindow(heightIndex, DEFAULT_VIEWPORT_HEIGHT, 2);
      engineRef.current = {
        contentText: "",
        blockStarts: [],
        blockEnds: [],
        accumulatedText: "",
        heightIndex,
        blockWindow,
        blockNodes: new Map(),
        htmlCache: new Map(),
        cacheHits: 0,
        cacheMisses: 0,
        pendingScrollTop: null,
        scrollRafHandle: null,
        rafHandle: null,
        blockCount: 0,
      };
    }
    return engineRef.current;
  }

  // ---- useSyncExternalStore for streaming path [L02] ----
  // Subscribe/getSnapshot only used in streaming mode.
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!streamingStore) return () => {};
      return streamingStore.observe(streamingPath, cb);
    },
    [streamingStore, streamingPath]
  );

  const getSnapshot = useCallback((): string => {
    if (!streamingStore) return "";
    return (streamingStore.get(streamingPath) as string) ?? "";
  }, [streamingStore, streamingPath]);

  // This call is always made (hooks must not be conditional), but it only has
  // effect when streamingStore is provided.
  const streamingText = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Suppress unused warning until lex/parse wired in Phase 3B.
  void streamingText;

  // ---- Apply spacer heights to DOM ----
  function applySpacers(topHeight: number, bottomHeight: number) {
    if (topSpacerRef.current) {
      topSpacerRef.current.style.height = `${topHeight}px`;
    }
    if (bottomSpacerRef.current) {
      bottomSpacerRef.current.style.height = `${bottomHeight}px`;
    }
  }

  // ---- Add a single block DOM node ----
  // Cache stores unsanitized HTML; DOMPurify runs here [D04].
  // If the block is not yet in the HTML cache, skip it (no placeholder).
  function addBlockNode(engine: MarkdownEngineState, index: number) {
    if (!blockContainerRef.current) return;
    if (engine.blockNodes.has(index)) return;

    const cachedHtml = engine.htmlCache.get(index);
    if (cachedHtml === undefined) {
      engine.cacheMisses++;
      return;
    }

    engine.cacheHits++;
    const sanitized = getDOMPurify().sanitize(cachedHtml, SANITIZE_CONFIG);

    const el = document.createElement("div");
    el.className = "tugx-md-block";
    el.dataset.blockIndex = String(index);
    el.innerHTML = sanitized;
    blockContainerRef.current.appendChild(el);
    engine.blockNodes.set(index, el);

    // Observe for height measurement.
    resizeObserverRef.current?.observe(el);
  }

  // ---- Remove a single block DOM node ----
  // NOTE: htmlCache is intentionally NOT evicted here. The content model is
  // append-only, so cached HTML is always valid. Retaining the cache means
  // scrolling back to a previously-rendered block is a cache hit [D03].
  function removeBlockNode(engine: MarkdownEngineState, index: number) {
    const el = engine.blockNodes.get(index);
    if (!el) return;
    resizeObserverRef.current?.unobserve(el);
    el.remove();
    engine.blockNodes.delete(index);
  }

  // ---- Apply a WindowUpdate to the DOM ----
  function applyWindowUpdate(
    engine: MarkdownEngineState,
    topSpacer: number,
    bottomSpacer: number,
    enter: { startIndex: number; endIndex: number }[],
    exit: { startIndex: number; endIndex: number }[],
  ) {
    // Remove exiting blocks
    for (const range of exit) {
      for (let i = range.startIndex; i < range.endIndex; i++) {
        removeBlockNode(engine, i);
      }
    }
    // Add entering blocks (cache hits only)
    for (const range of enter) {
      for (let i = range.startIndex; i < range.endIndex; i++) {
        addBlockNode(engine, i);
      }
    }
    applySpacers(topSpacer, bottomSpacer);
  }

  // ---- Rebuild the entire visible window from scratch ----
  function rebuildWindow(engine: MarkdownEngineState) {
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    const update = engine.blockWindow.update(scrollTop);
    applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
  }

  // ---- Compute the visible+overscan block range ----
  function computeOverscanRange(engine: MarkdownEngineState, scrollTop: number): { startIndex: number; endIndex: number } {
    const viewportHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
    const overscanPixels = viewportHeight * OVERSCAN_SCREENS;
    const rangeTop = Math.max(0, scrollTop - overscanPixels);
    const rangeBottom = scrollTop + viewportHeight + overscanPixels;
    const startIndex = engine.heightIndex.getBlockAtOffset(rangeTop);
    const endIndex = engine.heightIndex.getBlockAtOffset(rangeBottom) + 1;
    return { startIndex: Math.max(0, startIndex), endIndex: Math.min(engine.blockCount, endIndex) };
  }

  // ---- Cleanup component-scoped resources on unmount ----
  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (engine.scrollRafHandle !== null) {
        cancelAnimationFrame(engine.scrollRafHandle);
        engine.scrollRafHandle = null;
      }
      if (engine.rafHandle !== null) {
        cancelAnimationFrame(engine.rafHandle);
        engine.rafHandle = null;
      }
    };
  }, []);

  // ---- Setup ResizeObserver for block height measurement ----
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const engine = engineRef.current;
      if (!engine) return;
      let anyChanged = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const indexStr = el.dataset.blockIndex;
        if (indexStr === undefined) continue;
        const index = parseInt(indexStr, 10);
        if (isNaN(index)) continue;
        const measured = entry.contentRect.height;
        const current = engine.heightIndex.getHeight(index);
        if (Math.abs(measured - current) > 0.5) {
          engine.heightIndex.setHeight(index, measured);
          onBlockMeasured?.(index, measured);
          anyChanged = true;
        }
      }
      if (anyChanged) {
        // Recompute spacers after height updates [L06: DOM write, not React state]
        const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
        const update = engine.blockWindow.update(scrollTop);
        applySpacers(update.topSpacerHeight, update.bottomSpacerHeight);
      }
    });
    resizeObserverRef.current = observer;
    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [onBlockMeasured]);

  // ---- Update viewport height on container resize ----
  useLayoutEffect(() => {
    if (!scrollContainerRef.current) return;
    const engine = getEngine();
    const resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0) {
          engine.blockWindow.setViewportHeight(h);
          rebuildWindow(engine);
        }
      }
    });
    resizeObs.observe(scrollContainerRef.current);
    return () => resizeObs.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Static rendering path ----
  useEffect(() => {
    if (content === undefined) return;
    const engine = getEngine();

    // Clear previous state
    engine.heightIndex.clear();
    engine.blockWindow.setViewportHeight(scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT);
    for (const [, el] of engine.blockNodes) {
      resizeObserverRef.current?.unobserve(el);
      el.remove();
    }
    engine.blockNodes.clear();
    engine.htmlCache.clear();
    engine.cacheHits = 0;
    engine.cacheMisses = 0;
    engine.blockStarts = [];
    engine.blockEnds = [];
    engine.blockCount = 0;
    engine.contentText = content;
    applySpacers(0, 0);

    // Lex: synchronous WASM call
    const packed = lex_blocks(content);
    const blocks = decodeBlocks(packed);
    engine.blockCount = blocks.length;
    engine.blockStarts = blocks.map(b => b.start);
    engine.blockEnds = blocks.map(b => b.end);

    // Populate height index with estimates
    for (const block of blocks) {
      engine.heightIndex.appendBlock(estimateBlockHeight(block));
    }

    // Parse visible + overscan blocks and populate HTML cache
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    const viewportHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
    engine.blockWindow.setViewportHeight(viewportHeight);
    const range = computeOverscanRange(engine, scrollTop);
    for (let i = range.startIndex; i < range.endIndex; i++) {
      if (!engine.htmlCache.has(i)) {
        const raw = content.slice(engine.blockStarts[i], engine.blockEnds[i]);
        engine.htmlCache.set(i, parse_to_html(raw));
      }
    }

    // Enter visible blocks into DOM
    const update = engine.blockWindow.update(scrollTop);
    applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- RAF-coalesced scroll handler [D02, L05] ----
  const handleScroll = useCallback(() => {
    const engine = getEngine();
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;

    // Update pending scroll position and request RAF if not already pending.
    engine.pendingScrollTop = scrollTop;
    if (engine.scrollRafHandle !== null) return;

    engine.scrollRafHandle = requestAnimationFrame(() => {
      engine.scrollRafHandle = null;
      const pendingTop = engine.pendingScrollTop ?? scrollTop;
      engine.pendingScrollTop = null;

      // Update window (handles enter/exit for cached blocks)
      const update = engine.blockWindow.update(pendingTop);
      applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);

      // Parse uncached blocks in overscan range on demand
      const newRange = computeOverscanRange(engine, pendingTop);
      let anyNew = false;
      for (let i = newRange.startIndex; i < newRange.endIndex; i++) {
        if (!engine.htmlCache.has(i) && engine.blockStarts[i] !== undefined) {
          const raw = engine.contentText.slice(engine.blockStarts[i], engine.blockEnds[i]);
          engine.htmlCache.set(i, parse_to_html(raw));
          anyNew = true;
        }
      }
      if (anyNew) {
        rebuildWindow(engine);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Streaming rendering path — TODO: wire lex/parse in Phase 3B ----
  useEffect(() => {
    if (!streamingStore) return;
    // TODO: Phase 3B — implement incremental tail lex/parse for streaming
  }, [streamingText, streamingStore]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Finalization pass on turn_complete — TODO: wire in Phase 3B ----
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && streamingStore) {
      // TODO: Phase 3B — finalization lex pass on full accumulated text
    }
  }, [isStreaming, streamingStore, streamingPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={scrollContainerRef}
      data-slot="markdown-view"
      className={cn("tugx-md-scroll-container", className)}
      onScroll={handleScroll}
    >
      <div ref={topSpacerRef} className="tugx-md-spacer tugx-md-spacer--top" aria-hidden="true" />
      <div ref={blockContainerRef} className="tugx-md-block-container" />
      <div ref={bottomSpacerRef} className="tugx-md-spacer tugx-md-spacer--bottom" aria-hidden="true" />
    </div>
  );
}
