/**
 * `ToolCallHeader` — the one designed-once header every tool-call block
 * wears ([D01] of roadmap/tool-call-header.md).
 *
 * Before the regularization, 21 wrappers each hand-rolled the header
 * inside `ToolBlockChrome`: a streaming ring floating in the body, a
 * border stripe nobody read as state, atom chips that clipped, single-
 * line ellipsized commands, and five different idioms for counts. This
 * component collapses all of that into a single structured header:
 *
 *   Row 1 (identity):  [dot] [icon?] Name  <identity>  <meta>  <caution> [actions]
 *   Row 2 (command):   <command — full, wrapping, never truncated>
 *
 * Pieces:
 *  - **Lifecycle dot** ([D02]/[D03]). A leftmost
 *    `TugProgressIndicator variant="pulsing-dot"` driven by `phase`
 *    through {@link toolCallPhaseVisual} — the single authoritative
 *    state signal (in-flight → awaiting → success / error / interrupted).
 *    Replaces the in-body streaming ring AND demotes the chrome's
 *    border stripe to secondary.
 *  - **Icon** ([D07]). Per-tool glyph from the central
 *    {@link toolIconFor} registry, suppressible via `showIcon={false}`
 *    when it would crowd the dot.
 *  - **Name**. One typographic treatment (`--tugx-toolheader-name-*`).
 *  - **Identity**. The single-row identifier — a path atom-chip, a short
 *    label. Chips align to the line-box without clipping ([D04]).
 *  - **Command**. A full, wrapping, non-truncating row for command-shaped
 *    args (bash / grep / cron) ([D05]). Absent for chip-identity tools.
 *  - **Meta**. The trailing metadata cluster — counts / diff-stats /
 *    truncated, all via the shared [D06] primitives ([Q02]: header, not
 *    footer).
 *  - **Actions slot**. The trailing host body kinds portal their resting
 *    affordances into. Published to the chrome via `actionsSlotRef` so
 *    the chrome's `ChromeActionsTargetContext` keeps working unchanged.
 *
 * The root forwards a ref (the chrome's `ResizeObserver` measures it for
 * telescoping-pin height) and is a sticky strip so it pins under an
 * outer pin context exactly as the old `.tool-block-chrome-header` did.
 *
 * Laws:
 *  - [L02] `phase` arrives via props from the consumer's store read.
 *  - [L06] all visible state lives on `data-phase` / the dot's own DOM;
 *    no React state drives appearance here.
 *  - [L13] the dot's motion runs through the indicator's TugAnimator path.
 *  - [L19] file pair (`.tsx` + `.css`), module docstring, exported props,
 *    `data-slot="tool-call-header"`.
 *  - [L20] owns the `--tugx-toolheader-*` token family; reuses the shared
 *    `--tugx-block-strip-*` surface tokens for chrome-consistent framing.
 *
 * @module components/tugways/cards/tool-blocks/tool-call-header
 */

import "./tool-call-header.css";

import React from "react";

import { cn } from "@/lib/utils";
import { DevCautionBadge } from "@/components/tugways/chrome/dev-caution-badge";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import {
  TOOL_CALL_PHASE_LABELS,
  toolCallPhaseVisual,
  type ToolCallPhase,
} from "@/lib/code-session-store/tool-call-phase-visual";

import { toolIconFor } from "./tool-icons";
import type { CautionFlag } from "./types";

/** Glyph-box diameter of the lifecycle dot, in CSS px. */
const DOT_SIZE = 14;

