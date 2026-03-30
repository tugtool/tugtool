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
 * - [D03] Lib + component split: data structures in lib/, component here
 * - [D03] HTML cache: parsed HTML stored in Map<number, string>, never evicted
 *   (content model is append-only). Eliminates scheduleIdleBatch pre-rendering.
 * - [D05] Hardcoded height constants — Phase 3B refines with theme measurement
 *
 * @module components/tugways/tug-markdown-view
 */

import "./tug-markdown-view.css";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { marked } from "marked";
import type { Token } from "marked";
import DOMPurifyModule from "dompurify";
import { cn } from "@/lib/utils";
import { BlockHeightIndex, LINE_HEIGHT, CODE_LINE_HEIGHT, CODE_HEADER_HEIGHT, HEADING_HEIGHTS, HR_HEIGHT } from "@/lib/block-height-index";
import { RenderedBlockWindow } from "@/lib/rendered-block-window";
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
// Height estimation
// ---------------------------------------------------------------------------

/** Estimate the rendered height of a marked Token using [D05] constants. */
function estimateBlockHeight(token: Token): number {
  switch (token.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, (token as { depth: number }).depth));
      return HEADING_HEIGHTS[level] ?? HEADING_HEIGHTS[6];
    }
    case "code": {
      const lines = ((token as { text: string }).text.match(/\n/g) ?? []).length + 1;
      return CODE_HEADER_HEIGHT + lines * CODE_LINE_HEIGHT;
    }
    case "hr":
      return HR_HEIGHT;
    case "space":
      return 0;
    case "paragraph": {
      const text = (token as { text: string }).text ?? "";
      // Rough estimate: ~80 chars per line
      const lines = Math.max(1, Math.ceil(text.length / 80));
      return lines * LINE_HEIGHT + 8; // 8px padding
    }
    case "blockquote": {
      const text = (token as { text?: string }).text ?? "";
      const lines = Math.max(1, Math.ceil(text.length / 70));
      return lines * LINE_HEIGHT + 16;
    }
    case "list": {
      const items = (token as { items?: unknown[] }).items ?? [];
      return Math.max(items.length, 1) * (LINE_HEIGHT + 4) + 8;
    }
    case "table": {
      const rows = (token as { rows?: unknown[][] }).rows ?? [];
      return (rows.length + 1) * (LINE_HEIGHT + 8) + 16; // +1 for header
    }
    default:
      return LINE_HEIGHT * 2;
  }
}

