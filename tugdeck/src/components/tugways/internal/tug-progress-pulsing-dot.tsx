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
 * per-frame main-thread work. Every dot in the app runs that same duration
 * unless its caller opts into a jitter ({@link dotDriftFor}), which only the
 * Lens's session list does. Firing near the turn also keeps the ring inside a
 * single cycle, so the pulse needs no wrap across the cycle boundary.
 *
 * **Two treatments.** The glyph serves both a 28px Lens row and a 10px status
 * cell, and it does that by carrying two geometries rather than scaling one —
 * see {@link BIG_SIZE}. The motion below is common to both; the proportions,
 * the ring's reach, and the PRESENCE ladder are not.
 *
 * **No state change is a cut.** The glyph's state changes when the work does,
 * on a frame nobody chose, with the dot somewhere in the middle of a breath and
 * possibly a ring in mid-flight. Letting CSS gate the loops on `data-state`
 * made that arrival a tear: the ring vanished wherever it happened to be and
 * the dot jumped to its resting pose. So the motion is gated on two attributes
 * this component writes — `data-breathing` and `data-emitting` — and every
 * arrival is a CROSSING instead:
 *
 *   - A lit pulse **always finishes its travel**. It was shed; it is leaving
 *     under its own momentum, and the work ending is no business of its. The
 *     emitter is released on the pulse's clock, not the state's ({@link
 *     releaseEmitter}). A pulse that was never lit is simply not lit.
 *   - The dot **is caught where it stands**: its live scale is pinned inline,
 *     the loop is dropped against that pin, and a CSS transition carries it
 *     from there to the settled pose. Entering `running` is the same idea
 *     inverted — the loop starts at the phase whose pose the dot already holds
 *     ({@link breathPhaseFor}), so the breath picks it up mid-stride.
 *   - The static ring **fades**, and the tint **crosses**, on that same
 *     duration, so the whole arrival reads as one gesture.
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
 *       [L06] tone is a live CSS variable, and the crossing between states is
 *       CSS transitions driven by DOM attributes and one inline pose — the
 *       state currently on screen is a ref, never React state, so a crossing
 *       renders nothing;
 *       [L13] the breath and the ring are continuous loops, so they are
 *       declarative CSS `@keyframes` (motion-off zeroes them through the
 *       global `body[data-tug-motion="off"]` rule, which zeroes the settle's
 *       transitions with them). The script here starts and releases those
 *       loops and hands off between them; it never drives a frame.
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
 * The jitter for one item, as the style that carries it — spread `key` over
 * `[1 - DRIFT_SPREAD, 1 + DRIFT_SPREAD]` and pin it.
 *
 * **Drift is opt-in, and almost nothing opts in.** It is not a property of the
 * glyph and not a property of the indicator either; it is a property of a LIST
 * OF ITEMS, and the only such list is the Lens's session rows. Every other
 * pulsing dot in the app runs the nominal period, locked — which is what the
 * Z2 STATE cell needs, since it renders two separate indicators flanking one
 * label and they have to read as one status. Automatic drift, at either level,
 * had that pair breathing against each other.
 *
 * So the caller names the item and gets its rate:
 *
 *     <TugProgressIndicator variant="pulsing-dot" style={dotDriftFor(cardId)} />
 *
 * Keyed rather than drawn, because identity is what the jitter is supposed to
 * track. A random draw per mount would re-roll a session's rate every time the
 * Lens filtered, scrolled it out and back, or hot-reloaded; hashing the id
 * means a session breathes at its own rate for as long as it exists, and two
 * rows never collide by accident of timing. It also needs no state, so it
 * survives every remount for free.
 */
export function dotDriftFor(key: string): React.CSSProperties {
  // FNV-1a, 32-bit. Any cheap avalanche would do — what matters is that
  // neighboring ids (`card-1`, `card-2`) land far apart rather than adjacent.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const unit = (hash >>> 0) / 0x100000000;
  const drift = 1 + (unit * 2 - 1) * DRIFT_SPREAD;
  return {
    ["--tugx-progress-pulsing-dot-drift" as string]: drift.toFixed(4),
  } as React.CSSProperties;
}

/**
 * Cycle position where the ring is lit — the frame a pulse begins to exist.
 * Before it, the ring is parked and fully faded and there is nothing to finish.
 */
const IGNITION = DEFAULT_BREATH_TURN - EMIT_ADVANCE;

/**
 * Slack on the emitter's release, in ms.
 *
 * A late release is free and an early one is not, so the timer is deliberately
 * generous. The ring reaches opacity 0 at the end of its travel and stays there
 * for the next 27% of the following cycle, so dropping the animation anywhere in
 * that window paints identically; cutting it a frame EARLY clips the tail of a
 * visible pulse, which is the whole thing being avoided.
 */
