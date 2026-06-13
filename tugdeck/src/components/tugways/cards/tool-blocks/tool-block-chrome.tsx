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
 * `caution` is rendered as an inline `DevCautionBadge` in the header
 * per [D04] / [Q03] — three reasons surface: `unknown_tool`,
 * `unknown_shape`, `version_drift`. The chrome owns only the
 * placement; the chip is `chrome/dev-caution-badge.tsx`.
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
 * ## Opt-in chrome-level affordances — for `body-bits/` wrappers
 *
 * Body-bits wrappers (`SkillToolBlock`, `MonitorToolBlock`,
 * `WorktreeToolBlock`, `TaskMgmtToolBlock`) don't compose an embedded
 * body kind, so they don't get Copy / Fold via the portal. The chrome
 * exposes two opt-in props for them:
 *
 *  - `copyText` — when set, the chrome renders a `BlockCopyButton`
 *    in the actions slot whose payload is this string.
 *  - `fold` — when set, the chrome owns the fold state via
 *    `useBlockFoldState`, renders a `BlockFoldCue` in the actions
 *    slot, and conditionally renders `children` based on the
 *    resolved flag.
 *
 * The two paths (embedded portal vs chrome-owned) are mutually
 * exclusive by convention: a wrapper composes either an embedded
 * body kind (Bash / Read / Edit / Glob / Grep) and uses the portal,
 * or `body-bits/` primitives and opts into these props. Mixing both
 * would render duplicate cues in the actions slot; the chrome doesn't
 * try to detect the collision because the wrapper is the single
 * source of truth for its composition choice.
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
import type { ToolCallPhase } from "@/lib/code-session-store/tool-call-phase-visual";
import { BlockFoldSuppressedContext } from "@/components/tugways/body-kinds/affordances";

import { ToolBlockCollapseContext, ToolUseIdContext } from "./collapse-context";
import { ToolCallHeader } from "./tool-call-header";
import type { ToolResultSummary } from "./tool-result-summary";
import type { CautionFlag, ToolBlockStatus } from "./types";

/**
 * Map the chrome's body-composition `status` onto a header-dot
 * {@link ToolCallPhase} when the wrapper hasn't passed a richer
 * `phase`. `streaming → in_flight`, `ready → success`, `error →
 * error`. The `awaiting` and `interrupted` readings can't be derived
 * from `status` alone — a wrapper (or the dispatch, #step-6) supplies
 * those via the explicit `phase` prop, which always wins.
 */
function statusToPhase(status: ToolBlockStatus): ToolCallPhase {
  switch (status) {
    case "streaming":
      return "in_flight";
    case "error":
      return "error";
    case "ready":
    default:
      return "success";
  }
}

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

/**
 * Opt-in fold-affordance configuration for `ToolBlockChrome`. When
 * supplied, the chrome:
 *
 *  - Owns the fold state via `useBlockFoldState` (controlled +
 *    [A9]-preserved when `preservationKey` is set).
 *  - Renders a `BlockFoldCue` into its actions slot at the trailing
 *    edge of the header.
 *  - Conditionally renders `children` based on the resolved fold
 *    state — children mount only when expanded, so the body's render
 *    cost (and any DOM it produces) collapse along with the visual.
 *
 * Designed for tool-block wrappers whose body composes the shared
 * `body-bits/` primitives (`SkillToolBlock`, `MonitorToolBlock`,
 * `WorktreeToolBlock`, `TaskMgmtToolBlock`) — these wrappers don't
 * compose an embedded body kind, so they don't get fold for free via
 * the body-kind affordance portal. Wrappers that already compose an
 * embedded body kind (`BashToolBlock` → `TerminalBlock`, etc.)
 * receive their fold + copy via the embedded portal and MUST NOT
 * pass this prop — doing so would render two fold cues in the
 * actions slot.
 */
