/**
 * TugProgressPulsingDot — Internal building block for the breathing-dot glyph.
 *
 * App code should use {@link TugProgressIndicator} instead.
 *
 * The glyph **breathes** — the inner dot scales up and down on a continuous
 * 2s cycle, and the ring is emitted from that breath rather than clocked on
 * its own. It supersedes an earlier dot of the same name that held a fixed
 * circle and chained one-shot WAAPI ring pulses around it; that one was a
 * blinker with a halo, and this one is a thing that inhales and exhales.
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
 *     ring it just shed. Below 28px it is let out past the box; see
 *     {@link sizeGeometry}.
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
 * per-frame main-thread work. That duration carries a small jitter drawn by
 * the parent indicator ({@link drawDotDrift}) — per ITEM, so two sessions in
 * the Lens pull apart rather than beating as one, while two glyphs of the same
 * item stay locked together. Firing near the turn also keeps the ring inside a
 * single cycle, so the pulse needs no wrap across the cycle boundary.
 *
 * **Two treatments.** The glyph serves both a 28px Lens row and a 10px status
 * cell, and it does that by carrying two geometries rather than scaling one —
 * see {@link BIG_SIZE}. The motion below is common to both; the proportions,
 * the ring's reach, and the PRESENCE ladder are not.
 *
 * State semantics, each rung also carrying its own PRESENCE — its share of the
 * reserved box ({@link SETTLED_PRESENCE}), so at the big end the glyph's SIZE
 * reads the state before its color or motion does:
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
 * @module components/tugways/internal/tug-progress-pulsing-dot
 */

import "./tug-progress-pulsing-dot.css";

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
 *
 * At the big end the dot IS the object being looked at, so it takes most of the
 * box and the remainder is the room the emitted ring expands into. At the small
 * end it is {@link SMALL_DOT_RATIO} instead — the previous glyph's ratio, kept
 * so a settled marker in a status row is the size it has always been.
 */
const DOT_RATIO = 0.6;

/** The small treatment's dot ratio — the previous glyph's, unchanged. */
const SMALL_DOT_RATIO = 0.5;

/**
 * Trough of the breath — the dot's scale at the bottom of the cycle. A
 * wide swing on purpose: the dot travels the full distance every cycle,
 * and the ring's emission is a waypoint on the way down, not the end of
 * the fall. Mirrors `--tugx-progress-pulsing-dot-dot-scale-min`.
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
 * The size band across which this glyph changes what it is trying to be.
 *
 * There are two treatments here, not one figure scaled. At {@link BIG_SIZE} and
 * up — the Lens session row — it is a figure meant to be read across a room:
 * the dot takes 60% of the box, the ring stays inside it, and the PRESENCE
 * ladder encodes state as relative size. At {@link SMALL_SIZE} and down — a Z2
 * status cell, a tool-call header, a setup step — it is a marker in a row of
 * type, and every one of those choices is wrong for it: relative size is not
 * legible in 12 pixels, and a bigger dot is just a bigger dot.
 *
 * **The small treatment is the previous glyph's geometry, exactly.** Same 0.5
 * dot ratio, same full-box static ring, same hairline stroke, no ladder — so a
 * settled dot in a status cell paints the pixels it painted before. What
 * changes down there is the MOTION and nothing else: the dot breathes and sheds
 * a ring instead of holding still under a halo. That is the whole point of
 * unifying the variants, and it is the whole extent of it.
 *
 * The band is chosen to sit in the gap between the real call sites: everything
 * the app asks for is 16px and under or 28px and over, so nothing ships at a
 * blend. The ramp between exists so the in-between sizes a gallery or a future
 * caller might pick degrade smoothly rather than snapping at a threshold.
 */
const BIG_SIZE = 28;
const SMALL_SIZE = 16;

/** 0 at {@link BIG_SIZE} and up, 1 at {@link SMALL_SIZE} and down. */
function smallness(size: number): number {
  return Math.min(1, Math.max(0, (BIG_SIZE - size) / (BIG_SIZE - SMALL_SIZE)));
}

/**
 * How far past the glyph box a small ring travels.
 *
 * Layout-safety is a luxury of size. Held inside the box, the ring's whole
 * journey is from the dot's edge to the box edge — at a 32px glyph that is
 * 6.5px of radius and reads as a pulse; at 12px it is 2.5px and reads as a
 * twitch, a ring that appears, shivers, and stops. There is no timing fix for
 * that: the distance simply is not there.
 *
 * So below {@link BIG_SIZE} the ring is let out of the box, ramping to
 * this multiple at {@link SMALL_SIZE} and under. It is not a new idea —
 * it is what the glyph this one replaces always did (its ring ran to 1.9× the
 * box), and it is why that glyph read at 12px at all. Overflow is free here:
 * the ring is absolutely positioned and nothing on the path clips, so a bigger
 * reach costs paint, never layout.
 */
