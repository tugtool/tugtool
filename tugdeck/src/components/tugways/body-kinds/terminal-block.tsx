/**
 * `TerminalBlock` — Layer-1 body kind for ANSI-aware terminal output.
 *
 * Renders structured terminal data (stdout / stderr / optional
 * footer fields) inline in the transcript. Used by Layer-2 wrappers
 * (`BashToolBlock` in [#step-6]) and reachable directly from the
 * gallery and from `RenderInput`-routed body kinds whose data shape
 * is "two text streams + post-mortem badges."
 *
 * Two-mode contract (mirrors the [Spec S02] body-kind shape):
 *
 *   1. **Static** — `<TerminalBlock data={…} />`. Renders once on
 *      mount, then ignores subsequent prop changes (mount-once
 *      contract). Consumers that need to swap content remount via a
 *      fresh React key.
 *
 *   2. **Streaming** — `<TerminalBlock streamingStore={…}
 *      streamingPath="…" />`. Subscribes to a `PropertyStore` path
 *      whose value is a `TerminalData` object; re-parses + redraws
 *      on each emission, coalesced by `requestAnimationFrame`.
 *      Implements the [Spec S05] streaming binding directly (G1
 *      sync read on mount, observe for updates, write the DOM
 *      imperatively).
 *
 * Composition:
 *
 *  - Header (React-rendered `.tugx-term-header`): optional label
 *    slot at left (`headerLabel` prop — typically the command for
 *    Bash tool standalone use; embedded hosts pass `undefined`
 *    because their own chrome carries identity), a flex spacer, and
 *    a `Copy` `<TugIconButton>` at right. The header is
 *    `position: sticky` so it stays visible while the user scrolls
 *    deep into the body. The Copy overlay (`.tugx-term-copy` absolute
 *    div) it replaces was retired: it sat on top of the scrollbar
 *    gutter for any output tall enough to trigger scrolling.
 *  - Body (imperatively rendered into `.tugx-term-content`): the
 *    truncation banner, the flat / virtualized line container, and
 *    the post-mortem footer. The line rendering, ANSI palette, and
 *    virtualization machinery are unchanged — the header is the
 *    only structural addition.
 *
 * Render strategy:
 *
 *   - **Flat path** for ≤ `VISIBLE_THRESHOLD` lines (default 40):
 *     every line is in the DOM. Simple, fast, no scroll container —
 *     the host owns scroll.
 *   - **Virtualized path** for > `VISIBLE_THRESHOLD` lines: the
 *     block paints its own scroll container, drives a
 *     `BlockHeightIndex` + `RenderedBlockWindow`, and only the
 *     visible window plus an overscan of two viewport heights is in
 *     the DOM. The scroller declares `scrollbar-gutter: stable` so
 *     the gutter is reserved regardless of content height (no
 *     horizontal layout shift when output grows past the viewport).
 *     This is the [D02] decision; the audit's P95 of 40 lines made
 *     40 the natural threshold.
 *   - **Retention cap** at `RETAINED_LINE_CAP` (10k per [Q04]):
 *     when the parsed-line count exceeds the cap, the earliest
 *     lines are dropped and a "… N earlier lines truncated"
 *     indicator is prepended. The audit's max observed Bash output
 *     was 706 lines, so the cap is a defense against pathological
 *     streams (`watch`, log tails) rather than a hot-path concern.
 *
 * Laws:
 *  - [L03] `useLayoutEffect` for the mount-render and the streaming
 *    subscription so DOM is in place before paint.
 *  - [L06] appearance changes go through CSS / DOM. The scroll
 *    listener writes spacer heights and reorders line elements
 *    imperatively — no React rerender per scroll event. The Copy
 *    button's `aria-label` and `onClick` are React props, but the
 *    "I just wrote text to the clipboard" feedback is a DOM class
 *    swap on the button ref so the imperative render path doesn't
 *    have to roundtrip through React state.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="terminal-body"` on the root.
 *  - [L20] component-token sovereignty — owns the `--tugx-term-*`
 *    slot family ([Table T07]). The retired Copy overlay's
 *    `--tugx-term-copy-*` slots were dropped with it.
 *  - [L22] streaming binding observes the `PropertyStore` directly
 *    and rebuilds the DOM imperatively; React state holds only
 *    container refs.
 *
 * Decisions:
 *  - [D02] self-virtualizes long output via `BlockHeightIndex` +
 *    `RenderedBlockWindow`.
 *  - [D06] ANSI parsing stays in JS (`ansi_up`); see
 *    `lib/ansi/ansi-to-html.ts`.
 *  - [Q04] retained-line cap is 10k — defense against pathological
 *    streams; not configurable in v1.
 *
 * @module components/tugways/body-kinds/terminal-block
 */

