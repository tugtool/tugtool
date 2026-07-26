/**
 * TugProgressLargePulsingDot — Internal building block for the large
 * breathing-dot glyph.
 *
 * App code should use {@link TugProgressIndicator} instead.
 *
 * The bigger sibling of {@link TugProgressPulsingDot}, and a different
 * motion: where the small glyph holds a fixed dot and chains one-shot
 * ring pulses, this one **breathes** — the inner dot scales up and down
 * on a continuous 2s cycle, and the ring is emitted from that breath
 * rather than clocked on its own.
 *
 * Two visible elements on ONE shared 2s period:
 *
 *   - **Dot** — a solid circle that eases between `DOT_SCALE_MIN` and
 *     1.0 and back over the cycle (inhale on the first half, exhale on
 *     the second), traveling the full swing every time. Its color
 *     resolves from the parent's live `--tugx-progress-indicator-fill`.
 *   - **Ring** — fired a few degrees before the top of the breath
 *     ({@link EMIT_OFFSET_PCT}), so it is already alive and moving when
 *     the dot turns. It is born at the dot's own edge and expands
 *     outward to the glyph box, fading as it goes — so the exhale is one
 *     gesture: the dot falls away from the ring it just shed.
 *
 * **Phase lock without a clock.** Both elements run CSS `@keyframes` on
 * the same duration, started in the same frame, so the ring's emission
 * stop stays welded to the dot's turn with no timer, no WAAPI chaining,
 * and no per-frame main-thread work. That duration carries a small
 * per-instance jitter ({@link DRIFT_SPREAD}) — the weld is within a
 * glyph, so two of them on screen drift apart rather than beating as one. Firing near the turn also keeps the
 * ring inside a single cycle — lit at 47%, gone by 100% — so the pulse
 * needs no wrap across the cycle boundary.
 *
 * State semantics mirror the small dot, each rung also carrying its own
 * PRESENCE — its share of the reserved box ({@link SETTLED_PRESENCE}), so the
 * glyph's SIZE reads the state before its color or motion does:
 *   running   — the dot breathes and emits rings; owns the whole box.
 *   paused    — dot held at full size; static outer ring, drawn in.
 *   stopped   — quiet (reduced) dot; small static ring.
 *   completed — quiet dot; small static ring, success tint from parent.
 *   aborted   — full-size dot; static outer ring drawn in, danger tint.
 *
 * Laws: [L02] state arrives via props from the parent indicator;
 *       [L06] tone is a live CSS variable and the motion is gated on
 *       `data-state` — never React state;
 *       [L13] the breath and the ring are continuous loops with no
 *       per-pulse completion requirement, so they are declarative CSS
 *       `@keyframes` (motion-off zeroes them through the global
 *       `body[data-tug-motion="off"]` rule), not programmatic motion.
 *
 * @module components/tugways/internal/tug-progress-large-pulsing-dot
 */

import "./tug-progress-large-pulsing-dot.css";

import React from "react";

import { cn } from "@/lib/utils";
import type { TugProgressIndicatorState } from "../tug-progress-indicator";

/**
 * Glyph box diameter when the caller names no size. Sized against the Z5
 * submit button (36px square) — this glyph is meant to be legible across
 * the room the way that button is. It runs a little under, since motion
 * carries some of the load that size alone carries for a static control.
 */
const DEFAULT_SIZE = 32;

/**
 * Dot diameter as a fraction of the glyph box, at the top of the breath.
 * The dot is the object being looked at, so it takes most of the box; the
 * remainder is the room the emitted ring expands into.
 */
const DOT_RATIO = 0.6;

/**
 * Trough of the breath — the dot's scale at the bottom of the cycle. A
 * wide swing on purpose: the dot travels the full distance every cycle,
 * and the ring's emission is a waypoint on the way down, not the end of
 * the fall.
 */
export const DOT_SCALE_MIN = 0.35;

/**
 * Where in the cycle the ring is emitted, as a percentage — **ignition
 * advance**, borrowed from a spark engine. Top dead center is the top of
 * the breath at 50%; the spark fires a few degrees before it, so the
 * pressure is already building when the piston turns. Read the cycle as
 * 360°: 47% is 169.2°, about **10.8° BTDC** — a plausible advance for a
 * real engine, and the same reasoning applies here. The ring needs a few
 * frames to become visible and start moving; lighting it exactly at the
 * turn means the eye catches it slightly late, trailing the dot.
 *
 * Two earlier rounds landed elsewhere. Emitting at the 75% crossing
 * (66.667%) read as a HESITATION in the dot's fall that its keyframes
 * never make — a ring arriving that far down is an event the eye
 * back-fills a cause for. Emitting exactly at the turn (50%) fixed that
 * but ran a touch behind the beat.
 */
export const EMIT_OFFSET_PCT = 47;

