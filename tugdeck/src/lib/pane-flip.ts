/**
 * pane-flip.ts — the math behind the imposer's settle motion.
 *
 * When the deck's arrangement changes, the frames' final geometry is committed
 * in one layout pass and the crossing is a transform tween that starts at the
 * inverse of the move and ends at nothing (FLIP). This module is the pure half
 * of that: the delta between where a frame was and where it now is, and the
 * keyframes that walk one back to the other. `deck-canvas.tsx` does the
 * measuring and the animating.
 *
 * ## The form these keyframes are written in, and why it is not negotiable
 *
 * WebKit runs a transform animation on the compositor — costing one whole-page
 * compositing walk when it starts and one when it ends, and nothing at all in
 * between — only when the effect is *completely* accelerated. An effect that
 * misses that bar is resolved on the main thread instead, and every frame of it
 * commits a style change that walks the page again. The difference is the whole
 * reason this module exists rather than a `transition` in a stylesheet; it is
 * measured and written up in `roadmap/jul30-perf-brief.md#i1-sparkline-exception`.
 *
 * Clearing the bar means: keyframes touching **only** transform-family
 * properties, transforms that are strictly 2D, a **keyword** easing, playback
 * rate 1, forward, finite. Every one of those is a rule about this file.
 *
 * The sharpest of them is the easing. A `linear(…)` with a list of stops — the
 * form {@link cssEasing} produces — cannot be expressed by Core Animation, so
 * WebKit declines to accelerate anything wearing one. The pulsing dot fought
 * this and left its receipt in `tug-progress-pulsing-dot.css`: the same loop
 * measured 18.0% of a core with a sampled `linear()` easing and 0.9% without.
 * So the spring here rides in the **keyframe offsets** instead — many frames
 * under a plain `linear` keyword trace the identical curve, and that shape a
 * compositor can run. Do not "simplify" this into an easing string.
 *
 * @module lib/pane-flip
 */

import { dampedSpring } from "@/lib/unit-functions";

/** Where a frame moved to, from where it was. */
export interface FlipDelta {
  /** Horizontal distance in CSS pixels, positive rightward. */
  dx: number;
  /** Vertical distance in CSS pixels, positive downward. */
  dy: number;
}

/**
 * How many intervals {@link springKeyframes} cuts the curve into.
 *
 * A sampled curve is off from the real one by the gap between it and its
 * chords, which falls as the square of the count. At 32 the spring's steepest
 * stretch is under a hundredth of the travel, and only in passing — well inside
 * a pixel over any distance the deck moves a frame.
 */
export const SPRING_KEYFRAME_SAMPLES = 32;

/**
 * The distance from a frame's old position to its new one.
 *
 * Only the origin is read. Size is deliberately ignored: an arrangement change
 * moves frames without resizing them — a pane's rendered width comes from its
 * own stored size and its vertical run is the gap-to-gap column, neither of
 * which an imposition-kind swap, a Lens side flip, or a slot reassignment
 * touches. A width change that happens to land in the same window snaps, which
 * is honest; interpolating it would take the tween out of the transform-only
 * form the module docstring describes.
 */
export function flipDelta(
  first: DOMRectReadOnly,
  last: DOMRectReadOnly,
): FlipDelta {
  return { dx: first.left - last.left, dy: first.top - last.top };
}

/**
 * The keyframes that carry a frame from `(dx, dy)` back to where it belongs.
 *
 * The first frame is the full inverse delta — the frame's old position, painted
 * from its new one — and the last is exactly no transform at all. In between,
 * the offsets are evenly spaced and the values follow a critically damped
 * spring, so the frame accelerates away, decelerates onto its place, and stops
 * there without running past it.
 *
 * Both endpoints are pinned rather than sampled: a curve a hair off at its ends
 * leaves a frame a hair off its place, and the final keyframe being exactly
 * `translate(0px, 0px)` is what makes cancelling the tween safe at any moment —
 * there is no wrong pose to snap to.
 */
export function springKeyframes(
  dx: number,
  dy: number,
  samples: number = SPRING_KEYFRAME_SAMPLES,
): Keyframe[] {
  const steps = Math.max(2, Math.floor(samples));
  const spring = dampedSpring();
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const offset = i / steps;
    const progress = i === 0 ? 0 : i === steps ? 1 : spring(offset);
    const remaining = 1 - progress;
    frames.push({
      transform: `translate(${formatPx(dx * remaining)}px, ${formatPx(dy * remaining)}px)`,
      offset,
    });
  }
  return frames;
}

/** Three decimals is finer than a device pixel, and the rest is only length. */
function formatPx(value: number): string {
  return String(Number(value.toFixed(3)));
}
