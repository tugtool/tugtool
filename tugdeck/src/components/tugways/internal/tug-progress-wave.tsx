/**
 * TugProgressWave — Internal building block for the three-bar wave glyph.
 *
 * App code should use {@link TugProgressIndicator} instead.
 *
 * Three vertical bars rendered as a tight horizontal stack. When
 * `state === "running"`, the bars pulse in staggered sequence via
 * `TugAnimator.group()`: each bar runs a finite WAAPI one-shot that
 * scales Y from a rest pose to a peak pose; the group's `.finished`
 * resolves only when the last bar completes, providing a clean cycle
 * boundary.
 *
 * State semantics:
 *   running   — bars pulse in staggered cycles.
 *   paused    — bars hold at rest pose; any in-flight cycle completes
 *               cleanly and no new cycle starts.
 *   stopped   — bars static at the short-long-short rest pose.
 *   completed — bars static at peak pose (all tall).
 *   aborted   — bars static at rest pose; danger tint from the parent.
 *
 * Laws: [L02] state arrives via props from the parent indicator;
 *       [L06] toggles drive `data-state` on the root; the bar pulses are
 *       owned by TugAnimator at group boundaries;
 *       [L13] motion runs through TugAnimator (WAAPI) — finite one-shot
 *       pulses bundled by `group()`. No CSS `animation: ... infinite`.
 *
 * @module components/tugways/internal/tug-progress-wave
 */

import "./tug-progress-wave.css";

import React, { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import {
  group,
  type TugAnimationGroup,
} from "@/components/tugways/tug-animator";
import type { TugProgressIndicatorState } from "../tug-progress-indicator";

const DEFAULT_CYCLE_MS = 960;
const PULSE_WINDOW_RATIO = 600 / 960;
const PULSE_STAGGER_RATIO = 180 / 960;
const BAR_COUNT = 3;
const SHRINK_TO = 0.5;
const SIDE_BAR_RATIO = 0.5;
const BAR_WIDTH_RATIO = 0.15;
const GAP_TO_WIDTH_RATIO = 0.8;

function isRunning(state: TugProgressIndicatorState): boolean {
  return state === "running";
}

/** Gap (px) between bars given a bar width (px). Exported for tests. */
export function gapForBarWidth(barWidthPx: number): number {
  return barWidthPx * GAP_TO_WIDTH_RATIO;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Resolve the per-bar (rest, peak) scaleY pair. The middle bar (index 1)
 * sits at 1.0 and dips to `SHRINK_TO` at the pulse peak; the outer bars
 * (index 0, 2) sit at `SIDE_BAR_RATIO` and grow toward 1.0. The inverse
 * motion produces the "wave" silhouette. Exported for tests.
 */
export function barScales(index: number): { restScale: number; peakScale: number } {
  if (index === 1) return { restScale: 1, peakScale: clamp01(SHRINK_TO) };
  return { restScale: clamp01(SIDE_BAR_RATIO), peakScale: 1 };
}

/**
 * Per-bar pose for static states. Rest pose = short-long-short; peak
 * pose (`completed`) = all bars at 1.0. Exported for tests.
 */
export function staticScale(index: number, state: TugProgressIndicatorState): number {
  if (state === "completed") return 1;
  return barScales(index).restScale;
}

function buildBarKeyframes(index: number): Keyframe[] {
  const startOffset = index * PULSE_STAGGER_RATIO;
  const midOffset = startOffset + PULSE_WINDOW_RATIO / 2;
  const endOffset = startOffset + PULSE_WINDOW_RATIO;
  const { restScale, peakScale } = barScales(index);
  return [
    { offset: 0, transform: `scaleY(${restScale})` },
    { offset: clamp01(startOffset), transform: `scaleY(${restScale})` },
    { offset: clamp01(midOffset), transform: `scaleY(${peakScale})` },
    { offset: clamp01(endOffset), transform: `scaleY(${restScale})` },
    { offset: 1, transform: `scaleY(${restScale})` },
  ];
}

export interface TugProgressWaveProps {
  /** Bar height in CSS px. @default 16 */
  size?: number;
  /** Lifecycle state. @default "running" */
  state?: TugProgressIndicatorState;
  /** When true, opacity dims. */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugProgressWave = React.forwardRef<
  HTMLSpanElement,
  TugProgressWaveProps
>(function TugProgressWave(
  { size = 16, state = "running", disabled = false, className },
  forwardedRef,
) {
  const barRefs = useRef<Array<HTMLSpanElement | null>>(
    new Array(BAR_COUNT).fill(null),
  );
  const groupRef = useRef<TugAnimationGroup | null>(null);
  const latestStateRef = useRef<TugProgressIndicatorState>(state);
  latestStateRef.current = state;

  // Start one staggered pulse cycle across all three bars. The group's
  // `.finished` resolves when the LAST bar completes; on resolution,
  // read `latestStateRef` and decide whether to chain another cycle.
  const startCycle = useCallback(() => {
    const g = group({ duration: DEFAULT_CYCLE_MS, easing: "ease-in-out" });
    groupRef.current = g;
    let scheduled = 0;
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const el = barRefs.current[i];
      if (el === null) continue;
      g.animate(el, buildBarKeyframes(i), {
        duration: DEFAULT_CYCLE_MS,
        easing: "ease-in-out",
      });
      scheduled += 1;
    }
    if (scheduled === 0) {
      groupRef.current = null;
      return;
    }
    g.finished
      .then(() => {
        if (groupRef.current !== g) return;
        groupRef.current = null;
        if (isRunning(latestStateRef.current)) startCycle();
      })
      .catch(() => {
        if (groupRef.current === g) groupRef.current = null;
      });
  }, []);

  useEffect(() => {
    if (!isRunning(state)) return;
    if (groupRef.current !== null) return;
    startCycle();
  }, [state, startCycle]);

  useEffect(() => {
    return () => {
      const g = groupRef.current;
      if (g !== null) {
        g.cancel("snap-to-end");
        groupRef.current = null;
      }
    };
  }, []);

  const barWidthPx = size * BAR_WIDTH_RATIO;
  const barGapPx = gapForBarWidth(barWidthPx);
  const rootStyle: React.CSSProperties = {
    ["--tugx-progress-wave-size" as string]: `${size}px`,
    ["--tugx-progress-wave-bar-width" as string]: `${barWidthPx}px`,
    ["--tugx-progress-wave-bar-gap" as string]: `${barGapPx}px`,
  };

  return (
    <span
      ref={forwardedRef}
      data-slot="tug-progress-wave"
      data-state={state}
      aria-hidden="true"
      style={rootStyle}
      className={cn(
        "tug-progress-wave",
        disabled && "tug-progress-wave-disabled",
        className,
      )}
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const restScale = staticScale(i, state);
        return (
          <span
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            className="tug-progress-wave-bar"
            // Seed the bar's rest pose so the silhouette renders
            // correctly on first paint (before WAAPI's first keyframe).
            // Also the source of truth while paused/stopped/completed.
            style={{
              transformOrigin: "center bottom",
              transform: `scaleY(${restScale})`,
            }}
          />
        );
      })}
    </span>
  );
});
