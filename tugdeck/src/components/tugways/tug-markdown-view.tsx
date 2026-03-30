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
 * - [D01] Two-phase lex/parse pipeline via TugWorkerPool
 * - [D02] Viewport-priority parsing with scroll coalescing
 * - [D03] HTML cache replaces pre-rendering (Map<number, string>, never evicted)
 * - [D04] DOMPurify at render time only — workers return unsanitized HTML
 * - [D05] Hardcoded height constants — Phase 3B refines with theme measurement
 * - [D07] Graceful degradation to main-thread inline execution via fallbackHandler
 * - [D08] Parse workers re-lex from raw strings (no Token cloning)
 *
 * @module components/tugways/tug-markdown-view
 */

import "./tug-markdown-view.css";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurifyModule from "dompurify";
import { cn } from "@/lib/utils";
import { BlockHeightIndex } from "@/lib/block-height-index";
import { DefaultTextEstimator } from "@/lib/markdown-height-estimator";
import { RenderedBlockWindow } from "@/lib/rendered-block-window";
import { TugWorkerPool } from "@/lib/tug-worker-pool";
import type { TaskHandle } from "@/lib/tug-worker-pool";
import type { PropertyStore } from "@/components/tugways/property-store";

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
// Worker message types (Spec S01 / S02)
// ---------------------------------------------------------------------------

/** Discriminated union of requests sent to the markdown worker. */
export type MdWorkerReq =
  | { type: "lex"; text: string }
  | { type: "parse"; batch: { index: number; raw: string }[] }
  | { type: "stream"; tailText: string; relexFromOffset: number; viewportHint?: { startIndex: number; endIndex: number } };

/** Discriminated union of responses from the markdown worker. */
export type MdWorkerRes =
  | { type: "lex"; blockCount: number; heights: number[]; offsets: number[] }
  | { type: "parse"; results: { index: number; html: string }[] }
  | { type: "stream"; newHeights: number[]; newOffsets: number[]; parsedBlocks: { index: number; html: string }[]; metadataOnly: { index: number; height: number }[] };

// ---------------------------------------------------------------------------
// MarkdownDiagnostics (Spec S03)
// ---------------------------------------------------------------------------

/** Metrics object emitted via onDiagnostics callback on each parse response. */
export interface MarkdownDiagnostics {
  poolSize: number;
  inFlightTasks: number;
  cacheSize: number;
  cacheHitRate: number;
  blockCount: number;
}

// ---------------------------------------------------------------------------
// Height estimation (fallback for main-thread inline execution)
// ---------------------------------------------------------------------------

/** Module-level estimator instance. Pure, no state, safe to share. */
const _estimator = new DefaultTextEstimator();

/** Estimate height of a block from token type, raw text, and optional metadata. */
function estimateBlockHeight(tokenType: string, raw: string, meta?: { depth?: number; itemCount?: number; rowCount?: number }): number {
  return _estimator.estimate(tokenType, raw, meta);
}

// ---------------------------------------------------------------------------
// Fallback handler — runs lex/parse/stream inline on the main thread [D07]
// ---------------------------------------------------------------------------

/**
 * Fallback handler for graceful degradation [D07].
 * When Worker construction fails, the pool calls this inline via queueMicrotask.
 * Implements the same switch logic as markdown-worker.ts.
 */
