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
 * `ToolBlockChrome`'s actions slot (via `ChromeActionsTargetContext`)
 * so the affordance surfaces in the chrome header rather than as a
 * separate strip. The body kind's own `.tugx-term-header` is
 * suppressed when embedded (the chrome owns identity).
 *
 * Render strategy:
 *
 *   - **Flat path** for ≤ `VISIBLE_THRESHOLD` lines (default 300):
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

import type { PropertyStore } from "@/components/tugways/property-store";
import { useChromeActionsTarget } from "@/components/tugways/cards/tool-blocks/tool-block-chrome";
import { useOptionalResponder } from "@/components/tugways/use-responder";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import { TUG_ACTIONS, type TugAction } from "@/components/tugways/action-vocabulary";
import type { ActionHandler } from "@/components/tugways/responder-chain";
import { ansiToHtml } from "@/lib/ansi/ansi-to-html";
import { BlockHeightIndex } from "@/lib/block-height-index";
import { RenderedBlockWindow } from "@/lib/rendered-block-window";
import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";
import { attachOuterScrollOnModifierWheel } from "@/components/tugways/internal/use-outer-scroll-on-modifier-wheel";
import { useSavedRegionScroll } from "@/components/tugways/use-component-state-preservation";
import {
  BlockActionsCluster,
  BlockCopyButton,
  BlockFoldCue,
  useBlockFoldState,
} from "./affordances";

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
   * container and a header (e.g. `ToolBlockChrome` in
   * `BashToolBlock`). When `true`:
   *
   *   - The standalone frame (background / border / radius / outer
   *     margin) is dropped so the lines integrate flush with the host.
   *   - The terminal's own `.tugx-term-header` is suppressed — the
   *     wrapper owns identity.
   *   - The Copy `<TugIconButton>` portals into the host's chrome
   *     actions slot via `ChromeActionsTargetContext`. This is the
   *     load-bearing contract: `embedded={true}` MUST be used under
   *     a `ToolBlockChrome` so Copy has somewhere to surface.
   *
   * @default false
   */
  embedded?: boolean;

  /**
   * Optional label rendered at the left of the standalone header. The
   * Bash tool block (`BashToolBlock`) passes the command here for
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
   * Line cap for the expand / collapse axis. Output longer than this
   * many lines folds by default and the collapsed preview shows the
   * first `collapseThreshold` lines; output at or below it renders
   * expanded with no fold cue. Defaults to
   * {@link DEFAULT_COLLAPSE_THRESHOLD}.
   *
   * @default DEFAULT_COLLAPSE_THRESHOLD
   */
  collapseThreshold?: number;

  /**
   * Opt-in key for the [A9] Component State Preservation Protocol.
   * When set, TerminalBlock persists its uncontrolled `collapsed`
   * flag into `bag.components` so a Developer > Reload restores the
   * fold.
   *
   * The virtualized scroller's `scrollTop` is persisted independently
   * via the [A9] region-scroll axis — TerminalBlock writes
   * `data-tug-scroll-key={componentStatePreservationKey}/term-scroll`
   * onto the scroller `<div>` so CardHost's region-scroll
   * capture/restore loop picks it up. The two axes are split
   * deliberately: fold is React-state (component-owned, not DOM-
   * authority); inner scroll is DOM-authority (scrollTop lives on
   * the scroll element).
   *
   * Undefined opts out of both axes (gallery, standalone).
   */
  componentStatePreservationKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Lines above this count switch from flat to virtualized rendering.
 * Sized so a typical command's output (a `tokei` summary, a directory
 * listing, a build log) renders fully inline without an inner scroller
 * — the user shouldn't have to scroll inside the row to read a few
 * dozen lines. Beyond this the virtualized viewport takes over so a
 * 5,000-line log doesn't crash the page.
 */
export const VISIBLE_THRESHOLD = 300;

/**
 * Default line cap for the expand / collapse axis — the one tunable
 * number behind the fold. Terminal output longer than this many lines
 * folds by default; the collapsed preview then shows exactly this many
 * lines and the fold cue carries a "N more lines" count for the
 * remainder. Output at or below the cap renders expanded with no fold
 * cue (there is nothing to collapse).
 *
 * 25 is the tuning point between two failure modes. Too low and the
 * reader expands constantly just to see ordinary command output. Too
 * high and a single `find` / `git log` / build run dominates the whole
 * transcript — the symptom this cap exists to fix: a 300-line
 * directory listing that rendered as 300 unbroken lines. 25 lines is
 * about a screenful of context: enough to recognize what a command
 * produced and decide whether to expand, while keeping any one result
 * modest next to the conversation around it.
 *
 * This is the consumer-overridable default for the `collapseThreshold`
 * prop. A wrapper that wants a different cap passes its own; tune the
 * value here to move the default for every terminal-rendered result
 * (Bash output, RenderInput-routed terminals) at once. Distinct from
 * `VISIBLE_THRESHOLD`, which governs virtualization of the *expanded*
 * body and stays high — the two are independent concerns.
 */
