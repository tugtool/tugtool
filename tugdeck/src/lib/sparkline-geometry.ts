/**
 * sparkline-geometry — the tape's staircase, drawn to a 2D context.
 *
 * Split out of `TugSparkline` so the same code runs in the render worker and,
 * if `transferControlToOffscreen` is ever unavailable, on the main thread
 * against the same canvas. One code path for the geometry either way: a
 * second implementation would be a second thing to keep in sync with the
 * tape's rules, and those rules are the component's whole contract.
 *
 * The shape is a SAMPLE-AND-HOLD STAIRCASE: each value is held flat until the
 * next sample, then steps. Because the held value is drawn flat, when the next
 * sample lands that segment is already flat at that value — it freezes
 * unchanged. Nothing left of the newest sample ever moves, which is what lets
 * the scroll be one continuous compositor transform instead of a redraw loop.
 *
 * @module lib/sparkline-geometry
 */

/**
 * One tape sample. `v` is 0..1 of full scale. `t` is MONOTONIC-CLOCK ms —
 * `performance.now()`, the same time base `Animation.startTime` is written
 * from, so `xOf(t)` below and the scroll's transform are the same function of
 * the same clock. It is NOT wall clock: nothing persists a tape, and the
 * activity meters' wall-clock bins are converted at a single named seam in
 * `sparkline-tape.ts`.
 */
export interface SparklinePoint {
  t: number;
  v: number;
}

/** Everything about the tape's box that does not change between draws. */
export interface SparklineGeometry {
  /** The visible window's width in CSS px. */
  width: number;
  /** The full drawing surface's width in CSS px (window + one epoch). */
  svgWidth: number;
  /** Box height in CSS px. */
  height: number;
  /** Device pixel ratio the backing store is scaled by. */
  dpr: number;
  /** y of the zero line. */
  baselineY: number;
  /** Pixels between the baseline and full scale. */
  amplitude: number;
  /** Scroll rate — also the tape's time→x mapping. */
  pxPerSec: number;
  /** How far back a point stays on the tape before it is pruned. */
  retainMs: number;
}

/** Resolved paint. The SVG carried these as `currentColor` plus opacity. */
export interface SparklineColors {
  line: string;
  area: string;
  lineAlpha: number;
  areaAlpha: number;
  lineWidth: number;
}

export const SPARKLINE_LINE_ALPHA = 0.85;
export const SPARKLINE_AREA_ALPHA = 0.16;
export const SPARKLINE_LINE_WIDTH = 1;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Drop points that have scrolled past the retain window. Mutates in place —
 * the tape is append-only at the right and pruned at the left, and both ends
 * are owned by whoever holds the array.
 */
export function pruneSparklineTape(
  tape: SparklinePoint[],
  now: number,
  retainMs: number,
): void {
  const cutoff = now - retainMs;
  while (tape.length > 0 && tape[0].t < cutoff) tape.shift();
}

/**
 * Paint the whole tape. `t0` is the epoch origin the scroll transform is
 * measured from, so x is the same function of time the WAAPI translate
 * assumes — the two must agree or the tape would slide against its own
 * motion.
 *
 * `clear: false` draws WITHOUT wiping the surface first. A rebase paint uses
 * it to lay the proposed origin's picture into its own region of the canvas
 * while the committed origin's picture — which the still-unmoved transform is
 * showing — stays intact. The two regions cannot collide: origins differ by at
 * least one epoch, which is several viewport-widths of separation.
 */
export function drawSparkline(
  ctx: Ctx,
  geo: SparklineGeometry,
  colors: SparklineColors,
  tape: readonly SparklinePoint[],
  t0: number,
  clear = true,
): void {
  const { dpr, svgWidth, height, baselineY, amplitude, width, pxPerSec } = geo;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (clear) ctx.clearRect(0, 0, svgWidth, height);
  if (tape.length === 0) return;

  const xOf = (t: number): number => width + ((t - t0) / 1000) * pxPerSec;
  const yOf = (v: number): number => baselineY - v * amplitude;

  // Build the staircase once; the line strokes it and the area closes it to
  // the baseline, exactly as the polyline/polygon pair did.
  const xs: number[] = [xOf(tape[0].t)];
  const ys: number[] = [yOf(tape[0].v)];
  for (let i = 1; i < tape.length; i++) {
    const x = xOf(tape[i].t);
    xs.push(x, x);
    ys.push(yOf(tape[i - 1].v), yOf(tape[i].v)); // flat hold, then step
  }
  // Held tail: the pen draws the current value flat PAST the right edge, so
  // the edge is always covered — no empty gap, no pop.
  xs.push(svgWidth);
  ys.push(yOf(tape[tape.length - 1].v));

  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);

  ctx.globalAlpha = colors.areaAlpha;
  ctx.fillStyle = colors.area;
  ctx.lineTo(svgWidth, baselineY);
  ctx.lineTo(xs[0], baselineY);
  ctx.closePath();
  ctx.fill();

  // Re-trace for the stroke: the fill's closing edges along the baseline are
  // not part of the line.
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.globalAlpha = colors.lineAlpha;
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = colors.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.globalAlpha = 1;
}
