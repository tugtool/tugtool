/**
 * `ToolCallHeader` — the one header every tool-call block wears, in every
 * state (the vetted Quiet Line).
 *
 * One calm row carries tool + target + a trailing result + lifecycle
 * status:
 *
 *   [dot] Name  target …  <result>  | [actions] [⌄]
 *
 * The SAME component renders whether the block is collapsed (header is
 * the whole block), expanded (header above a mounted body), or a tool
 * that never collapses (no chevron). There is no second header component
 * and no fork in the chrome — so the collapsed and expanded presentations
 * cannot drift apart. A long target wraps to more rows while the dot,
 * trailing result, and actions stay on the first row; color comes
 * only from the lifecycle dot (no left-edge status stripe).
 *
 * The trailing result is one quiet one-line `summary`, rendered the same
 * way in both states, so collapsed and expanded read identically.
 *
 * State differences, all driven by `disclosure` (absent ⇒ not
 * collapsible, always expanded):
 *  - **Actions**: the header owns Copy (the call's command + result, from
 *    `copyText`) and the whole-block chevron, both visible in BOTH states
 *    so the affordance cluster reads identically collapsed or expanded.
 *    When expanded it also exposes the actions-slot DOM node via
 *    `actionsSlotRef` so a body kind can `createPortal` its body-specific,
 *    expanded-only controls (Find, view-mode, expand-all) into the slot,
 *    where they sit LEFT of Copy. Body kinds no longer portal their own
 *    Copy or block-level fold — the header owns those.
 *  - **Chevron**: present when collapsible; DOWN to expand (collapsed),
 *    UP to collapse (expanded).
 *
 * Laws:
 *  - [L02] `phase` arrives via props from the consumer's store read.
 *  - [L06] visible state lives on `data-phase` / `data-collapsed` / the
 *    dot's own DOM; no React state drives appearance here.
 *  - [L13] the dot's motion runs through the indicator's TugAnimator path.
 *  - [L19] file pair (`.tsx` + `.css`), docstring, `data-slot`.
 *  - [L20] owns the `--tugx-toolheader-*` token family; reuses the shared
 *    `--tugx-block-*` surface/text tones for chrome-consistent framing.
 *
 * @module components/tugways/cards/tool-blocks/tool-call-header
 */

import "./tool-call-header.css";

import React from "react";

import { cn } from "@/lib/utils";
import { DevCautionBadge } from "@/components/tugways/chrome/dev-caution-badge";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import {
  TOOL_CALL_PHASE_LABELS,
  toolCallPhaseVisual,
  type ToolCallPhase,
} from "@/lib/code-session-store/tool-call-phase-visual";

import {
  formatToolResultSummary,
  toolResultSummaryRole,
  type ToolResultSummary,
} from "./tool-result-summary";
import type { CautionFlag } from "./types";

/** Glyph-box diameter of the lifecycle dot, in CSS px (matches the icon). */
const DOT_SIZE = 14;

export interface ToolCallHeaderProps {
  /**
   * Lifecycle phase the leftmost dot paints. Defaults to `idle` (the
   * quiet resting pose) so a standalone/gallery mount that doesn't
   * compute a phase still renders a sane dot.
   */
  phase?: ToolCallPhase;
  /** Canonical tool name (e.g. "Bash"). */
  toolName: string;
  /**
   * The call's target — a path atom-chip (file tools) or the command text
   * (command tools). Chips size themselves; command text wraps to more
   * rows when long. Wrappers pass `command ?? identity`.
   */
  target?: React.ReactNode;
  /**
   * One-line result summary as DATA — the single trailing-info element,
   * rendered quietly (plain muted text) in BOTH states. Tools supply it
   * via `resultSummary` on the chrome.
   */
  summary?: ToolResultSummary;
  /** Drift caution surfaced as an inline badge. */
  caution?: CautionFlag;
  /**
   * Markdown for the whole call (command + result) — what the built-in
   * Copy writes in the COLLAPSED state, where the body isn't mounted to
   * supply its own. When absent/empty, no built-in Copy renders.
   * A `() => string` thunk defers the (potentially large) serialization
   * to the moment Copy is actually pressed.
   */
  copyText?: string | (() => string);
  /**
   * History-collapse chevron + state. When set, the chevron renders at the
   * trailing edge (DOWN to expand when collapsed, UP to collapse when
   * expanded) and `collapsed` selects the built-in Copy (collapsed) vs the
   * body-specific actions slot (expanded). Omit for tools that never
   * collapse — they render no chevron and are always expanded.
   */
  disclosure?: { collapsed: boolean; onToggle: (next: boolean) => void };
  /**
   * Content rendered inside the actions slot in the EXPANDED state — the
   * chrome's copy / fold cluster for body-bits wrappers. Embedded body
   * kinds portal into the slot node instead (see `actionsSlotRef`).
   */
  actions?: React.ReactNode;
  /**
   * Callback receiving the actions-slot DOM node (EXPANDED state). The
   * chrome captures it and republishes it through
   * `ChromeActionsTargetContext` so embedded body kinds can `createPortal`
   * their affordances into the header.
   */
  actionsSlotRef?: (node: HTMLDivElement | null) => void;
  /** Forwarded class name. */
  className?: string;
}