const EMIT_RELEASE_SLACK = 32;

/** The custom property the arming phase is written to. */
const PHASE_VAR = "--tugx-progress-pulsing-dot-phase";

/** The dot's transform at a given breath scale. */
function dotPose(scale: number): string {
  // 3D, like the keyframes — see the compositing note in the stylesheet. The
  // settled pose has to be on the same footing as the animated one, or handing
  // the dot from the loop to the transition tears its layer down and rebuilds
  // it at exactly the frame the handoff is trying to hide.
  return `translate3d(-50%, -50%, 0) scale(${scale})`;
}

/**
 * The scale the element is painting at RIGHT NOW — the animated value, not the
 * declared one.
 *
 * This is the whole mechanism behind a smooth exit. A state change arrives on
 * an arbitrary frame, with the dot at an arbitrary point in its breath, and the
 * only way out that does not jump is to start the settle from the pose actually
 * on screen. `getComputedStyle` resolves animations, so it reports that pose;
 * the caller pins it inline before dropping the loop, and the removal becomes a
 * no-op the eye cannot see.
 */
function liveScale(el: HTMLElement): number | null {
  const value = getComputedStyle(el).transform;
  if (!value || value === "none") return null;
  try {
    return new DOMMatrixReadOnly(value).a;
  } catch {
    return null;
  }
}

/**
 * Where on the breath's RISE leg the dot would be standing at `scale` —
 * the inverse of {@link breathAt}, restricted to the leg that has one.
 *
 * Used to start the loop at the phase that matches the pose already on screen,
 * as a negative `animation-delay`, so entering `running` picks the settled dot
 * up rather than snapping it to the trough. The rise is the right leg to invert
 * on: a glyph that starts working should be on its way up.
 *
 * Clamped just short of {@link IGNITION} so the loop never begins inside a
 * pulse. Only one pose in the ladder reaches that clamp — a `paused` dot at the
 * small treatment, which sits at full scale — and there the clamp costs about a
 * thousandth of the dot's diameter. Past it the cost would be a ring appearing
 * from nowhere at near-full opacity, which is the pop this function exists to
 * avoid, arriving by another door.
 */
function breathPhaseFor(scale: number, scaleMin: number): number {
  const span = 1 - scaleMin;
  const value =
    span <= 0 ? 0 : Math.min(1, Math.max(0, (scale - scaleMin) / span));
  const phase = (DEFAULT_BREATH_TURN * Math.acos(1 - 2 * value)) / Math.PI;
  return Math.max(0, Math.min(phase, IGNITION - 0.005));
}

/**
 * Stop emitting — but not before the pulse in flight has finished flying.
 *
 * **Once a pulse is lit it always completes.** It is a thing the glyph shed: it
 * left the dot, it is travelling outward under its own momentum, and the work
 * ending has no bearing on it. Cutting it mid-travel is the most visible tear a
 * state change can make, because the eye is already tracking a moving object.
 *
 * So the emitter is released on the pulse's clock rather than the state's. The
 * animation keeps running to the end of its current iteration and the attribute
 * is dropped after it, by which point the ring has faded to nothing and there
 * is nothing left to see go. A pulse that was never lit — the change landed
 * during the inhale, before {@link IGNITION} — is dropped immediately; there is
 * no gesture in progress to honor, and holding the gate open would only let one
 * more ring out of a glyph that has already stopped working.
 */