import "./terminal-block.css";

import React from "react";
import { Copy } from "lucide-react";

import type { PropertyStore } from "@/components/tugways/property-store";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { ansiToHtml } from "@/lib/ansi/ansi-to-html";
import { BlockHeightIndex } from "@/lib/block-height-index";
import { RenderedBlockWindow } from "@/lib/rendered-block-window";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured terminal data — the body's render input.
 *
 * `stdout` / `stderr` are the two text streams. `exitCode`,
 * `durationMs`, and `interrupted` populate the footer when set;
 * they're optional because they only land at completion (the live
 * stream has neither yet).
 */
export interface TerminalData {
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
  interrupted?: boolean;
}

export interface TerminalBlockProps {
  /**
   * Static terminal data. Rendered once at mount; subsequent prop
   * changes are ignored (mount-once contract). Mutually exclusive
   * with `streamingStore` — if both are supplied, streaming mode
   * takes precedence.
   */
  data?: TerminalData;

  /**
   * `PropertyStore` for streaming mode. The path's value is read as
   * a `TerminalData` object on mount and on every emission.
   */
  streamingStore?: PropertyStore;

  /**
   * `PropertyStore` path key for the streaming `TerminalData`.
   * Default `"terminal"`. Only consulted in streaming mode.
   *
   * @default "terminal"
   */
  streamingPath?: string;

  /**
   * Forwarded class name. Cascade-scoped customization happens here —
   * consumers tune `--tugx-term-*` tokens via a wrapping selector
   * per [L20].
   */
  className?: string;

  /**
   * "Embedded" mode — drop the terminal's own frame
   * (background / border / radius / outer margin) so it integrates
   * flush inside a host that already paints a container, e.g. a
   * `ToolWrapperChrome` body region. The lines, header strip,
   * footer badges and ANSI palette are unchanged. Default `false` —
   * standalone usage (gallery, RenderInput-routed) keeps its frame.
   *
   * @default false
   */
  embedded?: boolean;

