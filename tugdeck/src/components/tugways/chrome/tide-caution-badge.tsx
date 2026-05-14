/**
 * `TideCautionBadge` — small inline drift-caution chip.
 *
 * Surfaces a `CautionFlag` the dispatch raised on a transcript event:
 * an unknown tool name, an unknown `structured_result` shape, or a
 * stream-json version mismatch ([D04] / [Q03]). The chip is the
 * *inline-flag* half of the caution strategy — it marks the offending
 * event in place. The aggregate caution counter on the card chrome
 * (click-through to drift telemetry) is a separate later surface
 * ([#step-21](roadmap/tide-assistant-rendering.md#step-21)); both
 * consume this same component.
 *
 * Extracted from `ToolWrapperChrome`'s private inline badge so the
 * later card-chrome aggregate surface and any bespoke wrapper that
 * needs to flag a shape mismatch compose one component rather than
 * re-deriving the chip. `ToolWrapperChrome` now composes it.
 *
 * The reason detail rides a native `title` tooltip — the chip stays a
 * single, dependency-light `<span>`. A richer hover surface, if ever
 * wanted, is a follow-on; the contract here is "small inline chip,
 * hover shows the reason."
 *
 * Laws:
 *  - [L06] no React state — the chip is pure render from props; the
 *    hover tooltip is the native `title` attribute, not React state.
 *  - [L19] file pair (`.tsx` + `.css`), `data-slot="tide-caution-badge"`,
 *    this docstring.
 *  - [L20] owns the `--tugx-caut-*` slot family; consumes the shared
 *    `--tugx-block-tone-caution-*` tones for the chip surface.
 *
 * @module components/tugways/chrome/tide-caution-badge
 */

import "./tide-caution-badge.css";

import React from "react";

import type { CautionFlag } from "@/components/tugways/cards/tool-wrappers/types";

/** Short human label per caution reason. */
const CAUTION_LABELS: Readonly<Record<CautionFlag["reason"], string>> = {
  unknown_tool: "unknown tool",
  unknown_shape: "unknown shape",
  version_drift: "version drift",
};

export interface TideCautionBadgeProps {
  /** The drift caution to surface. */
  caution: CautionFlag;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

/**
 * Render the inline caution chip. The `title` carries `label: detail`
 * when the dispatch supplied a detail string, else just the label.
 */
export function TideCautionBadge({
  caution,
  className,
}: TideCautionBadgeProps): React.ReactElement {
  const label = CAUTION_LABELS[caution.reason];
  const title =
    caution.detail !== undefined ? `${label}: ${caution.detail}` : label;
  return (
    <span
      data-slot="tide-caution-badge"
      data-caution-reason={caution.reason}
      className={
        className === undefined
          ? "tide-caution-badge"
          : `tide-caution-badge ${className}`
      }
      title={title}
    >
      ⚠ {label}
    </span>
  );
}
