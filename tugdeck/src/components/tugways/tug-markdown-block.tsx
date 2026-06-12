/**
 * `TugMarkdownBlock` — non-virtualizing markdown renderer.
 *
 * The natural-flow sibling primitive to `TugMarkdownView`. Both share
 * the WASM lex/parse + DOMPurify sanitize pipeline via
 * `parseMarkdownToSanitizedBlocks`; only their layout surfaces
 * differ:
 *
 *   - `TugMarkdownView` owns its own scroll container + windowing
 *     engine, suitable for whole-document logs (1 MB+ content,
 *     thousands of blocks).
 *   - `TugMarkdownBlock` renders every block in document flow with
 *     no scroll container, no spacers, no virtualization — the host
 *     (a list cell, a card body, etc.) owns scroll and layout. It is
 *     designed for per-cell or per-message markdown content where
 *     the content size is bounded.
 *
 * Two modes, mutually exclusive at mount:
 *
 *   1. **Static `initialText` mode** — `<TugMarkdownBlock initialText="..." />`.
 *      Parses + renders the supplied text in `useLayoutEffect` so
 *      the content is painted before the first browser frame.
 *      Subsequent `initialText` prop changes are ignored. Routes
 *      through `renderIncremental(el, text, null)` for code-path
 *      uniformity with streaming mode — the `prev = null` path of
 *      the reconciler is its full-reset render (every block appended
 *      fresh), so the output is identical to a one-shot bulk render.
 *      The returned `RenderState` is discarded since initial-text
 *      mode is mount-once and never re-renders.
 *
 *   2. **Streaming `streamingStore` mode** —
 *      `<TugMarkdownBlock streamingStore={store} streamingPath="text" />`.
 *      On mount, reads `store.get(streamingPath)` synchronously and
 *      renders that current value (the [#md-block-api] G1
 *      contract — `PropertyStore.observe` does NOT fire on subscribe,
 *      so a cell that mounts while the store already holds content
 *      would otherwise render empty until the next emission). Then
 *      subscribes via `store.observe(streamingPath, listener)` and
 *      reconciles on each emission via `renderIncremental` — the
 *      reconciler walks per-block content hashes against the
 *      previous render's hashes and mutates only what changed
 *      (in-place `innerHTML` rewrites preserve wrapper-element
 *      identity, which preserves the browser's scroll anchor).
 *      Per-container `RenderState` is cached in a module-level
 *      `WeakMap` so each mounted instance keeps its own diff
 *      history; when the container is GC'd, the entry goes with it.
 *      Bursts are coalesced via `requestAnimationFrame`.
 *
 * Both modes write sanitized HTML directly to the DOM — there is no
 * React state for the rendered content per [L06]. The only React
 * state is the container element ref.
 *
 * Laws:
 *  - [L03] `useLayoutEffect` for the mount-render and the streaming
 *    subscription so DOM is in place before paint.
 *  - [L06] appearance changes go through CSS / DOM, never React
 *    state.
 *  - [L19] component authoring guide — file pair (`.tsx` + `.css`),
 *    module docstring, exported props interface,
 *    `data-slot="tug-markdown-block"`.
 *  - [L20] component-token sovereignty — reuses `--tugx-md-*` tokens
 *    only; no new tokens introduced.
 *  - [L22] streaming-binding observes the `PropertyStore` directly
 *    and writes DOM imperatively, bypassing the React render cycle
 *    for per-delta updates.
 *  - [L23] streaming mode preserves user scroll position by routing
 *    every delta through the incremental reconciler ([#step-18-8]),
 *    which preserves the DOM element identity that browser scroll
 *    anchoring depends on.
 *
 * Decisions:
 *  - [D09] `TugMarkdownBlock` is a sibling primitive, not a flow
 *    mode on `TugMarkdownView`.
 *  - [D06] streaming cells observe the streaming source directly via
 *    this primitive's `streamingStore` mode.
 */

import "./tug-markdown-block.css";

import React from "react";

import type { PropertyStore } from "@/components/tugways/property-store";
import { ensureParsed } from "@/lib/markdown/parse-cache";
import { recordRowParse } from "@/lib/markdown/parse-counters";
import {
  renderIncremental,
  renderIncrementalFromBlocks,
  type RenderState,
} from "@/lib/markdown/render-incremental";

/**
 * Per-container `RenderState` cache for the streaming-mode
 * reconciler. `WeakMap` keys hold no strong references — when the
 * container element is GC'd (component unmount, React tree
 * reconciliation), the cached state goes with it. No leak path, no
 * cross-instance bleed.
 */
const STREAMING_RENDER_STATE: WeakMap<HTMLElement, RenderState> = new WeakMap();

const DEFAULT_STREAMING_PATH = "text";

/**
 * Props for `TugMarkdownBlock`. `initialText` and `streamingStore`
 * are mutually exclusive at mount; if both are supplied, the
 * streaming mode takes precedence (the `initialText` prop is
 * effectively ignored). Consumers should set one xor the other.
 */
export interface TugMarkdownBlockProps {
  /**
   * Static initial text. Parsed + rendered once on mount before
   * paint; subsequent prop changes are ignored. Consumers that need
   * to update content remount (typically via a fresh React key) or
   * switch to streaming mode.
   */
  initialText?: string;

  /**
   * `PropertyStore` for streaming text. When set, the component
   * enters streaming mode: reads the current value on mount,
   * subscribes for updates, and re-renders on each emission with
   * rAF coalescing.
   */
  streamingStore?: PropertyStore;