export const DEFAULT_COLLAPSE_THRESHOLD = 25;

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
 * its arithmetic.
 */
export const LINE_HEIGHT_PX = 20;

/**
 * Vertical padding the FLAT (`.tugx-term-pre`) rendering applies above
 * and below its lines, via `padding: var(--tugx-term-padding)` which
 * resolves to `var(--tug-space-sm) var(--tug-space-md)`. The virtualized
 * pre strips its vertical padding (line-height math expects exact
 * `LINE_HEIGHT_PX`-tall lines starting at the pre's edge), so we bake
 * the same vertical breathing room into the virtualizer's top/bottom
 * spacers as a constant offset.
 *
 * Without this match, the first line in the collapsed-preview (flat)
 * path sits at body-Y=6px, then jumps to body-Y=0 on expand — visibly
 * shifting under the user's eye when they toggle the fold cue. This
 * constant pins the offset so expand/fold preserves vertical position.
 *
 * Hardcoded to match `--tug-space-sm` (6px across the brio + harmony
 * themes). If the token changes, the visual padding parity needs to be
 * re-derived here — the constant is duplicated because imperative math
 * needs a number, not a CSS variable.
 */
export const VIRTUALIZED_PADDING_PX = 6;

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
 * Result of mounting a virtualized body. `cleanup` detaches the
 * scroll listener (and any other side effects) when the renderer
 * is about to rebuild the scroller. `refit` re-runs `applyUpdate`
 * against the scroller's current `scrollTop` — called whenever the
 * outer scrollport reports the terminal entering view, to recover
 * the intermittent blank-frame-after-scroll-into-view symptom.
 */
interface VirtualizedBodyHandle {
  cleanup: () => void;
  refit: () => void;
}

/**
 * Append a virtualized body — a self-scrolling viewport driven by a
 * `BlockHeightIndex` + `RenderedBlockWindow`. Each line is one
 * "block" with constant `LINE_HEIGHT_PX` height. The window is
 * driven by a scroll listener that re-runs `blockWindow.update` and
 * applies the resulting enter/exit ranges + spacer heights to the
 * DOM imperatively.
 *
 * `anchor` selects the initial scrollTop:
 *  - `"top"` — scroller opens at the start of content. Right for
 *    *static* output: the user just expanded a folded preview that
 *    showed the first ~8 lines, and they want to continue reading
 *    from where the preview cut off.
 *  - `"bottom"` — scroller opens at the tail of content. Right for
 *    *streaming* output: the user wants to see the latest lines as
 *    they arrive (the historical default for live terminals).
 *
 * `getOuter` is called on each Cmd/Ctrl-wheel hit to resolve the
 * outer scrollport that should receive the routed delta. When the
 * function returns `null` the wheel handler degrades to a no-op —
 * standalone composition or gallery, where there is no outer
 * scrollport to forward to.
 *
 * Returns a {@link VirtualizedBodyHandle} carrying both `cleanup`
 * (detach the scroll listener / wheel router on body replacement)
 * and `refit` (re-run `applyUpdate` to recover from a missed first
 * paint when the outer scrollport scrolls this terminal into view).
 */