export interface ToolCallHeaderProps {
  /**
   * Lifecycle phase the leftmost dot paints ([D03]). Defaults to
   * `idle` (the quiet resting pose) so a standalone/gallery mount that
   * doesn't compute a phase still renders a sane dot.
   */
  phase?: ToolCallPhase;
  /** Canonical tool name shown in the header (e.g. "Bash"). */
  toolName: string;
  /**
   * Explicit icon node. When omitted and `showIcon` is true, the icon
   * is resolved from the central {@link toolIconFor} registry by
   * `toolName`. Pass `null` with `showIcon` true to render no icon for
   * a tool the registry would otherwise give a glyph.
   */
  icon?: React.ReactNode;
  /**
   * Whether to render the per-tool icon at all ([D07]). Defaults to
   * `true`. Set `false` on surfaces where the icon would crowd the
   * leftmost dot.
   */
  showIcon?: boolean;
  /**
   * Single-row identity content — a path atom-chip, a short label. Sits
   * on the identity row after the name and shrinks/ellipsizes there;
   * for full command text use `command` instead.
   */
  identity?: React.ReactNode;
  /**
   * Command-shaped args rendered in full on their own wrapping row, never
   * truncated ([D05]). Use for bash commands, grep patterns, cron
   * expressions. Omit for chip-identity tools.
   */
  command?: React.ReactNode;
  /**
   * Trailing metadata cluster — counts, diff-stats, truncated flags via
   * the shared [D06] primitives. Rendered at the identity row's trailing
   * edge, before the actions slot.
   */
  meta?: React.ReactNode;
  /** Drift caution surfaced as an inline badge on the identity row. */
  caution?: CautionFlag;
  /**
   * Content rendered inside the actions slot (the chrome's copy / fold
   * cluster for body-bits wrappers). Body kinds composed under the
   * chrome portal into the slot node instead — see `actionsSlotRef`.
   */
  actions?: React.ReactNode;
  /**
   * Callback receiving the actions-slot DOM node. The chrome captures it
   * and republishes it through `ChromeActionsTargetContext` so embedded
   * body kinds can `createPortal` their affordances into the header.
   */
  actionsSlotRef?: (node: HTMLDivElement | null) => void;
  /** Forwarded class name. */
  className?: string;
}

/**
 * The tool-call header. `ref` targets the root strip — the chrome
 * measures it with a `ResizeObserver` for telescoping-pin height.
 */
export const ToolCallHeader = React.forwardRef<
  HTMLDivElement,
  ToolCallHeaderProps
>(function ToolCallHeader(
  {
    phase = "idle",
    toolName,
    icon,
    showIcon = true,
    identity,
    command,
    meta,
    caution,
    actions,
    actionsSlotRef,
    className,
  },
  ref,
) {
  // Resolve the icon node: explicit `icon` wins (including an explicit
  // `null` for "no icon"); otherwise the registry decides by name.
  const iconNode = showIcon
    ? icon !== undefined
      ? icon
      : toolIconFor(toolName)
    : null;

  // The detail row carries the per-tool identifier — a command for
  // command-shaped tools, the path chip for file tools. The icon moves
  // DOWN to this row (in the dot's column, same glyph size) so the dot +
  // name share the identity row and the icon + detail share the detail
  // row, with `name` and `detail` aligned on one left margin.
  const detail = command ?? identity;
  const showDetailRow = iconNode !== null || detail !== undefined;

  return (
    <div
      ref={ref}
      data-slot="tool-call-header"
      data-phase={phase}
      className={cn("tool-call-header", className)}
    >
      <div className="tool-call-header-identity" data-slot="tool-call-header-identity">
        <TugProgressIndicator
          variant="pulsing-dot"
          size={DOT_SIZE}
          phase={phase}
          phaseVisual={toolCallPhaseVisual}
          aria-label={TOOL_CALL_PHASE_LABELS[phase]}
          className="tool-call-header-dot"
        />
        <span className="tool-call-header-name">{toolName}</span>
        {meta !== undefined ? (
          <span className="tool-call-header-meta" data-slot="tool-call-header-meta">
            {meta}
          </span>
        ) : null}
        {caution !== undefined ? <DevCautionBadge caution={caution} /> : null}
        {/* Actions slot — always rendered so the published node exists from
         * first paint (the chrome's portal-target context can be non-null
         * on the first descendant render). Layout-only here; the children's
         * own tokens drive their appearance ([L20]). */}
        <div
          ref={actionsSlotRef}
          className="tool-call-header-actions"
          data-slot="tool-block-actions"
        >
          {actions}
        </div>
      </div>
      {showDetailRow ? (
        <div className="tool-call-header-detail" data-slot="tool-call-header-detail">
          {iconNode !== null ? (
            <span className="tool-call-header-icon" aria-hidden="true">
              {iconNode}
            </span>
          ) : null}
          {detail !== undefined ? (
            <span className="tool-call-header-detail-content">{detail}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
