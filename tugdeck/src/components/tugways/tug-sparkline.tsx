/**
 * TugSparkline — a stock-ticker activity graph.
 *
 * Two rules, like ticker tape:
 *  1. The tape NEVER stops and values are NEVER revised. A sample is taken on
 *     a fixed cadence and appended once as a permanent point; zero activity is
 *     a zero sample, so the line keeps printing a flat baseline that scrolls —
 *     it does not stop short.
 *  2. New samples write at the right edge and scroll left at a constant rate.
 *
 * Sampling is a {@link SAMPLE_MS} timer (data only); the scroll is a single
 * continuous WAAPI `translateX` composited on the GPU (Smoothie Charts' time→x
 * mapping, adapted off its rAF loop — see THIRD_PARTY_NOTICES.md, MIT). There
 * is no per-frame redraw loop: between samples the compositor does the motion.
 * Each epoch the scroll seamlessly time-rebases so coordinates stay bounded.
 *
 * DORMANCY. A scrolling flat baseline is pixel-identical to a static flat
 * baseline, so once the whole visible window has been flat for its full span
 * the timer and the scroll stop — zero timers, zero animations, zero style
 * invalidation while the session idles. The tape also goes dormant whenever
 * the element is not on screen (`IntersectionObserver`; a `display:none` card
 * does not intersect). Dormancy NEVER delays real activity: the caller's
 * `subscribeActivity` channel fires synchronously when data records, and the
 * wake handler rebuilds the tape from the caller's own binned history and
 * restarts the scroll in that same tick — activity lands on screen the
 * instant its frame arrives, ahead of where the old always-on 4 Hz poll
 * would have caught it. (Rule 1's "values are never revised" applies to the
 * on-screen tape; a dormant rebuild reconstructs state nobody was shown.)
 *
 * The sampled value is a rolling ~1s output rate, so it rises smoothly with
 * activity and falls to zero (baseline) when output stops.
 *
 * Laws: [L13] motion is a WAAPI transform, never an rAF/timer-driven frame
 *       loop (the timer samples data, it does not animate); [L06] geometry is
 *       written straight to SVG attributes — no React state; [L03] setup in
 *       `useLayoutEffect`; [L19] `.tsx`/`.css` pair; [L21] adapted algorithm
 *       noticed.
 *
 * Decoupled from any data source: the caller passes `getSeries` (oldest→newest
 * bins) and the bin width; the component samples it on its own cadence.
 *
 * @module components/tugways/tug-sparkline
 */

import "./tug-sparkline.css";

import React, { useLayoutEffect, useRef } from "react";

import { isTugMotionEnabled } from "./scale-timing";

/**
 * How long a datum stays visible, in seconds — the ONE knob for the time span.
 * The scroll speed is derived from it and the width, so a datum enters at the
 * right edge and scrolls off the left exactly this many seconds later.
 */
const VISIBLE_SECONDS = 15;
/** Sample cadence (ms) — 4 Hz. The motion between samples is WAAPI, not this. */
const SAMPLE_MS = 250;
/** Off-screen seconds kept past the left edge before a point is pruned. */
const PRUNE_MARGIN_S = 4;
/** Seconds the scroll runs before a seamless time-rebase + restart. */
const EPOCH_S = 120;
/**
 * Flat-window span (ms) after the last non-zero sample before the tape goes
 * dormant — exactly how long a datum takes to scroll fully off, so dormancy
 * begins only once the screen is provably a flat line edge to edge.
 */
const DORMANT_AFTER_MS = (VISIBLE_SECONDS + PRUNE_MARGIN_S) * 1000;
/** Window over which the plotted rate is summed (a rolling per-second rate). */
const RATE_WINDOW_MS = 1_000;

/**
 * Response curve: maps the rate as a fraction of full scale (`x = rate /
 * fullScale`, ≥ 0 and MAY exceed 1) to a display height. The caller clamps the
 * result into `[0, 1]`, so a curve may either reach 1 exactly at `x = 1` (a
 * hard ceiling: everything past `fullScale` clips flat) or asymptote toward 1
 * and never clip. This is the ONE place the vertical shape lives — swap the
 * curve to retune the feel without touching any geometry, motion, or data.
 *
 * `curve(0)` must be 0 so silence reads a flat baseline. What we want here is
 * strong differentiation across the LOW/MID band (ordinary activity should use
 * most of the height and vary visibly) while the TOP rolls off gently so a
 * burst reads tall without slamming into a flat clip.
 */
export type SparklineCurve = (x: number) => number;