  /**
   * `PropertyStore` path key for the streaming text value. Default
   * `"text"`. Only consulted in streaming mode.
   *
   * @default "text"
   */
  streamingPath?: string;

  /**
   * Forwarded class name. Cascade-scoped customization happens here
   * — consumers tune `--tugx-md-*` tokens for their instance via a
   * wrapping selector, not by reaching into the primitive's CSS
   * ([L20]).
   */
  className?: string;
}

export const TugMarkdownBlock: React.FC<TugMarkdownBlockProps> = ({
  initialText,
  streamingStore,
  streamingPath = DEFAULT_STREAMING_PATH,
  className,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Static `initialText` mode — runs once at mount, never again.
  // Skipped entirely when `streamingStore` is set; the streaming
  // effect below owns the render in that case so this effect's
  // initialText pass would only race with it.
  //
  // Reuses the streaming-mode reconciler with `prev = null` so the
  // block-element construction recipe (.tugx-md-block wrapper +
  // data-blockType + sanitized innerHTML + enhanceFencedCode) lives
  // in exactly one place — `renderIncremental` / `buildBlockElement`.
  // The reconciler's full-reset path produces identical DOM to a
  // bulk one-shot render, so the visible behaviour is unchanged.
  // Returned state is discarded: initial-text mode is mount-once.
  React.useLayoutEffect(() => {
    if (streamingStore !== undefined) return;
    const el = containerRef.current;
    if (el === null) return;
    const text = initialText ?? "";
    // Parse-economy counter: `renderIncremental` skips the parse
    // entirely for empty text, so only non-empty renders count.
    if (text !== "") recordRowParse("static");
    renderIncremental(el, text, null);
    // Empty deps — `initialText` changes after mount are intentionally
    // ignored per the [#md-block-api] mount-once contract. A consumer
    // that wants to swap content remounts via a fresh React key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Streaming `streamingStore` mode — reads the current value
  // synchronously on mount (G1) and subscribes for updates. Each
  // emission flows through the incremental reconciler
  // ([#step-18-8]), which mutates only the blocks whose source byte
  // ranges changed. Wrapper elements for stable blocks keep their
  // identity across deltas, which keeps the browser's scroll anchor
  // valid and the user's reading position intact.
  //
  // `PropertyStore.observe` does NOT fire on subscribe, so the
  // initial pre-paint render here is essential when a streaming cell
  // mounts while the store already holds content (e.g.
  // scroll-out-and-back). Updates are rAF-coalesced so a burst of
  // deltas produces at most one render per paint frame.
  React.useLayoutEffect(() => {
    if (streamingStore === undefined) return;
    const el = containerRef.current;
    if (el === null) return;

    const reconcile = (text: string): void => {
      const prev = STREAMING_RENDER_STATE.get(el) ?? null;
      if (text === "") {
        const { state } = renderIncremental(el, "", prev);
        STREAMING_RENDER_STATE.set(el, state);
        return;
      }
      // Render-once cache, scoped to the session's streaming store and
      // keyed by the row's stable streaming-path identity
      // (`turn.${turnKey}.message.${messageKey}.text`). A finalized
      // row's text never changes, so after its last parse every
      // subsequent render — re-mounts included (the per-container diff
      // state is gone, the cache isn't) — skips the WASM
      // lex/parse/sanitize pass and goes straight to the shared DOM
      // apply. A streaming row's text changes per delta, so it misses
      // and parses exactly as before; its final delta's parse IS the
      // warm finalized entry. `ensureParsed` is the shared chokepoint
      // the speculative warm queue also parses through, so a warmed
      // row's mount is a pure cache hit.
      const blocks = ensureParsed(streamingStore, streamingPath, text);
      const { state } = renderIncrementalFromBlocks(el, blocks, prev);
      STREAMING_RENDER_STATE.set(el, state);
    };

    // G1 — render the store's current value before paint. Initial
    // call passes `null` prev state through `WeakMap.get`'s
    // unset-key behaviour, so the reconciler treats this as a
    // full-reset render (every block appended fresh).
    const initial = (streamingStore.get(streamingPath) as string | undefined) ?? "";
    reconcile(initial);

    let pendingRaf: number | null = null;
    const flush = () => {
      pendingRaf = null;
      const target = containerRef.current;
      if (target === null) return;
      const text = (streamingStore.get(streamingPath) as string | undefined) ?? "";
      reconcile(text);
    };

    const unsubscribe = streamingStore.observe(streamingPath, () => {
      // First emission in a burst schedules the flush; subsequent
      // emissions see the queued id and skip the schedule. The rAF
      // clears the id and reconciles, picking up the cumulative
      // store value at the time it fires.
      if (pendingRaf !== null) return;
      pendingRaf = requestAnimationFrame(flush);
    });

    return () => {
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf);
        pendingRaf = null;
      }
      unsubscribe();
      // Intentionally NOT deleting `STREAMING_RENDER_STATE[el]` here.
      // React 18 dev strict mode runs effects as
      // `mount → cleanup → mount` against the same container element;
      // cleanup tears down subscriptions and pending rAF but leaves
      // the DOM children intact. If the cached state were dropped on
      // cleanup, the second mount would see `prev = null` and treat
      // the existing children as nonexistent — the reconciler would
      // *append* a fresh set, doubling every block in the container.
      // The `WeakMap` GCs the entry on its own when the container
      // element is destroyed.
    };
  }, [streamingStore, streamingPath]);

  return (
    <div
      ref={containerRef}
      data-slot="tug-markdown-block"
      className={
        className === undefined
          ? "tug-markdown-block"
          : `tug-markdown-block ${className}`
      }
    />
  );
};
