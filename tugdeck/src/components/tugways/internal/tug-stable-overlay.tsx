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
 * ## High-water mark — re-stabilize larger, never shrink
 *
 * The declared variants set the *baseline* reservation. But a live `active`
 * value can exceed every alternate (an unanticipated label longer than the
 * sizers). When that happens the cell must **grow to fit and stay grown** — a
 * subsequent narrower value must not let it shrink back, or the box reflows on
 * the way down. So the overlay tracks the widest content it has ever held and
 * pins a `min-width` to it (monotonic). The reservation only ever increases:
 * stabilization that re-stabilizes larger ex-post-facto. Pure DOM — a
 * `ResizeObserver` measures and a `min-width` is written directly, no React
 * state ([L06] appearance via DOM, [L22] observe/mutate without a render).
 *
 * Laws: [L06] appearance via CSS/DOM, [L19] file pair, [L20] owns only its own
 * layout box — the variants it wraps keep their own tokens.
 *
 * @module components/tugways/internal/tug-stable-overlay
 */

import "./tug-stable-overlay.css";

import React, { useLayoutEffect, useRef } from "react";
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
  const rootRef = useRef<HTMLSpanElement | null>(null);
  // The widest content footprint seen so far, in px. Monotonic — the reserved
  // `min-width` only grows, so a value larger than the original sizers locks the
  // box at the larger size and a later narrower value cannot shrink it back.
  const highWaterRef = useRef(0);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      // Natural content width = the widest variant child. Children size to their
      // own content (the `min-width` we pin on the root never inflates them), so
      // this reads the true required width independent of the current
      // reservation. Grow the high-water mark + the pinned `min-width`; never
      // shrink ([L22] DOM observe/mutate, no React state).
      let widest = 0;
      for (const child of Array.from(el.children)) {
        const w = (child as HTMLElement).offsetWidth;
        if (w > widest) widest = w;
      }
      if (widest > highWaterRef.current) {
        highWaterRef.current = widest;
        el.style.minWidth = `${widest}px`;
      }
    };
    measure();
    // Observe the root: it grows whenever the widest child exceeds the current
    // reservation, which is exactly when the high-water mark must advance.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={rootRef}
      className={cn("tug-stable-overlay", className)}
      {...rest}
    >
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