/**
 * The curve library. To try a different feel, point the caller's `curve` prop
 * at another entry (or add one here). `x` is `rate / fullScale`.
 *
 *  - `linear`   — no shaping; a fast burst clips the instant it passes full
 *                 scale. The original behavior.
 *  - `gamma(g)` — power curve `x^g`. `g < 1` is STEEP through the low/mid band
 *                 (great differentiation there) and concave into the top, which
 *                 rounds off just below full scale. Reaches 1 at `x = 1`, so
 *                 pick `fullScale` above real bursts for headroom. Smaller `g`
 *                 = steeper low end. This is the current feel.
 *  - `log(knee)`— logarithmic: equal height per DOUBLING of rate. Spends its
 *                 steepness on the very-low end and flattens the mid band, so
 *                 large `knee` reads FLAT for ordinary activity — usually the
 *                 wrong trade here. Kept for comparison.
 *  - `soft(k)`  — saturating soft-knee `1 − e^(−k·x)`. NEVER clips (asymptotes
 *                 to 1); slope `k` at the origin sets low/mid steepness. Here
 *                 `fullScale` is a characteristic scale, not a ceiling. Use
 *                 when even extreme spikes must stay on-screen without a flat
 *                 top — at the cost of bursts differentiating less up high.
 */
export const sparklineCurves = {
  linear: ((x) => x) as SparklineCurve,
  gamma:
    (g: number): SparklineCurve =>
    (x) =>
      Math.pow(x, g),
  log:
    (knee: number): SparklineCurve =>
    (x) =>
      Math.log1p(x * knee) / Math.log1p(knee),
  soft:
    (k: number): SparklineCurve =>
    (x) =>
      1 - Math.exp(-k * x),
};

interface TickPoint {
  /** Sample time, ms — fixed forever once written. */
  t: number;
  /** Value 0..1 of full scale — fixed forever once written. */
  v: number;
}

