/**
 * TugSparkline — a tiny canvas activity graph. Polls a caller-supplied
 * series on a low-rate timer and paints a scrolling filled-area chart,
 * auto-scaled to the window's recent peak (with a floor so idle noise
 * doesn't fill the height).
 *
 * Laws: [L06] appearance is painted straight to the canvas on a timer —
 *       nothing flows through React state, so a 10 Hz redraw never triggers
 *       a render; [L19] `.tsx`/`.css` pair with `data-slot="tug-sparkline"`.
 *
 * Decoupled from any data source: the caller passes `getSeries`, so the
 * component knows nothing about throughput, tokens, or the pulse.
 *
 * @module components/tugways/tug-sparkline
 */

import "./tug-sparkline.css";

import React, { useEffect, useRef } from "react";

/** Redraw cadence. The data bins are seconds-wide, so ~10 Hz is ample. */
const REDRAW_MS = 100;

export function TugSparkline({
  getSeries,
  floor,
  width = 64,
  height = 14,
  className,
}: {
  /** Returns the current window, oldest→newest. Called on every redraw. */
  getSeries: () => number[];
  /** Scale floor — peaks below this still read as small, not full-height. */
  floor: number;
  width?: number;
  height?: number;
  className?: string;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    // The stroke/fill ride the element's CSS `color` so the theme owns the
    // tint. Read once — a theme switch remounts the tree.
    const color = getComputedStyle(canvas).color || "currentColor";

    const draw = (): void => {
      const series = getSeries();
      paintSparkline(ctx, series, width, height, dpr, floor, color);
    };
    draw();
    const id = window.setInterval(draw, REDRAW_MS);
    return () => window.clearInterval(id);
  }, [getSeries, floor, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={
        className ? `tug-sparkline ${className}` : "tug-sparkline"
      }
      data-slot="tug-sparkline"
      style={{ width, height }}
      aria-hidden
    />
  );
}

function paintSparkline(
  ctx: CanvasRenderingContext2D,
  series: number[],
  width: number,
  height: number,
  dpr: number,
  floor: number,
  color: string,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const n = series.length;
  if (n >= 2) {
    let peak = floor;
    for (const v of series) if (v > peak) peak = v;

    const x = (i: number): number => (i / (n - 1)) * width;
    const y = (v: number): number =>
      height - Math.min(1, v / peak) * (height - 1) - 0.5;

    // Filled area under the curve, then a crisp top line.
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < n; i++) ctx.lineTo(x(i), y(series[i]));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const yy = y(series[i]);
      if (i === 0) ctx.moveTo(x(i), yy);
      else ctx.lineTo(x(i), yy);
    }
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  ctx.restore();
}
