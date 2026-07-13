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
 *      through `renderIncremental(el, text)` for code-path uniformity
 *      with streaming mode — against an empty container the reconciler
 *      appends every block fresh, so the output is identical to a
 *      one-shot bulk render. The returned `RenderState` is discarded
 *      since initial-text mode is mount-once and never re-renders.
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
 *      The previous render's hashes are recovered from the
 *      container's own children (`data-content-hash`), so the diff
 *      is stateless across calls: a Fast Refresh module reload or a
 *      strict-mode remount that would wipe a module-level cache
 *      cannot make the reconciler duplicate (or blank) blocks that
 *      are already on screen. Bursts are coalesced via
 *      `requestAnimationFrame`.
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
import { enhanceSlashCommands } from "@/lib/markdown/enhance-slash-commands";
import {
  renderIncremental,
  renderIncrementalFromBlocks,
} from "@/lib/markdown/render-incremental";

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

  /**
   * Opt this block's rendered text into transcript Find: stamps
   * `data-tugx-findable` on the root so the find painter walks it
   * (`transcript-find-highlighter.ts`). Set ONLY by transcript content
   * surfaces whose text the search index projects — marking without a
   * matching index projection breaks the count↔paint alignment. Default
   * `false`: gallery, tool-result, and other non-indexed hosts stay
   * unsearchable.
   */
  findable?: boolean;

  /**
   * Clickability gate for inline slash-command `<code>` spans. When set,
   * a code span that parses as a known slash command (this predicate
   * returns `true` for its bare name) is tagged for the transcript's
   * click-to-run gesture (`enhance-slash-commands`). Omit — every
   * non-transcript host — and no command enhancement runs.
   *
   * Delivered to the imperative render closures via a ref, NOT closed
   * over directly: the streaming render effect's deps are
   * `[streamingStore, streamingPath]`, so a captured prop would be stale
   * — the ref keeps the predicate current at the mount build (which tags
   * finalized blocks) and at every streaming delta.
   */
  isKnownSlashCommand?: (name: string) => boolean;
}

export const TugMarkdownBlock: React.FC<TugMarkdownBlockProps> = ({
  initialText,
  streamingStore,
  streamingPath = DEFAULT_STREAMING_PATH,
  className,
  findable = false,
  isKnownSlashCommand,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // The slash-command predicate is read from a ref inside the render
  // closures below, never closed over directly: the streaming effect's
  // deps are `[streamingStore, streamingPath]`, so a captured prop would
  // be stale. Reassigned every render so the closures see the live
  // predicate (see the `isKnownSlashCommand` prop doc).
  const predicateRef = React.useRef(isKnownSlashCommand);
  predicateRef.current = isKnownSlashCommand;

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
    renderIncremental(
      el,
      text,
      predicateRef.current === undefined
        ? undefined
        : { isKnownSlashCommand: predicateRef.current },
    );
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
      if (text === "") {
        renderIncremental(el, "");
        return;
      }
      // Render-once cache, scoped to the session's streaming store and
      // keyed by the row's stable streaming-path identity
      // (`turn.${turnKey}.message.${messageKey}.text`). A finalized
      // row's text never changes, so after its last parse every
      // subsequent render — re-mounts included — skips the WASM
      // lex/parse/sanitize pass and goes straight to the shared DOM
      // apply. A streaming row's text changes per delta, so it misses
      // and parses exactly as before; its final delta's parse IS the
      // finalized cache entry, so a later remount of the same row is
      // a pure cache hit through the `ensureParsed` chokepoint.
      //
      // The reconciler recovers the previous render from the container's
      // own children (`data-content-hash`), so there is no per-container
      // diff state to thread here and nothing a module reload can wipe —
      // an emptied parse cache costs at most one extra parse, never a
      // duplicate-append.
      const blocks = ensureParsed(streamingStore, streamingPath, text);
      renderIncrementalFromBlocks(el, blocks, predicateRef.current);
    };

    // G1 — render the store's current value before paint. The
    // reconciler diffs against whatever children the container already
    // holds (none on a fresh mount → full append; the prior render's
    // blocks on a remount → all stable, a no-op).
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
      // Cleanup tears down the subscription and any pending rAF but
      // deliberately leaves the container's DOM children in place.
      // React 18 dev strict mode (and Vite Fast Refresh) re-run this
      // effect as `cleanup → setup` against the SAME container; on the
      // re-setup the reconciler reads the previous render's hashes back
      // off those surviving children (`data-content-hash`), sees them
      // unchanged, and does nothing. There is no module-level diff state
      // to lose, so a reload can neither duplicate the blocks nor blank
      // them — the worst case is a wasted re-parse on a cache miss.
    };
  }, [streamingStore, streamingPath]);

  // Re-tag clickable slash commands when the known-command predicate
  // changes identity — the on-resume catalog race. The render effects
  // above tag at block *build* time; a finalized block is hash-stable and
  // never rebuilt, so if the transcript replayed from JSONL before the
  // handshake catalog landed, its command spans were built untagged. This
  // effect re-runs `enhanceSlashCommands` over the already-rendered DOM
  // once the catalog (and thus the predicate) arrives — an idempotent
  // add/remove sync, no DOM rebuild (scroll anchor preserved). Runs after
  // the render effects so the container is populated. [L06] DOM-only.
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null || isKnownSlashCommand === undefined) return;
    enhanceSlashCommands(el, isKnownSlashCommand);
  }, [isKnownSlashCommand]);

  return (
    <div
      ref={containerRef}
      data-slot="tug-markdown-block"
      data-tugx-findable={findable ? "" : undefined}
      className={
        className === undefined
          ? "tug-markdown-block"
          : `tug-markdown-block ${className}`
      }
    />
  );
};
