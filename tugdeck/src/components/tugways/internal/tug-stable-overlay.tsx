/**
 * TugStableOverlay — width/height-stabilizing overlay primitive.
 *
 * Stacks an `active` variant and one or more hidden `alternates` in a single
 * CSS-grid cell. The cell sizes to the max-content of every variant, so the
 * visible `active` paints while the alternates stay `visibility: hidden` but
 * still hold their footprint. The result: the box's intrinsic size is stable
 * across a swap between any of the variants — the smallest CSS primitive that
 * means "stack these and size to the widest/tallest."
 *
 * Shared by the controls that swap their face in place:
 *   - `TugButton` — label / icon-text-cluster swap (`widthStabilize`).
 *   - `TugBadge`  — two-line route-face swap (`widthStabilize`).
 *
 * Why grid, not absolute positioning: an absolutely-positioned alternate
 * leaves layout flow, so the cell would size to `active` only — defeating the
 * mechanism. Grid keeps every variant in flow at the same `grid-area`.
 *
 * Laws: [L06] appearance via CSS, [L19] file pair, [L20] owns only its own
 * layout box — the variants it wraps keep their own tokens.
 *
 * @module components/tugways/internal/tug-stable-overlay
 */

import "./tug-stable-overlay.css";

import React from "react";
import { cn } from "@/lib/utils";

export interface TugStableOverlayProps {
  /** The visible variant — the one that paints and receives interaction. */
  active: React.ReactNode;
  /**
   * Hidden variants that hold layout footprint so the cell reserves the
   * widest/tallest of all variants. Rendered `visibility: hidden` +
   * `aria-hidden` + `pointer-events: none`.
   */
  alternates: React.ReactNode[];
  /** Extra class on the overlay root. */
  className?: string;
  /** Forwarded `data-slot` for the overlay root. */
  "data-slot"?: string;
}

/**
 * Overlays `active` over `alternates` in one grid cell, sizing to the widest.
 * See the module docstring for the mechanism and the contract.
 */
export function TugStableOverlay({
  active,
  alternates,
  className,
  ...rest
}: TugStableOverlayProps): React.ReactElement {
  return (
    <span className={cn("tug-stable-overlay", className)} {...rest}>
      <span className="tug-stable-overlay-variant" data-tug-stable="active">
        {active}
      </span>
      {alternates.map((alt, i) => (
        <span
          // Alternates are positional + hidden sizers; index keys are stable
          // for this fixed-order list.
          key={i}
          className="tug-stable-overlay-variant"
          data-tug-stable="alternate"
          aria-hidden="true"
        >
          {alt}
        </span>
      ))}
    </span>
  );
}