export function TugSparkline({
  getSeries,
  getColorChannel,
  subscribeActivity,
  binMs,
  fullScale,
  curve = sparklineCurves.linear,
  width = 64,
  height = 22,
  className,
  title,
}: {
  /** Current window oldest→newest; the last element is the still-open bin. */
  getSeries: (nowMs: number) => number[];
  /**
   * Zero-lag dormancy wake channel. When provided, the tape stops its timer
   * and scroll after {@link DORMANT_AFTER_MS} of flat baseline; this callback
   * must then fire (synchronously with the data write) the moment new
   * activity records so the tape wakes in the same tick. Without it the tape
   * never idles out — only visibility can pause it, and re-entering view
   * always resumes live.
   */
  subscribeActivity?: (wake: () => void) => () => void;
  /**
   * Optional dominant-channel selector, sampled on the same loop as
   * `getSeries` ([P05]). Its return (a channel name, or null when idle) is
   * stamped as `data-activity-channel` on the container so theme CSS can
   * tint the line by what the session is doing; the caller owns hysteresis
   * so the color doesn't strobe. Omitted → the line keeps its default hue.
   */
  getColorChannel?: (nowMs: number) => string | null;
  /** Bin width in ms (used to size the rolling-rate window). */
  binMs: number;
  /** Rate (per RATE_WINDOW_MS) that reaches full height; larger clamps. Fixed. */
  fullScale: number;
  /** Vertical response curve; see {@link sparklineCurves}. Default: linear. */
  curve?: SparklineCurve;
  width?: number;
  height?: number;
  className?: string;
  /** Native hover tooltip. The graphic itself stays `aria-hidden`. */
  title?: string;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<SVGPolylineElement | null>(null);
  const areaRef = useRef<SVGPolygonElement | null>(null);

  // Scroll speed derived from the single time-span knob and the width.
  const pxPerSec = width / VISIBLE_SECONDS;
  const epochPx = EPOCH_S * pxPerSec;
  const svgWidth = Math.ceil(width + epochPx + 8);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    const line = lineRef.current;
    const area = areaRef.current;
    if (track === null || line === null || area === null) return;

    const motion = isTugMotionEnabled();
    // The 1px line is drawn inside an overflow:hidden box. Painting the zero
    // baseline flush at the bottom edge (height - 0.5) leaves its stroke one
    // sub-pixel from the clip, so some bar heights / device-pixel ratios round
    // it away. Reserve a 1px floor so the baseline and the area's bottom always
    // stay inside the box.
    const FLOOR = 1;
    const baselineY = height - FLOOR - 0.5;
    const amplitude = height - FLOOR - 1;
    const rateBins = Math.max(1, Math.round(RATE_WINDOW_MS / binMs));
    const tape: TickPoint[] = []; // append-only while live; points never mutated
    let t0 = Date.now();
    let anim: Animation | null = null;
    let timer: number | null = null;
    let dormant = false;
    let inView = true;
    let lastNonZeroAt = 0;

    const yOf = (v: number): number => baselineY - v * amplitude;

    // The current rolling rate: sum of the most recent `rateBins` buckets,
    // taken as a fraction of full scale, shaped by `curve`, then clamped. The
    // clamp is OUTSIDE the curve so a saturating curve can take x > 1 and roll
    // off gently instead of being pre-clipped at full scale.
    const sampleRate = (now: number): number => {
      const vals = getSeries(now);
      let sum = 0;
      for (let i = Math.max(0, vals.length - rateBins); i < vals.length; i++) {
        sum += vals[i];
      }
      return Math.min(1, Math.max(0, curve(sum / fullScale)));
    };

    const xOf = (t: number): number => width + ((t - t0) / 1000) * pxPerSec;

    const redraw = (): void => {
      const now = Date.now();
      const cutoff = now - (VISIBLE_SECONDS + PRUNE_MARGIN_S) * 1000;
      while (tape.length > 0 && tape[0].t < cutoff) tape.shift();
      if (tape.length === 0) {
        line.setAttribute("points", "");
        area.setAttribute("points", "");
        return;
      }
      // Sample-and-hold STAIRCASE: each value is held flat until the next
      // sample, then steps. Because the held value is drawn flat, when the
      // next sample lands that segment is ALREADY flat at that value — it
      // freezes unchanged. Nothing left of the newest sample ever moves.
      const pts: string[] = [];
      pts.push(`${xOf(tape[0].t).toFixed(1)},${yOf(tape[0].v).toFixed(1)}`);
      for (let i = 1; i < tape.length; i++) {
        const x = xOf(tape[i].t).toFixed(1);
        pts.push(`${x},${yOf(tape[i - 1].v).toFixed(1)}`); // flat hold to here
        pts.push(`${x},${yOf(tape[i].v).toFixed(1)}`); // step to new value
      }
      // Held tail: the pen draws the current value flat PAST the right edge,
      // so the edge is always covered — no empty gap, no pop.
      const lastV = yOf(tape[tape.length - 1].v).toFixed(1);
      pts.push(`${svgWidth.toFixed(1)},${lastV}`);

      line.setAttribute("points", pts.join(" "));
      const firstX = pts[0].slice(0, pts[0].indexOf(","));
      area.setAttribute(
        "points",
        `${firstX},${baselineY} ${pts.join(" ")} ${svgWidth},${baselineY}`,
      );
    };

    // One sample → one permanent point at "now" (the right edge), then redraw.
    let stampedChannel: string | null = null;
    const sample = (): void => {
      const now = Date.now();
      if (!motion) t0 = now;
      const v = sampleRate(now);
      if (v > 0) lastNonZeroAt = now;
      tape.push({ t: now, v });
      redraw();
      // Stamp the dominant channel for CSS tinting ([P05]) — only on change,
      // so a steady color doesn't rewrite the attribute every tick. Appearance
      // rides the DOM attribute, never React state ([L06]).
      if (getColorChannel !== undefined && container !== null) {
        const channel = getColorChannel(now);
        if (channel !== stampedChannel) {
          // A dominant-channel CHANGE is activity — the tint is about
          // to move, so hold the tape awake. A steady return is not: a
          // fixed-hue consumer (the Pulse card rows) is always
          // non-null, and treating that as activity would lock those
          // tapes out of flat-dormancy forever. Real drawn activity
          // already bumps via v > 0 above.
          lastNonZeroAt = now;
          stampedChannel = channel;
          if (channel === null) container.removeAttribute("data-activity-channel");
          else container.setAttribute("data-activity-channel", channel);
        }
      }
      // The window has been flat edge to edge and a wake channel exists —
      // stop the tape. A static flat line is the same pixels.
      if (
        subscribeActivity !== undefined &&
        now - lastNonZeroAt >= DORMANT_AFTER_MS
      ) {
        enterDormant(now);
      }
    };

    const startEpoch = (): void => {
      // A live animation must never be orphaned: its onfinish would
      // keep respawning epochs nothing can stop. Cancel before
      // replacing (a no-op when called from its own onfinish).
      if (anim !== null) {
        anim.onfinish = null;
        anim.cancel();
        anim = null;
      }
      t0 = Date.now();
      redraw();
      if (!motion) return;
      anim = track.animate(
        [
          { transform: "translateX(0)" },
          { transform: `translateX(${-epochPx}px)` },
        ],
        { duration: EPOCH_S * 1000, easing: "linear", fill: "forwards" },
      );
      // At finish now === t0 + EPOCH_S, so rebasing (t0 = now, redraw, restart
      // from 0) is algebraically continuous — the tape doesn't move on screen.
      anim.onfinish = () => startEpoch();
    };

    // Rebuild the tape from the caller's real binned history: zero seeds
    // cover the span the bins don't reach (so the chart is FULL edge to edge,
    // never growing in from the right), then each bin becomes the point the
    // live sampler would have written at that moment — same rolling-rate,
    // same curve. Used at mount and at every wake, so what's on screen is
    // always derived from data + timestamps, never from scroll continuity.
    const rebuildTape = (now: number): void => {
      tape.length = 0;
      const vals = getSeries(now);
      const binSpan = vals.length * binMs;
      for (let dt = DORMANT_AFTER_MS; dt > binSpan; dt -= SAMPLE_MS) {
        tape.push({ t: now - dt, v: 0 });
      }
      for (let i = 0; i < vals.length; i++) {
        let sum = 0;
        for (let j = Math.max(0, i - rateBins + 1); j <= i; j++) sum += vals[j];
        const v = Math.min(1, Math.max(0, curve(sum / fullScale)));
        const t = now - (vals.length - 1 - i) * binMs;
        if (vals[i] > 0) lastNonZeroAt = Math.max(lastNonZeroAt, t);
        tape.push({ t, v });
      }
    };

    const stopTimer = (): void => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    // Freeze in place: no timer, no animation, one static redraw of the
    // current (flat, or hidden) picture. Idempotent.
    const enterDormant = (now: number): void => {
      if (dormant) return;
      dormant = true;
      stopTimer();
      if (anim !== null) {
        anim.onfinish = null;
        anim.cancel();
        anim = null;
      }
      t0 = now;
      redraw();
    };

    // Resume live: reconstruct from data, restart the scroll and the sampler.
    // Runs synchronously inside the caller's data-write (or the visibility
    // callback), so waking never trails the activity that caused it.
    const wakeLive = (now: number): void => {
      dormant = false;
      rebuildTape(now);
      startEpoch();
      stopTimer();
      timer = window.setInterval(sample, SAMPLE_MS);
      // Sample LAST: sample() may re-enter dormancy (a wake landing at
      // the exact flat-window boundary re-reads the clock and can cross
      // the threshold). With the animation and timer already running,
      // that enterDormant tears both down and leaves a consistent
      // dormant state; sampled first, it would mark dormant and then
      // this function would start an animation and timer nothing stops.
      sample();
    };

    const flatPastWindow = (now: number): boolean =>
      subscribeActivity !== undefined && now - lastNonZeroAt >= DORMANT_AFTER_MS;

    // Stamp the tint once at mount, dormancy-independent: a born-idle
    // tape never runs sample(), and a fixed-hue row (Pulse card) must
    // not sit untinted until its first wake. Not an activity signal —
    // stampedChannel is pre-set so the first sample() sees no change.
    if (getColorChannel !== undefined && container !== null) {
      const mountChannel = getColorChannel(Date.now());
      stampedChannel = mountChannel;
      if (mountChannel !== null) {
        container.setAttribute("data-activity-channel", mountChannel);
      }
    }
    rebuildTape(Date.now());
    if (flatPastWindow(Date.now())) {
      // Born idle: paint the static flat line once and wait for the wake
      // channel — an idle session costs nothing from the first frame.
      dormant = true;
      t0 = Date.now();
      redraw();
    } else {
      wakeLive(Date.now());
    }

    // New activity recorded for this series — wake in the same tick. When
    // off-screen, stay dormant (the observer wakes us on re-entry); just
    // remember the activity so re-entry resumes live.
    const unsubscribe =
      subscribeActivity !== undefined
        ? subscribeActivity(() => {
            lastNonZeroAt = Date.now();
            if (dormant && inView) wakeLive(Date.now());
          })
        : null;

    // Visibility gate: an off-screen tape (hidden card, scrolled-away row)
    // pauses outright; re-entry rebuilds from history, resuming live only
    // when there is recent activity to show.
    const observer =
      container !== null && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (entry === undefined) return;
            if (entry.isIntersecting) {
              inView = true;
              if (!dormant) return;
              if (flatPastWindow(Date.now())) {
                rebuildTape(Date.now());
                t0 = Date.now();
                redraw();
              } else {
                wakeLive(Date.now());
              }
            } else {
              inView = false;
              enterDormant(Date.now());
            }
          })
        : null;
    if (observer !== null && container !== null) observer.observe(container);

    return () => {
      stopTimer();
      observer?.disconnect();
      unsubscribe?.();
      if (anim !== null) {
        anim.onfinish = null;
        anim.cancel();
      }
    };
  }, [
    getSeries,
    getColorChannel,
    subscribeActivity,
    binMs,
    fullScale,
    curve,
    width,
    height,
    pxPerSec,
    epochPx,
  ]);

  return (
    <div
      ref={containerRef}
      className={className ? `tug-sparkline ${className}` : "tug-sparkline"}
      data-slot="tug-sparkline"
      style={{ width, height }}
      title={title}
      aria-hidden
    >
      <div ref={trackRef} className="tug-sparkline-track">
        <svg width={svgWidth} height={height}>
          <polygon ref={areaRef} className="tug-sparkline-area" points="" />
          <polyline ref={lineRef} className="tug-sparkline-line" points="" />
        </svg>
      </div>
    </div>
  );
}