/** Render a single token to sanitized HTML. */
function renderToken(token: Token): string {
  try {
    const html = marked.parser([token]);
    return getDOMPurify().sanitize(html, SANITIZE_CONFIG);
  } catch {
    return "";
  }
}

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
  /** CSS class for the scroll container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Internal state shape (non-React, lives in refs)
// ---------------------------------------------------------------------------

interface MarkdownEngineState {
  /** The list of lexed tokens (aligned 1:1 with BlockHeightIndex blocks). */
  tokens: Token[];
  /**
   * Byte offset in the source text where each block ends.
   * blockOffsets[i] = sum of raw lengths for tokens[0..i] (exclusive).
   * Used by the streaming path to re-lex only from the last stable boundary.
   * Populated for both static and streaming paths.
   */
  blockOffsets: number[];
  /**
   * The accumulated streaming text. Grows as deltas arrive.
   * Raw character delta appends are supported by appending to this string.
   */
  accumulatedText: string;
  /** The BlockHeightIndex driving the virtual layout. */
  heightIndex: BlockHeightIndex;
  /** The sliding window manager. */
  blockWindow: RenderedBlockWindow;
  /** Map from block index to the rendered DOM node. */
  blockNodes: Map<number, HTMLElement>;
  /**
   * HTML cache: block index → sanitized HTML string.
   * Populated by renderToken() at render time. Never evicted (content is
   * append-only). Eliminates re-parsing on scroll-back [D03].
   */
  htmlCache: Map<number, string>;
  /** Cache hit counter for diagnostics. */
  cacheHits: number;
  /** Cache miss counter for diagnostics. */
  cacheMisses: number;
  /** RAF handle for auto-scroll. */
  rafHandle: number | null;
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
        tokens: [],
        blockOffsets: [],
        accumulatedText: "",
        heightIndex,
        blockWindow,
        blockNodes: new Map(),
        htmlCache: new Map(),
        cacheHits: 0,
        cacheMisses: 0,
        rafHandle: null,
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
  function addBlockNode(engine: MarkdownEngineState, index: number) {
    if (!blockContainerRef.current) return;
    if (engine.blockNodes.has(index)) return;
    const token = engine.tokens[index];
    if (!token) return;

    // Check HTML cache first [D03]. Cache hit: reuse sanitized HTML without
    // re-parsing. Cache miss: render and populate cache.
    let html: string;
    if (engine.htmlCache.has(index)) {
      html = engine.htmlCache.get(index)!;
      engine.cacheHits++;
    } else {
      html = renderToken(token);
      engine.htmlCache.set(index, html);
      engine.cacheMisses++;
    }

    const el = document.createElement("div");
    el.className = "tugx-md-block";
    el.dataset.blockIndex = String(index);
    el.innerHTML = html;
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
  function applyWindowUpdate(engine: MarkdownEngineState, topSpacer: number, bottomSpacer: number, enter: { startIndex: number; endIndex: number }[], exit: { startIndex: number; endIndex: number }[]) {
    // Remove exiting blocks
    for (const range of exit) {
      for (let i = range.startIndex; i < range.endIndex; i++) {
        removeBlockNode(engine, i);
      }
    }
    // Add entering blocks
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

  // ---- Scroll handler ----
  const handleScroll = useCallback(() => {
    const engine = getEngine();
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    const update = engine.blockWindow.update(scrollTop);
    applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    applySpacers(0, 0);

    // Lex synchronously (marked.lexer is fast even for large content).
    const tokens = marked.lexer(content).filter((t) => t.type !== "space");
    engine.tokens = tokens;
    engine.blockOffsets = [];
    engine.accumulatedText = content;

    // Populate BlockHeightIndex with estimated heights and track byte offsets.
    let cumulativeOffset = 0;
    for (const token of tokens) {
      engine.heightIndex.appendBlock(estimateBlockHeight(token));
      // Each token has a .raw field containing the original source text.
      cumulativeOffset += (token as { raw?: string }).raw?.length ?? 0;
      engine.blockOffsets.push(cumulativeOffset);
    }

    // Render visible window immediately. addBlockNode() populates htmlCache
    // on first render; subsequent scroll-back is a cache hit [D03].
    const viewportHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
    engine.blockWindow.setViewportHeight(viewportHeight);
    rebuildWindow(engine);
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Auto-scroll during streaming [L05: RAF only for scroll write] ----
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!isStreaming) return;
    if (!scrollContainerRef.current) return;

    const totalHeight = engine.heightIndex.getTotalHeight();
    const viewportHeight = scrollContainerRef.current.clientHeight;
    const targetScrollTop = Math.max(0, totalHeight - viewportHeight);

    // Use RAF only for the scroll position write [L05].
    if (engine.rafHandle !== null) {
      cancelAnimationFrame(engine.rafHandle);
    }
    engine.rafHandle = requestAnimationFrame(() => {
      engine.rafHandle = null;
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = targetScrollTop;
      }
    });
  }, [streamingText, isStreaming]);

  // ---- Streaming rendering path ----
  // streamingText comes from useSyncExternalStore [L02].
  // On each update we re-lex only from the start of the last stable block
  // boundary, using the blockOffsets array to locate it efficiently.
  // This is O(k) where k is the number of changed/new blocks — not O(n).
  useEffect(() => {
    if (!streamingStore) return;
    const engine = getEngine();

    // Accept the new text from the store. The caller may provide either a
    // full running string (common case) or we accumulate raw delta appends.
    // Here streamingText IS the full accumulated string [D04].
    const newText = streamingText;
    if (!newText) return;

    // Update accumulated text (for delta append support — the full-string path
    // also sets this so both modes stay consistent).
    engine.accumulatedText = newText;

    const oldCount = engine.tokens.length;

    // Determine the re-lex start position.
    // Re-lex from the start of the last block (index oldCount - 1) to handle
    // boundary shifts. If there are no blocks yet, lex from position 0.
    // blockOffsets[i] is the end offset of block i; so the start offset of
    // block (oldCount-1) is blockOffsets[oldCount-2] (or 0 if oldCount <= 1).
    let relexFromIndex: number; // block index to start updating from
    let relexFromOffset: number; // byte offset in newText to start lexing from

    if (oldCount === 0) {
      relexFromIndex = 0;
      relexFromOffset = 0;
    } else {
      // Re-lex the last block (and any that follow it).
      relexFromIndex = Math.max(0, oldCount - 1);
      relexFromOffset = relexFromIndex > 0 ? (engine.blockOffsets[relexFromIndex - 1] ?? 0) : 0;
    }

    // Lex only the tail of the text from the stable boundary.
    const tailText = newText.slice(relexFromOffset);
    const tailTokens = marked.lexer(tailText).filter((t) => t.type !== "space");

    // Reconcile re-lexed tail tokens against existing tokens from relexFromIndex.
    let tailCumulativeOffset = relexFromOffset;
    for (let ti = 0; ti < tailTokens.length; ti++) {
      const blockIndex = relexFromIndex + ti;
      const newToken = tailTokens[ti];
      const rawLen = (newToken as { raw?: string }).raw?.length ?? 0;
      tailCumulativeOffset += rawLen;

      if (blockIndex < oldCount) {
        // Block already exists — check if content changed.
        const newHtml = renderToken(newToken);
        const oldEl = engine.blockNodes.get(blockIndex);
        if (oldEl && oldEl.innerHTML !== newHtml) {
          // Update cache with new HTML for this changed block.
          engine.htmlCache.set(blockIndex, newHtml);
          engine.blockWindow.markDirty(blockIndex);
          engine.tokens[blockIndex] = newToken;
          engine.heightIndex.setHeight(blockIndex, estimateBlockHeight(newToken));
        } else if (!oldEl) {
          // Block not in DOM yet — update token reference and cache.
          engine.htmlCache.set(blockIndex, newHtml);
          engine.tokens[blockIndex] = newToken;
          engine.heightIndex.setHeight(blockIndex, estimateBlockHeight(newToken));
        }
        engine.blockOffsets[blockIndex] = tailCumulativeOffset;
      } else {
        // New block — append.
        engine.tokens.push(newToken);
        engine.heightIndex.appendBlock(estimateBlockHeight(newToken));
        engine.blockOffsets.push(tailCumulativeOffset);
      }
    }

    // If the tail re-lex produced fewer blocks than expected, the last block
    // boundary shifted. Trim the engine state to match.
    const expectedEnd = relexFromIndex + tailTokens.length;
    if (expectedEnd < engine.tokens.length) {
      // Remove stale trailing blocks from DOM and engine state.
      for (let i = expectedEnd; i < engine.tokens.length; i++) {
        removeBlockNode(engine, i);
      }
      engine.tokens.splice(expectedEnd);
      engine.blockOffsets.splice(expectedEnd);
      // BlockHeightIndex does not support truncation; rebuild the tail region
      // by setting heights to 0 (they will be re-appended or re-estimated
      // on the next update). We use a no-op approach: the phantom blocks will
      // have zero height and be ignored by the window manager once they have
      // no tokens. For correctness, clear and rebuild if count decreased.
      // In practice this path is rare (boundary shift at stream end).
      engine.heightIndex.clear();
      for (const token of engine.tokens) {
        engine.heightIndex.appendBlock(estimateBlockHeight(token));
      }
    }

    // Update dirty block DOM nodes in the current window.
    // The cache was already updated during reconciliation above, so we read
    // from the cache here rather than re-rendering from the token.
    const current = engine.blockWindow.currentRange;
    for (let i = current.startIndex; i < current.endIndex; i++) {
      if (engine.blockWindow.isDirty(i)) {
        const el = engine.blockNodes.get(i);
        if (el) {
          const cachedHtml = engine.htmlCache.get(i);
          el.innerHTML = cachedHtml !== undefined ? cachedHtml : renderToken(engine.tokens[i]);
          engine.blockWindow.clearDirty(i);
        }
      }
    }

    // Rebuild window to add any new visible blocks.
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    const viewportHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
    engine.blockWindow.setViewportHeight(viewportHeight);
    const update = engine.blockWindow.update(scrollTop);
    applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
  }, [streamingText, streamingStore]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Finalization pass on turn_complete ----
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && streamingStore) {
      const engine = engineRef.current;
      if (!engine) return;

      // Finalization pass: re-lex the full accumulated text from scratch to
      // ensure the block list is consistent with the final content. This is
      // the safety net for any boundary shifts that occurred during streaming.
      const fullText = engine.accumulatedText || ((streamingStore.get(streamingPath) as string) ?? "");
      const finalTokens = marked.lexer(fullText).filter((t) => t.type !== "space");

      // Rebuild blockOffsets for the finalized token list.
      const finalOffsets: number[] = [];
      let cumOffset = 0;
      for (const token of finalTokens) {
        cumOffset += (token as { raw?: string }).raw?.length ?? 0;
        finalOffsets.push(cumOffset);
      }

      // Update all tokens, heights, and offsets.
      for (let i = 0; i < finalTokens.length; i++) {
        if (i < engine.tokens.length) {
          engine.tokens[i] = finalTokens[i];
          engine.heightIndex.setHeight(i, estimateBlockHeight(finalTokens[i]));
          engine.blockOffsets[i] = finalOffsets[i];
        } else {
          engine.tokens.push(finalTokens[i]);
          engine.heightIndex.appendBlock(estimateBlockHeight(finalTokens[i]));
          engine.blockOffsets.push(finalOffsets[i]);
        }
      }

      // If finalization produced fewer blocks, trim the stale tail.
      if (finalTokens.length < engine.tokens.length) {
        for (let i = finalTokens.length; i < engine.tokens.length; i++) {
          removeBlockNode(engine, i);
        }
        engine.tokens.splice(finalTokens.length);
        engine.blockOffsets.splice(finalTokens.length);
        // Rebuild the height index from scratch to match the trimmed token list.
        engine.heightIndex.clear();
        for (const token of engine.tokens) {
          engine.heightIndex.appendBlock(estimateBlockHeight(token));
        }
      }

      // Refresh all visible block DOM nodes, updating the cache with final HTML.
      const current = engine.blockWindow.currentRange;
      for (let i = current.startIndex; i < current.endIndex; i++) {
        const el = engine.blockNodes.get(i);
        if (el && engine.tokens[i]) {
          const finalHtml = renderToken(engine.tokens[i]);
          engine.htmlCache.set(i, finalHtml);
          el.innerHTML = finalHtml;
        }
      }

      rebuildWindow(engine);
    }
  }, [isStreaming, streamingStore, streamingPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (engine.rafHandle !== null) {
        cancelAnimationFrame(engine.rafHandle);
      }
    };
  }, []);

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