function appendVirtualizedBody(
  container: HTMLElement,
  lines: ParsedLine[],
  anchor: "top" | "bottom",
  getOuter: () => HTMLElement | null,
  scrollKey: string | undefined,
  initialScrollTop: number | undefined,
): VirtualizedBodyHandle {
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
  // [A9] region-scroll axis — when a key is supplied, stamp the
  // scroller for CardHost's `captureRegionScrolls` walk. Raw {x, y}
  // is sufficient: terminal lines are fixed-height (LINE_HEIGHT_PX),
  // so scrollTop maps deterministically to line index across reload.
  if (scrollKey !== undefined) {
    scroller.setAttribute("data-tug-scroll-key", scrollKey);
  }
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

    // Add VIRTUALIZED_PADDING_PX to both spacers so the first/last
    // mounted line sits at the same body-Y as the flat-path
    // rendering would (which uses CSS `padding: var(--tugx-term-
    // padding)` on the pre). This is the constant-offset trick: the
    // window-update math operates in the unpadded coordinate system
    // (heightIndex), so scrollTop and content-Y differ by exactly
    // `VIRTUALIZED_PADDING_PX` whenever firstMounted=0. The
    // 2-viewport overscan absorbs this discrepancy for the mount
    // range; the visual outcome is that the first/last line sit
    // 6px below/above the scroller's edges — matching the flat pre.
    topSpacer.style.height = `${update.topSpacerHeight + VIRTUALIZED_PADDING_PX}px`;
    bottomSpacer.style.height = `${update.bottomSpacerHeight + VIRTUALIZED_PADDING_PX}px`;
  }

  // Attach the scroller to the document tree BEFORE the initial
  // scrollTop assignment below. Per spec, setting `scrollTop` on a
  // detached element is a no-op — a detached element has no
  // scrolling box. If we keep the older "applyUpdate → set scrollTop
  // → appendChild" order, the scrollTop write silently fails, the
  // scroller's scrollTop defaults to 0 when it attaches, and the
  // user sees the top-spacer's empty space instead of the tail of
  // the rendered content. The scroller stays empty until a wheel
  // event fires `onScroll`, which then calls `applyUpdate(0)` and
  // re-mounts lines from the top — the "jostled by scrolling fixes
  // it" symptom.
  //
  // Before the collapse-driven re-render path landed, this was a
  // latent bug masked by the mount-once contract: the static-mode
  // effect ran exactly once at first paint and the user typically
  // scrolled to consume the output, so the empty initial frame went
  // unnoticed. The collapse-driven re-render exposed it: fold→expand
  // recreates the scroller every toggle, and now every expansion
  // shows empty until scrolled.
  //
  // Attaching first means the scroller is empty (top/bottom spacers
  // at zero height, no line elements in `pre`) for one
  // useLayoutEffect tick — but useLayoutEffect runs before paint,
  // so the user never sees that intermediate state. `applyUpdate`
  // below populates the spacers + mounts lines synchronously; the
  // browser composites the final state on its next paint.
  container.appendChild(scroller);

  // First paint — anchor at top or bottom per the caller's choice
  // (static caller anchors at the top so an expanded preview reads
  // top-down; streaming caller anchors at the tail so live output
  // shows the latest lines). RenderedBlockWindow.update(scrollTop)
  // handles the math; the scrollTop assignment after it sticks
  // because the scroller is now part of a layout tree.
  //
  // When the caller supplies `initialScrollTop` (the cold-boot
  // mount-in-saved-state path threads `useSavedRegionScroll(scrollKey)?.y`
  // through here), the saved position wins — the scroller is CREATED
  // at the user's last-saved position, no jump-from-0. The anchor-
  // based default below covers the case the caller hasn't supplied a
  // saved value (subsequent fold-toggle rebuilds, gallery uses without
  // a card-scoped bag).
  //
  // Bottom-anchor math includes `2 * VIRTUALIZED_PADDING_PX` because
  // the spacers each carry that constant offset (see `applyUpdate`),
  // so the true scrollable height is `totalContentPx + 12`. Without
  // the +12, the streaming caller would land 12px short of the
  // actual bottom on first paint — the user would see the last line
  // 12px above the scroller's bottom edge instead of pinned to it.
  const totalContentPx = heightIndex.getTotalHeight();
  const totalScrollableHeight = totalContentPx + 2 * VIRTUALIZED_PADDING_PX;
  const maxScrollTop = Math.max(0, totalScrollableHeight - viewportPx);
  const anchorScrollTop = anchor === "top" ? 0 : maxScrollTop;
  const resolvedScrollTop =
    initialScrollTop !== undefined
      ? Math.max(0, Math.min(initialScrollTop, maxScrollTop))
      : anchorScrollTop;
  applyUpdate(resolvedScrollTop);
  scroller.scrollTop = resolvedScrollTop;

  // Scroll-state writer (validation field only). The
  // TerminalBlock virtualizer is deterministic per `LINE_HEIGHT_PX`,
  // so raw saved `{x, y}` already restores the same content
  // position on cold boot — `meta.scrollHeight` is captured for
  // symmetry with the variable-height virtualizer's geometry
  // capture pattern and for cross-version layout-stability checks.
  // Reader paths do not consume it today; if it disagreed with the
  // live scrollHeight it would just be ignored.
  //
  // [L06] DOM-attribute write. Updated on every scroll event,
  // alongside `applyUpdate`, so the framework's capture-time read
  // sees the current value.
  const writeScrollState = (): void => {
    scroller.setAttribute(
      "data-tug-scroll-state",
      JSON.stringify({ scrollHeight: scroller.scrollHeight }),
    );
  };
  writeScrollState();

  let pendingRaf: number | null = null;
  const onScroll = () => {
    if (pendingRaf !== null) return;
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = null;
      applyUpdate(scroller.scrollTop);
      writeScrollState();
    });
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });

  // Cmd/Ctrl-wheel routes to the outer card scrollport regardless of
  // whether the cursor is over the terminal's own scroller. Without
  // this, a long bash output would capture wheel events as soon as
  // the cursor entered it, stuttering the outer-card skim. See
  // `use-outer-scroll-on-modifier-wheel.ts` for the contract.
  const detachWheelRouter = attachOuterScrollOnModifierWheel(scroller, getOuter);

  return {
    cleanup: () => {
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf);
        pendingRaf = null;
      }
      scroller.removeEventListener("scroll", onScroll);
      detachWheelRouter();
    },
    // Re-run applyUpdate against the current scrollTop. Idempotent
    // when no enter/exit ranges change. Used by the outer-scroll-
    // into-view recovery to repaint a terminal whose first paint
    // missed under a WebKit layer-invalidation hiccup or a similar
    // intermittent.
    refit: () => {
      applyUpdate(scroller.scrollTop);
    },
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
 * Result of a top-level `renderTerminal` call. `cleanup` reverts any
 * side effects the current body installed (scroll listener, wheel
 * router) so a subsequent render can replace the body safely.
 * `refit` re-runs the virtualizer's `applyUpdate` against the
 * scroller's current `scrollTop` when present — flat-path renders
 * have nothing to refit and surface a no-op here, so the React
 * shell can call `refit` unconditionally.
 */
