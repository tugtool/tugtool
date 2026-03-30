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
 * - [D05] Hardcoded height constants — Phase 3B refines with theme measurement
 * - [D06] Content >1MB: lex synchronously (fast), render in batches via
 *   requestIdleCallback to keep UI responsive during DOM work
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
// Large-content chunked rendering threshold [D06]
// ---------------------------------------------------------------------------

const CHUNKED_CONTENT_THRESHOLD = 1024 * 1024; // 1 MB
const RENDER_BATCH_SIZE = 50; // blocks per idle callback

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
  /** The BlockHeightIndex driving the virtual layout. */
  heightIndex: BlockHeightIndex;
  /** The sliding window manager. */
  blockWindow: RenderedBlockWindow;
  /** Map from block index to the rendered DOM node. */
  blockNodes: Map<number, HTMLElement>;
  /** Handle for pending requestIdleCallback batch rendering. */
  idleHandle: ReturnType<typeof requestIdleCallback> | null;
  /** How many tokens have been rendered (chunked mode progress). */
  renderedCount: number;
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
        heightIndex,
        blockWindow,
        blockNodes: new Map(),
        idleHandle: null,
        renderedCount: 0,
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

    const html = renderToken(token);
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

    // Cancel any in-flight idle render.
    if (engine.idleHandle !== null) {
      cancelIdleCallback(engine.idleHandle);
      engine.idleHandle = null;
    }

    // Clear previous state.
    engine.heightIndex.clear();
    engine.blockWindow.setViewportHeight(scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT);

    // Remove all existing block DOM nodes.
    for (const [, el] of engine.blockNodes) {
      resizeObserverRef.current?.unobserve(el);
      el.remove();
    }
    engine.blockNodes.clear();
    applySpacers(0, 0);

    // Lex synchronously (marked.lexer is fast even for large content).
    const tokens = marked.lexer(content).filter((t) => t.type !== "space");
    engine.tokens = tokens;
    engine.renderedCount = 0;

    // Populate BlockHeightIndex with estimated heights for all blocks.
    for (const token of tokens) {
      engine.heightIndex.appendBlock(estimateBlockHeight(token));
    }

    // Render visible window immediately.
    const viewportHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
    engine.blockWindow.setViewportHeight(viewportHeight);
    rebuildWindow(engine);

    // For large content, render additional blocks in idle batches [D06].
    if (content.length > CHUNKED_CONTENT_THRESHOLD) {
      // The visible range is already rendered. Schedule idle batches to pre-render
      // off-screen blocks so fast scrolling finds them ready.
      scheduleIdleBatch(engine);
    }

    // Cleanup on unmount / content change.
    return () => {
      if (engine.idleHandle !== null) {
        cancelIdleCallback(engine.idleHandle);
        engine.idleHandle = null;
      }
    };
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Schedule a requestIdleCallback batch to pre-render off-screen blocks. */
  function scheduleIdleBatch(engine: MarkdownEngineState) {
    const schedule = typeof requestIdleCallback !== "undefined" ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 0);
    engine.idleHandle = schedule(() => {
      engine.idleHandle = null;
      const current = engine.blockWindow.currentRange;
      // Find the next un-rendered block outside the current window.
      let batchStart = current.endIndex;
      let count = 0;
      while (batchStart < engine.tokens.length && count < RENDER_BATCH_SIZE) {
        addBlockNode(engine, batchStart);
        batchStart++;
        count++;
      }
      if (batchStart < engine.tokens.length) {
        scheduleIdleBatch(engine);
      }
    }) as ReturnType<typeof requestIdleCallback>;
  }

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
  // On each update we re-lex from the last stable block boundary.
  useEffect(() => {
    if (!streamingStore) return;
    const engine = getEngine();

    const newText = streamingText;
    if (!newText) return;

    // Lex from the beginning (simplest approach for correctness; the lexer is
    // fast on the accumulated text since it grows incrementally).
    // For correctness with re-lex from last boundary: lex the full text.
    const allTokens = marked.lexer(newText).filter((t) => t.type !== "space");

    const oldCount = engine.tokens.length;
    const newCount = allTokens.length;

    // Handle blocks that changed (re-lexed tail).
    const overlapStart = Math.max(0, oldCount - 2);
    for (let i = overlapStart; i < Math.min(oldCount, newCount); i++) {
      const newToken = allTokens[i];
      const oldToken = engine.tokens[i];
      // Compare rendered HTML to detect changes.
      const newHtml = renderToken(newToken);
      const oldEl = engine.blockNodes.get(i);
      if (oldEl && oldEl.innerHTML !== newHtml) {
        engine.blockWindow.markDirty(i);
        engine.tokens[i] = newToken;
        engine.heightIndex.setHeight(i, estimateBlockHeight(newToken));
      }
    }

    // Append new blocks.
    for (let i = oldCount; i < newCount; i++) {
      engine.tokens.push(allTokens[i]);
      engine.heightIndex.appendBlock(estimateBlockHeight(allTokens[i]));
    }

    // Update dirty block DOM nodes.
    const current = engine.blockWindow.currentRange;
    for (let i = current.startIndex; i < current.endIndex; i++) {
      if (engine.blockWindow.isDirty(i)) {
        const el = engine.blockNodes.get(i);
        if (el) {
          el.innerHTML = renderToken(engine.tokens[i]);
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

      // Re-lex the full text and reconcile block list.
      const fullText = (streamingStore.get(streamingPath) as string) ?? "";
      const finalTokens = marked.lexer(fullText).filter((t) => t.type !== "space");

      // Update all tokens and heights.
      for (let i = 0; i < finalTokens.length; i++) {
        if (i < engine.tokens.length) {
          engine.tokens[i] = finalTokens[i];
          engine.heightIndex.setHeight(i, estimateBlockHeight(finalTokens[i]));
        } else {
          engine.tokens.push(finalTokens[i]);
          engine.heightIndex.appendBlock(estimateBlockHeight(finalTokens[i]));
        }
      }

      // Refresh all visible block DOM nodes.
      const current = engine.blockWindow.currentRange;
      for (let i = current.startIndex; i < current.endIndex; i++) {
        const el = engine.blockNodes.get(i);
        if (el && engine.tokens[i]) {
          el.innerHTML = renderToken(engine.tokens[i]);
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
      if (engine.idleHandle !== null) {
        cancelIdleCallback(engine.idleHandle);
      }
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
