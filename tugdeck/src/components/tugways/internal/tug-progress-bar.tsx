/**
 * TugProgressBar — Internal building block for the horizontal progress bar.
 *
 * App code should use TugProgress instead.
 *
 * Renders a track with a fill region. When value is undefined (indeterminate),
 * the fill shows animated barber-pole diagonal stripes. When value is a number
 * (determinate), the fill shows a solid color at the proportional width.
 * The transition between modes is CSS-driven [L06, L13].
 *
 * Color is inherited from the parent's --tugx-progress-fill CSS variable.
 * Track background uses --tug7-surface-progress-primary-normal-default-rest.
 *
 * Laws: [L06] fill width via inline style, [L13] CSS keyframes only,
 *       [L16] pairings declared, [L19] component authoring guide
 */

import React, { useRef, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import "./tug-progress-bar.css";

export type TugProgressBarSize = "sm" | "md" | "lg";

export interface TugProgressBarProps {
  /** Progress value, 0 to max. Undefined = indeterminate (barber-pole). */
  value?: number;
  /** Maximum value. @default 1 */
  max?: number;
  /** Size variant. Controls track height.
   *  @selector .tug-progress-bar-sm | .tug-progress-bar-md | .tug-progress-bar-lg
   *  @default "md" */
  size?: TugProgressBarSize;
  /** When true, animation freezes and opacity dims. */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugProgressBar = React.forwardRef<HTMLDivElement, TugProgressBarProps>(
  function TugProgressBar({ value, max = 1, size = "md", disabled = false, className }, ref) {
    const isDeterminate = value !== undefined;
    const percentage = isDeterminate
      ? Math.min(Math.max((value / max) * 100, 0), 100)
      : 0;

    // Track mode changes to suppress transition on indeterminate → determinate switch [L06]
    const prevDeterminateRef = useRef(isDeterminate);
    const fillRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const wasDeterminate = prevDeterminateRef.current;
      prevDeterminateRef.current = isDeterminate;

      // Switching from indeterminate to determinate: suppress width transition
      // so the fill snaps to position instead of animating from 100% → value
      if (!wasDeterminate && isDeterminate && fillRef.current) {
        fillRef.current.style.transition = "none";
        // Re-enable after one frame so subsequent value updates animate
        requestAnimationFrame(() => {
          if (fillRef.current) {
            fillRef.current.style.transition = "";
          }
        });
      }
    }, [isDeterminate]);

    return (
      <div
        ref={ref}
        data-slot="tug-progress-bar"
        aria-hidden="true"
        className={cn(
          "tug-progress-bar-track",
          `tug-progress-bar-${size}`,
          disabled && "tug-progress-bar-disabled",
          className,
        )}
      >
        <div
          ref={fillRef}
          className={cn(
            "tug-progress-bar-fill",
            !isDeterminate && "tug-progress-bar-indeterminate",
          )}
          style={isDeterminate ? { width: `${percentage}%` } : undefined}
        />
      </div>
    );
  },
);