function mainThreadFallback(req: MdWorkerReq): MdWorkerRes {
  switch (req.type) {
    case "lex": {
      const tokens = marked.lexer(req.text).filter((t) => t.type !== "space");
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
        const tokenStart = req.text.indexOf(raw, cursor);
        if (tokenStart >= 0) {
          cursor = tokenStart + raw.length;
        } else {
          cursor += raw.length;
        }
        offsets.push(cursor);
      }
      return { type: "lex", blockCount: tokens.length, heights, offsets };
    }
    case "parse": {
      const results: { index: number; html: string }[] = [];
      for (const { index, raw } of req.batch) {
        const html = marked.parser(marked.lexer(raw));
        results.push({ index, html });
      }
      return { type: "parse", results };
    }
    case "stream": {
      const tokens = marked.lexer(req.tailText).filter((t) => t.type !== "space");
      const newHeights: number[] = [];
      const newOffsets: number[] = [];
      const parsedBlocks: { index: number; html: string }[] = [];
      const metadataOnly: { index: number; height: number }[] = [];
      let cursor = req.relexFromOffset;
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
        const tokenStart = req.tailText.indexOf(raw, cursor - req.relexFromOffset);
        if (tokenStart >= 0) {
          cursor = req.relexFromOffset + tokenStart + raw.length;
        } else {
          cursor += raw.length;
        }
        newOffsets.push(cursor);
        const vp = req.viewportHint;
        const inViewport = vp === undefined || (i >= vp.startIndex && i <= vp.endIndex);
        if (inViewport) {
          const html = marked.parser(marked.lexer(raw));
          parsedBlocks.push({ index: i, html });
        } else {
          metadataOnly.push({ index: i, height });
        }
      }
      return { type: "stream", newHeights, newOffsets, parsedBlocks, metadataOnly };
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level worker pool — lives outside React, immune to reconciliation [L06]
// ---------------------------------------------------------------------------

/**
 * Singleton worker pool for markdown processing. Created at module load, never
 * destroyed by React. Components use it but don't own it. This follows L06:
 * the pool is infrastructure, not appearance state.
 */
const _pool = new TugWorkerPool<MdWorkerReq, MdWorkerRes>(
  () => new Worker(new URL("../../workers/markdown-worker.ts", import.meta.url), { type: "module" }),
  { fallbackHandler: mainThreadFallback },
);

// ---------------------------------------------------------------------------
// Overscan constant [Q01 — start at 4 screens, tune based on gallery card test]
// ---------------------------------------------------------------------------

/**
 * Number of screens above and below the viewport to keep parsed and in the
 * HTML cache. Shallow overscan causes placeholder flicker during fast scrolling;
 * deep overscan wastes worker time. Starts at 4 per plan [Q01].
 */
const OVERSCAN_SCREENS = 4;

// ---------------------------------------------------------------------------
// TugMarkdownViewProps (Spec S03)
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
  /** Callback fired on each parse response with pool/cache metrics. */
  onDiagnostics?: (metrics: MarkdownDiagnostics) => void;
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
   * Cumulative end offsets per block from Phase 1 lex response.
   * offsets[i] = character position where block i ends.
   * To extract block i's raw: contentText.slice(offsets[i-1] ?? 0, offsets[i])
   */
  blockOffsets: number[];
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
   * HTML cache: block index → unsanitized HTML string from worker.
   * DOMPurify runs at render time in addBlockNode() [D04].
   * Never evicted (content is append-only) [D03].
   */
  htmlCache: Map<number, string>;
  /** Cache hit counter for diagnostics. */
  cacheHits: number;
  /** Cache miss counter for diagnostics. */
  cacheMisses: number;
  /**
   * Set of block indices that currently have placeholder nodes in the DOM.
   * Used to track which blocks were added as cache-miss placeholders so we
   * can replace them when parse results arrive.
   */
  placeholderIndices: Set<number>;
  /** In-flight parse task handles for cancellation on range change [D02]. */
  inFlightParses: TaskHandle<MdWorkerRes>[];
  /** Streaming coalescing dirty flag [D05]. */
  streamingDirty: boolean;
  /** setInterval handle for 100ms streaming coalescing [D05]. */
  streamingInterval: ReturnType<typeof setInterval> | null;
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
// Parse batch size — number of blocks per worker task
// ---------------------------------------------------------------------------

/** Maximum blocks per parse batch. Balances parallelism vs. per-task overhead. */
const PARSE_BATCH_SIZE = 10;

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
  onDiagnostics,
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
        blockOffsets: [],
        accumulatedText: "",
        heightIndex,
        blockWindow,
        blockNodes: new Map(),
        htmlCache: new Map(),
        cacheHits: 0,
        cacheMisses: 0,
        placeholderIndices: new Set(),
        inFlightParses: [],
        streamingDirty: false,
        streamingInterval: null,
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
  // Cache stores unsanitized HTML from workers; DOMPurify runs here [D04].
  // On cache miss: insert a placeholder div at estimated height so the virtual
  // scroll layout remains accurate. The placeholder is replaced when the worker
  // delivers parsed HTML (see submitParseBatches and the streaming handler).
  function addBlockNode(engine: MarkdownEngineState, index: number) {
    if (!blockContainerRef.current) return;
    if (engine.blockNodes.has(index)) return;

    const cachedHtml = engine.htmlCache.get(index);
    if (cachedHtml === undefined) {
      // Cache miss — create a placeholder at the estimated height [Step 6].
      engine.cacheMisses++;
      const estimatedHeight = engine.heightIndex.getHeight(index);
      const el = document.createElement("div");
      el.className = "tugx-md-block tugx-md-placeholder";
      el.dataset.blockIndex = String(index);
      el.style.height = `${estimatedHeight}px`;
      blockContainerRef.current.appendChild(el);
      engine.blockNodes.set(index, el);
      engine.placeholderIndices.add(index);
      // Observe so measured heights update the prefix sum when real content arrives.
      resizeObserverRef.current?.observe(el);
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

  // ---- Upgrade a placeholder DOM node to rendered content ----
  // Called after the worker delivers HTML for a block that was previously
  // rendered as a placeholder. DOMPurify runs here [D04] — the only other
  // sanitize call site is addBlockNode() for direct cache hits.
  function upgradePlaceholderNode(engine: MarkdownEngineState, index: number) {
    const el = engine.blockNodes.get(index);
    if (!el || !engine.placeholderIndices.has(index)) return;
    const html = engine.htmlCache.get(index);
    if (html === undefined) return;
    el.style.height = "";
    el.classList.remove("tugx-md-placeholder");
    el.innerHTML = getDOMPurify().sanitize(html, SANITIZE_CONFIG);
    engine.placeholderIndices.delete(index);
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
    engine.placeholderIndices.delete(index);
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
    // Add entering blocks (cache hits only — misses are placeholders, Step 6)
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

  // ---- Cancel all in-flight parse handles ----
  function cancelInFlightParses(engine: MarkdownEngineState) {
    for (const handle of engine.inFlightParses) {
      handle.cancel();
    }
    engine.inFlightParses = [];
  }

  // ---- Submit parse batches for uncached blocks in range ----
  function submitParseBatches(engine: MarkdownEngineState, range: { startIndex: number; endIndex: number }) {


    // Collect uncached block indices in range.
    const uncached: number[] = [];
    for (let i = range.startIndex; i < range.endIndex; i++) {
      if (!engine.htmlCache.has(i)) {
        uncached.push(i);
      }
    }
    if (uncached.length === 0) return;

    // Split into batches and submit.
    for (let batchStart = 0; batchStart < uncached.length; batchStart += PARSE_BATCH_SIZE) {
      const batchIndices = uncached.slice(batchStart, batchStart + PARSE_BATCH_SIZE);
      const batch = batchIndices
        .map((idx) => {
          const startOffset = idx > 0 ? (engine.blockOffsets[idx - 1] ?? 0) : 0;
          const endOffset = engine.blockOffsets[idx];
          if (endOffset === undefined) return null;
          const raw = engine.contentText.slice(startOffset, endOffset);
          return { index: idx, raw };
        })
        .filter((entry): entry is { index: number; raw: string } => entry !== null);

      if (batch.length === 0) continue;

      const handle = _pool.submit({ type: "parse", batch });
      engine.inFlightParses.push(handle);

      handle.promise.then((res) => {
        if (res.type !== "parse") return;

        // Populate HTML cache with unsanitized HTML from worker [D04].
        for (const { index, html } of res.results) {
          engine.htmlCache.set(index, html);
        }

        // Render any blocks that are now in the visible window.
        const currentScrollTop = scrollContainerRef.current?.scrollTop ?? 0;
        const update = engine.blockWindow.update(currentScrollTop);
        applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);

        // Replace placeholder nodes and render newly-cached blocks [Step 6].
        for (const { index } of res.results) {
          if (engine.blockNodes.has(index)) {
            // Upgrade any existing placeholder to real content [D04].
            upgradePlaceholderNode(engine, index);
          } else if (engine.blockWindow.currentRange.startIndex <= index && index < engine.blockWindow.currentRange.endIndex) {
            // Block is in range but wasn't added yet — add it now (will be a cache hit).
            addBlockNode(engine, index);
          }
        }

        // Fire diagnostics callback.
        onDiagnostics?.({
          poolSize: _pool.poolSize,
          inFlightTasks: engine.inFlightParses.length,
          cacheSize: engine.htmlCache.size,
          cacheHitRate: engine.cacheHits + engine.cacheMisses > 0
            ? engine.cacheHits / (engine.cacheHits + engine.cacheMisses)
            : 0,
          blockCount: engine.blockCount,
        });
      }).catch((err) => {
        if (err instanceof Error && err.message.includes("cancelled")) return;
        console.error("[TugMarkdownView] parse batch failed:", err);
      });
    }
  }

  // ---- Cleanup component-scoped resources on unmount ----
  // The pool is module-level (_pool) and survives unmount [L06].
  // Only cancel this component instance's in-flight work.
  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      cancelInFlightParses(engine);
      if (engine.streamingInterval !== null) {
        clearInterval(engine.streamingInterval);
        engine.streamingInterval = null;
      }
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

  // ---- Static rendering path — wired to two-phase worker pipeline [D01] ----
  useEffect(() => {
    if (content === undefined) return;

    const engine = getEngine();


    // Cancel any in-flight parses from a previous content load.
    cancelInFlightParses(engine);

    // Clear previous state.
    engine.heightIndex.clear();
    engine.blockWindow.setViewportHeight(scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT);

    // Remove all existing block DOM nodes.
    for (const [, el] of engine.blockNodes) {
      resizeObserverRef.current?.unobserve(el);
      el.remove();
    }
    engine.blockNodes.clear();

    // Clear the HTML cache on new content load (new content = stale HTML).
    engine.htmlCache.clear();
    engine.cacheHits = 0;
    engine.cacheMisses = 0;
    engine.placeholderIndices.clear();
    engine.blockOffsets = [];
    engine.blockCount = 0;
    engine.contentText = content;

    applySpacers(0, 0);

    // Phase 1: Submit lex task to worker — returns heights[] and offsets[], not tokens.
    const lexHandle = _pool.submit({ type: "lex", text: content });

    lexHandle.promise.then((res) => {
      if (res.type !== "lex") return;

      engine.blockCount = res.blockCount;
      engine.blockOffsets = res.offsets;

      // Populate BlockHeightIndex with estimated heights from worker.
      engine.heightIndex.clear();
      for (const h of res.heights) {
        engine.heightIndex.appendBlock(h);
      }

      // Phase 2: Submit parse batches for visible+overscan blocks only [D02].
      const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
      const viewportHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
      engine.blockWindow.setViewportHeight(viewportHeight);

      // Trigger initial window layout — creates placeholder blocks for the
      // visible range so the scroll geometry is correct immediately. Parse
      // responses will upgrade placeholders to real content via
      // upgradePlaceholderNode(). Calling applyWindowUpdate() (not just
      // applySpacers()) is critical: blockWindow.update() advances its
      // internal range tracking, so the enter ranges must be consumed here
      // or the parse handler's update() call will see an empty diff.
      const update = engine.blockWindow.update(scrollTop);
      applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);

      const range = computeOverscanRange(engine, scrollTop);
      submitParseBatches(engine, range);
    }).catch((err) => {
      if (err instanceof Error && err.message.includes("cancelled")) return;
      console.error("[TugMarkdownView] lex failed:", err);
    });
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

      // Update window (handles enter/exit for cached blocks).
      const update = engine.blockWindow.update(pendingTop);
      applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);

      // Compute new overscan range.
      const newRange = computeOverscanRange(engine, pendingTop);

      // Cancel stale in-flight parses for blocks no longer in range.
      cancelInFlightParses(engine);

      // Submit parse batches for uncached blocks in the new range.
      submitParseBatches(engine, newRange);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Streaming rendering path ----
  // streamingText comes from useSyncExternalStore [L02].
  // Updates are coalesced at 100ms via setInterval [D05].
  useEffect(() => {
    if (!streamingStore) return;
    const engine = getEngine();

    const newText = streamingText;
    if (!newText) return;

    engine.accumulatedText = newText;

    // Mark dirty so the interval callback picks it up.
    engine.streamingDirty = true;

    // Start the coalescing interval on first streaming update [D05].
    if (engine.streamingInterval === null) {
      engine.streamingInterval = setInterval(() => {
        if (!engine.streamingDirty) return;
        engine.streamingDirty = false;

        const text = engine.accumulatedText;
        if (!text) return;

        // Determine tail re-lex offset from last stable block boundary.
        const oldCount = engine.blockCount;
        let relexFromIndex: number;
        let relexFromOffset: number;
        if (oldCount === 0) {
          relexFromIndex = 0;
          relexFromOffset = 0;
        } else {
          relexFromIndex = Math.max(0, oldCount - 1);
          relexFromOffset = relexFromIndex > 0 ? (engine.blockOffsets[relexFromIndex - 1] ?? 0) : 0;
        }

        const tailText = text.slice(relexFromOffset);
        const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
        const viewportHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
        const overscanPixels = viewportHeight * OVERSCAN_SCREENS;
        const viewportStartBlock = engine.heightIndex.getBlockAtOffset(Math.max(0, scrollTop - overscanPixels));
        const viewportEndBlock = engine.heightIndex.getBlockAtOffset(scrollTop + viewportHeight + overscanPixels) + 1;

        // Translate to tail-relative indices.
        const vpHint = {
          startIndex: Math.max(0, viewportStartBlock - relexFromIndex),
          endIndex: Math.max(0, viewportEndBlock - relexFromIndex),
        };

        const handle = _pool.submit({
          type: "stream",
          tailText,
          relexFromOffset,
          viewportHint: vpHint,
        });

        // Track handle so cancelInFlightParses() can cancel it on unmount [D02].
        engine.inFlightParses.push(handle);

        handle.promise.then((res) => {
          if (res.type !== "stream") return;

          // Reconcile heights and offsets for tail blocks.
          for (let ti = 0; ti < res.newHeights.length; ti++) {
            const blockIndex = relexFromIndex + ti;
            const h = res.newHeights[ti];
            const off = res.newOffsets[ti];

            if (blockIndex < engine.blockCount) {
              engine.heightIndex.setHeight(blockIndex, h);
              engine.blockOffsets[blockIndex] = off;
            } else {
              engine.heightIndex.appendBlock(h);
              engine.blockOffsets.push(off);
              engine.blockCount++;
            }
          }

          // Trim stale tail blocks if tail produced fewer.
          const expectedEnd = relexFromIndex + res.newHeights.length;
          if (expectedEnd < engine.blockCount) {
            for (let i = expectedEnd; i < engine.blockCount; i++) {
              removeBlockNode(engine, i);
            }
            engine.blockOffsets.splice(expectedEnd);
            // Snapshot heights before clearing (getHeight() requires count > index).
            const snapshotHeights: number[] = [];
            for (let i = 0; i < expectedEnd; i++) {
              snapshotHeights.push(engine.heightIndex.getHeight(i));
            }
            engine.blockCount = expectedEnd;
            engine.heightIndex.clear();
            for (const h of snapshotHeights) {
              engine.heightIndex.appendBlock(h);
            }
          }

          // Populate HTML cache for parsed blocks [D03].
          for (const { index, html } of res.parsedBlocks) {
            const absIndex = relexFromIndex + index;
            engine.htmlCache.set(absIndex, html);
          }

          // Update height estimates for metadata-only blocks.
          for (const { index, height } of res.metadataOnly) {
            const absIndex = relexFromIndex + index;
            engine.heightIndex.setHeight(absIndex, height);
          }

          // Replace placeholder nodes for newly-parsed blocks [Step 6].
          for (const { index } of res.parsedBlocks) {
            const absIndex = relexFromIndex + index;
            upgradePlaceholderNode(engine, absIndex);
          }

          // Rebuild visible window.
          const currentScrollTop = scrollContainerRef.current?.scrollTop ?? 0;
          const vpHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
          engine.blockWindow.setViewportHeight(vpHeight);
          const update = engine.blockWindow.update(currentScrollTop);
          applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);

          // Auto-scroll to tail during streaming [L05: trigger from worker response,
          // not React commit; L06: DOM write via RAF is fine].
          const totalHeight = engine.heightIndex.getTotalHeight();
          const targetScrollTop = Math.max(0, totalHeight - vpHeight);
          if (engine.rafHandle !== null) {
            cancelAnimationFrame(engine.rafHandle);
          }
          engine.rafHandle = requestAnimationFrame(() => {
            engine.rafHandle = null;
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollTop = targetScrollTop;
            }
          });
        }).catch((err) => {
          if (err instanceof Error && err.message.includes("cancelled")) return;
          console.error("[TugMarkdownView] stream failed:", err);
        }).finally(() => {
          // Remove settled handle from inFlightParses to prevent unbounded growth.
          const idx = engine.inFlightParses.indexOf(handle);
          if (idx !== -1) engine.inFlightParses.splice(idx, 1);
        });
      }, 100);
    }
  }, [streamingText, streamingStore]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Finalization pass on turn_complete ----
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && streamingStore) {
      const engine = engineRef.current;
      if (!engine) return;

      // Clear streaming interval.
      if (engine.streamingInterval !== null) {
        clearInterval(engine.streamingInterval);
        engine.streamingInterval = null;
      }
      engine.streamingDirty = false;

      // Finalization: submit a lex task on the full accumulated text to verify
      // block count and update heights/offsets.
      const fullText = engine.accumulatedText || ((streamingStore.get(streamingPath) as string) ?? "");
      if (!fullText) return;

      engine.contentText = fullText;

      const lexHandle = _pool.submit({ type: "lex", text: fullText });

      lexHandle.promise.then((res) => {
        if (res.type !== "lex") return;

        // Rebuild heights from finalized lex.
        engine.heightIndex.clear();
        for (const h of res.heights) {
          engine.heightIndex.appendBlock(h);
        }
        engine.blockOffsets = res.offsets;
        engine.blockCount = res.blockCount;

        // Parse visible+overscan range with final content.
        const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
        const viewportHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
        engine.blockWindow.setViewportHeight(viewportHeight);

        const range = computeOverscanRange(engine, scrollTop);
        submitParseBatches(engine, range);

        rebuildWindow(engine);
      }).catch((err) => {
        if (err instanceof Error && err.message.includes("cancelled")) return;
        console.error("[TugMarkdownView] finalization lex failed:", err);
      });
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