interface TerminalRenderHandle {
  cleanup: () => void;
  refit: () => void;
}

const NO_OP_TERMINAL_HANDLE: TerminalRenderHandle = {
  cleanup: () => undefined,
  refit: () => undefined,
};

/**
 * Top-level imperative render. Rebuilds `body` from scratch each
 * call and stamps `data-empty` on the `outer` root. The header is
 * NOT touched here — React owns the header markup (label + Copy
 * `<TugIconButton>`); this function rebuilds only what lives below
 * the header (truncation banner, flat / virtualized line container,
 * post-mortem footer). Returns a {@link TerminalRenderHandle} whose
 * `cleanup` detaches the body's listeners and whose `refit` re-runs
 * `applyUpdate` for the virtualized path (no-op for flat).
 *
 * **Collapsed preview path.** When `collapsed` is true,
 * the renderer skips the virtualizer entirely and renders just the
 * first `previewLineCap` lines via the flat path — same lines the
 * user would see at the top of the expanded output.
 * Truncation banner is suppressed (the fold cue carries the "more
 * exists below" signal). Footer is suppressed (post-mortem badges
 * sit at the END of the output; revealing them during a TOP-of-file
 * preview would mislead the reader into thinking the command had
 * completed within the preview). Expanding the block restores the
 * full render (truncation banner, virtualizer, footer) on the next
 * call.
 *
 * `anchor` is forwarded to `appendVirtualizedBody` when virtualizing
 * — `"top"` for static-mode renders (expand-from-preview reads top-
 * down), `"bottom"` for streaming-mode renders (latest lines visible).
 *
 * `getOuter` is forwarded to the virtualizer for the Cmd/Ctrl-wheel
 * routing contract — see `use-outer-scroll-on-modifier-wheel.ts`.
 */
