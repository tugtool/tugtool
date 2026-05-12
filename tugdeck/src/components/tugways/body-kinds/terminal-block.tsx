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
 *  - Header (React-rendered `.tugx-term-header`): an optional label
 *    slot at left (`headerLabel` prop — typically the command for
 *    Bash tool standalone use), a flex spacer, and a `Copy`
 *    `<TugIconButton>` at right. The header is `position: sticky` so
 *    it stays visible while the user scrolls deep into the body. The
 *    Copy overlay (`.tugx-term-copy` absolute div) it replaced was
 *    retired: it sat on top of the scrollbar gutter for any output
 *    tall enough to trigger scrolling.
 *  - Body (imperatively rendered into `.tugx-term-content`): the
 *    truncation banner, the flat / virtualized line container, and
 *    the post-mortem footer. The line rendering, ANSI palette, and
 *    virtualization machinery are unchanged — the header is the
 *    only structural addition.
 *
 * Embedded mode portals the Copy `<TugIconButton>` into the host
 * `ToolWrapperChrome`'s actions slot (via `ChromeActionsTargetContext`)
 * so the affordance surfaces in the chrome header rather than as a
 * separate strip — Phase D consolidation. The body kind's own
 * `.tugx-term-header` is suppressed when embedded (the chrome owns
 * identity).
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
import { createPortal } from "react-dom";
import { Check, ChevronsDown, ChevronsUp, Copy } from "lucide-react";

