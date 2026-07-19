/**
 * TugProgressPulsingDot — Internal building block for the dot + pulsing-ring glyph.
 *
 * App code should use {@link TugProgressIndicator} instead.
 *
 * Two visible elements clocked independently:
 *
 *   - **Dot** — a small solid circle, always visible. Its color resolves
 *     from the parent's live `--tugx-progress-indicator-fill`, so the core
 *     recolors instantly on a state change. Its diameter shrinks while
 *     `state === "stopped"` or `"aborted"` so the resting indicator reads
 *     quiet.
 *   - **Ring** — a thin circle border around the dot. While
 *     `state === "running"` it runs a chain of finite one-shot pulses that
 *     scale + fade the ring outward (`ring.animate(...)`, ease-out, 1600ms).
 *
 * **Pulse integrity — guaranteed by construction, not CSS timing.** A pulse
 * is a finite WAAPI one-shot; a WAAPI animation runs to its `.finished`
 * unless it is explicitly `.cancel()`ed, and the only cancel here is on
 * unmount. So a state change mid-pulse can never truncate it:
 *   - **Never truncated.** Leaving `running` does not touch the in-flight
 *     pulse. When it finishes, the chain reads `latestStateRef` and either
 *     starts the next pulse (still running) or hides the ring (settled) —
 *     so the pulse always completes before the ring goes static.
 *   - **Frozen tone.** `--tugx-progress-indicator-fill` is a live variable,
 *     so a mid-pulse tone change (a role shift, or the `running` cobalt
 *     override dropping) would recolor the pulse in flight. Each pulse
 *     snapshots the resolved ring color to an inline `border-color` at its
 *     start, freezing that pulse's tone; the new tone lands on the next
 *     pulse.
 *
 * The pulses are raw `element.animate()` — NOT the TugAnimator wrapper,
 * whose `commitStyles()` on every `.finished` forced a whole-tree
 * compositing recompute per pulse (the lag this glyph caused). Raw one-shots
 * of `transform`/`opacity` run on the compositor with no per-frame main-
 * thread work and no `commitStyles`.
 *
 * Laws: [L02] state arrives via props from the parent indicator;
 *       [L06] the dot's tone is a live CSS variable; the ring's display and
 *       frozen tone are driven imperatively (inline style), never React
 *       state;
 *       [L13] the ring pulse needs per-pulse completion + tone snapshotting,
 *       so it is programmatic motion (WAAPI one-shots), not a declarative
 *       CSS loop — but raw `animate()`, without TugAnimator's commit.
 *
 * @module components/tugways/internal/tug-progress-pulsing-dot
 */

import "./tug-progress-pulsing-dot.css";

import React, { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { getTugTiming, isTugMotionEnabled } from "@/components/tugways/scale-timing";
import type { TugProgressIndicatorState } from "../tug-progress-indicator";

const PULSE_DURATION_MS = 1600;

const PULSE_KEYFRAMES: Keyframe[] = [
  { transform: "translate(-50%, -50%) scale(0.85)", opacity: 0.7 },
  { transform: "translate(-50%, -50%) scale(1.9)", opacity: 0 },
];

const IDLE_DOT_SCALE = 0.85;

function isAnimating(state: TugProgressIndicatorState): boolean {
  return state === "running";
}

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
  const ringRef = useRef<HTMLSpanElement | null>(null);
  const pulseRef = useRef<Animation | null>(null);
  // Read at each pulse boundary (not closure-captured) so an in-flight chain
  // sees the latest state without restarting.
  const latestStateRef = useRef<TugProgressIndicatorState>(state);
  latestStateRef.current = state;

  const hideRing = useCallback(() => {
    const ring = ringRef.current;
    if (ring === null) return;
    ring.style.display = "none";
    ring.style.borderColor = "";
  }, []);

  // Run one finite pulse, then chain from its `.finished`. The pulse is a
  // raw WAAPI one-shot — it completes on its own clock and is never cut by a
  // state change (only unmount cancels it).
  const startPulse = useCallback(() => {
    const ring = ringRef.current;
    if (ring === null) return;
    ring.style.display = "block";
    // Freeze this pulse's tone: snapshot the resolved ring color to inline,
    // so a later change to the live fill variable can't recolor it in flight.
    // Clearing first lets the read see the current live tone.
    ring.style.borderColor = "";
    ring.style.borderColor = getComputedStyle(ring).borderColor;

    const pulse = ring.animate(PULSE_KEYFRAMES, {
      duration: PULSE_DURATION_MS * getTugTiming(),
      easing: "ease-out",
    });
    pulseRef.current = pulse;

    pulse.finished.then(
      () => {
        if (pulseRef.current !== pulse) return; // superseded
        pulseRef.current = null;
        if (isAnimating(latestStateRef.current) && isTugMotionEnabled()) {
          startPulse();
        } else {
          hideRing();
        }
      },
      () => {
        if (pulseRef.current === pulse) pulseRef.current = null;
      },
    );
  }, [hideRing]);

  useEffect(() => {
    const ring = ringRef.current;
    if (ring === null) return;

    if (isAnimating(state)) {
      if (!isTugMotionEnabled()) {
        // Reduced motion: a static ring, no pulse chain.
        pulseRef.current?.cancel();
        pulseRef.current = null;
        ring.style.display = "block";
        ring.style.borderColor = "";
        return;
      }
      // Start a chain only if none is in flight; an in-flight chain keeps
      // going via latestStateRef.
      if (pulseRef.current === null) startPulse();
    } else if (pulseRef.current === null) {
      // Not running and nothing pulsing → settle now. When a pulse IS in
      // flight, leave it: its `.finished` hides the ring so it is never cut.
      hideRing();
    }
  }, [state, startPulse, hideRing]);

  // Unmount: cancel the in-flight pulse so its `.finished` chain does not
  // fire into a gone element.
  useEffect(() => {
    return () => {
      pulseRef.current?.cancel();
      pulseRef.current = null;
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
