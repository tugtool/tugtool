/**
 * TugProgressPulsingDot — Internal building block for the dot + pulsing-ring glyph.
 *
 * App code should use {@link TugProgressIndicator} instead.
 *
 * Two visible elements clocked independently:
 *
 *   - **Dot** — a small solid circle, always visible. The dot's color
 *     resolves from the parent's `--tugx-progress-indicator-fill`. The
 *     dot's diameter shrinks while `state === "stopped"` or `"aborted"`
 *     so the resting indicator reads quiet.
 *   - **Ring** — a thin circle border around the dot. While
 *     `state === "running"` it runs a continuous `scale` + `opacity`
 *     pulse (`tugx-progress-pulsing-dot-pulse`, ease-out, 1600ms loop);
 *     otherwise it is hidden and the static outer ring (`::after`) shows.
 *
 * Laws: [L02] state arrives via props from the parent indicator;
 *       [L06] tone changes go through DOM (CSS variable on the dot);
 *       state drives `data-state` on the root, which gates the ring's
 *       display and pulse;
 *       [L13] the continuous pulse is a CSS `@keyframes` loop; motion-off
 *       is handled by the global `body[data-tug-motion="off"]` duration
 *       rule, resting the ring at its base pose.
 *
 * @module components/tugways/internal/tug-progress-pulsing-dot
 */

import "./tug-progress-pulsing-dot.css";

import React from "react";

import { cn } from "@/lib/utils";
import type { TugProgressIndicatorState } from "../tug-progress-indicator";

const IDLE_DOT_SCALE = 0.85;

/**
 * `stopped` and `completed` paint a reduced-size dot — these are the
 * two "settled" poses (nothing happening, or work finished). `paused`
 * and `aborted` keep the full-size dot so the held / canceled signal
 * reads as prominent.
 */
function isQuiet(state: TugProgressIndicatorState): boolean {
  return state === "stopped" || state === "completed";
}

export interface TugProgressPulsingDotProps {
  /** Glyph box diameter in CSS px. @default 16 */
  size?: number;
  /** Lifecycle state. @default "running" */
  state?: TugProgressIndicatorState;
  /** When true, opacity dims. */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugProgressPulsingDot = React.forwardRef<
  HTMLSpanElement,
  TugProgressPulsingDotProps
>(function TugProgressPulsingDot(
  { size = 16, state = "running", disabled = false, className },
  forwardedRef,
) {
  const quiet = isQuiet(state);
  const rootStyle: React.CSSProperties = {
    ["--tugx-progress-pulsing-dot-size" as string]: `${size}px`,
    ["--tugx-progress-pulsing-dot-dot-size" as string]: quiet
      ? `${(size / 2) * IDLE_DOT_SCALE}px`
      : `${size / 2}px`,
  };

  return (
    <span
      ref={forwardedRef}
      data-slot="tug-progress-pulsing-dot"
      data-state={state}
      aria-hidden="true"
      style={rootStyle}
      className={cn(
        "tug-progress-pulsing-dot",
        disabled && "tug-progress-pulsing-dot-disabled",
        className,
      )}
    >
      <span className="tug-progress-pulsing-dot-dot" />
      <span className="tug-progress-pulsing-dot-ring" />
    </span>
  );
});
