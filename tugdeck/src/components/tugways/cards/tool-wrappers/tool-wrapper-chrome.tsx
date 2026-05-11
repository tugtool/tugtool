/**
 * `ToolWrapperChrome` — shared header/footer frame around Layer-2
 * tool wrappers.
 *
 * Per [D05]'s two-layer hybrid architecture and [Spec S03]'s
 * tool-wrapper contract, every per-tool wrapper composes:
 *
 *   1. A chrome frame (this component) — header (icon + tool name +
 *      args summary), optional footer (badges), optional inline
 *      caution badge, status-aware styling. Token vocabulary:
 *      `--tugx-toolblock-*`.
 *   2. A body kind — `TerminalBlock`, `DiffBlock`, `FileBlock`, etc.
 *      Token vocabulary: `--tugx-{term,diff,file,…}-*`.
 *
 * The chrome's job is to give every tool a consistent frame so the
 * user can scan the transcript and spot tool calls at a glance.
 * Per-tool wrappers handle the body composition and the
 * tool-specific bits (e.g., the shell-syntax-highlighted command on
 * `BashToolBlock`).
 *
 * Status states map to the [Spec S03] `ToolWrapperStatus` enum:
 *
 *   - `streaming` — the tool input is partial; the wrapper passes a
 *     placeholder body (`<ToolWrapperChrome.StreamingPlaceholder />`)
 *     into `children` and the chrome paints a streaming-color stripe
 *     on the header.
 *   - `ready`    — steady-state render. Chrome is the default color.
 *   - `error`    — `tool_result.is_error === true`. Chrome paints
 *     an error stripe; consumers may also pass an
 *     `errorMessage` slot for inline detail.
 *
 * `caution` is rendered as an inline badge in the header per
 * [D04] / [Q03]. Three reasons surface here: `unknown_tool`,
 * `unknown_shape`, `version_drift`.
 *
 * Laws:
 *  - [L06] all visible state lives on data attributes / class
 *    swaps; the chrome never renders prose into React state.
 *  - [L19] component-authoring guide — `.tsx` + `.css` pair,
 *    module docstring, exported props interface,
 *    `data-slot="tool-wrapper-chrome"` on the root.
 *  - [L20] component-token sovereignty — the chrome owns the
 *    `--tugx-toolblock-*` slot family. Body kinds composed inside
 *    keep their own `--tugx-{kind}-*` tokens; chrome rules never
 *    reach into them.
 *
 * @module components/tugways/cards/tool-wrappers/tool-wrapper-chrome
 */

import "./tool-wrapper-chrome.css";

import React from "react";

import { cn } from "@/lib/utils";

import type { CautionFlag, ToolWrapperStatus } from "./types";

export interface ToolWrapperChromeProps {
  /**
   * Canonical tool name as it should display in the header (e.g.
   * "Bash"). Wrappers pass the wire-shape `toolName` after any
   * casing normalization they prefer.
   */
  toolName: string;
  /**
   * Optional icon for the header. Lucide-react icons fit naturally;
   * any inline element works.
   */
  toolIcon?: React.ReactNode;
  /**
   * Args summary — typically the most-relevant single field of the
   * tool input rendered as a one-liner (e.g. the shell command, the
   * file path being read). Wrappers pass a `<code>` element for
   * mono-styling; the chrome treats it opaquely.
   */
  argsSummary?: React.ReactNode;
  /** Lifecycle state per Spec S03's `ToolWrapperStatus`. */
  status?: ToolWrapperStatus;
  /** Drift caution surfaced as an inline badge in the header. */
  caution?: CautionFlag;
  /**
   * Footer badges — exit code, duration, interrupted, etc.
   * Rendered in a flex row at the bottom of the chrome. Empty /
   * undefined skips the footer entirely.
   */
  footerBadges?: React.ReactNode;
  /**
   * Optional error message — rendered between the body and the
   * footer when `status === "error"`. Consumers pass
   * `tool_result.output` or a synthesized message.
   */
  errorMessage?: React.ReactNode;
  /**
   * Body content — typically a body-kind component
   * (`TerminalBlock`, `DiffBlock`, etc.). The chrome hosts it
   * inside a region with `data-slot="tool-wrapper-body"`.
   */
  children: React.ReactNode;
  /**
   * `data-slot` on the root. Per Spec S03, every wrapper's root
   * carries `data-slot="<tool>-tool-block"`. The chrome accepts an
   * override here so `BashToolBlock` can stamp
   * `data-slot="bash-tool-block"` on its root without the chrome
   * needing to know about Bash specifically.
   *
   * @default "tool-wrapper-chrome"
   */
  rootSlot?: string;
  /** Forwarded class name. */
  className?: string;
}

