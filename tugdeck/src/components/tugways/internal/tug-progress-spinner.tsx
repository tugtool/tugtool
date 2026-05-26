/**
 * TugProgressSpinner — Internal building block for the classic 12-spoke spinner.
 *
 * App code should use {@link TugProgressIndicator} instead.
 *
 * Renders twelve radial capsule spokes around an empty center — the
 * familiar macOS-style indeterminate spinner. Each spoke fades from
 * full opacity to a quiet rest opacity over one cycle, staggered by
 * `(i / 12) * duration` so the "leading" (full-opacity) spoke walks
 * around the ring.
 *
 * State semantics:
 *   running   — staggered opacity walks around the ring.
 *   paused    — animation frozen mid-cycle.
 *   stopped   — every spoke at rest opacity (quiescent visible ring).
 *   completed — every spoke at full opacity.
 *   aborted   — same pose as stopped; the danger tint comes from the
 *               parent via `--tugx-progress-indicator-fill`.
 *
 * Geometry (SVG viewBox 0 0 100 100): each spoke is a rounded rect
 * positioned vertically above the center, from inner radius 18 to
 * outer radius 48 (units of the 100×100 viewBox). Width 10. The
 * inner radius leaves a small empty center; spokes occupy most of
 * the host radius so the glyph reads at parity with the ring / pie
 * variants at the same `size`.
 *
 * Color is inherited from the parent's `--tugx-progress-indicator-fill`.
 *
 * Laws: [L06] appearance via CSS, [L13] CSS keyframes only,
 *       [L16] pairings declared, [L19] component authoring guide
 */

import React from "react";
import { cn } from "@/lib/utils";
import "./tug-progress-spinner.css";
import type { TugProgressIndicatorState } from "../tug-progress-indicator";

export interface TugProgressSpinnerProps {
  /** Diameter in CSS px. @default 16 */
  size?: number;
  /** Lifecycle state. @default "running" */
  state?: TugProgressIndicatorState;
  /** When true, opacity dims and animation freezes. */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

const SPOKE_COUNT = 12;
const SPOKES = Array.from({ length: SPOKE_COUNT }, (_, i) => i);

// SVG viewBox is 100×100. Spoke is a vertical rounded rect above the
// center, from inner radius (18) to outer radius (48). Width 9.
const INNER = 24;
const OUTER = 48;
const SPOKE_WIDTH = 9;
const SPOKE_HEIGHT = OUTER - INNER;
const SPOKE_X = 50 - SPOKE_WIDTH / 2;
const SPOKE_Y = 50 - OUTER;
const SPOKE_RADIUS = SPOKE_WIDTH / 2;

export const TugProgressSpinner = React.forwardRef<HTMLSpanElement, TugProgressSpinnerProps>(
  function TugProgressSpinner(
    { size = 16, state = "running", disabled = false, className },
    ref,
  ) {
    return (
      <span
        ref={ref}
        data-slot="tug-progress-spinner"
        data-state={state}
        aria-hidden="true"
        style={{ width: `${size}px`, height: `${size}px` }}
        className={cn(
          "tug-progress-spinner",
          state === "running" && "tug-progress-spinner-running",
          state === "paused" && "tug-progress-spinner-paused",
          state === "completed" && "tug-progress-spinner-completed",
          disabled && "tug-progress-spinner-disabled",
          className,
        )}
      >
        <svg viewBox="0 0 100 100" className="tug-progress-spinner-svg">
          {SPOKES.map((i) => (
            <rect
              key={i}
              className="tug-progress-spinner-spoke"
              x={SPOKE_X}
              y={SPOKE_Y}
              width={SPOKE_WIDTH}
              height={SPOKE_HEIGHT}
              rx={SPOKE_RADIUS}
              ry={SPOKE_RADIUS}
              transform={`rotate(${i * (360 / SPOKE_COUNT)} 50 50)`}
              style={{
                animationDelay: `calc(${-(SPOKE_COUNT - i) / SPOKE_COUNT} * var(--tugx-progress-spinner-cycle))`,
              }}
            />
          ))}
        </svg>
      </span>
    );
  },
);
