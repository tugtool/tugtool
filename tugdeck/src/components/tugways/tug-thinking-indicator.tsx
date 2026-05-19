/**
 * TugThinkingIndicator -- three-bar "thinking" indicator.
 *
 * Three vertical bars rendered as a tight horizontal stack. When
 * `animating` is true, the bars pulse in staggered sequence via
 * `TugAnimator.group()`: each bar runs a finite WAAPI one-shot that
 * fades the opacity + scales Y from 1 → ~0.4 → 1; the group's
 * `.finished` resolves only when the last bar completes, providing
 * a clean cycle boundary without inventing any new event mechanism.
 *
 * When `animating` is false, the bars sit at the rest layer —
 * visible, full opacity, no motion. Mid-cycle toggles off let the
 * in-flight group run to completion; the chain then declines to
 * start the next group. Toggles back on start a new group.
 *
 * Laws: [L02] state arrives via props from the consumer's
 *       `useSyncExternalStore` subscription — this component owns
 *       no reducer-derived state.
 *       [L06] toggle changes go through DOM (the `data-animating`
 *       attribute on the root drives any CSS that depends on the
 *       toggle; the bar's pulse is owned by TugAnimator). No React
 *       state for appearance.
 *       [L13] motion runs through TugAnimator (WAAPI) — finite one-
 *       shot pulses bundled by `group()`. No CSS `animation: ...
 *       infinite`; no manual `animationend` / `animationiteration`
 *       listeners.
 *       [L16] every color rule is self-paired (`.tug-thinking-
 *       indicator-bar` sets `background-color`; `.tug-thinking-
 *       indicator-label` sets `color`).
 *       [L17] every `--tugx-thinking-indicator-*` alias resolves to
 *       a `--tug7-*` base token in one hop.
 *       [L19] component authoring guide (file pair, module
 *       docstring, `data-slot`, `@selector` / `@default` on every
 *       CSS-targetable prop, `forwardRef`, `...rest` spread, merged
 *       `style`).
 *       [L20] owns its `--tugx-thinking-indicator-*` sub-family
 *       exclusively; does not reach into any other component's
 *       token namespace.
 *
 * @module components/tugways/tug-thinking-indicator
 */

import "./tug-thinking-indicator.css";