function releaseEmitter(
  root: HTMLElement,
  ring: HTMLElement,
  timer: React.MutableRefObject<number | null>,
): void {
  if (timer.current !== null) {
    window.clearTimeout(timer.current);
    timer.current = null;
  }
  let remaining = 0;
  for (const animation of ring.getAnimations()) {
    // Keyframe loops only. The ring also carries a tint transition during the
    // settle, and its progress has nothing to do with where the pulse is —
    // counting it held the emitter open on a glyph that never lit a ring.
    if (!(animation instanceof CSSAnimation)) continue;
    const timing = animation.effect?.getComputedTiming();
    const progress = timing?.progress;
    const duration = typeof timing?.duration === "number" ? timing.duration : 0;
    if (typeof progress !== "number" || duration <= 0) continue;
    if (progress < IGNITION) continue;
    remaining = Math.max(remaining, (1 - progress) * duration);
  }
  if (remaining <= 0) {
    delete root.dataset.emitting;
    return;
  }
  timer.current = window.setTimeout(() => {
    timer.current = null;
    delete root.dataset.emitting;
  }, remaining + EMIT_RELEASE_SLACK);
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
  // can render two glyphs. See [dotDriftFor].
  const rootStyle: React.CSSProperties = {
    ["--tugx-progress-pulsing-dot-size" as string]: `${size}px`,
    ["--tugx-progress-pulsing-dot-dot-size" as string]: `${dotSizePx}px`,
    ["--tugx-progress-pulsing-dot-presence" as string]: `${presence}`,
    ["--tugx-progress-pulsing-dot-emit-reach-auto" as string]: `${reach.toFixed(4)}`,
    ["--tugx-progress-pulsing-dot-dot-scale-min-auto" as string]: `${scaleMin.toFixed(4)}`,
    ["--tugx-progress-pulsing-dot-emit-birth-auto" as string]: `${birth.toFixed(4)}`,
  };

  // The pose the dot rests at once it has settled, drawn in by the state's
  // presence. Written to the DOM by the controller below rather than rendered,
  // because a state change has to CROSS to it from wherever the breath left the
  // dot — and React cannot see that pose, only this one.
  const staticScale = (isQuiet(state) ? IDLE_DOT_SCALE : 1) * presence;

  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  const dotRef = React.useRef<HTMLSpanElement | null>(null);
  const ringRef = React.useRef<HTMLSpanElement | null>(null);
  // The state currently ON SCREEN, which lags the prop for as long as the
  // crossing takes. Held in a ref, not state: it is read to decide what the
  // crossing IS, and it must never provoke a render [L06].
  const shownRef = React.useRef<TugProgressIndicatorState | null>(null);
  const emitTimerRef = React.useRef<number | null>(null);

  const setRootRef = React.useCallback(
    (node: HTMLSpanElement | null) => {
      rootRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef)
        (
          forwardedRef as React.MutableRefObject<HTMLSpanElement | null>
        ).current = node;
    },
    [forwardedRef],
  );

  /**
   * Cross to `state` from whatever is on screen.
   *
   * There are three crossings and each is smooth for its own reason:
   *
   *   - **into a settled state** — the breath is caught in the act. Its live
   *     scale is pinned inline, the loop is dropped against that pin so the
   *     removal changes nothing, and the transition then runs from there.
   *     Meanwhile the shed pulse finishes on its own clock ({@link
   *     releaseEmitter}) and the static ring fades in over it.
   *   - **into `running`** — the loop starts at the phase whose pose the dot is
   *     already standing at ({@link breathPhaseFor}), as a negative delay. The
   *     breath picks the dot up mid-stride.
   *   - **between two settled states** — a plain property change; the dot's
   *     CSS transition carries it, along with the ring's diameter and the tint.
   *
   * A layout effect, so the DOM is correct before the frame is painted: run
   * after paint and every crossing would show one frame of the wrong pose,
   * which is the tear in miniature.
   */
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!root || !dot || !ring) return;

    const previous = shownRef.current;
    shownRef.current = state;
    const isRunning = state === "running";

    const startLoops = (phase: number): void => {
      if (emitTimerRef.current !== null) {
        window.clearTimeout(emitTimerRef.current);
        emitTimerRef.current = null;
      }
      root.style.setProperty(PHASE_VAR, `${-phase}`);
      root.dataset.breathing = "";
      root.dataset.emitting = "";
    };

    // First paint. Nothing to cross from, so the pose and the loops are seeded.
    if (previous === null) {
      dot.style.transform = dotPose(isRunning ? 1 : staticScale);
      if (isRunning) startLoops(0);
      return;
    }

    if (previous === "running" && !isRunning) {
      const live = liveScale(dot);
      if (live !== null) {
        dot.style.transition = "none";
        dot.style.transform = dotPose(live);
      }
      delete root.dataset.breathing;
      // Flush the pin while the transition is suppressed, so dropping the loop
      // resolves to the same pose it was already painting instead of firing a
      // transition from the keyframe's base value.
      void dot.offsetWidth;
      dot.style.transition = "";
      dot.style.transform = dotPose(staticScale);
      releaseEmitter(root, ring, emitTimerRef);
      return;
    }

    if (previous !== "running" && isRunning) {
      const live = liveScale(dot);
      startLoops(live === null ? 0 : breathPhaseFor(live, scaleMin));
      return;
    }

    dot.style.transform = dotPose(isRunning ? 1 : staticScale);
  }, [state, staticScale, scaleMin]);

  React.useEffect(
    () => () => {
      if (emitTimerRef.current !== null)
        window.clearTimeout(emitTimerRef.current);
    },
    [],
  );

  return (
    <span
      ref={setRootRef}
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
      <span ref={dotRef} className="tug-progress-pulsing-dot-dot" />
      <span ref={ringRef} className="tug-progress-pulsing-dot-ring" />
    </span>
  );
});
