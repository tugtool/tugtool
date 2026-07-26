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
 *   - **Dot** — a solid circle that rises to full size and sinks back
 *     over the cycle, traveling the full swing every time. Its color
 *     resolves from the parent's live `--tugx-progress-indicator-fill`.
 *   - **Ring** — fired a few degrees before the top of the breath, so it
 *     is already alive and moving when the dot turns. It is born at the
 *     dot's own edge and expands outward to the glyph box, fading as it
 *     goes — so the exhale is one gesture: the dot falls away from the
 *     ring it just shed.
 *
 * **The envelope is not symmetric.** The dot rises over the first 30% of
 * the cycle and sinks over the remaining 70% — quick in, slow out, the
 * shape of the colon blink on an Apple Watch digital time label. A breath
 * that takes as long going up as coming down reads as a mechanism; this
 * one reads as something alive. The whole curve, both legs and the ring's
 * ignition, is authored as `linear()` easings in the stylesheet's
 * `--…-ease` variables — a knob, not a keyframe block. The gallery's
 * timing bench overrides those variables to show four cuts of it side by
 * side.
 *
 * **Phase lock without a clock.** Both elements run CSS `@keyframes` on
 * the same duration, started in the same frame, so the ring's emission
 * stays welded to the dot's turn with no timer, no WAAPI chaining, and no
 * per-frame main-thread work. That duration carries a small per-instance
 * jitter ({@link DRIFT_SPREAD}) — the weld is within a glyph, so two of
 * them on screen drift apart rather than beating as one. Firing near the
 * turn also keeps the ring inside a single cycle, so the pulse needs no
 * wrap across the cycle boundary.
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
 * the fall. Mirrors `--tugx-progress-large-pulsing-dot-dot-scale-min`.
 */
const DOT_SCALE_MIN = 0.35;

/**
 * How far before the turn the ring is lit, as a fraction of the cycle —
 * **ignition advance**, borrowed from a spark engine. The turn is top dead
 * center; the spark fires a few degrees before it, so the pressure is already
 * building when the piston turns. Read the cycle as 360°, 3% is **10.8°
 * BTDC** — a plausible advance for a real engine, and the same reasoning
 * applies here. The ring needs a few frames to become visible and start
 * moving; lighting it exactly at the turn means the eye catches it slightly
 * late, trailing the dot.
 */
const EMIT_ADVANCE = 0.03;

/** Turn of the shipped envelope — the CSS defaults are `breathEnvelope(0.3)`. */
export const DEFAULT_BREATH_TURN = 0.3;

/**
 * Exponent of the ring's opacity falloff — 1 is an even fade, and every step
 * up front-loads it harder.
 *
 * Shipped even. The pulse's problem was never the shape of its exit, it was
 * that it was born at partial strength: a ring that starts pre-faded and then
 * dims uniformly reads as grey. Fix the birth (see `--…-emit-opacity`) and the
 * even fall is the one that reads as a ring travelling outward and thinning.
 * Front-loading on top of that mostly shortens the ring's visible life, which
 * costs more than the extra snap buys.
 */
export const DEFAULT_FADE_POWER = 1;

/**
 * Shipped pulse stroke weight, mirroring the fallback on
 * `--tugx-progress-large-pulsing-dot-pulse-weight`.
 *
 * It is over 1 because the ring expands by `transform: scale`, which scales
 * the border along with the radius: born at ~0.59 of the box, the pulse paints
 * at ~59% of nominal at ignition — the frame it is most opaque and most worth
 * seeing — and only reaches full weight as it fades out.
 *
 * Read it as an intent rather than a rendered ratio: borders are quantized to
 * whole CSS px, so at the sizes this glyph runs at (a 28px Lens row, a 32px
 * bench cell) the resting ring lands on 1–2px and the pulse on 2–3px. Between
 * neighboring weights the painted difference is often nothing at all.
 */
export const DEFAULT_PULSE_WEIGHT = 1.6;

/**
 * The breath's shape at progress `p`, for a cycle that turns at `turn`.
 *
 * Each leg is its own cosine ease-in-out, fitted to its own length rather than
 * one curve skewed across the turn. That is the part that matters: a cosine
 * arrives at its endpoint with zero velocity, so however quick the rise, it
 * settles into a HOLD at the top instead of hitting a corner, and the long
 * fall then drifts away from that hold. Rise, hover, sink.
 */
function breathAt(turn: number, p: number): number {
  return p <= turn
    ? (1 - Math.cos(Math.PI * (p / turn))) / 2
    : (1 + Math.cos(Math.PI * ((p - turn) / (1 - turn)))) / 2;
}

