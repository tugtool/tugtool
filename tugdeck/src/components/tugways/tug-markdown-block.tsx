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
 *      Subsequent `initialText` prop changes are ignored. Uses the
 *      one-shot `renderBlocks` path: a single bulk parse + atomic
 *      `replaceChildren(...newNodes)` swap. There's no prior state
 *      to diff against, so the incremental reconciler would produce
 *      identical output at marginally higher cost.
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
import { enhanceFencedCode } from "@/lib/markdown/enhance-fenced-code";
import { parseMarkdownToSanitizedBlocks } from "@/lib/markdown/parse-markdown-to-sanitized-blocks";
import {
  renderIncremental,
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

/**
 * Replace the container's children with one `<div class="tugx-md-block">`
 * per parsed markdown block. Empty input clears the container. Direct
 * DOM mutation per [L06]; the React render does not own block content.
 *
 * **Atomic swap.** Build every new block element off-DOM via
 * `createElement` first, then commit them in a single
 * `container.replaceChildren(...newNodes)` call. The two-phase shape
 * matters: a naive `replaceChildren()` followed by a loop of
 * `appendChild` momentarily empties the container, which makes the
 * outer scrollport's `scrollHeight` shrink below the user's current
 * `scrollTop`. The browser auto-clamps `scrollTop` to the new
 * `scrollHeight - clientHeight`, then never restores it — the user
 * sees the transcript snap upward on every streaming delta. The
 * varargs `replaceChildren(...nodes)` swaps the entire child list as
 * one mutation, so the container's height never crosses zero and the
 * scroll-clamp path never fires.
 */
function renderBlocks(container: HTMLElement, text: string): void {
  if (text === "") {
    container.replaceChildren();
    return;
  }
  const blocks = parseMarkdownToSanitizedBlocks(text);
  const newNodes: HTMLDivElement[] = blocks.map((block) => {
    const blockEl = document.createElement("div");
    blockEl.className = "tugx-md-block";
    blockEl.dataset.blockType = block.type;
    blockEl.innerHTML = block.html;
    enhanceFencedCode(blockEl);
    return blockEl;
  });
  container.replaceChildren(...newNodes);
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
  React.useLayoutEffect(() => {
    if (streamingStore !== undefined) return;
    const el = containerRef.current;
    if (el === null) return;
    renderBlocks(el, initialText ?? "");
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
      const { state } = renderIncremental(el, text, prev);
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
      // Drop the cached reconciler state for this container so a
      // future re-mount of the same DOM node (rare, but possible
      // under React's reconciliation) starts from a clean slate.
      // The `WeakMap` would also clear it on container GC, but
      // explicit cleanup makes the intent obvious at the call site.
      STREAMING_RENDER_STATE.delete(el);
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
