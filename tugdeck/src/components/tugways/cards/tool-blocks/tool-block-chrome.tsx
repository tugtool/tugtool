/**
 * `ToolBlockChrome` — shared header/footer frame around Layer-2
 * tool blocks.
 *
 * Per [D05]'s two-layer hybrid architecture and [Spec S03]'s
 * tool-block contract, every per-tool block composes:
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
 * Per-tool blocks handle the body composition and the
 * tool-specific bits (e.g., the shell-syntax-highlighted command on
 * `BashToolBlock`).
 *
 * Status states map to the [Spec S03] `ToolBlockStatus` enum:
 *
 *   - `streaming` — the tool input is partial; the wrapper passes a
 *     placeholder body (`<ToolBlockChrome.StreamingPlaceholder />`)
 *     into `children` and the chrome paints a streaming-color stripe
 *     on the header.
 *   - `ready`    — steady-state render. Chrome is the default color.
 *   - `error`    — `tool_result.is_error === true`. Chrome paints
 *     an error stripe; consumers may also pass an
 *     `errorMessage` slot for inline detail.
 *
 * `caution` is rendered as an inline `TideCautionBadge` in the header
 * per [D04] / [Q03] — three reasons surface: `unknown_tool`,
 * `unknown_shape`, `version_drift`. The chrome owns only the
 * placement; the chip is `chrome/tide-caution-badge.tsx`.
 *
 * ## Actions slot — body-kind affordance host
 *
 * The chrome's header carries an actions target at its trailing edge:
 * `<div data-slot="tool-block-actions">`. It is exposed to descendants
 * via the `ChromeActionsTargetContext` so a body kind composed inside
 * (under `embedded={true}`) can `createPortal` its resting affordances
 * (Find trigger, Copy, view-mode toggle, fold cue) into the chrome header
 * itself. Per [L20] the chrome owns only the SLOT (a placeholder div with
 * layout-only styling); the affordances inside the slot are React-rendered
 * by the body kind and carry the body kind's tokens. Standalone callers
 * (gallery, RenderInput-routed) get a null context value and render
 * affordances in their own identity header.
 *
 * Why a portal and not a `headerActions` prop: the affordance state
 * (find session, view-mode toggle, fold collapsed-set) is owned by the
 * body kind. Hoisting that state to the wrapper level so the wrapper
 * could pass `headerActions` would invert the data flow and require
 * every wrapper to re-implement the affordance UI. The portal lets the
 * body kind keep all state local while still placing the rendered
 * affordance node inside the chrome's header in the DOM tree — exactly
 * where it needs to sit for layout, sticky-pin coverage, and accessibility.
 *
 * Laws:
 *  - [L06] all visible state lives on data attributes / class
 *    swaps; the chrome never renders prose into React state.
 *  - [L19] component-authoring guide — `.tsx` + `.css` pair,
 *    module docstring, exported props interface,
 *    `data-slot="tool-block-chrome"` on the root.
 *  - [L20] component-token sovereignty — the chrome owns the
 *    `--tugx-toolblock-*` slot family. Body kinds composed inside
 *    keep their own `--tugx-{kind}-*` tokens; chrome rules never
 *    reach into them.
 *
 * @module components/tugways/cards/tool-blocks/tool-block-chrome
 */

import "./tool-block-chrome.css";

import React from "react";

import { cn } from "@/lib/utils";
import { TideCautionBadge } from "@/components/tugways/chrome/tide-caution-badge";
import { TugProgress } from "@/components/tugways/tug-progress";

import type { CautionFlag, ToolBlockStatus } from "./types";

/**
 * Context exposing the chrome's actions-slot DOM node to descendants.
 * Body kinds nested under a `ToolBlockChrome` (typically with
 * `embedded={true}`) read this and portal their resting affordances
 * into the slot, so the chrome header carries the icon row at its
 * trailing edge without the chrome needing to know what affordances
 * exist. The value is `null` when no chrome is above — standalone
 * callers detect that and render affordances in their own header.
 */
const ChromeActionsTargetContext = React.createContext<HTMLDivElement | null>(
  null,
);

/**
 * Read the chrome actions target from context. Returns `null` when the
 * caller renders outside a `ToolBlockChrome` (standalone composition).
 * Body kinds key their "portal or render inline" branch on the truthiness
 * of this value combined with their own `embedded` prop.
 */
