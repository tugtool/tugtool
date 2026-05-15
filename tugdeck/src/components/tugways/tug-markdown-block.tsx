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

// ===========================================================================
// TEMPORARY DIAGNOSTIC — Step 18.8 scroll-jump investigation.
//
// Module-scope so it survives across all TugMarkdownBlock mounts /
// unmounts and HMR cycles. Installs once-per-scrollport tracking when
// `installScrollJumpDiagnostic(scrollport)` is first called for that
// element. Subsequent calls are idempotent; the traps stay live for
// the lifetime of the element.
//
// What it logs:
//   - [scrollTop=PROG]  every programmatic write via the setter
//   - [scrollTo]        every scrollTo({...}) call
//   - [scrollBy]        every scrollBy({...}) call
//   - [scroll-event]    every browser-fired scroll event with delta
//   - [scrollHeight]    every change to scrollHeight (rAF poll)
//   - [scrollTop=DRIFT] every change to scrollTop NOT from PROG/scrollTo/
//                       scrollBy (browser auto-clamp, scroll anchoring, etc)
//   - "*** CLAMP WINDOW ***" tagged on scrollHeight drops whose new
//     value is below the prior scrollTop + clientHeight
// ===========================================================================

interface DiagnosticState {
  installed: boolean;
  lastTop: number;
  lastHeight: number;
  lastWriteByDiag: boolean;
}
const SCROLL_JUMP_DIAGNOSTIC: WeakMap<HTMLElement, DiagnosticState> = new WeakMap();