const REACH_MAX = 1.75;

/**
 * The small treatment's trough — a much shallower breath than the big one's.
 *
 * Depth of breath does not survive being scaled down, because the bottom of the
 * swing is where the dot is least able to spare anything. {@link DOT_SCALE_MIN}
 * takes a 19.2px dot down to 6.7px, which still reads as a dot; the same ratio
 * takes a 6px dot down to 2.1px, which reads as a dot going out. And unlike the
 * big glyph, the small one is sitting in a row of type where it is the only
 * mark: it cannot afford to half-disappear on every cycle.
 *
 * So the swing narrows as the glyph shrinks, to this at {@link SMALL_SIZE} and
 * under — a modulation rather than a full breath. The motion is still legible
 * down there because the shed ring is carrying most of it; the dot's job at
 * these sizes is to stay a dot.
 */
const SMALL_TROUGH = 0.7;

/**
 * Everything about the glyph that cannot be one number across a 10px–40px
 * range, derived from the size in one place.
 *
 * The timing is untouched by any of it — the envelope, the ignition advance and
 * the stroke weights are scale-free and every size gets the same breath. What
 * changes is geometry, because each of these is a ratio against a box that is
 * no longer one size:
 *
 *   - **ratio** — the dot's share of the box. 0.6 big, 0.5 small (the previous
 *     glyph's), so a settled small dot is the size it always was.
 *   - **reach** — where the ring's expansion ends. The box edge at the big end,
 *     and out past it at the small end, where the box is not far enough away to
 *     be worth traveling to.
 *   - **scaleMin** — the trough of the breath. A deep swing at the big end, a
 *     shallow modulation at the small one, where the dot cannot spare the
 *     pixels and the ring is carrying the motion anyway.
 *   - **birth** — where the dot's edge is when the spark fires. Falls out of
 *     the other two; it is here so it cannot drift from them.
 *
 * All four are published as `-auto` variables so an override from above still
 * wins (see the stylesheet's note on the knobs), and all four resolve to the
 * stylesheet's own defaults at {@link BIG_SIZE} and up.
 */
export function sizeGeometry(size: number): {
  ratio: number;
  reach: number;
  scaleMin: number;
  birth: number;
} {
  const t = smallness(size);
  const ratio = DOT_RATIO + (SMALL_DOT_RATIO - DOT_RATIO) * t;
  const scaleMin = DOT_SCALE_MIN + (SMALL_TROUGH - DOT_SCALE_MIN) * t;
  const atIgnition = breathAt(
    DEFAULT_BREATH_TURN,
    DEFAULT_BREATH_TURN - EMIT_ADVANCE,
  );
  return {
    ratio,
    reach: 1 + (REACH_MAX - 1) * t,
    scaleMin,
    // Where the dot's edge actually is when the spark fires. It moves with the
    // ratio and the trough, so it is derived here rather than left to the
    // stylesheet's big-size default — otherwise a small ring is born beside the
    // dot instead of on it.
    birth: ratio * (scaleMin + (1 - scaleMin) * atIgnition),
  };
}

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
 * `--tugx-progress-pulsing-dot-pulse-weight`.
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
    ["--tugx-progress-pulsing-dot-breathe-ease" as string]: `linear(${breathe.join(", ")})`,
    ["--tugx-progress-pulsing-dot-emit-expand-ease" as string]: `linear(${expand.join(", ")})`,
    ["--tugx-progress-pulsing-dot-emit-fade-ease" as string]: `linear(${fade.join(", ")})`,
    ["--tugx-progress-pulsing-dot-emit-birth" as string]: stop(birth),
  };
}

/**
 * Half-width of the period jitter, as a fraction of the nominal 2s cycle.
 *
 * The point is a column of them. Several sessions breathing on one exact
 * period read as one mechanism with several heads; give each its own rate and
 * they pull apart over half a minute or so into something that reads as
 * several things each doing its own work. At ±4% the widest pair differs by
 * ~160ms per cycle, so neighbors take roughly a dozen breaths to fall out of
 * step — slow enough that no single glance catches the drift happening.
 *
 * It only ever scales the period, so all three loops under one draw still read
 * the same duration and stay phase-locked: the ring is still shed at 10.8° BTDC
 * of that breath.
 */
