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
 * API: imperative handle (forwardRef). Callers obtain a ref and call:
 *   ref.current.setRegion(key, text)   — insert or update a named region
 *   ref.current.removeRegion(key)      — remove a named region
 *   ref.current.clear()                — clear all regions and reset DOM
 *
 * The streaming path (streamingStore + streamingPath) calls setRegion internally
 * with the key 'stream', so streaming and imperative usage are mutually exclusive.
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
 * - [D93] SmartScroll six-phase state machine (idle/tracking/dragging/settling/
 *   decelerating/programmatic). Controller-driven: doSetRegion calls
 *   pinToBottom() (idle phase) after content settles, not SmartScroll
 *   reacting to ResizeObserver.
 * - [L23] Internal operations never lose user-visible state. Scroll position
 *   is preserved across region edits. Content shrink adjusts to nearest
 *   surviving block. No DOM nuke on non-cold-start paths.
 *
 * Design decisions:
 * - [D03] HTML cache (Map<number, string>, never evicted, all blocks pre-parsed)
 * - [D04] DOMPurify at render time only
 *
 * @module components/tugways/tug-markdown-view
 */

import "./tug-markdown-view.css";

import React, { useCallback, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import DOMPurifyModule from "dompurify";
import { cn } from "@/lib/utils";
import { BlockHeightIndex } from "@/lib/block-height-index";
import { RenderedBlockWindow } from "@/lib/rendered-block-window";
import { RegionMap } from "@/lib/region-map";
import { SmartScroll } from "@/lib/smart-scroll";
import type { PropertyStore } from "@/components/tugways/property-store";
import { TugEditorContextMenu, type TugEditorContextMenuEntry } from "@/components/tugways/tug-editor-context-menu";
import { useOptionalResponder } from "@/components/tugways/use-responder";
import type { ActionHandlerResult } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
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
// TugMarkdownViewHandle
// ---------------------------------------------------------------------------

/** Imperative handle exposed via forwardRef. */
export interface TugMarkdownViewHandle {
  /** Insert or update a named region. Appends at end if key is new. */
  setRegion(key: string, text: string): void;
  /** Remove a named region. Triggers full rebuild or clear as appropriate. */
  removeRegion(key: string): void;
  /** Clear all regions and reset the DOM. */
  clear(): void;
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
  /** PropertyStore for streaming text. When set, component enters streaming mode. */
  streamingStore?: PropertyStore;
  /** PropertyStore path key for the streaming text value. Default: "text". */
  streamingPath?: string;
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
  /** Ordered, keyed content regions. The source of truth for document text. */
  regionMap: RegionMap;
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
  /** Total block count from last lex response. */
  blockCount: number;
  /**
   * Maps each region key to the block index range it produced.
   * `start` is the first block index for that region; `count` is the number
   * of blocks; `types` is the block type sequence (e.g. ['paragraph','code']).
   * The `types` array enables fence propagation to detect block type changes
   * (step 4: lazy fence propagation via D02). Populated after every full rebuild
   * in lexParseAndRender and updated incrementally by incrementalTailUpdate.
   * Cleared by doClear and at the start of every lexParseAndRender reset.
   * [D04-region-block-ranges]
   */
  regionBlockRanges: Map<string, { start: number; count: number; types: string[] }>;
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
 * // Imperative rendering via ref handle:
 * const ref = useRef<TugMarkdownViewHandle>(null);
 * <TugMarkdownView ref={ref} />
 * ref.current?.setRegion('msg-1', markdownString);
 * ref.current?.removeRegion('msg-1');
 * ref.current?.clear();
 *
 * // Streaming rendering:
 * <TugMarkdownView
 *   streamingStore={store}
 *   streamingPath="text"
 * />
 */
export const TugMarkdownView = React.forwardRef<TugMarkdownViewHandle, TugMarkdownViewProps>(
  function TugMarkdownView({
    streamingStore,
    streamingPath = "text",
    onBlockMeasured,
    onTiming,
    className,
  }, ref) {
  // ---- DOM refs ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const blockContainerRef = useRef<HTMLDivElement>(null);

  // ---- Prop refs for stable closure access [L07] ----
  const onTimingRef = useRef(onTiming);
  onTimingRef.current = onTiming;

  // ---- SmartScroll instance ref ----
  const smartScrollRef = useRef<SmartScroll | null>(null);

  // ---- RAF coalescing refs for scroll handler [L05] ----
  const scrollDirtyRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);

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
        regionMap: new RegionMap(),
        blockStarts: [],
        blockEnds: [],
        heightIndex,
        blockWindow,
        blockNodes: new Map(),
        htmlCache: new Map(),
        blockCount: 0,
        regionBlockRanges: new Map(),
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
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
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
        // Safety net: if following bottom, re-slam scrollTop so any height
        // corrections from ResizeObserver don't leave us short of the bottom [D03].
        if (smartScrollRef.current?.isFollowingBottom && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0x40000000;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally empty:
    // This effect only accesses refs at call time (scrollContainerRef, engineRef).
    // Re-running on ref changes would disconnect/reconnect the observer unnecessarily.
  }, []);

  // ---- SmartScroll instance [D93] ----
  useLayoutEffect(() => {
    if (!scrollContainerRef.current || !blockContainerRef.current) return;
    const smartScroll = new SmartScroll({
      scrollContainer: scrollContainerRef.current,
      callbacks: {
        onScroll: () => {
          scrollDirtyRef.current = true;
          if (scrollRafRef.current === null) {
            scrollRafRef.current = requestAnimationFrame(() => {
              scrollRafRef.current = null;
              if (!scrollDirtyRef.current) return;
              scrollDirtyRef.current = false;
              const engine = engineRef.current;
              if (!engine) return;
              const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
              const update = engine.blockWindow.update(scrollTop);
              applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
              // If following bottom, re-slam after spacer changes so scrollTop
              // stays at the true bottom. Without this, the spacer shift leaves
              // scrollTop short of the new max for one paint frame.
              if (smartScrollRef.current?.isFollowingBottom && scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = 0x40000000;
              }
            });
          }
        },
      },
    });
    smartScrollRef.current = smartScroll;
    return () => {
      smartScroll.dispose();
      smartScrollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally empty:
    // SmartScroll is created once on mount and disposed on unmount. It accesses
    // refs at call time (scrollContainerRef, blockContainerRef, scrollDirtyRef,
    // scrollRafRef, engineRef). Re-running would dispose and recreate unnecessarily.
  }, []);

  // ---- Shared lex+parse+render helper ----
  // Full rebuild: re-lexes the entire text, clears and repopulates htmlCache and
  // heightIndex, then rebuilds the visible window. Called for first region,
  // middle-region updates, or any change that invalidates the entire block order.
  function lexParseAndRender(engine: MarkdownEngineState, text: string) {
    // Capture scroll position BEFORE clearing the DOM. Once block nodes and
    // spacers are removed, the browser clamps scrollTop to 0 because the
    // content height drops to zero. We restore it after rebuilding.
    const savedScrollTop = scrollContainerRef.current?.scrollTop ?? 0;

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
    engine.regionBlockRanges.clear();
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

    // Populate regionBlockRanges by mapping each block to its region via char offset.
    // Iterate blocks in order; for each block, look up its region and accumulate.
    // Also record the type sequence for each region so fence propagation can detect
    // block type changes (D02 lazy fence propagation).
    {
      let currentKey: string | undefined = undefined;
      let rangeStart = 0;
      let rangeTypes: string[] = [];
      for (let i = 0; i < engine.blockStarts.length; i++) {
        const key = engine.regionMap.regionKeyAtOffset(engine.blockStarts[i]);
        if (key !== currentKey) {
          if (currentKey !== undefined) {
            engine.regionBlockRanges.set(currentKey, { start: rangeStart, count: rangeTypes.length, types: rangeTypes });
          }
          currentKey = key;
          rangeStart = i;
          rangeTypes = [blocks[i].type];
        } else {
          rangeTypes.push(blocks[i].type);
        }
      }
      if (currentKey !== undefined) {
        engine.regionBlockRanges.set(currentKey, { start: rangeStart, count: rangeTypes.length, types: rangeTypes });
      }
    }

    onTimingRef.current?.({ lexMs, parseMs, blockCount: engine.blockCount });

    // Restore scroll position, clamped to new content height.
    const maxScrollTop = engine.heightIndex.getTotalHeight() - (scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT);
    const scrollTop = Math.max(0, Math.min(savedScrollTop, maxScrollTop));
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollTop;
    }

    // Enter visible blocks into DOM
    engine.blockWindow.setViewportHeight(scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT);
    const update = engine.blockWindow.update(scrollTop);
    applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
  }

  // ---- Region-scoped incremental tail update ----
  // Lexes only the updated region's text, then splices the resulting blocks into
  // the engine arrays. For the tail region the prefix of blocks is stable; for
  // non-tail regions shiftFrom() is used to shift surviving blocks in place.
  // Implements Spec S01 (incrementalTailUpdate procedure) and Spec S02 (on-the-fly
  // byte offset computation).
  function incrementalTailUpdate(engine: MarkdownEngineState, key: string, _fullText: string) {
    const range = engine.regionBlockRanges.get(key);
    // range === undefined means this is a NEW region being appended (RegionMap.setRegion
    // adds keys at the end before incrementalTailUpdate is called). Treat it as an
    // empty existing region at the tail of the block array.

    const regionText = engine.regionMap.getRegionText(key) ?? "";
    const regionRange = engine.regionMap.regionRange(key);
    if (!regionRange) {
      // No regionRange — engine state is inconsistent (programming error). Bail out.
      console.warn(`incrementalTailUpdate: no regionRange for key "${key}"; skipping update`);
      return;
    }
    const regionCharStart = regionRange.start;

    // Lex only the region text, prepending \n\n for block boundary context (D01).
    // Subtract 2 from each byte offset to undo the prefix.
    const lexStart = performance.now();
    const packed = lex_blocks("\n\n" + regionText);
    const lexMs = performance.now() - lexStart;

    const rawBlocks = decodeBlocks(packed);
    // Filter out blocks that belong to the 2-byte prefix (start < 2)
    const newRegionBlocks = rawBlocks
      .filter(b => b.start >= 2)
      .map(b => ({ ...b, start: b.start - 2, end: b.end - 2 }));

    // Build byte-to-char map for the region slice.
    const byteToChar = buildByteToCharMap(regionText);

    // Translate WASM byte offsets (region-local) to document-global char offsets.
    const newStarts = newRegionBlocks.map(b => regionCharStart + (byteToChar[b.start] ?? b.start));
    const newEnds = newRegionBlocks.map(b => regionCharStart + (byteToChar[b.end] ?? b.end));

    // For a new region (range === undefined): S = blockCount (append after all existing
    // blocks), P = 0 (no prior blocks for this region), oldTypes = [] (no prior types).
    const S = range !== undefined ? range.start : engine.blockCount;
    const P = range !== undefined ? range.count : 0;
    const Q = newRegionBlocks.length;
    let parseMs = 0;

    // Capture old block types before mutating, for fence propagation comparison.
    // We use the stored types array from regionBlockRanges (D02 lazy fence propagation).
    const oldTypes: string[] = range !== undefined ? range.types.slice() : [];

    // Determine if this is the last region (tail). Non-tail regions require
    // shiftFrom() and key remapping when block count changes.
    const regionKeys = engine.regionMap.keys;
    const isLast = regionKeys[regionKeys.length - 1] === key;

    // Capture old region end (char offset) before any mutations, for Bug 2 char offset shifting.
    // For P > 0, the old region spans up to blockEnds[S + P - 1]. For P = 0 (new region),
    // there are no prior blocks so no subsequent offsets need shifting.
    const oldRegionEnd: number = P > 0 ? engine.blockEnds[S + P - 1] : regionCharStart;

    // Update changed existing blocks (S..S+min(P,Q)-1)
    for (let i = 0; i < Math.min(P, Q); i++) {
      const globalIdx = S + i;
      if (newStarts[i] !== engine.blockStarts[globalIdx] || newEnds[i] !== engine.blockEnds[globalIdx]) {
        const raw = engine.regionMap.text.slice(newStarts[i], newEnds[i]);
        const parseStart = performance.now();
        const html = parse_to_html(raw);
        parseMs += performance.now() - parseStart;
        engine.htmlCache.set(globalIdx, html);
        const existingEl = engine.blockNodes.get(globalIdx);
        if (existingEl) {
          existingEl.innerHTML = getDOMPurify().sanitize(html, SANITIZE_CONFIG);
          // Store estimate here; real measurement happens in doSetRegion's
          // consolidated measurement pass (one forced layout for all blocks).
          engine.heightIndex.setHeight(globalIdx, estimateBlockHeight(newRegionBlocks[i]));
        } else {
          // Not in the DOM — estimate is the best we can do.
          engine.heightIndex.setHeight(globalIdx, estimateBlockHeight(newRegionBlocks[i]));
        }
        engine.blockStarts[globalIdx] = newStarts[i];
        engine.blockEnds[globalIdx] = newEnds[i];
      }
    }

    // Handle block count change (Q != P)
    if (Q < P) {
      if (isLast) {
        // Tail shrink: remove excess tail blocks using truncate (no remapping needed).
        for (let i = Q; i < P; i++) {
          const globalIdx = S + i;
          removeBlockNode(engine, globalIdx);
          engine.htmlCache.delete(globalIdx);
        }
        engine.blockStarts.splice(S + Q, P - Q);
        engine.blockEnds.splice(S + Q, P - Q);
        engine.heightIndex.truncate(S + Q);
      } else {
        // Non-tail shrink: capture scroll position for recovery, remove excess DOM
        // nodes and cache entries, then shift surviving blocks left via shiftFrom.
        const oldScrollTop = scrollContainerRef.current?.scrollTop ?? 0;

        // (1) Remove excess DOM nodes and htmlCache entries for [S+Q, S+P).
        for (let i = Q; i < P; i++) {
          const globalIdx = S + i;
          removeBlockNode(engine, globalIdx);
          engine.htmlCache.delete(globalIdx);
        }
        engine.blockStarts.splice(S + Q, P - Q);
        engine.blockEnds.splice(S + Q, P - Q);

        // (2) shiftFrom with negative delta to compact the height array.
        engine.heightIndex.shiftFrom(S + P, Q - P);

        // (3) Remap surviving htmlCache keys >= S+P: shift left by (P - Q).
        const delta = Q - P; // negative
        const htmlEntriesToRemap: [number, string][] = [];
        for (const [k, v] of engine.htmlCache) {
          if (k >= S + P) htmlEntriesToRemap.push([k, v]);
        }
        for (const [k] of htmlEntriesToRemap) engine.htmlCache.delete(k);
        for (const [k, v] of htmlEntriesToRemap) engine.htmlCache.set(k + delta, v);

        // (4) Remap surviving blockNodes keys >= S+P: shift left by (P - Q).
        const nodeEntriesToRemap: [number, HTMLElement][] = [];
        for (const [k, el] of engine.blockNodes) {
          if (k >= S + P) nodeEntriesToRemap.push([k, el]);
        }
        for (const [k] of nodeEntriesToRemap) engine.blockNodes.delete(k);
        for (const [k, el] of nodeEntriesToRemap) {
          const newKey = k + delta;
          engine.blockNodes.set(newKey, el);
          el.dataset.blockIndex = String(newKey);
        }

        // (5) Update regionBlockRanges start for all subsequent regions.
        const keyIndex = regionKeys.indexOf(key);
        for (let ri = keyIndex + 1; ri < regionKeys.length; ri++) {
          const rkey = regionKeys[ri];
          const rrange = engine.regionBlockRanges.get(rkey);
          if (rrange) {
            engine.regionBlockRanges.set(rkey, { ...rrange, start: rrange.start + delta });
          }
        }

        // (6) Shift char offsets (blockStarts/blockEnds) for all subsequent blocks.
        // The region's char content changed, so all block char offsets after this
        // region are now stale. Compute charDelta from old vs new last-block-end.
        if (P > 0) {
          const newRegionEnd = Q > 0 ? newEnds[Q - 1] : regionCharStart;
          const charDelta = newRegionEnd - oldRegionEnd;
          if (charDelta !== 0) {
            for (let i = S + Q; i < engine.blockStarts.length; i++) {
              engine.blockStarts[i] += charDelta;
              engine.blockEnds[i] += charDelta;
            }
          }
        }

        // Content shrink scroll recovery: if scrollTop is now past the new bottom,
        // snap to the nearest surviving block offset above the old scroll position.
        if (scrollContainerRef.current) {
          const totalHeight = engine.heightIndex.getTotalHeight();
          const clientHeight = scrollContainerRef.current.clientHeight;
          if (oldScrollTop > totalHeight - clientHeight) {
            const blockIndex = engine.heightIndex.getBlockAtOffset(oldScrollTop);
            const newScrollTop = engine.heightIndex.getBlockOffset(blockIndex);
            scrollContainerRef.current.scrollTop = newScrollTop;
          }
        }
      }
    } else if (Q > P) {
      if (isLast) {
        // Tail growth: append new blocks beyond the old count.
        const newStartsSlice = newStarts.slice(P);
        const newEndsSlice = newEnds.slice(P);
        engine.blockStarts.splice(S + P, 0, ...newStartsSlice);
        engine.blockEnds.splice(S + P, 0, ...newEndsSlice);
        for (let i = P; i < Q; i++) {
          engine.heightIndex.appendBlock(estimateBlockHeight(newRegionBlocks[i]));
          const globalIdx = S + i;
          const raw = engine.regionMap.text.slice(newStarts[i], newEnds[i]);
          const parseStart = performance.now();
          engine.htmlCache.set(globalIdx, parse_to_html(raw));
          parseMs += performance.now() - parseStart;
        }
      } else {
        // Non-tail growth: shift surviving blocks right via shiftFrom, then remap.
        const delta = Q - P; // positive

        // (1) shiftFrom with positive delta to open a gap.
        engine.heightIndex.shiftFrom(S + P, delta);

        // (2) Remap surviving htmlCache keys >= S+P: shift right by (Q - P).
        const htmlEntriesToRemap: [number, string][] = [];
        for (const [k, v] of engine.htmlCache) {
          if (k >= S + P) htmlEntriesToRemap.push([k, v]);
        }
        for (const [k] of htmlEntriesToRemap) engine.htmlCache.delete(k);
        for (const [k, v] of htmlEntriesToRemap) engine.htmlCache.set(k + delta, v);

        // (3) Remap surviving blockNodes keys >= S+P: shift right by (Q - P).
        const nodeEntriesToRemap: [number, HTMLElement][] = [];
        for (const [k, el] of engine.blockNodes) {
          if (k >= S + P) nodeEntriesToRemap.push([k, el]);
        }
        for (const [k] of nodeEntriesToRemap) engine.blockNodes.delete(k);
        for (const [k, el] of nodeEntriesToRemap) {
          const newKey = k + delta;
          engine.blockNodes.set(newKey, el);
          el.dataset.blockIndex = String(newKey);
        }

        // (4) Update regionBlockRanges start for all subsequent regions.
        const keyIndex = regionKeys.indexOf(key);
        for (let ri = keyIndex + 1; ri < regionKeys.length; ri++) {
          const rkey = regionKeys[ri];
          const rrange = engine.regionBlockRanges.get(rkey);
          if (rrange) {
            engine.regionBlockRanges.set(rkey, { ...rrange, start: rrange.start + delta });
          }
        }

        // (5) Splice blockStarts/blockEnds for the new gap entries.
        const newStartsSlice = newStarts.slice(P);
        const newEndsSlice = newEnds.slice(P);
        engine.blockStarts.splice(S + P, 0, ...newStartsSlice);
        engine.blockEnds.splice(S + P, 0, ...newEndsSlice);

        // (6) Shift char offsets (blockStarts/blockEnds) for all subsequent blocks.
        // The region's char content changed, so all block char offsets after this
        // region are now stale. Compute charDelta from old vs new last-block-end.
        if (P > 0) {
          const newRegionEnd = Q > 0 ? newEnds[Q - 1] : regionCharStart;
          const charDelta = newRegionEnd - oldRegionEnd;
          if (charDelta !== 0) {
            for (let i = S + Q; i < engine.blockStarts.length; i++) {
              engine.blockStarts[i] += charDelta;
              engine.blockEnds[i] += charDelta;
            }
          }
        }

        // Parse and cache the new blocks in the gap [S+P, S+Q).
        for (let i = P; i < Q; i++) {
          const globalIdx = S + i;
          const raw = engine.regionMap.text.slice(newStarts[i], newEnds[i]);
          const parseStart = performance.now();
          engine.htmlCache.set(globalIdx, parse_to_html(raw));
          parseMs += performance.now() - parseStart;
          engine.heightIndex.setHeight(globalIdx, estimateBlockHeight(newRegionBlocks[i]));
        }
      }
    }

    // When Q == P (block count unchanged) in a non-tail region, subsequent block char
    // offsets may still be stale if the region's text length changed. Apply charDelta.
    if (Q === P && !isLast && P > 0) {
      const newRegionEnd = Q > 0 ? newEnds[Q - 1] : regionCharStart;
      const charDelta = newRegionEnd - oldRegionEnd;
      if (charDelta !== 0) {
        for (let i = S + Q; i < engine.blockStarts.length; i++) {
          engine.blockStarts[i] += charDelta;
          engine.blockEnds[i] += charDelta;
        }
      }
    }

    // Update engine block count accounting for the delta.
    engine.blockCount += (Q - P);
    const newTypes = newRegionBlocks.map(b => b.type);
    engine.regionBlockRanges.set(key, { start: S, count: Q, types: newTypes });

    // Lazy fence propagation: if block type sequence changed and a next region exists,
    // re-lex that next region. Stop when blocks stabilize. In the common streaming
    // path the tail region is always last, so this is a no-op (D02).
    //
    // A fence imbalance necessarily changes the block types of subsequent regions
    // (e.g. paragraph text becomes code inside an unbalanced fence). Comparing type
    // sequences is a reliable proxy for fence balance change and avoids the need to
    // track fence depth explicitly.
    const keyIndex = regionKeys.indexOf(key);
    if (keyIndex >= 0 && keyIndex < regionKeys.length - 1) {
      // Compare old vs new block type sequences.
      // Count change or any type mismatch indicates structural change.
      const typeSequenceChanged = oldTypes.length !== newTypes.length ||
        oldTypes.some((t, i) => t !== newTypes[i]);
      if (typeSequenceChanged) {
        const nextKey = regionKeys[keyIndex + 1];
        incrementalTailUpdate(engine, nextKey, engine.regionMap.text);
        return; // next region's call handles timing and window update
      }
    }

    onTimingRef.current?.({ lexMs, parseMs, blockCount: engine.blockCount });

    // Render the block window. When following bottom AND the user is not
    // actively scrolling, render at the predicted bottom (totalHeight) so the
    // tail blocks are in the DOM before the measurement pass in doSetRegion.
    // During active gestures, render at the user's current scroll position —
    // their fingers own the viewport.
    const clientHeight = scrollContainerRef.current?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT;
    engine.blockWindow.setViewportHeight(clientHeight);
    const willPin = smartScrollRef.current?.isFollowingBottom && !smartScrollRef.current?.isUserScrolling;
    const renderScrollTop = willPin
      ? Math.max(0, engine.heightIndex.getTotalHeight() - clientHeight)
      : (scrollContainerRef.current?.scrollTop ?? 0);
    const update = engine.blockWindow.update(renderScrollTop);
    applyWindowUpdate(engine, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
  }

  // ---- Core region update logic ----
  // Called by both the imperative handle and the streaming observer.
  // Uses incrementalTailUpdate for all non-cold-start updates (any region).
  // Cold start (wasEmpty) always goes through lexParseAndRender to establish the
  // initial block structure.
  function doSetRegion(key: string, text: string): void {
    const engine = getEngine();
    const wasEmpty = engine.regionMap.regionCount === 0;

    engine.regionMap.setRegion(key, text);
    const fullText = engine.regionMap.text;

    if (wasEmpty) {
      lexParseAndRender(engine, fullText);
    } else {
      incrementalTailUpdate(engine, key, fullText);
    }

    // When following bottom AND the user is not actively scrolling: measure
    // all rendered blocks, correct heights, recompute spacers, pin to bottom.
    //
    // The isUserScrolling guard separates INTENT from ACTION:
    //   - isFollowingBottom = intent ("user wants to follow the bottom")
    //   - !isUserScrolling = action ("safe to take control of scroll position")
    // During active gestures (dragging, decelerating), the flag may be set
    // but we don't slam — the user's fingers own the scroll position.
    // When the gesture ends (idle), the next chunk pins to the real bottom.
    const ss = smartScrollRef.current;
    if (ss?.isFollowingBottom && !ss.isUserScrolling) {
      const engine2 = engineRef.current;
      if (engine2 && scrollContainerRef.current) {
        // Single measurement pass: read offsetHeight for every rendered block.
        // This is the ONLY forced layout in the streaming hot path.
        let anyMeasured = false;
        for (const [idx, el] of engine2.blockNodes) {
          const stored = engine2.heightIndex.getHeight(idx);
          const real = el.offsetHeight;
          if (Math.abs(real - stored) > 0.5) {
            engine2.heightIndex.setHeight(idx, real);
            anyMeasured = true;
          }
        }
        if (anyMeasured) {
          // Recompute window with real heights — blocks may need to enter/exit
          // if the corrected heights shifted the visible range significantly
          // (common after cold start where most blocks have estimated heights).
          const correctedScrollTop = Math.max(0,
            engine2.heightIndex.getTotalHeight() - scrollContainerRef.current.clientHeight);
          const update = engine2.blockWindow.update(correctedScrollTop);
          applyWindowUpdate(engine2, update.topSpacerHeight, update.bottomSpacerHeight, update.enter, update.exit);
        }
      }
      // Pin to real bottom — heights are now real, spacers correct.
      ss.pinToBottom();
    }
  }

  // ---- Clear all regions and reset DOM ----
  function doClear(): void {
    const engine = getEngine();
    engine.regionMap.clear();
    engine.heightIndex.clear();
    engine.blockWindow.update(0);
    for (const [, el] of engine.blockNodes) {
      resizeObserverRef.current?.unobserve(el);
      el.remove();
    }
    engine.blockNodes.clear();
    engine.htmlCache.clear();
    engine.blockStarts = [];
    engine.blockEnds = [];
    engine.blockCount = 0;
    engine.regionBlockRanges.clear();
    applySpacers(0, 0);
  }

  // ---- Imperative handle [L03: useLayoutEffect so handle is ready before events] ----
  useImperativeHandle(ref, () => ({
    setRegion: doSetRegion,
    removeRegion(key: string) {
      const engine = getEngine();
      engine.regionMap.removeRegion(key);
      if (engine.regionMap.regionCount === 0) {
        doClear();
      } else {
        lexParseAndRender(engine, engine.regionMap.text);
      }
    },
    clear: doClear,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally empty:
    // doSetRegion, doRemoveRegion (via removeRegion closure), and doClear only
    // access refs (engineRef, scrollContainerRef, smartScrollRef, resizeObserverRef)
    // at call time. The handle is stable for the component lifetime.
  }), []);

  // ---- Streaming rendering path [L22: direct store observer, no React round-trip] ----
  useLayoutEffect(() => {
    if (!streamingStore) return;
    const unsubscribe = streamingStore.observe(streamingPath, () => {
      const text = (streamingStore.get(streamingPath) as string) ?? '';
      if (!text) return;
      doSetRegion('stream', text);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are correct:
    // streamingStore and streamingPath are the only values that should trigger
    // re-subscription. doSetRegion accesses refs at call time and does not need
    // to be listed as a dependency.
  }, [streamingStore, streamingPath]);

  // ---- Context menu (cut/copy/paste/select all) ----
  //
  // Uses TugEditorContextMenu — the same portaled menu used by
  // tug-prompt-input and the native input components.
  //
  // Selection management is handled entirely by SelectionGuard.
  // This component does NOT add its own pointer or selection event
  // listeners for selection management. The only listeners are:
  //   - contextmenu: to show/hide the editor context menu
  //   - pointerdown (bubble): ONLY to clear the selectAllActive flag
  //   - click: cleanup pass to remove collapsed carets in read-only content

  // Menu state: null when closed, {x, y, hasSelection} when open.
  const [menuState, setMenuState] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);

  const closeMenu = useCallback(() => setMenuState(null), []);

  // ---- Virtualized select-all ----
  //
  // A logical flag that means "the entire document is selected," even
  // though only a viewport window of blocks is in the DOM. When active:
  //   - Visual: a data-select-all attribute on the scroll container
  //     paints all block content with the selection color via CSS.
  //     A CSS rule suppresses ::selection to prevent double painting.
  //   - Copy: reads from regionMap.text (the full document) instead of
  //     the DOM Selection.
  //   - Cleared on the next pointerdown (bubble phase).
  const selectAllActiveRef = useRef(false);

  /** Set or clear the select-all visual state via data attribute [L06]. */
  function setSelectAllVisual(active: boolean) {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (active) {
      el.setAttribute("data-select-all", "");
    } else {
      el.removeAttribute("data-select-all");
    }
  }

  // ---- Action handlers ----

  const handleCut = useCallback((): ActionHandlerResult => {
    // Read-only component — cut is a no-op.
  }, []);

  const handleCopy = useCallback((): ActionHandlerResult => {
    if (selectAllActiveRef.current) {
      // Virtualized select-all: copy full text from the data model.
      const engine = engineRef.current;
      if (engine) {
        const text = engine.regionMap.text;
        void navigator.clipboard.writeText(text);
      }
    } else {
      // Normal selection: use execCommand("copy") which copies the
      // current DOM Selection. Runs synchronously in the user gesture.
      document.execCommand("copy");
    }
  }, []);

  const handlePaste = useCallback((): ActionHandlerResult => {
    // Read-only component — paste is a no-op.
  }, []);

  const handleSelectAll = useCallback((): ActionHandlerResult => {
    // Return a continuation so the select-all visual applies AFTER
    // the menu activation blink, matching the two-phase pattern used
    // by all TugEditorContextMenu dispatches [L11].
    return () => {
      selectAllActiveRef.current = true;
      setSelectAllVisual(true);
      // Clear the DOM Selection so native ::selection doesn't paint
      // alongside the data-select-all CSS visual.
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    };
  }, []);

  // ---- Responder registration [L11] ----

  const responderId = useId();

  const { ResponderScope, responderRef } = useOptionalResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.CUT]: handleCut,
      [TUG_ACTIONS.COPY]: handleCopy,
      [TUG_ACTIONS.PASTE]: handlePaste,
      [TUG_ACTIONS.SELECT_ALL]: handleSelectAll,
    },
  });

  // ---- Context menu items ----

  const menuItems = useMemo<TugEditorContextMenuEntry[]>(() => {
    const hasSelection = menuState?.hasSelection ?? false;
    return [
      { action: TUG_ACTIONS.CUT,        label: "Cut",        shortcut: "\u2318X", disabled: true },
      { action: TUG_ACTIONS.COPY,       label: "Copy",       shortcut: "\u2318C", disabled: !hasSelection },
      { action: TUG_ACTIONS.PASTE,      label: "Paste",      shortcut: "\u2318V", disabled: true },
      { type: "separator" },
      { action: TUG_ACTIONS.SELECT_ALL, label: "Select All", shortcut: "\u2318A" },
    ];
  }, [menuState?.hasSelection]);

  // ---- Event listeners ----
  //
  // Minimal set — SelectionGuard owns the selection lifecycle.
  // These listeners handle only:
  //   1. contextmenu: show the editor context menu
  //   2. pointerdown (bubble): clear selectAllActive flag
  //   3. click: remove collapsed carets in read-only content
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // 1. Contextmenu — show the editor context menu on right-click
    //    within the block container.
    const onContextMenu = (e: MouseEvent) => {
      const blockContainer = blockContainerRef.current;
      if (!blockContainer) return;
      if (!blockContainer.contains(e.target as Node) && e.target !== blockContainer) return;
      e.preventDefault();

      const hasSelection = selectAllActiveRef.current || (() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
        return blockContainer.contains(sel.anchorNode) || blockContainer.contains(sel.focusNode);
      })();

      setMenuState({ x: e.clientX, y: e.clientY, hasSelection });
    };

    // 2. Pointerdown (bubble phase) — clear select-all on any
    //    non-right-click. This runs AFTER SelectionGuard's capture-phase
    //    handler has already processed the event, so there's no race.
    //    This is the ONLY pointer listener; no pointermove/pointerup.
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2 && selectAllActiveRef.current) {
        selectAllActiveRef.current = false;
        setSelectAllVisual(false);
      }
    };

    container.addEventListener("contextmenu", onContextMenu);
    container.addEventListener("pointerdown", onPointerDown);
    return () => {
      container.removeEventListener("contextmenu", onContextMenu);
      container.removeEventListener("pointerdown", onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, []);

  // Compose scrollContainerRef with responderRef so one DOM element gets
  // both: the scroll container ref for windowing logic and the responder
  // ref for data-responder-id so the chain's first-responder resolution
  // can find this node.
  const composedScrollRef = useCallback((el: HTMLDivElement | null) => {
    (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    responderRef(el);
  }, [responderRef]);

  return (
    <ResponderScope>
      <div
        ref={composedScrollRef}
        data-slot="tug-markdown-view"
        className={cn("tugx-md-scroll-container", className)}
        tabIndex={0}
      >
        <div ref={topSpacerRef} className="tugx-md-spacer tugx-md-spacer--top" aria-hidden="true" />
        <div ref={blockContainerRef} className="tugx-md-block-container" />
        <div ref={bottomSpacerRef} className="tugx-md-spacer tugx-md-spacer--bottom" aria-hidden="true" />
        <div className="tugx-md-bottom-buffer" aria-hidden="true" />
        <TugEditorContextMenu
          open={menuState !== null}
          x={menuState?.x ?? 0}
          y={menuState?.y ?? 0}
          items={menuItems}
          onClose={closeMenu}
        />
      </div>
    </ResponderScope>
  );
});