import React, { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import {
  group,
  type TugAnimationGroup,
} from "@/components/tugways/tug-animator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TugThinkingIndicatorLabelPosition = "left" | "right" | "hidden";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Default label text when the consumer omits `label` and the
 *  position is not `"hidden"`. */
export const TUG_THINKING_INDICATOR_DEFAULT_LABEL = "Thinking…";

/**
 * Resolve the visible-label text: the consumer's `label` prop wins
 * if provided; otherwise the default {@link
 * TUG_THINKING_INDICATOR_DEFAULT_LABEL}. Exported for unit tests so
 * the resolution rule is pin-able without a render.
 */
export function thinkingIndicatorLabelText(override?: string): string {
  if (override !== undefined) return override;
  return TUG_THINKING_INDICATOR_DEFAULT_LABEL;
}

/**
 * Is the visible label slot rendered for this `labelPosition`?
 * Exported so paired siblings and tests can dispatch on the same
 * mapping without re-deriving the rule.
 */
export function thinkingIndicatorLabelVisible(
  position: TugThinkingIndicatorLabelPosition,
): boolean {
  return position !== "hidden";
}

// ---------------------------------------------------------------------------
// Pulse parameters
// ---------------------------------------------------------------------------

/**
 * Default cycle duration (ms). The total time one staggered group
 * cycle takes from first-bar start to last-bar finish. Tuned so
 * the pulse reads as deliberate without dragging; consumers may
 * override via the `cycleMs` prop (gallery exposes a slider).
 */
const DEFAULT_CYCLE_MS = 960;

/**
 * Per-bar pulse window as a ratio of the cycle. Each bar spends
 * `PULSE_WINDOW_RATIO * cycleMs` ms in the rest → pulsed → rest
 * motion; the remainder it holds at rest. Pinned as a ratio (not
 * a ms value) so the `cycleMs` slider scales the whole timeline
 * uniformly — speeding up the cycle keeps the pulse-vs-hold
 * proportion the same.
 */
const PULSE_WINDOW_RATIO = 600 / 960;

/**
 * Per-bar stagger as a ratio of the cycle. Each bar's pulse begins
 * `index * PULSE_STAGGER_RATIO * cycleMs` ms into the cycle. The
 * last bar's pulse begins at `(BAR_COUNT - 1) * PULSE_STAGGER_RATIO`
 * which combined with `PULSE_WINDOW_RATIO` must sum to ≤ 1.0 so
 * the last bar's pulse fits inside the cycle: `0.375 + 0.625 = 1.0`
 * — the timeline is exactly used.
 */
const PULSE_STAGGER_RATIO = 180 / 960;

/**
 * Number of bars in the indicator. Pinned as a constant rather
 * than a prop because the "three bars" shape is the component's
 * identity — variations would be different components.
 */
const BAR_COUNT = 3;

/** Default scale factor at peak shrink (consumers override via `shrinkTo`). */
const DEFAULT_SHRINK_TO = 0.5;

/**
 * Default opacity at peak shrink (consumers override via `dimTo`).
 * `1.0` disables the fade entirely — the visible pulse is carried
 * by the scale change alone. The opacity-driven dimming read as
 * extra visual noise next to the asymmetric short-long-short
 * silhouette; the scale change is enough motion on its own.
 */
const DEFAULT_DIM_TO = 1;

/**
 * Default rest-height ratio for the outer bars relative to the
 * middle bar's full height. The "short-long-short" silhouette: the
 * middle bar sits at its full natural height; the outer bars sit
 * at `sideBarRatio * size` at rest. Consumers override via
 * `sideBarRatio`.
 */
const DEFAULT_SIDE_BAR_RATIO = 0.5;

/**
 * Default bar width as a ratio of the host `size`. Thin enough
 * that the indicator reads as a compact glyph next to its label;
 * the gap derives from width via {@link gapForBarWidth} so thinner
 * bars sit closer together.
 */
const DEFAULT_BAR_WIDTH_RATIO = 0.15;

/**
 * Bar gap as a ratio of bar width. Pinned at 0.8 — the same ratio
 * the prior hard-coded geometry produced (`size/5` gap vs `size/4`
 * width). Keeps the silhouette balanced as the width ratio
 * changes: thin bars sit close together, thick bars sit further
 * apart.
 */
const GAP_TO_WIDTH_RATIO = 0.8;

/**
 * Resolve the gap (px) between bars for a given bar width (px).
 * Exported for unit tests so the proportionality rule is pin-able
 * without a render.
 */
export function gapForBarWidth(barWidthPx: number): number {
  return barWidthPx * GAP_TO_WIDTH_RATIO;
}

/**
 * Resolve the per-bar `(restScale, peakScale)` pair from `index`,
 * `shrinkTo`, and `sideBarRatio`. The middle bar (index 1) sits at
 * full rest height (`1.0`) and dips to `shrinkTo` at the pulse
 * peak — the established "shrink then grow" motion. The outer
 * bars (index 0 and 2) sit at the short rest height
 * (`sideBarRatio`) and grow toward full height (`1.0`) at the
 * pulse peak — the inverse motion that gives the indicator its
 * "wave" feel ([Step 20.4.10] iteration on the short-long-short
 * silhouette).
 *
 * Exported for unit tests so the per-index asymmetry is pin-able
 * without a render.
 */
export function thinkingIndicatorBarScales(
  index: number,
  shrinkTo: number,
  sideBarRatio: number,
): { restScale: number; peakScale: number } {
  const isMiddle = index === 1;
  if (isMiddle) {
    return { restScale: 1, peakScale: clamp01(shrinkTo) };
  }
  return { restScale: clamp01(sideBarRatio), peakScale: 1 };
}

/**
 * Build the per-bar keyframe sequence for a staggered pulse. Bar
 * `index` holds at rest from offset 0 to `index*PULSE_STAGGER_RATIO`,
 * runs the active motion across `PULSE_WINDOW_RATIO`, then holds at
 * rest until offset 1. Keyframe `offset` values are normalized to
 * [0, 1]; the cycle's actual duration (`cycleMs`) is applied at
 * `animate()` time so a single duration value scales the whole
 * timeline.
 *
 * The middle bar shrinks (rest=1 → peak=`shrinkTo`); the outer
 * bars grow (rest=`sideBarRatio` → peak=1). Both directions cross
 * at the same offset, producing a "wave" silhouette as the active
 * focus walks across the three bars.
 *
 * `dimTo` controls opacity at peak (1.0 = no fade, 0.0 =
 * invisible) and applies to every bar uniformly — the dip in
 * opacity is the soft visual marker for the active motion,
 * regardless of which direction the scale is going.
 *
 * The rest "holds" are realized with consecutive identical
 * keyframes — WAAPI interpolates between adjacent frames, so two
 * frames at the same rest values interpolate to constant rest for
 * the duration between them.
 */
function buildBarKeyframes(
  index: number,
  shrinkTo: number,
  dimTo: number,
  sideBarRatio: number,
): Keyframe[] {
  const startOffset = index * PULSE_STAGGER_RATIO;
  const midOffset = startOffset + PULSE_WINDOW_RATIO / 2;
  const endOffset = startOffset + PULSE_WINDOW_RATIO;
  const { restScale, peakScale } = thinkingIndicatorBarScales(
    index,
    shrinkTo,
    sideBarRatio,
  );
  return [
    { offset: 0, opacity: 1, transform: `scaleY(${restScale})` },
    {
      offset: clamp01(startOffset),
      opacity: 1,
      transform: `scaleY(${restScale})`,
    },
    {
      offset: clamp01(midOffset),
      opacity: clamp01(dimTo),
      transform: `scaleY(${peakScale})`,
    },
    {
      offset: clamp01(endOffset),
      opacity: 1,
      transform: `scaleY(${restScale})`,
    },
    { offset: 1, opacity: 1, transform: `scaleY(${restScale})` },
  ];
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Resolve the bar's `transform-origin` from the two direction
 * booleans. Exported for unit tests so the precedence table is
 * pin-able without a render.
 *
 * | shrinkFromTop | shrinkFromBottom | origin                |
 * |---------------|------------------|-----------------------|
 * | true          | false            | `center bottom`       |
 * | false         | true             | `center top`          |
 * | true          | true             | `center center`       |
 * | false         | false            | `center bottom`       |  ← fallback (no motion is the keyframe author's job)
 */
export function thinkingIndicatorTransformOrigin(
  shrinkFromTop: boolean,
  shrinkFromBottom: boolean,
): string {
  if (shrinkFromTop && shrinkFromBottom) return "center center";
  if (shrinkFromBottom) return "center top";
  return "center bottom";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TugThinkingIndicatorProps
  extends React.ComponentPropsWithoutRef<"span"> {
  /**
   * When true, bars pulse in staggered sequence via
   * `TugAnimator.group()`. When false, bars sit at rest — visible,
   * full opacity, no motion.
   *
   * Per [L06], the toggle drives the `data-animating` attribute on
   * the root span; the pulse itself is owned by TugAnimator at
   * group boundaries. No React state for appearance.
   *
   * @selector [data-animating="true"] | [data-animating="false"]
   * @default true
   */
  animating?: boolean;
  /**
   * Where to render the visible label relative to the glyph.
   * `"hidden"` suppresses the label slot entirely; `"left"` and
   * `"right"` render the label inline.
   *
   * Per [L06], the position toggle is appearance — it drives the
   * `data-label-position` attribute on the root span and CSS reads
   * it; no React state in a wrapper.
   *
   * @selector [data-label-position="left"] | [data-label-position="right"] | [data-label-position="hidden"]
   * @default "right"
   */
  labelPosition?: TugThinkingIndicatorLabelPosition;
  /**
   * Optional override of the visible label text. When omitted and
   * `labelPosition !== "hidden"`, the label reads {@link
   * TUG_THINKING_INDICATOR_DEFAULT_LABEL}.
   */
  label?: string;
  /**
   * Bar height in CSS px. Applied as the
   * `--tugx-thinking-indicator-size` custom property on the root;
   * the bar width and gap scale from this value.
   *
   * @selector .tug-thinking-indicator (custom property --tugx-thinking-indicator-size)
   * @default 16
   */
  size?: number;
  /**
   * Scale factor at peak shrink (0..1). `1` disables the vertical
   * shrink (opacity-only pulse); `0.5` collapses the bar to 50% of
   * its rest height at the pulse trough.
   * @default 0.5
   */
  shrinkTo?: number;
  /**
   * Opacity at peak shrink (0..1). `1` disables the fade (shrink-
   * only pulse — the default); lower values dim the bar at the
   * pulse peak. The visible motion is carried by the asymmetric
   * scale change; opacity-driven dimming is opt-in.
   * @default 1
   */
  dimTo?: number;
  /**
   * Total cycle duration (ms) — the time from first-bar start to
   * last-bar finish. Scales the whole timeline uniformly; the
   * pulse-window and stagger ratios are held constant so the
   * staggered shape reads the same at any speed.
   * @default 960
   */
  cycleMs?: number;
  /**
   * When true (default), the bar shrinks from the top down — the
   * top edge moves toward the bar's bottom. Realized via
   * `transform-origin: center bottom`.
   * @selector [data-shrink-from-top="true"] | [data-shrink-from-top="false"]
   * @default true
   */
  shrinkFromTop?: boolean;
  /**
   * When true (default), the bar shrinks from the bottom up — the
   * bottom edge moves toward the bar's top. Combine with
   * `shrinkFromTop` (also true by default) to shrink symmetrically
   * from both ends about the center.
   * @selector [data-shrink-from-bottom="true"] | [data-shrink-from-bottom="false"]
   * @default true
   */
  shrinkFromBottom?: boolean;
  /**
   * Rest-height ratio for the outer bars relative to the middle
   * bar's full height. Drives the "short-long-short" silhouette:
   * at `1.0` all three bars are the same height; at `0.5`
   * (default) the outer bars sit at half the middle bar's height.
   * The outer bars grow toward the middle's full height at their
   * pulse peak (inverse motion).
   * @default 0.5
   */
  sideBarRatio?: number;
  /**
   * Bar width as a ratio of `size`. Default `0.15` (each bar is
   * 15% of the host size). The gap between bars derives from the
   * width via {@link gapForBarWidth} (80% of width), so thinner
   * bars sit closer together.
   * @selector .tug-thinking-indicator (custom property --tugx-thinking-indicator-bar-width)
   * @default 0.15
   */
  barWidthRatio?: number;
}

// ---------------------------------------------------------------------------
// TugThinkingIndicator
// ---------------------------------------------------------------------------

export const TugThinkingIndicator = React.forwardRef<
  HTMLSpanElement,
  TugThinkingIndicatorProps
>(function TugThinkingIndicator(
  {
    animating = true,
    labelPosition = "right",
    label,
    size = 16,
    shrinkTo = DEFAULT_SHRINK_TO,
    dimTo = DEFAULT_DIM_TO,
    cycleMs = DEFAULT_CYCLE_MS,
    shrinkFromTop = true,
    shrinkFromBottom = true,
    sideBarRatio = DEFAULT_SIDE_BAR_RATIO,
    barWidthRatio = DEFAULT_BAR_WIDTH_RATIO,
    className,
    style,
    ...rest
  },
  forwardedRef,
) {
  // One ref per bar so the group can address each WAAPI animation
  // by element.
  const barRefs = useRef<Array<HTMLSpanElement | null>>(
    new Array(BAR_COUNT).fill(null),
  );
  const groupRef = useRef<TugAnimationGroup | null>(null);
  // Latest `animating` value read at every group boundary so the
  // chain can decide whether to start the next cycle without
  // re-binding the kickoff effect on every render. Mirrors the
  // `latestRef` pattern in TugStateIndicator.
  const latestAnimatingRef = useRef<boolean>(animating);
  latestAnimatingRef.current = animating;
  // Tunables read fresh at every cycle start. Stored in refs so a
  // mid-cycle change to e.g. `cycleMs` does not interrupt the
  // in-flight pulse — the new value takes effect on the NEXT
  // cycle, preserving the "no hops, no jumps" guarantee.
  const latestTunablesRef = useRef({
    shrinkTo,
    dimTo,
    cycleMs,
    sideBarRatio,
  });
  latestTunablesRef.current = { shrinkTo, dimTo, cycleMs, sideBarRatio };

  // Start one staggered pulse cycle across all three bars. Each
  // bar gets a finite WAAPI one-shot inside the group; `.finished`
  // resolves when the LAST bar (the one with the longest delay)
  // completes. On that resolution, read `latestAnimatingRef` and
  // either chain another cycle or stop.
  const startCycle = useCallback(() => {
    const tunables = latestTunablesRef.current;
    const g = group({ duration: tunables.cycleMs, easing: "ease-in-out" });
    groupRef.current = g;
    let scheduled = 0;
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const el = barRefs.current[i];
      if (el === null) continue;
      g.animate(
        el,
        buildBarKeyframes(
          i,
          tunables.shrinkTo,
          tunables.dimTo,
          tunables.sideBarRatio,
        ),
        {
          duration: tunables.cycleMs,
          easing: "ease-in-out",
        },
      );
      scheduled += 1;
    }
    if (scheduled === 0) {
      // No bars mounted yet — race during initial mount. The
      // kickoff effect will re-fire on the next render once the
      // bars exist; no chain to start here.
      groupRef.current = null;
      return;
    }
    g.finished
      .then(() => {
        // Only the latest in-flight group should chain. If a newer
        // group has taken over (e.g. a fast off→on toggle), the
        // newer group owns the chain decision.
        if (groupRef.current !== g) return;
        groupRef.current = null;
        if (latestAnimatingRef.current) {
          startCycle();
        }
      })
      .catch(() => {
        // Cancellation path (unmount, snap-to-end). The unmount
        // effect cleared the ref; nothing else to do.
        if (groupRef.current === g) {
          groupRef.current = null;
        }
      });
  }, []);

  // Kickoff: when `animating` flips ON and no group is in flight,
  // start a new cycle. When it flips OFF mid-cycle, leave the
  // in-flight group running — `.finished` will read
  // `latestAnimatingRef` and decline to chain a follow-up cycle.
  // No group cancellation on toggle-off — the in-flight pulse
  // group completes cleanly (the "no hops, no jumps" guarantee).
  useEffect(() => {
    if (!animating) return;
    if (groupRef.current !== null) return;
    startCycle();
  }, [animating, startCycle]);

  // Unmount: cancel the in-flight group so its `.then` handler
  // doesn't fire after the bar elements are gone.
  useEffect(() => {
    return () => {
      const g = groupRef.current;
      if (g !== null) {
        g.cancel("snap-to-end");
        groupRef.current = null;
      }
    };
  }, []);

  // Bar width and gap are computed at this layer so the
  // `barWidthRatio` prop can drive both with a single source of
  // truth. The gap stays proportional to the width
  // (`gapForBarWidth`) so thinner bars sit closer together,
  // thicker bars sit further apart — keeps the silhouette balanced
  // across the prop's range.
  const barWidthPx = size * barWidthRatio;
  const barGapPx = gapForBarWidth(barWidthPx);
  const rootStyle: React.CSSProperties = {
    ["--tugx-thinking-indicator-size" as string]: `${size}px`,
    ["--tugx-thinking-indicator-bar-width" as string]: `${barWidthPx}px`,
    ["--tugx-thinking-indicator-bar-gap" as string]: `${barGapPx}px`,
    ...style,
  };

  const labelVisible = thinkingIndicatorLabelVisible(labelPosition);
  const labelText = thinkingIndicatorLabelText(label);

  const transformOrigin = thinkingIndicatorTransformOrigin(
    shrinkFromTop,
    shrinkFromBottom,
  );

  return (
    <span
      ref={forwardedRef}
      data-slot="tug-thinking-indicator"
      data-animating={animating ? "true" : "false"}
      data-label-position={labelPosition}
      data-shrink-from-top={shrinkFromTop ? "true" : "false"}
      data-shrink-from-bottom={shrinkFromBottom ? "true" : "false"}
      className={cn("tug-thinking-indicator", className)}
      aria-label={label ?? TUG_THINKING_INDICATOR_DEFAULT_LABEL}
      style={rootStyle}
      {...rest}
    >
      <span className="tug-thinking-indicator-glyph">
        {Array.from({ length: BAR_COUNT }).map((_, i) => {
          const { restScale } = thinkingIndicatorBarScales(
            i,
            shrinkTo,
            sideBarRatio,
          );
          return (
            <span
              key={i}
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              className="tug-thinking-indicator-bar"
              // Per-bar inline styles per [L06] — DOM owns
              // appearance, not React state.
              //
              //  - `transform-origin` swaps based on the
              //    `shrinkFromTop` / `shrinkFromBottom` flags;
              //    overrides the CSS default (`center bottom`).
              //  - `transform: scaleY(restScale)` seeds the
              //    bar's rest pose so the outer bars start at
              //    their short rest height (`sideBarRatio`) on
              //    mount — without this seed, the bar paints
              //    full-height for one frame before WAAPI's
              //    first keyframe lands. Also drives the static
              //    (non-pulsing) silhouette so the
              //    `animating={false}` state shows the
              //    short-long-short shape.
              style={{
                transformOrigin,
                transform: `scaleY(${restScale})`,
              }}
            />
          );
        })}
      </span>
      {labelVisible && (
        <span className="tug-thinking-indicator-label">{labelText}</span>
      )}
    </span>
  );
});