function renderTerminal(
  outer: HTMLElement,
  body: HTMLElement,
  data: TerminalData,
  getOuter: () => HTMLElement | null,
  collapsed: boolean = false,
  previewLineCap: number = DEFAULT_COLLAPSE_THRESHOLD,
  anchor: "top" | "bottom" = "top",
  scrollKey: string | undefined = undefined,
  initialScrollTop: number | undefined = undefined,
): TerminalRenderHandle {
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

  // Collapsed preview path — slice to the first `previewLineCap`
  // lines, skip the truncation banner + virtualizer + footer. The
  // fold cue (in the React-owned header) and the CSS mask-image fade
  // together signal "more below; click to expand."
  if (collapsed && lines.length > 0) {
    const preview = lines.slice(0, previewLineCap);
    appendFlatBody(body, preview);
    return NO_OP_TERMINAL_HANDLE;
  }

  if (truncated > 0) {
    body.appendChild(buildTruncationIndicator(truncated));
  }

  let handle: VirtualizedBodyHandle | null = null;
  if (lines.length > 0) {
    if (lines.length <= VISIBLE_THRESHOLD) {
      appendFlatBody(body, lines);
    } else {
      handle = appendVirtualizedBody(
        body,
        lines,
        anchor,
        getOuter,
        scrollKey,
        initialScrollTop,
      );
    }
  }

  const footer = buildFooter(data);
  if (footer !== null) body.appendChild(footer);

  return handle ?? NO_OP_TERMINAL_HANDLE;
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

export const TerminalBlock: React.FC<TerminalBlockProps> = ({
  data,
  streamingStore,
  streamingPath = DEFAULT_STREAMING_PATH,
  className,
  embedded = false,
  headerLabel,
  collapsed: collapsedProp,
  onToggleCollapsed,
  collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
  componentStatePreservationKey,
}) => {
  // Outer card — React owns the markup (header + body container);
  // imperative `renderTerminal` writes lines/footer into `bodyRef`.
  const outerRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  // Latest data for the Copy callback to read. Updated inside both
  // effects so streaming sees the freshest stdout/stderr without
  // forcing a React re-render of the shell.
  const latestDataRef = React.useRef<TerminalData>(EMPTY_TERMINAL);

  // Outer scrollport (context published by the host list view).
  // Read each call into a ref so the imperative virtualizer can
  // resolve the live node at wheel-event time without re-running
  // the body-render effect when the outer node changes.
  const outerScrollport = useOuterScrollport();
  const outerScrollportRef = React.useRef<HTMLElement | null>(outerScrollport);
  React.useLayoutEffect(() => {
    outerScrollportRef.current = outerScrollport;
  }, [outerScrollport]);
  const getOuterScrollport = React.useCallback(
    (): HTMLElement | null => outerScrollportRef.current,
    [],
  );

  // Refit callback handed up from the most recent renderTerminal()
  // call. Mounted via `useLayoutEffect` so the imperative renderer
  // and React state stay in lockstep across the same paint. The
  // outer-scrollport / IntersectionObserver effect below calls
  // `refitRef.current?.()` on entering-view to recover from the
  // intermittent blank-frame-after-scroll-into-view symptom.
  const refitRef = React.useRef<(() => void) | null>(null);
  // The data prop captured at FIRST mount. Static mode renders this
  // value once and never again, even across collapse-driven
  // re-renders. Without this ref the collapse-aware re-render would
  // pick up subsequent prop changes — that's a contract violation of
  // the mount-once shape and would also force re-parses the
  // streaming path is supposed to own.
  const initialDataRef = React.useRef<TerminalData | undefined>(data);

  // ---- Fold state ([L06] data, not appearance: it controls *what*
  //                  is rendered, not *how* a rendered element
  //                  looks) ---------------------------------------------
  //
  // `overThreshold` is derived from the static line count (cheap
  // `quickLineCount`, no ANSI parse) and seeds the uncontrolled fold
  // default — long output folds, short output does not. Streaming
  // mode (`streamingStore` set) reads `lineCount` as 0 because the
  // imperative renderer owns the growing line pool, not React state;
  // the fold cue therefore stays hidden in streaming mode until a
  // follow-up wires a streaming line-count subscription.
  //
  // `useBlockFoldState` owns the rest — controlled / uncontrolled
  // resolution, mount-in-saved-state, and [A9] capture — shared with
  // the other fold-bearing body kinds. The virtualized scroller's
  // `scrollTop` is preserved separately, on the [A9] region-scroll
  // axis (a `data-tug-scroll-key` attribute on the scroller div): the
  // two axes are split deliberately — fold is React state, inner
  // scroll is DOM authority (scrollTop lives on the scroll element).
  const lineCount = React.useMemo(
    () => quickLineCount(initialDataRef.current),
    [],
  );
  const overThreshold = lineCount > collapseThreshold;

  const { collapsed, setCollapsed } = useBlockFoldState({
    collapsed: collapsedProp,
    defaultCollapsed: overThreshold,
    onToggleCollapsed,
    componentStatePreservationKey,
  });

  // Chrome actions target — non-null when this TerminalBlock is
  // composed inside a `ToolBlockChrome` that has rendered its actions
  // slot. The Copy `<TugIconButton>` portals into the chrome header
  // rather than hosting it in a separate body-kind strip. Standalone
  // composition keeps the header strip and renders Copy at its
  // trailing edge.
  const chromeActionsTarget = useChromeActionsTarget();

  // Dev-mode misconfiguration check — `embedded={true}` requires a
  // parent `ToolBlockChrome` so Copy has a portal target. The
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
        "TerminalBlock: `embedded={true}` requires a parent `ToolBlockChrome`. " +
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

  // [A9] region-scroll key for the virtualized inner scroller —
  // suffixed `/term-scroll` off the block's preservation key.
  // Threaded through each `renderTerminal` call so the scroller div
  // gets stamped on creation; CardHost's `captureRegionScrolls`
  // walks the attribute on save. `undefined` when the consumer
  // didn't opt in (gallery / standalone), which the imperative
  // renderer treats as "don't stamp" — no attribute, no
  // preservation.
  const scrollKey =
    componentStatePreservationKey === undefined
      ? undefined
      : `${componentStatePreservationKey}/term-scroll`;

  // Mount-in-saved-state for the inner scroller. The saved scroll
  // for this card's region-scroll axis is read synchronously in
  // render and consumed by the FIRST `renderTerminal` call below;
  // `appendVirtualizedBody` writes it into the scroller's
  // `scrollTop` at creation, so the very first paint lands at the
  // user's saved position. Subsequent `renderTerminal` calls
  // (collapse-toggle rebuild, streaming re-render) pass `undefined`
  // and rely on the anchor-based default; the element-identity-
  // gated MutationObserver pass in `card-host.tsx` re-applies the
  // bag value to the rebuilt scroller. See `state-preservation.md`.
  const savedRegionScroll = useSavedRegionScroll(scrollKey);
  const initialScrollTopRef = React.useRef<number | undefined>(
    savedRegionScroll?.y,
  );
  const firstRenderConsumedRef = React.useRef(false);
  const consumeInitialScrollTop = React.useCallback((): number | undefined => {
    if (firstRenderConsumedRef.current) return undefined;
    firstRenderConsumedRef.current = true;
    return initialScrollTopRef.current;
  }, []);

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
    const handle = renderTerminal(
      outer,
      body,
      d,
      getOuterScrollport,
      collapsed,
      collapseThreshold,
      "top",
      scrollKey,
      consumeInitialScrollTop(),
    );
    refitRef.current = handle.refit;
    return () => {
      refitRef.current = null;
      handle.cleanup();
    };
  }, [collapsed, collapseThreshold, streamingStore, getOuterScrollport, scrollKey, consumeInitialScrollTop]);

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
        refitRef.current = null;
        return;
      }
      const next = coerceTerminalData(store.get(streamingPath));
      latestDataRef.current = next;
      // Streaming mode anchors the virtualized viewport at the
      // tail — live output is read latest-first, and any new line
      // arriving while the user is at the bottom should keep them
      // pinned to the new tail (subsequent rerenders will re-anchor
      // there). Static mode (the renderer's default) anchors at
      // top, which is right for expand-from-preview reading.
      const handle = renderTerminal(
        outerEl,
        bodyEl,
        next,
        getOuterScrollport,
        collapsedStreamingRef.current,
        collapseThreshold,
        "bottom",
        scrollKey,
        consumeInitialScrollTop(),
      );
      cleanup = handle.cleanup;
      refitRef.current = handle.refit;
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
      refitRef.current = null;
      cleanup();
    };
  }, [streamingStore, streamingPath, collapseThreshold, getOuterScrollport, scrollKey, consumeInitialScrollTop]);

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
    // Streaming collapse-toggle re-render — keep the tail anchor
    // to match the streaming subscription path above.
    // Streaming-mode collapse-toggle re-renders ALWAYS run after the
    // streaming subscription's first `rerender()` consumed the saved
    // scroll, so this path never carries `initialScrollTop` — the
    // element-identity-gated MutationObserver pass in `card-host.tsx`
    // re-applies the bag value to the rebuilt scroller when needed.
    const handle = renderTerminal(
      outer,
      body,
      next,
      getOuterScrollport,
      collapsed,
      collapseThreshold,
      "bottom",
      scrollKey,
      undefined,
    );
    refitRef.current = handle.refit;
    return () => {
      refitRef.current = null;
      handle.cleanup();
    };
  }, [collapsed, collapseThreshold, streamingStore, streamingPath, getOuterScrollport, scrollKey]);

  // ---- Blank-frame recovery on scroll-into-view ----------------------
  //
  // Symptom: scrolling the outer card so a Bash output region enters
  // view sometimes leaves the inner virtualized scroller painted as
  // empty — the scroller exists with the right height, but its line
  // elements don't appear until the user wheels inside it (which
  // triggers `applyUpdate` and re-mounts lines). Likely causes
  // identified during the diagnosis pass include WebKit layer-
  // invalidation hiccups under the outer's scroll-driven clip
  // changes, and `IntersectionObserver`-style virtualizers that
  // miss the first paint when their parent's clip rect is still
  // settling.
  //
  // The fix is the symptom-targeted refit: when the outer scrollport
  // reports this terminal entering view (IntersectionObserver), call
  // the virtualizer's `refit` (which re-runs `applyUpdate(scrollTop)`
  // and re-mounts the visible window). Refit is idempotent when no
  // enter/exit ranges change, so spurious fires are free.
  //
  // Also listen on the outer's `scroll` event while in view as a
  // belt-and-suspenders: some intermittents only surface when the
  // outer is mid-scroll, and the IO threshold buckets may not fire
  // for sub-threshold delta. The scroll handler gates on `inView`
  // so we don't burn cycles when the terminal is off-screen.
  //
  // Laws:
  //  - [L03] `useLayoutEffect` so the IO + scroll listeners are live
  //    from first paint; otherwise the very first scroll-into-view
  //    could miss its refit by a frame.
  //  - [L05] No `requestAnimationFrame`. Refit runs synchronously in
  //    the IO / scroll callback.
  //  - [L06] Scroll-into-view detection drives a DOM-level refit;
  //    no React state changes from this effect.
  //  - [L22] IO is an external store; the effect subscribes to it
  //    directly and writes to the DOM in the callback, never
  //    routing intersection state through React.
  React.useLayoutEffect(() => {
    if (outerScrollport === null) return;
    const root = outerRef.current;
    if (root === null) return;

    let inView = false;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const enteringView = entry.isIntersecting && !inView;
          inView = entry.isIntersecting;
          if (enteringView) {
            refitRef.current?.();
          }
        }
      },
      { root: outerScrollport, threshold: 0 },
    );
    observer.observe(root);

    const onOuterScroll = (): void => {
      if (!inView) return;
      refitRef.current?.();
    };
    outerScrollport.addEventListener("scroll", onOuterScroll, {
      passive: true,
    });

    return () => {
      observer.disconnect();
      outerScrollport.removeEventListener("scroll", onOuterScroll);
    };
  }, [outerScrollport]);

  // `getText` closure for the `BlockCopyButton` affordance —
  // reads the latest streamed-or-static data at click time. The
  // affordance owns the confirmation flash + timer cleanup +
  // clipboard call; this function is the only block-specific bit.
  const getCopyText = React.useCallback(
    () => composeCopyText(latestDataRef.current),
    [],
  );

  // ---- Responder identity ----------------------------------------------
  //
  // TerminalBlock owns the `text` data the `COPY` action operates on,
  // so it registers as a responder for `COPY`: a stable `useId`, a
  // `Partial<Record<TugAction, ActionHandler>>` registered via
  // `useOptionalResponder`, a `ResponderScope` wrapping the root.
  // Cmd-C while the block is first-responder runs the silent COPY
  // path; the confirmation flash is a click-affordance concern that
  // lives inside `BlockCopyButton`.
  const terminalBlockResponderId = React.useId();

  // Chain manager — promotes TerminalBlock to first-responder after a
  // focus-refusing affordance click (the fold cue / Copy carry
  // `data-tug-focus="refuse"`, so the chain provider's pointerdown
  // listener skips chain promotion on their clicks). Same pattern as
  // FileBlock; null outside a `ResponderChainProvider` (gallery /
  // unit tests).
  const chainManager = useResponderChain();

  // ---- Responder registration ([L11]) ---------------------------------
  //
  // TerminalBlock registers a single `COPY` handler — Cmd-C copies the
  // current terminal output when the block is first-responder.
  const terminalBlockActions = React.useMemo<
    Partial<Record<TugAction, ActionHandler>>
  >(
    () => ({
      [TUG_ACTIONS.COPY]: () => {
        const writeText = navigator.clipboard?.writeText.bind(
          navigator.clipboard,
        );
        if (writeText === undefined) return;
        const text = composeCopyText(latestDataRef.current);
        if (text.length === 0) return;
        void writeText(text).catch(() => undefined);
      },
    }),
    [],
  );
  const terminalBlockResponder = useOptionalResponder({
    id: terminalBlockResponderId,
    actions: terminalBlockActions,
  });

  // ---- Position-stable click infrastructure ---------------------------
  //
  // Position-stable click is now encapsulated inside the affordance
  // components (BlockCopyButton, BlockFoldCue) — each calls
  // `useOuterScrollport` + `usePositionStableClick` internally. The
  // scrollport-level tail spacer combo (wired by tide-card-transcript)
  // still applies: the spacer raises `maxScrollTop` so a collapse
  // doesn't hit a hard clamp, and the position-stable hook inside
  // `BlockFoldCue` writes the exact `scrollTop` that holds the
  // cluster under the user's cursor across the height change.

  // Fold-cue toggle callback. The `BlockFoldCue` affordance has
  // already released the host scroller's follow-bottom lock and
  // routed the call through the position-stable wrapper. This
  // callback adds the one block-specific concern `useBlockFoldState`
  // can't own — promoting TerminalBlock to first-responder so a
  // Cmd-C right after the click reaches its COPY handler — then
  // delegates the state mutation + host notification to `setCollapsed`.
  const handleFoldToggle = React.useCallback((next: boolean) => {
    chainManager?.makeFirstResponder(terminalBlockResponderId);
    setCollapsed(next);
  }, [chainManager, setCollapsed, terminalBlockResponderId]);

  // Compose the affordances cluster ONCE. Ordering: Copy
  // (the feature affordance) → fold cue (the fixed-position landmark
  // at the trailing edge). Mirrors FileBlock / DiffBlock so the
  // user's eye finds the fold cue in the same place across every
  // body kind. All three use the `body-kinds/affordances/` library.
  // Fold-cue labels. Collapsed: the count of lines hidden below the
  // preview ("275 more lines") — the cue tells the reader what they
  // gain by expanding. Expanded: the verb "Collapse" — the cue tells
  // them what the click does. Both are handed to `BlockFoldCue`,
  // which renders the state's label and reserves the wider one's
  // width so toggling never resizes the button. `overThreshold`
  // gates the cue, so the collapsed label always has a real
  // remainder when shown.
  const hiddenLineCount = Math.max(0, lineCount - collapseThreshold);
  const cueCollapsedLabel = `${hiddenLineCount.toLocaleString()} more ${
    hiddenLineCount === 1 ? "line" : "lines"
  }`;
  // Copy is disabled when there's nothing to copy. Static-mode check
  // uses the `data` prop directly. Streaming-mode keeps Copy enabled
  // because content arrives over time via `streamingStore` and the
  // React shell doesn't re-render on those updates — disabling
  // optimistically would lock Copy out as soon as a stream starts
  // empty.
  const isStreaming = streamingStore !== undefined;
  const copyDisabled = !isStreaming && !hasContent(data);
  const affordances = (
    <>
      <BlockCopyButton
        disabled={copyDisabled}
        aria-label="Copy terminal output"
        getText={getCopyText}
      />
      {overThreshold ? (
        <BlockFoldCue
          className="tugx-term-fold-cue"
          data-slot="terminal-fold-cue"
          collapsed={collapsed}
          onToggle={handleFoldToggle}
          collapsedLabel={cueCollapsedLabel}
          expandedLabel="Collapse"
          ariaLabelCollapse="Collapse terminal output"
          ariaLabelExpand="Expand terminal output"
        />
      ) : null}
    </>
  );

  const portaledAffordances =
    embedded && chromeActionsTarget !== null
      ? createPortal(
          <BlockActionsCluster data-slot="terminal-actions">
            {affordances}
          </BlockActionsCluster>,
          chromeActionsTarget,
        )
      : null;

  // Composed root ref — forwards to both the local `outerRef` (read
  // by the imperative renderer for the current element) AND the
  // responder chain's ref-callback (writes `data-responder-id` on
  // the same element). Same pattern as FileBlock's `composedRootRef`.
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
            <BlockActionsCluster data-slot="terminal-actions">
              {affordances}
            </BlockActionsCluster>
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
