/**
 * TugMarkdownView — virtualized markdown rendering component.
 *
 * Renders multi-MB markdown content at 60fps by composing BlockHeightIndex
 * and RenderedBlockWindow into a React component. Only the blocks visible in
 * the viewport (plus overscan) are present in the DOM at any time.
 *
 * Lexing and parsing use pulldown-cmark compiled to WASM (tugmark-wasm).
 * All blocks are lexed and parsed synchronously on content load (~29ms for 1MB).
 * Scroll handling is pure DOM window management — zero WASM calls during scroll.
 *
 * Laws compliance:
 * - [L03] useLayoutEffect for static and streaming paths — block DOM and height
 *   index must be ready before scroll events fire.
 * - [L05] RAF is used ONLY for scroll coalescing (onScroll DOM event, not React
 *   state commit). Never used to commit React state.
 * - [L06] Appearance changes via CSS and DOM, never React state. Spacer heights
 *   and block visibility are managed by direct DOM writes, not React state.
 * - [L07] Handlers access current state through refs, never stale closures.
 * - [L19] Component authoring guide: module docstring, exported props interface,
 *   data-slot="tug-markdown-view", file pair (tsx + css).
 * - [L22] Streaming DOM updates observe the PropertyStore directly via
 *   useLayoutEffect — no React round-trip between data change and DOM write.
 *
 * Design decisions:
 * - [D03] HTML cache (Map<number, string>, never evicted, all blocks pre-parsed)
 * - [D04] DOMPurify at render time only
 *
 * @module components/tugways/tug-markdown-view
 */

import "./tug-markdown-view.css";

import React, { useCallback, useLayoutEffect, useRef } from "react";
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

// ---------------------------------------------------------------------------
// UTF-8 byte offset → JS string char index conversion
//
// pulldown-cmark returns BYTE offsets into the UTF-8 encoding of the input.
// JS String.slice() uses UTF-16 code unit indices. For ASCII they coincide,
// but any multi-byte codepoint (e.g. em-dash, emoji) would produce a wrong
// slice without this conversion.
//
// We build the map once per content string and reuse it for all block slices.
// ---------------------------------------------------------------------------

const _encoder = new TextEncoder();

/**
 * Build a Uint32Array mapping UTF-8 byte index → JS string char index.
 * Index i holds the JS char index that starts at UTF-8 byte i.
 * The array length is byteLength + 1 (last entry = string.length).
 */
function buildByteToCharMap(text: string): Uint32Array {
  const encoded = _encoder.encode(text);
  const byteLen = encoded.length;
  const map = new Uint32Array(byteLen + 1);
  let bytePos = 0;
  let charPos = 0;
  while (charPos < text.length) {
    map[bytePos] = charPos;
    const cp = text.codePointAt(charPos)!;
    // UTF-8 byte width of this codepoint
    const byteWidth = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    // UTF-16 code unit width (surrogate pair = 2 units)
    const charWidth = cp >= 0x10000 ? 2 : 1;
    for (let b = 0; b < byteWidth; b++) {
      map[bytePos + b] = charPos;
    }
    bytePos += byteWidth;
    charPos += charWidth;
  }
  map[byteLen] = charPos;
  return map;
}

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
// TugMarkdownViewProps
// ---------------------------------------------------------------------------