  /**
   * Optional label rendered at the left of the pinned header. The
   * Bash tool wrapper (`BashToolBlock`) passes the command here for
   * standalone gallery use; embedded callers typically pass
   * `undefined` because their own chrome already carries identity.
   * Strings are wrapped in a `<span>` so the consumer doesn't have
   * to pre-wrap; arbitrary `ReactNode` is also accepted for
   * caller-controlled markup (e.g. a `<code>` element preserving
   * the literal command).
   */
  headerLabel?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lines above this count switch from flat to virtualized rendering. */
export const VISIBLE_THRESHOLD = 40;

/**
 * Maximum retained-line count before the earliest lines are dropped
 * and replaced with a "… N earlier lines truncated" indicator
 * ([Q04]).
 */
export const RETAINED_LINE_CAP = 10_000;

/**
 * Per-line height in pixels — matches `block-height-index.ts`'s
 * `CODE_LINE_HEIGHT`. The CSS uses `--tugx-term-line-height` for the
 * actual rule; this constant is the value the virtualizer uses for
 * its arithmetic (`.scrollHeight` in happy-dom is unreliable).
 */
export const LINE_HEIGHT_PX = 20;

/**
 * Viewport height (in lines) the virtualized scroll container caps
 * itself at. Beyond this the user scrolls. 24 lines × 20 px ≈ 480 px,
 * a comfortable inline height inside a Tide row.
 */
export const VIRTUAL_VIEWPORT_LINES = 24;

const DEFAULT_STREAMING_PATH = "terminal";

const DATA_SLOT_ROOT = "terminal-body";
const DATA_SLOT_HEADER = "terminal-header";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Whether `data` carries any visible content (excluding footer-only). */
function hasContent(data: TerminalData | undefined): boolean {
  if (data === undefined) return false;
  return (data.stdout?.length ?? 0) > 0 || (data.stderr?.length ?? 0) > 0;
}

/**
 * Coerce an unknown PropertyStore value into a `TerminalData` shape
 * with safe defaults. Anything off-shape becomes the empty terminal.
 */
function coerceTerminalData(value: unknown): TerminalData {
  if (value === null || value === undefined || typeof value !== "object") {
    return { stdout: "", stderr: "" };
  }
  const v = value as Record<string, unknown>;
  return {
    stdout: typeof v.stdout === "string" ? v.stdout : "",
    stderr: typeof v.stderr === "string" ? v.stderr : "",
    exitCode: typeof v.exitCode === "number" ? v.exitCode : undefined,
    durationMs: typeof v.durationMs === "number" ? v.durationMs : undefined,
    interrupted: typeof v.interrupted === "boolean" ? v.interrupted : undefined,
  };
}

/** One parsed terminal line — sanitized HTML + the source stream. */
interface ParsedLine {
  html: string;
  source: "stdout" | "stderr";
}

/**
 * Split each stream by newline, run each line through `ansiToHtml`,
 * and tag with its source so the renderer can class it. Trailing
 * empty line from a `\n`-terminated stream is dropped — terminals
 * normally don't paint that blank.
 */
export function parseTerminalLines(data: TerminalData): ParsedLine[] {
  const lines: ParsedLine[] = [];
  if (data.stdout.length > 0) {
    const parts = data.stdout.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    for (const part of parts) {
      lines.push({ html: ansiToHtml(part), source: "stdout" });
    }
  }
  if (data.stderr.length > 0) {
    const parts = data.stderr.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    for (const part of parts) {
      lines.push({ html: ansiToHtml(part), source: "stderr" });
    }
  }
  return lines;
}

/**
 * Format milliseconds as a compact human duration (e.g. "428 ms",
 * "1.2 s", "5m 03s"). Picks the largest unit whose value is ≥ 1.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// Imperative DOM rendering
// ---------------------------------------------------------------------------

/** Build a single line element. */
function buildLineElement(line: ParsedLine): HTMLElement {
  const el = document.createElement("div");
  el.className = `tugx-term-line tugx-term-line--${line.source}`;
  el.innerHTML = line.html;
  // Render an empty line as a single &nbsp;-equivalent box so it
  // takes up `LINE_HEIGHT_PX` and doesn't collapse — terminals show
  // blank lines as actual blank rows.
  if (line.html === "") el.innerHTML = "&nbsp;";
  return el;
}

/** Build the truncation banner shown above the scroll body. */
function buildTruncationIndicator(droppedCount: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "tugx-term-truncation";
  el.dataset.slot = "terminal-truncation";
  el.textContent = `… ${droppedCount.toLocaleString()} earlier line${
    droppedCount === 1 ? "" : "s"
  } truncated`;
  return el;
}

/** Build the footer (exit code badge + duration + interrupted). */
function buildFooter(data: TerminalData): HTMLElement | null {
  const hasFooter =
    data.exitCode !== undefined ||
    data.durationMs !== undefined ||
    data.interrupted === true;
  if (!hasFooter) return null;

  const footer = document.createElement("div");
  footer.className = "tugx-term-footer";
  footer.dataset.slot = "terminal-footer";

  if (data.exitCode !== undefined) {
    const exit = document.createElement("span");
    const isZero = data.exitCode === 0;
    exit.className = `tugx-term-exit tugx-term-exit--${isZero ? "zero" : "nonzero"}`;
    exit.dataset.slot = "terminal-exit";
    exit.textContent = `exit ${data.exitCode}`;
    footer.appendChild(exit);
  }

  if (data.interrupted === true) {
    const intr = document.createElement("span");
    intr.className = "tugx-term-interrupted";
    intr.dataset.slot = "terminal-interrupted";
    intr.textContent = "interrupted";
    footer.appendChild(intr);
  }

  if (data.durationMs !== undefined) {
    const dur = document.createElement("span");
    dur.className = "tugx-term-duration";
    dur.dataset.slot = "terminal-duration";
    dur.textContent = formatDuration(data.durationMs);
    footer.appendChild(dur);
  }

  return footer;
}

/**
 * Append a flat (non-virtualized) body. Used when the visible-line
 * count is at or below `VISIBLE_THRESHOLD`. The host owns scroll.
 */
function appendFlatBody(container: HTMLElement, lines: ParsedLine[]): void {
  const pre = document.createElement("pre");
  pre.className = "tugx-term-pre tugx-term-pre--flat";
  pre.dataset.slot = "terminal-pre";
  for (const line of lines) {
    pre.appendChild(buildLineElement(line));
  }
  container.appendChild(pre);
}

/**
 * Append a virtualized body — a self-scrolling viewport driven by a
 * `BlockHeightIndex` + `RenderedBlockWindow`. Each line is one
 * "block" with constant `LINE_HEIGHT_PX` height. The window is
 * driven by a scroll listener that re-runs `blockWindow.update` and
 * applies the resulting enter/exit ranges + spacer heights to the
 * DOM imperatively.
 *
 * Returns a cleanup callback the caller should run when the body is
 * about to be replaced (ensures the scroll listener is detached).
 */
function appendVirtualizedBody(
  container: HTMLElement,
  lines: ParsedLine[],
): () => void {
  const heightIndex = new BlockHeightIndex(Math.max(1024, lines.length));
  for (let i = 0; i < lines.length; i += 1) {
    heightIndex.appendBlock(LINE_HEIGHT_PX);
  }

  const viewportPx = Math.min(
    lines.length * LINE_HEIGHT_PX,
    VIRTUAL_VIEWPORT_LINES * LINE_HEIGHT_PX,
  );
  const window_ = new RenderedBlockWindow(heightIndex, viewportPx, 2);

  const scroller = document.createElement("div");
  scroller.className = "tugx-term-scroller";
  scroller.dataset.slot = "terminal-scroller";
  scroller.style.height = `${viewportPx}px`;

  const topSpacer = document.createElement("div");
  topSpacer.className = "tugx-term-spacer tugx-term-spacer--top";
  scroller.appendChild(topSpacer);

  const pre = document.createElement("pre");
  pre.className = "tugx-term-pre tugx-term-pre--virtualized";
  pre.dataset.slot = "terminal-pre";
  scroller.appendChild(pre);

  const bottomSpacer = document.createElement("div");
  bottomSpacer.className = "tugx-term-spacer tugx-term-spacer--bottom";
  scroller.appendChild(bottomSpacer);

  // The line elements currently in the DOM, keyed by line index.
  // Diff the new range against this map on every update().
  const mounted = new Map<number, HTMLElement>();

  function applyUpdate(scrollTop: number): void {
    const update = window_.update(scrollTop);

    for (const range of update.exit) {
      for (let i = range.startIndex; i < range.endIndex; i += 1) {
        const el = mounted.get(i);
        if (el !== undefined) {
          el.remove();
          mounted.delete(i);
        }
      }
    }

    for (const range of update.enter) {
      for (let i = range.startIndex; i < range.endIndex; i += 1) {
        const el = buildLineElement(lines[i]);
        el.dataset.lineIndex = String(i);
        mounted.set(i, el);
        // Insert in order so DOM order matches index order.
        const next = findNextMountedAfter(mounted, i);
        if (next === undefined) {
          pre.appendChild(el);
        } else {
          pre.insertBefore(el, next);
        }
      }
    }

    topSpacer.style.height = `${update.topSpacerHeight}px`;
    bottomSpacer.style.height = `${update.bottomSpacerHeight}px`;
  }

  // First paint — anchor at the bottom (terminals naturally show the
  // tail). RenderedBlockWindow.update(scrollTop) handles the math;
  // setting scrollTop afterwards triggers our listener once.
  const totalContentPx = heightIndex.getTotalHeight();
  const initialScrollTop = Math.max(0, totalContentPx - viewportPx);
  applyUpdate(initialScrollTop);
  // After the DOM is built, set the scroll position so it reflects
  // the rendered window. happy-dom won't actually scroll but the
  // assignment is a no-op there.
  scroller.scrollTop = initialScrollTop;

  let pendingRaf: number | null = null;
  const onScroll = () => {
    if (pendingRaf !== null) return;
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = null;
      applyUpdate(scroller.scrollTop);
    });
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });

  container.appendChild(scroller);

  return () => {
    if (pendingRaf !== null) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = null;
    }
    scroller.removeEventListener("scroll", onScroll);
  };
}

