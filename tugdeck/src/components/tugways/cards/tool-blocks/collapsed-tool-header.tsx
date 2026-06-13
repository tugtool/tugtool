/**
 * `CollapsedToolHeader` — the collapsed tool-block header ([P09] Quiet
 * Line, [#step-11]).
 *
 * When a tool block mounts collapsed (the [P06] table), the header IS the
 * whole block. This is the vetted Quiet Line: one calm row —
 *
 *   [dot] [icon] Name  target …  result  [Copy] [⌄]
 *
 * conveying tool + target + a one-line result + lifecycle status, with
 * exactly two always-visible affordances: **Copy** (writes the call's
 * command + result via `copyText`) and **Expand** (the down-chevron). A
 * long target wraps to more rows while the dot, icon, result, and buttons
 * stay on the first row. Color comes only from the lifecycle dot.
 *
 * This is deliberately a SEPARATE component from {@link ToolCallHeader}
 * (the expanded two-row identity + wrapping-command header): the collapsed
 * and expanded presentations are different jobs, so each is its own thing
 * rather than one component branching internally. The chrome chooses which
 * to render by collapse state.
 *
 * Laws:
 *  - [L02] `phase` arrives via props from the consumer's store read.
 *  - [L06] visible state lives on the dot's DOM / `data-phase`; no React
 *    state drives appearance here.
 *  - [L19] file pair (`.tsx` + `.css`), docstring, `data-slot`.
 *  - [L20] owns the `--tugx-collapsedheader-*` token family; reuses the
 *    shared `--tugx-block-*` surface/text tones for chrome-consistent framing.
 *
 * @module components/tugways/cards/tool-blocks/collapsed-tool-header
 */

import "./collapsed-tool-header.css";

import React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { DevCautionBadge } from "@/components/tugways/chrome/dev-caution-badge";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import {
  TOOL_CALL_PHASE_LABELS,
  toolCallPhaseVisual,
  type ToolCallPhase,
} from "@/lib/code-session-store/tool-call-phase-visual";

import { toolIconFor } from "./tool-icons";
import {
  formatToolResultSummary,
  type ToolResultSummary,
} from "./tool-result-summary";
import type { CautionFlag } from "./types";

/** Glyph-box diameter of the lifecycle dot, in CSS px (matches the icon). */
const DOT_SIZE = 14;

export interface CollapsedToolHeaderProps {
  /** Lifecycle phase the leftmost dot paints. */
  phase: ToolCallPhase;
  /** Canonical tool name (e.g. "Bash"). */
  toolName: string;
  /**
   * Explicit icon node. When omitted and `showIcon` is true, resolved from
   * the central {@link toolIconFor} registry by `toolName`.
   */
  icon?: React.ReactNode;
  /** Whether to render the per-tool icon. Defaults to `true`. */
  showIcon?: boolean;
  /**
   * The call's target — a path atom-chip (file tools) or the command text
   * (command tools). Chips size themselves; command text wraps to more
   * rows when long.
   */
  target?: React.ReactNode;
  /** One-line result summary, as data; rendered quietly. */
  summary?: ToolResultSummary;
  /** Drift caution surfaced as an inline badge. */
  caution?: CautionFlag;
  /**
   * Markdown for the whole call (command + result) — what Copy writes
   * ([P09]). When absent/empty, no Copy button renders.
   */
  copyText?: string;
  /**
   * Whether the block is collapsed. The Quiet Line header is the tool
   * block's header in BOTH states (the body renders below it when
   * expanded), so the chevron flips: DOWN to expand when collapsed, UP
   * to collapse when expanded.
   */
  collapsed: boolean;
  /** Flip the collapse boolean (the chrome owns the state). */
  onToggle: (next: boolean) => void;
}

/** The collapsed tool-block header — one quiet row. */
export const CollapsedToolHeader = React.forwardRef<
  HTMLDivElement,
  CollapsedToolHeaderProps
>(function CollapsedToolHeader(
  { phase, toolName, icon, showIcon = true, target, summary, caution, copyText, collapsed, onToggle },
  ref,
) {
  const iconNode = showIcon ? (icon !== undefined ? icon : toolIconFor(toolName)) : null;
  const hasCopy = copyText !== undefined && copyText.length > 0;

  return (
    <div
      ref={ref}
      data-slot="collapsed-tool-header"
      data-phase={phase}
      data-collapsed={collapsed ? "true" : undefined}
      className="collapsed-tool-header"
    >
      <TugProgressIndicator
        variant="pulsing-dot"
        size={DOT_SIZE}
        phase={phase}
        phaseVisual={toolCallPhaseVisual}
        aria-label={TOOL_CALL_PHASE_LABELS[phase]}
        className="collapsed-tool-header-dot"
      />
      {iconNode !== null ? (
        <span className="collapsed-tool-header-icon" aria-hidden="true">
          {iconNode}
        </span>
      ) : null}
      <span className="collapsed-tool-header-main">
        <span className="collapsed-tool-header-name">{toolName}</span>
        {target !== undefined ? (
          <span className="collapsed-tool-header-detail">{target}</span>
        ) : null}
      </span>
      {summary !== undefined ? (
        <span className="collapsed-tool-header-summary" data-slot="collapsed-tool-summary">
          {formatToolResultSummary(summary)}
        </span>
      ) : null}
      {caution !== undefined ? <DevCautionBadge caution={caution} /> : null}
      <span className="collapsed-tool-header-actions">
        {hasCopy ? (
          <BlockCopyButton
            subtype="icon"
            size="xs"
            getText={() => copyText ?? ""}
            aria-label={`Copy ${toolName} command and result`}
            data-slot="collapsed-tool-copy"
          />
        ) : null}
        <span
          className="collapsed-tool-header-expand"
          data-slot="collapsed-tool-expand"
          data-collapsed={collapsed ? "true" : undefined}
        >
          {/* Same primitive + size as the Copy button (icon / ghost / 2xs)
              so the two affordances are pixel-identical at rest and on
              hover. */}
          <TugPushButton
            subtype="icon"
            emphasis="ghost"
            size="xs"
            icon={<ChevronDown />}
            aria-label={
              collapsed ? `Expand ${toolName} tool call` : `Collapse ${toolName} tool call`
            }
            onClick={() => onToggle(!collapsed)}
          />
        </span>
      </span>
    </div>
  );
});
