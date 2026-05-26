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
 *   - **Ring** — a thin circle border around the dot, animated by
 *     TugAnimator as a chain of finite one-shot pulses while
 *     `state === "running"`. Each pulse runs to completion on its own
 *     clock; the chain reads the latest state via a ref at every
 *     boundary and either starts another pulse or stops (when the
 *     latest state is static).
 *
 * The "pulse completes in its starting tone" guarantee falls out of
 * pulses being finite one-shots. Mid-pulse state changes leave the
 * in-flight pulse untouched; the new tone takes over on the next pulse
 * in the chain, or the ring vanishes if the new state is static.
 *
 * Laws: [L02] state arrives via props from the parent indicator;
 *       [L06] tone changes go through DOM (CSS variable on the dot,
 *       imperative style on the ring), never React state;
 *       [L13] motion runs through TugAnimator (WAAPI) — finite one-shot
 *       pulses chained on `.finished`. No CSS `animation: ... infinite`;
 *       no manual `animationend` listeners.
 *
 * @module components/tugways/internal/tug-progress-pulsing-dot
 */

import "./tug-progress-pulsing-dot.css";

import React, { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import {
  animate,
  type TugAnimation,
} from "@/components/tugways/tug-animator";
import type { TugProgressIndicatorState } from "../tug-progress-indicator";

const PULSE_DURATION_MS = 1600;

const PULSE_KEYFRAMES: Keyframe[] = [
  { transform: "translate(-50%, -50%) scale(0.85)", opacity: 0.7 },
  { transform: "translate(-50%, -50%) scale(1.9)", opacity: 0 },
];

const IDLE_DOT_SCALE = 0.6;

function isAnimating(state: TugProgressIndicatorState): boolean {
  return state === "running";
}

function isQuiet(state: TugProgressIndicatorState): boolean {
  return state === "stopped" || state === "aborted";
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
  const ringRef = useRef<HTMLSpanElement | null>(null);
  const pulseRef = useRef<TugAnimation | null>(null);
  const latestStateRef = useRef<TugProgressIndicatorState>(state);
  latestStateRef.current = state;

  // Start one finite WAAPI pulse on the ring and chain on `.finished` —
  // read the LATEST state via `latestStateRef` (not closure capture) and
  // decide whether to start the next pulse or stop.
  const startPulse = useCallback(() => {
    const el = ringRef.current;
    if (el === null) return;
    el.style.display = "block";

    const anim = animate(el, PULSE_KEYFRAMES, {
      duration: PULSE_DURATION_MS,
      easing: "ease-out",
    });
    pulseRef.current = anim;

    anim.finished
      .then(() => {
        pulseRef.current = null;
        if (isAnimating(latestStateRef.current)) {
          startPulse();
        } else if (ringRef.current !== null) {
          ringRef.current.style.display = "none";
        }
      })
      .catch(() => {
        pulseRef.current = null;
      });
  }, []);

  // Kickoff: when state flips to running and no pulse is in flight,
  // start a new chain. Otherwise leave any in-flight chain alone; the
  // boundary handler reads `latestStateRef` and decides.
  useEffect(() => {
    if (pulseRef.current !== null) return;
    if (!isAnimating(state)) return;
    startPulse();
  }, [state, startPulse]);

  // Unmount: cancel the in-flight pulse so its `.then` does not fire
  // after the ring element is gone.
  useEffect(() => {
    return () => {
      const anim = pulseRef.current;
      if (anim !== null) {
        anim.cancel("snap-to-end");
        pulseRef.current = null;
      }
    };
  }, []);

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
      <span ref={ringRef} className="tug-progress-pulsing-dot-ring" />
    </span>
  );
});