export interface ToolBlockFoldOptions {
  /**
   * Initial collapsed state when no [A9] saved value exists for
   * `preservationKey`. Defaults to `false` (open). Pass `true` for
   * wrappers whose folded-by-default reading is the desired one
   * (e.g. tool blocks where the assistant's prose summary is the
   * primary surface and the block is one click away as evidence).
   */
  defaultFolded?: boolean;
  /**
   * [A9] component-state key. When set, the resolved fold flag is
   * persisted so the user's open/closed choice survives a reload.
   * Tool-call wrappers typically derive this from `toolUseId` so the
   * key is per-call-stable across reloads. Omit for fixtures /
   * gallery cards where preservation isn't wanted.
   */
  preservationKey?: string;
  /**
   * Label the fold cue shows while the block is COLLAPSED — typically
   * a count or summary hint ("4 lines", "details", "preview"). The
   * wrapper formats locale + plural; the cue renders the string.
   */
  collapsedLabel: string;
  /**
   * Label while EXPANDED. Optional — defaults to `"Collapse"`, the
   * verb pairing used by every existing body-kind fold cue. Pass a
   * distinct value only when the expanded reading should differ
   * (rare for tool blocks).
   */
  expandedLabel?: string;
  /** ARIA label when clicking would collapse the block. */
  ariaLabelCollapse?: string;
  /** ARIA label when clicking would expand the block. */
  ariaLabelExpand?: string;
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
  /**
   * Single-row identity content for the header (a path atom-chip, a
   * short label). When omitted, the chrome falls back to `argsSummary`
   * for back-compat — wrappers migrate to passing `identity` + `command`
   * + `meta` explicitly (#step-7 onward). Sits on the identity row and
   * ellipsizes there.
   */
  identity?: React.ReactNode;
  /**
   * Command-shaped args rendered in full on their own wrapping row,
   * never truncated ([D05]). For bash commands, grep patterns, cron
   * expressions. Omit for chip-identity tools.
   */
  command?: React.ReactNode;
  /**
   * Trailing metadata cluster — counts / diff-stats / truncated via the
   * shared [D06] primitives ([Q02]: header, not footer). The EXPANDED
   * header's metadata.
   */
  meta?: React.ReactNode;
  /**
   * The call's one-line result as DATA, for the COLLAPSED header's quiet
   * summary ([P09]/[#step-11]). Tools that collapse by default
   * (read/grep/glob/bash/edit/write) provide it; rendered only in the
   * collapsed state. Distinct from `meta` (the expanded badge cluster) —
   * see {@link ToolResultSummary}.
   */
  resultSummary?: ToolResultSummary;
  /**
   * Whether to show the per-tool icon ([D07]). Defaults to `true`.
   */
  showIcon?: boolean;
  /** Lifecycle state per Spec S03's `ToolBlockStatus`. */
  status?: ToolBlockStatus;
  /**
   * Header-dot lifecycle phase ([D03]). When omitted, the chrome
   * derives it from `status` via `statusToPhase` — so the dot lights up
   * on every block without a wrapper change. A wrapper (or the dispatch,
   * #step-6) passes the richer phase to express `awaiting` /
   * `interrupted`, which `status` alone can't.
   */
  phase?: ToolCallPhase;
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
  /**
   * Superseded — ignored by the chrome. Every block is now collapsible
   * via the header's whole-block chevron, so a separate body fold cue is
   * redundant. Body-bits wrappers may still pass it harmlessly; the chrome
   * no longer renders a `BlockFoldCue` and the body always mounts when the
   * block is expanded.
   */
  fold?: ToolBlockFoldOptions;
  /**
   * Copy payload for the header's built-in Copy. A wrapper passes its
   * tailored result text (e.g. the formatted task list, the monitor tail)
   * and the header's Copy writes it in both states; when omitted the
   * header falls back to the collapse handle's command+result markdown.
   */
  copyText?: string;
  /** Forwarded class name. */
  className?: string;
}