/**
 * Scan `mounted` for the smallest line index strictly greater than
 * `index` whose element is in the DOM. Used to keep DOM order in
 * sync with line index order during enter-range insertion.
 */
function findNextMountedAfter(
  mounted: Map<number, HTMLElement>,
  index: number,
): HTMLElement | undefined {
  let nextIndex = Number.POSITIVE_INFINITY;
  for (const i of mounted.keys()) {
    if (i > index && i < nextIndex) nextIndex = i;
  }
  return nextIndex === Number.POSITIVE_INFINITY
    ? undefined
    : mounted.get(nextIndex);
}

/**
 * Top-level imperative render. Rebuilds `body` from scratch each
 * call and stamps `data-empty` on the `outer` root. The header is
 * NOT touched here — React owns the header markup (label + Copy
 * `<TugIconButton>`); this function rebuilds only what lives below
 * the header (truncation banner, flat / virtualized line container,
 * post-mortem footer). Returns the cleanup callback (no-op for flat
 * path, scroll-listener detach for virtualized).
 */
function renderTerminal(
  outer: HTMLElement,
  body: HTMLElement,
  data: TerminalData,
): () => void {
  body.replaceChildren();
  // Empty terminal: render the footer if any post-mortem fields are
  // set, but leave the body empty. (A bash command that emitted no
  // output but exited with code 0 is meaningful — exit-code 0 badge
  // tells the user it succeeded.)
  const empty = !hasContent(data);
  outer.dataset.empty = empty ? "true" : "false";

  let lines: ParsedLine[] = [];
  let truncated = 0;
  if (!empty) {
    const allLines = parseTerminalLines(data);
    if (allLines.length > RETAINED_LINE_CAP) {
      truncated = allLines.length - RETAINED_LINE_CAP;
      lines = allLines.slice(-RETAINED_LINE_CAP);
    } else {
      lines = allLines;
    }
  }

  if (truncated > 0) {
    body.appendChild(buildTruncationIndicator(truncated));
  }

  let cleanup: (() => void) | null = null;
  if (lines.length > 0) {
    if (lines.length <= VISIBLE_THRESHOLD) {
      appendFlatBody(body, lines);
    } else {
      cleanup = appendVirtualizedBody(body, lines);
    }
  }

  const footer = buildFooter(data);
  if (footer !== null) body.appendChild(footer);

  return cleanup ?? (() => undefined);
}