import type { PropertyStore } from "@/components/tugways/property-store";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useChromeActionsTarget } from "@/components/tugways/cards/tool-wrappers/tool-wrapper-chrome";
import { useOptionalResponder } from "@/components/tugways/use-responder";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import { TUG_ACTIONS, type TugAction } from "@/components/tugways/action-vocabulary";
import type { ActionHandler } from "@/components/tugways/responder-chain";
import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";
import { usePositionStableClick } from "@/components/tugways/internal/use-position-stable-click";
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
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolWrapperChrome` in
   * `BashToolBlock`). When `true`:
   *
   *   - The standalone frame (background / border / radius / outer
   *     margin) is dropped so the lines integrate flush with the host.
   *   - The terminal's own `.tugx-term-header` is suppressed — the
   *     wrapper owns identity.
   *   - The Copy `<TugIconButton>` portals into the host's chrome
   *     actions slot via `ChromeActionsTargetContext`. This is the
   *     load-bearing contract: `embedded={true}` MUST be used under
   *     a `ToolWrapperChrome` so Copy has somewhere to surface.
   *
   * @default false
   */
  embedded?: boolean;

  /**
   * Optional label rendered at the left of the standalone header. The
   * Bash tool wrapper (`BashToolBlock`) passes the command here for
   * standalone gallery use; embedded callers don't need to set this
   * — the chrome owns identity in that mode. Strings are wrapped in
   * a `<span>` so the consumer doesn't have to pre-wrap; arbitrary
   * `ReactNode` is also accepted for caller-controlled markup (e.g.
   * a `<code>` element preserving the literal command).
   */
  headerLabel?: React.ReactNode;

  /**
   * Initial collapse state. When undefined, the component picks the
   * default from `collapseThreshold`: collapsed if the line count
   * exceeds the threshold, expanded otherwise. Mirrors FileBlock's
   * `collapsed` prop semantics.
   *
   * Streaming-mode TerminalBlocks (`streamingStore` set) compute the
   * threshold check against `0` at mount because the imperative
   * renderer owns the line growth — no fold cue surfaces in that
   * mode until a follow-up wires a streaming line-count subscription.
   * Static-mode TerminalBlocks (`data` set) compute against the
   * static line count and fold by default for long output.
   */
  collapsed?: boolean;

  /**
   * Notification callback fired when the user toggles the collapsed
   * state via the fold cue. Same controlled/uncontrolled semantics as
   * FileBlock: when `collapsed` is provided, the parent owns the
   * value and this callback is the change notification; when
   * `collapsed` is undefined, the body kind owns its own state and
   * this callback is purely informational.
   */
  onToggleCollapsed?: (next: boolean) => void;

  /**
   * Threshold for default-folded behavior. Defaults to
   * `FOLD_THRESHOLD_LINES` (40 — matches `VISIBLE_THRESHOLD`'s
   * virtualization cutoff because output that's long enough to need
   * a self-scrolling viewport is exactly the output that benefits
   * from a fold cue).
   *
   * @default FOLD_THRESHOLD_LINES
   */
  collapseThreshold?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lines above this count switch from flat to virtualized rendering. */
export const VISIBLE_THRESHOLD = 40;

/**
 * Default-collapse threshold in lines. 40 matches `VISIBLE_THRESHOLD`
 * so the same cutoff that flips rendering to the self-scrolling
 * virtualized path also flips the body kind into collapsed-by-default.
 * Below the threshold the output reads at a glance; above it a fold
 * cue earns its keep by getting long output out of the reader's way
 * until they ask for it.
 */
export const FOLD_THRESHOLD_LINES = 40;

/**
 * Number of lines the collapsed-preview pane shows above the fade
 * gradient. ~8 lines reads as "this is a sample, not the whole
 * output" — long enough to recognize the command's character, short
 * enough that the cue's "N LINES" label is the user's primary signal
 * that more exists below.
 */
export const COLLAPSED_PREVIEW_LINES = 8;

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
 * Count visible lines in a `TerminalData` without parsing ANSI. Used
 * by the fold cue's threshold check — `parseTerminalLines` runs
 * `ansiToHtml` per line which is wasted work just to get a count.
 * Mirrors `parseTerminalLines`'s trailing-newline rule so the count
 * agrees with what the renderer eventually produces.
 */
export function quickLineCount(data: TerminalData | undefined): number {
  if (data === undefined) return 0;
  let total = 0;
  if (data.stdout.length > 0) {
    const parts = data.stdout.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    total += parts.length;
  }
  if (data.stderr.length > 0) {
    const parts = data.stderr.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    total += parts.length;
  }
  return total;
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
 *
 * **Collapsed preview path** (Phase E.4). When `collapsed` is true,
 * the renderer skips the virtualizer entirely and renders just the
 * first `COLLAPSED_PREVIEW_LINES` lines via the flat path — same
 * lines the user would see at the top of the expanded output.
 * Truncation banner is suppressed (the fold cue carries the "more
 * exists below" signal). Footer is suppressed (post-mortem badges
 * sit at the END of the output; revealing them during a TOP-of-file
 * preview would mislead the reader into thinking the command had
 * completed within the preview). Expanding the block restores the
 * full render (truncation banner, virtualizer, footer) on the next
 * call.
 */
function renderTerminal(
  outer: HTMLElement,
  body: HTMLElement,
  data: TerminalData,
  collapsed: boolean = false,
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

  // Collapsed preview path — slice to the first ~8 lines, skip the
  // truncation banner + virtualizer + footer. The fold cue (in the
  // React-owned header) and the CSS mask-image fade together signal
  // "more below; click to expand."
  if (collapsed && lines.length > 0) {
    const preview = lines.slice(0, COLLAPSED_PREVIEW_LINES);
    appendFlatBody(body, preview);
    return () => undefined;
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

/** Duration the Copy button shows its "Copied" confirmation flash (ms). */
const COPIED_FLASH_MS = 1200;

export const TerminalBlock: React.FC<TerminalBlockProps> = ({
  data,
  streamingStore,
  streamingPath = DEFAULT_STREAMING_PATH,
  className,
  embedded = false,
  headerLabel,
  collapsed: collapsedProp,
  onToggleCollapsed,
  collapseThreshold = FOLD_THRESHOLD_LINES,
}) => {
  // Outer card — React owns the markup (header + body container);
  // imperative `renderTerminal` writes lines/footer into `bodyRef`.
  const outerRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  // Latest data for the Copy callback to read. Updated inside both
  // effects so streaming sees the freshest stdout/stderr without
  // forcing a React re-render of the shell.
  const latestDataRef = React.useRef<TerminalData>(EMPTY_TERMINAL);
  // The data prop captured at FIRST mount. Static mode renders this
  // value once and never again, even across collapse-driven
  // re-renders. Without this ref the collapse-aware re-render would
  // pick up subsequent prop changes — that's a contract violation of
  // the mount-once shape and would also force re-parses the
  // streaming path is supposed to own.
  const initialDataRef = React.useRef<TerminalData | undefined>(data);
  // Ref into the underlying button — kept for potential focus
  // management and as a stable test handle. The "Copied" feedback
  // is driven by `TugPushButton`'s `isConfirming` prop (controlled
  // mode) so we explicitly enter the confirmed state ONLY on a
  // successful clipboard write — failed writes leave the button at
  // rest. No imperative class swap from React.
  const copyButtonRef = React.useRef<HTMLButtonElement | null>(null);
  // Controlled-confirmation state — `true` while the "Copied" flash
  // is active. Set inside the clipboard `.then()` callback (so a
  // failed write never lies); cleared by a `setTimeout` after
  // `COPIED_FLASH_MS`. Lives in React state because the flash
  // duration is a host-owned schedule, not an appearance-zone class
  // swap; the actual DOM mutation happens inside `TugButton`'s
  // controlled-mode layout effect ([L06] satisfied at the primitive
  // boundary).
  const [copied, setCopied] = React.useState<boolean>(false);
  const copiedTimerRef = React.useRef<number | null>(null);

  // ---- Fold state ([L06] data, not appearance: it controls *what*
  //                  is rendered, not *how* a rendered element
  //                  looks) ---------------------------------------------
  //
  // Mirrors FileBlock's computed-collapse pattern:
  //  - `overThreshold` is derived from the static line count (cheap
  //    quickLineCount; no ANSI parse).
  //  - Local state seeds from `overThreshold`.
  //  - When the parent provides `collapsed`, the prop wins; otherwise
  //    local state covers the uncontrolled case. No `useEffect` syncs
  //    a prop into state — reading the prop directly on every render
  //    keeps controlled and uncontrolled cleanly separable.
  //
  // Streaming mode (`streamingStore` set) reads `lineCount = 0` from
  // `data` because the imperative renderer owns the growing line
  // pool, not React state. The fold cue therefore stays hidden in
  // streaming mode until a follow-up phase wires a streaming line-
  // count subscription. This is a deliberate scope cut for E.4.
  const lineCount = React.useMemo(
    () => quickLineCount(initialDataRef.current),
    [],
  );
  const overThreshold = lineCount > collapseThreshold;
  const [localCollapsed, setLocalCollapsed] =
    React.useState<boolean>(overThreshold);
  const collapsed =
    collapsedProp !== undefined ? collapsedProp : localCollapsed;

  // Chrome actions target — non-null when this TerminalBlock is
  // composed inside a `ToolWrapperChrome` that has rendered its actions
  // slot. Phase D portals the Copy `<TugIconButton>` into the chrome
  // header rather than hosting it in a separate body-kind strip.
  // Standalone composition keeps the header strip and renders Copy at
  // its trailing edge.
  const chromeActionsTarget = useChromeActionsTarget();

  // Dev-mode misconfiguration check — `embedded={true}` requires a
  // parent `ToolWrapperChrome` so Copy has a portal target. The
  // setTimeout defers past the chrome's first-render
  // ref-callback → state-update → re-render cycle so the warn
  // doesn't fire spuriously when the chrome IS present. See
  // `file-block.tsx`'s version for the full rationale.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!embedded) return;
    if (chromeActionsTarget !== null) return;
    const handle = window.setTimeout(() => {
      console.warn(
        "TerminalBlock: `embedded={true}` requires a parent `ToolWrapperChrome`. " +
          "Without one, the body kind's identity header is suppressed AND its " +
          "Copy button has nowhere to portal — the user loses access to it " +
          "silently. Either compose under a chrome or set `embedded={false}`.",
      );
    }, 0);
    return () => {
      window.clearTimeout(handle);
    };
  }, [embedded, chromeActionsTarget]);

  // Standalone always renders an identity header — even without a
  // `headerLabel`, the header strip hosts Copy at the trailing edge.
  // An empty strip is a fair price for the Copy affordance staying
  // reachable across the scroll range; the alternative (a body-kind
  // overlay) was retired with the `.tugx-term-copy` slot family
  // because the overlay sat on top of the scrollbar gutter.
  // Embedded mode suppresses the header — the chrome owns identity
  // and Copy portals into the chrome's actions slot instead.
  const showHeader = !embedded;

  // Static mode — re-runs whenever `collapsed` flips, so the imperative
  // body switches between the full render and the preview render
  // without a React re-mount. `data` is read from `initialDataRef`
  // (captured once at first mount) so the mount-once contract for the
  // `data` prop is preserved: subsequent `data` prop changes are
  // ignored even during a collapse-triggered re-render. Streaming
  // mode owns the body render through the effect below.
  React.useLayoutEffect(() => {
    if (streamingStore !== undefined) return;
    const outer = outerRef.current;
    const body = bodyRef.current;
    if (outer === null || body === null) return;
    const d = initialDataRef.current ?? EMPTY_TERMINAL;
    latestDataRef.current = d;
    const cleanup = renderTerminal(outer, body, d, collapsed);
    return cleanup;
  }, [collapsed, streamingStore]);

  // Streaming mode — Spec S05 binding. Reads sync on mount,
  // subscribes for updates, rAF-coalesces.
  //
  // `collapsed` is read through a latest-ref ([L07]) inside `rerender`
  // so a fold-toggle in streaming mode flips the preview without
  // re-subscribing to the store. Default for streaming today is
  // `collapsed = false` (the threshold check sees `lineCount = 0`
  // because quickLineCount runs against the static-data prop); the
  // ref is in place so a future phase that hooks a streaming line
  // count into local state can flip the preview cleanly.
  const collapsedStreamingRef = React.useRef(collapsed);
  React.useLayoutEffect(() => {
    collapsedStreamingRef.current = collapsed;
  }, [collapsed]);

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
      cleanup = renderTerminal(
        outerEl,
        bodyEl,
        next,
        collapsedStreamingRef.current,
      );
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

  // Streaming-mode re-render on collapse toggle. The store-subscription
  // effect above is the source of truth for streaming output, but a
  // bare collapse toggle doesn't fire the store callback — we have to
  // re-render explicitly. This effect runs ONLY when both `collapsed`
  // changes AND `streamingStore` is set; the static-mode effect above
  // owns the non-streaming case. Skips the first run because the
  // store-subscription effect's `rerender()` already covered it.
  const streamingCollapsedRenderedOnceRef = React.useRef(false);
  React.useLayoutEffect(() => {
    if (streamingStore === undefined) return;
    if (!streamingCollapsedRenderedOnceRef.current) {
      streamingCollapsedRenderedOnceRef.current = true;
      return;
    }
    const outer = outerRef.current;
    const body = bodyRef.current;
    if (outer === null || body === null) return;
    const next = coerceTerminalData(streamingStore.get(streamingPath));
    latestDataRef.current = next;
    const cleanup = renderTerminal(outer, body, next, collapsed);
    return cleanup;
  }, [collapsed, streamingStore, streamingPath]);

  const handleCopy = React.useCallback((): void => {
    const writeText = navigator.clipboard?.writeText.bind(navigator.clipboard);
    if (writeText === undefined) return;
    const text = composeCopyText(latestDataRef.current);
    // Honest "Copied" feedback — set the controlled-confirmation flag
    // only after the clipboard write resolves. A failed write (denied
    // permission, no clipboard API) leaves `copied` at `false`, so
    // the button never flashes a confirmation that didn't happen.
    writeText(text)
      .then(() => {
        setCopied(true);
        if (copiedTimerRef.current !== null) {
          window.clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = window.setTimeout(() => {
          copiedTimerRef.current = null;
          setCopied(false);
        }, COPIED_FLASH_MS);
      })
      .catch(() => {
        // Silent failure — the user can re-click. No flash.
      });
  }, []);

  // Clean up the pending timer on unmount so we don't try to update
  // state on a detached component.
  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  // ---- Responder registration ([L11]) ---------------------------------
  //
  // TerminalBlock graduates to "responder + responder parent" in Phase
  // E.4. It owns the `text` data the COPY action operates on, and it
  // hosts a scope that descendants (a future find-input, the existing
  // Copy button as a chain control) can attach into. The structure
  // matches FileBlock's `fileBlockResponder` shape: a stable `useId`,
  // a `Partial<Record<TugAction, ActionHandler>>` registered via
  // `useOptionalResponder`, a `ResponderScope` wrapping the root.
  //
  // Today only COPY is registered; the structured-to-grow shape lets
  // a future find-on-terminal feature add `FIND` / `FIND_NEXT` /
  // `FIND_PREVIOUS` without changing the registration site. The
  // actions map is read through a ref so the registered handler stays
  // stable across renders while reading the current implementation
  // ([L07]).
  const terminalBlockResponderId = React.useId();
  const handleCopyRef = React.useRef(handleCopy);
  React.useLayoutEffect(() => {
    handleCopyRef.current = handleCopy;
  }, [handleCopy]);
  const terminalBlockActions = React.useMemo<
    Partial<Record<TugAction, ActionHandler>>
  >(
    () => ({
      [TUG_ACTIONS.COPY]: () => {
        handleCopyRef.current?.();
      },
    }),
    [],
  );
  const terminalBlockResponder = useOptionalResponder({
    id: terminalBlockResponderId,
    actions: terminalBlockActions,
  });

  // Chain manager — promotes TerminalBlock to first-responder after a
  // focus-refusing affordance click (the fold cue / Copy carry
  // `data-tug-focus="refuse"`, so the chain provider's pointerdown
  // listener skips chain promotion on their clicks). Same pattern as
  // FileBlock; null outside a `ResponderChainProvider` (gallery /
  // unit tests).
  const chainManager = useResponderChain();

  // ---- Position-stable click infrastructure ---------------------------
  //
  // The fold cue benefits from the same combination FileBlock /
  // DiffBlock use: a scrollport-level tail spacer raises
  // `maxScrollTop` so a collapse doesn't hit a hard clamp, and the
  // hook then writes the exact `scrollTop` that puts the click target
  // back at its pre-click viewport Y. See `usePositionStableClick`
  // for the full rationale. Copy doesn't change height so its
  // wrapper is a near-no-op — kept for action-row contract symmetry.
  const outerScrollport = useOuterScrollport();
  const outerScrollportRef = React.useRef<HTMLElement | null>(null);
  outerScrollportRef.current = outerScrollport;
  const foldCueButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const { stableClick: stableFoldClick } = usePositionStableClick({
    targetRef: foldCueButtonRef,
    scrollportRef: outerScrollportRef,
  });
  const { stableClick: stableCopyClick } = usePositionStableClick({
    targetRef: copyButtonRef,
    scrollportRef: outerScrollportRef,
  });

  const toggleCollapsed = React.useCallback(() => {
    // Mirrors FileBlock's pattern: dispatch the disengage-follow-bottom
    // event BEFORE the state update so any host (TugListView with
    // SmartScroll, when present) flips `isFollowingBottom` to false
    // before the cell-height change. The subsequent ResizeObserver
    // flush then bails out of `pinToBottom`. Bubbles through the DOM
    // tree; non-list hosts ignore it.
    outerRef.current?.dispatchEvent(
      new CustomEvent("tug-disengage-follow-bottom", { bubbles: true }),
    );
    chainManager?.makeFirstResponder(terminalBlockResponderId);
    const next = !collapsed;
    if (collapsedProp === undefined) {
      setLocalCollapsed(next);
    }
    onToggleCollapsed?.(next);
  }, [
    chainManager,
    collapsed,
    collapsedProp,
    onToggleCollapsed,
    terminalBlockResponderId,
  ]);

  // Compose the affordances cluster ONCE. Phase E.4 ordering: Copy
  // (the feature affordance) → fold cue (the fixed-position landmark
  // at the trailing edge). Mirrors FileBlock / DiffBlock so the
  // user's eye finds the fold cue in the same place across every
  // body kind.
  //
  // **Copy** — controlled-confirmation pattern (Phase E.1): rest
  // shows `Copy` icon + "Copy" label; the brief confirmed flash
  // swaps in `Check` icon + "Copied" label. `isConfirming={copied}`
  // is set ONLY inside the clipboard `.then()` callback after a
  // successful write. Failure leaves the button at rest. The click
  // routes through `stableCopyClick` — Copy doesn't change height
  // today, but the wrapper keeps the action-row contract that
  // EVERY click routes through `usePositionStableClick` (so a future
  // change that adds a height-affecting side effect won't bypass
  // the contract).
  //
  // **Fold cue** (Phase E.4) — `TugPushButton` with the same shape
  // as FileBlock / DiffBlock. Only rendered when `overThreshold`
  // (otherwise short output has no fold cue: the user can already
  // see the whole thing). Chevron flips with state; label is `"N
  // lines"` regardless of fold state; aria-label carries the verb
  // for screen readers. Click routes through `stableFoldClick` so
  // the cluster stays under the user's cursor across the layout
  // change.
  const cueCountWord = lineCount === 1 ? "line" : "lines";
  const cueLabel = `${lineCount.toLocaleString()} ${cueCountWord}`;
  const affordances = (
    <>
      <TugPushButton
        ref={copyButtonRef}
        className="tugx-term-copy-button"
        icon={<Copy />}
        subtype="icon-text"
        emphasis="ghost"
        size="2xs"
        aria-label="Copy terminal output"
        onClick={() => stableCopyClick(handleCopy)}
        confirmation={{
          icon: <Check />,
          label: "Copied",
        }}
        isConfirming={copied}
      >
        Copy
      </TugPushButton>
      {overThreshold ? (
        <TugPushButton
          ref={foldCueButtonRef}
          className="tugx-term-fold-cue"
          data-slot="terminal-fold-cue"
          icon={collapsed ? <ChevronsDown /> : <ChevronsUp />}
          subtype="icon-text"
          emphasis="ghost"
          size="2xs"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand terminal output" : "Collapse terminal output"}
          onClick={() => stableFoldClick(toggleCollapsed)}
        >
          {cueLabel}
        </TugPushButton>
      ) : null}
    </>
  );

  const portaledAffordances =
    embedded && chromeActionsTarget !== null
      ? createPortal(
          <span
            className="tugx-term-actions-cluster"
            data-slot="terminal-actions"
          >
            {affordances}
          </span>,
          chromeActionsTarget,
        )
      : null;

  // Composed root ref — forwards to both the local `outerRef` (used
  // to dispatch the disengage-follow-bottom event and read the
  // current element in the imperative renderer) AND the responder
  // chain's ref-callback (writes `data-responder-id` on the same
  // element). Same pattern as FileBlock's `composedRootRef`.
  const composedRootRef = (el: HTMLDivElement | null): void => {
    outerRef.current = el;
    terminalBlockResponder.responderRef(el);
  };

  return (
    <terminalBlockResponder.ResponderScope>
      <div
        ref={composedRootRef}
        data-slot={DATA_SLOT_ROOT}
        data-empty="true"
        data-embedded={embedded ? "true" : undefined}
        data-collapsed={overThreshold ? (collapsed ? "true" : "false") : undefined}
        className={
          className === undefined ? "tugx-term" : `tugx-term ${className}`
        }
      >
        {showHeader ? (
          <div
            className="tugx-term-header"
            data-slot={DATA_SLOT_HEADER}
          >
            {headerLabel !== undefined ? (
              <span
                className="tugx-term-header-label"
                data-slot="terminal-header-label"
              >
                {headerLabel}
              </span>
            ) : null}
            <span className="tugx-term-header-spacer" />
            <span
              className="tugx-term-actions-cluster"
              data-slot="terminal-actions"
            >
              {affordances}
            </span>
          </div>
        ) : null}
        {portaledAffordances}
        <div
          ref={bodyRef}
          className="tugx-term-content"
          data-slot="terminal-content"
        />
      </div>
    </terminalBlockResponder.ResponderScope>
  );
};