const DRIFT_SPREAD = 0.04;

/**
 * One draw of the period jitter — a multiplier uniform in
 * `[1 - DRIFT_SPREAD, 1 + DRIFT_SPREAD]`.
 *
 * **The draw belongs to the ITEM, not to the glyph**, which is why it is
 * exported rather than made here: {@link TugProgressIndicator} draws it once
 * per indicator and publishes it as `--…-drift-auto` for whatever glyphs that
 * indicator renders. Drawing it per glyph was wrong and looked it — an
 * indicator with `glyphPosition="both"` renders two glyphs of the *same* item,
 * one either side of its label, and two independent draws had that pair sliding
 * out of phase against itself. Two dots that are one status reading at
 * different rates is not organic, it is broken.
 *
 * The randomness is only ever meant to separate things that are genuinely
 * separate: one session in the Lens from the next.
 *
 * The stylesheet reads `--…-drift-auto` only when no ancestor has pinned
 * `--…-drift`, so a caller that needs the glyph deterministic can have it.
 */
export function drawDotDrift(): number {
  return 1 + (Math.random() * 2 - 1) * DRIFT_SPREAD;
}

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
 *
 * These are the values at full strength. Below 28px the ladder compresses
 * toward 1, and by 16px it is gone — see {@link presenceScale}.
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

/**
 * This state's share of the glyph box, at this size.
 *
 * The ladder ({@link SETTLED_PRESENCE}) is an affordance of the big treatment,
 * and only of it. It encodes state as *relative* size, which needs enough
 * pixels for the relation to be visible — a `completed` 12px glyph on the full
 * ladder is a 6px ring around a 2.5px dot, which is not a quiet marker but an
 * illegible one. So the ladder ramps out with {@link smallness}: gone entirely
 * at 16px and below, where every state owns its box exactly as it did under the
 * previous glyph, and the difference between states is carried by tone and by
 * whether the ring is moving. Those two read at 10px. Size does not.
 */
function presenceScale(state: TugProgressIndicatorState, size: number): number {
  if (state === "running") return 1;
  const base = SETTLED_PRESENCE[state];
  return base + (1 - base) * smallness(size);
}

export interface TugProgressPulsingDotProps {
  /** Glyph box diameter in CSS px. @default 24 */
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
  { size = DEFAULT_SIZE, state = "running", disabled = false, className },
  forwardedRef,
) {
  // The two treatments and everything derived from the size ([sizeGeometry]).
  const { ratio, reach, scaleMin, birth } = sizeGeometry(size);
  // The dot's box is its full-scale diameter; the breath scales it down
  // from there, so the running glyph never grows past the box.
  const dotSizePx = size * ratio;
  // The state's share of the box ([SETTLED_PRESENCE]). Published as a variable
  // so the static ring can size itself from it in CSS without a second source
  // of truth — and so it sizes by WIDTH rather than a transform, which keeps
  // the ring's stroke the same weight at every rung of the ladder.
  const presence = presenceScale(state, size);
  // The period jitter is NOT drawn here — it belongs to the item, and one item
  // can render two glyphs. See [drawDotDrift].
  const rootStyle: React.CSSProperties = {
    ["--tugx-progress-pulsing-dot-size" as string]: `${size}px`,
    ["--tugx-progress-pulsing-dot-dot-size" as string]: `${dotSizePx}px`,
    ["--tugx-progress-pulsing-dot-presence" as string]: `${presence}`,
    ["--tugx-progress-pulsing-dot-emit-reach-auto" as string]: `${reach.toFixed(4)}`,
    ["--tugx-progress-pulsing-dot-dot-scale-min-auto" as string]: `${scaleMin.toFixed(4)}`,
    ["--tugx-progress-pulsing-dot-emit-birth-auto" as string]: `${birth.toFixed(4)}`,
  };

  // Seed the static pose inline. It equals the breath's 0% keyframe, so a
  // running glyph starts from the same pose it rests at — no first-frame
  // jump — and the non-running states simply hold it, drawn in by the
  // state's presence.
  const staticScale = (isQuiet(state) ? IDLE_DOT_SCALE : 1) * presence;

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
      <span
        className="tug-progress-pulsing-dot-dot"
        style={{ transform: `translate(-50%, -50%) scale(${staticScale})` }}
      />
      <span className="tug-progress-pulsing-dot-ring" />
    </span>
  );
});