/**
 * Compose the clipboard text. Prefer stdout, then stderr — neither
 * is annotated with a header because the typical use case is "give
 * me the command's output as I'd see it in a terminal."
 */
function composeCopyText(data: TerminalData): string {
  const parts: string[] = [];
  if (data.stdout.length > 0) parts.push(data.stdout);
  if (data.stderr.length > 0) parts.push(data.stderr);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

const EMPTY_TERMINAL: TerminalData = { stdout: "", stderr: "" };

/** Duration the Copy button shows its "just-copied" cue (ms). */
const COPIED_FLASH_MS = 1200;

export const TerminalBlock: React.FC<TerminalBlockProps> = ({
  data,
  streamingStore,
  streamingPath = DEFAULT_STREAMING_PATH,
  className,
  embedded = false,
  headerLabel,
}) => {
  // Outer card — React owns the markup (header + body container);
  // imperative `renderTerminal` writes lines/footer into `bodyRef`.
  const outerRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  // Ref to the (optional) identity header — used by the telescoping-pin
  // ResizeObserver below. Null when embedded OR when no `headerLabel`
  // is provided.
  const headerRef = React.useRef<HTMLDivElement | null>(null);
  // Latest data for the Copy callback to read. Updated inside both
  // effects so streaming sees the freshest stdout/stderr without
  // forcing a React re-render of the shell.
  const latestDataRef = React.useRef<TerminalData>(EMPTY_TERMINAL);
  // Ref into the underlying button so the "just-copied" feedback can
  // toggle a class via DOM [L06] rather than React state.
  const copyButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const copiedTimerRef = React.useRef<number | null>(null);

  // Telescoping pin — write the live measured identity-header height
  // into `--tugx-term-header-height` on the root so `.tugx-term-actions`
  // can pin BELOW the identity header in standalone mode. See
  // `file-block.tsx` for the full architectural rationale; same pattern
  // applies here. In embedded mode the header isn't rendered, the ref
  // stays null, and the variable falls back to 0 via the `calc()`
  // default.
  //
  // [L03] useLayoutEffect — variable set before paint.
  // [L06] DOM write, never React state.
  // [L20] TerminalBlock owns `--tugx-term-*` (this variable is in that
  //   family).
  const showHeader = !embedded && headerLabel !== undefined;
  React.useLayoutEffect(() => {
    const root = outerRef.current;
    const header = headerRef.current;
    if (root === null) return;
    if (header === null) {
      root.style.removeProperty("--tugx-term-header-height");
      return;
    }
    const write = (px: number): void => {
      root.style.setProperty("--tugx-term-header-height", `${px}px`);
    };
    write(header.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const boxes = entry.borderBoxSize;
      const next =
        boxes !== undefined && boxes.length > 0
          ? boxes[0].blockSize
          : entry.contentRect.height;
      write(next);
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
    };
  }, [showHeader]);

  // Static mode — runs once at mount, never again. Skipped when
  // streamingStore is set so the streaming effect below owns the
  // render.
  React.useLayoutEffect(() => {
    if (streamingStore !== undefined) return;
    const outer = outerRef.current;
    const body = bodyRef.current;
    if (outer === null || body === null) return;
    const d = data ?? EMPTY_TERMINAL;
    latestDataRef.current = d;
    const cleanup = renderTerminal(outer, body, d);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Streaming mode — Spec S05 binding. Reads sync on mount,
  // subscribes for updates, rAF-coalesces.
  React.useLayoutEffect(() => {
    if (streamingStore === undefined) return;
    const outer = outerRef.current;
    const body = bodyRef.current;
    if (outer === null || body === null) return;
    const store = streamingStore;

    let cleanup: () => void = () => undefined;

    function rerender(): void {
      cleanup();
      const outerEl = outerRef.current;
      const bodyEl = bodyRef.current;
      if (outerEl === null || bodyEl === null) {
        cleanup = () => undefined;
        return;
      }
      const next = coerceTerminalData(store.get(streamingPath));
      latestDataRef.current = next;
      cleanup = renderTerminal(outerEl, bodyEl, next);
    }

    rerender();

    let pendingRaf: number | null = null;
    const unsubscribe = store.observe(streamingPath, () => {
      if (pendingRaf !== null) return;
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = null;
        rerender();
      });
    });

    return () => {
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf);
        pendingRaf = null;
      }
      unsubscribe();
      cleanup();
    };
  }, [streamingStore, streamingPath]);

  // Clear any pending "just-copied" timer on unmount.
  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  const handleCopy = React.useCallback((): void => {
    const writeText = navigator.clipboard?.writeText.bind(navigator.clipboard);
    if (writeText === undefined) return;
    const text = composeCopyText(latestDataRef.current);
    writeText(text)
      .then(() => {
        const btn = copyButtonRef.current;
        if (btn === null) return;
        btn.classList.add("is-copied");
        if (copiedTimerRef.current !== null) {
          window.clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = window.setTimeout(() => {
          copiedTimerRef.current = null;
          // Re-read the ref — the component may have unmounted
          // between the timer's schedule and its fire.
          const live = copyButtonRef.current;
          if (live !== null) live.classList.remove("is-copied");
        }, COPIED_FLASH_MS);
      })
      .catch(() => {
        // Swallow — the user gets no positive confirmation, which is
        // the right behavior when the write actually fails.
      });
  }, []);

  return (
    <div
      ref={outerRef}
      data-slot={DATA_SLOT_ROOT}
      data-empty="true"
      data-embedded={embedded ? "true" : undefined}
      className={
        className === undefined ? "tugx-term" : `tugx-term ${className}`
      }
    >
      {showHeader ? (
        <div
          ref={headerRef}
          className="tugx-term-header"
          data-slot={DATA_SLOT_HEADER}
        >
          <span
            className="tugx-term-header-label"
            data-slot="terminal-header-label"
          >
            {headerLabel}
          </span>
        </div>
      ) : null}
      <div className="tugx-term-actions" data-slot="terminal-actions">
        <span className="tugx-term-actions-spacer" />
        <TugIconButton
          ref={copyButtonRef}
          icon={<Copy />}
          aria-label="Copy terminal output"
          onClick={handleCopy}
          className="tugx-term-copy-button"
        />
      </div>
      <div
        ref={bodyRef}
        className="tugx-term-content"
        data-slot="terminal-content"
      />
    </div>
  );
};