export const ToolBlockChrome: React.FC<ToolBlockChromeProps> = ({
  toolName,
  toolIcon,
  argsSummary,
  identity,
  command,
  meta,
  resultSummary,
  showIcon = true,
  status = "ready",
  phase,
  caution,
  footerBadges,
  errorMessage,
  children,
  rootSlot = "tool-block-chrome",
  copyText,
  className,
}) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const headerRef = React.useRef<HTMLDivElement | null>(null);
  // History-collapse handle ([P02]). Non-null when a
  // `ToolBlockHistoryCollapse` wraps this block — which the transcript now
  // does for EVERY tool, so every block is collapsible. While
  // block-collapsed the body subtree is NOT mounted (the header is the
  // whole block) and the footer/error bands are withheld with it. The
  // chrome's own mount identity is untouched across the toggle ([L26]);
  // only the child subtree appears/disappears.
  const blockCollapse = React.useContext(ToolBlockCollapseContext);
  const blockCollapsed = blockCollapse !== null && blockCollapse.collapsed;
  // The id for `data-tool-use-id`: the collapse handle when wrapped,
  // else the dispatch-level context the transcript provides around
  // every top-level tool — so the attribute is present on every tool
  // root, not just collapsed ones ([P01]).
  const toolUseIdFromContext = React.useContext(ToolUseIdContext);
  const toolUseId = blockCollapse?.toolUseId ?? toolUseIdFromContext ?? undefined;
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

    // Coalesce the callback write via rAF to avoid "ResizeObserver loop
    // completed with undelivered notifications" — the write sets a CSS
    // var consumed by sticky descendant chrome, whose relayout can queue
    // a sibling observer notification within the same delivery pass.
    let rafId = 0;
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
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        write(next);
      });
    });
    observer.observe(header);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
    // Re-measure across a collapse toggle: the one `ToolCallHeader` keeps
    // its `headerRef` in both states, but its height changes (summary↔meta,
    // body appears/disappears), so the observer re-runs to refresh the
    // telescoping-pin variable once the block opens or closes.
  }, [blockCollapsed]);

  // ONE header for every tool, in every state — the Quiet Line
  // `ToolCallHeader`. There is no fork: the same component renders whether
  // the block is collapsed (header is the whole block), expanded (header
  // above the mounted body), or a tool that never collapses (no chevron).
  // `disclosure` is non-null only for history-collapse-wrapped blocks
  // ([P06] table); it selects the chevron + summary-vs-meta presentation.
  // The body's own self-fold is suppressed for those blocks so the header
  // chevron is the single fold (no double-dip). No left-edge status stripe
  // anywhere — the lifecycle dot carries status.
  const disclosure =
    blockCollapse !== null
      ? { collapsed: blockCollapse.collapsed, onToggle: blockCollapse.toggle }
      : undefined;

  return (
    <div
      ref={rootRef}
      data-slot={rootSlot}
      data-status={status}
      data-caution={caution?.reason ?? undefined}
      data-block-collapsed={blockCollapsed ? "true" : undefined}
      data-tool-use-id={toolUseId}
      className={cn("tool-block-chrome", className)}
    >
      <ToolCallHeader
        ref={headerRef}
        phase={phase ?? statusToPhase(status)}
        toolName={toolName}
        icon={toolIcon}
        showIcon={showIcon}
        target={command ?? identity ?? argsSummary}
        summary={resultSummary}
        meta={meta}
        caution={caution}
        // The header owns Copy in both states. Prefer a wrapper's tailored
        // `copyText` (body-bits wrappers compute a formatted payload); fall
        // back to the collapse handle's command+result markdown.
        copyText={copyText ?? blockCollapse?.copyText}
        disclosure={disclosure}
        actionsSlotRef={setActionsTarget}
      />
      {blockCollapsed ? null : (
        <BlockFoldSuppressedContext.Provider value={blockCollapse !== null}>
          <div className="tool-block-chrome-body" data-slot="tool-block-body">
            <ChromeActionsTargetContext.Provider value={actionsTarget}>
              {children}
            </ChromeActionsTargetContext.Provider>
          </div>
          {status === "error" && errorMessage !== undefined ? (
            <div className="tool-block-chrome-error" data-slot="tool-block-error">
              {errorMessage}
            </div>
          ) : null}
          {footerBadges !== undefined ? (
            <div className="tool-block-chrome-footer" data-slot="tool-block-footer">
              {footerBadges}
            </div>
          ) : null}
        </BlockFoldSuppressedContext.Provider>
      )}
    </div>
  );
};