export function useChromeActionsTarget(): HTMLDivElement | null {
  return React.useContext(ChromeActionsTargetContext);
}

export interface ToolBlockChromeProps {
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
  /** Lifecycle state per Spec S03's `ToolBlockStatus`. */
  status?: ToolBlockStatus;
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
   * inside a region with `data-slot="tool-block-body"`.
   */
  children: React.ReactNode;
  /**
   * `data-slot` on the root. Per Spec S03, every wrapper's root
   * carries `data-slot="<tool>-tool-block"`. The chrome accepts an
   * override here so `BashToolBlock` can stamp
   * `data-slot="bash-tool-block"` on its root without the chrome
   * needing to know about Bash specifically.
   *
   * @default "tool-block-chrome"
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
 *
 * Renders a single `TugProgress` ring in indeterminate mode (no
 * `value` prop) — the project-standard "work in flight" indicator.
 * The earlier bespoke three-dot pulse was retired here so every
 * in-flight tool block speaks the same visual vocabulary as
 * `TugProgress` everywhere else in the app.
 */
export const StreamingPlaceholder: React.FC = () => (
  <div
    data-slot="tool-block-streaming-placeholder"
    className="tool-block-streaming-placeholder"
  >
    {/* `role="inherit"` so the ring picks up the wrapper's muted
     * text color instead of the theme's accent (orange in brio).
     * The placeholder is a "we're waiting" cue, not a foreground
     * accent — same vocabulary as the surrounding prose tone. */}
    <TugProgress
      variant="ring"
      size="sm"
      role="inherit"
      aria-label="In progress"
    />
  </div>
);

export const ToolBlockChrome: React.FC<ToolBlockChromeProps> = ({
  toolName,
  toolIcon,
  argsSummary,
  status = "ready",
  caution,
  footerBadges,
  errorMessage,
  children,
  rootSlot = "tool-block-chrome",
  className,
}) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const headerRef = React.useRef<HTMLDivElement | null>(null);
  // The actions-slot target is a real DOM node that descendants portal
  // into. Tracking it in React state (rather than a ref alone) so the
  // context value re-publishes once the node mounts — the body kind's
  // `createPortal` call on its first render-after-mount will then find
  // a non-null target. Stale-null reads can't happen because the body
  // kind re-renders whenever the chrome's render does.
  const [actionsTarget, setActionsTarget] =
    React.useState<HTMLDivElement | null>(null);

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
      className={cn("tool-block-chrome", className)}
    >
      <div
        ref={headerRef}
        className="tool-block-chrome-header"
        data-slot="tool-block-header"
      >
        {toolIcon !== undefined ? (
          <span className="tool-block-chrome-icon" aria-hidden="true">
            {toolIcon}
          </span>
        ) : null}
        <span className="tool-block-chrome-name">{toolName}</span>
        {argsSummary !== undefined ? (
          <span className="tool-block-chrome-args">{argsSummary}</span>
        ) : null}
        {caution !== undefined ? (
          <TideCautionBadge caution={caution} />
        ) : null}
        {/* Actions slot — see module docstring. A composed body kind
         * portals its resting affordances here when `embedded={true}`.
         * The slot is always rendered (even when empty) so the slot
         * node is in the DOM from the chrome's first paint, the
         * context value is non-null on first descendant render, and
         * the body kind's portal call can target it without a
         * re-render dance. Layout: `flex: 0 0 auto`; args ellipsizes
         * to make room as affordances accumulate. */}
        <div
          ref={setActionsTarget}
          className="tool-block-chrome-actions"
          data-slot="tool-block-actions"
        />
      </div>
      <div className="tool-block-chrome-body" data-slot="tool-block-body">
        <ChromeActionsTargetContext.Provider value={actionsTarget}>
          {children}
        </ChromeActionsTargetContext.Provider>
      </div>
      {status === "error" && errorMessage !== undefined ? (
        <div
          className="tool-block-chrome-error"
          data-slot="tool-block-error"
        >
          {errorMessage}
        </div>
      ) : null}
      {footerBadges !== undefined ? (
        <div
          className="tool-block-chrome-footer"
          data-slot="tool-block-footer"
        >
          {footerBadges}
        </div>
      ) : null}
    </div>
  );
};
