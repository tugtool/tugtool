/**
 * unit-functions.ts — timing curves as plain functions, and their CSS form.
 *
 * A **unit function** maps `t` in [0, 1] to a value that starts at 0 and ends
 * at 1. That is all a timing curve is. Keeping them here as ordinary functions
 * — rather than as `cubic-bezier(…)` literals scattered through stylesheets —
 * buys two things: a curve can be swapped at its one definition without
 * touching any of the places that animate, and curves that no cubic Bézier can
 * express (a spring, a bounce) are available on the same terms as the ones that
 * can.
 *
 * The catalogue is a TypeScript port of UpKit's `UPUnitFunction`, including its
 * `unit_curve_value` construction — one exponent-and-ease-factor family that
 * covers ease-in, ease-out, and ease-in-ease-out at every power — plus the
 * Penner easing equations it carries (`THIRD_PARTY_NOTICES.md`, [L21]).
 * `dampedSpring` is the addition: a critically damped spring, which is not a
 * Penner curve and not a Bézier.
 *
 * ## Getting one into CSS
 *
 * {@link cssEasing} samples a function into a CSS `linear()` easing. `linear()`
 * takes a list of output values and interpolates between them, so a curve of
 * any shape — overshooting, oscillating, flat-topped — reaches CSS at whatever
 * fidelity the sample count buys. A cubic Bézier cannot express a spring at
 * all; sampling can express anything.
 *
 * The values a `linear()` carries are outputs at evenly spaced inputs, so the
 * error is bounded by how much the curve bends between two samples. The
 * {@link DEFAULT_EASING_SAMPLES} default is well inside a pixel for the
 * distances the deck moves frames over.
 *
 * @module lib/unit-functions
 */

/** A timing curve: `t` in [0, 1] to a value that starts at 0 and ends at 1. */
export type UnitFunction = (t: number) => number;

/**
 * UpKit's `unit_curve_value`: one family covering ease-in, ease-out, and
 * ease-in-ease-out at any power.
 *
 * `exponent` is the power the curve bends by — 1 is linear, and past 20 or so
 * the curves are indistinguishable. `easeFactor` is where the bend sits: near 0
 * is an ease-out, near 1 an ease-in, and 0.5 an ease-in-ease-out.
 */
export function unitCurve(
  t: number,
  exponent: number,
  easeFactor: number,
): number {
  const e = Math.max(exponent, 1);
  const f = Math.min(Math.max(easeFactor, EPSILON), 1 - EPSILON);
  return t <= f
    ? f * Math.pow(t / f, e)
    : 1 - (1 - f) * Math.pow((1 - t) / (1 - f), e);
}

/** The ease factor's guard rail, as in UpKit — a curve is never fully one-sided. */
const EPSILON = 1e-6;

/** The exponent UpKit's unnamed `easeIn`/`easeOut`/`easeInEaseOut` use. */
const DEFAULT_EASE_EXPONENT = 4;

/** Penner's `back` overshoot constants, in UpKit's softened `cb` tuning. */
const BACK_C1 = 0.75;
const BACK_C3 = BACK_C1 + 1;

export const linear: UnitFunction = (t) => t;

export const easeIn: UnitFunction = (t) =>
  unitCurve(t, DEFAULT_EASE_EXPONENT, 1 - EPSILON);
export const easeOut: UnitFunction = (t) =>
  unitCurve(t, DEFAULT_EASE_EXPONENT, EPSILON);
export const easeInEaseOut: UnitFunction = (t) =>
  unitCurve(t, DEFAULT_EASE_EXPONENT, 0.5);

export const easeOutQuad: UnitFunction = (t) => unitCurve(t, 2, EPSILON);
export const easeOutCubic: UnitFunction = (t) => unitCurve(t, 3, EPSILON);
export const easeOutQuart: UnitFunction = (t) => unitCurve(t, 4, EPSILON);
export const easeOutQuint: UnitFunction = (t) => unitCurve(t, 5, EPSILON);

export const easeInEaseOutQuad: UnitFunction = (t) => unitCurve(t, 2, 0.5);
export const easeInEaseOutCubic: UnitFunction = (t) => unitCurve(t, 3, 0.5);

/** Runs past 1 and comes back — Penner's `back`, in UpKit's softened tuning. */
export const easeOutBack: UnitFunction = (t) =>
  1 + BACK_C3 * Math.pow(t - 1, 3) + BACK_C1 * Math.pow(t - 1, 2);

export const easeOutSine: UnitFunction = (t) => Math.sin(t * (Math.PI / 2));

export const easeOutCirc: UnitFunction = (t) =>
  Math.sqrt(1 - Math.pow(t - 1, 2));

export const easeOutExpo: UnitFunction = (t) =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

/**
 * A **critically damped** spring: the fastest approach to rest that never
 * overshoots. The mass arrives and stops — no run past the target, no ring, no
 * second thought.
 *
 * `stiffness` is how hard it is pulled home, as the number of time constants
 * spent over the animation's whole duration. Higher lands sooner and leaves the
 * tail flatter; lower spends more of the duration still arriving. The ideal
 * curve never quite reaches 1, so the result is rescaled to land exactly on it,
 * which is what keeps the frame from stopping a hair short of its place.
 */
export function dampedSpring(stiffness = 8): UnitFunction {
  const raw = (t: number): number => 1 - (1 + stiffness * t) * Math.exp(-stiffness * t);
  const atOne = raw(1);
  return (t) => raw(t) / atOne;
}

/**
 * How many samples {@link cssEasing} takes when not told otherwise.
 *
 * The error of a sampled easing is the gap between the curve and its chords,
 * which falls off as the square of the count. A spring's steepest stretch is
 * about 0.006 off at 32 and about a quarter of that at 64 — under two pixels
 * over the widest travel the deck has, and only in passing.
 */
export const DEFAULT_EASING_SAMPLES = 64;

/**
 * A unit function as a CSS `linear()` easing.
 *
 * The function is sampled at `samples + 1` evenly spaced inputs and the outputs
 * become the stop list, so CSS walks the same shape by straight lines between
 * them. The endpoints are pinned to exactly 0 and 1 — a curve that is a hair
 * off at its ends leaves a frame a hair off its place, and rounding the samples
 * can put it there.
 */
export function cssEasing(
  fn: UnitFunction,
  samples: number = DEFAULT_EASING_SAMPLES,
): string {
  const steps = Math.max(2, Math.floor(samples));
  const stops: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const value = i === 0 ? 0 : i === steps ? 1 : fn(i / steps);
    stops.push(formatStop(value));
  }
  return `linear(${stops.join(", ")})`;
}

/** Five decimals is finer than a device pixel over any distance the deck moves,
 *  and trailing zeros only make the declaration longer. */
function formatStop(value: number): string {
  const rounded = Number(value.toFixed(5));
  return String(rounded);
}