/**
 * Streaming placeholder — a small inline element wrappers can drop
 * into `children` when `status === "streaming"` and no body content
 * is ready yet. It's a stand-alone export so consumers can also use
 * it inside the body region of a partial-input render (e.g.
 * `BashToolBlock` shows it while the command field is still
 * arriving).
 */
export const StreamingPlaceholder: React.FC = () => (
  <div
    data-slot="tool-wrapper-streaming-placeholder"
    className="tool-wrapper-streaming-placeholder"
  >
    <span className="tool-wrapper-streaming-dot" />
    <span className="tool-wrapper-streaming-dot" />
    <span className="tool-wrapper-streaming-dot" />
  </div>
);

export const ToolWrapperChrome: React.FC<ToolWrapperChromeProps> = ({
  toolName,
  toolIcon,
  argsSummary,
  status = "ready",
  caution,
  footerBadges,
  errorMessage,
  children,
  rootSlot = "tool-wrapper-chrome",
  className,
}) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const headerRef = React.useRef<HTMLDivElement | null>(null);

  // Telescoping pin support — write the live measured chrome-header
  // height into `--tugx-toolblock-header-height` on the chrome root so
  // a body-kind actions row inside can pin at
  // `top: calc(var(--tugx-pin-stack-top, 0) + var(--tugx-toolblock-header-height, 0))`
  // and telescope cleanly under the identity header. Mirrors the
  // entry-header → block-header relationship one level deeper.
  //
  // [L03] `useLayoutEffect` so the variable is written before paint —
  // an inner actions row reading the variable in its first sticky
  // pass gets the correct offset rather than a one-frame-late value.
  // [L06] DOM write, never React state — appearance flows through
  // CSS variables, not re-renders.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (root === null || header === null) return;

    const write = (px: number): void => {
      root.style.setProperty("--tugx-toolblock-header-height", `${px}px`);
    };

    // Seed the variable from the current header height so the first
    // paint already has the correct value (the ResizeObserver only
    // fires for subsequent changes).
    write(header.offsetHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      // `borderBoxSize` is preferred — it reports the box-model height
      // the browser actually laid out, matching `offsetHeight`. Fall
      // back to `contentRect` for older WebKit if needed.
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
  }, []);

  return (
    <div
      ref={rootRef}
      data-slot={rootSlot}
      data-status={status}
      data-caution={caution?.reason ?? undefined}
      className={cn("tool-wrapper-chrome", className)}
    >
      <div
        ref={headerRef}
        className="tool-wrapper-chrome-header"
        data-slot="tool-wrapper-header"
      >
        {toolIcon !== undefined ? (
          <span className="tool-wrapper-chrome-icon" aria-hidden="true">
            {toolIcon}
          </span>
        ) : null}
        <span className="tool-wrapper-chrome-name">{toolName}</span>
        {argsSummary !== undefined ? (
          <span className="tool-wrapper-chrome-args">{argsSummary}</span>
        ) : null}
        {caution !== undefined ? (
          <CautionBadge caution={caution} />
        ) : null}
      </div>
      <div className="tool-wrapper-chrome-body" data-slot="tool-wrapper-body">
        {children}
      </div>
      {status === "error" && errorMessage !== undefined ? (
        <div
          className="tool-wrapper-chrome-error"
          data-slot="tool-wrapper-error"
        >
          {errorMessage}
        </div>
      ) : null}
      {footerBadges !== undefined ? (
        <div
          className="tool-wrapper-chrome-footer"
          data-slot="tool-wrapper-footer"
        >
          {footerBadges}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Inline caution badge surfaced when the dispatch flagged drift on
 * this tool call. The label is short and the title attribute carries
 * the longer detail so power users can hover to inspect the cause.
 *
 * The full `CautionBadge` design (aggregate counter on the card
 * chrome, click-through to drift telemetry) lands in a later step;
 * this is the inline-flag part of the [D04] / [Q03] strategy.
 */
const CautionBadge: React.FC<{ caution: CautionFlag }> = ({ caution }) => {
  const label =
    caution.reason === "unknown_tool"
      ? "unknown tool"
      : caution.reason === "unknown_shape"
        ? "unknown shape"
        : "version drift";
  return (
    <span
      data-slot="tool-wrapper-caution"
      className="tool-wrapper-chrome-caution"
      title={caution.detail !== undefined ? `${label}: ${caution.detail}` : label}
    >
      ⚠ {label}
    </span>
  );
};
