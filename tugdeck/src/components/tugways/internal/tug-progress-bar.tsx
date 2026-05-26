/**
 * TugProgressBar — Internal building block for the horizontal progress bar.
 *
 * App code should use {@link TugProgressIndicator} instead.
 *
 * Renders a track with a fill region.
 *
 * State semantics:
 *   running   — value undefined: barber-pole indeterminate fill animation.
 *               value set: fill drawn at fraction.
 *   paused    — animation paused at current pose.
 *   stopped   — fill hidden (zero width); only the track is visible.
 *   completed — fill at 100%.
 *   aborted   — fill drawn at value (if any) or hidden; danger tint comes
 *               from the parent via `--tugx-progress-indicator-fill`.
 *
 * Track height: `--tugx-progress-indicator-size` (parent-set). Width fills
 * the parent container.
 *
 * Color is inherited from the parent's `--tugx-progress-indicator-fill`.
 * Track uses `--tug7-surface-progress-primary-normal-default-rest`.
 *
 * Laws: [L06] fill width via inline style, [L13] CSS keyframes only,
 *       [L16] pairings declared, [L19] component authoring guide
 */

import React, { useRef, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import "./tug-progress-bar.css";
import type { TugProgressIndicatorState } from "../tug-progress-indicator";

export interface TugProgressBarProps {
  /** Determinate progress value, 0 to max. Undefined = indeterminate. */
  value?: number;
  /** Maximum value. @default 1 */
  max?: number;
  /** Track height in CSS px. @default 6 */
  size?: number;
  /** Lifecycle state. @default "running" */
  state?: TugProgressIndicatorState;
  /** When true, opacity dims and animation freezes. */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugProgressBar = React.forwardRef<HTMLDivElement, TugProgressBarProps>(
  function TugProgressBar(
    { value, max = 1, size = 6, state = "running", disabled = false, className },
    ref,
  ) {
    const isDeterminate = value !== undefined;
    const fraction = isDeterminate
      ? Math.min(Math.max(value / max, 0), 1)
      : 0;

    let widthPct: number | undefined;
    if (state === "completed") {
      widthPct = 100;
    } else if (state === "stopped") {
      widthPct = 0;
    } else if (isDeterminate) {
      widthPct = fraction * 100;
    } else if (state === "aborted") {
      widthPct = 0;
    }

    const isIndeterminate =
      !isDeterminate && (state === "running" || state === "paused");

    // Suppress the width transition on indeterminate → determinate switch [L06].
    const prevDeterminateRef = useRef(isDeterminate);
    const fillRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const wasDeterminate = prevDeterminateRef.current;
      prevDeterminateRef.current = isDeterminate;

      if (!wasDeterminate && isDeterminate && fillRef.current) {
        fillRef.current.style.transition = "none";
        requestAnimationFrame(() => {
          if (fillRef.current) {
            fillRef.current.style.transition = "";
          }
        });
      }
    }, [isDeterminate]);

    const sizeStyle: React.CSSProperties = {
      height: `${size}px`,
    };

    return (
      <div
        ref={ref}
        data-slot="tug-progress-bar"
        data-state={state}
        aria-hidden="true"
        style={sizeStyle}
        className={cn(
          "tug-progress-bar-track",
          state === "paused" && "tug-progress-bar-paused",
          disabled && "tug-progress-bar-disabled",
          className,
        )}
      >
        <div
          ref={fillRef}
          className={cn(
            "tug-progress-bar-fill",
            isIndeterminate && state === "running" && "tug-progress-bar-indeterminate",
          )}
          style={widthPct !== undefined ? { width: `${widthPct}%` } : undefined}
        />
      </div>
    );
  },
);
