/**
 * TugProgressPie — Internal building block for the filled pie wedge progress indicator.
 *
 * App code should use TugProgress instead.
 *
 * Renders a circular div with conic-gradient that fills clockwise from 12 o'clock.
 * When value is undefined (indeterminate), a ~25% wedge rotates continuously.
 * When value is a number (determinate), the wedge angle is set via a CSS custom
 * property imperatively [L06].
 *
 * Color is inherited from the parent's --tugx-progress-fill CSS variable.
 * Track uses --tug7-surface-progress-primary-normal-default-rest.
 *
 * Laws: [L06] angle via inline CSS variable, [L13] CSS keyframes only,
 *       [L16] pairings declared, [L19] component authoring guide
 */

import React, { useRef, useLayoutEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import "./tug-progress-pie.css";

export type TugProgressPieSize = "sm" | "md" | "lg";

export interface TugProgressPieProps {
  /** Progress value, 0 to max. Undefined = indeterminate (rotating wedge). */
  value?: number;
  /** Maximum value. @default 1 */
  max?: number;
  /** Size variant. Controls pie diameter.
   *  @selector .tug-progress-pie-sm | .tug-progress-pie-md | .tug-progress-pie-lg
   *  @default "md" */
  size?: TugProgressPieSize;
  /** When true, animation freezes and opacity dims. */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugProgressPie = React.forwardRef<HTMLSpanElement, TugProgressPieProps>(
  function TugProgressPie({ value, max = 1, size = "md", disabled = false, className }, ref) {
    const isDeterminate = value !== undefined;
    const angle = isDeterminate
      ? Math.min(Math.max(value / max, 0), 1) * 360
      : 0;

    // Track mode changes to suppress transition on indeterminate → determinate switch [L06]
    const prevDeterminateRef = useRef(isDeterminate);
    const pieRef = useRef<HTMLSpanElement>(null);

    useLayoutEffect(() => {
      const wasDeterminate = prevDeterminateRef.current;
      prevDeterminateRef.current = isDeterminate;

      if (!wasDeterminate && isDeterminate && pieRef.current) {
        pieRef.current.style.transition = "none";
        requestAnimationFrame(() => {
          if (pieRef.current) {
            pieRef.current.style.transition = "";
          }
        });
      }
    }, [isDeterminate]);

    // Merge internal pieRef with forwarded ref
    const setRef = useCallback(
      (el: HTMLSpanElement | null) => {
        (pieRef as React.MutableRefObject<HTMLSpanElement | null>).current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLSpanElement | null>).current = el;
      },
      [ref],
    );

    return (
      <span
        ref={setRef}
        data-slot="tug-progress-pie"
        aria-hidden="true"
        className={cn(
          "tug-progress-pie",
          `tug-progress-pie-${size}`,
          !isDeterminate && "tug-progress-pie-indeterminate",
          disabled && "tug-progress-pie-disabled",
          className,
        )}
        style={
          isDeterminate
            ? ({ "--tug-progress-pie-angle": `${angle}deg` } as React.CSSProperties)
            : undefined
        }
      />
    );
  },
);
