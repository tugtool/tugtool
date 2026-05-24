/**
 * TugProgressRing — Internal building block for the circular arc progress indicator.
 *
 * App code should use TugProgress instead.
 *
 * Renders an SVG ring with two circles: a background track and a foreground arc.
 * When value is undefined (indeterminate), a partial arc segment rotates continuously.
 * When value is a number (determinate), the arc grows from 0° to 360° proportional
 * to value/max. Arc length is controlled via stroke-dashoffset set imperatively [L06].
 *
 * Color is inherited from the parent's --tugx-progress-fill CSS variable.
 * Track uses --tug7-surface-progress-primary-normal-default-rest.
 *
 * Laws: [L06] arc offset via inline style, [L13] CSS keyframes only,
 *       [L16] pairings declared, [L19] component authoring guide
 */

import React, { useRef, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import "./tug-progress-ring.css";

export type TugProgressRingSize = "sm" | "md" | "lg";

export interface TugProgressRingProps {
  /** Progress value, 0 to max. Undefined = indeterminate (rotating arc). */
  value?: number;
  /** Maximum value. @default 1 */
  max?: number;
  /** Size variant. Controls ring diameter and stroke width.
   *  @selector .tug-progress-ring-sm | .tug-progress-ring-md | .tug-progress-ring-lg
   *  @default "md" */
  size?: TugProgressRingSize;
  /** When true, animation freezes and opacity dims. */
  disabled?: boolean;
  /**
   * When true, the ring renders as a closed outlined circle with no
   * animation — distinct from both indeterminate (rotating partial
   * arc) and disabled (dimmed). Use to communicate a quiescent state
   * where there is genuinely no work to indicate (e.g. a Tasks
   * indicator with no active tasks). Overrides `value` rendering;
   * the arc draws full circumference (no break) and the indeterminate
   * animation is suppressed.
   * @default false
   */
  stopped?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

const STROKE_WIDTH = 3;
const RADIUS = 16 - STROKE_WIDTH / 2; // 14.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~91.1

export const TugProgressRing = React.forwardRef<HTMLSpanElement, TugProgressRingProps>(
  function TugProgressRing({ value, max = 1, size = "md", disabled = false, stopped = false, className }, ref) {
    // `stopped` overrides both indeterminate and determinate
    // rendering: the arc draws the full circumference (offset 0) and
    // the `tug-progress-ring-indeterminate` class is suppressed so
    // the rotating-spin keyframe does not apply. Determinate mode is
    // independent of `stopped` — when `stopped` is false the `value`
    // / `max` semantics behave as before.
    const isDeterminate = value !== undefined;
    const fraction = isDeterminate
      ? Math.min(Math.max(value / max, 0), 1)
      : 0;
    const dashOffset = stopped
      ? 0
      : isDeterminate
        ? CIRCUMFERENCE * (1 - fraction)
        : undefined;

    // Track mode changes to suppress transition on indeterminate → determinate switch [L06]
    const prevDeterminateRef = useRef(isDeterminate);
    const arcRef = useRef<SVGCircleElement>(null);

    useLayoutEffect(() => {
      const wasDeterminate = prevDeterminateRef.current;
      prevDeterminateRef.current = isDeterminate;

      if (!wasDeterminate && isDeterminate && arcRef.current) {
        arcRef.current.style.transition = "none";
        requestAnimationFrame(() => {
          if (arcRef.current) {
            arcRef.current.style.transition = "";
          }
        });
      }
    }, [isDeterminate]);

    return (
      <span
        ref={ref}
        data-slot="tug-progress-ring"
        aria-hidden="true"
        className={cn(
          "tug-progress-ring",
          `tug-progress-ring-${size}`,
          !stopped && !isDeterminate && "tug-progress-ring-indeterminate",
          stopped && "tug-progress-ring-stopped",
          disabled && "tug-progress-ring-disabled",
          className,
        )}
      >
        <svg
          className="tug-progress-ring-svg"
          viewBox="0 0 32 32"
        >
          {/* Background track circle */}
          <circle
            className="tug-progress-ring-track"
            cx="16"
            cy="16"
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE_WIDTH}
          />
          {/* Foreground arc */}
          <circle
            ref={arcRef}
            className="tug-progress-ring-arc"
            cx="16"
            cy="16"
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={stopped || isDeterminate ? dashOffset : undefined}
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  },
);
