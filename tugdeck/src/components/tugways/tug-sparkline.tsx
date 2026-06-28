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

/** Sample cadence (ms) — 4 Hz. The motion between samples is WAAPI, not this. */
const SAMPLE_MS = 250;
/** Scroll speed (px/sec). With a 64px window this is a ~11s visible span. */
const PX_PER_SEC = 6;
/** Seconds the scroll runs before a seamless time-rebase + restart. */
const EPOCH_S = 120;
/** Window over which the plotted rate is summed (a rolling per-second rate). */
const RATE_WINDOW_MS = 1_000;

interface TickPoint {
  /** Sample time, ms — fixed forever once written. */
  t: number;
  /** Value 0..1 of full scale — fixed forever once written. */
  v: number;
}

export function TugSparkline({
  getSeries,
  binMs,
  fullScale,
  width = 64,
  height = 22,
  className,
}: {
  /** Current window oldest→newest; the last element is the still-open bin. */
  getSeries: (nowMs: number) => number[];
  /** Bin width in ms (used to size the rolling-rate window). */
  binMs: number;
  /** Rate (per RATE_WINDOW_MS) mapped to full height; larger clamps. Fixed. */
  fullScale: number;
  width?: number;
  height?: number;
  className?: string;
}): React.ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<SVGPolylineElement | null>(null);
  const areaRef = useRef<SVGPolygonElement | null>(null);

  const epochPx = EPOCH_S * PX_PER_SEC;
  const svgWidth = Math.ceil(width + epochPx + 8);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const line = lineRef.current;
    const area = areaRef.current;
    if (track === null || line === null || area === null) return;

    const motion = isTugMotionEnabled();
    const baselineY = height - 0.5;
    const rateBins = Math.max(1, Math.round(RATE_WINDOW_MS / binMs));
    const tape: TickPoint[] = []; // append-only; points never mutated
    let t0 = Date.now();
    let anim: Animation | null = null;

    const yOf = (v: number): number => height - v * (height - 1) - 0.5;

    // The current rolling rate: sum of the most recent `rateBins` buckets.
    const sampleRate = (now: number): number => {
      const vals = getSeries(now);
      let sum = 0;
      for (let i = Math.max(0, vals.length - rateBins); i < vals.length; i++) {
        sum += vals[i];
      }
      return Math.min(1, sum / fullScale);
    };

    const xOf = (t: number): number => width + ((t - t0) / 1000) * PX_PER_SEC;

    const redraw = (): void => {
      const now = Date.now();
      const cutoff = now - (width / PX_PER_SEC + 4) * 1000;
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
    const sample = (): void => {
      const now = Date.now();
      if (!motion) t0 = now;
      tape.push({ t: now, v: sampleRate(now) });
      redraw();
    };

    const startEpoch = (): void => {
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

    sample();
    startEpoch();
    const timer = window.setInterval(sample, SAMPLE_MS);
    return () => {
      window.clearInterval(timer);
      if (anim !== null) {
        anim.onfinish = null;
        anim.cancel();
      }
    };
  }, [getSeries, binMs, fullScale, width, height, epochPx]);

  return (
    <div
      className={className ? `tug-sparkline ${className}` : "tug-sparkline"}
      data-slot="tug-sparkline"
      style={{ width, height }}
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