/** Timing metrics emitted after each lex+parse pass. */
export interface TugMarkdownTimingMetrics {
  /** Time in milliseconds for the lex_blocks() WASM call. */
  lexMs: number;
  /** Time in milliseconds for all parse_to_html() WASM calls. */
  parseMs: number;
  /** Total number of blocks in the document. */
  blockCount: number;
}

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
  /** Callback with WASM timing metrics after each lex+parse pass. */
  onTiming?: (metrics: TugMarkdownTimingMetrics) => void;
  /** CSS class for the scroll container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Internal state shape (non-React, lives in refs)
// ---------------------------------------------------------------------------

interface MarkdownEngineState {
  /** The source text (static content or accumulated streaming text). */
  contentText: string;
  /** Char-mapped start offsets per block. blockStarts[i] = JS char index. */
  blockStarts: number[];
  /** Char-mapped end offsets per block. blockEnds[i] = JS char index. */
  blockEnds: number[];
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
   * All blocks are parsed upfront on content load, so this cache is always
   * fully populated before any scroll event fires.
   */
  htmlCache: Map<number, string>;
  /** Pending scroll top for RAF coalescing [D02]. */
  pendingScrollTop: number | null;
  /** RAF handle for scroll coalescing [D02]. */
  scrollRafHandle: number | null;
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
  onTiming,
  className,
}: TugMarkdownViewProps) {
  // ---- DOM refs ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const blockContainerRef = useRef<HTMLDivElement>(null);

  // ---- Prop refs for stable closure access [L07] ----
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  const onTimingRef = useRef(onTiming);
  onTimingRef.current = onTiming;

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
        heightIndex,
        blockWindow,
        blockNodes: new Map(),
        htmlCache: new Map(),
        pendingScrollTop: null,
        scrollRafHandle: null,
        blockCount: 0,
      };
    }
    return engineRef.current;
  }

  // Streaming DOM updates go through the L22 store observer (useLayoutEffect below).
  // No useSyncExternalStore — the store is observed directly, not through React.

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
  //
  // Blocks are always inserted in ascending block index order so the document
  // order matches the logical block order. When a block re-enters the viewport
  // on scroll-up, we must not use appendChild (which would place it after any
  // already-present higher-index blocks). Instead, find the first existing child
  // with a higher data-block-index and insertBefore it. If none exists, pass
  // null to insertBefore which is equivalent to appendChild [Bug 1 fix].
  function addBlockNode(engine: MarkdownEngineState, index: number) {
    if (!blockContainerRef.current) return;
    if (engine.blockNodes.has(index)) return;

    const cachedHtml = engine.htmlCache.get(index);
    if (cachedHtml === undefined) {
      console.warn(`[TugMarkdownView] cache miss for block ${index} — all blocks should be pre-parsed`);
      return;
    }
    const sanitized = getDOMPurify().sanitize(cachedHtml, SANITIZE_CONFIG);

    const el = document.createElement("div");
    el.className = "tugx-md-block";
    el.dataset.blockIndex = String(index);
    el.innerHTML = sanitized;

    // Find the first child with a higher block index to insert before it.
    // This preserves ascending document order regardless of insertion sequence.
    const container = blockContainerRef.current;
    let referenceNode: ChildNode | null = null;
    for (let i = 0; i < container.childNodes.length; i++) {
      const child = container.childNodes[i] as HTMLElement;
      const childIndex = parseInt(child.dataset?.blockIndex ?? "", 10);
      if (!isNaN(childIndex) && childIndex > index) {
        referenceNode = child;
        break;
      }
    }
    container.insertBefore(el, referenceNode);
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

  // ---- Cleanup component-scoped resources on unmount ----
  useLayoutEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (engine.scrollRafHandle !== null) {
        cancelAnimationFrame(engine.scrollRafHandle);
        engine.scrollRafHandle = null;
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

  // ---- Shared lex+parse+render helper ----
  // Plain function — reads from refs only [L07]. Used by static path.
  function lexParseAndRender(engine: MarkdownEngineState, text: string) {
    // Reset block window while height index is empty — forces exit of stale range.
    engine.heightIndex.clear();
    engine.blockWindow.update(0);
    engine.blockWindow.setViewportHeight(scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT);
    for (const [, el] of engine.blockNodes) {
      resizeObserverRef.current?.unobserve(el);
      el.remove();
    }
    engine.blockNodes.clear();
    engine.htmlCache.clear();
    engine.blockStarts = [];
    engine.blockEnds = [];
    engine.blockCount = 0;
    engine.contentText = text;
    applySpacers(0, 0);

    // Lex + parse: synchronous WASM calls (~29ms for 1MB)
    const lexStart = performance.now();
    const packed = lex_blocks(text);
    const lexMs = performance.now() - lexStart;
    const blocks = decodeBlocks(packed);
    const byteToChar = buildByteToCharMap(text);
    engine.blockCount = blocks.length;
    engine.blockStarts = blocks.map(b => byteToChar[b.start] ?? b.start);
    engine.blockEnds = blocks.map(b => byteToChar[b.end] ?? b.end);

    for (const block of blocks) {
      engine.heightIndex.appendBlock(estimateBlockHeight(block));
    }

    const parseStart = performance.now();
    for (let i = 0; i < blocks.length; i++) {
      const raw = text.slice(engine.blockStarts[i], engine.blockEnds[i]);
      engine.htmlCache.set(i, parse_to_html(raw));
    }
    const parseMs = performance.now() - parseStart;

    onTimingRef.current?.({ lexMs, parseMs, blockCount: engine.blockCount });

    // Enter visible blocks into DOM
    const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    engine.blockWindow.setViewportHeight(scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT);
    const update = engine.blockWindow.update(scrollTop);
    applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
  }

  // ---- Static rendering path [L03: useLayoutEffect so DOM is ready before scroll events] ----
  useLayoutEffect(() => {
    if (content === undefined) return;
    const engine = getEngine();
    lexParseAndRender(engine, content);
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
      const update = engine.blockWindow.update(pendingTop);
      applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Streaming rendering path [L22: direct store observer, no React round-trip] ----
  useLayoutEffect(() => {
    if (!streamingStore) return;
    const engine = getEngine();

    const unsubscribe = streamingStore.observe(streamingPath, () => {
      const text = (streamingStore.get(streamingPath) as string) ?? "";
      if (!text) return;

      engine.contentText = text;

      const lexStart = performance.now();
      const packed = lex_blocks(text);
      const lexMs = performance.now() - lexStart;
      const newBlocks = decodeBlocks(packed);
      const byteToChar = buildByteToCharMap(text);
      const newStarts = newBlocks.map(b => byteToChar[b.start] ?? b.start);
      const newEnds = newBlocks.map(b => byteToChar[b.end] ?? b.end);

      const oldCount = engine.blockCount;
      const newCount = newBlocks.length;
      let parseMs = 0;

      // Update changed existing blocks
      for (let i = 0; i < Math.min(oldCount, newCount); i++) {
        if (newStarts[i] !== engine.blockStarts[i] || newEnds[i] !== engine.blockEnds[i]) {
          const raw = text.slice(newStarts[i], newEnds[i]);
          const parseStart = performance.now();
          const html = parse_to_html(raw);
          parseMs += performance.now() - parseStart;
          engine.htmlCache.set(i, html);
          engine.heightIndex.setHeight(i, estimateBlockHeight(newBlocks[i]));
          const existingEl = engine.blockNodes.get(i);
          if (existingEl) {
            existingEl.innerHTML = getDOMPurify().sanitize(html, SANITIZE_CONFIG);
          }
        }
      }

      // Handle block count decrease
      if (newCount < oldCount) {
        for (let i = newCount; i < oldCount; i++) {
          removeBlockNode(engine, i);
          engine.htmlCache.delete(i);
        }
        engine.heightIndex.clear();
        for (let i = 0; i < newCount; i++) {
          engine.heightIndex.appendBlock(estimateBlockHeight(newBlocks[i]));
        }
      }

      // Append new blocks
      for (let i = oldCount; i < newCount; i++) {
        engine.heightIndex.appendBlock(estimateBlockHeight(newBlocks[i]));
        const raw = text.slice(newStarts[i], newEnds[i]);
        const parseStart = performance.now();
        engine.htmlCache.set(i, parse_to_html(raw));
        parseMs += performance.now() - parseStart;
      }

      engine.blockStarts = newStarts;
      engine.blockEnds = newEnds;
      engine.blockCount = newCount;

      onTimingRef.current?.({ lexMs, parseMs, blockCount: newCount });

      engine.blockWindow.setViewportHeight(scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT);
      const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
      const update = engine.blockWindow.update(scrollTop);
      applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);

      // Auto-scroll to tail [L06: direct DOM write, L07: ref for current prop]
      if (isStreamingRef.current && scrollContainerRef.current) {
        const totalHeight = engine.heightIndex.getTotalHeight();
        const viewportHeight = scrollContainerRef.current.clientHeight;
        scrollContainerRef.current.scrollTop = Math.max(0, totalHeight - viewportHeight);
      }
    });

    return unsubscribe;
  }, [streamingStore, streamingPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={scrollContainerRef}
      data-slot="tug-markdown-view"
      className={cn("tugx-md-scroll-container", className)}
      onScroll={handleScroll}
    >
      <div ref={topSpacerRef} className="tugx-md-spacer tugx-md-spacer--top" aria-hidden="true" />
      <div ref={blockContainerRef} className="tugx-md-block-container" />
      <div ref={bottomSpacerRef} className="tugx-md-spacer tugx-md-spacer--bottom" aria-hidden="true" />
    </div>
  );
}
