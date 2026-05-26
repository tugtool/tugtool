/**
 * TugProgressSpinner — Internal building block for the simple rotor glyph.
 *
 * App code should use {@link TugProgressIndicator} instead.
 *
 * Renders a single ~115° stroked SVG arc that rotates continuously while
 * `state === "running"`. Replaces the previous eight-petal design with a
 * quieter, more conventional rotor.
 *
 * State semantics:
 *   running   — arc rotates.
 *   paused    — arc frozen mid-rotation.
 *   stopped   — closed track-colored circle, no rotation (quiescent).
 *   completed — closed circle stroked in the indicator fill color.
 *   aborted   — closed circle (danger tint comes from the parent via
 *               `--tugx-progress-indicator-fill`).
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

const STROKE_WIDTH = 3;
const RADIUS = 16 - STROKE_WIDTH / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// ~32% of the circumference visible (≈115°). Slim enough to read as a
// rotor but not so thin that it gets lost on small sizes.
const RUNNING_VISIBLE_OFFSET = CIRCUMFERENCE * 0.68;

export const TugProgressSpinner = React.forwardRef<HTMLSpanElement, TugProgressSpinnerProps>(
  function TugProgressSpinner(
    { size = 16, state = "running", disabled = false, className },
    ref,
  ) {
    const isActiveMotion = state === "running" || state === "paused";

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
          disabled && "tug-progress-spinner-disabled",
          className,
        )}
      >
        <svg className="tug-progress-spinner-svg" viewBox="0 0 32 32">
          <circle
            className="tug-progress-spinner-arc"
            cx="16"
            cy="16"
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={isActiveMotion ? RUNNING_VISIBLE_OFFSET : 0}
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  },
);