/** Trim a computed stop to something readable in a stylesheet. */
function stop(n: number): string {
  const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" || s === "-0" ? "0" : s;
}

/**
 * The whole envelope for a given turn, as the four custom properties the
 * stylesheet reads.
 *
 * The keyframes over in the CSS carry no shape at all — each is two stops, a
 * start pose and an end pose. Everything about the timing is in these
 * `linear()` easings, which is what makes the curve a knob: hand this a
 * different turn and the dot's legs, the ring's ignition, and the radius the
 * ring is born at all move together, with nothing to keep in sync by hand.
 *
 * The shipped default is `breathEnvelope(DEFAULT_BREATH_TURN)`, written out
 * literally in the stylesheet so the common case costs no inline style and no
 * work at render. This function is the source those numbers came from, and the
 * gallery's timing bench calls it live to put several cuts side by side.
 *
 *   - **breathe** — the dot. Runs 0 → 1 → 0 across the cycle, so a two-stop
 *     keyframe (min → full) plays out and back on a single pass.
 *   - **expand** — the ring's radius. Flat at 0 until ignition (the ring
 *     parked, unlit, at the dot's edge), then a cubic ease-out to the box.
 *   - **fade** — the ring's opacity, on a keyframe that runs lit → 0. Held at
 *     1 (i.e. invisible) through the inhale, stepped to 0 in a hairline
 *     between two stops at the same position, then a power falloff back to 1
 *     ({@link DEFAULT_FADE_POWER}, shipped even). The ring is at nearly full
 *     strength for the frames it is still on the dot's edge, then thins evenly
 *     as it travels. Radius and opacity are separate animations because their
 *     HOLDS are opposite (radius parked at 0, opacity parked at 1) and because
 *     their shapes are specified independently.
 *   - **emit-birth** — the dot's own scale at ignition × {@link DOT_RATIO}, so
 *     the ring peels off the dot's edge rather than appearing beside it.
 */
export function breathEnvelope(
  turn: number,
  fadePower: number = DEFAULT_FADE_POWER,
): React.CSSProperties {
  const RISE_STOPS = 8;
  const FALL_STOPS = 12;
  const EXPAND_STOPS = 12;
  const ignition = turn - EMIT_ADVANCE;

  const breathe: string[] = [];
  for (let i = 0; i <= RISE_STOPS; i++) {
    const p = (turn * i) / RISE_STOPS;
    breathe.push(`${stop(breathAt(turn, p))} ${stop(p * 100)}%`);
  }
  for (let i = 1; i <= FALL_STOPS; i++) {
    const p = turn + ((1 - turn) * i) / FALL_STOPS;
    breathe.push(`${stop(breathAt(turn, p))} ${stop(p * 100)}%`);
  }

  const expand: string[] = ["0 0%", `0 ${stop(ignition * 100)}%`];
  // The hold, then the lit hairline: the last frame of nothing sits at the
  // stop just under ignition, so the ring turns on between two stops the eye
  // cannot resolve.
  const fade: string[] = [
    "1 0%",
    `1 ${stop(ignition * 100 - 0.01)}%`,
    `0 ${stop(ignition * 100)}%`,
  ];
  for (let i = 1; i <= EXPAND_STOPS; i++) {
    const u = i / EXPAND_STOPS;
    const p = ignition + u * (1 - ignition);
    expand.push(`${stop(1 - (1 - u) ** 3)} ${stop(p * 100)}%`);
    fade.push(`${stop(1 - (1 - u) ** fadePower)} ${stop(p * 100)}%`);
  }

  const birth =
    DOT_RATIO *
    (DOT_SCALE_MIN + (1 - DOT_SCALE_MIN) * breathAt(turn, ignition));

  return {
    ["--tugx-progress-large-pulsing-dot-breathe-ease" as string]: `linear(${breathe.join(", ")})`,
    ["--tugx-progress-large-pulsing-dot-emit-expand-ease" as string]: `linear(${expand.join(", ")})`,
    ["--tugx-progress-large-pulsing-dot-emit-fade-ease" as string]: `linear(${fade.join(", ")})`,
    ["--tugx-progress-large-pulsing-dot-emit-birth" as string]: stop(birth),
  };
}

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
 * It only ever scales the period, so all three loops inside one glyph still
 * read the same duration and stay phase-locked to each other: the ring is
 * still shed at 10.8° BTDC of that glyph's own breath.
 *
 * The draw is published as `--…-drift-auto`, which the stylesheet reads only
 * when no ancestor has pinned `--…-drift` — so a caller that needs the glyph
 * deterministic can have it.
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
    ["--tugx-progress-large-pulsing-dot-drift-auto" as string]: `${drift.toFixed(4)}`,
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