/**
 * Half-width of the per-instance period jitter, as a fraction of the nominal
 * 2s cycle. Each mounted glyph picks a multiplier once, uniformly in
 * `[1 - DRIFT_SPREAD, 1 + DRIFT_SPREAD]`, and runs its whole cycle at that
 * rate.
 *
 * The point is a column of them. Several sessions breathing on one exact
 * period read as one mechanism with several heads; give each its own rate and
 * they pull apart over half a minute or so into something that reads as
 * several things each doing its own work. At ±4% the widest pair differs by
 * ~160ms per cycle, so neighbors take roughly a dozen breaths to fall out of
 * step — slow enough that no single glance catches the drift happening.
 *
 * It only ever scales the period, so both loops inside one glyph still read
 * the same duration and stay phase-locked to each other: the ring is still
 * shed at 10.8° BTDC of that glyph's own breath.
 */
const DRIFT_SPREAD = 0.04;

/** Settled states paint a reduced dot; held / canceled keep it full-size. */
function isQuiet(state: TugProgressIndicatorState): boolean {
  return state === "stopped" || state === "completed";
}

const IDLE_DOT_SCALE = 0.85;

/**
 * The PRESENCE ladder — how much of the reserved glyph box each state
 * occupies.
 *
 * Size is this variant's whole argument: it exists to be read across a room.
 * But "big" is only legible as a signal if it is *relative*, and the earlier
 * cut had it backwards — every settled state painted a full-box static ring,
 * so a finished session drew a bigger figure than a working one. A row of
 * sessions read as loudest where nothing was happening.
 *
 * So presence became a property of the state, not a constant. `running` is
 * absent from the ladder because it has no static pose to scale: its breath
 * and its emitted ring are authored against the full box and own it outright
 * (see {@link presenceScale}). Every other state is a pose the component seeds,
 * and each one draws in from that edge by the amount below — a held or aborted
 * session stays substantial because it still wants an answer; a stopped or
 * completed one recedes to a quiet marker.
 *
 * The box itself never changes, so the ladder is pure appearance: rows do not
 * reflow as a session moves through it, and a caller's `size` still means the
 * space to reserve.
 */
const SETTLED_PRESENCE: Record<
  Exclude<TugProgressIndicatorState, "running">,
  number
> = {
  paused: 0.7,
  aborted: 0.7,
  stopped: 0.5,
  completed: 0.5,
};

/** This state's share of the glyph box. See {@link SETTLED_PRESENCE}. */
function presenceScale(state: TugProgressIndicatorState): number {
  return state === "running" ? 1 : SETTLED_PRESENCE[state];
}

export interface TugProgressLargePulsingDotProps {
  /** Glyph box diameter in CSS px. @default 24 */
  size?: number;
  /** Lifecycle state. @default "running" */
  state?: TugProgressIndicatorState;
  /** When true, opacity dims. */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugProgressLargePulsingDot = React.forwardRef<
  HTMLSpanElement,
  TugProgressLargePulsingDotProps
>(function TugProgressLargePulsingDot(
  { size = DEFAULT_SIZE, state = "running", disabled = false, className },
  forwardedRef,
) {
  // The dot's box is its full-scale diameter; the breath scales it down
  // from there, so the running glyph never grows past the box.
  const dotSizePx = size * DOT_RATIO;
  // The state's share of the box ([SETTLED_PRESENCE]). Published as a variable
  // so the static ring can size itself from it in CSS without a second source
  // of truth — and so it sizes by WIDTH rather than a transform, which keeps
  // the ring's stroke the same weight at every rung of the ladder.
  const presence = presenceScale(state);
  // Chosen once per mount and never again: this glyph's own rate ([DRIFT_SPREAD]).
  const [drift] = React.useState(
    () => 1 + (Math.random() * 2 - 1) * DRIFT_SPREAD,
  );
  const rootStyle: React.CSSProperties = {
    ["--tugx-progress-large-pulsing-dot-size" as string]: `${size}px`,
    ["--tugx-progress-large-pulsing-dot-dot-size" as string]: `${dotSizePx}px`,
    ["--tugx-progress-large-pulsing-dot-presence" as string]: `${presence}`,
    ["--tugx-progress-large-pulsing-dot-drift" as string]: `${drift.toFixed(4)}`,
  };

  // Seed the static pose inline. It equals the breath's 0% keyframe, so a
  // running glyph starts from the same pose it rests at — no first-frame
  // jump — and the non-running states simply hold it, drawn in by the
  // state's presence.
  const staticScale = (isQuiet(state) ? IDLE_DOT_SCALE : 1) * presence;

  return (
    <span
      ref={forwardedRef}
      data-slot="tug-progress-large-pulsing-dot"
      data-state={state}
      aria-hidden="true"
      style={rootStyle}
      className={cn(
        "tug-progress-large-pulsing-dot",
        disabled && "tug-progress-large-pulsing-dot-disabled",
        className,
      )}
    >
      <span
        className="tug-progress-large-pulsing-dot-dot"
        style={{ transform: `translate(-50%, -50%) scale(${staticScale})` }}
      />
      <span className="tug-progress-large-pulsing-dot-ring" />
    </span>
  );
});
