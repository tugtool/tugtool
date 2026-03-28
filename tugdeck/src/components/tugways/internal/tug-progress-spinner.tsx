/**
 * TugProgressSpinner — Internal building block for the petals ring animation.
 *
 * App code should use TugProgress instead.
 *
 * Renders an 8-petal ring that animates continuously. Color is inherited from
 * the parent's --tugx-progress-fill CSS variable. Size is controlled via the
 * size prop. Does not handle ARIA, labels, or mode logic — those are owned
 * by the parent TugProgress component [L20].
 *
 * Laws: [L06] appearance via CSS, [L13] CSS keyframes only, [L16] pairings declared,
 *       [L19] component authoring guide
 */

import React from "react";
import { cn } from "@/lib/utils";
import "./tug-progress-spinner.css";

export type TugProgressSpinnerSize = "sm" | "md" | "lg";

export interface TugProgressSpinnerProps {
  /** Size variant. Controls the petals ring diameter.
   *  @selector .tug-progress-spinner-sm | .tug-progress-spinner-md | .tug-progress-spinner-lg
   *  @default "md" */
  size?: TugProgressSpinnerSize;
  /** When true, animation freezes and opacity dims. */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugProgressSpinner = React.forwardRef<HTMLSpanElement, TugProgressSpinnerProps>(
  function TugProgressSpinner({ size = "md", disabled = false, className }, ref) {
    return (
      <span
        ref={ref}
        data-slot="tug-progress-spinner"
        aria-hidden="true"
        className={cn(
          "tug-progress-spinner",
          `tug-progress-spinner-${size}`,
          disabled && "tug-progress-spinner-disabled",
          className,
        )}
      >
        <span className="tug-progress-spinner-petal" />
        <span className="tug-progress-spinner-petal" />
        <span className="tug-progress-spinner-petal" />
        <span className="tug-progress-spinner-petal" />
        <span className="tug-progress-spinner-petal" />
        <span className="tug-progress-spinner-petal" />
        <span className="tug-progress-spinner-petal" />
        <span className="tug-progress-spinner-petal" />
      </span>
    );
  },
);