/**
 * The tool-call header — one quiet row. `ref` targets the root strip; the
 * chrome measures it with a `ResizeObserver` for telescoping-pin height.
 */
export const ToolCallHeader = React.forwardRef<
  HTMLDivElement,
  ToolCallHeaderProps
>(function ToolCallHeader(
  {
    phase = "idle",
    toolName,
    target,
    summary,
    caution,
    copyText,
    disclosure,
    actions,
    actionsSlotRef,
    className,
  },
  ref,
) {
  const collapsible = disclosure !== undefined;
  const collapsed = disclosure?.collapsed === true;
  const hasCopy =
    copyText !== undefined &&
    (typeof copyText === "function" || copyText.length > 0);

  return (
    <div
      ref={ref}
      data-slot="tool-call-header"
      data-phase={phase}
      data-collapsed={collapsed ? "true" : undefined}
      className={cn("tool-call-header", className)}
    >
      <TugProgressIndicator
        variant="pulsing-dot"
        size={DOT_SIZE}
        phase={phase}
        phaseVisual={toolCallPhaseVisual}
        aria-label={TOOL_CALL_PHASE_LABELS[phase]}
        className="tool-call-header-dot"
      />
      <span className="tool-call-header-name">{toolName}</span>
      {/* The detail column is always present — it holds the target (chip
          or wrapping command) and otherwise serves as the flexible spacer
          that pushes the trailing result + actions to the right edge. */}
      <span className="tool-call-header-detail">{target}</span>
      {/* Trailing result — one quiet one-line summary as a TugBadge,
          rendered identically in BOTH states so collapsed and expanded
          read the same. The badge's own padding guarantees a clear gap
          from the detail text (which used to run into the plain summary),
          and its role carries pass/fail signal: a nonzero exit reads
          danger, exit 0 success, every other kind neutral data. */}
      {summary !== undefined ? (
        <span className="tool-call-header-summary" data-slot="tool-call-header-summary">
          <TugBadge
            emphasis="tinted"
            role={toolResultSummaryRole(summary)}
            size="2xs"
          >
            {formatToolResultSummary(summary)}
          </TugBadge>
        </span>
      ) : null}
      {caution !== undefined ? <DevCautionBadge caution={caution} /> : null}
      <span className="tool-call-header-actions">
        {/* Body-specific, expanded-only controls (Find, view-mode,
            expand-all) portal into this slot, sitting LEFT of the
            header-owned Copy + chevron. Present only when expanded (the
            body is mounted); the published node lets a body kind's
            `createPortal` find a target on its first render. The header
            owns Copy + whole-block fold, so body kinds no longer portal
            those — see the body-kind affordance composition. */}
        {!collapsed ? (
          <div
            ref={actionsSlotRef}
            className="tool-call-header-actions-slot"
            data-slot="tool-block-actions"
          >
            {actions}
          </div>
        ) : null}
        {/* Copy + Expand are the two standard header affordances —
            icon-only (the `icon` subtype of the shared `BlockCopyButton`
            / `BlockFoldCue`) and both at the `xs` scale so they read as a
            matched pair and stay quiet across a run of blocks. The
            icon+text forms of the same components serve the body kinds'
            expanded controls. */}
        {hasCopy ? (
          <BlockCopyButton
            subtype="icon"
            size="xs"
            getText={
              typeof copyText === "function" ? copyText : () => copyText ?? ""
            }
            aria-label={`Copy ${toolName} command and result`}
            data-slot="tool-call-header-copy"
          />
        ) : null}
        {collapsible ? (
          <BlockFoldCue
            collapsed={collapsed}
            onToggle={(next) => disclosure?.onToggle(next)}
            collapsedLabel="Expand"
            expandedLabel="Collapse"
            ariaLabelExpand={`Expand ${toolName} tool call`}
            ariaLabelCollapse={`Collapse ${toolName} tool call`}
            size="xs"
            subtype="icon"
            // Whole-block collapse uses the same scroll machinery as every
            // body-fold cue (the default `stabilizeScroll`): release the
            // host's follow-bottom lock before the toggle so the cell-height
            // ResizeObserver flush finds `shouldAutoPin` false and does not
            // slam to the bottom, and position-stabilize the clicked header
            // so it holds its viewport position across the height change.
            data-slot="tool-call-header-disclosure"
          />
        ) : null}
      </span>
    </div>
  );
});