function installScrollJumpDiagnostic(sp: HTMLElement): void {
  if (SCROLL_JUMP_DIAGNOSTIC.get(sp)?.installed === true) return;
  const state: DiagnosticState = {
    installed: true,
    lastTop: sp.scrollTop,
    lastHeight: sp.scrollHeight,
    lastWriteByDiag: false,
  };
  SCROLL_JUMP_DIAGNOSTIC.set(sp, state);

  // ---- scrollTop setter trap ----
  let proto: object | null = Object.getPrototypeOf(sp);
  let realDesc: PropertyDescriptor | undefined;
  while (proto !== null) {
    const d = Object.getOwnPropertyDescriptor(proto, "scrollTop");
    if (d !== undefined) {
      realDesc = d;
      break;
    }
    proto = Object.getPrototypeOf(proto);
  }
  if (realDesc?.get !== undefined && realDesc.set !== undefined) {
    const realGet = realDesc.get;
    const realSet = realDesc.set;
    Object.defineProperty(sp, "scrollTop", {
      configurable: true,
      get(this: HTMLElement) {
        return realGet.call(this);
      },
      set(this: HTMLElement, v: number) {
        const before = realGet.call(this);
        // eslint-disable-next-line no-console
        console.log(
          `[scrollTop=PROG] write ${Number(before).toFixed(1)} -> ${Number(v).toFixed(1)}`,
          {
            scrollHeight: (this as HTMLElement).scrollHeight,
            clientHeight: (this as HTMLElement).clientHeight,
          },
        );
        // eslint-disable-next-line no-console
        console.trace("[scrollTop=PROG] caller");
        state.lastWriteByDiag = true;
        realSet.call(this, v);
      },
    });
  }

  // ---- scrollTo / scrollBy method traps ----
  const origScrollTo = sp.scrollTo.bind(sp);
  const origScrollBy = sp.scrollBy.bind(sp);
  sp.scrollTo = function (this: HTMLElement, ...args: unknown[]): void {
    const before = this.scrollTop;
    // eslint-disable-next-line no-console
    console.log(
      `[scrollTo] before=${before.toFixed(1)} args=${JSON.stringify(args)}`,
      { scrollHeight: this.scrollHeight, clientHeight: this.clientHeight },
    );
    // eslint-disable-next-line no-console
    console.trace("[scrollTo] caller");
    state.lastWriteByDiag = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (origScrollTo as any)(...args);
  } as typeof sp.scrollTo;
  sp.scrollBy = function (this: HTMLElement, ...args: unknown[]): void {
    const before = this.scrollTop;
    // eslint-disable-next-line no-console
    console.log(
      `[scrollBy] before=${before.toFixed(1)} args=${JSON.stringify(args)}`,
      { scrollHeight: this.scrollHeight, clientHeight: this.clientHeight },
    );
    // eslint-disable-next-line no-console
    console.trace("[scrollBy] caller");
    state.lastWriteByDiag = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (origScrollBy as any)(...args);
  } as typeof sp.scrollBy;

  // ---- scroll event listener (catches EVERY scrollTop change the
  // browser fires, including auto-clamps and scroll anchoring) ----
  sp.addEventListener(
    "scroll",
    () => {
      const t = sp.scrollTop;
      const delta = t - state.lastTop;
      if (Math.abs(delta) > 0.5) {
        const tag = state.lastWriteByDiag ? "scroll-event(post-write)" : "scroll-event(BROWSER)";
        // eslint-disable-next-line no-console
        console.log(
          `[${tag}] ${state.lastTop.toFixed(1)} -> ${t.toFixed(1)} ` +
            `(Δ=${delta.toFixed(1)}, scrollHeight=${sp.scrollHeight}, clientHeight=${sp.clientHeight})`,
        );
        state.lastTop = t;
      }
      state.lastWriteByDiag = false;
    },
    { passive: true },
  );

  // ---- focusin listener: catches focus shifts that trigger auto-scroll ----
  // Fires when ANY element inside the scrollport gains focus.
  // The browser auto-scrolls to make the focused element visible — if
  // the focused element is at the top of the document, scrollTop
  // snaps to 0. Captures on document so we catch focus from anywhere.
  document.addEventListener(
    "focusin",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target === null) return;
      if (!sp.contains(target)) return; // ignore focus outside this scrollport
      // eslint-disable-next-line no-console
      console.log(
        `[focusin] target=`,
        target,
        {
          tagName: target.tagName,
          tabIndex: target.tabIndex,
          scrollTop: sp.scrollTop,
          scrollHeight: sp.scrollHeight,
        },
      );
      // eslint-disable-next-line no-console
      console.trace("[focusin] caller");
    },
    { capture: true, passive: true },
  );

  // ---- rAF poll: catches scrollHeight changes (no event for those) ----
  const poll = (): void => {
    requestAnimationFrame(poll);
    const h = sp.scrollHeight;
    const t = sp.scrollTop;
    const c = sp.clientHeight;
    if (h !== state.lastHeight) {
      const dropped = h < state.lastHeight;
      const clampWindow = h < state.lastTop + c;
      // eslint-disable-next-line no-console
      console.log(
        `[scrollHeight] ${state.lastHeight} -> ${h} ` +
          `(${dropped ? "DROP" : "grow"}, scrollTop=${t.toFixed(1)}, clientHeight=${c}` +
          `${clampWindow && dropped ? " *** CLAMP WINDOW ***" : ""})`,
      );
      state.lastHeight = h;
    }
    // Sync lastTop from the poll too, in case a drift was small enough
    // to miss the scroll-event threshold.
    if (Math.abs(t - state.lastTop) > 0.5) {
      // eslint-disable-next-line no-console
      console.log(
        `[scrollTop=DRIFT] ${state.lastTop.toFixed(1)} -> ${t.toFixed(1)} ` +
          `(scrollHeight=${h}, clientHeight=${c})`,
      );
      state.lastTop = t;
    }
  };
  requestAnimationFrame(poll);
}

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
    renderIncremental(el, initialText ?? "", null);
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

    // TEMPORARY DIAGNOSTIC — Step 18.8 scroll-jump investigation.
    // Install module-scope traps once per scrollport (idempotent).
    function findScrollport(node: HTMLElement | null): HTMLElement | null {
      let cur: HTMLElement | null = node?.parentElement ?? null;
      while (cur !== null) {
        const style = getComputedStyle(cur);
        const oy = style.overflowY;
        if (oy === "auto" || oy === "scroll") return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    const scrollport = findScrollport(el);
    if (scrollport !== null) {
      // eslint-disable-next-line no-console
      console.log("[md-scroll-debug] scrollport =", scrollport, {
        scrollKey: scrollport.getAttribute("data-tug-scroll-key"),
        clientHeight: scrollport.clientHeight,
        scrollHeight: scrollport.scrollHeight,
        scrollTop: scrollport.scrollTop,
      });
      installScrollJumpDiagnostic(scrollport);
    }

    const reconcile = (text: string): void => {
      const prev = STREAMING_RENDER_STATE.get(el) ?? null;
      const beforeTop = scrollport?.scrollTop ?? -1;
      const beforeHeight = scrollport?.scrollHeight ?? -1;
      const { state, plan } = renderIncremental(el, text, prev);
      STREAMING_RENDER_STATE.set(el, state);
      const afterTop = scrollport?.scrollTop ?? -1;
      const afterHeight = scrollport?.scrollHeight ?? -1;
      const delta = afterTop - beforeTop;
      const moved = Math.abs(delta) > 0.5;
      const interesting =
        moved ||
        plan.updateCount > 0 ||
        plan.appendCount > 0 ||
        plan.removeCount > 0;
      if (interesting) {
        // eslint-disable-next-line no-console
        console.log(
          `[md-scroll-debug] reconcile plan=${JSON.stringify(plan)} ` +
            `scrollTop ${beforeTop.toFixed(1)} -> ${afterTop.toFixed(1)} ` +
            `(Δ=${delta.toFixed(1)}) ` +
            `scrollHeight ${beforeHeight} -> ${afterHeight} ` +
            `${moved ? "*** SCROLL MOVED ***" : ""}`,
        );
      }
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
